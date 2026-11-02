// zzz1206 — Choke-Point Themes: names whose share price already ran (10x in 5y, 3x in 1y, 2x in 6m, topping) are LATE —
// moved out of the discovery list, never qualify a theme, and stay visible with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lateCurve, enrich } from '../choke-themes/core';

const f = (o: any) => ({ cap: 5000, revQ: 60, revA: 24, epsQ: 135, opm: 15, pe: 40, fcfm: 5, de: 0.2, p1y: 20, p5y: 100, ...o });
test('late reasons', () => {
  assert.match(lateCurve(f({ p5y: 2100 })).join(), /up 22x in 5 years/);
  assert.match(lateCurve(f({ p1y: 260 })).join(), /up 4x in a year/);
  assert.match(lateCurve(f({ p6m: 120 })).join(), /six months/);
  assert.match(lateCurve(f({ st: 3, p1y: 80 })).join(), /topping/);
  assert.deepEqual(lateCurve(f({})), []);
  assert.deepEqual(lateCurve(f({ st: 4, p1y: -40 })), []);   // a downtrend is not "late"
});

test('enrich moves late names out of discovery; a theme with only late names does not qualify; re-enrich keeps them', () => {
  const cand = (t: string) => ({ name: t, ticker: t, exposure: 'DIRECT', jstage: 'J2', product: 'x', inflection: 'x', milestone: 'x', invalidation: 'x', concern: 'x', scenario: null });
  const r: any = { regions: [{ region: 'IN', playbook: {}, themes: [{ name: 'Power transformers', why: 'w', supply: 'TIGHT', tightness: 'Qualified transformer supply constrained by multi-year lead times', candidates: [cand('TARIL'), cand('EARLYCO')], reference: [] }] }] };
  const facts: any = { US: new Map(), IN: new Map([['TARIL', f({ p5y: 2100 })], ['EARLYCO', f({})]]) };
  enrich(r, facts);
  const t = r.regions[0].themes[0];
  assert.deepEqual(t.candidates.map((c: any) => c.ticker), ['EARLYCO']);
  assert.deepEqual(t.late.map((c: any) => c.ticker), ['TARIL']);
  assert.equal(t.qualifies, true);
  enrich(r, facts);
  assert.deepEqual(r.regions[0].themes[0].late.map((c: any) => c.ticker), ['TARIL']);
  const r2: any = { regions: [{ region: 'IN', playbook: {}, themes: [{ name: 'T', why: 'w', supply: 'TIGHT', candidates: [cand('TARIL')], reference: [] }] }] };
  enrich(r2, facts);
  assert.equal(r2.regions[0].themes[0].qualifies, false);
});
