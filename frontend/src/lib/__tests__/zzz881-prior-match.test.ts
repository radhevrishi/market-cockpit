import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earlierPriorMismatch, growthScopeIssue } from '../guidance-prior-match';

const P = (raw: string, low: number, high: number) => ({ raw: `${raw} (earlier guidance: Earnings call transcript (X), 2026-05-01)`, low, high });
const A = (raw: string, low: number, high: number) => ({ raw, low, high });
test('wrong India "raises" from earlier documents are refused, real ones kept', () => {
  const bad: Array<[string, any, any, string]> = [
    ['ACC', P('Cement demand is expected to remain soft at ~5% for FY27.', 5, 5), A('continue with our estimation and guidance of 8% growth, which we are targeting', 8, 8), 'REVENUE_GROWTH'],
    ['EFCIL', P('we are expecting that about around 40% growth rate is fairly achievable', 40, 40), A('the growth target that we have of more than around 50% under the D&B segment on a Y-o-Y basis.', 50, 50), 'REVENUE_GROWTH'],
    ['PSB', P('For the current year we expect a deposit growth of 13% to 14%.', 13, 14), A('Advances Growth (YoY) 19.35% 16-18%', 16, 18), 'REVENUE_GROWTH'],
    ['SIYSIL', P('We have about INR 50 crores to INR 60 crores of regular maintenance capex', 50, 60), A('The capital expenditure that we had envisaged for this year was close to about INR100 crores', 100, 100), 'FCF'],
    ['UJJIVAN', P('our confidence in achieving our FY27 planned asset growth of 25%', 25, 25), A('Q1 loan book growth of approximately 29% year-on-year with GNPA at 2.2% is testament to our continued execution.', 29, 29), 'REVENUE_GROWTH'],
    ['FILATEX', P('(Capex - ₹ 300 Cr, EBITDA - ~₹75-80 crore pa. at steady state)', 75, 80), A("I never given INR70. Maybe a misprint. It's always INR80 crores to INR85 crores", 80, 85), 'EBITDA'],
    ['CMS', P('₹2,650–2,750 Cr Services revenue', 2650, 2750), A('The total revenue, including product revenue, is estimated accordingly at INR2,750 crores to INR2,850 crores.', 2750, 2850), 'REVENUE'],
    ['BAJFIN', P("In terms of AUM, we're confident of a 20% to 24% AUM growth", 20, 24), A('this 22% to 24% corridor that we have given for AUM growth', 22, 24), 'REVENUE_GROWTH'],
  ];
  for (const [n, b, a, m] of bad) assert.ok(earlierPriorMismatch(b, a, m), n);
  assert.equal(earlierPriorMismatch(P('aim to grow in the range of 25% to 30% in the coming year.', 25, 30), A('Estimated Revenue growth in FY27--- YoY growth: 40-50%+', 40, 50), 'REVENUE_GROWTH'), null);
  assert.equal(earlierPriorMismatch(P('help us to achieve INR1,500 crores revenue in FY 28.', 1500, 1500), A('we have revised our FY 28 revenue target to more than ₹ 1,600 crore.', 1600, 1600), 'REVENUE'), null);
  // a lower figure is still compared (a cut is a cut)
  assert.equal(earlierPriorMismatch(P('revenue of ₹1,500 crore in FY28', 1500, 1500), A('FY28 revenue target now ₹1,400 crore', 1400, 1400), 'REVENUE'), null);
});
test('growth ranking keeps company-wide guidance only', () => {
  assert.ok(growthScopeIssue('Revenue from the derivatives and specialty segment to be ~ 70% by FY28E', 'REVENUE'));
  assert.ok(growthScopeIssue('AUM expanded 61% YoY and 13% QoQ to ₹8,001 Cr', 'REVENUE'));
  assert.ok(growthScopeIssue('We are looking into having a growth of 40%, 45% in our exports for this financial year.', 'REVENUE'));
  assert.ok(growthScopeIssue('we expect Odisha volumes to grow 39% year-on-year', 'REVENUE'));
  assert.ok(growthScopeIssue('you start with about 80%, 85% visibility and you build the balance', 'REVENUE'));
  assert.equal(growthScopeIssue('this year our consolidated turnover should be between INR1,500 crores to INR1,750 crore.', 'REVENUE'), null);
  assert.equal(growthScopeIssue("we maintain that revenue guidance of 75% growth over the previous year", 'REVENUE'), null);
  assert.equal(growthScopeIssue("we'll continue to grow our business by about 40% YoY.", 'REVENUE'), null);
});
