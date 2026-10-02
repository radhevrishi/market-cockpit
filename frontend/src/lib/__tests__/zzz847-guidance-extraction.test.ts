// zzz847 — guidance extraction robustness: paired multi-metric priors, NET_PROFIT metric, real India/US phrasing, headline-only, range classes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractGuidance, isGuidanceUpgradeCandidate, processCandidates } from '../guidance-upgrades';
import type { GuCandidate, GuContext } from '../guidance-upgrades-types';

const NOW = new Date('2026-09-30T12:00:00Z');
let n = 0;
const cand = (title: string, text = '', o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: `z${++n}`, ticker: 'CUPID', company: 'Cupid Ltd', market: 'IN', title, text, sourceName: 'Mint', publishedAt: '2026-09-29T06:00:00Z', kind: 'NEWS', ...o,
});
const us = (ticker: string, title: string, text: string, o: Partial<GuCandidate> = {}): GuCandidate =>
  cand(title, text, { ticker, company: ticker, market: 'US', sourceName: 'SEC 8-K', kind: 'RELEASE', url: 'https://www.sec.gov/Archives/edgar/data/1/1/ex99.htm', ...o });
const run = (cs: GuCandidate[], ctx: GuContext = {}) => { const ev = processCandidates(cs, () => ctx, NOW, '14D'); assert.equal(ev.length, 1); return ev[0]; };
const ex = (t: string) => extractGuidance(t);
const r = (c: any) => [c.metric, c.before?.low ?? null, c.before?.high ?? null, c.after.low, c.after.high, c.direction];

describe('paired multi-metric priors (Cupid live bug)', () => {
  const body = 'Cupid Ltd raised its FY27 guidance. The company now expects revenue of ₹725-750 crore and net profit of ₹210-225 crore, up from ₹600 crore and ₹180 crore earlier.';
  const title = 'Cupid raises FY27 profit guidance, targets Rs 750 crore revenue; stock up 160% in 2026';
  test('priors assigned by order, never a revenue prior against a profit after-value', () => {
    const cs = ex(body);
    const rev = cs.find(c => c.metric === 'REVENUE')!; const np = cs.find(c => c.metric === 'NET_PROFIT')!;
    assert.deepEqual(r(rev), ['REVENUE', 600, 600, 725, 750, 'UP']);
    assert.deepEqual(r(np), ['NET_PROFIT', 180, 180, 210, 225, 'UP']);
    assert.equal(rev.after.unit, 'Cr'); assert.equal(rev.after.currency, '₹');
    assert.equal(Math.round((rev.percentageChange ?? 0) * 10) / 10, 22.9);
    assert.equal(Math.round((np.percentageChange ?? 0) * 10) / 10, 20.8);
    assert.ok(!cs.some(c => c.metric === 'OTHER'));
  });
  test('event: two RAISED changes, G_MULTI_METRIC, HIGH materiality, CLEAN_RAISE', () => {
    const e = run([cand(title, body)]);
    assert.equal(e.changes.length, 2);
    assert.ok(e.changes.every(c => c.direction === 'UP' && c.before));
    assert.equal(e.type, 'G_MULTI_METRIC'); assert.equal(e.materiality, 'HIGH');
    assert.ok(e.v2!.ranges.every(x => x.klass === 'CLEAN_RAISE'));
    assert.equal(e.decision, 'UNVERIFIED'); // news only, no primary source
  });
  test('headline "Rs 750 crore revenue" is owned by revenue, not by the profit word earlier in the title', () => {
    const c = ex('Cupid raises FY27 profit guidance, targets Rs 750 crore revenue')[0];
    assert.equal(c.metric, 'REVENUE'); assert.equal(c.before, null); assert.equal(c.direction, 'UNKNOWN');
  });
});

describe('real India / US phrasing', () => {
  test('raises revenue guidance to A from B', () => assert.deepEqual(r(ex('Acme raises FY27 revenue guidance to ₹725–750 crore from ₹600 crore')[0]), ['REVENUE', 600, 600, 725, 750, 'UP']));
  test('lifted from Rs X cr to Rs Y cr', () => assert.deepEqual(r(ex('Acme revenue guidance lifted from Rs 600 cr to Rs 750 cr for FY27')[0]), ['REVENUE', 600, 600, 750, 750, 'UP']));
  test('25% revenue growth versus 20% earlier', () => {
    const c = ex('Management now expects 25% revenue growth versus 20% earlier in FY27')[0];
    assert.deepEqual(r(c), ['REVENUE_GROWTH', 20, 20, 25, 25, 'UP']); assert.equal(c.percentagePointChange, 5);
  });
  test('EBITDA margin 16–17% from 15–16%', () => assert.deepEqual(r(ex('Acme revised upward its EBITDA margin guidance to 16–17% from 15–16% for FY27')[0]), ['OP_MARGIN', 15, 16, 16, 17, 'UP']));
  test('targets Rs 1,000 crore revenue by FY28, earlier target Rs 800 crore', () => {
    const c = ex('Acme targets ₹1,000 crore revenue by FY28, earlier target ₹800 crore')[0];
    assert.deepEqual(r(c), ['REVENUE', 800, 800, 1000, 1000, 'UP']); assert.equal(c.after.period, 'FY28');
  });
  test('PAT guidance increased to Rs 225 crore (earlier Rs 180 crore)', () => assert.deepEqual(r(ex('Acme FY27 PAT guidance increased to ₹225 crore (earlier ₹180 crore)')[0]), ['NET_PROFIT', 180, 180, 225, 225, 'UP']));
  test('volume growth guidance 12–14% from 10–12%', () => assert.deepEqual(r(ex('Acme upgrades FY26 volume growth guidance to 12–14% from 10–12%')[0]), ['VOLUME', 10, 12, 12, 14, 'UP']));
  test('hikes capex guidance is not an earnings upgrade', () => {
    assert.equal(isGuidanceUpgradeCandidate(cand('Acme hikes capex guidance to ₹500 crore from ₹400 crore')).include, false);
    assert.equal(isGuidanceUpgradeCandidate(cand('Acme raises dividend guidance')).include, false);
    assert.equal(isGuidanceUpgradeCandidate(cand('Acme raises FY27 revenue guidance and capex plan')).include, true);
  });
  test('net profit, PAT, profit after tax, net income all map to NET_PROFIT', () => {
    for (const w of ['net profit', 'PAT', 'profit after tax', 'net income']) assert.equal(ex(`Acme now expects ${w} of ₹225 crore for FY27, up from ₹180 crore earlier`)[0]?.metric, 'NET_PROFIT', w);
  });
});

describe('headline-only raises are kept as detected candidates', () => {
  test('no numbers: CANDIDATE, RAISED stated by source, before/after DATA UNAVAILABLE, UNVERIFIED', () => {
    const e = run([cand('Acme raises FY27 revenue, profit guidance', '', { ticker: 'ACME', company: 'Acme Ltd' })]);
    assert.equal(e.changes.length, 0); assert.equal(e.v2!.stage, 'CANDIDATE'); assert.equal(e.v2!.statedDirection, 'RAISED');
    assert.deepEqual(e.v2!.statedMetrics, ['revenue', 'net profit']);
    assert.equal(e.decision, 'UNVERIFIED'); assert.match(e.whyNow, /DATA UNAVAILABLE/); assert.match(e.whyNow, /raised its revenue, net profit guidance/);
    // zzz854: the only digits allowed are the announcement date of the dated 'Why now' line (never a guidance number)
    assert.ok(!/\d/.test(e.whyNow.replace(/DATA UNAVAILABLE/g, '').replace(/\d{4}-\d{2}-\d{2}/g, '')));
  });
  test('only the new number in the headline: candidate, before unknown (not an upgrade)', () => {
    const e = run([cand('Cupid raises FY27 profit guidance, targets Rs 750 crore revenue; stock up 160% in 2026')]);
    assert.equal(e.changes.length, 1); assert.equal(e.changes[0].before, null); assert.equal(e.changes[0].direction, 'UNKNOWN');
    assert.equal(e.v2!.stage, 'CANDIDATE'); assert.equal(e.decision, 'UNVERIFIED'); assert.equal(e.v2!.statedDirection, 'RAISED');
  });
});

describe('US: units and range classes', () => {
  test('Cintas-style release: revenue in $B, EPS in $/share, income from continuing ops never becomes EPS', () => {
    const t = 'Cintas now expects total revenue in the range of $10.3 billion to $10.4 billion, up from $10.2 billion to $10.3 billion. The company now expects diluted EPS from continuing operations of $4.35 to $4.45, up from $4.20 to $4.30. Income from continuing operations is now expected at $101.2 million to $103 million, up from $99 million to $101 million.';
    const cs = ex(t);
    const rev = cs.find(c => c.metric === 'REVENUE')!; const eps = cs.find(c => c.metric === 'EPS')!;
    assert.equal(rev.after.unit, 'B'); assert.equal(rev.after.currency, '$'); assert.deepEqual([rev.after.low, rev.after.high], [10.3, 10.4]);
    assert.equal(eps.after.unit, ''); assert.deepEqual([eps.after.low, eps.after.high], [4.35, 4.45]); assert.deepEqual([eps.before!.low, eps.before!.high], [4.2, 4.3]);
    assert.ok(!cs.some(c => c.metric === 'EPS' && c.after.unit === 'M'));
    const np = cs.find(c => c.metric === 'NET_PROFIT')!; assert.equal(np.after.unit, 'M'); assert.equal(np.after.low, 101.2);
    const e = run([us('CTAS', 'Cintas raises fiscal 2027 guidance', t)]);
    assert.ok(e.changes.every(c => c.metric !== 'EPS' || !c.after.unit));
  });
  test('Fuller: low end raised, high end lowered = narrowing, not a repeated upgrader, never above WATCHLIST', () => {
    const ledger = [1, 2].map(i => ({ date: `2026-0${i}-01`, metric: 'ADJ_EPS' as const, period: 'FY25', text: '+', change: 'RAISED' as const }));
    const e = run([us('FUL', 'Fuller raises FY26 adjusted EPS guidance', 'Fuller now expects Adjusted EPS for FY26 of $4.70–4.85, up from $4.60–4.90 previously.')],
      { ledger, consensus: { metric: 'ADJ_EPS', period: 'FY26', value: 4.81, unit: '$', source: 'test' } });
    assert.equal(e.v2!.ranges[0].klass, 'MIDPOINT_RAISE_RANGE_NARROWING');
    assert.ok(!e.flags.includes('REPEATED_UPGRADER')); assert.ok(!e.flags.includes('GUIDANCE_PLUS_GAP'));
    assert.notEqual(e.decision, 'IMMEDIATE_BUY'); assert.ok(['WATCHLIST', 'REJECT', 'DELAYED_EP'].includes(e.decision));
    assert.ok(e.risks.some(x => /range narrowed: top end cut/i.test(x)));
    // zzz854: -0.7% versus consensus is within +/-2%, so it is in line (neutral), never a negative that drives a decision
    assert.equal(e.expectationGap, 'INLINE'); assert.ok((e.gapPct ?? 0) < 0);
    assert.match(e.whyNow, /narrowed the range/); assert.ok(!/raised adjusted EPS/.test(e.whyNow));
  });
  test('Blackberry: floor above old ceiling is a CLEAN_RAISE and the stated driver is reported', () => {
    const e = run([us('BB', 'BlackBerry raises FY27 adjusted EBITDA outlook', 'BlackBerry now expects adjusted EBITDA of $141–158 million for FY27, up from $119–139 million earlier, driven by strong customer demand.')]);
    assert.equal(e.v2!.ranges[0].klass, 'CLEAN_RAISE'); assert.equal(e.v2!.ranges[0].floorAboveOldCeiling, true);
    assert.ok(e.decisionReason.some(l => /FLOOR ABOVE OLD CEILING/.test(l)));
    assert.match(e.whyNow, /driven by/); assert.ok(!/unresolved/i.test(e.whyNow));
  });
});
