import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(p,'utf8');
const m54=read('supabase/migrations/054_v19_legal_country_bundle_architecture.sql');
const m55=read('supabase/migrations/055_v19_legal_country_bundle_enforcement.sql');
const m56=read('supabase/migrations/056_v19_legal_bundle_release_integrity.sql');
const m57=read('supabase/migrations/057_v19_jurisdiction_runtime_policy_and_age_assurance.sql');
const m58=read('supabase/migrations/058_v19_full_jurisdiction_control_reviews.sql');
const m59=read('supabase/migrations/059_v19_combined_legal_control_subdimension_evidence.sql');
const m61=read('supabase/migrations/061_v19_canonical_22_legal_control_families.sql');
const m62=read('supabase/migrations/062_v19_control_review_freshness_enforcement.sql');
const m63=read('supabase/migrations/063_v19_legal_jurisdiction_signal_provenance.sql');
const m64=read('supabase/migrations/064_v19_context_bound_legal_document_manifest.sql');
const m65=read('supabase/migrations/065_v19_subnational_language_route_matrix.sql');
const m66=read('supabase/migrations/066_v19_legal_context_block_reason_precision.sql');
const m68=read('supabase/migrations/068_v19_multi_jurisdiction_applicability_matrix.sql');
const m71=read('supabase/migrations/071_v19_overlay_legal_document_user_action_evidence.sql');
const m72=read('supabase/migrations/072_v19_legal_acceptance_presentation_binding.sql');
const m75=read('supabase/migrations/075_v19_mandatory_acceptance_optional_marketing_separation.sql');
const m77=read('supabase/migrations/077_v19_marketing_consent_presentation_and_delivery_authority.sql');
const m79=read('supabase/migrations/079_v19_marketing_overlay_document_integrity.sql');
const m80=read('supabase/migrations/080_v19_restricted_account_context_bound_support.sql');
const m81=read('supabase/migrations/081_v19_pre_registration_legal_presentation_binding.sql');
const m82=read('supabase/migrations/082_v19_pre_registration_subnational_scope_binding.sql');
const m85=read('supabase/migrations/085_v19_dual_language_legal_presentation.sql');
const m86=read('supabase/migrations/086_v19_exact_overlay_document_classification.sql');
const m136=read('supabase/migrations/136_exact_country_language_supplement_runtime_presentation.sql');
const m137=read('supabase/migrations/137_pre_registration_official_source_scope_terminology.sql');
const legalMarkets=read('src/data/legalMarkets.ts');
const auth=read('src/screens/AuthScreen.tsx');
const api=read('src/services/api.ts');
const navigator=read('src/navigation/AppNavigator.tsx');
const consent=read('src/screens/LegalConsentScreen.tsx');
const center=read('src/screens/LegalPrivacyScreen.tsx');
const premium=read('src/screens/PremiumScreen.tsx');
const settings=read('src/screens/SettingsScreen.tsx');
const safety=read('src/screens/SafetyCenterScreen.tsx');
const i18n=read('src/i18n/locales/en.ts');
const exportFn=read('supabase/functions/export-download/index.ts');
const registry=JSON.parse(read('release/country-release-gates.json'));
const subdivisionUniverse=JSON.parse(read('release/configured-market-subdivision-universe-v19.json'));
const expected=['AE','AT','AU','BE','BR','CA','CN','DE','ES','FR','GB','ID','IE','IN','IT','JP','KR','NL','PL','RU','SA','SG','TH','TR','TW','US','VN'];

const cases=[];const ok=(name,fn)=>{fn();cases.push(name)};

ok('pre-registration country signal and UI language are separate, non-authoritative dimensions bound to an exact public presentation',()=>{
  assert.match(m81,/declared_country_code[\s\S]*ui_locale[\s\S]*document_locale/i);
  assert.match(m81,/where b\.declared_country_code=v_country and b\.ui_locale=v_locale/i);
  assert.match(m81,/declaredCountryIsNotFinalLegalJurisdiction/);
  assert.doesNotMatch(m81,/insert into public\.legal_country_runtime/);
  assert.match(auth,/getPreRegistrationLegalPresentation\(declaredCountry,locale,declaredSubnational\)/);
});
ok('pre-registration country route is subnational-scope aware and unresolved scope fails closed',()=>{
  assert.match(m82,/subnational_scope_mode text not null default 'unresolved'/i);
  assert.match(m82,/jsonb_array_length\(b\.subnational_scope_evidence_reference\)>0/i);
  assert.match(m82,/p\.subnational_review_required=false[\s\S]*not_required_with_counsel_evidence/i);
  assert.match(m82,/p\.subnational_review_required=true[\s\S]*countrywide_notice_counsel_approved/i);
  assert.match(m82,/p\.subnational_review_required=true[\s\S]*exact_subnational_route/i);
  assert.match(m82,/blocked_pre_registration_exact_subnational_presentation_unavailable/i);
  assert.match(m82,/blocked_pre_registration_subnational_selection_required/i);
  assert.match(m82,/pre_registration_subnational_scope_changed/i);
});
ok('pre-registration exact subdivision cannot silently fall back when an exact active route exists but is stale',()=>{
  assert.match(m82,/v_exact_exists boolean:=false/i);
  assert.match(m82,/if v_exact_exists then[\s\S]*blocked_pre_registration_exact_subnational_presentation_unavailable/i);
  assert.match(m82,/if not v_exact_exists then[\s\S]*declared_subnational_code is null/i);
});
ok('client pre-registration country choices exactly match the 27 canonical configured markets',()=>{
  const codes=[...legalMarkets.matchAll(/'([A-Z]{2})'/g)].map(x=>x[1]);
  assert.deepEqual([...new Set(codes)].sort(),expected);
  assert.deepEqual(Object.keys(registry.markets).sort(),expected);
});
ok('configured-market subdivision universe has 27/27 source structure review while exact material runtime overlays stay context-bound',()=>{
  assert.deepEqual(Object.keys(subdivisionUniverse.markets).sort(),expected);
  assert.equal(subdivisionUniverse.summary.configured_markets,expected.length);
  assert.equal(subdivisionUniverse.summary.iso_subdivisions_enumerated,1278);
  assert.equal(subdivisionUniverse.summary.legal_applicability_complete_markets,0);
  for(const code of expected){
    const market=subdivisionUniverse.markets[code];
    assert.ok(market.subdivision_count>0,`${code}: subdivision structure missing`);
    assert.equal(market.source_structure_review_status,'PASS_INTERNAL_OFFICIAL_SOURCE_STRUCTURE_REVIEW',`${code}: source structure review`);
    assert.equal(market.source_legal_blocker,false,`${code}: structural inventory must not be a source blocker`);
    assert.equal(market.legal_mapping_status,'SOURCE_STRUCTURE_REVIEWED_RUNTIME_CONTEXT_BOUND',`${code}: exact runtime overlay remains context-bound`);
    for(const subdivision of market.subdivisions){
      assert.match(subdivision.code,new RegExp(`^${code}-[A-Z0-9-]+$`),`${code}: invalid subdivision ${subdivision.code}`);
    }
  }
});
ok('structural subdivision identifiers cannot create a legal route without exact or counsel-approved countrywide evidence',()=>{
  assert.match(m82,/v_sub<>''[\s\S]*left\(v_sub,3\)<>v_country\|\|'-'/i);
  assert.match(m82,/where b\.declared_country_code=v_country and b\.ui_locale=v_locale and b\.declared_subnational_code=v_sub and b\.status='active'/i);
  assert.match(m82,/if v_exact_exists then[\s\S]*blocked_pre_registration_exact_subnational_presentation_unavailable/i);
  assert.match(m82,/if not v_exact_exists then[\s\S]*declared_subnational_code is null/i);
  assert.match(m82,/countrywide_notice_counsel_approved/i);
  assert.match(m58,/r\.legal_subnational_code=case when v_policy\.subnational_review_required then coalesce\(v_runtime\.legal_subnational_code,''\) else '' end/i);
  assert.match(m58,/coalesce\(b\.legal_subnational_code,''\)=r\.legal_subnational_code/i);
});
ok('legal country, subnational context, storefront/operational country and UI locale are distinct dimensions',()=>{
  for(const token of ['legal_country_code','legal_subnational_code','storefront_country_code','operational_country_code'])assert.match(m54,new RegExp(token,'i'));
  assert.match(m54,/ui_locale\s+text/i);
});
ok('TR legal country + DE UI cannot infer Germany law and can resolve only an exact TR+DE route',()=>{
  assert.match(m57,/where r\.legal_country_code=v_runtime\.legal_country_code/i);assert.match(m57,/and r\.ui_locale=v_locale/i);
  assert.doesNotMatch(m57,/v_runtime\.legal_country_code\s*:?=\s*v_locale/i);
});
ok('DE legal country + TR UI remains an exact Germany legal route',()=>{assert.match(m57,/r\.legal_country_code=v_runtime\.legal_country_code/i);assert.match(m57,/r\.ui_locale=v_locale/i)});
ok('UI locale is not constrained to country legal-document locales',()=>{
  const resolver=m58.slice(m58.indexOf('create or replace function public.resolve_current_legal_bundle_id'),m58.indexOf('create or replace function public.enforce_legal_bundle_route_release_evidence'));
  assert.doesNotMatch(resolver,/v_locale=any\(v_policy\.(launch_document_locales|approved_document_locales)\)/i);
  assert.match(resolver,/b\.document_locale=any\(v_policy\.approved_document_locales\)/i);
});
ok('launch document locales and counsel-approved document locales are separate',()=>{
  assert.match(m57,/launch_document_locales\s+text\[\]/i);assert.match(m57,/approved_document_locales\s+text\[\]/i);
  assert.match(m57,/cardinality\(approved_document_locales\)>0/i);
});
ok('country/subnational change invalidates projected acceptance and marketing',()=>{
  assert.match(m57,/v_previous_country is distinct from nullif\(v_country,''\)/i);assert.match(m57,/v_previous_subnational is distinct from nullif\(v_subnational,''\)/i);
  assert.match(m57,/set legal_version=null/i);assert.match(m57,/\{marketing\}.*false/is);
});
ok('locale change does not mutate legal country but invalidates stale acceptance/marketing projection',()=>{
  const start=m56.indexOf('create or replace function public.update_preferred_locale');const end=m56.indexOf('create or replace function public.current_user_has_product_access',start);const section=m56.slice(start,end);
  assert.match(section,/preferred_locale/i);assert.match(section,/legal_version=case when v_old is distinct from p_locale then null/i);assert.match(section,/marketing.*false/is);assert.doesNotMatch(section,/update public\.legal_country_runtime/i);
});
ok('unsupported legal translation or missing exact route blocks bundle resolution',()=>{assert.match(m57,/r\.ui_locale=v_locale/i);assert.match(m57,/r\.route_status='active'/i);assert.match(m55,/blocked_legal_bundle_missing/i)});
ok('storefront/service-country mismatch requires explicit review',()=>{assert.match(m57,/country_mismatch_reviewed is distinct from true/i);assert.match(m57,/country_mismatch_review_required/i)});
ok('unknown/unlisted ISO is BLOCK in registry and runtime policy setter',()=>{assert.equal(registry.default_policy.unknown_or_unlisted_iso_country,'BLOCK');assert.equal(registry.markets.NZ,undefined);assert.match(m57,/unlisted_country_blocked/i)});
ok('all 27 configured markets are explicitly seeded BLOCKED in runtime policy',()=>{for(const code of expected)assert.match(m57,new RegExp(`\\('${code}',array\\[`));assert.match(m57,/release_status text not null default 'blocked'/i)});
ok('subnational review is policy-driven rather than a seven-country hard-code',()=>{
  assert.match(m57,/legal_country_requires_subnational_review[\s\S]*legal_jurisdiction_policies/i);
  const fn=m57.slice(m57.indexOf('create or replace function public.legal_country_requires_subnational_review'),m57.indexOf('create or replace function public.current_legal_age_assurance_satisfied'));
  assert.doesNotMatch(fn,/\b(AE|AU|BE|CA|CN|IT|US)\b.*\b(AE|AU|BE|CA|CN|IT|US)\b/i);
  for(const code of expected)assert.equal(registry.markets[code].subnational_review_required,true,`${code}: subnational gate`);
});
ok('jurisdiction policy is service-only and RLS protected',()=>{assert.match(m57,/alter table public\.legal_jurisdiction_policies enable row level security/i);assert.match(m57,/revoke all on table public\.legal_jurisdiction_policies from public,anon,authenticated/i);assert.match(m57,/service_set_legal_jurisdiction_policy/i)});
ok('jurisdiction approval requires counsel, language, animal, age, subnational and operational evidence',()=>{
  for(const token of ['approved_by_external_counsel','language_review_status','animal_welfare_status','breeding_mating_status','pet_commerce_status','source_evidence_reference','counsel_evidence_reference','subnational_evidence_reference','language_evidence_reference','localization_evidence_reference','age_assurance_evidence_reference','animal_welfare_evidence_reference','breeding_mating_evidence_reference','pet_commerce_evidence_reference','operational_evidence_reference'])assert.match(m57,new RegExp(token,'i'));
});
ok('age-assurance evidence is append-only, service-only, and does not store DOB or ID images',()=>{
  assert.match(m57,/create table if not exists public\.legal_age_assurance_events/i);assert.match(m57,/trg_legal_age_assurance_events_append_only/i);assert.match(m57,/service_record_legal_age_assurance/i);
  assert.doesNotMatch(m57,/date_of_birth|dob\s+date|id_image|document_image|biometric_template/i);
});
ok('verified-external age assurance must be passed, current, threshold-sufficient, evidenced and not later revoked',()=>{
  assert.match(m57,/when 'verified_external'[\s\S]*e\.result='passed'[\s\S]*e\.age_threshold>=p\.minimum_user_age[\s\S]*e\.expires_at[\s\S]*jsonb_array_length\(e\.evidence_reference\)>0[\s\S]*r\.result='revoked'/i);
});
ok('self-attestation is limited to the 18+ policy mode and cannot emulate higher verified thresholds',()=>{assert.match(m57,/self_attestation_only_supports_18_threshold/i);assert.match(m57,/when 'self_attestation' then p\.minimum_user_age=18/i)});
ok('age-assurance provider reference is hash-only and omitted from user export',()=>{assert.match(m57,/provider_reference_sha256 text/i);assert.match(exportFn,/legal_age_assurance_history/i);assert.doesNotMatch(exportFn,/legal_age_assurance_events'\)\.select\([^\n]*(provider_reference_sha256|evidence_reference|created_by)/i)});
ok('active legal route requires approved jurisdiction plus official, counsel and localization evidence',()=>{
  assert.match(m57,/jurisdiction_not_approved_for_runtime/i);assert.match(m57,/jurisdiction_evidence_incomplete/i);assert.match(m57,/legal_bundle_official_source_evidence_required/i);assert.match(m57,/legal_bundle_counsel_evidence_required/i);assert.match(m57,/legal_bundle_professional_localization_evidence_required/i);
});
ok('active route validates bundle document locale, not UI locale, against counsel-approved document locales',()=>{assert.match(m58,/v_bundle\.document_locale=any\(v_policy\.approved_document_locales\)/i);assert.doesNotMatch(m58,/new\.ui_locale=any\(v_policy\.(launch_document_locales|approved_document_locales)\)/i)});
ok('missing/outdated bundle cannot grant product access',()=>{for(const token of ['legal_version','terms_version','community_guidelines_version','privacy_notice_version'])assert.match(m56,new RegExp(`b\\.${token}=c\\.current_${token}`,'i'))});
ok('previous-country acceptance cannot carry into a new current bundle',()=>{assert.match(m56,/a\.bundle_id=b\.bundle_id/i);assert.match(m56,/p\.bundle_id=b\.bundle_id/i);assert.match(m55,/accepted_country_code/i);assert.match(m55,/accepted_ui_locale/i)});
ok('unsupported document locale cannot substitute for acceptance document locale',()=>{assert.match(m56,/a\.document_locale=b\.document_locale/i);assert.match(m56,/p\.document_locale=b\.document_locale/i)});
ok('storefront-country mismatch independently fails closed',()=>{assert.match(m57,/v_runtime\.storefront_country_code is not null and v_runtime\.storefront_country_code<>v_runtime\.legal_country_code/i);assert.match(m57,/country_mismatch_reviewed is distinct from true then return null/i)});
ok('travel/operational-country mismatch independently fails closed',()=>{assert.match(m57,/v_runtime\.operational_country_code is not null and v_runtime\.operational_country_code<>v_runtime\.legal_country_code/i);assert.match(m57,/country_mismatch_reviewed is distinct from true then return null/i)});
ok('missing route has no language-only fallback',()=>{const resolver=m58.slice(m58.indexOf('create or replace function public.resolve_current_legal_bundle_id'),m58.indexOf('create or replace function public.enforce_legal_bundle_route_release_evidence'));assert.match(resolver,/where r\.legal_country_code=v_runtime\.legal_country_code/i);assert.match(resolver,/and r\.ui_locale=v_locale/i);assert.doesNotMatch(resolver,/coalesce\(r\.ui_locale/i)});
ok('binding legal evidence remains append-only and immutable-bundle scoped',()=>{assert.match(m55,/trg_legal_acceptances_append_only/i);assert.match(m55,/append_only_legal_evidence/i);assert.match(m55,/bundle_id,document_locale,terms_sha256,community_guidelines_sha256/i)});
ok('marketing consent remains push-only, purpose-, bundle-, country-, locale- and hash-scoped',()=>{assert.match(m55,/'push','marketing_product_updates'/i);assert.match(m55,/marketing_push_consent_sha256/i);assert.match(m55,/bundle_id,document_locale,consent_text_sha256,legal_subnational_code/i);assert.match(m56,/e\.bundle_id=b\.bundle_id and e\.channel='push' and e\.purpose='marketing_product_updates'/i)});
ok('client accepts only exact server-resolved immutable bundle',()=>{for(const token of ['getCurrentLegalContext','bundleId','legalCountryCode','documentLocale'])assert.match(api,new RegExp(token));assert.match(consent,/result\.bundleId!==submittedContext\.bundleId/i);assert.match(navigator,/context\.accepted\s*===\s*true/i)});
ok('consent UX shows country, UI locale, document locale, effective version, age policy and immutable bundle',()=>{for(const token of ['legalConsent.contextLine','legalConsent.versionLine','legalConsent.ageLine','legalConsent.bundleLine'])assert.match(consent,new RegExp(token.replace('.','\\.')))});
ok('legal center opens terms/privacy/community/marketing documents from exact current bundle',()=>{for(const token of ['legalContext?.termsUrl','legalContext?.privacyNoticeUrl','legalContext?.communityGuidelinesUrl','legalContext?.marketingPushConsentUrl'])assert.ok(center.includes(token))});
ok('current legal context reveals non-sensitive policy state but not counsel/provider evidence',()=>{assert.match(m57,/ageAssuranceMode/i);assert.match(m57,/minimumUserAge/i);const fn=m57.slice(m57.indexOf('create or replace function public.get_current_legal_context'),m57.indexOf('create or replace function public.get_account_settings'));assert.doesNotMatch(fn,/provider_reference_sha256|counsel_evidence_reference|source_evidence_reference/i)});
ok('account settings expose jurisdiction/language/age gate state without raw evidence',()=>{assert.match(m57,/legalJurisdictionReleaseStatus/i);assert.match(m57,/legalLanguageReviewStatus/i);assert.match(m57,/legalAgeAssuranceMode/i)});
ok('legal age-assurance history is included in data export with privacy-minimized fields',()=>{assert.match(exportFn,/export_version:\s*19/i);assert.match(exportFn,/legal_age_assurance_history[\s\S]*verification_method[\s\S]*provider_code[\s\S]*result/i)});
ok('cross-language acceptance cannot silently survive locale changes',()=>{assert.match(m56,/update_preferred_locale[\s\S]*legal_version=case when v_old is distinct from p_locale then null/i);assert.match(m56,/update_preferred_locale[\s\S]*marketing[\s\S]*false/i)});
ok('TR+DE UI remains architecturally possible only through an exact approved TR route/bundle, never German-law inference',()=>{assert.doesNotMatch(m58,/v_locale=any\(v_policy\./i);assert.match(m58,/r\.legal_country_code=v_runtime\.legal_country_code[\s\S]*r\.ui_locale=v_locale/i);assert.match(m58,/b\.document_locale=any\(v_policy\.approved_document_locales\)/i)});
ok('policy effective/expiry dates are enforced at approval and runtime',()=>{assert.match(m57,/p_effective_at is null or p_effective_at>now\(\)/i);assert.match(m57,/p\.effective_at is not null and p\.effective_at<=now\(\)/i);assert.match(m57,/p\.expires_at is null or p\.expires_at>now\(\)/i)});
ok('legal-country runtime verified state requires attributable evidence and expires fail-closed',()=>{assert.match(m57,/verified_country_requires_attributable_evidence/i);assert.match(m57,/verified_country_evidence_expired/i);assert.match(m57,/blocked_legal_country_evidence_expired/i)});


ok('runtime jurisdiction approval requires the canonical 22 topic-level control reviews',()=>{for(const family of registry.default_policy.required_controls)assert.match(m61,new RegExp(`'${family}'`));assert.equal(registry.default_policy.required_controls.length,22);assert.match(m58,/legal_control_reviews_complete\(new\.control_reviews\)/i);assert.match(m58,/jurisdiction_topic_control_reviews_incomplete/i);assert.match(m61,/where release_status='approved' and not public\.legal_control_reviews_complete\(control_reviews\)/i)});
ok('each canonical topic-level review requires official source, evidence, attributable reviewer and applicability timestamps',()=>{for(const token of ['official_source_reference','evidence_reference','reviewer','reviewed_at','applicability_checked_at','scope_note'])assert.match(m61,new RegExp(token,'i'))});
ok('data localization and representative requirements are independent canonical controls',()=>{assert.match(m61,/'data_localization'/i);assert.match(m61,/'representative_requirement'/i);assert.doesNotMatch(m61,/'data_localization_or_representative'/i)});
ok('operator identity, tax/invoicing, and platform/app registration-licensing-filing-notification require separate runtime conclusions and evidence',()=>{for(const token of ['operator_identity_disclosure_status','operator_identity_disclosure_evidence_reference','tax_invoicing_status','tax_invoicing_evidence_reference','registration_licensing_filing_notification_status','registration_licensing_filing_notification_evidence_reference'])assert.match(m61,new RegExp(token,'i'));assert.match(m61,/where release_status='approved' and not public\.legal_control_reviews_complete\(control_reviews\)/i)});
ok('jurisdiction counsel review freshness expires fail-closed at runtime',()=>{assert.match(m57,/next_review_due_at/i);assert.match(m58,/jurisdiction_legal_review_window_invalid/i);assert.match(m58,/v_policy\.next_review_due_at<=now\(\)/i);assert.match(m57,/blocked_jurisdiction_review_expired/i)});
ok('runtime counsel-review validity window is capped at 90 days',()=>{assert.match(m57,/p_next_review_due_at>p_legal_reviewed_at\+interval '90 days'/i);assert.match(m58,/new\.next_review_due_at>new\.legal_reviewed_at\+interval '90 days'/i)});
ok('every canonical topic-level counsel/applicability review has its own expiring 90-day validity window',()=>{for(const token of ['valid_until','reviewed_at','applicability_checked_at',"now()-interval '90 days'","+interval '90 days'"])assert.match(m62,new RegExp(token.replace(/[+()]/g,'\\$&'),'i'));assert.match(m62,/where release_status='approved' and not public\.legal_control_reviews_complete\(control_reviews\)/i)});


ok('verified legal jurisdiction is provenance-based and app language/current travel/storefront/identity cannot independently establish it',()=>{
  for(const token of ['habitual_residence_country_code','service_contract_country_code','current_presence_country_code'])assert.match(m63,new RegExp(token,'i'));
  assert.match(m63,/p_resolution_source not in \('habitual_residence_verified','service_contract_country_verified','manual_legal_review'\)/i);
  assert.match(m63,/resolution_source in \('identity_verified','storefront_verified','service_country_verified'\)/i);
  const verified=m63.slice(m63.indexOf("if p_resolution_status='verified'"),m63.indexOf('select legal_country_code,legal_subnational_code'));
  assert.doesNotMatch(verified,/v_presence<>'' and v_presence<>v_country/i);
});
ok('legacy legal-country setter cannot verify from storefront, identity or ambiguous service-country signals',()=>{
  assert.match(m63,/legacy_legal_country_resolution_source_not_sufficient_use_v2/i);
  assert.match(m63,/p_resolution_status='verified' and p_resolution_source<>'manual_legal_review'/i);
});
ok('TR resident with German UI requires an exact TR+DE route without changing legal country',()=>{
  const resolver=m65.slice(m65.indexOf('create or replace function public.resolve_current_legal_bundle_id'),m65.indexOf('create or replace function public.enforce_legal_bundle_route_release_evidence'));
  assert.match(resolver,/where r\.legal_country_code=v_runtime\.legal_country_code[\s\S]*r\.ui_locale=v_locale/i);
  assert.doesNotMatch(resolver,/legal_country_code\s*=\s*v_locale/i);
  assert.match(m63,/current physical presence is deliberately[\s\S]*travel must never silently switch/i);
});
ok('full legal/support surface is immutable bundle-bound rather than global URL-bound',()=>{
  for(const type of ['terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer','moderation_appeals','intellectual_property','accessibility','account_deletion','support'])assert.match(m64,new RegExp(`'${type}'`));
  assert.match(m64,/create table if not exists public\.legal_bundle_documents/i);
  assert.match(m64,/immutable_legal_bundle_document/i);
  assert.match(m64,/legal_bundle_document_manifest_complete/i);
});
ok('Türkiye exact bundle requires the jurisdiction privacy supplement',()=>{
  assert.match(m64,/where legal_country_code='TR'/i);
  assert.match(m64,/'jurisdiction_privacy_supplement'/i);
  assert.match(m64,/jurisdictionPrivacySupplementUrl/i);
});
ok('exact legal context returns all public legal/support URLs without raw counsel/source evidence',()=>{
  for(const token of ['termsUrl','privacyNoticeUrl','communityGuidelinesUrl','marketingPushConsentUrl','subscriptionConsumerUrl','moderationAppealsUrl','intellectualPropertyUrl','accessibilityUrl','accountDeletionUrl','supportUrl','jurisdictionPrivacySupplementUrl','legalDocumentUrls'])assert.match(m66,new RegExp(token));
  assert.doesNotMatch(m66,/counselEvidence|sourceEvidence|localizationEvidence/i);
});
ok('Legal & Privacy surface does not use global environment legal URLs',()=>{
  assert.doesNotMatch(center,/\benv\./);
  for(const token of ['termsUrl','privacyNoticeUrl','communityGuidelinesUrl','marketingPushConsentUrl','subscriptionConsumerUrl','moderationAppealsUrl','intellectualPropertyUrl','accessibilityUrl','accountDeletionUrl'])assert.match(center,new RegExp(`legalContext[?.]+${token}|legalContext\.${token}`));
});
ok('Premium purchase revalidates exact legal context and consumer document immediately before purchase',()=>{
  assert.doesNotMatch(premium,/\benv\.(termsUrl|privacyUrl|subscriptionConsumerUrl)/i);
  assert.match(premium,/getCurrentLegalContext\(requestedLocale\)[\s\S]*getCurrentLegalContext\(purchaseLocale\)/i);
  assert.match(premium,/currentContext\.status!=='ready'[\s\S]*currentContext\.subscriptionConsumerUrl/i);
  assert.match(premium,/purchasePremium\(packageSnapshot,\{bundleId:submittedContext\.bundleId![\s\S]*applicabilityMatrixId:submittedContext\.applicabilityMatrixId![\s\S]*uiLocale:purchaseLocale[\s\S]*subscriptionPurchaseDocumentSetSha256:submittedContext\.subscriptionPurchaseDocumentSetSha256!/i);
});
ok('paused/suspended accounts resolve support through the exact reviewed legal bundle without a global URL fallback',()=>{
  assert.match(m80,/create or replace function public\.get_restricted_account_legal_support/i);
  assert.match(m80,/resolve_current_legal_bundle_id\(v_user_id,v_locale\)/i);
  assert.match(m80,/document_type='support'/i);
  assert.match(m80,/legal_document_url_allowed\(v_support_url\)/i);
  assert.doesNotMatch(m80,/current_user_has_product_access/i);
  const suspended=read('src/screens/SuspendedAccountScreen.tsx');
  const paused=read('src/screens/PausedAccountScreen.tsx');
  for(const screen of [suspended,paused]){
    assert.match(screen,/requestedLocale=localeRef\.current[\s\S]*getRestrictedAccountLegalSupport\(requestedLocale\)[\s\S]*localeRef\.current!==requestedLocale/i);
    assert.doesNotMatch(screen,/env\.supportUrl|services\/config/i);
  }
});
ok('Settings and Safety Center legal links use exact legal context rather than global legal URLs',()=>{
  assert.doesNotMatch(settings,/\benv\.(termsUrl|privacyUrl|communityGuidelinesUrl|marketingConsentUrl|supportUrl)/i);
  assert.doesNotMatch(safety,/\benv\.(communityGuidelinesUrl|supportUrl)/i);
  assert.match(settings,/getCurrentLegalContext\(requestedLocale\)/i);assert.match(safety,/getCurrentLegalContext\(locale\)/i);
});
ok('subnational legal-language requirement is exact, counsel-evidenced, fresh and fail-closed',()=>{
  assert.match(m65,/create table if not exists public\.legal_subnational_language_requirements/i);
  assert.match(m65,/requirement_status in \('pending_external_counsel','approved','not_applicable_with_evidence'\)/i);
  assert.match(m65,/valid_until<=reviewed_at\+interval '90 days'/i);
  assert.match(m65,/where legal_country_code=v_bundle\.legal_country_code and legal_subnational_code=v_bundle\.legal_subnational_code/i);
  assert.match(m65,/legal_subnational_language_requirements_satisfied\(b\.bundle_id\)/i);
});
ok('alternate required legal-language documents are immutable and evidence-bound',()=>{
  assert.match(m65,/create table if not exists public\.legal_bundle_document_alternates/i);
  for(const token of ['document_sha256','source_evidence_reference','counsel_evidence_reference','localization_evidence_reference','reviewed_at','valid_until'])assert.match(m65,new RegExp(token,'i'));
  assert.match(m65,/trg_legal_bundle_document_alternates_immutable/i);
});
ok('Québec, Catalonia, Basque Country, Galicia and Belgium German-community language overlays are source-screened but not self-approved',()=>{
  for(const code of ['CA-QC','ES-CT','ES-PV','ES-GA','BE-DE-COMMUNITY'])assert.match(m65,new RegExp(`'${code}'`));
  assert.match(m65,/pending_external_counsel/i);
  assert.match(m65,/array\['fr'\]/i);assert.match(m65,/array\['ca'\]/i);assert.match(m65,/array\['eu'\]/i);assert.match(m65,/array\['gl'\]/i);assert.match(m65,/array\['de'\]/i);
});
ok('Belgium launch-language planning includes French, Dutch and German without asserting all three apply to every user',()=>{
  assert.match(m65,/launch_document_locales=array\['fr','nl','de'\]/i);
  assert.match(m65,/does not self-assert[\s\S]*exact route requirements remain subnational\/counsel controlled/i);
});
ok('subnational legal-language failures have an explicit user-visible fail-closed reason',()=>{
  assert.match(m66,/blocked_subnational_language_requirement_incomplete/i);
  assert.match(navigator,/blocked_subnational_language_requirement_incomplete[\s\S]*legalGate\.subnationalLanguage/i);
  assert.match(i18n,/legalGate\.subnationalLanguage/i);
});


ok('primary legal country does not erase separately reviewed applicable-law overlays',()=>{
  assert.match(m68,/create table if not exists public\.legal_applicability_matrices/i);
  assert.match(m68,/create table if not exists public\.legal_applicability_overlays/i);
  for(const basis of ['habitual_residence','service_contract','current_presence','storefront_market','operator_establishment','data_subject_residence','feature_specific','subnational_rule','manual_legal_review'])assert.match(m68,new RegExp(`'${basis}'`));
  assert.doesNotMatch(m68,/ui_locale\s+text[\s\S]{0,200}legal_applicability_matrices/i);
});
ok('app language never becomes an applicability jurisdiction signal',()=>{
  const snapshot=m68.slice(m68.indexOf('create or replace function public.legal_runtime_signal_snapshot'),m68.indexOf('create or replace function public.legal_signal_snapshot_sha256'));
  for(const token of ['legalCountryCode','habitualResidenceCountryCode','serviceContractCountryCode','currentPresenceCountryCode','storefrontCountryCode','operationalCountryCode'])assert.match(snapshot,new RegExp(token));
  assert.doesNotMatch(snapshot,/uiLocale|preferred_locale|document_locale/i);
});
ok('TR resident using German UI keeps TR as primary country while additional-law overlays are independently reviewed',()=>{
  const resolver=m68.slice(m68.indexOf('create or replace function public.resolve_current_legal_bundle_id'),m68.indexOf('-- Precise authenticated block reasons'));
  assert.match(resolver,/r\.legal_country_code=v_runtime\.legal_country_code[\s\S]*r\.ui_locale=v_locale/i);
  assert.match(resolver,/legal_applicability_matrix_satisfied\(p_user_id\)/i);
  assert.doesNotMatch(resolver,/legal_country_code\s*=\s*v_locale/i);
});
ok('travel/presence signal cannot replace primary jurisdiction but any signal change invalidates the reviewed applicability matrix',()=>{
  assert.match(m68,/old\.current_presence_country_code is distinct from new\.current_presence_country_code[\s\S]*current_applicability_matrix_id:=null/i);
  const resolver=m68.slice(m68.indexOf('create or replace function public.resolve_current_legal_bundle_id'),m68.indexOf('-- Precise authenticated block reasons'));
  assert.doesNotMatch(resolver,/legal_country_code\s*:?=\s*v_runtime\.current_presence_country_code/i);
});
ok('reviewed no-overlay is evidence-backed rather than equivalent to no review',()=>{
  assert.match(m68,/review_status in \('approved_with_overlays','approved_no_additional_overlays','blocked'\)/i);
  assert.match(m68,/review_status='blocked' or jsonb_array_length\(counsel_evidence_reference\)>0/i);
  assert.match(m68,/approved_no_additional_overlays[\s\S]*v_applicable<>0/i);
});
ok('each applicable overlay uses only canonical current control families and fresh attributable review evidence',()=>{
  assert.match(m68,/legal_single_control_review_complete/i);
  assert.match(m68,/public\.legal_required_control_families\(\)/i);
  for(const token of ["now()-interval '90 days'","valid_until<=now()","official_source_reference","evidence_reference","reviewer","applicability_checked_at"])assert.match(m68,new RegExp(token.replace(/[+()]/g,'\\$&'),'i'));
});
ok('overlay-specific legal documents are exact bundle×overlay×document-type×language artifacts with source/counsel/localization hashes',()=>{
  assert.match(m68,/create table if not exists public\.legal_bundle_overlay_documents/i);
  for(const token of ['bundle_id','overlay_id','document_type','document_locale','document_version','document_url','document_sha256','source_evidence_reference','counsel_evidence_reference','localization_evidence_reference','valid_until'])assert.match(m68,new RegExp(token,'i'));
  assert.match(m68,/unique\(overlay_id,bundle_id,document_type,document_locale\)/i);
  assert.match(m68,/foreach v_type in array v_overlay\.required_document_types[\s\S]*foreach v_locale in array v_overlay\.required_document_locales/i);
  assert.match(m86,/enforce_legal_overlay_document_classification/i);
  assert.match(m86,/v_overlay\.matrix_id<>new\.matrix_id/i);
  assert.match(m86,/not \(new\.document_type=any\(v_overlay\.required_document_types\)\)/i);
  assert.match(m86,/not \(new\.document_locale=any\(v_overlay\.required_document_locales\)\)/i);
  assert.match(m86,/o\.applicability_status<>'applicable'/i);
  assert.match(m86,/not \(d\.document_type=any\(v_overlay\.required_document_types\)\)[\s\S]*not \(d\.document_locale=any\(v_overlay\.required_document_locales\)\)/i);
  assert.match(m86,/current_legal_overlay_documents[\s\S]*d\.document_type=any\(o\.required_document_types\)[\s\S]*d\.document_locale=any\(o\.required_document_locales\)/i);
});
ok('additional-jurisdiction review and documents are both product-access release gates',()=>{
  const resolver=m68.slice(m68.indexOf('create or replace function public.resolve_current_legal_bundle_id'),m68.indexOf('-- Precise authenticated block reasons'));
  assert.match(resolver,/if not public\.legal_applicability_matrix_satisfied\(p_user_id\) then return null/i);
  assert.match(resolver,/legal_applicability_bundle_satisfied\(p_user_id,v_bundle_id\)/i);
});
ok('new applicability failures have precise fail-closed client statuses and localized user explanations',()=>{
  for(const status of ['blocked_legal_applicability_matrix_unresolved','blocked_legal_applicability_overlay_review_incomplete','blocked_legal_applicability_documents_incomplete','blocked_legal_subnational_country_mismatch']){
    assert.match(m68,new RegExp(status));assert.match(navigator,new RegExp(status));
  }
  for(const key of ['legalGate.applicabilityUnresolved','legalGate.applicabilityReview','legalGate.applicabilityDocuments','legalGate.subnationalCountryMismatch'])assert.match(i18n,new RegExp(key.replace('.','\\.')));
});
ok('country and subdivision codes cannot be crossed between jurisdictions',()=>{
  assert.match(m68,/legal_country_runtime_subnational_country_match/i);
  assert.match(m68,/legal_document_bundles_subnational_country_match/i);
  assert.match(m68,/legal_document_bundle_routes_subnational_country_match/i);
  assert.match(m68,/left\(v_runtime\.legal_subnational_code,3\)<>v_runtime\.legal_country_code\|\|'-'/i);
});
ok('legal applicability evidence is exported as user-related derived context without counsel/source payloads',()=>{
  assert.match(exportFn,/export_version:\s*19/i);
  assert.match(exportFn,/legal_applicability_matrices[\s\S]*primary_country_code[\s\S]*signal_snapshot/i);
  assert.match(exportFn,/legal_applicability_overlays[\s\S]*applicability_basis[\s\S]*control_families/i);
  const exportSlice=exportFn.slice(exportFn.indexOf("from('legal_applicability_matrices')"),exportFn.indexOf('const direct:'));
  assert.doesNotMatch(exportSlice,/counsel_evidence_reference|official_source_reference|evidence_reference|reviewer/i);
});

ok('overlay legal documents classify informational, acknowledgement and affirmative-acceptance actions separately',()=>{
  assert.match(m71,/user_action_requirement[\s\S]*'none'[\s\S]*'acknowledgement'[\s\S]*'affirmative_acceptance'/i);
  assert.match(m71,/create table if not exists public\.legal_overlay_document_actions/i);
  assert.match(m71,/document_sha256[\s\S]*document_locale[\s\S]*document_version[\s\S]*action_type/i);
  assert.match(m71,/trg_legal_overlay_document_actions_append_only/i);
});
ok('base legal, privacy and marketing evidence is bound to the current applicability matrix',()=>{
  for(const table of ['legal_acceptances','privacy_notice_acknowledgements','marketing_consent_events'])assert.match(m71,new RegExp(`alter table public\\.${table} add column if not exists applicability_matrix_id`,'i'));
  assert.match(m71,/legal_acceptances[\s\S]*applicability_matrix_id=v_runtime\.current_applicability_matrix_id/i);
  assert.match(m71,/privacy_notice_acknowledgements[\s\S]*applicability_matrix_id=v_runtime\.current_applicability_matrix_id/i);
  assert.match(m71,/marketing_consent_applicability_matrix_mismatch/i);
});
ok('required overlay actions are product-access gates and informational documents are not falsely recorded as consent',()=>{
  assert.match(m71,/d\.user_action_requirement<>'none'/i);
  assert.match(m71,/case when d\.user_action_requirement='affirmative_acceptance' then 'accepted' else 'acknowledged' end/i);
  assert.match(m71,/legal_overlay_document_actions_complete\(u\.id,b\.bundle_id\)/i);
});
ok('consent UI renders exact overlay documents and clearly exposes action semantics',()=>{
  assert.match(consent,/context\?\.overlayDocuments\?\.map/i);
  assert.match(consent,/document\.documentUrl/i);
  assert.match(consent,/legalConsent\.overlayAction\./i);
  assert.match(i18n,/legalConsent\.additionalDocumentsTitle/);
  assert.match(i18n,/legalConsent\.overlayAction\.none/);
  assert.match(i18n,/legalConsent\.overlayAction\.acknowledgement/);
  assert.match(i18n,/legalConsent\.overlayAction\.affirmative_acceptance/);
});
ok('acceptance is bound to the exact matrix, immutable base bundle and displayed non-marketing legal presentation',()=>{
  assert.match(m71,/current_legal_overlay_document_set_sha256[\s\S]*'matrixId'[\s\S]*'bundleId'[\s\S]*'baseDocuments'[\s\S]*'overlayDocuments'/i);
  assert.match(m71,/document_type in \('terms','privacy_notice','community_guidelines','jurisdiction_privacy_supplement'\)/i);
  assert.match(m71,/d\.document_type<>'marketing_push_consent'/i);
  assert.match(m71,/select \* into v_runtime from public\.legal_country_runtime where user_id=p_user_id for update/i);
  assert.match(m71,/p_presented_overlay_document_set_sha256<>v_current_overlay_document_set_sha256/i);
  assert.match(api,/current\.applicabilityMatrixId!==presented\.applicabilityMatrixId/i);
  assert.match(api,/current\.overlayDocumentSetSha256!==presented\.overlayDocumentSetSha256/i);
  assert.match(api,/current\.acceptancePresentationSha256!==presented\.acceptancePresentationSha256/i);
  assert.match(api,/applicabilityMatrixId:presented\.applicabilityMatrixId/i);
  assert.match(api,/acceptancePresentationSha256:presented\.acceptancePresentationSha256/i);
  assert.match(consent,/acceptLegalTerms\(submittedContext\)/);
  assert.match(m136,/countryJurisdictionSupplements/i);
  assert.match(m136,/binding[\s\S]*requiredBindingLocale/i);
  assert.match(m136,/get_current_country_legal_supplements/i);
  assert.match(api,/get_current_country_legal_supplements/);
  assert.match(api,/supplements\.presentationSha256!==context\.acceptancePresentationSha256/);
  assert.match(consent,/countryJurisdictionBindingSupplement/);
  assert.match(consent,/countryJurisdictionUiSupplement/);
  assert.match(center,/countryJurisdictionBindingSupplement/);
  assert.match(center,/countryJurisdictionUiSupplement/);
});
ok('product access uses the exact current mandatory presentation while optional marketing consent has a separate digest',()=>{
  assert.match(m71,/a\.overlay_document_set_sha256=public\.current_legal_overlay_document_set_sha256\(u\.id,b\.bundle_id\)/i);
  assert.match(m71,/p\.overlay_document_set_sha256=public\.current_legal_overlay_document_set_sha256\(u\.id,b\.bundle_id\)/i);
  assert.match(m71,/current_marketing_consent_document_set_sha256/i);
  assert.match(m71,/marketing_push_consent[\s\S]*user_action_requirement='none'/i);
});
ok('account export includes matrix-bound overlay actions and accepted presentation hashes without privileged counsel/source payloads',()=>{
  assert.match(exportFn,/export_version:\s*19/i);
  assert.match(exportFn,/legal_overlay_document_actions[\s\S]*document_sha256[\s\S]*action_type/i);
  assert.match(exportFn,/legal_acceptances[\s\S]*applicability_matrix_id/i);
  assert.match(exportFn,/privacy_notice_acknowledgements[\s\S]*applicability_matrix_id/i);
  assert.match(exportFn,/legal_bundle_overlay_documents[\s\S]*user_action_requirement/i);
  assert.match(exportFn,/legal_acceptance_presentations[\s\S]*presentation_sha256[\s\S]*accepted_source[\s\S]*accepted_at/i);
  const exportSlice=exportFn.slice(exportFn.indexOf("from('legal_applicability_matrices')"),exportFn.indexOf('const direct:'));
  assert.doesNotMatch(exportSlice,/counsel_evidence_reference|official_source_reference|evidence_reference|reviewer/i);
});

ok('optional marketing has its own exact user-visible presentation and stale document-set consent is inactive',()=>{
  assert.match(m77,/get_current_marketing_consent_presentation/i);
  assert.match(m77,/baseDocument/);
  assert.match(m77,/overlayDocuments/);
  assert.match(m77,/consentDocumentSetSha256/);
  assert.match(m77,/current_marketing_push_consent_granted[\s\S]*consent_document_set_sha256=v_sha/i);
  assert.match(api,/getCurrentMarketingConsentPresentation\(uiLocale\)/);
  assert.match(settings,/marketingPresentation\?\.overlayDocuments\?\.map/);
});
ok('marketing overlay presentation includes only explicit required locales and blocks stale or untrusted supplements',()=>{
  assert.match(m79,/marketing_consent_overlay_documents_complete/i);
  assert.match(m79,/'marketing_push_consent'=any\(o\.required_document_types\)/i);
  assert.match(m79,/d\.document_locale=any\(o\.required_document_locales\)/i);
  assert.match(m79,/legal_document_url_allowed\(d\.document_url\)/i);
  assert.match(m79,/marketing_consent_overlay_documents_incomplete/i);
  assert.match(m79,/marketing_consent_document_set_unavailable/i);
});
ok('mandatory acceptance presentation excludes optional marketing documents and reuses the user-visible overlay projection',()=>{
  assert.match(m75,/v_overlay:=public\.current_legal_overlay_documents\(p_user_id,p_bundle_id\)/i);
  assert.match(m75,/d\.document_type<>'marketing_push_consent'/i);
  assert.match(m71,/current_marketing_consent_document_set_sha256/i);
});

ok('UI language different from governing document language requires source-hash-bound comprehension documents without changing jurisdiction or governing language',()=>{
  assert.match(m85,/if v_source\.document_locale<>v_locale and not exists/i);
  assert.match(m85,/c\.source_document_version=v_source\.document_version/i);
  assert.match(m85,/c\.source_document_sha256=v_source\.document_sha256/i);
  assert.match(m85,/public\.legal_document_url_allowed\(c\.document_url\)/i);
  assert.match(m85,/c\.reviewed_at>=now\(\)-interval '90 days'/i);
  assert.match(m85,/b\.document_locale=any\(v_policy\.approved_document_locales\)/i);
  assert.match(m85,/r\.ui_locale=v_locale/i);
  assert.doesNotMatch(m85,/b\.document_locale=v_locale[\s\S]{0,160}return v_bundle_id/i);
});
ok('binding acceptance, marketing consent and subscription pre-contract presentation are stale-safe against comprehension-document changes',()=>{
  assert.match(m85,/current_legal_acceptance_comprehension_document_set_sha256/i);
  assert.match(m85,/legal_acceptance_presentation_payload[\s\S]*comprehensionDocumentSetSha256/i);
  assert.match(m85,/current_marketing_consent_document_set_sha256[\s\S]*comprehensionDocuments[\s\S]*comprehensionOverlayDocuments/i);
  assert.match(m85,/current_subscription_purchase_document_set_sha256[\s\S]*comprehensionDocuments[\s\S]*comprehensionOverlayDocuments/i);
  assert.match(m72,/v_sha:=public\.legal_acceptance_presentation_sha256\(p_user_id,p_bundle_id\)/i);
  assert.match(m72,/v_sha is null or v_sha<>p_expected_presentation_sha256/i);
  assert.match(api,/current\.comprehensionDocumentSetSha256!==presented\.comprehensionDocumentSetSha256/i);
});
ok('dual-language mirrors are explanatory copies only and never replace the governing country, bundle or source document hashes',()=>{
  assert.match(m85,/comprehension mirror never replaces, weakens, or changes the governing document or jurisdiction/i);
  assert.match(m85,/source_document_type/i);
  assert.match(m85,/source_document_sha256/i);
  assert.match(m85,/sourceDocumentLocale/i);
  assert.match(m85,/sourceDocumentSha256/i);
  assert.match(m86,/legal_overlay_comprehension_documents_complete[\s\S]*legal_applicability_bundle_satisfied\(p_user_id,p_bundle_id\)/i);
  assert.match(m86,/d\.document_type=any\(o\.required_document_types\)[\s\S]*d\.document_locale=any\(o\.required_document_locales\)/i);
});
ok('pre-registration public scope terminology is official-source based while legacy evidence remains readable',()=>{
  assert.match(m137,/pre_registration_public_scope_mode[\s\S]*not_required_with_counsel_evidence[\s\S]*not_required_with_official_source_evidence/i);
  assert.match(m137,/countrywide_notice_counsel_approved[\s\S]*countrywide_notice_internal_source_approved/i);
  assert.match(m137,/subnationalScopeAuthority','internal_official_source_review'/i);
  assert.match(m137,/pre_registration_legal_presentation_sha256[\s\S]*pre_registration_public_scope_mode/i);
  assert.match(m137,/handle_new_auth_user[\s\S]*pre_registration_public_scope_mode\(v_pre\.subnational_scope_mode\)/i);
});
console.log(`legal-context-matrix-tests: ${cases.length}/${cases.length} fail-closed country×language×bundle×age/subnational cases PASS`);
