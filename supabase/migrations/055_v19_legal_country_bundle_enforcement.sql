-- Tailmance v19 enforcement for country + UI locale + immutable legal bundle evidence.
-- This migration deliberately invalidates legacy acceptance rows as current-access evidence.

-- Turn legal acceptance into an append-only event log. Historical rows remain, but only rows
-- linked to a current immutable bundle can satisfy product access.
alter table public.legal_acceptances drop constraint if exists legal_acceptances_pkey;
alter table public.legal_acceptances add column if not exists id bigint generated always as identity;
alter table public.legal_acceptances add column if not exists bundle_id uuid references public.legal_document_bundles(bundle_id) on delete restrict;
alter table public.legal_acceptances add column if not exists document_locale text;
alter table public.legal_acceptances add column if not exists terms_sha256 text;
alter table public.legal_acceptances add column if not exists community_guidelines_sha256 text;
alter table public.legal_acceptances add column if not exists accepted_ui_locale text;
alter table public.legal_acceptances add column if not exists accepted_country_code text;
alter table public.legal_acceptances add column if not exists accepted_subnational_code text;
alter table public.legal_acceptances add constraint legal_acceptances_pkey primary key(id);
create index if not exists legal_acceptances_user_bundle_latest_idx on public.legal_acceptances(user_id,bundle_id,accepted_at desc,id desc);

alter table public.privacy_notice_acknowledgements drop constraint if exists privacy_notice_acknowledgements_user_id_notice_version_key;
alter table public.privacy_notice_acknowledgements add column if not exists bundle_id uuid references public.legal_document_bundles(bundle_id) on delete restrict;
alter table public.privacy_notice_acknowledgements add column if not exists document_locale text;
alter table public.privacy_notice_acknowledgements add column if not exists notice_sha256 text;
alter table public.privacy_notice_acknowledgements add column if not exists legal_subnational_code text;
create index if not exists privacy_ack_user_bundle_latest_idx on public.privacy_notice_acknowledgements(user_id,bundle_id,acknowledged_at desc,id desc);

alter table public.marketing_consent_events add column if not exists bundle_id uuid references public.legal_document_bundles(bundle_id) on delete restrict;
alter table public.marketing_consent_events add column if not exists document_locale text;
alter table public.marketing_consent_events add column if not exists consent_text_sha256 text;
alter table public.marketing_consent_events add column if not exists legal_subnational_code text;
create index if not exists marketing_consent_events_bundle_latest_idx
  on public.marketing_consent_events(user_id,bundle_id,channel,purpose,created_at desc,id desc);

create or replace function public.prevent_append_only_legal_event_update()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then raise exception 'append_only_legal_evidence'; end if;
  if tg_op='DELETE' and auth.role()<>'service_role' then raise exception 'append_only_legal_evidence'; end if;
  return old;
end $$;
revoke all on function public.prevent_append_only_legal_event_update() from public,anon,authenticated;

drop trigger if exists trg_legal_acceptances_append_only on public.legal_acceptances;
create trigger trg_legal_acceptances_append_only before update or delete on public.legal_acceptances for each row execute function public.prevent_append_only_legal_event_update();
drop trigger if exists trg_privacy_notice_acknowledgements_append_only on public.privacy_notice_acknowledgements;
create trigger trg_privacy_notice_acknowledgements_append_only before update or delete on public.privacy_notice_acknowledgements for each row execute function public.prevent_append_only_legal_event_update();
drop trigger if exists trg_marketing_consent_events_append_only on public.marketing_consent_events;
create trigger trg_marketing_consent_events_append_only before update or delete on public.marketing_consent_events for each row execute function public.prevent_append_only_legal_event_update();

-- Jurisdictions where this source audit has identified a mandatory subnational review layer.
-- This is a conservative runtime safety pin, not a substitute for the release registry/counsel matrix.
create or replace function public.legal_country_requires_subnational_review(p_country text)
returns boolean language sql immutable security definer set search_path='' as $$
  select upper(trim(coalesce(p_country,''))) in ('AE','AU','BE','CA','CN','IT','US');
$$;
revoke all on function public.legal_country_requires_subnational_review(text) from public,anon,authenticated;

create or replace function public.resolve_current_legal_bundle_id(p_user_id uuid,p_ui_locale text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare
  v_runtime public.legal_country_runtime;
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_bundle_id uuid;
begin
  if p_user_id is null then return null; end if;
  if char_length(v_locale) not between 2 and 16 then return null; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return null; end if;
  if v_runtime.expires_at is not null and v_runtime.expires_at<=now() then return null; end if;
  if public.legal_country_requires_subnational_review(v_runtime.legal_country_code) and v_runtime.legal_subnational_code is null then return null; end if;

  select r.current_bundle_id into v_bundle_id
  from public.legal_document_bundle_routes r
  join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
  where r.legal_country_code=v_runtime.legal_country_code
    and r.legal_subnational_code=case when public.legal_country_requires_subnational_review(v_runtime.legal_country_code) then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale
    and r.route_status='active'
    and r.effective_at is not null and r.effective_at<=now()
    and b.legal_country_code=r.legal_country_code
    and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code
    and b.ui_locale=r.ui_locale
    and b.effective_at<=now()
  limit 1;
  return v_bundle_id;
end $$;
revoke all on function public.resolve_current_legal_bundle_id(uuid,text) from public,anon,authenticated;

create or replace function public.get_current_legal_context(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();
  v_runtime public.legal_country_runtime;
  v_bundle public.legal_document_bundles;
  v_bundle_id uuid;
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_accepted boolean:=false;
  v_privacy_ack boolean:=false;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(v_locale) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale'); end if;

  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then
    return jsonb_build_object('status','blocked_legal_country_unresolved');
  end if;
  if v_runtime.expires_at is not null and v_runtime.expires_at<=now() then
    return jsonb_build_object('status','blocked_legal_country_evidence_expired','legalCountryCode',v_runtime.legal_country_code);
  end if;
  if public.legal_country_requires_subnational_review(v_runtime.legal_country_code) and v_runtime.legal_subnational_code is null then
    return jsonb_build_object('status','blocked_subnational_review_required','legalCountryCode',v_runtime.legal_country_code);
  end if;

  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then
    return jsonb_build_object(
      'status','blocked_legal_bundle_missing',
      'legalCountryCode',v_runtime.legal_country_code,
      'legalSubnationalCode',v_runtime.legal_subnational_code,
      'uiLocale',v_locale
    );
  end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;

  select exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id) into v_accepted;
  select exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=v_user_id and p.bundle_id=v_bundle_id) into v_privacy_ack;

  return jsonb_build_object(
    'status','ready',
    'accepted',v_accepted and v_privacy_ack,
    'bundleId',v_bundle.bundle_id,
    'legalCountryCode',v_bundle.legal_country_code,
    'legalSubnationalCode',v_bundle.legal_subnational_code,
    'uiLocale',v_bundle.ui_locale,
    'documentLocale',v_bundle.document_locale,
    'legalVersion',v_bundle.legal_version,
    'termsVersion',v_bundle.terms_version,
    'communityGuidelinesVersion',v_bundle.community_guidelines_version,
    'privacyNoticeVersion',v_bundle.privacy_notice_version,
    'marketingPushConsentVersion',v_bundle.marketing_push_consent_version,
    'termsUrl',v_bundle.terms_url,
    'communityGuidelinesUrl',v_bundle.community_guidelines_url,
    'privacyNoticeUrl',v_bundle.privacy_notice_url,
    'marketingPushConsentUrl',v_bundle.marketing_push_consent_url
  );
end $$;
revoke all on function public.get_current_legal_context(text) from public,anon;
grant execute on function public.get_current_legal_context(text) to authenticated;

-- Supersede the v19 global-version RPC. Acceptance is now against one exact current bundle and is
-- append-only; country and locale are derived/validated against server-side runtime evidence.
-- Executed-Postgres verification fix (2026-10-03): PL/pgSQL ends an IF condition at the first THEN it
-- sees, so an unparenthesized CASE ... THEN inside the condition is a syntax error on a real server.
create or replace function public.accept_current_legal_bundle(
  p_user_id uuid,
  p_bundle_id uuid,
  p_ui_locale text,
  p_age_18_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_bundle public.legal_document_bundles;
  v_runtime public.legal_country_runtime;
  v_current_bundle_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null or p_age_18_confirmed is distinct from true then raise exception 'age_confirmation_required'; end if;
  if p_bundle_id is null then raise exception 'legal_bundle_required'; end if;
  if char_length(trim(coalesce(p_ui_locale,''))) not between 2 and 16 then raise exception 'invalid_locale'; end if;
  if not exists(select 1 from auth.users au where au.id=p_user_id and au.email_confirmed_at is not null) then
    raise exception 'email_verification_required_before_legal_acceptance';
  end if;

  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then raise exception 'legal_country_unresolved'; end if;
  if v_runtime.expires_at is not null and v_runtime.expires_at<=now() then raise exception 'legal_country_evidence_expired'; end if;
  if public.legal_country_requires_subnational_review(v_runtime.legal_country_code) and v_runtime.legal_subnational_code is null then raise exception 'subnational_review_required'; end if;

  v_current_bundle_id:=public.resolve_current_legal_bundle_id(p_user_id,trim(p_ui_locale));
  if v_current_bundle_id is null or v_current_bundle_id<>p_bundle_id then raise exception 'legal_bundle_not_current_for_context'; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=p_bundle_id;
  if not found then raise exception 'legal_bundle_not_found'; end if;
  if v_bundle.legal_country_code<>v_runtime.legal_country_code or
     coalesce(v_bundle.legal_subnational_code,'')<>(case when public.legal_country_requires_subnational_review(v_runtime.legal_country_code) then coalesce(v_runtime.legal_subnational_code,'') else '' end) or
     v_bundle.ui_locale<>trim(p_ui_locale) then raise exception 'legal_bundle_context_mismatch'; end if;

  update public.users
  set age_18_confirmed=true,legal_version=v_bundle.legal_version,preferred_locale=v_bundle.ui_locale,updated_at=now()
  where id=p_user_id;
  if not found then raise exception 'user_profile_not_found'; end if;

  insert into public.legal_acceptances(
    user_id,legal_version,terms_version,community_guidelines_version,locale,country_code,accepted_source,accepted_at,
    bundle_id,document_locale,terms_sha256,community_guidelines_sha256,accepted_ui_locale,accepted_country_code,accepted_subnational_code
  ) values(
    p_user_id,v_bundle.legal_version,v_bundle.terms_version,v_bundle.community_guidelines_version,v_bundle.ui_locale,v_bundle.legal_country_code,
    'verified_session_immutable_bundle',now(),v_bundle.bundle_id,v_bundle.document_locale,v_bundle.terms_sha256,v_bundle.community_guidelines_sha256,
    v_bundle.ui_locale,v_bundle.legal_country_code,v_bundle.legal_subnational_code
  );

  insert into public.privacy_notice_acknowledgements(
    user_id,notice_version,locale,country_code,acknowledged_source,acknowledged_at,bundle_id,document_locale,notice_sha256,legal_subnational_code
  ) values(
    p_user_id,v_bundle.privacy_notice_version,v_bundle.ui_locale,v_bundle.legal_country_code,'verified_session_immutable_bundle',now(),
    v_bundle.bundle_id,v_bundle.document_locale,v_bundle.privacy_notice_sha256,v_bundle.legal_subnational_code
  );

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,'legal_bundle_accepted','legal_document_bundle',v_bundle.bundle_id,jsonb_build_object(
    'bundleId',v_bundle.bundle_id,'legalCountry',v_bundle.legal_country_code,'legalSubnational',v_bundle.legal_subnational_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'legalVersion',v_bundle.legal_version,
    'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,
    'privacyNoticeVersion',v_bundle.privacy_notice_version,'privacyNoticeIsConsent',false
  ));

  return jsonb_build_object(
    'ok',true,'age18Confirmed',true,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
    'legalSubnationalCode',v_bundle.legal_subnational_code,'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,
    'legalVersion',v_bundle.legal_version,'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,
    'privacyNoticeVersion',v_bundle.privacy_notice_version,'marketingPushConsentVersion',v_bundle.marketing_push_consent_version
  );
end $$;
revoke all on function public.accept_current_legal_bundle(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.accept_current_legal_bundle(uuid,uuid,text,boolean) to service_role;

-- Keep the earlier signature disabled so stale Edge callers cannot overwrite or detach evidence.
-- Executed-Postgres verification fix (2026-10-03): CREATE OR REPLACE cannot change this function's
-- result row type or parameter names on a real PostgreSQL server; drop the prior signature first.
drop function if exists public.accept_current_legal_bundle(uuid,text,text,text,boolean,text,text);
create or replace function public.accept_current_legal_bundle(uuid,text,text,text,boolean,text,text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'legacy_legal_bundle_signature_disabled';
end $$;
revoke all on function public.accept_current_legal_bundle(uuid,text,text,text,boolean,text,text) from public,anon,authenticated;

create or replace function public.current_user_has_product_access()
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from public.users u
    where u.id=auth.uid()
      and u.suspended_at is null and u.paused_at is null and u.age_18_confirmed=true
      and public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en')) is not null
      and exists(
        select 1 from public.legal_acceptances a
        where a.user_id=u.id and a.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
      )
      and exists(
        select 1 from public.privacy_notice_acknowledgements p
        where p.user_id=u.id and p.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
      )
  );
$$;
revoke all on function public.current_user_has_product_access() from public,anon,authenticated;

create or replace function public.set_marketing_push_consent(
  p_granted boolean,
  p_consent_version text,
  p_locale text default null,
  p_country_code text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();
  v_locale text:=trim(coalesce(p_locale,''));
  v_bundle_id uuid;
  v_bundle public.legal_document_bundles;
  v_runtime public.legal_country_runtime;
  v_preferences jsonb;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if p_granted is null then raise exception 'invalid_consent_value'; end if;
  if char_length(v_locale) not between 2 and 16 then raise exception 'invalid_locale'; end if;
  perform public.rate_limit('marketing_push_consent',20,3600);

  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id;
  if not found or v_runtime.resolution_status<>'verified' then raise exception 'legal_country_unresolved'; end if;
  if p_country_code is not null and upper(trim(p_country_code))<>v_runtime.legal_country_code then raise exception 'client_country_mismatch'; end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then raise exception 'legal_bundle_not_current_for_context'; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  if p_consent_version is distinct from v_bundle.marketing_push_consent_version then raise exception 'outdated_marketing_consent_version'; end if;
  if p_granted and not exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id) then
    raise exception 'current_legal_acceptance_required';
  end if;

  insert into public.marketing_consent_events(
    user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,consent_text_sha256,legal_subnational_code
  ) values(
    v_user_id,'push','marketing_product_updates',v_bundle.marketing_push_consent_version,p_granted,v_bundle.ui_locale,v_bundle.legal_country_code,
    'settings_immutable_bundle',v_bundle.bundle_id,v_bundle.document_locale,v_bundle.marketing_push_consent_sha256,v_bundle.legal_subnational_code
  );

  update public.users
  set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}',to_jsonb(p_granted),true),updated_at=now()
  where id=v_user_id
  returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(v_user_id,case when p_granted then 'marketing_push_consent_granted' else 'marketing_push_consent_withdrawn' end,'legal_document_bundle',v_bundle.bundle_id,
    jsonb_build_object('channel','push','purpose','marketing_product_updates','bundleId',v_bundle.bundle_id,'consentVersion',v_bundle.marketing_push_consent_version,
      'consentTextSha256',v_bundle.marketing_push_consent_sha256,'legalCountry',v_bundle.legal_country_code,'legalSubnational',v_bundle.legal_subnational_code,
      'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale));

  return jsonb_build_object('ok',true,'granted',p_granted,'channel','push','purpose','marketing_product_updates',
    'consentVersion',v_bundle.marketing_push_consent_version,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'notificationPreferences',v_preferences);
end $$;
revoke all on function public.set_marketing_push_consent(boolean,text,text,text) from public,anon;
grant execute on function public.set_marketing_push_consent(boolean,text,text,text) to authenticated;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,
    'incognito',u.incognito,'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,'measurementSystem',u.measurement_system,
    'legalContextCurrent',public.current_user_has_product_access(),
    'legalBundleId',public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en')),
    'legalCountryCode',(select r.legal_country_code from public.legal_country_runtime r where r.user_id=u.id and r.resolution_status='verified'),
    'legalSubnationalCode',(select r.legal_subnational_code from public.legal_country_runtime r where r.user_id=u.id and r.resolution_status='verified'),
    'privacyNoticeVersion',(select p.notice_version from public.privacy_notice_acknowledgements p where p.user_id=u.id order by p.acknowledged_at desc,p.id desc limit 1),
    'marketingConsentVersion',(select e.consent_version from public.marketing_consent_events e where e.user_id=u.id and e.channel='push' and e.purpose='marketing_product_updates' order by e.created_at desc,e.id desc limit 1),
    'notificationPreferences',jsonb_set(
      ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(u.notification_preferences,'{}'::jsonb)),
      '{marketing}',
      to_jsonb(coalesce((select e.granted from public.marketing_consent_events e
        where e.user_id=u.id and e.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
          and e.channel='push' and e.purpose='marketing_product_updates'
        order by e.created_at desc,e.id desc limit 1),false)),true)
  ) from public.users u
  where u.id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;
