-- Tailmance v19 R8 ultra-deep audit: owner-safety serialization and response-loss-safe relationship actions.
-- Owner-to-owner block semantics must serialize with every pet relationship writer, otherwise a
-- concurrent like/follow/favorite/pass can commit after block cleanup and silently resurrect a
-- relationship. End-state destructive actions also reconcile an already-committed retry.

create or replace function public.lock_owner_safety_relation(p_pet_a uuid,p_pet_b uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner_a uuid; v_owner_b uuid; v_low text; v_high text;
begin
  select owner_id into v_owner_a from public.pets where id=p_pet_a;
  select owner_id into v_owner_b from public.pets where id=p_pet_b;
  if v_owner_a is null or v_owner_b is null or v_owner_a=v_owner_b then raise exception 'invalid_target'; end if;
  v_low:=least(v_owner_a::text,v_owner_b::text);
  v_high:=greatest(v_owner_a::text,v_owner_b::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('owner_safety:'||v_low||':'||v_high,0));
end $$;
revoke all on function public.lock_owner_safety_relation(uuid,uuid) from public,anon,authenticated;

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
  if p_from_pet_id=p_to_pet_id then raise exception 'invalid_target'; end if;
  perform public.lock_owner_safety_relation(p_from_pet_id,p_to_pet_id);
  if public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'invalid_target'; end if;
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

create or replace function public.set_follow_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_following boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id then raise exception 'forbidden'; end if;
  perform public.lock_owner_safety_relation(p_from_pet_id,p_to_pet_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('follow:'||p_from_pet_id::text||':'||p_to_pet_id::text,0));
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
  perform public.lock_owner_safety_relation(p_from_pet_id,p_to_pet_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('favorite:'||p_from_pet_id::text||':'||p_to_pet_id::text,0));
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

create or replace function public.pass_pet_idempotent(p_from_pet_id uuid,p_to_pet_id uuid,p_client_operation_id text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  perform public.lock_owner_safety_relation(p_from_pet_id,p_to_pet_id);
  v_hash:=public.client_mutation_hash(jsonb_build_object('fromPetId',p_from_pet_id,'toPetId',p_to_pet_id));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':pass_pet:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts
    where user_id=auth.uid() and action='pass_pet' and operation_id=v_op;
  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return;
  end if;
  perform public.pass_pet(p_from_pet_id,p_to_pet_id);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'pass_pet',v_op,v_hash,'{"applied":true}'::jsonb);
end $$;
revoke all on function public.pass_pet(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pass_pet_idempotent(uuid,uuid,text) from public,anon;
grant execute on function public.pass_pet_idempotent(uuid,uuid,text) to authenticated;

create or replace function public.unmatch_pet(p_match_id uuid,p_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_match public.pet_matches;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into v_match from public.pet_matches where id=p_match_id for update;
  if v_match.id is null or p_pet_id not in(v_match.pet_low_id,v_match.pet_high_id) then raise exception 'match_not_found'; end if;
  if v_match.unmatched_at is not null then return; end if;

  update public.pet_matches set unmatched_at=now(),unmatched_by_pet_id=p_pet_id where id=p_match_id;
  update public.meetup_requests set status='cancelled'
  where match_id=p_match_id and status in('pending','accepted');
  delete from public.pet_likes
  where (from_pet_id=v_match.pet_low_id and to_pet_id=v_match.pet_high_id)
     or (from_pet_id=v_match.pet_high_id and to_pet_id=v_match.pet_low_id);
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'pet_unmatched','match',p_match_id);
end $$;
revoke all on function public.unmatch_pet(uuid,uuid) from public,anon;
grant execute on function public.unmatch_pet(uuid,uuid) to authenticated;

create or replace function public.block_pet(p_blocker_pet_id uuid,p_blocked_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_blocker_owner uuid; v_blocked_owner uuid; v_already_blocked boolean;
begin
  if not public.owns_pet(p_blocker_pet_id) or p_blocker_pet_id=p_blocked_pet_id then raise exception 'forbidden'; end if;
  select owner_id into v_blocker_owner from public.pets where id=p_blocker_pet_id;
  select owner_id into v_blocked_owner from public.pets where id=p_blocked_pet_id;
  if v_blocked_owner is null or v_blocked_owner=v_blocker_owner then raise exception 'forbidden'; end if;
  perform public.lock_owner_safety_relation(p_blocker_pet_id,p_blocked_pet_id);

  select exists(
    select 1 from public.blocks x
    join public.pets a on a.id=x.blocker_pet_id
    join public.pets b on b.id=x.blocked_pet_id
    where a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner
  ) into v_already_blocked;
  if not v_already_blocked then
    perform public.rate_limit('block_pet',60,3600);
    insert into public.blocks(blocker_pet_id,blocked_pet_id)
    values(p_blocker_pet_id,p_blocked_pet_id) on conflict do nothing;
  end if;

  -- Even an exact retry re-runs idempotent cleanup, repairing any pre-hardening residue.
  perform 1
  from public.pet_matches m
  join public.pets a on a.id=m.pet_low_id
  join public.pets b on b.id=m.pet_high_id
  where m.unmatched_at is null
    and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner))
  for update of m;

  update public.pet_matches m set unmatched_at=now(),unmatched_by_pet_id=p_blocker_pet_id
  from public.pets a,public.pets b
  where m.unmatched_at is null and a.id=m.pet_low_id and b.id=m.pet_high_id
    and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));
  update public.meetup_requests r set status='cancelled'
  where r.status in('pending','accepted') and exists(
    select 1 from public.pet_matches m join public.pets a on a.id=m.pet_low_id join public.pets b on b.id=m.pet_high_id
    where m.id=r.match_id and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner))
  );
  delete from public.follows f using public.pets a,public.pets b
  where f.from_pet_id=a.id and f.to_pet_id=b.id and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));
  delete from public.pet_likes l using public.pets a,public.pets b
  where l.from_pet_id=a.id and l.to_pet_id=b.id and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));
  delete from public.pet_favorites f using public.pets a,public.pets b
  where f.from_pet_id=a.id and f.to_pet_id=b.id and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));
  delete from public.pet_passes p using public.pets a,public.pets b
  where p.from_pet_id=a.id and p.to_pet_id=b.id and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));

  if v_already_blocked then return; end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_blocker_pet_id,'pet_blocked','pet',p_blocked_pet_id);
end $$;
revoke all on function public.block_pet(uuid,uuid) from public,anon;
grant execute on function public.block_pet(uuid,uuid) to authenticated;

create or replace function public.unblock_pet(p_blocker_pet_id uuid,p_blocked_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_blocker_owner uuid; v_blocked_owner uuid; v_exists boolean;
begin
  if not public.owns_pet(p_blocker_pet_id) then raise exception 'forbidden'; end if;
  select owner_id into v_blocker_owner from public.pets where id=p_blocker_pet_id;
  select owner_id into v_blocked_owner from public.pets where id=p_blocked_pet_id;
  if v_blocked_owner is null or v_blocked_owner=v_blocker_owner then raise exception 'not_found'; end if;
  perform public.lock_owner_safety_relation(p_blocker_pet_id,p_blocked_pet_id);
  select exists(
    select 1 from public.blocks x join public.pets a on a.id=x.blocker_pet_id join public.pets b on b.id=x.blocked_pet_id
    where a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner
  ) into v_exists;
  if not v_exists then return; end if;
  perform public.rate_limit('unblock_pet',60,3600);
  delete from public.blocks x using public.pets a,public.pets b
  where x.blocker_pet_id=a.id and x.blocked_pet_id=b.id and a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_blocker_pet_id,'pet_unblocked','pet',p_blocked_pet_id);
end $$;
revoke all on function public.unblock_pet(uuid,uuid) from public,anon;
grant execute on function public.unblock_pet(uuid,uuid) to authenticated;
