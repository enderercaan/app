-- Tailmance v19 R8: make message submission retry-safe across ambiguous network failures.
-- A client operation id is bound to one sender/conversation/body. Reusing the same id
-- returns the original message without consuming quota or creating a second moderation item.

alter table public.messages add column if not exists client_operation_id text;

create unique index if not exists idx_messages_sender_client_operation
  on public.messages(sender_pet_id,client_operation_id)
  where client_operation_id is not null;

create or replace function public.send_message_idempotent(
  p_conversation_id uuid,
  p_sender_pet_id uuid,
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
  v_result jsonb;
begin
  if not public.owns_pet(p_sender_pet_id) then raise exception 'forbidden'; end if;
  if v_operation !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;

  -- Serialize identical retries before quota checks/message insertion in send_message().
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_sender_pet_id::text||':'||v_operation,0)
  );

  select * into v_existing
  from public.messages
  where sender_pet_id=p_sender_pet_id and client_operation_id=v_operation
  limit 1;

  if v_existing.id is not null then
    if v_existing.conversation_id<>p_conversation_id or v_existing.body<>v_body then
      raise exception 'client_operation_id_reused';
    end if;
    return jsonb_build_object(
      'id',v_existing.id,
      'conversationId',v_existing.conversation_id,
      'senderPetId',v_existing.sender_pet_id,
      'body',v_existing.body,
      'createdAt',v_existing.created_at,
      'readAt',v_existing.read_at
    );
  end if;

  v_result:=public.send_message(p_conversation_id,p_sender_pet_id,v_body);

  update public.messages
  set client_operation_id=v_operation
  where id=(v_result->>'id')::uuid
    and sender_pet_id=p_sender_pet_id
    and conversation_id=p_conversation_id;

  if not found then raise exception 'message_idempotency_bind_failed'; end if;
  return v_result;
end $$;

revoke all on function public.send_message_idempotent(uuid,uuid,text,text) from public,anon;
grant execute on function public.send_message_idempotent(uuid,uuid,text,text) to authenticated;
