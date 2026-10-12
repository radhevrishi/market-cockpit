import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns, patternHeadline, toTags, zigzag, PATTERN_IDS, PATTERN_META, type PBar, type PatternHit, type PatternId } from '../chart-patterns';

// ───────── synthetic bar generator ─────────
// A path is a list of legs: [days, target price, shape]. 'lin' = straight line, 'ease' = cosine ease in/out (rounded
// turns, used for cups / saucers). Small seeded noise; highs / lows a little outside open / close; weekdays only.
type Leg = [number, number, ('lin' | 'ease')?];
interface GenOpt { start?: number; seed?: number; noise?: number; spread?: number; vol?: (i: number, n: number) => number; t0?: number; history?: number }

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
function gen(legs: Leg[], opt: GenOpt = {}): PBar[] {
  const r = rng(opt.seed ?? 7);
  const noise = opt.noise ?? 0.003, spread = opt.spread ?? 0.005;
  // a quiet history first (default 300 bars) so the engine does not take the series for a recent listing
  const path: number[] = new Array((opt.history ?? 300) + 1).fill(opt.start ?? legs[0][1]);
  for (const [d, to, shape] of legs) {
    const from = path[path.length - 1];
    for (let k = 1; k <= d; k++) {
      const x = k / d;
      const f = shape === 'ease' ? (1 - Math.cos(Math.PI * x)) / 2 : x;
      path.push(from + (to - from) * f);
    }
  }
  const n = path.length;
  const bars: PBar[] = [];
  let t = opt.t0 ?? Date.UTC(2023, 0, 2);
  let prevC = path[0];
  for (let i = 0; i < n; i++) {
    const c = path[i] * (1 + (r() - 0.5) * 2 * noise);
    const o = prevC;
    const h = Math.max(o, c) * (1 + spread * (0.3 + 0.7 * r()));
    const l = Math.min(o, c) * (1 - spread * (0.3 + 0.7 * r()));
    const v = opt.vol ? opt.vol(i, n) : 1_000_000 * (0.8 + 0.4 * r());
    bars.push({ t, o, h, l, c, v });
    prevC = c;
    t += 86_400_000;
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  }
  return bars;
}
/** Volume that fades to `endFrac` over the last `k` bars. */
const fadeVol = (k: number, endFrac = 0.45) => (i: number, n: number) => (i < n - k ? 1_000_000 : 1_000_000 * (1 - (1 - endFrac) * ((i - (n - k)) / k)));

const ids = (hits: PatternHit[]) => hits.map((h) => h.id);
const hitOf = (hits: PatternHit[], id: PatternId) => hits.find((h) => h.id === id);
function expectHit(bars: PBar[], id: PatternId, check?: (h: PatternHit) => void, opts?: Parameters<typeof detectPatterns>[1], minConf = 0.55) {
  const hits = detectPatterns(bars, opts);
  const h = hitOf(hits, id);
  assert.ok(h, `${id} not found; got ${hits.map((x) => `${x.id}:${x.confidence}`).join(', ') || 'nothing'}`);
  assert.ok(h.confidence >= minConf && h.confidence <= 1, `${id} confidence ${h.confidence}`); // textbook shapes: at least 'likely'
  assert.equal(h.bias, PATTERN_META[id].bias);
  check?.(h);
  return { hits, h };
}
const near = (x: number | null, target: number, tol: number) => x != null && Math.abs(x / target - 1) <= tol;

// uptrend lead-in used by bullish bases: 60 → 100 over 120 days after a quiet stretch
const RISE: Leg[] = [[60, 60], [120, 100]];
const FALL: Leg[] = [[60, 100], [60, 70]];

// ───────── metadata / contract ─────────

test('zzz981 metadata: 22 ids, every id has meta with matching id, groups and short text', () => {
  assert.equal(PATTERN_IDS.length, 22);
  for (const id of PATTERN_IDS) {
    const m = PATTERN_META[id];
    assert.equal(m.id, id);
    assert.ok(m.label && m.group && m.short.length > 20);
  }
  assert.equal(PATTERN_META.cup_handle.group, PATTERN_META.u_base.group);
  assert.equal(PATTERN_META.double_top.bias, 'bearish');
  assert.equal(PATTERN_IDS.filter((id) => PATTERN_META[id].bias === 'bearish').length, 6);
});

test('zzz981 zigzag: alternating swings with the running extreme last', () => {
  const b = gen([[10, 100], [10, 80], [10, 95], [10, 85]], { start: 100, noise: 0, history: 0 });
  const z = zigzag(b.map((x) => x.h), b.map((x) => x.l), 0, b.length - 1, 0.05);
  for (let k = 1; k < z.length; k++) assert.notEqual(z[k].hi, z[k - 1].hi);
  assert.equal(z[z.length - 1].confirmed, false);
  const lows = z.filter((q) => !q.hi).map((q) => Math.round(q.p));
  assert.ok(lows.some((p) => p >= 78 && p <= 80), JSON.stringify(z));
});

// ───────── bullish bases ─────────

test('zzz981 cup with handle: forming, pivot at the handle high', () => {
  const b = gen([...RISE, [50, 75, 'ease'], [12, 75], [50, 98, 'ease'], [12, 92], [4, 94.5]], { vol: fadeVol(16) });
  const { h } = expectHit(b, 'cup_handle', (x) => {
    assert.equal(x.stage, 'forming');
    assert.ok(near(x.pivot, 98.5, 0.02), String(x.pivot));
    assert.ok(x.depthPct! >= 20 && x.depthPct! <= 30, String(x.depthPct));
    assert.ok(x.distToPivotPct! < 0);
    assert.match(x.note, /^Cup with handle, \d+ weeks, \d+% deep — handle \d+% deep; pivot [\d.]+, close \d+% below$/);
  });
  assert.ok(h.likelihood !== 'possible', `${h.confidence}`);
});

test('zzz981 cup with handle: breakout stage when the last close clears the handle high', () => {
  const b = gen([...RISE, [50, 75, 'ease'], [12, 75], [50, 98, 'ease'], [12, 92], [4, 95], [2, 101]]);
  expectHit(b, 'cup_handle', (x) => { assert.equal(x.stage, 'breakout'); assert.ok(x.distToPivotPct! > 0); assert.match(x.note, /broke out/); });
});

test('zzz981 cup with handle: failed when it broke out and fell back > 7.5% below the pivot', () => {
  const b = gen([...RISE, [50, 75, 'ease'], [12, 75], [50, 98, 'ease'], [12, 92], [4, 95], [3, 102], [8, 89]]);
  expectHit(b, 'cup_handle', (x) => assert.equal(x.stage, 'failed'));
});

test('zzz981 cup (no handle): right side back near the left high, pivot = left high', () => {
  const b = gen([...RISE, [50, 75, 'ease'], [12, 75], [55, 97, 'ease']]);
  expectHit(b, 'cup', (x) => { assert.equal(x.stage, 'forming'); assert.ok(near(x.pivot, 100.5, 0.02), String(x.pivot)); });
});

test('zzz981 V-shaped bottom is not a cup, cup with handle or U base', () => {
  const b = gen([...RISE, [40, 75], [40, 98], [10, 93], [3, 95]]);
  const got = ids(detectPatterns(b));
  for (const id of ['cup', 'cup_handle', 'u_base'] as PatternId[]) assert.ok(!got.includes(id), got.join(','));
});

test('zzz981 flat base: 7 weeks, < 10% deep, after a rise', () => {
  const b = gen([...RISE, [6, 93], [6, 99], [6, 94], [6, 98.5], [5, 95], [5, 98], [4, 96.5]], { vol: fadeVol(10) });
  expectHit(b, 'flat_base', (x) => {
    assert.equal(x.stage, 'forming');
    assert.ok(near(x.pivot, 100.5, 0.02));
    assert.ok(x.depthPct! < 10);
    assert.ok(x.lengthBars >= 35);
    assert.equal(x.likelihood, 'very likely');
  });
});

test('zzz981 U base: shallow rounded saucer (too shallow for a cup)', () => {
  const b = gen([...RISE, [35, 90, 'ease'], [10, 90], [35, 99, 'ease']]);
  expectHit(b, 'u_base', (x) => assert.ok(x.depthPct! >= 8 && x.depthPct! < 12.5, String(x.depthPct)));
});

test('zzz981 ascending base: three 13–15% pullbacks with higher highs and higher lows', () => {
  const b = gen([...RISE, [12, 85], [12, 106], [10, 92], [12, 112], [10, 97], [8, 107]]);
  expectHit(b, 'ascending_base', (x) => { assert.equal(x.stage, 'forming'); assert.ok(near(x.pivot, 112.5, 0.02), String(x.pivot)); });
});

test('zzz981 VCP: 20% → 10% → 5% contractions, volume drying up, pivot = last contraction high', () => {
  const b = gen([[40, 50], [100, 100], [15, 80], [13, 97], [10, 87], [8, 95], [6, 90.5], [5, 93.5]], { vol: (i, n) => (i < n - 60 ? 1_000_000 : 1_000_000 * (1 - 0.6 * ((i - (n - 60)) / 60))) });
  expectHit(b, 'vcp', (x) => {
    assert.equal(x.stage, 'forming');
    assert.ok(near(x.pivot, 95.4, 0.02), String(x.pivot));
    assert.match(x.note, /3 contractions \d+% → \d+% → \d+%/);
  });
});

test('zzz981 base on base: new base just above an earlier base whose breakout gained < 20%', () => {
  const b = gen([[40, 50], [80, 80], [8, 74], [8, 79], [8, 73], [8, 79.5], [8, 75], [8, 79], [10, 90], [8, 84], [8, 89], [8, 83], [8, 88]]);
  expectHit(b, 'base_on_base', (x) => { assert.equal(x.stage, 'forming'); assert.ok(near(x.pivot, 90.5, 0.02), String(x.pivot)); });
});

test('zzz981 IPO base: short history from listing, correction from the post-listing high', () => {
  const b = gen([[40, 80], [15, 62], [15, 74]], { start: 50, history: 0 });
  expectHit(b, 'ipo_base', (x) => { assert.ok(near(x.pivot, 80.5, 0.02)); assert.ok(x.depthPct! > 18 && x.depthPct! < 28); });
  // long history with an explicit listing date far in the past → no IPO base
  const long = gen([[600, 60], [40, 80], [15, 62], [15, 74]], { start: 50, history: 0 });
  assert.ok(!ids(detectPatterns(long, { firstTradeT: long[0].t })).includes('ipo_base'));
  // ... but a recent listing date makes it one
  expectHit(long, 'ipo_base', undefined, { firstTradeT: long[long.length - 75].t });
});

// ───────── continuation ─────────

test('zzz981 bull flag: 25% pole in 10 days then a tight parallel drift down', () => {
  const b = gen([[60, 60], [10, 75], [3, 72.5], [2, 74], [3, 71.5], [2, 73], [3, 70.5]], { vol: fadeVol(13, 0.5) });
  expectHit(b, 'bull_flag', (x) => { assert.equal(x.stage, 'forming'); assert.ok(x.pivot! < 76 && x.pivot! > 70, String(x.pivot)); });
});

test('zzz981 bull pennant: pole then converging range', () => {
  const b = gen([[60, 60], [10, 75], [3, 70], [3, 74], [3, 71], [3, 73.2], [2, 72]], { noise: 0.001, spread: 0.003 });
  expectHit(b, 'bull_pennant', (x) => assert.equal(x.stage, 'forming'));
});

test('zzz981 high tight flag: +110% in 7 weeks then a 15% flag', () => {
  const b = gen([[60, 40], [35, 85], [9, 72], [9, 78]], { vol: fadeVol(18, 0.5) });
  const { hits } = expectHit(b, 'high_tight_flag', (x) => { assert.ok(near(x.pivot, 85.5, 0.02)); assert.ok(x.confidence >= 0.75, String(x.confidence)); });
  assert.ok(!ids(hits).includes('bull_flag'));
});

test('zzz981 ascending triangle: flat ceiling touched 3 times, rising lows', () => {
  const b = gen([...RISE, [8, 85], [8, 100], [8, 90], [8, 100], [8, 94.5], [6, 98.8]]);
  expectHit(b, 'ascending_triangle', (x) => { assert.equal(x.stage, 'forming'); assert.ok(near(x.pivot, 100.4, 0.015), String(x.pivot)); });
});

test('zzz981 bear flag: sharp drop then a drift up', () => {
  const b = gen([[60, 100], [40, 95], [8, 78], [3, 80.5], [2, 79], [3, 81.5], [2, 80], [3, 82]]);
  expectHit(b, 'bear_flag', (x) => { assert.equal(x.stage, 'forming'); assert.ok(x.pivot! < 81, String(x.pivot)); });
});

test('zzz981 descending triangle: flat floor, falling highs', () => {
  const b = gen([[60, 90], [30, 100], [8, 80], [8, 93], [8, 80.3], [8, 88], [8, 80.1], [6, 84]]);
  expectHit(b, 'descending_triangle', (x) => { assert.equal(x.stage, 'forming'); assert.ok(near(x.pivot, 79.6, 0.015), String(x.pivot)); });
});

// ───────── reversals ─────────

test('zzz981 double bottom: two lows near 70 after a 30% fall, pivot = middle peak', () => {
  const b = gen([...FALL, [15, 82], [15, 70.5], [10, 77]]);
  expectHit(b, 'double_bottom', (x) => { assert.equal(x.stage, 'forming'); assert.ok(near(x.pivot, 82.4, 0.02), String(x.pivot)); });
});

test('zzz981 double bottom: breakout above the middle peak', () => {
  const b = gen([...FALL, [15, 82], [15, 70.5], [12, 81], [2, 84]]);
  expectHit(b, 'double_bottom', (x) => assert.equal(x.stage, 'breakout'));
});

test('zzz981 triple bottom: three lows within 1%, takes priority over double bottom', () => {
  const b = gen([...FALL, [12, 80], [12, 70.5], [12, 79], [12, 69.8], [8, 75]]);
  const { hits } = expectHit(b, 'triple_bottom', (x) => assert.ok(near(x.pivot, 80.4, 0.02), String(x.pivot)));
  assert.ok(!ids(hits).includes('double_bottom'));
});

test('zzz981 inverse head & shoulders: neckline buy point', () => {
  const b = gen([[60, 100], [40, 75], [12, 85], [14, 68], [14, 85.5], [12, 76], [8, 80]]);
  expectHit(b, 'inverse_hs', (x) => { assert.equal(x.stage, 'forming'); assert.ok(near(x.pivot, 85.5, 0.03), String(x.pivot)); });
});

test('zzz981 falling wedge: falling highs faster than falling lows', () => {
  const b = gen([[60, 110], [20, 100], [8, 86], [7, 93], [8, 82], [7, 87.5], [7, 79], [6, 83.5], [6, 77], [3, 80]]);
  expectHit(b, 'falling_wedge', (x) => assert.equal(x.stage, 'forming'));
});

test('zzz981 double top after a rise; breakdown = the middle trough', () => {
  const b = gen([...RISE, [12, 88], [12, 99.5], [8, 94]]);
  expectHit(b, 'double_top', (x) => { assert.equal(x.stage, 'forming'); assert.ok(near(x.pivot, 87.6, 0.02), String(x.pivot)); assert.ok(x.distToPivotPct! > 0); assert.match(x.note, /breakdown/); });
});

test('zzz981 triple top', () => {
  const b = gen([...RISE, [12, 88], [12, 99.5], [12, 89], [12, 100.3], [8, 95]]);
  const { hits } = expectHit(b, 'triple_top');
  assert.ok(!ids(hits).includes('double_top'));
});

test('zzz981 head & shoulders top: neckline breakdown level', () => {
  const b = gen([[60, 60], [60, 90], [10, 82], [12, 100], [12, 82.5], [10, 90.5], [6, 86]]);
  expectHit(b, 'head_shoulders', (x) => { assert.equal(x.stage, 'forming'); assert.ok(near(x.pivot, 82, 0.03), String(x.pivot)); });
});

test('zzz981 head & shoulders top: breakdown stage below the neckline', () => {
  const b = gen([[60, 60], [60, 90], [10, 82], [12, 100], [12, 82.5], [10, 90.5], [8, 84], [2, 79.5]]);
  expectHit(b, 'head_shoulders', (x) => assert.equal(x.stage, 'breakout'));
});

test('zzz981 rising wedge: rising lows faster than rising highs', () => {
  const b = gen([[60, 55], [20, 60], [8, 68], [5, 64.5], [6, 71], [4, 68.5], [5, 73.5], [3, 71.5], [4, 75.5], [2, 74.8]]);
  expectHit(b, 'rising_wedge', (x) => assert.equal(x.stage, 'forming'));
});

// ───────── negatives ─────────

const BASES: PatternId[] = ['flat_base', 'u_base', 'cup', 'cup_handle', 'ascending_base', 'vcp', 'base_on_base', 'ipo_base', 'high_tight_flag'];

function randomWalk(n: number, seed: number, drift = 0, sigma = 0.015): PBar[] {
  const r = rng(seed);
  const bars: PBar[] = [];
  let c = 100, t = Date.UTC(2021, 0, 4);
  for (let i = 0; i < n; i++) {
    const g = (r() + r() + r() + r() - 2) * 1.73; // ~N(0,1)
    const o = c;
    c = Math.max(1, c * (1 + drift + sigma * g));
    bars.push({ t, o, h: Math.max(o, c) * (1 + 0.006 * r()), l: Math.min(o, c) * (1 - 0.006 * r()), c, v: 1e6 * (0.7 + 0.6 * r()) });
    t += 86_400_000;
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  }
  return bars;
}

test('zzz981 steady downtrend: no bullish base', () => {
  const b = gen([[300, 100], [300, 40]], { start: 100, noise: 0.004 });
  const got = detectPatterns(b).filter((h) => BASES.includes(h.id));
  assert.deepEqual(ids(got), []);
});

test('zzz981 random walks: no "very likely" bullish base', () => {
  let anyBase = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const hits = detectPatterns(randomWalk(800, seed));
    const strong = hits.filter((h) => BASES.includes(h.id) && h.likelihood === 'very likely');
    assert.deepEqual(strong.map((h) => `${h.id}:${h.confidence}`), [], `seed ${seed}`);
    anyBase += hits.filter((h) => BASES.includes(h.id)).length;
    for (const h of hits) assert.ok(h.confidence >= 0.35);
  }
  assert.ok(anyBase <= 12, `too many bases on random data: ${anyBase}`);
});

test('zzz981 junk input: empty / short / bad bars do not throw', () => {
  assert.deepEqual(detectPatterns([]), []);
  assert.deepEqual(detectPatterns(gen([[10, 100]], { history: 0 })), []);
  const b = gen([...RISE, [12, 85]]);
  (b[5] as any).c = NaN; (b[9] as any).h = 0;
  assert.doesNotThrow(() => detectPatterns(b));
  assert.doesNotThrow(() => detectPatterns(Array.from({ length: 200 }, (_, i) => ({ t: i * 864e5, o: 10, h: 10, l: 10, c: 10, v: 0 }))));
});

// ───────── headline / tags ─────────

const fakeHit = (o: Partial<PatternHit>): PatternHit => ({
  id: 'cup_handle', label: 'Cup with handle', bias: 'bullish', family: 'base', stage: 'forming', confidence: 0.82, likelihood: 'very likely',
  startT: 0, endT: 0, lengthBars: 36, depthPct: 24, pivot: 512.4, distToPivotPct: -3.1, note: '', lines: [], ...o,
});

test('zzz981 headline wording', () => {
  assert.equal(patternHeadline([]), 'No clear chart pattern');
  assert.equal(
    patternHeadline([fakeHit({}), fakeHit({ id: 'vcp', label: 'VCP (volatility contraction)', confidence: 0.6, likelihood: 'likely' })]),
    'Very likely forming: Cup with handle (bullish, 7 wk, pivot 512.40, 3% below) · also likely: VCP (volatility contraction)',
  );
  assert.equal(
    patternHeadline([fakeHit({ id: 'double_top', label: 'Double top', bias: 'bearish', stage: 'breakout', likelihood: 'likely', confidence: 0.6, pivot: 88, distToPivotPct: -1.2, lengthBars: 6 })], (n) => `$${n.toFixed(1)}`),
    'Likely breaking down: Double top (bearish, 6 days, breakdown $88.0, 1% below)',
  );
  assert.match(patternHeadline([fakeHit({ likelihood: 'possible', confidence: 0.4, stage: 'failed' })]), /^Possibly failed breakout: Cup with handle/);
  // real data end to end
  const b = gen([...RISE, [50, 75, 'ease'], [12, 75], [50, 98, 'ease'], [12, 92], [4, 94.5]], { vol: fadeVol(16) });
  assert.match(patternHeadline(detectPatterns(b)), /(Very likely|Likely|Possibly) forming: /);
});

test('zzz981 toTags is compact', () => {
  const tags = toTags([fakeHit({}), fakeHit({ id: 'bear_flag', bias: 'bearish', stage: 'failed', confidence: 0.456, pivot: 12.345678, distToPivotPct: 8.06 }), fakeHit({ pivot: null, distToPivotPct: null, stage: 'breakout' })]);
  assert.deepEqual(tags[0], { id: 'cup_handle', b: 'U', s: 'f', c: 82, p: 512.4, d: -3.1 });
  assert.deepEqual(tags[1], { id: 'bear_flag', b: 'D', s: 'x', c: 46, p: 12.3457, d: 8.1 });
  assert.deepEqual(tags[2], { id: 'cup_handle', b: 'U', s: 'b', c: 82, p: null, d: null });
  assert.ok(JSON.stringify(tags[0]).length < 70);
});

test('zzz981 results: at most one hit per id, strongest first, lines carry [t, price]', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const hits = detectPatterns(randomWalk(1300, seed + 40, 0.0006));
    assert.equal(new Set(ids(hits)).size, hits.length);
    for (let k = 1; k < hits.length; k++) assert.ok(hits[k - 1].confidence >= hits[k].confidence);
    for (const h of hits) for (const l of h.lines) for (const [t, p] of l.points) assert.ok(Number.isFinite(t) && Number.isFinite(p));
  }
});

test('zzz981 timing: 1,300 bars in < 25 ms on average', () => {
  const series = [randomWalk(1300, 99, 0.0005), gen([...RISE, [50, 75, 'ease'], [12, 75], [50, 98, 'ease'], [12, 92], [4, 94.5]], { start: 30 })];
  for (const b of series) detectPatterns(b); // warm-up
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) detectPatterns(series[k % 2]);
  const avg = (performance.now() - t0) / 20;
  assert.ok(avg < 25, `avg ${avg.toFixed(1)} ms`);
});
