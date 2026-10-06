// zzz895 — growth figure vs its quoted sentence. Quotes from the owner's screen (Oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growthQuoteIssue, quoteHasNumber } from '../guidance-growth-quote';

test('the figure must be in the quote', () => {
  assert.ok(quoteHasNumber('our PAT numbers anywhere between 12% to 15%.', 12));
  assert.ok(!quoteHasNumber('a pipeline of nearly 215 crore', 15));
  assert.match(growthQuoteIssue('In addition, we have actively pursuing a pipeline of nearly 215 crore, providing strong revenue visibility going forward.', 15, 20, 'REVENUE', { annual: true })!, /does not contain/);
});
test('growth over several years is not one year', () => {
  assert.match(growthQuoteIssue('We are planning to achieve growth of around 60% to 80%, or even 70% to 80%, over the next four to five years.', 60, 80, 'REVENUE', { annual: true })!, /several years/);
  assert.equal(growthQuoteIssue('Revenue CAGR of 30% over the next three years', 30, 30, 'REVENUE', { annual: false }), null);
});
test('AUM growth is not revenue growth; a revenue sentence passes', () => {
  assert.match(growthQuoteIssue("We have committed, that 50% to 60% of AUM growth at the start of this financial year, we'll continue to pursue that.", 50, 60, 'REVENUE', { annual: true })!, /AUM/);
  assert.equal(growthQuoteIssue('Estimated Revenue growth in FY27 — YoY growth: 40-50%.', 40, 50, 'REVENUE', { annual: true }), null);
  assert.equal(growthQuoteIssue('our PAT numbers anywhere between 12% to 15%.', 12, 15, 'PAT', { annual: true }), null);
  assert.equal(growthQuoteIssue('', 40, 50, 'REVENUE', { annual: true }), null);
});

import { buildFocusList, raiseLine } from '../gu-focus';
test('a +3.5 pp growth-rate raise (Kfin 10% → 12–15%) is RAISED, not STRONG RAISE, and says "growth"', () => {
  const ev: any = { guidance_event_id: 'k', market: 'IN', ticker: 'KFINTECH', company: 'Kfin Technologies Limited', verification: 'VERIFIED', taxonomy: 'formal_upgrade', announcement_date: '2026-07-31', pipeline: { status: 'CARD' },
    changes: [{ metric: 'NET_PROFIT', direction: 'UP', percentagePointChange: 3.5, before: { low: 10, high: 10, midpoint: 10, unit: '%', isGrowthRate: true }, after: { low: 12, high: 15, midpoint: 13.5, unit: '%', isGrowthRate: true, period: 'FY27' } }] };
  assert.match(raiseLine(ev)!.text, /FY27 net profit growth: 10% → 12%–15% \(\+3\.5 pp\)/);
  const r = buildFocusList(null, [ev], new Date('2026-10-06T00:00:00Z'))[0];
  assert.equal(r.verdict, 'RAISED');
});
