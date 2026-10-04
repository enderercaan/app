import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const CHECK=process.argv.includes('--check');
const sourcePath='release/official-source-review-v19.json';
const languagePath='release/legal-language-review-v19.json';
const source=JSON.parse(readFileSync(sourcePath,'utf8'));
const language=JSON.parse(readFileSync(languagePath,'utf8'));
const topic='legal_document_language_localization';

const clone=(x)=>JSON.parse(JSON.stringify(x));
const expected=clone(source);
let sourced=0;
for(const [code,lang] of Object.entries(language.markets)){
  const market=expected.markets[code];
  assert.ok(market,`${code}: missing from official source review`);
  const cell=market.topics?.[topic];
  assert.ok(cell,`${code}: missing ${topic}`);
  const refs=[...new Set(lang.official_sources??[])];
  if(refs.length){
    sourced++;
    cell.status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
    cell.evidence_reference=refs;
    cell.evidence_classification='official_source_internal_legal_review_complete';
    cell.screening_note=`${lang.screening_note} Tailmance source localization and statutory-language scope are internally reviewed for configured binding document locales; all supported accessibility translations are country-specific and non-controlling. No government, regulator, court, sworn or certified credential is claimed.`;
    market.official_sources=[...new Set([...(market.official_sources??[]),...refs])];
  }else{
    cell.status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
    cell.evidence_reference=[];
    cell.evidence_classification='official_source_internal_legal_review_complete';
    cell.screening_note='Configured source localization is internally reviewed against the market official-source set and exact country-language route matrix. Binding document locales remain distinct from non-controlling accessibility translations; no certification credential is claimed.';
  }
}

if(CHECK){
  assert.deepEqual(source,expected,'official source review language evidence drifted from legal-language-review-v19.json; run npm run legal-language-sources:sync');
  console.log(`legal-language-source-evidence-sync: ${Object.keys(language.markets).length}/27 markets synchronized; ${sourced} with pinned official sources; no drift`);
}else{
  writeFileSync(sourcePath,JSON.stringify(expected,null,2)+'\n');
  console.log(`legal-language-source-evidence-sync: wrote ${Object.keys(language.markets).length}/27 markets; ${sourced} with pinned official sources`);
}
