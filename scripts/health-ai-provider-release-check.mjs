import {readFileSync} from 'node:fs';
const x=JSON.parse(readFileSync('release/health-ai-provider-evidence-v22.json','utf8'));
if(x.policy!=='fail_closed')throw new Error('Health AI provider evidence policy must be fail_closed');
const blocked=[];
for(const [name,item] of Object.entries(x.items??{})){
  if(item?.required!==true)continue;
  if(item.status!=='verified')blocked.push(`${name}: ${item.status??'missing'}`);
  else if(typeof item.evidence_ref!=='string'||item.evidence_ref.trim().length<3)blocked.push(`${name}: verified without evidence_ref`);
}
if(blocked.length)throw new Error(`Health AI production evidence gate failed:\n- ${blocked.join('\n- ')}\nSource implementation is present, but auto-verification must remain fail-closed until provider/registry/calibration/SLA/privacy evidence is real.`);
console.log(`health-ai-provider-release-check: ${Object.keys(x.items??{}).length} external provider evidence items verified`);
