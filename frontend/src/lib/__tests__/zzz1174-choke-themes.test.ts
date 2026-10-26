// zzz1174 — Choke-Point Themes on the News page: AI only on click, last run shown otherwise, the owner's exact format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHOKE_TOOL, cleanChoke, chokeAsText, type ChokeReport } from '../choke-themes/core';
import { isStrictSchema, toStrictSchema } from '../ai-schemas';

const theme = (n: string) => ({ name: n, emoji: '🌍⚡', why: 'Decoupling from China.', leaders: [{ name: 'MP Materials', ticker: 'MP', note: null }, { name: 'Lynas', ticker: 'LYC, ASX', note: 'ex-China refining' }], bear: '-70% in a liquidity bear.', bull: '5–10x into the 2030s.', evidence: null });
const region = (r: string) => ({ region: r, themes: [1, 2, 3, 4, 5, 6].map((i) => theme(`Theme ${r}${i}`)), playbook: { dominant: ['A', 'B', 'C'], accumulation: 'Tranches at -30%, -50%, -70%.' } });

test('schema is strict-able; both countries required, US first', () => {
  assert.ok(isStrictSchema(toStrictSchema(CHOKE_TOOL.input_schema as any) as any));
  const c = cleanChoke({ regions: [region('IN'), region('US')], changes: [] })!;
  assert.deepEqual(c.regions.map((g) => g.region), ['US', 'IN']);
  assert.equal(cleanChoke({ regions: [region('US')], changes: [] }), null, 'India missing = not stored');
});

test('text copy follows the format: 🔥 Theme → Why → Leaders → Asymmetry, then 🎯 Investor Playbook', () => {
  const r: ChokeReport = { ...cleanChoke({ regions: [region('US'), region('IN')], changes: [] })!, generatedAt: '2026-10-26T18:00:00Z', model: 'x', newsUsed: 10, asOfNews: null };
  const t = chokeAsText(r);
  assert.match(t, /🔥 Theme US1 🌍⚡\nWhy: Decoupling from China\.\nLeaders: MP Materials \(MP\), Lynas \(LYC, ASX\)\.\nAsymmetry: Bear: -70%/);
  assert.ok(t.indexOf('🎯 Investor Playbook — US') < t.indexOf('🇮🇳 INDIA'));
});

test('wiring: protected API, POST runs the AI, page mounts the panel, no AI on load', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(src('../site-auth.ts'), /'\/api\/v1\/choke-themes'/);
  const route = src('../../app/api/v1/choke-themes/route.ts');
  assert.match(route, /export async function POST\(\)[\s\S]*runChoke\(\)/);
  assert.doesNotMatch(route.split('export async function POST')[0], /runChoke\(/, 'GET never calls the AI');
  assert.match(src('../../app/(dashboard)/news/page.tsx'), /<ChokeThemesPanel \/>/);
  assert.match(src('../choke-themes/run.ts'), /CHOKE_DAILY_MAX = 6/);
});
