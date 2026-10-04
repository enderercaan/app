-- Tailmance v19 R8 ultra-deep audit: ambiguous network failures must not duplicate
-- user-created social side effects. Operation receipts are private, account-bound, and
-- bind one client operation id to one exact normalized request payload.

create table if not exists public.client_mutation_receipts (
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null,
  operation_id text not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,action,operation_id),
  constraint client_mutation_receipts_action_check check(char_length(action) between 1 and 80),
  constraint client_mutation_receipts_operation_check check(operation_id ~ '^[A-Za-z0-9_-]{16,96}$'),
  constraint client_mutation_receipts_hash_check check(request_hash ~ '^[0-9a-f]{64}$')
);
alter table public.client_mutation_receipts enable row level security;
revoke all on public.client_mutation_receipts from anon,authenticated;
create index if not exists idx_client_mutation_receipts_created_at on public.client_mutation_receipts(created_at);

create or replace function public.client_mutation_hash(p_payload jsonb)
returns text language sql immutable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(coalesce(p_payload,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function public.client_mutation_hash(jsonb) from public,anon,authenticated;

create or replace function public.undo_last_pass_idempotent(p_pet_id uuid,p_client_operation_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_op text:=trim(coalesce(p_client_operation_id,''));v_hash text;v_receipt public.client_mutation_receipts%rowtype;v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('petId',p_pet_id));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':undo_last_pass:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='undo_last_pass' and operation_id=v_op;
  if v_receipt.user_id is not null then if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if; return v_receipt.result; end if;
  v_result:=public.undo_last_pass(p_pet_id);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result) values(auth.uid(),'undo_last_pass',v_op,v_hash,v_result);
  return v_result;
end $$;
revoke all on function public.undo_last_pass_idempotent(uuid,text) from public,anon;
grant execute on function public.undo_last_pass_idempotent(uuid,text) to authenticated;

create or replace function public.create_comment_idempotent(p_pet_id uuid,p_post_id uuid,p_body text,p_client_operation_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_op text:=trim(coalesce(p_client_operation_id,''));v_body text:=trim(coalesce(p_body,''));v_hash text;v_receipt public.client_mutation_receipts%rowtype;v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('petId',p_pet_id,'postId',p_post_id,'body',v_body));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':create_comment:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='create_comment' and operation_id=v_op;
  if v_receipt.user_id is not null then if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if; return (v_receipt.result->>'id')::uuid; end if;
  v_id:=public.create_comment(p_pet_id,p_post_id,v_body);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result) values(auth.uid(),'create_comment',v_op,v_hash,jsonb_build_object('id',v_id));
  return v_id;
end $$;
revoke all on function public.create_comment_idempotent(uuid,uuid,text,text) from public,anon;
grant execute on function public.create_comment_idempotent(uuid,uuid,text,text) to authenticated;

create or replace function public.create_meetup_request_idempotent(
  p_match_id uuid,p_proposed_by_pet_id uuid,p_starts_at timestamptz,p_public_place_label text,p_note text,p_client_operation_id text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_op text:=trim(coalesce(p_client_operation_id,''));v_place text:=trim(coalesce(p_public_place_label,''));v_note text:=trim(coalesce(p_note,''));v_hash text;v_receipt public.client_mutation_receipts%rowtype;v_id uuid;
begin
  if not public.owns_pet(p_proposed_by_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('matchId',p_match_id,'petId',p_proposed_by_pet_id,'startsAt',p_starts_at,'place',v_place,'note',v_note));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':create_meetup:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='create_meetup' and operation_id=v_op;
  if v_receipt.user_id is not null then if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if; return (v_receipt.result->>'id')::uuid; end if;
  v_id:=public.create_meetup_request(p_match_id,p_proposed_by_pet_id,p_starts_at,v_place,nullif(v_note,''));
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result) values(auth.uid(),'create_meetup',v_op,v_hash,jsonb_build_object('id',v_id));
  return v_id;
end $$;
revoke all on function public.create_meetup_request_idempotent(uuid,uuid,timestamptz,text,text,text) from public,anon;
grant execute on function public.create_meetup_request_idempotent(uuid,uuid,timestamptz,text,text,text) to authenticated;

create or replace function public.create_community_event_idempotent(
  p_pet_id uuid,p_title text,p_description text,p_city text,p_district text,p_neighborhood text,p_starts_at timestamptz,p_ends_at timestamptz,p_capacity integer,p_event_kind text,p_recurrence text,p_client_operation_id text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_op text:=trim(coalesce(p_client_operation_id,''));v_title text:=trim(coalesce(p_title,''));v_description text:=trim(coalesce(p_description,''));v_city text:=trim(coalesce(p_city,''));v_district text:=trim(coalesce(p_district,''));v_neighborhood text:=trim(coalesce(p_neighborhood,''));v_hash text;v_receipt public.client_mutation_receipts%rowtype;v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('petId',p_pet_id,'title',v_title,'description',v_description,'city',v_city,'district',v_district,'neighborhood',v_neighborhood,'startsAt',p_starts_at,'endsAt',p_ends_at,'capacity',p_capacity,'kind',p_event_kind,'recurrence',p_recurrence));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':create_event:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='create_event' and operation_id=v_op;
  if v_receipt.user_id is not null then if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if; return (v_receipt.result->>'id')::uuid; end if;
  v_id:=public.create_community_event(p_pet_id,v_title,v_description,v_city,v_district,nullif(v_neighborhood,''),p_starts_at,p_ends_at,p_capacity,p_event_kind,p_recurrence);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result) values(auth.uid(),'create_event',v_op,v_hash,jsonb_build_object('id',v_id));
  return v_id;
end $$;
revoke all on function public.create_community_event_idempotent(uuid,text,text,text,text,text,timestamptz,timestamptz,integer,text,text,text) from public,anon;
grant execute on function public.create_community_event_idempotent(uuid,text,text,text,text,text,timestamptz,timestamptz,integer,text,text,text) to authenticated;

create or replace function public.create_lost_pet_alert_idempotent(p_pet_id uuid,p_last_seen_at timestamptz,p_radius_km numeric,p_client_operation_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_op text:=trim(coalesce(p_client_operation_id,''));v_radius numeric:=least(greatest(coalesce(p_radius_km,5),1),25);v_hash text;v_receipt public.client_mutation_receipts%rowtype;v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('petId',p_pet_id,'lastSeenAt',p_last_seen_at,'radiusKm',v_radius));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':lost_pet_alert:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='lost_pet_alert' and operation_id=v_op;
  if v_receipt.user_id is not null then if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if; return v_receipt.result; end if;
  v_result:=public.create_lost_pet_alert(p_pet_id,p_last_seen_at,v_radius);
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result) values(auth.uid(),'lost_pet_alert',v_op,v_hash,v_result);
  return v_result;
end $$;
revoke all on function public.create_lost_pet_alert_idempotent(uuid,timestamptz,numeric,text) from public,anon;
grant execute on function public.create_lost_pet_alert_idempotent(uuid,timestamptz,numeric,text) to authenticated;
