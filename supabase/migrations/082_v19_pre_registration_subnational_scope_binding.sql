-- Tailmance v19 pre-registration subnational scope binding.
-- A country declaration is not enough where the approved jurisdiction policy requires subnational review.
-- Registration-time notices must either have attributable counsel evidence that one countrywide notice covers
-- the relevant subnational registration-notice duties, or bind to an exact subdivision route. Unresolved scope
-- fails closed. This remains a pre-registration disclosure route, not final legal-jurisdiction resolution.

alter table public.pre_registration_legal_bundles
  add column if not exists declared_subnational_code text,
  add column if not exists subnational_scope_mode text not null default 'unresolved',
  add column if not exists subnational_scope_evidence_reference jsonb not null default '[]'::jsonb;

alter table public.pre_registration_legal_bundles
  drop constraint if exists pre_registration_legal_bundles_declared_subnational_code_check,
  add constraint pre_registration_legal_bundles_declared_subnational_code_check check (
    declared_subnational_code is null or (
      char_length(declared_subnational_code) between 4 and 32 and
      declared_subnational_code ~ '^[A-Z]{2}-[A-Z0-9-]+$' and
      left(declared_subnational_code,3)=declared_country_code||'-'
    )
  ),
  drop constraint if exists pre_registration_legal_bundles_subnational_scope_mode_check,
  add constraint pre_registration_legal_bundles_subnational_scope_mode_check check (
    subnational_scope_mode in ('unresolved','not_required_with_counsel_evidence','countrywide_notice_counsel_approved','exact_subnational_route')
  ),
  drop constraint if exists pre_registration_legal_bundles_subnational_scope_evidence_reference_check,
  add constraint pre_registration_legal_bundles_subnational_scope_evidence_reference_check check (
    jsonb_typeof(subnational_scope_evidence_reference)='array'
  ),
  drop constraint if exists pre_registration_legal_bundles_subnational_scope_shape_check,
  add constraint pre_registration_legal_bundles_subnational_scope_shape_check check (
    subnational_scope_mode='unresolved' or (
      jsonb_array_length(subnational_scope_evidence_reference)>0 and
      (
        (subnational_scope_mode in ('not_required_with_counsel_evidence','countrywide_notice_counsel_approved') and declared_subnational_code is null) or
        (subnational_scope_mode='exact_subnational_route' and declared_subnational_code is not null)
      )
    )
  );

drop index if exists public.pre_registration_legal_bundle_active_route_uq;
create unique index if not exists pre_registration_legal_bundle_active_route_uq
  on public.pre_registration_legal_bundles(declared_country_code,ui_locale,coalesce(declared_subnational_code,''))
  where status='active';

alter table public.pre_registration_legal_presentations
  add column if not exists declared_subnational_code text,
  add column if not exists subnational_scope_mode text not null default 'unresolved',
  add column if not exists subnational_scope_evidence_sha256 text;

alter table public.pre_registration_legal_presentations
  drop constraint if exists pre_registration_legal_presentations_declared_subnational_code_check,
  add constraint pre_registration_legal_presentations_declared_subnational_code_check check (
    declared_subnational_code is null or (char_length(declared_subnational_code) between 4 and 32 and declared_subnational_code ~ '^[A-Z]{2}-[A-Z0-9-]+$')
  ),
  drop constraint if exists pre_registration_legal_presentations_subnational_scope_mode_check,
  add constraint pre_registration_legal_presentations_subnational_scope_mode_check check (
    subnational_scope_mode in ('not_required_with_counsel_evidence','countrywide_notice_counsel_approved','exact_subnational_route')
  ),
  drop constraint if exists pre_registration_legal_presentations_subnational_scope_evidence_sha256_check,
  add constraint pre_registration_legal_presentations_subnational_scope_evidence_sha256_check check (
    subnational_scope_evidence_sha256 is not null and subnational_scope_evidence_sha256 ~ '^[0-9a-f]{64}$'
  );

create or replace function public.pre_registration_subnational_scope_evidence_sha256(p_bundle_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case
    when b.subnational_scope_mode='unresolved' or jsonb_array_length(b.subnational_scope_evidence_reference)=0 then null
    else encode(extensions.digest(convert_to(jsonb_build_object(
      'preRegistrationBundleId',b.pre_registration_bundle_id::text,
      'declaredCountryCode',b.declared_country_code,
      'declaredSubnationalCode',b.declared_subnational_code,
      'subnationalScopeMode',b.subnational_scope_mode,
      'evidence',b.subnational_scope_evidence_reference
    )::text,'UTF8'),'sha256'),'hex')
  end
  from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=p_bundle_id;
$$;
revoke all on function public.pre_registration_subnational_scope_evidence_sha256(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_subnational_scope_evidence_sha256(uuid) to service_role;

create or replace function public.pre_registration_legal_bundle_current(p_bundle_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1
    from public.pre_registration_legal_bundles b
    join public.legal_jurisdiction_policies p on p.legal_country_code=b.declared_country_code
    where b.pre_registration_bundle_id=p_bundle_id
      and b.status='active'
      and b.reviewed_at<=now() and b.reviewed_at>=now()-interval '90 days'
      and b.effective_at<=now() and b.valid_until>now() and b.valid_until<=b.reviewed_at+interval '90 days'
      and jsonb_array_length(b.source_evidence_reference)>0
      and jsonb_array_length(b.counsel_evidence_reference)>0
      and jsonb_array_length(b.localization_evidence_reference)>0
      and jsonb_array_length(b.subnational_scope_evidence_reference)>0
      and public.legal_document_url_allowed(b.terms_url)
      and public.legal_document_url_allowed(b.privacy_notice_url)
      and public.legal_document_url_allowed(b.community_guidelines_url)
      and p.release_status='approved'
      and p.legal_review_status='approved_by_external_counsel'
      and p.language_review_status='approved'
      and p.legal_reviewed_at is not null and p.legal_reviewed_at<=now()
      and p.next_review_due_at is not null and p.next_review_due_at>now()
      and b.document_locale=any(p.approved_document_locales)
      and (
        (p.subnational_review_required=false and b.subnational_scope_mode='not_required_with_counsel_evidence' and b.declared_subnational_code is null) or
        (p.subnational_review_required=true and b.subnational_scope_mode='countrywide_notice_counsel_approved' and b.declared_subnational_code is null) or
        (p.subnational_review_required=true and b.subnational_scope_mode='exact_subnational_route' and b.declared_subnational_code is not null)
      )
  ),false);
$$;
revoke all on function public.pre_registration_legal_bundle_current(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_legal_bundle_current(uuid) to service_role;

create or replace function public.pre_registration_legal_presentation_sha256(p_bundle_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when not public.pre_registration_legal_bundle_current(p_bundle_id) then null else
    encode(extensions.digest(convert_to(jsonb_build_object(
      'preRegistrationBundleId',b.pre_registration_bundle_id::text,
      'declaredCountryCode',b.declared_country_code,
      'declaredSubnationalCode',b.declared_subnational_code,
      'subnationalScopeMode',b.subnational_scope_mode,
      'subnationalScopeEvidenceSha256',public.pre_registration_subnational_scope_evidence_sha256(b.pre_registration_bundle_id),
      'uiLocale',b.ui_locale,
      'documentLocale',b.document_locale,
      'terms',jsonb_build_array(b.terms_version,b.terms_url,b.terms_sha256),
      'privacy',jsonb_build_array(b.privacy_notice_version,b.privacy_notice_url,b.privacy_notice_sha256),
      'community',jsonb_build_array(b.community_guidelines_version,b.community_guidelines_url,b.community_guidelines_sha256)
    )::text,'UTF8'),'sha256'),'hex') end
  from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=p_bundle_id;
$$;
revoke all on function public.pre_registration_legal_presentation_sha256(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_legal_presentation_sha256(uuid) to service_role;

-- Three-dimensional pre-auth route. If an exact subdivision route exists, it takes precedence and a stale
-- exact route cannot silently fall back to a countrywide route. A null subdivision can only use an approved
-- countrywide/not-required route.
create or replace function public.get_pre_registration_legal_presentation(
  p_declared_country_code text,p_ui_locale text,p_declared_subnational_code text
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_declared_country_code,'')));
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_sub text:=upper(trim(coalesce(p_declared_subnational_code,'')));
  v_bundle public.pre_registration_legal_bundles;
  v_sha text; v_scope_sha text; v_exact_exists boolean:=false;
begin
  if v_country !~ '^[A-Z]{2}$' then return jsonb_build_object('status','blocked_invalid_declared_country'); end if;
  if char_length(v_locale) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale','declaredCountryCode',v_country); end if;
  if v_sub<>'' and (v_sub !~ '^[A-Z]{2}-[A-Z0-9-]+$' or left(v_sub,3)<>v_country||'-' or char_length(v_sub)>32) then
    return jsonb_build_object('status','blocked_invalid_declared_subnational_code','declaredCountryCode',v_country,'uiLocale',v_locale);
  end if;

  if v_sub<>'' then
    select exists(select 1 from public.pre_registration_legal_bundles b
      where b.declared_country_code=v_country and b.ui_locale=v_locale and b.declared_subnational_code=v_sub and b.status='active') into v_exact_exists;
    if v_exact_exists then
      select * into v_bundle from public.pre_registration_legal_bundles b
      where b.declared_country_code=v_country and b.ui_locale=v_locale and b.declared_subnational_code=v_sub and b.status='active'
      order by b.effective_at desc,b.created_at desc limit 1;
      if not found or not public.pre_registration_legal_bundle_current(v_bundle.pre_registration_bundle_id) then
        return jsonb_build_object('status','blocked_pre_registration_exact_subnational_presentation_unavailable','declaredCountryCode',v_country,'declaredSubnationalCode',v_sub,'uiLocale',v_locale);
      end if;
    end if;
  end if;

  if not v_exact_exists then
    select * into v_bundle from public.pre_registration_legal_bundles b
      where b.declared_country_code=v_country and b.ui_locale=v_locale and b.declared_subnational_code is null and b.status='active'
      order by b.effective_at desc,b.created_at desc limit 1;
    if not found then
      if exists(select 1 from public.pre_registration_legal_bundles b where b.declared_country_code=v_country and b.ui_locale=v_locale and b.declared_subnational_code is not null and b.status='active') then
        return jsonb_build_object('status','blocked_pre_registration_subnational_selection_required','declaredCountryCode',v_country,'uiLocale',v_locale);
      end if;
      return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale);
    end if;
    if not public.pre_registration_legal_bundle_current(v_bundle.pre_registration_bundle_id) then
      return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale);
    end if;
  end if;

  v_sha:=public.pre_registration_legal_presentation_sha256(v_bundle.pre_registration_bundle_id);
  v_scope_sha:=public.pre_registration_subnational_scope_evidence_sha256(v_bundle.pre_registration_bundle_id);
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' or v_scope_sha is null or v_scope_sha !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale);
  end if;
  return jsonb_build_object(
    'status','ready',
    'preRegistrationBundleId',v_bundle.pre_registration_bundle_id,
    'declaredCountryCode',v_bundle.declared_country_code,
    'declaredSubnationalCode',v_bundle.declared_subnational_code,
    'subnationalScopeMode',v_bundle.subnational_scope_mode,
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

-- Legacy two-argument caller is safe: it can only resolve a counsel-approved countrywide/not-required route.
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
  v_scope_mode text; v_scope_sha text; v_pre_bundle_id uuid; v_presented_sha text; v_current_sha text; v_current_scope_sha text;
  v_pre public.pre_registration_legal_bundles;
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

  select * into v_pre from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=v_pre_bundle_id;
  if not found or v_pre.declared_country_code<>v_declared_country or v_pre.ui_locale<>v_locale or coalesce(v_pre.declared_subnational_code,'')<>v_declared_subnational or v_pre.subnational_scope_mode<>v_scope_mode then raise exception 'pre_registration_presentation_context_mismatch'; end if;
  if not public.pre_registration_legal_bundle_current(v_pre_bundle_id) then raise exception 'pre_registration_legal_presentation_unavailable'; end if;
  v_current_sha:=public.pre_registration_legal_presentation_sha256(v_pre_bundle_id);
  v_current_scope_sha:=public.pre_registration_subnational_scope_evidence_sha256(v_pre_bundle_id);
  if v_current_sha is null or v_current_sha<>v_presented_sha then raise exception 'pre_registration_legal_presentation_changed'; end if;
  if v_current_scope_sha is null or v_current_scope_sha<>v_scope_sha then raise exception 'pre_registration_subnational_scope_changed'; end if;

  insert into public.users(id,age_18_confirmed,legal_version) values(new.id,false,null) on conflict(id) do nothing;
  insert into public.prelegal_age_attestations(user_id,age_threshold,statement_version,ui_locale,source,attested_at)
    values(new.id,18,v_statement_version,v_locale,'signup_checkbox',now()) on conflict(user_id,statement_version) do nothing;
  insert into public.pre_registration_legal_presentations(
    user_id,pre_registration_bundle_id,declared_country_code,declared_subnational_code,subnational_scope_mode,subnational_scope_evidence_sha256,
    ui_locale,document_locale,presentation_sha256,privacy_notice_sha256,source,presented_at
  ) values(
    new.id,v_pre.pre_registration_bundle_id,v_pre.declared_country_code,v_pre.declared_subnational_code,v_pre.subnational_scope_mode,v_current_scope_sha,
    v_pre.ui_locale,v_pre.document_locale,v_current_sha,v_pre.privacy_notice_sha256,'signup_exact_public_presentation',now()
  ) on conflict(user_id,pre_registration_bundle_id,presentation_sha256) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_auth_user() from public,anon,authenticated;
