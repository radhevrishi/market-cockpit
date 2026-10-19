// zzz1025 — "Auto trendlines & levels" for /charts: trendlines and horizontal support / resistance found on the candles on
// screen (daily, weekly or monthly). Owner rule: a line is shown only when price reacted at it THREE or more times — a line
// through two points is any line, never shown. Pure and deterministic (no React, no chart engine); components/charts/
// auto-lines-view + AutoLinesIndicator draw it.
//
//  • swings: fractal pivots (a bar that is the high / low of ±k bars); major swings (larger k) anchor the candidate lines,
//    every swing (smaller k) can be a touch; touches closer than a few bars count once
//  • tolerance: max(0.3 × ATR 14, a share of price) — scaled to the timeframe (daily 0.5 %, weekly 0.8 %, monthly 1.2 %)
//  • a trendline: no CLOSE beyond the line by more than the tolerance between its first and last touch (a couple of wick
//    pierces allowed); after the last touch the first close beyond it marks the line broken
//  • levels: swing highs and lows clustered by price; ≥ 3 touches from separate swings; support ↔ resistance flips counted
//  • price space: log when the chart is on a log scale, or a monthly chart with a move of more than 60 %
import { atr, type Bar } from './chart-math';

export type AutoLinesTf = 'D' | 'W' | 'M';
export interface AutoLinesOpts { tf: AutoLinesTf; maxLines?: number; maxLevelsPerSide?: number; log?: boolean }
export interface Touch { i: number; price: number }
export interface TrendLine {
  kind: 'support' | 'resistance';
  dir: 'rising' | 'falling';
  touches: Touch[];
  firstTouch: number; lastTouch: number;
  state: 'intact' | 'broken';
  breakIndex: number | null;
  /** the line is straight in this space: price(i) = log ? exp(y0 + slope·(i − i0)) : y0 + slope·(i − i0) */
  log: boolean; i0: number; y0: number; slope: number;
  slopePctPerBar: number; slopePctPerWeek: number;
  /** last close against the line at the last bar, % (positive = price above the line) */
  distPct: number;
  /** wick pierces between the first and last touch */
  pierces: number;
  strength: number;
}
export interface Level {
  kind: 'support' | 'resistance';
  price: number;
  touches: Touch[];
  firstTouch: number; lastTouch: number;
  /** times the level changed role (a swing high at it after a swing low, or the other way) */
  flips: number;
  /** last close against the level, % (positive = price above) */
  distPct: number;
  strength: number;
}
/** `n` (zzz1109) — how many bars were analysed; `rejected` — bars left out as invalid (non-finite, low ≤ 0, high < low). Every index
 *  in the result points into the VALID bars (validLineBars), never into the input when bars were rejected. */
export interface AutoLinesResult { trend: TrendLine[]; levels: Level[]; log: boolean; tolPct: number; n?: number; rejected?: number }
/** zzz1109 (deep audit N09) — the bars the line finder can use. */
export const isValidLineBar = (b: any): boolean => !!b && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) && b.l > 0 && b.h >= b.l;
export function validLineBars<T>(bars: readonly T[]): T[] { return bars.filter(isValidLineBar); }
/** The bars a result's indices refer to: the input itself when nothing was rejected, else its valid bars (so a touch's date and
 *  price are the same candle). */
export function analysedBars<T>(bars: readonly T[], r: Pick<AutoLinesResult, 'n'> | null | undefined): readonly T[] {
  return r && r.n != null && r.n !== bars.length ? validLineBars(bars) : bars;
}

interface TfCfg { kAnchor: number; kTouch: number; kLevel: number; gap: number; minSpan: number; atrK: number; pct: number; pierces: number; maxDist: number; barsPerWeek: number; brokenKeep: number }
export const AUTO_LINES_TF: Record<AutoLinesTf, TfCfg> = {
  D: { kAnchor: 5, kTouch: 2, kLevel: 3, gap: 10, minSpan: 20, atrK: 0.3, pct: 0.005, pierces: 2, maxDist: 0.15, barsPerWeek: 5, brokenKeep: 25 },
  W: { kAnchor: 3, kTouch: 2, kLevel: 2, gap: 6, minSpan: 12, atrK: 0.3, pct: 0.008, pierces: 2, maxDist: 0.25, barsPerWeek: 1, brokenKeep: 10 },
  M: { kAnchor: 2, kTouch: 1, kLevel: 1, gap: 3, minSpan: 6, atrK: 0.3, pct: 0.012, pierces: 1, maxDist: 0.4, barsPerWeek: 12 / 52, brokenKeep: 4 },
};
/** Fewest touches for anything to be shown (owner rule). */
export const MIN_TOUCHES = 3;

/** Fractal pivots: indexes where the bar's high (or low) is the extreme of the k bars each side (first of equal values). */
export function pivots(bars: readonly Bar[], k: number, side: 'high' | 'low'): number[] {
  const out: number[] = [];
  const n = bars.length;
  for (let i = k; i < n - k; i++) {
    const v = side === 'high' ? bars[i].h : bars[i].l;
    let ok = true;
    for (let d = 1; d <= k && ok; d++) {
      const a = side === 'high' ? bars[i - d].h : bars[i - d].l, b = side === 'high' ? bars[i + d].h : bars[i + d].l;
      if (side === 'high' ? (a >= v || b > v) : (a <= v || b < v)) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}

/** index of the first entry of a sorted index list that is ≥ i */
function touchStart(list: readonly number[], i: number): number {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] < i) lo = m + 1; else hi = m; }
  return lo;
}

/** Price at bar index i (fractional allowed, may be past the last bar) on a trendline. */
export function linePriceAt(l: Pick<TrendLine, 'log' | 'i0' | 'y0' | 'slope'>, i: number): number {
  const y = l.y0 + l.slope * (i - l.i0);
  return l.log ? Math.exp(y) : y;
}

const median = (a: number[]) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const pct = (a: number, b: number) => (b > 0 ? (a / b - 1) * 100 : 0);

export function autoLines(barsIn: readonly Bar[], opts: AutoLinesOpts): AutoLinesResult {
  const cfg = AUTO_LINES_TF[opts.tf] || AUTO_LINES_TF.D;
  const bars = validLineBars(barsIn);
  const n = bars.length;
  const empty: AutoLinesResult = { trend: [], levels: [], log: !!opts.log, tolPct: 0, n, rejected: barsIn.length - n };
  if (n < 2 * cfg.kAnchor + 8) return empty;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
  const log = !!opts.log || (opts.tf === 'M' && hi / lo > 1.6);
  const f = log ? Math.log : (x: number) => x;

  // ── tolerance per bar (price units, then in the line's space) ──────────────
  const a14 = atr(bars as Bar[], 14);
  let firstAtr: number | null = null;
  for (const v of a14) if (v != null) { firstAtr = v; break; }
  const tolP = new Float64Array(n), tolY = new Float64Array(n), cY = new Float64Array(n), hY = new Float64Array(n), lY = new Float64Array(n);
  let sumTr = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    sumTr += b.h - b.l;
    const at = a14[i] ?? firstAtr ?? sumTr / (i + 1);
    tolP[i] = Math.max(cfg.atrK * at, cfg.pct * b.c);
    tolY[i] = log ? Math.log(1 + tolP[i] / b.c) : tolP[i];
    cY[i] = f(b.c); hY[i] = f(b.h); lY[i] = f(b.l);
  }
  const tolPct = median(Array.from(tolP, (t, i) => t / bars[i].c));
  const L = n - 1, lastC = bars[L].c;

  // ── trendlines ──────────────────────────────────────────────────────────────
  const trend: TrendLine[] = [];
  for (const kind of ['support', 'resistance'] as const) {
    const side = kind === 'support' ? 'low' : 'high';
    const sgn = kind === 'support' ? 1 : -1;   // +1: price must stay above
    const yOf = kind === 'support' ? lY : hY;
    const anchors = pivots(bars, cfg.kAnchor, side);
    const touchSet = pivots(bars, cfg.kTouch, side);
    const cands: TrendLine[] = [];
    // capAt[x] for one first anchor i: the steepest (support) / flattest (resistance) slope no close in (i, x) closes beyond —
    // a pair (i, j) is valid between its anchors exactly when sgn·slope ≤ capAt[j] (one sweep per anchor, not one per pair)
    const capAt = new Float64Array(n), qAt = new Float64Array(n);
    const awayY = kind === 'support' ? hY : lY;
    for (let ai = 0; ai < anchors.length; ai++) {
      const i = anchors[ai];
      const yi = yOf[i];
      let cap = Infinity;
      for (let x = i + 1; x < n; x++) {
        capAt[x] = cap;
        const q = sgn * (cY[x] + sgn * tolY[x] - yi) / (x - i);
        qAt[x] = q;
        if (q < cap) cap = q;
      }
      for (let aj = ai + 1; aj < anchors.length; aj++) {
        const j = anchors[aj];
        if (j - i < cfg.gap) continue;
        const slope = (yOf[j] - yi) / (j - i);
        const ss = sgn * slope;
        if (ss > capAt[j] + 1e-12) continue;
        const y0 = yi;
        // the line must end near price (a recent break included): anything else is never shown, so it is not checked
        const atL = y0 + slope * (L - i);
        if (Math.abs(atL - cY[L]) > (log ? Math.log(1 + 1.5 * cfg.maxDist) : 1.5 * cfg.maxDist * lastC)) continue;
        // the first close beyond the line after the second anchor = the break
        let brk: number | null = null;
        for (let x = j; x < n; x++) if (qAt[x] < ss - 1e-12) { brk = x; break; }
        const end = brk ?? n;
        // touches: swings within the tolerance, a real move away (2 tolerances) between two touches, a few bars apart
        const touches: { i: number; dev: number }[] = [];
        let scan = i + 1, away = -Infinity;   // furthest move away from the line since the previous touch, scanned once
        for (let t = touchStart(touchSet, i); t < touchSet.length; t++) {
          const x = touchSet[t];
          if (x >= end) break;
          const line = y0 + slope * (x - i);
          const wick = sgn * (yOf[x] - line);
          if (Math.abs(wick) > tolY[x]) continue;
          const dev = Math.abs(wick) / tolY[x];
          const prev = touches[touches.length - 1];
          if (prev && x - prev.i < cfg.gap) { if (dev < prev.dev) { prev.i = x; prev.dev = dev; } continue; }
          if (prev) {
            for (; scan < x; scan++) { const a = sgn * (awayY[scan] - (y0 + slope * (scan - i))); if (a > away) away = a; }
            if (away < 2 * tolY[x]) continue;
          }
          touches.push({ i: x, dev });
          scan = x + 1; away = -Infinity;
        }
        if (touches.length < MIN_TOUCHES) continue;
        if (touches[0].i !== i) continue;   // the pair (first touch, a later anchor) builds this line once
        const first = touches[0].i, last = touches[touches.length - 1].i;
        if (last - first < cfg.minSpan) continue;
        // evidence spread along the line: no single gap between touches longer than 90 % of the span
        let maxGap = 0;
        for (let k = 1; k < touches.length; k++) maxGap = Math.max(maxGap, touches[k].i - touches[k - 1].i);
        if (maxGap > 0.9 * (last - first)) continue;
        // on a normal (linear) scale a straight line across a move of more than 2.5× means little — that is a log-scale line
        if (!log) { const p1 = y0, p2 = y0 + slope * (last - i); if (p1 <= 0 || p2 <= 0 || Math.max(p1, p2) / Math.min(p1, p2) > 2.5) continue; }
        let pierces = 0;
        for (let x = first + 1; x < last; x++) if (sgn * (yOf[x] - (y0 + slope * (x - i))) < -tolY[x]) pierces++;
        if (pierces > cfg.pierces) continue;
        // near-flat lines are levels, not trendlines
        if (Math.abs(slope * (last - first)) < 3 * median(touches.map((t) => tolY[t.i]))) continue;
        if (brk != null && L - brk > Math.max(cfg.brokenKeep, Math.round(0.08 * n))) continue;
        // an intact line projected far past its evidence (more than 1.5× its own span since the last touch) is a guess
        if (brk == null && L - last > 1.5 * (last - first) + 2 * cfg.gap) continue;
        const lineLast = y0 + slope * (L - i);
        const linePriceLast = log ? Math.exp(lineLast) : lineLast;
        const distPct = pct(lastC, linePriceLast);
        if (!(linePriceLast > 0) || Math.abs(distPct) / 100 > cfg.maxDist) continue;
        const meanDev = touches.reduce((s, t) => s + t.dev, 0) / touches.length;
        const span = last - first;
        const age = L - last;
        const score =
          40 * clamp01((touches.length - 2) / 4) +
          15 * clamp01(span / (0.5 * n)) +
          12 * (1 - clamp01(meanDev)) +
          15 * (1 - clamp01(age / (0.5 * n))) +
          18 * (1 - clamp01((Math.abs(distPct) / 100) / cfg.maxDist)) -
          4 * pierces;
        const stepPct = log ? (Math.exp(slope) - 1) * 100 : (slope / (linePriceLast || 1)) * 100;
        cands.push({
          kind, dir: slope >= 0 ? 'rising' : 'falling',
          touches: touches.map((t) => ({ i: t.i, price: kind === 'support' ? bars[t.i].l : bars[t.i].h })),
          firstTouch: first, lastTouch: last, state: brk == null ? 'intact' : 'broken', breakIndex: brk,
          log, i0: i, y0, slope,
          slopePctPerBar: stepPct, slopePctPerWeek: stepPct * cfg.barsPerWeek,
          distPct, pierces,
          strength: Math.round(Math.max(0, Math.min(100, brk == null ? score : score * 0.6))),
        });
      }
    }
    cands.sort((a, b) => b.strength - a.strength || b.touches.length - a.touches.length || b.lastTouch - a.lastTouch);
    const keep: TrendLine[] = [];
    const limit = Math.max(0, Math.floor((opts.maxLines ?? 4) / 2));
    for (const c of cands) {
      if (keep.length >= limit) break;
      if (keep.some((k) => sameLine(k, c, tolY, cfg.gap))) continue;
      // a second line of the same kind only when it is nearly as strong (keeps the chart clean)
      if (keep.length && c.strength < 0.7 * keep[0].strength) break;
      keep.push(c);
    }
    trend.push(...keep);
  }

  // ── horizontal levels ───────────────────────────────────────────────────────
  type Pv = { i: number; p: number; hi: boolean };
  const pv: Pv[] = [
    ...pivots(bars, cfg.kLevel, 'high').map((i) => ({ i, p: bars[i].h, hi: true })),
    ...pivots(bars, cfg.kLevel, 'low').map((i) => ({ i, p: bars[i].l, hi: false })),
  ].sort((a, b) => a.p - b.p);
  const w = Math.log(1 + Math.max(tolPct, cfg.pct));   // half-width of a level in log units
  const used = new Uint8Array(pv.length);
  const lp = pv.map((x) => Math.log(x.p));
  /** distinct swings (closer than the gap count once, the one nearest the centre kept), in time order */
  const distinct = (idx: number[], centre: number) => {
    const s = idx.slice().sort((a, b) => pv[a].i - pv[b].i);
    const out: number[] = [];
    for (const k of s) {
      const prev = out[out.length - 1];
      if (prev != null && pv[k].i - pv[prev].i < cfg.gap) { if (Math.abs(lp[k] - centre) < Math.abs(lp[prev] - centre)) out[out.length - 1] = k; continue; }
      out.push(k);
    }
    return out;
  };
  const rawLevels: Level[] = [];
  // each swing's price window (±w), worked out once
  const winLo = new Int32Array(pv.length), winHi = new Int32Array(pv.length);
  for (let c = 0, lo2 = 0, hi2 = 0; c < pv.length; c++) {
    while (lp[c] - lp[lo2] > w) lo2++;
    if (hi2 < c) hi2 = c;
    while (hi2 + 1 < pv.length && lp[hi2 + 1] - lp[c] <= w) hi2++;
    winLo[c] = lo2; winHi[c] = hi2;
  }
  // each window's cluster score, recomputed only where swings were just taken by a level
  const sc = new Float64Array(pv.length).fill(NaN);
  const scoreOf = (c: number): number => {
    if (used[c] || winHi[c] - winLo[c] + 1 < MIN_TOUCHES) return -1;
    const mem: number[] = [];
    for (let k = winLo[c]; k <= winHi[c]; k++) if (!used[k]) mem.push(k);
    if (mem.length < MIN_TOUCHES) return -1;
    const d = distinct(mem, lp[c]);
    if (d.length < MIN_TOUCHES) return -1;
    let lastI = 0;
    for (const k of d) if (pv[k].i > lastI) lastI = pv[k].i;
    return d.length * 1000 + lastI / n;
  };
  for (let guard = 0; guard < 30; guard++) {
    let pickC = -1, pickScore = -1;
    for (let c = 0; c < pv.length; c++) {
      if (Number.isNaN(sc[c])) sc[c] = scoreOf(c);
      if (sc[c] > pickScore) { pickScore = sc[c]; pickC = c; }
    }
    if (pickC < 0) break;
    const pick: number[] = [];
    for (let k = winLo[pickC]; k <= winHi[pickC]; k++) if (!used[k]) pick.push(k);
    const pickCentre = lp[pickC];
    for (let c = 0; c < pv.length; c++) if (winLo[c] <= winHi[pickC] && winHi[c] >= winLo[pickC]) sc[c] = NaN;
    const lvl = Math.exp(median(distinct(pick, pickCentre).map((k) => lp[k])));
    const llv = Math.log(lvl);
    const mem = pick.filter((k) => Math.abs(lp[k] - llv) <= w);
    for (const k of pick) used[k] = 1;
    const d = distinct(mem.length ? mem : pick, llv);
    if (d.length < MIN_TOUCHES) continue;
    const touches = d.map((k) => ({ i: pv[k].i, price: pv[k].p }));
    let flips = 0;
    for (let k = 1; k < d.length; k++) if (pv[d[k]].hi !== pv[d[k - 1]].hi) flips++;
    const first = touches[0].i, last = touches[touches.length - 1].i;
    let crosses = 0;
    for (let x = first + 1; x <= last; x++) if ((bars[x].c - lvl) * (bars[x - 1].c - lvl) < 0) crosses++;
    const distPct = pct(lastC, lvl);
    if (Math.abs(distPct) / 100 > cfg.maxDist) continue;
    const meanDev = d.reduce((s, k) => s + Math.abs(lp[k] - llv), 0) / d.length / w;
    const age = L - last;
    const score =
      42 * clamp01((touches.length - 2) / 5) +
      12 * clamp01(flips / 2) +
      18 * (1 - clamp01(age / (0.5 * n))) +
      10 * (1 - clamp01(meanDev)) +
      18 * (1 - clamp01((Math.abs(distPct) / 100) / cfg.maxDist)) -
      Math.max(0, crosses - 2 * touches.length) * 1.5;
    rawLevels.push({ kind: lvl <= lastC ? 'support' : 'resistance', price: lvl, touches, firstTouch: first, lastTouch: last, flips, distPct, strength: Math.round(Math.max(0, Math.min(100, score))) });
  }
  const perSide = opts.maxLevelsPerSide ?? 3;
  const levels: Level[] = [];
  for (const kind of ['resistance', 'support'] as const) {
    const side = rawLevels.filter((l) => l.kind === kind).sort((a, b) => b.strength - a.strength);
    const keep: Level[] = [];
    for (const l of side) {
      if (keep.length >= perSide) break;
      if (keep.some((k) => Math.abs(Math.log(k.price / l.price)) < 2.5 * w)) continue;
      keep.push(l);
    }
    keep.sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct));
    levels.push(...keep);
  }
  return { trend, levels, log, tolPct, n, rejected: barsIn.length - n };
}

/** Two lines are one when they share two touches, run close together over their joint span (a fan of near-identical lines),
 *  or meet at the last bar (two lines on top of each other where price is now). */
function sameLine(a: TrendLine, b: TrendLine, tolY: Float64Array, gap: number): boolean {
  if (a.kind !== b.kind) return false;
  let shared = 0;
  for (const t of a.touches) if (b.touches.some((u) => Math.abs(u.i - t.i) < gap)) shared++;
  if (shared >= 2) return true;
  const L = tolY.length - 1;
  const from = Math.min(a.firstTouch, b.firstTouch);
  const ya = (x: number) => a.y0 + a.slope * (x - a.i0), yb = (x: number) => b.y0 + b.slope * (x - b.i0);
  const dL = Math.abs(ya(L) - yb(L)) / tolY[L];
  if (dL < 2) return true;
  return Math.abs(ya(from) - yb(from)) / tolY[from] < 3.5 && dL < 3.5;
}

// ── words ─────────────────────────────────────────────────────────────────────
export function trendLineName(l: Pick<TrendLine, 'kind' | 'dir'>): string {
  return `${l.dir === 'rising' ? 'Rising' : 'Falling'} ${l.kind === 'support' ? 'support' : 'resistance'} line`;
}
export function levelName(l: Pick<Level, 'kind'>): string { return l.kind === 'support' ? 'Support level' : 'Resistance level'; }
export function distWords(d: number): string {
  if (Math.abs(d) < 0.05) return 'at price';
  return `price ${Math.abs(d).toFixed(1)}% ${d > 0 ? 'above' : 'below'}`;
}
