-- Tailmance v19 R8: close residual no-op write amplification, prevent enabled
-- push-token cross-account takeover, and make upload-intent allocation response-loss safe.

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  update public.notifications
  set read_at=now()
  where id=p_notification_id
    and user_id=auth.uid()
    and read_at is null;
end;
$$;
revoke all on function public.mark_notification_read(uuid) from public,anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

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

  -- Serialize ownership decisions for an existing globally-unique token.
  select * into v_existing
  from public.push_tokens
  where token=v_token
  for update;

  -- An enabled token belongs to its currently authenticated account until that
  -- account's logout/token-lifecycle disables it. This prevents a caller who merely
  -- knows another account's token string from stealing its notification channel.
  if v_existing.id is not null
     and v_existing.user_id<>auth.uid()
     and v_existing.enabled then
    raise exception 'push_token_in_use';
  end if;

  -- Exact repeated registration is a heartbeat, not a new mutation. Avoid burning
  -- rate-limit budget or generating MVCC churn on every app foreground. Refresh the
  -- heartbeat at most once every six hours so pruning still has a useful recency signal.
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
  v_result jsonb;
begin
  perform public.require_active_authenticated_session();
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
    return v_receipt.result;
  end if;

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

-- Client code must use the receipt-bound wrapper. Internal SECURITY DEFINER callers can
-- still call create_upload_intent inside the database if ever needed, but PostgREST clients cannot.
revoke all on function public.create_upload_intent(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.create_upload_intent_idempotent(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.create_upload_intent_idempotent(uuid,text,text,text,text,text) to authenticated;
