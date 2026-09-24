// zzz795 — Theme Rotation inputs: ticker sanitising, classification (India
// "Unclassified" fix), catalyst classification from filings and news, list /
// holdings handling, the honest "best-supported" ranking, and table sorting
// and filtering on every column.
// Run: npx tsx --test src/lib/__tests__/zzz795-theme-inputs.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeTicker, classifyFiling, classifyNews, dedupeCatalysts, membershipFrom, themesForTicker, printsByTheme, catalystsByTheme } from '../theme-rotation/evidence-inputs';
import { classifyTheme, classifyThemeDetailed, cleanTicker } from '../theme-classify';
import { buildListEntries, bestSupported, holdingsExposure, listOrder, gradeRank } from '../theme-rotation/lists';
import { sortViews, filterViews, emptyFilter, defaultDir, type SortKey } from '../theme-rotation/table';
import { buildViewModel } from '../theme-rotation/view-model';
import type { Payload, ThemeRow } from '../theme-rotation/types';

describe('tickers', () => {
  test('period tags, exchange prefixes and suffixes are stripped', () => {
    assert.equal(sanitizeTicker('SUDARSCHEM@Q1-2027'), 'SUDARSCHEM');
    assert.equal(sanitizeTicker('NSE:RELIANCE'), 'RELIANCE');
    assert.equal(sanitizeTicker('tcs.ns'), 'TCS');
    assert.equal(sanitizeTicker('M&M'), 'M&M');
    assert.equal(sanitizeTicker('BRK.B'), 'BRK.B');
    assert.equal(sanitizeTicker('BAJAJ-AUTO'), 'BAJAJ-AUTO');
    assert.equal(sanitizeTicker('543193'), '543193');
    assert.equal(sanitizeTicker(''), '');
    assert.equal(sanitizeTicker('not a ticker!'), '');
    assert.equal(cleanTicker('SUDARSCHEM@Q1-2027'), 'SUDARSCHEM');
  });
});

describe('classification — fewer India names left unclassified', () => {
  test('the bad bench key classifies through its clean ticker', () => {
    assert.deepEqual(classifyThemeDetailed(null, null, 'india', 'SUDARSCHEM@Q1-2027'), { theme: 'in-chemicals', via: 'ticker' });
  });
  test('company name is the last rung, and is marked as such', () => {
    assert.deepEqual(classifyThemeDetailed('', null, 'india', 'XYZ', 'Shree Ganesh Remedies Ltd'), { theme: 'in-pharma', via: 'name' });
    assert.equal(classifyThemeDetailed('', null, 'india', 'ABC', 'Kopran Spinning Mills')?.theme, 'in-commodities');
    assert.equal(classifyThemeDetailed('', null, 'india', 'TEXRAIL', null)?.theme, 'in-railways');
  });
  test('industry beats the name; ambiguous names are not guessed', () => {
    assert.deepEqual(classifyThemeDetailed(null, 'Specialty Chemicals', 'india', 'ZZZ', 'Some Pharma Ltd'), { theme: 'in-chemicals', via: 'industry' });
    assert.equal(classifyThemeDetailed('', null, 'india', 'MTARTECH', 'MTAR Technologies Ltd'), null);
    assert.equal(classifyThemeDetailed('', null, 'india', 'GREENPANEL', null), null);
    assert.equal(classifyThemeDetailed('', null, 'india', 'POLYCAB', null), null);
  });
  test('vocabulary fixes: consumer electronics → EMS, agri inputs → chemicals, oil comma form', () => {
    assert.equal(classifyTheme(null, 'Consumer Electronics', 'india'), 'in-ems');
    assert.equal(classifyTheme(null, 'Agricultural Inputs', 'india'), 'in-chemicals');
    assert.equal(classifyTheme('Oil, Gas & Consumable Fuels', null, 'india'), 'in-energy');
    assert.equal(classifyTheme(null, 'Utilities—Renewable', 'india'), 'in-renewables');
  });
  test('the US path is unchanged and has no name guessing', () => {
    assert.equal(classifyTheme('IT', null, 'us', 'SNOW'), 'us-software');
    assert.equal(classifyTheme(null, null, 'us', 'ZZZZ', 'Acme Chemicals'), null);
    assert.equal(classifyTheme(null, null, 'us', 'MU'), 'us-memory');
  });
});

describe('catalysts — only material, dated, linked items', () => {
  const d = '2026-09-20T10:00:00Z';
  test('filings: orders, capacity, rating direction, USFDA', () => {
    assert.equal(classifyFiling({ symbol: 'KEC', subject: 'Bagging/Receiving of orders/contracts', filing_type: 'ORDER_RECEIPT', filing_datetime: d, attachment_urls: ['https://nse/x.pdf'] })?.kind, 'order');
    assert.equal(classifyFiling({ symbol: 'KEC', subject: 'Receipt of order worth Rs 1,200 crore', filing_datetime: d })?.url, null);
    assert.equal(classifyFiling({ symbol: 'ABC', subject: 'Credit Rating - Upgrade', filing_type: 'RATING_ACTION', filing_datetime: d })?.kind, 'rating-up');
    assert.equal(classifyFiling({ symbol: 'ABC', subject: 'CRISIL downgrades long-term rating', filing_type: 'RATING_ACTION', filing_datetime: d })?.tone, 'neg');
    assert.equal(classifyFiling({ symbol: 'ABC', subject: 'Credit Rating', filing_type: 'RATING_ACTION', filing_datetime: d }), null, 'direction unknown → dropped');
    assert.equal(classifyFiling({ symbol: 'SUN', subject: 'USFDA issues Form 483 with 3 observations', filing_type: 'USFDA_EVENT', filing_datetime: d })?.kind, 'regulatory-negative');
    assert.equal(classifyFiling({ symbol: 'X', subject: 'Transcript of earnings call', filing_type: 'TRANSCRIPT', filing_datetime: d }), null);
    assert.equal(classifyFiling({ symbol: 'X@Q1-2027', subject: 'Receipt of order', filing_type: 'ORDER_RECEIPT', filing_datetime: 'bad' }), null);
  });
  test('news: guidance, ratings, orders; sector stories and noise dropped', () => {
    const one = (title: string, tickers = ['NVDA']) => classifyNews({ title, ticker_symbols: tickers, published_at: d, url: 'https://n/1' })[0];
    assert.equal(one('Nvidia raises full-year revenue guidance')?.kind, 'guidance-up');
    assert.equal(one('Micron cuts outlook on weak NAND pricing')?.kind, 'guidance-down');
    assert.equal(one('Analyst upgrades AMD to Buy')?.kind, 'rating-up');
    assert.equal(one('Lockheed wins $2 billion Army contract')?.kind, 'order');
    assert.equal(one('Stocks drift ahead of Fed decision'), undefined);
    assert.equal(one('Chip stocks rally as Nvidia raises guidance', ['NVDA', 'AMD', 'AVGO', 'MU']), undefined);
  });
  test('dedupe: same ticker, kind and day — the filing wins', () => {
    const a = { ticker: 'KEC', kind: 'order' as const, tone: 'pos' as const, title: 'Receipt of order', date: '2026-09-20T09:00:00Z', url: 'f', source: 'filing' as const };
    const b = { ...a, title: 'KEC International bags order', date: '2026-09-20T12:00:00Z', url: 'n', source: 'news' as const };
    const out = dedupeCatalysts([b, a]);
    assert.equal(out.length, 1); assert.equal(out[0].source, 'filing');
  });
  test('membership: declared constituents first, classifier otherwise; many themes allowed', () => {
    const m = membershipFrom({ 'us-semis': ['NVDA', 'AMD'], 'us-ai-hardware': ['NVDA'], 'in-it': ['TCS.NS'] });
    assert.deepEqual(themesForTicker('NVDA', m, null).sort(), ['us-ai-hardware', 'us-semis']);
    assert.deepEqual(themesForTicker('TCS', m, 'x'), ['in-it']);
    assert.deepEqual(themesForTicker('ZZZ', m, 'us-software'), ['us-software']);
    assert.deepEqual(themesForTicker('ZZZ', m, null), []);
    const pb = printsByTheme([{ ticker: 'NVDA', tier: 'STRONG', filingDate: '2026-08-27' }, { ticker: 'NVDA', tier: 'STRONG', filingDate: '2026-08-27' }], (p) => themesForTicker(p.ticker, m, null));
    assert.equal(pb['us-semis'].length, 1, 'duplicate prints collapse');
    const cb = catalystsByTheme([{ ticker: 'AMD', kind: 'order', tone: 'pos', title: 't', date: '2026-09-01', source: 'news' }], (t) => themesForTicker(t, m, null));
    assert.deepEqual(Object.keys(cb), ['us-semis']);
  });
});

describe('lists vs holdings — honest labels', () => {
  const classify = (e: any) => (e.ticker === 'NVDA' || e.ticker === 'AMD' ? { theme: 'us-semis', via: 'override' as const } : e.ticker === 'XOM' ? { theme: 'us-energy', via: 'sector' as const } : null);
  const entries = buildListEntries(
    [{ symbol: 'NVDA' }, { symbol: 'SPY' }, { symbol: 'ZZZZ' }],
    [{ symbol: 'AMD', grade: 'A' }],
    [{ ticker: 'XOM', tier: 'STRONG', filing_date: '2026-08-01', pe: 14 }, { ticker: 'NVDA', tier: 'BLOCKBUSTER', filing_date: '2026-08-27' }],
    new Set(['XOM', 'KO']), classify,
  );
  test('index funds are dropped; holdings not on any list still appear', () => {
    assert.ok(!entries.some((e) => e.ticker === 'SPY'));
    assert.ok(entries.some((e) => e.ticker === 'KO' && e.held));
  });
  test('holdings exposure counts only held names', () => {
    const h = holdingsExposure(entries, new Set(['us-semis']), new Set(['us-energy']), new Set());
    assert.equal(h.total, 2); assert.deepEqual(h.atRisk, ['XOM']); assert.deepEqual(h.favoured, []);
    assert.match(h.line, /1 not matched to a theme/);
    assert.equal(holdingsExposure(entries.map((e) => ({ ...e, held: false })), new Set(), new Set(), new Set()).line, '');
  });
  test('best-supported ranks by real quality evidence', () => {
    const b = bestSupported(entries, new Set(['us-semis']), '2026-09-24T00:00:00Z');
    assert.equal(b.declined, null);
    assert.deepEqual(b.picks.map((p) => p.ticker), ['AMD', 'NVDA']);
    assert.equal(b.rankedBy, 'grade+print');
  });
  test('US book with no grades and no prints: declines instead of ranking by the alphabet', () => {
    const bare = buildListEntries([{ symbol: 'NVDA' }, { symbol: 'AMD' }], [], [], new Set(), classify);
    const b = bestSupported(bare, new Set(['us-semis']), '2026-09-24T00:00:00Z');
    assert.equal(b.picks.length, 0);
    assert.match(b.declined!, /any order would be arbitrary/);
    assert.match(bestSupported(bare, new Set(), '2026-09-24T00:00:00Z').declined!, /None of your names/);
  });
  test('order inside a theme: held, then print tier/recency, then grade', () => {
    const xs = [...entries].sort(listOrder).map((e) => e.ticker);
    assert.deepEqual(xs.slice(0, 2), ['XOM', 'KO'], 'both held: the one with a graded print first');
    assert.equal(xs[2], 'NVDA', 'then BLOCKBUSTER print');
    assert.equal(gradeRank('A+'), 0); assert.equal(gradeRank('B-'), 5); assert.equal(gradeRank(null), null);
  });
});

// ── table sort / filter over a realistic board ───────────────────────────────
function row(id: string, p: Partial<ThemeRow>): ThemeRow {
  return { id, name: id.toUpperCase(), emoji: '', group: 'G', proxy: null, members: [], ok: true, rsRatio: 100, rsMomentum: 100, quadrant: 'Leading', aboveSMA50: true,
    ret: { w1: 0, m1: 0, m3: 0, m6: 0, ytd: 0, y1: 0 }, trail: [], ...p } as ThemeRow;
}
const payload = (themes: ThemeRow[]): Payload => ({ region: 'us', benchmark: { symbol: 'SPY', name: 'S&P 500', price: 1, changePercent: 0 }, benchmarkRet: { w1: 0, m1: 0, m3: 0, m6: 0, ytd: 0, y1: 0 }, themes, rotatingIn: [], rotatingOut: [], topBuy: [], topAvoid: [], asOf: '' });
const vm = buildViewModel({
  payload: payload([
    row('a', { verdict: 'BUY', ret: { w1: 1, m1: 5, m3: 9, m6: 0, ytd: 0, y1: 30 }, breadthStats: { n: 10, above50: 8, above50Prev: 3, outperf: 7, newHighs: 3, newLows: 0 }, rsSlope: 0.6, excess3m: 5 }),
    row('b', { verdict: 'AVOID', aboveSMA50: false, quadrant: 'Lagging', ret: { w1: -2, m1: -9, m3: -12, m6: 0, ytd: 0, y1: -5 }, breadthStats: { n: 10, above50: 1, above50Prev: 6, outperf: 1, newHighs: 0, newLows: 4 }, rsSlope: -0.6 }),
    row('c', { verdict: 'HOLD', ret: { w1: 3, m1: 12, m3: 40, m6: 0, ytd: 0, y1: 150 }, dist50: 30, vol: 40, rangePos: 98, rsMomentum: 98, breadthStats: { n: 6, above50: 3, above50Prev: 6, outperf: 3, newHighs: 2, newLows: 0 } }),
    row('d', { verdict: 'WATCH', ret: { w1: 0, m1: 1, m3: 2, m6: 0, ytd: 0, y1: 4 }, trail: [] }),
  ]),
  now: new Date('2026-09-24T00:00:00Z'), printsByTheme: {}, benchLabel: 'b', catalystsByTheme: {}, catalystWindowDays: 14, pesByTheme: {}, allPEs: [], snapshots: [], currentWeek: '2026-W39', beneficiariesOf: () => [],
});
const yours = (id: string) => ({ a: 2, c: 5 } as Record<string, number>)[id] || 0;

describe('table — every column sorts, every filter filters', () => {
  const keys: SortKey[] = ['rank', 'name', 'verdict', 'w1', 'm1', 'm3', 'y1', 'trend', 'yours', 'layer:strength', 'layer:breadth', 'layer:flow', 'layer:earnings', 'layer:catalysts', 'layer:valuation', 'layer:price'];
  for (const k of keys) {
    test(`sort by ${k} both ways keeps every row`, () => {
      const asc = sortViews(vm.themes, k, 'asc', yours), desc = sortViews(vm.themes, k, 'desc', yours);
      assert.equal(asc.length, 4); assert.equal(desc.length, 4);
      assert.deepEqual(new Set(asc.map((v) => v.row.id)), new Set(['a', 'b', 'c', 'd']));
    });
  }
  test('specific orders', () => {
    assert.deepEqual(sortViews(vm.themes, 'm1', 'desc').map((v) => v.row.id), ['c', 'a', 'd', 'b']);
    assert.deepEqual(sortViews(vm.themes, 'verdict', 'asc').map((v) => v.row.verdict), ['BUY', 'HOLD', 'WATCH', 'AVOID']);
    assert.deepEqual(sortViews(vm.themes, 'yours', 'desc', yours).slice(0, 2).map((v) => v.row.id), ['c', 'a']);
    assert.equal(sortViews(vm.themes, 'layer:breadth', 'asc')[0].row.id, 'a');
    assert.equal(defaultDir('m3'), 'desc'); assert.equal(defaultDir('rank'), 'asc');
  });
  test('rank is by evidence: the crowded +150% theme is not first', () => {
    assert.notEqual(vm.themes[0].row.id, 'c');
    assert.equal(vm.themes[0].row.id, 'a');
  });
  test('filters: verdict, tier, flags (ANY), "has my names", search, and none', () => {
    const f = emptyFilter();
    assert.equal(filterViews(vm.themes, f).length, 4);
    assert.deepEqual(filterViews(vm.themes, { ...f, verdicts: new Set(['BUY', 'HOLD']) }).map((v) => v.row.id).sort(), ['a', 'c']);
    assert.deepEqual(filterViews(vm.themes, { ...f, tiers: new Set(['low' as const]) }).map((v) => v.row.id), ['b']);
    assert.deepEqual(filterViews(vm.themes, { ...f, flags: new Set(['crowded' as const]) }).map((v) => v.row.id), ['c']);
    assert.deepEqual(filterViews(vm.themes, { ...f, flags: new Set(['breakdown' as const, 'crowded' as const]) }).map((v) => v.row.id).sort(), ['b', 'c']);
    assert.deepEqual(filterViews(vm.themes, { ...f, flags: new Set(['mine' as const]) }, yours).map((v) => v.row.id).sort(), ['a', 'c']);
    assert.deepEqual(filterViews(vm.themes, { ...f, query: ' d ' }).map((v) => v.row.id), ['d']);
    assert.equal(filterViews(vm.themes, { ...f, query: 'nothing-matches' }).length, 0);
  });
});
