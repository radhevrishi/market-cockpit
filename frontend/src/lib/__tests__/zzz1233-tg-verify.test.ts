// zzz1233 — settling "Needs verification": criteria rejects, quote must be in the filing, accepted rows join the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleVerdict, quoteInText, parseVerifyAnswer, dueForRetry, applyVerify } from '../transformational/verify';

test('criteria alone reject buybacks, share issues and the company being the buyer', () => {
  assert.equal(ruleVerdict({ needsCheck: 'a buyback or financing, not a business event — …' })?.verdict, 'REJECTED');
  assert.equal(ruleVerdict({ needsCheck: 'a share issue (raising money / dilution), not a business event — …' })?.verdict, 'REJECTED');
  assert.equal(ruleVerdict({ needsCheck: 'the company is the buyer (a purchase / LOI to procure), not receiving an order — …' })?.verdict, 'REJECTED');
  assert.equal(ruleVerdict({ needsCheck: 'the shown text does not mention the orders / contracts' }), null);
});

const DOC = 'The Company is pleased to inform that it has received a Letter of Award from NTPC Limited for supply of transformers worth Rs. 412 crore to be executed over 18 months. This is an intimation under Regulation 30.';
test('an accepted answer must quote the filing; a made-up quote is rejected', () => {
  const ok = parseVerifyAnswer({ verdict: 'ACCEPTED', kind: 'ORDERS', quote: 'it has received a Letter of Award from NTPC Limited for supply of transformers worth Rs. 412 crore', reason: 'Order received.' }, DOC)!;
  assert.equal(ok.verdict, 'ACCEPTED'); assert.equal(ok.kind, 'ORDERS');
  const bad = parseVerifyAnswer({ verdict: 'ACCEPTED', kind: 'ORDERS', quote: 'received an order of Rs 900 crore from Indian Railways for wagons', reason: 'x' }, DOC)!;
  assert.equal(bad.verdict, 'REJECTED');
  assert.equal(parseVerifyAnswer({ verdict: 'MAYBE' }, DOC), null);
  assert.ok(quoteInText('pleased to inform that it has received a letter of award from ntpc limited', DOC));
});

test('not verifiable is retried after 3 days, at most 3 times; an accepted row joins the board', () => {
  const nv = { verdict: 'NOT_VERIFIABLE' as const, reason: '', kind: null, quote: null, by: 'rules' as const, at: '2026-11-01', tries: 1 };
  assert.equal(dueForRetry(nv, Date.parse('2026-11-02T00:00:00Z')), false);
  assert.equal(dueForRetry(nv, Date.parse('2026-11-05T00:00:00Z')), true);
  assert.equal(dueForRetry({ ...nv, tries: 3 }, Date.parse('2026-11-30T00:00:00Z')), false);
  assert.equal(dueForRetry(null), true);
  const x: any = { id: 'a', kind: 'ORDERS', needsCheck: 'the shown text does not mention the orders / contracts', signals: [], quote: null, evidence: 'press', facts: { revenueYoY: null, patYoY: null, marginNow: null, marginPrior: null, cfoToPat: null, guidance: null }, orderToRevenuePct: null, dilution: false, durationYears: false, returns: { w1: null, m1: null, m3: null }, eventDate: null, sessionDate: '2026-11-01' };
  const y = applyVerify(x, { verdict: 'ACCEPTED', reason: 'ok', kind: 'ORDERS', quote: 'q'.repeat(30), by: 'ai', at: '2026-11-02', tries: 1 });
  assert.equal(y.needsCheck, null); assert.equal(y.evidence, 'official'); assert.ok(y.signals.some((s: string) => /verified/.test(s)));
  assert.equal(applyVerify(x, { ...nv }).needsCheck, x.needsCheck);
});
