// zzz1239 — tradebook: one company = one instrument. Cases from the owner's own Zerodha files (Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, companyKey, dedupeTrades, dividendsByFy, inferIsinSplits, normalizeTrades, reconcilePortfolio, tradeIdentity, valueAt, windowReturn, type Trade } from '../tradebook/core';

let n = 0;
const T = (symbol: string, isin: string, date: string, side: 'buy' | 'sell', qty: number, price: number, exchange = 'NSE'): Trade =>
  ({ key: `k${n++}`, isin, symbol, date, exchange, segment: 'EQ', side, qty, price, orderId: '', tradeId: String(n), time: null });

test('a BSE trade with no ISIN joins the same company (DEEDEV bought on NSE, sold on BSE)', () => {
  const tr = normalizeTrades([
    T('DEEDEV', 'INE841L01016', '2025-06-11', 'buy', 1704, 284),
    T('DEEDEV', 'SYM:DEEDEV', '2025-06-12', 'sell', 1704, 300, 'BSE'),
  ]);
  const l = buildLedger(tr);
  assert.equal(l.positions.length, 0, 'sold out — not an open position');
  assert.equal(l.unmatched.length, 0, 'the sell has its buy');
  assert.equal(l.realized.length, 1);
  assert.equal(Math.round(l.realized[0].pnl), 1704 * 16);
});

test('a split that changed the ISIN keeps one company (VISHNU 1:5, serial 01014 → 01022)', () => {
  const raw = [
    T('VISHNU', 'INE270I01014', '2022-11-18', 'buy', 15, 1000),
    T('VISHNU', 'INE270I01022', '2023-01-31', 'sell', 75, 205),
  ];
  assert.equal(companyKey('INE270I01014'), companyKey('INE270I01022'));
  const sp = inferIsinSplits(raw);
  assert.deepEqual(sp.get('INE270I01')?.map((s) => s.ratio), [5]);
  const l = buildLedger(normalizeTrades(raw), (i) => sp.get(i));
  assert.equal(l.unmatched.length, 0);
  assert.equal(l.positions.length, 0);
});

test('a renamed company with no ISIN on BSE (COHANCE = SUVENPHAR) closes the position', () => {
  const l = buildLedger(normalizeTrades([
    T('SUVENPHAR', 'INE03QK01018', '2025-04-30', 'buy', 55, 1146),
    T('COHANCE', 'SYM:COHANCE', '2025-05-29', 'sell', 55, 1079, 'BSE'),
  ]));
  assert.equal(l.positions.length, 0);
  assert.equal(l.unmatched.length, 0);
});

test('Mindtree merged into LTIMindtree at 73 for 100 — LTIM sells meet the Mindtree buys; the fraction is cash', () => {
  const l = buildLedger(normalizeTrades([
    T('MINDTREE', 'INE018I01017', '2022-11-14', 'buy', 6, 3600),
    T('LTIM', 'INE214T01019', '2023-04-17', 'buy', 3, 4300),
    T('LTIM', 'INE214T01019', '2024-01-20', 'sell', 7, 5625),
  ]));
  assert.equal(l.unmatched.length, 0, '6 Mindtree → 4.38 LTIM, + 3 bought = 7.38, 7 sold');
  assert.equal(l.positions.length, 0, 'the 0.38 left is the fraction paid in cash');
});

test('demerged shares (TMCV from Tata Motors) arrive with no money paid and are not "sold without a buy"', () => {
  const l = buildLedger(normalizeTrades([
    T('TATAMOTORS', 'INE155A01022', '2025-09-26', 'buy', 141, 680),
    T('TMCV', 'SYM:TMCV', '2025-11-17', 'sell', 141, 320, 'BSE'),
  ]));
  assert.equal(l.unmatched.length, 0);
  assert.equal(l.demerged.length, 1);
  assert.equal(l.demerged[0].parent, 'TATAMOTORS');
  const moneyOut = l.flows.filter((f) => f.amt < 0).reduce((s, f) => s - f.amt, 0);
  assert.equal(Math.round(moneyOut), 141 * 680, 'only the Tata Motors purchase is money in');
  const r = l.realized.find((x) => x.symbol === 'TMCV')!;
  assert.equal(r.demerged, true);
  assert.equal(r.buyPx, 0);
});

test('no annual rate for a window of a few days (FY22 was 2 days and showed +1149% for the index)', () => {
  const l = buildLedger([T('INFY', 'INE009A01021', '2022-03-30', 'buy', 1, 1914)]);
  const D = Date.parse('2022-03-30T00:00:00Z');
  const w = windowReturn(l, 'FY22', D, D + 86_400_000, () => 1950, () => 100);
  assert.equal(w.xirr, null);
  assert.equal(w.bench?.xirr ?? null, null);
});

test('one dividend listed twice by the price source is counted once', () => {
  const l = buildLedger([T('IEX', 'INE022Q01020', '2025-01-02', 'buy', 286, 190)]);
  const t = Date.parse('2025-05-16T00:00:00Z');
  const d = dividendsByFy(l, () => [{ t, amount: 1.5 }, { t, amount: 1.5 }]);
  assert.equal(d.items.length, 1);
  assert.equal(Math.round(d.items[0].amount), 429);
});

// zzz1240 — part-year windows and leftover fractions
test('a part-year window shows the rate for that part, not stretched to a year', () => {
  const l = buildLedger([T('X', 'INE000X01011', '2026-04-01', 'buy', 100, 100)]);
  const from = Date.parse('2026-04-01T00:00:00Z'), to = Date.parse('2026-10-01T00:00:00Z');
  const w = windowReturn(l, 'FY27 so far', from, to, (_i, t) => (t >= to ? 120 : 100), (t) => (t >= to ? 110 : 100));
  assert.equal(w.annualised, false);
  assert.ok(Math.abs(w.xirr! - 0.2) < 0.01, `+20% in six months stays ~+20%, got ${w.xirr}`);
  assert.ok(Math.abs(w.bench!.xirr! - 0.1) < 0.01);
});

test('a fraction left by a merger is not valued in the book after its last trade', () => {
  const l = buildLedger(normalizeTrades([
    T('MINDTREE', 'INE018I01017', '2022-11-14', 'buy', 6, 3600),
    T('LTIM', 'INE214T01019', '2024-01-20', 'sell', 4, 5625),
  ]));
  const later = Date.parse('2025-01-01T00:00:00Z');
  assert.equal(valueAt(l, later, () => 5000).value, 0);
});

test('re-uploading a grown file adds only the new trades, even when the ISIN column was filled differently', () => {
  const a = { ...T('DEEDEV', 'SYM:DEEDEV', '2025-06-12', 'sell', 10, 300, 'BSE'), tradeId: '991', orderId: '77' };
  const b = { ...a, isin: 'INE841L01016', key: 'other' };   // the same trade in a later download
  const c = { ...T('DEEDEV', 'INE841L01016', '2025-06-13', 'buy', 5, 290), tradeId: '992', orderId: '78' };
  assert.equal(tradeIdentity(a), tradeIdentity(b));
  assert.equal(dedupeTrades([a, b, c]).length, 2);
});

test('portfolio vs tradebook: a holding outside the files and a sold-out holding explain the invested gap', () => {
  const r = reconcilePortfolio(
    { positions: [{ symbol: 'NETWEB', qty: 31, avgCost: 3800, isin: 'INE0NT901' }], unmatchedIsins: [], tradedSymbols: [{ symbol: 'NETWEB', isin: 'INE0NT901' }, { symbol: 'GVTD', isin: 'INE200A01' }] },
    [{ symbol: 'NETWEB', quantity: 31, entryPrice: 3800 }, { symbol: 'GVTD', quantity: 64, entryPrice: 2715 }, { symbol: 'GOLDBEES', quantity: 100, entryPrice: 80 }],
  );
  const kinds = Object.fromEntries(r.rows.map((x) => [x.symbol, x.kind]));
  assert.equal(kinds.NETWEB, 'same');
  assert.equal(kinds.GVTD, 'only-portfolio');
  assert.equal(kinds.GOLDBEES, 'only-portfolio');
  assert.equal(Math.round(r.portfolioCost - r.tradebookCost), 64 * 2715 + 100 * 80);
});
