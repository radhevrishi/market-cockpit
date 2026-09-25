// zzz805 — "⟳ Hard re-scan" on the US Earnings Opportunities page looked stuck:
// "0 filers · 0 graded · the server is grading 2026-09-24" for ever, on a day
// EDGAR had 14 earnings filers. The page sent force=1 on every poll, the server
// re-queued the day on every force, and a finished grade could never be
// delivered. These tests pin the fixed contract.
// Run: npx tsx --test src/lib/__tests__/zzz805-us-rescan.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GradeQueue, decideCacheOnly, classifyFilerFetch, dayStatusLine, planDayRequest, pollDelayMs,
  failureBackoffMs,
} from '../us-rescan';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('zzz805 — force means re-grade ONCE', () => {
  test('a forced probe for a day already queued or running is only a progress question', () => {
    assert.deepEqual(decideCacheOnly({ known: true, force: true, cacheHit: true, last: null, now: 0 }), { kind: 'pending' });
    assert.deepEqual(decideCacheOnly({ known: false, force: true, cacheHit: true, last: null, now: 0 }), { kind: 'enqueue', force: true });
    assert.deepEqual(decideCacheOnly({ known: false, force: false, cacheHit: true, last: null, now: 0 }), { kind: 'serve-cache' });
    assert.deepEqual(decideCacheOnly({ known: false, force: false, cacheHit: false, last: null, now: 0 }), { kind: 'enqueue', force: false });
  });

  test('page plan: force on the first request of a re-scan only, then plain polls', () => {
    assert.deepEqual(planDayRequest({ cached: { stale: false }, rescanRequested: true, forceAlreadySent: false, awaitingServer: false }),
      { action: 'ask-server', force: true, keepShowing: true });
    assert.deepEqual(planDayRequest({ cached: { stale: false }, rescanRequested: true, forceAlreadySent: true, awaitingServer: true }),
      { action: 'ask-server', force: false, keepShowing: true });
    assert.deepEqual(planDayRequest({ cached: { stale: false }, rescanRequested: true, forceAlreadySent: true, awaitingServer: false }),
      { action: 'use-cache' });
    assert.deepEqual(planDayRequest({ cached: { stale: false }, rescanRequested: false, forceAlreadySent: false, awaitingServer: false }),
      { action: 'use-cache' });
  });

  test('a day graded by an older engine stays on screen and is refreshed through the queue, without force', () => {
    assert.deepEqual(planDayRequest({ cached: { stale: true }, rescanRequested: false, forceAlreadySent: false, awaitingServer: false }),
      { action: 'ask-server', force: false, keepShowing: true });
  });

  test('end to end: a hard re-scan of one day grades it exactly once and the page receives the result', async () => {
    let runs = 0;
    const cache = new Map<string, { by_tier: object; n: number }>();
    const q = new GradeQueue(async (key) => { runs++; await tick(); cache.set(key, { by_tier: {}, n: runs }); return { ok: true }; });
    // The server's cache_only handler, as the route implements it.
    const probe = (key: string, force: boolean) => {
      if (q.known(key)) return { pending: true };
      if (force) { cache.delete(key); q.enqueue(key, true); return { pending: true }; }
      const d = decideCacheOnly({ known: false, force: false, cacheHit: cache.has(key), last: q.lastRun(key), now: Date.now() });
      if (d.kind === 'serve-cache') return cache.get(key)!;
      if (d.kind === 'failed') return { source_failed: true };
      q.enqueue(key, false);
      return { pending: true };
    };
    // The page: previous grade cached, owner presses Hard re-scan.
    const key = '2026-09-24|1';
    cache.set(key, { by_tier: {}, n: 0 });
    const forced = new Set<string>(); const awaiting = new Set<string>();
    let got: any = null;
    for (let poll = 0; poll < 20 && !got?.by_tier; poll++) {
      const plan = planDayRequest({ cached: { stale: false }, rescanRequested: true, forceAlreadySent: forced.has(key), awaitingServer: awaiting.has(key) });
      assert.equal(plan.action, 'ask-server');
      if (plan.action !== 'ask-server') break;
      if (plan.force) forced.add(key);
      awaiting.add(key);
      got = probe(key, plan.force);
      await tick(); await tick();
    }
    assert.ok(got?.by_tier, 'the re-graded day was delivered');
    assert.equal(got.n, 1, 'and it is the NEW grade, not the old one');
    assert.equal(runs, 1, 'graded once — not once per poll');
  });
});

describe('zzz805 — the queue always settles and remembers how', () => {
  test('one at a time, never queued twice, and a thrown runner is recorded as a failure', async () => {
    const order: string[] = [];
    const q = new GradeQueue(async (key) => {
      order.push(key); await tick();
      if (key === 'b') throw new Error('SEC 403');
      return { ok: true };
    });
    q.enqueue('a'); q.enqueue('b'); q.enqueue('a'); q.enqueue('b');
    assert.equal(q.place('a'), 1);
    assert.equal(q.place('b'), 2);
    assert.equal(q.length(), 2);
    for (let i = 0; i < 10; i++) await tick();
    assert.deepEqual(order, ['a', 'b']);
    assert.equal(q.known('a') || q.known('b'), false, 'nothing is left "grading"');
    assert.equal(q.lastRun('a')?.ok, true);
    assert.equal(q.lastRun('b')?.ok, false);
    assert.match(String(q.lastRun('b')?.error), /403/);
  });

  test('a failed day is reported as failed with a back-off, not polled as grading for ever', () => {
    const now = 1_000_000;
    const d = decideCacheOnly({ known: false, force: false, cacheHit: false, last: { at: now - 10_000, ok: false, error: 'SEC 429', failures: 1 }, now });
    assert.equal(d.kind, 'failed');
    if (d.kind === 'failed') { assert.match(d.error, /429/); assert.ok(d.retryInMs > 0 && d.retryInMs <= 60_000); }
    // once the back-off has passed, it is retried
    const later = decideCacheOnly({ known: false, force: false, cacheHit: false, last: { at: now - 61_000, ok: false, error: 'x', failures: 1 }, now });
    assert.deepEqual(later, { kind: 'enqueue', force: false });
    assert.ok(failureBackoffMs(3) > failureBackoffMs(1), 'back-off grows so a blocked SEC IP is not hammered');
  });

  test('progress is measured per filer and cleared when the run ends', async () => {
    let release!: () => void;
    const q = new GradeQueue(() => new Promise((res) => { release = () => res({ ok: true }); }));
    q.enqueue('d|1');
    await tick();
    q.setProgress('d|1', { stage: 'reading each filer’s XBRL', done: 0, total: 14 });
    q.tick('d|1'); q.tick('d|1'); q.tick('d|1');
    assert.deepEqual({ done: q.getProgress('d|1')!.done, total: q.getProgress('d|1')!.total }, { done: 3, total: 14 });
    release(); await tick(); await tick();
    assert.equal(q.getProgress('d|1'), null);
  });
});

describe('zzz805 — silence never passes', () => {
  test('a filer list that could not be fetched is a failure, never an empty day', () => {
    assert.equal(classifyFilerFetch(['2026-09-24'], [undefined], '2026-09-24').status, 'failed');
    assert.deepEqual(classifyFilerFetch(['2026-09-24', '2026-09-23'], [[1, 2], null], '2026-09-24'),
      { status: 'partial', failed: ['2026-09-23'], found: 2 });
    assert.equal(classifyFilerFetch(['2026-09-25'], [[]], '2026-09-25').status, 'none-yet', 'today, nothing on EDGAR yet');
    assert.equal(classifyFilerFetch(['2026-09-20'], [[]], '2026-09-25').status, 'ok', 'a past day with genuinely no filers');
    assert.equal(classifyFilerFetch(['2026-09-24'], [new Array(14).fill(0)], '2026-09-24').found, 14);
  });

  test('the page says what is happening, in numbers', () => {
    assert.equal(dayStatusLine({ date: '2026-09-24', grading: true, progress: { stage: 'reading each filer’s XBRL', done: 3, total: 14 } }),
      '2026-09-24: graded 3 of 14 filers (reading each filer’s XBRL).');
    assert.match(dayStatusLine({ date: '2026-09-24', grading: true, place: 3 }), /2 sessions ahead/);
    const f = dayStatusLine({ date: '2026-09-24', failed: true, error: 'SEC 403', retryInMs: 180_000 });
    assert.match(f, /could not be fetched from SEC EDGAR/);
    assert.match(f, /will retry in about 3 min/);
    assert.doesNotMatch(f, /0 filers/);
  });

  test('polling slows down for a failure and stays bounded', () => {
    assert.ok(pollDelayMs({ failed: true, retryInMs: 180_000 }) >= 180_000);
    assert.ok(pollDelayMs({ failed: true, retryInMs: 10 * 3600_000 }) <= 10 * 60_000);
    assert.equal(pollDelayMs({ readFailed: true }), 2_500);
    assert.ok(pollDelayMs({ place: 1 }) < pollDelayMs({ place: 4 }));
    assert.ok(pollDelayMs({ place: 50 }) <= 150_000);
  });
});
