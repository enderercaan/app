import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const dir='supabase/migrations';
const files=readdirSync(dir).filter(x=>/^\d+.*\.sql$/.test(x)).sort();

function countArgs(raw){
  const text=raw.trim(); if(!text)return 0;
  let depth=0,count=1,single=false,double=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],prev=text[i-1];
    if(ch==="'"&&prev!=='\\'&&!double)single=!single;
    else if(ch==='"'&&prev!=='\\'&&!single)double=!double;
    else if(!single&&!double){
      if(ch==='('||ch==='[')depth++;
      else if(ch===')'||ch===']')depth=Math.max(0,depth-1);
      else if(ch===','&&depth===0)count++;
    }
  }
  return count;
}
const signatureKey=(name,args)=>`${name}/${countArgs(args)}`;
const functions=new Map();
const functionsByName=new Map();
const executeRoles=new Map();
for(const file of files){
  const sql=readFileSync(join(dir,file),'utf8');
  // Apply CREATE/DROP function events in source order. Keeping a dropped legacy overload in
  // the call graph can create a false PASS when another live overload reaches the boundary.
  const events=[];
  const fnRe=/create or replace function\s+public\.([a-zA-Z0-9_]+)\s*\((.*?)\).*?\$\$(.*?)\$\$;/gis;
  for(const m of sql.matchAll(fnRe))events.push({index:m.index,type:'create',match:m});
  const dropRe=/drop\s+function\s+if\s+exists\s+public\.([a-zA-Z0-9_]+)\s*\(([^;]*)\)\s*;/gi;
  for(const m of sql.matchAll(dropRe))events.push({index:m.index,type:'drop',match:m});
  events.sort((a,b)=>a.index-b.index);
  for(const event of events){
    const m=event.match;
    if(event.type==='create'){
      const key=signatureKey(m[1],m[2]); const fn={file,body:m[3],name:m[1],arity:countArgs(m[2])};
      functions.set(key,fn);
      const same=functionsByName.get(m[1])??new Map(); same.set(fn.arity,fn); functionsByName.set(m[1],same);
    }else{
      const key=signatureKey(m[1],m[2]); const arity=countArgs(m[2]);
      functions.delete(key);
      const same=functionsByName.get(m[1]);
      if(same){same.delete(arity);if(!same.size)functionsByName.delete(m[1]);}
    }
  }
  const privilegeRe=/(grant\s+execute|revoke\s+(?:all|execute))\s+on\s+function\s+public\.([a-zA-Z0-9_]+)\s*\(([^;]*)\)\s+(?:to|from)\s+([^;]+);/gi;
  for(const m of sql.matchAll(privilegeRe)){
    const key=signatureKey(m[2],m[3]);
    const roles=new Set((executeRoles.get(key)??new Set()));
    const listed=m[4].toLowerCase().split(',').map(x=>x.trim());
    if(/^grant/i.test(m[1]))for(const role of listed)roles.add(role);
    else for(const role of listed)roles.delete(role);
    executeRoles.set(key,roles);
  }
}
const roots=new Set(['current_session_satisfies_mfa_if_enrolled','current_session_not_revoked','current_user_has_product_access','require_active_authenticated_session']);
const memo=new Map();
function reachesBoundaryKey(key,stack=new Set()){
  const fn=functions.get(key); if(!fn)return false;
  const memoKey=`${key}`; if(memo.has(memoKey))return memo.get(memoKey);
  if(stack.has(key))return false;
  const next=new Set(stack);next.add(key);
  const calls=[...fn.body.matchAll(/public\.([a-zA-Z0-9_]+)\s*\(/g)].map(m=>m[1]);
  const ok=calls.some(name=>{
    if(roots.has(name))return true;
    const overloads=functionsByName.get(name);
    return overloads ? [...overloads.values()].some(child=>reachesBoundaryKey(`${child.name}/${child.arity}`,next)) : false;
  });
  memo.set(memoKey,ok);return ok;
}
function reachesBoundary(name){
  if(roots.has(name))return true;
  const overloads=functionsByName.get(name); if(!overloads)return false;
  return [...overloads.values()].some(fn=>reachesBoundaryKey(`${fn.name}/${fn.arity}`));
}
const failures=[];let checked=0;
for(const [key,roles] of executeRoles){
  if(!roles.has('authenticated')||roles.has('anon')||!functions.has(key))continue;
  const fn=functions.get(key);
  if(roots.has(fn.name)||fn.name==='mark_all_sessions_revoked')continue;
  checked++;
  if(!reachesBoundaryKey(key))failures.push(`${key} (${fn.file})`);
}
assert.deepEqual(failures,[],`Authenticated RPC(s) lack effective session/MFA revocation boundary: ${failures.join(', ')}`);

// Direct PostgREST/Storage access must close the same revoked-JWT grace window. Parse the
// effective policy set after applying DROP/CREATE statements in migration order, then require
// every policy granted to authenticated users to call the central boundary either directly or
// through an authorization helper that itself reaches the central boundary (for example owns_pet/can_read_storage_object).
const effectivePolicies=new Map();
for(const file of files){
  const sql=readFileSync(join(dir,file),'utf8');
  for(const statement of sql.split(/;\s*(?:\r?\n|$)/)){
    const drop=statement.match(/drop\s+policy\s+if\s+exists\s+([a-zA-Z0-9_"]+)\s+on\s+(public|storage)\.([a-zA-Z0-9_]+)/i);
    if(drop)effectivePolicies.delete(`${drop[2].toLowerCase()}.${drop[3]}:${drop[1].replaceAll('\"','')}`);
    const create=statement.match(/create\s+policy\s+([a-zA-Z0-9_"]+)\s+on\s+(public|storage)\.([a-zA-Z0-9_]+)([\s\S]*)/i);
    if(create)effectivePolicies.set(`${create[2].toLowerCase()}.${create[3]}:${create[1].replaceAll('\"','')}`,{file,body:create[4]});
  }
}
let policyChecked=0;const policyFailures=[];
for(const [key,p] of effectivePolicies){
  if(!/\bto\s+authenticated\b/i.test(p.body))continue;
  policyChecked++;
  const calls=[...p.body.matchAll(/public\.([a-zA-Z0-9_]+)\s*\(/g)].map(m=>m[1]);
  const protectedPolicy=calls.some(name=>reachesBoundary(name));
  if(!protectedPolicy)policyFailures.push(`${key} (${p.file})`);
}
assert.deepEqual(policyFailures,[],`Authenticated RLS/storage policy(s) lack revoked-session boundary: ${policyFailures.join(', ')}`);

const m102=readFileSync(join(dir,'102_authenticated_rpc_session_revocation_closure.sql'),'utf8');
assert.match(m102,/require_active_authenticated_session/);
for(const fn of ['get_available_travel_zones','get_consumable_wallet','get_current_legal_context','get_product_feature_policy','get_restricted_account_legal_support','record_client_error','set_account_paused','track_commercial_referral','track_place_referral','update_measurement_system','update_privacy_settings'])assert.ok(reachesBoundary(fn),`${fn} must reach revocation boundary`);

const m105=readFileSync(join(dir,'105_security_risk_evidence_and_operator_session_revocation.sql'),'utf8');
assert.match(m105,/service_revoke_user_sessions/,'service-role emergency session revocation must exist');
assert.match(m105,/insert into public\.security_user_revocation_state[\s\S]*insert into public\.security_revoked_sessions/i,'operator revocation must set watermark and exact session IDs');
assert.match(m105,/from auth\.sessions s[\s\S]*where s\.user_id=p_user_id/i,'operator revocation must snapshot every known active session');
assert.match(m105,/grant execute on function public\.service_revoke_user_sessions\(uuid,text\) to service_role/i,'operator revocation must remain service-role only');

const m103=readFileSync(join(dir,'103_active_auth_session_and_revocation_second_hardening.sql'),'utf8');
assert.match(m103,/join auth\.sessions s on s\.id=t\.session_id_text::uuid[\s\S]*s\.user_id=auth\.uid\(\)/i,'client/RLS boundary must require an active GoTrue session');
assert.match(m103,/service_session_token_allowed[\s\S]*exists\([\s\S]*from auth\.sessions s[\s\S]*s\.id=p_session_id and s\.user_id=p_user_id/i,'Edge boundary must require an active GoTrue session');
assert.match(m103,/p_iat <= floor\(extract\(epoch from s\.revoked_before\)\)::bigint/i,'same-second global revocation must fail closed');
assert.match(m103,/issued_at <= floor\(extract\(epoch from s\.revoked_before\)\)::bigint/i,'PostgREST same-second global revocation must fail closed');
assert.match(m103,/session_id_text ~\* '\^\[0-9a-f\]/i,'malformed/missing JWT session ids must fail closed');
console.log(`auth-session-boundary-checks: ${checked}/${checked} effective authenticated RPCs and ${policyChecked}/${policyChecked} effective authenticated RLS/storage policies reach revocation/MFA boundary; PASS`);
