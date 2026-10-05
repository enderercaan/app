import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const evidence=JSON.parse(readFileSync('release/edge-ai-model-evidence-v21.json','utf8'));
assert.equal(evidence.policy,'fail_closed');
assert.equal(evidence.runtime_source_status,'IMPLEMENTED_HASH_VERIFIED_NATIVE_RUNTIME');
const items=Object.entries(evidence.items??{});
if(evidence.v1_scope_decision?.decision==='disabled_in_v1_server_moderation_authoritative'){
  const edge=readFileSync('src/services/edgeAi.ts','utf8');
  assert.match(edge,/edge_ai_manifest_not_configured/,'edge AI must fail closed when no manifest is configured');
  assert.match(edge,/decision:'unavailable'/,'prefilter must report unavailable so server moderation decides');
  for(const k of ['EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_URL','EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_SHA256'])assert.ok(!process.env[k],`${k} must stay unset while on-device AI is disabled in v1`);
  console.log('edge-ai-release-check: on-device AI disabled in v1 by operator decision; server moderation authoritative; runtime fails closed to server moderation');
  process.exit(0);
}
const latency=evidence.items?.physical_device_latency_memory_and_offline_smoke;
assert.equal(latency?.required_p95_warm_inference_ms_lte,30,'Edge AI release target must remain <=30ms p95 warm inference');
assert.ok(items.length>=6,'edge-AI external evidence matrix incomplete');
const failures=[];
for(const [name,item] of items){
  if(item?.required!==true)continue;
  if(item.status!=='verified')failures.push(`${name}: status=${item.status??'missing'}`);
  if(item.status==='verified'){
    if(name==='physical_device_latency_memory_and_offline_smoke'&&(!(Number(item.measured_p95_warm_inference_ms)>=0)||Number(item.measured_p95_warm_inference_ms)>Number(item.required_p95_warm_inference_ms_lte)))failures.push(`${name}: verified without <=${item.required_p95_warm_inference_ms_lte}ms measured p95`);
    if(typeof item.evidence_ref!=='string'||item.evidence_ref.trim().length<3)failures.push(`${name}: verified without evidence_ref`);
    if(typeof item.verified_at!=='string'||!/^20\d\d-\d\d-\d\dT/.test(item.verified_at))failures.push(`${name}: verified without ISO timestamp`);
  }
}
if(failures.length)throw new Error(`On-device AI release gate failed:\n- ${failures.join('\n- ')}\nTailmance source runtime exists, but production release remains fail-closed until real model provenance/quality/device evidence is supplied.`);
console.log(`edge-ai-release-check: ${items.length} production model/runtime evidence items verified`);
