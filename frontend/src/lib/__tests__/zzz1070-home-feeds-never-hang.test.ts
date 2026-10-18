// zzz1070 — the home page's Warrant and Transform lanes hung on "feed warming up" / "radar returned nothing": both feeds rebuilt
// cold (70 s+) and the page gave up after 16–22 s. Now: swrGet `waitMs` answers "building" (or the too-old last-good value) while
// the build finishes in the background; both routes keep their last good copy 7 days; the page re-asks while building and says why
// a lane is empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { swrGet, SwrPendingError, __resetSwrForTests, __swrSettled, type SwrStore } from '../swr-cache';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

function fakeStore() {
  const data = new Map<string, any>();
  const store: SwrStore = {
    async get<T>(k: string) { return (data.has(k) ? structuredClone(data.get(k)) : null) as T | null; },
    async set(k, v) { data.set(k, structuredClone(v)); },
    async setNX(k, v) { if (data.has(k)) return false; data.set(k, v); return true; },
    async del(k) { data.delete(k); },
  };
  return { store, data };
}
const later = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

test('cold build slower than waitMs: SwrPendingError at once, the build keeps running and is served next', async () => {
  __resetSwrForTests();
  const { store } = fakeStore();
  let builds = 0;
  const o = { key: 'zzz1070-cold', freshMs: 60_000, maxStaleMs: 600_000, store, waitMs: 20, build: async () => { builds++; return later(80, { rows: [1] }); } };
  const t0 = Date.now();
  await assert.rejects(swrGet(o), (e: unknown) => e instanceof SwrPendingError);
  assert.ok(Date.now() - t0 < 70, 'answered before the build finished');
  await assert.rejects(swrGet(o), (e: unknown) => e instanceof SwrPendingError, 'still building: same single build');
  await later(150, null);   // the build (80 ms) finishes in the background
  await __swrSettled();
  const r = await swrGet(o);
  assert.deepEqual(r.value, { rows: [1] });
  assert.equal(r.state, 'hit');
  assert.equal(builds, 1, 'one build, shared');
});

test('fast cold build inside waitMs: served normally', async () => {
  __resetSwrForTests();
  const { store } = fakeStore();
  const r = await swrGet({ key: 'zzz1070-fast', freshMs: 60_000, maxStaleMs: 600_000, store, waitMs: 200, build: async () => ({ rows: [2] }) });
  assert.equal(r.state, 'miss'); assert.deepEqual(r.value, { rows: [2] });
});

test('too-old value + slow rebuild: the old value is served (stale, refreshing) instead of an error', async () => {
  __resetSwrForTests();
  const { store, data } = fakeStore();
  let t = 1_000_000;
  data.set('swr:zzz1070-old', { v: 1, ts: t - 10_000, value: { rows: ['old'] } });
  const r = await swrGet({ key: 'zzz1070-old', freshMs: 1_000, maxStaleMs: 5_000, store, now: () => t, waitMs: 20, build: () => later(80, { rows: ['new'] }) });
  assert.equal(r.state, 'stale'); assert.deepEqual(r.value, { rows: ['old'] }); assert.equal(r.refreshing, true);
  await later(150, null);
});

test('no waitMs: old behaviour (waits for the build)', async () => {
  __resetSwrForTests();
  const { store } = fakeStore();
  const r = await swrGet({ key: 'zzz1070-wait', freshMs: 60_000, maxStaleMs: 600_000, store, build: () => later(40, { rows: [3] }) });
  assert.deepEqual(r.value, { rows: [3] });
});

test('warrant feed: shared cache with a wait limit, 7-day last good, honest "building" answer; force writes last good', () => {
  const s = read('app/api/v1/concall-intel/warrant-feed/route.ts');
  assert.match(s, /swrGet<WarrantFeedPayload>\(/);
  assert.match(s, /maxStaleMs: 7 \* 24 \* 3_600_000/);
  assert.match(s, /waitMs: force \? undefined : WARRANT_WAIT_MS/);
  assert.match(s, /building: true/);
  assert.match(s, /p\.count_total > 0/, 'a feed where neither exchange answered is never kept');
  assert.doesNotMatch(s, /cachedRoute\(/, 'no memory-only cache (emptied by every deploy)');
});

test('transform radar: wait limit, 7-day last good, live-feed read times out', () => {
  const s = read('app/api/v1/concall-intel/transformation-screener/route.ts');
  assert.match(s, /SCREEN_MAX_STALE_MS = 7 \* 24 \* 3_600_000/);
  assert.match(s, /waitMs: forceFresh \? undefined : SCREEN_WAIT_MS/);
  assert.match(s, /SwrPendingError/);
  assert.match(s, /AbortSignal\.timeout\(45_000\)/);
  assert.doesNotMatch(s, /^export const SCREEN_WAIT_MS/m, 'route files export only handler fields');
});

test('home inbox: re-asks while building, says why a lane is empty, first radar window = the warmed scan', () => {
  const s = read('app/(dashboard)/_home/components.tsx');
  assert.match(s, /got\?\.building/);
  assert.match(s, /attempt > 0/, 're-asks past the client cache');
  assert.match(s, /\{ days: 60, limit: 80 \}/);
  assert.match(s, /couldn't load the warrant feed/);
  assert.match(s, /couldn't load the radar/);
  assert.doesNotMatch(s, /'feed warming up'/);
  const warm = read('app/api/v1/cron/concall-intel-warm/route.ts');
  assert.match(warm, /warrant-feed\?days=45&force=1/, 'the warm job fills the home window');
  assert.match(warm, /transformation-screener\?days=60&limit=80&refresh=1/);
});

test('transform radar keeps a PARTIAL scan when NSE itself is OK (BSE down) — no rescan on every visit', () => {
  const s = read('app/api/v1/concall-intel/transformation-screener/route.ts');
  assert.match(s, /feedStatus\.state === 'PARTIAL' && nseOk/);
  assert.match(s, /const nseOk = feedStatus\?\.nse === 'OK'/);
});
