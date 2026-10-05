import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Runs the real health-ai-worker source against a fake Supabase client and a fake Cloud Vision endpoint.
const dir = mkdtempSync(join(tmpdir(), 'health-ai-sim-'));
const js = (file) => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
writeFileSync(join(dir, 'healthBookletCheck.mjs'), js('supabase/functions/_shared/healthBookletCheck.ts'));
writeFileSync(join(dir, 'cors.mjs'), "export const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});");
writeFileSync(join(dir, 'client.mjs'), 'export const adminClient=()=>globalThis.__fake;');
writeFileSync(join(dir, 'http.mjs'), 'export const fetchWithTimeout=(url,init)=>fetch(url,init);export const readResponseJsonBounded=async(r)=>r.json();');
writeFileSync(join(dir, 'secretAuth.mjs'), "export const verifyBearerSecret=(h,s,min)=>Boolean(s)&&s.length>=min&&h===`Bearer ${s}`;");
writeFileSync(join(dir, 'outboundUrl.mjs'), "export const requireAllowlistedHttpsUrl=(raw,allow,o)=>{const u=new URL(raw);if(u.protocol!=='https:'||!JSON.parse(allow).includes(u.hostname))throw new Error(o.errorCode);return u};");
writeFileSync(join(dir, 'workerHeartbeat.mjs'), 'export const markWorkerHeartbeat=async()=>{};');
let worker = js('supabase/functions/health-ai-worker/index.ts');
for (const [from, to] of [['../_shared/cors.ts', './cors.mjs'], ['../_shared/client.ts', './client.mjs'], ['../_shared/http.ts', './http.mjs'], ['../_shared/secretAuth.ts', './secretAuth.mjs'], ['../_shared/outboundUrl.ts', './outboundUrl.mjs'], ['../_shared/workerHeartbeat.ts', './workerHeartbeat.mjs'], ['../_shared/healthBookletCheck.ts', './healthBookletCheck.mjs']]) worker = worker.replaceAll(from, to);
writeFileSync(join(dir, 'worker.mjs'), worker);

const SECRET = 'w'.repeat(40);
const env = { HEALTH_AI_WORKER_SECRET: SECRET, HEALTH_AI_API_URL: 'https://eu-vision.googleapis.com/v1/images:annotate', HEALTH_AI_API_KEY: 'k'.repeat(30), HEALTH_AI_PROVIDER_CODE: 'google_cloud_vision', HEALTH_AI_ALLOWED_HOSTS_JSON: '["eu-vision.googleapis.com"]' };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn; } };
await import(pathToFileURL(join(dir, 'worker.mjs')).href);

const FULL = ['Vaccination record', 'Rabies Nobivac 14.03.2026 14.03.2027', 'DHPPi Eurican 20.03.2026 20.03.2027', 'Deworming Drontal 02.09.2026', 'Flea tick Bravecto 15.09.2026'];
function visionPage(rows, conf = 0.95) {
  const words = [];
  rows.forEach((row, r) => row.split(' ').forEach((text, c) => words.push({ confidence: conf, boundingBox: { vertices: [{ x: 10 + c * 80, y: 90 + r * 100 }, { x: 80 + c * 80, y: 90 + r * 100 }, { x: 80 + c * 80, y: 110 + r * 100 }, { x: 10 + c * 80, y: 110 + r * 100 }] }, symbols: [...text].map((t) => ({ text: t })) })));
  return { fullTextAnnotation: { pages: [{ blocks: [{ paragraphs: [{ words }] }] }] } };
}
function makeFake({ docs, pet, pages, unitsError, blobSize = 1000 }) {
  const calls = [];
  const chain = (table) => {
    const state = { table, filters: {} };
    const api = {
      select: () => api, eq: (k, v) => { state.filters[k] = v; return api; }, in: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => ({ data: table === 'pets' ? pet : docs.find((d) => d.id === state.filters.id) ?? null }),
      then: (resolve) => resolve({ data: table === 'health_documents' ? (state.filters.document_type ? pages : docs) : null, error: null }),
    };
    return api;
  };
  const fake = {
    calls,
    from: chain,
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array(blobSize)]), error: null }) }) },
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'claim_health_ai_jobs') return { data: docs.map((d) => ({ health_document_id: d.id, attempts: 0 })), error: null };
      if (name === 'service_consume_health_ai_units') return unitsError && args.p_units > 0 ? { error: { message: 'health_ai_monthly_units_exhausted' } } : { data: 1, error: null };
      if (name === 'service_apply_health_ai_result') return { data: { decision: args.p_outcome === 'approved' ? 'auto_verified' : args.p_outcome }, error: null };
      return { data: null, error: null };
    },
  };
  return fake;
}
const post = () => handler(new Request('https://x/', { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` } }));
const docsTwo = [{ id: 'doc-1', pet_id: 'pet-1', document_type: 'health_record' }, { id: 'doc-2', pet_id: 'pet-1', document_type: 'health_record' }];
const pages = [{ id: 'doc-1', storage_path: 'a/1.jpg' }, { id: 'doc-2', storage_path: 'a/2.jpg' }];
const pet = { species: 'dog', birth_date: '2022-01-10' };
let visionRequests = [];
function mockFetch(handlerFn) { globalThis.fetch = async (url, init) => { visionRequests.push({ url: String(url), init }); return handlerFn(JSON.parse(init.body)); }; }
let passed = 0;

// 1. complete booklet: one provider call per 4 pages, the result is applied to each claimed page.
globalThis.__fake = makeFake({ docs: docsTwo, pet, pages });
visionRequests = [];
mockFetch((body) => new Response(JSON.stringify({ responses: body.requests.map(() => visionPage(FULL)) }), { status: 200 }));
let res = await (await post()).json();
assert.equal(visionRequests.length, 1, 'two pages are sent in one request');
assert.equal(visionRequests[0].url, env.HEALTH_AI_API_URL);
assert.equal(visionRequests[0].init.headers['X-Goog-Api-Key'], env.HEALTH_AI_API_KEY);
assert.deepEqual(JSON.parse(visionRequests[0].init.body).requests[0].features, [{ type: 'DOCUMENT_TEXT_DETECTION' }]);
assert.equal(res.processed, 2);
const applied = globalThis.__fake.calls.filter(([n]) => n === 'service_apply_health_ai_result');
assert.equal(applied.length, 2);
assert.equal(applied[0][1].p_outcome, 'approved');
assert.equal(applied[0][1].p_reason_code, 'all_required_entries_current');
assert.equal(applied[0][1].p_signals[0].signal, 'vaccination_complete');
assert.ok(Date.parse(applied[0][1].p_signals[0].expiresAt) > Date.now());
assert.match(applied[0][1].p_provider_reference_sha256, /^[0-9a-f]{64}$/);
assert.ok(!JSON.stringify(globalThis.__fake.calls).includes('Rabies'), 'no OCR text is passed to the database');
const unitCalls = globalThis.__fake.calls.filter(([n]) => n === 'service_consume_health_ai_units');
assert.deepEqual(unitCalls[0][1], { p_units: 2, p_monthly_cap: 900 });
passed++;

// 2. free-tier quota exhausted: nothing is sent to the provider and both pages go to a person.
globalThis.__fake = makeFake({ docs: docsTwo, pet, pages, unitsError: true });
visionRequests = [];
res = await (await post()).json();
assert.equal(visionRequests.length, 0);
assert.equal(res.manual, 2);
assert.ok(globalThis.__fake.calls.some(([n, a]) => n === 'service_route_health_ai_manual_review' && a.p_error_code === 'health_ai_free_quota_exhausted'));
passed++;

// 3. provider outage: units are returned and the jobs are retried later.
globalThis.__fake = makeFake({ docs: docsTwo, pet, pages });
mockFetch(() => new Response('{}', { status: 503 }));
res = await (await post()).json();
assert.equal(res.deferred, 2);
const refunds = globalThis.__fake.calls.filter(([n, a]) => n === 'service_consume_health_ai_units' && a.p_units < 0);
assert.equal(refunds.length, 1);
assert.ok(globalThis.__fake.calls.some(([n, a]) => n === 'service_defer_health_ai_job' && a.p_error_code === 'health_ai_http_503'));
passed++;

// 4. an oversized page is never sent; units are returned.
globalThis.__fake = makeFake({ docs: docsTwo, pet, pages, blobSize: 7_000_000 });
visionRequests = [];
res = await (await post()).json();
assert.equal(visionRequests.length, 0);
assert.equal(res.manual, 2);
assert.ok(globalThis.__fake.calls.some(([n, a]) => n === 'service_route_health_ai_manual_review' && a.p_error_code === 'health_ai_page_too_large'));
passed++;

// 5. unreadable pages are rejected, unclear ones go to a person.
globalThis.__fake = makeFake({ docs: docsTwo, pet, pages });
mockFetch((body) => new Response(JSON.stringify({ responses: body.requests.map(() => visionPage(FULL, 0.4)) }), { status: 200 }));
res = await (await post()).json();
assert.equal(res.rejected, 2);
globalThis.__fake = makeFake({ docs: docsTwo, pet, pages });
mockFetch((body) => new Response(JSON.stringify({ responses: body.requests.map(() => visionPage(FULL.slice(0, 3))) }), { status: 200 }));
res = await (await post()).json();
assert.equal(res.manual, 2);
const manualCall = globalThis.__fake.calls.find(([n]) => n === 'service_apply_health_ai_result');
assert.equal(manualCall[1].p_outcome, 'manual_review');
assert.deepEqual(manualCall[1].p_signals, []);
passed++;

// 6. other document classes never reach the provider.
globalThis.__fake = makeFake({ docs: [{ id: 'doc-9', pet_id: 'pet-2', document_type: 'lab_report' }], pet, pages });
visionRequests = [];
res = await (await post()).json();
assert.equal(visionRequests.length, 0);
assert.equal(res.manual, 1);
passed++;

// 7. authentication and configuration fail closed.
assert.equal((await handler(new Request('https://x/', { method: 'POST' }))).status, 401);
assert.equal((await handler(new Request('https://x/', { method: 'GET' }))).status, 405);
passed++;

console.log(`health-ai-worker-simulation: ${passed} scenarios PASS (real worker source, fake Supabase, fake Cloud Vision)`);
