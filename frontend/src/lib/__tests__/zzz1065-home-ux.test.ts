// zzz1065 — home page usability (owner, 17 Oct: "app is not user friendly") + audit H01 / H02 / H03.
//   H01: the lazy home panels sat inside a wrapping flex ROW and collapsed to width 0 (never loaded).
//   H02: the home date came from the browser's zone while the clock was IST.
//   H03: the new US movers list used next/link (viewport prefetch) instead of NavLink.
// Plus: status strip first, explicit 1/2/4 inbox lanes, searchable All tools drawer, favourites with a separate
// reorder handle, a filter box in the phone Menu and the price-alerts bell kept visible on phones.
// The real-browser geometry check is tests/e2e/zzz1065-lazy-panel-layout.test.ts (Playwright; run by hand).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { homeDateTime, indiaSession, usSession, freshnessSummary } from '../home-status';
import { lazyPanelWrapperStyle, lazyPanelWrapperCss } from '../lazy-panel-style';
import { inboxLaneColumns, INBOX_TWO_COLUMNS_FROM, INBOX_FOUR_COLUMNS_FROM } from '../inbox-lanes';
import { toolMatches, moveItem, mergeFavOrder, FAV_LONG_PRESS_MS } from '../home-tools';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const h = React.createElement;
const HOME = 'app/(dashboard)/page.tsx';

/** Run `fn` with the process time zone set to `tz` (Node re-reads TZ when it changes). */
function inZone<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (prev == null) delete process.env.TZ; else process.env.TZ = prev; }
}
const ZONES = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'UTC'];
const noHoliday = () => false;

describe('H02 — one time zone for the home date + time', () => {
  test('UTC evening: the India date is already the next day, whatever the browser zone', () => {
    // the audit's moment: 21:46 UTC on Thu 15 Oct = 03:16 IST on Fri 16 Oct
    const at = new Date('2026-10-15T21:46:00Z');
    for (const tz of ZONES) {
      const d = inZone(tz, () => homeDateTime(at));
      assert.equal(d.date, 'Friday, 16 October 2026', tz);
      assert.match(d.time, /^03:16\s?am$/i, tz);
      assert.equal(d.tz, 'IST'); assert.equal(d.ymd, '2026-10-16');
    }
  });
  test('month end and year end roll over on the India calendar', () => {
    const m = new Date('2026-10-31T19:00:00Z');   // 00:30 IST on 1 Nov
    const y = new Date('2026-12-31T18:45:00Z');   // 00:15 IST on 1 Jan 2027
    for (const tz of ZONES) {
      assert.equal(inZone(tz, () => homeDateTime(m)).date, 'Sunday, 1 November 2026', tz);
      assert.equal(inZone(tz, () => homeDateTime(y)).date, 'Friday, 1 January 2027', tz);
      assert.equal(inZone(tz, () => homeDateTime(y)).ymd, '2027-01-01', tz);
    }
    // one minute before India midnight is still 31 Dec
    assert.equal(homeDateTime(new Date('2026-12-31T18:29:00Z')).date, 'Thursday, 31 December 2026');
  });
  test('the home page no longer formats a date without a time zone; the strip labels the pair IST', () => {
    const home = read(HOME);
    assert.doesNotMatch(home, /now\.toLocaleDateString\('en-IN', \{ weekday: 'long'/);
    const strip = read('app/(dashboard)/_home/HomeStatusStrip.tsx');
    assert.match(strip, /homeDateTime\(now\)/);
    assert.match(strip, /\{dt\.date\} · \{dt\.time\} <span[^>]*>\{dt\.tz\}<\/span>/);
    assert.match(home, /<HomeStatusStrip now=\{now\} \/>/);
  });
});

describe('status strip — market sessions', () => {
  test('India: open in hours, closed at the weekend with the next session', () => {
    assert.equal(indiaSession(new Date('2026-10-16T04:30:00Z'), noHoliday).open, true);   // Fri 10:00 IST
    const pre = indiaSession(new Date('2026-10-16T02:00:00Z'), noHoliday);                // Fri 07:30 IST
    assert.equal(pre.open, false); assert.equal(pre.label, 'Closed · opens today 09:15 IST');
    const sat = indiaSession(new Date('2026-10-17T06:00:00Z'), noHoliday);
    assert.equal(sat.open, false); assert.equal(sat.label, 'Closed · opens Mon 19 Oct 09:15 IST');
    assert.equal(sat.nextOpenMs, Date.parse('2026-10-19T03:45:00Z'));
    const fri = indiaSession(new Date('2026-10-16T10:30:00Z'), noHoliday);                // Fri 16:00 IST
    assert.equal(fri.label, 'Closed · opens Mon 19 Oct 09:15 IST');
    const thuEve = indiaSession(new Date('2026-10-15T12:00:00Z'), noHoliday);             // Thu 17:30 IST
    assert.equal(thuEve.label, 'Closed · opens tomorrow 09:15 IST');
  });
  test('India: NSE holidays are skipped (20 Oct 2026 is one)', () => {
    const mon = indiaSession(new Date('2026-10-19T11:00:00Z'));                           // Mon 16:30 IST
    assert.equal(mon.label, 'Closed · opens Wed 21 Oct 09:15 IST');
    assert.equal(indiaSession(new Date('2026-10-20T05:00:00Z')).open, false, 'holiday morning');
  });
  test('India: year end', () => {
    const s = indiaSession(new Date('2026-12-31T12:00:00Z'), noHoliday);                  // Thu 31 Dec 17:30 IST
    assert.equal(s.label, 'Closed · opens tomorrow 09:15 IST');
    assert.equal(s.nextOpenMs, Date.parse('2027-01-01T03:45:00Z'));
  });
  test('US: open hours in New York time, with the India clock beside it; summer → winter time handled', () => {
    const open = usSession(new Date('2026-10-16T14:00:00Z'));                              // Fri 10:00 ET (summer)
    assert.equal(open.open, true); assert.equal(open.label, 'Open · closes 16:00 ET (01:30 IST)');
    const sat = usSession(new Date('2026-10-17T15:00:00Z'));
    assert.equal(sat.label, 'Closed · opens Mon 19 Oct 09:30 ET (19:00 IST)');
    assert.equal(sat.nextOpenMs, Date.parse('2026-10-19T13:30:00Z'));
    // clocks go back on 1 Nov 2026: Monday 2 Nov opens at 14:30 UTC
    const halloween = usSession(new Date('2026-10-31T15:00:00Z'));
    assert.equal(halloween.label, 'Closed · opens Mon 2 Nov 09:30 ET (20:00 IST)');
    assert.equal(halloween.nextOpenMs, Date.parse('2026-11-02T14:30:00Z'));
    const preOpen = usSession(new Date('2026-10-16T12:00:00Z'));                           // Fri 08:00 ET
    assert.equal(preOpen.label, 'Closed · opens today 09:30 ET (19:00 IST)');
    for (const tz of ZONES) assert.equal(inZone(tz, () => usSession(new Date('2026-10-17T15:00:00Z')).label), sat.label, tz);
    assert.match(sat.note, /holidays are not checked/);
  });
  test('data freshness summary', () => {
    const s = freshnessSummary(['fresh', 'fresh', 'amber', 'red', 'dim']);
    assert.equal(s.text, '2 fresh · 1 ageing · 1 stale · 1 unknown'); assert.equal(s.worst, 'red');
    assert.equal(freshnessSummary([]).text, 'not checked yet');
    assert.equal(freshnessSummary(['fresh']).worst, 'fresh');
  });
  test('the strip links unread alerts to /price-alerts and the freshness summary to the Data freshness row', () => {
    const strip = read('app/(dashboard)/_home/HomeStatusStrip.tsx');
    assert.match(strip, /<NavLink href="\/price-alerts" data-testid="home-alerts-unread"/);
    assert.match(strip, /\$\{ALERTS_API\}\?view=bell/);
    assert.match(strip, /href="#home-data-freshness"/);
    assert.match(read(HOME), /<LazyPanel id="home-data-freshness" minHeight=\{40\} label="Data freshness">/);
    assert.match(read('components/FreshnessStrip.tsx'), /export function localFreshnessChips\(\): Chip\[\]/);
  });
});

/** The chain of `<div …>` opening tags that encloses `pos` in a JSX source (comments and strings are rare here). */
function enclosingDivs(src: string, from: number, pos: number): string[] {
  const stack: string[] = [];
  const re = /<div\b[^>]*?(\/?)>|<\/div>/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) && m.index < pos) {
    if (m[0] === '</div>') stack.pop();
    else if (!m[1]) stack.push(m[0]);
  }
  return stack;
}

describe('H01 — lazy panels keep a full-width box', () => {
  test('wrapper box: full line in a block, grid or flex row; height reserved only while waiting', () => {
    const w = lazyPanelWrapperStyle('waiting', 220);
    assert.equal(w.width, '100%'); assert.equal(w.flex, '1 1 100%'); assert.equal(w.minWidth, 0); assert.equal(w.minHeight, 220);
    const m = lazyPanelWrapperStyle('mounted', 220);
    assert.equal(m.width, '100%'); assert.equal(m.minHeight, undefined);
    assert.equal(lazyPanelWrapperCss('waiting', 40), 'display:block;width:100%;flex:1 1 100%;min-width:0;max-width:100%;box-sizing:border-box;min-height:40px');
  });
  test('the three panels are direct children of the vertical main column, never of a wrapping row', () => {
    const home = read(HOME);
    const colAt = home.indexOf('<div data-home-section="main-column"');
    assert.ok(colAt > 0);
    assert.match(home.slice(colAt, colAt + 200), /flexDirection: 'column'/);
    for (const label of ['Daily Signal Inbox', 'Data freshness', 'Signal scoreboard and alerts']) {
      const at = home.indexOf(`label="${label}"`, colAt);
      assert.ok(at > colAt, label);
      const chain = enclosingDivs(home, colAt, at);
      assert.equal(chain.length, 1, `${label}: inside ${chain.length} divs — ${chain.slice(-1)[0]}`);
      assert.match(chain[0], /data-home-section="main-column"/, label);
    }
    // the old HEADER row (wrapping, baseline) that held them is gone
    assert.doesNotMatch(home, /\{\/\* HEADER \*\/\}\s*<div style=\{\{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap'/);
  });
  test('LazyPanel keeps the same wrapper element after mounting and mounts the panel once', async () => {
    const { default: LazyPanel } = await import('../../components/LazyPanel');
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
    const keys = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const prev = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
    Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, configurable: true, writable: true });
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const observers: Array<{ cb: (e: any[]) => void }> = [];
    (dom.window as any).IntersectionObserver = class { constructor(cb: any) { observers.push({ cb }); } observe() {} disconnect() {} unobserve() {} };
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      let mounts = 0;
      function Panel() { React.useEffect(() => { mounts++; }, []); return h('div', { id: 'p' }, 'x'); }
      await act(async () => { root.render(h(LazyPanel, { minHeight: 200, label: 'Inbox', id: 'lp', children: h(Panel) })); });
      const box = dom.window.document.getElementById('lp')!;
      assert.equal(box.getAttribute('data-lazy-panel'), 'waiting');
      assert.equal(box.style.width, '100%'); assert.equal(box.style.minHeight, '200px');
      await act(async () => { observers[0].cb([{ isIntersecting: true, intersectionRatio: 1 }]); });
      await act(async () => { observers[0]?.cb([{ isIntersecting: true, intersectionRatio: 1 }]); });
      const after = dom.window.document.getElementById('lp')!;
      assert.equal(after, box, 'the same wrapper element (no remount, stable observer target and size)');
      assert.equal(after.getAttribute('data-lazy-panel'), 'mounted');
      assert.equal(after.style.width, '100%');
      assert.ok(dom.window.document.getElementById('p'));
      assert.equal(mounts, 1, 'mounted exactly once');
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [k, d] of prev) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    }
  });
});

describe('Signal Inbox — 1 / 2 / 4 lanes, never 3 + 1', () => {
  test('columns by inbox width', () => {
    assert.equal(inboxLaneColumns(360), 1);
    assert.equal(inboxLaneColumns(INBOX_TWO_COLUMNS_FROM - 1), 1);
    assert.equal(inboxLaneColumns(INBOX_TWO_COLUMNS_FROM), 2);
    assert.equal(inboxLaneColumns(900), 2);
    assert.equal(inboxLaneColumns(INBOX_FOUR_COLUMNS_FROM), 4);
    assert.equal(inboxLaneColumns(1400), 4);
    assert.equal(inboxLaneColumns(NaN), 1);
    for (let w = 200; w <= 2000; w += 7) assert.notEqual(inboxLaneColumns(w) as number, 3);
  });
  test('the CSS uses the same breakpoints; the grid has no auto-fit', () => {
    const css = read('app/globals.css');
    assert.match(css, new RegExp(`@container mc-inbox \\(min-width: ${INBOX_TWO_COLUMNS_FROM}px\\) \\{ \\.mc-inbox-lanes \\{ grid-template-columns: repeat\\(2, minmax\\(0, 1fr\\)\\); \\} \\}`));
    assert.match(css, new RegExp(`@container mc-inbox \\(min-width: ${INBOX_FOUR_COLUMNS_FROM}px\\) \\{ \\.mc-inbox-lanes \\{ grid-template-columns: repeat\\(4, minmax\\(0, 1fr\\)\\); \\} \\}`));
    assert.match(css, /\.mc-inbox-wrap \{ container-type: inline-size; container-name: mc-inbox;/);
    const c = read('app/(dashboard)/_home/components.tsx');
    assert.match(c, /<div className="mc-inbox-wrap">\s*<div data-testid="inbox-lanes" className="mc-inbox-lanes"/);
    assert.doesNotMatch(c.slice(c.indexOf('data-testid="inbox-lanes"'), c.indexOf('data-testid="inbox-lanes"') + 200), /auto-fit/);
  });
});

describe('H03 — bulk home links never prefetch on view', () => {
  test('US movers uses NavLink, not next/link', () => {
    const s = read('app/(dashboard)/_home/UsMovers.tsx');
    assert.doesNotMatch(s, /from 'next\/link'/);
    assert.doesNotMatch(s, /<Link[\s>]/);
    assert.match(s, /import NavLink from '@\/components\/NavLink'/);
    assert.ok((s.match(/<NavLink\b/g) || []).length >= 2, 'ticker rows + Open');
  });
  test('the new home pieces use NavLink too', () => {
    for (const f of ['app/(dashboard)/_home/HomeStatusStrip.tsx', 'app/(dashboard)/_home/ToolsDrawer.tsx']) {
      assert.doesNotMatch(read(f), /from 'next\/link'/, f);
    }
  });
});

describe('All tools drawer + favourites', () => {
  test('tool search: case and emoji ignored, every word must match', () => {
    assert.equal(toolMatches('🧮 Stock Screener', 'stock'), true);
    assert.equal(toolMatches('🧮 Stock Screener', 'SCREENER stock'), true);
    assert.equal(toolMatches('🧮 Stock Screener', 'pine'), false);
    assert.equal(toolMatches('📊 PEAD Tracker', ''), true);
    assert.equal(toolMatches('🔬 Watchlist Fundamentals', 'watch fund'), true);
  });
  test('the A–Z chip strip sits in the closed drawer; no link was dropped', () => {
    const home = read(HOME);
    const a = home.indexOf('<ToolsDrawer>'), b = home.indexOf('</ToolsDrawer>');
    assert.ok(a > 0 && b > a);
    const inside = home.slice(a, b);
    assert.ok((inside.match(/<NavLink\b/g) || []).length >= 49, 'the A–Z tool links are inside (49 at zzz1065)');
    for (const href of ['/system-health', '/critical-themes', '/watchlists', '/screener-sync', '/tax-planner']) assert.ok(inside.includes(`href="${href}"`), href);
    const d = read('app/(dashboard)/_home/ToolsDrawer.tsx');
    assert.match(d, /hidden=\{!open\}/);
    assert.match(d, /aria-expanded=\{open\}/);
    assert.match(d, /type="search"/);
  });
  test('ToolsDrawer: closed by default, typing opens it and hides the links that do not match', async () => {
    const { ToolsDrawer } = await import('../../app/(dashboard)/_home/ToolsDrawer');
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
    const keys = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const prev = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
    for (const [k, v] of [['window', dom.window], ['document', dom.window.document], ['navigator', dom.window.navigator], ['HTMLElement', dom.window.HTMLElement], ['Node', dom.window.Node], ['localStorage', dom.window.localStorage]] as const) {
      Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => { root.render(h(ToolsDrawer, null, h('div', null, h('a', { href: '/a' }, '🧮 Stock Screener'), h('a', { href: '/b' }, '🧾 Tax Planner'), h('a', { href: '/c' }, '🧩 Pine Screener')))); });
      const doc = dom.window.document;
      const list = doc.getElementById('home-all-tools')!;
      assert.equal(list.hidden, true, 'closed by default');
      const btn = doc.querySelector('button[aria-controls="home-all-tools"]')!;
      assert.match(btn.textContent || '', /All tools \(3\)/);
      const input = doc.querySelector('input[type="search"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => { setter.call(input, 'screener'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
      assert.equal(list.hidden, false, 'typing opens it');
      const visible = Array.from(list.querySelectorAll('a')).filter((x) => (x as HTMLElement).style.display !== 'none').map((x) => x.textContent);
      assert.deepEqual(visible, ['🧮 Stock Screener', '🧩 Pine Screener']);
      assert.match(btn.textContent || '', /2 of 3/);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [k, d] of prev) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    }
  });
  test('favourites order helpers keep the zzz791 merge rule', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 2, -5), ['c', 'a', 'b'], 'clamped to the front');
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 99), ['b', 'c', 'a'], 'clamped to the end');
    assert.deepEqual(moveItem(['a', 'b'], 5, 0), ['a', 'b'], 'unknown index: unchanged');
    const defaults = ['/charts', '/stock-screener', '/portfolio', '/us-portfolio-book', '/news'];
    assert.deepEqual(mergeFavOrder(['/news', '/portfolio', '/gone'], defaults), ['/charts', '/stock-screener', '/news', '/portfolio', '/us-portfolio-book']);
    assert.deepEqual(mergeFavOrder(null, defaults), defaults);
    assert.deepEqual(mergeFavOrder(['/news', '/news'], ['/news']), ['/news']);
  });
  test('a favourite is a plain link; reordering only through the separate handle (drag, keys, long-press, ◀ ▶)', () => {
    const home = read(HOME);
    const g = home.slice(home.indexOf('function FavouritesGrid()'));
    assert.match(g, /<NavLink key=\{f\.href\} className="mc-chip-hover" href=\{f\.href\} style=\{st\} draggable=\{false\}>/);
    assert.match(g, /<a key=\{f\.href\} className="mc-chip-hover" href=\{f\.href\} target="_blank" rel="noopener noreferrer" style=\{st\} draggable=\{false\}>/);
    assert.match(g, /aria-pressed=\{arranging\}/, 'Arrange switch');
    assert.match(g, /className="mc-fav-handle" draggable/);
    assert.match(g, /k === 'ArrowLeft' \|\| k === 'ArrowUp' \? i - 1 : k === 'ArrowRight' \|\| k === 'ArrowDown' \? i \+ 1 : k === 'Home' \? 0 : k === 'End'/);
    assert.match(g, /e\.pointerType === 'touch' && picked == null/);
    assert.match(g, /setTimeout\(\(\) => \{[\s\S]{0,120}setPicked\(i\)[\s\S]{0,400}\}, FAV_LONG_PRESS_MS\)/);
    assert.match(g, /aria-label=\{`Move \$\{label\(i\)\} earlier`\}/);
    assert.match(g, /aria-label=\{`Move \$\{label\(i\)\} later`\}/);
    assert.match(g, /aria-live="polite"/);
    assert.match(g, /mergeFavOrder\(JSON\.parse\(localStorage\.getItem\(FAV_ORDER_KEY\)/);
    assert.ok(FAV_LONG_PRESS_MS >= 300 && FAV_LONG_PRESS_MS <= 800);
    assert.match(home, /const FAV_ORDER_KEY = 'mc:favs:order:v1';/, 'saved order key unchanged');
  });
  // zzz1082 — Favourites moved up to right under In-Play News (owner request); the rest keeps its order.
  test('home order: status strip → Favourites → Next actions → Signal Inbox → hero → All tools', () => {
    const home = read(HOME);
    const at = (s: string) => { const i = home.indexOf(s); assert.ok(i > 0, s); return i; };
    const seq = ['<HomeStatusStrip now={now} />', '<FavouritesGrid />', '<NextBestActions />', 'label="Daily Signal Inbox"', '<CockpitHero />', '<RiskRegimeCard />', '<PipelineHealth />', 'label="Data freshness"', 'label="Signal scoreboard and alerts"', '<ToolsDrawer>'];
    for (let i = 1; i < seq.length; i++) assert.ok(at(seq[i - 1]) < at(seq[i]), `${seq[i - 1]} before ${seq[i]}`);
  });
});

describe('mobile', () => {
  test('home: 16 px gutter, no sideways scroll, 40 px taps and 14 px text in the new pieces', () => {
    const css = read('app/globals.css');
    const z = css.slice(css.indexOf('zzz1065 — home on a phone'));
    assert.match(css, /\.mc-home-root \{ overflow-x: clip; \}/);
    assert.match(z, /\.mc-home-root \{ padding: 12px 16px !important; \}/);
    assert.match(z, /\.mc-home-status > \* \{ min-height: 40px; font-size: 14px !important;/);
    assert.match(z, /\.mc-fav-grid > \.mc-fav-item > button \{ min-width: 40px !important; min-height: 40px !important; \}/);
    assert.match(z, /\.mc-tools-grid > a \{[^}]*min-height: 44px; font-size: 14px !important;/);
    assert.match(read(HOME), /<div className="mc-home-root" style=/);
  });
  test('phone Menu has a filter box; the bell stays visible and tappable on phones', async () => {
    const { filterMenuGroups } = await import('../home-tools');
    const groups = [
      { id: 'a', label: 'Markets', items: [{ href: '/movers', label: 'Movers', icon: null }, { href: '/fii-dii', label: 'FII / DII Flows', icon: null }] },
      { id: 'b', label: 'Alerts', items: [{ href: '/price-alerts', label: 'Price alerts', icon: null }] },
    ];
    assert.equal(filterMenuGroups(groups, ''), groups);
    assert.deepEqual(filterMenuGroups(groups, 'fii').map((g) => g.items.map((i) => i.href)), [['/fii-dii']]);
    assert.deepEqual(filterMenuGroups(groups, 'alerts').map((g) => g.id), ['b'], 'group name matches too');
    assert.deepEqual(filterMenuGroups(groups, 'zzz'), []);
    const nav = read('components/pwa/MobileNav.tsx');
    assert.match(nav, /aria-label="Find a page in the menu"/);
    assert.match(nav, /\{menuGroups\.map\(\(g\) => \(/);
    const pwa = read('components/pwa/pwa.module.css');
    const z = pwa.slice(pwa.indexOf('zzz1065 — the price-alerts bell'));
    assert.match(z, /\.chips > div:has\(> button\[aria-label\^="Price alerts"\]\) \{ order: -1; margin-left: auto; flex-shrink: 0; \}/);
    assert.match(z, /min-width: 40px; min-height: 40px;/);
    assert.match(read('components/alerts/AlertBell.tsx'), /aria-label=\{unread \? `Price alerts: \$\{unread\} unread` : 'Price alerts'\}/, 'the selector matches the bell');
  });
});
