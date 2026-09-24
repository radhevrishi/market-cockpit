// zzz797 — Theme Rotation fixes from the owner's paste, one describe per issue:
//   1 earnings layer compared like for like (graded share / covered bench),
//     level-only when no earlier quarter is on file, normalised by theme size;
//   3 catalysts: nothing counted = no data; 14 days vs the 14 before;
//   4 early rotation needs a REAL improvement plus a second confirmation;
//   5 cross-theme rotation needs source falling AND destination rising, and
//     "next in line" names are small / mid caps only;
//   7 priority vs verdict explained; tiers coherent with the evidence count;
//   8 short-term break rule + wording; 9 "Falling less" explained;
//  10 small breadth samples are low confidence.
// Run: npx tsx --test src/lib/__tests__/zzz797-theme-evidence.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { BreadthStats, CatalystInput, EarningsInput, FlowStats, GradedInput, Payload, PrintInput, ThemeRow } from '../theme-rotation/types';
import { breadthLayer, buildLayers, catalystLayer, earningsLayer } from '../theme-rotation/layers';
import { detectCrossFlows, detectDefensive, detectEarlyRotation, detectShortTermBreak } from '../theme-rotation/detectors';
import { assessTheme, relationLine } from '../theme-rotation/ranking';
import { shortTermBreakRead, verdictFor } from '../theme-rotation/verdict';
import { buildViewModel } from '../theme-rotation/view-model';
import { earningsFromBench, earningsFromGraded } from '../theme-rotation/evidence-inputs';
import { smallMidBeneficiaries } from '../theme-rotation/analytics';
import { isoWeek } from '../theme-rotation/history';

const NOW = new Date('2026-09-24T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const trail = (xs: number[], ys: number[]) => xs.map((x, i) => ({ x, y: ys[i] }));
function row(p: Partial<ThemeRow> & { id: string }): ThemeRow {
  return {
    name: p.id, emoji: '•', group: 'G', proxy: null, members: [], ok: true,
    ret: { w1: 1, m1: 2, m3: 5, m6: 8, ytd: 10, y1: 15 },
    rsRatio: 100, rsMomentum: 100, quadrant: 'Leading', aboveSMA50: true, dist50: 3, rangePos: 70, vol: 25,
    rsSlope: 0, rsDelta1w: 0, momDelta1w: 0, trail: trail([100, 100, 100, 100, 100, 100, 100, 100], [100, 100, 100, 100, 100, 100, 100, 100]),
    ...p,
  } as ThemeRow;
}
const breadth = (n: number, above50: number, above50Prev: number | null, outperf = 0, newHighs = 0, newLows = 0): BreadthStats => ({ n, above50, above50Prev, outperf, newHighs, newLows });
const flow = (relVol: number, upShare: number, upSharePrev: number | null = null): FlowStats => ({ relVol, upShare, upSharePrev, basis: 'etf' });
const strong = (n: number, fromAge: number, tag = 'R'): PrintInput[] => Array.from({ length: n }, (_, i) => ({ ticker: `${tag}${i}`, tier: 'STRONG', filingDate: daysAgo(fromAge + i * 2) }));
const graded = (tickers: string[], age: number, tier: string): GradedInput[] => tickers.map((t) => ({ ticker: t, tier, filingDate: daysAgo(age) }));
const cats = (pos: number, neg: number, ageFrom = 1): CatalystInput[] => [
  ...Array.from({ length: pos }, (_, i) => ({ ticker: `C${i}`, kind: 'order' as const, tone: 'pos' as const, title: 'Receipt of order', date: new Date(NOW.getTime() - (ageFrom + i) * 86_400_000).toISOString(), url: 'https://x', source: 'filing' as const })),
  ...Array.from({ length: neg }, (_, i) => ({ ticker: `N${i}`, kind: 'rating-down' as const, tone: 'neg' as const, title: 'Rating downgraded', date: new Date(NOW.getTime() - (ageFrom + 1 + i) * 86_400_000).toISOString(), url: null, source: 'news' as const })),
];
const L = (t: ThemeRow, earnings: EarningsInput | null, c: CatalystInput[] | null = [], coverage?: number) => buildLayers(t, {
  benchName: 'NIFTY 50', benchRet: { w1: 0, m1: 1, m3: 3, m6: 5, ytd: 8, y1: 12 }, earnings, benchLabel: 'bench', catalysts: c, catalystWindowDays: 14, catalystCoverageDays: coverage, themePEs: [], allPEs: [], now: NOW,
});

// ═══ 1. EARNINGS ════════════════════════════════════════════════════════════
describe('1 · earnings layer — like for like, never an artefact', () => {
  test('the owner\'s case: N prints this quarter, 0 before because the bench never covered it → LEVEL, not improving', () => {
    const e: EarningsInput = { source: 'bench', prints: strong(28, 5), priorCovered: false, market: { strong: { recent: 300, prior: 0 }, reported: null } };
    const r = earningsLayer(e, NOW, 'bench');
    assert.equal(r.state, 'level');
    assert.equal(r.basis, 'level');
    assert.match(r.headline, /Level only: 28 strong prints in the last 90 days \(no earlier quarter on file\)/);
    assert.doesNotMatch(r.headline, /0 in the 90 days before/);
  });
  test('earningsFromBench decides coverage market-wide: an empty earlier window is not "on file"', () => {
    const ps = [...strong(20, 5, 'A'), ...strong(10, 5, 'B')];
    const e = earningsFromBench(ps, (t) => (t.startsWith('A') ? ['fmcg'] : ['energy']), ['fmcg', 'energy', 'media'], NOW);
    assert.equal(e.fmcg.priorCovered, false);
    assert.equal(earningsLayer(e.fmcg, NOW, 'b').state, 'level');
    assert.equal(earningsLayer(e.media, NOW, 'b').state, 'unknown', 'no prints at all stays "no data"');
  });
  test('graded history: share of reporters, this quarter vs last — normalised by theme size', () => {
    const big = Array.from({ length: 100 }, (_, i) => `BIG${i}`);
    const small = Array.from({ length: 10 }, (_, i) => `SM${i}`);
    const rows: GradedInput[] = [
      // Capital goods: 72 of 100 strong now, 70 of 100 before → steady despite 72 prints.
      ...graded(big.slice(0, 72), 20, 'STRONG'), ...graded(big.slice(72), 20, 'MIXED'),
      ...graded(big.slice(0, 70), 120, 'STRONG'), ...graded(big.slice(70), 120, 'AVOID'),
      // Media: 5 of 10 strong now, 1 of 10 before → improving on only 5 prints.
      ...graded(small.slice(0, 5), 25, 'BLOCKBUSTER'), ...graded(small.slice(5), 25, 'MIXED'),
      ...graded(small.slice(0, 1), 130, 'STRONG'), ...graded(small.slice(1), 130, 'MIXED'),
    ];
    const e = earningsFromGraded(rows, (t) => (t.startsWith('BIG') ? ['capgoods'] : ['media']), ['capgoods', 'media'], NOW);
    assert.equal(e.capgoods.priorCovered, true);
    assert.deepEqual(e.capgoods.reported, { recent: 100, prior: 100 });
    const cg = earningsLayer(e.capgoods, NOW, 'g'), md = earningsLayer(e.media, NOW, 'g');
    assert.equal(cg.state, 'steady', cg.headline);
    assert.equal(md.state, 'improving', md.headline);
    assert.match(md.headline, /5 of 10 reporters printed strong \(50%\)/);
    assert.match(md.headline, /1 of 10 \(10%\) the quarter before/);
    assert.equal(md.basis, 'compared');
  });
  test('graded history without an earlier quarter on file → level only, never improving', () => {
    const rows = graded(['A', 'B', 'C', 'D', 'E'], 10, 'STRONG');
    const e = earningsFromGraded(rows, () => ['x'], ['x'], NOW);
    const r = earningsLayer(e.x, NOW, 'g');
    assert.equal(r.state, 'level');
    assert.match(r.headline, /no earlier quarter on file/);
  });
  test('one result per company per window; out-of-window rows ignored', () => {
    const rows: GradedInput[] = [
      { ticker: 'A', tier: 'MIXED', filingDate: daysAgo(40) }, { ticker: 'A', tier: 'STRONG', filingDate: daysAgo(10) },
      { ticker: 'Z', tier: 'STRONG', filingDate: daysAgo(400) },
    ];
    const e = earningsFromGraded(rows, () => ['x'], ['x'], NOW);
    assert.deepEqual(e.x.reported, { recent: 1, prior: 0 });
    assert.equal(e.x.prints.length, 1);
  });
});

// ═══ 3. CATALYSTS ═══════════════════════════════════════════════════════════
describe('3 · catalysts — no default "steady"', () => {
  test('nothing counted → ○ no data, said as not negative', () => {
    const r = catalystLayer([], NOW, 14);
    assert.equal(r.state, 'unknown');
    assert.match(r.detail, /Unknown is not negative/);
  });
  test('last 14 days vs the 14 before', () => {
    const now2 = [...cats(3, 0, 1), ...cats(0, 0)];
    const before = cats(1, 0, 16);
    assert.equal(catalystLayer([...now2, ...before.map((c) => ({ ...c, ticker: 'P' }))], NOW, 14).state, 'improving');
    const quietNow = cats(3, 0, 16).map((c, i) => ({ ...c, ticker: `Q${i}` }));
    const r = catalystLayer([...quietNow, ...cats(0, 1, 2)], NOW, 14);
    assert.equal(r.state, 'weakening', r.headline);
    assert.match(r.headline, /in the 14 days before/);
  });
  test('same count in both windows is steady', () => {
    const a = cats(2, 0, 1), b = cats(2, 0, 16).map((c, i) => ({ ...c, ticker: `B${i}` }));
    assert.equal(catalystLayer([...a, ...b], NOW, 14).state, 'steady');
  });
  test('a feed that does not reach back 28 days gives a level, not a comparison', () => {
    const r = catalystLayer(cats(4, 0), NOW, 14, 5);
    assert.equal(r.state, 'level');
    assert.match(r.headline, /^Level only/);
    assert.match(r.detail, /reaches back 5 days/);
  });
});

// ═══ 4. EARLY ROTATION ══════════════════════════════════════════════════════
describe('4 · early rotation needs a real improvement plus a second confirmation', () => {
  const t = row({ id: 'in-fmcg', quadrant: 'Lagging', rsRatio: 97, rsMomentum: 99, aboveSMA50: false, ret: { w1: 0, m1: -1, m3: -3, m6: 0, ytd: 1, y1: 3 }, breadthStats: breadth(10, 6, 3, 4, 1, 0), flowStats: flow(1.1, 0.57, 0.48) });
  test('the FMCG artefact: level-only earnings + improving breadth → NO early rotation', () => {
    const e: EarningsInput = { source: 'bench', prints: strong(12, 5), priorCovered: false, market: { strong: { recent: 300, prior: 0 }, reported: null } };
    assert.equal(detectEarlyRotation(t, L(t, e)), null);
  });
  test('a real earnings improvement + breadth → early rotation, said as "price not confirmed yet"', () => {
    const e: EarningsInput = { source: 'graded', prints: strong(8, 5), reported: { recent: 20, prior: 20 }, priorCovered: true, market: null };
    const withPrior: EarningsInput = { ...e, prints: [...e.prints, ...strong(2, 100, 'P')] };
    const f = detectEarlyRotation(t, L(t, withPrior));
    assert.ok(f);
    assert.match(f!.why, /price has not confirmed yet/);
  });
  test('a real improvement alone (no second confirmation) is not enough', () => {
    const t2 = { ...t, breadthStats: breadth(10, 3, 3), flowStats: flow(1.0, 0.5, 0.5) };
    const e: EarningsInput = { source: 'graded', prints: [...strong(8, 5), ...strong(2, 100, 'P')], reported: { recent: 20, prior: 20 }, priorCovered: true, market: null };
    assert.equal(detectEarlyRotation(t2, L(t2, e)), null);
  });
  test('an improvement on fewer than 5 reporters is low confidence and does not count', () => {
    const e: EarningsInput = { source: 'graded', prints: [...strong(3, 5), ...strong(0, 100)], reported: { recent: 4, prior: 4 }, priorCovered: true, market: null };
    const Ls = L(t, e);
    assert.equal(Ls.earnings.lowConfidence, true);
    assert.equal(detectEarlyRotation(t, Ls), null);
  });
});

// ═══ 5. CROSS-THEME ROTATION ════════════════════════════════════════════════
describe('5 · rotation between themes', () => {
  const genomics = row({ id: 'us-genomics', name: 'Genomics', group: 'Healthcare', cluster: 3, ret: { w1: 2, m1: 6, m3: 12, m6: 10, ytd: 20, y1: 30 },
    trail: trail([100, 100.5, 101, 101.5, 102, 102.4, 102.8, 103], [102, 102, 101.8, 101.5, 101, 100.6, 100.4, 100.2]) });
  const innovation = row({ id: 'us-innovation', name: 'Disruptive Innovation', group: 'Frontier Tech', cluster: 3, ret: { w1: 3, m1: 9, m3: 15, m6: 10, ytd: 20, y1: 30 },
    trail: trail([100, 100.5, 101, 101.5, 102.5, 103.5, 104.5, 105.5], [99, 99, 99.5, 100, 101, 102, 103, 104]) });
  test('both themes rising is NOT a rotation (the owner\'s Genomics → Disruptive Innovation case)', () => {
    assert.equal(detectCrossFlows([genomics, innovation], () => []).length, 0);
  });
  test('source RS falling while destination RS rises, with a gap → a rotation, in plain words', () => {
    const src = { ...genomics, ret: { ...genomics.ret!, m1: -4 }, trail: trail([104, 104, 103.8, 103.5, 103, 102.2, 101.5, 100.8], [102, 102, 101.8, 101.5, 101, 100.2, 99.4, 98.6]) };
    const f = detectCrossFlows([src, innovation], () => ['SMALLCO (strong print 2026-08-20)']);
    assert.equal(f.length, 1);
    assert.equal(f[0].from, 'us-genomics');
    assert.ok((f[0].fromRsDelta ?? 0) < 0 && (f[0].toRsDelta ?? 0) > 0);
    assert.match(f[0].plain!, /losing ground against the market/);
    assert.match(f[0].plain!, /money shifting/);
  });
  test('next-in-line names are small / mid caps only', () => {
    const names = smallMidBeneficiaries([
      { ticker: 'TSLA' }, { ticker: 'COIN' }, { ticker: 'HOOD' },
      { ticker: 'SMALLCO', cap: 2500, strongPrint: '2026-08-20' },
      { ticker: 'BIGCO', cap: 45_000, strongPrint: '2026-09-01' },
      { ticker: 'MIDCO', onList: true },
    ], 'us');
    assert.deepEqual(names.map((n) => n.split(' ')[0]), ['SMALLCO', 'MIDCO']);
    assert.match(names[0], /strong print 2026-08-20/);
    assert.match(names[1], /size not on file/);
  });
  test('India cap threshold is ₹20,000 Cr', () => {
    const names = smallMidBeneficiaries([{ ticker: 'KIRLOSENG', cap: 15_000, strongPrint: '2026-08-10' }, { ticker: 'LT', strongPrint: '2026-08-11' }, { ticker: 'XYZ', cap: 35_000 }], 'india');
    assert.deepEqual(names.map((n) => n.split(' ')[0]), ['KIRLOSENG']);
  });
});

// ═══ 7. PRIORITY vs VERDICT ═════════════════════════════════════════════════
describe('7 · priority and verdict: explained, and coherent with the evidence', () => {
  test('"Research first" + AVOID is said out loud: fundamentals improving, price not confirming yet', () => {
    const r = relationLine('top', 'AVOID', ['earnings'], {} as any);
    assert.equal(r.agree, false);
    assert.match(r.text, /Fundamentals improving \(earnings\), price not confirming yet/);
    assert.match(r.text, /verdict stays AVOID/);
  });
  test('BUY on price alone is flagged as a price-only call', () => {
    const t = row({ id: 'hot', quadrant: 'Leading', rsSlope: 0.6, excess3m: 8, momDelta1w: 0.5, ret: { w1: 2, m1: 6, m3: 15, m6: 20, ytd: 25, y1: 40 }, breadthStats: null, flowStats: null });
    const a = assessTheme('hot', L(t, null, null), [], 'BUY');
    assert.equal(a.tier, 'monitor', 'price + relative strength alone stay at Monitor');
    assert.equal(a.relation.agree, false);
    assert.match(a.relation.text, /price-only call/);
    assert.match(a.evidenceLine, /earnings no data, catalysts no data/);
  });
  test('the same strong price with breadth confirming reaches "Worth a look"', () => {
    const t = row({ id: 'hot2', quadrant: 'Leading', rsSlope: 0.6, excess3m: 8, momDelta1w: 0.5, ret: { w1: 2, m1: 6, m3: 15, m6: 20, ytd: 25, y1: 40 }, breadthStats: breadth(10, 8, 5, 7, 3, 0), flowStats: null });
    const a = assessTheme('hot2', L(t, null, null), [], 'BUY');
    assert.equal(a.tier, 'look');
    assert.equal(a.relation.agree, true);
  });
  test('view model: every theme carries a relation and an evidence line; disagreements listed', () => {
    const p: Payload = { region: 'india', benchmark: { symbol: '^NSEI', name: 'NIFTY 50', price: 1, changePercent: 0 }, benchmarkRet: { w1: 0, m1: 1, m3: 3, m6: 5, ytd: 8, y1: 12 },
      themes: [row({ id: 'a', verdict: 'BUY', rsSlope: 0.6, excess3m: 5, momDelta1w: 0.4 })], rotatingIn: [], rotatingOut: [], topBuy: [], topAvoid: [], asOf: '' };
    const v = buildViewModel({ payload: p, now: NOW, earningsByTheme: null, benchLabel: 'b', catalystsByTheme: null, catalystWindowDays: 14, pesByTheme: {}, allPEs: [], snapshots: [], currentWeek: isoWeek(NOW), beneficiariesOf: () => [] });
    const t = v.byId.get('a')!;
    assert.ok(t.a.relation.text.length > 10);
    assert.ok(t.a.evidenceLine.length > 10);
    assert.deepEqual(v.summary.disagree, ['a']);
  });
});

// ═══ 8. SHORT-TERM BREAK ════════════════════════════════════════════════════
describe('8 · short-term break: sensible rule, says what triggered it', () => {
  test('1M −6.5% no longer trips it; −7% below the 20-day line does', () => {
    assert.equal(shortTermBreakRead(1.2, -6.5, false).hit, false);
    const r = shortTermBreakRead(-1, -9.4, false);
    assert.equal(r.hit, true);
    assert.match(r.why!, /1M -9\.4% \(1W -1\.0%\) and the price is below its 20-day line/);
  });
  test('a positive week back above the 20-day line clears it', () => {
    assert.equal(shortTermBreakRead(2.5, -8, true).hit, false);
  });
  test('the flag names its trigger, and explains a positive week inside the break', () => {
    const t = row({ id: 'g', ret: { w1: 1.1, m1: -9.2, m3: 14, m6: 20, ytd: 25, y1: 40 }, shortTermBreak: true, shortTermBreakWhy: '1M -9.2% (1W +1.1%) and the price is below its 20-day line.' });
    const f = detectShortTermBreak(t)!;
    assert.match(f.why, /^Triggered by: 1M -9\.2%/);
    assert.match(f.why, /a bounce inside the break/);
  });
  test('verdict note carries the trigger', () => {
    const v = verdictFor({ quadrant: 'Leading', aboveSMA50: true, w1: -4.8, m1: -13.5, m3: 18, y1: 40, aboveSMA20: false });
    assert.equal(v.verdict, 'HOLD');
    assert.match(v.note, /short-term break: 1M -13\.5%/);
    assert.equal(v.shortTermBreakWhy, '1M -13.5% (1W -4.8%) and the price is below its 20-day line.');
  });
});

// ═══ 9. FALLING LESS ════════════════════════════════════════════════════════
describe('9 · "Falling less" is explained', () => {
  test('label and why say "down less than the benchmark — defensive, not strength"', () => {
    const f = detectDefensive(row({ id: 'fmcg', fallingLeader: true, rsRatio: 103, excess3m: 5, ret: { w1: 0, m1: -1, m3: -4, m6: 0, ytd: 0, y1: 2 } }))!;
    assert.equal(f.label, 'Falling less (defensive)');
    assert.match(f.why, /down less than the benchmark — defensive, not strength/);
    assert.match(f.why, /-4\.0% over 3 months against the benchmark's -9\.0%/);
  });
});

// ═══ 10. SMALL BREADTH SAMPLES ══════════════════════════════════════════════
describe('10 · small breadth samples', () => {
  test('n < 5 shows the sample and is low confidence; it never counts as an improving layer', () => {
    const r = breadthLayer(breadth(4, 4, 1, 3, 1, 0));
    assert.equal(r.lowConfidence, true);
    assert.match(r.headline, /small sample, low confidence/);
    assert.match(r.detail, /Sample: 4 stocks/);
    const t = row({ id: 's', breadthStats: breadth(4, 4, 1, 3, 1, 0) });
    const a = assessTheme('s', L(t, null, null), []);
    assert.ok(!a.improving.includes('breadth'));
  });
  test('no month-ago reading → a level, not a direction', () => {
    assert.equal(breadthLayer(breadth(8, 6, null, 3, 2, 0)).state, 'level');
  });
  test('20- and 200-day participation is in the detail when present', () => {
    const r = breadthLayer({ ...breadth(10, 6, 5), above20: 7, above200: 4, n200: 9 });
    assert.match(r.detail, /7 of 10 above the 20-day line · 4 of 9 above the 200-day line/);
  });
});
