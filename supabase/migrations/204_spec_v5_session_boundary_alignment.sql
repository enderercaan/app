-- Tailmance migration 204: session/MFA revocation boundary for the spec v5.0 RPCs that do not go through
-- owns_pet (2026-10-25).
--
-- Found by scripts/auth-session-boundary-checks.mjs: every authenticated RPC must reach
-- require_active_authenticated_session (revoked session / MFA step-up) before it touches data.
-- * pet_handle_available and the four support-centre RPCs now call it first. Support stays reachable without
--   product access (billing or legal problems), but never from a revoked session.
-- * normalize_pet_handle is a pure helper used inside the database; clients no longer call it directly.

revoke all on function public.normalize_pet_handle(text) from public,anon,authenticated;
grant execute on function public.normalize_pet_handle(text) to service_role;

create or replace function public.pet_handle_available(p_handle text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v text:=public.normalize_pet_handle(p_handle);
begin
  perform public.require_active_authenticated_session();
  if v is null or v !~ '^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$' or v ~ '\.\.' then return false; end if;
  return not exists(select 1 from public.pets where handle=v);
end $$;
revoke all on function public.pet_handle_available(text) from public,anon;
grant execute on function public.pet_handle_available(text) to authenticated,service_role;

create or replace function public.create_support_ticket(p_category text,p_subject text,p_body text,p_client_operation_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_subject text:=trim(coalesce(p_subject,'')); v_body text:=trim(coalesce(p_body,'')); v_op text:=trim(coalesce(p_client_operation_id,''));
  v_hash text; v_receipt public.client_mutation_receipts%rowtype; v_id uuid; v_number text; v_result jsonb;
begin
  perform public.require_active_authenticated_session();
  if not exists(select 1 from public.users where id=auth.uid()) then raise exception 'authentication_required'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  if p_category not in ('account','billing','safety','bug','privacy','lost_pet','other') then raise exception 'invalid_support_category'; end if;
  if char_length(v_subject) not between 3 and 120 or char_length(v_body) not between 10 and 4000 then raise exception 'invalid_support_request'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('category',p_category,'subject',v_subject,'body',v_body));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':support_ticket:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='support_ticket' and operation_id=v_op;
  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return v_receipt.result;
  end if;
  perform public.rate_limit('support_ticket',10,86400);
  loop
    v_number:='TM-'||to_char(now() at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(encode(extensions.gen_random_bytes(3),'hex'),1,6));
    exit when not exists(select 1 from public.support_tickets where ticket_number=v_number);
  end loop;
  insert into public.support_tickets(ticket_number,user_id,category,subject) values(v_number,auth.uid(),p_category,v_subject) returning id into v_id;
  insert into public.support_ticket_messages(ticket_id,author,body) values(v_id,'user',v_body);
  v_result:=jsonb_build_object('id',v_id,'ticketNumber',v_number,'status','open');
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result) values(auth.uid(),'support_ticket',v_op,v_hash,v_result);
  insert into public.audit_events(user_id,action,entity_type,entity_id) values(auth.uid(),'support_ticket_created','support_ticket',v_id);
  return v_result;
end $$;
revoke all on function public.create_support_ticket(text,text,text,text) from public,anon;
grant execute on function public.create_support_ticket(text,text,text,text) to authenticated,service_role;

create or replace function public.get_my_support_tickets()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'ticketNumber',t.ticket_number,'category',t.category,'subject',t.subject,'status',t.status,
    'createdAt',t.created_at,'updatedAt',t.updated_at) order by t.updated_at desc) from public.support_tickets t where t.user_id=auth.uid()),'[]'::jsonb);
end $$;
revoke all on function public.get_my_support_tickets() from public,anon;
grant execute on function public.get_my_support_tickets() to authenticated,service_role;

create or replace function public.get_support_ticket(p_ticket_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.support_tickets;
begin
  perform public.require_active_authenticated_session();
  select * into t from public.support_tickets where id=p_ticket_id and user_id=auth.uid();
  if t.id is null then raise exception 'not_found'; end if;
  return jsonb_build_object('id',t.id,'ticketNumber',t.ticket_number,'category',t.category,'subject',t.subject,'status',t.status,'createdAt',t.created_at,'updatedAt',t.updated_at,
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author',m.author,'body',m.body,'createdAt',m.created_at) order by m.created_at)
      from public.support_ticket_messages m where m.ticket_id=t.id),'[]'::jsonb));
end $$;
revoke all on function public.get_support_ticket(uuid) from public,anon;
grant execute on function public.get_support_ticket(uuid) to authenticated,service_role;

create or replace function public.add_support_ticket_message(p_ticket_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.support_tickets; v_body text:=trim(coalesce(p_body,''));
begin
  perform public.require_active_authenticated_session();
  if char_length(v_body) not between 1 and 4000 then raise exception 'invalid_support_message'; end if;
  select * into t from public.support_tickets where id=p_ticket_id and user_id=auth.uid() for update;
  if t.id is null then raise exception 'not_found'; end if;
  if t.status='closed' then raise exception 'support_ticket_closed'; end if;
  perform public.rate_limit('support_ticket_message',60,86400);
  insert into public.support_ticket_messages(ticket_id,author,body) values(t.id,'user',v_body);
  update public.support_tickets set status=case when status in ('waiting_user','resolved') then 'open' else status end,updated_at=now() where id=t.id;
  return public.get_support_ticket(t.id);
end $$;
revoke all on function public.add_support_ticket_message(uuid,text) from public,anon;
grant execute on function public.add_support_ticket_message(uuid,text) to authenticated,service_role;
