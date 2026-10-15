// zzz1046b — "Volume & accumulation (institutional footprint)" chart overlay: the pure pieces (no React, no chart engine).
//  • on / off in the working layout (an extra of type 'ACC', like 'PAT' / 'STG' / 'SET' / 'ALN' — an analysis overlay, not counted
//    toward the 8-indicator limit; off unless added)
//  • the candles it reads: the chart's own bars (D / W / M) minus a still-forming last candle (setup-view completedBars — the same
//    session / week / month close rules as the setups and the weekly stages)
//  • per-bar marks [timestamp, kind, volume ÷ average] for the volume pane, the money-flow (CMF 21) pane points, the chip text
//  • the viewer's choices (localStorage 'mc:chart-acc:v1'): money-flow pane, tinted volume bars, stalling marks
// The rules are lib/accumulation.ts (our own version of the published O'Neil / Wyckoff rules) — not changed here.
import { newExtra, type ChartLayout } from '@/lib/chart-layouts';
import { weekComplete } from '@/lib/completed-weeks';
import { ACC_HONESTY, ACC_RULES, accExplain, accumulationFigures, accumulationSeries, type AccFigures, type AccKind, type AccSeries, type VolBars } from '@/lib/accumulation';
import { completedBars, type SetupChartTf } from './setup-view';

export const ACC_INDICATOR = 'MC_ACC';
export const CMF_INDICATOR = 'MC_CMF';
export const CMF_PANE = 'mc_cmf_pane';
export const OBV_INDICATOR = 'MC_OBV';
export const ACC_PREFS_KEY = 'mc:chart-acc:v1';
export type AccChartTf = SetupChartTf;

// ── layout on / off ─────────────────────────────────────────────────────────────
export function accOn(l: ChartLayout | null | undefined): boolean {
  return !!l?.extras?.some((x) => x.type === 'ACC' && x.on);
}
export function withAcc(l: ChartLayout, on: boolean): ChartLayout {
  const rest = l.extras.filter((x) => x.type !== 'ACC');
  return { ...l, extras: on ? [...rest, newExtra('ACC')] : rest };
}

// ── the viewer's choices ────────────────────────────────────────────────────────
export interface AccPrefs { cmfPane: boolean; tint: boolean; churn: boolean }
export const defaultAccPrefs = (): AccPrefs => ({ cmfPane: true, tint: true, churn: true });
export function parseAccPrefs(raw: string | null | undefined): AccPrefs {
  const p = defaultAccPrefs();
  if (!raw) return p;
  let j: any;
  try { j = JSON.parse(raw); } catch { return p; }
  if (!j || typeof j !== 'object') return p;
  for (const k of ['cmfPane', 'tint', 'churn'] as const) if (typeof j[k] === 'boolean') p[k] = j[k];
  return p;
}
export const serializeAccPrefs = (p: AccPrefs) => JSON.stringify({ v: 1, cmfPane: p.cmfPane, tint: p.tint, churn: p.churn });

// ── words ───────────────────────────────────────────────────────────────────────
/** The bar word the rules read on these candles: daily = session, weekly = week, monthly = month. */
export const accBarWord = (tf: AccChartTf): 'session' | 'week' | 'month' => (tf === 'W' ? 'week' : tf === 'M' ? 'month' : 'session');
const TF_NAME: Record<AccChartTf, string> = { D: 'Daily', W: 'Weekly', M: 'Monthly' };
const sg2 = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}`;

// ── which bars are read ─────────────────────────────────────────────────────────
export interface AccBar { t: number; o: number; h: number; l: number; c: number; v: number }
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Chart bars → the engine's input (dates for the weekly volume reading). */
export function toVolBars(bars: readonly AccBar[]): VolBars {
  return { d: bars.map((b) => isoDay(b.t)), o: bars.map((b) => b.o), h: bars.map((b) => b.h), l: bars.map((b) => b.l), c: bars.map((b) => b.c), v: bars.map((b) => b.v) };
}
export interface AccReading<T extends AccBar = AccBar> {
  /** the completed candles read (a prefix of the bars on screen, so indexes match) */
  done: T[];
  /** a still-forming last candle was left out */
  dropped: boolean;
  series: AccSeries;
  figures: AccFigures;
}
/** Read the candles on screen: completed candles only; on daily candles the big-volume weeks use completed exchange weeks
 *  (lib/completed-weeks), on weekly / monthly candles there is no weekly re-grouping (`daily: false`). */
export function accReading<T extends AccBar>(bars: readonly T[], tf: AccChartTf, market: string, now: number = Date.now()): AccReading<T> {
  const { bars: done, dropped } = completedBars(bars, tf, market, now);
  const vb = toVolBars(done);
  const series = accumulationSeries(vb);
  const daily = tf === 'D';
  const figures = accumulationFigures(vb, daily ? { daily: true, market: market === 'IN' ? 'IN' : market === 'US' ? 'US' : undefined, weekDone: (mon) => weekComplete(mon, market, now) } : { daily: false });
  return { done, dropped, series, figures };
}

// ── chart points ────────────────────────────────────────────────────────────────
/** One mark: [timestamp of the bar, kind, volume ÷ its 50-bar average]. */
export type AccPoint = [number, AccKind, number | null];
/** Marks for the completed bars read (stalling marks can be hidden). */
export function accPointsFor(done: readonly { t: number }[], s: AccSeries, o: { churn?: boolean } = {}): AccPoint[] {
  const out: AccPoint[] = [];
  for (let i = 0; i < done.length; i++) {
    const k = s.kind[i];
    if (!k || (k === 'churn' && o.churn === false)) continue;
    out.push([done[i].t, k, s.volX[i] ?? null]);
  }
  return out;
}
/** The money-flow pane per candle: [timestamp, CMF 21 or null while there is too little history]. */
export type CmfPoint = [number, number | null];
export function cmfPointsFor(done: readonly { t: number }[], s: AccSeries): CmfPoint[] {
  return done.map((b, i) => [b.t, s.cmf21[i] ?? null]);
}
/** On-Balance Volume per bar (the engine's running total: + volume on an up close, − on a down close). */
export function obvValues(bars: readonly { h: number; l: number; c: number; v: number }[]): number[] {
  if (!bars.length) return [];
  return accumulationSeries({ h: bars.map((b) => b.h), l: bars.map((b) => b.l), c: bars.map((b) => b.c), v: bars.map((b) => b.v) }).obv;
}

/** The glyph of a mark: accumulation ▲, volume breakout ◆, distribution ▼, stalling ●. */
export const ACC_GLYPH: Record<AccKind, string> = { acc: '▲', vbo: '◆', dist: '▼', churn: '●' };
/** Mark colours per theme: green accumulation, brighter green breakout, red distribution, amber stalling. */
export function accMarkColor(kind: AccKind, light: boolean): string {
  switch (kind) {
    case 'acc': return light ? '#067A66' : '#22C3A6';
    case 'vbo': return light ? '#00A35C' : '#3CF0A0';
    case 'dist': return light ? '#C8102E' : '#FF6B78';
    default: return light ? '#B26A00' : '#F5B342';
  }
}
/** The hover words of a mark ("Volume breakout · vol 2.1×"). */
export function accMarkTitle(kind: AccKind, volX: number | null, bar: string = 'session'): string {
  const name = kind === 'acc' ? `Accumulation ${bar}` : kind === 'vbo' ? 'Volume breakout' : kind === 'dist' ? `Distribution ${bar}` : `Stalling ${bar} (heavy volume, no progress)`;
  return volX != null ? `${name} · vol ${volX}×` : name;
}

// ── chip + details ──────────────────────────────────────────────────────────────
export type AccStatus = 'idle' | 'loading' | 'ready' | 'short';
export interface AccChip { text: string; tone: 'up' | 'down' | 'none' }
/** The status of the reading: still loading, too little history, or ready. */
export function accStatus(on: boolean, barsLen: number, doneLen: number): AccStatus {
  return !on ? 'idle' : !barsLen ? 'loading' : doneLen < ACC_RULES.minBars ? 'short' : 'ready';
}
/** The chip: "Accumulation B · 5 acc / 3 dist (25 sessions) · money flow +0.41" (+ volume breakout / ⚠ distribution).
 *  `compact` (Clean view): "Accumulation B · 5 acc / 3 dist · MF +0.41". */
export function accChipText(f: AccFigures | null, o: { tf: AccChartTf; status: AccStatus; dropped?: boolean; compact?: boolean }): AccChip {
  const bar = accBarWord(o.tf);
  if (o.status === 'short') return { text: `Accumulation · too little history (needs ${ACC_RULES.minBars} ${bar}s)`, tone: 'none' };
  if (o.status === 'loading' || o.status === 'idle' || !f) return { text: 'Accumulation · reading the bars…', tone: 'none' };
  if (f.accS == null || f.accG == null) return { text: 'Accumulation · no volume in this data', tone: 'none' };
  const parts = [`Accumulation ${f.accG}`, `${f.accD} acc / ${f.disD} dist${o.compact ? '' : ` (${ACC_RULES.window} ${bar}s)`}`];
  if (f.cmf21 != null) parts.push(o.compact ? `MF ${sg2(f.cmf21)}` : `money flow ${sg2(f.cmf21)}`);
  if (f.vboD != null) {
    const when = f.vboD === 0 ? (o.tf === 'D' && !o.dropped ? 'today' : `last ${bar}`) : `${f.vboD} ${bar}${f.vboD === 1 ? '' : 's'} ago`;
    parts.push(o.compact ? 'vol breakout' : `vol breakout ${when}`);
  }
  if (f.distWarn) parts.push('⚠ distribution');
  const tone: AccChip['tone'] = f.accG === 'A' || f.accG === 'B' ? 'up' : f.accG === 'D' || f.accG === 'E' ? 'down' : 'none';
  return { text: parts.join(' · '), tone };
}
/** The details lines: the engine's plain-English explanation (always ending with the honesty note). */
export function accDetailLines(f: AccFigures | null, tf: AccChartTf, market: string): string[] {
  if (!f) return [ACC_HONESTY];
  const lines = accExplain(f, accBarWord(tf), market === 'IN' ? 'IN' : 'US');
  return lines.includes(ACC_HONESTY) ? lines : [...lines, ACC_HONESTY];
}
/** Counts of each mark kind in a bar range [from, to) of the bars read (for the details list). */
export function accCountsInRange(s: AccSeries, from: number, to: number): Record<AccKind, number> {
  const out: Record<AccKind, number> = { acc: 0, vbo: 0, dist: 0, churn: 0 };
  for (let i = Math.max(0, from); i < Math.min(to, s.kind.length); i++) { const k = s.kind[i]; if (k) out[k]++; }
  return out;
}
export const accHeadline = (tf: AccChartTf) => `Volume & accumulation · ${TF_NAME[tf]}`;
