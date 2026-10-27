// zzz1190 — Transformational Gainers: a share issue or a purchase is not a business event; each row says what to establish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceGap, researchNeeded, ONE_PAGE_CASE } from '../transformational/core';

const b = { signals: [] as string[], market: 'IN' as const, marketCap: 1000, whatChanged: null, quote: null };
test('equity raise, LOI to procure, subsidiary incorporation and impossible US figures are held back', () => {
  assert.match(evidenceGap({ ...b, kind: 'APPROVAL', headline: 'BSE granted in-principle approval to issue 7,06,068 equity shares via preferential allotment' })!, /share issue/);
  assert.match(evidenceGap({ ...b, kind: 'CAPACITY', headline: 'Proposed equity raise' })!, /share issue/);
  assert.match(evidenceGap({ ...b, kind: 'ORDERS', headline: 'LOI signed for proposed procurement of ten HARMONY LINAC systems from Elekta' })!, /buyer/);
  assert.match(evidenceGap({ ...b, kind: 'ORDERS', headline: 'Incorporation of Wholly Owned Subsidiary of the company' })!, /generic/);
  assert.match(evidenceGap({ ...b, market: 'US', marketCap: 4000, kind: 'RESULTS', headline: 'Bank reports quarter', quote: 'net loss of $140 billion' } as any)!, /figures conflict/);
  assert.equal(evidenceGap({ ...b, kind: 'ORDERS', headline: 'SRM Contractors won a 138.37 crore MORTH EPC contract' }), null);
});
test('research needed per event type, with the known figure; the one-page case has six questions', () => {
  const r = researchNeeded({ kind: 'ORDERS', orderToRevenuePct: 12.6, facts: { revenueYoY: null, patYoY: null, marginNow: null, marginPrior: null, cfoToPat: null, guidance: null }, dilution: false, evidence: 'official', durationYears: false });
  assert.match(r[0], /13% of a year's revenue/);
  assert.equal(ONE_PAGE_CASE.length, 6);
  assert.ok(researchNeeded({ kind: 'STRATEGIC', orderToRevenuePct: null, facts: { cfoToPat: null } as any, dilution: true, evidence: 'press', durationYears: false }).some((x) => /Dilution/.test(x)));
});
