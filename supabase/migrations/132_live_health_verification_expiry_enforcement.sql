-- Tailmance v19 R8 — live health-verification expiry enforcement.
-- Current trust and eligibility are evaluated from unexpired, unrevoked provider attestations.
-- The cached summary boolean remains only a compatibility cache and is never authoritative.

create or replace function public.has_current_veterinarian_verification(p_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.health_verification_attestations a
    where a.pet_id=p_pet_id
      and a.signal='veterinarian_verified'
      and a.method='provider_ocr_signature'
      and a.integrity_status='valid'
      and a.revoked_at is null
      and (a.expires_at is null or a.expires_at>now())
  )
$$;
revoke all on function public.has_current_veterinarian_verification(uuid) from public,anon,authenticated;

create or replace function public.recompute_veterinarian_verified(p_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.pet_health_summary h
  set veterinarian_verified=public.has_current_veterinarian_verification(p_pet_id)
  where h.pet_id=p_pet_id;
end $$;
revoke all on function public.recompute_veterinarian_verified(uuid) from public,anon,authenticated;

create or replace function public.get_pet_health_details(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then jsonb_build_object(
    'summary',jsonb_build_object(
      'vaccinationStatus',coalesce(h.vaccination_status,'unknown'::public.vaccination_status),
      'veterinarianVerified',public.has_current_veterinarian_verification(p_pet_id),
      'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),
      'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),
      'pedigreeAvailable',coalesce(h.pedigree_available,false),
      'trust',public.health_trust_json(p_pet_id)
    ),
    'vaccinations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',v.id,'vaccineName',v.vaccine_name,'doseDate',v.dose_date,'nextDueDate',v.next_due_date,
      'verificationStatus',v.verification_status
    ) order by coalesce(v.next_due_date,v.dose_date) desc nulls last) from public.pet_vaccinations v where v.pet_id=p_pet_id),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'documentType',d.document_type,'verificationStatus',d.verification_status,'createdAt',d.created_at
    ) order by d.created_at desc) from public.health_documents d where d.pet_id=p_pet_id),'[]'::jsonb),
    'attestations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'healthDocumentId',a.health_document_id,'signal',a.signal,'method',a.method,
      'clinicPublicId',a.clinic_public_id,'providerCode',a.provider_code,'integrityStatus',a.integrity_status,
      'verifiedAt',a.verified_at,'expiresAt',a.expires_at,'revokedAt',a.revoked_at
    ) order by a.verified_at desc,a.id desc) from public.health_verification_attestations a where a.pet_id=p_pet_id),'[]'::jsonb)
  ) else null end
  from public.pet_health_summary h where h.pet_id=p_pet_id;
$$;
revoke all on function public.get_pet_health_details(uuid) from public,anon;
grant execute on function public.get_pet_health_details(uuid) to authenticated;

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
    'health',jsonb_build_object('vaccinationStatus',coalesce(h.vaccination_status,'unknown'::public.vaccination_status),'veterinarianVerified',public.has_current_veterinarian_verification(p.id),'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),'pedigreeAvailable',coalesce(h.pedigree_available,false),'trust',public.health_trust_json(p.id)),
    'followersCount',(select count(*) from public.follows f where f.to_pet_id=p.id),
    'followingCount',(select count(*) from public.follows f where f.from_pet_id=p.id),
    'isFollowing',case when p_viewer_pet_id is null then false else exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end,
    'isFavorite',case when p_viewer_pet_id is null then false else exists(select 1 from public.pet_favorites f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end
  ) from public.pets p join public.users u on u.id=p.owner_id left join public.pet_health_summary h on h.pet_id=p.id where p.id=p_pet_id;
$$;
revoke all on function public.pet_json(uuid,uuid) from public,anon,authenticated;

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
        and public.has_current_veterinarian_verification(a.id) and public.has_current_veterinarian_verification(b.id)
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
      and (coalesce((p_filters->>'veterinarianVerifiedOnly')::boolean,false)=false or public.has_current_veterinarian_verification(p.id))
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
