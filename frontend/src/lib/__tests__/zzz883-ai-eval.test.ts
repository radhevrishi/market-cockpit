import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDANCE_GOLDEN, scoreCase, summarise, matchRow } from '../ai-eval';

const row = (o: any) => ({ metric: 'REVENUE', metricLabel: 'revenue', period: 'FY27', periodKind: 'ANNUAL', basis: 'REPORTED', currency: 'INR', unit: 'crore', low: null, high: null, status: 'NEW', quote: 'q', confidence: 0.9, ...o });
test('golden set: every passage clears the 200-character minimum; negatives exist', () => {
  for (const c of GUIDANCE_GOLDEN) assert.ok(c.text.length >= 200, c.id);
  assert.ok(GUIDANCE_GOLDEN.filter((c) => c.expect.length === 0).length >= 3);
});
test('matching: growth vs amount, period, unit scale', () => {
  assert.ok(matchRow(row({ metric: 'REVENUE_GROWTH', unit: '%', low: 40, high: 50 }), { family: 'REVENUE', period: 'FY27', growth: true, low: 40, high: 50 }));
  assert.ok(!matchRow(row({ metric: 'REVENUE_GROWTH', unit: '%', low: 40, high: 50, period: 'FY28' }), { family: 'REVENUE', period: 'FY27', growth: true, low: 40, high: 50 }));
  assert.ok(matchRow(row({ low: 1.685, high: 1.693, unit: 'billion', currency: 'USD' }), { family: 'REVENUE', period: 'FY27', growth: false, low: 1685, high: 1693 }));
  assert.ok(!matchRow(row({ metric: 'REVENUE_GROWTH', unit: '%', low: 1600, high: 1600 }), { family: 'REVENUE', period: 'FY28', growth: false, low: 1600, high: 1600 }));
});
test('scoring: precision, recall, false positives on negatives', () => {
  const pos = GUIDANCE_GOLDEN.find((c) => c.id === 'srm-turnover')!;
  const neg = GUIDANCE_GOLDEN.find((c) => c.id === 'neg-industry')!;
  const a = { ...scoreCase(pos, [row({ low: 1500, high: 1750 })] as any), costUsd: 0.003, ms: 900, status: 'ok' };
  const b = { ...scoreCase(neg, [row({ metric: 'REVENUE_GROWTH', unit: '%', low: 5, high: 5 })] as any), costUsd: 0.002, ms: 800, status: 'ok' };
  assert.equal(a.truePos, 1); assert.equal(b.falsePos, 1);
  const s = summarise([a, b], { promptVersion: 'gx-1', model: 'm', at: 'now' });
  assert.equal(s.precision, 0.5); assert.equal(s.recall, 1); assert.equal(s.falsePositiveRate, 1); assert.equal(s.costUsd, 0.005);
});
import { normPeriodEval } from '../ai-eval';
test('period and margin matching are tolerant of format, not of value', () => {
  assert.equal(normPeriodEval('FY2027'), 'FY27'); assert.equal(normPeriodEval('fy 27'), 'FY27'); assert.equal(normPeriodEval('Q1 FY27'), 'Q1FY27');
  const r = (o: any) => ({ metric: 'EBITDA_MARGIN', period: 'FY27', unit: '%', low: 24, high: 24, ...o }) as any;
  assert.ok(matchRow(r({}), { family: 'MARGIN', period: 'FY27', growth: false, low: 23, high: 25 }));
  assert.ok(!matchRow(r({ low: 20, high: 20 }), { family: 'MARGIN', period: 'FY27', growth: false, low: 23, high: 25 }));
});
