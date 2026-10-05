import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const checks=[];const check=(name,fn)=>{fn();checks.push(name)};
const app=read('app.config.ts');
const auth=read('src/screens/AuthScreen.tsx');
const authService=read('src/services/auth.ts');
const legalScreen=read('src/screens/LegalConsentScreen.tsx');
const legalBlock=read('src/components/LegalBlockScreen.tsx');
const legalGateActions=read('src/components/LegalGateAccountActions.tsx');
const settings=read('src/screens/SettingsScreen.tsx');
const premium=read('src/screens/PremiumScreen.tsx');
const purchases=read('src/services/purchases.ts');
const api=read('src/services/api.ts');
const nav=read('src/navigation/AppNavigator.tsx');
const acceptLegal=read('supabase/functions/accept-legal/index.ts');
const legalV19=read('supabase/migrations/050_v19_legal_consent_evidence.sql');
const marketingV19Withdrawal=read('supabase/migrations/060_v19_marketing_consent_unconditional_withdrawal.sql');
const moderationV19=read('supabase/migrations/051_v19_moderation_decisions_appeals.sql');
const moderationBridge=read('supabase/migrations/052_v19_moderation_decision_recording.sql');
const moderationRestoration=read('supabase/migrations/053_v19_moderation_restoration_and_report_idempotency.sql');
const moderationAdmin=read('supabase/functions/moderation-admin/index.ts');
const moderationStatement=read('supabase/migrations/069_v19_structured_moderation_statement_of_reasons.sql');
const moderationAtomic=read('supabase/migrations/070_v19_atomic_moderation_decision_statement.sql');
const legalOverlayActions=read('supabase/migrations/071_v19_overlay_legal_document_user_action_evidence.sql');
const m75=read('supabase/migrations/075_v19_mandatory_acceptance_optional_marketing_separation.sql');
const prelegalAgeBoundary=read('supabase/migrations/074_v19_prelegal_age_attestation_authority_boundary.sql');
const legalOriginAllowlist=read('supabase/migrations/076_v19_legal_document_origin_allowlist.sql');
const marketingAuthority=read('supabase/migrations/077_v19_marketing_consent_presentation_and_delivery_authority.sql');
const subscriptionPrecontract=read('supabase/migrations/078_v19_subscription_precontract_presentation_evidence.sql');
const marketingOverlayIntegrity=read('supabase/migrations/079_v19_marketing_overlay_document_integrity.sql');
const marketingRetryAuthority=read('supabase/migrations/142_retry_safe_desired_state_and_consent_mutations.sql');
const configured27RuntimeAuthority=read('supabase/migrations/134_configured_27_runtime_legal_source_authority.sql');
const brPromotion=read('supabase/migrations/141_br_paid_promotion_transparency_fail_closed.sql');
const preRegistrationLegal=read('supabase/migrations/081_v19_pre_registration_legal_presentation_binding.sql');
const preRegistrationSubnational=read('supabase/migrations/082_v19_pre_registration_subnational_scope_binding.sql');
const preRegistrationRouteLifecycle=read('supabase/migrations/083_v19_pre_registration_route_lifecycle_and_subnational_options.sql');
const dualLanguageLegal=read('supabase/migrations/085_v19_dual_language_legal_presentation.sql');
const preRegistrationService=read('src/services/preRegistrationLegal.ts');
const moderateMedia=read('supabase/functions/moderate-media/index.ts');
const pushDispatch=read('supabase/functions/push-dispatch/index.ts');
const exportFn=read('supabase/functions/export-download/index.ts');
const i18n=read('src/i18n/index.tsx');
const enI18n=read('src/i18n/locales/en.ts');
const suspended=read('src/screens/SuspendedAccountScreen.tsx');
const reports=read('src/screens/ReportHistoryScreen.tsx');
const legalCenter=read('src/screens/LegalPrivacyScreen.tsx');
const marketingPage=read('web/marketing-push-consent.html');
const ipPage=read('web/intellectual-property.html');
const accessibilityPage=read('web/accessibility.html');
const termsPage=read('web/terms.html');
const privacyPage=read('web/privacy.html');
const subscriptionPage=read('web/subscription-consumer.html');
const communityPage=read('web/community-guidelines.html');


check('legal gating never conditions account export, subscription management, sign-out or deletion on accepting new terms',()=>{
  assert.match(legalGateActions,/getAccountExportDownloadUrl/);
  assert.match(legalGateActions,/deleteAccount\(\)/);
  assert.match(legalGateActions,/openSubscriptionManagement/);
  assert.match(legalGateActions,/signOut\('local'\)/);
  assert.doesNotMatch(legalGateActions,/acceptLegalTerms|getCurrentLegalContext/);
  assert.ok((legalScreen.match(/<LegalGateAccountActions\/>/g)||[]).length>=3);
  assert.match(legalBlock,/<LegalGateAccountActions\/>/);
});

check('signup uses an exact country+UI-locale pre-registration legal presentation without pre-recording binding acceptance',()=>{
  assert.match(auth,/getPreRegistrationLegalPresentation\(declaredCountry,locale,declaredSubnational\)/);assert.match(auth,/preRegistration\?\.termsUrl/);assert.match(auth,/preRegistration\?\.privacyNoticeUrl/);assert.match(auth,/preRegistration\?\.communityGuidelinesUrl/);
  assert.match(auth,/preRegistrationReady/);assert.match(auth,/LEGAL_MARKET_COUNTRY_CODES/);assert.doesNotMatch(auth,/env\.(termsUrl|privacyUrl|communityGuidelinesUrl)/);
  assert.match(auth,/getPreRegistrationSubnationalOptions/);assert.match(auth,/subnationalSelectionRequired/);assert.match(auth,/declaredSubnational/);
  assert.match(auth,/accessibilityRole="checkbox"/);assert.match(auth,/auth\.ageLegal/);assert.match(auth,/legalTouch/);
  assert.match(authService,/prelegal_age_attested:true/);assert.match(authService,/pre_registration_declared_country_code/);assert.match(authService,/pre_registration_presentation_sha256/);assert.doesNotMatch(authService,/data:\{[^}]*age_18_confirmed:true/);assert.doesNotMatch(authService,/legal_version:env\.legalVersion/);
  assert.match(preRegistrationService,/get_pre_registration_legal_presentation/);
  assert.match(preRegistrationLegal,/declaredCountryIsNotFinalLegalJurisdiction/);assert.match(preRegistrationLegal,/bindingTermsAcceptanceDeferredUntilVerifiedJurisdiction/);
  assert.match(preRegistrationLegal,/pre_registration_legal_presentation_changed/);assert.match(preRegistrationLegal,/does not populate legal_country_runtime/i);
});
check('pre-registration legal notice cannot ignore required subnational scope',()=>{
  assert.match(preRegistrationSubnational,/subnational_scope_mode[\s\S]*unresolved[\s\S]*countrywide_notice_counsel_approved[\s\S]*exact_subnational_route/i);
  assert.match(configured27RuntimeAuthority,/legacy scope-mode tokens containing[\s\S]*counsel[\s\S]*backward-compatible stored evidence only/i);
  assert.match(configured27RuntimeAuthority,/public\.legal_source_approval_current[\s\S]*public\.legal_subnational_source_approved/i);
  assert.match(preRegistrationSubnational,/p\.subnational_review_required=true[\s\S]*countrywide_notice_counsel_approved/i);
  assert.match(preRegistrationSubnational,/p\.subnational_review_required=true[\s\S]*exact_subnational_route/i);
  assert.match(preRegistrationSubnational,/blocked_pre_registration_subnational_selection_required/i);
  assert.match(preRegistrationSubnational,/subnationalScopeEvidenceSha256/i);
  assert.match(authService,/pre_registration_subnational_scope_mode/);
  assert.match(authService,/pre_registration_subnational_scope_evidence_sha256/);
  assert.match(exportFn,/export_version:\s*19/);
  assert.match(exportFn,/declared_subnational_code,subnational_scope_mode,subnational_scope_evidence_sha256/);
});

check('pre-registration publication lifecycle is immutable, auditable and stale-route safe',()=>{
  assert.match(preRegistrationRouteLifecycle,/drop index if exists public\.pre_registration_legal_bundle_active_route_uq/i);
  assert.match(preRegistrationRouteLifecycle,/pre_registration_legal_bundle_routes/i);
  assert.match(preRegistrationRouteLifecycle,/pre_registration_legal_route_events/i);
  assert.match(preRegistrationRouteLifecycle,/service_set_pre_registration_legal_route/i);
  assert.match(preRegistrationRouteLifecycle,/routeRevision/);
  assert.match(preRegistrationRouteLifecycle,/pre_registration_legal_bundle_current[\s\S]*route_status='active'/i);
  assert.match(preRegistrationRouteLifecycle,/get_pre_registration_subnational_options/i);
  assert.match(preRegistrationRouteLifecycle,/blocked_pre_registration_subnational_selection_required/i);
  assert.match(preRegistrationService,/get_pre_registration_subnational_options/i);
});

check('signup age checkbox is non-authoritative pre-legal evidence and exact legal acceptance remains authoritative',()=>{
  assert.match(prelegalAgeBoundary,/insert into public\.users\(id,age_18_confirmed,legal_version\)[\s\S]*values\(new\.id,false,null\)/i);
  assert.match(prelegalAgeBoundary,/prelegal_age_attestations[\s\S]*enable row level security[\s\S]*revoke all on table public\.prelegal_age_attestations from public,anon,authenticated/i);
  assert.match(prelegalAgeBoundary,/trg_prelegal_age_attestations_append_only[\s\S]*before update or delete/i);
  assert.match(prelegalAgeBoundary,/when 'self_attestation'[\s\S]*prelegal_age_attestations/i);
  assert.match(prelegalAgeBoundary,/not exists\(select 1 from public\.legal_acceptances a where a\.user_id=u\.id\)/i);
});
check('legal acceptance source release evidence does not require external counsel',()=>{
  assert.match(acceptLegal,/source_evidence_reference[\s\S]*localization_evidence_reference/);
  assert.doesNotMatch(acceptLegal,/bundle\.counsel_evidence_reference/);
  assert.doesNotMatch(acceptLegal,/counsel_evidence_reference.*length/);
});
check('verified-session legal bundle separates binding terms/community from privacy acknowledgement',()=>{
  assert.match(acceptLegal,/user\.email_confirmed_at/);assert.match(acceptLegal,/app_security_config/);assert.match(acceptLegal,/current_terms_version/);assert.match(acceptLegal,/current_community_guidelines_version/);assert.match(acceptLegal,/current_privacy_notice_version/);assert.doesNotMatch(acceptLegal,/TAILMANCE_TERMS_VERSION|TAILMANCE_COMMUNITY_GUIDELINES_VERSION|TAILMANCE_PRIVACY_NOTICE_VERSION/);
  assert.match(acceptLegal,/accept_current_legal_bundle/);
  assert.match(legalV19,/create table if not exists public\.privacy_notice_acknowledgements/);
  assert.match(legalV19,/privacyNoticeIsConsent',false/);
  assert.match(legalScreen,/legalConsent\.privacyNoticeStatement/);
});

check('applicable-jurisdiction supplements are rendered with action semantics and accepted only against the exact displayed legal presentation',()=>{
  assert.match(legalScreen,/overlayDocuments/);assert.match(legalScreen,/document\.documentUrl/);assert.match(legalScreen,/legalConsent\.overlayAction\./);
  assert.match(legalOverlayActions,/user_action_requirement[\s\S]*acknowledgement[\s\S]*affirmative_acceptance/i);
  assert.match(legalOverlayActions,/current_legal_overlay_document_set_sha256[\s\S]*'matrixId'[\s\S]*'bundleId'[\s\S]*'baseDocuments'[\s\S]*'overlayDocuments'/i);
  assert.match(legalOverlayActions,/d\.document_type<>'marketing_push_consent'/i);
  assert.match(api,/acceptLegalTerms\(presented:/i);assert.match(api,/acceptancePresentationSha256/);
  assert.match(acceptLegal,/acceptancePresentationSha256/);assert.match(acceptLegal,/p_expected_applicability_matrix_id/);assert.match(acceptLegal,/p_expected_presentation_sha256/);
});
check('optional marketing documents stay outside mandatory presentation hash and use a separate consent digest',()=>{
  assert.match(m75,/current_legal_overlay_documents\(p_user_id,p_bundle_id\)/i);
  assert.match(m75,/document_type<>'marketing_push_consent'/i);
  assert.match(legalOverlayActions,/current_marketing_consent_document_set_sha256/i);
});
check('marketing consent uses a separately rendered exact presentation and delivery requires the current consent-document hash',()=>{
  assert.match(marketingAuthority,/get_current_marketing_consent_presentation/i);
  assert.match(marketingAuthority,/current_marketing_consent_documents[\s\S]*document_type='marketing_push_consent'/i);
  assert.match(marketingAuthority,/current_marketing_push_consent_granted[\s\S]*consent_document_set_sha256=v_sha/i);
  assert.match(marketingAuthority,/service_marketing_push_consent_user_ids/i);
  assert.match(api,/getCurrentMarketingConsentPresentation/);
  assert.match(settings,/marketingPresentation[\s\S]*baseDocument[\s\S]*overlayDocuments/);
  assert.doesNotMatch(settings,/legalContext\?\.overlayDocuments\?\.filter\(document=>document\.documentType==='marketing_push_consent'/);
  assert.match(pushDispatch,/service_marketing_push_consent_user_ids[\s\S]*marketingConsentUsers/);
  assert.match(pushDispatch,/n\.type==='marketing'&&!marketingConsentUsers\.has\(n\.user_id\)/);
});

check('marketing consent retries are exact-context idempotent and generic preferences cannot resurrect stale consent',()=>{
  assert.match(marketingRetryAuthority,/select \* into v_runtime from public\.legal_country_runtime where user_id=v_user_id for update/i);
  assert.match(marketingRetryAuthority,/where e\.user_id=v_user_id[\s\S]*e\.bundle_id=v_bundle_id[\s\S]*e\.applicability_matrix_id=v_runtime\.current_applicability_matrix_id[\s\S]*if found and v_last\.granted=true/i);
  assert.match(marketingRetryAuthority,/v_last\.consent_document_set_sha256 is not distinct from v_current_consent_document_set_sha256/i);
  assert.match(marketingRetryAuthority,/v_last\.consent_document_set_sha256 is not distinct from v_current_consent_document_set_sha256[\s\S]*then[\s\S]*'idempotent',true[\s\S]*end if;[\s\S]*perform public\.rate_limit\('marketing_push_consent',20,3600\)/i);
  assert.match(marketingRetryAuthority,/perform public\.rate_limit\('marketing_push_consent',20,3600\);[\s\S]*insert into public\.marketing_consent_events/i);
  assert.match(marketingRetryAuthority,/create or replace function public\.update_notification_preferences[\s\S]*v_marketing:=public\.current_marketing_push_consent_granted\(auth\.uid\(\)\)/i);
  assert.doesNotMatch(marketingRetryAuthority,/current_marketing_push_consent_version into v_current_consent_version/i);
});
check('marketing overlay consent documents are official-source/localization classified, origin-safe, fresh and fail closed on an unavailable digest',()=>{
  assert.match(configured27RuntimeAuthority,/marketing_consent_overlay_documents_complete/i);
  assert.match(configured27RuntimeAuthority,/'marketing_push_consent'=any\(required_document_types\)/i);
  assert.match(configured27RuntimeAuthority,/document_locale=any\(o\.required_document_locales\)/i);
  assert.match(configured27RuntimeAuthority,/legal_document_url_allowed\(d\.document_url\)/i);
  assert.match(configured27RuntimeAuthority,/reviewed_at>=now\(\)-interval '90 days'/i);
  assert.match(configured27RuntimeAuthority,/jsonb_array_length\(d\.source_evidence_reference\)>0[\s\S]*jsonb_array_length\(d\.localization_evidence_reference\)>0/i);
  assert.doesNotMatch(configured27RuntimeAuthority.slice(configured27RuntimeAuthority.indexOf('create or replace function public.marketing_consent_overlay_documents_complete'),configured27RuntimeAuthority.indexOf('create or replace function public.legal_subnational_language_requirements_satisfied')),/counsel_evidence_reference/i);
  assert.match(marketingOverlayIntegrity,/marketing_consent_document_set_unavailable/i);
  assert.match(marketingOverlayIntegrity,/p_presented_consent_document_set_sha256<>v_current_consent_document_set_sha256/i);
});
check('mandatory legal acceptance is matrix/hash bound and optional marketing permission remains independently evidenced',()=>{
  assert.match(legalOverlayActions,/legal_acceptances[\s\S]*overlay_document_set_sha256/i);
  assert.match(legalOverlayActions,/privacy_notice_acknowledgements[\s\S]*overlay_document_set_sha256/i);
  assert.match(legalOverlayActions,/current_marketing_consent_document_set_sha256/i);
  assert.match(exportFn,/export_version:\s*19/);assert.match(exportFn,/pre_registration_legal_presentations/);assert.match(exportFn,/legal_acceptance_presentations[\s\S]*presentation_sha256[\s\S]*accepted_source[\s\S]*accepted_at/i);
});

check('legacy v18 acceptance cannot bypass v19 separation',()=>{
  assert.match(legalV19,/create or replace function public\.accept_current_legal_terms/);
  assert.match(legalV19,/legacy_legal_acceptance_api_disabled/);
  assert.match(nav,/const legalLocale=locale[\s\S]*getCurrentLegalContext\(legalLocale\)/);assert.match(nav,/context\.status!==['"]ready['"]/);assert.doesNotMatch(nav,/privacyNoticeVersion===env\.privacyNoticeVersion/);
});
check('marketing consent is push-only purpose-bound append-only and legacy generic true resets closed',()=>{
  assert.match(legalV19,/create table if not exists public\.marketing_consent_events/);
  assert.match(legalV19,/channel='push'/);assert.match(legalV19,/purpose='marketing_product_updates'/);
  assert.match(legalV19,/Pre-v19 generic `marketing=true` values[\s\S]*'\{marketing\}'[\s\S]*'false'/);
  assert.match(legalV19,/reset_marketing_consent_on_version_change/);
  assert.match(api,/setMarketingPushConsent/);assert.match(settings,/changeMarketingConsent/);
  assert.match(settings,/setMarketingPushConsent\(value,value\?marketingPresentation\?\?undefined:undefined\)/);assert.match(settings,/value\?t\('settings\.marketingConsentGranted'\):t\('settings\.marketingConsentWithdrawn'\)/);
  assert.match(legalV19,/generic_notification_api_cannot_change_marketing_consent|latest_current_version_marketing_consent|marketing_consent/i);
});
check('legal/privacy center binds the full legal-document surface to the exact current country and document-locale bundle',()=>{
  assert.match(legalCenter,/getCurrentLegalContext\(locale\)/);
  for(const marker of [
    /legalContext\?\.termsUrl/,/legalContext\?\.privacyNoticeUrl/,/legalContext\?\.communityGuidelinesUrl/,
    /legalContext\?\.marketingPushConsentUrl/,/legalContext\?\.subscriptionConsumerUrl/,/legalContext\?\.moderationAppealsUrl/,
    /legalContext\?\.intellectualPropertyUrl/,/legalContext\?\.accessibilityUrl/,/legalContext\?\.supportUrl/,/legalContext\?\.accountDeletionUrl/
  ])assert.match(legalCenter,marker);
  assert.match(legalCenter,/countryJurisdictionBindingSupplement/);
  assert.match(legalCenter,/countryJurisdictionUiSupplement/);
  assert.doesNotMatch(legalCenter,/jurisdictionPrivacySupplementUrl/,'Legal Center must not use the historical generic jurisdiction supplement when exact country×language supplements are available');
  assert.doesNotMatch(legalCenter,/env\.(termsUrl|privacyUrl|communityGuidelinesUrl|marketingPushConsentUrl|kvkkUrl|subscriptionConsumerUrl|moderationAppealsUrl|intellectualPropertyUrl|accessibilityUrl|accountDeletionUrl)/);
  assert.match(legalCenter,/getAccountExportDownloadUrl/);
  assert.match(legalCenter,/contextUnavailable/);
  assert.match(nav,/name="LegalPrivacy"/);assert.match(nav,/name="ModerationAppeals"/);
});
check('marketing consent page separates product consent evidence from country and channel legal compliance',()=>{
  assert.match(marketingPage,/country|ülke/i);assert.match(marketingPage,/IYS|İYS|CASL/i);assert.match(marketingPage,/does not|tek başına|alone/i);assert.match(marketingPage,/country change|ülke değiş/i);
});
check('marketing withdrawal never depends on a still-active legal route and preserves original immutable evidence context',()=>{
  assert.match(marketingV19Withdrawal,/if p_granted=false then/i);assert.match(marketingV19Withdrawal,/settings_withdrawal_original_context/i);
  const withdrawal=marketingV19Withdrawal.slice(marketingV19Withdrawal.indexOf('if p_granted=false then'),marketingV19Withdrawal.indexOf('-- Grant path'));
  assert.doesNotMatch(withdrawal,/resolve_current_legal_bundle_id|legal_country_unresolved|current_legal_acceptance_required/i);
  for(const marker of ['v_last.bundle_id','v_last.consent_version','v_last.consent_text_sha256','v_last.country_code','v_last.locale','v_last.document_locale'])assert.match(withdrawal,new RegExp(marker.replaceAll('.','\.')));
  assert.match(api,/if\(!granted\)[\s\S]*p_consent_version:null[\s\S]*marketing_consent_withdrawal_not_confirmed/);
});
check('marketing consent is never required for core product access',()=>{
  const access=read('supabase/migrations/056_v19_legal_bundle_release_integrity.sql');
  const fn=access.slice(access.indexOf('create or replace function public.current_user_has_product_access'),access.indexOf('create or replace function public.update_preferred_locale'));
  assert.doesNotMatch(fn,/marketing_consent_events|marketing_product_updates/i);
});
check('IP center does not overclaim US DMCA safe harbor and exposes operational notice safeguards',()=>{
  assert.match(ipPage,/512|DMCA/i);assert.match(ipPage,/designated agent|atanmış temsilci|yetkilendirilmiş temsilci/i);assert.match(ipPage,/counter-notice|karşı bildirim/i);assert.match(ipPage,/repeat|tekrarlayan/i);assert.match(ipPage,/anlamına gelmez|iddia etm|does not mean/i);
});
check('accessibility center distinguishes static source checks from legal conformance and real-device evidence',()=>{
  assert.match(accessibilityPage,/sertifikası değildir|sertifika değildir|does not.*certificate/i);assert.match(accessibilityPage,/VoiceOver|TalkBack/i);assert.match(accessibilityPage,/country|ülke/i);assert.match(accessibilityPage,/counsel|hukuk/i);
});

check('base terms preserve mandatory consumer rights, limited UGC license and no-pet-marketplace/mating-off posture',()=>{
  assert.match(termsPage,/sınırlı.*lisans|limited.*license/i);
  assert.match(termsPage,/münhasır olmayan|non-exclusive/i);
  assert.match(termsPage,/pet marketplace|evcil hayvan pazar yeri/i);assert.match(termsPage,/pet satış platformu|hayvan satış platformu/i);assert.match(termsPage,/breeder marketplace|yetiştirici pazar yeri/i);
  assert.match(termsPage,/mating fail-closed|çiftleşme özelliği.*(?:fail-closed|güvenli varsayılan)/i);
  assert.match(termsPage,/kanunen vazgeçilemeyen hak|zorunlu tüketici hak/i);
  assert.match(termsPage,/hesabını silmek.*aboneliğini.*iptal etmez/i);
});
check('privacy copy exposes age-assurance provider risk without claiming raw ID/face storage',()=>{
  assert.match(privacyPage,/ham kimlik belgesi|raw kimlik belgesi|raw.*ID/i);assert.match(privacyPage,/yüz görüntüsü|face image/i);
  assert.match(privacyPage,/biyometrik|biometric/i);assert.match(privacyPage,/DPIA/i);assert.match(privacyPage,/hatalı ret|yanlış-red|false-reject/i);
  assert.match(privacyPage,/GDPR (?:Article|Madde) 27/);assert.match(privacyPage,/DSA (?:Article|Madde) 13/);
  assert.match(privacyPage,/çocuk(?:ların)? cinsel istismarı|child sexual exploitation/i);
});
check('privacy copy accurately distinguishes device location, server-side coarsening, private storage and store taxonomies',()=>{
  assert.match(privacyPage,/üç ondalık|three decimal/i);
  assert.match(privacyPage,/özel olarak (?:saklan|tutul)|private.*(?:storage|store)/i);
  assert.match(privacyPage,/yaklaşık mesafe|approximate distance/i);
  assert.match(privacyPage,/Precise Location/);
  assert.match(privacyPage,/yaklaşık konum|coarse location/i);
});
check('subscription copy separates account deletion from store cancellation and preserves local refund/withdrawal rights',()=>{
  assert.match(subscriptionPage,/hesabını silmek.*aboneliğini.*iptal etmez/i);
  assert.match(subscriptionPage,/İade|iade|refund/i);assert.match(subscriptionPage,/cayma|withdrawal/i);
  assert.match(subscriptionPage,/(?:kanunen|hukuktan doğan).*vazgeçilemez.*tüketici|vazgeçilemez tüketici/i);
  assert.match(subscriptionPage,/ücretsiz deneme|free trial/i);assert.match(subscriptionPage,/satın alımları geri yükle|restore purchases/i);
});
check('community rules explicitly block pet sales commercial breeding and severe child-safety abuse',()=>{
  assert.match(communityPage,/pet marketplace|evcil hayvan pazar yeri/i);assert.match(communityPage,/hayvan satış platformu/i);assert.match(communityPage,/breeder marketplace|yetiştirici pazar yeri/i);
  assert.match(communityPage,/fiyat.*ödeme.*kapora/s);assert.match(communityPage,/ticari yetiştirici/i);
  assert.match(communityPage,/çocukların cinsel istismarı|child sexual abuse/i);assert.match(communityPage,/preservation|veri muhafaza|kayıtlar korunabilir/i);
});
check('production provider privacy boundary explicitly covers identity, age, health and provider-side erasure',()=>{
  const ext=JSON.parse(read('release/external-legal-evidence.json')).items;
  const item=ext.international_transfer_mechanisms_and_required_local_notifications;
  assert.equal(item?.status,'not_verified');
  assert.equal(item?.repository_source_can_satisfy_alone,false);
  assert.match(item?.note??'',/owner identity verification[\s\S]*age assurance[\s\S]*health verification/i);
  assert.match(item?.note??'',/retention[\s\S]*deletion\/erasure[\s\S]*deletion handle|deletion\/erasure[\s\S]*retention[\s\S]*deletion handle/i);
});

check('external legal evidence separately blocks age-assurance privacy, representatives, subscription operations and illegal-content reporting',()=>{
  const ext=JSON.parse(read('release/external-legal-evidence.json')).items;
  for(const key of ['age_assurance_vendor_privacy_biometric_dpia_retention_and_accessible_redress','country_specific_privacy_or_platform_representative_appointment_and_public_contact','market_specific_subscription_cancellation_refund_withdrawal_disclosures_and_support_runbook','illegal_content_child_safety_emergency_reporting_preservation_and_law_enforcement_runbook','market_specific_digital_service_platform_app_registration_licensing_filing_notification_and_verification']){
    assert.equal(ext[key]?.status,'not_verified',`${key} must remain external NO-GO`);assert.deepEqual(ext[key]?.evidence_reference,[]);
  }
});

check('premium uses live store price and exact-context consumer documents with a service-layer purchase guard',()=>{
  assert.match(premium,/pkg\.product\.priceString/);assert.match(premium,/premium\.planDisclosure/);assert.match(premium,/restorePurchases/);assert.match(premium,/openSubscriptionManagement/);assert.match(premium,/getCurrentLegalContext\(requestedLocale\)[\s\S]*getCurrentLegalContext\(purchaseLocale\)/);assert.match(premium,/legalContext\?\.subscriptionConsumerUrl/);assert.doesNotMatch(premium,/env\.subscriptionConsumerUrl/);
  assert.match(premium,/purchasePremium\(packageSnapshot,\{bundleId:submittedContext\.bundleId![\s\S]*applicabilityMatrixId:submittedContext\.applicabilityMatrixId![\s\S]*uiLocale:purchaseLocale[\s\S]*subscriptionPurchaseDocumentSetSha256:submittedContext\.subscriptionPurchaseDocumentSetSha256!/i);
  assert.match(purchases,/type PurchaseLegalGuard=[\s\S]*bundleId:string[\s\S]*applicabilityMatrixId:string[\s\S]*uiLocale:string[\s\S]*subscriptionPurchaseDocumentSetSha256:string/i);
  assert.match(purchases,/assertPurchaseLegalGuard[\s\S]*get_current_legal_context[\s\S]*subscription_legal_documents_changed_review_required/i);
  assert.match(purchases,/purchasePremium\(pkg: PurchasesPackage, legalGuard:PurchaseLegalGuard\)[\s\S]*await assertPurchaseLegalGuard\(legalGuard\)[\s\S]*Purchases\.purchasePackage\(pkg\)/i);
});
check('moderation decisions are auditable with six-month appeals human review and restore-before-reversed invariant',()=>{
  assert.match(moderationV19,/create table if not exists public\.moderation_decisions/);assert.match(moderationV19,/create table if not exists public\.moderation_appeals/);
  assert.match(moderationV19,/interval '6 months'/);assert.match(moderationV19,/human_reviewer_reference_required/);assert.match(moderationV19,/restore_product_state_before_reversal/);
  assert.match(moderationV19,/status<>'reversed'[\s\S]*restoration_completed_at is not null/);
  assert.match(moderationBridge,/record_moderation_restriction_decision/);
  assert.match(moderationRestoration,/assert_moderation_restoration_safe/);assert.match(moderationRestoration,/independent_active_restriction_remains/);
  assert.match(moderationRestoration,/confirm_moderation_restoration_for_source[\s\S]*moderation_status='approved'/);
  assert.match(moderationAdmin,/decision==='approved'[\s\S]*assertRestorationSafe/);assert.match(moderationAdmin,/confirmRestorationIfPresent/);
});
check('structured moderation statements are append-only, user-visible, redress-aware and block solely automated account restriction',()=>{
  assert.match(moderationStatement,/create table if not exists public\.moderation_statement_of_reasons/i);
  assert.match(moderationStatement,/trg_moderation_statement_append_only/i);
  assert.match(moderationStatement,/basis_type in \('illegal_content','terms_violation','both','other'\)/i);
  assert.match(moderationStatement,/account_restriction_cannot_be_solely_automated/i);
  for(const marker of ['factsSummary','territorialScope','legalGroundReference','termsGroundReference','automatedDetectionUsed','automatedDecisionUsed','redressAvailable','redressDeadline'])assert.match(moderationStatement,new RegExp(marker));
  assert.match(read('src/screens/ModerationAppealsScreen.tsx'),/basisType[\s\S]*factsSummary[\s\S]*legalGroundReference[\s\S]*termsGroundReference/i);
});
check('restriction decision and statement commit through one atomic service RPC and legacy restriction creation fails closed',()=>{
  assert.match(moderationAtomic,/record_moderation_restriction_decision_v2[\s\S]*_record_moderation_restriction_decision_core[\s\S]*record_moderation_statement_of_reasons/i);
  assert.match(moderationAtomic,/structured_statement_required_use_record_moderation_restriction_decision_v2/i);
  assert.match(moderationAtomic,/admin_set_account_restriction_v2[\s\S]*record_moderation_statement_of_reasons/i);
  assert.match(moderationAtomic,/structured_statement_required_use_admin_set_account_restriction_v2/i);
  assert.doesNotMatch(moderationAtomic,/grant execute on function public\._(?:record_moderation_restriction_decision_core|admin_set_account_restriction_core).*service_role/i);
  assert.equal((moderateMedia.match(/record_moderation_restriction_decision_v2/g)||[]).length,2);
  assert.doesNotMatch(moderateMedia,/rpc\('record_moderation_restriction_decision'/i);
  assert.doesNotMatch(moderateMedia,/rpc\('record_moderation_statement_of_reasons'/i);
});
check('account export contains moderation statement-of-reasons without privileged reviewer/internal fields',()=>{
  assert.match(exportFn,/moderation_statements[\s\S]*basis_type[\s\S]*facts_summary[\s\S]*territorial_scope[\s\S]*redress_deadline/i);
  const decisions=exportFn.match(/\['moderation_decisions',[^\n]+/i)?.[0]??'';
  assert.doesNotMatch(decisions,/internal_reason|reviewer_reference/i);
});
check('account suspension is tied to user-visible decision and in-app appeal',()=>{
  assert.match(moderationV19,/admin_set_account_restriction/);assert.match(moderationV19,/action='account_restricted'/);
  assert.match(suspended,/getMyModerationDecisions/);assert.match(suspended,/activeRestriction\.reason/);assert.match(suspended,/submitModerationAppeal/);
});
check('report closure requires user-visible explanation and report history renders it',()=>{
  assert.match(moderationV19,/resolution_explanation_required/);assert.match(moderationV19,/report_resolved/);assert.match(moderationV19,/report_dismissed/);
  assert.match(moderationRestoration,/admin_update_report_status[\s\S]*v_report\.moderation_decision_id[\s\S]*v_decision\.action=v_action/);
  assert.match(reports,/item\.resolutionExplanation/);assert.match(reports,/ModerationAppeals/);
});
check('account export v14 includes legal-country, applicability, age-assurance, consent, moderation and appeal history without raw provider evidence',()=>{
  assert.match(exportFn,/export_version:\s*19/);
  for(const marker of ['legal_country_runtime','legal_applicability_matrices','legal_applicability_overlays','legal_age_assurance_history','legal_acceptances','privacy_notice_acknowledgements','marketing_consent_history','moderation_decisions','moderation_appeals'])assert.match(exportFn,new RegExp(marker));
  assert.doesNotMatch(exportFn,/legal_age_assurance_events'\)\.select\([^\n]*(provider_reference_sha256|evidence_reference|created_by)/);
});
check('global legal URLs are limited to explicitly non-binding pre-signup review; restricted accounts require exact context-bound support',()=>{
  const auth=read('src/screens/AuthScreen.tsx');const paused=read('src/screens/PausedAccountScreen.tsx');const suspended=read('src/screens/SuspendedAccountScreen.tsx');
  assert.match(auth,/auth\.ageLegal/);assert.match(enI18n,/binding Terms and Community Guidelines acceptance happens only after email verification/i);
  for(const screen of [paused,suspended]){
    assert.match(screen,/requestedLocale=localeRef\.current[\s\S]*getRestrictedAccountLegalSupport\(requestedLocale\)[\s\S]*localeRef\.current!==requestedLocale/i);
    assert.doesNotMatch(screen,/env\.supportUrl|getCurrentLegalContext\(locale\)/i);
  }
  for(const file of ['src/screens/LegalPrivacyScreen.tsx','src/screens/PremiumScreen.tsx','src/screens/SettingsScreen.tsx','src/screens/SafetyCenterScreen.tsx','src/screens/PausedAccountScreen.tsx','src/screens/SuspendedAccountScreen.tsx'])assert.doesNotMatch(read(file),/env\.(termsUrl|privacyUrl|communityGuidelinesUrl|marketingConsentUrl|subscriptionConsumerUrl|moderationAppealsUrl|supportUrl|accountDeletionWebUrl)/i);
});
check('pre-permission UX gates camera location and notification system prompts',()=>{
  const prompt=read('src/services/permissionPrompts.ts');const loc=read('src/services/location.ts');const uploads=read('src/services/uploads.ts');const notifications=read('src/services/notifications.ts');
  assert.match(prompt,/confirmPrePermission/);assert.match(loc,/getForegroundPermissionsAsync/);assert.match(loc,/confirmPrePermission\('location'\)/);assert.match(uploads,/getCameraPermissionsAsync/);assert.match(uploads,/confirmPrePermission\('camera'\)/);assert.match(notifications,/confirmPrePermission\('notifications'\)/);
  assert.doesNotMatch(uploads,/requestMediaLibraryPermissionsAsync/);assert.match(app,/microphonePermission:\s*'Tailmance uses the microphone only when you start or accept a matched-pet audio or video call\.'/);for(const permission of ['READ_MEDIA_IMAGES','READ_MEDIA_VIDEO','READ_EXTERNAL_STORAGE'])assert.match(app,new RegExp(`blockedPermissions:[\\s\\S]*${permission}`));assert.match(app,/permissions:\s*\[[^\]]*CAMERA[^\]]*RECORD_AUDIO/s);assert.match(app,/NSMicrophoneUsageDescription:[\s\S]*matched-pet audio or video call/);assert.match(read('src/screens/ChatScreen.tsx'),/confirmPrePermission\('calls'\)/);
});
check('country registry is structurally fail-closed and wired to production release',()=>{
  const matrix=JSON.parse(read('release/country-release-gates.json'));const pkg=JSON.parse(read('package.json'));const gate=read('scripts/country-release-check.mjs');
  assert.equal(matrix.default_policy.unknown_or_unlisted_iso_country,'BLOCK');assert.equal(Object.keys(matrix.markets).length,27);
  for(const code of Object.keys(matrix.markets)){const m=matrix.markets[code];assert.equal(m.legal_review_required,true);for(const field of ['legal_review_status','effective_date','reviewed_at','reviewer','evidence_reference','compliance'])assert.ok(Object.hasOwn(m,field),`${code}: ${field} missing`)}
  assert.match(gate,/PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW/);assert.match(gate,/PASS_INTERNAL_LEGAL_LANGUAGE_QA/);assert.match(gate,/exact country×document-locale/i);assert.doesNotMatch(gate,/approved_by_external_counsel/);assert.match(pkg.scripts['release:check'],/release-check-all\.mjs/);assert.match(read('scripts/release-check-all.mjs'),/release:country/);
});
check('current Indonesia PP TUNAS operations stay external while Australia September eSafety source reassessment is internally pinned',()=>{
  const ext=JSON.parse(read('release/external-legal-evidence.json')).items;
  const matrix=JSON.parse(read('release/country-release-gates.json')).markets;
  const id='indonesia_pp_tunas_plf_self_assessment_verification_risk_profile_and_operational_reporting_evidence';
  assert.equal(ext[id]?.status,'not_verified',`${id} must remain production-operational NO-GO`);assert.deepEqual(ext[id]?.evidence_reference,[]);
  const au='australia_esafety_september_2026_post_federal_court_service_category_reassessment';
  assert.equal(ext[au]?.status,'verified',`${au} source reassessment must be internally verified`);
  assert.equal(ext[au]?.evidence_boundary_class,'repository_source_internal_qa');
  assert.ok((ext[au]?.evidence_reference??[]).length>0);
  assert.ok(matrix.ID.special_gates.includes('PP_TUNAS_PLF_self_assessment_verification_and_risk_profile_determination_if_in_scope'));
  assert.ok(matrix.AU.special_gates.includes('eSafety_September_2026_regulatory_guidance_post_Federal_Court_applicability_reassessment'));
});
check('priority jurisdiction gates are explicit rather than implied by generic privacy compliance',()=>{
  const m=JSON.parse(read('release/country-release-gates.json')).markets;
  for(const code of ['AT','BE','DE','ES','FR','IE','IT','NL','PL'])assert.ok(m[code].special_gates.includes('DSA_service_classification_and_exemptions'));
  for(const gate of ['KVKK_standard_contract_5_business_day_notification_if_used','KVKK_cross_border_subprocessor_chain_inventory'])assert.ok(m.TR.special_gates.includes(gate));
  for(const gate of ['OSA_user_to_user_scope_assessment','OSA_childrens_access_assessment'])assert.ok(m.GB.special_gates.includes(gate));
  for(const gate of ['social_media_minimum_age_scope_assessment','reasonable_age_assurance_steps_evidence'])assert.ok(m.AU.special_gates.includes(gate));
  assert.ok(m.IN.special_gates.includes('DPDP_Rules_2025_phased_commencement_date_check'));
  assert.ok(m.KR.special_gates.includes('Google_Play_KR_subscription_price_step_up_and_paid_conversion_consent_2026'));
});
check('Apple and Google ratings remain console questionnaire outputs, not invented constants',()=>{
  const store=JSON.parse(read('release/store-compliance-v19.json'));
  assert.deepEqual(store.apple_age_rating.current_scale,['4+','9+','13+','16+','18+']);assert.equal(store.apple_age_rating.social_media_question_required,true);assert.equal(store.apple_age_rating.questionnaire_result,null);assert.equal(store.google_iarc.questionnaire_result,null);
});
check('Apple/Google location declarations follow platform taxonomies from actual source behavior',()=>{
  const store=JSON.parse(read('release/store-compliance-v19.json'));
  assert.equal(store.apple_app_privacy.location.declaration_classification,'Precise Location');assert.equal(store.google_data_safety.location.declaration_classification,'Approximate location');
  assert.match(read('src/services/location.ts'),/Math\.round\(value\*1000\)\/1000/);assert.match(app,/ACCESS_COARSE_LOCATION/);assert.match(app,/ACCESS_FINE_LOCATION/);
});
check('public web deletion path does not require reinstall and has source identity-verification boundary',()=>{
  const html=read('web/delete-account.html'),js=read('web/delete-account.js'),processor=read('supabase/functions/process-account-deletion-request/index.ts'),webConfig=read('web/config.js'),webConfigGenerator=read('scripts/generate-web-runtime-config.mjs');
  assert.match(html,/uygulamayı yeniden yüklemeden/i);assert.match(html,/deleteForm/);assert.match(js,/deletionRequestEndpoint/);assert.match(processor,/identityVerified!==true/);assert.match(processor,/verificationReference/);
  assert.match(webConfig,/TAILMANCE_WEB_CONFIG/);assert.match(webConfigGenerator,/TAILMANCE_WEB_DELETION_ENDPOINT/);assert.match(webConfigGenerator,/protocol!==['"]https:['"]/);assert.match(webConfigGenerator,/embedded credentials are forbidden/);
});
check('Apple UGC source controls cover filtering reporting blocking and contact publication',()=>{
  assert.match(read('supabase/functions/moderate-media/index.ts'),/moderation/i);assert.match(api,/reportPet/);assert.match(api,/blockPet/);assert.match(read('web/support.html'),/mailto:yektaozel@icloud\.com/);
});
check('configured-27 source legal/language evidence is internally verified while live/store/operator evidence stays external and unconfigured countries stay out of scope',()=>{
  const ext=JSON.parse(read('release/external-legal-evidence.json'));const store=JSON.parse(read('release/store-compliance-v19.json'));const pkg=JSON.parse(read('package.json'));
  let sourceVerified=0, ownerAttested=0, externalPending=0, outOfScope=0;
  for(const [name,item] of Object.entries(ext.items)){
    assert.ok(!['external_counsel_or_regulatory_applicability','professional_or_certified_localization_external','country_by_country_external_review'].includes(item.evidence_boundary_class),`${name}: deprecated external counsel/localization boundary`);
    if(item.status==='verified'&&item.evidence_boundary_class==='real_identity_registration_or_market_operator_external'){ownerAttested++;assert.ok((item.evidence_reference??[]).length>0&&item.evidence_reference.every(ref=>/^owner-attestation:20\d\d-\d\d-\d\d:/.test(ref)),`${name}: owner-attested operator fact needs a dated owner-attestation reference`);}
    else if(item.status==='verified'){sourceVerified++;assert.equal(item.evidence_boundary_class,'repository_source_internal_qa',`${name}: only repository/internal QA may be source verified`);assert.ok((item.evidence_reference??[]).length>0,`${name}: verified source evidence reference required`);}
    else if(item.status==='not_applicable'){outOfScope++;assert.equal(item.evidence_boundary_class,'out_of_scope_unconfigured_country');}
    else {externalPending++;assert.equal(item.status,'not_verified');assert.notEqual(item.evidence_boundary_class,'repository_source_internal_qa',`${name}: source-remediable evidence may not remain external pending`);assert.deepEqual(item.evidence_reference,[]);}
  }
  assert.equal(sourceVerified,20);assert.equal(ownerAttested,3);assert.equal(externalPending,56);assert.equal(outOfScope,1);
  assert.equal(store.google_account_deletion.production_endpoint_status,'not_verified');assert.match(pkg.scripts['release:check'],/release-check-all\.mjs/);const releaseRunner=read('scripts/release-check-all.mjs');assert.match(releaseRunner,/release:external-legal/);assert.match(releaseRunner,/release:store-compliance/);
});
check('Google Play child-safety source controls do not self-certify production compliance',()=>{
  const store=JSON.parse(read('release/store-compliance-v19.json'));const ext=JSON.parse(read('release/external-legal-evidence.json')).items;
  assert.equal(store.google_child_safety_standards.internal_18_plus_is_not_a_policy_exemption,true);
  assert.equal(store.google_child_safety_standards.play_console_self_certification_status,'not_verified');
  assert.match(read('web/support.html'),/Çocuk güvenliği irtibat kişisi/i);
  for(const key of ['google_play_child_safety_standards_self_certification_and_designated_contact_operations','google_play_age_restricted_content_scope_and_restrict_minor_access_console_evidence']){
    assert.equal(ext[key]?.status,'not_verified',`${key} must remain external NO-GO`);assert.deepEqual(ext[key]?.evidence_reference,[]);
  }
});

check('Apple 2026 regional age-assurance and regional-rating evidence stays external',()=>{
  const ext=JSON.parse(read('release/external-legal-evidence.json')).items;
  const store=JSON.parse(read('release/store-compliance-v19.json'));
  for(const key of ['apple_AU_BR_SG_18plus_distribution_and_declared_age_range_production_evidence','apple_AU_VN_regional_age_rating_console_evidence']){
    assert.equal(ext[key]?.status,'not_verified',`${key} must remain external NO-GO`);
    assert.deepEqual(ext[key]?.evidence_reference,[]);
  }
  assert.equal(store.apple_regional_age_assurance_distribution_2026.production_distribution_behavior_status,'not_verified');
  assert.equal(store.apple_regional_age_rating_updates_2026.australia.console_rating_evidence_status,'not_verified');
  assert.equal(store.apple_regional_age_rating_updates_2026.vietnam.console_rating_evidence_status,'not_verified');
});

check('U.S. state app-store and OS age-assurance matrix remains independently fail-closed',()=>{
  const ext=JSON.parse(read('release/external-legal-evidence.json')).items;
  const us=JSON.parse(read('release/us-subnational-digital-age-review-v19.json'));
  assert.equal(ext.us_state_app_store_age_assurance_counsel_and_production_integration?.status,'not_verified');
  assert.deepEqual(ext.us_state_app_store_age_assurance_counsel_and_production_integration?.evidence_reference,[]);
  assert.equal(us.matrix_complete,false);
  assert.match(us.release_status,/^BLOCK_/);
  assert.ok(us.closure_requirements.some(x=>/50-state.*District of Columbia.*territory/i.test(x)));
});

check('Apple social-media source fact is explicit while App Store Connect answer stays external',()=>{
  const store=JSON.parse(read('release/store-compliance-v19.json'));
  assert.equal(store.apple_age_rating.source_observed_social_media_capability,true);
  assert.equal(store.apple_age_rating.social_media_capability_console_answer_status,'not_verified');
  assert.ok(store.apple_age_rating.source_observed_social_media_evidence.includes('src/screens/FeedScreen.tsx'));
});
check('Google adult target-audience and account-deletion console declarations stay fail-closed',()=>{
  const store=JSON.parse(read('release/store-compliance-v19.json'));const ext=JSON.parse(read('release/external-legal-evidence.json')).items;
  assert.equal(store.google_target_audience_and_minor_access.product_policy_target_age,'18_and_over_only');
  assert.equal(store.google_target_audience_and_minor_access.target_audience_console_status,'not_verified');
  assert.equal(store.google_target_audience_and_minor_access.restrict_minor_access_configuration_status,'not_verified');
  assert.equal(store.google_account_deletion.data_safety_deletion_url_console_status,'not_verified');
  for(const key of ['google_play_target_audience_18_plus_and_minor_access_console_evidence','google_play_account_deletion_data_safety_url_and_form_console_evidence']){
    assert.equal(ext[key]?.status,'not_verified',`${key} must remain external NO-GO`);assert.deepEqual(ext[key]?.evidence_reference,[]);
  }
});
check('Apple September 2026 multiseat subscription option cannot silently diverge from Tailmance entitlement model',()=>{
  const store=JSON.parse(read('release/store-compliance-v19.json'));const ext=JSON.parse(read('release/external-legal-evidence.json')).items;
  assert.equal(store.subscription.apple_multiseat_purchase_option.legacy_exception_cutoff_date,'2026-09-14');
  assert.equal(store.subscription.apple_multiseat_purchase_option.console_configuration_status,'not_verified');
  assert.match(store.subscription.apple_multiseat_purchase_option.tailmance_entitlement_model_note,/individual account entitlement/i);
  assert.equal(ext.apple_subscription_multiseat_purchase_option_and_entitlement_model_console_evidence?.status,'not_verified');
});
check('Google Play global package registration and regional Android verification are separated and fail-closed',()=>{
  const store=JSON.parse(read('release/store-compliance-v19.json'));const ext=JSON.parse(read('release/external-legal-evidence.json')).items;
  assert.equal(store.android_developer_verification.play_package_registration_scope,'all_Google_Play_packages_global');
  assert.equal(store.android_developer_verification.play_package_registration_deadline,'2026-09-30');
  assert.deepEqual(store.android_developer_verification.regional_certified_device_enforcement_initial_markets,['BR','ID','SG','TH']);
  assert.equal(store.android_developer_verification.regional_certified_device_enforcement_effective_date,'2026-09-30');
  assert.equal(store.android_developer_verification.must_not_mark_current_before_effective_date,true);
  assert.equal(store.android_developer_verification.current_effective_date_reached,true);
  assert.equal(store.android_developer_verification.status_as_of_2026_09_30,'current_effective_external_verification_required');
  assert.equal(store.android_developer_verification.play_package_registration_status_as_of_2026_09_30,'current_effective_global_Play_external_console_verification_required');
  assert.equal(store.android_developer_verification.regional_certified_device_enforcement_status_as_of_2026_09_30,'current_effective_initial_markets_external_verification_required');
  assert.equal(store.android_developer_verification.global_play_package_registration_evidence_status,'not_verified');
  assert.equal(store.android_developer_verification.regional_certified_device_enforcement_evidence_status,'not_verified');
  assert.match(store.android_developer_verification.scope_separation_invariant,/must not be narrowed to BR\/ID\/SG\/TH/i);
  assert.equal(ext.google_play_package_registration_global_2026_09_30?.status,'not_verified');
  assert.equal(ext.android_developer_verification_regional_enforcement_2026_09_30_initial_markets?.status,'not_verified');
});


check('account restriction requires attributable human decision',()=>{
  const humanGate=read('supabase/migrations/067_v19_human_account_restriction_gate.sql');
  assert.match(humanGate,/p_restricted and p_source<>'manual'/i);
  assert.match(humanGate,/account_restriction_requires_human_decision/i);
  assert.match(humanGate,/account_restriction_requires_human_reviewer_reference/i);
});



check('dual-language legal presentation keeps governing documents authoritative while requiring UI-language comprehension mirrors when languages differ',()=>{
  assert.match(dualLanguageLegal,/legal_bundle_comprehension_documents/i);
  assert.match(dualLanguageLegal,/legal_overlay_comprehension_documents/i);
  assert.match(dualLanguageLegal,/source_document_sha256/i);
  assert.match(dualLanguageLegal,/document_sha256/i);
  assert.match(dualLanguageLegal,/source_document_version=v_source\.document_version[\s\S]*source_document_sha256=v_source\.document_sha256/i);
  assert.match(dualLanguageLegal,/v_source\.document_locale<>v_locale and not exists/i);
  assert.match(dualLanguageLegal,/legal_comprehension_documents_complete\(b\.bundle_id,v_locale\)/i);
  assert.match(dualLanguageLegal,/legal_overlay_comprehension_documents_complete\(p_user_id,v_bundle_id,v_locale\)/i);
  assert.match(dualLanguageLegal,/comprehensionDocumentSetSha256/i);
  assert.match(api,/comprehensionDocumentSetSha256/);
  assert.match(legalScreen,/comprehensionDocuments/);
  assert.match(premium,/comprehensionDocuments/);
  assert.match(settings,/comprehensionDocument/);
});

check('public Turkish legal pages must avoid internal English operational jargon',()=>{
  const publicCopy=['web/community-guidelines.html','web/support.html','web/moderation-appeals.html','web/privacy.html','web/kvkk.html','web/marketing-push-consent.html'].map(read).join('\n');
  for(const pattern of [/self-certification/i,/\bescalation\b/i,/\bmanuel\b/i,/purpose=/i,/channel=/i,/marketing=true/i])assert.doesNotMatch(publicCopy,pattern);
});


check('Brazil paid-promotion source architecture tracks Portaria 3/2026 future-effective duties without premature activation',()=>{
  assert.match(brPromotion,/Portaria Conjunta SENACON\/SEDIGI\/SPDIGI nº 3\/2026/);
  assert.match(brPromotion,/2026-10-23/);
  assert.match(brPromotion,/2026-12-22/);
  assert.match(brPromotion,/minimum_record_retention_days integer not null default 365/);
  assert.match(brPromotion,/public_repository_ready/);
  assert.match(brPromotion,/material_relationship_disclosure_ready/);
  assert.match(brPromotion,/financial_advertiser_verification_ready/);
});
console.log(`legal-policy-checks: ${checks.length}/${checks.length} v19 static legal/compliance controls PASS; production evidence remains separate fail-closed release gates`);
