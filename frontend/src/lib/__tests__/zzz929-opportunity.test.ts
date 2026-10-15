// zzz929 — the Opportunity score, implied EPS, raise quality, growth still needed, duration and street view on the Guidance Upgrades focus list.
// Made-up companies and figures only; no network, no AI.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { emptyFacts, usFactsFromRow, inFactsFromHtml, type SkyFacts } from '../gu-skygold-facts';
import { impliedEps, incrementalOf, qualityOf, requiredRemaining, durationOf, streetView, opportunityScore, parseFy, oppBandOf, MIN_COVERAGE, type OppRow } from '../gu-opportunity';
import { statedGrowth, fairValue } from '../gu-fair-value';
import { buildFocusList } from '../gu-focus';

const R = (o: Partial<OppRow> = {}): OppRow => ({
  market: 'IN', growthPct: 40, growthTrust: 'verified', growthType: 'EXPLICIT', growthMetric: 'REVENUE', growthMetrics: ['REVENUE'], growthCohort: 'ANNUAL', growthPeriod: 'FY27',
  raised: null, smallRaise: false, raiseDetail: null, cutDate: null, ...o,
});
const F = (o: Partial<SkyFacts> = {}): SkyFacts => ({
  ...emptyFacts('IN', 'ALPHAQ', 'test'), period: 'Sep 2026', salesYoyQ: 30, patYoyQ: 45, salesGrowthFy: 28, opGrowthFy: 40, opmNow: 18, opmYearAgo: 16, cfoToPat: 0.9, fcf: 10,
  salesBase: 1000, patFy: 100, otherIncomePctOfPbt: 5, shareCountChange2y: 0, ...o,
});
const fvOk = (up: number, checks: string[] = []): any => ({ ok: true, reason: null, currency: '₹', price: 100, base: { fair: 100 * (1 + up / 100), upsidePct: up }, bear: null, bull: null, checks, methods: [], sectorLabel: '', sectorKnown: true, basis: 'guided', growth: null, inputs: [] });

// India FY26 = Apr 2025–Mar 2026: sales 200 + 240 + 260 + 300 = 1000. FY27 so far: Jun 2026 260, Sep 2026 300.
const QUARTERS = { labels: ['Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026', 'Sep 2026'], sales: [200, 240, 260, 300, 260, 300], op: [40, 48, 52, 60, 52, 60], pat: [20, 24, 26, 30, 26, 30] };
const YEARS = { labels: ['Mar 2025', 'Mar 2026'], sales: [800, 1000], op: [160, 200], pat: [80, 100] };

describe('period words', () => {
  test('parseFy', () => {
    assert.deepEqual(parseFy('FY27'), { endYear: 2027, span: 1, part: false });
    assert.deepEqual(parseFy('FY2026'), { endYear: 2026, span: 1, part: false });
    assert.deepEqual(parseFy('FY27-FY29'), { endYear: 2029, span: 2, part: false });
    assert.deepEqual(parseFy('FY2026-27'), { endYear: 2027, span: 1, part: false });
    assert.equal(parseFy('Q2 FY27').part, true);
    assert.equal(parseFy(null).endYear, null);
  });
});

describe('1 · implied EPS growth', () => {
  test('profit guided: the guided rate is the implied EPS growth', () => {
    const e = impliedEps(R({ growthMetric: 'PAT', growthPct: 35 }), F());
    assert.equal(e.pct, 35); assert.equal(e.approx, false); assert.match(e.basis, /net profit growth of 35%/);
  });
  test('EBITDA guided is carried to profit and marked rough', () => {
    const e = impliedEps(R({ growthMetric: 'EBITDA', growthPct: 50 }), F());
    assert.equal(e.pct, 50); assert.equal(e.approx, true);
  });
  test('sales guided: at today\'s net margin (profit 100 on sales 1000 = 10%), marked rough; the margin is named', () => {
    const e = impliedEps(R(), F());
    assert.equal(e.pct, 40); assert.equal(e.approx, true); assert.match(e.basis, /net margin of 10%/);
  });
  test('sales guided but margin not known or loss-making: no number, and the reason', () => {
    assert.equal(impliedEps(R(), null).pct, null);
    const loss = impliedEps(R(), F({ patFy: -5 }));
    assert.equal(loss.pct, null); assert.match(loss.reason!, /loss-making/);
    assert.equal(impliedEps(R(), F({ patFy: null })).pct, null);
  });
  test('growth above 100% is capped exactly as the fair value caps it (same function)', () => {
    assert.equal(statedGrowth({ growthPct: 180, growthTrust: 'verified', growthMetric: 'PAT' })!.base, 100);
    assert.equal(impliedEps(R({ growthMetric: 'PAT', growthPct: 180 }), F()).pct, 100);
  });
  test('an unverified growth is not used; a margin-only raise gives no EPS figure', () => {
    assert.equal(impliedEps(R({ growthTrust: 'claim' }), F()).pct, null);
    const m = impliedEps(R({ growthPct: null, growthTrust: null, raised: 'x', raiseDetail: { metric: 'OP_MARGIN', period: 'FY27', beforeMid: 14, afterMid: 16, isGrowthRate: true, unit: '%', currency: null, periodKind: null, periodYears: null } }), F());
    assert.equal(m.pct, null); assert.match(m.incremental!.text, /margin guided 14% → 16% \(\+2 points\)/);
  });
  test('old → new: an absolute profit raise, a growth-rate raise, a sales raise, and a small-base EPS', () => {
    const d = (o: any) => ({ metric: 'PAT', period: 'FY27', beforeMid: 100, afterMid: 125, isGrowthRate: false, unit: 'Cr', currency: '₹', periodKind: null, periodYears: null, ...o });
    assert.equal(incrementalOf(R({ raised: 'x', raiseDetail: d({}) }))!.changePct, 25);
    const g = incrementalOf(R({ raised: 'x', raiseDetail: d({ metric: 'REVENUE', beforeMid: 25, afterMid: 35, isGrowthRate: true }) }))!;
    assert.equal(g.oldPct, 25); assert.equal(g.newPct, 35); assert.equal(g.changePct, 10);
    assert.match(incrementalOf(R({ raised: 'x', raiseDetail: d({ metric: 'REVENUE' }) }))!.text, /at a steady margin, profit rises by about the same/);
    const small = incrementalOf(R({ raised: 'x', smallRaise: true, raiseDetail: d({ metric: 'EPS', beforeMid: 0.3, afterMid: 0.5 }) }))!;
    assert.equal(small.changePct, null); assert.match(small.text, /small base/);
    assert.equal(incrementalOf(R({ raised: null, raiseDetail: d({}) })), null);
  });
  test('a raise-only row with a raised growth rate still gets the new rate as the implied growth', () => {
    const e = impliedEps(R({ growthPct: null, growthTrust: null, growthMetric: null, raised: 'x', raiseDetail: { metric: 'PAT', period: 'FY27', beforeMid: 20, afterMid: 30, isGrowthRate: true, unit: '%', currency: null, periodKind: null, periodYears: null } }), F());
    assert.equal(e.pct, 30);
  });
});

describe('2 · raise quality tier', () => {
  test('tier 1 — sales up, margin steady or up, profit up, cash following', () => { const q = qualityOf(R(), F()); assert.equal(q.tier, 1); assert.equal(q.label, 'Broad improvement'); });
  test('tier 2 — profit growing faster than sales, but cash is not confirmed', () => {
    const q = qualityOf(R(), F({ cfoToPat: 0.3, fcf: -5 }));
    assert.equal(q.tier, 2); assert.equal(q.label, 'Operating leverage');
  });
  test('tier 3 — revenue up, profit lags or margin falls', () => {
    const q = qualityOf(R(), F({ patYoyQ: 5, opmNow: 14, opmYearAgo: 16 }));
    assert.equal(q.tier, 3); assert.equal(q.label, 'Revenue only');
  });
  test('tier 4 — other income, new shares, a cut, or profit not from operations', () => {
    assert.equal(qualityOf(R(), F({ otherIncomePctOfPbt: 45 })).tier, 4);
    assert.equal(qualityOf(R(), F({ shareCountChange2y: 30 })).tier, 4);
    assert.equal(qualityOf(R({ cutDate: '2026-10-01' }), F()).tier, 4);
    const ops = qualityOf(R(), F({ patYoyQ: 60, opmNow: 12, opmYearAgo: 17 }));
    assert.equal(ops.tier, 4); assert.match(ops.detail, /not coming from operations/);
  });
  test('no company figures: not rated, never a tier', () => {
    assert.equal(qualityOf(R(), null).tier, null);
    assert.equal(qualityOf(R(), F({ salesYoyQ: null, salesGrowthFy: null, patYoyQ: null, opGrowthFy: null, opmNow: null, opmYearAgo: null, cfoToPat: null, fcf: null })).tier, null);
  });
});

describe('3 · growth still needed in the rest of the year (India)', () => {
  const facts = F({ quarters: QUARTERS, years: YEARS });
  test('worked example: FY27 sales +40% on 1000 = 1400; 560 done against 440 a year ago → needs +50% in the last 2 quarters; pace so far +27.3%; far above the pace', () => {
    const q = requiredRemaining(R(), facts);
    assert.equal(q.computed, true); assert.equal(q.needPct, 50); assert.equal(q.pacePct, 27.3); assert.equal(q.quartersDone, 2); assert.equal(q.far, true);
    assert.match(q.text, /Needs \+50% in the remaining 2 quarters/); assert.match(q.text, /far above the current pace/);
  });
  test('a modest ask is not flagged: +25% guided needs about +22% (pace +27%)', () => {
    const q = requiredRemaining(R({ growthPct: 25 }), facts);
    assert.equal(q.computed, true); assert.equal(q.far, false); assert.ok(q.needPct! < q.pacePct!);
  });
  test('profit guided uses the net profit quarters', () => {
    const q = requiredRemaining(R({ growthMetric: 'PAT', growthPct: 40 }), facts);
    assert.equal(q.needPct, 50);   // same shape: 56 so far vs 44; target 140; (140-56)/(100-44)-1
  });
  test('not shown: next year (no quarter yet), finished year, multi-year, USA, missing tables', () => {
    assert.match(requiredRemaining(R({ growthPeriod: 'FY28' }), facts).reason!, /no quarter of FY28/);
    assert.match(requiredRemaining(R({ growthPeriod: 'FY26' }), facts).reason!, /FY26|four quarters|no quarter/);
    assert.match(requiredRemaining(R({ growthCohort: 'MULTI_YEAR_CAGR' }), facts).reason!, /multi-year/);
    assert.match(requiredRemaining(R({ market: 'US' }), { ...facts, market: 'US' }).reason!, /USA/);
    assert.match(requiredRemaining(R(), F()).reason!, /quarterly figures not read/);
    assert.match(requiredRemaining(R({ growthPeriod: 'Q2 FY27' }), facts).reason!, /one full fiscal year/);
    assert.equal(requiredRemaining(R(), null).computed, false);
  });
  test('quarters of the guided year must follow from Q1 and the same quarters a year before must exist', () => {
    const gap = { ...QUARTERS, sales: [200, null, 260, 300, 260, 300] };
    assert.equal(requiredRemaining(R(), F({ quarters: gap, years: YEARS })).computed, false);
  });
});

describe('4 · duration', () => {
  test('one year / two years / three or more / multi-year without a stated length / part of a year', () => {
    assert.equal(durationOf(R()).cls, 'short');
    assert.equal(durationOf(R({ growthCohort: 'MULTI_YEAR_CAGR', growthPeriod: 'FY27-FY29' })).cls, 'medium');
    assert.equal(durationOf(R({ growthCohort: 'MULTI_YEAR_CAGR', growthPeriod: 'FY26-FY29' })).cls, 'long');
    assert.equal(durationOf(R({ growthCohort: 'MULTI_YEAR_CAGR', growthPeriod: 'over 3-5 years' })).cls, 'long');
    const nr = durationOf(R({ growthCohort: 'MULTI_YEAR_CAGR', growthPeriod: 'next few years' }));
    assert.equal(nr.cls, 'medium'); assert.match(nr.label, /not stated/);
    assert.equal(durationOf(R({ growthPeriod: 'Q2 FY27' })).cls, 'short');
    assert.equal(durationOf(R({ growthPeriod: null })).known, false);
    assert.equal(durationOf(R({ growthCohort: 'MULTI_YEAR_CAGR', growthPeriod: 'FY26-FY29', raiseDetail: { metric: 'REVENUE', period: 'FY29', beforeMid: 1, afterMid: 2, isGrowthRate: false, unit: null, currency: null, periodKind: 'MULTI_YEAR_CAGR', periodYears: 5 } })).years, 5);
  });
});

describe('5 · guidance against the street (USA only)', () => {
  const us = (o: Partial<SkyFacts> = {}) => F({ market: 'US', ticker: 'OMEGAQ', streetEpsGrowthPct: 20, streetEpsEndYear: 2027, ...o });
  const row = R({ market: 'US', growthMetric: 'PAT', growthPct: 35 });
  test('above / in line / below with a 5-point band', () => {
    const e = (p: number) => impliedEps(R({ market: 'US', growthMetric: 'PAT', growthPct: p }), us());
    assert.equal(streetView(row, e(35), us()).verdict, 'above');
    assert.equal(streetView(row, e(23), us()).verdict, 'in line');
    assert.equal(streetView(row, e(12), us()).verdict, 'below');
    assert.equal(streetView(row, e(35), us()).diffPts, 15);
  });
  test('India shows nothing; a year mismatch or missing estimate is not compared', () => {
    assert.match(streetView(R(), impliedEps(R(), F()), F()).reason!, /India/);
    assert.equal(streetView(R({ market: 'US', growthPeriod: 'FY26' }), impliedEps(row, us()), us()).available, false);
    assert.equal(streetView(row, impliedEps(row, us()), us({ streetEpsGrowthPct: null })).available, false);
    assert.equal(streetView(row, impliedEps(row, us()), null).available, false);
  });
  test('the street growth is read from the Yahoo trend: next year ÷ current year', () => {
    const f = usFactsFromRow('OMEGAQ', { source: 'sec-xbrl', fiscal_label: 'Q2 FY26' }, [{ period: '0y', current: 2, d90: 1.9, end_date: '2026-12-31' }, { period: '+1y', current: 2.5, d90: 2.2, end_date: '2027-12-31' }] as any)!;
    assert.equal(f.streetEpsGrowthPct, 25); assert.equal(f.streetEpsEndYear, 2027);
    assert.equal(usFactsFromRow('OMEGAQ', { source: 'sec-xbrl' }, [{ period: '0y', current: -1, d90: 0 }, { period: '+1y', current: 1, d90: 0 }] as any)!.streetEpsGrowthPct, null);
    assert.equal(usFactsFromRow('OMEGAQ', { source: 'sec-xbrl' }, null)!.streetEpsGrowthPct, null);
  });
});

describe('6 · opportunity score', () => {
  const strongUs = () => opportunityScore(
    R({ market: 'US', growthMetric: 'PAT', growthPct: 60, growthCohort: 'MULTI_YEAR_CAGR', growthPeriod: 'FY27-FY30' }),
    F({ market: 'US', ticker: 'OMEGAQ', salesYoyQ: 55, patYoyQ: 65, streetEpsGrowthPct: 20, streetEpsEndYear: 2030 }), fvOk(60));
  test('every part known and strong gives the top band', () => {
    const o = strongUs();
    assert.equal(o.coverage, 1); assert.equal(o.band, 'HIGH'); assert.ok(o.score! >= 90, String(o.score));
    assert.deepEqual(o.parts.map((p) => p.id), ['eps', 'quality', 'feasibility', 'valuation', 'duration', 'street']);
    assert.ok(o.parts.every((p) => p.status === 'known'));
  });
  test('missing parts never count as good: no figures at all gives no score', () => {
    const o = opportunityScore(R(), null, null);
    assert.equal(o.score, null); assert.equal(o.band, null); assert.match(o.capNote!, /parts have data/);
  });
  test('a profit-guided name with unknown company figures and no fair value is held down, not high', () => {
    const o = opportunityScore(R({ growthMetric: 'PAT', growthPct: 80 }), null, null);
    assert.ok(o.coverage < MIN_COVERAGE || (o.score ?? 0) < 75);
  });
  test('coverage caps: parts missing hold the score down', () => {
    const o = opportunityScore(R({ growthMetric: 'PAT', growthPct: 60, growthCohort: 'MULTI_YEAR_CAGR', growthPeriod: 'FY26-FY30' }), F({ quarters: null, years: null }), null);   // India, no fair value
    assert.ok(o.coverage < 1); assert.ok(o.score! <= 89); assert.match(o.capNote!, /parts known/);
  });
  test('a fair value marked "check" is not counted', () => {
    const flagged = opportunityScore(R({ market: 'US', growthMetric: 'PAT', growthPct: 60 }), F({ market: 'US', streetEpsGrowthPct: 20, streetEpsEndYear: 2027 }), fvOk(200, ['upside above +150%']));
    const v = flagged.parts.find((p) => p.id === 'valuation')!;
    assert.equal(v.status, 'unknown'); assert.equal(v.points, 0); assert.match(v.detail, /check/);
    assert.equal(opportunityScore(R(), F(), { ...fvOk(0), ok: false, base: null, reason: 'share price not available' }).parts.find((p) => p.id === 'valuation')!.status, 'unknown');
  });
  test('valuation points stop growing at +50% upside', () => {
    const v = (u: number) => opportunityScore(R(), F(), fvOk(u)).parts.find((p) => p.id === 'valuation')!.points;
    assert.equal(v(50), v(240)); assert.ok(v(10) < v(30)); assert.equal(v(-20), 0);
  });
  test('a low-quality raise is held at 59 or below, whatever else is strong', () => {
    const o = opportunityScore(R({ market: 'US', growthMetric: 'PAT', growthPct: 60, growthCohort: 'MULTI_YEAR_CAGR', growthPeriod: 'FY27-FY30' }),
      F({ market: 'US', salesYoyQ: 55, patYoyQ: 65, otherIncomePctOfPbt: 50, streetEpsGrowthPct: 20, streetEpsEndYear: 2030 }), fvOk(60));
    assert.equal(o.quality.tier, 4); assert.ok(o.score! <= 59); assert.match(o.capNote!, /low-quality/);
  });
  test('a top band needs implied EPS growth of 20%+ and three strong parts', () => {
    const o = opportunityScore(R({ market: 'US', growthMetric: 'PAT', growthPct: 12, growthCohort: 'MULTI_YEAR_CAGR', growthPeriod: 'FY27-FY30' }),
      F({ market: 'US', streetEpsGrowthPct: 5, streetEpsEndYear: 2030, salesYoyQ: 12, patYoyQ: 14, salesGrowthFy: 11 }), fvOk(60));
    assert.ok(o.score! < 75, String(o.score));
  });
  test('India: the street part is left out of the maximum, not scored', () => {
    const o = opportunityScore(R({ growthMetric: 'PAT', growthPct: 60 }), F({ quarters: QUARTERS, years: YEARS }), fvOk(60));
    const s = o.parts.find((p) => p.id === 'street')!;
    assert.equal(s.status, 'na'); assert.equal(s.max, 0);
    assert.match(o.summary, /no street data for India/);
  });
  test('the required-growth reading drives feasibility: far above the pace earns little', () => {
    const facts = F({ quarters: QUARTERS, years: YEARS });
    const far = opportunityScore(R(), facts, fvOk(30)).parts.find((p) => p.id === 'feasibility')!;
    const ok = opportunityScore(R({ growthPct: 25 }), facts, fvOk(30)).parts.find((p) => p.id === 'feasibility')!;
    assert.ok(far.points < ok.points); assert.match(far.detail, /far above the current pace/);
  });
  test('bands', () => { assert.equal(oppBandOf(75), 'HIGH'); assert.equal(oppBandOf(74), 'GOOD'); assert.equal(oppBandOf(60), 'GOOD'); assert.equal(oppBandOf(59), 'MIXED'); assert.equal(oppBandOf(39), 'LOW'); });
  test('works end to end on the real fair-value result and is independent of the Sky Gold score', () => {
    const facts = F({ price: 100, mcap: 1000, opFy: 200, borrowings: 100, salesGrowthFy: 25, salesCagr3y: 20, quarters: QUARTERS, years: YEARS });
    const fv = fairValue(facts, R(), 'Alphaq Ltd');
    const o = opportunityScore(R(), facts, fv);
    assert.ok(o.parts.length === 6); assert.ok(typeof o.score === 'number');
  });
});

describe('facts and wiring', () => {
  test('India quarters and years are read from the screener.in page (fixture)', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'screener-company-kmew.html'), 'utf8');
    const f = inFactsFromHtml('ZETAQ', html, 'consolidated', 'https://www.screener.in/company/ZETAQ/consolidated/')!;
    assert.ok(f.quarters && f.quarters.labels.length >= 4, 'quarters read');
    assert.equal(f.quarters!.labels.length, f.quarters!.sales.length);
    assert.equal(f.quarters!.labels[f.quarters!.labels.length - 1], 'Jun 2026');
    assert.ok(f.years && f.years.labels.includes('Mar 2026'));
    assert.equal(f.years!.sales[f.years!.labels.indexOf('Mar 2026')], f.salesBase);
  });
  test('focus rows carry the old → new figures of the headline raise', () => {
    const ev = { guidance_event_id: 'e1', ticker: 'GAMMAQ', company: 'Gammaq Ltd', market: 'IN', announcement_date: '2026-10-01', verification: 'VERIFIED', taxonomy: 'formal_upgrade',
      changes: [{ metric: 'REVENUE', direction: 'UP', percentageChange: 20, percentagePointChange: null,
        before: { metric: 'REVENUE', period: 'FY27', low: 100, high: 100, midpoint: 100, isGrowthRate: false, currency: '₹', unit: 'Cr' },
        after: { metric: 'REVENUE', period: 'FY27', low: 120, high: 120, midpoint: 120, isGrowthRate: false, currency: '₹', unit: 'Cr' } }] } as any;
    const rows = buildFocusList(null, [ev], new Date('2026-10-05T00:00:00Z'), 10);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].raiseDetail?.metric, rows[0].raiseDetail?.beforeMid, rows[0].raiseDetail?.afterMid, rows[0].raiseDetail?.period], ['REVENUE', 100, 120, 'FY27']);
  });
  const SRC = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
  test('the page has the Opportunity sort and both new columns in both tables, default order unchanged', () => {
    const s = read('components/guidance-upgrades/GuFocusList.tsx');
    assert.equal((s.match(/<OppHead /g) || []).length, 2);
    assert.equal((s.match(/'EPS estimate \(fixed shares\)'/g) || []).length, 2);
    assert.equal((s.match(/\{oppCell\(r\)\}/g) || []).length, 1); assert.equal((s.match(/\{figuresCells\(r\)\}/g) || []).length, 2);   // zzz1047f: both tables go through figuresCells
    assert.match(s, /useState<SortBy>\('rank'\)|useState<SortBy>\('rank'\)/);
    assert.match(s, /byOpp\(raisedAll, opps\)/); assert.match(s, /byOpp\(growthAll, opps\)/);
  });
  test('no price or market cap read inside lib/thesis; the new lib is outside it and uses no AI or network', () => {
    const lib = read('lib/gu-opportunity.ts').replace(/\/\/.*$/gm, '');
    assert.ok(!/anthropic|openai|haiku|fetch\(|process\.env/i.test(lib));
    for (const f of readdirSync(join(SRC, 'lib', 'thesis'))) if (f.endsWith('.ts')) assert.ok(!/gu-opportunity|gu-fair-value/.test(readFileSync(join(SRC, 'lib', 'thesis', f), 'utf8')), f);
  });
  test('wording: no best, top stocks, BUY/SELL, /100 in the UI files', () => {
    const dir = join(SRC, 'components', 'guidance-upgrades');
    for (const f of readdirSync(dir)) {
      const t = readFileSync(join(dir, f), 'utf8');
      assert.ok(!/\bbest\b/i.test(t), f); assert.ok(!/top stocks?/i.test(t), f);
      for (const m of t.matchAll(/\b(BUY|SELL)\b/g)) assert.equal(t.slice(m.index! - 10, m.index! + 3), 'IMMEDIATE BUY', f);
      assert.ok(!/\/\s?100\b/.test(t), f);
    }
    assert.ok(!/\bbest\b/i.test(read('lib/gu-opportunity.ts')));
  });
});
