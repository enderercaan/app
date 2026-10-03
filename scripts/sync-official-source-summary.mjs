import {readFileSync,writeFileSync} from 'node:fs';
import {deriveSourceGapSummary} from './lib/legal-source-state.mjs';

const path='release/official-source-review-v19.json';
const check=process.argv.includes('--check');
const data=JSON.parse(readFileSync(path,'utf8'));
const summary=deriveSourceGapSummary(data);
const before=JSON.stringify(data.source_gap_summary??null);
data.source_gap_summary=summary;
const out=JSON.stringify(data,null,2)+'\n';
if(check){
  if(before!==JSON.stringify(summary)){
    console.error('official-source-review source_gap_summary drift');
    process.exit(1);
  }
  console.log(`official-source-summary: ${summary.topic_cells_total} topic cells; ${summary.empty_evidence_cells_total} empty-evidence source-review cells; ${summary.remaining_topic_source_presence_gaps} canonical topic source-presence gaps; no drift`);
}else{
  writeFileSync(path,out);
  console.log(`official-source-summary: synchronized ${summary.topic_cells_total} topic cells; ${summary.empty_evidence_cells_total} empty-evidence source-review cells; ${summary.remaining_topic_source_presence_gaps} canonical topic source-presence gaps`);
}
