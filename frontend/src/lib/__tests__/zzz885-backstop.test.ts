// zzz885 — backstop scheduler decisions. No network, no clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueBackstops, BACKSTOP_JOBS, type BackstopJob } from '../backstop-scheduler';

const job: BackstopJob = { name: 'prewarm-earnings', slotsUtc: ['03:07', '14:07'], path: () => '/x', method: 'POST', graceMin: 45 };

test('runs when the slot passed, grace is over and no success since the slot', () => {
  const d = dueBackstops(new Date('2026-10-06T04:00:00Z'), [job], { 'prewarm-earnings': '2026-09-28T09:35:00Z' });
  assert.equal(d.length, 1);
  assert.equal(d[0].lockKey, 'backstop:v1:prewarm-earnings:2026-10-06T03:07');
});
test('does nothing when GitHub already ran it after the slot', () => {
  assert.equal(dueBackstops(new Date('2026-10-06T04:00:00Z'), [job], { 'prewarm-earnings': '2026-10-06T03:20:00Z' }).length, 0);
});
test('waits during the grace period and stops after the window', () => {
  assert.equal(dueBackstops(new Date('2026-10-06T03:30:00Z'), [job], {}).length, 0);
  assert.equal(dueBackstops(new Date('2026-10-06T07:30:00Z'), [job], {}).length, 0);
});
test('a slot late in the evening is still caught after midnight', () => {
  const late: BackstopJob = { ...job, slotsUtc: ['23:30'] };
  const d = dueBackstops(new Date('2026-10-07T00:30:00Z'), [late], {});
  assert.equal(d.length, 1);
  assert.equal(d[0].slot.toISOString(), '2026-10-06T23:30:00.000Z');
});
test('hub-ingest path carries the month; next month rolls the year', () => {
  const hub = BACKSTOP_JOBS.find((j) => j.name === 'hub-ingest-next')!;
  assert.match(hub.path(new Date('2026-12-20T18:00:00Z')), /month=2027-01$/);
});
