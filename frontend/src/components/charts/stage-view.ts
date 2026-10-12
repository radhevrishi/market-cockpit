// zzz987 — "Stage Analysis (TheWrap method)" chart indicator: the pure pieces (no React, no chart engine).
//  • on / off in the working layout (an extra of type 'STG', like the chart-pattern indicator 'PAT')
//  • which index the Mansfield RS is measured against, and its daily-chart URL
//  • per-bar stage + Mansfield RS for the candles on screen (D / W / M) from the weekly reading (lib/stage-analysis)
//  • the stage colours and the banner
// The method itself is lib/stage-analysis.ts — our own version from the published rules, not the original script.
import { newExtra, type ChartLayout } from '@/lib/chart-layouts';
import { readingsForBars, stageAnalysis, weeklyFromTimed, stageHeadline, type Stage, type StageResult, type StageWeek } from '@/lib/stage-analysis';
import { dailyUrl } from './pattern-view';

export const STAGE_INDICATOR = 'MC_STAGE';
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
/** Per candle on screen: [timestamp, stage, Mansfield RS] — what the two chart indicators read (matched by timestamp). */
export type StagePoint = [number, Stage | 0, number | null];
export function stagePointsFor(shownTimes: readonly number[], r: StageResult): StagePoint[] {
  const st = readingsForBars(shownTimes, r.weeks, (k) => r.weeks[k].stage);
  const mrs = readingsForBars(shownTimes, r.weeks, (k) => r.weeks[k].mrs);
  return shownTimes.map((t, i) => [t, st[i] ?? 0, mrs[i] ?? null]);
}

/** Stage colours: 1 and 3 blue, 2 green, 4 red (the published colour scheme). */
export const STAGE_COLOR: Record<Stage, string> = { 1: '#2962FF', 2: '#089981', 3: '#2962FF', 4: '#F23645' };
export const stageFill = (s: Stage, light: boolean) => {
  const c = STAGE_COLOR[s];
  const rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(',');
  return `rgba(${rgb},${light ? 0.07 : 0.11})`;
};

export interface StageBannerModel { text: string; color: string | null }
export function stageBanner(status: 'loading' | 'ready' | 'error' | 'idle', last: StageWeek | null, benchOk: boolean, error?: string): StageBannerModel {
  if (status === 'loading' || status === 'idle') return { text: 'Stage Analysis: reading the weekly bars…', color: null };
  if (status === 'error') return { text: `Stage Analysis: ${error || 'the daily bars could not be loaded'}`, color: null };
  const base = stageHeadline(last);
  return { text: benchOk || !last || last.sata == null ? base : `${base} · index not loaded (no Mansfield RS)`, color: last?.stage ? STAGE_COLOR[last.stage] : null };
}
