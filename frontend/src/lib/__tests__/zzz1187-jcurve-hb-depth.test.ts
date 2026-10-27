// zzz1187 — Choke-Point: India band, tightness evidence, late-curve note; 100-baggers: lenders out, accelerating growers in;
// news: stored thematic labels re-checked, unvalued large-cap "contracts" hidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_CAP, enrich, CHOKE_SYSTEM, type ChokeReport, type CandFacts } from '../choke-themes/core';
import { hbGateFails, type Cand } from '../screener/ai-candidates';
import { hbToolFor } from '../hundred-baggers/core';
import { isStrictSchema, toStrictSchema } from '../ai-schemas';
import { impactLabelFits } from '../news/institutional-engine';
import { showableContract } from '../news/transformational-dedup';

const cand = (o: Partial<Cand>): Cand => ({ t: 'X', n: 'X', ind: 'Industrial Machinery', mc: 2000, revQ: 30, revA: 25, epsQ: 40, opm: 20, gm: null, roce: 22, roe: null, de: 0.1, pe: 30, ps: 4, fcfm: 10, p1y: 20, p5y: 100, bb: 0, fs: null, ...o });

test('India discovery band reaches real Indian mid-caps; the prompt defines a J-curve and allows listed suppliers beyond the lists', () => {
  assert.equal(DISCOVERY_CAP.IN[1], 50_000);
  assert.match(CHOKE_SYSTEM, /Micron and SanDisk/);
  assert.match(CHOKE_SYSTEM, /COMPANIES BEYOND THE LISTS/);
});

test('a theme without evidence of tight supply is a watch; a 10x past run is flagged and ranked lower', () => {
  const c = (ticker: string) => ({ name: ticker, ticker, exposure: 'DIRECT', jstage: 'J2', product: '', inflection: '', milestone: '', invalidation: '', concern: '', scenario: null }) as any;
  const pb = { strongest: [], confirm: [], milestones: [], disconfirming: [], valuation: [] };
  const r = { regions: [{ region: 'IN', playbook: pb, themes: [
    { name: 'Hoses', emoji: '', keywords: [], why: 'w', tightness: null, candidates: [c('AEROFLEX')], reference: [] },
    { name: 'Transformers', emoji: '', keywords: [], why: 'w', tightness: 'Lead times above 2 years (2026)', candidates: [c('TARIL')], reference: [] },
  ] }, { region: 'US', playbook: pb, themes: [] }] } as unknown as ChokeReport;
  const f = (p5y: number): CandFacts => ({ cap: 9000, revQ: 60, revA: 24, epsQ: 100, opm: 15, pe: 28, fcfm: 5, de: 0.1, p1y: 20, p5y });
  enrich(r, { IN: new Map([['AEROFLEX', f(100)], ['TARIL', f(2029)]]), US: new Map() });
  const [first, second] = r.regions[0].themes;
  assert.equal(first.name, 'Transformers');
  assert.equal(first.qualifies, true);
  assert.equal(second.qualifies, false);
  assert.match(first.candidates[0].sizeNote || '', /up 21x in 5 years/);
});

test('100-bagger gates: lenders / insurers out, an accelerating grower in, heavy burn out', () => {
  assert.ok(hbGateFails(cand({ ind: 'Property-Casualty Insurers' }), 'US').some((x) => /insurer/.test(x)));
  assert.deepEqual(hbGateFails(cand({ revA: 8, revQ: 35 }), 'US'), []);
  assert.ok(hbGateFails(cand({ fcfm: -12 }), 'US').length);
  assert.deepEqual(hbGateFails(cand({ roce: 6 }), 'US'), []);   // returns are judged in the score caps, not the gate
  for (const m of ['US', 'IN'] as const) assert.ok(isStrictSchema(toStrictSchema(hbToolFor(m).input_schema as any) as any));
});

test('a stored GPU-packaging label on a battery deal is dropped; an unvalued contract of a large company is hidden', () => {
  assert.equal(impactLabelFits('GPU deployment bottleneck shifting upstream — packaging-bound', 'SAMSUNG SDI to supply 1GWh of US-made ESS to Alpha Omega Power'), false);
  assert.equal(impactLabelFits('GPU deployment bottleneck shifting upstream — packaging-bound', 'CoWoS packaging tight for Nvidia GPUs'), true);
  assert.equal(impactLabelFits('Some other label', 'anything'), true);
  const it = (title: string) => ({ title, primary_ticker: 'NTPC', ticker_symbols: ['NTPC'], strategic_visibility: {} }) as any;
  assert.equal(showableContract(it('NTPC REL signs 1,200 MW solar PPA with PTC India'), () => true, undefined, () => 40_000), null);
  assert.ok(showableContract(it('NTPC REL signs 1,200 MW solar PPA with PTC India'), () => true, undefined, () => 800));
});
