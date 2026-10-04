-- Tailmance v19 R8 ultra-deep audit: retry-safe post/story creation.
-- A client operation id is bound to the exact normalized request and the first committed result.
-- This prevents ambiguous network failures from creating duplicate social content or consuming
-- the same upload intent twice on a retry.

create or replace function public.create_post_idempotent(
  p_pet_id uuid,
  p_caption text,
  p_media_paths text[],
  p_client_operation_id text
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_caption text:=trim(coalesce(p_caption,''));
  v_paths text[]:=coalesce(p_media_paths,'{}'::text[]);
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;

  v_hash:=public.client_mutation_hash(jsonb_build_object(
    'petId',p_pet_id,
    'caption',v_caption,
    'mediaPaths',to_jsonb(v_paths)
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text||':create_post:'||v_op,0)
  );

  select * into v_receipt
  from public.client_mutation_receipts
  where user_id=auth.uid() and action='create_post' and operation_id=v_op;

  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return (v_receipt.result->>'id')::uuid;
  end if;

  v_id:=public.create_post(p_pet_id,v_caption,v_paths);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'create_post',v_op,v_hash,jsonb_build_object('id',v_id));
  return v_id;
end $$;

create or replace function public.create_story_idempotent(
  p_pet_id uuid,
  p_storage_path text,
  p_client_operation_id text
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_path text:=coalesce(p_storage_path,'');
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;

  v_hash:=public.client_mutation_hash(jsonb_build_object(
    'petId',p_pet_id,
    'storagePath',v_path
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text||':create_story:'||v_op,0)
  );

  select * into v_receipt
  from public.client_mutation_receipts
  where user_id=auth.uid() and action='create_story' and operation_id=v_op;

  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return (v_receipt.result->>'id')::uuid;
  end if;

  v_id:=public.create_story(p_pet_id,v_path);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'create_story',v_op,v_hash,jsonb_build_object('id',v_id));
  return v_id;
end $$;

-- Only the retry-safe public surface is callable by a normal signed-in client.
revoke all on function public.create_post(uuid,text,text[]) from public,anon,authenticated;
revoke all on function public.create_story(uuid,text) from public,anon,authenticated;
revoke all on function public.create_post_idempotent(uuid,text,text[],text) from public,anon;
revoke all on function public.create_story_idempotent(uuid,text,text) from public,anon;
grant execute on function public.create_post_idempotent(uuid,text,text[],text) to authenticated;
grant execute on function public.create_story_idempotent(uuid,text,text) to authenticated;
