-- Tailmance v19 R8 — canonical social-content visibility + Redis privacy parity.
-- Cached reads must never be more permissive than direct Postgres reads.
-- Discovery/social content respects account discoverability and incognito relationship rules.

create or replace function public.social_content_visible_to_viewer(
  p_viewer_pet_id uuid,
  p_target_pet_id uuid
) returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.pets target
    join public.users owner on owner.id=target.owner_id
    where target.id=p_target_pet_id
      and owner.suspended_at is null
      and owner.paused_at is null
      and target.moderation_status='approved'
      and (
        target.owner_id=auth.uid()
        or (
          owner.discoverable
          and (
            not owner.incognito
            or exists(
              select 1 from public.pet_likes prior
              where prior.from_pet_id=p_target_pet_id and prior.to_pet_id=p_viewer_pet_id
            )
            or exists(
              select 1 from public.follows f
              where f.from_pet_id=p_target_pet_id and f.to_pet_id=p_viewer_pet_id
            )
            or exists(
              select 1 from public.pet_matches m
              where m.unmatched_at is null
                and m.pet_low_id=least(p_viewer_pet_id,p_target_pet_id)
                and m.pet_high_id=greatest(p_viewer_pet_id,p_target_pet_id)
            )
          )
        )
      )
  );
$$;
revoke all on function public.social_content_visible_to_viewer(uuid,uuid) from public,anon,authenticated;

create or replace function public.get_feed_page(
  p_pet_id uuid,
  p_mode text default 'for_you',
  p_limit integer default 20,
  p_snapshot_at timestamptz default null,
  p_before_rank numeric default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_snapshot timestamptz:=coalesce(p_snapshot_at,now());
  v_items jsonb;
  v_me public.pets;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
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
    from public.posts p
    join public.pets author on author.id=p.pet_id
    join public.users au on au.id=author.owner_id and au.suspended_at is null and au.paused_at is null
    where p.content_type='grid'
      and p.deleted_at is null
      and p.moderation_status='approved'
      and p.created_at<=v_snapshot
      and not public.is_blocked(p_pet_id,p.pet_id)
      and public.social_content_visible_to_viewer(p_pet_id,p.pet_id)
      and (p_mode<>'following' or p.pet_id=p_pet_id or exists(
        select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id
      ))
      and (p_mode<>'local' or (
        public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city)
        and public.normalize_search_text(author.district)=public.normalize_search_text(v_me.district)
      ))
  ), page as (
    select * from ranked
    where p_before_rank is null or (rank_score,created_at,id)<(
      p_before_rank,p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    )
    order by rank_score desc,created_at desc,id desc
    limit least(greatest(p_limit,1),50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,
    'pet',public.pet_json(po.pet_id,p_pet_id),
    'caption',po.caption,
    'mediaUrls',coalesce((
      select jsonb_agg(pm.storage_path order by pm.sort_order)
      from public.post_media pm
      where pm.post_id=po.id and pm.media_kind='image' and pm.moderation_status='approved'
    ),'[]'::jsonb),
    'createdAt',po.created_at,
    'rankScore',po.rank_score,
    'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),
    'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),
    'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=po.id and sp.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc,po.id desc),'[]'::jsonb)
  into v_items from page po;

  return jsonb_build_object('snapshotAt',v_snapshot,'items',v_items);
end $$;
revoke all on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) from public,anon;
grant execute on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) to authenticated;

create or replace function public.get_reels_page(
  p_pet_id uuid,
  p_limit integer default 12,
  p_snapshot_at timestamptz default null,
  p_before_rank numeric default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_snapshot timestamptz:=coalesce(p_snapshot_at,now());
  v_items jsonb;
  v_me public.pets;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into v_me from public.pets where id=p_pet_id;

  with ranked as (
    select p.*,(case when p.pet_id=p_pet_id then 3 else 0 end
      +case when author.species=v_me.species then 8 else 0 end
      +case when public.normalize_search_text(author.breed)=public.normalize_search_text(v_me.breed) then 6 else 0 end
      +case when public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) then 4 else 0 end
      +greatest(0,12-extract(epoch from (v_snapshot-p.created_at))/43200.0)
      +((((pg_catalog.hashtextextended(p.id::text||':'||p_pet_id::text,0)%1000)+1000)%1000)::numeric/1000.0))::numeric rank_score
    from public.posts p
    join public.pets author on author.id=p.pet_id
    join public.users au on au.id=author.owner_id and au.suspended_at is null and au.paused_at is null
    where p.content_type='reel'
      and p.deleted_at is null
      and p.moderation_status='approved'
      and p.created_at<=v_snapshot
      and author.moderation_status='approved'
      and not public.is_blocked(p_pet_id,p.pet_id)
      and public.social_content_visible_to_viewer(p_pet_id,p.pet_id)
      and exists(
        select 1 from public.post_media pm
        where pm.post_id=p.id and pm.media_kind='video' and pm.moderation_status='approved'
      )
  ), page as (
    select * from ranked
    where p_before_rank is null or (rank_score,created_at,id)<(
      p_before_rank,p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    )
    order by rank_score desc,created_at desc,id desc
    limit least(greatest(p_limit,1),30)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,
    'pet',public.pet_json(po.pet_id,p_pet_id),
    'caption',po.caption,
    'videoUrl',(select pm.storage_path from public.post_media pm where pm.post_id=po.id and pm.media_kind='video' and pm.moderation_status='approved' order by pm.sort_order limit 1),
    'durationMs',(select pm.duration_ms from public.post_media pm where pm.post_id=po.id and pm.media_kind='video' and pm.moderation_status='approved' order by pm.sort_order limit 1),
    'createdAt',po.created_at,
    'rankScore',po.rank_score,
    'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),
    'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),
    'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=po.id and sp.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc,po.id desc),'[]'::jsonb)
  into v_items from page po;

  return jsonb_build_object('snapshotAt',v_snapshot,'items',v_items);
end $$;
revoke all on function public.get_reels_page(uuid,integer,timestamptz,numeric,timestamptz,uuid) from public,anon;
grant execute on function public.get_reels_page(uuid,integer,timestamptz,numeric,timestamptz,uuid) to authenticated;

create or replace function public.get_shareable_reel(p_viewer_pet_id uuid,p_reel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_post public.posts;
  v_author public.pets;
  v_video public.post_media;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if not public.owns_pet(p_viewer_pet_id) then raise exception 'forbidden'; end if;

  select * into v_post from public.posts
  where id=p_reel_id and content_type='reel' and deleted_at is null and moderation_status='approved';
  if v_post.id is null then return null; end if;
  select * into v_author from public.pets where id=v_post.pet_id and moderation_status='approved';
  if v_author.id is null then return null; end if;
  if public.is_blocked(p_viewer_pet_id,v_author.id) then return null; end if;
  if not public.social_content_visible_to_viewer(p_viewer_pet_id,v_author.id) then return null; end if;

  select * into v_video from public.post_media
  where post_id=v_post.id and media_kind='video' and moderation_status='approved'
  order by sort_order limit 1;
  if v_video.id is null then return null; end if;

  return jsonb_build_object(
    'id',v_post.id,
    'pet',public.pet_json(v_author.id,p_viewer_pet_id),
    'caption',v_post.caption,
    'videoUrl',v_video.storage_path,
    'durationMs',v_video.duration_ms,
    'createdAt',v_post.created_at,
    'likeCount',(select count(*) from public.post_likes l where l.post_id=v_post.id),
    'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=v_post.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=v_post.id and l.pet_id=p_viewer_pet_id),
    'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=v_post.id and sp.pet_id=p_viewer_pet_id)
  );
end $$;
revoke all on function public.get_shareable_reel(uuid,uuid) from public,anon;
grant execute on function public.get_shareable_reel(uuid,uuid) to authenticated;

create or replace function public.rehydrate_cached_feed_page(
  p_pet_id uuid,
  p_mode text,
  p_snapshot_at timestamptz,
  p_cached_items jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_me public.pets;
  v_items jsonb;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
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
      and p.deleted_at is null
      and p.moderation_status='approved'
      and author.moderation_status='approved'
      and au.suspended_at is null
      and au.paused_at is null
      and not public.is_blocked(p_pet_id,p.pet_id)
      and public.social_content_visible_to_viewer(p_pet_id,p.pet_id)
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
  ) order by v.ord),'[]'::jsonb)
  into v_items from visible v;

  return jsonb_build_object('snapshotAt',p_snapshot_at,'items',v_items);
end $$;
revoke all on function public.rehydrate_cached_feed_page(uuid,text,timestamptz,jsonb) from public,anon;
grant execute on function public.rehydrate_cached_feed_page(uuid,text,timestamptz,jsonb) to authenticated;

create or replace function public.rehydrate_cached_reels_page(
  p_pet_id uuid,
  p_snapshot_at timestamptz,
  p_cached_items jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_items jsonb;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
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
      and p.deleted_at is null
      and p.moderation_status='approved'
      and author.moderation_status='approved'
      and au.suspended_at is null
      and au.paused_at is null
      and not public.is_blocked(p_pet_id,p.pet_id)
      and public.social_content_visible_to_viewer(p_pet_id,p.pet_id)
      and exists(
        select 1 from public.post_media pm
        where pm.post_id=p.id and pm.media_kind='video' and pm.moderation_status='approved'
      )
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
  ) order by v.ord),'[]'::jsonb)
  into v_items from visible v;

  return jsonb_build_object('snapshotAt',p_snapshot_at,'items',v_items);
end $$;
revoke all on function public.rehydrate_cached_reels_page(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.rehydrate_cached_reels_page(uuid,timestamptz,jsonb) to authenticated;

create or replace function public.rehydrate_cached_default_discovery(
  p_active_pet_id uuid,
  p_cached_items jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
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

  return v_result;
end $$;
revoke all on function public.rehydrate_cached_default_discovery(uuid,jsonb) from public,anon;
grant execute on function public.rehydrate_cached_default_discovery(uuid,jsonb) to authenticated;
