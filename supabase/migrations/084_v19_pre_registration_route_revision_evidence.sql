-- Tailmance v19 pre-registration route-revision evidence hardening.
-- The presentation digest already binds route_revision. Persist it explicitly as forensic evidence so a
-- historical signup can be correlated to the exact publication-route revision without reverse-engineering
-- the digest or relying on the route still being current.

alter table public.pre_registration_legal_presentations
  add column if not exists route_revision uuid;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_locale text; v_attested boolean; v_statement_version text; v_declared_country text; v_declared_subnational text;
  v_scope_mode text; v_scope_sha text; v_pre_bundle_id uuid; v_presented_sha text; v_presented_route_revision uuid;
  v_current_sha text; v_current_scope_sha text; v_pre public.pre_registration_legal_bundles; v_route public.pre_registration_legal_bundle_routes;
begin
  v_attested:=lower(coalesce(new.raw_user_meta_data->>'prelegal_age_attested','false')) in ('true','1','yes');
  v_statement_version:=coalesce(new.raw_user_meta_data->>'prelegal_age_attestation_version','');
  v_locale:=coalesce(new.raw_user_meta_data->>'prelegal_age_attestation_locale','');
  v_declared_country:=upper(trim(coalesce(new.raw_user_meta_data->>'pre_registration_declared_country_code','')));
  v_declared_subnational:=upper(trim(coalesce(new.raw_user_meta_data->>'pre_registration_declared_subnational_code','')));
  v_scope_mode:=trim(coalesce(new.raw_user_meta_data->>'pre_registration_subnational_scope_mode',''));
  v_scope_sha:=lower(trim(coalesce(new.raw_user_meta_data->>'pre_registration_subnational_scope_evidence_sha256','')));
  v_presented_sha:=lower(trim(coalesce(new.raw_user_meta_data->>'pre_registration_presentation_sha256','')));

  if v_attested is distinct from true or v_statement_version<>'tailmance_age18_signup_v1' then raise exception 'prelegal_age_attestation_required'; end if;
  if v_locale !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$' or char_length(v_locale) not between 2 and 16 then raise exception 'invalid_prelegal_locale'; end if;
  if v_declared_country !~ '^[A-Z]{2}$' then raise exception 'pre_registration_declared_country_required'; end if;
  if v_declared_subnational<>'' and (v_declared_subnational !~ '^[A-Z]{2}-[A-Z0-9-]+$' or left(v_declared_subnational,3)<>v_declared_country||'-') then raise exception 'invalid_pre_registration_declared_subnational_code'; end if;
  if v_scope_mode not in ('not_required_with_counsel_evidence','countrywide_notice_counsel_approved','exact_subnational_route') then raise exception 'pre_registration_subnational_scope_required'; end if;
  if v_scope_sha !~ '^[0-9a-f]{64}$' then raise exception 'pre_registration_subnational_scope_evidence_hash_required'; end if;
  if v_presented_sha !~ '^[0-9a-f]{64}$' then raise exception 'pre_registration_presentation_hash_required'; end if;
  begin v_pre_bundle_id:=(new.raw_user_meta_data->>'pre_registration_bundle_id')::uuid;
  exception when others then raise exception 'pre_registration_bundle_required'; end;
  begin v_presented_route_revision:=(new.raw_user_meta_data->>'pre_registration_route_revision')::uuid;
  exception when others then raise exception 'pre_registration_route_revision_required'; end;

  select * into v_pre from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=v_pre_bundle_id;
  if not found or v_pre.declared_country_code<>v_declared_country or v_pre.ui_locale<>v_locale or coalesce(v_pre.declared_subnational_code,'')<>v_declared_subnational or v_pre.subnational_scope_mode<>v_scope_mode then raise exception 'pre_registration_presentation_context_mismatch'; end if;

  select * into v_route from public.pre_registration_legal_bundle_routes r
  where r.declared_country_code=v_declared_country and r.ui_locale=v_locale and r.declared_subnational_code=v_declared_subnational;
  if not found or v_route.route_status<>'active' or v_route.current_bundle_id is distinct from v_pre_bundle_id then
    raise exception 'pre_registration_route_changed';
  end if;
  if v_route.route_revision is distinct from v_presented_route_revision then raise exception 'pre_registration_route_revision_changed'; end if;

  if not public.pre_registration_legal_bundle_current(v_pre_bundle_id) then raise exception 'pre_registration_legal_presentation_unavailable'; end if;
  v_current_sha:=public.pre_registration_legal_presentation_sha256(v_pre_bundle_id);
  v_current_scope_sha:=public.pre_registration_subnational_scope_evidence_sha256(v_pre_bundle_id);
  if v_current_sha is null or v_current_sha<>v_presented_sha then raise exception 'pre_registration_legal_presentation_changed'; end if;
  if v_current_scope_sha is null or v_current_scope_sha<>v_scope_sha then raise exception 'pre_registration_subnational_scope_changed'; end if;

  insert into public.users(id,age_18_confirmed,legal_version) values(new.id,false,null) on conflict(id) do nothing;
  insert into public.prelegal_age_attestations(user_id,age_threshold,statement_version,ui_locale,source,attested_at)
    values(new.id,18,v_statement_version,v_locale,'signup_checkbox',now()) on conflict(user_id,statement_version) do nothing;
  insert into public.pre_registration_legal_presentations(
    user_id,pre_registration_bundle_id,route_revision,declared_country_code,declared_subnational_code,subnational_scope_mode,subnational_scope_evidence_sha256,
    ui_locale,document_locale,presentation_sha256,privacy_notice_sha256,source,presented_at
  ) values(
    new.id,v_pre.pre_registration_bundle_id,v_presented_route_revision,v_pre.declared_country_code,v_pre.declared_subnational_code,v_pre.subnational_scope_mode,v_current_scope_sha,
    v_pre.ui_locale,v_pre.document_locale,v_current_sha,v_pre.privacy_notice_sha256,'signup_exact_public_presentation',now()
  ) on conflict(user_id,pre_registration_bundle_id,presentation_sha256) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_auth_user() from public,anon,authenticated;

comment on column public.pre_registration_legal_presentations.route_revision is
  'Exact service-published pre-registration legal route revision cryptographically bound into presentation_sha256 and verified at signup.';
