// zzz795 — Theme Rotation overhaul: layer calculators, detectors, ranking,
// history diff and the verdict fixes, stress-tested on realistic scenarios:
//   a broad rally · a narrow AI-led market · a risk-off India tape ·
//   a crowded melt-up (Memory-like) · an early turn (fundamentals up, price
//   flat) · a falling-knife gold-like case.
// Run: npx tsx --test src/lib/__tests__/zzz795-theme-engine.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { BreadthStats, EarningsInput, FlowStats, Payload, PrintInput, CatalystInput, ThemeRow, WeeklySnapshot } from '../theme-rotation/types';
import { breadthLayer, catalystLayer, earningsLayer, flowLayer, priceLayer, strengthLayer, valuationLayer, buildLayers } from '../theme-rotation/layers';
import { detectBreakdown, detectCrowding, detectCrossFlows, detectEarlyRotation, detectFlags } from '../theme-rotation/detectors';
import { assessTheme, rankAssessments } from '../theme-rotation/ranking';
import { verdictFor, isShortTermBreak } from '../theme-rotation/verdict';
import { buildViewModel, overlayFromView } from '../theme-rotation/view-model';
import { diffHistory, interimDiff, isoWeek, recentWeeks, sanitizeOverlay, trendFromSeries, mergeSnapshot, snapshotBytes, compactBase, SNAP_MAX_BYTES } from '../theme-rotation/history';
import { memberStat, aggregateBreadth, volumeFacts, aggregateFlow } from '../theme-rotation/series-metrics';

const NOW = new Date('2026-09-24T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

// ── fixture builders ───────────────────────────────────────────────────────
function trail(xs: number[], ys: number[]) { return xs.map((x, i) => ({ x, y: ys[i] })); }
function row(p: Partial<ThemeRow> & { id: string }): ThemeRow {
  return {
    name: p.id, emoji: '•', group: 'AI & Compute', proxy: null, members: [], ok: true,
    ret: { w1: 1, m1: 2, m3: 5, m6: 8, ytd: 10, y1: 15 },
    rsRatio: 100, rsMomentum: 100, quadrant: 'Leading', aboveSMA50: true, dist50: 3, rangePos: 70, vol: 25,
    rsSlope: 0, rsDelta1w: 0, momDelta1w: 0, trail: trail([99, 99.5, 100, 100.2, 100.4, 100.6, 100.8, 101], [100, 100, 100, 100, 100, 100, 100, 100]),
    ...p,
  } as ThemeRow;
}
const breadth = (n: number, above50: number, above50Prev: number | null, outperf = 0, newHighs = 0, newLows = 0): BreadthStats => ({ n, above50, above50Prev, outperf, newHighs, newLows });
const flow = (relVol: number, upShare: number, upSharePrev: number | null = null): FlowStats => ({ relVol, upShare, upSharePrev, basis: 'etf' });
const prints = (recent: number, prior: number, tier = 'STRONG'): PrintInput[] => [
  ...Array.from({ length: recent }, (_, i) => ({ ticker: `R${i}`, tier, filingDate: daysAgo(10 + i * 5), url: `https://example.com/r${i}` })),
  ...Array.from({ length: prior }, (_, i) => ({ ticker: `P${i}`, tier, filingDate: daysAgo(100 + i * 5) })),
];
const cats = (pos: number, neg: number): CatalystInput[] => [
  ...Array.from({ length: pos }, (_, i) => ({ ticker: `C${i}`, kind: 'order' as const, tone: 'pos' as const, title: 'Receipt of order worth Rs 120 crore', date: new Date(NOW.getTime() - (i + 1) * 86_400_000).toISOString(), url: `https://nse.example/${i}`, source: 'filing' as const })),
  ...Array.from({ length: neg }, (_, i) => ({ ticker: `N${i}`, kind: 'rating-down' as const, tone: 'neg' as const, title: 'Rating downgraded', date: new Date(NOW.getTime() - (i + 2) * 86_400_000).toISOString(), url: null, source: 'news' as const })),
];
// zzz797 — earnings are compared only when the earlier window is on file; these
// fixtures model a bench that covered both windows (20 strong prints in each).
const benchIn = (p: PrintInput[], covered = true): EarningsInput => ({ source: 'bench', prints: p, priorCovered: covered, market: { strong: { recent: 20, prior: 20 }, reported: null } });
function payload(themes: ThemeRow[], extra: Partial<Payload> = {}): Payload {
  return {
    region: 'us', benchmark: { symbol: 'SPY', name: 'S&P 500', price: 600, changePercent: 0.2 },
    benchmarkRet: { w1: 0.5, m1: 1.5, m3: 4, m6: 7, ytd: 12, y1: 18 },
    themes, rotatingIn: [], rotatingOut: [], topBuy: [], topAvoid: [], asOf: NOW.toISOString(),
    breadth: { themes: themes.length, above50: themes.filter((t) => t.aboveSMA50).length, pctAbove50: 50, newHigh: 1, newLow: 1, regime: 'mixed', regimeScore: 0, note: '' },
    ...extra,
  };
}
function vm(themes: ThemeRow[], opts: { prints?: Record<string, PrintInput[]> | null; cats?: Record<string, CatalystInput[]> | null; snaps?: WeeklySnapshot[]; pay?: Partial<Payload> } = {}) {
  return buildViewModel({
    payload: payload(themes, opts.pay), now: NOW,
    earningsByTheme: opts.prints === undefined ? {} : opts.prints === null ? null : Object.fromEntries(Object.entries(opts.prints).map(([k, p]) => [k, benchIn(p)])), benchLabel: 'Conviction bench (US)',
    catalystsByTheme: opts.cats === undefined ? {} : opts.cats, catalystWindowDays: 14,
    pesByTheme: {}, allPEs: [], snapshots: opts.snaps || [], currentWeek: isoWeek(NOW),
    beneficiariesOf: (id) => [`${id}-leader`],
  });
}
const L = (t: ThemeRow, p: PrintInput[] | null = [], c: CatalystInput[] | null = []) => buildLayers(t, {
  benchName: 'S&P 500', benchRet: { w1: 0.5, m1: 1.5, m3: 4, m6: 7, ytd: 12, y1: 18 }, earnings: p == null ? null : benchIn(p), benchLabel: 'bench', catalysts: c, catalystWindowDays: 14, themePEs: [], allPEs: [], now: NOW,
});

// ═══ VERDICT FIXES ══════════════════════════════════════════════════════════
describe('verdict — the owner vocabulary with its reasons', () => {
  test('Gold-Miners case: strong 3M RS no longer masks a short-term breakdown', () => {
    const v = verdictFor({ quadrant: 'Leading', aboveSMA50: true, w1: -4.8, m1: -13.5, m3: 18, y1: 40, dd1y: -14 });
    assert.equal(v.verdict, 'HOLD');
    assert.equal(v.shortTermBreak, true);
    assert.match(v.note, /short-term break/i);
    assert.match(v.note, /-13\.5%/);
  });
  test('a clean leader is still a BUY', () => {
    assert.equal(verdictFor({ quadrant: 'Leading', aboveSMA50: true, w1: 1.2, m1: 4, m3: 12, y1: 30 }).verdict, 'BUY');
  });
  test('Memory case: +394% 1Y leader pulling back below its 50-DMA is HOLD, not TRIM', () => {
    const v = verdictFor({ quadrant: 'Weakening', aboveSMA50: false, w1: -2, m1: -3, m3: 14, y1: 394, dd1y: -12 });
    assert.equal(v.verdict, 'HOLD');
    assert.match(v.note, /not a sell signal/);
  });
  test('TRIM still fires when price damage is confirmed on both tests', () => {
    assert.equal(verdictFor({ quadrant: 'Weakening', aboveSMA50: false, w1: -2, m1: -6, m3: -5, y1: 394, dd1y: -30 }).verdict, 'TRIM');
  });
  test('EARLY BUY is blocked by a short-term break too', () => {
    assert.equal(verdictFor({ quadrant: 'Improving', aboveSMA50: true, w1: -4, m1: 0.5, m3: -2 }).verdict, 'EARLY BUY');
    assert.notEqual(verdictFor({ quadrant: 'Improving', aboveSMA50: true, w1: -4, m1: -7, m3: -2 }).verdict, 'EARLY BUY');
  });
  test('short-term break thresholds (zzz797: 1M ≤ −7%, or 1W ≤ −4% with 1M ≤ −3%, while below the 20-day line)', () => {
    assert.equal(isShortTermBreak(-1, -7), true);
    assert.equal(isShortTermBreak(-1, -6), false);
    assert.equal(isShortTermBreak(-3.5, -0.5), false);
    assert.equal(isShortTermBreak(-4.5, -3.5, false), true);
    assert.equal(isShortTermBreak(1, -8, true), false, 'bounced back above the 20-day line');
    assert.equal(isShortTermBreak(1, -8, false), true, 'a positive week inside the break');
    assert.equal(isShortTermBreak(-2, -4), false);
    assert.equal(isShortTermBreak(null, null), false);
  });
});

// ═══ SERIES METRICS ═════════════════════════════════════════════════════════
describe('series metrics — breadth and the volume proxy', () => {
  const up = Array.from({ length: 260 }, (_, i) => 100 + i * 0.5);
  const down = Array.from({ length: 260 }, (_, i) => 230 - i * 0.5);
  test('memberStat reads 50-DMA now and a month ago, and highs/lows', () => {
    const a = memberStat({ closes: up });
    assert.equal(a.above50, true); assert.equal(a.above50Prev, true); assert.equal(a.nearHigh, true); assert.equal(a.nearLow, false);
    const b = memberStat({ closes: down });
    assert.equal(b.above50, false); assert.equal(b.nearLow, true);
  });
  test('too-short series say "unknown" rather than guess', () => {
    const s = memberStat({ closes: [1, 2, 3] });
    assert.equal(s.above50, null); assert.equal(s.m3, null); assert.equal(s.nearHigh, null);
    assert.equal(aggregateBreadth([s], 4), null);
  });
  test('aggregateBreadth counts outperformers against the benchmark', () => {
    const b = aggregateBreadth([memberStat({ closes: up }), memberStat({ closes: up }), memberStat({ closes: down })], 4)!;
    assert.equal(b.n, 3); assert.equal(b.above50, 2); assert.equal(b.outperf, 2); assert.equal(b.newLows, 1);
  });
  test('volumeFacts: accumulation vs distribution, and no volume → null', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + (i % 2 === 0 ? i * 0.3 : i * 0.3 - 0.1));
    const vols = closes.map((_, i) => (i >= 100 ? (i % 2 === 0 ? 300 : 100) : 100));
    const f = volumeFacts({ closes, volumes: vols });
    assert.ok(f.relVol != null && f.relVol > 1.5, `relVol ${f.relVol}`);
    assert.ok(f.upShare != null && f.upShare > 0.6, `upShare ${f.upShare}`);
    assert.equal(volumeFacts({ closes, volumes: closes.map(() => 0) }).relVol, null);
    assert.equal(aggregateFlow(null, []).basis, 'none');
  });
});

// ═══ LAYERS ═════════════════════════════════════════════════════════════════
describe('layer calculators — separate, honest, unknown ≠ negative', () => {
  test('strength: level and direction are separate', () => {
    const r = strengthLayer(row({ id: 'a', rsRatio: 104, excess3m: 9, rsSlope: -0.6 }), 'S&P 500');
    assert.equal(r.level, 'strong'); assert.equal(r.state, 'weakening');
    assert.match(r.headline, /Ahead of S&P 500 by 9\.0 pts/);
  });
  test('breadth: counts in words, month-ago comparison, too few → unknown', () => {
    const r = breadthLayer(breadth(10, 7, 4, 6, 2, 0));
    assert.equal(r.state, 'improving'); assert.match(r.headline, /7 of 10 stocks above their 50-day line \(4 a month ago\)/);
    assert.equal(breadthLayer(breadth(2, 2, 1)).state, 'unknown');
    assert.equal(breadthLayer(null).state, 'unknown');
    assert.equal(breadthLayer(breadth(10, 3, 7, 1, 0, 3)).state, 'weakening');
  });
  test('flow is always labelled a proxy', () => {
    const r = flowLayer(flow(1.4, 0.64, 0.5));
    assert.equal(r.state, 'improving'); assert.equal(r.proxy, true); assert.match(r.detail, /not fund-flow data/);
    assert.equal(flowLayer(flow(1.3, 0.38)).state, 'weakening');
    const none = flowLayer({ relVol: null, upShare: null, upSharePrev: null, basis: 'none' });
    assert.equal(none.state, 'unknown'); assert.equal(none.proxy, true);
  });
  test('earnings: quarter-on-quarter count of strong prints; bench missing → unknown', () => {
    assert.equal(earningsLayer(benchIn(prints(4, 1)), NOW, 'b').state, 'improving');
    assert.equal(earningsLayer(benchIn(prints(0, 3)), NOW, 'b').state, 'weakening');
    assert.equal(earningsLayer(benchIn(prints(2, 2)), NOW, 'b').state, 'steady');
    assert.equal(earningsLayer(null, NOW, 'b').state, 'unknown');
    const none = earningsLayer(benchIn([]), NOW, 'b');
    assert.equal(none.state, 'unknown'); assert.match(none.detail, /Unknown is not negative/);
    assert.equal(earningsLayer(benchIn(prints(3, 0)), NOW, 'b').evidence?.length, 3);
  });
  test('catalysts: positive vs negative dated items; nothing counted is no data (zzz797); no feed is unknown', () => {
    const r = catalystLayer(cats(3, 0), NOW, 14);
    assert.equal(r.state, 'improving'); assert.match(r.headline, /3 order wins in the last 14 days/);
    assert.ok(r.evidence?.every((e) => e.date));
    assert.equal(catalystLayer(cats(0, 3), NOW, 14).state, 'weakening');
    assert.equal(catalystLayer([], NOW, 14).state, 'unknown');
    assert.equal(catalystLayer(null, NOW, 14).state, 'unknown');
  });
  test('valuation never claims a direction and needs a real field', () => {
    assert.equal(valuationLayer([30], [20, 21, 22, 23, 24]).state, 'unknown');
    assert.match(valuationLayer([30], []).headline, /Not available/);
    const r = valuationLayer([40, 44, 50], [20, 22, 25, 28, 30, 45]);
    assert.equal(r.state, 'unknown'); assert.equal(r.level, 'weak'); assert.match(r.detail, /level only/);
  });
  test('price layer: a falling month is weakening even with a strong 3M', () => {
    const r = priceLayer(row({ id: 'g', ret: { w1: -4.8, m1: -13.5, m3: 18, m6: 20, ytd: 25, y1: 40 }, aboveSMA50: true, shortTermBreak: true }));
    assert.equal(r.state, 'weakening'); assert.equal(r.level, 'strong');
  });
});

// ═══ SCENARIOS ══════════════════════════════════════════════════════════════
describe('scenario: broad rally', () => {
  const themes = ['semis', 'software', 'industrials', 'banks', 'energy'].map((id, i) => row({
    id, quadrant: 'Leading', rsRatio: 102 + i * 0.2, rsMomentum: 101, rsSlope: 0.5, excess3m: 4,
    breadthStats: breadth(10, 8, 5, 7, 3, 0), flowStats: flow(1.2, 0.6, 0.52), momDelta1w: 0.3,
    ret: { w1: 1.5, m1: 5, m3: 10, m6: 15, ytd: 20, y1: 25 },
  }));
  const pr = Object.fromEntries(themes.map((t) => [t.id, prints(3, 1)]));
  const v = vm(themes, { prints: pr, pay: { breadth: { themes: 5, above50: 5, pctAbove50: 100, newHigh: 4, newLow: 0, regime: 'risk-on', regimeScore: 1.5, note: '' } } });
  test('multiple independent layers improving → Research first, with reasons', () => {
    for (const t of v.themes) {
      assert.equal(t.a.tier, 'top', t.row.id);
      assert.match(t.a.why, /strong prints/);
    }
    assert.equal(v.summary.regime, 'risk-on');
    assert.equal(v.summary.breakdown.length, 0);
  });
});

describe('scenario: narrow AI-led market', () => {
  const ai = row({
    id: 'ai', name: 'AI Hardware', quadrant: 'Leading', rsRatio: 108, rsMomentum: 99, momDelta1w: -0.8, dist50: 22, vol: 45,
    ret: { w1: 1, m1: 6, m3: 30, m6: 60, ytd: 80, y1: 140 }, rangePos: 96, breadthStats: breadth(10, 5, 8, 4, 2, 0), flowStats: flow(1.1, 0.52, 0.6),
  });
  const rest = ['staples', 'utilities', 'retail', 'banks'].map((id) => row({
    id, quadrant: 'Lagging', rsRatio: 97, rsMomentum: 98, aboveSMA50: false, rsSlope: -0.4, excess3m: -6,
    ret: { w1: -1, m1: -3, m3: -4, m6: -2, ytd: 0, y1: 2 }, breadthStats: breadth(10, 3, 5, 2, 0, 2), flowStats: flow(1.0, 0.46, 0.5),
  }));
  const v = vm([ai, ...rest]);
  test('the leader is flagged crowded, not labelled a sell, and ranks by evidence', () => {
    const a = v.byId.get('ai')!;
    assert.ok(a.a.flags.some((f) => f.kind === 'crowded'), JSON.stringify(a.a.flags));
    assert.notEqual(a.a.tier, 'low');
    assert.match(a.a.flags.find((f) => f.kind === 'crowded')!.why, /not a sell call/);
  });
  test('the laggards are low priority / breakdown, and nobody is "Research first" on price alone', () => {
    for (const id of ['staples', 'utilities', 'retail', 'banks']) assert.equal(v.byId.get(id)!.a.tier, 'low', id);
    assert.equal(v.summary.tierCounts.top, 0);
  });
});

describe('scenario: risk-off India tape', () => {
  const t = [
    row({ id: 'in-psubank', group: 'Financials & Rate-sensitive', quadrant: 'Lagging', aboveSMA50: false, rsRatio: 96, rsMomentum: 97, ret: { w1: -3, m1: -9, m3: -14, m6: -10, ytd: -12, y1: -5 }, breadthStats: breadth(5, 0, 3, 0, 0, 3), flowStats: flow(1.5, 0.35, 0.5) }),
    row({ id: 'in-realty', group: 'Financials & Rate-sensitive', quadrant: 'Weakening', aboveSMA50: false, rsRatio: 101, rsMomentum: 97, ret: { w1: -2, m1: -7, m3: -3, m6: 5, ytd: 2, y1: 10 }, breadthStats: breadth(5, 1, 4, 1, 0, 2) }),
    row({ id: 'in-fmcg', group: 'Healthcare & Consumer', quadrant: 'Leading', fallingLeader: true, aboveSMA50: false, rsRatio: 103, rsMomentum: 101, ret: { w1: -0.5, m1: -1, m3: -2, m6: 1, ytd: 3, y1: 6 }, breadthStats: breadth(5, 2, 2, 4, 0, 0) }),
    row({ id: 'in-metal', group: 'Energy & Materials', quadrant: 'Lagging', aboveSMA50: false, rsRatio: 95, rsMomentum: 96, ret: { w1: -2, m1: -12, m3: -9, m6: -6, ytd: -8, y1: -2 }, breadthStats: null }),
  ];
  const v = vm(t, { pay: { region: 'india', benchmark: { symbol: '^NSEI', name: 'NIFTY 50', price: 24000, changePercent: -1.2 }, breadth: { themes: 4, above50: 0, pctAbove50: 0, newHigh: 0, newLow: 3, regime: 'risk-off', regimeScore: -1.8, note: '' } } });
  test('collapsing participation is a breakdown; price-only breakdown is labelled as such', () => {
    assert.ok(v.summary.breakdown.includes('in-psubank'));
    assert.ok(v.summary.breakdown.includes('in-realty'));
    const metal = v.byId.get('in-metal')!.a.flags.find((f) => f.kind === 'breakdown');
    assert.ok(metal && /price only/i.test(metal.label));
  });
  test('the "leader" that is merely falling less is flagged defensive', () => {
    assert.ok(v.byId.get('in-fmcg')!.a.flags.some((f) => f.kind === 'defensive'));
  });
  test('breakdowns rank last; regime reads risk-off', () => {
    assert.equal(v.summary.regime, 'risk-off');
    assert.equal(v.themes[v.themes.length - 1].a.tier, 'low');
  });
});

describe('scenario: crowded melt-up (Memory-like)', () => {
  const mem = row({
    id: 'us-memory', name: 'Memory', quadrant: 'Weakening', rsRatio: 104, rsMomentum: 98.5, momDelta1w: -1.1, aboveSMA50: true,
    dist50: 28, vol: 55, rangePos: 97, ret: { w1: 2, m1: 9, m3: 60, m6: 150, ytd: 250, y1: 394 },
    breadthStats: breadth(6, 4, 6, 5, 3, 0), flowStats: flow(1.3, 0.51, 0.62),
  });
  const Ls = L(mem, prints(3, 2));
  test('crowding is its own flag, with the late-cycle signs spelled out', () => {
    const c = detectCrowding(mem, Ls, 18);
    assert.ok(c);
    assert.match(c!.why, /\+28% above its 50-day line/);
    assert.match(c!.why, /\+394% over 1 year/);
    assert.match(c!.why, /fewer stocks carrying it/);
    assert.match(c!.why, /relative momentum rolling over/);
  });
  test('the server verdict does not turn crowding into TRIM', () => {
    assert.notEqual(verdictFor({ quadrant: 'Weakening', aboveSMA50: true, w1: 2, m1: 9, m3: 60, y1: 394, dd1y: -3 }).verdict, 'TRIM');
  });
  test('a merely strong theme is not called crowded', () => {
    assert.equal(detectCrowding(row({ id: 'x', dist50: 6, ret: { w1: 1, m1: 3, m3: 9, m6: 12, ytd: 15, y1: 30 } }), L(row({ id: 'x' })), 18), null);
  });
});

describe('scenario: early turn — fundamentals up, price flat', () => {
  const t = row({
    id: 'in-capgoods', quadrant: 'Lagging', rsRatio: 98, rsMomentum: 99.2, aboveSMA50: false, dist50: -1, rsSlope: 0.1,
    ret: { w1: 0.3, m1: -0.4, m3: -2, m6: 1, ytd: 2, y1: 5 }, breadthStats: breadth(8, 4, 2, 3, 1, 0), flowStats: flow(1.1, 0.56, 0.47),
  });
  const Ls = L(t, prints(4, 1), cats(3, 0));
  test('early rotation fires with the fundamentals named', () => {
    const f = detectEarlyRotation(t, Ls);
    assert.ok(f);
    assert.match(f!.why, /strong prints/);
    assert.match(f!.why, /order wins/);
    assert.match(f!.why, /still lagging/);
  });
  test('it is ranked "Research first" even though its price change is flat', () => {
    const hot = row({ id: 'hot', quadrant: 'Leading', rsRatio: 106, rsMomentum: 103, ret: { w1: 4, m1: 18, m3: 40, m6: 50, ytd: 60, y1: 70 }, breadthStats: null, flowStats: null, rsSlope: 0.1 });
    const v = vm([hot, t], { prints: { 'in-capgoods': prints(4, 1) }, cats: { 'in-capgoods': cats(3, 0) } });
    assert.equal(v.themes[0].row.id, 'in-capgoods');
    assert.equal(v.byId.get('in-capgoods')!.a.tier, 'top');
    assert.notEqual(v.byId.get('hot')!.a.tier, 'top', 'price alone cannot reach the top tier');
  });
  test('without fundamental evidence there is no early-rotation call', () => {
    assert.equal(detectEarlyRotation(t, L(t, [], [])), null);
  });
});

describe('scenario: falling knife (gold-like)', () => {
  const g = row({
    id: 'us-gold', name: 'Gold Miners', quadrant: 'Leading', rsRatio: 105, rsMomentum: 100.5, aboveSMA50: true, dist50: 1,
    ret: { w1: -4.8, m1: -13.5, m3: 18, m6: 35, ytd: 50, y1: 60 }, shortTermBreak: true, momDelta1w: -1.4,
    breadthStats: breadth(6, 3, 6, 4, 0, 0), flowStats: flow(1.6, 0.38, 0.6),
  });
  const Ls = L(g);
  test('short-term break flagged, price and flow weakening, not "Research first"', () => {
    const flags = detectFlags(g, Ls, 18);
    assert.ok(flags.some((f) => f.kind === 'short-term-break'));
    assert.equal(Ls.price.state, 'weakening');
    assert.equal(Ls.flow.state, 'weakening');
    const a = assessTheme('us-gold', Ls, flags);
    assert.notEqual(a.tier, 'top');
    assert.match(a.why, /short-term break/);
  });
  test('when participation collapses below the 50-DMA it becomes a breakdown', () => {
    const g2 = { ...g, aboveSMA50: false, breadthStats: breadth(6, 1, 5, 1, 0, 2) };
    assert.ok(detectBreakdown(g2, L(g2)));
  });
});

// ═══ RANKING ════════════════════════════════════════════════════════════════
describe('ranking — by evidence, not by % change', () => {
  test('unknown layers never lower a tier', () => {
    const t = row({ id: 'u', rsRatio: 103, excess3m: 5, rsSlope: 0.4, breadthStats: breadth(8, 6, 4, 5, 2, 0) });
    const withUnknown = assessTheme('u', L(t, null, null), []);
    const withEmpty = assessTheme('u', L(t, [], []), []);
    assert.equal(withUnknown.tier, withEmpty.tier);
  });
  test('rank order: tier first, then hidden score', () => {
    const xs = rankAssessments([
      { id: 'a', tier: 'look' as const, sortKey: 9 }, { id: 'b', tier: 'top' as const, sortKey: 1 }, { id: 'c', tier: 'look' as const, sortKey: 12 },
    ]);
    assert.deepEqual(xs.map((x) => x.id), ['b', 'c', 'a']);
  });
  test('no visible 0–100 score in the Why line', () => {
    const t = row({ id: 'w', breadthStats: breadth(10, 7, 4, 6, 2, 0) });
    const a = assessTheme('w', L(t, prints(3, 1), cats(2, 0)), []);
    assert.doesNotMatch(a.why, /\b(score|conv(iction)?)\b/i);
  });
});

// ═══ CROSS-THEME FLOW ═══════════════════════════════════════════════════════
describe('cross-theme flow', () => {
  // zzz797 — a rotation also needs the destination to beat the source over the month.
  const from = row({ id: 'semis', group: 'AI & Compute', cluster: 1, ret: { w1: -1, m1: -3, m3: 4, m6: 8, ytd: 10, y1: 15 }, trail: trail([106, 106, 105.5, 105, 104, 103, 102, 101], [103, 103, 102.5, 102, 101, 100, 99, 98.5]) });
  const to = row({ id: 'photonics', group: 'AI & Compute', cluster: 1, ret: { w1: 2, m1: 6, m3: 9, m6: 8, ytd: 10, y1: 15 }, trail: trail([97, 97, 97.2, 97.5, 98, 99, 100, 101], [98, 98, 98.5, 99, 100.5, 101.5, 102.5, 103.5]) });
  const unrelated = row({ id: 'gold', group: 'Energy & Resources', cluster: 7, trail: trail([97, 97, 97.2, 97.5, 98, 99, 100, 101], [98, 98, 98.5, 99, 100.5, 101.5, 102.5, 104]) });
  test('related pair detected with second-order beneficiaries', () => {
    const f = detectCrossFlows([from, to, unrelated], (id) => (id === 'photonics' ? ['COHR', 'LITE'] : []));
    assert.equal(f.length, 1);
    assert.equal(f[0].from, 'semis'); assert.equal(f[0].to, 'photonics');
    assert.deepEqual(f[0].beneficiaries, ['COHR', 'LITE']);
    assert.match(f[0].why, /not fund-flow data/);
  });
  test('unrelated themes are not called a rotation', () => {
    const f = detectCrossFlows([from, unrelated], () => []);
    assert.equal(f.length, 0);
  });
});

// ═══ HISTORY ════════════════════════════════════════════════════════════════
describe('history — weekly snapshots and the diff', () => {
  test('ISO weeks', () => {
    assert.equal(isoWeek(new Date('2026-09-24T00:00:00Z')), '2026-W39');
    assert.equal(isoWeek(new Date('2021-01-03T00:00:00Z')), '2020-W53');
    assert.equal(recentWeeks(NOW, 3).length, 3);
  });
  test('trend words: accelerating / continuing / reversing / flat', () => {
    assert.equal(trendFromSeries([100, 101, 103]).word, 'accelerating');
    assert.equal(trendFromSeries([100, 102, 103.2]).word, 'continuing');
    assert.equal(trendFromSeries([100, 102, 101]).word, 'reversing');
    assert.equal(trendFromSeries([100, 100.1, 100.2]).word, 'flat');
    assert.equal(trendFromSeries([100]).word, 'unknown');
  });
  test('no stored weeks → says so and uses the RRG tail', () => {
    const d = diffHistory('2026-W39', { a: { tier: 'top' } }, [], [row({ id: 'a', quadrantMove: { from: 'Improving', to: 'Leading', dir: 'upgrade' } })]);
    assert.equal(d.available, false);
    assert.match(d.note, /History starts this week/);
    assert.deepEqual(d.newEntrants, ['a']);
  });
  test('stored weeks → new entrants, risers, fallers, persistent leaders, fading', () => {
    const snaps: WeeklySnapshot[] = [
      { week: '2026-W36', market: 'us', overlay: { lead: { t: 'top' }, fade: { t: 'top' } } },
      { week: '2026-W37', market: 'us', overlay: { lead: { t: 'top' }, fade: { t: 'look' }, up: { t: 'monitor' } } },
      { week: '2026-W38', market: 'us', overlay: { lead: { t: 'top' }, fade: { t: 'look' }, up: { t: 'monitor' }, down: { t: 'look' }, fresh: { t: 'low' } } },
      { week: '2026-W39', market: 'us', overlay: { lead: { t: 'low' } } }, // current week: ignored
    ];
    const cur = { lead: { tier: 'top' as const }, fade: { tier: 'monitor' as const }, up: { tier: 'look' as const }, down: { tier: 'low' as const }, fresh: { tier: 'top' as const } };
    const d = diffHistory('2026-W39', cur, snaps, []);
    assert.equal(d.available, true); assert.equal(d.previousWeek, '2026-W38');
    assert.deepEqual(d.persistentLeaders, ['lead']);
    assert.ok(d.newEntrants.includes('up') && d.newEntrants.includes('fresh'));
    assert.ok(d.falling.includes('down') && d.falling.includes('fade'));
    assert.ok(d.fading.includes('fade'));
  });
  test('a week with only the server base compares verdicts on both sides', () => {
    const snaps: WeeklySnapshot[] = [{ week: '2026-W38', market: 'us', base: { x: { v: 'AVOID' }, y: { v: 'AVOID' } } }];
    const d = diffHistory('2026-W39', { x: { tier: 'top', verdict: 'BUY' }, y: { tier: 'top', verdict: 'AVOID' } }, snaps, []);
    assert.ok(d.newEntrants.includes('x'), 'AVOID → BUY is a real change');
    assert.ok(!d.newEntrants.includes('y') && !d.rising.includes('y'), 'a richer read this week is not a change');
    assert.match(d.note, /uses the verdicts/);
  });
  test('overlay sanitising rejects junk and unknown themes', () => {
    const o = sanitizeOverlay({ 'us-semis': { t: 'top', r: 1, e: 3, c: 2, f: ['crowded', 'nope'] }, 'bad id!': { t: 'top' }, 'us-x': { t: 'weird', r: -4 } }, new Set(['us-semis', 'us-x']));
    assert.deepEqual(o, { 'us-semis': { t: 'top', r: 1, e: 3, c: 2, f: ['crowded'] }, 'us-x': {} });
    assert.equal(sanitizeOverlay('nope', null), null);
  });
  test('a full snapshot stays far under the 900 KB cap', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row({ id: `t-${i}`, verdict: 'BUY', breadthStats: breadth(12, 6, 5, 4, 1, 1) }));
    const s = mergeSnapshot(null, { week: '2026-W39', market: 'us', base: compactBase(rows) }, NOW.toISOString());
    const v = buildViewModel({ payload: payload(rows), now: NOW, printsByTheme: {}, benchLabel: 'b', catalystsByTheme: {}, catalystWindowDays: 14, pesByTheme: {}, allPEs: [], snapshots: [], currentWeek: '2026-W39', beneficiariesOf: () => [] });
    const s2 = mergeSnapshot(s, { week: '2026-W39', market: 'us', overlay: overlayFromView(v) as any }, NOW.toISOString());
    assert.ok(s2.base && s2.overlay);
    assert.ok(snapshotBytes(s2) < SNAP_MAX_BYTES / 20, `bytes ${snapshotBytes(s2)}`);
  });
  test('interim diff finds persistent leaders and fading themes from the tail', () => {
    const lead = row({ id: 'lead', trail: trail([101, 101, 102, 102, 103, 103, 104, 104], [101, 101, 101, 101, 101, 101, 101, 101]) });
    const fade = row({ id: 'fade', quadrant: 'Weakening', trail: trail([101, 102, 103, 103, 102, 101, 100.5, 100.2], [101, 101, 101, 101, 100.5, 99.5, 99, 98.5]) });
    const d = interimDiff([lead, fade], '2026-W39');
    assert.deepEqual(d.persistentLeaders, ['lead']);
    assert.deepEqual(d.fading, ['fade']);
  });
});

describe('empty and degraded inputs', () => {
  test('an empty board renders a valid, empty view model', () => {
    const v = vm([]);
    assert.equal(v.themes.length, 0);
    assert.equal(v.flows.length, 0);
    assert.equal(v.summary.tierCounts.top, 0);
  });
  test('an older cached payload (no breadth/flow fields) still assesses, with unknowns', () => {
    const old = row({ id: 'old' }); delete (old as any).breadthStats; delete (old as any).flowStats;
    const v = vm([old], { prints: null, cats: null });
    const t = v.byId.get('old')!;
    assert.equal(t.a.layers.breadth.state, 'unknown');
    assert.equal(t.a.layers.flow.state, 'unknown');
    assert.equal(t.a.layers.earnings.state, 'unknown');
    assert.match(t.a.why, /layers have data/);
  });
  test('failed rows (ok:false) are excluded, not crashed on', () => {
    const v = vm([{ id: 'dead', name: 'Dead', emoji: '', group: '', proxy: null, members: [], ok: false } as ThemeRow, row({ id: 'alive' })]);
    assert.deepEqual(v.themes.map((t) => t.row.id), ['alive']);
  });
});
