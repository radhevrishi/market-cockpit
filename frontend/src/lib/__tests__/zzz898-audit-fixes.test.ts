// zzz898 — audit fixes: My Book totals never treat an unknown price as a value, neutral signal words,
// EO earlier-day label, results-PDF figures tied to their quoted row (+ disagreements recorded), Small & mid toggle.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isPricedRow, pricedValue, bookTotals, unpricedNote, neutralSignalLabel } from '../book-totals';
import { eoFallbackLabel } from '../eo-fallback-label';
import { checkResultsAnswer, overlayResultsPdf, figureOnRow, quoteSupport, resultsPdfDisagreements } from '../india-results-pdf';
import { passesSmallMid, smallMidCounts, knownCapCr, SMALL_MID_MAX_CR } from '../small-mid-filter';
import { CB_SMALL_MID_MAX_CR } from '../conviction-filter-india';

describe('zzz898 — My Book totals', () => {
  const rows = [
    { cmp: 110, investedValue: 1000, currentValue: 1100 },
    { cmp: 0, investedValue: 500, currentValue: 500 },          // no price: page falls back to cost
    { cmp: NaN, investedValue: 300, currentValue: 300 },
    { cmp: 50, investedValue: 1000, currentValue: 900 },
  ];
  test('unpriced holdings are counted, never valued', () => {
    assert.equal(isPricedRow(rows[0]), true);
    assert.equal(isPricedRow(rows[1]), false);
    assert.equal(isPricedRow(rows[2]), false);
    assert.equal(isPricedRow({}), false);
    assert.equal(pricedValue(rows[1]), 0);
    const t = bookTotals(rows);
    assert.equal(t.current, 2000);
    assert.equal(t.pricedInvested, 2000);
    assert.equal(t.investedAll, 2800);
    assert.equal(t.pnl, 0);
    assert.equal(t.pnlPct, 0);
    assert.equal(t.unpricedCount, 2);
    assert.equal(t.pricedCount, 2);
  });
  test('nothing priced: P&L is unknown (null), not zero', () => {
    const t = bookTotals([{ cmp: 0, investedValue: 100, currentValue: 100 }]);
    assert.equal(t.pnl, null);
    assert.equal(t.pnlPct, null);
    assert.equal(t.current, 0);
  });
  test('note wording', () => {
    assert.equal(unpricedNote(0), '');
    assert.equal(unpricedNote(1), '1 holding without a price — left out of totals');
    assert.equal(unpricedNote(3), '3 holdings without a price — left out of totals');
  });
  test('signal codes become neutral words (no buy / sell)', () => {
    assert.equal(neutralSignalLabel('BUY'), 'positive');
    assert.equal(neutralSignalLabel('trim'), 'review');
    assert.equal(neutralSignalLabel('EXIT'), 'negative');
    assert.equal(neutralSignalLabel(undefined), '');
    for (const k of ['BUY', 'ADD', 'TRIM', 'EXIT', 'SELL', 'HOLD', 'AVOID']) {
      assert.doesNotMatch(neutralSignalLabel(k), /buy|sell|exit|trim|add/i);
    }
  });
});

describe('zzz898 — EO earlier-day label', () => {
  test('says it is not today', () => {
    assert.equal(eoFallbackLabel('2026-10-06', '2026-10-03', '2026-10-06'),
      'Showing 2026-10-03 — no results filed today (2026-10-06) yet. Use the date arrows or "Latest" to change.');
    assert.match(eoFallbackLabel('2026-10-05', '2026-10-03', '2026-10-06'), /^Showing 2026-10-03 — no graded results for 2026-10-05 yet/);
    assert.equal(eoFallbackLabel('2026-10-03', '2026-10-03', '2026-10-06'), '');
    assert.equal(eoFallbackLabel('', '2026-10-03', '2026-10-06'), '');
  });
});

describe('zzz898 — results PDF: figures tied to the quoted row', () => {
  const DOC = 'Statement of Standalone Unaudited Financial Results for the quarter ended 30.09.2026 (Rs. in Lakhs) '
    + 'Particulars Quarter ended 30.09.2026 30.06.2026 30.09.2025 Revenue from operations 12,345.67 11,000.00 9,876.54 Other income 12.00 '
    + 'Total income 12,357.67 Profit before tax 1,500.25 Profit for the period 1,120.50 980.00 (210.75) Earnings per equity share Basic 4.56 3.98 (0.86) '
    + 'x'.repeat(1300);
  const ans = (o: any = {}) => ({ is_results_statement: true, period_end: '2026-09-30', basis: 'standalone', unit: 'lakh', revenue_current: 12345.67, revenue_year_ago: 9876.54, net_profit_current: 1120.5, net_profit_year_ago: -210.75, eps_current: 4.56, eps_year_ago: -0.86,
    revenue_line: 'Revenue from operations 12,345.67 11,000.00 9,876.54', net_profit_line: 'Profit for the period 1,120.50 980.00 (210.75)', eps_line: 'Earnings per equity share Basic 4.56 3.98 (0.86)', ...o });
  const P = { ticker: 'hiil', want: '2026-09-30', filed: '2026-10-03', docText: DOC, url: 'https://nsearchives.nseindia.com/x.pdf', model: 'haiku' };
  const rec = (checkResultsAnswer(ans(), P) as any).record;
  const old = { sales_curr_cr: 90, pat_curr_cr: 5, latest_quarter_end_iso: '2026-06-30', financials_source: 'screener-worker' };

  test('the record keeps the quoted rows and the printed figures', () => {
    assert.equal(rec.quotes.revenue_line, 'Revenue from operations 12,345.67 11,000.00 9,876.54');
    assert.equal(rec.quotes.printed.net_profit_year_ago, -210.75);
    assert.deepEqual(quoteSupport(rec), { revenue: true, pat: true, eps: true });
  });
  test('figureOnRow needs the figure on that row, not elsewhere', () => {
    assert.equal(figureOnRow(12345.67, 'Revenue from operations 12,345.67 11,000.00'), true);
    assert.equal(figureOnRow(12357.67, 'Revenue from operations 12,345.67 11,000.00'), false);
    assert.equal(figureOnRow(null, null), true);
    assert.equal(figureOnRow(5, null), false);
  });
  test('overlay shows the quotes it used', () => {
    const o = overlayResultsPdf(old, rec, '2026-10-03');
    assert.equal(o.financials_source, 'results-pdf');
    assert.equal(o._results_pdf.quotes.revenue, rec.quotes.revenue_line);
  });
  test('a record with no quoted rows is not laid over Screener', () => {
    const { quotes, ...legacy } = rec;
    void quotes;
    const o = overlayResultsPdf(old, legacy, '2026-10-03');
    assert.equal(o.financials_source, 'screener-worker');
    assert.equal(o.sales_curr_cr, 90);
    assert.match(o._results_pdf_skipped, /no quoted rows/);
  });
  test('net profit not on its quoted row: left empty, revenue still used, gap stated', () => {
    const bad = { ...rec, quotes: { ...rec.quotes, net_profit_line: 'Profit for the period 999.00 980.00' } };
    const o = overlayResultsPdf(old, bad, '2026-10-03');
    assert.equal(o.financials_source, 'results-pdf');
    assert.equal(o.sales_curr_cr, 123.46);
    assert.equal(o.pat_curr_cr, null);
    assert.deepEqual(o._results_pdf.unsupported, ['net profit']);
  });
  test('revenue not on its quoted row: nothing used', () => {
    const bad = { ...rec, quotes: { ...rec.quotes, revenue_line: 'Total income 12,357.67' } };
    const o = overlayResultsPdf(old, bad, '2026-10-03');
    assert.equal(o.financials_source, 'screener-worker');
    assert.match(o._results_pdf_skipped, /revenue is not on the quoted PDF row/);
  });
  test('same quarter: Screener stays, a disagreement is recorded (not overwritten)', () => {
    const same = { sales_curr_cr: 130, sales_prev_cr: 98.77, pat_curr_cr: 11.2, latest_quarter_end_iso: '2026-09-30', financials_source: 'screener-worker' };
    const o = overlayResultsPdf(same, rec, '2026-10-03');
    assert.equal(o.sales_curr_cr, 130);
    assert.equal(o.financials_source, 'screener-worker');
    assert.equal(o._results_pdf_disagreement.fields.length, 1);
    assert.equal(o._results_pdf_disagreement.fields[0].field, 'sales_curr_cr');
    assert.equal(o._results_pdf_disagreement.fields[0].pdf, 123.46);
    assert.match(o._results_pdf_disagreement.fields[0].quote, /Revenue from operations/);
    const agree = { ...same, sales_curr_cr: 123.4 };
    assert.equal(resultsPdfDisagreements(agree, rec).length, 0);
    assert.equal(overlayResultsPdf(agree, rec, '2026-10-03'), agree, 'agreement: untouched');
  });
});

describe('zzz898 — Small & mid only', () => {
  test('ceiling matches the India Conviction Beats preset', () => {
    assert.equal(SMALL_MID_MAX_CR, CB_SMALL_MID_MAX_CR);
  });
  test('unknown size stays; known large caps go only when on', () => {
    assert.equal(passesSmallMid(null, true), true);
    assert.equal(passesSmallMid(undefined, true), true);
    assert.equal(passesSmallMid(0, true), true, 'zero is not a size');
    assert.equal(passesSmallMid(29_999, true), true);
    assert.equal(passesSmallMid(30_000, true), false);
    assert.equal(passesSmallMid(150_000, true), false);
    assert.equal(passesSmallMid(150_000, false), true);
    assert.equal(knownCapCr('1200'), 1200);
    assert.equal(knownCapCr('abc'), null);
  });
  test('counts', () => {
    const rows = [{ c: 100 }, { c: 40_000 }, { c: null }, { c: 0 }, { c: 31_000 }];
    assert.deepEqual(smallMidCounts(rows, (r) => r.c), { hiddenLarge: 2, unknown: 2 });
  });
});
