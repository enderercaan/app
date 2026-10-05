import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync('release/external-legal-evidence.json','utf8'));
const items=Object.entries(data.items??{});
assert.equal(items.length,80,'external legal evidence inventory count drift');
const allowed=new Set([
  'repository_source_internal_qa',
  'store_console_or_distribution_external',
  'real_identity_registration_or_market_operator_external',
  'production_or_operational_external',
  'out_of_scope_unconfigured_country',
]);
let verified=0,ownerAttested=0,pending=0,outOfScope=0,sourceOnlyPending=0;
const classes={};
for(const [key,item] of items){
  assert.ok(allowed.has(item.evidence_boundary_class),`${key}: evidence_boundary_class missing/invalid/deprecated`);
  assert.equal(typeof item.repository_source_can_satisfy_alone,'boolean',`${key}: repository_source_can_satisfy_alone required`);
  assert.ok(String(item.required_evidence_boundary??'').trim(),`${key}: required_evidence_boundary required`);
  classes[item.evidence_boundary_class]=(classes[item.evidence_boundary_class]??0)+1;
  if(item.status==='verified'&&item.evidence_boundary_class!=='repository_source_internal_qa'){
    // Operator facts the repository cannot prove: accepted only as an explicit, dated owner attestation whose
    // private details stay outside the repository (owner approved this category on 2026-10-05).
    ownerAttested++;
    assert.equal(item.evidence_boundary_class,'real_identity_registration_or_market_operator_external',`${key}: only operator identity/registration facts may be owner-attested`);
    assert.ok((item.evidence_reference??[]).length>0&&item.evidence_reference.every(ref=>/^owner-attestation:20\d\d-\d\d-\d\d:/.test(ref)),`${key}: owner-attested item requires a dated owner-attestation reference`);
  } else if(item.status==='verified'){
    verified++;
    assert.equal(item.repository_source_can_satisfy_alone,true,`${key}: source/internal verified item must be explicitly source-satisfiable`);
    assert.ok((item.evidence_reference??[]).length>0,`${key}: verified item requires evidence references`);
    assert.equal(item.evidence_boundary_class,'repository_source_internal_qa',`${key}: only repository/internal QA may be source-verified here`);
  } else if(item.status==='not_applicable'){
    outOfScope++;
    assert.equal(item.evidence_boundary_class,'out_of_scope_unconfigured_country',`${key}: not_applicable must be the explicit out-of-scope class`);
    assert.ok((item.evidence_reference??[]).length>0,`${key}: out-of-scope item requires scope evidence`);
  } else {
    assert.equal(item.status,'not_verified',`${key}: unexpected evidence status`);
    pending++;
    if(item.repository_source_can_satisfy_alone) sourceOnlyPending++;
    assert.equal(item.repository_source_can_satisfy_alone,false,`${key}: pending external item must not be satisfiable by repository source alone`);
    assert.notEqual(item.evidence_boundary_class,'repository_source_internal_qa',`${key}: repository-source item may not remain hidden as external pending`);
  }
}
assert.equal(verified,20,'configured-27 source/internal verified evidence count drift');
assert.equal(ownerAttested,3,'owner-attested operator identity item count drift');
assert.equal(pending,56,'genuine production/store/operator external pending count drift');
assert.equal(outOfScope,1,'one worldwide-unconfigured item must remain explicitly out of scope');
assert.equal(sourceOnlyPending,0,'no source-remediable item may hide inside the pending external inventory');
console.log(`external-legal-evidence-boundary-checks: ${items.length}/80 classified; source/internal verified=${verified}, owner-attested=${ownerAttested}, genuine-external-pending=${pending}, out-of-scope=${outOfScope}, source-remediable-pending=${sourceOnlyPending}; classes=${JSON.stringify(classes)}`);
