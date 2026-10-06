// zzz920 — company-by-company check of Guidance Upgrades against the owner's InvestorStack list. What production showed (6 Oct 2026, guidance-diagnose + the
// live universe) and what was wrong in code:
//   • Emerald "PAT +66%" was filed as REVENUE_GROWTH and shown as revenue growth;
//   • Frog "₹50 Cr from CCTV" (label "CCTV revenue") and PNB "25% in the MSME segment" were shown as company revenue;
//   • 25 "free cash flow" rows were capex / debt repayment / working-capital sentences (Virtuoso: "total CapEx ₹80–100 Cr");
//   • "FY29 loan book target (revenue-like?)" (Capital SFB) and "AUM projection (proxy for revenue guidance)" (Muthoot Capital) were shown as revenue;
//   • a rate filed as an amount row (metric REVENUE, unit %, low 30) had no growth figure and was dropped as "long_term_without_period";
//   • a figure the transcript spells out ("seventy percent") failed the number-in-quote check.
// Run: npx tsx --test src/lib/__tests__/zzz920-guidance-verify.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { scopeIssueOf, metricFromQuote, fcfIssueOf, labelPartOf, spokenNumbersIn, LONG_TERM_LABEL } from '../guidance-horizon';
import { checkRows, numberInQuote, rateRowOf } from '../ai-guidance-extract';
import { growthQuoteIssue, quoteHasNumber } from '../guidance-growth-quote';
import { buildUniverse, itemsFromExtracted } from '../guidance-universe';
import { actualsFromDocs } from '../guidance-extract-reader';
import type { ExtractedGuidance, GuidanceExtractResult } from '../guidance-docs-types';

const NOW = new Date('2026-10-06T17:00:00Z');
const xrow = (o: Partial<ExtractedGuidance> & { metric: any; period: string; quote: string }): ExtractedGuidance => ({
  metricLabel: '', periodKind: 'ANNUAL', basis: 'UNSTATED', currency: null, unit: '%', low: null, high: null, growthPctLow: null, growthPctHigh: null, status: 'NEW',
  prior: null, priorActual: null, speaker: null, confidence: 0.8, ...o,
} as ExtractedGuidance);
const xres = (t: string, company: string, rows: ExtractedGuidance[], filedAt = '2026-08-13T00:00:00.000Z'): GuidanceExtractResult => ({
  docId: `doc-${t}-${filedAt.slice(0, 10)}`, market: 'IN', ticker: t, company, docUrl: `https://www.bseindia.com/${t}.pdf`, docKind: 'TRANSCRIPT', filedAt,
  extractedAt: '2026-10-05T00:00:00Z', model: 'test', status: 'ok', rows, dropped: 0,
});
const items = (r: GuidanceExtractResult) => itemsFromExtracted([r], actualsFromDocs([r]), NOW);

describe('zzz920 what is the sentence about?', () => {
  test('Emerald: a PAT sentence filed as revenue growth is PAT, not revenue', () => {
    const q = "we'll have to grow our PAT by 66% in order to move to EPS of 7.";
    assert.equal(metricFromQuote('REVENUE_GROWTH', q), 'PAT');
    const [it] = items(xres('EMERALD', 'Emerald Finance Ltd', [xrow({ metric: 'REVENUE_GROWTH', period: 'FY27', low: 66, high: 66, growthPctLow: 66, quote: q })]));
    assert.equal(it.metric, 'PAT');
  });
  test('a sentence that names revenue stays revenue; one with revenue and PAT too (Veranda, Ganesh Housing) stays revenue', () => {
    assert.equal(metricFromQuote('REVENUE', 'we could register revenues of about Rs. 1000 crores and a PAT of Rs. 300 crores'), null);
    assert.equal(metricFromQuote('REVENUE_GROWTH', 'growth is going to be 30% to 40%'), null);
    assert.equal(metricFromQuote('REVENUE_GROWTH', 'we expect 30%', 'Revenue growth'), null);
    assert.equal(metricFromQuote('PAT', 'PAT growth of 30%'), null);   // only revenue rows are re-read
    assert.equal(metricFromQuote('REVENUE', 'EBITDA to grow 25% next year'), 'EBITDA');
  });
  test('free cash flow must be about cash flow: Virtuoso capex, Ashoka capex, Gokaldas working capital are not FCF', () => {
    assert.ok(fcfIssueOf('total CapEx, this year we are looking at about between INR80 crores and INR100 crores in VOEPL.', 'Total CapEx for VOEPL this year'));
    assert.ok(fcfIssueOf('our intention is to bring down our working capital to the extent of INR75 crores', 'working capital reduction target'));
    assert.ok(fcfIssueOf('we are repaying around Rs. 100 crores', 'debt repayment'));
    assert.equal(fcfIssueOf('we expect free cash flow of about ₹120 crore in FY27', 'free cash flow'), null);
    assert.equal(fcfIssueOf('FCF will be positive at ₹50 crore', null), null);
    const q = 'total CapEx, this year we are looking at about between INR80 crores and INR100 crores in VOEPL.';
    const r = xres('VOEPL', 'Virtuoso Optoelectronics Limited', [xrow({ metric: 'FCF', metricLabel: 'Total CapEx for VOEPL this year', period: 'FY27', currency: 'INR', unit: 'crore', low: 80, high: 100, quote: q })]);
    assert.equal(items(r).length, 0);
  });
});

describe('zzz920 one part of the company is not the company', () => {
  test('Frog: "50 CR from CCTV" (label CCTV revenue) goes to review, not Active revenue', () => {
    const q = 'This year, hopefully, you know, we should be doing around 50 CR from CCTV.';
    assert.match(scopeIssueOf(q, { metric: 'REVENUE', market: 'IN', metricLabel: 'CCTV revenue', company: 'Frog Innovations Ltd' })!, /^one part of the company/);
    const r = xres('FROG', 'Frog Innovations Ltd', [xrow({ metric: 'REVENUE', metricLabel: 'CCTV revenue', period: 'FY27', currency: 'INR', unit: 'crore', low: 50, high: 50, quote: q })]);
    const [it] = items(r); assert.match(it.needsReview!, /Not the company-wide figure/);
    const u = buildUniverse([], [], [], NOW, { extracted: { results: [r], actuals: actualsFromDocs([r]) } });
    assert.equal(u.defaultRecords.some((x) => x.tickers.includes('FROG')), false);
    assert.equal(u.reviewQueue.some((x) => x.tickers.includes('FROG')), true);
  });
  test('Frog: the company figure "₹220 Cr from ₹106 Cr" is still read as revenue with the document\'s own FY26 base', () => {
    const q = 'we are targeting FY27 revenue of approximately Rs 220 crore from FY26 base of Rs 106 crore';
    assert.equal(scopeIssueOf(q, { metric: 'REVENUE', market: 'IN', metricLabel: 'FY27 revenue target', company: 'Frog Innovations Ltd' }), null);
    const r = xres('FROG', 'Frog Innovations Ltd', [xrow({ metric: 'REVENUE', metricLabel: 'FY27 revenue target', period: 'FY27', currency: 'INR', unit: 'crore', low: 220, high: 220, quote: q, priorActual: { period: 'FY26', value: 106, quote: 'FY26 base of Rs 106 crore' } })]);
    const [it] = items(r); assert.equal(it.needsReview, null); assert.equal(Math.round(it.low!), 108);
  });
  test('PNB: "growth of around 25% in the MSME segment" is a segment figure', () => {
    const q = 'We are expecting that we will be touching a growth of around 25% in the MSME segment.';
    assert.match(scopeIssueOf(q, { metric: 'REVENUE', market: 'IN', company: 'Punjab National Bank' })!, /MSME segment/);
  });
  test('Sanand facility revenue, "incremental revenue from new 150 KLPD unit" are parts; Aequs aerospace is a part', () => {
    assert.equal(labelPartOf('Sanand facility revenue target'), 'Sanand facility');
    assert.ok(labelPartOf('incremental revenue from new 150 KLPD unit'));
    assert.equal(labelPartOf('aerospace revenue growth'), 'aerospace');
    assert.match(scopeIssueOf('we are expecting somewhere around INR300 crores from that unit', { metric: 'REVENUE', market: 'IN', metricLabel: 'incremental revenue from new 150 KLPD unit', company: 'Bcl Industries Limited' })!, /^one part of the company/);
  });
  test('company-wide labels and wording are NOT flagged (no new false positives)', () => {
    for (const label of ['consolidated revenue guidance FY27 (alternative)', 'Revenue growth', 'FY27 revenue', 'total income guidance', 'Standalone revenue target', 'revenue', '', 'Net sales growth', 'Revenue guidance for FY28']) {
      assert.equal(labelPartOf(label), null, label);
    }
    // Alivus: the part is named BEFORE the figure, and the figure is "revenue growth of 10-12%"
    assert.equal(scopeIssueOf('With a continued strong growth momentum in the non-GPL portfolio and muted growth in the GPL business, we remain confident of achieving revenue growth of 10% - 12% in FY27', { metric: 'REVENUE', market: 'IN', company: 'Alivus Life Sciences Limited' }), null);
    // Fredun: "this business" is the company
    assert.equal(scopeIssueOf('we expect 25% to 35% growth in this business year-on-year, even for the next 5 years', { metric: 'REVENUE', market: 'IN', company: 'Fredun Pharmaceuticals Limited' }), null);
    // a period after "from" is not a product
    assert.equal(scopeIssueOf('we expect INR 1200 crores from FY27 onwards', { metric: 'REVENUE', market: 'IN', company: 'X Ltd' }), null);
    assert.equal(scopeIssueOf('revenue of 500 crores from operations', { metric: 'REVENUE', market: 'IN', company: 'X Ltd' }), null);
  });
  test('loan book / AUM hedged as "revenue-like" in the label are not revenue (Capital SFB, Muthoot Capital)', () => {
    assert.match(scopeIssueOf('well positioned to achieve the targeted FY29 loan book of ₹16,000++ crore', { metric: 'REVENUE', market: 'IN', metricLabel: 'FY29 loan book target (revenue-like?)', company: 'Capital Small Finance Bank Limited' })!, /AUM|loan book/);
    assert.match(scopeIssueOf('the AUM projections that we had given was around INR4,000 crores to INR4,200 crores', { metric: 'REVENUE', market: 'IN', metricLabel: 'AUM projection (proxy for revenue guidance)', company: 'Muthoot Capital Services Limited' })!, /AUM/);
    const r = xres('MUTHOOTCAP', 'Muthoot Capital Services Limited', [xrow({ metric: 'REVENUE', metricLabel: 'AUM projection (proxy for revenue guidance)', period: 'FY27', currency: 'INR', unit: 'crore', low: 4000, high: 4200, quote: 'the AUM projections that we had given was around INR4,000 crores to INR4,200 crores' })]);
    assert.equal(items(r).length, 0);
  });
});

describe('zzz920 reading a rate and spoken numbers', () => {
  const doc = (text: string) => ({ kind: 'TRANSCRIPT' as const, text, market: 'IN' as const, filedAt: '2026-08-13T00:00:00.000Z' });
  const raw = (o: Record<string, unknown>) => ({
    metric: 'REVENUE', metric_label: 'revenue growth', period: 'FY27', period_kind: 'ANNUAL', basis: 'UNSTATED', currency: null, unit: '%', low: null, high: null, growth_pct_low: null, growth_pct_high: null,
    status: 'NEW', prior_low: null, prior_high: null, prior_stated_in: null, prior_actual_period: null, prior_actual_value: null, prior_actual_quote: null, quote: '', speaker: null, confidence: 0.8, ...o,
  });
  test('a rate filed as an amount row (REVENUE, unit %, low 30) becomes a growth figure; "30%+ annually in the long term" is kept (Mobavenue)', () => {
    const q = 'Management targets 30%+ revenue growth annually in the long term.';
    const r = rateRowOf(raw({ metric: 'REVENUE', unit: '%', low: 30, high: null, period: 'Long term', period_kind: 'MULTI_YEAR', quote: q }) as any);
    assert.equal(r.growth_pct_low, 30); assert.equal(r.low, null);
    const c = checkRows([raw({ metric: 'REVENUE', unit: '%', low: 30, high: null, period: 'Long term', period_kind: 'MULTI_YEAR', quote: q })], doc(`Opening remarks. ${q} Thank you.`));
    assert.equal(c.rows.length, 1, JSON.stringify(c.reasons));
    assert.equal(c.rows[0].period, LONG_TERM_LABEL); assert.equal(c.rows[0].growthPctLow, 30);
    assert.equal(rateRowOf(raw({ metric: 'REVENUE', unit: 'crore', low: 900, high: 1000 }) as any).low, 900, 'an amount row is untouched');
    assert.equal(rateRowOf(raw({ metric: 'EBITDA_MARGIN', unit: '%', low: 18 }) as any).low, 18, 'a margin row is untouched');
  });
  test('spoken numbers count as numbers in the quote (UTL Solar "seventy percent")', () => {
    assert.deepEqual(spokenNumbersIn('thirty five to forty percent and seventy-odd, twenty-five, nine'), [35, 40, 70, 25]);
    assert.ok(numberInQuote(70, 'we expect revenue to grow by around seventy percent in FY27'));
    assert.ok(quoteHasNumber('we expect revenue to grow by around seventy percent', 70));
    assert.equal(growthQuoteIssue('we expect revenue to grow by around seventy percent in FY27', 70, 70, 'REVENUE', { annual: true, numberCheck: true }), null);
    const q = 'We expect our revenue to grow by around seventy percent in FY27.';
    const c = checkRows([raw({ metric: 'REVENUE_GROWTH', unit: '%', low: 70, high: 70, growth_pct_low: 70, quote: q })], doc(`Remarks. ${q} Thank you.`));
    assert.equal(c.rows.length, 1, JSON.stringify(c.reasons));
    assert.equal(c.samples.length, 0);
  });
  test('dropped rows leave a sample (reason + quote) so "why was it dropped" can be answered later', () => {
    const q = 'We will do something around thirty crores of other things.';
    const c = checkRows([raw({ metric: 'REVENUE', unit: 'crore', low: 99, high: 99, period: 'FY27', quote: q })], doc(`Remarks. ${q} Thank you.`));
    assert.equal(c.rows.length, 0); assert.equal(c.samples[0].reason, 'number_not_in_quote'); assert.match(c.samples[0].quote, /thirty crores/);
  });
});

describe('zzz920 the owner\'s list: the suitable stay, the unsuitable stay out', () => {
  test('suitable phrasings still produce Active / review items (no regression from the new part checks)', () => {
    const cases: Array<[string, string, ExtractedGuidance]> = [
      ['SUNRAKSHAK', 'Sunrakshakk Industries India Limited', xrow({ metric: 'REVENUE_GROWTH', period: 'FY25-FY29', periodKind: 'MULTI_YEAR', low: 30, high: 35, growthPctLow: 30, growthPctHigh: 35, quote: 'we expect 30-35% CAGR in revenue between FY25 and FY29' })],
      ['CCAVENUE', 'AvenuesAI Ltd', xrow({ metric: 'REVENUE_GROWTH', metricLabel: 'consolidated revenue growth', period: 'FY27', low: 35, high: null, growthPctLow: 35, quote: 'our company expects FY27 consolidated revenue to grow by 35% plus' })],
      ['GKENERGY', 'GK Energy Ltd', xrow({ metric: 'REVENUE_GROWTH', period: 'FY27', low: 100, high: 100, growthPctLow: 100, quote: 'we expect our revenue to double in FY27' })],
      ['ARSSBL', 'Anand Rathi Share & Stock Brokers Ltd', xrow({ metric: 'PAT', period: 'FY27', low: null, growthPctLow: 30, growthPctHigh: 35, quote: 'we are targeting PAT growth of 30% to 35% in FY27' })],
    ];
    for (const [t, n, row] of cases) {
      const r = xres(t, n, [row]);
      const u = buildUniverse([], [], [], NOW, { extracted: { results: [r], actuals: actualsFromDocs([r]) } });
      assert.ok(u.defaultRecords.some((x) => x.tickers.includes(t)) || u.reviewQueue.some((x) => x.tickers.includes(t)), t);
    }
  });
  test('unsuitable ones stay out of Active company revenue: FCL subsidiary, PINELABS / FIRSTCRY / KISSHT / AYE / EQUITASBNK measures', () => {
    const gone = (t: string, q: string, o: Partial<ExtractedGuidance>) => {
      const r = xres(t, `${t} Ltd`, [xrow({ metric: 'REVENUE_GROWTH', period: 'FY27', growthPctLow: 40, low: 40, quote: q, ...o })]);
      const u = buildUniverse([], [], [], NOW, { extracted: { results: [r], actuals: actualsFromDocs([r]) } });
      return u.defaultRecords.some((x) => x.tickers.includes(t));
    };
    assert.equal(gone('FCL', 'We target US CrudeChem revenue to reach $100 million in FY27.', { metric: 'REVENUE', metricLabel: 'US CrudeChem revenue', currency: 'USD', unit: 'million', low: 100, high: 100, growthPctLow: null }), false);
    assert.equal(gone('KISSHT', 'We expect AUM growth upwards of 40% in FY27.', {}), false);
    assert.equal(gone('AYE', 'We target 25-30% AUM growth in FY27.', { low: 25, high: 30, growthPctLow: 25, growthPctHigh: 30 }), false);
    assert.equal(gone('EQUITASBNK', 'We expect 20%+ advances growth in FY27.', { low: 20, growthPctLow: 20 }), false);
    assert.equal(gone('FIRSTCRY', 'We target preschool count to double to 1,000 in the next 2 years.', { metric: 'REVENUE', low: 1000, growthPctLow: null, unit: 'units' } as any), false);
    assert.equal(gone('PNB', 'We are expecting that we will be touching a growth of around 25% in the MSME segment.', { low: 25, growthPctLow: 25 }), false);
  });
});
