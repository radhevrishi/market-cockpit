// Regression coverage for bounded Transformation Radar scans and no-false-empty UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = () => readFileSync(new URL('../../app/api/v1/concall-intel/transformation-screener/route.ts', import.meta.url), 'utf8');
const view = () => readFileSync(new URL('../../app/(dashboard)/concall-intel/components2.tsx', import.meta.url), 'utf8');
const types = () => readFileSync(new URL('../../app/(dashboard)/concall-intel/types.ts', import.meta.url), 'utf8');

test('even an explicit fresh rescan has the same bounded wait as a cold radar request', () => {
  const s = route();
  assert.match(s, /waitMs:\s*SCREEN_WAIT_MS/);
  assert.doesNotMatch(s, /waitMs:\s*forceFresh\s*\?\s*undefined/);
  assert.match(s, /SwrPendingError/);
  assert.match(s, /building:\s*true/);
  assert.match(s, /SCREEN_WAIT_MS\s*=\s*9_000/);
});

test('scanned count is actual completed analysis, not the selection before the time budget', () => {
  const s = route();
  assert.match(s, /analyzed:\s*entries\.length/);
  assert.doesNotMatch(s, /analyzed:\s*withPdf\.length/);
});

test('radar never claims zero signals when an async scan is still being built', () => {
  const s = view();
  assert.match(s, /if\s*\(j\.building\)/);
  assert.match(s, /!building\s*&&\s*!loading\s*&&\s*entries\.length\s*===\s*0/);
  assert.match(s, /Radar scanning in the background/);
  assert.match(s, /setTimeout\(\(\) => \{ void load\(days\); \}, 8_000\)/);
  assert.match(types(), /building\?: boolean/);
});

test('radar fetches time out, stale results survive, and market-cap enrichment is bounded', () => {
  const s = view();
  assert.match(s, /AbortSignal\.timeout\(18_000\)/);
  assert.match(s, /AbortSignal\.timeout\(12_000\)/);
  assert.match(s, /setData\(\(prev\) => prev && prev\.entries\.length > 0 \? prev : j\)/);
  assert.match(s, /requestId !== requestSeq\.current/);
  assert.match(s, /building \|\| loading/);
});
