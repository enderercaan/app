-- Tailmance v19 R8: server-authoritative pet-profile deep-link visibility.
-- Universal/App Links never bypass legal/product access, block state, moderation, privacy, or incognito rules.

create or replace function public.get_shareable_pet_profile(p_viewer_pet_id uuid,p_target_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_target public.pets;
  v_owner public.users;
  v_allowed boolean:=false;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if not public.owns_pet(p_viewer_pet_id) then raise exception 'forbidden'; end if;

  select * into v_target from public.pets where id=p_target_pet_id;
  if v_target.id is null then return null; end if;
  if v_target.owner_id=auth.uid() then return public.pet_json(v_target.id,p_viewer_pet_id); end if;

  select * into v_owner from public.users where id=v_target.owner_id;
  if v_owner.id is null or v_owner.suspended_at is not null or v_owner.paused_at is not null or not v_owner.discoverable then return null; end if;
  if v_target.moderation_status<>'approved' then return null; end if;
  if (select count(*) from public.pet_photos ph where ph.pet_id=v_target.id and ph.moderation_status='approved')<>3 then return null; end if;
  if public.is_blocked(p_viewer_pet_id,v_target.id) then return null; end if;

  if not v_owner.incognito then
    v_allowed:=true;
  else
    v_allowed:=
      exists(select 1 from public.pet_likes l where l.from_pet_id=v_target.id and l.to_pet_id=p_viewer_pet_id)
      or exists(select 1 from public.follows f where f.from_pet_id=v_target.id and f.to_pet_id=p_viewer_pet_id)
      or exists(
        select 1 from public.pet_matches m
        where m.unmatched_at is null
          and m.pet_low_id=least(p_viewer_pet_id,v_target.id)
          and m.pet_high_id=greatest(p_viewer_pet_id,v_target.id)
      );
  end if;

  if not v_allowed then return null; end if;
  return public.pet_json(v_target.id,p_viewer_pet_id);
end $$;
revoke all on function public.get_shareable_pet_profile(uuid,uuid) from public,anon;
grant execute on function public.get_shareable_pet_profile(uuid,uuid) to authenticated;
