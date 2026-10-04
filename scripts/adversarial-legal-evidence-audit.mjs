import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const read=(p)=>JSON.parse(readFileSync(p,'utf8'));
const registry=read('release/country-release-gates.json');
const source=read('release/official-source-review-v19.json');
const subnational=read('release/subnational-source-review-v19.json');
const language=read('release/legal-language-applicability-r8.json');
const languageReview=read('release/legal-language-review-v19.json');
const critical=read('release/critical-legal-subdimension-review-v19.json');
const operator=read('release/operator-tax-registration-subdimension-review-v19.json');
const eu=read('release/eu-national-implementation-review-v19.json');
const truth=read('release/legal-completeness-truth-v19.json');
const extLegal=read('release/external-legal-evidence.json');
const gap=read('release/legal-gap-register-v19.json');
const sourceApproval=read('release/configured-market-legal-language-source-approval-v20.json');
const world=read('release/worldwide-country-coverage-v19.json');

const expected=Object.keys(registry.markets).sort();
assert.equal(expected.length,27,'configured legal market count drift');
assert.equal(Object.keys(world.markets).length,249,'worldwide ISO manifest must explicitly account for 249 alpha-2 entries');
assert.equal(world.summary.configured_markets,27);
assert.equal(world.summary.unconfigured_blocked_markets,222);
assert.equal(world.summary.worldwide_country_specific_legal_screening_complete,false);
for(const [label,obj] of [['official-source',source],['subnational',subnational],['legal-language',language],['critical-subdimension',critical],['operator-tax-registration',operator]]){
  assert.deepEqual(Object.keys(obj.markets).sort(),expected,`${label}: configured market set drift`);
}
assert.deepEqual(Object.keys(eu.markets).sort(),['AT','BE','DE','ES','FR','IE','IT','NL','PL'], 'EU launch-market matrix drift');
for(const code of Object.keys(eu.markets)){
  const nationalLanguageSources=(languageReview.markets[code]?.official_sources??[]).filter(u=>{const h=new URL(u).hostname.toLowerCase();return !h.endsWith('europa.eu');});
  assert.ok(nationalLanguageSources.length>0,`${code}: EU legal-language screening must pin at least one national official source, not only EUR-Lex`);
  for(const u of nationalLanguageSources) assert.ok((source.markets[code].official_sources??[]).includes(u),`${code}: legal-language national source not synchronized into canonical official source index: ${u}`);
}

const requiredTopics=source.required_topic_families;
assert.equal(requiredTopics.length,22,'canonical legal topic count drift');
const indexed=new Set(Object.values(source.global_official_sources||{}).flatMap(v=>Array.isArray(v)?v:[]));
let topicCells=0, topicUrls=0;
let minimumCountryAuthoritySourceCount=Infinity;
for(const code of expected){
  const m=source.markets[code];
  const countryAuthoritySources=(m.official_sources??[]).filter(u=>{const h=new URL(u).hostname.toLowerCase();return !h.endsWith('europa.eu')&&!h.includes('apple.com')&&!h.includes('google.com')&&!h.includes('android.com');});
  minimumCountryAuthoritySourceCount=Math.min(minimumCountryAuthoritySourceCount,countryAuthoritySources.length);
  assert.ok(countryAuthoritySources.length>=5,`${code}: country-specific authority/source depth unexpectedly thin (${countryAuthoritySources.length})`);
  assert.deepEqual(Object.keys(m.topics).sort(),[...requiredTopics].sort(),`${code}: canonical topic set drift`);
  for(const u of m.official_sources||[]){ assert.match(u,/^https:\/\//,`${code}: official source is not HTTPS: ${u}`); indexed.add(u); }
}
for(const code of expected){
  for(const topic of requiredTopics){
    topicCells++;
    const cell=source.markets[code].topics[topic];
    assert.ok(cell.status&&cell.release_effect&&cell.evidence_classification,`${code}/${topic}: incomplete source cell metadata`);
    assert.ok(Array.isArray(cell.evidence_reference)&&cell.evidence_reference.length>0,`${code}/${topic}: empty canonical source evidence`);
    for(const u of cell.evidence_reference){
      topicUrls++;
      assert.match(u,/^https:\/\//,`${code}/${topic}: evidence source is not HTTPS: ${u}`);
      assert.ok(indexed.has(u),`${code}/${topic}: evidence URL absent from canonical national/global source index: ${u}`);
    }
  }
}
assert.equal(topicCells,594,'country×topic matrix must remain 594 cells');

// Scan all release JSON for exact placeholder sentinels that can masquerade as a reviewed answer.
const badExact=new Set(['N/A','NA','TBD','TODO','PLACEHOLDER','UNKNOWN']);
let stringsScanned=0;
function walk(v,path){
  if(typeof v==='string'){
    stringsScanned++;
    assert.ok(!badExact.has(v.trim().toUpperCase()),`${path}: forbidden placeholder/synthetic N/A sentinel: ${v}`);
  } else if(Array.isArray(v)) v.forEach((x,i)=>walk(x,`${path}[${i}]`));
  else if(v&&typeof v==='object') for(const [k,x] of Object.entries(v)) walk(x,`${path}.${k}`);
}
for(const name of readdirSync('release').filter(x=>x.endsWith('.json'))){ walk(read(join('release',name)),`release/${name}`); }

// External evidence can remain empty only while it is explicitly unverified. A verified item must carry real evidence.
let externalItems=0;
for(const [id,item] of Object.entries(extLegal.items||{})){
  externalItems++;
  const refs=item.evidence_reference??item.evidence_ref;
  if(item.status==='verified'){
    const hasRef=Array.isArray(refs)?refs.length>0:Boolean(refs);
    assert.ok(hasRef,`external legal evidence ${id}: verified without evidence reference`);
  }
}

// Configured-market legal/language/subnational source approval must be internally complete and attributable.
for(const code of expected){
  const sm=subnational.markets[code];
  assert.equal(sm.screening_status,'PASS_INTERNAL_SUBNATIONAL_SOURCE_REVIEW',`${code}: subnational source review status`);
  assert.equal(sm.legal_approval,true,`${code}: subnational source legal approval`);
  assert.equal(sm.counsel_matrix_status,'not_required_for_source_approval',`${code}: external counsel must not be required for source approval`);
  assert.equal(sm.release_status,'PASS_SOURCE_REVIEW__EXACT_RUNTIME_CONTEXT_FAIL_CLOSED',`${code}: subnational source review release state`);
  assert.ok(sm.reviewer&&sm.reviewed_at&&sm.review_valid_until,`${code}: subnational internal review attribution missing`);
  assert.ok((sm.official_sources??[]).length>0,`${code}: subnational official sources missing`);
  const lm=languageReview.markets[code];
  assert.equal(lm.statutory_language_review_status,'PASS_INTERNAL_STATUTORY_LANGUAGE_SCOPE_REVIEW',`${code}: statutory-language review`);
  assert.equal(lm.professional_legal_localization_status,'PASS_INTERNAL_LEGAL_LANGUAGE_QA_NO_CERTIFICATION_CLAIM',`${code}: legal-language QA`);
  assert.equal(lm.release_status,'PASS_SOURCE_LEGAL_LANGUAGE',`${code}: source language release`);
  assert.ok(lm.reviewer&&lm.reviewed_at&&lm.review_valid_until,`${code}: language internal review attribution missing`);
  assert.deepEqual(lm.approved_document_locales,lm.launch_document_locales,`${code}: binding legal locale approval drift`);
  assert.equal(lm.all_supported_accessibility_document_locales?.length,22,`${code}: all supported legal-language accessibility routes`);
  const m=registry.markets[code];
  assert.equal(m.legal_review_status,'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW',`${code}: registry legal source review`);
  assert.equal(m.legal_approval,'approved_internal_official_source_review',`${code}: registry source legal approval`);
  assert.match(m.release_status,/SOURCE_LEGAL_LANGUAGE_PASS/,`${code}: source legal/language release state`);
  assert.ok((m.evidence_reference??[]).length>0&&m.reviewer&&m.reviewed_at,`${code}: source approval lacks attributable evidence/review metadata`);
}

// Truth boundary: the configured 27 source legal/language layer is approved, while production operational evidence remains independently fail-closed.
assert.equal(sourceApproval.summary.source_legal_approved_markets,27);
assert.equal(sourceApproval.summary.language_source_approved_markets,27);
assert.equal(sourceApproval.summary.exact_country_language_routes,594);
assert.equal(sourceApproval.summary.binding_country_language_routes,34);
assert.equal(sourceApproval.summary.accessibility_translation_routes,560);
assert.equal(sourceApproval.summary.source_legal_language_blockers,0);
assert.equal(truth.configured_27_source_legal_language_completion,true);
assert.equal(truth.source_decision,'GO_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE');
assert.equal(truth.full_production_legal_operational_completion,false);
assert.equal(truth.production_decision,'NO_GO_EXTERNAL_OPERATIONAL_EVIDENCE_PENDING');
assert.equal(registry.default_policy.unknown_or_unlisted_iso_country,'BLOCK');
for(const [code,m] of Object.entries(world.markets)) if(!m.configured_market) assert.equal(m.release_status,'BLOCK',`${code}: worldwide unconfigured country must remain BLOCK`);
assert.equal(language.policy.sworn_or_certified_translation_status_claimed,false);
assert.equal(languageReview.source_approval_model?.external_counsel_required_for_source_approval,false);
assert.equal(languageReview.source_approval_model?.authoritative_artifact,'release/configured-market-legal-language-source-approval-v20.json');
assert.equal(languageReview.policy.country_release_requires_external_professional_translation_credential_unconditionally,false);
assert.equal(languageReview.policy.external_professional_certified_or_sworn_credential_required_when_applicable_law_or_release_channel_requires_it,true);
assert.equal(gap.counts?.source_legal_language_blockers,0,'configured source legal/language blockers must remain zero');
assert.equal(gap.counts?.source_legal_approved_markets,27);
assert.equal(gap.counts?.source_legal_language_approved_markets,27);

// Verified internal-localization evidence descriptions must match the current repository facts, not stale checkpoint counts.
const runtimeEvidence=extLegal.items?.runtime_ui_19_locale_source_translation_and_linguistic_qa;
assert.equal(runtimeEvidence?.status,'verified');
const currentEnglish=readFileSync('src/i18n/locales/en.ts','utf8');
const currentEnglishBody=/const messages:\s*Messages\s*=\s*\{([\s\S]*?)\n\};/.exec(currentEnglish)?.[1]??'';
const currentRuntimeKeyCount=[...currentEnglishBody.matchAll(/^\s*"([^"]+)"\s*:/gm)].length;
assert.ok(currentRuntimeKeyCount>0,'current runtime i18n key count must be derivable');
assert.ok((runtimeEvidence.evidence_reference??[]).some(x=>x.includes(`19 dedicated runtime catalogs, ${currentRuntimeKeyCount} keys each`)), `runtime verified evidence reference must pin current 19×${currentRuntimeKeyCount} catalog state`);
assert.ok(!(runtimeEvidence.evidence_reference??[]).some(x=>/1318 keys/.test(x)), 'runtime verified evidence reference contains stale 1318-key count');
const legalLocaleEvidence=extLegal.items?.final_22_legal_document_locale_source_localization_internal_qa;
assert.equal(legalLocaleEvidence?.status,'verified');
assert.ok((legalLocaleEvidence.evidence_reference??[]).some(x=>/242 generated public legal documents across 22 legal-document locale directories/.test(x)), 'legal-document verified evidence must describe actual 22-locale/242 generated-document architecture');
assert.ok(!(legalLocaleEvidence.evidence_reference??[]).some(x=>/web\/legal-locales\/\*\.json.*22\/22/.test(x)), 'legal-document verified evidence must not falsely claim web/legal-locales has 22 locale packs');

// 9 configured EU markets must have internally completed national-source implementation review for the configured source scope.
let euFamilyCells=0;
let euGroupedFamilyCells=0;
for(const [code,m] of Object.entries(eu.markets)){
  assert.equal(m.matrix_complete,true,`${code}: EU implementation source matrix must be complete`);
  assert.equal(m.review_status,'PASS_INTERNAL_NATIONAL_IMPLEMENTATION_SOURCE_REVIEW',`${code}: EU national implementation source review`);
  assert.equal(m.release_status,'PASS_SOURCE_REVIEW',`${code}: EU source review release state`);
  assert.equal(m.national_source_screening_complete,true,`${code}: grouped national source screening must be complete`);
  assert.equal(m.national_official_source_screening?.legal_conclusion,true,`${code}: internal source legal conclusion required`);
  const fs=Object.values(m.national_official_source_screening?.families??{});
  assert.equal(fs.length,5,`${code}: EU national five-directive screening incomplete`);
  for(const f of fs){ euFamilyCells++; assert.ok(f.sources?.length>0,`${code}: empty national directive-family source list`); }
  const grouped=Object.values(m.national_sources_by_family??{});
  assert.equal(grouped.length,3,`${code}: EU grouped national source screening must contain consumer/ePrivacy/accessibility families`);
  for(const refs of grouped){
    euGroupedFamilyCells++;
    assert.ok(Array.isArray(refs)&&refs.length>0,`${code}: empty grouped national source list`);
    for(const u of refs){
      assert.match(u,/^https:\/\//,`${code}: grouped national source is not HTTPS: ${u}`);
      const h=new URL(u).hostname.toLowerCase();
      assert.ok(!h.endsWith('europa.eu'),`${code}: grouped national family must pin a national source, not only EU-level source: ${u}`);
      assert.ok((source.markets[code].official_sources??[]).includes(u),`${code}: grouped national source not synchronized into canonical official_sources: ${u}`);
    }
  }
}

console.log(`adversarial-legal-evidence-audit: PASS — ${topicCells} country×topic cells, ${topicUrls} evidence URL references, ${euFamilyCells} EU directive-family cells + ${euGroupedFamilyCells} grouped national-family cells, min ${minimumCountryAuthoritySourceCount} country-authority sources/market, ${externalItems} external-evidence items, ${stringsScanned} release strings checked; configured 27 source legal/language approval remains separate from production operational evidence`);
