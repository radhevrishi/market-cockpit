// zzz843 — Guidance Upgrades engine. Synthetic tickers only (ZZTEST, ZZALPHA ...). No real holdings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isGuidanceUpgradeCandidate as incl, extractGuidance, relativeChangeInfo, classifyType, classifyDriver, classifyDuration,
  sourceTier, verificationOf, canonicalKey, mergeCandidates, computeGap, computeImpacts, computeValuation, valueAtUnchangedMultiple,
  materiality, thesisLabel, buildHistory, buildRisks, buildNextEvidence, buildWhyNow, whatItMeans, marketMissing, chain, decide,
  rank, buildGuidanceEvent, processCandidates, summarise, windowDays, withinWindow, DECISION_ORDER, makeChange, computeFlags,
} from '../guidance-upgrades';
import type { GuCandidate, GuContext, GuidanceEvent, GuLedgerRow } from '../guidance-upgrades-types';

const NOW = new Date('2026-09-30T12:00:00Z');
let n = 0;
const cand = (title: string, o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: `c${++n}`, ticker: 'ZZTEST', company: 'ZZTest Corp', market: 'US', title, text: o.text ?? '', sourceName: 'SEC 8-K',
  publishedAt: '2026-09-28', kind: 'FILING', ...o,
});
const build = (title: string, ctx: GuContext = {}, o: Partial<GuCandidate> = {}) => buildGuidanceEvent([cand(title, o)], ctx, NOW);
const NARRATIVE = (e: GuidanceEvent): string[] => [
  e.whyNow, e.whatItMeans, e.marketMissing, e.materialityBasis, e.guidance_driver, ...Object.values(e.chain), ...e.risks, ...e.nextEvidence, ...e.decisionReason, ...e.evidenceGaps,
];

// ---------------------------------------------------------------------------------------------
describe('1. isGuidanceUpgradeCandidate — includes', () => {
  const yes = [
    'ZZTest raises FY27 revenue guidance to $10.8B from $10.0B',
    'ZZTest lifts full-year outlook after strong quarter',
    'ZZTest increases its profit forecast for the year',
    'ZZTest hikes FY27 EPS guidance to $4.75 from $4.20',
    'ZZTest upgrades its FY27 outlook',
    'ZZTest raised its full-year outlook on Tuesday',
    'ZZTest narrows FY27 revenue guidance to $10.5-10.7B from $10.0-11.0B, raising the midpoint',
    'ZZTest now expects revenue growth of 3-5% for FY27, versus flat previously',
    'ZZTest sees FY27 operating margin 24% versus 22% earlier',
    'ZZTest beats consensus and raises full-year guidance',
    'Guidance was raised by ZZTest management for FY27',
  ];
  for (const t of yes) test(t, () => assert.equal(incl(cand(t)).include, true, incl(cand(t)).reason));
});

describe('1. isGuidanceUpgradeCandidate — excludes', () => {
  const no: Array<[string, string]> = [
    ['Broker raises price target on ZZTest to $150', 'Analyst'],
    ['Analysts raise ZZTest FY27 revenue forecast after the print', 'Analyst'],
    ['Goldman upgrades ZZTest to buy, sets price target of $200', 'Analyst'],
    ['ZZTest posts EPS beat but reiterates full-year guidance', 'reiterated'],
    ['ZZTest beats consensus, guidance unchanged', 'unchanged'],
    ['ZZTest maintains FY27 outlook', 'maintained'],
    ['ZZTest cuts FY27 guidance on weak demand', 'cut'],
    ['ZZTest lowers full-year outlook', 'cut'],
    ['ZZTest shares jump 12% to 52-week high on breakout', 'price'],
    ['Government announces new subsidy scheme for the sector', 'gov'],
    ['ZZTest wins Rs 500 crore order from state utility', 'contract'],
    ['Rumour: ZZTest may raise guidance, sources say', 'rumour'],
    ['ZZTest management sounds upbeat about demand', 'commentary'],
    ['ZZTest may raise guidance next quarter', 'speculation'],
    ['ZZTest did not raise its guidance', 'negation'],
    ['Analysts expect ZZTest EPS of $4.75 (prior $4.20)', 'analyst expects'],
    ['ZZTest Q2 revenue rose to $10.8B from $10.0B a year ago', 'actuals not guidance'],
    ['Reddit thread claims ZZTest guidance is about to go up', 'social'],
  ];
  for (const [t, why] of no) test(`${why}: ${t}`, () => { const r = incl(cand(t, { kind: 'NEWS', sourceName: 'Reddit' })); assert.equal(r.include, false, r.reason); });
  test('every exclusion carries a plain reason', () => assert.ok(incl(cand('Broker raises price target on ZZTest')).reason.length > 10));
});

// ---------------------------------------------------------------------------------------------
describe('2. extractGuidance', () => {
  test('absolute in $B: revenue 10.0 -> 10.8', () => {
    const [c] = extractGuidance('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B');
    assert.equal(c.metric, 'REVENUE'); assert.equal(c.after.period, 'FY27');
    assert.equal(c.after.midpoint, 10.8); assert.equal(c.before?.midpoint, 10);
    assert.equal(c.absoluteChange, 0.8); assert.equal(c.percentageChange, 8); assert.equal(c.percentagePointChange, null);
    assert.equal(c.direction, 'UP'); assert.equal(c.after.currency, '$'); assert.equal(c.after.unit, 'B');
  });
  test('growth range 8-10% -> 12-14% is +4pp, never +44%', () => {
    const [c] = extractGuidance('ZZTest lifts revenue growth guidance to 12-14% from 8-10%');
    assert.equal(c.metric, 'REVENUE_GROWTH'); assert.equal(c.after.isGrowthRate, true);
    assert.equal(c.before?.midpoint, 9); assert.equal(c.after.midpoint, 13);
    assert.equal(c.percentagePointChange, 4); assert.equal(c.percentageChange, null); assert.equal(c.absoluteChange, 4);
    assert.equal(relativeChangeInfo(c), 44.4); // info only
    assert.notEqual(c.percentagePointChange, 44.4);
  });
  test('EPS with "(prior ...)"', () => {
    const [c] = extractGuidance('ZZTest now expects EPS of $4.75 (prior $4.20)');
    assert.equal(c.metric, 'EPS'); assert.equal(c.after.midpoint, 4.75); assert.equal(c.before?.midpoint, 4.2);
    assert.equal(c.percentageChange, 13.0952); assert.equal(c.direction, 'UP');
  });
  test('rupee crore ranges', () => {
    const [c] = extractGuidance('ZZTest raised its outlook for revenue to Rs 1,200-1,300 crore from Rs 1,100-1,200 crore for FY27');
    assert.equal(c.metric, 'REVENUE'); assert.equal(c.after.low, 1200); assert.equal(c.after.high, 1300);
    assert.equal(c.before?.low, 1100); assert.equal(c.after.currency, '₹'); assert.equal(c.after.unit, 'Cr');
    assert.equal(c.absoluteChange, 100); assert.ok(Math.abs((c.percentageChange ?? 0) - 8.6957) < 0.01);
  });
  test('margin with "versus ... earlier"', () => {
    const [c] = extractGuidance('ZZTest sees FY margin 24% versus 22% earlier');
    assert.equal(c.metric, 'OP_MARGIN'); assert.equal(c.percentagePointChange, 2); assert.equal(c.percentageChange, null);
  });
  test('multi-metric in one text', () => {
    const cs = extractGuidance('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B and EPS to $4.75 from $4.20. It also lifts operating margin guidance to 24% from 22%.');
    const m = cs.map(c => c.metric).sort();
    assert.deepEqual(m, ['EPS', 'OP_MARGIN', 'REVENUE']);
  });
  test('en dash and "to" ranges', () => {
    const [a] = extractGuidance('ZZTest raises revenue guidance to $10.4–10.6B from $10.0–11.0B');
    assert.equal(a.after.midpoint, 10.5); assert.equal(a.before?.midpoint, 10.5); assert.equal(a.direction, 'FLAT');
    const [b] = extractGuidance('ZZTest raises revenue guidance to $10.4 to $10.6 billion from $9.0 to $9.4 billion');
    assert.equal(b.after.midpoint, 10.5); assert.equal(b.before?.midpoint, 9.2);
  });
  test('euro and pound and million/mn/bn/lakh crore', () => {
    assert.equal(extractGuidance('Company lifts revenue guidance to €1.2bn from €1.0bn')[0].after.currency, '€');
    assert.equal(extractGuidance('Company lifts revenue guidance to £520m from £500m')[0].after.unit, 'M');
    assert.equal(extractGuidance('Company lifts revenue guidance to $800 mn from $700 mn')[0].absoluteChange, 100);
    const [l] = extractGuidance('Group lifts revenue guidance to Rs 1.2 lakh crore from Rs 1.1 lakh crore');
    assert.equal(l.after.unit, 'L Cr'); assert.equal(l.after.midpoint, 1.2);
  });
  test('mixed scales are converted to one scale before comparing', () => {
    const [c] = extractGuidance('Company raises revenue guidance to $1.2 billion from $1,000 million');
    assert.equal(c.before?.midpoint, 1); assert.equal(c.absoluteChange, 0.2);
  });
  test('"from A to B" style is read as before -> after', () => {
    const [c] = extractGuidance('Company raised FY27 revenue guidance from $10.0 to $10.8 billion');
    assert.equal(c.before?.midpoint, 10); assert.equal(c.after.midpoint, 10.8);
  });
  test('missing before -> before null, direction UNKNOWN, not an upgrade', () => {
    const [c] = extractGuidance('ZZTest raises FY27 revenue guidance to $10.8B');
    assert.equal(c.before, null); assert.equal(c.direction, 'UNKNOWN'); assert.equal(c.absoluteChange, null);
  });
  test('implausible parse rejected (wildly inconsistent units)', () => {
    assert.equal(extractGuidance('Company raises revenue guidance to $10.8B from $10.0M').length, 0);
    assert.equal(extractGuidance('Company raises revenue growth guidance to 90% from 8%').length, 0);
  });
  test('year-ago comparisons and consensus are not treated as prior guidance', () => {
    assert.equal(extractGuidance('Company posted EPS of $4.75 versus $4.20 a year ago')[0]?.before ?? null, null);
    const cs = extractGuidance('Company sees revenue of $10.8B, above consensus of $10.3B');
    assert.ok(cs.every(c => c.before === null));
  });
  test('negative or decline guidance is skipped, never guessed', () => {
    assert.equal(extractGuidance('Company now expects revenue growth of -2% to 1%').filter(c => c.before).length, 0);
    assert.equal(extractGuidance('Company now expects revenue decline of 2-4% versus decline of 5-7% earlier').length, 0);
  });
  test('EPS given as a percent is not representable and is dropped', () => {
    assert.equal(extractGuidance('Company raises EPS guidance to 12% from 10%').length, 0);
  });
  test('period normalisation FY2027 / fiscal 2027 / Q2 FY27', () => {
    assert.equal(extractGuidance('Company raises FY2027 revenue guidance to $10.8B from $10.0B')[0].after.period, 'FY27');
    assert.equal(extractGuidance('Company raises fiscal 2027 revenue guidance to $10.8B from $10.0B')[0].after.period, 'FY27');
    assert.equal(extractGuidance('Company raises Q2 FY27 revenue guidance to $2.8B from $2.6B')[0].after.period, 'Q2 FY27');
  });
  test('year digits are not read as guidance numbers', () => {
    assert.deepEqual(extractGuidance('Company raises FY27 guidance for 2027'), []);
  });
  test('flat before growth guidance is stated, so it is used', () => {
    const [c] = extractGuidance('Company now expects revenue growth of 3-5% versus flat previously');
    assert.equal(c.before?.midpoint, 0); assert.equal(c.percentagePointChange, 4);
  });
  test('empty text', () => assert.deepEqual(extractGuidance(''), []));
});

// ---------------------------------------------------------------------------------------------
describe('3. classifyType', () => {
  const ch = (t: string) => extractGuidance(t);
  test('A revenue', () => assert.equal(classifyType(ch('raises revenue guidance to $10.8B from $10.0B')), 'A_REVENUE'));
  test('B profit', () => assert.equal(classifyType(ch('raises EPS guidance to $4.75 from $4.20')), 'B_PROFIT'));
  test('B profit via net profit wording', () => assert.equal(classifyType(ch('raises net profit guidance to Rs 500 crore from Rs 450 crore')), 'B_PROFIT'));
  test('C margin', () => assert.equal(classifyType(ch('sees FY margin 24% versus 22% earlier')), 'C_MARGIN'));
  test('D cash flow', () => assert.equal(classifyType(ch('raises free cash flow guidance to $1.2B from $1.0B')), 'D_CASHFLOW'));
  test('E volume', () => assert.equal(classifyType(ch('raises volume guidance to 12 million from 10 million')), 'E_VOLUME'));
  test('F order backlog', () => assert.equal(classifyType(ch('now expects order backlog of $5.5B (prior $5.0B)')), 'F_ORDER_BACKLOG'));
  test('G multi-metric needs two distinct families', () =>
    assert.equal(classifyType(ch('raises revenue guidance to $10.8B from $10.0B and EPS to $4.75 from $4.20')), 'G_MULTI_METRIC'));
  test('revenue + revenue growth is still one family', () =>
    assert.equal(classifyType(ch('raises revenue guidance to $10.8B from $10.0B. Revenue growth guidance to 12% from 8%.')), 'A_REVENUE'));
});

// ---------------------------------------------------------------------------------------------
describe('4. classifyDriver', () => {
  test('HIGH: demand + volumes', () => { const d = classifyDriver('Raise driven by strong demand and higher volumes'); assert.equal(d.quality, 'HIGH'); assert.equal(d.evidence, 'DIRECT'); });
  test('HIGH: pricing power', () => assert.equal(classifyDriver('reflecting pricing power').quality, 'HIGH'));
  test('HIGH: share gain, capacity, mix, recurring, backlog', () => {
    for (const t of ['market share gains', 'capacity expansion', 'a richer product mix', 'recurring revenue', 'a record backlog']) assert.equal(classifyDriver(`due to ${t}`).quality, 'HIGH', t);
  });
  test('MEDIUM: FX, acquisition, cost savings, commodity, one-off pricing', () => {
    for (const t of ['currency tailwinds', 'the acquisition of Alpha', 'cost savings', 'lower raw material prices', 'one-off pricing']) assert.equal(classifyDriver(`due to ${t}`).quality, 'MEDIUM', t);
  });
  test('LOW: tax benefit, asset sale, non-recurring, cost reversal, buyback', () => {
    for (const t of ['a one-time tax benefit', 'the sale of an asset', 'a non-recurring gain', 'a cost reversal', 'share buyback']) assert.equal(classifyDriver(`due to ${t}`).quality, 'LOW', t);
  });
  test('mixed high + low is MEDIUM and says so', () => { const d = classifyDriver('due to strong demand and a one-time tax benefit'); assert.equal(d.quality, 'MEDIUM'); assert.match(d.driver, /mixed/); });
  test('unknown driver is UNKNOWN + INCOMPLETE, never guessed', () => {
    const d = classifyDriver('ZZTest raises guidance.'); assert.equal(d.quality, 'UNKNOWN'); assert.equal(d.driver, 'Driver not stated in the source'); assert.equal(d.evidence, 'INCOMPLETE');
  });
  test('mentioned without a cause word is INDIRECT', () => assert.equal(classifyDriver('Higher volumes. Guidance was raised.').evidence, 'INDIRECT'));
  test('driver text is plain english, not management wording', () => assert.match(classifyDriver('due to strong demand').driver, /customer demand/i));
});

describe('5. classifyDuration', () => {
  const dur = (t: string) => { const d = classifyDriver(t); return classifyDuration(t, [], d); };
  test('tax benefit -> ONE_OFF', () => assert.equal(dur('due to a one-time tax benefit'), 'ONE_OFF'));
  test('multi-year backlog -> MULTI_YEAR', () => assert.equal(dur('a multi-year backlog supports growth'), 'MULTI_YEAR'));
  test('structural demand + capacity -> MULTI_YEAR', () => assert.equal(dur('structural demand and capacity expansion'), 'MULTI_YEAR'));
  test('stated next quarters -> MULTI_QUARTER', () => assert.equal(dur('strong demand should continue over the next few quarters'), 'MULTI_QUARTER'));
  test('not stated -> UNKNOWN', () => assert.equal(dur('strong demand'), 'UNKNOWN'));
  test('no driver at all -> UNKNOWN', () => assert.equal(dur('raises guidance'), 'UNKNOWN'));
});

// ---------------------------------------------------------------------------------------------
describe('6. sourceTier + verification', () => {
  test('PRIMARY by kind', () => { for (const k of ['FILING', 'RELEASE', 'TRANSCRIPT', 'DECK'] as const) assert.equal(sourceTier('Anything', k), 'PRIMARY'); });
  test('PRIMARY by domain', () => {
    assert.equal(sourceTier('x', 'NEWS', 'https://www.sec.gov/Archives/edgar/data/1/8k.htm'), 'PRIMARY');
    assert.equal(sourceTier('x', 'NEWS', 'https://www.nseindia.com/corporates'), 'PRIMARY');
    assert.equal(sourceTier('x', undefined, 'https://www.bseindia.com/x'), 'PRIMARY');
    assert.equal(sourceTier('x', undefined, 'https://investors.zztest.com/news/1'), 'PRIMARY');
    assert.equal(sourceTier('x', undefined, 'https://ir.zztest.com/release'), 'PRIMARY');
  });
  test('SECONDARY outlets', () => {
    for (const n of ['Reuters', 'Bloomberg', 'Financial Times', 'WSJ', 'CNBC', 'Business Standard', 'Economic Times', 'Moneycontrol', 'Mint', 'Hindu BusinessLine'])
      assert.equal(sourceTier(n, 'NEWS'), 'SECONDARY', n);
    assert.equal(sourceTier('x', 'NEWS', 'https://www.reuters.com/markets/a'), 'SECONDARY');
  });
  test('DISCOVERY: aggregators, blogs, social, unknown', () => {
    for (const n of ['Yahoo Finance', 'Investing.com', 'Seeking Alpha', 'Some Blog', 'Reddit', 'X', 'Random Site']) assert.equal(sourceTier(n, 'NEWS'), 'DISCOVERY', n);
    assert.equal(sourceTier('x', 'NEWS', 'https://finance.yahoo.com/news/1'), 'DISCOVERY');
  });
  test('verification: VERIFIED only with a PRIMARY source', () => {
    const p = { name: 'a', tier: 'PRIMARY' as const, type: 't' }; const s = { name: 'b', tier: 'SECONDARY' as const, type: 't' }; const d = { name: 'c', tier: 'DISCOVERY' as const, type: 't' };
    assert.equal(verificationOf([p, s, d]).verification, 'VERIFIED');
    assert.equal(verificationOf([s, d]).verification, 'UNVERIFIED');
    assert.match(verificationOf([s]).note ?? '', /Primary source not found yet/);
    assert.equal(verificationOf([d]).verification, 'UNVERIFIED');
    assert.equal(verificationOf([]).verification, 'UNVERIFIED');
  });
});

// ---------------------------------------------------------------------------------------------
describe('7. canonicalKey + mergeCandidates', () => {
  test('canonicalKey is stable and normalised', () => {
    assert.equal(canonicalKey('zztest', 'REVENUE', 'Q2 FY27', '2026-09-28T10:00:00Z'), 'ZZTEST|REVENUE|Q2FY27|2026-09-28');
  });
  test('same announcement in five outlets = ONE event, five sources', () => {
    const t = 'ZZTest raises FY27 revenue guidance to $10.8B from $10.0B';
    const outlets: Array<[string, GuCandidate['kind']]> = [['SEC 8-K', 'FILING'], ['Reuters', 'NEWS'], ['Bloomberg', 'NEWS'], ['Yahoo Finance', 'NEWS'], ['Economic Times', 'NEWS']];
    const cands = outlets.map(([s, k], i) => cand(t, { sourceName: s, kind: k, url: `https://ex${i}.example/a`, publishedAt: i === 4 ? '2026-09-29' : '2026-09-28' }));
    const sk = mergeCandidates(cands);
    assert.equal(sk.length, 1); assert.equal(sk[0].sources.length, 5);
    const e = buildGuidanceEvent(sk[0], {}, NOW);
    assert.equal(e.sources.length, 5); assert.equal(e.verification, 'VERIFIED'); assert.equal(e.sources[0].tier, 'PRIMARY');
  });
  test('two raises within a week = one card, history updated, SECOND_UPGRADE_IN_WINDOW', () => {
    const a = cand('ZZTest raises FY27 revenue guidance to $10.4B from $10.0B', { publishedAt: '2026-09-24' });
    const b = cand('ZZTest raises FY27 revenue guidance to $10.8B from $10.4B', { publishedAt: '2026-09-28' });
    const sk = mergeCandidates([b, a]);
    assert.equal(sk.length, 1); assert.deepEqual(sk[0].flags, ['SECOND_UPGRADE_IN_WINDOW']);
    assert.equal(sk[0].history.length, 2); assert.equal(sk[0].changes[0].after.midpoint, 10.8);
    assert.equal(sk[0].announcement_date, '2026-09-28');
  });
  test('different metric same day = separate events only when metrics do not overlap', () => {
    const a = cand('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B');
    const b = cand('ZZTest raises FY27 EPS guidance to $4.75 from $4.20');
    assert.equal(mergeCandidates([a, b]).length, 2);
  });
  test('different companies never merge', () => {
    const a = cand('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B');
    const b = cand('ZZAlpha raises FY27 revenue guidance to $10.8B from $10.0B', { ticker: 'ZZALPHA', company: 'ZZAlpha' });
    assert.equal(mergeCandidates([a, b]).length, 2);
  });
  test('candidates without ticker or company are skipped, not guessed', () => {
    assert.equal(mergeCandidates([cand('x raises guidance', { ticker: undefined, company: undefined })]).length, 0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('8. computeGap', () => {
  test('$10.8B vs $10.3B = +4.9% POSITIVE', () => { const g = computeGap(10.8, 10.3); assert.equal(g.gapPct, 4.9); assert.equal(g.gap, 'POSITIVE'); });
  test('100 -> 110 vs consensus 120 = NEGATIVE', () => assert.equal(computeGap(110, 120).gap, 'NEGATIVE'));
  test('>= +5% LARGE_POSITIVE', () => assert.equal(computeGap(10.5, 10).gap, 'LARGE_POSITIVE'));
  test('+2..+5 POSITIVE', () => assert.equal(computeGap(10.3, 10).gap, 'POSITIVE'));
  test('-0.5..+2 INLINE', () => { assert.equal(computeGap(10.1, 10).gap, 'INLINE'); assert.equal(computeGap(9.97, 10).gap, 'INLINE'); });
  test('below -0.5 NEGATIVE', () => assert.equal(computeGap(9.9, 10).gap, 'NEGATIVE'));
  test('consensus null -> UNKNOWN, never NEGATIVE', () => { const g = computeGap(10.8, null); assert.equal(g.gap, 'UNKNOWN'); assert.equal(g.gapPct, null); });
  test('guidance null or consensus 0 -> UNKNOWN', () => { assert.equal(computeGap(null, 10).gap, 'UNKNOWN'); assert.equal(computeGap(10, 0).gap, 'UNKNOWN'); });
  test('SMALL_POSITIVE only when caller says the market expected more than old guidance', () => {
    assert.equal(computeGap(10.1, 10, { guidanceBefore: 9, marketPrevExpectation: 9.8 }).gap, 'SMALL_POSITIVE');
    assert.equal(computeGap(10.1, 10, { guidanceBefore: 9.9, marketPrevExpectation: 9.8 }).gap, 'INLINE');
    assert.equal(computeGap(10.1, 10).gap, 'INLINE');
  });
});

// ---------------------------------------------------------------------------------------------
describe('9. computeImpacts', () => {
  test('revenue impact = new mid - old mid, COMPANY_GUIDANCE with source + formula', () => {
    const r = computeImpacts(extractGuidance('raises FY27 revenue guidance to $10.8B from $10.0B'), {});
    assert.equal(r.revenueImpact.value, 0.8); assert.equal(r.revenueImpact.label, 'COMPANY_GUIDANCE'); assert.equal(r.revenueImpact.unit, '$B');
    assert.ok(r.revenueImpact.source && r.revenueImpact.formula);
  });
  test('EBITDA: company guidance wins when present', () => {
    const r = computeImpacts(extractGuidance('raises EBITDA guidance to $2.4B from $2.0B'), {});
    assert.equal(r.ebitdaImpact.label, 'COMPANY_GUIDANCE'); assert.equal(r.ebitdaImpact.value, 0.4);
  });
  test('EBITDA: MODEL_ESTIMATE only with incremental revenue + stated margin; formula + assumptions present', () => {
    const r = computeImpacts(extractGuidance('raises FY27 revenue guidance to $10.8B from $10.0B. Sees FY27 operating margin at 20%.'), {});
    assert.equal(r.ebitdaImpact.label, 'MODEL_ESTIMATE'); assert.equal(r.ebitdaImpact.value, 0.16);
    assert.ok(r.ebitdaImpact.formula && (r.ebitdaImpact.assumptions?.length ?? 0) >= 2);
    assert.match(r.ebitdaImpact.source ?? '', /not company guidance/);
  });
  test('EBITDA: estimate from caller-supplied reported margin', () => {
    const r = computeImpacts(extractGuidance('raises FY27 revenue guidance to $10.8B from $10.0B'), { reportedMargin: { value: 25, source: 'last 10-K' } });
    assert.equal(r.ebitdaImpact.label, 'MODEL_ESTIMATE'); assert.equal(r.ebitdaImpact.value, 0.2);
  });
  test('EBITDA: no margin -> UNAVAILABLE, never estimated silently', () => {
    const r = computeImpacts(extractGuidance('raises FY27 revenue guidance to $10.8B from $10.0B'), {});
    assert.equal(r.ebitdaImpact.label, 'UNAVAILABLE'); assert.equal(r.ebitdaImpact.value, null);
  });
  test('EPS and FCF only from guidance, else UNAVAILABLE', () => {
    const a = computeImpacts(extractGuidance('raises EPS guidance to $4.75 from $4.20'), {});
    assert.equal(a.epsImpact.value, 0.55); assert.equal(a.fcfImpact.label, 'UNAVAILABLE');
    const b = computeImpacts(extractGuidance('raises free cash flow guidance to $1.2B from $1.0B'), {});
    assert.equal(b.fcfImpact.value, 0.2); assert.equal(b.epsImpact.label, 'UNAVAILABLE');
  });
  test('missing before -> revenue impact UNAVAILABLE with a reason', () => {
    const r = computeImpacts(extractGuidance('raises FY27 revenue guidance to $10.8B'), {});
    assert.equal(r.revenueImpact.value, null); assert.match(r.revenueImpact.source ?? '', /Previous guidance not found/);
  });
  test('growth guidance impact is in percentage points', () => {
    const r = computeImpacts(extractGuidance('lifts revenue growth guidance to 12-14% from 8-10%'), {});
    assert.equal(r.revenueImpact.value, 4); assert.equal(r.revenueImpact.unit, 'pp');
  });
});

// ---------------------------------------------------------------------------------------------
describe('10. computeValuation', () => {
  const eps = extractGuidance('raises FY27 EPS guidance to €5.80 from €5.00');
  test('earnings effect at an unchanged multiple: 5.00 -> 5.80 at 20x = 100 -> 116 = +16%', () => {
    const v = computeValuation({ priceContext: { pe: 20 } }, eps);
    assert.equal(v.earningsEffectPct.value, 16); assert.equal(v.earningsEffectPct.label, 'MODEL_ESTIMATE');
    assert.match(v.earningsEffectPct.formula ?? '', /100 to 116/); assert.ok((v.earningsEffectPct.assumptions?.length ?? 0) >= 2);
    assert.deepEqual(valueAtUnchangedMultiple(5, 5.8, 20), { before: 100, after: 116, pct: 16 });
  });
  test('multiple sensitivity is separate and NOT assumed', () => {
    const v = computeValuation({ priceContext: { pe: 20 } }, eps);
    assert.equal(v.multipleSensitivityPct.value, null); assert.equal(v.multipleSensitivityPct.label, 'UNAVAILABLE');
    const w = computeValuation({ priceContext: { pe: 20 } }, eps, { multipleSensitivityPct: -10 });
    assert.equal(w.multipleSensitivityPct.value, -10); assert.equal(w.multipleSensitivityPct.label, 'MODEL_ESTIMATE'); assert.ok(w.multipleSensitivityPct.formula);
    assert.equal(w.earningsEffectPct.value, 16);
  });
  test('EV/EBITDA and FCF yield only when data present', () => {
    const a = computeValuation({ priceContext: { evEbitda: 12, fcfYield: 4.5 } }, eps);
    assert.equal(a.evEbitda?.value, 12); assert.equal(a.fcfYield?.value, 4.5);
    const b = computeValuation({}, eps);
    assert.equal(b.evEbitda?.value, null); assert.equal(b.fcfYield?.value, null); assert.equal(b.currentPE.label, 'UNAVAILABLE');
  });
  test('prior re-rating is context only; missing -> DATA UNAVAILABLE', () => {
    assert.match(computeValuation({ priceContext: { move7dPct: 18 } }, eps).priorRerating ?? '', /context only, not the thesis/);
    assert.equal(computeValuation({}, eps).priorRerating, 'DATA UNAVAILABLE');
  });
  test('no EPS guidance -> earnings effect UNAVAILABLE', () => {
    const v = computeValuation({ priceContext: { pe: 20 } }, extractGuidance('raises FY27 revenue guidance to $10.8B from $10.0B'));
    assert.equal(v.earningsEffectPct.value, null); assert.equal(v.epsBefore.label, 'UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------------------------
describe('11. materiality', () => {
  const m = (t: string) => materiality(extractGuidance(t));
  test('EPS +13% -> HIGH with basis listing the numbers', () => { const r = m('raises EPS guidance to $4.75 from $4.20'); assert.equal(r.level, 'HIGH'); assert.match(r.basis, /EPS guidance up 13.1%/); });
  test('EBITDA +20% -> HIGH', () => assert.equal(m('raises EBITDA guidance to $2.4B from $2.0B').level, 'HIGH'));
  test('revenue +8% alone -> MEDIUM', () => assert.equal(m('raises revenue guidance to $10.8B from $10.0B').level, 'MEDIUM'));
  test('revenue +8% with a second metric -> HIGH', () =>
    assert.equal(m('raises revenue guidance to $10.8B from $10.0B and margin to 24% from 23.5%').level, 'HIGH'));
  test('revenue +2% -> LOW', () => assert.equal(m('raises revenue guidance to $10.2B from $10.0B').level, 'LOW'));
  test('revenue growth +4pp is converted to a level change', () => { const r = m('lifts revenue growth guidance to 12-14% from 8-10%'); assert.equal(r.level, 'MEDIUM'); assert.match(r.basis, /3\.7%/); });
  test('margin +2pp -> MEDIUM', () => assert.equal(m('sees FY margin 24% versus 22% earlier').level, 'MEDIUM'));
  test('no numbers -> UNKNOWN', () => assert.equal(materiality([]).level, 'UNKNOWN'));
  test('missing before -> UNKNOWN', () => assert.equal(m('raises FY27 revenue guidance to $10.8B').level, 'UNKNOWN'));
  test('thresholds exist as documented numbers only, not scores', () => assert.ok(!/score/i.test(m('raises EPS guidance to $4.75 from $4.20').basis)));
});

describe('12. thesisLabel', () => {
  const t = (txt: string) => { const d = classifyDriver(txt); return thesisLabel({ changes: extractGuidance(txt), driver: d, text: txt }); };
  test('A: utilisation / margin inflection', () => assert.equal(t('sees FY margin 24% versus 21% earlier on higher capacity utilisation'), 'A'));
  test('B: demand acceleration drives a revenue raise', () => assert.equal(t('raises revenue guidance to $10.8B from $10.0B due to strong demand'), 'B'));
  test('F: profit % far above revenue %, numbers support', () => assert.equal(t('raises revenue guidance to $10.4B from $10.0B and EPS to $4.75 from $4.00'), 'F'));
  test('F needs both numbers (no revenue guidance -> not F)', () => assert.equal(t('raises EPS guidance to $4.75 from $4.00'), null));
  test('G: quiet raise with cash flow evidence', () => assert.equal(t('raises free cash flow guidance to $1.2B from $1.0B on better cash flow'), 'G'));
  test('null otherwise; only A/B/F/G ever returned', () => {
    assert.equal(t('raises revenue guidance to $10.2B from $10.0B'), null);
    assert.equal(thesisLabel({ changes: [], driver: classifyDriver('') }), null);
  });
  test('LOW-quality driver never gets a thesis', () => assert.equal(t('raises EPS guidance to $4.75 from $4.00 and revenue to $10.2B from $10.0B due to a one-time tax benefit'), null));
});

describe('13. buildHistory + flags', () => {
  const row = (date: string, change: GuLedgerRow['change'], o: Partial<GuLedgerRow> = {}): GuLedgerRow => ({ date, metric: 'REVENUE', period: 'FY27', text: '+5%', change, ...o });
  test('stats: counts, average revision, dedup', () => {
    const h = buildHistory([row('2026-01-01', 'RAISED', { revisionPct: 4 }), row('2026-02-01', 'CUT', { revisionPct: -2 }), row('2026-03-01', 'REITERATED')], [row('2026-01-01', 'RAISED', { revisionPct: 4 })]);
    assert.equal(h.rows.length, 3); assert.deepEqual([h.stats?.upgrades, h.stats?.downgrades, h.stats?.reiterations], [1, 1, 1]); assert.equal(h.stats?.avgRevisionPct, 1);
  });
  test('beat rate needs >= 2 resolved results, else null', () => {
    assert.equal(buildHistory([row('2026-01-01', 'RAISED', { result: 'BEAT' })], []).stats?.beatRateAfterUpgrades, null);
    const h = buildHistory([row('2026-01-01', 'RAISED', { result: 'BEAT' }), row('2026-04-01', 'RAISED', { result: 'MISS' }), row('2026-07-01', 'RAISED', { result: 'PENDING' })], []);
    assert.equal(h.stats?.resolved, 2); assert.equal(h.stats?.beatRateAfterUpgrades, 0.5);
  });
  test('empty history -> null stats', () => assert.equal(buildHistory([], []).stats, null));
  test('REPEATED_UPGRADER: >= 2 upgrades, no deterioration, primary evidence', () => {
    const base = { changes: extractGuidance('raises revenue guidance to $10.8B from $10.0B'), history: [], text: 'strong demand', gap: 'UNKNOWN' as const, materiality: 'MEDIUM' as const };
    const two = buildHistory([row('2026-08-01', 'RAISED')], [row('2026-09-01', 'RAISED')]);
    assert.ok(computeFlags({ ...base, verified: true, historyStats: two.stats }).includes('REPEATED_UPGRADER'));
    assert.ok(!computeFlags({ ...base, verified: false, historyStats: two.stats }).includes('REPEATED_UPGRADER'));
    assert.ok(!computeFlags({ ...base, verified: true, historyStats: two.stats, text: 'margin pressure and lower free cash flow' }).includes('REPEATED_UPGRADER'));
    const one = buildHistory([], [row('2026-09-01', 'RAISED')]);
    assert.ok(!computeFlags({ ...base, verified: true, historyStats: one.stats }).includes('REPEATED_UPGRADER'));
  });
});

// ---------------------------------------------------------------------------------------------
describe('14-16. narrative builders', () => {
  const ev = () => build('ZZTest raises FY27 revenue guidance to $10.4B from $10.0B and EPS to $4.75 from $4.00, driven by strong demand', { priceContext: { pe: 20 }, consensus: { metric: 'REVENUE', period: 'FY27', value: 10.0, unit: '$B', source: 'ZZ consensus' } });
  test('risks: 2-4, specific, from evidence', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B, helped by currency tailwinds; top customers account for 40% of sales');
    assert.ok(e.risks.length >= 2 && e.risks.length <= 4);
    assert.ok(e.risks.some(r => /big customers/i.test(r))); assert.ok(e.risks.some(r => /currency/i.test(r)));
  });
  test('risks: customer concentration is NOT raised unless the text mentions it', () => {
    assert.ok(!ev().risks.some(r => /customers/i.test(r)));
  });
  test('risks: one-off for LOW quality; guidance credibility only if history has cuts', () => {
    const e = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.20 due to a one-time tax benefit');
    assert.ok(e.risks.some(r => /one-time/i.test(r))); assert.ok(!e.risks.some(r => /cut guidance before/i.test(r)));
    const cut: GuLedgerRow = { date: '2026-03-01', metric: 'REVENUE', period: 'FY26', text: '-3%', change: 'CUT' };
    const f = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', { ledger: [cut] });
    assert.ok(f.risks.some(r => /cut guidance before/i.test(r)));
  });
  test('risks: thin evidence says what is unknown instead of padding', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B');
    assert.ok(e.risks.length >= 2); assert.ok(e.risks.length <= 4);
  });
  test('nextEvidence: 1-2 measurable items from the numbers', () => {
    const e = build('ZZTest lifts revenue growth guidance to 12-14% from 8-10%');
    assert.ok(e.nextEvidence.length >= 1 && e.nextEvidence.length <= 2);
    assert.match(e.nextEvidence[0], /revenue growth at or above the guided 12–14%/);
  });
  test('whyNow: one sentence naming driver + numbers', () => {
    const w = ev().whyNow; assert.match(w, /\$10\.4B from \$10/); assert.match(w, /strong|demand/i); assert.equal((w.match(/\. /g) ?? []).length, 0);
  });
  test('whyNow: unknown driver says so (V2 wording: Driver unresolved after primary-source + recent-event research)', () => assert.match(build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B').whyNow, /Driver unresolved after primary-source \+ recent-event research/));
  test('whatItMeans: operating leverage only when profit % > revenue % from numbers', () => {
    assert.match(ev().whatItMeans, /operating leverage/);
    const flat = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B');
    assert.ok(!/operating leverage/.test(flat.whatItMeans));
    const same = build('ZZTest raises FY27 revenue guidance to $11.0B from $10.0B and EPS to $4.40 from $4.00');
    assert.ok(!/operating leverage/.test(same.whatItMeans));
  });
  test('marketMissing: DATA UNAVAILABLE when nothing to compare', () => {
    assert.match(build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B').marketMissing, /^DATA UNAVAILABLE/);
  });
  test('marketMissing: uses gap and valuation when present', () => assert.match(ev().marketMissing, /\+4\.0% versus consensus[\s\S]*P\/E of 20x/));
  test('chain has all nine stages filled', () => {
    for (const e of [ev(), build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B')]) {
      const c = e.chain; assert.deepEqual(Object.keys(c).sort(), ['action', 'driver', 'durability', 'earnings', 'event', 'evidence', 'gap', 'risk', 'valuation'].sort());
      for (const v of Object.values(c)) assert.ok(v.length > 3);
    }
    assert.match(build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B').chain.valuation, /DATA UNAVAILABLE/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('17. decide', () => {
  const STRONG = 'ZZTest raises FY27 revenue guidance to $10.8B from $10.0B and EPS to $4.75 from $4.00, driven by strong demand and a multi-year backlog. Demand should continue over the next few quarters.';
  const CONS = { metric: 'REVENUE' as const, period: 'FY27', value: 10.3, unit: '$B', source: 'ZZ consensus' };
  test('IMMEDIATE_BUY only when everything lines up', () => {
    const e = build(STRONG, { consensus: CONS, priceContext: { pe: 22 } });
    assert.equal(e.decision, 'IMMEDIATE_BUY'); assert.equal(e.expectationGap, 'POSITIVE'); assert.equal(e.materiality, 'HIGH');
  });
  test('P/E missing can never be IMMEDIATE_BUY: demoted to WATCHLIST with reason', () => {
    const e = build(STRONG, { consensus: CONS });
    assert.equal(e.decision, 'WATCHLIST'); assert.ok(e.decisionReason.join(' ').includes('valuation data unavailable'));
  });
  test('stretched P/E -> DELAYED_EP', () => assert.equal(build(STRONG, { consensus: CONS, priceContext: { pe: 55 } }).decision, 'DELAYED_EP'));
  test('gap UNKNOWN cannot be IMMEDIATE_BUY', () => assert.notEqual(build(STRONG, { priceContext: { pe: 22 } }).decision, 'IMMEDIATE_BUY'));
  test('duration unknown cannot be IMMEDIATE_BUY', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B and EPS to $4.75 from $4.00, driven by strong demand', { consensus: CONS, priceContext: { pe: 22 } });
    assert.notEqual(e.decision, 'IMMEDIATE_BUY'); assert.equal(e.decision, 'WATCHLIST');
  });
  test('stated margin/cash pressure is thesis-breaking -> not IMMEDIATE_BUY', () => {
    const e = build(STRONG + ' Free cash flow decline and margin pressure remain.', { consensus: CONS, priceContext: { pe: 22 } });
    assert.notEqual(e.decision, 'IMMEDIATE_BUY');
  });
  test('REJECT: immaterial, NEGATIVE gap, LOW quality, no measurable upgrade', () => {
    assert.equal(build('ZZTest raises FY27 revenue guidance to $10.2B from $10.0B, driven by strong demand').decision, 'REJECT');
    assert.equal(build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', { consensus: { ...CONS, value: 12 } }).decision, 'REJECT');
    assert.equal(build('ZZTest raises FY27 EPS guidance to $4.75 from $4.20 due to a one-time tax benefit').decision, 'REJECT');
    assert.equal(build('ZZTest raises its FY27 outlook').decision, 'REJECT');
  });
  test('WATCHLIST: material but evidence incomplete', () => {
    const e = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.00, driven by strong demand');
    assert.equal(e.decision, 'WATCHLIST');
  });
  test('DELAYED_EP: strong earnings + big 7-day move (price only chooses WATCHLIST vs DELAYED_EP)', () => {
    const t = 'ZZTest raises FY27 EPS guidance to $4.75 from $4.00 and revenue to $10.8B from $10.0B, driven by strong demand';
    const cons = { ...CONS, value: 10.3 };
    assert.equal(build(t, { consensus: cons, priceContext: { pe: 25, move7dPct: 0 } }).decision, 'WATCHLIST');
    assert.equal(build(t, { consensus: cons, priceContext: { pe: 25, move7dPct: 20 } }).decision, 'DELAYED_EP');
  });
  test('UNVERIFIED: no primary source -> no final decision', () => {
    const e = build(STRONG, { consensus: CONS, priceContext: { pe: 22 } }, { kind: 'NEWS', sourceName: 'Reuters' });
    assert.equal(e.decision, 'UNVERIFIED'); assert.equal(e.decisionReason[0], 'No primary source — no final decision');
  });
  test('decisionReason is ordered: changed, earnings, gap, valuation, duration, risk', () => {
    const r = build(STRONG, { consensus: CONS, priceContext: { pe: 22 } }).decisionReason;
    const heads = r.slice(0, 6).map(x => x.split(':')[0]); assert.deepEqual(heads, ['What changed', 'Earnings effect', 'Expectations', 'Valuation', 'Durability', 'Risk']);
  });
  test('only the four decisions (+UNVERIFIED) ever come out', () => {
    for (const e of [build(STRONG), build('ZZTest raises its FY27 outlook'), build(STRONG, {}, { kind: 'NEWS', sourceName: 'Reuters' })]) assert.ok(e.decision in DECISION_ORDER);
  });
});

describe('18. rank', () => {
  test('sorts by materiality then gap; UNVERIFIED below verified; rankKey is internal', () => {
    const hi = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.00 and revenue to $10.8B from $10.0B, driven by strong demand');
    const lo = build('ZZAlpha raises FY27 revenue guidance to $10.2B from $10.0B', {}, { ticker: 'ZZALPHA' });
    const un = build('ZZBeta raises FY27 EPS guidance to $5.75 from $4.00 and revenue to $11.8B from $10.0B, driven by strong demand', {}, { ticker: 'ZZBETA', kind: 'NEWS', sourceName: 'Reuters' });
    const r = rank([un, lo, hi]);
    assert.deepEqual(r.map(e => e.ticker), ['ZZTEST', 'ZZALPHA', 'ZZBETA']);
    assert.ok(r[0].rankKey > r[1].rankKey);
  });
  test('price momentum never changes rank', () => {
    const t = 'ZZTest raises FY27 EPS guidance to $4.75 from $4.00, driven by strong demand';
    assert.equal(build(t, { priceContext: { pe: 20, move7dPct: 0 } }).rankKey, build(t, { priceContext: { pe: 20, move7dPct: 40 } }).rankKey);
  });
});

// ---------------------------------------------------------------------------------------------
describe('19-20. buildGuidanceEvent / processCandidates / window / summarise', () => {
  test('fills every field of the type', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B');
    for (const k of ['guidance_event_id', 'canonical_key', 'ticker', 'company', 'market', 'announcement_date', 'verification', 'primaryAvailable', 'sources', 'changes', 'type', 'guidance_quality',
      'guidance_driver', 'driverEvidence', 'history', 'historyStats', 'consensus', 'expectationGap', 'gapPct', 'revenueImpact', 'ebitdaImpact', 'epsImpact', 'fcfImpact', 'valuation', 'duration',
      'thesis', 'materiality', 'materialityBasis', 'evidence', 'links', 'risks', 'evidenceGaps', 'nextEvidence', 'whyNow', 'whatItMeans', 'marketMissing', 'chain', 'decision', 'decisionReason',
      'flags', 'rankKey', 'created_at', 'updated_at']) assert.ok(k in e, k);
    assert.match(e.guidance_event_id, /^gu_[0-9a-f]{16}$/); assert.equal(e.created_at, NOW.toISOString());
  });
  test('id is stable for the same canonical key', () => {
    const a = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B'); const b = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B');
    assert.equal(a.guidance_event_id, b.guidance_event_id);
  });
  test('prior guidance from the ledger can supply a missing before', () => {
    const prior = extractGuidance('raises FY27 revenue guidance to $10.0B from $9.0B')[0].after;
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B', { priorGuidance: [prior] });
    assert.equal(e.changes[0].before?.midpoint, 10); assert.equal(e.changes[0].direction, 'UP');
  });
  test('summary counts', () => {
    const a = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.00, driven by strong demand', { inBook: true, bookThesis: 'F' });
    const b = build('ZZAlpha raises FY27 revenue guidance to $10.2B from $10.0B', {}, { ticker: 'ZZALPHA', kind: 'NEWS', sourceName: 'Reuters' });
    const s = summarise([a, b], '7D', NOW);
    assert.deepEqual([s.detected, s.verified, s.material, s.expectationPositive, s.inBook], [2, 1, 1, 0, 1]); assert.equal(s.window, '7D');
  });
  test('windowDays', () => assert.deepEqual((['24H', '3D', '7D', '14D', '30D'] as const).map(windowDays), [1, 3, 7, 14, 30]));
  test('withinWindow: calendar days for dates, hours for timestamps, never silently extended', () => {
    assert.equal(withinWindow('2026-09-23', '7D', NOW), true);   // exactly 7 days
    assert.equal(withinWindow('2026-09-22', '7D', NOW), false);  // 8 days
    assert.equal(withinWindow('2026-09-22', '14D', NOW), true);
    assert.equal(withinWindow('2026-09-29T13:00:00Z', '24H', NOW), true);
    assert.equal(withinWindow('2026-09-29T11:00:00Z', '24H', NOW), false);
    assert.equal(withinWindow('garbage', '7D', NOW), false); assert.equal(withinWindow('', '7D', NOW), false);
  });
  test('default window is 7D: an 8-day-old event is excluded; stored dates are kept', () => {
    const old = cand('ZZAlpha raises FY27 revenue guidance to $10.8B from $10.0B', { ticker: 'ZZALPHA', publishedAt: '2026-09-22' });
    const fresh = cand('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', { publishedAt: '2026-09-27' });
    const out = processCandidates([old, fresh], () => ({}), NOW);
    assert.deepEqual(out.map(e => e.ticker), ['ZZTEST']); assert.equal(out[0].announcement_date, '2026-09-27');
    const wide = processCandidates([old, fresh], () => ({}), NOW, '14D');
    assert.equal(wide.length, 2); assert.equal(wide.find(e => e.ticker === 'ZZALPHA')?.announcement_date, '2026-09-22');
  });
  test('processCandidates filters non-upgrades, dedups, ranks, and passes ticker to ctxFor', () => {
    const seen: string[] = [];
    const cands = [
      cand('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B'),
      cand('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', { sourceName: 'Reuters', kind: 'NEWS' }),
      cand('Broker raises price target on ZZTest to $150', { kind: 'NEWS', sourceName: 'Reuters' }),
      cand('ZZAlpha posts EPS beat but reiterates guidance', { ticker: 'ZZALPHA' }),
    ];
    const out = processCandidates(cands, t => { seen.push(t); return {}; }, NOW);
    assert.equal(out.length, 1); assert.equal(out[0].sources.length, 2); assert.deepEqual(seen, ['ZZTEST']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('ACCEPTANCE 1-12', () => {
  test('(1) raise revenue guidance -> included', () => assert.equal(incl(cand('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B')).include, true));
  test('(2) EPS beat + reiterated guidance -> excluded', () => assert.equal(incl(cand('ZZTest Q2 EPS beat; company reiterates full-year guidance')).include, false));
  test('(3) analyst target price raise -> excluded', () => assert.equal(incl(cand('Morgan Stanley raises ZZTest price target to $180')).include, false));
  test('(4) raise but below consensus -> included + NEGATIVE gap', () => {
    const t = 'ZZTest raises FY27 revenue guidance to $10.8B from $10.0B';
    assert.equal(incl(cand(t)).include, true);
    const e = build(t, { consensus: { metric: 'REVENUE', period: 'FY27', value: 11.2, unit: '$B', source: 'ZZ consensus' } });
    assert.equal(e.expectationGap, 'NEGATIVE'); assert.ok((e.gapPct ?? 0) < 0);
  });
  test('(5) raise from a one-time tax benefit -> LOW quality, ONE_OFF, REJECT', () => {
    const e = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.20, driven by a one-time tax benefit');
    assert.equal(e.guidance_quality, 'LOW'); assert.equal(e.duration, 'ONE_OFF'); assert.equal(e.decision, 'REJECT');
  });
  test('(6) revenue + EBITDA + EPS raised -> G_MULTI_METRIC + HIGH materiality', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B, EBITDA to $2.4B from $2.0B and EPS to $4.75 from $4.20');
    assert.equal(e.type, 'G_MULTI_METRIC'); assert.equal(e.materiality, 'HIGH'); assert.equal(e.changes.length, 3);
  });
  test('(7) two raises within a week -> one event, history, REPEATED_UPGRADER, SECOND_UPGRADE_IN_WINDOW', () => {
    const a = cand('ZZTest raises FY27 revenue guidance to $10.4B from $10.0B, driven by strong demand', { publishedAt: '2026-09-24' });
    const b = cand('ZZTest raises FY27 revenue guidance to $10.8B from $10.4B, driven by strong demand', { publishedAt: '2026-09-28' });
    const out = processCandidates([a, b], () => ({}), NOW);
    assert.equal(out.length, 1); const e = out[0];
    assert.equal(e.history.filter(r => r.change === 'RAISED').length, 2); assert.equal(e.historyStats?.upgrades, 2);
    assert.ok(e.flags.includes('REPEATED_UPGRADER')); assert.ok(e.flags.includes('SECOND_UPGRADE_IN_WINDOW'));
  });
  test('(7b) REPEATED_UPGRADER needs a primary source', () => {
    const a = cand('ZZTest raises FY27 revenue guidance to $10.4B from $10.0B', { publishedAt: '2026-09-24', kind: 'NEWS', sourceName: 'Reuters' });
    const b = cand('ZZTest raises FY27 revenue guidance to $10.8B from $10.4B', { publishedAt: '2026-09-28', kind: 'NEWS', sourceName: 'Reuters' });
    const e = processCandidates([a, b], () => ({}), NOW)[0];
    assert.ok(!e.flags.includes('REPEATED_UPGRADER')); assert.ok(e.flags.includes('SECOND_UPGRADE_IN_WINDOW'));
  });
  test('(8) same announcement in five sources -> one canonical event with 5 sources', () => {
    const t = 'ZZTest raises FY27 revenue guidance to $10.8B from $10.0B';
    const cands = ['SEC 8-K', 'Reuters', 'Bloomberg', 'CNBC', 'Moneycontrol'].map((s, i) => cand(t, { sourceName: s, kind: i === 0 ? 'FILING' : 'NEWS', url: `https://o${i}.example/x` }));
    const out = processCandidates(cands, () => ({}), NOW);
    assert.equal(out.length, 1); assert.equal(out[0].sources.length, 5);
  });
  test('(9) in My Book -> portfolio context + impact', () => {
    const e = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.00, driven by strong demand', { inBook: true, bookThesis: 'B' });
    assert.equal(e.links.inBook, true); assert.equal(e.links.bookThesisLabel, 'B'); assert.equal(e.links.portfolioImpact, 'SUPPORTS');
    assert.equal(summarise([e], '7D', NOW).inBook, 1);
  });
  test('(9b) portfolio impact only when in book AND thesis known; never auto-recommends adding', () => {
    assert.equal(build('ZZTest raises FY27 EPS guidance to $4.75 from $4.00', { inBook: true }).links.portfolioImpact, undefined);
    assert.equal(build('ZZTest raises FY27 EPS guidance to $4.75 from $4.00', { inBook: false, bookThesis: 'A' }).links.portfolioImpact, undefined);
    const w = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.20, driven by a one-time tax benefit', { inBook: true, bookThesis: 'A' });
    assert.equal(w.links.portfolioImpact, 'WEAKENS');
    const br = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.20, driven by a one-time tax benefit. Margin pressure and lower free cash flow.', { inBook: true, bookThesis: 'A' });
    assert.equal(br.links.portfolioImpact, 'BROKEN');
    assert.ok(!NARRATIVE(w).join(' ').match(/\badd\b/i));
  });
  test('(10) guidance up but consensus already higher -> NEGATIVE', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $110M from $100M', { consensus: { metric: 'REVENUE', period: 'FY27', value: 120, unit: '$M', source: 'ZZ consensus' } });
    assert.equal(e.expectationGap, 'NEGATIVE'); assert.equal(e.gapPct, -8.3);
  });
  test('(11) no primary source -> UNVERIFIED and decision UNVERIFIED', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', {}, { kind: 'NEWS', sourceName: 'Reuters' });
    assert.equal(e.verification, 'UNVERIFIED'); assert.equal(e.decision, 'UNVERIFIED'); assert.ok(e.evidenceGaps.some(g => /Primary source not found yet/.test(g)));
    const d = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', {}, { kind: 'NEWS', sourceName: 'Yahoo Finance' });
    assert.equal(d.decision, 'UNVERIFIED');
  });
  test('(12) raise + bottleneck + material impact -> GUIDANCE_PLUS_BOTTLENECK', () => {
    const ctx: GuContext = { bottleneckThemes: ['Grid transformers'], structuralAlignment: 'ZZTest makes the transformers that the grid build-out is short of.' };
    const e = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.00, driven by strong demand', ctx);
    assert.ok(e.flags.includes('GUIDANCE_PLUS_BOTTLENECK'));
    assert.ok(!build('ZZTest raises FY27 EPS guidance to $4.75 from $4.00', { bottleneckThemes: ['Grid transformers'] }).flags.includes('GUIDANCE_PLUS_BOTTLENECK'));
    assert.ok(!build('ZZTest raises FY27 revenue guidance to $10.2B from $10.0B', ctx).flags.includes('GUIDANCE_PLUS_BOTTLENECK'));
  });
  test('(12b) GUIDANCE_PLUS_GAP: raise + positive gap + materiality >= MEDIUM', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', { consensus: { metric: 'REVENUE', period: 'FY27', value: 10.3, unit: '$B', source: 'c' } });
    assert.ok(e.flags.includes('GUIDANCE_PLUS_GAP'));
    assert.ok(!build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B').flags.includes('GUIDANCE_PLUS_GAP'));
  });
});

// ---------------------------------------------------------------------------------------------
describe('product rules', () => {
  test('+4pp is never shown as +44%', () => {
    const e = build('ZZTest lifts FY27 revenue growth guidance to 12-14% from 8-10%');
    const c = e.changes[0]; assert.equal(c.percentagePointChange, 4); assert.equal(c.percentageChange, null);
    assert.ok(!e.materialityBasis.includes('44'));
  });
  test('consensus absent -> UNKNOWN, not NEGATIVE', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B');
    assert.equal(e.expectationGap, 'UNKNOWN'); assert.equal(e.gapPct, null); assert.equal(e.consensus.label, 'UNAVAILABLE'); assert.equal(e.consensus.value, null);
  });
  test('consensus for another metric or unit is not compared', () => {
    const wrongMetric = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', { consensus: { metric: 'EPS', period: 'FY27', value: 4, unit: '$', source: 'c' } });
    assert.equal(wrongMetric.expectationGap, 'UNKNOWN');
    const wrongUnit = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', { consensus: { metric: 'REVENUE', period: 'FY27', value: 10300, unit: '$M', source: 'c' } });
    assert.equal(wrongUnit.expectationGap, 'UNKNOWN');
  });
  test('missing data shows UNAVAILABLE and nothing is invented', () => {
    const e = build('ZZTest raises its FY27 outlook');
    assert.equal(e.revenueImpact.value, null); assert.equal(e.revenueImpact.label, 'UNAVAILABLE');
    assert.equal(e.ebitdaImpact.value, null); assert.equal(e.epsImpact.value, null); assert.equal(e.fcfImpact.value, null);
    assert.equal(e.valuation?.currentPE.value, null); assert.equal(e.valuation?.priorRerating, 'DATA UNAVAILABLE');
    assert.equal(e.materiality, 'UNKNOWN'); assert.equal(e.thesis, null);
    assert.ok(e.evidenceGaps.some(g => /DATA UNAVAILABLE/.test(g))); assert.match(e.marketMissing, /DATA UNAVAILABLE/);
    assert.equal(e.guidance_driver, 'Driver not stated in the source'); assert.equal(e.driverEvidence, 'INCOMPLETE');
  });
  test('every MODEL_ESTIMATE carries formula + assumptions (all events, all numbers)', () => {
    const evs = [
      build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B. Sees FY27 operating margin at 20%.', { priceContext: { pe: 20 } }),
      build('ZZTest raises FY27 EPS guidance to $4.75 from $4.20', { priceContext: { pe: 20 } }),
      build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', { reportedMargin: { value: 25, source: 'last report' } }),
    ];
    let seen = 0;
    const check = (x: unknown) => {
      if (!x || typeof x !== 'object') return;
      const o = x as Record<string, unknown>;
      if (o.label === 'MODEL_ESTIMATE') { seen++; assert.ok(typeof o.formula === 'string' && (o.formula as string).length > 5, 'formula'); assert.ok(Array.isArray(o.assumptions) && (o.assumptions as unknown[]).length >= 1, 'assumptions'); }
      for (const v of Object.values(o)) if (v && typeof v === 'object') check(v);
    };
    for (const e of evs) check(e);
    assert.ok(seen >= 3);
  });
  test('an estimate is never labelled as company guidance', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', { reportedMargin: { value: 25, source: 'last report' } });
    assert.equal(e.ebitdaImpact.label, 'MODEL_ESTIMATE'); assert.notEqual(e.ebitdaImpact.label, 'COMPANY_GUIDANCE');
  });
  test('UNPROVEN never becomes DIRECT/VERIFIED by inference', () => {
    const e = build('ZZTest raises its FY27 outlook', {}, { kind: 'NEWS', sourceName: 'Yahoo Finance' });
    assert.equal(e.evidence, 'UNPROVEN'); assert.equal(e.verification, 'UNVERIFIED');
    const f = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', {}, { kind: 'NEWS', sourceName: 'Reuters' });
    assert.equal(f.evidence, 'INDIRECT'); assert.equal(f.verification, 'UNVERIFIED');
  });
  test('price never lifts a decision: move7dPct 0 vs 40 -> never better, identical rank', () => {
    const texts = [
      'ZZTest raises FY27 revenue guidance to $10.8B from $10.0B and EPS to $4.75 from $4.00, driven by strong demand and a multi-year backlog over the next few quarters',
      'ZZTest raises FY27 EPS guidance to $4.75 from $4.00 and revenue to $10.8B from $10.0B, driven by strong demand',
      'ZZTest raises FY27 revenue guidance to $10.2B from $10.0B',
    ];
    for (const t of texts) for (const pe of [undefined, 22, 55]) {
      const mk = (m: number) => build(t, { consensus: { metric: 'REVENUE', period: 'FY27', value: 10.3, unit: '$B', source: 'c' }, priceContext: { pe, move7dPct: m } });
      const lo = mk(0); const hi = mk(40);
      assert.ok(DECISION_ORDER[hi.decision] <= DECISION_ORDER[lo.decision], `${t} pe=${pe}: ${lo.decision} -> ${hi.decision}`);
      assert.equal(hi.rankKey, lo.rankKey); assert.equal(hi.materiality, lo.materiality); assert.equal(hi.guidance_quality, lo.guidance_quality); assert.equal(hi.type, lo.type);
    }
  });
  test('the module never emits BUY/SELL wording other than the four decisions', () => {
    const evs = [
      build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B and EPS to $4.75 from $4.00, driven by strong demand and a multi-year backlog over the next few quarters', { priceContext: { pe: 22, move7dPct: 30 }, consensus: { metric: 'REVENUE', period: 'FY27', value: 10.3, unit: '$B', source: 'c' }, inBook: true, bookThesis: 'B', bottleneckThemes: ['Grid'], structuralAlignment: 'Sells into the grid build-out.' }),
      build('ZZTest raises FY27 EPS guidance to $4.75 from $4.20 due to a one-time tax benefit and share buyback; customer concentration; currency tailwinds'),
      build('ZZTest raises its FY27 outlook'),
      build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B', {}, { kind: 'NEWS', sourceName: 'Reuters' }),
    ];
    const banned = /\b(buy|sell|buying|selling|hold|accumulate|reduce|short|avoid|trim)\b/i;
    for (const e of evs) for (const s of NARRATIVE(e)) assert.ok(!banned.test(s), `banned wording in: ${s}`);
    for (const e of evs) assert.ok(['IMMEDIATE_BUY', 'WATCHLIST', 'DELAYED_EP', 'REJECT', 'UNVERIFIED'].includes(e.decision));
  });
  test('thesis label is only ever A/B/F/G/null', () => {
    for (const t of ['raises revenue guidance to $10.8B from $10.0B due to strong demand', 'raises EPS guidance to $4.75 from $4.00', 'sees FY margin 24% versus 21% earlier on higher capacity utilisation'])
      assert.ok([null, 'A', 'B', 'F', 'G'].includes(build(`ZZTest ${t}`).thesis));
  });
  test('no visible 0-100 score anywhere in generated text', () => {
    const e = build('ZZTest raises FY27 EPS guidance to $4.75 from $4.00, driven by strong demand', { priceContext: { pe: 20 } });
    assert.ok(!NARRATIVE(e).some(s => /\bscore\b/i.test(s)));
  });
  test('engine is a pure module: imports only the types file, nothing from price or quote modules', () => {
    const src = readFileSync(join(__dirname, '..', 'guidance-upgrades.ts'), 'utf8');
    const imports = src.split('\n').filter(l => /^\s*(import|export .* from)\b/.test(l) || /^\s*}\s*from\s+['"]/.test(l));
    assert.ok(imports.length >= 1);
    for (const l of imports) assert.ok(!/(price|quote|yahoo|market-data)/i.test(l), l);
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|require\(|process\.env|Math\.random|Date\.now\(|new Date\(\)/.test(src.replace(/\/\/.*$/gm, '')), 'no I/O, no randomness, no wall-clock');
    assert.deepEqual([...new Set(imports.map(l => /from\s+['"]([^'"]+)['"]/.exec(l)?.[1]).filter(Boolean))], ['./guidance-upgrades-types']);
  });
  test('deterministic: same input, same output', () => {
    const t = 'ZZTest raises FY27 revenue guidance to $10.8B from $10.0B and EPS to $4.75 from $4.00, driven by strong demand';
    assert.deepEqual(build(t, { priceContext: { pe: 20 } }), build(t, { priceContext: { pe: 20 } }));
  });
  test('makeChange handles null before', () => {
    const a = extractGuidance('raises FY27 revenue guidance to $10.8B')[0].after;
    const c = makeChange(null, a); assert.equal(c.direction, 'UNKNOWN'); assert.equal(c.before, null);
  });
  test('chain / risks / nextEvidence / whyNow / whatItMeans / marketMissing / decide are exported and usable directly', () => {
    const e = build('ZZTest raises FY27 revenue guidance to $10.8B from $10.0B');
    assert.equal(typeof buildRisks(e, { text: '', kinds: [] })[0], 'string'); assert.ok(buildNextEvidence(e).length >= 1);
    assert.equal(typeof buildWhyNow(e), 'string'); assert.equal(typeof whatItMeans(e), 'string'); assert.equal(typeof marketMissing(e), 'string');
    assert.equal(chain(e).event.length > 0, true); assert.equal(decide(e).decision, e.decision);
  });
});
