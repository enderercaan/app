import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const files=[];
const walk=(dir)=>{for(const name of readdirSync(dir)){const p=join(dir,name);statSync(p).isDirectory()?walk(p):files.push(p)}};
walk('src');
const source=files.filter(f=>/\.(ts|tsx)$/.test(f)).map(f=>readFileSync(f,'utf8')).join('\n');

// Catch namespace-call regressions that client syntax-only parsing cannot detect
// (for example api.getFeed(...) after getFeed was removed from services/api.ts).
const apiSource=readFileSync('src/services/api.ts','utf8');
const apiExports=new Set([
  ...apiSource.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g),
].map(m=>m[1]));
for(const file of files.filter(f=>/\.(ts|tsx)$/.test(f))){
  const body=readFileSync(file,'utf8');
  const namespaceImports=[...body.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]*services\/api)['"]/g)];
  for(const [,ns] of namespaceImports){
    const calls=[...body.matchAll(new RegExp(`\\b${ns.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.([A-Za-z_$][\\w$]*)\\s*\\(`,'g'))].map(m=>m[1]);
    for(const name of new Set(calls)) assert.ok(apiExports.has(name),`${file}: ${ns}.${name}(...) is not exported by src/services/api.ts`);
  }
}

const migrationSource=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(join('supabase/migrations',f),'utf8')).join('\n');
const pendingPatchSource='';
const backendContractSource=migrationSource;
const edgeTsFiles=[];
const walkEdge=(dir)=>{for(const name of readdirSync(dir)){const p=join(dir,name);statSync(p).isDirectory()?walkEdge(p):/\.ts$/.test(p)&&edgeTsFiles.push(p)}};
walkEdge('supabase/functions');
const edgeSource=edgeTsFiles.map(f=>readFileSync(f,'utf8')).join('\n');
const rpcNames=[...(source+'\n'+edgeSource).matchAll(/\.rpc\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
const uniqueRpcs=[...new Set(rpcNames)].sort();
for(const rpc of uniqueRpcs){
  const escaped=rpc.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.match(backendContractSource,new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\s*\\(`,'i'),`Frontend RPC missing from canonical migrations: ${rpc}`);
}
const invoked=[...source.matchAll(/functions\.invoke\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
const functionDirs=readdirSync('supabase/functions').filter(name=>name!=='_shared'&&statSync(join('supabase/functions',name)).isDirectory());
for(const name of [...new Set(invoked)].sort())assert.ok(functionDirs.includes(name),`Frontend invokes missing Edge Function: ${name}`);

const config=readFileSync('supabase/config.toml','utf8');
const functionConfigSections=new Map();
let currentFunctionSection=null;
for(const rawLine of config.split(/\r?\n/)){
  const line=rawLine.trim();
  const header=/^\[functions\.([^\]]+)\]$/.exec(line);
  if(header){
    currentFunctionSection=header[1];
    functionConfigSections.set(currentFunctionSection,[]);
    continue;
  }
  if(/^\[/.test(line)){currentFunctionSection=null;continue}
  if(currentFunctionSection)functionConfigSections.get(currentFunctionSection).push(line);
}
const falseJwtAuthContracts={
  'revenuecat-webhook':[/REVENUECAT_WEBHOOK_AUTH/,/verifyRevenueCatAuthorization/,/REVENUECAT_WEBHOOK_ENVIRONMENT/,/REVENUECAT_ALLOWED_APP_IDS_JSON/],
  'push-dispatch':[/PUSH_WORKER_SECRET/,/Authorization/],
  'livekit-room-reaper':[/LIVEKIT_ROOM_REAPER_SECRET/,/verifyBearerSecret/,/service_claim_livekit_room_teardowns/,/deleteRoom/],
  'moderate-media':[/MODERATION_WORKER_SECRET/,/Authorization/],
  'push-receipts':[/PUSH_WORKER_SECRET/,/Authorization/],
  'moderation-admin':[/MODERATION_ADMIN_SECRET/,/Authorization/],
  'moderation-appeals-admin':[/MODERATION_APPEALS_ADMIN_SECRET/,/Authorization/],
  'request-account-deletion':[/TURNSTILE_SECRET_KEY/,/verifyTurnstile/],
  'storage-gc':[/STORAGE_GC_SECRET/,/Authorization/],
  'external-deletion-worker':[/EXTERNAL_DELETION_WORKER_SECRET/,/Authorization/],
  'reports-admin':[/REPORTS_ADMIN_SECRET/,/Authorization/],
  'identity-verification-webhook':[/IDENTITY_WEBHOOK_SECRET/,/X-Tailmance-Signature/,/safeEqual/],
  'health-ai-worker':[/HEALTH_AI_WORKER_SECRET/,/verifyBearerSecret/,/claim_health_ai_jobs/,/service_apply_health_ai_result/,/service_defer_health_ai_job/],
  'ops-health':[/OPS_HEALTH_SECRET/,/Authorization/],
  'vaccination-reminders':[/REMINDER_WORKER_SECRET/,/Authorization/],
  'process-account-deletion-request':[/ACCOUNT_DELETION_ADMIN_SECRET/,/Authorization/],
  'export-download':[/TOKEN_RE/,/sha256Hex/,/claim_account_export_download_token/],
  'security-admin':[/SECURITY_ADMIN_SECRET/,/verifyBearerSecret/,/revoke_user_sessions/,/service_revoke_user_sessions/]
};
for(const name of functionDirs){
  const entry=join('supabase/functions',name,'index.ts');
  if(!statSync(entry).isFile())continue;
  const sectionLines=functionConfigSections.get(name);
  assert.ok(sectionLines,`${name} must have an explicit [functions.${name}] config section`);
  const section=sectionLines.join('\n');
  const jwtMatch=/^verify_jwt\s*=\s*(true|false)$/m.exec(section);
  assert.ok(jwtMatch,`${name} must explicitly set verify_jwt=true|false`);
  if(jwtMatch[1]==='false'){
    const body=readFileSync(entry,'utf8');
    const required=falseJwtAuthContracts[name];
    assert.ok(required,`${name} has verify_jwt=false without a declared alternate-auth contract`);
    for(const pattern of required)assert.match(body,pattern,`${name} is missing alternate-auth evidence: ${pattern}`);
  }
}
const pendingOnly=uniqueRpcs.filter(rpc=>{const escaped=rpc.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\s*\\(`,'i');return !re.test(migrationSource)&&re.test(pendingPatchSource)});
console.log(`backend-contract-checks: ${uniqueRpcs.length} RPCs (${pendingOnly.length} pending-patch only), ${[...new Set(invoked)].length} invoked Edge Functions, ${functionDirs.length} function directories checked`);
