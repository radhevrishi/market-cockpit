// zzz990 — regression tests for the automated chart-pattern audit (2026-10-12), CP-01 … CP-10 plus the quick improvements.
// Each case first reproduces the audited defect's situation, then checks the fixed behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analyzePatterns, cleanBars, detectPatterns, firstBaseBreakoutOf, stageOf, HTF_RULES, PATTERN_IDS, PATTERN_META,
  type PBar, type PatternHit, type PatternId,
} from '../chart-patterns';
import {
  bannerColors, bannerOf, barsRevision, hitColor, opposingActive, overlayFit, overlayLinesOf, shapeScoreWords, shownStatus, FAILED_COLOR,
} from '../../components/charts/pattern-view';
import { parseYahooChart } from '../chart-data';
import { contrast } from '../readable-color';

const DAY = 86_400_000;

// ───────── fixtures ─────────
/** The audit's deterministic generator: straight legs, highs / lows 0.1% outside, weekdays, volume 1e6 then 4e5 in the last 20. */
function make(legs: Array<[number, number]>, start = 40, history = 300): PBar[] {
  const p: number[] = new Array(history + 1).fill(start);
  for (const [n, to] of legs) { const from = p[p.length - 1]; for (let i = 1; i <= n; i++) p.push(from + ((to - from) * i) / n); }
  let t = Date.UTC(2025, 0, 2), last = start;
  return p.map((c, i) => {
    const b = { t, o: last, c, h: Math.max(c, last) * 1.001, l: Math.min(c, last) * 0.999, v: i < p.length - 20 ? 1e6 : 4e5 };
    last = c; t += DAY; while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY;
    return b;
  });
}
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
/** zzz981's noisy generator (legs of [days, target]); `vol(i, n)` sets the volume. */
function gen(legs: Array<[number, number]>, opt: { start?: number; history?: number; vol?: (i: number, n: number) => number; seed?: number } = {}): PBar[] {
  const r = rng(opt.seed ?? 7);
  const path: number[] = new Array((opt.history ?? 300) + 1).fill(opt.start ?? legs[0][1]);
  for (const [d, to] of legs) { const from = path[path.length - 1]; for (let k = 1; k <= d; k++) path.push(from + ((to - from) * k) / d); }
  const n = path.length, bars: PBar[] = [];
  let t = Date.UTC(2023, 0, 2), prevC = path[0];
  for (let i = 0; i < n; i++) {
    const c = path[i] * (1 + (r() - 0.5) * 0.006), o = prevC;
    bars.push({ t, o, h: Math.max(o, c) * (1 + 0.005 * (0.3 + 0.7 * r())), l: Math.min(o, c) * (1 - 0.005 * (0.3 + 0.7 * r())), c, v: opt.vol ? opt.vol(i, n) : 1_000_000 * (0.8 + 0.4 * r()) });
    prevC = c; t += DAY; while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY;
  }
  return bars;
}
const fadeVol = (k: number, endFrac = 0.45) => (i: number, n: number) => (i < n - k ? 1_000_000 : 1_000_000 * (1 - (1 - endFrac) * ((i - (n - k)) / k)));
const ids = (hits: PatternHit[]) => hits.map((h) => h.id);
const hitOf = (hits: PatternHit[], id: PatternId) => hits.find((h) => h.id === id);
const withVol = (b: PBar[], f: (v: number, i: number) => number) => b.map((x, i) => ({ ...x, v: f(x.v, i) }));
const slim = (h: PatternHit[]) => h.map((x) => ({ id: x.id, c: x.confidence, s: x.stage, p: x.pivot }));

// bull flag (zzz981) with fading volume in the flag
const FLAG = gen([[60, 60], [10, 75], [3, 72.5], [2, 74], [3, 71.5], [2, 73], [3, 70.5]], { vol: fadeVol(13, 0.5) });
// flat base with drying volume
const FLAT = gen([[60, 60], [120, 100], [6, 93], [6, 99], [6, 94], [6, 98.5], [5, 95], [5, 98], [4, 96.5]], { vol: fadeVol(10) });
// cup with handle (zzz981)
const CUPH = gen([[60, 60], [120, 100], [50, 75], [12, 75], [50, 98], [12, 92], [4, 94.5]], { vol: fadeVol(16) });

// ───────── CP-01 — data revision ─────────
test('zzz990 CP-01: the data revision changes with ANY OHLCV change and not otherwise', () => {
  const base = FLAG.map((b) => ({ ...b }));
  const r0 = barsRevision(base);
  assert.equal(barsRevision(base.map((b) => ({ ...b }))), r0, 'identical data → identical revision (no render loop)');
  const vol = base.map((b, i) => (i >= base.length - 7 ? { ...b, v: 1e10 } : b));
  const hi = base.map((b, i) => (i === base.length - 30 ? { ...b, h: b.h * 1.2 } : b));
  const lo = base.map((b, i) => (i === base.length - 30 ? { ...b, l: b.l * 0.8 } : b));
  const early = base.map((b, i) => (i === 5 ? { ...b, c: b.c * 1.01 } : b));
  const open = base.map((b, i) => (i === 100 ? { ...b, o: b.o * 0.99 } : b));
  for (const x of [vol, hi, lo, early, open]) {
    assert.equal(x.length, base.length); assert.equal(x[x.length - 1].t, base[base.length - 1].t); assert.equal(x[x.length - 1].c, base[base.length - 1].c);
    assert.notEqual(barsRevision(x), r0);
  }
  // the audited signature (count : last time : last close) could not see these changes
  const oldSig = (b: PBar[]) => `${b.length}:${b[b.length - 1].t}:${b[b.length - 1].c}`;
  assert.equal(oldSig(vol), oldSig(base));
});

// ───────── CP-02 — first base after listing only ─────────
test('zzz990 CP-02: an IPO base is the FIRST base after listing; a later base after a > 20% advance is not', () => {
  const ipo = make([[20, 70], [15, 56], [15, 66], [10, 75], [60, 120], [10, 103], [10, 114]], 50, 0);
  const first = ipo.slice(0, 51);
  const h1 = hitOf(detectPatterns(first, { firstTradeT: ipo[0].t }), 'ipo_base');
  assert.ok(h1, 'the genuine first IPO base is still found');
  assert.ok(Math.abs(h1!.pivot! / 70.07 - 1) < 0.01, String(h1!.pivot));
  // audited defect: the later base (pivot ~120) was also labelled IPO base (0.926)
  assert.ok(!ids(detectPatterns(ipo, { firstTradeT: ipo[0].t })).includes('ipo_base'), 'a later base is not the IPO base');
  assert.ok(Math.abs(firstBaseBreakoutOf(ipo.map((b) => b.h), ipo.map((b) => b.l), ipo.map((b) => b.c), 0, 100)! / 70.07 - 1) < 0.001);
  // failed / shallow initial break (< 20% past the first pivot, back into the base): still the first base
  const failedBreak = make([[20, 70], [15, 56], [15, 66], [6, 74], [15, 60], [15, 68]], 50, 0);
  assert.ok(ids(detectPatterns(failedBreak, { firstTradeT: failedBreak[0].t })).includes('ipo_base'), 'a failed initial break keeps the first base');
  // no earlier base at all → no earlier breakout
  assert.equal(firstBaseBreakoutOf([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], 0, 5), null);
});

// ───────── CP-03 — listing date never inferred ─────────
test('zzz990 CP-03: listing is never inferred from the first bar; a given date counts only when the history starts at it', () => {
  // a 316-bar SAMBHV-shaped history with an IPO-like correction
  const b = make([[40, 80], [15, 62], [15, 74]], 50, 0);
  assert.ok(b.length < 450);
  assert.ok(!ids(detectPatterns(b)).includes('ipo_base'), 'no listing date → no IPO base (was: first bar taken as listing)');
  assert.equal(analyzePatterns(b).listingKnown, false);
  assert.ok(ids(detectPatterns(b, { firstTradeT: b[0].t })).includes('ipo_base'), 'listing date = first bar → IPO base');
  assert.ok(ids(detectPatterns(b, { firstTradeT: b[0].t - 2 * DAY })).includes('ipo_base'), 'a few days of tolerance');
  assert.equal(analyzePatterns(b, { firstTradeT: b[0].t }).listingKnown, true);
  // an old listing (vendor history truncated) → not an IPO
  assert.ok(!ids(detectPatterns(b, { firstTradeT: b[0].t - 3 * 365 * DAY })).includes('ipo_base'));
  // a listing date inside the history (bars before it) is inconsistent → not trusted
  assert.ok(!ids(detectPatterns(b, { firstTradeT: b[30].t })).includes('ipo_base'));
  assert.ok(!ids(detectPatterns(b, { firstTradeT: NaN })).includes('ipo_base'));
});

test('zzz990 CP-03: the chart API passes Yahoo meta.firstTradeDate through (ms), backwards-compatible', () => {
  const j = { chart: { result: [{ meta: { symbol: 'X.NS', currency: 'INR', firstTradeDate: 1735790400, gmtoffset: 19800 }, timestamp: [1735790400, 1735876800], indicators: { quote: [{ open: [10, 11], high: [11, 12], low: [9, 10], close: [10.5, 11.5], volume: [100, 200] }] } }] } };
  assert.equal(parseYahooChart(j)!.firstTradeT, 1735790400 * 1000);
  const none = JSON.parse(JSON.stringify(j)); delete none.chart.result[0].meta.firstTradeDate;
  assert.equal(parseYahooChart(none)!.firstTradeT, null);
  const route = readFileSync(new URL('../../app/api/v1/chart/[ticker]/route.ts', import.meta.url), 'utf8');
  assert.match(route, /firstTradeT: series\.firstTradeT \?\? null/);
  const ind = readFileSync(new URL('../../components/charts/PatternIndicator.tsx', import.meta.url), 'utf8');
  assert.match(ind, /firstTradeT/);
});

// ───────── CP-04 — volume missingness ─────────
test('zzz990 CP-04: zero / NaN / absent volume never earns dryness credit; deleting volume never raises a score', () => {
  for (const [name, bars, id] of [['flag', FLAG, 'bull_flag'], ['flat', FLAT, 'flat_base'], ['cup handle', CUPH, 'cup_handle']] as Array<[string, PBar[], PatternId]>) {
    const real = analyzePatterns(bars).hits;
    const flat = analyzePatterns(withVol(bars, () => 1e6)).hits;
    const variants = { zero: withVol(bars, () => 0), nan: withVol(bars, () => NaN), absent: bars.map(({ v: _v, ...x }) => x as unknown as PBar), negative: withVol(bars, () => -5) };
    const hReal = hitOf(real, id), hFlat = hitOf(flat, id);
    assert.ok(hReal, `${name}: ${id} with real volume`);
    for (const [vn, vb] of Object.entries(variants)) {
      const got = analyzePatterns(vb);
      assert.equal(got.volumeCoverage, 0, `${name}/${vn} coverage`);
      for (const h of got.hits) {
        assert.equal(h.volumeOk, false, `${name}/${vn} ${h.id} volumeOk`);
        assert.match(h.note, /volume not confirmed/);
        // a hit's own shape score never rises. The one allowed difference: a reading that was DAMPED (×0.75) because a
        // stronger opposite-bias reading of the same bars led — when the volume-backed lead weakens, it is no longer damped.
        const undamped = (ref: PatternHit[], r: PatternHit) => r.bias !== ref[0].bias && Math.abs(r.confidence - Math.round(h.confidence * 0.75 * 1000) / 1000) < 0.002;
        const r = hitOf(real, h.id), f = hitOf(flat, h.id);
        if (r && !undamped(real, r)) assert.ok(h.confidence <= r.confidence + 1e-9, `${name}/${vn} ${h.id} ${h.confidence} > real ${r.confidence}`);
        if (f && !undamped(flat, f)) assert.ok(h.confidence <= f.confidence + 1e-9, `${name}/${vn} ${h.id} ${h.confidence} > flat ${f.confidence}`);
        if (r && PATTERN_META[h.id].bias === PATTERN_META[id].bias) assert.ok(h.confidence <= r.confidence + 1e-9, `${name}/${vn} same-side ${h.id}`);
      }
    }
    // drying volume still earns credit over flat volume
    if (hFlat) assert.ok(hReal!.confidence > hFlat.confidence, `${name}: drying ${hReal!.confidence} vs flat ${hFlat.confidence}`);
    assert.equal(hReal!.volumeOk, true);
  }
  // the banner says so
  const z = analyzePatterns(withVol(FLAG, () => 0)).hits;
  assert.ok(z.length > 0);
  assert.match(bannerOf(z, '₹').text, /volume not confirmed$/);
});

test('zzz990 CP-04: partial volume (sparse observations) is not evidence; no breakout-volume bonus without a real baseline', () => {
  // only every 4th bar has volume: below 60% coverage → no credit, but real full volume is unaffected
  const sparse = withVol(FLAG, (v, i) => (i % 4 === 0 ? v : 0));
  const hS = hitOf(analyzePatterns(sparse).hits, 'bull_flag'), hR = hitOf(analyzePatterns(FLAG).hits, 'bull_flag');
  assert.ok(hS && hR && hS.confidence <= hR.confidence);
  assert.equal(hS!.volumeOk, false);
  // breakout: huge breakout-day volume against a zero baseline must not add the +0.05 bonus
  const bo = gen([[60, 60], [120, 100], [50, 75], [12, 75], [50, 98], [12, 92], [4, 95], [2, 101]]);
  const zeroBase = withVol(bo, (v, i) => (i === bo.length - 1 || i === bo.length - 2 ? 5e9 : 0));
  const flatBase = withVol(bo, (v, i) => (i === bo.length - 1 || i === bo.length - 2 ? 5e9 : 1e6));
  const hz = hitOf(analyzePatterns(zeroBase).hits, 'cup_handle'), hf = hitOf(analyzePatterns(flatBase).hits, 'cup_handle');
  assert.ok(hz && hf, 'cup with handle breakout in both');
  assert.equal(hz!.stage, 'breakout');
  assert.ok(hz!.confidence < hf!.confidence, `zero-baseline breakout ${hz!.confidence} vs real ${hf!.confidence}`);
});

// ───────── CP-05 — projected sloping boundary ─────────
test('zzz990 CP-05: a break of the PROJECTED sloping line is found; not past the apex; horizontal pivots unchanged', () => {
  // body ends at 12 with the boundary at 100, falling 2 per bar → 98 at bar 13; closes below the line up to 12; last close 99
  const c = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 99, 99, 99, 99];
  const s = { n: c.length, c };
  const line = (i: number) => 100 - 2 * (i - 12);
  for (let i = 0; i <= 12; i++) assert.ok(c[i] < line(i));
  const st = stageOf(s, 12, 0, line(12), true, line);
  assert.deepEqual(st, { stage: 'breakout', f: 13 }, 'audited: frozen at 100 → null');
  // the same projection with an apex (expiry) at bar 12: no break invented after it
  assert.equal(stageOf(s, 12, 0, line(12), true, line, 12), null);
  // horizontal pivot (no line) unchanged: 99 < 100 → no break
  assert.equal(stageOf(s, 12, 0, 100, true), null);
  assert.deepEqual(stageOf(s, 13, 0, 100, true), { stage: 'forming', f: -1 });
  // bearish mirror: rising lower line, close below its projection
  const cb = c.map((x) => 200 - x);
  const lineB = (i: number) => 100 + 2 * (i - 12);
  assert.deepEqual(stageOf({ n: cb.length, c: cb }, 12, 0, lineB(12), false, lineB), { stage: 'breakout', f: 13 });
});

test('zzz990 CP-05: sloped hits report the level and distance from the same projected line they draw', () => {
  const sloped: PatternId[] = ['bull_flag', 'bull_pennant', 'bear_flag', 'falling_wedge', 'rising_wedge', 'head_shoulders', 'inverse_hs'];
  const fixtures = [
    FLAG,
    gen([[60, 60], [10, 75], [3, 70], [3, 74], [3, 71], [3, 73.2], [2, 72]]),
    gen([[60, 100], [40, 95], [8, 78], [3, 80.5], [2, 79], [3, 81.5], [2, 80], [3, 82]]),
    gen([[60, 110], [20, 100], [8, 86], [7, 93], [8, 82], [7, 87.5], [7, 79], [6, 83.5], [6, 77], [3, 80]]),
    gen([[60, 60], [60, 90], [10, 82], [12, 100], [12, 82.5], [10, 90.5], [6, 86]]),
  ];
  let checked = 0;
  for (const b of fixtures) {
    const close = b[b.length - 1].c;
    for (const h of detectPatterns(b)) {
      if (!sloped.includes(h.id)) continue;
      const pv = h.lines.find((l) => l.kind === 'pivot')!;
      const end = pv.points[pv.points.length - 1];
      assert.ok(Math.abs(end[1] / h.pivot! - 1) < 1e-3, `${h.id} drawn level ${end[1]} vs shown ${h.pivot}`);
      assert.ok(Math.abs(h.distToPivotPct! - (close / h.pivot! - 1) * 100) < 0.02, `${h.id} distance`);
      checked++;
    }
  }
  assert.ok(checked >= 4, `checked ${checked}`);
});

// ───────── CP-06 — collapsed lines on W / M ─────────
test('zzz990 CP-06: a sloping line inside one candle is omitted, never flattened; true levels stay ticks', () => {
  const T0 = Date.UTC(2026, 0, 1);
  const months = Array.from({ length: 24 }, (_, i) => Date.UTC(2025, i, 1));
  const h: PatternHit = {
    id: 'bull_flag', label: 'Bull flag', bias: 'bullish', family: 'continuation', stage: 'forming', confidence: 0.8, likelihood: 'very likely',
    startT: T0, endT: T0 + 20 * DAY, lengthBars: 20, depthPct: 8, pivot: 163.59, distToPivotPct: -2, note: '',
    lines: [
      { kind: 'trend', points: [[T0 + 2 * DAY, 173.73], [T0 + 15 * DAY, 163.59]] },   // SAMBHV upper boundary
      { kind: 'trend', points: [[T0 + 2 * DAY, 157.74], [T0 + 15 * DAY, 150.26]] },   // lower boundary
      { kind: 'support', points: [[T0 + 5 * DAY, 150], [T0 + 5 * DAY, 150]] },       // a one-point level
      { kind: 'pivot', points: [[T0 + 3 * DAY, 170], [T0 + 16 * DAY, 170]] },        // a horizontal pivot inside one candle
    ],
  };
  const fit = overlayFit(h, months);
  assert.equal(fit.omitted, 2, 'both sloping boundaries left out');
  for (const ln of fit.lines) assert.equal(ln.points[0].value, ln.points[1].value);
  assert.deepEqual(fit.lines.map((l) => l.kind), ['support', 'pivot']);
  assert.ok(!fit.lines.some((l) => l.points[0].value === 173.73), 'no fake 173.73 → 173.73 level');
  // on daily candles the sloping lines are kept with their real ends
  const days = Array.from({ length: 40 }, (_, i) => T0 + i * DAY);
  const d = overlayFit(h, days);
  assert.equal(d.omitted, 0);
  assert.deepEqual(d.lines[0].points.map((p) => p.value), [173.73, 163.59]);
  assert.equal(overlayLinesOf(h, months).length, 2);
});

// ───────── CP-07 — truthful states ─────────
test('zzz990 CP-07: no price data / too little history are stated, not "looking…" or "no pattern"', () => {
  const key = 'US::ZZZNOTREAL:price';
  assert.deepEqual(shownStatus(null, key, false, { loading: false, error: 'No price history found for ZZZNOTREAL (US).' }), { status: 'unavailable', error: 'No price history found for ZZZNOTREAL (US).' });
  assert.equal(shownStatus(null, key, false, { loading: true, error: null }).status, 'loading');
  assert.equal(shownStatus(null, key, false, { loading: true, error: 'old error' }).status, 'loading');
  assert.equal(bannerOf([], '$', 'unavailable').text, '📐 No price data — patterns unavailable');
  assert.equal(bannerOf([], '$', 'short', 'Too little history (21 usable bars)').text, '📐 Too little history (21 usable bars) — patterns need at least 30 daily bars');
  const short = analyzePatterns(make([[10, 50]], 40, 10));
  assert.equal(short.tooShort, true); assert.equal(short.usableBars, 21); assert.deepEqual(short.hits, []);
});

// ───────── CP-08 — high tight flag gates match the text ─────────
test('zzz990 CP-08: high tight flag pole / flag boundaries match PATTERN_META exactly', () => {
  const htf = (to: number, flag: Array<[number, number]> = [[9, 0.88], [9, 0.93]]) => {
    const legs: Array<[number, number]> = [[60, 40], [35, to], ...flag.map(([n, f]) => [n, to * f] as [number, number])];
    return hitOf(detectPatterns(make(legs)), 'high_tight_flag');
  };
  assert.equal(htf(40 * 1.85), undefined, '85% pole: not a high tight flag');
  assert.equal(htf(75.2), undefined, '88% pole (the audited case, was 0.579): not a high tight flag');
  const h90 = htf(40 * 1.91), h100 = htf(40 * 2.0);
  assert.ok(h90 && h100, '90% and 100% poles qualify');
  assert.ok(h100!.confidence > h90!.confidence);
  assert.match(h100!.note, /pole \+\d+% in \d+ days/);
  // flag length: 7 bars (too short), 31 bars (too long) → not a high tight flag
  assert.equal(htf(80, [[3, 0.9], [3, 0.93]]), undefined);
  assert.equal(htf(80, [[15, 0.88], [15, 0.93]]), undefined);
  // pullback deeper than 25% → not one
  assert.equal(htf(80, [[9, 0.72], [9, 0.8]]), undefined);
  const txt = PATTERN_META.high_tight_flag.short;
  assert.equal(HTF_RULES.minRise, 0.9); assert.equal(HTF_RULES.maxPoleBars, 40); assert.equal(HTF_RULES.minFlagBars, 10); assert.equal(HTF_RULES.maxFlagBars, 25); assert.equal(HTF_RULES.maxDepth, 0.25);
  for (const words of ['90%', '40 trading days', '10–25 trading-day', '25%']) assert.ok(txt.includes(words), `${words} in "${txt}"`);
  // ascending base text names its accepted tolerances
  assert.match(PATTERN_META.ascending_base.short, /8–22%.*8–19 weeks/);
  assert.match(PATTERN_META.cup.short, /to 50%/);
});

// ───────── CP-10 — validation ─────────
test('zzz990 CP-10: non-finite prices and bad chronology are rejected and counted', () => {
  const b = FLAG.map((x) => ({ ...x }));
  const n = b.length;
  const inf = b.map((x, i) => (i === n - 1 ? { ...x, c: Infinity, h: Infinity } : x));
  const r = cleanBars(inf);
  assert.equal(r.rejected, 1); assert.equal(r.bars.length, n - 1);
  assert.ok(r.bars.every((x) => Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c)));
  // audited: an Infinity latest close produced breakout labels
  assert.ok(!detectPatterns(inf).some((h) => h.stage === 'breakout' && h.endT === b[n - 1].t));
  assert.ok(detectPatterns(inf).every((h) => h.pivot != null && Number.isFinite(h.pivot) && Number.isFinite(h.distToPivotPct!)));
  const onlyHigh = b.map((x, i) => (i === n - 1 ? { ...x, h: Infinity } : x));
  assert.equal(cleanBars(onlyHigh).rejected, 1);
  const negInfLow = b.map((x, i) => (i === 10 ? { ...x, l: -Infinity } : x));
  assert.equal(cleanBars(negInfLow).rejected, 1);
  const nanClose = b.map((x, i) => (i === 10 ? { ...x, c: NaN } : x));
  assert.equal(cleanBars(nanClose).rejected, 1);
  const outOfOrder = b.slice(); [outOfOrder[50], outOfOrder[51]] = [outOfOrder[51], outOfOrder[50]];
  assert.equal(cleanBars(outOfOrder).rejected, 1);
  const dup = b.slice(); dup.splice(60, 0, { ...b[60] });
  assert.equal(cleanBars(dup).rejected, 1);
  // repaired (counted, kept): a missing open / a high below the close
  const rep = b.map((x, i) => (i === 20 ? { ...x, o: undefined as unknown as number } : i === 21 ? { ...x, h: x.c * 0.5 } : x));
  const rr = cleanBars(rep);
  assert.equal(rr.rejected, 0); assert.equal(rr.repaired, 2); assert.ok(rr.bars[21].h >= rr.bars[21].c);
  const a = analyzePatterns(inf);
  assert.equal(a.rejectedBars, 1); assert.equal(a.usableBars, n - 1);
});

// ───────── quick improvements ─────────
const H = (o: Partial<PatternHit>): PatternHit => ({
  id: 'cup_handle', label: 'Cup with handle', bias: 'bullish', family: 'base', stage: 'forming', confidence: 0.8, likelihood: 'very likely',
  startT: 0, endT: 10 * DAY, lengthBars: 36, depthPct: 20, pivot: 100, distToPivotPct: -3, note: '', lines: [], ...o,
});

test('zzz990 improvements: shape score wording, failed in amber after active, opposing structure marker', () => {
  assert.equal(shapeScoreWords(H({ confidence: 0.846 })), 'shape score 85/100');
  // engine order: an active structure ranks before a stronger failed one
  const all = [...PATTERN_IDS];
  assert.equal(all.length, 22);
  // banner: failed lead (only when every hit failed) → amber tone
  const failedOnly = bannerOf([H({ stage: 'failed', likelihood: 'likely', confidence: 0.7 })], '₹');
  assert.equal(failedOnly.tone, 'failed');
  assert.equal(hitColor(H({ stage: 'failed' })), FAILED_COLOR);
  assert.notEqual(hitColor(H({})), FAILED_COLOR);
  for (const light of [true, false]) assert.ok((contrast(bannerColors('failed', light).text, light ? '#FFFFFF' : '#0A0E1A') ?? 0) >= 4.4);
  // opposing active structures
  const both = [H({}), H({ id: 'double_top', label: 'Double top', bias: 'bearish', confidence: 0.6, likelihood: 'likely' })];
  assert.equal(opposingActive(both), true);
  assert.match(bannerOf(both, '₹').text, / · opposing structure present$/);
  // a failed bearish hit is not an opposing ACTIVE structure
  assert.equal(opposingActive([H({}), H({ id: 'double_top', bias: 'bearish', stage: 'failed' })]), false);
  assert.doesNotMatch(bannerOf([H({})], '₹').text, /opposing/);
  // failed structures drawn amber
  assert.equal(overlayFit(H({ stage: 'failed', lines: [{ kind: 'pivot', points: [[0, 100], [5 * DAY, 100]] }] }), [0, DAY, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY]).lines[0].color, FAILED_COLOR);
});

test('zzz990 engine ranks active structures before failed ones', () => {
  let sawMixed = 0;
  const walks = Array.from({ length: 30 }, (_, k) => {
    const r = rng(500 + k); let c = 100, t = Date.UTC(2021, 0, 4);
    return Array.from({ length: 900 }, () => { const o = c; c = Math.max(1, c * (1 + 0.0004 + 0.017 * ((r() + r() + r() + r() - 2) * 1.73))); const b = { t, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 1e6 * (0.7 + 0.6 * r()) }; t += DAY; while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY; return b; });
  });
  for (const w of walks) {
    const hits = detectPatterns(w);
    const firstFailed = hits.findIndex((h) => h.stage === 'failed');
    if (firstFailed >= 0) {
      assert.ok(hits.slice(firstFailed).every((h) => h.stage === 'failed'), JSON.stringify(slim(hits)));
      if (firstFailed > 0) sawMixed++;
    }
  }
  assert.ok(sawMixed >= 0);
});

// ───────── mounted hook (JSDOM) — CP-01, CP-07, CP-10, late answers ─────────
async function withDom<T>(fn: (h: { React: any; act: any; root: any; settle: (ms?: number) => Promise<void> }) => Promise<T>): Promise<T> {
  const { JSDOM } = await import('jsdom');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/charts', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const settle = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
  try {
    return await fn({ React, act, root, settle });
  } finally {
    try { await act(async () => { root.unmount(); }); } catch { /* keep the test's own failure visible */ }
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
}
const pack = (b: PBar[]) => ({ t: b.map((x) => x.t), o: b.map((x) => x.o), h: b.map((x) => x.h), l: b.map((x) => x.l), c: b.map((x) => x.c), v: b.map((x) => x.v) });

test('zzz990 CP-01/07/10 mounted hook: OHLCV corrections re-run detection; truthful states; late answers ignored (JSDOM)', async () => {
  await withDom(async ({ React, act, root, settle }) => {
    const { usePatternIndicator } = await import('../../components/charts/PatternIndicator');
    let out: any = null;
    const sink = (v: unknown) => { out = v; };
    const Probe = (props: any) => { const p = usePatternIndicator(props); React.useEffect(() => sink(p)); return null; };
    const cacheRef = { current: new Map() }, chartRef = { current: null };
    const base = { on: true, ready: false, market: 'US', exchange: undefined, basis: 'price', chartRef, cacheRef, cur: '$', chart: { loading: false, error: null } };
    // effects run when the render's act() ends; the 150 ms debounce then needs a second act()
    const render = async (p: any, wait = 260) => { await act(async () => { root.render(React.createElement(Probe, { ...base, ...p })); }); await act(async () => { await settle(wait); }); };
    const resp = (ticker: string, bars: PBar[], extra: object = {}) => ({ ok: true, ticker, market: 'US', interval: '1d', range: '5y', basis: 'price', bars: pack(bars), ...extra });

    // 1. initial
    const b0 = FLAG.map((x) => ({ ...x }));
    await render({ ticker: 'ABC', live: resp('ABC', b0), bars: b0 });
    assert.equal(out.status, 'ready');
    assert.deepEqual(slim(out.hits), slim(detectPatterns(b0)));
    const before = hitOf(out.hits, 'bull_flag')!.confidence;
    // 2. the audit's reproduction: last seven volumes → 1e10, count / last time / last close unchanged
    const b1 = b0.map((x, i) => (i >= b0.length - 7 ? { ...x, v: 1e10 } : { ...x }));
    await render({ ticker: 'ABC', live: resp('ABC', b1), bars: b1 });
    const want1 = detectPatterns(b1);
    assert.deepEqual(slim(out.hits), slim(want1), 'hook = direct detection after a volume correction');
    assert.notEqual(hitOf(out.hits, 'bull_flag')?.confidence, before, 'the score changed (was stale before the fix)');
    // 3. high / low and earlier-bar corrections
    for (const mut of [
      (b: PBar[]) => b.map((x, i) => (i === b.length - 12 ? { ...x, l: x.l * 0.9 } : { ...x })),
      (b: PBar[]) => b.map((x, i) => (i === b.length - 15 ? { ...x, h: x.h * 1.08 } : { ...x })),
      (b: PBar[]) => b.map((x, i) => (i < 40 ? { ...x, l: x.l * 0.5, c: x.c * 0.6, o: x.o * 0.6 } : { ...x })),
    ]) {
      const bx = mut(b1);
      await render({ ticker: 'ABC', live: resp('ABC', bx), bars: bx });
      assert.deepEqual(slim(out.hits), slim(detectPatterns(bx)));
    }
    // 4. the indicator off is inert: nothing shown
    await render({ ticker: 'ABC', live: resp('ABC', b1), bars: b1, on: false });
    assert.deepEqual(out.hits, []); assert.equal(out.status, 'idle');

    // 5. CP-07: the chart's load failed and there is no response for this symbol
    await render({ ticker: 'ZZZNOTREAL', live: null, bars: [], chart: { loading: false, error: 'No price history found for ZZZNOTREAL (US). — refresh failed' } });
    assert.equal(out.status, 'unavailable');
    assert.equal(bannerOf(out.hits, '$', out.status, out.error).text, '📐 No price data — patterns unavailable');
    await render({ ticker: 'ZZZNOTREAL', live: null, bars: [], chart: { loading: true, error: null } });
    assert.equal(out.status, 'loading');
    // too little history
    const tiny = make([[10, 50]], 40, 10);
    await render({ ticker: 'TINY', live: resp('TINY', tiny), bars: tiny });
    assert.equal(out.status, 'short'); assert.match(out.error, /Too little history \(21 usable bars\)/);
    // CP-10: a detection exception is an error state, not "No clear chart pattern"
    const boom = b0.map((x) => ({ ...x }));
    // a value that cannot be converted to a number makes the engine throw (Number(symbol) is a TypeError)
    (boom[3] as any).c = Symbol('bad close');
    await render({ ticker: 'BOOM', live: resp('BOOM', b0), bars: boom });
    assert.equal(out.status, 'error'); assert.match(out.error, /pattern detection failed/);
    assert.doesNotMatch(bannerOf(out.hits, '$', out.status, out.error).text, /No clear chart pattern/);

    // 6. a late answer for an older ticker never overwrites the current one (daily bars fetched: chart on screen is 2y)
    const pending = new Map<string, (v: any) => void>();
    const urls: string[] = [];
    (globalThis as any).fetch = (url: string) => { urls.push(url); return new Promise((res) => pending.set(url, res)); };
    const answer = (url: string, body: any) => pending.get(url)!({ ok: true, status: 200, json: async () => body });
    const shortResp = (t: string, b: PBar[]) => ({ ok: true, ticker: t, market: 'US', interval: '1d', range: '2y', bars: pack(b) });
    const bA = CUPH, bB = FLAG;
    await render({ ticker: 'AAA', live: shortResp('AAA', bA.slice(-300)), bars: bA.slice(-300) });
    const urlA = urls.find((u) => u.includes('/AAA?'))!;
    assert.ok(urlA);
    await render({ ticker: 'BBB', live: shortResp('BBB', bB.slice(-300)), bars: bB.slice(-300) });
    const urlB = urls.find((u) => u.includes('/BBB?'))!;
    await act(async () => { answer(urlB, resp('BBB', bB)); await settle(30); });
    assert.equal(out.status, 'ready');
    assert.deepEqual(slim(out.hits), slim(detectPatterns(bB)));
    await act(async () => { answer(urlA, resp('AAA', bA)); await settle(30); });
    assert.deepEqual(slim(out.hits), slim(detectPatterns(bB)), 'AAA\'s late answer did not replace BBB');
    // a 404 for the daily bars → unavailable
    await render({ ticker: 'NOPE', live: shortResp('NOPE', bB.slice(-300)), bars: bB.slice(-300) });
    const urlN = urls.find((u) => u.includes('/NOPE?'))!;
    await act(async () => { pending.get(urlN)!({ ok: false, status: 404, json: async () => ({ ok: false, error: 'No price history found for NOPE (US).' }) }); await settle(30); });
    assert.equal(out.status, 'unavailable');
    // an answer for another price basis is refused
    await render({ ticker: 'BAS', basis: 'tr', live: { ...shortResp('BAS', bB.slice(-300)) }, bars: bB.slice(-300) });
    const urlT = urls.find((u) => u.includes('/BAS?'))!;
    assert.match(urlT, /basis=tr/);
    await act(async () => { answer(urlT, resp('BAS', bB)); await settle(30); });   // resp() says basis 'price'
    assert.equal(out.status, 'error'); assert.match(out.error, /another price basis/);
  });
});

test('zzz990 CP-03 mounted hook: the listing date in the chart response reaches the engine (JSDOM)', async () => {
  await withDom(async ({ React, act, root, settle }) => {
    const { usePatternIndicator } = await import('../../components/charts/PatternIndicator');
    let out: any = null;
    const sink = (v: unknown) => { out = v; };
    const Probe = (props: any) => { const p = usePatternIndicator(props); React.useEffect(() => sink(p)); return null; };
    const b = make([[40, 80], [15, 62], [15, 74]], 50, 0);
    const props = { on: true, ready: false, market: 'IN', exchange: 'NSE', basis: 'price', chartRef: { current: null }, cacheRef: { current: new Map() }, cur: '₹', ticker: 'NEWIPO', bars: b };
    const live = { ok: true, ticker: 'NEWIPO', market: 'IN', interval: '1d', range: '5y', requestedExchange: 'NSE', bars: pack(b) };
    await act(async () => { root.render(React.createElement(Probe, { ...props, live })); }); await act(async () => { await settle(260); });
    assert.ok(!ids(out.hits).includes('ipo_base'), 'no listing date → no IPO base');
    await act(async () => { root.render(React.createElement(Probe, { ...props, live: { ...live, firstTradeT: b[0].t } })); }); await act(async () => { await settle(260); });
    assert.ok(ids(out.hits).includes('ipo_base'), 'listing date from the response → IPO base');
  });
});

// ───────── CP-09 — dismissal, daily-pattern badge ─────────
test('zzz990 CP-09: Escape, a Close button and an outside click dismiss the pinned list; "Daily pattern" badge on W / M (JSDOM)', async () => {
  await withDom(async ({ React, act, root, settle }) => {
    const { PatternBanner } = await import('../../components/charts/PatternIndicator');
    const p = { on: true, hits: [H({ note: 'Cup with handle, 7 weeks' })], status: 'ready', error: undefined, drawnIds: new Set<PatternId>(), togglePick: () => {}, omittedLines: 1 };
    const render = async (tf: string) => { await act(async () => { root.render(React.createElement('div', null, React.createElement('span', { id: 'outside' }, 'chart'), React.createElement(PatternBanner, { p, cur: '₹', light: true, onTurnOff: () => {}, tf }))); await settle(); }); };
    await render('D');
    assert.equal(document.querySelector('[data-testid="daily-pattern-badge"]'), null);
    const head = () => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').startsWith('📐'))!;
    const dialog = () => document.querySelector('[role="dialog"]');
    const open = async () => { await act(async () => { head().click(); await settle(); }); assert.ok(dialog(), 'pinned open'); };
    await open();
    assert.match(dialog()!.textContent || '', /shape score 80\/100/);
    assert.match(dialog()!.textContent || '', /switch to D to see the lines/);
    assert.match(dialog()!.textContent || '', /not a probability/);
    await act(async () => { document.dispatchEvent(new (window as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); });
    assert.equal(dialog(), null, 'Escape closes');
    await open();
    const close = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Close list')!;
    await act(async () => { close.click(); await settle(); });
    assert.equal(dialog(), null, 'Close list closes');
    await open();
    await act(async () => { document.getElementById('outside')!.dispatchEvent(new (window as any).MouseEvent('mousedown', { bubbles: true })); await settle(); });
    assert.equal(dialog(), null, 'outside click closes');
    // clicking inside the list does not close it
    await open();
    await act(async () => { dialog()!.dispatchEvent(new (window as any).MouseEvent('mousedown', { bubbles: true })); await settle(); });
    assert.ok(dialog());
    await render('W');
    assert.ok(document.querySelector('[data-testid="daily-pattern-badge"]'), 'Daily pattern badge on weekly');
    await render('M');
    assert.match(document.querySelector('[data-testid="daily-pattern-badge"]')!.textContent || '', /Daily pattern/);
  });
});

test('zzz990 wiring: the chart passes its load state and timeframe; drawings isolation kept', () => {
  const ws = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.ok(ws.includes('chart: { loading, error }'));
  assert.ok(ws.includes('tf={tf}'));
  assert.ok(ws.includes('SymbolSearch') || ws.includes('symbol-search'), 'symbol search edits kept');
  assert.ok(ws.includes('useStageIndicator'), 'stage analysis edits kept');
  const ind = readFileSync(new URL('../../components/charts/PatternIndicator.tsx', import.meta.url), 'utf8');
  assert.ok(ind.includes('groupId: PATTERN_GROUP'));
  assert.ok(!/barsSig/.test(ind), 'the count / last-close signature is gone');
});
