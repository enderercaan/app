-- Tailmance v19 R8 — pet-call current-access gate parity.
-- All user-callable call RPCs must remain behind the same revoked-session + current
-- legal/product access boundary as the rest of the product.  The v171 bodies are
-- preserved as private cores so their idempotency/locking semantics stay intact.

alter function public.create_pet_call_idempotent(uuid,uuid,public.pet_call_type,text)
  rename to create_pet_call_idempotent_core_v171;
alter function public.respond_pet_call(uuid,uuid,boolean)
  rename to respond_pet_call_core_v171;
alter function public.end_pet_call(uuid,uuid)
  rename to end_pet_call_core_v171;
alter function public.get_incoming_pet_call(uuid)
  rename to get_incoming_pet_call_core_v171;
alter function public.get_pet_call_token_context(uuid,uuid)
  rename to get_pet_call_token_context_core_v171;
alter function public.get_pet_call_state(uuid,uuid)
  rename to get_pet_call_state_core_v171;

revoke all on function public.create_pet_call_idempotent_core_v171(uuid,uuid,public.pet_call_type,text) from public,anon,authenticated;
revoke all on function public.respond_pet_call_core_v171(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.end_pet_call_core_v171(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_incoming_pet_call_core_v171(uuid) from public,anon,authenticated;
revoke all on function public.get_pet_call_token_context_core_v171(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_pet_call_state_core_v171(uuid,uuid) from public,anon,authenticated;

create or replace function public.create_pet_call_idempotent(
  p_match_id uuid,
  p_caller_pet_id uuid,
  p_call_type public.pet_call_type,
  p_client_operation_id text
) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  return public.create_pet_call_idempotent_core_v171(p_match_id,p_caller_pet_id,p_call_type,p_client_operation_id);
end $$;
revoke all on function public.create_pet_call_idempotent(uuid,uuid,public.pet_call_type,text) from public,anon;
grant execute on function public.create_pet_call_idempotent(uuid,uuid,public.pet_call_type,text) to authenticated;

create or replace function public.respond_pet_call(p_call_id uuid,p_pet_id uuid,p_accept boolean)
returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  return public.respond_pet_call_core_v171(p_call_id,p_pet_id,p_accept);
end $$;
revoke all on function public.respond_pet_call(uuid,uuid,boolean) from public,anon;
grant execute on function public.respond_pet_call(uuid,uuid,boolean) to authenticated;

create or replace function public.end_pet_call(p_call_id uuid,p_pet_id uuid)
returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  return public.end_pet_call_core_v171(p_call_id,p_pet_id);
end $$;
revoke all on function public.end_pet_call(uuid,uuid) from public,anon;
grant execute on function public.end_pet_call(uuid,uuid) to authenticated;

create or replace function public.get_incoming_pet_call(p_pet_id uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  return public.get_incoming_pet_call_core_v171(p_pet_id);
end $$;
revoke all on function public.get_incoming_pet_call(uuid) from public,anon;
grant execute on function public.get_incoming_pet_call(uuid) to authenticated;

create or replace function public.get_pet_call_token_context(p_call_id uuid,p_pet_id uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  return public.get_pet_call_token_context_core_v171(p_call_id,p_pet_id);
end $$;
revoke all on function public.get_pet_call_token_context(uuid,uuid) from public,anon;
grant execute on function public.get_pet_call_token_context(uuid,uuid) to authenticated;

create or replace function public.get_pet_call_state(p_call_id uuid,p_pet_id uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  return public.get_pet_call_state_core_v171(p_call_id,p_pet_id);
end $$;
revoke all on function public.get_pet_call_state(uuid,uuid) from public,anon;
grant execute on function public.get_pet_call_state(uuid,uuid) to authenticated;
