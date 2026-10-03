-- Tailmance v19 R8: one-time RevenueCat consumables use the same claim-bound atomicity as subscriptions.
-- Credit grant, idempotency ledger and webhook processed-finalization commit together or roll back together.
create or replace function public.apply_consumable_billing_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_user_id uuid,
  p_product_id text,
  p_credit_kind text,
  p_quantity integer,
  p_store_transaction_id text default null
) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_inserted integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_credit_kind not in ('boost','super_like') or p_quantity not between 1 and 1000 then raise exception 'invalid_consumable_grant'; end if;
  if p_user_id is null or char_length(trim(coalesce(p_product_id,'')))<1 then raise exception 'invalid_consumable_purchase'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;
  if cardinality(coalesce(v_row.user_ids,'{}'::uuid[]))<>1 or not (p_user_id=any(coalesce(v_row.user_ids,'{}'::uuid[]))) then
    raise exception 'consumable_claim_user_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  insert into public.consumable_credit_ledger(event_key,user_id,credit_kind,quantity,store_product_id)
  values(trim(p_event_id),p_user_id,p_credit_kind,p_quantity,trim(p_product_id))
  on conflict(event_key) do nothing;
  get diagnostics v_inserted=row_count;

  if v_inserted=1 then
    insert into public.consumable_balances(user_id,boost_credits,super_like_credits)
    values(p_user_id,case when p_credit_kind='boost' then p_quantity else 0 end,case when p_credit_kind='super_like' then p_quantity else 0 end)
    on conflict(user_id) do update set
      boost_credits=public.consumable_balances.boost_credits+case when p_credit_kind='boost' then p_quantity else 0 end,
      super_like_credits=public.consumable_balances.super_like_credits+case when p_credit_kind='super_like' then p_quantity else 0 end,
      updated_at=now();
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(p_user_id,'consumable_credit_granted','billing_webhook',p_event_id,
      jsonb_build_object('productId',p_product_id,'creditKind',p_credit_kind,'quantity',p_quantity,
        'storeTransactionIdPresent',nullif(trim(coalesce(p_store_transaction_id,'')),'') is not null));
  end if;

  update public.billing_webhook_events
  set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
  if not found then raise exception 'claim_lost_during_consumable_apply'; end if;
  return true;
end $$;
revoke all on function public.apply_consumable_billing_webhook_event(text,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.apply_consumable_billing_webhook_event(text,uuid,uuid,text,text,integer,text) to service_role;
