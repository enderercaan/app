-- Tailmance v19 R8: make the pre-contract purchase presentation write retry-safe.
-- A lost RPC response must not append duplicate immutable legal evidence. A later, genuinely new
-- purchase attempt uses a fresh client operation id and therefore records a fresh presentation.

create or replace function public.record_current_subscription_precontract_presentation_idempotent(
  p_bundle_id uuid,
  p_applicability_matrix_id uuid,
  p_ui_locale text,
  p_expected_document_set_sha256 text,
  p_store_platform text,
  p_store_product_id text,
  p_client_operation_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_product_id text:=trim(coalesce(p_store_product_id,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_result jsonb;
begin
  perform public.require_active_authenticated_session();
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;

  v_hash:=public.client_mutation_hash(jsonb_build_object(
    'bundleId',p_bundle_id,
    'applicabilityMatrixId',p_applicability_matrix_id,
    'uiLocale',trim(coalesce(p_ui_locale,'')),
    'documentSetSha256',coalesce(p_expected_document_set_sha256,''),
    'storePlatform',coalesce(p_store_platform,''),
    'storeProductId',v_product_id
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text||':subscription_precontract:'||v_op,0)
  );

  select * into v_receipt
  from public.client_mutation_receipts
  where user_id=auth.uid() and action='subscription_precontract' and operation_id=v_op;

  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return v_receipt.result;
  end if;

  v_result:=public.record_current_subscription_precontract_presentation(
    p_bundle_id,
    p_applicability_matrix_id,
    p_ui_locale,
    p_expected_document_set_sha256,
    p_store_platform,
    v_product_id
  );

  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'subscription_precontract',v_op,v_hash,v_result);
  return v_result;
end $$;

revoke all on function public.record_current_subscription_precontract_presentation_idempotent(uuid,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.record_current_subscription_precontract_presentation_idempotent(uuid,uuid,text,text,text,text,text) to authenticated;

-- Current clients must use the response-loss-safe wrapper. SECURITY DEFINER wrappers owned by the
-- database owner can still call the raw validated writer inside the same transaction.
revoke all on function public.record_current_subscription_precontract_presentation(uuid,uuid,text,text,text,text) from public,anon,authenticated;
