// zzz1254 — the portfolio grades route looks the requested tickers up directly (newest session first) instead of trusting a
// 15-minute whole-index cache, and a graded newer quarter wins over the scan's older one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app/api/v1/portfolio/earnings-grades/route.ts', import.meta.url), 'utf8');

test('requested tickers are looked up directly, sessions read in batches and retried', () => {
  // zzz1262 — the reader moved to lib/graded-session-index (shared with the earnings search and the BSE-code map)
  assert.match(src, /lookupGraded\(tickers\)/);
  const lib = readFileSync(new URL('../graded-session-index.ts', import.meta.url), 'utf8');
  assert.match(lib, /deps\.mget\(keys\)/);
  assert.match(lib, /for \(let attempt = 0; attempt < 2 && !vals; attempt\+\+\)/);
  assert.match(src, /unread_sessions: unread/);
  assert.doesNotMatch(src, /await getIndex\(\)/);
});

test('latest grade = newest quarter, then newest session; a graded newer quarter beats the scan', () => {
  assert.match(src, /qRank\(e\.q\) > qRank\(cur\.q\)/);
  assert.match(src, /gradedAny && scanQuarter && qRank\(gradedAny\.q\) > qRank\(scanQuarter\) \? gradedAny : undefined/);
  assert.match(src, /quarter: gradedQ \? \(gradedQ\.q \|\| scanQuarter \|\| null\)/);
});
