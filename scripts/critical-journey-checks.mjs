import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {REQUIRED_UI_EVIDENCE, validateUiEvidence} from './critical-journey-release-check.mjs';

const read=p=>readFileSync(p,'utf8');
const app=read('app.config.ts');
const primary=read('src/components/PrimaryButton.tsx');
const auth=read('src/screens/AuthScreen.tsx');
const onboarding=read('src/screens/OnboardingScreen.tsx');
const profile=read('src/screens/ProfileScreen.tsx');
const verification=read('src/screens/VerificationCenterScreen.tsx');
const premium=read('src/screens/PremiumScreen.tsx');
const nav=read('src/navigation/AppNavigator.tsx');
const onboardingFlow=read('e2e/maestro/onboarding-entry.yaml');
const readyFlow=read('e2e/maestro/verification-paywall.yaml');
const evidence=JSON.parse(read('release/ui-e2e-evidence-v23.json'));

assert.match(app,/bundleIdentifier: 'com\.pawlink\.app'/);
assert.match(app,/package: 'com\.pawlink\.app'/);
assert.match(primary,/testID\?:string/);
for(const [source,id] of [
  [auth,'auth.screen'],[auth,'auth.email'],[auth,'auth.password'],[auth,'auth.primary'],
  [onboarding,'onboarding.screen'],[onboarding,'onboarding.primary'],
  [profile,'profile.screen'],[profile,'profile.open-verification'],[profile,'profile.open-premium'],
  [verification,'verification.screen'],[premium,'premium.screen'],[premium,'premium.precontract-review'],[premium,'premium.purchase']
]) assert.ok(source.includes(id),`missing deterministic UI selector ${id}`);
for(const id of ['tab.feed','tab.discover','tab.matches','tab.messages','tab.profile'])assert.ok(nav.includes(id),`missing stable tab selector ${id}`);
for(const flow of [onboardingFlow,readyFlow]){
  assert.match(flow,/appId: com\.pawlink\.app/);
  assert.doesNotMatch(flow,/password\s*:\s*['\"]?[^$\n]/i,'Maestro flow must not embed a password');
  assert.doesNotMatch(flow,/@tailmance\.com/i,'review/test email must not be embedded in repository');
  assert.doesNotMatch(flow,/EXPO_PUBLIC_ENABLE_DEMO|demoMode|premium.*bypass|iap.*bypass/i,'critical journey must use ordinary production paths');
}
assert.match(onboardingFlow,/TAILMANCE_E2E_ONBOARDING_EMAIL/);
assert.match(onboardingFlow,/TAILMANCE_E2E_ONBOARDING_PASSWORD/);
assert.match(onboardingFlow,/id: "onboarding\.screen"/);
assert.match(readyFlow,/TAILMANCE_E2E_READY_EMAIL/);
assert.match(readyFlow,/TAILMANCE_E2E_READY_PASSWORD/);
assert.match(readyFlow,/id: "profile\.open-verification"[\s\S]*id: "verification\.screen"[\s\S]*id: "profile\.open-premium"[\s\S]*id: "premium\.screen"/);
assert.deepEqual(evidence.required_execution_evidence.map(x=>x.id),Object.keys(REQUIRED_UI_EVIDENCE));
assert.ok(evidence.required_execution_evidence.every(x=>x.status==='not_verified'||x.status==='verified'));
if(evidence.required_execution_evidence.every(x=>x.status==='verified'))validateUiEvidence(evidence);
assert.equal(evidence.source_contract.credentials_policy,'environment_injected_only_no_binary_or_repo_credentials');
// Synthetic fixtures exercise the validator only; they are not device evidence.
const fixtureRoot=mkdtempSync(join(tmpdir(),'tailmance-evidence-gate-'));
try {
  mkdirSync(join(fixtureRoot,'e2e/maestro'),{recursive:true});
  for(const path of evidence.source_contract.flows)writeFileSync(join(fixtureRoot,path),'synthetic flow fixture');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
  writeFileSync(join(fixtureRoot,'fixture.png'),png);
  writeFileSync(join(fixtureRoot,'fixture.txt'),'synthetic validator fixture; not a real device run');
  const candidate=structuredClone(evidence);
  for(const item of candidate.required_execution_evidence){
    item.status='verified';
    item.execution={result:'passed',runner:'Maestro',device_kind:'physical_device',app_version:'fixture',build_number:'fixture',started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:00:01Z',devices:['ios','android'].map(platform=>({platform,device_id_sha256:'a'.repeat(64),os_version:'fixture'}))};
    item.artifacts={};
    for(const key of REQUIRED_UI_EVIDENCE[item.id].required){
      const screenshot=key.includes('screenshot');
      const record={path:screenshot?'fixture.png':'fixture.txt',sha256:hash(screenshot?png:readFileSync(join(fixtureRoot,'fixture.txt')))};
      item.artifacts[key]=record;
      if(key.endsWith('_sha256'))item[key]=record.sha256;
    }
  }
  assert.deepEqual(validateUiEvidence(candidate,fixtureRoot),{items:3,artifacts:16});
  const rejects=(edit,pattern)=>{const copy=structuredClone(candidate);edit(copy);assert.throws(()=>validateUiEvidence(copy,fixtureRoot),pattern);};
  rejects(x=>delete x.required_execution_evidence,/missing_or_extra/);
  rejects(x=>x.required_execution_evidence=[],/missing_or_extra/);
  rejects(x=>x.required_execution_evidence[1]=structuredClone(x.required_execution_evidence[0]),/duplicate/);
  rejects(x=>x.required_execution_evidence[0].id='unknown',/unknown/);
  rejects(x=>x.required_execution_evidence[0].platform='android',/wrong_platform/);
  rejects(x=>x.required_execution_evidence[0].required=[],/required_contract_changed/);
  rejects(x=>x.required_execution_evidence[0].status='not_verified',/not_verified/);
  rejects(x=>delete x.required_execution_evidence[0].execution,/missing_physical/);
  rejects(x=>x.required_execution_evidence[0].execution.device_kind='emulator',/missing_physical/);
  rejects(x=>x.required_execution_evidence[0].execution.devices=[],/missing_device/);
  rejects(x=>x.required_execution_evidence[0].execution.completed_at='invalid',/invalid_execution_time/);
  rejects(x=>delete x.required_execution_evidence[0].artifacts.real_release_candidate_build,/missing_artifact/);
  rejects(x=>x.required_execution_evidence[0].artifacts.real_review_account.sha256='0'.repeat(64),/sha256_mismatch/);
  rejects(x=>x.required_execution_evidence[0].test_run_log_sha256='0'.repeat(64),/declared_hash_mismatch/);
  rejects(x=>x.required_execution_evidence[0].artifacts.real_review_account.path='/tmp/fixture',/invalid_path/);
  rejects(x=>x.required_execution_evidence[0].artifacts.real_review_account.path='missing.txt',/ENOENT/);
  writeFileSync(join(fixtureRoot,'empty.txt'),'');
  rejects(x=>x.required_execution_evidence[0].artifacts.real_review_account={path:'empty.txt',sha256:hash('')},/empty_or_non_file/);
  const outside=join(fixtureRoot,'..',`${fixtureRoot.split('/').at(-1)}-outside.txt`);
  writeFileSync(outside,'outside');
  try{
    symlinkSync(outside,join(fixtureRoot,'escape.txt'));
    rejects(x=>x.required_execution_evidence[0].artifacts.real_review_account={path:'escape.txt',sha256:hash('outside')},/outside_evidence_root/);
  }finally{rmSync(outside,{force:true});}
  rejects(x=>{const item=x.required_execution_evidence[0];item.artifacts.onboarding_entry_screenshot_sha256={path:'fixture.txt',sha256:hash(readFileSync(join(fixtureRoot,'fixture.txt')))};item.onboarding_entry_screenshot_sha256=item.artifacts.onboarding_entry_screenshot_sha256.sha256;},/not_png/);
  const statusOnly=structuredClone(evidence);
  for(const item of statusOnly.required_execution_evidence){item.status='verified';delete item.execution;delete item.artifacts;}
  assert.throws(()=>validateUiEvidence(statusOnly,fixtureRoot),/missing_physical/);
}finally{rmSync(fixtureRoot,{recursive:true,force:true});}
console.log('critical-journey-evidence-validator: 21 structural/adversarial fixture cases PASS; no real device execution claimed');
console.log('critical-journey-checks: deterministic no-backdoor Maestro source contracts PASS; real device/golden execution remains explicit external evidence');
