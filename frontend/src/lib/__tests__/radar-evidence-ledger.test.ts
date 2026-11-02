import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRadarEvidenceRecord, periodInQuote, reconcileLedgerMeasurements } from '../concall-evidence-ledger';

const base = {
  symbol: 'EXAMPLE', source_url: 'https://example.com/filing',
  attachment_url: 'https://example.com/filing.pdf', filing_datetime: '2026-10-20T12:00:00Z',
  scored_from: 'PDF' as const,
};

test('speaker is never inferred from presence of PDF or first-person claims', () => {
  const r = buildRadarEvidenceRecord({ ...base,
    evidence_quote: 'We reported EBITDA margin expanded by 300 basis points in Q2 FY27 on stronger production mix.' });
  assert.equal(r.attribution, 'UNKNOWN');
  assert.equal(r.fiscal_period, 'Q2 FY27');
  assert.equal(r.verification, 'NEEDS_ATTRIBUTION');
  assert.ok(r.missing.includes('Speaker not attributed'));
});

test('filing date is never substituted for financial claim period', () => {
  const r = buildRadarEvidenceRecord({ ...base,
    evidence_quote: 'We reported EBITDA margin expanded by 300 basis points on stronger production mix.' });
  assert.equal(r.fiscal_period, null);
  assert.equal(r.verification, 'NEEDS_PERIOD_AND_ATTRIBUTION');
});

test('analyst questions and subject-only rows are rejected', () => {
  const quote = 'Sir, my second question is whether the revenue from liquid cooling has exceeded 30%, can you share details?';
  assert.equal(buildRadarEvidenceRecord({ ...base, evidence_quote: quote }).verification, 'REJECTED');
  assert.equal(buildRadarEvidenceRecord({ ...base, evidence_quote: 'We achieved record revenue Q2 FY27', scored_from: 'SUBJECT' }).verification, 'REJECTED');
});

test('period matches only explicit quotes and not years in arbitrary dates', () => {
  assert.equal(periodInQuote('Revenue Q3 FY2027 rose 22% on prior year.'), 'Q3 FY27');
  assert.equal(periodInQuote('The presentation is dated 20 October 2026.'), null);
});

test('ledger never conflates guidance with actual, or segments, fiscal periods and units', () => {
  const b = { symbol: 'EXAMPLE', metric: 'EBITDA margin', fiscal_period: 'Q2 FY27', segment: 'consolidated',
    basis: 'ACTUAL' as const, unit: '%', value: 28, filing_datetime: '2026-10-20', source_url: 'https://example.com/1' };
  const result = reconcileLedgerMeasurements([
    b, { ...b, value: 20, filing_datetime: '2026-10-25', source_url: 'https://example.com/2' },
    { ...b, value: 20, basis: 'GUIDANCE' as const },
    { ...b, value: 15, segment: 'standalone' }, { ...b, value: 14, fiscal_period: 'Q1 FY27' },
  ]);
  assert.equal(result.filter(x => x.status === 'CONFLICT_REVIEW').length, 1);
  assert.equal(result.length, 4);
  assert.equal(result.find(x => x.status === 'CONFLICT_REVIEW')?.latest.value, 20);
});
