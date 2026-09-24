// zzz782 — potential vs evidenced persistence, immaterial negatives, tracked
// potential catalysts (MoU / JDA), reserve tonnage is not capacity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistenceEvidenceOf, negativeAmountCr } from '../ai-gainers/research-view';
import { trackPotentialFromFinding } from '../catalyst/persistence';
import { isReserveTonnage } from '../thesis/status';

test('new product = long-term possible but UNPROVEN; qualification = EARLY; order = EVIDENCE; multi-year = STRONG', () => {
  assert.equal(persistenceEvidenceOf('New product', 'POTENTIAL_UNVERIFIED', 'EXECUTED', 'product', 'ESDS launched SWARAJ Sethu, a DevSecOps platform', null).level, 'UNPROVEN');
  assert.equal(persistenceEvidenceOf('Regulatory approval', 'POTENTIAL_UNVERIFIED', 'EXECUTED', 'qualification', 'Qualified with a global OEM', null).level, 'EARLY');
  assert.equal(persistenceEvidenceOf('Order win', 'CONFIRMED_LOW_MATERIALITY', 'AWARDED', 'order', 'Received order worth Rs 22 crore to execute over three months', null).level, 'EVIDENCE');
  assert.equal(persistenceEvidenceOf('Order win', 'CONFIRMED_LOW_MATERIALITY', 'AWARDED', 'order_recurring', 'multi-programme orders worth about ₹33 crore annually', null).level, 'STRONG');
  assert.equal(persistenceEvidenceOf('Capacity expansion', 'CONFIRMED_LOW_MATERIALITY', 'EXECUTED', 'capacity', 'commissioned plant, capacity up to 150 TPD', null).level, 'EARLY');
  assert.equal(persistenceEvidenceOf('Capacity expansion', 'CONFIRMED_LOW_MATERIALITY', 'EXECUTED', 'capacity', 'commissioned plant; utilisation 65% with orders in hand', null).level, 'STRONG');
  assert.equal(persistenceEvidenceOf('Litigation / regulatory' as any, 'NEGATIVE', 'EXECUTED', 'negative', 'GST demand of Rs 3.53 crore', null).level, 'NOT_PERSISTENT');
  assert.equal(persistenceEvidenceOf('Partnership' as any, 'POTENTIAL_UNVERIFIED', 'ENABLING', 'enabling', 'binding MoU for JDA', null).level, 'UNPROVEN');
});

test('negative amounts in crore — bare ₹ is rupees, lakh is 1/100 crore', () => {
  assert.equal(negativeAmountCr('₹40,036 demand confirmed for FY23'), 0.004);
  assert.equal(negativeAmountCr('confirmed ₹3.53 crore GST demand and ₹46.58 lakh penalty'), 3.9958);
  assert.equal(negativeAmountCr('no amount'), null);
});

test('MAXESTATES binding MoU for a JDA is a tracked potential catalyst with the real-estate chain — never Special Focus', () => {
  const pc = trackPotentialFromFinding({ status: 'catalyst', stage: 'enabling', ticker: 'MAXESTATES', category: 'joint_venture',
    headline: 'Max Estates signs binding MoU for Ghaziabad JDA; 9.76-acre project may unlock INR 2,500-3,000 crore GDV.', sourceDate: '2026-09-23' });
  assert.ok(pc);
  assert.equal(pc!.kind, 'PROJECT_PIPELINE');
  assert.equal(pc!.specialFocus, false);
  assert.equal(pc!.confidence, 'EARLY');
  assert.equal(pc!.nextMilestone, 'Definitive agreement executed');
  assert.match(pc!.mechanism, /✓ MoU \/ JDA signed → Definitive agreement executed → Approvals received → .*Bookings.*Collections.*Revenue recognised → Profit/);
  assert.equal(trackPotentialFromFinding({ status: 'catalyst', stage: 'executed', ticker: 'X', headline: 'Order received' }), null);
});

test('reserve / resource tonnage is not production capacity', () => {
  assert.equal(isReserveTonnage({ key: 'capacity_addition', after: '198.61 Million Tonne', quote: 'Resource increase 198.61 Million Tonne since 2018' }), true);
  assert.equal(isReserveTonnage({ key: 'capacity', after: '767.37 Million tonnes' }), true);
  assert.equal(isReserveTonnage({ key: 'capacity', after: '12.2 million tonnes per annum' }), false);
  assert.equal(isReserveTonnage({ key: 'capacity_addition', after: '5300 MTPA' }), false);
});

import { toOpenAIRequest } from '../anthropic-meter';
test('zzz783: a PDF document block goes to OpenAI as a file part (OCR works without an Anthropic key)', () => {
  const r: any = toOpenAIRequest({ model: 'claude-haiku-4-5', max_tokens: 100, system: 'Transcribe.', messages: [{ role: 'user', content: [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } }, { type: 'text', text: 'Transcribe this filing.' }] }] } as any, 'gpt-5-mini', 'minimal');
  const u = r.messages.find((m: any) => m.role === 'user');
  assert.equal(u.content[0].type, 'file');
  assert.equal(u.content[0].file.file_data, 'data:application/pdf;base64,QUJD');
  assert.equal(u.content[1].text, 'Transcribe this filing.');
});
