-- Tailmance v19 R8 — interactive Story replies without bypassing chat safety/quotas.
-- A Story reply is an ordinary moderated message carrying a nullable Story context link.
-- The existing send_message path remains authoritative for quota, block, active-match,
-- recipient-availability, rate-limit and moderation behavior.

alter table public.messages
  add column if not exists reply_to_story_id uuid references public.stories(id) on delete set null;

create index if not exists messages_reply_to_story_idx
  on public.messages(reply_to_story_id)
  where reply_to_story_id is not null;

create or replace function public.send_story_reply_idempotent(
  p_conversation_id uuid,
  p_sender_pet_id uuid,
  p_story_id uuid,
  p_body text,
  p_client_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_operation text:=trim(coalesce(p_client_operation_id,''));
  v_body text:=trim(coalesce(p_body,''));
  v_existing public.messages%rowtype;
  v_story_pet_id uuid;
  v_result jsonb;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_sender_pet_id) then raise exception 'forbidden'; end if;
  if v_operation !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception 'invalid_message'; end if;

  -- Serialize with ordinary message idempotency for the same sender/operation id.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_sender_pet_id::text||':'||v_operation,0)
  );

  select * into v_existing
  from public.messages
  where sender_pet_id=p_sender_pet_id and client_operation_id=v_operation
  limit 1;

  if v_existing.id is not null then
    if v_existing.conversation_id<>p_conversation_id
       or v_existing.body<>v_body
       or v_existing.reply_to_story_id is distinct from p_story_id then
      raise exception 'client_operation_id_reused';
    end if;
    return jsonb_build_object(
      'id',v_existing.id,
      'conversationId',v_existing.conversation_id,
      'senderPetId',v_existing.sender_pet_id,
      'body',v_existing.body,
      'createdAt',v_existing.created_at,
      'readAt',v_existing.read_at,
      'moderationStatus',v_existing.moderation_status,
      'replyToStoryId',v_existing.reply_to_story_id
    );
  end if;

  select s.pet_id into v_story_pet_id
  from public.stories s
  where s.id=p_story_id
    and s.moderation_status='approved'
    and s.expires_at>now();
  if v_story_pet_id is null then raise exception 'story_reply_unavailable'; end if;
  if v_story_pet_id=p_sender_pet_id then raise exception 'cannot_reply_to_own_story'; end if;

  if not exists(
    select 1
    from public.conversations c
    join public.pet_matches m on m.id=c.match_id
    where c.id=p_conversation_id
      and m.unmatched_at is null
      and m.pet_low_id=least(p_sender_pet_id,v_story_pet_id)
      and m.pet_high_id=greatest(p_sender_pet_id,v_story_pet_id)
      and not public.is_blocked(p_sender_pet_id,v_story_pet_id)
  ) then raise exception 'active_story_match_required'; end if;

  -- This call owns all chat entitlement/quota/rate-limit/moderation decisions.
  v_result:=public.send_message_idempotent(p_conversation_id,p_sender_pet_id,v_body,v_operation);

  update public.messages
  set reply_to_story_id=p_story_id
  where id=(v_result->>'id')::uuid
    and sender_pet_id=p_sender_pet_id
    and conversation_id=p_conversation_id
    and reply_to_story_id is null;

  if not found then raise exception 'story_reply_context_bind_failed'; end if;
  return v_result || jsonb_build_object('replyToStoryId',p_story_id);
end $$;

revoke all on function public.send_story_reply_idempotent(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.send_story_reply_idempotent(uuid,uuid,uuid,text,text) to authenticated;

create or replace function public.get_conversation_messages_page(
  p_conversation_id uuid,
  p_limit integer default 40,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,
    'conversationId',x.conversation_id,
    'senderPetId',x.sender_pet_id,
    'body',x.body,
    'createdAt',x.created_at,
    'readAt',x.read_at,
    'moderationStatus',x.moderation_status,
    'replyToStoryId',x.reply_to_story_id
  ) order by x.created_at,x.id),'[]'::jsonb)
  from (
    select msg.*
    from public.messages msg
    join public.conversations c on c.id=msg.conversation_id
    join public.pet_matches m on m.id=c.match_id
    where public.current_user_has_product_access()
      and msg.conversation_id=p_conversation_id
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id))
      and (msg.moderation_status='approved' or exists(select 1 from public.pets sp where sp.id=msg.sender_pet_id and sp.owner_id=auth.uid()))
      and (p_before_created_at is null or (msg.created_at,msg.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by msg.created_at desc,msg.id desc
    limit least(greatest(p_limit,1),100)
  ) x;
$$;
revoke all on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) to authenticated;
