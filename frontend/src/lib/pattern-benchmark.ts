// zzz1045e — a BLIND benchmark harness for the chart-pattern engine (lib/chart-patterns.ts). Pure: bars come in through a loader.
//
// Why: a pattern's shape score is NOT a calibrated probability. The only honest measure of quality is a set of labelled examples —
// real positives AND hard negatives (shapes that look close but are not the pattern), per pattern, market and timeframe — run blind
// through the same engine call the screener uses (analyzeDailyAs: daily bars, aggregated to W / M), truncated at the example's date so
// the engine never sees the future. This reports, per pattern / market / timeframe:
//   • true positives, false positives (said "pattern" on a hard negative), misses (said nothing on a positive), true negatives;
//   • precision = TP ÷ (TP + FP), recall = TP ÷ (TP + misses) — null when there is nothing to divide;
//   • stale detections: the engine named the pattern, but its structure ended long before the example's date (more than
//     `staleBars` bars of that timeframe) — an old shape still being reported as current;
//   • disagreement: the same ticker / date / pattern labelled both positive and negative (by different people) — left out of the
//     counts and listed, so a doubtful example never moves the score.
//
// HOW THE OWNER ADDS REAL EXAMPLES
//   1. Make a JSON file (e.g. data/pattern-benchmark/my-labels.json) holding an array of examples:
//        { "ticker": "AZAD", "market": "IN", "tf": "W", "asOf": "2026-08-14", "pattern": "flat_base", "label": "positive",
//          "note": "7-week flat base, 12% deep, pivot 1,690", "labeller": "rishi",
//          "bars": { "file": "src/lib/__tests__/fixtures/stage-daily-hal-avav.json", "ticker": "AZAD" } }
//      • asOf = the last day the engine may see (the day you judged the chart);
//      • label "positive" = the pattern IS there on that date; "negative" = it is NOT (best: a hard negative — a near miss);
//      • bars: either { file, ticker } pointing at a closes file in the stage-daily fixture format ({ tickers: { T: { d0, dd[], c[] } } },
//        day numbers since 1970 — the /api/v1/chart route output saved as JSON), or { file, ticker } of an OHLCV file
//        ({ tickers: { T: [{ t, o, h, l, c, v }] } }), or inline "ohlcv": [...] bars. Daily bars always; W / M are built from them.
//   2. Run:  cd frontend && node --import tsx scripts/pattern-benchmark.mjs data/pattern-benchmark/my-labels.json
//      (no file = the seed set below, which only proves the harness works).
//   3. Label BEFORE looking at what the engine says (blind), and keep hard negatives at least as many as positives.
//
// The seed set (SEED_EXAMPLES) is SYNTHETIC — textbook shapes drawn by a generator, the same shapes the engine's unit tests use. It
// checks the harness and catches regressions; it is NOT a benchmark of real-market quality and its numbers must not be quoted as one.
import { analyzeDailyAs, PATTERN_IDS, type PBar, type PatternHit, type PatternId, type PatternTimeframe } from './chart-patterns';

export type BenchMarket = 'US' | 'IN';
export type BenchLabel = 'positive' | 'negative';
export type BarSource =
  | { synthetic: SynthSpec }
  | { file: string; ticker: string }
  | { ohlcv: PBar[] };
export interface BenchExample {
  ticker: string; market: BenchMarket; tf: PatternTimeframe;
  /** last day the engine may see, YYYY-MM-DD (bars after it are dropped) */
  asOf: string;
  pattern: PatternId; label: BenchLabel; note: string;
  labeller?: string;
  /** true for generated / seed examples (never a real-market label) */
  synthetic?: boolean;
  bars: BarSource;
}
/** A generated price path: legs of [days, target price, 'lin' | 'ease'], seeded noise, weekdays only (as in the engine's unit tests). */
export interface SynthSpec { legs: Array<[number, number, ('lin' | 'ease')?]>; start?: number; seed?: number; noise?: number; spread?: number; history?: number; t0?: string; fadeLast?: number }

export interface ExampleResult {
  ex: BenchExample;
  detected: boolean;
  hit: Pick<PatternHit, 'id' | 'stage' | 'confidence' | 'endT'> | null;
  stale: boolean;
  outcome: 'TP' | 'FP' | 'FN' | 'TN' | 'disputed' | 'no-bars';
  why?: string;
}
export interface BenchCell { pattern: PatternId; market: BenchMarket; tf: PatternTimeframe; tp: number; fp: number; fn: number; tn: number; stale: number; precision: number | null; recall: number | null }
export interface BenchReport { cells: BenchCell[]; totals: Omit<BenchCell, 'pattern' | 'market' | 'tf'>; results: ExampleResult[]; disputed: string[]; noBars: string[]; synthetic: boolean }
export interface BenchOptions { /** minimum engine confidence for a "detected" (default: whatever the engine returns as a hit) */ minConf?: number; /** bars of the timeframe after which a hit's structure is stale (default 20) */ staleBars?: number }

const DAY = 86_400_000;
const TF_DAYS: Record<PatternTimeframe, number> = { D: 1.4, W: 7, M: 30.4 };   // calendar days per bar (D: weekdays)

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
/** Pure: daily bars for a synthetic spec (same generator as src/lib/__tests__/zzz981-chart-patterns.test.ts). */
export function synthBars(spec: SynthSpec): PBar[] {
  const r = rng(spec.seed ?? 7);
  const noise = spec.noise ?? 0.003, spread = spec.spread ?? 0.005;
  const path: number[] = new Array((spec.history ?? 300) + 1).fill(spec.start ?? spec.legs[0][1]);
  for (const [d, to, shape] of spec.legs) {
    const from = path[path.length - 1];
    for (let k = 1; k <= d; k++) { const x = k / d; path.push(from + (to - from) * (shape === 'ease' ? (1 - Math.cos(Math.PI * x)) / 2 : x)); }
  }
  const n = path.length, fade = spec.fadeLast ?? 0;
  const bars: PBar[] = [];
  let t = spec.t0 ? Date.parse(spec.t0) : Date.UTC(2023, 0, 2);
  let prevC = path[0];
  for (let i = 0; i < n; i++) {
    const c = path[i] * (1 + (r() - 0.5) * 2 * noise);
    const o = prevC;
    const h = Math.max(o, c) * (1 + spread * (0.3 + 0.7 * r()));
    const l = Math.min(o, c) * (1 - spread * (0.3 + 0.7 * r()));
    const v = fade && i >= n - fade ? 1_000_000 * (1 - 0.55 * ((i - (n - fade)) / fade)) : 1_000_000 * (0.8 + 0.4 * r());
    bars.push({ t, o, h, l, c, v });
    prevC = c;
    t += DAY;
    while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY;
  }
  return bars;
}
/** Pure: bars from the closes-only fixture format ({ d0, dd[], c[] }: day numbers d0 + running sum of dd). Open = previous close,
 *  high / low = the larger / smaller of open and close, volume unknown (NaN — volume rules get no credit). */
export function barsFromCloses(x: { d0: number; dd: number[]; c: number[] }): PBar[] {
  const out: PBar[] = [];
  let d = x.d0;
  for (let i = 0; i < x.c.length; i++) {
    if (i > 0) d += x.dd[i - 1] ?? x.dd[i] ?? 1;
    const c = x.c[i], o = i ? x.c[i - 1] : c;
    out.push({ t: d * DAY, o, h: Math.max(o, c), l: Math.min(o, c), c, v: NaN });
  }
  return out;
}
/** Pure: the bars up to and including `asOf` (end of that day, UTC). */
export function truncateAt(bars: readonly PBar[], asOf: string): PBar[] {
  const end = Date.parse(asOf) + DAY - 1;
  return bars.filter((b) => b.t <= end);
}

const keyOf = (e: Pick<BenchExample, 'ticker' | 'market' | 'tf' | 'asOf' | 'pattern'>) => `${e.market}:${e.ticker}:${e.tf}:${e.asOf}:${e.pattern}`;
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** Runs every example blind through the engine and scores it. `load` gives an example's daily bars (null = not available). */
export function runBenchmark(examples: readonly BenchExample[], load: (ex: BenchExample) => PBar[] | null, opts: BenchOptions = {}): BenchReport {
  const staleBars = opts.staleBars ?? 20;
  // disagreement: one ticker / date / pattern labelled both ways
  const labels = new Map<string, Set<BenchLabel>>();
  for (const e of examples) (labels.get(keyOf(e)) || labels.set(keyOf(e), new Set()).get(keyOf(e))!).add(e.label);
  const disputed = Array.from(labels.entries()).filter(([, s]) => s.size > 1).map(([k]) => k);
  const disputedSet = new Set(disputed);
  const results: ExampleResult[] = [];
  const cells = new Map<string, BenchCell>();
  const cellOf = (e: BenchExample) => {
    const k = `${e.pattern}|${e.market}|${e.tf}`;
    return cells.get(k) || cells.set(k, { pattern: e.pattern, market: e.market, tf: e.tf, tp: 0, fp: 0, fn: 0, tn: 0, stale: 0, precision: null, recall: null }).get(k)!;
  };
  const noBars: string[] = [];
  for (const ex of examples) {
    if (!PATTERN_IDS.includes(ex.pattern)) { results.push({ ex, detected: false, hit: null, stale: false, outcome: 'no-bars', why: `unknown pattern id ${ex.pattern}` }); noBars.push(keyOf(ex)); continue; }
    if (disputedSet.has(keyOf(ex))) {
      results.push({ ex, detected: false, hit: null, stale: false, outcome: 'disputed', why: 'labelled both positive and negative — left out' });
      continue;
    }
    const all = load(ex);
    const bars = all ? truncateAt(all, ex.asOf) : [];
    if (!bars.length) { results.push({ ex, detected: false, hit: null, stale: false, outcome: 'no-bars', why: 'no bars on or before asOf' }); noBars.push(keyOf(ex)); continue; }
    const a = analyzeDailyAs(bars, ex.tf, { completedOnly: true, now: new Date(Date.parse(ex.asOf) + DAY - 1) });
    const h = a.hits.find((x) => x.id === ex.pattern && (opts.minConf == null || x.confidence >= opts.minConf)) || null;
    const lastT = bars[bars.length - 1].t;
    const stale = !!h && (lastT - h.endT) / DAY > staleBars * TF_DAYS[ex.tf];
    const c = cellOf(ex);
    const outcome: ExampleResult['outcome'] = ex.label === 'positive' ? (h ? 'TP' : 'FN') : (h ? 'FP' : 'TN');
    if (outcome === 'TP') c.tp++; else if (outcome === 'FN') c.fn++; else if (outcome === 'FP') c.fp++; else c.tn++;
    if (stale) c.stale++;
    results.push({ ex, detected: !!h, hit: h ? { id: h.id, stage: h.stage, confidence: h.confidence, endT: h.endT } : null, stale, outcome,
      ...(a.tooShort ? { why: `history too short for ${ex.tf} (${a.usableBars} of ${a.minBars} bars)` } : {}) });
  }
  const out = Array.from(cells.values()).sort((x, y) => x.pattern.localeCompare(y.pattern) || x.market.localeCompare(y.market) || x.tf.localeCompare(y.tf));
  for (const c of out) { c.precision = ratio(c.tp, c.tp + c.fp); c.recall = ratio(c.tp, c.tp + c.fn); }
  const tot = out.reduce((a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn, tn: a.tn + c.tn, stale: a.stale + c.stale }), { tp: 0, fp: 0, fn: 0, tn: 0, stale: 0 });
  return { cells: out, totals: { ...tot, precision: ratio(tot.tp, tot.tp + tot.fp), recall: ratio(tot.tp, tot.tp + tot.fn) }, results, disputed, noBars, synthetic: examples.length > 0 && examples.every((e) => e.synthetic) };
}

/** Pure: the report as a plain-text table. */
export function benchTable(r: BenchReport): string {
  const pct = (v: number | null) => (v == null ? '  —  ' : `${(v * 100).toFixed(0).padStart(4)}%`);
  const lines = ['pattern              mkt tf   TP  FP miss  TN stale  precision recall'];
  for (const c of r.cells) lines.push(`${c.pattern.padEnd(20)} ${c.market.padEnd(3)} ${c.tf.padEnd(2)} ${String(c.tp).padStart(4)} ${String(c.fp).padStart(3)} ${String(c.fn).padStart(4)} ${String(c.tn).padStart(3)} ${String(c.stale).padStart(5)}  ${pct(c.precision)}     ${pct(c.recall)}`);
  const t = r.totals;
  lines.push(`${'ALL'.padEnd(27)} ${String(t.tp).padStart(4)} ${String(t.fp).padStart(3)} ${String(t.fn).padStart(4)} ${String(t.tn).padStart(3)} ${String(t.stale).padStart(5)}  ${pct(t.precision)}     ${pct(t.recall)}`);
  if (r.disputed.length) lines.push(`disputed (labelled both ways, left out): ${r.disputed.join(', ')}`);
  if (r.noBars.length) lines.push(`no bars / unknown pattern: ${r.noBars.join(', ')}`);
  for (const x of r.results) if (x.outcome === 'FP' || x.outcome === 'FN' || x.stale) lines.push(`  ${x.outcome}${x.stale ? ' (stale)' : ''} ${keyOf(x.ex)} — ${x.ex.note}${x.hit ? ` · engine: ${x.hit.stage}, confidence ${x.hit.confidence}` : ''}${x.why ? ` · ${x.why}` : ''}`);
  if (r.synthetic) lines.push('NOTE: every example is SYNTHETIC (seed set) — this checks the harness, it is not a measure of real-market pattern quality.');
  return lines.join('\n');
}

// ── seed set: synthetic textbook shapes and hard negatives (from the engine's unit tests) ──────────────────────────────────
const RISE: SynthSpec['legs'] = [[60, 60], [120, 100]];
const syn = (ticker: string, pattern: PatternId, label: BenchLabel, note: string, spec: SynthSpec): BenchExample =>
  ({ ticker, market: 'US', tf: 'D', asOf: '2030-01-01', pattern, label, note: `SYNTHETIC — ${note}`, labeller: 'seed', synthetic: true, bars: { synthetic: spec } });
/** SYNTHETIC seed examples — prove the harness runs; NOT a real benchmark. */
export const SEED_EXAMPLES: readonly BenchExample[] = [
  syn('SYN-CUPH', 'cup_handle', 'positive', 'cup 25% deep with a shallow handle on fading volume', { legs: [...RISE, [50, 75, 'ease'], [12, 75], [50, 98, 'ease'], [12, 92], [4, 94.5]], fadeLast: 16 }),
  syn('SYN-FLAT', 'flat_base', 'positive', '7-week flat base under 10% deep after a rise', { legs: [...RISE, [6, 93], [6, 99], [6, 94], [6, 98.5], [5, 95], [5, 98], [4, 96.5]], fadeLast: 10 }),
  syn('SYN-CUP', 'cup', 'positive', 'cup, right side back near the left high, no handle', { legs: [...RISE, [50, 75, 'ease'], [12, 75], [55, 97, 'ease']] }),
  syn('SYN-V', 'cup', 'negative', 'hard negative: a V-shaped bottom (straight down, straight up) is not a cup', { legs: [...RISE, [40, 75], [40, 98], [10, 93], [3, 95]] }),
  syn('SYN-V', 'cup_handle', 'negative', 'hard negative: V bottom with a dip — not a cup with handle', { legs: [...RISE, [40, 75], [40, 98], [10, 93], [3, 95]] }),
  syn('SYN-DOWN', 'flat_base', 'negative', 'hard negative: a steady 60% downtrend has no flat base', { legs: [[300, 100], [300, 40]], start: 100, noise: 0.004 }),
];
/** Loader for the seed set (synthetic and inline bars only). */
export function seedLoader(ex: BenchExample): PBar[] | null {
  if ('synthetic' in ex.bars) return synthBars(ex.bars.synthetic);
  if ('ohlcv' in ex.bars) return ex.bars.ohlcv;
  return null;
}
