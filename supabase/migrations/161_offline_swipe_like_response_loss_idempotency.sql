-- Tailmance v19 R8: ordinary discovery likes may be durably queued while offline.
-- Wrap the existing like mutation with a client-operation receipt so a committed request
-- whose response is lost cannot duplicate rate-limit consumption or notifications on replay.

create or replace function public.like_pet_idempotent(
  p_from_pet_id uuid,
  p_to_pet_id uuid,
  p_kind public.like_kind,
  p_client_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_result jsonb;
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id then raise exception 'forbidden'; end if;
  if p_kind not in ('like','super_like') then raise exception 'invalid_like_kind'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;

  v_hash:=public.client_mutation_hash(jsonb_build_object(
    'fromPetId',p_from_pet_id,
    'toPetId',p_to_pet_id,
    'kind',p_kind::text
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':like_pet:'||v_op,0));
  select * into v_receipt
  from public.client_mutation_receipts
  where user_id=auth.uid() and action='like_pet' and operation_id=v_op;

  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return coalesce(v_receipt.result,'{"matched":false}'::jsonb);
  end if;

  v_result:=public.like_pet(p_from_pet_id,p_to_pet_id,p_kind);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'like_pet',v_op,v_hash,v_result);
  return v_result;
end $$;

revoke all on function public.like_pet_idempotent(uuid,uuid,public.like_kind,text) from public,anon;
grant execute on function public.like_pet_idempotent(uuid,uuid,public.like_kind,text) to authenticated;

-- The app must use only the receipt-backed surface so retries cannot bypass idempotency.
revoke all on function public.like_pet(uuid,uuid,public.like_kind) from public,anon,authenticated;
