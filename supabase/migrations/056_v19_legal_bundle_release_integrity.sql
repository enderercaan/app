-- Tailmance v19 legal bundle release-integrity hardening.
-- Restores pre-v19 MFA/email product gates, requires attributable bundle evidence before a route
-- can become active, and prevents storefront/operational mismatches from becoming jurisdiction.

create or replace function public.enforce_legal_bundle_route_release_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_bundle public.legal_document_bundles;
begin
  if new.route_status='active' then
    if new.current_bundle_id is null or new.effective_at is null or new.effective_at>now() or jsonb_array_length(new.evidence_reference)=0 then
      raise exception 'active_legal_route_requires_current_evidence';
    end if;
    select * into v_bundle from public.legal_document_bundles where bundle_id=new.current_bundle_id;
    if not found then raise exception 'legal_bundle_not_found'; end if;
    if v_bundle.legal_country_code<>new.legal_country_code or coalesce(v_bundle.legal_subnational_code,'')<>new.legal_subnational_code or v_bundle.ui_locale<>new.ui_locale then
      raise exception 'legal_bundle_route_context_mismatch';
    end if;
    if v_bundle.effective_at>now() then raise exception 'legal_bundle_not_effective'; end if;
    if jsonb_array_length(v_bundle.source_evidence_reference)=0 then raise exception 'legal_bundle_official_source_evidence_required'; end if;
    if jsonb_array_length(v_bundle.counsel_evidence_reference)=0 then raise exception 'legal_bundle_counsel_evidence_required'; end if;
    if jsonb_array_length(v_bundle.localization_evidence_reference)=0 then raise exception 'legal_bundle_professional_localization_evidence_required'; end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_legal_bundle_route_release_evidence() from public,anon,authenticated;
drop trigger if exists trg_legal_bundle_route_release_evidence on public.legal_document_bundle_routes;
create trigger trg_legal_bundle_route_release_evidence
before insert or update on public.legal_document_bundle_routes
for each row execute function public.enforce_legal_bundle_route_release_evidence();

-- Replace the country setter with the same evidence model plus a stricter mismatch boundary:
-- storefront/operational country can be evidence, but neither silently replaces legal country.
create or replace function public.service_set_legal_country_runtime(
  p_user_id uuid,
  p_legal_country_code text,
  p_legal_subnational_code text,
  p_resolution_status text,
  p_resolution_source text,
  p_storefront_country_code text,
  p_operational_country_code text,
  p_country_mismatch_reviewed boolean,
  p_evidence_reference jsonb,
  p_resolved_by text,
  p_expires_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_legal_country_code,'')));
  v_subnational text:=upper(trim(coalesce(p_legal_subnational_code,'')));
  v_storefront text:=upper(trim(coalesce(p_storefront_country_code,'')));
  v_operational text:=upper(trim(coalesce(p_operational_country_code,'')));
  v_previous_country text;
  v_previous_subnational text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null then raise exception 'user_required'; end if;
  if p_resolution_status not in ('pending','verified','blocked') then raise exception 'invalid_resolution_status'; end if;
  if p_resolution_source not in ('unresolved','storefront_verified','service_country_verified','identity_verified','manual_legal_review') then raise exception 'invalid_resolution_source'; end if;
  if v_country<>'' and v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_legal_country'; end if;
  if v_subnational<>'' and (char_length(v_subnational)>32 or v_subnational !~ '^[A-Z0-9-]+$') then raise exception 'invalid_legal_subnational'; end if;
  if v_storefront<>'' and v_storefront !~ '^[A-Z]{2}$' then raise exception 'invalid_storefront_country'; end if;
  if v_operational<>'' and v_operational !~ '^[A-Z]{2}$' then raise exception 'invalid_operational_country'; end if;
  if p_resolution_status='verified' and (
    v_country='' or p_resolution_source='unresolved' or nullif(trim(coalesce(p_resolved_by,'')),'') is null or
    p_evidence_reference is null or jsonb_typeof(p_evidence_reference)<>'array' or jsonb_array_length(p_evidence_reference)=0
  ) then raise exception 'verified_country_requires_attributable_evidence'; end if;
  if p_resolution_status='verified' and p_expires_at is not null and p_expires_at<=now() then raise exception 'verified_country_evidence_expired'; end if;
  if p_resolution_status='verified' and public.legal_country_requires_subnational_review(v_country) and v_subnational='' then
    raise exception 'subnational_review_required';
  end if;
  if p_resolution_status='verified' and (
    (v_storefront<>'' and v_storefront<>v_country) or
    (v_operational<>'' and v_operational<>v_country) or
    (v_storefront<>'' and v_operational<>'' and v_storefront<>v_operational)
  ) and p_country_mismatch_reviewed is distinct from true then
    raise exception 'country_mismatch_review_required';
  end if;

  select legal_country_code,legal_subnational_code into v_previous_country,v_previous_subnational
  from public.legal_country_runtime where user_id=p_user_id for update;

  insert into public.legal_country_runtime(
    user_id,legal_country_code,legal_subnational_code,resolution_status,resolution_source,
    storefront_country_code,operational_country_code,country_mismatch_reviewed,evidence_reference,resolved_by,resolved_at,expires_at,updated_at
  ) values(
    p_user_id,nullif(v_country,''),nullif(v_subnational,''),p_resolution_status,p_resolution_source,
    nullif(v_storefront,''),nullif(v_operational,''),coalesce(p_country_mismatch_reviewed,false),coalesce(p_evidence_reference,'[]'::jsonb),
    nullif(trim(coalesce(p_resolved_by,'')),''),case when p_resolution_status='verified' then now() else null end,p_expires_at,now()
  ) on conflict(user_id) do update set
    legal_country_code=excluded.legal_country_code,legal_subnational_code=excluded.legal_subnational_code,
    resolution_status=excluded.resolution_status,resolution_source=excluded.resolution_source,
    storefront_country_code=excluded.storefront_country_code,operational_country_code=excluded.operational_country_code,
    country_mismatch_reviewed=excluded.country_mismatch_reviewed,evidence_reference=excluded.evidence_reference,
    resolved_by=excluded.resolved_by,resolved_at=excluded.resolved_at,expires_at=excluded.expires_at,updated_at=now();

  if v_previous_country is distinct from nullif(v_country,'') or v_previous_subnational is distinct from nullif(v_subnational,'') or p_resolution_status<>'verified' then
    update public.users set legal_version=null,notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),updated_at=now() where id=p_user_id;
  end if;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,'legal_country_runtime_changed','user',p_user_id,jsonb_build_object(
    'previousCountry',v_previous_country,'previousSubnational',v_previous_subnational,'legalCountry',nullif(v_country,''),
    'legalSubnational',nullif(v_subnational,''),'resolutionStatus',p_resolution_status,'resolutionSource',p_resolution_source,
    'storefrontCountry',nullif(v_storefront,''),'operationalCountry',nullif(v_operational,''),'countryMismatchReviewed',coalesce(p_country_mismatch_reviewed,false)
  ));
  return jsonb_build_object('ok',true,'legalCountryCode',nullif(v_country,''),'legalSubnationalCode',nullif(v_subnational,''),'resolutionStatus',p_resolution_status);
end $$;
revoke all on function public.service_set_legal_country_runtime(uuid,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_set_legal_country_runtime(uuid,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) to service_role;

create or replace function public.resolve_current_legal_bundle_id(p_user_id uuid,p_ui_locale text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_runtime public.legal_country_runtime;v_locale text:=trim(coalesce(p_ui_locale,''));v_bundle_id uuid;
begin
  if p_user_id is null or char_length(v_locale) not between 2 and 16 then return null; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return null; end if;
  if v_runtime.expires_at is not null and v_runtime.expires_at<=now() then return null; end if;
  if public.legal_country_requires_subnational_review(v_runtime.legal_country_code) and v_runtime.legal_subnational_code is null then return null; end if;
  if ((v_runtime.storefront_country_code is not null and v_runtime.storefront_country_code<>v_runtime.legal_country_code) or
      (v_runtime.operational_country_code is not null and v_runtime.operational_country_code<>v_runtime.legal_country_code))
      and v_runtime.country_mismatch_reviewed is distinct from true then return null; end if;

  select r.current_bundle_id into v_bundle_id
  from public.legal_document_bundle_routes r
  join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
  where r.legal_country_code=v_runtime.legal_country_code
    and r.legal_subnational_code=case when public.legal_country_requires_subnational_review(v_runtime.legal_country_code) then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now()
    and jsonb_array_length(r.evidence_reference)>0
    and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code
    and b.ui_locale=r.ui_locale and b.effective_at<=now()
    and jsonb_array_length(b.source_evidence_reference)>0
    and jsonb_array_length(b.counsel_evidence_reference)>0
    and jsonb_array_length(b.localization_evidence_reference)>0
  limit 1;
  return v_bundle_id;
end $$;
revoke all on function public.resolve_current_legal_bundle_id(uuid,text) from public,anon,authenticated;

-- Locale changes keep legal country but deliberately invalidate the user's current acceptance state.
create or replace function public.update_preferred_locale(p_locale text)
returns void language plpgsql security definer set search_path='' as $$
declare v_old text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if p_locale not in ('en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi') then raise exception 'unsupported_locale'; end if;
  perform public.rate_limit('preferred_locale',30,3600);
  select preferred_locale into v_old from public.users where id=auth.uid() for update;
  update public.users set preferred_locale=p_locale,
    legal_version=case when v_old is distinct from p_locale then null else legal_version end,
    notification_preferences=case when v_old is distinct from p_locale then jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true) else notification_preferences end,
    updated_at=now() where id=auth.uid();
end $$;
revoke all on function public.update_preferred_locale(text) from public,anon;
grant execute on function public.update_preferred_locale(text) to authenticated;

create or replace function public.current_user_has_product_access()
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_session_satisfies_mfa_if_enrolled() and exists(
    select 1 from public.users u
    join auth.users au on au.id=u.id and au.email_confirmed_at is not null
    join public.app_security_config c on c.singleton=true
    join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
    where u.id=auth.uid() and u.suspended_at is null and u.paused_at is null and u.age_18_confirmed=true
      and u.legal_version=b.legal_version and b.legal_version=c.current_legal_version and b.terms_version=c.current_terms_version
      and b.community_guidelines_version=c.current_community_guidelines_version and b.privacy_notice_version=c.current_privacy_notice_version
      and exists(select 1 from public.legal_acceptances a where a.user_id=u.id and a.bundle_id=b.bundle_id and a.legal_version=b.legal_version and a.terms_version=b.terms_version and a.community_guidelines_version=b.community_guidelines_version and a.terms_sha256=b.terms_sha256 and a.community_guidelines_sha256=b.community_guidelines_sha256 and a.accepted_ui_locale=b.ui_locale and a.accepted_country_code=b.legal_country_code and coalesce(a.accepted_subnational_code,'')=coalesce(b.legal_subnational_code,'') and a.document_locale=b.document_locale)
      and exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.bundle_id=b.bundle_id and p.notice_version=b.privacy_notice_version and p.notice_sha256=b.privacy_notice_sha256 and p.locale=b.ui_locale and p.country_code=b.legal_country_code and coalesce(p.legal_subnational_code,'')=coalesce(b.legal_subnational_code,'') and p.document_locale=b.document_locale)
  );
$$;
revoke all on function public.current_user_has_product_access() from public,anon,authenticated;
grant execute on function public.current_user_has_product_access() to service_role;

create or replace function public.service_product_access_user_ids(p_user_ids uuid[])
returns table(user_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_ids is null or cardinality(p_user_ids)=0 then return; end if;
  if cardinality(p_user_ids)>200 then raise exception 'too_many_user_ids'; end if;
  return query
  select u.id from public.users u
  join auth.users au on au.id=u.id and au.email_confirmed_at is not null
  join public.app_security_config c on c.singleton=true
  join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
  where u.id=any(p_user_ids) and u.suspended_at is null and u.paused_at is null and u.age_18_confirmed=true
    and u.legal_version=b.legal_version and b.legal_version=c.current_legal_version and b.terms_version=c.current_terms_version
    and b.community_guidelines_version=c.current_community_guidelines_version and b.privacy_notice_version=c.current_privacy_notice_version
    and exists(select 1 from public.legal_acceptances a where a.user_id=u.id and a.bundle_id=b.bundle_id and a.terms_sha256=b.terms_sha256 and a.community_guidelines_sha256=b.community_guidelines_sha256)
    and exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.bundle_id=b.bundle_id and p.notice_sha256=b.privacy_notice_sha256);
end $$;
revoke all on function public.service_product_access_user_ids(uuid[]) from public,anon,authenticated;
grant execute on function public.service_product_access_user_ids(uuid[]) to service_role;

-- Keep bootstrap settings readable before acceptance, but expose exact context so UI cannot pretend
-- a language choice is jurisdiction. Raw evidence_reference is intentionally not returned.
create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,'incognito',u.incognito,
    'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,'measurementSystem',u.measurement_system,
    'legalContextCurrent',public.current_user_has_product_access(),'legalBundleAccepted',public.current_user_has_product_access(),
    'legalBundleId',public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en')),
    'legalCountry',r.legal_country_code,'legalCountryCode',r.legal_country_code,'legalSubnationalCode',r.legal_subnational_code,
    'legalCountryVerificationStatus',coalesce(r.resolution_status,'pending'),'legalCountryExpiresAt',r.expires_at,
    'legalUiLocale',b.ui_locale,'legalDocumentLocale',b.document_locale,
    'privacyNoticeVersion',(select p.notice_version from public.privacy_notice_acknowledgements p where p.user_id=u.id order by p.acknowledged_at desc,p.id desc limit 1),
    'marketingConsentVersion',(select e.consent_version from public.marketing_consent_events e where e.user_id=u.id and e.channel='push' and e.purpose='marketing_product_updates' order by e.created_at desc,e.id desc limit 1),
    'notificationPreferences',jsonb_set(('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb||coalesce(u.notification_preferences,'{}'::jsonb)),'{marketing}',to_jsonb(coalesce((select e.granted from public.marketing_consent_events e where e.user_id=u.id and e.bundle_id=b.bundle_id and e.channel='push' and e.purpose='marketing_product_updates' order by e.created_at desc,e.id desc limit 1),false)),true)
  ) from public.users u
  left join public.legal_country_runtime r on r.user_id=u.id
  left join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
  where u.id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;

-- Explicit table privilege posture. No client role can enumerate legal-country evidence or bundles.
revoke all on table public.legal_document_bundles,public.legal_document_bundle_routes,public.legal_country_runtime from public,anon,authenticated;
grant select,insert on table public.legal_document_bundles to service_role;
grant select,insert,update on table public.legal_document_bundle_routes to service_role;
grant select,insert,update,delete on table public.legal_country_runtime to service_role;
