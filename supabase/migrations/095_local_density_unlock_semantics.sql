-- Tailmance v19 R8: neighborhood launch density must be based on active dogs, not waitlist size.
-- Waitlist membership is a referral/growth signal only. A neighborhood remains fail-closed
-- until it is explicitly configured as pilot_open/open by an operator.

create or replace function public.get_local_network_status(p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  p public.pets;
  z public.community_launch_zones;
  v_active integer:=0;
  v_waitlist integer:=0;
  v_has_managed_area boolean:=false;
  v_density_target integer:=300;
  v_referral_target integer:=40;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into p from public.pets where id=p_pet_id;
  if p.species='cat' then
    return jsonb_build_object('status','feed_only','activePets',0,'densityTarget',0,'waitlistCount',0,'waitlistTarget',0,'remainingToOpen',0,'pilot',false);
  end if;

  select exists(
    select 1 from public.community_launch_zones x
    where x.active
      and public.normalize_search_text(x.city)=public.normalize_search_text(p.city)
      and public.normalize_search_text(x.district)=public.normalize_search_text(p.district)
  ) into v_has_managed_area;

  select * into z from public.community_launch_zones x
  where x.active
    and public.normalize_search_text(x.city)=public.normalize_search_text(p.city)
    and public.normalize_search_text(x.district)=public.normalize_search_text(p.district)
    and public.normalize_search_text(x.neighborhood)=public.normalize_search_text(coalesce(p.neighborhood,''))
  limit 1;

  select count(*) into v_active
  from public.pets other
  join public.users u on u.id=other.owner_id
  where other.species='dog'
    and other.moderation_status='approved'
    and other.discovery_enabled
    and u.suspended_at is null
    and u.paused_at is null
    and public.normalize_search_text(other.city)=public.normalize_search_text(p.city)
    and public.normalize_search_text(other.district)=public.normalize_search_text(p.district)
    and public.normalize_search_text(coalesce(other.neighborhood,''))=public.normalize_search_text(coalesce(p.neighborhood,''));

  select count(*) into v_waitlist
  from public.community_waitlist w
  where public.normalize_search_text(w.city)=public.normalize_search_text(p.city)
    and public.normalize_search_text(w.district)=public.normalize_search_text(p.district)
    and public.normalize_search_text(w.neighborhood)=public.normalize_search_text(coalesce(p.neighborhood,''));

  if z.id is not null then
    v_density_target:=z.density_target;
    v_referral_target:=z.waitlist_unlock_target;
    return jsonb_build_object(
      'status',case when z.launch_status in ('pilot_open','open') then 'open' else 'waitlist' end,
      'activePets',v_active,
      'densityTarget',v_density_target,
      'waitlistCount',v_waitlist,
      'waitlistTarget',v_referral_target,
      'remainingToOpen',greatest(v_density_target-v_active,0),
      'pilot',z.launch_status='pilot_open',
      'operatorApprovalRequired',z.launch_status not in ('pilot_open','open')
    );
  end if;

  -- Unconfigured neighborhoods never auto-open. 300 active dogs is the minimum density
  -- target; reaching it makes remainingToOpen zero but an explicit operator rollout is
  -- still required. The 40-person waitlist value remains only a referral milestone.
  return jsonb_build_object(
    'status','waitlist',
    'activePets',v_active,
    'densityTarget',v_density_target,
    'waitlistCount',v_waitlist,
    'waitlistTarget',v_referral_target,
    'remainingToOpen',greatest(v_density_target-v_active,0),
    'pilot',false,
    'operatorApprovalRequired',true,
    'managedDistrict',v_has_managed_area
  );
end $$;

revoke all on function public.get_local_network_status(uuid) from public,anon;
grant execute on function public.get_local_network_status(uuid) to authenticated;
