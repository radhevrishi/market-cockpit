// zzz1006 — Stock Screener + chart-side Watchlist presentation redesign. What must NOT change: screening results, their order,
// copied tickers and CSV exports (golden file recorded from the page BEFORE the redesign), saved screens / lists / preferences,
// exchange identity and keyboard review. What changed: the presentation (picker, chips, Add filter panel, status line, column views,
// Actions menu, selection toolbar, review badge, company panel; watchlist rows, labels, menus, drawer; the update chip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runScreens, type Driver } from './fixtures/zzz1006-harness';
import { fixtureRows, FIXED_NOW } from './fixtures/zzz1006-screener-rows';
import { BUILT_IN_SCREENS, SCREENS_KEY, filterCounts, filterKeys, runScreen, type NumKey } from '../screener/filters';
import { tvSectorOf } from '../screener/tv-sectors';
import { COLUMN_VIEWS, screenColumns, viewColumns, cleanColumnView } from '../screener/column-views';
import { pickerGroups, matchesScreen, toggleFav } from '../screener/screen-picker';
import { displaySectionName, usExtendedSession, quoteFreshness, agoLabel, exchangeLabel, currencyOf } from '../watchlist-display';
import { importParsed, parseTradingView, sanitizeStore, itemKey, CHART_WATCHLISTS_KEY, type WlStore } from '../chart-watchlist';

const GOLDEN = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zzz1006-screener-golden.json'), 'utf8'));
const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/** After the redesign Copy tickers / Download CSV live in the results toolbar's Actions menu. */
const NEW_DRIVER: Driver = {
  copy: async (h) => { await h.click((b) => (b.textContent || '').startsWith('Actions')); await h.click((b) => b.textContent === 'Copy tickers'); },
  csv: async (h) => { await h.click((b) => (b.textContent || '').startsWith('Actions')); await h.click((b) => b.textContent === 'Download CSV'); },
};

// ── 1 · identical results and exports ──────────────────────────────────────────────────────────────────────────────────
test('zzz1006 every built-in + saved screen: same match line, order, copied tickers and CSV as before the redesign', async () => {
  const now = await runScreens(NEW_DRIVER);
  assert.deepEqual(Object.keys(now).sort(), Object.keys(GOLDEN).sort(), 'the same screens');
  for (const id of Object.keys(GOLDEN)) assert.deepEqual(now[id], GOLDEN[id], `screen ${id}`);
  assert.ok(Object.values(now).filter((x) => x.order.length).length >= 25, 'most screens have matches in the fixture (a meaningful comparison)');
});

test('zzz1006 a column view preset changes visible columns only: results, copy and CSV stay identical', async () => {
  const ids = ['all-us', 'paused-us', ...BUILT_IN_SCREENS.filter((s) => GOLDEN[s.id]?.order.length).slice(0, 4).map((s) => s.id)];
  for (const view of ['valuation', 'technicals'] as const) {
    const now = await runScreens(NEW_DRIVER, ids, { 'mc:screener-colview:v1': view, 'mc:screener-density:v1': 'compact' });
    for (const id of ids) assert.deepEqual(now[id], GOLDEN[id], `${view} view, screen ${id}`);
  }
});

test('zzz1006 screening logic is untouched: counts per built-in screen on the fixture equal the golden match lines', () => {
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(...a: any[]) { if (a.length) super(...(a as [])); else super(FIXED_NOW); } static now() { return FIXED_NOW; } }
  (globalThis as any).Date = FixedDate;
  try {
    // the page re-works TradingView sectors before screening (zzz974 N-01) — the same here
    const mapped = (m: 'US' | 'IN') => fixtureRows(m).map((r) => { const tv = tvSectorOf(m, r.sec, r.ind, r.t); return tv && tv !== r.tvSec ? { ...r, tvSec: tv } : r; });
    const rows = { US: mapped('US'), IN: mapped('IN') };
    for (const s of BUILT_IN_SCREENS) {
      const res = runScreen(rows[s.market], s.filters, new Date(), false);
      assert.equal(`${res.length} of ${rows[s.market].length} companies match`, GOLDEN[s.id].match, s.id);
      const c = filterCounts(rows[s.market], s.filters, new Date(), false);
      assert.equal(c.length, s.filters.length);
    }
  } finally { (globalThis as any).Date = RealDate; }
});

test('zzz1006 column views: "screen" = the old column set (CSV columns); presets add only fields the market has', () => {
  for (const s of BUILT_IN_SCREENS) {
    const old: NumKey[] = ['px', 'chg', 'mc'];
    for (const f of s.filters) for (const k of filterKeys(f)) if (!old.includes(k)) old.push(k);
    assert.deepEqual(screenColumns(s.filters), old, s.id);
    assert.deepEqual(viewColumns('screen', s.filters, s.market), old);
  }
  for (const v of COLUMN_VIEWS) {
    const cols = viewColumns(v.id, [], 'IN');
    assert.deepEqual(cols.slice(0, 3), ['px', 'chg', 'mc'], `${v.id} starts with price, change, market cap`);
    assert.equal(new Set(cols).size, cols.length, 'no duplicate column');
  }
  assert.deepEqual(viewColumns('valuation', [], 'US'), ['px', 'chg', 'mc', 'pe', 'ps', 'evRev', 'pcf']);
  assert.equal(cleanColumnView('bogus'), 'screen');
  // the page still exports `cols` (screen columns), never the visible preset
  const page = read('components/stock-screener/StockScreener.tsx');
  assert.match(page, /\.\.\.cols\.map\(\(k\) => \{ const l = fieldOf\(k\)\?\.label/);
  assert.match(page, /visibleCols\.map\(\(k\) => <Th /);
});

// ── 2 · screen picker ──────────────────────────────────────────────────────────────────────────────────────────────────
test('zzz1006 screen picker: groups (favourites, mine, built-in USA / India), market words in search, favourites are display-only', () => {
  const built = new Set(BUILT_IN_SCREENS.map((s) => s.id));
  const mine = { id: 'my-1', name: 'My growth', market: 'IN' as const, filters: [] };
  const all = [...BUILT_IN_SCREENS, mine];
  const g = pickerGroups(all, built, []);
  assert.deepEqual(g.map((x) => x.id), ['mine', 'us', 'in']);
  assert.equal(g.find((x) => x.id === 'us')!.screens.length + g.find((x) => x.id === 'in')!.screens.length, BUILT_IN_SCREENS.length, 'every built-in screen offered');
  const fav = BUILT_IN_SCREENS[0].id;
  const g2 = pickerGroups(all, built, [fav]);
  assert.equal(g2[0].id, 'fav'); assert.deepEqual(g2[0].screens.map((s) => s.id), [fav]);
  assert.ok(!g2.find((x) => x.id === 'us')!.screens.some((s) => s.id === fav), 'listed once');
  const india = pickerGroups(all, built, [], 'india').flatMap((x) => x.screens);
  assert.ok(all.filter((s) => s.market === 'IN').every((s) => india.includes(s)), '"india" finds every India screen');
  assert.ok(india.every((s) => s.market === 'IN' || /india/i.test(s.name)), '…and USA screens only when their name says India');
  assert.ok(matchesScreen(mine, 'my GROWTH')); assert.ok(!matchesScreen(mine, 'growth usa'));
  assert.deepEqual(toggleFav(toggleFav([], 'a'), 'a'), []);
});

// ── 3 · watchlist display helpers ────────────────────────────────────────────────────────────────────────────────────────
test('zzz1006 readable section labels are display only', () => {
  assert.equal(displaySectionName('AI_CHIPS_&_SEMICONDUCTORS'), 'AI Chips & Semiconductors');
  assert.equal(displaySectionName('US_LARGE_CAPS'), 'US Large Caps');
  assert.equal(displaySectionName('DEFENCE AND PSUS'), 'Defence and PSUs');
  assert.equal(displaySectionName('EV_SUPPLY_CHAIN'), 'EV Supply Chain');
  assert.equal(displaySectionName('Semis'), 'Semis', 'a typed name is kept');
  assert.equal(displaySectionName('my_Watch list'), 'my Watch list');
  assert.equal(displaySectionName(''), '');
  // the stored list keeps the raw name
  const store = importParsed(sanitizeStore(null), parseTradingView('###AI_CHIPS_&_SEMICONDUCTORS,NASDAQ:NVDA'), { mode: 'new', name: 'T' });
  assert.equal(store.lists.find((l) => l.id === store.activeId)!.sections[0].name, 'AI_CHIPS_&_SEMICONDUCTORS');
});

test('zzz1006 exchange identity, extended session, panel freshness', () => {
  assert.equal(exchangeLabel({ m: 'IN', x: 'BSE' }), 'BSE'); assert.equal(exchangeLabel({ m: 'IN' }), 'NSE'); assert.equal(exchangeLabel({ m: 'US', x: 'NASDAQ' }), 'US');
  assert.equal(currencyOf({ m: 'IN' }), 'INR'); assert.equal(currencyOf({ m: 'US' }), 'USD');
  assert.equal(usExtendedSession(new Date('2026-10-13T12:00:00Z')), 'pre');    // 08:00 ET Tuesday
  assert.equal(usExtendedSession(new Date('2026-10-13T15:00:00Z')), null);     // 11:00 ET
  assert.equal(usExtendedSession(new Date('2026-10-13T21:30:00Z')), 'post');   // 17:30 ET
  assert.equal(usExtendedSession(new Date('2026-10-17T12:00:00Z')), null);     // Saturday
  const f = quoteFreshness(['A', 'B', 'C'], { A: { last: 1, chgPct: 1, at: 100 }, B: { last: 2, chgPct: 0, at: 200, stale: true } });
  assert.deepEqual(f, { newest: 200, stale: 1, missing: 1, total: 3 });
  assert.equal(agoLabel(1_000, 1_000 + 30_000), 'just now'); assert.equal(agoLabel(0, 5 * 60_000), '5 min ago');
});

// ── 4 · the watchlist panel ──────────────────────────────────────────────────────────────────────────────────────────────
async function withDom<T>(url: string, fn: (h: { React: any; act: any; root: any; settle: () => Promise<void>; text: () => string; clip: string[]; blobs: string[]; dom: any }) => Promise<T>) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url, pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'MouseEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'Blob', 'MutationObserver', 'requestAnimationFrame', 'CSS'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'requestAnimationFrame']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'CSS', { value: { escape: (s: string) => s }, configurable: true, writable: true });
  const clip: string[] = [], blobs: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (t: string) => { clip.push(t); } }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'Blob', { value: class { constructor(parts: string[]) { blobs.push(parts.join('')); } }, configurable: true, writable: true });
  const oldCreate = (URL as any).createObjectURL, oldRevoke = (URL as any).revokeObjectURL;
  (URL as any).createObjectURL = () => 'blob:x'; (URL as any).revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 25));
  try { return await fn({ React, act, root, settle, text: () => document.body.textContent || '', clip, blobs, dom }); } finally {
    await act(async () => { root.unmount(); });
    await new Promise<void>((r) => setTimeout(r, 3100));
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    (URL as any).createObjectURL = oldCreate; (URL as any).revokeObjectURL = oldRevoke;
    dom.window.close();
  }
}
const btn = (pred: (b: HTMLElement) => boolean) => Array.from(document.querySelectorAll<HTMLElement>('button, a')).find(pred) || null;

test('zzz1006 watchlist: compact rows, selection vs focus, readable sections, flag filter popover, optional Ext column, row menu, Manage drawer', async () => {
  await withDom('http://localhost/charts', async ({ React, act, settle, root, text }) => {
    const { _resetSharedFetch } = await import('../tab-shared-fetch');
    _resetSharedFetch();
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ quotes: {
      'US:NVDA': { last: 180.5, chgPct: 1.25, name: 'NVIDIA Corporation', ext: 0.4, at: Date.now() - 120_000 },
      'IN:BSE:RELIANCE': { last: 1402, chgPct: -0.5, name: 'Reliance Industries', at: Date.now() - 60_000 },
      'IN:RELIANCE': { last: 1401.2, chgPct: -0.4, name: 'Reliance Industries', at: Date.now() - 60_000 },
    } }) });
    const { default: Watchlist } = await import('../../components/charts/WatchlistPanel');
    let store: WlStore = importParsed(sanitizeStore(null), parseTradingView('###AI_CHIPS_&_SEMICONDUCTORS,NASDAQ:NVDA,NASDAQ:KLIC,###INDIA_CORE,BSE:RELIANCE,NSE:RELIANCE'), { mode: 'new', name: 'Desk' });
    const picks: string[] = [];
    let setOuter!: (s: WlStore) => void;
    function Wrap() {
      const [s, setS] = React.useState(store); setOuter = setS; store = s;
      const [cur, setCur] = React.useState('US:NVDA');
      return React.createElement(Watchlist, { store: s, update: (fn: (x: WlStore) => WlStore) => setS((x: WlStore) => { const n = fn(x); store = n; return n; }), currentKey: cur, onPick: (m: any, t: string, x?: string) => { picks.push(`${m}:${x || ''}:${t}`); setCur(itemKey({ m, t, x })); } });
    }
    await act(async () => { root.render(React.createElement(Wrap)); await settle(); });
    void setOuter;
    // readable section labels with counts; saved names untouched
    const secs = Array.from(document.querySelectorAll('.mcwl-sec')).map((e) => e.textContent!.trim());
    assert.deepEqual(secs, ['▾AI Chips & Semiconductors · 2', '▾India Core · 2']);
    assert.equal(store.lists.find((l) => l.id === store.activeId)!.sections[0].name, 'AI_CHIPS_&_SEMICONDUCTORS');
    // selected row: class + aria-selected; exchange badges keep NSE vs BSE apart
    const row = (k: string) => document.querySelector<HTMLElement>(`[data-key="${k}"]`)!;
    assert.ok(row('US:NVDA').classList.contains('active')); assert.equal(row('US:NVDA').getAttribute('aria-selected'), 'true');
    assert.equal(row('IN:BSE:RELIANCE').querySelector('.mcwl-exb')!.textContent, 'BSE');
    assert.equal(row('IN:RELIANCE').querySelector('.mcwl-exb')!.textContent, 'NSE');
    assert.match(row('IN:RELIANCE').getAttribute('title')!, /prices in INR/);
    // CSS: selection = fill + left bar; focus = a ring (distinct); compact ≈ 31px rows
    const css = read('components/charts/watchlist-panel-css.ts');
    assert.match(css, /\.mcwl-row\.active \{ background: var\(--wl-sel\); box-shadow: inset 3px 0 0 var\(--mc-accent\); \}/);
    assert.match(css, /\.mcwl-row:focus-visible \{ outline: 2px solid/);
    assert.match(css, /\.mcwl-compact \.mcwl-row \{ min-height: 31px; \}/);
    // Extended hours: hidden by default, optional, remembered
    assert.equal(document.querySelector('.mcwl-ext'), null); assert.doesNotMatch(text(), /\+0\.40%/);
    await act(async () => { (document.querySelector('[aria-label="List menu"]') as HTMLElement).click(); await settle(); });
    await act(async () => { btn((b) => /Extended-hours column/.test(b.textContent || ''))!.click(); await settle(); });
    assert.ok(document.querySelector('.mcwl-ext')); assert.match(text(), /\+0\.40%/); assert.equal(localStorage.getItem('mc:watchlist-ext-col:v1'), '1');
    // panel-level quote freshness
    assert.match(document.querySelector('.mcwl-status')!.textContent!, /Quotes (1|2) min ago/);
    // flag filter lives in a popover
    assert.equal(document.querySelector('[aria-label="Show only red flags"]'), null, 'flags are not a permanent row any more');
    await act(async () => { (document.querySelector('[aria-label="Filter by flag"]') as HTMLElement).click(); await settle(); });
    assert.ok(document.querySelector('[aria-label="Show only red flags"]'));
    await act(async () => { (document.querySelector('[aria-label="Show only red flags"]') as HTMLElement).click(); await settle(); });
    assert.match(text(), /No matching symbols/);
    await act(async () => { btn((b) => b.textContent === 'Clear filters')!.click(); await settle(); });
    // quiet row menu: flag, move, remove — and arrow keys inside it never step the chart
    await act(async () => { (document.querySelector('[aria-label="Actions for KLIC"]') as HTMLElement).click(); await settle(); });
    const menu = document.querySelector('[role="menu"][aria-label="Actions for KLIC"]')!;
    assert.ok(menu);
    const n = picks.length;
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await settle(); });
    assert.equal(picks.length, n, 'arrow keys in the row menu do not change the chart');
    await act(async () => { (menu.querySelector('[aria-label="Flag green"]') as HTMLElement).click(); await settle(); });
    assert.equal(store.lists.find((l) => l.id === store.activeId)!.sections[0].items.find((i) => i.t === 'KLIC')!.flag, 'green');
    await act(async () => { (document.querySelector('[aria-label="Actions for KLIC"]') as HTMLElement).click(); await settle(); });
    await act(async () => { btn((b) => b.textContent === 'India Core' && b.getAttribute('role') === 'menuitem')!.click(); await settle(); });
    assert.deepEqual(store.lists.find((l) => l.id === store.activeId)!.sections[1].items.map((i) => i.t), ['RELIANCE', 'RELIANCE', 'KLIC'], 'moved, exchange identity kept');
    await act(async () => { (document.querySelector('[aria-label="Actions for KLIC"]') as HTMLElement).click(); await settle(); });
    await act(async () => { (document.querySelector('[aria-label="Remove KLIC"]') as HTMLElement).click(); await settle(); });
    assert.equal(document.querySelector('[data-key="US:KLIC"]'), null);
    // keyboard review still works: ↓ from the focused selected row, Enter opens it
    await act(async () => row('US:NVDA').focus());
    await act(async () => { row('US:NVDA').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await settle(); });
    assert.equal(picks.at(-1), 'IN:BSE:RELIANCE'); assert.equal(document.activeElement, row('IN:BSE:RELIANCE'));
    // Manage list drawer: rename + section rename through the stored list; the drawer is a dialog (arrows not hijacked)
    await act(async () => { (document.querySelector('[aria-label="List menu"]') as HTMLElement).click(); await settle(); });
    await act(async () => { btn((b) => b.textContent === 'Manage list…')!.click(); await settle(); });
    const drawer = document.querySelector('[role="dialog"][aria-label="Manage list"]')!;
    assert.ok(drawer);
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    const nameInput = drawer.querySelector<HTMLInputElement>('#mcwl-list-name')!;
    await act(async () => { setValue.call(nameInput, 'Morning desk'); nameInput.dispatchEvent(new Event('input', { bubbles: true })); nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(); });
    assert.equal(store.lists.find((l) => l.id === store.activeId)!.name, 'Morning desk');
    assert.ok(drawer.textContent!.includes('Export as .txt') && drawer.textContent!.includes('Import (TradingView list)…'));
    await act(async () => { btn((b) => b.textContent === 'Done')!.click(); await settle(); });
    assert.equal(document.querySelector('[aria-label="Manage list"]'), null);
    // the density preference key is unchanged
    await act(async () => { (document.querySelector('[title="Toggle compact rows"]') as HTMLElement).click(); await settle(); });
    assert.equal(localStorage.getItem('mc:watchlist-compact'), '1'); assert.ok(document.querySelector('.mcwl-compact'));
    void CHART_WATCHLISTS_KEY;
  });
});

test('zzz1006 watchlist width presets drive the chart page\'s own divider (its limits and saved width)', async () => {
  await withDom('http://localhost/charts', async ({ React, act, settle, root }) => {
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ quotes: {} }) });
    const { default: Watchlist } = await import('../../components/charts/WatchlistPanel');
    const { default: Divider, clampWatchlistWidth } = await import('../../components/charts/WatchlistResizeHandle');
    const store = importParsed(sanitizeStore(null), parseTradingView('NASDAQ:AAPL'), { mode: 'new', name: 'W' });
    const saved: number[] = [];
    function Page() {
      const [w, setW] = React.useState(437);
      return React.createElement('div', { className: 'mc-charts-main' },
        React.createElement(Divider, { width: w, onChange: (n: number, persist: boolean) => { const c = clampWatchlistWidth(n); setW(c); if (persist) saved.push(c); } }),
        React.createElement('div', { className: 'mc-charts-panel' }, React.createElement(Watchlist, { store, update: () => {}, currentKey: 'US:AAPL', onPick: () => {} })));
    }
    await act(async () => { root.render(React.createElement(Page)); await settle(); });
    const sep = document.querySelector('[aria-label="Watchlist width"]')!;
    sep.parentElement!.getBoundingClientRect = () => ({ width: 2000 } as DOMRect);
    await act(async () => { window.dispatchEvent(new Event('resize')); await settle(); });
    await act(async () => { (document.querySelector('[aria-label="List menu"]') as HTMLElement).click(); await settle(); });
    await act(async () => { btn((b) => /^.?Wide/.test(b.textContent || '') && b.getAttribute('role') === 'menuitemradio')!.click(); await new Promise((r) => setTimeout(r, 600)); });
    assert.equal(sep.getAttribute('aria-valuenow'), '520'); assert.equal(saved.at(-1), 520);
    await act(async () => { (document.querySelector('[aria-label="List menu"]') as HTMLElement).click(); await settle(); });
    await act(async () => { btn((b) => /^.?Narrow/.test(b.textContent || '') && b.getAttribute('role') === 'menuitemradio')!.click(); await new Promise((r) => setTimeout(r, 600)); });
    assert.equal(sep.getAttribute('aria-valuenow'), '300'); assert.equal(saved.at(-1), 300);
  });
});

// ── 5 · the screener page ────────────────────────────────────────────────────────────────────────────────────────────────
test('zzz1006 screener: one-row top bar, picker switch, chip pass counts in tooltips + paused state, selection toolbar, review badge, company panel', async () => {
  await withDom('http://localhost/stock-screener', async ({ React, act, settle, root, text, clip }) => {
    const savedScreens = [{ id: 'audit', name: 'Audit', market: 'IN', filters: [{ kind: 'num', key: 'mc', op: 'gt', v: 1000 }, { kind: 'num', key: 'pe', op: 'lt', v: 5, off: true }] }];
    localStorage.setItem(SCREENS_KEY, JSON.stringify(savedScreens));
    localStorage.setItem('mc:stock-screener:last:v1', 'audit');
    localStorage.setItem('mc:screener-density:v1', 'compact');
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ ok: true, builtAt: '2026-10-12T12:00:00Z', rows: [
      { t: 'DEEDEV', n: 'DEE Development', px: 312.456, chg: 2.1, mc: 2150, pe: 30, revQYoY: 40, exch: ['NSE'], q: 'Q2 2026' },
      { t: 'TCS', n: 'Tata Consultancy', px: 3050.1, chg: -0.3, mc: 1_100_000, pe: 25, exch: ['NSE', 'BSE'], q: 'Q2 2026' },
      { t: 'SMALL', n: 'Small Co', px: 10, chg: 0, mc: 500, exch: ['NSE'] },
    ], notes: [], sources: ['fixture'] }) });
    const { default: Screener } = await import('../../components/stock-screener/StockScreener');
    await act(async () => { root.render(React.createElement(Screener)); await settle(); });
    assert.match(text(), /2 of 3 companies match/);
    assert.equal(localStorage.getItem('mc:screener-density:v1'), 'compact', 'saved density kept');
    // chips: pass count in the tooltip, paused state distinct
    const chips = Array.from(document.querySelectorAll('.mcss-chip[data-pass]'));
    assert.equal(chips.length, 2);
    assert.match(chips[0].querySelector('button')!.getAttribute('title')!, /2 of 3 companies pass this filter alone/);
    assert.ok(chips[1].classList.contains('paused')); assert.match(chips[1].textContent!, /Paused/);
    // status line: compact, coverage details on request
    assert.match(document.querySelector('.mcss-status')!.textContent!, /Updated .*Coverage details/);
    assert.doesNotMatch(text(), /company figures for/);
    await act(async () => { btn((b) => /^Coverage details/.test(b.textContent || ''))!.click(); await settle(); });
    assert.match(text(), /company figures for 2 of 3/);
    // review badge (not a select per row) opens the same four choices
    assert.equal(document.querySelector('select[aria-label^="Review state"]'), null);
    await act(async () => { (document.querySelector('[aria-label="Review state for TCS: Unreviewed"]') as HTMLElement).click(); await settle(); });
    await act(async () => { btn((b) => b.getAttribute('role') === 'menuitemradio' && b.textContent!.includes('Chart checked'))!.click(); await settle(); });
    assert.deepEqual(JSON.parse(localStorage.getItem('mc:screen-review:v1')!), { 'IN:TCS': 'chart' });
    assert.ok(document.querySelector('[aria-label="Review state for TCS: Chart checked"]'));
    // selection toolbar acts on the ticked rows only
    await act(async () => { (document.querySelector('input[aria-label="Select DEEDEV"]') as HTMLInputElement).click(); await settle(); });
    const bar = document.querySelector('[role="toolbar"][aria-label="Selected companies"]')!;
    assert.match(bar.textContent!, /1 selected/);
    await act(async () => { Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === 'Copy tickers')!.click(); await settle(); });
    assert.equal(clip.at(-1), 'NSE:DEEDEV');
    assert.match(document.querySelector('[data-testid="result-counts"]')!.textContent!, /1 selected/);
    await act(async () => { btn((b) => b.textContent === 'Clear selection')!.click(); await settle(); });
    assert.equal(document.querySelector('[aria-label="Selected companies"]'), null);
    // the Actions menu still copies the whole result (scope unchanged)
    await act(async () => { btn((b) => (b.textContent || '').startsWith('Actions'))!.click(); await settle(); });
    await act(async () => { btn((b) => b.textContent === 'Copy tickers')!.click(); await settle(); });
    assert.equal(clip.at(-1), 'NSE:TCS,NSE:DEEDEV');
    // company panel on the name; window scroll untouched; figures + links
    (window as any).scrollY = 640; let scrolled = false; window.scrollTo = (() => { scrolled = true; }) as any;
    await act(async () => { (document.querySelector('[data-detail="DEEDEV"]') as HTMLElement).click(); await settle(); });
    const panel = document.querySelector('[role="dialog"][aria-label="Company details: DEEDEV"]')!;
    assert.ok(panel); assert.equal(scrolled, false, 'opening the panel does not move the page');
    assert.match(panel.textContent!, /₹312\.46/); assert.match(panel.textContent!, /Revenue growth, quarterly YoY/);
    assert.match(panel.textContent!, /passes every one/);
    assert.ok(panel.querySelector('a[href="/stock-sheet?ticker=DEEDEV&market=IN"]'));
    assert.ok(Array.from(panel.querySelectorAll('a')).some((a) => a.textContent === 'Open chart'));
    await act(async () => { panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); });
    assert.equal(document.querySelector('[aria-label="Company details: DEEDEV"]'), null);
    // column view: visible columns only
    await act(async () => { (document.querySelector('[aria-label^="Columns:"]') as HTMLElement).click(); await settle(); });
    await act(async () => { btn((b) => b.getAttribute('role') === 'menuitemradio' && b.textContent!.includes('Growth'))!.click(); await settle(); });
    assert.equal(localStorage.getItem('mc:screener-colview:v1'), 'growth');
    assert.ok(Array.from(document.querySelectorAll('th')).some((th) => th.textContent!.startsWith('Revenue growth, quarterly YoY')));
    assert.match(text(), /2 of 3 companies match/, 'same result');
    // picker: switching with unsaved changes still asks first; saved screens untouched by favourites
    await act(async () => { (document.querySelector('[aria-label="Pause this filter"]') as HTMLElement).click(); await settle(); });
    await act(async () => { (document.querySelector('button[aria-label="Screens"]') as HTMLElement).click(); await settle(); });
    const first = document.querySelector<HTMLElement>('[data-screen]:not([aria-selected="true"])')!;
    await act(async () => { (first.nextElementSibling as HTMLElement).click(); await settle(); });   // ☆ favourite
    assert.equal(localStorage.getItem(SCREENS_KEY), JSON.stringify(savedScreens), 'a favourite never edits a saved screen');
    await act(async () => { document.querySelector<HTMLElement>(`[data-screen="${first.getAttribute('data-screen')}"]`)!.click(); await settle(); });
    assert.ok(document.querySelector('[role="dialog"][aria-label="Unsaved filters"]'), 'unsaved filters: asks before switching');
  });
});

test('zzz1006 update notice: a small chip in the header status area (portal), same reload function', () => {
  const src = read('components/pwa/PwaRegister.tsx');
  assert.match(src, /createPortal\(chip, slot\)/);
  assert.match(src, /document\.querySelector\(`header \.\$\{cls\}`\)/);
  assert.match(src, /Update available/); assert.match(src, /SKIP_WAITING/); assert.match(src, /aria-label="Later"/);
  assert.doesNotMatch(src, /className=\{s\.toast\}/, 'no longer a toast floating over content');
  const css = read('components/pwa/pwa.module.css');
  assert.match(css, /\.updateChip, \.updateDock \{/);
});

test('zzz1006 watchlist store keys and saved data are unchanged by the redesign', () => {
  const panel = read('components/charts/WatchlistPanel.tsx');
  assert.match(panel, /localStorage\.setItem\(CHART_WATCHLISTS_KEY, json\)/);
  assert.match(panel, /'mc:watchlist-compact'/);
  assert.doesNotMatch(panel, /patchSection\(l, section\.id, \{ name: displaySectionName/, 'display labels are never written back');
  const screener = read('components/stock-screener/StockScreener.tsx');
  for (const k of ["SCREENS_KEY", "'mc:screener-exact:v1'", "'mc:screener-close-only:v1'", 'DRAFTS_KEY', 'SHORTLISTS_KEY']) assert.ok(screener.includes(k), k);
});
