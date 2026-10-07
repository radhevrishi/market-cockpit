// zzz948 — daily bars for the screener's price figures (server only). One Yahoo chart call per company: 5 years of daily
// open / high / low / close / volume (~50 KB). Measured from a data-centre address: 150 companies in ~2 s with 8 at a time.
// Only the worked-out figures are kept (lib/screener/tech.ts); the bars themselves are not stored.
import { dbQuery } from '@/lib/db';
import { barsFromYahoo, overlayNse, techFigures, type NseDay, type TechFigures } from './tech';

// the same browser string the rest of the app uses for Yahoo (lib/us-prices.ts explains why it must be exactly this)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

/** What is kept per company: the figures, the first trading day (days since 1970) and the date the figures were worked out. */
export type TechStored = TechFigures & { ipoD: number | null };

let route = 0;
let lastErr: string | null = null;
async function yahooDaily(symbol: string): Promise<{ j: any } | { status: number }> {
  const p2 = Math.floor(Date.now() / 1000) + 86_400;
  const p1 = p2 - (5 * 365 + 25) * 86_400;
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const relay = (process.env.PROXY_URL || '').replace(/\/$/, ''), secret = process.env.PROXY_SECRET || '';
  const routes = [`https://query1.finance.yahoo.com${path}`, `https://query2.finance.yahoo.com${path}`];
  if (relay && secret) routes.push(`${relay}/proxy?url=${encodeURIComponent(`https://query1.finance.yahoo.com${path}`)}&secret=${encodeURIComponent(secret)}`);
  let status = 0;
  for (let k = 0; k < routes.length; k++) {
    const idx = (route + k) % routes.length;
    try {
      const res = await fetch(routes[idx], { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      status = res.status;
      if (res.status === 404) return { status: 404 };   // Yahoo does not know the symbol
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const j = await res.json();
      route = idx;
      return { j };
    } catch (e: any) { lastErr = e?.name === 'TimeoutError' ? 'timed out' : 'failed'; }
  }
  return { status };
}

/** Reads (or refreshes) the price figures for a list of companies. `symbolOf` turns our ticker into Yahoo's; `due` decides which
 *  stored entries are refreshed this run (oldest first) within `budgetMs`. Results are kept in one database row per market. */
export async function refreshTech(opts: {
  market: 'US' | 'IN'; tickers: string[]; symbolOf: (t: string) => string; due: (stored: TechStored | undefined) => boolean;
  budgetMs: number; concurrency?: number; notes: string[];
  /** India: NSE's own daily prices to lay over Yahoo's (loaded only when some company is due) */
  nse?: () => Promise<(t: string) => Array<{ date: string; day: NseDay | undefined }>>;
}): Promise<Map<string, TechStored>> {
  const key = `screener-tech:${opts.market}`;
  const store = new Map<string, TechStored>();
  const hit = await dbQuery<{ data: Record<string, TechStored> }>(`SELECT data FROM sec_frame_cache WHERE key = $1`, [key]).catch(() => []);
  if (hit.length && hit[0].data) for (const [t, v] of Object.entries(hit[0].data)) store.set(t, v);
  const due = opts.tickers.filter((t) => opts.due(store.get(t))).sort((a, b) => (store.get(a)?.d || '').localeCompare(store.get(b)?.d || ''));
  if (!due.length) return store;
  const nseOf = opts.nse ? await opts.nse() : null;
  const t0 = Date.now();
  let i = 0, ok = 0, miss = 0, fails = 0, streak = 0, stopped = false;
  const worker = async () => {
    while (i < due.length && !stopped && Date.now() - t0 < opts.budgetMs) {
      const t = due[i++];
      const r = await yahooDaily(opts.symbolOf(t));
      if ('j' in r) {
        streak = 0;
        const got = barsFromYahoo(r.j);
        if (got) {
          const bars = nseOf ? overlayNse(got.bars, nseOf(t)) : got.bars;
          store.set(t, { ...techFigures(bars), ipoD: got.firstTrade != null ? Math.floor((got.firstTrade * 1000) / DAY) : null });
          ok++;
        } else miss++;
      } else if (r.status === 404) miss++;
      else { fails++; streak++; if (streak >= 25) stopped = true; await sleep(1000); }   // Yahoo is refusing this address: stop, keep the old figures
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 8 }, worker));
  if (ok) await dbQuery(`INSERT INTO sec_frame_cache (key, data, fetched_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`, [key, JSON.stringify(Object.fromEntries(store))]).catch(() => null);
  const left = Math.max(0, due.length - ok - miss - fails);
  opts.notes.push(`price figures (moving averages, RSI, ATR, performance…): ${ok} companies updated this run, ${store.size} known${left ? `, ${left} still to update (next run)` : ''}${miss ? `, ${miss} unknown to Yahoo` : ''}${fails ? ` · ${fails} reads refused${stopped ? ' — Yahoo paused the reads, the next run continues' : ''}${lastErr ? ` (${lastErr})` : ''}` : ''}`);
  return store;
}
