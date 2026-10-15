// zzz1038 — Charts watchlist: right-click menu as in TradingView (owner: "in the watchlist also right-click — I should be able to
// do all tasks like TradingView").
//  • row: Open chart / in new tab · Copy symbol (NSE:TICKER, bare US ticker) / company name · Flag ▸ · Move to section ▸ · top /
//    bottom of section · Add to another watchlist ▸ · News · Remove (with Undo)
//  • section header: Add symbol here · Rename · Collapse / expand · Sort by symbol / change % · Remove section (symbols kept)
//  • the chart's menu gains one-level submenus (→ opens, ← / Esc closes, tap opens), long-press opens the menu on touch
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  copyItemToList, copyItemToNewList, copySymbolText, dissolveSection, findItem, importParsed, itemKey, moveItemToEdge, moveItemToNewSection,
  parseTradingView, removeItem, removedFrom, restoreItem, sanitizeStore, sortSection, type WlList, type WlStore,
} from '../chart-watchlist';
import { applyRowMenu, applySectionMenu, chartHref, newsHref, watchlistRowMenu, watchlistSectionMenu } from '../../components/charts/watchlist-context-menu';
import { chartMenuItems, placeMenu, placeSubmenu, type ChartMenuItem } from '../../components/charts/ChartContextMenu';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

function fixture(): WlStore {
  let s = importParsed(sanitizeStore(null), parseTradingView('###AI_CHIPS,NASDAQ:NVDA,NASDAQ:KLIC,NASDAQ:AMD,###INDIA_CORE,NSE:TCS,BSE:RELIANCE'), { mode: 'new', name: 'Desk' });
  s = importParsed(s, parseTradingView('NSE:INFY'), { mode: 'new', name: 'Second' });
  return { ...s, activeId: s.lists.find((l) => l.name === 'Desk')!.id };
}
const desk = (s: WlStore) => s.lists.find((l) => l.name === 'Desk')!;
const second = (s: WlStore) => s.lists.find((l) => l.name === 'Second')!;
const syms = (l: WlList) => l.sections.map((x) => `${x.name}:${x.items.map((i) => i.t + (i.flag ? `(${i.flag})` : '')).join(',')}`);
const ids = (items: ChartMenuItem[]) => items.map((x) => x.id);
const allLabels = (items: ChartMenuItem[]): string[] => items.flatMap((x) => [x.label, ...allLabels(x.children || [])]);

test('row menu: every TradingView action, flags with ✓ on the current, sections and other lists as submenus', () => {
  let s = fixture();
  s = applyRowMenu(s, desk(s).id, 'US:KLIC', 'flag:blue')!;
  const items = watchlistRowMenu(s, desk(s), 'US:KLIC', 'Kulicke and Soffa');
  assert.deepEqual(ids(items), ['open', 'open-tab', 'copy-sym', 'copy-name', 'flag', 'move', 'top', 'bottom', 'copy-list', 'news', 'remove']);
  const by = (id: string) => items.find((x) => x.id === id)!;
  assert.deepEqual(by('flag').children!.map((c) => c.id), ['flag:red', 'flag:blue', 'flag:green', 'flag:orange', 'flag:purple', 'flag:none']);
  assert.equal(by('flag').children!.find((c) => c.id === 'flag:blue')!.checked, true);
  assert.equal(by('flag').children!.find((c) => c.id === 'flag:red')!.checked, false);
  assert.equal(by('flag').children!.find((c) => c.id === 'flag:none')!.disabled, false);
  const move = by('move').children!;
  assert.deepEqual(move.map((c) => c.label), ['AI Chips', 'India Core', 'New section…']);
  assert.equal(move[0].disabled, true, 'its own section is ticked and off');
  assert.deepEqual(by('copy-list').children!.map((c) => c.label), ['My Watchlist', 'Second', 'New list…']);
  assert.equal(by('top').disabled, false); assert.equal(by('bottom').disabled, false);
  assert.equal(by('remove').danger, true);
  // first / last row of its section; no quote name = Copy company name off; already in the other list = off
  const first = watchlistRowMenu(s, desk(s), 'US:NVDA', null);
  assert.equal(first.find((x) => x.id === 'top')!.disabled, true);
  assert.equal(first.find((x) => x.id === 'copy-name')!.disabled, true);
  assert.equal(watchlistRowMenu(s, desk(s), 'US:AMD').find((x) => x.id === 'bottom')!.disabled, true);
  const s2 = copyItemToList(s, second(s).id, { m: 'US', t: 'KLIC' });
  const into = watchlistRowMenu(s2, desk(s2), 'US:KLIC').find((x) => x.id === 'copy-list')!.children!.find((c) => c.id === `copy-to:${second(s2).id}`)!;
  assert.equal(into.label, 'Second (already in)');
  assert.equal(into.disabled, true);
  assert.deepEqual(watchlistRowMenu(s, desk(s), 'US:NOPE'), [], 'unknown row: no menu');
});

test('section menu: add, rename, collapse/expand, sort, remove (keeps symbols)', () => {
  const s = fixture();
  const sec = desk(s).sections[0];
  const items = watchlistSectionMenu(desk(s), sec.id);
  assert.deepEqual(ids(items), ['sec-add', 'sec-rename', 'sec-toggle', 'sec-sort:symbol', 'sec-sort:chg', 'sec-remove']);
  assert.equal(items[2].label, 'Collapse section');
  const collapsed = applySectionMenu(s, desk(s).id, sec.id, 'sec-toggle', {})!;
  assert.equal(desk(collapsed).sections[0].collapsed, true);
  assert.equal(watchlistSectionMenu(desk(collapsed), sec.id)[2].label, 'Expand section');
  assert.equal(applySectionMenu(s, desk(s).id, sec.id, 'sec-rename', {}), null, 'rename asks for a name in the panel');
});

test('row actions change the store: flag, move section, top / bottom, add to another list, new section, new list', () => {
  let s = fixture();
  const L = desk(s).id;
  s = applyRowMenu(s, L, 'US:AMD', 'flag:red')!;
  assert.equal(findItem(desk(s), 'US:AMD')!.item.flag, 'red');
  s = applyRowMenu(s, L, 'US:AMD', 'flag:none')!;
  assert.equal(findItem(desk(s), 'US:AMD')!.item.flag, undefined);
  s = applyRowMenu(s, L, 'US:AMD', 'top')!;
  assert.deepEqual(syms(desk(s))[0], 'AI_CHIPS:AMD,NVDA,KLIC');
  s = applyRowMenu(s, L, 'US:AMD', 'bottom')!;
  assert.deepEqual(syms(desk(s))[0], 'AI_CHIPS:NVDA,KLIC,AMD');
  s = applyRowMenu(s, L, 'US:KLIC', `move:${desk(s).sections[1].id}`)!;
  assert.deepEqual(syms(desk(s)), ['AI_CHIPS:NVDA,AMD', 'INDIA_CORE:TCS,RELIANCE,KLIC']);
  s = applyRowMenu(s, L, 'US:NVDA', 'flag:green')!;
  const before = s;
  s = applyRowMenu(s, L, 'US:NVDA', `copy-to:${second(s).id}`)!;
  assert.deepEqual(syms(second(s)), [':INFY,NVDA(green)'], 'copied with its flag');
  assert.deepEqual(syms(desk(s)), syms(desk(before)), 'the open list is unchanged');
  assert.equal(s.activeId, L);
  assert.equal(applyRowMenu(s, L, 'US:NVDA', 'open'), null, 'not a list edit');
  assert.equal(applyRowMenu(s, L, 'US:NVDA', 'move:new'), null, 'asks for a name first');
  // new section / new list helpers (after the panel's prompt)
  const ns = moveItemToNewSection(desk(s), 'US:AMD', 'Semis watch');
  assert.deepEqual(syms(ns), ['AI_CHIPS:NVDA(green)', 'INDIA_CORE:TCS,RELIANCE,KLIC', 'Semis watch:AMD']);
  const nl = copyItemToNewList(s, 'Fresh', { m: 'IN', t: 'TCS' });
  assert.equal(nl.lists.length, s.lists.length + 1); assert.equal(nl.activeId, L, 'stays on the open list');
  assert.deepEqual(syms(nl.lists.at(-1)!), [':TCS']);
  // moveItemToEdge on an unknown key = same list
  assert.equal(moveItemToEdge(desk(s), 'US:NOPE', 'top'), desk(s));
});

test('remove + undo: back in the same section and place; never lost', () => {
  const l = desk(fixture());
  const r = removedFrom(l, 'US:KLIC')!;
  assert.deepEqual({ sectionId: r.sectionId, index: r.index, t: r.item.t }, { sectionId: l.sections[0].id, index: 1, t: 'KLIC' });
  const gone = removeItem(l, 'US:KLIC');
  assert.equal(findItem(gone, 'US:KLIC'), null);
  const back = restoreItem(gone, r);
  assert.deepEqual(syms(back), syms(l));
  assert.equal(restoreItem(back, r), back, 'no duplicate when undone twice');
  // its section was removed meanwhile: back at the end of the last section
  const noSec = { ...gone, sections: gone.sections.filter((x) => x.id !== r.sectionId) };
  assert.deepEqual(syms(restoreItem(noSec, r)), ['INDIA_CORE:TCS,RELIANCE,KLIC']);
  // BSE identity kept
  const rb = removedFrom(l, 'IN:BSE:RELIANCE')!;
  assert.deepEqual(syms(restoreItem(removeItem(l, 'IN:BSE:RELIANCE'), rb)), syms(l));
});

test('section actions: sort by symbol / change %, remove keeps the names in the unnamed group', () => {
  const s = fixture();
  const L = desk(s).id, sid = desk(s).sections[0].id;
  const q = { 'US:NVDA': { last: 1, chgPct: 1 }, 'US:KLIC': { last: 1, chgPct: 3 }, 'US:AMD': { last: 1, chgPct: null } };
  assert.deepEqual(syms(desk(applySectionMenu(s, L, sid, 'sec-sort:symbol', q)!))[0], 'AI_CHIPS:AMD,KLIC,NVDA');
  assert.deepEqual(syms(desk(applySectionMenu(s, L, sid, 'sec-sort:chg', q)!))[0], 'AI_CHIPS:KLIC,NVDA,AMD', 'no quote last');
  // no unnamed group: the section loses its name and goes to the top
  const rm = desk(applySectionMenu(s, L, desk(s).sections[1].id, 'sec-remove', q)!);
  assert.deepEqual(syms(rm), [':TCS,RELIANCE', 'AI_CHIPS:NVDA,KLIC,AMD']);
  // with an unnamed group: the symbols join it
  const withLoose: WlList = { ...desk(s), sections: [{ id: 'loose', name: '', collapsed: false, items: [{ m: 'US', t: 'QQQ' }] }, ...desk(s).sections] };
  assert.deepEqual(syms(dissolveSection(withLoose, sid)), [':QQQ,NVDA,KLIC,AMD', 'INDIA_CORE:TCS,RELIANCE']);
  assert.equal(dissolveSection(withLoose, 'loose'), withLoose, 'the unnamed group itself is not a section to remove');
  const count = (l: WlList) => l.sections.reduce((n, x) => n + x.items.length, 0);
  assert.equal(count(dissolveSection(withLoose, sid)), count(withLoose), 'no symbol lost');
});

test('copy text and links: NSE:TICKER / BSE:CODE for India, bare ticker for the US', () => {
  assert.equal(copySymbolText({ m: 'IN', t: 'TCS' }), 'NSE:TCS');
  assert.equal(copySymbolText({ m: 'IN', t: 'M&M', x: 'NSE' }), 'NSE:M&M');
  assert.equal(copySymbolText({ m: 'IN', t: 'RELIANCE', x: 'BSE' }), 'BSE:RELIANCE');
  assert.equal(copySymbolText({ m: 'IN', t: '500325' }), 'BSE:500325');
  assert.equal(copySymbolText({ m: 'US', t: 'BRK.B', x: 'NYSE' }), 'BRK.B');
  assert.equal(chartHref({ m: 'IN', t: 'RELIANCE', x: 'BSE' }), '/charts?t=RELIANCE&m=IN&x=BSE');
  assert.equal(chartHref({ m: 'US', t: 'NVDA', x: 'NASDAQ' }), '/charts?t=NVDA&m=US');
  assert.equal(newsHref('M&M'), '/news?q=M%26M');
  assert.equal(itemKey({ m: 'IN', t: 'RELIANCE', x: 'BSE' }), 'IN:BSE:RELIANCE');
});

test('menus stay on screen: placeMenu flips at the window edge; submenus open on the side with room and move up', () => {
  assert.deepEqual(placeMenu(990, 700, 220, 300, 1000, 800), { left: 770, top: 496 });
  assert.deepEqual(placeSubmenu({ left: 100, right: 300, top: 50 }, 200, 150, { left: 0, top: 0, right: 1000, bottom: 800 }), { side: 'right', top: -4 });
  assert.deepEqual(placeSubmenu({ left: 700, right: 900, top: 50 }, 200, 150, { left: 0, top: 0, right: 1000, bottom: 800 }), { side: 'left', top: -4 });
  assert.deepEqual(placeSubmenu({ left: 100, right: 300, top: 700 }, 200, 150, { left: 0, top: 0, right: 1000, bottom: 800 }), { side: 'right', top: -54 });
  assert.equal(placeSubmenu({ left: 10, right: 300, top: 10 }, 200, 900, { left: 0, top: 0, right: 1000, bottom: 800 }).top, -6, 'never above the top');
});

test('wording: plain short English, no "best", no Buy / Sell', () => {
  const s = fixture();
  const words = [...allLabels(watchlistRowMenu(s, desk(s), 'US:KLIC', 'Kulicke')), ...allLabels(watchlistSectionMenu(desk(s), desk(s).sections[0].id))];
  for (const w of words) { assert.doesNotMatch(w, /\bbest\b/i); assert.doesNotMatch(w, /\b(buy|sell)\b/i); assert.ok(w.length <= 45, w); }
  const src = read('components/charts/watchlist-context-menu.ts') + read('components/charts/WatchlistPanel.tsx');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /['"`][^'"`]*\b(best|Buy|Sell)\b[^'"`]*['"`]/);
  // the chart's own menu is unchanged (flat, no submenus)
  const chart = chartMenuItems({ axis: false, price: 10, cur: '$', decimals: 2, auto: true, log: false, tr: false, patterns: false, stage: false, setups: false, volume: true, selected: false, light: true });
  assert.ok(chart.every((x) => !x.children));
});

// ───────── mounted (JSDOM) ─────────
async function withDom(fn: (h: { React: any; act: any; root: any; settle: (ms?: number) => Promise<void>; dom: any; clip: string[]; opened: string[] }) => Promise<void>) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="outside">chart</div><div id="root"></div>', { url: 'http://localhost/charts', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'MouseEvent', 'navigator', 'self', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  const clip: string[] = [], opened: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (t: string) => { clip.push(t); } }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  (dom.window as any).open = (u: string) => { opened.push(u); return null; };
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, IS_REACT_ACT_ENVIRONMENT: true });
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ quotes: {
    'US:NVDA': { last: 180, chgPct: 1, name: 'NVIDIA Corporation', at: Date.now() },
    'US:KLIC': { last: 40, chgPct: 3, name: 'Kulicke and Soffa', at: Date.now() },
    'US:AMD': { last: 150, chgPct: -1, name: 'Advanced Micro Devices', at: Date.now() },
  } }) });
  const { _resetSharedFetch } = await import('../tab-shared-fetch');
  _resetSharedFetch();
  const root = createRoot(document.getElementById('root')!);
  const settle = (ms = 25) => new Promise<void>((r) => setTimeout(r, ms));
  try { await fn({ React, act, root, settle, dom, clip, opened }); } finally {
    try { await act(async () => { root.unmount(); }); } catch { /* keep the test's own failure visible */ }
    await new Promise<void>((r) => setTimeout(r, 3700));   // the panel's 3.5 s message timer
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
}

test('mounted: right-click selects the row and opens the menu; submenus by keyboard and tap; actions edit the list; Undo; Esc / outside close', async () => {
  await withDom(async ({ React, act, root, settle, dom, clip, opened }) => {
    const { default: Watchlist } = await import('../../components/charts/WatchlistPanel');
    let store = fixture();
    const picks: string[] = [];
    function Wrap() {
      const [s, setS] = React.useState(store);
      const [cur, setCur] = React.useState('US:NVDA');
      return React.createElement(Watchlist, { store: s, update: (fn: (x: WlStore) => WlStore) => setS((x: WlStore) => { const n = fn(x); store = n; return n; }), currentKey: cur,
        onPick: (m: any, t: string, x?: string) => { picks.push(itemKey({ m, t, x })); setCur(itemKey({ m, t, x })); } });
    }
    await act(async () => { root.render(React.createElement(Wrap)); await settle(); });
    const W = dom.window;
    const row = (k: string) => document.querySelector<HTMLElement>(`[data-key="${k}"]`)!;
    const menu = () => document.querySelector<HTMLElement>('[data-testid="watchlist-row-menu"]');
    const item = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid^="watchlist-"] button[data-id="${id}"]`)!;
    const rightClick = async (el: HTMLElement) => { await act(async () => { el.dispatchEvent(new W.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 90 })); await settle(); }); };
    const key = async (k: string) => { await act(async () => { (document.activeElement as HTMLElement).dispatchEvent(new W.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); await settle(); }); };
    const click = async (el: HTMLElement) => { await act(async () => { el.click(); await settle(); }); };

    // right-click: the row is picked first, then the menu at the pointer, first item focused
    await rightClick(row('US:KLIC'));
    assert.deepEqual(picks, ['US:KLIC']);
    assert.ok(menu(), 'menu open');
    assert.equal(menu()!.style.position, 'fixed');
    assert.equal(menu()!.getAttribute('aria-label'), 'KLIC');
    assert.equal(document.activeElement, item('open'));
    // keyboard: ↓ moves, → opens the Flag submenu and focuses its first item, ← closes it back to Flag
    await key('ArrowDown'); assert.equal(document.activeElement, item('open-tab'));
    item('flag').focus();
    await key('ArrowRight');
    assert.ok(document.querySelector('[data-testid="submenu-flag"]'), 'submenu open');
    assert.equal(item('flag').getAttribute('aria-expanded'), 'true');
    assert.equal(document.activeElement, item('flag:red'));
    await key('ArrowDown'); assert.equal(document.activeElement, item('flag:blue'), '↓ stays inside the submenu');
    await key('ArrowLeft');
    assert.equal(document.querySelector('[data-testid="submenu-flag"]'), null);
    assert.equal(document.activeElement, item('flag'));
    // Esc closes the submenu first, then the menu
    await key('ArrowRight');
    await act(async () => { document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); });
    assert.equal(document.querySelector('[data-testid="submenu-flag"]'), null); assert.ok(menu(), 'menu still open');
    await act(async () => { document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); });
    assert.equal(menu(), null, 'Esc closes');
    // tap (click) on Flag opens the submenu; picking a colour flags the row and closes the menu
    await rightClick(row('US:KLIC'));
    await click(item('flag'));
    await click(item('flag:purple'));
    assert.equal(findItem(desk(store), 'US:KLIC')!.item.flag, 'purple');
    assert.equal(menu(), null);
    await rightClick(row('US:KLIC'));
    await click(item('flag'));
    assert.equal(item('flag:purple').getAttribute('aria-checked'), 'true', '✓ on the current flag');
    // move to another section through the submenu
    await click(item('move'));
    await click(item(`move:${desk(store).sections[1].id}`));
    assert.deepEqual(syms(desk(store)), ['AI_CHIPS:NVDA,AMD', 'INDIA_CORE:TCS,RELIANCE,KLIC(purple)']);
    // move to top of its section
    await rightClick(row('US:KLIC'));
    await click(item('top'));
    assert.deepEqual(syms(desk(store))[1], 'INDIA_CORE:KLIC(purple),TCS,RELIANCE');
    // add to another list
    await rightClick(row('US:KLIC'));
    await click(item('copy-list'));
    await click(item(`copy-to:${second(store).id}`));
    assert.deepEqual(syms(second(store)), [':INFY,KLIC(purple)']);
    // copy symbol / company name; open in new tab; news
    await rightClick(row('IN:BSE:RELIANCE'));
    await click(item('copy-sym'));
    await rightClick(row('US:KLIC'));
    await click(item('copy-name'));
    assert.deepEqual(clip, ['BSE:RELIANCE', 'Kulicke and Soffa']);
    await rightClick(row('US:KLIC'));
    await click(item('open-tab'));
    await rightClick(row('US:KLIC'));
    await click(item('news'));
    assert.deepEqual(opened, ['/charts?t=KLIC&m=US', '/news?q=KLIC']);
    // remove + Undo
    await rightClick(row('US:AMD'));
    await click(item('remove'));
    assert.equal(findItem(desk(store), 'US:AMD'), null);
    const undo = document.querySelector<HTMLElement>('[data-testid="watchlist-undo"]')!;
    assert.match(undo.textContent!, /AMD removed from Desk/);
    await click(Array.from(undo.querySelectorAll('button')).find((b) => b.textContent === 'Undo')!);
    assert.deepEqual(syms(desk(store))[0], 'AI_CHIPS:NVDA,AMD', 'back in the same place');
    // click outside closes
    await rightClick(row('US:NVDA'));
    assert.ok(menu());
    await act(async () => { document.getElementById('outside')!.dispatchEvent(new W.MouseEvent('pointerdown', { bubbles: true })); await settle(); });
    assert.equal(menu(), null, 'a click outside closes');
  });
});

test('mounted: section header menu (collapse, sort, rename, remove keeps symbols) and long-press on touch', async () => {
  await withDom(async ({ React, act, root, settle, dom }) => {
    const { default: Watchlist, LONG_PRESS_MS } = await import('../../components/charts/WatchlistPanel');
    assert.equal(LONG_PRESS_MS, 500);
    let store = fixture();
    const picks: string[] = [];
    function Wrap() {
      const [s, setS] = React.useState(store);
      return React.createElement(Watchlist, { store: s, update: (fn: (x: WlStore) => WlStore) => setS((x: WlStore) => { const n = fn(x); store = n; return n; }), currentKey: 'US:NVDA', onPick: (m: any, t: string) => picks.push(`${m}:${t}`) });
    }
    await act(async () => { root.render(React.createElement(Wrap)); await settle(60); });
    const W = dom.window;
    const head = (i: number) => document.querySelectorAll<HTMLElement>('.mcwl-sec')[i];
    const item = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="watchlist-section-menu"] button[data-id="${id}"]`)!;
    const open = async (i: number) => { await act(async () => { head(i).dispatchEvent(new W.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 40 })); await settle(); }); };
    const click = async (el: HTMLElement) => { await act(async () => { el.click(); await settle(); }); };
    await open(0);
    assert.ok(document.querySelector('[data-testid="watchlist-section-menu"]'));
    await click(item('sec-toggle'));
    assert.equal(desk(store).sections[0].collapsed, true);
    await open(0);
    assert.equal(item('sec-toggle').textContent!.trim(), 'Expand section');
    await click(item('sec-toggle'));
    assert.equal(desk(store).sections[0].collapsed, false);
    await open(0);
    await click(item('sec-sort:chg'));
    assert.deepEqual(syms(desk(store))[0], 'AI_CHIPS:KLIC,NVDA,AMD', 'by change %, high to low');
    await open(0);
    await click(item('sec-sort:symbol'));
    assert.deepEqual(syms(desk(store))[0], 'AI_CHIPS:AMD,KLIC,NVDA');
    // rename through a prompt; remove asks first (Cancel keeps it), then keeps the symbols
    (W as any).prompt = () => 'Chips';
    await open(0);
    await click(item('sec-rename'));
    assert.equal(desk(store).sections[0].name, 'Chips');
    let asked = '';
    (W as any).confirm = (m: string) => { asked = m; return false; };
    await open(1);
    await click(item('sec-remove'));
    assert.match(asked, /Its 2 symbols stay in the list/);
    assert.equal(desk(store).sections.length, 2, 'cancelled');
    (W as any).confirm = () => true;
    await open(1);
    await click(item('sec-remove'));
    assert.deepEqual(syms(desk(store)), [':TCS,RELIANCE', 'Chips:AMD,KLIC,NVDA']);
    // add symbol to this section: the add form opens with that section chosen
    await open(0);
    await click(item('sec-add'));
    assert.equal(document.querySelector<HTMLSelectElement>('[aria-label="Section for new symbol"]')!.value, desk(store).sections[1].id);
    // long-press (touch) on a row opens the row menu; the tap that ends it does not open the chart
    const pointer = (type: string, el: HTMLElement) => { const e = new W.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }); Object.defineProperty(e, 'pointerType', { value: 'touch' }); el.dispatchEvent(e); };
    const row = document.querySelector<HTMLElement>('[data-key="US:KLIC"]')!;
    const n = picks.length;
    await act(async () => { pointer('pointerdown', row); await settle(LONG_PRESS_MS + 80); });
    assert.ok(document.querySelector('[data-testid="watchlist-row-menu"]'), 'long-press opens the menu');
    await act(async () => { pointer('pointerup', row); row.click(); await settle(); });
    assert.deepEqual(picks.slice(n), ['US:KLIC'], 'picked once on open, the ending tap is ignored');
    // a short tap does not open it
    await act(async () => { document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); });
    await act(async () => { pointer('pointerdown', row); await settle(100); pointer('pointerup', row); await settle(LONG_PRESS_MS); });
    assert.equal(document.querySelector('[data-testid="watchlist-row-menu"]'), null);
  });
});

test('source: the chart menu keeps descriptors + one onSelect; submenus via children; panel wires right-click, long-press and Undo', () => {
  const menu = read('components/charts/ChartContextMenu.tsx');
  assert.match(menu, /children\?: ChartMenuItem\[\]/);
  assert.match(menu, /onSelect: \(id: string\) => void/);
  assert.match(menu, /ArrowRight/); assert.match(menu, /ArrowLeft/);
  const panel = read('components/charts/WatchlistPanel.tsx');
  assert.match(panel, /onContextMenu=\{\(e\) => rowContext\(e, it\)\}/);
  assert.match(panel, /LONG_PRESS_MS = 500/);
  assert.match(panel, /<ChartContextMenu fixed/);
});
