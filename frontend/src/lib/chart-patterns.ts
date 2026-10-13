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
//  5. Confidence ("shape score") = weighted share of soft rules passed (hard rules return nothing). < 0.35 dropped.
//     Likelihood words: ≥ 0.75 'very likely', ≥ 0.55 'likely', else 'possible'. A heuristic fit score, NOT a calibrated
//     probability that the pattern is real or that a trade works.
//
// zzz990 (chart-pattern audit 2026-10-12) — data-quality and geometry rules:
//  • Bars with a non-finite / non-positive close, an infinite open / high / low or an out-of-order time are rejected
//    (analyzePatterns reports how many). Missing / zero / non-finite volume stays MISSING (NaN): a volume rule scores 0
//    without enough valid observations and a usable baseline, so deleting volume can never raise a score; hits whose
//    span has too little volume carry volumeOk = false ("volume not confirmed").
//  • IPO base needs a listing date (firstTradeT) and a history that begins within a few days of it — the first bar of the
//    supplied history is never taken as the listing. It is the FIRST base after listing only: once an earlier post-listing
//    base broke out and the stock advanced > 20% past that pivot, a later consolidation is not an IPO base.
//  • Sloping boundaries (flags, pennants, wedges, H&S necklines) are projected bar by bar for the stage, capped at the
//    pattern's expiry (pennant / wedge apex, a flag's own length past its body); the displayed level and the distance to it
//    use the same projection at the last bar. Horizontal pivots are unchanged.
//  • Active structures (forming / breaking out) rank before failed ones.
//
// zzz992 — analysis timeframe D / W / M (a genuine weekly / monthly reading, not a relabelled daily one):
//  • detectPatterns / analyzePatterns take the bars OF the chosen timeframe (`opts.timeframe`, default 'D'). Weekly /
//    monthly bars come from lib/bar-aggregate (aggregateBars) — analyzeDailyAs() does both steps from daily bars.
//  • Every rule written in trading days is converted to bars of the timeframe with k daily bars per bar (D 1, W 5,
//    M 21): a window / lookback becomes round(days / k) bars (at least 1), and a pattern body's MINIMUM length becomes
//    round(days / k) but never under 3 bars (`minBody`) — a formation must span at least 3 candles to be seen on that
//    timeframe. Examples: flat base ≥ 25 days → ≥ 5 weeks; cup ≥ 35 days → ≥ 7 weeks / ≥ 3 months; prior-trend window
//    130 days → 26 weeks / 6 months; the 50/200-day averages → 10/40 weeks / 2/10 months; breakout recency (≤ 4 bars
//    after the first close beyond the pivot on D) → this or the previous candle on W / M; failed window 40 days → 8
//    weeks / 2 months; per-bar slope limits × k. Percent rules (depths, rises, band widths) are unchanged.
//  • Swing (zig-zag) thresholds scale with ATR of the timeframe's own bars, with clamps × 1.5 (W) / × 2 (M), because
//    one weekly / monthly candle already contains the small swings a daily zig-zag would see.
//  • A pattern is NOT APPLICABLE on a timeframe (PATTERN_TIMEFRAMES) when its defining body is a short formation whose
//    whole valid range is under ~12 bars of that timeframe AND its minimum is under 3 bars: forcing it to ≥ 3 candles
//    would describe a different, longer shape. E.g. flags / pennants (5–22 days) and the high tight flag (2–5 week
//    flag) on W and M; a flat base (5–26 weeks) on M. Long-range patterns (cups, VCP, double / triple, head & shoulders)
//    stay applicable with their minimum raised to 3 bars ("only the longer end of the range can be seen").
//  • M only: a rounding (U) base may span up to LONG_BASE_MONTHS (60) monthly bars — a multi-year base that the 65-week
//    cap excludes on D / W, and the main thing a monthly chart shows that the others cannot.
//  • Minimum history: D 30 bars, W 30 weekly bars, M 24 monthly bars (PATTERN_MIN_HISTORY); fewer → tooShort.
//  • Every hit carries `timeframe`; PATTERN_ENGINE_VERSION identifies the rule set for stored results.
//  • timeframe 'D' runs exactly the daily rules above (k = 1 makes every conversion the identity).
//
// zzz1005 — precision audit (2026-10-13; ~150 real detections on D / W / M charted and judged against Bulkowski, O'Neil
// and Minervini). The false positives were rarely a bad fit score; they were turning points that are not turning points.
// Rules added (thresholds next to each detector; REVERSAL_RULES holds the reversal ones):
//  • Double / triple bottoms & tops, head & shoulders: every low / high is the most extreme price around it (a third of the
//    way to its neighbours; the first one over a lead-in as long as the formation) and the first low (H&S: the head) lies
//    within 10% of the extreme of the prior ~6 months — no "first top" a few bars after a higher peak, no "first low" that
//    is a higher low inside a rally. Middle peak / trough and neckline armpits strictly between the turning points. Middle
//    dip ≤ 40% (M 45%). The last turning point is ≥ 3 days (W / M: 1 candle) old and price is back off it by ≥ 12% of the
//    formation's height. H&S: neckline change ≤ 15%, shoulders ≥ 30% of the head's distance from the neckline, head ≤ 30%
//    (M 40%) beyond the nearer shoulder.
//  • Lip bases (flat, cup, handle, U) and VCP: the left-side high tops the advance into it (no higher high over a lead-in as
//    long as the base). Cup / U without handle: close in the upper half. U base with < 10% prior rise: lip = 6-month high.
//  • Base on base: the earlier base is a real base (its pivot = its left-side high, ≥ 5 weeks before the breakout).
//  • Ascending base: each high ≤ 15% above the last, the third ≤ 25% above the first. VCP: first contraction from the
//    top (≥ 95% of it), contractions span ≥ 3 weeks, last high ≥ 90% of the base high.
//  • Triangles / wedges: void once the close is > 3% beyond the opposite line; scores ask more of touches, fit, flatness.
//  Effect on 336 sampled histories (D + W + M): double / triple / H&S hits 755 → 155, all hits 1,304 → 488; score 100 from
//  4.4% of hits to 1.4%; audited precision (correct / borderline / wrong) 27% / 30% / 43% (67 hits) → 49% / 47% / 3% (99).
//  Regression fixtures from those real charts: __tests__/zzz1005-pattern-precision.test.ts.
//
// zzz1008 — auditable geometry + two more precision rules (owner / tester sweep 2026-10-13; fixtures in
// __tests__/zzz1008-pine-bug-sweep.test.ts):
//  • Every hit carries its turning points (`points`: time, price, role — POINT_ROLES, e.g. first low / middle peak / second low,
//    left shoulder / head / right shoulder and the two neckline points, lip / base low / right-side high / handle low) and measured
//    rule evidence (`evidence`: lows' difference, middle rally, prior trend, separation, volume at the last vs the first turning
//    point, neckline change …); toTags stores them compactly (`pts` [date, price, role], `ev`).
//  • A double / triple bottom or inverse H&S the price has run away from is not current: close within 5% of the 1-year high, that
//    high made after the last low and more than 5% beyond the pivot (RUNAWAY_RULES; mirror for tops at the 1-year low).
//  • Monthly readings span ≥ MONTHLY_MIN_SPAN (6) monthly candles (cups, U bases, VCPs, reversals) — a 4-candle "monthly cup" is a
//    daily / weekly formation.
//
// zzz1009 — chart-indicator audit (2026-10-13; 116 charts India + US on D / W / M as the CHART indicator shows them; fixtures in
// __tests__/zzz1009-chart-pattern-indicator-audit.test.ts):
//  • Weekly double / triple tops & bottoms and head & shoulders span ≥ WEEKLY_REVERSAL_MIN_SPAN (5) weekly candles (two tops 2–3
//    weeks apart are a daily formation; seen: MTARTECH "weekly double top" on 4 candles).
//  • Every hit carries the first close beyond its level (breakT, breakAgo bars before the last bar).
//  • opts.weak (the chart indicator; never changes `hits`): `weak` = candidates with a shape score WEAK_CONF ≤ x < MIN_CONF; `expired`
//    = qualifying shapes that are no longer current (completed breakouts, failures older than the failed window, sloped boundaries
//    that ran out, reversals the price ran away from), also read at older breakout body ends (HISTORY_ENDS). The chart's headline
//    order (current / expired / weaker) is components/charts/pattern-view patternView().

import { aggregateBars } from './bar-aggregate';

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
  cup: M('cup', 'Cup', 'bullish', 'base', 'Cup & U', 'A rounded U-shaped base 7–65 weeks long and 12–33% deep (deeper, to 50%, scores lower), right side back near the left high; no handle yet.'),
  cup_handle: M('cup_handle', 'Cup with handle', 'bullish', 'base', 'Cup & U', 'A cup followed by a short, shallow pullback (handle) in its upper half on lighter volume.'),
  ascending_base: M('ascending_base', 'Ascending base', 'bullish', 'base', 'Flat & ascending bases', 'Three pullbacks of 10–20% over 9–16 weeks, each low and high above the last (8–22% pullbacks over 8–19 weeks accepted with a lower score).'),
  vcp: M('vcp', 'VCP (volatility contraction)', 'bullish', 'base', 'VCP', 'Two to six pullbacks, each smaller than the one before, with volume drying up in the last.'),
  base_on_base: M('base_on_base', 'Base on base', 'bullish', 'base', 'IPO & base-on-base', 'A new base forming just above an earlier base whose breakout gained less than 20%.'),
  ipo_base: M('ipo_base', 'IPO base', 'bullish', 'base', 'IPO & base-on-base', 'The first base after listing (within about two years), a correction from the post-listing high.'),
  bull_flag: M('bull_flag', 'Bull flag', 'bullish', 'continuation', 'Flags & pennants', 'A sharp rise (the pole) then 1–4 weeks of tight, parallel drift down or sideways.'),
  bull_pennant: M('bull_pennant', 'Bull pennant', 'bullish', 'continuation', 'Flags & pennants', 'A sharp rise then 1–4 weeks of narrowing, converging range.'),
  ascending_triangle: M('ascending_triangle', 'Ascending triangle', 'bullish', 'continuation', 'Triangles & wedges', 'A flat ceiling touched two or more times with rising lows under it.'),
  // zzz1008 — no '(W)' / '(M)' in labels: W and M are the weekly / monthly timeframe badges (the W-shape is in the description)
  double_bottom: M('double_bottom', 'Double bottom', 'bullish', 'reversal', 'Double/triple', 'Two lows at about the same price (a W shape) with a middle peak at least 10% higher, after a fall.'),
  triple_bottom: M('triple_bottom', 'Triple bottom', 'bullish', 'reversal', 'Double/triple', 'Three lows at about the same price with peaks between them, after a fall.'),
  falling_wedge: M('falling_wedge', 'Falling wedge', 'bullish', 'reversal', 'Triangles & wedges', 'Highs and lows both falling, the highs faster, so the range narrows.'),
  high_tight_flag: M('high_tight_flag', 'High tight flag', 'bullish', 'continuation', 'Flags & pennants', 'A rise of 90% or more (full score at 100%) in 8 weeks (40 trading days) or less, then a 2–5 week (10–25 trading-day) pullback of no more than 25%.'),
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
/** zzz1008 — a turning point of the detected structure (auditable geometry): bar time, price and its role (POINT_ROLES). On W / M
 *  the time is the bar's time (the first session of that week / month). */
export interface PatternPoint { t: number; p: number; role: PointRole }
/** zzz1008 — the role codes of a pattern's turning points (kept short: they are stored on every screener tag). */
export const POINT_ROLES = {
  L1: 'first low', L2: 'second low', L3: 'third low', P: 'middle peak', P1: 'first peak', P2: 'second peak',
  H1: 'first high', H2: 'second high', H3: 'third high', T: 'middle trough', T1: 'first trough', T2: 'second trough',
  LS: 'left shoulder', HD: 'head', RS: 'right shoulder', N1: 'neckline, left', N2: 'neckline, right',
  LIP: 'left-side high (lip)', LOW: 'base low', R: 'right-side high', HL: 'handle low',
  PB: 'earlier base high', BO: 'breakout close', PS: 'pole start', PT: 'pole top', FL: 'flag low', FH: 'flag high',
  CH: 'contraction high', CL: 'contraction low', TH: 'swing high (touch)', TL: 'swing low (touch)',
} as const;
export type PointRole = keyof typeof POINT_ROLES;
/** zzz1008 — measured rule evidence on a hit (only the keys that apply; percentages as % numbers, 1 decimal):
 *  band = difference between the lows (bottoms) / highs (tops), % · rally = middle peak above the higher low (tops: middle trough
 *  below the lower high), % · mid = dip from the middle peak to the lows, % · trend = prior fall into the first low (tops / bases:
 *  prior rise), % · gap = bars between the first and the last turning point · vr = volume around the last turning point ÷ around
 *  the first (2 bars either side; < 1 = lighter) · neck = neckline change between its two points, % · sh = shoulders' distance
 *  from the neckline ÷ the head's · sd = shoulder difference, % · depth = base depth, % · rec = right side as % of the lip ·
 *  round = share of the cup's closes in its lower 30%, % · hd = handle depth, % · hi1y = close as % of the 1-year high. */
export type PatternEvidence = Partial<Record<'band' | 'rally' | 'mid' | 'trend' | 'gap' | 'vr' | 'neck' | 'sh' | 'sd' | 'depth' | 'rec' | 'round' | 'hd' | 'hi1y', number>>;
export interface PatternHit {
  id: PatternId; label: string; bias: PatternBias; family: PatternFamily;
  stage: PatternStage; confidence: number; likelihood: 'very likely' | 'likely' | 'possible';
  startT: number; endT: number; lengthBars: number; depthPct: number | null;
  pivot: number | null; distToPivotPct: number | null;
  note: string;
  lines: PatternLine[];
  /** zzz990 — false when the bars of this pattern carry too little usable volume: volume rules got no credit ("volume not confirmed"). */
  volumeOk?: boolean;
  /** zzz992 — the analysis timeframe the hit was found on (lengthBars counts bars of this timeframe) */
  timeframe?: PatternTimeframe;
  /** zzz1008 — the detected structure's turning points (in time order) and the measured rule evidence */
  points?: PatternPoint[];
  evidence?: PatternEvidence;
  /** zzz1009 — the first close beyond the level (breakout / breakdown; failed: the break that failed): its bar time and how many
   *  bars of the timeframe before the last analysed bar it was (absent while forming with no close beyond the level) */
  breakT?: number;
  breakAgo?: number;
  /** zzz1009 — a sub-threshold candidate (shape score WEAK_CONF ≤ x < MIN_CONF), only in PatternAnalysis.weak */
  weak?: boolean;
  /** zzz1009 — only in PatternAnalysis.expired: why a qualifying shape is no longer current — 'completed' (broke out longer ago than the
   *  breakout window and held), 'failed-old' (failed longer ago than the failed window), 'apex' (a sloped boundary ran out unbroken),
   *  'ran-away' (a reversal the price has run away from, RUNAWAY_RULES) */
  expired?: ExpiredWhy;
}
export type ExpiredWhy = 'completed' | 'failed-old' | 'apex' | 'ran-away';
export type PatternTimeframe = 'D' | 'W' | 'M';
/** maxBars counts bars of the analysis timeframe. */
export interface DetectOptions { firstTradeT?: number; maxBars?: number; timeframe?: PatternTimeframe;
  /** zzz1009 — also return the weaker candidates (PatternAnalysis.weak): shape score WEAK_CONF ≤ x < MIN_CONF, current stage, not
   *  the same structure as a qualifying hit. Never changes `hits`. */
  weak?: boolean }

/** zzz992 — bump when any detection rule changes (stored screener tags carry it for provenance). */
export const PATTERN_ENGINE_VERSION = 'cp-3.3-indicator';

interface TfProfile {
  tf: PatternTimeframe;
  /** daily bars per bar */
  k: number;
  /** a pattern body's minimum length in bars on this timeframe (the identity on D) */
  minBody: number;
  /** fewer usable bars than this: nothing analysed */
  minHistory: number;
  /** zig-zag clamp multiplier */
  swingMul: number;
  /** default history analysed, in bars */
  defaultMaxBars: number;
}
const TF_PROFILES: Record<PatternTimeframe, TfProfile> = {
  D: { tf: 'D', k: 1, minBody: 1, minHistory: 30, swingMul: 1, defaultMaxBars: 700 },
  W: { tf: 'W', k: 5, minBody: 3, minHistory: 30, swingMul: 1.5, defaultMaxBars: 260 },
  M: { tf: 'M', k: 21, minBody: 3, minHistory: 24, swingMul: 2, defaultMaxBars: 120 },
};
/** zzz1008 — a pattern read on MONTHLY bars spans at least this many monthly candles (cups, U bases and VCPs: the base; double /
 *  triple bottoms & tops and head & shoulders: from the first to the last turning point plus one). A shorter structure is a daily /
 *  weekly formation seen through a few monthly candles — its roundness or its turning points cannot be judged on 4–5 candles (seen:
 *  RVSB "monthly cup, 4 mo" = the 86-day daily cup with handle; HY "monthly double top" over 3 months). It is read on D / W. */
export const MONTHLY_MIN_SPAN = 6;
/** zzz1009 — a double / triple top or bottom or head & shoulders read on WEEKLY bars spans at least this many weekly candles from its
 *  first to its last turning point. Two tops 2–3 weeks apart are a daily formation: on 3–4 weekly candles the dip between them is one
 *  candle and the shape cannot be judged (seen: MTARTECH "weekly double top" with the tops two candles apart). It is read on D. */
export const WEEKLY_REVERSAL_MIN_SPAN = 5;
/** zzz992 — longest rounding (U) base read on monthly bars, in months. */
export const LONG_BASE_MONTHS = 60;
/** Minimum usable bars per timeframe (W: 30 weeks, M: 24 months). */
export const PATTERN_MIN_HISTORY: Record<PatternTimeframe, number> = { D: 30, W: 30, M: 24 };

const ALL_TF: PatternTimeframe[] = ['D', 'W', 'M'];
const DW: PatternTimeframe[] = ['D', 'W'];
const D_ONLY: PatternTimeframe[] = ['D'];
/**
 * zzz992 — the timeframes each pattern can be read on. Not applicable (with the reason in PATTERN_NA_REASON):
 *  W: bull flag, bull pennant, bear flag (5–22-day flag = 1–4 weeks), high tight flag (2–5-week flag).
 *  M: the above, plus flat base (5–26 weeks), cup with handle (its 1–7-week handle), ascending base (8–19 weeks),
 *     base on base (4–26 weeks), IPO base (within 2 years of listing — shorter than the 24-month minimum history),
 *     ascending / descending triangle and falling / rising wedge (3–26 weeks).
 */
export const PATTERN_TIMEFRAMES: Record<PatternId, ReadonlyArray<PatternTimeframe>> = {
  flat_base: DW, u_base: ALL_TF, cup: ALL_TF, cup_handle: DW, ascending_base: DW, vcp: ALL_TF, base_on_base: DW, ipo_base: DW,
  bull_flag: D_ONLY, bull_pennant: D_ONLY, ascending_triangle: DW, double_bottom: ALL_TF, triple_bottom: ALL_TF, falling_wedge: DW,
  high_tight_flag: D_ONLY, inverse_hs: ALL_TF, double_top: ALL_TF, triple_top: ALL_TF, head_shoulders: ALL_TF,
  descending_triangle: DW, bear_flag: D_ONLY, rising_wedge: DW,
};
export const PATTERN_NA_REASON: Partial<Record<PatternId, string>> = {
  flat_base: 'a 5–26 week base is 1–6 monthly candles',
  cup_handle: 'the 1–7 week handle cannot be seen on monthly candles',
  ascending_base: 'an 8–19 week base is 2–4 monthly candles',
  base_on_base: 'a 4–26 week base is 1–6 monthly candles',
  ipo_base: 'within 2 years of listing there is less than the 24-month minimum history',
  bull_flag: 'a 1–4 week flag is shorter than 3 weekly candles at its usual length',
  bull_pennant: 'a 1–4 week pennant is shorter than 3 weekly candles at its usual length',
  bear_flag: 'a 1–4 week flag is shorter than 3 weekly candles at its usual length',
  high_tight_flag: 'the 2–5 week flag is shorter than 3 weekly candles at its usual length',
  ascending_triangle: 'a 3–26 week triangle is 1–6 monthly candles',
  descending_triangle: 'a 3–26 week triangle is 1–6 monthly candles',
  falling_wedge: 'a 4–26 week wedge is 1–6 monthly candles',
  rising_wedge: 'a 4–26 week wedge is 1–6 monthly candles',
};
export const patternApplies = (id: PatternId, tf: PatternTimeframe) => PATTERN_TIMEFRAMES[id].includes(tf);
export interface PatternTag {
  id: PatternId; b: 'U' | 'D'; s: 'f' | 'b' | 'x'; c: number; p: number | null; d: number | null;
  /** zzz1008 — compact turning points: [date YYYY-MM-DD (W / M: the bar's first session), price (4 significant digits), role] */
  pts?: Array<[string, number, PointRole]>;
  /** zzz1008 — measured rule evidence (PatternEvidence) */
  ev?: PatternEvidence;
}

// ───────────────────────────── helpers ─────────────────────────────

const DAY = 86_400_000;
const MIN_CONF = 0.35;
/** zzz1009 — shape score floor of a "weaker candidate" (shown only on request, separated from the qualifying hits). */
export const WEAK_CONF = 0.25;
export const QUALIFY_CONF = MIN_CONF;
/** Default history used for detection: ~2.8 years (65-week base + a year of prior trend + margin). */
const DEFAULT_MAX_BARS = 700;
/** zzz990 (CP-03) — the supplied history must begin within this many days of the given listing date for an IPO base. */
const LISTING_TOLERANCE_DAYS = 7;
/** Fewer usable daily bars than this: nothing is analysed (reported as too little history, not as "no pattern"). */
export const PATTERN_MIN_BARS = 30;
/** zzz990 (CP-08) — high tight flag rules, shared by the detector, PATTERN_META text and the tests. */
export const HTF_RULES = { minRise: 0.9, fullRise: 1.0, maxPoleBars: 40, minFlagBars: 10, maxFlagBars: 25, maxDepth: 0.25 } as const;

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
  /** prefix count of bars with usable volume (v is NaN where volume is missing) */
  pn: Float64Array;
  /** zzz992 — the timeframe profile (k daily bars per bar) */
  pf: TfProfile;
}

/** zzz992 — a window / lookback of `days` trading days in bars of this timeframe (identity on D; at least 1). */
const B = (s: { pf: TfProfile }, days: number) => (s.pf.k === 1 ? days : Math.max(1, Math.round(days / s.pf.k)));
/** zzz992 — a pattern body's minimum length of `days` trading days in bars (identity on D; at least minBody = 3 on W / M). */
const Bm = (s: { pf: TfProfile }, days: number) => (s.pf.k === 1 ? days : Math.max(s.pf.minBody, Math.round(days / s.pf.k)));
/** zzz992 — a "good" ramp end that never falls below its "bad" end after conversion. */
const Bg = (s: { pf: TfProfile }, days: number, lo: number) => Math.max(lo, B(s, days));

function build(bars: PBar[], listT: number | null, pf: TfProfile = TF_PROFILES.D): S {
  const n = bars.length;
  const t: number[] = new Array(n), o: number[] = new Array(n), h: number[] = new Array(n), l: number[] = new Array(n), c: number[] = new Array(n), v: number[] = new Array(n);
  for (let i = 0; i < n; i++) { const b = bars[i]; t[i] = b.t; o[i] = b.o; h[i] = b.h; l[i] = b.l; c[i] = b.c; v[i] = b.v; }
  const pv = new Float64Array(n + 1), pc = new Float64Array(n + 1), pn = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const ok = Number.isFinite(v[i]) && v[i] > 0;
    pv[i + 1] = pv[i] + (ok ? v[i] : 0); pn[i + 1] = pn[i] + (ok ? 1 : 0); pc[i + 1] = pc[i] + c[i];
  }
  const atrPct = new Float64Array(n);
  let atr = 0;
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    atr = i === 0 ? tr : i < 14 ? (atr * i + tr) / (i + 1) : (atr * 13 + tr) / 14;
    atrPct[i] = c[i] > 0 ? atr / c[i] : 0;
  }
  return { n, t, o, h, l, c, v, mxH: new Sparse(h, true), mnL: new Sparse(l, false), pv, pc, pn, atrPct, listT, pf };
}

/** Average of the USABLE volumes in [a, b]; NaN (no evidence) unless ≥ 60% of the window (at least 3 bars, or all of a
 *  shorter window) has volume. */
function avgVol(s: S, a: number, b: number): number {
  a = Math.max(0, a); b = Math.min(s.n - 1, b);
  if (b < a) return NaN;
  const len = b - a + 1, k = s.pn[b + 1] - s.pn[a];
  if (k < Math.min(len, Math.max(3, Math.ceil(0.6 * len)))) return NaN;
  return (s.pv[b + 1] - s.pv[a]) / k;
}
const vol50 = (s: S, i: number) => avgVol(s, i - B(s, 50) + 1, i);
/** Ratio of two volume averages; NaN (scores 0 through ramp) when either side is missing or the baseline is not usable. */
const volRatio = (num: number, den: number) => (Number.isFinite(num) && Number.isFinite(den) && den > 0 && num >= 0 ? num / den : NaN);
const sma = (s: S, i: number, p: number) => { const a = Math.max(0, i - p + 1); return (s.pc[i + 1] - s.pc[a]) / (i - a + 1); };
/** Rise into index i: high[i] over the lowest low of the prior ~6 months (130 days → 26 weeks / 6 months). */
const priorUp = (s: S, i: number) => s.h[i] / s.mnL.val(i - B(s, 130), i) - 1;
/** Fall into index i: 1 − low[i] over the highest high of the prior ~6 months. */
const priorDown = (s: S, i: number) => 1 - s.l[i] / s.mxH.val(i - B(s, 130), i);
/** Stage-2 trend template points: close above the 50-day, 50-day above the 200-day (10 / 40 weeks, 2 / 10 months). */
const trendOK = (s: S, e: number) => { const a = B(s, 50), b = B(s, 200); return (s.c[e] > sma(s, e, a) ? 0.5 : 0) + (sma(s, e, a) > sma(s, e, b) ? 0.5 : 0); };
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
  /** zzz990 (CP-05) — bar index past which a sloped line is no longer projected (apex / flag length); breaks after it do not count. */
  expiry?: number;
  /** zzz1008 — turning points [bar index, price, role] and measured evidence */
  pts?: Array<[number, number, PointRole]>;
  ev?: PatternEvidence;
}

const LP = (kind: PatternLine['kind'], s: S, i0: number, p0: number, i1: number, p1: number): PatternLine => ({ kind, points: [[s.t[i0], p0], [s.t[i1], p1]] });
/** zzz1008 — a fraction as a % number with 1 decimal (evidence values). */
const pc1 = (x: number) => Math.round(x * 1000) / 10;
/** zzz1008 — evidence object without non-finite values. */
function evOf(o: PatternEvidence): PatternEvidence {
  const out: PatternEvidence = {};
  for (const [k, v] of Object.entries(o) as Array<[keyof PatternEvidence, number | undefined]>) if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
  return out;
}
/** zzz1008 — volume around the last turning point ÷ around the first (2 bars either side); NaN when either side lacks volume. */
const volAround = (s: S, first: number, last: number) => volRatio(avgVol(s, last - 2, last + 2), avgVol(s, first - 2, first + 2));

// ───────────────────────────── detectors (one body end) ─────────────────────────────

/** Staircase records: i in [e − maxLen, e − minLen] with high[i] ≥ every high in (i, e] and ≥ the 5 highs before it (a real
 *  peak, not the shoulder of one). Ordered nearest first. lowRecords is the mirror for lows. */
function highRecords(s: S, e: number, minLen: number, maxLen: number): number[] {
  const out: number[] = [];
  let run = -Infinity;
  const stop = Math.max(0, e - maxLen);
  for (let i = e; i >= stop; i--) {
    if (s.h[i] >= run) { if (e - i >= minLen && s.h[i] >= s.mxH.val(i - B(s, 5), i - 1)) out.push(i); run = s.h[i]; }
  }
  return out;
}
function lowRecords(s: S, e: number, minLen: number, maxLen: number): number[] {
  const out: number[] = [];
  let run = Infinity;
  const stop = Math.max(0, e - maxLen);
  for (let i = e; i >= stop; i--) {
    if (s.l[i] <= run) { if (e - i >= minLen && !(s.l[i] > s.mnL.val(i - B(s, 5), i - 1))) out.push(i); run = s.l[i]; }
  }
  return out;
}

function push(out: Map<PatternId, Raw>, r: Raw | null) {
  // zzz1009 — candidates down to WEAK_CONF are kept (the weaker-candidate list); the qualifying hits still need MIN_CONF
  if (!r || !(r.conf >= WEAK_CONF) || !(r.pivot > 0)) return;
  const prev = out.get(r.id);
  if (!prev || r.conf > prev.conf) out.set(r.id, r);
}

/**
 * Bases with a left-side high (lip): flat base, cup, cup with handle, U base, base on base, IPO base.
 *  Flat base   (O'Neil): ≥ 5 weeks (25 bars; up to 26 weeks), depth ≤ 15% (≤ 10% scores best), prior rise ≥ 20% (full at 30%).
 *  Cup         (O'Neil): 7–65 weeks, depth 12–33% (to 50% penalised), prior rise ≥ 20–30%, rounded: ≥ 35% of the
 *                       cup's closes in the lower 30% of its range (a straight-sided V spends ~30% there, a U ~50%),
 *                       low in the middle 15–85% of the cup, right side back within 25% (full credit within 5%) of the lip.
 *                       No handle yet (right-side pullback < 2.5% or < 5 bars) → pivot = lip high. zzz1005: a cup / U base
 *                       without a handle needs the close back in the upper half of its range (the right side is rising).
 *  zzz1005: every lip base (flat, cup, handle, U) needs its left-side high to top the advance into it — no higher high
 *                       (> 1%) over a lead-in as long as the base, at least 5 weeks and at most ~6 months.
 *  Handle      (O'Neil): 5–35 bars after the right-side high, 2.5–15% deep (≤ 10% best), its low in the upper half of the
 *                       cup, right-side high within 15% of the lip, lighter volume; pivot = handle high (no tick added — O'Neil adds 0.10;
 *                       the caller can).
 *  U base:              rounded like a cup but not a classic cup (too shallow 8–12%, too deep, or no prior rise); zzz1005:
 *                       with less than a 10% rise into it, its lip must be the high of the prior ~6 months.
 *  Base on base (O'Neil): a base ≤ 25% deep whose lip is 5–20% above the pivot of a prior base (5–35% deep, broke out
 *                       within 60 bars before the lip) and whose low holds above ~93% of that pivot. zzz1005: the prior base
 *                       is a real base — its pivot is its LEFT-side high, the highest high from there to the day before the
 *                       breakout, at least 5 weeks (25 days) before it; never the last bars of a straight rally or of a V.
 */
function detectLipBases(s: S, e: number, recs: number[], out: Map<PatternId, Raw>) {
  const tf = s.pf.tf;
  const L25 = Bm(s, 25), L35 = Bm(s, 35), L130 = B(s, 130), L330 = B(s, 330);
  // zzz992 — M only: a rounding (U) base may span up to LONG_BASE_MONTHS (a multi-year base the 65-week cup cap excludes
  // on D / W); cups and cups with handle keep the 65-week (16-month) cap
  const LMAX = tf === 'M' ? LONG_BASE_MONTHS : L330;
  // a handle: ≥ 5 days on D; ≥ 2 candles on W (a 1-week dip is one candle, not a handle); not readable on M
  const L5 = s.pf.k === 1 ? 5 : 2;
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < L25 || len > LMAX) continue;
    if (tf === 'M' && len < MONTHLY_MIN_SPAN) continue;   // zzz1008
    const lip = s.h[sIdx];
    // zzz1005 — the left-side high tops the advance into it: no higher high over a lead-in as long as the base (5 weeks to
    // 6 months) — a lower high on the way down from a bigger peak is not the lip of a base
    if (s.mxH.val(sIdx - Math.min(Math.max(len, L25), L130), sIdx - 1) > lip * 1.01) continue;
    const m = s.mnL.idx(sIdx, e);
    const low = s.l[m];
    const depth = 1 - low / lip;
    const up = priorUp(s, sIdx);
    const range = lip - low;
    if (!(range > 0)) continue;
    const posInRange = (s.c[e] - low) / range;
    const tight3 = weeklyTightness(s, e, 3);

    // Flat base
    if (patternApplies('flat_base', tf) && len <= L130 && depth <= 0.15 && depth >= 0.02 && up >= 0.2) {
      const volDry = volRatio(avgVol(s, e - B(s, 10) + 1, e), vol50(s, sIdx));
      const conf = wscore([
        [2, ramp(up, 0.2, 0.35)], [2, ramp(depth, 0.15, 0.1)], [1, ramp(len, L25, Bg(s, 35, L25))], [1, ramp(posInRange, 0.3, 0.75)],
        [2, ramp(volDry, 1.1, 0.75)], [2, ramp(tight3, 0.06, 0.025)], [1, trendOK(s, e)],
      ]);
      push(out, { id: 'flat_base', conf, start: sIdx, end: e, keyFrom: sIdx, pivot: lip, depth,
        detail: '', lines: [LP('resistance', s, sIdx, lip, e, lip), LP('support', s, sIdx, low, e, low)],
        pts: [[sIdx, lip, 'LIP'], [m, low, 'LOW']], ev: evOf({ depth: pc1(depth), trend: pc1(up), vr: volDry }) });
    }

    if (len < L35) continue;
    const r = m >= e ? e : s.mxH.idx(m + 1, e);
    const rightH = s.h[r];
    const recovery = rightH / lip;
    const cupLen = r - sIdx;
    if (cupLen < L25 || recovery < 0.75) continue;
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
    // M: a handle (1–7 weeks) is not visible; a right-side dip of 1 monthly candle is noise there, not a handle
    const noHandle = (tf === 'M' ? hLen < 2 : hLen < L5) || hDepth < 0.025;
    const handleValid = patternApplies('cup_handle', tf) && hLen >= L5 && hLen <= B(s, 35) && hDepth >= 0.025 && hDepth <= 0.15 && hLow > low + 0.5 * range && recovery >= 0.85;
    const classic = len <= L330 && depth >= 0.12 && depth <= 0.5 && up >= 0.2 && round >= 0.35;
    const depthScore = depth <= 0.33 ? 1 : ramp(depth, 0.5, 0.33);
    const symScore = 1 - Math.min(1, Math.abs(lowPos - 0.5) / 0.4);
    const common: Array<[number, number]> = [
      [2, ramp(up, 0.2, 0.3)], [2, depthScore], [2, ramp(round, 0.33, 0.48)], [1, symScore], [1, ramp(len, L35, Bg(s, 45, L35))], [1, trendOK(s, e)],
    ];
    if (classic && handleValid) {
      const volDry = volRatio(avgVol(s, r, e), vol50(s, r));
      const drift = closeSlope(s, r, e) <= 0.0005 * s.pf.k ? 1 : 0;
      const conf = wscore([...common, [2, ramp(recovery, 0.85, 0.97)], [2, ramp(hDepth, 0.15, 0.1)], [1, ramp(volDry, 1.15, 0.8)], [1, drift], [1, ramp(hLen, B(s, 4), Bg(s, 7, B(s, 4)))]]);
      const hi = s.mnL.idx(r, e);
      push(out, { id: 'cup_handle', conf, start: sIdx, end: e, keyFrom: r, pivot: rightH, depth,
        detail: `handle ${Math.round(hDepth * 100)}% deep`,
        lines: [LP('pivot', s, r, rightH, e, rightH), LP('resistance', s, sIdx, lip, r, lip), LP('support', s, m, low, m, low)],
        pts: [[sIdx, lip, 'LIP'], [m, low, 'LOW'], [r, rightH, 'R'], [hi, s.l[hi], 'HL']],
        ev: evOf({ depth: pc1(depth), trend: pc1(up), rec: pc1(recovery), round: pc1(round), hd: pc1(hDepth), vr: volDry }) });
    } else if (classic && noHandle && posInRange >= 0.5) {
      // zzz1005 — a cup's right side is climbing back: the close is in the upper half of the cup
      const conf = wscore([...common, [2, ramp(recovery, 0.75, 0.95)], [1, ramp(posInRange, 0.5, 0.8)]]);
      push(out, { id: 'cup', conf, start: sIdx, end: e, keyFrom: sIdx, pivot: lip, depth,
        detail: `right side ${Math.round(recovery * 100)}% of the left high`,
        lines: [LP('pivot', s, sIdx, lip, e, lip), LP('support', s, m, low, m, low)],
        pts: [[sIdx, lip, 'LIP'], [m, low, 'LOW'], ...(r > m ? [[r, rightH, 'R'] as [number, number, PointRole]] : [])],
        ev: evOf({ depth: pc1(depth), trend: pc1(up), rec: pc1(recovery), round: pc1(round) }) });
    } else if (!classic && (noHandle || handleValid) && depth >= 0.08 && depth <= 0.5 && round >= 0.35 && posInRange >= 0.5
      // zzz1005 — without a prior rise the lip must at least be the high of the prior ~6 months (not a bounce in a decline)
      && (up >= 0.1 || !(s.mxH.val(sIdx - L130, sIdx - 1) > lip * 1.01))) {
      const conf = wscore([[2, ramp(round, 0.35, 0.5)], [2, ramp(recovery, 0.75, 0.95)], [1, symScore], [1, ramp(len, L35, Bg(s, 50, L35))], [1, ramp(up, 0, 0.25)], [1, trendOK(s, e)]]);
      push(out, { id: 'u_base', conf, start: sIdx, end: e, keyFrom: sIdx, pivot: lip, depth, detail: len > L330 ? 'multi-year rounded base' : 'rounded bottom',
        lines: [LP('pivot', s, sIdx, lip, e, lip), LP('support', s, m, low, m, low)],
        pts: [[sIdx, lip, 'LIP'], [m, low, 'LOW'], ...(r > m ? [[r, rightH, 'R'] as [number, number, PointRole]] : [])],
        ev: evOf({ depth: pc1(depth), trend: pc1(up), rec: pc1(recovery), round: pc1(round) }) });
    }
  }

  // Base on base
  if (!patternApplies('base_on_base', tf)) return;
  const L20 = Bm(s, 20);
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < L20 || len > L130) continue;
    const lip = s.h[sIdx];
    const low = s.mnL.val(sIdx, e);
    const depth = 1 - low / lip;
    if (depth > 0.25 || depth < 0.03) continue;
    const L25b = Bm(s, 25);
    for (let k = sIdx - B(s, 3); k >= Math.max(L25b + 1, sIdx - B(s, 60)); k--) {
      // zzz1005 — a breakout bar: a close above the prior 5 weeks' highs
      const box = s.mxH.val(k - L25b, k - 1);
      if (!(s.c[k] > box)) continue;
      // the earlier base it broke out of: its left-side high j is the highest high of the ~6 months up to 5 weeks before the
      // breakout, and no later high before the breakout tops it by more than 1% (a real base ≥ 5 weeks long — never the last
      // bars of a straight rally or of a V)
      const j = s.mxH.idx(k - L130, k - L25b);
      if (j < 0 || s.mxH.val(j + 1, k - 1) > s.h[j] * 1.01) continue;
      const prevMax = s.h[j];
      // the FIRST close above the earlier base's lip
      if (!(s.c[k] > prevMax) || s.c[k - 1] > prevMax) continue;
      const priorLow = s.mnL.val(j, k - 1);
      const priorDepth = 1 - priorLow / prevMax;
      const adv = lip / prevMax - 1;
      if (priorDepth > 0.35 || priorDepth < 0.05 || adv < 0.05 || adv >= 0.2 || low < prevMax * 0.93) break;
      const conf = wscore([[2, adv <= 0.1 ? ramp(adv, 0.05, 0.08) : ramp(adv, 0.2, 0.12)], [2, ramp(low / prevMax, 0.93, 1.0)], [1, ramp(depth, 0.25, 0.12)], [1, ramp(len, L20, Bg(s, 30, L20))], [1, trendOK(s, e)], [1, ramp(priorUp(s, j), 0.1, 0.3)], [1, ramp(k - j, L25b, Bg(s, 35, L25b))]]);
      const lowI = s.mnL.idx(sIdx, e);
      push(out, { id: 'base_on_base', conf, start: j, end: e, keyFrom: sIdx, pivot: lip, depth,
        detail: `earlier base pivot ${fmt(prevMax)}, gained only ${Math.round(adv * 100)}% before this base`,
        lines: [LP('pivot', s, sIdx, lip, e, lip), LP('support', s, j, prevMax, k, prevMax)],
        pts: [[j, prevMax, 'PB'], [k, s.c[k], 'BO'], [sIdx, lip, 'LIP'], [lowI, low, 'LOW']], ev: evOf({ depth: pc1(depth), trend: pc1(adv) }) });
      break;
    }
  }
}

/** IPO base (O'Neil): within ~2 years of listing; correction from the post-listing high, ≥ 3 bars, 8–50% deep
 *  (25–50% is classic for longer ones); pivot = post-listing high. Only the FIRST base after listing (zzz990 CP-02). */
function detectIpoBase(s: S, e: number, out: Map<PatternId, Raw>) {
  if (s.listT == null || !patternApplies('ipo_base', s.pf.tf)) return;
  const age = (s.t[e] - s.listT) / DAY;
  if (age > 730 || age < 7) return;
  let first = 0;
  while (first < e && s.t[first] < s.listT) first++;
  const L3 = Bm(s, 3);
  const sIdx = s.mxH.idx(first, e - L3);
  if (sIdx < 0 || s.h[sIdx] < s.mxH.val(sIdx, e)) return;
  const earlier = firstBaseBreakout(s, first, sIdx);
  // an earlier post-listing base already broke out and the stock then advanced > 20% past its pivot: this is a later base
  if (earlier != null && s.h[sIdx] > earlier * 1.2) return;
  const len = e - sIdx + 1;
  const lip = s.h[sIdx];
  const m = s.mnL.idx(sIdx, e);
  const depth = 1 - s.l[m] / lip;
  if (depth < 0.08 || depth > 0.5) return;
  const posInRange = (s.c[e] - s.l[m]) / (lip - s.l[m]);
  if (posInRange < 0.25) return; // still falling — not a base yet
  const depthOk = len <= B(s, 25) ? ramp(depth, 0.5, 0.3) : (depth >= 0.25 ? ramp(depth, 0.55, 0.45) : ramp(depth, 0.08, 0.2));
  const conf = wscore([[2, ramp(len, L3, Bg(s, 15, L3))], [2, depthOk], [1, ramp(posInRange, 0.3, 0.75)], [1, ramp(730 - age, 0, 365)], [1, ramp(volRatio(avgVol(s, e - B(s, 10) + 1, e), avgVol(s, sIdx - B(s, 20), sIdx)), 1.2, 0.7)]]);
  push(out, { id: 'ipo_base', conf, start: sIdx, end: e, keyFrom: sIdx, pivot: lip, depth,
    detail: `${Math.round(age / 30.4)} months after listing`,
    lines: [LP('pivot', s, sIdx, lip, e, lip), LP('support', s, m, s.l[m], e, s.l[m])],
    pts: [[sIdx, lip, 'LIP'], [m, s.l[m], 'LOW']], ev: evOf({ depth: pc1(depth) }) });
}

/**
 * The pivot of the first post-listing base that broke out before bar `until`, or null. A base = a pullback of ≥ 8% from a
 * running post-listing high lasting ≥ 3 bars; its breakout = the first close above that high afterwards.
 */
export function firstBaseBreakoutOf(H: ArrayLike<number>, L: ArrayLike<number>, C: ArrayLike<number>, from: number, until: number, minBars = 3): number | null {
  if (from < 0 || from >= until) return null;
  let runHi = H[from], runHiI = from, minSince = Infinity;
  for (let i = from + 1; i < until; i++) {
    if (C[i] > runHi && i - runHiI >= minBars && 1 - minSince / runHi >= 0.08) return runHi;
    if (H[i] > runHi) { runHi = H[i]; runHiI = i; minSince = Infinity; } else if (L[i] < minSince) minSince = L[i];
  }
  return null;
}
const firstBaseBreakout = (s: S, from: number, until: number) => firstBaseBreakoutOf(s.h, s.l, s.c, from, until, B(s, 3));

/**
 * VCP (Minervini): within a base (lip record 3–65 weeks back), 2–6 successive pullbacks each < 92% of the one before
 * (e.g. 25% → 12% → 6%), the first 8–50%, the last ≤ 12% (≤ 7% best), last contraction high within 10% of the base high (zzz1005; was 12%), the first contraction starting within 5% of it and the
 * contractions spanning ≥ 15 days (3 weeks) (zzz1005), prior rise ≥ 20% (full at 35%), volume in the
 * last contraction below its 50-day average; pivot = high of the last contraction.
 */
function detectVcp(s: S, e: number, recs: number[], zz: Pivot[], out: Map<PatternId, Raw>) {
  const L15 = Bm(s, 15), L330 = B(s, 330);
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < L15 || len > L330) continue;
    if (s.pf.tf === 'M' && len < MONTHLY_MIN_SPAN) continue;   // zzz1008
    const up = priorUp(s, sIdx);
    if (up < 0.15) continue;
    // zzz1005 — the base's high tops the advance into it (as for the lip bases)
    if (s.mxH.val(sIdx - Math.min(Math.max(len, Bm(s, 25)), B(s, 130)), sIdx - 1) > s.h[sIdx] * 1.01) continue;
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
    if (pivot < s.h[sIdx] * 0.9) continue; // the contractions tighten near the top of the base
    // zzz1005 — the first contraction starts at the top of the base and the contractions span ≥ 3 weeks (a 1–2 week
    // wiggle is a flag, not a VCP)
    if (firstC.hi.p < s.h[sIdx] * 0.95 || e - firstC.hi.i + 1 < L15) continue;
    if (s.mxH.val(lastC.hi.i + 1, e) > pivot) continue;
    let lowsRise = 0;
    for (let k = j + 1; k < cs.length; k++) if (cs[k].lo.p >= cs[k - 1].lo.p * 0.99) lowsRise++;
    const volDry = volRatio(avgVol(s, lastC.hi.i, e), vol50(s, firstC.hi.i));
    const conf = wscore([
      [2, ramp(up, 0.2, 0.35)], [2, ramp(count, 1, 3)], [2, ramp(lastC.d, 0.12, 0.07)], [1, lowsRise / Math.max(1, count - 1)],
      [2, ramp(volDry, 1.1, 0.7)], [1, trendOK(s, e)], [1, ramp(tightRatio(cs, j), 0.8, 0.5)],
    ]);
    const path = cs.slice(j).map((x) => `${Math.round(x.d * 100)}%`).join(' → ');
    push(out, { id: 'vcp', conf, start: firstC.hi.i, end: e, keyFrom: lastC.hi.i, pivot, depth: firstC.d,
      detail: `${count} contractions ${path}`,
      lines: [LP('pivot', s, lastC.hi.i, pivot, e, pivot), ...cs.slice(j).map((x) => LP('trend', s, x.hi.i, x.hi.p, x.lo.i, x.lo.p))],
      pts: cs.slice(j).flatMap((x) => [[x.hi.i, x.hi.p, 'CH'], [x.lo.i, x.lo.p, 'CL']] as Array<[number, number, PointRole]>),
      ev: evOf({ depth: pc1(firstC.d), trend: pc1(up), vr: volDry }) });
  }
}
/** Average ratio between successive contraction depths (smaller = cleaner contraction). */
function tightRatio(cs: Array<{ d: number }>, j: number): number {
  let sum = 0, n = 0;
  for (let k = j + 1; k < cs.length; k++) { sum += cs[k].d / cs[k - 1].d; n++; }
  return n ? sum / n : 1;
}

/** Ascending base (O'Neil): 8–18 weeks (9–16 best), three pullbacks of 8–22% (10–20% best), each high and low above
 *  the previous; prior rise ≥ 20%; pivot = the third high. zzz1005: each high ≤ 15% above the one before and the third
 *  ≤ 25% above the first (beyond that it is an advancing trend with pullbacks, not a base); the first high tops the advance
 *  into the base (no higher high over a lead-in as long as the base). */
function detectAscendingBase(s: S, e: number, zz: Pivot[], out: Map<PatternId, Raw>) {
  if (!patternApplies('ascending_base', s.pf.tf)) return;
  const L40 = Bm(s, 40), L95 = B(s, 95);
  const pairs: Array<{ hi: Pivot; lo: Pivot }> = [];
  for (let k = 0; k + 1 < zz.length; k++) if (zz[k].hi && !zz[k + 1].hi && zz[k].i >= e - B(s, 100)) pairs.push({ hi: zz[k], lo: zz[k + 1] });
  if (pairs.length < 3) return;
  const [a, b, c] = pairs.slice(-3);
  const span = e - a.hi.i + 1;
  if (span < L40 || span > L95) return;
  if (!(b.hi.p > a.hi.p * 1.01 && c.hi.p > b.hi.p * 1.01 && b.lo.p > a.lo.p && c.lo.p > b.lo.p)) return;
  // zzz1005 — a base, not an advance with pullbacks: each new high ≤ 15% above the previous one, the third ≤ 25% above the first
  if (b.hi.p > a.hi.p * 1.15 || c.hi.p > b.hi.p * 1.15 || c.hi.p > a.hi.p * 1.25) return;
  const ds = [a, b, c].map((x) => 1 - x.lo.p / x.hi.p);
  if (ds.some((d) => d < 0.08 || d > 0.22)) return;
  const pivot = c.hi.p;
  if (s.mxH.val(c.hi.i + 1, e) > pivot) return;
  const up = priorUp(s, a.hi.i);
  if (up < 0.15) return;
  // zzz1005 — the first high tops the advance into the base (no higher high over a lead-in as long as the base)
  if (s.mxH.val(a.hi.i - Math.min(span, B(s, 130)), a.hi.i - 1) > a.hi.p * 1.01) return;
  const conf = wscore([[2, ramp(up, 0.15, 0.4)], [3, ds.reduce((x, d) => x + (d >= 0.1 && d <= 0.2 ? 1 : 0.5), 0) / 3], [1, ramp(span, L40, Bg(s, 45, L40)) * ramp(span, L95, Math.min(L95, Math.max(L40, B(s, 80))))], [1, trendOK(s, e)]]);
  push(out, { id: 'ascending_base', conf, start: a.hi.i, end: e, keyFrom: c.hi.i, pivot, depth: Math.max(...ds),
    detail: `pullbacks ${ds.map((d) => Math.round(d * 100) + '%').join(', ')}`,
    lines: [LP('pivot', s, c.hi.i, pivot, e, pivot), LP('trend', s, a.lo.i, a.lo.p, c.lo.i, c.lo.p)],
    pts: [[a.hi.i, a.hi.p, 'H1'], [a.lo.i, a.lo.p, 'T1'], [b.hi.i, b.hi.p, 'H2'], [b.lo.i, b.lo.p, 'T2'], [c.hi.i, c.hi.p, 'H3'], [c.lo.i, c.lo.p, 'LOW']],
    ev: evOf({ depth: pc1(Math.max(...ds)), trend: pc1(up) }) });
}

/** High tight flag (O'Neil), strict profile HTF_RULES (zzz990 CP-08 — the gates are exactly what PATTERN_META says):
 *  pole ≥ 90% (full score at 100%) in ≤ 8 weeks (40 bars), then a 10–25 bar (2–5 week) flag no more than 25% deep
 *  (≤ 15% best); pivot = flag high. 85–90% poles are NOT high tight flags (they can still read as a bull flag). */
function detectHTF(s: S, e: number, recs: number[], out: Map<PatternId, Raw>) {
  if (!patternApplies('high_tight_flag', s.pf.tf)) return;   // daily-only (see PATTERN_TIMEFRAMES)
  const R = HTF_RULES;
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < R.minFlagBars || len > R.maxFlagBars) continue;
    const p = s.mnL.idx(sIdx - R.maxPoleBars, sIdx - 1);
    if (p < 0) continue;
    const rise = s.h[sIdx] / s.l[p] - 1;
    if (rise < R.minRise) continue;
    const depth = 1 - s.mnL.val(sIdx, e) / s.h[sIdx];
    if (depth > R.maxDepth) continue;
    const conf = wscore([[3, ramp(rise, R.minRise - 0.05, R.fullRise)], [2, ramp(depth, R.maxDepth, 0.15)], [1, ramp(len, R.minFlagBars, 15)], [1, ramp(volRatio(avgVol(s, sIdx, e), avgVol(s, p, sIdx)), 1.1, 0.7)]]);
    push(out, { id: 'high_tight_flag', conf, start: p, end: e, keyFrom: sIdx, pivot: s.h[sIdx], depth,
      detail: `pole +${Math.round(rise * 100)}% in ${sIdx - p} days, flag ${Math.round(depth * 100)}% deep`,
      lines: [LP('pivot', s, sIdx, s.h[sIdx], e, s.h[sIdx]), LP('trend', s, p, s.l[p], sIdx, s.h[sIdx])],
      pts: [[p, s.l[p], 'PS'], [sIdx, s.h[sIdx], 'PT'], [s.mnL.idx(sIdx, e), s.mnL.val(sIdx, e), 'FL']], ev: evOf({ trend: pc1(rise), depth: pc1(depth) }) });
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
  if (!patternApplies('bull_flag', s.pf.tf)) return;   // flags / pennants are daily-only (see PATTERN_TIMEFRAMES)
  for (const sIdx of recs) {
    const len = e - sIdx + 1;
    if (len < 5 || len > 22) continue;
    const p = s.mnL.idx(sIdx - 20, sIdx - 1);
    if (p < 0) continue;
    const top = s.h[sIdx], base = s.l[p];
    const rise = top / base - 1;
    if (rise < 0.15 || rise >= HTF_RULES.minRise) continue; // ≥ 90% is a high tight flag's pole
    const lo = s.mnL.val(sIdx, e);
    const retr = (top - lo) / (top - base);
    if (retr > 0.5) continue;
    const ch = channel(s, sIdx, e);
    const su = ch.bu / top, sl = ch.bl / top;
    const w0 = ch.U(sIdx) - ch.L(sIdx), w1 = ch.U(e) - ch.L(e);
    const wr = w0 > 0 ? w1 / w0 : 1;
    const pivot = ch.U(e);
    // the boundary is projected at most one flag length past the body; a pennant's lines stop at their apex
    const flagExpiry = e + len;
    const apex = w0 > w1 && w1 > 0 ? sIdx + (w0 * (e - sIdx)) / (w0 - w1) : Infinity;
    const commonParts: Array<[number, number]> = [[3, ramp(rise, 0.15, 0.25)], [2, ramp(retr, 0.5, 0.33)], [1, ramp(sIdx - p, 25, 10)], [1, ramp(volRatio(avgVol(s, sIdx, e), avgVol(s, p, sIdx)), 1.1, 0.75)], [1, ramp(len, 4, 7)]];
    const lines = [LP('trend', s, sIdx, ch.U(sIdx), e, ch.U(e)), LP('trend', s, sIdx, ch.L(sIdx), e, ch.L(e)), LP('trend', s, p, base, sIdx, top)];
    const loI = s.mnL.idx(sIdx, e);
    const fpts: Array<[number, number, PointRole]> = [[p, base, 'PS'], [sIdx, top, 'PT'], [loI, lo, 'FL']];
    const fev = evOf({ trend: pc1(rise), depth: pc1(1 - lo / top) });
    if (su <= 0.0015 && sl <= 0.0015 && wr >= 0.6 && wr <= 1.5) {
      const conf = wscore([...commonParts, [2, ramp(Math.abs(wr - 1), 0.5, 0.15)], [1, su <= 0 ? 1 : 0.5]]);
      push(out, { id: 'bull_flag', conf, start: p, end: e, keyFrom: sIdx + 1, pivot, depth: 1 - lo / top, lineAt: ch.U, expiry: flagExpiry,
        detail: `pole +${Math.round(rise * 100)}% in ${sIdx - p} days, ${len}-day flag`, lines, pts: fpts, ev: fev });
    } else if (su < 0 && sl >= -0.0005 && wr < 0.6) {
      const conf = wscore([...commonParts, [2, ramp(wr, 0.6, 0.3)]]);
      push(out, { id: 'bull_pennant', conf, start: p, end: e, keyFrom: sIdx + 1, pivot, depth: 1 - lo / top, lineAt: ch.U, expiry: Math.min(flagExpiry, Math.floor(apex)),
        detail: `pole +${Math.round(rise * 100)}% in ${sIdx - p} days, ${len}-day pennant`, lines, pts: fpts, ev: fev });
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
    push(out, { id: 'bear_flag', conf, start: p, end: e, keyFrom: sIdx + 1, pivot: ch.L(e), depth: drop, lineAt: ch.L, expiry: e + len,
      detail: `pole −${Math.round(drop * 100)}% in ${sIdx - p} days, ${len}-day flag`,
      lines: [LP('trend', s, sIdx, ch.U(sIdx), e, ch.U(e)), LP('trend', s, sIdx, ch.L(sIdx), e, ch.L(e)), LP('trend', s, p, top, sIdx, bot)],
      pts: [[p, top, 'PS'], [sIdx, bot, 'PT'], [s.mxH.idx(sIdx, e), hi, 'FH']], ev: evOf({ trend: pc1(drop) }) });
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
 *  zzz1005: none of them is reported while the close is > 3% beyond the OPPOSITE line (an ascending triangle / falling
 *  wedge broken below its lower line, a descending triangle / rising wedge above its upper line) — the shape is void.
 */
function detectTriWedge(s: S, e: number, zz: Pivot[], out: Map<PatternId, Raw>) {
  if (!patternApplies('ascending_triangle', s.pf.tf)) return;   // triangles / wedges: D and W only
  const L15 = Bm(s, 15), L20 = Bm(s, 20), L30 = Bg(s, 30, L15), L130 = B(s, 130);
  // confirmed swings, plus the running one when price has already moved ≥ 2% away from it (a touch that is turning)
  const conf = zz.filter((q) => q.i >= e - L130 && (q.confirmed || (q.i <= e - B(s, 2) && (q.hi ? 1 - s.c[e] / q.p : s.c[e] / q.p - 1) >= 0.02)));
  for (let m = 4; m <= Math.min(8, conf.length); m++) {
    const W = conf.slice(-m);
    const a = W[0].i;
    const len = e - a + 1;
    if (len < L15 || len > L130) continue;
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
    const tpts = W.map((q) => [q.i, q.p, q.hi ? 'TH' : 'TL'] as [number, number, PointRole]);
    // share of closes in the window that stay between the two lines (±1%) — a random zig-zag fits its pivots but not its bars
    let inside = 0;
    for (let i = a; i <= e; i++) { const c = s.c[i]; if (c <= (fh.a + fh.b * i) * 1.01 && c >= (fl.a + fl.b * i) * 0.99) inside++; }
    const contain = inside / len;
    // zzz1005 — a structure whose OPPOSITE boundary the close has already broken by > 3% is no longer forming
    // (an ascending triangle / falling wedge now below its lower line; a descending triangle / rising wedge above its upper)
    const lowerHeld = s.c[e] >= (fl.a + fl.b * e) * 0.97, upperHeld = s.c[e] <= (fh.a + fh.b * e) * 1.03;
    const flatTol = (k: number) => (k >= 3 ? 0.03 : 0.02);
    if ((hMax - hMin) / hMax <= flatTol(Hs.length) && Math.abs(chH) <= 0.025 && risingLows && chL >= 0.04 && s.mxH.val(lastH.i + 1, e) <= hMax * 1.005 && lowerHeld) {
      const c = wscore([[2, ramp(touches, 3, 7)], [3, ramp(Hs.length, 2, 3)], [2, ramp(chL, 0.04, 0.1)], [1, ramp(fitQ, 0.04, 0.01)], [1, ramp(len, L15, L30)], [1, ramp(contain, 0.8, 0.97)], [1, ramp((hMax - hMin) / hMax, flatTol(Hs.length), 0.008)]]);
      push(out, { id: 'ascending_triangle', conf: c, start: a, end: e, keyFrom: a, pivot: hMax, depth: 1 - lMin / hMax,
        detail: `${Hs.length} touches of ${fmt(hMax)}, lows rising`, lines: [LP('resistance', s, a, hMax, e, hMax), lineSet[1]], pts: tpts, ev: evOf({ band: pc1((hMax - hMin) / hMax) }) });
    }
    if ((lMax - lMin) / lMax <= flatTol(Ls.length) && Math.abs(chL) <= 0.025 && fallingHighs && chH <= -0.04 && s.mnL.val(lastL.i + 1, e) >= lMin * 0.995 && upperHeld) {
      const c = wscore([[2, ramp(touches, 3, 7)], [3, ramp(Ls.length, 2, 3)], [2, ramp(-chH, 0.04, 0.1)], [1, ramp(fitQ, 0.04, 0.01)], [1, ramp(len, L15, L30)], [1, ramp(contain, 0.8, 0.97)], [1, ramp((lMax - lMin) / lMax, flatTol(Ls.length), 0.008)]]);
      push(out, { id: 'descending_triangle', conf: c, start: a, end: e, keyFrom: a, pivot: lMin, depth: 1 - lMin / hMax,
        detail: `${Ls.length} touches of ${fmt(lMin)}, highs falling`, lines: [LP('support', s, a, lMin, e, lMin), lineSet[0]], pts: tpts, ev: evOf({ band: pc1((lMax - lMin) / lMax) }) });
    }
    const converging = wStart > 0 && wEnd > 0 && wEnd < 0.75 * wStart;
    // where the two lines meet (the apex): a wedge's boundary is not projected past it
    const apex = fh.b !== fl.b ? Math.floor((fl.a - fh.a) / (fh.b - fl.b)) : Infinity;
    const wedgeOk = converging && touches >= 5 && len >= L20 && fitQ <= 0.025 && contain >= 0.9;
    if (wedgeOk && chH <= -0.04 && chL <= -0.015 && chH < chL && lowerHeld) {
      const piv = fh.a + fh.b * e;
      {
        const c = wscore([[2, ramp(touches, 5, 7)], [2, ramp(wEnd / wStart, 0.75, 0.4)], [2, ramp(fitQ, 0.025, 0.01)], [2, ramp(contain, 0.9, 0.98)], [1, ramp(len, L15, L30)], [1, ramp(priorDown(s, a), 0.05, 0.2)]]);
        push(out, { id: 'falling_wedge', conf: c, start: a, end: e, keyFrom: lastH.i + 1, pivot: piv, depth: 1 - lMin / hMax, lineAt: (i) => fh.a + fh.b * i, expiry: apex,
          detail: `${touches} touches, range narrowing`, lines: lineSet, pts: tpts });
      }
    }
    if (wedgeOk && chL >= 0.04 && chH >= 0.015 && chL > chH && upperHeld) {
      const piv = fl.a + fl.b * e;
      {
        const c = wscore([[2, ramp(touches, 5, 7)], [2, ramp(wEnd / wStart, 0.75, 0.4)], [2, ramp(fitQ, 0.025, 0.01)], [2, ramp(contain, 0.9, 0.98)], [1, ramp(len, L15, L30)], [1, ramp(priorUp(s, a), 0.05, 0.2)]]);
        push(out, { id: 'rising_wedge', conf: c, start: a, end: e, keyFrom: lastL.i + 1, pivot: piv, depth: 1 - lMin / hMax, lineAt: (i) => fl.a + fl.b * i, expiry: apex,
          detail: `${touches} touches, range narrowing`, lines: lineSet, pts: tpts });
      }
    }
  }
}

/**
 * Double / triple bottoms and tops and head & shoulders from medium zig-zag swings over the last 65 weeks.
 *  Double bottom (Bulkowski / O'Neil W): two lows within 5% (≤ 2% best), 10–325 bars apart, nothing lower between, the
 *    middle peak ≥ 10% above the higher low but the dip from it to the lows ≤ 40% (45% on M; ≤ 28% best), a ≥ 15% fall
 *    into the first low, price ≥ 3% (and ≥ 12% of the pattern's height) off the second low, made ≥ 3 days (W / M: ≥ 1 candle)
 *    before the body end; pivot = middle peak.
 *  Triple bottom: three lows within 5% band, both peaks ≥ 10% above (same depth cap), pivot = the higher of the two peaks.
 *  Inverse H&S: head ≥ 4% below both shoulders, shoulders within 10% of each other, time ratio 0.4–2.5, neckline peaks
 *    ≥ 5% above the shoulders, ≥ 15% fall before; neckline change between its two peaks ≤ 15% (≤ 4% best); each shoulder
 *    stands off the neckline by ≥ 30% of the head's distance from it (≥ 55% best); pivot = neckline extended to the last bar.
 *  Tops: the mirrors, after a ≥ 20% rise; breakdown = middle trough / lower trough / neckline.
 *
 * zzz1005 (precision audit of real detections) — turning points must be REAL turning points:
 *  • Each low (bottom) / high (top) is the most extreme price around it: over a third of the distance to the next turning
 *    point on each side, and — for the first one — over a lead-in as long as the whole formation (at least 10 days):
 *    a "first low" taken a few bars after a lower low (the swing on the way up from the real low), or a "first top" a
 *    few bars after a higher high (a lower high on the way down from the real peak) is not a double / triple / H&S.
 *  • The first low of a bottom (the head of an H&S) sits within 10% of the lowest low of the prior ~6 months or twice
 *    the formation's width (the mirror for tops): a bottom forms after a fall, at the low — not as a higher low inside a
 *    rally; a top forms at the high — not as a bounce inside a decline.
 *  • The middle peak / trough and each neckline armpit lie strictly BETWEEN the turning points (a candle's own high is not
 *    the rally after its own low — on W / M one candle carries both).
 *  • Head & shoulders: the neckline may not change more than 15% between its two armpits (a steep "neckline" is a trend,
 *    not a neckline), and shoulders must stand off it by ≥ 30% of the head (a lone spike with two small wiggles is not H&S);
 *    the head lies ≤ 30% (M 40%) beyond the nearer shoulder (a far deeper "head" is a V / rounding bottom with two
 *    points on its sides, not shoulders).
 */
function detectReversals(s: S, e: number, zz: Pivot[], out: Map<PatternId, Raw>) {
  const lows = zz.filter((q) => !q.hi && q.i >= e - B(s, 330));
  const highs = zz.filter((q) => q.hi && q.i >= e - B(s, 330));
  reversalSide(s, e, lows, true, out);
  reversalSide(s, e, highs, false, out);
}

/** zzz1005 — the shared turning-point rules of the reversal family (see detectReversals). */
export const REVERSAL_RULES = { maxMidDepth: 0.4, maxMidDepthM: 0.45, ctxTol: 0.1, maxNeckChange: 0.15, minShoulderRatio: 0.3, maxHeadBeyond: 0.3, minRebound: 0.03, reboundOfHeight: 0.12 } as const;
const REVERSAL_IDS = new Set<PatternId>(['double_bottom', 'triple_bottom', 'inverse_hs', 'double_top', 'triple_top', 'head_shoulders']);
/** zzz1008 — a bottom is no longer reported once the price has run away from it: the close is within `near1y` (5%) of the 1-year
 *  high, that high was made AFTER the pattern's last low, and it stands more than `past1y` (5%) beyond the pivot (seen: RVTY
 *  "monthly double bottom" with the pivot 118.30 while the stock trades at its 1-year high near 155). A bottom whose 1-year high
 *  came BEFORE it (the base of a pullback from that high — the prior decline the rules already require) or whose new high is just a
 *  fresh breakout through the pivot (≤ 5% beyond it) is kept. Tops: the mirror at the 1-year low. */
export const RUNAWAY_RULES = { near1y: 0.05, past1y: 0.05 } as const;
export function ranAwayFrom1y(c: number, ext1y: number, ext1yAfterLast: boolean, pivot: number, bottom: boolean): boolean {
  if (!ext1yAfterLast || !(ext1y > 0) || !(pivot > 0)) return false;
  const R = RUNAWAY_RULES;
  return bottom ? c >= ext1y * (1 - R.near1y) && ext1y > pivot * (1 + R.past1y) : c <= ext1y * (1 + R.near1y) && ext1y < pivot * (1 - R.past1y);
}

function reversalSide(s: S, e: number, pts: Pivot[], bottom: boolean, out: Map<PatternId, Raw>) {
  if (pts.length < 2) return;
  const R = REVERSAL_RULES;
  const last = pts[pts.length - 1];
  // the latest swing must be the last extreme and price must have moved ≥ 3% away from it
  const off = bottom ? s.c[e] / last.p - 1 : 1 - s.c[e] / last.p;
  if (off < R.minRebound) return;
  if (bottom ? s.mnL.val(last.i, e) < last.p : s.mxH.val(last.i, e) > last.p) return;
  // zzz1005 — the last turning point has bars after it (≥ 3 days; ≥ 1 candle on W / M): a low / high made by the bar now
  // being read has not turned yet
  if (e - last.i < Math.max(1, B(s, 3))) return;
  const ext = (a: number, b: number) => (bottom ? s.mxH.idx(a, b) : s.mnL.idx(a, b)); // middle peak (bottom) / trough (top) in [a, b]
  const beyond = (a: number, b: number) => (bottom ? s.mnL.val(a, b) : s.mxH.val(a, b)); // the most extreme low (bottom) / high (top)
  const trend = (i: number) => (bottom ? priorDown(s, i) : priorUp(s, i));
  const trendMin = bottom ? 0.15 : 0.2;
  const idB: PatternId = bottom ? 'double_bottom' : 'double_top';
  const idT: PatternId = bottom ? 'triple_bottom' : 'triple_top';
  const idH: PatternId = bottom ? 'inverse_hs' : 'head_shoulders';
  const lbl = bottom ? 'peak' : 'trough';
  const pivotOf = (mi: number) => (bottom ? s.h[mi] : s.l[mi]);
  // zzz992 — gaps in bars of the timeframe: a sub-gap (low → low) ≥ 10 days → ≥ 2 bars on W / M; the whole formation ≥ 3 bars
  const G10 = s.pf.k === 1 ? 10 : Math.max(2, B(s, 10)), Gall = Bm(s, 10), G325 = B(s, 325);
  const G5 = B(s, 5);
  // zzz1005 — turning-point rules
  const maxMid = s.pf.tf === 'M' ? R.maxMidDepthM : R.maxMidDepth;
  const leadMin = Math.max(2, B(s, 10)), ctxWin = B(s, 130);
  /** P is the most extreme price over [P.i − left, P.i + right] (clipped to the body end) */
  const dominant = (P: Pivot, left: number, right: number) => {
    const v = beyond(Math.max(0, P.i - left), Math.min(e, P.i + right));
    return bottom ? v >= P.p * 0.999 : v <= P.p * 1.001;
  };
  /** P lies within 10% of the extreme of the prior ~6 months (or twice the formation's width) */
  const nearCtx = (P: Pivot, width: number) => {
    const v = beyond(Math.max(0, P.i - Math.max(ctxWin, 2 * width)), P.i);
    return bottom ? v >= P.p * (1 - R.ctxTol) : v <= P.p * (1 + R.ctxTol);
  };
  /** dip from the middle peak to the lows (bottom) / from the highs to the middle trough (top), as a fraction */
  const midDepth = (mid: number, band: number) => (bottom ? 1 - band / mid : 1 - mid / band);
  /** price has come back off the last turning point by ≥ 3% and ≥ 12% of the formation's height (a turning point that
   *  has actually turned — not the bar a fresh low / high was just made) */
  const rebounded = (height: number) => (bottom ? s.c[e] - last.p : last.p - s.c[e]) >= Math.max(R.minRebound * last.p, R.reboundOfHeight * Math.abs(height));
  const third = (g: number) => Math.max(1, Math.floor(g / 3));
  // zzz1008 / zzz1009 — the turning points span ≥ MONTHLY_MIN_SPAN monthly / WEEKLY_REVERSAL_MIN_SPAN weekly candles
  const revSpan = s.pf.tf === 'M' ? MONTHLY_MIN_SPAN : s.pf.tf === 'W' ? WEEKLY_REVERSAL_MIN_SPAN : 0;

  let bestTripleLast = false;
  // Triple
  for (let a = pts.length - 3; a >= 0 && a >= pts.length - 10; a--) {
    for (let b = a + 1; b < pts.length - 1; b++) {
      const P = [pts[a], pts[b], last];
      if (P[1].i - P[0].i < G10 || P[2].i - P[1].i < G10) continue;
      if (P[2].i - P[0].i + 1 < revSpan) continue;   // zzz1008 (M) / zzz1009 (W)
      const ps = P.map((q) => q.p);
      const bandHi = Math.max(...ps), bandLo = Math.min(...ps);
      if (bandHi / bandLo - 1 > 0.05) continue;
      const extreme = beyond(P[0].i, P[2].i);
      if (bottom ? extreme < bandLo * 0.999 : extreme > bandHi * 1.001) continue;
      const m1 = ext(P[0].i + 1, P[1].i - 1), m2 = ext(P[1].i + 1, P[2].i - 1);
      if (m1 < 0 || m2 < 0) continue;
      const sep1 = bottom ? s.h[m1] / bandHi - 1 : 1 - s.l[m1] / bandLo;
      const sep2 = bottom ? s.h[m2] / bandHi - 1 : 1 - s.l[m2] / bandLo;
      if (sep1 < 0.1 || sep2 < 0.1) continue;
      const mi = bottom ? (s.h[m1] >= s.h[m2] ? m1 : m2) : (s.l[m1] <= s.l[m2] ? m1 : m2);
      const pivot = pivotOf(mi);
      const dd = midDepth(pivot, bottom ? bandLo : bandHi);
      if (dd > maxMid) continue;
      const width = P[2].i - P[0].i;
      const g1 = P[1].i - P[0].i, g2 = P[2].i - P[1].i;
      if (!dominant(P[0], Math.max(leadMin, width), third(g1)) || !dominant(P[1], third(g1), third(g2)) || !dominant(P[2], third(g2), e - P[2].i)) continue;
      if (!nearCtx(P[0], width)) continue;
      if (!rebounded(pivot - last.p)) continue;
      const tr = trend(P[0].i);
      if (tr < trendMin * 0.75) continue;
      const conf = wscore([[2, ramp(bandHi / bandLo - 1, 0.05, 0.015)], [2, ramp(Math.min(sep1, sep2), 0.1, 0.15)], [2, ramp(tr, trendMin * 0.75, trendMin + 0.15)], [1, ramp(width, B(s, 30), Bg(s, 60, B(s, 30)))], [1, ramp(off, 0.03, 0.08)], [1, ramp(dd, maxMid, maxMid - 0.12)]]);
      if (conf >= MIN_CONF) bestTripleLast = true;
      push(out, { id: idT, conf, start: P[0].i, end: e, keyFrom: P[2].i, pivot, depth: bottom ? 1 - bandLo / pivot : 1 - pivot / bandHi,
        detail: `three ${bottom ? 'lows' : 'highs'} near ${fmt(bottom ? bandLo : bandHi)}`,
        lines: [LP(bottom ? 'pivot' : 'support', s, P[0].i, pivot, e, pivot), LP(bottom ? 'support' : 'resistance', s, P[0].i, bottom ? bandLo : bandHi, P[2].i, bottom ? bandLo : bandHi)],
        pts: [[P[0].i, P[0].p, bottom ? 'L1' : 'H1'], [m1, pivotOf(m1), bottom ? 'P1' : 'T1'], [P[1].i, P[1].p, bottom ? 'L2' : 'H2'], [m2, pivotOf(m2), bottom ? 'P2' : 'T2'], [P[2].i, P[2].p, bottom ? 'L3' : 'H3']],
        ev: evOf({ band: pc1(bandHi / bandLo - 1), rally: pc1(Math.min(sep1, sep2)), mid: pc1(dd), trend: pc1(tr), gap: width, vr: volAround(s, P[0].i, P[2].i) }) });
    }
  }

  // Double (skip when the same last swing already makes a triple)
  if (!bestTripleLast) {
    for (let a = pts.length - 2; a >= 0; a--) {
      const A = pts[a];
      const gap = last.i - A.i;
      if (gap < Gall) continue;
      if (gap > G325) break;
      if (gap + 1 < revSpan) continue;   // zzz1008 (M) / zzz1009 (W)
      const band = Math.max(A.p, last.p) / Math.min(A.p, last.p) - 1;
      if (band > 0.05) continue;
      const lo = Math.min(A.p, last.p), hi = Math.max(A.p, last.p);
      const extreme = beyond(A.i + 1, last.i - 1);
      if (bottom ? extreme < lo : extreme > hi) continue;
      const mi = ext(A.i + 1, last.i - 1);
      if (mi < 0) continue;
      const sep = bottom ? s.h[mi] / hi - 1 : 1 - s.l[mi] / lo;
      if (sep < 0.1) continue;
      const pivot = pivotOf(mi);
      const dd = midDepth(pivot, bottom ? lo : hi);
      if (dd > maxMid) continue;
      if (!dominant(A, Math.max(leadMin, gap), third(mi - A.i)) || !dominant(last, third(last.i - mi), e - last.i)) continue;
      if (!nearCtx(A, gap)) continue;
      if (!rebounded(pivot - last.p)) continue;
      const tr = trend(A.i);
      if (tr < trendMin * 0.75) continue;
      const sym = Math.min(mi - A.i, last.i - mi) / Math.max(1, Math.max(mi - A.i, last.i - mi));
      const conf = wscore([[2, ramp(band, 0.05, 0.015)], [2, ramp(sep, 0.1, 0.18)], [2, ramp(tr, trendMin * 0.75, trendMin + 0.15)], [1, ramp(gap, Gall, Bg(s, 30, Gall))], [1, ramp(sym, 0.2, 0.6)], [1, ramp(off, 0.03, 0.08)], [1, ramp(dd, maxMid, maxMid - 0.12)]]);
      push(out, { id: idB, conf, start: A.i, end: e, keyFrom: mi, pivot, depth: bottom ? 1 - lo / pivot : 1 - pivot / hi,
        detail: `${bottom ? 'lows' : 'highs'} ${fmt(A.p)} and ${fmt(last.p)}, middle ${lbl} ${fmt(pivot)}`,
        lines: [LP(bottom ? 'pivot' : 'support', s, A.i, pivot, e, pivot), LP(bottom ? 'support' : 'resistance', s, A.i, A.p, last.i, last.p)],
        pts: [[A.i, A.p, bottom ? 'L1' : 'H1'], [mi, pivot, bottom ? 'P' : 'T'], [last.i, last.p, bottom ? 'L2' : 'H2']],
        ev: evOf({ band: pc1(band), rally: pc1(sep), mid: pc1(dd), trend: pc1(tr), gap, vr: volAround(s, A.i, last.i) }) });
      break; // nearest qualifying first swing only
    }
  }

  // Head & shoulders
  for (let h = pts.length - 2; h >= 1 && h >= pts.length - 8; h--) {
    const H = pts[h], RS = last;
    if (RS.i - H.i < G5) continue;
    const headDeeper = bottom ? RS.p / H.p - 1 : 1 - RS.p / H.p;
    if (headDeeper < 0.04) continue;
    if (bottom ? s.mnL.val(H.i, RS.i) < H.p : s.mxH.val(H.i, RS.i) > H.p) continue;
    for (let l = h - 1; l >= 0 && l >= h - 4; l--) {
      const LS = pts[l];
      if (H.i - LS.i < G5 || RS.i - LS.i < Gall) continue;
      if (RS.i - LS.i + 1 < revSpan) continue;   // zzz1008 (M) / zzz1009 (W)
      const lsOk = bottom ? LS.p / H.p - 1 : 1 - LS.p / H.p;
      if (lsOk < 0.04) continue;
      if (bottom ? s.mnL.val(LS.i, H.i) < H.p : s.mxH.val(LS.i, H.i) > H.p) continue;
      const shoulderDiff = Math.abs(LS.p - RS.p) / Math.max(LS.p, RS.p);
      if (shoulderDiff > 0.1) continue;
      // zzz1005 — the head is not a whole V / rounding bottom of its own: ≤ 30% (M 40%) beyond the nearer shoulder
      const headBeyond = bottom ? 1 - H.p / Math.min(LS.p, RS.p) : 1 - Math.max(LS.p, RS.p) / H.p;
      if (headBeyond > (s.pf.tf === 'M' ? 0.4 : R.maxHeadBeyond)) continue;
      const tRatio = (H.i - LS.i) / (RS.i - H.i);
      if (tRatio < 0.4 || tRatio > 2.5) continue;
      const n1 = ext(LS.i + 1, H.i - 1), n2 = ext(H.i + 1, RS.i - 1);
      if (n1 < 0 || n2 < 0) continue;
      const p1 = pivotOf(n1), p2 = pivotOf(n2);
      const neckSep = bottom ? Math.min(p1, p2) / Math.max(LS.p, RS.p) - 1 : 1 - Math.max(p1, p2) / Math.min(LS.p, RS.p);
      if (neckSep < 0.05) continue;
      const neckChg = Math.abs(p2 / p1 - 1);
      if (neckChg > R.maxNeckChange) continue;
      const slope = (p2 - p1) / Math.max(1, n2 - n1);
      const neckAt = (i: number) => p2 + slope * (i - n2);
      const pivot = neckAt(e);
      if (Math.abs(pivot / p2 - 1) > 0.15) continue;
      // each shoulder's distance from the neckline vs the head's
      const prom = (P: Pivot) => (bottom ? neckAt(P.i) - P.p : P.p - neckAt(P.i));
      const headProm = prom(H);
      const shRatio = headProm > 0 ? Math.min(prom(LS), prom(RS)) / headProm : 0;
      if (shRatio < R.minShoulderRatio) continue;
      const width = RS.i - LS.i;
      if (!dominant(LS, Math.max(leadMin, H.i - LS.i), third(n1 - LS.i)) || !dominant(H, third(H.i - n1), third(n2 - H.i)) || !dominant(RS, third(RS.i - n2), e - RS.i)) continue;
      if (!nearCtx(H, width)) continue;
      if (!rebounded(prom(RS))) continue;
      const tr = trend(LS.i);
      if (tr < trendMin * 0.75) continue;
      const conf = wscore([[2, ramp(shoulderDiff, 0.1, 0.03)], [2, ramp(headDeeper, 0.04, 0.1)], [1, ramp(Math.min(tRatio, 1 / tRatio), 0.4, 0.75)], [2, ramp(tr, trendMin * 0.75, trendMin + 0.15)], [1, ramp(neckSep, 0.05, 0.12)], [1, ramp(off, 0.03, 0.06)], [1, ramp(neckChg, R.maxNeckChange, 0.04)], [1, ramp(shRatio, R.minShoulderRatio, 0.55)]]);
      push(out, { id: idH, conf, start: LS.i, end: e, keyFrom: RS.i, pivot, depth: bottom ? 1 - H.p / pivot : 1 - pivot / H.p, lineAt: neckAt,
        detail: `head ${fmt(H.p)}, shoulders ${fmt(LS.p)} / ${fmt(RS.p)}`,
        lines: [LP('neckline', s, n1, p1, e, pivot), LP('trend', s, LS.i, LS.p, H.i, H.p), LP('trend', s, H.i, H.p, RS.i, RS.p)],
        pts: [[LS.i, LS.p, 'LS'], [n1, p1, 'N1'], [H.i, H.p, 'HD'], [n2, p2, 'N2'], [RS.i, RS.p, 'RS']],
        ev: evOf({ neck: pc1(neckChg), sh: Math.round(shRatio * 100) / 100, sd: pc1(shoulderDiff), rally: pc1(neckSep), trend: pc1(tr), gap: width, vr: volAround(s, LS.i, RS.i) }) });
      break;
    }
  }
}

// ───────────────────────────── stage + driver ─────────────────────────────

/** zzz1009 — how far back (bars of the timeframe) opts.weak looks for older breakout body ends (expired list only): ~7 months D, a year W, 2 years M. */
const HISTORY_ENDS: Record<PatternTimeframe, number> = { D: 150, W: 52, M: 24 };
/** Bar index up to which a sloped boundary is projected (its expiry, at most the last bar). */
const capOf = (last: number, lineAt?: (i: number) => number, expiry?: number) => (lineAt && expiry != null && Number.isFinite(expiry) ? Math.max(0, Math.min(last, Math.floor(expiry))) : last);

/**
 * Stage from closes since the pattern's key point (see header). null = completed long ago / not current.
 * zzz990 (CP-05): a sloped boundary is PROJECTED to each compared bar (never frozen at the body end), up to its expiry;
 * a break after the expiry does not count, and a pattern still unbroken when its apex has passed has expired (null).
 * The "now" comparisons (failed / still holding the break) use the projected level at the last bar — the same level the
 * hit displays and measures its distance from.
 */
export interface StageWindows {
  /** a break more than this many bars after a past body end belongs to a later body end */
  lead: number;
  /** 'breakout' while the first close beyond the pivot is at most this many bars before the last bar */
  breakout: number;
  /** 'failed' only within this many bars of that first close */
  failed: number;
}
/** Daily windows: lead 3, breakout ≤ 4 bars ago (the last 5 sessions), failed within 40 sessions. */
export const DAILY_STAGE_WINDOWS: StageWindows = { lead: 3, breakout: 4, failed: 40 };
/** zzz992 — the stage windows of a timeframe: W / M → the breakout is this or the previous candle; failed within 8
 *  weeks / 2 months; lead 1 candle. */
export function stageWindowsFor(tf: PatternTimeframe): StageWindows {
  if (tf === 'D') return DAILY_STAGE_WINDOWS;
  const pf = TF_PROFILES[tf];
  return { lead: Math.max(1, Math.round(3 / pf.k)), breakout: 1, failed: Math.max(2, Math.round(40 / pf.k)) };
}

export function stageOf(s: Pick<S, 'n' | 'c'>, e: number, from: number, pivot: number, bull: boolean, lineAt?: (i: number) => number, expiry?: number, win: StageWindows = DAILY_STAGE_WINDOWS): { stage: PatternStage; f: number } | null {
  const last = s.n - 1;
  const cap = capOf(last, lineAt, expiry);
  const lv = (i: number) => (lineAt ? lineAt(Math.min(i, cap)) : pivot);
  const searchEnd = lineAt ? cap : last;
  let f = -1;
  for (let i = Math.max(0, from); i <= searchEnd; i++) if (bull ? s.c[i] > lv(i) : s.c[i] < lv(i)) { f = i; break; }
  if (f < 0) return e === last && searchEnd === last ? { stage: 'forming', f } : null;
  if (e < last && f > e + win.lead) return null;
  const since = last - f, cl = s.c[last], level = lv(last);
  if (bull ? cl < level * 0.925 : cl > level * 1.075) return since <= win.failed ? { stage: 'failed', f } : null;
  if (since <= win.breakout) return (bull ? cl >= level * 0.97 : cl <= level * 1.03) ? { stage: 'breakout', f } : { stage: 'forming', f };
  return null;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n >= 1 ? n.toFixed(2) : n.toPrecision(3);
}
const likelihoodOf = (c: number): PatternHit['likelihood'] => (c >= 0.75 ? 'very likely' : c >= 0.55 ? 'likely' : 'possible');
/** zzz992 — a length in bars of the timeframe as words: D '7 wk' / '8 days', W '12 wk', M '9 mo'; long = 'weeks' / 'months'. */
export function patternLengthWords(bars: number, tf: PatternTimeframe = 'D', long = false): string {
  if (tf === 'W') return `${bars} ${long ? (bars === 1 ? 'week' : 'weeks') : 'wk'}`;
  if (tf === 'M') return `${bars} ${long ? (bars === 1 ? 'month' : 'months') : 'mo'}`;
  return bars >= 10 ? `${Math.max(1, Math.round(bars / 5))} ${long ? 'weeks' : 'wk'}` : `${bars} days`;
}
const lenWords = (bars: number, tf?: PatternTimeframe) => patternLengthWords(bars, tf || 'D');
const lenNote = (bars: number, tf?: PatternTimeframe) => patternLengthWords(bars, tf || 'D', true);
const unitAgo = (n: number, tf: PatternTimeframe) => {
  const u = tf === 'W' ? 'week' : tf === 'M' ? 'month' : 'day';
  if (n === 0) return tf === 'W' ? 'this week' : tf === 'M' ? 'this month' : 'today';
  return `${n} ${u}${n === 1 ? '' : 's'} ago`;
};

export interface CleanedBars { bars: PBar[]; rejected: number; repaired: number }
/**
 * zzz990 (CP-10) — validated bars. Rejected: no bar, a non-finite time, a non-finite or non-positive close, an open / high /
 * low that is a non-finite NUMBER (Infinity, NaN), or a time not after the previous bar's. Repaired (counted): a missing or
 * non-positive open / high / low (from the close), a high / low that does not contain the open and close. Volume: anything
 * but a finite positive number stays NaN (missing — never zero evidence).
 */
export function cleanBars(bars: PBar[]): CleanedBars {
  const out: PBar[] = [];
  let lastT = -Infinity, rejected = 0, repaired = 0;
  const badNum = (x: unknown) => typeof x === 'number' && !Number.isFinite(x);
  for (const b of bars || []) {
    if (!b) { rejected++; continue; }
    const t = Number(b.t), c = Number(b.c);
    if (!Number.isFinite(t) || !Number.isFinite(c) || !(c > 0) || t <= lastT || badNum(b.o) || badNum(b.h) || badNum(b.l)) { rejected++; continue; }
    let h = Number(b.h), l = Number(b.l), o = Number(b.o);
    const v0 = Number(b.v);
    let fixed = false;
    if (!(o > 0)) { o = c; fixed = true; }
    if (!(h > 0)) { h = Math.max(o, c); fixed = true; }
    if (!(l > 0)) { l = Math.min(o, c); fixed = true; }
    if (h < Math.max(o, c) || l > Math.min(o, c)) fixed = true;
    h = Math.max(h, o, c); l = Math.min(l, o, c);
    if (fixed) repaired++;
    out.push({ t, o, h, l, c, v: Number.isFinite(v0) && v0 > 0 ? v0 : NaN });
    lastT = t;
  }
  return { bars: out, rejected, repaired };
}

/** All patterns found on the latest data, active (forming / breaking out) first then failed, strongest first within each;
 *  at most one hit per PatternId. Empty when nothing qualifies (confidence < 0.35 dropped) or there are too few bars. */
export function detectPatterns(bars: PBar[], opts?: DetectOptions): PatternHit[] {
  return analyzePatterns(bars, opts).hits;
}

export interface PatternAnalysis {
  hits: PatternHit[];
  /** bars left after validation (cleanBars) */
  usableBars: number; rejectedBars: number; repairedBars: number;
  /** share (0..1) of the analysed bars that carry usable volume */
  volumeCoverage: number;
  /** fewer than the timeframe's minimum history (PATTERN_MIN_HISTORY) usable bars: nothing was analysed — not "no pattern" */
  tooShort: boolean;
  /** whether the listing date was accepted for the IPO-base rule (given AND the history starts within a few days of it) */
  listingKnown: boolean;
  /** zzz992 — the analysis timeframe, the bars it needs, and the patterns that cannot be read on it */
  timeframe: PatternTimeframe;
  minBars: number;
  notApplicable: PatternId[];
  engineVersion: string;
  /** zzz1009 — only with opts.weak: the weaker candidates (see DetectOptions.weak), strongest first */
  weak?: PatternHit[];
  /** zzz1009 — only with opts.weak: qualifying shapes at the analysed body ends that are no longer current (PatternHit.expired),
   *  most recent break first; never the same structure as a hit */
  expired?: PatternHit[];
}

/** detectPatterns plus what the data allowed (validation counts, volume coverage, too-short history). */
export function analyzePatterns(bars: PBar[], opts?: DetectOptions): PatternAnalysis {
  const tf: PatternTimeframe = opts?.timeframe === 'W' || opts?.timeframe === 'M' ? opts.timeframe : 'D';
  const pf = TF_PROFILES[tf];
  const cleaned = cleanBars(bars);
  const all = cleaned.bars;
  const minBars = PATTERN_MIN_HISTORY[tf];
  const base = {
    usableBars: all.length, rejectedBars: cleaned.rejected, repairedBars: cleaned.repaired,
    timeframe: tf, minBars, notApplicable: PATTERN_IDS.filter((id) => !patternApplies(id, tf)), engineVersion: PATTERN_ENGINE_VERSION,
  };
  if (all.length < minBars) return { hits: [], ...base, volumeCoverage: 0, tooShort: true, listingKnown: false };
  // zzz990 (CP-03) — never infer the listing from the first bar; a given listing date counts only when the history covers it
  const ft = opts?.firstTradeT != null && Number.isFinite(Number(opts.firstTradeT)) ? Number(opts.firstTradeT) : null;
  const listT = ft != null && Math.abs(all[0].t - ft) <= LISTING_TOLERANCE_DAYS * DAY ? ft : null;
  const maxBars = tf === 'D' ? Math.max(60, Math.floor(opts?.maxBars ?? DEFAULT_MAX_BARS)) : Math.max(minBars, Math.floor(opts?.maxBars ?? pf.defaultMaxBars));
  const s = build(all.length > maxBars ? all.slice(-maxBars) : all, listT, pf);
  const last = s.n - 1;
  const win = stageWindowsFor(tf);

  // body ends: last 6 bars + the day before the first day of each recent breakout / breakdown burst
  // (W / M: the last 2 candles; a burst = a close beyond the prior 10 days' range → 3 candles, looked for in the last
  // 40 days → 8 weeks / 2 months; the earliest body end is at bar 25 days → 5 weeks / 3 months)
  const nEnds = tf === 'D' ? 6 : 2;
  const L10 = tf === 'D' ? 10 : Math.max(3, B(s, 10));
  const minE = Bm(s, 25);
  const ends = new Set<number>();
  for (let k = 0; k < nEnds && last - k >= minE; k++) ends.add(last - k);
  const isUp = (i: number) => i >= L10 + 1 && s.c[i] > s.mxH.val(i - L10, i - 1);
  const isDn = (i: number) => i >= L10 + 1 && s.c[i] < s.mnL.val(i - L10, i - 1);
  let nu = 0, nd = 0;
  for (let f = last; f >= Math.max(L10 + 2, last - Math.max(2, B(s, 40))); f--) {
    if (nu < 3 && isUp(f) && !isUp(f - 1)) { let first = true; for (let j = f - 1; j >= f - L10; j--) if (isUp(j)) { first = false; break; } if (first) { ends.add(f - 1); nu++; } }
    if (nd < 3 && isDn(f) && !isDn(f - 1)) { let first = true; for (let j = f - 1; j >= f - L10; j--) if (isDn(j)) { first = false; break; } if (first) { ends.add(f - 1); nd++; } }
  }

  // zzz1009 — `strong`: the raw shape score (before the breakout-volume bonus) reaches MIN_CONF; a strong candidate always beats a
  // weak one, so the qualifying hits are exactly what they were before weaker candidates were kept
  const best = new Map<PatternId, { raw: Raw; st: { stage: PatternStage; f: number }; strong: boolean }>();
  // zzz1009 — qualifying shapes that are no longer current (opts.weak only): the strongest per id
  const gone = new Map<PatternId, { raw: Raw; st: { stage: PatternStage; f: number }; why: ExpiredWhy }>();
  const noteExpired = (raw: Raw, st: { stage: PatternStage; f: number }, why: ExpiredWhy) => {
    const prev = gone.get(raw.id);
    if (!prev || raw.conf > prev.raw.conf + 1e-9) gone.set(raw.id, { raw: { ...raw }, st, why });
  };
  // zzz1008 — the 1-year high and low at the last bar (ranAwayFrom1y); per side, chosen by the pattern's bias below
  const yA = Math.max(0, last - B(s, 252) + 1);
  const yHi = s.mxH.idx(yA, last), yLo = s.mnL.idx(yA, last);
  // zzz1009 — opts.weak: also the body ends before older bursts (up to HISTORY_ENDS bars back), read ONLY for the expired list
  // ("last pattern: … broke out N months ago") — they never add or change a qualifying hit
  const hist = new Set<number>();
  if (opts?.weak) {
    let hu = 0, hd = 0;
    for (let f = last - Math.max(2, B(s, 40)) - 1; f >= Math.max(L10 + 2, last - HISTORY_ENDS[tf]); f--) {
      if (hu < 6 && isUp(f) && !isUp(f - 1)) { let first = true; for (let j = f - 1; j >= f - L10; j--) if (isUp(j)) { first = false; break; } if (first && !ends.has(f - 1)) { hist.add(f - 1); hu++; } }
      if (hd < 6 && isDn(f) && !isDn(f - 1)) { let first = true; for (let j = f - 1; j >= f - L10; j--) if (isDn(j)) { first = false; break; } if (first && !ends.has(f - 1)) { hist.add(f - 1); hd++; } }
    }
  }
  for (const e of [...ends, ...hist].sort((a, b) => b - a)) {
    if (e < minE) continue;
    const histOnly = hist.has(e);
    const raws = new Map<PatternId, Raw>();
    const atr = s.atrPct[e], sm = pf.swingMul;
    const zzS = zigzag(s.h, s.l, e - B(s, 330), e, Math.min(0.05 * sm, Math.max(0.025 * sm, 1.2 * atr)));
    const zzM = zigzag(s.h, s.l, e - B(s, 340), e, Math.min(0.08 * sm, Math.max(0.04 * sm, 2 * atr)));
    const recs = highRecords(s, e, B(s, 3), tf === 'M' ? LONG_BASE_MONTHS : B(s, 330));
    const floors = lowRecords(s, e, B(s, 4), B(s, 30));
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
      const st = stageOf(s, e, raw.keyFrom, raw.pivot, bull, raw.lineAt, raw.expiry, win);
      if (!st) {
        if (opts?.weak && raw.conf >= MIN_CONF) { const x = expiredWhy(s, e, raw, bull, win); if (x) noteExpired(raw, x.st, x.why); }
        continue;
      }
      if (histOnly) continue;
      // zzz1008 — a reversal the price has already run away from (at the 1-year high / low, made after the pattern) is not current
      if (PATTERN_META[raw.id].family === 'reversal' && raw.pts?.length && REVERSAL_IDS.has(raw.id)) {
        const lastTp = Math.max(...raw.pts.map((q) => q[0]));
        const lvl = raw.lineAt ? raw.lineAt(capOf(last, raw.lineAt, raw.expiry)) : raw.pivot;
        const yIdx1 = bull ? yHi : yLo, y1 = bull ? s.h[yHi] : s.l[yLo];
        if (ranAwayFrom1y(s.c[last], y1, yIdx1 > lastTp, lvl, bull)) { if (opts?.weak && raw.conf >= MIN_CONF) noteExpired(raw, st, 'ran-away'); continue; }
        if (y1 > 0) raw.ev = { ...(raw.ev || {}), hi1y: pc1(s.c[last] / y1) };
      }
      let conf = raw.conf;
      // breakout-volume bonus only with a real volume on the breakout day and a usable 50-day baseline
      if (st.stage === 'breakout' && st.f >= 0 && Number.isFinite(s.v[st.f]) && s.v[st.f] > 0) {
        const base50 = vol50(s, st.f - 1);
        if (Number.isFinite(base50) && base50 > 0 && s.v[st.f] >= 1.4 * base50) conf = Math.min(1, conf + 0.05);
      }
      if (st.stage === 'failed') conf *= 0.9;
      const strong = raw.conf >= MIN_CONF;
      const r2 = { ...raw, conf };
      const prev = best.get(raw.id);
      if (!prev || (strong && !prev.strong) || (strong === prev.strong && r2.conf > prev.raw.conf + 1e-9)) best.set(raw.id, { raw: r2, st, strong });
    }
  }

  const close = s.c[last];
  const hits: PatternHit[] = [];
  const weakHits: PatternHit[] = [];
  const goneHits: PatternHit[] = [];
  const toHit = (raw: Raw, st: { stage: PatternStage; f: number }, extra: Partial<PatternHit>): PatternHit | null => {
    const meta = PATTERN_META[raw.id];
    const bull = meta.bias === 'bullish';
    const conf = Math.round(raw.conf * 1000) / 1000;
    // zzz990 (CP-05) — a sloped boundary's level now: projected to the last bar (capped at its expiry)
    const cap = capOf(last, raw.lineAt, raw.expiry);
    const level = raw.lineAt ? raw.lineAt(cap) : raw.pivot;
    if (!(level > 0) || !Number.isFinite(level)) return null;
    const dist = (close / level - 1) * 100;
    // zzz990 (CP-04) — volume evidence over the pattern's span
    const spanA = Math.max(0, raw.start), spanLen = last - spanA + 1;
    const volCov = spanLen > 0 ? (s.pn[last + 1] - s.pn[spanA]) / spanLen : 0;
    const volumeOk = volCov >= 0.6 && Number.isFinite(avgVol(s, last - B(s, 10) + 1, last));
    const lengthBars = raw.end - raw.start + 1;
    const distWords = Math.abs(dist) < 0.5 ? 'close at the level' : `close ${Math.abs(dist).toFixed(0)}% ${dist < 0 ? 'below' : 'above'}`;
    // zzz1008 — a breakout whose close is back on the near side of the level keeps the event and says the current condition
    const back = st.stage === 'breakout' && (bull ? dist < 0 : dist > 0);
    const stageWords = st.stage === 'breakout' ? `; ${bull ? 'broke out' : 'broke down'} ${unitAgo(last - st.f, tf)}${back ? (bull ? ', back below the pivot' : ', back above the level') : ''}`
      : st.stage === 'failed' ? `; ${bull ? 'breakout' : 'breakdown'} failed` : '';
    const note = `${meta.label}${tf === 'W' ? ' (weekly)' : tf === 'M' ? ' (monthly)' : ''}, ${lenNote(lengthBars, tf)}${raw.depth != null ? `, ${Math.round(raw.depth * 100)}% deep` : ''}${raw.detail ? ` — ${raw.detail}` : ''}; ${bull ? 'pivot' : 'breakdown'} ${fmt(level)}, ${distWords}${stageWords}${volumeOk ? '' : '; volume not confirmed (no usable volume data)'}`;
    const lines = raw.lines.slice();
    if (!lines.some((x) => x.kind === 'pivot')) {
      if (raw.lineAt) {
        // the sloped boundary itself, from the pattern's key point to now (the same line the level is read from)
        const k0 = Math.max(raw.start, Math.min(raw.keyFrom, raw.end, cap));
        lines.unshift({ kind: 'pivot', points: [[s.t[k0], raw.lineAt(k0)], [s.t[cap], level]] });
      } else lines.unshift({ kind: 'pivot', points: [[s.t[raw.start], raw.pivot], [s.t[last], raw.pivot]] });
    }
    return {
      id: raw.id, label: meta.label, bias: meta.bias, family: meta.family,
      stage: st.stage, confidence: conf, likelihood: likelihoodOf(conf),
      startT: s.t[raw.start], endT: s.t[raw.end], lengthBars,
      depthPct: raw.depth != null ? Math.round(raw.depth * 1000) / 10 : null,
      pivot: Math.round(level * 10000) / 10000, distToPivotPct: Math.round(dist * 100) / 100,
      note, lines, volumeOk, timeframe: tf,
      ...(raw.pts?.length ? { points: raw.pts.filter(([i]) => i >= 0 && i < s.n).sort((a, b) => a[0] - b[0]).map(([i, p, role]) => ({ t: s.t[i], p, role })) } : {}),
      ...(raw.ev && Object.keys(raw.ev).length ? { evidence: raw.ev } : {}),
      ...(st.f >= 0 ? { breakT: s.t[st.f], breakAgo: last - st.f } : {}),
      ...extra,
    };
  };
  for (const { raw, st, strong } of best.values()) {
    if (!strong && !opts?.weak) continue;
    if (raw.conf < (strong ? MIN_CONF : WEAK_CONF)) continue;
    const h = toHit(raw, st, strong ? {} : { weak: true });
    if (h) (strong ? hits : weakHits).push(h);
  }
  for (const { raw, st, why } of gone.values()) {
    if (best.get(raw.id)?.strong) continue;
    const h = toHit(raw, st, { expired: why });
    if (h) goneHits.push(h);
  }
  const winA = Math.max(0, last - B(s, 60) + 1);
  const resolved = resolve(hits);
  return {
    hits: resolved, ...base, tooShort: false, listingKnown: listT != null,
    ...(opts?.weak ? { weak: weakerOf(weakHits, resolved), expired: expiredOf(goneHits, resolved) } : {}),
    volumeCoverage: Math.round(((s.pn[last + 1] - s.pn[winA]) / (last - winA + 1)) * 1000) / 1000,
  };
}

export interface DailyAsOptions extends Omit<DetectOptions, 'timeframe'> {
  /** analyse completed weeks / months only (default true); false includes the current period, marked provisional */
  completedOnly?: boolean;
  now?: Date;
}
export interface DailyAsAnalysis extends PatternAnalysis {
  /** the current, incomplete week / month is the last analysed bar (completedOnly = false) */
  provisional: boolean;
  /** time of the last daily bar inside the last analysed period, and of the latest daily bar supplied */
  periodEnd: number | null;
  latestT: number | null;
  /** an incomplete current period was left out */
  droppedProvisional: boolean;
  /** the bars that were analysed (daily as given, or the weekly / monthly aggregate) */
  bars: PBar[];
  /** zzz998 — DAILY bars supplied / rejected / repaired before the analysis (W / M: by the aggregation; D: by validation) */
  dailySupplied: number; dailyRejected: number; dailyRepaired: number;
}
/**
 * zzz992 — analyse DAILY bars on a timeframe: 'D' is analyzePatterns as is; 'W' / 'M' aggregate the daily history first
 * (lib/bar-aggregate: ISO weeks / calendar months, completed periods only unless completedOnly = false).
 */
export function analyzeDailyAs(daily: PBar[], tf: PatternTimeframe, opts?: DailyAsOptions): DailyAsAnalysis {
  const { completedOnly, now, ...rest } = opts || {};
  if (tf === 'D') {
    const r = analyzePatterns(daily, rest);
    const lastT = r.usableBars ? cleanBars(daily).bars.slice(-1)[0]?.t ?? null : null;
    return { ...r, provisional: false, periodEnd: lastT, latestT: lastT, droppedProvisional: false, bars: daily,
      dailySupplied: (daily || []).length, dailyRejected: r.rejectedBars, dailyRepaired: r.repairedBars };
  }
  const ag = aggregateBars(daily, tf, { completedOnly, now });
  const r = analyzePatterns(ag.bars, { ...rest, timeframe: tf });
  return { ...r, provisional: ag.provisional, periodEnd: ag.periodEnd, latestT: ag.latestT, droppedProvisional: ag.droppedProvisional, bars: ag.bars,
    dailySupplied: ag.supplied, dailyRejected: ag.rejected, dailyRepaired: ag.repaired };
}

/** Shapes that describe the same structure: keep only the strongest of each group. */
const EXCLUSIVE: PatternId[][] = [['bull_flag', 'bull_pennant'], ['cup', 'cup_handle', 'u_base'], ['double_bottom', 'triple_bottom'], ['double_top', 'triple_top']];
/** A forming bullish and a forming bearish reading of the same bars (e.g. a cup with handle is also two highs with a
 *  dip): the weaker reading is damped ×0.75 so the headline leads with the stronger and the other drops a level. */
const CONFLICT_DAMP = 0.75;

/** zzz1009 — weaker candidates: none that is the same structure as a qualifying hit (same id or exclusive group), at most one per
 *  exclusive group, strongest first. */
function weakerOf(weak: PatternHit[], qualifying: PatternHit[]): PatternHit[] {
  const grp = (id: PatternId) => EXCLUSIVE.find((g) => g.includes(id)) || [id];
  const taken = new Set<PatternId>(qualifying.flatMap((h) => grp(h.id)));
  const out: PatternHit[] = [];
  for (const h of weak.slice().sort((a, b) => b.confidence - a.confidence)) {
    if (taken.has(h.id)) continue;
    for (const id of grp(h.id)) taken.add(id);
    out.push(h);
  }
  return out;
}

/** zzz1009 — expired shapes: none that is the same structure as a qualifying hit; most recent break first (an unbroken apex last). */
function expiredOf(gone: PatternHit[], qualifying: PatternHit[]): PatternHit[] {
  const grp = (id: PatternId) => EXCLUSIVE.find((g) => g.includes(id)) || [id];
  const taken = new Set<PatternId>(qualifying.flatMap((h) => grp(h.id)));
  const out: PatternHit[] = [];
  for (const h of gone.slice().sort((a, b) => (a.breakAgo ?? 1e9) - (b.breakAgo ?? 1e9) || b.confidence - a.confidence)) {
    if (taken.has(h.id)) continue;
    for (const id of grp(h.id)) taken.add(id);
    out.push(h);
  }
  return out;
}

/** zzz1009 — why a shape that stageOf() rejects is no longer current, with the stage it last had (null: not this body end's to report). */
function expiredWhy(s: S, e: number, raw: Raw, bull: boolean, win: StageWindows): { why: ExpiredWhy; st: { stage: PatternStage; f: number } } | null {
  const last = s.n - 1;
  const cap = capOf(last, raw.lineAt, raw.expiry);
  const lv = (i: number) => (raw.lineAt ? raw.lineAt(Math.min(i, cap)) : raw.pivot);
  const searchEnd = raw.lineAt ? cap : last;
  let f = -1;
  for (let i = Math.max(0, raw.keyFrom); i <= searchEnd; i++) if (bull ? s.c[i] > lv(i) : s.c[i] < lv(i)) { f = i; break; }
  if (f < 0) return e === last && searchEnd < last ? { why: 'apex', st: { stage: 'forming', f } } : null;
  if (e < last && f > e + win.lead) return null;
  const cl = s.c[last], level = lv(last);
  if (bull ? cl < level * 0.925 : cl > level * 1.075) return { why: 'failed-old', st: { stage: 'failed', f } };
  if (last - f > win.breakout) return { why: 'completed', st: { stage: 'breakout', f } };
  return null;
}

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
  // zzz990 — active structures (forming / breaking out) first, failed ones after; strongest first within each
  const failed = (h: PatternHit) => (h.stage === 'failed' ? 1 : 0);
  out.sort((a, b) => failed(a) - failed(b) || b.confidence - a.confidence || (a.stage === 'breakout' ? -1 : b.stage === 'breakout' ? 1 : 0));
  return out;
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** The one-line chart headline: e.g. 'Very likely forming: Cup with handle (bullish, 7 wk, pivot 512.40, 3% below) · also likely: VCP' or 'No clear chart pattern'. */
export function patternHeadline(hits: PatternHit[], fmtPrice?: (n: number) => string): string {
  if (!hits || hits.length === 0) return 'No clear chart pattern';
  const fp = fmtPrice || fmt;
  const [top, ...rest] = hits;
  const bull = top.bias === 'bullish';
  const back = top.stage === 'breakout' && top.distToPivotPct != null && (bull ? top.distToPivotPct < 0 : top.distToPivotPct > 0);   // zzz1008
  const verb = top.stage === 'forming' ? 'forming' : top.stage === 'breakout' ? (back ? (bull ? 'broke out, back below the pivot' : 'broke down, back above the level') : bull ? 'breaking out' : 'breaking down') : (bull ? 'failed breakout' : 'failed breakdown');
  const lead = top.likelihood === 'possible' ? 'Possibly' : cap(top.likelihood);
  const parts: string[] = [top.bias, lenWords(top.lengthBars, top.timeframe)];
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
    // zzz1008 — the auditable geometry (only when the hit carries it)
    ...(h.points?.length ? { pts: h.points.map((q) => [new Date(q.t).toISOString().slice(0, 10), Number(q.p.toPrecision(4)), q.role] as [string, number, PointRole]) } : {}),
    ...(h.evidence && Object.keys(h.evidence).length ? { ev: h.evidence } : {}),
  }));
}
