-- Tailmance migration 200: location privacy hardening for every client-visible distance (2026-10-03).
--
-- Before this migration discovery, cached discovery and Pati Radar returned another account's distance rounded
-- to 0.1 km, computed from ~100 m stored coordinates, with no noise; the discovery maxDistanceKm filter accepted
-- arbitrary decimals. A user able to move (or spoof) their own location could trilaterate a pet owner's home to
-- roughly a city block. The product promise is neighbourhood-scale distance only.
--
-- Now every distance shown to another account is computed against the target's location snapped to a private
-- ~1 km grid cell and then bucketed (minimum 1 km; whole km under 10 km; 5 km steps under 50 km; 10 km steps
-- beyond). Distance filters are snapped up to whole kilometres (minimum 1 km). Stored coordinates, radius
-- matching and Travel Mode behaviour are unchanged.

create or replace function public.privacy_snap_location(p_location extensions.geography)
returns extensions.geography language sql immutable parallel safe set search_path='' as $$
  select case when p_location is null then null
    else extensions.ST_SetSRID(extensions.ST_SnapToGrid(p_location::extensions.geometry,0.01),4326)::extensions.geography end
$$;
revoke all on function public.privacy_snap_location(extensions.geography) from public,anon,authenticated;
grant execute on function public.privacy_snap_location(extensions.geography) to service_role;

create or replace function public.privacy_coarse_distance_km(p_km double precision)
returns numeric language sql immutable parallel safe set search_path='' as $$
  select case
    when p_km is null then null
    when p_km < 1.5 then 1::numeric
    when p_km < 10 then round(p_km::numeric,0)
    when p_km < 50 then round(p_km::numeric/5)*5
    else round(p_km::numeric/10)*10
  end
$$;
revoke all on function public.privacy_coarse_distance_km(double precision) from public,anon,authenticated;
grant execute on function public.privacy_coarse_distance_km(double precision) to service_role;

create or replace function public.privacy_display_distance_km(p_viewer extensions.geography,p_target extensions.geography)
returns numeric language sql immutable parallel safe set search_path='' as $$
  select case when p_viewer is null or p_target is null then null
    else public.privacy_coarse_distance_km(extensions.ST_Distance(p_viewer,public.privacy_snap_location(p_target))/1000.0) end
$$;
revoke all on function public.privacy_display_distance_km(extensions.geography,extensions.geography) from public,anon,authenticated;
grant execute on function public.privacy_display_distance_km(extensions.geography,extensions.geography) to service_role;

-- discover_pets_v86: neighbourhood-scale distance only.
CREATE OR REPLACE FUNCTION public.discover_pets_v86(p_active_pet_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_max_distance:=case when nullif(p_filters->>'maxDistanceKm','') is null then null
    else greatest(1::double precision,ceil(nullif(p_filters->>'maxDistanceKm','')::double precision)) end;

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
      'approximateDistanceKm',case when v_private.location is null or r.candidate_location is null then null else public.privacy_display_distance_km(v_private.location,r.candidate_location) end,
      'compatibilityScore',r.compatibility_score
    ) order by r.compatibility_score desc,r.fairness_key
  ),'[]'::jsonb) into v_result from ranked r;

  return v_result;
end $function$;
revoke all on function public.discover_pets_v86(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.discover_pets_v86(uuid,jsonb) to service_role;

-- rehydrate_cached_default_discovery: neighbourhood-scale distance only.
CREATE OR REPLACE FUNCTION public.rehydrate_cached_default_discovery(p_active_pet_id uuid, p_cached_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.pets;
  v_private public.pet_private;
  v_network jsonb;
  v_result jsonb;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_cached_items)<>'array' or jsonb_array_length(p_cached_items)>100 then raise exception 'invalid_cache_page'; end if;
  select * into v_me from public.pets where id=p_active_pet_id;
  if v_me.species<>'dog' then return '[]'::jsonb; end if;
  if exists(select 1 from public.user_travel_mode where user_id=auth.uid() and enabled) then raise exception 'social_cache_bypass'; end if;
  v_network:=public.get_local_network_status(p_active_pet_id);
  if v_network->>'status'='waitlist' then raise exception 'community_zone_waitlisted'; end if;
  select * into v_private from public.pet_private where pet_id=p_active_pet_id;

  with cached as (
    select (x.item->>'id')::uuid as id,x.ord
    from jsonb_array_elements(p_cached_items) with ordinality x(item,ord)
  ), candidates as (
    select
      c.id,c.ord,pp.location as candidate_location,
      least(100,35
        +case when p.species=v_me.species then 15 else 0 end
        +case when p.size=v_me.size then 8 else 0 end
        +least(20,(select count(*)*7 from public.pet_purposes a join public.pet_purposes b on a.purpose=b.purpose where a.pet_id=p_active_pet_id and b.pet_id=p.id and a.purpose<>'mating'))
      )::int as compatibility_score
    from cached c
    join public.pets p on p.id=c.id
    join public.users u on u.id=p.owner_id
    left join public.pet_private pp on pp.pet_id=p.id
    where p.id<>p_active_pet_id
      and p.owner_id<>auth.uid()
      and p.species='dog'
      and p.discovery_enabled
      and p.moderation_status='approved'
      and u.suspended_at is null
      and u.paused_at is null
      and u.discoverable
      and exists(select 1 from public.pet_purposes purpose where purpose.pet_id=p.id and purpose.purpose<>'mating')
      and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3
      and (not u.incognito or exists(select 1 from public.pet_likes il where il.from_pet_id=p.id and il.to_pet_id=p_active_pet_id))
      and not public.is_blocked(p_active_pet_id,p.id)
      and not exists(select 1 from public.pet_passes ps where ps.from_pet_id=p_active_pet_id and ps.to_pet_id=p.id and ps.created_at>now()-interval '30 days')
      and not exists(select 1 from public.pet_matches m where m.unmatched_at is null and m.pet_low_id=least(p_active_pet_id,p.id) and m.pet_high_id=greatest(p_active_pet_id,p.id))
  )
  select coalesce(jsonb_agg(
    public.pet_json(c.id,p_active_pet_id)
      || jsonb_build_object(
        'approximateDistanceKm',case when v_private.location is null or c.candidate_location is null then null else public.privacy_display_distance_km(v_private.location,c.candidate_location) end,
        'compatibilityScore',c.compatibility_score,
        'boosted',exists(select 1 from public.pet_boosts b where b.pet_id=c.id and b.starts_at<=now() and b.ends_at>now())
      )
    order by c.ord
  ),'[]'::jsonb)
  into v_result from candidates c;

  return public.rerank_discovery_with_match_vectors(p_active_pet_id,v_result);
end $function$;
revoke all on function public.rehydrate_cached_default_discovery(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rehydrate_cached_default_discovery(uuid,jsonb) to authenticated;
grant execute on function public.rehydrate_cached_default_discovery(uuid,jsonb) to service_role;

-- get_nearby_lost_pet_alerts: neighbourhood-scale distance only.
CREATE OR REPLACE FUNCTION public.get_nearby_lost_pet_alerts(p_pet_id uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare mine public.pet_private; v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into mine from public.pet_private where pet_id=p_pet_id;
  if mine.location is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'petId',x.pet_id,'petName',x.pet_name,'breed',x.breed,'species',x.species,'photoPath',x.photo_path,'lastSeenAt',x.last_seen_at,
    'city',x.city,'district',x.district,'neighborhood',x.neighborhood,'approximateDistanceKm',public.privacy_display_distance_km(mine.location,x.location),'createdAt',x.created_at,'isMine',x.owner_user_id=auth.uid()
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
end $function$;
revoke all on function public.get_nearby_lost_pet_alerts(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_nearby_lost_pet_alerts(uuid,integer) to authenticated;
grant execute on function public.get_nearby_lost_pet_alerts(uuid,integer) to service_role;
