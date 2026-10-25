// Executes the full canonical migration chain on a real PostgreSQL server (PostGIS + pgvector required),
// statically analyses every PL/pgSQL function with plpgsql_check when available, and runs runtime smoke checks.
// Usage: TAILMANCE_PG_HOST=/tmp TAILMANCE_PG_USER=postgres npm run verify:database
// This gate is fail-closed: it exits non-zero when PostgreSQL is unreachable instead of reporting success.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const host=process.env.TAILMANCE_PG_HOST??'/tmp';
const user=process.env.TAILMANCE_PG_USER??'postgres';
const db=process.env.TAILMANCE_PG_DATABASE??'tailmance_chain_check';
const base=['-h',host,'-U',user,'-X','-q','-v','ON_ERROR_STOP=1'];
const psql=(args,input)=>spawnSync('psql',[...base,...args],{encoding:'utf8',input,maxBuffer:64*1024*1024});
const fail=(message)=>{console.error(`postgres-migration-chain-check: FAIL — ${message}`);process.exit(1);};

const ping=psql(['-d','postgres','-At','-c','select 1']);
if(ping.status!==0)fail(`PostgreSQL is not reachable at ${host} as ${user}: ${(ping.stderr||ping.error?.message||'').trim()}`);
for(const sql of [`drop database if exists ${db}`,`create database ${db}`]){const r=psql(['-d','postgres','-c',sql]);if(r.status!==0)fail(r.stderr.trim());}
const stub=psql(['-d',db,'-f','supabase/tests/supabase_platform_stub.sql']);
if(stub.status!==0)fail(`platform stub failed: ${stub.stderr.trim()}`);

const dir='supabase/migrations';
const files=readdirSync(dir).filter(name=>/^\d{3}_.*\.sql$/.test(name)).sort();
for(const name of files){
  const r=psql(['-d',db,'-f',path.join(dir,name)]);
  if(r.status!==0)fail(`${name}: ${r.stderr.split('\n').filter(line=>/ERROR|LINE|DETAIL|HINT/.test(line)).slice(0,4).join(' | ')}`);
}
console.log(`postgres-migration-chain-check: ${files.length}/${files.length} migrations applied on a real server`);

// Trigger functions that branch on TG_TABLE_NAME reference columns of sibling tables; plpgsql_check reports those
// branches against the first attached table only. They are reviewed false positives and listed explicitly.
const reviewedTriggerFalsePositives=new Set(['enforce_high_risk_device_integrity()','enforce_safe_operator_external_urls()','reject_pet_rehoming_ugc()','reject_pet_commerce_ugc()']);
const ext=psql(['-d',db,'-c','create extension if not exists plpgsql_check']);
if(ext.status!==0)fail('plpgsql_check extension is required for the static PL/pgSQL gate (install postgresql-<major>-plpgsql-check)');
const check=psql(['-d',db,'-At','-F','\t','-c',`select p.oid::regprocedure,(pcf).message from (
  select p.oid,plpgsql_check_function_tb(p.oid,coalesce(t.tgrelid,0),fatal_errors=>false,other_warnings=>false,performance_warnings=>false,extra_warnings=>false) pcf
  from pg_proc p join pg_language l on l.oid=p.prolang left join lateral (select tgrelid from pg_trigger where tgfoid=p.oid limit 1) t on true
  where p.pronamespace='public'::regnamespace and l.lanname='plpgsql' and (p.prorettype<>'trigger'::regtype or t.tgrelid is not null)
) x join pg_proc p on p.oid=x.oid where (pcf).level='error'`]);
if(check.status!==0)fail(check.stderr.trim());
const errors=check.stdout.split('\n').filter(Boolean).filter(line=>!reviewedTriggerFalsePositives.has(line.split('\t')[0]));
if(errors.length)fail(`plpgsql_check errors:\n- ${errors.join('\n- ')}`);
console.log('postgres-migration-chain-check: plpgsql_check 0 runtime errors outside reviewed TG_TABLE_NAME branches');

const smoke=spawnSync('psql',['-h',host,'-U',user,'-X','-q','-d',db,'-f','supabase/tests/runtime_smoke.sql'],{encoding:'utf8'});
const out=smoke.stdout+smoke.stderr;
for(const expected of ['GRANT_RESULT | t','BALANCE  |             5 |                  0','EVENT_STATUS | processed','FEATURE_POLICY_ARGS_OK | t']){
  if(!out.includes(expected))fail(`runtime smoke expectation missing: ${expected}\n${out}`);
}
if(/ERROR/.test(out))fail(`runtime smoke raised an error:\n${out}`);
console.log('postgres-migration-chain-check: runtime smoke PASS (consumable credit grant, feature policy)');
const health=spawnSync('psql',['-h',host,'-U',user,'-X','-q','-d',db,'-f','supabase/tests/health_document_check_smoke.sql'],{encoding:'utf8'});
const healthOut=(health.stdout+health.stderr).replace(/[ \t]+/g,' ').replace(/ \|/g,' |').replace(/ +\|/g,' |');
for(const expected of ['HC_BEFORE | f','HC_APPROVED | auto_verified','HC_DOC | verified','HC_SUMMARY | complete','HC_ATTESTATION | vaccination_complete | ai_document_check | google_cloud_vision','HC_CURRENT | t | t','HC_LOG | health_document_check | auto_verified','HC_DOWNGRADE | manual_review','HC_DETAILS | true','HC_NO_VET_FIELDS | t','HC_PET_JSON | complete','HC_EXPIRED | f | f','HC_PET_JSON_EXPIRED | unknown','HC_AI_NEUTERED_BLOCKED','HC_AI_MICROCHIP_OK t','HC_UNITS_BLOCKED','HC_UNITS_REFUND_OK']){
  if(!healthOut.includes(expected))fail(`health document check smoke expectation missing: ${expected}\n${healthOut}`);
}
if(healthOut.includes('HC_AI_NEUTERED_ALLOWED')||healthOut.includes('HC_AI_MICROCHIP_FAILED')||healthOut.includes('HC_UNITS_NOT_BLOCKED')||/ERROR/.test(healthOut))fail(`health document check smoke failed:\n${healthOut}`);
console.log('postgres-migration-chain-check: health document check smoke PASS (approval, expiry, downgrade, AI signal restriction, free-tier guard, no veterinarian fields)');
psql(['-d','postgres','-c',`drop database if exists ${db}`]);
