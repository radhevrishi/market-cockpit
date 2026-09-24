// zzz795 — Theme Rotation UI: every section renders its data AND its empty /
// loading / error state; no visible 0–100 score anywhere; the phone layout
// rules exist; the page shell renders on the server without browser APIs.
// Run: npx tsx --test src/lib/__tests__/zzz795-theme-ui.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildViewModel } from '../theme-rotation/view-model';
import { emptyFilter } from '../theme-rotation/table';
import type { Payload, ThemeRow } from '../theme-rotation/types';
import { ThemeTable, THEME_ROTATION_CSS } from '../../components/dashboard/theme-rotation/ThemeTable';
import { SummaryStrip } from '../../components/dashboard/theme-rotation/SummaryStrip';
import { EvidencePanel } from '../../components/dashboard/theme-rotation/EvidencePanel';
import { ListsByTheme } from '../../components/dashboard/theme-rotation/ListsByTheme';
import { RrgMap } from '../../components/dashboard/theme-rotation/RrgMap';
import ThemeRotationTab from '../../components/dashboard/ThemeRotationTab';

(globalThis as any).React = React;
const h = React.createElement;
const text = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');

function row(id: string, p: Partial<ThemeRow>): ThemeRow {
  return { id, name: id, emoji: '•', group: 'G', proxy: 'ETF', members: [], ok: true, rsRatio: 101, rsMomentum: 100.5, quadrant: 'Leading', aboveSMA50: true, sourceKind: 'proxy',
    ret: { w1: 1, m1: 3, m3: 8, m6: 10, ytd: 12, y1: 20 }, trail: [{ x: 99, y: 99 }, { x: 100, y: 100 }, { x: 101, y: 100.5 }], verdict: 'BUY', verdictNote: 'Price confirms the strength.', conviction: 100, ...p } as ThemeRow;
}
const payload: Payload = {
  region: 'us', benchmark: { symbol: 'SPY', name: 'S&P 500', price: 600, changePercent: 0 }, benchmarkRet: { w1: 0, m1: 1, m3: 3, m6: 5, ytd: 8, y1: 15 },
  themes: [
    row('Semis', { breadthStats: { n: 10, above50: 8, above50Prev: 4, outperf: 7, newHighs: 2, newLows: 0 }, flowStats: { relVol: 1.2, upShare: 0.6, upSharePrev: 0.5, basis: 'etf' } }),
    row('Gold', { verdict: 'HOLD', shortTermBreak: true, ret: { w1: -4.8, m1: -13.5, m3: 18, m6: 20, ytd: 25, y1: 40 } }),
  ],
  rotatingIn: [], rotatingOut: [], topBuy: [], topAvoid: [], asOf: '2026-09-24T00:00:00Z',
  breadth: { themes: 2, above50: 2, pctAbove50: 100, newHigh: 1, newLow: 0, regime: 'risk-off', regimeScore: -1, note: '' },
};
const vm = buildViewModel({ payload, now: new Date('2026-09-24T00:00:00Z'), printsByTheme: null, benchLabel: 'bench', catalystsByTheme: null, catalystWindowDays: 14, pesByTheme: {}, allPEs: [], snapshots: [], currentWeek: '2026-W39', beneficiariesOf: () => [] });
const noop = () => {};
const tableProps = (rows = vm.themes, total = vm.themes.length) => ({
  rows, total, sortKey: 'rank' as const, sortDir: 'asc' as const, onSort: noop, filter: emptyFilter(), onFilter: noop,
  expanded: new Set<string>(['Semis']), onToggle: noop, onExpandAll: noop, onCollapseAll: noop, yours: () => 3, heldIn: () => 1,
  renderPanel: () => h('div', null, 'PANEL-OPEN'),
});

describe('ranked table', () => {
  const out = text(h(ThemeTable, tableProps()));
  test('shows tier, Why, verdict, layers and an open panel', () => {
    assert.match(out, /Why:/); assert.match(out, /BUY/); assert.match(out, /PANEL-OPEN/);
    assert.match(out, /Short-term break/);
  });
  test('no visible 0–100 score (the old "Conv 100")', () => {
    assert.doesNotMatch(out, /\bConv\b/); assert.doesNotMatch(out, /\/100\b/); assert.doesNotMatch(out, /\bconviction\b/i);
  });
  test('empty states', () => {
    assert.match(text(h(ThemeTable, tableProps([], 2))), /No theme matches these filters/);
    assert.match(text(h(ThemeTable, tableProps([], 0))), /No themes could be priced right now/);
  });
  test('phone rules exist for ≤720px and ≤480px', () => {
    assert.match(THEME_ROTATION_CSS, /max-width: 720px/); assert.match(THEME_ROTATION_CSS, /max-width: 480px/);
    assert.match(THEME_ROTATION_CSS, /\.trt-table \.trt-m \{ display: table-cell; \}/);
  });
});

describe('summary strip', () => {
  const out = text(h(SummaryStrip, { vm, benchName: 'S&P 500', nameOf: (id: string) => id, onPick: noop, holdings: null, historyLoaded: true }));
  test('market condition, change note, empty early-rotation state, risk flags', () => {
    assert.match(out, /RISK-OFF/);
    assert.match(out, /History starts this week/);
    assert.match(out, /Early rotation None this week/);
    assert.match(out, /Short-term break Gold/);
  });
  test('history loading state', () => {
    assert.match(text(h(SummaryStrip, { vm, benchName: 'S&P 500', nameOf: (id: string) => id, onPick: noop, holdings: null, historyLoaded: false })), /Reading stored weeks/);
  });
});

describe('evidence panel', () => {
  const base = { v: vm.byId.get('Semis')!, listNames: [], flows: [], clusterPeers: [], snapshots: [], nameOf: (id: string) => id, onPick: noop, onRetryDrill: noop };
  test('layers with sources, verdict reason, unknown layers say so', () => {
    const out = text(h(EvidencePanel, { ...base, drill: undefined, drillLoading: true }));
    assert.match(out, /Price confirms the strength/);
    assert.match(out, /Source:/);
    assert.match(out, /Graded earnings not loaded on this device/);
    assert.match(out, /Loading Semis constituents/);
    assert.match(out, /Weekly history starts this week/);
  });
  test('drill error has a retry; drill data shows gaining / losing names', () => {
    assert.match(text(h(EvidencePanel, { ...base, drill: { error: 'Constituents could not be loaded. Try again.' }, drillLoading: false })), /Retry/);
    const out = text(h(EvidencePanel, { ...base, drillLoading: false, drill: { stocks: [
      { sym: 'NVDA', m3: 20, rs3m: 15, rsChange: 8, strengthTrend: 'gaining', buyReady: true },
      { sym: 'INTC', m3: -10, rs3m: -12, rsChange: -9, strengthTrend: 'losing', buyReady: false },
    ], subs: [] } }));
    assert.match(out, /Gaining strength[^]*NVDA/); assert.match(out, /Losing strength[^]*INTC/);
    assert.doesNotMatch(out, /Techno/);
  });
});

describe('lists and holdings', () => {
  const props = {
    region: 'us' as const, entries: [], groups: [], unclassified: [],
    holdings: { total: 0, themed: 0, favoured: [], atRisk: [], crowded: [], line: '' }, holdingsSource: 'US book + portfolio page', holdingsNote: null,
    best: { picks: [], rankedBy: null, declined: 'x', eligible: 0 }, nameOf: (s: string) => s, onPick: noop, resolving: 0,
    tv: { busy: false, done: false, count: 0, onCopy: noop, scope: 'combo' as const, setScope: noop },
  };
  test('collapsed by default, but the honest holdings sentence is always visible', () => {
    const out = text(h(ListsByTheme, props));
    assert.match(out, /Names on your lists, by theme/);
    assert.match(out, /research lists, not positions/);
    assert.doesNotMatch(out, /your book/i);
  });
});

describe('rotation map and page shell', () => {
  test('empty map', () => { assert.match(text(h(RrgMap, { themes: [], hover: null, setHover: noop })), /No themes to plot/); });
  test('map labels flagged themes', () => {
    const out = renderToStaticMarkup(h(RrgMap, { themes: payload.themes, hover: null, setHover: noop, highlight: new Set(['Gold']) }));
    assert.match(out, /Gold/);
  });
  test('the tab renders on the server with no browser APIs (props unchanged: none)', () => {
    const out = text(h(ThemeRotationTab));
    assert.match(out, /Theme Rotation/); assert.match(out, /USA/); assert.match(out, /India/);
  });
});
