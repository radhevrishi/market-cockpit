// zzz999 — PINE SCREENER REDESIGN: the pure view logic behind the page (setup cards, the company lists the results can be limited
// to, the "My portfolio" chart check, distance to the 21 / 50 / 200-day averages, plain verdict words, the hand-off from the Stock
// Screener). No React, no fetch — the page and the tests share it.
//
// The split between the two screeners (owner, 13 Oct 2026):
//   Pine Screener  = chart setups — patterns D / W / M, stage, shape score, distance to the pivot, trend / average position, RS, volume.
//                    Its question: "which charts are setting up now?"
//   Stock Screener = fundamentals and the general rule editor. A Stock screen (built-in or saved) can be the Pine Screener's company
//                    list, so the two combine without a second editor.
import { PATTERN_META, POINT_ROLES, PATTERN_MIN_HISTORY, type PatternId, type PointRole } from '../chart-patterns';
import * as PINE from './pine';
import { runPineFull, pineFilters, r40Text, bestTag, tagScanClose, tagLengthText, turnoverOf, ruleState, matchTags, STAGES, type PineHit, type PineQuery, type PineRun, type ScreenPatternTag, type ScanStatus } from './pine';
import { BUILT_IN_PINE_SCREENS } from './pine-presets';
import { patTagsOf, patMissingWhy, runScreen, tagDirDist, filterLabel, unsupportedChoices, type PatTf, type Screen } from './filters';
import { tvSectorOf } from './tv-sectors';
import { normTicker } from './pine-handoff';
import type { ScreenMarket, ScreenRow } from './types';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ── setup cards ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type SetupGlyph = 'breakout' | 'ready' | 'base' | 'breakdown' | 'weekly' | 'monthly' | 'portfolio';
export interface SetupCard {
  id: string;
  /** the card's title and a one-line plain explanation */
  label: string; sub: string;
  /** the built-in Pine screen the card opens (null = the portfolio check, which is a view of its own) */
  presetId: string | null;
  glyph: SetupGlyph;
  tone: 'up' | 'down' | 'neutral';
  /** zzz1004 — a second screen counted apart on the same card (e.g. monthly reversal bases beside the monthly bases) */
  alt?: { presetId: string; label: string };
}
export const SETUP_CARDS: readonly SetupCard[] = [
  { id: 'breakouts', label: 'Breakouts', sub: 'First close above the pivot in the last 5 sessions', presetId: 'breakouts-today', glyph: 'breakout', tone: 'up' },
  { id: 'ready', label: 'Ready to break out', sub: 'Still forming, within 5% below the pivot', presetId: 'near-ready', glyph: 'ready', tone: 'up' },
  { id: 'bases', label: 'Bases forming', sub: 'Flat bases, cups, VCPs up to 15% below the pivot', presetId: 'bases-forming', glyph: 'base', tone: 'up' },
  { id: 'breakdowns', label: 'Breakdowns', sub: 'Bearish patterns that closed through support', presetId: 'breakdowns', glyph: 'breakdown', tone: 'down' },
  { id: 'weekly', label: 'Weekly bases', sub: 'Bases read on completed weekly bars', presetId: 'weekly-bases', glyph: 'weekly', tone: 'up' },
  { id: 'monthly', label: 'Monthly bases', sub: 'U-bases, cups, VCPs on completed monthly bars', presetId: 'monthly-bases', glyph: 'monthly', tone: 'up', alt: { presetId: 'monthly-reversal-bases', label: 'reversal bases' } },
  { id: 'portfolio', label: 'My portfolio check', sub: 'Every holding: patterns and the 21 / 50 / 200-day averages', presetId: null, glyph: 'portfolio', tone: 'neutral' },
];
/** zzz1007 — the Rule of 40 control survives a screen / card change (like the company list): a screen without its own Rule of 40
 *  setting takes the one in use; a screen that sets one keeps it. */
export function withCarriedR40(q: PineQuery, current: Pick<PineQuery, 'r40Min'> | null | undefined): PineQuery {
  return q.r40Min == null && current?.r40Min != null ? { ...q, r40Min: current.r40Min } : q;
}
/** The query a setup card stands for (its preset's query), or null for the portfolio card. */
export function cardQuery(card: SetupCard): PineQuery | null {
  if (!card.presetId) return null;
  return BUILT_IN_PINE_SCREENS.find((s) => s.id === card.presetId)?.q || null;
}
/** How many companies each pattern card finds on these rows (strict matches only), within the company list when one is chosen.
 *  The portfolio card counts the holdings (all of them — with or without a pattern); null while the holdings are not known. */
/** zzz1007 — `overlay`: the Rule of 40 control carried onto every card (a card whose preset sets its own keeps that), so the counts are
 *  what clicking the card shows. */
export function setupCounts(rows: readonly ScreenRow[], market: ScreenMarket, list: ReadonlySet<string> | null, holdings: readonly string[] | null, now: Date = new Date(), overlay?: Pick<PineQuery, 'r40Min'>): Record<string, number | null> {
  const base = list ? rows.filter((r) => list.has(r.t.toUpperCase())) : rows;
  const out: Record<string, number | null> = {};
  const withOverlay = (q: PineQuery): PineQuery => withCarriedR40(q, overlay);
  for (const c of SETUP_CARDS) {
    const q = cardQuery(c);
    out[c.id] = q ? runPineFull(base, withOverlay(q), market, now).strict.length : holdings ? holdings.length : null;
    if (c.alt) { const aq = BUILT_IN_PINE_SCREENS.find((s) => s.id === c.alt!.presetId)?.q; out[`${c.id}:alt`] = aq ? runPineFull(base, withOverlay(aq), market, now).strict.length : null; }
  }
  return out;
}

// ── the company list ("Companies") ─────────────────────────────────────────────────────────────────────────────────────
/** '' every company · 'wl:<id>' a watchlist · 'cb' Conviction Beats · 'pf' my portfolio · 'ss:<id>' a Stock Screener screen ·
 *  'hand' the companies sent over from the Stock Screener ("Open these in Pine Screener"). */
export type ScopeKind = 'all' | 'watchlist' | 'cb' | 'portfolio' | 'stock' | 'hand';
export function scopeKind(scope: string): ScopeKind {
  if (!scope) return 'all';
  if (scope === 'cb') return 'cb';
  if (scope === 'pf') return 'portfolio';
  if (scope === 'hand') return 'hand';
  if (scope.startsWith('ss:')) return 'stock';
  if (scope.startsWith('wl:')) return 'watchlist';
  return 'all';
}
/** The companies a Stock Screener screen passes on the Stock Screener's own data (its full figures, not the Pine page's lean
 *  rows), with sectors worked out again as the Stock Screener does. Exact figures / completed sessions: the Stock Screener's
 *  defaults (off). */
export function stockScreenTickers(rows: readonly ScreenRow[], screen: Pick<Screen, 'filters' | 'market'>, market: ScreenMarket, now: Date = new Date()): Set<string> {
  const fixed = rows.map((r) => { const tv = tvSectorOf(market, r.sec, r.ind, r.t); return tv && tv !== r.tvSec ? { ...r, tvSec: tv } : r; });
  return new Set(runScreen(fixed, screen.filters, now).map((r) => r.t.toUpperCase()));
}

// ── the hand-off from the Stock Screener: lib/screener/pine-handoff.ts (kept apart so the Stock Screener does not load the engine)
export { PINE_HANDOFF_KEY, cleanHandoff, makeHandoff, type PineHandoff } from './pine-handoff';
export { normTicker };

// ── moving-average position (same source for price and average) ────────────────────────────────────────────────────────
export interface MaPosition {
  /** the close compared with the averages: the DAILY TECHNICAL close (scanPx — the last bar of the daily bars the averages are
   *  worked out from; during a session that is the unfinished live bar). Never the pattern's analysis close. */
  close: number | null;
  /** 'scan' = the daily technical close (scanPx); 'quote' = the latest quote, used only when the row has no scan close (older data) */
  basis: 'scan' | 'quote' | null;
  at: string | null;
  /** zzz1008 — the technical close's session: 'provisional' = an unfinished live bar (the row was read during trading), else 'completed' */
  session?: 'completed' | 'provisional' | null;
  /** % above (+) / below (−) each simple average; null when the average is not known (too little history) */
  d21: number | null; d50: number | null; d200: number | null;
}
const distTo = (c: number | null, ma: unknown): number | null => (c != null && fin(ma) && ma > 0 ? Math.round((c / ma - 1) * 1000) / 10 : null);
/** zzz1008 (BVN) — ONE documented close for the 21 / 50 / 200-day distances: the daily technical close `scanPx` dated `scanAt`, the
 *  last bar of the very bars the averages come from (it may be today's live bar — session 'provisional'). Previously the completed
 *  session's close (the daily pattern's analysis close, a day older during a session) was compared with averages that include the
 *  live bar. Older rows without scanPx: the analysis close, then the quote. */
export function technicalSession(r: Partial<ScreenRow> & { live?: 1 }): 'completed' | 'provisional' | null {
  if (!fin(r.scanPx)) return null;
  const live = (r as any).scanLive?.asOf;
  return r.live || (r as any).cc || (live && r.scanAt && live === r.scanAt) ? 'provisional' : 'completed';
}
export function maPosition(r: Partial<ScreenRow>): MaPosition {
  let close: number | null = fin(r.scanPx) && r.scanPx > 0 ? r.scanPx : null, at: string | null = close != null ? r.scanAt || null : null;
  let basis: MaPosition['basis'] = close != null ? 'scan' : null;
  if (close == null) { const sc = tagScanClose(r, { tf: 'D' }); if (sc.px != null && sc.px > 0) { close = sc.px; at = sc.at; basis = 'scan'; } }
  if (close == null && fin(r.px) && r.px > 0) { close = r.px; at = r.pxAt || null; basis = 'quote'; }
  return { close, basis, at, session: basis === 'scan' ? technicalSession(r) ?? 'completed' : null, d21: distTo(close, r.sma21), d50: distTo(close, r.sma50), d200: distTo(close, r.sma200) };
}

// ── every pattern on a company (all timeframes, regardless of the query) ────────────────────────────────────────────────
export interface TfPatterns { tf: PatTf; tags: ScreenPatternTag[] | null }
/** D / W / M: the stored tags (strongest first) or null when that timeframe cannot be read for this company. */
export function allPatterns(r: unknown): TfPatterns[] {
  return (['D', 'W', 'M'] as const).map((tf) => {
    const t = patTagsOf(r, tf) as ScreenPatternTag[] | null;
    return { tf, tags: t ? t.slice().sort((a, b) => b.c - a.c) : null };
  });
}
/** zzz1008 (NOW / EDIT) — a breakout whose analysis close is back on the near side of the pivot (within the 3% the stage rule allows):
 *  the historical event stays ('broke out'), the current condition is said with it. Uses the tag's own `d` (analysis close). */
export const isReturned = (t: Pick<ScreenPatternTag, 's' | 'b'> & { d?: number | null }): boolean => t.s === 'b' && fin(t.d) && (t.b === 'U' ? t.d < 0 : t.d > 0);
export const stageWord = (t: Pick<ScreenPatternTag, 's' | 'b'> & { d?: number | null }) => (t.s === 'f' ? 'forming'
  : t.s === 'b' ? (isReturned(t) ? (t.b === 'U' ? 'broke out · back below pivot' : 'broke down · back above level') : (t.b === 'U' ? 'broke out' : 'broke down'))
    : (t.b === 'U' ? 'breakout failed' : 'breakdown failed'));
export const tfWord = (tf?: string | null) => (tf === 'W' ? 'weekly' : tf === 'M' ? 'monthly' : 'daily');
export { tagLengthText, tagScanClose };

// ── plain verdict words (from the numbers only; never buy / sell) ──────────────────────────────────────────────────────
export type VerdictTone = 'up' | 'down' | 'mixed' | 'none';
export interface Verdict { word: string; tone: VerdictTone; why: string }
export function maVerdict(ma: MaPosition, tags: readonly ScreenPatternTag[] = []): Verdict {
  // zzz1001 — "Breaking out / down" only from a DAILY pattern that broke in the last few sessions; an older weekly / monthly
  // breakdown is shown as a chip but does not override where the price sits against its averages (seen: AARTIPHARM 'Breaking
  // down' while 18% above its 200-day, from a monthly double top)
  // zzz1008 — a breakout already back through its pivot is not "breaking out" now
  const live = tags.filter((t) => t.s === 'b' && (t.tf == null || t.tf === 'D') && !isReturned(t));
  const down = live.find((t) => t.b === 'D'), up = live.find((t) => t.b === 'U');
  // zzz1002 — a break against the bigger trend is said as such (a rising-wedge breakdown 40% above the 200-day is a pullback so far)
  const above200 = ma.d200 != null && ma.d200 >= 0, above50 = ma.d50 != null && ma.d50 >= 0;
  if (down) {
    const why = `${PATTERN_META[down.id]?.label || down.id} (${tfWord(down.tf)}) closed through its breakdown level`;
    if (above200 && above50) return { word: 'Breaking down · still above 200-day', tone: 'mixed', why: `${why}; the close is still above its 50 and 200-day averages` };
    return { word: 'Breaking down', tone: 'down', why };
  }
  if (ma.close == null) return { word: 'No price data', tone: 'none', why: 'No close is stored for this company yet' };
  if (up) {
    const why = `${PATTERN_META[up.id]?.label || up.id} (${tfWord(up.tf)}) closed above its pivot`;
    if (ma.d200 != null && ma.d200 < 0) return { word: 'Breaking out · below 200-day', tone: 'mixed', why: `${why}; the close is still below its 200-day average` };
    return { word: 'Breaking out', tone: 'up', why };
  }
  const a = (d: number | null) => (d == null ? null : d >= 0);
  const a21 = a(ma.d21), a50 = a(ma.d50), a200 = a(ma.d200);
  if (a200 == null) {
    if (a50 == null) return { word: 'Too new to judge', tone: 'none', why: 'Less than 50 sessions of prices' };
    return a50 ? { word: 'Above 50-day', tone: 'up', why: 'Less than 200 sessions of prices; the close is above its 50-day average' }
      : { word: 'Below 50-day', tone: 'down', why: 'Less than 200 sessions of prices; the close is below its 50-day average' };
  }
  const known = [a21, a50, a200].filter((x): x is boolean => x != null);
  if (known.every((x) => x)) return { word: 'Above all MAs', tone: 'up', why: 'The close is above its 21, 50 and 200-day averages' };
  if (known.every((x) => !x)) return { word: 'Below all MAs', tone: 'down', why: 'The close is below its 21, 50 and 200-day averages' };
  if (!a200) return { word: 'Below 200-day', tone: 'down', why: 'The close is below its 200-day average but above a shorter one' };
  if (a50 === false) return { word: 'Below 50-day', tone: 'mixed', why: 'Above the 200-day average, below the 50-day' };
  return { word: 'Below 21-day', tone: 'mixed', why: 'Above the 50 and 200-day averages, below the 21-day' };
}

// ── the "My portfolio" chart check ─────────────────────────────────────────────────────────────────────────────────────
/** zzz1002 — a pattern worth showing on a holding by default: likely or better (shape score ≥ 55) and, while still forming,
 *  within 15% of its pivot / breakdown level (seen: PPIH 'double top forming' with the breakdown level 33% below the price — two old
 *  peaks, nothing to act on). Breakouts / breakdowns and recent failures of a likely pattern always show. */
export const ACTIVE_MIN_SCORE = 55, ACTIVE_MAX_DIST = 15;
export function isActivePattern(t: Pick<ScreenPatternTag, 'c' | 's' | 'd'>): boolean {
  if (!(t.c >= ACTIVE_MIN_SCORE)) return false;
  if (t.s !== 'f') return true;
  return t.d == null || Math.abs(t.d) <= ACTIVE_MAX_DIST;
}
export interface PortfolioCheckRow {
  /** the holding as saved (normalised) */
  ticker: string;
  /** the screener row, null when the company is not in this market's data (unlisted here, renamed, or not read yet) */
  row: ScreenRow | null;
  patterns: TfPatterns[];
  /** the patterns shown by default (isActivePattern), per timeframe; `hidden` = how many weaker / far-off ones are left out */
  active: TfPatterns[];
  hidden: number;
  /** strongest pattern on any timeframe (null = none) */
  best: ScreenPatternTag | null;
  ma: MaPosition;
  verdict: Verdict;
}
/** One row per holding — with or without a chart pattern — in the order: breaking down, below all, mixed, up, no data. */
export function portfolioCheck(rows: readonly ScreenRow[], holdings: readonly string[]): PortfolioCheckRow[] {
  const byT = new Map<string, ScreenRow>();
  for (const r of rows) byT.set(r.t.toUpperCase(), r);
  const seen = new Set<string>();
  const out: PortfolioCheckRow[] = [];
  for (const h of holdings) {
    const t = normTicker(h);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const row = byT.get(t) || null;
    const patterns = row ? allPatterns(row) : (['D', 'W', 'M'] as const).map((tf) => ({ tf, tags: null }));
    const tags = patterns.flatMap((p) => p.tags || []);
    const active = patterns.map((p) => ({ tf: p.tf, tags: p.tags ? p.tags.filter(isActivePattern) : null }));
    const shown = active.flatMap((p) => p.tags || []);
    const ma = row ? maPosition(row) : { close: null, basis: null, at: null, d21: null, d50: null, d200: null };
    const verdict: Verdict = row ? maVerdict(ma, shown) : { word: 'Not in the data', tone: 'none', why: 'This holding is not in this market\'s screener data (another market, a new listing or a changed symbol)' };
    out.push({ ticker: t, row, patterns, active, hidden: tags.length - shown.length, best: shown.length ? bestTag(shown) : tags.length ? bestTag(tags) : null, ma, verdict });
  }
  const rank: Record<VerdictTone, number> = { down: 0, mixed: 1, up: 2, none: 3 };
  return out.sort((a, b) => rank[a.verdict.tone] - rank[b.verdict.tone] || a.ticker.localeCompare(b.ticker));
}

// ── the detail panel: what the pattern means in plain words ────────────────────────────────────────────────────────────
/** The level at which the pattern stops being valid, in plain words (from the pivot, the depth and the 7.5% failure rule). */
export function invalidation(t: Pick<ScreenPatternTag, 'b' | 's' | 'p' | 'dp'>): { level: number | null; text: string } {
  if (!fin(t.p) || !(t.p > 0)) return { level: null, text: 'No pivot stored for this pattern' };
  const up = t.b === 'U';
  if (t.s === 'b') {
    const lvl = t.p * (up ? 0.925 : 1.075);
    return { level: lvl, text: up ? 'A close more than 7.5% back below the pivot marks the breakout as failed' : 'A close more than 7.5% back above the breakdown level marks the breakdown as failed' };
  }
  if (t.s === 'x') return { level: null, text: up ? 'Already failed: the close fell more than 7.5% back through the pivot' : 'Already failed: the close rose more than 7.5% back through the breakdown level' };
  if (fin(t.dp) && t.dp > 0) {
    const lvl = t.p * (up ? 1 - t.dp / 100 : 1 + t.dp / 100);
    return { level: lvl, text: up ? `A close below the bottom of the base (about ${t.dp}% under the pivot) breaks the shape` : `A close above the top of the pattern (about ${t.dp}% over the breakdown level) breaks the shape` };
  }
  return { level: null, text: up ? 'The shape breaks if the price falls through the bottom of the base' : 'The shape breaks if the price rises through the top of the pattern' };
}
/** Which of the screen's pattern choices the strongest pattern passed (shown as ticks in the detail panel). */
export function patternChecks(h: PineHit, q: Pick<PineQuery, 'stages' | 'minConf' | 'dist'>): Array<{ label: string; pass: boolean }> {
  const b = h.best;
  if (!b) return [];
  const dd = b.d == null ? null : b.b === 'U' ? b.d : -b.d;
  return [
    { label: `Stage: ${stageWord(b)}`, pass: q.stages.includes(b.s) },
    { label: `Shape score ${b.c} (needs ${q.minConf} or more)`, pass: b.c >= q.minConf },
    ...(q.dist.on ? [{ label: `To pivot ${dd == null ? 'unknown' : `${dd > 0 ? '+' : ''}${dd}%`} (window ${q.dist.lo}% to ${q.dist.hi > 0 ? '+' : ''}${q.dist.hi}%)`, pass: dd != null && dd >= q.dist.lo && dd <= q.dist.hi }] : []),
  ];
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// zzz1004 — PINE RETEST (PS-02 / PS-03 / PS-04 / PS-05 / PS-06): one timeframe-aware result model shared by the table, the chips,
// the row detail, the CSV and the chart hand-off. Three prices are never mixed:
//   · the ANALYSIS close — the close of the bar the pattern was read on: daily → the daily scan close; weekly / monthly → the close
//     of the last COMPLETED week / month (scanW / scanM px, dated asOf). A W / M reading without its own close shows "weekly /
//     monthly analysis close unavailable" — never the daily close under a W / M date;
//   · the DAILY TECHNICAL close — the daily bars the 21 / 50 / 200-day averages, RSI and performance come from;
//   · the LATEST QUOTE — px with its own source / time.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export type SessionState = 'completed' | 'provisional';
export interface AnalysisCtx {
  tf: PatTf;
  /** the close the pattern's `d` is measured from (null = not stored for this reading) */
  close: number | null;
  /** its date: the session (D) or the last daily bar of the completed week / month (W / M) */
  at: string | null;
  /** D: completed session or a provisional live reading; W / M: always completed periods (null = unknown) */
  session: SessionState | null;
  /** when the bars were observed (ISO), when known */
  obsAt: string | null;
  status: ScanStatus | null; v: number | null; engine: string | null;
  /** price basis and source of the bars */
  basis: string | null; src: string | null;
  /** why `close` is null, in words (null when it is known) */
  missing: string | null;
}
const scanOfTf = (r: any, tf: PatTf) => (tf === 'W' ? r?.scanW : tf === 'M' ? r?.scanM : r?.scan);
const tfOf = (t: { tf?: string | null } | null | undefined): PatTf => (t?.tf === 'W' || t?.tf === 'M' ? t.tf : 'D');
/** The analysis context of a tag (its timeframe's own close / date / session / scan status). Uses pine.ts analysisContext() when the
 *  build provides it, else tagScanClose(); either way a W / M reading never borrows the daily close. */
export function analysisOf(row: Partial<ScreenRow> | null | undefined, tag: { tf?: string | null } | null | undefined): AnalysisCtx {
  const r: any = row || {};
  const tf = tfOf(tag);
  const sc = scanOfTf(r, tf);
  let close: number | null = null, at: string | null = null, session: SessionState | null = null, obsAt: string | null = null;
  let status: ScanStatus | null = null, v: number | null = null;
  const ext = (PINE as any).analysisContext;
  let x: any = null;
  if (typeof ext === 'function') { try { x = ext(r, { ...(tag || {}), tf }); } catch { x = null; } }
  if (x && typeof x === 'object') {
    close = fin(x.close) && x.close > 0 ? x.close : null;
    at = typeof x.at === 'string' && x.at ? x.at : null;
    session = x.session === 'provisional' || x.session === 'completed' ? x.session : null;
    if (typeof x.obsAt === 'string') obsAt = x.obsAt;
    if (typeof x.status === 'string') status = x.status as ScanStatus;
    if (fin(x.v)) v = x.v;
  } else {
    const c = tagScanClose(r, { tf });
    close = c.px != null && c.px > 0 ? c.px : null;
    at = c.at;
  }
  // never the daily close under a W / M date (PS-01 / PS-02): a W / M reading without its own stored close has none
  if (tf !== 'D' && !fin(sc?.px)) close = null;
  if (!at) at = tf === 'D' ? (r.scanAt || sc?.asOf || r.patAt || null) : (sc?.asOf || null);
  if (!session) session = sc?.session === 'provisional' || sc?.session === 'completed' ? sc.session : tf !== 'D' ? (sc ? 'completed' : null) : r.live ? 'provisional' : sc ? 'completed' : null;
  if (!obsAt && typeof sc?.obsAt === 'string') obsAt = sc.obsAt;
  if (!status) status = (sc?.st as ScanStatus) || (tf === 'D' && r.patAt ? 'stale-version' : null);
  if (v == null && fin(sc?.v)) v = sc.v;
  return {
    tf, close, at, session, obsAt, status, v, engine: typeof sc?.e === 'string' ? sc.e : null,
    basis: r.scanBasis || null, src: r.scanSrc || null,
    missing: close != null ? null : tf === 'D' ? 'daily scan close unavailable' : `${tfWord(tf)} analysis close unavailable`,
  };
}
/** "14:46 UTC" from an ISO time ('' when there is none). */
export function obsTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} UTC` : /^\d{2}:\d{2}/.test(iso) ? iso.slice(0, 5) : '';
}
/** PS-03 — the badge text: "provisional (session open, observed 14:46 UTC)" or "completed close 2026-10-09" (W / M: "completed
 *  weekly close …" / "completed monthly close …"). A provisional reading is never called a close. */
export function sessionLabel(a: Pick<AnalysisCtx, 'tf' | 'session' | 'at' | 'obsAt'>): string {
  if (a.session === 'provisional') { const t = obsTime(a.obsAt); return `provisional (session open${t ? `, observed ${t}` : ''})`; }
  const kind = a.tf === 'W' ? 'weekly ' : a.tf === 'M' ? 'monthly ' : '';
  if (a.session === 'completed') return a.at ? `completed ${kind}close ${a.at}` : `completed ${kind}close (date unknown)`;
  return a.at ? `${kind}close ${a.at} (session state unknown)` : 'date unknown';
}
/** The daily technical close (the averages' own bars) and the latest quote, each with its own date / source. */
export interface PriceSet {
  analysis: AnalysisCtx;
  daily: { close: number | null; at: string | null; session: SessionState | null; obsAt: string | null };
  quote: { px: number | null; src: string | null; at: string | null };
}
export function priceSet(row: Partial<ScreenRow> | null | undefined, tag: { tf?: string | null } | null | undefined): PriceSet {
  const r: any = row || {};
  const d = analysisOf(r, { tf: 'D' });
  return {
    analysis: tfOf(tag) === 'D' ? d : analysisOf(r, tag),
    daily: { close: fin(r.scanPx) && r.scanPx > 0 ? r.scanPx : null, at: r.scanAt || null, session: d.session, obsAt: d.obsAt },
    quote: { px: fin(r.px) && r.px > 0 ? r.px : null, src: r.pxSrc || null, at: r.pxAt || null },
  };
}

/** Weekly / monthly breakout versus the latest condition (shown as badges; never turns a past W / M signal into a current trigger). */
export const MARGINAL_PCT = 0.5, ENTRY_WINDOW_PCT = 5;
export type ConditionId = 'back-through' | 'marginal' | 'extended';
export interface Condition { id: ConditionId; label: string; tip: string }
export function latestConditions(row: Partial<ScreenRow> | null | undefined, tag: ScreenPatternTag | null | undefined): Condition[] {
  if (!tag || tag.s !== 'b' || !fin(tag.p) || !(tag.p > 0)) return [];
  const r: any = row || {};
  const up = tag.b === 'U';
  const dd = tagDirDist(tag);
  const a = analysisOf(r, tag);
  const lvl = up ? 'pivot' : 'breakdown level';
  const out: Condition[] = [];
  // the latest price: the quote, else the newest daily close
  const lp = fin(r.px) && r.px > 0 ? r.px : fin(r.scanPx) && r.scanPx > 0 ? r.scanPx : null;
  const lq = lp != null ? Math.round((up ? 1 : -1) * (lp / tag.p - 1) * 10000) / 100 : fin(tag.dq) ? (up ? tag.dq : -tag.dq) : null;
  const signal = `${tfWord(tag.tf)} ${up ? 'breakout' : 'breakdown'}${a.at ? ` on the ${a.at} close` : ''}${a.close != null ? ` (${a.close})` : ''}`;
  if (lq != null && lq < 0) {
    out.push({ id: 'back-through', label: up ? 'latest quote back below pivot' : 'latest quote back above breakdown level',
      tip: `${signal}; the latest price ${lp ?? ''} is ${Math.abs(lq).toFixed(2)}% ${up ? 'below' : 'above'} the ${lvl} ${tag.p}. The ${tfWord(tag.tf)} signal is a completed-bar observation, not a current trigger.` });
  }
  if (dd != null && dd >= 0 && dd < MARGINAL_PCT) {
    const diff = Math.abs((a.close ?? tag.p * (1 + (up ? dd : -dd) / 100)) - tag.p);
    out.push({ id: 'marginal', label: 'marginal clearance',
      tip: `Only ${dd.toFixed(2)}% (about ${diff.toFixed(2)}) past the ${lvl} — a raw crossing; not confirmed by tick size, ATR or breakout volume.` });
  }
  if (dd != null && dd > ENTRY_WINDOW_PCT) {
    out.push({ id: 'extended', label: 'extended beyond entry window', tip: `${dd.toFixed(1)}% past the ${lvl} — beyond the +${ENTRY_WINDOW_PCT}% entry window.` });
  }
  return out;
}

/** Length as trading days, so daily / weekly / monthly lengths sort together (W × 5, M × 21); null when unknown. */
export const LEN_DAYS: Record<'d' | 'w' | 'm', number> = { d: 1, w: 5, m: 21 };
export function lengthDays(tag: Pick<ScreenPatternTag, 'l' | 'lu' | 'tf'> | null | undefined): number | null {
  const l = tag?.l;
  if (!fin(l) || l < 0) return null;
  const u = tag?.lu ?? (tag?.tf === 'W' ? 'w' : tag?.tf === 'M' ? 'm' : 'd');
  return l * LEN_DAYS[u];
}
export function lengthTip(tag: Pick<ScreenPatternTag, 'l' | 'lu' | 'tf'> | null | undefined): string {
  const txt = tagLengthText(tag), n = lengthDays(tag);
  if (!txt || n == null) return '';
  const raw = tag?.lu === 'w' || tag?.tf === 'W' ? `${tag!.l} weeks` : tag?.lu === 'm' || tag?.tf === 'M' ? `${tag!.l} months` : `${tag!.l} trading days`;
  return `${raw} ≈ ${n} trading days (sorted by elapsed duration: weeks × 5, months × 21)`;
}

// ── PS-05: the active query in words ─────────────────────────────────────────────────────────────────────────────────────
const TF_WORD: Record<PatTf, string> = { D: 'Daily', W: 'Weekly', M: 'Monthly' };
/** "Bullish · Monthly · My portfolio · Forming + Breakout · No pivot limit · Shape ≥ 55" (+ types / limits when set). */
export function querySummary(q: PineQuery, scopeName: string): string {
  const bias = q.bias === 'U' ? 'Bullish' : q.bias === 'D' ? 'Bearish' : 'Bullish + bearish';
  const tfs = (q.tfs.length ? q.tfs : ['D'] as PatTf[]).map((t) => TF_WORD[t]).join(' + ') + (q.tfs.length > 1 ? ` (${q.tfMode === 'all' ? 'all' : 'any'})` : '');
  const stageName = (id: string) => (id === 'b' ? (q.bias === 'D' ? 'Breakdown' : q.bias === 'both' ? 'Breakout / breakdown' : 'Breakout') : STAGES.find((s) => s.id === id)?.label || id);
  const stages = !q.stages.length ? 'No stage' : q.stages.map(stageName).join(' + ');
  const dist = q.dist.on ? `Pivot ${q.dist.lo}% to ${q.dist.hi > 0 ? '+' : ''}${q.dist.hi}%` : 'No pivot limit';
  const parts = [bias, tfs, scopeName || 'All companies', stages, dist];
  if (q.ids.length) parts.push(q.ids.length <= 3 ? q.ids.map((id) => PATTERN_META[id]?.label || id).join(', ') : `${q.ids.length} pattern types`);
  parts.push(`Shape ≥ ${q.minConf}`);
  const r40 = r40Text(q);   // zzz1007 — the Rule of 40 control is named, never folded into "N more limits"
  if (r40) parts.push(r40);
  if (q.returned === false && q.stages.includes('b')) parts.push(q.bias === 'D' ? 'Breakdowns holding below the level' : q.bias === 'both' ? 'Breaks holding beyond the level' : 'Breakouts holding above the pivot');   // zzz1008
  const lim = [q.mcMin, q.mcMax, q.pxMin, q.turnMin, q.perfMin].filter((v) => v != null).length + (q.sectors.length ? 1 : 0) + q.filters.filter((f) => !f.off).length;
  if (lim) parts.push(`${lim} more limit${lim === 1 ? '' : 's'}`);
  if (q.need === 'any' && !q.ids.length) parts.push('rules decide');
  return parts.join(' · ');
}
/** The preset line beside it: "Preset: All bearish patterns (changed)". */
export const presetLine = (name: string, dirty: boolean) => `Preset: ${name}${dirty ? ' (changed)' : ''}`;

// ── PS-02: coverage of the selected timeframes within the current company list ─────────────────────────────────────────
export interface TfCoverage {
  tf: PatTf; total: number;
  ready: number; noPattern: number; insufficient: number; invalid: number; errors: number; stale: number; unscanned: number;
  provisional: number;
  /** most common as-of date of the scanned readings and its session state */
  at: string | null; session: SessionState | null; obsAt: string | null;
}
export interface ScopeCoverage {
  /** companies of the list found in the data (all rows when no list) */
  inData: number;
  /** list members not in this market's data */
  notInData: string[];
  perTf: TfCoverage[];
}
export function scopeCoverage(rows: readonly ScreenRow[], tfs: readonly PatTf[], list: ReadonlySet<string> | null): ScopeCoverage {
  const inScope = list ? rows.filter((r) => list.has(r.t.toUpperCase())) : rows;
  const have = new Set(inScope.map((r) => r.t.toUpperCase()));
  const notInData = list ? Array.from(list).filter((t) => !have.has(t.toUpperCase())).sort() : [];
  const perTf = (tfs.length ? tfs : ['D'] as PatTf[]).map((tf): TfCoverage => {
    const c: TfCoverage = { tf, total: inScope.length, ready: 0, noPattern: 0, insufficient: 0, invalid: 0, errors: 0, stale: 0, unscanned: 0, provisional: 0, at: null, session: null, obsAt: null };
    const dates = new Map<string, number>();
    let obs: string | null = null;
    for (const r of inScope) {
      const a = analysisOf(r, { tf });
      const tags = patTagsOf(r, tf);
      const st = a.status;
      if (tags && (st === 'ready' || st === 'no-pattern' || st == null)) {
        if (tags.length) c.ready++; else c.noPattern++;
        if (a.at) dates.set(a.at, (dates.get(a.at) || 0) + 1);
        if (a.session === 'provisional') { c.provisional++; if (a.obsAt && (!obs || a.obsAt > obs)) obs = a.obsAt; }
      } else if (st === 'insufficient-history') c.insufficient++;
      else if (st === 'invalid-data') c.invalid++;
      else if (st === 'error') c.errors++;
      else if (st === 'stale-version') c.stale++;
      else c.unscanned++;
    }
    c.at = Array.from(dates.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0]?.[0] || null;
    c.session = c.provisional ? 'provisional' : c.ready + c.noPattern ? 'completed' : null;
    c.obsAt = obs;
    return c;
  });
  return { inData: inScope.length, notInData, perTf };
}
const n0 = (n: number) => n.toLocaleString('en-US');
/** "Daily — completed close 2026-10-09: 3 of 3 scanned (3 with a pattern, 0 none) · 1 too little history" */
export function coverageLine(c: TfCoverage): string {
  const scanned = c.ready + c.noPattern;
  const tail = [c.insufficient ? `${n0(c.insufficient)} too little history` : '', c.invalid ? `${n0(c.invalid)} data rejected` : '', c.stale ? `${n0(c.stale)} stale version` : '',
    c.errors ? `${n0(c.errors)} scan errors` : '', c.unscanned ? `${n0(c.unscanned)} not scanned` : ''].filter(Boolean);
  const when = scanned ? sessionLabel({ tf: c.tf, session: c.session, at: c.at, obsAt: c.obsAt }) : c.stale ? 'scan rebuilding, no current reading yet' : 'no reading';
  const mixed = c.provisional && c.provisional < scanned ? ` (${n0(c.provisional)} provisional)` : '';
  return `${TF_WORD[c.tf]} — ${when}${mixed}: ${n0(scanned)} of ${n0(c.total)} scanned (${n0(c.ready)} with a pattern, ${n0(c.noPattern)} none)${tail.length ? ` · ${tail.join(' · ')}` : ''}`;
}

// ── PS-06: pattern types not read on the selected timeframes ──────────────────────────────────────────────────────────────
export { unsupportedChoices };
/** A pattern chip's state on the selected timeframes: disabled (with the reason and a suggested timeframe) when the engine does not
 *  read the type on ANY selected timeframe. */
export function chipApplicability(id: PatternId, tfs: readonly PatTf[]): { na: boolean; reason: string; suggest: PatTf | null } {
  const u = unsupportedChoices([id], tfs, 'any')[0];
  if (!u || !u.blocked) return { na: false, reason: u ? `Not read on ${u.tfs.join(' / ')}: ${u.reason}` : '', suggest: null };
  return { na: true, reason: `Not read on ${u.tfs.join(' / ')}: ${u.reason}${u.suggest ? ` — try ${TF_WORD[u.suggest].toLowerCase()} (${u.suggest})` : ''}`, suggest: u.suggest };
}
/** The notice for a (saved) query that ticks types the selected timeframes do not support — instead of a silent zero. */
export function unsupportedNotice(q: Pick<PineQuery, 'ids' | 'tfs' | 'tfMode'>): string[] {
  return unsupportedChoices(q.ids, q.tfs, q.tfMode).map((u) => `${u.label}: unsupported on ${u.tfs.join(' / ')} — ${u.reason}${u.blocked ? ' (it cannot match under this choice; the count is not a "none found")' : ' (it can match only on the other ticked timeframes)'}${u.suggest ? `. It is read on ${TF_WORD[u.suggest].toLowerCase()} bars (${u.suggest}).` : '.'}`);
}

// ── preset families (a segmented control instead of more cards) ───────────────────────────────────────────────────────────
export interface PresetFamily { id: string; label: string; items: ReadonlyArray<{ presetId: string; label: string }> }
export const PRESET_FAMILIES: readonly PresetFamily[] = [
  { id: 'monthly', label: 'Monthly', items: [{ presetId: 'monthly-bases', label: 'Bases' }, { presetId: 'monthly-reversal-bases', label: 'Reversal bases' }, { presetId: 'monthly-near-pivot', label: 'Near pivot' }] },
  { id: 'portfolio', label: 'Portfolio', items: [{ presetId: 'pf-bearish-risks', label: 'Risks' }, { presetId: 'pf-bullish-opps', label: 'Opportunities' }, { presetId: 'pf-failed-bearish', label: 'Recovering' }] },
];
export const familyOf = (presetId: string): PresetFamily | null => PRESET_FAMILIES.find((f) => f.items.some((i) => i.presetId === presetId)) || null;

// ── PS-04: the portfolio check's All / Risks / Opportunities control ───────────────────────────────────────────────────────
export type PortfolioMode = 'all' | 'risks' | 'opps';
export const PORTFOLIO_MODE_PRESET: Record<Exclude<PortfolioMode, 'all'>, string> = { risks: 'pf-bearish-risks', opps: 'pf-bullish-opps' };
export interface PortfolioFocusRow { item: PortfolioCheckRow; tags: ScreenPatternTag[]; matched: boolean; coverage: string }
/** Risks / Opportunities: the tags of the matching portfolio preset on each holding; holdings without one stay listed as coverage
 *  rows (no bearish / bullish pattern · not scanned · not in the data). Matched first (strongest first). */
export function portfolioFocus(items: readonly PortfolioCheckRow[], mode: Exclude<PortfolioMode, 'all'>): PortfolioFocusRow[] {
  const q = BUILT_IN_PINE_SCREENS.find((s) => s.id === PORTFOLIO_MODE_PRESET[mode])!.q;
  const word = mode === 'risks' ? 'bearish' : 'bullish';
  const out = items.map((item): PortfolioFocusRow => {
    if (!item.row) return { item, tags: [], matched: false, coverage: 'not in the screener data' };
    const tags = (matchTags(item.row, q) as ScreenPatternTag[]).slice().sort((a, b) => b.c - a.c);
    if (tags.length) return { item, tags, matched: true, coverage: '' };
    const missing = item.patterns.filter((p) => p.tags == null).map((p) => p.tf);
    const cov = missing.length === 3 ? `not scanned (${patMissingWhy(item.row, 'D')})` : `no ${word} pattern on ${item.patterns.filter((p) => p.tags != null).map((p) => p.tf).join(' / ')}${missing.length ? `; ${missing.join(' / ')} not readable` : ''}`;
    return { item, tags: [], matched: false, coverage: cov };
  });
  return out.sort((a, b) => Number(b.matched) - Number(a.matched) || (b.tags[0]?.c ?? 0) - (a.tags[0]?.c ?? 0) || a.item.ticker.localeCompare(b.item.ticker));
}

// ── "Why not listed?" ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Why one tag does not pass the pattern part of the query ([] = it passes). Mirrors filters.tagPasses. */
export function tagRejectReasons(t: ScreenPatternTag, q: Pick<PineQuery, 'bias' | 'ids' | 'stages' | 'minConf' | 'dist' | 'tfs'> & { returned?: boolean }): string[] {
  const out: string[] = [];
  const tf = tfOf(t);
  if (!(q.tfs.length ? q.tfs : ['D']).includes(tf)) out.push(`timeframe ${tf} not selected`);
  if (q.bias !== 'both' && t.b !== q.bias) out.push(`${t.b === 'U' ? 'bullish' : 'bearish'} pattern; the screen asks for ${q.bias === 'U' ? 'bullish' : 'bearish'}`);
  if (q.ids.length && !q.ids.includes(t.id)) out.push('not one of the ticked pattern types');
  if (!q.stages.includes(t.s)) out.push(`stage "${stageWord(t)}" not selected`);
  else if (q.returned === false && isReturned(t)) out.push(`${t.b === 'U' ? 'breakout back below the pivot' : 'breakdown back above the level'} — the screen counts only ${t.b === 'U' ? 'breakouts' : 'breakdowns'} holding beyond it`);   // zzz1008
  if (!(t.c >= q.minConf)) out.push(`shape score ${t.c} below ${q.minConf}`);
  if (q.dist.on) {
    const d = tagDirDist(t);
    const lo = Math.min(q.dist.lo, q.dist.hi), hi = Math.max(q.dist.lo, q.dist.hi);
    if (d == null) out.push('distance to the pivot unknown');
    else if (d < lo || d > hi) out.push(`${d > 0 ? '+' : ''}${d.toFixed(1)}% to the pivot is outside the ${lo}% to ${hi > 0 ? '+' : ''}${hi}% window`);
  }
  return out;
}
export interface WhyPattern { tf: PatTf; tag: ScreenPatternTag; reasons: string[] }
export interface WhyResult {
  ticker: string;
  verdict: 'listed' | 'provisional' | 'excluded' | 'not-in-data' | 'out-of-scope';
  headline: string;
  steps: Array<{ label: string; ok: boolean | null; detail: string }>;
  /** every stored pattern on D / W / M (also below the thresholds) with why it does or does not pass */
  patterns: WhyPattern[];
}
/** "Why not listed?" — ticker → in the data? in the company list? scanned per selected timeframe? every stored pattern (also below
 *  the thresholds) and which rule excludes it; the company limits; the final verdict. Never relaxes anything. */
export function whyNotListed(input: string, o: { rows: readonly ScreenRow[]; q: PineQuery; market: ScreenMarket; list: ReadonlySet<string> | null; listName?: string; run?: PineRun; now?: Date }): WhyResult {
  const t = normTicker(input);
  const { q, market } = o;
  const row = o.rows.find((r) => r.t.toUpperCase() === t) || null;
  const steps: WhyResult['steps'] = [];
  const listName = o.listName || 'the company list';
  const inList = o.list ? o.list.has(t) : true;
  if (!row) {
    steps.push({ label: 'In the data', ok: false, detail: `${t} is not in this market's screener data (another market, a new listing or a changed symbol)` });
    if (o.list) steps.push({ label: 'In the company list', ok: inList, detail: inList ? `on ${listName}` : `not on ${listName}` });
    return { ticker: t, verdict: 'not-in-data', headline: `${t}: not in the ${market === 'IN' ? 'Indian' : 'US'} screener data`, steps, patterns: [] };
  }
  steps.push({ label: 'In the data', ok: true, detail: `${row.t}${row.n ? ` — ${row.n}` : ''}` });
  steps.push({ label: 'In the company list', ok: inList, detail: o.list ? (inList ? `on ${listName}` : `not on ${listName} — switch Companies to "All listed companies" to include it`) : 'every company' });
  const selTfs = q.tfs.length ? q.tfs : (['D'] as PatTf[]);
  for (const tf of selTfs) {
    const tags = patTagsOf(row, tf);
    const a = analysisOf(row, { tf });
    steps.push({ label: `${TF_WORD[tf]} scan`, ok: tags != null, detail: tags == null ? patMissingWhy(row, tf) : `${a.status || 'scanned'} · ${sessionLabel(a)} · ${tags.length} pattern${tags.length === 1 ? '' : 's'} stored` });
  }
  for (const u of unsupportedChoices(q.ids, q.tfs, q.tfMode)) steps.push({ label: `${u.label} on ${u.tfs.join(' / ')}`, ok: false, detail: `unsupported — ${u.reason}` });
  const patterns: WhyPattern[] = [];
  for (const p of allPatterns(row)) for (const tag of p.tags || []) { const tg = { ...tag, tf: tag.tf || p.tf } as ScreenPatternTag; patterns.push({ tf: p.tf, tag: tg, reasons: tagRejectReasons(tg, q) }); }
  const passing = patterns.filter((x) => !x.reasons.length);
  const needPattern = q.need !== 'any' || q.ids.length > 0;
  if (needPattern) steps.push({ label: 'Pattern part', ok: passing.length > 0 && (q.tfMode !== 'all' || selTfs.every((tf) => passing.some((x) => x.tf === tf))),
    detail: !patterns.length ? 'no pattern stored on D / W / M' : passing.length ? `${passing.length} pattern${passing.length === 1 ? '' : 's'} pass${q.tfMode === 'all' ? ` (needs one on every one of ${selTfs.join(' + ')})` : ''}` : 'every stored pattern is excluded — see the list' });
  // company limits (a missing figure fails)
  const lim: string[] = [];
  if (q.mcMin != null && !(fin(row.mc) && row.mc >= q.mcMin)) lim.push(`market cap ${fin(row.mc) ? row.mc : 'unknown'} below ${q.mcMin}`);
  if (q.mcMax != null && !(fin(row.mc) && row.mc <= q.mcMax)) lim.push(`market cap ${fin(row.mc) ? row.mc : 'unknown'} above ${q.mcMax}`);
  if (q.pxMin != null && !(fin(row.px) && row.px >= q.pxMin)) lim.push(`price ${fin(row.px) ? row.px : 'unknown'} below ${q.pxMin}`);
  if (q.turnMin != null) { const tv = turnoverOf(row, market); if (tv == null || tv < q.turnMin) lim.push(`daily value traded ${tv == null ? 'unknown' : tv.toFixed(2)} below ${q.turnMin}`); }
  if (q.perfMin != null) { const pv = row[q.perfKey]; if (!fin(pv) || pv < q.perfMin) lim.push(`performance ${fin(pv) ? pv : 'unknown'}% below ${q.perfMin}%`); }
  if (q.sectors.length && !(row.tvSec && q.sectors.includes(row.tvSec))) lim.push(`sector ${row.tvSec || 'unknown'} not selected`);
  for (const f of pineFilters(q)) { if (f.off) continue; const st = ruleState(row, f, market, o.now); if (st !== 'pass') lim.push(`${filterLabel(f, market)} — ${st === 'fail' ? 'not met' : 'cannot be evaluated'}`); }
  steps.push({ label: 'Size, liquidity and rules', ok: !lim.length, detail: lim.length ? lim.join('; ') : 'every limit passed (or none set)' });
  const run = o.run || runPineFull(o.rows, q, market, o.now);
  const strict = run.strict.some((h) => h.row.t.toUpperCase() === t), prov = run.provisional.some((h) => h.row.t.toUpperCase() === t);
  let verdict: WhyResult['verdict'], headline: string;
  if (!inList) { verdict = 'out-of-scope'; headline = `${t}: not on ${listName}${strict ? ' (it would match every chart choice)' : ''}`; }
  else if (strict) { verdict = 'listed'; headline = `${t}: listed — every choice passed`; }
  else if (prov) { verdict = 'provisional'; headline = `${t}: provisional — a rule could not be evaluated, so it is not counted`; }
  else {
    verdict = 'excluded';
    const first = lim[0] || (needPattern ? (patterns.length ? patterns.map((x) => `${PATTERN_META[x.tag.id]?.label || x.tag.id} [${x.tf}]: ${x.reasons[0] || 'passes'}`).find((s) => !s.endsWith('passes')) || 'patterns on the other timeframes missing' : 'no stored pattern') : '') || 'not matched';
    headline = `${t}: excluded — ${first}`;
  }
  return { ticker: t, verdict, headline, steps, patterns };
}
/** The list members not shown as matches (coverage rows): one line each, matched names left out. Bounded to `max` names. */
export function listCoverageRows(o: { rows: readonly ScreenRow[]; q: PineQuery; market: ScreenMarket; list: ReadonlySet<string>; listName?: string; run: PineRun; max?: number }): WhyResult[] {
  const matched = new Set(o.run.strict.map((h) => h.row.t.toUpperCase()));
  const out: WhyResult[] = [];
  for (const t of Array.from(o.list).sort()) {
    if (matched.has(t.toUpperCase())) continue;
    out.push(whyNotListed(t, { ...o, list: o.list }));
    if (out.length >= (o.max ?? 300)) break;
  }
  return out;
}

// ── the chart hand-off identity ─────────────────────────────────────────────────────────────────────────────────────────
/** Extra chart-link parameters that carry what the row was read on: pattern id, analysis timeframe, its as-of date and session. */
/** zzz1008 — plus the pattern window (`pf` / `pt`: first turning point → analysis date) when the tag carries its geometry; the chart
 *  opens on the analysis timeframe `atf`, turns the pattern indicator on, selects `pat` and fits the window with prior-trend room. */
export function chartIdentityParams(row: Partial<ScreenRow> | null | undefined, tag: ScreenPatternTag | null | undefined): string {
  if (!tag) return '';
  const a = analysisOf(row, tag);
  const w = geometryWindow(tag, a.at);
  return `&pat=${encodeURIComponent(tag.id)}&atf=${a.tf}${a.at ? `&asof=${encodeURIComponent(a.at)}` : ''}${a.session ? `&session=${a.session}` : ''}${w ? `&pf=${w.from}&pt=${w.to}` : ''}`;
}
/** PS-02 — the timeframe-aware CSV columns (header and one row's values), shared so the export cannot drift from the table. */
export const ANALYSIS_CSV_HEAD = ['Analysis timeframe', 'Analysis close', 'Analysis close date', 'Analysis session', 'Analysis scan status', 'Analysis scan version',
  'Daily technical close', 'Daily technical close date', 'Daily session', 'Latest quote', 'Latest quote source', 'Latest quote time', 'Latest condition', 'Length (≈ trading days)'] as const;
export function analysisCsvCells(row: Partial<ScreenRow>, tag: ScreenPatternTag | null): Array<string | number> {
  const ps = priceSet(row, tag || { tf: 'D' });
  const a = ps.analysis;
  return [tag ? a.tf : '', a.close ?? (tag ? a.missing || '' : ''), a.at || '', tag ? sessionLabel(a) : '', a.status || '', a.v ?? '',
    ps.daily.close ?? '', ps.daily.at || '', ps.daily.session || '', ps.quote.px ?? '', ps.quote.src || '', ps.quote.at || '',
    latestConditions(row, tag).map((c) => c.label).join('; '), lengthDays(tag) ?? ''];
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// zzz1008 — PINE BUG SWEEP: rebuild states (a stale timeframe is "cannot be determined yet", never "0 match"), the selected
// timeframe's own coverage warnings, and the auditable geometry of a pattern (its turning points, how the pivot is derived, the
// measured rule evidence).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/** One timeframe's re-read progress within the rows (a scope): `reread` = rows read by the CURRENT scan version (any status: a
 *  pattern, none, too little history, bad data, an error) · `stale` = rows read by an older version, waiting for the re-read ·
 *  state 'none' = nothing re-read yet while some are waiting (no match can be decided) · 'partial' = some re-read, some still
 *  waiting (matches so far are real; more may come) · 'ok'. */
export interface TfRebuild { tf: PatTf; total: number; reread: number; stale: number; state: 'ok' | 'partial' | 'none' }
export function tfRebuild(rows: readonly Partial<ScreenRow>[], tf: PatTf, list?: ReadonlySet<string> | null): TfRebuild {
  let total = 0, reread = 0, stale = 0, never = 0;
  for (const r of rows) {
    if (list && !list.has(String(r.t || '').toUpperCase())) continue;
    total++;
    const st = analysisOf(r, { tf }).status;
    if (st === 'stale-version') stale++;
    else if (st == null) never++;
    else reread++;
  }
  const state: TfRebuild['state'] = !reread && (stale || never) ? 'none' : reread && stale ? 'partial' : 'ok';
  return { tf, total, reread, stale, state };
}
/** Whether the pattern part of a query can be decided on these rows: 'none' = no selected timeframe (ANY) / one of them (ALL) has a
 *  current reading yet → the count is unknown, not 0 · 'partial' = matches so far, more may come · 'ok'. `text` names the rebuild. */
export interface QueryRebuild { state: 'ok' | 'partial' | 'none'; perTf: TfRebuild[]; text: string }
export function queryRebuild(rows: readonly Partial<ScreenRow>[], q: Pick<PineQuery, 'tfs' | 'tfMode' | 'need' | 'ids'>, list?: ReadonlySet<string> | null): QueryRebuild {
  const tfs = q.tfs.length ? q.tfs : (['D'] as PatTf[]);
  const perTf = tfs.map((tf) => tfRebuild(rows, tf, list));
  const needPattern = q.need !== 'any' || q.ids.length > 0;
  let state: QueryRebuild['state'] = 'ok';
  if (needPattern && rows.length) {
    const none = perTf.filter((x) => x.state === 'none'), part = perTf.filter((x) => x.state !== 'ok');
    if (q.tfMode === 'all' ? none.length > 0 : none.length === perTf.length) state = 'none';
    else if (part.length) state = 'partial';
  }
  const busy = perTf.filter((x) => x.state !== 'ok');
  const text = busy.map((x) => `${TF_WORD[x.tf]} scan rebuilding — ${x.state === 'none' ? 'matches cannot be determined yet' : 'matches so far; more can appear'} (${n0(x.reread)} of ${n0(x.total)} re-read with the current scan)`).join(' · ');
  return { state, perTf, text };
}
/** Per setup card: its preset's rebuild state on these rows (the card shows "…" while 'none', "N+" while 'partial'). */
export function setupRebuild(rows: readonly Partial<ScreenRow>[], list: ReadonlySet<string> | null): Record<string, QueryRebuild> {
  const out: Record<string, QueryRebuild> = {};
  for (const c of SETUP_CARDS) {
    const q = cardQuery(c);
    if (!q) continue;
    out[c.id] = queryRebuild(rows, q, list);
    if (c.alt) { const aq = BUILT_IN_PINE_SCREENS.find((s) => s.id === c.alt!.presetId)?.q; if (aq) out[`${c.id}:alt`] = queryRebuild(rows, aq, list); }
  }
  return out;
}
const UNIT_OF: Record<PatTf, [string, string]> = { D: ['session', 'sessions'], W: ['completed week', 'completed weeks'], M: ['completed month', 'completed months'] };
/** zzz1008 (item 5) — the coverage warnings of the SELECTED timeframes, in their own words and counts (never the daily "fewer than 30
 *  sessions" under a monthly choice). One line per timeframe and problem. */
export function tfCoverageWarnings(perTf: readonly TfCoverage[]): string[] {
  const out: string[] = [];
  for (const c of perTf) {
    const w = TF_WORD[c.tf], min = PATTERN_MIN_HISTORY[c.tf], [, units] = UNIT_OF[c.tf];
    if (c.insufficient) out.push(`${w}: ${n0(c.insufficient)} ${c.insufficient === 1 ? 'company has' : 'companies have'} too little ${w.toLowerCase()} history for a pattern scan (fewer than ${min} usable ${units}) — not counted as scanned.`);
    if (c.provisional) out.push(`${w}: ${n0(c.provisional)} ${c.provisional === 1 ? 'reading includes' : 'readings include'} an unfinished session — provisional until re-read.`);
    if (c.invalid || c.errors) out.push(`${w}: ${n0(c.invalid + c.errors)} could not be scanned (${n0(c.invalid)} price data rejected, ${n0(c.errors)} scan failures).`);
  }
  return out;
}

// ── auditable geometry ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface GeoPoint { date: string; when: string; price: number; role: PointRole; word: string }
/** The tag's turning points with words: daily "2026-07-29", weekly "week of 2026-07-27", monthly "month of 2026-09". */
export function geometryPoints(t: Pick<ScreenPatternTag, 'pts' | 'tf'> | null | undefined): GeoPoint[] {
  const tf = t?.tf === 'W' || t?.tf === 'M' ? t.tf : 'D';
  return (t?.pts || []).filter((x) => Array.isArray(x) && typeof x[0] === 'string' && fin(x[1])).map(([date, price, role]) => ({
    date, price, role, word: (POINT_ROLES as Record<string, string>)[role] || role,
    when: tf === 'W' ? `week of ${date}` : tf === 'M' ? `month of ${date.slice(0, 7)}` : date,
  }));
}
const ptOf = (g: GeoPoint[], ...roles: string[]) => g.find((x) => roles.includes(x.role));
/** How the pivot (bearish: the breakdown level) was derived from the turning points, in words. */
export function pivotDerivation(t: ScreenPatternTag, fmt: (n: number) => string = (n) => String(n)): string {
  const g = geometryPoints(t);
  const lvl = t.b === 'U' ? 'pivot' : 'breakdown level';
  const at = (x: GeoPoint | undefined) => (x ? `${fmt(x.price)} (${x.when})` : '');
  switch (t.id) {
    case 'double_bottom': return `${lvl} = the middle peak's high ${at(ptOf(g, 'P'))}, the highest price between the two lows`;
    case 'double_top': return `${lvl} = the middle trough's low ${at(ptOf(g, 'T'))}, the lowest price between the two highs`;
    case 'triple_bottom': return `${lvl} = the higher of the two peaks between the lows (${at(ptOf(g, 'P1'))} / ${at(ptOf(g, 'P2'))})`;
    case 'triple_top': return `${lvl} = the lower of the two troughs between the highs (${at(ptOf(g, 'T1'))} / ${at(ptOf(g, 'T2'))})`;
    case 'inverse_hs': case 'head_shoulders': return `${lvl} = the neckline through ${at(ptOf(g, 'N1'))} and ${at(ptOf(g, 'N2'))}, extended to the analysis bar (${fin(t.p) ? fmt(t.p) : '—'})`;
    case 'cup_handle': return `${lvl} = the handle's high, the right-side high ${at(ptOf(g, 'R'))}`;
    case 'cup': case 'u_base': case 'flat_base': case 'ipo_base': case 'base_on_base': return `${lvl} = the left-side high (lip) ${at(ptOf(g, 'LIP'))}`;
    case 'vcp': { const hs = g.filter((x) => x.role === 'CH'); return `${lvl} = the high of the last contraction ${at(hs[hs.length - 1])}`; }
    case 'ascending_base': return `${lvl} = the third high ${at(ptOf(g, 'H3'))}`;
    case 'high_tight_flag': return `${lvl} = the top of the pole ${at(ptOf(g, 'PT'))}`;
    case 'bull_flag': case 'bull_pennant': return `${lvl} = the upper flag line projected to the analysis bar (${fin(t.p) ? fmt(t.p) : '—'})`;
    case 'bear_flag': return `${lvl} = the lower flag line projected to the analysis bar (${fin(t.p) ? fmt(t.p) : '—'})`;
    case 'ascending_triangle': return `${lvl} = the highest of the ceiling touches (${fin(t.p) ? fmt(t.p) : '—'})`;
    case 'descending_triangle': return `${lvl} = the lowest of the floor touches (${fin(t.p) ? fmt(t.p) : '—'})`;
    case 'falling_wedge': return `${lvl} = the upper wedge line projected to the analysis bar (${fin(t.p) ? fmt(t.p) : '—'})`;
    case 'rising_wedge': return `${lvl} = the lower wedge line projected to the analysis bar (${fin(t.p) ? fmt(t.p) : '—'})`;
    default: return '';
  }
}
/** The measured rule evidence in words (only what the tag carries), with the rule it is checked against. */
export function evidenceRows(t: Pick<ScreenPatternTag, 'id' | 'b' | 'ev' | 'tf'>): Array<{ label: string; value: string; rule: string }> {
  const ev = t.ev || {};
  const unit = t.tf === 'W' ? 'weeks' : t.tf === 'M' ? 'months' : 'sessions';
  const bottom = t.b === 'U';
  const rev = ['double_bottom', 'double_top', 'triple_bottom', 'triple_top'].includes(t.id);
  const hs = t.id === 'inverse_hs' || t.id === 'head_shoulders';
  const out: Array<{ label: string; value: string; rule: string }> = [];
  const p = (v: number) => `${v}%`;
  if (fin(ev.band)) out.push({ label: rev ? (bottom ? 'Difference between the lows' : 'Difference between the highs') : 'Spread of the touches', value: p(ev.band), rule: rev ? '≤ 5% (≤ 1.5% best)' : '≤ 3%' });
  if (fin(ev.gap)) out.push({ label: hs ? 'Left to right shoulder' : 'Separation (first to last turning point)', value: `${ev.gap} ${unit}`, rule: t.tf === 'M' ? 'at least 6 monthly candles in all' : 'at least 10 sessions / 2 candles' });
  if (fin(ev.rally)) out.push({ label: hs ? 'Neckline above the shoulders' : bottom ? 'Middle rally (peak above the higher low)' : 'Middle dip (trough below the lower high)', value: p(ev.rally), rule: hs ? '≥ 5%' : '≥ 10%' });
  if (fin(ev.mid)) out.push({ label: bottom ? 'Dip from the middle peak to the lows' : 'Rise from the middle trough to the highs', value: p(ev.mid), rule: t.tf === 'M' ? '≤ 45%' : '≤ 40%' });
  if (fin(ev.neck)) out.push({ label: 'Neckline change between its two points', value: p(ev.neck), rule: '≤ 15% (≤ 4% best)' });
  if (fin(ev.sd)) out.push({ label: 'Shoulder difference', value: p(ev.sd), rule: '≤ 10%' });
  if (fin(ev.sh)) out.push({ label: 'Shoulders\' distance from the neckline ÷ the head\'s', value: `${ev.sh}`, rule: '≥ 0.30 (≥ 0.55 best)' });
  if (fin(ev.trend)) out.push({ label: rev || hs ? (bottom ? 'Prior fall into the first low' : 'Prior rise into the first high') : t.id.includes('flag') ? 'Pole' : 'Prior rise into the base', value: p(ev.trend), rule: rev || hs ? (bottom ? '≥ 15% (11.25% minimum)' : '≥ 20% (15% minimum)') : t.id.includes('flag') ? 'flags ≥ 15%, high tight flag ≥ 90%' : 'bases ≥ 20%' });
  if (fin(ev.depth)) out.push({ label: 'Depth', value: p(ev.depth), rule: t.id === 'flat_base' ? '≤ 15%' : t.id === 'cup' || t.id === 'cup_handle' ? '12–33% (to 50% scored lower)' : '' });
  if (fin(ev.rec)) out.push({ label: 'Right side as share of the lip', value: p(ev.rec), rule: '≥ 75% (cup with handle ≥ 85%)' });
  if (fin(ev.round)) out.push({ label: 'Closes in the lower 30% of the cup (roundness)', value: p(ev.round), rule: '≥ 35% (a V spends ~30% there)' });
  if (fin(ev.hd)) out.push({ label: 'Handle depth', value: p(ev.hd), rule: '2.5–15%' });
  if (fin(ev.vr)) out.push({ label: rev || hs ? 'Volume at the last turning point ÷ the first (±2 bars)' : 'Volume in the last part ÷ its 50-bar average', value: `${ev.vr}×`, rule: rev || hs ? '< 1 = lighter on the right side (Bulkowski)' : '< 1 = drying up' });
  if (fin(ev.hi1y)) out.push({ label: bottom ? 'Close as % of the 1-year high' : 'Close as % of the 1-year low', value: p(ev.hi1y), rule: bottom ? 'not reported when ≥ 95% and the high came after the pattern, > 5% past the pivot' : 'mirror for tops' });
  return out;
}
/** The chart window of a tag's geometry (first turning point → analysis date), for the chart hand-off (pf / pt). */
export function geometryWindow(t: Pick<ScreenPatternTag, 'pts'> | null | undefined, at: string | null): { from: string; to: string } | null {
  const ds = (t?.pts || []).map((x) => x?.[0]).filter((x): x is string => typeof x === 'string').sort();
  if (!ds.length) return null;
  return { from: ds[0], to: at && at > ds[ds.length - 1] ? at : ds[ds.length - 1] };
}

/** zzz1008 (BVN) — the price-source conflict in words, with BOTH dates: "same day" only when the two dates are equal ('' when no
 *  conflict). */
export function conflictWords(r: Partial<Pick<ScreenRow, 'pxConflict' | 'pxAt' | 'scanAt' | 'pxGap'>>): string {
  if (!r.pxConflict) return '';
  const gap = fin(r.pxGap) ? `${Math.abs(r.pxGap).toFixed(2)}% apart` : 'more than 2% apart';
  if (r.pxAt && r.scanAt && r.pxAt === r.scanAt) return `the quote and the daily technical close disagree on the same day (${r.scanAt}): ${gap}`;
  return `the quote${r.pxAt ? ` (${r.pxAt})` : ' (its date is not known)'} and the daily technical close${r.scanAt ? ` (${r.scanAt})` : ''} are ${gap} — different sources; neither is certified as the exchange close`;
}
