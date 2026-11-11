// zzz1265 — Guidance Upgrades: a figure whose SOURCE LABEL is a margin / share / one site / pro forma is never ranked as company
// growth (Kontoor's gross margin in basis points ranked first as "EBITDA +350–370%"); the list answer is kept and validated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { growthLabelHold } from '../guidance-prior-match';

const read = (...p: string[]) => readFileSync(new URL(['..', ...p].join('/'), import.meta.url), 'utf8');

test('label hold: margin, share, one site / segment, pro forma — company-wide labels pass', () => {
  assert.match(growthLabelHold('Adjusted gross margin from continuing operations', 'EBITDA')!, /margin/);
  assert.match(growthLabelHold('Gross margin', 'REVENUE')!, /margin/);
  assert.match(growthLabelHold('HALS share of company revenue', 'REVENUE')!, /share/);
  assert.match(growthLabelHold('Dahej_site_revenue_guidance', 'REVENUE')!, /one part of the company/);
  assert.match(growthLabelHold('FY26 sales pro forma increase', 'REVENUE')!, /pro-forma/);
  assert.equal(growthLabelHold('Revenue growth guidance', 'REVENUE'), null);
  assert.equal(growthLabelHold('Consolidated segment revenue total', 'REVENUE'), null);
  assert.equal(growthLabelHold('EBITDA margin growth', 'EBITDA'), null);     // growth is named
  assert.equal(growthLabelHold(null, 'REVENUE'), null);
});

test('wired: the growth groups use the label rule and drop a yearly figure repeated as a multi-year rate', () => {
  const src = read('guidance-universe.ts');
  assert.match(src, /growthLabelHold\(p\.sourceMetricLabel, p\.metricFamily\)/);
  assert.match(src, /annualTwin\.has\(/);
});

test('the universe list is memoised with an ETag and warmed at boot; force and entity reads bypass the memo', () => {
  const route = read('..', 'app', 'api', 'v1', 'guidance-universe', 'route.ts');
  assert.match(route, /cachedRoute\(req, \{ key, freshMs: 30_000/);
  assert.match(route, /sp\.get\('force'\) === '1' \|\| sp\.get\('entity'\)\) return universeGET\(req\)/);
  assert.match(read('boot-warm.ts'), /getUniverseBundle\(Date\.now\(\), false\)/);
});
