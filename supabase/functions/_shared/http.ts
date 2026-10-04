import {edgeBestEffort} from './operational.ts';
export class BodyTooLargeError extends Error {
  constructor() { super('body_too_large'); this.name = 'BodyTooLargeError'; }
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readStreamBounded(stream: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await edgeBestEffort('http_oversize_body_cancel',()=>reader.cancel('body_too_large'))
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function assertDeclaredLength(value: string | null, maxBytes: number) {
  if (!value) return;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > maxBytes) throw new BodyTooLargeError();
}

export async function readResponseBytesBounded(response: Response, maxBytes = 256_000) {
  assertDeclaredLength(response.headers.get('content-length'), maxBytes);
  return readStreamBounded(response.body, maxBytes);
}

export async function readResponseTextBounded(response: Response, maxBytes = 256_000) {
  const bytes = await readResponseBytesBounded(response, maxBytes);
  return new TextDecoder().decode(bytes);
}

export async function readResponseJsonBounded<T = unknown>(response: Response, maxBytes = 256_000): Promise<T> {
  const text = await readResponseTextBounded(response, maxBytes);
  if (!text.trim()) throw new SyntaxError('empty_json');
  return JSON.parse(text) as T;
}

export async function readRequestTextBounded(request: Request, maxBytes = 64_000) {
  assertDeclaredLength(request.headers.get('content-length'), maxBytes);
  const bytes = await readStreamBounded(request.body, maxBytes);
  return new TextDecoder().decode(bytes);
}

export async function readRequestJsonBounded<T = unknown>(request: Request, maxBytes = 64_000): Promise<T> {
  const text = await readRequestTextBounded(request, maxBytes);
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}
