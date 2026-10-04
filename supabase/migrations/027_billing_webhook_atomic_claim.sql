-- Tailmance TUR 2: RevenueCat webhook idempotency must be concurrency-safe.
alter table public.billing_webhook_events add column if not exists claim_token uuid;
alter table public.billing_webhook_events add column if not exists claimed_at timestamptz;
create index if not exists billing_webhook_events_claimed_idx on public.billing_webhook_events(claimed_at) where status='processing';

create or replace function public.claim_billing_webhook_event(
  p_event_id text,
  p_event_type text,
  p_user_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_token uuid:=gen_random_uuid();
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_event_id is null or char_length(p_event_id) not between 1 and 255 then raise exception 'invalid_event_id'; end if;
  if p_event_type is null or char_length(p_event_type) not between 1 and 120 then raise exception 'invalid_event_type'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null then
    insert into public.billing_webhook_events(event_id,event_type,user_ids,status,claim_token,claimed_at,last_error)
    values(p_event_id,p_event_type,coalesce(p_user_ids,'{}'::uuid[]),'processing',v_token,now(),null);
    return jsonb_build_object('claimed',true,'claimToken',v_token,'status','processing');
  end if;

  if v_row.status='processed' then
    return jsonb_build_object('claimed',false,'status','processed');
  end if;
  if v_row.status='processing' and v_row.claimed_at is not null and v_row.claimed_at>now()-interval '10 minutes' then
    return jsonb_build_object('claimed',false,'status','processing');
  end if;

  update public.billing_webhook_events
  set event_type=p_event_type,user_ids=coalesce(p_user_ids,'{}'::uuid[]),status='processing',
      claim_token=v_token,claimed_at=now(),last_error=null
  where event_id=p_event_id;
  return jsonb_build_object('claimed',true,'claimToken',v_token,'status','processing');
end;
$$;
revoke all on function public.claim_billing_webhook_event(text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_billing_webhook_event(text,text,uuid[]) to service_role;

create or replace function public.finish_billing_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_status text,
  p_last_error text default null
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_updated integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('processed','failed') then raise exception 'invalid_status'; end if;
  update public.billing_webhook_events
  set status=p_status,
      processed_at=case when p_status='processed' then now() else processed_at end,
      last_error=case when p_status='failed' then left(coalesce(p_last_error,'webhook_failed'),120) else null end,
      claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;
revoke all on function public.finish_billing_webhook_event(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_billing_webhook_event(text,uuid,text,text) to service_role;
