// zzz1079 — retest B04: weekly completion, pattern bar aggregation and the daily session close all use the exchange calendar
// (holidays, 13:00 ET early closes, DST), so chart, pattern scan, stage and setups agree on the same boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekComplete, sessionCloseMs, weekCloseMs } from '../completed-weeks';
import { periodCloseT, aggregateBars } from '../bar-aggregate';
import { sessionCloseUtc } from '../exchange-calendar';

const at = (iso: string) => Date.parse(iso);
const DAY = 86_400_000;

test('day after Thanksgiving 2026 (Fri 27 Nov, 13:00 ET close): the week is complete at 13:30 ET, not 16:00', () => {
  const now = at('2026-11-27T18:30:00Z');   // 13:30 ET (winter, UTC−5)
  assert.equal(sessionCloseUtc('US', '2026-11-27'), at('2026-11-27T18:00:00Z'));
  assert.equal(weekComplete('2026-11-23', 'US', now), true);
  assert.equal(weekComplete('2026-11-23', 'US', at('2026-11-27T17:59:00Z')), false, 'not before the 13:00 close');
  assert.equal(sessionCloseMs(at('2026-11-27T00:00:00Z'), 'US'), at('2026-11-27T18:00:00Z'), 'the daily setup clock agrees');
});

test('Good Friday 2026 (3 Apr, NYSE closed): the week ends at the Thursday close', () => {
  assert.equal(weekCloseMs('2026-03-30', 'US'), at('2026-04-02T20:00:00Z'));   // 16:00 ET summer time
  assert.equal(weekComplete('2026-03-30', 'US', at('2026-04-02T20:01:00Z')), true);
  // and the pattern bars use the same boundary
  assert.equal(periodCloseT(at('2026-03-30T13:30:00Z'), 'W', 'US'), at('2026-04-02T20:00:00Z'));
});

test('a normal Friday: unchanged (16:00 ET / 15:30 IST); without a market the old conservative rule stays', () => {
  assert.equal(weekCloseMs('2026-10-12', 'US'), at('2026-10-16T20:00:00Z'));
  assert.equal(weekCloseMs('2026-10-12', 'IN'), at('2026-10-16T10:00:00Z'));
  assert.equal(periodCloseT(at('2026-10-12T03:45:00Z'), 'W'), at('2026-10-17T00:00:00Z'), 'no market: Saturday 00:00 UTC as before');
  assert.equal(weekCloseMs('2026-10-12', null), at('2026-10-16T20:00:00Z'), 'unknown market: the later of the two closes');
});

test('month: complete at its last session close (US Dec 2026 ends Thu 31 Dec, a trading day); DST respected', () => {
  assert.equal(periodCloseT(at('2026-12-01T14:30:00Z'), 'M', 'US'), at('2026-12-31T21:00:00Z'));
  assert.equal(periodCloseT(at('2026-07-01T13:30:00Z'), 'M', 'US'), at('2026-07-31T20:00:00Z'));
});

test('aggregateBars with a market: the Good-Friday week is a completed weekly bar on Thursday evening', () => {
  const daily = ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02'].map((d, i) => ({ t: at(`${d}T13:30:00Z`), o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 }));
  const now = new Date(at('2026-04-02T21:00:00Z'));
  assert.equal(aggregateBars(daily, 'W', { now, market: 'US' }).bars.length, 1, 'exchange clock: complete');
  assert.equal(aggregateBars(daily, 'W', { now }).bars.length, 0, 'old clock would still call it open');
  void DAY;
});
