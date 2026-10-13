// zzz1013 — Charts + Watchlist premium pass: session badge, "?" shortcuts overlay, toolbar / rail markup, narrow-screen drawer,
// drag-to-reorder feedback, the Watchlists page table (aria-sort, keyboard sort keeps focus) and the scoped design tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { sessionState, CHART_SHORTCUTS } from '../../components/charts/chart-chrome';
import { CHART_CSS } from '../../components/charts/chart-workspace-css';
import { PANEL_CSS } from '../../components/charts/watchlist-panel-css';
import { WLP_CSS } from '../../app/(dashboard)/watchlists/watchlists-css';
import { importParsed, parseTradingView, sanitizeStore, type WlStore } from '../chart-watchlist';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const h = React.createElement;

async function withDom(fn: (x: { mount: (el: React.ReactNode) => Promise<void>; settle: () => Promise<void> }) => Promise<void>) {
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
  try { await fn({ mount, settle }); }
  finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, d] of previous) { if (d) Object.defineProperty(globalThis, key, d); else delete (globalThis as any)[key]; }
  }
}

test('session badge: NSE open / pre-open / closed and US pre-market / open / after hours / closed', () => {
  // Wed 14 Oct 2026 — not an NSE holiday
  assert.equal(sessionState('IN', new Date('2026-10-14T04:30:00Z')).id, 'open');       // 10:00 IST
  assert.equal(sessionState('IN', new Date('2026-10-14T03:35:00Z')).id, 'pre');        // 09:05 IST
  assert.equal(sessionState('IN', new Date('2026-10-14T10:30:00Z')).id, 'closed');     // 16:00 IST
  assert.equal(sessionState('IN', new Date('2026-10-17T04:30:00Z')).id, 'closed');     // Saturday
  assert.equal(sessionState('US', new Date('2026-10-14T12:00:00Z')).id, 'pre');        // 08:00 ET (EDT)
  assert.equal(sessionState('US', new Date('2026-10-14T15:00:00Z')).id, 'open');       // 11:00 ET
  assert.equal(sessionState('US', new Date('2026-10-14T21:00:00Z')).id, 'post');       // 17:00 ET
  assert.equal(sessionState('US', new Date('2026-10-18T15:00:00Z')).id, 'closed');     // Sunday
  for (const s of [sessionState('IN'), sessionState('US')]) assert.ok(s.label && s.hint, 'label and hint always given');
});

test('"?" overlay lists only shortcuts the page answers, opens and closes from the keyboard', async () => {
  const ws = read('components/charts/ChartWorkspace.tsx');
  const panel = read('components/charts/WatchlistPanel.tsx');
  const keys = CHART_SHORTCUTS.flatMap((g) => g.items.flatMap((i) => i.keys));
  for (const k of ['↓', '↑', 'Home', 'End', 'Enter', '/', 'Alt', 'Shift', 'Esc', 'Delete', '?']) assert.ok(keys.includes(k), k);
  // every listed shortcut has a handler
  assert.match(ws, /e\.key === '\?'/); assert.match(ws, /e\.key === '\/'/);
  assert.match(ws, /e\.altKey && \(e\.code === 'KeyR'/); assert.match(ws, /e\.shiftKey && !e\.ctrlKey && !e\.metaKey && !e\.altKey && \(e\.key === 'F'/);
  assert.match(ws, /e\.key === 'Delete' \|\| e\.key === 'Backspace'/);
  assert.match(panel, /e\.key === 'Home'/); assert.match(panel, /e\.key === 'End'/); assert.match(panel, /e\.key === 'Enter' \|\| e\.key === ' '/);
  // typing in a box never opens it (the handler returns for INPUT / TEXTAREA / SELECT first)
  const onKey = ws.slice(ws.indexOf('const onKey = (e: KeyboardEvent) => {\n      const tag'), ws.indexOf("if (e.key === '?'"));
  assert.match(onKey, /tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT'\) return/);

  await withDom(async ({ mount, settle }) => {
    const { ShortcutsOverlay } = await import('../../components/charts/chart-chrome');
    let open = true;
    const close = () => { open = false; };
    await mount(h(ShortcutsOverlay, { onClose: close }));
    const dlg = document.querySelector('[role="dialog"][aria-modal="true"]')!;
    assert.ok(dlg); assert.equal(dlg.getAttribute('aria-labelledby'), 'ct-help-title');
    assert.equal(document.getElementById('ct-help-title')!.textContent, 'Keyboard shortcuts');
    assert.equal((document.activeElement as HTMLElement).getAttribute('aria-label'), 'Close shortcuts', 'focus moves into the dialog');
    assert.equal(dlg.querySelectorAll('kbd').length, CHART_SHORTCUTS.reduce((n, g) => n + g.items.reduce((m, i) => m + i.keys.length, 0), 0));
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(); });
    assert.equal(open, false, 'Esc closes');
    open = true;
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })); await settle(); });
    assert.equal(open, false, '? closes it again');
  });
});

test('toolbar, rail and canvas markup: labelled icon buttons, pressed states, the narrow-screen drawer, saved keys kept', () => {
  const ws = read('components/charts/ChartWorkspace.tsx');
  // one grouped toolbar
  assert.match(ws, /className="ct-bar"/); assert.match(ws, /className="ct-search" role="search"/);
  assert.match(ws, /role="group" aria-label="Chart period" className="ct-seg"/); assert.match(ws, /role="group" aria-label="Visible range" className="ct-seg"/);
  assert.match(ws, /aria-pressed=\{range === r\}/, 'the active range is announced');
  assert.match(ws, /aria-label="Keyboard shortcuts" aria-haspopup="dialog"/);
  // drawing rail: every tool is an icon button with a name and a pressed state, grouped by kind
  assert.match(ws, /className="ct-rail" role="group" aria-label="Drawing tools"/);
  assert.match(ws, /aria-label=\{t\.label\} aria-pressed=\{tool === t\.id\}/);
  for (const label of ['Cursor', 'Horizontal line', 'Trend line', 'Ray', 'Channel', 'Rectangle', 'Fibonacci', 'Text', 'Measure', 'Delete one', 'Clear all', 'Reset chart', 'Drawing colour']) assert.ok(ws.includes(`'${label}'`) || ws.includes(`"${label}"`), label);
  assert.match(ws, /data-kbd="Alt\+R"/); assert.match(ws, /data-kbd="Shift\+F"/);
  // instrument strip: price prominent, labelled figures, session state
  assert.match(ws, /className="ct-last"/); assert.match(ws, /<SessionBadge market=\{market\} \/>/); assert.match(ws, /<dl className="ct-stats" aria-label="Trading figures">/);
  for (const l of ['ADR%', 'RVol', 'PVol', 'Float %', 'Avg $ Vol', 'Avg ₹ Vol']) assert.ok(ws.includes(l), l);
  // narrow screens: watchlist drawer, inert while closed, closes after a pick, Esc closes it
  assert.match(ws, /useMedia\('\(max-width: 900px\)'\)/);
  assert.match(ws, /inert: !drawer/); assert.match(ws, /onPick=\{narrow \? pickAndClose : pickFromList\}/);
  assert.match(ws, /if \(e\.key === 'Escape' && drawerRef\.current\) \{ setDrawer\(false\); return; \}/);
  // display preferences keep their keys (nothing saved is renamed)
  for (const k of ["'mc:chart-panel-open'", "'mc:chart-focus:v1'", "'mc:watchlist-width'", "'mc:chart-basis:v1'"]) assert.ok(ws.includes(k), k);
  // canvas: crosshair labels in ink on paper, owner's TradingView settings untouched
  assert.match(ws, /const crossText = \{ show: true, color: paper, backgroundColor: ink/);
  assert.match(ws, /grid: \{ show: false \}/); assert.match(ws, /const up = '#089981', down = '#F23645'/);
  assert.match(ws, /color: visibleOnTheme\(x\.color\)/, 'saved line colours are still the ones drawn');
});

test('design tokens: white and dark sets scoped to the chart page and the Watchlists page; focus, reduced motion, drawer', () => {
  assert.match(CHART_CSS, /\.mc-charts-root\.mc-chart-light, \.mc-charts-root:not\(\.mc-workspace-dark\) \{/);
  assert.match(CHART_CSS, /\.mc-charts-root\.mc-workspace-dark \{/);
  assert.match(CHART_CSS, /:focus-visible \{ outline: 2px solid var\(--mc-accent\)/);
  assert.match(CHART_CSS, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(CHART_CSS, /@media \(max-width: 900px\) \{[\s\S]*\.mc-charts-panel \{ position: fixed;[\s\S]*\.mc-charts-panel\.open \{ transform: none; \}/);
  assert.match(CHART_CSS, /\[data-tip\]::after \{ content: attr\(data-tip\)/);
  assert.match(WLP_CSS, /\.wlp\.mc-workspace-dark \{/); assert.match(WLP_CSS, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(WLP_CSS, /\.wlp-tab\[aria-selected="true"\]::after/);
  assert.match(PANEL_CSS, /\.mcwl-row\.dragging \{ opacity: \.45; \}/); assert.match(PANEL_CSS, /\.mcwl-row\.drop-before::before/);
  assert.match(PANEL_CSS, /@media \(prefers-reduced-motion: reduce\)/);
  // the zzz1006 selection / focus contract is unchanged
  assert.match(PANEL_CSS, /\.mcwl-row\.active \{ background: var\(--wl-sel\); box-shadow: inset 3px 0 0 var\(--mc-accent\); \}/);
});

test('watchlist panel: drag shows where the row lands and the drop still reorders; empty list offers the two ways to fill it', async () => {
  await withDom(async ({ mount, settle }) => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ quotes: {} }) })) as any;
    const { _resetSharedFetch } = await import('../tab-shared-fetch');
    _resetSharedFetch();
    const { default: Watchlist } = await import('../../components/charts/WatchlistPanel');
    let store: WlStore = importParsed(sanitizeStore(null), parseTradingView('###Semis,NASDAQ:NVDA,NASDAQ:AMD,NASDAQ:KLIC'), { mode: 'new', name: 'Drag' });
    const update = (fn: (s: WlStore) => WlStore) => { store = fn(store); };
    const render = () => mount(h(Watchlist, { store, update, currentKey: 'US:NVDA', onPick: () => {} }));
    await render();
    const row = (k: string) => document.querySelector(`[data-key="${k}"]`)!;
    const fire = (el: Element, type: string) => act(async () => { el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true })); await settle(); });
    await fire(row('US:NVDA'), 'dragstart');
    assert.match(row('US:NVDA').className, /\bdragging\b/);
    await fire(row('US:KLIC'), 'dragover');
    assert.match(row('US:KLIC').className, /\bdrop-after\b/, 'dropping onto a row below lands after it');
    await fire(row('US:KLIC'), 'drop');
    await render();
    const order = () => Array.from(document.querySelectorAll('[data-key]')).map((e) => e.getAttribute('data-key'));
    assert.deepEqual(order(), ['US:AMD', 'US:KLIC', 'US:NVDA']);
    for (const e of Array.from(document.querySelectorAll('[data-key]'))) assert.doesNotMatch(e.className, /dragging|drop-after|drop-before/, 'feedback cleared after the drop');

    store = importParsed(sanitizeStore(null), parseTradingView(''), { mode: 'new', name: 'Empty' });
    await render();
    const empty = document.querySelector('[data-testid="watchlist-empty"]')!;
    assert.ok(empty); assert.match(empty.textContent!, /Empty has no symbols yet/);
    assert.deepEqual(Array.from(empty.querySelectorAll('button')).map((b) => b.textContent), ['Add a symbol', 'Import a TradingView list']);
    await act(async () => { (empty.querySelector('button') as HTMLButtonElement).click(); await settle(); });
    assert.ok(document.querySelector('input[aria-label="Symbol to add"]'), '"Add a symbol" opens the add box');
  });
});

test('Watchlists page: real tab list, aria-sort headers sort from the keyboard and keep focus, figures strip', async () => {
  const page = read('app/(dashboard)/watchlists/page.tsx');
  assert.match(page, /className="wlp-tabs" role="tablist"/); assert.match(page, /role="tab" aria-selected=\{activeTab === t\.id\}/);
  assert.doesNotMatch(page, /#2A3B4C|#1A2B3C/, 'the dark-only hover colours on Refresh are gone (they showed on the white view)');
  await withDom(async ({ mount, settle }) => {
    const { WatchlistTable, SummaryBar } = await import('../../app/(dashboard)/watchlists/components');
    const items: any[] = [
      { ticker: 'HAL', company: 'Hindustan Aeronautics', sector: 'Defence', price: 4721, change: 58, changePercent: 1.24, dayHigh: 4740, dayLow: 4650, market: 'IN' },
      { ticker: 'TCS', company: 'Tata Consultancy', sector: 'IT', price: 3101, change: -12, changePercent: -0.39, dayHigh: 3120, dayLow: 3088, market: 'IN' },
    ];
    let sort: { f: string; o: 'asc' | 'desc' } = { f: 'ticker', o: 'asc' };
    const calls: string[] = [];
    const render = () => mount(h('div', null, h(SummaryBar, { items }), h(WatchlistTable, { items, sortField: sort.f as any, sortOrder: sort.o, onSort: (f: any) => { calls.push(f); sort = { f, o: sort.f === f && sort.o === 'asc' ? 'desc' : 'asc' }; void render(); }, onRemove: () => {} })));
    await render();
    const th = (label: string) => Array.from(document.querySelectorAll('th')).find((t) => t.textContent!.startsWith(label))!;
    assert.equal(th('Ticker').getAttribute('aria-sort'), 'ascending'); assert.equal(th('Change%').getAttribute('aria-sort'), 'none');
    th('Change%').focus();
    await act(async () => { th('Change%').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await settle(); });
    await act(async () => { await settle(); });
    assert.deepEqual(calls, ['changePercent']);
    assert.equal(th('Change%').getAttribute('aria-sort'), 'ascending');
    assert.equal(document.activeElement, th('Change%'), 'the header keeps keyboard focus after the sort re-renders');
    const figs = document.querySelector('dl.wlp-figs')!;
    assert.deepEqual(Array.from(figs.querySelectorAll('dt')).map((d) => d.textContent), ['Stocks', 'Average change', 'Gainers', 'Losers']);
    assert.ok(document.querySelector('button[aria-label="Remove HAL from the watchlist"]'));
  });
});

test('theme toggle: icon form for the chart toolbar keeps the label, the text form is unchanged elsewhere', async () => {
  await withDom(async ({ mount }) => {
    const { default: Toggle } = await import('../../components/WorkspaceThemeToggle');
    await mount(h('div', null, h(Toggle, { light: true, onToggle: () => {}, className: 'ct-icon', icon: h('svg') }), h(Toggle, { light: false, onToggle: () => {} })));
    const [icon, text] = Array.from(document.querySelectorAll('button'));
    assert.equal(icon.getAttribute('aria-label'), 'Switch to dark view'); assert.equal(icon.textContent, ''); assert.equal(icon.getAttribute('data-tip'), 'Dark view');
    assert.equal(text.textContent, '☀ White'); assert.equal(text.getAttribute('aria-pressed'), 'false');
  });
});
