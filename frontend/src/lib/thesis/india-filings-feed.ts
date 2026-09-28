// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA EXCHANGE RESULTS FEED — the rolling window plus one day. (zzz816)
//
// The same two CF-worker calls the AI read (api/v1/india/ai-summary) makes:
// `/api/results/latest` (a rolling ~1-week window) and, when a filing date is
// known, `/api/results/day/<date>`. Shared here so the quick read (no AI)
// searches exactly what the AI read searches. Server-only.
// ═══════════════════════════════════════════════════════════════════════════

export interface CFFilingItem {
  symbol: string;
  subject: string;
  filing_date: string;
  attachment_url?: string;
}

const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://mc-scraper.radhev-232.workers.dev';

export async function fetchFeed(path: string, timeoutMs = 20_000): Promise<CFFilingItem[]> {
  try {
    const res = await fetch(`${CF_WORKER_URL}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const j = await res.json();
    const arr = Array.isArray(j) ? j : (j?.items || j?.data || j?.results || []);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** The latest window, merged with the filing day when one is given. */
export async function loadFilings(filingDate?: string | null, timeoutMs = 20_000): Promise<CFFilingItem[]> {
  const latest = await fetchFeed('/api/results/latest', timeoutMs);
  if (!filingDate || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) return latest;
  const day = await fetchFeed(`/api/results/day/${filingDate}`, timeoutMs);
  if (!day.length) return latest;
  const seen = new Set(latest.map((f) => String(f?.attachment_url || '')));
  return [...latest, ...day.filter((f) => !seen.has(String(f?.attachment_url || '')))];
}

/** The latest window, fetched once per server process per few minutes: a
 *  page-load quick read of 20 names must not ask the worker 20 times. */
let _latest: { at: number; items: CFFilingItem[] } | null = null;
export async function loadFilingsCached(filingDate?: string | null, ttlMs = 5 * 60_000): Promise<CFFilingItem[]> {
  if (!_latest || Date.now() - _latest.at > ttlMs) {
    const items = await fetchFeed('/api/results/latest', 15_000);
    // An empty answer is not cached: the next name asks again.
    _latest = items.length ? { at: Date.now(), items } : null;
    if (!filingDate) return items;
  }
  const latest = _latest?.items || [];
  if (!filingDate || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) return latest;
  const day = await fetchFeed(`/api/results/day/${filingDate}`, 15_000);
  const seen = new Set(latest.map((f) => String(f?.attachment_url || '')));
  return [...latest, ...day.filter((f) => !seen.has(String(f?.attachment_url || '')))];
}
