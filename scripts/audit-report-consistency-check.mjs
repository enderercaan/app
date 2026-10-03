import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const source=read('release/official-source-review-v19.json');
const approval=read('release/configured-market-legal-language-source-approval-v20.json');
const supplements=read('release/country-legal-supplement-manifest-v20.json');
const gaps=read('release/legal-gap-register-v19.json');
const completeness=read('release/legal-completeness-truth-v19.json');
const blockers=read('release/release-blocker-inventory-v19.json');
const evidence=read('RELEASE_EVIDENCE.json');
const report=readFileSync('docs/R8_LEGAL_I18N_EXHAUSTIVE_REAUDIT_CURRENT_2026-09-29.md','utf8');
const verification=readFileSync('docs/VERIFICATION_REPORT.md','utf8');
const currentSnapshot=readFileSync('docs/final/TAILMANCE_V19_R8_CURRENT_SOURCE_SNAPSHOT_2026-09-30.md','utf8');
const finalSnapshot=read('docs/final/FINAL_SOURCE_SNAPSHOT.json');
const sourceVerification=readFileSync('docs/final/SOURCE_VERIFICATION_2026-09-30.txt','utf8');
function runLive(script,label){
  const r=spawnSync(process.execPath,[script],{cwd:process.cwd(),encoding:'utf8'});
  if(r.status!==0){process.stderr.write(r.stdout??'');process.stderr.write(r.stderr??'');throw new Error(`${label} live check failed`);}
  return `${r.stdout??''}${r.stderr??''}`;
}
function parseLive(re,text,label){const m=text.match(re);assert.ok(m,`${label}: live output could not be parsed`);return m.slice(1);}
const [liveSecurityPassed,liveSecurityTotal]=parseLive(/security-checks:\s*(\d+)\/(\d+)\s+passed/,runLive('scripts/security-checks.mjs','security'),'security');
const [liveMigrationFirst,liveMigrationLast]=parseLive(/migration-release-check:\s*canonical migrations (\d+)-(\d+) contiguous;/,runLive('scripts/migration-release-check.mjs','migration release'),'migration release');
const [liveLintFiles]=parseLive(/project-lint:\s*scanned (\d+) text files; passed/,runLive('scripts/project-lint.mjs','project lint'),'project lint');
const [liveProductPassed,liveProductTotal]=parseLive(/product-retention-checks:\s*(\d+)\/(\d+)/,runLive('scripts/product-retention-checks.mjs','product retention'),'product retention');
const [livePressables,liveTextInputs,liveSwitches,liveModals]=parseLive(/accessibility-checks:\s*(\d+) Pressables \+ (\d+) TextInputs \+ (\d+) Switches \+ (\d+) Modals/,runLive('scripts/accessibility-checks.mjs','accessibility'),'accessibility');
const [liveRpcs,liveEdgeInvocations,liveFunctionDirs]=parseLive(/backend-contract-checks:\s*(\d+) RPCs \([^)]*\), (\d+) invoked Edge Functions, (\d+) function directories/,runLive('scripts/backend-contract-checks.mjs','backend contracts'),'backend contracts');
const [liveRuntimeLocales,liveRuntimeLocalesTotal,liveI18nKeys]=parseLive(/i18n-release-check:\s*(\d+)\/(\d+) complete runtime catalogs[^;]*; (\d+) source keys/,runLive('scripts/i18n-release-check.mjs','i18n release'),'i18n release');
const [liveSourceUsedKeys]=parseLive(/i18n-source-usage-checks:\s*(\d+) source-used\/dynamic keys/,runLive('scripts/i18n-source-usage-checks.mjs','i18n source usage'),'i18n source usage');
const [liveLegalPassed,liveLegalTotal]=parseLive(/legal-policy-checks:\s*(\d+)\/(\d+)/,runLive('scripts/legal-policy-checks.mjs','legal policy'),'legal policy');
const [liveLegalContextPassed,liveLegalContextTotal]=parseLive(/legal-context-matrix-tests:\s*(\d+)\/(\d+)/,runLive('scripts/legal-context-matrix-tests.mjs','legal context'),'legal context');
const [liveAppModules,liveAppModulesTotal,liveScripts,liveScriptsTotal]=parseLive(/repository-hygiene-checks:[^;]+; (\d+)\/(\d+) app source modules reachable; (\d+)\/(\d+) maintenance scripts (?:referenced|command-reachable)/,runLive('scripts/repository-hygiene-checks.mjs','repository hygiene'),'repository hygiene');
const [liveAuthRpcs,liveAuthRpcsTotal,liveAuthPolicies,liveAuthPoliciesTotal]=parseLive(/auth-session-boundary-checks:\s*(\d+)\/(\d+) effective authenticated RPCs and (\d+)\/(\d+) effective authenticated RLS\/storage policies/,runLive('scripts/auth-session-boundary-checks.mjs','auth session boundary'),'auth session boundary');
assert.equal(Number(liveMigrationFirst),1,'live canonical migration chain must begin at 001');
assert.equal(Number(evidence.automated.security.passed),Number(liveSecurityPassed),'RELEASE_EVIDENCE security passed count is stale');
assert.equal(Number(evidence.automated.security.total),Number(liveSecurityTotal),'RELEASE_EVIDENCE security total is stale');
assert.equal(Number(evidence.automated.migration_release.first),Number(liveMigrationFirst),'RELEASE_EVIDENCE migration first is stale');
assert.equal(Number(evidence.automated.migration_release.last),Number(liveMigrationLast),'RELEASE_EVIDENCE migration last is stale');
assert.equal(Number(evidence.automated.project_lint.text_files),Number(liveLintFiles),'RELEASE_EVIDENCE project-lint count is stale');
assert.equal(evidence.structure.dark_mode_source_implemented,true,'RELEASE_EVIDENCE dark-mode source detection drift');
assert.equal(finalSnapshot.verification.product_retention_trust_monetization,`${liveProductPassed}/${liveProductTotal} PASS`,'FINAL_SOURCE_SNAPSHOT product drift');
assert.equal(finalSnapshot.verification.accessibility,`${livePressables} Pressables + ${liveTextInputs} TextInputs + ${liveSwitches} Switches + ${liveModals} Modals PASS`,'FINAL_SOURCE_SNAPSHOT accessibility drift');
assert.equal(finalSnapshot.verification.backend_contracts,`${liveRpcs} RPCs; ${liveEdgeInvocations} invoked Edge Functions; ${liveFunctionDirs} function directories`,'FINAL_SOURCE_SNAPSHOT backend drift');
assert.equal(finalSnapshot.verification.runtime_i18n,`${liveRuntimeLocales}/${liveRuntimeLocalesTotal} x ${liveI18nKeys}`,'FINAL_SOURCE_SNAPSHOT runtime i18n drift');
assert.equal(finalSnapshot.verification.source_used_dynamic_i18n,`${liveSourceUsedKeys} covered`,'FINAL_SOURCE_SNAPSHOT source-used i18n drift');
assert.equal(finalSnapshot.verification.legal_static,`${liveLegalPassed}/${liveLegalTotal} PASS`,'FINAL_SOURCE_SNAPSHOT legal static drift');
assert.equal(finalSnapshot.verification.legal_context,`${liveLegalContextPassed}/${liveLegalContextTotal} PASS`,'FINAL_SOURCE_SNAPSHOT legal context drift');
assert.equal(finalSnapshot.verification.repository_hygiene,`${liveAppModules}/${liveAppModulesTotal} app source; ${liveScripts}/${liveScriptsTotal} scripts command-reachable`,'FINAL_SOURCE_SNAPSHOT repository hygiene drift');
assert.equal(finalSnapshot.verification.authenticated_rpc_session_boundary,`${liveAuthRpcs}/${liveAuthRpcsTotal} PASS`,'FINAL_SOURCE_SNAPSHOT authenticated RPC drift');
assert.equal(liveAuthPolicies,liveAuthPoliciesTotal,'authenticated RLS/storage live boundary must be complete');

assert.equal(source.source_gap_summary.topic_cells_total,594);
assert.equal(source.source_gap_summary.empty_evidence_cells_total,0);
assert.equal(source.source_gap_summary.remaining_topic_source_presence_gaps,0);
assert.equal(source.source_gap_summary.configured_market_count,27);
assert.equal(source.source_gap_summary.configured_market_source_legal_language_approval_separate_artifact,true);
assert.equal(source.source_gap_summary.source_legal_language_blockers,0);
assert.equal(approval.summary.source_legal_approved_markets,27);
assert.equal(approval.summary.language_source_approved_markets,27);
assert.equal(approval.summary.official_source_topic_cells,594);
assert.equal(approval.summary.exact_country_language_routes,594);assert.equal(approval.summary.binding_country_language_routes,34);assert.equal(approval.summary.accessibility_translation_routes,560);assert.equal(approval.summary.all_supported_country_language_routes,594);
assert.equal(approval.summary.source_legal_language_blockers,0);
assert.equal(supplements.summary.markets,27);
assert.equal(supplements.summary.routes,594);assert.equal(supplements.summary.binding_routes,34);assert.equal(supplements.summary.accessibility_translation_routes,560);
assert.equal(gaps.counts.source_legal_approved_markets,27);
assert.equal(gaps.counts.source_legal_language_approved_markets,27);
assert.equal(gaps.counts.exact_country_language_routes,594);assert.equal(gaps.counts.binding_country_language_routes,34);assert.equal(gaps.counts.accessibility_translation_routes,560);
assert.equal(gaps.counts.source_legal_language_blockers,0);
assert.equal(gaps.source_legal_language_decision,'GO_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE');
assert.equal(completeness.configured_27_source_legal_language_completion,true);
assert.equal(completeness.source_decision,'GO_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE');
assert.equal(completeness.configured_27_source_legal_language.external_counsel_required_for_source_approval,false);
assert.equal(completeness.full_production_legal_operational_completion,false);
assert.equal(blockers.counts.configured_scope_source_integrity_blockers,0);
assert.equal(blockers.counts.source_legal_language_markets_pending,0);
assert.equal(blockers.source_legal_language_decision,'GO_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE');
assert.equal(blockers.production_release_decision,'NO_GO_FAIL_CLOSED');

assert.equal(evidence.automated.legal_completeness_truth.configured_market_source_legal_approvals,'27/27');
assert.equal(evidence.automated.legal_completeness_truth.configured_market_source_language_approvals,'27/27');
assert.equal(evidence.automated.legal_completeness_truth.exact_country_language_routes,'594/594');
assert.equal(evidence.automated.legal_completeness_truth.all_supported_country_language_routes,'594/594');
assert.equal(evidence.automated.legal_completeness_truth.source_legal_language_blockers,0);
assert.equal(evidence.automated.legal_completeness_truth.external_counsel_required_for_source_approval,false);
assert.equal(evidence.automated.i18n.runtime_language_quality_locale_count,19);
assert.equal(evidence.automated.legal_localization.document_locales,22);

for(const [needle,label] of [
  ['Configured source legal approvals: **27/27 PASS**','configured source legal approval'],
  ['Configured legal-language source approvals: **27/27 PASS**','configured source language approval'],
  ['Exact country × required/binding legal-document-language routes: **34/34**','binding country-language routes'],
  ['All supported legal languages across 27 configured countries: **594/594**','all-supported country-language routes'],
  ['Source legal/language blockers: **0**','source blocker count'],
  ['External counsel required for configured source legal/language approval: **NO**','source counsel policy'],
]) assert.ok(report.includes(needle),`current legal report missing ${label}`);
for(const stale of ['Country legal approvals: **0/27**','Statutory/legal-language scope approvals: **0/27**','country approvals=0/27']) assert.ok(!report.includes(stale),`current legal report contains stale source-approval text: ${stale}`);

const sec=`${evidence.automated.security.passed}/${evidence.automated.security.total} PASS`;
const mig=String(evidence.automated.migration_release.last).padStart(3,'0');
const lint=`${evidence.automated.project_lint.text_files} text files PASS`;
assert.equal(finalSnapshot.verification.security,sec,'FINAL_SOURCE_SNAPSHOT security drift');
assert.equal(finalSnapshot.verification.migrations,`001-${mig} contiguous`,'FINAL_SOURCE_SNAPSHOT migration drift');
assert.equal(finalSnapshot.verification.project_lint,lint,'FINAL_SOURCE_SNAPSHOT lint drift');
assert.equal(finalSnapshot.verification.configured_27_source_legal_language,'27/27 legal + 27/27 language; 34/34 binding + 594/594 all-language country routes; 0 source blockers');
for(const [needle,label] of [
  [`Security: **${sec}**`,'current snapshot security'],
  [`Canonical migrations: **001–${mig} contiguous**`,'current snapshot migrations'],
]) assert.ok(currentSnapshot.includes(needle),`current source snapshot missing ${label}`);
for(const [needle,label] of [
  [`security: ${sec}`,'source verification security'],
  [`canonical migrations: 001-${mig} contiguous PASS`,'source verification migrations'],
  [`project lint: ${lint}`,'source verification lint'],
]) assert.ok(sourceVerification.includes(needle),`source verification missing ${label}`);
for(const [needle,label] of [
  [`Security regressions: ${evidence.automated.security.passed}/${evidence.automated.security.total} PASS`,'verification security'],
  ['Configured-27 legal/language source truth: legal approvals=27/27; language approvals=27/27; binding country×language routes=34/34; all supported country×language routes=594/594; source blockers=0;','verification configured source truth'],
]) assert.ok(verification.includes(needle),`verification report missing ${label}`);
for(const [needle,label] of [
  [`Product/retention/trust/monetization: **${liveProductPassed}/${liveProductTotal} PASS**`,'current snapshot product'],
  [`Authenticated RPC/session boundary: **${liveAuthRpcs}/${liveAuthRpcsTotal} PASS**`,'current snapshot auth RPC'],
  [`Runtime i18n: **${liveRuntimeLocales}/${liveRuntimeLocalesTotal} locales × ${Number(liveI18nKeys).toLocaleString('en-US')} keys**`,'current snapshot runtime i18n'],
  [`Source-used/dynamic runtime keys: **${Number(liveSourceUsedKeys).toLocaleString('en-US')} covered**`,'current snapshot source-used i18n'],
  [`Backend contracts: **${liveRpcs} RPCs; ${liveEdgeInvocations} client-invoked Edge Functions; ${liveFunctionDirs} function directories**`,'current snapshot backend'],
  [`Repository hygiene: **${liveAppModules}/${liveAppModulesTotal} application source modules reachable; ${liveScripts}/${liveScriptsTotal} maintenance scripts command-reachable**`,'current snapshot hygiene'],
]) assert.ok(currentSnapshot.includes(needle),`current source snapshot missing ${label}`);
for(const [needle,label] of [
  [`authenticated RPC revocation/MFA boundary: ${liveAuthRpcs}/${liveAuthRpcsTotal} PASS`,'source verification auth RPC'],
  [`product/retention/trust/monetization: ${liveProductPassed}/${liveProductTotal} PASS`,'source verification product'],
  [`accessibility: ${livePressables} Pressables + ${liveTextInputs} TextInputs + ${liveSwitches} Switches + ${liveModals} Modals PASS`,'source verification accessibility'],
  [`backend contracts: ${liveRpcs} RPCs; ${liveEdgeInvocations} invoked Edge Functions; ${liveFunctionDirs} function directories checked`,'source verification backend'],
  [`repository hygiene: ${liveAppModules}/${liveAppModulesTotal} app source modules reachable; ${liveScripts}/${liveScriptsTotal} maintenance scripts command-reachable`,'source verification hygiene'],
  [`runtime i18n: ${liveRuntimeLocales}/${liveRuntimeLocalesTotal} x ${liveI18nKeys}; ${liveSourceUsedKeys} source-used/dynamic keys covered`,'source verification i18n'],
  [`legal static: ${liveLegalPassed}/${liveLegalTotal} PASS`,'source verification legal static'],
  [`legal context: ${liveLegalContextPassed}/${liveLegalContextTotal} PASS`,'source verification legal context'],
]) assert.ok(sourceVerification.includes(needle),`source verification missing ${label}`);
const countryReleaseDoc=readFileSync('docs/COUNTRY_RELEASE_GATES_2026.md','utf8');
const securityDoc=readFileSync('docs/SECURITY.md','utf8');
assert.ok(countryReleaseDoc.includes('1,568 keys per locale'),'country release doc runtime key count is stale');
assert.ok(!countryReleaseDoc.includes('Current source intentionally approves no country'),'country release doc contains superseded zero-approval statement');
assert.ok(!countryReleaseDoc.includes('approved external review'),'country release doc incorrectly requires external review for source approval');
assert.ok(!securityDoc.includes('dated external counsel/store/privacy evidence before any country can be marked releasable'),'security doc contains superseded counsel prerequisite wording');
console.log('audit-report-consistency-check: configured-27 legal/language source truth + current authoritative evidence surfaces PASS');
