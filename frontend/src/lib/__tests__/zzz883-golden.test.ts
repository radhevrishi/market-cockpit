// zzz883 — GOLDEN CASES. These pin financial behaviour that must never change silently. If one fails, the code is wrong,
// or the rule was changed on purpose — then update the case in the same commit and say why.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractedEvents, makeChange, fmtPoint } from '../guidance-upgrades';
import { earlierPriorMismatch } from '../guidance-prior-match';
import type { GuidanceExtractResult, ExtractedGuidance } from '../guidance-docs-types';

const row = (o: Partial<ExtractedGuidance>): ExtractedGuidance => ({
  metric: 'REVENUE', metricLabel: 'consolidated revenue', period: 'FY27', periodKind: 'ANNUAL', basis: 'REPORTED', currency: 'INR', unit: 'crore',
  low: null, high: null, status: 'NEW', quote: 'quote', confidence: 0.9, ...o,
});
const doc = (o: Partial<GuidanceExtractResult>): GuidanceExtractResult => ({
  docId: 'd', market: 'IN', ticker: 'GOLDCO', company: 'Golden Co Ltd', docUrl: 'https://www.nseindia.com/x.pdf', docKind: 'TRANSCRIPT',
  filedAt: '2026-05-20', extractedAt: '2026-10-01T00:00:00Z', model: 'test', status: 'ok', rows: [], dropped: 0, ...o,
});
const NOW = new Date('2026-09-01T09:00:00Z');

describe('golden: guidance upgrade 1,000 → 1,200 Cr', () => {
  const may = doc({ docId: 'g-may', filedAt: '2026-05-20', rows: [row({ low: 1000, high: 1000, quote: 'For FY27 we guide revenue of ₹1,000 crore.' })] });
  const aug = doc({ docId: 'g-aug', filedAt: '2026-08-12', docUrl: 'https://www.nseindia.com/aug.pdf', rows: [row({ low: 1200, high: 1200, quote: 'We now expect FY27 revenue of ₹1,200 crore.' })] });
  const ev = buildExtractedEvents([may, aug], () => ({}), NOW, '120D').find((e) => e.announcement_date === '2026-08-12')!;
  const ch = ev.changes.find((c) => c.metric === 'REVENUE')!;
  test('+20%, direction UP', () => { assert.equal(ch.direction, 'UP'); assert.equal(ch.percentageChange, 20); });
  test('correct fiscal period and old figure', () => { assert.equal(ch.after.period, 'FY27'); assert.equal(ch.before!.low, 1000); });
  test('source is the company document of the new figure, dated', () => { assert.equal(ev.announcement_date, '2026-08-12'); assert.match(String(ch.before!.raw), /earlier guidance: .*2026-05-20/); });
  test('shown as an upgrade (not first guidance)', () => { assert.equal(ev.taxonomy, 'formal_upgrade'); assert.equal(ev.verification, 'VERIFIED'); });
});

describe('golden: what is NOT a raise', () => {
  const P = (raw: string, low: number, high: number) => ({ raw: `${raw} (earlier guidance: Earnings call transcript (X), 2026-05-01)`, low, high });
  test('industry growth vs company guide (ACC)', () => assert.ok(earlierPriorMismatch(P('Cement demand is expected to remain soft at ~5% for FY27.', 5, 5), { raw: 'our guidance of 8% growth', low: 8, high: 8 }, 'REVENUE_GROWTH')));
  test('a segment vs the company (EFC D&B)', () => assert.ok(earlierPriorMismatch(P('about 40% growth rate is fairly achievable', 40, 40), { raw: 'growth target of more than around 50% under the D&B segment', low: 50, high: 50 }, 'REVENUE_GROWTH')));
  test('a narrowed range (Bajaj 20–24% → 22–24%)', () => assert.ok(earlierPriorMismatch(P('AUM growth of 20% to 24%', 20, 24), { raw: 'the 22% to 24% corridor for AUM growth', low: 22, high: 24 }, 'REVENUE_GROWTH')));
  test('a lower figure is still compared (a cut is a cut)', () => assert.equal(earlierPriorMismatch(P('FY28 revenue of ₹1,500 crore', 1500, 1500), { raw: 'FY28 revenue target now ₹1,400 crore', low: 1400, high: 1400 }, 'REVENUE'), null));
});

describe('golden: arithmetic and display', () => {
  test('percentage change uses the midpoints', () => {
    const p = (lo: number, hi: number) => ({ metric: 'REVENUE', period: 'FY26', low: lo, high: hi, midpoint: (lo + hi) / 2, isGrowthRate: false } as any);
    assert.equal(makeChange(p(1638, 1648), p(1685, 1693)).percentageChange, 2.7998)   // (1689 − 1643) ÷ 1643;
  });
  test('a growth-rate change is in percentage points, never %', () => {
    const g = (lo: number, hi: number) => ({ metric: 'REVENUE_GROWTH', period: 'FY27', low: lo, high: hi, midpoint: (lo + hi) / 2, isGrowthRate: true } as any);
    const c = makeChange(g(25, 30), g(40, 50));
    assert.equal(c.percentagePointChange, 17.5); assert.equal(c.percentageChange, null);
  });
  test('ranges never print equal ends', () => assert.equal(fmtPoint({ low: 1.685, high: 1.693, currency: '$', unit: 'B' } as any), '$1.685–1.693B'));
});
