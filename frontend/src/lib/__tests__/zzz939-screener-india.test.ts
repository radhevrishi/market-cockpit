// zzz939 — India screener: NSE files, the screener.in page figures, and the gross-margin rule for service companies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBhav, parseEquityList } from '../screener/in-build';
import { inFigures } from '../screener/in-assemble';
import { BUILT_IN_SCREENS } from '../screener/filters';

test('NSE company list and daily price file', () => {
  const eq = parseEquityList('SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING\n20MICRONS,20 Microns Limited,EQ,06-OCT-2008\nXYZ,"Xyz, Ltd",BE,01-JAN-2020\nBOND1,Some Bond,N1,01-JAN-2020\n');
  assert.deepEqual(Array.from(eq.entries()), [['20MICRONS', '20 Microns Limited'], ['XYZ', 'Xyz, Ltd']]);
  const px = parseBhav('SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY\n20MICRONS, EQ, 06-Oct-2026, 204.61, 204.61, 208.80, 204.13, 208.80, 207.87, 206.90, 42040\nGSEC, GS, 06-Oct-2026, 100, 100, 100, 100, 100, 100, 100, 5\n');
  assert.deepEqual(px, { '20MICRONS': [207.87, 204.61, 42040] });
});

test('figures from a real screener.in page (KMEW fixture)', () => {
  const html = readFileSync(join(__dirname, 'fixtures/screener-company-kmew.html'), 'utf8');
  const f = inFigures(html, {});
  assert.equal(f.q, 'Jun 2026');
  assert.ok(f.revQYoY != null && f.salesTTM != null && f.salesTTM > 0);
  assert.ok(f.shares != null && f.shares > 0);
  assert.equal(f.gmFY, null, 'no material-cost answer → no gross margin');
  assert.ok(f.fs != null && f.fs >= 0 && f.fs <= 9);
});

test('gross margin: sales × (1 − material cost); a service company (material under 1%) has none', () => {
  const html = readFileSync(join(__dirname, 'fixtures/screener-company-kmew.html'), 'utf8');
  const q = inFigures(html, {}).q as string;
  const mk = (pct: number) => ({ 'Material Cost %': { [q]: `${pct}%` } });
  assert.equal(inFigures(html, { expQ: mk(0) }).gpQYoY, null);
  const ann = (pct: number) => {
    const m = /id="profit-loss"[\s\S]*?<\/tr>/.exec(html)![0];
    const heads = Array.from(m.matchAll(/<th[^>]*>\s*([A-Z][a-z]{2} \d{4})\s*<\/th>/g)).map((x) => x[1]);
    return { 'Material Cost %': Object.fromEntries(heads.map((h) => [h, `${pct}%`])) };
  };
  assert.equal(inFigures(html, { expA: ann(40) }).gmFY, 60);
  assert.equal(inFigures(html, { expA: ann(0.4) }).gmFY, null);
});

test('the ZACHS screen is built in for India', () => {
  const s = BUILT_IN_SCREENS.find((x) => x.id === 'in-zachs')!;
  assert.equal(s.market, 'IN');
  assert.equal(s.filters.length, 13);
});
