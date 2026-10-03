-- Tailmance v19 legal evidence: separate binding contract acceptance, privacy/KVKK notice
-- acknowledgement, and optional versioned marketing-push consent. These records are not
-- interchangeable and marketing consent is append-only/auditable.

alter table public.app_security_config
  add column if not exists current_terms_version text,
  add column if not exists current_community_guidelines_version text,
  add column if not exists current_privacy_notice_version text,
  add column if not exists current_marketing_push_consent_version text;

update public.app_security_config
set current_terms_version=coalesce(current_terms_version,current_legal_version),
    current_community_guidelines_version=coalesce(current_community_guidelines_version,current_legal_version),
    current_privacy_notice_version=coalesce(current_privacy_notice_version,current_legal_version),
    current_marketing_push_consent_version=coalesce(current_marketing_push_consent_version,'2026-09-28-v19')
where singleton=true;

alter table public.app_security_config alter column current_terms_version set not null;
alter table public.app_security_config alter column current_community_guidelines_version set not null;
alter table public.app_security_config alter column current_privacy_notice_version set not null;
alter table public.app_security_config alter column current_marketing_push_consent_version set not null;

alter table public.legal_acceptances
  add column if not exists terms_version text,
  add column if not exists community_guidelines_version text,
  add column if not exists locale text,
  add column if not exists country_code text,
  add column if not exists accepted_source text;

update public.legal_acceptances
set terms_version=coalesce(terms_version,legal_version),
    community_guidelines_version=coalesce(community_guidelines_version,legal_version),
    accepted_source=coalesce(accepted_source,'legacy_authenticated_reconsent')
where terms_version is null or community_guidelines_version is null or accepted_source is null;

alter table public.legal_acceptances alter column terms_version set not null;
alter table public.legal_acceptances alter column community_guidelines_version set not null;
alter table public.legal_acceptances alter column accepted_source set not null;

create table if not exists public.privacy_notice_acknowledgements (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_version text not null check (char_length(notice_version) between 1 and 64),
  locale text check (locale is null or char_length(locale) between 2 and 16),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  acknowledged_source text not null default 'legal_onboarding' check (char_length(acknowledged_source) between 1 and 64),
  acknowledged_at timestamptz not null default now(),
  unique(user_id,notice_version)
);
alter table public.privacy_notice_acknowledgements enable row level security;
revoke all on table public.privacy_notice_acknowledgements from public,anon,authenticated;

create table if not exists public.marketing_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel='push'),
  purpose text not null check (purpose='marketing_product_updates'),
  consent_version text not null check (char_length(consent_version) between 1 and 64),
  granted boolean not null,
  locale text check (locale is null or char_length(locale) between 2 and 16),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  source text not null default 'settings' check (char_length(source) between 1 and 64),
  created_at timestamptz not null default now()
);
create index if not exists marketing_consent_events_user_latest_idx
  on public.marketing_consent_events(user_id,channel,purpose,created_at desc,id desc);
alter table public.marketing_consent_events enable row level security;
revoke all on table public.marketing_consent_events from public,anon,authenticated;

-- Pre-v19 generic `marketing=true` values are preferences, not valid explicit consent evidence.
-- Fail closed and require a fresh, versioned consent event.
update public.users
set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),
    updated_at=now()
where coalesce((notification_preferences->>'marketing')::boolean,false)=true;

create or replace function public.reset_marketing_consent_on_version_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.current_marketing_push_consent_version is distinct from new.current_marketing_push_consent_version then
    update public.users
      set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),
          updated_at=now();
  end if;
  return new;
end $$;
revoke all on function public.reset_marketing_consent_on_version_change() from public,anon,authenticated;
drop trigger if exists trg_reset_marketing_consent_on_version_change on public.app_security_config;
create trigger trg_reset_marketing_consent_on_version_change
after update of current_marketing_push_consent_version on public.app_security_config
for each row execute function public.reset_marketing_consent_on_version_change();

create or replace function public.accept_current_legal_bundle(
  p_user_id uuid,
  p_terms_version text,
  p_community_guidelines_version text,
  p_privacy_notice_version text,
  p_age_18_confirmed boolean,
  p_locale text default null,
  p_country_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_config public.app_security_config;
  v_email_confirmed_at timestamptz;
  v_country text:=case when p_country_code is null then null else upper(trim(p_country_code)) end;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null or p_age_18_confirmed is distinct from true then raise exception 'age_confirmation_required'; end if;
  if p_locale is not null and char_length(trim(p_locale)) not between 2 and 16 then raise exception 'invalid_locale'; end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_country_code'; end if;

  select * into v_config from public.app_security_config where singleton=true;
  if v_config.current_terms_version is null or v_config.current_community_guidelines_version is null or v_config.current_privacy_notice_version is null then
    raise exception 'server_legal_versions_not_configured';
  end if;
  if p_terms_version is distinct from v_config.current_terms_version then raise exception 'outdated_terms_version'; end if;
  if p_community_guidelines_version is distinct from v_config.current_community_guidelines_version then raise exception 'outdated_community_version'; end if;
  if p_privacy_notice_version is distinct from v_config.current_privacy_notice_version then raise exception 'outdated_privacy_notice_version'; end if;

  select email_confirmed_at into v_email_confirmed_at from auth.users where id=p_user_id;
  if not found then raise exception 'user_not_found'; end if;
  if v_email_confirmed_at is null then raise exception 'email_verification_required_before_legal_acceptance'; end if;

  update public.users
  set age_18_confirmed=true,legal_version=v_config.current_legal_version,updated_at=now()
  where id=p_user_id;
  if not found then raise exception 'user_profile_not_found'; end if;

  insert into public.legal_acceptances(
    user_id,legal_version,terms_version,community_guidelines_version,locale,country_code,accepted_source,accepted_at
  ) values(
    p_user_id,v_config.current_legal_version,v_config.current_terms_version,v_config.current_community_guidelines_version,
    nullif(trim(p_locale),''),v_country,'verified_session_legal_onboarding',now()
  ) on conflict(user_id,legal_version) do update set
    terms_version=excluded.terms_version,
    community_guidelines_version=excluded.community_guidelines_version,
    locale=excluded.locale,
    country_code=excluded.country_code,
    accepted_source=excluded.accepted_source,
    accepted_at=excluded.accepted_at;

  insert into public.privacy_notice_acknowledgements(user_id,notice_version,locale,country_code,acknowledged_source,acknowledged_at)
  values(p_user_id,v_config.current_privacy_notice_version,nullif(trim(p_locale),''),v_country,'verified_session_legal_onboarding',now())
  on conflict(user_id,notice_version) do update set
    locale=excluded.locale,country_code=excluded.country_code,acknowledged_source=excluded.acknowledged_source,acknowledged_at=excluded.acknowledged_at;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,'legal_bundle_accepted','user',p_user_id,jsonb_build_object(
    'termsVersion',v_config.current_terms_version,
    'communityGuidelinesVersion',v_config.current_community_guidelines_version,
    'privacyNoticeAcknowledgedVersion',v_config.current_privacy_notice_version,
    'privacyNoticeIsConsent',false,
    'locale',p_locale,'countryCode',v_country
  ));

  return jsonb_build_object(
    'ok',true,'age18Confirmed',true,'legalVersion',v_config.current_legal_version,
    'termsVersion',v_config.current_terms_version,
    'communityGuidelinesVersion',v_config.current_community_guidelines_version,
    'privacyNoticeVersion',v_config.current_privacy_notice_version
  );
end;
$$;
revoke all on function public.accept_current_legal_bundle(uuid,text,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.accept_current_legal_bundle(uuid,text,text,text,boolean,text,text) to service_role;

-- Disable the v18 service RPC so an old caller cannot bypass the separate privacy-notice evidence model.
create or replace function public.accept_current_legal_terms(p_user_id uuid,p_legal_version text,p_age_18_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  raise exception 'legacy_legal_acceptance_api_disabled';
end $$;
revoke all on function public.accept_current_legal_terms(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.accept_current_legal_terms(uuid,text,boolean) to service_role;

create or replace function public.set_marketing_push_consent(
  p_granted boolean,
  p_consent_version text,
  p_locale text default null,
  p_country_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_current text;
  v_country text:=case when p_country_code is null then null else upper(trim(p_country_code)) end;
  v_preferences jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if p_granted is null then raise exception 'invalid_consent_value'; end if;
  if p_locale is not null and char_length(trim(p_locale)) not between 2 and 16 then raise exception 'invalid_locale'; end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_country_code'; end if;
  select current_marketing_push_consent_version into v_current from public.app_security_config where singleton=true;
  if v_current is null then raise exception 'marketing_consent_version_not_configured'; end if;
  if p_consent_version is distinct from v_current then raise exception 'outdated_marketing_consent_version'; end if;
  perform public.rate_limit('marketing_push_consent',20,3600);

  insert into public.marketing_consent_events(user_id,channel,purpose,consent_version,granted,locale,country_code,source)
  values(auth.uid(),'push','marketing_product_updates',v_current,p_granted,nullif(trim(p_locale),''),v_country,'settings');

  update public.users
  set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}',to_jsonb(p_granted),true),updated_at=now()
  where id=auth.uid()
  returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;
  if not found then raise exception 'user_not_found'; end if;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),case when p_granted then 'marketing_push_consent_granted' else 'marketing_push_consent_withdrawn' end,'user',auth.uid(),
    jsonb_build_object('channel','push','purpose','marketing_product_updates','consentVersion',v_current,'locale',p_locale,'countryCode',v_country));

  return jsonb_build_object('ok',true,'granted',p_granted,'channel','push','purpose','marketing_product_updates','consentVersion',v_current,'notificationPreferences',v_preferences);
end;
$$;
revoke all on function public.set_marketing_push_consent(boolean,text,text,text) from public,anon;
grant execute on function public.set_marketing_push_consent(boolean,text,text,text) to authenticated;

-- Generic notification preferences cannot create or withdraw legal marketing consent.
-- `marketing` is derived from the authoritative current-version consent evidence.
create or replace function public.update_notification_preferences(p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_allowed jsonb;
  v_start integer;
  v_end integer;
  v_timezone text;
  v_marketing boolean:=false;
  v_current_consent_version text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if p_preferences is null or jsonb_typeof(p_preferences)<>'object' then raise exception 'invalid_notification_preferences'; end if;
  perform public.rate_limit('notification_preferences',30,3600);
  begin v_start:=coalesce((p_preferences->>'quietStartMinutes')::integer,1320); exception when others then raise exception 'invalid_quiet_hours'; end;
  begin v_end:=coalesce((p_preferences->>'quietEndMinutes')::integer,480); exception when others then raise exception 'invalid_quiet_hours'; end;
  v_timezone:=coalesce(nullif(trim(p_preferences->>'timeZone'),''),'UTC');
  if char_length(v_timezone)>64 then raise exception 'invalid_timezone'; end if;
  if v_start<0 or v_start>1439 or v_end<0 or v_end>1439 or v_start=v_end then raise exception 'invalid_quiet_hours'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then raise exception 'invalid_timezone'; end if;

  select current_marketing_push_consent_version into v_current_consent_version from public.app_security_config where singleton=true;
  select coalesce((select e.granted
    from public.marketing_consent_events e
    where e.user_id=auth.uid() and e.channel='push' and e.purpose='marketing_product_updates' and e.consent_version=v_current_consent_version
    order by e.created_at desc,e.id desc limit 1),false) into v_marketing;

  v_allowed := jsonb_build_object(
    'matches',coalesce((p_preferences->>'matches')::boolean,true),
    'messages',coalesce((p_preferences->>'messages')::boolean,true),
    'social',coalesce((p_preferences->>'social')::boolean,true),
    'events',coalesce((p_preferences->>'events')::boolean,true),
    'health',coalesce((p_preferences->>'health')::boolean,true),
    'marketing',v_marketing,
    'quietEnabled',coalesce((p_preferences->>'quietEnabled')::boolean,false),
    'quietStartMinutes',v_start,'quietEndMinutes',v_end,'timeZone',v_timezone
  );
  update public.users set notification_preferences=v_allowed,updated_at=now() where id=auth.uid();
  return v_allowed;
end $$;
revoke all on function public.update_notification_preferences(jsonb) from public,anon;
grant execute on function public.update_notification_preferences(jsonb) to authenticated;

create or replace function public.current_user_has_product_access()
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1
    from public.users u
    join public.app_security_config c on c.singleton=true
    where u.id=auth.uid()
      and u.suspended_at is null and u.paused_at is null and u.age_18_confirmed=true
      and u.legal_version=c.current_legal_version
      and exists(select 1 from public.legal_acceptances a where a.user_id=u.id and a.legal_version=c.current_legal_version and a.terms_version=c.current_terms_version and a.community_guidelines_version=c.current_community_guidelines_version)
      and exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.notice_version=c.current_privacy_notice_version)
  );
$$;
revoke all on function public.current_user_has_product_access() from public,anon,authenticated;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,
    'incognito',u.incognito,'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,'measurementSystem',u.measurement_system,
    'privacyNoticeVersion',(select p.notice_version from public.privacy_notice_acknowledgements p where p.user_id=u.id order by p.acknowledged_at desc,p.id desc limit 1),
    'marketingConsentVersion',(select e.consent_version from public.marketing_consent_events e where e.user_id=u.id and e.channel='push' and e.purpose='marketing_product_updates' order by e.created_at desc,e.id desc limit 1),
    'notificationPreferences',('{
      "matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,
      "quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"
    }'::jsonb || coalesce(u.notification_preferences,'{}'::jsonb))
  ) from public.users u
  where u.id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;
