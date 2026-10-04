-- Tailmance v19 R8: bounded service-only cost budgets for external AI providers.
-- These limits are a final server-side circuit breaker in addition to authenticated upload/write
-- rate limits, queue claim bounds and exponential retry backoff. Provider calls fail closed when
-- the budget cannot be consumed; clients can neither read nor mutate this control plane.

create table if not exists public.ai_provider_cost_budgets(
  provider_key text primary key,
  max_per_minute integer not null check(max_per_minute between 1 and 10000),
  max_per_hour integer not null check(max_per_hour between 1 and 500000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  check(max_per_hour>=max_per_minute)
);

create table if not exists public.ai_provider_cost_windows(
  provider_key text not null references public.ai_provider_cost_budgets(provider_key) on delete cascade,
  window_seconds integer not null check(window_seconds in (60,3600)),
  window_start timestamptz not null,
  count integer not null check(count>=0),
  updated_at timestamptz not null default now(),
  primary key(provider_key,window_seconds,window_start)
);

alter table public.ai_provider_cost_budgets enable row level security;
alter table public.ai_provider_cost_windows enable row level security;
revoke all on table public.ai_provider_cost_budgets from public,anon,authenticated;
revoke all on table public.ai_provider_cost_windows from public,anon,authenticated;
grant select,insert,update,delete on table public.ai_provider_cost_budgets to service_role;
grant select,insert,update,delete on table public.ai_provider_cost_windows to service_role;

insert into public.ai_provider_cost_budgets(provider_key,max_per_minute,max_per_hour,enabled)
values
  ('content_moderation',120,5000,true),
  ('health_ai',20,500,true)
on conflict(provider_key) do nothing;

create or replace function public.service_consume_ai_provider_budget(p_provider_key text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_budget public.ai_provider_cost_budgets%rowtype;
  v_minute_start timestamptz;
  v_hour_start timestamptz;
  v_minute_count integer;
  v_hour_count integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_provider_key is null or p_provider_key !~ '^[a-z0-9_]{2,40}$' then raise exception 'invalid_provider_key'; end if;

  select * into v_budget
  from public.ai_provider_cost_budgets
  where provider_key=p_provider_key
  for update;
  if v_budget.provider_key is null or not v_budget.enabled then raise exception 'ai_provider_budget_unavailable'; end if;

  v_minute_start:=date_trunc('minute',now());
  v_hour_start:=date_trunc('hour',now());

  insert into public.ai_provider_cost_windows(provider_key,window_seconds,window_start,count,updated_at)
  values(p_provider_key,60,v_minute_start,1,now())
  on conflict(provider_key,window_seconds,window_start) do update
    set count=public.ai_provider_cost_windows.count+1,updated_at=now()
  returning count into v_minute_count;
  if v_minute_count>v_budget.max_per_minute then raise exception 'ai_provider_minute_budget_exceeded'; end if;

  insert into public.ai_provider_cost_windows(provider_key,window_seconds,window_start,count,updated_at)
  values(p_provider_key,3600,v_hour_start,1,now())
  on conflict(provider_key,window_seconds,window_start) do update
    set count=public.ai_provider_cost_windows.count+1,updated_at=now()
  returning count into v_hour_count;
  if v_hour_count>v_budget.max_per_hour then raise exception 'ai_provider_hour_budget_exceeded'; end if;

  return jsonb_build_object(
    'provider',p_provider_key,
    'minuteCount',v_minute_count,
    'minuteLimit',v_budget.max_per_minute,
    'hourCount',v_hour_count,
    'hourLimit',v_budget.max_per_hour
  );
end $$;
revoke all on function public.service_consume_ai_provider_budget(text) from public,anon,authenticated;
grant execute on function public.service_consume_ai_provider_budget(text) to service_role;

create or replace function public.service_purge_ai_provider_cost_windows(p_before timestamptz default now()-interval '48 hours')
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare v_deleted bigint;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_before is null or p_before>now()-interval '1 hour' then raise exception 'invalid_retention_cutoff'; end if;
  delete from public.ai_provider_cost_windows where window_start<p_before;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end $$;
revoke all on function public.service_purge_ai_provider_cost_windows(timestamptz) from public,anon,authenticated;
grant execute on function public.service_purge_ai_provider_cost_windows(timestamptz) to service_role;
