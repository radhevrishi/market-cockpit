// zzz855 — API speed: shared stale-while-revalidate helper (fake KV + fake clock) and the opt-in lean response shapes.
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { swrGet, swrMemo, swrHeaders, privateCache, SwrUnusableError, __resetSwrForTests, __swrSettled, type SwrStore } from '../swr-cache';
import {
  parseListOptions, shapeQuotesPayload, parseQuotesListOptions, shapeLiveFeedPayload, shapeNewsArticles, snapshotEtag, etagMatches,
  QUOTE_LEAN_FIELDS,
} from '../lean-view';

function fakeStore() {
  const data = new Map<string, any>();
  const calls = { get: 0, set: 0, setNX: 0, del: 0 };
  let lockAlwaysTaken = false;
  const store: SwrStore = {
    async get<T>(k: string) { calls.get++; return (data.has(k) ? structuredClone(data.get(k)) : null) as T | null; },
    async set(k, v) { calls.set++; data.set(k, structuredClone(v)); },
    async setNX(k, v) { calls.setNX++; if (lockAlwaysTaken || data.has(k)) return false; data.set(k, v); return true; },
    async del(k) { calls.del++; data.delete(k); },
  };
  return { store, data, calls, takeLock: () => { lockAlwaysTaken = true; } };
}

function clock(start = 1_000_000) { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; }

let n = 0;
const uniq = (p: string) => `${p}:${++n}`;

beforeEach(() => __resetSwrForTests());

describe('swr-cache: fresh / stale / cold', () => {
  test('cold start builds synchronously, stores an envelope in KV, labels miss', async () => {
    const { store, data } = fakeStore(); const c = clock(); const key = uniq('cold');
    let builds = 0;
    const r = await swrGet({ key, freshMs: 1000, maxStaleMs: 10_000, build: async () => { builds++; return { rows: [1] }; }, store, now: c.now });
    assert.equal(r.state, 'miss'); assert.equal(r.source, 'build'); assert.equal(builds, 1); assert.deepEqual(r.value, { rows: [1] });
    const env = data.get(`swr:${key}`);
    assert.equal(env.v, 1); assert.equal(env.ts, c.now()); assert.deepEqual(env.value, { rows: [1] });
  });

  test('fresh value is a memory hit; no rebuild, no KV read', async () => {
    const { store, calls } = fakeStore(); const c = clock(); const key = uniq('fresh');
    let builds = 0;
    const o = { key, freshMs: 1000, maxStaleMs: 10_000, build: async () => { builds++; return { v: builds }; }, store, now: c.now };
    await swrGet(o);
    const getsAfterBuild = calls.get;
    c.advance(500);
    const r = await swrGet(o);
    assert.equal(r.state, 'hit'); assert.equal(r.source, 'memory'); assert.equal(r.ageMs, 500); assert.equal(builds, 1);
    assert.equal(calls.get, getsAfterBuild, 'memory hit must not touch KV');
  });

  test('stale value is served at once with its true age, refreshed once in the background', async () => {
    const { store } = fakeStore(); const c = clock(); const key = uniq('stale');
    let builds = 0;
    const o = { key, freshMs: 1000, maxStaleMs: 10_000, build: async () => { builds++; return { v: builds }; }, store, now: c.now };
    await swrGet(o);
    c.advance(3000);
    const r = await swrGet(o);
    assert.equal(r.state, 'stale'); assert.equal(r.ageMs, 3000); assert.deepEqual(r.value, { v: 1 }); assert.equal(r.refreshing, true);
    await __swrSettled();
    assert.equal(builds, 2);
    const r2 = await swrGet(o);
    assert.equal(r2.state, 'hit'); assert.deepEqual(r2.value, { v: 2 }); assert.equal(r2.ageMs, 0);
  });

  test('older than maxStale rebuilds synchronously', async () => {
    const { store } = fakeStore(); const c = clock(); const key = uniq('tooold');
    let builds = 0;
    const o = { key, freshMs: 1000, maxStaleMs: 5000, build: async () => { builds++; return { v: builds }; }, store, now: c.now };
    await swrGet(o);
    c.advance(6000);
    const r = await swrGet(o);
    assert.equal(r.state, 'miss'); assert.deepEqual(r.value, { v: 2 });
  });

  test('force rebuilds even when fresh', async () => {
    const { store } = fakeStore(); const c = clock(); const key = uniq('force');
    let builds = 0;
    const o = { key, freshMs: 60_000, maxStaleMs: 600_000, build: async () => { builds++; return { v: builds }; }, store, now: c.now };
    await swrGet(o);
    const r = await swrGet({ ...o, force: true });
    assert.equal(r.state, 'miss'); assert.deepEqual(r.value, { v: 2 });
  });
});

describe('swr-cache: single flight', () => {
  test('concurrent cold requests share one build', async () => {
    const { store } = fakeStore(); const c = clock(); const key = uniq('sf-cold');
    let builds = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const o = { key, freshMs: 1000, maxStaleMs: 10_000, build: async () => { builds++; await gate; return { v: 'x' }; }, store, now: c.now };
    const ps = Array.from({ length: 6 }, () => swrGet(o));
    await new Promise((r) => setImmediate(r));
    release();
    const rs = await Promise.all(ps);
    assert.equal(builds, 1);
    for (const r of rs) assert.deepEqual(r.value, { v: 'x' });
  });

  test('concurrent stale requests start one background refresh', async () => {
    const { store, calls } = fakeStore(); const c = clock(); const key = uniq('sf-stale');
    let builds = 0;
    const o = { key, freshMs: 1000, maxStaleMs: 10_000, build: async () => { builds++; await new Promise((r) => setImmediate(r)); return { v: builds }; }, store, now: c.now };
    await swrGet(o);
    c.advance(2000);
    const rs = await Promise.all(Array.from({ length: 8 }, () => swrGet(o)));
    for (const r of rs) { assert.equal(r.state, 'stale'); assert.deepEqual(r.value, { v: 1 }); }
    await __swrSettled();
    assert.equal(builds, 2, 'one cold build + exactly one refresh');
    assert.equal(calls.setNX, 1, 'one cross-instance lock attempt');
  });

  test('another instance holding the refresh lock: this one serves stale and does not rebuild', async () => {
    const { store, takeLock } = fakeStore(); const c = clock(); const key = uniq('sf-lock');
    let builds = 0;
    const o = { key, freshMs: 1000, maxStaleMs: 10_000, build: async () => { builds++; return { v: builds }; }, store, now: c.now };
    await swrGet(o);
    takeLock();
    c.advance(2000);
    const r = await swrGet(o);
    assert.equal(r.state, 'stale');
    await __swrSettled();
    assert.equal(builds, 1);
  });

  test('a newer value written to KV by another instance wins over this instance\'s stale memory', async () => {
    const { store, data } = fakeStore(); const c = clock(); const key = uniq('kv-newer');
    const o = { key, freshMs: 1000, maxStaleMs: 10_000, build: async () => ({ v: 'mine' }), store, now: c.now };
    await swrGet(o);
    c.advance(2000);
    data.set(`swr:${key}`, { v: 1, ts: c.now() - 100, value: { v: 'other-instance' } });
    const r = await swrGet(o);
    assert.equal(r.state, 'hit'); assert.equal(r.source, 'kv'); assert.deepEqual(r.value, { v: 'other-instance' }); assert.equal(r.ageMs, 100);
  });
});

describe('swr-cache: a failed rebuild never replaces last-good', () => {
  test('throwing background refresh keeps the last good value in memory and KV', async () => {
    const { store, data } = fakeStore(); const c = clock(); const key = uniq('fail-bg');
    let fail = false;
    const o = { key, freshMs: 1000, maxStaleMs: 10_000, build: async () => { if (fail) throw new Error('upstream down'); return { rows: [1, 2] }; }, store, now: c.now };
    await swrGet(o);
    const envBefore = structuredClone(data.get(`swr:${key}`));
    fail = true;
    c.advance(2000);
    const r = await swrGet(o);
    assert.equal(r.state, 'stale'); assert.deepEqual(r.value, { rows: [1, 2] });
    await __swrSettled();
    assert.deepEqual(data.get(`swr:${key}`), envBefore);
    const r2 = await swrGet(o);
    assert.deepEqual(r2.value, { rows: [1, 2] }); assert.equal(r2.ageMs, 2000, 'age keeps counting from the last good build');
  });

  test('an EMPTY rebuild is not cached and does not replace last-good', async () => {
    const { store, data } = fakeStore(); const c = clock(); const key = uniq('fail-empty');
    let empty = false;
    const o = { key, freshMs: 1000, maxStaleMs: 10_000, build: async () => (empty ? { rows: [] as number[] } : { rows: [7] }), isUsable: (v: { rows: number[] }) => v.rows.length > 0, store, now: c.now };
    await swrGet(o);
    empty = true;
    c.advance(2000);
    await swrGet(o);
    await __swrSettled();
    assert.deepEqual(data.get(`swr:${key}`).value, { rows: [7] });
    assert.deepEqual((await swrGet(o)).value, { rows: [7] });
  });

  test('too-old value + failed synchronous rebuild: old value served, labelled stale with its age', async () => {
    const { store } = fakeStore(); const c = clock(); const key = uniq('fail-old');
    let fail = false;
    const o = { key, freshMs: 1000, maxStaleMs: 5000, build: async () => { if (fail) throw new Error('x'); return { v: 1 }; }, store, now: c.now };
    await swrGet(o);
    fail = true;
    c.advance(9000);
    const r = await swrGet(o);
    assert.equal(r.state, 'stale'); assert.equal(r.rebuildFailed, true); assert.equal(r.ageMs, 9000); assert.deepEqual(r.value, { v: 1 });
  });

  test('cold + empty build throws SwrUnusableError carrying the value (route can pass it through uncached)', async () => {
    const { store, data } = fakeStore(); const c = clock(); const key = uniq('cold-empty');
    await assert.rejects(
      swrGet({ key, freshMs: 1000, maxStaleMs: 5000, build: async () => ({ buckets: [] }), isUsable: (v: any) => v.buckets.length > 0, store, now: c.now }),
      (e: any) => e instanceof SwrUnusableError && Array.isArray((e.value as any).buckets),
    );
    assert.equal(data.has(`swr:${key}`), false);
  });

  test('cold + throwing build propagates the error', async () => {
    const { store } = fakeStore(); const c = clock();
    await assert.rejects(swrGet({ key: uniq('cold-throw'), freshMs: 1, maxStaleMs: 2, build: async () => { throw new Error('boom'); }, store, now: c.now }), /boom/);
  });

  test('failed forced rebuild falls back to the last good value', async () => {
    const { store } = fakeStore(); const c = clock(); const key = uniq('force-fail');
    let fail = false;
    const o = { key, freshMs: 60_000, maxStaleMs: 600_000, build: async () => { if (fail) throw new Error('x'); return { v: 1 }; }, store, now: c.now };
    await swrGet(o);
    fail = true; c.advance(10);
    const r = await swrGet({ ...o, force: true });
    assert.equal(r.state, 'stale'); assert.equal(r.rebuildFailed, true); assert.deepEqual(r.value, { v: 1 });
  });
});

describe('swr-cache: memory-only memo and labels', () => {
  test('swrMemo never touches the store', async () => {
    const c = clock(); const key = uniq('memo');
    let builds = 0;
    const r1 = await swrMemo({ key, freshMs: 1000, maxStaleMs: 5000, build: async () => ({ v: ++builds }), now: c.now });
    const r2 = await swrMemo({ key, freshMs: 1000, maxStaleMs: 5000, build: async () => ({ v: ++builds }), now: c.now });
    assert.equal(r1.state, 'miss'); assert.equal(r2.state, 'hit'); assert.equal(builds, 1);
  });

  test('headers carry state + true age; cache-control is private, never public', () => {
    const h = swrHeaders({ state: 'stale', ageMs: 125_400, builtAt: Date.UTC(2026, 9, 2, 10, 0, 0) }, privateCache(60, 300));
    assert.equal(h['x-mc-cache'], 'stale');
    assert.equal(h['x-mc-cache-age'], '125');
    assert.equal(h['x-mc-built-at'], '2026-10-02T10:00:00.000Z');
    assert.equal(h['Cache-Control'], 'private, max-age=60, stale-while-revalidate=300');
    assert.doesNotMatch(h['Cache-Control'], /public|s-maxage/);
  });
});

// ─── lean shapes ───────────────────────────────────────────────────────────────

const sp = (q: string) => new URLSearchParams(q);

describe('lean-view: parsing', () => {
  test('defaults to the full shape', () => {
    const o = parseListOptions(sp(''));
    assert.deepEqual(o, { view: 'full', fields: null, limit: null, tickers: null });
  });
  test('view / fields / limit / tickers parse; bad limit ignored (never a silent empty list)', () => {
    const o = parseListOptions(sp('view=lean&fields=a,%20b&limit=abc&tickers=tcs.ns,infy'));
    assert.equal(o.view, 'lean'); assert.deepEqual(o.fields, ['a', 'b']); assert.equal(o.limit, null);
    assert.deepEqual([...o.tickers!], ['TCS', 'INFY']);
    assert.equal(parseListOptions(sp('limit=0')).limit, 1);
  });
});

describe('lean-view: /api/market/quotes', () => {
  const row = (t: string, extra: Record<string, unknown> = {}) => ({
    ticker: t, company: `${t} Ltd`, sector: 'Tech', industry: 'IT', price: 10, change: 1, changePercent: 10, volume: 5, marketCap: 100,
    previousClose: 9, open: 9.5, dayHigh: 11, dayLow: 9, yearHigh: 20, yearLow: 5, indexGroup: 'Small', deliveryPct: 40, turnoverLacs: 3,
    vol20DAvg: null, volMultiple: null, mom1M: null, pctOf52wHigh: null, staleEOD: false, ...extra,
  });
  const payload = { stocks: [row('AAA'), row('BBB'), row('CCC')], gainers: [row('AAA')], losers: [row('CCC')], summary: { total: 3 }, _diag: { path: 'x' }, source: 's', updatedAt: 'u' };

  test('default request is untouched (same object)', () => {
    assert.equal(shapeQuotesPayload(payload, parseQuotesListOptions(sp(''))), payload);
  });
  test('view=lean keeps only list fields on every row array, values unchanged, meta kept', () => {
    const out = shapeQuotesPayload(payload, parseQuotesListOptions(sp('view=lean')));
    for (const k of ['stocks', 'gainers', 'losers']) for (const r of out[k]) assert.deepEqual(Object.keys(r).sort(), [...QUOTE_LEAN_FIELDS].sort());
    assert.equal(out.stocks[0].yearHigh, 20); assert.equal(out.stocks[0].staleEOD, false);
    assert.deepEqual(out.summary, { total: 3 }); assert.equal(out.updatedAt, 'u'); assert.equal(out._diag, undefined); assert.equal(out.view, 'lean');
    assert.equal(payload.stocks[0].open, 9.5, 'source payload not mutated');
  });
  test('a missing field stays missing (unknown is not zero)', () => {
    const p = { stocks: [{ ticker: 'X', price: 1 }] };
    const out = shapeQuotesPayload(p, parseQuotesListOptions(sp('view=lean')));
    assert.deepEqual(out.stocks[0], { ticker: 'X', price: 1 });
  });
  test('tickers= filters stocks only; gainers/losers kept', () => {
    const out = shapeQuotesPayload(payload, parseQuotesListOptions(sp('tickers=bbb')));
    assert.deepEqual(out.stocks.map((s: any) => s.ticker), ['BBB']); assert.equal(out.gainers.length, 1);
  });
  test('view=summary drops the 2,000-row stocks array but keeps movers + summary', () => {
    const out = shapeQuotesPayload(payload, parseQuotesListOptions(sp('view=summary')));
    assert.equal(out.stocks, undefined); assert.equal(out.gainers.length, 1); assert.deepEqual(out.summary, { total: 3 });
  });
});

describe('lean-view: /api/v1/concall-intel/live-feed', () => {
  const filing = (i: number) => ({
    exchange: 'NSE', symbol: `S${i}`, company_name: `Co ${i}`, subject: 'Transcript', detail: 'long detail', category: 'c', subcategory: null,
    filing_datetime: `2026-09-${10 + i}T00:00:00Z`, attachment_urls: ['a.pdf', 'b.pdf'], source_url: 'u', content_hash: `h${i}`,
    filing_type: 'TRANSCRIPT', is_high_bullish: i === 0, scored_from: 'PDF', pdf_pages: 30,
    bullish: { score: 7, raw_score: 12, sentiment: 'BULLISH', tier: 'BULLISH', confidence: 'HIGH', tags: ['Capex'], bullish_phrases: ['x'.repeat(500)], red_flags: [], critical_blocker: false, fatal_blockers: [], components: { composite_score: 6.5, quality_score: 5 }, evidence: [{ s: 'y'.repeat(800) }] },
    sector_overlay: { sector: 'Defence', sector_confidence: 0.8, overlay_score: 1, positive_signals: ['a'], negative_signals: [], positive_evidence: [{ tag: 'a', sentence: 'z'.repeat(400) }], negative_evidence: [] },
    bottleneck: { big: 'x'.repeat(300) }, evidence: { big: 'x'.repeat(300) }, earnings_delta: { d: 1 },
  });
  const payload = { generated_at: 'g', count_total: 9, count_relevant: 3, count_high_bullish: 1, filings: [filing(0), filing(1), filing(2)], theme_clusters: [{ key: 'k', kind: 'TAG', label: 'L', company_count: 3, filing_count: 3, avg_score: 6, top_companies: [], evidence_excerpts: ['e'.repeat(300)], conviction: 'EMERGING' }], sources: { nse: 'NSE_OK', bse: 'BSE_OK' }, fetch_status: { state: 'OK' } };

  test('default is untouched', () => { assert.equal(shapeLiveFeedPayload(payload, parseListOptions(sp(''))), payload); });
  test('view=lean drops evidence text but keeps identity, tier, scores and counts', () => {
    const out = shapeLiveFeedPayload(payload, parseListOptions(sp('view=lean')));
    const f = out.filings[0];
    assert.equal(f.symbol, 'S0'); assert.equal(f.bullish.tier, 'BULLISH'); assert.equal(f.bullish.components.composite_score, 6.5);
    assert.equal(f.bullish.evidence, undefined); assert.equal(f.bullish.bullish_phrases, undefined);
    assert.deepEqual(f.attachment_urls, ['a.pdf']); assert.equal(f.bottleneck, undefined); assert.equal(f.evidence, undefined); assert.equal(f.detail, undefined);
    assert.equal(f.sector_overlay.sector, 'Defence'); assert.equal(f.sector_overlay.positive_evidence, undefined);
    assert.equal(out.count_relevant, 3); assert.equal(out.fetch_status.state, 'OK'); assert.equal(out.theme_clusters[0].evidence_excerpts, undefined);
    assert.ok(JSON.stringify(out).length < JSON.stringify(payload).length / 2);
  });
  test('limit keeps order and reports the total; fields picks exactly', () => {
    const out = shapeLiveFeedPayload(payload, parseListOptions(sp('limit=2&fields=symbol,filing_datetime')));
    assert.deepEqual(out.filings, [{ symbol: 'S0', filing_datetime: '2026-09-10T00:00:00Z' }, { symbol: 'S1', filing_datetime: '2026-09-11T00:00:00Z' }]);
    assert.equal(out.filings_total, 3);
  });
  test('view=summary: counts + status + timestamp only', () => {
    const out = shapeLiveFeedPayload(payload, parseListOptions(sp('view=summary')));
    assert.deepEqual(out.filings, []); assert.equal(out.generated_at, 'g'); assert.equal(out.count_high_bullish, 1); assert.equal(out.theme_clusters_count, 1);
  });
});

describe('lean-view: /api/v1/news and snapshot etag', () => {
  const arts = [{ id: '1', title: 't', published_at: 'p', tickers: ['A'], layered_beneficiaries: { big: 'x'.repeat(500) }, __noise: true }, { id: '2', title: 'u' }];
  test('default array untouched; lean drops heavy fields; limit slices', () => {
    assert.equal(shapeNewsArticles(arts, parseListOptions(sp(''))), arts);
    const lean = shapeNewsArticles(arts, parseListOptions(sp('view=lean&limit=1')));
    assert.deepEqual(lean, [{ id: '1', title: 't', published_at: 'p', tickers: ['A'] }]);
  });
  test('snapshot etag changes with updated_at and matches weak/strong forms', () => {
    const a = snapshotEtag('client12345', 'IN', '2026-10-01T10:00:00Z');
    const b = snapshotEtag('client12345', 'IN', '2026-10-01T10:00:01Z');
    assert.notEqual(a, b);
    assert.equal(etagMatches(a, a), true); assert.equal(etagMatches(a.replace(/^W\//, ''), a), true);
    assert.equal(etagMatches(`"x", ${a}`, a), true); assert.equal(etagMatches(b, a), false); assert.equal(etagMatches(null, a), false);
  });
});

describe('routes are wired to the helpers (source checks)', () => {
  const src = (p: string) => readFileSync(join(__dirname, '../../app', p), 'utf8');
  test('special-situations feed uses swrGet and keeps the verification gate on every response', () => {
    const s = src('api/v1/special-situations/feed/route.ts');
    assert.match(s, /swrGet\(/); assert.match(s, /applyVerificationGate\(data\)/); assert.match(s, /cache_age_min/);
  });
  test('graded: original handler kept; plain reads fronted by swrGet; no-store answers never cached', () => {
    const s = src('api/v1/earnings/graded/route.ts');
    assert.match(s, /async function gradedLegacyGET\(/); assert.match(s, /export async function GET\(/); assert.match(s, /noStore/);
  });
  test('news keeps the :lastgood fallback', () => {
    const s = src('api/v1/news/route.ts');
    assert.match(s, /refreshNewsLastGood\(/); assert.match(s, /X-News-Served-From/);
  });
  test('mover-reasons and live-feed batch KV reads with MGET', () => {
    assert.match(src('api/market/mover-reasons/route.ts'), /kvMGet[<(]/);
    assert.match(src('api/v1/concall-intel/live-feed/route.ts'), /kvMGet<ScoredFiling>/);
  });
  test('no touched route sets a public / shared cache header', () => {
    for (const p of ['api/v1/special-situations/feed/route.ts', 'api/v1/news/bottleneck-dashboard/route.ts', 'api/v1/concall-intel/transformation-screener/route.ts', 'api/market/mover-reasons/route.ts', 'api/v1/concall-intel/live-feed/route.ts', 'api/market/quotes/route.ts']) {
      assert.doesNotMatch(src(p), /'public|s-maxage/, p);
    }
  });
});
