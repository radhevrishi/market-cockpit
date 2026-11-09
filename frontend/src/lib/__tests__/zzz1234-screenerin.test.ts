// zzz1234 — screener.in columns from our own data, and screener.in queries run on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawFromHtml } from '../screener/in-assemble';
import { screenerInColumns, screenerInCsv, SCREENERIN_COLUMNS, industryPeMap } from '../screener/screenerin-columns';
import { compileQuery, tokenize } from '../screener/screenerin-query';
import { SCREENERIN_FROZEN } from '../screener/screenerin-frozen';

const html = readFileSync(join(__dirname, 'fixtures', 'screener-company-kmew.html'), 'utf8');
const raw = rawFromHtml(html, {});
const row = { t: 'KMEW', n: 'Knowledge Marine', px: 2000, mc: 2200, pe: 40, revQYoY: 30, perf3M: 5, perf1Y: 20, hi52: 2500, sma200: 1800, sma50: 1900, roceFY: 25, opmTTM: 35, ind: 'Shipping' };

test('the 63 screener.in columns, with figures worked out from the page', () => {
  assert.equal(SCREENERIN_COLUMNS.length, 63);
  const c = screenerInColumns(raw, row, 30);
  assert.equal(c['NSE Code'], 'KMEW'); assert.equal(c['Industry PE'], 30); assert.equal(c['From 52w high'], 0.8);
  assert.equal(typeof c['Sales latest quarter'], 'number');
  assert.equal(typeof c['Sales growth 3Years'], 'number');
  assert.equal(typeof c['Debt'], 'number');
  assert.equal(c['Promoter holding'], 49.99);
  assert.equal(raw.rv, 4);
  assert.ok(Array.isArray(raw.shpQ?.prom) && raw.shpQ!.prom.length >= 4);
  const csv = screenerInCsv([c]);
  assert.equal(csv.split('\n')[0].split(',').length, 63);
  assert.ok(csv.split('\n')[1].startsWith('Knowledge Marine,,KMEW,'));
});

test('screener.in query: AND / OR, brackets, column against column, unknown names fail the condition', () => {
  const r: any = { 'Market Capitalization': 800, 'Sales growth 3Years': 22, 'Return on capital employed': 18, 'OPM': 21, 'Current Price': 110, 'DMA 200': 100 };
  assert.equal(compileQuery('Market Capitalization > 500 AND Sales growth 3Years > 15').test(r), true);
  assert.equal(compileQuery('Market Capitalization > 500 AND\nSales growth 3Years > 25').test(r), false);
  assert.equal(compileQuery('Market Capitalization > 500 AND (Return on capital employed > 20 OR OPM > 20)').test(r), true);
  assert.equal(compileQuery('Current Price > 1.05 * DMA 200').test(r), true);
  assert.equal(compileQuery('Current Price > 1.2 * DMA 200').test(r), false);
  const u = compileQuery('Market Capitalization > 500 AND Magic score > 3');
  assert.deepEqual(u.unknown, ['Magic score']); assert.equal(u.test(r), false);
  assert.ok(compileQuery('Market Capitalization 500').error);
  assert.equal(tokenize('Sales growth 3Years >= 15')[0].k, 'col');
  assert.equal(industryPeMap([{ ind: 'A', pe: 10 }, { ind: 'A', pe: 20 }, { ind: 'A', pe: 30 }]).get('A'), 20);
  assert.ok(SCREENERIN_FROZEN['watchlist-10432429'].length > 10);
});
