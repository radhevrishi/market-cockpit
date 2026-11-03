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
  // zzz1212 — "analysed" = substantive documents read in full (never notices, covering letters or subject lines)
  assert.match(s, /analyzed:\s*funnel\.read_full/);
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
 assert.match(src, /timeBudgetMs: 30_000/);
 assert.match(src, /Date\.now\(\) - START > mode\.timeBudgetMs/);
 assert.match(src, /setImmediate\(resolve\)/);
});

test('radar reads further documents in bounded batches without automatic full-feed work (zzz1212)', () => {
  const code = route(), ui = view();
  // every document result is stored per attachment URL; a scan reads only documents not stored yet, newest first, within a budget
  assert.match(code, /const unread = eligible\.filter\(\(e\) => !stored\.has\(e\.url\)\)/);
  assert.match(code, /unread\.slice\(0, mode\.readBudget\)/);
  assert.match(code, /MODE_MORE: ScanMode = \{ feedForce: false, readBudget: 40/);
  assert.match(code, /transform-screener:swr:v9:/);
  assert.match(ui, /limit=3000&more=1/);
  assert.match(ui, /Read next \$\{Math\.min\(40, fn\.not_yet_read\)\} unread documents now/);
  assert.doesNotMatch(ui, /&offset=/);
});
