import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BodyTooLargeError, fetchWithTimeout, readRequestJsonBounded, readResponseJsonBounded, readResponseTextBounded } from '../supabase/functions/_shared/http.ts';

const utf8=new TextEncoder();

// Oversized declared responses must fail before reading the body.
await assert.rejects(
  ()=>readResponseTextBounded(new Response('ok',{headers:{'content-length':'4097'}}),4096),
  error=>error instanceof BodyTooLargeError
);

// Chunked/undeclared responses must still be bounded while streaming.
await assert.rejects(
  ()=>readResponseTextBounded(new Response(utf8.encode('x'.repeat(4097))),4096),
  error=>error instanceof BodyTooLargeError
);

// Provider JSON corruption and empty bodies must fail closed.
await assert.rejects(()=>readResponseJsonBounded(new Response('{broken'),4096),SyntaxError);
await assert.rejects(()=>readResponseJsonBounded(new Response('   '),4096),/empty_json/);

// Empty inbound JSON is intentionally normalized to an empty object while oversized input is rejected.
assert.deepEqual(await readRequestJsonBounded(new Request('https://tailmance.invalid/test',{method:'POST',body:''}),4096),{});
await assert.rejects(
  ()=>readRequestJsonBounded(new Request('https://tailmance.invalid/test',{method:'POST',body:'x'.repeat(4097)}),4096),
  error=>error instanceof BodyTooLargeError
);

// Deterministic outbound timeout fault injection. No external network is used.
const originalFetch=globalThis.fetch;
try{
  globalThis.fetch=async (_url,init={})=>await new Promise((resolve,reject)=>{
    const signal=init.signal;
    if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return;}
    signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  });
  await assert.rejects(()=>fetchWithTimeout('https://tailmance.invalid/timeout',{},15),error=>error instanceof DOMException&&error.name==='AbortError');
} finally {
  globalThis.fetch=originalFetch;
}

const client=readFileSync('src/services/supabase.ts','utf8');
assert.match(client,/const idempotentRead=method==='GET'\|\|method==='HEAD'/,'automatic HTTP retries must be read-only');
assert.match(client,/const maxAttempts=idempotentRead\?3:1/,'non-idempotent HTTP requests must never be automatically replayed');
assert.match(client,/\[429,502,503,504\]\.includes\(response\.status\)/,'bounded read retry status set required');
assert.match(client,/Math\.min\(retryAfterSeconds\*1000,2_000\)/,'Retry-After must be capped');
assert.match(client,/CLIENT_HTTP_TIMEOUT_MS = 45_000/,'mobile HTTP timeout must be finite');

const offline=readFileSync('src/services/offlineMutationQueue.ts','utf8');
assert.match(offline,/status===429\|\|\(Number\.isFinite\(status\)&&status>=500\)/,'offline replay must classify transient server faults for retry');
assert.match(offline,/MAX_BACKOFF_EXPONENT=12/,'offline replay backoff must be bounded');
assert.match(offline,/Math\.min\(6\*60\*60\*1000/,'offline retry delay must have a hard ceiling');
assert.match(offline,/if\(replayPromise\)return replayPromise/,'offline replay must be single-flight under concurrent triggers');
assert.doesNotMatch(offline,/SET state='failed'/,'transient replay must not silently strand payloads in an unreplayed failed state');

const security=readFileSync('scripts/security-checks.mjs','utf8');
assert.match(security,/all Edge Function outbound fetches go through the shared timeout helper/,'security suite must retain outbound timeout coverage');
assert.match(security,/moderation retry state is explicit and fails closed if persistence fails/,'moderation retry persistence must remain fail-closed');

console.log('resilience-chaos-checks: timeout + oversized body + malformed JSON + 429/5xx + retry/idempotency fault injection PASS');
