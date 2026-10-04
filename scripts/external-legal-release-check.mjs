import {readFileSync} from 'node:fs';
const x=JSON.parse(readFileSync('release/external-legal-evidence.json','utf8'));
const failures=[];
for(const [name,item] of Object.entries(x.items??{})){
  if(item?.status==='not_applicable') continue;
  if(item?.status!=='verified') failures.push(`${name}: status=${item?.status??'missing'}`);
  else if(!Array.isArray(item.evidence_reference)||item.evidence_reference.length===0) failures.push(`${name}: verified without evidence_reference`);
}
if(failures.length) throw new Error(`External legal release gate failed (${failures.length}/${Object.keys(x.items??{}).length} unresolved):\n- ${failures.join('\n- ')}\nDo not change a status to verified until the named live store/production/identity/provider evidence actually exists.`);
console.log(`external-legal-release-check: ${Object.keys(x.items??{}).length} external legal evidence items verified`);
