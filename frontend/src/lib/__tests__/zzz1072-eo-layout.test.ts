// zzz1072 — Earnings Opportunities (India + USA): wider frame (1880px, side margins scale with the screen) and the India
// description on the title row (one compact line) instead of a separate paragraph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

test('both Earnings Opportunities pages use the wider frame', () => {
  for (const p of ['app/(dashboard)/earnings-opportunities/page.tsx', 'app/(dashboard)/us-earnings-opportunities/page.tsx']) {
    const s = read(p);
    assert.match(s, /maxWidth: 1880/, p);
    assert.match(s, /padding: '20px clamp\(16px, 2\.2vw, 36px\)'/, p);
    assert.doesNotMatch(s, /padding: '20px', maxWidth: 1500/, p);
  }
});

test('India header: description and How it works on the title row, no separate paragraph', () => {
  const s = read('app/(dashboard)/earnings-opportunities/page.tsx');
  assert.doesNotMatch(s, /maxWidth: 980 \}\}>\s*Yesterday/);
  const head = s.slice(s.indexOf('<h1 style'), s.indexOf('PATCH 0698'));
  assert.match(head, /Filed results graded into/);
  assert.match(head, /How it works/);
});
