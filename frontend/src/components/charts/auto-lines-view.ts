// zzz1025 — "Auto trendlines & levels" chart indicator: the pure pieces (no React, no chart engine).
//  • on / off in the working layout (an extra of type 'ALN', on by default — lib/chart-layouts migrateAutoLines)
//  • the payload the chart draws, keyed by timestamps (a reload never shows another symbol's lines)
//  • the status line and its list rows, the viewer's show trendlines / show levels choice ('mc:chart-autolines:v1')
//  • colours per theme
// The detection is lib/auto-lines (≥ 3 touches, owner rule).
import { newExtra, type ChartLayout } from '@/lib/chart-layouts';
import { distWords, levelName, linePriceAt, trendLineName, type AutoLinesResult, type AutoLinesTf, type Level, type TrendLine } from '@/lib/auto-lines';

export const ALN_INDICATOR = 'MC_ALINES';
export const ALN_PREFS_KEY = 'mc:chart-autolines:v1';

// ── layout on / off ─────────────────────────────────────────────────────────────
export function autoLinesOn(l: ChartLayout | null | undefined): boolean {
  return !!l?.extras?.some((x) => x.type === 'ALN' && x.on);
}
export function withAutoLines(l: ChartLayout, on: boolean): ChartLayout {
  const rest = l.extras.filter((x) => x.type !== 'ALN');
  return { ...l, extras: on ? [...rest, newExtra('ALN')] : rest };
}

// ── the viewer's choices ────────────────────────────────────────────────────────
export interface AutoLinesPrefs { trend: boolean; levels: boolean }
export const DEFAULT_ALN_PREFS: AutoLinesPrefs = { trend: true, levels: true };
export function parseAutoLinesPrefs(raw: string | null | undefined): AutoLinesPrefs {
  try {
    const j = JSON.parse(String(raw ?? ''));
    if (!j || typeof j !== 'object') return { ...DEFAULT_ALN_PREFS };
    return { trend: j.trend !== false, levels: j.levels !== false };
  } catch { return { ...DEFAULT_ALN_PREFS }; }
}
export const serializeAutoLinesPrefs = (p: AutoLinesPrefs) => JSON.stringify({ v: 1, trend: p.trend, levels: p.levels });

// ── colours ─────────────────────────────────────────────────────────────────────
export interface AlnColors { support: string; resistance: string; broken: string; halo: string; tagText: string }
export function alnColors(light: boolean): AlnColors {
  return light
    ? { support: '#0B8A73', resistance: '#D63B49', broken: '#8A8E99', halo: '#FFFFFF', tagText: '#FFFFFF' }
    : { support: '#26A69A', resistance: '#F7525F', broken: '#8E929C', halo: '#0C1018', tagText: '#0C1018' };
}
export function alnColorOf(kind: 'support' | 'resistance', broken: boolean, light: boolean): string {
  const c = alnColors(light);
  return broken ? c.broken : kind === 'support' ? c.support : c.resistance;
}

// ── chart payload ───────────────────────────────────────────────────────────────
/** One trendline for the chart: anchored at the timestamp of its first touch; y = value in its own space (log or price). */
export interface AlnLine {
  id: string; kind: 'support' | 'resistance'; broken: boolean; strength: number; log: boolean;
  tA: number; yA: number; slope: number;
  /** timestamp of the break bar (broken lines stop a few bars after it), null when intact (runs to the right edge) */
  tEnd: number | null;
  touches: Array<[number, number]>;
  n: number;
}
export interface AlnLevel { id: string; kind: 'support' | 'resistance'; price: number; strength: number; tA: number; touches: Array<[number, number]>; n: number }
export interface AlnPayload { lines: AlnLine[]; levels: AlnLevel[]; light: boolean; decimals: number }

export const lineId = (l: TrendLine) => `t:${l.kind}:${l.firstTouch}:${l.lastTouch}`;
export const levelId = (l: Level) => `l:${l.kind}:${l.price.toPrecision(6)}`;

export function alnPayload(bars: ReadonlyArray<{ t: number }>, r: AutoLinesResult | null, prefs: AutoLinesPrefs, light: boolean, decimals: number): AlnPayload {
  const out: AlnPayload = { lines: [], levels: [], light, decimals };
  if (!r) return out;
  if (prefs.trend) {
    for (const l of r.trend) {
      const a = bars[l.firstTouch];
      if (!a) continue;
      out.lines.push({
        id: lineId(l), kind: l.kind, broken: l.state === 'broken', strength: l.strength, log: l.log,
        tA: a.t, yA: l.y0 + l.slope * (l.firstTouch - l.i0), slope: l.slope,
        tEnd: l.breakIndex != null && bars[l.breakIndex] ? bars[l.breakIndex].t : null,
        touches: l.touches.filter((t) => bars[t.i]).map((t) => [bars[t.i].t, t.price]),
        n: l.touches.length,
      });
    }
  }
  if (prefs.levels) {
    for (const l of r.levels) {
      const a = bars[l.firstTouch];
      if (!a) continue;
      out.levels.push({ id: levelId(l), kind: l.kind, price: l.price, strength: l.strength, tA: a.t, touches: l.touches.filter((t) => bars[t.i]).map((t) => [bars[t.i].t, t.price]), n: l.touches.length });
    }
  }
  return out;
}
/** A payload line's price at a chart bar index, given the chart index of its first touch. */
export function alnLinePrice(l: Pick<AlnLine, 'yA' | 'slope' | 'log'>, k: number, kA: number): number {
  const y = l.yA + l.slope * (k - kA);
  return l.log ? Math.exp(y) : y;
}

// ── status line + list ───────────────────────────────────────────────────────────
const TF_NAME: Record<AutoLinesTf, string> = { D: 'Daily', W: 'Weekly', M: 'Monthly' };
const BAR_WORD: Record<AutoLinesTf, string> = { D: 'day', W: 'week', M: 'month' };
export type AlnStatus = 'idle' | 'loading' | 'short' | 'ready';
export function autoLinesHeadline(r: AutoLinesResult | null, tf: AutoLinesTf, status: AlnStatus, prefs: AutoLinesPrefs = DEFAULT_ALN_PREFS): string {
  const head = `Auto lines · ${TF_NAME[tf]}`;
  if (status === 'idle' || status === 'loading') return `${head} · reading the bars…`;
  if (status === 'short') return `${head} · too little history`;
  if (!r) return head;
  const parts: string[] = [];
  if (prefs.trend) parts.push(r.trend.length === 1 ? '1 trendline' : `${r.trend.length} trendlines`);
  if (prefs.levels) parts.push(r.levels.length === 1 ? '1 level' : `${r.levels.length} levels`);
  if (!parts.length) return `${head} · hidden`;
  if (!r.trend.length && !r.levels.length) return `${head} · no line with 3+ touches near price`;
  return `${head} · ${parts.join(' · ')}`;
}

export interface AlnRow { id: string; kind: 'support' | 'resistance'; broken: boolean; title: string; detail: string; touches: number; distPct: number; strength: number; tip: string }
const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
export function fmtAlnPrice(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
const signed = (x: number, d = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}%`;
/** Rows for the list (trendlines first, then levels from the top down) and the hover tooltip text. */
export function autoLinesRows(bars: ReadonlyArray<{ t: number }>, r: AutoLinesResult | null, tf: AutoLinesTf, decimals = 2): AlnRow[] {
  if (!r) return [];
  const rows: AlnRow[] = [];
  const L = bars.length - 1;
  for (const l of r.trend) {
    const dates = l.touches.map((t) => (bars[t.i] ? fmtDate(bars[t.i].t) : '')).filter(Boolean);
    const now = linePriceAt(l, L);
    const state = l.state === 'broken' && l.breakIndex != null && bars[l.breakIndex] ? ` · broken ${fmtDate(bars[l.breakIndex].t)}` : '';
    const slope = `${signed(tf === 'D' ? l.slopePctPerWeek : l.slopePctPerBar)} a ${tf === 'D' ? 'week' : BAR_WORD[tf]}`;
    rows.push({
      id: lineId(l), kind: l.kind, broken: l.state === 'broken', touches: l.touches.length, distPct: l.distPct, strength: l.strength,
      title: `${trendLineName(l)}${l.state === 'broken' ? ' (broken)' : ''}`,
      detail: `${l.touches.length} touches · now ${fmtAlnPrice(now, decimals)} · ${distWords(l.distPct)} · ${slope}${state}`,
      tip: `${trendLineName(l)}${l.state === 'broken' ? ' — broken' : ''}\n${l.touches.length} touches: ${dates.join(', ')}\nSlope ${slope}${l.log ? ' (in % terms)' : ''}\nLine now ${fmtAlnPrice(now, decimals)} · ${distWords(l.distPct)}${state}\nStrength ${l.strength}/100`,
    });
  }
  const lv = r.levels.slice().sort((a, b) => b.price - a.price);
  for (const l of lv) {
    const dates = l.touches.map((t) => (bars[t.i] ? fmtDate(bars[t.i].t) : '')).filter(Boolean);
    const flips = l.flips ? ` · ${l.flips} role ${l.flips === 1 ? 'flip' : 'flips'}` : '';
    rows.push({
      id: levelId(l), kind: l.kind, broken: false, touches: l.touches.length, distPct: l.distPct, strength: l.strength,
      title: `${levelName(l)} ${fmtAlnPrice(l.price, decimals)}`,
      detail: `${l.touches.length} touches${flips} · ${distWords(l.distPct)} · last ${dates[dates.length - 1] || '—'}`,
      tip: `${levelName(l)} ${fmtAlnPrice(l.price, decimals)}\n${l.touches.length} touches: ${dates.join(', ')}${l.flips ? `\nChanged role ${l.flips} ${l.flips === 1 ? 'time' : 'times'} (support ↔ resistance)` : ''}\n${distWords(l.distPct)}\nStrength ${l.strength}/100`,
    });
  }
  return rows;
}
