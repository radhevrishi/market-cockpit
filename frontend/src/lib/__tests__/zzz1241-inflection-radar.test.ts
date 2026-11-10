// zzz1241 — Hidden Inflection Radar: one signal per story, bearings found, tickers that exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRIES, dedupeSignals, industriesOf, sameStory, headlineWords } from '../inflection/core';

test('the same story from two outlets is one signal with ×2 sources', () => {
  const s = dedupeSignals([
    { headline: 'Zetwerk bags $200 million transformer export order from US utility - Economic Times', score: 70 },
    { headline: 'Zetwerk bags $200 mn transformer export order from US utility - Moneycontrol', score: 66 },
    { headline: 'Transformer lead times stretch to three years as grid capex surges', score: 60 },
  ]);
  assert.equal(s.length, 2);
  assert.equal(s[0].sources, 2);
  assert.equal(s[0].score, 70, 'the higher-scoring copy is kept');
  assert.equal(sameStory(headlineWords('Class 8 orders jump 40%'), headlineWords('Copper prices hit record')), false);
});

test('bearings: the industry and its makers are found; "bearing the brunt" is not', () => {
  assert.ok(industriesOf('NRB Bearings Q2 profit rises on export demand').includes('bearings'));
  assert.ok(industriesOf('India bearings industry sees capacity additions').includes('bearings'));
  assert.ok(!industriesOf('Exporters bearing the brunt of US tariffs').includes('bearings'));
});

test('mapped tickers are NSE symbols (Shilchar = SHILCTECH, Hitachi Energy = POWERINDIA)', () => {
  const all = INDUSTRIES.flatMap((i) => i.beneficiaries.map((b) => b.ticker));
  assert.ok(all.includes('SHILCTECH') && all.includes('POWERINDIA'));
  for (const bad of ['SHILCHAR', 'HITACHIEN', 'JOSTS']) assert.ok(!all.includes(bad), bad);
});

// zzz1244 — USA tab + cleaner signals
import { isCompanyResultsHeadline } from '../inflection/core';
test('one company\'s results are not an industry signal; the AI "transformer" is not grid equipment', () => {
  assert.equal(isCompanyResultsHeadline('TIMKEN INDIA Q2 RESULTS: PAT JUMPS 30% YOY TO ₹116 CR; REVENUE UP 25%'), true);
  assert.equal(isCompanyResultsHeadline('Machine tool demand hits record high'), false);
  assert.ok(!industriesOf('New transformer model architecture cuts LLM costs').includes('grid'));
  assert.ok(industriesOf('Transformer lead times stretch to four years').includes('grid'));
});
test('every industry has a USA supplier map with small / mid names', () => {
  for (const i of INDUSTRIES) {
    assert.ok((i.us || []).length >= 3, i.id);
    assert.ok((i.us || []).some((b) => !b.large), i.id);
  }
});
test('"RBC Bearings Q2 2027: Earnings Beat" is company results', () => {
  assert.equal(isCompanyResultsHeadline('RBC Bearings Q2 2027: Earnings Beat, $2.4B Backlog, and Stronger Half Ahead'), true);
});
