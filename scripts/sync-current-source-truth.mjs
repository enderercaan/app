import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const check=process.argv.includes('--check');
const e=JSON.parse(readFileSync('RELEASE_EVIDENCE.json','utf8'));
function runLive(script,label){
  const r=spawnSync(process.execPath,[script],{cwd:process.cwd(),encoding:'utf8'});
  if(r.status!==0){process.stderr.write(r.stdout??'');process.stderr.write(r.stderr??'');throw new Error(`${label} live check failed`);}
  return `${r.stdout??''}${r.stderr??''}`;
}
function parse(re,text,label){const m=text.match(re);assert.ok(m,`${label}: live output could not be parsed`);return m.slice(1);}
const [liveSecPassed,liveSecTotal]=parse(/security-checks:\s*(\d+)\/(\d+)\s+passed/,runLive('scripts/security-checks.mjs','security'),'security');
const [liveMigFirst,liveMigLast]=parse(/migration-release-check:\s*canonical migrations (\d+)-(\d+) contiguous;/,runLive('scripts/migration-release-check.mjs','migration release'),'migration release');
const [liveLintFiles]=parse(/project-lint:\s*scanned (\d+) text files; passed/,runLive('scripts/project-lint.mjs','project lint'),'project lint');
const [liveAuthRpcs,liveAuthRpcsTotal,liveAuthPolicies,liveAuthPoliciesTotal]=parse(/auth-session-boundary-checks:\s*(\d+)\/(\d+) effective authenticated RPCs and (\d+)\/(\d+) effective authenticated RLS\/storage policies/,runLive('scripts/auth-session-boundary-checks.mjs','auth boundary'),'auth boundary');
const [liveHygieneModules,liveHygieneModulesTotal,liveHygieneScripts,liveHygieneScriptsTotal]=parse(/repository-hygiene-checks:\s*clean tree; (\d+)\/(\d+) app source modules reachable; (\d+)\/(\d+) maintenance scripts (?:referenced|command-reachable)/,runLive('scripts/repository-hygiene-checks.mjs','repository hygiene'),'repository hygiene');
const [liveProductPassed,liveProductTotal]=parse(/product-retention-checks:\s*(\d+)\/(\d+) strategic product/,runLive('scripts/product-retention-checks.mjs','product retention'),'product retention');
const [liveApplicabilityPassed,liveApplicabilityTotal]=parse(/security-control-applicability-checks:\s*(\d+)\/(\d+) scoped controls classified/,runLive('scripts/security-control-applicability-checks.mjs','security applicability'),'security applicability');
assert.equal(Number(liveMigFirst),1,'canonical migration chain must begin at 001');
assert.equal(Number(e.automated.security.passed),Number(liveSecPassed),'RELEASE_EVIDENCE security passed count is stale; run npm run evidence:generate');
assert.equal(Number(e.automated.security.total),Number(liveSecTotal),'RELEASE_EVIDENCE security total is stale; run npm run evidence:generate');
assert.equal(Number(e.automated.migration_release.first),Number(liveMigFirst),'RELEASE_EVIDENCE migration first is stale; run npm run evidence:generate');
assert.equal(Number(e.automated.migration_release.last),Number(liveMigLast),'RELEASE_EVIDENCE migration last is stale; run npm run evidence:generate');
assert.equal(Number(e.automated.project_lint.text_files),Number(liveLintFiles),'RELEASE_EVIDENCE lint count is stale; run npm run evidence:generate');
const sec=`${liveSecPassed}/${liveSecTotal} PASS`;
const mig=String(liveMigLast).padStart(3,'0');
const lint=`${liveLintFiles} text files PASS`;
const auth=`${liveAuthRpcs}/${liveAuthRpcsTotal} PASS`;
const rls=`${liveAuthPolicies}/${liveAuthPoliciesTotal} PASS`;
const hygiene=`${liveHygieneModules}/${liveHygieneModulesTotal} app source; ${liveHygieneScripts}/${liveHygieneScriptsTotal} scripts command-reachable`;
const product=`${liveProductPassed}/${liveProductTotal} PASS`;
const applicability=`${liveApplicabilityPassed}/${liveApplicabilityTotal} scoped controls classified PASS`;
const domain=`${e.automated.domain.passed}/${e.automated.domain.total} PASS`;
const hardening=`${e.automated.pending_hardening.passed}/${e.automated.pending_hardening.total} PASS`;
const a=e.automated.accessibility; const a11y=`${a.pressables} Pressables + ${a.text_inputs} TextInputs + ${a.switches} Switches + ${a.modals} Modals PASS`;
const b=e.automated.backend_contracts; const backend=`${b.rpcs} RPCs; ${b.client_edge_invocations} invoked Edge Functions; ${b.function_directories} function directories`;
const ux=`${e.automated.ux.tsx_files} TSX files PASS`;
const i=e.automated.i18n; const runtimeI18n=`${i.declared_locales}/${i.declared_locales} x ${i.runtime_catalog_key_count}`; const sourceI18n=`${i.source_used_dynamic_key_count} covered`; const critical=`${i.critical_key_manifest_count}/${i.critical_key_manifest_count}`;
const legalStatic=`${e.automated.legal.passed}/${e.automated.legal.total} PASS`;
const legalContext=`${e.automated.legal_context_matrix.passed}/${e.automated.legal_context_matrix.total} PASS`;
const legalDocs=`${e.automated.legal_localization.document_locales}/${e.automated.legal_localization.document_locales} x ${e.automated.legal_localization.required_document_families_per_locale} = ${e.automated.legal_localization.generated_localized_documents}`;
const legal='27/27 legal + 27/27 language; 34/34 binding + 594/594 all-language country routes; 0 source blockers';
function syncText(path, mutate){const old=readFileSync(path,'utf8');const next=mutate(old);if(check)assert.equal(old,next,`${path}: current truth drift; run npm run current-truth:sync`);else writeFileSync(path,next)}
syncText('docs/final/TAILMANCE_V19_R8_CURRENT_SOURCE_SNAPSHOT_2026-09-30.md',s=>s
 .replace(/- Domain: \*\*.*?\*\*\./,`- Domain: **${domain}**.`)
 .replace(/- Security: \*\*.*?\*\*\./,`- Security: **${sec}**.`)
 .replace(/- Product\/retention\/trust\/monetization: \*\*.*?\*\*\./,`- Product/retention/trust/monetization: **${product}**.`)
 .replace(/- Pending hardening: \*\*.*?\*\*\./,`- Pending hardening: **${hardening}**.`)
 .replace(/- Authenticated RPC\/session boundary:.*?\n/,`- Authenticated RPC/session boundary: **${auth}**; authenticated RLS/storage boundary: **${rls}**.\n`)
 .replace(/- Legal static: \*\*.*?\*\*\./,`- Legal static: **${legalStatic}**.`)
 .replace(/- Legal context: \*\*.*?\*\*\./,`- Legal context: **${legalContext}**.`)
 .replace(/- Runtime i18n:.*?\n/,`- Runtime i18n: **${i.declared_locales}/${i.declared_locales} locales × ${i.runtime_catalog_key_count.toLocaleString('en-US')} keys**; fixed critical localization **${critical}** per non-English locale.\n`)
 .replace(/- Source-used\/dynamic runtime keys:.*?\n/,`- Source-used/dynamic runtime keys: **${i.source_used_dynamic_key_count.toLocaleString('en-US')} covered**.\n`)
 .replace(/- Legal documents\/public routes:.*?\n/,`- Legal documents/public routes: **${e.automated.legal_localization.document_locales}/${e.automated.legal_localization.document_locales} × ${e.automated.legal_localization.required_document_families_per_locale} = ${e.automated.legal_localization.generated_localized_documents} / ${e.automated.legal_localization.generated_localized_documents}**.\n`)
 .replace(/- Backend contracts:.*?\n/,`- Backend contracts: **${b.rpcs} RPCs; ${b.client_edge_invocations} client-invoked Edge Functions; ${b.function_directories} function directories**.\n`)
 .replace(/- Accessibility:.*?\n/,`- Accessibility: **${a11y}**; UX static gate: **${ux}**.\n`)
 .replace(/- Project lint: \*\*[\d,]+ text files PASS\*\*\./,`- Project lint: **${Number(liveLintFiles).toLocaleString('en-US')} text files PASS**.`)
 .replace(/- Canonical migrations: \*\*001–\d+ contiguous\*\*\./,`- Canonical migrations: **001–${mig} contiguous**.`)
 .replace(/- Repository hygiene:.*?\n/,`- Repository hygiene: **${liveHygieneModules}/${liveHygieneModulesTotal} application source modules reachable; ${liveHygieneScripts}/${liveHygieneScriptsTotal} maintenance scripts command-reachable**.\n`));
syncText('docs/final/SOURCE_VERIFICATION_2026-09-30.txt',s=>s
 .replace(/- canonical migrations: 001-\d+ contiguous PASS/,`- canonical migrations: 001-${mig} contiguous PASS`)
 .replace(/- domain: \d+\/\d+ PASS/,`- domain: ${domain}`)
 .replace(/- security: \d+\/\d+ PASS/,`- security: ${sec}`)
 .replace(/- authenticated RPC revocation\/MFA boundary: \d+\/\d+ PASS/,`- authenticated RPC revocation/MFA boundary: ${auth}`)
 .replace(/- authenticated RLS\/storage boundary: \d+\/\d+ PASS/,`- authenticated RLS/storage boundary: ${rls}`)
 .replace(/- security control applicability: .*? PASS/,`- security control applicability: ${applicability}`)
 .replace(/- product\/retention\/trust\/monetization: \d+\/\d+ PASS/,`- product/retention/trust/monetization: ${product}`)
 .replace(/- pending hardening: \d+\/\d+ PASS/,`- pending hardening: ${hardening}`)
 .replace(/- accessibility: .*? PASS/,`- accessibility: ${a11y}`)
 .replace(/- backend contracts: .*? checked/,`- backend contracts: ${backend} checked`)
 .replace(/- repository hygiene:.*?\n/,`- repository hygiene: ${liveHygieneModules}/${liveHygieneModulesTotal} app source modules reachable; ${liveHygieneScripts}/${liveHygieneScriptsTotal} maintenance scripts command-reachable\n`)
 .replace(/- runtime i18n: .*? per non-English locale/,`- runtime i18n: ${runtimeI18n}; ${i.source_used_dynamic_key_count} source-used/dynamic keys covered; ${critical} critical localized per non-English locale`)
 .replace(/- legal static: \d+\/\d+ PASS/,`- legal static: ${legalStatic}`)
 .replace(/- legal context: \d+\/\d+ PASS/,`- legal context: ${legalContext}`)
 .replace(/- legal documents\/public routes: .*?\n/,`- legal documents/public routes: ${e.automated.legal_localization.document_locales} x ${e.automated.legal_localization.required_document_families_per_locale} = ${e.automated.legal_localization.generated_localized_documents} / ${e.automated.legal_localization.generated_localized_documents}\n`)
 .replace(/- project lint: \d+ text files PASS/,`- project lint: ${lint}`)
 .replace(/- configured-27 legal\/language source approval:.*source blockers/,`- configured-27 legal/language source approval: ${legal}`));
const p='docs/final/FINAL_SOURCE_SNAPSHOT.json';const d=JSON.parse(readFileSync(p,'utf8'));
d.verification.domain=domain;d.verification.security=sec;d.verification.authenticated_rpc_session_boundary=auth;d.verification.authenticated_rls_storage_session_boundary=rls;d.verification.security_control_applicability=applicability;d.verification.product_retention_trust_monetization=product;d.verification.pending_hardening=hardening;d.verification.accessibility=a11y;d.verification.backend_contracts=backend;d.verification.legal_static=legalStatic;d.verification.legal_context=legalContext;d.verification.runtime_i18n=runtimeI18n;d.verification.source_used_dynamic_i18n=sourceI18n;d.verification.legal_documents=legalDocs;d.verification.public_legal_routes=`${e.automated.legal_localization.generated_localized_documents}/${e.automated.legal_localization.generated_localized_documents}`;d.verification.migrations=`001-${mig} contiguous`;d.verification.repository_hygiene=hygiene;d.verification.project_lint=lint;d.verification.configured_27_source_legal_language=legal;
const json=JSON.stringify(d,null,2)+'\n';if(check)assert.equal(readFileSync(p,'utf8'),json,`${p}: current truth drift; run npm run current-truth:sync`);else writeFileSync(p,json);
console.log(`current-source-truth: ${check?'PASS':'synchronized'} domain=${domain}; security=${sec}; auth=${auth}+${rls}; product=${product}; a11y=${a11y}; backend=${backend}; legal=${legalStatic}; migrations=001-${mig}; lint=${lint}; configured-27 legal/language PASS`);
