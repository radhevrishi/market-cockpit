// zzz1178 — Future 100-baggers + early-theme inputs: real companies only, totals summed here, shortlist rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HB_TOOL, HB_FACTORS, cleanHb } from '../hundred-baggers/core';
import { hundredBaggerShortlist, industryInflections, toCand, type Cand } from '../screener/ai-candidates';
import { CHOKE_TOOL, CHOKE_SYSTEM } from '../choke-themes/core';
import { isStrictSchema, toStrictSchema } from '../ai-schemas';

const row = (t: string, over: any = {}) => toCand({ t, n: `${t} Inc`, ind: 'Semiconductors', mc: 2000, revQYoY: 40, revAYoY: 30, epsQYoY: 50, opmTTM: 20, roceTTM: 25, de: 0.2, pe: 30, ps: 5, fcfmTTM: 10, perf1Y: 40, perf5Y: 100, bb: 0, fs: 7, ...over })!;

test('shortlist: size band, growth, low debt, little dilution, not priced for perfection', () => {
  const all = [row('OK'), row('BIG', { mc: 90000 }), row('TINY', { mc: 100 }), row('SLOW', { revAYoY: 3, revQYoY: 2 }), row('DEBT', { de: 3 }), row('DILUTE', { bb: -20 }), row('PRICY', { ps: 60 })];
  assert.deepEqual(hundredBaggerShortlist(all, 'US').map((c) => c.t), ['OK']);
  assert.deepEqual(hundredBaggerShortlist([row('INOK', { mc: 9000 })], 'IN').map((c) => c.t), ['INOK'], 'India band in ₹ Cr');
});

test('picks must come from the shortlist; the total is the sum of the 15 scores (never the model\'s)', () => {
  const sl = { US: ['A', 'B', 'C', 'D'].map((t) => row(t)), IN: ['X', 'Y', 'Z'].map((t) => row(t)) } as Record<'US' | 'IN', Cand[]>;
  const scores = Object.fromEntries(HB_FACTORS.map(([k]) => [k, 7]));
  const pick = (t: string) => ({ ticker: t, thesis: 't', scores, forward_metrics: '', moat: '', megatrend: '', valuation: '', risks: '', classification: 'SECULAR_COMPOUNDER', missing: '', total: 999 });
  const out = cleanHb({ markets: [{ market: 'US', note: '', picks: [pick('A'), pick('FAKE'), pick('B'), pick('NSE:C')] }, { market: 'IN', note: '', picks: [pick('X'), pick('Y'), pick('Z')] }] }, sl)!;
  assert.deepEqual(out[0].picks.map((p) => p.ticker), ['A', 'B', 'C']);
  assert.equal(out[0].picks[0].total, 105); assert.ok(out[0].picks[0].data);
  assert.equal(cleanHb({ markets: [{ market: 'US', picks: [pick('FAKE')] }, { market: 'IN', picks: [] }] }, sl), null);
});

test('themes: industry acceleration data and the "be early, not consensus" rule', () => {
  const lines = industryInflections([row('M1', { ind: 'Memory', revQYoY: 90, revAYoY: 10 }), row('M2', { ind: 'Memory', revQYoY: 70, revAYoY: 5 }), row('M3', { ind: 'Memory', revQYoY: 60, revAYoY: 8 }), row('M4', { ind: 'Memory', revQYoY: 50, revAYoY: 0 }), row('S1', { ind: 'Solar', revQYoY: 2, revAYoY: 5 }), row('S2', { ind: 'Solar' }), row('S3', { ind: 'Solar' }), row('S4', { ind: 'Solar' })], 'US');
  assert.match(lines[0], /^Memory .*100% of companies accelerating/);
  assert.match(CHOKE_SYSTEM, /OPERATING evidence/); assert.match(CHOKE_SYSTEM, /solar/i);
  assert.ok(isStrictSchema(toStrictSchema(CHOKE_TOOL.input_schema as any) as any));
  assert.ok(isStrictSchema(toStrictSchema(HB_TOOL.input_schema as any) as any));
});

test('wiring: protected API, nav entry after News Feed, page default export only', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(src('../site-auth.ts'), /'\/api\/v1\/hundred-baggers'/);
  assert.match(src('../../app/(dashboard)/DashboardClient.tsx'), /'\/news',[^\n]*\n\s*\{ href: '\/hundred-baggers'/);
  const pg = src('../../app/(dashboard)/hundred-baggers/page.tsx');
  assert.doesNotMatch(pg, /^export (?!default)/m);
});

test('zzz1184: data flags (cash burn, debt, dilution, acquisition-boosted quarter, already ran, rich P/E); scenario calculated; no promised multiple in the class', async () => {
  const { hbFlags, HB_CLASS_WORD } = await import('../hundred-baggers/core');
  const f = hbFlags(row('R', { fcfmTTM: -55, de: 1.0, bb: -6, revQYoY: 188, revAYoY: 69, perf5Y: 500, pe: 80 }));
  for (const re of [/cash burn/, /D\/E 1\.0/, /dilution/, /acquisition or a low base/, /6x in 5 years/, /P\/E 80/]) assert.ok(f.some((x) => re.test(x)), String(re));
  assert.deepEqual(hbFlags(row('CLEAN')), []);
  assert.doesNotMatch(HB_CLASS_WORD.SECULAR_COMPOUNDER, /×|x\b/);
  const sl = { US: ['A', 'B', 'C'].map((t) => row(t, { pe: 25 })), IN: ['X', 'Y', 'Z'].map((t) => row(t)) } as Record<'US' | 'IN', Cand[]>;
  const scores = Object.fromEntries(HB_FACTORS.map(([k]) => [k, 6]));
  const pick = (t: string, scenario: any = null) => ({ ticker: t, thesis: '', scores, forward_metrics: '', moat: '', megatrend: '', valuation: '', risks: '', classification: 'SECULAR_COMPOUNDER', missing: '', scenario });
  const sc = { years: 5, eps_cagr: { bear: 5, base: 20, bull: 30 }, exit_pe: { bear: 15, base: 25, bull: 30 }, dilution_pct: 0, basis: 'b' };
  const out = cleanHb({ markets: [{ market: 'US', note: '', picks: [pick('A', sc), pick('B'), pick('C')] }, { market: 'IN', note: '', picks: [pick('X'), pick('Y'), pick('Z')] }] }, sl)!;
  const a = out[0].picks.find((p) => p.ticker === 'A')!;
  assert.equal(a.multiples!.base, Math.round(1.2 ** 5 * 100) / 100);
  assert.equal(out[0].picks.find((p) => p.ticker === 'B')!.multiples, null);
});
