// zzz793 — US Portfolio Catalysts: strict XBRL quarters, verified against
// live SEC EDGAR companyfacts (fixture fetched 2026-09-24, public data).
// Run: npx tsx --test src/lib/__tests__/zzz793-us-pc-xbrl.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strictFigures, durationKind, quartersOf, fiscalPeriodName, fiscalCalendar, roceFromFacts, moneyShort } from '../us-thesis/xbrl';
import { usFactsResult, filerKind } from '../us-thesis/facts-row';

const FX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zzz793-us-pc-edgar.json'), 'utf8'));
const co = (t: string) => FX.companies[t];
const pct = (a: number, b: number) => Math.round(((a / b) - 1) * 1000) / 10;

// The verified figures (USD, as filed). Q4 of NTNX and RELL is never filed as
// a quarter: it is the full year minus nine months, labelled derived.
const VERIFIED: Record<string, { label: string; prevEnd: string; rev: [number, number]; ni: [number, number]; revY: number; niY: number; derived: boolean }> = {
  NTNX: { label: 'Q4 FY2026 (quarter ended Jul 31, 2026)', prevEnd: '2025-07-31', rev: [757_078_000, 653_267_000], ni: [1_269_632_000, 38_650_000], revY: 15.9, niY: 3184.9, derived: true },
  ALB: { label: 'Q2 FY2026 (quarter ended Jun 30, 2026)', prevEnd: '2025-06-30', rev: [1_743_313_000, 1_329_992_000], ni: [479_959_000, 22_897_000], revY: 31.1, niY: 1996.2, derived: false },
  'MOG-A': { label: 'Q3 FY2026 (quarter ended Jun 27, 2026)', prevEnd: '2025-06-28', rev: [1_116_545_000, 969_582_000], ni: [152_025_000, 58_486_000], revY: 15.2, niY: 159.9, derived: false },
  RELL: { label: 'Q4 FY2026 (quarter ended May 30, 2026)', prevEnd: '2025-05-31', rev: [66_197_000, 51_889_000], ni: [3_702_000, 1_075_000], revY: 27.6, niY: 244.4, derived: true },
  MITK: { label: 'Q3 FY2026 (quarter ended Jun 30, 2026)', prevEnd: '2025-06-30', rev: [54_038_000, 45_729_000], ni: [8_367_000, 2_396_000], revY: 18.2, niY: 249.2, derived: false },
};

describe('verified EDGAR quarters (same fiscal quarter a year earlier)', () => {
  for (const [t, v] of Object.entries(VERIFIED)) {
    test(`${t}: ${v.label}, revenue ${v.revY}%, net income ${v.niY}%`, () => {
      const s = strictFigures(co(t).facts);
      assert.equal(s.basis, 'quarterly');
      assert.equal(s.currency, 'USD');
      assert.equal(s.period_label, v.label);
      assert.equal(s.q_end_prev, v.prevEnd);
      assert.deepEqual([s.revenue.cur, s.revenue.prev], v.rev);
      assert.deepEqual([s.net_income.cur, s.net_income.prev], v.ni);
      assert.equal(pct(s.revenue.cur!, s.revenue.prev!), v.revY);
      assert.equal(pct(s.net_income.cur!, s.net_income.prev!), v.niY);
      assert.equal(!!s.revenue.derived, v.derived, String(s.revenue.derived));
      if (v.derived) assert.match(String(s.revenue.derived), /full year − nine months/);
    });
  }
  test('the grader row carries the same growth, the company period and $M — never a crore', () => {
    const c = co('NTNX');
    const r = usFactsResult('NTNX', c.facts, { cik: c.cik, sic: c.sic, sicDescription: c.sicDescription, forms: c.forms });
    assert.equal(r.row!.sales_yoy_pct, 15.9);
    assert.equal(r.row!.net_profit_yoy_pct, 3184.9);
    assert.equal(r.row!.period, 'Q4 FY2026 (quarter ended Jul 31, 2026)');
    assert.equal(r.row!.revenue_curr_musd, 757.1);
    assert.match(String(r.row!.xbrl_derived), /derived/);
    assert.ok(!/FY\d\d\b|Cr\b|crore/.test(JSON.stringify(r.row)), 'no India period key or crore on the row');
  });
});

describe('duration discipline', () => {
  test('only 80–100 day facts are quarters; 6M / 9M / FY are never quarterly', () => {
    assert.equal(durationKind('2026-04-01', '2026-06-30'), 'Q');
    assert.equal(durationKind('2026-01-01', '2026-06-30'), 'H');
    assert.equal(durationKind('2025-10-01', '2026-06-30'), '9M');
    assert.equal(durationKind('2025-07-01', '2026-06-30'), 'FY');
    assert.equal(durationKind('2026-05-01', '2026-06-30'), null);
  });
  test('Q4 = FY − 9M only when both share the fiscal-year start; a mismatched start derives nothing', () => {
    const rows = [
      { start: '2025-08-01', end: '2026-04-30', val: 900, form: '10-Q', filed: '2026-05-29', fy: 2026, fp: 'Q3' },
      { start: '2025-08-01', end: '2026-07-31', val: 1200, form: '10-K', filed: '2026-09-18', fy: 2026, fp: 'FY' },
      { start: '2024-09-01', end: '2025-05-31', val: 700, form: '10-Q', filed: '2025-06-30', fy: 2025, fp: 'Q3' },
      { start: '2024-08-01', end: '2025-07-31', val: 1000, form: '10-K', filed: '2025-09-18', fy: 2025, fp: 'FY' },
    ];
    const q = quartersOf(rows as any, false);
    assert.equal(q.get('2026-07-31')?.val, 300);
    assert.equal(q.get('2026-07-31')?.derived, 'FY-9M');
    assert.equal(q.get('2025-07-31'), undefined, 'different starts: no derived quarter');
  });
  test('cash flow is de-cumulated from year-to-date figures with the same start', () => {
    const rows = [
      { start: '2026-01-01', end: '2026-03-31', val: 40, form: '10-Q', filed: 'a', fy: 2026, fp: 'Q1' },
      { start: '2026-01-01', end: '2026-06-30', val: 100, form: '10-Q', filed: 'b', fy: 2026, fp: 'Q2' },
    ];
    const q = quartersOf(rows as any, true);
    assert.equal(q.get('2026-06-30')?.val, 60);
    assert.equal(q.get('2026-06-30')?.derived, 'YTD');
  });
});

describe('the company\'s own fiscal calendar', () => {
  test('fiscal year end and naming come from the company\'s annual facts', () => {
    const cal = fiscalCalendar(co('NTNX').facts)!;
    assert.deepEqual([cal.fyeMonth, cal.fyeDay, cal.offset], [7, 31, 0]);
    assert.equal(fiscalPeriodName('2026-04-30', 'Q', cal), 'Q3 FY2026');
    assert.equal(fiscalPeriodName('2026-10-31', 'Q', cal), 'Q1 FY2027');
    const moog = fiscalCalendar(co('MOG-A').facts)!;
    assert.equal(fiscalPeriodName('2026-06-27', 'Q', moog), 'Q3 FY2026', '52/53-week year');
  });
});

describe('foreign filers and units', () => {
  test('a 20-F filer\'s annual figures are labelled annual, never quarterly, and there is no grader row', () => {
    const c = co('RSKD');
    const r = usFactsResult('RSKD', c.facts, { cik: c.cik, sic: c.sic, sicDescription: c.sicDescription, forms: c.forms });
    assert.equal(r.row, null);
    assert.equal(r.profile.period!.basis, 'annual');
    assert.match(String(r.why), /^Foreign filer — files .*6-K.*; quarterly figures are not in SEC XBRL\. FY2025 \(year ended Dec 31, 2025\) — annual figures/);
    assert.ok(!/quarter ended/.test(String(r.why)));
  });
  test('a non-USD filer is shown in its own currency (XPEV in CNY), never as $', () => {
    const s = strictFigures(co('XPEV').facts);
    assert.equal(s.currency, 'CNY');
    assert.equal(s.basis, 'annual');
    assert.equal(moneyShort(s.revenue.cur, s.currency), 'CNY 76.72B');
    assert.equal(moneyShort(412_600_000), '$412.6M');
    assert.equal(moneyShort(850_000), '$850K');
  });
  test('ifrs-full quarterly 6-K figures are read (GFS); ifrs annual only is labelled annual (LAR)', () => {
    const g = strictFigures(co('GFS').facts);
    assert.equal(g.taxonomy, 'ifrs-full'); assert.equal(g.basis, 'quarterly');
    const l = strictFigures(co('LAR').facts);
    assert.equal(l.taxonomy, 'ifrs-full'); assert.equal(l.basis, 'annual');
    assert.match(String(l.period_label), /^FY2025 \(year ended/);
  });
  test('no financial statements at all → a plain reason', () => {
    const r = usFactsResult('MDA', { facts: { dei: {} } }, { sic: '3760', sicDescription: 'Guided Missiles & Space Vehicles & Parts', forms: ['6-K', 'F-10'] });
    assert.equal(r.row, null);
    assert.match(String(r.why), /Foreign filer — files 6-K; its financial statements are not in SEC XBRL/);
    assert.equal(filerKind(['10-Q', '8-K']).filer, 'domestic');
  });
});

describe('ROCE only when clean', () => {
  test('computed from the same quarter\'s SEC figures (four quarters of operating income ÷ capital employed at quarter end)', () => {
    const r = roceFromFacts(co('ITW').facts, '2026-06-30');
    assert.ok(r && r.pct > 0 && r.fiscal === 'Q2 FY2026');
    const c = co('ITW');
    const row = usFactsResult('ITW', c.facts, { cik: c.cik, sic: c.sic, sicDescription: c.sicDescription, forms: c.forms }).row!;
    assert.equal(row.roce_basis, 'sec-ttm');
  });
  test('no operating income tag → no ROCE (omitted, not "not disclosed")', () => {
    assert.equal(roceFromFacts({ facts: { 'us-gaap': { Assets: { units: { USD: [{ end: '2026-06-30', val: 1 }] } } } } }, '2026-06-30'), null);
  });
});
