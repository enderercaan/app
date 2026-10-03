-- Tailmance v19 R8: normalize current pre-registration subnational scope terminology to the
-- configured-27 official-source authority model. Historical bundle rows may retain legacy
-- counsel-named tokens for immutable evidence compatibility, but current public presentation,
-- presentation hashing and signup evidence use official-source terminology only.

create or replace function public.pre_registration_public_scope_mode(p_mode text)
returns text language sql immutable security definer set search_path='' as $$
  select case trim(coalesce(p_mode,''))
    when 'not_required_with_counsel_evidence' then 'not_required_with_official_source_evidence'
    when 'countrywide_notice_counsel_approved' then 'countrywide_notice_internal_source_approved'
    when 'not_required_with_official_source_evidence' then 'not_required_with_official_source_evidence'
    when 'countrywide_notice_internal_source_approved' then 'countrywide_notice_internal_source_approved'
    when 'exact_subnational_route' then 'exact_subnational_route'
    else null
  end;
$$;
revoke all on function public.pre_registration_public_scope_mode(text) from public,anon,authenticated;
grant execute on function public.pre_registration_public_scope_mode(text) to service_role;

alter table public.pre_registration_legal_presentations
  drop constraint if exists pre_registration_legal_presentations_subnational_scope_mode_check;
alter table public.pre_registration_legal_presentations
  add constraint pre_registration_legal_presentations_subnational_scope_mode_check check (
    subnational_scope_mode in (
      'not_required_with_counsel_evidence','countrywide_notice_counsel_approved',
      'not_required_with_official_source_evidence','countrywide_notice_internal_source_approved',
      'exact_subnational_route'
    )
  );

create or replace function public.pre_registration_subnational_scope_evidence_sha256(p_bundle_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case
    when b.subnational_scope_mode='unresolved' or jsonb_array_length(b.subnational_scope_evidence_reference)=0
      or public.pre_registration_public_scope_mode(b.subnational_scope_mode) is null then null
    else encode(extensions.digest(convert_to(jsonb_build_object(
      'preRegistrationBundleId',b.pre_registration_bundle_id::text,
      'declaredCountryCode',b.declared_country_code,
      'declaredSubnationalCode',b.declared_subnational_code,
      'subnationalScopeMode',public.pre_registration_public_scope_mode(b.subnational_scope_mode),
      'evidence',b.subnational_scope_evidence_reference
    )::text,'UTF8'),'sha256'),'hex')
  end
  from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=p_bundle_id;
$$;
revoke all on function public.pre_registration_subnational_scope_evidence_sha256(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_subnational_scope_evidence_sha256(uuid) to service_role;

create or replace function public.pre_registration_legal_presentation_sha256(p_bundle_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when not public.pre_registration_legal_bundle_current(p_bundle_id) then null else
    encode(extensions.digest(convert_to(jsonb_build_object(
      'preRegistrationBundleId',b.pre_registration_bundle_id::text,
      'routeRevision',r.route_revision::text,
      'declaredCountryCode',b.declared_country_code,
      'declaredSubnationalCode',b.declared_subnational_code,
      'subnationalScopeMode',public.pre_registration_public_scope_mode(b.subnational_scope_mode),
      'subnationalScopeEvidenceSha256',public.pre_registration_subnational_scope_evidence_sha256(b.pre_registration_bundle_id),
      'uiLocale',b.ui_locale,
      'documentLocale',b.document_locale,
      'terms',jsonb_build_array(b.terms_version,b.terms_url,b.terms_sha256),
      'privacy',jsonb_build_array(b.privacy_notice_version,b.privacy_notice_url,b.privacy_notice_sha256),
      'community',jsonb_build_array(b.community_guidelines_version,b.community_guidelines_url,b.community_guidelines_sha256)
    )::text,'UTF8'),'sha256'),'hex') end
  from public.pre_registration_legal_bundles b
  join public.pre_registration_legal_bundle_routes r
    on r.declared_country_code=b.declared_country_code and r.ui_locale=b.ui_locale
   and r.declared_subnational_code=coalesce(b.declared_subnational_code,'') and r.current_bundle_id=b.pre_registration_bundle_id
  where b.pre_registration_bundle_id=p_bundle_id;
$$;
revoke all on function public.pre_registration_legal_presentation_sha256(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_legal_presentation_sha256(uuid) to service_role;

create or replace function public.get_pre_registration_legal_presentation(
  p_declared_country_code text,p_ui_locale text,p_declared_subnational_code text
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_declared_country_code,'')));
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_sub text:=upper(trim(coalesce(p_declared_subnational_code,'')));
  v_bundle public.pre_registration_legal_bundles;
  v_route public.pre_registration_legal_bundle_routes;
  v_sha text; v_scope_sha text; v_scope_mode text; v_exact_route_exists boolean:=false; v_exact_ready boolean:=false;
begin
  if v_country !~ '^[A-Z]{2}$' then return jsonb_build_object('status','blocked_invalid_declared_country'); end if;
  if char_length(v_locale) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale','declaredCountryCode',v_country); end if;
  if v_sub<>'' and (v_sub !~ '^[A-Z]{2}-[A-Z0-9-]+$' or left(v_sub,3)<>v_country||'-' or char_length(v_sub)>32) then
    return jsonb_build_object('status','blocked_invalid_declared_subnational_code','declaredCountryCode',v_country,'uiLocale',v_locale);
  end if;

  if v_sub<>'' then
    select * into v_route from public.pre_registration_legal_bundle_routes r
      where r.declared_country_code=v_country and r.ui_locale=v_locale and r.declared_subnational_code=v_sub;
    v_exact_route_exists:=found;
    if v_exact_route_exists then
      v_exact_ready:=v_route.route_status='active' and v_route.current_bundle_id is not null and v_route.effective_at is not null and v_route.effective_at<=now()
        and public.pre_registration_legal_bundle_current(v_route.current_bundle_id);
      if not v_exact_ready then
        return jsonb_build_object('status','blocked_pre_registration_exact_subnational_presentation_unavailable','declaredCountryCode',v_country,'declaredSubnationalCode',v_sub,'uiLocale',v_locale);
      end if;
      select * into v_bundle from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=v_route.current_bundle_id;
    end if;
  end if;

  if not v_exact_route_exists then
    select * into v_route from public.pre_registration_legal_bundle_routes r
      where r.declared_country_code=v_country and r.ui_locale=v_locale and r.declared_subnational_code='';
    if found and v_route.route_status='active' and v_route.current_bundle_id is not null and v_route.effective_at is not null and v_route.effective_at<=now()
      and public.pre_registration_legal_bundle_current(v_route.current_bundle_id) then
      select * into v_bundle from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=v_route.current_bundle_id;
    else
      if exists(
        select 1 from public.pre_registration_legal_bundle_routes er
        where er.declared_country_code=v_country and er.ui_locale=v_locale and er.declared_subnational_code<>''
          and er.route_status='active' and er.effective_at<=now() and public.pre_registration_legal_bundle_current(er.current_bundle_id)
      ) then
        return jsonb_build_object('status','blocked_pre_registration_subnational_selection_required','declaredCountryCode',v_country,'uiLocale',v_locale);
      end if;
      return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale);
    end if;
  end if;

  v_scope_mode:=public.pre_registration_public_scope_mode(v_bundle.subnational_scope_mode);
  v_sha:=public.pre_registration_legal_presentation_sha256(v_bundle.pre_registration_bundle_id);
  v_scope_sha:=public.pre_registration_subnational_scope_evidence_sha256(v_bundle.pre_registration_bundle_id);
  if v_scope_mode is null or v_sha is null or v_sha !~ '^[0-9a-f]{64}$' or v_scope_sha is null or v_scope_sha !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale);
  end if;
  return jsonb_build_object(
    'status','ready',
    'preRegistrationBundleId',v_bundle.pre_registration_bundle_id,
    'routeRevision',v_route.route_revision,
    'declaredCountryCode',v_bundle.declared_country_code,
    'declaredSubnationalCode',v_bundle.declared_subnational_code,
    'subnationalScopeMode',v_scope_mode,
    'subnationalScopeAuthority','internal_official_source_review',
    'subnationalScopeEvidenceSha256',v_scope_sha,
    'uiLocale',v_bundle.ui_locale,
    'documentLocale',v_bundle.document_locale,
    'termsUrl',v_bundle.terms_url,
    'privacyNoticeUrl',v_bundle.privacy_notice_url,
    'communityGuidelinesUrl',v_bundle.community_guidelines_url,
    'presentationSha256',v_sha,
    'registrationPrivacyNoticeApplies',true,
    'bindingTermsAcceptanceDeferredUntilVerifiedJurisdiction',true,
    'declaredCountryIsNotFinalLegalJurisdiction',true
  );
end $$;
revoke all on function public.get_pre_registration_legal_presentation(text,text,text) from public;
grant execute on function public.get_pre_registration_legal_presentation(text,text,text) to anon,authenticated;

create or replace function public.get_pre_registration_legal_presentation(p_declared_country_code text,p_ui_locale text)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.get_pre_registration_legal_presentation(p_declared_country_code,p_ui_locale,null);
$$;
revoke all on function public.get_pre_registration_legal_presentation(text,text) from public;
grant execute on function public.get_pre_registration_legal_presentation(text,text) to anon,authenticated;

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
  v_scope_mode:=public.pre_registration_public_scope_mode(trim(coalesce(new.raw_user_meta_data->>'pre_registration_subnational_scope_mode','')));
  v_scope_sha:=lower(trim(coalesce(new.raw_user_meta_data->>'pre_registration_subnational_scope_evidence_sha256','')));
  v_presented_sha:=lower(trim(coalesce(new.raw_user_meta_data->>'pre_registration_presentation_sha256','')));

  if v_attested is distinct from true or v_statement_version<>'tailmance_age18_signup_v1' then raise exception 'prelegal_age_attestation_required'; end if;
  if v_locale !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$' or char_length(v_locale) not between 2 and 16 then raise exception 'invalid_prelegal_locale'; end if;
  if v_declared_country !~ '^[A-Z]{2}$' then raise exception 'pre_registration_declared_country_required'; end if;
  if v_declared_subnational<>'' and (v_declared_subnational !~ '^[A-Z]{2}-[A-Z0-9-]+$' or left(v_declared_subnational,3)<>v_declared_country||'-') then raise exception 'invalid_pre_registration_declared_subnational_code'; end if;
  if v_scope_mode not in ('not_required_with_official_source_evidence','countrywide_notice_internal_source_approved','exact_subnational_route') then raise exception 'pre_registration_subnational_scope_required'; end if;
  if v_scope_sha !~ '^[0-9a-f]{64}$' then raise exception 'pre_registration_subnational_scope_evidence_hash_required'; end if;
  if v_presented_sha !~ '^[0-9a-f]{64}$' then raise exception 'pre_registration_presentation_hash_required'; end if;
  begin v_pre_bundle_id:=(new.raw_user_meta_data->>'pre_registration_bundle_id')::uuid;
  exception when others then raise exception 'pre_registration_bundle_required'; end;
  begin v_presented_route_revision:=(new.raw_user_meta_data->>'pre_registration_route_revision')::uuid;
  exception when others then raise exception 'pre_registration_route_revision_required'; end;

  select * into v_pre from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=v_pre_bundle_id;
  if not found or v_pre.declared_country_code<>v_declared_country or v_pre.ui_locale<>v_locale or coalesce(v_pre.declared_subnational_code,'')<>v_declared_subnational
     or public.pre_registration_public_scope_mode(v_pre.subnational_scope_mode)<>v_scope_mode then raise exception 'pre_registration_presentation_context_mismatch'; end if;

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
    new.id,v_pre.pre_registration_bundle_id,v_presented_route_revision,v_pre.declared_country_code,v_pre.declared_subnational_code,v_scope_mode,v_current_scope_sha,
    v_pre.ui_locale,v_pre.document_locale,v_current_sha,v_pre.privacy_notice_sha256,'signup_exact_public_presentation',now()
  ) on conflict(user_id,pre_registration_bundle_id,presentation_sha256) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_auth_user() from public,anon,authenticated;

comment on function public.pre_registration_public_scope_mode(text) is
  'Normalizes legacy counsel-named pre-registration scope tokens to current configured-market internal official-source terminology; no external counsel approval is required or implied.';
