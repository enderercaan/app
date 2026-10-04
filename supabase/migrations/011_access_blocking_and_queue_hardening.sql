-- User-controlled account pause is separate from administrative suspension.
alter table public.users add column if not exists paused_at timestamptz;
create index if not exists idx_users_paused on public.users(paused_at) where paused_at is not null;

-- Blocking/unmatching terminates direct chat read access as well as message creation.
drop policy if exists messages_participant_read on public.messages;
create policy messages_participant_read on public.messages for select to authenticated using (
  exists(
    select 1
    from public.conversations c
    join public.pet_matches m on m.id=c.match_id
    join public.pets mine on mine.owner_id=auth.uid() and mine.id in(m.pet_low_id,m.pet_high_id)
    where c.id=messages.conversation_id
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
  )
);

create or replace function public.get_conversation_messages(p_conversation_id uuid,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'conversationId',x.conversation_id,'senderPetId',x.sender_pet_id,'body',x.body,'createdAt',x.created_at,'readAt',x.read_at) order by x.created_at),'[]'::jsonb)
  from (
    select msg.*
    from public.messages msg
    join public.conversations c on c.id=msg.conversation_id
    join public.pet_matches m on m.id=c.match_id
    where msg.conversation_id=p_conversation_id
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id))
    order by msg.created_at desc
    limit least(greatest(p_limit,1),200)
  ) x;
$$;

create or replace function public.get_conversation_messages_page(p_conversation_id uuid,p_limit integer default 40,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'conversationId',x.conversation_id,'senderPetId',x.sender_pet_id,'body',x.body,'createdAt',x.created_at,'readAt',x.read_at) order by x.created_at,x.id),'[]'::jsonb)
  from (
    select msg.*
    from public.messages msg
    join public.conversations c on c.id=msg.conversation_id
    join public.pet_matches m on m.id=c.match_id
    where msg.conversation_id=p_conversation_id
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id))
      and (p_before_created_at is null or (msg.created_at,msg.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by msg.created_at desc,msg.id desc
    limit least(greatest(p_limit,1),100)
  ) x;
$$;

-- Social mutations must not bypass a block by using a known object UUID.
create or replace function public.toggle_post_like(p_pet_id uuid,p_post_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_author_pet uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select po.pet_id into v_author_pet from public.posts po join public.pets author on author.id=po.pet_id join public.users au on au.id=author.owner_id where po.id=p_post_id and po.deleted_at is null and po.moderation_status='approved' and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  perform public.rate_limit('post_like',300,86400);
  if exists(select 1 from public.post_likes where post_id=p_post_id and pet_id=p_pet_id) then
    delete from public.post_likes where post_id=p_post_id and pet_id=p_pet_id; return false;
  end if;
  insert into public.post_likes(post_id,pet_id) values(p_post_id,p_pet_id); return true;
end $$;

create or replace function public.toggle_save_post(p_pet_id uuid,p_post_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_author_pet uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select po.pet_id into v_author_pet from public.posts po join public.pets author on author.id=po.pet_id join public.users au on au.id=author.owner_id where po.id=p_post_id and po.deleted_at is null and po.moderation_status='approved' and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  if exists(select 1 from public.saved_posts where post_id=p_post_id and pet_id=p_pet_id) then
    delete from public.saved_posts where post_id=p_post_id and pet_id=p_pet_id; return false;
  end if;
  insert into public.saved_posts(post_id,pet_id) values(p_post_id,p_pet_id); return true;
end $$;

create or replace function public.create_comment(p_pet_id uuid,p_post_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_owner uuid; v_author_pet uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select po.pet_id,p.owner_id into v_author_pet,v_owner from public.posts po join public.pets p on p.id=po.pet_id join public.users au on au.id=p.owner_id where po.id=p_post_id and po.deleted_at is null and po.moderation_status='approved' and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  if char_length(trim(coalesce(p_body,'')))=0 then raise exception 'empty_comment'; end if;
  if char_length(trim(p_body))>1000 then raise exception 'comment_too_long'; end if;
  perform public.rate_limit('comment',80,3600);
  insert into public.comments(post_id,pet_id,body,moderation_status) values(p_post_id,p_pet_id,trim(p_body),'pending') returning id into v_id;
  if v_owner<>auth.uid() then insert into public.notifications(user_id,type,title,body,entity_id) values(v_owner,'comment','New comment','A pet commented on your post.',p_post_id); end if;
  insert into public.moderation_items(target_type,target_id,status) values('comment_text',v_id,'pending') on conflict do nothing;
  return v_id;
end $$;

create or replace function public.mark_story_seen(p_story_id uuid,p_viewer_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_author_pet uuid;
begin
  if not public.owns_pet(p_viewer_pet_id) then raise exception 'forbidden'; end if;
  select s.pet_id into v_author_pet from public.stories s join public.pets author on author.id=s.pet_id join public.users au on au.id=author.owner_id where s.id=p_story_id and s.expires_at>now() and s.moderation_status='approved' and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_viewer_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  if v_author_pet<>p_viewer_pet_id and not exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=v_author_pet) then raise exception 'not_found'; end if;
  insert into public.story_views(story_id,viewer_pet_id) values(p_story_id,p_viewer_pet_id) on conflict do nothing;
end $$;

create or replace function public.set_event_attendance(p_event_id uuid,p_pet_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare v_creator_pet uuid; v_capacity integer; v_going integer;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select e.creator_pet_id,e.capacity into v_creator_pet,v_capacity from public.pet_events e join public.pets creator on creator.id=e.creator_pet_id join public.users cu on cu.id=creator.owner_id where e.id=p_event_id and e.moderation_status='approved' and e.starts_at>now() and cu.suspended_at is null and cu.paused_at is null;
  if v_creator_pet is null or public.is_blocked(p_pet_id,v_creator_pet) then raise exception 'not_found'; end if;
  perform public.rate_limit('event_attendance',100,86400);
  if p_status='none' then
    delete from public.event_attendees where event_id=p_event_id and pet_id=p_pet_id;
  elsif p_status in ('going','interested') then
    if p_status='going' and v_capacity is not null then
      select count(*) into v_going from public.event_attendees where event_id=p_event_id and status='going' and pet_id<>p_pet_id;
      if v_going>=v_capacity then raise exception 'event_full'; end if;
    end if;
    insert into public.event_attendees(event_id,pet_id,status) values(p_event_id,p_pet_id,p_status::public.event_attendance_status)
    on conflict(event_id,pet_id) do update set status=excluded.status;
  else raise exception 'invalid_status'; end if;
end $$;

-- A message can be reported only by a participant in that message's conversation.
create or replace function public.report_content(p_reporter_pet_id uuid,p_target_type text,p_target_id uuid,p_reason text,p_details text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_exists boolean:=false;
begin
  if not public.owns_pet(p_reporter_pet_id) then raise exception 'forbidden'; end if;
  if p_target_type not in ('pet','post','comment','message','story','event') then raise exception 'invalid_target_type'; end if;
  if char_length(trim(coalesce(p_reason,''))) not between 1 and 100 then raise exception 'invalid_reason'; end if;
  if char_length(coalesce(p_details,''))>2000 then raise exception 'invalid_details'; end if;
  perform public.rate_limit('report',20,86400);
  if p_target_type='pet' then select exists(select 1 from public.pets where id=p_target_id and owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='post' then select exists(select 1 from public.posts po join public.pets p on p.id=po.pet_id where po.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='comment' then select exists(select 1 from public.comments c join public.pets p on p.id=c.pet_id where c.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='message' then
    select exists(
      select 1 from public.messages msg
      join public.conversations c on c.id=msg.conversation_id
      join public.pet_matches m on m.id=c.match_id
      where msg.id=p_target_id and msg.sender_pet_id<>p_reporter_pet_id and p_reporter_pet_id in(m.pet_low_id,m.pet_high_id)
    ) into v_exists;
  elsif p_target_type='story' then select exists(select 1 from public.stories s join public.pets p on p.id=s.pet_id where s.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='event' then select exists(select 1 from public.pet_events e join public.pets p on p.id=e.creator_pet_id where e.id=p_target_id and p.owner_id<>auth.uid()) into v_exists; end if;
  if not v_exists then raise exception 'invalid_target'; end if;
  insert into public.reports(reporter_user_id,reporter_pet_id,target_type,target_id,reason,details)
  values(auth.uid(),p_reporter_pet_id,p_target_type,p_target_id,trim(p_reason),nullif(trim(coalesce(p_details,'')),'')) returning id into v_id;
  return v_id;
end $$;

-- Passive actions should also respect blocks.
create or replace function public.pass_pet(p_from_pet_id uuid,p_to_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id or public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'forbidden'; end if;
  if not exists(
    select 1 from public.pets target
    join public.users target_user on target_user.id=target.owner_id
    where target.id=p_to_pet_id and target.owner_id<>auth.uid()
      and target_user.suspended_at is null and target_user.paused_at is null
  ) then raise exception 'target_unavailable'; end if;
  perform public.rate_limit('pass',400,86400);
  insert into public.pet_passes(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id) on conflict(from_pet_id,to_pet_id) do update set created_at=now();
  delete from public.pet_likes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
end $$;

create or replace function public.toggle_favorite_pet(p_from_pet_id uuid,p_to_pet_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id then raise exception 'forbidden'; end if;
  -- Always allow cleanup of an existing favorite even when the target later pauses or is suspended.
  if exists(select 1 from public.pet_favorites where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then
    delete from public.pet_favorites where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id; return false;
  end if;
  if public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'forbidden'; end if;
  if not exists(
    select 1 from public.pets target
    join public.users target_user on target_user.id=target.owner_id
    where target.id=p_to_pet_id and target.owner_id<>auth.uid()
      and target_user.suspended_at is null and target_user.paused_at is null
  ) then raise exception 'target_unavailable'; end if;
  insert into public.pet_favorites(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id); return true;
end $$;

revoke all on function public.get_conversation_messages(uuid,integer) from public,anon;
grant execute on function public.get_conversation_messages(uuid,integer) to authenticated;
revoke all on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) to authenticated;
revoke all on function public.toggle_post_like(uuid,uuid) from public,anon;
grant execute on function public.toggle_post_like(uuid,uuid) to authenticated;
revoke all on function public.toggle_save_post(uuid,uuid) from public,anon;
grant execute on function public.toggle_save_post(uuid,uuid) to authenticated;
revoke all on function public.create_comment(uuid,uuid,text) from public,anon;
grant execute on function public.create_comment(uuid,uuid,text) to authenticated;
revoke all on function public.mark_story_seen(uuid,uuid) from public,anon;
grant execute on function public.mark_story_seen(uuid,uuid) to authenticated;
revoke all on function public.set_event_attendance(uuid,uuid,text) from public,anon;
grant execute on function public.set_event_attendance(uuid,uuid,text) to authenticated;
revoke all on function public.report_content(uuid,text,uuid,text,text) from public,anon;
grant execute on function public.report_content(uuid,text,uuid,text,text) to authenticated;
revoke all on function public.pass_pet(uuid,uuid) from public,anon;
grant execute on function public.pass_pet(uuid,uuid) to authenticated;
revoke all on function public.toggle_favorite_pet(uuid,uuid) from public,anon;
grant execute on function public.toggle_favorite_pet(uuid,uuid) to authenticated;

-- Treat a safety block as owner-to-owner, so another pet under the same account cannot bypass it.
create or replace function public.is_blocked(p_pet_a uuid,p_pet_b uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.pets a
    join public.pets b on b.id=p_pet_b
    join public.pets ba on ba.owner_id=a.owner_id
    join public.pets bb on bb.owner_id=b.owner_id
    join public.blocks x on (x.blocker_pet_id=ba.id and x.blocked_pet_id=bb.id) or (x.blocker_pet_id=bb.id and x.blocked_pet_id=ba.id)
    where a.id=p_pet_a
  );
$$;
revoke all on function public.is_blocked(uuid,uuid) from public,anon,authenticated;

create or replace function public.unblock_pet(p_blocker_pet_id uuid,p_blocked_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_blocker_owner uuid; v_blocked_owner uuid;
begin
  if not public.owns_pet(p_blocker_pet_id) then raise exception 'forbidden'; end if;
  select owner_id into v_blocker_owner from public.pets where id=p_blocker_pet_id;
  select owner_id into v_blocked_owner from public.pets where id=p_blocked_pet_id;
  if v_blocked_owner is null then raise exception 'not_found'; end if;
  perform public.rate_limit('unblock_pet',60,3600);
  delete from public.blocks x
  using public.pets a,public.pets b
  where x.blocker_pet_id=a.id and x.blocked_pet_id=b.id and a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_blocker_pet_id,'pet_unblocked','pet',p_blocked_pet_id);
end $$;

-- Approved media remains private from an account that is blocked by the media owner.
create or replace function public.can_read_storage_object(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when p_bucket='pet-photos' then exists(
      select 1 from public.pet_photos ph join public.pets p on p.id=ph.pet_id
      where ph.storage_path=p_name and (p.owner_id=auth.uid() or (ph.moderation_status='approved' and not exists(select 1 from public.pets mine where mine.owner_id=auth.uid() and public.is_blocked(mine.id,p.id))))
    )
    when p_bucket='health-documents' then exists(select 1 from public.health_documents h join public.pets p on p.id=h.pet_id where h.storage_path=p_name and p.owner_id=auth.uid())
    when p_bucket='pet-verification' then exists(select 1 from public.pet_verification_requests r where r.storage_path=p_name and r.owner_id=auth.uid())
    when p_bucket='social-media' then exists(
      select 1 from public.post_media pm join public.posts po on po.id=pm.post_id join public.pets p on p.id=po.pet_id
      where pm.storage_path=p_name and (p.owner_id=auth.uid() or (pm.moderation_status='approved' and not exists(select 1 from public.pets mine where mine.owner_id=auth.uid() and public.is_blocked(mine.id,p.id))))
    ) or exists(
      select 1 from public.stories s join public.pets p on p.id=s.pet_id
      where s.storage_path=p_name and (p.owner_id=auth.uid() or (s.moderation_status='approved' and s.expires_at>now() and not exists(select 1 from public.pets mine where mine.owner_id=auth.uid() and public.is_blocked(mine.id,p.id))))
    )
    else false end;
$$;

revoke all on function public.unblock_pet(uuid,uuid) from public,anon;
grant execute on function public.unblock_pet(uuid,uuid) to authenticated;
revoke all on function public.can_read_storage_object(text,text) from public,anon;
grant execute on function public.can_read_storage_object(text,text) to authenticated;

-- Blocking severs active social relationships and meetup plans across both owners' pets.
create or replace function public.block_pet(p_blocker_pet_id uuid,p_blocked_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_blocker_owner uuid; v_blocked_owner uuid;
begin
  if not public.owns_pet(p_blocker_pet_id) or p_blocker_pet_id=p_blocked_pet_id then raise exception 'forbidden'; end if;
  select owner_id into v_blocker_owner from public.pets where id=p_blocker_pet_id;
  select owner_id into v_blocked_owner from public.pets where id=p_blocked_pet_id;
  if v_blocked_owner is null or v_blocked_owner=v_blocker_owner then raise exception 'forbidden'; end if;
  perform public.rate_limit('block_pet',60,3600);
  insert into public.blocks(blocker_pet_id,blocked_pet_id) values(p_blocker_pet_id,p_blocked_pet_id) on conflict do nothing;

  with affected_matches as (
    select m.id
    from public.pet_matches m
    join public.pets a on a.id=m.pet_low_id
    join public.pets b on b.id=m.pet_high_id
    where m.unmatched_at is null and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner))
  )
  update public.meetup_requests r set status='cancelled'
  where r.match_id in(select id from affected_matches) and r.status in('pending','accepted');

  update public.pet_matches m set unmatched_at=now(),unmatched_by_pet_id=p_blocker_pet_id
  from public.pets a,public.pets b
  where m.unmatched_at is null and a.id=m.pet_low_id and b.id=m.pet_high_id
    and ((a.owner_id=v_blocker_owner and b.owner_id=v_blocked_owner) or (a.owner_id=v_blocked_owner and b.owner_id=v_blocker_owner));

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

create or replace function public.get_meetup_requests(p_pet_id uuid,p_match_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'matchId',r.match_id,'proposedByPetId',r.proposed_by_pet_id,'startsAt',r.starts_at,
    'publicPlaceLabel',r.public_place_label,'note',r.note,'status',r.status,'createdAt',r.created_at
  ) order by r.created_at desc),'[]'::jsonb) else null end
  from public.meetup_requests r join public.pet_matches m on m.id=r.match_id
  where m.unmatched_at is null
    and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and (m.pet_low_id=p_pet_id or m.pet_high_id=p_pet_id)
    and (p_match_id is null or r.match_id=p_match_id);
$$;

revoke all on function public.block_pet(uuid,uuid) from public,anon;
grant execute on function public.block_pet(uuid,uuid) to authenticated;
revoke all on function public.get_meetup_requests(uuid,uuid) from public,anon;
grant execute on function public.get_meetup_requests(uuid,uuid) to authenticated;

-- Consume an upload intent atomically. The consumed/cancelled/expiry predicates are part of
-- the UPDATE itself so concurrent attach requests cannot consume the same intent twice.
create or replace function public.consume_upload_intent(p_pet_id uuid,p_bucket text,p_purpose text,p_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  update public.upload_intents
  set consumed_at=now()
  where user_id=auth.uid()
    and pet_id=p_pet_id
    and bucket=p_bucket
    and purpose=p_purpose
    and storage_path=p_path
    and consumed_at is null
    and cancelled_at is null
    and expires_at>now()
  returning id into v_id;
  if v_id is null then raise exception 'valid_upload_intent_required'; end if;
  return v_id;
end $$;
revoke all on function public.consume_upload_intent(uuid,text,text,text) from public,anon,authenticated;

-- Durable cleanup queue for third-party identity erasure. It deliberately has no FK to
-- auth.users so the retry record survives the local hard delete until the provider accepts it.
create table if not exists public.external_deletion_queue (
  provider text not null check(provider in ('revenuecat')),
  external_user_id text not null,
  queued_at timestamptz not null default now(),
  not_before timestamptz not null default now(),
  attempts integer not null default 0 check(attempts>=0),
  last_error text,
  primary key(provider,external_user_id)
);
alter table public.external_deletion_queue enable row level security;
revoke all on public.external_deletion_queue from anon,authenticated;
create index if not exists external_deletion_queue_due_idx on public.external_deletion_queue(not_before,attempts);

-- Read receipts are interaction writes. Do not permit them after unmatch/block through a stale conversation UUID.
create or replace function public.mark_conversation_read(p_conversation_id uuid,p_viewer_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_match public.pet_matches;
begin
  if not public.owns_pet(p_viewer_pet_id) then raise exception 'forbidden'; end if;
  select m.* into v_match
  from public.conversations c join public.pet_matches m on m.id=c.match_id
  where c.id=p_conversation_id and m.unmatched_at is null
    and p_viewer_pet_id in(m.pet_low_id,m.pet_high_id)
    and not public.is_blocked(m.pet_low_id,m.pet_high_id);
  if v_match.id is null then raise exception 'active_match_required'; end if;
  update public.messages
  set read_at=coalesce(read_at,now())
  where conversation_id=p_conversation_id and sender_pet_id<>p_viewer_pet_id and read_at is null;
end $$;
revoke all on function public.mark_conversation_read(uuid,uuid) from public,anon;
grant execute on function public.mark_conversation_read(uuid,uuid) to authenticated;

-- Blocking applies to historical social visibility too: known post IDs must not reveal blocked authors/comments.
create or replace function public.get_post_comments(p_pet_id uuid,p_post_id uuid,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'postId',c.post_id,'pet',public.pet_json(c.pet_id,p_pet_id),'body',c.body,'createdAt',c.created_at
  ) order by c.created_at asc),'[]'::jsonb) else null end
  from (
    select c.*
    from public.comments c
    join public.posts po on po.id=c.post_id
    join public.pets comment_pet on comment_pet.id=c.pet_id
    join public.users comment_user on comment_user.id=comment_pet.owner_id
    join public.pets post_pet on post_pet.id=po.pet_id
    join public.users post_user on post_user.id=post_pet.owner_id
    where c.post_id=p_post_id
      and comment_user.suspended_at is null and comment_user.paused_at is null
      and post_user.suspended_at is null and post_user.paused_at is null
      and c.deleted_at is null
      and c.moderation_status='approved'
      and po.deleted_at is null
      and po.moderation_status='approved'
      and not public.is_blocked(p_pet_id,po.pet_id)
      and not public.is_blocked(p_pet_id,c.pet_id)
    order by c.created_at asc
    limit least(greatest(p_limit,1),200)
  ) c;
$$;
revoke all on function public.get_post_comments(uuid,uuid,integer) from public,anon;
grant execute on function public.get_post_comments(uuid,uuid,integer) to authenticated;

-- Undo must not resurrect a relationship with a currently blocked account.
create or replace function public.undo_last_pass(p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_target uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.users where id=auth.uid() and tier='premium') then raise exception 'premium_required'; end if;
  select to_pet_id into v_target from public.pet_passes where from_pet_id=p_pet_id order by created_at desc limit 1;
  if v_target is null or public.is_blocked(p_pet_id,v_target) then return jsonb_build_object('restored',false); end if;
  if not exists(
    select 1 from public.pets target
    join public.users target_user on target_user.id=target.owner_id
    where target.id=v_target and target_user.suspended_at is null and target_user.paused_at is null
  ) then return jsonb_build_object('restored',false); end if;
  delete from public.pet_passes where from_pet_id=p_pet_id and to_pet_id=v_target;
  return jsonb_build_object('restored',true,'petId',v_target);
end $$;
revoke all on function public.undo_last_pass(uuid) from public,anon;
grant execute on function public.undo_last_pass(uuid) to authenticated;

