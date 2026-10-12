// zzz987 — STAGE ANALYSIS (TheWrap method). Our own version of Tar_H's invite-only TradingView scripts "TheWrap🌯 Stage
// Analysis" and its Pine-screener companion. Their source is hidden, so this follows the PUBLISHED description of the method
// (Weinstein stages on weekly bars + a 10-point SATA score); it is not a copy and its readings can differ from TradingView's.
// Pure: no network, no React. Used by the screener build (lib/screener/tv-screens.ts) and the /charts indicator.
//
// ── inputs ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Daily bars are resampled to WEEKLY bars (ISO weeks, Monday key): open = first open, high / low = extremes, close = last close,
// volume = sum. The current (unfinished) week is included, as TradingView paints its real-time bar.
// Benchmark for Mansfield RS: S&P 500 (^GSPC) for US stocks, Nifty 50 (^NSEI) for India — weekly closes matched by week;
// a week the benchmark has no bar for takes its previous weekly close.
//
// ── weekly figures (week i) ──────────────────────────────────────────────────────────────────────────────────────────
//  ma10 / ma30 / ma40   simple moving averages of weekly closes (10, 30, 40 weeks)
//  hi13 / lo13          highest / lowest weekly CLOSE of the previous 13 weeks (weeks i−13 … i−1, the current week left out)
//  40w rising           ma40[i] > ma40[i−4]   (declining: ma40[i] < ma40[i−4]) — a 4-week slope, so one flat week does not flip it
//  Mansfield RS         ((close ÷ benchmark) ÷ SMA52(close ÷ benchmark) − 1) × 100
//
// ── SATA score (0–10), one point each ────────────────────────────────────────────────────────────────────────────────
//   1 breakout       close > hi13
//   2 > 10w          close > ma10
//   3 > 30w          close > ma30
//   4 > 40w          close > ma40
//   5 40w rising     ma40[i] > ma40[i−4]
//   6 10w > 30w      ma10 > ma30
//   7 Mansfield > 0  Mansfield RS > 0
//   8 RS rising      Mansfield RS now > Mansfield RS 10 weeks ago
//   9 up-week volume over the last 10 weeks (i−9 … i), the average volume of the up weeks (close > previous close) is above the
//                    average volume of all 10 weeks — buying on heavier volume than selling (no up week → 0)
//  10 little overhead close ≥ 85% of the 52-week high (highest weekly high of weeks i−51 … i)
// A component whose inputs are missing (too little history, no benchmark) scores 0.
//
// ── stages (a state machine over the weekly bars; a stage stays until another one's condition fires) ─────────────────
//   Stage 2 (advancing, green)  close > hi13 AND close > ma40 AND SATA ≥ 6
//   Stage 4 (declining, red)    close < lo13 AND close < ma40 AND SATA ≤ 3
//   Stage 1 (basing, blue)      the current stage is 4 AND close > ma30 AND close < ma40 AND ma40 declining
//   Stage 3 (topping, blue)     the current stage is 2 AND close < ma30 AND close > ma40 AND ma40 rising AND sideways
//                               (sideways = close still inside the 13-week range: lo13 ≤ close ≤ hi13)
// Checked in that order each week (2 and 4 can fire from any stage). Before the first stage fires the stage is unknown (null).
// `weeks` = weeks in the current stage, counting the week it fired as 1.

export type Stage = 1 | 2 | 3 | 4;
export interface WeekBar { wk: string; o: number; h: number; l: number; c: number; v: number }
export interface StageWeek {
  wk: string; c: number;
  ma10: number | null; ma30: number | null; ma40: number | null;
  hi13: number | null; lo13: number | null;
  mrs: number | null;
  /** the ten SATA components in the order documented above */
  comps: boolean[];
  sata: number | null;
  stage: Stage | null;
  weeks: number | null;
}
export interface StageResult { weeks: StageWeek[]; last: StageWeek | null }

export const SATA_LABELS: readonly string[] = [
  'Breakout above the 13-week range', 'Close above the 10-week average', 'Close above the 30-week average', 'Close above the 40-week average',
  '40-week average rising', '10-week above 30-week average', 'Mansfield RS above zero', 'Mansfield RS rising (vs 10 weeks ago)',
  'Up-week volume above the 10-week average', 'Within 15% of the 52-week high',
];
export const STAGE_NAMES: Record<Stage, string> = { 1: 'Stage 1 · basing', 2: 'Stage 2 · advancing', 3: 'Stage 3 · topping', 4: 'Stage 4 · declining' };
export const STAGE_TOOLTIP = 'Stage Analysis (TheWrap method): our own version that follows the published rules of Tar_H\'s TheWrap Stage Analysis — weekly 10/30/40-week averages, the 13-week closing range and a 10-point SATA score, with Mansfield RS against the S&P 500 (US) or Nifty 50 (India). Not the original script; readings can differ from TradingView.';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Monday (UTC) of the ISO week holding the date `iso` (YYYY-MM-DD). */
export function weekKey(iso: string): string {
  const t = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Daily bars (dates as YYYY-MM-DD, ascending) → weekly bars. Bars without a positive close are skipped. */
export function weeklyBars(b: { d: readonly string[]; o?: readonly number[]; h?: readonly number[]; l?: readonly number[]; c: readonly number[]; v?: readonly number[] }): WeekBar[] {
  const out: WeekBar[] = [];
  for (let i = 0; i < b.c.length; i++) {
    const c = b.c[i];
    if (!fin(c) || c <= 0 || !b.d[i]) continue;
    const o = fin(b.o?.[i]) && b.o![i] > 0 ? b.o![i] : c;
    const h = fin(b.h?.[i]) && b.h![i] > 0 ? Math.max(b.h![i], c) : c;
    const l = fin(b.l?.[i]) && b.l![i] > 0 ? Math.min(b.l![i], c) : c;
    const v = fin(b.v?.[i]) ? b.v![i] : 0;
    const wk = weekKey(b.d[i]);
    const last = out[out.length - 1];
    if (last && last.wk === wk) { last.h = Math.max(last.h, h); last.l = Math.min(last.l, l); last.c = c; last.v += v; }
    else if (!last || wk > last.wk) out.push({ wk, o, h, l, c, v });
  }
  return out;
}
/** Same, from chart bars with millisecond timestamps (UTC day). */
export function weeklyFromTimed(bars: ReadonlyArray<{ t: number; o: number; h: number; l: number; c: number; v: number }>): WeekBar[] {
  return weeklyBars({ d: bars.map((x) => isoOf(x.t)), o: bars.map((x) => x.o), h: bars.map((x) => x.h), l: bars.map((x) => x.l), c: bars.map((x) => x.c), v: bars.map((x) => x.v) });
}
/** Benchmark weekly closes by week key. */
export function benchWeekly(d: readonly string[], c: readonly number[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of weeklyBars({ d, c })) m.set(w.wk, w.c);
  return m;
}

function sma(x: ReadonlyArray<number | null>, n: number): Array<number | null> {
  const out: Array<number | null> = new Array(x.length).fill(null);
  let s = 0, k = 0;   // k = valid values in the window
  for (let i = 0; i < x.length; i++) {
    const a = x[i];
    if (fin(a)) { s += a; k++; }
    if (i >= n) { const b = x[i - n]; if (fin(b)) { s -= b; k--; } }
    if (i >= n - 1 && k === n) out[i] = s / n;
  }
  return out;
}

/** Mansfield RS per week (null where the benchmark or 52 weeks of ratios are missing). */
export function mansfieldRs(weeks: readonly WeekBar[], bench: ReadonlyMap<string, number> | null | undefined): Array<number | null> {
  if (!bench || !bench.size) return weeks.map(() => null);
  const keys = Array.from(bench.keys()).sort();
  let j = -1;
  const ratio: Array<number | null> = weeks.map((w) => {
    while (j + 1 < keys.length && keys[j + 1] <= w.wk) j++;   // the benchmark's close for this week, else its previous one
    const b = j >= 0 ? bench.get(keys[j]) : undefined;
    return fin(b) && b > 0 ? w.c / b : null;
  });
  const avg = sma(ratio, 52);
  return ratio.map((r, i) => { const a = avg[i]; return fin(r) && fin(a) && a > 0 ? r1((r / a - 1) * 100) : null; });
}

/** The stage machine, SATA and Mansfield RS over weekly bars. */
export function stageAnalysis(weeks: readonly WeekBar[], bench?: ReadonlyMap<string, number> | null): StageResult {
  const n = weeks.length;
  const c = weeks.map((w) => w.c);
  const ma10 = sma(c, 10), ma30 = sma(c, 30), ma40 = sma(c, 40);
  const mrs = mansfieldRs(weeks, bench);
  const out: StageWeek[] = [];
  let stage: Stage | null = null, since = 0;
  for (let i = 0; i < n; i++) {
    const close = c[i];
    let hi13: number | null = null, lo13: number | null = null;
    if (i >= 13) { hi13 = -Infinity; lo13 = Infinity; for (let k = i - 13; k < i; k++) { if (c[k] > hi13) hi13 = c[k]; if (c[k] < lo13) lo13 = c[k]; } }
    const m10 = ma10[i], m30 = ma30[i], m40 = ma40[i];
    const m40ago = i >= 4 ? ma40[i - 4] : null;
    const rising = fin(m40) && fin(m40ago) && m40 > m40ago;
    const declining = fin(m40) && fin(m40ago) && m40 < m40ago;
    let volOk = false;
    if (i >= 10) {
      let all = 0, up = 0, nUp = 0;
      for (let k = i - 9; k <= i; k++) { all += weeks[k].v; if (c[k] > c[k - 1]) { up += weeks[k].v; nUp++; } }
      volOk = nUp > 0 && all > 0 && up / nUp > all / 10;
    }
    let hi52: number | null = null;
    if (i >= 51) { hi52 = 0; for (let k = i - 51; k <= i; k++) hi52 = Math.max(hi52, weeks[k].h); }
    const mrsNow = mrs[i], mrsAgo = i >= 10 ? mrs[i - 10] : null;
    const comps = [
      fin(hi13) && close > hi13,
      fin(m10) && close > m10,
      fin(m30) && close > m30,
      fin(m40) && close > m40,
      rising,
      fin(m10) && fin(m30) && m10 > m30,
      fin(mrsNow) && mrsNow > 0,
      fin(mrsNow) && fin(mrsAgo) && mrsNow > mrsAgo,
      volOk,
      fin(hi52) && hi52 > 0 && close >= 0.85 * hi52,
    ];
    // the score needs the 40-week average and the 13-week range; before that there is no reading
    const ready = fin(m40) && fin(hi13) && fin(lo13);
    const sata = ready ? comps.filter(Boolean).length : null;
    if (ready && sata != null) {
      let next: Stage | null = null;
      if (close > hi13! && close > m40! && sata >= 6) next = 2;
      else if (close < lo13! && close < m40! && sata <= 3) next = 4;
      else if (stage === 4 && fin(m30) && close > m30 && close < m40! && declining) next = 1;
      else if (stage === 2 && fin(m30) && close < m30 && close > m40! && rising && close >= lo13! && close <= hi13!) next = 3;
      if (next != null && next !== stage) { stage = next; since = 1; }
      else if (stage != null) since++;
    } else if (stage != null) since++;
    out.push({ wk: weeks[i].wk, c: close, ma10: m10, ma30: m30, ma40: m40, hi13, lo13, mrs: mrsNow, comps, sata, stage, weeks: stage != null ? since : null });
  }
  return { weeks: out, last: out.length ? out[out.length - 1] : null };
}

/** Convenience: daily bars (YYYY-MM-DD dates) + optional benchmark weekly closes → the latest reading. */
export function stageFromDaily(b: { d: readonly string[]; o?: readonly number[]; h?: readonly number[]; l?: readonly number[]; c: readonly number[]; v?: readonly number[] }, bench?: ReadonlyMap<string, number> | null): StageWeek | null {
  return stageAnalysis(weeklyBars(b), bench).last;
}

/** The one-line summary, e.g. "Stage 2 · SATA 7/10 · Mansfield RS +12.4 · 6 weeks". */
export function stageHeadline(w: StageWeek | null | undefined): string {
  if (!w || w.sata == null) return 'Stage Analysis: not enough weekly history (needs about 40 weeks)';
  const parts = [w.stage != null ? `Stage ${w.stage}` : 'Stage —', `SATA ${w.sata}/10`];
  if (w.mrs != null) parts.push(`Mansfield RS ${w.mrs > 0 ? '+' : ''}${w.mrs.toFixed(1)}`);
  if (w.weeks != null) parts.push(`${w.weeks} week${w.weeks === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** For a chart on any timeframe: the weekly reading that covers each bar. A bar's period ends where the next bar starts (the last
 *  bar: now), and it takes the reading of the last week that STARTS before that end — a daily bar gets its own week, a weekly bar
 *  its week, a monthly bar the month's last week. Bars before the first reading get null. */
export function readingsForBars<T>(barTimes: readonly number[], weeks: ReadonlyArray<{ wk: string }>, pick: (k: number) => T | null): Array<T | null> {
  const starts = weeks.map((w) => Date.parse(`${w.wk}T00:00:00Z`));
  const out: Array<T | null> = new Array(barTimes.length).fill(null);
  let k = -1;
  for (let i = 0; i < barTimes.length; i++) {
    const end = i + 1 < barTimes.length ? barTimes[i + 1] : Infinity;
    while (k + 1 < starts.length && starts[k + 1] < end) k++;
    out[i] = k >= 0 ? pick(k) : null;
  }
  return out;
}
