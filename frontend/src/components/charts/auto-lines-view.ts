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
  /** the latest price (a candle still forming) is through the line, the period has not closed */
  prov?: boolean;
}
export interface AlnLevel { id: string; kind: 'support' | 'resistance'; price: number; strength: number; tA: number; touches: Array<[number, number]>; n: number; prov?: boolean }
export interface AlnPayload { lines: AlnLine[]; levels: AlnLevel[]; light: boolean; decimals: number }

export const lineId = (l: TrendLine) => `t:${l.kind}:${l.firstTouch}:${l.lastTouch}`;
export const levelId = (l: Level) => `l:${l.kind}:${l.price.toPrecision(6)}`;

export function alnPayload(bars: ReadonlyArray<{ t: number }>, r: AutoLinesResult | null, prefs: AutoLinesPrefs, light: boolean, decimals: number, ref: AlnRef | null = null): AlnPayload {
  const out: AlnPayload = { lines: [], levels: [], light, decimals };
  if (!r) return out;
  const L = bars.length - 1;
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
        prov: measureLine(l, ref, L).status === 'provisional',
      });
    }
  }
  if (prefs.levels) {
    for (const l of r.levels) {
      const a = bars[l.firstTouch];
      if (!a) continue;
      out.levels.push({ id: levelId(l), kind: l.kind, price: l.price, strength: l.strength, tA: a.t, touches: l.touches.filter((t) => bars[t.i]).map((t) => [bars[t.i].t, t.price]), n: l.touches.length, prov: measureLevel(l, ref).status === 'provisional' });
    }
  }
  return out;
}
/** A payload line's price at a chart bar index, given the chart index of its first touch. */
export function alnLinePrice(l: Pick<AlnLine, 'yA' | 'slope' | 'log'>, k: number, kA: number): number {
  const y = l.yA + l.slope * (k - kA);
  return l.log ? Math.exp(y) : y;
}

const TF_NAME: Record<AutoLinesTf, string> = { D: 'Daily', W: 'Weekly', M: 'Monthly' };
const BAR_WORD: Record<AutoLinesTf, string> = { D: 'day', W: 'week', M: 'month' };

// ── which price the distances are measured from ──────────────────────────────────
// The lines are found on COMPLETED candles (a forming candle is left out). The chart header shows the latest price, which may
// be that forming candle. Both are kept: the distance from the last completed close (with its date) and from the latest price.
// A line the latest price is through, while the period has not closed, is a "provisional breach" — never called intact.
export interface AlnRef {
  /** the last completed candle: time and close (what the lines were found on) */
  closeT: number; close: number;
  /** the latest candle on the chart (may be still forming): time and close */
  latestT: number; latest: number;
  /** the latest candle is still forming (left out of the reading) */
  forming: boolean;
}
type TB = { t: number; c: number };
/** The reference prices from the completed candles and all candles on screen (the last one may be forming). */
export function alnRef(done: ReadonlyArray<TB>, all: ReadonlyArray<TB>): AlnRef | null {
  const d = done[done.length - 1], a = all[all.length - 1];
  if (!d || !(d.c > 0)) return null;
  const forming = !!a && a.t > d.t && a.c > 0;
  return { closeT: d.t, close: d.c, latestT: forming ? a.t : d.t, latest: forming ? a.c : d.c, forming };
}
/** two prices to show: the latest candle is forming and its close differs from the completed close */
export const alnTwoPrices = (ref: AlnRef | null): ref is AlnRef => !!ref && ref.forming && Math.abs(ref.latest / ref.close - 1) > 1e-9;
export type AlnLineStatus = 'intact' | 'provisional' | 'broken';
export interface AlnMeasure {
  /** completed close against the line, % (positive = above) */
  closeDist: number;
  /** latest price against the line, % — null when it is the same as the completed close */
  latestDist: number | null;
  /** the line's price at the latest candle */
  lineNow: number;
  status: AlnLineStatus;
}
const pctOf = (a: number, b: number) => (b > 0 ? (a / b - 1) * 100 : 0);
/** beyond the line on the wrong side: support with price below, resistance with price above (more than "at price") */
const through = (kind: 'support' | 'resistance', d: number) => (kind === 'support' ? d <= -0.05 : d >= 0.05);
/** A trendline against both prices. `L` = index of the last completed candle; the forming candle is L + 1. */
export function measureLine(l: TrendLine, ref: AlnRef | null, L: number): AlnMeasure {
  const two = alnTwoPrices(ref);
  const lineNow = linePriceAt(l, two ? L + 1 : L);
  const latestDist = two ? pctOf(ref.latest, lineNow) : null;
  const status: AlnLineStatus = l.state === 'broken' ? 'broken' : latestDist != null && through(l.kind, latestDist) ? 'provisional' : 'intact';
  return { closeDist: l.distPct, latestDist, lineNow, status };
}
/** A horizontal level against both prices (its side is set by the completed close, so it is never broken on completed bars). */
export function measureLevel(l: Level, ref: AlnRef | null): AlnMeasure {
  const two = alnTwoPrices(ref);
  const latestDist = two ? pctOf(ref.latest, l.price) : null;
  return { closeDist: l.distPct, latestDist, lineNow: l.price, status: latestDist != null && through(l.kind, latestDist) ? 'provisional' : 'intact' };
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sep close" (monthly), "week of 6 Oct close" (weekly), "14 Oct close" (daily) */
export function alnCloseLabel(t: number, tf: AutoLinesTf): string {
  const d = new Date(t);
  const dm = `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  return tf === 'M' ? `${MON[d.getUTCMonth()]} close` : tf === 'W' ? `week of ${dm} close` : `${dm} close`;
}
const sideWords = (d: number) => (Math.abs(d) < 0.05 ? 'at the line' : `${Math.abs(d).toFixed(1)}% ${d > 0 ? 'above' : 'below'}`);
/** "Sep close 8.5% above · latest $120.60 is 8.0% below — provisional breach (month not closed)"; one distance when the
 *  two prices are the same: "14 Oct close $142.10 is 8.5% above". */
export function alnDistText(m: AlnMeasure, ref: AlnRef | null, tf: AutoLinesTf, decimals = 2, cur = ''): string {
  if (!ref) return distWords(m.closeDist);
  const closeLbl = alnCloseLabel(ref.closeT, tf);
  if (m.latestDist == null) return `${closeLbl} ${cur}${fmtAlnPrice(ref.close, decimals)} is ${sideWords(m.closeDist)}`;
  const open = `(${BAR_WORD[tf]} not closed)`;
  const tail = m.status === 'provisional' ? ` — provisional breach ${open}` : ` ${open}`;
  const lat = Math.abs(m.latestDist) < 0.05 ? `latest ${cur}${fmtAlnPrice(ref.latest, decimals)} is at the line` : `latest ${cur}${fmtAlnPrice(ref.latest, decimals)} is ${sideWords(m.latestDist)}`;
  return `${closeLbl} ${sideWords(m.closeDist)} · ${lat}${tail}`;
}
/** One line for the list header: which prices the distances use. */
export function alnRefText(ref: AlnRef | null, tf: AutoLinesTf, decimals = 2, cur = ''): string {
  if (!ref) return '';
  const c = `${alnCloseLabel(ref.closeT, tf)} ${cur}${fmtAlnPrice(ref.close, decimals)}`;
  if (!alnTwoPrices(ref)) return `Distances from the ${c}.`;
  return `Distances from the ${c} (last completed ${BAR_WORD[tf]}) and the latest ${cur}${fmtAlnPrice(ref.latest, decimals)} (${BAR_WORD[tf]} not closed).`;
}

// ── status line + list ───────────────────────────────────────────────────────────
export type AlnStatus = 'idle' | 'loading' | 'short' | 'ready';
export function autoLinesHeadline(r: AutoLinesResult | null, tf: AutoLinesTf, status: AlnStatus, prefs: AutoLinesPrefs = DEFAULT_ALN_PREFS, provisional = 0): string {
  const head = `Auto lines · ${TF_NAME[tf]}`;
  if (status === 'idle' || status === 'loading') return `${head} · reading the bars…`;
  if (status === 'short') return `${head} · too little history`;
  if (!r) return head;
  const parts: string[] = [];
  if (prefs.trend) parts.push(r.trend.length === 1 ? '1 trendline' : `${r.trend.length} trendlines`);
  if (prefs.levels) parts.push(r.levels.length === 1 ? '1 level' : `${r.levels.length} levels`);
  if (!parts.length) return `${head} · hidden`;
  if (!r.trend.length && !r.levels.length) return `${head} · no line with 3+ touches near price`;
  if (provisional > 0) parts.push(`${provisional} provisional ${provisional === 1 ? 'breach' : 'breaches'} (${BAR_WORD[tf]} not closed)`);
  return `${head} · ${parts.join(' · ')}`;
}

export interface AlnRow {
  id: string; kind: 'support' | 'resistance'; broken: boolean; title: string; detail: string; touches: number;
  /** completed close against the line, % */
  distPct: number;
  /** latest price against the line, % (null when it equals the completed close) */
  latestDistPct: number | null;
  /** latest price through the line, period not closed */
  prov: boolean;
  strength: number; tip: string;
}
const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
export function fmtAlnPrice(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
const signed = (x: number, d = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}%`;
/** Rows for the list (trendlines first, then levels from the top down) and the hover tooltip text. `bars` = the completed
 *  candles the lines were found on; `ref` = which prices the distances use (alnRef); `cur` = "$" / "₹". */
export function autoLinesRows(bars: ReadonlyArray<{ t: number }>, r: AutoLinesResult | null, tf: AutoLinesTf, decimals = 2, ref: AlnRef | null = null, cur = ''): AlnRow[] {
  if (!r) return [];
  const rows: AlnRow[] = [];
  const L = bars.length - 1;
  const two = alnTwoPrices(ref);
  for (const l of r.trend) {
    const dates = l.touches.map((t) => (bars[t.i] ? fmtDate(bars[t.i].t) : '')).filter(Boolean);
    const m = measureLine(l, ref, L);
    const now = m.lineNow;
    const dist = alnDistText(m, ref, tf, decimals, cur);
    const brokenOn = l.state === 'broken' && l.breakIndex != null && bars[l.breakIndex] ? ` · broken ${fmtDate(bars[l.breakIndex].t)}` : '';
    const slope = `${signed(tf === 'D' ? l.slopePctPerWeek : l.slopePctPerBar)} a ${tf === 'D' ? 'week' : BAR_WORD[tf]}`;
    const tag = m.status === 'broken' ? ' (broken)' : m.status === 'provisional' ? ' (provisional breach)' : '';
    const stateLine = m.status === 'broken' ? 'Broken on a completed close' : m.status === 'provisional'
      ? `Intact on completed ${BAR_WORD[tf]}s; the latest price is through it — provisional breach until the ${BAR_WORD[tf]} closes`
      : `Intact on completed ${BAR_WORD[tf]}s${two ? '; the latest price is on the same side' : ''}`;
    rows.push({
      id: lineId(l), kind: l.kind, broken: l.state === 'broken', touches: l.touches.length, distPct: m.closeDist, latestDistPct: m.latestDist, prov: m.status === 'provisional', strength: l.strength,
      title: `${trendLineName(l)}${tag}`,
      detail: `${l.touches.length} touches · line ${fmtAlnPrice(now, decimals)} · ${dist} · ${slope}${brokenOn}`,
      tip: `${trendLineName(l)}${l.state === 'broken' ? ' — broken' : ''}\n${l.touches.length} touches: ${dates.join(', ')}\nSlope ${slope}${l.log ? ' (in % terms)' : ''}\nLine now ${fmtAlnPrice(now, decimals)} · ${dist}${brokenOn}\n${stateLine}\nStrength ${l.strength}/100`,
    });
  }
  const lv = r.levels.slice().sort((a, b) => b.price - a.price);
  for (const l of lv) {
    const dates = l.touches.map((t) => (bars[t.i] ? fmtDate(bars[t.i].t) : '')).filter(Boolean);
    const m = measureLevel(l, ref);
    const dist = alnDistText(m, ref, tf, decimals, cur);
    const flips = l.flips ? ` · ${l.flips} role ${l.flips === 1 ? 'flip' : 'flips'}` : '';
    const short = l.kind === 'support' ? 'Support' : 'Resistance';
    const stateLine = m.status === 'provisional'
      ? `Intact on completed ${BAR_WORD[tf]}s; the latest price is through it — provisional breach until the ${BAR_WORD[tf]} closes`
      : `Intact on completed ${BAR_WORD[tf]}s${two ? '; the latest price is on the same side' : ''}`;
    rows.push({
      id: levelId(l), kind: l.kind, broken: false, touches: l.touches.length, distPct: m.closeDist, latestDistPct: m.latestDist, prov: m.status === 'provisional', strength: l.strength,
      title: `${levelName(l)} ${fmtAlnPrice(l.price, decimals)}${m.status === 'provisional' ? ' (provisional breach)' : ''}`,
      detail: `${l.touches.length} touches${flips} · ${dist} · last ${dates[dates.length - 1] || '—'}`,
      tip: `${short} ${fmtAlnPrice(l.price, decimals)} · ${dist}\n${l.touches.length} touches: ${dates.join(', ')}${l.flips ? `\nChanged role ${l.flips} ${l.flips === 1 ? 'time' : 'times'} (support ↔ resistance)` : ''}\n${stateLine}\nStrength ${l.strength}/100`,
    });
  }
  return rows;
}
