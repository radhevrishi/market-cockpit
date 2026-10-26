// zzz1169 — owner's audit of the board: one ranking (rules + AI), clean "what changed", industry themes, figures from the stock
// screener, takeover targets / stale events / tiny orders / court reliefs out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewItem, chanceOf, themeOf, bestHeadline, orderValue, multibaggerOf, type TgItem } from '../transformational/core';

const base = (over: Partial<TgItem> = {}): TgItem => {
  const x: any = {
    id: 'IN:ABC:2026-10-20:ORDERS', market: 'IN', ticker: 'ABC', company: 'ABC Ltd', sessionDate: '2026-10-22', eventDate: '2026-10-20',
    movePct: 6, moveWindow: '1D', returns: { w1: 2, m1: 5, m3: 10 }, marketCap: 1500, kind: 'ORDERS', strength: 'TRANSFORMATIONAL',
    signals: ['Order / contract win'], headline: 'ABC secures orders worth Rs. 272 crores', whatChanged: null, quote: null,
    evidence: 'official', sourceUrl: null, durationYears: true, materiality: 'SIGNIFICANT', theme: 'Other / not classified yet', themeWhy: null,
    facts: { revenueYoY: null, patYoY: null, marginNow: null, marginPrior: null, cfoToPat: null, guidance: null }, dilution: false, ...over,
  };
  x.mb = multibaggerOf(x); return x;
};

test('ranking: an AI-read 8% never outranks an unread HIGH', () => {
  const hi = { mb: { score: 70, label: 'HIGH' as const, plus: [], minus: [] }, ai: null };
  const lo = { mb: { score: 50, label: 'MEDIUM' as const, plus: [], minus: [] }, ai: { label: 'UNLIKELY' as const, probabilityPct: 8, why: [], risks: [], verifyNext: [], theme: null, at: '', model: null } };
  assert.ok(chanceOf(hi).score > chanceOf(lo).score);
  assert.equal(chanceOf(lo).from, 'rules + AI');
});

test('what changed: contacts, addresses, form titles and one-word labels give way to the real sentence', () => {
  assert.equal(bestHeadline({ headline: 'Contact: Sean K.F. Hannan, Vice President, Investor Relations Sean.Hannan@ttmtech.com', whatChanged: null, quote: 'A&D backlog was $2.0 billion', signals: [] }), 'A&D backlog was $2.0 billion');
  assert.equal(bestHeadline({ headline: '32301 Woodward Ave. Royal Oak, MI 48073', whatChanged: 'Raised 2026 AFFO guidance to $4.40', quote: null, signals: [] }), 'Raised 2026 AFFO guidance to $4.40');
  assert.equal(bestHeadline({ headline: 'Results', whatChanged: null, quote: null, signals: ['Order / contract win', 'Order book stated'] }), 'Order / contract win · Order book stated');
  assert.equal(bestHeadline({ headline: 'Older context (5d): Order from BHEL worth ₹120 Cr', whatChanged: null, quote: null, signals: [] }), 'Order from BHEL worth ₹120 Cr');
});

test('theme from the industry first (a resort is not telecom; a chip-inspection maker is not oil & gas)', () => {
  assert.equal(themeOf(['Lakshadweep resort with network of villas'], 'Hotels, Resorts & Cruise Lines').theme, 'Hotels / travel / leisure');
  assert.equal(themeOf(['upstream offshore inspection'], 'Semiconductor Equipment & Materials').theme, 'Electronics / EMS / semiconductors');
  assert.equal(themeOf(['x'], 'Packaged Foods').theme, 'Consumer / retail / brands');
});

test('out: being acquired, an old event, an order under 3% of the company, a court relief', () => {
  assert.equal(reviewItem(base({ kind: 'STRATEGIC', headline: 'Voting and Support Agreement', signals: ['Merger agreement'], movePct: 51 })), null);
  assert.equal(reviewItem(base({ eventDate: '2026-10-06', headline: 'Older context (16d): order from L&T' })), null);
  assert.equal(reviewItem(base({ headline: 'Received annual maintenance order of Rs.12.04 crore from L&T', marketCap: 3854 })), null);
  assert.equal(reviewItem(base({ headline: 'Wins High Court relief in ₹118 crore GST refund case', marketCap: 6753 })), null);
  assert.ok(reviewItem(base()), 'a ₹272 Cr order on a ₹1,500 Cr company stays');
  assert.equal(orderValue('order worth USD 5.25 million', 'US'), null);
  assert.equal(orderValue('Contract Awards Totaling $550 Million', 'US'), 550);
  assert.equal(orderValue('Rs 4.76 crore order', 'IN'), 4.76);
});

test('figures from the stock screener fill the growth column, labelled; no figures at all marks the read down', () => {
  const r = reviewItem(base(), { revQYoY: 48, epsQYoY: 90, q: 'Sep 2026', ind: 'Heavy Electrical Equipment' })!;
  assert.equal(r.facts.revenueYoY, 48); assert.equal(r.factsSource, 'screener'); assert.equal(r.factsPeriod, 'Sep 2026');
  assert.equal(r.theme, 'Capital goods / industrial machinery');
  const bare = reviewItem(base())!;
  assert.ok(bare.mb.minus.some((m) => /growth figures unknown/.test(m)));
  assert.ok(r.mb.score > bare.mb.score);
});

test('page: number tiles are buttons, ranking by chanceOf, routes read through the review', () => {
  const pg = readFileSync(new URL('../../app/(dashboard)/transformational-gainers/page.tsx', import.meta.url), 'utf8');
  assert.match(pg, /<button type="button" key=\{t\.k\} onClick=\{t\.click\}/);
  assert.match(pg, /chanceOf\(b\.best\)\.score - chanceOf\(a\.best\)\.score/);
  for (const f of ['../../app/api/v1/transformational/route.ts', '../../app/api/v1/transformational/ai/route.ts'])
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /loadReviewed\(/);
});
