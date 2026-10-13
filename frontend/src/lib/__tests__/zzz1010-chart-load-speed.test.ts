// zzz1010 — chart load speed: one shared request per URL, a visit-long cache shared with the indicators, neighbour prefetch
// held back until the open chart has its answer, stale-while-revalidate, one daily request when patterns / stage are on,
// and server-side coalescing + cutting a shorter history from a longer one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { _chartLoadState, _resetChartLoadCache, chartApiUrl, chartFetch, loadDataRange, neighbourOrder, prefetchCharts, sharedChartCache, STALE_MAX_MS } from '../chart-load-cache';
import { cacheChart, freshChart } from '../chart-refresh';
import { drawingKey } from '../chart-math';
import { chartIdentityKey, chartLoadError, barsForIdentity } from '../chart-loaded-identity';
import { dailyUrl, patternDataPlan } from '../../components/charts/pattern-view';
import { stepRow, itemKey } from '../chart-watchlist';
import { getDailySeries, sliceSeries } from '../chart-data';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = () => new Promise((r) => setTimeout(r, 15));
const answer = (ticker: string, c = 100) => ({ ok: true, ticker, market: 'US', interval: '1d', range: '2y', bars: { t: [1, 2], o: [c, c], h: [c, c], l: [c, c], c: [c, c], v: [1, 1] } });

/** A fetcher whose answers are released by hand; counts network calls per URL. */
function heldFetcher() {
  const calls: string[] = [];
  const release = new Map<string, () => void>();
  const fetcher = (url: string) => {
    calls.push(url);
    const t = decodeURIComponent(/\/api\/v1\/chart\/([^?]+)/.exec(url)![1]);
    return new Promise<any>((r) => release.set(url, () => r({ ok: true, status: 200, json: async () => answer(t) })));
  };
  return { calls, release, fetcher };
}

test('one network call per URL however many ask; an abandoned caller only detaches; the answer lands in the shared cache', async () => {
  const f = heldFetcher();
  _resetChartLoadCache(f.fetcher as any);
  const url = chartApiUrl('NVDA', 'US', undefined, 'D', '5y', 'price');
  const ctrl = new AbortController();
  const chart = chartFetch(url, { signal: ctrl.signal });
  const pattern = chartFetch(url);
  const stage = chartFetch(url);
  assert.equal(f.calls.length, 1, 'the chart, the pattern and the stage indicator share one request');
  ctrl.abort();
  await assert.rejects(chart, /Abort/);
  f.release.get(url)!();
  const [a, b] = await Promise.all([pattern, stage]);
  assert.equal((await a.json()).ticker, 'NVDA'); assert.equal((await b.json()).ticker, 'NVDA');
  assert.equal(freshChart(sharedChartCache(), url, 300_000)?.ticker, 'NVDA', 'cached even though the first caller left');
  assert.equal(_chartLoadState().inflight, 0);
});

test('prefetch waits for the chart the owner is looking at, then runs two at a time, skips fresh / queued URLs', async () => {
  const f = heldFetcher();
  _resetChartLoadCache(f.fetcher as any);
  const u = (t: string) => chartApiUrl(t, 'US', undefined, 'D', '2y', 'price');
  const open = chartFetch(u('A'));
  assert.deepEqual(prefetchCharts([u('B'), u('C'), u('D'), u('B')]), [u('B'), u('C'), u('D')]);
  assert.deepEqual(f.calls, [u('A')], 'nothing goes out while the open chart is loading');
  f.release.get(u('A'))!(); await open; await tick(); await tick();
  assert.deepEqual(f.calls, [u('A'), u('B'), u('C')], 'then two at a time, most likely next first');
  f.release.get(u('B'))!(); await tick(); await tick(); await tick();
  assert.deepEqual(f.calls, [u('A'), u('B'), u('C'), u('D')]);
  f.release.get(u('C'))!(); f.release.get(u('D'))!(); await settle();
  assert.deepEqual(prefetchCharts([u('B'), u('C')]), [], 'already fresh: not fetched again');
  assert.equal(f.calls.length, 4);
});

// the REAL load effect from ChartWorkspace (same harness as zzz951)
function realEffect() {
  const source = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  useEffect(() => {', source.indexOf('// ── load data when ticker'));
  const end = source.indexOf('  }, [ready, ticker, market', start);
  const body = source.slice(start + '  useEffect(() => {'.length, end);
  const names = ['ready','ticker','market','exchange','tf','dataRange','TF_TO_INTERVAL','chartRef','barsRef','setBars','setHoverIdx','TF_TO_PERIOD','setInfo','setError','restoreDrawings','drawingKey','setLoadedVersion','cacheRef','setLoading','chartFetch','loadedUrlRef','barUpdatesRef','keyRef','setSavedAt','setSyncedAt','freshChart','cacheChart','pollWhenVisible','toolRef','basis','chartIdentityKey','loadedIdRef','chartLoadError'];
  return new Function(`${transformSync(`function effect(${names.join(',')}) {${body}}`, { loader: 'ts', target: 'es2022' }).code};return effect;`)();
}

test('a prefetched neighbour draws from memory: zero requests, no loading state, bars tagged with ITS identity', async () => {
  const f = heldFetcher();
  _resetChartLoadCache(f.fetcher as any);
  const effect = realEffect();
  let loading = false, info: any = null, loaded: any = null;
  const refs = { chart: { current: { setPeriod() {}, setSymbol() {}, resetData() {} } }, bars: { current: [] }, url: { current: '' }, upd: { current: null }, key: { current: '' }, loadedId: { current: '' } };
  const run = (t: string) => effect(true, t, 'US', undefined, 'D', '2y', { D: '1d' }, refs.chart, refs.bars, (b: any) => { loaded = b; }, () => {}, { D: {} }, (j: any) => { info = j; }, () => {}, (k: string) => { refs.key.current = k; }, drawingKey, () => {}, { current: sharedChartCache() }, (v: boolean) => { loading = v; }, chartFetch, refs.url, refs.upd, refs.key, () => {}, () => {}, freshChart, cacheChart, () => () => {}, { current: 'cursor' }, 'price', chartIdentityKey, refs.loadedId, chartLoadError);
  let cleanup = run('A');
  assert.equal(loading, true);
  prefetchCharts([chartApiUrl('B', 'US', undefined, 'D', '2y', 'price')]);
  f.release.get(chartApiUrl('A', 'US', undefined, 'D', '2y', 'price'))!(); await settle();
  assert.equal(info.ticker, 'A');
  f.release.get(chartApiUrl('B', 'US', undefined, 'D', '2y', 'price'))!(); await settle();
  const before = f.calls.length;
  cleanup(); cleanup = run('B');
  assert.equal(f.calls.length, before, 'no request for the prefetched symbol');
  assert.equal(loading, false); assert.equal(info.ticker, 'B');
  assert.deepEqual(barsForIdentity(loaded, chartIdentityKey({ ticker: 'B', market: 'US', tf: 'D', basis: 'price' })).map((b: any) => b.c), [100, 100]);
  assert.deepEqual(barsForIdentity(loaded, chartIdentityKey({ ticker: 'A', market: 'US', tf: 'D', basis: 'price' })), [], 'never shown as another symbol');
  cleanup();
});

test('stale-while-revalidate: an hour-old copy of THIS url is drawn at once, the fresh answer replaces it; too-old copies are not shown', async () => {
  const f = heldFetcher();
  _resetChartLoadCache(f.fetcher as any);
  const effect = realEffect();
  const url = chartApiUrl('C', 'US', undefined, 'D', '2y', 'price');
  cacheChart(sharedChartCache(), url, answer('C', 90), Date.now() - 3600_000);
  cacheChart(sharedChartCache(), chartApiUrl('OLD', 'US', undefined, 'D', '2y', 'price'), answer('OLD', 1), Date.now() - STALE_MAX_MS - 1000);
  let loading = false, info: any = null, loaded: any = null;
  const refs = { chart: { current: { setPeriod() {}, setSymbol() {}, resetData() {} } }, bars: { current: [] }, url: { current: '' }, upd: { current: (_: any) => {} }, key: { current: '' }, loadedId: { current: '' } };
  const run = (t: string) => effect(true, t, 'US', undefined, 'D', '2y', { D: '1d' }, refs.chart, refs.bars, (b: any) => { loaded = b; }, () => {}, { D: {} }, (j: any) => { info = j; }, () => {}, (k: string) => { refs.key.current = k; }, drawingKey, () => {}, { current: sharedChartCache() }, (v: boolean) => { loading = v; }, chartFetch, refs.url, refs.upd, refs.key, () => {}, () => {}, freshChart, cacheChart, () => () => {}, { current: 'cursor' }, 'price', chartIdentityKey, refs.loadedId, chartLoadError);
  let cleanup = run('C');
  assert.equal(info?.bars.c[0], 90, 'the stale copy is on screen immediately');
  assert.equal(loading, true, 'while the fresh answer loads');
  assert.equal(f.calls.length, 1);
  f.release.get(url)!(); await settle();
  assert.equal(info.bars.c[0], 100); assert.equal(loading, false);
  cleanup();
  info = null; loaded = null;
  cleanup = run('OLD');
  assert.equal(info, null, 'older than STALE_MAX_MS: not drawn');
  cleanup();
});

test('one daily request when patterns / stage are on; the URL is the one the indicators and the page build', () => {
  assert.equal(loadDataRange('2y', 'D', true), '5y');
  assert.equal(loadDataRange('2y', 'D', false), '2y');
  assert.equal(loadDataRange('10y', 'D', true), '10y');
  assert.equal(loadDataRange('10y', 'W', true), '10y', 'weekly interval: unchanged');
  const url = chartApiUrl('M&M', 'IN', 'BSE', 'D', '5y', 'tr');
  assert.equal(url, dailyUrl('M&M', 'IN', 'BSE', 'tr'), 'prefetch / load / pattern indicator: one cache entry');
  assert.equal(chartApiUrl('QQQ', 'US', 'NSE', 'W', '10y', 'price'), '/api/v1/chart/QQQ?market=US&interval=1wk&range=10y');
  assert.equal(patternDataPlan({ interval: '1d', range: loadDataRange('2y', 'D', true) }, 'X', 'US', undefined, 'price').useShown, true, 'the pattern indicator reuses the chart answer');
  const ws = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(ws, /loadDataRange\(dataRangeFor\(tf, range\), tf, needsLongDaily\)/);
  assert.match(ws, /chartFetch\(url, \{ signal/);
  assert.match(ws, /useRef\(sharedChartCache\(\)/);
  assert.match(ws, /prefetch=\{ready \? prefetchFor : undefined\}/);
  const wl = readFileSync(new URL('../../components/charts/WatchlistPanel.tsx', import.meta.url), 'utf8');
  assert.match(wl, /neighbourOrder<string>/);
});

test('neighbour order: +1, −1, +2, −2 and stops at the ends of the list', () => {
  const rows = ['A', 'B', 'C', 'D', 'E'].map((t) => ({ item: { m: 'US', t } })) as any[];
  const near = (cur: string) => neighbourOrder<string>((from, dir) => { const r = stepRow(rows, from ?? itemKey({ m: 'US', t: cur } as any), dir); return r ? itemKey(r.item) : null; });
  assert.deepEqual(near('C').map((k) => k.split(':').pop()), ['D', 'B', 'E', 'A']);
  assert.deepEqual(near('A').map((k) => k.split(':').pop()), ['B', 'C']);
  assert.deepEqual(near('E').map((k) => k.split(':').pop()), ['D', 'C']);
});

// ── server ──────────────────────────────────────────────────────────────────────
function yahooPayload(symbol: string, days: number) {
  const DAY = 86_400;
  const end = Math.floor(Date.UTC(2026, 9, 12) / 1000) + 14 * 3600;
  const ts: number[] = [];
  for (let i = days; i >= 0; i--) { const t = end - i * DAY; const wd = new Date(t * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) ts.push(t); }
  const c = ts.map((_, i) => 100 + i);
  return { chart: { result: [{ meta: { symbol, currency: 'USD', dataGranularity: '1d', gmtoffset: -14400 }, timestamp: ts, indicators: { quote: [{ open: c, high: c, low: c, close: c, volume: c }] } }] } };
}

test('server: concurrent asks share one Yahoo call; a 2-year view is cut from a fresh 5-year series', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (u: any) => { calls++; await new Promise((r) => setTimeout(r, 20)); return { ok: true, json: async () => yahooPayload('ZZTEST', 5 * 366) } as any; }) as any;
  try {
    const [a, b] = await Promise.all([getDailySeries('US', 'ZZTEST', '5y'), getDailySeries('US', 'ZZTEST', '5y')]);
    assert.equal(calls, 1, 'one upstream call for two concurrent requests');
    assert.equal(a, b);
    const two = await getDailySeries('US', 'ZZTEST', '2y');
    assert.equal(calls, 1, 'the 2-year view did not go back to Yahoo');
    assert.ok(two && a && two.bars.length < a.bars.length && two.bars.length > 450);
    assert.equal(two!.bars.at(-1)!.t, a!.bars.at(-1)!.t, 'same newest candle');
    const s = sliceSeries(a!, '2y', Date.UTC(2026, 9, 12));
    assert.ok(s.bars[0].t >= Date.UTC(2024, 9, 12));
    assert.equal(sliceSeries(a!, 'max'), a);
  } finally { globalThis.fetch = realFetch; }
});

test('server: the route reads the float alongside the history and never waits more than 1.5 s for it', () => {
  const route = readFileSync(new URL('../../app/api/v1/chart/[ticker]/route.ts', import.meta.url), 'utf8');
  assert.ok(route.indexOf('const floatP') < route.indexOf('await getDailySeries'), 'float lookup starts before the history is awaited');
  assert.match(route, /setTimeout\(\(\) => r\(null\), 1500\)/);
  assert.match(route, /void loadFloat\(\)/, 'an hour-old float map answers while the new one is read');
});
