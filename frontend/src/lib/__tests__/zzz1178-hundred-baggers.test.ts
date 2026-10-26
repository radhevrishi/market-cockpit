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
  assert.match(CHOKE_SYSTEM, /Micron and SanDisk/); assert.match(CHOKE_SYSTEM, /solar/i);
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
