// zzz1032 — server side of the screener's "Latest result" column: reads the graded Earnings Opportunities days of the last ~100
// days (cache only — nothing is graded here) and the server Conviction Beats bench, and builds one small record per company
// (lib/screener/latest-result.ts). Built at most once every 30 minutes per market (memory, then KV for other instances), one
// build at a time; a request never waits on more than one build.
import { kvGet, kvSet, kvMGet, kvExistsMany } from '@/lib/kv';
import { scanGradedDays } from '@/lib/bench-scan';
import { gradedKeyCandidates, GRADED_CACHE_VERSION } from '@/lib/graded-cache-key';
import { withCurrentIndiaRules } from '@/lib/india-regrade';
import { loadUsSessions } from '@/lib/guidance-upgrades-candidates';
import { regradeDayPayload } from '@/lib/us-regrade';
import { US_ENGINE_VERSION, US_ENGINE_PREVIOUS_VERSIONS } from '@/lib/us-engine-version';
import { buildLatestResultIndex, marketToday, type GradedDay, type LatestResultIndex } from './latest-result';

export const RESULT_SCAN_DAYS = 100;          // calendar days of graded results read
export const RESULT_TTL_MS = 30 * 60_000;     // a built index is reused for 30 minutes
const PARTIAL_TTL_MS = 5 * 60_000;            // … 5 minutes when the scan ran out of time
const SCAN_BUDGET_MS = 25_000;
export const resultKvKey = (market: 'US' | 'IN') => `pine-latest-result:v1:${market}`;

export interface ResultPayload {
  market: 'US' | 'IN'; at: string; today: string; days: number;
  /** graded days found / older-engine days used / dates not reached in time */
  graded: number; legacy: number; partial: boolean;
  bench: number; byName: number; count: number;
  results: LatestResultIndex;
}

/** Calendar dates newest first (`n` days ending `today`). */
export function scanDates(today: string, n: number, weekdaysOnly = false): string[] {
  const out: string[] = [];
  const t0 = Date.parse(`${today}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    const d = new Date(t0 - i * 86_400_000);
    if (weekdaysOnly && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const rowCount = (p: any): number => (!p?.by_tier ? 0 : Object.values(p.by_tier).reduce((n: number, v: any) => n + (Array.isArray(v) ? v.length : 0), 0));

/** zzz1032 — a graded day reduced to the fields the index reads. Days older than FRESH_DAYS are kept in memory for DAY_TTL_MS, so a
 *  rebuild re-reads only the last few days from KV (a settled day does not change; it is re-read twice a day anyway). */
const SLIM_KEYS = ['ticker', 'company', 'tier', 'filing_date', 'quarter', 'fiscal_year', 'sales_yoy_pct', 'net_profit_yoy_pct', 'eps_yoy_pct', 'composite_score', 'quality', 'seen_date'] as const;
export function slimDay(p: any): any {
  const by_tier: Record<string, any[]> = {};
  for (const [t, rows] of Object.entries(p?.by_tier || {})) {
    if (!Array.isArray(rows)) continue;
    by_tier[t] = rows.map((r: any) => { const o: Record<string, unknown> = {}; for (const k of SLIM_KEYS) if (r?.[k] != null) o[k] = r[k]; return o; });
  }
  return { by_tier };
}
const FRESH_DAYS = 4;
const DAY_TTL_MS = 12 * 3600_000;
const dayCache = new Map<string, { at: number; payload: any | null }>();   // `${market}:${date}` → slim payload (null = nothing graded)
/** Split the dates into cached settled days and the dates to read. */
function fromCache(market: 'US' | 'IN', dates: string[]): { cached: GradedDay[]; read: string[] } {
  const cached: GradedDay[] = [], read: string[] = [];
  dates.forEach((d, i) => {
    const c = i >= FRESH_DAYS ? dayCache.get(`${market}:${d}`) : undefined;
    if (c && Date.now() - c.at < DAY_TTL_MS) { if (c.payload) cached.push({ date: d, payload: c.payload }); }
    else read.push(d);
  });
  return { cached, read };
}
const remember = (market: 'US' | 'IN', date: string, payload: any | null) => { if (dayCache.size > 600) dayCache.clear(); dayCache.set(`${market}:${date}`, { at: Date.now(), payload }); };

async function readIndia(today: string): Promise<{ days: GradedDay[]; legacy: number; partial: boolean }> {
  const { cached, read } = fromCache('IN', scanDates(today, RESULT_SCAN_DAYS));
  if (!read.length) return { days: cached, legacy: 0, partial: false };
  const scan = await scanGradedDays(read, {
    candidates: gradedKeyCandidates, exists: kvExistsMany, mget: (keys) => kvMGet<any>(keys), rowCount,
    adopt: (hit, key) => withCurrentIndiaRules(hit, key), isCurrent: (key) => key.startsWith(`graded:${GRADED_CACHE_VERSION}:`), now: Date.now,
  }, Date.now() + SCAN_BUDGET_MS);
  const days = scan.days.map((d) => ({ date: d.date, payload: slimDay(d.payload) }));
  const got = new Map(days.map((d) => [d.date, d.payload]));
  for (const d of read) if (!scan.skipped.includes(d)) remember('IN', d, got.get(d) ?? null);
  return { days: [...days, ...cached], legacy: scan.days.filter((d) => d.legacy).length, partial: scan.partial };
}
async function readUs(today: string): Promise<{ days: GradedDay[]; legacy: number; partial: boolean }> {
  const { cached, read } = fromCache('US', scanDates(today, RESULT_SCAN_DAYS, true));
  if (!read.length) return { days: cached, legacy: 0, partial: false };
  const t0 = Date.now();
  const s = await loadUsSessions(read, [US_ENGINE_VERSION, ...US_ENGINE_PREVIOUS_VERSIONS], (keys) => kvMGet<any>(keys), 6, { concurrency: 4, budgetMs: SCAN_BUDGET_MS });
  const timedOut = Date.now() - t0 >= SCAN_BUDGET_MS;
  // an older engine's day is regraded in-process (the graded-US route does the same), so its grade follows the current rules
  const days = s.rows.map((r) => ({ date: r.date, payload: slimDay(r.version === US_ENGINE_VERSION ? r.payload : (() => { try { return regradeDayPayload(r.payload) ?? r.payload; } catch { return r.payload; } })()) }));
  const got = new Map(days.map((d) => [d.date, d.payload]));
  for (const d of read) if (got.has(d) || !timedOut) remember('US', d, got.get(d) ?? null);
  return { days: [...days, ...cached], legacy: s.olderEngine, partial: timedOut && s.warm < read.length };
}

/** Build the index for one market (no cache). `universe` = the screener's companies (ticker + name). */
export async function buildResultPayload(market: 'US' | 'IN', universe: ReadonlyArray<{ t: string; n?: string | null }> | null): Promise<ResultPayload> {
  const today = marketToday(market);
  const [graded, benchDoc] = await Promise.all([
    (market === 'IN' ? readIndia(today) : readUs(today)).catch(() => ({ days: [] as GradedDay[], legacy: 0, partial: true })),
    kvGet<any>(market === 'IN' ? 'bench:server:v1' : 'bench:us:server:v1').catch(() => null),
  ]);
  const bench = Array.isArray(benchDoc?.entries) ? benchDoc.entries : [];
  const { index, byName } = buildLatestResultIndex({ days: graded.days, bench, today, universe, byNameMatch: market === 'IN' });
  return { market, at: new Date().toISOString(), today, days: RESULT_SCAN_DAYS, graded: graded.days.length, legacy: graded.legacy, partial: graded.partial, bench: bench.length, byName, count: Object.keys(index).length, results: index };
}

const mem = new Map<string, { at: number; ttl: number; p: ResultPayload }>();
const inflight = new Map<string, Promise<ResultPayload>>();
/** The cached index (memory → KV → build). `universe` is read only when a build is needed. */
export async function getResultPayload(market: 'US' | 'IN', universe: () => Promise<ReadonlyArray<{ t: string; n?: string | null }> | null>): Promise<ResultPayload> {
  const m = mem.get(market);
  if (m && Date.now() - m.at < m.ttl) return m.p;
  const running = inflight.get(market);
  if (running) return running;
  const job = (async () => {
    const kv = await kvGet<ResultPayload>(resultKvKey(market)).catch(() => null);
    if (kv && kv.results && typeof kv.at === 'string' && kv.today === marketToday(market) && Date.now() - Date.parse(kv.at) < (kv.partial ? PARTIAL_TTL_MS : RESULT_TTL_MS)) {
      mem.set(market, { at: Date.parse(kv.at), ttl: kv.partial ? PARTIAL_TTL_MS : RESULT_TTL_MS, p: kv });
      return kv;
    }
    const p = await buildResultPayload(market, await universe().catch(() => null));
    const ttl = p.partial ? PARTIAL_TTL_MS : RESULT_TTL_MS;
    mem.set(market, { at: Date.now(), ttl, p });
    if (p.graded > 0 || p.bench > 0) void kvSet(resultKvKey(market), p, Math.ceil(ttl / 1000)).catch(() => null);
    return p;
  })().finally(() => inflight.delete(market));
  inflight.set(market, job);
  return job;
}
