// zzz1047 — accumulation grade A / B needs confirmed evidence, not just a high score (30% of India was A/B on 15 Oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accumulationFigures, accExplain, ACC_GATES, ACC_VERSION } from '../accumulation';

type B = { d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
function make(n: number, step: (i: number) => [number, number, number], base = 100, vol = 1_000_000): B {
  const b: B = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let t = Date.parse('2026-01-05T00:00:00Z'), c = base;
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
    const [chg, vx, cl] = step(i);
    const prev = c; c = +(prev * (1 + chg / 100)).toFixed(4);
    const range = Math.max(prev, c) * 0.02, lo = Math.min(prev, c) - range * 0.25, hi = Math.max(prev, c) + range * 0.25;
    const span = hi - lo, l = c - ((cl + 1) / 2) * span;
    b.d.push(new Date(t).toISOString().slice(0, 10)); b.o.push(prev); b.h.push(+(l + span).toFixed(4)); b.l.push(+l.toFixed(4)); b.c.push(c); b.v.push(Math.round(vol * vx));
    t += 86_400_000;
  }
  return b;
}
const done = () => true;
const steady = (base: number, vol: number) => make(160, (i) => (i % 3 === 0 ? [-0.6, 0.6, -0.2] : [1.2, 1.6, 0.7]), base, vol);

test('version 2 and the published conditions', () => {
  assert.equal(ACC_VERSION, 2);
  assert.deepEqual(ACC_GATES.minTurnover, { US: 5e6, IN: 3e7 });
});

test('liquid, steady accumulation is graded A or B with nothing missing', () => {
  const f = accumulationFigures(steady(100, 1_000_000), { weekDone: done, market: 'US' });   // ≈ $100M+ a day
  assert.ok(['A', 'B'].includes(f.accG!), `${f.accG} ${f.accMiss}`);
  assert.deepEqual(f.accMiss, []);
});

test('the same pattern on ₹0.5 crore a day is not institutional: graded C, the reason named', () => {
  const f = accumulationFigures(steady(50, 10_000), { weekDone: done, market: 'IN' });   // ₹50 × 10k shares ≈ ₹0.5–2 Cr
  assert.ok(f.accS! >= 65, `score ${f.accS}`);
  assert.equal(f.accG, 'C');
  assert.ok(f.accMiss!.some((m) => /traded value ₹.* crore a day \(needs ≥ ₹3 crore\)/.test(m)), String(f.accMiss));
  assert.ok(accExplain(f, 'session', 'IN').some((l) => /not graded A \/ B — not confirmed/.test(l)));
});

test('a high score without accumulation sessions (up days on ordinary volume) is not A / B', () => {
  // rising on steady volume closing high: money flow and OBV look good, but no session clears 1.25× volume
  const b = make(160, (i) => (i % 3 === 0 ? [-0.4, 0.8, -0.2] : [0.9, 1.15, 0.8]));
  const f = accumulationFigures(b, { weekDone: done, market: 'US' });
  assert.notEqual(f.accG, 'A'); assert.notEqual(f.accG, 'B');
  if (f.accS! >= 65) assert.ok(f.accMiss!.some((m) => /accumulation vs .* distribution sessions/.test(m)));
});

test('below the 50-session average: never A / B', () => {
  // long accumulation, then a sharp drop under the 50-session average
  const b = make(160, (i) => (i < 150 ? (i % 3 === 0 ? [-0.6, 0.6, -0.2] : [1.2, 1.6, 0.7]) : [-3, 0.7, -0.3]));
  const f = accumulationFigures(b, { weekDone: done, market: 'US' });
  assert.ok(!['A', 'B'].includes(f.accG!), f.accG!);
});
