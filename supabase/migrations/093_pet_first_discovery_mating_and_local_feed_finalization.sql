-- Tailmance v19 R8: final pet-first discovery, owner-arranged mating safety signals and local retention feed.
-- Mating remains fail-closed unless country counsel/welfare/kinship gates in 088/090 are explicitly current.
-- Tailmance does not sell animals, broker stud fees, arrange breeding, or make veterinary fitness decisions.

do $$ begin
  if to_regprocedure('public.validate_pet_payload_v92(jsonb)') is null then
    alter function public.validate_pet_payload(jsonb) rename to validate_pet_payload_v92;
  end if;
  if to_regprocedure('public.validate_discovery_filters_v92(jsonb)') is null then
    alter function public.validate_discovery_filters(jsonb) rename to validate_discovery_filters_v92;
  end if;
end $$;
revoke all on function public.validate_pet_payload_v92(jsonb) from public,anon,authenticated;
revoke all on function public.validate_discovery_filters_v92(jsonb) from public,anon,authenticated;

create or replace function public.validate_pet_payload(p_payload jsonb)
returns void language plpgsql stable security definer set search_path='' as $$
declare v_purposes jsonb:=coalesce(p_payload->'purposes','[]'::jsonb); v_sanitized jsonb:=p_payload;
begin
  if jsonb_typeof(v_purposes)<>'array' then raise exception 'invalid_purposes'; end if;
  if v_purposes ? 'mating' then
    if coalesce(p_payload->>'species','')<>'dog' then raise exception 'mating_not_available_for_species'; end if;
    if not public.current_mating_feature_enabled() then raise exception 'mating_feature_disabled'; end if;
    v_sanitized:=jsonb_set(p_payload,'{purposes}',coalesce((select jsonb_agg(x) from jsonb_array_elements_text(v_purposes) x where x<>'mating'),'[]'::jsonb),true);
    if jsonb_array_length(v_sanitized->'purposes')=0 then
      -- The mature validator requires at least one non-mating social purpose. Validate with a temporary
      -- social purpose while preserving the caller payload for storage after the jurisdiction gate passes.
      v_sanitized:=jsonb_set(v_sanitized,'{purposes}','["socialize"]'::jsonb,true);
    end if;
  end if;
  perform public.validate_pet_payload_v92(v_sanitized);
end $$;
revoke all on function public.validate_pet_payload(jsonb) from public,anon,authenticated;

create or replace function public.validate_discovery_filters(p_filters jsonb)
returns void language plpgsql stable security definer set search_path='' as $$
declare v jsonb:=coalesce(p_filters,'{}'::jsonb); v_purposes jsonb:=coalesce(v->'purposes','[]'::jsonb); v_sanitized jsonb:=v;
begin
  if jsonb_typeof(v_purposes)<>'array' then raise exception 'invalid_discovery_filters'; end if;
  if v_purposes ? 'mating' then
    if not public.current_mating_feature_enabled() then raise exception 'mating_feature_disabled'; end if;
    v_sanitized:=jsonb_set(v,'{purposes}',coalesce((select jsonb_agg(x) from jsonb_array_elements_text(v_purposes) x where x<>'mating'),'[]'::jsonb),true);
  end if;
  perform public.validate_discovery_filters_v92(v_sanitized);
end $$;
revoke all on function public.validate_discovery_filters(jsonb) from public,anon,authenticated;

create or replace function public.mating_pair_profile_signals_eligible(p_from_pet_id uuid,p_to_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_mating_feature_enabled()
    and exists(
      select 1
      from public.pets a
      join public.pet_health_summary ah on ah.pet_id=a.id
      join public.pets b on b.id=p_to_pet_id
      join public.pet_health_summary bh on bh.pet_id=b.id
      where a.id=p_from_pet_id
        and a.species='dog' and b.species='dog' and a.sex<>b.sex
        and ah.neutered is false and bh.neutered is false
        and ah.vaccination_status='complete' and bh.vaccination_status='complete'
        and ah.veterinarian_verified=true and bh.veterinarian_verified=true
        and exists(select 1 from public.pet_purposes x where x.pet_id=a.id and x.purpose='mating')
        and exists(select 1 from public.pet_purposes x where x.pet_id=b.id and x.purpose='mating')
    );
$$;
revoke all on function public.mating_pair_profile_signals_eligible(uuid,uuid) from public,anon,authenticated;


create or replace function public.discover_pets_v86(p_active_pet_id uuid,p_filters jsonb default '{}'::jsonb)
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
  if not exists(select 1 from public.pet_purposes pp where pp.pet_id=p_active_pet_id and pp.purpose<>'mating') and not (public.current_mating_feature_enabled() and exists(select 1 from public.pet_purposes pp where pp.pet_id=p_active_pet_id and pp.purpose='mating')) then raise exception 'profile_purpose_unavailable'; end if;
  perform public.validate_discovery_filters(p_filters);
  select * into v_me from public.pets where id=p_active_pet_id;
  if v_me.species<>'dog' then return '[]'::jsonb; end if;
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
revoke all on function public.discover_pets_v86(uuid,jsonb) from public,anon,authenticated;


create or replace function public.like_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_kind public.like_kind default 'like')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_match_id uuid; v_low uuid:=least(p_from_pet_id,p_to_pet_id); v_high uuid:=greatest(p_from_pet_id,p_to_pet_id); v_other_owner uuid; v_matched boolean:=false;
  v_tier public.account_tier; v_mating_enabled boolean:=public.current_mating_feature_enabled(); v_from_non_mating boolean; v_to_non_mating boolean; v_mutual_mating boolean;
begin
  if not public.owns_pet(p_from_pet_id) then raise exception 'forbidden'; end if;
  if p_from_pet_id=p_to_pet_id or public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'invalid_target'; end if;
  if not exists(select 1 from public.pets where id=p_from_pet_id and species='dog') or not exists(select 1 from public.pets where id=p_to_pet_id and species='dog') then raise exception 'dog_discovery_only'; end if;
  select exists(select 1 from public.pet_purposes pp where pp.pet_id=p_from_pet_id and pp.purpose<>'mating') into v_from_non_mating;
  select exists(select 1 from public.pet_purposes pp where pp.pet_id=p_to_pet_id and pp.purpose<>'mating') into v_to_non_mating;
  select v_mating_enabled and public.mating_pair_profile_signals_eligible(p_from_pet_id,p_to_pet_id) into v_mutual_mating;
  if not v_from_non_mating and not v_mutual_mating then raise exception 'own_profile_purpose_unavailable'; end if;
  if not v_to_non_mating and not v_mutual_mating then raise exception 'target_unavailable'; end if;
  if not exists(select 1 from public.pets p where p.id=p_from_pet_id and p.moderation_status='approved' and p.discovery_enabled and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3) then raise exception 'own_profile_not_discovery_ready'; end if;
  if not exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id=p_to_pet_id and p.owner_id<>auth.uid() and p.moderation_status='approved' and p.discovery_enabled and u.suspended_at is null and u.paused_at is null and u.discoverable and (not u.incognito or exists(select 1 from public.pet_likes prior where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id)) and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3) then raise exception 'target_unavailable'; end if;
  select tier into v_tier from public.users where id=auth.uid() for update;
  if p_kind='super_like' then
    perform public.rate_limit('super_like_abuse_guard',200,86400);
    if v_tier<>'premium' then
      insert into public.consumable_balances(user_id) values(auth.uid()) on conflict(user_id) do nothing;
      update public.consumable_balances set super_like_credits=super_like_credits-1,updated_at=now() where user_id=auth.uid() and super_like_credits>0;
      if not found then raise exception 'premium_or_super_like_credit_required'; end if;
    end if;
  elsif v_tier='premium' then
    perform public.rate_limit('like_abuse_guard',5000,86400);
  else
    perform public.rate_limit('like',200,86400);
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
    insert into public.notifications(user_id,type,title,body,entity_id,template_key,template_params,actor_pet_id) values(auth.uid(),'match','New match','Your pets liked each other and matched.',v_match_id,'match',jsonb_build_object(),p_to_pet_id);
    if v_other_owner<>auth.uid() then insert into public.notifications(user_id,type,title,body,entity_id,template_key,template_params,actor_pet_id) values(v_other_owner,'match','New match','Your pets liked each other and matched.',v_match_id,'match',jsonb_build_object(),p_from_pet_id); end if;
  else
    select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
    if v_other_owner is not null then insert into public.notifications(user_id,type,title,body,entity_id,template_key,template_params,actor_pet_id) values(v_other_owner,'like','New pet interest','One of your pets received a like.',p_from_pet_id,'like',jsonb_build_object(),p_from_pet_id); end if;
  end if;
  return jsonb_build_object('matched',v_matched,'match_id',v_match_id);
end $$;
revoke all on function public.like_pet(uuid,uuid,public.like_kind) from public,anon;
grant execute on function public.like_pet(uuid,uuid,public.like_kind) to authenticated;

create or replace function public.pet_json(p_pet_id uuid,p_viewer_pet_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',p.id,'name',p.name,'species',p.species,'breed',p.breed,'sex',p.sex,'birthDate',p.birth_date,
    'ageYears',case when p.birth_date is null then null else extract(year from age(current_date,p.birth_date))::int end,
    'size',p.size,'weightKg',p.weight_kg,'energyLevel',p.energy_level,'temperamentTags',p.temperament_tags,
    'city',p.city,'district',p.district,'neighborhood',p.neighborhood,
    'purposes',coalesce((select jsonb_agg(pp.purpose order by pp.purpose) from public.pet_purposes pp where pp.pet_id=p.id and (pp.purpose<>'mating' or (p.species='dog' and public.current_mating_feature_enabled()))),'[]'::jsonb),
    'prompts',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'promptKey',q.prompt_key,'answer',q.answer,'sortOrder',q.sort_order) order by q.sort_order) from public.pet_prompts q where q.pet_id=p.id),'[]'::jsonb),
    'bio',p.bio,'profileVerified',p.profile_verified,'ownerVerified',u.identity_verified,
    'photos',coalesce((select jsonb_agg(jsonb_build_object('id',ph.id,'url',ph.storage_path,'sortOrder',ph.sort_order,'moderationStatus',ph.moderation_status) order by ph.sort_order) from public.pet_photos ph where ph.pet_id=p.id and (ph.moderation_status='approved' or p.owner_id=auth.uid())),'[]'::jsonb),
    'health',jsonb_build_object('vaccinationStatus',coalesce(h.vaccination_status,'unknown'::public.vaccination_status),'veterinarianVerified',coalesce(h.veterinarian_verified,false),'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),'pedigreeAvailable',coalesce(h.pedigree_available,false)),
    'followersCount',(select count(*) from public.follows f where f.to_pet_id=p.id),
    'followingCount',(select count(*) from public.follows f where f.from_pet_id=p.id),
    'isFollowing',case when p_viewer_pet_id is null then false else exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end
  ) from public.pets p join public.users u on u.id=p.owner_id left join public.pet_health_summary h on h.pet_id=p.id where p.id=p_pet_id;
$$;
revoke all on function public.pet_json(uuid,uuid) from public,anon,authenticated;

create or replace function public.get_feed_page(p_pet_id uuid,p_mode text default 'for_you',p_limit integer default 20,p_snapshot_at timestamptz default null,p_before_rank numeric default null,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_snapshot timestamptz:=coalesce(p_snapshot_at,now()); v_items jsonb; v_me public.pets;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_mode not in ('for_you','following','local') then raise exception 'invalid_feed_mode'; end if;
  select * into v_me from public.pets where id=p_pet_id;
  with ranked as (
    select p.*,(case when p.pet_id=p_pet_id then 6 else 0 end
      +case when exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id) then 12 else 0 end
      +case when public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) then 8 else 0 end
      +case when public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) and public.normalize_search_text(author.district)=public.normalize_search_text(v_me.district) then 12 else 0 end
      +case when public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) and public.normalize_search_text(author.district)=public.normalize_search_text(v_me.district) and public.normalize_search_text(coalesce(author.neighborhood,''))=public.normalize_search_text(coalesce(v_me.neighborhood,'')) then 20 else 0 end
      +greatest(0,5-extract(epoch from (v_snapshot-p.created_at))/86400.0))::numeric rank_score
    from public.posts p join public.pets author on author.id=p.pet_id join public.users au on au.id=author.owner_id and au.suspended_at is null and au.paused_at is null
    where p.deleted_at is null and p.moderation_status='approved' and p.created_at<=v_snapshot and not public.is_blocked(p_pet_id,p.pet_id)
      and (p_mode<>'following' or p.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id))
      and (p_mode<>'local' or (public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) and public.normalize_search_text(author.district)=public.normalize_search_text(v_me.district)))
  ), page as (
    select * from ranked where p_before_rank is null or (rank_score,created_at,id)<(p_before_rank,p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) order by rank_score desc,created_at desc,id desc limit least(greatest(p_limit,1),50)
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,'pet',public.pet_json(po.pet_id,p_pet_id),'caption',po.caption,
    'mediaUrls',coalesce((select jsonb_agg(pm.storage_path order by pm.sort_order) from public.post_media pm where pm.post_id=po.id and pm.moderation_status='approved'),'[]'::jsonb),
    'createdAt',po.created_at,'rankScore',po.rank_score,'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=po.id and sp.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc,po.id desc),'[]'::jsonb) into v_items from page po;
  return jsonb_build_object('snapshotAt',v_snapshot,'items',v_items);
end $$;
revoke all on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) from public,anon;
grant execute on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) to authenticated;

create or replace function public.get_product_feature_policy()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  return jsonb_build_object(
    'matingOwnerArrangedEnabled',public.current_mating_feature_enabled(),
    'petSalesEnabled',false,'commercialBreedingEnabled',false,'petCommerceMarketplaceEnabled',false,
    'dataSaleEnabled',false,'aggressiveAdsEnabled',false,'catsInDiscovery',false,
    'premiumEventCreation',true,'lostPetAlertsFree',true,'safetyFeaturesFree',true,
    'premiumMultiplePets',true,'premiumAdvancedFilters',true,'premiumTravelMode',true,
    'premiumUnlimitedLikes',true,'consumableBoosts',true,'consumableSuperLikes',true,
    'contextualBusinessPromotionsOnly',true,'petFirstNoHumanDating',true
  );
end $$;
revoke all on function public.get_product_feature_policy() from public,anon;
grant execute on function public.get_product_feature_policy() to authenticated;
