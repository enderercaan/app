import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gates=JSON.parse(readFileSync('release/country-release-gates.json','utf8'));
const sourceReview=JSON.parse(readFileSync('release/official-source-review-v19.json','utf8'));
const languageReview=JSON.parse(readFileSync('release/legal-language-review-v19.json','utf8'));
const sourceApproval=JSON.parse(readFileSync('release/configured-market-legal-language-source-approval-v20.json','utf8'));
const routeCoverage=JSON.parse(readFileSync('release/country-document-locale-route-coverage-v19.json','utf8'));
const supplement=JSON.parse(readFileSync('release/country-legal-supplement-manifest-v20.json','utf8'));
const i18n=readFileSync('src/i18n/index.tsx','utf8');

const supportedMatch=i18n.match(/SUPPORTED_LOCALES\s*=\s*\[([^\]]+)\]/);assert.ok(supportedMatch);
const supportedLocales=Array.from(supportedMatch[1].matchAll(/['"]([^'"]+)['"]/g),m=>m[1]);
const releaseReadyMatch=i18n.match(/RELEASE_READY_LOCALES[^=]*=\s*\[([^\]]+)\]/);
const releaseReady=new Set(/RELEASE_READY_LOCALES[^=]*=\s*SUPPORTED_LOCALES\s*;/.test(i18n)?supportedLocales:(releaseReadyMatch?Array.from(releaseReadyMatch[1].matchAll(/['"]([^'"]+)['"]/g),m=>m[1]):[]));
const requiredControls=gates.default_policy?.required_controls??[];
const requiredTopics=sourceReview.required_topic_families??[];

assert.equal(gates.schema_version,5);
assert.equal(sourceReview.schema_version,3);
assert.equal(languageReview.schema_version,1);
assert.equal(gates.default_policy?.unknown_or_unlisted_iso_country,'BLOCK');
assert.equal(requiredControls.length,22,'all canonical legal control families must be source-reviewed');
assert.equal(requiredTopics.length,22,'all official-source topic families must be source-reviewed');
assert.equal(sourceApproval.summary?.source_legal_approved_markets,27);
assert.equal(sourceApproval.summary?.language_source_approved_markets,27);
assert.equal(sourceApproval.summary?.official_source_topic_cells,594);
assert.equal(sourceApproval.summary?.exact_country_language_routes,594);
assert.equal(sourceApproval.summary?.binding_country_language_routes,34);
assert.equal(sourceApproval.summary?.accessibility_translation_routes,560);
assert.equal(sourceApproval.summary?.all_supported_country_language_routes,594);
assert.equal(sourceApproval.summary?.source_legal_language_blockers,0);
assert.equal(routeCoverage.summary?.markets_with_source_legal_approval,27);
assert.equal(routeCoverage.summary?.markets_with_statutory_language_source_approval,27);
assert.equal(supplement.summary?.markets,27);
assert.equal(supplement.summary?.routes,594);assert.equal(supplement.summary?.binding_routes,34);assert.equal(supplement.summary?.accessibility_translation_routes,560);

const raw=(process.env.TAILMANCE_TARGET_COUNTRIES??'').trim();
assert.ok(raw,'TAILMANCE_TARGET_COUNTRIES is required for a configured-market source legal/language release check.');
const targets=[...new Set(raw.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean))];
assert.ok(targets.length>0);
const failures=[];
const now=new Date();
const maxSourceAgeMs=31*24*60*60*1000;

for(const code of targets){
  if(!/^[A-Z]{2}$/.test(code)){failures.push(`${code}: invalid ISO-3166 alpha-2 code`);continue;}
  const market=gates.markets?.[code];
  const approval=sourceApproval.markets?.[code];
  const source=sourceReview.markets?.[code];
  const language=languageReview.markets?.[code];
  const route=routeCoverage.markets?.[code];
  const supplementMarket=supplement.markets?.[code];
  if(!market||!approval||!source||!language||!route||!supplementMarket){failures.push(`${code}: configured source legal/language registry incomplete`);continue;}

  if(approval.legal_source_status!=='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW')failures.push(`${code}: official-source legal review is not approved internally`);
  if(approval.language_source_status!=='PASS_INTERNAL_LEGAL_LANGUAGE_QA')failures.push(`${code}: legal-language source QA is not approved internally`);
  if((approval.blockers??[]).length)failures.push(`${code}: source legal/language blocker(s): ${(approval.blockers??[]).join(',')}`);
  if(route.source_legal_scope_approved!==true)failures.push(`${code}: route source legal approval missing`);
  if(route.statutory_language_source_scope_approved!==true)failures.push(`${code}: route legal-language approval missing`);
  if(route.source_approval_status!=='PASS_INTERNAL_OFFICIAL_SOURCE_AND_LEGAL_LANGUAGE_REVIEW')failures.push(`${code}: route source approval status drift`);

  if(!source.official_sources?.length)failures.push(`${code}: official source inventory missing`);
  const screened=source.source_screened_at?new Date(source.source_screened_at):null;
  const validUntil=source.source_review_valid_until?new Date(source.source_review_valid_until):null;
  if(!screened||Number.isNaN(screened.getTime())||screened>now||now-screened>maxSourceAgeMs)failures.push(`${code}: official-source review missing/future/stale (>31 days)`);
  if(!validUntil||Number.isNaN(validUntil.getTime())||validUntil<=now)failures.push(`${code}: official-source review validity window expired/missing`);
  for(const topic of requiredTopics){
    const item=source.topics?.[topic];
    if(!item){failures.push(`${code}: official-source topic ${topic} missing`);continue;}
    if(!Array.isArray(item.evidence_reference)||item.evidence_reference.length===0)failures.push(`${code}: official-source topic ${topic} evidence missing`);
    if(!String(item.evidence_classification??'').trim())failures.push(`${code}: official-source topic ${topic} evidence classification missing`);
  }

  if(language.professional_legal_localization_status!=='PASS_INTERNAL_LEGAL_LANGUAGE_QA_NO_CERTIFICATION_CLAIM')failures.push(`${code}: legal localization source QA incomplete`);
  if(!Array.isArray(language.official_sources)||language.official_sources.length===0)failures.push(`${code}: legal-language official-source evidence missing`);
  if(!Array.isArray(language.localization_evidence_reference)||language.localization_evidence_reference.length===0)failures.push(`${code}: legal-language localization evidence missing`);
  if(language.machine_translation_accepted_as_final===true||language.silent_cross_language_acceptance_allowed===true)failures.push(`${code}: unsafe legal-language fallback policy`);

  const expectedLocales=[...new Set(approval.exact_country_document_locale_routes??[])].sort();
  const actualLocales=Object.keys(supplementMarket.routes??{}).sort();
  const allApprovedLocales=[...new Set(approval.all_supported_country_document_locale_routes??[])].sort();
  if(expectedLocales.length===0)failures.push(`${code}: approved binding legal document locale set empty`);
  if(allApprovedLocales.length!==22||JSON.stringify(allApprovedLocales)!==JSON.stringify(actualLocales))failures.push(`${code}: all-supported-language country supplement routes incomplete`);
  for(const locale of expectedLocales){
    const sr=supplementMarket.routes?.[locale];
    if(!sr)failures.push(`${code}/${locale}: exact jurisdiction supplement missing`);
    else if(sr.internal_language_qa_status!=='complete_internal_reviewed')failures.push(`${code}/${locale}: exact jurisdiction supplement language QA incomplete`);
  }
  for(const locale of market.required_release_locales??[])if(!releaseReady.has(locale))failures.push(`${code}: runtime release locale ${locale} not release-ready`);
  if(!market.regulatory_sources?.length||!market.special_gates?.length)failures.push(`${code}: jurisdiction source/gate metadata incomplete`);
}

if(failures.length)throw new Error(`Configured-market source legal/language gate failed:\n- ${failures.join('\n- ')}\nDo not bypass. The configured 27 require current attributable official-source coverage and exact country×document-locale legal-language QA. Live store/provider/operator/hosted evidence is evaluated by separate production gates.`);
console.log(`country-release-check: ${targets.join(',')} PASS source legal/language; ${requiredTopics.length}/22 official-source topics per market + 34 binding / 594 all-supported-language country supplements; external counsel is not required for source approval`);
