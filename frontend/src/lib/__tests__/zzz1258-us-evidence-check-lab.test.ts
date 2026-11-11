// zzz1258 — scheduled US SEC evidence check (no model), Company Lab Earnings link opens the company's own result day (?d=),
// honest FCF wording on negative cash flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_JOBS } from '../app-scheduler';

const read = (...p: string[]) => readFileSync(new URL(['..', ...p].join('/'), import.meta.url), 'utf8');

test('us-evidence-check is scheduled, discovery only, resumable', () => {
  const j = APP_JOBS.find((x) => x.name === 'us-evidence-check');
  assert.ok(j, 'job exists');
  assert.match(j!.does, /no model/);
  const src = read('app-scheduler.ts');
  assert.match(src, /\/api\/v1\/us-thesis\/check-all\?offset=\$\{offset\}&limit=60/);
  assert.match(src, /next_offset/);
  assert.doesNotMatch(src.slice(src.indexOf('export async function usEvidenceCheckJob'), src.indexOf('// ── the job list')), /us-thesis\/read/);
});

test('Earnings Opportunities (India and US) open the day in ?d=; the Lab link passes the company\'s result day', () => {
  assert.match(read('..', 'app', '(dashboard)', 'earnings-opportunities', 'page.tsx'), /get\('d'\)/);
  assert.match(read('..', 'app', '(dashboard)', 'us-earnings-opportunities', 'page.tsx'), /get\('d'\)/);
  assert.match(read('..', 'app', '(dashboard)', 'company-lab', 'page.tsx'), /&d=\$\{c\.record\.resultDate\}/);
});

test('FCF growth from a zero or negative base is not a rate; averages say how many years they rest on', () => {
  const core = read('company-lab', 'core.ts');
  assert.match(core, /fcfG: p && fin\(p\.fcf\) && p\.fcf > 0 \? growthPct/);
  assert.match(core, /yrs with positive FCF/);
  assert.match(read('..', 'app', '(dashboard)', 'company-lab', 'page.tsx'), /free cash flow was negative, so years-to-repay cannot be worked out/);
});
