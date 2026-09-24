// zzz797 — Theme Rotation: holdings classification (issue 6) and the new
// analytics (breadth heatmap, leaders / laggards small-mid only, clusters,
// your exposure, weekly change log, RS sparkline data), the new route modes,
// and the new UI panels' data / empty states.
// Run: npx tsx --test src/lib/__tests__/zzz797-theme-analytics.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { classifyThemeDetailed, sicTheme } from '../theme-classify';
import { sizeClass, isKnownLargeCap } from '../theme-universe';
import { buildListEntries, holdingsExposure, isCashLine, unmatchedReason } from '../theme-rotation/lists';
import { clusterGroups, exposureModel, heatmapRows, leadersLaggards } from '../theme-rotation/analytics';
import { changeLog } from '../theme-rotation/history';
import { memberStat, aggregateBreadth } from '../theme-rotation/series-metrics';
import { buildViewModel } from '../theme-rotation/view-model';
import { sortViews } from '../theme-rotation/table';
import type { Payload, ThemeRow, WeeklySnapshot } from '../theme-rotation/types';
import { GET } from '../../app/api/market/theme-rotation/route';
import { BreadthHeatmap, ChangeLogPanel, ClusterPanel, ExposurePanel } from '../../components/dashboard/theme-rotation/AnalyticsPanels';
import { EvidencePanel } from '../../components/dashboard/theme-rotation/EvidencePanel';
import { ThemeTable } from '../../components/dashboard/theme-rotation/ThemeTable';
import { Sparkline } from '../../components/dashboard/theme-rotation/ui';
import { emptyFilter } from '../theme-rotation/table';

(globalThis as any).React = React;
const h = React.createElement;
const text = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
const NOW = new Date('2026-09-24T12:00:00Z');
const noop = () => {};

function row(id: string, p: Partial<ThemeRow> = {}): ThemeRow {
  return { id, name: id, emoji: '•', group: 'G', proxy: null, members: [], ok: true, rsRatio: 101, rsMomentum: 100.5, quadrant: 'Leading', aboveSMA50: true,
    ret: { w1: 1, m1: 3, m3: 8, m6: 10, ytd: 12, y1: 20 }, trail: [{ x: 100, y: 100 }], verdict: 'BUY', ...p } as ThemeRow;
}
const payload = (themes: ThemeRow[], extra: Partial<Payload> = {}): Payload => ({ region: 'us', benchmark: { symbol: 'SPY', name: 'S&P 500', price: 1, changePercent: 0 }, benchmarkRet: { w1: 0, m1: 1, m3: 3, m6: 5, ytd: 8, y1: 15 },
  themes, rotatingIn: [], rotatingOut: [], topBuy: [], topAvoid: [], asOf: '', ...extra });
const vmOf = (themes: ThemeRow[], extra: Partial<Payload> = {}) => buildViewModel({ payload: payload(themes, extra), now: NOW, earningsByTheme: null, benchLabel: 'b', catalystsByTheme: null, catalystWindowDays: 14, pesByTheme: {}, allPEs: [], snapshots: [], currentWeek: '2026-W39', beneficiariesOf: () => [] });

// ═══ 6. HOLDINGS CLASSIFICATION ═════════════════════════════════════════════
describe('6 · US holdings placed by SEC industry code; cash / non-US lines left out', () => {
  test('SIC codes map to themes; codes with no theme stay unplaced', () => {
    assert.equal(sicTheme('3674'), 'us-semis');
    assert.equal(sicTheme(7372), 'us-software');
    assert.equal(sicTheme('2834'), 'us-biotech');
    assert.equal(sicTheme('6022'), 'us-regbanks');
    assert.equal(sicTheme('1311'), 'us-energy');
    assert.equal(sicTheme('3576'), 'us-cloud');
    assert.equal(sicTheme('3812'), 'us-defense');
    assert.equal(sicTheme('6311'), null, 'insurance has no theme on the board');
    assert.equal(sicTheme(null), null);
  });
  test('a held name with no sector is placed by its SEC profile, marked as such', () => {
    const c = classifyThemeDetailed(null, null, 'us', 'ACME', null, { sic: '3674', description: 'SEMICONDUCTORS & RELATED DEVICES' });
    assert.deepEqual(c, { theme: 'us-semis', via: 'sec-industry' });
    const d = classifyThemeDetailed(null, null, 'us', 'ACME2', null, { sic: null, description: 'SERVICES-PREPACKAGED SOFTWARE' });
    assert.equal(d?.theme, 'us-software');
    assert.equal(classifyThemeDetailed(null, null, 'us', 'PLUG', null, { sic: '3674' })?.via, 'override', 'curated override still wins');
  });
  test('cash lines are recognised', () => {
    for (const t of ['USD', 'EUR', 'CASH', 'BASE', 'USD.CASH']) assert.equal(isCashLine(t), true, t);
    for (const t of ['CASY', 'NVDA', 'USDP']) assert.equal(isCashLine(t), false, t);
  });
  test('holdings exposure leaves out cash and non-US lines, and lists the unmatched', () => {
    const classify = (e: any) => (e.ticker === 'NVDA' ? { theme: 'us-semis', via: 'constituent' as const } : null);
    const entries = buildListEntries([], [], [], new Set(['NVDA', 'USD', 'SAP', 'ZZZZ']), classify);
    const hx = holdingsExposure(entries, new Set(), new Set(), new Set(), new Map([['SAP', 'held on Frankfurt (FWB2) — no US theme']]));
    assert.equal(hx.total, 2);
    assert.deepEqual(hx.unmatched, ['ZZZZ']);
    assert.deepEqual(hx.excluded!.map((x) => x.ticker).sort(), ['SAP', 'USD']);
    assert.match(hx.line, /1 not matched to a theme \(2 cash \/ non-US lines not counted\)/);
  });
  test('unmatched reasons are specific', () => {
    const e = { ticker: 'ZZZZ', inTech: false, inFundo: false, inBench: false, held: true, theme: null, via: null } as any;
    assert.match(unmatchedReason(e, 'us', { profile: { status: 'not-found' } }), /SEC does not list/);
    assert.match(unmatchedReason(e, 'us', { profile: { status: 'sec', sic: '6311', sicDescription: 'LIFE INSURANCE' } }), /SEC industry "LIFE INSURANCE" \(SIC 6311\) has no theme/);
    assert.match(unmatchedReason(e, 'us'), /no sector, industry or SEC code on file yet/);
    assert.match(unmatchedReason({ ...e, ticker: '543193' }, 'india'), /BSE numeric code/);
    assert.match(unmatchedReason(e, 'india', { industry: 'Diversified' }), /industry "Diversified" has no theme/);
  });
});

// ═══ SIZE ═══════════════════════════════════════════════════════════════════
describe('size — small / mid caps only', () => {
  test('cap on file wins; else the well-known large-cap list; else unknown', () => {
    assert.equal(sizeClass('TSLA', 'us'), 'large');
    assert.equal(sizeClass('TSLA', 'us', 5_000), 'small-mid');
    assert.equal(sizeClass('OBSCURE', 'us'), 'unknown');
    assert.equal(sizeClass('SMALLIN', 'india', 20_000), 'small-mid');
    assert.equal(sizeClass('SMALLIN', 'india', 20_001), 'large');
    assert.equal(isKnownLargeCap('LT.NS', 'india'), true);
  });
  test('leaders / laggards by 1-month relative strength exclude large caps', () => {
    const r = leadersLaggards([
      { sym: 'NVDA', rs1m: 20 }, { sym: 'AAOI', rs1m: 15, m1: 18 }, { sym: 'SMCO', rs1m: 9 }, { sym: 'MIDX', rs1m: 2 },
      { sym: 'LAGA', rs1m: -6 }, { sym: 'LAGB', rs1m: -11 }, { sym: 'LAGC', rs1m: -3 }, { sym: 'NOPE', rs1m: null },
    ], 'us', (s) => (s === 'SMCO' ? 1500 : null));
    assert.deepEqual(r.leaders.map((x) => x.sym), ['AAOI', 'SMCO', 'MIDX']);
    assert.deepEqual(r.laggards.map((x) => x.sym), ['LAGB', 'LAGA', 'LAGC']);
    assert.equal(r.excludedLarge, 1);
    assert.equal(r.eligible, 6);
  });
});

// ═══ ANALYTICS ══════════════════════════════════════════════════════════════
describe('breadth heatmap', () => {
  test('memberStat / aggregateBreadth carry 20- and 200-day participation with its own sample', () => {
    const up = Array.from({ length: 260 }, (_, i) => 100 + i * 0.5);
    const short = Array.from({ length: 120 }, (_, i) => 100 + i);
    const b = aggregateBreadth([memberStat({ closes: up }), memberStat({ closes: short })], 0)!;
    assert.equal(b.above20, 2);
    assert.equal(b.above200, 1);
    assert.equal(b.n200, 1, 'a name without 200 sessions is left out of the 200-day read, not counted below');
  });
  test('rows: %, highs minus lows, low-confidence flag', () => {
    const v = vmOf([row('a', { breadthStats: { n: 10, above50: 6, above50Prev: 5, outperf: 4, newHighs: 3, newLows: 1, above20: 8, above200: 5, n200: 9 } }), row('b', { breadthStats: { n: 3, above50: 1, above50Prev: 1, outperf: 0, newHighs: 0, newLows: 2 } }), row('c')]);
    const rows = heatmapRows(v.themes);
    const a = rows.find((r) => r.id === 'a')!, b = rows.find((r) => r.id === 'b')!;
    assert.deepEqual([a.p20, a.p50, a.p200, a.hiLo, a.lowConfidence], [80, 60, 56, 2, false]);
    assert.equal(b.lowConfidence, true); assert.equal(b.p20, null);
    assert.ok(!rows.some((r) => r.id === 'c'), 'no breadth → no row, never a zero');
  });
});

describe('clusters and exposure', () => {
  const v = vmOf([row('x', { verdict: 'BUY' }), row('y', { verdict: 'HOLD' }), row('z', { verdict: 'AVOID', aboveSMA50: false, quadrant: 'Lagging', ret: { w1: -3, m1: -9, m3: -12, m6: 0, ytd: 0, y1: 0 }, breadthStats: { n: 10, above50: 1, above50Prev: 7, outperf: 0, newHighs: 0, newLows: 4 } })]);
  test('clusters of 2+ themes with their verdict mix', () => {
    const g = clusterGroups(v.themes, [{ id: 0, label: 'x', members: ['x', 'y'] }, { id: 1, label: 'z', members: ['z'] }]);
    assert.equal(g.length, 1);
    assert.deepEqual(g[0].verdicts, { BUY: 1, HOLD: 1 });
    assert.match(g[0].note, /closer to one position/);
  });
  test('exposure: value weights by verdict, holdings in breakdown themes with their own 1M, reasons, exclusions', () => {
    const entries = [
      { ticker: 'A', held: true, theme: 'x' }, { ticker: 'B', held: true, theme: 'z' }, { ticker: 'C', held: true, theme: null }, { ticker: 'USD', held: true, theme: null },
    ].map((e) => ({ inTech: false, inFundo: false, inBench: false, via: null, ...e })) as any;
    const vals: Record<string, number> = { A: 600, B: 300, C: 100 };
    const m = exposureModel(entries, v.byId, (t) => vals[t] ?? null, (t) => (t === 'B' ? { price: 10, m1: 4.2, w1: 1 } : null), () => 'no sector on file', new Map([['USD', 'cash / currency line']]));
    assert.equal(m.basis, 'value');
    assert.deepEqual(m.byVerdict.map((b) => [b.verdict, b.weight]), [['BUY', 60], ['AVOID', 30], ['No theme', 10]]);
    assert.equal(m.atRisk[0].ticker, 'B'); assert.equal(m.atRisk[0].m1, 4.2);
    assert.deepEqual(m.unmatched, [{ ticker: 'C', reason: 'no sector on file' }]);
    assert.deepEqual(m.excluded, [{ ticker: 'USD', reason: 'cash / currency line' }]);
    const counted = exposureModel(entries, v.byId, () => null, () => null, () => '-', new Map());
    assert.equal(counted.basis, 'count');
    assert.match(counted.note, /counts holdings equally/);
  });
});

describe('weekly change log', () => {
  const snap = (week: string, v: Record<string, string>, t?: Record<string, any>): WeeklySnapshot => ({ week, market: 'us', base: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { v: x }])), overlay: t });
  test('empty until two weeks are stored', () => {
    assert.deepEqual(changeLog([]), []);
    assert.deepEqual(changeLog([snap('2026-W38', { a: 'BUY' })]), []);
  });
  test('verdict and priority changes, newest week first', () => {
    const log = changeLog([
      snap('2026-W37', { a: 'HOLD', b: 'BUY' }, { a: { t: 'monitor' } }),
      snap('2026-W38', { a: 'BUY', b: 'BUY' }, { a: { t: 'look' } }),
      snap('2026-W39', { a: 'BUY', b: 'TRIM' }),
    ]);
    assert.equal(log[0].week, '2026-W39');
    assert.deepEqual(log[0].changes.map((c) => [c.id, c.kind, c.from, c.to, c.dir]), [['b', 'verdict', 'BUY', 'TRIM', 'down']]);
    assert.deepEqual(log[1].changes.map((c) => [c.id, c.kind, c.to, c.dir]), [['a', 'verdict', 'BUY', 'up'], ['a', 'tier', 'Worth a look', 'up']]);
  });
});

describe('RS sparkline data', () => {
  test('sorts by the 12-week RS change; missing sinks', () => {
    const v = vmOf([row('up', { rsWeekly: [100, 101, 103, 106] }), row('down', { rsWeekly: [100, 99, 97] }), row('none')]);
    assert.deepEqual(sortViews(v.themes, 'rs12', 'desc').map((x) => x.row.id), ['up', 'down', 'none']);
  });
  test('the sparkline renders, and says so when there is too little history', () => {
    assert.match(renderToStaticMarkup(h(Sparkline, { values: [100, 102, 101, 105] })), /polyline/);
    assert.match(renderToStaticMarkup(h(Sparkline, { values: [100] })), /Not enough weekly history/);
  });
});

// ═══ ROUTE MODES ════════════════════════════════════════════════════════════
describe('route — new read modes fail soft', () => {
  test('US earnings history says the bench is used instead', async () => {
    const j: any = await (await GET(new Request('http://x/api/market/theme-rotation?region=us&earnings=1'))).json();
    assert.equal(j.source, 'none'); assert.deepEqual(j.rows, []);
  });
  test('holdings with no tickers, and profiles for India, answer empty', async () => {
    assert.deepEqual(((await (await GET(new Request('http://x/api/market/theme-rotation?region=us&holdings=1'))).json()) as any).quotes, {});
    assert.deepEqual(((await (await GET(new Request('http://x/api/market/theme-rotation?region=india&profiles=1&tickers=TCS'))).json()) as any).profiles, {});
  });
});

// ═══ UI ═════════════════════════════════════════════════════════════════════
describe('new panels render data and empty states', () => {
  test('exposure panel: no holdings / at-risk list with own 1M', () => {
    const empty = { basis: 'count' as const, total: 0, byVerdict: [], atRisk: [], unmatched: [], excluded: [], note: '' };
    assert.match(text(h(ExposurePanel, { model: empty, nameOf: (s: string) => s, onPick: noop, source: 'US book' })), /no holdings on this device/);
    const full = { basis: 'value' as const, total: 2, byVerdict: [{ verdict: 'AVOID', weight: 40, count: 1, tickers: ['B'] }, { verdict: 'BUY', weight: 60, count: 1, tickers: ['A'] }],
      atRisk: [{ ticker: 'B', theme: 'z', verdict: 'AVOID', reason: 'Breakdown', m1: -8.4 }], unmatched: [{ ticker: 'C', reason: 'no sector on file' }], excluded: [{ ticker: 'USD', reason: 'cash / currency line' }], note: 'Weighted by current value.' };
    const out = text(h(ExposurePanel, { model: full, nameOf: (s: string) => s, onPick: noop, source: 'US book' }));
    assert.match(out, /Holdings in breakdown \/ TRIM \/ AVOID themes/);
    assert.match(out, /1M -8\.4%/);
    assert.match(out, /Still without a theme · 1/);
    assert.match(out, /USD \(cash \/ currency line\)/);
  });
  test('heatmap, clusters and change log collapsed headers carry their counts', () => {
    assert.match(text(h(BreadthHeatmap, { rows: [], nameOf: (s: string) => s, onPick: noop })), /Breadth heatmap/);
    assert.match(text(h(ClusterPanel, { groups: [], nameOf: (s: string) => s, onPick: noop })), /no strongly correlated groups/);
    assert.match(text(h(ChangeLogPanel, { weeks: [], stored: 1, nameOf: (s: string) => s, onPick: noop })), /starts once two weeks are stored \(now 1\)/);
  });
  test('evidence panel: priority vs verdict, evidence line, small/mid leaders', () => {
    const v = vmOf([row('Semis', { verdict: 'BUY', breadthStats: { n: 10, above50: 8, above50Prev: 4, outperf: 7, newHighs: 2, newLows: 0 } })]);
    const out = text(h(EvidencePanel, { v: v.byId.get('Semis')!, listNames: [], flows: [], clusterPeers: [], snapshots: [], nameOf: (s: string) => s, onPick: noop, onRetryDrill: noop, region: 'us', capOf: () => null,
      drillLoading: false, drill: { stocks: [{ sym: 'NVDA', m3: 20, rs1m: 12, rsChange: 8, strengthTrend: 'gaining', buyReady: true }, { sym: 'AAOI', m3: 30, rs1m: 18, buyReady: true }, { sym: 'LPTH', m3: -5, rs1m: -9, buyReady: false }, { sym: 'POET', m3: 2, rs1m: 3, buyReady: false }, { sym: 'SMALLB', m3: 1, rs1m: -2 }] } }));
    assert.match(out, /Priority vs verdict:/);
    assert.match(out, /Evidence behind the priority:/);
    assert.match(out, /Leaders[^]*AAOI/);
    assert.match(out, /1 large cap left out/);
    assert.doesNotMatch(out.split('Leaders')[1].split('Laggards')[0], /NVDA/);
  });
  test('table has the RS 12w column and the ≠ price verdict marker', () => {
    const v = vmOf([row('a', { verdict: 'BUY', rsWeekly: [100, 101, 102] })]);
    const out = text(h(ThemeTable, { rows: v.themes, total: 1, sortKey: 'rank', sortDir: 'asc', onSort: noop, filter: emptyFilter(), onFilter: noop, expanded: new Set<string>(), onToggle: noop, onExpandAll: noop, onCollapseAll: noop, yours: () => 0, heldIn: () => 0, renderPanel: () => null }));
    assert.match(out, /RS 12w/);
    assert.match(out, /≠ price verdict/);
    assert.match(out, /price-only call/);
  });
});
