// zzz1183 — acceptance checks for the company J-curve method (ChatGPT spec, the feasible parts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanChoke, enrich, diffRuns, scenarioMultiples, dataCheck, type CandFacts } from '../choke-themes/core';
import { toOpenAIRequest } from '../anthropic-meter';
import { cand, theme } from './zzz1174-choke-themes.test';

const pb = { strongest: [], confirm: [], milestones: [], disconfirming: [], valuation: [] };
const F = (o: Partial<CandFacts>): CandFacts => ({ cap: 2000, revQ: 30, revA: 15, epsQ: 40, opm: 15, pe: 30, fcfm: 5, de: 0.2, p1y: 10, p5y: 50, ...o });
const build = (us: any[], inThemes: any[] = []) => cleanChoke({ regions: [{ region: 'US', themes: us, playbook: pb }, { region: 'IN', themes: inThemes, playbook: pb }] })!;

test('price is context: a big past rally does not end the J-curve, a big fall does not make one early', () => {
  const r = build([theme('A', [cand('RAN', { jstage: 'J2' })]), theme('B', [cand('FELL', { jstage: 'J0' })])]);
  enrich(r, { US: new Map([['RAN', F({ p5y: 900, p1y: 120 })], ['FELL', F({ p5y: -70, p1y: -60, revQ: -10, revA: -5 })]]), IN: new Map() });
  const [a, b] = [r.regions[0].themes.find((t) => t.name === 'A')!, r.regions[0].themes.find((t) => t.name === 'B')!];
  assert.equal(a.qualifies, true, 'a qualified J2 with growing figures stays, whatever the 5-year move');
  assert.equal(b.qualifies, false, 'a fallen J0 is not early');
});

test('the figures check the stage: shrinking sales contradict a claimed J3; missing data lowers confidence, never raises it', () => {
  assert.equal(dataCheck({ ...cand('X', { jstage: 'J3' }), facts: F({ revQ: -12, revA: -3 }) } as any), 'CONTRADICTS');
  assert.equal(dataCheck({ ...cand('X', { jstage: 'J2' }), facts: null } as any), 'NO_DATA');
  const r = build([theme('With data', [cand('D')]), theme('No data', [cand('N')])]);
  enrich(r, { US: new Map([['D', F({})]]), IN: new Map() });
  const th = r.regions[0].themes;
  assert.equal(th[0].name, 'With data'); assert.ok((th[0].rankScore ?? 0) > (th[1].rankScore ?? 0));
  const contra = build([theme('C', [cand('C', { jstage: 'J3' })])]);
  enrich(contra, { US: new Map([['C', F({ revQ: -15, revA: -2 })]]), IN: new Map() });
  assert.equal(contra.regions[0].themes[0].qualifies, false);
});

test('a broad theme with only proxies / speculation does not qualify; a qualified supplier in a mature sector does', () => {
  const r = build([theme('Broad solar', [cand('P', { exposure: 'PROXY', jstage: 'J2' }), cand('S', { exposure: 'SPECULATIVE', jstage: 'J1' })]), theme('Solar-glass qualified supplier', [cand('Q', { exposure: 'DIRECT', jstage: 'J2' })])]);
  enrich(r, { US: new Map([['P', F({})], ['S', F({})], ['Q', F({})]]), IN: new Map() });
  assert.equal(r.regions[0].themes.find((t) => t.name === 'Broad solar')!.qualifies, false);
  assert.equal(r.regions[0].themes.find((t) => t.name.startsWith('Solar-glass'))!.qualifies, true);
});

test('size band from market data (large → reference leaders); one primary theme per company (others become tags)', () => {
  const r = build([theme('T1', [cand('BIG'), cand('MID')]), theme('T2', [cand('MID'), cand('OTHER')])]);
  enrich(r, { US: new Map([['BIG', F({ cap: 250_000 })], ['MID', F({ cap: 3000 })], ['OTHER', F({})]]), IN: new Map() });
  const t1 = r.regions[0].themes.find((t) => t.name === 'T1')!, t2 = r.regions[0].themes.find((t) => t.name === 'T2')!;
  assert.deepEqual(t1.candidates.map((c) => c.ticker), ['MID']); assert.deepEqual(t1.reference.map((c) => c.ticker), ['BIG']);
  assert.deepEqual(t2.candidates.map((c) => c.ticker), ['OTHER']); assert.deepEqual(t1.candidates[0].secondary, ['T2']);
});

test('scenarios reconcile to their assumptions; no estimate without representative earnings', () => {
  const s = { years: 5, epsCagr: { bear: 0, base: 20, bull: 30 }, exitPe: { bear: 15, base: 30, bull: 40 }, dilutionPct: 10, basis: 'x' };
  const { out } = scenarioMultiples(s, 30);
  assert.equal(out!.bear, 0.45);                                        // 1 × 0.9 × 15/30
  assert.equal(out!.base, Math.round(1.2 ** 5 * 0.9 * 100) / 100);       // 2.24
  assert.equal(scenarioMultiples(s, -12).out, null); assert.match(scenarioMultiples(s, -12).note!, /no positive current earnings/);
  assert.equal(scenarioMultiples(s, 400).out, null); assert.equal(scenarioMultiples(null, 20).out, null);
});

test('"what changed" is computed from the stored runs: theme added / dropped, J-stage moves with old and new value', () => {
  const prev = build([theme('Old', [cand('A', { jstage: 'J1' })])]);
  const next = build([theme('New', [cand('A', { jstage: 'J2' }), cand('B')])]);
  const d = diffRuns(prev, next);
  assert.ok(d.some((x) => x.kind === 'ADDED' && x.what === 'theme: New'));
  assert.ok(d.some((x) => x.kind === 'DROPPED' && x.what === 'theme: Old'));
  assert.ok(d.some((x) => x.kind === 'CHANGED' && x.what === 'A J-stage' && x.from === 'J1' && x.to === 'J2'));
  assert.ok(d.some((x) => x.kind === 'ADDED' && x.what.startsWith('B ')));
});

test('GPT-6 tool calls go without reasoning effort (the live 400 on 26 Oct)', () => {
  const r = toOpenAIRequest({ model: 'x', max_tokens: 100, tools: [{ name: 't', input_schema: { type: 'object', properties: {}, additionalProperties: false, required: [] } }], tool_choice: { type: 'tool', name: 't' }, messages: [{ role: 'user', content: 'hi' }] } as any, 'gpt-6.1-terra', 'low');
  assert.equal(r.reasoning_effort, 'none');
  const r5 = toOpenAIRequest({ model: 'x', max_tokens: 100, tools: [{ name: 't', input_schema: { type: 'object', properties: {}, additionalProperties: false, required: [] } }], messages: [{ role: 'user', content: 'hi' }] } as any, 'gpt-5', 'low');
  assert.equal(r5.reasoning_effort, 'low');
});
