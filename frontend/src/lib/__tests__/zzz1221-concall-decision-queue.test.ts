import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radarDecision, rankForDecision } from '../concall-radar-decision';

const good = { scored_from: 'PDF' as const, bullish_tier: 'BULLISH', caution_flags: [], caution_level: 0, evidence_score: 8, stage: 5, stage_sweet_spot: true, triple: { industry: true, company: true, financial: true, count: 3 }, transformation_score: 36 };

test('guidance cuts block research priority even with a very high transformation score', () => {
  const result = radarDecision({ ...good, transformation_score: 90, caution_flags: ['guidance reduced'] });
  assert.equal(result.queue, 'RISK');
  assert.match(result.reason, /Guidance reduction/);
});
test('bearish sentiment cannot be outweighed by a high keyword T-score', () => {
  assert.equal(radarDecision({ ...good, bullish_tier: 'BEARISH', transformation_score: 100 }).queue, 'RISK');
});
test('profit and margins falling block the top research queue', () => {
  assert.equal(radarDecision({ ...good, caution_flags: ['profit down'] }).queue, 'RISK');
  assert.equal(radarDecision({ ...good, caution_flags: ['margin down'] }).queue, 'RISK');
});
test('subject-only cannot be treated as analyzed primary-filing evidence', () => {
  assert.equal(radarDecision({ ...good, scored_from: 'SUBJECT' }).queue, 'UNVERIFIED');
});
test('management talk without commercial confirmation is WAIT, not purchase-ready', () => {
  assert.equal(radarDecision({ ...good, evidence_score: 2, stage: 1 }).queue, 'WAIT');
});
test('late stage is not ranked as an early J-curve', () => {
  assert.equal(radarDecision({ ...good, stage: 9 }).queue, 'WAIT');
});
test('high-score company without financial evidence must wait', () => {
  assert.equal(radarDecision({ ...good, triple: { industry: true, company: true, financial: false, count: 2 } }).queue, 'WAIT');
});
test('strong evidence reaches RESEARCH only and always warns latest guidance and valuation unverified', () => {
  const d = radarDecision(good);
  assert.equal(d.queue, 'RESEARCH');
  assert.ok(d.blockers.some(x => x.includes('guidance')));
  assert.ok(d.blockers.some(x => x.includes('valuation')));
});
test('decision relevance outranks high keyword count; no input mutation', () => {
  const rows = [
    { ...good, symbol: 'BAD', transformation_score: 90, bullish_tier: 'BEARISH' },
    { ...good, symbol: 'GOOD', transformation_score: 30 },
    { ...good, symbol: 'UNKNOWN', transformation_score: 60, scored_from: 'SUBJECT' as const },
  ];
  assert.deepEqual(rankForDecision(rows).map(x => x.symbol), ['GOOD', 'BAD', 'UNKNOWN']);
  assert.equal(rows[0].symbol, 'BAD');
});
