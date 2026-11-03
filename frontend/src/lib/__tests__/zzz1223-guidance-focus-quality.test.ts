// zzz1223 — Guidance Upgrades focus list: figures that are not a target for the year, unit-less "raises" and bond issuers (3 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growthStatementHold as hold } from '../guidance-prior-match';
import { raiseLine, listedSymbol } from '../gu-focus';

test('capacity, run-rate, what-if, collections and merger figures are held with a reason', () => {
  assert.match(hold('The Company is targeting revenue potential of more than ₹4,500 crore by FY28,', 'REVENUE', 67)!, /potential/);
  assert.match(hold('Full utilization would be an annual sale of about 55 crore litres. So that will give us a revenue of close to about INR4,000 crores', 'REVENUE', 45)!, /potential/);
  assert.match(hold("Roughly the run rate, annualized run rate, should be around INR650-odd crores for '27", 'REVENUE', 75)!, /run-rate/);
  assert.match(hold('So, assuming that the 1 gigawatt fetches you Rs. 2,000 crore, we should be able to do Rs. 4,000 crore', 'REVENUE', 35)!, /what-if/);
  assert.match(hold('we have guided the residential collection in the range of INR21,000 crores to INR22,000 crores', 'REVENUE', 61)!, /collections/);
  assert.match(hold('Targeting consolidated revenue of ₹325 cr by FY2027 post merger', 'REVENUE', 134)!, /merger/);
  assert.match(hold('Expected revenues of 5,000 - 6,000 Cr and PAT of ~1,500 Cr (MLDL share)', 'NET_PROFIT', 403)!, /names no year/);
});

test('real targets stay', () => {
  for (const [s, g] of [
    ['On that basis, we are firmly on track to deliver a full year top line in the range of INR4,300 crores to INR4,500 crores.', 90],
    ['FY27 we will be close to -- we are estimating around INR840 crores against past year\'s number of INR645 crores.', 30],
    ['in FY27 only, we are expecting somewhere about INR 350 crores kind of PAT.', 77],
    ['Revenue from Operation ₹875 – 910 Cr.', 55],
    ['Exceeding 1100 crores.', 58],
  ] as Array<[string, number]>) assert.equal(hold(s, 'REVENUE', g), null, s);
});

const ev = (before: any, after: any, metric = 'REVENUE') => ({ changes: [{ metric, direction: 'UP', before, after, percentageChange: ((after.midpoint - before.midpoint) / before.midpoint) * 100 }] }) as any;
test('a money "raise" with no currency or unit is not a raise (Mammoth: a count read as revenue)', () => {
  assert.equal(raiseLine(ev({ period: 'FY26', midpoint: 23, low: 23, high: 23, unit: '', raw: '23' }, { period: 'FY26', midpoint: 30, low: 30, high: 30, unit: '', raw: 'revenue-producing as of September 30,' })), null);
  assert.ok(raiseLine(ev({ period: 'FY26', midpoint: 111, low: 111, high: 111, unit: 'M', currency: '$' }, { period: 'FY26', midpoint: 161, low: 161, high: 161, unit: 'M', currency: '$' })));
});

test('a bond issuer is not a listed symbol', () => {
  assert.equal(listedSymbol('US', 'FORD MOTOR CREDIT CO LLC'), false);
  assert.equal(listedSymbol('US', 'BRK.B'), true);
  assert.equal(listedSymbol('IN', 'M&M'), true);
  assert.equal(listedSymbol('IN', 'BAJAJ-AUTO'), true);
});

test('fair value uses the company\'s guided full-year revenue instead of growing a quarter × 4 base (Sterling)', async () => {
  const { fvGrowthOf, guidedRevenueInFactsUnit } = await import('../gu-fair-value');
  assert.equal(guidedRevenueInFactsUnit({ value: 4.68, unit: 'B', currency: '$' }, 'US'), 4680);
  assert.equal(guidedRevenueInFactsUnit({ value: 250, unit: 'Cr', currency: '₹' }, 'IN'), 250);
  assert.equal(guidedRevenueInFactsUnit({ value: 30, unit: '', currency: '' }, 'US'), null);
  const g = fvGrowthOf({ growthPct: null, growthTrust: null, raiseDetail: { metric: 'REVENUE', afterMid: 4.68, isGrowthRate: false, periodKind: 'FY', unit: 'B', currency: '$', period: 'FY26' } });
  assert.deepEqual(g?.guidedRevenue, { value: 4.68, unit: 'B', currency: '$', period: 'FY26' });
});
