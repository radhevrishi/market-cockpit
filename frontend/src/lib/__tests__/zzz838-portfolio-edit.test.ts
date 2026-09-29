import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src/app/(dashboard)/portfolio/page.tsx'), 'utf8');

test('every holding row renders a labelled Edit button, sticky at the right edge', () => {
  assert.match(src, /data-testid=\{`edit-btn-\$\{r\.symbol\}`\}/);
  assert.match(src, /<Edit3[^>]*\/>Edit\s*<\/button>/);
  assert.match(src, /position: 'sticky', right: 0/);
  assert.match(src, /label === 'EDIT'/);
});
test('the edit row opens the entry-price / quantity / notes form for that holding', () => {
  assert.match(src, /EditHoldingRow row=\{r\}/);
  assert.match(src, /handleSaveRow\(r\.symbol, patch\)/);
});
