import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionCheck } from '../tech-extension';

test('zzz961 extended: owner rule 30% over 50-day / 90% over 200-day, plus 10 daily ranges', () => {
  assert.equal(extensionCheck({ pctVsSma50: 35, pctVsSma200: 60, adrPct: 6 }).extended, true);
  assert.equal(extensionCheck({ pctVsSma50: 20, pctVsSma200: 95, adrPct: 6 }).extended, true);
  assert.equal(extensionCheck({ pctVsSma50: 22, pctVsSma200: 40, adrPct: 2 }).extended, true);   // quiet stock, 11 ranges
  assert.equal(extensionCheck({ pctVsSma50: 22, pctVsSma200: 40, adrPct: 5 }).extended, false);
  assert.equal(extensionCheck({ pctVsEma50: 31 }).extended, true);                               // EMA fallback
  assert.equal(extensionCheck(undefined).extended, false);                                       // no data → kept
  assert.equal(extensionCheck({ pctVsSma50: 5, pctVsSma200: 12 }).extended, false);
});
