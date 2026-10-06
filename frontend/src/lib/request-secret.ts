// zzz883 security — the job secret belongs in a HEADER, not in the URL (URLs are written to access logs, browser history and
// proxies). Every cron / bot route reads it through this helper:
//   x-cron-secret  |  x-mc-key  |  Authorization: Bearer <secret>      ← preferred
//   ?secret=<…>                                                          ← still accepted for old callers, logged once per path
const warned = new Set<string>();
export function secretFromRequest(req: { headers: Headers; url: string }, sp?: URLSearchParams): string | null {
  const h = req.headers.get('x-cron-secret') || req.headers.get('x-mc-key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || '';
  if (h) return h;
  let q: string | null = null;
  try { q = (sp || new URL(req.url).searchParams).get('secret'); } catch { q = null; }
  if (q) {
    let path = '';
    try { path = new URL(req.url).pathname; } catch { /* ignore */ }
    if (!warned.has(path)) { warned.add(path); console.warn(`[auth] secret passed in the URL for ${path} — move it to the x-cron-secret header`); }
  }
  return q;
}
