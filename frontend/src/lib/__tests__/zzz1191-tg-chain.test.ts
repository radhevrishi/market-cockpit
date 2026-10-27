// zzz1191 — Transformational Gainers: units reconcile, legal / listing paperwork is not an event, results text is not an order,
// and the owner's evidence chain is read stage by stage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceChain, evidenceGap, reviewItem, type TgItem } from '../transformational/core';

const facts = { revenueYoY: null, patYoY: null, marginNow: null, marginPrior: null, cfoToPat: null, guidance: null };
const item = (o: Partial<TgItem>): TgItem => ({
  id: 'x', market: 'IN', ticker: 'HILINFRA', company: 'Hilltop', sessionDate: '2026-10-27', eventDate: '2026-10-26', movePct: 8, moveWindow: '1D',
  returns: { w1: null, m1: null, m3: 10 }, marketCap: 400, kind: 'ORDERS', strength: 'TRANSFORMATIONAL', signals: ['Order win'],
  headline: 'Order win', whatChanged: null, quote: null, evidence: 'official', sourceUrl: null, durationYears: false, materiality: null,
  theme: 'Other', themeWhy: null, facts: { ...facts }, dilution: false, mb: { score: 50, label: 'MEDIUM', plus: [], minus: [] } as any, ...o,
});

test('a rupee figure written out in full is rupees, not crore (HILINFRA was 116,061,392% of revenue)', () => {
  const x = reviewItem(item({ quote: 'received a work order worth Rs. 91,77,77,777 from NHAI' }), { ps: 5 })!;
  assert.ok(x);
  assert.equal(x.orderToRevenuePct, 114.7);   // ₹91.78 Cr against ₹80 Cr revenue
});
test('summons, show-cause and RERA registration are not orders', () => {
  assert.equal(reviewItem(item({ headline: 'Sahajanand Medical: order win', quote: 'received summons from the authority' }), { ps: 5 }), null);
  assert.equal(reviewItem(item({ headline: 'Omaxe order', whatChanged: 'RERA registration for the project' }), { ps: 5 }), null);
});
test('a results release does not produce an order %', () => {
  const x = reviewItem(item({ headline: 'Q2 FY27 results', quote: 'revenue of ₹560 crore for the quarter, net profit up' }), { ps: 2 });
  assert.equal(x?.orderToRevenuePct ?? null, null);
});
test('warrant-conversion listing approval and a buyback are held back', () => {
  const b = { signals: [] as string[], market: 'IN' as const, marketCap: 1000, whatChanged: null, quote: null };
  assert.match(evidenceGap({ ...b, kind: 'APPROVAL', headline: 'Listing approval for equity shares allotted on conversion of warrants' })!, /share issue/);
  assert.match(evidenceGap({ ...b, market: 'US', kind: 'STRATEGIC', headline: 'Share buyback: $50M programme' })!, /buyback or financing/);
});
test('evidence chain: all five met, and a diluting, rich share fails two', () => {
  const good = evidenceChain({ ...item({ orderToRevenuePct: 40, facts: { ...facts, cfoToPat: 0.9 } }), pe: 25, de: 0.2 });
  assert.equal(good.met, 5);
  const bad = evidenceChain({ ...item({ dilution: true, returns: { w1: null, m1: null, m3: 120 } }), pe: 95 });
  assert.equal(bad.stages.find((s) => s.id === 'perShare')!.state, 'missing');
  assert.equal(bad.stages.find((s) => s.id === 'price')!.state, 'missing');
  const res = evidenceChain(item({ kind: 'RESULTS', evidence: 'official' }));
  assert.equal(res.stages[0].state, 'missing');
});
