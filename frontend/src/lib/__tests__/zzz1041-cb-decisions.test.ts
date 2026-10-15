// zzz1041 — owner: "give one option in Conviction Beats where I mark each name Bought, Rejected, Watchlist. Rejected ones
// should not show me in Conviction Beats when the preset is on." Marks are decision-logbook rows (per symbol + market),
// synced by the user vault. Synthetic tickers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

// a tiny localStorage + window for the logbook functions
function withStore<T>(fn: () => T): T {
  const mem = new Map<string, string>();
  const events: string[] = [];
  const g = globalThis as any;
  const oldW = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldL = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const ls = { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); } };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: { localStorage: ls, dispatchEvent: (e: any) => { events.push(e.type); return true; }, addEventListener() {}, removeEventListener() {} }, configurable: true, writable: true });
  if (typeof g.CustomEvent === 'undefined') g.CustomEvent = class { type: string; constructor(t: string) { this.type = t; } };
  try { return fn(); } finally {
    if (oldW) Object.defineProperty(globalThis, 'window', oldW); else delete g.window;
    if (oldL) Object.defineProperty(globalThis, 'localStorage', oldL); else delete g.localStorage;
  }
}

test('marking and clearing, per market — India and US never collide', async () => {
  const dec = await import('../decisions');
  const cb = await import('../cb-decisions');
  withStore(() => {
    cb.setCbMark('ZZDUAL', 'IN', 'bought', { company: 'Dual India Ltd' });
    cb.setCbMark('ZZDUAL', 'US', 'rejected', { company: 'Dual Inc', price: 12.5 });
    const map = dec.readDecisions();
    assert.equal(map.ZZDUAL.status, 'BUY');
    assert.equal(map.ZZDUAL.market, 'IN');
    assert.equal(map['US:ZZDUAL'].status, 'REJECTED');
    assert.equal(map['US:ZZDUAL'].priceAtDecision, 12.5);
    assert.equal(cb.readCbMark('ZZDUAL', 'IN').mark, 'bought');
    assert.equal(cb.readCbMark('ZZDUAL', 'US').mark, 'rejected');
    // archived US quarter key and exchange prefixes resolve to the same mark
    assert.equal(cb.readCbMark('ZZDUAL@Q2-2026', 'US').mark, 'rejected');
    assert.equal(cb.readCbMark('NSE:ZZDUAL', 'IN').mark, 'bought');
    // clicking the active option clears it; the other market is untouched
    cb.toggleCbMark('ZZDUAL', 'US', 'rejected');
    assert.equal(cb.readCbMark('ZZDUAL', 'US').mark, null);
    assert.equal(cb.readCbMark('ZZDUAL', 'IN').mark, 'bought');
    // switching keeps the note, re-stamps the status
    cb.setCbMarkNote('ZZDUAL', 'IN', 'margin story intact');
    cb.toggleCbMark('ZZDUAL', 'IN', 'watchlist');
    assert.equal(dec.readDecisions().ZZDUAL.status, 'WATCH');
    assert.equal(dec.readDecisions().ZZDUAL.reason, 'margin story intact');
    cb.setCbMark('ZZDUAL', 'IN', null);
    assert.equal(dec.readDecisions().ZZDUAL, undefined);
  });
});

test('a legacy US decision under the plain symbol is found for US, not India, and is moved on an India write', async () => {
  const dec = await import('../decisions');
  const cb = await import('../cb-decisions');
  withStore(() => {
    localStorage.setItem('mc:decisions:v1', JSON.stringify({ ZZOLD: { symbol: 'ZZOLD', market: 'US', status: 'WATCH', reason: 'old', date: '2026-01-02T00:00:00Z' } }));
    assert.equal(cb.readCbMark('ZZOLD', 'US').mark, 'watchlist');
    assert.equal(cb.readCbMark('ZZOLD', 'IN').mark, null);
    cb.setCbMark('ZZOLD', 'IN', 'rejected');
    const m = dec.readDecisions();
    assert.equal(m.ZZOLD.market, 'IN');
    assert.equal(m['US:ZZOLD'].status, 'WATCH', 'the US decision survives under its US key');
    // legacy callers without a market still read the plain key
    assert.equal(dec.getDecision('ZZOLD')?.status, 'REJECTED');
    dec.clearDecision('ZZOLD', 'US');
    assert.equal(dec.readDecisions()['US:ZZOLD'], undefined);
    assert.equal(dec.readDecisions().ZZOLD.status, 'REJECTED');
  });
});

test('preset ON hides Rejected from the list, the counts and the exports; "show" brings them back greyed, still not exported', async () => {
  const { applyCbMarks } = await import('../cb-decisions');
  const rows = ['A', 'B', 'C', 'D'];
  const marks: Record<string, any> = { A: 'bought', B: 'rejected', C: 'watchlist', D: null };
  const markOf = (t: string) => marks[t];
  const on = applyCbMarks(rows, { markOf, presetOn: true, showRejected: false, filter: 'all' });
  assert.deepEqual(on.visible, ['A', 'C', 'D']);
  assert.deepEqual(on.exportRows, ['A', 'C', 'D']);
  assert.deepEqual(on.rejectedHidden, ['B']);
  assert.deepEqual(on.counts, { all: 3, bought: 1, watchlist: 1, rejected: 1, unmarked: 1 });
  const shown = applyCbMarks(rows, { markOf, presetOn: true, showRejected: true, filter: 'all' });
  assert.deepEqual(shown.visible, ['A', 'B', 'C', 'D']);
  assert.deepEqual(shown.exportRows, ['A', 'C', 'D'], 'shown greyed, never exported while the preset is on');
  assert.equal(shown.rejectedHidden.length, 0);
});

test('preset OFF shows Rejected (greyed by the page) and exports what is shown', async () => {
  const { applyCbMarks } = await import('../cb-decisions');
  const markOf = (t: string) => (t === 'B' ? 'rejected' : null) as any;
  const off = applyCbMarks(['A', 'B'], { markOf, presetOn: false, showRejected: false, filter: 'all' });
  assert.deepEqual(off.visible, ['A', 'B']);
  assert.deepEqual(off.exportRows, ['A', 'B']);
  assert.equal(off.rejectedHidden.length, 0);
  assert.equal(off.counts.all, 2);
});

test('mark chips: All · Bought · Watchlist · Rejected · Unmarked narrow AND-wise', async () => {
  const { applyCbMarks, CB_MARK_FILTERS, CB_MARK_FILTER_LABEL } = await import('../cb-decisions');
  assert.deepEqual(CB_MARK_FILTERS.map((f) => CB_MARK_FILTER_LABEL[f]), ['All', 'Bought', 'Watchlist', 'Rejected', 'Unmarked']);
  const rows = ['A', 'B', 'C', 'D', 'E'];
  const marks: Record<string, any> = { A: 'bought', B: 'rejected', C: 'watchlist', D: null, E: 'bought' };
  const run = (filter: any, presetOn = true) => applyCbMarks(rows, { markOf: (t) => marks[t], presetOn, showRejected: false, filter }).visible;
  assert.deepEqual(run('bought'), ['A', 'E']);
  assert.deepEqual(run('watchlist'), ['C']);
  assert.deepEqual(run('unmarked'), ['D']);
  assert.deepEqual(run('rejected'), ['B'], 'choosing Rejected shows them even with the preset on');
  assert.deepEqual(applyCbMarks(rows, { markOf: (t) => marks[t], presetOn: true, showRejected: false, filter: 'rejected' }).exportRows, [], 'never exported with the preset on');
  assert.deepEqual(run('rejected', false), ['B']);
});

test('stamp and wording', async () => {
  const { cbMarkStamp, CB_MARK_META, rejectedHiddenLine, markOfDecision } = await import('../cb-decisions');
  const y = new Date().getFullYear();
  assert.equal(cbMarkStamp({ date: `${y}-10-15T09:00:00Z`, priceAtDecision: 1234 }, 'IN'), 'marked 15 Oct · at ₹1,234');
  assert.equal(cbMarkStamp({ date: `${y}-10-15T09:00:00Z`, priceAtDecision: 12.3 }, 'US'), 'marked 15 Oct · at $12.30');
  assert.equal(cbMarkStamp({ date: `${y}-10-15T09:00:00Z` }, 'IN'), 'marked 15 Oct');
  assert.deepEqual(Object.values(CB_MARK_META).map((m) => m.label), ['Bought', 'Watchlist', 'Rejected']);
  assert.deepEqual(Object.values(CB_MARK_META).map((m) => m.status), ['BUY', 'WATCH', 'REJECTED']);
  assert.equal(markOfDecision({ status: 'NEUTRAL' }), null);
  assert.equal(rejectedHiddenLine(3, false), '3 rejected hidden · show');
  const ui = read('components/CbMarkControl.tsx');
  assert.doesNotMatch(ui, /\b(Buy|Sell|BUY|SELL)\b/);
  assert.doesNotMatch(ui, /\bbest\b/i);
  for (const m of Object.values(CB_MARK_META)) { assert.doesNotMatch(`${m.label} ${m.hint}`, /\b(Buy|Sell|BUY|SELL)\b/); }
});

test('the vault syncs the logbook key, so marks follow the owner across devices', async () => {
  const { USER_STATE_KEYS_CLIENT } = await import('../user-vault-keys');
  assert.ok((USER_STATE_KEYS_CLIENT as readonly string[]).includes('mc:decisions:v1'));
});

test('snapshot: the tab leaves Rejected out under the preset and Portfolio Catalysts says why (not a mismatch)', async () => {
  const { reconcileCbLists } = await import('../india-cb-view');
  const r = reconcileCbLists({ tickers: ['ZZA'], rejected: ['ZZB'], savedCriteria: true, at: '2026-10-15T09:00:00Z' }, ['ZZA', 'ZZB'], () => ({ state: 'pass', text: 'passes' }));
  assert.deepEqual(r.onlyPc, []);
  assert.deepEqual(r.markedRejected, ['ZZB']);
  assert.match(r.line, /^Matches the Conviction Beats tab name for name: 1 names/);
  assert.match(r.line, /1 you marked Rejected is listed here but hidden on the tab/);
  // the panel writes the rejected list only while the preset is on
  const panel = read('app/(dashboard)/watchlists/ConvictionBeatsPanel.tsx');
  assert.match(panel, /const isRej = \(e: ConvictionEntry\) => presetOn && markReader\(e\.ticker\)\.mark === 'rejected'/);
  assert.match(panel, /writeCbTabSnapshot\(\{ tickers, savedCriteria: filtersMatchSaved\(filters, readCbPresetOptOut\(\)\), rejected,/);
});

test('both pages: exports carry the marked list, cards and tables carry the control', () => {
  const panel = read('app/(dashboard)/watchlists/ConvictionBeatsPanel.tsx');
  assert.match(panel, /const list = exportEntries;/);                                  // Excel
  assert.match(panel, /const allTickers = exportEntries\.map/);                         // CSV / .txt / TradingView
  assert.match(panel, /tickers: exportBlockbusters\.map/);
  assert.match(panel, /<CbMarkFilterRow value=\{markFilter\}/);
  assert.match(panel, /<CbRejectedToggle/);
  assert.equal((panel.match(/markSlot=\{markSlotFor\(e\)\}/g) || []).length, 4);
  assert.match(panel, /renderMark=\{\(e\) => markSlotFor\(e, 'row'\)\}/);
  const table = read('app/(dashboard)/watchlists/ConvictionTable.tsx');
  assert.match(table, /\{markBadge\}\s*<TierPill/);
  assert.match(table, /renderMark && <td/);
  const us = read('app/(dashboard)/us-conviction-beats/page.tsx');
  assert.match(us, /const body = exportRows\.map/);
  assert.match(us, /const tickers = exportRows\.map/);
  assert.match(us, /const _fresh = exportRows\.filter/);
  assert.match(us, /<CbMarkFilterRow value=\{markFilter\}/);
  assert.match(us, /footer=\{mark \? \(\s*<CbMarkControl ticker=\{e\.ticker\} market="US"/);
  assert.match(us, /variant="row"/);
  // the size-hidden list is computed before the mark layer (a rejected name is not "hidden by size")
  assert.match(us, /const shown = new Set\(filteredPre\.map/);
  // no new buy / sell words in the lines this change added
  for (const src of [panel, us, table]) {
    for (const line of src.split('\n').filter((l) => /CbMark|markRes|markFilter|exportRows|exportEntries|markSlot/.test(l))) {
      assert.doesNotMatch(line, /\b(Buy|Sell|BUY|SELL)\b/, line);
    }
  }
});

// ── mounted: the control and the rule together, as the panel wires them ──────────────────────────────
async function withDom<T>(fn: (h: { React: any; act: any; root: any; settle: () => Promise<void> }) => Promise<T>) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/watchlists', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'MouseEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'MouseEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ stocks: [{ ticker: 'ZZA', price: 1234 }] }) });
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 30));
  try { return await fn({ React, act, root, settle }); } finally {
    await act(async () => { root.unmount(); });
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
}

test('mounted: mark, note, clear, keyboard; preset on hides Rejected with "N rejected hidden · show"', async () => {
  await withDom(async ({ React, act, root, settle }) => {
    const { CbMarkControl, CbMarkBadge, CbMarkFilterRow, CbRejectedToggle, useDecisionsMap } = await import('../../components/CbMarkControl');
    const { applyCbMarks, cbMarkReader } = await import('../cb-decisions');
    const NAMES = ['ZZA', 'ZZB', 'ZZC'];
    let lastVisible: string[] = []; let lastExport: string[] = [];
    let setPreset!: (v: boolean) => void;
    function Harness() {
      const map = useDecisionsMap();
      const reader = cbMarkReader(map, 'IN');
      const [presetOn, sp] = React.useState(true); setPreset = sp;
      const [filter, setFilter] = React.useState('all');
      const [show, setShow] = React.useState(false);
      const res = applyCbMarks(NAMES, { markOf: (t: string) => reader(t).mark, presetOn, showRejected: show, filter: filter as any });
      lastVisible = res.visible; lastExport = res.exportRows;
      return React.createElement('div', null,
        React.createElement(CbMarkFilterRow, { value: filter as any, onChange: setFilter, counts: res.counts, presetOn }),
        React.createElement(CbRejectedToggle, { count: show ? res.rejectedTotal : res.rejectedHidden.length, showing: show, onToggle: () => setShow((v: boolean) => !v) }),
        ...res.visible.map((t) => React.createElement('div', { key: t, 'data-row': t, 'data-dim': reader(t).mark === 'rejected' ? '1' : '0' },
          React.createElement(CbMarkBadge, { mark: reader(t).mark }),
          React.createElement(CbMarkControl, { ticker: t, market: 'IN', mark: reader(t).mark, decision: reader(t).decision }))));
    }
    await act(async () => { root.render(React.createElement(Harness)); await settle(); });
    const ctl = (t: string) => document.querySelector(`[data-row="${t}"] [data-testid="cb-mark"]`) as HTMLElement;
    const opt = (t: string, m: string) => ctl(t).querySelector(`[data-testid="cb-mark-${m}"]`) as HTMLButtonElement;
    assert.equal(lastVisible.length, 3);
    assert.equal(ctl('ZZA').querySelector('[role="radiogroup"]')!.getAttribute('aria-label'), 'Your mark for ZZA');
    assert.deepEqual(Array.from(ctl('ZZA').querySelectorAll('[role="radio"]')).map((b) => b.textContent), ['Bought', 'Watchlist', 'Rejected']);

    // Bought → badge + stamp; India price looked up once after marking
    await act(async () => { opt('ZZA', 'bought').click(); await settle(); await settle(); });
    assert.equal(opt('ZZA', 'bought').getAttribute('aria-checked'), 'true');
    assert.ok(document.querySelector('[data-row="ZZA"] [data-testid="cb-mark-badge-bought"]'));
    assert.match(ctl('ZZA').querySelector('[data-testid="cb-mark-stamp"]')!.textContent || '', /^marked \d{1,2} \w{3} · at ₹1,234/);

    // note via ✎: Enter saves
    await act(async () => { (ctl('ZZA').querySelector('[data-testid="cb-mark-note-edit"]') as HTMLElement).click(); await settle(); });
    const input = ctl('ZZA').querySelector('[data-testid="cb-mark-note-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor((window as any).HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'orders strong'); input.dispatchEvent(new (window as any).Event('input', { bubbles: true }));
      await settle();
    });
    await act(async () => { input.dispatchEvent(new (window as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(); });
    const { readDecisions } = await import('../decisions');
    assert.equal(readDecisions().ZZA.reason, 'orders strong');
    assert.match(ctl('ZZA').textContent || '', /orders strong/);

    // keyboard: arrow moves focus within the group
    await act(async () => { opt('ZZB', 'bought').focus(); opt('ZZB', 'bought').dispatchEvent(new (window as any).KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle(); });
    assert.equal(document.activeElement, opt('ZZB', 'watchlist'));

    // Rejected with the preset on → hidden, counted out, not exported, with the "show" line
    await act(async () => { opt('ZZB', 'rejected').click(); await settle(); });
    assert.deepEqual(lastVisible, ['ZZA', 'ZZC']);
    assert.deepEqual(lastExport, ['ZZA', 'ZZC']);
    const tog = () => document.querySelector('[data-testid="cb-rejected-toggle"]') as HTMLElement;
    assert.equal(tog().textContent, '1 rejected hidden · show');
    assert.match(document.querySelector('[data-testid="cb-mark-filter-all"]')!.textContent || '', /All \(2\)/);
    await act(async () => { tog().click(); await settle(); });
    assert.deepEqual(lastVisible, ['ZZA', 'ZZB', 'ZZC']);
    assert.equal(document.querySelector('[data-row="ZZB"]')!.getAttribute('data-dim'), '1');
    assert.deepEqual(lastExport, ['ZZA', 'ZZC']);
    await act(async () => { tog().click(); await settle(); });

    // preset off → shown greyed with the Rejected badge, exported
    await act(async () => { setPreset(false); await settle(); });
    assert.deepEqual(lastVisible, ['ZZA', 'ZZB', 'ZZC']);
    assert.ok(document.querySelector('[data-row="ZZB"] [data-testid="cb-mark-badge-rejected"]'));
    assert.equal(document.querySelector('[data-row="ZZB"]')!.getAttribute('data-dim'), '1');
    assert.deepEqual(lastExport, ['ZZA', 'ZZB', 'ZZC']);

    // chip: Bought only, then Unmarked
    await act(async () => { (document.querySelector('[data-testid="cb-mark-filter-bought"]') as HTMLElement).click(); await settle(); });
    assert.deepEqual(lastVisible, ['ZZA']);
    await act(async () => { (document.querySelector('[data-testid="cb-mark-filter-unmarked"]') as HTMLElement).click(); await settle(); });
    assert.deepEqual(lastVisible, ['ZZC']);
    await act(async () => { (document.querySelector('[data-testid="cb-mark-filter-all"]') as HTMLElement).click(); await settle(); });

    // clicking the active option clears the mark
    await act(async () => { opt('ZZA', 'bought').click(); await settle(); });
    assert.equal(readDecisions().ZZA, undefined);
    assert.equal(opt('ZZA', 'bought').getAttribute('aria-checked'), 'false');
  });
});
