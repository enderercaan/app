-- Tailmance TUR 2: bind all RevenueCat webhook side effects to the active claim token.
-- A stale worker may perform upstream read-only reconciliation, but it cannot mutate
-- subscription/user state once another worker owns or has finalized the ledger row.

create or replace function public.apply_billing_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_user_states jsonb,
  p_subscription_user_id uuid default null,
  p_platform text default null,
  p_product_id text default null,
  p_entitlement_id text default null,
  p_subscription_status text default null,
  p_store_transaction_id text default null,
  p_current_period_end timestamptz default null,
  p_will_renew boolean default null
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state jsonb;
  v_user_id uuid;
  v_premium boolean;
  v_seen uuid[] := '{}'::uuid[];
  v_state_count integer := 0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_event_id is null or char_length(p_event_id) not between 1 and 255 then raise exception 'invalid_event_id'; end if;
  if p_claim_token is null then raise exception 'invalid_claim_token'; end if;
  if jsonb_typeof(p_user_states) <> 'array' then raise exception 'invalid_user_states'; end if;
  if jsonb_array_length(p_user_states) > 20 then raise exception 'too_many_user_states'; end if;

  select * into v_row
  from public.billing_webhook_events
  where event_id=p_event_id
  for update;

  if v_row.event_id is null
     or v_row.status<>'processing'
     or v_row.claim_token is distinct from p_claim_token then
    return false;
  end if;

  for v_state in select value from jsonb_array_elements(p_user_states)
  loop
    if jsonb_typeof(v_state) <> 'object'
       or jsonb_typeof(v_state->'userId') <> 'string'
       or jsonb_typeof(v_state->'premium') <> 'boolean' then
      raise exception 'invalid_user_state';
    end if;

    begin
      v_user_id := (v_state->>'userId')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_user_state';
    end;
    v_premium := (v_state->>'premium')::boolean;

    if not (v_user_id = any(coalesce(v_row.user_ids,'{}'::uuid[]))) then
      raise exception 'user_not_in_claim';
    end if;
    if v_user_id = any(v_seen) then
      raise exception 'duplicate_user_state';
    end if;
    v_seen := array_append(v_seen,v_user_id);
    v_state_count := v_state_count + 1;

    update public.users
    set tier=case when v_premium then 'premium'::public.account_tier else 'standard'::public.account_tier end,
        updated_at=now()
    where id=v_user_id;
  end loop;

  if v_state_count <> cardinality(coalesce(v_row.user_ids,'{}'::uuid[])) then
    raise exception 'incomplete_user_states';
  end if;

  if p_subscription_user_id is not null then
    if not (p_subscription_user_id = any(coalesce(v_row.user_ids,'{}'::uuid[]))) then
      raise exception 'subscription_user_not_in_claim';
    end if;
    if p_platform not in ('apple','google') then raise exception 'invalid_platform'; end if;
    if p_product_id is null or char_length(p_product_id) not between 1 and 255 then raise exception 'invalid_product_id'; end if;
    if p_entitlement_id is null or char_length(p_entitlement_id) not between 1 and 255 then raise exception 'invalid_entitlement_id'; end if;
    if p_subscription_status is null or char_length(p_subscription_status) not between 1 and 120 then raise exception 'invalid_subscription_status'; end if;

    -- A webhook may arrive after account deletion. In that case there is no local
    -- subscription row to preserve and the event can still be finalized safely.
    if exists(select 1 from public.users where id=p_subscription_user_id) then
      insert into public.subscriptions(
        user_id,platform,product_id,entitlement_id,store_transaction_id,status,
        current_period_end,will_renew,raw_event_id,updated_at
      ) values (
        p_subscription_user_id,p_platform,p_product_id,p_entitlement_id,
        p_store_transaction_id,p_subscription_status,p_current_period_end,
        p_will_renew,p_event_id,now()
      )
      on conflict(raw_event_id) do update set
        user_id=excluded.user_id,
        platform=excluded.platform,
        product_id=excluded.product_id,
        entitlement_id=excluded.entitlement_id,
        store_transaction_id=excluded.store_transaction_id,
        status=excluded.status,
        current_period_end=excluded.current_period_end,
        will_renew=excluded.will_renew,
        updated_at=now();
    end if;
  end if;

  update public.billing_webhook_events
  set status='processed',processed_at=now(),last_error=null,claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;

  if not found then
    -- The row is locked above, so this is defensive. Transaction rollback prevents
    -- any partial user/subscription state from escaping if the invariant fails.
    raise exception 'claim_lost_during_apply';
  end if;

  return true;
end;
$$;

revoke all on function public.apply_billing_webhook_event(text,uuid,jsonb,uuid,text,text,text,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.apply_billing_webhook_event(text,uuid,jsonb,uuid,text,text,text,text,text,timestamptz,boolean) to service_role;
