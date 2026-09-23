// ═══════════════════════════════════════════════════════════════════════════
// READING AN API ANSWER WITHOUT "Unexpected token '<'".              (zzz766)
//
// The gainers page called `r.json()` on every response. When Railway's proxy
// answered a 502 with an HTML error page, or the route timed out, the owner
// saw `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` — a parser
// error standing in for "the server is down". This reads the body as text,
// parses it only if it is JSON, and turns every failure into a sentence.
// Pure apart from the Response it is handed, so it is tested directly.
// ═══════════════════════════════════════════════════════════════════════════

export interface JsonResult<T = any> { ok: boolean; status: number; json: T | null; error: string | null }

export async function readJsonResponse<T = any>(r: Response, what = 'The server'): Promise<JsonResult<T>> {
  let text = '';
  try { text = await r.text(); } catch { text = ''; }
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (json == null) {
    const looksHtml = /^\s*</.test(text);
    const error = !r.ok
      ? `${what} returned an error${looksHtml ? ' page' : ''} (HTTP ${r.status}) instead of data. It is usually a restart or a timeout — retry in a minute.`
      : `${what} answered, but not with data${looksHtml ? ' (an HTML page)' : ''}. Retry in a minute.`;
    return { ok: false, status: r.status, json: null, error };
  }
  if (!r.ok || json?.ok === false) {
    const msg = typeof json?.error === 'string' && json.error ? json.error : `HTTP ${r.status}`;
    return { ok: false, status: r.status, json, error: `${what} reported a problem: ${msg}` };
  }
  return { ok: true, status: r.status, json, error: null };
}

/** A thrown fetch (network down, abort, timeout) as a readable sentence. */
export function describeFetchError(e: unknown, what = 'The server'): string {
  const name = String((e as any)?.name || '');
  const msg = String((e as any)?.message || e || '');
  if (name === 'TimeoutError' || /timed? ?out/i.test(msg)) return `${what} took too long to answer. Retry — a cached result usually comes back quickly.`;
  if (name === 'AbortError') return 'The request was cancelled.';
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) return `Could not reach ${what.toLowerCase()} — check the connection and retry.`;
  return `${what} could not be read: ${msg.slice(0, 200)}`;
}
