import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const registry=JSON.parse(readFileSync('release/country-release-gates.json','utf8'));
const m57=readFileSync('supabase/migrations/057_v19_jurisdiction_runtime_policy_and_age_assurance.sql','utf8');
const m61=readFileSync('supabase/migrations/061_v19_canonical_22_legal_control_families.sql','utf8');
const m65=readFileSync('supabase/migrations/065_v19_subnational_language_route_matrix.sql','utf8');
const m133=readFileSync('supabase/migrations/133_configured_27_internal_legal_language_source_approval.sql','utf8');
const m134=readFileSync('supabase/migrations/134_configured_27_runtime_legal_source_authority.sql','utf8');
const m135=readFileSync('supabase/migrations/135_configured_27_all_language_legal_supplements.sql','utf8');
const sourceApproval=JSON.parse(readFileSync('release/configured-market-legal-language-source-approval-v20.json','utf8'));
const supplementManifest=JSON.parse(readFileSync('release/country-legal-supplement-manifest-v20.json','utf8'));
const expectedCountries=Object.keys(registry.markets??{}).sort();

const seedBlock=m57.match(/insert into public\.legal_jurisdiction_policies\([\s\S]*?\) values([\s\S]*?)on conflict\(legal_country_code\) do nothing;/i);
assert.ok(seedBlock,'runtime jurisdiction seed block missing');
const seeds=[...seedBlock[1].matchAll(/\('([A-Z]{2})',array\[([^\]]+)\],array\[([^\]]+)\],'v19_seed_blocked'\)/g)].map(m=>({
  country:m[1],
  locales:[...m[2].matchAll(/'([^']+)'/g)].map(x=>x[1]),
  scope:[...m[3].matchAll(/'([^']+)'/g)].map(x=>x[1]),
}));
assert.deepEqual(seeds.map(x=>x.country).sort(),expectedCountries,'SQL jurisdiction seed countries must equal JSON registry countries exactly');
// Later canonical migrations may intentionally harden a market's launch-language planning. Fold those
// explicit SQL updates over the original 057 seed rather than editing historical migrations in place.
const localeOverrides=new Map();
for(const match of m65.matchAll(/update public\.legal_jurisdiction_policies[\s\S]*?set launch_document_locales=array\[([^\]]+)\][\s\S]*?where legal_country_code='([A-Z]{2})';/gi)){
  localeOverrides.set(match[2],[...match[1].matchAll(/'([^']+)'/g)].map(x=>x[1]));
}
for(const seed of seeds){
  const market=registry.markets[seed.country];
  const effectiveLocales=localeOverrides.get(seed.country)??seed.locales;
  assert.equal(market.subnational_review_required,true,`${seed.country}: SQL seed defaults subnational review true; JSON must match`);
  assert.deepEqual(effectiveLocales,market.required_release_locales,`${seed.country}: effective SQL launch_document_locales must equal JSON required_release_locales`);
  assert.deepEqual(seed.scope,market.subnational_review.scope_units,`${seed.country}: SQL subnational scope units must equal JSON registry`);
}
// SQL seed rows intentionally set only country/locales/subnational scope/updated_by. Every other
// approval/evidence field must therefore come from these fail-closed table defaults. Keep the JSON
// release registry semantically aligned with that initial runtime state so a metadata edit cannot
// accidentally imply approval that the database would still reject (or vice versa).
const expectedSqlDefaults=[
  [/release_status text not null default 'blocked'/i,'runtime policy must seed release blocked'],
  [/legal_review_status text not null default 'pending_external_counsel'/i,'runtime legal review must default pending external counsel'],
  [/subnational_review_required boolean not null default true/i,'runtime subnational review must default required'],
  [/subnational_review_status text not null default 'pending_external_counsel'/i,'runtime subnational review status must default pending external counsel'],
  [/approved_document_locales text\[\] not null default '\{\}'::text\[\]/i,'runtime approved document locales must default empty'],
  [/language_review_status text not null default 'pending_external_counsel'/i,'runtime language review must default pending external counsel'],
  [/age_assurance_mode text not null default 'unresolved'/i,'runtime age assurance must default unresolved'],
  [/minimum_user_age smallint not null default 18/i,'runtime minimum user age must default to product 18+ floor'],
  [/animal_welfare_status text not null default 'pending_external_counsel'/i,'runtime animal welfare must default pending external counsel'],
  [/breeding_mating_status text not null default 'pending_external_counsel'/i,'runtime breeding/mating must default pending external counsel'],
  [/pet_commerce_status text not null default 'pending_external_counsel'/i,'runtime pet commerce must default pending external counsel'],
];
for(const [pattern,message] of expectedSqlDefaults) assert.match(m57,pattern,message);
for(const field of ['source_evidence_reference','counsel_evidence_reference','subnational_evidence_reference','language_evidence_reference','localization_evidence_reference','age_assurance_evidence_reference','animal_welfare_evidence_reference','breeding_mating_evidence_reference','pet_commerce_evidence_reference','operational_evidence_reference']){
  assert.match(m57,new RegExp(`${field} jsonb not null default '\\[\\]'::jsonb`,'i'),`runtime ${field} must default empty`);
}
for(const [country,market] of Object.entries(registry.markets??{})){
  assert.equal(market.release_status,'SOURCE_LEGAL_LANGUAGE_PASS__PRODUCTION_OPERATIONAL_EVIDENCE_SEPARATE',`${country}: current registry source legal/language status drift`);
  assert.equal(market.legal_approval,'approved_internal_official_source_review',`${country}: current registry source legal approval drift`);
  assert.equal(market.legal_review_required,true,`${country}: runtime legal context review invariant remains required`);
  assert.equal(market.legal_review_status,'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW',`${country}: current registry source legal review status drift`);
  assert.ok(market.reviewer,`${country}: current source approval must identify internal review authority`);
  assert.ok(Array.isArray(market.evidence_reference)&&market.evidence_reference.length>0,`${country}: current source approval must retain attributable evidence`);
}

assert.equal(sourceApproval.summary.source_legal_approved_markets,27,'v20 source legal approval count drift');
assert.equal(sourceApproval.summary.language_source_approved_markets,27,'v20 source language approval count drift');
assert.equal(sourceApproval.summary.exact_country_language_routes,594,'v20 exact country-language route count drift');
assert.equal(sourceApproval.summary.binding_country_language_routes,34,'v20 binding country-language route count drift');
assert.equal(sourceApproval.summary.accessibility_translation_routes,560,'v20 accessibility translation route count drift');
assert.equal(sourceApproval.summary.all_supported_country_language_routes,594,'v20 all-supported country-language route count drift');
assert.equal(sourceApproval.summary.source_legal_language_blockers,0,'v20 source legal-language blockers must remain zero');
assert.equal(supplementManifest.summary.routes,594,'exact country-language supplement manifest drift');
assert.equal(supplementManifest.summary.binding_routes,34,'binding country-language supplement manifest drift');
assert.equal(supplementManifest.summary.accessibility_translation_routes,560,'accessibility country-language supplement manifest drift');
for(const token of [
  'source_legal_review_status','source_language_review_status','source_approved_document_locales',
  'legal_country_source_document_supplements','approved_internal_official_source_review','approved_internal_legal_language_qa',
  'legal_source_approval_current','external counsel is not required'
]) assert.ok(m133.toLowerCase().includes(token.toLowerCase()),`migration 133 source-approval contract missing: ${token}`);
for(const code of expectedCountries) assert.ok(m133.includes(`when '${code}'`)||m133.includes(`('${code}','`),`migration 133 missing configured market ${code}`);
const routeSeedCount=[...m133.matchAll(/\('(?:AE|AT|AU|BE|BR|CA|CN|DE|ES|FR|GB|ID|IE|IN|IT|JP|KR|NL|PL|RU|SA|SG|TH|TR|TW|US|VN)','[^']+','2026-10-01'/g)].length;
assert.equal(routeSeedCount,34,'migration 133 binding country×language supplement seed count must be 34');

const allLanguageSeedCount=[...m135.matchAll(/\('(?:AE|AT|AU|BE|BR|CA|CN|DE|ES|FR|GB|ID|IE|IN|IT|JP|KR|NL|PL|RU|SA|SG|TH|TR|TW|US|VN)','[^']+','2026-10-01'/g)].length;
assert.equal(allLanguageSeedCount,594,'migration 135 must seed 594 exact country×legal-language supplement rows');
for(const token of ['route_role','required_binding_locale','source_accessibility_document_locales','legal_source_approval_current','legal_country_supplement_source_route']) assert.ok(m135.includes(token),`migration 135 all-language contract missing: ${token}`);
for(const token of ['legal_country_locale_source_approved','legal_subnational_source_approved','legal_bundle_document_manifest_complete','pre_registration_legal_bundle_content_current','resolve_current_legal_bundle_id','current_mating_feature_enabled']) assert.ok(m134.includes(token),`migration 134 runtime source-authority override missing: ${token}`);
const finalResolver=m134.slice(m134.lastIndexOf('create or replace function public.resolve_current_legal_bundle_id'),m134.indexOf('create or replace function public.enforce_legal_bundle_route_release_evidence'));
assert.ok(finalResolver.includes('legal_country_locale_source_approved'),'final legal resolver must require current official-source country/locale approval');
assert.ok(!finalResolver.includes('approved_by_external_counsel'),'final legal resolver must not require external counsel approval');
assert.ok(!finalResolver.includes('counsel_evidence_reference'),'final legal resolver must not require counsel evidence');

assert.equal(registry.default_policy?.unknown_or_unlisted_iso_country,'BLOCK','unknown/unlisted JSON country must fail closed');
assert.equal(registry.default_policy?.context_rules?.unknown_or_unlisted_country,'BLOCK','runtime-context policy must fail closed for unknown countries');

const arrayMatch=m61.match(/create or replace function public\.legal_required_control_families\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/i);
assert.ok(arrayMatch,'canonical SQL legal control family list missing');
const sqlControls=[...arrayMatch[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
assert.deepEqual(sqlControls,registry.default_policy.required_controls,'SQL runtime and JSON registry canonical control families must match exactly and in order');
assert.equal(sqlControls.length,22,'runtime approval must require 22 independently release-blocking families');
for(const required of ['data_localization','representative_requirement','store_platform_obligations','subnational_requirements','applicability_effective_dates']) assert.ok(sqlControls.includes(required),`canonical runtime control missing: ${required}`);
assert.ok(!sqlControls.includes('data_localization_or_representative'),'legacy combined localization/representative family must not survive');

console.log(`legal-runtime-registry-alignment: ${expectedCountries.length} countries + ${sqlControls.length} canonical controls + 27/27 source approvals + 34/34 binding + 594/594 exact country-language routes aligned across runtime/source SQL and JSON registries`);
