import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CRITICAL_LEGAL_SUBDIMENSIONS, CRITICAL_LEGAL_SUBDIMENSION_TOPIC_MAPPING, deriveCriticalSubdimensionReview} from './lib/legal-source-state.mjs';
const source=JSON.parse(readFileSync('release/official-source-review-v19.json','utf8'));
const generated=JSON.parse(readFileSync('release/critical-legal-subdimension-review-v19.json','utf8'));
const expectedMarkets=['AE','AT','AU','BE','BR','CA','CN','DE','ES','FR','GB','ID','IE','IN','IT','JP','KR','NL','PL','RU','SA','SG','TH','TR','TW','US','VN'];
assert.deepEqual(source.required_critical_subdimensions,CRITICAL_LEGAL_SUBDIMENSIONS,'critical legal subdimensions must remain canonical');
assert.equal(Object.keys(CRITICAL_LEGAL_SUBDIMENSION_TOPIC_MAPPING).length,16,'sixteen critical cross-cutting legal subdimensions must stay explicit');
const canonical=deriveCriticalSubdimensionReview(source);
assert.deepEqual(generated,canonical,'critical legal subdimension artifact must be regenerated from official-source canonical state');
assert.equal(canonical.summary.markets_total,expectedMarkets.length);
assert.equal(canonical.summary.cells_total,expectedMarkets.length*CRITICAL_LEGAL_SUBDIMENSIONS.length);
assert.equal(canonical.summary.missing_source_cells,0,'no critical subdimension may lack mapped official-source evidence');
assert.equal(canonical.summary.source_evidence_complete,true,'critical source evidence must be complete');
assert.equal(canonical.summary.source_approval_governed_by,'release/configured-market-legal-language-source-approval-v20.json');
assert.equal(canonical.summary.production_release_approval_granted,false,'source approval must not fabricate production activation');
for(const code of expectedMarkets){
  assert.deepEqual(Object.keys(canonical.markets[code]),CRITICAL_LEGAL_SUBDIMENSIONS,`${code}: critical subdimension set drift`);
  for(const sub of CRITICAL_LEGAL_SUBDIMENSIONS){
    const cell=canonical.markets[code][sub];
    assert.ok(cell.source_evidence_present,`${code}/${sub}: source evidence required`);
    assert.ok(cell.evidence_reference.length>0,`${code}/${sub}: evidence refs required`);
    assert.equal(cell.status,'screened_from_canonical_topics_source_evidence_complete',`${code}/${sub}: source evidence status drift`);
  }
}
const eu=['AT','BE','DE','ES','FR','IE','IT','NL','PL'];
const kids='https://digital-strategy.ec.europa.eu/en/library/proposal-eu-kids-act-eu-keeping-internet-digital-spaces-accountable-and-trustworthy';
for(const code of eu){
  assert.ok(source.markets[code].official_sources.includes(kids),`${code}: EU KIDS Act proposal watch source missing`);
  assert.ok(source.markets[code].topics.age_age_assurance.evidence_reference.includes(kids),`${code}: KIDS Act proposal must be age-watch evidence`);
  assert.ok(source.markets[code].timing_notes.some(x=>/2026-09-17/.test(x)&&/legislative proposal/i.test(x)&&/not current law/i.test(x)),`${code}: KIDS Act proposal must never be presented as current law`);
}
const kr=source.markets.KR;
assert.ok(kr.timing_notes.some(x=>/2026-09-11/.test(x)&&/Article 32-3/.test(x)&&/superseded/i.test(x)),'KR: current PIPA Enforcement Decree version/effective-date drift must be pinned');
assert.ok(!kr.timing_notes.some(x=>/pinned to the version effective 2026-08-20/.test(x)),'KR: superseded 2026-08-20 current-version claim must be absent');
const sg=source.markets.SG;
const sgS397='https://sso.agc.gov.sg/SL/OSRAA2025-S397-2026';
assert.ok(sg.official_sources.includes(sgS397),'SG: current S 397/2026 canonical source route missing');
assert.ok(!JSON.stringify(sg).includes('/Uncommenced/'),'SG: current OSRAA evidence must not pin an obsolete /Uncommenced/ route');
console.log(`legal-critical-subdimensions: ${canonical.summary.cells_total}/${canonical.summary.cells_total} derived evidence cells + DSA/automated-decision operational subdimensions + EU proposal/current-law temporal separation + KR/SG current-version drift guards PASS`);
