// zzz1208 — Company Lab: FCF checklist (unknown never counts as a fail), yearly series from SEC facts / screener.in tables,
// trend template rules and breakout, page wired into the nav and the home favourites.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fcfReport, yearPoints, trendRules, breakout, cagr, type AnnualRow } from '../company-lab/core';
import { usAnnualRows, inAnnualRows } from '../company-lab/annual';

const row = (y: number, rev: number, fcf: number | null, o: Partial<AnnualRow> = {}): AnnualRow => ({ end: `${y}-12-31`, label: `FY${y}`, revenue: rev, netIncome: rev * 0.1, eps: rev / 100, cfo: fcf == null ? null : fcf + 10, capex: fcf == null ? null : -10, fcf, debt: 50, shares: 10, sbc: null, ...o });
test('a compounding cash generator passes; missing figures are unknown, not fails', () => {
  const rows = [row(2020, 100, 10), row(2021, 120, 14), row(2022, 140, 19), row(2023, 165, 25), row(2024, 190, 31), row(2025, 220, 40)];
  const r = fcfReport(rows, 600, 'test');
  const st = Object.fromEntries(r.checks.map((c) => [c.id, c.state]));
  assert.equal(st.growth, 'pass'); assert.equal(st.margin, 'pass'); assert.equal(st.yield, 'pass'); assert.equal(st.conv, 'pass');
  assert.equal(st.lever, 'pass'); assert.equal(st.debt, 'pass');
  const bare = fcfReport([row(2025, 220, null)], null, 'test');
  assert.equal(bare.known, bare.checks.filter((c) => c.state !== 'unknown').length);
  assert.ok(bare.checks.every((c) => c.state !== 'fail'));
  assert.equal(cagr(10, 40, 5), 32);
  const yp = yearPoints(rows, null);
  assert.equal(yp[5].fcfM, 18.2); assert.equal(yp[5].revG, 15.8); assert.equal(yp[5].fcfPs, 4);
});

test('SEC facts: full fiscal years only, latest filing wins, FCF needs a capex line', () => {
  const fact = (start: string, end: string, val: number, filed = '2026-02-01', form = '10-K') => ({ start, end, val, filed, form, fp: 'FY' });
  const facts = { facts: { 'us-gaap': {
    Revenues: { units: { USD: [fact('2024-01-01', '2024-12-31', 1e9), fact('2025-01-01', '2025-12-31', 1.4e9), fact('2025-07-01', '2025-09-30', 4e8, '2025-11-01', '10-Q')] } },
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: [fact('2024-01-01', '2024-12-31', 2e8), fact('2025-01-01', '2025-12-31', 3e8)] } },
    PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [fact('2025-01-01', '2025-12-31', 5e7)] } },
    LongTermDebt: { units: { USD: [{ end: '2025-12-31', val: 6e8, filed: '2026-02-01', form: '10-K', fp: 'FY' }] } },
  } } };
  const rows = usAnnualRows(facts);
  assert.deepEqual(rows.map((r) => r.label), ['FY2024', 'FY2025']);
  assert.equal(rows[1].revenue, 1400); assert.equal(rows[1].fcf, 250); assert.equal(rows[1].debt, 600);
  assert.equal(rows[0].fcf, null);   // no capex line that year: FCF not known
});

test('screener.in tables: yearly columns only (no TTM), FCF = operating + investing cash', () => {
  const raw = { T: {
    a: { headers: ['Mar 2025', 'Mar 2026', 'TTM'], rows: { Sales: [100, 150, 160], 'Net Profit': [10, 18, 20], 'EPS in Rs': [1, 1.8, 2] } },
    cf: { headers: ['Mar 2025', 'Mar 2026'], rows: { 'Cash from Operating Activity': [12, 20], 'Cash from Investing Activity': [-5, -8] } },
    bs: { headers: ['Mar 2025', 'Mar 2026'], rows: { Borrowings: [30, 25] } },
  } };
  const rows = inAnnualRows(raw);
  assert.deepEqual(rows.map((r) => [r.label, r.revenue, r.fcf, r.debt]), [['Mar 2025', 100, 7, 30], ['Mar 2026', 150, 12, 25]]);
});

test('trend template and breakout on a steady uptrend', () => {
  const n = 300, c = Array.from({ length: n }, (_, i) => 100 + i * 0.5), v = Array(n).fill(1000);
  c[n - 1] = c[n - 2] + 5; v[n - 1] = 2000;
  const b = { c, h: c.map((x) => x + 1), l: c.map((x) => x - 1), v };
  assert.equal(trendRules(b).filter((r) => r.ok).length, 6);
  assert.equal(breakout(b).ok, true);
});

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
test('wired: page, API, nav and home favourite', () => {
  assert.match(read('app/(dashboard)/DashboardClient.tsx'), /href: '\/company-lab'/);
  assert.match(read('app/(dashboard)/page.tsx'), /href: '\/company-lab', label: '🧪 Company Lab'/);
  assert.match(read('app/api/v1/company-lab/route.ts'), /labCard\(market, t\)/);
  assert.doesNotMatch(read('app/(dashboard)/company-lab/page.tsx'), /apikey|financialmodelingprep/i);
});
