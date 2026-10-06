// zzz925 — fixes after the owner checked the live "Next Sky Gold" focus list. Made-up tickers except where a real statement is quoted;
// no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyFacts, type SkyFacts } from '../gu-skygold-facts';
import { skyGoldScore, guidanceOfRow, MUST_CAPS, bandOf, type SkyGuidance } from '../gu-skygold-score';
import { buildFocusList, sizeOf, derivedGrowthIssue, holdInconsistentGrowth, toFactsUnit, type FocusRow } from '../gu-focus';
import { growthScopeIssue } from '../guidance-prior-match';
import { derivedBaseDoubt, amountsIn } from '../guidance-universe';
import { nasdaqMarketCapMusd, pickScreenerSlug, normCompany } from '../gu-skygold-lookup';

const G = (o: Partial<SkyGuidance> = {}): SkyGuidance => ({ growthPct: 40, growthTrust: 'verified', growthType: 'EXPLICIT', growthMetric: 'REVENUE', growthMetrics: ['REVENUE'], multiYear: false, raised: false, smallRaise: false, cutInWindow: false, ...o });
const facts = (o: Partial<SkyFacts> = {}): SkyFacts => ({
  ...emptyFacts('IN', 'ALPHAX', 'test'), period: 'Jun 2026', salesYoyQ: 35, patYoyQ: 50, salesCagr3y: 30, profitCagr3y: 40, salesGrowthFy: 32, opGrowthFy: 45,
  opmNow: 18, opmYearAgo: 16, roce: 28, cfoToPat: 0.95, cfoYear: 'Mar 2026', lossMaking: false, cfo: 120, fcf: 40, debtToEquity: 0.2, debtGrowthX: 1.1,
  shareCountChange2y: 0, promoterNow: 62, promoterYearAgo: 62, debtorDaysNow: 60, debtorDaysPrev: 62, otherIncomePctOfPbt: 5, salesBase: 900, pe: 20, mcap: 2000, ...o,
});

test('caps: GOOD (65+) needs 5 of 7 main checks, STRONG (80+) needs 6 of 7', () => {
  assert.deepEqual({ ...MUST_CAPS }, { 7: 100, 6: 89, 5: 74, 4: 62, 3: 52, 2: 42, 1: 32, 0: 32 });
  for (let k = 0; k <= 4; k++) assert.ok(bandOf(MUST_CAPS[k]) !== 'GOOD' && bandOf(MUST_CAPS[k]) !== 'STRONG', `${k} met`);
  assert.equal(bandOf(MUST_CAPS[5]), 'GOOD'); assert.equal(bandOf(MUST_CAPS[6]), 'STRONG');
  // FLAIR-like: 4 of 7 met (sales 15.7%, reachable half, ROCE 17%) with every supporting check strong — was 68 GOOD, now held at 62
  const flair = skyGoldScore(G({ growthPct: 40 }), facts({ salesYoyQ: 10.4, patYoyQ: 0, salesCagr3y: 10, profitCagr3y: 6, salesGrowthFy: 15.7, opGrowthFy: 21.6, opmNow: 17, opmYearAgo: 17,
    roce: 17, cfoToPat: 0.97, fcf: -1, cfo: 137, debtToEquity: 0.06, debtGrowthX: 1.06, salesBase: 1250, pe: 17.2 }));
  assert.equal(flair.mustMet, 4); assert.ok(flair.score! <= 62, String(flair.score)); assert.equal(flair.band, 'MIXED'); assert.match(flair.capNote!, /4 of 7 main checks met — score held at 62/);
});

test('main check 1: a target the company stated is met; one worked out from its numbers is half at most', () => {
  const stated = skyGoldScore(G({ growthPct: 60 }), facts());
  assert.equal(stated.checks.find((c) => c.id === 'target')!.status, 'pass');
  const derived = skyGoldScore(G({ growthPct: 60, growthTrust: 'derived', growthType: 'DERIVED' }), facts());
  assert.equal(derived.checks.find((c) => c.id === 'target')!.status, 'partial');
  // even when the row's trust says verified, a DERIVED headline is not company-stated
  const mixed = skyGoldScore(G({ growthPct: 60, growthTrust: 'verified', growthType: 'DERIVED' }), facts());
  assert.equal(mixed.checks.find((c) => c.id === 'target')!.status, 'partial');
  assert.match(mixed.checks.find((c) => c.id === 'target')!.detail, /worked out from the company's numbers/);
  // a real raise of the company's own figures is met
  assert.equal(skyGoldScore(G({ growthPct: null, growthType: null, raised: true }), facts()).checks.find((c) => c.id === 'target')!.status, 'pass');
  assert.equal(guidanceOfRow({ growthPct: 50, growthTrust: 'derived', growthType: 'DERIVED', raised: null }).growthType, 'DERIVED');
});

test('a worked-out base far below the figure the same sentence prints is doubted (Pinnacle West)', () => {
  const pnw = '2025 Actual2 2026 Guidance2 Operating revenues1 $5.34 billion $5.56 - $5.66 billion';
  assert.deepEqual(amountsIn(pnw, '$B'), [5.34, 5.56, 5.66]);
  assert.match(derivedBaseDoubt(pnw, { previousValue: 1.94, currentLow: 5.56, unit: '$B', basePeriod: 'FY25' })!, /base looks like a part of the year/);
  assert.equal(derivedBaseDoubt('In FY27, revenue could be 600 crores.', { previousValue: 243.35, currentLow: 600, unit: '₹ Cr', basePeriod: 'FY26' }), null);
  assert.equal(derivedBaseDoubt('grow from ₹243 Cr in FY26 to ₹600 Cr in FY27', { previousValue: 243, currentLow: 600, unit: '₹ Cr', basePeriod: 'FY26' }), null);
  assert.deepEqual(amountsIn('revenue of $1,250 million and $2.1 billion', '$M'), [1250, 2100]);
  // the earlier GUIDANCE after "from" is not a reported year (a raise "to ₹725–750 Cr from ₹600 Cr" against a ₹357.71 Cr FY26 actual is fine)
  assert.equal(derivedBaseDoubt('management raised FY27 revenue guidance to ₹725-750 Cr from ₹600 Cr, with ₹1,500 Cr targeted by FY29.', { previousValue: 357.71, currentLow: 725, unit: '₹ Cr', basePeriod: 'FY26' }), null);
  assert.equal(derivedBaseDoubt('raised to $5.6B from $5.2B', { previousValue: 2, currentLow: 5.6, unit: '$B', basePeriod: 'FY25' }), null);
});

test('scope: a revenue mix, a table margin and a segment named in front are not company growth; real company statements pass', () => {
  assert.match(growthScopeIssue('Total revenue in the range of $870 million to $895 million, split ~84% service revenue and ~16% equipment revenue.', 'REVENUE', 'Gogo Inc.')!, /mix/);
  assert.match(growthScopeIssue('69.0 | % | 70.5 | %', 'REVENUE', 'Kodiak Gas Services, Inc.')!, /table figure/);
  assert.match(growthScopeIssue('Gross margin % | 32% - 35%', 'REVENUE', 'Emergent BioSolutions Inc.')!, /margin/);
  assert.match(growthScopeIssue('Data Centers +60% to +80%', 'REVENUE', 'MODINE MANUFACTURING CO')!, /one part of the company \(Data Centers\)/);
  for (const [q, co] of [
    ['For the fiscal year ending June 25, 2027, Aehr expects total company revenue to be between $130 million and $150 million, representing approximately 160%-200% year-over-year growth.', 'AEHR TEST SYSTEMS'],
    ['Full-year FY27 revenue guidance of $192.0 billion, up 69% year over year', 'Dell Technologies Inc.'],
    ['2026 Guidance YoY Revenue $3.9B - $4.2B ~100%1', 'Bloom Energy Corp'],
    ['Revenue growth expected to exceed 90%', 'MAMMOTH ENERGY SERVICES, INC.'],
    ['In FY27, revenue could be 600 crores.', 'Univastu India Limited'],
    ['Revenue +40% for FY27 with EBITDA margin of 18%', 'Alphaq Ltd'],
    ['Bloom Energy 100% revenue growth in 2026', 'Bloom Energy Corp'],
  ] as const) assert.equal(growthScopeIssue(q, 'REVENUE', co), null, q);
});

const row = (o: Partial<FocusRow>): FocusRow => ({ key: 'US|PNWQ', company: 'Pinwest Q', ticker: 'PNWQ', market: 'US', raised: null, raisePct: null, raiseDate: null, eventId: null,
  growth: 'Revenue +187–192% (derived)', growthPct: 189.2, growthPeriod: 'FY26', growthTrust: 'derived', growthType: 'DERIVED', growthMetric: 'REVENUE', verdict: 'HIGH GROWTH', why: '', score: 0, size: null, capText: null,
  growthDerivation: { previousValue: 1.94, currentLow: 5.56, currentHigh: 5.66, unit: '$B', basePeriod: 'FY25' }, ...o });

test('a worked-out revenue growth that disagrees with reported revenue is held back (base far below the reported year)', () => {
  assert.equal(toFactsUnit(1.94, '$B', 'US'), 1940); assert.equal(toFactsUnit(243, '₹ Cr', 'IN'), 243); assert.equal(toFactsUnit(5, '$B', 'IN'), null);
  assert.match(derivedGrowthIssue(row({}), 5823)!, /base looks like a part of the year/);
  // Univastu-like: ₹600 Cr vs ₹243.35 Cr, reported yearly revenue ₹243 Cr — consistent
  const uni = row({ key: 'IN|UNIQ', market: 'IN', growthPct: 146.6, growthDerivation: { previousValue: 243.35, currentLow: 600, currentHigh: 600, unit: '₹ Cr', basePeriod: 'FY26' } });
  assert.equal(derivedGrowthIssue(uni, 243), null);
  // a stated growth is never touched; no reported revenue = not checkable
  assert.equal(derivedGrowthIssue(row({ growthType: 'EXPLICIT', growthTrust: 'verified' }), 5823), null);
  assert.equal(derivedGrowthIssue(row({}), null), null);
  const raised = row({ key: 'US|RAISEQ', raised: 'FY26 revenue: $5–5.2B → $5.5–5.66B (+9%)', raisePct: 9, verdict: 'TOP FOCUS' });
  const { rows, held } = holdInconsistentGrowth([row({}), uni, raised], (r) => (r.market === 'IN' ? 243 : 5823));
  assert.deepEqual(held.map((h) => h.key), ['US|PNWQ', 'US|RAISEQ']);
  assert.deepEqual(rows.map((r) => r.key), ['IN|UNIQ', 'US|RAISEQ']);
  const kept = rows.find((r) => r.key === 'US|RAISEQ')!;
  assert.equal(kept.growth, null); assert.equal(kept.verdict, 'RAISED');
});

test('focus rows carry the growth type and the derivation amounts of the headline', () => {
  const g = { threshold: 30, label: '', rule: '', trust: {} as any, counts: {} as any, cohorts: { QUARTERLY: [], MULTI_YEAR_CAGR: [], ANNUAL: [
    { id: 'a', entityKey: 'US:PNWQ', company: 'Pinwest Q', ticker: 'PNWQ', market: 'US', cohort: 'ANNUAL', trust: 'derived', text: 'Revenue +187–192% (derived)', sourceName: 's', sourceDate: null, sourceUrl: null,
      headline: { metric: 'REVENUE', compareValue: 189.2, period: 'FY26', growthType: 'DERIVED', derivation: { previousValue: 1.94, currentLow: 5.56, currentHigh: 5.66, unit: '$B', basePeriod: 'FY25' } }, metrics: [{ metric: 'REVENUE' }] }] } } as any;
  const [r] = buildFocusList(g, [], new Date('2026-10-05T00:00:00Z'), Infinity);
  assert.equal(r.growthType, 'DERIVED'); assert.equal(r.growthDerivation!.previousValue, 1.94);
  assert.equal(guidanceOfRow(r).growthType, 'DERIVED');
});

test('US size from the Nasdaq market cap: $30B and over is large', () => {
  assert.equal(nasdaqMarketCapMusd({ data: { summaryData: { MarketCap: { label: 'Market Cap', value: '363,913,785,590' } } } }), 363913.8);
  assert.equal(nasdaqMarketCapMusd({ data: { summaryData: { MarketCap: { value: 'N/A' } } } }), null);
  assert.equal(nasdaqMarketCapMusd(null), null);
  assert.deepEqual(sizeOf('US', 'DELLQ', { caps: { US: { DELLQ: 363913.8 } } }), { size: 'LARGE', capText: '$363.9B' });
  assert.deepEqual(sizeOf('US', 'SMALLQ', { caps: { US: { SMALLQ: 1564 } } }), { size: 'SMALL_MID', capText: '$1.6B' });
});

test('screener.in page of a BSE-only company: found by its name, never by "the first result"', () => {
  const list = [{ name: 'BMW Ventures Ltd', url: '/company/BMWVENTLTD/' }, { name: 'BMW Industries Ltd', url: '/company/542669/consolidated/' }];
  assert.equal(normCompany('BMW Industries Limited'), 'bmw industries');
  assert.equal(pickScreenerSlug(list, 'BMW', 'BMW Industries Ltd'), '542669');
  assert.equal(pickScreenerSlug(list, 'BMW', null), null, 'symbol alone: no exact match, no guess');
  assert.equal(pickScreenerSlug([{ name: 'Univastu India Ltd', url: '/company/UNIVASTU/consolidated/' }], 'UNIVASTU', null), 'UNIVASTU');
  assert.equal(pickScreenerSlug(list, 'BMW', 'Some Other Co'), null);
});

test('route and UI: caps returned and used, names sent, held-back note, legend says 5 of 7 for GOOD, no banned words', () => {
  const route = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'guidance-upgrades', 'skygold', 'route.ts'), 'utf8');
  const ui = readFileSync(join(__dirname, '..', '..', 'components', 'guidance-upgrades', 'GuFocusList.tsx'), 'utf8');
  const cell = readFileSync(join(__dirname, '..', '..', 'components', 'guidance-upgrades', 'GuSkyGold.tsx'), 'utf8');
  assert.match(route, /api\.nasdaq\.com\/api\/quote\/\$\{encodeURIComponent\(t\)\}\/summary/); assert.match(route, /caps, errors, pending/); assert.match(route, /sp\.getAll\('n'\)/);
  assert.match(cell, /&n=\$\{encodeURIComponent/); assert.match(cell, /setCaps/);
  assert.match(ui, /skyCaps\.US/); assert.match(ui, /holdInconsistentGrowth/); assert.match(ui, /Held back for review/);
  assert.match(ui, /65\+ \(GOOD\) needs 5 of 7/);
  for (const src of [ui, cell]) { assert.ok(!/\bbest\b|top stocks|\bBUY\b|\bSELL\b|\/100/i.test(src)); }
});
