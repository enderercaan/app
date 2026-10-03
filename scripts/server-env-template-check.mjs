import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';

const templatePath='supabase/.env.example';
const template=readFileSync(templatePath,'utf8');
const keyLines=[...template.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(m=>({key:m[1],value:m[2]}));
const keys=keyLines.map(x=>x.key);
assert.equal(new Set(keys).size,keys.length,'supabase/.env.example must not contain duplicate keys');

const serverCheck=readFileSync('scripts/server-release-config-check.mjs','utf8');
const requiredBlock=serverCheck.match(/const required=\[(.*?)\];/s)?.[1]??'';
const releaseRequired=[...requiredBlock.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map(m=>m[1]);
assert.ok(releaseRequired.length>=40,'Could not recover server release required-variable list');

const runtimeEnv=new Set();
for(const file of globSync('supabase/functions/**/*.ts')){
  const source=readFileSync(file,'utf8');
  for(const m of source.matchAll(/Deno\.env\.get\(['"]([A-Z][A-Z0-9_]*)['"]\)/g))runtimeEnv.add(m[1]);
}

const expected=new Set([...releaseRequired,...runtimeEnv,'SUPABASE_AUTH_CAPTCHA_SECRET']);
for(const key of [...expected].sort()) assert.ok(keys.includes(key),`${templatePath} missing ${key}`);
for(const key of keys) assert.ok(expected.has(key),`${templatePath} contains stale/unrecognized key ${key}`);

const sensitive=/(?:SECRET|KEY|AUTH|TOKEN|SERVICE_ACCOUNT_JSON)$/;
for(const {key,value} of keyLines){
  if(!sensitive.test(key))continue;
  assert.ok(value===''||value==='{}'||value==='[]',`${templatePath} must not source-control a real-looking sensitive value for ${key}`);
}

assert.equal(keys.length,expected.size,`${templatePath} key count must exactly match runtime/release schema`);
console.log(`server-env-template-check: ${keys.length}/${expected.size} server env keys synchronized; ${releaseRequired.length} release-required + ${runtimeEnv.size} runtime-referenced`);
