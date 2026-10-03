-- Tailmance v19 marketing-overlay document integrity hardening.
-- Optional marketing consent may only be presented/granted against the exact, counsel-classified set of
-- currently-applicable overlay documents. Extra/unclassified/stale/untrusted overlay documents never enter
-- the presentation digest, and any required marketing supplement that is missing or invalid fails closed.

create or replace function public.marketing_consent_overlay_documents_complete(p_user_id uuid,p_bundle_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_matrix_id uuid;
  v_overlay public.legal_applicability_overlays;
  v_locale text;
begin
  if p_user_id is null or p_bundle_id is null then return false; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return false; end if;
  if not public.legal_applicability_matrix_satisfied(p_user_id) then return false; end if;
  if not public.legal_applicability_bundle_satisfied(p_user_id,p_bundle_id) then return false; end if;
  if not public.legal_bundle_document_manifest_complete(p_bundle_id) then return false; end if;

  -- Every applicable overlay that explicitly requires a marketing consent supplement must have one fresh,
  -- professionally-localized, counsel-reviewed, approved-origin document for every required document locale.
  for v_overlay in
    select * from public.legal_applicability_overlays
    where matrix_id=v_matrix_id and applicability_status='applicable'
      and 'marketing_push_consent'=any(required_document_types)
  loop
    if cardinality(v_overlay.required_document_locales)=0 then return false; end if;
    foreach v_locale in array v_overlay.required_document_locales loop
      if not exists(
        select 1 from public.legal_bundle_overlay_documents d
        where d.matrix_id=v_matrix_id and d.overlay_id=v_overlay.overlay_id and d.bundle_id=p_bundle_id
          and d.document_type='marketing_push_consent' and d.document_locale=v_locale
          and public.legal_document_url_allowed(d.document_url)
          and d.reviewed_at<=now() and d.reviewed_at>=now()-interval '90 days'
          and d.valid_until>now() and d.valid_until<=d.reviewed_at+interval '90 days'
          and jsonb_array_length(d.source_evidence_reference)>0
          and jsonb_array_length(d.counsel_evidence_reference)>0
          and jsonb_array_length(d.localization_evidence_reference)>0
      ) then return false; end if;
    end loop;
  end loop;

  -- A marketing supplement is not allowed to silently enter the consent presentation merely because a row
  -- exists. It must be explicitly classified as required for that applicable overlay and locale.
  if exists(
    select 1
    from public.legal_bundle_overlay_documents d
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id
    where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id and d.document_type='marketing_push_consent'
      and o.applicability_status='applicable'
      and (
        not ('marketing_push_consent'=any(o.required_document_types))
        or not (d.document_locale=any(o.required_document_locales))
        or not public.legal_document_url_allowed(d.document_url)
        or d.reviewed_at>now() or d.reviewed_at<now()-interval '90 days'
        or d.valid_until<=now() or d.valid_until>d.reviewed_at+interval '90 days'
        or jsonb_array_length(d.source_evidence_reference)=0
        or jsonb_array_length(d.counsel_evidence_reference)=0
        or jsonb_array_length(d.localization_evidence_reference)=0
      )
  ) then return false; end if;

  return true;
end $$;
revoke all on function public.marketing_consent_overlay_documents_complete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_consent_overlay_documents_complete(uuid,uuid) to service_role;

create or replace function public.current_marketing_consent_documents(p_user_id uuid,p_bundle_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when not public.marketing_consent_overlay_documents_complete(p_user_id,p_bundle_id) then '[]'::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'overlayDocumentId',d.overlay_document_id,
        'jurisdictionCountryCode',o.jurisdiction_country_code,
        'jurisdictionSubnationalCode',o.jurisdiction_subnational_code,
        'applicabilityBasis',o.applicability_basis,
        'documentType',d.document_type,
        'documentLocale',d.document_locale,
        'documentVersion',d.document_version,
        'documentUrl',d.document_url,
        'documentSha256',d.document_sha256
      ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_locale,d.overlay_document_id)
      from public.legal_country_runtime r
      join public.legal_bundle_overlay_documents d
        on d.matrix_id=r.current_applicability_matrix_id and d.bundle_id=p_bundle_id and d.document_type='marketing_push_consent'
      join public.legal_applicability_overlays o
        on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
       and 'marketing_push_consent'=any(o.required_document_types)
       and d.document_locale=any(o.required_document_locales)
      where r.user_id=p_user_id
    ),'[]'::jsonb) end;
$$;
revoke all on function public.current_marketing_consent_documents(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_marketing_consent_documents(uuid,uuid) to service_role;

create or replace function public.current_marketing_consent_document_set_sha256(p_user_id uuid,p_bundle_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_bundle public.legal_document_bundles;v_overlays jsonb;
begin
  if p_user_id is null or p_bundle_id is null then return null; end if;
  if not public.marketing_consent_overlay_documents_complete(p_user_id,p_bundle_id) then return null; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=p_bundle_id;
  if not found then return null; end if;
  v_overlays:=public.current_marketing_consent_documents(p_user_id,p_bundle_id);
  return encode(extensions.digest(convert_to(jsonb_build_object(
    'base',jsonb_build_array(v_bundle.bundle_id::text,v_bundle.marketing_push_consent_version,v_bundle.document_locale,v_bundle.marketing_push_consent_sha256),
    'overlays',coalesce((select jsonb_agg(jsonb_build_array(
      x->>'overlayDocumentId',x->>'jurisdictionCountryCode',coalesce(x->>'jurisdictionSubnationalCode',''),x->>'applicabilityBasis',
      x->>'documentLocale',x->>'documentVersion',x->>'documentUrl',x->>'documentSha256'
    ) order by x->>'jurisdictionCountryCode',coalesce(x->>'jurisdictionSubnationalCode',''),x->>'applicabilityBasis',x->>'documentLocale',x->>'overlayDocumentId')
    from jsonb_array_elements(v_overlays) x),'[]'::jsonb)
  )::text,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.current_marketing_consent_document_set_sha256(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_marketing_consent_document_set_sha256(uuid,uuid) to service_role;

-- Rebind grant path so an unavailable/incomplete canonical marketing document set cannot exploit SQL NULL
-- comparison semantics and accidentally pass the stale-presentation check. Withdrawal remains unconditional.
create or replace function public.set_marketing_push_consent(
  p_granted boolean,
  p_consent_version text,
  p_locale text default null,
  p_country_code text default null,
  p_presented_consent_document_set_sha256 text default null
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
  v_current_consent_document_set_sha256 text;
  v_current_overlay_document_set_sha256 text;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if p_granted is null then raise exception 'invalid_consent_value'; end if;
  perform public.rate_limit('marketing_push_consent',20,3600);

  if p_granted=false then
    select * into v_last from public.marketing_consent_events e
      where e.user_id=v_user_id and e.channel='push' and e.purpose='marketing_product_updates'
      order by e.created_at desc,e.id desc limit 1;
    if found and v_last.granted=true then
      insert into public.marketing_consent_events(
        user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,
        consent_text_sha256,legal_subnational_code,applicability_matrix_id,consent_document_set_sha256
      ) values(
        v_user_id,'push','marketing_product_updates',v_last.consent_version,false,v_last.locale,v_last.country_code,
        'settings_withdrawal_original_context',v_last.bundle_id,v_last.document_locale,v_last.consent_text_sha256,v_last.legal_subnational_code,
        v_last.applicability_matrix_id,v_last.consent_document_set_sha256
      );
      insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
        values(v_user_id,'marketing_push_consent_withdrawn','marketing_consent_event',v_last.id::text,
          jsonb_build_object('channel','push','purpose','marketing_product_updates','withdrawnFromEventId',v_last.id,
            'bundleId',v_last.bundle_id,'consentVersion',v_last.consent_version,'consentTextSha256',v_last.consent_text_sha256,
            'consentDocumentSetSha256',v_last.consent_document_set_sha256,'applicabilityMatrixId',v_last.applicability_matrix_id,
            'legalCountry',v_last.country_code,'legalSubnational',v_last.legal_subnational_code,'uiLocale',v_last.locale,'documentLocale',v_last.document_locale));
    end if;
    update public.users set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),updated_at=now()
      where id=v_user_id
      returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;
    return jsonb_build_object('ok',true,'granted',false,'channel','push','purpose','marketing_product_updates',
      'consentVersion',case when v_last.id is null then null else v_last.consent_version end,
      'bundleId',case when v_last.id is null then null else v_last.bundle_id end,
      'legalCountryCode',case when v_last.id is null then null else v_last.country_code end,
      'uiLocale',case when v_last.id is null then null else v_last.locale end,
      'documentLocale',case when v_last.id is null then null else v_last.document_locale end,
      'consentDocumentSetSha256',case when v_last.id is null then null else v_last.consent_document_set_sha256 end,
      'notificationPreferences',v_preferences);
  end if;

  if char_length(v_locale) not between 2 and 16 then raise exception 'invalid_locale'; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id for update;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.current_applicability_matrix_id is null then raise exception 'legal_context_unresolved'; end if;
  if not public.legal_applicability_matrix_satisfied(v_user_id) then raise exception 'legal_applicability_review_incomplete'; end if;
  if p_country_code is not null and upper(trim(p_country_code))<>v_runtime.legal_country_code then raise exception 'client_country_mismatch'; end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then raise exception 'legal_bundle_not_current_for_context'; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  if p_consent_version is distinct from v_bundle.marketing_push_consent_version then raise exception 'outdated_marketing_consent_version'; end if;
  v_current_overlay_document_set_sha256:=public.current_legal_overlay_document_set_sha256(v_user_id,v_bundle_id);
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

  insert into public.marketing_consent_events(
    user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,consent_text_sha256,
    legal_subnational_code,applicability_matrix_id,consent_document_set_sha256
  ) values(
    v_user_id,'push','marketing_product_updates',v_bundle.marketing_push_consent_version,true,v_bundle.ui_locale,v_bundle.legal_country_code,
    'settings_immutable_bundle_exact_document_set',v_bundle.bundle_id,v_bundle.document_locale,v_bundle.marketing_push_consent_sha256,
    v_bundle.legal_subnational_code,v_runtime.current_applicability_matrix_id,v_current_consent_document_set_sha256
  );
  update public.users set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','true'::jsonb,true),updated_at=now()
    where id=v_user_id
    returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(v_user_id,'marketing_push_consent_granted','legal_document_bundle',v_bundle.bundle_id,
      jsonb_build_object('channel','push','purpose','marketing_product_updates','bundleId',v_bundle.bundle_id,
        'consentVersion',v_bundle.marketing_push_consent_version,'consentTextSha256',v_bundle.marketing_push_consent_sha256,
        'consentDocumentSetSha256',v_current_consent_document_set_sha256,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,
        'legalCountry',v_bundle.legal_country_code,'legalSubnational',v_bundle.legal_subnational_code,
        'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale));
  return jsonb_build_object('ok',true,'granted',true,'channel','push','purpose','marketing_product_updates',
    'consentVersion',v_bundle.marketing_push_consent_version,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'consentDocumentSetSha256',v_current_consent_document_set_sha256,
    'notificationPreferences',v_preferences);
end $$;
revoke all on function public.set_marketing_push_consent(boolean,text,text,text,text) from public,anon;
grant execute on function public.set_marketing_push_consent(boolean,text,text,text,text) to authenticated;
