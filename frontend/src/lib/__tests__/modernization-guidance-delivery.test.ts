import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredRemaining, type OppRow } from '../gu-opportunity';
import { emptyFacts, type SkyFacts } from '../gu-skygold-facts';
const row = (growthPct: number): OppRow => ({ market: 'IN', growthPct, growthTrust: 'verified', growthType: 'EXPLICIT', growthMetric: 'REVENUE', growthMetrics: ['REVENUE'], growthCohort: 'ANNUAL', growthPeriod: 'FY27', raised: null, smallRaise: false, raiseDetail: null, cutDate: null });
const facts = (): SkyFacts => ({ ...emptyFacts('IN', 'SYNTHETIC', 'synthetic simulation'), quarters: { labels: ['Jun 2025','Sep 2025','Dec 2025','Mar 2026','Jun 2026','Sep 2026'], sales: [200,240,260,300,260,300], op: [], pat: [] }, years: { labels: ['Mar 2026'], sales: [1000], op: [], pat: [] } });
test('remaining sales requirement reaches actual annual guidance, including above the valuation cap', () => {
  for (const [growth, need] of [[40,50],[100,157.1],[180,300]]) {
    const result = requiredRemaining(row(growth), facts());
    assert.equal(result.computed, true); assert.equal(result.needPct, need);
    assert.match(result.text, new RegExp('\\+' + growth + '% for the year'));
    const priorRemaining = 560;
    const delivered = 560 + priorRemaining * (1 + result.needPct! / 100);
    assert.ok(Math.abs(delivered - 1000 * (1 + growth / 100)) < 1);
  }
});
test('missing prior-year or YTD data does not produce a delivery requirement', () => {
  const f = facts(); f.years = null; assert.equal(requiredRemaining(row(180), f).computed, false);
  const missing = facts(); missing.quarters!.sales[1] = null;
  assert.equal(requiredRemaining(row(180), missing).computed, false);
});
test('US and multi-year guidance retain their unavailable calculation fallback', () => {
  const f = facts(); f.market = 'US'; assert.equal(requiredRemaining(row(180), f).computed, false);
  assert.equal(requiredRemaining({ ...row(180), growthCohort: 'MULTI_YEAR_CAGR' }, facts()).computed, false);
});

import { buildFocusList, focusGrowthHorizon } from '../gu-focus';
test('horizon selection preserves a company annual target hidden by a larger multi-year target', () => {
  const make = (cohort: string, growth: number): any => ({ id: cohort, rank: 1, entityKey: 'IN|SYNTHETIC', company: 'Synthetic', ticker: 'SYNTHETIC', market: 'IN', cohort, trust: 'verified', text: `Revenue +${growth}%`, metrics: [], headline: { compareValue: growth, metric: 'REVENUE', period: 'FY27', growthType: 'EXPLICIT', freshness: 'STALE', lastVerifiedDaysAgo: 80 }, sourceName: 'Synthetic document', sourceDate: '2026-07-01', sourceUrl: 'https://example.com/synthetic' });
  const groups: any = { cohorts: { ANNUAL: [make('ANNUAL',40)], MULTI_YEAR_CAGR: [make('MULTI_YEAR_CAGR',60)], QUARTERLY: [] } };
  const build = (h: 'ALL' | 'ANNUAL' | 'MULTI_YEAR_CAGR') => buildFocusList(focusGrowthHorizon(groups,h), [], new Date('2026-10-07'), Infinity);
  assert.equal(build('ALL')[0].growthPct, 60); assert.equal(build('ANNUAL')[0].growthPct, 40); assert.equal(build('MULTI_YEAR_CAGR')[0].growthPct, 60);
  assert.equal(groups.cohorts.ANNUAL.length, 1); assert.equal(groups.cohorts.MULTI_YEAR_CAGR.length, 1);
  assert.equal(build('ANNUAL')[0].growthFreshness, 'STALE'); assert.equal(build('ANNUAL')[0].growthVerifiedDaysAgo,80);
  assert.equal(build('ANNUAL')[0].growthSourceUrl, 'https://example.com/synthetic');
});
