// zzz888 — catalyst EPS / FCF impact. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impactBaseOf, catalystImpact, catalystsFromLedger } from '../thesis/catalyst-impact';

const base = impactBaseOf({ quarters_sales: [90, 100, 100, 100, 100], quarters_pat: [9, 10, 10, 10, 10], opm_pct: 18 });
test('base = last four quarters', () => { assert.equal(base.salesCr, 400); assert.equal(base.patCr, 40); });
test('an order win of ₹200 Cr: ₹100 Cr/yr, ₹10 Cr profit (10% margin), EPS +25%, working capital out first', () => {
  const m = catalystImpact(base, { kind: 'ORDER_WIN', valueCr: 200, label: 'Order ₹200 Cr' });
  assert.equal(m.revenueCr, 100); assert.equal(m.patCr, 10); assert.equal(m.epsPct, 25); assert.equal(m.fcfYear1Cr, -24.7);
  assert.match(m.line, /EPS \+25%/); assert.ok(m.assumptions.some((a) => /2 years/.test(a)));
});
test('an order book only counts revenue above today\'s sales', () => {
  const small = catalystImpact(base, { kind: 'ORDER_BOOK', valueCr: 400, label: 'Book' });   // 1 year of sales: nothing new
  assert.equal(small.revenueCr, 0);
  const big = catalystImpact(base, { kind: 'ORDER_BOOK', valueCr: 2000, label: 'Book' });     // capped at 4 years → 500/yr → +100
  assert.equal(big.revenueCr, 100);
});
test('capex: revenue at 1.5× turnover, the capex is the first-year cash out', () => {
  const m = catalystImpact(base, { kind: 'CAPEX', valueCr: 100, label: 'Capex' });
  assert.equal(m.revenueCr, 150); assert.equal(m.fcfYear1Cr, -100); assert.equal(m.epsPct, 37.5);
});
test('missing figures give no number and say what is missing', () => {
  const m = catalystImpact(impactBaseOf({}), { kind: 'ORDER_WIN', valueCr: 100, label: 'Order' });
  assert.equal(m.revenueCr, null); assert.match(m.line, /no estimate — missing annual sales, profit margin/);
});
test('ledger: only FOUND crore figures become catalysts; a lakh figure or a target does not', () => {
  const led = { latest_period: 'Q1 FY27', periods: { 'Q1 FY27': { variables: {
    order_book: { state: 'FOUND', numeric: 1200, unit: '₹ Cr', value: '₹1,200 crore', source_name: 'Concall' },
    capex: { state: 'NOT_DISCLOSED', numeric: null, unit: null, value: null },
    order_intake: { state: 'FOUND', numeric: 50, unit: 'lakh', value: '₹50 lakh' },
    capacity_addition: { state: 'FOUND', numeric: 40, unit: '%', value: '40%' } } } } };
  const c = catalystsFromLedger(led);
  assert.deepEqual(c.map((x) => x.kind), ['ORDER_BOOK', 'CAPACITY_ADD']);
});
