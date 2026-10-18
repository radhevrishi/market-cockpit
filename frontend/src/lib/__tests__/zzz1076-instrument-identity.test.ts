// zzz1076 (B01) — retest 18 Oct 2026: NSE:HAL (Hindustan Aeronautics) and NYSE:HAL (Halliburton) must stay two companies
// through compare, copy both ways and quote lookup. A bare symbol never gets India by guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeStore, type WlStore } from '../chart-watchlist';
import { compareWithChartList, planCopyToStandalone, planCopyToChart } from '../watchlist-compare';
import { parseListSymbol, listSymbolOf, resolveListQuote } from '../instrument-id';

const chart = (items: any[]): WlStore => sanitizeStore({ activeId: 'L', lists: [{ id: 'L', name: 'My Watchlist', sections: [{ id: 'S', name: '', items }] }] });

test('the retest reproduction: NSE:HAL vs a NYSE:HAL chart row are different, and copying keeps the market', () => {
  const s = chart([{ m: 'US', x: 'NYSE', t: 'HAL' }]);
  const r = compareWithChartList(['NSE:HAL'], s.lists[0]);
  assert.deepEqual(r.both, []);
  assert.deepEqual(r.onlyStandalone, ['NSE:HAL']);
  assert.deepEqual(r.onlyChart.map((x) => x.symbol), ['US:HAL']);
  const copied = planCopyToStandalone(r.onlyChart);
  assert.deepEqual(copied, ['US:HAL'], 'the USA row keeps its market in the plain list');
  const back = planCopyToChart(chart([]), 'L', copied, () => undefined);
  const items = back.store.lists[0].sections[0].items;
  assert.deepEqual(items.map((i) => `${i.m}:${i.t}`), ['US:HAL'], 'and comes back as the USA company, not India');
});

test('a bare name: matched by its quote market; quoted in both markets → "market unclear", never matched or copied', () => {
  const s = chart([{ m: 'US', t: 'HAL' }, { m: 'IN', t: 'INFY' }]);
  const inByQuote = compareWithChartList(['HAL', 'INFY'], s.lists[0], (t) => (t === 'HAL' ? 'IN' : 'IN'));
  assert.deepEqual(inByQuote.both, ['INFY']);
  assert.deepEqual(inByQuote.onlyStandalone, ['HAL'], 'HAL priced in India is not the chart list’s USA HAL');
  const unclear = compareWithChartList(['HAL'], s.lists[0], () => undefined);
  assert.deepEqual(unclear.unresolved.map((u) => u.symbol), ['HAL']);
  assert.equal(unclear.both.length, 0);
  assert.equal(unclear.onlyChart.find((x) => x.item.t === 'HAL')?.copyable, false, 'the USA HAL is not copied next to an unclear HAL');
  const skip = planCopyToChart(chart([]), 'L', ['HAL'], () => undefined);
  assert.equal(skip.added.length, 0);
  assert.match(skip.skipped[0].reason, /NSE:HAL or US:HAL/);
});

test('NSE / BSE same symbol stay apart; BSE codes and prefixes parse to the right market', () => {
  const s = chart([{ m: 'IN', x: 'BSE', t: 'ZZSAME' }]);
  const r = compareWithChartList(['NSE:ZZSAME'], s.lists[0]);
  assert.deepEqual(r.both, []);
  assert.equal(r.onlyChart[0].copyable, false, 'a BSE letter listing cannot be written to the plain list');
  assert.deepEqual(parseListSymbol('532067'), { m: 'IN', x: 'BSE', t: '532067' });
  assert.deepEqual(parseListSymbol('nyse:hal'), { m: 'US', x: 'NYSE', t: 'HAL' });
  assert.deepEqual(parseListSymbol('US:HAL'), { m: 'US', t: 'HAL' });
  assert.deepEqual(parseListSymbol('HAL'), { m: null, t: 'HAL' });
  assert.deepEqual(parseListSymbol('TCS.NS'), { m: 'IN', x: 'NSE', t: 'TCS' });
  assert.equal(listSymbolOf({ m: 'IN', x: 'BSE', t: 'RELIANCE' }), null);
  assert.equal(listSymbolOf({ m: 'IN', x: 'BSE', t: '500325' }), '500325');
});

test('quote lookup by market: US:HAL takes the USA quote; bare HAL in both → India shown, flagged ambiguous', () => {
  const quotes = [{ ticker: 'HAL', market: 'IN' as const, price: 4500 }, { ticker: 'HAL', market: 'US' as const, price: 31 }];
  const n = (x: string) => x.toUpperCase();
  assert.equal(resolveListQuote('US:HAL', quotes, n).quote?.price, 31);
  assert.equal(resolveListQuote('NSE:HAL', quotes, n).quote?.price, 4500);
  const bare = resolveListQuote('HAL', quotes, n);
  assert.equal(bare.quote?.price, 4500); assert.equal(bare.ambiguous, true); assert.equal(bare.market, undefined);
  const onlyUs = resolveListQuote('NVDA', [{ ticker: 'NVDA', market: 'US' as const }], n);
  assert.equal(onlyUs.market, 'US'); assert.equal(onlyUs.ambiguous, false);
});

test('the page: quotes by instrument, US prefixes kept on add, chart links without the prefix, unclear marker', () => {
  const page = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'watchlists', 'page.tsx'), 'utf8');
  assert.match(page, /resolveListQuote\(ticker, quotes, normalize\)/);
  assert.match(page, /replace\(\/\^\(NYSE\|NASDAQ\|AMEX\|ARCA\|US\):\/, 'US:'\)/);
  assert.doesNotMatch(page, /quotes\.find\(q => normalize\(q\.ticker\) === norm\)/);
  const comp = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'watchlists', 'components.tsx'), 'utf8');
  assert.match(comp, /India or USA\?/);
  const panel = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'watchlists', 'ComparePanel.tsx'), 'utf8');
  assert.match(panel, /compareWithChartList\(tickers, list, marketOf\)/);
  assert.match(panel, /Market unclear/);
});
