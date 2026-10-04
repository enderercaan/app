-- Tailmance v19 R8 ultra-deep audit: complete the Favorites product surface.
-- Favorite state is part of canonical pet JSON and favorites have an owner-bound paginated read path.

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
    'isFollowing',case when p_viewer_pet_id is null then false else exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end,
    'isFavorite',case when p_viewer_pet_id is null then false else exists(select 1 from public.pet_favorites f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end
  ) from public.pets p join public.users u on u.id=p.owner_id left join public.pet_health_summary h on h.pet_id=p.id where p.id=p_pet_id;
$$;
revoke all on function public.pet_json(uuid,uuid) from public,anon,authenticated;

create or replace function public.get_favorite_pets_page(
  p_pet_id uuid,p_limit integer default 40,p_before_created_at timestamptz default null,p_before_to_pet_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(
    public.pet_json(f.to_pet_id,p_pet_id) || jsonb_build_object('favoritedAt',f.created_at)
    order by f.created_at desc,f.to_pet_id desc
  ),'[]'::jsonb) else null end
  from (
    select f.*
    from public.pet_favorites f
    join public.pets target on target.id=f.to_pet_id
    join public.users target_user on target_user.id=target.owner_id
    where f.from_pet_id=p_pet_id
      and target.moderation_status='approved' and target.discovery_enabled
      and target_user.suspended_at is null and target_user.paused_at is null and target_user.discoverable
      and (not target_user.incognito or exists(select 1 from public.pet_likes prior where prior.from_pet_id=f.to_pet_id and prior.to_pet_id=p_pet_id))
      and not public.is_blocked(p_pet_id,f.to_pet_id)
      and (p_before_created_at is null or (f.created_at,f.to_pet_id)<(p_before_created_at,coalesce(p_before_to_pet_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by f.created_at desc,f.to_pet_id desc
    limit least(greatest(p_limit,1),100)
  ) f;
$$;
revoke all on function public.get_favorite_pets_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_favorite_pets_page(uuid,integer,timestamptz,uuid) to authenticated;
