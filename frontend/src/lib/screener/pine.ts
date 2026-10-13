// zzz983 — PINE SCREENER (our own, like TradingView's Pine Screener): which companies' charts show a pattern right now.
//
// How patterns get into the data: the screener builds (us-build.ts / in-build.ts) already download ~5 years of Yahoo daily
// bars per company for the price figures (tech-fetch.ts). While those bars are in memory, `techEntry` below also runs the
// chart-pattern engine (lib/chart-patterns.ts — the same one the chart's pattern line uses) and keeps the hits with
// likelihood ≥ 35 as compact tags next to the price figures. The tags are stored with the price figures (one database row per
// market), so a company that is not re-read in a run keeps its last tags; `patAt` is the date of the last bar the patterns
// were read from (a pattern is "as of" that close — or, when read during a session, that day's live bar).
// `patV` is the version of this scan: an entry without the current version is re-read on the next build.
//
// The rest of this file is pure: the filters the page applies (bias / sub-pattern / stage / likelihood / distance to the
// pivot / liquidity), counts per pattern for the chips, and the cleaning of saved Pine screens.
import { detectPatterns, toTags, PATTERN_META, PATTERN_IDS, type PatternId, type PatternTag, type PBar } from '../chart-patterns';
import { techFigures, closedFigures, type DailyBars } from './tech';
import { passes, cleanScreens, fieldOf, type Filter, type NumKey } from './filters';
import type { ScreenMarket, ScreenRow } from './types';
import type { TechStored } from './tech-fetch';
import { tvFigures, rsRatings, type TvFigures } from './tv-screens';

/** Bump when the engine or the stored tag changes: every stored entry without it is re-read on the next build. */
export const PATTERN_SCAN_VERSION = 4;   // 2 = zzz984: + the owner's TradingView indicator fields (tv-screens.ts); 3 = zzz987: + Stage Analysis (TheWrap method); 4 = zzz990: chart-pattern audit (volume missingness, IPO first base + listing date, projected sloped boundaries, strict HTF)
/** Only hits at least this likely are stored (the engine's own floor is 35 as well). */
export const PATTERN_MIN_STORE = 35;

/** A stored pattern: the engine's compact tag plus its length in trading days (`l`) and depth % (`dp`). */
export interface ScreenPatternTag extends PatternTag { l?: number; dp?: number | null }

const DAY = 86_400_000;

/** The chart patterns the latest bars are forming (or just broke out of / failed), as stored on a screener row. Never throws. */
export function patternsFromBars(b: DailyBars, ipoD: number | null | undefined): { pat: ScreenPatternTag[]; patAt: string | null } {
  const n = b.c.length;
  if (!n) return { pat: [], patAt: null };
  try {
    const bars: PBar[] = new Array(n);
    for (let i = 0; i < n; i++) bars[i] = { t: Date.parse(`${b.d[i]}T00:00:00Z`), o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] };
    const hits = detectPatterns(bars, ipoD != null && Number.isFinite(ipoD) ? { firstTradeT: ipoD * DAY } : undefined);
    const tags = toTags(hits);
    const pat: ScreenPatternTag[] = [];
    hits.forEach((h, k) => {
      const t = tags[k];
      if (t.c < PATTERN_MIN_STORE) return;
      pat.push({ ...t, l: h.lengthBars, dp: h.depthPct });
    });
    return { pat, patAt: b.d[n - 1] };
  } catch {
    return { pat: [], patAt: b.d[n - 1] };   // a pattern failure never costs the company its price figures
  }
}

/** What the screener build keeps per company from one download of its daily bars: price figures + chart patterns. */
/** `bench` (zzz987) = the market index's weekly closes by week key, for the Mansfield RS of the Stage Analysis. */
export function techEntry(bars: DailyBars, firstTradeSec: number | null, partial?: boolean, bench?: ReadonlyMap<string, number> | null): TechStored {
  const ipoD = firstTradeSec != null ? Math.floor((firstTradeSec * 1000) / DAY) : null;
  const cc = partial ? closedFigures(bars) : null;
  const p = patternsFromBars(bars, ipoD);
  let tv: Partial<TvFigures> = {};
  try { tv = tvFigures(bars, bench); } catch { /* never costs the price figures */ }
  return { ...techFigures(bars), ipoD, ...(cc ? { cc } : {}), pat: p.pat, patAt: p.patAt, patV: PATTERN_SCAN_VERSION, ...tv };
}

/** The pattern fields a screener row carries, from a stored entry (nothing when the entry predates the pattern scan). */
export function rowPatternFields(tf: TechStored | undefined): Pick<ScreenRow, 'pat' | 'patAt'> {
  if (!tf || tf.patV == null) return {};
  return { ...(tf.pat?.length ? { pat: tf.pat } : {}), ...(tf.patAt ? { patAt: tf.patAt } : {}) };
}

/** zzz984 — the TradingView-script fields a row carries (entries read before scan version 2 carry none). `adv$` = average daily
 *  traded value in the market's money unit ($ million / ₹ crore). The RS Rating is ranked later, over the whole snapshot. */
export const TV_ROW_KEYS = ['tt', 'ttOk', 'rsiMA', 'rsiX', 'gcD', 'dcD', 'emaXU', 'emaXD', 'stage', 'st12', 'ppD', 'rvol', 'ripB', 'twSt', 'sata', 'mrs', 'twWk'] as const;
export function rowTvFields(tf: TechStored | undefined, market: ScreenMarket): Partial<ScreenRow> {
  if (!tf || !(typeof tf.patV === 'number' && tf.patV >= 2)) return {};
  const o: Partial<ScreenRow> = {};
  for (const k of TV_ROW_KEYS) { const v = (tf as any)[k]; if (v != null) (o as any)[k] = v; }
  if (typeof tf.adv === 'number') o['adv$'] = Math.round((tf.adv / (market === 'US' ? 1e6 : 1e7)) * 100) / 100;
  return o;
}
/** zzz984 — RS Rating 1–99 for every row of one market's snapshot, from the stored weighted performance (`rsRaw`). */
export function applyRsRating(rows: ScreenRow[], rawOf: (t: string) => number | null | undefined): void {
  const rank = rsRatings(rows.map((r) => ({ t: r.t, v: rawOf(r.t) })));
  for (const r of rows) { const v = rank.get(r.t); if (v != null) r.rsR = v; }
}
/** zzz984 — the owner's "Revenue Growth YoY + FCF Margin" (custom Rule of 40): latest quarter's revenue growth + FCF margin. */
/** zzz991 — left blank when an input is not meaningful, so a company cannot pass on an artefact of a tiny sales base:
 *  revenue growth above +300% (growth from almost nothing) or an FCF margin outside −100%…+100% (cash flow larger than
 *  all sales). Example: MOVE, growth +3,590% and FCF margin −2,602%, summed to +988% and passed "≥ 40". */
export const R40_MAX_GROWTH = 300, R40_MAX_ABS_FCFM = 100;
export function ruleOf40Usable(revQYoY: number | null | undefined, fcfm: number | null | undefined): boolean {
  return fin(revQYoY) && fin(fcfm) && revQYoY <= R40_MAX_GROWTH && Math.abs(fcfm) <= R40_MAX_ABS_FCFM;
}
export function ruleOf40(revQYoY: number | null | undefined, fcfm: number | null | undefined): number | null {
  return ruleOf40Usable(revQYoY, fcfm) ? Math.round(((revQYoY as number) + (fcfm as number)) * 10) / 10 : null;
}

// ── the page's filters (pure) ─────────────────────────────────────────────────────────────────────────────────────────
export type PineBias = 'U' | 'D' | 'both';
export type PineStage = 'f' | 'b' | 'x';
export type PerfKey = 'perf1M' | 'perf3M' | 'perf6M' | 'perf1Y';
export const STAGES: ReadonlyArray<{ id: PineStage; label: string; tip: string }> = [
  { id: 'f', label: 'Forming', tip: 'No close beyond the pivot yet' },
  { id: 'b', label: 'Breakout', tip: 'First close beyond the pivot within the last 5 sessions (bearish: breakdown)' },
  { id: 'x', label: 'Failed', tip: 'Broke out within the last 40 sessions and is now more than 7.5% back through the pivot' },
];
export const LIKELIHOODS: ReadonlyArray<{ min: number; label: string }> = [
  { min: 35, label: 'Possible or better' }, { min: 55, label: 'Likely or better' }, { min: 75, label: 'Very likely' },
];
export const likelihoodWord = (c: number) => (c >= 75 ? 'very likely' : c >= 55 ? 'likely' : 'possible');

export interface PineQuery {
  bias: PineBias;
  /** sub-patterns ticked (empty = every pattern of the chosen bias) */
  ids: PatternId[];
  stages: PineStage[];
  /** likelihood floor, 35 / 55 / 75 */
  minConf: number;
  /** distance to the pivot in the pattern's direction, %: − = not reached yet, + = beyond it (bearish: below the breakdown level) */
  dist: { on: boolean; lo: number; hi: number };
  mcMin: number | null; mcMax: number | null;   // market cap: $ million / ₹ crore
  pxMin: number | null;
  turnMin: number | null;                      // average daily traded value: $ million / ₹ crore
  perfKey: PerfKey; perfMin: number | null;     // relative strength: performance over the period ≥
  sectors: string[];                            // TradingView sectors (empty = all)
  /** extra rules in the Stock Screener's own filter language (e.g. the trend template) */
  filters: Filter[];
  /** zzz984 — 'pattern': a company must show a matching chart pattern; 'any': the rules alone decide (patterns still shown) */
  need: 'pattern' | 'any';
  /** zzz984 — extra columns shown in the result table (Stock Screener field keys) */
  cols: NumKey[];
}
/** zzz984 — the extra columns the owner can switch on (the TradingView-script fields first). */
export const OPTIONAL_COLS: readonly NumKey[] = ['tt', 'rsR', 'stage', 'twSt', 'sata', 'mrs', 'twWk', 'r40', 'revQYoY', 'fcfmTTM', 'rsiMA', 'rsiX', 'gcD', 'dcD', 'emaXU', 'emaXD', 'ppD', 'rvol', 'adv$', 'adrP', 'ripB', 'ttOk', 'st12', 'perf1M', 'perf6M', 'perf1Y'];

export const DEFAULT_QUERY: PineQuery = {
  bias: 'U', ids: [], stages: ['f', 'b'], minConf: 55, dist: { on: true, lo: -15, hi: 5 },
  mcMin: null, mcMax: null, pxMin: null, turnMin: null, perfKey: 'perf3M', perfMin: null, sectors: [], filters: [],
  need: 'pattern', cols: [],
};

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBull = (t: PatternTag) => t.b === 'U';
/** Distance in the pattern's direction (bullish: close vs pivot; bearish: the mirror). */
export const dirDist = (t: PatternTag): number | null => (t.d == null ? null : isBull(t) ? t.d : -t.d);

/** The row's pattern tags that pass the pattern part of the query. */
export function matchTags(row: Pick<ScreenRow, 'pat'>, q: Pick<PineQuery, 'bias' | 'ids' | 'stages' | 'minConf' | 'dist'>): ScreenPatternTag[] {
  const pat = Array.isArray(row.pat) ? row.pat : [];
  if (!pat.length) return [];
  const ids = q.ids.length ? new Set<string>(q.ids) : null;
  return pat.filter((t) => {
    if (!t || !PATTERN_META[t.id]) return false;
    if (q.bias !== 'both' && t.b !== q.bias) return false;
    if (ids && !ids.has(t.id)) return false;
    if (q.stages.length && !q.stages.includes(t.s)) return false;
    if (!(t.c >= q.minConf)) return false;
    if (q.dist.on) {
      const d = dirDist(t);
      if (d == null || d < Math.min(q.dist.lo, q.dist.hi) || d > Math.max(q.dist.lo, q.dist.hi)) return false;
    }
    return true;
  });
}

/** Average daily traded value in the market's money unit ($ million / ₹ crore), from price × 30-day (else 10-day) volume. */
export function turnoverOf(r: Pick<ScreenRow, 'px' | 'avgVol30' | 'avgVol10'>, market: ScreenMarket): number | null {
  const v = fin(r.avgVol30) ? r.avgVol30 : fin(r.avgVol10) ? r.avgVol10 : null;
  if (!fin(r.px) || v == null) return null;
  return (r.px * v) / (market === 'US' ? 1e6 : 1e7);
}

/** The company part of the query (liquidity, size, strength, sector, extra rules). */
export function passesCompany(r: ScreenRow, q: PineQuery, market: ScreenMarket, now: Date = new Date()): boolean {
  if (q.mcMin != null && !(fin(r.mc) && r.mc >= q.mcMin)) return false;
  if (q.mcMax != null && !(fin(r.mc) && r.mc <= q.mcMax)) return false;
  if (q.pxMin != null && !(fin(r.px) && r.px >= q.pxMin)) return false;
  if (q.turnMin != null) { const t = turnoverOf(r, market); if (t == null || t < q.turnMin) return false; }
  if (q.perfMin != null) { const p = r[q.perfKey]; if (!fin(p) || p < q.perfMin) return false; }
  if (q.sectors.length && !(r.tvSec && q.sectors.includes(r.tvSec))) return false;
  return q.filters.every((f) => passes(r, f, now));
}

/** `best` is null only for a company that passed a rules-only screen (need 'any') without a matching pattern. */
export interface PineHit { row: ScreenRow; tags: ScreenPatternTag[]; best: ScreenPatternTag | null }
/** Strongest first; a breakout beats a forming / failed reading of the same strength. */
export function bestTag(tags: readonly ScreenPatternTag[]): ScreenPatternTag {
  const rank = (t: ScreenPatternTag) => t.c + (t.s === 'b' ? 0.5 : t.s === 'x' ? -0.5 : 0);
  return tags.reduce((a, b) => (rank(b) > rank(a) ? b : a));
}
export function runPine(rows: readonly ScreenRow[], q: PineQuery, market: ScreenMarket, now: Date = new Date()): PineHit[] {
  const out: PineHit[] = [];
  for (const r of rows) {
    const tags = matchTags(r, q);
    if ((q.need !== 'any' && !tags.length) || !passesCompany(r, q, market, now)) continue;
    tags.sort((a, b) => b.c - a.c);
    out.push({ row: r, tags, best: tags.length ? bestTag(tags) : null });
  }
  return out;
}

/** For the chips: per pattern, how many companies pass everything else in the query with that pattern (sub-pattern and bias
 *  choices ignored, so every chip shows its own number). */
export function patternCounts(rows: readonly ScreenRow[], q: PineQuery, market: ScreenMarket, now: Date = new Date()): Record<PatternId, number> {
  const out = Object.fromEntries(PATTERN_IDS.map((id) => [id, 0])) as Record<PatternId, number>;
  const open = { ...q, ids: [], bias: 'both' as const };
  for (const r of rows) {
    const tags = matchTags(r, open);
    if (!tags.length || !passesCompany(r, q, market, now)) continue;
    for (const id of new Set(tags.map((t) => t.id))) out[id]++;
  }
  return out;
}

/** Pattern groups for the chips, in the engine's order: bullish groups first, then bearish. */
export function patternGroups(bias: PineBias): Array<{ group: string; bias: 'bullish' | 'bearish'; ids: PatternId[] }> {
  const out: Array<{ group: string; bias: 'bullish' | 'bearish'; ids: PatternId[] }> = [];
  for (const b of ['bullish', 'bearish'] as const) {
    if (bias === 'U' && b === 'bearish') continue;
    if (bias === 'D' && b === 'bullish') continue;
    for (const id of PATTERN_IDS) {
      const m = PATTERN_META[id];
      if (m.bias !== b) continue;
      let g = out.find((x) => x.group === m.group && x.bias === b);
      if (!g) { g = { group: m.group, bias: b, ids: [] }; out.push(g); }
      g.ids.push(id);
    }
  }
  return out;
}

// ── the lean rows the page downloads (only companies with a pattern) ──────────────────────────────────────────────────
/** Fields sent to the Pine Screener page. Every field a built-in Pine screen's extra rules read must be here (tested). */
export const LEAN_KEYS = [
  't', 'n', 'sec', 'ind', 'tvSec', 'exch', 'px', 'chg', 'mc', 'vol', 'avgVol10', 'avgVol30', 'sma50', 'sma150', 'sma200', 'ema21', 'hi52',
  'rsi', 'adrP', 'perf1W', 'perf1M', 'perf3M', 'perf6M', 'perfYTD', 'perf1Y', 'q', 'ipoD', 'earnD', 'pat', 'patAt',
  // zzz984 — the TradingView-script fields and the Rule of 40 parts
  'tt', 'ttOk', 'rsR', 'rsiMA', 'rsiX', 'gcD', 'dcD', 'emaXU', 'emaXD', 'stage', 'st12', 'ppD', 'rvol', 'adv$', 'ripB', 'revQYoY', 'fcfmTTM', 'r40', 'approx',
  // zzz987 — Stage Analysis (TheWrap method)
  'twSt', 'sata', 'mrs', 'twWk',
] as const satisfies ReadonlyArray<keyof ScreenRow>;
export function leanRow(r: ScreenRow): Partial<ScreenRow> & { live?: 1 } {
  const o: Record<string, unknown> = {};
  for (const k of LEAN_KEYS) { const v = (r as any)[k]; if (v != null) o[k] = v; }
  if (r.cc) o.live = 1;   // read during a session: the latest bar (and its patterns) is the live, unfinished day
  return o as Partial<ScreenRow> & { live?: 1 };
}
/** zzz984 — every company is sent (rules-only screens need them all); `patternsOnly` keeps the companies with a pattern. */
export function leanRows(rows: readonly ScreenRow[], bias?: 'U' | 'D' | null, patternsOnly = false): { rows: Array<Partial<ScreenRow>>; total: number; scanned: number; withPattern: number; patAt: string | null } {
  let scanned = 0, withPattern = 0;
  const dates = new Map<string, number>();
  const out: Array<Partial<ScreenRow>> = [];
  for (const r of rows) {
    if (r.patAt) { scanned++; dates.set(r.patAt, (dates.get(r.patAt) || 0) + 1); }
    const pat = Array.isArray(r.pat) ? r.pat.filter((t) => t && PATTERN_META[t.id] && (!bias || t.b === bias)) : [];
    if (pat.length) withPattern++;
    else if (patternsOnly) continue;
    const lr = leanRow(r);
    // zzz991 — snapshots built before the guard: recompute so a tiny-base artefact never passes a Rule of 40 rule
    if (lr.r40 != null && !ruleOf40Usable(r.revQYoY, r.fcfmTTM)) lr.r40 = null;
    if (pat.length) lr.pat = pat; else delete lr.pat;
    out.push(lr);
  }
  const patAt = Array.from(dates.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0]?.[0] || null;
  return { rows: out, total: rows.length, scanned, withPattern, patAt };
}

// ── saved Pine screens ────────────────────────────────────────────────────────────────────────────────────────────────
export const PINE_SCREENS_KEY = 'mc:pine-screens:v1';
/** zzz984 — where a built-in screen is listed: the owner's own TradingView scripts, chart patterns, momentum & trend. */
export type PineGroup = 'tv' | 'patterns' | 'momentum';
export const PINE_GROUPS: ReadonlyArray<{ id: PineGroup; label: string }> = [
  { id: 'tv', label: 'Your TradingView screens' }, { id: 'patterns', label: 'Chart patterns' }, { id: 'momentum', label: 'Momentum & trend' },
];
export interface PineScreen { id: string; name: string; note?: string; market?: ScreenMarket; q: PineQuery; builtIn?: boolean; group?: PineGroup }

const numOrNull = (v: unknown, lo = -1e15, hi = 1e15) => (fin(v) && v >= lo && v <= hi ? v : null);
/** Pure clean-up of a stored / pasted query: anything unknown falls back to the default. */
export function cleanQuery(raw: unknown): PineQuery {
  const x = (raw && typeof raw === 'object' ? raw : {}) as any;
  const d = DEFAULT_QUERY;
  const ids = Array.isArray(x.ids) ? x.ids.filter((i: unknown): i is PatternId => typeof i === 'string' && i in PATTERN_META) : [];
  const stages = Array.isArray(x.stages) ? x.stages.filter((s: unknown): s is PineStage => s === 'f' || s === 'b' || s === 'x') : d.stages;
  const dist = x.dist && typeof x.dist === 'object' && fin(x.dist.lo) && fin(x.dist.hi) ? { on: x.dist.on !== false, lo: x.dist.lo, hi: x.dist.hi } : d.dist;
  const filters = Array.isArray(x.filters) ? cleanScreens([{ id: 'q', name: 'q', market: 'US', filters: x.filters }])[0]?.filters || [] : [];
  return {
    bias: x.bias === 'D' || x.bias === 'both' ? x.bias : 'U',
    ids: Array.from(new Set<PatternId>(ids)).slice(0, PATTERN_IDS.length),
    stages: Array.from(new Set<PineStage>(stages)),
    minConf: fin(x.minConf) ? Math.min(100, Math.max(35, x.minConf)) : d.minConf,
    dist,
    mcMin: numOrNull(x.mcMin, 0), mcMax: numOrNull(x.mcMax, 0), pxMin: numOrNull(x.pxMin, 0), turnMin: numOrNull(x.turnMin, 0),
    perfKey: ['perf1M', 'perf3M', 'perf6M', 'perf1Y'].includes(x.perfKey) ? x.perfKey : d.perfKey,
    perfMin: numOrNull(x.perfMin, -100, 100000),
    sectors: Array.isArray(x.sectors) ? x.sectors.filter((s: unknown) => typeof s === 'string').slice(0, 40) : [],
    filters,
    need: x.need === 'any' ? 'any' : 'pattern',
    cols: Array.isArray(x.cols) ? Array.from(new Set<NumKey>(x.cols.filter((k: unknown): k is NumKey => typeof k === 'string' && !!fieldOf(k)))).slice(0, 30) : [],
  };
}
export function cleanPineScreens(raw: unknown): PineScreen[] {
  if (!Array.isArray(raw)) return [];
  const out: PineScreen[] = [];
  for (const s of raw.slice(0, 100)) {
    if (!s || typeof s !== 'object') continue;
    const x = s as any;
    if (typeof x.id !== 'string' || typeof x.name !== 'string' || !x.name.trim()) continue;
    out.push({ id: x.id.slice(0, 60), name: x.name.slice(0, 80), ...(x.market === 'US' || x.market === 'IN' ? { market: x.market } : {}), q: cleanQuery(x.q) });
  }
  return out;
}

/** zzz989 — "show data first": what the stored snapshot can answer right now. A rule whose figure no company has yet (a field
 *  added by a newer build that has not run) is PAUSED instead of emptying the list, and a "chart pattern required" choice is
 *  dropped while the market has not been scanned for patterns. The page names every paused rule; nothing is hidden. */
export interface Available { q: PineQuery; paused: NumKey[]; patternsPaused: boolean }
const filterKeys = (f: Filter): NumKey[] => (f.kind === 'num' || f.kind === 'date' ? [f.key] : f.kind === 'cmp' || f.kind === 'near' ? [f.key, f.other] : []);
export function availableQuery(rows: readonly ScreenRow[], q: PineQuery, scanned: number): Available {
  const has = new Map<NumKey, boolean>();
  const present = (k: NumKey): boolean => {
    let v = has.get(k);
    if (v === undefined) { v = rows.some((r) => (r as any)[k] != null); has.set(k, v); }
    return v;
  };
  const paused: NumKey[] = [];
  const filters = q.filters.map((f) => {
    if ((f as { off?: boolean }).off || !rows.length) return f;
    const miss = filterKeys(f).filter((k) => !present(k));
    if (!miss.length) return f;
    for (const k of miss) if (!paused.includes(k)) paused.push(k);
    return { ...f, off: true } as Filter;
  });
  const patternsPaused = q.need !== 'any' && rows.length > 0 && scanned === 0 && !rows.some((r) => r.pat?.length);
  return { q: { ...q, filters, ...(patternsPaused ? { need: 'any' as const } : {}) }, paused, patternsPaused };
}

/** zzz989 — the watchlist / bench link: keep only the companies on a chosen list (null = every company). */
export function onList(hits: PineHit[], tickers: ReadonlySet<string> | null): PineHit[] {
  return tickers ? hits.filter((h) => tickers.has(h.row.t.toUpperCase())) : hits;
}
