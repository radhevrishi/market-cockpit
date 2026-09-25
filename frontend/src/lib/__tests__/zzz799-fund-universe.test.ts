// zzz799 — Portfolio Fundamentals analyzer shows, per country, the stocks in
// that country's Portfolio Book + its Conviction Beats (server lists), with
// 📗 / 🏆 / both chips, de-duplicated, with counts. Figures come from the
// synced exports; a name with no row anywhere is listed blank, never invented.
// Fixtures use MADE-UP tickers.
// Run: npx tsx --test src/lib/__tests__/zzz799-fund-universe.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mergeFundUniverse, fundCounts, buildUniverseRows, rowKeys, fundKey, compactIndiaBench, mergeIndiaBench, usBookHoldings, inFilter,
} from '../fundamentals/universe';

describe('India: book + Conviction Beats', () => {
  const book = [{ symbol: 'AAAIND' }, { symbol: 'BBBIND.NS' }, { symbol: '532001' }];
  const cb = [{ symbol: 'BBBIND', company: 'Bbb Industries' }, { symbol: 'CCCIND', company: 'Ccc Ltd' }];
  const u = mergeFundUniverse('INDIA', book, cb);
  test('de-duplicated with origins', () => {
    assert.deepEqual(u.map((n) => `${n.symbol}:${n.origin}`), ['532001:book', 'AAAIND:book', 'BBBIND:both', 'CCCIND:cb']);
  });
  test('counts: book includes the both, cb includes the both, total once', () => {
    assert.deepEqual(fundCounts(u), { book: 3, cb: 2, both: 1, total: 4 });
  });
  test('rows: file row first, then another synced export, else blank with the reason', () => {
    const file = [{ Name: 'Aaa', 'NSE Code': 'AAAIND', 'Sales growth': '20' }, { Name: 'Bse only', 'NSE Code': '', 'BSE Code': '532001', OPM: '14' }, { Name: 'Other', 'NSE Code': 'ZZZ' }];
    const pool = [{ file: 'capex.csv', rows: [{ Name: 'Ccc', 'NSE Code': 'CCCIND', OPM: '11' }] }];
    const r = buildUniverseRows('INDIA', u, file, pool, 'both');
    assert.equal(r.rows.length, 4, 'ZZZ (in the file, not in book/CB) is not shown');
    assert.equal(r.withFigures, 3);
    assert.equal(r.fromOtherFiles, 1);
    assert.deepEqual(r.blank, ['BBBIND']);
    const c = r.rows.find((x) => x['NSE Code'] === 'CCCIND')!;
    assert.deepEqual(c._files, ['capex.csv']);
    assert.equal(c._origin, 'cb');
    const b = r.rows.find((x) => x['NSE Code'] === 'BBBIND')!;
    assert.equal(b.Name, 'Bbb Industries');
    assert.match(b._blank, /no row in any synced/);
    assert.equal(Object.keys(b).filter((k) => !k.startsWith('_')).length, 2, 'blank row carries no figures');
    assert.ok(r.rows.find((x) => x['BSE Code'] === '532001'), 'a BSE-only book name matches by BSE code');
  });
  test('filters: my book / Conviction Beats / the old file view', () => {
    const file = [{ Name: 'Aaa', 'NSE Code': 'AAAIND' }, { Name: 'Other', 'NSE Code': 'ZZZ' }];
    assert.equal(buildUniverseRows('INDIA', u, file, [], 'book').rows.length, 3);
    assert.equal(buildUniverseRows('INDIA', u, file, [], 'cb').rows.length, 2);
    assert.equal(buildUniverseRows('INDIA', u, file, [], 'file').rows, file, 'file = exactly the old list');
    assert.ok(inFilter('both', 'book') && inFilter('both', 'cb') && !inFilter('cb', 'book'));
  });
  test('server bench → compact list; browser adds; removals stay off', () => {
    const server = compactIndiaBench([
      { ticker: 'CCCIND', company: 'Ccc Ltd', tier: 'STRONG', filing_date: '2026-08-01', revenue: 1 },
      { ticker: 'CCCIND', company: 'Ccc Ltd', tier: 'BLOCKBUSTER', filing_date: '2026-09-01' },
      { ticker: 'DDDIND', tier: 'GOOD' },
      { ticker: 'EEEIND', tier: 'STRONG' },
    ]);
    assert.deepEqual(server.map((s) => s.ticker), ['CCCIND', 'EEEIND']);
    assert.equal(server[0].tier, 'BLOCKBUSTER', 'newest filing wins');
    assert.equal(Object.keys(server[0]).includes('revenue'), false, 'no graded card on the wire');
    const mg = mergeIndiaBench(server, [{ ticker: 'FFFIND' }, { ticker: 'CCCIND' }], ['EEEIND']);
    assert.deepEqual(mg.names.map((n) => n.symbol).sort(), ['CCCIND', 'FFFIND']);
    assert.equal(mg.localOnly, 1); assert.equal(mg.removed, 1); assert.equal(mg.server, 2);
  });
  test('a fresh phone (no browser list) still gets the full server list', () => {
    const server = compactIndiaBench([{ ticker: 'CCCIND', tier: 'STRONG' }, { ticker: 'EEEIND', tier: 'STRONG' }]);
    assert.equal(mergeIndiaBench(server, [], []).names.length, 2);
  });
});

describe('USA: book + US Conviction Beats', () => {
  test('book holdings only; a Frankfurt line is left out and named; a US-book bench entry is not a holding', () => {
    const h = usBookHoldings([
      { ticker: 'AAA', origin: 'book', listing: 'US', exchange: 'NASDAQ' },
      { ticker: 'BRK.B', origin: 'both', listing: 'US', exchange: 'NYSE' },
      { ticker: 'KZZ', origin: 'book', listing: 'NON_US', exchange: 'FWB2' },
      { ticker: 'BEN', origin: 'bench', listing: 'US', exchange: 'NYSE' },
    ]);
    assert.deepEqual(h.held.map((x) => x.symbol), ['AAA', 'BRK-B']);
    assert.equal(h.leftOut.length, 1);
    assert.match(h.leftOut[0].reason, /KZZ \(FWB, EUR\) is not a US listing/);
  });
  test('TradingView symbols match (exchange prefix, class shares); non-US pool rows skipped', () => {
    assert.equal(fundKey('USA', 'NASDAQ:AAA'), 'AAA');
    assert.equal(fundKey('USA', 'BRK.B'), 'BRK-B');
    assert.deepEqual(rowKeys('USA', { Symbol: 'BRK.B' }), ['BRK-B']);
    const u = mergeFundUniverse('USA', [{ symbol: 'AAA' }], [{ symbol: 'CCC', company: 'Ccc Inc' }, { symbol: 'AAA' }]);
    assert.deepEqual(u.map((n) => `${n.symbol}:${n.origin}`), ['AAA:both', 'CCC:cb']);
    const pool = [{ file: 'x.csv', rows: [{ Symbol: 'CCC', Exchange: 'NSE', Price: '1' }] }];
    const r = buildUniverseRows('USA', u, [{ Symbol: 'AAA', Price: '10' }], pool, 'both');
    assert.deepEqual(r.blank, ['CCC'], 'an NSE row is never used for a US name');
    assert.equal(r.rows.find((x) => x.Symbol === 'CCC')!.Description, 'Ccc Inc');
  });
});

describe('the page is wired to server lists', () => {
  const loader = readFileSync(join(__dirname, '..', 'fundamentals', 'load-universe.ts'), 'utf8');
  const page = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'fundamentals', 'page.tsx'), 'utf8');
  const bench = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'bench', 'route.ts'), 'utf8');
  test('server sources per country', () => {
    for (const u of ['/api/portfolio?chatId=', '/api/v1/bench?view=tickers', '/api/v1/us-book?view=universe', '/api/v1/bench-us?view=tickers']) assert.ok(loader.includes(u), u);
  });
  test('the India bench route answers a compact tickers view and is unchanged otherwise', () => {
    assert.match(bench, /view === 'tickers'/);
    assert.match(bench, /return NextResponse\.json\(payload\);/);
  });
  test('chips with counts; portfolio scope only; the old file view kept', () => {
    assert.match(page, /📗 My book/); assert.match(page, /🏆 Conviction Beats/); assert.match(page, /📄 Synced file only/);
    assert.match(page, /const universeOn = scope === 'portfolio'/);
    assert.match(page, /data=\{shownData\}/);
  });
});
