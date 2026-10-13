// zzz1012 — Stock Screener premium presentation pass. Screening results, order, Copy and CSV stay identical (the zzz1006 golden
// test proves it); this file covers what was added on top: the display helpers (units in headers, medians, breadth, nulls-last
// sort, shortcut mapping) and, on the real page in JSDOM, the median row, readout, keyboard shortcuts, shortcut card, skeleton
// rows, the empty state's "Pause …" actions and the chip text staying exactly the filter label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unitSuffix, median, columnMedians, breadth, compareRows, shortcutAction } from '../screener/column-views';
import { SCREENS_KEY, filterLabel, type Filter } from '../screener/filters';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

// ── 1 · pure helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
test('zzz1012 header units: % and × shown, currency for price / money, nothing for plain numbers', () => {
  assert.equal(unitSuffix('%', 'US'), '%');
  assert.equal(unitSuffix('x', 'IN'), '×');
  assert.equal(unitSuffix('money', 'US'), 'USD'); assert.equal(unitSuffix('money', 'IN'), 'INR');
  assert.equal(unitSuffix('price', 'IN'), 'INR');
  assert.equal(unitSuffix('shares', 'US'), 'shares');
  assert.equal(unitSuffix('num', 'US'), ''); assert.equal(unitSuffix(undefined, 'US'), '');
});

test('zzz1012 medians and breadth ignore missing figures (never counted as zero)', () => {
  assert.equal(median([]), null);
  assert.equal(median([null, undefined, NaN, 'x']), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, null, 3, 2]), 2.5);
  const m = columnMedians([{ pe: 10, mc: null }, { pe: 30, mc: 5 }, { pe: null, mc: 7 }], ['pe', 'mc', 'ps']);
  assert.deepEqual(m, { pe: { med: 20, n: 2 }, mc: { med: 6, n: 2 }, ps: { med: null, n: 0 } });
  assert.deepEqual(breadth([{ chg: 1 }, { chg: -2 }, { chg: 0 }, { chg: null }, {}, { chg: 0.01 }]), { up: 2, down: 1, flat: 1 });
});

test('zzz1012 table sort: a missing figure is last in BOTH directions; text sorts alphabetically, blanks last', () => {
  const rows = [{ t: 'A', v: 5 }, { t: 'B', v: null }, { t: 'C', v: -1 }, { t: 'D' }, { t: 'E', v: 12 }];
  const asc = rows.slice().sort((a, b) => compareRows(a, b, 'v', 1)).map((r) => r.t);
  const desc = rows.slice().sort((a, b) => compareRows(a, b, 'v', -1)).map((r) => r.t);
  assert.deepEqual(asc.slice(0, 3), ['C', 'A', 'E']); assert.deepEqual(asc.slice(3).sort(), ['B', 'D']);
  assert.deepEqual(desc.slice(0, 3), ['E', 'A', 'C']); assert.deepEqual(desc.slice(3).sort(), ['B', 'D']);
  const txt = [{ s: 'Utilities' }, { s: null }, { s: 'Energy' }, { s: '' }];
  assert.deepEqual(txt.slice().sort((a, b) => compareRows(a, b, 's', 1)).map((r) => r.s).slice(0, 2), ['Energy', 'Utilities']);
  assert.deepEqual(txt.slice().sort((a, b) => compareRows(a, b, 's', -1)).map((r) => r.s).slice(0, 2), ['Utilities', 'Energy']);
  // the default view (market cap, high to low) gives the same order as before zzz1012 (missing figures were already last there)
  const old = (a: any, b: any) => { const fx = typeof a.v === 'number' ? a.v : -Infinity, fy = typeof b.v === 'number' ? b.v : -Infinity; return (fx - fy) * -1 || 0; };
  assert.deepEqual(rows.slice().sort(old).map((r) => r.t).slice(0, 3), desc.slice(0, 3));
});

test('zzz1012 shortcuts: never while typing or with Ctrl / ⌘ / Alt; Enter only off buttons and links', () => {
  const div = { tagName: 'DIV' }, input = { tagName: 'INPUT', type: 'search' }, box = { tagName: 'INPUT', type: 'checkbox' }, btn = { tagName: 'BUTTON' };
  assert.equal(shortcutAction({ key: '/', target: div }), 'find');
  assert.equal(shortcutAction({ key: 'j', target: div }), 'down'); assert.equal(shortcutAction({ key: 'k', target: box }), 'up');
  assert.equal(shortcutAction({ key: 'Enter', target: div }), 'open'); assert.equal(shortcutAction({ key: 'Enter', target: btn }), null);
  assert.equal(shortcutAction({ key: 'o', target: div }), 'details'); assert.equal(shortcutAction({ key: 'x', target: div }), 'select');
  assert.equal(shortcutAction({ key: '?', target: div }), 'help');
  assert.equal(shortcutAction({ key: 'j', target: input }), null, 'typing j in the search box types j');
  assert.equal(shortcutAction({ key: '/', target: { tagName: 'TEXTAREA' } }), null);
  assert.equal(shortcutAction({ key: 'Escape', target: input }), 'escape');
  assert.equal(shortcutAction({ key: 'k', metaKey: true, target: div }), null, '⌘K stays the site search');
  assert.equal(shortcutAction({ key: 'ArrowDown', target: div }), null, 'arrows keep scrolling the page');
});

// ── 2 · the page (JSDOM) ────────────────────────────────────────────────────────────────────────────────────────────────
async function withDom<T>(fn: (h: { React: any; act: any; root: any; settle: () => Promise<void>; text: () => string; dom: any; key: (k: string, target?: EventTarget) => Promise<void> }) => Promise<T>) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/stock-screener', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'MouseEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'Blob', 'MutationObserver', 'requestAnimationFrame', 'CSS'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'MouseEvent', 'MutationObserver']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { value: (f: () => void) => setTimeout(f, 0), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'CSS', { value: { escape: (s: string) => s }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  (dom.window as any).scrollTo = () => {};
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 25));
  const key = async (k: string, target: EventTarget = document.body) => { await act(async () => { target.dispatchEvent(new (dom.window as any).KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); await settle(); }); };
  try { return await fn({ React, act, root, settle, text: () => document.body.textContent || '', dom, key }); } finally {
    await act(async () => { root.unmount(); });
    await new Promise<void>((r) => setTimeout(r, 3100));
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
}
const ROWS = [
  { t: 'AAA', n: 'Alpha', px: 10, chg: 2, mc: 3000, pe: 10, exch: ['NASDAQ'], q: 'Q2 2026' },
  { t: 'BBB', n: 'Beta', px: 20, chg: -1, mc: 2000, pe: 30, exch: ['NYSE'], q: 'Q2 2026' },
  { t: 'CCC', n: 'Gamma', px: 30, chg: 0, mc: 1500, pe: null, exch: ['NYSE'], q: 'Q2 2026' },
  { t: 'DDD', n: 'Delta', px: 40, chg: 1, mc: null, pe: 20, exch: ['NYSE'] },
];

test('zzz1012 page: median row, readout, nulls-last sort, chips keep their exact label', async () => {
  await withDom(async ({ React, act, root, settle, text }) => {
    const screen = { id: 'z', name: 'Z', market: 'US', filters: [{ kind: 'num', key: 'px', op: 'gt', v: 1 }, { kind: 'num', key: 'pe', op: 'lt', v: 100, off: true }] };
    localStorage.setItem(SCREENS_KEY, JSON.stringify([screen])); localStorage.setItem('mc:stock-screener:last:v1', 'z');
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ ok: true, builtAt: '2026-10-12T12:00:00Z', rows: ROWS, notes: [], sources: [] }) });
    const { default: Screener } = await import('../../components/stock-screener/StockScreener');
    await act(async () => { root.render(React.createElement(Screener)); await settle(); });
    assert.match(text(), /4 of 4 companies match/);
    // chips: the visible text is still exactly the filter label (split into name + condition for weight only)
    const labs = Array.from(document.querySelectorAll('.mcss-chip .lab')).map((x) => x.textContent);
    assert.deepEqual(labs, screen.filters.map((f) => filterLabel(f as Filter, 'US')));
    assert.equal(document.querySelector('.mcss-chip .lab .f')!.textContent, 'Price');
    // median row over the listed companies (missing figures left out)
    const med = document.querySelector('tr.med')!;
    assert.match(med.textContent!, /Median of 4/);
    assert.match(med.textContent!, /\$25\.00/, 'median price of 10/20/30/40');
    assert.match(med.textContent!, /\$2(\.0)?B/, 'median market cap of the 3 companies that have one');
    // readout: breadth + sort, header units
    const ro = document.querySelector('[data-testid="results-readout"]')!;
    assert.match(ro.textContent!, /2 up · 1 down/); assert.match(ro.textContent!, /Sorted by Market cap high to low/);
    assert.ok(Array.from(document.querySelectorAll('th')).some((th) => th.textContent!.startsWith('Market cap') && th.querySelector('.u')?.textContent === 'USD'));
    const order = () => Array.from(document.querySelectorAll('a[title^="Open the chart"]')).map((a) => a.textContent);
    assert.deepEqual(order(), ['AAA', 'BBB', 'CCC', 'DDD'], 'default: market cap high → low, unknown last');
    const mcBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.mcss-th')).find((b) => b.textContent!.startsWith('Market cap'))!;
    await act(async () => { mcBtn.click(); await settle(); });
    assert.deepEqual(order(), ['CCC', 'BBB', 'AAA', 'DDD'], 'low → high: the unknown market cap still last');
    assert.equal(mcBtn.closest('th')!.getAttribute('aria-sort'), 'ascending');
  });
});

test('zzz1012 page: keyboard — / find, j / k rows, x select, o details, ? card, Esc', async () => {
  await withDom(async ({ React, act, root, settle, key }) => {
    localStorage.setItem(SCREENS_KEY, JSON.stringify([{ id: 'z', name: 'Z', market: 'US', filters: [] }])); localStorage.setItem('mc:stock-screener:last:v1', 'z');
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ ok: true, builtAt: '2026-10-12T12:00:00Z', rows: ROWS, notes: [], sources: [] }) });
    const { default: Screener } = await import('../../components/stock-screener/StockScreener');
    await act(async () => { root.render(React.createElement(Screener)); await settle(); });
    await key('/');
    assert.equal(document.activeElement, document.querySelector('input[aria-label="Find in results"]'));
    await key('j', document.activeElement!);   // typing in the search field: not a shortcut
    assert.equal(document.querySelector('tr.cur'), null);
    await key('Escape', document.activeElement!);
    assert.notEqual(document.activeElement, document.querySelector('input[aria-label="Find in results"]'));
    await key('j'); await key('j');
    assert.equal(document.querySelector('tr.cur')!.getAttribute('data-row'), 'BBB');
    await key('k');
    assert.equal(document.querySelector('tr.cur')!.getAttribute('data-row'), 'AAA');
    await key('x');
    assert.equal((document.querySelector('input[aria-label="Select AAA"]') as HTMLInputElement).checked, true);
    assert.match(document.querySelector('[aria-label="Selected companies"]')!.textContent!, /1 selected/);
    await key('o');
    assert.ok(document.querySelector('[role="dialog"][aria-label="Company details: AAA"]'));
    await key('j');   // with the panel open, j steps the panel to the next company
    assert.ok(document.querySelector('[role="dialog"][aria-label="Company details: BBB"]'));
    await key('?');
    assert.ok(document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]'));
    await key('Escape');
    assert.equal(document.querySelector('[aria-label="Keyboard shortcuts"]'), null);
  });
});

test('zzz1012 page: skeleton rows while loading; empty state offers to pause the tightest filters', async () => {
  await withDom(async ({ React, act, root, settle }) => {
    localStorage.setItem(SCREENS_KEY, JSON.stringify([{ id: 'z', name: 'Z', market: 'US', filters: [{ kind: 'num', key: 'px', op: 'gt', v: 1 }, { kind: 'num', key: 'pe', op: 'lt', v: 1 }] }]));
    localStorage.setItem('mc:stock-screener:last:v1', 'z');
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    (globalThis as any).fetch = async () => { await gate; return { ok: true, json: async () => ({ ok: true, builtAt: '2026-10-12T12:00:00Z', rows: ROWS, notes: [], sources: [] }) }; };
    const { default: Screener } = await import('../../components/stock-screener/StockScreener');
    await act(async () => { root.render(React.createElement(Screener)); await settle(); });
    assert.ok(document.querySelectorAll('.mcss-skel').length > 10, 'skeleton rows while the snapshot loads');
    assert.equal(document.querySelector('table')!.getAttribute('aria-busy'), 'true');
    await act(async () => { release(); await settle(); });
    assert.equal(document.querySelectorAll('.mcss-skel').length, 0);
    const empty = document.querySelector('.mcss-empty')!;
    assert.match(empty.textContent!, /No company passes every filter/);
    const pause = Array.from(empty.querySelectorAll('button')).find((b) => b.textContent === 'Pause “P/E < 1”')!;
    assert.ok(pause, 'the 0-pass filter is offered first');
    await act(async () => { pause.click(); await settle(); });
    assert.match(document.body.textContent!, /4 of 4 companies match/);
    assert.ok(document.querySelectorAll('.mcss-chip.paused').length === 1);
  });
});

// ── 3 · styles ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('zzz1012 styles: both themes tokenised, sticky header + median row + pinned column, tabular figures, reduced motion', () => {
  const css = read('components/stock-screener/screener-ui.tsx');
  assert.match(css, /\.mcss \{ --ss-canvas: #ffffff;/, 'white tokens are the default');
  assert.match(css, /\.mcss\.mc-workspace-dark \{ --ss-canvas: #0c1018;/, 'dark tokens');
  assert.match(css, /\.mcss-table th \{ position: sticky; top: 0;/);
  assert.match(css, /\.mcss-table tr\.med th \{ top: var\(--ss-hdr\);/);
  assert.match(css, /\.mcss-table \.pin \{ position: sticky; left: 0;/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.mcss \*, \.mcss \*::before, \.mcss \*::after \{ animation: none !important; transition: none !important; \}/);
  assert.match(css, /@media \(max-width: 760px\)/);
  const page = read('components/stock-screener/StockScreener.tsx');
  assert.match(page, /compareRows\(/, 'the page sorts through the nulls-last helper');
  assert.match(page, /\.\.\.cols\.map\(\(k\) => \{ const l = fieldOf\(k\)\?\.label/, 'CSV columns still the screen columns');
});
