// zzz948 — the owner's TradingView screens built in: price maths (RSI, ATR %, EMA, performance), TradingView sectors, the new filter
// kinds (≥ another field, within 0–10% above, exchange, dates), unit conversion of market caps, and the new company figures.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { smaOf, emaOf, rsiOf, atrPctOf, adrPctOf, techFigures, periodCloses, weekStart, overlayNse, barsFromYahoo, type DailyBars } from '../screener/tech';
import { tvSectorOf, allSectorsExcept, TV_SECTORS } from '../screener/tv-sectors';
import { passes, runScreen, capOf, BUILT_IN_SCREENS, FIELDS, fieldOf, filterLabel, cleanScreens, filterKeys, type Filter } from '../screener/filters';
import { grow, usFigures, framePeriods, type FrameData } from '../screener/sec-assemble';
import { rawFromHtml, inFiguresFromRaw, inFigures } from '../screener/in-assemble';
import type { ScreenRow } from '../screener/types';

const near = (a: number | null, b: number, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe('price maths', () => {
  test('SMA, EMA (started from a plain mean), RSI (Wilder)', () => {
    assert.equal(smaOf([1, 2, 3], 5), null);
    near(smaOf([1, 2, 3, 4, 5, 6], 5), 4);
    near(emaOf([1, 2, 3], 3), 2);                      // the seed alone
    near(emaOf([1, 2, 3, 4], 3), 4 * 0.5 + 2 * 0.5);   // k = 2 / (3 + 1)
    assert.equal(rsiOf([1, 2, 3], 14), null);
    near(rsiOf(Array.from({ length: 20 }, (_, i) => i + 1), 14), 100);     // only rises
    near(rsiOf([10, 11, 10, 11, 10, 11], 2), 68.75);   // seed up 0.5 / down 0.5, then halved-in each move: up 0.6875, down 0.3125
  });
  test('ATR % (Wilder, true range incl. gaps) and average day range % (20 days)', () => {
    const h = [11, 12, 13], l = [9, 10, 11], c = [10, 11, 12];
    // true ranges: day 1 max(2, |12−10|, |10−10|) = 2; day 2 = 2 → ATR(2) = 2 → 2 / 12
    near(atrPctOf(h, l, c, 2), (2 / 12) * 100);
    near(adrPctOf([11, 12], [10, 10], 2), ((0.1 + 0.2) / 2) * 100);
    assert.equal(adrPctOf([11], [10]), null);
  });
  test('weekly / monthly closes and week start', () => {
    assert.equal(weekStart('2026-10-07'), '2026-10-05');   // Wednesday → Monday
    assert.deepEqual(periodCloses(['2026-09-30', '2026-10-01', '2026-10-02'], [1, 2, 3], 'M'), [1, 3]);
    assert.deepEqual(periodCloses(['2026-10-02', '2026-10-05', '2026-10-06'], [1, 2, 3], 'W'), [1, 3]);
  });
  test('performance = close against the OPEN of the session on or before today − N days (TradingView, checked on NVDA)', () => {
    const d: string[] = [], o: number[] = [], c: number[] = [];
    const start = Date.UTC(2025, 0, 1);
    for (let i = 0; i < 700; i++) { const t = new Date(start + i * 86_400_000); if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue; d.push(t.toISOString().slice(0, 10)); o.push(100 + i); c.push(101 + i); }
    const b: DailyBars = { d, o, h: c.map((x) => x + 1), l: o.map((x) => x - 1), c, v: d.map(() => 1000) };
    const f = techFigures(b);
    const last = c[c.length - 1];
    const today = d[d.length - 1];
    const back = (days: number) => { const t = new Date(`${today}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - days); const iso = t.toISOString().slice(0, 10); let k = 0; for (let i = 0; i < d.length; i++) if (d[i] <= iso) k = i; return o[k]; };
    near(f.perf1W, Math.round((last / back(7) - 1) * 10000) / 100);
    near(f.perf1Y, Math.round((last / back(365) - 1) * 10000) / 100);
    near(f.perf5Y, Math.round((last / o[0] - 1) * 10000) / 100, 1e-9);   // younger than 5 years: since the first session
    const firstOfYear = d.findIndex((x) => x.startsWith(today.slice(0, 4)));
    near(f.perfYTD, Math.round((last / o[firstOfYear] - 1) * 10000) / 100);
    assert.equal(f.avgVol10, 1000);
    assert.equal(f.hi52, Math.max(...c.slice(-260)) + 1);
  });
  test('Yahoo bars and NSE\'s own prices laid over them (a split-adjusted day is left alone)', () => {
    const j = { chart: { result: [{ meta: { gmtoffset: 0, firstTradeDate: 86_400 * 100 }, timestamp: [86_400 * 1000, 86_400 * 1001], indicators: { quote: [{ open: [10, 11], high: [11, 12], low: [9, 10], close: [10.5, 11.5], volume: [5, 6] }] } }] } };
    const y = barsFromYahoo(j)!;
    assert.equal(y.firstTrade, 86_400 * 100);
    const days = [
      { date: y.bars.d[0], day: [10.6, 10, 7, 10.1, 11.2, 9.5] as any },     // close within 3% → NSE's figures win
      { date: y.bars.d[1], day: [23, 21, 9, 22, 24, 21] as any },             // 2× Yahoo (unadjusted for a later split) → ignored
      { date: '2099-01-01', day: [11.8, 11.5, 4, 11.6, 12, 11.4] as any },    // a day Yahoo has not published yet → added
    ];
    const m = overlayNse(y.bars, days);
    assert.deepEqual(m.c, [10.6, 11.5, 11.8]);
    assert.deepEqual(m.v, [7, 6, 4]);
    assert.equal(m.h[0], 11.2);
  });
});

describe('TradingView sectors', () => {
  test('21 sectors; mapped from industry, then from sector; unknown stays unknown', () => {
    assert.equal(TV_SECTORS.length, 21);
    assert.equal(allSectorsExcept('Finance', 'Energy Minerals').length, 19);
    assert.equal(tvSectorOf('US', 'Technology', 'Semiconductors'), 'Electronic Technology');
    assert.equal(tvSectorOf('US', 'Technology', 'Computer Software: Prepackaged Software'), 'Technology Services');
    assert.equal(tvSectorOf('US', 'Health Care', 'Biotechnology: Pharmaceutical Preparations'), 'Health Technology');
    assert.equal(tvSectorOf('US', 'Finance', 'Major Banks'), 'Finance');
    assert.equal(tvSectorOf('IN', 'Information Technology', 'Computers - Software & Consulting'), 'Technology Services');
    assert.equal(tvSectorOf('IN', 'Chemicals', 'Specialty Chemicals'), 'Process Industries');
    assert.equal(tvSectorOf('IN', 'Information Technology', 'Some New Industry'), 'Technology Services', 'falls back to the sector');
    assert.equal(tvSectorOf('US', null, null), null);
  });
});

const row = (o: Partial<ScreenRow>): ScreenRow => ({ t: 'X', n: 'X', sec: null, ind: null, px: 10, chg: 0, vol: 100_000, avgVol10: null, mc: 500, sma50: 11, sma200: 10,
  revQYoY: 30, revAYoY: 20, gpQYoY: 60, gmFY: 50, ebitdaQoQ: 5, ebitdaAYoY: 10, epsQYoY: 20, opmTTM: 5, ps: 5, evRev: 5, de: 0.5, cash: 10, emp: 500, flt: 90, bb: 0, fs: 6, q: 'Q2 2026', ...o });

describe('filters', () => {
  test('≥ / ≤ and "or equal" comparisons against another field', () => {
    assert.equal(passes(row({ sma50: 10 }), { kind: 'cmp', key: 'sma50', op: 'ge', other: 'sma200' }), true);
    assert.equal(passes(row({ sma50: 10 }), { kind: 'cmp', key: 'sma50', op: 'above', other: 'sma200' }), false);
    assert.equal(passes(row({ px: 5 }), { kind: 'num', key: 'px', op: 'ge', v: 5 }), true);
    assert.equal(passes(row({ px: 5 }), { kind: 'num', key: 'px', op: 'gt', v: 5 }), false);
    assert.equal(passes(row({ pcf: 15 }), { kind: 'num', key: 'pcf', op: 'le', v: 15 }), true);
    assert.equal(passes(row({ sma200: null }), { kind: 'cmp', key: 'sma50', op: 'ge', other: 'sma200' }), false, 'missing → fails');
  });
  test('within 0–10% above (price vs EMA 10; 52-week high vs price)', () => {
    const f: Filter = { kind: 'near', key: 'px', other: 'ema10', lo: 0, hi: 10 };
    assert.equal(passes(row({ px: 105, ema10: 100 }), f), true);
    assert.equal(passes(row({ px: 111, ema10: 100 }), f), false);
    assert.equal(passes(row({ px: 99, ema10: 100 }), f), false);
    assert.equal(passes(row({ px: 100, hi52: 109 }), { kind: 'near', key: 'hi52', other: 'px', lo: 0, hi: 10 }), true);
  });
  test('exchange, TradingView sector, dates', () => {
    assert.equal(passes(row({ exch: ['NSE', 'BSE'] }), { kind: 'exch', ex: ['BSE'] }), true);
    assert.equal(passes(row({ exch: ['NYSE'] }), { kind: 'exch', ex: ['NASDAQ'] }), false);
    assert.equal(passes(row({ exch: null }), { kind: 'exch', ex: ['NSE'] }), false);
    assert.equal(passes(row({ tvSec: 'Finance', sec: 'Banks' }), { kind: 'sector', sectors: allSectorsExcept('Finance') }), false);
    assert.equal(passes(row({ tvSec: 'Utilities' }), { kind: 'sector', sectors: allSectorsExcept('Finance') }), true);
    assert.equal(passes(row({ tvSec: null }), { kind: 'sector', sectors: [...TV_SECTORS] }), false, 'unknown sector fails a sector list');
    const now = new Date('2026-10-07T12:00:00Z');
    const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
    assert.equal(passes(row({ earnD: day('2026-10-03') }), { kind: 'date', key: 'earnD', op: 'thisMonth' }, now), true);
    assert.equal(passes(row({ earnD: day('2026-09-30') }), { kind: 'date', key: 'earnD', op: 'thisMonth' }, now), false);
    assert.equal(passes(row({ ipoD: day('2022-01-10') }), { kind: 'date', key: 'ipoD', op: 'pastYears', v: 5 }, now), true);
    assert.equal(passes(row({ ipoD: day('2020-01-10') }), { kind: 'date', key: 'ipoD', op: 'pastYears', v: 5 }, now), false);
  });
  test('TradingView market caps (raw currency) → $ million / ₹ crore', () => {
    assert.equal(capOf(300_000_000, 'US'), 300);
    assert.equal(capOf(200_000_000, 'US'), 200);
    assert.equal(capOf(100_000_000, 'IN'), 10);
    assert.equal(capOf(50_000_000_000, 'IN'), 5_000);
    const zachs = BUILT_IN_SCREENS.find((s) => s.id === 'in-zachs')!;
    assert.deepEqual(zachs.filters.find((f) => f.kind === 'num' && f.key === 'mc'), { kind: 'num', key: 'mc', op: 'between', v: 10, v2: 5_000 });
    assert.equal(filterLabel({ kind: 'num', key: 'mc', op: 'ge', v: 500 }, 'US'), 'Market cap ≥ $500M');
  });
  test('every built-in screen: TradingView name, both markets grouped, real fields and sectors, no duplicate ids', () => {
    const ids = new Set<string>();
    for (const s of BUILT_IN_SCREENS) {
      assert.ok(!ids.has(s.id), s.id); ids.add(s.id);
      for (const f of s.filters) {
        for (const k of filterKeys(f)) assert.ok(fieldOf(k), `${s.id}: ${k}`);
        if (f.kind === 'sector') for (const x of f.sectors) assert.ok((TV_SECTORS as readonly string[]).includes(x), `${s.id}: ${x}`);
      }
    }
    const us = BUILT_IN_SCREENS.filter((s) => s.market === 'US').length, ind = BUILT_IN_SCREENS.filter((s) => s.market === 'IN').length;
    assert.equal(us, 23); assert.equal(ind, 20);   // 40 TradingView screens (2 Europe ones left out), 5 of them on both markets, 2 identical pairs merged
    for (const nm of ['ZACHS SCREENER', 'ZACHS SCREENER India', 'Future Super Scalers like NBIS Full', 'PEAD India', 'DEBT REDUCTION', 'ATH Stocks', 'Minervni Stocks', 'Liquidity Leaders']) assert.ok(BUILT_IN_SCREENS.some((s) => s.name === nm), nm);
    const full = BUILT_IN_SCREENS.find((s) => s.id === 'us-super-scalers-full')!;
    assert.ok(full.filters.some((f) => f.kind === 'num' && f.key === 'bb' && f.op === 'gt' && f.v === -25));
    assert.ok(full.filters.some((f) => f.kind === 'num' && f.key === 'perfYTD' && f.op === 'lt' && f.v === 300));
    const zi = BUILT_IN_SCREENS.find((s) => s.id === 'in-zachs')!;
    assert.deepEqual(zi.filters.find((f) => f.kind === 'sector'), { kind: 'sector', sectors: ['Technology Services', 'Electronic Technology', 'Producer Manufacturing'] });
    for (const f of FIELDS) assert.ok(f.label && f.group, f.key);
  });
  test('saved screens keep the new filter kinds and drop broken ones', () => {
    const s = cleanScreens([{ id: 'a', name: 'A', market: 'IN', filters: [
      { kind: 'near', key: 'px', other: 'ema10', lo: 0, hi: 10 }, { kind: 'exch', ex: ['NSE'] }, { kind: 'date', key: 'earnD', op: 'thisMonth' },
      { kind: 'cmp', key: 'sma50', op: 'ge', other: 'sma200' }, { kind: 'num', key: 'px', op: 'ge', v: 5 }, { kind: 'near', key: 'px', other: 'nope', lo: 0, hi: 1 },
    ] }]);
    assert.equal(s[0].filters.length, 5);
  });
  test('a screen runs on rows', () => {
    const s = BUILT_IN_SCREENS.find((x) => x.id === 'us-ath')!;
    const rows = [row({ t: 'A', mc: 800, epsTTMYoY: 30, px: 100, hi52: 105 }), row({ t: 'B', mc: 800, epsTTMYoY: 30, px: 100, hi52: 120 }), row({ t: 'C', mc: 700, epsTTMYoY: 30, px: 100, hi52: 101 })];
    assert.deepEqual(runScreen(rows, s.filters).map((r) => r.t), ['A']);
  });
});

describe('company figures', () => {
  test('growth as TradingView works it', () => {
    assert.equal(grow(-0.1, -0.26), 61.5);   // a shrinking loss
    assert.equal(grow(0.5, -0.2), null);     // loss → profit: none
    assert.equal(grow(-0.5, 0.2), -350);     // profit → loss
    assert.equal(grow(5, 0), null);
    assert.equal(grow(120, 100), 20);
  });
  test('USA: debt counts leases; buyback from year-end shares; ROE / margins / TTM growth', () => {
    const periods = framePeriods(new Date('2026-10-07T08:00:00Z'));
    const cik = 9;
    const Q = (y: number, q: number, v: number) => ({ [`CY${y}Q${q}`]: { [cik]: { v, s: `${y}-${String(q * 3 - 2).padStart(2, '0')}-01`, e: `${y}-${String(q * 3).padStart(2, '0')}-28` } } });
    const rev: any = {}; const ni: any = {}; const op: any = {};
    let k = 0;
    for (const [y, q] of [[2023, 3], [2023, 4], [2024, 1], [2024, 2], [2024, 3], [2024, 4], [2025, 1], [2025, 2], [2025, 3], [2025, 4], [2026, 1], [2026, 2]]) { Object.assign(rev, Q(y, q, 100 + 10 * k)); Object.assign(ni, Q(y, q, 10 + k)); Object.assign(op, Q(y, q, 20 + k)); k++; }
    rev.CY2025 = { [cik]: { v: 4000, s: '2025-01-01', e: '2025-12-31' } }; rev.CY2024 = { [cik]: { v: 3000, s: '2024-01-01', e: '2024-12-31' } };
    const fd: FrameData = {
      Revenues: rev, NetIncomeLoss: ni, OperatingIncomeLoss: op,
      StockholdersEquity: { CY2026Q2I: { [cik]: { v: 500 } }, CY2025Q2I: { [cik]: { v: 300 } }, CY2025Q4I: { [cik]: { v: 450 } }, CY2024Q4I: { [cik]: { v: 350 } } },
      LongTermDebt: { CY2026Q2I: { [cik]: { v: 100 } } },
      OperatingLeaseLiability: { CY2026Q2I: { [cik]: { v: 50 } } },
      CommonStockSharesOutstanding: { CY2025Q4I: { [cik]: { v: 98 } }, CY2024Q4I: { [cik]: { v: 100 } } },
    };
    const f = usFigures(fd, cik, periods);
    assert.equal(f.q, 'Q2 2026');
    assert.equal(f.de, 0.3);                      // (100 debt + 50 operating leases) ÷ 500
    assert.equal(f.bb, 2);                        // 100 → 98 shares
    // last 4 quarters' revenue 180+190+200+210 = 780 vs 140+150+160+170 = 620; profit 18+19+20+21 = 78
    assert.equal(f.revTTMYoY, grow(780, 620));
    assert.equal(f.nmTTM, Math.round((78 / 780) * 1000) / 10);
    assert.equal(f.roeTTM, Math.round((78 / 400) * 1000) / 10);   // ÷ average of 500 and 300
  });
  test('India: the page is boiled down and the figures worked out from it (KMEW page)', () => {
    const html = readFileSync(join(__dirname, 'fixtures/screener-company-kmew.html'), 'utf8');
    const raw = rawFromHtml(html, {});
    assert.equal(raw.v, 2);
    assert.equal(raw.bse, true, 'the page shows a BSE code');
    assert.ok(raw.T.q && Object.keys(raw.T.q.rows).length <= 8, 'only the rows we use are kept');
    const f = inFiguresFromRaw(JSON.parse(JSON.stringify(raw)));   // survives being stored as JSON
    const g = inFigures(html, {});
    assert.deepEqual(f, g);
    assert.equal(f.q, 'Jun 2026');
    assert.ok(f.revTTMYoY != null && f.npTTM != null && f.roceFY != null && f.opmFY != null);
    // no balance sheet published for the June quarter → no "latest quarter" debt figures (as on TradingView)
    assert.equal(f.de, null); assert.equal(f.liabQ, null);
    assert.ok(f.deFY != null && f.liabA != null);
  });
});
