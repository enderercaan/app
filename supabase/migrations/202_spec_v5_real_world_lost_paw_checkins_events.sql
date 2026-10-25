-- Tailmance migration 202: Spec v5.0 real-world features (2026-10-25).
--
-- Spec v5.0 4.2 + 17 (park check-in, 2 hours), 4.3 + 32.2 (event capacity, waitlist, participation rules,
-- cancellation notice, 24h/1h reminders), 4.5 + 32.3 + Annex A (Lost Paw: 7-day lifetime with owner extension,
-- owner-approved 10 km expansion after 24 hours, seen/found reports with withdrawal, thank-you notice on close).
--
-- Design notes
-- * Every new table is RPC-only: RLS on, no table grants, SECURITY DEFINER functions with an empty search_path.
-- * Check-ins store no coordinates. The client's current position is used once to prove presence at the place.
-- * Sighting locations are stored rounded to 3 decimals (about 110 m) and are shown only to the alert owner.
-- * Waitlist promotion runs in a trigger on event_attendees so every path that frees a seat (leave, switch to
--   interested, account deletion cascade) promotes the next eligible pet in the same transaction.
-- * Time-based work (alert expiry, stale check-ins, event reminders) runs in one pg_cron job every 5 minutes.
-- * Vaccination-based event restrictions are not offered: they need the vet-approved rule table (spec 19).

-- ---------------------------------------------------------------------------------------------------------
-- 0. Patch helper (exact-once anchor replacement; aborts the migration on a missing or repeated anchor)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.tm202_patch_function(p_signature regprocedure,p_anchor text,p_replacement text)
returns void language plpgsql set search_path='' as $$
declare v_def text:=pg_catalog.pg_get_functiondef(p_signature); v_count int;
begin
  v_count:=(length(v_def)-length(replace(v_def,p_anchor,'')))/greatest(length(p_anchor),1);
  if v_count<>1 then raise exception 'tm202_patch_anchor_count %:% for %',v_count,left(p_anchor,60),p_signature; end if;
  execute replace(v_def,p_anchor,p_replacement);
end $$;
revoke all on function public.tm202_patch_function(regprocedure,text,text) from public,anon,authenticated;

-- Fix: the device-integrity trigger read new.kind inside one CASE expression. PL/pgSQL plans the whole
-- expression, so on every table without a "kind" column (lost_pet_alerts, pet_events, meetup_requests,
-- pet_boosts, user_travel_mode) an authenticated insert failed with 42703. Read the field via jsonb instead.
-- A missing role claim (direct database session) is treated like any non-client role.
create or replace function public.enforce_high_risk_device_integrity()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_action text;
begin
  if auth.role() is distinct from 'authenticated' then return new; end if;
  v_action:=case tg_table_name
    when 'lost_pet_alerts' then 'lost_pet_alert'
    when 'pet_events' then 'event_create'
    when 'meetup_requests' then 'meetup_create'
    when 'pet_boosts' then 'boost_activate'
    when 'user_travel_mode' then 'travel_mode'
    when 'pet_likes' then case when pg_catalog.to_jsonb(new)->>'kind'='super_like' then 'super_like' else null end
    else null
  end;
  if v_action is not null then perform public.require_current_device_integrity(v_action); end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Lost Paw (Pati Radar)
-- ---------------------------------------------------------------------------------------------------------
alter table public.lost_pet_alerts add column if not exists expires_at timestamptz not null default (now()+interval '7 days');
alter table public.lost_pet_alerts add column if not exists expanded_at timestamptz;
alter table public.lost_pet_alerts add column if not exists description text not null default '';
alter table public.lost_pet_alerts add column if not exists collar_info text not null default '';
alter table public.lost_pet_alerts add column if not exists has_microchip boolean;
update public.lost_pet_alerts set expires_at=created_at+interval '7 days' where expires_at>created_at+interval '7 days' and expanded_at is null;
alter table public.lost_pet_alerts drop constraint if exists lost_pet_alerts_status_check;
alter table public.lost_pet_alerts add constraint lost_pet_alerts_status_check
  check (status = any (array['active','resolved','cancelled','expired']));
alter table public.lost_pet_alerts add constraint lost_pet_alerts_description_check check (char_length(description)<=500);
alter table public.lost_pet_alerts add constraint lost_pet_alerts_collar_info_check check (char_length(collar_info)<=200);
alter table public.lost_pet_alerts add constraint lost_pet_alerts_lifetime_check check (expires_at<=created_at+interval '35 days');
create index if not exists idx_lost_pet_alerts_active_expiry on public.lost_pet_alerts(expires_at) where status='active';

create table if not exists public.lost_pet_sightings(
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.lost_pet_alerts(id) on delete cascade,
  reporter_pet_id uuid not null references public.pets(id) on delete cascade,
  reporter_user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('seen','found')),
  note text not null default '' check (char_length(note)<=500),
  approx_latitude double precision not null check (approx_latitude between -90 and 90),
  approx_longitude double precision not null check (approx_longitude between -180 and 180),
  seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create index if not exists lost_pet_sightings_alert_idx on public.lost_pet_sightings(alert_id,created_at desc);
create index if not exists lost_pet_sightings_reporter_idx on public.lost_pet_sightings(reporter_user_id);
alter table public.lost_pet_sightings enable row level security;
revoke all on public.lost_pet_sightings from public,anon,authenticated;

-- Readers only show unexpired alerts.
select public.tm202_patch_function('public.get_nearby_lost_pet_alerts(uuid,integer)'::regprocedure,
  'where a.status=''active''',
  'where a.status=''active'' and a.expires_at>now()');
select public.tm202_patch_function('public.get_nearby_lost_pet_alerts(uuid,integer)'::regprocedure,
  '''createdAt'',x.created_at,',
  '''createdAt'',x.created_at,''expiresAt'',x.expires_at,''radiusKm'',x.alert_radius_km,''expandedAt'',x.expanded_at,'
  ||'''description'',x.description,''collarInfo'',x.collar_info,''hasMicrochip'',x.has_microchip,');

-- Notify every eligible owner inside the alert's current radius. The dedupe key matches the one used at
-- creation, so an expansion only reaches owners who were not notified before.
create or replace function public.notify_lost_pet_alert_recipients(p_alert_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare a public.lost_pet_alerts; p public.pets; v_count integer:=0;
begin
  select * into a from public.lost_pet_alerts where id=p_alert_id;
  if a.id is null or a.status<>'active' or a.location is null then return 0; end if;
  select * into p from public.pets where id=a.pet_id;
  insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id,recipient_pet_id)
  select r.user_id,'lost_pet','Lost pet alert','A pet was reported missing near you.',a.id,
         format('lost_pet:%s:%s',a.id,r.user_id),'lost_pet',
         jsonb_build_object('petName',p.name,'district',p.district,'neighborhood',coalesce(p.neighborhood,'')),
         p.id,r.recipient_pet_id
  from (
    select distinct on (u.id) u.id user_id,rp.id recipient_pet_id
    from public.pets rp
    join public.users u on u.id=rp.owner_id
    join public.pet_private pp on pp.pet_id=rp.id
    where u.id<>a.owner_user_id and u.suspended_at is null and u.paused_at is null
      and rp.moderation_status='approved' and pp.location is not null
      and not public.is_blocked(p.id,rp.id)
      and extensions.ST_DWithin(a.location,pp.location,a.alert_radius_km*1000.0)
    order by u.id,extensions.ST_Distance(a.location,pp.location),rp.id
  ) r
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.notify_lost_pet_alert_recipients(uuid) from public,anon,authenticated;
grant execute on function public.notify_lost_pet_alert_recipients(uuid) to service_role;

create or replace function public.set_lost_pet_alert_details(p_pet_id uuid,p_alert_id uuid,p_description text,p_collar_info text,p_has_microchip boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_description text:=trim(coalesce(p_description,'')); v_collar text:=trim(coalesce(p_collar_info,''));
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if char_length(v_description)>500 or char_length(v_collar)>200 then raise exception 'invalid_alert_details'; end if;
  if public.contains_prohibited_pet_commerce_intent(v_description||' '||v_collar) then raise exception 'alert_details_not_allowed'; end if;
  perform public.rate_limit('lost_pet_alert_details',30,86400);
  update public.lost_pet_alerts set description=v_description,collar_info=v_collar,has_microchip=p_has_microchip
  where id=p_alert_id and pet_id=p_pet_id and owner_user_id=auth.uid() and status='active';
  if not found then raise exception 'active_alert_not_found'; end if;
  return jsonb_build_object('id',p_alert_id,'description',v_description,'collarInfo',v_collar,'hasMicrochip',p_has_microchip);
end $$;
revoke all on function public.set_lost_pet_alert_details(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.set_lost_pet_alert_details(uuid,uuid,text,text,boolean) to authenticated,service_role;

-- Owner-approved expansion to 10 km, available once the alert has been open for 24 hours.
create or replace function public.expand_lost_pet_alert(p_pet_id uuid,p_alert_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.lost_pet_alerts; v_notified integer;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into a from public.lost_pet_alerts where id=p_alert_id and pet_id=p_pet_id and owner_user_id=auth.uid() for update;
  if a.id is null or a.status<>'active' or a.expires_at<=now() then raise exception 'active_alert_not_found'; end if;
  if a.alert_radius_km>=10 then return jsonb_build_object('id',a.id,'radiusKm',a.alert_radius_km,'notified',0); end if;
  if a.created_at>now()-interval '24 hours' then raise exception 'alert_expansion_not_yet_available'; end if;
  perform public.rate_limit('lost_pet_alert_expand',3,86400);
  update public.lost_pet_alerts set alert_radius_km=10,expanded_at=now() where id=a.id;
  v_notified:=public.notify_lost_pet_alert_recipients(a.id);
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'lost_pet_alert_expanded','lost_pet_alert',a.id);
  return jsonb_build_object('id',a.id,'radiusKm',10,'notified',v_notified);
end $$;
revoke all on function public.expand_lost_pet_alert(uuid,uuid) from public,anon;
grant execute on function public.expand_lost_pet_alert(uuid,uuid) to authenticated,service_role;

-- Owner extension: +7 days per call, at most 35 days in total.
create or replace function public.extend_lost_pet_alert(p_pet_id uuid,p_alert_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.lost_pet_alerts; v_new timestamptz;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into a from public.lost_pet_alerts where id=p_alert_id and pet_id=p_pet_id and owner_user_id=auth.uid() for update;
  if a.id is null or a.status<>'active' or a.expires_at<=now() then raise exception 'active_alert_not_found'; end if;
  v_new:=a.expires_at+interval '7 days';
  if v_new>a.created_at+interval '35 days' then raise exception 'alert_extension_limit'; end if;
  perform public.rate_limit('lost_pet_alert_extend',5,86400);
  update public.lost_pet_alerts set expires_at=v_new where id=a.id;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'lost_pet_alert_extended','lost_pet_alert',a.id);
  return jsonb_build_object('id',a.id,'expiresAt',v_new);
end $$;
revoke all on function public.extend_lost_pet_alert(uuid,uuid) from public,anon;
grant execute on function public.extend_lost_pet_alert(uuid,uuid) to authenticated,service_role;

create or replace function public.report_lost_pet_sighting(
  p_pet_id uuid,p_alert_id uuid,p_kind text,p_note text,p_latitude double precision,p_longitude double precision,
  p_seen_at timestamptz,p_client_operation_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.lost_pet_alerts; lost public.pets; v_id uuid; v_note text:=trim(coalesce(p_note,''));
  v_op text:=trim(coalesce(p_client_operation_id,'')); v_hash text; v_receipt public.client_mutation_receipts%rowtype;
  v_point extensions.geography;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  if p_kind not in ('seen','found') then raise exception 'invalid_sighting_kind'; end if;
  if char_length(v_note)>500 then raise exception 'invalid_sighting_note'; end if;
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'invalid_sighting_location';
  end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('petId',p_pet_id,'alertId',p_alert_id,'kind',p_kind,'note',v_note,
    'lat',round(p_latitude::numeric,3),'lon',round(p_longitude::numeric,3),'seenAt',p_seen_at));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':lost_pet_sighting:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='lost_pet_sighting' and operation_id=v_op;
  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return (v_receipt.result->>'id')::uuid;
  end if;

  select * into a from public.lost_pet_alerts where id=p_alert_id;
  if a.id is null or a.status<>'active' or a.expires_at<=now() then raise exception 'active_alert_not_found'; end if;
  if a.owner_user_id=auth.uid() then raise exception 'cannot_report_own_alert'; end if;
  if public.is_blocked(p_pet_id,a.pet_id) then raise exception 'active_alert_not_found'; end if;
  if p_seen_at is null or p_seen_at>now()+interval '5 minutes' or p_seen_at<least(a.last_seen_at,a.created_at)-interval '1 hour' then
    raise exception 'invalid_sighting_time';
  end if;
  if v_note<>'' and (public.contains_prohibited_pet_commerce_intent(v_note) or public.contains_prohibited_human_dating_intent(v_note)) then
    raise exception 'sighting_note_not_allowed';
  end if;
  v_point:=extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude,p_latitude),4326)::extensions.geography;
  -- Reports far outside the alert area are rejected to limit false and abusive reports.
  if a.location is null or not extensions.ST_DWithin(a.location,v_point,(a.alert_radius_km+20)*1000.0) then
    raise exception 'sighting_outside_alert_area';
  end if;
  perform public.rate_limit('lost_pet_sighting',10,3600);

  insert into public.lost_pet_sightings(alert_id,reporter_pet_id,reporter_user_id,kind,note,approx_latitude,approx_longitude,seen_at)
  values(a.id,p_pet_id,auth.uid(),p_kind,v_note,round(p_latitude::numeric,3)::double precision,round(p_longitude::numeric,3)::double precision,p_seen_at)
  returning id into v_id;

  select * into lost from public.pets where id=a.pet_id;
  insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id,recipient_pet_id)
  values(a.owner_user_id,'lost_pet','Lost pet report','Someone reported seeing your pet.',a.id,
         format('lost_pet_sighting:%s',v_id),'lost_pet_sighting',jsonb_build_object('petName',lost.name,'kind',p_kind),p_pet_id,a.pet_id)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'lost_pet_sighting',v_op,v_hash,jsonb_build_object('id',v_id));
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'lost_pet_sighting_reported','lost_pet_alert',a.id);
  return v_id;
end $$;
revoke all on function public.report_lost_pet_sighting(uuid,uuid,text,text,double precision,double precision,timestamptz,text) from public,anon;
grant execute on function public.report_lost_pet_sighting(uuid,uuid,text,text,double precision,double precision,timestamptz,text) to authenticated,service_role;

create or replace function public.withdraw_lost_pet_sighting(p_pet_id uuid,p_sighting_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  update public.lost_pet_sightings set withdrawn_at=now()
  where id=p_sighting_id and reporter_pet_id=p_pet_id and reporter_user_id=auth.uid() and withdrawn_at is null;
  return found;
end $$;
revoke all on function public.withdraw_lost_pet_sighting(uuid,uuid) from public,anon;
grant execute on function public.withdraw_lost_pet_sighting(uuid,uuid) to authenticated,service_role;

-- Alert owner: reports on the alert. Reporter: own reports (so they can be withdrawn).
create or replace function public.get_lost_pet_sightings(p_pet_id uuid,p_alert_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.lost_pet_alerts; v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into a from public.lost_pet_alerts where id=p_alert_id;
  if a.id is null then raise exception 'not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'alertId',s.alert_id,'kind',s.kind,'note',s.note,'approximateLatitude',s.approx_latitude,'approximateLongitude',s.approx_longitude,
    'seenAt',s.seen_at,'createdAt',s.created_at,'isMine',s.reporter_user_id=auth.uid(),
    'reporter',case when a.owner_user_id=auth.uid() then public.pet_json(s.reporter_pet_id,p_pet_id) else null end
  ) order by s.created_at desc),'[]'::jsonb) into v_result
  from public.lost_pet_sightings s
  where s.alert_id=a.id and s.withdrawn_at is null
    and (
      (a.owner_user_id=auth.uid() and a.pet_id=p_pet_id and not public.is_blocked(p_pet_id,s.reporter_pet_id))
      or s.reporter_user_id=auth.uid()
    );
  return v_result;
end $$;
revoke all on function public.get_lost_pet_sightings(uuid,uuid) from public,anon;
grant execute on function public.get_lost_pet_sightings(uuid,uuid) to authenticated,service_role;

-- Thank-you notice to helpers when the owner closes the alert as found.
select public.tm202_patch_function('public.resolve_lost_pet_alert(uuid,uuid)'::regprocedure,
  'update public.lost_pet_alerts set status=''resolved'',resolved_at=now() where id=p_alert_id;',
  'update public.lost_pet_alerts set status=''resolved'',resolved_at=now() where id=p_alert_id;
  insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id,recipient_pet_id)
  select distinct on (s.reporter_user_id) s.reporter_user_id,''lost_pet'',''Thank you'',''The pet you helped look for is safe.'',p_alert_id,
         format(''lost_pet_thanks:%s:%s'',p_alert_id,s.reporter_user_id),''lost_pet_thanks'',
         jsonb_build_object(''petName'',(select lp.name from public.pets lp where lp.id=p_pet_id)),p_pet_id,s.reporter_pet_id
  from public.lost_pet_sightings s join public.users ru on ru.id=s.reporter_user_id
  where s.alert_id=p_alert_id and s.withdrawn_at is null and s.reporter_user_id<>auth.uid()
    and ru.suspended_at is null and not public.is_blocked(p_pet_id,s.reporter_pet_id)
  order by s.reporter_user_id,s.created_at
  on conflict (dedupe_key) where dedupe_key is not null do nothing;');

-- ---------------------------------------------------------------------------------------------------------
-- 2. Place check-in (2 hours, optional, no stored coordinates)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.place_checkins(
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.pet_friendly_places(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '2 hours'),
  ended_at timestamptz,
  constraint place_checkins_window_check check (expires_at=created_at+interval '2 hours'),
  constraint place_checkins_end_check check (ended_at is null or ended_at>=created_at)
);
create unique index if not exists place_checkins_one_open_per_pet on public.place_checkins(pet_id) where ended_at is null;
create index if not exists place_checkins_place_open_idx on public.place_checkins(place_id,expires_at) where ended_at is null;
alter table public.place_checkins enable row level security;
revoke all on public.place_checkins from public,anon,authenticated;

create or replace function public.check_in_place(p_pet_id uuid,p_place_id uuid,p_latitude double precision,p_longitude double precision)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_place public.pet_friendly_places; v_row public.place_checkins;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'invalid_location';
  end if;
  select * into v_place from public.pet_friendly_places where id=p_place_id and active;
  if v_place.id is null or v_place.location is null then raise exception 'not_found'; end if;
  if not extensions.ST_DWithin(v_place.location,extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude,p_latitude),4326)::extensions.geography,500.0) then
    raise exception 'not_at_place';
  end if;
  perform public.rate_limit('place_checkin',20,86400);
  update public.place_checkins set ended_at=least(now(),expires_at) where pet_id=p_pet_id and ended_at is null;
  insert into public.place_checkins(place_id,pet_id) values(p_place_id,p_pet_id) returning * into v_row;
  return jsonb_build_object('id',v_row.id,'placeId',v_row.place_id,'createdAt',v_row.created_at,'expiresAt',v_row.expires_at);
end $$;
revoke all on function public.check_in_place(uuid,uuid,double precision,double precision) from public,anon;
grant execute on function public.check_in_place(uuid,uuid,double precision,double precision) to authenticated,service_role;

create or replace function public.check_out_place(p_pet_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  update public.place_checkins set ended_at=least(now(),expires_at) where pet_id=p_pet_id and ended_at is null;
  return found;
end $$;
revoke all on function public.check_out_place(uuid) from public,anon;
grant execute on function public.check_out_place(uuid) to authenticated,service_role;

create or replace function public.get_place_checkins(p_pet_id uuid,p_place_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'petId',x.pet_id,'petName',x.name,'size',x.size,'energyLevel',x.energy_level,'species',x.species,
    'avatarPath',(select ph.storage_path from public.pet_photos ph where ph.pet_id=x.pet_id and ph.sort_order=1 and ph.moderation_status='approved'),
    'checkedInAt',x.created_at,'expiresAt',x.expires_at,'isMine',x.owner_id=auth.uid()
  ) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select c.*,p.name,p.size,p.energy_level,p.species,p.owner_id
    from public.place_checkins c join public.pets p on p.id=c.pet_id
    where c.place_id=p_place_id and c.ended_at is null and c.expires_at>now()
      and not public.is_blocked(p_pet_id,c.pet_id)
      and (p.owner_id=auth.uid() or public.social_content_visible_to_viewer(p_pet_id,c.pet_id))
    order by c.created_at desc limit 100
  ) x;
  return v_result;
end $$;
revoke all on function public.get_place_checkins(uuid,uuid) from public,anon;
grant execute on function public.get_place_checkins(uuid,uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Events: participation rules, waitlist, cancellation
-- ---------------------------------------------------------------------------------------------------------
alter table public.pet_events add column if not exists allowed_species public.pet_species[];
alter table public.pet_events add column if not exists allowed_sizes public.pet_size[];
alter table public.pet_events add column if not exists cancelled_at timestamptz;
alter table public.pet_events add column if not exists cancel_reason text;
alter table public.pet_events add constraint pet_events_cancel_reason_check check (cancel_reason is null or char_length(cancel_reason)<=300);
alter table public.pet_events add constraint pet_events_allowed_species_check check (allowed_species is null or cardinality(allowed_species) between 1 and 2);
alter table public.pet_events add constraint pet_events_allowed_sizes_check check (allowed_sizes is null or cardinality(allowed_sizes) between 1 and 5);

create table if not exists public.event_waitlist(
  event_id uuid not null references public.pet_events(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(event_id,pet_id)
);
create index if not exists event_waitlist_order_idx on public.event_waitlist(event_id,created_at,pet_id);
alter table public.event_waitlist enable row level security;
revoke all on public.event_waitlist from public,anon,authenticated;

create or replace function public.event_rules_allow_pet(p_event_id uuid,p_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.pet_events e join public.pets p on p.id=p_pet_id
    where e.id=p_event_id
      and (e.allowed_species is null or p.species=any(e.allowed_species))
      and (e.allowed_sizes is null or p.size=any(e.allowed_sizes))
  );
$$;
revoke all on function public.event_rules_allow_pet(uuid,uuid) from public,anon,authenticated;
grant execute on function public.event_rules_allow_pet(uuid,uuid) to service_role;

-- Going is rejected for pets outside the participation rules and for cancelled events; joining
-- as going removes the pet from the waitlist.
select public.tm202_patch_function('public.set_event_attendance(uuid,uuid,text)'::regprocedure,
  'where e.id=p_event_id and e.moderation_status=''approved'' and e.starts_at>now()',
  'where e.id=p_event_id and e.moderation_status=''approved'' and e.starts_at>now() and e.cancelled_at is null');
select public.tm202_patch_function('public.set_event_attendance(uuid,uuid,text)'::regprocedure,
  'if p_status=''going'' and v_capacity is not null then',
  'if p_status=''going'' and not public.event_rules_allow_pet(p_event_id,p_pet_id) then raise exception ''event_rules_not_met''; end if;
  if p_status=''going'' then delete from public.event_waitlist where event_id=p_event_id and pet_id=p_pet_id; end if;
  if p_status=''going'' and v_capacity is not null then');

select public.tm202_patch_function('public.get_pet_events_page(uuid,integer,timestamp with time zone,uuid)'::regprocedure,
  'where ev.moderation_status=''approved'' and ev.starts_at>now()',
  'where ev.moderation_status=''approved'' and ev.starts_at>now() and ev.cancelled_at is null');
select public.tm202_patch_function('public.get_pet_events_page(uuid,integer,timestamp with time zone,uuid)'::regprocedure,
  '''myStatus'',',
  '''allowedSpecies'',e.allowed_species,''allowedSizes'',e.allowed_sizes,'
  ||'''goingCount'',(select count(*) from public.event_attendees ga where ga.event_id=e.id and ga.status=''going''),'
  ||'''waitlistCount'',(select count(*) from public.event_waitlist w where w.event_id=e.id),'
  ||'''onWaitlist'',exists(select 1 from public.event_waitlist w where w.event_id=e.id and w.pet_id=p_pet_id),'
  ||'''eligible'',public.event_rules_allow_pet(e.id,p_pet_id),'
  ||'''myStatus'',');

create or replace function public.set_event_participation_rules(p_pet_id uuid,p_event_id uuid,p_allowed_species text[],p_allowed_sizes text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_species public.pet_species[]; v_sizes public.pet_size[];
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  begin
    v_species:=case when p_allowed_species is null or cardinality(p_allowed_species)=0 then null else (select array_agg(distinct s::public.pet_species) from unnest(p_allowed_species) s) end;
    v_sizes:=case when p_allowed_sizes is null or cardinality(p_allowed_sizes)=0 then null else (select array_agg(distinct s::public.pet_size) from unnest(p_allowed_sizes) s) end;
  exception when invalid_text_representation then raise exception 'invalid_event_rules';
  end;
  perform public.rate_limit('event_rules_update',30,86400);
  update public.pet_events set allowed_species=v_species,allowed_sizes=v_sizes
  where id=p_event_id and creator_pet_id=p_pet_id and starts_at>now() and cancelled_at is null;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object('allowedSpecies',v_species,'allowedSizes',v_sizes);
end $$;
revoke all on function public.set_event_participation_rules(uuid,uuid,text[],text[]) from public,anon;
grant execute on function public.set_event_participation_rules(uuid,uuid,text[],text[]) to authenticated,service_role;

create or replace function public.join_event_waitlist(p_pet_id uuid,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event public.pet_events; v_going integer; v_position integer;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into v_event from public.pet_events where id=p_event_id and moderation_status='approved' and starts_at>now() and cancelled_at is null for update;
  if v_event.id is null or public.is_blocked(p_pet_id,v_event.creator_pet_id) then raise exception 'not_found'; end if;
  if not public.event_rules_allow_pet(p_event_id,p_pet_id) then raise exception 'event_rules_not_met'; end if;
  if exists(select 1 from public.event_attendees where event_id=p_event_id and pet_id=p_pet_id and status='going') then raise exception 'already_going'; end if;
  select count(*) into v_going from public.event_attendees where event_id=p_event_id and status='going';
  if v_event.capacity is null or v_going<v_event.capacity then raise exception 'event_not_full'; end if;
  perform public.rate_limit('event_waitlist',50,86400);
  insert into public.event_waitlist(event_id,pet_id) values(p_event_id,p_pet_id) on conflict do nothing;
  select count(*) into v_position from public.event_waitlist w
  where w.event_id=p_event_id and (w.created_at,w.pet_id)<=(select created_at,pet_id from public.event_waitlist where event_id=p_event_id and pet_id=p_pet_id);
  return jsonb_build_object('eventId',p_event_id,'position',v_position);
end $$;
revoke all on function public.join_event_waitlist(uuid,uuid) from public,anon;
grant execute on function public.join_event_waitlist(uuid,uuid) to authenticated,service_role;

create or replace function public.leave_event_waitlist(p_pet_id uuid,p_event_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  delete from public.event_waitlist where event_id=p_event_id and pet_id=p_pet_id;
  return found;
end $$;
revoke all on function public.leave_event_waitlist(uuid,uuid) from public,anon;
grant execute on function public.leave_event_waitlist(uuid,uuid) to authenticated,service_role;

-- Fill free seats from the waitlist in join order, skipping pets that no longer qualify.
create or replace function public.promote_event_waitlist(p_event_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_event public.pet_events; v_going integer; v_next record; v_promoted integer:=0;
begin
  select * into v_event from public.pet_events where id=p_event_id for update;
  if v_event.id is null or v_event.cancelled_at is not null or v_event.starts_at<=now() or v_event.moderation_status<>'approved' then return 0; end if;
  loop
    select count(*) into v_going from public.event_attendees where event_id=p_event_id and status='going';
    exit when v_event.capacity is not null and v_going>=v_event.capacity;
    select w.pet_id,p.owner_id into v_next
    from public.event_waitlist w join public.pets p on p.id=w.pet_id join public.users u on u.id=p.owner_id
    where w.event_id=p_event_id and u.suspended_at is null and u.paused_at is null and p.moderation_status='approved'
      and not public.is_blocked(w.pet_id,v_event.creator_pet_id) and public.event_rules_allow_pet(p_event_id,w.pet_id)
    order by w.created_at,w.pet_id limit 1;
    exit when v_next.pet_id is null;
    delete from public.event_waitlist where event_id=p_event_id and pet_id=v_next.pet_id;
    insert into public.event_attendees(event_id,pet_id,status) values(p_event_id,v_next.pet_id,'going')
      on conflict(event_id,pet_id) do update set status='going';
    insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,recipient_pet_id)
    values(v_next.owner_id,'event','A spot opened up','You moved from the waitlist to going.',p_event_id,
           format('event_waitlist_promoted:%s:%s:%s',p_event_id,v_next.pet_id,extract(epoch from now())::bigint),'event_waitlist_promoted',
           jsonb_build_object('eventTitle',v_event.title,'startsAt',v_event.starts_at),v_next.pet_id)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
    v_promoted:=v_promoted+1;
    v_next:=null;
  end loop;
  return v_promoted;
end $$;
revoke all on function public.promote_event_waitlist(uuid) from public,anon,authenticated;
grant execute on function public.promote_event_waitlist(uuid) to service_role;

create or replace function public.trg_event_attendee_seat_freed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='going' and (tg_op='DELETE' or new.status<>'going') then
    if exists(select 1 from public.pet_events where id=old.event_id) then
      perform public.promote_event_waitlist(old.event_id);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.trg_event_attendee_seat_freed() from public,anon,authenticated;
drop trigger if exists trg_event_attendee_seat_freed on public.event_attendees;
create trigger trg_event_attendee_seat_freed after delete or update of status on public.event_attendees
  for each row execute function public.trg_event_attendee_seat_freed();

create or replace function public.cancel_pet_event(p_pet_id uuid,p_event_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event public.pet_events; v_reason text:=nullif(trim(coalesce(p_reason,'')),''); v_notified integer;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_reason is not null and char_length(v_reason)>300 then raise exception 'invalid_cancel_reason'; end if;
  select * into v_event from public.pet_events where id=p_event_id and creator_pet_id=p_pet_id for update;
  if v_event.id is null then raise exception 'not_found'; end if;
  if v_event.cancelled_at is not null then return jsonb_build_object('id',v_event.id,'cancelledAt',v_event.cancelled_at,'notified',0); end if;
  if v_event.starts_at<=now() then raise exception 'event_already_started'; end if;
  perform public.rate_limit('event_cancel',20,86400);
  update public.pet_events set cancelled_at=now(),cancel_reason=v_reason where id=p_event_id;
  insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id,recipient_pet_id)
  select distinct on (x.owner_id) x.owner_id,'event','Event cancelled','An event you joined was cancelled.',p_event_id,
         format('event_cancelled:%s:%s',p_event_id,x.owner_id),'event_cancelled',
         jsonb_build_object('eventTitle',v_event.title,'startsAt',v_event.starts_at),p_pet_id,x.pet_id
  from (
    select a.pet_id,p.owner_id from public.event_attendees a join public.pets p on p.id=a.pet_id where a.event_id=p_event_id
    union all
    select w.pet_id,p.owner_id from public.event_waitlist w join public.pets p on p.id=w.pet_id where w.event_id=p_event_id
  ) x
  where x.owner_id<>auth.uid()
  order by x.owner_id,x.pet_id
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_notified = row_count;
  delete from public.event_waitlist where event_id=p_event_id;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'pet_event_cancelled','pet_event',p_event_id);
  return jsonb_build_object('id',p_event_id,'cancelledAt',now(),'notified',v_notified);
end $$;
revoke all on function public.cancel_pet_event(uuid,uuid,text) from public,anon;
grant execute on function public.cancel_pet_event(uuid,uuid,text) to authenticated,service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Time-based housekeeping (pg_cron, every 5 minutes)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.run_real_world_housekeeping()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_expired integer; v_checkins integer; v_reminders integer;
begin
  update public.lost_pet_alerts set status='expired' where status='active' and expires_at<=now();
  get diagnostics v_expired = row_count;

  update public.place_checkins set ended_at=expires_at where ended_at is null and expires_at<=now();
  get diagnostics v_checkins = row_count;

  -- 24-hour reminder inside (now+23h, now+24h]; 1-hour reminder inside (now+30min, now+1h]. A pet that
  -- RSVPs after a window has passed does not receive that reminder with misleading timing.
  insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,recipient_pet_id)
  select u.id,'event','Event reminder','An event you are going to starts soon.',e.id,
         format('event_reminder:%s:%s:%s',e.id,a.pet_id,k.kind),'event_reminder',
         jsonb_build_object('eventTitle',e.title,'window',k.kind,'startsAt',e.starts_at),a.pet_id
  from public.pet_events e
  join public.event_attendees a on a.event_id=e.id and a.status='going'
  join public.pets p on p.id=a.pet_id
  join public.users u on u.id=p.owner_id
  cross join (values ('24h'),('1h')) k(kind)
  where e.moderation_status='approved' and e.cancelled_at is null
    and u.suspended_at is null and u.paused_at is null
    and ((k.kind='24h' and e.starts_at>now()+interval '23 hours' and e.starts_at<=now()+interval '24 hours')
      or (k.kind='1h' and e.starts_at>now()+interval '30 minutes' and e.starts_at<=now()+interval '1 hour'))
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_reminders = row_count;

  return jsonb_build_object('alertsExpired',v_expired,'checkinsClosed',v_checkins,'eventReminders',v_reminders);
end $$;
revoke all on function public.run_real_world_housekeeping() from public,anon,authenticated;
grant execute on function public.run_real_world_housekeeping() to service_role;

select cron.schedule('tailmance-real-world-housekeeping','*/5 * * * *','select public.run_real_world_housekeeping()');

drop function public.tm202_patch_function(regprocedure,text,text);
