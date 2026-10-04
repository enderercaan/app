-- Tailmance migration 199: executed-PostgreSQL runtime correctness repairs (2026-10-03).
--
-- The 001-198 chain was executed for the first time on a real PostgreSQL 16 + PostGIS 3.4 + pgvector server
-- (with a Supabase auth/storage/realtime emulation layer) and every PL/pgSQL function was analysed with
-- plpgsql_check. The functions below compiled but failed on EVERY call at runtime:
--   * consumable credit grant/refund/refund-reversal: text RevenueCat event id written into uuid audit column
--     (paid Boost/Super Like credits were never granted and the webhook retried forever);
--   * marketing push consent withdrawal: uuid::text written into uuid audit column (withdrawal impossible);
--   * get_product_feature_policy: jsonb_build_object with more than PostgreSQL's 100-argument limit;
--   * service_set_legal_jurisdiction_control_reviews: jsonb_object_length() does not exist in PostgreSQL;
--   * rerank_discovery_with_match_vectors: pgvector <=> unresolvable under search_path='' (schema-qualified);
--   * finalize_comment/message_moderation idempotent replay: enum compared with text.
-- Each body below is the exact current definition with only the defect corrected. Grants are preserved by
-- CREATE OR REPLACE and re-asserted explicitly.

-- apply_consumable_billing_webhook_event: audit entity_id is uuid; the provider event id is text and now lives in metadata.billingEventId.
CREATE OR REPLACE FUNCTION public.apply_consumable_billing_webhook_event(p_event_id text, p_claim_token uuid, p_user_id uuid, p_product_id text, p_credit_kind text, p_quantity integer, p_store_transaction_id text, p_provider_app_id text, p_provider_environment text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state public.consumable_store_transaction_state%rowtype;
  v_inserted integer:=0;
  v_debt integer:=0;
  v_offset integer:=0;
  v_transaction_id text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app_id text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_environment text:=upper(trim(coalesce(p_provider_environment,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_credit_kind not in ('boost','super_like') or p_quantity not between 1 and 1000 then raise exception 'invalid_consumable_grant'; end if;
  if p_user_id is null or char_length(trim(coalesce(p_product_id,'')))<1 then raise exception 'invalid_consumable_purchase'; end if;
  if v_transaction_id is null or char_length(v_transaction_id)>512 then raise exception 'consumable_transaction_id_required'; end if;
  if v_app_id is null or char_length(v_app_id)>240 then raise exception 'consumable_provider_app_id_required'; end if;
  if v_environment not in ('PRODUCTION','SANDBOX') then raise exception 'consumable_provider_environment_invalid'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;
  if cardinality(coalesce(v_row.user_ids,'{}'::uuid[]))<>1 or not (p_user_id=any(coalesce(v_row.user_ids,'{}'::uuid[]))) then
    raise exception 'consumable_claim_user_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_app_id||'|'||v_environment||'|'||v_transaction_id,1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select * into v_state from public.consumable_store_transaction_state
    where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id
    for update;

  if v_state.store_transaction_id is not null then
    if v_state.user_id<>p_user_id or v_state.store_product_id<>trim(p_product_id)
       or v_state.credit_kind<>p_credit_kind or v_state.quantity<>p_quantity then
      raise exception 'consumable_transaction_metadata_mismatch';
    end if;
    if v_state.state='refunded' then
      update public.consumable_store_transaction_state
      set granted_event_id=coalesce(granted_event_id,p_event_id),updated_at=now()
      where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id;
      update public.billing_webhook_events
      set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
      where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
      if not found then raise exception 'claim_lost_during_consumable_apply'; end if;
      return true;
    end if;
    if v_state.granted_event_id is not null then
      update public.billing_webhook_events
      set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
      where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
      if not found then raise exception 'claim_lost_during_consumable_apply'; end if;
      return true;
    end if;
    update public.consumable_store_transaction_state
    set granted_event_id=p_event_id,updated_at=now()
    where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id;
  else
    insert into public.consumable_store_transaction_state(
      provider_app_id,provider_environment,store_transaction_id,user_id,store_product_id,
      credit_kind,quantity,state,granted_event_id
    ) values(v_app_id,v_environment,v_transaction_id,p_user_id,trim(p_product_id),p_credit_kind,p_quantity,'active',p_event_id);
  end if;

  insert into public.consumable_credit_ledger(
    event_key,user_id,credit_kind,quantity,store_product_id,
    provider_app_id,provider_environment,store_transaction_id
  ) values(trim(p_event_id),p_user_id,p_credit_kind,p_quantity,trim(p_product_id),v_app_id,v_environment,v_transaction_id)
  on conflict do nothing;
  get diagnostics v_inserted=row_count;

  if v_inserted=1 then
    insert into public.consumable_balances(user_id) values(p_user_id) on conflict(user_id) do nothing;
    select case when p_credit_kind='boost' then boost_credit_debt else super_like_credit_debt end
      into v_debt from public.consumable_balances where user_id=p_user_id for update;
    v_offset:=least(coalesce(v_debt,0),p_quantity);
    update public.consumable_balances set
      boost_credit_debt=boost_credit_debt-case when p_credit_kind='boost' then v_offset else 0 end,
      super_like_credit_debt=super_like_credit_debt-case when p_credit_kind='super_like' then v_offset else 0 end,
      boost_credits=boost_credits+case when p_credit_kind='boost' then p_quantity-v_offset else 0 end,
      super_like_credits=super_like_credits+case when p_credit_kind='super_like' then p_quantity-v_offset else 0 end,
      updated_at=now()
    where user_id=p_user_id;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(p_user_id,'consumable_credit_granted','billing_webhook',null,
      jsonb_build_object('billingEventId',p_event_id,'productId',p_product_id,'creditKind',p_credit_kind,'quantity',p_quantity,
        'debtOffset',v_offset,'providerAppId',v_app_id,'providerEnvironment',v_environment,
        'storeTransactionIdPresent',true));
  end if;

  update public.billing_webhook_events
  set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
  if not found then raise exception 'claim_lost_during_consumable_apply'; end if;
  return true;
end $function$;
revoke all on function public.apply_consumable_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_consumable_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) to service_role;

-- apply_consumable_refund_billing_webhook_event: audit entity_id is uuid; the provider event id is text and now lives in metadata.billingEventId.
CREATE OR REPLACE FUNCTION public.apply_consumable_refund_billing_webhook_event(p_event_id text, p_claim_token uuid, p_user_id uuid, p_product_id text, p_credit_kind text, p_quantity integer, p_store_transaction_id text, p_provider_app_id text, p_provider_environment text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state public.consumable_store_transaction_state%rowtype;
  v_available integer:=0;
  v_take integer:=0;
  v_should_debit boolean:=false;
  v_transaction_id text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app_id text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_environment text:=upper(trim(coalesce(p_provider_environment,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_credit_kind not in ('boost','super_like') or p_quantity not between 1 and 1000 then raise exception 'invalid_consumable_refund'; end if;
  if p_user_id is null or char_length(trim(coalesce(p_product_id,'')))<1 or v_transaction_id is null or v_app_id is null
     or v_environment not in ('PRODUCTION','SANDBOX') then raise exception 'invalid_consumable_refund'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;
  if cardinality(coalesce(v_row.user_ids,'{}'::uuid[]))<>1 or not (p_user_id=any(coalesce(v_row.user_ids,'{}'::uuid[]))) then raise exception 'consumable_claim_user_mismatch'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_app_id||'|'||v_environment||'|'||v_transaction_id,1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select * into v_state from public.consumable_store_transaction_state
    where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id
    for update;

  if v_state.store_transaction_id is null then
    insert into public.consumable_store_transaction_state(
      provider_app_id,provider_environment,store_transaction_id,user_id,store_product_id,
      credit_kind,quantity,state,refund_event_id
    ) values(v_app_id,v_environment,v_transaction_id,p_user_id,trim(p_product_id),p_credit_kind,p_quantity,'refunded',p_event_id);
  else
    if v_state.user_id<>p_user_id or v_state.store_product_id<>trim(p_product_id)
       or v_state.credit_kind<>p_credit_kind or v_state.quantity<>p_quantity then raise exception 'consumable_transaction_metadata_mismatch'; end if;
    if v_state.state='active' then
      v_should_debit:=v_state.granted_event_id is not null;
      update public.consumable_store_transaction_state set state='refunded',refund_event_id=p_event_id,reversal_event_id=null,updated_at=now()
      where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id;
    end if;
  end if;

  if v_should_debit then
    insert into public.consumable_balances(user_id) values(p_user_id) on conflict(user_id) do nothing;
    select case when p_credit_kind='boost' then boost_credits else super_like_credits end
      into v_available from public.consumable_balances where user_id=p_user_id for update;
    v_take:=least(coalesce(v_available,0),p_quantity);
    update public.consumable_balances set
      boost_credits=boost_credits-case when p_credit_kind='boost' then v_take else 0 end,
      super_like_credits=super_like_credits-case when p_credit_kind='super_like' then v_take else 0 end,
      boost_credit_debt=boost_credit_debt+case when p_credit_kind='boost' then p_quantity-v_take else 0 end,
      super_like_credit_debt=super_like_credit_debt+case when p_credit_kind='super_like' then p_quantity-v_take else 0 end,
      updated_at=now()
    where user_id=p_user_id;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(p_user_id,'consumable_credit_refunded','billing_webhook',null,
      jsonb_build_object('billingEventId',p_event_id,'productId',p_product_id,'creditKind',p_credit_kind,'quantity',p_quantity,
        'availableCreditsRemoved',v_take,'refundDebtAdded',p_quantity-v_take,
        'providerAppId',v_app_id,'providerEnvironment',v_environment));
  end if;

  update public.billing_webhook_events
  set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
  if not found then raise exception 'claim_lost_during_consumable_refund'; end if;
  return true;
end $function$;
revoke all on function public.apply_consumable_refund_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_consumable_refund_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) to service_role;

-- apply_consumable_refund_reversal_billing_webhook_event: audit entity_id is uuid; the provider event id is text and now lives in metadata.billingEventId.
CREATE OR REPLACE FUNCTION public.apply_consumable_refund_reversal_billing_webhook_event(p_event_id text, p_claim_token uuid, p_user_id uuid, p_product_id text, p_credit_kind text, p_quantity integer, p_store_transaction_id text, p_provider_app_id text, p_provider_environment text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.billing_webhook_events%rowtype;
  v_state public.consumable_store_transaction_state%rowtype;
  v_debt integer:=0;
  v_offset integer:=0;
  v_should_credit boolean:=false;
  v_transaction_id text:=nullif(trim(coalesce(p_store_transaction_id,'')),'');
  v_app_id text:=nullif(trim(coalesce(p_provider_app_id,'')),'');
  v_environment text:=upper(trim(coalesce(p_provider_environment,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_credit_kind not in ('boost','super_like') or p_quantity not between 1 and 1000 then raise exception 'invalid_consumable_refund_reversal'; end if;
  if p_user_id is null or char_length(trim(coalesce(p_product_id,'')))<1 or v_transaction_id is null or v_app_id is null
     or v_environment not in ('PRODUCTION','SANDBOX') then raise exception 'invalid_consumable_refund_reversal'; end if;

  select * into v_row from public.billing_webhook_events where event_id=p_event_id for update;
  if v_row.event_id is null or v_row.status<>'processing' or v_row.claim_token is distinct from p_claim_token then return false; end if;
  if cardinality(coalesce(v_row.user_ids,'{}'::uuid[]))<>1 or not (p_user_id=any(coalesce(v_row.user_ids,'{}'::uuid[]))) then raise exception 'consumable_claim_user_mismatch'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_app_id||'|'||v_environment||'|'||v_transaction_id,1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select * into v_state from public.consumable_store_transaction_state
    where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id
    for update;

  if v_state.store_transaction_id is null then
    insert into public.consumable_store_transaction_state(
      provider_app_id,provider_environment,store_transaction_id,user_id,store_product_id,
      credit_kind,quantity,state,granted_event_id,reversal_event_id
    ) values(v_app_id,v_environment,v_transaction_id,p_user_id,trim(p_product_id),p_credit_kind,p_quantity,'active',p_event_id,p_event_id);
    v_should_credit:=true;
  else
    if v_state.user_id<>p_user_id or v_state.store_product_id<>trim(p_product_id)
       or v_state.credit_kind<>p_credit_kind or v_state.quantity<>p_quantity then raise exception 'consumable_transaction_metadata_mismatch'; end if;
    if v_state.state='refunded' then
      update public.consumable_store_transaction_state
      set state='active',granted_event_id=coalesce(granted_event_id,p_event_id),reversal_event_id=p_event_id,updated_at=now()
      where provider_app_id=v_app_id and provider_environment=v_environment and store_transaction_id=v_transaction_id;
      v_should_credit:=true;
    end if;
  end if;

  if v_should_credit then
    insert into public.consumable_credit_ledger(
      event_key,user_id,credit_kind,quantity,store_product_id,
      provider_app_id,provider_environment,store_transaction_id
    ) values(trim(p_event_id),p_user_id,p_credit_kind,p_quantity,trim(p_product_id),v_app_id,v_environment,v_transaction_id)
    on conflict do nothing;
    insert into public.consumable_balances(user_id) values(p_user_id) on conflict(user_id) do nothing;
    select case when p_credit_kind='boost' then boost_credit_debt else super_like_credit_debt end
      into v_debt from public.consumable_balances where user_id=p_user_id for update;
    v_offset:=least(coalesce(v_debt,0),p_quantity);
    update public.consumable_balances set
      boost_credit_debt=boost_credit_debt-case when p_credit_kind='boost' then v_offset else 0 end,
      super_like_credit_debt=super_like_credit_debt-case when p_credit_kind='super_like' then v_offset else 0 end,
      boost_credits=boost_credits+case when p_credit_kind='boost' then p_quantity-v_offset else 0 end,
      super_like_credits=super_like_credits+case when p_credit_kind='super_like' then p_quantity-v_offset else 0 end,
      updated_at=now()
    where user_id=p_user_id;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(p_user_id,'consumable_refund_reversed','billing_webhook',null,
      jsonb_build_object('billingEventId',p_event_id,'productId',p_product_id,'creditKind',p_credit_kind,'quantity',p_quantity,
        'debtOffset',v_offset,'providerAppId',v_app_id,'providerEnvironment',v_environment));
  end if;

  update public.billing_webhook_events
  set status='processed',processed_at=coalesce(processed_at,now()),last_error=null,claim_token=null,claimed_at=null
  where event_id=p_event_id and status='processing' and claim_token=p_claim_token;
  if not found then raise exception 'claim_lost_during_consumable_refund_reversal'; end if;
  return true;
end $function$;
revoke all on function public.apply_consumable_refund_reversal_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_consumable_refund_reversal_billing_webhook_event(text,uuid,uuid,text,text,integer,text,text,text) to service_role;

-- set_marketing_push_consent: withdrawal audit row wrote a bigint event id (as text) into the uuid entity_id column, so consent withdrawal always failed; the id stays in metadata.withdrawnFromEventId.
CREATE OR REPLACE FUNCTION public.set_marketing_push_consent(p_granted boolean, p_consent_version text, p_locale text DEFAULT NULL::text, p_country_code text DEFAULT NULL::text, p_presented_consent_document_set_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid:=auth.uid();
  v_locale text:=trim(coalesce(p_locale,''));
  v_bundle_id uuid;
  v_bundle public.legal_document_bundles;
  v_runtime public.legal_country_runtime;
  v_last public.marketing_consent_events;
  v_preferences jsonb;
  v_user_preferences jsonb;
  v_current_consent_document_set_sha256 text;
  v_current_overlay_document_set_sha256 text;
begin
  perform public.require_active_authenticated_session();
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_granted is null then raise exception 'invalid_consent_value'; end if;

  if p_granted=false then
    -- Withdrawal remains unconditional with respect to the current legal bundle. Serialize on the
    -- account row so concurrent/replayed withdrawals cannot append duplicate immutable evidence.
    select coalesce(u.notification_preferences,'{}'::jsonb)
      into v_user_preferences
      from public.users u
      where u.id=v_user_id
      for update;
    if not found then raise exception 'account_unavailable'; end if;

    select * into v_last
      from public.marketing_consent_events e
      where e.user_id=v_user_id and e.channel='push' and e.purpose='marketing_product_updates'
      order by e.created_at desc,e.id desc
      limit 1;

    if not found or v_last.granted=false then
      if coalesce((v_user_preferences->>'marketing')::boolean,false) then
        update public.users
          set notification_preferences=jsonb_set(v_user_preferences,'{marketing}','false'::jsonb,true),updated_at=now()
          where id=v_user_id
          returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb))
          into v_preferences;
      else
        v_preferences:='{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || v_user_preferences;
      end if;
      return jsonb_build_object('ok',true,'granted',false,'idempotent',true,'channel','push','purpose','marketing_product_updates',
        'consentVersion',case when v_last.id is null then null else v_last.consent_version end,
        'bundleId',case when v_last.id is null then null else v_last.bundle_id end,
        'legalCountryCode',case when v_last.id is null then null else v_last.country_code end,
        'uiLocale',case when v_last.id is null then null else v_last.locale end,
        'documentLocale',case when v_last.id is null then null else v_last.document_locale end,
        'consentDocumentSetSha256',case when v_last.id is null then null else v_last.consent_document_set_sha256 end,
        'notificationPreferences',v_preferences);
    end if;

    perform public.rate_limit('marketing_push_consent',20,3600);
    insert into public.marketing_consent_events(
      user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,
      consent_text_sha256,legal_subnational_code,applicability_matrix_id,consent_document_set_sha256
    ) values(
      v_user_id,'push','marketing_product_updates',v_last.consent_version,false,v_last.locale,v_last.country_code,
      'settings_withdrawal_original_context',v_last.bundle_id,v_last.document_locale,v_last.consent_text_sha256,v_last.legal_subnational_code,
      v_last.applicability_matrix_id,v_last.consent_document_set_sha256
    );
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
      values(v_user_id,'marketing_push_consent_withdrawn','marketing_consent_event',null,
        jsonb_build_object('channel','push','purpose','marketing_product_updates','withdrawnFromEventId',v_last.id,
          'bundleId',v_last.bundle_id,'consentVersion',v_last.consent_version,'consentTextSha256',v_last.consent_text_sha256,
          'consentDocumentSetSha256',v_last.consent_document_set_sha256,'applicabilityMatrixId',v_last.applicability_matrix_id,
          'legalCountry',v_last.country_code,'legalSubnational',v_last.legal_subnational_code,'uiLocale',v_last.locale,'documentLocale',v_last.document_locale));
    update public.users
      set notification_preferences=jsonb_set(v_user_preferences,'{marketing}','false'::jsonb,true),updated_at=now()
      where id=v_user_id
      returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb))
      into v_preferences;
    return jsonb_build_object('ok',true,'granted',false,'idempotent',false,'channel','push','purpose','marketing_product_updates',
      'consentVersion',v_last.consent_version,'bundleId',v_last.bundle_id,'legalCountryCode',v_last.country_code,
      'uiLocale',v_last.locale,'documentLocale',v_last.document_locale,'consentDocumentSetSha256',v_last.consent_document_set_sha256,
      'notificationPreferences',v_preferences);
  end if;

  if char_length(v_locale) not between 2 and 16 then raise exception 'invalid_locale'; end if;

  -- Match the global legal-runtime lock ordering used by service legal-country mutation paths.
  -- Grant retries serialize here first, then lock the account preference row below.
  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id for update;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.current_applicability_matrix_id is null then raise exception 'legal_context_unresolved'; end if;
  if not public.legal_applicability_matrix_satisfied(v_user_id) then raise exception 'legal_applicability_review_incomplete'; end if;
  if p_country_code is not null and upper(trim(p_country_code))<>v_runtime.legal_country_code then raise exception 'client_country_mismatch'; end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then raise exception 'legal_bundle_not_current_for_context'; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  if not found then raise exception 'legal_bundle_not_current_for_context'; end if;
  if p_consent_version is distinct from v_bundle.marketing_push_consent_version then raise exception 'outdated_marketing_consent_version'; end if;
  v_current_overlay_document_set_sha256:=public.current_legal_overlay_document_set_sha256(v_user_id,v_bundle_id);
  if v_current_overlay_document_set_sha256 is null or v_current_overlay_document_set_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'legal_overlay_document_set_unavailable'; end if;
  if not exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id
      and a.applicability_matrix_id=v_runtime.current_applicability_matrix_id and a.overlay_document_set_sha256=v_current_overlay_document_set_sha256) then
    raise exception 'current_legal_acceptance_required';
  end if;
  if not public.legal_overlay_document_actions_complete(v_user_id,v_bundle_id) then raise exception 'current_overlay_legal_actions_required_before_marketing_consent'; end if;
  if not public.marketing_consent_overlay_documents_complete(v_user_id,v_bundle_id) then raise exception 'marketing_consent_overlay_documents_incomplete'; end if;
  v_current_consent_document_set_sha256:=public.current_marketing_consent_document_set_sha256(v_user_id,v_bundle_id);
  if v_current_consent_document_set_sha256 is null or v_current_consent_document_set_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'marketing_consent_document_set_unavailable'; end if;
  if p_presented_consent_document_set_sha256 is null or p_presented_consent_document_set_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'presented_marketing_document_set_hash_required'; end if;
  if p_presented_consent_document_set_sha256<>v_current_consent_document_set_sha256 then raise exception 'marketing_document_set_changed'; end if;

  select coalesce(u.notification_preferences,'{}'::jsonb)
    into v_user_preferences from public.users u where u.id=v_user_id for update;
  if not found then raise exception 'account_unavailable'; end if;

  select * into v_last from public.marketing_consent_events e
    where e.user_id=v_user_id
      and e.bundle_id=v_bundle_id
      and e.applicability_matrix_id=v_runtime.current_applicability_matrix_id
      and e.channel='push'
      and e.purpose='marketing_product_updates'
    order by e.created_at desc,e.id desc limit 1;

  if found and v_last.granted=true
      and v_last.consent_version is not distinct from v_bundle.marketing_push_consent_version
      and v_last.consent_text_sha256 is not distinct from v_bundle.marketing_push_consent_sha256
      and v_last.consent_document_set_sha256 is not distinct from v_current_consent_document_set_sha256
      and v_last.country_code is not distinct from v_bundle.legal_country_code
      and v_last.legal_subnational_code is not distinct from v_bundle.legal_subnational_code
      and v_last.locale is not distinct from v_bundle.ui_locale
      and v_last.document_locale is not distinct from v_bundle.document_locale then
    if not coalesce((v_user_preferences->>'marketing')::boolean,false) then
      update public.users
        set notification_preferences=jsonb_set(v_user_preferences,'{marketing}','true'::jsonb,true),updated_at=now()
        where id=v_user_id
        returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;
    else
      v_preferences:='{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || v_user_preferences;
    end if;
    return jsonb_build_object('ok',true,'granted',true,'idempotent',true,'channel','push','purpose','marketing_product_updates',
      'consentVersion',v_bundle.marketing_push_consent_version,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
      'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'consentDocumentSetSha256',v_current_consent_document_set_sha256,
      'notificationPreferences',v_preferences);
  end if;

  perform public.rate_limit('marketing_push_consent',20,3600);
  insert into public.marketing_consent_events(
    user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,consent_text_sha256,
    legal_subnational_code,applicability_matrix_id,consent_document_set_sha256
  ) values(
    v_user_id,'push','marketing_product_updates',v_bundle.marketing_push_consent_version,true,v_bundle.ui_locale,v_bundle.legal_country_code,
    'settings_immutable_bundle_exact_document_set',v_bundle.bundle_id,v_bundle.document_locale,v_bundle.marketing_push_consent_sha256,
    v_bundle.legal_subnational_code,v_runtime.current_applicability_matrix_id,v_current_consent_document_set_sha256
  );
  update public.users
    set notification_preferences=jsonb_set(v_user_preferences,'{marketing}','true'::jsonb,true),updated_at=now()
    where id=v_user_id
    returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(v_user_id,'marketing_push_consent_granted','legal_document_bundle',v_bundle.bundle_id,
      jsonb_build_object('channel','push','purpose','marketing_product_updates','bundleId',v_bundle.bundle_id,
        'consentVersion',v_bundle.marketing_push_consent_version,'consentTextSha256',v_bundle.marketing_push_consent_sha256,
        'consentDocumentSetSha256',v_current_consent_document_set_sha256,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,
        'legalCountry',v_bundle.legal_country_code,'legalSubnational',v_bundle.legal_subnational_code,
        'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale));
  return jsonb_build_object('ok',true,'granted',true,'idempotent',false,'channel','push','purpose','marketing_product_updates',
    'consentVersion',v_bundle.marketing_push_consent_version,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'consentDocumentSetSha256',v_current_consent_document_set_sha256,
    'notificationPreferences',v_preferences);
end $function$;
revoke all on function public.set_marketing_push_consent(boolean,text,text,text,text) from public,anon;
grant execute on function public.set_marketing_push_consent(boolean,text,text,text,text) to authenticated;

-- get_product_feature_policy: 128 arguments exceeded PostgreSQL's 100-argument function limit; built from 2 merged objects.
CREATE OR REPLACE FUNCTION public.get_product_feature_policy()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_swipe_limit integer:=50;
  v_conversation_limit integer:=3;
begin
  perform public.require_active_authenticated_session();
  select c.standard_daily_swipe_limit,c.standard_daily_new_conversation_limit
    into v_swipe_limit,v_conversation_limit
    from public.app_runtime_config c where c.singleton=true;
  v_swipe_limit:=coalesce(v_swipe_limit,50);
  v_conversation_limit:=coalesce(v_conversation_limit,3);
  return jsonb_build_object(
      'matingOwnerArrangedEnabled',public.current_mating_feature_enabled(),
      'matingOwnerDecisionOnly',true,
      'matingBrokerageEnabled',false,
      'matingTransactionEnabled',false,
      'matingCommerceEnabled',false,
      'petSalesEnabled',false,
      'commercialBreedingEnabled',false,
      'petCommerceMarketplaceEnabled',false,
      'adoptionMarketplaceEnabled',false,
      'dataSaleEnabled',false,
      'dataSalesEnabled',false,
      'aggressiveAdsEnabled',false,
      'catsInDiscovery',false,
      'catsFeedOnly',true,
      'dogDiscoveryOnly',true,
      'localFeedDefault',true,
      'premiumEventCreation',true,
      'lostPetAlertsFree',true,
      'safetyFeaturesFree',true,
      'multiplePetsPremium',true,
      'advancedFiltersPremium',true,
      'travelModePremium',true,
      'boostsEnabled',true,
      'consumablePacksEnabled',true,
      'contextualAdsOnly',true,
      'premiumMultiplePets',true,
      'premiumAdvancedFilters',true,
      'premiumTravelMode',true,
      'premiumUnlimitedLikes',true,
      'premiumLikesYou',true,
      'premiumIncognito',true,
      'premiumEventHosting',true,
      'standardPremiumReplyCourtesy',true,
      'consumableBoosts',true,
      'consumableSuperLikes',true,
      'standardDailySwipeLimit',v_swipe_limit,
      'standardDailyNewConversationLimit',v_conversation_limit,
      'dailyQuotaUsesLocalMidnight',true,
      'contextualBusinessPromotionsOnly',true,
      'contextualBusinessPromotionsEnabled',public.current_paid_promotion_visibility_enabled()
    ) ||
    jsonb_build_object(
      'regionalBilling',public.current_regional_billing_policy(),
      'nativeStoreBillingDefault',true,
      'revenueCatEntitlement','tailmance_premium',
      'revenueCatPackage','premium_access',
      'petFirstNoHumanDating',true,
      'petFriendlyPlacesEnabled',true,
      'lostPetProximityAlertsEnabled',true,
      'safeMeetupSharingEnabled',true,
      'healthTrackingEnabled',true,
      'aiVeterinaryDiagnosisEnabled',false,
      'socialShareEnabled',true,
      'socialShareBranding','Tailmance',
      'pilotCity','Istanbul',
      'pilotNeighborhoods',jsonb_build_array('Moda','Fenerbahçe','Caddebostan'),
      'localDensityTargetMin',300,
      'localDensityTargetMax',500,
      'referralMilestone',40,
      'consumerPriceReviewCadenceDays',90,
      'consumerPriceAuthority','store_localized',
      'businessPartnerMonthlyPlans',true,
      'eventTicketCommissionAttribution',true,
      'insuranceAffiliateEnabled',false,
      'commerceAffiliateEnabled',false,
      'sitterMarketplaceEnabled',false
    );
end $function$;
revoke all on function public.get_product_feature_policy() from public,anon;
grant execute on function public.get_product_feature_policy() to authenticated;

-- service_set_legal_jurisdiction_control_reviews: jsonb_object_length() is not a PostgreSQL function.
CREATE OR REPLACE FUNCTION public.service_set_legal_jurisdiction_control_reviews(p_country_code text, p_control_reviews jsonb, p_updated_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_country text:=upper(trim(coalesce(p_country_code,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_country_code'; end if;
  if not exists(select 1 from public.legal_jurisdiction_policies where legal_country_code=v_country) then raise exception 'unlisted_country_blocked'; end if;
  if nullif(trim(coalesce(p_updated_by,'')),'') is null or char_length(trim(p_updated_by))>160 then raise exception 'invalid_updated_by'; end if;
  if not public.legal_control_reviews_complete(p_control_reviews) then raise exception 'jurisdiction_topic_control_reviews_incomplete'; end if;
  update public.legal_jurisdiction_policies
    set control_reviews=p_control_reviews,updated_by=trim(p_updated_by),updated_at=now()
    where legal_country_code=v_country;
  return jsonb_build_object('ok',true,'legalCountryCode',v_country,'controlReviewCount',(select count(*) from jsonb_object_keys(p_control_reviews)));
end $function$;
revoke all on function public.service_set_legal_jurisdiction_control_reviews(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.service_set_legal_jurisdiction_control_reviews(text,jsonb,text) to service_role;

-- rerank_discovery_with_match_vectors: search_path='' cannot resolve the pgvector <=> operator; schema-qualify it (1x).
CREATE OR REPLACE FUNCTION public.rerank_discovery_with_match_vectors(p_active_pet_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_query extensions.vector; v_result jsonb;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  v_query:=public.compute_pet_match_embedding(p_active_pet_id,true);
  with items as (
    select x.item,x.ord,(x.item->>'id')::uuid as pet_id,
      coalesce((x.item->>'boosted')::boolean,false) as boosted,
      greatest(0,least(100,coalesce((x.item->>'compatibilityScore')::numeric,0))) as base_score
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality x(item,ord)
  ), scored as (
    select i.*,
      case when e.embedding is null then null
           else greatest(0::numeric,least(1::numeric,(1-(e.embedding operator(extensions.<=>) v_query))::numeric)) end as vector_similarity
    from items i left join public.pet_match_embeddings e on e.pet_id=i.pet_id
  ), blended as (
    select s.*,
      case when s.vector_similarity is null then round(s.base_score)::int
           else round((s.base_score*0.70)+(s.vector_similarity*100*0.30))::int end as hybrid_score
    from scored s
  )
  select coalesce(jsonb_agg(
    (b.item||jsonb_build_object(
      'compatibilityScore',greatest(0,least(100,b.hybrid_score)),
      'compatibilityModel',case when b.vector_similarity is null then 'rules-v1' else 'rules-pgvector-v1' end
    ))
    order by b.boosted desc,b.hybrid_score desc,b.ord
  ),'[]'::jsonb) into v_result from blended b;
  return v_result;
end $function$;
revoke all on function public.rerank_discovery_with_match_vectors(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rerank_discovery_with_match_vectors(uuid,jsonb) to service_role;

-- finalize_comment_moderation: idempotent replay compared public.moderation_state with text.
CREATE OR REPLACE FUNCTION public.finalize_comment_moderation(p_item_id uuid, p_status text, p_provider text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_score jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item public.moderation_items%rowtype;
  v_comment public.comments%rowtype;
  v_comment_owner uuid;
  v_post_owner uuid;
  v_post_pet uuid;
  v_post_status public.moderation_state;
  v_post_deleted timestamptz;
  v_commenter_paused timestamptz;
  v_commenter_suspended timestamptz;
  v_post_owner_paused timestamptz;
  v_post_owner_suspended timestamptz;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('approved','rejected') then raise exception 'invalid_moderation_status'; end if;
  if p_reason is not null and char_length(p_reason)>500 then raise exception 'reason_too_long'; end if;
  if jsonb_typeof(coalesce(p_score,'{}'::jsonb))<>'object' or pg_column_size(coalesce(p_score,'{}'::jsonb))>8192 then raise exception 'invalid_score'; end if;

  select * into v_item from public.moderation_items where id=p_item_id for update;
  if v_item.id is null or v_item.target_type<>'comment_text' then raise exception 'moderation_item_not_found'; end if;
  if v_item.status in ('approved','rejected') then return v_item.status::text=p_status; end if;

  select * into v_comment from public.comments where id=v_item.target_id for update;
  if v_comment.id is null then
    delete from public.moderation_items where id=v_item.id;
    return false;
  end if;

  update public.moderation_items
  set status=p_status::public.moderation_state,
      provider=left(nullif(trim(coalesce(p_provider,'')),''),120),
      reason=left(nullif(trim(coalesce(p_reason,'')),''),500),
      score=coalesce(p_score,'{}'::jsonb),
      reviewed_at=now(),next_attempt_at=null
  where id=v_item.id;

  update public.comments set moderation_status=p_status::public.moderation_state where id=v_comment.id;

  if p_status='approved' and v_comment.deleted_at is null then
    select cp.owner_id,cu.paused_at,cu.suspended_at,
           pp.owner_id,po.pet_id,po.moderation_status,po.deleted_at,pu.paused_at,pu.suspended_at
    into v_comment_owner,v_commenter_paused,v_commenter_suspended,
         v_post_owner,v_post_pet,v_post_status,v_post_deleted,v_post_owner_paused,v_post_owner_suspended
    from public.pets cp
    join public.users cu on cu.id=cp.owner_id
    join public.posts po on po.id=v_comment.post_id
    join public.pets pp on pp.id=po.pet_id
    join public.users pu on pu.id=pp.owner_id
    where cp.id=v_comment.pet_id;

    if v_post_owner is not null
       and v_comment_owner<>v_post_owner
       and v_commenter_paused is null and v_commenter_suspended is null
       and v_post_owner_paused is null and v_post_owner_suspended is null
       and v_post_deleted is null and v_post_status='approved'
       and not public.is_blocked(v_comment.pet_id,v_post_pet) then
      insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id)
      values(v_post_owner,'comment','New comment','A pet commented on your post.',v_comment.id,
             format('comment:%s',v_comment.id),'comment','{}'::jsonb,v_comment.pet_id)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;
  return true;
end;
$function$;
revoke all on function public.finalize_comment_moderation(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_comment_moderation(uuid,text,text,text,jsonb) to service_role;

-- finalize_message_moderation: idempotent replay compared public.moderation_state with text.
CREATE OR REPLACE FUNCTION public.finalize_message_moderation(p_item_id uuid, p_status text, p_provider text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_score jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item public.moderation_items%rowtype;
  v_msg public.messages%rowtype;
  v_match public.pet_matches%rowtype;
  v_sender_owner uuid;
  v_recipient_pet uuid;
  v_recipient_owner uuid;
  v_sender_paused timestamptz;
  v_sender_suspended timestamptz;
  v_recipient_paused timestamptz;
  v_recipient_suspended timestamptz;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('approved','rejected') then raise exception 'invalid_moderation_status'; end if;
  if p_reason is not null and char_length(p_reason)>500 then raise exception 'reason_too_long'; end if;
  if jsonb_typeof(coalesce(p_score,'{}'::jsonb))<>'object' or pg_column_size(coalesce(p_score,'{}'::jsonb))>8192 then raise exception 'invalid_score'; end if;

  select * into v_item from public.moderation_items where id=p_item_id for update;
  if v_item.id is null or v_item.target_type<>'message_text' then raise exception 'moderation_item_not_found'; end if;
  if v_item.status in ('approved','rejected') then return v_item.status::text=p_status; end if;

  select * into v_msg from public.messages where id=v_item.target_id for update;
  if v_msg.id is null then
    delete from public.moderation_items where id=v_item.id;
    return false;
  end if;

  update public.moderation_items
  set status=p_status::public.moderation_state,
      provider=left(nullif(trim(coalesce(p_provider,'')),''),120),
      reason=left(nullif(trim(coalesce(p_reason,'')),''),500),
      score=coalesce(p_score,'{}'::jsonb),reviewed_at=now(),next_attempt_at=null
  where id=v_item.id;
  update public.messages set moderation_status=p_status::public.moderation_state where id=v_msg.id;

  if p_status='approved' then
    select m.* into v_match
    from public.conversations c join public.pet_matches m on m.id=c.match_id
    where c.id=v_msg.conversation_id
    for share of m;

    if v_match.id is not null and v_match.unmatched_at is null
       and v_msg.sender_pet_id in(v_match.pet_low_id,v_match.pet_high_id) then
      v_recipient_pet:=case when v_msg.sender_pet_id=v_match.pet_low_id then v_match.pet_high_id else v_match.pet_low_id end;
      select sp.owner_id,su.paused_at,su.suspended_at,rp.owner_id,ru.paused_at,ru.suspended_at
      into v_sender_owner,v_sender_paused,v_sender_suspended,v_recipient_owner,v_recipient_paused,v_recipient_suspended
      from public.pets sp join public.users su on su.id=sp.owner_id,
           public.pets rp join public.users ru on ru.id=rp.owner_id
      where sp.id=v_msg.sender_pet_id and rp.id=v_recipient_pet;

      if v_sender_owner is not null and v_recipient_owner is not null
         and v_sender_owner<>v_recipient_owner
         and v_sender_paused is null and v_sender_suspended is null
         and v_recipient_paused is null and v_recipient_suspended is null
         and not public.is_blocked(v_msg.sender_pet_id,v_recipient_pet) then
        insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id)
        values(v_recipient_owner,'message','New message','You have a new message from a matched pet.',v_msg.conversation_id,
               format('message:%s',v_msg.id),'message','{}'::jsonb,v_msg.sender_pet_id)
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end if;
  end if;
  return true;
end;
$function$;
revoke all on function public.finalize_message_moderation(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_message_moderation(uuid,text,text,text,jsonb) to service_role;
