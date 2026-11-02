import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRadarQuote, radarDecision, rankForDecision } from '../concall-radar-decision';

const good = { evidence_quote: 'The company reported EBITDA margin expanded 300 basis points to 17% and commercial revenue grew 42% in Q2 FY27.', scored_from: 'PDF' as const, bullish_tier: 'BULLISH', caution_flags: [], caution_level: 0, evidence_score: 8, stage: 5, stage_sweet_spot: true, evidence_breadth: 4, patterns: [{ key: 'capacity' }, { key: 'export' }, { key: 'margin' }], triple: { industry: true, company: true, financial: true, count: 3 }, transformation_score: 36 };

test('guidance cuts block research priority even with a very high transformation score', () => {
  const result = radarDecision({ ...good, transformation_score: 90, caution_flags: ['guidance reduced'] });
  assert.equal(result.queue, 'RISK');
  assert.match(result.reason, /Guidance reduction/);
});
test('bearish sentiment cannot be outweighed by a high keyword T-score', () => {
  assert.equal(radarDecision({ ...good, bullish_tier: 'BEARISH', transformation_score: 100 }).queue, 'RISK');
});
test('profit and margins falling block the top research queue', () => {
  assert.equal(radarDecision({ ...good, caution_flags: ['profit down'] }).queue, 'RECONCILE');
  assert.equal(radarDecision({ ...good, caution_flags: ['margin down'] }).queue, 'RECONCILE');
});
test('subject-only cannot be treated as analyzed primary-filing evidence', () => {
  assert.equal(radarDecision({ ...good, scored_from: 'SUBJECT' }).queue, 'UNVERIFIED');
});
test('management talk without commercial confirmation is WAIT, not purchase-ready', () => {
  assert.equal(radarDecision({ ...good, evidence_score: 2, stage: 1 }).queue, 'WAIT');
});
test('evidence rung 9 does not necessarily indicate mature business cycle', () => {
  assert.equal(radarDecision({ ...good, stage: 9 }).queue, 'RESEARCH');
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

test('analyst question about liquid cooling cannot count as management evidence', () => {
  const q = 'Sir, now that our -- my second question, now that our liquid cooling skids contribute upwards of 30% of total revenue, can you share the current order book and execution period?';
  assert.equal(assessRadarQuote(q).quality, 'QUESTION');
  assert.equal(radarDecision({ ...good, evidence_quote: q }).queue, 'WAIT');
});
test('Mold-Tek-style joined PDF text is not a verified order', () => {
  const q = 'into 2 locations translating into better EBIDTA growthProactive in forecasting to-be idle capacities and accordingly supporting order booking';
  assert.equal(assessRadarQuote(q).quality, 'BROKEN');
  assert.equal(radarDecision({ ...good, evidence_quote: q }).queue, 'WAIT');
});
test('legal definition and company biographies cannot be evidence', () => {
  for (const q of [
    'Persons, in each case that are both qualified institutional buyers as defined in Rule 144A under the US.',
    'Forward-looking statements are not guarantees of future performance including general business plans and strategy.',
    'He is primarily responsible for overseeing overall strategy and business development functions of the group.',
  ]) assert.notEqual(assessRadarQuote(q).quality, 'USABLE');
});
test('an order mention by itself is insufficient to underwrite before materiality is established', () => {
 const q = 'We have already secured an HTLS order book of INR 200 crores plus as on date and the capacity augmentation is planned at our new plant.';
 assert.equal(assessRadarQuote(q).quality, 'USABLE');
 const d = radarDecision({ ...good, evidence_quote: q, evidence_score: 6 });
 assert.equal(d.queue, 'WAIT');
 assert.ok(d.blockers.some(x => x.includes('guidance')));
});
test('positive and negative signals for different periods must be reconciled', () => {
 const d = radarDecision({ ...good, evidence_score: 9, caution_flags: ['margin down'] });
 assert.equal(d.queue, 'RECONCILE');
 assert.match(d.nextCheck, /SAME quarter/);
});
test('unreliable proof sorts below credible reported earnings even with huge T-score', () => {
 const data = [
  { ...good, symbol:'QUESTION', transformation_score:95, evidence_quote:'Sir, my second question, can you share the order book and your next quarter revenue?' },
  { ...good, symbol:'PROOF', transformation_score:30 },
  { ...good, symbol:'CONFLICT', transformation_score:40, caution_flags:['margin down'] },
 ];
 assert.deepEqual(rankForDecision(data).map(x => x.symbol), ['PROOF','CONFLICT','QUESTION']);
});

test('neutral restaurants with one margin excerpt do not enter Underwrite thesis', () => {
  const d = radarDecision({ ...good, bullish_tier: 'NEUTRAL', transformation_score: 100 });
  assert.equal(d.queue, 'WAIT');
  assert.match(d.reason, /Neutral or unconfirmed/);
});
test('mixed-positive high T-Score without forward outlook remains WAIT', () => {
  assert.equal(radarDecision({ ...good, bullish_tier: 'MIXED_POSITIVE', transformation_score: 100 }).queue, 'WAIT');
});
test('one margin excerpt cannot establish an earnings J-curve', () => {
  const d = radarDecision({ ...good, evidence_breadth: 1, patterns: [{ key: 'margin' }] });
  assert.equal(d.queue, 'WAIT');
});
test('no independent structural milestone remains WAIT even with several financial keywords', () => {
  const d = radarDecision({ ...good, patterns: [{ key: 'tech' }, { key: 'margin' }, { key: 'utilisation' }] });
  assert.equal(d.queue, 'WAIT');
});
