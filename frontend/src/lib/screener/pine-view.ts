// zzz999 — PINE SCREENER REDESIGN: the pure view logic behind the page (setup cards, the company lists the results can be limited
// to, the "My portfolio" chart check, distance to the 21 / 50 / 200-day averages, plain verdict words, the hand-off from the Stock
// Screener). No React, no fetch — the page and the tests share it.
//
// The split between the two screeners (owner, 13 Oct 2026):
//   Pine Screener  = chart setups — patterns D / W / M, stage, shape score, distance to the pivot, trend / average position, RS, volume.
//                    Its question: "which charts are setting up now?"
//   Stock Screener = fundamentals and the general rule editor. A Stock screen (built-in or saved) can be the Pine Screener's company
//                    list, so the two combine without a second editor.
import { PATTERN_META } from '../chart-patterns';
import { runPineFull, bestTag, tagScanClose, tagLengthText, type PineHit, type PineQuery, type ScreenPatternTag } from './pine';
import { BUILT_IN_PINE_SCREENS } from './pine-presets';
import { patTagsOf, runScreen, type PatTf, type Screen } from './filters';
import { tvSectorOf } from './tv-sectors';
import { normTicker } from './pine-handoff';
import type { ScreenMarket, ScreenRow } from './types';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ── setup cards ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type SetupGlyph = 'breakout' | 'ready' | 'base' | 'breakdown' | 'weekly' | 'portfolio';
export interface SetupCard {
  id: string;
  /** the card's title and a one-line plain explanation */
  label: string; sub: string;
  /** the built-in Pine screen the card opens (null = the portfolio check, which is a view of its own) */
  presetId: string | null;
  glyph: SetupGlyph;
  tone: 'up' | 'down' | 'neutral';
}
export const SETUP_CARDS: readonly SetupCard[] = [
  { id: 'breakouts', label: 'Breakouts', sub: 'First close above the pivot in the last 5 sessions', presetId: 'breakouts-today', glyph: 'breakout', tone: 'up' },
  { id: 'ready', label: 'Ready to break out', sub: 'Still forming, within 5% below the pivot', presetId: 'near-ready', glyph: 'ready', tone: 'up' },
  { id: 'bases', label: 'Bases forming', sub: 'Flat bases, cups, VCPs up to 15% below the pivot', presetId: 'bases-forming', glyph: 'base', tone: 'up' },
  { id: 'breakdowns', label: 'Breakdowns', sub: 'Bearish patterns that closed through support', presetId: 'breakdowns', glyph: 'breakdown', tone: 'down' },
  { id: 'weekly', label: 'Weekly bases', sub: 'Bases read on completed weekly bars', presetId: 'weekly-bases', glyph: 'weekly', tone: 'up' },
  { id: 'portfolio', label: 'My portfolio check', sub: 'Every holding: patterns and the 21 / 50 / 200-day averages', presetId: null, glyph: 'portfolio', tone: 'neutral' },
];
/** The query a setup card stands for (its preset's query), or null for the portfolio card. */
export function cardQuery(card: SetupCard): PineQuery | null {
  if (!card.presetId) return null;
  return BUILT_IN_PINE_SCREENS.find((s) => s.id === card.presetId)?.q || null;
}
/** How many companies each pattern card finds on these rows (strict matches only), within the company list when one is chosen.
 *  The portfolio card counts the holdings (all of them — with or without a pattern); null while the holdings are not known. */
export function setupCounts(rows: readonly ScreenRow[], market: ScreenMarket, list: ReadonlySet<string> | null, holdings: readonly string[] | null, now: Date = new Date()): Record<string, number | null> {
  const base = list ? rows.filter((r) => list.has(r.t.toUpperCase())) : rows;
  const out: Record<string, number | null> = {};
  for (const c of SETUP_CARDS) {
    const q = cardQuery(c);
    out[c.id] = q ? runPineFull(base, q, market, now).strict.length : holdings ? holdings.length : null;
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
  /** the close compared with the averages: the scan close (the same daily bars the averages are worked out from) */
  close: number | null;
  /** 'scan' = the scan close; 'quote' = the latest quote, used only when the row has no scan close (older data) */
  basis: 'scan' | 'quote' | null;
  at: string | null;
  /** % above (+) / below (−) each simple average; null when the average is not known (too little history) */
  d21: number | null; d50: number | null; d200: number | null;
}
const distTo = (c: number | null, ma: unknown): number | null => (c != null && fin(ma) && ma > 0 ? Math.round((c / ma - 1) * 1000) / 10 : null);
export function maPosition(r: Partial<ScreenRow>): MaPosition {
  const sc = tagScanClose(r, { tf: 'D' });
  const close = sc.px != null && sc.px > 0 ? sc.px : fin(r.px) && r.px > 0 ? r.px : null;
  const basis = sc.px != null && sc.px > 0 ? 'scan' : close != null ? 'quote' : null;
  return { close, basis, at: basis === 'scan' ? sc.at : r.pxAt || null, d21: distTo(close, r.sma21), d50: distTo(close, r.sma50), d200: distTo(close, r.sma200) };
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
export const stageWord = (t: Pick<ScreenPatternTag, 's' | 'b'>) => (t.s === 'f' ? 'forming' : t.s === 'b' ? (t.b === 'U' ? 'broke out' : 'broke down') : (t.b === 'U' ? 'breakout failed' : 'breakdown failed'));
export const tfWord = (tf?: string | null) => (tf === 'W' ? 'weekly' : tf === 'M' ? 'monthly' : 'daily');
export { tagLengthText, tagScanClose };

// ── plain verdict words (from the numbers only; never buy / sell) ──────────────────────────────────────────────────────
export type VerdictTone = 'up' | 'down' | 'mixed' | 'none';
export interface Verdict { word: string; tone: VerdictTone; why: string }
export function maVerdict(ma: MaPosition, tags: readonly ScreenPatternTag[] = []): Verdict {
  // zzz1001 — "Breaking out / down" only from a DAILY pattern that broke in the last few sessions; an older weekly / monthly
  // breakdown is shown as a chip but does not override where the price sits against its averages (seen: AARTIPHARM 'Breaking
  // down' while 18% above its 200-day, from a monthly double top)
  const live = tags.filter((t) => t.s === 'b' && (t.tf == null || t.tf === 'D'));
  const down = live.find((t) => t.b === 'D'), up = live.find((t) => t.b === 'U');
  if (down) return { word: 'Breaking down', tone: 'down', why: `${PATTERN_META[down.id]?.label || down.id} (${tfWord(down.tf)}) closed through its breakdown level` };
  if (ma.close == null) return { word: 'No price data', tone: 'none', why: 'No close is stored for this company yet' };
  if (up) return { word: 'Breaking out', tone: 'up', why: `${PATTERN_META[up.id]?.label || up.id} (${tfWord(up.tf)}) closed above its pivot` };
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
export interface PortfolioCheckRow {
  /** the holding as saved (normalised) */
  ticker: string;
  /** the screener row, null when the company is not in this market's data (unlisted here, renamed, or not read yet) */
  row: ScreenRow | null;
  patterns: TfPatterns[];
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
    const ma = row ? maPosition(row) : { close: null, basis: null, at: null, d21: null, d50: null, d200: null };
    const verdict: Verdict = row ? maVerdict(ma, tags) : { word: 'Not in the data', tone: 'none', why: 'This holding is not in this market\'s screener data (another market, a new listing or a changed symbol)' };
    out.push({ ticker: t, row, patterns, best: tags.length ? bestTag(tags) : null, ma, verdict });
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
