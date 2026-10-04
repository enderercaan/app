-- Tailmance v19 R8 — stable Reel/Story Universal Link authorization + Reels privacy closure.
-- Deep links never widen content visibility. Reels honor discoverable/incognito rules;
-- Stories mirror the existing own/follow relationship visibility and remain 24-hour ephemeral.

create or replace function public.get_reels_page(
  p_pet_id uuid,
  p_limit integer default 12,
  p_snapshot_at timestamptz default null,
  p_before_rank numeric default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_snapshot timestamptz:=coalesce(p_snapshot_at,now()); v_items jsonb; v_me public.pets;
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
    where p.content_type='reel' and p.deleted_at is null and p.moderation_status='approved' and p.created_at<=v_snapshot
      and author.moderation_status='approved' and not public.is_blocked(p_pet_id,p.pet_id)
      and (
        author.owner_id=auth.uid()
        or (
          au.discoverable
          and (
            not au.incognito
            or exists(select 1 from public.pet_likes prior where prior.from_pet_id=p.pet_id and prior.to_pet_id=p_pet_id)
            or exists(select 1 from public.follows f where f.from_pet_id=p.pet_id and f.to_pet_id=p_pet_id)
            or exists(
              select 1 from public.pet_matches m
              where m.unmatched_at is null
                and m.pet_low_id=least(p_pet_id,p.pet_id)
                and m.pet_high_id=greatest(p_pet_id,p.pet_id)
            )
          )
        )
      )
      and exists(select 1 from public.post_media pm where pm.post_id=p.id and pm.media_kind='video' and pm.moderation_status='approved')
  ), page as (
    select * from ranked
    where p_before_rank is null or (rank_score,created_at,id)<(p_before_rank,p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    order by rank_score desc,created_at desc,id desc
    limit least(greatest(p_limit,1),30)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,'pet',public.pet_json(po.pet_id,p_pet_id),'caption',po.caption,
    'videoUrl',(select pm.storage_path from public.post_media pm where pm.post_id=po.id and pm.media_kind='video' and pm.moderation_status='approved' order by pm.sort_order limit 1),
    'durationMs',(select pm.duration_ms from public.post_media pm where pm.post_id=po.id and pm.media_kind='video' and pm.moderation_status='approved' order by pm.sort_order limit 1),
    'createdAt',po.created_at,'rankScore',po.rank_score,
    'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),
    'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),
    'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=po.id and sp.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc,po.id desc),'[]'::jsonb) into v_items from page po;
  return jsonb_build_object('snapshotAt',v_snapshot,'items',v_items);
end $$;
revoke all on function public.get_reels_page(uuid,integer,timestamptz,numeric,timestamptz,uuid) from public,anon;
grant execute on function public.get_reels_page(uuid,integer,timestamptz,numeric,timestamptz,uuid) to authenticated;

create or replace function public.get_shareable_reel(p_viewer_pet_id uuid,p_reel_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_post public.posts;
  v_author public.pets;
  v_owner public.users;
  v_video public.post_media;
  v_allowed boolean:=false;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if not public.owns_pet(p_viewer_pet_id) then raise exception 'forbidden'; end if;

  select * into v_post from public.posts
  where id=p_reel_id and content_type='reel' and deleted_at is null and moderation_status='approved';
  if v_post.id is null then return null; end if;
  select * into v_author from public.pets where id=v_post.pet_id and moderation_status='approved';
  if v_author.id is null then return null; end if;
  select * into v_owner from public.users where id=v_author.owner_id and suspended_at is null and paused_at is null;
  if v_owner.id is null or public.is_blocked(p_viewer_pet_id,v_author.id) then return null; end if;
  select * into v_video from public.post_media
  where post_id=v_post.id and media_kind='video' and moderation_status='approved'
  order by sort_order limit 1;
  if v_video.id is null then return null; end if;

  if v_author.owner_id=auth.uid() then
    v_allowed:=true;
  elsif v_owner.discoverable and not v_owner.incognito then
    v_allowed:=true;
  elsif v_owner.discoverable and v_owner.incognito then
    v_allowed:=
      exists(select 1 from public.pet_likes prior where prior.from_pet_id=v_author.id and prior.to_pet_id=p_viewer_pet_id)
      or exists(select 1 from public.follows f where f.from_pet_id=v_author.id and f.to_pet_id=p_viewer_pet_id)
      or exists(
        select 1 from public.pet_matches m
        where m.unmatched_at is null
          and m.pet_low_id=least(p_viewer_pet_id,v_author.id)
          and m.pet_high_id=greatest(p_viewer_pet_id,v_author.id)
      );
  end if;
  if not v_allowed then return null; end if;

  return jsonb_build_object(
    'id',v_post.id,'pet',public.pet_json(v_author.id,p_viewer_pet_id),'caption',v_post.caption,
    'videoUrl',v_video.storage_path,'durationMs',v_video.duration_ms,'createdAt',v_post.created_at,
    'likeCount',(select count(*) from public.post_likes l where l.post_id=v_post.id),
    'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=v_post.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=v_post.id and l.pet_id=p_viewer_pet_id),
    'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=v_post.id and sp.pet_id=p_viewer_pet_id)
  );
end $$;
revoke all on function public.get_shareable_reel(uuid,uuid) from public,anon;
grant execute on function public.get_shareable_reel(uuid,uuid) to authenticated;

create or replace function public.get_shareable_story(p_viewer_pet_id uuid,p_story_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_story public.stories;
  v_author public.pets;
  v_owner public.users;
  v_allowed boolean:=false;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if not public.owns_pet(p_viewer_pet_id) then raise exception 'forbidden'; end if;

  select * into v_story from public.stories
  where id=p_story_id and expires_at>now() and moderation_status='approved';
  if v_story.id is null then return null; end if;
  select * into v_author from public.pets where id=v_story.pet_id and moderation_status='approved';
  if v_author.id is null then return null; end if;
  select * into v_owner from public.users where id=v_author.owner_id and suspended_at is null and paused_at is null;
  if v_owner.id is null or public.is_blocked(p_viewer_pet_id,v_author.id) then return null; end if;

  v_allowed:=v_author.owner_id=auth.uid()
    or v_story.pet_id=p_viewer_pet_id
    or exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=v_story.pet_id);
  if not v_allowed then return null; end if;

  return jsonb_build_object(
    'id',v_story.id,'petId',v_story.pet_id,'petName',v_author.name,
    'avatarUrl',(select ph.storage_path from public.pet_photos ph where ph.pet_id=v_author.id and ph.sort_order=1 and ph.moderation_status='approved'),
    'mediaUrl',v_story.storage_path,'createdAt',v_story.created_at,'expiresAt',v_story.expires_at,
    'seen',exists(select 1 from public.story_views sv where sv.story_id=v_story.id and sv.viewer_pet_id=p_viewer_pet_id)
  );
end $$;
revoke all on function public.get_shareable_story(uuid,uuid) from public,anon;
grant execute on function public.get_shareable_story(uuid,uuid) to authenticated;
