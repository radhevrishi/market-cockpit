// zzz948 — daily bars for the screener's price figures (server only). One Yahoo chart call per company: 5 years of daily
// open / high / low / close / volume (~50 KB). Measured from a data-centre address: 150 companies in ~2 s with 8 at a time.
// zzz1003 (PS-07) — now ~10 years (HISTORY_DAYS), so the monthly pattern scan sees up to 120 monthly bars (a 60-month U base needs
// ~68 with its prior trend). Every price figure and the daily / weekly scans still read the last ~5 years (pine.ts techEntry →
// recentBars), so they are unchanged. Measured 13 Oct 2026 from the sandbox: AAPL 5 y 141 KB / 1,272 bars, 10 y 277 KB / 2,529 bars,
// response time the same (~0.4–0.7 s, latency-bound); JSON parse 0.9 → 2.4 ms and the whole techEntry ~15 → ~20 ms a company
// (+ ~5 ms for the provisional live-bar scan during a session) — about +25–45 s of CPU over a 4,400-company US run, inside its
// 6.5-minute fetch budget (the reads are network-bound at 8 at a time).
// Only the worked-out figures are kept (lib/screener/tech.ts); the bars themselves are not stored.
import { dbQuery } from '@/lib/db';
import { barsFromYahoo, overlayNse, type NseDay, type TechFigures } from './tech';
import { techEntry, PATTERN_SCAN_VERSION, isScanned, MONTHLY_HISTORY_REQ, PATTERN_SCAN_DAILY_COMPAT, type ScreenPatternTag, type ScanMeta, type LiveScanMeta } from './pine';
import type { TvFigures } from './tv-screens';
import { SETUP_VERSION, setupCoverageNote } from './pine';
import type { SetupFigures } from '../setups';
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
  /** zzz1003 (PS-03) — the provisional reading of today's unfinished session (pine.ts techEntry) */
  patLive?: ScreenPatternTag[]; scanLive?: LiveScanMeta;
  /** zzz1020 — the trader-setup version the setup figures were read with (pine.ts SETUP_VERSION) */
  setV?: number;
} & Partial<TvFigures> & Partial<SetupFigures>;

let route = 0;
let lastErr: string | null = null;
/** zzz1003 (PS-07) — calendar days of daily history asked for per company (10 years + 25 days). */
export const HISTORY_DAYS = 10 * 365 + 25;
async function yahooDaily(symbol: string, days: number = HISTORY_DAYS): Promise<{ j: any } | { status: number }> {
  const p2 = Math.floor(Date.now() / 1000) + 86_400;
  const p1 = p2 - days * 86_400;
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
  // zzz1020: an entry whose trader setups were read with another SETUP_VERSION is due too — after the price / pattern-due ones
  const firstDue = (s: TechStored | undefined) => opts.due(s) || (!!s && s.patV !== PATTERN_SCAN_VERSION);
  const rank = (t: string) => (firstDue(store.get(t)) ? 0 : 1);
  const due = opts.tickers.filter((t) => { const s = store.get(t); return firstDue(s) || (!!s && s.setV !== SETUP_VERSION); })
    .sort((a, b) => rank(a) - rank(b) || (store.get(a)?.d || '').localeCompare(store.get(b)?.d || ''));
  if (!due.length) return store;
  const nseOf = opts.nse ? await opts.nse() : null;
  // zzz987 — the market index's weekly closes (S&P 500 / Nifty 50), read once per run, for the Stage Analysis' Mansfield RS.
  // If Yahoo does not answer, the companies still get their stage and SATA; Mansfield RS (and its two SATA points) stay empty.
  let bench: Map<string, number> | null = null;
  try {
    const br = await yahooDaily(opts.market === 'US' ? '^GSPC' : '^NSEI', 5 * 365 + 25);   // the index: 5 years are enough for the weekly RS
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
          // zzz1003 — `market` + `now`: the daily scan reads completed sessions (the market clock confirms Yahoo's own `partial`)
          store.set(t, techEntry(bars, got.firstTrade, got.partial, bench, { src: nseOf ? 'yahoo+nse-bhav' : 'yahoo', ex: got.exchange, market: opts.market, now: new Date() }));   // price figures + chart patterns from the same bars
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
  let scanned = 0, withPat = 0, short = 0, bad = 0, errs = 0, stale = 0, sw = 0, sm = 0, pw = 0, pm = 0, compat = 0;
  for (const v of store.values()) {
    // zzz1003 (PS-01) — a v5 entry keeps its daily reading during the changeover; its weekly / monthly readings are withheld
    const isCompat = v.patV != null && PATTERN_SCAN_DAILY_COMPAT.includes(v.patV);
    if (v.patV !== PATTERN_SCAN_VERSION && !isCompat) { stale++; continue; }
    if (isCompat) compat++;
    else {
      if (isScanned(v.scanW?.st)) { sw++; if (v.patW?.length) pw++; }
      if (isScanned(v.scanM?.st)) { sm++; if (v.patM?.length) pm++; }
    }
    const st = v.scan?.st;
    if (isScanned(st)) { scanned++; if (st === 'ready' && v.pat?.length) withPat++; }
    else if (st === 'insufficient-history') short++;
    else if (st === 'invalid-data') bad++;
    else if (st === 'error') errs++;
  }
  opts.notes.push(`chart patterns (Pine Screener, from the same daily bars): ${scanned} of ${store.size} companies scanned with the current pattern rules, ${withPat} show at least one pattern${short ? `, ${short} too little price history (< 30 sessions)` : ''}${bad ? `, ${bad} price data rejected` : ''}${errs ? `, ${errs} scans failed (price figures kept)` : ''}${stale ? ` — ${stale} read by an older scan version (patterns withheld until re-read with the prices)` : ''}${compat ? ` — ${compat} of the scanned were read by scan version ${PATTERN_SCAN_DAILY_COMPAT.join('/')}: their daily patterns are shown, their weekly / monthly patterns wait for the re-read` : ''}`);
  opts.notes.push(`weekly / monthly chart patterns (completed weeks / months of the same daily bars): ${sw} companies scanned weekly (${pw} with a pattern), ${sm} monthly (${pm} with a pattern) — about 10 years of daily history is read for the monthly scan (up to ${MONTHLY_HISTORY_REQ} monthly bars; at least 24 completed months needed — younger listings show "too little history" there, and a U base is read at its full 60-month length only with ~68 months of history); weekly scans read the last ~5 years`);
  opts.notes.push(setupCoverageNote(store));   // zzz1020
  return store;
}
