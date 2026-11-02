// zzz1203 — fewer Upstash commands: a family whose REST retries never find anything stops retrying (misses cost one command,
// not two); ledger writes read tickers the caller did not; live-feed writes back only filings it reads; bhav answers from memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RestFallbackLearner } from '../kv-read-cache';

test('REST retry is learned per family and re-learned later', () => {
  let t = 0;
  const l = new RestFallbackLearner(() => t, 5, 1000);
  for (let i = 0; i < 5; i++) { assert.equal(l.shouldRetry(`bhav:v1:2026-10-30:X${i}`), true); l.note(`bhav:v1:2026-10-30:X${i}`, false); }
  assert.equal(l.shouldRetry('bhav:v1:2026-10-30:Y'), false);
  // a family that once found a value keeps retrying
  for (let i = 0; i < 9; i++) l.note(`universe:v2:${i}`, i === 3);
  assert.equal(l.shouldRetry('universe:v2:z'), true);
  t = 2000;
  assert.equal(l.shouldRetry('bhav:v1:2026-10-30:Y'), true);   // re-learned
});

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
test('wired: kv skips learned misses, ledger reads missing tickers, live-feed writes only looked-up hashes, bhav memory first', () => {
  assert.match(read('lib/kv.ts'), /REST_LEARN\.shouldRetry\(key\)/);
  assert.match(read('lib/guidance-upgrades-ledger.ts'), /readLedgersStrict\(part, market\)/);
  assert.match(read('app/api/v1/concall-intel/live-feed/route.ts'), /filter\(\(s\) => looked\.has\(s\.content_hash\)\)/);
  const b = read('lib/nse-bhavcopy.ts');
  assert.ok(b.indexOf('_memCache.get(isoDate);\n  if (inMem') < b.indexOf('kvGet<BhavData>'));
});
