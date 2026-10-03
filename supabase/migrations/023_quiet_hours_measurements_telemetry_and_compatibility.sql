-- K/N quiet-hours hardening: store validated local delivery windows inside notification preferences.
-- Existing category toggles remain backward compatible and old rows receive safe defaults on read.
create or replace function public.update_notification_preferences(p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_allowed jsonb;
  v_start integer;
  v_end integer;
  v_timezone text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_preferences is null or jsonb_typeof(p_preferences)<>'object' then raise exception 'invalid_notification_preferences'; end if;
  perform public.rate_limit('notification_preferences',30,3600);
  begin v_start:=coalesce((p_preferences->>'quietStartMinutes')::integer,1320); exception when others then raise exception 'invalid_quiet_hours'; end;
  begin v_end:=coalesce((p_preferences->>'quietEndMinutes')::integer,480); exception when others then raise exception 'invalid_quiet_hours'; end;
  v_timezone:=coalesce(nullif(trim(p_preferences->>'timeZone'),''),'UTC');
  if char_length(v_timezone)>64 then raise exception 'invalid_timezone'; end if;
  if v_start<0 or v_start>1439 or v_end<0 or v_end>1439 or v_start=v_end then raise exception 'invalid_quiet_hours'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then raise exception 'invalid_timezone'; end if;
  v_allowed := jsonb_build_object(
    'matches',coalesce((p_preferences->>'matches')::boolean,true),
    'messages',coalesce((p_preferences->>'messages')::boolean,true),
    'social',coalesce((p_preferences->>'social')::boolean,true),
    'events',coalesce((p_preferences->>'events')::boolean,true),
    'health',coalesce((p_preferences->>'health')::boolean,true),
    'marketing',coalesce((p_preferences->>'marketing')::boolean,false),
    'quietEnabled',coalesce((p_preferences->>'quietEnabled')::boolean,false),
    'quietStartMinutes',v_start,
    'quietEndMinutes',v_end,
    'timeZone',v_timezone
  );
  update public.users set notification_preferences=v_allowed,updated_at=now() where id=auth.uid();
  return v_allowed;
end $$;
revoke all on function public.update_notification_preferences(jsonb) from public,anon;
grant execute on function public.update_notification_preferences(jsonb) to authenticated;

-- J measurement-system preference: storage remains canonical km/kg; only display/input preference is user-specific.
alter table public.users add column if not exists measurement_system text not null default 'metric';
alter table public.users drop constraint if exists users_measurement_system_check;
alter table public.users add constraint users_measurement_system_check check (measurement_system in ('metric','imperial')) not valid;
alter table public.users validate constraint users_measurement_system_check;

create or replace function public.update_measurement_system(p_system text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_system not in ('metric','imperial') then raise exception 'invalid_measurement_system'; end if;
  perform public.rate_limit('measurement_system',30,3600);
  update public.users set measurement_system=p_system,updated_at=now() where id=auth.uid();
end $$;
revoke all on function public.update_measurement_system(text) from public,anon;
grant execute on function public.update_measurement_system(text) to authenticated;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,
    'incognito',u.incognito,'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,'measurementSystem',u.measurement_system,
    'notificationPreferences',('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(u.notification_preferences,'{}'::jsonb))
  ) from public.users u where u.id=auth.uid();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;


-- N privacy-minimized first-party React error telemetry. This is intentionally NOT a
-- substitute for native crash/ANR monitoring. Clients cannot read the table and never
-- submit raw messages/stacks; they submit a local fingerprint plus bounded metadata.
create table if not exists public.client_error_events (
  id uuid primary key default gen_random_uuid(),
  error_name text not null check (char_length(error_name) between 1 and 80),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$' or fingerprint='unknown'),
  app_version text not null check (char_length(app_version) between 1 and 32),
  platform text not null check (platform in ('ios','android','web','windows','macos')),
  occurred_at timestamptz not null default now()
);
alter table public.client_error_events drop column if exists user_id;
alter table public.client_error_events enable row level security;
revoke all on table public.client_error_events from public,anon,authenticated;
create index if not exists client_error_events_occurred_idx on public.client_error_events(occurred_at desc);
create index if not exists client_error_events_fingerprint_idx on public.client_error_events(fingerprint,occurred_at desc);

create or replace function public.record_client_error(p_error_name text,p_fingerprint text,p_app_version text,p_platform text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then return; end if;
  if p_error_name is null or char_length(trim(p_error_name)) not between 1 and 80 then raise exception 'invalid_error_name'; end if;
  if p_fingerprint is null or not (p_fingerprint ~ '^[0-9a-f]{16}$' or p_fingerprint='unknown') then raise exception 'invalid_error_fingerprint'; end if;
  if p_app_version is null or char_length(trim(p_app_version)) not between 1 and 32 then raise exception 'invalid_app_version'; end if;
  if p_platform not in ('ios','android','web','windows','macos') then raise exception 'invalid_platform'; end if;
  perform public.rate_limit('client_error_telemetry',20,3600);
  insert into public.client_error_events(error_name,fingerprint,app_version,platform)
  values(trim(p_error_name),p_fingerprint,trim(p_app_version),p_platform);
  -- Opportunistic bounded retention cleanup. Production operations must still schedule
  -- an independent retention job so expiry is guaranteed even during quiet periods.
  delete from public.client_error_events where occurred_at < now()-interval '30 days';
end $$;
revoke all on function public.record_client_error(text,text,text,text) from public,anon;
grant execute on function public.record_client_error(text,text,text,text) to authenticated;

-- v14 compatibility + scale hardening: keep legacy callable list RPCs bounded and
-- provide keyset pagination for meetup history. These definitions intentionally
-- come last so older unbounded implementations cannot become the final runtime shape.
create index if not exists idx_meetup_requests_match_created_page
  on public.meetup_requests(match_id,created_at desc,id desc);

create or replace function public.get_meetup_requests_page(
  p_pet_id uuid,
  p_match_id uuid default null,
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'matchId',r.match_id,'proposedByPetId',r.proposed_by_pet_id,'startsAt',r.starts_at,
    'publicPlaceLabel',r.public_place_label,'note',r.note,'status',r.status,'createdAt',r.created_at
  ) order by r.created_at desc,r.id desc),'[]'::jsonb) else null end
  from (
    select r.*
    from public.meetup_requests r
    join public.pet_matches m on m.id=r.match_id
    where (m.pet_low_id=p_pet_id or m.pet_high_id=p_pet_id)
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and (p_match_id is null or r.match_id=p_match_id)
      and r.moderation_status<>'rejected'
      and (r.proposed_by_pet_id=p_pet_id or r.moderation_status='approved')
      and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by r.created_at desc,r.id desc
    limit least(greatest(p_limit,1),50)
  ) r;
$$;
revoke all on function public.get_meetup_requests_page(uuid,uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_meetup_requests_page(uuid,uuid,integer,timestamptz,uuid) to authenticated;

create or replace function public.get_meetup_requests(p_pet_id uuid,p_match_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.get_meetup_requests_page(p_pet_id,p_match_id,50,null,null);
$$;
revoke all on function public.get_meetup_requests(uuid,uuid) from public,anon;
grant execute on function public.get_meetup_requests(uuid,uuid) to authenticated;

create or replace function public.get_matches(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.get_matches_page(p_pet_id,100,null,null);
$$;
revoke all on function public.get_matches(uuid) from public,anon;
grant execute on function public.get_matches(uuid) to authenticated;

create or replace function public.get_incoming_likes(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.get_incoming_likes_page(p_pet_id,80,null,null);
$$;
revoke all on function public.get_incoming_likes(uuid) from public,anon;
grant execute on function public.get_incoming_likes(uuid) to authenticated;

create or replace function public.get_active_stories(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.get_active_stories_page(p_pet_id,80,null,null);
$$;
revoke all on function public.get_active_stories(uuid) from public,anon;
grant execute on function public.get_active_stories(uuid) to authenticated;

create or replace function public.get_pet_events(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.get_pet_events_page(p_pet_id,50,null,null);
$$;
revoke all on function public.get_pet_events(uuid) from public,anon;
grant execute on function public.get_pet_events(uuid) to authenticated;


