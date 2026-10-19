// zzz1047f — Guidance Upgrades: no rows of blank dashes, and a BSE-code screener.in slug read back as a number no longer crashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('figures missing or loading → one merged cell, never six dashes', () => {
  const s = read('components/guidance-upgrades/GuFocusList.tsx');
  assert.match(s, /colSpan=\{FV_COLS \+ OPP_COLS \+ 1 - \(cols === 'compact' \? 2 : 0\)\}/);   // zzz1142: fewer columns in Compact
  assert.match(s, /Reading company figures…/);
  assert.match(s, /Company figures not on screener\.in yet/);
  const fv = read('components/guidance-upgrades/GuFairValue.tsx');
  assert.match(fv, /colSpan=\{2\}[^>]*>No fair value: /);
});

test('screener.in slug from the store is always text (BMW: "n.toUpperCase is not a function")', () => {
  const s = read('app/api/v1/guidance-upgrades/skygold/route.ts');
  assert.match(s, /const hit = raw == null \? null : String\(raw\);/);
  assert.match(s, /const slug = picked == null \? null : String\(picked\);/);
});
