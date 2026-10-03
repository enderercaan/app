-- Tailmance v19 R8: Redis social-read cache safety boundary.
-- Redis may cache only compact ordering identifiers. Every cache hit is rehydrated
-- from current Postgres state so block/moderation/follow/engagement decisions never
-- become cache-authoritative.

create or replace function public.rehydrate_cached_feed_page(
  p_pet_id uuid,
  p_mode text,
  p_snapshot_at timestamptz,
  p_cached_items jsonb
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_me public.pets;
  v_items jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_mode not in ('for_you','following','local') then raise exception 'invalid_feed_mode'; end if;
  if jsonb_typeof(p_cached_items)<>'array' or jsonb_array_length(p_cached_items)>50 then raise exception 'invalid_cache_page'; end if;
  select * into v_me from public.pets where id=p_pet_id;

  with cached as (
    select
      (x.item->>'id')::uuid as id,
      (x.item->>'rankScore')::numeric as rank_score,
      (x.item->>'createdAt')::timestamptz as created_at,
      x.ord
    from jsonb_array_elements(p_cached_items) with ordinality x(item,ord)
  ), visible as (
    select c.id,c.rank_score,c.created_at,c.ord,p.pet_id,p.caption
    from cached c
    join public.posts p on p.id=c.id
    join public.pets author on author.id=p.pet_id
    join public.users au on au.id=author.owner_id
    where p.content_type='grid'
      and p.deleted_at is null and p.moderation_status='approved'
      and author.moderation_status='approved'
      and au.suspended_at is null and au.paused_at is null
      and not public.is_blocked(p_pet_id,p.pet_id)
      and (p_mode<>'following' or p.pet_id=p_pet_id or exists(
        select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id
      ))
      and (p_mode<>'local' or (
        public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city)
        and public.normalize_search_text(author.district)=public.normalize_search_text(v_me.district)
      ))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',v.id,
    'pet',public.pet_json(v.pet_id,p_pet_id),
    'caption',v.caption,
    'mediaUrls',coalesce((
      select jsonb_agg(pm.storage_path order by pm.sort_order)
      from public.post_media pm
      where pm.post_id=v.id and pm.media_kind='image' and pm.moderation_status='approved'
    ),'[]'::jsonb),
    'createdAt',v.created_at,
    'rankScore',v.rank_score,
    'likeCount',(select count(*) from public.post_likes l where l.post_id=v.id),
    'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=v.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=v.id and l.pet_id=p_pet_id),
    'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=v.id and sp.pet_id=p_pet_id)
  ) order by v.ord),'[]'::jsonb) into v_items from visible v;

  return jsonb_build_object('snapshotAt',p_snapshot_at,'items',v_items);
end $$;
revoke all on function public.rehydrate_cached_feed_page(uuid,text,timestamptz,jsonb) from public,anon;
grant execute on function public.rehydrate_cached_feed_page(uuid,text,timestamptz,jsonb) to authenticated;

create or replace function public.rehydrate_cached_reels_page(
  p_pet_id uuid,
  p_snapshot_at timestamptz,
  p_cached_items jsonb
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_cached_items)<>'array' or jsonb_array_length(p_cached_items)>30 then raise exception 'invalid_cache_page'; end if;

  with cached as (
    select
      (x.item->>'id')::uuid as id,
      (x.item->>'rankScore')::numeric as rank_score,
      (x.item->>'createdAt')::timestamptz as created_at,
      x.ord
    from jsonb_array_elements(p_cached_items) with ordinality x(item,ord)
  ), visible as (
    select c.id,c.rank_score,c.created_at,c.ord,p.pet_id,p.caption
    from cached c
    join public.posts p on p.id=c.id
    join public.pets author on author.id=p.pet_id
    join public.users au on au.id=author.owner_id
    where p.content_type='reel'
      and p.deleted_at is null and p.moderation_status='approved'
      and author.moderation_status='approved'
      and au.suspended_at is null and au.paused_at is null
      and not public.is_blocked(p_pet_id,p.pet_id)
      and exists(select 1 from public.post_media pm where pm.post_id=p.id and pm.media_kind='video' and pm.moderation_status='approved')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',v.id,
    'pet',public.pet_json(v.pet_id,p_pet_id),
    'caption',v.caption,
    'videoUrl',(select pm.storage_path from public.post_media pm where pm.post_id=v.id and pm.media_kind='video' and pm.moderation_status='approved' order by pm.sort_order limit 1),
    'durationMs',(select pm.duration_ms from public.post_media pm where pm.post_id=v.id and pm.media_kind='video' and pm.moderation_status='approved' order by pm.sort_order limit 1),
    'createdAt',v.created_at,
    'rankScore',v.rank_score,
    'likeCount',(select count(*) from public.post_likes l where l.post_id=v.id),
    'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=v.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=v.id and l.pet_id=p_pet_id),
    'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=v.id and sp.pet_id=p_pet_id)
  ) order by v.ord),'[]'::jsonb) into v_items from visible v;

  return jsonb_build_object('snapshotAt',p_snapshot_at,'items',v_items);
end $$;
revoke all on function public.rehydrate_cached_reels_page(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.rehydrate_cached_reels_page(uuid,timestamptz,jsonb) to authenticated;

-- Default discovery deck cache only. Filtered / travel-mode discovery stays direct-to-Postgres.
-- Cache contents hold only candidate identifiers; every hit rechecks current safety state and
-- rebuilds pet JSON + fuzzy distance from authoritative private PostGIS coordinates.
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
        + case when p.species=v_me.species then 15 else 0 end
        + case when p.size=v_me.size then 8 else 0 end
        + least(20,(select count(*)*7 from public.pet_purposes a join public.pet_purposes b on a.purpose=b.purpose where a.pet_id=p_active_pet_id and b.pet_id=p.id and a.purpose<>'mating'))
      )::int as compatibility_score
    from cached c
    join public.pets p on p.id=c.id
    join public.users u on u.id=p.owner_id
    left join public.pet_private pp on pp.pet_id=p.id
    where p.id<>p_active_pet_id and p.owner_id<>auth.uid()
      and p.species='dog' and p.discovery_enabled and p.moderation_status='approved'
      and u.suspended_at is null and u.paused_at is null and u.discoverable
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
  ),'[]'::jsonb) into v_result from candidates c;

  return v_result;
end $$;
revoke all on function public.rehydrate_cached_default_discovery(uuid,jsonb) from public,anon;
grant execute on function public.rehydrate_cached_default_discovery(uuid,jsonb) to authenticated;
