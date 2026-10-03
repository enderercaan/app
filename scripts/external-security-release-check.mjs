import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const record=JSON.parse(readFileSync('release/external-security-evidence.json','utf8'));
assert.equal(record.policy,'fail_closed','External security evidence policy must be fail_closed');
const items=Object.entries(record.items??{});
assert.ok(items.length>=8,'External security evidence matrix is incomplete');
const failures=[];
for(const [name,item] of items){
  if(item?.required!==true)continue;
  if(item.status!=='verified')failures.push(`${name}: status=${item.status??'missing'}`);
  if(item.status==='verified'){
    if(typeof item.evidence_ref!=='string'||item.evidence_ref.trim().length<3)failures.push(`${name}: verified without evidence_ref`);
    if(typeof item.verified_at!=='string'||!/^20\d\d-\d\d-\d\dT/.test(item.verified_at))failures.push(`${name}: verified without ISO timestamp`);
  }
}
if(failures.length){
  throw new Error(`External security release gate failed:\n- ${failures.join('\n- ')}\nDo not change a status to verified until the named production/staging evidence actually exists.`);
}
console.log(`external-security-release-check: ${items.length} required external controls verified with evidence`);
