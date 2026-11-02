import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression: the server's soft 32s budget may process far fewer than 80 PDFs.
// Starting page 2 at 80 would silently omit filings [analyzed, 80).
test('UI pagination cursor advances by successful examinations, not request limit', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'app/(dashboard)/concall-intel/components2.tsx'), 'utf8');
  assert.match(src, /if \(!j\.error\) setExtraOffset\(j\.analyzed\)/);
  assert.match(src, /setExtraOffset\(o => o \+ page\.analyzed\)/);
  assert.doesNotMatch(src, /setExtraOffset\(80\)/);
  assert.match(src, /limit=40&offset=\$\{extraOffset\}/);
});

test('server resumes the sorted scan at supplied offset and returns processed count', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'app/api/v1/concall-intel/transformation-screener/route.ts'), 'utf8');
  assert.match(src, /slice\(offset, offset \+ limit\)/);
  assert.match(src, /analyzed: entries\.length/);
  assert.match(src, /TIME_BUDGET_MS/);
});
