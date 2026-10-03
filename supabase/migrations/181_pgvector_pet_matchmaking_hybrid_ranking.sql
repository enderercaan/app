-- Tailmance v19 R8: deterministic pgvector-backed pet matchmaking.
-- The vector layer is ranking-only. Existing authorization, block/incognito, moderation,
-- health-filter, local-network, travel-mode, mating and distance gates remain authoritative.
-- No owner PII, free-form bio, exact location or private health document data is embedded.

create schema if not exists extensions;

do $$
declare v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  where e.extname='vector';
  if v_schema is null then
    execute 'create extension vector with schema extensions';
  elsif v_schema <> 'extensions' then
    raise exception 'vector_must_be_installed_in_extensions_schema';
  end if;
end $$;

create table if not exists public.pet_match_embeddings (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  embedding extensions.vector(40) not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  model_version text not null default 'tailmance-structured-pet-v1'
    check (model_version='tailmance-structured-pet-v1'),
  updated_at timestamptz not null default now()
);
alter table public.pet_match_embeddings enable row level security;
revoke all on table public.pet_match_embeddings from public,anon,authenticated;

create index if not exists idx_pet_match_embeddings_hnsw_cosine
  on public.pet_match_embeddings using hnsw (embedding extensions.vector_cosine_ops)
  with (m=16,ef_construction=64);

create or replace function public.pet_match_feature_source(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'schemaVersion',1,
    'petId',p.id,
    'species',p.species::text,
    'breed',public.normalize_search_text(p.breed),
    'birthDate',p.birth_date,
    'size',p.size::text,
    'weightKg',p.weight_kg,
    'energyLevel',p.energy_level,
    'temperamentTags',coalesce((select jsonb_agg(public.normalize_search_text(t) order by public.normalize_search_text(t)) from unnest(p.temperament_tags) t),'[]'::jsonb),
    'purposes',coalesce((select jsonb_agg(pp.purpose::text order by pp.purpose::text) from public.pet_purposes pp where pp.pet_id=p.id),'[]'::jsonb),
    'health',jsonb_build_object(
      'vaccinationComplete',coalesce(h.vaccination_status='complete',false),
      'veterinarianVerified',public.has_current_veterinarian_verification(p.id),
      'microchipVerified',coalesce(h.microchip_verified,false),
      'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),
      'pedigreeAvailable',coalesce(h.pedigree_available,false)
    ),
    'profileVerified',p.profile_verified
  )
  from public.pets p
  left join public.pet_health_summary h on h.pet_id=p.id
  where p.id=p_pet_id;
$$;
revoke all on function public.pet_match_feature_source(uuid) from public,anon,authenticated;
grant execute on function public.pet_match_feature_source(uuid) to service_role;

create or replace function public.compute_pet_match_embedding(p_pet_id uuid,p_query boolean default false)
returns extensions.vector language plpgsql stable security definer set search_path='' as $$
declare
  p public.pets;
  h public.pet_health_summary;
  v_age numeric:=0;
  v_weight numeric:=0;
  v_tag_count numeric:=1;
  v_breed_bucket int:=0;
  v_values numeric[]:=array[]::numeric[];
  i int;
  v_count numeric;
begin
  select * into p from public.pets where id=p_pet_id;
  if p.id is null then raise exception 'pet_not_found'; end if;
  select * into h from public.pet_health_summary where pet_id=p_pet_id;

  v_age:=case when p.birth_date is null then 0 else least(extract(year from age(current_date,p.birth_date))::numeric,20)/20 end;
  v_weight:=case when p.weight_kg is null then 0 else least(p.weight_kg,80)/80 end;
  v_tag_count:=greatest(coalesce(array_length(p.temperament_tags,1),0),1);
  v_breed_bucket:=abs(hashtextextended(public.normalize_search_text(p.breed),0)%8)::int;

  -- 1-3: continuous observed traits.
  v_values:=v_values||array[
    coalesce(p.energy_level,3)::numeric/5,
    v_age,
    v_weight
  ];
  -- 4-8: size one-hot.
  foreach i in array array[0,1,2,3,4] loop
    v_values:=v_values||case when array_position(array['mini','small','medium','large','giant'],p.size::text)-1=i then array[1::numeric] else array[0::numeric] end;
  end loop;
  -- 9-13: health-first candidate quality. Query vectors intentionally seek verified state.
  if p_query then
    v_values:=v_values||array[1::numeric,1,1,1,1];
  else
    v_values:=v_values||array[
      case when h.vaccination_status='complete' then 1 else 0 end,
      case when public.has_current_veterinarian_verification(p.id) then 1 else 0 end,
      case when coalesce(h.microchip_verified,false) then 1 else 0 end,
      case when coalesce(h.genetic_screening_available,false) then 1 else 0 end,
      case when coalesce(h.pedigree_available,false) then 1 else 0 end
    ];
  end if;
  -- 14-17: declared pet purposes. These are social intent, not owner identity.
  foreach i in array array[0,1,2,3] loop
    v_values:=v_values||case when exists(
      select 1 from public.pet_purposes pp where pp.pet_id=p.id
      and pp.purpose::text=(array['socialize','playmate','walk','mating'])[i+1]
    ) then array[1::numeric] else array[0::numeric] end;
  end loop;
  -- 18-25: privacy-safe breed identity buckets. Breed semantics are never invented.
  foreach i in array array[0,1,2,3,4,5,6,7] loop
    v_values:=v_values||case when v_breed_bucket=i then array[1::numeric] else array[0::numeric] end;
  end loop;
  -- 26-37: temperament tag feature hashing. Only user-declared normalized tags are used.
  foreach i in array array[0,1,2,3,4,5,6,7,8,9,10,11] loop
    select count(*)::numeric into v_count
    from unnest(p.temperament_tags) t
    where abs(hashtextextended(public.normalize_search_text(t),0)%12)::int=i;
    v_values:=v_values||array[least(v_count/v_tag_count,1)];
  end loop;
  -- 38: verified profile quality. Query vectors prefer verified profiles.
  v_values:=v_values||array[case when p_query or p.profile_verified then 1::numeric else 0 end];
  -- 39-40: species anchors preserve future dog/cat separation without owner metadata.
  v_values:=v_values||array[
    case when p.species='dog' then 1::numeric else 0 end,
    case when p.species='cat' then 1::numeric else 0 end
  ];

  if array_length(v_values,1)<>40 then raise exception 'pet_match_embedding_dimension_invalid'; end if;
  return ('['||array_to_string(v_values,',')||']')::extensions.vector;
end $$;
revoke all on function public.compute_pet_match_embedding(uuid,boolean) from public,anon,authenticated;
grant execute on function public.compute_pet_match_embedding(uuid,boolean) to service_role;

create or replace function public.refresh_pet_match_embedding(p_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_source jsonb; v_sha text;
begin
  select public.pet_match_feature_source(p_pet_id) into v_source;
  if v_source is null then
    delete from public.pet_match_embeddings where pet_id=p_pet_id;
    return;
  end if;
  v_sha:=encode(extensions.digest(convert_to(v_source::text,'UTF8'),'sha256'),'hex');
  insert into public.pet_match_embeddings(pet_id,embedding,source_sha256,model_version,updated_at)
  values(p_pet_id,public.compute_pet_match_embedding(p_pet_id,false),v_sha,'tailmance-structured-pet-v1',now())
  on conflict(pet_id) do update set
    embedding=excluded.embedding,source_sha256=excluded.source_sha256,
    model_version=excluded.model_version,updated_at=excluded.updated_at;
end $$;
revoke all on function public.refresh_pet_match_embedding(uuid) from public,anon,authenticated;
grant execute on function public.refresh_pet_match_embedding(uuid) to service_role;

create or replace function public.trg_refresh_pet_match_embedding()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_pet_id uuid;
begin
  v_pet_id:=case when tg_op='DELETE' then old.pet_id else new.pet_id end;
  perform public.refresh_pet_match_embedding(v_pet_id);
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.trg_refresh_pet_match_embedding() from public,anon,authenticated;

create or replace function public.trg_refresh_pet_row_match_embedding()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.refresh_pet_match_embedding(case when tg_op='DELETE' then old.id else new.id end);
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.trg_refresh_pet_row_match_embedding() from public,anon,authenticated;

drop trigger if exists trg_pet_match_embedding_pet on public.pets;
create trigger trg_pet_match_embedding_pet
after insert or update of breed,birth_date,size,weight_kg,energy_level,temperament_tags,profile_verified,species on public.pets
for each row execute function public.trg_refresh_pet_row_match_embedding();

drop trigger if exists trg_pet_match_embedding_health on public.pet_health_summary;
create trigger trg_pet_match_embedding_health
after insert or update of vaccination_status,veterinarian_verified,microchip_verified,genetic_screening_available,pedigree_available on public.pet_health_summary
for each row execute function public.trg_refresh_pet_match_embedding();

drop trigger if exists trg_pet_match_embedding_purpose on public.pet_purposes;
create trigger trg_pet_match_embedding_purpose
after insert or delete or update of purpose on public.pet_purposes
for each row execute function public.trg_refresh_pet_match_embedding();

-- Backfill deterministically. This contains no network/provider dependency.
do $$ declare r record; begin
  for r in select id from public.pets loop
    perform public.refresh_pet_match_embedding(r.id);
  end loop;
end $$;

create or replace function public.rerank_discovery_with_match_vectors(p_active_pet_id uuid,p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_query extensions.vector; v_result jsonb;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  v_query:=public.compute_pet_match_embedding(p_active_pet_id,true);
  with items as (
    select x.item,x.ord,(x.item->>'id')::uuid as pet_id,
      greatest(0,least(100,coalesce((x.item->>'compatibilityScore')::numeric,0))) as base_score
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality x(item,ord)
  ), scored as (
    select i.*,
      case when e.embedding is null then null
           else greatest(0::numeric,least(1::numeric,(1-(e.embedding <=> v_query))::numeric)) end as vector_similarity
    from items i left join public.pet_match_embeddings e on e.pet_id=i.pet_id
  ), blended as (
    select s.*,
      case when s.vector_similarity is null then round(s.base_score)::int
           else round((s.base_score*0.70)+(s.vector_similarity*100*0.30))::int end as hybrid_score
    from scored s
  )
  select coalesce(jsonb_agg(
    (b.item||jsonb_build_object(
      'compatibilityScore',greatest(0,least(100,b.hybrid_score)),
      'compatibilityModel',case when b.vector_similarity is null then 'rules-v1' else 'rules-pgvector-v1' end
    ))
    order by b.hybrid_score desc, b.ord
  ),'[]'::jsonb) into v_result from blended b;
  return v_result;
end $$;
revoke all on function public.rerank_discovery_with_match_vectors(uuid,jsonb) from public,anon,authenticated;

-- Preserve the mature product wrapper and add vector ranking only after every authoritative gate.
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

  return public.rerank_discovery_with_match_vectors(p_active_pet_id,v_result);
end $$;
revoke all on function public.discover_pets(uuid,jsonb) from public,anon;
grant execute on function public.discover_pets(uuid,jsonb) to authenticated;
