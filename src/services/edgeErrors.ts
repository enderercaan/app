export async function throwIfEdgeFunctionFailed(data: unknown, error: unknown) {
  const directCode = data && typeof data === 'object' && 'error' in data ? String((data as { error?: unknown }).error ?? '') : '';
  if (directCode) throw new Error(directCode);
  if (!error) return;

  let remoteCode = '';
  const context = (error as { context?: unknown } | null)?.context as { clone?: () => { json?: () => Promise<unknown> }; json?: () => Promise<unknown> } | undefined;
  try {
    const response = typeof context?.clone === 'function' ? context.clone() : context;
    const payload = response && typeof response.json === 'function' ? await response.json() : null;
    if (payload && typeof payload === 'object' && 'error' in payload) remoteCode = String((payload as { error?: unknown }).error ?? '');
  } catch {
    // The response body may be absent/non-JSON. Preserve the original SDK error below.
  }
  if (remoteCode) throw new Error(remoteCode);
  if (error instanceof Error) throw error;
  throw new Error(String(error));
}
