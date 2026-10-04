-- Tailmance v19 R8: pet-first matched audio/video call authorization.
-- Depends on migration 170 committing notification_type='call'.
-- Owners remain account managers; call participants are pet identities. LiveKit secrets stay server-side.

do $$ begin
  create type public.pet_call_type as enum ('audio','video');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.pet_call_status as enum ('ringing','active','declined','ended','expired');
exception when duplicate_object then null; end $$;

create table if not exists public.pet_call_sessions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.pet_matches(id) on delete cascade,
  caller_pet_id uuid not null references public.pets(id) on delete cascade,
  callee_pet_id uuid not null references public.pets(id) on delete cascade,
  call_type public.pet_call_type not null,
  status public.pet_call_status not null default 'ringing',
  room_name text not null unique,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  ring_expires_at timestamptz not null default (now()+interval '90 seconds'),
  hard_expires_at timestamptz not null default (now()+interval '2 hours'),
  constraint pet_call_distinct_pets check(caller_pet_id<>callee_pet_id),
  constraint pet_call_room_name_check check(room_name ~ '^tailmance_call_[0-9a-f-]{36}$'),
  constraint pet_call_expiry_order check(ring_expires_at>created_at and hard_expires_at>ring_expires_at)
);
alter table public.pet_call_sessions enable row level security;
revoke all on public.pet_call_sessions from anon,authenticated;
create index if not exists idx_pet_call_sessions_callee_ringing on public.pet_call_sessions(callee_pet_id,created_at desc) where status='ringing';
create index if not exists idx_pet_call_sessions_match_active on public.pet_call_sessions(match_id,created_at desc) where status in ('ringing','active');

create or replace function public.expire_stale_pet_calls()
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.pet_call_sessions set status='expired',ended_at=coalesce(ended_at,now())
  where (status='ringing' and ring_expires_at<=now()) or (status='active' and hard_expires_at<=now());
end $$;
revoke all on function public.expire_stale_pet_calls() from public,anon,authenticated;

create or replace function public.create_pet_call_idempotent(
  p_match_id uuid,
  p_caller_pet_id uuid,
  p_call_type public.pet_call_type,
  p_client_operation_id text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_match public.pet_matches;
  v_callee uuid;
  v_callee_owner uuid;
  v_caller_name text;
  v_call public.pet_call_sessions;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_caller_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  select * into v_match from public.pet_matches where id=p_match_id and unmatched_at is null for share;
  if v_match.id is null or p_caller_pet_id not in (v_match.pet_low_id,v_match.pet_high_id) then raise exception 'active_match_required'; end if;
  v_callee:=case when p_caller_pet_id=v_match.pet_low_id then v_match.pet_high_id else v_match.pet_low_id end;
  if public.is_blocked(p_caller_pet_id,v_callee) then raise exception 'blocked'; end if;
  if not exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id=v_callee and p.moderation_status='approved' and u.suspended_at is null and u.paused_at is null) then raise exception 'callee_unavailable'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('matchId',p_match_id,'callerPetId',p_caller_pet_id,'callType',p_call_type));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':pet_call:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='create_pet_call' and operation_id=v_op;
  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return v_receipt.result;
  end if;
  perform public.expire_stale_pet_calls();
  if exists(select 1 from public.pet_call_sessions c where c.match_id=p_match_id and c.status in ('ringing','active') and c.hard_expires_at>now()) then raise exception 'call_already_active'; end if;
  perform public.rate_limit('pet_call_start',12,3600);
  insert into public.pet_call_sessions(match_id,caller_pet_id,callee_pet_id,call_type,room_name)
  values(p_match_id,p_caller_pet_id,v_callee,p_call_type,'tailmance_call_'||gen_random_uuid()::text)
  returning * into v_call;
  select owner_id into v_callee_owner from public.pets where id=v_callee;
  select name into v_caller_name from public.pets where id=p_caller_pet_id;
  insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id,recipient_pet_id)
  values(v_callee_owner,'call','Incoming pet call','A matched pet is calling.',v_call.id,'pet_call:'||v_call.id,'incoming_pet_call',jsonb_build_object('callerPetId',p_caller_pet_id,'callerPetName',coalesce(v_caller_name,''),'callType',p_call_type::text),p_caller_pet_id,v_callee);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'create_pet_call',v_op,v_hash,jsonb_build_object('id',v_call.id,'matchId',p_match_id,'callerPetId',p_caller_pet_id,'calleePetId',v_callee,'callType',p_call_type,'status','ringing','createdAt',v_call.created_at,'ringExpiresAt',v_call.ring_expires_at));
  return jsonb_build_object('id',v_call.id,'matchId',p_match_id,'callerPetId',p_caller_pet_id,'calleePetId',v_callee,'callType',p_call_type,'status','ringing','createdAt',v_call.created_at,'ringExpiresAt',v_call.ring_expires_at);
end $$;
revoke all on function public.create_pet_call_idempotent(uuid,uuid,public.pet_call_type,text) from public,anon;
grant execute on function public.create_pet_call_idempotent(uuid,uuid,public.pet_call_type,text) to authenticated;

create or replace function public.respond_pet_call(p_call_id uuid,p_pet_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_call public.pet_call_sessions;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_call_id::text,0));
  perform public.expire_stale_pet_calls();
  select * into v_call from public.pet_call_sessions where id=p_call_id for update;
  if v_call.id is null or v_call.callee_pet_id<>p_pet_id then raise exception 'forbidden'; end if;
  if (p_accept and v_call.status='active') or ((not p_accept) and v_call.status='declined') then
    return jsonb_build_object('id',v_call.id,'matchId',v_call.match_id,'callerPetId',v_call.caller_pet_id,'calleePetId',v_call.callee_pet_id,'callType',v_call.call_type,'status',v_call.status,'createdAt',v_call.created_at,'answeredAt',v_call.answered_at);
  end if;
  if v_call.status<>'ringing' or v_call.ring_expires_at<=now() then raise exception 'call_unavailable'; end if;
  if public.is_blocked(v_call.caller_pet_id,v_call.callee_pet_id) or not exists(select 1 from public.pet_matches m where m.id=v_call.match_id and m.unmatched_at is null) then raise exception 'call_unavailable'; end if;
  update public.pet_call_sessions set status=case when p_accept then 'active'::public.pet_call_status else 'declined'::public.pet_call_status end,answered_at=case when p_accept then now() else null end,ended_at=case when p_accept then null else now() end where id=p_call_id returning * into v_call;
  return jsonb_build_object('id',v_call.id,'matchId',v_call.match_id,'callerPetId',v_call.caller_pet_id,'calleePetId',v_call.callee_pet_id,'callType',v_call.call_type,'status',v_call.status,'createdAt',v_call.created_at,'answeredAt',v_call.answered_at);
end $$;
revoke all on function public.respond_pet_call(uuid,uuid,boolean) from public,anon;
grant execute on function public.respond_pet_call(uuid,uuid,boolean) to authenticated;

create or replace function public.end_pet_call(p_call_id uuid,p_pet_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_call public.pet_call_sessions;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_call_id::text,0));
  select * into v_call from public.pet_call_sessions where id=p_call_id for update;
  if v_call.id is null or p_pet_id not in (v_call.caller_pet_id,v_call.callee_pet_id) then raise exception 'forbidden'; end if;
  if v_call.status in ('ringing','active') then update public.pet_call_sessions set status='ended',ended_at=now() where id=p_call_id; end if;
  return true;
end $$;
revoke all on function public.end_pet_call(uuid,uuid) from public,anon;
grant execute on function public.end_pet_call(uuid,uuid) to authenticated;

create or replace function public.get_incoming_pet_call(p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_call public.pet_call_sessions;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.expire_stale_pet_calls();
  select * into v_call from public.pet_call_sessions c where c.callee_pet_id=p_pet_id and c.status='ringing' and c.ring_expires_at>now() order by c.created_at desc limit 1;
  if v_call.id is null then return null; end if;
  if public.is_blocked(v_call.caller_pet_id,v_call.callee_pet_id) or not exists(select 1 from public.pet_matches m where m.id=v_call.match_id and m.unmatched_at is null) then return null; end if;
  return jsonb_build_object('id',v_call.id,'matchId',v_call.match_id,'callerPetId',v_call.caller_pet_id,'calleePetId',v_call.callee_pet_id,'callType',v_call.call_type,'status',v_call.status,'createdAt',v_call.created_at,'ringExpiresAt',v_call.ring_expires_at,'callerPet',public.pet_json(v_call.caller_pet_id,p_pet_id));
end $$;
revoke all on function public.get_incoming_pet_call(uuid) from public,anon;
grant execute on function public.get_incoming_pet_call(uuid) to authenticated;

create or replace function public.get_pet_call_token_context(p_call_id uuid,p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_call public.pet_call_sessions;v_pet public.pets;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.expire_stale_pet_calls();
  select * into v_call from public.pet_call_sessions where id=p_call_id;
  if v_call.id is null or p_pet_id not in (v_call.caller_pet_id,v_call.callee_pet_id) then raise exception 'forbidden'; end if;
  if v_call.hard_expires_at<=now() or v_call.status not in ('ringing','active') then raise exception 'call_unavailable'; end if;
  if p_pet_id=v_call.callee_pet_id and v_call.status<>'active' then raise exception 'call_not_accepted'; end if;
  if public.is_blocked(v_call.caller_pet_id,v_call.callee_pet_id) or not exists(select 1 from public.pet_matches m where m.id=v_call.match_id and m.unmatched_at is null) then raise exception 'call_unavailable'; end if;
  select * into v_pet from public.pets where id=p_pet_id and moderation_status='approved';
  if v_pet.id is null then raise exception 'pet_unavailable'; end if;
  return jsonb_build_object('callId',v_call.id,'roomName',v_call.room_name,'petId',p_pet_id,'petName',v_pet.name,'callType',v_call.call_type,'status',v_call.status,'hardExpiresAt',v_call.hard_expires_at);
end $$;
revoke all on function public.get_pet_call_token_context(uuid,uuid) from public,anon;
grant execute on function public.get_pet_call_token_context(uuid,uuid) to authenticated;


create or replace function public.get_pet_call_state(p_call_id uuid,p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_call public.pet_call_sessions;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.expire_stale_pet_calls();
  select * into v_call from public.pet_call_sessions where id=p_call_id;
  if v_call.id is null or p_pet_id not in (v_call.caller_pet_id,v_call.callee_pet_id) then raise exception 'forbidden'; end if;
  return jsonb_build_object('id',v_call.id,'matchId',v_call.match_id,'callerPetId',v_call.caller_pet_id,'calleePetId',v_call.callee_pet_id,'callType',v_call.call_type,'status',v_call.status,'createdAt',v_call.created_at,'answeredAt',v_call.answered_at,'endedAt',v_call.ended_at,'ringExpiresAt',v_call.ring_expires_at,'hardExpiresAt',v_call.hard_expires_at);
end $$;
revoke all on function public.get_pet_call_state(uuid,uuid) from public,anon;
grant execute on function public.get_pet_call_state(uuid,uuid) to authenticated;
