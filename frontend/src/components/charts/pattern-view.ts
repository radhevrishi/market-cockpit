// zzz982 — "Automate chart patterns" indicator for /charts: the pure pieces (no React, no chart engine).
//  • whether the indicator is on in the working layout, and turning it on / off
//  • where the DAILY bars come from (the bars on screen when they are daily and long enough, otherwise one daily fetch)
//  • the one-line status banner (text + bullish / bearish / none tone + colours)
//  • converting a PatternHit's lines into chart overlay points (snapped onto the bars on screen, e.g. weekly candles)
//  • the identity guard: hits computed for one symbol are never shown on another
//  • zzz990 — a data revision of the bars (any OHLCV change re-runs detection), truthful unavailable / too-short states,
//    failed structures in amber after active ones, "opposing structure present", "volume not confirmed", and a sloped
//    line that collapses into one candle on W / M is left out (never redrawn as a fake horizontal level)
//  • zzz992 — the ANALYSIS timeframe D / W / M (separate from the candles on screen): the remembered choice, the daily
//    history it needs, banner words / badge, and the "Fit pattern" zoom plan
// The detection itself is lib/chart-patterns (detectPatterns / patternHeadline); nothing here re-implements it.
import { patternHeadline, patternLengthWords, PATTERN_MIN_HISTORY, POINT_ROLES, type PatternBias, type PatternHit, type PatternId, type PatternLine, type PatternTimeframe, type PointRole } from '@/lib/chart-patterns';
import { newExtra, type ChartLayout } from '@/lib/chart-layouts';
import { readableOn } from '@/lib/readable-color';

export const PATTERN_GROUP = 'mc-patterns';
export const PATTERN_OVERLAY = 'mcPatternLine';
/** zzz1009 — one turning point (kline-setup 'mcPatternPoint'), in the same overlay group */
export const PATTERN_POINT = 'mcPatternPoint';
/** Daily history fetched for detection when the chart on screen is not daily or too short (the engine reads ~700 bars). */
export const PATTERN_DAILY_RANGE = '5y';
const LONG_ENOUGH = new Set(['5y', '10y', 'max']);
/** zzz992 — monthly analysis reads up to 60 monthly bars (multi-year bases): ten years of daily history. */
export const PATTERN_MONTHLY_RANGE = '10y';
const LONG_ENOUGH_M = new Set(['10y', 'max']);

// ── analysis timeframe (per viewer, like the price basis; never part of the saved drawings) ─────────────────────
export const PATTERN_TF_KEY = 'mc:chart-pattern-tf:v1';
export interface PatternTfPref { tf: PatternTimeframe; provisional: boolean }
export const DEFAULT_PATTERN_TF: PatternTfPref = { tf: 'D', provisional: false };
/** The stored choice; anything unreadable → daily, completed periods only. */
export function parsePatternTfPref(raw: string | null | undefined): PatternTfPref {
  try {
    const j = JSON.parse(String(raw ?? ''));
    const tf: PatternTimeframe = j?.tf === 'W' || j?.tf === 'M' ? j.tf : 'D';
    return { tf, provisional: tf !== 'D' && j?.provisional === true };
  } catch { return DEFAULT_PATTERN_TF; }
}
export const serializePatternTfPref = (p: PatternTfPref) => JSON.stringify({ tf: p.tf, provisional: p.tf !== 'D' && p.provisional });
/** zzz1008 — the Pine Screener's chart hand-off: ?atf=<D|W|M>&pat=<pattern id>&pf=<YYYY-MM-DD>&pt=<YYYY-MM-DD>. The chart opens the
 *  pattern indicator on the analysis timeframe `atf` (for this visit — the viewer's saved choice is not changed), selects `pat` and
 *  fits the window pf → pt (or the hit's own span) with room for the prior trend before it. null = no hand-off. */
export interface PatternHandoff { atf: PatternTimeframe; pat: PatternId | null; from: number | null; to: number | null }
export function parsePatternHandoff(get: (k: string) => string | null | undefined, ids: ReadonlyArray<string>): PatternHandoff | null {
  const atfRaw = (get('atf') || '').toUpperCase();
  const pat = get('pat') || '';
  if (!atfRaw && !pat) return null;
  const atf: PatternTimeframe = atfRaw === 'W' || atfRaw === 'M' ? atfRaw : 'D';
  const day = (k: string) => { const v = get(k) || ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null; const t = Date.parse(`${v}T00:00:00Z`); return Number.isFinite(t) ? t : null; };
  return { atf, pat: ids.includes(pat) ? pat as PatternId : null, from: day('pf'), to: day('pt') };
}
/** The span to fit for a handed-off pattern: its window (or the hit's span) plus 60% of its length before it (the prior trend). */
export function handoffSpan(h: Pick<PatternHit, 'startT' | 'endT'>, ho: Pick<PatternHandoff, 'from' | 'to'> | null): { startT: number; endT: number } {
  const a = ho?.from ?? h.startT, b = Math.max(ho?.to ?? h.endT, h.endT);
  return { startT: a - Math.max(0, b - a) * 0.6, endT: b };
}
export const TF_WORD: Record<PatternTimeframe, string> = { D: 'daily', W: 'weekly', M: 'monthly' };
/** The identity of one analysis: the symbol key plus timeframe (+ provisional) — hits of one never show under another. */
export const analysisKey = (key: string, tf: PatternTimeframe, provisional: boolean) => (tf === 'D' ? key : `${key}|${tf}${provisional ? '+p' : ''}`);

// ── layout on / off ─────────────────────────────────────────────────────────────
export function patternsOn(l: ChartLayout | null | undefined): boolean {
  return !!l?.extras?.some((x) => x.type === 'PAT' && x.on);
}
/** Turn the indicator on (adds it to the working layout) or off (removes it, so the layout is unchanged from before). */
export function withPatterns(l: ChartLayout, on: boolean): ChartLayout {
  const rest = l.extras.filter((x) => x.type !== 'PAT');
  return { ...l, extras: on ? [...rest, newExtra('PAT')] : rest };
}

// ── identity + data source ──────────────────────────────────────────────────────
/** One key per symbol on screen + price basis (lines drawn at total-return prices would not fit printed prices). */
export function patternKey(market: string, ticker: string, exchange: string | undefined, basis: 'price' | 'tr'): string {
  return `${market}:${market === 'IN' ? (exchange || '') : ''}:${String(ticker || '').toUpperCase()}:${basis}`;
}
/** 'unavailable' = the chart has no price data for this symbol; 'short' = too little history to analyse (error holds the
 *  words, e.g. "Too little history (21 bars)"); 'error' = loading the daily bars or the detection itself failed. */
export interface PatternState {
  key: string; hits: PatternHit[]; at: number; status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable' | 'short'; error?: string;
  /** zzz992 — W / M: the last analysed candle is the current, unfinished period; and the last daily bar inside it */
  provisional?: boolean; periodEnd?: number | null;
  /** zzz1009 — the engine's weaker candidates and expired structures (analyze… with weak: true) */
  weak?: PatternHit[]; expired?: PatternHit[];
}
export const EMPTY_PATTERNS: PatternState = { key: '', hits: [], at: 0, status: 'idle' };
/** Hits only when they were computed for the symbol now on screen; anything else (the previous symbol) gives none. */
export function hitsFor(state: PatternState | null | undefined, key: string): PatternHit[] {
  return state && state.key === key ? state.hits : [];
}
export function statusFor(state: PatternState | null | undefined, key: string): PatternState['status'] {
  return state && state.key === key ? state.status : 'loading';
}
/**
 * zzz990 (CP-07) — the status shown, given the main chart's own load state: when the chart has no response for this symbol
 * and its load ended in an error, the indicator says the price data is unavailable instead of "looking…" forever.
 */
export function shownStatus(state: PatternState | null | undefined, key: string, hasLive: boolean, chart?: { loading?: boolean; error?: string | null } | null): { status: PatternState['status']; error?: string } {
  if (!hasLive) {
    if (chart && !chart.loading && chart.error) return { status: 'unavailable', error: chart.error };
    return { status: 'loading' };
  }
  return { status: statusFor(state, key), error: state && state.key === key ? state.error : undefined };
}

/**
 * zzz990 (CP-01) — a cheap revision of the bars covering EVERY bar's time, open, high, low, close and volume (not just the
 * count and the last close), so a corrected volume / high / low / earlier bar re-runs detection; identical data gives the
 * same revision (no render loop).
 */
export function barsRevision(bars: ReadonlyArray<{ t: number; o: number; h: number; l: number; c: number; v: number }>): string {
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
  const mix = (x: number) => {
    const q = Number.isFinite(x) ? Math.round(x * 10000) : -7777777;
    const lo = q | 0, hi = Math.floor(q / 4294967296) | 0;
    h1 = Math.imul(h1 ^ lo, 16777619); h1 = Math.imul(h1 ^ hi, 16777619);
    h2 = Math.imul(h2 ^ (lo >>> 7 | lo << 25), 2246822519); h2 = (h2 ^ hi) + 0x9e3779b9 | 0;
  };
  for (const b of bars) { mix(b.t); mix(b.o); mix(b.h); mix(b.l); mix(b.c); mix(b.v); }
  return `${bars.length}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** The daily-chart URL (same format as the chart page's own load, so both share one cache entry). */
export function dailyUrl(ticker: string, market: string, exchange: string | undefined, basis: 'price' | 'tr', range = PATTERN_DAILY_RANGE): string {
  return `/api/v1/chart/${encodeURIComponent(ticker)}?market=${market}&interval=1d&range=${range}${market === 'IN' && exchange ? `&exchange=${exchange}` : ''}${basis === 'tr' ? '&basis=tr&adj=2' : ''}`;
}
/** Use the bars already on screen when the loaded response is daily and covers ≥ 5 years; otherwise fetch `url`. */
export function patternDataPlan(shown: { interval?: string; range?: string } | null, ticker: string, market: string, exchange: string | undefined, basis: 'price' | 'tr', tf: PatternTimeframe = 'D'): { useShown: boolean; url: string } {
  // zzz992 — monthly analysis wants 10 years of daily bars (weekly / monthly are aggregated from the daily history)
  const enough = tf === 'M' ? LONG_ENOUGH_M : LONG_ENOUGH;
  const useShown = !!shown && shown.interval === '1d' && enough.has(String(shown.range || ''));
  return { useShown, url: dailyUrl(ticker, market, exchange, basis, tf === 'M' ? PATTERN_MONTHLY_RANGE : PATTERN_DAILY_RANGE) };
}

// ── banner ──────────────────────────────────────────────────────────────────────
export function currencyPrefix(market: string, currency?: string | null): string {
  if (currency === 'INR') return '₹';
  if (currency === 'USD') return '$';
  if (currency) return `${currency} `;
  return market === 'IN' ? '₹' : '$';
}
const money = (n: number, cur: string, decimals: number) => `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
export const priceDecimals = (n: number | null | undefined) => (n != null && Math.abs(n) < 1 ? 4 : 2);

export type BannerTone = 'bullish' | 'bearish' | 'failed' | 'none';
export interface Banner { text: string; tone: BannerTone }
/** Bullish and bearish structures both active (forming / breaking out) on the same chart. */
export const opposingActive = (hits: PatternHit[]) => {
  const act = hits.filter((h) => h.stage !== 'failed');
  return act.some((h) => h.bias === 'bullish') && act.some((h) => h.bias === 'bearish');
};
export function bannerOf(hits: PatternHit[], cur: string, status: PatternState['status'] = 'ready', error?: string, tf: PatternTimeframe = 'D'): Banner {
  const w = TF_WORD[tf];
  if (status === 'loading' || status === 'idle') return { text: `📐 Looking for chart patterns on the ${w} bars…`, tone: 'none' };
  if (status === 'unavailable') return { text: '📐 No price data — patterns unavailable', tone: 'none' };
  if (status === 'short') return { text: `📐 ${error || 'Too little history'} — patterns need at least ${PATTERN_MIN_HISTORY[tf]} ${w} bars`, tone: 'none' };
  if (status === 'error') return { text: `📐 Chart patterns: ${error || 'the daily bars could not be loaded'}`, tone: 'none' };
  if (!hits.length) return { text: tf === 'D' ? '📐 No clear chart pattern' : `📐 No clear ${w} chart pattern`, tone: 'none' };
  let text = `📐 ${patternHeadline(hits, (n) => money(n, cur, priceDecimals(n)))}`;
  if (opposingActive(hits)) text += ' · opposing structure present';
  if (hits[0].volumeOk === false) text += ' · volume not confirmed';
  return { text, tone: hits[0].stage === 'failed' ? 'failed' : hits[0].bias };
}
export const BULL_COLOR = '#089981', BEAR_COLOR = '#F23645', FAILED_COLOR = '#D97706', NONE_COLOR = '#787B86';
export const biasColor = (b: PatternBias | BannerTone) => (b === 'bullish' ? BULL_COLOR : b === 'bearish' ? BEAR_COLOR : b === 'failed' ? FAILED_COLOR : NONE_COLOR);
/** Line / swatch colour of one hit: amber for a failed structure, else its bias colour. */
export const hitColor = (h: Pick<PatternHit, 'bias' | 'stage'>) => (h.stage === 'failed' ? FAILED_COLOR : biasColor(h.bias));
/** zzz990 — the confidence as what it is: a heuristic shape score, not a probability. */
export const shapeScoreWords = (h: Pick<PatternHit, 'confidence'>) => `shape score ${Math.round(h.confidence * 100)}/100`;
/** Tinted background + readable text for the white or dark workspace. */
export function bannerColors(tone: BannerTone, light: boolean): { bg: string; border: string; text: string } {
  const page = light ? '#FFFFFF' : '#0A0E1A';
  const c = biasColor(tone);
  const rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(',');
  const a = light ? 0.1 : 0.18;
  // text must read on the tint, which is nearly the page colour
  const tint = blend(c, page, a);
  return { bg: `rgba(${rgb},${a})`, border: `rgba(${rgb},${light ? 0.45 : 0.55})`, text: readableOn(tone === 'none' ? (light ? '#475569' : '#B2B5BE') : c, tint) };
}
function blend(color: string, page: string, a: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const c = p(color), b = p(page);
  return '#' + c.map((v, i) => Math.round(v * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}

// ── dropdown rows ───────────────────────────────────────────────────────────────
export function stageWords(h: PatternHit): string {
  const bull = h.bias === 'bullish';
  // zzz1008 — a breakout back on the near side of its level says so (the event stays, the current condition is added)
  const back = h.stage === 'breakout' && h.distToPivotPct != null && (bull ? h.distToPivotPct < 0 : h.distToPivotPct > 0);
  return h.stage === 'forming' ? 'forming' : h.stage === 'breakout' ? (back ? (bull ? 'broke out · back below pivot' : 'broke down · back above level') : bull ? 'breaking out' : 'breaking down') : (bull ? 'breakout failed' : 'breakdown failed');
}
export function distWords(h: PatternHit): string {
  const d = h.distToPivotPct;
  if (d == null) return '—';
  return Math.abs(d) < 0.5 ? 'at the level' : `${Math.abs(d).toFixed(1)}% ${d < 0 ? 'below' : 'above'}`;
}
export const lengthWords = (bars: number, tf: PatternTimeframe = 'D') => patternLengthWords(bars, tf);

// ── overlay points ──────────────────────────────────────────────────────────────
export interface PatternOverlayLine {
  id: PatternId; kind: PatternLine['kind'];
  points: Array<{ timestamp: number; value: number }>;
  color: string; dashed: boolean; size: number;
  /** Text at the right end of the line (pivot only), e.g. "Pivot 512.40". */
  label?: string;
}
/** The bar on screen that holds time t (latest bar time ≤ t); times before the first bar stay as they are (drawn off-screen left). */
export function snapTime(times: number[], t: number): number {
  if (!times.length || t < times[0]) return t;
  let lo = 0, hi = times.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return times[ans];
}
/** Two prices that are the same level (a horizontal line), within rounding. */
const sameLevel = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
/**
 * A hit's lines as overlay specs: pivot = dashed horizontal with a label; support / resistance / neckline / trend = thin solid.
 * zzz990 (CP-06): when both ends of a line snap into ONE candle on screen (a short daily structure on W / M), only a true
 * equal-price level becomes a short horizontal tick; a sloping line is left out (counted in `omitted`) — never flattened
 * into a level the pattern does not have.
 */
export interface OverlayFitOptions {
  /** zzz1009 — a line that starts before the first candle on screen starts AT it (its value interpolated along the line); a line
   *  wholly before it is left out (counted in `offLeft`). Without it, a start before the first candle is extrapolated by the chart
   *  in calendar time, which bends the slope of a long weekly / monthly line on a shorter daily chart. */
  clip?: boolean;
  /** zzz1009 — a horizontal pivot that ends before this time (W / M analysis of completed periods) is carried to it */
  extendPivotTo?: number | null;
}
export function overlayFit(hit: PatternHit, shownTimes: number[], fmt: (n: number) => string = (n) => n.toFixed(2), o: OverlayFitOptions = {}): { lines: PatternOverlayLine[]; omitted: number; offLeft: number } {
  const color = hitColor(hit);
  const out: PatternOverlayLine[] = [];
  let omitted = 0, offLeft = 0;
  for (const ln of hit.lines || []) {
    let pts = (ln.points || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2) continue;
    if (o.clip && shownTimes.length) {
      const t0 = shownTimes[0], [p0, p1] = [pts[0], pts[pts.length - 1]];
      if (p1[0] < t0) { offLeft++; continue; }
      if (p0[0] < t0) pts = [[t0, p1[0] === p0[0] ? p0[1] : p0[1] + ((p1[1] - p0[1]) * (t0 - p0[0])) / (p1[0] - p0[0])], p1];
    }
    if (o.extendPivotTo != null && ln.kind === 'pivot' && sameLevel(pts[0][1], pts[pts.length - 1][1]) && pts[pts.length - 1][0] < o.extendPivotTo) pts = [pts[0], [o.extendPivotTo, pts[pts.length - 1][1]]];
    let a = { timestamp: snapTime(shownTimes, pts[0][0]), value: pts[0][1] };
    let b = { timestamp: snapTime(shownTimes, pts[pts.length - 1][0]), value: pts[pts.length - 1][1] };
    if (a.timestamp === b.timestamp) {
      if (!sameLevel(a.value, b.value)) { omitted++; continue; }   // a sloping line inside one candle: not drawable here
      // a single-point level (e.g. the low of a cup): a short horizontal tick, two bars either side on the chart on screen
      const i = shownTimes.indexOf(a.timestamp);
      if (i < 0) continue;
      a = { timestamp: shownTimes[Math.max(0, i - 2)], value: a.value };
      b = { timestamp: shownTimes[Math.min(shownTimes.length - 1, i + 2)], value: a.value };
      if (a.timestamp === b.timestamp) continue;
    }
    const pivot = ln.kind === 'pivot';
    out.push({
      id: hit.id, kind: ln.kind, points: [a, b], color, dashed: pivot, size: pivot ? 1.5 : 1,
      ...(pivot ? { label: `${hit.bias === 'bullish' ? 'Pivot' : 'Breakdown'} ${fmt(b.value)}` } : {}),
    });
  }
  return { lines: out, omitted, offLeft };
}
export function overlayLinesOf(hit: PatternHit, shownTimes: number[], fmt?: (n: number) => string): PatternOverlayLine[] {
  return overlayFit(hit, shownTimes, fmt).lines;
}
/** Which hits to draw: the lead pattern until the owner ticks / unticks rows in the dropdown (`picked` = null → lead only). */
export function hitsToDraw(hits: PatternHit[], picked: ReadonlySet<PatternId> | null): PatternHit[] {
  return picked ? hits.filter((h) => picked.has(h.id)) : hits.slice(0, 1);
}
/** Tick / untick one row; the first change starts from what is drawn now (the lead). */
export function togglePicked(hits: PatternHit[], picked: ReadonlySet<PatternId> | null, id: PatternId): Set<PatternId> {
  const next = new Set<PatternId>(hitsToDraw(hits, picked).map((h) => h.id));
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

// ── "Fit pattern" (zoom the chart to a pattern's span) ──────────────────────────
/**
 * zzz992 — how to show [startT, endT] on the candles on screen: the bar spacing so the span plus 15% each side (at least
 * 3 candles) fills `width`, and the bar index to put at the right edge. null when the span is not on screen.
 */
export function fitPlan(times: number[], startT: number, endT: number, width: number, minSpace = 1, maxSpace = 50): { space: number; rightIndex: number } | null {
  if (!times.length || !(width > 0) || !Number.isFinite(startT) || !Number.isFinite(endT)) return null;
  const idx = (t: number) => { const s = snapTime(times, t); const i = times.indexOf(s); return i < 0 ? 0 : i; };
  const i0 = idx(Math.min(startT, endT)), i1 = idx(Math.max(startT, endT));
  const span = i1 - i0 + 1;
  const pad = Math.max(3, Math.round(span * 0.15));
  const left = Math.max(0, i0 - pad), right = Math.min(times.length - 1, i1 + pad);
  const space = Math.min(maxSpace, Math.max(minSpace, width / (right - left + 1)));
  return { space, rightIndex: right };
}

// ── zzz1009 — the indicator's headline view: what is current, what is weaker, what has expired ─────────────────
// The engine (lib/chart-patterns) reports every shape whose stage is current: forming, breaking out (≤ 5 sessions / this or
// the last candle), or failed within its failed window (40 sessions / 8 weeks / 2 months). The chart's ONE-LINE headline is
// stricter, so a months-old failed structure never leads while the stock is in a new trend (seen: PENG "Possibly failed
// breakdown: Bear flag … 27% above" with the stock at a new high):
//  1. current — breakouts holding beyond the level and forming structures near their level (≤ NEAR_PIVOT_PCT);
//  2. current — forming structures with the price still inside them, but not near the level (1 and 2 rank together by shape
//     score, 1 with ACTIVE_NEAR_BONUS);
//  3. current — breakouts back on the near side of the level;
//     (also a breakout up to RECENT_BREAK_BARS old that the engine already calls complete — holding → 1, back → 3);
//  4. current — failed structures only when the break was ≤ FAILED_RECENT_BARS ago, the price is ≤ FAILED_MAX_AWAY_PCT
//     beyond the level, and no newer opposite structure is current;
//  everything else is listed apart: "expired / invalidated" (stale failures, completed breakouts, boundaries that ran out,
//  reversals the price ran away from) and "weaker candidates" (sub-threshold shape scores; forming shapes the price has left).
export const NEAR_PIVOT_PCT = 8;
export const FAILED_RECENT_BARS: Record<PatternTimeframe, number> = { D: 15, W: 3, M: 2 };
export const FAILED_MAX_AWAY_PCT = 12;
/** a breakout up to this many bars old is still "recent" (the engine's own breakout window is 5 sessions / 2 candles) */
export const RECENT_BREAK_BARS: Record<PatternTimeframe, number> = { D: 15, W: 3, M: 2 };
/** an expired structure whose break is older than this (bars) is not listed at all (~6 months D, ~6 months W, a year M) */
export const EXPIRED_KEEP_BARS: Record<PatternTimeframe, number> = { D: 130, W: 26, M: 12 };
/** a forming structure the close has left by more than this share of its price range is a weaker candidate, not current */
export const LEFT_STRUCTURE_PCT = 3;
/** shape-score bonus of a structure near its level / a breakout holding, when ranked against forming structures further away */
export const ACTIVE_NEAR_BONUS = 0.15;

export type PatternViewState = 'pending' | 'missing' | 'insufficient' | 'error' | 'qualifying' | 'weaker-only' | 'expired-only' | 'none';
export interface PatternViewRow { hit: PatternHit; why?: string }
export interface PatternView {
  state: PatternViewState;
  /** the current (active) structures, headline first (tiers above) */
  active: PatternHit[];
  /** expired / invalidated: stale failures and the engine's expired list */
  expired: PatternViewRow[];
  /** weaker candidates (shown only on request) */
  weaker: PatternViewRow[];
}
export interface PatternViewInput {
  hits: PatternHit[]; weak?: PatternHit[]; expired?: PatternHit[];
  status?: PatternState['status']; tf?: PatternTimeframe;
}

/** "3 days ago" / "2 wk ago" / "5 mo ago" for `bars` bars of the timeframe. */
export function agoWords(bars: number | undefined, tf: PatternTimeframe = 'D'): string {
  if (bars == null || !Number.isFinite(bars)) return '';
  if (bars <= 0) return tf === 'D' ? 'today' : tf === 'W' ? 'this week' : 'this month';
  if (tf === 'W') return `${bars} wk ago`;
  if (tf === 'M') return `${bars} mo ago`;
  return bars >= 10 ? `${Math.round(bars / 5)} wk ago` : `${bars} day${bars === 1 ? '' : 's'} ago`;
}
/** The price range of a hit's drawn structure (its lines and turning points). */
export function structureRange(h: Pick<PatternHit, 'lines' | 'points' | 'pivot'>): { lo: number; hi: number } | null {
  const ps: number[] = [];
  for (const ln of h.lines || []) for (const p of ln.points || []) if (Number.isFinite(p[1]) && p[1] > 0) ps.push(p[1]);
  for (const q of h.points || []) if (Number.isFinite(q.p) && q.p > 0) ps.push(q.p);
  if (h.pivot != null && h.pivot > 0) ps.push(h.pivot);
  return ps.length ? { lo: Math.min(...ps), hi: Math.max(...ps) } : null;
}
/** The analysed close, from a hit's level and its distance to it. */
export const closeOf = (h: Pick<PatternHit, 'pivot' | 'distToPivotPct'>) => (h.pivot != null && h.distToPivotPct != null ? h.pivot * (1 + h.distToPivotPct / 100) : null);
/** A breakout whose close is back on the near side of its level. */
export const backThrough = (h: Pick<PatternHit, 'stage' | 'bias' | 'distToPivotPct'>) => h.stage === 'breakout' && h.distToPivotPct != null && (h.bias === 'bullish' ? h.distToPivotPct < 0 : h.distToPivotPct > 0);
/** Near the level: bullish within NEAR_PIVOT_PCT below (or just above) the pivot; bearish within NEAR_PIVOT_PCT above the breakdown. */
export function nearLevel(h: Pick<PatternHit, 'bias' | 'distToPivotPct'>): boolean {
  const d = h.distToPivotPct;
  if (d == null) return false;
  return h.bias === 'bullish' ? d >= -NEAR_PIVOT_PCT && d <= 3 : d <= NEAR_PIVOT_PCT && d >= -3;
}
/** The close has left a forming structure (outside its price range by more than LEFT_STRUCTURE_PCT of the range). */
export function leftStructure(h: PatternHit): boolean {
  const r = structureRange(h), c = closeOf(h);
  if (!r || c == null || !(r.hi > r.lo)) return false;
  const pad = ((r.hi - r.lo) * LEFT_STRUCTURE_PCT) / 100 + r.hi * 0.01;
  return c < r.lo - pad || c > r.hi + pad;
}
const EXPIRED_WORDS = (h: PatternHit, tf: PatternTimeframe): string => {
  const bull = h.bias === 'bullish', ago = agoWords(h.breakAgo, tf);
  switch (h.expired) {
    case 'completed': return `${bull ? 'broke out' : 'broke down'} ${ago}${backThrough({ ...h, stage: 'breakout' }) ? (bull ? ', now back below the pivot' : ', now back above the level') : ' — completed'}`;
    case 'failed-old': return `${bull ? 'breakout' : 'breakdown'} failed (break ${ago})`;
    case 'apex': return 'its boundary ran out without a break';
    case 'ran-away': return `price has run away from it (${bull ? 'at the 1-year high' : 'at the 1-year low'})`;
    default: return '';
  }
};
/** Split the engine's output into the headline order, expired and weaker lists, plus the banner state. */
export function patternView(inp: PatternViewInput): PatternView {
  const tf = inp.tf ?? 'D';
  const st = inp.status ?? 'ready';
  const empty = { active: [], expired: [], weaker: [] };
  if (st === 'loading' || st === 'idle') return { state: 'pending', ...empty };
  if (st === 'unavailable') return { state: 'missing', ...empty };
  if (st === 'short') return { state: 'insufficient', ...empty };
  if (st === 'error') return { state: 'error', ...empty };
  const hits = inp.hits || [];
  const tier = new Map<PatternHit, number>();
  const expired: PatternViewRow[] = [], weaker: PatternViewRow[] = [];
  const activeOf = (h: PatternHit) => h.stage !== 'failed';
  for (const h of hits) {
    if (h.stage === 'failed') {
      const ago = h.breakAgo;
      const away = h.distToPivotPct == null ? 0 : Math.abs(h.distToPivotPct);
      const newerOpposite = hits.some((o) => o !== h && activeOf(o) && o.bias !== h.bias && o.endT >= h.endT && (o.startT >= h.startT || o.confidence >= h.confidence));
      if (ago != null && ago > FAILED_RECENT_BARS[tf]) { expired.push({ hit: h, why: `${h.bias === 'bullish' ? 'breakout' : 'breakdown'} failed — the break was ${agoWords(ago, tf)}` }); continue; }
      if (away > FAILED_MAX_AWAY_PCT) { expired.push({ hit: h, why: `failed — price is now ${away.toFixed(0)}% ${h.distToPivotPct! < 0 ? 'below' : 'above'} the level` }); continue; }
      if (newerOpposite) { expired.push({ hit: h, why: 'failed — a newer opposite structure is current' }); continue; }
      tier.set(h, 4);
    } else if (h.stage === 'breakout') {
      tier.set(h, backThrough(h) ? 3 : 1);
    } else if (leftStructure(h)) {
      weaker.push({ hit: h, why: 'the price has left the structure' });
    } else tier.set(h, nearLevel(h) ? 1 : 2);
  }
  // tiers 1 and 2 are both active: a near-the-level / holding breakout gets ACTIVE_NEAR_BONUS on top of its shape score, so a much
  // stronger structure a little further from its level still leads (e.g. a very likely double bottom over the small wedge breakout
  // that is its right side)
  const group = (h: PatternHit) => (tier.get(h)! <= 2 ? 0 : tier.get(h)!);
  const rank = (h: PatternHit) => h.confidence + (tier.get(h) === 1 ? ACTIVE_NEAR_BONUS : 0);
  // a breakout a little older than the engine's breakout window (5 sessions / 2 candles) is still a recent breakout: holding
  // (tier 1) or back on the near side of its level (tier 3), while it is ≤ RECENT_BREAK_BARS old and ≤ FAILED_MAX_AWAY_PCT away
  const promoted: PatternHit[] = [];
  const restExpired: PatternHit[] = [];
  for (const h of inp.expired || []) {
    const d = h.distToPivotPct;
    if (h.expired === 'completed' && h.breakAgo != null && h.breakAgo <= RECENT_BREAK_BARS[tf] && d != null && Math.abs(d) <= FAILED_MAX_AWAY_PCT
      && !hits.some((o) => o.id === h.id)) {
      const { expired: _x, ...live } = h;
      const ph: PatternHit = { ...live, stage: 'breakout' };
      promoted.push(ph); tier.set(ph, backThrough(ph) ? 3 : 1);
    } else restExpired.push(h);
  }
  const current = [...hits, ...promoted].filter((h) => tier.has(h)).sort((a, b) => group(a) - group(b) || rank(b) - rank(a));
  for (const h of restExpired) if (h.breakAgo == null || h.breakAgo <= EXPIRED_KEEP_BARS[tf]) expired.push({ hit: h, why: EXPIRED_WORDS(h, tf) });
  for (const h of inp.weak || []) weaker.push({ hit: h, why: `shape score below ${Math.round(0.35 * 100)}` });
  // most recent first (a missing break time = unbroken, last)
  expired.sort((a, b) => (a.hit.breakAgo ?? 1e9) - (b.hit.breakAgo ?? 1e9));
  weaker.sort((a, b) => b.hit.confidence - a.hit.confidence);
  const state: PatternViewState = current.length ? 'qualifying' : weaker.length ? 'weaker-only' : expired.length ? 'expired-only' : 'none';
  return { state, active: current, expired, weaker };
}

const shortDate = (t: number | null | undefined) => {
  if (t == null || !Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const TF_TITLE: Record<PatternTimeframe, string> = { D: 'Daily', W: 'Weekly', M: 'Monthly' };
/** The condition words of one hit, e.g. "forming · pivot ₹512.40, 3% below" / "broke out 2 days ago, back below the pivot". */
export function conditionWords(h: PatternHit, cur: string): string {
  const bull = h.bias === 'bullish';
  const tf = h.timeframe ?? 'D';
  const lvl = h.pivot != null ? `${bull ? 'pivot' : 'breakdown'} ${money(h.pivot, cur, priceDecimals(h.pivot))}` : '';
  const d = h.distToPivotPct;
  const dist = d == null ? '' : Math.abs(d) < 0.5 ? 'at the level' : `${Math.abs(d).toFixed(0)}% ${d < 0 ? 'below' : 'above'}`;
  const ago = agoWords(h.breakAgo, tf);
  const what = h.stage === 'forming' ? 'forming'
    : h.stage === 'breakout' ? `${bull ? 'broke out' : 'broke down'}${ago ? ` ${ago}` : ''}${backThrough(h) ? (bull ? ', back below the pivot' : ', back above the level') : ''}`
      : `${bull ? 'breakout' : 'breakdown'} failed${ago ? ` (break ${ago})` : ''}`;
  return [what, [lvl, dist].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
}
/**
 * zzz1009 — the banner of the view: "Pattern · Timeframe · condition · shape score · analysis date", or the state in words
 * (pending / no data / too little history / error / no qualifying pattern — with the weaker or expired count).
 */
export function viewBanner(v: PatternView, cur: string, tf: PatternTimeframe = 'D', opts: { error?: string; analysisT?: number | null } = {}): Banner {
  const w = TF_WORD[tf];
  if (v.state === 'pending') return { text: `📐 Looking for chart patterns on the ${w} bars…`, tone: 'none' };
  if (v.state === 'missing') return { text: '📐 No price data — patterns unavailable', tone: 'none' };
  if (v.state === 'insufficient') return { text: `📐 ${opts.error || 'Too little history'} — patterns need at least ${PATTERN_MIN_HISTORY[tf]} ${w} bars`, tone: 'none' };
  if (v.state === 'error') return { text: `📐 Chart patterns: ${opts.error || 'the daily bars could not be loaded'}`, tone: 'none' };
  const asOf = shortDate(opts.analysisT);
  if (v.state !== 'qualifying') {
    const head = `📐 No qualifying ${w} pattern${asOf ? ` · ${asOf}` : ''}`;
    if (v.state === 'weaker-only') return { text: `${head} · ${v.weaker.length} weaker candidate${v.weaker.length === 1 ? '' : 's'}`, tone: 'none' };
    if (v.state === 'expired-only') { const x = v.expired[0]; return { text: `${head} · last: ${x.hit.label}, ${x.why}`, tone: 'none' }; }
    return { text: head, tone: 'none' };
  }
  const top = v.active[0];
  const parts = [top.label, TF_TITLE[top.timeframe ?? tf], conditionWords(top, cur), `shape ${Math.round(top.confidence * 100)}/100`];
  if (asOf) parts.push(asOf);
  let text = `📐 ${parts.join(' · ')}`;
  if (v.active.length > 1) text += ` · +${v.active.length - 1} more`;
  if (opposingActive(v.active)) text += ' · opposing structure present';
  if (top.volumeOk === false) text += ' · volume not confirmed';
  return { text, tone: top.stage === 'failed' ? 'failed' : top.bias };
}

/** zzz1009 — the measured rules of a hit in words (from its evidence), for the expandable explanation. */
const EV_WORDS: Record<string, (v: number) => string> = {
  band: (v) => `turning points within ${v}% of each other`, rally: (v) => `middle swing ${v}% off the turning points`, mid: (v) => `middle dip ${v}%`,
  trend: (v) => `prior trend ${v}%`, gap: (v) => `${v} bars between the first and last turning point`, vr: (v) => `volume at the last turning point ${v}× the first`,
  neck: (v) => `neckline change ${v}%`, sh: (v) => `shoulders ${v}× the head's distance from the neckline`, sd: (v) => `shoulders differ ${v}%`,
  depth: (v) => `depth ${v}%`, rec: (v) => `right side ${v}% of the left high`, round: (v) => `${v}% of closes in the lower third (roundness)`,
  hd: (v) => `handle ${v}% deep`, hi1y: (v) => `close ${v}% of the 1-year high`,
};
export function evidenceWords(h: Pick<PatternHit, 'evidence'>): string[] {
  return Object.entries(h.evidence || {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k, v]) => (EV_WORDS[k] ? EV_WORDS[k](v as number) : `${k} ${v}`));
}
export function pointWords(h: Pick<PatternHit, 'points'>, cur: string): string[] {
  return (h.points || []).map((q) => `${POINT_ROLES[q.role] || q.role} ${money(q.p, cur, priceDecimals(q.p))} (${shortDate(q.t)})`);
}

// ── zzz1009 — drawing: turning points and the projection onto the bars on screen ─────────────────────────────
export interface PatternPointMark { id: PatternId; timestamp: number; value: number; role: PointRole; color: string }
/**
 * The turning points of a hit on the candles on screen. A point read on coarser bars (a weekly / monthly candle) is moved to the
 * candle on screen inside that period whose high or low IS the point's price (the real day of the low / high); points older than
 * the first candle on screen are left out (counted).
 */
export function pointMarks(hit: PatternHit, shown: ReadonlyArray<{ t: number; h: number; l: number }>): { marks: PatternPointMark[]; offLeft: number } {
  const color = hitColor(hit);
  const out: PatternPointMark[] = [];
  let offLeft = 0;
  if (!shown.length) return { marks: out, offLeft };
  const times = shown.map((b) => b.t);
  const span = hit.timeframe === 'M' ? 32 * 86_400_000 : hit.timeframe === 'W' ? 7 * 86_400_000 : 1;
  for (const q of hit.points || []) {
    if (!Number.isFinite(q.t) || !Number.isFinite(q.p)) continue;
    if (q.t + span <= times[0]) { offLeft++; continue; }
    let i = times.indexOf(snapTime(times, Math.max(q.t, times[0])));
    if (i < 0) continue;
    let best = i, bd = Infinity;
    for (let j = i; j < shown.length && shown[j].t < q.t + span; j++) {
      const d = Math.min(Math.abs(shown[j].h - q.p), Math.abs(shown[j].l - q.p));
      if (d < bd) { bd = d; best = j; }
    }
    i = best;
    out.push({ id: hit.id, timestamp: times[i], value: q.p, role: q.role, color });
  }
  return { marks: out, offLeft };
}
/** The polyline through a hit's turning points (time order), as overlay segments on the candles on screen. */
export function pointPath(marks: PatternPointMark[], color: string): PatternOverlayLine[] {
  const out: PatternOverlayLine[] = [];
  for (let k = 0; k + 1 < marks.length; k++) {
    const a = marks[k], b = marks[k + 1];
    if (a.timestamp === b.timestamp && a.value === b.value) continue;
    out.push({ id: a.id, kind: 'trend', points: [{ timestamp: a.timestamp, value: a.value }, { timestamp: b.timestamp, value: b.value }], color, dashed: false, size: 1 });
  }
  return out;
}
