import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Screener from '../../components/stock-screener/StockScreener';
import Watchlist, { useWatchlistStore } from '../../components/charts/WatchlistPanel';
import { CHART_WATCHLISTS_KEY, sanitizeStore, importParsed, parseTradingView, type WlStore } from '../chart-watchlist';
import { SCREENS_KEY } from '../screener/filters';

test('workspace UI: failed saves, restore, refresh, market errors and quote recovery', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/stock-screener', pretendToBeVisual: true });
  const globals = ['window', 'document', 'localStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const oldGlobals = new Map(globals.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const root = createRoot(document.getElementById('root')!);
  const originalTimeout = globalThis.setTimeout;
  const polls = new Map<number, () => void>();
  let timerId = 10000;
  globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    if ((ms || 0) >= 60_000) { const id = ++timerId; polls.set(id, () => fn(...args)); return id; }
    return originalTimeout(fn, ms, ...args);
  }) as any;
  const originalClear = globalThis.clearTimeout;
  globalThis.clearTimeout = ((id: any) => { polls.delete(id); originalClear(id); }) as any;
  const proto = Object.getPrototypeOf(localStorage), originalWrite = proto.setItem;
  const settle = () => new Promise<void>((r) => originalTimeout(r, 20));
  const mount = async (element: React.ReactNode) => { await act(async () => { root.render(element); await settle(); }); };
  const click = async (text: string) => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text);
    assert.ok(button, `button ${text}`);
    await act(async () => { button.click(); await settle(); });
  };
  try {
    let version = 1;
    let failIndia = false;
    globalThis.fetch = (async (url: string) => ({ ok: !(failIndia && url.includes('market=IN')), json: async () => failIndia && url.includes('market=IN') ? { ok: false, error: 'India fixture unavailable' } : { ok: true, builtAt: '2026-10-07T12:00:00Z', rows: [{ t: `TEST${version}`, n: 'Fixture', px: 10, mc: 100 }], notes: [], sources: [] } })) as any;
    localStorage.setItem(SCREENS_KEY, JSON.stringify([{ id: 'local-screen', name: 'Local', market: 'US', filters: [] }]));
    localStorage.setItem('mc:stock-screener:last:v1', 'local-screen');
    await mount(React.createElement(Screener));
    assert.match(document.body.textContent!, /1 of 1 companies match/);
    proto.setItem = () => { throw new Error('quota'); };
    await click('Save');
    assert.match(document.body.textContent!, /Not saved: storage is full or blocked/);
    assert.doesNotMatch(document.body.textContent!, /Saved "Local"/);
    proto.setItem = originalWrite;
    await click('Save •');
    assert.match(document.body.textContent!, /Saved "Local"/);
    localStorage.setItem(SCREENS_KEY, JSON.stringify([{ id: 'local-screen', name: 'Restored', market: 'US', filters: [] }, { id: 'remote-screen', name: 'Remote', market: 'US', filters: [] }]));
    await act(async () => window.dispatchEvent(new CustomEvent('mc:vault:restored', { detail: { keys: [SCREENS_KEY] } })));
    // zzz1006 — the screen picker is a searchable list (was a <select>)
    await act(async () => { (document.querySelector('button[aria-label="Screens"]') as HTMLElement).click(); await settle(); });
    assert.match(document.querySelector('[role="listbox"][aria-label="Screens"]')!.textContent!, /Remote/);
    assert.match(document.body.textContent!, /Restored/);
    version = 2;
    await click('Refresh');
    assert.equal(document.querySelector('a[title^="Open the chart"]')!.textContent, 'TEST2');
    version = 3;
    await act(async () => { [...polls.values()][0](); await settle(); });
    assert.equal(document.querySelector('a[title^="Open the chart"]')!.textContent, 'TEST3', 'populated snapshots refresh automatically');
    failIndia = true;
    await click('🇮🇳 India'); assert.match(document.body.textContent!, /India fixture unavailable/);
    await click('🇺🇸 USA'); assert.doesNotMatch(document.body.textContent!, /India fixture unavailable/);
    assert.match(document.body.textContent!, /1 of 1 companies match/);
    await mount(null);

    polls.clear();
    const store = importParsed(sanitizeStore(null), parseTradingView('NASDAQ:AAPL,BSE:RELIANCE,NSE:RELIANCE'), { mode: 'new', name: 'Both exchanges' });
    let response = 0, picked: unknown;
    globalThis.fetch = (async (url: string) => ({ ok: true, json: async () => ({ quotes: url.includes('chart-quotes') && ++response !== 2 ? { 'US:AAPL': { last: 200, chgPct: 3, at: 100 } } : {} }) })) as any;
    await mount(React.createElement(Watchlist, { store, update: () => {}, currentKey: 'US:AAPL', onPick: (m, t, x) => { picked = { m, t, x }; } }));
    await act(async () => (document.querySelector('[data-key="IN:BSE:RELIANCE"]') as HTMLElement).click());
    assert.deepEqual(picked, { m: 'IN', t: 'RELIANCE', x: 'BSE' });
    assert.match(document.body.textContent!, /\+3.00%/);
    assert.equal(response, 1);
    await act(async () => { [...polls.values()][0](); await settle(); });
    assert.equal(response, 2);
    assert.ok(document.querySelector('[aria-label="Stale quote for AAPL"]'));
    assert.match(document.body.textContent!, /last known quotes/);
    await act(async () => { [...polls.values()][0](); await settle(); });
    assert.equal(document.querySelector('[aria-label="Stale quote for AAPL"]'), null);
    await mount(null);

    let current: WlStore | null = null, update!: (fn: (s: WlStore) => WlStore) => void, error: string | null = null, retry!: () => void;
    function Hook() { [current, update, error, retry] = useWatchlistStore(); return React.createElement('span', null, error); }
    localStorage.clear(); await mount(React.createElement(Hook));
    const before = localStorage.getItem(CHART_WATCHLISTS_KEY);
    proto.setItem = () => { throw new Error('quota'); };
    await act(async () => update(() => store));
    assert.ok(error); assert.equal(localStorage.getItem(CHART_WATCHLISTS_KEY), before);
    assert.equal(current, store, 'working changes remain available for retry');
    proto.setItem = originalWrite;
    await act(async () => retry());
    assert.equal(error, null); assert.equal(localStorage.getItem(CHART_WATCHLISTS_KEY), JSON.stringify(store));
  } finally {
    proto.setItem = originalWrite;
    await act(async () => root.unmount());
    await new Promise<void>((r) => originalTimeout(r, 2600)); // drain the component's short-lived status/idle callbacks before removing window
    globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear;
    dom.window.close();
    for (const [k, descriptor] of oldGlobals) { if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete (globalThis as any)[k]; }
  }
});
