// zzz1053 — server speed: memo / LRU / single flight / stale-while-revalidate, the shared screener snapshot cache (one read per
// market, re-read only when built_at moves), the TradingView-replacement files built once per snapshot, ETag / 304 and pre-
// compressed bodies, graded-day memo TTLs (past vs today), chart series served stale within the safe window and restored from the
// database copy, and the personal-data WRITE paths left untouched.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
  MemoLru, singleFlight, memoSwr, etagFor, etagOfText, matchesIfNoneMatch, sendText, pickEncoding, cachedRoute, forgetCachedRoute,
  cachedRouteHas, _compressedCacheSize, _resetRouteCacheForTests, PRECOMPRESS_MIN_BYTES,
} from '../server-memo';
import { serverTiming, withServerTiming } from '../server-timing';
import { getSnapshot, noteSnapshotWritten, r40GuardedRows, _setSnapshotReaderForTests, REVALIDATE_MS, type SnapshotData } from '../screener/snapshot-cache';
import { buildTvFile, buildTvManifest, tvFileMemoKey } from '../screener/tv-replacement-server';
import { gradedMemoTtl } from '../graded-cache-key';
import {
  seriesServableStale, getDailySeries, packSeries, unpackSeries, _setChartSeriesStore, _setMarketOpenForTests, _resetChartDataForTests,
  STALE_SERVE_MS, CLOSED_STALE_MS, type DailySeries,
} from '../chart-data';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

describe('MemoLru', () => {
  test('hit / miss counts and least-recently-used eviction by entries', () => {
    const c = new MemoLru<number>({ maxEntries: 2 });
    c.set('a', 1); c.set('b', 2);
    assert.equal(c.get('a')?.value, 1);            // a is now most recent
    c.set('c', 3);                                  // evicts b
    assert.equal(c.get('b'), undefined);
    assert.equal(c.get('a')?.value, 1);
    assert.equal(c.get('c')?.value, 3);
    assert.equal(c.hits, 3); assert.equal(c.misses, 1); assert.equal(c.evictions, 1);
  });
  test('bounded by bytes; a value bigger than the budget is never kept', () => {
    const c = new MemoLru<string>({ maxEntries: 10, maxBytes: 10, sizeOf: (s) => s.length });
    c.set('a', '12345'); c.set('b', '12345');
    assert.equal(c.bytes, 10);
    c.set('c', '123');                              // a goes
    assert.equal(c.peek('a'), undefined); assert.ok(c.peek('b')); assert.ok(c.peek('c'));
    c.set('huge', '12345678901');
    assert.equal(c.peek('huge'), undefined);
    assert.ok(c.bytes <= 10);
  });
  test('replacing a key keeps the byte total right', () => {
    const c = new MemoLru<string>({ maxEntries: 10, maxBytes: 100, sizeOf: (s) => s.length });
    c.set('a', 'xxxx'); c.set('a', 'yy');
    assert.equal(c.bytes, 2); assert.equal(c.size, 1);
  });
});

describe('singleFlight', () => {
  test('concurrent callers share one call; the slot clears after it settles (also on failure)', async () => {
    const m = new Map<string, Promise<number>>();
    let calls = 0;
    const fn = async () => { calls++; await tick(); return 7; };
    const [a, b] = await Promise.all([singleFlight(m, 'k', fn), singleFlight(m, 'k', fn)]);
    assert.equal(a, 7); assert.equal(b, 7); assert.equal(calls, 1);
    await tick();
    assert.equal(m.size, 0);
    await assert.rejects(singleFlight(m, 'x', async () => { throw new Error('no'); }));
    await tick();
    assert.equal(m.size, 0);
  });
});

describe('memoSwr', () => {
  let now = 1_000_000;
  const mk = () => new MemoLru<string>({ maxEntries: 10, now: () => now });
  test('miss → load; fresh → hit without a load', async () => {
    const cache = mk(); const inflight = new Map<string, Promise<string>>();
    let loads = 0;
    const o = { cache, inflight, key: 'k', freshMs: 1000, staleMs: 5000, load: async () => `v${++loads}` };
    const r1 = await memoSwr(o);
    assert.equal(r1.state, 'miss'); assert.equal(r1.value, 'v1'); assert.equal(r1.cached, true);
    now += 500;
    const r2 = await memoSwr(o);
    assert.equal(r2.state, 'hit'); assert.equal(r2.value, 'v1'); assert.equal(loads, 1);
  });
  test('stale → the old value now, ONE background refresh for many requests, then the new value', async () => {
    const cache = mk(); const inflight = new Map<string, Promise<string>>();
    let loads = 0;
    const o = { cache, inflight, key: 'k', freshMs: 1000, staleMs: 5000, load: async () => { loads++; await tick(); return `v${loads}`; } };
    await memoSwr(o);
    now += 2000;
    const [a, b, c] = await Promise.all([memoSwr(o), memoSwr(o), memoSwr(o)]);
    assert.deepEqual([a.state, b.state, c.state], ['stale', 'stale', 'stale']);
    assert.equal(a.value, 'v1');
    await tick(); await tick();
    assert.equal(loads, 2, 'one refresh');
    const d = await memoSwr(o);
    assert.equal(d.value, 'v2'); assert.equal(d.state, 'hit');
  });
  test('too old → a synchronous load; an unusable load is returned but not cached and never replaces a good value', async () => {
    const cache = mk(); const inflight = new Map<string, Promise<string>>();
    let next = 'good';
    const o = { cache, inflight, key: 'k', freshMs: 1000, staleMs: 5000, load: async () => next, usable: (v: string) => v !== 'bad' };
    await memoSwr(o);
    now += 10_000; next = 'bad';
    const r = await memoSwr(o);
    assert.equal(r.value, 'bad'); assert.equal(r.cached, false);
    assert.equal(cache.peek('k')?.value, 'good', 'last good kept');
  });
});

describe('ETag / 304 / pre-compressed bodies', () => {
  beforeEach(() => _resetRouteCacheForTests());
  const req = (h: Record<string, string> = {}) => new Request('http://x/api', { headers: h });
  test('etags are stable per input and differ per input', () => {
    assert.equal(etagFor('a', 1), etagFor('a', 1));
    assert.notEqual(etagFor('a', 1), etagFor('a', 2));
    assert.match(etagOfText('hello'), /^W\/"/);
  });
  test('If-None-Match: weak / strong / list / *', () => {
    const tag = etagFor('x');
    assert.ok(matchesIfNoneMatch(req({ 'if-none-match': tag }), tag));
    assert.ok(matchesIfNoneMatch(req({ 'if-none-match': tag.replace(/^W\//, '') }), tag));
    assert.ok(matchesIfNoneMatch(req({ 'if-none-match': `"zz", ${tag}` }), tag));
    assert.ok(matchesIfNoneMatch(req({ 'if-none-match': '*' }), tag));
    assert.ok(!matchesIfNoneMatch(req({ 'if-none-match': '"other"' }), tag));
    assert.ok(!matchesIfNoneMatch(req(), tag));
  });
  test('a matching revisit gets 304 with no body; otherwise the body', async () => {
    const tag = etagFor('body-1');
    const r304 = sendText(req({ 'if-none-match': tag }), { text: '{"a":1}', contentType: 'application/json', etag: tag, cacheControl: 'private, max-age=60' });
    assert.equal(r304.status, 304);
    assert.equal(await r304.text(), '');
    assert.equal(r304.headers.get('etag'), tag);
    const r200 = sendText(req({ 'if-none-match': '"old"' }), { text: '{"a":1}', contentType: 'application/json', etag: tag });
    assert.equal(r200.status, 200);
    assert.equal(await r200.text(), '{"a":1}');
  });
  test('large bodies are sent pre-compressed (br / gzip), compressed ONCE per key', async () => {
    const text = JSON.stringify({ rows: Array.from({ length: 4000 }, (_, i) => ({ t: `T${i}`, px: i })) });
    assert.ok(text.length > PRECOMPRESS_MIN_BYTES);
    const before = _compressedCacheSize();
    const br = sendText(req({ 'accept-encoding': 'gzip, deflate, br' }), { text, contentType: 'application/json', compressKey: 'k1' });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.match(br.headers.get('vary') || '', /Accept-Encoding/);
    assert.equal(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString('utf8'), text);
    sendText(req({ 'accept-encoding': 'br' }), { text, contentType: 'application/json', compressKey: 'k1' });
    assert.equal(_compressedCacheSize(), before + 1, 'the second request reused the compressed bytes');
    const gz = sendText(req({ 'accept-encoding': 'gzip' }), { text, contentType: 'application/json', compressKey: 'k1' });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.equal(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString('utf8'), text);
    const plain = sendText(req(), { text, contentType: 'application/json', compressKey: 'k1' });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(await plain.text(), text);
  });
  test('encoding negotiation honours q=0', () => {
    assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
    assert.equal(pickEncoding('identity'), null);
    assert.equal(pickEncoding('*'), 'br');
  });
});

describe('cachedRoute', () => {
  beforeEach(() => _resetRouteCacheForTests());
  test('a 200 answer is kept; a no-store answer passes through uncached; forget drops it', async () => {
    let calls = 0;
    const handler = async () => { calls++; return new Response(JSON.stringify({ n: calls }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=60' } }); };
    const rq = new Request('http://x/a');
    const a = await cachedRoute(rq, { key: 'r1', freshMs: 60_000, staleMs: 120_000, handler });
    const b = await cachedRoute(rq, { key: 'r1', freshMs: 60_000, staleMs: 120_000, handler });
    assert.equal(calls, 1);
    assert.deepEqual(await a.json(), { n: 1 }); assert.deepEqual(await b.json(), { n: 1 });
    assert.equal(b.headers.get('x-mc-memo'), 'hit');
    assert.ok(b.headers.get('etag'));
    const c304 = await cachedRoute(new Request('http://x/a', { headers: { 'if-none-match': b.headers.get('etag')! } }), { key: 'r1', freshMs: 60_000, staleMs: 120_000, handler });
    assert.equal(c304.status, 304);
    forgetCachedRoute('r1');
    assert.equal(cachedRouteHas('r1'), false);
    let ns = 0;
    const noStore = async () => { ns++; return new Response('{}', { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); };
    await cachedRoute(rq, { key: 'r2', freshMs: 60_000, staleMs: 120_000, handler: noStore });
    const p = await cachedRoute(rq, { key: 'r2', freshMs: 60_000, staleMs: 120_000, handler: noStore });
    assert.equal(ns, 2);
    assert.equal(p.headers.get('x-mc-memo'), 'pass');
  });
  test('concurrent cold requests run the handler once', async () => {
    let calls = 0;
    const handler = async () => { calls++; await tick(); return new Response('{"ok":1}', { headers: { 'content-type': 'application/json' } }); };
    await Promise.all(Array.from({ length: 5 }, () => cachedRoute(new Request('http://x/c'), { key: 'r3', freshMs: 1000, staleMs: 2000, handler })));
    assert.equal(calls, 1);
  });
});

describe('Server-Timing', () => {
  test('steps, notes and total in the header', async () => {
    let clock = 0;
    const t = serverTiming(() => clock);
    await t.time('db', async () => { clock += 12; });
    t.note('memo', 'hit "x"');
    clock += 3;
    const h = t.header();
    assert.match(h, /db;dur=12/); assert.match(h, /memo;desc="hit  x "/); assert.match(h, /total;dur=15/);
    const res = withServerTiming(new Response('x'), t);
    assert.match(res.headers.get('server-timing') || '', /total/);
  });
});

describe('shared screener snapshot cache', () => {
  const row = (t: string, extra: any = {}) => ({ t, n: t, px: 10, mc: 1000, ...extra });
  function fakeReader(state: { builtAt: Record<string, string>; rows: Record<string, any[]> }) {
    const calls = { full: 0, builtAt: 0 };
    return {
      calls,
      reader: {
        async builtAt(m: 'US' | 'IN') { calls.builtAt++; await tick(); return state.builtAt[m] ?? null; },
        async full(m: 'US' | 'IN'): Promise<SnapshotData | null> {
          calls.full++; await tick();
          return state.builtAt[m] ? { market: m, builtAt: state.builtAt[m], rows: state.rows[m] || [], meta: null } : null;
        },
      },
    };
  }
  test('concurrent cold reads share ONE full read; after REVALIDATE_MS only built_at is read; a new built_at reloads', async () => {
    let now = 0;
    const st = { builtAt: { US: '2026-10-15T00:00:00.000Z' } as Record<string, string>, rows: { US: [row('AAA')] } };
    const f = fakeReader(st);
    _setSnapshotReaderForTests(f.reader, () => now);
    const all = await Promise.all(Array.from({ length: 10 }, () => getSnapshot('US')));
    assert.equal(f.calls.full, 1);
    assert.ok(all.every((s) => s === all[0]));
    now += 1000;
    await getSnapshot('US');
    assert.equal(f.calls.full, 1); assert.equal(f.calls.builtAt, 0, 'fresh: no database read at all');
    now += REVALIDATE_MS;
    const same = await getSnapshot('US');
    assert.equal(f.calls.builtAt, 1); assert.equal(f.calls.full, 1, 'unchanged built_at: rows not read again');
    assert.equal(same, all[0]);
    now += REVALIDATE_MS; st.builtAt.US = '2026-10-16T00:00:00.000Z';
    const fresh = await getSnapshot('US');
    assert.equal(f.calls.full, 2); assert.equal(fresh?.builtAt, '2026-10-16T00:00:00.000Z');
    noteSnapshotWritten('US');
    await getSnapshot('US');
    assert.equal(f.calls.full, 3, 'a build in this process makes the next request re-read');
    _setSnapshotReaderForTests(null);
  });
  test('a failed read keeps the copy in memory', async () => {
    let now = 0; let fail = false;
    const snap = { market: 'IN' as const, builtAt: 'b1', rows: [row('X')], meta: null };
    _setSnapshotReaderForTests({ async builtAt() { if (fail) throw new Error('db down'); return 'b1'; }, async full() { if (fail) throw new Error('db down'); return snap; } }, () => now);
    assert.equal((await getSnapshot('IN'))?.builtAt, 'b1');
    fail = true; now += REVALIDATE_MS * 2;
    assert.equal((await getSnapshot('IN'))?.builtAt, 'b1');
    _setSnapshotReaderForTests(null);
  });
  test('the Rule of 40 guard is a view: shared rows are never changed', () => {
    const snap: SnapshotData = { market: 'US', builtAt: 'b', rows: [row('A', { r40: 99, revQYoY: 1, fcfmTTM: 98 }), row('B', { r40: 50 })] as any, meta: null };
    const g = r40GuardedRows(snap, (rev) => rev !== 1);
    assert.equal((g[0] as any).r40, null);
    assert.equal((snap.rows[0] as any).r40, 99, 'the Pine Screener still reads the stored row');
    assert.equal(g[1], snap.rows[1]);
    assert.equal(r40GuardedRows(snap, () => false), g, 'made once per snapshot');
  });
  test('TradingView-replacement files: built once per snapshot; manifest + 7 files at once read each market ONCE', async () => {
    const st = { builtAt: { US: 'u1', IN: 'i1' } as Record<string, string>, rows: { US: [row('AAA')], IN: [row('BBB')] } };
    const f = fakeReader(st);
    _setSnapshotReaderForTests(f.reader, () => 0);
    const names = ['minervini-stocks.csv', 'qullamaggie-leaders.csv', 'episodic-pivot.csv', 'liquidity-leaders.csv', 'weekly-gainer-usa.csv', 'sales-eps-growth-bonde.csv'];
    const [man, ...files] = await Promise.all([buildTvManifest({}), ...names.map((n) => buildTvFile(n))]);
    assert.equal(f.calls.full, 2, 'one read per market');
    assert.ok(man.files.length >= names.length);
    assert.ok(files.every((x) => x && x.source === 'own-screener'));
    const again = await buildTvFile('minervini-stocks.csv');
    assert.equal(again, files[0], 'the same built file object (memo by snapshot)');
    assert.notEqual(tvFileMemoKey('a.csv', ['u1', 'i1']), tvFileMemoKey('a.csv', ['u2', 'i1']));
    assert.notEqual(tvFileMemoKey('a.csv', ['u1'], new Date('2026-10-15T23:00:00Z')), tvFileMemoKey('a.csv', ['u1'], new Date('2026-10-16T01:00:00Z')));
    _setSnapshotReaderForTests(null);
  });
});

describe('graded day memo: past vs today', () => {
  test('past = 5 min fresh / 30 min stale; today = 30 s / 5 min; future and bad dates are never kept', () => {
    assert.deepEqual(gradedMemoTtl('2026-10-13', '2026-10-15'), { freshMs: 300_000, staleMs: 1_800_000 });
    assert.deepEqual(gradedMemoTtl('2026-10-15', '2026-10-15'), { freshMs: 30_000, staleMs: 300_000 });
    assert.equal(gradedMemoTtl('2026-10-16', '2026-10-15'), null);
    assert.equal(gradedMemoTtl('bad', '2026-10-15'), null);
  });
  test('route: only plain ?date= reads use the memo; only swr-layer (usable) answers are kept; a forced rebuild drops the kept day', () => {
    const s = read('app/api/v1/earnings/graded/route.ts');
    assert.match(s, /\[\.\.\.sp\.keys\(\)\]\.every\(\(k\) => k === 'date'\)/);
    assert.match(s, /a\.headers\.some\(\(\[k\]\) => k === 'x-mc-cache'\)/);
    assert.match(s, /forgetCachedRoute\(`graded\|\$\{gradedKey\(date\)\}`\)/);
    assert.match(s, /prewarmInGuideIndex\(\)/);
  });
});

describe('chart series: stale-while-revalidate within a safe window + the database copy', () => {
  const closed = () => false; const open = () => true;
  test('servable stale: within STALE_SERVE_MS always; up to CLOSED_STALE_MS only when the market was closed then AND now', () => {
    const now = 10 * 3_600_000;
    assert.ok(seriesServableStale(now - STALE_SERVE_MS + 1, now, open));
    assert.ok(!seriesServableStale(now - STALE_SERVE_MS - 1, now, open));
    assert.ok(seriesServableStale(now - CLOSED_STALE_MS + 1, now, closed));
    assert.ok(!seriesServableStale(now - CLOSED_STALE_MS - 1, now, closed));
    assert.ok(!seriesServableStale(now - 3_600_000, now, (d) => d.getTime() === now), 'open now = not servable after the short window');
    assert.ok(!seriesServableStale(now + 1000, now, closed), 'a future stamp is never trusted');
  });
  const series = (c: number): DailySeries => ({ symbol: 'AAA', name: 'A', currency: 'USD', exchange: 'NMS', bars: [{ t: Date.UTC(2026, 9, 14), o: 1, h: 2, l: 0.5, c, v: 10 }], divs: [] });
  test('pack / unpack round trip', () => {
    const s = series(1.5);
    assert.deepEqual(unpackSeries(JSON.parse(JSON.stringify(packSeries(s)))), s);
    assert.equal(unpackSeries({ b: { t: [] } }), null);
  });
  test('not in memory → the recent database copy answers without Yahoo; an older (still servable) copy also refreshes behind it', async () => {
    _resetChartDataForTests();
    _setMarketOpenForTests(() => false);
    const origFetch = globalThis.fetch;
    let yahoo = 0;
    globalThis.fetch = (async () => { yahoo++; return new Response('{}', { status: 500 }); }) as any;
    let savedAt = Date.now() - 60_000;
    const writes: string[] = [];
    _setChartSeriesStore({ async read() { return { at: savedAt, data: series(3) }; }, async write(k) { writes.push(k); } });
    try {
      const a = await getDailySeries('US', 'AAA', '5y');
      assert.equal(a?.bars[0].c, 3);
      assert.equal(yahoo, 0, 'a 1-minute-old copy needs no refresh');
      _resetChartDataForTests();
      savedAt = Date.now() - 2 * 3_600_000;   // closed market, 2 h old: served, refreshed behind
      const b = await getDailySeries('US', 'AAA', '5y');
      assert.equal(b?.bars[0].c, 3);
      await tick(); await tick();
      assert.ok(yahoo >= 1, 'background refresh asked Yahoo');
      const c = await getDailySeries('US', 'AAA', '5y');
      assert.equal(c?.bars[0].c, 3, 'a failed refresh never replaces the good copy');
    } finally {
      globalThis.fetch = origFetch;
      _setChartSeriesStore(null); _setMarketOpenForTests((m, d) => false); _resetChartDataForTests();
    }
  });
});

describe('source checks: what changed and what must not', () => {
  test('personal-data WRITE paths untouched: version checks, locks and conflicts still in place; no memo / cache helper used', () => {
    const us = read('lib/user-state-store.ts');
    assert.match(us, /pg_advisory_xact_lock\(883, hashtext\(\$1\)\)/);
    assert.match(us, /FOR UPDATE/);
    assert.match(us, /throw new UserStateConflict|new UserStateConflict\(/);
    assert.match(us, /kvSetVersioned/);
    assert.doesNotMatch(us, /server-memo|cachedRoute|memoSwr/);
    // the list read still hashes the STORED value; only unchanged (version, updated_at) skip the re-read
    assert.match(us, /_listHash\.set\(r\.key, \{ sig: sig\(r\), hash: hashOf\(r\.value\) \}\)/);
    const route = read('app/api/v1/user-state/route.ts');
    assert.match(route, /putUserState\(body\.key, body\.value, \{ baseVersion: body\.baseVersion \?\? null/);
    assert.match(route, /status: 409/);
    for (const p of ['lib/us-book-store.ts', 'lib/book-store.ts', 'app/api/v1/book/sync/route.ts', 'app/api/v1/user-state/route.ts']) {
      assert.doesNotMatch(read(p), /server-memo|cachedRoute|memoSwr|snapshot-cache/, p);
    }
  });
  test('tv-data: the US-book list is never cached (no-store, no ETag); public files carry an ETag and a short browser cache', () => {
    const r = read('app/api/v1/tv-data/route.ts');
    assert.match(r, /etag: personal \? null : etagOfText\(r\.text\)/);
    assert.match(r, /personal \? 'private, no-store'/);
    assert.match(r, /private, max-age=60, stale-while-revalidate=600/);
    assert.match(r, /f\.list === 'us-book' && !withPersonal/);
    const srv = read('lib/screener/tv-replacement-server.ts');
    assert.match(srv, /if \(f\.list === 'us-book' \|\| opts\.now\) return buildTvFileNow\(f, opts\)/, 'the US book is built fresh every time');
  });
  test('stock / pine screeners and chart float read the shared snapshot cache, not their own Postgres copies', () => {
    for (const p of ['app/api/v1/stock-screener/route.ts', 'app/api/v1/pine-screener/route.ts', 'app/api/v1/chart/[ticker]/route.ts', 'lib/screener/tv-replacement-server.ts']) {
      const s = read(p);
      assert.match(s, /getSnapshot\(/, p);
      assert.doesNotMatch(s, /FROM screener_snapshot/, p);
    }
    assert.match(read('lib/screener/us-build.ts'), /publishSnapshot\('US'/);   // zzz1197: publishSnapshot calls noteSnapshotWritten
    assert.match(read('lib/screener/in-build.ts'), /publishSnapshot\('IN'/);
    assert.match(read('lib/screener/snapshot-publish.ts'), /noteSnapshotWritten\(m\)/);
  });
  test('quote route: per-symbol memo, shared NSE calls and an NSE deadline with Yahoo in parallel', () => {
    const s = read('app/api/market/quote/route.ts');
    assert.match(s, /NSE_DEADLINE_MS = 3_000/);
    assert.match(s, /singleFlight\(_nseInflight, symbol/);
    assert.match(s, /const yahooP = fetchQuotesWithFallback/);
    assert.match(s, /SYMBOL_TTL_MS = 60_000/);
  });
  test('Postgres pool: created once, kept warm', () => {
    const s = read('lib/db.ts');
    assert.match(s, /g\.__MC_PG_POOL__/);
    assert.match(s, /keepAlive: true/);
    assert.match(s, /idleTimeoutMillis: 10 \* 60_000/);
    assert.match(read('instrumentation.ts'), /warmOnBoot\(\)/);
  });
});
