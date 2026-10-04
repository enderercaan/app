-- Tailmance v19 R8 ultra-deep audit: exact retry receipts for destructive user-owned deletion.
-- UUID-targeted deletion is a one-time intent. If the database committed but the transport response
-- was lost, the same client operation id returns success instead of reporting a false failure.

create or replace function public.delete_owned_content_idempotent(
  p_pet_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_client_operation_id text
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_type text:=trim(coalesce(p_target_type,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
begin
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('petId',p_pet_id,'targetType',v_type,'targetId',p_target_id));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':delete_content:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts
    where user_id=auth.uid() and action='delete_content' and operation_id=v_op;
  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return;
  end if;
  perform public.delete_owned_content(p_pet_id,v_type,p_target_id);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'delete_content',v_op,v_hash,jsonb_build_object('deleted',true));
end $$;

create or replace function public.delete_pet_profile_idempotent(
  p_pet_id uuid,
  p_client_operation_id text
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
begin
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('petId',p_pet_id));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':delete_pet:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts
    where user_id=auth.uid() and action='delete_pet' and operation_id=v_op;
  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return;
  end if;
  perform public.delete_pet_profile(p_pet_id);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'delete_pet',v_op,v_hash,jsonb_build_object('deleted',true));
end $$;

revoke all on function public.delete_owned_content(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.delete_pet_profile(uuid) from public,anon,authenticated;
revoke all on function public.delete_owned_content_idempotent(uuid,text,uuid,text) from public,anon;
revoke all on function public.delete_pet_profile_idempotent(uuid,text) from public,anon;
grant execute on function public.delete_owned_content_idempotent(uuid,text,uuid,text) to authenticated;
grant execute on function public.delete_pet_profile_idempotent(uuid,text) to authenticated;
