import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fcfVsPrice, passesFcfFilters, toggleFcfFilter } from '../company-lab/fcf-filter';
import { splitByView } from '../catalyst/cross-view';

const yrs = (fcf: number[], px: number[]) => fcf.map((f, i) => ({ label: `FY${20 + i}`, fcfPs: f, priceAtEnd: px[i], fcfYield: null }));

test('FCF/share growth vs price growth over the chosen span', () => {
  const v = fcfVsPrice(yrs([1, 1.5, 2, 3], [50, 52, 55, 60]), 60, 3);
  assert.equal(v.fcfG, 200); assert.equal(v.priceG, 20); assert.equal(v.gap, 180);
  assert.ok(v.faster && v.rising && v.positive);
  assert.equal(v.yieldNow, 5); assert.equal(v.lowBase, false);
  assert.equal(fcfVsPrice(yrs([0.1, 5], [50, 60]), 60, 3).lowBase, true);
  assert.ok(passesFcfFilters(v, new Set(['faster', 'flat'] as any)) === false);   // price +20% is not flat
  assert.ok(passesFcfFilters(v, new Set(['faster', 'yield5', 'rising'] as any)));
  const one = fcfVsPrice(yrs([1, 1.5, 2, 3], [50, 52, 55, 60]), 60, 1);
  assert.equal(one.from, 'FY22'); assert.equal(one.fcfG, 50);
});

test('a negative FCF year gives no growth and fails "faster"', () => {
  const v = fcfVsPrice(yrs([-1, 1, 2], [10, 12, 14]), 14, 3);
  assert.equal(v.fcfG, null); assert.ok(!v.faster); assert.match(v.why, /negative/);
  assert.ok(!passesFcfFilters(v, new Set(['faster'] as any)));
  assert.ok(passesFcfFilters(v, new Set(['positive'] as any)));
});

test('Special Focus follows the page view (US Portfolio Catalysts showed the same 20 in every view)', () => {
  const e = [{ pc: { ticker: 'POWL' }, row: { symbol: 'POWL' } }, { pc: { ticker: 'DMLP' }, row: { symbol: 'DMLP' } }];
  assert.equal(splitByView(e, null).here.length, 2);
  const s = splitByView(e, new Set(['POWL']));
  assert.deepEqual(s.here.map((x) => x.pc.ticker), ['POWL']); assert.equal(s.elsewhere.length, 1);
});

test('price ahead of cash is the opposite filter; the two exclude each other', () => {
  const ran = fcfVsPrice(yrs([1, 1.1], [50, 100]), 100, 1);
  assert.ok(passesFcfFilters(ran, new Set(['slower'] as any)) && !passesFcfFilters(ran, new Set(['faster'] as any)));
  const cash = fcfVsPrice(yrs([1, 3], [50, 55]), 55, 1);
  assert.ok(!passesFcfFilters(cash, new Set(['slower'] as any)));
  const s1 = toggleFcfFilter(new Set(['faster', 'yield5'] as any), 'slower');
  assert.deepEqual([...s1].sort(), ['slower', 'yield5']);
});
