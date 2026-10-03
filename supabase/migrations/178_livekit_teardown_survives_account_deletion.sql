-- Tailmance v19 R8 — LiveKit teardown must survive account/match deletion.
-- Operational room cleanup is a privacy obligation: deleting the relational call
-- record must never delete the only retry state capable of forcibly closing the SFU room.

alter table public.livekit_room_teardown_queue
  drop constraint if exists livekit_room_teardown_queue_call_id_fkey;

create or replace function public.enqueue_livekit_room_teardown_before_call_delete()
returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.livekit_room_teardown_queue(
    call_id,room_name,status,attempts,next_attempt_at,lease_until,last_error_code,completed_at,updated_at
  ) values(
    old.id,old.room_name,'pending',0,now(),null,null,null,now()
  )
  on conflict(call_id) do update set
    room_name=excluded.room_name,
    status='pending',
    next_attempt_at=least(public.livekit_room_teardown_queue.next_attempt_at,now()),
    lease_until=null,
    completed_at=null,
    updated_at=now();
  return old;
end $$;
revoke all on function public.enqueue_livekit_room_teardown_before_call_delete() from public,anon,authenticated;

drop trigger if exists trg_pet_call_livekit_room_teardown_before_delete on public.pet_call_sessions;
create trigger trg_pet_call_livekit_room_teardown_before_delete
before delete on public.pet_call_sessions
for each row execute function public.enqueue_livekit_room_teardown_before_call_delete();

-- Successful teardown records contain no user-authored content and have no reason
-- to persist. Remove them instead of retaining an operational history indefinitely.
create or replace function public.service_complete_livekit_room_teardown(p_call_id uuid)
returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from public.livekit_room_teardown_queue where call_id=p_call_id;
end $$;
revoke all on function public.service_complete_livekit_room_teardown(uuid) from public,anon,authenticated;
grant execute on function public.service_complete_livekit_room_teardown(uuid) to service_role;
