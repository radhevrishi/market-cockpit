// zzz987 — "Stage Analysis (TheWrap method)" chart indicator: the pure pieces (no React, no chart engine).
//  • on / off in the working layout (an extra of type 'STG', like the chart-pattern indicator 'PAT')
//  • which index the Mansfield RS is measured against, and its daily-chart URL
//  • per-bar stage + Mansfield RS for the candles on screen (D / W / M) from the weekly reading (lib/stage-analysis)
//  • the stage colours, the stage line (30-wk / 150-day average), the labels and levels where stages began, and the banner
// The method itself is lib/stage-analysis.ts — our own version from the published rules, not the original script.
import { newExtra, type ChartLayout } from '@/lib/chart-layouts';
import { readingsForBars, stageAnalysis, weeklyFromTimed, stageHeadline, stageDetails, dayWords, STAGE_MEANING, STAGE_WORDS, SUB_WORDS, type Stage, type StageDetail, type StageResult, type StageWeek } from '@/lib/stage-analysis';
import { readableOn } from '@/lib/readable-color';
import { dailyUrl } from './pattern-view';

export const STAGE_INDICATOR = 'MC_STAGE';
export const STAGE_LINE_INDICATOR = 'MC_STAGE_LINE';
export const MRS_INDICATOR = 'MC_MRS';
export const MRS_PANE = 'mc_mrs_pane';

export function stageOn(l: ChartLayout | null | undefined): boolean {
  return !!l?.extras?.some((x) => x.type === 'STG' && x.on);
}
export function withStage(l: ChartLayout, on: boolean): ChartLayout {
  const rest = l.extras.filter((x) => x.type !== 'STG');
  return { ...l, extras: on ? [...rest, newExtra('STG')] : rest };
}

/** The index the Mansfield RS is measured against: S&P 500 for US stocks, Nifty 50 for India (ticker aliases in lib/yahoo-symbol). */
export function benchmarkOf(market: string): { ticker: string; name: string } {
  return market === 'IN' ? { ticker: 'NIFTY', name: 'Nifty 50' } : { ticker: 'SPX', name: 'S&P 500' };
}
export const benchmarkUrl = (market: string) => dailyUrl(benchmarkOf(market).ticker, market === 'IN' ? 'IN' : 'US', undefined, 'price');

type TBar = { t: number; o: number; h: number; l: number; c: number; v: number };
/** Weekly reading from the stock's daily bars + the index's daily bars (null index → no Mansfield RS). */
export function stageFromCharts(daily: readonly TBar[], benchDaily: readonly TBar[] | null): StageResult {
  const bench = benchDaily && benchDaily.length ? new Map(weeklyFromTimed(benchDaily).map((w) => [w.wk, w.c] as [string, number])) : null;
  return stageAnalysis(weeklyFromTimed(daily), bench);
}
/** zzz1023 — per candle on screen: [timestamp, stage (0 = none), Mansfield RS, stage line (30-wk MA; the 150-day average on a
 *  daily or intraday chart), its slope (1 rising / 0 flat / −1 falling), sub-stage (1 = B)] — what the chart indicators read. */
export type StagePoint = [number, Stage | 0, number | null, number | null, -1 | 0 | 1 | null, 0 | 1];
const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Daily closes → their 150-day simple average, by UTC day (YYYY-MM-DD). */
export function dailyMa150(daily: ReadonlyArray<{ t: number; c: number }>, n = 150): Map<string, number> {
  const m = new Map<string, number>();
  let s = 0;
  const cs: number[] = [];
  for (const b of daily) {
    if (!Number.isFinite(b.c) || b.c <= 0) continue;
    cs.push(b.c); s += b.c;
    if (cs.length > n) s -= cs[cs.length - 1 - n];
    if (cs.length >= n) m.set(isoDay(b.t), s / n);
  }
  return m;
}
/** Median spacing of the candles in days (D ≈ 1, W ≈ 7, M ≈ 30). */
export function barSpacingDays(times: readonly number[]): number {
  const d: number[] = [];
  for (let i = Math.max(1, times.length - 60); i < times.length; i++) d.push((times[i] - times[i - 1]) / DAY);
  if (!d.length) return 1;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}
export function stagePointsFor(shownTimes: readonly number[], r: StageResult, ma150?: ReadonlyMap<string, number> | null): StagePoint[] {
  const idx = readingsForBars(shownTimes, r.weeks, (k) => k);
  const daily = barSpacingDays(shownTimes) < 4;
  return shownTimes.map((t, i) => {
    const k = idx[i];
    const w = k != null ? r.weeks[k] : null;
    const ma = daily && ma150 ? (ma150.get(isoDay(t)) ?? null) : (w?.ma30 ?? null);
    const sl = w?.slope === 'rising' ? 1 : w?.slope === 'falling' ? -1 : w?.slope === 'flat' ? 0 : null;
    return [t, w?.stage ?? 0, w?.mrs ?? null, ma, ma != null ? sl : null, w?.sub === 'B' ? 1 : 0];
  });
}

/** zzz1023 — where a stage began, for the label pills and the breakout / breakdown levels. Times are the candle timestamps. */
export interface StageMark { t: number; stage: Stage; label: string; level: number | null; levelFrom: number | null; levelTo: number | null; kind: 'breakout' | 'breakdown' | null }
export function stageMarksFor(shownTimes: readonly number[], r: StageResult): StageMark[] {
  if (!shownTimes.length) return [];
  const out: StageMark[] = [];
  const firstAtOrAfter = (ms: number) => { let lo = 0, hi = shownTimes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (shownTimes[m] < ms) lo = m + 1; else hi = m; } return lo; };
  const span = Math.max(7, barSpacingDays(shownTimes)) * DAY;
  for (const ch of r.changes || []) {
    const ws = Date.parse(`${ch.wk}T00:00:00Z`);
    if (shownTimes[0] - ws >= span) continue;   // began before the first candle on screen
    const j = firstAtOrAfter(ws);
    if (j >= shownTimes.length) continue;
    // the candle holding that week's start (a weekly / monthly candle may begin before it)
    const k = j > 0 && shownTimes[j] - ws > 7 * DAY ? j - 1 : j;
    const kind = ch.level != null ? (ch.to === 2 ? 'breakout' : ch.to === 4 ? 'breakdown' : null) : null;
    out.push({
      t: shownTimes[k], stage: ch.to, label: `S${ch.to} · ${STAGE_WORDS[ch.to]} · ${dayWords(ch.wk, true)}`,
      level: kind ? ch.level : null, levelFrom: kind ? Math.max(shownTimes[0], ws - 13 * 7 * DAY) : null, levelTo: kind ? ws + 4 * 7 * DAY : null, kind,
    });
  }
  return out;
}

/** zzz1023 — calm stage colours, one set per chart theme (muted blue-grey / green / amber / red). Lines and strips reach 3:1
 *  on the chart background; text uses readableOn for 4.5:1. */
export const STAGE_PALETTE: Record<'light' | 'dark', Record<Stage, string>> = {
  light: { 1: '#5E6E85', 2: '#0B8A6A', 3: '#B7700A', 4: '#D14343' },
  dark: { 1: '#8E9CB2', 2: '#2BB58A', 3: '#E0A23A', 4: '#EF6461' },
};
export const SLOPE_FLAT: Record<'light' | 'dark', string> = { light: '#7A8291', dark: '#8D93A0' };
export const CHART_BG = (light: boolean) => (light ? '#FFFFFF' : '#0A0E1A');
export const stageColor = (s: Stage, light: boolean) => STAGE_PALETTE[light ? 'light' : 'dark'][s];
/** Kept for older callers: the white-theme colours. */
export const STAGE_COLOR: Record<Stage, string> = STAGE_PALETTE.light;
const rgbOf = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(',');
/** Full-height background tint behind the candles (very light; sub-stage B lighter still). */
export const stageFill = (s: Stage, light: boolean, subB = false) => `rgba(${rgbOf(stageColor(s, light))},${(light ? 0.045 : 0.07) * (subB ? 0.6 : 1)})`;
/** The thin strip along the bottom of the price pane. */
export const stageStrip = (s: Stage, light: boolean, subB = false) => `rgba(${rgbOf(stageColor(s, light))},${subB ? 0.5 : 0.9})`;
export const slopeColor = (sl: -1 | 0 | 1 | null, light: boolean) => (sl === 1 ? stageColor(2, light) : sl === -1 ? stageColor(4, light) : SLOPE_FLAT[light ? 'light' : 'dark']);

export interface StageBannerModel {
  text: string; color: string | null;
  /** zzz1023 — the details list: each rule with its value, the plain-words meaning of the stage */
  details?: StageDetail[]; meaning?: string; sub?: string | null; stage?: Stage | null;
}
export function stageBanner(status: 'loading' | 'ready' | 'error' | 'idle', last: StageWeek | null, benchOk: boolean, error?: string, light = true): StageBannerModel {
  if (status === 'loading' || status === 'idle') return { text: 'Stage Analysis: reading the weekly bars…', color: null };
  if (status === 'error') return { text: `Stage Analysis: ${error || 'the daily bars could not be loaded'}`, color: null };
  const base = stageHeadline(last);
  const st = last?.stage ?? null;
  return {
    text: benchOk || !last || st == null ? base : `${base} · index not loaded (no RS)`,
    color: st ? stageColor(st, light) : null,
    details: stageDetails(last), meaning: st ? STAGE_MEANING[st] : undefined, stage: st,
    sub: st && last?.sub ? `${st}${last.sub} · ${SUB_WORDS[st][last.sub]}` : null,
  };
}
/** Banner colours in the pattern banner's language: the stage colour as a tint on the page, readable text. */
export function stageBannerColors(color: string | null, light: boolean): { bg: string; border: string; text: string } {
  const page = CHART_BG(light);
  if (!color) return { bg: 'transparent', border: 'var(--mc-border-1)', text: light ? '#475569' : '#B2B5BE' };
  const rgb = rgbOf(color);
  const a = light ? 0.1 : 0.18;
  const tint = blendHex(color, page, a);
  return { bg: `rgba(${rgb},${a})`, border: `rgba(${rgb},${light ? 0.45 : 0.55})`, text: readableOn(color, tint) };
}
export function blendHex(color: string, page: string, a: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const c = p(color), b = p(page);
  return '#' + c.map((v, i) => Math.round(v * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}
