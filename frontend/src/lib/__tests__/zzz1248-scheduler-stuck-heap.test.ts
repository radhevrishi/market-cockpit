// zzz1248 — the heap guard blocked every scheduled job for ~18 hours (heap stuck at 2.8 GB, nothing running).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSelfRestart, HEAP_STUCK_RESTART_MIN, SELF_RESTART_GAP_MIN, APP_JOBS } from '../app-scheduler';

const MIN = 60_000, now = Date.parse('2026-11-10T12:00:00Z');
test('restart only when stuck long enough, nothing running, and not restarted recently', () => {
  assert.equal(shouldSelfRestart(0, now, 0, null), false);
  assert.equal(shouldSelfRestart(now - (HEAP_STUCK_RESTART_MIN - 1) * MIN, now, 0, null), false);
  assert.equal(shouldSelfRestart(now - HEAP_STUCK_RESTART_MIN * MIN, now, 0, null), true);
  assert.equal(shouldSelfRestart(now - 60 * MIN, now, 1, null), false);   // a job is running: wait for it
  assert.equal(shouldSelfRestart(now - 60 * MIN, now, 0, now - 30 * MIN), false);
  assert.equal(shouldSelfRestart(now - 60 * MIN, now, 0, now - SELF_RESTART_GAP_MIN * MIN), true);
});
test('India gainers backup has later slots before midnight IST', () => {
  assert.deepEqual(APP_JOBS.find((j) => j.name === 'gainers-in-backup')!.crons, ['41 11,14,17 * * 1-5']);
});
