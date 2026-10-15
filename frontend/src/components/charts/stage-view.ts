// zzz987 — "Stage Analysis (TheWrap method)" chart indicator: the pure pieces (no React, no chart engine).
//  • on / off in the working layout (an extra of type 'STG', like the chart-pattern indicator 'PAT')
//  • which index the Mansfield RS is measured against, and its daily-chart URL
//  • per-bar stage + Mansfield RS for the candles on screen (D / W / M) from the weekly reading (lib/stage-analysis)
//  • the stage colours, the stage line (30-wk / 150-day average), the labels and levels where stages began, and the banner
// The method itself is lib/stage-analysis.ts — our own version from the published rules, not the original script.
import { newExtra, type ChartLayout } from '@/lib/chart-layouts';
import { readingsForBars, stageCompleted, weeklyFromTimed, stageHeadline, stageDetails, stageHealth, stageHealthText, STAGE_HEALTH_NOTE, stageDatesLong, stageChangeText, sessionWords, weekEnd, weekKey, dayWords, STAGE_MEANING, STAGE_WORDS, SUB_WORDS, type Stage, type StageChange, type StageDetail, type StageResult, type StageWeek } from '@/lib/stage-analysis';
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
/** Weekly reading from the stock's daily bars + the index's daily bars (null index → no Mansfield RS). zzz1044a — the confirmed
 *  stage (tint, line, marks, stage age, banner) is read from COMPLETED exchange weeks only (lib/completed-weeks: after the Friday
 *  close of `market` — US 16:00 New York, India 15:30 IST — or once a later week has a bar), for the stock and the index alike;
 *  the still-open week is read separately into `provisional` ("provisional (week not closed)" in the banner). */
export function stageFromCharts(daily: readonly TBar[], benchDaily: readonly TBar[] | null, market?: string | null, now: Date | number = Date.now()): StageResult {
  const bench = benchDaily && benchDaily.length ? new Map(weeklyFromTimed(benchDaily).map((w) => [w.wk, w.c] as [string, number])) : null;
  return stageCompleted(weeklyFromTimed(daily), bench, { market, now, provisional: true });
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
/** zzz1027 — on a daily (or intraday) chart a weekly stage change is only known at that week's CLOSE, so the days before the
 *  week's last session keep the stage of the week before (no bar shows a stage earlier than it was known). */
export function stagePointsFor(shownTimes: readonly number[], r: StageResult, ma150?: ReadonlyMap<string, number> | null): StagePoint[] {
  const idx = readingsForBars(shownTimes, r.weeks, (k) => k);
  const daily = barSpacingDays(shownTimes) < 4;
  return shownTimes.map((t, i) => {
    const k = idx[i];
    const w = k != null ? r.weeks[k] : null;
    const ma = daily && ma150 ? (ma150.get(isoDay(t)) ?? null) : (w?.ma30 ?? null);
    const sl = w?.slope === 'rising' ? 1 : w?.slope === 'falling' ? -1 : w?.slope === 'flat' ? 0 : null;
    let sw = w;
    // zzz1044a — only a candle BEFORE week k's close keeps the week before's stage: one of week k itself followed by another of
    // week k, or one of an earlier week mapped to k (a Friday before a Monday holiday). A candle of the still-open week after the
    // last completed week k (read with week k) is past that close and keeps week k's stage.
    const own = weekKey(isoDay(t));
    const inWeekBeforeClose = w != null && i + 1 < shownTimes.length && idx[i + 1] === k
      && (own < w.wk || (own === w.wk && weekKey(isoDay(shownTimes[i + 1])) === w.wk));
    if (daily && k != null && k > 0 && w && r.weeks[k - 1].stage !== w.stage && inWeekBeforeClose) sw = r.weeks[k - 1];
    return [t, sw?.stage ?? 0, w?.mrs ?? null, ma, ma != null ? sl : null, sw?.sub === 'B' ? 1 : 0];
  });
}

/** zzz1023 / zzz1027 — the label pills and the breakout / breakdown levels. The pill (and the colour change) sit at the CONFIRMED
 *  week — what was knowable; `beganT` is the candle of the first qualifying week (a faint "began" tick), null when it is the same
 *  candle or off screen. On a daily chart both map to that week's close (its last session on screen); on weekly / monthly
 *  candles to the candle holding the week. Times are the candle timestamps. */
export interface StageMark { t: number; stage: Stage; label: string; level: number | null; levelFrom: number | null; levelTo: number | null; kind: 'breakout' | 'breakdown' | null; beganT: number | null; began: string; confirmed: string;
  /** zzz1030 — the last trading session of the began / confirmed week, and the dates in words for hover text */
  beganEnd: string; confirmedEnd: string; title: string;
  /** zzz1030 — the faint tick's text: "began wk to 7 Aug" */
  beganLabel: string }
export function stageMarksFor(shownTimes: readonly number[], r: StageResult): StageMark[] {
  if (!shownTimes.length) return [];
  const out: StageMark[] = [];
  const firstAtOrAfter = (ms: number) => { let lo = 0, hi = shownTimes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (shownTimes[m] < ms) lo = m + 1; else hi = m; } return lo; };
  const daily = barSpacingDays(shownTimes) < 4;
  const span = Math.max(7, barSpacingDays(shownTimes)) * DAY;
  /** the candle for the week starting `ws` (null = not on screen) */
  const candleOf = (ws: number): number | null => {
    if (shownTimes[0] - ws >= span) return null;   // before the first candle on screen
    const j = firstAtOrAfter(ws);
    if (daily) {
      // the week's close: its last session on screen
      const e = firstAtOrAfter(ws + 7 * DAY) - 1;
      return e >= 0 && e >= j && shownTimes[e] >= ws ? e : null;
    }
    if (j >= shownTimes.length) return null;
    // the candle holding that week's start (a weekly / monthly candle may begin before it)
    return j > 0 && shownTimes[j] - ws > 7 * DAY ? j - 1 : j;
  };
  for (const ch of r.changes || []) {
    const conf = ch.confirmed ?? ch.wk, began = ch.began ?? ch.wk;
    const confEnd = ch.confirmedEnd || weekEnd({ wk: conf }), beganEnd = ch.beganEnd || weekEnd({ wk: began });
    const ws = Date.parse(`${conf}T00:00:00Z`), bs = Date.parse(`${began}T00:00:00Z`);
    const k = candleOf(ws);
    if (k == null) continue;
    const kb = began !== conf ? candleOf(bs) : null;
    const kind = ch.level != null ? (ch.to === 2 ? 'breakout' : ch.to === 4 ? 'breakdown' : null) : null;
    out.push({
      // zzz1030 — the pill names the confirming CLOSE (the week's last session), not the week's Monday
      t: shownTimes[k], stage: ch.to, label: `S${ch.to} · ${STAGE_WORDS[ch.to]} · ${dayWords(confEnd, true)} close`,
      level: kind ? ch.level : null, levelFrom: kind ? Math.max(shownTimes[0], bs - 13 * 7 * DAY) : null, levelTo: kind ? ws + 4 * 7 * DAY : null, kind,
      beganT: kb != null && kb !== k ? shownTimes[kb] : null, began, confirmed: conf, beganEnd, confirmedEnd: confEnd,
      title: stageChangeText({ ...ch, beganEnd, confirmedEnd: confEnd }), beganLabel: `began wk to ${sessionWords(beganEnd, { weekday: false, year: false })}`,
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
  /** zzz1030 — the current stage's dates in full ("began week ending Fri 7 Aug 2026 · confirmed at the close of Fri 14 Aug 2026") */
  long?: string;
  /** zzz1030 — the latest stage changes, newest first, each with its began week and confirming close */
  changes?: string[];
  /** zzz1047 — a confirmed Stage 2 that is breaking down: the warning line, its level and the rule text */
  health?: { level: 'caution' | 'weak'; text: string; note: string } | null;
}
/** zzz1030 — the changes list in the details: the latest `max` changes, newest first. */
export function stageChangesList(changes: readonly StageChange[] | null | undefined, max = 6): string[] {
  return (changes || []).slice(-max).reverse().map((ch) => stageChangeText(ch));
}
/** zzz1044a — the open week's provisional reading in words, or '' when it says nothing the confirmed reading does not:
 *  "this week: Stage 2 · provisional (week not closed)" / "this week asks for Stage 2 · provisional (week not closed)". */
export function provisionalText(last: StageWeek | null | undefined, prov: StageWeek | null | undefined): string {
  if (!prov || prov.stage == null) return '';
  if (last?.stage !== prov.stage) return `this week: Stage ${prov.stage} · ${STAGE_WORDS[prov.stage]} · provisional (week not closed)`;
  if (prov.pending != null && prov.pending !== last?.pending) return `this week asks for Stage ${prov.pending} · provisional (week not closed)`;
  return '';
}
export function stageBanner(status: 'loading' | 'ready' | 'error' | 'idle', last: StageWeek | null, benchOk: boolean, error?: string, light = true, changes?: readonly StageChange[] | null, provisional?: StageWeek | null): StageBannerModel {
  if (status === 'loading' || status === 'idle') return { text: 'Stage Analysis: reading the weekly bars…', color: null };
  if (status === 'error') return { text: `Stage Analysis: ${error || 'the daily bars could not be loaded'}`, color: null };
  const prov = provisionalText(last, provisional);
  const base = prov ? `${stageHeadline(last)} · ${prov}` : stageHeadline(last);
  const st = last?.stage ?? null;
  const h = stageHealth(last);
  const health = h && h.level !== 'ok' ? { level: h.level, text: stageHealthText(h), note: STAGE_HEALTH_NOTE } : null;
  return {
    text: benchOk || !last || st == null ? base : `${base} · index not loaded (no RS)`,
    // zzz1047 — a weakening Stage 2 is not painted in the advancing colour: it takes the topping (Stage 3) colour
    color: st ? stageColor(health?.level === 'weak' ? 3 : st, light) : null, health,
    details: stageDetails(last), meaning: st ? STAGE_MEANING[st] : undefined, stage: st,
    long: stageDatesLong(last) || undefined, changes: changes?.length ? stageChangesList(changes) : undefined,
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
