-- Tailmance v19 R8: make consumable lifecycle state independent from webhook delivery order.
-- RevenueCat retries preserve event id + event_timestamp_ms. The provider event timestamp,
-- not HTTP arrival order, is therefore the temporal authority for purchase/refund/reversal.

alter table public.consumable_store_transaction_state
  add column if not exists last_provider_event_timestamp_ms bigint,
  add column if not exists last_provider_event_rank smallint,
  add column if not exists last_provider_event_id text;

alter table public.consumable_store_transaction_state
  drop constraint if exists consumable_store_transaction_state_event_timestamp_check,
  add constraint consumable_store_transaction_state_event_timestamp_check
    check (last_provider_event_timestamp_ms is null or last_provider_event_timestamp_ms between 946684800000 and 9999999999999),
  drop constraint if exists consumable_store_transaction_state_event_rank_check,
  add constraint consumable_store_transaction_state_event_rank_check
    check (last_provider_event_rank is null or last_provider_event_rank between 1 and 3);

create or replace function public.apply_consumable_billing_webhook_event_ordered(
  p_event_id text,p_claim_token uuid,p_user_id uuid,p_product_id text,p_credit_kind text,p_quantity integer,
  p_store_transaction_id text,p_provider_app_id text,p_provider_environment text,p_event_timestamp_ms bigint
) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state public.consumable_store_transaction_state%rowtype;
  v_applied boolean;
  v_tx text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_env text:=upper(trim(coalesce(p_provider_environment,'')));
  v_product text:=trim(coalesce(p_product_id,''));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_event_timestamp_ms is null or p_event_timestamp_ms<946684800000 then raise exception 'consumable_event_timestamp_invalid'; end if;
  if v_tx is null or v_app is null or v_env not in ('PRODUCTION','SANDBOX') then raise exception 'invalid_consumable_purchase'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_app||'|'||v_env||'|'||v_tx,1));
  select * into v_state from public.consumable_store_transaction_state
    where provider_app_id=v_app and provider_environment=v_env and store_transaction_id=v_tx for update;
  if v_state.store_transaction_id is not null then
    if v_state.user_id is distinct from p_user_id or v_state.store_product_id is distinct from v_product
       or v_state.credit_kind is distinct from p_credit_kind or v_state.quantity is distinct from p_quantity then
      raise exception 'consumable_transaction_metadata_mismatch';
    end if;
    if v_state.last_provider_event_timestamp_ms is not null and
       (p_event_timestamp_ms<v_state.last_provider_event_timestamp_ms
        or (p_event_timestamp_ms=v_state.last_provider_event_timestamp_ms and coalesce(v_state.last_provider_event_rank,0)>1)) then
      update public.billing_webhook_events set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
      where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
      if not found then raise exception 'claim_lost_during_consumable_apply'; end if;
      return true;
    end if;
    if v_state.last_provider_event_rank in (2,3) and p_event_timestamp_ms>coalesce(v_state.last_provider_event_timestamp_ms,0) then
      raise exception 'consumable_purchase_after_terminal_lifecycle_event';
    end if;
  end if;

  v_applied:=public.apply_consumable_billing_webhook_event(
    p_event_id,p_claim_token,p_user_id,v_product,p_credit_kind,p_quantity,v_tx,v_app,v_env
  );
  if v_applied is distinct from true then return v_applied; end if;
  update public.consumable_store_transaction_state set
    last_provider_event_timestamp_ms=p_event_timestamp_ms,last_provider_event_rank=1,last_provider_event_id=p_event_id,updated_at=now()
  where provider_app_id=v_app and provider_environment=v_env and store_transaction_id=v_tx;
  if not found then raise exception 'consumable_transaction_state_missing_after_apply'; end if;
  return true;
end $$;

create or replace function public.apply_consumable_refund_billing_webhook_event_ordered(
  p_event_id text,p_claim_token uuid,p_user_id uuid,p_product_id text,p_credit_kind text,p_quantity integer,
  p_store_transaction_id text,p_provider_app_id text,p_provider_environment text,p_event_timestamp_ms bigint
) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state public.consumable_store_transaction_state%rowtype;
  v_applied boolean;
  v_tx text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_env text:=upper(trim(coalesce(p_provider_environment,'')));
  v_product text:=trim(coalesce(p_product_id,''));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_event_timestamp_ms is null or p_event_timestamp_ms<946684800000 then raise exception 'consumable_event_timestamp_invalid'; end if;
  if v_tx is null or v_app is null or v_env not in ('PRODUCTION','SANDBOX') then raise exception 'invalid_consumable_refund'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_app||'|'||v_env||'|'||v_tx,1));
  select * into v_state from public.consumable_store_transaction_state
    where provider_app_id=v_app and provider_environment=v_env and store_transaction_id=v_tx for update;
  if v_state.store_transaction_id is not null then
    if v_state.user_id is distinct from p_user_id or v_state.store_product_id is distinct from v_product
       or v_state.credit_kind is distinct from p_credit_kind or v_state.quantity is distinct from p_quantity then
      raise exception 'consumable_transaction_metadata_mismatch';
    end if;
    if v_state.last_provider_event_timestamp_ms is not null and
       (p_event_timestamp_ms<v_state.last_provider_event_timestamp_ms
        or (p_event_timestamp_ms=v_state.last_provider_event_timestamp_ms and coalesce(v_state.last_provider_event_rank,0)>2)) then
      update public.billing_webhook_events set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
      where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
      if not found then raise exception 'claim_lost_during_consumable_refund'; end if;
      return true;
    end if;
  end if;

  v_applied:=public.apply_consumable_refund_billing_webhook_event(
    p_event_id,p_claim_token,p_user_id,v_product,p_credit_kind,p_quantity,v_tx,v_app,v_env
  );
  if v_applied is distinct from true then return v_applied; end if;
  update public.consumable_store_transaction_state set
    last_provider_event_timestamp_ms=p_event_timestamp_ms,last_provider_event_rank=2,last_provider_event_id=p_event_id,updated_at=now()
  where provider_app_id=v_app and provider_environment=v_env and store_transaction_id=v_tx;
  if not found then raise exception 'consumable_transaction_state_missing_after_refund'; end if;
  return true;
end $$;

create or replace function public.apply_consumable_refund_reversal_billing_webhook_event_ordered(
  p_event_id text,p_claim_token uuid,p_user_id uuid,p_product_id text,p_credit_kind text,p_quantity integer,
  p_store_transaction_id text,p_provider_app_id text,p_provider_environment text,p_event_timestamp_ms bigint
) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state public.consumable_store_transaction_state%rowtype;
  v_applied boolean;
  v_tx text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_env text:=upper(trim(coalesce(p_provider_environment,'')));
  v_product text:=trim(coalesce(p_product_id,''));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_event_timestamp_ms is null or p_event_timestamp_ms<946684800000 then raise exception 'consumable_event_timestamp_invalid'; end if;
  if v_tx is null or v_app is null or v_env not in ('PRODUCTION','SANDBOX') then raise exception 'invalid_consumable_refund_reversal'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_app||'|'||v_env||'|'||v_tx,1));
  select * into v_state from public.consumable_store_transaction_state
    where provider_app_id=v_app and provider_environment=v_env and store_transaction_id=v_tx for update;
  if v_state.store_transaction_id is not null then
    if v_state.user_id is distinct from p_user_id or v_state.store_product_id is distinct from v_product
       or v_state.credit_kind is distinct from p_credit_kind or v_state.quantity is distinct from p_quantity then
      raise exception 'consumable_transaction_metadata_mismatch';
    end if;
    if v_state.last_provider_event_timestamp_ms is not null and
       (p_event_timestamp_ms<v_state.last_provider_event_timestamp_ms
        or (p_event_timestamp_ms=v_state.last_provider_event_timestamp_ms and coalesce(v_state.last_provider_event_rank,0)>3)) then
      update public.billing_webhook_events set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
      where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
      if not found then raise exception 'claim_lost_during_consumable_refund_reversal'; end if;
      return true;
    end if;
  end if;

  v_applied:=public.apply_consumable_refund_reversal_billing_webhook_event(
    p_event_id,p_claim_token,p_user_id,v_product,p_credit_kind,p_quantity,v_tx,v_app,v_env
  );
  if v_applied is distinct from true then return v_applied; end if;
  update public.consumable_store_transaction_state set
    last_provider_event_timestamp_ms=p_event_timestamp_ms,last_provider_event_rank=3,last_provider_event_id=p_event_id,updated_at=now()
  where provider_app_id=v_app and provider_environment=v_env and store_transaction_id=v_tx;
  if not found then raise exception 'consumable_transaction_state_missing_after_refund_reversal'; end if;
  return true;
end $$;

revoke all on function public.apply_consumable_billing_webhook_event_ordered(text,uuid,uuid,text,text,integer,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.apply_consumable_billing_webhook_event_ordered(text,uuid,uuid,text,text,integer,text,text,text,bigint) to service_role;
revoke all on function public.apply_consumable_refund_billing_webhook_event_ordered(text,uuid,uuid,text,text,integer,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.apply_consumable_refund_billing_webhook_event_ordered(text,uuid,uuid,text,text,integer,text,text,text,bigint) to service_role;
revoke all on function public.apply_consumable_refund_reversal_billing_webhook_event_ordered(text,uuid,uuid,text,text,integer,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.apply_consumable_refund_reversal_billing_webhook_event_ordered(text,uuid,uuid,text,text,integer,text,text,text,bigint) to service_role;
