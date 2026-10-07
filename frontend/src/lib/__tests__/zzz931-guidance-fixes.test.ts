// zzz931 — Guidance Upgrades focus list defects from the owner's live screen (7 Oct 2026, 3:23 Berlin). No network, no AI.
//   1. "double in N years" was shown as +100% a year (Novartis India, Diffusion Engineers, Transpek)
//   2. a blank-cheque company (SPAC) showed the target's projections as its own guidance (Hall Chadwick Acquisition Corp)
//   3. a block of India fair values at "more than +250%" (derived multiples ignored the company's own margins; contractors on the
//      property-developer band; profit that was mostly other income valued on a P/E)
//   4. USA fair value "—" for loss-makers (only P/S could be worked): the street's next-year EPS gives a second method
//   5. share / mix / margin / visibility figures, past "would have been" rates, named business parts and GOV filed as revenue growth
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { totalToAnnual, horizonOf, spacIssueOf, scopeIssueOf, namedPartOf } from '../guidance-horizon';
import { growthQuoteIssue } from '../guidance-growth-quote';
import { itemsFromExtracted, buildUniverse, displayOf, type GuUniverseRecordX } from '../guidance-universe';
import { fairValue, marginFit, bandsFor, sectorOf, type FvFacts } from '../gu-fair-value';
import { usFactsFromRow } from '../gu-skygold-facts';
import type { ExtractedGuidance, GuidanceExtractResult } from '../guidance-docs-types';

const Q = {
  DIFF: 'we try to expect ourselves to double in next 3 years.',
  TRANSPEK: 'we are looking to double our size and business in next 5 years.',
  NOVARTIS: "Roughly the run rate, annualized run rate, should be around INR650-odd crores for '27, and you can see that doubling over the next four to five years.",
  ZTECH_WHOLE: 'we should be doubling every year for at least next three to five years',
  AKIKO: 'my vision is very clear for the next 3 years that our CAGR will remain the same at 70% to 100% year-on-year basis.',
  BMW: 'We reiterate our earlier guidance of approximately 70% to 75% consolidated revenue CAGR over FY25 to FY28',
  NPST: 'Yes, year-on-year, you can say CAGR, 60%-70% we are targeting for next 2-3 years.',
  KRISHIVAL: 'Implied FY26→FY29 CAGR: ~73% | ~5x scale-up in 3 years',
  TOTAL_PCT: 'We aim to grow revenue by 50% over the next three years.',
};

describe('1 · a total over several years becomes the yearly rate', () => {
  test('"double in N years": 2^(1/N) − 1', () => {
    assert.deepEqual(pick(totalToAnnual(Q.DIFF, 100, 100, 'Next 3 years')), { low: 26, high: 26, years: 3, yearsMin: 3, kind: 'multiple' });
    assert.deepEqual(pick(totalToAnnual(Q.TRANSPEK, 100, 100, 'Next 5 years')), { low: 14.9, high: 14.9, years: 5, yearsMin: 5, kind: 'multiple' });
  });
  test('"doubling over the next four to five years" → a range 14.9–18.9% a year ("annualized run rate" elsewhere in the sentence is not "a year")', () => {
    assert.equal(horizonOf(Q.NOVARTIS)!.yearsMin, 4);
    assert.deepEqual(pick(totalToAnnual(Q.NOVARTIS, 100, 100, 'Next 5 years')), { low: 14.9, high: 18.9, years: 5, yearsMin: 4, kind: 'multiple' });
  });
  test('"grow revenue by 50% over three years" (a total %) → 14.5% a year', () => {
    assert.deepEqual(pick(totalToAnnual(Q.TOTAL_PCT, 50, 50, 'Next 3 years')), { low: 14.5, high: 14.5, years: 3, yearsMin: 3, kind: 'percent' });
  });
  test('a rate the company says is yearly stays as stated', () => {
    assert.equal(totalToAnnual(Q.ZTECH_WHOLE, 100, 100, 'Next 5 years'), null, 'doubling EVERY YEAR is +100% a year');
    assert.equal(totalToAnnual(Q.AKIKO, 70, 100, 'Next 3 years'), null);
    assert.equal(totalToAnnual(Q.BMW, 70, 75, 'FY25-28'), null);
    assert.equal(totalToAnnual(Q.NPST, 60, 70, 'Next 3 years'), null);
    assert.equal(totalToAnnual(Q.KRISHIVAL, 73, 73, 'FY26-29'), null, '~5x is not the 73% figure; the 73% is a stated CAGR');
  });
  test('a single year or an unknown span is not converted', () => {
    assert.equal(totalToAnnual('With strong order visibility, we expect FY27 revenue to double.', 100, 100, 'FY27'), null);
    assert.equal(totalToAnnual(Q.DIFF, null, null, 'Next 3 years'), null);
  });
  test('universe: the row is shown as a yearly rate worked out from the company\'s words, ranked, never "+100% a year"', () => {
    const items = itemsFromExtracted([xres('DIFFNKG', 'Diffusion Engineers Ltd', [row({ quote: Q.DIFF, growthPctLow: 100, growthPctHigh: 100, period: 'NEXT 3 YEARS', periodKind: 'MULTI_YEAR' })])], null, NOW);
    assert.equal(items.length, 1);
    const it = items[0];
    assert.equal(it.pkind, 'MULTI_YEAR_CAGR'); assert.equal(it.low, 26); assert.equal(it.high, 26); assert.equal(it.gOrigin, 'IMPLIED');
    assert.equal(it.cagrFromBase!.how, 'total'); assert.equal(it.needsReview, null);
    const u = buildUniverse([], [], [], NOW, { extracted: { results: [xres('DIFFNKG', 'Diffusion Engineers Ltd', [row({ quote: Q.DIFF, growthPctLow: 100, growthPctHigh: 100, period: 'NEXT 3 YEARS', periodKind: 'MULTI_YEAR' })])], actuals: null } });
    const rec = [...u.defaultRecords, ...u.reviewQueue].find((x: GuUniverseRecordX) => x.record.ticker === 'DIFFNKG')!;
    const pt = rec.points.find((p) => p.metric === 'REVENUE')!;
    assert.match(pt.display, /^3-yr revenue CAGR \+26(\.0)?% \(a year, worked out from the company's total: "double in next 3 years" over 3 years\)/);
    assert.equal(pt.growthType, 'DERIVED');
    assert.ok(!/\+100%/.test(pt.display));
  });
  test('universe: a one-year row whose sentence states a CAGR to a year 2+ years out is a multi-year rate (Hardwyn "by FY32 … 30–35% CAGR")', () => {
    const [it] = itemsFromExtracted([xres('HARDWYN', 'Hardwyn India Ltd', [row({ quote: 'Looking ahead, we have set an ambitious yet achievable target of reaching ₹1,000 Crore+ in revenue by FY32, implying a 30–35% CAGR.', growthPctLow: 30, growthPctHigh: 35, period: 'FY32', periodKind: 'ANNUAL' })])], null, NOW);
    assert.equal(it.pkind, 'MULTI_YEAR_CAGR'); assert.equal(it.period, 'FY27-32'); assert.equal(displayOf({ metric: it.metric, low: it.low, high: it.high, open: it.open, origin: 'STATED', periodKind: it.pkind, period: it.period, abs: null }), '6-yr revenue CAGR +30–35%'); assert.deepEqual([it.low, it.high], [30, 35]);
  });
});

describe('2 · blank-cheque (SPAC) companies are not company guidance', () => {
  test('name and sentence tests', () => {
    assert.ok(spacIssueOf('Hall Chadwick Acquisition Corp'));
    assert.ok(spacIssueOf('Some Acquisition Corporation II'));
    assert.ok(spacIssueOf('XYZ Holdings Inc', 'Following the business combination, the combined company expects revenue of $144M'));
    assert.equal(spacIssueOf('Acquisition-heavy Industries Ltd', 'We expect 30% growth'), null);
    assert.equal(spacIssueOf('Bharat Forge Ltd', 'acquisitions will add 10%'), null);
  });
  test('universe: kept for review, not ranked', () => {
    const [it] = itemsFromExtracted([xres('HCAC', 'Hall Chadwick Acquisition Corp', [row({ quote: '~164% Revenue CAGR, 2027E 2029E ~$144M', growthPctLow: 164, growthPctHigh: 164, period: 'FY27-29', periodKind: 'MULTI_YEAR', currency: 'USD' })], 'US')], null, NOW);
    assert.match(it.needsReview!, /blank-cheque/);
  });
  test('fair value: none for a blank-cheque company', () => {
    const r = fairValue(F({ market: 'US', industry: 'Blank Checks', sector: 'Finance' }), G());
    assert.equal(r.ok, false); assert.match(r.reason!, /blank-cheque/);
    assert.equal(fairValue(F({ market: 'US', industry: 'Industrial Machinery' }), G(), 'Hall Chadwick Acquisition Corp').ok, false);
  });
});

describe('3 · India fair values: the derived multiples fit the company\'s own margins', () => {
  test('marginFit scales a derived P/S down to the net margin and a derived EV/EBITDA down to profit ÷ EBITDA; never up; native band untouched', () => {
    const b = bandsFor('Industrials / Capital Goods', false);   // native P/E 35, derived P/S 4.9 (assumes 14% net), EV/EBITDA 24.5 (assumes 0.7)
    const thin = marginFit('Industrials / Capital Goods', b, 0.02, 0.17);
    assert.equal(thin.ps, 0.15); assert.equal(thin.ev, 0.24);
    const rich = marginFit('Industrials / Capital Goods', b, 0.3, 0.9);
    assert.equal(rich.ps, 1); assert.equal(rich.ev, 1);
    const cement = marginFit('Cement', bandsFor('Cement', false), 0.02, 0.1);   // native EV/EBITDA: not scaled
    assert.equal(cement.ev, 1); assert.ok(cement.ps < 1);
    assert.equal(marginFit('SaaS / Software (US)', bandsFor('SaaS / Software (US)', false), 0.01, null).ps, 1, 'a P/S-native sector keeps its P/S band');
  });
  test('contractors are valued on the EPC band, packaging on its own band; building materials are not developers', () => {
    assert.equal(sectorOf('Civil Construction', 'Construction').key, 'EPC / Civil Construction');
    assert.equal(sectorOf('Residential, Commercial Projects', 'Realty').key, 'Real Estate / Construction');
    assert.equal(sectorOf('Packaging', 'Capital Goods').key, 'Packaging');
    assert.equal(sectorOf('Other Construction Materials', 'Construction Materials').key, 'Industrials / Capital Goods');
    // Nasdaq files a computer maker under "Retail: Computer Software & Peripheral Equipment" (HPE was on the retail P/E 50-90x band)
    assert.equal(sectorOf('Retail: Computer Software & Peripheral Equipment', 'Technology').key, 'IT / Tech Services');
    assert.equal(sectorOf('Speciality Retail', 'Consumer Services').key, 'Retail & E-Commerce');
  });
  test('a thin-margin business no longer comes out above +250% (UFlex-like: ₹15,400 Cr sales, 2% net margin, P/E 7)', () => {
    const f = F({ price: 641, mcap: 4631, salesBase: 15401, opFy: 1854, patFy: 317, borrowings: 10152, salesGrowthFy: 2.4, salesCagr3y: 2, industry: 'Packaging', sector: 'Capital Goods', otherIncomePctOfPbt: 13.1 });
    const r = fairValue(f, G({ growthPct: 30 }));
    assert.equal(r.ok, true);
    assert.ok(r.base!.upsidePct < 100, String(r.base!.upsidePct));
    assert.ok(r.inputs.some((i) => /P\/S multiple scaled/.test(i)));
  });
  test('a contractor on the developer band was +250%+; on the EPC band it is ordinary (GPT Infra-like)', () => {
    const r = fairValue(F({ price: 122, mcap: 1538, salesBase: 1290, opFy: 175, patFy: 97, borrowings: 294, salesGrowthFy: 8.6, salesCagr3y: 17, industry: 'Civil Construction', sector: 'Construction' }), G({ growthPct: 30 }));
    assert.equal(r.ok, true); assert.ok(r.base!.upsidePct > 0 && r.base!.upsidePct < 60, String(r.base!.upsidePct));
  });
  test('profit that is mostly other income: no P/E above 60% of profit before tax; reduced to the core profit from 25%', () => {
    const big = fairValue(F({ otherIncomePctOfPbt: 82 }), G());
    assert.ok(!big.methods.some((m) => m.label === 'P/E')); assert.ok(big.inputs.some((i) => /other income is 82% of profit before tax — P\/E not used/.test(i)));
    const mid = fairValue(F({ patFy: 70, opFy: 125, otherIncomePctOfPbt: 40 }), G());
    const pe = mid.methods.find((m) => m.label === 'P/E')!;
    assert.ok(pe, 'P/E kept'); assert.equal(pe.baseFair, Math.round(100 * ((70 * 0.6 * 1.2 * 25) / 1000) * 100) / 100);
  });
});

describe('4 · USA: a second method for a loss-maker from the street\'s next-year EPS', () => {
  test('the facts carry the next-year EPS estimate', () => {
    const f = usFactsFromRow('ZZZ', { source: 'sec-xbrl', revenue_curr_musd: 100, net_income_curr_musd: -5 }, [{ period: '0y', current: -0.2, d90: -0.3 }, { period: '+1y', current: 0.8, d90: 0.7 }])!;
    assert.equal(f.streetEpsNext, 0.8);
    assert.equal(usFactsFromRow('ZZZ', { source: 'sec-xbrl', revenue_curr_musd: 100, net_income_curr_musd: -5 }, [{ period: '+1y', current: -0.1, d90: -0.2 }])!.streetEpsNext ?? null, null);
  });
  test('loss-making + positive street EPS → P/S and P/E (low confidence) → a number; without it, still a dash', () => {
    const base = { market: 'US' as const, price: 20, mcap: 2000, salesBase: 800, patFy: -40, opFy: null, borrowings: null, industry: 'Medical/Dental Instruments', sector: 'Health Care' };
    const with_ = fairValue(F({ ...base, streetEpsNext: 1.2 }), G({ growthPct: 30 }));
    assert.equal(with_.ok, true, with_.reason || '');
    const pe = with_.methods.find((m) => m.label === 'P/E')!;
    assert.equal(pe.conf, 'LOW');
    assert.ok(with_.inputs.some((i) => /analysts' next-year EPS \$1\.2/.test(i)));
    const without = fairValue(F(base), G({ growthPct: 30 }));
    assert.equal(without.ok, false); assert.match(without.reason!, /only 1 valuation method/);
  });
  test('a profitable company keeps its own profit (the street figure is not used)', () => {
    const r = fairValue(F({ market: 'US', price: 50, mcap: 5000, salesBase: 2000, patFy: 200, opFy: null, borrowings: null, industry: 'Prepackaged Software', streetEpsNext: 99 }), G({ growthPct: 25 }));
    assert.ok(!r.inputs.some((i) => /analysts' next-year EPS/.test(i)));
  });
});

describe('5 · other wrong rows: share / mix / margin / visibility, past rates, parts of the company, GOV', () => {
  const issue = (q: string, lo: number, hi: number | null = null, metric = 'REVENUE') => growthQuoteIssue(q, lo, hi ?? lo, metric, { annual: true, numberCheck: false, rateCheck: true });
  test('a percentage that is a share, split, margin, visibility or a bare table cell is not growth', () => {
    assert.match(issue('Total revenue in the range of $870 million to $895 million, split ~84% service revenue and ~16% equipment revenue.', 84)!, /share, mix, margin/);
    assert.match(issue('More than 50% of the business has the potential to become recurring in nature.', 50)!, /share/);
    assert.match(issue('when you start the year, you start with about 80%, 85% visibility and you build the balance', 85, 90)!, /visibility/);
    assert.match(issue('Gross margin % | 32% - 35%', 32, 35)!, /margin/);
    assert.match(issue('69.0 | % | 70.5 | %', 69, 70.5)!, /not say the percentage is a growth rate/);
    assert.match(issue('Revenue from the derivatives and specialty segment to be ~ 70% by FY28E', 70)!, /not say the percentage is a growth rate/);
  });
  test('real guides stay (terse, tables that name the measure, "in terms of revenues", a margin elsewhere in the sentence)', () => {
    assert.equal(issue('delivering as per the guidance for the full year of approximately 30% in terms of revenues.', 30), null);
    assert.equal(issue('we remain confident of delivering more than 30% revenue in the current financial year \'27 along with the EBITDA margin of around 6%', 30), null);
    assert.equal(issue('Adjusted Diluted EPS | $8.26 | - | $8.41 | $ 7.54 | 9.5% | - | 11.5%', 9.5, 11.5, 'EPS'), null);
    assert.equal(issue('Projected revenue change | 0.4 | % | — | % | 2.4 | %', 0.4, 2.4), null);
    assert.equal(issue('2026 Guidance YoY Revenue $3.9B - $4.2B ~100%', 100), null);
    assert.equal(issue('We maintain that revenue guidance of 75% growth over the previous year', 75), null);
  });
  test('"would have been" describes a past year', () => {
    assert.match(issue('our overall growth excluding TMT would have been 37% year-over-year.', 37)!, /past period/);
  });
  test('gross order value is not revenue', () => {
    assert.match(issue('more than tripling consolidated Gross Order Value (GOV) to approximately ₹2.5 Lakh Cr. from ₹67,734 Cr. in FY26, implying a 30%+ GOV CAGR', 30)!, /GROSS ORDER VALUE/i);
  });
  test('a named business, segment or exports is one part of the company (kept for review)', () => {
    const sc = (q: string, company = 'Zed Ltd') => scopeIssueOf(q, { metric: 'REVENUE', market: 'IN', company });
    assert.match(sc('We also expect our ESAI business to grow by over 100% this year')!, /ESAI business/);
    assert.match(sc('So, as we said last year our IoT segment we\'ve grown at around 45% year on year.')!, /IoT segment/);
    assert.match(sc('Our Park business, I continue to probably see that we should be doubling every year')!, /Park business/);
    assert.match(sc('We are looking into having a growth of 40%, 45% in our exports for this financial year.')!, /exports/);
    assert.match(sc('Revenue from the derivatives and specialty segment to be ~ 70% by FY28E')!, /derivatives and specialty segment/);
  });
  test('the whole company is not a part (no new false positives)', () => {
    const sc = (q: string, company = 'Zed Ltd') => scopeIssueOf(q, { metric: 'REVENUE', market: 'IN', company });
    assert.equal(sc('With a continued strong growth momentum in the non-GPL portfolio and muted growth in the GPL business, we remain confident of achieving revenue growth of 10% - 12% in FY27'), null);
    assert.equal(sc('we expect 25% to 35% growth in this business year-on-year'), null);
    assert.equal(sc('we are looking to double our size and business in next 5 years.'), null);
    assert.equal(sc('So, that way, the amount of business that we are likely to get is quite a lot, and we expect 20% growth'), null);
    assert.equal(sc('our core business will grow 30% this year'), null);
    assert.equal(sc('our overall business will grow 30% this year'), null);
    assert.equal(namedPartOf('The Zed business will grow 30%', 'Zed Ltd'), null, "the company's own name");
  });
});

// ── helpers ──
const NOW = new Date('2026-10-07T09:00:00Z');
function pick(t: ReturnType<typeof totalToAnnual>) { return t ? { low: t.low, high: t.high, years: t.years, yearsMin: t.yearsMin, kind: t.kind } : null; }
function row(o: Partial<ExtractedGuidance>): ExtractedGuidance {
  return { metric: 'REVENUE_GROWTH', metricLabel: 'revenue growth', period: 'FY27', periodKind: 'ANNUAL', basis: 'UNSTATED', currency: null, unit: '%', low: null, high: null,
    growthPctLow: null, growthPctHigh: null, status: 'NEW', prior: null, priorActual: null, quote: '', speaker: null, confidence: 0.9, ...o } as ExtractedGuidance;
}
function xres(ticker: string, company: string, rows: ExtractedGuidance[], market: 'IN' | 'US' = 'IN'): GuidanceExtractResult {
  return { docId: createHash('sha1').update(ticker).digest('hex').slice(0, 20), market, ticker, company, docUrl: `https://www.bseindia.com/xml-data/corpfiling/AttachHis/${ticker.toLowerCase()}.pdf`,
    docKind: 'TRANSCRIPT', filedAt: '2026-08-13T00:00:00.000Z', extractedAt: '2026-10-05T00:00:00Z', model: 'test', status: 'ok', rows, dropped: 0 } as GuidanceExtractResult;
}
function F(o: Partial<FvFacts> = {}): FvFacts {
  return { market: 'IN', price: 100, mcap: 1000, salesBase: 500, opFy: 100, patFy: 50, borrowings: 100, salesGrowthFy: 25, salesCagr3y: 20, sector: null, industry: null, ...o };
}
function G(o: Record<string, unknown> = {}) { return { growthPct: 20, growthTrust: 'verified', growthType: 'EXPLICIT', growthMetric: 'REVENUE', growthCohort: 'ANNUAL', ...o }; }
