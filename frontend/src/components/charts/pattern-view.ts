// zzz982 — "Automate chart patterns" indicator for /charts: the pure pieces (no React, no chart engine).
//  • whether the indicator is on in the working layout, and turning it on / off
//  • where the DAILY bars come from (the bars on screen when they are daily and long enough, otherwise one daily fetch)
//  • the one-line status banner (text + bullish / bearish / none tone + colours)
//  • converting a PatternHit's lines into chart overlay points (snapped onto the bars on screen, e.g. weekly candles)
//  • the identity guard: hits computed for one symbol are never shown on another
// The detection itself is lib/chart-patterns (detectPatterns / patternHeadline); nothing here re-implements it.
import { patternHeadline, type PatternBias, type PatternHit, type PatternId, type PatternLine } from '@/lib/chart-patterns';
import { newExtra, type ChartLayout } from '@/lib/chart-layouts';
import { readableOn } from '@/lib/readable-color';

export const PATTERN_GROUP = 'mc-patterns';
export const PATTERN_OVERLAY = 'mcPatternLine';
/** Daily history fetched for detection when the chart on screen is not daily or too short (the engine reads ~700 bars). */
export const PATTERN_DAILY_RANGE = '5y';
const LONG_ENOUGH = new Set(['5y', '10y', 'max']);

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
export interface PatternState { key: string; hits: PatternHit[]; at: number; status: 'idle' | 'loading' | 'ready' | 'error'; error?: string }
export const EMPTY_PATTERNS: PatternState = { key: '', hits: [], at: 0, status: 'idle' };
/** Hits only when they were computed for the symbol now on screen; anything else (the previous symbol) gives none. */
export function hitsFor(state: PatternState | null | undefined, key: string): PatternHit[] {
  return state && state.key === key ? state.hits : [];
}
export function statusFor(state: PatternState | null | undefined, key: string): PatternState['status'] {
  return state && state.key === key ? state.status : 'loading';
}

/** The daily-chart URL (same format as the chart page's own load, so both share one cache entry). */
export function dailyUrl(ticker: string, market: string, exchange: string | undefined, basis: 'price' | 'tr', range = PATTERN_DAILY_RANGE): string {
  return `/api/v1/chart/${encodeURIComponent(ticker)}?market=${market}&interval=1d&range=${range}${market === 'IN' && exchange ? `&exchange=${exchange}` : ''}${basis === 'tr' ? '&basis=tr&adj=2' : ''}`;
}
/** Use the bars already on screen when the loaded response is daily and covers ≥ 5 years; otherwise fetch `url`. */
export function patternDataPlan(shown: { interval?: string; range?: string } | null, ticker: string, market: string, exchange: string | undefined, basis: 'price' | 'tr'): { useShown: boolean; url: string } {
  const useShown = !!shown && shown.interval === '1d' && LONG_ENOUGH.has(String(shown.range || ''));
  return { useShown, url: dailyUrl(ticker, market, exchange, basis) };
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

export type BannerTone = 'bullish' | 'bearish' | 'none';
export interface Banner { text: string; tone: BannerTone }
export function bannerOf(hits: PatternHit[], cur: string, status: PatternState['status'] = 'ready', error?: string): Banner {
  if (status === 'loading' || status === 'idle') return { text: '📐 Looking for chart patterns on the daily bars…', tone: 'none' };
  if (status === 'error') return { text: `📐 Chart patterns: ${error || 'the daily bars could not be loaded'}`, tone: 'none' };
  if (!hits.length) return { text: '📐 No clear chart pattern', tone: 'none' };
  return { text: `📐 ${patternHeadline(hits, (n) => money(n, cur, priceDecimals(n)))}`, tone: hits[0].bias };
}
export const BULL_COLOR = '#089981', BEAR_COLOR = '#F23645', NONE_COLOR = '#787B86';
export const biasColor = (b: PatternBias | BannerTone) => (b === 'bullish' ? BULL_COLOR : b === 'bearish' ? BEAR_COLOR : NONE_COLOR);
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
  return h.stage === 'forming' ? 'forming' : h.stage === 'breakout' ? (bull ? 'breaking out' : 'breaking down') : (bull ? 'breakout failed' : 'breakdown failed');
}
export function distWords(h: PatternHit): string {
  const d = h.distToPivotPct;
  if (d == null) return '—';
  return Math.abs(d) < 0.5 ? 'at the level' : `${Math.abs(d).toFixed(1)}% ${d < 0 ? 'below' : 'above'}`;
}
export const lengthWords = (bars: number) => (bars >= 10 ? `${Math.max(1, Math.round(bars / 5))} wk` : `${bars} days`);

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
/** A hit's lines as overlay specs: pivot = dashed horizontal with a label; support / resistance / neckline / trend = thin solid. */
export function overlayLinesOf(hit: PatternHit, shownTimes: number[], fmt: (n: number) => string = (n) => n.toFixed(2)): PatternOverlayLine[] {
  const color = biasColor(hit.bias);
  const out: PatternOverlayLine[] = [];
  for (const ln of hit.lines || []) {
    const pts = (ln.points || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2) continue;
    let a = { timestamp: snapTime(shownTimes, pts[0][0]), value: pts[0][1] };
    let b = { timestamp: snapTime(shownTimes, pts[pts.length - 1][0]), value: pts[pts.length - 1][1] };
    if (a.timestamp === b.timestamp) {
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
  return out;
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
