// zzz1102 (deep audit N04) — a saved Pine screen keeps its Technicals-list scope through save / clean / vault round trip,
// and every fixed "Companies" option on the page is a scope the saved-screen cleaner accepts (except the one-off hand-over).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanScopeValue, cleanPineScreens, SAVED_SCOPES, DEFAULT_QUERY } from '../screener/pine';

test('tech survives cleaning, alone and inside a saved screen', () => {
  assert.equal(cleanScopeValue('tech'), 'tech');
  const saved = [{ id: 'qa-tech', name: 'QA tech', market: 'US', q: DEFAULT_QUERY, scope: 'tech' }];
  const back = cleanPineScreens(JSON.parse(JSON.stringify(cleanPineScreens(saved))));
  assert.equal(back[0].scope, 'tech');
  assert.equal(cleanScopeValue('hand'), undefined, 'the one-off hand-over is not a saved scope');
  assert.equal(cleanScopeValue('junk'), undefined);
});

test('every fixed option value in the page select is a saved scope', () => {
  const src = readFileSync(new URL('../../components/pine-screener/PineScreener.tsx', import.meta.url), 'utf8');
  const sel = src.slice(src.indexOf('aria-label="Limit to a list"'), src.indexOf('</select>', src.indexOf('aria-label="Limit to a list"')));
  const vals = Array.from(sel.matchAll(/<option value="([^"`{]*)"/g)).map((m) => m[1]).filter((v) => v !== 'hand');
  assert.ok(vals.length >= 4);
  for (const v of vals) assert.ok(SAVED_SCOPES.includes(v), `option ${JSON.stringify(v)} is saved`);
});
