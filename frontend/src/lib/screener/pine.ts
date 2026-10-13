// zzz983 — PINE SCREENER (our own, like TradingView's Pine Screener): which companies' charts show a pattern right now.
//
// How patterns get into the data: the screener builds (us-build.ts / in-build.ts) already download ~5 years of Yahoo daily
// bars per company for the price figures (tech-fetch.ts). While those bars are in memory, `techEntry` below also runs the
// chart-pattern engine (lib/chart-patterns.ts — the same one the chart's pattern line uses) and keeps the hits with
// likelihood ≥ 35 as compact tags next to the price figures. The tags are stored with the price figures (one database row per
// market), so a company that is not re-read in a run keeps its last tags; `patAt` is the date of the last bar the patterns
// were read from (a pattern is "as of" that close — or, when read during a session, that day's live bar).
// `patV` is the version of this scan: an entry without the current version is re-read on the next build.
// zzz993 (MC-02) — every entry carries `scan` (status ready / no-pattern / insufficient-history / invalid-data / error /
// stale-version, scan version, usable bars, as-of, volume coverage); only a current, ready scan exposes tags. (MC-01) — the
// entry also keeps the close it was read from (`scanPx` / `scanAt` / `scanSrc`), so the row's latest quote (`px`, which in the
// US comes from Nasdaq, not from the Yahoo bars) can be shown next to it with its own source instead of silently mixing.
//
// The rest of this file is pure: the filters the page applies (bias / sub-pattern / stage / likelihood / distance to the
// pivot / liquidity), counts per pattern for the chips, and the cleaning of saved Pine screens.
import { analyzePatterns, analyzeDailyAs, toTags, PATTERN_META, PATTERN_IDS, PATTERN_MIN_HISTORY, type PatternId, type PatternTag, type PatternAnalysis, type PBar } from '../chart-patterns';
import { techFigures, closedFigures, type DailyBars } from './tech';
import { passes, cleanScreens, fieldOf, filterKeys, filterLabel, evalPattern, patMissingWhy, tagDirDist, shapeWord, PATTERN_TFS, FIELDS, type Filter, type NumKey, type PatTf, type PatternEval } from './filters';
import type { ScreenMarket, ScreenRow } from './types';
import type { TechStored } from './tech-fetch';
import { tvFigures, rsRatings, type TvFigures } from './tv-screens';

/** Bump when the engine or the stored tag changes: every stored entry without it is re-read on the next build. */
export const PATTERN_SCAN_VERSION = 5;   // 2 = zzz984: + the owner's TradingView indicator fields (tv-screens.ts); 3 = zzz987: + Stage Analysis (TheWrap method); 4 = zzz990: chart-pattern audit (volume missingness, IPO first base + listing date, projected sloped boundaries, strict HTF); 5 = zzz993: scan status / quality (MC-02) + scan-close provenance (MC-01) + weekly / monthly patterns (patW / patM)
/** Only hits at least this likely are stored (the engine's own floor is 35 as well). */
export const PATTERN_MIN_STORE = 35;
/** zzz993 (MC-01) — latest quote and scan close further apart than this (%) on the same (or an unknown) date = vendors disagree. */
export const PX_CONFLICT_PCT = 2;
/** zzz993 (MC-01) — what the daily bars are: Yahoo's chart `close` is adjusted for splits (and bonus issues), NOT for dividends. */
export const SCAN_BASIS = 'split-adjusted price';

/** A stored pattern: the engine's compact tag plus its length in trading days (`l`) and depth % (`dp`).
 *  zzz993: `vq: 0` = the pattern's bars carry too little usable volume (engine volumeOk false — "volume not confirmed");
 *  `tf` = timeframe of the bars ('D' when absent; 'W' / 'M' for patW / patM); `dq` (only in the page's lean rows) = distance
 *  to the pivot from the LATEST QUOTE (px), %, same sign rule as `d` — `d` itself is always from the scan close. */
export interface ScreenPatternTag extends PatternTag { l?: number; dp?: number | null; vq?: 0; tf?: 'D' | 'W' | 'M'; dq?: number }

/** zzz993 (MC-02) — how a company's pattern scan went:
 *  ready = scanned, at least one pattern stored · no-pattern = scanned, nothing qualified · insufficient-history = fewer than
 *  PATTERN_MIN_BARS usable bars (nothing analysed) · invalid-data = enough bars supplied but too many rejected by validation ·
 *  error = the scan threw (price figures kept) · stale-version = read by an older scan version (tags withheld until re-read). */
export type ScanStatus = 'ready' | 'no-pattern' | 'insufficient-history' | 'invalid-data' | 'error' | 'stale-version';
/** `v` scan version (0 = unknown, snapshot rows from before zzz993) · `n` usable bars · `asOf` date of the last bar ·
 *  `vc` share 0–1 of the last 60 analysed bars with usable volume · `tf` timeframe ('D' when absent). n / asOf / vc: when known. */
export interface ScanMeta { st: ScanStatus; v: number; n?: number; asOf?: string; vc?: number; tf?: 'D' | 'W' | 'M'; e?: string }
//   `e` = the chart engine's rule-set version (PATTERN_ENGINE_VERSION) the reading was made with.
/** Statuses that count as "scanned" (a genuine reading of the chart: patterns, or a real absence of them). */
export const isScanned = (st: ScanStatus | undefined | null): boolean => st === 'ready' || st === 'no-pattern';

const DAY = 86_400_000;

const toPBars = (b: DailyBars): PBar[] => {
  const n = b.c.length, bars: PBar[] = new Array(n);
  for (let i = 0; i < n; i++) bars[i] = { t: Date.parse(`${b.d[i]}T00:00:00Z`), o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] };
  return bars;
};
/** One engine analysis → stored tags + scan status (shared by the daily and the weekly / monthly scans). */
function scanResult(a: PatternAnalysis, tf: 'D' | 'W' | 'M', asOf: string | undefined, supplied: number): { pat: ScreenPatternTag[]; scan: ScanMeta } {
  const meta: Omit<ScanMeta, 'st'> = { v: PATTERN_SCAN_VERSION, n: a.usableBars, ...(asOf ? { asOf } : {}), vc: a.volumeCoverage, ...(tf !== 'D' ? { tf } : {}), e: a.engineVersion };
  if (a.tooShort) {
    // enough bars supplied but validation threw too many out → the data is bad, not the history short
    const st: ScanStatus = a.rejectedBars > 0 && supplied >= PATTERN_MIN_HISTORY[tf] ? 'invalid-data' : 'insufficient-history';
    return { pat: [], scan: { st, ...meta } };
  }
  const tags = toTags(a.hits);
  const pat: ScreenPatternTag[] = [];
  a.hits.forEach((h, k) => {
    const t = tags[k];
    if (t.c < PATTERN_MIN_STORE) return;
    pat.push({ ...t, l: h.lengthBars, dp: h.depthPct, ...(h.volumeOk === false ? { vq: 0 as const } : {}), ...(tf !== 'D' ? { tf } : {}) });
  });
  return { pat, scan: { st: pat.length ? 'ready' : 'no-pattern', ...meta } };
}

/** The chart patterns the latest bars are forming (or just broke out of / failed), as stored on a screener row, with the scan's
 *  status (MC-02). `patAt` is set only for a genuine reading (ready / no-pattern). Never throws. */
export function patternsFromBars(b: DailyBars, ipoD: number | null | undefined): { pat: ScreenPatternTag[]; patAt: string | null; scan: ScanMeta } {
  const n = b.c.length;
  const v = PATTERN_SCAN_VERSION;
  if (!n) return { pat: [], patAt: null, scan: { st: 'insufficient-history', v, n: 0 } };
  const asOf = b.d[n - 1];
  try {
    const a = analyzePatterns(toPBars(b), ipoD != null && Number.isFinite(ipoD) ? { firstTradeT: ipoD * DAY } : undefined);
    const r = scanResult(a, 'D', asOf, n);
    return { pat: r.pat, patAt: isScanned(r.scan.st) ? asOf : null, scan: r.scan };
  } catch {
    // a pattern failure never costs the company its price figures — but it is reported as a failure, never as "no pattern"
    return { pat: [], patAt: null, scan: { st: 'error', v, asOf } };
  }
}

/** zzz993 — the same daily bars read as COMPLETED weeks ('W', ISO weeks) or months ('M', calendar months) — the current, unfinished
 *  period is left out. Tags carry tf 'W' / 'M'; their `d` is the last completed period's close vs the pivot (scan.asOf = the date of
 *  the last daily bar in that period), so W / M readings are coherent on their own bars and can lag the daily scan close.
 *  Minimum history W 30 weeks / M 24 months; the build keeps ~5 years of daily bars, so monthly scans see ~60 bars (shapes
 *  longer than that cannot be read). Never throws; a failure is status 'error' and never costs the daily scan. */
export function periodPatternsFromBars(b: DailyBars, tf: 'W' | 'M', ipoD: number | null | undefined, now?: Date): { pat: ScreenPatternTag[]; scan: ScanMeta } {
  const n = b.c.length;
  if (!n) return { pat: [], scan: { st: 'insufficient-history', v: PATTERN_SCAN_VERSION, n: 0, tf } };
  try {
    const a = analyzeDailyAs(toPBars(b), tf, { completedOnly: true, ...(now ? { now } : {}), ...(ipoD != null && Number.isFinite(ipoD) ? { firstTradeT: ipoD * DAY } : {}) });
    const asOf = a.periodEnd != null && Number.isFinite(a.periodEnd) ? new Date(a.periodEnd).toISOString().slice(0, 10) : undefined;
    return scanResult(a, tf, asOf, a.bars.length);
  } catch {
    return { pat: [], scan: { st: 'error', v: PATTERN_SCAN_VERSION, tf, asOf: b.d[n - 1] } };
  }
}

/** What the screener build keeps per company from one download of its daily bars: price figures + chart patterns.
 *  `bench` (zzz987) = the market index's weekly closes by week key, for the Mansfield RS of the Stage Analysis.
 *  `src` (zzz993) = where the bars came from ('yahoo', or 'yahoo+nse-bhav' when NSE's own prices were laid over them) and the
 *  exchange Yahoo names for the symbol — stored with the scan close so every price-based figure has its provenance. */
export function techEntry(bars: DailyBars, firstTradeSec: number | null, partial?: boolean, bench?: ReadonlyMap<string, number> | null, src?: { src?: string; ex?: string | null; now?: Date }): TechStored {
  const ipoD = firstTradeSec != null ? Math.floor((firstTradeSec * 1000) / DAY) : null;
  const cc = partial ? closedFigures(bars) : null;
  const p = patternsFromBars(bars, ipoD);
  let tv: Partial<TvFigures> = {};
  try { tv = tvFigures(bars, bench); } catch { /* never costs the price figures */ }
  const n = bars.c.length;
  // zzz993 (MC-01) — the close every price figure and pattern of this entry was worked out from, and its date / source
  const scanPx = n && Number.isFinite(bars.c[n - 1]) ? Number(bars.c[n - 1].toPrecision(6)) : null;
  // zzz993 — weekly / monthly patterns from the same daily bars (completed periods only)
  const w = periodPatternsFromBars(bars, 'W', ipoD, src?.now), m = periodPatternsFromBars(bars, 'M', ipoD, src?.now);
  return {
    ...techFigures(bars), ipoD, ...(cc ? { cc } : {}), pat: p.pat, patAt: p.patAt, patV: PATTERN_SCAN_VERSION, scan: p.scan, ...tv,
    patW: w.pat, scanW: w.scan, patM: m.pat, scanM: m.scan,
    ...(scanPx != null ? { scanPx, scanAt: bars.d[n - 1] } : {}), scanSrc: src?.src || 'yahoo', ...(src?.ex ? { scanEx: src.ex } : {}),
  };
}

/** The pattern fields a screener row carries, from a stored entry: nothing when the entry predates the pattern scan; only
 *  `scan: { st: 'stale-version' }` (no tags, no patAt) when it was read by an older scan version (MC-02 — an old reading is
 *  never shown as current); otherwise the tags (ready only), patAt (ready / no-pattern) and the scan status. */
export function rowPatternFields(tf: TechStored | undefined): Pick<ScreenRow, 'pat' | 'patAt' | 'scan' | 'patW' | 'patM' | 'scanW' | 'scanM'> {
  if (!tf || tf.patV == null) return {};
  if (tf.patV !== PATTERN_SCAN_VERSION) {
    const old = tf.scan;
    return { scan: { st: 'stale-version', v: tf.patV, ...(old?.n != null ? { n: old.n } : {}), ...(old?.asOf || tf.patAt ? { asOf: old?.asOf || tf.patAt || undefined } : {}), ...(old?.vc != null ? { vc: old.vc } : {}) } };
  }
  const scan: ScanMeta = tf.scan || { st: tf.pat?.length ? 'ready' : 'no-pattern', v: tf.patV, ...(tf.patAt ? { asOf: tf.patAt } : {}) };
  const out: Pick<ScreenRow, 'pat' | 'patAt' | 'scan' | 'patW' | 'patM' | 'scanW' | 'scanM'> = { scan };
  if (scan.st === 'ready' && tf.pat?.length) out.pat = tf.pat;
  if (isScanned(scan.st) && tf.patAt) out.patAt = tf.patAt;
  // weekly / monthly readings (filled once the higher-timeframe scan is wired in techEntry)
  if (tf.scanW) { out.scanW = tf.scanW; if (tf.scanW.st === 'ready' && tf.patW?.length) out.patW = tf.patW; }
  if (tf.scanM) { out.scanM = tf.scanM; if (tf.scanM.st === 'ready' && tf.patM?.length) out.patM = tf.patM; }
  return out;
}

/** zzz993 (MC-01) — price provenance on a row: the scan close (what the patterns, distances, stages AND every moving average /
 *  RSI / performance figure were worked out from) next to the latest quote shown as `px`. `pxGap` = (px ÷ scanPx − 1) × 100;
 *  `pxConflict: 1` = more than PX_CONFLICT_PCT apart while both are for the same day (or the quote's day is unknown) — the two
 *  vendors disagree materially. Neither reading is certified as the exchange close. A gap on DIFFERENT known days is a timing
 *  gap (the bars are older than the quote), shown by pxGap / scanAt / pxAt but not flagged as a conflict. */
export type ScanPriceFields = Pick<ScreenRow, 'scanPx' | 'scanAt' | 'scanSrc' | 'scanBasis' | 'scanEx' | 'pxSrc' | 'pxAt' | 'pxGap' | 'pxConflict'>;
export function rowScanFields(tf: TechStored | undefined, quote: { px: number | null | undefined; src: string; at?: string | null }): ScanPriceFields {
  const out: ScanPriceFields = { pxSrc: quote.src, ...(quote.at ? { pxAt: quote.at } : {}) };
  if (!tf) return out;
  const scanPx = fin(tf.scanPx) ? tf.scanPx : fin(tf.close) ? tf.close : null;   // entries from before zzz993: the rounded close
  const scanAt = tf.scanAt || tf.d || null;
  if (scanPx == null || !(scanPx > 0)) return out;
  out.scanPx = scanPx; if (scanAt) out.scanAt = scanAt;
  out.scanSrc = tf.scanSrc || 'yahoo'; out.scanBasis = SCAN_BASIS; if (tf.scanEx) out.scanEx = tf.scanEx;
  if (fin(quote.px) && quote.px > 0) {
    const gap = Math.round((quote.px / scanPx - 1) * 10000) / 100;
    out.pxGap = gap;
    const differentDays = !!(quote.at && scanAt && quote.at !== scanAt);
    if (Math.abs(gap) > PX_CONFLICT_PCT && !differentDays) out.pxConflict = 1;
  }
  return out;
}

/** zzz996 — Nasdaq's list can lag a session (seen 13 Oct 2026: RPD 13.74, AVAV 137.11, AAPL 336.64 = their 9 Oct closes while
 *  the daily bars already had 12 Oct). When the quote equals the PREVIOUS bar's close and not the last one, the quote is a session
 *  behind: use the last bar's close (and its change) so price, averages and patterns agree; the stale quote is kept as `pxAlt`. */
export interface ResolvedQuote { px: number | null; chg: number | null; src: string; at?: string | null; pxAlt?: number; mcScale: number }
export function resolveUsQuote(q: { px: number | null; chg: number | null }, tf: { close?: number | null; prevClose?: number | null; scanPx?: number | null; scanAt?: string | null; d?: string } | undefined): ResolvedQuote {
  const keep: ResolvedQuote = { px: q.px, chg: q.chg, src: 'nasdaq', mcScale: 1 };
  if (!tf || !fin(q.px) || !(q.px > 0)) return keep;
  const last = fin(tf.scanPx) ? tf.scanPx : fin(tf.close) ? tf.close : null;
  const prev = tf.prevClose;
  if (last == null || !fin(prev) || !(prev > 0) || !(last > 0)) return keep;
  const near = (a: number, b: number) => Math.abs(a / b - 1) < 0.0015;
  if (!near(q.px, prev) || near(q.px, last)) return keep;
  return { px: last, chg: Math.round((last / prev - 1) * 10000) / 100, src: 'yahoo (Nasdaq list a session behind)', at: tf.scanAt || tf.d || null, pxAlt: q.px, mcScale: last / q.px };
}

/** zzz993 (MC-01) — the build note on price sources: px and the averages / patterns come from different feeds in the US, so a
 *  "price above SMA 50" rule compares a Nasdaq quote with a Yahoo-based average; scanPx is the close on the averages' own source. */
export function priceSourceNote(rows: readonly ScreenRow[], market: ScreenMarket): string | null {
  let both = 0, conflicts = 0, gaps = 0;
  for (const r of rows) {
    if (r.pxGap == null) continue;
    both++;
    if (r.pxConflict) conflicts++; else if (Math.abs(r.pxGap) > PX_CONFLICT_PCT) gaps++;
  }
  if (!both) return null;
  const quote = market === 'US' ? 'Nasdaq\'s list (last sale)' : 'NSE\'s daily price file (official close)';
  const bars = market === 'US' ? 'Yahoo daily bars' : 'Yahoo daily bars with NSE\'s own prices laid over the last ~3 months';
  return `price sources: Price / change today come from ${quote}; moving averages, RSI, performance and chart patterns from ${bars} (split-adjusted, not dividend-adjusted), whose last close is kept as the scan close. ` +
    `Price-vs-average rules therefore compare the quote with averages of the scan bars. ${conflicts} of ${both} companies have a quote more than ${PX_CONFLICT_PCT}% from the scan close on the same (or an unknown) day — flagged as a price conflict, neither source certified` +
    `${gaps ? `; ${gaps} more differ by over ${PX_CONFLICT_PCT}% because the bars are older than the quote` : ''}`;
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
// zzz994 — stages are explicit (an empty choice matches nothing; "All stages" is its own state), analysis timeframes D / W / M
// with ANY / ALL, the score is called a SHAPE SCORE (0–100, how closely the shape fits — not a probability), and the result is
// STRICT: a company whose rule cannot be evaluated (figure missing, timeframe not scanned) is never a match; it is listed apart
// as provisional (runPineFull). The pattern matcher is shared with the Stock Screener's 'pattern' filter (filters.ts).
export type PineBias = 'U' | 'D' | 'both';
export type PineStage = 'f' | 'b' | 'x';
export type PerfKey = 'perf1M' | 'perf3M' | 'perf6M' | 'perf1Y';
export const STAGES: ReadonlyArray<{ id: PineStage; label: string; tip: string }> = [
  { id: 'f', label: 'Forming', tip: 'No close beyond the pivot yet' },
  { id: 'b', label: 'Breakout', tip: 'First close beyond the pivot within the last 5 sessions (bearish: breakdown)' },
  { id: 'x', label: 'Failed', tip: 'Broke out within the last 40 sessions and is now more than 7.5% back through the pivot' },
];
/** The shape-score floors (possible / likely / very likely are documented thresholds of a heuristic score, not probabilities). */
export const LIKELIHOODS: ReadonlyArray<{ min: number; label: string }> = [
  { min: 35, label: 'Possible or better (≥ 35)' }, { min: 55, label: 'Likely or better (≥ 55)' }, { min: 75, label: 'Very likely (≥ 75)' },
];
export const SHAPE_SCORE_LABEL = 'Shape score (0–100)';
export const SHAPE_SCORE_TIP = 'Shape score 0–100: how closely the chart fits the pattern\'s definition (each rule passed adds to it). Possible ≥ 35, likely ≥ 55, very likely ≥ 75. It is not a probability of the pattern working.';
export const likelihoodWord = shapeWord;
export const TIMEFRAMES = PATTERN_TFS;

export interface PineQuery {
  /** query format: 2 = zzz994 (empty stages mean "none"; older saved screens with no stage ticked meant "all" and are migrated) */
  qv: 2;
  bias: PineBias;
  /** sub-patterns ticked (empty = every pattern of the chosen bias) */
  ids: PatternId[];
  /** stages (empty = none: nothing matches until one is chosen) */
  stages: PineStage[];
  /** shape-score floor, 35 / 55 / 75 (field name kept for saved screens) */
  minConf: number;
  /** zzz994 — analysis timeframes of the pattern scan (D = daily, W = weekly, M = monthly) and how they combine */
  tfs: PatTf[]; tfMode: 'any' | 'all';
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
  qv: 2, bias: 'U', ids: [], stages: ['f', 'b'], minConf: 55, tfs: ['D'], tfMode: 'any', dist: { on: true, lo: -15, hi: 5 },
  mcMin: null, mcMax: null, pxMin: null, turnMin: null, perfKey: 'perf3M', perfMin: null, sectors: [], filters: [],
  need: 'pattern', cols: [],
};

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Distance in the pattern's direction (bullish: close vs pivot; bearish: the mirror). */
export const dirDist = (t: PatternTag): number | null => tagDirDist(t);

type PatQ = Pick<PineQuery, 'bias' | 'ids' | 'stages' | 'minConf' | 'dist'> & Partial<Pick<PineQuery, 'tfs' | 'tfMode'>>;
const ruleOf = (q: PatQ) => ({ bias: q.bias, ids: q.ids, stages: q.stages, minScore: q.minConf, dist: q.dist, tfs: q.tfs?.length ? q.tfs : (['D'] as PatTf[]), tfMode: q.tfMode === 'all' ? 'all' as const : 'any' as const });
/** The pattern part on one row: pass / fail / missing (a selected timeframe cannot be read) and the matching tags (with tf). */
export function evalRowPatterns(row: unknown, q: PatQ): PatternEval { return evalPattern(row, ruleOf(q)); }
/** The row's pattern tags that pass the pattern part of the query (each carries its timeframe `tf`). */
export function matchTags(row: Pick<ScreenRow, 'pat'> | Record<string, unknown>, q: PatQ): ScreenPatternTag[] {
  return evalPattern(row, ruleOf(q)).tags as ScreenPatternTag[];
}

/** Average daily traded value in the market's money unit ($ million / ₹ crore), from price × 30-day (else 10-day) volume. */
export function turnoverOf(r: Pick<ScreenRow, 'px' | 'avgVol30' | 'avgVol10'>, market: ScreenMarket): number | null {
  const v = fin(r.avgVol30) ? r.avgVol30 : fin(r.avgVol10) ? r.avgVol10 : null;
  if (!fin(r.px) || v == null) return null;
  return (r.px * v) / (market === 'US' ? 1e6 : 1e7);
}

/** The company part of the query (liquidity, size, strength, sector, extra rules). */
export function passesCompany(r: ScreenRow, q: PineQuery, market: ScreenMarket, now: Date = new Date()): boolean {
  return passesCompanyBasics(r, q, market) && q.filters.every((f) => passes(r, f, now));
}
/** Size, price, liquidity, strength and sector (a missing figure fails). */
function passesCompanyBasics(r: ScreenRow, q: PineQuery, market: ScreenMarket): boolean {
  if (q.mcMin != null && !(fin(r.mc) && r.mc >= q.mcMin)) return false;
  if (q.mcMax != null && !(fin(r.mc) && r.mc <= q.mcMax)) return false;
  if (q.pxMin != null && !(fin(r.px) && r.px >= q.pxMin)) return false;
  if (q.turnMin != null) { const t = turnoverOf(r, market); if (t == null || t < q.turnMin) return false; }
  if (q.perfMin != null) { const p = r[q.perfKey]; if (!fin(p) || p < q.perfMin) return false; }
  if (q.sectors.length && !(r.tvSec && q.sectors.includes(r.tvSec))) return false;
  return true;
}

/** `best` is null only for a company that passed a rules-only screen (need 'any') without a matching pattern. `missing` (provisional
 *  hits only) names the rules that could not be evaluated for this company. */
export interface PineHit { row: ScreenRow; tags: ScreenPatternTag[]; best: ScreenPatternTag | null; missing?: string[] }
/** Strongest first; a breakout beats a forming / failed reading of the same strength. */
export function bestTag(tags: readonly ScreenPatternTag[]): ScreenPatternTag {
  const rank = (t: ScreenPatternTag) => t.c + (t.s === 'b' ? 0.5 : t.s === 'x' ? -0.5 : 0);
  return tags.reduce((a, b) => (rank(b) > rank(a) ? b : a));
}
/** zzz994 (MC-07) — one extra rule on one company: pass / fail / missing. A figure the company does not have is "missing" (the
 *  rule cannot be evaluated) — except a SPARSE field, where absence is itself the answer (e.g. no golden cross in 20 sessions). */
export function ruleState(r: ScreenRow, f: Filter, market: ScreenMarket, now: Date = new Date()): 'pass' | 'fail' | 'missing' {
  if (f.off) return 'pass';
  if (f.kind === 'pattern') { const e = evalPattern(r, f); return e.status; }
  if (f.kind === 'num' || f.kind === 'cmp' || f.kind === 'near' || f.kind === 'date') {
    const absent = filterKeys(f).filter((k) => !fin((r as any)[k]));
    if (absent.length && absent.some((k) => !fieldOf(k)?.sparse?.[market])) return 'missing';
  }
  return passes(r, f, now) ? 'pass' : 'fail';
}
const ruleName = (f: Filter, market: ScreenMarket) => filterLabel(f, market);
export interface PineRun {
  /** every rule evaluated and passed */
  strict: PineHit[];
  /** no rule failed, but at least one could not be evaluated (named in hit.missing) — a preview, never a match */
  provisional: PineHit[];
}
export function runPineFull(rows: readonly ScreenRow[], q: PineQuery, market: ScreenMarket, now: Date = new Date()): PineRun {
  const strict: PineHit[] = [], provisional: PineHit[] = [];
  for (const r of rows) {
    const ev = evalRowPatterns(r, q);
    const missing: string[] = [];
    if (q.need !== 'any') {
      if (ev.status === 'fail') continue;
      if (ev.status === 'missing') missing.push(`chart pattern — ${ev.missingTfs.map((tf) => patMissingWhy(r, tf)).join('; ')}`);
    }
    if (!passesCompanyBasics(r, q, market)) continue;
    let failed = false;
    for (const f of q.filters) {
      const st = ruleState(r, f, market, now);
      if (st === 'fail') { failed = true; break; }
      if (st === 'missing') missing.push(ruleName(f, market));
    }
    if (failed) continue;
    const tags = (ev.tags as ScreenPatternTag[]).slice().sort((a, b) => b.c - a.c);
    const hit: PineHit = { row: r, tags, best: tags.length ? bestTag(tags) : null };
    if (missing.length) provisional.push({ ...hit, missing }); else strict.push(hit);
  }
  return { strict, provisional };
}
/** Strict matches only (every rule evaluated and passed). */
export function runPine(rows: readonly ScreenRow[], q: PineQuery, market: ScreenMarket, now: Date = new Date()): PineHit[] {
  return runPineFull(rows, q, market, now).strict;
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
  // zzz993 — scan status / quality (MC-02), scan-close vs latest-quote provenance (MC-01), weekly / monthly readings (when wired)
  'scan', 'scanPx', 'scanAt', 'scanSrc', 'scanBasis', 'scanEx', 'pxSrc', 'pxAt', 'pxGap', 'pxConflict', 'pxAlt', 'patW', 'patM', 'scanW', 'scanM',
  // zzz993 — fields the Pine rule editor offers (price figures, growth, valuation, quality)
  'rsiW', 'rsiM', 'epsQYoY', 'revAYoY', 'ps', 'evRev', 'de', 'cash', 'roeTTM', 'roceTTM', 'gmFY', 'epsTTMYoY', 'revTTMYoY', 'gpQYoY', 'pe',
  'opmTTM', 'nmTTM', 'sma21', 'sma100', 'ema10', 'ema50', 'atrP', 'chg1W', 'perf5D', 'perf5Y', 'avgVol60', 'fs',
] as const satisfies ReadonlyArray<keyof ScreenRow>;
/** zzz993 — numbers sent to the page are rounded: 2 decimals from 1 up, 4 significant digits below 1 (penny prices keep their
 *  meaning); whole numbers unchanged. Pattern tags and scan objects are left as stored. */
export function leanNum(v: number): number {
  if (!Number.isFinite(v) || Number.isInteger(v)) return v;
  return Math.abs(v) >= 1 ? Math.round(v * 100) / 100 : Number(v.toPrecision(4));
}
export function leanRow(r: ScreenRow): Partial<ScreenRow> & { live?: 1 } {
  const o: Record<string, unknown> = {};
  for (const k of LEAN_KEYS) { const v = (r as any)[k]; if (v != null) o[k] = typeof v === 'number' ? leanNum(v) : v; }
  if (r.cc) o.live = 1;   // read during a session: the latest bar (and its patterns) is the live, unfinished day
  return o as Partial<ScreenRow> & { live?: 1 };
}
/** zzz993 — a row's scan status. Snapshot rows built before zzz993 carry patAt but no `scan`: an older scan version, so
 *  'stale-version' (their tags are withheld until the company is re-read). No patAt and no scan = never scanned (null). */
export function scanStatusOf(r: Pick<ScreenRow, 'scan' | 'patAt'>): ScanStatus | null {
  return r.scan?.st ?? (r.patAt ? 'stale-version' : null);
}
/** zzz993 (MC-01) — distance from the LATEST QUOTE to each tag's pivot (`dq`, %, 0.1), next to the scan-close distance `d`. */
const withQuoteDist = (tags: ScreenPatternTag[], px: number | null | undefined): ScreenPatternTag[] =>
  fin(px) && px > 0 ? tags.map((t) => (fin(t.p) && t.p > 0 ? { ...t, dq: Math.round((px / t.p - 1) * 1000) / 10 } : t)) : tags;
export interface LeanResult {
  rows: Array<Partial<ScreenRow>>; total: number;
  /** genuine readings only: scan ready or no-pattern (MC-02) */
  scanned: number; withPattern: number; patAt: string | null;
  /** too little history (< PATTERN_MIN_BARS usable bars) · data rejected by validation · scan threw · read by an older scan version */
  insufficient: number; invalid: number; errors: number; stale: number;
  /** rows whose latest quote and scan close disagree by more than PX_CONFLICT_PCT on the same / an unknown day (MC-01) */
  pxConflicts: number;
  /** weekly / monthly scans: genuine readings (ready / no-pattern) and rows with a current weekly / monthly pattern */
  scannedW: number; scannedM: number; withPatternW: number; withPatternM: number;
  /** sent once instead of on every row: a row's scan / scanW / scanM WITHOUT `v` is the current version (scanV) and was read by
   *  the engine rule set `engine`; a row without `scanBasis` has this basis. Rows that differ keep their own value. */
  scanV: number; engine: string | null; scanBasis: string;
}
/** zzz984 — every company is sent (rules-only screens need them all); `patternsOnly` keeps the companies with a pattern.
 *  zzz993 — tags are sent only for a current, ready scan; `scan` is always sent (legacy rows get { st: 'stale-version', v: 0 }). */
export function leanRows(rows: readonly ScreenRow[], bias?: 'U' | 'D' | null, patternsOnly = false): LeanResult {
  let scanned = 0, withPattern = 0, insufficient = 0, invalid = 0, errors = 0, stale = 0, pxConflicts = 0;
  let scannedW = 0, scannedM = 0, withPatternW = 0, withPatternM = 0;
  const engines = new Set<string>();
  const dates = new Map<string, number>();
  const out: Array<Partial<ScreenRow>> = [];
  const keep = (tags: ScreenPatternTag[] | undefined, sc: ScanMeta | undefined | null) =>
    sc?.st === 'ready' && Array.isArray(tags) ? tags.filter((t) => t && PATTERN_META[t.id] && (!bias || t.b === bias)) : [];
  for (const r of rows) {
    const st = scanStatusOf(r);
    if (isScanned(st)) { scanned++; if (r.patAt) dates.set(r.patAt, (dates.get(r.patAt) || 0) + 1); }
    else if (st === 'insufficient-history') insufficient++;
    else if (st === 'invalid-data') invalid++;
    else if (st === 'error') errors++;
    else if (st === 'stale-version') stale++;
    if (r.pxConflict) pxConflicts++;
    const pat = keep(r.pat, st ? r.scan || { st, v: 0 } : null);
    const patW = keep(r.patW, r.scanW), patM = keep(r.patM, r.scanM);
    if (isScanned(r.scanW?.st)) scannedW++;
    if (isScanned(r.scanM?.st)) scannedM++;
    if (patW.length) withPatternW++;
    if (patM.length) withPatternM++;
    if (pat.length) withPattern++;
    else if (patternsOnly && !patW.length && !patM.length) continue;
    const lr = leanRow(r);
    // zzz991 — snapshots built before the guard: recompute so a tiny-base artefact never passes a Rule of 40 rule
    if (lr.r40 != null && !ruleOf40Usable(r.revQYoY, r.fcfmTTM)) lr.r40 = null;
    if (pat.length) lr.pat = withQuoteDist(pat, r.px); else delete lr.pat;
    if (patW.length) lr.patW = withQuoteDist(patW, r.px); else delete lr.patW;
    if (patM.length) lr.patM = withQuoteDist(patM, r.px); else delete lr.patM;
    if (st && !r.scan) lr.scan = { st, v: 0 };          // a pre-zzz993 snapshot row
    // payload: the version / engine / price basis repeated on every row are sent once (LeanResult.scanV / engine / scanBasis)
    for (const k of ['scan', 'scanW', 'scanM'] as const) {
      const sc = lr[k];
      if (sc && sc.v === PATTERN_SCAN_VERSION) { const { v: _v, e, ...rest } = sc; if (e) engines.add(e); lr[k] = rest as ScanMeta; }
    }
    if (lr.scanBasis === SCAN_BASIS) delete lr.scanBasis;
    if (!isScanned(st)) delete lr.patAt;                 // patAt only for a genuine reading
    out.push(lr);
  }
  const patAt = Array.from(dates.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0]?.[0] || null;
  return { rows: out, total: rows.length, scanned, withPattern, patAt, insufficient, invalid, errors, stale, pxConflicts, scannedW, scannedM, withPatternW, withPatternM,
    scanV: PATTERN_SCAN_VERSION, engine: engines.size === 1 ? [...engines][0] : engines.size ? [...engines].sort().join(', ') : null, scanBasis: SCAN_BASIS };
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
  let stages: PineStage[] = Array.isArray(x.stages) ? x.stages.filter((s: unknown): s is PineStage => s === 'f' || s === 'b' || s === 'x') : d.stages.slice();
  // zzz994 (MC-03) — before query format 2, no stage ticked meant EVERY stage (failed included): say so explicitly now
  if (x.qv !== 2 && !stages.length) stages = ['f', 'b', 'x'];
  const tfs: PatTf[] = Array.isArray(x.tfs) ? Array.from(new Set<PatTf>(x.tfs.filter((t: unknown): t is PatTf => t === 'D' || t === 'W' || t === 'M'))) : [];
  const dist = x.dist && typeof x.dist === 'object' && fin(x.dist.lo) && fin(x.dist.hi) ? { on: x.dist.on !== false, lo: x.dist.lo, hi: x.dist.hi } : d.dist;
  const filters = Array.isArray(x.filters) ? cleanScreens([{ id: 'q', name: 'q', market: 'US', filters: x.filters }])[0]?.filters || [] : [];
  return {
    qv: 2,
    bias: x.bias === 'D' || x.bias === 'both' ? x.bias : 'U',
    ids: Array.from(new Set<PatternId>(ids)).slice(0, PATTERN_IDS.length),
    stages: Array.from(new Set<PineStage>(stages)),
    minConf: fin(x.minConf) ? Math.min(100, Math.max(35, x.minConf)) : d.minConf,
    tfs: tfs.length ? tfs : ['D'], tfMode: x.tfMode === 'all' ? 'all' : 'any',
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

/** zzz994 — kept for compatibility; the page no longer applies a relaxed query (strict + provisional, runPineFull).
 *  zzz989 — "show data first": what the stored snapshot can answer right now. A rule whose figure no company has yet (a field
 *  added by a newer build that has not run) is PAUSED instead of emptying the list, and a "chart pattern required" choice is
 *  dropped while the market has not been scanned for patterns. The page names every paused rule; nothing is hidden. */
export interface Available { q: PineQuery; paused: NumKey[]; patternsPaused: boolean }
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

/** zzz994 (MC-07) — can a rule's figure be evaluated on the Pine Screener at all, and does the stored data have it yet?
 *  unsupported-pine   = the field is not delivered in the Pine Screener's lean data (LEAN_KEYS) — it never fills in here;
 *  unsupported-market = the field does not exist for this market;
 *  pending            = delivered, but no company has it yet (a newer build has not run);
 *  partial / ok       = some / all companies have it. */
export type FieldCover = 'ok' | 'partial' | 'pending' | 'unsupported-pine' | 'unsupported-market';
export interface RuleCoverage { key: NumKey; label: string; status: FieldCover; have: number; total: number }
export const pineFieldSupported = (k: string): boolean => (LEAN_KEYS as readonly string[]).includes(k);
/** The Stock Screener fields a Pine rule may use for this market (only fields the page receives). */
export function pineRuleFields(market: ScreenMarket) { return FIELDS.filter((f) => f.markets.includes(market) && pineFieldSupported(f.key)); }
export function ruleCoverage(rows: readonly ScreenRow[], filters: readonly Filter[], market: ScreenMarket): RuleCoverage[] {
  const seen = new Set<string>();
  const out: RuleCoverage[] = [];
  for (const f of filters) {
    if (f.off) continue;
    for (const k of filterKeys(f)) {
      if (seen.has(k)) continue;
      seen.add(k);
      const d = fieldOf(k);
      const have = rows.reduce((n, r) => n + (fin((r as any)[k]) ? 1 : 0), 0);
      const status: FieldCover = !d || !d.markets.includes(market) ? 'unsupported-market' : !pineFieldSupported(k) ? 'unsupported-pine'
        : !rows.length ? 'pending' : have === 0 ? (d.sparse?.[market] ? 'partial' : 'pending') : have < rows.length ? 'partial' : 'ok';
      out.push({ key: k, label: d?.label || k, status, have, total: rows.length });
    }
  }
  return out;
}

/** zzz989 — the watchlist / bench link: keep only the companies on a chosen list (null = every company). */
export function onList(hits: PineHit[], tickers: ReadonlySet<string> | null): PineHit[] {
  return tickers ? hits.filter((h) => tickers.has(h.row.t.toUpperCase())) : hits;
}
