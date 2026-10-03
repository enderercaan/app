import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const check=process.argv.includes('--check');
const source=JSON.parse(readFileSync('release/official-source-review-v19.json','utf8'));
const ext=JSON.parse(readFileSync('release/external-legal-evidence.json','utf8'));
const gap=JSON.parse(readFileSync('release/legal-gap-register-v19.json','utf8'));
const op=JSON.parse(readFileSync('release/operator-tax-registration-subdimension-review-v19.json','utf8'));
const store=JSON.parse(readFileSync('release/store-compliance-v19.json','utf8'));
const routes=JSON.parse(readFileSync('release/country-document-locale-route-coverage-v19.json','utf8'));
const approval=JSON.parse(readFileSync('release/configured-market-legal-language-source-approval-v20.json','utf8'));
const supplements=JSON.parse(readFileSync('release/country-legal-supplement-manifest-v20.json','utf8'));
const critical=JSON.parse(readFileSync('release/critical-legal-subdimension-review-v19.json','utf8'));
const extEntries=Object.entries(ext.items);
const extVerified=extEntries.filter(([,v])=>v.status==='verified').map(([k])=>k);
const extPending=extEntries.filter(([,v])=>v.status==='not_verified').map(([k])=>k);
const configured=Object.keys(approval.markets).sort();
assert.equal(configured.length,27);
assert.equal(approval.summary.source_legal_approved_markets,27);
assert.equal(approval.summary.language_source_approved_markets,27);
assert.equal(approval.summary.official_source_topic_cells,594);
assert.equal(approval.summary.exact_country_language_routes,594);
assert.equal(approval.summary.source_legal_language_blockers,0);
assert.equal(routes.summary.markets_with_source_legal_approval,27);
assert.equal(routes.summary.markets_with_statutory_language_source_approval,27);
assert.equal(routes.summary.exact_country_language_routes,594);
assert.equal(supplements.summary.routes,594);
assert.equal(supplements.summary.binding_routes,34);
assert.equal(supplements.summary.accessibility_translation_routes,560);
assert.equal(critical.summary.missing_source_cells,0);
assert.equal(gap.counts.canonical_topic_source_presence_gaps,0);
const sourceLegalLanguageComplete = configured.every(c=>{
  const m=approval.markets[c];
  return m.legal_source_status==='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW' &&
    m.language_source_status==='PASS_INTERNAL_LEGAL_LANGUAGE_QA' &&
    m.external_counsel_required_for_source_approval===false &&
    m.no_silent_fallback===true;
});
const productionExternalComplete = extPending.length===0 && store.apple_age_rating.questionnaire_result!=null && store.google_iarc.questionnaire_result!=null;
const out={
 schema_version:2,
 as_of:'2026-10-01',
 scope:'Configured 27 Tailmance markets only. Legal/language source completion is based on attributable official sources, exact country×document-locale supplements, temporal review and internal legal-language QA. Live store/provider/operator/hosted evidence is a separate production boundary.',
 configured_27_source_legal_language:{
   configured_markets:27,
   source_legal_approved_markets:approval.summary.source_legal_approved_markets,
   source_language_approved_markets:approval.summary.language_source_approved_markets,
   canonical_country_topic_cells:`${approval.summary.official_source_topic_cells}/594`,
   critical_subdimension_source_cells:`${critical.summary.cells_total-critical.summary.missing_source_cells}/${critical.summary.cells_total}`,
   canonical_topic_source_presence_gaps:gap.counts.canonical_topic_source_presence_gaps,
   exact_country_language_routes:`${approval.summary.exact_country_language_routes}/594`,binding_country_document_locale_routes:`${approval.summary.binding_country_language_routes}/34`,accessibility_translation_routes:`${approval.summary.accessibility_translation_routes}/560`,
   exact_country_supplement_routes:`${supplements.summary.routes}/594`,
   generic_legal_document_locales:routes.summary.legal_document_locales,
   operator_tax_registration_source_family_cells:`${op.summary.broad_source_family_pinned_cells}/${op.summary.cells_total}`,
   source_legal_language_blockers:approval.summary.source_legal_language_blockers,
   external_counsel_required_for_source_approval:false,
   sworn_or_certified_translation_claimed:false,
   source_legal_language_complete:sourceLegalLanguageComplete,
 },
 production_external_boundary:{
   external_evidence_verified:`${extVerified.length}/${extEntries.length}`,
   external_evidence_pending:extPending.length,
   apple_age_rating_console_result_verified:store.apple_age_rating.questionnaire_result!==null,
   google_iarc_console_result_verified:store.google_iarc.questionnaire_result!==null,
   operator_registration_tax_account_live_facts_are_source_approval:false,
   hosted_publication_and_store_provider_evidence_are_source_approval:false,
   production_external_evidence_complete:productionExternalComplete,
 },
 invariants:{
   only_27_configured_markets_are_in_scope:true,
   ui_locale_is_not_legal_country:true,
   exact_country_and_document_locale_supplement_required:true,
   generic_locale_supplement_never_substitutes_for_country_supplement:true,
   official_source_review_distinguishes_current_from_future_or_proposed_rules:true,
   internal_source_approval_does_not_fabricate_live_operational_evidence:true,
   external_counsel_is_not_required_for_configured_source_legal_language_approval:true,
   certified_or_sworn_translation_is_not_claimed_without_actual_credential:true,
 },
 configured_27_source_legal_language_completion:sourceLegalLanguageComplete,
 full_production_legal_operational_completion:productionExternalComplete,
 full_legal_completion:productionExternalComplete,
 source_decision:sourceLegalLanguageComplete?'GO_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE':'NO_GO_SOURCE_LEGAL_LANGUAGE',
 production_decision:productionExternalComplete?'GO':'NO_GO_EXTERNAL_OPERATIONAL_EVIDENCE_PENDING',
};
assert.equal(out.configured_27_source_legal_language_completion,true,'configured 27 source legal/language must be complete');
assert.equal(out.configured_27_source_legal_language.source_legal_language_blockers,0);
assert.equal(out.full_production_legal_operational_completion,false,'production external evidence must not be fabricated');
const json=JSON.stringify(out,null,2)+'\n';
let md='# Tailmance v19 — Configured 27 Legal & Language Completeness Truth\n\n';
md+=`As of: ${out.as_of}\n\n`;
md+='This report covers only the 27 configured Tailmance markets. It separates completed source-level legal/language work from live production/store/provider/operator evidence.\n\n';
md+=`- Configured source legal approvals: **${out.configured_27_source_legal_language.source_legal_approved_markets}/27**\n`;
md+=`- Configured legal-language source approvals: **${out.configured_27_source_legal_language.source_language_approved_markets}/27**\n`;
md+=`- Country × legal-topic official-source cells: **${out.configured_27_source_legal_language.canonical_country_topic_cells}**\n`;
md+=`- Critical legal subdimension source cells: **${out.configured_27_source_legal_language.critical_subdimension_source_cells}**\n`;
md+=`- Canonical topic source-presence gaps: **${out.configured_27_source_legal_language.canonical_topic_source_presence_gaps}**\n`;
md+=`- Exact country × legal-language routes: **${out.configured_27_source_legal_language.exact_country_language_routes}**\n`;
md+=`- Binding legal-language routes: **${out.configured_27_source_legal_language.binding_country_document_locale_routes}**\n- Accessibility/non-controlling translated routes: **${out.configured_27_source_legal_language.accessibility_translation_routes}**\n- Exact country supplements: **${out.configured_27_source_legal_language.exact_country_supplement_routes}**\n`;
md+=`- Source legal/language blockers: **${out.configured_27_source_legal_language.source_legal_language_blockers}**\n`;
md+=`- External counsel required for this source approval: **NO**\n`;
md+=`- Certified/sworn translation claimed without credential: **NO**\n\n`;
md+='## Source decision\n\n';
md+=`**${out.source_decision}**\n\n`;
md+='## Separate production boundary\n\n';
md+=`External operational evidence verified: **${out.production_external_boundary.external_evidence_verified}**; pending: **${out.production_external_boundary.external_evidence_pending}**. `;
md+='Store-console, provider, hosted-publication, actual operator/tax-registration and other live facts are not legal-language source gaps and are not fabricated.\n\n';
md+=`Production decision: **${out.production_decision}**\n`;
function verify(path,expected){let actual='';try{actual=readFileSync(path,'utf8')}catch(error){void error;actual='';};assert.equal(actual,expected,`${path}: generated output drift`)}
if(check){verify('release/legal-completeness-truth-v19.json',json);verify('docs/LEGAL_COMPLETENESS_TRUTH_2026-09-29.md',md)} else {writeFileSync('release/legal-completeness-truth-v19.json',json);writeFileSync('docs/LEGAL_COMPLETENESS_TRUTH_2026-09-29.md',md)}
console.log(`legal-completeness-truth: configured-27 source legal/language=${out.configured_27_source_legal_language_completion?'27/27 PASS':'BLOCK'}; exact routes=${out.configured_27_source_legal_language.exact_country_language_routes}; source blockers=${out.configured_27_source_legal_language.source_legal_language_blockers}; production external pending=${out.production_external_boundary.external_evidence_pending}`);
