// zzz938 — our own stock screener: filters, the SEC figure assembly (incl. the worked-out 4th quarter) and the Nasdaq list.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runScreen, passes, filterCounts, BUILT_IN_SCREENS, cleanScreens, filterLabel, type Filter } from '../screener/filters';
import { usFigures, framePeriods, quarterSeries, quarterLabelForEnd, type FrameData } from '../screener/sec-assemble';
import { parseNasdaqList, sma } from '../screener/us-build';
import type { ScreenRow } from '../screener/types';

const row = (o: Partial<ScreenRow>): ScreenRow => ({ t: 'X', n: 'X', sec: 'Technology', ind: null, px: 10, chg: 0, vol: 100_000, avgVol10: null, mc: 500, sma50: 11, sma200: 10,
  revQYoY: 30, revAYoY: 20, gpQYoY: 60, gmFY: 50, ebitdaQoQ: 5, ebitdaAYoY: 10, epsQYoY: 20, opmTTM: 5, ps: 5, evRev: 5, de: 0.5, cash: 10, emp: 500, flt: 90, bb: 0, fs: 6, q: 'Q2 2026', tvSec: 'Technology Services', ...o });

describe('filters', () => {
  test('a missing figure fails the filter; between, above and sector work', () => {
    assert.equal(passes(row({ revQYoY: null }), { kind: 'num', key: 'revQYoY', op: 'gt', v: 20 }), false);
    assert.equal(passes(row({ mc: 250 }), { kind: 'num', key: 'mc', op: 'between', v: 200, v2: 30_000 }), true);
    assert.equal(passes(row({ sma50: 9 }), { kind: 'cmp', key: 'sma50', op: 'above', other: 'sma200' }), false);
    assert.equal(passes(row({ sec: 'Finance' }), { kind: 'sector', sectors: ['Technology'] }), false);
    assert.equal(passes(row({ sec: 'Finance' }), { kind: 'sector', sectors: [] }), true, 'no sector ticked = all');
  });
  test('the owner\'s US screens run and each filter has its own count', () => {
    const s = BUILT_IN_SCREENS.find((x) => x.id === 'us-future-nvda')!;
    const rows = [row({ t: 'A' }), row({ t: 'B', gpQYoY: 10 }), row({ t: 'C', emp: null })];  // zzz947: TradingView's float filter is a share count (80+ shares = any float), not float %, so it is not a filter here
    assert.deepEqual(runScreen(rows, s.filters).map((r) => r.t), ['A']);
    const c = filterCounts(rows, s.filters);
    assert.equal(c.length, s.filters.length);
    assert.equal(c[s.filters.findIndex((f) => f.kind === 'num' && f.key === 'gpQYoY')], 2);
  });
  test('stored screens are cleaned; labels read plainly', () => {
    const bad = cleanScreens([{ id: 'a', name: 'A', market: 'US', filters: [{ kind: 'num', key: 'nope', op: 'gt', v: 1 }, { kind: 'num', key: 'ps', op: 'lt', v: 7 }] }, { id: 1 }]);
    assert.equal(bad.length, 1); assert.equal(bad[0].filters.length, 1);
    assert.equal(filterLabel({ kind: 'num', key: 'mc', op: 'between', v: 200, v2: 30_000 } as Filter, 'US'), 'Market cap $200M to $30B');
    assert.equal(filterLabel({ kind: 'num', key: 'mc', op: 'between', v: 10, v2: 5000 } as Filter, 'IN'), 'Market cap ₹10 Cr to ₹5,000 Cr');
  });
});

describe('SEC figures', () => {
  const periods = framePeriods(new Date('2026-10-07T08:00:00Z'));
  test('periods: last ended quarter first', () => {
    assert.equal(periods.quarters[0], 'CY2026Q3'); assert.equal(periods.instants[0], 'CY2026Q3I'); assert.equal(periods.years[1], 'CY2025');
    assert.equal(quarterLabelForEnd('2025-09-27'), 'CY2025Q3');
  });
  // a September fiscal-year company (Apple-like): the Jul–Sep quarter is only inside the annual report
  const fd: FrameData = {
    Revenues: {
      CY2025: { 7: { v: 400e6, s: '2024-09-29', e: '2025-09-27' } },
      CY2024Q4: { 7: { v: 120e6, s: '2024-09-29', e: '2024-12-28' } },
      CY2025Q1: { 7: { v: 90e6, s: '2024-12-29', e: '2025-03-29' } },
      CY2025Q2: { 7: { v: 90e6, s: '2025-03-30', e: '2025-06-28' } },
      CY2025Q4: { 7: { v: 140e6, s: '2025-09-28', e: '2025-12-27' } },
      CY2026Q1: { 7: { v: 100e6, s: '2025-12-28', e: '2026-03-28' } },
      CY2026Q2: { 7: { v: 108e6, s: '2026-03-29', e: '2026-06-27' } },
      CY2024: { 7: { v: 380e6, s: '2023-10-01', e: '2024-09-28' } },
    },
    OperatingIncomeLoss: {},
    StockholdersEquity: { CY2026Q2I: { 7: { v: 100e6 } } },
    LongTermDebt: { CY2026Q2I: { 7: { v: 50e6 } } },
  };
  test('the fiscal year\'s last quarter is worked out as year − the other three', () => {
    const s = quarterSeries(fd, 'Revenues', 7, periods.quarters);
    assert.deepEqual(s.get('CY2025Q3'), { v: 100e6, derived: true });
  });
  test('growth, TTM and debt/equity', () => {
    const f = usFigures(fd, 7, periods);
    assert.equal(f.q, 'Q2 2026');
    assert.equal(f.revQYoY, 20);   // 108 vs 90
    assert.equal(f.revAYoY, 5.3);  // 400 vs 380
    assert.equal(f.revTTM, 448);   // 108+100+140+100, in $ million
    assert.equal(f.de, 0.5);
  });
});

describe('Nasdaq list', () => {
  test('common stock only, market cap in $ million', () => {
    const rows = parseNasdaqList({ data: { rows: [
      { symbol: 'NVDA', name: 'NVIDIA Corporation Common Stock', lastsale: '$180.25', pctchange: '1.25%', volume: '1000', marketCap: '4400000000000.00', sector: 'Technology', industry: 'Semiconductors' },
      { symbol: 'ABCW', name: 'ABC Corp Warrants', lastsale: '$0.10', marketCap: '' },
      { symbol: 'BAC^K', name: 'Bank of America Preferred', lastsale: '$25' },
      { symbol: 'BRK/B', name: 'Berkshire Hathaway Inc.', lastsale: '$480', marketCap: '1000000000000' },
      { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing Company Ltd. American Depositary Shares', lastsale: '$200' },
    ] } });
    assert.deepEqual(rows.map((r) => r.t), ['NVDA', 'BRK.B']);
    assert.equal(rows[0].mc, 4_400_000); assert.equal(rows[0].px, 180.25); assert.equal(rows[0].n, 'NVIDIA Corporation');
  });
  test('SMA needs enough days', () => {
    assert.equal(sma([1, 2, 3], 5), null);
    assert.equal(sma([1, 2, 3, 4, 5, 6], 5), 4);
  });
});
