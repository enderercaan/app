import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/182_health_ai_ocr_registry_guardrail_pipeline.sql','utf8');
const worker=readFileSync('supabase/functions/health-ai-worker/index.ts','utf8');
const rules=readFileSync('supabase/functions/_shared/healthBookletCheck.ts','utf8');
const m201=readFileSync('supabase/migrations/205_health_document_check_without_veterinarian_signals.sql','utf8');
const lifecycle=readFileSync('supabase/migrations/184_health_ai_privacy_export_and_erasure_binding.sql','utf8');
const sla=readFileSync('supabase/migrations/187_health_ai_manual_review_sla_and_ops_visibility.sql','utf8');
const stale=readFileSync('supabase/migrations/188_health_ai_stale_claim_recovery.sql','utf8');
const typeGuard=readFileSync('supabase/migrations/191_health_ai_document_type_canonicalization.sql','utf8');
const exportDownload=readFileSync('supabase/functions/export-download/index.ts','utf8');
const providerEvidence=JSON.parse(readFileSync('release/health-ai-provider-evidence-v22.json','utf8'));
const cfg=readFileSync('supabase/config.toml','utf8');
for(const table of ['health_ai_jobs','ai_inference_logs'])assert.match(sql,new RegExp(`create table if not exists public\\.${table}`,'i'),`${table} missing`);
assert.match(m201,/service_apply_health_verification_attestation\(\s*p_health_document_id,\s*v_signal->>'signal',\s*'ai_document_check'/,'auto approval must reuse the evidence-bound attestation authority');

assert.match(sql,/v_verified_at:=null;[\s\S]*v_expires_at:=null;/,'each signal validation must reset temporal state instead of inheriting the prior signal');
assert.match(sql,/health_ai_signal_schema_invalid/,'database boundary must reject unknown provider signal fields');
assert.match(sql,/health_ai_signal_duplicate/,'database boundary must reject duplicate health signals');
assert.match(sql,/revoke all on table public\.ai_inference_logs from public,anon,authenticated/i,'AI inference logs must be private');
assert.doesNotMatch(sql,/ocr_text|microchip_number|provider_reference\s+text/i,'AI ledger must not persist raw OCR, raw microchip or raw provider references');
for(const marker of ['DOCUMENT_TEXT_DETECTION','X-Goog-Api-Key','service_consume_health_ai_units','FREE_TIER_MONTHLY_UNITS = 900','evaluateBooklet','p_outcome: result.outcome','p_reason_code: result.reasonCode','health_ai_free_quota_exhausted'])assert.ok(worker.includes(marker),`health AI worker missing ${marker}`);
const code=src=>src.replace(/\/\/.*$/gm,'');
assert.doesNotMatch(code(worker),/veterinar|clinic|credential_integrity|registry/i,'the health-record check must not involve a veterinarian, clinic or registry');
assert.doesNotMatch(code(rules),/clinic|registry|credential|veterinar/i,'the booklet rules must not involve a clinic or registry');
for(const marker of ['rabies','dogCore','catCore','internal','external','ocr_confidence_too_low','dates_ambiguous','primary_series_in_progress','species_not_covered','SCHEDULE_VERSION'])assert.ok(rules.includes(marker),`booklet rules missing ${marker}`);
assert.match(worker,/sha256Hex\(`\$\{providerCode\}\|\$\{SCHEDULE_VERSION\}/,'the stored provider reference must be a hash, never raw provider output');
assert.match(worker,/verifyBearerSecret\(req\.headers\.get\('Authorization'\),\s*workerSecret,\s*32\)/,'worker endpoint requires strong bearer authentication');
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

for(const key of ['production_provider_contract_and_allowlist','schedule_rules_review_and_ocr_language_coverage','confidence_calibration_and_false_decision_evaluation','manual_review_staffing_under_24h','production_privacy_and_deletion_exercise'])assert.equal(providerEvidence.items?.[key]?.required,true,`health AI external evidence missing ${key}`);


assert.match(typeGuard,/v_type<>'health_record'[\s\S]*unsupported_health_document_type/,'new health-document writes must accept only the canonical health_record class');
assert.match(typeGuard,/service_route_health_ai_manual_review[\s\S]*status='manual_review'/,'unsupported legacy document classes must have a direct fail-safe manual-review route');
assert.match(worker,/service_route_health_ai_manual_review/,'unsupported classes route to manual review');
assert.match(worker,/doc\.document_type\s*!==\s*['"]health_record['"][\s\S]*health_ai_unsupported_document_type[\s\S]*continue;[\s\S]*DOCUMENT_TEXT_DETECTION/,'health AI worker must never send an unsupported legacy document class to the provider');
assert.match(m201,/alter table public\.pet_health_summary drop column veterinarian_verified/,'the veterinarian flag must be dropped');
assert.match(m201,/drop function if exists public\.has_current_veterinarian_verification/,'the veterinarian currency function must be dropped');
assert.match(m201,/drop function if exists public\.health_trust_json/,'the clinic trust payload must be dropped');
assert.match(m201,/alter table public\.health_verification_attestations drop column if exists clinic_public_id/,'clinic column must be dropped');
assert.match(m201,/check \(signal in \('microchip_verified','genetic_screening_available','pedigree_available','vaccination_complete','neutered'\)\)/,'veterinarian signal must be removed from the allowed signals');
assert.match(m201,/ai_document_check/,'AI attestations use the document-check method');
assert.match(m201,/'ai_document_check_signal_not_allowed'/,'the AI may only set the vaccination signal');
assert.match(m201,/health_ai_monthly_units_exhausted/,'provider free-tier units must be capped');
assert.match(m201,/interval '3 minutes'/,'a booklet must be checked once, after the last page');
console.log('health-ai-checks: Cloud Vision document check, booklet rules, no veterinarian/clinic/registry concept, private inference ledger, free-tier guard and retry queue PASS');
