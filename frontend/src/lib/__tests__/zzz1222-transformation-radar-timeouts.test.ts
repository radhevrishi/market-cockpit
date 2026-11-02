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
  assert.match(s, /if\s*\(j\.building\s*\|\|\s*oldSnapshot\)/);
  assert.match(s, /!building\s*&&\s*!loading\s*&&\s*entries\.length\s*===\s*0/);
  assert.match(s, /Radar scanning in the background/);
  assert.match(s, /setTimeout\(\(\) => \{ void load\(days\); \}, 8_000\)/);
  assert.match(types(), /building\?: boolean/);
});

test('radar fetches time out, stale results survive, and market-cap enrichment is bounded', () => {
  const s = view();
  assert.match(s, /AbortSignal\.timeout\(18_000\)/);
  assert.match(s, /pendingSince/);
  assert.match(s, /setBuilding\(true\); \/\/ automatic cache-only polling/);
  assert.match(s, /void load\(days\); \}, 90_000/);
  assert.doesNotMatch(s, /retries\.current\+\+; load\(days, true\)/);
  assert.match(s, /AbortSignal\.timeout\(12_000\)/);
  assert.match(s, /setData\(\(prev\) => prev && prev\.entries\.length > 0 \? prev : j\)/);
  assert.match(s, /requestId !== requestSeq\.current/);
  assert.match(s, /refreshStartedAt/);
  assert.match(s, /Date\.parse\(j\.generated_at\) < refreshAt - 1_000/);
  assert.match(s, /building \|\| loading/);
});


test('KV lookup is bounded BEFORE the nine-second scan deadline, including fallback reads', () => {
  const route = readFileSync(new URL('../../app/api/v1/concall-intel/transformation-screener/route.ts', import.meta.url), 'utf8');
  const swr = readFileSync(new URL('../swr-cache.ts', import.meta.url), 'utf8');
  assert.match(route, /readWaitMs:\s*2_000/);
  assert.match(swr, /readWaitMs\?: number/);
  assert.match(swr, /boundedRead\(store\.get<Envelope<T>>\(kvKeyOf\(o\.key\)\), o\.readWaitMs\)/);
});


test('radar throttles PDF parsing to keep the rest of the application responsive', () => {
 const src = route();
 assert.match(src, /const CONC = 3/);
 assert.match(src, /TIME_BUDGET_MS = 32_000/);
 assert.match(src, /setImmediate\(resolve\)/);
});

test('radar can scan additional bounded older batches without automatic full-feed work', () => {
  const code = route(), ui = view();
  assert.match(code, /get\('offset'\)/);
  assert.match(code, /slice\(offset, offset \+ limit\)/);
  assert.match(code, /transform-screener:swr:v6:/);
  assert.match(code, /offset === 0 \? `transform-screener:swr:v5:/);
  assert.match(ui, /Scan next 40 unreviewed filings/);
  assert.match(ui, /\&offset=\$\{extraOffset\}/);
  assert.match(ui, /setExtraOffset\(o => o \+ page\.analyzed\)/);
});
