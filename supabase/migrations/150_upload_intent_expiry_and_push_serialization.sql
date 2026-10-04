-- Tailmance v19 R8: serialize globally-unique push token ownership and ensure
-- expired/unconsumed upload intents cannot accumulate forever or poison a durable retry.

create or replace function public.register_push_token(p_token text,p_platform text,p_active_pet_id uuid default null)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_token text:=trim(coalesce(p_token,''));
  v_existing public.push_tokens%rowtype;
begin
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if p_platform not in ('ios','android') then raise exception 'invalid_platform'; end if;
  if length(v_token)<20 or length(v_token)>512 then raise exception 'invalid_push_token'; end if;
  if p_active_pet_id is not null and not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;

  -- Lock by token even when the row does not exist yet. A row lock alone leaves a
  -- first-insert race where two accounts can both observe "missing" and the loser can
  -- hit ON CONFLICT after the winner commits.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('push-token:'||v_token,0)
  );

  select * into v_existing
  from public.push_tokens
  where token=v_token
  for update;

  if v_existing.id is not null
     and v_existing.user_id<>auth.uid()
     and v_existing.enabled then
    raise exception 'push_token_in_use';
  end if;

  if v_existing.id is not null
     and v_existing.user_id=auth.uid()
     and v_existing.platform=p_platform
     and v_existing.active_pet_id is not distinct from p_active_pet_id
     and v_existing.enabled then
    if v_existing.last_seen_at<now()-interval '6 hours' then
      update public.push_tokens set last_seen_at=now() where id=v_existing.id;
    end if;
    return;
  end if;

  perform public.rate_limit('push_token_register',40,86400);

  insert into public.push_tokens(user_id,token,platform,active_pet_id,enabled)
  values(auth.uid(),v_token,p_platform,p_active_pet_id,true)
  on conflict(token) do update set
    user_id=auth.uid(),
    platform=excluded.platform,
    active_pet_id=excluded.active_pet_id,
    enabled=true,
    last_seen_at=now();

  update public.push_tokens
  set enabled=false
  where user_id=auth.uid() and enabled
    and id not in (
      select id from public.push_tokens
      where user_id=auth.uid() and enabled
      order by last_seen_at desc,id desc
      limit 10
    );
end;
$$;
revoke all on function public.register_push_token(text,text,uuid) from public,anon;
grant execute on function public.register_push_token(text,text,uuid) to authenticated;

create or replace function public.create_upload_intent_idempotent(
  p_pet_id uuid,
  p_bucket text,
  p_purpose text,
  p_mime_type text,
  p_extension text,
  p_client_operation_id text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_intent public.upload_intents%rowtype;
  v_result jsonb;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;

  v_hash:=public.client_mutation_hash(jsonb_build_object(
    'petId',p_pet_id,
    'bucket',p_bucket,
    'purpose',p_purpose,
    'mimeType',lower(trim(coalesce(p_mime_type,''))),
    'extension',lower(trim(coalesce(p_extension,'')))
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text||':upload_intent:'||v_op,0)
  );

  select * into v_receipt
  from public.client_mutation_receipts
  where user_id=auth.uid() and action='upload_intent' and operation_id=v_op;

  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    select * into v_intent
    from public.upload_intents
    where id=nullif(v_receipt.result->>'id','')::uuid and user_id=auth.uid()
    for update;

    -- Same committed allocation is still usable, or the same logical operation has
    -- already been consumed successfully. Preserve the original response contract.
    if v_intent.id is not null and
       (v_intent.consumed_at is not null or
        (v_intent.cancelled_at is null and v_intent.expires_at>now())) then
      return v_receipt.result;
    end if;

    -- A cancelled/expired/missing unconsumed allocation is no longer a valid replay
    -- result. Retire only this receipt so the same durable client operation can safely
    -- receive a fresh transient allocation without duplicating a durable product action.
    delete from public.client_mutation_receipts
    where user_id=auth.uid() and action='upload_intent' and operation_id=v_op;
  end if;

  -- Opportunistically bound this user's abandoned intents. Queue any possible object
  -- for deletion before removing the authorization row; expired intents can no longer
  -- authorize a Storage write.
  insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
  select i.bucket,i.storage_path,now(),now(),0,null
  from public.upload_intents i
  where i.user_id=auth.uid()
    and i.consumed_at is null
    and i.cancelled_at is null
    and i.expires_at<=now()
  on conflict(bucket,storage_path) do update set
    queued_at=excluded.queued_at,
    not_before=least(public.storage_gc_queue.not_before,excluded.not_before),
    attempts=0,
    last_error=null;

  delete from public.upload_intents
  where user_id=auth.uid()
    and consumed_at is null
    and cancelled_at is null
    and expires_at<=now();

  v_result:=public.create_upload_intent(
    p_pet_id,
    p_bucket,
    p_purpose,
    lower(trim(coalesce(p_mime_type,''))),
    lower(trim(coalesce(p_extension,'')))
  );

  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'upload_intent',v_op,v_hash,v_result);

  return v_result;
end;
$$;
revoke all on function public.create_upload_intent_idempotent(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.create_upload_intent_idempotent(uuid,text,text,text,text,text) to authenticated;

-- Preserve the existing operational purge API while extending it to expired,
-- never-consumed upload intents. Queue possible orphaned objects before row deletion.
create or replace function public.purge_operational_records(
  p_rate_limits_before timestamptz,
  p_push_receipts_before timestamptz,
  p_client_errors_before timestamptz,
  p_upload_intents_before timestamptz,
  p_export_tokens_before timestamptz
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_rate_limits integer:=0;
  v_push_receipts integer:=0;
  v_client_errors integer:=0;
  v_upload_intents integer:=0;
  v_export_tokens integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_rate_limits_before is null or p_rate_limits_before>now()
     or p_push_receipts_before is null or p_push_receipts_before>now()
     or p_client_errors_before is null or p_client_errors_before>now()
     or p_upload_intents_before is null or p_upload_intents_before>now()
     or p_export_tokens_before is null or p_export_tokens_before>now() then
    raise exception 'invalid_cutoff';
  end if;

  delete from public.rate_limits
  where window_start<p_rate_limits_before
    and window_start<now()-interval '24 hours';
  get diagnostics v_rate_limits=row_count;

  delete from public.push_receipts pr
  using public.notifications n
  where pr.notification_id=n.id
    and pr.created_at<p_push_receipts_before
    and n.push_status in ('sent','failed','skipped');
  get diagnostics v_push_receipts=row_count;

  delete from public.client_error_events where occurred_at<p_client_errors_before;
  get diagnostics v_client_errors=row_count;

  insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
  select i.bucket,i.storage_path,now(),now(),0,null
  from public.upload_intents i
  where i.consumed_at is null
    and i.cancelled_at is null
    and i.expires_at<p_upload_intents_before
  on conflict(bucket,storage_path) do update set
    queued_at=excluded.queued_at,
    not_before=least(public.storage_gc_queue.not_before,excluded.not_before),
    attempts=0,
    last_error=null;

  delete from public.upload_intents
  where (consumed_at is not null and consumed_at<p_upload_intents_before)
     or (cancelled_at is not null and cancelled_at<p_upload_intents_before)
     or (consumed_at is null and cancelled_at is null and expires_at<p_upload_intents_before);
  get diagnostics v_upload_intents=row_count;

  delete from public.account_export_download_tokens where expires_at<p_export_tokens_before;
  get diagnostics v_export_tokens=row_count;

  return jsonb_build_object(
    'rateLimits',v_rate_limits,
    'pushReceipts',v_push_receipts,
    'clientErrors',v_client_errors,
    'uploadIntents',v_upload_intents,
    'exportTokens',v_export_tokens
  );
end;
$$;
revoke all on function public.purge_operational_records(timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.purge_operational_records(timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
