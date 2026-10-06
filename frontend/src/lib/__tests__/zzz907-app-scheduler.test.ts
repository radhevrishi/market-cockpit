// zzz907 — the app scheduler's decisions. No network, no clock: every test injects its time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCron, prevCronSlot, nextCronSlot, prevSlot, nextSlot, dueSlot, slotWindowMs, lockTtlSec, lockKeyFor, shouldRetry,
  lockSettlesSlot, maxGapHours, staleAfterHoursFor, aiVerifyNext, guidanceExtractNext, ledgerPassComplete, aiEvalPasses,
  APP_JOBS, MAX_WINDOW_MIN, type AppJob, type JobCtx, type CallResult,
} from '../app-scheduler';

const at = (iso: string) => new Date(iso);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const job = (crons: string[], over: Partial<AppJob> = {}): AppJob => ({ name: 'x', crons, timeoutMs: 5 * 60_000, workflow: 'x.yml', does: 'GET /x', run: async () => ({ ok: true, status: 200 }), ...over });
const WF = join(__dirname, '../../../../.github/workflows');

test('cron parsing: lists, ranges, steps, day-of-week 7 = Sunday; rejects junk', () => {
  assert.ok(parseCron('*/15 3-12 * * 1-5'));
  assert.ok(parseCron('45 4-9 * * 1-5'));
  assert.ok(parseCron('0 0 * * 7'));
  assert.equal(parseCron('bad'), null);
  assert.equal(parseCron('61 * * * *'), null);
  assert.equal(parseCron('* * * *'), null);
  assert.equal(iso(prevCronSlot('0 0 * * 7', at('2026-10-06T12:00:00Z'))), '2026-10-04T00:00:00.000Z');   // Sun 4 Oct
});

test('slot due: at and after the slot, not before; same minute counts', () => {
  const j = job(['7 3 * * *']);
  assert.equal(dueSlot(j, at('2026-10-06T03:06:59Z'), null), null, 'before the slot only yesterday’s slot exists, long past its 3-hour window');
  const d = dueSlot(j, at('2026-10-06T03:07:00Z'), null)!;
  assert.equal(d.slot.toISOString(), '2026-10-06T03:07:00.000Z');
  assert.equal(d.lockKey, 'appsched:v1:x:2026-10-06T03:07');
  assert.equal(d.windowEnds.toISOString(), '2026-10-06T06:07:00.000Z');
});

test('slot not due: after its window, or already succeeded in this slot (app run or a hand run from GitHub)', () => {
  const j = job(['7 3 * * *']);
  assert.equal(dueSlot(j, at('2026-10-06T06:07:00Z'), null), null);                       // window (180 min) over
  assert.ok(dueSlot(j, at('2026-10-06T06:06:00Z'), null));
  assert.equal(dueSlot(j, at('2026-10-06T04:00:00Z'), '2026-10-06T03:09:30Z'), null);      // succeeded after the slot
  assert.ok(dueSlot(j, at('2026-10-06T04:00:00Z'), '2026-10-06T03:06:00Z'));                // success BEFORE the slot is yesterday's run
  assert.ok(dueSlot(j, at('2026-10-06T04:00:00Z'), 'garbage'));
});

test('window never reaches the next slot (15-minute and hourly jobs)', () => {
  const ss = job(['*/15 3-12 * * 1-5', '11 13-23 * * *', '11 0-2 * * *']);
  assert.equal(slotWindowMs(ss, at('2026-10-06T03:15:00Z')), 15 * 60_000);
  assert.equal(slotWindowMs(ss, at('2026-10-06T12:45:00Z')), 26 * 60_000);                  // 12:45 → 13:11
  assert.equal(dueSlot(ss, at('2026-10-06T03:29:00Z'), null)!.slot.toISOString(), '2026-10-06T03:15:00.000Z');
  assert.equal(dueSlot(ss, at('2026-10-06T03:30:00Z'), null)!.slot.toISOString(), '2026-10-06T03:30:00.000Z');
  const hourly = job(['35 * * * *']);
  assert.equal(slotWindowMs(hourly, at('2026-10-06T10:35:00Z')), 60 * 60_000);
});

test('weekday rules: a Mon-Fri job has no Saturday slot; Tue-Sat job runs Saturday not Monday', () => {
  const wk = job(['7 4 * * 1-5']);
  assert.equal(dueSlot(wk, at('2026-10-10T04:30:00Z'), null), null);                         // Saturday 10 Oct
  assert.equal(iso(prevSlot(wk.crons, at('2026-10-10T04:30:00Z'))), '2026-10-09T04:07:00.000Z');
  assert.equal(iso(nextSlot(wk.crons, at('2026-10-09T05:00:00Z'))), '2026-10-12T04:07:00.000Z');   // Fri → Mon
  const tueSat = job(['20 1 * * 2-6']);
  assert.ok(dueSlot(tueSat, at('2026-10-10T01:30:00Z'), null));                             // Saturday
  assert.equal(dueSlot(tueSat, at('2026-10-12T01:30:00Z'), null), null);                    // Monday
  const userAlerts = APP_JOBS.find((j) => j.name === 'user-alerts')!;
  assert.equal(iso(nextSlot(userAlerts.crons, at('2026-10-06T09:46:00Z'))), '2026-10-06T15:45:00.000Z');
  assert.equal(iso(nextSlot(userAlerts.crons, at('2026-10-09T19:46:00Z'))), '2026-10-12T04:45:00.000Z');   // Fri night → Mon
});

test('day-of-month and day-of-week both restricted = either matches (standard cron)', () => {
  assert.equal(iso(nextCronSlot('0 0 13 * 5', at('2026-10-06T00:00:00Z'))), '2026-10-09T00:00:00.000Z');   // Friday 9th first
  assert.equal(iso(nextCronSlot('0 0 13 * 5', at('2026-10-10T00:00:00Z'))), '2026-10-13T00:00:00.000Z');   // then the 13th
});

test('month end, year end, leap day, century — all UTC, no daylight-saving shift', () => {
  assert.equal(iso(nextCronSlot('7 18 * * *', at('2026-10-31T18:08:00Z'))), '2026-11-01T18:07:00.000Z');
  assert.equal(iso(nextCronSlot('0 0 29 2 *', at('2026-03-01T00:00:00Z'))), '2028-02-29T00:00:00.000Z');
  assert.equal(iso(nextCronSlot('30 19 * * *', at('2099-12-31T19:31:00Z'))), '2100-01-01T19:30:00.000Z');
  assert.equal(iso(prevCronSlot('0 0 1 * *', at('2026-03-01T00:00:00Z'))), '2026-03-01T00:00:00.000Z');
  // a slot late on the last day is still due after midnight (inside its window)
  const late = job(['30 23 * * *']);
  assert.equal(dueSlot(late, at('2026-10-01T00:30:00Z'), null)!.slot.toISOString(), '2026-09-30T23:30:00.000Z');
  // the US / European clock change (last Sunday of March / October) does not move a UTC slot
  assert.equal(iso(nextCronSlot('30 21 * * 1-5', at('2026-03-27T22:00:00Z'))), '2026-03-30T21:30:00.000Z');
  assert.equal(iso(nextCronSlot('30 21 * * 1-5', at('2026-10-23T22:00:00Z'))), '2026-10-26T21:30:00.000Z');
});

test('lock: TTL covers the job (with its retry) and is shorter than every window, so a run that died is retried in its window', () => {
  for (const j of APP_JOBS) {
    const ttlMs = lockTtlSec(j) * 1000;
    assert.ok(ttlMs >= j.timeoutMs + 60_000, `${j.name}: lock outlives the job`);
    let s = prevSlot(j.crons, at('2026-10-05T00:00:00Z'))!;
    for (let k = 0; k < 200; k++) {
      assert.ok(slotWindowMs(j, s) > ttlMs, `${j.name}: window after ${s.toISOString()} is longer than the lock`);
      s = nextSlot(j.crons, s)!;
    }
  }
  assert.equal(lockKeyFor('a', at('2026-10-06T03:07:00Z')), 'appsched:v1:a:2026-10-06T03:07');
});

test('lock held by another copy: only a "done" lock settles the slot; "running" or unreadable waits', () => {
  assert.equal(lockSettlesSlot({ state: 'done', ok: false }), true);
  assert.equal(lockSettlesSlot(JSON.stringify({ state: 'done', ok: true })), true);
  assert.equal(lockSettlesSlot({ state: 'running' }), false);
  assert.equal(lockSettlesSlot(null), false);                 // Redis failed → skip now, look again next tick (never run)
});

test('retry policy: once, after a 5xx or network error; never a 4xx, an answer status, or a paid-AI call', () => {
  assert.equal(shouldRetry(502, 1), true);
  assert.equal(shouldRetry(0, 1), true);
  assert.equal(shouldRetry(502, 2), false);
  assert.equal(shouldRetry(404, 1), false);
  assert.equal(shouldRetry(200, 1), false);
  assert.equal(shouldRetry(503, 1, { noRetryStatuses: [503] }), false);
  assert.equal(shouldRetry(500, 1, { retry: false }), false);
});

test('staleness comes from the schedule: weekly 7 days, weekday-only spans the weekend, hourly keeps the 25 h alarm', () => {
  const now = at('2026-10-06T12:00:00Z');
  assert.equal(staleAfterHoursFor('ai-eval', 25, now), 7 * 24 + 6);
  assert.equal(staleAfterHoursFor('daily-summary', 25, now), 72 + 6);
  assert.equal(staleAfterHoursFor('ai-verify', 25, now), 25);
  assert.equal(staleAfterHoursFor('ai-verify', 72, now), 72);   // weekend threshold is never lowered
  assert.equal(staleAfterHoursFor('not-a-job', 25, now), null);
  assert.equal(maxGapHours(['35 * * * *'], now), 1);
});

test('loop rounds mirror the workflows', () => {
  assert.deepEqual(aiVerifyNext({ n: 100, usd: 1.5 }, { checked: 30, spentUsd: 0.5, stoppedBy: 'time', queueAfter: 9 }), { again: true, n: 70, usd: 1 });
  assert.equal(aiVerifyNext({ n: 100, usd: 1.5 }, { checked: 30, spentUsd: 0.5, stoppedBy: 'empty', queueAfter: 9 }).again, false);
  assert.equal(aiVerifyNext({ n: 100, usd: 1.5 }, { checked: 30, spentUsd: 1.499, stoppedBy: 'time', queueAfter: 9 }).again, false);
  assert.equal(aiVerifyNext({ n: 10, usd: 1.5 }, { checked: 10, spentUsd: 0.1, stoppedBy: 'time', queueAfter: 9 }).again, false);
  assert.deepEqual(guidanceExtractNext(1.2, { attempted: 5, screened: 3, missingDoc: 1, alreadyDone: 1, queued: 40, skippedBackoff: 2, spentUsd: 0.2, stoppedBy: 'limit' }), { again: true, usd: 1, done: 10 });
  assert.equal(guidanceExtractNext(1.2, { attempted: 0, queued: 40, stoppedBy: 'time' }).again, false);   // nothing done → stop
  assert.equal(guidanceExtractNext(0.03, { attempted: 2, queued: 40, spentUsd: 0.02, stoppedBy: 'time' }).again, false);
  assert.equal(ledgerPassComplete({ skipped_for_time: 0 }), true);
  assert.equal(ledgerPassComplete({ skipped_for_time: 3 }), false);
  assert.equal(aiEvalPasses({ precision: 0.95, recall: 0.8 }), true);
  assert.equal(aiEvalPasses({ precision: 0.89, recall: 0.99 }), false);
  assert.equal(aiEvalPasses({}), false);
});

function fakeCtx(slot: Date, answer: (path: string) => Partial<CallResult>) {
  const calls: Array<{ path: string; method?: string; retry?: boolean }> = [];
  const ctx: JobCtx = {
    slot, deadline: Date.now() + 60 * 60_000, sleep: async () => {}, log: () => {},
    call: async (path, o = {}) => { calls.push({ path, method: o.method, retry: o.retry }); return { status: 200, ok: true, json: {}, text: '', error: null, ms: 0, ...answer(path) }; },
  };
  return { ctx, calls };
}

test('ai-verify job: rounds until the server says stop; paid calls are never retried', async () => {
  const j = APP_JOBS.find((x) => x.name === 'ai-verify')!;
  let n = 0;
  const { ctx, calls } = fakeCtx(at('2026-10-06T10:35:00Z'), () => ({ json: { run: { checked: 10, spentUsd: 0.1, stoppedBy: ++n < 3 ? 'time' : 'empty', queueAfter: 5 } } }));
  const out = await j.run(ctx);
  assert.equal(out.ok, true);
  assert.equal(calls.length, 3);
  assert.match(calls[0].path, /^\/api\/v1\/ai-verify\?limit=100&maxUsd=1\.5000$/);
  assert.match(calls[1].path, /limit=90&maxUsd=1\.4000$/);
  assert.ok(calls.every((c) => c.method === 'POST' && c.retry === false));
  const bad = fakeCtx(at('2026-10-06T10:35:00Z'), () => ({ status: 500, ok: false }));
  assert.equal((await j.run(bad.ctx)).ok, false);
});

test('bridge jobs: bot alerts use GET (their POST is the Telegram webhook), cron routes POST', async () => {
  for (const name of ['movers-alert', 'watchlist-alert', 'eo-blockbuster-morning', 'eo-blockbuster-evening']) {
    const { ctx, calls } = fakeCtx(at('2026-10-06T05:30:00Z'), () => ({}));
    await APP_JOBS.find((x) => x.name === name)!.run(ctx);
    assert.equal(calls[0].method, 'GET', name);
  }
  const { ctx, calls } = fakeCtx(at('2026-10-06T03:07:00Z'), () => ({}));
  await APP_JOBS.find((x) => x.name === 'prewarm-earnings')!.run(ctx);
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [['POST', '/api/v1/cron/prewarm-earnings']]);
});

test('data-watch: 503 (a failing check, already alerted) counts as ran', async () => {
  const j = APP_JOBS.find((x) => x.name === 'data-watch')!;
  assert.equal((await j.run(fakeCtx(at('2026-10-06T05:30:00Z'), () => ({ status: 503, ok: false })).ctx)).ok, true);
  assert.equal((await j.run(fakeCtx(at('2026-10-06T05:30:00Z'), () => ({ status: 401, ok: false })).ctx)).ok, false);
});

test('job list: unique names, valid crons, schedules equal to the libraries that show "next run"', () => {
  const names = APP_JOBS.map((j) => j.name);
  assert.equal(new Set(names).size, names.length);
  for (const j of APP_JOBS) for (const c of j.crons) assert.ok(parseCron(c), `${j.name}: ${c}`);
  const verifySrc = readFileSync(join(__dirname, '../ai-verify.ts'), 'utf8');
  const extractSrc = readFileSync(join(__dirname, '../ai-guidance-extract.ts'), 'utf8');
  assert.ok(verifySrc.includes(`AI_VERIFY_SCHEDULE = '${APP_JOBS.find((j) => j.name === 'ai-verify')!.crons[0]}'`));
  assert.ok(extractSrc.includes(`GUIDANCE_EXTRACT_SCHEDULE = '${APP_JOBS.find((j) => j.name === 'ai-guidance-extract')!.crons[0]}'`));
  assert.ok(MAX_WINDOW_MIN <= 180);
});

test('moved workflows have no schedule left (no double runs) but keep the manual button', () => {
  const moved = new Set(APP_JOBS.map((j) => j.workflow));
  for (const wf of moved) {
    const y = readFileSync(join(WF, wf), 'utf8');
    assert.match(y, /workflow_dispatch:/, `${wf} keeps the Run workflow button`);
    assert.match(y, /lib\/app-scheduler/, `${wf} says where the schedule went`);
    if (wf === 'daily-research.yml') {
      const crons = [...y.matchAll(/cron: '([^']+)'/g)].map((m) => m[1]);
      assert.deepEqual(crons, ['50 10 * * 1-5'], 'only gainers-in stays on GitHub');
    } else {
      assert.ok(!/^\s+schedule:/m.test(y), `${wf} has no schedule`);
    }
  }
  // every workflow that still has a schedule is NOT an app job's workflow (except daily-research's gainers-in)
  for (const f of readdirSync(WF).filter((x) => x.endsWith('.yml'))) {
    if (/^\s+schedule:/m.test(readFileSync(join(WF, f), 'utf8'))) assert.ok(!moved.has(f) || f === 'daily-research.yml', f);
  }
});
