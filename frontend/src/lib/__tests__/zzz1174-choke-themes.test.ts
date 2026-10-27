// zzz1174 → zzz1183 — Choke-Point Themes v2: schema, wiring, AI on click only, text copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHOKE_TOOL, CHOKE_SYSTEM, cleanChoke, chokeAsText, type ChokeReport } from '../choke-themes/core';
import { isStrictSchema, toStrictSchema } from '../ai-schemas';

export const cand = (ticker: string, over: any = {}) => ({ name: `${ticker} Ltd`, ticker, exposure: 'DIRECT', jstage: 'J2', product: 'HV bushings', inflection: 'Reported: export orders up', milestone: 'Q3 results', invalidation: 'orders slip', concern: 'None found in available disclosures', scenario: null, ...over });
export const theme = (name: string, cands: any[], ref: any[] = []) => ({ name, emoji: '⚡', keywords: ['a', 'b', 'c', 'd'], why: 'Driver.', necessity: 'n', constraint: 'c', value_capture: 'v', tightness: 'Lead times extended (test)', breakers: 'b', unknowns: 'u', evidence: null, candidates: cands, reference: ref });
const pb = { strongest: ['x'], confirm: [], milestones: [], disconfirming: [], valuation: [] };

test('schema is strict-able; no theme quota (1–8); the prompt asks for company evidence, not sector stories', () => {
  assert.ok(isStrictSchema(toStrictSchema(CHOKE_TOOL.input_schema as any) as any));
  const themes = (CHOKE_TOOL.input_schema as any).properties.regions.items.properties.themes;
  assert.equal(themes.minItems, 1);
  assert.match(CHOKE_SYSTEM, /Which specific small or mid-cap company/); assert.match(CHOKE_SYSTEM, /Europe\+1/);
  assert.match(CHOKE_SYSTEM, /a past rally does not end a J-curve/); assert.doesNotMatch(CHOKE_SYSTEM, /-30%, -50%, -70%/);
  const c = cleanChoke({ regions: [{ region: 'IN', themes: [theme('T', [cand('A')])], playbook: pb }, { region: 'US', themes: [], playbook: pb }] })!;
  assert.deepEqual(c.regions.map((g) => g.region), ['US', 'IN']); assert.equal(c.regions[0].themes.length, 0, 'a region may have no qualifying theme');
});

test('text copy: mechanism, candidates with stage, reference leaders, playbook', () => {
  const c = cleanChoke({ regions: [{ region: 'US', themes: [theme('Power delivery', [cand('VICR')], [cand('NVDA', { exposure: 'PROXY', jstage: 'J4' })])], playbook: pb }, { region: 'IN', themes: [], playbook: pb }] })!;
  const t = chokeAsText({ version: 2, ...c, generatedAt: '', model: null, newsUsed: 0, asOfNews: null } as ChokeReport);
  assert.match(t, /🔥 Power delivery ⚡\nWhy: Driver\.\nNecessity: n/); assert.match(t, /• VICR Ltd \(VICR\) — DIRECT, J2 · early inflection/);
  assert.match(t, /Reference leaders: NVDA Ltd \(NVDA\)/); assert.match(t, /No qualifying themes in this run/);
});

test('wiring: protected API, POST starts a background run, GET never calls the AI, panel mounted', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(src('../site-auth.ts'), /'\/api\/v1\/choke-themes'/);
  const route = src('../../app/api/v1/choke-themes/route.ts');
  assert.match(route, /export async function POST\(\)[\s\S]*runChoke\(\)/);
  assert.doesNotMatch(route.split('export async function POST')[0], /runChoke\(/);
  assert.match(src('../../app/(dashboard)/news/page.tsx'), /<ChokeThemesPanel \/>/);
});
