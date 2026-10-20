// zzz1161 — lenders: net interest income (and fee income, credit-loss provision) from XBRL, and from the release only when the
// row's year-ago column reproduces last year's XBRL quarter. India: NII = interest earned − interest paid (Screener bank shape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bankQuarterFromFacts, bankFromRelease, bankRowFields } from '../us-bank-metrics';

const q = (start: string, end: string, val: number) => ({ start, end, val, form: '10-Q', filed: end.replace(/-\d\d$/, '-28') });
const FACTS = { facts: { 'us-gaap': {
  InterestIncomeExpenseNet: { units: { USD: [q('2026-07-01', '2026-09-30', 120_000_000), q('2025-07-01', '2025-09-30', 100_000_000)] } },
  NoninterestIncome: { units: { USD: [q('2026-07-01', '2026-09-30', 30_000_000), q('2025-07-01', '2025-09-30', 25_000_000)] } },
  ProvisionForCreditLossExpenseReversal: { units: { USD: [q('2026-07-01', '2026-09-30', 5_000_000), q('2025-07-01', '2025-09-30', 8_000_000)] } },
} } };

test('XBRL: net interest income, bank revenue and provision with YoY', () => {
  const f = bankRowFields(bankQuarterFromFacts(FACTS, '2026-09-30'));
  assert.equal(f.nii_curr_musd, 120); assert.equal(f.nii_prev_musd, 100); assert.equal(f.nii_yoy_pct, 20);
  assert.equal(f.bank_revenue_curr_musd, 150); assert.equal(f.bank_revenue_yoy_pct, 20);
  assert.equal(f.provision_curr_musd, 5); assert.equal(f.provision_yoy_pct, -37.5);
});

test('release: a row counts only when its year-ago column matches last year (thousands)', () => {
  const html = '<table><tr><td>Net interest income</td><td>$ 121,500</td><td>$ 100,000</td></tr>'
    + '<tr><td>Net interest income after provision</td><td>116,000</td><td>92,000</td></tr>'
    + '<tr><td>Provision for credit losses</td><td>4,000</td><td>9,999</td></tr></table>';
  const r = bankFromRelease(html, { nii_prev: 100_000_000, nonint_prev: null, provision_prev: 8_000_000 });
  assert.equal(r.nii, 121_500_000);
  assert.equal(r.provision, undefined);   // year-ago 9,999 ≠ 8,000: not taken
});

test('wiring: graded-us, US card, enrich, graded and India card carry the lender figures', () => {
  const us = readFileSync(new URL('../../app/api/v1/earnings/graded-us/route.ts', import.meta.url), 'utf8');
  assert.equal((us.match(/bankRowFields\(/g) || []).length, 2);
  const card = readFileSync(new URL('../../components/us-earnings-card.tsx', import.meta.url), 'utf8');
  assert.match(card, /NET INTEREST INCOME/); assert.match(card, /CREDIT-LOSS PROVISION/);
  const en = readFileSync(new URL('../../app/api/v1/earnings/enrich/route.ts', import.meta.url), 'utf8');
  assert.match(en, /nii_curr_cr: niiC/);
  const gr = readFileSync(new URL('../../app/api/v1/earnings/graded/route.ts', import.meta.url), 'utf8');
  assert.equal((gr.match(/nii_curr_cr: e\.nii_curr_cr/g) || []).length, 2);
  const pg = readFileSync(new URL('../../app/(dashboard)/earnings-opportunities/page.tsx', import.meta.url), 'utf8');
  assert.match(pg, /NET INTEREST INCOME YOY/); assert.match(pg, /INTEREST EARNED YOY/);
});

test('NII from its halves when the filer tags no net figure; equity ÷ assets from one balance-sheet date', async () => {
  const { equityToAssets } = await import('../us-bank-metrics');
  const f = { facts: { 'us-gaap': {
    InterestAndDividendIncomeOperating: { units: { USD: [q('2026-07-01', '2026-09-30', 200_000_000), q('2025-07-01', '2025-09-30', 180_000_000)] } },
    InterestExpense: { units: { USD: [q('2026-07-01', '2026-09-30', 80_000_000), q('2025-07-01', '2025-09-30', 80_000_000)] } },
    StockholdersEquity: { units: { USD: [{ end: '2026-06-30', val: 1_000_000_000, form: '10-Q' }] } },
    Assets: { units: { USD: [{ end: '2026-06-30', val: 10_000_000_000, form: '10-Q' }] } },
  } } };
  const b = bankQuarterFromFacts(f, '2026-09-30');
  assert.equal(b.nii, 120_000_000); assert.equal(b.nii_prev, 100_000_000);
  assert.deepEqual(equityToAssets(f), { pct: 10, asOf: '2026-06-30' });
});

test('lender card: no "n/a" revenue or debt/equity tiles', () => {
  const card = readFileSync(new URL('../../components/us-earnings-card.tsx', import.meta.url), 'utf8');
  assert.match(card, /else if \(!isFin \|\|/); assert.doesNotMatch(card, /'n\/a \(bank\)'/);
  assert.match(card, /EQUITY \/ ASSETS/);
});

test('release: five-quarter table takes the FIRST column; a stray year is skipped', () => {
  const five = '<tr><td>Net interest income</td><td>$ 30,100</td><td>29,500</td><td>28,900</td><td>28,200</td><td>27,530</td></tr>';
  assert.equal(bankFromRelease(five, { nii_prev: 27_530_000, nonint_prev: null, provision_prev: null }).nii, 30_100_000);
  const yr = '<tr><td>Net interest income 2026</td><td>121,500</td><td>103,400</td></tr>';
  assert.equal(bankFromRelease(yr, { nii_prev: 103_400_000, nonint_prev: null, provision_prev: null }).nii, 121_500_000);
});

test('release rows split over source lines and "net interest revenue" (MBWM, UCB shapes)', () => {
  const mb = '<tr><td style="x">\n Net interest income </td><td>&nbsp;</td><td>60,900</td>\n<td>&nbsp;</td><td>52,002</td></tr>';
  assert.equal(bankFromRelease(mb, { nii_prev: 52_000_000, nonint_prev: null, provision_prev: null }).nii, 60_900_000);
  const ucb = '<tr><td>Net interest revenue</td><td>251,206</td><td>240,900</td><td>232,764</td><td>237,926</td><td>233,629</td></tr>';
  assert.equal(bankFromRelease(ucb, { nii_prev: 233_630_000, nonint_prev: null, provision_prev: null }).nii, 251_206_000);
});
