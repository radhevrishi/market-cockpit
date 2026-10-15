// zzz1045 — /watchlists "% from 50-day / 200-day average" columns: averages from the stock screener snapshot (slim ?tickers= mode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pctFrom, screenerKey, indexAverages } from '../watchlist-averages';

test('pctFrom: one decimal, null when unknown', () => {
  assert.equal(pctFrom(110, 100), 10);
  assert.equal(pctFrom(95, 100), -5);
  assert.equal(pctFrom(null, 100), null);
  assert.equal(pctFrom(100, null), null);
  assert.equal(pctFrom(100, 0), null);
});
test('screenerKey strips exchange prefixes / suffixes, keeps BSE codes', () => {
  assert.equal(screenerKey('NSE:ABCD'), 'ABCD');
  assert.equal(screenerKey('abcd.ns'), 'ABCD');
  assert.equal(screenerKey('543210'), '543210');
  assert.deepEqual(Object.keys(indexAverages([{ t: 'xyz', sma50: 1 }])), ['XYZ']);
});
test('wiring: slim endpoint, columns, page fetch', () => {
  const root = join(__dirname, '..', '..');
  const route = readFileSync(join(root, 'app/api/v1/stock-screener/route.ts'), 'utf8');
  assert.match(route, /SLIM_KEYS = \['t', 'sma50', 'sma200', 'scanPx', 'scanAt'\]/);
  assert.match(route, /slice\(0, 400\)/);
  const consts = readFileSync(join(root, 'app/(dashboard)/watchlists/constants.ts'), 'utf8');
  assert.match(consts, /% from 50-day average/);
  assert.match(consts, /% from 200-day average/);
  const page = readFileSync(join(root, 'app/(dashboard)/watchlists/page.tsx'), 'utf8');
  assert.match(page, /\/api\/v1\/stock-screener\?market=\$\{m\}&tickers=/);
  assert.match(page, /pct50: pctFrom\(p, a\?\.sma50\)/);
});

test('Yahoo quote fallback keeps the quote time and the day range (were dropped: /watchlists showed "time not given" on every row)', () => {
  const y = readFileSync(join(__dirname, '..', 'yahoo.ts'), 'utf8');
  assert.match(y, /regularMarketTime: Number\(meta\.regularMarketTime\) > 0/);
  assert.match(y, /regularMarketTime: \(chart as any\)\.regularMarketTime \?\? null/);
  assert.match(y, /regularMarketDayHigh: \(chart as any\)\.dayHigh \|\| 0/);
});
