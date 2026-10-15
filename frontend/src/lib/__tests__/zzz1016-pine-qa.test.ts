// zzz1016 — PINE SCREENER QA PASS (live US + India snapshots, every built-in screen, card, workflow, timeframe / stage / scope /
// Rule of 40 combination, sort, export, keyboard). Regressions for the bugs found:
//   1. a setup card's number was counted on EVERY company while the page was limited to "My portfolio" (Breakouts 301 → click → 0);
//      — and (coordinator decision) carry-over applies only to what the OWNER chose: a list a screen / workflow set (the portfolio
//      screens' "My portfolio") and a Rule of 40 screen's own ≥ 40 are not carried to the next screen; cards / workflows count on the
//      list and Rule of 40 their click WILL use;
//   2. the Conviction Beats list was called "N US companies" although the bench is not split by market;
//   3. sorting by a text column put rows without a value (no pattern / no sector) first;
//   5. a breakout "holding above the pivot" on a completed (e.g. monthly) close while the latest quote is back below it read as current;
//   4. portfolio check: a missing TheWrap stage fell back to the Weinstein stage under the TheWrap label; the Close of today's
//      unfinished session was not marked provisional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATTERN_META, type PatternId } from '../chart-patterns';
import { leanRows, PATTERN_SCAN_VERSION, type ScreenPatternTag } from '../screener/pine';
import { setupCounts, scopeAfterScreen, scopePicked, r40AfterScreen, r40WasUser, conditionState } from '../screener/pine-view';
import type { PatTf } from '../screener/filters';
import type { ScreenRow } from '../screener/types';

const T = (id: PatternId, s: 'f' | 'b' | 'x', c: number, d: number): ScreenPatternTag => ({ id, b: PATTERN_META[id].bias === 'bullish' ? 'U' : 'D', s, c, p: 100, d });
const cur = (tf: PatTf, px = 100) => ({ st: 'ready', v: PATTERN_SCAN_VERSION, px, asOf: tf === 'M' ? '2026-09-30' : tf === 'W' ? '2026-10-09' : '2026-10-12', ...(tf !== 'D' ? { tf } : {}) });
const row = (t: string, pat: ScreenPatternTag[], extra: Record<string, unknown> = {}) => ({
  t, n: `${t} Inc`, px: 100, patAt: '2026-10-12', pat, patW: [], patM: [], scan: cur('D'), scanW: cur('W'), scanM: cur('M'), scanPx: 100, scanAt: '2026-10-12', twSt: 2, ...extra,
});
const ROWS = [
  row('BO1', [T('flat_base', 'b', 70, 2)], { rsR: 90, cc: { px: 99 }, scanAt: '2026-10-13' }),
  row('BO2', [T('cup', 'b', 70, 3)], { rsR: 90, tvSec: 'Finance' }),
  row('BO3', [T('vcp', 'b', 70, 1)]),
  row('RDY', [T('flat_base', 'f', 70, -2)], { twSt: undefined, stage: 3 }),
  row('DN', [T('double_top', 'f', 60, 3)]),
  row('NP1', [], { rsR: 90, tvSec: 'Utilities' }),
];
const HOLD = ['BO1', 'RDY', 'DN'];

test('zzz1016 scopeAfterScreen: a list picked by hand carries; a list a screen set does not (back to the one picked by hand)', () => {
  // the owner picked a watchlist; a portfolio screen sets "My portfolio"
  let st = scopeAfterScreen(scopePicked('wl:a'), 'pf');
  assert.deepEqual(st, { scope: 'pf', origin: 'preset', user: 'wl:a' });
  st = scopeAfterScreen(st, 'pf');   // a second portfolio screen
  assert.deepEqual(st, { scope: 'pf', origin: 'preset', user: 'wl:a' });
  st = scopeAfterScreen(st, undefined);   // a screen without its own list: back to the owner's watchlist
  assert.deepEqual(st, { scope: 'wl:a', origin: 'user', user: 'wl:a' });
  assert.deepEqual(scopeAfterScreen(st, undefined), st, 'a list picked by hand carries over');
  assert.deepEqual(scopeAfterScreen(scopeAfterScreen(scopePicked(''), 'pf'), undefined).scope, '', 'default: every company');
  assert.deepEqual(scopeAfterScreen(scopePicked('pf'), undefined), scopePicked('pf'), 'My portfolio picked by hand is kept');
});

test('zzz1016 Rule of 40: a value the owner set carries; a Rule of 40 screen\'s own value does not', () => {
  assert.deepEqual(r40AfterScreen({ r40Min: 40 }, true), { r40Min: 40 });
  assert.deepEqual(r40AfterScreen({ r40Min: 40 }, false), { r40Min: null });
  assert.equal(r40WasUser('tv-rule-of-40', { r40Min: 40 }), false, 'the screen\'s own ≥ 40');
  assert.equal(r40WasUser('tv-rule-of-40', { r40Min: 60 }), true, 'changed by the owner');
  assert.equal(r40WasUser('all-bullish', { r40Min: 40 }), true);
  assert.equal(r40WasUser('all-bullish', { r40Min: null }), false);
});

test('zzz1016 condition chip: a close-based "holding" whose latest quote is back through the level says so', () => {
  const tag = { id: 'triple_bottom', b: 'U', s: 'b', c: 98, p: 300.8, d: 7, tf: 'M' } as ScreenPatternTag;
  const row = { t: 'MEDICAMEQ', px: 295.85, pxAt: '2026-10-14', scanM: { st: 'ready', v: PATTERN_SCAN_VERSION, px: 321.75, asOf: '2026-09-30', tf: 'M' } } as any;
  const c = conditionState(row, tag, new Date('2026-10-14T12:00:00Z'));
  assert.equal(c.id, 'holding');
  assert.equal(c.label, 'Holding above pivot (close 30 Sep) · quote back below');
  assert.equal(c.quoteBack, true); assert.equal(c.tone, 'warn');
  assert.match(c.tip, /295\.85 \(2026-10-14\) is 1\.65% back below the pivot/);
  // the quote still above: unchanged
  const ok = conditionState({ ...row, px: 330 }, tag, new Date('2026-10-14T12:00:00Z'));
  assert.equal(ok.label, 'Holding above pivot'); assert.equal(ok.quoteBack, undefined);
  // bearish mirror
  const bt = { id: 'double_top', b: 'D', s: 'b', c: 70, p: 100, d: -6, tf: 'W' } as ScreenPatternTag;
  const br = { t: 'X', px: 104, scanW: { st: 'ready', v: PATTERN_SCAN_VERSION, px: 94, asOf: '2026-10-09', tf: 'W' } } as any;
  assert.equal(conditionState(br, bt, new Date('2026-10-14T12:00:00Z')).label, 'Holding below level (close 9 Oct) · quote back above');
});

test('zzz1016 setupCounts on a list counts only that list (the page passes the current list, "My portfolio" included)', () => {
  const rows = leanRows(ROWS as unknown as ScreenRow[]).rows as unknown as ScreenRow[];
  const all = setupCounts(rows, 'US', null, HOLD, new Date('2026-10-13T12:00:00Z'));
  const pf = setupCounts(rows, 'US', new Set(HOLD), HOLD, new Date('2026-10-13T12:00:00Z'));
  assert.equal(all.breakouts, 3);
  assert.equal(pf.breakouts, 1);
  assert.equal(pf.ready, 1);
  assert.equal(pf.portfolio, 3);
});

// ── the page (JSDOM) ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function withPage(fn: (h: { click: (el: Element | null | undefined) => Promise<void>; select: (label: string, v: string) => Promise<void>; text: () => string; settle: () => Promise<void> }) => Promise<void>) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/pine-screener?market=US', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  (dom.window as any).confirm = () => true;
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  (globalThis as any).fetch = async (u: string) => ({
    ok: true, status: 200,
    json: async () => (u.includes('detail=') ? { ok: true, geometry: { D: [], W: [], M: [], L: [] } }
      : u.includes('/api/v1/pine-screener') ? { ok: true, builtAt: '2026-10-13T12:00:00Z', ...leanRows(ROWS as unknown as ScreenRow[]), notes: [] }
      : u.includes('/api/v1/us-book') ? { ok: true, universe: HOLD.map((ticker) => ({ ticker, origin: 'book', listing: 'US' })) }
      : { ok: true }),
  });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 30));
  const click = async (el: Element | null | undefined) => { assert.ok(el, 'element'); await act(async () => { (el as HTMLElement).click(); await settle(); }); };
  const select = async (label: string, v: string) => {
    const el = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    assert.ok(el, label);
    await act(async () => { Object.getOwnPropertyDescriptor((dom.window as any).HTMLSelectElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new (dom.window as any).Event('change', { bubbles: true })); await settle(); });
  };
  try {
    try { localStorage.setItem('mc:pine-details:v1', '1'); } catch { /* no DOM */ }   // zzz1033 — coverage / count lines behind ⓘ Details
    const { default: PineScreener } = await import('../../components/pine-screener/PineScreener');
    await act(async () => { root.render(React.createElement(PineScreener)); await settle(); await settle(); });
    await fn({ click, select, text: () => document.body.textContent || '', settle });
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise<void>((r) => setTimeout(r, 3000));
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
}
const cardCount = (id: string) => document.querySelector(`[data-card="${id}"] .pnx-card-count`)!.textContent;
const flowCount = (id: string) => document.querySelector(`[data-flow="${id}"] [data-flow-count]`)!.textContent;
const listed = () => Array.from(document.querySelectorAll('tbody tr a[data-ticker]')).map((a) => a.textContent);
const query = () => document.querySelector('[data-testid="active-query"]')!.textContent || '';
const companies = () => (document.querySelector('select[aria-label="Limit to a list"]') as HTMLSelectElement).value;

test('zzz1016 page (JSDOM): card numbers = what a click lists, on My portfolio and after a portfolio workflow; a list / Rule of 40 set by a screen is not carried, the owner\'s own is', async () => {
  await withPage(async ({ click, select }) => {
    assert.equal(cardCount('breakouts'), '3');
    // 1. limited to My portfolio: the cards count the holdings only, and a click lists exactly that
    await select('Limit to a list', 'pf');
    assert.equal(cardCount('breakouts'), '1', 'was 3 (every company) while the click listed 1');
    await click(document.querySelector('[data-card="breakouts"]'));
    assert.deepEqual(listed(), ['BO1']);
    assert.equal(cardCount('ready'), '1');
    await click(document.querySelector('[data-card="ready"]'));
    assert.deepEqual(listed(), ['RDY']);
    assert.equal(companies(), 'pf', 'a list the owner picked stays');
    // 2. a portfolio workflow sets "My portfolio" itself: not carried — the next card goes back to the list picked by hand (every
    //    company), and the card says so beforehand
    await select('Limit to a list', '');
    await click(document.querySelector('[data-flow="pf-risks"]'));
    assert.equal(companies(), 'pf');
    assert.deepEqual(listed(), ['DN']);
    assert.equal(cardCount('breakouts'), '3', 'the card counts the list its click will show');
    assert.equal(flowCount('bo-holding'), '3');
    await click(document.querySelector('[data-card="breakouts"]'));
    assert.equal(companies(), '', 'back to every company');
    assert.deepEqual(listed().sort(), ['BO1', 'BO2', 'BO3']);
    // the same through the screen menu
    await select('Pine screens', 'pf-bullish-opps');
    assert.equal(companies(), 'pf');
    await select('Pine screens', 'all-bullish');
    assert.equal(companies(), '');
    // a list picked by hand keeps carrying over
    await select('Limit to a list', 'pf');
    await select('Pine screens', 'breakouts-today');
    assert.equal(companies(), 'pf');
    assert.deepEqual(listed(), ['BO1']);
    await select('Limit to a list', '');
    // 3. Rule of 40: a Rule of 40 screen's own ≥ 40 does not stay on; a level the owner sets does
    await select('Pine screens', 'tv-rule-of-40');
    assert.match(query(), /Rule of 40 ≥ 40/);
    await select('Pine screens', 'rs-80');
    assert.doesNotMatch(query(), /Rule of 40/);
    await click(Array.from(document.querySelectorAll('[aria-label="Rule of 40"] button')).find((b) => b.textContent === '≥ 60'));
    assert.match(query(), /Rule of 40 ≥ 60/);
    await select('Pine screens', 'breakouts-today');
    assert.match(query(), /Rule of 40 ≥ 60/, 'the owner\'s own level travels');
    await select('Pine screens', 'all-bullish');
    assert.match(query(), /Rule of 40 ≥ 60/, 'and keeps travelling');
  });
});

test('zzz1016 page (JSDOM): rows without a value sort last on a text column, both ways; portfolio check stage / close provenance', async () => {
  await withPage(async ({ click, select }) => {
    await select('Pine screens', 'rs-80');
    assert.deepEqual(listed().sort(), ['BO1', 'BO2', 'NP1']);
    const sortBy = async (label: string) => click(document.querySelector(`button[aria-label="Sort by ${label}"]`));
    await sortBy('Setup');
    assert.equal(listed()[2], 'NP1', 'no pattern: last ascending');
    await sortBy('Setup');
    assert.equal(listed()[2], 'NP1', 'no pattern: last descending too');
    await sortBy('Sector');
    assert.equal(listed()[2], 'BO1', 'no sector: last');
    await sortBy('Sector');
    assert.equal(listed()[2], 'BO1');
    // the detail row spans exactly the table's columns (it spanned one too many)
    await click(document.querySelector('button[aria-label="Details for BO1"]'));
    assert.equal(Number(document.querySelector('tr.pnx-detail td')!.getAttribute('colspan')), document.querySelectorAll('thead th').length);
    // the portfolio check: TheWrap stage, the Weinstein stage said as such when TheWrap is missing, the provisional close marked
    await click(document.querySelector('[data-card="portfolio"]'));
    const cell = (t: string, sel: string) => document.querySelector(`tr[data-holding="${t}"] ${sel}`) as HTMLElement;
    assert.equal(cell('BO1', '[data-stage-method]').getAttribute('data-stage-method'), 'thewrap');
    assert.equal(cell('RDY', '[data-stage-method]').getAttribute('data-stage-method'), 'weinstein');
    assert.match(cell('RDY', '[data-stage-method]').textContent || '', /Topping 3 W/);
    assert.match(cell('RDY', '[data-stage-method]').getAttribute('title') || '', /Weinstein stage 3/);
    assert.equal(cell('BO1', '[data-close-session]').getAttribute('data-close-session'), 'provisional');
    assert.match(cell('BO1', '[data-close-session]').textContent || '', /◷/);
    assert.equal(cell('RDY', '[data-close-session]').getAttribute('data-close-session'), 'completed');
  });
});
