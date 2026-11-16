// zzz865 — a saved copy of the last good Guidance Upgrades answer per window, kept in KV, so a refresh never starts from nothing.
// Pure helpers (no I/O) so they can be tested. The route reads / writes KV with them.
export const LASTGOOD_PREFIX = 'guidance-upgrades:lastgood:v1:';
export const LASTGOOD_TTL_S = 7 * 86_400;
export const LASTGOOD_MAX_CHARS = 12_000_000;   // zzz1275 — was 850 KB (Upstash's 1 MiB limit). The store is Postgres now; at 850 KB the 30D / 120D answers (4–8 MB) could not be trimmed small enough, nothing was saved and every visit rebuilt for ~30 s
export const LASTGOOD_SERVE_MS = 3 * 3600_000;   // zzz1275 — was 10 min: the hourly refresh left the copy older, so most visits rebuilt for 26–34 s. The page asks for a fresh build in the background anyway. // a saved copy this young is served at once (the page then refreshes it in the background)

export interface LastGood<T> { savedAt: number; body: T }

/** Make the saved copy fit the store limit by trimming the long lists only (never the counts, which stay exact). */
export function slimForStore<T extends { events?: unknown[]; reviewQueue?: unknown[]; unresolved?: unknown[] }>(body: T, maxChars = LASTGOOD_MAX_CHARS): { body: T; slimmed: boolean } | null {
  let s = JSON.stringify(body);
  if (s.length <= maxChars) return { body, slimmed: false };
  const steps: Array<[number, number]> = [[400, 300], [250, 150], [150, 60], [80, 0]];
  for (const [ev, rq] of steps) {
    const b = { ...body, events: (body.events || []).slice(0, ev), reviewQueue: (body.reviewQueue || []).slice(0, rq), unresolved: (body.unresolved || []).slice(0, 20) } as T;
    s = JSON.stringify(b);
    if (s.length <= maxChars) return { body: b, slimmed: true };
  }
  return null;
}
export function lastGoodKey(window: string, market: string): string { return `${LASTGOOD_PREFIX}${window}:${market}`; }
export function isUsableLastGood(v: unknown): v is LastGood<{ events: unknown[] }> {
  const o = v as LastGood<{ events?: unknown }> | null;
  return !!o && typeof o.savedAt === 'number' && !!o.body && Array.isArray((o.body as { events?: unknown }).events);
}
export function lastGoodAgeMs(v: { savedAt: number }, now = Date.now()): number { return Math.max(0, now - v.savedAt); }
