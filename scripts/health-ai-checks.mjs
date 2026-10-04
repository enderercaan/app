import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/182_health_ai_ocr_registry_guardrail_pipeline.sql','utf8');
const worker=readFileSync('supabase/functions/health-ai-worker/index.ts','utf8');
const lifecycle=readFileSync('supabase/migrations/184_health_ai_privacy_export_and_erasure_binding.sql','utf8');
const sla=readFileSync('supabase/migrations/187_health_ai_manual_review_sla_and_ops_visibility.sql','utf8');
const stale=readFileSync('supabase/migrations/188_health_ai_stale_claim_recovery.sql','utf8');
const typeGuard=readFileSync('supabase/migrations/191_health_ai_document_type_canonicalization.sql','utf8');
const exportDownload=readFileSync('supabase/functions/export-download/index.ts','utf8');
const providerEvidence=JSON.parse(readFileSync('release/health-ai-provider-evidence-v22.json','utf8'));
const cfg=readFileSync('supabase/config.toml','utf8');
for(const table of ['health_ai_jobs','ai_inference_logs'])assert.match(sql,new RegExp(`create table if not exists public\\.${table}`,'i'),`${table} missing`);
assert.match(sql,/p_document_confidence<0\.65 or p_credential_integrity='invalid'/,'low-confidence or invalid credentials must reject');
assert.match(sql,/p_document_confidence<=0\.85 or p_credential_integrity<>'valid'/,'ambiguous/non-registry result must route to manual review');
assert.match(sql,/service_apply_health_verification_attestation/,'auto verification must reuse the provenance-bound health attestation authority');

assert.match(sql,/v_verified_at:=null;[\s\S]*v_expires_at:=null;/,'each signal validation must reset temporal state instead of inheriting the prior signal');
assert.match(sql,/health_ai_signal_schema_invalid/,'database boundary must reject unknown provider signal fields');
assert.match(sql,/health_ai_signal_duplicate/,'database boundary must reject duplicate health signals');
assert.match(sql,/revoke all on table public\.ai_inference_logs from public,anon,authenticated/i,'AI inference logs must be private');
assert.doesNotMatch(sql,/ocr_text|microchip_number|provider_reference\s+text/i,'AI ledger must not persist raw OCR, raw microchip or raw provider references');
for(const marker of ['require_registry_or_credential_verification:true','auto_verify_confidence_gt:0.85','manual_review_confidence_min:0.65','reject_confidence_lt:0.65','never_infer_missing_fields:true',"auto_verify_only_when_complete:['microchip','vaccinations','internal_parasite_treatment','external_parasite_treatment']",'incomplete_or_inconsistent_to_manual_review:true','breed_inference:false'])assert.ok(worker.includes(marker),`health AI worker policy missing ${marker}`);
assert.match(worker,/parseProviderResult/,'provider output must be schema-validated');
assert.match(worker,/typeof value!==['"]string['"][\s\S]*\^\\d\{4\}-\\d\{2\}-\\d\{2\}T/,'provider timestamps must be strict ISO strings rather than coercible JSON values');
assert.match(worker,/sha256Hex\(parsed\.provider_reference\)/,'provider references must be hashed before persistence');
assert.match(worker,/verifyBearerSecret\(req\.headers\.get\('Authorization'\),workerSecret,32\)/,'worker endpoint requires strong bearer authentication');
assert.match(sql,/power\(2,least\(v_attempts-1,6\)\)::integer/,'retry backoff must use explicit bounded exponential power');
assert.match(lifecycle,/before delete on public\.health_documents[\s\S]*trg_erase_health_ai_inference_logs/,'health document erasure must delete linked AI inference metadata');
assert.match(exportDownload,/ai_inference_logs[\s\S]*health_ai_processing_history/,'account export must include bounded AI decision metadata for owned health documents');
assert.doesNotMatch(exportDownload,/provider_reference_sha256/,'self-service export must not expose provider anti-replay/reference hashes');
assert.match(cfg,/\[functions\.health-ai-worker\][\s\S]*verify_jwt = false/,'worker function config must explicitly declare alternate auth');
assert.equal(providerEvidence.policy,'fail_closed','production health-AI evidence must be fail closed');


assert.match(stale,/status='processing'[\s\S]*claimed_at<now\(\)-interval '10 minutes'/,'health AI stale processing leases must recover');
assert.match(stale,/attempts=least\(j\.attempts\+1,20\)/,'stale health AI claims must consume a bounded attempt');
assert.match(stale,/health_ai_stale_claim_manual_review/,'exhausted stale claims must fail safe to manual review');
assert.match(stale,/manual_review_required=true/,'stale-claim exhaustion must surface in protected moderation review');

assert.match(sla,/manual_review_due_at/,'health AI manual-review SLA deadline missing');
assert.match(sla,/interval '23 hours'/,'health AI manual-review source deadline must remain under 24h');
assert.match(sla,/health_ai_jobs_manual_review_due_check/,'health AI manual-review deadline invariant missing');
assert.match(sla,/service_health_ai_manual_review_queue/,'service-only health AI manual-review queue missing');
assert.match(sla,/manualReviewOverdue/,'health AI overdue operations telemetry missing');
assert.match(sla,/worker='health-ai-worker'/,'health AI worker heartbeat visibility missing');
assert.match(sla,/revoke all on function public\.service_health_ai_manual_review_queue\(integer\) from public,anon,authenticated/,'health AI review queue must not be client callable');

for(const key of ['production_provider_contract_and_allowlist','veterinary_registry_credential_coverage','confidence_calibration_and_false_decision_evaluation','manual_review_staffing_under_24h','production_privacy_and_deletion_exercise'])assert.equal(providerEvidence.items?.[key]?.required,true,`health AI external evidence missing ${key}`);

const passport=readFileSync('supabase/migrations/186_health_passport_public_sha256_fingerprint.sql','utf8');
assert.match(passport,/health_attestation_public_signature_sha256/);
assert.match(passport,/extensions\.digest[\s\S]*'sha256'/);
assert.match(passport,/passportSignatureSha256/);
assert.match(passport,/attestationId[\s\S]*petId[\s\S]*providerReferenceSha256/);
const trustPill=readFileSync('src/components/HealthTrustPill.tsx','utf8');
assert.match(trustPill,/passportSignatureSha256/);
assert.match(trustPill,/selectable/);

assert.match(typeGuard,/v_type<>'health_record'[\s\S]*unsupported_health_document_type/,'new health-document writes must accept only the canonical health_record class');
assert.match(typeGuard,/service_route_health_ai_manual_review[\s\S]*status='manual_review'/,'unsupported legacy document classes must have a direct fail-safe manual-review route');
assert.match(worker,/doc\.document_type!==['"]health_record['"][\s\S]*service_route_health_ai_manual_review[\s\S]*health_ai_unsupported_document_type/,'health AI worker must never send an unsupported legacy document class to the provider');
console.log('health-ai-checks: registry-backed strict-schema OCR/AI confidence bands, private inference ledger and retry queue PASS');
