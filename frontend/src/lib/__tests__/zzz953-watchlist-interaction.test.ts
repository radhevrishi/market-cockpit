import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { importParsed, parseTradingView, sanitizeStore, itemKey, viewRows, flatRows, CHART_WATCHLISTS_KEY } from '../chart-watchlist';
import { SCREENS_KEY } from '../screener/filters';

test('watchlist search includes collapsed sections and preserves their state and exchange identity', () => {
  const store = importParsed(sanitizeStore(null), parseTradingView('###India,BSE:RELIANCE,NSE:RELIANCE,###USA,NASDAQ:AAPL'), { mode: 'new', name: 'Test' });
  const list = store.lists.find((l) => l.id === store.activeId)!;
  list.sections[0].collapsed = true;
  const quotes = { 'US:AAPL': { last: 200, chgPct: 1, name: 'Apple Inc.' } };
  assert.deepEqual(flatRows(list, null, quotes, null, { query: 'apple' }).map((r) => itemKey(r.item)), ['US:AAPL']);
  assert.deepEqual(flatRows(list, null, quotes, null, { query: 'bse', market: 'IN' }).map((r) => itemKey(r.item)), ['IN:BSE:RELIANCE']);
  assert.equal(list.sections[0].collapsed, true);
  assert.equal(viewRows(list, null, quotes, null)[0].rows.length, 0);
  assert.equal(flatRows(list, null, quotes, null, { query: 'apple', market: 'IN' }).length, 0);
});

test('watchlist UI search, market filter, keyboard, navigation, density and screener integration', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/charts', pretendToBeVisual: true });
  const names = ['window','document','navigator','localStorage','HTMLElement','Event','CustomEvent','KeyboardEvent','StorageEvent','self','React','IS_REACT_ACT_ENVIRONMENT','fetch'];
  const previous = new Map(names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window','document','navigator','localStorage','HTMLElement','Event','CustomEvent','KeyboardEvent','StorageEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const { createRoot } = await import('react-dom/client');
  const { default: Watchlist } = await import('../../components/charts/WatchlistPanel');
  const { default: Screener } = await import('../../components/stock-screener/StockScreener');
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 25));
  const mount = async (element: React.ReactNode) => { await act(async () => { root.render(element); await settle(); }); };
  const click = async (selector: string) => { const b = document.querySelector<HTMLElement>(selector); assert.ok(b, selector); await act(async () => { b.click(); await settle(); }); };
  try {
    const store = importParsed(sanitizeStore(null), parseTradingView('NASDAQ:AAPL,NASDAQ:MSFT,BSE:RELIANCE,NSE:RELIANCE'), { mode: 'new', name: 'Research' });
    let picked: unknown;
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ quotes: { 'US:AAPL': { last: 200, chgPct: 3, name: 'Apple Inc.' }, 'US:MSFT': { last: 300, chgPct: -2, name: 'Microsoft' } } }) })) as any;
    await mount(React.createElement(Watchlist, { store, update: () => {}, currentKey: 'US:AAPL', onPick: (m, t, x) => { picked = { m, t, x }; } }));
    assert.equal(document.querySelectorAll('[data-key]').length, 4);
    assert.match(document.body.textContent!, /Apple Inc\./);
    await click('[aria-label="Next watchlist symbol"]');
    assert.deepEqual(picked, { m: 'US', t: 'MSFT', x: 'NASDAQ' });
    await act(async () => document.querySelector('[data-key="IN:BSE:RELIANCE"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.deepEqual(picked, { m: 'IN', t: 'RELIANCE', x: 'BSE' });
    await click('[aria-label="Show USA"]');
    assert.equal(document.querySelectorAll('[data-key]').length, 2);
    assert.equal(document.querySelector('[data-key]')!.getAttribute('draggable'), 'false');
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search watchlist"]')!;
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setValue.call(input, 'apple'); input.dispatchEvent(new Event('input', { bubbles: true })); await settle(); });
    assert.equal(document.querySelectorAll('[data-key]').length, 1);
    assert.ok(document.querySelector('[data-key="US:AAPL"]'));
    await click('[aria-label="Show India"]');
    assert.match(document.body.textContent!, /No matching symbols/);
    const clear = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Clear filters')!;
    await act(async () => clear.click());
    assert.equal(document.querySelectorAll('[data-key]').length, 4);
    await click('[title="Toggle compact rows"]');
    assert.equal(localStorage.getItem('mc:watchlist-compact'), '1');
    assert.ok(document.querySelector('.mcwl-compact'));
    await mount(null);

    localStorage.setItem(CHART_WATCHLISTS_KEY, JSON.stringify(store));
    localStorage.setItem(SCREENS_KEY, JSON.stringify([{ id: 'audit', name: 'All fixtures', market: 'US', filters: [] }]));
    localStorage.setItem('mc:stock-screener:last:v1', 'audit');
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ ok: true, builtAt: '2026-10-07T12:00:00Z', rows: [{ t: 'AAPL', n: 'Apple', px: 200, mc: 1, exch: ['NASDAQ'] }, { t: 'NEWCO', n: 'New fixture', px: 10, mc: 2, exch: ['NYSE'] }], notes: [], sources: [] }) })) as any;
    await mount(React.createElement(Screener));
    const addMatches = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Add matches to watchlist')!;
    await act(async () => addMatches.click());
    const add = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Add symbols')!;
    await act(async () => { add.click(); await settle(); });
    const saved = JSON.parse(localStorage.getItem(CHART_WATCHLISTS_KEY)!);
    const items = saved.lists.find((l: any) => l.id === saved.activeId).sections.flatMap((s: any) => s.items);
    assert.equal(items.filter((it: any) => it.t === 'AAPL').length, 1);
    assert.ok(items.some((it: any) => it.t === 'NEWCO' && it.x === 'NYSE'));
    assert.match(document.body.textContent!, /1 symbols added to Research/);
    await mount(null);

    const { default: Divider } = await import('../../components/charts/WatchlistResizeHandle');
    const commits: number[] = [];
    function ResizeFixture() { const [width, setWidth] = React.useState(400); return React.createElement(Divider, { width, onChange: (next, persist) => { setWidth(next); if (persist) commits.push(next); } }); }
    await mount(React.createElement(ResizeFixture));
    const separator = document.querySelector('[aria-label="Watchlist width"]')!;
    const pointer = async (type: string, x: number) => { const e = new Event(type, { bubbles: true }); Object.assign(e, { clientX: x, pointerId: 1, button: 0 }); await act(async () => { separator.dispatchEvent(e); }); };
    await pointer('pointerdown', 100); await pointer('pointermove', 0);
    assert.equal(separator.getAttribute('aria-valuenow'), '500'); assert.equal(commits.length, 0);
    await pointer('pointerup', 0); assert.deepEqual(commits, [500]);
    await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    assert.equal(separator.getAttribute('aria-valuenow'), '520');
    await pointer('pointerdown', 100); await pointer('pointermove', -1000);
    assert.equal(separator.getAttribute('aria-valuenow'), '620');
    await pointer('pointercancel', -1000); assert.equal(separator.getAttribute('aria-valuenow'), '520');
    await act(async () => separator.dispatchEvent(new Event('dblclick', { bubbles: true })));
    assert.equal(separator.getAttribute('aria-valuenow'), '400');
    separator.parentElement!.getBoundingClientRect = () => ({ width: 600 } as DOMRect);
    await act(async () => window.dispatchEvent(new Event('resize')));
    assert.equal(separator.getAttribute('aria-valuemax'), '330');
    assert.equal(separator.getAttribute('aria-valuenow'), '330');
    await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    assert.equal(separator.getAttribute('aria-valuenow'), '310');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
  }
});
