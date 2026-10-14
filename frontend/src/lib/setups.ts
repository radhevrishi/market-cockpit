// zzz1020 — TRADER SETUPS: well-known traders' published setups, worked out from OHLCV bars. Pure (no window, no fetch, no I/O).
// Our own version of the published rules — not the traders' own code; readings can differ from other tools.
//
// Two entry points, both reading the bars you pass in (oldest first; pass COMPLETED bars only — an unfinished session or week
// changes the readings):
//   • setupSeries(bars, opts)  — timeframe-agnostic (daily, weekly or monthly bars): every setup event on every bar, the Darvas
//                                boxes, the TTM squeeze dots + momentum histogram and the 20-bar Donchian channel. For charts.
//   • setupFigures(daily, opts) — the last bar's figures from DAILY bars (some read the weekly bars built from them). For the
//                                screener: one number per setup, null when the history is too short or nothing fired.
// SETUP_META names every code in plain words (label, method, exact rule). Indicators are computed once per call:
// EMA 10 / 20, SMA 20 / 50, ATR 14 / 20 / 40 (Wilder), Bollinger (20, 2), Keltner (EMA 20 ± 1.5 × ATR 20), ADX 14, the
// 50-bar average volume of the bars BEFORE each bar.
//
// Conventions: "sessions since" = 0 on the last bar; a window of N means 0 … N−1. Prices are rounded (2 dp from 1 up, 4
// significant digits below 1). Events: `i` = bar index in the array passed in, `dir` 1 = upward / bullish, −1 = downward.
import { aggregateBars, type Bar } from './chart-math';

/** One bar: `t` = time in ms (UTC; a daily bar's date at 00:00 UTC), open / high / low / close / volume. Same shape as chart-math's Bar. */
export type SetupBar = Bar;
export type SetupCode = 'WT3' | 'DVX' | 'DC20' | 'DC55' | 'SQZ' | 'SQZF' | 'EP' | 'GV' | 'MB' | 'WP' | 'ECB' | 'NH' | 'ATH' | 'NR7' | 'IB' | 'HG' | 'SPR';
export interface SetupOpts {
  market?: 'US' | 'IN';
  /** bars in a year for the "52-week high" rules (new high, Darvas box start): 252 daily (default), 52 weekly, 12 monthly */
  yearBars?: number;
}
/** A setup firing on bar `i`. `level` = the price the setup is about (pivot, box edge, gap-day low, support …); `note` = short words. */
export interface SetupEvent { i: number; code: SetupCode; dir: 1 | -1; level?: number; note?: string }
/** A Darvas box from its top bar (`from`) to its last bar (`to`: the break bar, or the last bar while price is still inside). */
export interface DarvasBox { from: number; to: number; top: number; bottom: number; state: 'inside' | 'up' | 'down' }
export interface SetupSeriesResult {
  events: SetupEvent[];
  darvas: DarvasBox[];
  /** TTM squeeze: `on` = Bollinger (20, 2) inside Keltner (EMA 20 ± 1.5 × ATR 20); `mom` = the momentum histogram (null early). */
  squeeze: { on: boolean[]; mom: (number | null)[] };
  /** 20-bar Donchian channel of the bars BEFORE each bar (the level a close must clear); null for the first 20 bars. */
  donchian20: { hi: (number | null)[]; lo: (number | null)[] };
}
/** The last bar's figures (setupFigures). null = too little history, or the setup did not fire within its window. */
export interface SetupFigures {
  /** 3 weeks tight: weekly closes in the tight run ending this week (≥ 3, only with price above SMA 50) */ wt3: number | null;
  /** the tight run's pivot: highest weekly high of those weeks */ wt3P: number | null;
  /** up/down volume ratio, 50 sessions */ udv: number | null;
  /** (close − EMA 10) ÷ ATR 14 */ x10A: number | null;
  /** (close − SMA 50) ÷ ATR 14 */ x50A: number | null;
  /** Darvas: 1 inside a confirmed box, 2 top broken (close) in the last 5 sessions, 3 bottom broken in the last 5 sessions */ dvx: number | null;
  dvT: number | null; dvB: number | null;
  /** sessions since a close above the prior 20 / 55-session high (window 10) */ dc20D: number | null; dc55D: number | null;
  /** weeks since a weekly close above the prior 20-week high (window 10) */ dc20W: number | null;
  /** bars in the current squeeze (0 = no squeeze) */ sqzN: number | null;
  /** sessions since a squeeze of ≥ 5 bars fired (window 10) */ sqzF: number | null;
  /** squeeze momentum sign −1 / 0 / 1 */ sqzM: number | null;
  /** 7 = narrowest range of 7 bars, 4 = of 4, 0 = neither */ nr7: number | null;
  /** 1 = inside bar */ ib: number | null;
  /** episodic pivot: sessions since (window 10), gap % and gap day (days since 1970) */ epD: number | null; epG: number | null; epT: number | null;
  /** gap-up with volume (window 10) */ gvD: number | null;
  /** momentum burst (window 5) */ mbD: number | null;
  /** anticipation: 1 = quiet last bar (NR7 or range < half the 20-bar average range), else null */ antD: number | null;
  /** wedge pop (window 5) */ wpD: number | null;
  /** EMA crossback (window 5) */ ecbD: number | null;
  /** new 52-week (252-bar) high close / all-time high close in the data (window 10) */ nhD: number | null; athD: number | null;
  /** Holy Grail (window 5) */ hgD: number | null;
  /** Wyckoff spring (window 10) */ sprD: number | null;
  /** TD setup count, + up count / − down count, −9 … +9 */ td9: number | null;
}
export const SETUP_FIGURE_KEYS: ReadonlyArray<keyof SetupFigures> = [
  'wt3', 'wt3P', 'udv', 'x10A', 'x50A', 'dvx', 'dvT', 'dvB', 'dc20D', 'dc55D', 'dc20W', 'sqzN', 'sqzF', 'sqzM', 'nr7', 'ib',
  'epD', 'epG', 'epT', 'gvD', 'mbD', 'antD', 'wpD', 'ecbD', 'nhD', 'athD', 'hgD', 'sprD', 'td9',
];

/** Plain-words description of every setup: `label` (short name), `method` (whose published rules), `rule` (exactly what we test). */
export const SETUP_META: Record<SetupCode, { label: string; method: string; rule: string }> = {
  WT3: { label: '3 weeks tight', method: "William O'Neil (IBD)", rule: 'Three or more weekly closes in a row, each within 1.5% of the week before, with price above its 50-day average. The pivot is the highest weekly high of those weeks.' },
  DVX: { label: 'Darvas box', method: 'Nicolas Darvas', rule: 'A box starts at a 52-week high. The top is confirmed when the next 3 bars stay below it; the bottom is the lowest low after the top, confirmed by 3 bars that do not go under it. A close above the top is a breakout, a close under the bottom a breakdown.' },
  DC20: { label: 'Donchian 20-bar breakout', method: 'Turtle traders (Dennis / Eckhardt)', rule: 'A close above the highest high of the 20 bars before it (downward: below the lowest low of those 20 bars).' },
  DC55: { label: 'Donchian 55-bar breakout', method: 'Turtle traders (Dennis / Eckhardt)', rule: 'A close above the highest high of the 55 bars before it (downward: below the lowest low of those 55 bars).' },
  SQZ: { label: 'Squeeze on', method: 'John Carter (TTM Squeeze)', rule: 'Bollinger Bands (20, 2) inside the Keltner Channel (EMA 20 ± 1.5 × ATR 20) for 5 bars in a row — volatility is very low.' },
  SQZF: { label: 'Squeeze fired', method: 'John Carter (TTM Squeeze)', rule: 'The Bollinger Bands move back outside the Keltner Channel after a squeeze of at least 5 bars. Direction = the sign of the squeeze momentum (20-bar linear regression of close minus the midline).' },
  EP: { label: 'Episodic pivot', method: 'Kristjan Kullamägi / Pradeep Bonde', rule: 'A gap up at the open of 10% or more (India 8%) and at most 60%, on volume at least 3 times the 50-bar average before it, after a quiet stretch (no more than +30% over the 60 bars before). The level is the gap-day low; it counts while the close stays at or above it.' },
  GV: { label: 'Gap-up with volume', method: 'Oliver Kell', rule: 'The open is at least 0.75 × ATR 40 above the previous close, on volume at least 1.5 times the 50-bar average. It counts while the close stays at or above the gap-day low.' },
  MB: { label: 'Momentum burst', method: 'Pradeep Bonde (Stockbee)', rule: 'A close at least 4% above the previous close on higher volume than the bar before, when the previous bar was not a burst itself.' },
  WP: { label: 'Wedge pop', method: 'Oliver Kell', rule: 'A close above both EMA 10 and EMA 20 after at least 5 closes below both, on volume at or above the 50-bar average.' },
  ECB: { label: 'EMA crossback', method: 'Oliver Kell', rule: 'In an uptrend (EMA 10 above a rising EMA 20) the low dips to within 0.5% of EMA 20 (or below it) and the bar closes back above EMA 10.' },
  NH: { label: 'New 52-week high', method: "William O'Neil / Mark Minervini", rule: 'A close above the highest high of the year before it (252 daily, 52 weekly or 12 monthly bars).' },
  ATH: { label: 'All-time high', method: "William O'Neil / Mark Minervini", rule: 'A close above every earlier high in the price history we have (at least 20 bars of it).' },
  NR7: { label: 'Narrow range 7', method: 'Toby Crabel', rule: 'The bar’s high-to-low range is the narrowest of the last 7 bars (NR4: of the last 4) — a quiet bar that often comes before a bigger move.' },
  IB: { label: 'Inside bar', method: 'Toby Crabel', rule: 'The bar’s high and low stay inside the previous bar’s high and low.' },
  HG: { label: 'Holy Grail', method: 'Linda Raschke', rule: 'In a strong uptrend (on the bar before the touch: ADX 14 at least 30 and rising, +DI above −DI) a bar’s low touches EMA 20; the signal is the next bar trading above that bar’s high (the level).' },
  SPR: { label: 'Spring', method: 'Richard Wyckoff', rule: 'The low dips below a support that has held for at least 20 bars (the lowest low of the last 60 bars) by no more than 5%, and within 3 bars a close is back above the support, on volume at or above the 50-bar average.' },
};

// ── numeric helpers (NaN = not available) ─────────────────────────────────────────────────────────────────────────────
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const rnd = (v: number, dp: number) => { const k = 10 ** dp; return Math.round(v * k) / k; };
/** a price: 2 dp from 1 up, 4 significant digits below 1 */
const pxr = (v: number) => (Math.abs(v) >= 1 ? rnd(v, 2) : Number(v.toPrecision(4)));
const nanArr = (n: number) => new Array<number>(n).fill(NaN);

function smaS(x: readonly number[], n: number): number[] {
  const out = nanArr(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= n) s -= x[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
/** EMA seeded with the simple average of the first n values (TradingView's ta.ema). */
function emaS(x: readonly number[], n: number): number[] {
  const out = nanArr(x.length);
  if (x.length < n) return out;
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i];
  e /= n; out[n - 1] = e;
  const k = 2 / (n + 1);
  for (let i = n; i < x.length; i++) { e = x[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
/** Wilder's moving average (TradingView's ta.rma): seeded with the simple average of the first n available values. */
function rmaS(x: readonly number[], n: number): number[] {
  const out = nanArr(x.length);
  let f = 0;
  while (f < x.length && !fin(x[f])) f++;
  if (x.length - f < n) return out;
  let e = 0;
  for (let i = f; i < f + n; i++) e += x[i];
  e /= n; out[f + n - 1] = e;
  for (let i = f + n; i < x.length; i++) { e = (e * (n - 1) + (fin(x[i]) ? x[i] : 0)) / n; out[i] = e; }
  return out;
}
/** Population standard deviation over n values (TradingView's ta.stdev). */
function stdevS(x: readonly number[], n: number): number[] {
  const out = nanArr(x.length);
  for (let i = n - 1; i < x.length; i++) {
    let s = 0, s2 = 0;
    for (let j = i - n + 1; j <= i; j++) { s += x[j]; s2 += x[j] * x[j]; }
    const m = s / n;
    out[i] = Math.sqrt(Math.max(0, s2 / n - m * m));
  }
  return out;
}
/** Highest high / lowest low of the `n` bars BEFORE bar i (not including it); NaN while fewer than n bars exist. O(length). */
function priorExtreme(x: readonly number[], n: number, hi: boolean): number[] {
  const out = nanArr(x.length);
  const q: number[] = [];   // indexes, values monotonic (decreasing for highs)
  let head = 0;
  for (let i = 0; i < x.length; i++) {
    while (head < q.length && q[head] < i - n) head++;
    if (i >= n) out[i] = x[q[head]];
    while (q.length > head && (hi ? x[q[q.length - 1]] <= x[i] : x[q[q.length - 1]] >= x[i])) q.pop();
    q.push(i);
  }
  return out;
}
/** Linear regression of the last n values, evaluated at the last bar (TradingView's ta.linreg(x, n, 0)). */
function linregS(x: readonly number[], n: number): number[] {
  const out = nanArr(x.length);
  const sx = (n * (n - 1)) / 2, sxx = ((n - 1) * n * (2 * n - 1)) / 6, den = n * sxx - sx * sx;
  for (let i = n - 1; i < x.length; i++) {
    let sy = 0, sxy = 0, ok = true;
    for (let k = 0; k < n; k++) { const y = x[i - n + 1 + k]; if (!fin(y)) { ok = false; break; } sy += y; sxy += k * y; }
    if (!ok) continue;
    const slope = (n * sxy - sx * sy) / den, icpt = (sy - slope * sx) / n;
    out[i] = icpt + slope * (n - 1);
  }
  return out;
}
/** Wilder ATR (TradingView's ta.atr): true range, first bar = high − low. */
function atrS(h: readonly number[], l: readonly number[], c: readonly number[], n: number): number[] {
  const tr = h.map((hi, i) => (i === 0 ? hi - l[i] : Math.max(hi - l[i], Math.abs(hi - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  return rmaS(tr, n);
}
/** ADX / +DI / −DI (TradingView's ta.dmi(n, n)). */
function dmiS(h: readonly number[], l: readonly number[], c: readonly number[], n: number): { adx: number[]; pdi: number[]; mdi: number[] } {
  const len = h.length;
  const pdm = nanArr(len), mdm = nanArr(len), tr = nanArr(len);
  for (let i = 1; i < len; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  }
  const trR = rmaS(tr, n), pR = rmaS(pdm, n), mR = rmaS(mdm, n);
  const pdi = nanArr(len), mdi = nanArr(len), dx = nanArr(len);
  for (let i = 0; i < len; i++) {
    if (!fin(trR[i]) || !(trR[i] > 0)) continue;
    pdi[i] = (100 * pR[i]) / trR[i]; mdi[i] = (100 * mR[i]) / trR[i];
    const s = pdi[i] + mdi[i];
    dx[i] = s > 0 ? (100 * Math.abs(pdi[i] - mdi[i])) / s : 0;
  }
  return { adx: rmaS(dx, n), pdi, mdi };
}

// ── the core: every indicator once, every setup on every bar ──────────────────────────────────────────────────────────
interface Core {
  n: number;
  c: number[]; h: number[]; l: number[]; o: number[]; v: number[];
  sma50: number[]; ema10: number[]; ema20: number[]; atr14: number[]; av50: number[];
  tight: number[];            // closes in the tight run (each within 1.5% of the one before) ending at i
  hi20: number[]; lo20: number[]; hi55: number[]; lo55: number[]; hi252: number[];
  sqOn: boolean[]; sqRun: number[]; sqKnown: boolean[]; mom: number[];
  ep: number[];               // gap % (as a fraction) on an episodic-pivot gap day, else NaN
  gv: boolean[]; mb: boolean[]; wp: boolean[]; ecb: boolean[]; nh: boolean[]; ath: boolean[]; hg: number[]; spr: number[];
  nr: number[];               // 7 / 4 / 0 (NaN: too early)
  events: SetupEvent[]; darvas: DarvasBox[];
}
const TIGHT = 0.015;

function core(bars: readonly SetupBar[], opts?: SetupOpts): Core {
  const Y = Math.max(10, Math.round(opts?.yearBars ?? 252));
  const n = bars.length;
  const o = bars.map((b) => b.o), h = bars.map((b) => b.h), l = bars.map((b) => b.l), c = bars.map((b) => b.c), v = bars.map((b) => (fin(b.v) ? b.v : 0));
  const sma20 = smaS(c, 20), sma50 = smaS(c, 50), ema10 = emaS(c, 10), ema20 = emaS(c, 20);
  const atr14 = atrS(h, l, c, 14), atr20 = atrS(h, l, c, 20), atr40 = atrS(h, l, c, 40);
  const av50 = nanArr(n);
  { let s = 0; for (let i = 0; i < n; i++) { if (i >= 50) { av50[i] = s / 50; s -= v[i - 50]; } s += v[i]; } }
  const hi20 = priorExtreme(h, 20, true), lo20 = priorExtreme(l, 20, false), hi55 = priorExtreme(h, 55, true), lo55 = priorExtreme(l, 55, false), hi252 = priorExtreme(h, Y, true);
  const { adx, pdi, mdi } = dmiS(h, l, c, 14);
  // squeeze: BB(20, 2) inside KC(EMA 20 ± 1.5 × ATR 20); momentum = linreg(close − avg(avg(highest 20, lowest 20), SMA 20), 20)
  const sd20 = stdevS(c, 20);
  const sqOn = new Array<boolean>(n).fill(false), sqKnown = new Array<boolean>(n).fill(false), sqRun = new Array<number>(n).fill(0);
  const dev = nanArr(n), hi19 = priorExtreme(h, 19, true), lo19 = priorExtreme(l, 19, false);
  for (let i = 0; i < n; i++) {
    if (fin(sma20[i]) && fin(sd20[i]) && fin(ema20[i]) && fin(atr20[i])) {
      sqKnown[i] = true;
      const bbU = sma20[i] + 2 * sd20[i], bbL = sma20[i] - 2 * sd20[i], kcU = ema20[i] + 1.5 * atr20[i], kcL = ema20[i] - 1.5 * atr20[i];
      sqOn[i] = bbU < kcU && bbL > kcL;
      sqRun[i] = sqOn[i] ? (i > 0 ? sqRun[i - 1] : 0) + 1 : 0;
    }
    if (i >= 19 && fin(sma20[i])) {
      const hh = Math.max(h[i], fin(hi19[i]) ? hi19[i] : -Infinity), ll = Math.min(l[i], fin(lo19[i]) ? lo19[i] : Infinity);
      dev[i] = c[i] - ((hh + ll) / 2 + sma20[i]) / 2;
    }
  }
  const mom = linregS(dev, 20);
  const epMin = opts?.market === 'IN' ? 0.08 : 0.10;
  const tight = new Array<number>(n).fill(1);
  const ep = nanArr(n), nr = nanArr(n), hg = nanArr(n), spr = nanArr(n);
  const gv = new Array<boolean>(n).fill(false), mb = new Array<boolean>(n).fill(false), wp = new Array<boolean>(n).fill(false),
    ecb = new Array<boolean>(n).fill(false), nh = new Array<boolean>(n).fill(false), ath = new Array<boolean>(n).fill(false);
  const events: SetupEvent[] = [];
  const push = (e: SetupEvent) => events.push(e.level != null ? { ...e, level: pxr(e.level) } : e);
  const burst = (i: number) => i >= 1 && c[i - 1] > 0 && c[i] / c[i - 1] >= 1.04 && v[i] > v[i - 1];
  let runMax = -Infinity, springDone = -1;
  for (let i = 0; i < n; i++) {
    // 3 weeks tight (on the bars given)
    if (i > 0 && c[i - 1] > 0 && Math.abs(c[i] / c[i - 1] - 1) <= TIGHT) tight[i] = tight[i - 1] + 1;
    if (tight[i] === 3 && fin(sma50[i]) && c[i] > sma50[i]) {
      let pv = -Infinity; for (let j = i - 2; j <= i; j++) pv = Math.max(pv, h[j]);
      push({ i, code: 'WT3', dir: 1, level: pv, note: '3 tight closes' });
    }
    // Donchian
    for (const [code, hi, lo] of [['DC20', hi20, lo20], ['DC55', hi55, lo55]] as const) {
      if (fin(hi[i]) && c[i] > hi[i] && !(i > 0 && fin(hi[i - 1]) && c[i - 1] > hi[i - 1])) push({ i, code, dir: 1, level: hi[i] });
      if (fin(lo[i]) && c[i] < lo[i] && !(i > 0 && fin(lo[i - 1]) && c[i - 1] < lo[i - 1])) push({ i, code, dir: -1, level: lo[i] });
    }
    // squeeze
    if (sqRun[i] === 5) push({ i, code: 'SQZ', dir: fin(mom[i]) && mom[i] < 0 ? -1 : 1, note: 'squeeze on' });
    if (i > 0 && sqKnown[i] && !sqOn[i] && sqOn[i - 1] && sqRun[i - 1] >= 5) push({ i, code: 'SQZF', dir: fin(mom[i]) && mom[i] < 0 ? -1 : 1, note: `after ${sqRun[i - 1]} bars` });
    if (i < 1) { runMax = Math.max(runMax, h[i]); continue; }
    const pc = c[i - 1];
    // episodic pivot
    if (pc > 0 && fin(av50[i]) && i >= 61 && c[i - 61] > 0) {
      const g = o[i] / pc - 1;
      if (g >= epMin && g <= 0.6 && v[i] >= 3 * av50[i] && pc / c[i - 61] - 1 <= 0.3) { ep[i] = g; push({ i, code: 'EP', dir: 1, level: l[i], note: `gap +${rnd(g * 100, 1)}%` }); }
    }
    // gap-up with volume
    if (fin(atr40[i - 1]) && fin(av50[i]) && o[i] - pc >= 0.75 * atr40[i - 1] && v[i] >= 1.5 * av50[i]) { gv[i] = true; push({ i, code: 'GV', dir: 1, level: l[i], note: `gap +${rnd((o[i] / pc - 1) * 100, 1)}%` }); }
    // momentum burst
    if (burst(i) && !burst(i - 1)) { mb[i] = true; push({ i, code: 'MB', dir: 1, note: `+${rnd((c[i] / pc - 1) * 100, 1)}%` }); }
    // wedge pop
    if (i >= 5 && fin(ema10[i - 5]) && fin(ema20[i - 5]) && fin(av50[i]) && c[i] > ema10[i] && c[i] > ema20[i] && v[i] >= av50[i]) {
      let below = true;
      for (let k = 1; k <= 5; k++) if (!(c[i - k] < ema10[i - k] && c[i - k] < ema20[i - k])) { below = false; break; }
      if (below) { wp[i] = true; push({ i, code: 'WP', dir: 1, level: Math.max(ema10[i], ema20[i]) }); }
    }
    // EMA crossback
    if (fin(ema20[i - 1]) && ema10[i] > ema20[i] && ema20[i] > ema20[i - 1] && l[i] <= ema20[i] * 1.005 && c[i] > ema10[i]) {
      ecb[i] = true;
      if (!ecb[i - 1]) push({ i, code: 'ECB', dir: 1, level: ema20[i] });
    }
    // new 52-week high / all-time high (closing)
    if (fin(hi252[i]) && c[i] > hi252[i]) { nh[i] = true; if (!nh[i - 1]) push({ i, code: 'NH', dir: 1, level: hi252[i] }); }
    if (i >= 20 && c[i] > runMax) { ath[i] = true; if (!ath[i - 1]) push({ i, code: 'ATH', dir: 1, level: runMax }); }
    runMax = Math.max(runMax, h[i]);
    // narrow range 7 / 4, inside bar
    if (i >= 3) {
      const r = h[i] - l[i];
      let k7 = i >= 6, k4 = true;
      for (let j = 1; j <= 6 && (k7 || k4); j++) {
        if (i - j < 0) break;
        const rj = h[i - j] - l[i - j];
        if (!(r < rj)) { if (j <= 3) k4 = false; k7 = false; }
      }
      nr[i] = k7 ? 7 : k4 ? 4 : 0;
      if (nr[i] === 7) push({ i, code: 'NR7', dir: 1 });
    }
    if (h[i] <= h[i - 1] && l[i] >= l[i - 1] && !(h[i] === h[i - 1] && l[i] === l[i - 1])) push({ i, code: 'IB', dir: 1, level: h[i - 1] });
    // Holy Grail: trend read on the bar before the touch (a deep touch bar itself pulls ADX down), touch bar i − 1, signal bar i
    const t = i - 1, a = t - 1;
    if (a >= 1 && fin(adx[a]) && fin(adx[a - 1]) && fin(ema20[t]) && adx[a] >= 30 && adx[a] > adx[a - 1] && pdi[a] > mdi[a] && l[t] <= ema20[t] && h[i] > h[t]) {
      hg[i] = h[t]; push({ i, code: 'HG', dir: 1, level: h[t], note: `ADX ${rnd(adx[a], 0)}` });
    }
    // Wyckoff spring: dip bar j (i − 2 … i), confirmed at i
    if (i > springDone && fin(av50[i]) && v[i] >= av50[i]) {
      for (let j = Math.max(60, i - 2); j <= i; j++) {
        let s = Infinity, at = -1;
        for (let k = j - 60; k < j; k++) if (l[k] < s) { s = l[k]; at = k; }
        if (!(s > 0) || at > j - 20) continue;
        if (!(l[j] < s && l[j] >= 0.95 * s)) continue;
        // first close back above the support after the dip: must be this bar
        let first = -1;
        for (let k = j; k <= i; k++) if (c[k] > s) { first = k; break; }
        if (first !== i) continue;
        spr[i] = s; springDone = i + 2; push({ i, code: 'SPR', dir: 1, level: s, note: `dip to ${pxr(l[j])}` });
        break;
      }
    }
  }
  // Darvas boxes (state machine; breaks are judged on the close)
  const darvas: DarvasBox[] = [];
  type St = 'seek' | 'top' | 'bot' | 'inside';
  let st: St = 'seek', top = NaN, topI = -1, bot = NaN, botI = -1, cnt = 0;
  /** bar i's high is the highest of the 252 bars ending at i */
  const hi251 = priorExtreme(h, Y - 1, true);
  const isHigh252 = (i: number) => i >= Y - 1 && h[i] >= hi251[i];
  for (let i = 0; i < n; i++) {
    if (st === 'inside') {
      const box = darvas[darvas.length - 1];
      if (c[i] > top) { box.to = i; box.state = 'up'; push({ i, code: 'DVX', dir: 1, level: top, note: 'box top broken' }); st = 'seek'; }
      else if (c[i] < bot) { box.to = i; box.state = 'down'; push({ i, code: 'DVX', dir: -1, level: bot, note: 'box bottom broken' }); st = 'seek'; continue; }
      else { box.to = i; continue; }
    }
    if (st === 'seek') {
      if (isHigh252(i)) { st = 'top'; top = h[i]; topI = i; cnt = 0; }
      continue;
    }
    if (st === 'top') {
      if (h[i] >= top) { top = h[i]; topI = i; cnt = 0; continue; }
      cnt++;
      if (cnt === 3) {
        bot = Infinity; for (let j = topI + 1; j <= i; j++) if (l[j] < bot) { bot = l[j]; botI = j; }
        cnt = i - botI; st = 'bot';
        if (cnt >= 3) { st = 'inside'; darvas.push({ from: topI, to: i, top: pxr(top), bottom: pxr(bot), state: 'inside' }); }
      }
      continue;
    }
    if (st === 'bot') {
      if (h[i] > top) { st = 'top'; top = h[i]; topI = i; cnt = 0; continue; }   // new high before the box was confirmed: start again
      if (l[i] < bot) { bot = l[i]; botI = i; cnt = 0; continue; }
      cnt++;
      if (cnt >= 3) { st = 'inside'; darvas.push({ from: topI, to: i, top: pxr(top), bottom: pxr(bot), state: 'inside' }); }
    }
  }
  events.sort((a, b) => a.i - b.i);
  return { n, c, h, l, o, v, sma50, ema10, ema20, atr14, av50, tight, hi20, lo20, hi55, lo55, hi252, sqOn, sqRun, sqKnown, mom, ep, gv, mb, wp, ecb, nh, ath, hg, spr, nr, events, darvas };
}

/** Every setup on every bar of `bars` (daily, weekly or monthly — the rules read "bars"). Pass completed bars only. */
export function setupSeries(bars: SetupBar[], opts?: SetupOpts): SetupSeriesResult {
  const k = core(bars || [], opts);
  return {
    events: k.events,
    darvas: k.darvas.map((b) => ({ ...b })),
    squeeze: { on: k.sqOn.slice(), mom: k.mom.map((x) => (fin(x) ? x : null)) },
    donchian20: { hi: k.hi20.map((x) => (fin(x) ? pxr(x) : null)), lo: k.lo20.map((x) => (fin(x) ? pxr(x) : null)) },
  };
}

const EMPTY: SetupFigures = {
  wt3: null, wt3P: null, udv: null, x10A: null, x50A: null, dvx: null, dvT: null, dvB: null, dc20D: null, dc55D: null, dc20W: null, sqzN: null, sqzF: null,
  sqzM: null, nr7: null, ib: null, epD: null, epG: null, epT: null, gvD: null, mbD: null, antD: null, wpD: null, ecbD: null, nhD: null, athD: null, hgD: null,
  sprD: null, td9: null,
};
/** Sessions since the latest bar (within the last `win` bars) where `hit(i)` is true; null when none. */
function since(n: number, win: number, hit: (i: number) => boolean): number | null {
  for (let k = 0; k < win && n - 1 - k >= 0; k++) if (hit(n - 1 - k)) return k;
  return null;
}
const DAY = 86_400_000;

/** The last bar's setup figures from DAILY bars (oldest first, completed sessions only). See SetupFigures for each field. */
export function setupFigures(daily: SetupBar[], opts?: SetupOpts): SetupFigures {
  const bars = (daily || []).filter((b) => b && fin(b.t) && fin(b.o) && fin(b.h) && fin(b.l) && fin(b.c) && b.c > 0);
  const out: SetupFigures = { ...EMPTY };
  const n = bars.length;
  if (n < 2) return out;
  const k = core(bars, opts);
  const L = n - 1, { c, h, l, v } = k;
  // weekly bars: 3 weeks tight + the weekly Donchian
  const wk = aggregateBars(bars, 'W');
  if (wk.length >= 3 && fin(k.sma50[L]) && c[L] > k.sma50[L]) {
    let run = 1, hi = wk[wk.length - 1].h;
    for (let j = wk.length - 1; j >= 1; j--) {
      if (wk[j - 1].c > 0 && Math.abs(wk[j].c / wk[j - 1].c - 1) <= TIGHT) { run++; hi = Math.max(hi, wk[j - 1].h); } else break;
    }
    if (run >= 3) { out.wt3 = run; out.wt3P = pxr(hi); }
  }
  if (wk.length >= 21) {
    const wh = priorExtreme(wk.map((b) => b.h), 20, true);
    out.dc20W = since(wk.length, 10, (i) => fin(wh[i]) && wk[i].c > wh[i]);
  }
  // up/down volume, 50 sessions
  if (n >= 51) {
    let up = 0, dn = 0;
    for (let i = L - 49; i <= L; i++) { if (c[i] > c[i - 1]) up += v[i]; else if (c[i] < c[i - 1]) dn += v[i]; }
    out.udv = dn > 0 ? rnd(up / dn, 2) : null;
  }
  // extension in ATRs
  if (fin(k.atr14[L]) && k.atr14[L] > 0) {
    if (fin(k.ema10[L])) out.x10A = rnd((c[L] - k.ema10[L]) / k.atr14[L], 1);
    if (fin(k.sma50[L])) out.x50A = rnd((c[L] - k.sma50[L]) / k.atr14[L], 1);
  }
  // Darvas
  const box = k.darvas[k.darvas.length - 1];
  if (box) {
    const code = box.state === 'inside' && box.to === L ? 1 : box.state === 'up' && box.to >= L - 4 ? 2 : box.state === 'down' && box.to >= L - 4 ? 3 : null;
    if (code != null) { out.dvx = code; out.dvT = box.top; out.dvB = box.bottom; }
  }
  // Donchian (daily)
  if (n > 20) out.dc20D = since(n, 10, (i) => fin(k.hi20[i]) && c[i] > k.hi20[i]);
  if (n > 55) out.dc55D = since(n, 10, (i) => fin(k.hi55[i]) && c[i] > k.hi55[i]);
  // squeeze
  if (k.sqKnown[L]) {
    out.sqzN = k.sqRun[L];
    out.sqzF = since(n, 10, (i) => i > 0 && k.sqKnown[i] && !k.sqOn[i] && k.sqOn[i - 1] && k.sqRun[i - 1] >= 5);
  }
  if (fin(k.mom[L])) out.sqzM = k.mom[L] > 0 ? 1 : k.mom[L] < 0 ? -1 : 0;
  // narrow range / inside bar / anticipation
  if (fin(k.nr[L])) out.nr7 = k.nr[L];
  out.ib = h[L] <= h[L - 1] && l[L] >= l[L - 1] && !(h[L] === h[L - 1] && l[L] === l[L - 1]) ? 1 : 0;
  if (n >= 21) {
    let s = 0; for (let i = L - 20; i < L; i++) s += h[i] - l[i];
    const adr = s / 20;
    out.antD = out.nr7 === 7 || (adr > 0 && h[L] - l[L] < 0.5 * adr) ? 1 : null;
  }
  // episodic pivot (holding: close now at or above the gap-day low)
  if (n > 61) {
    const e = since(n, 10, (i) => fin(k.ep[i]) && c[L] >= l[i]);
    if (e != null) { const i = L - e; out.epD = e; out.epG = rnd(k.ep[i] * 100, 1); out.epT = Math.floor(bars[i].t / DAY); }
    out.gvD = since(n, 10, (i) => k.gv[i] && c[L] >= l[i]);
  }
  out.mbD = since(n, 5, (i) => k.mb[i]);
  if (n > 50) out.wpD = since(n, 5, (i) => k.wp[i]);
  if (n >= 21) out.ecbD = since(n, 5, (i) => k.ecb[i]);
  if (n > 252) out.nhD = since(n, 10, (i) => k.nh[i]);
  if (n > 20) out.athD = since(n, 10, (i) => k.ath[i]);
  if (n > 30) out.hgD = since(n, 5, (i) => fin(k.hg[i]));
  if (n > 61) out.sprD = since(n, 10, (i) => fin(k.spr[i]));
  // TD setup count (+ closes above the close 4 bars earlier, − below), restarting after 9
  if (n >= 5) {
    const dir = c[L] > c[L - 4] ? 1 : c[L] < c[L - 4] ? -1 : 0;
    if (dir === 0) out.td9 = 0;
    else {
      let run = 0;
      for (let i = L; i >= 4 && (dir > 0 ? c[i] > c[i - 4] : c[i] < c[i - 4]); i--) run++;
      out.td9 = dir * (((run - 1) % 9) + 1);
    }
  }
  return out;
}
