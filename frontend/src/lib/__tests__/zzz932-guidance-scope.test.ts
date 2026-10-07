// zzz932 — four live Guidance Upgrades rows (7 Oct 2026): a fiscal year taken from the sentence, and segment / book / product-line figures kept out of company growth.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scopeIssueOf, fiscalYearNamedIn } from '../guidance-horizon';
import { itemsFromExtracted } from '../guidance-universe';
import type { ExtractedGuidance, GuidanceExtractResult } from '../guidance-docs-types';

const NOW = new Date('2026-10-07T09:00:00Z');
const Q = {
  KMTS: 'Increased FY27 revenue guidance to $141 million, representing growth of 48% compared to FY26.',
  MOD: 'Data Centers +60% to +80%',
  CSB: 'On the growth guidance - wholesale will continue to grow the way it is growing at this point of time, which is somewhere between 35% to 40%.',
  FLAIR: 'Creative and Steel Bottles will, of course, higher number digits, like about almost 40%.',
};
function row(o: Partial<ExtractedGuidance>): ExtractedGuidance {
  return { metric: 'REVENUE_GROWTH', metricLabel: 'revenue growth', period: 'FY27', periodKind: 'ANNUAL', basis: 'UNSTATED', currency: null, unit: '%', low: null, high: null,
    growthPctLow: null, growthPctHigh: null, status: 'NEW', prior: null, priorActual: null, quote: '', speaker: null, confidence: 0.9, ...o } as ExtractedGuidance;
}
function xres(ticker: string, company: string, rows: ExtractedGuidance[], market: 'IN' | 'US' = 'IN'): GuidanceExtractResult {
  return { docId: createHash('sha1').update(ticker).digest('hex').slice(0, 20), market, ticker, company, docUrl: `https://example.com/${ticker}.pdf`,
    docKind: 'TRANSCRIPT', filedAt: '2026-08-13T00:00:00.000Z', extractedAt: '2026-10-05T00:00:00Z', model: 'test', status: 'ok', rows, dropped: 0 } as GuidanceExtractResult;
}
const sc = (q: string, company = 'Zed Ltd', market: 'IN' | 'US' = 'IN') => scopeIssueOf(q, { metric: 'REVENUE', market, company, metricLabel: 'revenue growth' });

describe('zzz932', () => {
  test('1 · KMTS: the fiscal year comes from the sentence', () => {
    assert.equal(fiscalYearNamedIn(Q.KMTS), 'FY27');
    assert.equal(fiscalYearNamedIn('We expect growth of 30% in fiscal 2027 versus fiscal 2026.'), 'FY27');
    assert.equal(fiscalYearNamedIn('We grew 30% in FY26 and expect 25% in FY27'), null, 'past result + another year: not decided from the words');
    assert.equal(fiscalYearNamedIn('We expect strong growth of 30%'), null);
    const [it] = itemsFromExtracted([xres('KMTS', 'Kestra Medical Technologies, Ltd.', [row({ quote: Q.KMTS, growthPctLow: 48, growthPctHigh: 48, period: 'FY26' })], 'US')], null, NOW);
    assert.equal(it.period, 'FY27');
  });
  test('1b · a row whose sentence names no year keeps its period', () => {
    const [it] = itemsFromExtracted([xres('ZED', 'Zed Ltd', [row({ quote: 'We expect revenue growth of 25% next year.', growthPctLow: 25, growthPctHigh: 25, period: 'FY27' })])], null, NOW);
    assert.equal(it.period, 'FY27');
  });
  test('2 · MOD: a "Data Centers" table row is a part', () => {
    assert.match(sc(Q.MOD, 'MODINE MANUFACTURING CO', 'US')!, /Data Centers/);
    const items = itemsFromExtracted([xres('MOD', 'MODINE MANUFACTURING CO', [row({ quote: Q.MOD, growthPctLow: 60, growthPctHigh: 80 })], 'US')], null, NOW);
    assert.ok(items.every((i) => i.needsReview && /one part of the company/.test(i.needsReview)));
  });
  test('3 · CSB Bank: wholesale / book words are not revenue', () => {
    assert.match(sc(Q.CSB, 'CSB Bank Limited')!, /book \/ segment/);
    assert.match(sc('Gold, I think we should be growing around 30% to 35%, somewhere in that range.', 'CSB Bank Limited')!, /book \/ segment/);
    assert.match(sc('Gold loan portfolio should grow 25% to 30%')!, /book \/ segment/);
    assert.equal(itemsFromExtracted([xres('CSBBANK', 'CSB Bank Limited', [row({ quote: Q.CSB, growthPctLow: 35, growthPctHigh: 40 })])], null, NOW).length, 0);
    assert.equal(sc('Revenue from wholesale will grow 20% this year'), null, 'a sentence that says revenue stays');
  });
  test('4 · FLAIR: a named product line is a part', () => {
    assert.match(sc(Q.FLAIR, 'Flair Writing Industries Limited')!, /Creative and Steel Bottles/);
    const items = itemsFromExtracted([xres('FLAIR', 'Flair Writing Industries Limited', [row({ quote: Q.FLAIR, growthPctLow: 40, growthPctHigh: 40 })])], null, NOW);
    assert.ok(items.every((i) => i.needsReview && /one part of the company/.test(i.needsReview)));
  });
  test('company-wide sentences that mention a segment, or plain guides, still pass', () => {
    assert.equal(sc('With a continued strong growth momentum in the non-GPL portfolio and muted growth in the GPL business, we remain confident of achieving revenue growth of 10% - 12% in FY27', 'Alivus Life Sciences Limited'), null);
    assert.equal(sc('We will grow 30% this year'), null);
    assert.equal(sc('Revenue +25% to +30%'), null);
    assert.equal(sc('Management expects growth of about 20%'), null);
    assert.equal(sc('Growth +20%'), null);
  });
});
