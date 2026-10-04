-- Tailmance v19 R8: consumable refund/reversal accounting and anti-refund-abuse closure.
-- Signed RevenueCat lifecycle events are tracked per store transaction. A refund removes any
-- still-available credits and records already-spent quantity as debt; future grants/reversals
-- retire debt before making fresh credits available.

alter table public.consumable_balances
  add column if not exists boost_credit_debt integer not null default 0 check (boost_credit_debt between 0 and 1000000),
  add column if not exists super_like_credit_debt integer not null default 0 check (super_like_credit_debt between 0 and 1000000);

create table if not exists public.consumable_store_transaction_state (
  provider_app_id text not null check (char_length(trim(provider_app_id)) between 1 and 240),
  provider_environment text not null check (provider_environment in ('PRODUCTION','SANDBOX')),
  store_transaction_id text not null check (char_length(trim(store_transaction_id)) between 1 and 512),
  user_id uuid not null references public.users(id) on delete cascade,
  store_product_id text not null check (char_length(trim(store_product_id)) between 1 and 255),
  credit_kind text not null check (credit_kind in ('boost','super_like')),
  quantity integer not null check (quantity between 1 and 1000),
  state text not null check (state in ('active','refunded')),
  granted_event_id text,
  refund_event_id text,
  reversal_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(provider_app_id,provider_environment,store_transaction_id)
);
alter table public.consumable_store_transaction_state enable row level security;
revoke all on public.consumable_store_transaction_state from public,anon,authenticated;
grant all on public.consumable_store_transaction_state to service_role;
create index if not exists idx_consumable_store_transaction_state_user
  on public.consumable_store_transaction_state(user_id,updated_at desc);

-- Backfill any transaction-aware grants that landed after migration 152 but before this migration.
insert into public.consumable_store_transaction_state(
  provider_app_id,provider_environment,store_transaction_id,user_id,store_product_id,
  credit_kind,quantity,state,granted_event_id,created_at,updated_at
)
select provider_app_id,provider_environment,store_transaction_id,user_id,coalesce(store_product_id,'unknown'),
       credit_kind,quantity,'active',event_key,granted_at,granted_at
from public.consumable_credit_ledger
where provider_app_id is not null and provider_environment is not null and store_transaction_id is not null
on conflict(provider_app_id,provider_environment,store_transaction_id) do nothing;

create or replace function public.apply_consumable_billing_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_user_id uuid,
  p_product_id text,
  p_credit_kind text,
  p_quantity integer,
  p_store_transaction_id text,
  p_provider_app_id text,
  p_provider_environment text
) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state public.consumable_store_transaction_state%rowtype;
  v_inserted integer:=0;
  v_debt integer:=0;
  v_offset integer:=0;
  v_transaction_id text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app_id text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_environment text:=upper(trim(coalesce(p_provider_environment,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_credit_kind not in ('boost','super_like') or p_quantity not between 1 and 1000 then raise exception 'invalid_consumable_grant'; end if;
  if p_user_id is null or char_length(trim(coalesce(p_product_id,'')))<1 then raise exception 'invalid_consumable_purchase'; end if;
  if v_transaction_id is null or char_length(v_transaction_id)>512 then raise exception 'consumable_transaction_id_required'; end if;
  if v_app_id is null or char_length(v_app_id)>240 then raise exception 'consumable_provider_app_id_required'; end if;
  if v_environment not in ('PRODUCTION','SANDBOX') then raise exception 'consumable_provider_environment_invalid'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;
  if cardinality(coalesce(v_row.user_ids,'{}'::uuid[]))<>1 or not (p_user_id=any(coalesce(v_row.user_ids,'{}'::uuid[]))) then
    raise exception 'consumable_claim_user_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_app_id||'|'||v_environment||'|'||v_transaction_id,1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select * into v_state from public.consumable_store_transaction_state
    where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id
    for update;

  if v_state.store_transaction_id is not null then
    if v_state.user_id<>p_user_id or v_state.store_product_id<>trim(p_product_id)
       or v_state.credit_kind<>p_credit_kind or v_state.quantity<>p_quantity then
      raise exception 'consumable_transaction_metadata_mismatch';
    end if;
    if v_state.state='refunded' then
      update public.consumable_store_transaction_state
      set granted_event_id=coalesce(granted_event_id,p_event_id),updated_at=now()
      where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id;
      update public.billing_webhook_events
      set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
      where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
      if not found then raise exception 'claim_lost_during_consumable_apply'; end if;
      return true;
    end if;
    if v_state.granted_event_id is not null then
      update public.billing_webhook_events
      set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
      where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
      if not found then raise exception 'claim_lost_during_consumable_apply'; end if;
      return true;
    end if;
    update public.consumable_store_transaction_state
    set granted_event_id=p_event_id,updated_at=now()
    where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id;
  else
    insert into public.consumable_store_transaction_state(
      provider_app_id,provider_environment,store_transaction_id,user_id,store_product_id,
      credit_kind,quantity,state,granted_event_id
    ) values(v_app_id,v_environment,v_transaction_id,p_user_id,trim(p_product_id),p_credit_kind,p_quantity,'active',p_event_id);
  end if;

  insert into public.consumable_credit_ledger(
    event_key,user_id,credit_kind,quantity,store_product_id,
    provider_app_id,provider_environment,store_transaction_id
  ) values(trim(p_event_id),p_user_id,p_credit_kind,p_quantity,trim(p_product_id),v_app_id,v_environment,v_transaction_id)
  on conflict do nothing;
  get diagnostics v_inserted=row_count;

  if v_inserted=1 then
    insert into public.consumable_balances(user_id) values(p_user_id) on conflict(user_id) do nothing;
    select case when p_credit_kind='boost' then boost_credit_debt else super_like_credit_debt end
      into v_debt from public.consumable_balances where user_id=p_user_id for update;
    v_offset:=least(coalesce(v_debt,0),p_quantity);
    update public.consumable_balances set
      boost_credit_debt=boost_credit_debt-case when p_credit_kind='boost' then v_offset else 0 end,
      super_like_credit_debt=super_like_credit_debt-case when p_credit_kind='super_like' then v_offset else 0 end,
      boost_credits=boost_credits+case when p_credit_kind='boost' then p_quantity-v_offset else 0 end,
      super_like_credits=super_like_credits+case when p_credit_kind='super_like' then p_quantity-v_offset else 0 end,
      updated_at=now()
    where user_id=p_user_id;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(p_user_id,'consumable_credit_granted','billing_webhook',p_event_id,
      jsonb_build_object('productId',p_product_id,'creditKind',p_credit_kind,'quantity',p_quantity,
        'debtOffset',v_offset,'providerAppId',v_app_id,'providerEnvironment',v_environment,
        'storeTransactionIdPresent',true));
  end if;

  update public.billing_webhook_events
  set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
  if not found then raise exception 'claim_lost_during_consumable_apply'; end if;
  return true;
end $$;

create or replace function public.apply_consumable_refund_billing_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_user_id uuid,
  p_product_id text,
  p_credit_kind text,
  p_quantity integer,
  p_store_transaction_id text,
  p_provider_app_id text,
  p_provider_environment text
) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state public.consumable_store_transaction_state%rowtype;
  v_available integer:=0;
  v_take integer:=0;
  v_should_debit boolean:=false;
  v_transaction_id text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app_id text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_environment text:=upper(trim(coalesce(p_provider_environment,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_credit_kind not in ('boost','super_like') or p_quantity not between 1 and 1000 then raise exception 'invalid_consumable_refund'; end if;
  if p_user_id is null or char_length(trim(coalesce(p_product_id,'')))<1 or v_transaction_id is null or v_app_id is null
     or v_environment not in ('PRODUCTION','SANDBOX') then raise exception 'invalid_consumable_refund'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;
  if cardinality(coalesce(v_row.user_ids,'{}'::uuid[]))<>1 or not (p_user_id=any(coalesce(v_row.user_ids,'{}'::uuid[]))) then raise exception 'consumable_claim_user_mismatch'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_app_id||'|'||v_environment||'|'||v_transaction_id,1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select * into v_state from public.consumable_store_transaction_state
    where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id
    for update;

  if v_state.store_transaction_id is null then
    insert into public.consumable_store_transaction_state(
      provider_app_id,provider_environment,store_transaction_id,user_id,store_product_id,
      credit_kind,quantity,state,refund_event_id
    ) values(v_app_id,v_environment,v_transaction_id,p_user_id,trim(p_product_id),p_credit_kind,p_quantity,'refunded',p_event_id);
  else
    if v_state.user_id<>p_user_id or v_state.store_product_id<>trim(p_product_id)
       or v_state.credit_kind<>p_credit_kind or v_state.quantity<>p_quantity then raise exception 'consumable_transaction_metadata_mismatch'; end if;
    if v_state.state='active' then
      v_should_debit:=v_state.granted_event_id is not null;
      update public.consumable_store_transaction_state set state='refunded',refund_event_id=p_event_id,reversal_event_id=null,updated_at=now()
      where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id;
    end if;
  end if;

  if v_should_debit then
    insert into public.consumable_balances(user_id) values(p_user_id) on conflict(user_id) do nothing;
    select case when p_credit_kind='boost' then boost_credits else super_like_credits end
      into v_available from public.consumable_balances where user_id=p_user_id for update;
    v_take:=least(coalesce(v_available,0),p_quantity);
    update public.consumable_balances set
      boost_credits=boost_credits-case when p_credit_kind='boost' then v_take else 0 end,
      super_like_credits=super_like_credits-case when p_credit_kind='super_like' then v_take else 0 end,
      boost_credit_debt=boost_credit_debt+case when p_credit_kind='boost' then p_quantity-v_take else 0 end,
      super_like_credit_debt=super_like_credit_debt+case when p_credit_kind='super_like' then p_quantity-v_take else 0 end,
      updated_at=now()
    where user_id=p_user_id;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(p_user_id,'consumable_credit_refunded','billing_webhook',p_event_id,
      jsonb_build_object('productId',p_product_id,'creditKind',p_credit_kind,'quantity',p_quantity,
        'availableCreditsRemoved',v_take,'refundDebtAdded',p_quantity-v_take,
        'providerAppId',v_app_id,'providerEnvironment',v_environment));
  end if;

  update public.billing_webhook_events
  set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
  if not found then raise exception 'claim_lost_during_consumable_refund'; end if;
  return true;
end $$;

create or replace function public.apply_consumable_refund_reversal_billing_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_user_id uuid,
  p_product_id text,
  p_credit_kind text,
  p_quantity integer,
  p_store_transaction_id text,
  p_provider_app_id text,
  p_provider_environment text
) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state public.consumable_store_transaction_state%rowtype;
  v_debt integer:=0;
  v_offset integer:=0;
  v_should_credit boolean:=false;
  v_transaction_id text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app_id text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_environment text:=upper(trim(coalesce(p_provider_environment,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_credit_kind not in ('boost','super_like') or p_quantity not between 1 and 1000 then raise exception 'invalid_consumable_refund_reversal'; end if;
  if p_user_id is null or char_length(trim(coalesce(p_product_id,'')))<1 or v_transaction_id is null or v_app_id is null
     or v_environment not in ('PRODUCTION','SANDBOX') then raise exception 'invalid_consumable_refund_reversal'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;
  if cardinality(coalesce(v_row.user_ids,'{}'::uuid[]))<>1 or not (p_user_id=any(coalesce(v_row.user_ids,'{}'::uuid[]))) then raise exception 'consumable_claim_user_mismatch'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_app_id||'|'||v_environment||'|'||v_transaction_id,1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select * into v_state from public.consumable_store_transaction_state
    where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id
    for update;

  if v_state.store_transaction_id is null then
    insert into public.consumable_store_transaction_state(
      provider_app_id,provider_environment,store_transaction_id,user_id,store_product_id,
      credit_kind,quantity,state,granted_event_id,reversal_event_id
    ) values(v_app_id,v_environment,v_transaction_id,p_user_id,trim(p_product_id),p_credit_kind,p_quantity,'active',p_event_id,p_event_id);
    v_should_credit:=true;
  else
    if v_state.user_id<>p_user_id or v_state.store_product_id<>trim(p_product_id)
       or v_state.credit_kind<>p_credit_kind or v_state.quantity<>p_quantity then raise exception 'consumable_transaction_metadata_mismatch'; end if;
    if v_state.state='refunded' then
      update public.consumable_store_transaction_state
      set state='active',granted_event_id=coalesce(granted_event_id,p_event_id),reversal_event_id=p_event_id,updated_at=now()
      where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id;
      v_should_credit:=true;
    end if;
  end if;

  if v_should_credit then
    insert into public.consumable_credit_ledger(
      event_key,user_id,credit_kind,quantity,store_product_id,
      provider_app_id,provider_environment,store_transaction_id
    ) values(trim(p_event_id),p_user_id,p_credit_kind,p_quantity,trim(p_product_id),v_app_id,v_environment,v_transaction_id)
    on conflict do nothing;
    insert into public.consumable_balances(user_id) values(p_user_id) on conflict(user_id) do nothing;
    select case when p_credit_kind='boost' then boost_credit_debt else super_like_credit_debt end
      into v_debt from public.consumable_balances where user_id=p_user_id for update;
    v_offset:=least(coalesce(v_debt,0),p_quantity);
    update public.consumable_balances set
      boost_credit_debt=boost_credit_debt-case when p_credit_kind='boost' then v_offset else 0 end,
      super_like_credit_debt=super_like_credit_debt-case when p_credit_kind='super_like' then v_offset else 0 end,
      boost_credits=boost_credits+case when p_credit_kind='boost' then p_quantity-v_offset else 0 end,
      super_like_credits=super_like_credits+case when p_credit_kind='super_like' then p_quantity-v_offset else 0 end,
      updated_at=now()
    where user_id=p_user_id;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(p_user_id,'consumable_refund_reversed','billing_webhook',p_event_id,
      jsonb_build_object('productId',p_product_id,'creditKind',p_credit_kind,'quantity',p_quantity,
        'debtOffset',v_offset,'providerAppId',v_app_id,'providerEnvironment',v_environment));
  end if;

  update public.billing_webhook_events
  set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
  if not found then raise exception 'claim_lost_during_consumable_refund_reversal'; end if;
  return true;
end $$;

revoke all on function public.apply_consumable_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_consumable_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) to service_role;
revoke all on function public.apply_consumable_refund_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_consumable_refund_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) to service_role;
revoke all on function public.apply_consumable_refund_reversal_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_consumable_refund_reversal_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) to service_role;
