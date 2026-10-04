import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const data=read('release/configured-market-subdivision-universe-v19.json');
const gates=read('release/country-release-gates.json');
const approval=read('release/configured-market-legal-language-source-approval-v20.json');
const codes=Object.keys(gates.markets??{}).sort();
assert.equal(data.schema_version,1);
assert.equal(data.as_of,'2026-10-01');
assert.deepEqual(Object.keys(data.markets??{}).sort(),codes,'subdivision universe market set drift');
assert.equal(data.summary?.configured_markets,27,'configured market count drift');
assert.equal(data.summary?.iso_subdivisions_enumerated,1278,'ISO subdivision snapshot count drift');
assert.equal(data.summary?.root_subdivisions_enumerated,733,'root subdivision snapshot count drift');
assert.equal(data.summary?.source_structure_review_complete_markets,27,'configured source structure review must be complete');
assert.equal(data.summary?.configured_scope_source_legal_approval_markets,27,'configured source legal approval count');
assert.equal(data.summary?.source_legal_blockers_from_structural_subdivision_inventory,0,'structural subdivision inventory must not masquerade as a source legal blocker');
assert.equal(approval.summary?.source_legal_approved_markets,27,'v20 source approval drift');
assert.equal(approval.summary?.source_legal_language_blockers,0,'v20 source blockers drift');
// These legacy completeness counters describe per-user runtime subdivision resolution, not source review completeness.
assert.equal(data.summary?.legal_applicability_complete_markets,0,'runtime per-subdivision context is intentionally not pre-resolved');
assert.equal(data.summary?.individual_subdivision_legal_mappings_complete,0,'runtime individual subdivision mappings are not globally pre-resolved');
assert.equal(data.summary?.individual_subdivision_legal_mappings_pending,1278,'runtime context-bound subdivision count drift');
assert.equal(data.summary?.root_subdivision_legal_mappings_pending,733,'root runtime context-bound count drift');
const all=[];
for(const code of codes){
  const market=data.markets[code];
  assert.ok(Array.isArray(market.subdivisions)&&market.subdivisions.length>0,`${code}: subdivision list missing`);
  assert.equal(market.subdivision_count,market.subdivisions.length,`${code}: count drift`);
  assert.equal(market.source_structure_review_status,'PASS_INTERNAL_OFFICIAL_SOURCE_STRUCTURE_REVIEW',`${code}: source subdivision structure review`);
  assert.equal(market.source_legal_blocker,false,`${code}: structural universe is not a source blocker`);
  assert.equal(market.legal_mapping_status,'SOURCE_STRUCTURE_REVIEWED_RUNTIME_CONTEXT_BOUND',`${code}: runtime-context policy`);
  const local=new Set();
  for(const row of market.subdivisions){
    assert.ok(row.code.startsWith(`${code}-`),`${code}: invalid subdivision code ${row.code}`);
    assert.ok(String(row.name??'').trim(),`${row.code}: name missing`);
    assert.ok(String(row.type??'').trim(),`${row.code}: type missing`);
    assert.ok(!local.has(row.code),`${row.code}: duplicate subdivision`);
    assert.equal(row.individual_legal_mapping_status,'RUNTIME_CONTEXT_BOUND_NOT_A_SOURCE_APPROVAL_BLOCK',`${row.code}: runtime subdivision status`);
    assert.equal(row.individual_legal_mapping_complete,false,`${row.code}: runtime mapping must not be fabricated as globally resolved`);
    assert.equal(row.release_effect,'FAIL_CLOSED_ONLY_IF_THIS_SUBDIVISION_HAS_A_MATERIAL_UNRESOLVED_RUNTIME_OVERLAY',`${row.code}: exact runtime overlay must remain fail-closed`);
    local.add(row.code); all.push(row.code);
  }
}
assert.equal(new Set(all).size,all.length,'cross-market subdivision code duplicate');
assert.equal(data.markets.US.subdivision_count,57,'US ISO subdivision count drift');
assert.equal(data.markets.CA.subdivision_count,13,'Canada subdivision count drift');
assert.equal(data.markets.AU.subdivision_count,8,'Australia subdivision count drift');
assert.equal(data.markets.AE.subdivision_count,7,'UAE emirate count drift');
assert.equal(data.markets.DE.subdivision_count,16,'Germany Land count drift');
assert.equal(data.markets.BR.subdivision_count,27,'Brazil state/federal district count drift');
console.log(`configured-market-subdivision-universe: ${codes.length}/27 source structures reviewed; ${all.length} ISO subdivision identifiers (${data.summary.root_subdivisions_enumerated} roots) runtime-context-bound; source blockers=0; exact material overlays remain fail-closed at runtime`);
