// PATCH 0716 — safeFetch helper.
// Single consolidated wrapper around `fetch` + `AbortController` + json
// parsing that returns a tagged result. Callers never have to remember
// to clearTimeout / wrap JSON.parse in try/catch / Array.isArray-guard
// the payload. Use this for any new fetch call. Existing calls can
// migrate opportunistically — the helper is purely additive.

export type SafeFetchOk<T> = {
  ok: true;
  status: number;
  data: T;
  ms: number;
};

export type SafeFetchErr = {
  ok: false;
  status: number;       // 0 when no response (network / abort)
  error: string;        // "HTTP 503" | "timeout" | "parse error" | message
  kind: 'http' | 'timeout' | 'network' | 'parse';
  ms: number;
};

export type SafeFetchResult<T> = SafeFetchOk<T> | SafeFetchErr;

export interface SafeFetchOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  // Pass to chain with a caller-owned controller (e.g. useEffect cleanup).
  signal?: AbortSignal;
}

/**
 * Fetches a URL and parses JSON, returning a tagged result. Always
 * resolves (never throws). Caller pattern:
 *
 *   const r = await safeFetchJson<MyShape>('/api/foo', { timeoutMs: 8000 });
 *   if (!r.ok) { showError(r.error); return; }
 *   const data = r.data;
 */
export async function safeFetchJson<T = unknown>(
  url: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult<T>> {
  const start = Date.now();
  const { timeoutMs = 15_000, signal: callerSignal, ...rest } = opts;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  // Forward caller abort into our controller.
  const onCallerAbort = () => ctl.abort();
  if (callerSignal) {
    if (callerSignal.aborted) ctl.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  try {
    const res = await fetch(url, { ...rest, signal: ctl.signal });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, kind: 'http', ms: Date.now() - start };
    }
    let parsed: T;
    try {
      parsed = (await res.json()) as T;
    } catch (e: any) {
      return { ok: false, status: res.status, error: `parse error: ${e?.message || 'invalid JSON'}`, kind: 'parse', ms: Date.now() - start };
    }
    return { ok: true, status: res.status, data: parsed, ms: Date.now() - start };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: aborted ? `timeout (${timeoutMs}ms)` : (e?.message || 'network error'),
      kind: aborted ? 'timeout' : 'network',
      ms: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Convenience: extracts an array from a payload that might be
 * `T[] | { data: T[] } | { articles: T[] } | { stocks: T[] }` etc.
 * Returns `[]` on miss — never throws. Pair with safeFetchJson when
 * the upstream shape is variable.
 */
export function safeArray<T = unknown>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const k of keys) {
      const v = obj[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}
