// zzz1046 — institutional accumulation / distribution engine (lib/accumulation.ts). Synthetic bars only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accumulationSeries, accumulationFigures, accScore, accGrade, closeLocation, deliveryFigures, accExplain, ACC_RULES } from '../accumulation';

type B = { d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
/** Weekdays from 2026-01-05. `step(i)` gives [change %, volume multiple, close location −1…1]. */
function make(n: number, step: (i: number) => [number, number, number], base = 100, vol = 1_000_000): B {
  const b: B = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let t = Date.parse('2026-01-05T00:00:00Z'), c = base;
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
    const [chg, vx, cl] = step(i);
    const prev = c; c = +(prev * (1 + chg / 100)).toFixed(4);
    const range = Math.max(prev, c) * 0.02;
    const lo = Math.min(prev, c) - range * 0.25, hi = Math.max(prev, c) + range * 0.25;
    // place the close at location `cl` inside [lo, hi] by moving lo/hi around c
    const span = hi - lo, l = c - ((cl + 1) / 2) * span, h = l + span;
    b.d.push(new Date(t).toISOString().slice(0, 10)); b.o.push(prev); b.h.push(+h.toFixed(4)); b.l.push(+l.toFixed(4)); b.c.push(c); b.v.push(Math.round(vol * vx));
    t += 86_400_000;
  }
  return b;
}
const done = () => true;

test('close location: +1 on the high, −1 on the low, 0 with no range', () => {
  assert.equal(closeLocation(10, 8, 10), 1);
  assert.equal(closeLocation(10, 8, 8), -1);
  assert.equal(closeLocation(10, 10, 10), 0);
  assert.equal(closeLocation(10, 8, 9), 0);
});

test('bar classification follows the published thresholds exactly', () => {
  // 60 quiet bars, then: acc (+1.5%, 1.3×, closes high), dist (−1.5%, 1.3×, closes low), churn (0%, 1.6×, closes low), plain up day
  const b = make(64, (i) => (i < 60 ? [i % 2 ? 0.3 : -0.3, 1, 0] : i === 60 ? [1.5, 1.3, 0.6] : i === 61 ? [-1.5, 1.3, -0.6] : i === 62 ? [0.1, 1.6, -0.5] : [1.5, 1.1, 0.6]));
  const s = accumulationSeries(b);
  assert.equal(s.kind[60], 'acc');
  assert.equal(s.kind[61], 'dist');
  assert.equal(s.kind[62], 'churn');
  assert.equal(s.kind[63], null, 'an up day on below-threshold volume is not accumulation');
  assert.equal(s.avgV[49], null, 'no average before 50 prior bars');
  assert.ok(s.avgV[50] != null);
});

test('volume breakout = new 50-bar closing high on ≥ 1.5× average volume, closing in the upper part of the bar', () => {
  const b = make(65, (i) => (i < 64 ? [i % 2 ? 0.4 : -0.4, 1, 0] : [4, 2.2, 0.8]));
  const s = accumulationSeries(b);
  assert.equal(s.kind[64], 'vbo');
  const f = accumulationFigures({ ...b, c: [...b.c, ...Array(10).fill(0)].slice(0, 65) } as any, { weekDone: done });
  void f;
});

test('steady accumulation grades A/B; steady distribution grades D/E with a warning; random walk is near the middle', () => {
  // accumulation: up days on 1.6× volume closing high, down days on 0.6× volume
  const acc = make(160, (i) => (i % 3 === 0 ? [-0.6, 0.6, -0.2] : [1.2, 1.6, 0.7]));
  const fa = accumulationFigures(acc, { weekDone: done });
  assert.ok(fa.accS! >= 75, `accumulation score ${fa.accS}`);
  assert.ok(['A', 'B'].includes(fa.accG!), fa.accG!);
  assert.ok(fa.accD! > fa.disD!);
  assert.ok(fa.cmf65! > 0.2 && fa.udv50! > 1.5);
  assert.equal(fa.distWarn, 0);
  // distribution: down days on heavy volume closing low, up days on light volume
  const dis = make(160, (i) => (i % 3 === 0 ? [0.6, 0.6, 0.2] : [-1.2, 1.6, -0.7]), 300);
  const fd = accumulationFigures(dis, { weekDone: done });
  assert.ok(fd.accS! <= 30, `distribution score ${fd.accS}`);
  assert.ok(['D', 'E'].includes(fd.accG!), fd.accG!);
  assert.equal(fd.distWarn, 1);
  // flat, no volume pattern
  const flat = make(160, (i) => [i % 2 ? 0.5 : -0.5, 1, 0]);
  const ff = accumulationFigures(flat, { weekDone: done });
  assert.ok(ff.accS! >= 35 && ff.accS! <= 65, `neutral score ${ff.accS}`);
  assert.equal(ff.accG && ['C', 'D', 'B'].includes(ff.accG), true);
});

test('stealth accumulation: OBV at its high while price is still below its own', () => {
  // price falls 20% on light volume, then drifts up on heavy-volume up days — OBV recovers faster than price
  const b = make(160, (i) => (i < 60 ? [0.4, 1, 0.3] : i < 110 ? [i % 2 ? -0.9 : 0.2, 0.5, -0.2] : [i % 3 === 0 ? -0.3 : 0.5, i % 3 === 0 ? 0.4 : 2.2, 0.5]));
  const f = accumulationFigures(b, { weekDone: done });
  assert.equal(f.obvLead, 1, `obvLead ${f.obvLead}`);
});

test('quiet pullback: price below its 50-bar high on light down volume', () => {
  const b = make(120, (i) => (i < 105 ? [i % 2 ? -0.3 : 0.8, 1.2, 0.4] : [i % 2 ? -0.8 : 0.2, 0.5, -0.3]));
  const f = accumulationFigures(b, { weekDone: done });
  assert.equal(f.vdu, 1);
  const heavy = make(120, (i) => (i < 105 ? [i % 2 ? -0.3 : 0.8, 1.2, 0.4] : [i % 2 ? -0.8 : 0.2, 2, -0.3]));
  assert.equal(accumulationFigures(heavy, { weekDone: done }).vdu, 0);
});

test('too little history or no volume → no score, explained', () => {
  const short = make(ACC_RULES.minBars - 1, () => [0.5, 1, 0.5]);
  assert.equal(accumulationFigures(short).accS, null);
  const noVol = make(120, () => [0.5, 1, 0.5]); noVol.v = noVol.v.map(() => 0);
  assert.equal(accumulationFigures(noVol).accS, null);
  assert.match(accExplain(accumulationFigures(short), 'session')[0], /needs 70 sessions/);
});

test('history prefix: figures for an earlier bar do not change when later bars are added', () => {
  const b = make(150, (i) => (i % 4 === 0 ? [-0.7, 0.8, -0.3] : [0.9, 1.3, 0.5]));
  const cut = (k: number): B => ({ d: b.d.slice(0, k), o: b.o.slice(0, k), h: b.h.slice(0, k), l: b.l.slice(0, k), c: b.c.slice(0, k), v: b.v.slice(0, k) });
  const a = accumulationFigures(cut(120), { weekDone: done, daily: false });
  const s = accumulationSeries(b);
  const s120 = accumulationSeries(cut(120));
  assert.deepEqual(s.kind.slice(0, 120), s120.kind);
  assert.deepEqual(s.cmf21.slice(0, 120), s120.cmf21);
  assert.ok(a.accS != null);
});

test('scores, grades and the explanation', () => {
  assert.equal(accGrade(80), 'A'); assert.equal(accGrade(79), 'B'); assert.equal(accGrade(45), 'C'); assert.equal(accGrade(29), 'E'); assert.equal(accGrade(null), null);
  const mid = accScore({ cmf65: null, accD: null, disD: null, udv50: null, obvSlope: null, obvLead: null, bigUpW: null, bigDnW: null, vdu: null });
  assert.equal(mid.score, 50, 'unknown parts count as neutral');
  const top = accScore({ cmf65: 0.3, accD: 8, disD: 0, udv50: 2, obvSlope: 0.5, obvLead: 1, bigUpW: 3, bigDnW: 0, vdu: 1 });
  assert.equal(top.score, 100);
  const lines = accExplain(accumulationFigures(make(160, (i) => (i % 3 === 0 ? [-0.6, 0.6, -0.2] : [1.2, 1.6, 0.7])), { weekDone: done }), 'session', 'IN');
  assert.match(lines[0], /^Accumulation [AB]/);
  assert.ok(lines.some((l) => /not who did it/.test(l)));
});

test('India delivery %: 10-session average and change vs the 40 before; too few values → null', () => {
  const d = [...Array(40).fill(40), ...Array(10).fill(55)];
  assert.deepEqual(deliveryFigures(d), { dlv10: 55, dlvChg: 15 });
  assert.deepEqual(deliveryFigures([50, 60]), { dlv10: null, dlvChg: null });
  assert.deepEqual(deliveryFigures([...Array(10).fill(50)]), { dlv10: 50, dlvChg: null });
});
