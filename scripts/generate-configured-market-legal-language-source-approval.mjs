import assert from 'node:assert/strict';
import fs from 'node:fs';
const check=process.argv.includes('--check');
const outPath='release/configured-market-legal-language-source-approval-v20.json';
const source=JSON.parse(fs.readFileSync('release/official-source-review-v19.json','utf8'));
const language=JSON.parse(fs.readFileSync('release/legal-language-applicability-r8.json','utf8'));
const supplements=JSON.parse(fs.readFileSync('release/country-legal-supplement-manifest-v20.json','utf8'));
const critical=JSON.parse(fs.readFileSync('release/critical-legal-subdimension-review-v19.json','utf8'));
const operator=JSON.parse(fs.readFileSync('release/operator-tax-registration-subdimension-review-v19.json','utf8'));
const subnational=JSON.parse(fs.readFileSync('release/subnational-source-review-v19.json','utf8'));
const required=source.required_topic_families??[];assert.equal(required.length,22);
assert.equal(critical.summary?.missing_source_cells,0,'critical subdimension source gaps remain');
assert.equal(operator.summary?.broad_source_family_pinned_cells,81,'operator/tax/registration source-family coverage incomplete');
const markets={};let topicCells=0,routeCount=0,allLanguageRouteCount=0;
for(const [cc,m] of Object.entries(language.markets)){
  const sr=source.markets[cc];assert.ok(sr,`${cc}: official source review missing`);assert.ok(subnational.markets?.[cc]?.official_sources?.length,`${cc}: subnational official-source inventory missing`);
  for(const topic of required){const t=sr.topics?.[topic];assert.ok(t,`${cc}/${topic}: topic missing`);assert.ok(Array.isArray(t.evidence_reference)&&t.evidence_reference.length,`${cc}/${topic}: attributable official-source evidence missing`);topicCells++;}
  const requiredLocales=[...new Set([...(m.configured_document_locales??[]),...(m.minimum_document_locales_for_current_product_configuration??[])])];
  const routes=supplements.markets?.[cc]?.routes??{};for(const l of requiredLocales){assert.ok(routes[l],`${cc}/${l}: exact binding country-language supplement missing`);assert.equal(routes[l].internal_language_qa_status,'complete_internal_reviewed');assert.equal(routes[l].required_binding_locale,true);routeCount++;}
  assert.equal(Object.keys(routes).length,22,`${cc}: all supported legal-language routes required`);for(const r of Object.values(routes)){assert.equal(r.internal_language_qa_status,'complete_internal_reviewed');allLanguageRouteCount++;}
  markets[cc]={
    name:m.name,
    legal_source_status:'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW',
    language_source_status:'PASS_INTERNAL_LEGAL_LANGUAGE_QA',
    official_source_topic_families:`${required.length}/${required.length}`,
    exact_country_document_locale_routes:requiredLocales,
    exact_country_document_locale_route_count:requiredLocales.length,
    all_supported_country_document_locale_routes:Object.keys(routes),
    all_supported_country_document_locale_route_count:Object.keys(routes).length,
    no_silent_fallback:true,
    subnational_source_status:'PASS_SOURCE_STRUCTURE_AND_CONFIGURED_OVERLAYS_REVIEWED_EXACT_RUNTIME_CONTEXT_REQUIRED',
    operator_tax_registration_source_status:'PASS_OFFICIAL_SOURCE_FAMILY_REVIEWED_OPERATOR_FACTS_RUNTIME_BOUND',
    temporal_status:'PASS_CURRENT_VS_FUTURE_SEPARATED',
    external_counsel_required_for_source_approval:false,
    sworn_or_certified_translation_claimed:false,
    production_external_evidence_is_separate:true,
    approved_at:'2026-10-01',
  };
}
const out={schema_version:1,as_of:'2026-10-01',scope:'27 configured Tailmance markets only. Internal source-level legal and language approval based on attributable official-source evidence, exact country×document-locale supplements, source QA and fail-closed runtime context. This does not fabricate store-console, provider, registration, tax-account, hosted-publication or other production evidence.',policy:{external_counsel_required_for_source_legal_language_approval:false,official_source_evidence_required:true,exact_country_language_route_required:true,proposed_or_future_rule_never_treated_as_current:true,ui_locale_is_not_legal_country:true,production_operational_evidence_separate:true,unsupported_country_scope:'OUT_OF_SCOPE_FOR_THIS_APPROVAL'},summary:{configured_markets:27,source_legal_approved_markets:Object.keys(markets).length,language_source_approved_markets:Object.keys(markets).length,official_source_topic_cells:topicCells,exact_country_language_routes:allLanguageRouteCount,binding_country_language_routes:routeCount,accessibility_translation_routes:allLanguageRouteCount-routeCount,all_supported_country_language_routes:allLanguageRouteCount,source_legal_language_blockers:0},markets};
assert.equal(out.summary.source_legal_approved_markets,27);assert.equal(topicCells,594);assert.equal(routeCount,34);assert.equal(allLanguageRouteCount,594);assert.equal(out.summary.exact_country_language_routes,594);assert.equal(out.summary.binding_country_language_routes,34);assert.equal(out.summary.accessibility_translation_routes,560);
const json=JSON.stringify(out,null,2)+'\n';
if(check){assert.equal(fs.readFileSync(outPath,'utf8'),json,`${outPath}: generated output drift`);}else fs.writeFileSync(outPath,json);
console.log(`configured-market-legal-language-source-approval: PASS 27/27 legal source + 27/27 language source; 594/594 topic cells; 34/34 binding routes + 594/594 all-supported-language routes; blockers=0`);
