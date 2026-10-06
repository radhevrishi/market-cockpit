// zzz886 — lean list payloads for Guidance Upgrades. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leanEvent, leanUniverseRow, leanUniverseBody, leanEventsBody, findUniverseRow } from '../gu-lean';

test('an event keeps every list field and loses only the detail text', () => {
  const e = { guidance_event_id: 'x', company: 'A', changes: [1], sources: [{ tier: 'PRIMARY' }], decisionReason: ['why'], chain: { a: 1 }, risks: ['r'], valuation: { v: 1 } };
  const l = leanEvent(e) as any;
  assert.deepEqual(l.changes, [1]); assert.deepEqual(l.sources, [{ tier: 'PRIMARY' }]); assert.deepEqual(l.valuation, { v: 1 });
  assert.equal(l.decisionReason, undefined); assert.equal(l.chain, undefined); assert.equal(l.risks, undefined); assert.equal(l.lean, true);
  assert.deepEqual((e as any).decisionReason, ['why']);   // the input is not changed
});
test('a universe row keeps what the lists read (company, primary figure, sources, history, reality)', () => {
  const r = { entityKey: 'IN|A', history: [1], sources: [2], points: [{ metric: 'REVENUE', compareValue: 40, counted: true, history: [9], sources: [8], primarySourceText: 'long' }],
    record: { id: 'a', company: 'A', market: 'IN', primary: { metric: 'REVENUE', period: 'FY27', prior: { low: 1, high: 2 }, history: [7], sources: [6] }, others: [{ metric: 'PAT', priors: [1] }], sources: [{ primary: true }], history: [{ old: 'x', next: 'y' }], reality: { trackingWhy: 't' }, nextProof: 'n', driverText: 'd', links: {} } };
  const l = leanUniverseRow(r) as any;
  assert.equal(l.record.company, 'A'); assert.deepEqual(l.record.primary.prior, { low: 1, high: 2 }); assert.deepEqual(l.record.sources, [{ primary: true }]);
  assert.deepEqual(l.record.history, [{ old: 'x', next: 'y' }]); assert.equal(l.record.reality.trackingWhy, 't');
  assert.equal(l.points[0].compareValue, 40); assert.equal(l.points[0].history, undefined); assert.equal(l.points[0].primarySourceText, undefined);
  assert.equal(l.record.primary.history, undefined); assert.equal(l.record.others[0].priors, undefined);
  assert.equal(l.record.nextProof, undefined); assert.equal(l.history, undefined); assert.equal(l.sources, undefined); assert.equal(l.lean, true);
  assert.deepEqual(r.record.primary.history, [7]);
});
test('lists that were the same array stay the same array; counts untouched', () => {
  const recs = [{ entityKey: 'k', record: { company: 'A' }, points: [] }];
  const b = leanUniverseBody({ records: recs, reviewQueue: recs, viewCounts: { default: 1 } });
  assert.equal(b.records, b.reviewQueue); assert.deepEqual(b.viewCounts, { default: 1 });
  assert.equal(leanEventsBody({ events: [{ chain: 1 }], summary: { n: 1 } }).events[0].chain, undefined);
  assert.equal((findUniverseRow([[], recs], 'k') as any).record.company, 'A'); assert.equal(findUniverseRow([recs], 'zz'), null);
});
