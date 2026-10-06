// zzz919 — refresh-bench batched scan + prewarm-earnings time budget. Pure logic, no network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanGradedDays, mergePartial, boundEntries, DAYS_PER_MGET, type ScanDeps } from '../bench-scan';
import { Budget, orderOffsets, nextCursor, ALWAYS_OFFSETS, HARD_MS } from '../prewarm-budget';
import { gradedKeyCandidates, GRADED_CACHE_VERSION } from '../graded-cache-key';

const day = (n: number) => new Date(Date.UTC(2026, 9, 6) - n * 86400_000).toISOString().slice(0, 10);
const payload = (rows: number) => ({ by_tier: { BLOCKBUSTER: Array.from({ length: rows }, (_, i) => ({ ticker: `T${i}` })), STRONG: [] } });

function fakeKv(store: Record<string, any>, clock = { t: 0 }, perCallMs = 0) {
  const calls = { exists: 0, existsKeys: 0, mget: 0, mgetKeys: 0 };
  const deps: ScanDeps = {
    candidates: gradedKeyCandidates,
    exists: async (keys) => { calls.exists++; calls.existsKeys += keys.length; clock.t += perCallMs; return keys.map((k) => k in store); },
    mget: async (keys) => { calls.mget++; calls.mgetKeys += keys.length; clock.t += perCallMs; return keys.map((k) => store[k] ?? null); },
    rowCount: (p) => (p?.by_tier ? Object.values(p.by_tier as any).reduce((n: number, v: any) => n + v.length, 0) : 0),
    adopt: (p) => p,
    isCurrent: (k) => k.startsWith(`graded:${GRADED_CACHE_VERSION}:`),
    now: () => clock.t,
  };
  return { deps, calls, clock };
}

describe('refresh-bench batched scan', () => {
  test('60 empty days cost a handful of calls, not ~2000 (was 60 x 17 x 2 sequential)', async () => {
    const { deps, calls } = fakeKv({});
    const r = await scanGradedDays(Array.from({ length: 60 }, (_, i) => day(i)), deps, Infinity);
    assert.equal(r.days.length, 0);
    assert.equal(r.partial, false);
    assert.equal(calls.mget, 0);
    assert.ok(calls.exists <= 3, `exists pipelines ${calls.exists}`);   // 1020 keys / 500 per chunk handled by kvExistsMany; here one fake call
    assert.equal(calls.existsKeys, 60 * (1 + 16));
  });

  test('reads only the newest existing namespace per day; empty payload falls to the next', async () => {
    const dates = [day(0), day(1), day(2)];
    const store: Record<string, any> = {
      [`graded:${GRADED_CACHE_VERSION}:${dates[0]}`]: payload(3),
      [`graded:${GRADED_CACHE_VERSION}:${dates[1]}`]: payload(0),     // empty current → older namespace answers
      [`graded:v24:${dates[1]}`]: payload(2),
      [`graded:v20:${dates[1]}`]: payload(9),                          // never read
      [`graded:v10:${dates[2]}`]: payload(1),
    };
    const { deps, calls } = fakeKv(store);
    const r = await scanGradedDays(dates, deps, Infinity);
    assert.deepEqual(r.days.map((d) => [d.date, d.key.split(':')[1], d.legacy]),
      [[dates[0], GRADED_CACHE_VERSION, false], [dates[1], 'v24', true], [dates[2], 'v10', true]]);
    assert.equal(calls.mget, 2);          // round 1 (3 days, one MGET) + round 2 (the day whose current key was empty)
    assert.equal(calls.mgetKeys, 4);
  });

  test('payload reads are batched DAYS_PER_MGET at a time', async () => {
    const store: Record<string, any> = {};
    const dates = Array.from({ length: 40 }, (_, i) => day(i));
    for (const d of dates) store[`graded:${GRADED_CACHE_VERSION}:${d}`] = payload(1);
    const { deps, calls } = fakeKv(store);
    const r = await scanGradedDays(dates, deps, Infinity);
    assert.equal(r.days.length, 40);
    assert.equal(calls.mget, Math.ceil(40 / DAYS_PER_MGET));
  });

  test('deadline stops cleanly, newest days first, and says partial', async () => {
    const store: Record<string, any> = {};
    const dates = Array.from({ length: 40 }, (_, i) => day(i));
    for (const d of dates) store[`graded:${GRADED_CACHE_VERSION}:${d}`] = payload(1);
    const { deps } = fakeKv(store, { t: 0 }, 1000);   // every call "takes" 1 s
    const r = await scanGradedDays(dates, deps, 6000);   // exists used 1 s → ~5 MGETs of 4 days
    assert.equal(r.partial, true);
    assert.ok(r.days.length >= 16 && r.days.length < 40);
    assert.deepEqual(r.days.map((d) => d.date), dates.slice(0, r.days.length));   // newest ones, contiguous
    assert.deepEqual(r.skipped, dates.slice(r.days.length));
  });

  test('without EXISTS (null) it still finds data by reading', async () => {
    const dates = [day(0), day(1)];
    const store = { [`graded:v22:${dates[1]}`]: payload(2) };
    const { deps } = fakeKv(store);
    deps.exists = async () => null;
    const r = await scanGradedDays(dates, deps, Infinity);
    assert.equal(r.days.length, 1);
    assert.equal(r.days[0].date, dates[1]);
    assert.equal(r.partial, false);
  });

  test('a deadline that hits mid-scan keeps the previous bench for unreached days', () => {
    const fresh = [{ ticker: 'A', seen_date: '2026-10-05' }, { ticker: 'B', seen_date: '2026-09-20' }];
    const prior = [
      { ticker: 'A', seen_date: '2026-09-01' },   // refreshed by scan
      { ticker: 'C', seen_date: '2026-09-10' },   // older than anything the scan reached → kept
      { ticker: 'D', seen_date: '2026-09-25' },   // inside the scanned range, not seen → dropped (scan is authoritative)
    ];
    const m = mergePartial(fresh, prior, '2026-09-20');
    assert.deepEqual(m.map((e) => e.ticker), ['A', 'B', 'C']);
    assert.deepEqual(mergePartial([], prior, null).map((e) => e.ticker), ['A', 'C', 'D']);
  });

  test('bench payload is bounded: oldest names dropped first', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ ticker: `T${i}`, pad: 'x'.repeat(1000) }));
    const b = boundEntries(entries, 50_000);
    assert.ok(b.bytes <= 50_000);
    assert.equal(b.entries[0].ticker, 'T0');
    assert.equal(b.trimmed, 100 - b.entries.length);
    assert.ok(b.trimmed > 0);
    assert.equal(boundEntries(entries, 10_000_000).trimmed, 0);
  });
});

describe('prewarm-earnings budget', () => {
  test('budget never lets a call outlive the run', () => {
    let t = 0;
    const b = new Budget(0, HARD_MS, () => t);
    assert.equal(b.timeout(180_000), 180_000);
    t = 120_000;
    assert.equal(b.timeout(180_000), 78_000);        // 200 s hard - 120 s - 2 s slack
    t = 190_000;
    assert.equal(b.canStart(), false);               // 10 s left < 15 s minimum
    assert.ok(b.timeout(180_000) <= 8_000);
    assert.ok(HARD_MS < 240_000, 'must return before the scheduler 240 s client timeout');
  });

  test('newest dates always first; older dates rotate by cursor and cover every offset once', () => {
    const o0 = orderOffsets(60, 0);
    assert.deepEqual(o0.slice(0, ALWAYS_OFFSETS), Array.from({ length: ALWAYS_OFFSETS }, (_, i) => i));
    assert.equal(o0.length, 61);
    const o1 = orderOffsets(60, 20);
    assert.deepEqual(o1.slice(0, ALWAYS_OFFSETS), o0.slice(0, ALWAYS_OFFSETS));
    assert.equal(o1[ALWAYS_OFFSETS], ALWAYS_OFFSETS + 20);
    assert.deepEqual([...o1].sort((a, b) => a - b), Array.from({ length: 61 }, (_, i) => i));
    assert.deepEqual(orderOffsets(5, 99), [0, 1, 2, 3, 4, 5]);
  });

  test('a run that stopped continues where it stopped', () => {
    const first = orderOffsets(60, 0);
    const stoppedAt = first[30];                      // not reached
    const cur = nextCursor(stoppedAt);
    assert.equal(orderOffsets(60, cur)[ALWAYS_OFFSETS], stoppedAt);
    assert.equal(nextCursor(null), 0);
  });

  test('simulated slot: slow steps stop before the hard limit and report partial', () => {
    let t = 0;
    const b = new Budget(0, HARD_MS, () => t);
    const offsets = orderOffsets(60, 0);
    let done = 0, unreached: number | null = null;
    for (const i of offsets) {
      if (!b.canStart()) { unreached = i; break; }
      t += Math.min(b.timeout(180_000), i < 3 ? 40_000 : 12_000);   // recent dates are slow
      done++;
    }
    assert.ok(unreached !== null && done < offsets.length);
    assert.ok(t <= HARD_MS, `finished at ${t}`);
    assert.ok(t <= 240_000 - 30_000);
  });
});

describe('route wiring', () => {
  const root = join(__dirname, '..', '..', 'app', 'api', 'v1', 'cron');
  const bench = readFileSync(join(root, 'refresh-bench', 'route.ts'), 'utf8');
  const pre = readFileSync(join(root, 'prewarm-earnings', 'route.ts'), 'utf8');
  test('refresh-bench uses the batched scan and no per-day kvGet loop', () => {
    assert.match(bench, /scanGradedDays\(/);
    assert.doesNotMatch(bench, /for \(const key of gradedKeyCandidates/);
    assert.match(bench, /SCAN_DEADLINE_MS = 45_000/);
  });
  test('prewarm-earnings has no fixed 110/120/180 s timeouts outside the budget and a cursor', () => {
    // the only literal timeout left is the 15 s EXISTS pipeline helper
    assert.equal((pre.match(/AbortSignal\.timeout\(\d/g) || []).length, 1);
    assert.match(pre, /new Budget\(start\)/);
    assert.match(pre, /CURSOR_KEY/);
  });
});
