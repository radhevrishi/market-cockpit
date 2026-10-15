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
export interface AlnColors { support: string; resistance: string; broken: string; halo: string; tagText: string; trend: string; level: string }
/** zzz1034 — owner: one colour for every auto trendline and one for every support / resistance level, chosen per theme:
 *  dark chart → trendlines white, levels yellow; white chart → trendlines charcoal, levels deep amber (the same pair, readable on white).
 *  `support` / `resistance` stay for the list's wording only. Broken lines stay grey. */
export function alnColors(light: boolean): AlnColors {
  return light
    ? { support: '#0B8A73', resistance: '#D63B49', broken: '#8A8E99', halo: '#FFFFFF', tagText: '#FFFFFF', trend: '#1E293B', level: '#A16207' }
    : { support: '#26A69A', resistance: '#F7525F', broken: '#8E929C', halo: '#0C1018', tagText: '#0C1018', trend: '#FFFFFF', level: '#FFD54F' };
}
/** The colour a line or level is drawn in (level = horizontal support / resistance). */
export function alnColorOf(kind: 'support' | 'resistance', broken: boolean, light: boolean, level = false): string {
  const c = alnColors(light);
  void kind;
  return broken ? c.broken : level ? c.level : c.trend;
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
    const seen = new Set<string>();
    for (const l of r.levels) {
      const a = bars[l.firstTouch];
      // zzz1030 — the same level price once (one level = one line and one tag)
      if (!a || seen.has(fmtAlnPrice(l.price, decimals))) continue;
      seen.add(fmtAlnPrice(l.price, decimals));
      out.levels.push({ id: levelId(l), kind: l.kind, price: l.price, strength: l.strength, tA: a.t, touches: l.touches.filter((t) => bars[t.i]).map((t) => [bars[t.i].t, t.price]), n: l.touches.length, prov: measureLevel(l, ref).status === 'provisional' });
    }
  }
  return out;
}
/** zzz1030 — one level = one right-edge tag. QA (HAL daily, Clean) showed two identical "×9 4,604.76" tags stacked: the same
 *  level reached the tag list twice. Tags with the same id, or levels (tags with a price in their text) with the same shown price,
 *  are kept once (the one with more touches). Trendline tags ("×N") are never merged with each other here. */
export function dedupeAlnTags<T extends { id: string; price: number; n: number; text: string }>(tags: readonly T[], decimals = 2): T[] {
  const out: T[] = [];
  const byKey = new Map<string, number>();
  for (const t of tags) {
    const isLevel = t.id.startsWith('l:');
    const keys = [`id:${t.id}`, ...(isLevel ? [`lv:${fmtAlnPrice(t.price, decimals)}`] : [])];
    const hit = keys.map((k) => byKey.get(k)).find((x) => x != null);
    if (hit != null) {
      if (t.n > out[hit].n) out[hit] = t;
      for (const k of keys) byKey.set(k, hit);
      continue;
    }
    out.push(t);
    for (const k of keys) byKey.set(k, out.length - 1);
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
  /** zzz1030 — the line's price at the last COMPLETED candle (what `closeDist` is measured against); a level: its price */
  lineAtClose: number;
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
  return { closeDist: l.distPct, latestDist, lineNow, lineAtClose: linePriceAt(l, L), status };
}
/** A horizontal level against both prices (its side is set by the completed close, so it is never broken on completed bars). */
export function measureLevel(l: Level, ref: AlnRef | null): AlnMeasure {
  const two = alnTwoPrices(ref);
  const latestDist = two ? pctOf(ref.latest, l.price) : null;
  return { closeDist: l.distPct, latestDist, lineNow: l.price, lineAtClose: l.price, status: latestDist != null && through(l.kind, latestDist) ? 'provisional' : 'intact' };
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sep close" (monthly), "week of 6 Oct close" (weekly), "14 Oct close" (daily) */
export function alnCloseLabel(t: number, tf: AutoLinesTf): string {
  const d = new Date(t);
  const dm = `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  return tf === 'M' ? `${MON[d.getUTCMonth()]} close` : tf === 'W' ? `week of ${dm} close` : `${dm} close`;
}
const sideWords = (d: number) => (Math.abs(d) < 0.05 ? 'at the line' : `${Math.abs(d).toFixed(1)}% ${d > 0 ? 'above' : 'below'}`);
/** For a horizontal level (one value — it does not move): "Sep close $142.10 is 8.4% above · latest $120.60 is 8.0% below —
 *  provisional breach (month not closed)"; one distance when the two prices are the same: "14 Oct close $142.10 is 8.4% above".
 *  zzz1030: both prices are named, so each % can be checked against the level. */
export function alnDistText(m: AlnMeasure, ref: AlnRef | null, tf: AutoLinesTf, decimals = 2, cur = ''): string {
  if (!ref) return distWords(m.closeDist);
  const closeLbl = alnCloseLabel(ref.closeT, tf);
  const closePart = `${closeLbl} ${cur}${fmtAlnPrice(ref.close, decimals)} is ${sideWords(m.closeDist)}`;
  if (m.latestDist == null) return closePart;
  return `${closePart} · ${latestPart(m, ref, decimals, cur)}${openTail(m, tf)}`;
}
const latestPart = (m: AlnMeasure, ref: AlnRef, decimals: number, cur: string) =>
  `latest ${cur}${fmtAlnPrice(ref.latest, decimals)} is ${m.latestDist == null || Math.abs(m.latestDist) < 0.05 ? 'at the line' : sideWords(m.latestDist)}`;
const openTail = (m: AlnMeasure, tf: AutoLinesTf) => (m.status === 'provisional' ? ` — provisional breach (${BAR_WORD[tf]} not closed)` : ` (${BAR_WORD[tf]} not closed)`);
/** zzz1030 — a sloping trendline has a different price on every bar, so both of its values are shown, each with the price it is
 *  measured against: `atClose` "line at the Sep close: $131.40 (Sep close $142.22 is 8.2% above)" and, when the latest candle is
 *  still forming, `now` "line now (projected to the latest bar): $132.10 (latest $120.60 is 8.7% below) — provisional breach
 *  (month not closed)". Without reference prices: "line $131.40 (price 8.2% above)". */
export function alnLineValues(m: AlnMeasure, ref: AlnRef | null, tf: AutoLinesTf, decimals = 2, cur = ''): { atClose: string; now: string | null } {
  const at = `${cur}${fmtAlnPrice(m.lineAtClose, decimals)}`;
  if (!ref) return { atClose: `line ${at} (${distWords(m.closeDist)})`, now: null };
  const closeLbl = alnCloseLabel(ref.closeT, tf);
  const atClose = `line at the ${closeLbl}: ${at} (${closeLbl} ${cur}${fmtAlnPrice(ref.close, decimals)} is ${sideWords(m.closeDist)})`;
  if (m.latestDist == null) return { atClose, now: null };
  return { atClose, now: `line now (projected to the latest bar): ${cur}${fmtAlnPrice(m.lineNow, decimals)} (${latestPart(m, ref, decimals, cur)})${openTail(m, tf)}` };
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
    const v = alnLineValues(m, ref, tf, decimals, cur);
    const values = v.now ? `${v.atClose} · ${v.now}` : v.atClose;
    const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    const brokenOn = l.state === 'broken' && l.breakIndex != null && bars[l.breakIndex] ? ` · broken ${fmtDate(bars[l.breakIndex].t)}` : '';
    const slope = `${signed(tf === 'D' ? l.slopePctPerWeek : l.slopePctPerBar)} a ${tf === 'D' ? 'week' : BAR_WORD[tf]}`;
    const tag = m.status === 'broken' ? ' (broken)' : m.status === 'provisional' ? ' (provisional breach)' : '';
    const stateLine = m.status === 'broken' ? 'Broken on a completed close' : m.status === 'provisional'
      ? `Intact on completed ${BAR_WORD[tf]}s; the latest price is through it — provisional breach until the ${BAR_WORD[tf]} closes`
      : `Intact on completed ${BAR_WORD[tf]}s${two ? '; the latest price is on the same side' : ''}`;
    rows.push({
      id: lineId(l), kind: l.kind, broken: l.state === 'broken', touches: l.touches.length, distPct: m.closeDist, latestDistPct: m.latestDist, prov: m.status === 'provisional', strength: l.strength,
      title: `${trendLineName(l)}${tag}`,
      detail: `${l.touches.length} touches · ${values} · ${slope}${brokenOn}`,
      tip: `${trendLineName(l)}${l.state === 'broken' ? ' — broken' : ''}\n${l.touches.length} touches: ${dates.join(', ')}\nSlope ${slope}${l.log ? ' (in % terms)' : ''}\n${cap(v.atClose)}${v.now ? `\n${cap(v.now)}` : ''}${brokenOn ? `\n${cap(brokenOn.slice(3))}` : ''}\n${stateLine}\nStrength ${l.strength}/100`,
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
