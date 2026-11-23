import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maEntry } from '../ma-entries';

test('zzz1300 — moving-average entries', () => {
  assert.equal(maEntry({ px: 102, ema21: 100, sma50: 95, sma200: 80, twSt: 2 })?.kind, 'ema21');
  assert.equal(maEntry({ px: 101, ema21: 106, sma50: 100, sma200: 80, twSt: 2 })?.kind, 'sma50');
  assert.equal(maEntry({ px: 101, ema21: 104, sma50: 108, sma200: 100, twSt: 3 })?.kind, 'sma200');
  assert.equal(maEntry({ px: 99, ema21: 104, sma50: 90, sma200: 100 }), null);           // 50-day far under the 200-day: broken
  assert.equal(maEntry({ px: 101, ema21: 100, sma50: 100, sma200: 80, twSt: 4 }), null); // stage 4
  assert.equal(maEntry({ px: 130, ema21: 110, sma50: 100, sma200: 80 }), null);           // extended
});
