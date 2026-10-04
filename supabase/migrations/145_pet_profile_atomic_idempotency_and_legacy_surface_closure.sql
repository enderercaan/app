-- Tailmance v19 R8: make the pet profile + prompt save boundary atomic and retry-safe.
-- A committed create/update must survive an ambiguous network response without duplicating a pet,
-- re-running audit/moderation/rate-limit side effects, or leaving profile and prompts partially saved.
-- Also close the obsolete non-idempotent event-create client entry point.

create or replace function public.upsert_pet_profile_idempotent(
  p_pet_id uuid,
  p_payload jsonb,
  p_prompts jsonb,
  p_client_operation_id text
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_id uuid;
begin
  perform public.require_active_authenticated_session();
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' then raise exception 'invalid_pet_payload'; end if;
  if jsonb_typeof(coalesce(p_prompts,'[]'::jsonb))<>'array' then raise exception 'invalid_prompts'; end if;

  v_hash:=public.client_mutation_hash(jsonb_build_object(
    'petId',p_pet_id,
    'payload',coalesce(p_payload,'{}'::jsonb),
    'prompts',coalesce(p_prompts,'[]'::jsonb)
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text||':upsert_pet_profile:'||v_op,0)
  );

  select * into v_receipt
  from public.client_mutation_receipts
  where user_id=auth.uid() and action='upsert_pet_profile' and operation_id=v_op;

  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return (v_receipt.result->>'id')::uuid;
  end if;

  -- Both calls execute in this same transaction. Any prompt failure rolls back the profile write,
  -- moderation/audit/rate-limit side effects, and the receipt together.
  v_id:=public.upsert_pet_profile(p_pet_id,coalesce(p_payload,'{}'::jsonb));
  perform public.upsert_pet_prompts(v_id,coalesce(p_prompts,'[]'::jsonb));

  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'upsert_pet_profile',v_op,v_hash,jsonb_build_object('id',v_id));

  return v_id;
end $$;

revoke all on function public.upsert_pet_profile_idempotent(uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.upsert_pet_profile_idempotent(uuid,jsonb,jsonb,text) to authenticated;

-- Raw profile/prompt mutation entry points remain callable by trusted SECURITY DEFINER wrappers,
-- but clients may only use the atomic idempotent boundary above.
revoke all on function public.upsert_pet_profile(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.upsert_pet_prompts(uuid,jsonb) from public,anon,authenticated;

-- Current clients use create_community_event_idempotent. The compatibility create_pet_event
-- wrapper is response-loss unsafe and has no current source caller, so close its client surface.
revoke all on function public.create_pet_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer)
  from public,anon,authenticated;
