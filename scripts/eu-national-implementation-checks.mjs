import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const d=JSON.parse(readFileSync('release/eu-national-implementation-review-v19.json','utf8'));
const registry=JSON.parse(readFileSync('release/country-release-gates.json','utf8'));
const source=JSON.parse(readFileSync('release/official-source-review-v19.json','utf8'));
const approval=JSON.parse(readFileSync('release/configured-market-legal-language-source-approval-v20.json','utf8'));
const expected=['AT','BE','DE','ES','FR','IE','IT','NL','PL'];
const families=['consumer_and_digital_contracts','electronic_marketing_eprivacy','digital_accessibility_eaa'];
assert.equal(d.schema_version,2); assert.equal(d.as_of,'2026-10-01');
assert.equal(d.source_approval_model?.external_counsel_required_for_source_approval,false);
assert.deepEqual(Object.keys(d.markets).sort(),expected);
assert.equal(d.policy.eu_level_source_presence_is_not_national_implementation_clearance,true);
assert.equal(d.policy.national_transposition_must_be_mapped_before_country_approval,true);
assert.equal(d.policy.internal_official_source_review_is_source_legal_clearance,true);
assert.equal(d.transposition_sensitive_instruments.length,5);
const celex=['32011L0083','32019L0770','32005L0029','32002L0058','32019L0882'];
for(const id of celex) assert.ok(d.transposition_sensitive_instruments.some(x=>x.official_national_transposition_index===`https://eur-lex.europa.eu/legal-content/EN/NIM/?uri=CELEX:${id}`),`missing EUR-Lex NIM ${id}`);
for(const code of expected){
  const m=d.markets[code];
  assert.equal(m.national_source_screening_complete,true,`${code}: national source screening incomplete`);
  assert.equal(m.matrix_complete,true,`${code}: internal source matrix must be complete`);
  assert.equal(m.review_status,'PASS_INTERNAL_NATIONAL_IMPLEMENTATION_SOURCE_REVIEW',`${code}: source review`);
  assert.equal(m.release_status,'PASS_SOURCE_REVIEW',`${code}: source release review`);
  assert.equal(m.national_official_source_screening?.legal_conclusion,true,`${code}: national source legal conclusion`);
  for(const family of families){
    const refs=m.national_sources_by_family?.[family]; assert.ok(Array.isArray(refs)&&refs.length>0,`${code}/${family}: missing national source`);
    for(const url of refs){assert.match(url,/^https:\/\//); assert.doesNotMatch(new URL(url).hostname,/europa\.eu$/i); assert.ok(source.markets[code].official_sources.includes(url));}
  }
  assert.equal(approval.markets?.[code]?.legal_source_status,'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW');
  assert.equal(approval.markets?.[code]?.language_source_status,'PASS_INTERNAL_LEGAL_LANGUAGE_QA');
  assert.equal(registry.markets[code]?.legal_review_status,'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW');
}
console.log(`eu-national-implementation-checks: ${expected.length}/${expected.length} configured EU markets PASS internal national official-source review; 5 directive families pinned to official EUR-Lex NIM indexes; live production facts remain separate`);
