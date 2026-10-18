// zzz1095 (evening retest R3) — the trader-setup wrapper (lastBarForming / completedBars) uses the exchange calendar for MONTHLY
// bars too: a July 2026 US month is complete at the 31 July close (20:00 UTC, summer time), not at midnight UTC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastBarForming, completedBars } from '../../components/charts/setup-view';

const julyBar = Date.UTC(2026, 6, 1);   // a monthly candle dated at its first day
test('US monthly: forming before the 31 Jul close, complete at 21:00 UTC (the retest case)', () => {
  assert.equal(lastBarForming(julyBar, 'M', 'US', Date.UTC(2026, 6, 31, 19, 0)), true);
  assert.equal(lastBarForming(julyBar, 'M', 'US', Date.UTC(2026, 6, 31, 21, 0)), false);
  const bars = [{ t: Date.UTC(2026, 5, 1) }, { t: julyBar }];
  assert.equal(completedBars(bars, 'M', 'US', Date.UTC(2026, 6, 31, 21, 0)).dropped, false);
  assert.equal(completedBars(bars, 'M', 'US', Date.UTC(2026, 6, 31, 15, 0)).dropped, true);
});
test('India monthly: complete after the 15:30 IST close on the last trading day', () => {
  assert.equal(lastBarForming(julyBar, 'M', 'IN', Date.UTC(2026, 6, 31, 9, 0)), true);
  assert.equal(lastBarForming(julyBar, 'M', 'IN', Date.UTC(2026, 6, 31, 10, 30)), false);
});
