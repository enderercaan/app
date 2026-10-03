-- Tailmance v19 R8 security hardening: close residual authenticated RPC session-revocation bypasses.
-- A globally revoked Supabase session must not keep using an already-issued access JWT against
-- SECURITY DEFINER RPCs during the remaining JWT lifetime. Migration 101 established the central
-- revocation state; this migration binds every effective authenticated-only residual RPC to it.

create or replace function public.require_active_authenticated_session()
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if auth.role()<>'authenticated' or auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.current_session_not_revoked() then raise exception using errcode='42501',message='session_revoked'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception using errcode='42501',message='mfa_required'; end if;
end;
$$;
revoke all on function public.require_active_authenticated_session() from public,anon,authenticated;
grant execute on function public.require_active_authenticated_session() to service_role;

create or replace function public.get_available_travel_zones()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then coalesce(jsonb_agg(jsonb_build_object(
    'id',z.id,'city',z.city,'district',z.district,'neighborhood',z.neighborhood,'pilot',z.launch_status='pilot_open'
  ) order by z.city,z.district,z.neighborhood),'[]'::jsonb) else null end
  from public.community_launch_zones z
  where z.active and z.launch_status in ('pilot_open','open');
$$;
revoke all on function public.get_available_travel_zones() from public,anon;
grant execute on function public.get_available_travel_zones() to authenticated;

create or replace function public.get_consumable_wallet()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then jsonb_build_object(
    'boostCredits',coalesce(b.boost_credits,0),
    'superLikeCredits',coalesce(b.super_like_credits,0)
  ) else null end
  from (select 1) q left join public.consumable_balances b on b.user_id=auth.uid();
$$;
revoke all on function public.get_consumable_wallet() from public,anon;
grant execute on function public.get_consumable_wallet() to authenticated;

-- Effective definition carried forward from 085_v19_dual_language_legal_presentation.sql; only the session boundary is strengthened.
create or replace function public.get_current_legal_context(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;v_bundle public.legal_document_bundles;v_bundle_id uuid;v_candidate_id uuid;v_locale text:=trim(coalesce(p_ui_locale,''));
  v_accepted boolean:=false;v_privacy_ack boolean:=false;v_overlay_actions boolean:=false;v_presentation_complete boolean:=false;
  v_docs jsonb:='{}'::jsonb;v_overlay_docs jsonb:='[]'::jsonb;v_comp_docs jsonb:='[]'::jsonb;v_overlay_comp_docs jsonb:='[]'::jsonb;
  v_presentation_sha text;v_overlay_sha text;v_marketing_sha text;v_subscription_sha text;v_comp_sha text;
begin
  perform public.require_active_authenticated_session();
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(v_locale) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale'); end if;
  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return jsonb_build_object('status','blocked_legal_country_unresolved'); end if;
  if v_runtime.legal_subnational_code is not null and left(v_runtime.legal_subnational_code,3)<>v_runtime.legal_country_code||'-' then return jsonb_build_object('status','blocked_legal_subnational_country_mismatch','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code); end if;
  if v_runtime.expires_at is null or v_runtime.expires_at<=now() then return jsonb_build_object('status','blocked_legal_country_evidence_expired','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_runtime.resolution_source not in ('habitual_residence_verified','service_contract_country_verified','manual_legal_review') then return jsonb_build_object('status','blocked_legal_country_provenance_insufficient','legalCountryCode',v_runtime.legal_country_code); end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_runtime.legal_country_code;
  if not found or v_policy.release_status<>'approved' then return jsonb_build_object('status','blocked_jurisdiction_not_approved','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_policy.legal_reviewed_at is null or v_policy.legal_reviewed_at>now() or v_policy.next_review_due_at is null or v_policy.next_review_due_at<=now() then return jsonb_build_object('status','blocked_jurisdiction_review_expired','legalCountryCode',v_runtime.legal_country_code,'nextReviewDueAt',v_policy.next_review_due_at); end if;
  if not public.legal_control_reviews_complete(v_policy.control_reviews) then return jsonb_build_object('status','blocked_jurisdiction_control_review_incomplete','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_policy.subnational_review_required and v_runtime.legal_subnational_code is null then return jsonb_build_object('status','blocked_subnational_review_required','legalCountryCode',v_runtime.legal_country_code); end if;
  if not public.current_legal_age_assurance_satisfied(v_user_id,v_runtime.legal_country_code,v_runtime.legal_subnational_code) then return jsonb_build_object('status','blocked_age_assurance_required','legalCountryCode',v_runtime.legal_country_code,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age); end if;
  if v_runtime.current_applicability_matrix_id is null then return jsonb_build_object('status','blocked_legal_applicability_matrix_unresolved','legalCountryCode',v_runtime.legal_country_code); end if;
  if not public.legal_applicability_matrix_satisfied(v_user_id) then return jsonb_build_object('status','blocked_legal_applicability_overlay_review_incomplete','legalCountryCode',v_runtime.legal_country_code,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id); end if;
  select r.current_bundle_id into v_candidate_id from public.legal_document_bundle_routes r join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
    where r.legal_country_code=v_runtime.legal_country_code and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
      and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now() and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code and b.ui_locale=r.ui_locale limit 1;
  if v_candidate_id is not null and not public.legal_bundle_document_manifest_complete(v_candidate_id) then return jsonb_build_object('status','blocked_legal_document_manifest_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  if v_candidate_id is not null and not public.legal_subnational_language_requirements_satisfied(v_candidate_id) then return jsonb_build_object('status','blocked_subnational_language_requirement_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  if v_candidate_id is not null and not public.legal_applicability_bundle_satisfied(v_user_id,v_candidate_id) then return jsonb_build_object('status','blocked_legal_applicability_documents_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id); end if;
  if v_candidate_id is not null and (not public.legal_comprehension_documents_complete(v_candidate_id,v_locale) or not public.legal_overlay_comprehension_documents_complete(v_user_id,v_candidate_id,v_locale)) then
    return jsonb_build_object('status','blocked_legal_comprehension_documents_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale);
  end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then return jsonb_build_object('status','blocked_legal_bundle_missing','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  select coalesce(jsonb_object_agg(document_type,document_url),'{}'::jsonb) into v_docs from public.legal_bundle_documents where bundle_id=v_bundle_id;
  v_overlay_docs:=public.current_legal_overlay_documents(v_user_id,v_bundle_id);
  v_comp_docs:=public.current_legal_comprehension_documents(v_bundle_id,v_locale);
  v_overlay_comp_docs:=public.current_legal_overlay_comprehension_documents(v_user_id,v_bundle_id,v_locale);
  v_overlay_sha:=public.current_legal_overlay_document_set_sha256(v_user_id,v_bundle_id);
  v_comp_sha:=public.current_legal_acceptance_comprehension_document_set_sha256(v_user_id,v_bundle_id,v_locale);
  v_marketing_sha:=public.current_marketing_consent_document_set_sha256(v_user_id,v_bundle_id);
  v_subscription_sha:=public.current_subscription_purchase_document_set_sha256(v_user_id,v_bundle_id);
  v_presentation_sha:=public.legal_acceptance_presentation_sha256(v_user_id,v_bundle_id);
  select exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id and a.applicability_matrix_id=v_runtime.current_applicability_matrix_id and a.overlay_document_set_sha256=v_overlay_sha) into v_accepted;
  select exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=v_user_id and p.bundle_id=v_bundle_id and p.applicability_matrix_id=v_runtime.current_applicability_matrix_id and p.overlay_document_set_sha256=v_overlay_sha) into v_privacy_ack;
  v_overlay_actions:=public.legal_overlay_document_actions_complete(v_user_id,v_bundle_id);v_presentation_complete:=public.legal_acceptance_presentation_complete(v_user_id,v_bundle_id);
  return jsonb_build_object('status','ready','accepted',v_accepted and v_privacy_ack and v_overlay_actions and v_presentation_complete,'bundleId',v_bundle.bundle_id,
    'legalCountryCode',v_bundle.legal_country_code,'legalSubnationalCode',v_bundle.legal_subnational_code,'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,
    'legalVersion',v_bundle.legal_version,'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,'privacyNoticeVersion',v_bundle.privacy_notice_version,'marketingPushConsentVersion',v_bundle.marketing_push_consent_version,
    'termsUrl',v_docs->>'terms','privacyNoticeUrl',v_docs->>'privacy_notice','communityGuidelinesUrl',v_docs->>'community_guidelines','marketingPushConsentUrl',v_docs->>'marketing_push_consent','subscriptionConsumerUrl',v_docs->>'subscription_consumer',
    'moderationAppealsUrl',v_docs->>'moderation_appeals','intellectualPropertyUrl',v_docs->>'intellectual_property','accessibilityUrl',v_docs->>'accessibility','accountDeletionUrl',v_docs->>'account_deletion','supportUrl',v_docs->>'support','jurisdictionPrivacySupplementUrl',v_docs->>'jurisdiction_privacy_supplement','legalDocumentUrls',v_docs,
    'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,'overlayDocuments',v_overlay_docs,'comprehensionDocuments',v_comp_docs,'comprehensionOverlayDocuments',v_overlay_comp_docs,
    'overlayActionsComplete',v_overlay_actions,'overlayDocumentSetSha256',v_overlay_sha,'comprehensionDocumentSetSha256',v_comp_sha,'marketingConsentDocumentSetSha256',v_marketing_sha,'subscriptionPurchaseDocumentSetSha256',v_subscription_sha,
    'acceptancePresentationSha256',v_presentation_sha,'presentationAcceptanceComplete',v_presentation_complete,'effectiveAt',v_bundle.effective_at,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age);
end $$;

-- Effective definition carried forward from 080_v19_restricted_account_context_bound_support.sql; only the session boundary is strengthened.
create or replace function public.get_restricted_account_legal_support(p_ui_locale text)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_bundle_id uuid;
  v_bundle public.legal_document_bundles;
  v_support_url text;
begin
  perform public.require_active_authenticated_session();
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(v_locale) not between 2 and 16 then
    return jsonb_build_object('status','blocked_unsupported_ui_locale');
  end if;

  -- Intentionally resolve the exact reviewed legal route without requiring current social/product access.
  -- resolve_current_legal_bundle_id still enforces verified legal country, subnational/applicability review,
  -- age assurance, document-language evidence, immutable manifests and exact UI-locale routing.
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then
    return jsonb_build_object('status','blocked_legal_support_context_unavailable','uiLocale',v_locale);
  end if;

  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  select d.document_url into v_support_url
    from public.legal_bundle_documents d
   where d.bundle_id=v_bundle_id and d.document_type='support'
   limit 1;

  if v_support_url is null or not public.legal_document_url_allowed(v_support_url) then
    return jsonb_build_object(
      'status','blocked_legal_support_document_unavailable',
      'bundleId',v_bundle_id,
      'legalCountryCode',v_bundle.legal_country_code,
      'legalSubnationalCode',v_bundle.legal_subnational_code,
      'uiLocale',v_bundle.ui_locale,
      'documentLocale',v_bundle.document_locale
    );
  end if;

  return jsonb_build_object(
    'status','ready',
    'bundleId',v_bundle_id,
    'legalCountryCode',v_bundle.legal_country_code,
    'legalSubnationalCode',v_bundle.legal_subnational_code,
    'uiLocale',v_bundle.ui_locale,
    'documentLocale',v_bundle.document_locale,
    'supportUrl',v_support_url
  );
end $$;

-- Effective definition carried forward from 023_quiet_hours_measurements_telemetry_and_compatibility.sql; only the session boundary is strengthened.
create or replace function public.record_client_error(p_error_name text,p_fingerprint text,p_app_version text,p_platform text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if auth.uid() is null then return; end if;
  if p_error_name is null or char_length(trim(p_error_name)) not between 1 and 80 then raise exception 'invalid_error_name'; end if;
  if p_fingerprint is null or not (p_fingerprint ~ '^[0-9a-f]{16}$' or p_fingerprint='unknown') then raise exception 'invalid_error_fingerprint'; end if;
  if p_app_version is null or char_length(trim(p_app_version)) not between 1 and 32 then raise exception 'invalid_app_version'; end if;
  if p_platform not in ('ios','android','web','windows','macos') then raise exception 'invalid_platform'; end if;
  perform public.rate_limit('client_error_telemetry',20,3600);
  insert into public.client_error_events(error_name,fingerprint,app_version,platform)
  values(trim(p_error_name),p_fingerprint,trim(p_app_version),p_platform);
  -- Opportunistic bounded retention cleanup. Production operations must still schedule
  -- an independent retention job so expiry is guaranteed even during quiet periods.
  delete from public.client_error_events where occurred_at < now()-interval '30 days';
end $$;

-- Effective definition carried forward from 022_account_pause_health_privacy_and_manual_review.sql; only the session boundary is strengthened.
create or replace function public.set_account_paused(p_paused boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_paused_at timestamptz;
begin
  perform public.require_active_authenticated_session();
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  perform public.rate_limit('account_pause',20,3600);
  if p_paused then
    update public.users
    set paused_at=coalesce(paused_at,now()),discoverable=false,updated_at=now()
    where id=auth.uid() and suspended_at is null
    returning paused_at into v_paused_at;
    if not found then raise exception 'account_unavailable'; end if;
  else
    update public.users set paused_at=null,updated_at=now()
    where id=auth.uid() and suspended_at is null
    returning paused_at into v_paused_at;
    if not found then raise exception 'account_unavailable'; end if;
  end if;
  insert into public.audit_events(user_id,action,entity_type)
  values(auth.uid(),case when p_paused then 'account_paused' else 'account_resumed' end,'user');
  return jsonb_build_object('paused',p_paused);
end $$;

-- Effective definition carried forward from 096_b2b_monthly_contract_and_future_roadmap_fail_closed.sql; only the session boundary is strengthened.
create or replace function public.get_product_feature_policy()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  return jsonb_build_object(
    'matingOwnerArrangedEnabled',public.current_mating_feature_enabled(),
    'petSalesEnabled',false,'commercialBreedingEnabled',false,'petCommerceMarketplaceEnabled',false,
    'dataSaleEnabled',false,'dataSalesEnabled',false,'aggressiveAdsEnabled',false,
    'catsInDiscovery',false,'premiumEventCreation',true,'lostPetAlertsFree',true,'safetyFeaturesFree',true,
    'multiplePetsPremium',true,'advancedFiltersPremium',true,'travelModePremium',true,
    'boostsEnabled',true,'consumablePacksEnabled',true,'contextualAdsOnly',true,
    'premiumMultiplePets',true,'premiumAdvancedFilters',true,'premiumTravelMode',true,
    'premiumUnlimitedLikes',true,'consumableBoosts',true,'consumableSuperLikes',true,
    'contextualBusinessPromotionsOnly',true,'petFirstNoHumanDating',true,
    'insuranceAffiliateEnabled',false,'commerceAffiliateEnabled',false,'sitterMarketplaceEnabled',false,
    'businessPartnerMonthlyPlans',true
  );
end $$;

-- Effective definition carried forward from 096_b2b_monthly_contract_and_future_roadmap_fail_closed.sql; only the session boundary is strengthened.
create or replace function public.track_commercial_referral(p_offer_id uuid,p_source text)
returns void language plpgsql security definer set search_path='' as $$
declare v_partner_id uuid;
begin
  perform public.require_active_authenticated_session();
  if p_source not in ('event_ticket','event_sponsor','event_sample') then raise exception 'invalid_referral_source'; end if;
  select partner_id into v_partner_id from public.event_commercial_offers where id=p_offer_id and active;
  if v_partner_id is null or not public.business_partner_entitlement_active(v_partner_id) then raise exception 'offer_not_found'; end if;
  perform public.rate_limit('commercial_referral',100,3600);
  insert into public.commercial_referral_events(offer_id,source) values(p_offer_id,p_source);
end $$;

-- Effective definition carried forward from 088_retention_trust_and_local_network_architecture.sql; only the session boundary is strengthened.
create or replace function public.track_place_referral(p_place_id uuid,p_source text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if p_source not in ('places','event','meetup') then raise exception 'invalid_referral_source'; end if;
  if not exists(select 1 from public.pet_friendly_places where id=p_place_id and active) then raise exception 'place_not_found'; end if;
  perform public.rate_limit('place_referral',100,3600);
  insert into public.place_referral_events(place_id,source) values(p_place_id,p_source);
end $$;

-- Effective definition carried forward from 023_quiet_hours_measurements_telemetry_and_compatibility.sql; only the session boundary is strengthened.
create or replace function public.update_measurement_system(p_system text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_system not in ('metric','imperial') then raise exception 'invalid_measurement_system'; end if;
  perform public.rate_limit('measurement_system',30,3600);
  update public.users set measurement_system=p_system,updated_at=now() where id=auth.uid();
end $$;

-- Effective definition carried forward from 003_product_completion.sql; only the session boundary is strengthened.
create or replace function public.update_privacy_settings(p_discoverable boolean,p_incognito boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_incognito and not exists(select 1 from public.users where id=auth.uid() and tier='premium') then
    raise exception 'premium_required';
  end if;
  update public.users set discoverable=p_discoverable,incognito=p_incognito where id=auth.uid();
  insert into public.audit_events(user_id,action,entity_type,metadata)
  values(auth.uid(),'privacy_settings_update','user',jsonb_build_object('discoverable',p_discoverable,'incognito',p_incognito));
end $$;

revoke all on function public.get_current_legal_context(text) from public,anon;
grant execute on function public.get_current_legal_context(text) to authenticated;
revoke all on function public.get_restricted_account_legal_support(text) from public,anon;
grant execute on function public.get_restricted_account_legal_support(text) to authenticated;
revoke all on function public.record_client_error(text,text,text,text) from public,anon;
grant execute on function public.record_client_error(text,text,text,text) to authenticated;
revoke all on function public.set_account_paused(boolean) from public,anon;
grant execute on function public.set_account_paused(boolean) to authenticated;
revoke all on function public.get_product_feature_policy() from public,anon;
grant execute on function public.get_product_feature_policy() to authenticated;
revoke all on function public.track_commercial_referral(uuid,text) from public,anon;
grant execute on function public.track_commercial_referral(uuid,text) to authenticated;
revoke all on function public.track_place_referral(uuid,text) from public,anon;
grant execute on function public.track_place_referral(uuid,text) to authenticated;
revoke all on function public.update_measurement_system(text) from public,anon;
grant execute on function public.update_measurement_system(text) to authenticated;
revoke all on function public.update_privacy_settings(boolean,boolean) from public,anon;
grant execute on function public.update_privacy_settings(boolean,boolean) to authenticated;
