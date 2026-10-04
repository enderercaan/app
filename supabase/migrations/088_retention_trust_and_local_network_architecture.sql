-- Tailmance v19 R8: retention, trust, local-network density and sustainable monetization hardening.
-- Depends on migration 087 for notification_type = lost_pet.
-- Pet-first only. No pet sales, no animal-commerce marketplace, no exact-location disclosure.

alter table public.pet_events add column if not exists event_kind text not null default 'community';
alter table public.pet_events add column if not exists recurrence text not null default 'none';
alter table public.pet_events add column if not exists host_place_id uuid;
alter table public.pet_events drop constraint if exists pet_events_event_kind_check;
alter table public.pet_events add constraint pet_events_event_kind_check check (event_kind in ('community','walk','playdate','education')) not valid;
alter table public.pet_events validate constraint pet_events_event_kind_check;
alter table public.pet_events drop constraint if exists pet_events_recurrence_check;
alter table public.pet_events add constraint pet_events_recurrence_check check (recurrence in ('none','weekly')) not valid;
alter table public.pet_events validate constraint pet_events_recurrence_check;

create table if not exists public.pet_friendly_places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  category text not null check (category in ('park','cafe','restaurant','veterinary','groomer','trainer','hotel','shop','other')),
  city text not null check (char_length(trim(city)) between 1 and 80),
  district text not null check (char_length(trim(district)) between 1 and 80),
  neighborhood text,
  address_label text not null check (char_length(trim(address_label)) between 2 and 240),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  website_url text,
  booking_url text,
  pet_policy_summary text not null default '' check (char_length(pet_policy_summary)<=600),
  verification_partner boolean not null default false,
  verified boolean not null default false,
  partnership_tier text not null default 'organic' check (partnership_tier in ('organic','featured','event_host')),
  sponsorship_disclosure text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (partnership_tier='organic' or sponsorship_disclosure is not null)
);
create index if not exists idx_pet_friendly_places_location on public.pet_friendly_places(city,district,neighborhood) where active;
create index if not exists idx_pet_friendly_places_category on public.pet_friendly_places(category) where active;

alter table public.pet_events drop constraint if exists pet_events_host_place_fk;
alter table public.pet_events add constraint pet_events_host_place_fk foreign key(host_place_id) references public.pet_friendly_places(id) on delete set null not valid;
alter table public.pet_events validate constraint pet_events_host_place_fk;

create table if not exists public.place_referral_events (
  id bigint generated always as identity primary key,
  place_id uuid not null references public.pet_friendly_places(id) on delete cascade,
  source text not null check (source in ('places','event','meetup')),
  occurred_at timestamptz not null default now()
);
create index if not exists idx_place_referral_events_place_day on public.place_referral_events(place_id,occurred_at desc);

create table if not exists public.lost_pet_alerts (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','resolved','cancelled')),
  last_seen_at timestamptz not null,
  city text not null,
  district text not null,
  neighborhood text,
  alert_radius_km numeric(5,2) not null default 5 check (alert_radius_km between 1 and 25),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((status='resolved' and resolved_at is not null) or status<>'resolved')
);
create unique index if not exists lost_pet_alerts_one_active_per_pet on public.lost_pet_alerts(pet_id) where status='active';
create index if not exists idx_lost_pet_alerts_active_created on public.lost_pet_alerts(created_at desc) where status='active';

create table if not exists public.community_launch_zones (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  district text not null,
  neighborhood text not null,
  launch_status text not null default 'waitlist' check (launch_status in ('waitlist','pilot_open','open')),
  density_target integer not null default 300 check (density_target between 100 and 1000),
  waitlist_unlock_target integer not null default 40 check (waitlist_unlock_target between 10 and 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(city,district,neighborhood)
);

create table if not exists public.community_waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  city text not null,
  district text not null,
  neighborhood text not null,
  created_at timestamptz not null default now(),
  unique(user_id,city,district,neighborhood)
);
create index if not exists idx_community_waitlist_zone on public.community_waitlist(city,district,neighborhood,created_at);

-- Mating is an owner-arranged interest only when explicitly enabled by a counsel-approved runtime jurisdiction policy.
-- No sales, deposits, payments, breeder lead-generation or platform-arranged breeding service is introduced here.
create table if not exists public.jurisdiction_product_features (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  mating_owner_arranged_enabled boolean not null default false,
  counsel_approved boolean not null default false,
  animal_welfare_review_complete boolean not null default false,
  kinship_control_complete boolean not null default false,
  effective_at timestamptz,
  expires_at timestamptz,
  evidence_reference text,
  updated_at timestamptz not null default now(),
  check (not mating_owner_arranged_enabled or (counsel_approved and animal_welfare_review_complete and kinship_control_complete and effective_at is not null and expires_at is not null and expires_at>effective_at and evidence_reference is not null))
);

alter table public.reports add column if not exists priority text not null default 'standard';
alter table public.reports add column if not exists triage_due_at timestamptz;
alter table public.reports add column if not exists resolution_target_at timestamptz;
alter table public.reports add column if not exists assigned_operator text not null default 'Yekta Özel';
alter table public.reports drop constraint if exists reports_priority_check;
alter table public.reports add constraint reports_priority_check check (priority in ('standard','high','urgent')) not valid;
alter table public.reports validate constraint reports_priority_check;

create or replace function public.set_report_sla()
returns trigger language plpgsql set search_path='' as $$
begin
  new.priority:=case
    when lower(new.reason) in ('physical_safety','minor_safety','animal_welfare','credible_threat','lost_pet_abuse') then 'urgent'
    when lower(new.reason) in ('harassment','impersonation','pet_sale','commercial_breeding','scam') then 'high'
    else coalesce(new.priority,'standard')
  end;
  new.assigned_operator:='Yekta Özel';
  new.triage_due_at:=coalesce(new.triage_due_at,new.created_at + case when new.priority='urgent' then interval '15 minutes' when new.priority='high' then interval '4 hours' else interval '24 hours' end);
  new.resolution_target_at:=coalesce(new.resolution_target_at,new.created_at + case when new.priority='urgent' then interval '4 hours' when new.priority='high' then interval '24 hours' else interval '48 hours' end);
  return new;
end $$;
drop trigger if exists reports_set_sla on public.reports;
create trigger reports_set_sla before insert on public.reports for each row execute function public.set_report_sla();

-- Initial Istanbul pilot: three dense Kadıköy neighborhoods. Other Kadıköy neighborhoods can join the local waitlist.
insert into public.community_launch_zones(city,district,neighborhood,launch_status,density_target,waitlist_unlock_target)
values
  ('İstanbul','Kadıköy','Moda','pilot_open',300,40),
  ('İstanbul','Kadıköy','Fenerbahçe','pilot_open',300,40),
  ('İstanbul','Kadıköy','Caddebostan','pilot_open',300,40)
on conflict(city,district,neighborhood) do update set active=true;

create or replace function public.get_local_network_status(p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.pets; z public.community_launch_zones; v_active integer:=0; v_waitlist integer:=0; v_has_managed_area boolean:=false;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into p from public.pets where id=p_pet_id;
  if p.species='cat' then
    return jsonb_build_object('status','feed_only','activePets',0,'densityTarget',0,'waitlistCount',0,'waitlistTarget',0,'remainingToOpen',0);
  end if;
  select exists(select 1 from public.community_launch_zones x where x.active and public.normalize_search_text(x.city)=public.normalize_search_text(p.city) and public.normalize_search_text(x.district)=public.normalize_search_text(p.district)) into v_has_managed_area;
  select * into z from public.community_launch_zones x where x.active and public.normalize_search_text(x.city)=public.normalize_search_text(p.city) and public.normalize_search_text(x.district)=public.normalize_search_text(p.district) and public.normalize_search_text(x.neighborhood)=public.normalize_search_text(coalesce(p.neighborhood,'')) limit 1;
  select count(*) into v_active from public.pets other join public.users u on u.id=other.owner_id
    where other.species='dog' and other.moderation_status='approved' and other.discovery_enabled and u.suspended_at is null and u.paused_at is null
      and public.normalize_search_text(other.city)=public.normalize_search_text(p.city)
      and public.normalize_search_text(other.district)=public.normalize_search_text(p.district)
      and public.normalize_search_text(coalesce(other.neighborhood,''))=public.normalize_search_text(coalesce(p.neighborhood,''));
  select count(*) into v_waitlist from public.community_waitlist w
    where public.normalize_search_text(w.city)=public.normalize_search_text(p.city)
      and public.normalize_search_text(w.district)=public.normalize_search_text(p.district)
      and public.normalize_search_text(w.neighborhood)=public.normalize_search_text(coalesce(p.neighborhood,''));
  if z.id is not null then
    return jsonb_build_object('status',case when z.launch_status in ('pilot_open','open') then 'open' else 'waitlist' end,'activePets',v_active,'densityTarget',z.density_target,'waitlistCount',v_waitlist,'waitlistTarget',z.waitlist_unlock_target,'remainingToOpen',greatest(z.density_target-v_active,0),'pilot',z.launch_status='pilot_open');
  end if;
  if v_has_managed_area then
    return jsonb_build_object('status','waitlist','activePets',v_active,'densityTarget',300,'waitlistCount',v_waitlist,'waitlistTarget',40,'remainingToOpen',greatest(40-v_waitlist,0),'pilot',false);
  end if;
  -- Narrow-launch rule: only explicitly configured pilot/open zones may swipe.
  -- Every other neighborhood stays on the referral waitlist until an operator opens it.
  return jsonb_build_object('status','waitlist','activePets',v_active,'densityTarget',300,'waitlistCount',v_waitlist,'waitlistTarget',40,'remainingToOpen',greatest(40-v_waitlist,0),'pilot',false);
end $$;
revoke all on function public.get_local_network_status(uuid) from public,anon;
grant execute on function public.get_local_network_status(uuid) to authenticated;

create or replace function public.join_local_waitlist(p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.pets; v_count integer;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into p from public.pets where id=p_pet_id;
  if p.species<>'dog' or nullif(trim(coalesce(p.neighborhood,'')),'') is null then raise exception 'dog_neighborhood_required'; end if;
  perform public.rate_limit('community_waitlist',10,86400);
  insert into public.community_waitlist(user_id,pet_id,city,district,neighborhood) values(auth.uid(),p.id,p.city,p.district,p.neighborhood) on conflict(user_id,city,district,neighborhood) do nothing;
  select count(*) into v_count from public.community_waitlist w where public.normalize_search_text(w.city)=public.normalize_search_text(p.city) and public.normalize_search_text(w.district)=public.normalize_search_text(p.district) and public.normalize_search_text(w.neighborhood)=public.normalize_search_text(p.neighborhood);
  return jsonb_build_object('joined',true,'waitlistCount',v_count);
end $$;
revoke all on function public.join_local_waitlist(uuid) from public,anon;
grant execute on function public.join_local_waitlist(uuid) to authenticated;

-- Keep the mature discovery implementation intact behind a policy wrapper.
do $$ begin
  if to_regprocedure('public.discover_pets_v86(uuid,jsonb)') is null then
    alter function public.discover_pets(uuid,jsonb) rename to discover_pets_v86;
  end if;
end $$;
revoke all on function public.discover_pets_v86(uuid,jsonb) from public,anon,authenticated;
create or replace function public.discover_pets(p_active_pet_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.pets; v_status jsonb; v_filters jsonb:=coalesce(p_filters,'{}'::jsonb);
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  select * into p from public.pets where id=p_active_pet_id;
  if p.species<>'dog' then return '[]'::jsonb; end if;
  v_status:=public.get_local_network_status(p_active_pet_id);
  if v_status->>'status'='waitlist' then raise exception 'community_zone_waitlisted'; end if;
  v_filters:=jsonb_set(v_filters,'{species}','"dog"'::jsonb,true);
  return public.discover_pets_v86(p_active_pet_id,v_filters);
end $$;
revoke all on function public.discover_pets(uuid,jsonb) from public,anon;
grant execute on function public.discover_pets(uuid,jsonb) to authenticated;

create or replace function public.get_discovery_suggestions(p_active_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_active_pet_id) then jsonb_build_object(
    'breeds',coalesce((select jsonb_agg(x) from (select distinct p.breed x from public.pets p where p.species='dog' and p.moderation_status='approved' and p.discovery_enabled order by x limit 80) q),'[]'::jsonb),
    'cities',coalesce((select jsonb_agg(x) from (select distinct p.city x from public.pets p where p.species='dog' and p.moderation_status='approved' and p.discovery_enabled order by x limit 80) q),'[]'::jsonb),
    'districts',coalesce((select jsonb_agg(x) from (select distinct p.district x from public.pets p where p.species='dog' and p.moderation_status='approved' and p.discovery_enabled order by x limit 120) q),'[]'::jsonb),
    'neighborhoods',coalesce((select jsonb_agg(x) from (select distinct p.neighborhood x from public.pets p where p.species='dog' and p.moderation_status='approved' and p.discovery_enabled and p.neighborhood is not null order by x limit 160) q),'[]'::jsonb)
  ) else null end;
$$;
revoke all on function public.get_discovery_suggestions(uuid) from public,anon;
grant execute on function public.get_discovery_suggestions(uuid) to authenticated;

create or replace function public.get_conversation_message_entitlement(p_conversation_id uuid,p_sender_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_match public.pet_matches; v_other_pet uuid; v_tier public.account_tier; v_free int; v_other_tier public.account_tier; v_courtesy boolean:=false;
begin
  if not public.owns_pet(p_sender_pet_id) then raise exception 'forbidden'; end if;
  select m.* into v_match from public.conversations c join public.pet_matches m on m.id=c.match_id where c.id=p_conversation_id;
  if v_match.id is null or v_match.unmatched_at is not null or p_sender_pet_id not in(v_match.pet_low_id,v_match.pet_high_id) then raise exception 'active_match_required'; end if;
  v_other_pet:=case when p_sender_pet_id=v_match.pet_low_id then v_match.pet_high_id else v_match.pet_low_id end;
  select u.tier,u.free_messages_sent into v_tier,v_free from public.users u where u.id=auth.uid();
  select u.tier into v_other_tier from public.pets p join public.users u on u.id=p.owner_id where p.id=v_other_pet;
  if v_tier='standard' and v_other_tier='premium' then
    select exists(select 1 from public.messages m where m.conversation_id=p_conversation_id and m.sender_pet_id=v_other_pet and m.moderation_status='approved') into v_courtesy;
  end if;
  return jsonb_build_object('tier',v_tier,'otherTier',v_other_tier,'freeMessagesRemaining',greatest(2-coalesce(v_free,0),0),'premiumReplyCourtesy',v_courtesy,'canSend',v_tier='premium' or v_courtesy or coalesce(v_free,0)<2);
end $$;
revoke all on function public.get_conversation_message_entitlement(uuid,uuid) from public,anon;
grant execute on function public.get_conversation_message_entitlement(uuid,uuid) to authenticated;

create or replace function public.send_message(p_conversation_id uuid,p_sender_pet_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_match public.pet_matches; v_uid uuid:=auth.uid(); v_msg public.messages; v_other_pet uuid; v_tier public.account_tier; v_other_tier public.account_tier; v_body text:=trim(coalesce(p_body,'')); v_courtesy boolean:=false;
begin
  if not public.owns_pet(p_sender_pet_id) then raise exception 'forbidden'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception 'invalid_message'; end if;
  perform public.rate_limit('message',60,60);
  select m.* into v_match from public.conversations c join public.pet_matches m on m.id=c.match_id where c.id=p_conversation_id for share of m;
  if v_match.id is null or v_match.unmatched_at is not null or p_sender_pet_id not in(v_match.pet_low_id,v_match.pet_high_id) then raise exception 'active_match_required'; end if;
  v_other_pet:=case when p_sender_pet_id=v_match.pet_low_id then v_match.pet_high_id else v_match.pet_low_id end;
  if public.is_blocked(p_sender_pet_id,v_other_pet) then raise exception 'blocked'; end if;
  if not exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id=v_other_pet and u.suspended_at is null and u.paused_at is null) then raise exception 'recipient_unavailable'; end if;
  select tier into v_tier from public.users where id=v_uid for update;
  select u.tier into v_other_tier from public.pets p join public.users u on u.id=p.owner_id where p.id=v_other_pet;
  if v_tier='standard' and v_other_tier='premium' then
    select exists(select 1 from public.messages m where m.conversation_id=p_conversation_id and m.sender_pet_id=v_other_pet and m.moderation_status='approved') into v_courtesy;
  end if;
  if v_tier='standard' and not v_courtesy then
    update public.users set free_messages_sent=free_messages_sent+1 where id=v_uid and free_messages_sent<2;
    if not found then raise exception 'free_message_limit_reached'; end if;
  end if;
  insert into public.messages(conversation_id,sender_pet_id,body,moderation_status) values(p_conversation_id,p_sender_pet_id,v_body,'pending') returning * into v_msg;
  insert into public.moderation_items(target_type,target_id,status) values('message_text',v_msg.id,'pending') on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null,provider=null,score=null,next_attempt_at=now(),manual_review_required=false;
  return jsonb_build_object('id',v_msg.id,'conversationId',v_msg.conversation_id,'senderPetId',v_msg.sender_pet_id,'body',v_msg.body,'createdAt',v_msg.created_at,'readAt',v_msg.read_at,'moderationStatus',v_msg.moderation_status,'premiumReplyCourtesy',v_courtesy);
end $$;
revoke all on function public.send_message(uuid,uuid,text) from public,anon;
grant execute on function public.send_message(uuid,uuid,text) to authenticated;

create or replace function public.create_community_event(
  p_pet_id uuid,p_title text,p_description text,p_city text,p_district text,p_neighborhood text,
  p_starts_at timestamptz,p_ends_at timestamptz default null,p_capacity integer default null,
  p_event_kind text default 'community',p_recurrence text default 'none'
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_title text:=trim(coalesce(p_title,'')); v_description text:=trim(coalesce(p_description,'')); v_city text:=trim(coalesce(p_city,'')); v_district text:=trim(coalesce(p_district,'')); v_neighborhood text:=trim(coalesce(p_neighborhood,'')); v_tier public.account_tier;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select u.tier into v_tier from public.pets p join public.users u on u.id=p.owner_id where p.id=p_pet_id;
  if v_tier<>'premium' then raise exception 'premium_event_organizer_required'; end if;
  perform public.rate_limit('create_event',10,86400);
  if p_event_kind not in ('community','walk','playdate','education') or p_recurrence not in ('none','weekly') then raise exception 'invalid_event_kind'; end if;
  if char_length(v_title) not between 3 and 120 then raise exception 'invalid_event_title'; end if;
  if char_length(v_description)>1500 then raise exception 'event_description_too_long'; end if;
  if char_length(v_city) not between 1 and 80 or char_length(v_district) not between 1 and 80 or char_length(v_neighborhood)>80 then raise exception 'invalid_event_location'; end if;
  if p_starts_at<=now() then raise exception 'future_time_required'; end if;
  if p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'invalid_event_end'; end if;
  if p_capacity is not null and p_capacity not between 2 and 500 then raise exception 'invalid_capacity'; end if;
  insert into public.pet_events(creator_pet_id,title,description,city,district,neighborhood,starts_at,ends_at,capacity,moderation_status,event_kind,recurrence)
  values(p_pet_id,v_title,v_description,v_city,v_district,nullif(v_neighborhood,''),p_starts_at,p_ends_at,p_capacity,'pending',p_event_kind,p_recurrence) returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status) values('event_text',v_id,'pending') on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id,metadata) values(auth.uid(),p_pet_id,'premium_event_created','event',v_id,jsonb_build_object('kind',p_event_kind,'recurrence',p_recurrence));
  return v_id;
end $$;
revoke all on function public.create_community_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer,text,text) from public,anon;
grant execute on function public.create_community_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer,text,text) to authenticated;

-- Preserve old client signature, but enforce the same premium server rule.
create or replace function public.create_pet_event(
  p_pet_id uuid,p_title text,p_description text,p_city text,p_district text,p_neighborhood text,
  p_starts_at timestamptz,p_ends_at timestamptz default null,p_capacity integer default null
) returns uuid language sql security definer set search_path='' as $$
  select public.create_community_event(p_pet_id,p_title,p_description,p_city,p_district,p_neighborhood,p_starts_at,p_ends_at,p_capacity,'community','none');
$$;
revoke all on function public.create_pet_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.create_pet_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer) to authenticated;

create or replace function public.get_pet_events_page(p_pet_id uuid,p_limit integer default 30,p_after_starts_at timestamptz default null,p_after_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'creatorPetId',e.creator_pet_id,'title',e.title,'description',e.description,'city',e.city,'district',e.district,'neighborhood',e.neighborhood,
    'startsAt',e.starts_at,'endsAt',e.ends_at,'capacity',e.capacity,'eventKind',e.event_kind,'recurrence',e.recurrence,
    'hostPlaceId',e.host_place_id,'hostPlaceName',place.name,'attendeeCount',(select count(*) from public.event_attendees a where a.event_id=e.id),
    'myStatus',(select a.status from public.event_attendees a where a.event_id=e.id and a.pet_id=p_pet_id)
  ) order by e.starts_at,e.id),'[]'::jsonb)
  from (
    select e.* from public.pet_events e join public.pets creator on creator.id=e.creator_pet_id join public.users u on u.id=creator.owner_id
    where public.owns_pet(p_pet_id) and e.moderation_status='approved' and e.starts_at>now() and creator.moderation_status='approved' and u.suspended_at is null and u.paused_at is null
      and not public.is_blocked(p_pet_id,e.creator_pet_id) and (p_after_starts_at is null or (e.starts_at,e.id)>(p_after_starts_at,coalesce(p_after_id,'00000000-0000-0000-0000-000000000000'::uuid)))
    order by e.starts_at,e.id limit least(greatest(p_limit,1),50)
  ) e left join public.pet_friendly_places place on place.id=e.host_place_id and place.active;
$$;
revoke all on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) to authenticated;

create or replace function public.create_lost_pet_alert(p_pet_id uuid,p_last_seen_at timestamptz,p_radius_km numeric default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.pets; priv public.pet_private; v_id uuid; v_radius numeric:=least(greatest(coalesce(p_radius_km,5),1),25); r record; v_distance numeric;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_last_seen_at>now()+interval '5 minutes' or p_last_seen_at<now()-interval '30 days' then raise exception 'invalid_last_seen_time'; end if;
  select * into p from public.pets where id=p_pet_id;
  select * into priv from public.pet_private where pet_id=p_pet_id;
  if priv.latitude is null or priv.longitude is null then raise exception 'private_location_required'; end if;
  perform public.rate_limit('lost_pet_alert',3,86400);
  update public.lost_pet_alerts set status='cancelled' where pet_id=p_pet_id and status='active';
  insert into public.lost_pet_alerts(pet_id,owner_user_id,last_seen_at,city,district,neighborhood,alert_radius_km,latitude,longitude)
  values(p.id,auth.uid(),p_last_seen_at,p.city,p.district,p.neighborhood,v_radius,priv.latitude,priv.longitude) returning id into v_id;
  for r in
    select distinct u.id as user_id,pp.latitude,pp.longitude from public.pets rp join public.users u on u.id=rp.owner_id join public.pet_private pp on pp.pet_id=rp.id
    where u.id<>auth.uid() and u.suspended_at is null and u.paused_at is null and pp.latitude is not null and pp.longitude is not null
  loop
    v_distance:=public.haversine_km(priv.latitude,priv.longitude,r.latitude,r.longitude);
    if v_distance<=v_radius then
      insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id)
      values(r.user_id,'lost_pet','Lost pet alert','A pet was reported missing near you.',v_id,format('lost_pet:%s:%s',v_id,r.user_id),'lost_pet',jsonb_build_object('petName',p.name,'district',p.district,'neighborhood',coalesce(p.neighborhood,'')),p.id)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end loop;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p.id,'lost_pet_alert_created','lost_pet_alert',v_id);
  return jsonb_build_object('id',v_id,'status','active');
end $$;
revoke all on function public.create_lost_pet_alert(uuid,timestamptz,numeric) from public,anon;
grant execute on function public.create_lost_pet_alert(uuid,timestamptz,numeric) to authenticated;

create or replace function public.resolve_lost_pet_alert(p_alert_id uuid,p_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  update public.lost_pet_alerts set status='resolved',resolved_at=now() where id=p_alert_id and pet_id=p_pet_id and owner_user_id=auth.uid() and status='active';
  if not found then raise exception 'active_alert_not_found'; end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'lost_pet_alert_resolved','lost_pet_alert',p_alert_id);
end $$;
revoke all on function public.resolve_lost_pet_alert(uuid,uuid) from public,anon;
grant execute on function public.resolve_lost_pet_alert(uuid,uuid) to authenticated;

create or replace function public.get_nearby_lost_pet_alerts(p_pet_id uuid,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare mine public.pet_private; v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into mine from public.pet_private where pet_id=p_pet_id;
  if mine.latitude is null or mine.longitude is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'petId',x.pet_id,'petName',x.pet_name,'breed',x.breed,'species',x.species,'photoPath',x.photo_path,'lastSeenAt',x.last_seen_at,
    'city',x.city,'district',x.district,'neighborhood',x.neighborhood,'approximateDistanceKm',round(x.distance_km::numeric,1),'createdAt',x.created_at,'isMine',x.owner_user_id=auth.uid()
  ) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select a.*,p.name pet_name,p.breed,p.species::text species,(select ph.storage_path from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved' order by ph.sort_order limit 1) photo_path,
      public.haversine_km(mine.latitude,mine.longitude,a.latitude,a.longitude) distance_km
    from public.lost_pet_alerts a join public.pets p on p.id=a.pet_id join public.users u on u.id=p.owner_id
    where a.status='active' and u.suspended_at is null and p.moderation_status='approved'
  ) x where x.distance_km<=x.alert_radius_km order by x.created_at desc limit least(greatest(p_limit,1),50);
  return v_result;
end $$;
revoke all on function public.get_nearby_lost_pet_alerts(uuid,integer) from public,anon;
grant execute on function public.get_nearby_lost_pet_alerts(uuid,integer) to authenticated;

create or replace function public.get_pet_friendly_places(p_pet_id uuid,p_category text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare mine public.pet_private; p public.pets; v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into p from public.pets where id=p_pet_id; select * into mine from public.pet_private where pet_id=p_pet_id;
  if p_category is not null and p_category not in ('park','cafe','restaurant','veterinary','groomer','trainer','hotel','shop','other') then raise exception 'invalid_place_category'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'name',x.name,'category',x.category,'city',x.city,'district',x.district,'neighborhood',x.neighborhood,'addressLabel',x.address_label,
    'latitude',x.latitude,'longitude',x.longitude,'websiteUrl',x.website_url,'bookingUrl',x.booking_url,'petPolicySummary',x.pet_policy_summary,
    'verificationPartner',x.verification_partner,'verified',x.verified,'partnershipTier',x.partnership_tier,'sponsorshipDisclosure',x.sponsorship_disclosure,
    'approximateDistanceKm',case when x.distance_km is null then null else round(x.distance_km::numeric,1) end
  ) order by x.distance_km nulls last,x.partnership_rank desc,x.name),'[]'::jsonb) into v_result
  from (
    select place.*,case place.partnership_tier when 'event_host' then 2 when 'featured' then 1 else 0 end partnership_rank,
      case when mine.latitude is null or mine.longitude is null then null else public.haversine_km(mine.latitude,mine.longitude,place.latitude,place.longitude) end distance_km
    from public.pet_friendly_places place where place.active and (p_category is null or place.category=p_category)
      and (public.normalize_search_text(place.city)=public.normalize_search_text(p.city) or (mine.latitude is not null and mine.longitude is not null and public.haversine_km(mine.latitude,mine.longitude,place.latitude,place.longitude)<=50))
  ) x limit least(greatest(p_limit,1),100);
  return v_result;
end $$;
revoke all on function public.get_pet_friendly_places(uuid,text,integer) from public,anon;
grant execute on function public.get_pet_friendly_places(uuid,text,integer) to authenticated;

create or replace function public.track_place_referral(p_place_id uuid,p_source text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_source not in ('places','event','meetup') then raise exception 'invalid_referral_source'; end if;
  if not exists(select 1 from public.pet_friendly_places where id=p_place_id and active) then raise exception 'place_not_found'; end if;
  perform public.rate_limit('place_referral',100,3600);
  insert into public.place_referral_events(place_id,source) values(p_place_id,p_source);
end $$;
revoke all on function public.track_place_referral(uuid,text) from public,anon;
grant execute on function public.track_place_referral(uuid,text) to authenticated;

create or replace function public.get_product_feature_policy()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.legal_country_runtime; f public.jurisdiction_product_features; v_mating boolean:=false;
begin
  select * into r from public.legal_country_runtime where user_id=auth.uid();
  if r.legal_country_code is not null then select * into f from public.jurisdiction_product_features where country_code=r.legal_country_code; end if;
  v_mating:=coalesce(f.mating_owner_arranged_enabled,false) and coalesce(f.counsel_approved,false) and coalesce(f.animal_welfare_review_complete,false) and coalesce(f.kinship_control_complete,false) and f.effective_at<=now() and f.expires_at>now();
  return jsonb_build_object('matingOwnerArrangedEnabled',v_mating,'petSalesEnabled',false,'commercialBreedingEnabled',false,'catsInDiscovery',false,'premiumEventCreation',true,'lostPetAlertsFree',true,'safetyFeaturesFree',true);
end $$;
revoke all on function public.get_product_feature_policy() from public,anon;
grant execute on function public.get_product_feature_policy() to authenticated;

alter table public.pet_friendly_places enable row level security;
alter table public.place_referral_events enable row level security;
alter table public.lost_pet_alerts enable row level security;
alter table public.community_launch_zones enable row level security;
alter table public.community_waitlist enable row level security;
alter table public.jurisdiction_product_features enable row level security;
revoke all on public.pet_friendly_places,public.place_referral_events,public.lost_pet_alerts,public.community_launch_zones,public.community_waitlist,public.jurisdiction_product_features from anon,authenticated;

-- No-sale invariant for UGC. Tailmance is not an animal marketplace or commercial-breeding lead generator.
create or replace function public.reject_pet_commerce_ugc()
returns trigger language plpgsql set search_path='' as $$
declare v_text text:='';
begin
  if tg_table_name='messages' then v_text:=coalesce(new.body,'');
  elsif tg_table_name='posts' then v_text:=coalesce(new.caption,'');
  elsif tg_table_name='comments' then v_text:=coalesce(new.body,'');
  elsif tg_table_name='pet_events' then v_text:=concat_ws(' ',coalesce(new.title,''),coalesce(new.description,''));
  elsif tg_table_name='meetup_requests' then v_text:=concat_ws(' ',coalesce(new.public_place_label,''),coalesce(new.note,''));
  elsif tg_table_name='pets' then v_text:=coalesce(new.bio,'');
  elsif tg_table_name='pet_prompts' then v_text:=coalesce(new.answer,'');
  end if;
  if lower(v_text) ~ '(puppy|kitten|dog|cat|pet)[[:space:]]+(for[[:space:]]+sale|for[[:space:]]+purchase)'
     or lower(v_text) ~ '(sell|selling)[[:space:]]+(my[[:space:]]+)?(puppy|kitten|dog|cat|pet)'
     or lower(v_text) ~ '(breeder|breeding)[[:space:]]+(service|business|listing|offer)'
     or lower(v_text) ~ 'stud[[:space:]]+fee'
     or lower(v_text) ~ '(satılık|satilik)[[:space:]]+(yavru|köpek|kopek|kedi|pet)'
     or lower(v_text) ~ '(yavru|köpek|kopek|kedi)[[:space:]]+(satışı|satisi|satılık|satilik)'
     or lower(v_text) ~ '(damızlık|damizlik)[[:space:]]+(ücret|ucret|ilan|hizmet)'
     or lower(v_text) ~ '(chiot|chaton)[[:space:]]+à[[:space:]]+vendre'
     or lower(v_text) ~ '(welpe|kätzchen|katzenbaby)[[:space:]]+zu[[:space:]]+verkaufen'
     or lower(v_text) ~ '(cucciolo|gattino)[[:space:]]+in[[:space:]]+vendita'
     or v_text ~ '(出售|售卖|售賣).{0,8}(幼犬|小狗|幼猫|幼貓|猫|貓)'
     or v_text ~ '(子犬|子猫).{0,8}(販売|売ります)'
     or v_text ~ '(강아지|고양이).{0,8}(판매|팝니다)'
     or v_text ~ 'ขาย.{0,8}(ลูกสุนัข|ลูกแมว)'
     or lower(v_text) ~ 'jual[[:space:]]+(anak[[:space:]]+anjing|anak[[:space:]]+kucing)'
     or lower(v_text) ~ '(vendo|vender)[[:space:]]+(filhote|cachorro|gato)'
  then raise exception 'pet_commerce_prohibited';
  end if;
  return new;
end $$;

revoke all on function public.reject_pet_commerce_ugc() from public,anon,authenticated;

do $$ declare v_table text; begin
  foreach v_table in array array['messages','posts','comments','pet_events','meetup_requests','pets','pet_prompts'] loop
    execute format('drop trigger if exists trg_no_pet_commerce_%I on public.%I',v_table,v_table);
    execute format('create trigger trg_no_pet_commerce_%I before insert or update on public.%I for each row execute function public.reject_pet_commerce_ugc()',v_table,v_table);
  end loop;
end $$;
