// zzz1048 — the TradingView CSVs are made by our own Stock Screener: every file the old sync wrote maps to built-in screens with
// the same rules, the CSV has the TradingView columns and money units, the parsers read it unchanged, and the TradingView sync
// workflow is gone.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  TV_REPLACEMENT_FILES, TV_COLUMNS, TV_COLUMN_SOURCES, TV_BLANK_COLUMNS, IN_CRORE_CAP_COLUMN, tvRecordOf, toCsv, fileCsv, screenRowsOf,
  bookRowsOf, marketsOf, screenById, rawMoney, tvFileOf, displayNameOf,
} from '../screener/tv-replacement';
import { BUILT_IN_SCREENS, type Filter } from '../screener/filters';
import { allSectorsExcept, TV_SECTORS } from '../screener/tv-sectors';
import { parseCsv, usRowFromRecord } from '../ai-gainers/us-gainers';
import { parseUSARow } from '../../app/(dashboard)/multibagger/usa-parse';
import { buildColMap, rawRowToExcelRow } from '../../app/(dashboard)/multibagger/column-map';
import { GITHUB_SCHEDULED } from '../app-scheduler';
import type { ScreenRow } from '../screener/types';

const ROOT = join(__dirname, '..', '..', '..', '..');
const FRONT = join(ROOT, 'frontend');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// A small US + India fixture that passes the Weekly Gainer screen (both markets) — figures in OUR units ($ M / ₹ Cr).
const base = { sec: 'Technology', ind: 'Software', approx: [], q: 'Q2 2026' } as const;
const usRow = (t: string, mc: number, extra: Partial<ScreenRow> = {}): ScreenRow => ({
  ...base, t, n: `${t} Inc, Class A`, px: 50, chg: 2, vol: 2_000_000, avgVol10: 1_500_000, mc, sma50: 40, sma200: 30, revQYoY: 30, revAYoY: 25,
  gpQYoY: 35, gmFY: 60, ebitdaQoQ: 5, ebitdaAYoY: 20, epsQYoY: 40, opmTTM: 15, ps: 5, evRev: 5, de: 0.3, cash: 800, emp: 1200, flt: 90, bb: 1,
  fs: 7, tvSec: 'Technology Services', exch: ['NASDAQ'], chg1W: 12, perf1W: 12, perf1M: 20, perf3M: 30, perf6M: 40, perf1Y: 60,
  atrP: 4, scanPx: 50, ema21: 45, ema50: 42, sma150: 35, rsi: 66, hi52: 52, avgVol30: 1_400_000, netDebt: -500, deFY: 0.4, roceFY: 18, ...extra,
} as ScreenRow);
const inRow = (t: string, mc: number): ScreenRow => ({ ...usRow(t, mc), n: `${t} Ltd`, exch: ['NSE', 'BSE'], flt: null, avgVol10: 1_000_000 } as ScreenRow);
const US = [usRow('AAA', 2_500), usRow('BBB', 900), usRow('CCC', 50, { chg1W: 1 })];   // CCC: below the 300M cap floor + no weekly gain
const IN = [inRow('INFYX', 50_000), inRow('TINY', 5)];                                  // TINY: ₹5 Cr < ₹30 Cr floor

describe('every old TradingView file is mapped to built-in screens', () => {
  const man = JSON.parse(read('frontend/public/data/tradingview/manifest.json'));
  test('each manifest file has a mapping, each mapping a real file name', () => {
    const names = new Set(TV_REPLACEMENT_FILES.map((f) => f.name));
    for (const f of man.files) assert.ok(names.has(f.name), `${f.name} has no replacement`);
    assert.equal(names.size, TV_REPLACEMENT_FILES.length, 'no duplicate file names');
  });
  test('every screen id exists, with the market its id says', () => {
    for (const f of TV_REPLACEMENT_FILES) {
      if (f.kind === 'watchlist') { assert.equal(f.list, 'us-book'); assert.deepEqual(f.screens, []); continue; }
      assert.ok(f.screens.length, f.name);
      for (const id of f.screens) {
        const s = screenById(id);
        assert.ok(s, `${f.name}: ${id} is not a built-in screen`);
        assert.equal(s!.market, id.startsWith('in-') ? 'IN' : 'US', id);
      }
    }
  });
  test('the five TradingView screens run on both markets keep both copies; names match the TradingView names', () => {
    for (const n of ['minervini-stocks.csv', 'qullamaggie-leaders.csv', 'episodic-pivot.csv', 'liquidity-leaders.csv', 'weekly-gainer-usa.csv']) {
      assert.deepEqual(marketsOf(tvFileOf(n)!).sort(), ['IN', 'US'], n);
    }
    for (const f of TV_REPLACEMENT_FILES.filter((x) => !/multibagger|watchlist/.test(x.name))) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
      assert.ok(norm(f.tvName).startsWith(norm(displayNameOf(f)).slice(0, 12)), `${f.name}: ${f.tvName} vs ${displayNameOf(f)}`);
    }
  });
  // The rules TradingView itself sent for the three "Multibagger" screens (scanner requests captured by the sync, 15 Oct 2026).
  const has = (fs: Filter[], want: Filter) => fs.some((x) => JSON.stringify(x) === JSON.stringify(want));
  const num = (key: string, op: string, v: number, v2?: number) => ({ kind: 'num', key, op, v, ...(v2 != null ? { v2 } : {}) }) as Filter;
  test('USA Multibagger (GHHf1HVl) = Future Super Scalers like NBIS Main', () => {
    const f = screenById('us-super-scalers-main')!.filters;
    for (const w of [num('vol', 'ge', 30_000), num('revQYoY', 'gt', 20), num('de', 'lt', 2), num('mc', 'between', 200, 30_000), num('revAYoY', 'gt', 10),
      { kind: 'cmp', key: 'sma50', op: 'ge', other: 'sma200' } as Filter]) assert.ok(has(f, w), JSON.stringify(w));
    const sec = f.find((x) => x.kind === 'sector') as Extract<Filter, { kind: 'sector' }>;
    assert.deepEqual([...sec.sectors].sort(), ['Commercial Services', 'Communications', 'Consumer Durables', 'Consumer Non-Durables', 'Consumer Services',
      'Distribution Services', 'Electronic Technology', 'Government', 'Industrial Services', 'Miscellaneous', 'Process Industries', 'Producer Manufacturing',
      'Retail Trade', 'Technology Services', 'Utilities'].sort());
    assert.equal(f.length, 7);
  });
  const zachs = [num('evRev', 'lt', 20), num('epsQYoY', 'gt', 15), num('gpQYoY', 'gt', 5), num('gmFY', 'gt', 15), num('fs', 'gt', 4.9),
    num('ebitdaAYoY', 'gt', -10), num('revQYoY', 'gt', 9), num('ps', 'between', 0, 7), num('avgVol10', 'gt', 60_000), num('cash', 'gt', 0)];
  test('USA Multibagger (SwBe8R8b) = ZACHS SCREENER', () => {
    const f = screenById('us-zachs')!.filters;
    for (const w of [...zachs, num('de', 'lt', 1), num('roceTTM', 'gt', -10), num('pcf', 'le', 15), num('mc', 'between', 100, 50_000)]) assert.ok(has(f, w), JSON.stringify(w));
    assert.equal(f.length, 16);
  });
  test('India Multibagger (I0y51g1p) = ZACHS SCREENER India', () => {
    const f = screenById('in-zachs')!.filters;
    for (const w of [...zachs, num('mc', 'between', 10, 5000)]) assert.ok(has(f, w), JSON.stringify(w));
    const sec = f.find((x) => x.kind === 'sector') as Extract<Filter, { kind: 'sector' }>;
    assert.deepEqual([...sec.sectors].sort(), ['Electronic Technology', 'Producer Manufacturing', 'Technology Services']);
    assert.equal(f.length, 13);
  });
  test('sector helper sanity', () => assert.equal(allSectorsExcept().length, TV_SECTORS.length));
});

describe('CSV shape and units', () => {
  test('header = the TradingView columns; India-only files add the ₹ crore column', () => {
    const us = fileCsv(tvFileOf('usa-multibagger-3.csv')!, []);
    assert.equal(parseCsv(us.trim() + '\n').length, 0);
    assert.equal(us.split('\n')[0].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length, TV_COLUMNS.length);
    const ind = fileCsv(tvFileOf('india-multibagger-tv-1.csv')!, []);
    assert.ok(ind.split('\n')[0].endsWith(`,${IN_CRORE_CAP_COLUMN}`));
    assert.ok(!us.includes(IN_CRORE_CAP_COLUMN));
  });
  test('every column the old files carried is written (union of the committed exports)', () => {
    const dir = join(FRONT, 'public/data/tradingview');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.csv'))) {
      const head = readFileSync(join(dir, f), 'utf8').split('\n')[0].replace(/\r$/, '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, ''));
      assert.ok(head.length > 10, f);
      for (const c of head) assert.ok(TV_COLUMNS.includes(c), `${f}: ${c}`);
    }
    for (const c of Object.keys(TV_COLUMN_SOURCES)) assert.ok(TV_COLUMNS.includes(c), c);
    assert.ok(TV_BLANK_COLUMNS.includes('Forward non-GAAP price to earnings, Annual'));
    assert.ok(TV_BLANK_COLUMNS.includes('Exponential moving average, 200, 1 day'), 'no EMA 200 in the snapshot — left empty, never SMA 200');
  });
  test('money: $ million → dollars, ₹ crore → rupees; a missing figure stays empty', () => {
    assert.equal(rawMoney(2_500, 'US'), 2.5e9);
    assert.equal(rawMoney(323.3, 'IN'), 3.233e9);
    assert.equal(rawMoney(null, 'US'), null);
    const rec = tvRecordOf(usRow('AAA', 2_500, { pe: null }), 'US');
    assert.equal(rec['Market capitalization'], 2.5e9);
    assert.equal(rec['Cash and short-term investments, Annual'], 800e6);
    assert.equal(rec['net_debt_fq'], -500e6);
    assert.equal(rec['Price to earnings ratio'], '');
    assert.equal(rec['Analyst Rating'], '');
    assert.equal(rec['Average true range, 14, 1 day'], 2, 'ATR 4% of a $50 close = $2');
    assert.equal(rec['Sector'], 'Technology Services');
    const inRec = tvRecordOf(inRow('INFYX', 50_000), 'IN', true);
    assert.equal(inRec['Market capitalization'], 5e11);
    assert.equal(inRec[IN_CRORE_CAP_COLUMN], 50_000);
    assert.equal(inRec['Exchange'], 'NSE');
  });
  test('fields with commas / quotes are quoted; parsers read them back', () => {
    const csv = toCsv([{ Symbol: 'X', Description: 'Acme, "Best" Co' }], ['Symbol', 'Description']);
    assert.equal(csv, 'Symbol,Description\nX,"Acme, ""Best"" Co"\n');
    assert.equal(parseCsv(csv)[0].Description, 'Acme, "Best" Co');
  });
});

describe('screen results in the old shape', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const f = tvFileOf('weekly-gainer-usa.csv')!;
  const res = screenRowsOf(f, { US, IN }, now);
  test('both market copies run; USA first then India, largest first; failing rows left out', () => {
    assert.deepEqual(res.rows.map((r) => r.row.t), ['AAA', 'BBB', 'INFYX']);
    assert.deepEqual(res.perScreen.map((p) => [p.id, p.count]), [['us-weekly-gainer-usa', 2], ['in-weekly-gainer-usa', 1]]);
  });
  test('a market without a snapshot is skipped, not guessed', () => {
    const only = screenRowsOf(f, { US }, now);
    assert.deepEqual(only.rows.map((r) => r.row.t), ['AAA', 'BBB']);
  });
  const text = fileCsv(f, res.rows);
  test('the AI gainers reader parses it: tickers, weekly move, $ M caps, exchanges', () => {
    const rows = parseCsv(text).map(usRowFromRecord);
    assert.deepEqual(rows.map((r) => r.ticker), ['AAA', 'BBB', 'INFYX']);
    assert.equal(rows[0].movePct, 12);
    assert.equal(rows[0].marketCap, 2_500);
    assert.equal(rows[0].relVol, null, 'no relative-volume figure: empty, not invented');
    assert.equal(rows[2].exchange, 'NSE');
  });
  test('the Multibagger / Technicals row parser reads it (raw dollars → $ B, moving averages, RSI)', () => {
    const rec = parseCsv(text)[0];
    const p = parseUSARow(rec)! as NonNullable<ReturnType<typeof parseUSARow>> & Record<string, unknown>;   // technical fields ride on the row untyped
    assert.equal(p.symbol, 'AAA');
    assert.equal(p.company, 'AAA Inc, Class A');
    assert.equal(p.marketCapB, 2.5);
    assert.equal(p.sma50, 40); assert.equal(p.ema21, 45); assert.equal(p.rsi, 66); assert.equal(p.perf1w, 12);
    assert.equal(p.ema200, undefined);
    assert.equal(p.forwardPe, undefined);
  });
  test('India Multibagger column map reads the ₹ crore column (not raw rupees as crore)', () => {
    const t = fileCsv(tvFileOf('india-multibagger-tv-1.csv')!, [{ row: inRow('INFYX', 50_000), market: 'IN' }]);
    const rec = parseCsv(t)[0];
    const m = buildColMap(rec);
    assert.equal(m['marketCapCr'], IN_CRORE_CAP_COLUMN);
    assert.equal(rawRowToExcelRow(rec, m)!.marketCapCr, 50_000);
  });
  test('US book list: holdings looked up loosely; holdings not in the snapshot are reported', () => {
    const r = bookRowsOf(['aaa', 'BRK.B', 'NASDAQ:BBB', 'AAA'], [...US, usRow('BRK-B', 900_000)]);
    assert.deepEqual(r.rows.map((x) => x.t), ['AAA', 'BRK-B', 'BBB']);
    assert.deepEqual(bookRowsOf(['ZZZ'], US).missing, ['ZZZ']);
  });
});

describe('the TradingView sync is gone and every reader uses the replacement', () => {
  test('no TradingView sync workflow or script', () => {
    assert.ok(!existsSync(join(ROOT, '.github/workflows/tradingview-sync.yml')));
    assert.ok(!existsSync(join(ROOT, '.github/scripts/tradingview-sync.mjs')));
    for (const f of readdirSync(join(ROOT, '.github/workflows'))) assert.doesNotMatch(readFileSync(join(ROOT, '.github/workflows', f), 'utf8'), /tradingview-sync|TRADINGVIEW_SESSIONID/i, f);
    assert.ok(!GITHUB_SCHEDULED.some((g) => /^tradingview-sync|, tradingview-sync/.test(g.workflow)));
    assert.doesNotMatch(read('docs/SCHEDULING.md'), /\| screener-sync\.yml, tradingview-sync\.yml/);
  });
  test('no page reads /data/tradingview directly any more', () => {
    for (const p of ['frontend/src/lib/screener-data-loader.ts', 'frontend/src/app/(dashboard)/multibagger/technicals-tab.tsx', 'frontend/src/app/(dashboard)/page.tsx',
      'frontend/src/app/(dashboard)/_home/PipelineHealth.tsx', 'frontend/src/app/api/v1/ai-gainers/route.ts']) {
      assert.doesNotMatch(read(p).replace(/dataFolder="frontend\/public\/data\/tradingview"/, ''), /['"`]\/data\/tradingview|public', 'data', 'tradingview'/, p);
    }
    assert.match(read('frontend/src/lib/screener-data-loader.ts'), /TV_MANIFEST_URL = '\/api\/v1\/tv-data'/);
    assert.match(read('frontend/src/app/api/v1/ai-gainers/route.ts'), /buildTvFile\(US_GAINERS_FILE\)/);
  });
  test('the route serves the personal US-book list only to a signed-in caller; old data is labelled', () => {
    const route = read('frontend/src/app/api/v1/tv-data/route.ts');
    assert.match(route, /f\.list === 'us-book' && !withPersonal/);
    assert.match(route, /siteAuthOk\(req\)/);
    const srv = read('frontend/src/lib/screener/tv-replacement-server.ts');
    assert.match(srv, /source: 'old-tradingview-export'/);
    assert.match(srv, /OLD DATA:/);
  });
});
