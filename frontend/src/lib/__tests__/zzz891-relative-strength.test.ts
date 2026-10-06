// zzz891 — relative strength against the index. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retOver, indexReturnsFrom, rsVsIndex } from '../relative-strength';

test('returns over sessions from an ascending series', () => {
  const close = Array.from({ length: 300 }, (_, i) => 100 + i);   // 100 … 399
  assert.equal(retOver(close, 21), Math.round(((399 / 378) - 1) * 1000) / 10);
  assert.equal(retOver([1, 2], 21), null);
  const idx = indexReturnsFrom('NIFTY 50', close.map((_, i) => Date.UTC(2026, 0, 1) + i * 86400000), close);
  assert.equal(idx.asOf, '2026-10-27'); assert.ok(idx.r12m! > 0);
});
const IDX = { index: 'NIFTY 50', asOf: '2026-10-05', r1m: 2, r3m: 6, r6m: 10, r12m: 15 };
test('a stock up 20% over 3 months in a market up 25% is lagging', () => {
  const rs = rsVsIndex({ perf3m: 20 }, { ...IDX, r3m: 25 });
  assert.equal(rs.rel3m, -5); assert.equal(rs.verdict, 'LAGGING'); assert.match(rs.text, /Trailing NIFTY 50: 3M -5 pts/);
});
test('leading on every window; mixed when windows disagree and 3M is small', () => {
  assert.equal(rsVsIndex({ perf1m: 5, perf3m: 12, perf6m: 20, perf1y: 40 }, IDX).verdict, 'LEADING');
  assert.equal(rsVsIndex({ perf1m: 5, perf3m: 8, perf6m: 5, perf1y: 10 }, IDX).verdict, 'MIXED');
  assert.equal(rsVsIndex({ perf1m: -5, perf3m: 20, perf6m: 5, perf1y: 10 }, IDX).verdict, 'LEADING');
  assert.equal(rsVsIndex({}, IDX).verdict, 'NO_DATA'); assert.equal(rsVsIndex({ perf3m: 5 }, null).verdict, 'NO_DATA');
});
