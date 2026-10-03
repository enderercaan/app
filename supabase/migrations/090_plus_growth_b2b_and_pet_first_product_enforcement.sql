-- Tailmance v19 R8: Plus product entitlements, consumables, travel mode,
-- discovery boosts and contextual B2B monetization.
-- Safety utilities remain free. Animal sales and commercial breeding remain prohibited.

create table if not exists public.consumable_balances (
  user_id uuid primary key references public.users(id) on delete cascade,
  boost_credits integer not null default 0 check (boost_credits between 0 and 10000),
  super_like_credits integer not null default 0 check (super_like_credits between 0 and 10000),
  updated_at timestamptz not null default now()
);

create table if not exists public.consumable_credit_ledger (
  event_key text primary key check (char_length(trim(event_key)) between 8 and 240),
  user_id uuid not null references public.users(id) on delete cascade,
  credit_kind text not null check (credit_kind in ('boost','super_like')),
  quantity integer not null check (quantity between 1 and 1000),
  store_product_id text,
  granted_at timestamptz not null default now()
);
create index if not exists idx_consumable_credit_ledger_user on public.consumable_credit_ledger(user_id,granted_at desc);

create table if not exists public.user_travel_mode (
  user_id uuid primary key references public.users(id) on delete cascade,
  zone_id uuid not null references public.community_launch_zones(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.pet_boosts (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('premium_weekly','consumable_credit')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at>starts_at and ends_at<=starts_at+interval '2 hours')
);
create index if not exists idx_pet_boosts_active on public.pet_boosts(pet_id,ends_at desc);
create index if not exists idx_pet_boosts_user_weekly on public.pet_boosts(user_id,starts_at desc) where source='premium_weekly';

-- B2B monetization is contextual, clearly disclosed and never animal commerce.
create table if not exists public.business_partner_profiles (
  id uuid primary key default gen_random_uuid(),
  place_id uuid unique references public.pet_friendly_places(id) on delete cascade,
  business_type text not null check (business_type in ('pet_friendly_place','veterinary','groomer','trainer','brand')),
  display_name text not null check (char_length(trim(display_name)) between 2 and 140),
  plan text not null default 'free' check (plan in ('free','featured','professional','verification_partner')),
  website_url text,
  appointment_url text,
  verification_partner boolean not null default false,
  verified boolean not null default false,
  active boolean not null default true,
  sponsorship_disclosure text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (website_url is null or website_url ~ '^https://'),
  check (appointment_url is null or appointment_url ~ '^https://'),
  check (plan='free' or sponsorship_disclosure is not null)
);

create table if not exists public.contextual_brand_campaigns (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.business_partner_profiles(id) on delete cascade,
  campaign_name text not null check (char_length(trim(campaign_name)) between 2 and 140),
  context_category text not null check (context_category in ('event','place','food','accessory','health','training','grooming')),
  disclosure text not null check (char_length(trim(disclosure)) between 2 and 240),
  contextual_only boolean not null default true check (contextual_only=true),
  personalized_targeting boolean not null default false check (personalized_targeting=false),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at>starts_at)
);

create table if not exists public.event_commercial_offers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pet_events(id) on delete cascade,
  partner_id uuid not null references public.business_partner_profiles(id) on delete cascade,
  offer_type text not null check (offer_type in ('external_ticket','sponsorship','sample')),
  external_booking_url text,
  display_price_minor integer check (display_price_minor is null or display_price_minor>=0),
  currency char(3),
  commission_bps integer not null default 0 check (commission_bps between 0 and 3000),
  disclosure text not null check (char_length(trim(disclosure)) between 2 and 240),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (external_booking_url is null or external_booking_url ~ '^https://'),
  check (offer_type<>'external_ticket' or external_booking_url is not null),
  check ((display_price_minor is null and currency is null) or (display_price_minor is not null and currency ~ '^[A-Z]{3}$'))
);
create unique index if not exists event_commercial_offers_one_active_type on public.event_commercial_offers(event_id,offer_type) where active;

create table if not exists public.commercial_referral_events (
  id bigint generated always as identity primary key,
  offer_id uuid not null references public.event_commercial_offers(id) on delete cascade,
  source text not null check (source in ('event_ticket','event_sponsor','event_sample')),
  occurred_at timestamptz not null default now()
);
create index if not exists idx_commercial_referral_events_offer on public.commercial_referral_events(offer_id,occurred_at desc);

alter table public.consumable_balances enable row level security;
alter table public.consumable_credit_ledger enable row level security;
alter table public.user_travel_mode enable row level security;
alter table public.pet_boosts enable row level security;
alter table public.business_partner_profiles enable row level security;
alter table public.contextual_brand_campaigns enable row level security;
alter table public.event_commercial_offers enable row level security;
alter table public.commercial_referral_events enable row level security;
revoke all on public.consumable_balances,public.consumable_credit_ledger,public.user_travel_mode,public.pet_boosts,public.business_partner_profiles,public.contextual_brand_campaigns,public.event_commercial_offers,public.commercial_referral_events from anon,authenticated;
grant all on public.consumable_balances,public.consumable_credit_ledger,public.user_travel_mode,public.pet_boosts,public.business_partner_profiles,public.contextual_brand_campaigns,public.event_commercial_offers,public.commercial_referral_events to service_role;

-- RevenueCat/webhook service-only idempotent consumable credit grant.
create or replace function public.grant_consumable_credit(
  p_user_id uuid,p_event_key text,p_credit_kind text,p_quantity integer,p_store_product_id text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_inserted integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_credit_kind not in ('boost','super_like') or p_quantity not between 1 and 1000 or char_length(trim(coalesce(p_event_key,'')))<8 then raise exception 'invalid_credit_grant'; end if;
  insert into public.consumable_credit_ledger(event_key,user_id,credit_kind,quantity,store_product_id)
  values(trim(p_event_key),p_user_id,p_credit_kind,p_quantity,nullif(trim(coalesce(p_store_product_id,'')),''))
  on conflict(event_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then return false; end if;
  insert into public.consumable_balances(user_id,boost_credits,super_like_credits)
  values(p_user_id,case when p_credit_kind='boost' then p_quantity else 0 end,case when p_credit_kind='super_like' then p_quantity else 0 end)
  on conflict(user_id) do update set
    boost_credits=public.consumable_balances.boost_credits+case when p_credit_kind='boost' then p_quantity else 0 end,
    super_like_credits=public.consumable_balances.super_like_credits+case when p_credit_kind='super_like' then p_quantity else 0 end,
    updated_at=now();
  return true;
end $$;
revoke all on function public.grant_consumable_credit(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.grant_consumable_credit(uuid,text,text,integer,text) to service_role;

create or replace function public.get_consumable_wallet()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'boostCredits',coalesce(b.boost_credits,0),
    'superLikeCredits',coalesce(b.super_like_credits,0)
  ) end
  from (select 1) q left join public.consumable_balances b on b.user_id=auth.uid();
$$;
revoke all on function public.get_consumable_wallet() from public,anon;
grant execute on function public.get_consumable_wallet() to authenticated;

create or replace function public.get_available_travel_zones()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null then null else coalesce(jsonb_agg(jsonb_build_object(
    'id',z.id,'city',z.city,'district',z.district,'neighborhood',z.neighborhood,'pilot',z.launch_status='pilot_open'
  ) order by z.city,z.district,z.neighborhood),'[]'::jsonb) end
  from public.community_launch_zones z
  where z.active and z.launch_status in ('pilot_open','open');
$$;
revoke all on function public.get_available_travel_zones() from public,anon;
grant execute on function public.get_available_travel_zones() to authenticated;

create or replace function public.get_travel_mode(p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.user_travel_mode; z public.community_launch_zones; v_tier public.account_tier;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select tier into v_tier from public.users where id=auth.uid();
  select * into v from public.user_travel_mode where user_id=auth.uid() and enabled;
  if v.user_id is null or v_tier<>'premium' then return jsonb_build_object('enabled',false); end if;
  select * into z from public.community_launch_zones where id=v.zone_id and active and launch_status in ('pilot_open','open');
  if z.id is null then return jsonb_build_object('enabled',false); end if;
  return jsonb_build_object('enabled',true,'zoneId',z.id,'city',z.city,'district',z.district,'neighborhood',z.neighborhood,'pilot',z.launch_status='pilot_open');
end $$;
revoke all on function public.get_travel_mode(uuid) from public,anon;
grant execute on function public.get_travel_mode(uuid) to authenticated;

create or replace function public.set_travel_mode(p_pet_id uuid,p_zone_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare z public.community_launch_zones; v_tier public.account_tier;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select tier into v_tier from public.users where id=auth.uid();
  if not coalesce(p_enabled,false) then
    delete from public.user_travel_mode where user_id=auth.uid();
    return jsonb_build_object('enabled',false);
  end if;
  if v_tier<>'premium' then raise exception 'premium_required'; end if;
  select * into z from public.community_launch_zones where id=p_zone_id and active and launch_status in ('pilot_open','open');
  if z.id is null then raise exception 'travel_zone_unavailable'; end if;
  perform public.rate_limit('travel_mode_change',20,86400);
  insert into public.user_travel_mode(user_id,zone_id,enabled,updated_at) values(auth.uid(),z.id,true,now())
  on conflict(user_id) do update set zone_id=excluded.zone_id,enabled=true,updated_at=now();
  return jsonb_build_object('enabled',true,'zoneId',z.id,'city',z.city,'district',z.district,'neighborhood',z.neighborhood,'pilot',z.launch_status='pilot_open');
end $$;
revoke all on function public.set_travel_mode(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_travel_mode(uuid,uuid,boolean) to authenticated;

create or replace function public.activate_pet_boost(p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tier public.account_tier; v_source text; v_id uuid; v_ends timestamptz;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pets where id=p_pet_id and species='dog') then raise exception 'boost_discovery_dogs_only'; end if;
  select tier into v_tier from public.users where id=auth.uid();
  if exists(select 1 from public.pet_boosts where pet_id=p_pet_id and ends_at>now()) then raise exception 'boost_already_active'; end if;
  perform public.rate_limit('activate_boost',10,86400);
  if v_tier='premium' and not exists(
    select 1 from public.pet_boosts where user_id=auth.uid() and source='premium_weekly' and starts_at>=date_trunc('week',now())
  ) then
    v_source:='premium_weekly';
  else
    update public.consumable_balances set boost_credits=boost_credits-1,updated_at=now()
      where user_id=auth.uid() and boost_credits>0;
    if not found then raise exception 'boost_credit_required'; end if;
    v_source:='consumable_credit';
  end if;
  v_ends:=now()+interval '30 minutes';
  insert into public.pet_boosts(pet_id,user_id,source,ends_at) values(p_pet_id,auth.uid(),v_source,v_ends) returning id into v_id;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'pet_boost_activated','pet_boost',v_id);
  return jsonb_build_object('id',v_id,'source',v_source,'endsAt',v_ends);
end $$;
revoke all on function public.activate_pet_boost(uuid) from public,anon;
grant execute on function public.activate_pet_boost(uuid) to authenticated;

create or replace function public.get_pet_boost_status(p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.pet_boosts; v_weekly_used boolean; v_tier public.account_tier; v_boost_credits integer:=0; v_super_credits integer:=0;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select tier into v_tier from public.users where id=auth.uid();
  select * into b from public.pet_boosts where pet_id=p_pet_id and ends_at>now() order by ends_at desc limit 1;
  select exists(select 1 from public.pet_boosts where user_id=auth.uid() and source='premium_weekly' and starts_at>=date_trunc('week',now())) into v_weekly_used;
  select coalesce(boost_credits,0),coalesce(super_like_credits,0) into v_boost_credits,v_super_credits from public.consumable_balances where user_id=auth.uid();
  return jsonb_build_object('active',b.id is not null,'endsAt',b.ends_at,'source',b.source,'premiumWeeklyAvailable',v_tier='premium' and not v_weekly_used,'boostCredits',coalesce(v_boost_credits,0),'superLikeCredits',coalesce(v_super_credits,0));
end $$;
revoke all on function public.get_pet_boost_status(uuid) from public,anon;
grant execute on function public.get_pet_boost_status(uuid) to authenticated;

-- A Standard account may keep its existing pets after downgrade, but creating pet #2+ is Plus-only.
create or replace function public.enforce_pet_insert_product_access()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_tier public.account_tier; v_existing integer:=0;
begin
  if auth.role()='authenticated' then
    if auth.uid() is null or new.owner_id is distinct from auth.uid() or not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
    select tier into v_tier from public.users where id=auth.uid();
    select count(*) into v_existing from public.pets where owner_id=auth.uid();
    if v_existing>=1 and v_tier<>'premium' then raise exception 'premium_required_multiple_pets'; end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_pet_insert_product_access() from public,anon,authenticated;

create or replace function public.discovery_filters_use_premium_features(p_filters jsonb)
returns boolean language sql immutable set search_path='' as $$
  select
    jsonb_array_length(coalesce(p_filters->'sizes','[]'::jsonb))>0
    or jsonb_array_length(coalesce(p_filters->'energyLevels','[]'::jsonb))>0
    or coalesce((p_filters->>'vaccinatedOnly')::boolean,false)
    or coalesce((p_filters->>'veterinarianVerifiedOnly')::boolean,false)
    or coalesce((p_filters->>'profileVerifiedOnly')::boolean,false)
    or coalesce((p_filters->>'ownerVerifiedOnly')::boolean,false)
    or coalesce((p_filters->>'microchipVerifiedOnly')::boolean,false)
    or coalesce((p_filters->>'geneticScreeningOnly')::boolean,false)
    or coalesce((p_filters->>'pedigreeOnly')::boolean,false);
$$;
revoke all on function public.discovery_filters_use_premium_features(jsonb) from public,anon,authenticated;

create or replace function public.current_mating_feature_enabled()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare r public.legal_country_runtime; f public.jurisdiction_product_features;
begin
  select * into r from public.legal_country_runtime where user_id=auth.uid();
  if r.legal_country_code is null or r.resolution_status<>'verified' then return false; end if;
  select * into f from public.jurisdiction_product_features where country_code=r.legal_country_code;
  return coalesce(f.mating_owner_arranged_enabled,false) and coalesce(f.counsel_approved,false)
    and coalesce(f.animal_welfare_review_complete,false) and coalesce(f.kinship_control_complete,false)
    and f.effective_at<=now() and f.expires_at>now() and nullif(trim(f.evidence_reference),'') is not null;
end $$;
revoke all on function public.current_mating_feature_enabled() from public,anon,authenticated;

-- Product-aware discovery wrapper: dogs only, dense-zone policy, Plus filters/travel, mating fail-closed and boost ordering.
create or replace function public.discover_pets(p_active_pet_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  p public.pets; v_status jsonb; v_filters jsonb:=coalesce(p_filters,'{}'::jsonb); v_tier public.account_tier;
  v_travel public.user_travel_mode; v_zone public.community_launch_zones; v_travel_enabled boolean:=false; v_raw jsonb; v_result jsonb;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  select * into p from public.pets where id=p_active_pet_id;
  if p.species<>'dog' then return '[]'::jsonb; end if;
  select tier into v_tier from public.users where id=auth.uid();
  if public.discovery_filters_use_premium_features(v_filters) and v_tier<>'premium' then raise exception 'premium_required_advanced_filters'; end if;
  if coalesce(v_filters->'purposes','[]'::jsonb) ? 'mating' and not public.current_mating_feature_enabled() then raise exception 'mating_not_available'; end if;

  if v_tier='premium' then
    select * into v_travel from public.user_travel_mode where user_id=auth.uid() and enabled;
    if v_travel.user_id is not null then
      select * into v_zone from public.community_launch_zones where id=v_travel.zone_id and active and launch_status in ('pilot_open','open');
      if v_zone.id is not null then v_travel_enabled:=true; end if;
    end if;
  end if;

  if v_travel_enabled then
    v_filters:=jsonb_set(v_filters,'{city}',to_jsonb(v_zone.city),true);
    v_filters:=jsonb_set(v_filters,'{district}',to_jsonb(v_zone.district),true);
    v_filters:=jsonb_set(v_filters,'{neighborhood}',to_jsonb(v_zone.neighborhood),true);
    v_filters:=jsonb_set(v_filters,'{maxDistanceKm}','null'::jsonb,true);
  else
    v_status:=public.get_local_network_status(p_active_pet_id);
    if v_status->>'status'='waitlist' then raise exception 'community_zone_waitlisted'; end if;
    if (nullif(v_filters->>'city','') is not null and public.normalize_search_text(v_filters->>'city')<>public.normalize_search_text(p.city))
       or (nullif(v_filters->>'district','') is not null and public.normalize_search_text(v_filters->>'district')<>public.normalize_search_text(p.district))
       or (nullif(v_filters->>'neighborhood','') is not null and public.normalize_search_text(v_filters->>'neighborhood')<>public.normalize_search_text(coalesce(p.neighborhood,''))) then
      raise exception 'travel_mode_required';
    end if;
  end if;

  v_filters:=jsonb_set(v_filters,'{species}','"dog"'::jsonb,true);
  v_raw:=public.discover_pets_v86(p_active_pet_id,v_filters);
  select coalesce(jsonb_agg(
    (case when v_travel_enabled then x.item-'approximateDistanceKm' else x.item end)
      || jsonb_build_object('boosted',b.pet_id is not null)
    order by (b.pet_id is not null) desc,x.ord
  ),'[]'::jsonb) into v_result
  from jsonb_array_elements(v_raw) with ordinality x(item,ord)
  left join lateral (
    select pb.pet_id from public.pet_boosts pb
    where pb.pet_id=(x.item->>'id')::uuid and pb.starts_at<=now() and pb.ends_at>now()
    order by pb.ends_at desc limit 1
  ) b on true;
  return v_result;
end $$;
revoke all on function public.discover_pets(uuid,jsonb) from public,anon;
grant execute on function public.discover_pets(uuid,jsonb) to authenticated;

-- Likes remain product-unlimited for Premium; the high ceiling is abuse protection, not a product quota.
-- Standard keeps the existing 200/day anti-abuse/product ceiling. Consumable Super Likes work without Premium.
create or replace function public.like_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_kind public.like_kind default 'like')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_match_id uuid; v_low uuid:=least(p_from_pet_id,p_to_pet_id); v_high uuid:=greatest(p_from_pet_id,p_to_pet_id);
  v_other_owner uuid; v_matched boolean:=false; v_tier public.account_tier;
begin
  if not public.owns_pet(p_from_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pets where id=p_from_pet_id and species='dog') then raise exception 'dog_discovery_only'; end if;
  if not exists(select 1 from public.pets where id=p_to_pet_id and species='dog') then raise exception 'target_unavailable'; end if;
  if not exists(select 1 from public.pet_purposes pp where pp.pet_id=p_from_pet_id and pp.purpose<>'mating') then raise exception 'own_profile_purpose_unavailable'; end if;
  if not exists(select 1 from public.pet_purposes pp where pp.pet_id=p_to_pet_id and pp.purpose<>'mating') then raise exception 'target_unavailable'; end if;
  if p_from_pet_id=p_to_pet_id or public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'invalid_target'; end if;
  select tier into v_tier from public.users where id=auth.uid();

  if not exists(select 1 from public.pets p where p.id=p_from_pet_id and p.moderation_status='approved' and p.discovery_enabled and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3) then raise exception 'own_profile_not_discovery_ready'; end if;
  if not exists(
    select 1 from public.pets p join public.users u on u.id=p.owner_id
    where p.id=p_to_pet_id and p.owner_id<>auth.uid() and p.species='dog' and p.moderation_status='approved' and p.discovery_enabled
      and u.suspended_at is null and u.paused_at is null and u.discoverable
      and (not u.incognito or exists(select 1 from public.pet_likes prior where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id))
      and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3
  ) then raise exception 'target_unavailable'; end if;

  if p_kind='super_like' then
    perform public.rate_limit('super_like',20,86400);
    if v_tier<>'premium' then
      update public.consumable_balances set super_like_credits=super_like_credits-1,updated_at=now() where user_id=auth.uid() and super_like_credits>0;
      if not found then raise exception 'super_like_credit_required'; end if;
    end if;
  else
    perform public.rate_limit('like',case when v_tier='premium' then 1000 else 200 end,86400);
  end if;

  insert into public.pet_likes(from_pet_id,to_pet_id,kind) values(p_from_pet_id,p_to_pet_id,p_kind)
  on conflict(from_pet_id,to_pet_id) do update set kind=excluded.kind,created_at=now();
  delete from public.pet_passes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;

  if exists(select 1 from public.pet_likes where from_pet_id=p_to_pet_id and to_pet_id=p_from_pet_id) then
    insert into public.pet_matches(pet_low_id,pet_high_id) values(v_low,v_high)
    on conflict(pet_low_id,pet_high_id) do update set unmatched_at=null,unmatched_by_pet_id=null,matched_at=now() returning id into v_match_id;
    insert into public.conversations(match_id) values(v_match_id) on conflict(match_id) do nothing;
    v_matched:=true;
    select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
    insert into public.notifications(user_id,type,title,body,entity_id) values(auth.uid(),'match','New match 🐾','Your pets liked each other and matched.',v_match_id);
    if v_other_owner<>auth.uid() then insert into public.notifications(user_id,type,title,body,entity_id) values(v_other_owner,'match','New match 🐾','Your pets liked each other and matched.',v_match_id); end if;
  else
    select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
    if v_other_owner is not null then insert into public.notifications(user_id,type,title,body,entity_id) values(v_other_owner,'like','New pet interest','One of your pets received a like.',p_from_pet_id); end if;
  end if;
  return jsonb_build_object('matched',v_matched,'match_id',v_match_id);
end $$;
revoke all on function public.like_pet(uuid,uuid,public.like_kind) from public,anon;
grant execute on function public.like_pet(uuid,uuid,public.like_kind) to authenticated;

create or replace function public.get_pet_friendly_places(p_pet_id uuid,p_category text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare mine public.pet_private; p public.pets; v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into p from public.pets where id=p_pet_id; select * into mine from public.pet_private where pet_id=p_pet_id;
  if p_category is not null and p_category not in ('park','cafe','restaurant','veterinary','groomer','trainer','hotel','shop','other') then raise exception 'invalid_place_category'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'name',x.name,'category',x.category,'city',x.city,'district',x.district,'neighborhood',x.neighborhood,'addressLabel',x.address_label,
    'latitude',x.latitude,'longitude',x.longitude,'websiteUrl',coalesce(x.partner_website_url,x.website_url),'bookingUrl',coalesce(x.appointment_url,x.booking_url),'petPolicySummary',x.pet_policy_summary,
    'verificationPartner',x.verification_partner or coalesce(x.partner_verification_partner,false),'verified',x.verified or coalesce(x.partner_verified,false),
    'partnershipTier',x.partnership_tier,'sponsorshipDisclosure',coalesce(x.partner_disclosure,x.sponsorship_disclosure),
    'businessPlan',x.business_plan,'appointmentUrl',x.appointment_url,
    'approximateDistanceKm',case when x.distance_km is null then null else round(x.distance_km::numeric,1) end
  ) order by x.distance_km nulls last,x.partnership_rank desc,x.name),'[]'::jsonb) into v_result
  from (
    select place.*,case place.partnership_tier when 'event_host' then 2 when 'featured' then 1 else 0 end partnership_rank,
      case when mine.latitude is null or mine.longitude is null then null else public.haversine_km(mine.latitude,mine.longitude,place.latitude,place.longitude) end distance_km,
      bp.plan business_plan,bp.website_url partner_website_url,bp.appointment_url,bp.verification_partner partner_verification_partner,bp.verified partner_verified,bp.sponsorship_disclosure partner_disclosure
    from public.pet_friendly_places place left join public.business_partner_profiles bp on bp.place_id=place.id and bp.active
    where place.active and (p_category is null or place.category=p_category)
      and (public.normalize_search_text(place.city)=public.normalize_search_text(p.city) or (mine.latitude is not null and mine.longitude is not null and public.haversine_km(mine.latitude,mine.longitude,place.latitude,place.longitude)<=50))
  ) x limit least(greatest(p_limit,1),100);
  return v_result;
end $$;
revoke all on function public.get_pet_friendly_places(uuid,text,integer) from public,anon;
grant execute on function public.get_pet_friendly_places(uuid,text,integer) to authenticated;

create or replace function public.get_pet_events_page(p_pet_id uuid,p_limit integer default 30,p_after_starts_at timestamptz default null,p_after_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'creatorPetId',e.creator_pet_id,'title',e.title,'description',e.description,'city',e.city,'district',e.district,'neighborhood',e.neighborhood,
    'startsAt',e.starts_at,'endsAt',e.ends_at,'capacity',e.capacity,'eventKind',e.event_kind,'recurrence',e.recurrence,
    'hostPlaceId',e.host_place_id,'hostPlaceName',place.name,'attendeeCount',(select count(*) from public.event_attendees a where a.event_id=e.id),
    'myStatus',(select a.status from public.event_attendees a where a.event_id=e.id and a.pet_id=p_pet_id),
    'commercialOffer',case when offer.id is null then null else jsonb_build_object('id',offer.id,'type',offer.offer_type,'bookingUrl',offer.external_booking_url,'priceMinor',offer.display_price_minor,'currency',offer.currency,'disclosure',offer.disclosure) end
  ) order by e.starts_at,e.id),'[]'::jsonb)
  from (
    select e.* from public.pet_events e join public.pets creator on creator.id=e.creator_pet_id join public.users u on u.id=creator.owner_id
    where public.owns_pet(p_pet_id) and e.moderation_status='approved' and e.starts_at>now() and creator.moderation_status='approved' and u.suspended_at is null and u.paused_at is null
      and not public.is_blocked(p_pet_id,e.creator_pet_id) and (p_after_starts_at is null or (e.starts_at,e.id)>(p_after_starts_at,coalesce(p_after_id,'00000000-0000-0000-0000-000000000000'::uuid)))
    order by e.starts_at,e.id limit least(greatest(p_limit,1),50)
  ) e
  left join public.pet_friendly_places place on place.id=e.host_place_id and place.active
  left join lateral (select o.* from public.event_commercial_offers o where o.event_id=e.id and o.active order by case o.offer_type when 'external_ticket' then 1 when 'sponsorship' then 2 else 3 end limit 1) offer on true;
$$;
revoke all on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) to authenticated;

create or replace function public.track_commercial_referral(p_offer_id uuid,p_source text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_source not in ('event_ticket','event_sponsor','event_sample') then raise exception 'invalid_referral_source'; end if;
  if not exists(select 1 from public.event_commercial_offers where id=p_offer_id and active) then raise exception 'offer_not_found'; end if;
  perform public.rate_limit('commercial_referral',100,3600);
  insert into public.commercial_referral_events(offer_id,source) values(p_offer_id,p_source);
end $$;
revoke all on function public.track_commercial_referral(uuid,text) from public,anon;
grant execute on function public.track_commercial_referral(uuid,text) to authenticated;

create or replace function public.get_product_feature_policy()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  return jsonb_build_object(
    'matingOwnerArrangedEnabled',public.current_mating_feature_enabled(),
    'petSalesEnabled',false,'commercialBreedingEnabled',false,'catsInDiscovery',false,
    'premiumEventCreation',true,'lostPetAlertsFree',true,'safetyFeaturesFree',true,
    'multiplePetsPremium',true,'advancedFiltersPremium',true,'travelModePremium',true,
    'boostsEnabled',true,'consumablePacksEnabled',true,'contextualAdsOnly',true,'petFirstNoHumanDating',true
  );
end $$;
revoke all on function public.get_product_feature_policy() from public,anon;
grant execute on function public.get_product_feature_policy() to authenticated;
