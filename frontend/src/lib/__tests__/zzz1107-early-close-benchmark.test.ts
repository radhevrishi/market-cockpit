// zzz1107 (deep audit N05) — the daily screener reads the exchange calendar: on the 27 Nov 2026 early close (13:00 ET) a bar for
// that day is complete at 13:30 ET; ordinary days, holidays and India unchanged.
// zzz1108 (N06) — Mansfield RS never uses an index close more than one week old.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveSessionBar, usSessionOpen } from '../screener/tech';
import { mansfieldRs } from '../stage-analysis';

test('early close: 27 Nov 2026 13:30 ET → session closed, bar complete; 12:59 ET → still live', () => {
  assert.equal(usSessionOpen(new Date('2026-11-27T18:30:00Z')), false);
  assert.equal(liveSessionBar('2026-11-27', 'US', new Date('2026-11-27T18:30:00Z')), false);
  assert.equal(liveSessionBar('2026-11-27', 'US', new Date('2026-11-27T17:59:00Z')), true);
  assert.equal(liveSessionBar('2026-11-27', 'US', new Date('2026-11-27T18:01:00Z')), false);
});

test('ordinary close, DST and India', () => {
  // 15:59 / 16:01 New York in summer (EDT, UTC−4) and winter (EST, UTC−5)
  assert.equal(liveSessionBar('2026-07-15', 'US', new Date('2026-07-15T19:59:00Z')), true);
  assert.equal(liveSessionBar('2026-07-15', 'US', new Date('2026-07-15T20:01:00Z')), false);
  assert.equal(liveSessionBar('2026-12-15', 'US', new Date('2026-12-15T20:59:00Z')), true);
  assert.equal(liveSessionBar('2026-12-15', 'US', new Date('2026-12-15T21:01:00Z')), false);
  assert.equal(usSessionOpen(new Date('2026-11-26T16:00:00Z')), false, 'Thanksgiving: closed');
  assert.equal(usSessionOpen(new Date('2026-07-15T15:00:00Z')), true);
  // India 15:29 / 15:31 IST
  assert.equal(liveSessionBar('2026-10-19', 'IN', new Date('2026-10-19T09:59:00Z')), true);
  assert.equal(liveSessionBar('2026-10-19', 'IN', new Date('2026-10-19T10:01:00Z')), false);
  assert.equal(liveSessionBar('2026-10-16', 'US', new Date('2026-10-19T15:00:00Z')), false, 'an older bar is never live');
});

const weeks = (n: number) => Array.from({ length: n }, (_, i) => {
  const wk = new Date(Date.UTC(2024, 0, 1) + i * 7 * 86_400_000).toISOString().slice(0, 10);
  const c = 100 * (1 + i * 0.01);
  return { wk, o: c, h: c, l: c, c, v: 1 };
});

test('stale index: 80 stock weeks, 60 index weeks → from the second missing week on, no RS', () => {
  const w = weeks(80);
  const bench = new Map(w.slice(0, 60).map((x) => [x.wk, 50]));
  const rs = mansfieldRs(w, bench);
  assert.ok(rs[59] != null, 'aligned weeks still have RS');
  assert.ok(rs[60] != null, 'one week carried (a single missing index week)');
  for (let i = 61; i < 80; i++) assert.equal(rs[i], null, `week ${i}`);
});

test('one missing index week is carried; aligned half-price index gives zero; no index gives null', () => {
  const w = weeks(70).map((x) => ({ ...x, c: 100 }));
  const bench = new Map(w.filter((_, i) => i !== 65).map((x) => [x.wk, 50]));
  const rs = mansfieldRs(w, bench);
  assert.equal(rs[65], 0);
  assert.equal(rs[69], 0);
  assert.ok(mansfieldRs(w, null).every((x) => x === null));
});
