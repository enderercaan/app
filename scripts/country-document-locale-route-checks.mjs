import assert from 'node:assert/strict';
import {readFileSync, existsSync, writeFileSync, readdirSync} from 'node:fs';
import crypto from 'node:crypto';

const applicability=JSON.parse(readFileSync('release/legal-language-applicability-r8.json','utf8'));
const localeManifest=JSON.parse(readFileSync('release/legal-document-locales-v1.json','utf8'));
const webManifest=JSON.parse(readFileSync('release/legal-web-localization-manifest-v1.json','utf8'));
const runtimeManifest=JSON.parse(readFileSync('release/localized-legal-web-manifest-r8.json','utf8'));
const review=JSON.parse(readFileSync('release/legal-language-review-v19.json','utf8'));
const countrySupplements=JSON.parse(readFileSync('release/country-legal-supplement-manifest-v20.json','utf8'));
const sourceApproval=JSON.parse(readFileSync('release/configured-market-legal-language-source-approval-v20.json','utf8'));
const outPath='release/country-document-locale-route-coverage-v19.json';
const check=process.argv.includes('--check');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');

const legalLocales=new Set([
  ...localeManifest.runtime_ui_locales,
  ...localeManifest.legal_document_only_locales.map(x=>x.locale),
]);
const requiredDocs=['terms','privacy_notice','community_guidelines','subscription_consumer','marketing_push_consent','moderation_appeals','intellectual_property','accessibility','support','account_deletion'];
const markets={}; let exactCountryRoutes=0; let allLanguageCountryRoutes=0;
for(const [country,m] of Object.entries(applicability.markets)){
  const configured=m.configured_document_locales ?? [];
  const minimum=m.minimum_document_locales_for_current_product_configuration ?? [];
  const source=m.source_localization_locales ?? [];
  const requiredRouteLocales=[...new Set([...configured,...minimum])];
  const runtimeOrConfiguredSourceLocales=[...new Set(source)];
  const legalOnlySourceLocales=requiredRouteLocales.filter(locale=>localeManifest.legal_document_only_locales.some(x=>x.locale===locale));
  const all=[...new Set([...requiredRouteLocales,...runtimeOrConfiguredSourceLocales])];

  // Generic language-localized documents remain complete, but are not permitted to masquerade as
  // country-specific jurisdiction supplements. Country identity is proven by the exact v20 supplement.
  for(const locale of all){
    assert.ok(legalLocales.has(locale),`${country}/${locale}: locale absent from legal-document locale manifest`);
    assert.ok(existsSync(`web/legal-source/${locale}.json`),`${country}/${locale}: missing legal-source pack`);
    if(localeManifest.runtime_ui_locales.includes(locale)) assert.ok(existsSync(`web/legal-locales/${locale}.json`),`${country}/${locale}: missing runtime legal-locale pack`);
    else assert.ok(localeManifest.legal_document_only_locales.some(x=>x.locale===locale),`${country}/${locale}: non-runtime locale must be explicitly declared legal-document-only`);
    assert.ok(webManifest.locales[locale],`${country}/${locale}: missing legal-web manifest locale`);
    assert.ok(runtimeManifest.locales[locale],`${country}/${locale}: missing generated localized-web manifest locale`);
    const genericJurisdictionDoc=localeManifest.legal_document_only_locales.some(x=>x.locale===locale)?'jurisdiction_consumer_supplement':'jurisdiction_privacy_supplement';
    const routeDocs=[...requiredDocs,genericJurisdictionDoc];
    const routeFiles=[];
    for(const doc of routeDocs){
      const webEntry=webManifest.locales[locale].documents?.[doc];
      const runtimeEntry=runtimeManifest.locales[locale].documents?.[doc];
      assert.ok(webEntry,`${country}/${locale}/${doc}: missing source-localized generic legal document`);
      assert.ok(runtimeEntry,`${country}/${locale}/${doc}: missing generated generic public legal document`);
      routeFiles.push(runtimeEntry.file);
      const physical=`web/legal/${locale}/${runtimeEntry.file}`;
      assert.ok(existsSync(physical),`${country}/${locale}/${doc}: generated web/legal file missing`);
      assert.equal(sha(readFileSync(physical,'utf8')),runtimeEntry.sha256,`${country}/${locale}/${doc}: web/legal hash drift`);
    }
    assert.deepEqual(Object.keys(runtimeManifest.locales[locale].documents).sort(),[...routeDocs].sort(),`${country}/${locale}: generic runtime manifest contains missing or unexpected legal documents`);
    assert.deepEqual(readdirSync(`web/legal/${locale}`).filter(x=>x.endsWith('.html')).sort(),[...routeFiles].sort(),`${country}/${locale}: orphan/stale generic web/legal files present`);
  }

  const exact=countrySupplements.markets?.[country];
  assert.ok(exact,`${country}: country-specific supplement manifest missing`);
  assert.deepEqual(exact.required_route_locales.sort(),[...requiredRouteLocales].sort(),`${country}: binding country supplement locale set drift`);
  assert.equal(Object.keys(exact.routes??{}).length,legalLocales.size,`${country}: every supported legal locale must have an exact country supplement`);
  for(const [locale,r] of Object.entries(exact.routes??{})){
    const isBinding=requiredRouteLocales.includes(locale);
    const r=exact.routes[locale];
    assert.ok(r,`${country}/${locale}: exact country supplement route missing`);
    assert.ok(existsSync(r.source_file),`${country}/${locale}: exact country supplement source file missing`);
    assert.ok(existsSync(r.public_file),`${country}/${locale}: exact country supplement public file missing`);
    assert.equal(sha(readFileSync(r.source_file,'utf8')),r.source_sha256,`${country}/${locale}: exact country supplement source hash drift`);
    assert.equal(sha(readFileSync(r.public_file,'utf8')),r.public_sha256,`${country}/${locale}: exact country supplement public hash drift`);
    const d=JSON.parse(readFileSync(r.source_file,'utf8'));
    assert.equal(d.legal_country_code,country,`${country}/${locale}: exact supplement country mismatch`);
    assert.equal(d.document_locale,locale,`${country}/${locale}: exact supplement locale mismatch`);
    assert.equal(d.document_type,'jurisdiction_country_supplement');
    assert.equal(r.internal_language_qa_status,'complete_internal_reviewed');
    assert.equal(r.required_binding_locale,isBinding,`${country}/${locale}: binding route flag`);
    assert.equal(r.route_role,isBinding?'required_binding_document_locale':'accessibility_translation_non_controlling',`${country}/${locale}: route role`);
    allLanguageCountryRoutes++;if(isBinding)exactCountryRoutes++;
  }

  const r=review.markets[country];
  assert.deepEqual([...r.launch_document_locales].sort(),[...configured].sort(),`${country}: language-review/configured locale drift`);
  assert.equal(r.source_legal_localization_status,'PASS_INTERNAL_LEGAL_LANGUAGE_QA',`${country}: source legal localization must be complete internally`);
  assert.deepEqual([...new Set(r.source_localization_locales)].sort(),[...new Set(configured)].sort(),`${country}: source localization locales drift`);
  const sourceMarket=sourceApproval.markets?.[country];
  assert.equal(sourceMarket?.legal_source_status,'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW',`${country}: internal official-source legal approval missing`);
  assert.equal(sourceMarket?.language_source_status,'PASS_INTERNAL_LEGAL_LANGUAGE_QA',`${country}: internal legal-language source approval missing`);
  assert.equal(sourceMarket?.external_counsel_required_for_source_approval,false,`${country}: source approval must not require external counsel`);

  markets[country]={
    configured_document_locales:configured,
    minimum_document_locales_for_current_product_configuration:minimum,
    required_route_locales:requiredRouteLocales,
    configured_or_runtime_source_localization_locales:runtimeOrConfiguredSourceLocales,
    legal_document_only_source_localization_locales:legalOnlySourceLocales,
    all_source_localized_route_locales:[...new Set([...runtimeOrConfiguredSourceLocales,...legalOnlySourceLocales])],
    generic_language_document_route_coverage_complete:true,
    exact_country_language_supplement_coverage_complete:true,
    all_supported_language_country_supplement_coverage_complete:Object.keys(exact.routes??{}).length===legalLocales.size,
    no_silent_fallback:m.no_silent_fallback===true,
    source_legal_scope_approved:true,
    statutory_language_source_scope_approved:true,
    source_approval_status:'PASS_INTERNAL_OFFICIAL_SOURCE_AND_LEGAL_LANGUAGE_REVIEW',
    production_operational_evidence_separate:true,
  };
}
assert.equal(exactCountryRoutes,34,'binding country×language supplement route count drift');
assert.equal(allLanguageCountryRoutes,594,'all-supported-language country supplement route count drift');
const out={
  schema_version:2,
  as_of:sourceApproval.as_of,
  scope:'27 configured launch markets only. Verifies generic language-localized legal documents plus exact country×document-locale jurisdiction supplements. Internal official-source legal/language approval is distinct from live store/provider/operator/hosted production evidence.',
  policy:{
    external_counsel_required_for_source_approval:false,
    exact_country_supplement_required:true,
    generic_kvkk_or_other_locale_supplement_never_counts_as_another_country_supplement:true,
    unsupported_or_unlisted_document_locale:'BLOCK',
    silent_fallback:'BLOCK',
    runtime_ui_locales:localeManifest.runtime_ui_locales.length,
    legal_document_locales:legalLocales.size,
    production_operational_evidence_is_separate:true,
  },
  summary:{
    markets:Object.keys(markets).length,
    markets_with_complete_generic_language_routes:Object.values(markets).filter(x=>x.generic_language_document_route_coverage_complete).length,
    markets_with_exact_country_language_supplements:Object.values(markets).filter(x=>x.exact_country_language_supplement_coverage_complete).length,
    markets_with_source_legal_approval:Object.values(markets).filter(x=>x.source_legal_scope_approved).length,
    markets_with_statutory_language_source_approval:Object.values(markets).filter(x=>x.statutory_language_source_scope_approved).length,
    exact_country_language_routes:allLanguageCountryRoutes,
    binding_country_language_routes:exactCountryRoutes,
    accessibility_translation_routes:allLanguageCountryRoutes-exactCountryRoutes,
    all_supported_country_language_routes:allLanguageCountryRoutes,
    legal_document_locales:legalLocales.size,
    required_base_document_families:requiredDocs.length,
  },
  markets,
};
assert.equal(out.summary.markets,27);
assert.equal(out.summary.markets_with_source_legal_approval,27);
assert.equal(out.summary.markets_with_statutory_language_source_approval,27);
const json=JSON.stringify(out,null,2)+'\n';
if(check){let actual='';try{actual=readFileSync(outPath,'utf8')}catch(error){void error;actual='';};assert.equal(actual,json,`${outPath}: generated output drift`);}else writeFileSync(outPath,json);
console.log(`country-document-locale-route-checks: PASS 27/27 source legal + 27/27 legal-language; ${exactCountryRoutes}/34 binding + ${allLanguageCountryRoutes}/594 all-supported-language country supplements; external counsel not required for source approval`);
