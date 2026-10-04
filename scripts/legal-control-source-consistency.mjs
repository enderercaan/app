import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CANONICAL_CONTROL_TOPIC_MAPPING, canonicalControlEvidenceForMarket} from './lib/legal-source-state.mjs';

const registry=JSON.parse(readFileSync('release/country-release-gates.json','utf8'));
const sourceReview=JSON.parse(readFileSync('release/official-source-review-v19.json','utf8'));

const mapping=CANONICAL_CONTROL_TOPIC_MAPPING;

const registryCountries=Object.keys(registry.markets??{}).sort();
const sourceCountries=Object.keys(sourceReview.markets??{}).sort();
assert.deepEqual(sourceCountries,registryCountries,'country registry and official-source matrix country sets must match exactly');
assert.deepEqual(Object.keys(mapping),registry.default_policy?.required_controls,'control→source-topic mapping must match canonical release controls exactly');

const globalOfficial=new Set(Object.values(sourceReview.global_official_sources??{}).flatMap(value=>Array.isArray(value)?value:[]));
for(const url of globalOfficial){
  const parsed=new URL(url);
  assert.equal(parsed.protocol,'https:',`global official source must use HTTPS: ${url}`);
}

const requiredTopics=new Set(sourceReview.required_topic_families??[]);
for(const topics of Object.values(mapping)) for(const topic of topics) assert.ok(requiredTopics.has(topic),`mapped topic missing from official-source matrix: ${topic}`);

let checked=0;
for(const country of registryCountries){
  const market=registry.markets[country];
  const sourceMarket=sourceReview.markets[country];
  const marketOfficial=new Set(sourceMarket.official_sources??[]);
  assert.equal(marketOfficial.size,(sourceMarket.official_sources??[]).length,`${country}: duplicate official-source index entries`);
  for(const url of marketOfficial){const parsed=new URL(url);assert.equal(parsed.protocol,'https:',`${country}: official source must use HTTPS: ${url}`);}
  for(const [control,topics] of Object.entries(mapping)){
    const compliance=market.compliance?.[control];
    assert.ok(compliance,`${country}/${control}: missing country compliance control`);
    const complianceRefs=new Set(Array.isArray(compliance.evidence_reference)?compliance.evidence_reference:[]);
    for(const topic of topics) assert.ok(sourceMarket.topics?.[topic],`${country}/${control}: mapped source topic ${topic} missing`);
    for(const topic of topics){
      for(const url of sourceMarket.topics?.[topic]?.evidence_reference??[]){
        const parsed=new URL(url); assert.equal(parsed.protocol,'https:',`${country}/${topic}: evidence URL must use HTTPS`);
        assert.ok(marketOfficial.has(url)||globalOfficial.has(url),`${country}/${topic}: evidence URL missing from canonical market/global official-source index: ${url}`);
      }
    }
    const canonicalRefs=canonicalControlEvidenceForMarket(sourceMarket)[control];
    assert.deepEqual([...complianceRefs].sort(),[...canonicalRefs].sort(),`${country}/${control}: registry evidence must exactly mirror canonical source-topic evidence`);
    checked++;
  }

  const subnational=sourceMarket.topics?.subnational_requirements;
  assert.ok(subnational,`${country}: missing subnational source topic`);
  if(market.subnational_review_required){
    assert.equal(market.subnational_review?.status,'PASS_INTERNAL_SUBNATIONAL_SOURCE_REVIEW',`${country}: subnational source review must be internally approved`);
    assert.equal(subnational.release_effect,'SOURCE_LEGAL_REVIEW_COMPLETE__LIVE_OPERATIONAL_EVIDENCE_SEPARATE',`${country}: subnational source review release effect drift`);
  }

  const timing=sourceMarket.topics?.applicability_effective_dates;
  assert.ok(timing,`${country}: missing applicability/effective-date source topic`);
  assert.ok(Array.isArray(timing.evidence_reference)&&timing.evidence_reference.length>0,`${country}: effective-date screening requires at least one official evidence reference`);
  assert.equal(market.applicability_effective_date_review?.future_or_not_yet_effective_rules_are_not_current_obligations,true,`${country}: future laws must not be treated as current obligations`);

  const store=sourceMarket.topics?.store_platform_obligations;
  assert.ok(store,`${country}: missing store-platform source topic`);
  assert.ok(Array.isArray(store.evidence_reference)&&store.evidence_reference.length>0,`${country}: store-platform screening requires official Apple/Google evidence`);
}

console.log(`legal-control-source-consistency: ${checked} country×control mappings with exact canonical source-topic evidence PASS`);
