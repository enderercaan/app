-- Tailmance v19 R8: make signed RevenueCat consumable lifecycle handling
-- transaction-authoritative for the credited account.
--
-- RevenueCat may surface aliases/current App User IDs differently across the
-- lifetime of a store transaction. Once a consumable transaction has been
-- recorded, refunds/reversals must target the account already bound to that
-- transaction rather than trusting a later webhook's current app_user_id.

create or replace function public.resolve_consumable_transaction_owner(
  p_store_transaction_id text,
  p_provider_app_id text,
  p_provider_environment text,
  p_product_id text,
  p_credit_kind text,
  p_quantity integer
) returns uuid
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_state public.consumable_store_transaction_state%rowtype;
  v_transaction_id text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app_id text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_environment text:=upper(trim(coalesce(p_provider_environment,'')));
  v_product_id text:=nullif(trim(coalesce(p_product_id,'')),'');
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if v_transaction_id is null or char_length(v_transaction_id)>512
     or v_app_id is null or char_length(v_app_id)>240
     or v_environment not in ('PRODUCTION','SANDBOX')
     or v_product_id is null or char_length(v_product_id)>255
     or p_credit_kind not in ('boost','super_like')
     or p_quantity not between 1 and 1000 then
    raise exception 'invalid_consumable_transaction_lookup';
  end if;

  select * into v_state
  from public.consumable_store_transaction_state
  where provider_app_id=v_app_id
    and provider_environment=v_environment
    and store_transaction_id=v_transaction_id;

  if v_state.store_transaction_id is null then return null; end if;

  if v_state.store_product_id<>v_product_id
     or v_state.credit_kind<>p_credit_kind
     or v_state.quantity<>p_quantity then
    raise exception 'consumable_transaction_metadata_mismatch';
  end if;

  return v_state.user_id;
end $$;

revoke all on function public.resolve_consumable_transaction_owner(text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.resolve_consumable_transaction_owner(text,text,text,text,text,integer) to service_role;
