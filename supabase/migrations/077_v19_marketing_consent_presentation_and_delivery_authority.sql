-- Tailmance v19 marketing-consent presentation and delivery authority.
-- Optional marketing permission is legally and technically separate from mandatory product-access acceptance.
-- A marketing grant is current only while its exact immutable base + applicable overlay document-set hash is current.

create or replace function public.current_marketing_consent_documents(p_user_id uuid,p_bundle_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'overlayDocumentId',d.overlay_document_id,
    'jurisdictionCountryCode',o.jurisdiction_country_code,
    'jurisdictionSubnationalCode',o.jurisdiction_subnational_code,
    'applicabilityBasis',o.applicability_basis,
    'documentType',d.document_type,
    'documentLocale',d.document_locale,
    'documentVersion',d.document_version,
    'documentUrl',d.document_url,
    'documentSha256',d.document_sha256
  ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_locale,d.overlay_document_id),'[]'::jsonb)
  from public.legal_country_runtime r
  join public.legal_bundle_overlay_documents d
    on d.matrix_id=r.current_applicability_matrix_id
   and d.bundle_id=p_bundle_id
   and d.document_type='marketing_push_consent'
  join public.legal_applicability_overlays o
    on o.overlay_id=d.overlay_id
   and o.matrix_id=d.matrix_id
   and o.applicability_status='applicable'
  where r.user_id=p_user_id;
$$;
revoke all on function public.current_marketing_consent_documents(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_marketing_consent_documents(uuid,uuid) to service_role;

create or replace function public.get_current_marketing_consent_presentation(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_context jsonb;
  v_bundle_id uuid;
  v_bundle public.legal_document_bundles;
  v_base jsonb;
  v_overlays jsonb;
  v_sha text;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if char_length(v_locale) not between 2 and 16 then raise exception 'invalid_locale'; end if;

  v_context:=public.get_current_legal_context(v_locale);
  if coalesce(v_context->>'status','')<>'ready' then
    return jsonb_build_object(
      'status',coalesce(v_context->>'status','blocked_legal_context'),
      'legalCountryCode',v_context->>'legalCountryCode',
      'uiLocale',v_locale
    );
  end if;
  if not public.current_user_has_product_access() then
    return jsonb_build_object('status','blocked_current_legal_acceptance_required','uiLocale',v_locale);
  end if;

  begin
    v_bundle_id:=(v_context->>'bundleId')::uuid;
  exception when others then
    return jsonb_build_object('status','blocked_legal_bundle_missing','uiLocale',v_locale);
  end;
  if v_bundle_id is null then return jsonb_build_object('status','blocked_legal_bundle_missing','uiLocale',v_locale); end if;

  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  if not found or v_bundle.ui_locale<>v_locale then
    return jsonb_build_object('status','blocked_legal_bundle_context_mismatch','uiLocale',v_locale);
  end if;

  select jsonb_build_object(
    'documentType',d.document_type,
    'documentLocale',d.document_locale,
    'documentVersion',d.document_version,
    'documentUrl',d.document_url,
    'documentSha256',d.document_sha256
  ) into v_base
  from public.legal_bundle_documents d
  where d.bundle_id=v_bundle_id and d.document_type='marketing_push_consent'
  limit 1;
  if v_base is null then
    return jsonb_build_object('status','blocked_marketing_consent_document_missing','bundleId',v_bundle_id,'uiLocale',v_locale);
  end if;

  v_overlays:=public.current_marketing_consent_documents(v_user_id,v_bundle_id);
  v_sha:=public.current_marketing_consent_document_set_sha256(v_user_id,v_bundle_id);
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','blocked_marketing_consent_document_set_unavailable','bundleId',v_bundle_id,'uiLocale',v_locale);
  end if;

  return jsonb_build_object(
    'status','ready',
    'bundleId',v_bundle.bundle_id,
    'applicabilityMatrixId',v_context->>'applicabilityMatrixId',
    'legalCountryCode',v_bundle.legal_country_code,
    'legalSubnationalCode',v_bundle.legal_subnational_code,
    'uiLocale',v_bundle.ui_locale,
    'documentLocale',v_bundle.document_locale,
    'consentVersion',v_bundle.marketing_push_consent_version,
    'baseDocument',v_base,
    'overlayDocuments',v_overlays,
    'consentDocumentSetSha256',v_sha
  );
end $$;
revoke all on function public.get_current_marketing_consent_presentation(text) from public,anon;
grant execute on function public.get_current_marketing_consent_presentation(text) to authenticated;

-- Authoritative active-consent projection. The cached users.notification_preferences.marketing flag is
-- never sufficient to authorize a marketing delivery after a bundle/matrix/document-set change.
create or replace function public.current_marketing_push_consent_granted(p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_runtime public.legal_country_runtime;
  v_bundle_id uuid;
  v_bundle public.legal_document_bundles;
  v_sha text;
  v_event public.marketing_consent_events;
  v_locale text;
begin
  if p_user_id is null then return false; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.current_applicability_matrix_id is null then return false; end if;
  if not public.legal_applicability_matrix_satisfied(p_user_id) then return false; end if;
  select coalesce(preferred_locale,'en') into v_locale from public.users where id=p_user_id;
  if v_locale is null then return false; end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(p_user_id,v_locale);
  if v_bundle_id is null then return false; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  if not found then return false; end if;
  v_sha:=public.current_marketing_consent_document_set_sha256(p_user_id,v_bundle_id);
  if v_sha is null then return false; end if;

  select * into v_event from public.marketing_consent_events e
  where e.user_id=p_user_id
    and e.bundle_id=v_bundle_id
    and e.applicability_matrix_id=v_runtime.current_applicability_matrix_id
    and e.channel='push'
    and e.purpose='marketing_product_updates'
  order by e.created_at desc,e.id desc limit 1;
  if not found then return false; end if;

  return v_event.granted=true
    and v_event.consent_version=v_bundle.marketing_push_consent_version
    and v_event.consent_text_sha256=v_bundle.marketing_push_consent_sha256
    and v_event.consent_document_set_sha256=v_sha
    and v_event.country_code=v_bundle.legal_country_code
    and coalesce(v_event.legal_subnational_code,'')=coalesce(v_bundle.legal_subnational_code,'')
    and v_event.locale=v_bundle.ui_locale
    and v_event.document_locale=v_bundle.document_locale;
end $$;
revoke all on function public.current_marketing_push_consent_granted(uuid) from public,anon,authenticated;
grant execute on function public.current_marketing_push_consent_granted(uuid) to service_role;

create or replace function public.service_marketing_push_consent_user_ids(p_user_ids uuid[])
returns table(user_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_ids is null or cardinality(p_user_ids)=0 then return; end if;
  if cardinality(p_user_ids)>200 then raise exception 'too_many_user_ids'; end if;
  return query
    select distinct x.user_id
    from unnest(p_user_ids) as x(user_id)
    where public.current_marketing_push_consent_granted(x.user_id);
end $$;
revoke all on function public.service_marketing_push_consent_user_ids(uuid[]) from public,anon,authenticated;
grant execute on function public.service_marketing_push_consent_user_ids(uuid[]) to service_role;

-- Account settings project marketing permission from the authoritative current consent event + document
-- set, not from the denormalized cached preference bit.
create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,'incognito',u.incognito,
    'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,'measurementSystem',u.measurement_system,
    'legalContextCurrent',public.current_user_has_product_access(),'legalBundleAccepted',public.current_user_has_product_access(),
    'legalBundleId',public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en')),
    'legalCountry',r.legal_country_code,'legalCountryCode',r.legal_country_code,'legalSubnationalCode',r.legal_subnational_code,
    'legalCountryVerificationStatus',coalesce(r.resolution_status,'pending'),'legalCountryExpiresAt',r.expires_at,
    'legalApplicabilityMatrixId',r.current_applicability_matrix_id,
    'legalJurisdictionReleaseStatus',coalesce(j.release_status,'blocked'),'legalLanguageReviewStatus',coalesce(j.language_review_status,'pending_external_counsel'),'legalAgeAssuranceMode',coalesce(j.age_assurance_mode,'unresolved'),
    'legalUiLocale',b.ui_locale,'legalDocumentLocale',b.document_locale,
    'privacyNoticeVersion',(select p.notice_version from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.applicability_matrix_id=r.current_applicability_matrix_id order by p.acknowledged_at desc,p.id desc limit 1),
    'marketingConsentVersion',case when public.current_marketing_push_consent_granted(u.id) then b.marketing_push_consent_version else null end,
    'notificationPreferences',jsonb_set(
      ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb||coalesce(u.notification_preferences,'{}'::jsonb)),
      '{marketing}',to_jsonb(public.current_marketing_push_consent_granted(u.id)),true)
  ) from public.users u
  left join public.legal_country_runtime r on r.user_id=u.id
  left join public.legal_jurisdiction_policies j on j.legal_country_code=r.legal_country_code
  left join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
  where u.id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;
