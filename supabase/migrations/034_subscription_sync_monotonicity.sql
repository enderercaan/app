-- Tailmance TUR 2: serialize manual RevenueCat reconciliation with webhook application.
-- Both writers use the same per-user transaction advisory lock and a monotonic observation marker,
-- preventing an older manual response from overwriting a newer webhook result (or vice versa).

create table if not exists public.billing_state_versions (
  user_id uuid primary key references public.users(id) on delete cascade,
  last_observed_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.billing_state_versions enable row level security;
revoke all on public.billing_state_versions from public,anon,authenticated;
grant all on public.billing_state_versions to service_role;

-- Seed the marker from already processed webhook history so deployment cannot reopen an old-write window.
insert into public.billing_state_versions(user_id,last_observed_at,updated_at)
select u.user_id,max(coalesce(e.processed_at,e.received_at)),now()
from public.billing_webhook_events e
cross join lateral unnest(coalesce(e.user_ids,'{}'::uuid[])) as u(user_id)
where e.status='processed'
group by u.user_id
on conflict(user_id) do update set
  last_observed_at=greatest(public.billing_state_versions.last_observed_at,excluded.last_observed_at),
  updated_at=now();

create or replace function public.apply_manual_subscription_sync(
  p_user_id uuid,
  p_observed_at timestamptz,
  p_premium boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_last timestamptz;
  v_effective public.account_tier;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null or p_observed_at is null or p_premium is null then raise exception 'invalid_subscription_sync'; end if;
  if p_observed_at>now()+interval '1 minute' or p_observed_at<now()-interval '5 minutes' then raise exception 'stale_subscription_observation'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  if not exists(select 1 from public.users where id=p_user_id) then raise exception 'user_not_found'; end if;

  insert into public.billing_state_versions(user_id,last_observed_at,updated_at)
  values(p_user_id,'epoch'::timestamptz,now())
  on conflict(user_id) do nothing;
  select last_observed_at into v_last from public.billing_state_versions where user_id=p_user_id for update;

  if v_last is not null and v_last>p_observed_at then
    select tier into v_effective from public.users where id=p_user_id;
    return jsonb_build_object('applied',false,'effectivePremium',v_effective='premium','reason','newer_state_present');
  end if;

  update public.users
  set tier=case when p_premium then 'premium'::public.account_tier else 'standard'::public.account_tier end,
      updated_at=now()
  where id=p_user_id
  returning tier into v_effective;

  update public.billing_state_versions
  set last_observed_at=p_observed_at,updated_at=now()
  where user_id=p_user_id;

  return jsonb_build_object('applied',true,'effectivePremium',v_effective='premium');
end;
$$;
revoke all on function public.apply_manual_subscription_sync(uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.apply_manual_subscription_sync(uuid,timestamptz,boolean) to service_role;

-- Re-define the webhook apply RPC so it takes the same per-user lock and advances the same marker.
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
  v_lock_user_id uuid;
  v_premium boolean;
  v_seen uuid[] := '{}'::uuid[];
  v_state_count integer := 0;
  v_apply_time timestamptz:=now();
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

  -- Acquire all user locks in deterministic UUID order before changing any tier/subscription row.
  for v_lock_user_id in
    select distinct x from unnest(coalesce(v_row.user_ids,'{}'::uuid[])) as x order by x
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_user_id::text,0));
  end loop;

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

    if not (v_user_id = any(coalesce(v_row.user_ids,'{}'::uuid[]))) then raise exception 'user_not_in_claim'; end if;
    if v_user_id = any(v_seen) then raise exception 'duplicate_user_state'; end if;
    v_seen := array_append(v_seen,v_user_id);
    v_state_count := v_state_count + 1;

    update public.users
    set tier=case when v_premium then 'premium'::public.account_tier else 'standard'::public.account_tier end,
        updated_at=v_apply_time
    where id=v_user_id;

    if found then
      insert into public.billing_state_versions(user_id,last_observed_at,updated_at)
      values(v_user_id,v_apply_time,v_apply_time)
      on conflict(user_id) do update set
        last_observed_at=greatest(public.billing_state_versions.last_observed_at,excluded.last_observed_at),
        updated_at=v_apply_time;
    end if;
  end loop;

  if v_state_count <> cardinality(coalesce(v_row.user_ids,'{}'::uuid[])) then raise exception 'incomplete_user_states'; end if;

  if p_subscription_user_id is not null then
    if not (p_subscription_user_id = any(coalesce(v_row.user_ids,'{}'::uuid[]))) then raise exception 'subscription_user_not_in_claim'; end if;
    if p_platform not in ('apple','google') then raise exception 'invalid_platform'; end if;
    if p_product_id is null or char_length(p_product_id) not between 1 and 255 then raise exception 'invalid_product_id'; end if;
    if p_entitlement_id is null or char_length(p_entitlement_id) not between 1 and 255 then raise exception 'invalid_entitlement_id'; end if;
    if p_subscription_status is null or char_length(p_subscription_status) not between 1 and 120 then raise exception 'invalid_subscription_status'; end if;

    if exists(select 1 from public.users where id=p_subscription_user_id) then
      insert into public.subscriptions(
        user_id,platform,product_id,entitlement_id,store_transaction_id,status,current_period_end,will_renew,raw_event_id,updated_at
      ) values (
        p_subscription_user_id,p_platform,p_product_id,p_entitlement_id,p_store_transaction_id,p_subscription_status,
        p_current_period_end,p_will_renew,p_event_id,v_apply_time
      )
      on conflict(raw_event_id) do update set
        user_id=excluded.user_id,platform=excluded.platform,product_id=excluded.product_id,
        entitlement_id=excluded.entitlement_id,store_transaction_id=excluded.store_transaction_id,
        status=excluded.status,current_period_end=excluded.current_period_end,will_renew=excluded.will_renew,updated_at=v_apply_time;
    end if;
  end if;

  update public.billing_webhook_events
  set status='processed',processed_at=v_apply_time,last_error=null,claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
  if not found then raise exception 'claim_lost_during_apply'; end if;
  return true;
end;
$$;
revoke all on function public.apply_billing_webhook_event(text,uuid,jsonb,uuid,text,text,text,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.apply_billing_webhook_event(text,uuid,jsonb,uuid,text,text,text,text,text,timestamptz,boolean) to service_role;
