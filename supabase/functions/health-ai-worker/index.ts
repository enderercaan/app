import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { fetchWithTimeout, readResponseJsonBounded } from '../_shared/http.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';
import { requireAllowlistedHttpsUrl } from '../_shared/outboundUrl.ts';
import { markWorkerHeartbeat } from '../_shared/workerHeartbeat.ts';
import { evaluateBooklet, SCHEDULE_VERSION, type OcrPage, type OcrWord } from '../_shared/healthBookletCheck.ts';

// Vaccination-booklet check. Every uploaded page of a pet's booklet is read by Google Cloud Vision (document text
// detection, EU endpoint) and the dated entries are compared with the published schedule in _shared/healthBookletCheck.ts.
// The check approves, sends to a person, or rejects unreadable pages. It reads the vaccine, parasite-treatment and
// microchip entries only, never looks up or names any person or organisation, never infers breed, sex or size
// (they are owner-entered), and its result is a document check, not a health assessment.
const PROVIDER_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 8_000_000;
const MAX_BOOKLET_PAGES = 12;
const PAGES_PER_REQUEST = 4;
const MAX_REQUEST_BYTES = 8_000_000;
const MAX_PAGE_BYTES = 6_000_000;
// Google Cloud Vision bills one unit per page and per feature, with the first 1,000 units each month free.
// The worker stops at 900 so the monthly free allowance is never exceeded; later pages wait for a person.
const FREE_TIER_MONTHLY_UNITS = 900;

type VisionVertex = { x?: number; y?: number };
type VisionWord = { confidence?: number; boundingBox?: { vertices?: VisionVertex[] }; symbols?: { text?: string }[] };
type VisionResponse = { responses?: { error?: unknown; fullTextAnnotation?: { pages?: { blocks?: { paragraphs?: { words?: VisionWord[] }[] }[] }[] } }[] };

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}
type VisionItem = NonNullable<VisionResponse['responses']>[number];
function toPage(raw: VisionItem): OcrPage {
  const words: OcrWord[] = [];
  for (const page of raw?.fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const word of paragraph.words ?? []) {
          const text = (word.symbols ?? []).map(s => s.text ?? '').join('');
          const vertices = word.boundingBox?.vertices ?? [];
          if (!text.trim() || vertices.length < 2) continue;
          const xs = vertices.map(v => v.x ?? 0);
          const ys = vertices.map(v => v.y ?? 0);
          const top = Math.min(...ys);
          const bottom = Math.max(...ys);
          words.push({ text, conf: typeof word.confidence === 'number' ? word.confidence : 0, x: Math.min(...xs), y: (top + bottom) / 2, h: bottom - top });
        }
      }
    }
  }
  return { words };
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const workerSecret = Deno.env.get('HEALTH_AI_WORKER_SECRET') ?? '';
  if (!verifyBearerSecret(req.headers.get('Authorization'), workerSecret, 32)) return json({ error: 'unauthorized' }, 401);
  const rawEndpoint = Deno.env.get('HEALTH_AI_API_URL') ?? '';
  const providerKey = Deno.env.get('HEALTH_AI_API_KEY') ?? '';
  const providerCode = (Deno.env.get('HEALTH_AI_PROVIDER_CODE') ?? '').trim();
  if (providerKey.length < 20 || !/^[A-Za-z0-9._-]{2,80}$/.test(providerCode)) return json({ error: 'health_ai_not_configured' }, 503);
  let endpoint: URL;
  try { endpoint = requireAllowlistedHttpsUrl(rawEndpoint, Deno.env.get('HEALTH_AI_ALLOWED_HOSTS_JSON'), { errorCode: 'health_ai_provider_invalid' }); } catch { return json({ error: 'health_ai_provider_invalid' }, 503); }

  const supabase = adminClient();
  await markWorkerHeartbeat(supabase,'health-ai-worker','started');
  const { data: jobs, error: claimError } = await supabase.rpc('claim_health_ai_jobs', { p_limit: 12 });
  if (claimError) return json({ error: 'health_ai_claim_failed' }, 503);

  let processed = 0, manual = 0, rejected = 0, deferred = 0;
  const jobIds: string[] = (jobs ?? []).map((job: { health_document_id?: unknown }) => String(job.health_document_id ?? ''));
  const { data: claimedDocs } = jobIds.length
    ? await supabase.from('health_documents').select('id,pet_id,document_type').in('id', jobIds)
    : { data: [] as { id: string; pet_id: string; document_type: string }[] };
  const defer = async (documentId: string, code: string) => {
    deferred++;
    await supabase.rpc('service_defer_health_ai_job', { p_health_document_id: documentId, p_error_code: code.slice(0, 120) }).catch(() => undefined);
  };
  const routeManual = async (documentId: string, code: string) => {
    const { error } = await supabase.rpc('service_route_health_ai_manual_review', { p_health_document_id: documentId, p_error_code: code });
    if (error) throw new Error('health_ai_manual_review_route_failed');
    manual++;
  };

  const byPet = new Map<string, string[]>();
  for (const id of jobIds) {
    const doc = (claimedDocs ?? []).find((d: { id: string }) => d.id === id);
    if (!doc) { await defer(id, 'health_document_read_failed'); continue; }
    if (doc.document_type !== 'health_record') {
      try { await routeManual(id, 'health_ai_unsupported_document_type'); } catch (error: any) { await defer(id, String(error?.message ?? 'health_ai_error')); }
      continue;
    }
    byPet.set(doc.pet_id, [...(byPet.get(doc.pet_id) ?? []), id]);
  }

  for (const [petId, documentIds] of byPet) {
    let reserved = 0;
    try {
      const { data: pet } = await supabase.from('pets').select('species,birth_date,breed,sex,size,weight_kg').eq('id', petId).maybeSingle();
      const { data: privateRow } = await supabase.from('pet_private').select('microchip_number').eq('pet_id', petId).maybeSingle();
      const { data: pages } = await supabase.from('health_documents').select('id,storage_path').eq('pet_id', petId).eq('document_type', 'health_record').order('created_at', { ascending: true }).limit(MAX_BOOKLET_PAGES);
      if (!pages?.length) throw new Error('health_ai_no_pages');

      const { error: unitsError } = await supabase.rpc('service_consume_health_ai_units', { p_units: pages.length, p_monthly_cap: FREE_TIER_MONTHLY_UNITS });
      if (unitsError) {
        if (String(unitsError.message ?? '').includes('health_ai_monthly_units_exhausted')) {
          for (const id of documentIds) await routeManual(id, 'health_ai_free_quota_exhausted');
          continue;
        }
        throw new Error('health_ai_units_failed');
      }
      reserved = pages.length;

      const images: string[] = [];
      let tooLarge = false;
      for (const page of pages) {
        const { data: blob, error: downloadError } = await supabase.storage.from('health-documents').download(page.storage_path);
        if (downloadError || !blob) throw new Error('health_document_download_failed');
        if (blob.size > MAX_PAGE_BYTES) { tooLarge = true; break; }
        images.push(toBase64(new Uint8Array(await blob.arrayBuffer())));
      }
      if (tooLarge) {
        await supabase.rpc('service_consume_health_ai_units', { p_units: -reserved, p_monthly_cap: FREE_TIER_MONTHLY_UNITS });
        for (const id of documentIds) await routeManual(id, 'health_ai_page_too_large');
        continue;
      }

      const started = Date.now();
      const ocrPages: OcrPage[] = [];
      for (let i = 0; i < images.length;) {
        const chunk: string[] = [];
        let bytes = 0;
        while (i < images.length && chunk.length < PAGES_PER_REQUEST && (chunk.length === 0 || bytes + images[i].length <= MAX_REQUEST_BYTES)) { bytes += images[i].length; chunk.push(images[i++]); }
        const { error: budgetError } = await supabase.rpc('service_consume_ai_provider_budget', { p_provider_key: 'health_ai' });
        if (budgetError) throw new Error('health_ai_provider_cost_budget_exhausted');
        let response: Response;
        try {
          response = await fetchWithTimeout(endpoint.toString(), {
            method: 'POST', redirect: 'error',
            headers: { 'X-Goog-Api-Key': providerKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: chunk.map(content => ({ image: { content }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] })) }),
          }, PROVIDER_TIMEOUT_MS);
        } catch (error: any) { throw new Error(error?.name === 'AbortError' ? 'health_ai_timeout' : 'health_ai_network_error'); }
        if (!response.ok) throw new Error(`health_ai_http_${response.status}`);
        const raw = await readResponseJsonBounded<VisionResponse>(response, MAX_RESPONSE_BYTES);
        if (!Array.isArray(raw?.responses) || raw.responses.length !== chunk.length) throw new Error('health_ai_schema_invalid');
        for (const item of raw.responses) {
          if (item?.error) throw new Error('health_ai_provider_page_error');
          ocrPages.push(toPage(item));
        }
      }

      const today = new Date();
      const result = evaluateBooklet(ocrPages, {
        species: pet?.species ?? null, birthDate: pet?.birth_date ?? null,
        breed: pet?.breed ?? null, sex: pet?.sex ?? null, size: pet?.size ?? null, weightKg: pet?.weight_kg ?? null,
        declaredMicrochip: privateRow?.microchip_number ?? null,
      }, today);
      const referenceHash = await sha256Hex(`${providerCode}|${SCHEDULE_VERSION}|${pages.map((p: { id: string }) => p.id).join(',')}|${today.toISOString().slice(0, 10)}`);
      const signals = result.outcome === 'approved'
        ? result.signals.map(item => ({
          signal: item.signal,
          confidence: Math.round(item.confidence * 1e5) / 1e5,
          verifiedAt: today.toISOString(),
          ...(item.validUntil ? { expiresAt: item.validUntil } : {}),
        }))
        : [];
      const latencyMs = Math.min(Date.now() - started, 120000);
      for (const documentId of documentIds) {
        const { data: applied, error: applyError } = await supabase.rpc('service_apply_health_ai_result', {
          p_health_document_id: documentId,
          p_provider_code: providerCode,
          p_provider_reference_sha256: referenceHash,
          p_model_version: `${providerCode}/document_text_detection+${SCHEDULE_VERSION}`.slice(0, 120),
          p_document_confidence: Math.round(Math.min(1, Math.max(0, result.documentConfidence)) * 1e5) / 1e5,
          p_outcome: result.outcome,
          p_reason_code: result.reasonCode,
          p_signals: signals,
          p_latency_ms: latencyMs,
        });
        if (applyError) { await defer(documentId, 'health_ai_result_apply_failed'); continue; }
        const decision = String(applied?.decision ?? '');
        if (decision === 'manual_review') manual++; else if (decision === 'rejected') rejected++; else processed++;
      }
    } catch (error: any) {
      if (reserved) await supabase.rpc('service_consume_health_ai_units', { p_units: -reserved, p_monthly_cap: FREE_TIER_MONTHLY_UNITS }).catch(() => undefined);
      for (const id of documentIds) await defer(id, String(error?.message ?? 'health_ai_provider_error'));
    }
  }
  await markWorkerHeartbeat(supabase,'health-ai-worker','completed');
  return json({ ok: true, claimed: jobIds.length, processed, manual, rejected, deferred });
});
