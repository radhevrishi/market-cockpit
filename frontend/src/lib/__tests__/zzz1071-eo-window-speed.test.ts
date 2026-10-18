// zzz1071 — Earnings Opportunities window slow / empty ("0 of 13 days ready" for 15–40 s): every page open force-regraded the
// past 7 days and deleted their saved copies, which tied up the server while the window read waited. The sweep is gone, and the
// window shows this browser's saved days at once, then the server's copy. Also: personal-data saves refused at 3 MB (the US
// Conviction Beats list was never backed up) — the limit is 8 MB, with fewer old versions kept for large values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const PAGE = 'app/(dashboard)/earnings-opportunities/page.tsx';
const HOOK = 'app/(dashboard)/earnings-opportunities/useIndiaEarningsWindow.ts';

test('no automatic forced regrade sweep on page open (and no deleting of saved days)', () => {
  const s = read(PAGE);
  assert.doesNotMatch(s, /past7\.forEach/);
  assert.doesNotMatch(s, /sessionWarmedRef/);
  assert.doesNotMatch(s, /localStorage\.removeItem\('mc:graded:v10:' \+ iso\)/);
  // the hand-pressed Force button still forces
  assert.match(s, /graded\?date=\$\{resolvedDateForGrading\}&force=1/);
});

test('window shows saved days at once and still reads the server copy for them', () => {
  const h = read(HOOK);
  assert.match(h, /seed\?: \(date: string\) => any \| undefined/);
  assert.match(h, /seeded: true/);
  assert.match(h, /if \(e\.seeded\) return true;/, 'a seeded day is still read from the store');
  assert.match(read(PAGE), /seed: \(d\) => readLsCache\(d\)/);
});

test('personal-data saves: 8 MB limit; large values keep 10 old versions', async () => {
  const { MAX_VALUE_BYTES } = await import('../user-state-store');
  assert.equal(MAX_VALUE_BYTES, 8_000_000);
  const s = read('lib/user-state-store.ts');
  assert.match(s, /bytes > LARGE_VALUE_BYTES \? HISTORY_KEEP_LARGE : HISTORY_KEEP/);
});
