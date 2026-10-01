// zzz849 — Guidance Universe: high-growth rule, implied provenance, period expiry, plausibility, dedupe, summary shape. Synthetic tickers only (ZZ...).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSeedRows, buildUniverse, summarize, buildRegression, displayOf, periodStatusOf, selectHighGrowth, type GuSeedRow } from '../guidance-universe';

const RAW = JSON.parse(readFileSync(join(process.cwd(), 'src/data/growth-guidance-seed.json'), 'utf8'));
const NOW = new Date('2026-10-01T09:00:00Z');
const mk = (o: Partial<GuSeedRow> = {}): GuSeedRow => ({
  company: 'ZZ Alpha Ltd', ticker: 'ZZALPHA', market: 'IN', metric: 'REVENUE', growthLow: 40, growthHigh: 40, growthOrigin: 'STATED', absoluteTarget: null, period: 'FY27', periodKind: 'FY', kind: 'MANAGEMENT_GUIDANCE', organic: 'ORGANIC',
  statement: 'Management guides revenue growth of 40% for the year.', driver: null, mechanisms: [], sourceName: 'Q4 call', sourceType: 'Concall', sourceUrl: 'https://example.com/a', sourceDate: '2026-05-10', sourceRank: 7, verification: 'VERIFIED',
  priorGuidance: [], supersededBy: null, notes: '', ownerListText: null, ...o,
});
const co = (n: string, o: Partial<GuSeedRow> = {}) => mk({ company: `ZZ ${n} Ltd`, ticker: `ZZ${n.toUpperCase().replace(/[^A-Z]/g, '')}`, ...o });
const build = (rows: GuSeedRow[], now = NOW) => { const b = buildUniverse([], [], rows, now); return { b, s: summarize(b.records, now, 30, b.inactive) }; };

describe('A. high-growth rule', () => {
  const rows = [
    co('Pass', { growthLow: 40, growthHigh: 40 }),
    co('Amount', { growthLow: null, growthHigh: null, absoluteTarget: { value: 1500, unit: '₹ Cr' }, statement: 'Targets revenue of Rs 1,500 crore.' }),
    co('Narrow', { growthLow: 26, growthHigh: 30, statement: 'Revenue growth of 26-30% expected.' }),
    co('Midpoint', { growthLow: 26, growthHigh: 34, statement: 'Revenue growth of 26-34% expected.' }),
    co('OpenHi', { growthLow: 80, growthHigh: null, statement: 'Revenue growth of 80%+ expected.' }),
    co('OpenLo', { growthLow: 29, growthHigh: null, statement: 'Revenue growth of 29%+ expected.' }),
    co('Presales', { growthLow: 30, growthHigh: 30, statement: 'Targets at least 30% growth in presales (bookings).' }),
    co('Cagr', { growthLow: 30, growthHigh: 35, period: 'FY27-29', periodKind: 'MULTI_YEAR_CAGR', statement: 'Revenue CAGR of 30-35% over three years.' }),
    co('Quarter', { growthLow: 60, growthHigh: 60, period: 'Q2 FY27', periodKind: 'QUARTER', statement: 'Revenue growth of 60% in Q2.' }),
    co('Media', { growthLow: 55, growthHigh: 55, verification: 'SECONDARY_ONLY', sourceRank: 10, sourceType: 'Media', statement: 'Revenue growth of 55% expected.' }),
    co('Both', { growthLow: 45, growthHigh: 45, statement: 'Revenue growth of 45% expected.' }), co('Both', { metric: 'PAT', growthLow: 70, growthHigh: 70, statement: 'PAT growth of 70% expected.' }),
    co('OnlyPat', { metric: 'PAT', growthLow: 33, growthHigh: 33, statement: 'PAT growth of 33% expected.' }),
    co('Expired', { period: 'FY26', growthLow: 90, growthHigh: 90, statement: 'Revenue growth of 90%.' }),
  ];
  const { b, s } = build(rows);
  const names = s.highGrowth.map((h) => h.company);
  test('only active FY/CY/12M guidance with a % at or above the threshold on the comparison value is listed', () => {
    for (const n of ['Pass', 'Midpoint', 'OpenHi', 'Both', 'OnlyPat']) assert.ok(names.includes(`ZZ ${n} Ltd`), n);
    for (const n of ['Amount', 'Narrow', 'OpenLo', 'Presales', 'Quarter', 'Media', 'Expired']) assert.ok(!names.includes(`ZZ ${n} Ltd`), n);
  });
  test('a range with a low end below 30 (26-30) uses the midpoint 28 and is excluded; 26-34 uses midpoint 30 and is included; open 80%+ uses the lower bound', () => {
    const narrow = b.records.find((r) => r.record.company === 'ZZ Narrow Ltd')!; assert.equal(narrow.display, '+26–30%'); assert.equal(narrow.points[0].compareValue, 28);
    assert.equal(b.records.find((r) => r.record.company === 'ZZ Midpoint Ltd')!.points[0].compareValue, 30);
    assert.equal(s.highGrowth.find((h) => h.company === 'ZZ OpenHi Ltd')!.compareValue, 80);
  });
  test('proxy metrics and amount-only targets stay in the universe but out of the high-growth list', () => {
    const inUniverse = (n: string) => b.records.some((r) => r.record.company === `ZZ ${n} Ltd`);
    assert.ok(inUniverse('Presales') && inUniverse('Amount')); assert.match(b.records.find((r) => r.record.company === 'ZZ Presales Ltd')!.display, /presales/);
    assert.equal(b.records.find((r) => r.record.company === 'ZZ Amount Ltd')!.display, '₹1,500 Cr target (no % stated)');
  });
  test('multi-year CAGR is listed apart from single-year, labelled, after them, and never counted in the single-year numbers', () => {
    const cagr = s.highGrowth.find((h) => h.company === 'ZZ Cagr Ltd')!; assert.equal(cagr.horizon, 'MULTI_YEAR_CAGR'); assert.equal(cagr.horizonLabel, 'CAGR, multi-year');
    assert.equal(s.highGrowth.findIndex((h) => h.horizon === 'MULTI_YEAR_CAGR') > s.highGrowth.map((h) => h.horizon).lastIndexOf('SINGLE_YEAR'), true);
    assert.equal(s.byMarket.IN.cagrMultiYear, 1); assert.equal(s.byMarket.IN.revenueGe30, 4);   // Pass, Midpoint, OpenHi, Both
  });
  test('the list and every count come from the same set; ordered highest verified guidance first', () => {
    const single = s.highGrowth.filter((h) => h.horizon === 'SINGLE_YEAR');
    assert.equal(s.byMarket.IN.revenueGe30, single.filter((h) => h.revenue).length); assert.equal(s.byMarket.IN.patGe30, single.filter((h) => h.pat).length); assert.equal(s.byMarket.IN.multiMetric, single.filter((h) => h.revenue && h.pat).length);
    assert.equal(s.india.revenueGte30, s.byMarket.IN.revenueGe30); assert.equal(s.india.patGte30, s.byMarket.IN.patGe30); assert.equal(s.india.revenueAndPatGte30, s.byMarket.IN.multiMetric);
    assert.deepEqual(single.map((h) => h.compareValue), single.map((h) => h.compareValue).slice().sort((x, y) => y - x)); assert.equal(single[0].company, 'ZZ OpenHi Ltd');
    assert.ok(s.highGrowth.every((h) => h.label === 'Highest verified guidance')); assert.equal(s.highGrowthLabel, 'Highest verified guidance');
    assert.deepEqual(selectHighGrowth(b.records, 30).map((h) => h.id), s.highGrowth.map((h) => h.id));
  });
  test('the threshold is configurable and counts follow it', () => {
    const s50 = summarize(b.records, NOW, 50, b.inactive); assert.deepEqual(s50.highGrowth.filter((h) => h.horizon === 'SINGLE_YEAR').map((h) => h.company).sort(), ['ZZ Both Ltd', 'ZZ OpenHi Ltd']);
    assert.equal(s50.byMarket.IN.revenueGe30, 1); assert.equal(s50.byMarket.IN.patGe30, 1);
  });
  test('media-only records are not in the headline but are counted as awaiting verification', () => { assert.equal(s.awaitingVerificationCount, 1); });
});

describe('B. implied growth: stated first, implied secondary with its base, never a guess', () => {
  const cupid = mk({ company: 'ZZ Cupid Ltd', ticker: 'ZZCUP', growthLow: 102.7, growthHigh: 109.7, growthOrigin: 'IMPLIED', absoluteTarget: { value: 750, unit: '₹ Cr', valueLow: 725 }, impliedBase: { value: 357.71, unit: '₹ Cr', period: 'FY26' }, statement: 'Management raised FY27 revenue guidance to Rs 725-750 crore from Rs 600 crore.' });
  test('only-implied keeps (implied) and the display of the secondary line names the base', () => {
    const p = build([cupid]).b.records[0].points[0]; assert.match(p.display, /\(implied\)/); assert.equal(p.statedGrowth, null);
    assert.equal(p.impliedDisplay, '+102.7–109.7% (implied, base FY26 revenue ₹357.71 Cr)'); assert.equal(p.absolute!.valueLow, 725);
  });
  test('a stated % is never replaced by an implied one; both are shown, stated primary', () => {
    const stated = mk({ company: 'ZZ Cupid Ltd', ticker: 'ZZCUP', growthLow: 60, growthHigh: 60, statement: 'Management guides revenue growth of 60% for FY27.' });
    const { b } = build([cupid, stated]); const r = b.records[0]; assert.equal(b.records.length, 1);
    assert.equal(r.display, '+60%'); assert.equal(r.points[0].statedGrowth!.low, 60); assert.match(r.secondaryDisplay || '', /implied, base FY26 revenue ₹357\.71 Cr/);
    assert.ok(!b.inactive.some((x) => x.status === 'SUPERSEDED'));
  });
  test('implied growth without a sourced base is kept but flagged and never counted', () => {
    const { b, s } = build([mk({ growthLow: 43, growthHigh: 43, growthOrigin: 'IMPLIED', absoluteTarget: { value: 5000, unit: '₹ Cr' }, statement: 'Targets Rs 5,000 crore revenue.' })]);
    assert.match(b.records[0].points[0].needsReview || '', /no sourced base/); assert.equal(s.highGrowth.length, 0); assert.equal(s.needsReviewCount, 1);
  });
  test('a stored % that does not match target / base is flagged (not silently changed)', () => {
    const { b } = build([mk({ growthLow: 50, growthHigh: 50, growthOrigin: 'IMPLIED', absoluteTarget: { value: 143, unit: '₹ Cr' }, impliedBase: { value: 100, unit: '₹ Cr', period: 'FY26' }, statement: 'Targets Rs 143 crore.' })]);
    assert.match(b.records[0].points[0].needsReview || '', /does not match/); assert.equal(b.records[0].points[0].low, 50);
  });
  test('the real seed: Cupid is implied from a stated amount over the FY26 base, and the owner figures match the earlier May target (SUPERSEDED)', () => {
    const seed = loadSeedRows(JSON.parse(JSON.stringify(RAW))).rows; const { b } = build(seed);
    const cr = seed.find((r) => /cupid/i.test(r.company) && r.metric === 'REVENUE')!; assert.equal(cr.growthOrigin, 'IMPLIED'); assert.deepEqual(cr.impliedBase, { value: 357.71, unit: '₹ Cr', period: 'FY26' });
    assert.ok(Math.abs((750 / 357.71 - 1) * 100 - 109.7) < 0.1 && Math.abs((725 / 357.71 - 1) * 100 - 102.7) < 0.1);
    const rec = b.records.find((r) => /cupid/i.test(r.record.company))!; assert.match(rec.points[0].impliedDisplay || '', /base FY26 revenue ₹357\.71 Cr/);
    const reg = buildRegression(seed, b, NOW).rows.filter((r) => /cupid/i.test(r.company)); assert.deepEqual(reg.map((r) => r.status), ['SUPERSEDED', 'SUPERSEDED']);
  });
});

describe('C. period expiry', () => {
  const q = (n: number, issued: string | null, o: Partial<GuSeedRow> = {}) => co(`Q${n}${issued ? issued.slice(5, 7) : 'x'}`, { market: 'US', period: `Q${n} (year not stated)`, periodKind: 'QUARTER', sourceDate: issued, growthLow: 20, growthHigh: 20, statement: 'Revenue growth of 20% expected.', ...o });
  test('a year-less quarter whose inferred end plus 45 days is before today is EXPIRED, out of the active universe, and counted', () => {
    const { b, s } = build([q(2, '2026-05-05')]); assert.equal(b.records.length, 0); assert.equal(b.inactive[0].status, 'EXPIRED'); assert.match(b.inactive[0].reason, /year not stated/); assert.equal(s.expiredCount, 1);
  });
  test('a year-less quarter still running is active, flagged, and never in the high-growth list', () => {
    const { b, s } = build([q(3, '2026-09-10', { growthLow: 100, growthHigh: 100 })]); const p = b.records[0].points[0];
    assert.equal(p.periodStatus, 'ACTIVE'); assert.equal(p.periodInferred, true); assert.match(p.display, /period year not stated/); assert.equal(s.highGrowth.length, 0); assert.equal(b.records[0].periodUnclear, true);
  });
  test('no issue date, or no period: UNKNOWN, kept in the universe, out of the high-growth list, counted', () => {
    const { b, s } = build([q(4, null), co('NoPeriod', { period: 'Period not stated', periodKind: 'UNKNOWN' })]);
    assert.equal(b.records.length, 2); assert.ok(b.records.every((r) => r.points[0].periodStatus === 'UNKNOWN')); assert.equal(s.unknownPeriodCount, 2); assert.equal(s.highGrowth.length, 0); assert.ok(b.records.every((r) => /period year not stated/.test(r.points[0].display)));
  });
  test('India fiscal logic: FY26 and Q1 FY27 (+lag) are over in Oct 2026; Q2 FY27 and FY27 are running', () => {
    const st = (p: string, k: any) => periodStatusOf(p, k, 'IN', '2026-05-10', NOW).status;
    assert.equal(st('FY26', 'FY'), 'EXPIRED'); assert.equal(st('Q1 FY27', 'QUARTER'), 'EXPIRED'); assert.equal(st('Q2 FY27', 'QUARTER'), 'ACTIVE'); assert.equal(st('FY27', 'FY'), 'ACTIVE');
    assert.equal(periodStatusOf('Q2 FY27', 'QUARTER', 'IN', '2026-05-10', new Date('2026-11-20T00:00:00Z')).status, 'EXPIRED');
  });
  test('US: CY and fiscal years follow the period text; no company fiscal calendar is guessed', () => {
    assert.equal(periodStatusOf('CY2025', 'CY', 'US', null, NOW).status, 'EXPIRED'); assert.equal(periodStatusOf('CY2026', 'CY', 'US', null, NOW).status, 'ACTIVE');
    assert.equal(periodStatusOf('FY2025', 'FY', 'US', null, NOW).status, 'EXPIRED'); const f = periodStatusOf('FY2026', 'FY', 'US', null, NOW); assert.equal(f.status, 'ACTIVE'); assert.match(f.note || '', /fiscal year end not known/);
  });
  test('expired guidance is in history (inactive) only', () => {
    const { b } = build([co('Old', { period: 'FY26' }), co('New')]); assert.deepEqual(b.records.map((r) => r.record.company), ['ZZ New Ltd']); assert.equal(b.inactive.filter((x) => x.status === 'EXPIRED').length, 1);
  });
});

describe('D. plausibility and formatting', () => {
  test('revenue growth of 100% or more needs an explicit stated figure; otherwise needs review and is not counted', () => {
    const ok = build([mk({ growthLow: 150, growthHigh: 150, statement: 'Management guides revenue growth of 150% for the year.' })]); assert.equal(ok.b.records[0].points[0].needsReview, null); assert.equal(ok.s.highGrowth.length, 1);
    const bad = build([mk({ growthLow: 150, growthHigh: 150, statement: 'Management is very bullish on the year ahead.' })]); assert.match(bad.b.records[0].points[0].needsReview || '', /implausible/); assert.equal(bad.s.highGrowth.length, 0); assert.match(bad.b.records[0].display, /needs review/);
    const imp = build([mk({ growthLow: 120, growthHigh: 120, growthOrigin: 'IMPLIED', absoluteTarget: { value: 220, unit: '₹ Cr' }, impliedBase: { value: 100, unit: '₹ Cr', period: 'FY26' }, statement: 'Targets Rs 220 crore revenue.' })]); assert.equal(imp.s.highGrowth.length, 0);
  });
  test('an implied % from a quarter target against a full-year base is rejected: only the amount is shown', () => {
    const { b } = build([mk({ period: 'Q3 FY27', periodKind: 'QUARTER', growthLow: 300, growthHigh: 300, growthOrigin: 'IMPLIED', absoluteTarget: { value: 400, unit: '₹ Cr' }, impliedBase: { value: 100, unit: '₹ Cr', period: 'FY26' }, statement: 'Q3 revenue of Rs 400 crore.' })]);
    const p = b.records[0].points[0]; assert.equal(p.low, null); assert.equal(p.display, '₹400 Cr target (no % stated)'); assert.match(p.impliedRejected || '', /3-month Q3 FY27 target cannot be divided by a 12-month base/);
  });
  test('like with like is accepted: quarter target over a quarter base, FY over FY', () => {
    const { b } = build([mk({ period: 'Q3 FY27', periodKind: 'QUARTER', growthLow: 33.3, growthHigh: 33.3, growthOrigin: 'IMPLIED', absoluteTarget: { value: 400, unit: '₹ Cr' }, impliedBase: { value: 300, unit: '₹ Cr', period: 'Q3 FY26' }, statement: 'Q3 revenue of Rs 400 crore.' })]);
    assert.equal(b.records[0].points[0].impliedRejected, null); assert.equal(b.records[0].points[0].impliedGrowth!.low, 33.3);
  });
  test('negative growth renders as -19.8%, never +-19.8%', () => {
    const d = displayOf({ metric: 'REVENUE', low: -19.8, high: -19.8, open: false, origin: 'STATED', periodKind: 'FY', period: 'FY27', abs: null }); assert.equal(d, '-19.8%');
    assert.equal(displayOf({ metric: 'REVENUE', low: -20, high: -10, open: false, origin: 'STATED', periodKind: 'FY', period: 'FY27', abs: null }), '-20 to -10% '.trim());
    assert.ok(!/\+-/.test(build([mk({ growthLow: -19.8, growthHigh: -19.8, statement: 'Revenue to fall 19.8%.' })]).b.records[0].display));
  });
});

describe('F. one entity per company', () => {
  test('spelling variants, a (TICKER) suffix and a short alias resolve to one record per metric and period', () => {
    const rows = [
      mk({ company: 'ZZ Krishana Phoschem Ltd', ticker: null }), mk({ company: 'ZZ Krishna Phoschem Ltd', ticker: null, sourceDate: '2026-07-14' }),
      mk({ company: 'ZZ Marine Works Ltd (ZZMW)', ticker: null, period: 'FY27' }), mk({ company: 'ZZ Marine Works Ltd', ticker: 'ZZMW', sourceDate: '2026-07-01' }),
      mk({ company: 'ZZRoss', ticker: null, metric: 'PAT' }), mk({ company: 'ZZ Rossell Techsys Ltd', ticker: 'ZZROSS', metric: 'REVENUE' }),
    ];
    const { b } = build(rows); assert.equal(b.records.length, 3);
    const slots = b.records.flatMap((r) => r.points.map((p) => `${r.entityKey}|${p.metric}|${p.period}`)); assert.equal(new Set(slots).size, slots.length);
    assert.equal(b.records.find((r) => /marine/i.test(r.record.company))!.points.length, 1);
  });
  test('different tickers are never merged even with a one-letter difference', () => {
    assert.equal(build([mk({ company: 'ZZ Phoschem Alpha Ltd', ticker: 'ZZPA1' }), mk({ company: 'ZZ Phoschem Alphb Ltd', ticker: 'ZZPA2' })]).b.records.length, 2);
  });
  test('the real seed has one record per company (Rossell/RossTech, KMEW, Krishana/Krishna)', () => {
    const seed = loadSeedRows(JSON.parse(JSON.stringify(RAW))).rows; const { b } = build(seed);
    for (const re of [/ross/i, /knowledge marine/i, /krish/i]) assert.equal(b.records.filter((r) => re.test(r.record.company)).length, 1);
    const extra = [...seed, { ...seed.find((r) => /krishana/i.test(r.company))!, company: 'Krishna Phoschem', ticker: null }, { ...seed.find((r) => /rossell/i.test(r.company))!, company: 'RossTech', ticker: null }, { ...seed.find((r) => /knowledge/i.test(r.company))!, company: 'Knowledge Marine & Engineering Works (KMEW)', ticker: null }];
    assert.equal(build(extra).b.records.length, b.records.length);
  });
});

describe('E. regression keeps all 20 claim names with an honest status and reason', () => {
  const seed = loadSeedRows(JSON.parse(JSON.stringify(RAW))).rows; const { b } = build(seed); const reg = buildRegression(seed, b, NOW);
  test('every owner claim is listed; HFCL is REJECTED with the reason (media only, 40% raised from 20%); Krishana is not a false match', () => {
    assert.equal(new Set(reg.rows.map((r) => r.ownerText)).size, 20); assert.ok(reg.rows.every((r) => r.status && r.reason));
    const h = reg.rows.find((r) => /hfcl/i.test(r.company))!; assert.equal(h.status, 'REJECTED'); assert.match(h.reason, /media or secondary/); assert.match(h.found, /\+40%/);
    const k = reg.rows.find((r) => /krishana/i.test(r.company))!; assert.equal(k.status, 'PARTIALLY_VERIFIED'); assert.match(k.found, /30–35%/);
  });
});

describe('G. summary API shape', () => {
  test('summary carries byMarket, highGrowth rows, expired / unknown / awaiting counts; existing fields are kept', () => {
    const seed = loadSeedRows(JSON.parse(JSON.stringify(RAW))).rows; const { b, s } = build(seed);
    for (const m of ['IN', 'US', 'ALL'] as const) assert.deepEqual(Object.keys(s.byMarket[m]).sort(), ['cagrMultiYear', 'companies', 'multiMetric', 'patGe30', 'revenueGe30']);
    assert.equal(s.byMarket.ALL.companies, b.records.length); assert.equal(s.byMarket.ALL.revenueGe30, s.byMarket.IN.revenueGe30 + s.byMarket.US.revenueGe30);
    for (const k of ['expiredCount', 'unknownPeriodCount', 'awaitingVerificationCount'] as const) assert.equal(typeof s[k], 'number');
    for (const h of s.highGrowth) { assert.ok(h.company && h.market && h.display && h.guidance && h.horizon && h.rank > 0); assert.ok(h.compareValue >= 30); }
    assert.ok(s.india && s.usa && s.all && s.threshold === 30 && s.asOf);
    assert.ok(!s.highGrowth.some((h) => /Sobha|Avalon|Sky Gold|TD Power|Man Industries|Goldiam/i.test(h.company)));
    assert.equal(s.byMarket.IN.revenueGe30, s.india.revenueGte30);
  });
});
