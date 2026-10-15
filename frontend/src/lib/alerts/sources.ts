// zzz1054 — where the price-alert checker gets its data (server only).
//
//   lists       — the owner's saved data in Postgres user_state (chart watchlists, /watchlists list, India book, Conviction
//                 Beats India / US), kept 5 minutes in memory; the US book (Redis-primary store) kept 10 minutes. So list
//                 alerts follow their list's current members within minutes, and Redis is read at most ~6 times an hour.
//   live quotes — Yahoo spark batches (lib/yahoo fetchYahooSparkBatch; 20 symbols a request), India .NS / .BO and US symbols.
//   daily bars  — Yahoo daily chart (2 years) once per ticker per market day, turned into completed-bar figures
//                 (conditions.ts figuresFromBars), kept in memory and in Postgres price_alert_daily.
import { fetchYahooSparkBatch } from '@/lib/yahoo';
import { barsFromYahoo } from '@/lib/screener/tech';
import { expandTarget, sourcesNeeded, type TargetSources, type Expanded } from './targets';
import { yahooSymbol, parseMid, type AlertTarget } from './types';
import { figuresFromBars, type DailyFigs, type LiveQuote } from './conditions';

const LIST_TTL_MS = 5 * 60_000;
const US_BOOK_TTL_MS = 10 * 60_000;
type Cached = { at: number; value: unknown };
const g = globalThis as any;
const srcCache: Map<keyof TargetSources, Cached> = g.__MC_PA_SRC__ || (g.__MC_PA_SRC__ = new Map());

const USER_KEYS: Partial<Record<keyof TargetSources, string>> = {
  chartStore: 'mc:chart-watchlists:v1', watchlist: 'mc_watchlist_tickers', holdingsIn: 'mc_portfolio_holdings',
  cbIn: 'mc:conviction-beats:v1', cbUs: 'mc:conviction-beats-us:v1',
};

async function readSource(k: keyof TargetSources): Promise<unknown> {
  const hit = srcCache.get(k);
  const ttl = k === 'usBook' ? US_BOOK_TTL_MS : LIST_TTL_MS;
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  let value: unknown = null;
  try {
    if (k === 'usBook') {
      const [{ readUsBook, US_BOOK_OWNER }, { thesisUniverse }, { usBookHoldings }] = await Promise.all([
        import('@/lib/us-book-store'), import('@/lib/us-book/model'), import('@/lib/fundamentals/universe'),
      ]);
      const { book, error } = await readUsBook(US_BOOK_OWNER);
      value = error ? null : usBookHoldings(thesisUniverse(book)).held.map((h) => h.symbol);
    } else {
      const { getUserState } = await import('@/lib/user-state-store');
      const row = await getUserState(USER_KEYS[k] as any);
      value = row ? row.value : null;
    }
  } catch { value = hit?.value ?? null; }   // keep the last good copy on a failed read
  srcCache.set(k, { at: Date.now(), value });
  return value;
}

/** Reads only the sources these targets need. */
export async function readTargetSources(targets: readonly AlertTarget[]): Promise<TargetSources> {
  const need = sourcesNeeded(targets);
  const out: TargetSources = {};
  await Promise.all([...need].map(async (k) => { (out as any)[k] = await readSource(k); }));
  return out;
}
/** Expands every target (members right now). */
export async function expandAll(targets: readonly AlertTarget[]): Promise<Expanded[]> {
  const src = await readTargetSources(targets);
  return targets.map((t) => expandTarget(t, src));
}
/** Forget cached lists (after the owner edits a list, the next check reads it again). */
export function clearSourceCache(): void { srcCache.clear(); }

// ── live quotes ─────────────────────────────────────────────────────────────

/** Live quotes for market-qualified ids. A missing or unusable quote is simply absent (its alerts wait). */
export async function fetchLiveQuotes(mids: readonly string[]): Promise<Map<string, LiveQuote & { extPct?: number | null }>> {
  const bySym = new Map<string, string>();
  for (const m of mids) { const s = yahooSymbol(m); if (s) bySym.set(s, m); }
  const out = new Map<string, LiveQuote & { extPct?: number | null }>();
  if (!bySym.size) return out;
  const got = await fetchYahooSparkBatch([...bySym.keys()], true).catch(() => new Map());
  for (const [sym, mid] of bySym) {
    const q = got.get(sym);
    if (!q || typeof q.lastPrice !== 'number' || !(q.lastPrice > 0)) continue;
    out.set(mid, {
      price: q.lastPrice, prevClose: q.prevClose ?? null, volume: q.volume ?? null, dayHigh: q.dayHigh ?? null, dayLow: q.dayLow ?? null,
      marketTime: q.marketTime ?? null, name: q.companyName ?? null, extPct: q.extPct ?? null,
    });
  }
  return out;
}

// ── daily bars → figures ────────────────────────────────────────────────────

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Accept: 'application/json' };
/** Daily bars for one id → figures for `today` (that market's date). null on any failure. */
export async function fetchDailyFigs(mid: string, today: string): Promise<DailyFigs | null> {
  const sym = yahooSymbol(mid);
  if (!sym || !parseMid(mid)) return null;
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d&includePrePost=false`, { headers: UA, signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!r.ok) return null;
    const parsed = barsFromYahoo(await r.json());
    return parsed ? figuresFromBars(parsed.bars, today) : null;
  } catch { return null; }
}
