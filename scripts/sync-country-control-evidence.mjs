import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {CANONICAL_CONTROL_FAMILIES, canonicalControlEvidenceForMarket} from './lib/legal-source-state.mjs';

const checkOnly=process.argv.includes('--check');
const registryPath='release/country-release-gates.json';
const sourcePath='release/official-source-review-v19.json';
const registry=JSON.parse(readFileSync(registryPath,'utf8'));
const sourceReview=JSON.parse(readFileSync(sourcePath,'utf8'));

assert.deepEqual(registry.default_policy?.required_controls,CANONICAL_CONTROL_FAMILIES,'registry required_controls must equal canonical control families');
assert.deepEqual(Object.keys(registry.markets??{}).sort(),Object.keys(sourceReview.markets??{}).sort(),'registry/source country sets must match');

const next=structuredClone(registry);
let cells=0;
for(const country of Object.keys(next.markets).sort()){
  const sourceMarket=sourceReview.markets[country];
  const evidenceByControl=canonicalControlEvidenceForMarket(sourceMarket);
  for(const control of CANONICAL_CONTROL_FAMILIES){
    const compliance=next.markets[country]?.compliance?.[control];
    assert.ok(compliance,`${country}/${control}: missing registry compliance cell`);
    compliance.evidence_reference=evidenceByControl[control];
    cells++;
  }
}

if(checkOnly){
  assert.deepEqual(registry,next,'country registry control evidence drifted from canonical source-topic matrix; run npm run legal-controls:sync');
  console.log(`country-control-evidence-sync: ${cells} country×control cells exactly synchronized PASS`);
}else{
  writeFileSync(registryPath,JSON.stringify(next,null,2)+'\n');
  console.log(`country-control-evidence-sync: synchronized ${cells} country×control cells from canonical source-topic matrix`);
}
