// zzz1045d — /watchlists vs chart lists: source labels, compare preview + copy plans, quote time vs last refreshed, no-quote
// names, traded value, changes since last review. Made-up tickers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { sanitizeStore, listCount, type WlStore } from '../chart-watchlist';
import { chartListSource, standaloneSource, compareWithChartList, planCopyToStandalone, planCopyToChart, defaultCompareListId, compareKey } from '../watchlist-compare';
import {
  quoteTimeOf, quoteTimeSummary, unresolvedSymbols, tradedValue, formatTradedValue,
  buildReview, changesSinceReview, parseReview, DEFAULT_REVIEW_THRESHOLD, REVIEW_KEY,
} from '../watchlist-review';
import { WatchlistMutationQueue } from '../watchlist-sync';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const h = React.createElement;

function storeOf(): WlStore {
  return sanitizeStore({
    activeId: 'L1',
    lists: [
      { id: 'L1', name: 'My Watchlist', sections: [
        { id: 'S1', name: '', items: [{ m: 'IN', t: 'ZZALPHA', flag: 'red' }, { m: 'IN', t: 'ZZBRAVO' }, { m: 'IN', t: 'ZZBSEONE', x: 'BSE' }, { m: 'IN', t: '599001', x: 'BSE' }] },
        { id: 'S2', name: 'Ideas', items: [{ m: 'US', t: 'ZZUS' }, { m: 'IN', t: 'ZZDELTA' }] },
        { id: 'SB', name: 'India Portfolio', book: 'IN', items: [{ m: 'IN', t: 'ZZHELD' }] },
      ] },
      { id: 'L2', name: 'Telegram picks', sections: [{ id: 'T1', name: '', items: [{ m: 'IN', t: 'ZZALPHA' }] }] },
      { id: 'L3', name: 'All book', sections: [{ id: 'B1', name: 'USA Portfolio', book: 'US', items: [] }] },
    ],
  });
}

// ── sources ──
test('chart list sources: linked to My Book / not the Telegram list / plain chart list', () => {
  const s = storeOf();
  assert.equal(chartListSource(s.lists[0]).kind, 'book');
  assert.match(chartListSource(s.lists[0]).label, /linked to My Book \(India\)/);
  assert.equal(chartListSource(s.lists[1]).kind, 'telegram-name');
  assert.match(chartListSource(s.lists[1]).detail, /Telegram bot reads the list on the Watchlists page/);
  const plain = sanitizeStore({ lists: [{ id: 'P', name: 'Swing', sections: [{ id: 'x', name: '', items: [] }] }] }).lists[0];
  assert.equal(chartListSource(plain).kind, 'chart');
});

test('standalone source line: server + saved time; browser copy says why', () => {
  const a = standaloneSource({ readFrom: 'server', savedAt: Date.parse('2026-10-15T09:41:00Z'), readAt: Date.parse('2026-10-15T09:00:00Z') }, fmt);
  assert.equal(a.label, 'Source: your server watchlist · saved 09:41');
  assert.match(a.detail, /Telegram bot/);
  assert.equal(standaloneSource({ readFrom: 'server', readAt: Date.parse('2026-10-15T09:00:00Z') }, fmt).label, 'Source: your server watchlist · read 09:00');
  assert.match(standaloneSource({ readFrom: 'browser-copy', reason: 'network' }, fmt).label, /this browser's copy \(the server list could not be read\)/);
  assert.match(standaloneSource({ readFrom: 'browser-copy', reason: 'no-record' }, fmt).label, /no saved list yet/);
});

// ── compare ──
test('compare: only here / only in chart list / both; book sections left out; order kept; BSE identity kept', () => {
  const s = storeOf();
  const standalone = ['ZZCHARLIE', 'ZZALPHA', 'NSE:ZZBRAVO', 'ZZBSEONE', 'ZZHELD'];
  const r = compareWithChartList(standalone, s.lists[0]);
  assert.deepEqual(r.both, ['ZZALPHA', 'NSE:ZZBRAVO']);
  // ZZBSEONE here is an NSE symbol; the chart row is BSE:ZZBSEONE — not the same listing, never merged
  // ZZHELD is only in the My Book section, which is not compared
  assert.deepEqual(r.onlyStandalone, ['ZZCHARLIE', 'ZZBSEONE', 'ZZHELD']);
  assert.deepEqual(r.onlyChart.map((x) => x.symbol), ['BSE:ZZBSEONE', 'BSE:599001', 'US:ZZUS', 'ZZDELTA']);   // zzz1076: a USA row shows its market
  assert.equal(r.bookSectionsLeftOut, 1);
  assert.equal(r.onlyChart[0].copyable, false, 'a BSE letter symbol is not copied (it would become the NSE one)');
  assert.equal(r.onlyChart[1].copyable, true, 'a BSE number code is copied as the code');
  assert.deepEqual(planCopyToStandalone(r.onlyChart), ['599001', 'US:ZZUS', 'ZZDELTA']);   // zzz1076 (B01): a USA row keeps its market
  assert.equal(compareKey('zzalpha.NS'), 'ZZALPHA');
});

test('copy to chart: into the last section that is not linked to My Book; flags, order and the book section untouched', () => {
  const s = storeOf();
  const before = JSON.stringify(s.lists[0].sections.find((x) => x.book));
  // zzz1076 (B01): the market comes from the quote (or a prefix); an unknown market is skipped, never assumed India
  const r = planCopyToChart(s, 'L1', ['ZZCHARLIE', 'ZZNEWUS', 'ZZALPHA', 'bad symbol!', 'ZZNOQUOTE'], (t) => (t === 'ZZNEWUS' ? 'US' : t === 'ZZNOQUOTE' ? undefined : 'IN'));
  assert.deepEqual(r.added, ['ZZCHARLIE', 'US:ZZNEWUS']);
  assert.deepEqual(r.skipped.map((x) => x.symbol), ['ZZALPHA', 'bad symbol!', 'ZZNOQUOTE']);
  assert.match(r.skipped[2].reason, /market not known/);
  assert.equal(r.sectionName, 'Ideas');
  const l = r.store.lists.find((x) => x.id === 'L1')!;
  assert.deepEqual(l.sections[1].items.map((i) => `${i.m}:${i.t}`), ['US:ZZUS', 'IN:ZZDELTA', 'IN:ZZCHARLIE', 'US:ZZNEWUS']);
  assert.equal(l.sections[0].items[0].flag, 'red');
  assert.equal(JSON.stringify(l.sections.find((x) => x.book)), before, 'the My Book section is never written');
  assert.equal(r.store.lists[1], s.lists[1], 'other lists are the same objects');
  // a list whose only section is linked to My Book gets nothing
  const none = planCopyToChart(s, 'L3', ['ZZCHARLIE'], () => 'IN');
  assert.equal(none.added.length, 0); assert.equal(none.store, s);
  assert.match(none.skipped[0].reason, /linked to My Book/);
  assert.equal(listCount(s.lists[0]), 7, 'the input store is not changed');
});

test('default compare list: the one named My Watchlist', () => {
  const s = storeOf();
  assert.equal(defaultCompareListId({ ...s, lists: [s.lists[1], s.lists[0]] }), 'L1');
});

// ── quote time / no quote / traded value ──
test('quote time: a timed quote, the last NSE close, no time given, no quote (never 0)', () => {
  assert.deepEqual(quoteTimeOf({ price: 101, quoteTime: '2026-10-15T09:41:00Z', priceSource: 'yahoo' }, fmt).label, '09:41');
  assert.equal(quoteTimeOf({ price: 101, staleEOD: true, priceSource: 'nse-bhavcopy' }, fmt).kind, 'last-close');
  assert.equal(quoteTimeOf({ price: 101 }, fmt).label, 'time not given');
  assert.equal(quoteTimeOf({ price: null }, fmt).label, 'no quote');
  assert.equal(quoteTimeOf({ price: 0 }, fmt).kind, 'none');
  const times = [
    quoteTimeOf({ price: 1, quoteTime: '2026-10-15T09:30:00Z' }, fmt), quoteTimeOf({ price: 1, quoteTime: '2026-10-15T09:41:00Z' }, fmt),
    quoteTimeOf({ price: 1, staleEOD: true }, fmt), quoteTimeOf({ price: null }, fmt),
  ];
  assert.equal(quoteTimeSummary(times, fmt), 'Quote time: quotes from 09:30 to 09:41, 1 at last close, 1 with no quote');
  assert.deepEqual(unresolvedSymbols([{ ticker: 'ZZOLD', price: null }, { ticker: 'ZZA', price: 5 }, { ticker: 'ZZZERO', price: 0 }]), ['ZZOLD', 'ZZZERO']);
});

test('traded value: price × volume of the same quote; unknown stays unknown', () => {
  assert.equal(tradedValue(250, 400_000), 100_000_000);
  assert.equal(tradedValue(null, 400_000), null);
  assert.equal(tradedValue(250, 0), null);
  assert.equal(formatTradedValue(100_000_000, 'IN'), '₹10.00 Cr');
  assert.equal(formatTradedValue(2_500_000_000, 'IN'), '₹250 Cr');
  assert.equal(formatTradedValue(42_000_000, 'US'), '$42.0M');
  assert.equal(formatTradedValue(null, 'IN'), '—');
});

// ── review ──
test('changes since last review: moved ≥ X% either way; added later / no quote now are not counted', () => {
  const snap = buildReview([{ ticker: 'ZZA', price: 100 }, { ticker: 'ZZB', price: 200 }, { ticker: 'ZZC', price: 50 }, { ticker: 'ZZN', price: null }], 1000);
  assert.deepEqual(snap, { at: 1000, prices: { ZZA: 100, ZZB: 200, ZZC: 50 } });
  const now = [{ ticker: 'ZZA', price: 106 }, { ticker: 'ZZB', price: 190 }, { ticker: 'ZZC', price: null }, { ticker: 'ZZNEW', price: 10 }];
  const d = changesSinceReview(now, snap);
  assert.equal(DEFAULT_REVIEW_THRESHOLD, 5);
  assert.deepEqual(Object.keys(d.changed), ['ZZA', 'ZZB']);
  assert.equal(Math.round(d.changed.ZZB.pct), -5);
  assert.deepEqual(d.notReviewed, ['ZZNEW']);
  assert.deepEqual(d.noQuote, ['ZZC']);
  assert.deepEqual(Object.keys(changesSinceReview(now, snap, 10).changed), []);
  assert.deepEqual(changesSinceReview(now, null).changed, {});
  // stored copy: bad JSON / bad prices are dropped
  assert.equal(parseReview('{not json'), null);
  assert.deepEqual(parseReview(JSON.stringify({ at: 5, prices: { ZZA: 1, ZZB: 'x', ZZC: -2 } })), { at: 5, prices: { ZZA: 1 } });
  assert.equal(REVIEW_KEY, 'mc:watchlist-review:v1');
});

test('list queue records when the server last confirmed a save', async () => {
  let t = 111;
  const q = new WatchlistMutationQueue({ send: async () => ({ ok: true }), now: () => t });
  assert.equal(q.snapshot().savedAt, null);
  q.reset(['ZZA']);
  assert.equal(q.snapshot().savedAt, null, 'reading the list is not a save');
  t = 222; q.enqueue('add', ['ZZB']); await q.idle();
  assert.equal(q.snapshot().savedAt, 222);
  const bad = new WatchlistMutationQueue({ send: async () => ({ ok: false, error: 'HTTP 500' }) });
  bad.enqueue('add', ['ZZB']); await bad.idle();
  assert.equal(bad.snapshot().savedAt, null);
});

// ── table: no quote, quote time, traded value column, flag / review markers ──
test('table: "no quote" (never 0), quote time column, traded value column, flag edge + review tag', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/watchlists', pretendToBeVisual: true });
  const names = ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent'];
  const previous = new Map([...names, 'IS_REACT_ACT_ENVIRONMENT'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of names) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  try {
    localStorage.setItem('mc:watchlist:cols:v1', JSON.stringify(['tradedValue']));
    const { WatchlistTable } = await import('../../app/(dashboard)/watchlists/components');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.getElementById('root')!);
    const items: any[] = [
      { ticker: 'ZZLIVE', company: 'Live Co', sector: 'X', price: 250, change: 2, changePercent: 0.8, dayHigh: null, dayLow: null, market: 'IN', quoteTime: '2026-10-15T09:41:00Z', priceSource: 'yahoo', tradedValue: 100_000_000, flag: '🟢', reviewPct: 7.25 },
      { ticker: 'ZZOLD', company: 'ZZOLD', sector: '—', price: null, change: null, changePercent: null, dayHigh: null, dayLow: null, tradedValue: null },
    ];
    await act(async () => { root.render(h(WatchlistTable, { items, sortField: 'ticker', sortOrder: 'asc', onSort: () => {}, onRemove: () => {} })); });
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const old = rows.find((r) => r.getAttribute('data-watchlist-ticker') === 'ZZOLD')!;
    assert.match(old.textContent!, /no quote/);
    assert.doesNotMatch(old.textContent!, /₹0/);
    const live = rows.find((r) => r.getAttribute('data-watchlist-ticker') === 'ZZLIVE')!;
    assert.equal(live.getAttribute('data-flag'), 'green');
    assert.equal(live.getAttribute('data-review'), 'up');
    assert.match(live.textContent!, /\+7\.3% since review/);
    assert.match(live.textContent!, /₹10\.00 Cr/);
    assert.ok(Array.from(document.querySelectorAll('th')).some((t) => t.textContent === 'Quote time'));
    assert.ok(Array.from(document.querySelectorAll('th')).some((t) => t.textContent!.startsWith('Traded value (price × volume)')));
    await act(async () => root.unmount());
  } finally {
    dom.window.close();
    for (const [key, d] of previous) { if (d) Object.defineProperty(globalThis, key, d); else delete (globalThis as any)[key]; }
  }
});

// ── wiring: preview only, copies on click; chart panel labels each list ──
test('wiring: /watchlists shows the source, compares on request, copies only on a click; chart panel labels list sources', () => {
  const page = read('app/(dashboard)/watchlists/page.tsx');
  const panel = read('app/(dashboard)/watchlists/ComparePanel.tsx');
  const chart = read('components/charts/WatchlistPanel.tsx');
  assert.match(page, /data-testid="watchlist-source"/);
  assert.match(page, /Compare with chart lists…/);
  assert.match(page, /\{compareOpen && \(/, 'the compare preview is shown only when asked for');
  assert.match(page, /data-testid="watchlist-unresolved"/);
  assert.match(page, /Mark reviewed/);
  assert.match(page, /Last refreshed/); assert.match(page, /quoteSummary/);
  // the chart store is written only inside the copy button's handler
  const writes = panel.split('localStorage.setItem').length - 1;
  assert.equal(writes, 1);
  assert.match(panel, /const copyToChart = \(\) => \{[\s\S]*localStorage\.setItem\(CHART_WATCHLISTS_KEY/);
  assert.match(panel, /onClick=\{copyToChart\}/); assert.match(panel, /onClick=\{copyToStandalone\}/);
  assert.doesNotMatch(panel + page, /mc_portfolio_holdings['"]?,\s*JSON/, 'holdings are never written');
  assert.doesNotMatch(page, /^export (?!default)/m, 'the page file has no named exports');
  assert.match(chart, /chartListSource\(l\)\.label/); assert.match(chart, /data-testid="watchlist-source"/);
});
