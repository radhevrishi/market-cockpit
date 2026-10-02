// zzz855 — client-fetch: dedupe, TTL cache, per-caller timeout/abort, limiter,
// visibility-aware polling, memoised localStorage JSON. Pure logic, fake fetch
// + a virtual clock (no real timers, no network).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClientFetch,
  createLimiter,
  mapWithLimit,
  pollWhenVisible,
  readJsonMemo,
  type VisibilityDoc,
} from '../client-fetch';

// ── virtual clock ───────────────────────────────────────────────────────────
function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const set = (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; };
  const clear = (h: unknown) => { timers.delete(h as number); };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  async function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      let nextId = -1; let nextAt = Infinity;
      for (const [id, t] of timers) if (t.at <= target && t.at < nextAt) { nextAt = t.at; nextId = id; }
      if (nextId < 0) break;
      const t = timers.get(nextId)!;
      timers.delete(nextId);
      now = t.at;
      t.fn();
      await flush();
    }
    now = target;
    await flush();
  }
  return { now: () => now, set, clear, advance, flush, pending: () => timers.size };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** fake fetch whose responses resolve when the test says so */
function makeFetch() {
  const calls: Array<{ url: string; init: RequestInit; resolve: (r: Response) => void; reject: (e: any) => void }> = [];
  const impl = (url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const entry = { url, init, resolve, reject };
    calls.push(entry);
    init.signal?.addEventListener('abort', () => { const e = new Error('aborted'); (e as any).name = 'AbortError'; reject(e); });
  });
  return { impl, calls };
}

describe('fetchJson — dedupe + cache', () => {
  test('concurrent callers of the same URL share ONE request', async () => {
    const clock = makeClock(); const f = makeFetch();
    const cf = createClientFetch({ fetchImpl: f.impl, now: clock.now, setTimer: clock.set, clearTimer: clock.clear });
    const a = cf.fetchJson('/api/x');
    const b = cf.fetchJson('/api/x');
    const c = cf.fetchJson('/api/y');
    assert.equal(f.calls.length, 2);
    f.calls[0].resolve(jsonResponse({ v: 1 }));
    f.calls[1].resolve(jsonResponse({ v: 2 }));
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    assert.deepEqual(ra.data, { v: 1 });
    assert.deepEqual(rb.data, { v: 1 });
    assert.deepEqual(rc.data, { v: 2 });
    assert.equal(cf.stats.joined, 1);
    assert.equal(f.calls[0].init.cache, 'no-store');
  });

  test('TTL cache serves within window, refetches after, force bypasses', async () => {
    const clock = makeClock(); const f = makeFetch();
    const cf = createClientFetch({ fetchImpl: f.impl, now: clock.now, setTimer: clock.set, clearTimer: clock.clear });
    const p1 = cf.fetchJson('/api/q', { ttlMs: 60_000 });
    f.calls[0].resolve(jsonResponse([1]));
    assert.deepEqual((await p1).data, [1]);
    await clock.advance(30_000);
    const r2 = await cf.fetchJson('/api/q', { ttlMs: 60_000 });
    assert.equal(r2.fromCache, true);
    assert.equal(f.calls.length, 1);
    const p3 = cf.fetchJson('/api/q', { ttlMs: 60_000, force: true });
    assert.equal(f.calls.length, 2);
    f.calls[1].resolve(jsonResponse([3]));
    assert.deepEqual((await p3).data, [3]);
    await clock.advance(61_000);
    const p4 = cf.fetchJson('/api/q', { ttlMs: 60_000 });
    assert.equal(f.calls.length, 3);
    f.calls[2].resolve(jsonResponse([4]));
    assert.deepEqual((await p4).data, [4]);
  });

  test('errors are reported, never cached, never turned into empty data', async () => {
    const clock = makeClock(); const f = makeFetch();
    const cf = createClientFetch({ fetchImpl: f.impl, now: clock.now, setTimer: clock.set, clearTimer: clock.clear });
    const p1 = cf.fetchJson('/api/e');
    f.calls[0].resolve(jsonResponse({ err: 1 }, 503));
    const r1 = await p1;
    assert.equal(r1.data, null);
    assert.equal(r1.error, 'http_503');
    const p2 = cf.fetchJson('/api/e');
    assert.equal(f.calls.length, 2, 'failed response must not be cached');
    f.calls[1].reject(new TypeError('Failed to fetch'));
    assert.equal((await p2).error, 'network');
    const p3 = cf.fetchJson('/api/e');
    f.calls[2].resolve(new Response('not json', { status: 200 }));
    assert.equal((await p3).error, 'parse');
  });

  test('per-caller timeout: short caller gives up, long caller still gets the shared result', async () => {
    const clock = makeClock(); const f = makeFetch();
    const cf = createClientFetch({ fetchImpl: f.impl, now: clock.now, setTimer: clock.set, clearTimer: clock.clear });
    const short = cf.fetchJson('/api/slow', { timeoutMs: 5_000 });
    const long = cf.fetchJson('/api/slow', { timeoutMs: 30_000 });
    assert.equal(f.calls.length, 1);
    await clock.advance(6_000);
    assert.equal((await short).error, 'timeout');
    // shared request was NOT aborted at 5 s — deadline extended to 30 s
    assert.equal(f.calls[0].init.signal?.aborted, false);
    f.calls[0].resolve(jsonResponse({ ok: true }));
    assert.deepEqual((await long).data, { ok: true });
  });

  test('shared request aborts at the longest deadline', async () => {
    const clock = makeClock(); const f = makeFetch();
    const cf = createClientFetch({ fetchImpl: f.impl, now: clock.now, setTimer: clock.set, clearTimer: clock.clear });
    const p = cf.fetchJson('/api/hang', { timeoutMs: 10_000 });
    await clock.advance(10_001);
    assert.equal((await p).error, 'timeout');
    assert.equal(f.calls[0].init.signal?.aborted, true);
    assert.equal(cf._inflightSize(), 0);
  });

  test('caller AbortSignal detaches only that caller', async () => {
    const clock = makeClock(); const f = makeFetch();
    const cf = createClientFetch({ fetchImpl: f.impl, now: clock.now, setTimer: clock.set, clearTimer: clock.clear });
    const ctl = new AbortController();
    const a = cf.fetchJson('/api/z', { signal: ctl.signal });
    const b = cf.fetchJson('/api/z');
    ctl.abort();
    assert.equal((await a).error, 'aborted');
    assert.equal(f.calls[0].init.signal?.aborted, false);
    f.calls[0].resolve(jsonResponse(7));
    assert.equal((await b).data, 7);
    // pre-aborted signal: no request at all
    const r = await cf.fetchJson('/api/never', { signal: ctl.signal });
    assert.equal(r.error, 'aborted');
    assert.equal(f.calls.length, 1);
  });
});

describe('limiter', () => {
  test('createLimiter never exceeds max in flight', async () => {
    const lim = createLimiter(2);
    let active = 0; let peak = 0;
    const gates: Array<() => void> = [];
    const job = () => new Promise<void>((res) => { active++; peak = Math.max(peak, active); gates.push(() => { active--; res(); }); });
    const all = Promise.all([lim.run(job), lim.run(job), lim.run(job), lim.run(job), lim.run(job)]);
    await Promise.resolve();
    assert.equal(active, 2);
    assert.equal(lim.pending, 3);
    while (gates.length) { gates.shift()!(); await new Promise((r) => setImmediate(r)); }
    await all;
    assert.equal(peak, 2);
  });

  test('mapWithLimit: bounded concurrency, order kept, abort skips unstarted items', async () => {
    let active = 0; let peak = 0; const started: number[] = [];
    const ctl = new AbortController();
    const res = await mapWithLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      started.push(n);
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setImmediate(r));
      active--;
      if (n === 4) ctl.abort();
      return n * 10;
    }, { signal: ctl.signal });
    assert.ok(peak <= 3);
    assert.equal(res[0], 10);
    assert.equal(res[3], 40);
    assert.ok(started.length < 8, `abort should stop new starts (started ${started.length})`);
    assert.equal(res[7], undefined);
  });
});

describe('pollWhenVisible', () => {
  function makeDoc() {
    const fns = new Set<() => void>();
    const doc = {
      hidden: false,
      addEventListener: (_t: string, fn: () => void) => { fns.add(fn); },
      removeEventListener: (_t: string, fn: () => void) => { fns.delete(fn); },
      setHidden(h: boolean) { this.hidden = h; fns.forEach((f) => f()); },
      listeners: () => fns.size,
    };
    return doc;
  }

  test('fires on interval, pauses while hidden, resumes overdue run on show', async () => {
    const clock = makeClock(); const doc = makeDoc();
    let runs = 0;
    const stop = pollWhenVisible(() => { runs++; }, 60_000, {
      jitterMs: 0, doc: doc as unknown as VisibilityDoc,
      timers: { set: clock.set, clear: clock.clear, now: clock.now },
    });
    await clock.advance(60_000);
    assert.equal(runs, 1);
    doc.setHidden(true);
    await clock.advance(10 * 60_000);
    assert.equal(runs, 1, 'no runs while hidden');
    assert.equal(clock.pending(), 0, 'no timers armed while hidden');
    doc.setHidden(false);
    await clock.advance(0);
    assert.equal(runs, 2, 'overdue → runs right away on show');
    await clock.advance(59_000);
    assert.equal(runs, 2);
    await clock.advance(1_000);
    assert.equal(runs, 3);
    stop();
    await clock.advance(5 * 60_000);
    assert.equal(runs, 3);
    assert.equal(doc.listeners(), 0);
  });

  test('not overdue on show → waits the remainder; jitter delays; dynamic interval; immediate', async () => {
    const clock = makeClock(); const doc = makeDoc();
    let runs = 0; let iv = 60_000;
    const stop = pollWhenVisible(() => { runs++; }, () => iv, {
      jitterMs: 1_000, random: () => 0.5, runImmediately: true,
      doc: doc as unknown as VisibilityDoc, timers: { set: clock.set, clear: clock.clear, now: clock.now },
    });
    assert.equal(runs, 1, 'runImmediately');
    doc.setHidden(true);
    await clock.advance(20_000);
    doc.setHidden(false);
    await clock.advance(40_000);
    assert.equal(runs, 1, 'jitter (500 ms) not yet elapsed');
    await clock.advance(500);
    assert.equal(runs, 2);
    // interval is re-read before every wait: the wait already armed keeps 60 s,
    // the one after it uses the new 5 min.
    iv = 300_000;
    await clock.advance(60_500);
    assert.equal(runs, 3);
    await clock.advance(299_000);
    assert.equal(runs, 3);
    await clock.advance(2_000);
    assert.equal(runs, 4);
    stop();
  });

  test('a throwing callback does not stop the loop', async () => {
    const clock = makeClock();
    let runs = 0;
    const stop = pollWhenVisible(() => { runs++; throw new Error('boom'); }, 1_000, {
      jitterMs: 0, doc: null, timers: { set: clock.set, clear: clock.clear, now: clock.now },
    });
    await clock.advance(3_000);
    assert.equal(runs, 3);
    stop();
  });
});

describe('readJsonMemo', () => {
  test('parses once per stored string, re-parses on change, safe fallbacks', () => {
    const store: Record<string, string> = { big: JSON.stringify([{ a: 1 }]) };
    let reads = 0;
    const storage = { getItem: (k: string) => { reads++; return k in store ? store[k] : null; } };
    const a = readJsonMemo<any[]>('big', [], storage);
    const b = readJsonMemo<any[]>('big', [], storage);
    assert.equal(a, b, 'same object reused — no re-parse');
    store.big = JSON.stringify([{ a: 2 }]);
    const c = readJsonMemo<any[]>('big', [], storage);
    assert.notEqual(c, a);
    assert.equal(c[0].a, 2);
    assert.deepEqual(readJsonMemo('missing', ['fb'], storage), ['fb']);
    store.bad = '{not json';
    assert.deepEqual(readJsonMemo('bad', 0, storage), 0);
    const throwing = { getItem: () => { throw new Error('SecurityError'); } };
    assert.equal(readJsonMemo('x', 'fallback', throwing), 'fallback');
    assert.ok(reads >= 3);
  });
});
