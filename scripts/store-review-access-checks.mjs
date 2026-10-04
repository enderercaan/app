import assert from 'node:assert/strict';
import {globSync,readFileSync} from 'node:fs';
const evidence=JSON.parse(readFileSync('release/store-review-access-v22.json','utf8'));
const config=readFileSync('src/services/config.ts','utf8');
const eas=readFileSync('eas.json','utf8');
const runbook=readFileSync('docs/STORE_REVIEW_ACCESS_RUNBOOK.md','utf8');
assert.equal(evidence.policy.review_credentials_in_binary,false);
assert.equal(evidence.policy.review_credentials_in_source_control,false);
assert.equal(evidence.policy.reviewer_entitlement_bypass,false);
assert.equal(evidence.policy.special_security_bypass,false);
assert.match(config,/isDemoEnabled = !isBackendConfigured && env\.enableDemo && env\.appEnv !== 'production'/,'Demo mode must be structurally unavailable in production');
assert.match(eas,/"production"[\s\S]*"EXPO_PUBLIC_ENABLE_DEMO"\s*:\s*"false"/,'Production EAS profile must disable demo mode');
assert.match(runbook,/same production authentication, authorization, legal, moderation, blocking, privacy, and subscription entitlement code paths/i);
assert.match(runbook,/Do not commit credentials/i);
assert.match(runbook,/StoreKit sandbox/i);
assert.match(runbook,/Play license-test/i);
const applicationFiles=globSync('{App.tsx,src/**/*.{ts,tsx},modules/**/*.{ts,tsx,swift,kt,java},supabase/functions/**/*.ts}',{nodir:true});
const source=applicationFiles.map(p=>readFileSync(p,'utf8')).join('\n');
for(const pattern of [
  /apple_reviewer@tailmance\.com/i,
  /reviewer.{0,40}password/i,
  /password.{0,40}reviewer/i,
  /(?:iap|purchase|subscription).{0,40}bypass/i,
  /bypass.{0,40}(?:iap|purchase|subscription)/i,
  /reviewer.{0,60}(?:premium|entitlement).{0,30}(?:true|grant|unlock)/i
]) assert.doesNotMatch(source,pattern,'Production source must not contain a reviewer credential or entitlement/billing bypass');
console.log(`store-review-access-checks: ${applicationFiles.length} application files scanned; ordinary-auth review access with zero credential/IAP bypass PASS`);
