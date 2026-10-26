// zzz1170 — evidence gate + honest figures (ChatGPT audit of the board, the parts that were right).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidenceGap, reviewItem, multibaggerOf, buildBoard, themeOf, type TgItem } from '../transformational/core';

const mk = (over: Partial<TgItem> = {}): TgItem => {
  const x: any = {
    id: 'IN:X:2026-10-24:APPROVAL', market: 'IN', ticker: 'X', company: 'X Ltd', sessionDate: '2026-10-26', eventDate: '2026-10-24',
    movePct: 6, moveWindow: '1D', returns: { w1: 1, m1: 2, m3: 5 }, marketCap: 800, kind: 'APPROVAL', strength: 'INFLECTION',
    signals: ['Regulatory approval / licence'], headline: '', whatChanged: null, quote: null, evidence: 'official', sourceUrl: null,
    durationYears: false, materiality: null, theme: 'Other / not classified yet', themeWhy: null,
    facts: { revenueYoY: null, patYoY: null, marginNow: null, marginPrior: null, cfoToPat: null, guidance: null }, dilution: false, ...over,
  };
  x.mb = multibaggerOf(x); return x;
};

test('the text must back the label (EMKAY, QPOWER, ATL, TKNO, SENORES shapes)', () => {
  assert.match(evidenceGap(mk({ headline: 'As filed: “issued on a preferential basis Pursuant to Regulation 30 of the SEBI (Listing Obligations…”' }))!, /raising money/);
  assert.ok(evidenceGap(mk({ kind: 'CAPACITY', headline: 'Addendum valuation report dated Oct 23, 2026 for preferential equity issue submitted to NSE/BSE.' })));
  assert.match(evidenceGap(mk({ kind: 'STRATEGIC', headline: 'Monthly Business Updates — volumes 7% decline over last year. *ICD is JV with CONCOR' }))!, /existing relationship/);
  assert.ok(evidenceGap(mk({ kind: 'GUIDANCE', headline: 'Teknova Announces Proposed Public Offering of Common Stock HOLLISTER, CA' })));
  assert.match(evidenceGap(mk({ kind: 'STRATEGIC', headline: 'As filed: “planning, capacity expansion, policy enforcement, mergers and acquisitions, supply chain…”' }))!, /generic/);
  assert.equal(evidenceGap(mk({ kind: 'ORDERS', headline: 'SRM won a 138.37 crore MORTH EPC contract' })), null);
});

test('figures that cannot be right are held back (UCB shape)', () => {
  assert.match(evidenceGap(mk({ market: 'US', marketCap: 4300, kind: 'STRATEGIC', headline: 'Revenue −$11.966B (+7.0% as stated) · Net loss $139.7B', signals: ['Acquisition'] }))!, /figures conflict/);
});

test('growth from a tiny base is n/m, not +7,380%; missing figures cost nothing', () => {
  const r = reviewItem(mk({ kind: 'ORDERS', headline: 'Sigma won US$19.7 million order from a NATO customer', marketCap: 15581 }), { revQYoY: 7380, epsQYoY: -92.6, q: 'Jun 2026', ps: 20 })!;
  assert.equal(r.facts.revenueYoY, null); assert.match(r.factsNote!, /tiny or negative base/);
  const a = multibaggerOf(mk()), b = multibaggerOf(mk({ facts: { revenueYoY: 15, patYoY: null, marginNow: null, marginPrior: null, cfoToPat: null, guidance: null } }));
  assert.ok(a.score >= b.score - 1, 'unknown is not punished');
});

test('order measured against a year of revenue (₹272 Cr on ~₹790 Cr revenue = 34%)', () => {
  const r = reviewItem(mk({ kind: 'ORDERS', headline: 'KP Green secures confirmed orders aggregating Rs. 272 crores', marketCap: 1572 }), { ps: 2 })!;
  assert.equal(r.orderToRevenuePct, 34.6); assert.ok(r.mb.plus.some((p) => /% of a year's revenue/.test(p)));
  assert.equal(reviewItem(mk({ kind: 'ORDERS', headline: 'Order worth Rs 20 crore received', marketCap: 1572 }), { ps: 2 }), null, '2.5% of revenue is too small');
});

test('the board ranks verified rows only; held-back rows listed apart', () => {
  const ok = { ...mk({ kind: 'ORDERS', headline: 'Won a contract worth Rs 300 crore', id: 'a' }) };
  const bad = { ...mk({ id: 'b', ticker: 'Y' }), needsCheck: 'x' };
  const b = buildBoard([ok, bad], '2026-10-26', 60);
  assert.deepEqual(b.items.map((x) => x.id), ['a']); assert.deepEqual(b.needsCheck.map((x) => x.id), ['b']);
});

test('raw industry names fold into themes; wording is "potential", not a probability', () => {
  assert.equal(themeOf([], 'Major Banks').theme, 'Financials / lending');
  assert.equal(themeOf([], 'EDP Services').theme, 'Software / IT services / SaaS');
  assert.equal(themeOf([], 'Oilfield Services/Equipment').theme, 'Oil & gas / pipelines / LNG');
  assert.equal(themeOf([], 'Medical/Dental Instruments').theme, 'Pharma CDMO / API / healthcare');
  const chip = readFileSync(new URL('../../components/transformational/MbChip.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(chip, /% chance of 3x\+/);
});
