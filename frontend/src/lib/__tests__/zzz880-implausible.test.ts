import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implausibleImplied } from '../guidance-universe';
test('zzz880 — a guided amount implying an impossible change against last year is not company guidance', () => {
  const man = { gOrigin: 'IMPLIED', low: -99, high: -98.6, metric: 'REVENUE', abs: { value: 50, valueLow: 35, unit: '₹ Cr' }, base: { value: 3592.5, unit: '₹ Cr', period: 'FY26' } };
  assert.match(implausibleImplied(man)!, /35–50 ₹ Cr against last year's 3592\.5 ₹ Cr would be -99%/);
  assert.equal(implausibleImplied({ ...man, low: 39, high: 53 }), null, 'Man Industries 5,000–5,500 Cr = +39–53%: fine');
  assert.equal(implausibleImplied({ ...man, gOrigin: 'STATED' }), null, 'a stated % is the company\'s own words');
  assert.equal(implausibleImplied({ ...man, metric: 'PAT', low: 300, high: 400 }), null, 'a profit turnaround can be large');
  assert.ok(implausibleImplied({ ...man, low: 900, high: 950 }));
  assert.equal(implausibleImplied({ ...man, pkind: 'MULTI_YEAR_CAGR', low: -99 }), null);
});
