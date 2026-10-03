-- Tailmance v19 marketing-consent withdrawal hardening.
-- Granting optional marketing push consent is bound to the exact current immutable legal bundle.
-- Withdrawal must remain possible even if that country/bundle is later blocked, expired, withdrawn,
-- or no longer resolvable. The withdrawal event copies the original evidence context append-only.

create or replace function public.set_marketing_push_consent(
  p_granted boolean,
  p_consent_version text,
  p_locale text default null,
  p_country_code text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();
  v_locale text:=trim(coalesce(p_locale,''));
  v_bundle_id uuid;
  v_bundle public.legal_document_bundles;
  v_runtime public.legal_country_runtime;
  v_last public.marketing_consent_events;
  v_preferences jsonb;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if p_granted is null then raise exception 'invalid_consent_value'; end if;
  perform public.rate_limit('marketing_push_consent',20,3600);

  -- Withdrawal is deliberately independent from current legal-country/bundle availability.
  -- It can only reduce permission, never grant or broaden it.
  if p_granted=false then
    select * into v_last
    from public.marketing_consent_events e
    where e.user_id=v_user_id and e.channel='push' and e.purpose='marketing_product_updates'
    order by e.created_at desc,e.id desc limit 1;

    if found and v_last.granted=true then
      insert into public.marketing_consent_events(
        user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,consent_text_sha256,legal_subnational_code
      ) values(
        v_user_id,'push','marketing_product_updates',v_last.consent_version,false,v_last.locale,v_last.country_code,
        'settings_withdrawal_original_context',v_last.bundle_id,v_last.document_locale,v_last.consent_text_sha256,v_last.legal_subnational_code
      );
      insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
      values(v_user_id,'marketing_push_consent_withdrawn','marketing_consent_event',v_last.id::text,
        jsonb_build_object('channel','push','purpose','marketing_product_updates','withdrawnFromEventId',v_last.id,
          'bundleId',v_last.bundle_id,'consentVersion',v_last.consent_version,'consentTextSha256',v_last.consent_text_sha256,
          'legalCountry',v_last.country_code,'legalSubnational',v_last.legal_subnational_code,'uiLocale',v_last.locale,'documentLocale',v_last.document_locale));
    end if;

    update public.users
      set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),updated_at=now()
      where id=v_user_id
      returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;

    return jsonb_build_object('ok',true,'granted',false,'channel','push','purpose','marketing_product_updates',
      'consentVersion',case when v_last.id is null then null else v_last.consent_version end,
      'bundleId',case when v_last.id is null then null else v_last.bundle_id end,
      'legalCountryCode',case when v_last.id is null then null else v_last.country_code end,
      'uiLocale',case when v_last.id is null then null else v_last.locale end,
      'documentLocale',case when v_last.id is null then null else v_last.document_locale end,
      'notificationPreferences',v_preferences);
  end if;

  -- Grant path is fail-closed and requires the exact active/current bundle plus current acceptance.
  if char_length(v_locale) not between 2 and 16 then raise exception 'invalid_locale'; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id;
  if not found or v_runtime.resolution_status<>'verified' then raise exception 'legal_country_unresolved'; end if;
  if p_country_code is not null and upper(trim(p_country_code))<>v_runtime.legal_country_code then raise exception 'client_country_mismatch'; end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then raise exception 'legal_bundle_not_current_for_context'; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  if p_consent_version is distinct from v_bundle.marketing_push_consent_version then raise exception 'outdated_marketing_consent_version'; end if;
  if not exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id) then
    raise exception 'current_legal_acceptance_required';
  end if;

  insert into public.marketing_consent_events(
    user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,consent_text_sha256,legal_subnational_code
  ) values(
    v_user_id,'push','marketing_product_updates',v_bundle.marketing_push_consent_version,true,v_bundle.ui_locale,v_bundle.legal_country_code,
    'settings_immutable_bundle',v_bundle.bundle_id,v_bundle.document_locale,v_bundle.marketing_push_consent_sha256,v_bundle.legal_subnational_code
  );

  update public.users
  set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','true'::jsonb,true),updated_at=now()
  where id=v_user_id
  returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(v_user_id,'marketing_push_consent_granted','legal_document_bundle',v_bundle.bundle_id,
    jsonb_build_object('channel','push','purpose','marketing_product_updates','bundleId',v_bundle.bundle_id,'consentVersion',v_bundle.marketing_push_consent_version,
      'consentTextSha256',v_bundle.marketing_push_consent_sha256,'legalCountry',v_bundle.legal_country_code,'legalSubnational',v_bundle.legal_subnational_code,
      'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale));

  return jsonb_build_object('ok',true,'granted',true,'channel','push','purpose','marketing_product_updates',
    'consentVersion',v_bundle.marketing_push_consent_version,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'notificationPreferences',v_preferences);
end $$;
revoke all on function public.set_marketing_push_consent(boolean,text,text,text) from public,anon;
grant execute on function public.set_marketing_push_consent(boolean,text,text,text) to authenticated;
