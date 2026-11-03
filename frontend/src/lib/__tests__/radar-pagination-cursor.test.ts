import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression (originally: the server's soft time budget may process fewer PDFs than requested, and a page-2 offset of 80
// silently skipped filings). zzz1212 replaced offsets: every document's result is stored per attachment URL, and each scan
// reads the documents NOT stored yet, newest first — so a short scan can never skip one; it simply stays unread and is
// reported as "not read yet".
test('no offset cursor: the next read always starts at the newest unread document', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'app/(dashboard)/concall-intel/components2.tsx'), 'utf8');
  assert.doesNotMatch(src, /setExtraOffset/);
  assert.match(src, /limit=3000&more=1/);
});

test('server reads unread documents only, stores each result, and counts what stayed unread', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'app/api/v1/concall-intel/transformation-screener/route.ts'), 'utf8');
  assert.match(src, /const stored = await readDocResults\(eligible\.map\(\(e\) => e\.url\)\)/);
  assert.match(src, /\[\.\.\.unread, \.\.\.refresh\]\.slice\(0, mode\.readBudget\)/);   // zzz1224: unread first, then the coverage backfill
  assert.match(src, /kvSet\(DOC_KEY\(url\), res, ttl\)/);
  assert.match(src, /if \(!res\) \{ funnel\.not_yet_read\+\+; continue; \}/);
  assert.match(src, /analyzed: funnel\.read_full/);
});
