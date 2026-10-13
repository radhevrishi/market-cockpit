// zzz948 — daily bars for the screener's price figures (server only). One Yahoo chart call per company: 5 years of daily
// open / high / low / close / volume (~50 KB). Measured from a data-centre address: 150 companies in ~2 s with 8 at a time.
// Only the worked-out figures are kept (lib/screener/tech.ts); the bars themselves are not stored.
import { dbQuery } from '@/lib/db';
import { barsFromYahoo, overlayNse, type NseDay, type TechFigures } from './tech';
import { techEntry, PATTERN_SCAN_VERSION, isScanned, type ScreenPatternTag, type ScanMeta } from './pine';
import type { TvFigures } from './tv-screens';
import { benchWeekly } from '../stage-analysis';

// the same browser string the rest of the app uses for Yahoo (lib/us-prices.ts explains why it must be exactly this)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What is kept per company: the figures, the first trading day (days since 1970) and the date the figures were worked out. */
/** zzz969 — `cc`: the same figures as of the last completed session, kept when the read happened during trading. */
/** zzz983 — `pat` / `patAt` / `patV`: the chart patterns read from the same bars (lib/screener/pine.ts), kept with the figures. */
/** zzz993 — `scan` (MC-02 status / quality), `scanPx` / `scanAt` / `scanSrc` / `scanEx` (MC-01: the close, date, source and Yahoo
 *  exchange of the bars every figure and pattern here was worked out from); `patW` / `patM` / `scanW` / `scanM` for weekly / monthly. */
export type TechStored = TechFigures & {
  ipoD: number | null; cc?: Record<string, number | null> | null; pat?: ScreenPatternTag[]; patAt?: string | null; patV?: number;
  scan?: ScanMeta; scanPx?: number; scanAt?: string; scanSrc?: string; scanEx?: string;
  patW?: ScreenPatternTag[]; patM?: ScreenPatternTag[]; scanW?: ScanMeta; scanM?: ScanMeta;
} & Partial<TvFigures>;

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
  // zzz983: an entry read before the pattern scan (or with an older scan version) is also due, so every company gets patterns
  const due = opts.tickers.filter((t) => { const s = store.get(t); return opts.due(s) || (!!s && s.patV !== PATTERN_SCAN_VERSION); }).sort((a, b) => (store.get(a)?.d || '').localeCompare(store.get(b)?.d || ''));
  if (!due.length) return store;
  const nseOf = opts.nse ? await opts.nse() : null;
  // zzz987 — the market index's weekly closes (S&P 500 / Nifty 50), read once per run, for the Stage Analysis' Mansfield RS.
  // If Yahoo does not answer, the companies still get their stage and SATA; Mansfield RS (and its two SATA points) stay empty.
  let bench: Map<string, number> | null = null;
  try {
    const br = await yahooDaily(opts.market === 'US' ? '^GSPC' : '^NSEI');
    const bb = 'j' in br ? barsFromYahoo(br.j) : null;
    if (bb) bench = benchWeekly(bb.bars.d, bb.bars.c);
  } catch { bench = null; }
  if (!bench?.size) opts.notes.push(`Stage Analysis: the ${opts.market === 'US' ? 'S&P 500' : 'Nifty 50'} history could not be read this run — Mansfield RS left empty for the companies updated now`);
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
          store.set(t, techEntry(bars, got.firstTrade, got.partial, bench, { src: nseOf ? 'yahoo+nse-bhav' : 'yahoo', ex: got.exchange }));   // price figures + chart patterns from the same bars
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
  // zzz993 (MC-02) — genuine readings only; short histories, bad data, scan failures and older versions are counted apart
  let scanned = 0, withPat = 0, short = 0, bad = 0, errs = 0, stale = 0, sw = 0, sm = 0, pw = 0, pm = 0;
  for (const v of store.values()) {
    if (v.patV !== PATTERN_SCAN_VERSION) { stale++; continue; }
    if (isScanned(v.scanW?.st)) { sw++; if (v.patW?.length) pw++; }
    if (isScanned(v.scanM?.st)) { sm++; if (v.patM?.length) pm++; }
    const st = v.scan?.st;
    if (isScanned(st)) { scanned++; if (st === 'ready' && v.pat?.length) withPat++; }
    else if (st === 'insufficient-history') short++;
    else if (st === 'invalid-data') bad++;
    else if (st === 'error') errs++;
  }
  opts.notes.push(`chart patterns (Pine Screener, from the same daily bars): ${scanned} of ${store.size} companies scanned with the current pattern rules, ${withPat} show at least one pattern${short ? `, ${short} too little price history (< 30 sessions)` : ''}${bad ? `, ${bad} price data rejected` : ''}${errs ? `, ${errs} scans failed (price figures kept)` : ''}${stale ? ` — ${stale} read by an older scan version (patterns withheld until re-read with the prices)` : ''}`);
  opts.notes.push(`weekly / monthly chart patterns (completed weeks / months of the same daily bars): ${sw} companies scanned weekly (${pw} with a pattern), ${sm} monthly (${pm} with a pattern) — about 5 years of daily history is kept, so a monthly scan sees at most ~60 bars and needs 24 completed months; younger listings show "too little history" there`);
  return store;
}
