// ═══════════════════════════════════════════════════════════════════════════
// TICKER → LISTING VENUE, browser side.
//
// A thin cache in front of /api/v1/us/exchange, which reads SEC's own
// `company_tickers_exchange.json`. Two reasons it is worth caching rather than
// asking on every export:
//
//  1. A listing venue effectively never changes. A company can transfer from
//     Nasdaq to NYSE, and a handful do each year, so the cache expires after a
//     week rather than never.
//  2. The bench is up to ~420 names. Re-resolving all of them on every click of
//     Copy → TradingView would put a needless round trip between the click and
//     the clipboard, and the export must feel instant.
//
// A NEGATIVE ANSWER IS CACHED TOO. "SEC does not carry this ticker" is a real
// answer — it is what happens to a name that has since delisted or changed
// symbol — and re-asking for it every week is the correct cadence, not
// re-asking on every render.
// ═══════════════════════════════════════════════════════════════════════════

const LS_KEY = 'mc:us-exchange:v1';
const MAX_AGE_MS = 7 * 24 * 3600_000;
/** The route caps a request at 600; stay under it so nothing is silently cut. */
const BATCH = 500;

interface CacheRow { x: string | null; at: number }

function readCache(): Record<string, CacheRow> {
  if (typeof window === 'undefined') return {};
  try {
    const o = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch { return {}; }
}

function writeCache(map: Record<string, CacheRow>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch { /* quota — the cache is a convenience */ }
}

/** Whatever is already known, with no network call. Used to render immediately;
 *  the export then tops it up. */
export function knownExchanges(tickers: string[]): Record<string, string | null> {
  const c = readCache();
  const out: Record<string, string | null> = {};
  const now = Date.now();
  for (const t of tickers) {
    const k = String(t || '').toUpperCase().split('@')[0];
    const hit = c[k];
    if (hit && now - hit.at < MAX_AGE_MS) out[k] = hit.x;
  }
  return out;
}

/**
 * Resolve every ticker, fetching only the ones not already cached and fresh.
 *
 * Never throws and never rejects: a network failure returns whatever the cache
 * held, so Copy → TradingView still produces a usable (if less qualified)
 * watchlist rather than nothing at all.
 */
export async function resolveExchanges(tickers: string[]): Promise<Record<string, string | null>> {
  const keys = Array.from(new Set(
    tickers.map((t) => String(t || '').toUpperCase().split('@')[0].trim()).filter(Boolean),
  ));
  const cache = readCache();
  const now = Date.now();
  const out: Record<string, string | null> = {};
  const missing: string[] = [];
  for (const k of keys) {
    const hit = cache[k];
    if (hit && now - hit.at < MAX_AGE_MS) out[k] = hit.x;
    else missing.push(k);
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const slice = missing.slice(i, i + BATCH);
    try {
      const res = await fetch(`/api/v1/us/exchange?tickers=${encodeURIComponent(slice.join(','))}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const j = await res.json();
      const m = (j?.map && typeof j.map === 'object') ? j.map as Record<string, unknown> : {};
      for (const k of slice) {
        const v = m[k];
        const x = typeof v === 'string' && v ? v : null;
        out[k] = x;
        cache[k] = { x, at: now };
      }
    } catch { /* offline — the cached half still exports */ }
  }
  writeCache(cache);
  return out;
}
