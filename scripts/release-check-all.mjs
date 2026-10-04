import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const sourceApproval=JSON.parse(readFileSync('release/configured-market-legal-language-source-approval-v20.json','utf8'));
const configuredSourceTargets=Object.keys(sourceApproval.markets??{}).sort().join(',');

const gates=[
  ['dependency vulnerability audit','npm',['audit','--omit=dev','--audit-level=high']],
  ['client production config','npm',['run','release:client-check']],
  ['server production config','npm',['run','release:server-check']],
  ['consumable client/server mapping','npm',['run','release:consumable-config']],
  ['web production config','npm',['run','release:web-config']],
  ['universal/app link associations','npm',['run','release:app-links']],
  ['migration chain','npm',['run','release:migrations']],
  ['configured-country legal/language source','npm',['run','release:country'],{TAILMANCE_TARGET_COUNTRIES:(process.env.TAILMANCE_TARGET_COUNTRIES??'').trim()||configuredSourceTargets}],
  ['legal gap release','npm',['run','release:legal-gaps']],
  ['store compliance','npm',['run','release:store-compliance']],
  ['store review access','npm',['run','release:store-review-access']],
  ['critical journey / visual evidence','npm',['run','release:critical-journeys']],
  ['external security','npm',['run','release:external-security']],
  ['on-device AI model/runtime','npm',['run','release:edge-ai']],
  ['health AI provider/registry','npm',['run','release:health-ai-provider']],
  ['external legal','npm',['run','release:external-legal']],
  ['runtime i18n','npm',['run','release:i18n']],
  ['store metadata','npm',['run','release:store-metadata']],
  ['observability','npm',['run','release:observability']],
  ['store assets','npm',['run','release:store-assets']],
  ['release structure base','node',['scripts/release-structure-check.mjs']],
  ['release evidence','npm',['run','evidence:check']],
  ['release blocker inventory','npm',['run','test:release-blocker-inventory']],
];
const failed=[];
for(const [label,cmd,args,envPatch] of gates){
  const r=spawnSync(cmd,args,{encoding:'utf8',env:{...process.env,...(envPatch??{})}});
  const output=`${r.stdout??''}${r.stderr??''}`.trim();
  if(r.status===0){
    console.log(`\n[PASS] ${label}`);
    if(output)console.log(output);
  }else{
    failed.push(label);
    console.error(`\n[BLOCK] ${label}`);
    if(output)console.error(output);
  }
}
console.log(`\nrelease-check-all summary: ${gates.length-failed.length}/${gates.length} gates PASS; ${failed.length} BLOCK`);
if(failed.length){
  console.error(`Blocked gates: ${failed.join(', ')}`);
  console.error('Release remains NO-GO when production/store/provider/hosted evidence is missing. Configured-country source legal/language approval is evaluated separately from live operational evidence.');
  process.exitCode=1;
}else{
  console.log('All release gates PASS with current evidence.');
}
