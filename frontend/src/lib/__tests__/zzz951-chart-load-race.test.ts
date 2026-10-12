import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { cacheChart, freshChart } from '../chart-refresh';
import { drawingKey } from '../chart-math';

test('actual chart load effect: A → pending B → cached A, polling and exchange changes', async () => {
  // Exercise the actual effect with a chart-engine double: browser/canvas behavior is tested separately.
  const source = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  useEffect(() => {', source.indexOf('// ── load data when ticker'));
  const end = source.indexOf('  }, [ready, ticker, market', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start + '  useEffect(() => {'.length, end);
  const names = ['ready','ticker','market','exchange','tf','dataRange','TF_TO_INTERVAL','chartRef','barsRef','setBars','setHoverIdx','TF_TO_PERIOD','setInfo','setError','restoreDrawings','drawingKey','setLoadedVersion','cacheRef','setLoading','fetch','loadedUrlRef','barUpdatesRef','keyRef','setSavedAt','setSyncedAt','freshChart','cacheChart','pollWhenVisible','toolRef','basis'];
  const compiled = transformSync(`function effect(${names.join(',')}) {${body}}`, { loader: 'ts', target: 'es2022' }).code;
  const effect = new Function(`${compiled};return effect;`)();
  let loading = false, info: any, error: any, restores = 0, requests = 0, price = 1;
  const barsRef = { current: [] }, keyRef = { current: '' }, loadedUrlRef = { current: '' }, cacheRef = { current: new Map() };
  const updates: any[] = [], polls = new Set<() => void>();
  const chart = { setPeriod() {}, setSymbol() {}, resetData() {} };
  const fetcher = async (url: string) => { requests++; if (url.includes('/B?')) return new Promise(() => {}); return { ok: true, json: async () => ({ ok: true, ticker: 'A', bars: { t: [1], o: [1], h: [price], l: [1], c: [price], v: [1] } }) }; };
  const call = (ticker: string, exchange?: string) => effect(true, ticker, 'IN', exchange, 'D', '2y', { D: '1d' }, { current: chart }, barsRef, () => {}, () => {}, { D: {} }, (j: any) => { info = j; }, (e: any) => { error = e; }, (k: string) => { restores++; keyRef.current = k; }, drawingKey, () => {}, cacheRef, (v: boolean) => { loading = v; }, fetcher, loadedUrlRef, { current: (bar: any) => updates.push(bar) }, keyRef, () => {}, () => {}, freshChart, cacheChart, (fn: () => void) => { polls.add(fn); return () => polls.delete(fn); }, { current: 'cursor' }, 'price');
  const settle = () => new Promise((r) => setTimeout(r, 10));
  let cleanup = call('A'); await settle();
  assert.equal(loading, false); assert.equal(info.ticker, 'A');
  cleanup(); cleanup = call('B'); assert.equal(loading, true);
  cleanup(); cleanup = call('A');
  assert.equal(loading, false, 'cache hits clear the cancelled request loading state');
  assert.equal(error, null); assert.equal(requests, 2);
  const initialRestores = restores;
  price = 2; [...polls][0](); await settle();
  assert.equal(info.bars.c[0], 2); assert.equal(updates.at(-1).close, 2);
  assert.equal(restores, initialRestores, 'refresh does not discard active drawings');
  cleanup(); cleanup = call('A', 'BSE'); await settle();
  assert.equal(keyRef.current, 'IN:BSE:A'); assert.equal(requests, 4);
  cleanup(); assert.equal(polls.size, 0);
});
