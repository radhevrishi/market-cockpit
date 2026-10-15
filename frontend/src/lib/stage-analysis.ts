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
//                    average volume of all 10 weeks — up weeks on heavier volume than down weeks (no up week → 0)
//  10 little overhead close ≥ 85% of the 52-week high (highest weekly high of weeks i−51 … i)
// A component whose inputs are missing (too little history, no benchmark) scores 0.
//
// ── stages (zzz1023 — Weinstein's rules on the 30-week average, confirmed over two weekly closes) ──────────────────
// The 30-week average (ma30) is the stage line, as in Weinstein's book; its slope is measured over 5 weeks:
//   slope = (ma30[i] ÷ ma30[i−5] − 1) × 100;  rising > +1.0 %,  falling < −1.0 %,  flat in between (the flatness band).
// The 13-week closing range (hi13 / lo13) is the base: a close above hi13 is a breakout, below lo13 a breakdown.
// Each week a CHANGE is looked for from the current stage:
//   → 2 (from 1, 3, 4)  breakout: close > hi13 AND close > ma30 AND ma30 not falling AND SATA ≥ 5 (when SATA can be read)
//   → 4 (from 1, 2, 3)  breakdown: close < lo13 AND close < ma30 AND ma30 not rising (from Stage 1: ma30 falling)
//   → 3 (from 2)        after 13 weeks of Stage 2: ma30 no longer rising AND (close < ma30 OR two crossings of ma30 in the last
//                       10 weeks of the stage)
//   → 1 (from 4)        close > ma30, OR two crossings of ma30 in the last 10 weeks of the stage with ma30 no longer falling,
//                       OR three crossings with it still falling (price has stopped trending and swings around the average)
//   failed moves        a Stage 2 under 13 weeks old that closes back under a flat / falling ma30 returns to the stage before it
//                       (1, or 3); a Stage 4 under 13 weeks old (that came from 2 / 3) closing back over a flat / rising ma30 → 3
// A change counts only after TWO weekly closes in a row ask for one (a one-week dip or pop does not flip the stage). zzz1027 —
// each change keeps two dates: `began` = the first week that met the rule (where the structure began) and `confirmed` = the
// second weekly close (the stage was only known then). The weekly history never shows the new stage before it was confirmed:
// the first week keeps the old stage with `pending` naming the stage asked for, the new stage shows from the confirmed week,
// and `weeks` counts from the confirmed week (that week = 1). The first reading (34 weeks: the 30-week average and its 5-week slope) starts from a plain read of price vs a rising /
// flat / falling average. The current, unfinished week counts as a week, as TradingView paints its live bar.
// Sub-stages (A / B): 1A ma30 still falling, 1B ma30 flat or turning up · 2A within 20 % of ma30, 2B more than 20 % above it
// (extended) · 3A close above ma30, 3B below it · 4A ma30 falling fast (< −2 %), 4B the fall slowing.

export type Stage = 1 | 2 | 3 | 4;
export type SubStage = 'A' | 'B';
export type Slope = 'rising' | 'flat' | 'falling';
/** `last` (zzz1030) = the date of the week's LAST trading session (YYYY-MM-DD; a holiday week ends on Thursday etc.). */
export interface WeekBar { wk: string; o: number; h: number; l: number; c: number; v: number; last?: string }
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
  /** zzz1023 — ma30 change over 5 weeks in %, and its reading with the flatness band */
  slopePct?: number | null;
  slope?: Slope | null;
  sub?: SubStage | null;
  /** zzz1027 — first week that met the rule for the current stage (YYYY-MM-DD, the Monday): where the structure began */
  began?: string | null;
  /** zzz1027 — the week whose close confirmed the current stage (the second qualifying close; the stage was only known then).
   *  Equals `began` for the first reading, which needs no confirmation. `weeks` counts from this week. */
  confirmed?: string | null;
  /** zzz1030 — the last trading session of this week, of the began week and of the confirmed week (YYYY-MM-DD). The weekly
   *  close that confirmed a stage happened on `confirmedEnd`, so readers see the day the stage was known, not the week's Monday. */
  end?: string | null; beganEnd?: string | null; confirmedEnd?: string | null;
  /** same as `began` (kept for older callers) */
  since?: string | null;
  /** a change asked for by this week's close, waiting for a second close (null = none) */
  pending?: Stage | null;
  /** close vs ma30 in % */
  vsMa?: number | null;
  /** the level of the current stage's start: the base high broken (Stage 2) or the support broken (Stage 4) */
  level?: number | null;
  /** volume of the week that started the current stage ÷ the average of the 10 weeks before it */
  volX?: number | null;
}
/** zzz1027 — `i` / `wk` = the CONFIRMED week (when the change was known); `beganI` / `began` = the first week that met the rule. */
export interface StageChange { i: number; wk: string; beganI: number; began: string; confirmed: string; from: Stage | null; to: Stage; level: number | null; volX: number | null;
  /** zzz1030 — the last trading session of the began week and of the confirmed week (YYYY-MM-DD): the confirming close */
  beganEnd: string; confirmedEnd: string }
export interface StageResult { weeks: StageWeek[]; last: StageWeek | null; changes?: StageChange[] }

export const SATA_LABELS: readonly string[] = [
  'Breakout above the 13-week range', 'Close above the 10-week average', 'Close above the 30-week average', 'Close above the 40-week average',
  '40-week average rising', '10-week above 30-week average', 'Mansfield RS above zero', 'Mansfield RS rising (vs 10 weeks ago)',
  'Up-week volume above the 10-week average', 'Within 15% of the 52-week high',
];
export const STAGE_WORDS: Record<Stage, string> = { 1: 'Basing', 2: 'Advancing', 3: 'Topping', 4: 'Declining' };
export const STAGE_NAMES: Record<Stage, string> = { 1: 'Stage 1 · basing', 2: 'Stage 2 · advancing', 3: 'Stage 3 · topping', 4: 'Stage 4 · declining' };
export const SUB_WORDS: Record<Stage, Record<SubStage, string>> = {
  1: { A: 'early base, average still falling', B: 'late base, average flat or turning up' },
  2: { A: 'within 20% of the average', B: 'extended, more than 20% above the average' },
  3: { A: 'still above the average', B: 'below the average' },
  4: { A: 'average falling fast', B: 'the fall is slowing' },
};
/** What each stage means, in plain words (shown in the banner's details). */
export const STAGE_MEANING: Record<Stage, string> = {
  1: 'The fall has stopped and price moves sideways around a flat 30-week average. No up-trend yet: a weekly close above the base high would start one.',
  2: 'Price is above a rising 30-week average after leaving a base. This is the up-trend phase of the cycle.',
  3: 'The up-trend is losing strength: the 30-week average is flattening and price swings around it. A close below the range low would start a down-trend.',
  4: 'Price is below a falling 30-week average. This is the down-trend phase; a new base usually has to form before any up-trend.',
};
export const STAGE_TOOLTIP = 'Stage Analysis (TheWrap method): our own version. Stages follow Weinstein\'s rules on the 30-week average (its 5-week slope, the 13-week closing range, two weekly closes to confirm a change); the 10-point SATA score follows the published description of Tar_H\'s TheWrap Stage Analysis, with Mansfield RS against the S&P 500 (US) or Nifty 50 (India). Not the original script; readings can differ from TradingView.';
/** zzz1023 — the method's settings (exported for the banner and the tests). */
export const STAGE_RULES = { slopeWeeks: 5, flatPct: 1.0, fastPct: 2.0, confirmWeeks: 2, crossWeeks: 10, extendedPct: 20, sataMin: 5, youngWeeks: 13 } as const;

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
    const day = b.d[i].slice(0, 10);
    const last = out[out.length - 1];
    if (last && last.wk === wk) { last.h = Math.max(last.h, h); last.l = Math.min(last.l, l); last.c = c; last.v += v; last.last = day; }
    else if (!last || wk > last.wk) out.push({ wk, o, h, l, c, v, last: day });
  }
  return out;
}
/** zzz1030 — the week's last trading session. Weekly bars built here always carry it; bars made by hand without it fall back to
 *  that week's Friday (only then). */
export function weekEnd(w: { wk: string; last?: string }): string {
  if (w.last && /^\d{4}-\d{2}-\d{2}$/.test(w.last)) return w.last;
  const t = new Date(`${w.wk}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 4);
  return t.toISOString().slice(0, 10);
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

/** zzz1023 — the change asked for by week i from stage `cur` (null = none). See the rules at the top. `young` = the current
 *  stage started under 13 weeks ago; `prev` = the stage before it; `crosses` = closes crossing ma30 in the last 10 weeks of it. */
function changeAsked(cur: Stage | null, prev: Stage | null, young: boolean, x: { close: number; ma30: number; hi13: number; lo13: number; slope: Slope; crosses: number; sata: number | null }): Stage | null {
  const { close, ma30, hi13, lo13, slope, crosses, sata } = x;
  const breakout = close > hi13 && close > ma30 && slope !== 'falling' && (sata == null || sata >= STAGE_RULES.sataMin);
  const breakdown = close < lo13 && close < ma30 && (cur === 1 ? slope === 'falling' : slope !== 'rising');
  if (cur !== 2 && breakout) return 2;
  if (cur !== 4 && breakdown) return 4;
  if (cur === 2) {
    // a fresh breakout that falls back under a flat average has failed: back to the base (or the top) it came from
    if (young && close < ma30 && slope !== 'rising') return prev === 3 ? 3 : 1;
    if (!young && slope !== 'rising' && (close < ma30 || crosses >= 2)) return 3;
  }
  if (cur === 4) {
    // a fresh breakdown that is taken back over a flat average has failed: back to the top it came from
    if (young && prev !== 1 && close > ma30 && slope !== 'falling') return 3;
    if (close > ma30 || (slope !== 'falling' && crosses >= 2) || crosses >= 3) return 1;
  }
  return null;
}
/** The first reading, before any change has been seen: price vs a rising / flat / falling 30-week average. */
function firstStage(close: number, ma30: number, slope: Slope, ma30Long: number | null): Stage {
  if (slope === 'rising') return close >= ma30 ? 2 : 3;
  if (slope === 'falling') return close <= ma30 ? 4 : 1;
  // flat: after a rise it is a top, after a fall (or with no longer history) a base
  return ma30Long != null && ma30 > ma30Long * 1.05 ? 3 : 1;
}
function subOf(stage: Stage, close: number, ma30: number, slopePct: number): SubStage {
  if (stage === 1) return slopePct < 0 ? 'A' : 'B';
  if (stage === 2) return close > ma30 * (1 + STAGE_RULES.extendedPct / 100) ? 'B' : 'A';
  if (stage === 3) return close >= ma30 ? 'A' : 'B';
  return slopePct < -STAGE_RULES.fastPct ? 'A' : 'B';
}

/** The stage machine, SATA and Mansfield RS over weekly bars. */
export function stageAnalysis(weeks: readonly WeekBar[], bench?: ReadonlyMap<string, number> | null): StageResult {
  const n = weeks.length;
  const c = weeks.map((w) => w.c);
  const ma10 = sma(c, 10), ma30 = sma(c, 30), ma40 = sma(c, 40);
  const mrs = mansfieldRs(weeks, bench);
  const R = STAGE_RULES;
  const out: StageWeek[] = [];
  const changes: StageChange[] = [];
  const ends = weeks.map(weekEnd);
  let stage: Stage | null = null, prevStage: Stage | null = null, start = -1, conf = -1, level: number | null = null, volX: number | null = null;
  let pend: Stage | null = null, pendStart = -1, pendLevel: number | null = null, pendVolX: number | null = null, pendFrom: Stage | null = null;
  for (let i = 0; i < n; i++) {
    const close = c[i];
    let hi13: number | null = null, lo13: number | null = null;
    if (i >= 13) { hi13 = -Infinity; lo13 = Infinity; for (let k = i - 13; k < i; k++) { if (c[k] > hi13) hi13 = c[k]; if (c[k] < lo13) lo13 = c[k]; } }
    const m10 = ma10[i], m30 = ma30[i], m40 = ma40[i];
    const m40ago = i >= 4 ? ma40[i - 4] : null;
    const rising = fin(m40) && fin(m40ago) && m40 > m40ago;
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
    // the SATA score needs the 40-week average and the 13-week range
    const sata = fin(m40) && fin(hi13) && fin(lo13) ? comps.filter(Boolean).length : null;
    // the stage needs the 30-week average and its 5-week slope
    const m30ago = i >= R.slopeWeeks ? ma30[i - R.slopeWeeks] : null;
    const slopePct = fin(m30) && fin(m30ago) && m30ago > 0 ? (m30 / m30ago - 1) * 100 : null;
    const slope: Slope | null = slopePct == null ? null : slopePct > R.flatPct ? 'rising' : slopePct < -R.flatPct ? 'falling' : 'flat';
    let volNow: number | null = null;
    if (i >= 10) { let s10 = 0; for (let k = i - 10; k < i; k++) s10 += weeks[k].v; volNow = s10 > 0 && weeks[i].v > 0 ? Math.round((weeks[i].v / (s10 / 10)) * 10) / 10 : null; }
    let pendingOut: Stage | null = null;
    if (fin(m30) && slope != null && fin(hi13) && fin(lo13)) {
      if (stage == null) {
        const m30long = i >= 26 ? ma30[i - 26] : null;
        stage = firstStage(close, m30, slope, fin(m30long) ? m30long : null); start = i; conf = i; level = null; volX = null;
        changes.push({ i, wk: weeks[i].wk, beganI: i, began: weeks[i].wk, confirmed: weeks[i].wk, from: null, to: stage, level: null, volX: null, beganEnd: ends[i], confirmedEnd: ends[i] });
      } else {
        let crosses = 0;
        for (let k = Math.max(1, start + 1, i - R.crossWeeks + 1); k <= i; k++) {
          const a0 = ma30[k - 1], a1 = ma30[k];
          if (fin(a0) && fin(a1) && (c[k - 1] - a0) * (c[k] - a1) < 0) crosses++;
        }
        const ask = changeAsked(stage, prevStage, i - start + 1 <= R.youngWeeks, { close, ma30: m30, hi13, lo13, slope, crosses, sata });
        if (ask == null) { pend = null; }
        else {
          // a run goes on while each week asks for the same change, or the next step of it (3 → 4, 1 → 2); otherwise it restarts
          const goesOn = pend != null && (ask === pend || (pend === 3 && ask === 4) || (pend === 1 && ask === 2));
          if (!goesOn) { pendStart = i; pendFrom = stage; pendLevel = ask === 2 ? hi13 : ask === 4 ? lo13 : null; pendVolX = ask === 2 || ask === 4 ? volNow : null; }
          else if (ask !== pend) { pendLevel = ask === 2 ? hi13 : lo13; pendVolX = volNow; }
          pend = ask;
          const run = i - pendStart + 1;
          if (run >= R.confirmWeeks) {
            // confirmed at this close: the new stage shows from THIS week (the earlier weeks keep the old stage + pending — the
            // history never shows a stage before it was known); the first qualifying week is kept as `began`
            prevStage = stage; stage = pend; start = pendStart; conf = i; level = stage === 2 || stage === 4 ? pendLevel : null; volX = stage === 2 || stage === 4 ? pendVolX : null;
            changes.push({ i, wk: weeks[i].wk, beganI: pendStart, began: weeks[pendStart].wk, confirmed: weeks[i].wk, from: pendFrom, to: stage, level, volX, beganEnd: ends[pendStart], confirmedEnd: ends[i] });
            pend = null;
          } else pendingOut = pend;
        }
      }
    }
    out.push({
      wk: weeks[i].wk, c: close, ma10: m10, ma30: m30, ma40: m40, hi13, lo13, mrs: mrsNow, comps, sata,
      stage, weeks: stage != null ? i - conf + 1 : null,
      slopePct: slopePct == null ? null : Math.round(slopePct * 100) / 100, slope,
      sub: stage != null && fin(m30) && slopePct != null ? subOf(stage, close, m30, slopePct) : null,
      began: stage != null ? weeks[start].wk : null, confirmed: stage != null ? weeks[conf].wk : null,
      end: ends[i], beganEnd: stage != null ? ends[start] : null, confirmedEnd: stage != null ? ends[conf] : null,
      since: stage != null ? weeks[start].wk : null, pending: pendingOut,
      vsMa: fin(m30) && m30 > 0 ? r1((close / m30 - 1) * 100) : null,
      level: stage != null ? level : null, volX: stage != null ? volX : null,
    });
  }
  return { weeks: out, last: out.length ? out[out.length - 1] : null, changes };
}

/** Convenience: daily bars (YYYY-MM-DD dates) + optional benchmark weekly closes → the latest reading. */
export function stageFromDaily(b: { d: readonly string[]; o?: readonly number[]; h?: readonly number[]; l?: readonly number[]; c: readonly number[]; v?: readonly number[] }, bench?: ReadonlyMap<string, number> | null): StageWeek | null {
  return stageAnalysis(weeklyBars(b), bench).last;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-08-10" → "10 Aug 2026" (short: "10 Aug 26"). */
export function dayWords(iso: string | null | undefined, short = false): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  const y = iso.slice(0, 4), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  return `${d} ${MONTHS[m - 1] ?? '?'} ${short ? y.slice(2) : y}`;
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** zzz1030 — a trading session in words: "2026-08-14" → "Fri 14 Aug 2026" (`weekday: false` → "14 Aug 2026"; `year: false` →
 *  "Fri 14 Aug"). */
export function sessionWords(iso: string | null | undefined, o: { weekday?: boolean; year?: boolean } = {}): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  const d = Number(iso.slice(8, 10)), m = Number(iso.slice(5, 7));
  const wd = WEEKDAYS[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()];
  return `${o.weekday === false ? '' : `${wd} `}${d} ${MONTHS[m - 1] ?? '?'}${o.year === false ? '' : ` ${iso.slice(0, 4)}`}`;
}
/** zzz1030 — the dates of a stage (or a change) in words. Both are the weeks' LAST trading sessions: the confirming weekly close
 *  is the moment the stage was known (a Monday date read as that moment). `short` (the banner): "began wk to 7 Aug · confirmed
 *  14 Aug close" — the year is added when it is not the year of `now`; long (details, tooltips): "began week ending Fri 7 Aug
 *  2026 · confirmed at the close of Fri 14 Aug 2026". One date (first reading, nothing to confirm): "since wk to 7 Aug" /
 *  "since the week ending Fri 7 Aug 2026". */
export function stageDatesText(beganEnd: string | null | undefined, confirmedEnd: string | null | undefined, o: { short?: boolean; now?: string | null } = {}): string {
  const b = beganEnd || null, c = confirmedEnd || null;
  if (!b && !c) return '';
  const yr = (iso: string) => !o.now || iso.slice(0, 4) !== o.now.slice(0, 4);
  const sw = (iso: string) => sessionWords(iso, { weekday: false, year: yr(iso) });
  if (b && c && b !== c) {
    return o.short ? `began wk to ${sw(b)} · confirmed ${sw(c)} close` : `began week ending ${sessionWords(b)} · confirmed at the close of ${sessionWords(c)}`;
  }
  const one = (c ?? b)!;
  return o.short ? `since wk to ${sw(one)}` : `since the week ending ${sessionWords(one)}`;
}
/** zzz1030 — a week's last session for a reading made before zzz1030 fields existed (Monday key → that week's Friday). */
const endOr = (end: string | null | undefined, wk: string | null | undefined): string | null => (end ? end : wk ? weekEnd({ wk }) : null);
/** zzz1030 — one stage change in words, for the changes list: "Stage 1 → 2 · began week ending Fri 7 Aug 2026 · confirmed at
 *  the close of Fri 14 Aug 2026". */
export function stageChangeText(ch: StageChange, short = false, now?: string | null): string {
  const head = ch.from == null ? `Stage ${ch.to} · first reading` : `Stage ${ch.from} → ${ch.to} · ${STAGE_WORDS[ch.to]}`;
  return `${head} · ${stageDatesText(endOr(ch.beganEnd, ch.began), endOr(ch.confirmedEnd, ch.confirmed), { short, now })}`;
}
const signed = (v: number, dp = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}`;

/** The one-line summary, e.g. "Stage 2 · Advancing · began wk to 7 Aug · confirmed 14 Aug close (9 weeks) · 30-wk MA rising ·
 *  RS +12 · price 8% above MA". zzz1030: the dates are the weeks' last trading sessions (the confirming weekly close), not their
 *  Mondays; the year shows when it is not the year of the reading. The weeks count from the confirmed week. The first reading
 *  (no change seen yet) says "since wk to …". */
export function stageHeadline(w: StageWeek | null | undefined): string {
  if (!w || w.stage == null) return 'Stage Analysis: not enough weekly history (needs about 34 weeks)';
  const parts = [`Stage ${w.stage} · ${STAGE_WORDS[w.stage]}${w.sub === 'B' && w.stage === 2 ? ' (extended)' : ''}`];
  const nW = w.weeks != null ? ` (${w.weeks} week${w.weeks === 1 ? '' : 's'})` : '';
  const dates = stageDatesText(...weekDates(w), { short: true, now: endOr(w.end, w.wk) });
  if (dates) parts.push(`${dates}${nW}`);
  if (w.slope) parts.push(`30-wk MA ${w.slope}`);
  if (w.mrs != null) parts.push(`RS ${signed(w.mrs)}`);
  if (w.vsMa != null) parts.push(Math.abs(w.vsMa) < 0.5 ? 'price at the MA' : `price ${Math.abs(Math.round(w.vsMa))}% ${w.vsMa > 0 ? 'above' : 'below'} MA`);
  if (w.pending != null) parts.push(`Stage ${w.pending} needs one more weekly close`);
  return parts.join(' · ');
}

/** zzz1030 — [began, confirmed] as the weeks' last sessions (older readings without them: their Fridays). Same when unconfirmed. */
function weekDates(w: StageWeek): [string | null, string | null] {
  const began = w.began ?? w.since ?? null, conf = w.confirmed ?? null;
  const b = endOr(w.beganEnd, began), c = endOr(w.confirmedEnd, conf);
  return [b ?? c, c ?? b];
}
/** zzz1030 — the long form of the current stage's dates (hover text): "began week ending Fri 7 Aug 2026 · confirmed at the close
 *  of Fri 14 Aug 2026". */
export function stageDatesLong(w: StageWeek | null | undefined): string {
  return w && w.stage != null ? stageDatesText(...weekDates(w)) : '';
}
/** zzz1023 — the banner's details: each rule with the value measured this week. */
export interface StageDetail { label: string; value: string; ok: boolean | null }
export function stageDetails(w: StageWeek | null | undefined): StageDetail[] {
  if (!w) return [];
  const R = STAGE_RULES;
  const out: StageDetail[] = [];
  const f2 = (v: number | null | undefined, dp = 1) => (v == null ? '—' : signed(v, dp));
  out.push({ label: `30-week average slope (${R.slopeWeeks} weeks; flat within ±${R.flatPct}%)`, value: w.slopePct == null ? '—' : `${f2(w.slopePct, 1)}% · ${w.slope}`, ok: w.slope == null ? null : w.slope === 'rising' });
  out.push({ label: 'Close vs the 30-week average', value: w.vsMa == null ? '—' : `${f2(w.vsMa, 1)}%`, ok: w.vsMa == null ? null : w.vsMa > 0 });
  out.push({ label: '13-week closing range (base low – high)', value: w.lo13 != null && w.hi13 != null ? `${fmtLevel(w.lo13)} – ${fmtLevel(w.hi13)}` : '—', ok: null });
  const [bEnd, cEnd] = weekDates(w);
  if (bEnd && cEnd && bEnd !== cEnd) {
    out.push({ label: 'Structure began: first week that met the rule', value: `week ending ${sessionWords(bEnd)}`, ok: null });
    out.push({ label: 'Confirmed: the second weekly close — the stage was only known then', value: `at the close of ${sessionWords(cEnd)}`, ok: null });
  } else if (bEnd || cEnd) out.push({ label: 'First reading (no change seen before it)', value: `week ending ${sessionWords(cEnd ?? bEnd)}`, ok: null });
  out.push({ label: 'Weeks in this stage (counted from the confirmed week)', value: w.weeks == null ? '—' : String(w.weeks), ok: null });
  if (w.level != null) out.push({ label: w.stage === 2 ? 'Base high broken at the start' : 'Support broken at the start', value: fmtLevel(w.level), ok: null });
  if (w.volX != null && (w.stage === 2 || w.stage === 4)) out.push({ label: `Volume in the ${w.stage === 2 ? 'breakout' : 'breakdown'} week vs the 10 weeks before`, value: `${w.volX.toFixed(1)}×`, ok: w.stage === 2 ? w.volX >= 1.5 : null });
  out.push({ label: 'Mansfield RS (vs the index)', value: w.mrs == null ? 'no index' : f2(w.mrs, 1), ok: w.mrs == null ? null : w.mrs > 0 });
  out.push({ label: 'SATA score (TheWrap, 10 points)', value: w.sata == null ? '—' : `${w.sata}/10`, ok: w.sata == null ? null : w.sata >= 6 });
  if (w.pending != null) out.push({ label: 'Change waiting for a second weekly close', value: `to Stage ${w.pending} · ${STAGE_WORDS[w.pending]}`, ok: null });
  return out;
}
function fmtLevel(v: number): string {
  const dp = v >= 1000 ? 0 : v >= 100 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
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
