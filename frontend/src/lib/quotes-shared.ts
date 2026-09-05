// ════════════════════════════════════════════════════════════════════════════
// quotes-shared.ts (zzz530) — one shared, deduped client fetch of the bulk
// market quotes. Several home widgets (AlertCenter, SignalScoreboard, …) each
// used to fetch /api/market/quotes independently, firing the same URL 2–4×
// per page load. This memoises the parsed result per market with a short TTL
// and shares any in-flight request, so N callers collapse to ONE network call.
// Zero new endpoints/crons — strictly FEWER calls. SSR-safe, failure-tolerant.
// ════════════════════════════════════════════════════════════════════════════

export interface Quote { ticker: string; price: number; changePercent: number | null }

type Market = 'india' | 'us';
const TTL = 60_000; // 1 min — matches the server's live-hours cache window
const cache = new Map<Market, { at: number; rows: Quote[] }>();
const inflight = new Map<Market, Promise<Quote[]>>();

const norm = (s: any) => String(s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();

async function doFetch(market: Market): Promise<Quote[]> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(`/api/market/quotes?market=${market}&fields=ticker,price,changePercent`, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    const stocks = Array.isArray(j?.stocks) ? j.stocks : [];
    const out: Quote[] = [];
    for (const s of stocks) {
      const ticker = norm(s?.ticker);
      const price = Number(s?.price);
      if (ticker && Number.isFinite(price) && price > 0) {
        out.push({ ticker, price, changePercent: Number.isFinite(Number(s?.changePercent)) ? Number(s.changePercent) : null });
      }
    }
    cache.set(market, { at: Date.now(), rows: out });
    return out;
  } catch { return cache.get(market)?.rows ?? []; }
}

/** Get bulk quotes for one market, shared across all callers within the TTL. */
export function getQuotes(market: Market): Promise<Quote[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  const hit = cache.get(market);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.rows);
  const pending = inflight.get(market);
  if (pending) return pending;
  const p = doFetch(market).finally(() => inflight.delete(market));
  inflight.set(market, p);
  return p;
}

/** Both markets merged into a symbol→quote map (india wins ticker collisions). */
export async function getQuoteMap(markets: Market[] = ['india', 'us']): Promise<Map<string, Quote>> {
  const lists = await Promise.all(markets.map((m) => getQuotes(m)));
  const map = new Map<string, Quote>();
  for (const list of lists) for (const q of list) if (!map.has(q.ticker)) map.set(q.ticker, q);
  return map;
}
