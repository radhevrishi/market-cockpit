// zzz984 — the owner's TradingView Pine Screener setups, worked out from the SAME daily bars the screener build already reads
// for its price figures (tech-fetch.ts → pine.ts techEntry). Pure: no network. Each indicator follows the script it copies:
//
//  • Trend template ("minervni script", his own, Minervini): c1 close > SMA50; c2 SMA50 > SMA150; c3 SMA150 > SMA200;
//    c4 SMA200 higher than the bar before on each of the last 20 bars; c5 close ÷ lowest low of 250 bars > 1.3;
//    c6 close ÷ highest high of 250 bars > 0.75. A rule whose inputs are missing (too little history) does not pass, as on
//    TradingView (na → false). `tt` = rules passed 0–6, `ttOk` = 1 when all six pass.
//  • RSI script (his own): Wilder RSI 14 and its 14-bar simple average; `rsiX` = sessions since RSI crossed above its average
//    (0 = today; none in the last 10 sessions → null).
//  • MA Cross (TradingView built-in): sessions since SMA50 crossed above / below SMA200 (`gcD` / `dcD`) and EMA10 crossed
//    above / below EMA21 (`emaXU` / `emaXD`), within the last 20 sessions (else null).
//  • RS Rating (Fred6724 / IBD style): 0.4 × 3-month + 0.2 × 6 + 0.2 × 9 + 0.2 × 12-month performance (63 / 126 / 189 / 252
//    sessions), ranked 1–99 against every company in the same market's snapshot (`applyRsRating`, run when the snapshot is put
//    together). Needs 253 sessions of history.
//  • Weinstein stage (TheWrap Stage Analysis): 30-week SMA of weekly closes; slope over 4 weeks (> +0.5% rising, < −0.5%
//    falling, else flat) and price above / below it → 2 = above + rising, 4 = below + falling, a flat average after a decline
//    (or price above a still-falling average) = 1, a flat average after an advance (or price below a still-rising one) = 3.
//    `st12` = 1 when stage 2 now and stage 1 in one of the previous 6 weeks.
//  • Volume pocket pivot (TAPLOT): an up day whose volume beats every down day's volume of the 10 sessions before it, closing
//    above both its 10-day and 50-day averages; `ppD` = sessions since the latest one in the last 10 (else null).
//  • zzz987 — Stage Analysis (TheWrap method — our own version from the published rules, lib/stage-analysis.ts): `twSt` stage 1–4,
//    `sata` 0–10, `mrs` Mansfield RS vs the market's index (S&P 500 / Nifty 50; null without the index) and `twWk` weeks in the
//    stage. Weekly bars resampled from these daily bars; the index's weekly closes come from tech-fetch.ts (read once per build).
//    zzz1044a — from COMPLETED exchange weeks only (stock and index; lib/completed-weeks): an unfinished week — Monday to the
//    Friday close (US 16:00 New York, India 15:30 IST) — never confirms a stage, starts a stage age or moves SATA / RS.
//  • Swing data: RVol = last session's volume ÷ the average of the 50 sessions before it (`rvol`); average daily traded value
//    over 20 sessions (`adv`, in the currency — the row shows it as $ million / ₹ crore, `adv$`).
//  • Ripster EMA clouds (5/12 and 34/50): `ripB` = 1 when close > EMA34 and EMA50 and both EMA5 and EMA12 are above both EMA34
//    and EMA50, else 0.
import type { DailyBars } from './tech';
import { periodCloses } from './tech';
import { stageFromDaily, type StageClock } from '../stage-analysis';

export interface TvFigures {
  tt: number | null; ttOk: number | null;
  rsiMA: number | null; rsiX: number | null;
  gcD: number | null; dcD: number | null; emaXU: number | null; emaXD: number | null;
  rsRaw: number | null;
  stage: number | null; st12: number | null;
  ppD: number | null;
  rvol: number | null; adv: number | null;
  ripB: number | null;
  /** zzz987 — Stage Analysis (TheWrap method) */
  twSt?: number | null; sata?: number | null; mrs?: number | null; twWk?: number | null;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Simple moving average series (NaN until n values). */
export function smaSeries(x: readonly number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
/** EMA series started from a plain mean of the first n values (as tech.ts emaOf / TradingView's ta.ema). */
export function emaSeries(x: readonly number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  if (x.length < n) return out;
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i];
  e /= n; out[n - 1] = e;
  const k = 2 / (n + 1);
  for (let i = n; i < x.length; i++) { e = x[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
/** Wilder RSI series (NaN for the first n bars). */
export function rsiSeries(c: readonly number[], n = 14): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length < n + 1) return out;
  let up = 0, dn = 0;
  for (let i = 1; i <= n; i++) { const ch = c[i] - c[i - 1]; if (ch > 0) up += ch; else dn -= ch; }
  up /= n; dn /= n;
  const val = () => (dn === 0 ? (up === 0 ? 50 : 100) : 100 - 100 / (1 + up / dn));
  out[n] = val();
  for (let i = n + 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1];
    up = (up * (n - 1) + (ch > 0 ? ch : 0)) / n;
    dn = (dn * (n - 1) + (ch < 0 ? -ch : 0)) / n;
    out[i] = val();
  }
  return out;
}
/** Sessions since `a` crossed above (dir 1) / below (dir −1) `b`, looking back `within` sessions (0 = the last bar); null if none. */
export function barsSinceCross(a: readonly number[], b: readonly number[], dir: 1 | -1, within: number): number | null {
  const n = a.length;
  for (let k = 0; k < within && n - 2 - k >= 0; k++) {
    const i = n - 1 - k;
    const x1 = a[i], y1 = b[i], x0 = a[i - 1], y0 = b[i - 1];
    if (![x1, y1, x0, y0].every(fin)) continue;
    if (dir === 1 ? x1 > y1 && x0 <= y0 : x1 < y1 && x0 >= y0) return k;
  }
  return null;
}

/** The six trend-template rules on the last bar. */
export function trendTemplate(b: DailyBars): { tt: number; ttOk: number; rules: boolean[] } | null {
  const c = b.c, n = c.length;
  if (n < 2) return null;
  const s50 = smaSeries(c, 50), s150 = smaSeries(c, 150), s200 = smaSeries(c, 200);
  const L = n - 1, close = c[L];
  const c1 = close > s50[L];
  const c2 = s50[L] > s150[L];
  const c3 = s150[L] > s200[L];
  let rising = 0;
  for (let k = 0; k < 20; k++) { const i = L - k; if (i >= 1 && s200[i] > s200[i - 1]) rising++; }
  const c4 = rising === 20;
  let lo = Infinity, hi = -Infinity;
  if (n >= 250) for (let i = n - 250; i < n; i++) { if (b.l[i] < lo) lo = b.l[i]; if (b.h[i] > hi) hi = b.h[i]; }
  const c5 = n >= 250 && lo > 0 && close / lo > 1.3;
  const c6 = n >= 250 && hi > 0 && close / hi > 0.75;
  const rules = [c1, c2, c3, c4, c5, c6];
  const tt = rules.filter(Boolean).length;
  return { tt, ttOk: tt === 6 ? 1 : 0, rules };
}

/** Weinstein stage on weekly closes: 1–4, or null with under 34 weeks of history. */
export function weinsteinStage(wc: readonly number[], at = wc.length - 1): number | null {
  if (at < 33) return null;
  const ma = smaSeries(wc.slice(0, at + 1), 30);
  const now = ma[at], before = ma[at - 4];
  if (!fin(now) || !fin(before) || before <= 0) return null;
  const slope = (now / before - 1) * 100;
  const above = wc[at] > now;
  if (above && slope > 0.5) return 2;
  if (!above && slope < -0.5) return 4;
  if (above && slope < -0.5) return 1;   // price back above a still-falling average: basing / recovering
  if (!above && slope > 0.5) return 3;   // price below a still-rising average: topping
  // flat average: after a decline → 1, after an advance → 3 (the average against 20 weeks earlier)
  const old = at - 20 >= 29 ? ma[at - 20] : NaN;
  if (fin(old)) return now < old ? 1 : 3;
  return above ? 1 : 3;
}

/** Sessions since the latest pocket pivot within the last `within` sessions (0 = the last bar), else null. */
export function pocketPivotAge(b: DailyBars, within = 10): number | null {
  const { c, v } = b, n = c.length;
  if (n < 52) return null;
  const s10 = smaSeries(c, 10), s50 = smaSeries(c, 50);
  for (let k = 0; k < within; k++) {
    const i = n - 1 - k;
    if (i < 51 || !(c[i] > c[i - 1])) continue;
    let maxDown = 0;
    for (let j = i - 10; j < i; j++) if (c[j] < c[j - 1] && v[j] > maxDown) maxDown = v[j];
    if (v[i] > maxDown && maxDown > 0 && c[i] > s10[i] && c[i] > s50[i]) return k;
  }
  return null;
}

/** `bench` = the market index's weekly closes by week (Monday) key, for Mansfield RS; without it `mrs` stays null. `clock`
 *  (zzz1044a) = the market and the observation time for the completed-week rule of the Stage Analysis (default: now). */
export function tvFigures(b: DailyBars, bench?: ReadonlyMap<string, number> | null, clock?: StageClock): TvFigures {
  const out: TvFigures = { tt: null, ttOk: null, rsiMA: null, rsiX: null, gcD: null, dcD: null, emaXU: null, emaXD: null, rsRaw: null, stage: null, st12: null, ppD: null, rvol: null, adv: null, ripB: null, twSt: null, sata: null, mrs: null, twWk: null };
  const c = b.c, n = c.length;
  if (n < 30) return out;
  const L = n - 1;
  const t = trendTemplate(b);
  if (t && n >= 50) { out.tt = t.tt; out.ttOk = t.ttOk; }
  // RSI + its 14-bar average
  const rsi = rsiSeries(c, 14);
  const rsiMa = smaSeries(rsi.map((x) => (fin(x) ? x : 0)), 14).map((x, i) => (i >= 27 ? x : NaN));   // average only over real RSI values
  if (fin(rsiMa[L])) { out.rsiMA = r2(rsiMa[L]); out.rsiX = barsSinceCross(rsi, rsiMa, 1, 10); }
  // MA crosses
  const s50 = smaSeries(c, 50), s200 = smaSeries(c, 200);
  out.gcD = barsSinceCross(s50, s200, 1, 20); out.dcD = barsSinceCross(s50, s200, -1, 20);
  const e10 = emaSeries(c, 10), e21 = emaSeries(c, 21);
  out.emaXU = barsSinceCross(e10, e21, 1, 20); out.emaXD = barsSinceCross(e10, e21, -1, 20);
  // RS raw (IBD weights)
  if (n >= 253) {
    const roc = (k: number) => c[L] / c[L - k] - 1;
    out.rsRaw = r2((0.4 * roc(63) + 0.2 * roc(126) + 0.2 * roc(189) + 0.2 * roc(252)) * 100);
  }
  // Weinstein stage on weekly closes
  const wc = periodCloses(b.d, c, 'W');
  const st = weinsteinStage(wc);
  out.stage = st;
  if (st === 2) { let was1 = false; for (let k = 1; k <= 6; k++) if (weinsteinStage(wc, wc.length - 1 - k) === 1) { was1 = true; break; } out.st12 = was1 ? 1 : 0; }
  else if (st != null) out.st12 = 0;
  // pocket pivots
  out.ppD = pocketPivotAge(b, 10);
  // swing data
  if (n >= 51) { let s = 0; for (let i = L - 50; i < L; i++) s += b.v[i]; const avg = s / 50; out.rvol = avg > 0 ? r2(b.v[L] / avg) : null; }
  if (n >= 20) { let s = 0; for (let i = n - 20; i < n; i++) s += c[i] * b.v[i]; out.adv = Math.round(s / 20); }
  // Ripster clouds
  if (n >= 50) {
    const e5 = emaSeries(c, 5)[L], e12 = emaSeries(c, 12)[L], e34 = emaSeries(c, 34)[L], e50 = emaSeries(c, 50)[L];
    const slowTop = Math.max(e34, e50);
    out.ripB = c[L] > e34 && c[L] > e50 && Math.min(e5, e12) > slowTop ? 1 : 0;
  }
  // zzz987 — Stage Analysis (TheWrap method)
  try {
    const w = stageFromDaily(b, bench, clock);
    if (w && w.sata != null) { out.sata = w.sata; out.twSt = w.stage; out.twWk = w.weeks; out.mrs = w.mrs; }
  } catch { /* never costs the other figures */ }
  return out;
}

/** RS Rating 1–99: each company's weighted performance ranked against every company of the market (ties share a rating). */
export function rsRatings(raw: ReadonlyArray<{ t: string; v: number | null | undefined }>): Map<string, number> {
  const vals = raw.filter((x): x is { t: string; v: number } => fin(x.v));
  const out = new Map<string, number>();
  const N = vals.length;
  if (!N) return out;
  const sorted = vals.map((x) => x.v).sort((a, b) => a - b);
  const below = (v: number) => { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; } return lo; };
  for (const x of vals) out.set(x.t, N === 1 ? 99 : Math.max(1, Math.min(99, 1 + Math.floor((98 * below(x.v)) / (N - 1)))));
  return out;
}
