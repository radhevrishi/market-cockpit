// zzz1220 — AI Daily Gainers India: wrong labels and false conflicts seen on 3 Nov 2026 (GREENPANEL, GRSE, SSWL, KANOHAR, MOLDTKPAC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIndiaEvents, figureMetric, rupeeGlyphRepair } from '../ai-gainers/in-event-taxonomy';
import { reconcileValues } from '../ai-gainers/structured-facts';
import { extractIndiaFacts, isResultsRelease, resultsLine } from '../ai-gainers/india-extract';
import { periodMonthsOf } from '../ai-gainers/research-view';
import { themeOf } from '../transformational/core';

const ids = (t: string, headline = false) => classifyIndiaEvents(t, { headline }).map((h) => h.id);

test('revenue up while EBITDA fell is revenue growth, never a revenue decline (GREENPANEL)', () => {
  const h = ids('Greenpanel revenue rose 4.6% as Q2 operating EBITDA fell 23.5%', true);
  assert.ok(!h.includes('revenue_decline'), h.join(','));
  assert.ok(h.includes('revenue_growth'), h.join(','));
  assert.ok(h.includes('profit_decline'), h.join(','));
});

test('a real revenue decline still reads as one', () => {
  assert.ok(ids('Revenue from operations declined 12% to Rs 410 crore', true).includes('revenue_decline'));
  assert.ok(ids('PAT rose 10% even as revenue fell 3%', true).includes('revenue_decline'));
  assert.ok(!ids('PAT rose 10% even as revenue fell 3%', true).includes('profit_decline'));
});

test('a rescheduled board meeting is not a filed result (GRSE)', () => {
  const h = ids('Board meeting to approve Q2 FY27 results rescheduled from 4 Nov 2026 to 11 Nov 2026.', true);
  assert.ok(!h.includes('results_filed'), h.join(','));
  assert.ok(!ids('Board meeting postponed — quarterly results will now be considered on 14 November', true).includes('results_filed'));
});

test('₹ sign printed as "4" is the same value, not a conflict (SSWL)', () => {
  assert.equal(rupeeGlyphRepair(4647.05, 647.05), true);
  assert.equal(rupeeGlyphRepair(1647.05, 647.05), false);
  assert.equal(rupeeGlyphRepair(867.3, 208.6), false);
  const r = reconcileValues([{ value: 4647.05, unit: 'INR_CRORE', source: 'filed', text: 'Rs 4647.05 crore' }, { value: 647.05, unit: 'INR_CRORE', source: 'headline', text: 'Rs 647.05 crore' }]);
  assert.equal(r.valueStatus, 'verified');
  assert.equal(r.usable?.value, 647.05);
});

test('an order value and a revenue value measure different things (KANOHAR)', () => {
  const ord = 'During the quarter, we secured fresh orders worth ~Rs. 867.3 Cr, taking our outstanding order book to Rs. 2,711.2 Cr as of 30th Sep 2026';
  assert.equal(figureMetric(ord, 'Rs. 867.3 Cr'), 'order');
  assert.equal(figureMetric(ord, 'Rs. 2,711.2 Cr'), 'book');
  assert.equal(figureMetric('For Q2FY27, revenues grew by 112% to Rs. 208.6 Crs', 'Rs. 208.6 Crs'), 'revenue');
});

const KANOHAR = `Kanohar Electricals Q2FY27 results. PAT up 180% to 53.9Cr. Meerut, India November 2nd, 2026: Kanohar Electricals Limited, one of the leading domestic players in transformer manufacturing, announced its unaudited standalone financial results for the quarter ended September 30, 2026. For Q2FY27 basis, revenues grew by 112% to Rs. 208.6 Crs, while EBITDA margin came in at 35.0% and PAT margins stood at 25.8%. During the quarter, we secured fresh orders worth ~Rs. 867.3 Cr, taking our outstanding order book to Rs. 2,711.2 Cr as of 30th Sep 2026, executable over the next 24-30 months. The brownfield expansion at our Gangol unit is on track, with commissioning expected by FY29. We remain confident of reaching revenue of Rs. 950 Cr this year.`;

test('a results release that mentions orders and a plant is a RESULT, with a plain headline (KANOHAR)', () => {
  assert.equal(isResultsRelease(KANOHAR), true);
  const r = resultsLine(KANOHAR)!;
  assert.match(r.line, /revenue \+112% to ₹208\.6 Cr/);
  assert.match(r.line, /PAT \+180% to ₹53\.9 Cr/);
  assert.match(r.line, /orders won in the period ₹867\.3 Cr/);
  assert.equal(r.polarity, 'positive');
  const x = extractIndiaFacts({ text: KANOHAR, issuer: 'KANOHAR', date: '2026-11-02', url: null, title: 'Results' } as any);
  assert.equal(x.facts[0]?.event.kind, 'results');
  assert.ok(!/proposed/i.test(x.facts[0]?.headline || ''), x.facts[0]?.headline);
});

test('a Reg-30 order letter stays an order', () => {
  const t = 'Intimation under Regulation 30 - Receipt of order. Name of the entity awarding the order: Indian Navy. Broad consideration or size of the order(s) 32,000 Crore. Project to be completed within 09 years 04 months. '.repeat(2);
  assert.equal(isResultsRelease(t), false);
  const x = extractIndiaFacts({ text: t, issuer: 'GRSE', date: '2026-11-02', url: null, title: 'Order' } as any);
  assert.equal(x.facts[0]?.event.kind, 'order');
  assert.match(String(x.facts[0]?.time.executionPeriod), /09 years 04 months/);
});

test('"9 years 4 months" is 112 months, not 4 (GRSE)', () => {
  assert.equal(periodMonthsOf('09 years 04 months'), 112);
  assert.equal(periodMonthsOf('18 months from the date of LoA'), 18);
  assert.equal(periodMonthsOf('2 years'), 24);
  assert.ok(Number.isNaN(periodMonthsOf('soon')));
});

test('the company name decides the theme before customer words (MOLDTKPAC)', () => {
  const t = themeOf(['Mold-Tek Packaging', 'bagged new orders from Pharmaforce and Life wise Pharmaceuticals from Pharma Industry'], null, 'Mold-Tek Packaging');
  assert.equal(t.theme, 'Paper & packaging');
});

test('the order letter form: "completed within 09 years 04 months from the date of receipt" (GRSE, live text)', () => {
  const t = 'Receipt of order. Name of the entity awarding the order: Indian Navy. Broad consideration or size of the order(s) 32,000 Crore 3. is to be executed Project to be completed within 09 years 04 months from the date of receipt of first stage payment. '.repeat(2);
  const x = extractIndiaFacts({ text: t, issuer: 'GRSE', date: '2026-11-02', url: null, title: 'Order' } as any);
  assert.match(String(x.facts[0]?.time.executionPeriod), /^09 years 04 months/);
});
