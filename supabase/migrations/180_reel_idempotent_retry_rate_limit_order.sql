-- Tailmance v19 R8 — Reel response-loss retries must remain truly idempotent.
-- A replay of an already committed client operation is a read of the original receipt,
-- not a new create attempt, so it must not consume the daily Reel creation rate limit.

create or replace function public.create_reel_idempotent(
  p_pet_id uuid,
  p_caption text,
  p_storage_path text,
  p_duration_ms integer,
  p_client_operation_id text
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_caption text:=trim(coalesce(p_caption,''));
  v_path text:=trim(coalesce(p_storage_path,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_post uuid;
  v_media uuid;
  v_mime text;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  if char_length(v_caption)>2200 then raise exception 'caption_too_long'; end if;
  if v_path='' then raise exception 'invalid_media_path'; end if;
  if p_duration_ms not between 1000 and 60000 then raise exception 'invalid_reel_duration'; end if;

  v_hash:=public.client_mutation_hash(jsonb_build_object(
    'petId',p_pet_id,'caption',v_caption,'storagePath',v_path,'durationMs',p_duration_ms
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text||':create_reel:'||v_op,0)
  );

  select * into v_receipt
  from public.client_mutation_receipts
  where user_id=auth.uid() and action='create_reel' and operation_id=v_op;

  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return (v_receipt.result->>'id')::uuid;
  end if;

  -- Only a genuinely new create consumes the creation budget. Response-loss retries
  -- that reached the durable receipt above remain side-effect and quota idempotent.
  perform public.rate_limit('create_reel',12,86400);

  select mime_type into v_mime
  from public.upload_intents
  where user_id=auth.uid() and pet_id=p_pet_id and bucket='social-media' and purpose='reel_media'
    and storage_path=v_path and consumed_at is null and cancelled_at is null and expires_at>now()
  order by created_at desc limit 1;
  if v_mime not in ('video/mp4','video/quicktime') then raise exception 'valid_reel_upload_required'; end if;

  perform public.consume_upload_intent(p_pet_id,'social-media','reel_media',v_path);
  insert into public.posts(pet_id,caption,content_type,moderation_status)
    values(p_pet_id,v_caption,'reel','pending') returning id into v_post;
  insert into public.post_media(post_id,storage_path,sort_order,moderation_status,media_kind,mime_type,duration_ms)
    values(v_post,v_path,1,'pending','video',v_mime,p_duration_ms) returning id into v_media;
  insert into public.moderation_items(target_type,target_id,status)
    values('post_media',v_media,'pending') on conflict do nothing;
  insert into public.moderation_items(target_type,target_id,status)
    values('post_text',v_post,'pending') on conflict do nothing;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),p_pet_id,'reel_created','post',v_post,jsonb_build_object('durationMs',p_duration_ms));
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
    values(auth.uid(),'create_reel',v_op,v_hash,jsonb_build_object('id',v_post));
  return v_post;
end $$;

revoke all on function public.create_reel_idempotent(uuid,text,text,integer,text) from public,anon;
grant execute on function public.create_reel_idempotent(uuid,text,text,integer,text) to authenticated;
