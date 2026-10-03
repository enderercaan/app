-- v19 R8 deep blind-spot continuation: make likes economically and side-effect idempotent.
-- The authenticated user's row is locked before inspecting/charging the pair, serializing
-- concurrent retries from the same account without introducing a client-supplied idempotency key.
create or replace function public.like_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_kind public.like_kind default 'like')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_match_id uuid;
  v_low uuid:=least(p_from_pet_id,p_to_pet_id);
  v_high uuid:=greatest(p_from_pet_id,p_to_pet_id);
  v_other_owner uuid;
  v_matched boolean:=false;
  v_tier public.account_tier;
  v_mating_enabled boolean:=public.current_mating_feature_enabled();
  v_from_non_mating boolean;
  v_to_non_mating boolean;
  v_mutual_mating boolean;
  v_existing_kind public.like_kind;
  v_had_like boolean:=false;
  v_like_changed boolean:=false;
  v_existing_match_id uuid;
  v_existing_unmatched_at timestamptz;
  v_emit_match boolean:=false;
begin
  if not public.owns_pet(p_from_pet_id) then raise exception 'forbidden'; end if;
  if p_from_pet_id=p_to_pet_id or public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'invalid_target'; end if;
  if not exists(select 1 from public.pets where id=p_from_pet_id and species='dog') or not exists(select 1 from public.pets where id=p_to_pet_id and species='dog') then raise exception 'dog_discovery_only'; end if;
  select exists(select 1 from public.pet_purposes pp where pp.pet_id=p_from_pet_id and pp.purpose<>'mating') into v_from_non_mating;
  select exists(select 1 from public.pet_purposes pp where pp.pet_id=p_to_pet_id and pp.purpose<>'mating') into v_to_non_mating;
  select v_mating_enabled and public.mating_pair_profile_signals_eligible(p_from_pet_id,p_to_pet_id) into v_mutual_mating;
  if not v_from_non_mating and not v_mutual_mating then raise exception 'own_profile_purpose_unavailable'; end if;
  if not v_to_non_mating and not v_mutual_mating then raise exception 'target_unavailable'; end if;
  if not exists(select 1 from public.pets p where p.id=p_from_pet_id and p.moderation_status='approved' and p.discovery_enabled and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3) then raise exception 'own_profile_not_discovery_ready'; end if;
  if not exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id=p_to_pet_id and p.owner_id<>auth.uid() and p.moderation_status='approved' and p.discovery_enabled and u.suspended_at is null and u.paused_at is null and u.discoverable and (not u.incognito or exists(select 1 from public.pet_likes prior where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id)) and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3) then raise exception 'target_unavailable'; end if;

  -- Serializes duplicate taps/retries for this account before credit or notification side effects.
  select tier into v_tier from public.users where id=auth.uid() for update;
  select kind into v_existing_kind from public.pet_likes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
  v_had_like:=found;
  v_like_changed:=not v_had_like or (v_existing_kind='like' and p_kind='super_like');

  if v_like_changed then
    if p_kind='super_like' then
      perform public.rate_limit('super_like_abuse_guard',200,86400);
      if v_tier<>'premium' then
        insert into public.consumable_balances(user_id) values(auth.uid()) on conflict(user_id) do nothing;
        update public.consumable_balances set super_like_credits=super_like_credits-1,updated_at=now() where user_id=auth.uid() and super_like_credits>0;
        if not found then raise exception 'premium_or_super_like_credit_required'; end if;
      end if;
    elsif v_tier='premium' then
      perform public.rate_limit('like_abuse_guard',5000,86400);
    else
      perform public.rate_limit('like',200,86400);
    end if;
  end if;

  insert into public.pet_likes(from_pet_id,to_pet_id,kind) values(p_from_pet_id,p_to_pet_id,p_kind)
  on conflict(from_pet_id,to_pet_id) do update set
    kind=case when public.pet_likes.kind='super_like' then public.pet_likes.kind else excluded.kind end;
  delete from public.pet_passes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;

  if exists(select 1 from public.pet_likes where from_pet_id=p_to_pet_id and to_pet_id=p_from_pet_id) then
    select id,unmatched_at into v_existing_match_id,v_existing_unmatched_at
    from public.pet_matches where pet_low_id=v_low and pet_high_id=v_high for update;
    if found then
      v_match_id:=v_existing_match_id;
      if v_existing_unmatched_at is not null then
        update public.pet_matches set unmatched_at=null,unmatched_by_pet_id=null,matched_at=now() where id=v_match_id;
        v_emit_match:=true;
      end if;
    else
      insert into public.pet_matches(pet_low_id,pet_high_id) values(v_low,v_high) returning id into v_match_id;
      v_emit_match:=true;
    end if;
    insert into public.conversations(match_id) values(v_match_id) on conflict(match_id) do nothing;
    v_matched:=true;
    if v_emit_match then
      select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
      insert into public.notifications(user_id,type,title,body,entity_id,template_key,template_params,actor_pet_id) values(auth.uid(),'match','New match','Your pets liked each other and matched.',v_match_id,'match',jsonb_build_object(),p_to_pet_id);
      if v_other_owner<>auth.uid() then
        insert into public.notifications(user_id,type,title,body,entity_id,template_key,template_params,actor_pet_id) values(v_other_owner,'match','New match','Your pets liked each other and matched.',v_match_id,'match',jsonb_build_object(),p_from_pet_id);
      end if;
    end if;
  elsif not v_had_like then
    select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
    if v_other_owner is not null then
      insert into public.notifications(user_id,type,title,body,entity_id,template_key,template_params,actor_pet_id) values(v_other_owner,'like','New pet interest','One of your pets received a like.',p_from_pet_id,'like',jsonb_build_object(),p_from_pet_id);
    end if;
  end if;
  return jsonb_build_object('matched',v_matched,'match_id',v_match_id);
end $$;
revoke all on function public.like_pet(uuid,uuid,public.like_kind) from public,anon;
grant execute on function public.like_pet(uuid,uuid,public.like_kind) to authenticated;
