// zzz1291 — Market Leadership performance + cycles: period returns, weekly closes, 20% turning points, cycle "led by", theme board.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { periodReturns, weeklyCloses, turningPoints, marketCycles, themeBoard, memberScore } from '../market-leadership/perf';

const days = (n: number, f: (i: number) => number, start = '2020-01-01') => { const d: string[] = [], c: number[] = []; const t0 = Date.parse(start); for (let i = 0; i < n; i++) { d.push(new Date(t0 + i * 86_400_000).toISOString().slice(0, 10)); c.push(f(i)); } return { d, c }; };
test('period returns by sessions and by date', () => {
  const s = days(400, (i) => 100 + i);
  const r = periodReturns(s);
  assert.equal(r.d1, +((499 / 498 - 1) * 100).toFixed(1));
  assert.ok(r.y1! > 0 && r.ytd != null);
  assert.equal(periodReturns(null).d1, null);
});
test('weekly closes keep the last close of each week', () => {
  const w = weeklyCloses(days(21, (i) => i + 1, '2024-01-01'));   // Mon 1 Jan 2024
  assert.equal(w.c.length, 3); assert.equal(w.c[0], 7);
});
test('turning points need a 20% move the other way; cycles read gain, fall and leaders', () => {
  const path_ = [100, 110, 130, 150, 160, 140, 120, 110, 100, 120, 150, 200, 240, 230];
  const w = { d: path_.map((_, i) => new Date(Date.parse('2001-01-01') + i * 7 * 86_400_000).toISOString().slice(0, 10)), c: path_ };
  const pts = turningPoints(w, 0.2);
  assert.deepEqual(pts.map((p) => p.kind), ['trough', 'peak', 'trough']);
  const sector = { name: 'Tech', s: { d: w.d, c: w.c.map((v, i) => v * (1 + i / 10)) } };
  const { cycles } = marketCycles(w, [sector], 'us', 0.2);
  assert.equal(cycles.length, 2);
  assert.equal(cycles[0].gainPct, 60); assert.equal(cycles[0].fall?.depthPct, -37); assert.equal(cycles[0].fall?.cause, 'Dot-com bust');
  assert.equal(cycles[1].current, true); assert.equal(cycles[1].gainPct, 130); assert.equal(cycles[1].ledBy[0].name, 'Tech');
});
test('theme board: members joined, median, best first; Stage 2 + RS + growth rank higher', () => {
  const rows = [{ t: 'AAA', n: 'A', px: 95, hi52: 100, twSt: 2, revQYoY: 40, r40: 50, perf1M: 10 }, { t: 'BBB', n: 'B', px: 50, hi52: 100, twSt: 4, revQYoY: -5, perf1M: -10 }];
  const [t] = themeBoard([{ id: 'x', name: 'X', emoji: '', group: 'g', members: ['AAA', 'BBB.NS', 'ZZZ'] }], rows, new Map([['AAA', 90], ['BBB', 20]]));
  assert.equal(t.found, 2); assert.equal(t.best[0].t, 'AAA'); assert.equal(t.med.m1, 0);
  assert.ok(memberScore({ ...t.best[0] }).why.includes('Stage 2'));
});
test('wired: route, tabs, cycle panel names', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
  assert.match(read('app/api/market/leadership-perf/route.ts'), /buildPerf/);
  assert.match(read('components/market-leadership/MarketLeadership.tsx'), /'performance'.*'cycles'/s);
  assert.match(read('components/dashboard/theme-rotation/CyclePanel.tsx'), /BestCompanies/);
});
