import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { storedTablesAnswer, annualView, cashFlowView, ratiosView } from '../screener/in-tables-view';
import { meetingDateInText, meetingsFromAnnouncements } from '../earnings/upcoming-meetings';
import { recordTickerDay, baselineDay } from '../../app/(dashboard)/multibagger/ticker-history';

const SRC = join(__dirname, '..', '..');

test('zzz1277 stored tables: same keys as the live answer, from the page our build keeps', () => {
  const raw = {
    name: 'Acme Ltd', sector: 'Industrials', industry: 'Pumps', price: 100, mcapCr: 2000, roce: 22,
    T: {
      a: { headers: ['Mar 2024', 'Mar 2025', 'TTM'], rows: { 'Sales': [100, 130, 140], 'Operating Profit': [20, 30, 32], 'Net Profit': [10, 15, 16], 'EPS in Rs': [5, 7.5, 8] } },
      cf: { headers: ['Mar 2024', 'Mar 2025'], rows: { 'Cash from Operating Activity': [12, 18], 'Cash from Investing Activity': [-8, -10] } },
      bs: { headers: ['Mar 2024', 'Mar 2025'], rows: { 'Equity Capital': [10, 10], 'Reserves': [90, 105], 'Borrowings': [20, 15] } },
      r: { headers: ['Mar 2024', 'Mar 2025'], rows: { 'ROCE %': [18, 22], 'Working Capital Days': [60, 55] } },
    },
  };
  const a = storedTablesAnswer('ACME', raw, '2026-11-17T10:00:00Z');
  assert.equal(a.ok, true); assert.equal(a.source, 'stored'); assert.equal(a.company, 'Acme Ltd');
  assert.deepEqual(a.annual[1], { period: 'Mar 2025', sales: 130, operatingProfit: 30, opmPct: null, netProfit: 15, eps: 7.5 });
  assert.equal(a.cashFlow[1].fromInvesting, -10);
  assert.equal(a.ratios[1].roce, 22);
  assert.equal(a.balanceSheet[1].reserves, 105);
  assert.equal(a.topMetrics.dividendYieldPct, null);
  assert.deepEqual(annualView(null), []); assert.deepEqual(cashFlowView(null), []); assert.deepEqual(ratiosView(null), []);
});

test('zzz1277 Multibagger reads our screener: no request-time screener.in / GitHub data calls', () => {
  const cap = readFileSync(join(SRC, 'app/(dashboard)/multibagger/capital-allocation.tsx'), 'utf8');
  assert.match(cap, /india-screener\?ticker=[^`]*&stored=1/);
  const nt = readFileSync(join(SRC, 'app/(dashboard)/multibagger/new-tracker.tsx'), 'utf8');
  assert.doesNotMatch(nt, /api\.github\.com|raw\.githubusercontent\.com/);
  const fund = readFileSync(join(SRC, 'app/(dashboard)/fundamentals/page.tsx'), 'utf8');
  assert.doesNotMatch(fund, /trigger-screener-sync/);
  for (const dead of ['app/api/market/multibagger/route.ts', 'app/api/v1/screens/[id]/route.ts', 'app/api/screener/redirect/route.ts', 'app/api/screener/sync/route.ts', 'app/api/v1/earnings/cfo-debug/route.ts']) {
    assert.equal(existsSync(join(SRC, dead)), false, dead);
  }
});

test('zzz1277 Recently added: compares with this browser\'s own list from 2+ days ago', () => {
  let h = recordTickerDay({}, '2026-11-10', ['A', 'B']);
  h = recordTickerDay(h, '2026-11-12', ['A', 'B', 'C']);
  h = recordTickerDay(h, '2026-11-13', ['A', 'B', 'C', 'D']);
  assert.equal(baselineDay(h, '2026-11-14'), '2026-11-12');   // newest day at least 2 days old
  assert.equal(baselineDay(h, '2026-11-11'), '2026-11-10');   // only a 1-day-old copy: use it
  assert.equal(baselineDay({}, '2026-11-14'), null);
  assert.equal(baselineDay(recordTickerDay({}, '2026-11-14', ['A']), '2026-11-14'), null);   // today only
  assert.deepEqual(recordTickerDay({ '2026-11-01': ['X'] }, '2026-11-02', []), { '2026-11-01': ['X'] });   // an empty list is never kept
  let many = {};
  for (let d = 1; d <= 14; d++) many = recordTickerDay(many, `2026-11-${String(d).padStart(2, '0')}`, ['A']);
  assert.equal(Object.keys(many).length, 10);
});

test('zzz1277 calendar fallback: results board meetings from NSE intimations', () => {
  assert.equal(meetingDateInText('Board meeting scheduled on 21-Nov-2026 to consider unaudited financial results'), '21-Nov-2026');
  assert.equal(meetingDateInText('meeting of the Board of Directors will be held on Friday, November 21, 2026 inter alia'), '21-Nov-2026');
  assert.equal(meetingDateInText('to be held on 21/11/2026'), '21-Nov-2026');
  assert.equal(meetingDateInText('no date here'), null);
  const got = meetingsFromAnnouncements([
    { symbol: 'acme', company_name: 'Acme', subject: 'Board Meeting Intimation', detail: 'ACME has informed the Exchange about Board Meeting to be held on 21-Nov-2026 to consider and approve the Financial Results for the period ended September 30, 2026' },
    { symbol: 'BETA', subject: 'Outcome of Board Meeting', detail: 'Board meeting held on 14-Nov-2026 approved financial results' },
    { symbol: 'GAMMA', subject: 'Board Meeting Intimation', detail: 'Board Meeting to be held on 25-Nov-2026 to consider fund raising' },
    { symbol: 'ACME', subject: 'Board Meeting Intimation', detail: 'to be held on 21-Nov-2026 to consider financial results' },
  ]);
  assert.deepEqual(got.map((m) => [m.bm_symbol, m.bm_date]), [['ACME', '21-Nov-2026']]);
});
