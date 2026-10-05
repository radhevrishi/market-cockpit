// zzz880 — India guidance is compared with the company's own EARLIER documents (the ledger loop left India at 0 upgrades).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractedEvents, partitionPipeline } from '../guidance-upgrades';
import type { GuidanceExtractResult, ExtractedGuidance } from '../guidance-docs-types';

const row = (o: Partial<ExtractedGuidance>): ExtractedGuidance => ({
  metric: 'REVENUE', metricLabel: 'consolidated revenue', period: 'FY27', periodKind: 'ANNUAL', basis: 'REPORTED', currency: 'INR', unit: 'crore', low: null, high: null, status: 'NEW',
  quote: 'quote', confidence: 0.9, ...o,
});
const res = (o: Partial<GuidanceExtractResult>): GuidanceExtractResult => ({
  docId: 'd', market: 'IN', ticker: 'ACME', company: 'Acme Ltd', docUrl: 'https://acme.example/t.pdf', docKind: 'TRANSCRIPT', filedAt: '2026-05-27', extractedAt: '2026-10-02T06:00:00Z',
  model: 'test', status: 'ok', rows: [], dropped: 0, ...o,
});
const MAY = res({ docId: 'acme-may', filedAt: '2026-05-27', rows: [row({ low: 5000, high: 5500, quote: 'For FY27 we guide revenue of ₹5,000 to 5,500 crore.' })] });
const AUG = res({ docId: 'acme-aug', filedAt: '2026-08-13', docUrl: 'https://acme.example/aug.pdf', rows: [row({ low: 6000, high: 6500, quote: 'For FY27 we now see revenue of ₹6,000 to 6,500 crore.' })] });
const OCT = new Date('2026-09-01T09:00:00Z');   // both documents inside the 120-day window

describe('zzz880 — earlier company documents are the prior guidance', () => {
  test('a higher range for the same metric and year, filed later, is a raise compared with the earlier document', () => {
    const evs = buildExtractedEvents([MAY, AUG], () => ({}), OCT, '120D');
    const aug = evs.find((e) => e.announcement_date === '2026-08-13')!;
    const may = evs.find((e) => e.announcement_date === '2026-05-27')!;
    assert.equal(may.taxonomy, 'first_guidance', 'the earliest document has nothing before it');
    const ch = aug.changes.find((c) => c.metric === 'REVENUE')!;
    assert.equal(ch.direction, 'UP'); assert.equal(ch.before!.low, 5000);
    assert.match(String(ch.before!.raw), /earlier guidance: .*2026-05-27/);
    assert.notEqual(aug.taxonomy, 'first_guidance');
    assert.ok(partitionPipeline([aug]).cards.length + partitionPipeline([aug]).audit.length >= 1, 'shown, not queued as first guidance');
  });
  test('same day, another company, another year: no comparison', () => {
    const sameDay = res({ docId: 'acme-may-pr', filedAt: '2026-05-27', rows: [row({ low: 5200, high: 5600 })] });
    const other = res({ docId: 'beta', ticker: 'BETA', company: 'Beta Ltd', filedAt: '2026-08-13', rows: [row({ low: 6000, high: 6500 })] });
    const fy28 = res({ docId: 'acme-fy28', filedAt: '2026-08-14', rows: [row({ period: 'FY28', low: 7000, high: 7500 })] });
    const evs = buildExtractedEvents([MAY, sameDay, other, fy28], () => ({}), OCT, '120D');
    for (const e of evs) assert.equal(e.taxonomy, 'first_guidance', `${e.ticker} ${e.announcement_date}`);
  });
  test('a lower range later is a downgrade, an equal one a reiteration', () => {
    const low = res({ docId: 'acme-low', filedAt: '2026-08-13', rows: [row({ low: 4500, high: 4800 })] });
    const same = res({ docId: 'acme-same', filedAt: '2026-08-13', rows: [row({ low: 5000, high: 5500 })] });
    assert.equal(buildExtractedEvents([MAY, low], () => ({}), OCT, '120D').find((e) => e.announcement_date === '2026-08-13')!.changes[0].direction, 'DOWN');
    assert.equal(buildExtractedEvents([MAY, same], () => ({}), OCT, '120D').find((e) => e.announcement_date === '2026-08-13')!.taxonomy, 'reiteration');
  });
});

import { normPeriod, periodFacts } from '../guidance-universe-integrity';
import { extractedPeriod } from '../guidance-upgrades';
describe('zzz880 — "FY26-27" is one Indian fiscal year', () => {
  test('a one-year span collapses, a real span stays', () => {
    for (const p of ['FY26-27', 'FY2026-27', 'FY 2026-2027', 'fy26–27']) assert.equal(normPeriod(p), 'FY27', p);
    assert.equal(extractedPeriod('FY2026-27'), 'FY27');
    assert.equal(normPeriod('FY25-28'), 'FY25-28'); assert.equal(extractedPeriod('FY27-FY29'), 'FY27-29');
    assert.equal(normPeriod('FY99-00'), 'FY00');
    const f = periodFacts('FY26-27', 'FY');
    assert.equal(f.durationType, 'ANNUAL'); assert.equal(f.cohort, 'ANNUAL'); assert.equal(f.fiscalYear, 2027);
  });
});

describe('zzz880 — only like-for-like figures are compared across documents', () => {
  const OCT2 = new Date('2026-09-01T09:00:00Z');
  test('"other" metrics, different units and same-day copies are not compared / not doubled', () => {
    const a = res({ docId: 'o1', filedAt: '2026-06-01', rows: [row({ metric: 'OTHER' as any, metricLabel: 'store count', unit: '', currency: null, low: 25, high: 25 })] });
    const b = res({ docId: 'o2', filedAt: '2026-08-01', rows: [row({ metric: 'OTHER' as any, metricLabel: 'capex', unit: '', currency: null, low: 200, high: 200 })] });
    for (const e of buildExtractedEvents([a, b], () => ({}), OCT2, '120D')) assert.ok(e.changes.every((c) => !c.before), 'no cross-document comparison for OTHER');
    const lakh = res({ docId: 'l1', filedAt: '2026-08-01', rows: [row({ unit: 'lakh crore', low: 1, high: 1 })] });
    const e2 = buildExtractedEvents([MAY, lakh], () => ({}), OCT2, '120D').find((e) => e.announcement_date === '2026-08-01')!;
    assert.ok(e2.changes.every((c) => !c.before || c.before.unit === c.after.unit));
    const pr = res({ docId: 'p1', filedAt: '2026-08-13', rows: [row({ low: 6000, high: 6500 })] });
    const ppt = res({ docId: 'p2', filedAt: '2026-08-13', docKind: 'INVESTOR_PRESENTATION' as any, rows: [row({ low: 6000, high: 6500 })] });
    assert.equal(buildExtractedEvents([pr, ppt], () => ({}), OCT2, '120D').length, 1);
  });
});

import { mergeIndiaBench } from '../fundamentals/universe';
describe('zzz880 — a removal hides that result, a newer filing comes back', () => {
  test('dated removals', () => {
    const server = [{ ticker: 'AAA', company: 'A', tier: 'STRONG', filing_date: '2026-10-03' }, { ticker: 'BBB', company: 'B', tier: 'STRONG', filing_date: '2026-08-10' }, { ticker: 'CCC', company: 'C', tier: 'STRONG', filing_date: '2026-09-01' }];
    const mg = mergeIndiaBench(server, [], [{ ticker: 'AAA', filing_date: '2026-08-12' }, { ticker: 'BBB', filing_date: '2026-08-10' }, 'CCC']);
    assert.deepEqual(mg.names.map((n) => n.symbol), ['AAA'], 'AAA filed again after its removal; BBB same filing; CCC removed without a date');
    assert.equal(mg.removed, 2);
  });
});
