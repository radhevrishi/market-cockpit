// zzz1228 — Bausch + Lomb Q3 2026: company revenue +7% as reported; "MIEBO® reported revenue grew 42% to $119 million" is one product.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statedRevenueGrowth, outlookOf } from '../ai-gainers/us-card';
import { headlineRevenueGrowth } from '../transformational/core';

const BLCO = 'Bausch + Lomb Posts Strong Third-Quarter Performance, Raises Full-Year 2026 Guidance • Revenue of $1.375 Billion • Revenue Grew 7% as Reported and 8% on a Constant Currency 1 Basis Compared to the Third Quarter of 2025 • GAAP Net Income of $32 Million. Select Company Highlights • MIEBO® reported revenue grew 42% to $119 million in the quarter, demonstrating continued momentum. 2026 Financial Outlook Bausch + Lomb provided updated guidance for the full year of 2026 as follows: Full-Year Revenue • $5.450B - $5.550B.';

test('01 the as-reported company figure wins; a product line is never company revenue', () => {
  assert.equal(statedRevenueGrowth(BLCO), 7);
  assert.equal(statedRevenueGrowth('MIEBO® reported revenue grew 42% to $119 million.'), null);
  assert.equal(statedRevenueGrowth('XIIDRA revenue increased 30% in the quarter.'), null);
  assert.equal(statedRevenueGrowth('Total revenues rose 19.5% to $7.9 billion.'), 19.5);
  assert.equal(statedRevenueGrowth('Revenue declined 4% as reported and 2% in constant currency.'), -4);
});

test('02 the outlook reader skips an actual "grew 42% to $119 million" (mixed units, growth verb)', () => {
  const o = outlookOf(BLCO);
  assert.ok(!o.lines.some((l) => /42%/.test(l)), JSON.stringify(o.lines));
  assert.equal(o.action, 'RAISED');
});

test('03 Transformational board: a stored product-line growth is replaced by the headline company figure', () => {
  const h = 'Bausch + Lomb Posts Strong Third-Quarter Performance, Raises Full-Year 2026 Guidance • Revenue of $1.375 Billion • Revenue Grew 7% as Reported and 8% on a Constant Curre…';
  assert.equal(headlineRevenueGrowth(h), 7);
  assert.equal(headlineRevenueGrowth('• MIEBO® Revenue grew 42% to $119 million'), null);
  assert.equal(headlineRevenueGrowth('Perella Weinberg Reports Third Quarter 2026 Results'), null);
});

import { reviewItem, multibaggerOf, type TgItem } from '../transformational/core';
const mk = (over: Partial<TgItem> = {}): TgItem => {
  const x: any = {
    id: 'IN:X:2026-10-24:ORDERS', market: 'IN', ticker: 'X', company: 'X Ltd', sessionDate: '2026-10-26', eventDate: '2026-10-24',
    movePct: 6, moveWindow: '1D', returns: { w1: 1, m1: 2, m3: 5 }, marketCap: 800, kind: 'ORDERS', strength: 'TRANSFORMATIONAL',
    signals: ['Order / contract win'], headline: '', whatChanged: null, quote: null, evidence: 'official', sourceUrl: null,
    durationYears: false, materiality: null, theme: 'Other / not classified yet', themeWhy: null,
    facts: { revenueYoY: null, patYoY: null, marginNow: null, marginPrior: null, cfoToPat: null, guidance: null }, dilution: false, ...over,
  };
  x.mb = multibaggerOf(x); return x;
};

test('04 Transformational board: an order whose value was read states it; profit −271.9% is "swung to a loss"', () => {
  const r = reviewItem(mk({ headline: 'Order (value not stated); to be executed in 24 months', quote: 'Received a work order worth Rs. 150 crore from a developer, to be executed in 24 months.' }), { ps: 1 })!;
  assert.ok(r, 'kept');
  assert.match(r.headline, /worth ₹150 Cr/);
  assert.ok(r.orderToRevenuePct != null);
  const l = reviewItem(mk({ headline: 'Order worth Rs 300 crore received from NHAI' }), { ps: 1, revQYoY: -0.8, epsQYoY: -271.9, q: 'Sep 2026' })!;
  assert.equal(l.facts.patYoY, null);
  assert.match(String(l.factsNote), /swung to a loss/);
});
