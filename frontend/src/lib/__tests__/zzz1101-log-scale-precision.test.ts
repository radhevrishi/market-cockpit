// zzz1101 (deep audit N01 / N03) — the log price axis round-trips every positive price (a $0.10 stock no longer shows −2.0000
// labels), equal % moves are equal distances, a band below zero cannot corrupt the axis; ATR / MACD follow the price decimals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logFwd, logInv, logBounds } from '../log-scale';
import { studyDecimals } from '../chart-layouts';

test('round trip 0.0001 … 1,000,000 returns the same positive price', () => {
  for (const p of [0.0001, 0.001, 0.01, 0.0950, 0.1, 0.5, 0.99, 1, 1.01, 2, 33.5, 1932.25, 1e6]) {
    const back = logInv(logFwd(p));
    assert.ok(back > 0, `${p} stays positive`);
    assert.ok(Math.abs(back - p) / p < 1e-12, `${p} → ${back}`);
  }
});

test('equal percentage moves are equal distances, also across $1', () => {
  const d1 = logFwd(0.5) - logFwd(0.25), d2 = logFwd(2) - logFwd(1), d3 = logFwd(200) - logFwd(100);
  assert.ok(Math.abs(d1 - d2) < 1e-12 && Math.abs(d2 - d3) < 1e-12);
});

test('a range whose bottom is a study band below zero stays a positive axis over the prices', () => {
  const b = logBounds(-0.03, 0.12, 0.08);
  assert.equal(b.min, 0.08); assert.equal(b.max, 0.12);
  const c = logBounds(-5, 100);
  assert.ok(c.min > 0 && c.min < 100);
  assert.ok(Number.isFinite(logFwd(-1)) && Number.isFinite(logFwd(0)), 'non-positive input does not give NaN / −Infinity');
});

test('price-unit studies follow the instrument precision; OBV is whole shares', () => {
  assert.equal(studyDecimals('ATR', 4), 4);
  assert.equal(studyDecimals('MACD', 4), 4);
  assert.equal(studyDecimals('OBV', 4), 0);
  assert.equal(studyDecimals('RSI', 4), 2);
  const src = readFileSync(new URL('../../components/charts/kline-setup.ts', import.meta.url), 'utf8');
  assert.match(src, /name: 'MC_ATR', shortName: 'ATR', series: 'price'/);
  assert.match(src, /name: 'MC_MACD', shortName: 'MACD', series: 'price'/);
  assert.doesNotMatch(src, /-\(10 \*\* Math\.abs/, 'old sign-guessing inverse is gone');
});
