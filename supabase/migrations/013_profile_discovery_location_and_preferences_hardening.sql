-- A/M boundary hardening: profile payload bounds, concurrency-safe pet cap,
-- deterministic discovery ranking, atomic event capacity and server-side coarse location.
-- Rebase this block onto the recovered canonical migration chain before release.

alter table public.pets drop constraint if exists pets_neighborhood_length_check;
alter table public.pets add constraint pets_neighborhood_length_check
  check (neighborhood is null or char_length(trim(neighborhood)) between 1 and 80) not valid;
alter table public.pets validate constraint pets_neighborhood_length_check;

alter table public.pets drop constraint if exists pets_temperament_tag_count_check;
alter table public.pets add constraint pets_temperament_tag_count_check
  check (cardinality(temperament_tags) <= 12) not valid;
alter table public.pets validate constraint pets_temperament_tag_count_check;

create or replace function public.validate_pet_payload(p_payload jsonb)
returns void language plpgsql stable set search_path='' as $$
declare
  v_birth date;
  v_weight numeric;
  v_energy int;
  v_purposes jsonb;
  v_tags jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'invalid_pet_payload';
  end if;

  if char_length(trim(coalesce(p_payload->>'name',''))) not between 1 and 50
    or char_length(trim(coalesce(p_payload->>'breed',''))) not between 1 and 80
    or char_length(trim(coalesce(p_payload->>'city',''))) not between 1 and 80
    or char_length(trim(coalesce(p_payload->>'district',''))) not between 1 and 80
    or char_length(trim(coalesce(p_payload->>'neighborhood',''))) not between 1 and 80 then
    raise exception 'required_profile_fields_missing';
  end if;

  if char_length(coalesce(p_payload->>'bio',''))>500 then
    raise exception 'bio_too_long';
  end if;

  if nullif(p_payload->>'birthDate','') is null then raise exception 'birth_date_required'; end if;
  begin
    v_birth:=(p_payload->>'birthDate')::date;
  exception when others then
    raise exception 'invalid_birth_date';
  end;
  if v_birth>current_date or v_birth<current_date-interval '35 years' then raise exception 'invalid_birth_date'; end if;

  if coalesce(p_payload->>'species','') not in ('dog','cat') then raise exception 'invalid_species'; end if;
  if coalesce(p_payload->>'sex','') not in ('female','male') then raise exception 'invalid_sex'; end if;
  if coalesce(p_payload->>'size','') not in ('mini','small','medium','large','giant') then raise exception 'invalid_size'; end if;

  v_purposes:=coalesce(p_payload->'purposes','[]'::jsonb);
  if jsonb_typeof(v_purposes)<>'array' or jsonb_array_length(v_purposes) not between 1 and 4 then
    raise exception 'invalid_purposes';
  end if;
  if exists(
    select 1 from jsonb_array_elements_text(v_purposes) x
    where x not in ('socialize','playmate','mating','walk')
  ) then raise exception 'invalid_purposes'; end if;
  if v_purposes ? 'mating' then raise exception 'mating_feature_disabled'; end if;

  v_tags:=coalesce(p_payload->'temperamentTags','[]'::jsonb);
  if jsonb_typeof(v_tags)<>'array' or jsonb_array_length(v_tags)>12 then
    raise exception 'invalid_temperament_tags';
  end if;
  if exists(
    select 1 from jsonb_array_elements_text(v_tags) x
    where char_length(trim(x)) not between 1 and 40
  ) then raise exception 'invalid_temperament_tags'; end if;

  if nullif(p_payload->>'weightKg','') is not null then
    begin v_weight:=(p_payload->>'weightKg')::numeric;
    exception when others then raise exception 'invalid_weight'; end;
    if v_weight<=0 or v_weight>150 then raise exception 'invalid_weight'; end if;
  end if;

  if nullif(p_payload->>'energyLevel','') is not null then
    begin v_energy:=(p_payload->>'energyLevel')::int;
    exception when others then raise exception 'invalid_energy'; end;
    if v_energy not between 1 and 5 then raise exception 'invalid_energy'; end if;
  end if;
end $$;
revoke all on function public.validate_pet_payload(jsonb) from public,anon,authenticated;

create or replace function public.upsert_pet_profile(p_pet_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid:=p_pet_id;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  -- Serialize profile creation per owner so two concurrent creates cannot both pass the five-pet cap.
  perform 1 from public.users where id=auth.uid() and suspended_at is null and paused_at is null for update;
  if not found then raise exception 'account_unavailable'; end if;

  perform public.validate_pet_payload(p_payload);

  if p_pet_id is null then
    perform public.rate_limit('pet_create',10,86400);
    select count(*) into v_count from public.pets where owner_id=auth.uid();
    if v_count>=5 then raise exception 'pet_limit_reached'; end if;

    insert into public.pets(
      owner_id,name,species,breed,sex,birth_date,size,weight_kg,energy_level,
      temperament_tags,bio,city,district,neighborhood,moderation_status
    ) values(
      auth.uid(),trim(p_payload->>'name'),(p_payload->>'species')::public.pet_species,
      trim(p_payload->>'breed'),(p_payload->>'sex')::public.pet_sex,(p_payload->>'birthDate')::date,
      (p_payload->>'size')::public.pet_size,nullif(p_payload->>'weightKg','')::numeric,
      nullif(p_payload->>'energyLevel','')::smallint,
      array(select distinct trim(x) from jsonb_array_elements_text(coalesce(p_payload->'temperamentTags','[]'::jsonb)) x),
      coalesce(p_payload->>'bio',''),trim(p_payload->>'city'),trim(p_payload->>'district'),
      trim(p_payload->>'neighborhood'),'pending'
    ) returning id into v_id;
    insert into public.pet_private(pet_id) values(v_id) on conflict(pet_id) do nothing;
    insert into public.pet_health_summary(pet_id) values(v_id) on conflict(pet_id) do nothing;
  else
    if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
    perform public.rate_limit('pet_profile_update',60,3600);
    update public.pets set
      name=trim(p_payload->>'name'),species=(p_payload->>'species')::public.pet_species,
      breed=trim(p_payload->>'breed'),sex=(p_payload->>'sex')::public.pet_sex,
      birth_date=(p_payload->>'birthDate')::date,size=(p_payload->>'size')::public.pet_size,
      weight_kg=nullif(p_payload->>'weightKg','')::numeric,
      energy_level=nullif(p_payload->>'energyLevel','')::smallint,
      temperament_tags=array(select distinct trim(x) from jsonb_array_elements_text(coalesce(p_payload->'temperamentTags','[]'::jsonb)) x),
      bio=coalesce(p_payload->>'bio',''),city=trim(p_payload->>'city'),district=trim(p_payload->>'district'),
      neighborhood=trim(p_payload->>'neighborhood'),updated_at=now(),moderation_status='pending'
    where id=p_pet_id;
    if not found then raise exception 'pet_not_found'; end if;
  end if;

  delete from public.pet_purposes where pet_id=v_id;
  insert into public.pet_purposes(pet_id,purpose)
  select v_id,(x)::public.pet_purpose from (select distinct jsonb_array_elements_text(p_payload->'purposes') x) q;

  insert into public.moderation_items(target_type,target_id,status)
  values('pet_text',v_id,'pending')
  on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;

  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),v_id,'pet_profile_upsert','pet',v_id);
  return v_id;
end $$;
revoke all on function public.upsert_pet_profile(uuid,jsonb) from public,anon;
grant execute on function public.upsert_pet_profile(uuid,jsonb) to authenticated;

create or replace function public.validate_discovery_filters(p_filters jsonb)
returns void language plpgsql stable set search_path='' as $$
declare
  v jsonb:=coalesce(p_filters,'{}'::jsonb);
  v_key text;
  v_n numeric;
begin
  if jsonb_typeof(v)<>'object' or octet_length(v::text)>12000 then raise exception 'invalid_discovery_filters'; end if;

  foreach v_key in array array['sizes','breeds','energyLevels','temperamentTags','purposes'] loop
    if v ? v_key and jsonb_typeof(v->v_key)<>'array' then raise exception 'invalid_discovery_filters'; end if;
  end loop;
  if jsonb_array_length(coalesce(v->'sizes','[]'::jsonb))>5
    or jsonb_array_length(coalesce(v->'breeds','[]'::jsonb))>50
    or jsonb_array_length(coalesce(v->'energyLevels','[]'::jsonb))>5
    or jsonb_array_length(coalesce(v->'temperamentTags','[]'::jsonb))>20
    or jsonb_array_length(coalesce(v->'purposes','[]'::jsonb))>4 then
    raise exception 'invalid_discovery_filters';
  end if;

  if coalesce(v->>'species','all') not in ('all','dog','cat') then raise exception 'invalid_discovery_filters'; end if;
  if coalesce(v->>'sex','all') not in ('all','female','male') then raise exception 'invalid_discovery_filters'; end if;
  if coalesce(v->>'neutered','all') not in ('all','yes','no') then raise exception 'invalid_discovery_filters'; end if;

  if exists(select 1 from jsonb_array_elements_text(coalesce(v->'sizes','[]'::jsonb)) x where x not in ('mini','small','medium','large','giant')) then raise exception 'invalid_discovery_filters'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(v->'purposes','[]'::jsonb)) x where x not in ('socialize','playmate','mating','walk')) then raise exception 'invalid_discovery_filters'; end if;
  if coalesce(v->'purposes','[]'::jsonb) ? 'mating' then raise exception 'mating_feature_disabled'; end if;

  foreach v_key in array array['minAge','maxAge','minWeightKg','maxWeightKg','maxDistanceKm'] loop
    if nullif(v->>v_key,'') is not null then
      begin v_n:=(v->>v_key)::numeric;
      exception when others then raise exception 'invalid_discovery_filters'; end;
      if v_n<0 then raise exception 'invalid_discovery_filters'; end if;
      if v_key in ('minAge','maxAge') and v_n>35 then raise exception 'invalid_discovery_filters'; end if;
      if v_key in ('minWeightKg','maxWeightKg') and v_n>150 then raise exception 'invalid_discovery_filters'; end if;
      if v_key='maxDistanceKm' and v_n>20000 then raise exception 'invalid_discovery_filters'; end if;
    end if;
  end loop;

  if nullif(v->>'minAge','') is not null and nullif(v->>'maxAge','') is not null
     and (v->>'minAge')::numeric>(v->>'maxAge')::numeric then raise exception 'invalid_discovery_filters'; end if;
  if nullif(v->>'minWeightKg','') is not null and nullif(v->>'maxWeightKg','') is not null
     and (v->>'minWeightKg')::numeric>(v->>'maxWeightKg')::numeric then raise exception 'invalid_discovery_filters'; end if;
end $$;
revoke all on function public.validate_discovery_filters(jsonb) from public,anon,authenticated;

create or replace function public.discover_pets(p_active_pet_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_me public.pets;
  v_private public.pet_private;
  v_me_health public.pet_health_summary;
  v_result jsonb;
  v_max_distance double precision;
  v_lat_delta double precision;
  v_lon_delta double precision;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pet_purposes pp where pp.pet_id=p_active_pet_id and pp.purpose<>'mating') then raise exception 'profile_purpose_unavailable'; end if;
  perform public.validate_discovery_filters(p_filters);
  select * into v_me from public.pets where id=p_active_pet_id;
  select * into v_private from public.pet_private where pet_id=p_active_pet_id;
  select * into v_me_health from public.pet_health_summary where pet_id=p_active_pet_id;
  v_max_distance:=nullif(p_filters->>'maxDistanceKm','')::double precision;
  if v_max_distance is not null and v_private.latitude is not null and v_private.longitude is not null then
    v_lat_delta:=least(180.0,v_max_distance/111.32);
    v_lon_delta:=case
      when abs(cos(radians(v_private.latitude)))<0.01 then 180.0
      else least(180.0,v_max_distance/(111.32*abs(cos(radians(v_private.latitude)))))
    end;
  end if;

  with candidates as (
    select
      p.id,pp.latitude as candidate_latitude,pp.longitude as candidate_longitude,
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
      and exists(select 1 from public.pet_purposes enabled_purpose where enabled_purpose.pet_id=p.id and enabled_purpose.purpose<>'mating')
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
      and (coalesce((p_filters->>'veterinarianVerifiedOnly')::boolean,false)=false or h.veterinarian_verified)
      and (coalesce((p_filters->>'profileVerifiedOnly')::boolean,false)=false or p.profile_verified)
      and (coalesce((p_filters->>'ownerVerifiedOnly')::boolean,false)=false or u.identity_verified)
      and (coalesce((p_filters->>'microchipVerifiedOnly')::boolean,false)=false or h.microchip_verified)
      and (coalesce((p_filters->>'geneticScreeningOnly')::boolean,false)=false or h.genetic_screening_available)
      and (coalesce((p_filters->>'pedigreeOnly')::boolean,false)=false or h.pedigree_available)
      and (coalesce(p_filters->>'neutered','all')='all' or (p_filters->>'neutered'='yes' and h.neutered=true) or (p_filters->>'neutered'='no' and h.neutered=false))
      and (jsonb_array_length(coalesce(p_filters->'purposes','[]'::jsonb))=0 or exists(select 1 from public.pet_purposes x where x.pet_id=p.id and x.purpose::text in (select jsonb_array_elements_text(p_filters->'purposes'))))
      and (v_max_distance is null or (
        v_private.latitude is not null and v_private.longitude is not null and pp.latitude is not null and pp.longitude is not null
        and pp.latitude between greatest(-90.0,v_private.latitude-v_lat_delta) and least(90.0,v_private.latitude+v_lat_delta)
        and (
          v_lon_delta>=180.0
          or (v_private.longitude-v_lon_delta>=-180.0 and v_private.longitude+v_lon_delta<=180.0 and pp.longitude between v_private.longitude-v_lon_delta and v_private.longitude+v_lon_delta)
          or (v_private.longitude-v_lon_delta< -180.0 and (pp.longitude>=v_private.longitude-v_lon_delta+360.0 or pp.longitude<=v_private.longitude+v_lon_delta))
          or (v_private.longitude+v_lon_delta> 180.0 and (pp.longitude>=v_private.longitude-v_lon_delta or pp.longitude<=v_private.longitude+v_lon_delta-360.0))
        )
        and public.haversine_km(v_private.latitude,v_private.longitude,pp.latitude,pp.longitude)<=v_max_distance
      ))
  ), ranked as (
    -- Preserve compatibility ranking while rotating equal-score exposure deterministically each day.
    -- This avoids permanently favoring the same UUID ordering among otherwise equivalent candidates.
    select c.*,md5(p_active_pet_id::text||':'||c.id::text||':'||current_date::text) as fairness_key
    from candidates c
    order by compatibility_score desc,fairness_key
    limit 100
  )
  select coalesce(jsonb_agg(
    public.pet_json(r.id,p_active_pet_id) || jsonb_build_object(
      'approximateDistanceKm',case when v_private.latitude is null or r.candidate_latitude is null then null else round(public.haversine_km(v_private.latitude,v_private.longitude,r.candidate_latitude,r.candidate_longitude)::numeric,1) end,
      'compatibilityScore',r.compatibility_score
    ) order by r.compatibility_score desc,r.fairness_key
  ),'[]'::jsonb) into v_result from ranked r;

  return v_result;
end $$;
revoke all on function public.discover_pets(uuid,jsonb) from public,anon;
grant execute on function public.discover_pets(uuid,jsonb) to authenticated;

create or replace function public.set_event_attendance(p_event_id uuid,p_pet_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_creator_pet uuid;
  v_capacity integer;
  v_going integer;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_status not in ('none','going','interested') then raise exception 'invalid_status'; end if;
  perform public.rate_limit('event_attendance',100,86400);

  -- Lock the event row so concurrent final-seat claims serialize around the capacity check.
  select e.creator_pet_id,e.capacity into v_creator_pet,v_capacity
  from public.pet_events e
  where e.id=p_event_id and e.moderation_status='approved' and e.starts_at>now()
  for update;
  if v_creator_pet is null or public.is_blocked(p_pet_id,v_creator_pet) then raise exception 'not_found'; end if;

  if p_status='none' then
    delete from public.event_attendees where event_id=p_event_id and pet_id=p_pet_id;
    return;
  end if;

  if p_status='going' and v_capacity is not null then
    select count(*) into v_going from public.event_attendees
    where event_id=p_event_id and status='going' and pet_id<>p_pet_id;
    if v_going>=v_capacity then raise exception 'event_full'; end if;
  end if;

  insert into public.event_attendees(event_id,pet_id,status)
  values(p_event_id,p_pet_id,p_status::public.event_attendance_status)
  on conflict(event_id,pet_id) do update set status=excluded.status;
end $$;
revoke all on function public.set_event_attendance(uuid,uuid,text) from public,anon;
grant execute on function public.set_event_attendance(uuid,uuid,text) to authenticated;

create or replace function public.update_pet_private_location(p_pet_id uuid,p_latitude double precision,p_longitude double precision)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_lat double precision;
  v_lon double precision;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'invalid_coordinates'; end if;
  perform public.rate_limit('private_location_update',120,86400);

  -- Enforce the same coarse precision server-side even if a modified client submits exact GPS values.
  v_lat:=round(p_latitude::numeric,3)::double precision;
  v_lon:=round(p_longitude::numeric,3)::double precision;
  insert into public.pet_private(pet_id,latitude,longitude) values(p_pet_id,v_lat,v_lon)
  on conflict(pet_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now();
end $$;
revoke all on function public.update_pet_private_location(uuid,double precision,double precision) from public,anon;
grant execute on function public.update_pet_private_location(uuid,double precision,double precision) to authenticated;

