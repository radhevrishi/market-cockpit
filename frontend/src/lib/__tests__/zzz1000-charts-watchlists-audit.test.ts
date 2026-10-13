// zzz1000 — Charts / Watchlists audit (13 Oct 2026): CW-01 null vs zero, CW-02 roving keyboard focus, CW-03 loaded identity,
// CW-04 export scopes, CW-05 Indicators Escape, plus filtered sections, list → chart hand-off, axis-tag stacking and
// first-load vs refresh error wording. Mounted tests run the real components in JSDOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { transformSync } from 'esbuild';
import * as XLSX from 'xlsx';
import { numOrNull, quoteNumbers, buildWatchlistExport, defaultExportScope, type ExportItem } from '../watchlist-export';
import { chartIdentityKey, barsForIdentity, chartLoadError, NO_BARS } from '../chart-loaded-identity';
import { stackAxisLabels } from '../chart-axis-labels';
import { watchlistReviewItems, chartReviewUrl, STANDALONE_WATCHLIST_ID } from '../watchlist-chart-handoff';
import { parseQueue, reviewWords, CHART_REVIEW_QUEUE_KEY, reviewFromUrl } from '../chart-review-queue';
import { importParsed, parseTradingView, sanitizeStore, itemKey, viewRows, visibleSections, type WlStore } from '../chart-watchlist';
import { cacheChart, freshChart } from '../chart-refresh';
import { drawingKey } from '../chart-math';
import { cleanLayout, legendRows, seriesValues } from '../chart-layouts';

// ── JSDOM harness (same pattern as zzz953) ────────────────────────────────────
async function withDom(fn: (h: { dom: JSDOM; mount: (el: React.ReactNode) => Promise<void>; settle: () => Promise<void> }) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/charts', pretendToBeVisual: true });
  const names = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'StorageEvent', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const previous = new Map(names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'StorageEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 20));
  const mount = async (element: React.ReactNode) => { await act(async () => { root.render(element); await settle(); }); };
  try { await fn({ dom, mount, settle }); }
  finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, d] of previous) { if (d) Object.defineProperty(globalThis, key, d); else delete (globalThis as any)[key]; }
  }
}
const h = React.createElement;
const key = (k: string, target?: Element | null) => act(async () => { (target || document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const activeKey = () => (document.activeElement as HTMLElement | null)?.getAttribute('data-key');

// ── CW-01 ─────────────────────────────────────────────────────────────────────
test('CW-01: unknown quote numbers stay null; a real 0% change stays 0; a missing price is not "flat"', () => {
  assert.equal(numOrNull(0), 0);
  assert.equal(numOrNull(0, { positive: true }), null);
  assert.equal(numOrNull(undefined), null);
  assert.equal(numOrNull('12.5'), 12.5);
  assert.equal(numOrNull(NaN), null);
  assert.deepEqual(quoteNumbers({ price: 1268.4, change: 15, changePercent: 1.23 }), { price: 1268.4, change: 15, changePercent: 1.23, dayHigh: null, dayLow: null });
  assert.deepEqual(quoteNumbers({ price: 50, change: 0, changePercent: 0, dayHigh: 51, dayLow: 49 }), { price: 50, change: 0, changePercent: 0, dayHigh: 51, dayLow: 49 });
  // no price → the change is unknown, even if the feed sent 0
  assert.deepEqual(quoteNumbers({ price: 0, change: 0, changePercent: 0, dayHigh: 0, dayLow: 0 }), { price: null, change: null, changePercent: null, dayHigh: null, dayLow: null });
  assert.deepEqual(quoteNumbers(undefined), { price: null, change: null, changePercent: null, dayHigh: null, dayLow: null });
  // the page and the quote mappers no longer pad with 0 / with the price
  const page = readFileSync(new URL('../../app/(dashboard)/watchlists/page.tsx', import.meta.url), 'utf8');
  const helpers = readFileSync(new URL('../../app/(dashboard)/watchlists/helpers.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../../app/api/market/quote/route.ts', import.meta.url), 'utf8');
  for (const src of [page, helpers]) assert.doesNotMatch(src, /(dayHigh|dayLow|price|changePercent|change): (quote\?|stock)\.\w+ \|\| 0/);
  assert.doesNotMatch(route, /dayHigh: [^\n]*\|\| (lastPrice|price),/);
});

test('CW-01: the XLSX export writes unknown numbers as blank cells and genuine zeros as 0', () => {
  const items: ExportItem[] = [
    { ticker: 'AXISBANK', company: 'Axis Bank', sector: 'Banks', price: 1268.4, changePercent: 1.23, dayHigh: null, dayLow: null },
    { ticker: 'FLAT', company: 'Flat Co', sector: '—', price: 50, changePercent: 0, dayHigh: 51, dayLow: 49 },
    { ticker: 'NOQ', company: 'No Quote', sector: '—', price: null, changePercent: null, dayHigh: null, dayLow: null },
  ];
  const out = buildWatchlistExport(items, items, 'all');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out.rows), 'Watchlist');
  const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<any>(back.Sheets.Watchlist, { defval: null });
  assert.equal(rows.length, 3);
  assert.equal(rows[0]['Day High'], null); assert.equal(rows[0]['Day Low'], null);       // was 0
  assert.equal(rows[0]['CMP'], 1268.4); assert.equal(rows[0]['Change %'], 1.23);
  assert.equal(rows[1]['Change %'], 0, 'a genuine 0% change stays numeric 0');
  assert.equal(rows[1]['Day High'], 51); assert.equal(rows[1]['Day Low'], 49);
  assert.equal(rows[2]['CMP'], null); assert.equal(rows[2]['Change %'], null, 'missing price is not exported as a 0% (flat) day');
  const cell = back.Sheets.Watchlist['F3'];   // FLAT's Change %
  assert.equal(cell?.t, 'n'); assert.equal(cell?.v, 0);
});

test('CW-01: the table shows — for unknown values and the summary leaves unknown changes out', async () => {
  await withDom(async ({ mount }) => {
    const { WatchlistTable, SummaryBar } = await import('../../app/(dashboard)/watchlists/components');
    const items: any[] = [
      { ticker: 'AXISBANK', company: 'Axis Bank', sector: 'Banks', price: 1268.4, change: 15, changePercent: 1.23, dayHigh: null, dayLow: null, market: 'IN' },
      { ticker: 'FLAT', company: 'Flat Co', sector: '—', price: 50, change: 0, changePercent: 0, dayHigh: 51, dayLow: 49, market: 'IN' },
      { ticker: 'NVDA', company: 'NVIDIA', sector: '—', price: null, change: null, changePercent: null, dayHigh: null, dayLow: null, market: 'US' },
    ];
    await mount(h('div', null, h(SummaryBar, { items }), h(WatchlistTable, { items, sortField: 'ticker', sortOrder: 'asc', onSort: () => {}, onRemove: () => {} })));
    const row = (t: string) => document.querySelector(`[data-watchlist-ticker="${t}"]`)!;
    const cells = (t: string) => Array.from(row(t).querySelectorAll('td')).map((td) => td.textContent!.trim());
    assert.deepEqual(cells('AXISBANK').slice(4, 8), ['₹1268.40', '+1.23%', '—', '—']);
    assert.deepEqual(cells('FLAT').slice(4, 8), ['₹50.00', '+0.00%', '₹51.00', '₹49.00']);
    assert.deepEqual(cells('NVDA').slice(4, 8), ['—', '—', '—', '—']);
    assert.match(row('NVDA').querySelector('a')!.getAttribute('href')!, /m=US/, 'US rows open on the US chart');
    // zzz1013 — one figures strip with sentence-case labels (was four cards in capitals)
    assert.match(document.body.textContent!, /Average change\+0\.61%/, 'average over the two known changes only');
    assert.match(document.body.textContent!, /Gainers1/); assert.match(document.body.textContent!, /Losers0/);
  });
});

// ── CW-04 ─────────────────────────────────────────────────────────────────────
test('CW-04: export scope — filtered rows by default while searching, the whole list as an explicit choice, metadata recorded', async () => {
  const all: ExportItem[] = Array.from({ length: 15 }, (_, i) => ({ ticker: i === 7 ? 'INFY' : `T${i}`, company: i === 7 ? 'Infosys' : `Co ${i}`, sector: '—', price: 10 + i, changePercent: 1, dayHigh: null, dayLow: null }));
  const visible = all.filter((x) => /infosys/i.test(x.company));
  assert.equal(defaultExportScope(true), 'filtered'); assert.equal(defaultExportScope(false), 'all');
  const f = buildWatchlistExport(all, visible, 'filtered', { search: 'Infosys', sortField: 'ticker', sortOrder: 'asc', quotesAt: new Date('2026-10-13T17:00:00Z'), exportedAt: new Date('2026-10-13T17:05:00Z') });
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].Ticker, 'INFY'); assert.equal(f.count, 1); assert.equal(f.total, 15);
  const info = Object.fromEntries(f.info);
  assert.equal(info.Scope, 'Filtered rows: 1 of 15'); assert.equal(info['Search / filter'], 'Infosys');
  assert.equal(info['Quotes as of'], '2026-10-13T17:00:00.000Z'); assert.equal(info.Sort, 'ticker asc');
  const a = buildWatchlistExport(all, visible, 'all', { search: 'Infosys' });
  assert.equal(a.rows.length, 15); assert.deepEqual(a.rows.map((r) => r.Ticker), all.map((x) => x.ticker), 'table order kept');
  assert.match(Object.fromEntries(a.info)['Search / filter'], /not applied/);
  const none = buildWatchlistExport(all, all, 'all');
  assert.equal(none.rows.length, 15); assert.equal(Object.fromEntries(none.info)['Search / filter'], '(none)');

  await withDom(async ({ mount }) => {
    const { WatchlistExportControl } = await import('../../app/(dashboard)/watchlists/components');
    const calls: string[] = [];
    await mount(h(WatchlistExportControl, { filterActive: true, filteredCount: 1, totalCount: 15, onExport: (s: string) => calls.push(s) }));
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-export-scope]'));
    assert.deepEqual(btns.map((b) => b.textContent), ['Export filtered (1)', 'Export all (15)'], 'filtered is first (the default) while searching');
    await act(async () => btns[0].click()); await act(async () => btns[1].click());
    assert.deepEqual(calls, ['filtered', 'all']);
    await mount(h(WatchlistExportControl, { filterActive: false, filteredCount: 15, totalCount: 15, onExport: (s: string) => calls.push(s) }));
    assert.deepEqual(Array.from(document.querySelectorAll('[data-export-scope]')).map((b) => b.textContent), ['Export all (15)'], 'no search: unchanged single export');
  });
  const page = readFileSync(new URL('../../app/(dashboard)/watchlists/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /buildWatchlistExport\(sortedItems, visibleItems, scope/);
  assert.match(page, /'Export info'/);
});

// ── CW-02 + improvement 1 ─────────────────────────────────────────────────────
test('CW-02: ↓ then Enter stays on the new row; arrows follow the visible set; inputs and dialogs keep their keys', async () => {
  await withDom(async ({ mount, settle }) => {
    const { _resetSharedFetch } = await import('../tab-shared-fetch');
    _resetSharedFetch();
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ quotes: { 'US:NVDA': { last: 180, chgPct: 1, name: 'NVIDIA Corporation' }, 'US:KLIC': { last: 40, chgPct: 0, name: 'Kulicke and Soffa' } } }) })) as any;
    const { default: Watchlist } = await import('../../components/charts/WatchlistPanel');
    const start = importParsed(sanitizeStore(null), parseTradingView('###Semis,NASDAQ:NVDA,NASDAQ:KLIC,###India,NSE:TCS,NSE:INFY'), { mode: 'new', name: 'Review' });
    const picks: string[] = [];
    function Wrap() {
      const [store, setStore] = React.useState<WlStore>(start);
      const [cur, setCur] = React.useState('US:NVDA');
      return h(Watchlist, { store, update: (fn: (s: WlStore) => WlStore) => setStore((s) => fn(s)), currentKey: cur, onPick: (m: any, t: string, x?: string) => { picks.push(t); setCur(itemKey({ m, t, x })); }, loading: cur === 'US:KLIC' });
    }
    await mount(h(Wrap));
    const row = (k: string) => document.querySelector<HTMLElement>(`[data-key="${k}"]`)!;
    assert.equal(row('US:NVDA').getAttribute('tabindex'), '0'); assert.equal(row('US:KLIC').getAttribute('tabindex'), '-1');
    await act(async () => row('US:NVDA').focus());
    await key('ArrowDown');
    assert.equal(picks.at(-1), 'KLIC'); assert.equal(activeKey(), 'US:KLIC', 'focus moved with the selection');
    assert.equal(row('US:KLIC').getAttribute('aria-selected'), 'true'); assert.equal(row('US:NVDA').getAttribute('aria-selected'), 'false');
    assert.equal(row('US:KLIC').getAttribute('tabindex'), '0');
    assert.match(document.querySelector('[aria-live="polite"]')!.textContent!, /KLIC selected, loading chart/);
    await key('Enter');
    assert.equal(picks.at(-1), 'KLIC', 'Enter opens the focused = selected row (was: back to NVDA)');
    await key('ArrowDown'); assert.equal(activeKey(), 'IN:TCS', 'crosses into the next section');
    await key('ArrowUp'); assert.equal(activeKey(), 'US:KLIC');
    await key('End'); assert.equal(activeKey(), 'IN:INFY'); assert.equal(picks.at(-1), 'INFY');
    await key('Home'); assert.equal(activeKey(), 'US:NVDA'); assert.equal(picks.at(-1), 'NVDA');

    // re-sort while a row has keyboard focus: the row keeps focus
    await act(async () => row('US:KLIC').focus());
    await key('Enter');
    const symbolHeader = Array.from(document.querySelectorAll('button')).find((b) => b.textContent!.startsWith('Symbol'))!;
    await act(async () => { symbolHeader.click(); await settle(); });
    await act(async () => { symbolHeader.click(); await settle(); });   // descending: KLIC now after NVDA… order changed
    assert.equal(activeKey(), 'US:KLIC', 'focus survives a re-sort');
    await act(async () => { symbolHeader.click(); await settle(); });   // back to list order

    // the search box keeps its arrow keys
    const n = picks.length;
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search watchlist"]')!;
    await act(async () => input.focus());
    await key('ArrowDown', input);
    assert.equal(picks.length, n, 'typing in the search box never changes the ticker');
    // a dialog keeps its arrow keys
    const dlg = document.createElement('div'); dlg.setAttribute('role', 'dialog'); const b = document.createElement('button'); dlg.appendChild(b); document.body.appendChild(dlg);
    await act(async () => b.focus());
    await key('ArrowDown', b);
    assert.equal(picks.length, n, 'arrows inside a dialog are not hijacked');
    dlg.remove();
    // chart-side ↓ (focus not in the list) steps the list without taking focus
    await act(async () => { (document.activeElement as HTMLElement)?.blur?.(); document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); });
    await key('ArrowDown', document.body);
    assert.equal(picks.length, n + 1); assert.notEqual(activeKey(), itemKey({ m: 'US', t: picks.at(-1)! }), 'chart-originated step does not steal focus');

    // filtered: India only — ↑/↓ stay inside the visible rows
    await act(async () => { (document.querySelector('[aria-label="Show India"]') as HTMLElement).click(); await settle(); });
    assert.deepEqual(Array.from(document.querySelectorAll('[data-key]')).map((e) => e.getAttribute('data-key')), ['IN:TCS', 'IN:INFY']);
    await act(async () => row('IN:TCS').focus());
    await key('Enter'); await key('ArrowDown'); assert.equal(activeKey(), 'IN:INFY');
    const before = picks.length; await key('ArrowDown'); assert.equal(picks.length, before, 'no step past the last visible row');
    await act(async () => { Array.from(document.querySelectorAll('button')).find((x) => x.textContent === 'Clear filters')!.click(); await settle(); });
    // collapsed section is skipped
    await act(async () => { (document.querySelector('[aria-label="Toggle section India"]') as HTMLElement).click(); await settle(); });
    assert.equal(row('IN:TCS'), null);
    await act(async () => row('US:KLIC').focus()); await key('Enter');
    const c = picks.length; await key('ArrowDown'); assert.equal(picks.length, c, 'collapsed rows are not stepped into');
  });
});

test('Improvement 1: a filtered view hides sections without matches, shows "n shown / N", and restores on clear', async () => {
  const store = importParsed(sanitizeStore(null), parseTradingView('###Semis,NASDAQ:NVDA,NASDAQ:KLIC,###India,NSE:TCS,NSE:INFY,###Empty US,NASDAQ:AAPL'), { mode: 'new', name: 'Sections' });
  const list = store.lists.find((l) => l.id === store.activeId)!;
  const quotes = { 'US:NVDA': { last: 1, chgPct: 1, name: 'NVIDIA Corporation' } };
  const g = viewRows(list, null, quotes, null, { query: 'nvidia' });
  assert.deepEqual(g.map((x) => x.matches), [1, 0, 0]);
  assert.deepEqual(visibleSections(g, true, false).map((x) => x.section.name), ['Semis']);
  assert.equal(visibleSections(g, true, true).length, 3);
  assert.equal(visibleSections(g, false, false).length, 3, 'no filter: every section, as before');
  list.sections[0].collapsed = true;
  assert.equal(viewRows(list, null, quotes, null, { market: 'US' })[0].matches, 2, 'a collapsed section still counts its matches');
  list.sections[0].collapsed = false;

  await withDom(async ({ mount, settle }) => {
    const { _resetSharedFetch } = await import('../tab-shared-fetch');
    _resetSharedFetch();
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ quotes }) })) as any;
    const { default: Watchlist } = await import('../../components/charts/WatchlistPanel');
    await mount(h(Watchlist, { store, update: () => {}, currentKey: 'US:NVDA', onPick: () => {} }));
    const headers = () => Array.from(document.querySelectorAll('.mcwl-sec')).map((e) => e.textContent!.replace(/rename.*$/, '').trim());
    // zzz1006 — readable label · count (was "Semis(2)"); filtered: "1 of 2" (was "1 shown / 2")
    assert.deepEqual(headers(), ['▾Semis · 2', '▾India · 2', '▾Empty US · 1']);
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search watchlist"]')!;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setValue.call(input, 'nvidia'); input.dispatchEvent(new Event('input', { bubbles: true })); await settle(); });
    assert.deepEqual(headers(), ['▾Semis · 1 of 2']);
    assert.match(document.body.textContent!, /2 sections without matches hidden/);
    await act(async () => { Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Show empty sections')!.click(); await settle(); });
    assert.deepEqual(headers(), ['▾Semis · 1 of 2', '▾India · 0 of 2', '▾Empty US · 0 of 1']);
    await act(async () => { Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Hide empty sections')!.click(); await settle(); });
    // no match: feedback right under the filter controls (before the column headers and the list)
    await act(async () => { setValue.call(input, 'zzzz'); input.dispatchEvent(new Event('input', { bubbles: true })); await settle(); });
    const msg = Array.from(document.querySelectorAll('[role="status"]')).find((e) => /No matching symbols/.test(e.textContent!))!;
    assert.ok(msg);
    const grid = document.querySelector('[role="grid"]')!;
    assert.ok(msg.compareDocumentPosition(grid) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'message sits above the list');
    assert.equal((document.body.textContent!.match(/No matching symbols/g) || []).length, 1, 'one message, not two');
    await act(async () => { Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Clear filters')!.click(); await settle(); });
    assert.deepEqual(headers(), ['▾Semis · 2', '▾India · 2', '▾Empty US · 1'], 'grouping restored when filters clear');
  });
});

// ── CW-03 + improvement 6 ─────────────────────────────────────────────────────
test('CW-03: legend values belong to the loaded identity — delayed response, rapid switch, refresh, invalid ticker', async () => {
  const id = (t: string, extra: Partial<{ market: string; exchange: string; tf: string; basis: string }> = {}) => chartIdentityKey({ ticker: t, market: 'US', tf: 'D', basis: 'price', ...extra });
  assert.notEqual(id('A'), id('B')); assert.notEqual(id('A'), id('A', { tf: 'W' })); assert.notEqual(id('A'), id('A', { basis: 'tr' }));
  assert.notEqual(chartIdentityKey({ ticker: 'X', market: 'IN', exchange: 'NSE', tf: 'D', basis: 'price' }), chartIdentityKey({ ticker: 'X', market: 'IN', exchange: 'BSE', tf: 'D', basis: 'price' }));
  assert.equal(chartIdentityKey({ ticker: 'X', market: 'US', exchange: 'NASDAQ', tf: 'D', basis: 'price' }), id('X'));
  assert.deepEqual(barsForIdentity({ id: id('A'), bars: [1] }, id('B')), []);
  assert.deepEqual(barsForIdentity({ id: id('A'), bars: [1] }, id('A')), [1]);
  assert.equal(barsForIdentity(NO_BARS, id('A')), barsForIdentity(null, id('B')), 'one stable empty array (memo-friendly)');

  // the REAL load effect from ChartWorkspace, run inside a mounted component that renders the real legend
  const source = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /const bars = barsForIdentity\(loadedBars, viewId\)/, 'the workspace renders values through the identity gate');
  const startAt = source.indexOf('  useEffect(() => {', source.indexOf('// ── load data when ticker'));
  const end = source.indexOf('  }, [ready, ticker, market', startAt);
  const body = source.slice(startAt + '  useEffect(() => {'.length, end);
  const names = ['ready', 'ticker', 'market', 'exchange', 'tf', 'dataRange', 'TF_TO_INTERVAL', 'chartRef', 'barsRef', 'setBars', 'setHoverIdx', 'TF_TO_PERIOD', 'setInfo', 'setError', 'restoreDrawings', 'drawingKey', 'setLoadedVersion', 'cacheRef', 'setLoading', 'chartFetch', 'loadedUrlRef', 'barUpdatesRef', 'keyRef', 'setSavedAt', 'setSyncedAt', 'freshChart', 'cacheChart', 'pollWhenVisible', 'toolRef', 'basis', 'chartIdentityKey', 'loadedIdRef', 'chartLoadError'];
  const effect = new Function(`${transformSync(`function effect(${names.join(',')}) {${body}}`, { loader: 'ts', target: 'es2022' }).code};return effect;`)();

  await withDom(async ({ mount, settle }) => {
    const { IndicatorLegend } = await import('../../components/charts/LayoutControls');
    const layout = cleanLayout({ lines: [{ id: 'e2', kind: 'EMA', period: 2, color: '#FFD600' }, { id: 'e3', kind: 'EMA', period: 3, color: '#2962FF' }] });
    const price: Record<string, number> = { A: 100, B: 200, C: 300, D: 400 };
    const failNext = new Set<string>();
    const held = new Map<string, () => void>();
    let holdNext = new Set<string>();
    const polls = new Set<() => void>();
    const fetcher = (url: string) => {
      const t = decodeURIComponent(/\/api\/v1\/chart\/([^?]+)/.exec(url)![1]);
      const answer = () => (t === 'ZZZZ' || failNext.delete(t)
        ? { ok: false, status: 404, json: async () => ({ ok: false, error: `Could not load ${t} (HTTP 404).` }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, ticker: t, market: 'US', bars: { t: [1, 2, 3, 4], o: [1, 1, 1, 1], h: [1, 1, 1, 1], l: [1, 1, 1, 1], c: Array(4).fill(price[t]), v: [1, 1, 1, 1] } }) });
      if (!holdNext.has(t)) return Promise.resolve(answer());
      holdNext.delete(t);
      return new Promise((r) => held.set(t, () => r(answer())));
    };
    let setT!: (t: string) => void;
    function Harness() {
      const [ticker, setTicker] = React.useState('A'); setT = setTicker;
      const [loaded, setLoaded] = React.useState<any>(NO_BARS);
      const [error, setError] = React.useState<string | null>(null);
      const refs = React.useRef({ chart: { current: { setPeriod() {}, setSymbol() {}, resetData() {} } }, bars: { current: [] }, cache: { current: new Map() }, url: { current: '' }, upd: { current: null }, key: { current: '' }, tool: { current: 'cursor' }, loadedId: { current: '' } }).current;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; the real effect re-runs on the ticker only here
      React.useEffect(() => effect(true, ticker, 'US', undefined, 'D', '1y', { D: '1d' }, refs.chart, refs.bars, setLoaded, () => {}, { D: {} }, () => {}, setError, (k: string) => { refs.key.current = k; }, drawingKey, () => {}, refs.cache, () => {}, fetcher, refs.url, refs.upd, refs.key, () => {}, () => {}, freshChart, cacheChart, (fn: () => void) => { polls.add(fn); return () => polls.delete(fn); }, refs.tool, 'price', chartIdentityKey, refs.loadedId, chartLoadError), [ticker]);
      const bars = barsForIdentity(loaded, chartIdentityKey({ ticker, market: 'US', tf: 'D', basis: 'price' }));
      const valueOf = (r: any) => (bars.length ? r.series.map((x: any) => { const v = seriesValues(x.spec, bars as any); return v[v.length - 1] ?? null; }) : []);
      return h('div', null, h('h2', { id: 'title' }, ticker), h('div', { id: 'legend' }, h(IndicatorLegend, { rows: legendRows(layout), valueOf, onToggle: () => {}, decimals: 2 })), error ? h('p', { id: 'err' }, error) : null);
    }
    const legend = () => document.getElementById('legend')!.textContent!;
    await mount(h(Harness));
    assert.match(legend(), /100\.00/); assert.equal(document.getElementById('title')!.textContent, 'A');

    // delayed response: B's title, no A values while B loads
    holdNext = new Set(['B']);
    await act(async () => { setT('B'); await settle(); });
    assert.equal(document.getElementById('title')!.textContent, 'B');
    assert.doesNotMatch(legend(), /100\.00/, "A's EMA values never sit under B's title");
    await act(async () => { held.get('B')!(); await settle(); });
    assert.match(legend(), /200\.00/);

    // rapid switch: D (slow) → C (fast) → D's late answer is ignored
    holdNext = new Set(['D']);
    await act(async () => { setT('D'); await settle(); });
    assert.doesNotMatch(legend(), /\d+\.\d\d/, 'nothing while D loads');
    await act(async () => { setT('C'); await settle(); });
    assert.equal(document.getElementById('title')!.textContent, 'C'); assert.match(legend(), /300\.00/);
    await act(async () => { held.get('D')!(); await settle(); });
    assert.equal(document.getElementById('title')!.textContent, 'C'); assert.match(legend(), /300\.00/);
    assert.doesNotMatch(legend(), /400\.00|200\.00|100\.00/, "a late answer for D is never shown under C");

    // same-symbol refresh keeps its values while the new answer is pending
    holdNext = new Set(['C']);
    await act(async () => { for (const p of polls) p(); await settle(); });
    assert.match(legend(), /300\.00/, 'refresh of the same identity keeps its values');
    price.C = 310;
    await act(async () => { held.get('C')!(); await settle(); });
    assert.match(legend(), /310\.00/);

    // invalid ticker: truthful first-load error, no stale reading
    await act(async () => { setT('ZZZZ'); await settle(); });
    assert.doesNotMatch(legend(), /\d+\.\d\d/);
    assert.equal(document.getElementById('err')!.textContent, 'Could not load ZZZZ (HTTP 404). — nothing loaded for this symbol yet.');
    // a failed refresh of a loaded symbol says the chart still shows the last load (and keeps its values)
    await act(async () => { setT('C'); await settle(); });
    assert.match(legend(), /310\.00/);
    failNext.add('C');
    await act(async () => { for (const p of polls) p(); await settle(); });
    assert.match(document.getElementById('err')!.textContent!, /Could not load C .*refresh failed; the chart still shows the last successful load\./);
    assert.match(legend(), /310\.00/);
  });
  assert.equal(chartLoadError('Could not load C (HTTP 500).', 'refresh'), 'Could not load C (HTTP 500). — refresh failed; the chart still shows the last successful load.');
  assert.doesNotMatch(source, /any displayed data is the last successful load/, 'old one-size wording gone');
  assert.match(source, /data-testid="chart-empty-state"/); assert.match(source, />Retry</); assert.match(source, />Open another ticker</);
});

// ── CW-05 ─────────────────────────────────────────────────────────────────────
test('CW-05: Indicators panel — Escape closes and returns focus; outside click closes without toggling; layout untouched', async () => {
  await withDom(async ({ mount, settle }) => {
    localStorage.clear();
    const { IndicatorsPanel, useLayouts } = await import('../../components/charts/LayoutControls');
    let working = '';
    let underneath = 0, windowEsc = 0;
    window.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') windowEsc++; });
    function Host() {
      const L = useLayouts();
      const [open, setOpen] = React.useState(false);
      const trigger = React.useRef<HTMLButtonElement | null>(null);
      working = JSON.stringify(L.working) + String(L.dirty);
      return h('div', null,
        h('button', { ref: trigger, id: 'trigger', onClick: () => setOpen((v) => !v) }, 'Indicators ▾'),
        h('button', { id: 'under', onClick: () => { underneath++; } }, 'something underneath'),
        open ? h(IndicatorsPanel, { L, onClose: () => setOpen(false), triggerRef: trigger }) : null);
    }
    await mount(h(Host));
    const trigger = document.getElementById('trigger') as HTMLButtonElement;
    const before = working;
    await act(async () => { trigger.click(); await settle(); });
    const panel = () => document.querySelector('[role="dialog"]');
    assert.ok(panel()); assert.equal(panel()!.getAttribute('aria-labelledby'), 'mc-indicators-title');
    assert.ok(panel()!.querySelector('input[type="checkbox"]'), 'keyboard reaches the controls (real inputs)');
    const close = document.querySelector<HTMLElement>('[aria-label="Close indicators"]')!;
    await act(async () => close.focus());
    await key('Escape', close);
    await act(async () => { await settle(); });
    assert.equal(panel(), null, 'Escape closes the panel');
    assert.equal(document.activeElement, trigger, 'focus returns to the Indicators button');
    assert.equal(windowEsc, 0, 'the chart page does not also act on that Escape (cancel drawing / leave focus)');
    assert.equal(working, before, 'closing neither saves nor discards the working layout');

    // outside click: closes, and the click does not reach what is underneath
    await act(async () => { trigger.click(); await settle(); });
    assert.ok(panel());
    const under = document.getElementById('under')!;
    await act(async () => { under.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true })); under.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); under.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await settle(); });
    assert.equal(panel(), null); assert.equal(underneath, 0, 'nothing underneath toggled');
    await act(async () => { under.click(); await settle(); });
    assert.equal(underneath, 1, 'later clicks work normally');
    assert.equal(working, before);
    // the trigger still toggles
    await act(async () => { trigger.click(); await settle(); }); assert.ok(panel());
    await act(async () => { trigger.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); trigger.click(); await settle(); }); assert.equal(panel(), null);
    // Escape with the panel closed is left to the page (pattern list, drawing cancel)
    await key('Escape', document.body);
    assert.equal(windowEsc, 1);
  });
});

// ── improvement 2: list → chart hand-off ──────────────────────────────────────
test('Improvement 2: "Open this list in Charts" carries the list id and the filtered rows as the review queue', async () => {
  const items = watchlistReviewItems([
    { ticker: 'INFY', company: 'Infosys', market: 'IN' }, { ticker: 'NSE:TCS', company: 'TCS', market: 'IN' }, { ticker: 'NVDA', company: 'NVIDIA', market: 'US' },
    { ticker: 'INFY', company: 'Infosys', market: 'IN' }, { ticker: 'NEWCO', company: 'NEWCO' },
  ]);
  assert.deepEqual(items, [{ symbol: 'INFY', exchange: 'NSE', name: 'Infosys' }, { symbol: 'TCS', exchange: 'NSE', name: 'TCS' }, { symbol: 'NVDA', exchange: 'US', name: 'NVIDIA' }, { symbol: 'NEWCO', exchange: 'NSE' }]);
  assert.equal(chartReviewUrl(items[0]), '/charts?symbol=INFY&exchange=NSE&t=INFY&m=IN&tf=D&review=screener');
  assert.equal(chartReviewUrl(items[2]), '/charts?symbol=NVDA&exchange=US&t=NVDA&m=US&tf=D&review=screener');
  await withDom(async () => {
    const { writeReviewQueue } = await import('../screener/workflow');
    assert.ok(writeReviewQueue('My Watchlist · matching “inf”', items.slice(0, 1), '/watchlists', { source: 'watchlist', listId: STANDALONE_WATCHLIST_ID }));
    const q = parseQueue(sessionStorage.getItem(CHART_REVIEW_QUEUE_KEY))!;
    assert.equal(q.source, 'watchlist'); assert.equal(q.listId, 'mc_watchlist_tickers'); assert.equal(q.returnUrl, '/watchlists');
    assert.deepEqual(q.items.map((i) => i.symbol), ['INFY']);
    assert.ok(reviewFromUrl('screener', sessionStorage, 'INFY', 'NSE', 'IN'), 'the chart picks the queue up');
    assert.deepEqual(reviewWords(q), { noun: 'watchlist row', heading: 'Reviewing watchlist', back: 'Back to Watchlist' });
    // screener queues are unchanged
    writeReviewQueue('Screen', items.slice(0, 1));
    const s = parseQueue(sessionStorage.getItem(CHART_REVIEW_QUEUE_KEY))!;
    assert.equal(s.source, undefined); assert.equal(reviewWords(s).back, 'Back to screen');
  });
  const page = readFileSync(new URL('../../app/(dashboard)/watchlists/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /watchlistReviewItems\(visibleItems\)/, 'the filtered rows on screen, in table order');
  assert.match(page, /in Charts/);
});

// ── improvement 4 ────────────────────────────────────────────────────────────
test('Improvement 4: overlapping axis tags are stacked (order kept, inside the axis); chart period labelled "Chart"', () => {
  assert.deepEqual(stackAxisLabels([100, 105, 300], 20), [100, 120, 300]);
  assert.deepEqual(stackAxisLabels([105, 100], 20), [120, 100], 'order by price position is kept');
  assert.deepEqual(stackAxisLabels([390, 395], 20, 0, 400), [380, 400], 'pushed back up from the axis bottom');
  const out = stackAxisLabels([50, 50, 50, 50], 21, 10, 200);
  for (let i = 1; i < out.length; i++) assert.ok(out[i] - out[i - 1] >= 21);
  assert.deepEqual(stackAxisLabels([], 20), []);
  const ws = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(ws, /aria-label="Chart period"/);
  assert.match(ws, />Chart<\/span>/);
  const setup = readFileSync(new URL('../../components/charts/kline-setup.ts', import.meta.url), 'utf8');
  assert.match(setup, /stackAxisLabels\(/);
  const pat = readFileSync(new URL('../../components/charts/PatternIndicator.tsx', import.meta.url), 'utf8');
  assert.match(pat, />Analysis</, 'pattern banner keeps its own "Analysis" D / W / M');
});
