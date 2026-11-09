// zzz1231 — tradebook engine: parsing, duplicates, splits, intraday, FIFO STCG/LTCG, XIRR, PME benchmark, holdings diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTradebookRows, dedupeTrades, buildLedger, xirr, pnlStats, windowReturn, dividendsByFy, holdingsDiff, applyHoldingsDiff, dayMs, fyOf, splitFactor, type Trade } from '../tradebook/core';

const head = [null, 'Symbol', 'ISIN', 'Trade Date', 'Exchange', 'Segment', 'Series', 'Trade Type', 'Auction', 'Quantity', 'Price', 'Trade ID', 'Order ID', 'Order Execution Time'];
const row = (sym: string, isin: string, d: string, side: string, q: number, p: number, id: string) => [null, sym, isin, d, 'NSE', 'EQ', 'EQ', side, false, q, p, id, 'o' + id, `${d}T10:00:00`];

test('parses a Zerodha sheet (header below the title rows) and drops duplicates across files', () => {
  const rows = [[null, 'Client ID', 'X'], [], [null, 'Tradebook for Equity from 2025-04-01 to 2026-03-31'], [], head,
    row('AAA', 'INE000A01', '2025-04-02', 'buy', 10, 100, '1'), row('AAA', 'INE000A01', '2025-04-03', 'sell', 4, 120, '2')];
  const p = parseTradebookRows(rows as any);
  assert.equal(p.trades.length, 2); assert.equal(p.from, '2025-04-02'); assert.equal(p.to, '2025-04-03');
  assert.equal(dedupeTrades([...p.trades, ...p.trades]).length, 2);
  assert.equal(parseTradebookRows([[1, 2, 3]] as any).trades.length, 0);
});

const T = (isin: string, sym: string, date: string, side: 'buy' | 'sell', qty: number, price: number, id: string): Trade =>
  ({ key: id, isin, symbol: sym, date, exchange: 'NSE', segment: 'EQ', side, qty, price, orderId: id, tradeId: id, time: `${date}T10:00:00` });

test('FIFO: a lot held over 12 months is LTCG, newer lots STCG; same-day buy+sell is intraday', () => {
  const l = buildLedger([
    T('I1', 'AAA', '2024-01-10', 'buy', 10, 100, 'a'),
    T('I1', 'AAA', '2025-01-05', 'buy', 10, 150, 'b'),
    T('I1', 'AAA', '2025-03-01', 'sell', 15, 200, 'c'),    // 10 LTCG (+1000) + 5 STCG (+250)
    T('I1', 'AAA', '2025-03-05', 'buy', 3, 210, 'd'),
    T('I1', 'AAA', '2025-03-05', 'sell', 3, 205, 'e'),     // intraday −15
  ]);
  const k = (kind: string) => l.realized.filter((r) => r.kind === kind).reduce((s, r) => s + r.pnl, 0);
  assert.equal(k('LTCG'), 1000); assert.equal(k('STCG'), 250); assert.equal(k('INTRADAY'), -15);
  assert.equal(l.positions[0].qty, 5); assert.equal(l.positions[0].avgCost, 150);
  const s = pnlStats(l.realized);
  assert.equal(s.trades, 2); assert.equal(s.wins, 1); assert.equal(s.losses, 1);
  assert.equal(s.profitFactor, 1250 / 15);
  assert.equal(fyOf('2025-03-01'), 'FY25'); assert.equal(fyOf('2025-04-01'), 'FY26');
});

test('a 1:5 split after the buy puts the lot in today\'s units; an unexplained sell is counted, not costed', () => {
  const splits = [{ t: dayMs('2025-06-01'), ratio: 5 }];
  assert.equal(splitFactor('2025-05-30', splits), 5); assert.equal(splitFactor('2025-06-01', splits), 1);
  const l = buildLedger([T('I2', 'BBB', '2025-01-01', 'buy', 10, 1000, 'a'), T('I2', 'BBB', '2025-07-01', 'sell', 25, 250, 'b'), T('I3', 'CCC', '2025-02-01', 'sell', 7, 50, 'c')], (i) => (i === 'I2' ? splits : undefined));
  const p = l.positions.find((x) => x.isin === 'I2')!;
  assert.equal(p.qty, 25); assert.equal(p.avgCost, 200);
  assert.equal(Math.round(l.realized.find((r) => r.isin === 'I2')!.pnl), 1250);   // 25 × (250 − 200)
  assert.deepEqual(l.unmatched.map((u) => u.symbol), ['CCC']);
});

test('XIRR: 100 out, 110 back a year later = 10%; benchmark mirrors the same flows', () => {
  const r = xirr([{ t: dayMs('2025-01-01'), amt: -100 }, { t: dayMs('2026-01-01'), amt: 110 }])!;
  assert.ok(Math.abs(r - 0.1) < 1e-4);
  assert.equal(xirr([{ t: 0, amt: -100 }]), null);
  const l = buildLedger([T('I1', 'AAA', '2025-01-02', 'buy', 10, 100, 'a')]);
  const price = (_i: string, t: number) => (t >= dayMs('2026-01-01') ? 120 : 100);
  const idx = (t: number) => (t >= dayMs('2026-01-01') ? 110 : 100);
  const w = windowReturn(l, 'x', dayMs('2025-01-02'), dayMs('2026-01-02'), price, idx);
  assert.equal(w.gain, 200); assert.ok(w.xirr! > 0.19 && w.xirr! < 0.21);
  assert.ok(Math.abs(w.bench!.endValue - 1100) < 1e-6);
  const d = dividendsByFy(l, () => [{ t: dayMs('2025-08-10'), amount: 5 }]);
  assert.equal(d.byFy[0].fy, 'FY26'); assert.equal(d.byFy[0].amount, 50);
});

test('holdings diff: adds, updates, removes only names the tradebook traded; others kept; Undo-able list', () => {
  const input = { positions: [{ symbol: 'AAA', qty: 5, avgCost: 150, isin: 'I1' }, { symbol: 'NEW', qty: 3, avgCost: 10, isin: 'I9' }], unmatchedIsins: [], tradedSymbols: [{ symbol: 'AAA', isin: 'I1' }, { symbol: 'NEW', isin: 'I9' }, { symbol: 'GONE', isin: 'I5' }] };
  const cur = [{ symbol: 'AAA', quantity: 8, entryPrice: 140 }, { symbol: 'GONE', quantity: 4, entryPrice: 50 }, { symbol: 'OTHER', quantity: 1, entryPrice: 1 }];
  const d = holdingsDiff(input, cur);
  assert.deepEqual(d.map((x) => `${x.symbol}:${x.action}`).sort(), ['AAA:update', 'GONE:remove', 'NEW:add']);
  const next = applyHoldingsDiff(cur, d, (c) => ({ symbol: c.symbol, quantity: c.quantity, entryPrice: c.entryPrice }));
  assert.deepEqual(next.map((h) => `${h.symbol}:${h.quantity}`), ['AAA:5', 'OTHER:1', 'NEW:3']);
});
