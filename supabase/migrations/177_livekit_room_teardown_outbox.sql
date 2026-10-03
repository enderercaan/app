-- Tailmance v19 R8 — transactional LiveKit room teardown outbox.
-- A DB-terminal call state must eventually force-disconnect every SFU participant;
-- client cooperation is never treated as the privacy boundary.

create table if not exists public.livekit_room_teardown_queue (
  call_id uuid primary key references public.pet_call_sessions(id) on delete cascade,
  room_name text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint livekit_room_teardown_room_check check(room_name ~ '^tailmance_call_[0-9a-f-]{36}$'),
  constraint livekit_room_teardown_status_check check(status in ('pending','processing','done')),
  constraint livekit_room_teardown_attempts_check check(attempts>=0),
  constraint livekit_room_teardown_error_check check(last_error_code is null or last_error_code ~ '^[A-Za-z0-9_.-]{1,80}$')
);
alter table public.livekit_room_teardown_queue enable row level security;
revoke all on public.livekit_room_teardown_queue from public,anon,authenticated;
create index if not exists idx_livekit_room_teardown_due
  on public.livekit_room_teardown_queue(next_attempt_at,created_at)
  where status in ('pending','processing');

create or replace function public.enqueue_livekit_room_teardown()
returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('declined','ended','expired')
     and old.status is distinct from new.status then
    insert into public.livekit_room_teardown_queue(call_id,room_name,status,next_attempt_at,updated_at)
    values(new.id,new.room_name,'pending',now(),now())
    on conflict(call_id) do update set
      room_name=excluded.room_name,
      status=case when public.livekit_room_teardown_queue.status='done' then 'done' else 'pending' end,
      next_attempt_at=case when public.livekit_room_teardown_queue.status='done' then public.livekit_room_teardown_queue.next_attempt_at else now() end,
      lease_until=case when public.livekit_room_teardown_queue.status='done' then public.livekit_room_teardown_queue.lease_until else null end,
      updated_at=now();
  end if;
  return new;
end $$;
revoke all on function public.enqueue_livekit_room_teardown() from public,anon,authenticated;

drop trigger if exists trg_pet_call_livekit_room_teardown on public.pet_call_sessions;
create trigger trg_pet_call_livekit_room_teardown
after update of status on public.pet_call_sessions
for each row execute function public.enqueue_livekit_room_teardown();

-- Preserve cleanup for terminal rows created before this migration.
insert into public.livekit_room_teardown_queue(call_id,room_name,status,next_attempt_at)
select id,room_name,'pending',now()
from public.pet_call_sessions
where status in ('declined','ended','expired')
on conflict(call_id) do nothing;

create or replace function public.service_claim_livekit_room_teardowns(p_limit integer default 25)
returns table(call_id uuid,room_name text,attempts integer)
language plpgsql security definer set search_path='' as $$
begin
  return query
  with due as (
    select q.call_id
    from public.livekit_room_teardown_queue q
    where q.completed_at is null
      and q.next_attempt_at<=now()
      and (q.status='pending' or (q.status='processing' and coalesce(q.lease_until,'-infinity'::timestamptz)<=now()))
    order by q.next_attempt_at,q.created_at,q.call_id
    for update skip locked
    limit least(greatest(coalesce(p_limit,25),1),100)
  ), claimed as (
    update public.livekit_room_teardown_queue q
    set status='processing',lease_until=now()+interval '2 minutes',updated_at=now()
    from due
    where q.call_id=due.call_id
    returning q.call_id,q.room_name,q.attempts
  )
  select c.call_id,c.room_name,c.attempts from claimed c;
end $$;
revoke all on function public.service_claim_livekit_room_teardowns(integer) from public,anon,authenticated;
grant execute on function public.service_claim_livekit_room_teardowns(integer) to service_role;

create or replace function public.service_complete_livekit_room_teardown(p_call_id uuid)
returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.livekit_room_teardown_queue
  set status='done',lease_until=null,last_error_code=null,completed_at=now(),updated_at=now()
  where call_id=p_call_id and completed_at is null;
end $$;
revoke all on function public.service_complete_livekit_room_teardown(uuid) from public,anon,authenticated;
grant execute on function public.service_complete_livekit_room_teardown(uuid) to service_role;

create or replace function public.service_retry_livekit_room_teardown(
  p_call_id uuid,
  p_error_code text,
  p_delay_seconds integer
) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_error text:=trim(coalesce(p_error_code,''));
  v_delay integer:=least(greatest(coalesce(p_delay_seconds,30),30),21600);
begin
  if v_error !~ '^[A-Za-z0-9_.-]{1,80}$' then v_error:='livekit_teardown_failed'; end if;
  update public.livekit_room_teardown_queue
  set status='pending',attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>v_delay),
      lease_until=null,last_error_code=v_error,updated_at=now()
  where call_id=p_call_id and completed_at is null;
end $$;
revoke all on function public.service_retry_livekit_room_teardown(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.service_retry_livekit_room_teardown(uuid,text,integer) to service_role;

-- The room reaper also owns stale-call expiry so abandoned active rooms eventually
-- enter the same transactional teardown queue even when no client calls another RPC.
grant execute on function public.expire_stale_pet_calls() to service_role;
