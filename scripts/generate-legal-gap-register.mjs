import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {canonicalEvidenceState} from './lib/legal-source-state.mjs';

const check=process.argv.includes('--check');
const sourcePath='release/official-source-review-v19.json';
const approvalPath='release/configured-market-legal-language-source-approval-v20.json';
const routePath='release/country-document-locale-route-coverage-v19.json';
const supplementPath='release/country-legal-supplement-manifest-v20.json';
const criticalPath='release/critical-legal-subdimension-review-v19.json';
const externalPath='release/external-legal-evidence.json';
const jsonPath='release/legal-gap-register-v19.json';
const mdPath='docs/LEGAL_GAP_REGISTER_2026-09-29.md';
const source=JSON.parse(readFileSync(sourcePath,'utf8'));
const approval=JSON.parse(readFileSync(approvalPath,'utf8'));
const routes=JSON.parse(readFileSync(routePath,'utf8'));
const supplements=JSON.parse(readFileSync(supplementPath,'utf8'));
const critical=JSON.parse(readFileSync(criticalPath,'utf8'));
const external=JSON.parse(readFileSync(externalPath,'utf8'));
const state=canonicalEvidenceState(source);
const countries=Object.keys(source.markets).sort();
assert.equal(countries.length,27);
assert.deepEqual(Object.keys(approval.markets).sort(),countries);
const gaps=[];
for(const {country,topic,review} of state.emptyEvidenceCells) gaps.push({country,topic,type:'missing_official_source_evidence',status:review.status??'missing'});
for(const country of countries){
  const a=approval.markets[country];
  if(a?.legal_source_status!=='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW')gaps.push({country,type:'configured_market_source_legal_approval_missing'});
  if(a?.language_source_status!=='PASS_INTERNAL_LEGAL_LANGUAGE_QA')gaps.push({country,type:'configured_market_legal_language_qa_missing'});
}
assert.equal(routes.summary.markets_with_source_legal_approval,27);
assert.equal(routes.summary.markets_with_statutory_language_source_approval,27);
assert.equal(routes.summary.exact_country_language_routes,594);
assert.equal(routes.summary.binding_country_language_routes,34);
assert.equal(supplements.summary.routes,594);
assert.equal(supplements.summary.binding_routes,34);
assert.equal(critical.summary.missing_source_cells,0);
const externalPending=Object.values(external.items??{}).filter(x=>x?.status==='not_verified').length;
const out={
  schema_version:2,
  as_of:'2026-10-01',
  scope:'Only the 27 configured Tailmance markets. Countries outside this set are out of scope for this legal/language source-completion decision.',
  generated_from:{official_source_review:sourcePath,configured_market_source_approval:approvalPath,country_document_locale_routes:routePath,country_supplements:supplementPath,critical_subdimensions:criticalPath},
  policy:{
    source_legal_approval_basis:'attributable official/regulator sources + temporal review + exact country×legal-language supplements + internal legal-language QA',
    external_counsel_required_for_source_approval:false,
    sworn_or_certified_translation_claimed:false,
    live_store_provider_operator_hosted_facts_are_separate_production_evidence:true,
    no_silent_country_or_language_fallback:true,
    countries_outside_configured_27:'OUT_OF_SCOPE',
  },
  counts:{
    configured_markets:27,
    topic_families:source.required_topic_families.length,
    total_topic_slots:state.cells,
    empty_topic_evidence_cells:state.emptyEvidenceCount,
    canonical_topic_source_presence_gaps:state.topicSpecificGapCount,
    source_legal_approved_markets:approval.summary.source_legal_approved_markets,
    source_legal_language_approved_markets:approval.summary.language_source_approved_markets,
    exact_country_language_routes:approval.summary.exact_country_language_routes,
    binding_country_language_routes:approval.summary.binding_country_language_routes,
    accessibility_translation_routes:approval.summary.accessibility_translation_routes,
    country_language_supplement_routes:supplements.summary.routes,
    critical_subdimension_source_cells_complete:critical.summary.cells_total-critical.summary.missing_source_cells,
    critical_subdimension_source_cells_total:critical.summary.cells_total,
    source_legal_language_blockers:gaps.length,
    production_external_legal_evidence_pending:externalPending,
  },
  source_legal_language_decision:gaps.length===0?'GO_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE':'NO_GO_SOURCE_LEGAL_LANGUAGE',
  source_gaps:gaps,
  production_boundary_note:'Production/store/provider/operator/runtime evidence may remain fail-closed. Those items are not source legal-language gaps and are not fabricated by this register.'
};
assert.equal(out.counts.source_legal_approved_markets,27);
assert.equal(out.counts.source_legal_language_approved_markets,27);
assert.equal(out.counts.exact_country_language_routes,594);
assert.equal(out.counts.binding_country_language_routes,34);
assert.equal(out.counts.source_legal_language_blockers,0);
const json=JSON.stringify(out,null,2)+'\n';
let md=`# Tailmance Configured-27 Legal / Language Gap Register\n\nAs of: ${out.as_of}\n\n`;
md+='This register is scoped only to the 27 configured Tailmance markets. It treats official-source legal review and internal legal-language QA as the source approval basis; external counsel is not a prerequisite for this source decision. It does not fabricate live store/provider/operator/hosted facts.\n\n';
md+=`- Configured markets source-legal approved: **${out.counts.source_legal_approved_markets}/27**\n`;
md+=`- Configured markets legal-language source approved: **${out.counts.source_legal_language_approved_markets}/27**\n`;
md+=`- Country × legal-topic official-source cells: **${out.counts.total_topic_slots-out.counts.empty_topic_evidence_cells}/${out.counts.total_topic_slots}**\n`;
md+=`- Exact country × legal-language routes: **${out.counts.exact_country_language_routes}/594**\n`;
md+=`- Binding legal-language routes: **${out.counts.binding_country_language_routes}/34**\n- Accessibility/non-controlling translated routes: **${out.counts.accessibility_translation_routes}/560**\n- Exact country-language jurisdiction supplements: **${out.counts.country_language_supplement_routes}/594**\n`;
md+=`- Critical legal subdimension source cells: **${out.counts.critical_subdimension_source_cells_complete}/${out.counts.critical_subdimension_source_cells_total}**\n`;
md+=`- Source legal/language blockers: **${out.counts.source_legal_language_blockers}**\n`;
md+=`- External counsel required for source approval: **NO**\n`;
md+=`- Sworn/certified translation claimed: **NO**\n\n`;
md+=`## Decision\n\n**${out.source_legal_language_decision}**\n\n`;
md+=`Production external legal/operational evidence still pending: **${out.counts.production_external_legal_evidence_pending}**. This is a separate release/operations boundary, not a source legal-language deficiency.\n`;
if(check){
  assert.ok(existsSync(jsonPath)&&existsSync(mdPath),'legal gap outputs missing');
  assert.equal(readFileSync(jsonPath,'utf8'),json,`${jsonPath} stale`);
  assert.equal(readFileSync(mdPath,'utf8'),md,`${mdPath} stale`);
  console.log('legal-gap-register: PASS configured-27 source legal/language 27/27; blockers=0');
}else{
  writeFileSync(jsonPath,json); writeFileSync(mdPath,md);
  console.log('legal-gap-register: wrote configured-27 source legal/language gap register; blockers=0');
}
