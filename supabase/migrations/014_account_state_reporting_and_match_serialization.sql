-- Account suspension and privacy settings must be enforced at the server boundary, not only in discovery UI.
-- Executed-Postgres verification fix (2026-10-03): the 002 default-argument overload
-- owns_pet(uuid,uuid default auth.uid()) makes every one-argument call ambiguous once owns_pet(uuid)
-- exists, so the SQL-language function bodies below fail to compile on a real PostgreSQL server.
-- It has no two-argument callers and no dependent objects; 025 later re-asserts this drop idempotently.
revoke all on function public.owns_pet(uuid,uuid) from public,anon,authenticated;
drop function if exists public.owns_pet(uuid,uuid);
create or replace function public.owns_pet(p_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1
    from public.pets p
    join public.users u on u.id=p.owner_id
    where p.id=p_pet_id and p.owner_id=auth.uid() and u.suspended_at is null and u.paused_at is null
  );
$$;
revoke all on function public.owns_pet(uuid) from public,anon,authenticated;

create or replace function public.like_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_kind public.like_kind default 'like')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_match_id uuid;
  v_low uuid:=least(p_from_pet_id,p_to_pet_id);
  v_high uuid:=greatest(p_from_pet_id,p_to_pet_id);
  v_other_owner uuid;
  v_matched boolean:=false;
begin
  if not public.owns_pet(p_from_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pet_purposes pp where pp.pet_id=p_from_pet_id and pp.purpose<>'mating') then raise exception 'own_profile_purpose_unavailable'; end if;
  if not exists(select 1 from public.pet_purposes pp where pp.pet_id=p_to_pet_id and pp.purpose<>'mating') then raise exception 'target_unavailable'; end if;
  if p_from_pet_id=p_to_pet_id or public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'invalid_target'; end if;

  if not exists(
    select 1 from public.pets p
    where p.id=p_from_pet_id and p.moderation_status='approved' and p.discovery_enabled
      and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3
  ) then raise exception 'own_profile_not_discovery_ready'; end if;

  -- A known pet UUID must not bypass discoverable/incognito settings.
  if not exists(
    select 1
    from public.pets p
    join public.users u on u.id=p.owner_id
    where p.id=p_to_pet_id and p.owner_id<>auth.uid()
      and p.moderation_status='approved' and p.discovery_enabled
      and u.suspended_at is null and u.paused_at is null and u.discoverable
      and (not u.incognito or exists(
        select 1 from public.pet_likes prior
        where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id
      ))
      and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3
  ) then raise exception 'target_unavailable'; end if;

  perform public.rate_limit(case when p_kind='super_like' then 'super_like' else 'like' end,case when p_kind='super_like' then 20 else 200 end,86400);
  if p_kind='super_like' and not exists(select 1 from public.users where id=auth.uid() and tier='premium') then raise exception 'premium_required'; end if;

  insert into public.pet_likes(from_pet_id,to_pet_id,kind)
  values(p_from_pet_id,p_to_pet_id,p_kind)
  on conflict(from_pet_id,to_pet_id) do update set kind=excluded.kind,created_at=now();
  delete from public.pet_passes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;

  if exists(select 1 from public.pet_likes where from_pet_id=p_to_pet_id and to_pet_id=p_from_pet_id) then
    insert into public.pet_matches(pet_low_id,pet_high_id) values(v_low,v_high)
    on conflict(pet_low_id,pet_high_id) do update set unmatched_at=null,unmatched_by_pet_id=null,matched_at=now()
    returning id into v_match_id;
    insert into public.conversations(match_id) values(v_match_id) on conflict(match_id) do nothing;
    v_matched:=true;
    select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
    insert into public.notifications(user_id,type,title,body,entity_id)
    values(auth.uid(),'match','New match 🐾','Your pets liked each other and matched.',v_match_id);
    if v_other_owner<>auth.uid() then
      insert into public.notifications(user_id,type,title,body,entity_id)
      values(v_other_owner,'match','New match 🐾','Your pets liked each other and matched.',v_match_id);
    end if;
  else
    select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
    if v_other_owner is not null then
      insert into public.notifications(user_id,type,title,body,entity_id)
      values(v_other_owner,'like','New pet interest','One of your pets received a like.',p_from_pet_id);
    end if;
  end if;
  return jsonb_build_object('matched',v_matched,'match_id',v_match_id);
end $$;
revoke all on function public.like_pet(uuid,uuid,public.like_kind) from public,anon;
grant execute on function public.like_pet(uuid,uuid,public.like_kind) to authenticated;

create or replace function public.toggle_follow_pet(p_from_pet_id uuid,p_to_pet_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id then raise exception 'forbidden'; end if;
  perform public.rate_limit('follow',150,86400);

  -- Always allow an existing follow to be removed even if the target later becomes hidden/suspended.
  if exists(select 1 from public.follows where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then
    delete from public.follows where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
    return false;
  end if;

  if public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'forbidden'; end if;
  select p.owner_id into v_owner
  from public.pets p
  join public.users u on u.id=p.owner_id
  where p.id=p_to_pet_id and p.owner_id<>auth.uid()
    and p.moderation_status='approved' and p.discovery_enabled
    and u.suspended_at is null and u.paused_at is null and u.discoverable
    and (not u.incognito or exists(
      select 1 from public.pet_likes prior
      where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id
    ));
  if v_owner is null then raise exception 'target_unavailable'; end if;

  insert into public.follows(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id);
  insert into public.notifications(user_id,type,title,body,entity_id)
  values(v_owner,'follow','New follower','A pet started following your pet.',p_from_pet_id);
  return true;
end $$;
revoke all on function public.toggle_follow_pet(uuid,uuid) from public,anon;
grant execute on function public.toggle_follow_pet(uuid,uuid) to authenticated;

-- Keep the legacy pet-only reporting RPC, but route it through the canonical target validation.
create or replace function public.report_pet(p_reporter_pet_id uuid,p_reported_pet_id uuid,p_reason text,p_details text default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  return public.report_content(p_reporter_pet_id,'pet',p_reported_pet_id,p_reason,p_details);
end $$;
revoke all on function public.report_pet(uuid,uuid,text,text) from public,anon;
grant execute on function public.report_pet(uuid,uuid,text,text) to authenticated;

create or replace function public.get_discovery_suggestions(p_active_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_active_pet_id) then jsonb_build_object(
    'breeds',coalesce((select jsonb_agg(x) from (
      select distinct p.breed x from public.pets p join public.users u on u.id=p.owner_id
      where p.moderation_status='approved' and p.discovery_enabled and u.suspended_at is null and u.paused_at is null and u.discoverable and not u.incognito
        and not public.is_blocked(p_active_pet_id,p.id)
      order by x limit 80
    ) q),'[]'::jsonb),
    'cities',coalesce((select jsonb_agg(x) from (
      select distinct p.city x from public.pets p join public.users u on u.id=p.owner_id
      where p.moderation_status='approved' and p.discovery_enabled and u.suspended_at is null and u.paused_at is null and u.discoverable and not u.incognito
        and not public.is_blocked(p_active_pet_id,p.id)
      order by x limit 80
    ) q),'[]'::jsonb),
    'districts',coalesce((select jsonb_agg(x) from (
      select distinct p.district x from public.pets p join public.users u on u.id=p.owner_id
      where p.moderation_status='approved' and p.discovery_enabled and u.suspended_at is null and u.paused_at is null and u.discoverable and not u.incognito
        and not public.is_blocked(p_active_pet_id,p.id)
      order by x limit 120
    ) q),'[]'::jsonb),
    'neighborhoods',coalesce((select jsonb_agg(x) from (
      select distinct p.neighborhood x from public.pets p join public.users u on u.id=p.owner_id
      where p.moderation_status='approved' and p.discovery_enabled and p.neighborhood is not null
        and u.suspended_at is null and u.paused_at is null and u.discoverable and not u.incognito
        and not public.is_blocked(p_active_pet_id,p.id)
      order by x limit 160
    ) q),'[]'::jsonb)
  ) else null end;
$$;
revoke all on function public.get_discovery_suggestions(uuid) from public,anon;
grant execute on function public.get_discovery_suggestions(uuid) to authenticated;

create or replace function public.get_incoming_likes(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case
    when not public.owns_pet(p_pet_id) then null
    when not exists(select 1 from public.users where id=auth.uid() and tier='premium') then jsonb_build_object('error','premium_required')
    else coalesce(jsonb_agg(public.pet_json(l.from_pet_id,p_pet_id) || jsonb_build_object('likedAt',l.created_at,'likeKind',l.kind) order by l.created_at desc),'[]'::jsonb)
  end
  from public.pet_likes l
  join public.pets source_pet on source_pet.id=l.from_pet_id
  join public.users source_user on source_user.id=source_pet.owner_id
  where l.to_pet_id=p_pet_id
    and source_user.suspended_at is null and source_user.paused_at is null and source_user.discoverable
    and source_pet.moderation_status='approved'
    and not exists(select 1 from public.pet_matches m where m.unmatched_at is null and m.pet_low_id=least(l.from_pet_id,p_pet_id) and m.pet_high_id=greatest(l.from_pet_id,p_pet_id))
    and not public.is_blocked(l.from_pet_id,p_pet_id);
$$;
revoke all on function public.get_incoming_likes(uuid) from public,anon;
grant execute on function public.get_incoming_likes(uuid) to authenticated;

create or replace function public.update_pet_health_claims(p_pet_id uuid,p_neutered boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('pet_health_claim_update',40,86400);
  insert into public.pet_health_summary(pet_id,neutered) values(p_pet_id,p_neutered)
  on conflict(pet_id) do update set neutered=excluded.neutered,updated_at=now();
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'pet_health_claim_update','pet',p_pet_id);
end $$;
revoke all on function public.update_pet_health_claims(uuid,boolean) from public,anon;
grant execute on function public.update_pet_health_claims(uuid,boolean) to authenticated;

-- Serialize match-state transitions with chat/meetup mutations so stale pre-checks cannot write after unmatch/block.
create or replace function public.create_meetup_request(
  p_match_id uuid,p_proposed_by_pet_id uuid,p_starts_at timestamptz,p_public_place_label text,p_note text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_match public.pet_matches;
begin
  if not public.owns_pet(p_proposed_by_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('meetup_request',10,86400);
  if p_starts_at<=now() then raise exception 'future_time_required'; end if;
  if char_length(trim(coalesce(p_public_place_label,''))) not between 2 and 160 then raise exception 'invalid_place_label'; end if;
  if char_length(trim(coalesce(p_note,'')))>500 then raise exception 'meetup_note_too_long'; end if;

  select * into v_match
  from public.pet_matches
  where id=p_match_id and unmatched_at is null
  for share;
  if v_match.id is null or p_proposed_by_pet_id not in(v_match.pet_low_id,v_match.pet_high_id)
     or public.is_blocked(v_match.pet_low_id,v_match.pet_high_id) then
    raise exception 'active_match_required';
  end if;

  insert into public.meetup_requests(match_id,proposed_by_pet_id,starts_at,public_place_label,note)
  values(p_match_id,p_proposed_by_pet_id,p_starts_at,trim(p_public_place_label),nullif(trim(coalesce(p_note,'')),''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_meetup_request(uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.create_meetup_request(uuid,uuid,timestamptz,text,text) to authenticated;

create or replace function public.send_message(p_conversation_id uuid,p_sender_pet_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_match public.pet_matches;
  v_uid uuid:=auth.uid();
  v_msg public.messages;
  v_other_pet uuid;
  v_other_owner uuid;
  v_tier public.account_tier;
  v_body text:=trim(coalesce(p_body,''));
begin
  if not public.owns_pet(p_sender_pet_id) then raise exception 'forbidden'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception 'invalid_message'; end if;
  perform public.rate_limit('message',60,60);

  select m.* into v_match
  from public.conversations c join public.pet_matches m on m.id=c.match_id
  where c.id=p_conversation_id
  for share of m;
  if v_match.id is null or v_match.unmatched_at is not null
     or p_sender_pet_id not in(v_match.pet_low_id,v_match.pet_high_id) then
    raise exception 'active_match_required';
  end if;
  v_other_pet:=case when p_sender_pet_id=v_match.pet_low_id then v_match.pet_high_id else v_match.pet_low_id end;
  if public.is_blocked(p_sender_pet_id,v_other_pet) then raise exception 'blocked'; end if;
  if not exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id=v_other_pet and u.suspended_at is null and u.paused_at is null) then raise exception 'recipient_unavailable'; end if;

  select tier into v_tier from public.users where id=v_uid for update;
  if v_tier='standard' then
    update public.users set free_messages_sent=free_messages_sent+1 where id=v_uid and free_messages_sent<2;
    if not found then raise exception 'free_message_limit_reached'; end if;
  end if;

  insert into public.messages(conversation_id,sender_pet_id,body)
  values(p_conversation_id,p_sender_pet_id,v_body) returning * into v_msg;
  select owner_id into v_other_owner from public.pets where id=v_other_pet;
  insert into public.notifications(user_id,type,title,body,entity_id)
  values(v_other_owner,'message','New message','You have a new message from a matched pet.',p_conversation_id);
  return jsonb_build_object('id',v_msg.id,'conversationId',v_msg.conversation_id,'senderPetId',v_msg.sender_pet_id,'body',v_msg.body,'createdAt',v_msg.created_at,'readAt',v_msg.read_at);
end $$;
revoke all on function public.send_message(uuid,uuid,text) from public,anon;
grant execute on function public.send_message(uuid,uuid,text) to authenticated;

create or replace function public.respond_meetup_request(p_request_id uuid,p_pet_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.meetup_requests; m public.pet_matches; v_match_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_status not in ('accepted','declined','cancelled') then raise exception 'invalid_status'; end if;
  perform public.rate_limit('meetup_response',40,3600);

  -- Read the match id first, then lock match -> request consistently with block/unmatch paths.
  select match_id into v_match_id from public.meetup_requests where id=p_request_id;
  if v_match_id is null then raise exception 'request_not_pending'; end if;
  select * into m from public.pet_matches where id=v_match_id and unmatched_at is null for share;
  if m.id is null or p_pet_id not in(m.pet_low_id,m.pet_high_id)
     or public.is_blocked(m.pet_low_id,m.pet_high_id) then raise exception 'active_match_required'; end if;

  select * into r from public.meetup_requests where id=p_request_id and match_id=v_match_id for update;
  if r.id is null or r.status<>'pending' then raise exception 'request_not_pending'; end if;
  if p_status='cancelled' and r.proposed_by_pet_id<>p_pet_id then raise exception 'forbidden'; end if;
  if p_status in ('accepted','declined') and r.proposed_by_pet_id=p_pet_id then raise exception 'other_pet_must_respond'; end if;
  update public.meetup_requests set status=p_status where id=p_request_id;
end $$;
revoke all on function public.respond_meetup_request(uuid,uuid,text) from public,anon;
grant execute on function public.respond_meetup_request(uuid,uuid,text) to authenticated;

create or replace function public.unmatch_pet(p_match_id uuid,p_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_match public.pet_matches;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into v_match from public.pet_matches
  where id=p_match_id and unmatched_at is null and p_pet_id in(pet_low_id,pet_high_id)
  for update;
  if v_match.id is null then raise exception 'match_not_found'; end if;

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
declare v_blocker_owner uuid; v_blocked_owner uuid;
begin
  if not public.owns_pet(p_blocker_pet_id) or p_blocker_pet_id=p_blocked_pet_id then raise exception 'forbidden'; end if;
  select owner_id into v_blocker_owner from public.pets where id=p_blocker_pet_id;
  select owner_id into v_blocked_owner from public.pets where id=p_blocked_pet_id;
  if v_blocked_owner is null or v_blocked_owner=v_blocker_owner then raise exception 'forbidden'; end if;
  perform public.rate_limit('block_pet',60,3600);

  -- Lock all active matches between these owners before changing relationship state.
  perform 1
  from public.pet_matches m
  join public.pets a on a.id=m.pet_low_id
  join public.pets b on b.id=m.pet_high_id
  where m.unmatched_at is null
    and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner))
  for update of m;

  insert into public.blocks(blocker_pet_id,blocked_pet_id)
  values(p_blocker_pet_id,p_blocked_pet_id) on conflict do nothing;

  update public.pet_matches m set unmatched_at=now(),unmatched_by_pet_id=p_blocker_pet_id
  from public.pets a,public.pets b
  where m.unmatched_at is null and a.id=m.pet_low_id and b.id=m.pet_high_id
    and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));

  update public.meetup_requests r set status='cancelled'
  where r.status in('pending','accepted') and exists(
    select 1 from public.pet_matches m
    join public.pets a on a.id=m.pet_low_id
    join public.pets b on b.id=m.pet_high_id
    where m.id=r.match_id
      and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner))
  );

  delete from public.follows f using public.pets a,public.pets b
  where f.from_pet_id=a.id and f.to_pet_id=b.id and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));
  delete from public.pet_likes l using public.pets a,public.pets b
  where l.from_pet_id=a.id and l.to_pet_id=b.id and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));
  delete from public.pet_favorites f using public.pets a,public.pets b
  where f.from_pet_id=a.id and f.to_pet_id=b.id and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));
  delete from public.pet_passes p using public.pets a,public.pets b
  where p.from_pet_id=a.id and p.to_pet_id=b.id and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));

  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_blocker_pet_id,'pet_blocked','pet',p_blocked_pet_id);
end $$;
revoke all on function public.block_pet(uuid,uuid) from public,anon;
grant execute on function public.block_pet(uuid,uuid) to authenticated;

