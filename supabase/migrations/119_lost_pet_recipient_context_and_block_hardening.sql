-- Tailmance v19 R8 ultra-deep audit: make Lost Paw notifications deterministic for multi-pet
-- recipients, respect block boundaries, and serialize replacement alerts for one pet.

create or replace function public.create_lost_pet_alert(p_pet_id uuid,p_last_seen_at timestamptz,p_radius_km numeric default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  p public.pets;
  priv public.pet_private;
  v_id uuid;
  v_radius numeric:=least(greatest(coalesce(p_radius_km,5),1),25);
  r record;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_last_seen_at>now()+interval '5 minutes' or p_last_seen_at<now()-interval '30 days' then raise exception 'invalid_last_seen_time'; end if;

  -- Serialize replace-active semantics for the same pet. The existing partial unique index is
  -- still the final invariant; this lock makes concurrent retries deterministic instead of
  -- allowing one request to fail on the unique index after both observed the previous state.
  select * into p from public.pets where id=p_pet_id for update;
  if p.id is null then raise exception 'forbidden'; end if;
  select * into priv from public.pet_private where pet_id=p_pet_id;
  if priv.latitude is null or priv.longitude is null then raise exception 'private_location_required'; end if;

  perform public.rate_limit('lost_pet_alert',3,86400);
  update public.lost_pet_alerts set status='cancelled' where pet_id=p_pet_id and status='active';
  insert into public.lost_pet_alerts(pet_id,owner_user_id,last_seen_at,city,district,neighborhood,alert_radius_km,latitude,longitude)
  values(p.id,auth.uid(),p_last_seen_at,p.city,p.district,p.neighborhood,v_radius,priv.latitude,priv.longitude)
  returning id into v_id;

  -- One deterministic recipient-pet context per user: the nearest eligible owned pet. This
  -- prevents a multi-pet account from opening the alert under an unrelated active pet and
  -- prevents proximity notifications from crossing an existing block boundary.
  for r in
    select distinct on (u.id)
      u.id as user_id,
      rp.id as recipient_pet_id,
      public.haversine_km(priv.latitude,priv.longitude,pp.latitude,pp.longitude) as distance_km
    from public.pets rp
    join public.users u on u.id=rp.owner_id
    join public.pet_private pp on pp.pet_id=rp.id
    where u.id<>auth.uid()
      and u.suspended_at is null and u.paused_at is null
      and rp.moderation_status='approved'
      and pp.latitude is not null and pp.longitude is not null
      and not public.is_blocked(p.id,rp.id)
      and public.haversine_km(priv.latitude,priv.longitude,pp.latitude,pp.longitude)<=v_radius
    order by u.id,distance_km asc,rp.id
  loop
    insert into public.notifications(
      user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id,recipient_pet_id
    ) values(
      r.user_id,'lost_pet','Lost pet alert','A pet was reported missing near you.',v_id,
      format('lost_pet:%s:%s',v_id,r.user_id),'lost_pet',
      jsonb_build_object('petName',p.name,'district',p.district,'neighborhood',coalesce(p.neighborhood,'')),
      p.id,r.recipient_pet_id
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end loop;

  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p.id,'lost_pet_alert_created','lost_pet_alert',v_id);
  return jsonb_build_object('id',v_id,'status','active');
end $$;
revoke all on function public.create_lost_pet_alert(uuid,timestamptz,numeric) from public,anon;
grant execute on function public.create_lost_pet_alert(uuid,timestamptz,numeric) to authenticated;

create or replace function public.get_nearby_lost_pet_alerts(p_pet_id uuid,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare mine public.pet_private; v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into mine from public.pet_private where pet_id=p_pet_id;
  if mine.latitude is null or mine.longitude is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'petId',x.pet_id,'petName',x.pet_name,'breed',x.breed,'species',x.species,'photoPath',x.photo_path,'lastSeenAt',x.last_seen_at,
    'city',x.city,'district',x.district,'neighborhood',x.neighborhood,'approximateDistanceKm',round(x.distance_km::numeric,1),'createdAt',x.created_at,'isMine',x.owner_user_id=auth.uid()
  ) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select a.*,p.name pet_name,p.breed,p.species::text species,
      (select ph.storage_path from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved' order by ph.sort_order limit 1) photo_path,
      public.haversine_km(mine.latitude,mine.longitude,a.latitude,a.longitude) distance_km
    from public.lost_pet_alerts a
    join public.pets p on p.id=a.pet_id
    join public.users u on u.id=p.owner_id
    where a.status='active'
      and u.suspended_at is null and u.paused_at is null
      and p.moderation_status='approved'
      and not public.is_blocked(p_pet_id,a.pet_id)
  ) x
  where x.distance_km<=x.alert_radius_km
  order by x.created_at desc
  limit least(greatest(p_limit,1),50);
  return v_result;
end $$;
revoke all on function public.get_nearby_lost_pet_alerts(uuid,integer) from public,anon;
grant execute on function public.get_nearby_lost_pet_alerts(uuid,integer) to authenticated;
