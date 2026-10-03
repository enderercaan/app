import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {deriveCriticalSubdimensionReview} from './lib/legal-source-state.mjs';
const source=JSON.parse(readFileSync('release/official-source-review-v19.json','utf8'));
const generated=deriveCriticalSubdimensionReview(source);
const path='release/critical-legal-subdimension-review-v19.json';
const serialized=JSON.stringify(generated,null,2)+'\n';
if(process.argv.includes('--check')){
  const existing=readFileSync(path,'utf8');
  assert.equal(existing,serialized,'critical legal subdimension review drift: regenerate from canonical source review');
  assert.equal(generated.summary.missing_source_cells,0,'critical legal subdimension source screening has missing evidence cells');
  console.log(`critical-legal-subdimensions: ${generated.summary.cells_total}/${generated.summary.cells_total} source-screening cells derived; configured-market source approval is tracked by the v20 approval artifact; production evidence remains separate`);
}else{
  writeFileSync(path,serialized);
  console.log(`generated ${path}: ${generated.summary.cells_total} cells, missing=${generated.summary.missing_source_cells}`);
}
