// zzz1163 — US Conviction Beats audit (owner, 20 Oct: "check if all deserve to be conviction beats with the preset on").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { announcingFiling } from '../us-earnings-dates';
import { foldMislabelledQuarters, passesUsConvictionFilter, usSalesGrowth, US_FILTER_DEFAULT, syncUsConvictionMap } from '../conviction-beats-us';

test('the quarter on file is credited to the 8-K that announced it, not a later non-results 8-K (SM)', () => {
  const f = { cikNum: 893538, _earnings8k: [{ filingDate: '2026-10-14', accession: 'A-3' }, { filingDate: '2026-07-30', accession: 'A-2' }, { filingDate: '2026-05-01', accession: 'A-1' }], _periodic: { filingDate: '2026-08-01', accession: 'Q-2', form: '10-Q' } };
  const r = announcingFiling(f, '2026-06-30', '2026-08-01');
  assert.equal(r?.filed, '2026-07-30'); assert.equal(r?.accession, 'A-2');
  assert.equal(announcingFiling({ cikNum: 1, _earnings8k: [], _periodic: { filingDate: '2026-08-05', accession: 'Q', form: '10-Q' } }, '2026-06-30', '2026-08-05')?.filed, '2026-08-05');
});

test('a live entry repeating an archived quarter (same period end, later date, other label) folds back to the archived one', () => {
  const map: any = {
    SM: { ticker: 'SM', tier: 'STRONG', filing_date: '2026-10-14', period_end: '2026-06-30', quarter: 'Q3', fiscal_year: 2026, anchor: { x: 1 } },
    'SM@Q2-2026': { ticker: 'SM', tier: 'STRONG', filing_date: '2026-07-30', period_end: '2026-06-30', quarter: 'Q2', fiscal_year: 2026 },
    EOG: { ticker: 'EOG', tier: 'STRONG', filing_date: '2026-10-08', period_end: '2026-09-30', quarter: 'Q3', fiscal_year: 2026 },
    'EOG@Q2-2026': { ticker: 'EOG', tier: 'STRONG', filing_date: '2026-08-01', period_end: '2026-06-30', quarter: 'Q2', fiscal_year: 2026 },
  };
  const out = foldMislabelledQuarters(map);
  assert.equal(out.SM.filing_date, '2026-07-30'); assert.equal(out['SM@Q2-2026'], undefined);
  assert.ok(out['EOG@Q2-2026']);   // a real earlier quarter stays archived
  // and the sync does not re-create it
  const r = syncUsConvictionMap({ SM: out.SM } as any, [{ ticker: 'SM', tier: 'STRONG', filing_date: '2026-10-14', period_end: '2026-06-30', quarter: 'Q3', fiscal_year: 2026 } as any]);
  assert.equal(r.map.SM.filing_date, '2026-07-30');
});

test('lenders are tested on bank revenue growth; a re-graded MIXED filing fails the preset', () => {
  const bank: any = { ticker: 'DCOM', tier: 'STRONG', is_financial: true, sales_yoy_pct: null, bank_revenue_yoy_pct: 17, eps_yoy_pct: 49 };
  assert.equal(usSalesGrowth(bank), 17);
  assert.equal(passesUsConvictionFilter(bank, { ...US_FILTER_DEFAULT, sales: 20 } as any), false);
  assert.equal(passesUsConvictionFilter({ ...bank, bank_revenue_yoy_pct: 25 }, { ...US_FILTER_DEFAULT, sales: 20 } as any), true);
  const mixed: any = { ticker: 'REF', tier: 'BLOCKBUSTER', now_tier: 'MIXED', sales_yoy_pct: 24, eps_yoy_pct: 77 };
  assert.equal(passesUsConvictionFilter(mixed, { ...US_FILTER_DEFAULT, sales: 20 } as any), false);
});

test('a services company whose only revenue line is "Revenues from services (a)" is read (ManpowerGroup)', async () => {
  const { financialsFromReleaseHtml } = await import('../us-pr-financials');
  const html = '<table><tr><td></td><td>2026</td><td>2025</td></tr><tr><td>Revenues from services (a)</td><td>$ 4,840.0</td><td>$ 4,634.4</td><td>4.4 %</td></tr>'
    + '<tr><td>Net earnings</td><td>34.1</td><td>18.0</td></tr></table>';
  const r = financialsFromReleaseHtml(html, { revenue: 4634.4e6, operating_income: null, net_income: 18.0e6, eps: null } as any);
  assert.equal(r.revenue, 4840e6);
});

test('patent owners and royalty holders are operating companies, not financials (Digital Turbine 6794)', async () => {
  const { isFinancialSic } = await import('../us-edgar');
  assert.equal(isFinancialSic('6794'), false); assert.equal(isFinancialSic('6792'), false);
  assert.equal(isFinancialSic('6022'), true); assert.equal(isFinancialSic('6798'), true);
});

test('India bench: an asset-light financial gets the real cash test, a lender is skipped', async () => {
  const { cbCashView } = await import('../conviction-filter-india');
  const base = { cash_fy: 'Mar 2026', ocf_annual_cr: 20, pat_annual_cr: 100, cfo_to_pat_ratio: 0.2 };
  assert.equal(cbCashView({ ...base, company: 'Manipal Payment and Identity Solutions Ltd', sector: 'Financial Services', industry: 'Financial Technology (Fintech)' }).state, 'ok');
  assert.equal(cbCashView({ ...base, company: 'Fedbank Financial Services Ltd', sector: 'Financial Services', industry: 'Non Banking Financial Company (NBFC)' }).state, 'na');
});
