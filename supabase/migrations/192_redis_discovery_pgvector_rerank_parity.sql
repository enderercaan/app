-- Tailmance v19 R8: Redis discovery hits remain an identifier cache only.
-- Rehydration already rechecks current authorization/privacy/safety state. Reapply the current
-- pgvector hybrid reranker after rehydration so cache hit and cache miss use the same ranking
-- model and preserve Boost priority from migration 190.

create or replace function public.rehydrate_cached_default_discovery(
  p_active_pet_id uuid,
  p_cached_items jsonb
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
        'approximateDistanceKm',case when v_private.location is null or c.candidate_location is null then null else round((extensions.ST_Distance(v_private.location,c.candidate_location)/1000.0)::numeric,1) end,
        'compatibilityScore',c.compatibility_score,
        'boosted',exists(select 1 from public.pet_boosts b where b.pet_id=c.id and b.starts_at<=now() and b.ends_at>now())
      )
    order by c.ord
  ),'[]'::jsonb)
  into v_result from candidates c;

  return public.rerank_discovery_with_match_vectors(p_active_pet_id,v_result);
end $$;
revoke all on function public.rehydrate_cached_default_discovery(uuid,jsonb) from public,anon;
grant execute on function public.rehydrate_cached_default_discovery(uuid,jsonb) to authenticated;
