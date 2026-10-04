import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const readJson=p=>JSON.parse(readFileSync(p,'utf8'));
const gates=readJson('release/country-release-gates.json');
const store=readJson('release/store-compliance-v19.json');
const extSecurity=readJson('release/external-security-evidence.json');
const extLegal=readJson('release/external-legal-evidence.json');
const uiE2e=readJson('release/ui-e2e-evidence-v23.json');
const completeness=readJson('release/legal-completeness-truth-v19.json');
const sourceApproval=readJson('release/configured-market-legal-language-source-approval-v20.json');
const routes=readJson('release/country-document-locale-route-coverage-v19.json');
const critical=readJson('release/critical-legal-subdimension-review-v19.json');
const operator=readJson('release/operator-tax-registration-subdimension-review-v19.json');
function parseRequiredEnv(scriptPath){const src=readFileSync(scriptPath,'utf8');const m=src.match(/const\s+required\s*=\s*\[([\s\S]*?)\];/);assert.ok(m);return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x=>x[1]);}
function parseStoreRequirements(){const src=readFileSync('scripts/store-compliance-release-check.mjs','utf8');const obj=src.match(/const\s+required\s*=\s*\{([\s\S]*?)\n\};/);assert.ok(obj);const rows=[];for(const line of obj[1].split('\n')){const m=line.match(/^\s*([A-Za-z0-9_]+):x\.([A-Za-z0-9_.]+),?\s*$/);if(!m)continue;let value=store;for(const part of m[2].split('.'))value=value?.[part];rows.push({id:m[1],status:value??'missing',source_path:`release/store-compliance-v19.json#${m[2]}`});}assert.ok(rows.length>=30);return rows;}
const clientEnv=parseRequiredEnv('scripts/release-config-check.mjs');
const serverEnv=parseRequiredEnv('scripts/server-release-config-check.mjs');
const storeItems=parseStoreRequirements();
const configured=Object.keys(gates.markets??{}).sort();
assert.equal(configured.length,27);
assert.deepEqual(Object.keys(sourceApproval.markets).sort(),configured);
const legalLanguagePending=configured.filter(c=>sourceApproval.markets[c]?.legal_source_status!=='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW'||sourceApproval.markets[c]?.language_source_status!=='PASS_INTERNAL_LEGAL_LANGUAGE_QA');
const securityPending=Object.entries(extSecurity.items??{}).filter(([,v])=>v?.required===true&&v.status==='not_verified').map(([id,v])=>({id,status:v?.status??'missing',notes:v?.notes??null}));
const legalPending=Object.entries(extLegal.items??{}).filter(([,v])=>v?.status==='not_verified').map(([id,v])=>({id,status:v?.status??'missing',evidence_boundary_class:v?.evidence_boundary_class??null,repository_source_can_satisfy_alone:v?.repository_source_can_satisfy_alone??null}));
const legalVerified=Object.entries(extLegal.items??{}).filter(([,v])=>v?.status==='verified').map(([id])=>id);
const sourceMisclassified=legalPending.filter(x=>x.repository_source_can_satisfy_alone===true).map(x=>x.id);
const storePending=storeItems.filter(x=>x.status!=='verified');
const uiE2ePending=(uiE2e.required_execution_evidence??[]).filter(x=>x?.status!=='verified').map(x=>({id:x.id,status:x.status??'missing',platform:x.platform??null,required:x.required??[]}));
const storeAssetMissing=['store/screenshots/ios','store/screenshots/android'].filter(p=>!existsSync(p));
const lockfileMissing=!existsSync('package-lock.json');
const appLinkAssociationFiles=['web/.well-known/apple-app-site-association','web/.well-known/assetlinks.json'];
const appLinkAssociationMissing=appLinkAssociationFiles.filter(p=>!existsSync(p));
const sourceIntegrity=[];
if(sourceApproval.summary.source_legal_language_blockers!==0)sourceIntegrity.push('configured_27_source_legal_language_approval');
if(sourceApproval.summary.official_source_topic_cells!==594)sourceIntegrity.push('canonical_594_topic_cells');
if(sourceApproval.summary.exact_country_language_routes!==594)sourceIntegrity.push('exact_country_language_routes');
if(sourceApproval.summary.binding_country_language_routes!==34)sourceIntegrity.push('binding_country_language_routes');
if(sourceApproval.summary.accessibility_translation_routes!==560)sourceIntegrity.push('accessibility_translation_routes');
if(routes.summary.markets_with_source_legal_approval!==27||routes.summary.markets_with_statutory_language_source_approval!==27)sourceIntegrity.push('country_document_locale_route_source_approval');
if(critical.summary.missing_source_cells!==0)sourceIntegrity.push('critical_legal_subdimension_source_presence');
if(operator.summary.broad_source_family_pinned_cells!==81||operator.summary.internally_source_approved_cells!==81||operator.summary.exact_subdimension_source_blockers!==0)sourceIntegrity.push('operator_tax_registration_source_review');
const inventory={
  schema_version:2,as_of:'2026-10-01',scope:'27 configured Tailmance markets. Source-level legal and legal-language completion is separated from live production/store/provider/operator evidence; countries outside the configured 27 are out of scope for this inventory.',
  policy:{fail_closed:true,no_external_evidence_fabrication:true,external_counsel_required_for_configured_source_legal_language_approval:false,production_operational_evidence_separate:true,unconfigured_countries:'OUT_OF_SCOPE'},
  configured_scope_source_integrity_blockers:sourceIntegrity,
  external_inventory_source_misclassifications:sourceMisclassified,
  blocker_families:{
    configured_27_legal_language_source_approval:{status:legalLanguagePending.length?'BLOCK':'PASS',pending_markets:legalLanguagePending,approved_count:27-legalLanguagePending.length,exact_country_language_routes:`${sourceApproval.summary.exact_country_language_routes}/594`,binding_country_language_routes:`${sourceApproval.summary.binding_country_language_routes}/34`,accessibility_translation_routes:`${sourceApproval.summary.accessibility_translation_routes}/560`,official_source_topic_cells:`${sourceApproval.summary.official_source_topic_cells}/594`,source_gate:'release/configured-market-legal-language-source-approval-v20.json',repository_source_can_satisfy_alone:true},
    client_production_configuration:{status:'BLOCK_UNTIL_RELEASE_ENV_SUPPLIED',requirements:[...clientEnv,{name:'EXPO_PUBLIC_APP_ENV',required_value:'production'}].map(x=>typeof x==='string'?{name:x,requirement:'nonempty_nonplaceholder_release_value'}:x),repository_source_can_satisfy_alone:false},
    server_production_configuration:{status:'BLOCK_UNTIL_RELEASE_ENV_SUPPLIED',requirements:serverEnv.map(name=>({name,requirement:'nonempty_nonplaceholder_release_value'})),repository_source_can_satisfy_alone:false},
    store_console_and_live_operations:{status:storePending.length?'BLOCK':'PASS',pending_items:storePending,total_requirements:storeItems.length,repository_source_can_satisfy_alone:false},
    critical_journey_and_visual_evidence:{status:uiE2ePending.length?'BLOCK':'PASS',pending_items:uiE2ePending,total_requirements:(uiE2e.required_execution_evidence??[]).length,source_contract_status:uiE2e.source_contract?.status??'missing',repository_source_can_satisfy_alone:false,note:'Maestro selectors/flows are source-implemented; release-candidate device execution and visual golden evidence must be captured externally.'},
    external_security_runtime_evidence:{status:securityPending.length?'BLOCK':'PASS',pending_items:securityPending,total_requirements:Object.values(extSecurity.items??{}).filter(x=>x?.required===true).length,repository_source_can_satisfy_alone:false},
    external_legal_operational_evidence:{status:legalPending.length?'BLOCK':'PASS',pending_items:legalPending,verified_items:legalVerified,total_requirements:Object.keys(extLegal.items??{}).length,note:'Only live/operational evidence belongs here. Source-remediable legal/language work is not an external blocker.',repository_source_can_satisfy_alone:false},
    production_store_assets:{status:storeAssetMissing.length?'BLOCK':'PASS',missing_paths:storeAssetMissing,repository_source_can_satisfy_alone:false},
    universal_app_link_association:{status:appLinkAssociationMissing.length?'BLOCK_UNTIL_VERIFIED_PRODUCTION_IDENTITY_SUPPLIED':'PRESENT_REQUIRES_LIVE_HOST_VERIFICATION',missing_artifacts:appLinkAssociationMissing,requirements:[{name:'EXPO_PUBLIC_APP_LINK_HOST',requirement:'verified_public_https_domain'},{name:'APPLE_TEAM_ID',requirement:'verified_apple_developer_team_id'},{name:'ANDROID_APP_LINK_CERT_SHA256',requirement:'verified_play_or_release_signing_sha256_fingerprint'}],note:'Association files are generated only from verified production identity values; live HTTPS hosting and platform verification remain external evidence.',repository_source_can_satisfy_alone:false},
    reproducible_dependency_resolution:{status:lockfileMissing?'BLOCK':'PASS',missing_artifact:lockfileMissing?'package-lock.json':null,repository_source_can_satisfy_alone:false,note:'Do not synthesize a lockfile.'}
  },
  counts:{configured_markets:27,configured_scope_source_integrity_blockers:sourceIntegrity.length,source_legal_language_markets_pending:legalLanguagePending.length,external_inventory_source_misclassifications:sourceMisclassified.length,store_compliance_pending:storePending.length,external_security_pending:securityPending.length,external_legal_operational_pending:legalPending.length,production_store_asset_paths_missing:storeAssetMissing.length,critical_journey_visual_evidence_pending:uiE2ePending.length,app_link_association_artifacts_missing:appLinkAssociationMissing.length,reproducible_lockfile_missing:lockfileMissing?1:0},
  source_legal_language_decision:legalLanguagePending.length===0&&sourceIntegrity.length===0?'GO_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE':'NO_GO_SOURCE_LEGAL_LANGUAGE',
  production_release_decision:'NO_GO_FAIL_CLOSED'
};
assert.deepEqual(sourceIntegrity,[],`configured-scope source-integrity blocker(s) remain: ${sourceIntegrity.join(', ')}`);
assert.deepEqual(sourceMisclassified,[],`source-remediable item(s) are misclassified as external: ${sourceMisclassified.join(', ')}`);
assert.equal(inventory.blocker_families.configured_27_legal_language_source_approval.status,'PASS');
const output='release/release-blocker-inventory-v19.json';const serialized=JSON.stringify(inventory,null,2)+'\n';
if(process.argv.includes('--check')){assert.ok(existsSync(output));assert.equal(readFileSync(output,'utf8'),serialized,`${output} is stale; run npm run release-blockers:generate`);console.log(`release-blocker-inventory: PASS configured-27 source legal/language; source blockers=0; external operational legal pending=${legalPending.length}; store pending=${storePending.length}; UI/E2E pending=${uiE2ePending.length}; security pending=${securityPending.length}`);}else{writeFileSync(output,serialized);console.log(`release-blocker-inventory: wrote ${output}; configured-27 source legal/language PASS; production external evidence remains fail-closed`);}
