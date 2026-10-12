// zzz981 — pure chart-pattern detection engine (no fetch, no React, no node-only imports).
//
// Used by (a) the chart indicator that prints one line at the top of the chart and (b) the universe "Pine Screener".
// Input: daily bars oldest → newest. Output: the patterns the LATEST data is forming (or has just broken out of / failed),
// strongest first, at most one hit per pattern id.
//
// Definitions follow O'Neil (How to Make Money in Stocks), Minervini (Trade Like a Stock Market Wizard) and Bulkowski
// (Encyclopedia of Chart Patterns). Thresholds are listed next to each detector. Lengths are counted in trading days and
// converted to weeks as days / 5; "weekly closes" (tightness) come from a calendar-week resample of the daily bars.
//
// How the engine works
//  1. Precompute once per stock: sparse tables (O(1) range max-high / min-low with index), prefix sums of volume and close,
//     Wilder ATR(14) as % of price.
//  2. "Body ends": the pattern is evaluated with its body ending at the last bar, at each of the last 6 bars, and the day
//     before the first day of each recent breakout / breakdown burst (10-day closing high / low) in the last 40 bars. This
//     lets a pattern that broke out a few days ago, or broke out and failed, still be described with its pre-breakout
//     shape and pivot.
//  3. For each body end: "lip" candidates = staircase records (bars whose high is ≥ every later high up to the end; the
//     left side high of any base must be one of them), plus two zig-zags (small and medium swing thresholds scaled by
//     ATR). Each detector is O(candidates × small) using the range tables, so ~1,300 bars run in a few ms.
//  4. Stage from the closes after the pattern's key point: no close beyond the pivot → 'forming'; first close beyond the
//     pivot within the last 5 bars → 'breakout' (bearish: breakdown); broke out within the last 40 bars and now more than
//     7.5% back through the pivot → 'failed'. A pattern that broke out longer ago and held is complete, not reported.
//  5. Confidence = weighted share of soft rules passed (hard rules return nothing). < 0.35 dropped.
//     Likelihood words: ≥ 0.75 'very likely', ≥ 0.55 'likely', else 'possible'.

export interface PBar { t: number; o: number; h: number; l: number; c: number; v: number }
export type PatternId = 'flat_base' | 'u_base' | 'cup' | 'cup_handle' | 'ascending_base' | 'vcp' | 'base_on_base' | 'ipo_base' | 'bull_flag' | 'bull_pennant' | 'ascending_triangle' | 'double_bottom' | 'triple_bottom' | 'falling_wedge' | 'high_tight_flag' | 'inverse_hs' | 'double_top' | 'triple_top' | 'head_shoulders' | 'descending_triangle' | 'bear_flag' | 'rising_wedge';
export type PatternBias = 'bullish' | 'bearish';
export type PatternFamily = 'base' | 'continuation' | 'reversal';
export type PatternStage = 'forming' | 'breakout' | 'failed';
export interface PatternMeta { id: PatternId; label: string; bias: PatternBias; family: PatternFamily; group: string; short: string }

const M = (id: PatternId, label: string, bias: PatternBias, family: PatternFamily, group: string, short: string): PatternMeta => ({ id, label, bias, family, group, short });
export const PATTERN_META: Record<PatternId, PatternMeta> = {
  flat_base: M('flat_base', 'Flat base', 'bullish', 'base', 'Flat & ascending bases', 'At least 5 weeks moving sideways, no more than 15% deep, after a rise.'),
  u_base: M('u_base', 'U / rounding base', 'bullish', 'base', 'Cup & U', 'A rounded, saucer-shaped base without the classic cup proportions.'),
  cup: M('cup', 'Cup', 'bullish', 'base', 'Cup & U', 'A rounded U-shaped base 7–65 weeks long and 12–33% deep, right side back near the left high; no handle yet.'),
  cup_handle: M('cup_handle', 'Cup with handle', 'bullish', 'base', 'Cup & U', 'A cup followed by a short, shallow pullback (handle) in its upper half on lighter volume.'),
  ascending_base: M('ascending_base', 'Ascending base', 'bullish', 'base', 'Flat & ascending bases', 'Three pullbacks of 10–20% over 9–16 weeks, each low and high above the last.'),
  vcp: M('vcp', 'VCP (volatility contraction)', 'bullish', 'base', 'VCP', 'Two to six pullbacks, each smaller than the one before, with volume drying up in the last.'),
  base_on_base: M('base_on_base', 'Base on base', 'bullish', 'base', 'IPO & base-on-base', 'A new base forming just above an earlier base whose breakout gained less than 20%.'),
  ipo_base: M('ipo_base', 'IPO base', 'bullish', 'base', 'IPO & base-on-base', 'The first base after listing (within about two years), a correction from the post-listing high.'),
  bull_flag: M('bull_flag', 'Bull flag', 'bullish', 'continuation', 'Flags & pennants', 'A sharp rise (the pole) then 1–4 weeks of tight, parallel drift down or sideways.'),
  bull_pennant: M('bull_pennant', 'Bull pennant', 'bullish', 'continuation', 'Flags & pennants', 'A sharp rise then 1–4 weeks of narrowing, converging range.'),
  ascending_triangle: M('ascending_triangle', 'Ascending triangle', 'bullish', 'continuation', 'Triangles & wedges', 'A flat ceiling touched two or more times with rising lows under it.'),
  double_bottom: M('double_bottom', 'Double bottom (W)', 'bullish', 'reversal', 'Double/triple', 'Two lows at about the same price with a middle peak at least 10% higher, after a fall.'),
  triple_bottom: M('triple_bottom', 'Triple bottom', 'bullish', 'reversal', 'Double/triple', 'Three lows at about the same price with peaks between them, after a fall.'),
  falling_wedge: M('falling_wedge', 'Falling wedge', 'bullish', 'reversal', 'Triangles & wedges', 'Highs and lows both falling, the highs faster, so the range narrows.'),
  high_tight_flag: M('high_tight_flag', 'High tight flag', 'bullish', 'continuation', 'Flags & pennants', 'A 90–100%+ rise in 8 weeks or less, then a 3–5 week pullback of no more than 25%.'),
  inverse_hs: M('inverse_hs', 'Inverse head & shoulders', 'bullish', 'reversal', 'Head & shoulders', 'Three lows with the middle one deepest, after a fall; buy point above the neckline.'),
  double_top: M('double_top', 'Double top', 'bearish', 'reversal', 'Double/triple', 'Two highs at about the same price with a dip of at least 10% between them, after a rise.'),
  triple_top: M('triple_top', 'Triple top', 'bearish', 'reversal', 'Double/triple', 'Three highs at about the same price with dips between them, after a rise.'),
  head_shoulders: M('head_shoulders', 'Head & shoulders top', 'bearish', 'reversal', 'Head & shoulders', 'Three highs with the middle one highest, after a rise; breaks down below the neckline.'),
  descending_triangle: M('descending_triangle', 'Descending triangle', 'bearish', 'continuation', 'Triangles & wedges', 'A flat floor touched two or more times with falling highs above it.'),
  bear_flag: M('bear_flag', 'Bear flag', 'bearish', 'continuation', 'Flags & pennants', 'A sharp fall then 1–4 weeks of tight drift up or sideways.'),
  rising_wedge: M('rising_wedge', 'Rising wedge', 'bearish', 'reversal', 'Triangles & wedges', 'Highs and lows both rising, the lows faster, so the range narrows.'),
};
export const PATTERN_IDS: PatternId[] = Object.keys(PATTERN_META) as PatternId[];

export interface PatternLine { kind: 'pivot' | 'support' | 'resistance' | 'neckline' | 'trend'; points: Array<[number, number]> }
export interface PatternHit {
  id: PatternId; label: string; bias: PatternBias; family: PatternFamily;
  stage: PatternStage; confidence: number; likelihood: 'very likely' | 'likely' | 'possible';
  startT: number; endT: number; lengthBars: number; depthPct: number | null;
  pivot: number | null; distToPivotPct: number | null;
  note: string;
  lines: PatternLine[];
}
export interface DetectOptions { firstTradeT?: number; maxBars?: number }
export interface PatternTag { id: PatternId; b: 'U' | 'D'; s: 'f' | 'b' | 'x'; c: number; p: number | null; d: number | null }

// ───────────────────────────── helpers ─────────────────────────────

const DAY = 86_400_000;
const MIN_CONF = 0.35;
/** Default history used for detection: ~2.8 years (65-week base + a year of prior trend + margin). */
const DEFAULT_MAX_BARS = 700;
/** Without a listing date, a history shorter than this many bars is taken to start at the listing (IPO base). */
const SHORT_HISTORY_BARS = 450;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Linear 0 at `bad` → 1 at `good` (either direction). */
function ramp(x: number, bad: number, good: number): number {
  if (!Number.isFinite(x)) return 0;
  if (good === bad) return x >= good ? 1 : 0;
  return clamp01((x - bad) / (good - bad));
}
/** Weighted average of [weight, score 0..1] pairs. */
function wscore(parts: Array<[number, number]>): number {
  let w = 0, s = 0, mn = 1;
  for (const [wi, si] of parts) { const v = clamp01(si); w += wi; s += wi * v; if (v < mn) mn = v; }
  // 80% the weighted mean, 20% the weakest rule — one badly failed rule keeps a shape out of 'very likely'
  return w > 0 ? 0.8 * (s / w) + 0.2 * mn : 0;
}

/** Range max / min with index in O(1) after O(n log n) build. */
class Sparse {
  private lv: Int32Array[] = [];
  constructor(private a: ArrayLike<number>, private isMax: boolean) {
    const n = a.length;
    const l0 = new Int32Array(n);
    for (let i = 0; i < n; i++) l0[i] = i;
    this.lv.push(l0);
    for (let k = 1; (1 << k) <= n; k++) {
      const prev = this.lv[k - 1], half = 1 << (k - 1), len = n - (1 << k) + 1;
      const cur = new Int32Array(len);
      for (let i = 0; i < len; i++) cur[i] = this.better(prev[i], prev[i + half]);
      this.lv.push(cur);
    }
  }
  private better(i: number, j: number): number {
    const a = this.a;
    // ties → the EARLIER index (the left side high / first low of a range)
    return this.isMax ? (a[j] > a[i] ? j : i) : (a[j] < a[i] ? j : i);
  }
  /** Index of the max (or min) in [l, r] inclusive; -1 when empty. */
  idx(l: number, r: number): number {
    if (l < 0) l = 0;
    if (r > this.a.length - 1) r = this.a.length - 1;
    if (l > r) return -1;
    const k = 31 - Math.clz32(r - l + 1);
    return this.better(this.lv[k][l], this.lv[k][r - (1 << k) + 1]);
  }
  val(l: number, r: number): number {
    const i = this.idx(l, r);
    return i < 0 ? NaN : this.a[i];
  }
}

export interface Pivot { i: number; p: number; hi: boolean; confirmed: boolean }

/**
 * Zig-zag swing pivots on [from, to] using highs for peaks and lows for troughs. A swing is confirmed when price reverses
 * by `pct` (fraction) from the running extreme. The last, still-running extreme is appended with confirmed = false.
 * Output strictly alternates high / low. O(to − from).
 */
export function zigzag(H: ArrayLike<number>, L: ArrayLike<number>, from: number, to: number, pct: number): Pivot[] {
  const out: Pivot[] = [];
  if (from < 0) from = 0;
  if (to - from < 2) return out;
  let dir = 0;
  let hiI = from, hiP = H[from], loI = from, loP = L[from];
  let exI = from, exP = 0;
  for (let i = from + 1; i <= to; i++) {
    if (dir === 0) {
      if (H[i] > hiP) { hiP = H[i]; hiI = i; }
      if (L[i] < loP) { loP = L[i]; loI = i; }
      if (hiP >= loP * (1 + pct)) {
        if (loI < hiI) { out.push({ i: loI, p: loP, hi: false, confirmed: true }); dir = 1; exI = hiI; exP = hiP; }
        else { out.push({ i: hiI, p: hiP, hi: true, confirmed: true }); dir = -1; exI = loI; exP = loP; }
      }
      continue;
    }
    if (dir === 1) {
      if (H[i] >= exP) { exP = H[i]; exI = i; }
      else if (L[i] <= exP * (1 - pct)) { out.push({ i: exI, p: exP, hi: true, confirmed: true }); dir = -1; exI = i; exP = L[i]; }
    } else {
      if (L[i] <= exP) { exP = L[i]; exI = i; }
      else if (H[i] >= exP * (1 + pct)) { out.push({ i: exI, p: exP, hi: false, confirmed: true }); dir = 1; exI = i; exP = H[i]; }
    }
  }
  if (dir !== 0) out.push({ i: exI, p: exP, hi: dir === 1, confirmed: false });
  return out;
}

/** Least-squares line y = a + b·x. */
function fitLine(xs: number[], ys: number[]): { a: number; b: number; maxRes: number } {
  const n = xs.length;
  if (n === 0) return { a: NaN, b: 0, maxRes: 0 };
  if (n === 1) return { a: ys[0], b: 0, maxRes: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) { sx += xs[k]; sy += ys[k]; sxx += xs[k] * xs[k]; sxy += xs[k] * ys[k]; }
  const den = n * sxx - sx * sx;
  const b = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  let maxRes = 0;
  for (let k = 0; k < n; k++) maxRes = Math.max(maxRes, Math.abs(ys[k] - (a + b * xs[k])));
  return { a, b, maxRes };
}

interface S {
  n: number; t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
  mxH: Sparse; mnL: Sparse; pv: Float64Array; pc: Float64Array; atrPct: Float64Array; listT: number | null;
}

function build(bars: PBar[], listT: number | null): S {
  const n = bars.length;
  const t: number[] = new Array(n), o: number[] = new Array(n), h: number[] = new Array(n), l: number[] = new Array(n), c: number[] = new Array(n), v: number[] = new Array(n);
  for (let i = 0; i < n; i++) { const b = bars[i]; t[i] = b.t; o[i] = b.o; h[i] = b.h; l[i] = b.l; c[i] = b.c; v[i] = b.v; }
  const pv = new Float64Array(n + 1), pc = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { pv[i + 1] = pv[i] + v[i]; pc[i + 1] = pc[i] + c[i]; }
  const atrPct = new Float64Array(n);
  let atr = 0;
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    atr = i === 0 ? tr : i < 14 ? (atr * i + tr) / (i + 1) : (atr * 13 + tr) / 14;
    atrPct[i] = c[i] > 0 ? atr / c[i] : 0;
  }
  return { n, t, o, h, l, c, v, mxH: new Sparse(h, true), mnL: new Sparse(l, false), pv, pc, atrPct, listT };
}

const avgVol = (s: S, a: number, b: number) => { a = Math.max(0, a); b = Math.min(s.n - 1, b); return b < a ? 0 : (s.pv[b + 1] - s.pv[a]) / (b - a + 1); };
const vol50 = (s: S, i: number) => avgVol(s, i - 49, i);
const sma = (s: S, i: number, p: number) => { const a = Math.max(0, i - p + 1); return (s.pc[i + 1] - s.pc[a]) / (i - a + 1); };
/** Rise into index i: high[i] over the lowest low of the prior ~6 months. */
const priorUp = (s: S, i: number) => s.h[i] / s.mnL.val(i - 130, i) - 1;
/** Fall into index i: 1 − low[i] over the highest high of the prior ~6 months. */
const priorDown = (s: S, i: number) => 1 - s.l[i] / s.mxH.val(i - 130, i);
/** Stage-2 trend template points: close above the 50-day, 50-day above the 200-day. */
const trendOK = (s: S, e: number) => (s.c[e] > sma(s, e, 50) ? 0.5 : 0) + (sma(s, e, 50) > sma(s, e, 200) ? 0.5 : 0);
/** Spread of the last k weekly closes ending at e (fraction of the highest). */
function weeklyTightness(s: S, e: number, k: number): number {
  const wk = (t: number) => Math.floor((t + 3 * DAY) / (7 * DAY)); // Monday-start calendar weeks
  const closes: number[] = [];
  let cur = wk(s.t[e]);
  closes.push(s.c[e]);
  for (let i = e - 1; i >= 0 && closes.length < k; i--) {
    const w = wk(s.t[i]);
    if (w !== cur) { closes.push(s.c[i]); cur = w; }
  }
  if (closes.length < k) return 1;
  let mx = -Infinity, mn = Infinity;
  for (const x of closes) { if (x > mx) mx = x; if (x < mn) mn = x; }
  return mx > 0 ? (mx - mn) / mx : 1;
}
/** Linear-regression slope of closes over [a, b] as a fraction of price per bar. */
function closeSlope(s: S, a: number, b: number): number {
  const xs: number[] = [], ys: number[] = [];
  for (let i = a; i <= b; i++) { xs.push(i); ys.push(s.c[i]); }
  const f = fitLine(xs, ys);
  return s.c[b] > 0 ? f.b / s.c[b] : 0;
}

interface Raw {
  id: PatternId; conf: number; start: number; end: number; keyFrom: number;
  pivot: number; depth: number | null; detail: string; lines: PatternLine[];
  /** Sloped pivot (flag / wedge line, neckline): the level at bar i, used for the stage instead of the flat pivot. */
  lineAt?: (i: number) => number;
}

const LP = (kind: PatternLine['kind'], s: S, i0: number, p0: number, i1: number, p1: number): PatternLine => ({ kind, points: [[s.t[i0], p0], [s.t[i1], p1]] });

// ───────────────────────────── detectors (one body end) ─────────────────────────────

/** Staircase records: i in [e − maxLen, e − minLen] with high[i] ≥ every high in (i, e] and ≥ the 5 highs before it (a real
 *  peak, not the shoulder of one). Ordered nearest first. lowRecords is the mirror for lows. */
function highRecords(s: S, e: number, minLen: number, maxLen: number): number[] {
  const out: number[] = [];
  let run = -Infinity;
  const stop = Math.max(0, e - maxLen);
  for (let i = e; i >= stop; i--) {
    if (s.h[i] >= run) { if (e - i >= minLen && s.h[i] >= s.mxH.val(i - 5, i - 1)) out.push(i); run = s.h[i]; }
  }
  return out;
}
function lowRecords(s: S, e: number, minLen: number, maxLen: number): number[] {
  const out: number[] = [];
  let run = Infinity;
  const stop = Math.max(0, e - maxLen);
  for (let i = e; i >= stop; i--) {
    if (s.l[i] <= run) { if (e - i >= minLen && !(s.l[i] > s.mnL.val(i - 5, i - 1))) out.push(i); run = s.l[i]; }
  }
  return out;
}

function push(out: Map<PatternId, Raw>, r: Raw | null) {
  if (!r || !(r.conf >= MIN_CONF) || !(r.pivot > 0)) return;
  const prev = out.get(r.id);
  if (!prev || r.conf > prev.conf) out.set(r.id, r);
}

/**
 * Bases with a left-side high (lip): flat base, cup, cup with handle, U base, base on base, IPO base.
 *  Flat base   (O'Neil): ≥ 5 weeks (25 bars; up to 26 weeks), depth ≤ 15% (≤ 10% scores best), prior rise ≥ 20% (full at 30%).
 *  Cup         (O'Neil): 7–65 weeks, depth 12–33% (to 50% penalised), prior rise ≥ 20–30%, rounded: ≥ 35% of the
 *                       cup's closes in the lower 30% of its range (a straight-sided V spends ~30% there, a U ~50%),
 *                       low in the middle 15–85% of the cup, right side back within 25% (full credit within 5%) of the lip.
 *                       No handle yet (right-side pullback < 2.5% or < 5 bars) → pivot = lip high.
 *  Handle      (O'Neil): 5–35 bars after the right-side high, 2.5–15% deep (≤ 10% best), its low in the upper half of the
 *                       cup, right-side high within 15% of the lip, lighter volume; pivot = handle high (no tick added — O'Neil adds 0.10;
 *                       the caller can).
 *  U base:              rounded like a cup but not a classic cup (too shallow 8–12%, too deep, or no prior rise).
 *  Base on base (O'Neil): a base ≤ 25% deep whose lip is 5–20% above the pivot of a prior base (≤ 35% deep, broke out
 *                       within 60 bars before the lip) and whose low holds above ~93% of that pivot.
 */
function detectLipBases(s: S, e: number, recs: number[], out: Map<PatternId, Raw>) {
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < 25 || len > 330) continue;
    const lip = s.h[sIdx];
    const m = s.mnL.idx(sIdx, e);
    const low = s.l[m];
    const depth = 1 - low / lip;
    const up = priorUp(s, sIdx);
    const range = lip - low;
    if (!(range > 0)) continue;
    const posInRange = (s.c[e] - low) / range;
    const tight3 = weeklyTightness(s, e, 3);

    // Flat base
    if (len <= 130 && depth <= 0.15 && depth >= 0.02 && up >= 0.2) {
      const volDry = avgVol(s, e - 9, e) / Math.max(1, vol50(s, sIdx));
      const conf = wscore([
        [2, ramp(up, 0.2, 0.35)], [2, ramp(depth, 0.15, 0.1)], [1, ramp(len, 25, 35)], [1, ramp(posInRange, 0.3, 0.75)],
        [2, ramp(volDry, 1.1, 0.75)], [2, ramp(tight3, 0.06, 0.025)], [1, trendOK(s, e)],
      ]);
      push(out, { id: 'flat_base', conf, start: sIdx, end: e, keyFrom: sIdx, pivot: lip, depth,
        detail: '', lines: [LP('resistance', s, sIdx, lip, e, lip), LP('support', s, sIdx, low, e, low)] });
    }

    if (len < 35) continue;
    const r = m >= e ? e : s.mxH.idx(m + 1, e);
    const rightH = s.h[r];
    const recovery = rightH / lip;
    const cupLen = r - sIdx;
    if (cupLen < 25 || recovery < 0.75) continue;
    const lowPos = (m - sIdx) / cupLen;
    // roundness: share of the cup's closes in the lower 30% of its range
    const zone = low + 0.3 * range;
    let inZone = 0;
    for (let i = sIdx; i <= r; i++) if (s.c[i] <= zone) inZone++;
    const round = inZone / (cupLen + 1);
    if (round < 0.3 || lowPos < 0.15 || lowPos > 0.85) continue;
    const hLen = e - r;
    const hLow = s.mnL.val(r, e);
    const hDepth = 1 - hLow / rightH;
    const noHandle = hLen < 5 || hDepth < 0.025;
    const handleValid = hLen >= 5 && hLen <= 35 && hDepth >= 0.025 && hDepth <= 0.15 && hLow > low + 0.5 * range && recovery >= 0.85;
    const classic = depth >= 0.12 && depth <= 0.5 && up >= 0.2 && round >= 0.35;
    const depthScore = depth <= 0.33 ? 1 : ramp(depth, 0.5, 0.33);
    const symScore = 1 - Math.min(1, Math.abs(lowPos - 0.5) / 0.4);
    const common: Array<[number, number]> = [
      [2, ramp(up, 0.2, 0.3)], [2, depthScore], [2, ramp(round, 0.33, 0.48)], [1, symScore], [1, ramp(len, 35, 45)], [1, trendOK(s, e)],
    ];
    if (classic && handleValid) {
      const volDry = avgVol(s, r, e) / Math.max(1, vol50(s, r));
      const drift = closeSlope(s, r, e) <= 0.0005 ? 1 : 0;
      const conf = wscore([...common, [2, ramp(recovery, 0.85, 0.97)], [2, ramp(hDepth, 0.15, 0.1)], [1, ramp(volDry, 1.15, 0.8)], [1, drift], [1, ramp(hLen, 4, 7)]]);
      push(out, { id: 'cup_handle', conf, start: sIdx, end: e, keyFrom: r, pivot: rightH, depth,
        detail: `handle ${Math.round(hDepth * 100)}% deep`,
        lines: [LP('pivot', s, r, rightH, e, rightH), LP('resistance', s, sIdx, lip, r, lip), LP('support', s, m, low, m, low)] });
    } else if (classic && noHandle) {
      const conf = wscore([...common, [2, ramp(recovery, 0.75, 0.95)]]);
      push(out, { id: 'cup', conf, start: sIdx, end: e, keyFrom: sIdx, pivot: lip, depth,
        detail: `right side ${Math.round(recovery * 100)}% of the left high`,
        lines: [LP('pivot', s, sIdx, lip, e, lip), LP('support', s, m, low, m, low)] });
    } else if (!classic && (noHandle || handleValid) && depth >= 0.08 && depth <= 0.5 && round >= 0.35) {
      const conf = wscore([[2, ramp(round, 0.35, 0.5)], [2, ramp(recovery, 0.75, 0.95)], [1, symScore], [1, ramp(len, 35, 50)], [1, ramp(up, 0, 0.25)], [1, trendOK(s, e)]]);
      push(out, { id: 'u_base', conf, start: sIdx, end: e, keyFrom: sIdx, pivot: lip, depth, detail: 'rounded bottom',
        lines: [LP('pivot', s, sIdx, lip, e, lip), LP('support', s, m, low, m, low)] });
    }
  }

  // Base on base
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < 20 || len > 130) continue;
    const lip = s.h[sIdx];
    const low = s.mnL.val(sIdx, e);
    const depth = 1 - low / lip;
    if (depth > 0.25 || depth < 0.03) continue;
    for (let k = sIdx - 3; k >= Math.max(41, sIdx - 60); k--) {
      const prevMax = s.mxH.val(k - 40, k - 1);
      if (!(s.c[k] > prevMax)) continue;
      if (k > 0 && s.c[k - 1] > s.mxH.val(k - 41, k - 2)) continue; // only the first day of a breakout burst
      const priorLow = s.mnL.val(k - 40, k - 1);
      const priorDepth = 1 - priorLow / prevMax;
      const adv = lip / prevMax - 1;
      if (priorDepth > 0.35 || priorDepth < 0.04 || adv < 0.05 || adv >= 0.2 || low < prevMax * 0.93) break;
      const conf = wscore([[2, adv <= 0.1 ? ramp(adv, 0.05, 0.08) : ramp(adv, 0.2, 0.12)], [2, ramp(low / prevMax, 0.93, 1.0)], [1, ramp(depth, 0.25, 0.12)], [1, ramp(len, 20, 30)], [1, trendOK(s, e)], [1, ramp(priorUp(s, k), 0.1, 0.3)]]);
      push(out, { id: 'base_on_base', conf, start: Math.max(0, k - 40), end: e, keyFrom: sIdx, pivot: lip, depth,
        detail: `earlier base pivot ${fmt(prevMax)}, gained only ${Math.round(adv * 100)}% before this base`,
        lines: [LP('pivot', s, sIdx, lip, e, lip), LP('support', s, k - 40, prevMax, k, prevMax)] });
      break;
    }
  }
}

/** IPO base (O'Neil): within ~2 years of listing; correction from the post-listing high, ≥ 3 bars, 8–50% deep
 *  (25–50% is classic for longer ones); pivot = post-listing high. */
function detectIpoBase(s: S, e: number, out: Map<PatternId, Raw>) {
  if (s.listT == null) return;
  const age = (s.t[e] - s.listT) / DAY;
  if (age > 730 || age < 7) return;
  let first = 0;
  while (first < e && s.t[first] < s.listT) first++;
  const sIdx = s.mxH.idx(first, e - 3);
  if (sIdx < 0 || s.h[sIdx] < s.mxH.val(sIdx, e)) return;
  const len = e - sIdx + 1;
  const lip = s.h[sIdx];
  const m = s.mnL.idx(sIdx, e);
  const depth = 1 - s.l[m] / lip;
  if (depth < 0.08 || depth > 0.5) return;
  const posInRange = (s.c[e] - s.l[m]) / (lip - s.l[m]);
  if (posInRange < 0.25) return; // still falling — not a base yet
  const depthOk = len <= 25 ? ramp(depth, 0.5, 0.3) : (depth >= 0.25 ? ramp(depth, 0.55, 0.45) : ramp(depth, 0.08, 0.2));
  const conf = wscore([[2, ramp(len, 3, 15)], [2, depthOk], [1, ramp(posInRange, 0.3, 0.75)], [1, ramp(730 - age, 0, 365)], [1, ramp(avgVol(s, e - 9, e) / Math.max(1, avgVol(s, sIdx - 20, sIdx)), 1.2, 0.7)]]);
  push(out, { id: 'ipo_base', conf, start: sIdx, end: e, keyFrom: sIdx, pivot: lip, depth,
    detail: `${Math.round(age / 30.4)} months after listing`,
    lines: [LP('pivot', s, sIdx, lip, e, lip), LP('support', s, m, s.l[m], e, s.l[m])] });
}

/**
 * VCP (Minervini): within a base (lip record 3–65 weeks back), 2–6 successive pullbacks each < 92% of the one before
 * (e.g. 25% → 12% → 6%), the first 8–50%, the last ≤ 12% (≤ 7% best), last contraction high within 12% of the base high, prior rise ≥ 20% (full at 35%), volume in the
 * last contraction below its 50-day average; pivot = high of the last contraction.
 */
function detectVcp(s: S, e: number, recs: number[], zz: Pivot[], out: Map<PatternId, Raw>) {
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < 15 || len > 330) continue;
    const up = priorUp(s, sIdx);
    if (up < 0.15) continue;
    const seq: Pivot[] = [{ i: sIdx, p: s.h[sIdx], hi: true, confirmed: true }];
    for (const q of zz) {
      if (q.i <= sIdx) continue;
      const last = seq[seq.length - 1];
      if (last.hi === q.hi) { if (q.hi ? q.p > last.p : q.p < last.p) seq[seq.length - 1] = q; }
      else seq.push(q);
    }
    const cs: Array<{ hi: Pivot; lo: Pivot; d: number }> = [];
    for (let k = 0; k + 1 < seq.length; k++) if (seq[k].hi && !seq[k + 1].hi) cs.push({ hi: seq[k], lo: seq[k + 1], d: 1 - seq[k + 1].p / seq[k].p });
    if (cs.length < 2) continue;
    let j = cs.length - 1;
    while (j > 0 && cs[j].d < cs[j - 1].d * 0.92 && cs.length - j < 6) j--;
    const count = cs.length - j;
    if (count < 2) continue;
    const firstC = cs[j], lastC = cs[cs.length - 1];
    if (firstC.d < 0.08 || firstC.d > 0.5 || lastC.d > 0.12) continue;
    const pivot = lastC.hi.p;
    if (pivot < s.h[sIdx] * 0.88) continue; // the contractions tighten near the top of the base
    if (s.mxH.val(lastC.hi.i + 1, e) > pivot) continue;
    let lowsRise = 0;
    for (let k = j + 1; k < cs.length; k++) if (cs[k].lo.p >= cs[k - 1].lo.p * 0.99) lowsRise++;
    const volDry = avgVol(s, lastC.hi.i, e) / Math.max(1, vol50(s, firstC.hi.i));
    const conf = wscore([
      [2, ramp(up, 0.2, 0.35)], [2, ramp(count, 1, 3)], [2, ramp(lastC.d, 0.12, 0.07)], [1, lowsRise / Math.max(1, count - 1)],
      [2, ramp(volDry, 1.1, 0.7)], [1, trendOK(s, e)], [1, ramp(tightRatio(cs, j), 0.8, 0.5)],
    ]);
    const path = cs.slice(j).map((x) => `${Math.round(x.d * 100)}%`).join(' → ');
    push(out, { id: 'vcp', conf, start: firstC.hi.i, end: e, keyFrom: lastC.hi.i, pivot, depth: firstC.d,
      detail: `${count} contractions ${path}`,
      lines: [LP('pivot', s, lastC.hi.i, pivot, e, pivot), ...cs.slice(j).map((x) => LP('trend', s, x.hi.i, x.hi.p, x.lo.i, x.lo.p))] });
  }
}
/** Average ratio between successive contraction depths (smaller = cleaner contraction). */
function tightRatio(cs: Array<{ d: number }>, j: number): number {
  let sum = 0, n = 0;
  for (let k = j + 1; k < cs.length; k++) { sum += cs[k].d / cs[k - 1].d; n++; }
  return n ? sum / n : 1;
}

/** Ascending base (O'Neil): 8–18 weeks (9–16 best), three pullbacks of 8–22% (10–20% best), each high and low above
 *  the previous; prior rise ≥ 20%; pivot = the third high. */
function detectAscendingBase(s: S, e: number, zz: Pivot[], out: Map<PatternId, Raw>) {
  const pairs: Array<{ hi: Pivot; lo: Pivot }> = [];
  for (let k = 0; k + 1 < zz.length; k++) if (zz[k].hi && !zz[k + 1].hi && zz[k].i >= e - 100) pairs.push({ hi: zz[k], lo: zz[k + 1] });
  if (pairs.length < 3) return;
  const [a, b, c] = pairs.slice(-3);
  const span = e - a.hi.i + 1;
  if (span < 40 || span > 95) return;
  if (!(b.hi.p > a.hi.p * 1.01 && c.hi.p > b.hi.p * 1.01 && b.lo.p > a.lo.p && c.lo.p > b.lo.p)) return;
  const ds = [a, b, c].map((x) => 1 - x.lo.p / x.hi.p);
  if (ds.some((d) => d < 0.08 || d > 0.22)) return;
  const pivot = c.hi.p;
  if (s.mxH.val(c.hi.i + 1, e) > pivot) return;
  const up = priorUp(s, a.hi.i);
  if (up < 0.15) return;
  const conf = wscore([[2, ramp(up, 0.15, 0.3)], [3, ds.reduce((x, d) => x + (d >= 0.1 && d <= 0.2 ? 1 : 0.5), 0) / 3], [1, ramp(span, 40, 45) * ramp(span, 95, 80)], [1, trendOK(s, e)]]);
  push(out, { id: 'ascending_base', conf, start: a.hi.i, end: e, keyFrom: c.hi.i, pivot, depth: Math.max(...ds),
    detail: `pullbacks ${ds.map((d) => Math.round(d * 100) + '%').join(', ')}`,
    lines: [LP('pivot', s, c.hi.i, pivot, e, pivot), LP('trend', s, a.lo.i, a.lo.p, c.lo.i, c.lo.p)] });
}

/** High tight flag (O'Neil): pole ≥ 90% (full at 100%) in ≤ 8 weeks (40 bars), then a 2–6 week (3–5 best) flag no more
 *  than 25% deep (≤ 20% best); pivot = flag high. */
function detectHTF(s: S, e: number, recs: number[], out: Map<PatternId, Raw>) {
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < 8 || len > 32) continue;
    const p = s.mnL.idx(sIdx - 40, sIdx - 1);
    if (p < 0) continue;
    const rise = s.h[sIdx] / s.l[p] - 1;
    if (rise < 0.85) continue;
    const depth = 1 - s.mnL.val(sIdx, e) / s.h[sIdx];
    if (depth > 0.25) continue;
    const conf = wscore([[3, ramp(rise, 0.85, 1.0)], [2, ramp(depth, 0.25, 0.15)], [1, ramp(len, 8, 15) * ramp(len, 32, 26)], [1, ramp(avgVol(s, sIdx, e) / Math.max(1, avgVol(s, p, sIdx)), 1.1, 0.7)]]);
    push(out, { id: 'high_tight_flag', conf, start: p, end: e, keyFrom: sIdx, pivot: s.h[sIdx], depth,
      detail: `pole +${Math.round(rise * 100)}% in ${sIdx - p} days, flag ${Math.round(depth * 100)}% deep`,
      lines: [LP('pivot', s, sIdx, s.h[sIdx], e, s.h[sIdx]), LP('trend', s, p, s.l[p], sIdx, s.h[sIdx])] });
  }
}

/** Channel over [a, b]: lines through the swing highs / swing lows (bars that are the extreme of the 2 bars either side;
 *  plain regression on every bar when fewer than 2 swings), shifted so every high / low is inside. */
function channel(s: S, a: number, b: number) {
  const hx: number[] = [], hy: number[] = [], lx: number[] = [], ly: number[] = [];
  for (let i = a; i <= b; i++) {
    const lo = Math.max(a, i - 2), hi = Math.min(b, i + 2);
    if (s.mxH.idx(lo, hi) === i) { hx.push(i); hy.push(s.h[i]); }
    if (s.mnL.idx(lo, hi) === i) { lx.push(i); ly.push(s.l[i]); }
  }
  const all = (arr: number[]) => { const xs: number[] = [], ys: number[] = []; for (let i = a; i <= b; i++) { xs.push(i); ys.push(arr[i]); } return [xs, ys] as const; };
  const fu = hx.length >= 2 ? fitLine(hx, hy) : fitLine(...all(s.h));
  const fl = lx.length >= 2 ? fitLine(lx, ly) : fitLine(...all(s.l));
  let offU = 0, offL = 0;
  for (let i = a; i <= b; i++) {
    offU = Math.max(offU, s.h[i] - (fu.a + fu.b * i));
    offL = Math.max(offL, (fl.a + fl.b * i) - s.l[i]);
  }
  const U = (i: number) => fu.a + fu.b * i + offU, Lo = (i: number) => fl.a + fl.b * i - offL;
  return { U, L: Lo, bu: fu.b, bl: fl.b };
}

/**
 * Bull flag / pennant: pole ≥ 15% (full at 20%) in ≤ 20 bars, then 5–22 bars of consolidation retracing ≤ 50% of the
 * pole (≤ 38% best). Flag: both envelope lines flat or sloping down, roughly parallel (end/start width 0.6–1.5).
 * Pennant: upper line falling, lower line rising/flat, width at the end < 60% of the start. Pivot = upper line at the end.
 * Bear flag: the mirror after a ≥ 15% drop, drifting up/sideways; breakdown = lower line at the end.
 */
function detectFlags(s: S, e: number, recs: number[], floors: number[], out: Map<PatternId, Raw>) {
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < 5 || len > 22) continue;
    const p = s.mnL.idx(sIdx - 20, sIdx - 1);
    if (p < 0) continue;
    const top = s.h[sIdx], base = s.l[p];
    const rise = top / base - 1;
    if (rise < 0.15 || rise >= 0.85) continue; // ≥ 85% in 4 weeks is a high tight flag
    const lo = s.mnL.val(sIdx, e);
    const retr = (top - lo) / (top - base);
    if (retr > 0.5) continue;
    const ch = channel(s, sIdx, e);
    const su = ch.bu / top, sl = ch.bl / top;
    const w0 = ch.U(sIdx) - ch.L(sIdx), w1 = ch.U(e) - ch.L(e);
    const wr = w0 > 0 ? w1 / w0 : 1;
    const pivot = ch.U(e);
    const commonParts: Array<[number, number]> = [[3, ramp(rise, 0.15, 0.25)], [2, ramp(retr, 0.5, 0.33)], [1, ramp(sIdx - p, 25, 10)], [1, ramp(avgVol(s, sIdx, e) / Math.max(1, avgVol(s, p, sIdx)), 1.1, 0.75)], [1, ramp(len, 4, 7)]];
    const lines = [LP('trend', s, sIdx, ch.U(sIdx), e, ch.U(e)), LP('trend', s, sIdx, ch.L(sIdx), e, ch.L(e)), LP('trend', s, p, base, sIdx, top)];
    if (su <= 0.0015 && sl <= 0.0015 && wr >= 0.6 && wr <= 1.5) {
      const conf = wscore([...commonParts, [2, ramp(Math.abs(wr - 1), 0.5, 0.15)], [1, su <= 0 ? 1 : 0.5]]);
      push(out, { id: 'bull_flag', conf, start: p, end: e, keyFrom: sIdx + 1, pivot, depth: 1 - lo / top, lineAt: ch.U,
        detail: `pole +${Math.round(rise * 100)}% in ${sIdx - p} days, ${len}-day flag`, lines });
    } else if (su < 0 && sl >= -0.0005 && wr < 0.6) {
      const conf = wscore([...commonParts, [2, ramp(wr, 0.6, 0.3)]]);
      push(out, { id: 'bull_pennant', conf, start: p, end: e, keyFrom: sIdx + 1, pivot, depth: 1 - lo / top, lineAt: ch.U,
        detail: `pole +${Math.round(rise * 100)}% in ${sIdx - p} days, ${len}-day pennant`, lines });
    }
  }
  for (const sIdx of floors) {
    const len = e - sIdx + 1;
    if (len < 5 || len > 22) continue;
    const p = s.mxH.idx(sIdx - 20, sIdx - 1);
    if (p < 0) continue;
    const top = s.h[p], bot = s.l[sIdx];
    const drop = 1 - bot / top;
    if (drop < 0.15) continue;
    const hi = s.mxH.val(sIdx, e);
    const retr = (hi - bot) / (top - bot);
    if (retr > 0.5) continue;
    const ch = channel(s, sIdx, e);
    const su = ch.bu / bot, sl = ch.bl / bot;
    const w0 = ch.U(sIdx) - ch.L(sIdx), w1 = ch.U(e) - ch.L(e);
    const wr = w0 > 0 ? w1 / w0 : 1;
    if (!(su >= -0.0015 && sl >= -0.0015 && wr >= 0.5 && wr <= 1.6)) continue;
    if (!(s.c[e] < sma(s, e, 50))) continue; // a bear flag sits in a downtrend: below its 50-day average
    const conf = wscore([[3, ramp(drop, 0.15, 0.25)], [2, ramp(retr, 0.5, 0.33)], [1, ramp(sIdx - p, 25, 10)], [2, ramp(Math.abs(wr - 1), 0.6, 0.15)], [1, ramp(len, 4, 7)], [1, s.c[e] < sma(s, e, 50) ? 1 : 0]]);
    push(out, { id: 'bear_flag', conf, start: p, end: e, keyFrom: sIdx + 1, pivot: ch.L(e), depth: drop, lineAt: ch.L,
      detail: `pole −${Math.round(drop * 100)}% in ${sIdx - p} days, ${len}-day flag`,
      lines: [LP('trend', s, sIdx, ch.U(sIdx), e, ch.U(e)), LP('trend', s, sIdx, ch.L(sIdx), e, ch.L(e)), LP('trend', s, p, top, sIdx, bot)] });
  }
}

/**
 * Triangles and wedges from the last 4–8 confirmed swing points (medium zig-zag), window 15–130 bars, ≥ 2 highs and
 * ≥ 2 lows. Change of each line across the window as a fraction of price:
 *  Ascending triangle: swing highs within 3% of each other (2% with only two touches), ceiling line within ±2.5%, swing lows each higher, lower line rising ≥ 4%; pivot = top.
 *  Descending triangle: swing lows within 3% (2% with two touches), floor line within ±2.5%, highs each lower, upper line falling ≥ 4%; breakdown = floor.
 *  Wedges need ≥ 5 touches (so one line is tested three times), ≥ 20 bars, swing points within 2.5% of the lines and
 *  ≥ 90% of the window's closes between the lines.
 *  Falling wedge: both lines falling (upper ≤ −4%, lower ≤ −1.5%), upper steeper, width at the end < 75% of the start;
 *    pivot = upper line at the end.
 *  Rising wedge: both rising (lower ≥ +4%, upper ≥ +1.5%), lower steeper, converging; breakdown = lower line at the end.
 */
function detectTriWedge(s: S, e: number, zz: Pivot[], out: Map<PatternId, Raw>) {
  // confirmed swings, plus the running one when price has already moved ≥ 2% away from it (a touch that is turning)
  const conf = zz.filter((q) => q.i >= e - 130 && (q.confirmed || (q.i <= e - 2 && (q.hi ? 1 - s.c[e] / q.p : s.c[e] / q.p - 1) >= 0.02)));
  for (let m = 4; m <= Math.min(8, conf.length); m++) {
    const W = conf.slice(-m);
    const a = W[0].i;
    const len = e - a + 1;
    if (len < 15 || len > 130) continue;
    const Hs = W.filter((q) => q.hi), Ls = W.filter((q) => !q.hi);
    if (Hs.length < 2 || Ls.length < 2) continue;
    const ref = s.c[e];
    const fh = fitLine(Hs.map((q) => q.i), Hs.map((q) => q.p));
    const fl = fitLine(Ls.map((q) => q.i), Ls.map((q) => q.p));
    const chH = (fh.b * len) / ref, chL = (fl.b * len) / ref;
    const fitQ = Math.max(fh.maxRes, fl.maxRes) / ref;
    if (fitQ > 0.04) continue;
    const hMax = Math.max(...Hs.map((q) => q.p)), hMin = Math.min(...Hs.map((q) => q.p));
    const lMax = Math.max(...Ls.map((q) => q.p)), lMin = Math.min(...Ls.map((q) => q.p));
    const risingLows = Ls.every((q, k) => k === 0 || q.p > Ls[k - 1].p * 1.02);
    const fallingHighs = Hs.every((q, k) => k === 0 || q.p < Hs[k - 1].p * 0.98);
    const touches = Hs.length + Ls.length;
    const lastH = Hs[Hs.length - 1], lastL = Ls[Ls.length - 1];
    const wStart = (fh.a + fh.b * a) - (fl.a + fl.b * a), wEnd = (fh.a + fh.b * e) - (fl.a + fl.b * e);
    const lineSet = [LP('trend', s, a, fh.a + fh.b * a, e, fh.a + fh.b * e), LP('trend', s, a, fl.a + fl.b * a, e, fl.a + fl.b * e)];
    // share of closes in the window that stay between the two lines (±1%) — a random zig-zag fits its pivots but not its bars
    let inside = 0;
    for (let i = a; i <= e; i++) { const c = s.c[i]; if (c <= (fh.a + fh.b * i) * 1.01 && c >= (fl.a + fl.b * i) * 0.99) inside++; }
    const contain = inside / len;
    const flatTol = (k: number) => (k >= 3 ? 0.03 : 0.02);
    if ((hMax - hMin) / hMax <= flatTol(Hs.length) && Math.abs(chH) <= 0.025 && risingLows && chL >= 0.04 && s.mxH.val(lastH.i + 1, e) <= hMax * 1.005) {
      const c = wscore([[2, ramp(touches, 3, 6)], [3, ramp(Hs.length, 2, 3)], [2, ramp(chL, 0.04, 0.1)], [1, ramp(fitQ, 0.04, 0.015)], [1, ramp(len, 15, 30)], [1, ramp(contain, 0.8, 0.95)]]);
      push(out, { id: 'ascending_triangle', conf: c, start: a, end: e, keyFrom: a, pivot: hMax, depth: 1 - lMin / hMax,
        detail: `${Hs.length} touches of ${fmt(hMax)}, lows rising`, lines: [LP('resistance', s, a, hMax, e, hMax), lineSet[1]] });
    }
    if ((lMax - lMin) / lMax <= flatTol(Ls.length) && Math.abs(chL) <= 0.025 && fallingHighs && chH <= -0.04 && s.mnL.val(lastL.i + 1, e) >= lMin * 0.995) {
      const c = wscore([[2, ramp(touches, 3, 6)], [3, ramp(Ls.length, 2, 3)], [2, ramp(-chH, 0.04, 0.1)], [1, ramp(fitQ, 0.04, 0.015)], [1, ramp(len, 15, 30)], [1, ramp(contain, 0.8, 0.95)]]);
      push(out, { id: 'descending_triangle', conf: c, start: a, end: e, keyFrom: a, pivot: lMin, depth: 1 - lMin / hMax,
        detail: `${Ls.length} touches of ${fmt(lMin)}, highs falling`, lines: [LP('support', s, a, lMin, e, lMin), lineSet[0]] });
    }
    const converging = wStart > 0 && wEnd > 0 && wEnd < 0.75 * wStart;
    const wedgeOk = converging && touches >= 5 && len >= 20 && fitQ <= 0.025 && contain >= 0.9;
    if (wedgeOk && chH <= -0.04 && chL <= -0.015 && chH < chL) {
      const piv = fh.a + fh.b * e;
      {
        const c = wscore([[2, ramp(touches, 5, 7)], [2, ramp(wEnd / wStart, 0.75, 0.4)], [2, ramp(fitQ, 0.025, 0.01)], [2, ramp(contain, 0.9, 0.98)], [1, ramp(len, 15, 30)], [1, ramp(priorDown(s, a), 0.05, 0.2)]]);
        push(out, { id: 'falling_wedge', conf: c, start: a, end: e, keyFrom: lastH.i + 1, pivot: piv, depth: 1 - lMin / hMax, lineAt: (i) => fh.a + fh.b * i,
          detail: `${touches} touches, range narrowing`, lines: lineSet });
      }
    }
    if (wedgeOk && chL >= 0.04 && chH >= 0.015 && chL > chH) {
      const piv = fl.a + fl.b * e;
      {
        const c = wscore([[2, ramp(touches, 5, 7)], [2, ramp(wEnd / wStart, 0.75, 0.4)], [2, ramp(fitQ, 0.025, 0.01)], [2, ramp(contain, 0.9, 0.98)], [1, ramp(len, 15, 30)], [1, ramp(priorUp(s, a), 0.05, 0.2)]]);
        push(out, { id: 'rising_wedge', conf: c, start: a, end: e, keyFrom: lastL.i + 1, pivot: piv, depth: 1 - lMin / hMax, lineAt: (i) => fl.a + fl.b * i,
          detail: `${touches} touches, range narrowing`, lines: lineSet });
      }
    }
  }
}

/**
 * Double / triple bottoms and tops and head & shoulders from medium zig-zag swings over the last 65 weeks.
 *  Double bottom (Bulkowski / O'Neil W): two lows within 5% (≤ 3% best), 10–325 bars apart, nothing lower between, the
 *    middle peak ≥ 10% above the higher low, a ≥ 15% fall into the first low, price ≥ 3% off the second low;
 *    pivot = middle peak.
 *  Triple bottom: three lows within 5% band, both peaks ≥ 10% above, pivot = the higher of the two peaks.
 *  Inverse H&S: head ≥ 4% below both shoulders, shoulders within 10% of each other, time ratio 0.4–2.5, neckline peaks
 *    ≥ 5% above the shoulders, ≥ 15% fall before; pivot = neckline extended to the last bar.
 *  Tops: the mirrors, after a ≥ 20% rise; breakdown = middle trough / lower trough / neckline.
 */
function detectReversals(s: S, e: number, zz: Pivot[], out: Map<PatternId, Raw>) {
  const lows = zz.filter((q) => !q.hi && q.i >= e - 330);
  const highs = zz.filter((q) => q.hi && q.i >= e - 330);
  reversalSide(s, e, lows, true, out);
  reversalSide(s, e, highs, false, out);
}

function reversalSide(s: S, e: number, pts: Pivot[], bottom: boolean, out: Map<PatternId, Raw>) {
  if (pts.length < 2) return;
  const last = pts[pts.length - 1];
  // the latest swing must be the last extreme and price must have moved ≥ 3% away from it
  const off = bottom ? s.c[e] / last.p - 1 : 1 - s.c[e] / last.p;
  if (off < 0.03) return;
  if (bottom ? s.mnL.val(last.i, e) < last.p : s.mxH.val(last.i, e) > last.p) return;
  const ext = (a: number, b: number) => (bottom ? s.mxH.idx(a, b) : s.mnL.idx(a, b)); // middle peak (bottom) / trough (top)
  const beyond = (a: number, b: number) => (bottom ? s.mnL.val(a, b) : s.mxH.val(a, b)); // the most extreme low (bottom) / high (top)
  const sgn = bottom ? 1 : -1;
  const trend = (i: number) => (bottom ? priorDown(s, i) : priorUp(s, i));
  const trendMin = bottom ? 0.15 : 0.2;
  const idB: PatternId = bottom ? 'double_bottom' : 'double_top';
  const idT: PatternId = bottom ? 'triple_bottom' : 'triple_top';
  const idH: PatternId = bottom ? 'inverse_hs' : 'head_shoulders';
  const lbl = bottom ? 'peak' : 'trough';
  const pivotOf = (mi: number) => (bottom ? s.h[mi] : s.l[mi]);

  let bestTripleLast = false;
  // Triple
  for (let a = pts.length - 3; a >= 0 && a >= pts.length - 10; a--) {
    for (let b = a + 1; b < pts.length - 1; b++) {
      const P = [pts[a], pts[b], last];
      if (P[1].i - P[0].i < 10 || P[2].i - P[1].i < 10) continue;
      const ps = P.map((q) => q.p);
      const bandHi = Math.max(...ps), bandLo = Math.min(...ps);
      if (bandHi / bandLo - 1 > 0.05) continue;
      const extreme = beyond(P[0].i, P[2].i);
      if (bottom ? extreme < bandLo * 0.999 : extreme > bandHi * 1.001) continue;
      const m1 = ext(P[0].i, P[1].i), m2 = ext(P[1].i, P[2].i);
      const sep1 = bottom ? s.h[m1] / bandHi - 1 : 1 - s.l[m1] / bandLo;
      const sep2 = bottom ? s.h[m2] / bandHi - 1 : 1 - s.l[m2] / bandLo;
      if (sep1 < 0.1 || sep2 < 0.1) continue;
      const tr = trend(P[0].i);
      if (tr < trendMin * 0.75) continue;
      const mi = bottom ? (s.h[m1] >= s.h[m2] ? m1 : m2) : (s.l[m1] <= s.l[m2] ? m1 : m2);
      const pivot = pivotOf(mi);
      const conf = wscore([[2, ramp(bandHi / bandLo - 1, 0.05, 0.02)], [2, ramp(Math.min(sep1, sep2), 0.1, 0.15)], [2, ramp(tr, trendMin * 0.75, trendMin + 0.1)], [1, ramp(P[2].i - P[0].i, 30, 60)], [1, ramp(off, 0.03, 0.08)]]);
      if (conf >= MIN_CONF) bestTripleLast = true;
      push(out, { id: idT, conf, start: P[0].i, end: e, keyFrom: P[2].i, pivot, depth: bottom ? 1 - bandLo / pivot : 1 - pivot / bandHi,
        detail: `three ${bottom ? 'lows' : 'highs'} near ${fmt(bottom ? bandLo : bandHi)}`,
        lines: [LP(bottom ? 'pivot' : 'support', s, P[0].i, pivot, e, pivot), LP(bottom ? 'support' : 'resistance', s, P[0].i, bottom ? bandLo : bandHi, P[2].i, bottom ? bandLo : bandHi)] });
    }
  }

  // Double (skip when the same last swing already makes a triple)
  if (!bestTripleLast) {
    for (let a = pts.length - 2; a >= 0; a--) {
      const A = pts[a];
      const gap = last.i - A.i;
      if (gap < 10) continue;
      if (gap > 325) break;
      const band = Math.max(A.p, last.p) / Math.min(A.p, last.p) - 1;
      if (band > 0.05) continue;
      const lo = Math.min(A.p, last.p), hi = Math.max(A.p, last.p);
      const extreme = beyond(A.i + 1, last.i - 1);
      if (bottom ? extreme < lo : extreme > hi) continue;
      const mi = ext(A.i, last.i);
      const sep = bottom ? s.h[mi] / hi - 1 : 1 - s.l[mi] / lo;
      if (sep < 0.1) continue;
      const tr = trend(A.i);
      if (tr < trendMin * 0.75) continue;
      const pivot = pivotOf(mi);
      const sym = Math.min(mi - A.i, last.i - mi) / Math.max(1, Math.max(mi - A.i, last.i - mi));
      const conf = wscore([[2, ramp(band, 0.05, 0.02)], [2, ramp(sep, 0.1, 0.18)], [2, ramp(tr, trendMin * 0.75, trendMin + 0.1)], [1, ramp(gap, 10, 30)], [1, ramp(sym, 0.2, 0.6)], [1, ramp(off, 0.03, 0.08)]]);
      push(out, { id: idB, conf, start: A.i, end: e, keyFrom: mi, pivot, depth: bottom ? 1 - lo / pivot : 1 - pivot / hi,
        detail: `${bottom ? 'lows' : 'highs'} ${fmt(A.p)} and ${fmt(last.p)}, middle ${lbl} ${fmt(pivot)}`,
        lines: [LP(bottom ? 'pivot' : 'support', s, A.i, pivot, e, pivot), LP(bottom ? 'support' : 'resistance', s, A.i, A.p, last.i, last.p)] });
      break; // nearest qualifying first swing only
    }
  }

  // Head & shoulders
  for (let h = pts.length - 2; h >= 1 && h >= pts.length - 8; h--) {
    const H = pts[h], RS = last;
    if (RS.i - H.i < 5) continue;
    const headDeeper = bottom ? RS.p / H.p - 1 : 1 - RS.p / H.p;
    if (headDeeper < 0.04) continue;
    if (bottom ? s.mnL.val(H.i, RS.i) < H.p : s.mxH.val(H.i, RS.i) > H.p) continue;
    for (let l = h - 1; l >= 0 && l >= h - 4; l--) {
      const LS = pts[l];
      if (H.i - LS.i < 5) continue;
      const lsOk = bottom ? LS.p / H.p - 1 : 1 - LS.p / H.p;
      if (lsOk < 0.04) continue;
      if (bottom ? s.mnL.val(LS.i, H.i) < H.p : s.mxH.val(LS.i, H.i) > H.p) continue;
      const shoulderDiff = Math.abs(LS.p - RS.p) / Math.max(LS.p, RS.p);
      if (shoulderDiff > 0.1) continue;
      const tRatio = (H.i - LS.i) / (RS.i - H.i);
      if (tRatio < 0.4 || tRatio > 2.5) continue;
      const n1 = ext(LS.i, H.i), n2 = ext(H.i, RS.i);
      const p1 = pivotOf(n1), p2 = pivotOf(n2);
      const neckSep = bottom ? Math.min(p1, p2) / Math.max(LS.p, RS.p) - 1 : 1 - Math.max(p1, p2) / Math.min(LS.p, RS.p);
      if (neckSep < 0.05) continue;
      const slope = (p2 - p1) / Math.max(1, n2 - n1);
      const neckAt = (i: number) => p2 + slope * (i - n2);
      const pivot = neckAt(e);
      if (Math.abs(pivot / p2 - 1) > 0.15) continue;
      const tr = trend(LS.i);
      if (tr < trendMin * 0.75) continue;
      const conf = wscore([[2, ramp(shoulderDiff, 0.1, 0.03)], [2, ramp(headDeeper, 0.04, 0.1)], [1, ramp(Math.min(tRatio, 1 / tRatio), 0.4, 0.75)], [2, ramp(tr, trendMin * 0.75, trendMin + 0.1)], [1, ramp(neckSep, 0.05, 0.12)], [1, ramp(off, 0.03, 0.06)]]);
      push(out, { id: idH, conf, start: LS.i, end: e, keyFrom: RS.i, pivot, depth: bottom ? 1 - H.p / pivot : 1 - pivot / H.p, lineAt: neckAt,
        detail: `head ${fmt(H.p)}, shoulders ${fmt(LS.p)} / ${fmt(RS.p)}`,
        lines: [LP('neckline', s, n1, p1, e, pivot), LP('trend', s, LS.i, LS.p, H.i, H.p), LP('trend', s, H.i, H.p, RS.i, RS.p)] });
      break;
    }
  }
}

// ───────────────────────────── stage + driver ─────────────────────────────

/** Stage from closes since the pattern's key point (see header). null = completed long ago / not current. */
function stageOf(s: S, e: number, from: number, pivot: number, bull: boolean, lineAt?: (i: number) => number): { stage: PatternStage; f: number } | null {
  const last = s.n - 1;
  const lv = (i: number) => (lineAt ? lineAt(Math.min(i, e)) : pivot); // a sloped line is frozen at the body end
  let f = -1;
  for (let i = Math.max(0, from); i <= last; i++) if (bull ? s.c[i] > lv(i) : s.c[i] < lv(i)) { f = i; break; }
  if (f < 0) return e === last ? { stage: 'forming', f } : null;
  if (e < last && f > e + 3) return null;
  const since = last - f, cl = s.c[last], level = lv(f);
  if (bull ? cl < level * 0.925 : cl > level * 1.075) return since <= 40 ? { stage: 'failed', f } : null;
  if (since <= 4) return (bull ? cl >= level * 0.97 : cl <= level * 1.03) ? { stage: 'breakout', f } : { stage: 'forming', f };
  return null;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n >= 1 ? n.toFixed(2) : n.toPrecision(3);
}
const likelihoodOf = (c: number): PatternHit['likelihood'] => (c >= 0.75 ? 'very likely' : c >= 0.55 ? 'likely' : 'possible');
const lenWords = (bars: number) => (bars >= 10 ? `${Math.max(1, Math.round(bars / 5))} wk` : `${bars} days`);
const lenNote = (bars: number) => (bars >= 10 ? `${Math.max(1, Math.round(bars / 5))} weeks` : `${bars} days`);

function cleanBars(bars: PBar[]): PBar[] {
  const out: PBar[] = [];
  let lastT = -Infinity;
  for (const b of bars || []) {
    if (!b) continue;
    const t = Number(b.t), c = Number(b.c);
    if (!Number.isFinite(t) || !(c > 0) || t <= lastT) continue;
    let h = Number(b.h), l = Number(b.l), o = Number(b.o), v = Number(b.v);
    if (!(o > 0)) o = c;
    if (!(h > 0)) h = Math.max(o, c);
    if (!(l > 0)) l = Math.min(o, c);
    h = Math.max(h, o, c); l = Math.min(l, o, c);
    if (!(v >= 0)) v = 0;
    out.push({ t, o, h, l, c, v });
    lastT = t;
  }
  return out;
}

/** All patterns found on the latest data, strongest first; at most one hit per PatternId. Empty when nothing qualifies (confidence < 0.35 dropped). */
export function detectPatterns(bars: PBar[], opts?: DetectOptions): PatternHit[] {
  const all = cleanBars(bars);
  if (all.length < 30) return [];
  const listT = opts?.firstTradeT != null && Number.isFinite(opts.firstTradeT) ? Number(opts.firstTradeT) : all.length < SHORT_HISTORY_BARS ? all[0].t : null;
  const maxBars = Math.max(60, Math.floor(opts?.maxBars ?? DEFAULT_MAX_BARS));
  const s = build(all.length > maxBars ? all.slice(-maxBars) : all, listT);
  const last = s.n - 1;

  // body ends: last 6 bars + the day before the first day of each recent breakout / breakdown burst
  const ends = new Set<number>();
  for (let k = 0; k <= 5 && last - k >= 25; k++) ends.add(last - k);
  const isUp = (i: number) => i >= 11 && s.c[i] > s.mxH.val(i - 10, i - 1);
  const isDn = (i: number) => i >= 11 && s.c[i] < s.mnL.val(i - 10, i - 1);
  let nu = 0, nd = 0;
  for (let f = last; f >= Math.max(12, last - 40); f--) {
    if (nu < 3 && isUp(f) && !isUp(f - 1)) { let first = true; for (let j = f - 1; j >= f - 10; j--) if (isUp(j)) { first = false; break; } if (first) { ends.add(f - 1); nu++; } }
    if (nd < 3 && isDn(f) && !isDn(f - 1)) { let first = true; for (let j = f - 1; j >= f - 10; j--) if (isDn(j)) { first = false; break; } if (first) { ends.add(f - 1); nd++; } }
  }

  const best = new Map<PatternId, { raw: Raw; st: { stage: PatternStage; f: number } }>();
  for (const e of [...ends].sort((a, b) => b - a)) {
    if (e < 25) continue;
    const raws = new Map<PatternId, Raw>();
    const atr = s.atrPct[e];
    const zzS = zigzag(s.h, s.l, e - 330, e, Math.min(0.05, Math.max(0.025, 1.2 * atr)));
    const zzM = zigzag(s.h, s.l, e - 340, e, Math.min(0.08, Math.max(0.04, 2 * atr)));
    const recs = highRecords(s, e, 3, 330);
    const floors = lowRecords(s, e, 4, 30);
    detectLipBases(s, e, recs, raws);
    detectIpoBase(s, e, raws);
    detectVcp(s, e, recs, zzS, raws);
    detectAscendingBase(s, e, zzM, raws);
    detectHTF(s, e, recs, raws);
    detectFlags(s, e, recs, floors, raws);
    detectTriWedge(s, e, zzS, raws);
    detectReversals(s, e, zzM, raws);
    for (const raw of raws.values()) {
      const bull = PATTERN_META[raw.id].bias === 'bullish';
      const st = stageOf(s, e, raw.keyFrom, raw.pivot, bull, raw.lineAt);
      if (!st) continue;
      let conf = raw.conf;
      if (st.stage === 'breakout' && st.f >= 0) conf = Math.min(1, conf + (s.v[st.f] >= 1.4 * vol50(s, st.f - 1) ? 0.05 : 0));
      if (st.stage === 'failed') conf *= 0.9;
      const r2 = { ...raw, conf };
      const prev = best.get(raw.id);
      if (!prev || r2.conf > prev.raw.conf + 1e-9) best.set(raw.id, { raw: r2, st });
    }
  }

  const close = s.c[last];
  const hits: PatternHit[] = [];
  for (const { raw, st } of best.values()) {
    if (raw.conf < MIN_CONF) continue;
    const meta = PATTERN_META[raw.id];
    const bull = meta.bias === 'bullish';
    const conf = Math.round(raw.conf * 1000) / 1000;
    const dist = (close / raw.pivot - 1) * 100;
    const lengthBars = raw.end - raw.start + 1;
    const distWords = Math.abs(dist) < 0.5 ? 'close at the level' : `close ${Math.abs(dist).toFixed(0)}% ${dist < 0 ? 'below' : 'above'}`;
    const stageWords = st.stage === 'breakout' ? `; ${bull ? 'broke out' : 'broke down'} ${last - st.f === 0 ? 'today' : `${last - st.f} day${last - st.f === 1 ? '' : 's'} ago`}`
      : st.stage === 'failed' ? `; ${bull ? 'breakout' : 'breakdown'} failed` : '';
    const note = `${meta.label}, ${lenNote(lengthBars)}${raw.depth != null ? `, ${Math.round(raw.depth * 100)}% deep` : ''}${raw.detail ? ` — ${raw.detail}` : ''}; ${bull ? 'pivot' : 'breakdown'} ${fmt(raw.pivot)}, ${distWords}${stageWords}`;
    const lines = raw.lines.slice();
    if (!lines.some((x) => x.kind === 'pivot')) lines.unshift({ kind: 'pivot', points: [[s.t[raw.start], raw.pivot], [s.t[last], raw.pivot]] });
    hits.push({
      id: raw.id, label: meta.label, bias: meta.bias, family: meta.family,
      stage: st.stage, confidence: conf, likelihood: likelihoodOf(conf),
      startT: s.t[raw.start], endT: s.t[raw.end], lengthBars,
      depthPct: raw.depth != null ? Math.round(raw.depth * 1000) / 10 : null,
      pivot: Math.round(raw.pivot * 10000) / 10000, distToPivotPct: Math.round(dist * 100) / 100,
      note, lines,
    });
  }
  return resolve(hits);
}

/** Shapes that describe the same structure: keep only the strongest of each group. */
const EXCLUSIVE: PatternId[][] = [['bull_flag', 'bull_pennant'], ['cup', 'cup_handle', 'u_base'], ['double_bottom', 'triple_bottom'], ['double_top', 'triple_top']];
/** A forming bullish and a forming bearish reading of the same bars (e.g. a cup with handle is also two highs with a
 *  dip): the weaker reading is damped ×0.75 so the headline leads with the stronger and the other drops a level. */
const CONFLICT_DAMP = 0.75;

function resolve(hits: PatternHit[]): PatternHit[] {
  let out = hits.slice();
  for (const g of EXCLUSIVE) {
    const inG = out.filter((h) => g.includes(h.id));
    if (inG.length > 1) {
      const keep = inG.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      out = out.filter((h) => !g.includes(h.id) || h === keep);
    }
  }
  // conflicting forming readings: the side (bullish / bearish) whose best hit is weaker is damped
  const forming = out.filter((h) => h.stage === 'forming');
  const overl = (a: PatternHit, b: PatternHit) => !(a.startT > b.endT || b.startT > a.endT);
  const inConflict = forming.filter((a) => forming.some((b) => b.bias !== a.bias && overl(a, b)));
  const best = (bias: PatternBias) => Math.max(0, ...inConflict.filter((h) => h.bias === bias).map((h) => h.confidence));
  const weaker: PatternBias = best('bullish') >= best('bearish') ? 'bearish' : 'bullish';
  const damp = new Set<PatternHit>(inConflict.filter((h) => h.bias === weaker));
  out = out.map((h) => {
    if (!damp.has(h)) return h;
    const c = Math.round(h.confidence * CONFLICT_DAMP * 1000) / 1000;
    return { ...h, confidence: c, likelihood: likelihoodOf(c) };
  }).filter((h) => h.confidence >= MIN_CONF);
  out.sort((a, b) => b.confidence - a.confidence || (a.stage === 'breakout' ? -1 : 0));
  return out;
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** The one-line chart headline: e.g. 'Very likely forming: Cup with handle (bullish, 7 wk, pivot 512.40, 3% below) · also likely: VCP' or 'No clear chart pattern'. */
export function patternHeadline(hits: PatternHit[], fmtPrice?: (n: number) => string): string {
  if (!hits || hits.length === 0) return 'No clear chart pattern';
  const fp = fmtPrice || fmt;
  const [top, ...rest] = hits;
  const bull = top.bias === 'bullish';
  const verb = top.stage === 'forming' ? 'forming' : top.stage === 'breakout' ? (bull ? 'breaking out' : 'breaking down') : (bull ? 'failed breakout' : 'failed breakdown');
  const lead = top.likelihood === 'possible' ? 'Possibly' : cap(top.likelihood);
  const parts: string[] = [top.bias, lenWords(top.lengthBars)];
  if (top.pivot != null) parts.push(`${bull ? 'pivot' : 'breakdown'} ${fp(top.pivot)}`);
  if (top.distToPivotPct != null) {
    const d = top.distToPivotPct;
    parts.push(Math.abs(d) < 0.5 ? 'at the level' : `${Math.abs(d).toFixed(0)}% ${d < 0 ? 'below' : 'above'}`);
  }
  let out = `${lead} ${verb}: ${top.label} (${parts.join(', ')})`;
  const groups: Record<string, string[]> = {};
  for (const h of rest.slice(0, 3)) (groups[h.likelihood] ||= []).push(h.label);
  for (const lk of ['very likely', 'likely', 'possible']) if (groups[lk]) out += ` · also ${lk}: ${groups[lk].join(', ')}`;
  return out;
}

/** Compact form stored in a screener snapshot row (small JSON). */
export function toTags(hits: PatternHit[]): PatternTag[] {
  return (hits || []).map((h) => ({
    id: h.id,
    b: h.bias === 'bullish' ? 'U' : 'D',
    s: h.stage === 'forming' ? 'f' : h.stage === 'breakout' ? 'b' : 'x',
    c: Math.round(h.confidence * 100),
    p: h.pivot == null ? null : Number(h.pivot.toPrecision(6)),
    d: h.distToPivotPct == null ? null : Math.round(h.distToPivotPct * 10) / 10,
  }));
}
