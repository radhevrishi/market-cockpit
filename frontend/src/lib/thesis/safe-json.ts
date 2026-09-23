// ═══════════════════════════════════════════════════════════════════════════
// READABLE FAILURES FOR THE THESIS PAGE.                             (zzz765)
//
// Cards printed `Unexpected token 'u', "upstream error" is not valid JSON` and
// a bare `Failed to fetch`. The first is the proxy answering a timed-out read
// with plain text; the second is the browser losing the request. Neither says
// what happened to the owner's evidence (nothing — it is persisted) or what
// to do (retry). Every fetch on the page now goes through these two.
// ═══════════════════════════════════════════════════════════════════════════

/** Parse a response as JSON; a non-JSON body becomes `{ ok:false, error }`
 *  with a sentence instead of a parser message. Never throws. */
export async function readJson(res: Response): Promise<any> {
  let text = '';
  try { text = await res.text(); } catch { /* body unreadable */ }
  try { return text ? JSON.parse(text) : { ok: res.ok }; } catch {
    const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    return {
      ok: false,
      error: res.status >= 500 || /upstream|timeout|gateway/i.test(snippet)
        ? `The server did not finish in time (HTTP ${res.status || 'error'}${snippet ? `: ${snippet}` : ''}). Evidence already on file is unchanged — retry this company.`
        : `Unexpected reply from the server (HTTP ${res.status}). Evidence already on file is unchanged — retry.`,
    };
  }
}

/** A thrown fetch error as a sentence. */
export function humanError(e: unknown): string {
  const m = String((e as any)?.message || e || '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) {
    return 'Could not reach the server (connection dropped or timed out). Evidence already on file is unchanged — retry.';
  }
  if (/abort|timeout/i.test(m)) return 'The request timed out. Evidence already on file is unchanged — retry.';
  if (/not valid JSON|Unexpected token|JSON\.parse/i.test(m)) {
    return 'The server did not finish in time and answered with an error page. Evidence already on file is unchanged — retry.';
  }
  return m || 'Unknown error — retry.';
}
