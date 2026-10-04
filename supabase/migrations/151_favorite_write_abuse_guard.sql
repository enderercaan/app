-- Tailmance v19 R8: favorites are retry-safe desired state, but a caller could still
-- create unbounded distinct favorite rows at machine speed. Rate-limit only a real new
-- favorite transition; removals and semantic retries remain free and immediately usable.

create or replace function public.set_favorite_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_favorite boolean)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id then raise exception 'forbidden'; end if;
  perform public.lock_owner_safety_relation(p_from_pet_id,p_to_pet_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('favorite:'||p_from_pet_id::text||':'||p_to_pet_id::text,0));

  if not coalesce(p_favorite,false) then
    delete from public.pet_favorites where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
    return false;
  end if;

  if exists(select 1 from public.pet_favorites where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then
    return true;
  end if;

  if public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'forbidden'; end if;
  if not exists(
    select 1
    from public.pets target
    join public.users target_user on target_user.id=target.owner_id
    where target.id=p_to_pet_id
      and target.owner_id<>auth.uid()
      and target.moderation_status='approved'
      and target.discovery_enabled
      and target_user.suspended_at is null
      and target_user.paused_at is null
      and target_user.discoverable
      and (
        not target_user.incognito
        or exists(
          select 1 from public.pet_likes prior
          where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id
        )
      )
  ) then raise exception 'target_unavailable'; end if;

  perform public.rate_limit('favorite',300,86400);
  insert into public.pet_favorites(from_pet_id,to_pet_id)
  values(p_from_pet_id,p_to_pet_id)
  on conflict(from_pet_id,to_pet_id) do nothing;
  return true;
end;
$$;
revoke all on function public.set_favorite_pet(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_favorite_pet(uuid,uuid,boolean) to authenticated;
