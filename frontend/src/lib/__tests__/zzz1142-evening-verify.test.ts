// zzz1142–1145 — Guidance Upgrades evening verification (19 Oct): Compact columns by name (E1), late cancelled answers never
// overwrite a newer record (E2), timing / one-off evidence respects negation and metric (E3), a missing profit row is "not
// extracted", never "not in the source" (E4), history average keeps its unit.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { FvCells } from '../../components/guidance-upgrades/GuFairValue';
import { OppCells } from '../../components/guidance-upgrades/GuOpportunity';
import { SkyScoreCell } from '../../components/guidance-upgrades/GuSkyGold';
import { COLS_B, COMPACT_HIDDEN } from '../../components/guidance-upgrades/GuFocusList';

const td: React.CSSProperties = {};
/** The logical column names a row's figure cells cover, in order (a cell spanning two columns names both). */
function covered(el: React.ReactElement): string[] {
  const html = renderToStaticMarkup(React.createElement('table', null, React.createElement('tbody', null, React.createElement('tr', null, el))));
  const out: string[] = [];
  for (const m of html.matchAll(/<td([^>]*)>/g)) {
    const c = /data-c="([^"]+)"/.exec(m[1])?.[1];
    assert.ok(c, `a figure cell has no column name: ${m[0]}`);
    const span = Number(/colSpan="(\d+)"|colspan="(\d+)"/i.exec(m[1])?.slice(1).find(Boolean) || 1);
    const names = c!.split(' ');
    assert.equal(names.length, span, `cell names ${c} but spans ${span}`);
    out.push(...names);
  }
  return out;
}
const opp: any = { score: 49, band: 'MIXED', coverage: 3, parts: [], capNote: null, summary: '3 of 5 parts known', implied: { pct: 100, approx: true, basis: 'b', reason: null }, quality: {}, required: {}, duration: {}, street: {} };
const fvOk: any = { ok: true, reason: null, currency: '$', price: 10, base: { fair: 12, upsidePct: 20 }, bear: { fair: 9 }, bull: { fair: 15 }, checks: [], methods: [], sectorLabel: '', sectorKnown: true, basis: 'guided', growth: null, inputs: [] };
const fvNo: any = { ...fvOk, ok: false, reason: 'only 1 valuation method usable', base: null };
const sky = (score: number, band: string): any => ({ score, band, summary: 's', capNote: null, checks: [], flags: [], main: [], parts: [], known: 0, total: 7 });
const FIG = COLS_B.slice(COLS_B.indexOf('price'), COLS_B.indexOf('sky') + 1);

describe('E1 — every figure cell sits under its own header, whatever the state', () => {
  const cases: Array<[string, any, any, any]> = [
    ['valid fair value', fvOk, opp, sky(52, 'MIXED')],
    ['no fair value (two-column cell)', fvNo, opp, sky(52, 'MIXED')],
    ['figures still loading', null, null, null],
    ['no EPS, zero scores', fvNo, { ...opp, score: 0, implied: { pct: null, approx: false, basis: '', reason: 'no profit' } }, sky(0, 'WEAK')],
  ];
  for (const [name, fv, o, s] of cases) test(name, () => {
    const row = React.createElement(React.Fragment, null,
      React.createElement(FvCells, { fv, waiting: !fv, td }),
      React.createElement(OppCells, { o, waiting: !o, open: false, onToggle: () => {}, td }),
      React.createElement(SkyScoreCell, { s, waiting: !s, open: false, onToggle: () => {}, td }));
    assert.deepEqual(covered(row), FIG);
  });
  test('Compact hides by column name, never by position', () => {
    const css = readFileSync(new URL('../../components/guidance-upgrades/gu-tokens.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /gu-cols-compact[^{]*nth-child/);
    for (const c of COMPACT_HIDDEN) assert.match(css, new RegExp(`gu-cols-compact \\[data-c="${c}"\\]`));
    assert.ok(!COMPACT_HIDDEN.includes('opp') && !COMPACT_HIDDEN.includes('sky'));
    const src = readFileSync(new URL('../../components/guidance-upgrades/GuFocusList.tsx', import.meta.url), 'utf8');
    assert.match(src, /<th key=\{i\} data-c=\{colIds\[i\]\}/);
    assert.match(src, /colSpan=\{FV_COLS \+ OPP_COLS \+ 1 - \(cols === 'compact' \? 2 : 0\)\}/);
  });
});

describe('E2 — an older answer that arrives late never replaces a newer one', async () => {
  const { DetailLoader } = await import('../../components/guidance-upgrades/detail-loader');
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  // a fetch that ignores abort, so the cancelled request really does deliver its answer later
  function deferredFetch() {
    const calls: Array<{ resolve: (b: any) => void }> = [];
    const fetcher = () => new Promise<any>((resolve) => { calls.push({ resolve: (b: any) => resolve({ status: 200, ok: true, json: async () => b }) }); });
    return { calls, fetcher };
  }
  const ev = (id: string, tag: string) => ({ event: { guidance_event_id: id, company: tag, changes: [], risks: [], evidenceGaps: [], nextEvidence: [], history: [], sources: [], decisionReason: [], flags: [], chain: {}, links: {} } });
  test('start A, cancel, reopen A; newer answer first, older answer after → the newer stays', async () => {
    const f = deferredFetch();
    const L = new DetailLoader({ fetcher: f.fetcher as any, urlFor: (id) => id, onChange: () => {} });
    L.open('A', {}, true); L.cancel(); L.open('A', {}, true);
    f.calls[1].resolve(ev('A', 'newer-answer')); await tick(); await tick();
    f.calls[0].resolve(ev('A', 'older-answer')); await tick(); await tick();
    const s: any = L.state('A');
    assert.equal(s.status, 'ok'); assert.equal(s.event.company, 'newer-answer');
    L.cancel(); L.open('A', {}, true);
    assert.equal((L.state('A') as any).event.company, 'newer-answer');
  });
  test('closed before its answer and nothing newer asked → the answer is kept for the next open', async () => {
    const f = deferredFetch();
    const L = new DetailLoader({ fetcher: f.fetcher as any, urlFor: (id) => id, onChange: () => {} });
    L.open('A', {}, true); L.cancel();
    f.calls[0].resolve(ev('A', 'only-answer')); await tick(); await tick();
    L.open('A', {}, true);
    assert.equal(L.requests, 1); assert.equal((L.state('A') as any).event.company, 'only-answer');
  });
});

describe('E3 / E4 — evidence follows its sentence, metric and negation; history units', async () => {
  const g = await import('../guidance-upgrades');
  const sales = [{ metric: 'REVENUE_GROWTH' }];
  test('a denied one-off is not timing evidence (Kanohar)', () => {
    assert.equal(g.timingEffectsOf("Management said the quarter doesn't have any one-off and demand is broad-based."), null);
    assert.equal(g.timingEffectsOf('There were no one-time items in the quarter.'), null);
    assert.ok(g.timingEffectsOf('Results include a milestone payment of $2 million.'));
  });
  test('legal boilerplate is not evidence', () => {
    assert.equal(g.timingEffectsOf('Forward-looking statements involve risks and uncertainties, including the timing of orders and one-time events.'), null);
  });
  test('a one-time charge in reported EPS is separate context for a sales-guidance raise (JNJ)', () => {
    const t = 'Reported EPS includes a one-time talc litigation charge of $0.40. The company raises its full-year adjusted operational sales growth guidance. Growth reflects strong demand.';
    const ce = g.causalEvidence(t, sales);
    assert.doesNotMatch(ce.text, /talc/); assert.equal(ce.context.length, 1);
    assert.equal(g.classifyDriver(ce.text).kinds.includes('ONE_TIME_ITEM'), false);
    // the same charge stays evidence when the raise IS a profit measure
    assert.match(g.causalEvidence(t, [{ metric: 'ADJ_EPS' }]).text, /talc/);
  });
  test('a genuine milestone-driven raise keeps its timing; a release with no driver says so', () => {
    const t = 'MaxCyte now expects revenue of $34 million. Results reflect accelerated instrument purchasing originally anticipated in the fourth quarter and a milestone payment.';
    assert.ok(g.timingEffectsOf(g.causalEvidence(t, [{ metric: 'REVENUE' }]).text));
    assert.equal(g.classifyDriver(g.causalEvidence('The company raised its revenue guidance to $50 million.', [{ metric: 'REVENUE' }]).text).quality, 'UNKNOWN');
  });
  test('WHY NOW agrees with a timing driver (built event)', () => {
    const res: any = { docId: 'mxcttest0000000000aa', market: 'US', ticker: 'MXCT', company: 'Maxcyte, Inc.', docUrl: 'https://x/mxct', docKind: 'PRESS_RELEASE', filedAt: '2026-10-14T00:00:00Z', status: 'ok',
      rows: [{ metric: 'REVENUE', period: 'FY26', periodKind: 'ANNUAL', basis: 'UNSTATED', currency: '$', unit: 'M', low: 34, high: 34, status: 'RAISED', prior: { low: 30, high: 32, statedIn: null }, quote: 'Full year total revenue expected to be approximately $34 million, compared to prior guidance of $30 million to $32 million' }],
      docFacts: { nextResultsDate: '2026-11-10', timing: ['Results reflect accelerated instrument purchasing originally anticipated in the fourth quarter and a milestone payment'] } };
    const [ev] = g.buildExtractedEvents([res], () => ({}), new Date('2026-10-19T09:00:00Z'), '30D');
    assert.match(ev.guidance_driver, /milestone/);
    assert.doesNotMatch(ev.whyNow, /driver not stated/i, ev.whyNow); assert.match(ev.whyNow, /milestone payment/);
  });
  test('E4: a missing profit figure is "not extracted", never "not in the source"; a profit line in otherChanges is named', () => {
    const base: any = { company: 'JNJ', changes: [{ metric: 'REVENUE', direction: 'UP', before: { metric: 'REVENUE', period: 'FY26', low: 100, high: 100, midpoint: 100, currency: '$', unit: 'B' }, after: { metric: 'REVENUE', period: 'FY26', low: 102, high: 102, midpoint: 102, currency: '$', unit: 'B' }, percentageChange: 2 }] };
    const a = g.whatItMeans({ ...base, otherChanges: [] });
    assert.doesNotMatch(a, /no profit guidance in the source/i); assert.match(a, /was extracted into this record \(the release may still give one\)/);
    const b = g.whatItMeans({ ...base, otherChanges: [{ metric: 'ADJ_EPS', direction: 'UP', before: { metric: 'ADJ_EPS', period: 'FY26', low: 10.96, high: 11.11, midpoint: 11.035, currency: '$' }, after: { metric: 'ADJ_EPS', period: 'FY26', low: 11.05, high: 11.15, midpoint: 11.1, currency: '$' } }] });
    assert.match(b, /Profit guidance is in the same release/);
  });
  test('history: points and percent are averaged apart', () => {
    const h = g.buildHistory([], [
      { date: '2026-07-01', metric: 'REVENUE_GROWTH', period: 'FY26', text: '6.4–6.8%', change: 'RAISED', revisionPct: 0.1, revisionUnit: 'pp' },
      { date: '2026-04-01', metric: 'REVENUE', period: 'FY26', text: '$94B', change: 'RAISED', revisionPct: 1.2, revisionUnit: '%' },
    ] as any);
    assert.equal(h.stats!.avgRevisionPct, 1.2); assert.equal(h.stats!.avgRevisionPp, 0.1);
  });
});

describe('zzz1146 — filed results whose figures were not out yet are fetched again on every rebuild', async () => {
  const { filedAwaitingFigures } = await import('../india-eo-card-data');
  test('picks the filed ones only', () => {
    const p = { _dropped: [
      { ticker: 'BAJFINANCE', filed: true, reason: "filed — figures being read: results filing seen …; Screener's newest quarter is 2026-06-30" },
      { ticker: 'aonesteels', filed: true, reason: "numbers didn't load — retrying" },
      { ticker: 'SOBHA', filed: false, reason: 'board meeting only — results not out yet' },
    ] };
    assert.deepEqual(filedAwaitingFigures(p).sort(), ['AONESTEELS', 'BAJFINANCE']);
    assert.deepEqual(filedAwaitingFigures({}), []);
  });
  test('the graded route adds them to the cache-bypassing refetch on every rebuild', () => {
    const src = readFileSync(new URL('../../app/api/v1/earnings/graded/route.ts', import.meta.url), 'utf8');
    assert.match(src, /for \(const t of filedAwaitingFigures\(prior\)\) if \(symbols\.includes\(t\)\) refetchSet\.add\(t\)/);
  });
});
