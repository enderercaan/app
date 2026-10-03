-- Tailmance v19 R8: PostGIS-backed privacy-preserving spatial indexing.
-- Exact pet coordinates remain private in pet_private. Client-visible results expose only rounded distances.
-- PostGIS is intentionally installed in the non-Data-API `extensions` schema.

create schema if not exists extensions;

do $$
declare v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  where e.extname='postgis';

  if v_schema is null then
    execute 'create extension postgis with schema extensions';
  elsif v_schema <> 'extensions' then
    raise exception 'postgis_must_be_installed_in_extensions_schema';
  end if;
end $$;

alter table public.pet_private
  add column if not exists location extensions.geography(Point,4326);
alter table public.lost_pet_alerts
  add column if not exists location extensions.geography(Point,4326);
alter table public.pet_friendly_places
  add column if not exists location extensions.geography(Point,4326);

-- Normalize impossible legacy half-coordinate rows before enforcing synchronized spatial state.
update public.pet_private
set latitude=null,longitude=null
where (latitude is null) <> (longitude is null);

update public.pet_private
set location=case
  when latitude is null or longitude is null then null
  else extensions.ST_SetSRID(extensions.ST_MakePoint(longitude,latitude),4326)::extensions.geography
end;
update public.lost_pet_alerts
set location=extensions.ST_SetSRID(extensions.ST_MakePoint(longitude,latitude),4326)::extensions.geography;
update public.pet_friendly_places
set location=extensions.ST_SetSRID(extensions.ST_MakePoint(longitude,latitude),4326)::extensions.geography;

alter table public.lost_pet_alerts alter column location set not null;
alter table public.pet_friendly_places alter column location set not null;

alter table public.pet_private drop constraint if exists pet_private_coordinate_pair_check;
alter table public.pet_private add constraint pet_private_coordinate_pair_check
  check ((latitude is null and longitude is null and location is null)
      or (latitude is not null and longitude is not null and location is not null)) not valid;
alter table public.pet_private validate constraint pet_private_coordinate_pair_check;

create or replace function public.sync_lat_lon_geography()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.latitude is null or new.longitude is null then
    if tg_table_name <> 'pet_private' then raise exception 'coordinates_required'; end if;
    new.latitude:=null;
    new.longitude:=null;
    new.location:=null;
  else
    if new.latitude not between -90 and 90 or new.longitude not between -180 and 180 then raise exception 'invalid_coordinates'; end if;
    new.location:=extensions.ST_SetSRID(extensions.ST_MakePoint(new.longitude,new.latitude),4326)::extensions.geography;
  end if;
  return new;
end $$;
revoke all on function public.sync_lat_lon_geography() from public,anon,authenticated;

drop trigger if exists trg_pet_private_sync_geography on public.pet_private;
create trigger trg_pet_private_sync_geography
before insert or update of latitude,longitude on public.pet_private
for each row execute function public.sync_lat_lon_geography();

drop trigger if exists trg_lost_pet_alerts_sync_geography on public.lost_pet_alerts;
create trigger trg_lost_pet_alerts_sync_geography
before insert or update of latitude,longitude on public.lost_pet_alerts
for each row execute function public.sync_lat_lon_geography();

drop trigger if exists trg_pet_friendly_places_sync_geography on public.pet_friendly_places;
create trigger trg_pet_friendly_places_sync_geography
before insert or update of latitude,longitude on public.pet_friendly_places
for each row execute function public.sync_lat_lon_geography();

create index if not exists idx_pet_private_location_gist
  on public.pet_private using gist(location) where location is not null;
create index if not exists idx_lost_pet_alerts_location_gist
  on public.lost_pet_alerts using gist(location) where status='active';
create index if not exists idx_pet_friendly_places_location_gist
  on public.pet_friendly_places using gist(location) where active;

-- Mature discovery implementation, upgraded from manual degree bounding boxes + Haversine
-- to index-aware geography predicates. It retains every product/safety/mating/health gate.
create or replace function public.discover_pets_v86(p_active_pet_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_me public.pets;
  v_private public.pet_private;
  v_me_health public.pet_health_summary;
  v_result jsonb;
  v_max_distance double precision;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pet_purposes pp where pp.pet_id=p_active_pet_id and pp.purpose<>'mating')
     and not (public.current_mating_feature_enabled() and exists(select 1 from public.pet_purposes pp where pp.pet_id=p_active_pet_id and pp.purpose='mating'))
  then raise exception 'profile_purpose_unavailable'; end if;
  perform public.validate_discovery_filters(p_filters);
  select * into v_me from public.pets where id=p_active_pet_id;
  if v_me.species<>'dog' then return '[]'::jsonb; end if;
  select * into v_private from public.pet_private where pet_id=p_active_pet_id;
  select * into v_me_health from public.pet_health_summary where pet_id=p_active_pet_id;
  v_max_distance:=nullif(p_filters->>'maxDistanceKm','')::double precision;

  with candidates as (
    select
      p.id,pp.location as candidate_location,
      least(100,35
        + case when p.species=v_me.species then 15 else 0 end
        + case when p.size=v_me.size then 8 else 0 end
        + least(20,(select count(*)*7 from public.pet_purposes a join public.pet_purposes b on a.purpose=b.purpose where a.pet_id=p_active_pet_id and b.pet_id=p.id and a.purpose<>'mating'))
      )::int as compatibility_score
    from public.pets p
    join public.users u on u.id=p.owner_id and u.suspended_at is null and u.paused_at is null and u.discoverable
    left join public.pet_private pp on pp.pet_id=p.id
    left join public.pet_health_summary h on h.pet_id=p.id
    where p.id<>p_active_pet_id and p.owner_id<>auth.uid() and p.discovery_enabled and p.moderation_status='approved'
      and p.species='dog'
      and (exists(select 1 from public.pet_purposes enabled_purpose where enabled_purpose.pet_id=p.id and enabled_purpose.purpose<>'mating')
        or (coalesce(p_filters->'purposes','[]'::jsonb) ? 'mating' and public.mating_pair_profile_signals_eligible(p_active_pet_id,p.id)))
      and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3
      and (not u.incognito or exists(select 1 from public.pet_likes il where il.from_pet_id=p.id and il.to_pet_id=p_active_pet_id))
      and not public.is_blocked(p_active_pet_id,p.id)
      and not exists(select 1 from public.pet_passes ps where ps.from_pet_id=p_active_pet_id and ps.to_pet_id=p.id and ps.created_at>now()-interval '30 days')
      and not exists(select 1 from public.pet_matches m where m.unmatched_at is null and m.pet_low_id=least(p_active_pet_id,p.id) and m.pet_high_id=greatest(p_active_pet_id,p.id))
      and (coalesce(p_filters->>'species','all')='all' or p.species::text=p_filters->>'species')
      and (coalesce(p_filters->>'sex','all')='all' or p.sex::text=p_filters->>'sex')
      and (jsonb_array_length(coalesce(p_filters->'sizes','[]'::jsonb))=0 or p.size::text in (select jsonb_array_elements_text(p_filters->'sizes')))
      and (jsonb_array_length(coalesce(p_filters->'breeds','[]'::jsonb))=0 or public.normalize_search_text(p.breed) in (select public.normalize_search_text(x) from jsonb_array_elements_text(p_filters->'breeds') x))
      and (nullif(p_filters->>'minAge','') is null or (p.birth_date is not null and extract(year from age(current_date,p.birth_date)) >= (p_filters->>'minAge')::int))
      and (nullif(p_filters->>'maxAge','') is null or (p.birth_date is not null and extract(year from age(current_date,p.birth_date)) <= (p_filters->>'maxAge')::int))
      and (nullif(p_filters->>'minWeightKg','') is null or (p.weight_kg is not null and p.weight_kg >= (p_filters->>'minWeightKg')::numeric))
      and (nullif(p_filters->>'maxWeightKg','') is null or (p.weight_kg is not null and p.weight_kg <= (p_filters->>'maxWeightKg')::numeric))
      and (jsonb_array_length(coalesce(p_filters->'energyLevels','[]'::jsonb))=0 or p.energy_level::text in (select jsonb_array_elements_text(p_filters->'energyLevels')))
      and (jsonb_array_length(coalesce(p_filters->'temperamentTags','[]'::jsonb))=0 or exists(select 1 from unnest(p.temperament_tags) t where public.normalize_search_text(t) in (select public.normalize_search_text(x) from jsonb_array_elements_text(p_filters->'temperamentTags') x)))
      and (nullif(p_filters->>'city','') is null or public.normalize_search_text(p.city)=public.normalize_search_text(p_filters->>'city'))
      and (nullif(p_filters->>'district','') is null or public.normalize_search_text(p.district)=public.normalize_search_text(p_filters->>'district'))
      and (nullif(p_filters->>'neighborhood','') is null or public.normalize_search_text(coalesce(p.neighborhood,''))=public.normalize_search_text(p_filters->>'neighborhood'))
      and (coalesce((p_filters->>'vaccinatedOnly')::boolean,false)=false or h.vaccination_status='complete')
      and (coalesce((p_filters->>'veterinarianVerifiedOnly')::boolean,false)=false or public.has_current_veterinarian_verification(p.id))
      and (coalesce((p_filters->>'profileVerifiedOnly')::boolean,false)=false or p.profile_verified)
      and (coalesce((p_filters->>'ownerVerifiedOnly')::boolean,false)=false or u.identity_verified)
      and (coalesce((p_filters->>'microchipVerifiedOnly')::boolean,false)=false or h.microchip_verified)
      and (coalesce((p_filters->>'geneticScreeningOnly')::boolean,false)=false or h.genetic_screening_available)
      and (coalesce((p_filters->>'pedigreeOnly')::boolean,false)=false or h.pedigree_available)
      and (coalesce(p_filters->>'neutered','all')='all' or (p_filters->>'neutered'='yes' and h.neutered=true) or (p_filters->>'neutered'='no' and h.neutered=false))
      and (jsonb_array_length(coalesce(p_filters->'purposes','[]'::jsonb))=0 or exists(select 1 from public.pet_purposes x where x.pet_id=p.id and x.purpose::text in (select jsonb_array_elements_text(p_filters->'purposes'))))
      and (v_max_distance is null or (
        v_private.location is not null and pp.location is not null
        and extensions.ST_DWithin(v_private.location,pp.location,v_max_distance*1000.0)
      ))
  ), ranked as (
    select c.*,md5(p_active_pet_id::text||':'||c.id::text||':'||current_date::text) as fairness_key
    from candidates c
    order by compatibility_score desc,fairness_key
    limit 100
  )
  select coalesce(jsonb_agg(
    public.pet_json(r.id,p_active_pet_id) || jsonb_build_object(
      'approximateDistanceKm',case when v_private.location is null or r.candidate_location is null then null else round((extensions.ST_Distance(v_private.location,r.candidate_location)/1000.0)::numeric,1) end,
      'compatibilityScore',r.compatibility_score
    ) order by r.compatibility_score desc,r.fairness_key
  ),'[]'::jsonb) into v_result from ranked r;

  return v_result;
end $$;
revoke all on function public.discover_pets_v86(uuid,jsonb) from public,anon,authenticated;

-- Pati Radar recipient fanout uses the private GIST index and returns rounded distance only.
create or replace function public.create_lost_pet_alert(p_pet_id uuid,p_last_seen_at timestamptz,p_radius_km numeric default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  p public.pets;
  priv public.pet_private;
  v_id uuid;
  v_radius numeric:=least(greatest(coalesce(p_radius_km,5),1),25);
  r record;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_last_seen_at>now()+interval '5 minutes' or p_last_seen_at<now()-interval '30 days' then raise exception 'invalid_last_seen_time'; end if;
  select * into p from public.pets where id=p_pet_id for update;
  if p.id is null then raise exception 'forbidden'; end if;
  select * into priv from public.pet_private where pet_id=p_pet_id;
  if priv.location is null then raise exception 'private_location_required'; end if;

  perform public.rate_limit('lost_pet_alert',3,86400);
  update public.lost_pet_alerts set status='cancelled' where pet_id=p_pet_id and status='active';
  insert into public.lost_pet_alerts(pet_id,owner_user_id,last_seen_at,city,district,neighborhood,alert_radius_km,latitude,longitude)
  values(p.id,auth.uid(),p_last_seen_at,p.city,p.district,p.neighborhood,v_radius,priv.latitude,priv.longitude)
  returning id into v_id;

  for r in
    select distinct on (u.id)
      u.id as user_id,
      rp.id as recipient_pet_id,
      extensions.ST_Distance(priv.location,pp.location)/1000.0 as distance_km
    from public.pets rp
    join public.users u on u.id=rp.owner_id
    join public.pet_private pp on pp.pet_id=rp.id
    where u.id<>auth.uid()
      and u.suspended_at is null and u.paused_at is null
      and rp.moderation_status='approved'
      and pp.location is not null
      and not public.is_blocked(p.id,rp.id)
      and extensions.ST_DWithin(priv.location,pp.location,v_radius*1000.0)
    order by u.id,distance_km asc,rp.id
  loop
    insert into public.notifications(
      user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id,recipient_pet_id
    ) values(
      r.user_id,'lost_pet','Lost pet alert','A pet was reported missing near you.',v_id,
      format('lost_pet:%s:%s',v_id,r.user_id),'lost_pet',
      jsonb_build_object('petName',p.name,'district',p.district,'neighborhood',coalesce(p.neighborhood,'')),
      p.id,r.recipient_pet_id
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end loop;

  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p.id,'lost_pet_alert_created','lost_pet_alert',v_id);
  return jsonb_build_object('id',v_id,'status','active');
end $$;
revoke all on function public.create_lost_pet_alert(uuid,timestamptz,numeric) from public,anon,authenticated;

create or replace function public.get_nearby_lost_pet_alerts(p_pet_id uuid,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare mine public.pet_private; v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into mine from public.pet_private where pet_id=p_pet_id;
  if mine.location is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'petId',x.pet_id,'petName',x.pet_name,'breed',x.breed,'species',x.species,'photoPath',x.photo_path,'lastSeenAt',x.last_seen_at,
    'city',x.city,'district',x.district,'neighborhood',x.neighborhood,'approximateDistanceKm',round(x.distance_km::numeric,1),'createdAt',x.created_at,'isMine',x.owner_user_id=auth.uid()
  ) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select a.*,p.name pet_name,p.breed,p.species::text species,
      (select ph.storage_path from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved' order by ph.sort_order limit 1) photo_path,
      extensions.ST_Distance(mine.location,a.location)/1000.0 distance_km
    from public.lost_pet_alerts a
    join public.pets p on p.id=a.pet_id
    join public.users u on u.id=p.owner_id
    where a.status='active'
      and u.suspended_at is null and u.paused_at is null
      and p.moderation_status='approved'
      and not public.is_blocked(p_pet_id,a.pet_id)
      and extensions.ST_DWithin(mine.location,a.location,a.alert_radius_km*1000.0)
    order by a.created_at desc
    limit least(greatest(p_limit,1),50)
  ) x;
  return v_result;
end $$;
revoke all on function public.get_nearby_lost_pet_alerts(uuid,integer) from public,anon;
grant execute on function public.get_nearby_lost_pet_alerts(uuid,integer) to authenticated;

-- Nearby place discovery also uses GIST when the user's private location is available.
create or replace function public.get_pet_friendly_places(p_pet_id uuid,p_category text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare mine public.pet_private; p public.pets; v_result jsonb; v_paid_promotions boolean:=false;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  v_paid_promotions:=public.current_paid_promotion_visibility_enabled();
  select * into p from public.pets where id=p_pet_id;
  select * into mine from public.pet_private where pet_id=p_pet_id;
  if p_category is not null and p_category not in ('park','cafe','restaurant','veterinary','groomer','trainer','hotel','shop','other') then raise exception 'invalid_place_category'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'name',x.name,'category',x.category,'city',x.city,'district',x.district,'neighborhood',x.neighborhood,'addressLabel',x.address_label,
    'latitude',x.latitude,'longitude',x.longitude,
    'websiteUrl',case when x.partner_entitled then coalesce(x.partner_website_url,x.website_url) else x.website_url end,
    'bookingUrl',case when x.partner_entitled then coalesce(x.appointment_url,x.booking_url) else x.booking_url end,
    'petPolicySummary',x.pet_policy_summary,
    'verificationPartner',x.verification_partner or (x.partner_entitled and coalesce(x.partner_verification_partner,false)),
    'verified',x.verified or (x.partner_entitled and coalesce(x.partner_verified,false)),
    'partnershipTier',case when x.partner_entitled then x.partnership_tier else 'organic' end,
    'sponsorshipDisclosure',case when x.partner_entitled then coalesce(x.partner_disclosure,x.sponsorship_disclosure) else null end,
    'businessPlan',case when x.partner_entitled then x.business_plan else 'free' end,
    'appointmentUrl',case when x.partner_entitled then x.appointment_url else null end,
    'approximateDistanceKm',case when x.distance_km is null then null else round(x.distance_km::numeric,1) end
  ) order by x.distance_km nulls last,case when x.partner_entitled then x.partnership_rank else 0 end desc,x.name),'[]'::jsonb) into v_result
  from (
    select place.*,case place.partnership_tier when 'event_host' then 2 when 'featured' then 1 else 0 end partnership_rank,
      case when mine.location is null then null else extensions.ST_Distance(mine.location,place.location)/1000.0 end distance_km,
      bp.plan business_plan,bp.website_url partner_website_url,bp.appointment_url,bp.verification_partner partner_verification_partner,bp.verified partner_verified,bp.sponsorship_disclosure partner_disclosure,
      case when bp.id is null then false else v_paid_promotions and public.business_partner_entitlement_active(bp.id) end partner_entitled
    from public.pet_friendly_places place left join public.business_partner_profiles bp on bp.place_id=place.id and bp.active
    where place.active and (p_category is null or place.category=p_category)
      and (public.normalize_search_text(place.city)=public.normalize_search_text(p.city)
        or (mine.location is not null and extensions.ST_DWithin(mine.location,place.location,50000.0)))
  ) x limit least(greatest(p_limit,1),100);
  return v_result;
end $$;
revoke all on function public.get_pet_friendly_places(uuid,text,integer) from public,anon;
grant execute on function public.get_pet_friendly_places(uuid,text,integer) to authenticated;

comment on column public.pet_private.location is
  'Private PostGIS geography point derived from exact owner-supplied coordinates. Never expose through public pet JSON.';
comment on column public.lost_pet_alerts.location is
  'Server-side PostGIS point used for Pati Radar radius matching; client output is rounded approximate distance only.';
comment on column public.pet_friendly_places.location is
  'PostGIS point for public place proximity/indexed queries.';
