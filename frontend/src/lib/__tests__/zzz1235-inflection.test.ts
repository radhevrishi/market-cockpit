// zzz1235 — Hidden Inflection Radar: industry match, signal reading, the framework score.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { industriesOf, readSignal, scoreSignal, scoreBand, neglectFromPrices, epsSensitivity, INDUSTRIES } from '../inflection/core';

test('the Class 8 headline is found, read and scored as a strong signal', () => {
  const h = 'FTR: North American Class 8 net orders jump 124% year-over-year in May, up 4% month-over-month, fourth consecutive month of growth';
  assert.deepEqual(industriesOf(h), ['class8-trucks']);
  const r = readSignal(h);
  assert.equal(r.yoy, 124); assert.equal(r.mom, 4); assert.equal(r.consecutive, 4); assert.ok(r.classes.includes('DEMAND'));
  const s = scoreSignal(r, { neglect: 7, smallCount: 9 })!;
  assert.ok(s.score >= 70, String(s.score));
  assert.equal(scoreBand(s.score).label, 'Strong signal');
});

test('grid and packaging news are caught; falling news is not a signal', () => {
  assert.ok(industriesOf('Transformer shortage: lead times stretch to three years as data centres race for power').includes('grid'));
  assert.ok(readSignal('Transformer shortage: lead times stretch to three years').classes.includes('BOTTLENECK'));
  assert.ok(industriesOf('Corrugated box prices rise 12% as kraft paper costs climb').includes('packaging'));
  assert.equal(scoreSignal(readSignal('Class 8 orders fall 20% as fleets cancel'), { neglect: 5, smallCount: 5 }), null);
  assert.equal(neglectFromPrices([-20, -15, 5]), 9);
  assert.equal(epsSensitivity(500, 10)[1].pat, 500 * 0.1 * 0.2 * 0.75);
  // zzz1246 — USA-only industries have no Indian map and only US searches
  assert.ok(INDUSTRIES.every((i) => (i.beneficiaries.length >= 3 && i.queries.length >= 2) || (!i.beneficiaries.length && (i.us || []).length >= 3 && (i.usQueries || []).length >= 2)));
});
