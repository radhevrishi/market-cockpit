// zzz844 — Guidance Upgrades V2 engine. Regression fixture from a real event (Cupid Ltd AGM, India, 22 Sep 2026) + synthetic US cases.
// The engine itself hardcodes no ticker; the name appears only in this fixture.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGuidanceUpgradeCandidate, extractGuidance, processCandidates, buildGuidanceEvent, computeRangeMath, validateChangeUnits,
  researchWhyNow, classifyDriver, summarise, isSmallMidCap, nextEvidenceFor, WHY_NOW_UNRESOLVED,
} from '../guidance-upgrades';
import type { GuCandidate, GuContext, GuidanceEvent } from '../guidance-upgrades-types';

const NOW = new Date('2026-09-30T12:00:00Z');
const NSE = 'https://www.nseindia.com/companies-listing/corporate-filings-announcements';
const SEC = 'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/ex99.htm';

const CUPID_TEXT = [
  'Cupid Ltd raised its FY27 guidance at its 33rd AGM.',
  'The company now expects revenue of ₹725–750 crore for FY27, up from ₹600 crore earlier.',
  'Net profit is now expected at ₹210–225 crore for FY27 versus ₹180 crore earlier.',
  'Management cited strong quarterly performance: Q1 FY27 revenue was ₹154.72 crore, up 158.73%, and net profit was ₹44.15 crore.',
  'The order pipeline is at its strongest level.',
  'Exports are about 60% of revenue across 125+ countries.',
  'The new Palava facility will be commissioned next quarter, with capacity of about 1.25 billion male condoms.',
].join(' ');
const cupid = (o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: 'in1', ticker: 'CUPID', company: 'Cupid Ltd', market: 'IN', title: 'Cupid raises FY27 guidance at 33rd AGM', text: CUPID_TEXT,
  sourceName: 'NSE filing', publishedAt: '2026-09-22T10:00:00Z', kind: 'FILING', url: NSE, ...o,
});
let n = 0;
const us = (title: string, o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: `u${++n}`, ticker: 'ZZUS', company: 'Zed US', market: 'US', title, text: o.text ?? '', sourceName: 'SEC 8-K', publishedAt: '2026-09-29', kind: 'FILING', url: SEC, ...o,
});
const one = (cs: GuCandidate[], ctx: GuContext = {}, w: '24H' | '3D' | '7D' | '14D' | '30D' = '14D'): GuidanceEvent => {
  const ev = processCandidates(cs, () => ctx, NOW, w); assert.equal(ev.length, 1); return ev[0];
};
const words = (e: GuidanceEvent): string[] => [
  e.whyNow, e.whatItMeans, e.marketMissing, e.materialityBasis, e.guidance_driver, ...Object.values(e.chain), ...e.risks, ...e.nextEvidence, ...e.decisionReason, ...e.evidenceGaps,
  ...(e.v2?.scorecard.flatMap(s => [s.label, s.detail]) ?? []), e.v2?.durabilityWhy ?? '', ...(e.v2?.unitWarnings ?? []),
];

describe('Regression: Cupid-type AGM raise, India, no consensus', () => {
  const e = one([cupid()]);
  test('included with no consensus', () => assert.equal(isGuidanceUpgradeCandidate(cupid()).include, true));
  test('both metrics RAISED with correct percentages', () => {
    const rev = e.changes.find(c => c.metric === 'REVENUE')!; const np = e.changes.find(c => c.metric === 'NET_PROFIT')!;
    assert.equal(rev.direction, 'UP'); assert.equal(np.direction, 'UP');
    assert.equal(rev.before!.midpoint, 600); assert.equal(rev.after.midpoint, 737.5);
    assert.ok(Math.abs(rev.percentageChange! - 22.9) < 0.05, String(rev.percentageChange));
    assert.equal(np.before!.midpoint, 180); assert.equal(np.after.midpoint, 217.5);
    assert.ok(Math.abs(np.percentageChange! - 20.8) < 0.05, String(np.percentageChange));
  });
  test('type G, materiality HIGH, gap UNKNOWN (not negative), decision not REJECT', () => {
    assert.equal(e.type, 'G_MULTI_METRIC'); assert.equal(e.materiality, 'HIGH');
    assert.equal(e.expectationGap, 'UNKNOWN'); assert.notEqual(e.decision, 'REJECT'); assert.notEqual(e.decision, 'UNVERIFIED');
    assert.equal(e.verification, 'VERIFIED');
  });
  test('range maths per metric', () => {
    assert.equal(e.v2!.ranges.length, e.changes.length);
    const r = e.v2!.ranges[e.changes.findIndex(c => c.metric === 'REVENUE')];
    assert.equal(r.klass, 'CLEAN_RAISE'); assert.equal(r.beforeLow, 600); assert.equal(r.afterLow, 725); assert.equal(r.afterHigh, 750);
    assert.equal(r.widthBefore, 0); assert.equal(r.widthAfter, 25);
  });
  test('WHY NOW resolved from text: capacity + order pipeline', () => {
    assert.equal(e.v2!.whyNowResolved, true);
    assert.match(e.v2!.operatingVariable ?? '', /new capacity/); assert.match(e.v2!.operatingVariable ?? '', /order pipeline/);
    assert.match(e.whyNow, /new capacity/); assert.ok(!e.whyNow.includes(WHY_NOW_UNRESOLVED));
    assert.ok(!/does not say why/i.test(e.whyNow));
  });
  test('durability is evidence-based, not generic', () => {
    assert.ok(['MULTI_QUARTER', 'MULTI_YEAR', 'STRUCTURAL'].includes(e.v2!.durabilityLevel), e.v2!.durabilityLevel);
    assert.match(e.v2!.durabilityWhy, /capacity/i);
  });
  // zzz854: first line = metric + direction + window + source; second = the stated operating variable's own check
  test('driver-specific next evidence (1-2 items, no generic line)', () => {
    assert.ok(e.nextEvidence.length >= 1 && e.nextEvidence.length <= 2);
    assert.match(e.nextEvidence[0], /^Next quarterly results \(~[A-Z][a-z]{2} \d{4}\): quarterly revenue of about .+ to stay on track for the guided .+ — source:/);
    assert.match(e.nextEvidence[1], /Commissioning of the new plant and utilisation in the next quarter/);
    assert.ok(e.nextEvidence.some(x => /order/i.test(x)));
    assert.ok(!e.nextEvidence.some(x => /repeats or raises this guidance again/i.test(x)));
  });
  test('scorecard present, plain words, consensus unknown not dominating', () => {
    const sc = e.v2!.scorecard; assert.equal(sc.length, 8);
    assert.deepEqual(sc.map(s => s.label), ['Size of the raise', 'Earnings materiality', 'Expectation gap', 'Quality of the raise', 'Durability', 'Valuation', 'Evidence', 'Portfolio impact']);
    assert.equal(sc.find(s => s.label === 'Expectation gap')!.rating, 'UNKNOWN');
    for (const s of sc) { assert.ok(['STRONG', 'OK', 'WEAK', 'UNKNOWN'].includes(s.rating)); assert.ok(!/\b\d{1,3}\s*\/\s*100\b/.test(s.detail)); }
  });
  test('flags and meta: consensusAvailable false, stage, detectedVia, no cap flag without market cap', () => {
    assert.equal(e.v2!.consensusAvailable, false); assert.ok(e.v2!.detectedVia.includes('exchange filing'));
    assert.equal(e.v2!.stage, 'DECISION'); assert.equal(e.v2!.smallMidCapInflection, false); assert.ok(!e.flags.includes('SMALL_MID_CAP_INFLECTION'));
  });
  test('explicit decision reason explains itself', () => {
    const last = e.decisionReason[e.decisionReason.length - 1];
    assert.match(last, /^Result: (IMMEDIATE_BUY|WATCHLIST|DELAYED_EP|REJECT) — .{20,}/);
    assert.ok(e.decisionReason.some(l => /^Range check:/.test(l))); assert.ok(e.decisionReason.some(l => /^Why now:/.test(l)));
    assert.ok(e.decisionReason.some(l => /no consensus/i.test(l)));
  });
  test('small/mid cap inflection only when market cap is stated small/mid', () => {
    const small = one([cupid()], { priceContext: { marketCap: 4000 } });           // ₹ Cr
    assert.ok(small.flags.includes('SMALL_MID_CAP_INFLECTION')); assert.equal(small.v2!.smallMidCapInflection, true);
    const big = one([cupid()], { priceContext: { marketCap: 50000 } });
    assert.ok(!big.flags.includes('SMALL_MID_CAP_INFLECTION'));
    assert.equal(isSmallMidCap('IN', 4000), true); assert.equal(isSmallMidCap('IN', 4000 * 1e7), true); assert.equal(isSmallMidCap('IN', 50000), false);
    assert.equal(isSmallMidCap('US', 6e9), true); assert.equal(isSmallMidCap('US', 25e9), false); assert.equal(isSmallMidCap('US', undefined), null);
  });
  test('small/mid flag needs HIGH materiality and multi-metric or >=25%', () => {
    const tiny = one([us('ZZUS raises FY27 revenue guidance to $10.2B from $10.0B, driven by strong demand')], { priceContext: { marketCap: 2e9 } });
    assert.ok(!tiny.flags.includes('SMALL_MID_CAP_INFLECTION'));
    const big = one([us('ZZUS raises FY27 revenue guidance to $13.0B from $10.0B and EPS to $5.50 from $4.00')], { priceContext: { marketCap: 2e9 } });
    assert.ok(big.flags.includes('SMALL_MID_CAP_INFLECTION'));
  });
  test('news-only copy stays a CANDIDATE with no final decision', () => {
    const nw = one([cupid({ kind: 'NEWS', sourceName: 'Economic Times', url: 'https://economictimes.indiatimes.com/x' })]);
    assert.equal(nw.decision, 'UNVERIFIED'); assert.equal(nw.v2!.stage, 'CANDIDATE'); assert.ok(nw.v2!.detectedVia.includes('news'));
  });
  test('same-day event is included in 24H and counted today', () => {
    const d = cupid({ publishedAt: '2026-09-30T06:00:00Z' });
    const ev = processCandidates([d], () => ({}), NOW, '24H'); assert.equal(ev.length, 1);
    assert.equal(summarise(ev, '24H', NOW).today, 1);
  });
});

describe('Detection is independent of consensus; broader wording', () => {
  const yes = [
    'Zed now expects FY27 revenue of $10.8 billion, higher than the $10.0 billion it guided earlier',
    'Zed raises FY27 revenue to ₹725–750 crore from ₹600 crore',
    'Zed further raised its FY27 outlook',
    'Zed revises FY27 EPS guidance upward',
    'Zed increases FY27 net profit target to ₹210 crore from ₹180 crore',
    'Zed now forecasts FY27 EBITDA of $2.2 billion versus $2.0 billion earlier',
    'Zed lifts FY27 order inflow guidance to ₹5 lakh crore from ₹4 lakh crore',
    'Zed now targets FY27 revenue of ₹725-750 crore versus revenue ₹600 crore earlier',
    'Guidance raised: Zed hikes FY27 margin outlook',
  ];
  for (const t of yes) test(`include: ${t}`, () => assert.equal(isGuidanceUpgradeCandidate(us(t)).include, true));
  const no = [
    'Analysts now expect Zed revenue higher than earlier', 'Zed posted net profit increased 20% in Q1 FY27', 'Goldman raises Zed price target',
    'Zed raises ₹500 crore via QIP', 'Zed may raise guidance', 'Zed now expects FY27 revenue of $9.0 billion versus $10.0 billion earlier',
  ];
  for (const t of no) test(`exclude: ${t}`, () => assert.equal(isGuidanceUpgradeCandidate(us(t)).include, false));
  test('Indian units: lakh crore and crore ranges parse', () => {
    const c = extractGuidance('Zed lifts FY27 revenue guidance to ₹5 lakh crore from ₹4 lakh crore')[0];
    assert.equal(c.after.unit, 'L Cr'); assert.equal(c.percentageChange, 25);
    const r = extractGuidance('Zed now expects FY27 revenue of ₹725–750 crore, versus revenue ₹600 crore earlier')[0];
    assert.equal(r.before!.midpoint, 600); assert.equal(r.after.low, 725); assert.equal(r.after.high, 750);
  });
  test('consensus is never needed: same event with and without consensus is detected identically; null consensus only makes gap UNKNOWN', () => {
    const t = 'Zed raises FY27 revenue guidance to $10.8B from $10.0B, driven by strong demand';
    const a = one([us(t)]); const b = one([us(t)], { consensus: { metric: 'REVENUE', period: 'FY27', value: 10.3, unit: '$B', source: 'c' } });
    assert.equal(a.expectationGap, 'UNKNOWN'); assert.equal(b.expectationGap, 'POSITIVE'); assert.equal(a.materiality, b.materiality);
    assert.equal(a.v2!.consensusAvailable, false); assert.equal(b.v2!.consensusAvailable, true);
  });
});

describe('Range maths', () => {
  const pt = (low: number, high: number) => ({ metric: 'EPS' as const, period: 'FY27', low, high, midpoint: (low + high) / 2, isGrowthRate: false, unit: '' });
  test('classes', () => {
    assert.equal(computeRangeMath(pt(9, 10), pt(10, 11)).klass, 'CLEAN_RAISE');
    assert.equal(computeRangeMath(pt(9, 10), pt(9.5, 10)).klass, 'RANGE_SHIFT_UP');
    assert.equal(computeRangeMath(pt(9, 10), pt(9, 11)).klass, 'RANGE_WIDENING');
    assert.equal(computeRangeMath(pt(9, 10), pt(8, 12)).klass, 'MIDPOINT_RAISE_RANGE_NARROWING');
    assert.equal(computeRangeMath(pt(9, 10), pt(9, 10)).klass, 'REITERATION');
    assert.equal(computeRangeMath(pt(9, 10), pt(8, 9)).klass, 'DOWNGRADE');
    assert.equal(computeRangeMath(null, pt(9, 10)).klass, 'FIRST_GUIDANCE');
    const m = computeRangeMath(pt(9, 10), pt(10, 12)); assert.equal(m.midChangePct, 15.79); assert.equal(m.widthBefore, 1); assert.equal(m.widthAfter, 2);
  });
  test('Fuller-style: midpoint up but low end lowered is NOT a clean raise; decision capped at WATCHLIST and flagged in risks', () => {
    const ctx: GuContext = { consensus: { metric: 'EPS', period: 'FY27', value: 4.6, unit: '$', source: 'c' }, priceContext: { pe: 22 } };
    const txt = ' driven by strong demand and a multi-year backlog. Demand should continue over the next few quarters.';
    const fuller = one([us('Zed raises FY27 EPS guidance to $4.30–5.90 from $4.40–4.80' + txt)], ctx);
    assert.equal(fuller.v2!.ranges[0].klass, 'MIDPOINT_RAISE_RANGE_NARROWING');
    assert.equal(fuller.decision, 'WATCHLIST');
    assert.ok(fuller.risks.some(r => /not a clean raise/i.test(r)));
    assert.ok(fuller.decisionReason.some(l => /not clean|not a clean/i.test(l)));
    const clean = one([us('Zed raises FY27 EPS guidance to $5.00–5.40 from $4.40–4.80' + txt)], ctx);
    assert.equal(clean.v2!.ranges[0].klass, 'CLEAN_RAISE'); assert.equal(clean.decision, 'IMMEDIATE_BUY');
  });
});

describe('Units and basis', () => {
  test('Cintas-style EPS with M scale is flagged and dropped, never printed', () => {
    const e = one([us('Zed raises fiscal 2027 revenue guidance to $10.4 billion from $10.0 billion and diluted EPS guidance to $101.2 million from $98.0 million, driven by strong demand')]);
    assert.ok(e.v2!.unitWarnings.some(w => /EPS/.test(w) && /per-share/.test(w)));
    assert.ok(!e.changes.some(c => c.metric === 'EPS' || c.metric === 'ADJ_EPS'));
    assert.ok(e.changes.some(c => c.metric === 'REVENUE'));
    for (const s of words(e)) assert.ok(!/101\.2/.test(s), `EPS figure leaked: ${s}`);
  });
  test('validateChangeUnits: scaled, implausible and unit-mismatch EPS are dropped', () => {
    const mk = (b: any, a: any) => ({ metric: 'EPS' as const, before: b, after: a, absoluteChange: 1, percentageChange: 1, percentagePointChange: null, direction: 'UP' as const });
    const p = (v: number, unit: string) => ({ metric: 'EPS' as const, period: 'FY27', low: v, high: v, midpoint: v, isGrowthRate: false, unit, currency: '$' });
    assert.equal(validateChangeUnits([mk(p(4, ''), p(4.5, ''))]).kept.length, 1);
    assert.equal(validateChangeUnits([mk(p(4, ''), p(4.5, 'M'))]).kept.length, 0);
    assert.equal(validateChangeUnits([mk(p(4000, ''), p(4500, ''))]).kept.length, 0);
  });
  test('GAAP before vs adjusted after is not compared as a clean upgrade', () => {
    const e = one([us('Zed raises FY27 adjusted EPS guidance to $5.00–5.40, compared with GAAP EPS guidance of $4.40–4.80 previously, driven by strong demand')]);
    assert.ok(e.v2!.unitWarnings.some(w => /different bases/i.test(w)));
    assert.equal(e.v2!.ranges[0].klass, 'UNKNOWN'); assert.ok(e.risks.some(r => /different bases/i.test(r)));
    assert.ok(['WATCHLIST', 'REJECT'].includes(e.decision));
  });
  test('basis read from the text (adjusted)', () => {
    const e = one([us('Zed raises adjusted EPS guidance to $5.00–5.40 from $4.40–4.80 for FY27')]);
    assert.equal(e.v2!.metricBasis, 'ADJUSTED'); assert.equal(e.v2!.unitWarnings.length, 0);
  });
});

describe('Why now, durability, decisions', () => {
  // zzz854: no boilerplate — a dated, specific line naming the document; the text is always shown (whyNowResolved true)
  test('unresolved driver: dated, specific wording', () => {
    const e = one([us('Zed raises FY27 revenue guidance to $10.8B from $10.0B')]);
    assert.equal(e.v2!.whyNowResolved, true); assert.equal(e.v2!.operatingVariable, null); assert.equal(e.whyNowDriver, 'Driver not stated');
    assert.match(e.whyNow, /Why now: guidance raised on \d{4}-\d{2}-\d{2} in .+; driver not stated in the release/);
    assert.ok(!e.whyNow.includes('Driver unresolved after primary-source + recent-event research'));
    assert.equal(e.v2!.durabilityLevel, 'UNKNOWN_INSUFFICIENT_EVIDENCE');
  });
  test('operating variable only when stated', () => {
    const d = classifyDriver('raises guidance');
    assert.equal(researchWhyNow('raises guidance', d).resolved, false);
    assert.match(researchWhyNow('volumes grew on higher volumes and better mix', classifyDriver('')).variable ?? '', /volumes/);
    assert.deepEqual(nextEvidenceFor(null), []);
    assert.match(nextEvidenceFor('order pipeline + exports')[0], /Order book \/ export revenue share next quarter/);
  });
  // zzz854: REJECT reserved for lowered / invalid / stale / capital raise; a verified one-off raise is WATCHLIST with the reason
  test('one-off driver -> ONE_OFF durability and WATCHLIST with a reason', () => {
    const e = one([us('Zed raises FY27 EPS guidance to $4.75 from $4.20 due to a one-time tax benefit')]);
    assert.equal(e.v2!.durabilityLevel, 'ONE_OFF'); assert.equal(e.decision, 'WATCHLIST'); assert.match(e.decisionReason.at(-1)!, /^Result: WATCHLIST — .{15,}/);
  });
  // zzz854: a small verified raise is never REJECT; it is tracked (WATCHLIST) and says why
  test('small raises (single or multi metric) are WATCHLIST with the reason, never REJECT', () => {
    const s = one([us('Zed raises FY27 revenue guidance to $10.2B from $10.0B, driven by strong demand')]);
    assert.equal(s.decision, 'WATCHLIST'); assert.match(s.decisionReason.at(-1)!, /small raise/);
    const m = one([us('Zed raises FY27 revenue guidance to $10.2B from $10.0B and EPS to $4.10 from $4.00, driven by strong demand')]);
    assert.equal(m.decision, 'WATCHLIST'); assert.match(m.decisionReason.at(-1)!, /small raise/);
  });
  test('existing rules kept: missing P/E -> WATCHLIST; P/E >= 40 -> DELAYED_EP; unknown gap never IMMEDIATE_BUY', () => {
    const t = 'Zed raises FY27 revenue guidance to $10.8B from $10.0B and EPS to $4.75 from $4.00, driven by strong demand and a multi-year backlog. Demand should continue over the next few quarters.';
    const cons = { metric: 'REVENUE' as const, period: 'FY27', value: 10.3, unit: '$B', source: 'c' };
    assert.equal(one([us(t)], { consensus: cons, priceContext: { pe: 22 } }).decision, 'IMMEDIATE_BUY');
    assert.equal(one([us(t)], { consensus: cons }).decision, 'WATCHLIST');
    assert.equal(one([us(t)], { consensus: cons, priceContext: { pe: 55 } }).decision, 'DELAYED_EP');
    assert.notEqual(one([us(t)], { priceContext: { pe: 22 } }).decision, 'IMMEDIATE_BUY');
  });
  test('no BUY/SELL style words in any V2 narrative, scorecard or reason', () => {
    const banned = /\b(buy|sell|buying|selling|hold|accumulate|reduce|short|avoid|trim)\b/i;
    const evs = [one([cupid()]), one([us('Zed raises FY27 EPS guidance to $4.30–5.90 from $4.40–4.80, driven by strong demand')]), one([us('Zed raises FY27 revenue guidance to $10.8B from $10.0B')])];
    for (const e of evs) for (const s of words(e)) assert.ok(!banned.test(s), `banned wording: ${s}`);
    for (const e of evs) { assert.ok([null, 'A', 'B', 'F', 'G'].includes(e.thesis)); assert.ok(!/\$|₹/.test(e.v2!.durabilityWhy)); }
  });
});

describe('summarise and market independence', () => {
  test('India and US are independent; byMarket, consensusAvailable and today are filled', () => {
    const cons = { metric: 'REVENUE' as const, period: 'FY27', value: 10.3, unit: '$B', source: 'c' };
    const cs = [cupid({ publishedAt: '2026-09-30T05:00:00Z' }), us('Zed raises FY27 revenue guidance to $10.8B from $10.0B, driven by strong demand', { publishedAt: '2026-09-29' })];
    const evs = processCandidates(cs, t => (t === 'ZZUS' ? { consensus: cons } : {}), NOW, '7D');
    assert.equal(evs.length, 2);
    const s = summarise(evs, '7D', NOW);
    assert.equal(s.byMarket!.IN.detected, 1); assert.equal(s.byMarket!.US.detected, 1);
    assert.equal(s.byMarket!.IN.verified, 1); assert.equal(s.byMarket!.US.expectationPositive, 1); assert.equal(s.byMarket!.IN.expectationPositive, 0);
    assert.deepEqual(s.consensusAvailable, { have: 1, of: 2 }); assert.equal(s.today, 1); assert.equal(s.detected, 2);
    const inOnly = processCandidates(cs.filter(c => c.market === 'IN'), () => ({}), NOW, '7D');
    assert.equal(inOnly.length, 1); assert.equal(summarise(inOnly, '7D', NOW).byMarket!.US.detected, 0);
  });
  test('buildGuidanceEvent always fills v2 for every event', () => {
    const e = buildGuidanceEvent([us('Zed raises its FY27 outlook')], {}, NOW);
    assert.ok(e.v2); assert.equal(e.v2!.ranges.length, e.changes.length); assert.equal(e.v2!.scorecard.length, 8);
  });
});
