-- N/J runtime release controls: do not force both stores from one platform-agnostic version,
-- and keep operator maintenance copy locale-aware without making a free-form string mandatory.
alter table public.app_runtime_config add column if not exists minimum_supported_version_ios text;
alter table public.app_runtime_config add column if not exists minimum_supported_version_android text;
alter table public.app_runtime_config add column if not exists latest_version_ios text;
alter table public.app_runtime_config add column if not exists latest_version_android text;
alter table public.app_runtime_config add column if not exists messages jsonb not null default '{}'::jsonb;

update public.app_runtime_config set
  minimum_supported_version_ios=coalesce(minimum_supported_version_ios,minimum_supported_version),
  minimum_supported_version_android=coalesce(minimum_supported_version_android,minimum_supported_version),
  latest_version_ios=coalesce(latest_version_ios,latest_version),
  latest_version_android=coalesce(latest_version_android,latest_version)
where singleton=true;

-- Executed-Postgres verification fix (2026-10-03): with standard_conforming_strings=on a doubled
-- backslash means a literal backslash, so the original pattern rejected every real version such as 1.0.0.
alter table public.app_runtime_config drop constraint if exists app_runtime_config_platform_versions_check;
alter table public.app_runtime_config add constraint app_runtime_config_platform_versions_check check (
  minimum_supported_version_ios ~ '^[0-9]+(\.[0-9]+){0,3}$' and
  minimum_supported_version_android ~ '^[0-9]+(\.[0-9]+){0,3}$' and
  latest_version_ios ~ '^[0-9]+(\.[0-9]+){0,3}$' and
  latest_version_android ~ '^[0-9]+(\.[0-9]+){0,3}$'
) not valid;
alter table public.app_runtime_config validate constraint app_runtime_config_platform_versions_check;

alter table public.app_runtime_config drop constraint if exists app_runtime_config_messages_check;
alter table public.app_runtime_config add constraint app_runtime_config_messages_check check (
  jsonb_typeof(messages)='object' and octet_length(messages::text)<=8000
) not valid;
alter table public.app_runtime_config validate constraint app_runtime_config_messages_check;

create or replace function public.get_runtime_config()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'maintenanceMode',maintenance_mode,
    'minimumSupportedVersion',minimum_supported_version,
    'latestVersion',latest_version,
    'minimumSupportedVersions',jsonb_build_object(
      'ios',coalesce(minimum_supported_version_ios,minimum_supported_version),
      'android',coalesce(minimum_supported_version_android,minimum_supported_version)
    ),
    'latestVersions',jsonb_build_object(
      'ios',coalesce(latest_version_ios,latest_version),
      'android',coalesce(latest_version_android,latest_version)
    ),
    'features',features,
    'message',message,
    'messages',messages
  )
  from public.app_runtime_config where singleton=true;
$$;
revoke all on function public.get_runtime_config() from public;
grant execute on function public.get_runtime_config() to anon,authenticated;

-- J/O locale hardening: persist the user's application-language preference server-side so push delivery
-- can follow the language selected in Tailmance rather than guessing from device or region.
alter table public.users add column if not exists preferred_locale text not null default 'en';
alter table public.users drop constraint if exists users_preferred_locale_check;
alter table public.users add constraint users_preferred_locale_check check (
  preferred_locale in ('en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi')
) not valid;
alter table public.users validate constraint users_preferred_locale_check;

create or replace function public.update_preferred_locale(p_locale text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_locale not in ('en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi') then
    raise exception 'unsupported_locale';
  end if;
  perform public.rate_limit('preferred_locale',30,3600);
  update public.users set preferred_locale=p_locale,updated_at=now() where id=auth.uid();
end $$;
revoke all on function public.update_preferred_locale(text) from public,anon;
grant execute on function public.update_preferred_locale(text) to authenticated;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,
    'incognito',u.incognito,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,
    'notificationPreferences',('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(u.notification_preferences,'{}'::jsonb))
  ) from public.users u where u.id=auth.uid();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;

-- Notification templates keep dynamic data separate from display copy. This lets both the mobile UI and
-- push worker render the recipient's locale without parsing an English sentence.
alter table public.notifications add column if not exists template_key text;
alter table public.notifications add column if not exists template_params jsonb not null default '{}'::jsonb;
alter table public.notifications drop constraint if exists notifications_template_params_object_check;
alter table public.notifications add constraint notifications_template_params_object_check
  check (jsonb_typeof(template_params)='object' and pg_column_size(template_params)<=2048) not valid;
alter table public.notifications validate constraint notifications_template_params_object_check;

create or replace function public.enqueue_vaccination_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare v_queued integer:=0;
begin
  with candidates as (
    select v.id,v.pet_id,v.vaccine_name,v.next_due_date,p.owner_id,p.name as pet_name,(v.next_due_date-current_date)::integer as days_until
    from public.pet_vaccinations v
    join public.pets p on p.id=v.pet_id
    join public.users u on u.id=p.owner_id and u.suspended_at is null and u.paused_at is null
    where v.next_due_date is not null
      and v.verification_status<>'rejected'
      and (v.next_due_date-current_date) in (0,1,3,7)
      and not exists (
        select 1 from public.notifications n
        where n.dedupe_key=format('vaccination:%s:%s:%s',v.id,v.next_due_date,(v.next_due_date-current_date)::integer)
      )
  )
  insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params)
  select owner_id,'health',
    format('Vaccination reminder for %s',pet_name),
    format('The next %s dose is due %s. Check your veterinarian''s plan.',vaccine_name,
      case days_until when 0 then 'today' when 1 then 'in 1 day' else format('in %s days',days_until) end),
    pet_id,
    format('vaccination:%s:%s:%s',id,next_due_date,days_until),
    'vaccination_due',
    jsonb_build_object('petName',left(pet_name,120),'vaccineName',left(vaccine_name,120),'daysUntil',days_until)
  from candidates
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_queued=row_count;
  return v_queued;
end $$;
revoke all on function public.enqueue_vaccination_reminders() from public,anon,authenticated;
grant execute on function public.enqueue_vaccination_reminders() to service_role;

create or replace function public.get_notifications_page(p_limit integer default 40,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',n.id,'type',n.type,'title',n.title,'body',n.body,'createdAt',n.created_at,'readAt',n.read_at,'entityId',n.entity_id,
    'templateKey',n.template_key,'templateParams',n.template_params
  ) order by n.created_at desc,n.id desc),'[]'::jsonb)
  from (
    select * from public.notifications
    where user_id=auth.uid()
      and (p_before_created_at is null or (created_at,id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by created_at desc,id desc
    limit least(greatest(p_limit,1),100)
  ) n;
$$;
revoke all on function public.get_notifications_page(integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_notifications_page(integer,timestamptz,uuid) to authenticated;

create or replace function public.get_unread_notification_count()
returns bigint language sql stable security definer set search_path='' as $$
  select count(*)::bigint
  from public.notifications
  where user_id=auth.uid() and read_at is null;
$$;
revoke all on function public.get_unread_notification_count() from public,anon;
grant execute on function public.get_unread_notification_count() to authenticated;

