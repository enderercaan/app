-- Tailmance v19 R8 ultra-deep audit: explicit desired-state mutations make retries idempotent.
-- Replaying an already-applied state does not consume another rate-limit unit or duplicate notifications.

create or replace function public.set_post_like(p_pet_id uuid,p_post_id uuid,p_liked boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_author_pet uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if not coalesce(p_liked,false) then delete from public.post_likes where post_id=p_post_id and pet_id=p_pet_id; return false; end if;
  if exists(select 1 from public.post_likes where post_id=p_post_id and pet_id=p_pet_id) then return true; end if;
  select po.pet_id into v_author_pet from public.posts po join public.pets author on author.id=po.pet_id join public.users au on au.id=author.owner_id
  where po.id=p_post_id and po.deleted_at is null and po.moderation_status='approved' and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  perform public.rate_limit('post_like',300,86400);
  insert into public.post_likes(post_id,pet_id) values(p_post_id,p_pet_id) on conflict(post_id,pet_id) do nothing;
  return true;
end $$;
revoke all on function public.set_post_like(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_post_like(uuid,uuid,boolean) to authenticated;

create or replace function public.set_saved_post(p_pet_id uuid,p_post_id uuid,p_saved boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_author_pet uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if not coalesce(p_saved,false) then delete from public.saved_posts where post_id=p_post_id and pet_id=p_pet_id; return false; end if;
  if exists(select 1 from public.saved_posts where post_id=p_post_id and pet_id=p_pet_id) then return true; end if;
  select po.pet_id into v_author_pet from public.posts po join public.pets author on author.id=po.pet_id join public.users au on au.id=author.owner_id
  where po.id=p_post_id and po.deleted_at is null and po.moderation_status='approved' and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  perform public.rate_limit('post_save',300,86400);
  insert into public.saved_posts(post_id,pet_id) values(p_post_id,p_pet_id) on conflict(post_id,pet_id) do nothing;
  return true;
end $$;
revoke all on function public.set_saved_post(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_saved_post(uuid,uuid,boolean) to authenticated;

create or replace function public.set_follow_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_following boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id then raise exception 'forbidden'; end if;
  if not coalesce(p_following,false) then delete from public.follows where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id; return false; end if;
  if exists(select 1 from public.follows where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then return true; end if;
  if public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'forbidden'; end if;
  select p.owner_id into v_owner from public.pets p join public.users u on u.id=p.owner_id
  where p.id=p_to_pet_id and p.owner_id<>auth.uid() and p.moderation_status='approved' and p.discovery_enabled
    and u.suspended_at is null and u.paused_at is null and u.discoverable
    and (not u.incognito or exists(select 1 from public.pet_likes prior where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id));
  if v_owner is null then raise exception 'target_unavailable'; end if;
  perform public.rate_limit('follow',150,86400);
  insert into public.follows(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id) on conflict(from_pet_id,to_pet_id) do nothing;
  if found then insert into public.notifications(user_id,type,title,body,entity_id,actor_pet_id,recipient_pet_id)
    values(v_owner,'follow','New follower','A pet started following your pet.',p_from_pet_id,p_from_pet_id,p_to_pet_id); end if;
  return true;
end $$;
revoke all on function public.set_follow_pet(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_follow_pet(uuid,uuid,boolean) to authenticated;

create or replace function public.set_favorite_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_favorite boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id then raise exception 'forbidden'; end if;
  if not coalesce(p_favorite,false) then delete from public.pet_favorites where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id; return false; end if;
  if exists(select 1 from public.pet_favorites where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then return true; end if;
  if public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pets target join public.users target_user on target_user.id=target.owner_id
    where target.id=p_to_pet_id and target.owner_id<>auth.uid() and target.moderation_status='approved' and target.discovery_enabled
      and target_user.suspended_at is null and target_user.paused_at is null and target_user.discoverable
      and (not target_user.incognito or exists(select 1 from public.pet_likes prior where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id)))
  then raise exception 'target_unavailable'; end if;
  insert into public.pet_favorites(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id) on conflict(from_pet_id,to_pet_id) do nothing;
  return true;
end $$;
revoke all on function public.set_favorite_pet(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_favorite_pet(uuid,uuid,boolean) to authenticated;
