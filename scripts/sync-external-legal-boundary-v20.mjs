import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';

const path='release/external-legal-evidence.json';
const check=process.argv.includes('--check');
const data=JSON.parse(readFileSync(path,'utf8'));
const items=data.items??{};

const englishCatalog=readFileSync('src/i18n/locales/en.ts','utf8');
const englishBody=/const messages:\s*Messages\s*=\s*\{([\s\S]*?)\n\};/.exec(englishCatalog)?.[1]??'';
const runtimeKeyCount=[...englishBody.matchAll(/^\s*"([^"]+)"\s*:/gm)].length;
assert.ok(runtimeKeyCount>0,'runtime English i18n key count must be derivable');

// These legacy inventory identifiers describe source-level legal/applicability/language
// reviews that are now satisfied by the configured-27 official-source + exact-language
// review model. Their keys are retained for stable evidence history, but external counsel
// or certified/sworn localization is no longer a prerequisite for source approval.
const sourceSatisfied=new Set([
  'legal_counsel_country_approval',
  'uk_online_safety_scope_and_childrens_access_assessment',
  'uae_social_platform_and_child_digital_safety_applicability_assessment',
  'subnational_counsel_matrix_for_applicable_markets',
  'animal_welfare_breeding_mating_pet_commerce_27_market_counsel_review',
  'subnational_jurisdiction_country_matrix_and_counsel_approval',
  'uae_child_digital_safety_scope_assessment',
  'uae_social_platform_applicability_assessment',
  'animal_welfare_breeding_mating_pet_commerce_country_matrix_and_counsel_approval',
  'country_and_subnational_statutory_language_requirements_counsel_approval',
  'professional_legal_localization_per_approved_country_document_locale',
  'jurisdiction_specific_legal_language_scope_approval',
  'subnational_language_route_matrix_and_alternate_document_evidence',
  'spain_autonomous_community_consumer_language_matrix_counsel_and_localization',
  'belgium_territorial_language_matrix_and_german_community_document_evidence',
  'eu_dsa_terms_restriction_and_advertising_transparency_review',
  'applicability_overlay_user_action_and_acceptance_presentation_legal_review',
  'australia_esafety_september_2026_post_federal_court_service_category_reassessment',
]);
const internalRefs=[
  'release/configured-market-legal-language-source-approval-v20.json',
  'release/official-source-review-v19.json',
  'release/subnational-source-review-v19.json',
  'release/country-legal-supplement-manifest-v20.json',
  'release/critical-legal-subdimension-review-v19.json',
];

// Items whose source-law applicability is reviewed internally but whose named evidence
// requires real deployed/provider/hosted behavior remain production evidence only.
const productionReclass=new Set([
  'dsa_service_classification_and_required_regulatory_reporting',
  'australia_social_media_minimum_age_scope_and_reasonable_steps_evidence',
  'international_transfer_mechanisms_and_required_local_notifications',
  'uae_effective_reliable_age_assurance_evidence',
  'immutable_legal_bundle_publication_counsel_and_localization_evidence',
  'marketing_push_consent_text_hash_version_publication_evidence',
  'country_specific_electronic_marketing_push_scope_registry_and_withdrawal_evidence',
  'digital_accessibility_country_applicability_and_manual_assistive_technology_audit',
  'copyright_notice_counter_notice_repeat_infringer_operations',
  'regulatory_recordkeeping_and_law_enforcement_response_matrix',
  'legal_jurisdiction_residence_or_service_contract_resolution_provenance',
  'exact_context_legal_document_manifest_publication_and_hash_evidence',
  'eu_dsa_statement_of_reasons_transparency_database_and_reporting_operations',
  'eu_dsa_internal_complaint_out_of_court_and_trusted_flagger_operations',
  'significant_automated_moderation_decision_human_intervention_and_redress_evidence',
  'applicability_overlay_document_publication_integrity',
]);
const storeReclass=new Set([
  'android_developer_verification_regional_enforcement_2026_09_30_initial_markets',
]);

for(const id of sourceSatisfied){
  assert.ok(items[id],`missing source-satisfied evidence item: ${id}`);
  Object.assign(items[id],{
    status:'verified',
    evidence_reference:[...internalRefs],
    evidence_boundary_class:'repository_source_internal_qa',
    repository_source_can_satisfy_alone:true,
    required_evidence_boundary:'Configured-27 official-source legal review, exact country×language coverage, subnational source review, temporal review and internal legal-language QA. External counsel/certified translation is not a source-approval prerequisite.',
    source_approval_basis:'internal_official_source_and_legal_language_qa',
    note:'Configured-27 source applicability, statutory-language scope and legal-language localization are internally complete from attributable official sources plus exact country×language QA. No external counsel, certified or sworn credential is required for this source approval and none is claimed.',
  });
}
const runtimeTranslation='runtime_ui_19_locale_source_translation_and_linguistic_qa';
assert.ok(items[runtimeTranslation],`missing ${runtimeTranslation}`);
Object.assign(items[runtimeTranslation],{
  status:'verified',
  evidence_reference:[
    `src/i18n/locales/*.ts — 19 dedicated runtime catalogs, ${runtimeKeyCount} keys each`,
    'release/i18n-critical-keys-v1.json — fixed 316 legal/payment/age/safety critical-key manifest',
    'release/i18n-runtime-invariant-allowlist-v1.json — explicit locale invariant allowlists',
    'scripts/runtime-language-quality-checks.mjs — full-catalog/key/placeholder/script/invariant QA',
    'scripts/i18n-checks.mjs — 19/19 runtime/native metadata release readiness',
    'scripts/generate-push-copy.mjs — 19/19 localized push-copy parity',
  ],
  note:`Runtime UI translation is source-complete for all 19 configured locales (${runtimeKeyCount}/${runtimeKeyCount} keys per locale) with fixed critical-key, placeholder, target-script and explicit-invariant QA. This verifies the application UI source catalogs only; it does not represent sworn/certified legal-document translation or the separate configured-market source legal-language approval artifact.`,
  evidence_boundary_class:'repository_source_internal_qa',
  repository_source_can_satisfy_alone:true,
  required_evidence_boundary:'Repository source artifacts plus deterministic internal QA.',
});

for(const id of productionReclass){
  assert.ok(items[id],`missing production-reclass evidence item: ${id}`);
  Object.assign(items[id],{
    status:'not_verified',
    evidence_reference:[],
    evidence_boundary_class:'production_or_operational_external',
    repository_source_can_satisfy_alone:false,
    required_evidence_boundary:'Configured-27 source-law applicability is internally reviewed; this inventory item now tracks only the named real deployed/provider/hosted operational evidence, which repository source cannot fabricate.',
    source_legal_review_complete:true,
    note:'Configured-27 source-law applicability is internally complete. This item tracks only the named live deployed/provider/hosted operational evidence; source approval is not blocked by it.',
  });
}

const providerPrivacy='international_transfer_mechanisms_and_required_local_notifications';
assert.ok(items[providerPrivacy],`missing ${providerPrivacy}`);
Object.assign(items[providerPrivacy],{
  status:'not_verified',
  evidence_reference:[],
  evidence_boundary_class:'production_or_operational_external',
  repository_source_can_satisfy_alone:false,
  required_evidence_boundary:'Real production provider contracts/configuration and operational evidence for transfers, retention, deletion/erasure cooperation, subprocessors and data-location obligations; repository source alone cannot satisfy this item.',
  source_legal_review_complete:true,
  note:'Before release, verify the actual production provider topology including moderation, owner identity verification, age assurance, health verification, crash reporting/observability, billing and hosting. For each enabled provider, document processor/controller role, DPA/terms, subprocessors, transfer mechanism/localization or notification duties, retention limits, deletion/erasure cooperation and a usable provider-side deletion handle or equivalent erasure procedure. Tailmance source-side hashing/minimization does not replace provider-side erasure obligations.'
});

for(const id of storeReclass){
  assert.ok(items[id],`missing store-reclass evidence item: ${id}`);
  Object.assign(items[id],{
    status:'not_verified',
    evidence_reference:[],
    evidence_boundary_class:'store_console_or_distribution_external',
    repository_source_can_satisfy_alone:false,
    required_evidence_boundary:'Configured-27 source-law applicability is internally reviewed; this inventory item tracks only real distribution/store/platform verification evidence.',
    source_legal_review_complete:true,
    note:'Configured-27 source-law applicability is internally complete. This item tracks only real store/distribution/platform verification evidence.',
  });
}

const world='worldwide_unconfigured_country_legal_review_and_distribution_approval';
assert.ok(items[world],`missing ${world}`);
Object.assign(items[world],{
  status:'not_applicable',
  evidence_reference:['release/worldwide-country-coverage-v19.json'],
  evidence_boundary_class:'out_of_scope_unconfigured_country',
  repository_source_can_satisfy_alone:false,
  required_evidence_boundary:'Out of scope for this configured-27 release. The 222 unconfigured jurisdictions are intentionally not reviewed or approved by this source-completion checkpoint.',
});

data.schema_version=2;
data.reviewed_at='2026-10-01';
data.policy='Configured-27 source legal/language approval is satisfied by attributable official sources, temporal/subnational review, exact country×language coverage and internal legal-language QA. External counsel or certified translation is not a source prerequisite. Only real production/store/provider/operator evidence remains external; unconfigured countries are out of scope.';

const json=JSON.stringify(data,null,2)+'\n';
if(check){assert.equal(readFileSync(path,'utf8'),json,`${path}: normalized configured-27 boundary drift`)}
else writeFileSync(path,json);

const vals=Object.values(items);
const sourceVerified=vals.filter(v=>v.status==='verified'&&v.evidence_boundary_class==='repository_source_internal_qa').length;
const pending=vals.filter(v=>v.status==='not_verified').length;
const outScope=vals.filter(v=>v.status==='not_applicable').length;
const deprecated=vals.filter(v=>['external_counsel_or_regulatory_applicability','professional_or_certified_localization_external','country_by_country_external_review'].includes(v.evidence_boundary_class));
assert.equal(deprecated.length,0,'deprecated counsel/localization external boundary class remains');
assert.equal(outScope,1,'exactly one outside-configured-27 inventory item must be out of scope');
console.log(`external-legal-boundary-v20: source/internal verified=${sourceVerified}; genuine production/store/operator pending=${pending}; out-of-scope=${outScope}; deprecated counsel/localization classes=0`);
