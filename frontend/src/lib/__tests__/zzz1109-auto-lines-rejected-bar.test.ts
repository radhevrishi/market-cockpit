// zzz1109 (deep audit N09) — when a bar is rejected (low ≤ 0), every touch / anchor date in the chart payload and the list still
// belongs to the candle whose price it was detected on; the headline says how many bars were left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoLines } from '../auto-lines';
import type { Bar } from '../chart-math';
import { alnPayload, autoLinesHeadline, autoLinesRows, DEFAULT_ALN_PREFS } from '../../components/charts/auto-lines-view';

const DAY = 86_400_000, T0 = Date.UTC(2024, 0, 1);
const bar = (i: number, c: number): Bar => ({ t: T0 + i * DAY, o: c, h: c + 0.5, l: c - 0.5, c, v: 1e6 });
const clean = (n: number, shift = 0): Bar[] => Array.from({ length: n }, (_, i) => bar(i + shift, 100 + 0.2 * i + 0.5 + 10 * Math.abs(Math.sin((Math.PI * (i - 20)) / 40))));

test('a bad leading bar: payload times match the clean run exactly', () => {
  const good = clean(130, 1);
  const withBad: Bar[] = [{ t: T0, o: 100, h: 101, l: -5, c: 100, v: 1 }, ...good];
  const rClean = autoLines(good, { tf: 'D' }), rBad = autoLines(withBad, { tf: 'D' });
  assert.equal(rBad.rejected, 1);
  const pClean = alnPayload(good, rClean, DEFAULT_ALN_PREFS, false, 2), pBad = alnPayload(withBad, rBad, DEFAULT_ALN_PREFS, false, 2);
  assert.ok(pClean.lines.length >= 1);
  assert.deepEqual(pBad.lines.map((l) => [l.tA, l.touches]), pClean.lines.map((l) => [l.tA, l.touches]));
  // every touch price is within the candle at its timestamp
  const byT = new Map(withBad.map((b) => [b.t, b]));
  for (const l of pBad.lines) for (const [t, p] of l.touches) { const b = byT.get(t)!; assert.ok(p >= b.l - 1 && p <= b.h + 1, `touch ${p} on ${new Date(t).toISOString()}`); }
  assert.deepEqual(autoLinesRows(withBad, rBad, 'D').map((r) => r.detail), autoLinesRows(good, rClean, 'D').map((r) => r.detail));
  assert.match(autoLinesHeadline(rBad, 'D', 'ready'), /1 bad bar left out/);
});

test('a bad middle bar: anchors after it keep their own dates', () => {
  const b = clean(130);
  b[70] = { ...b[70], l: 0 };
  const r = autoLines(b, { tf: 'D' });
  assert.equal(r.rejected, 1);
  const valid = b.filter((x) => x.l > 0);
  const p = alnPayload(b, r, DEFAULT_ALN_PREFS, false, 2);
  for (const l of p.lines) for (const [t] of l.touches) assert.ok(valid.some((x) => x.t === t));
  for (const l of r.trend) for (const tch of l.touches) assert.ok(Math.abs(valid[tch.i].l - tch.price) < 5 || Math.abs(valid[tch.i].h - tch.price) < 5);
});
