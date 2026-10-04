-- Tailmance TUR 2: server-side chat moderation.
-- Existing messages predate this gate and are preserved as approved. New messages are pending;
-- recipients cannot read/count/preview them until moderation approves them.

alter table public.messages add column if not exists moderation_status public.moderation_state;
update public.messages set moderation_status='approved' where moderation_status is null;
alter table public.messages alter column moderation_status set default 'pending';
alter table public.messages alter column moderation_status set not null;
create index if not exists idx_messages_approved_conversation_created
  on public.messages(conversation_id,created_at desc,id desc) where moderation_status='approved';
create index if not exists idx_messages_approved_unread
  on public.messages(conversation_id,sender_pet_id) where read_at is null and moderation_status='approved';

alter table public.moderation_items drop constraint if exists moderation_items_target_type_check;
alter table public.moderation_items add constraint moderation_items_target_type_check
  check (target_type in ('pet_photo','post_media','story','pet_text','post_text','comment_text','message_text','event_text','meetup_text','health_document')) not valid;
alter table public.moderation_items validate constraint moderation_items_target_type_check;

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
      and (
        messages.moderation_status='approved'
        or exists(select 1 from public.pets sender where sender.id=messages.sender_pet_id and sender.owner_id=auth.uid())
      )
  )
);

create or replace function public.send_message(p_conversation_id uuid,p_sender_pet_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_match public.pet_matches;
  v_uid uuid:=auth.uid();
  v_msg public.messages;
  v_other_pet uuid;
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

  insert into public.messages(conversation_id,sender_pet_id,body,moderation_status)
  values(p_conversation_id,p_sender_pet_id,v_body,'pending') returning * into v_msg;
  insert into public.moderation_items(target_type,target_id,status)
  values('message_text',v_msg.id,'pending') on conflict(target_type,target_id) do update
    set status='pending',reason=null,reviewed_at=null,provider=null,score=null,next_attempt_at=now(),manual_review_required=false;

  return jsonb_build_object(
    'id',v_msg.id,'conversationId',v_msg.conversation_id,'senderPetId',v_msg.sender_pet_id,
    'body',v_msg.body,'createdAt',v_msg.created_at,'readAt',v_msg.read_at,'moderationStatus',v_msg.moderation_status
  );
end $$;
revoke all on function public.send_message(uuid,uuid,text) from public,anon;
grant execute on function public.send_message(uuid,uuid,text) to authenticated;

create or replace function public.finalize_message_moderation(
  p_item_id uuid,
  p_status text,
  p_provider text default null,
  p_reason text default null,
  p_score jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare
  v_item public.moderation_items%rowtype;
  v_msg public.messages%rowtype;
  v_match public.pet_matches%rowtype;
  v_sender_owner uuid;
  v_recipient_pet uuid;
  v_recipient_owner uuid;
  v_sender_paused timestamptz;
  v_sender_suspended timestamptz;
  v_recipient_paused timestamptz;
  v_recipient_suspended timestamptz;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('approved','rejected') then raise exception 'invalid_moderation_status'; end if;
  if p_reason is not null and char_length(p_reason)>500 then raise exception 'reason_too_long'; end if;
  if jsonb_typeof(coalesce(p_score,'{}'::jsonb))<>'object' or pg_column_size(coalesce(p_score,'{}'::jsonb))>8192 then raise exception 'invalid_score'; end if;

  select * into v_item from public.moderation_items where id=p_item_id for update;
  if v_item.id is null or v_item.target_type<>'message_text' then raise exception 'moderation_item_not_found'; end if;
  if v_item.status in ('approved','rejected') then return v_item.status=p_status; end if;

  select * into v_msg from public.messages where id=v_item.target_id for update;
  if v_msg.id is null then
    delete from public.moderation_items where id=v_item.id;
    return false;
  end if;

  update public.moderation_items
  set status=p_status::public.moderation_state,
      provider=left(nullif(trim(coalesce(p_provider,'')),''),120),
      reason=left(nullif(trim(coalesce(p_reason,'')),''),500),
      score=coalesce(p_score,'{}'::jsonb),reviewed_at=now(),next_attempt_at=null
  where id=v_item.id;
  update public.messages set moderation_status=p_status::public.moderation_state where id=v_msg.id;

  if p_status='approved' then
    select m.* into v_match
    from public.conversations c join public.pet_matches m on m.id=c.match_id
    where c.id=v_msg.conversation_id
    for share of m;

    if v_match.id is not null and v_match.unmatched_at is null
       and v_msg.sender_pet_id in(v_match.pet_low_id,v_match.pet_high_id) then
      v_recipient_pet:=case when v_msg.sender_pet_id=v_match.pet_low_id then v_match.pet_high_id else v_match.pet_low_id end;
      select sp.owner_id,su.paused_at,su.suspended_at,rp.owner_id,ru.paused_at,ru.suspended_at
      into v_sender_owner,v_sender_paused,v_sender_suspended,v_recipient_owner,v_recipient_paused,v_recipient_suspended
      from public.pets sp join public.users su on su.id=sp.owner_id,
           public.pets rp join public.users ru on ru.id=rp.owner_id
      where sp.id=v_msg.sender_pet_id and rp.id=v_recipient_pet;

      if v_sender_owner is not null and v_recipient_owner is not null
         and v_sender_owner<>v_recipient_owner
         and v_sender_paused is null and v_sender_suspended is null
         and v_recipient_paused is null and v_recipient_suspended is null
         and not public.is_blocked(v_msg.sender_pet_id,v_recipient_pet) then
        insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id)
        values(v_recipient_owner,'message','New message','You have a new message from a matched pet.',v_msg.conversation_id,
               format('message:%s',v_msg.id),'message','{}'::jsonb,v_msg.sender_pet_id)
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.finalize_message_moderation(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_message_moderation(uuid,text,text,text,jsonb) to service_role;

create or replace function public.get_conversation_messages(p_conversation_id uuid,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'conversationId',x.conversation_id,'senderPetId',x.sender_pet_id,'body',x.body,
    'createdAt',x.created_at,'readAt',x.read_at,'moderationStatus',x.moderation_status
  ) order by x.created_at),'[]'::jsonb)
  from (
    select msg.*
    from public.messages msg
    join public.conversations c on c.id=msg.conversation_id
    join public.pet_matches m on m.id=c.match_id
    where msg.conversation_id=p_conversation_id
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id))
      and (msg.moderation_status='approved' or exists(select 1 from public.pets sp where sp.id=msg.sender_pet_id and sp.owner_id=auth.uid()))
    order by msg.created_at desc,msg.id desc
    limit least(greatest(p_limit,1),200)
  ) x;
$$;

create or replace function public.get_conversation_messages_page(p_conversation_id uuid,p_limit integer default 40,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'conversationId',x.conversation_id,'senderPetId',x.sender_pet_id,'body',x.body,
    'createdAt',x.created_at,'readAt',x.read_at,'moderationStatus',x.moderation_status
  ) order by x.created_at,x.id),'[]'::jsonb)
  from (
    select msg.*
    from public.messages msg
    join public.conversations c on c.id=msg.conversation_id
    join public.pet_matches m on m.id=c.match_id
    where msg.conversation_id=p_conversation_id
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id))
      and (msg.moderation_status='approved' or exists(select 1 from public.pets sp where sp.id=msg.sender_pet_id and sp.owner_id=auth.uid()))
      and (p_before_created_at is null or (msg.created_at,msg.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by msg.created_at desc,msg.id desc
    limit least(greatest(p_limit,1),100)
  ) x;
$$;

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
  where conversation_id=p_conversation_id and sender_pet_id<>p_viewer_pet_id and read_at is null and moderation_status='approved';
end $$;

create or replace function public.get_matches(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'conversationId',c.id,
    'otherPet',public.pet_json(case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end,p_pet_id),
    'matchedAt',m.matched_at,'commonPurposes',coalesce(cp.purposes,'[]'::jsonb),
    'lastMessage',lm.body,'lastMessageAt',lm.created_at,'unreadCount',coalesce(uc.unread_count,0)
  ) order by m.matched_at desc),'[]'::jsonb)
  from public.pet_matches m
  left join public.conversations c on c.match_id=m.id
  left join lateral (
    select jsonb_agg(a.purpose order by a.purpose) as purposes
    from public.pet_purposes a join public.pet_purposes b on b.purpose=a.purpose
    where a.pet_id=p_pet_id and a.purpose<>'mating' and b.pet_id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end
  ) cp on true
  left join lateral (
    select msg.body,msg.created_at from public.messages msg
    where msg.conversation_id=c.id and (msg.moderation_status='approved' or (msg.sender_pet_id=p_pet_id and msg.moderation_status='pending'))
    order by msg.created_at desc,msg.id desc limit 1
  ) lm on true
  left join lateral (
    select count(*)::bigint as unread_count from public.messages msg
    where msg.conversation_id=c.id and msg.sender_pet_id<>p_pet_id and msg.read_at is null and msg.moderation_status='approved'
  ) uc on true
  where public.owns_pet(p_pet_id)
    and m.unmatched_at is null and p_pet_id in(m.pet_low_id,m.pet_high_id)
    and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and exists(select 1 from public.pets op join public.users ou on ou.id=op.owner_id where op.id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end and ou.suspended_at is null and ou.paused_at is null);
$$;

create or replace function public.get_matches_page(
  p_pet_id uuid,p_limit integer default 30,p_before_matched_at timestamptz default null,p_before_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  with candidates as (
    select m.*,c.id as conversation_id,lm.body as last_message,lm.created_at as last_message_at,coalesce(lm.created_at,m.matched_at) as activity_at
    from public.pet_matches m join public.conversations c on c.match_id=m.id
    left join lateral (
      select msg.body,msg.created_at from public.messages msg
      where msg.conversation_id=c.id and (msg.moderation_status='approved' or (msg.sender_pet_id=p_pet_id and msg.moderation_status='pending'))
      order by msg.created_at desc,msg.id desc limit 1
    ) lm on true
    where public.owns_pet(p_pet_id) and m.unmatched_at is null and p_pet_id in(m.pet_low_id,m.pet_high_id)
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and exists(select 1 from public.pets op join public.users ou on ou.id=op.owner_id where op.id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end and ou.suspended_at is null and ou.paused_at is null)
  ), page as (
    select * from candidates where p_before_matched_at is null or (activity_at,id)<(p_before_matched_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    order by activity_at desc,id desc limit least(greatest(p_limit,1),50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'conversationId',m.conversation_id,
    'otherPet',public.pet_json(case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end,p_pet_id),
    'matchedAt',m.matched_at,'commonPurposes',coalesce(cp.purposes,'[]'::jsonb),
    'lastMessage',m.last_message,'lastMessageAt',m.last_message_at,'unreadCount',coalesce(uc.unread_count,0)
  ) order by m.activity_at desc,m.id desc),'[]'::jsonb)
  from page m
  left join lateral (
    select jsonb_agg(a.purpose order by a.purpose) as purposes from public.pet_purposes a join public.pet_purposes b on b.purpose=a.purpose
    where a.pet_id=p_pet_id and a.purpose<>'mating' and b.pet_id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end
  ) cp on true
  left join lateral (
    select count(*)::bigint as unread_count from public.messages msg
    where msg.conversation_id=m.conversation_id and msg.sender_pet_id<>p_pet_id and msg.read_at is null and msg.moderation_status='approved'
  ) uc on true;
$$;

create or replace function public.get_unread_match_message_count(p_pet_id uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select count(*)::bigint
  from public.messages msg join public.conversations c on c.id=msg.conversation_id join public.pet_matches m on m.id=c.match_id
  where public.owns_pet(p_pet_id) and m.unmatched_at is null and p_pet_id in(m.pet_low_id,m.pet_high_id)
    and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and msg.sender_pet_id<>p_pet_id and msg.read_at is null and msg.moderation_status='approved'
    and exists(select 1 from public.pets op join public.users ou on ou.id=op.owner_id where op.id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end and ou.suspended_at is null and ou.paused_at is null);
$$;

create or replace function public.get_match_by_conversation(p_pet_id uuid,p_conversation_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',m.id,'conversationId',c.id,
    'otherPet',public.pet_json(case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end,p_pet_id),
    'matchedAt',m.matched_at,'commonPurposes',coalesce(cp.purposes,'[]'::jsonb),
    'lastMessage',lm.body,'lastMessageAt',lm.created_at,'unreadCount',coalesce(uc.unread_count,0)
  )
  from public.conversations c join public.pet_matches m on m.id=c.match_id
  left join lateral (
    select jsonb_agg(a.purpose order by a.purpose) as purposes from public.pet_purposes a join public.pet_purposes b on b.purpose=a.purpose
    where a.pet_id=p_pet_id and a.purpose<>'mating' and b.pet_id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end
  ) cp on true
  left join lateral (
    select msg.body,msg.created_at from public.messages msg
    where msg.conversation_id=c.id and (msg.moderation_status='approved' or (msg.sender_pet_id=p_pet_id and msg.moderation_status='pending'))
    order by msg.created_at desc,msg.id desc limit 1
  ) lm on true
  left join lateral (
    select count(*)::bigint as unread_count from public.messages msg
    where msg.conversation_id=c.id and msg.sender_pet_id<>p_pet_id and msg.read_at is null and msg.moderation_status='approved'
  ) uc on true
  where c.id=p_conversation_id and public.owns_pet(p_pet_id) and m.unmatched_at is null
    and p_pet_id in(m.pet_low_id,m.pet_high_id) and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and exists(select 1 from public.pets op join public.users ou on ou.id=op.owner_id where op.id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end and ou.suspended_at is null and ou.paused_at is null)
  limit 1;
$$;

revoke all on function public.get_conversation_messages(uuid,integer) from public,anon;
grant execute on function public.get_conversation_messages(uuid,integer) to authenticated;
revoke all on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) to authenticated;
revoke all on function public.mark_conversation_read(uuid,uuid) from public,anon;
grant execute on function public.mark_conversation_read(uuid,uuid) to authenticated;
revoke all on function public.get_matches(uuid) from public,anon;
grant execute on function public.get_matches(uuid) to authenticated;
revoke all on function public.get_matches_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_matches_page(uuid,integer,timestamptz,uuid) to authenticated;
revoke all on function public.get_unread_match_message_count(uuid) from public,anon;
grant execute on function public.get_unread_match_message_count(uuid) to authenticated;
revoke all on function public.get_match_by_conversation(uuid,uuid) from public,anon;
grant execute on function public.get_match_by_conversation(uuid,uuid) to authenticated;
