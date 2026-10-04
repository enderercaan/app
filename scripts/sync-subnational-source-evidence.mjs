import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const CHECK=process.argv.includes('--check');
const sourcePath='release/official-source-review-v19.json';
const reviewPath='release/subnational-source-review-v19.json';
const registryPath='release/country-release-gates.json';
const clone=(x)=>JSON.parse(JSON.stringify(x));
const source=JSON.parse(readFileSync(sourcePath,'utf8'));
const registry=JSON.parse(readFileSync(registryPath,'utf8'));
const review=JSON.parse(readFileSync(reviewPath,'utf8'));
const expectedRegistry=clone(registry);
const topic='subnational_requirements';
const expected=clone(source);
let sourced=0;
for(const [code,item] of Object.entries(review.markets)){
  const market=expected.markets[code];
  assert.ok(market,`${code}: missing from official source review`);
  const cell=market.topics?.[topic];
  assert.ok(cell,`${code}: missing ${topic}`);
  const refs=[...new Set(item.official_sources??[])];
  assert.ok(refs.length>0,`${code}: subnational review must pin at least one official structural/local-law source`);
  sourced++;
  cell.status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
  cell.evidence_reference=refs;
  cell.evidence_classification='official_source_internal_legal_review_complete';
  cell.screening_note=`${item.screening_note} Source-level subnational review is internally approved for Tailmance's conservative product controls. An unknown exact runtime context fails closed for higher-risk locally variable features rather than inventing applicability.`;
  market.official_sources=[...new Set([...(market.official_sources??[]),...refs])];
  const registryMarket=expectedRegistry.markets?.[code];
  assert.ok(registryMarket,`${code}: missing from country release registry`);
  assert.ok(registryMarket.subnational_review,`${code}: missing subnational_review runtime registry object`);
  registryMarket.subnational_review.evidence_reference=refs;
  assert.equal(registryMarket.subnational_review.status,'PASS_INTERNAL_SUBNATIONAL_SOURCE_REVIEW',`${code}: subnational source review must be internally approved`);
}
assert.equal(Object.keys(review.markets).length,27,'subnational review must cover all 27 configured markets');
if(CHECK){
  assert.deepEqual(source,expected,'official source review subnational evidence drifted from subnational-source-review-v19.json; run npm run subnational-sources:sync');
  assert.deepEqual(registry,expectedRegistry,'country release registry subnational screening evidence drifted from subnational-source-review-v19.json; run npm run subnational-sources:sync');
  console.log(`subnational-source-evidence-sync: ${sourced}/27 markets synchronized across source matrix + country registry; no drift`);
}else{
  writeFileSync(sourcePath,JSON.stringify(expected,null,2)+'\n');
  writeFileSync(registryPath,JSON.stringify(expectedRegistry,null,2)+'\n');
  console.log(`subnational-source-evidence-sync: wrote ${sourced}/27 markets across source matrix + country registry`);
}
