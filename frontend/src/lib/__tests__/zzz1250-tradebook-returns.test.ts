// zzz1250 — stock returns on the most money in it (not gross buys), demerged shares in the parent's row, cash funds
// left out, after-sale on the last exit only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockScorecard, afterSale, peakOpenCost, isCashFund, type Trade, type Realized } from '../tradebook/core';

const t = (isin: string, symbol: string, date: string, side: 'buy' | 'sell', qty: number, price: number): Trade =>
  ({ key: `${isin}|${date}|${side}|${qty}|${price}`, isin, symbol, date, exchange: 'NSE', segment: 'EQ', side, qty, price, orderId: '', tradeId: '', time: null });
const r = (isin: string, symbol: string, buyDate: string, sellDate: string, qty: number, buyPx: number, sellPx: number, extra: Partial<Realized> = {}): Realized =>
  ({ isin, symbol, buyDate, sellDate, qty, buyPx, sellPx, pnl: qty * (sellPx - buyPx), days: 30, kind: 'STCG', ...extra });
const id = (_i: string, f: string) => f;

test('a stock traded in and out five times: return on the ₹1 L in it, not on ₹5 L of buys', () => {
  const trades: Trade[] = [], realized: Realized[] = [];
  for (let k = 0; k < 5; k++) {
    const b = `2024-0${k + 1}-01`, s = `2024-0${k + 1}-20`;
    trades.push(t('N', 'NET', b, 'buy', 100, 1000), t('N', 'NET', s, 'sell', 100, 1100));
    realized.push(r('N', 'NET', b, s, 100, 1000, 1100));
  }
  const x = stockScorecard(trades, realized, [], [], id)[0];
  assert.equal(x.total, 50_000); assert.equal(x.bought, 500_000); assert.equal(x.peak, 100_000);
  assert.ok(Math.abs(x.pct! - 0.5) < 1e-9); assert.ok(Math.abs(x.pctTurnover! - 0.1) < 1e-9);
});

test('peak open cost: buys before sells on the same day, overlapping lots add up', () => {
  assert.equal(peakOpenCost([{ date: '2024-01-01', d: 100 }, { date: '2024-01-05', d: -100 }, { date: '2024-01-05', d: 80 }, { date: '2024-01-03', d: 50 }]), 230);
});

test('demerged shares are counted in the parent row (TMCV into Tata Motors)', () => {
  const trades = [t('TM', 'TATAMOTORS', '2023-01-01', 'buy', 100, 400), t('TM', 'TMPV', '2025-11-17', 'sell', 100, 370), t('CV', 'TMCV', '2025-11-17', 'sell', 100, 320)];
  const realized = [r('TM', 'TATAMOTORS', '2023-01-01', '2025-11-17', 100, 400, 370), r('CV', 'TMCV', '2025-10-14', '2025-11-17', 100, 0, 320, { demerged: true })];
  const s = stockScorecard(trades, realized, [], [], (i, f) => (i === 'TM' ? 'TMPV' : f));
  assert.equal(s.length, 1);
  assert.equal(s[0].symbol, 'TMPV'); assert.deepEqual(s[0].includes, ['TMCV']);
  assert.equal(s[0].total, -3000 + 32_000); assert.equal(s[0].peak, 40_000);
});

test('liquid funds are flagged as cash', () => {
  assert.equal(isCashFund('LIQUIDCASE'), true); assert.equal(isCashFund('LIQUIDBEES'), true);
  assert.equal(isCashFund('GOLDIAM'), false); assert.equal(isCashFund('RAYMOND'), false);
  const s = stockScorecard([t('L', 'LIQUIDCASE', '2025-01-01', 'buy', 10, 100)], [], [], [], id);
  assert.equal(s[0].cash, true);
});

test('after-sale uses only the last exit, not every sale since the first trade', () => {
  // sold cheap in 2023, bought back and sold at 3,300 in 2026: the last exit is the 3,300 one
  const realized = [r('B', 'BSE', '2023-01-01', '2023-06-01', 100, 200, 300), r('B', 'BSE', '2026-08-18', '2026-08-25', 36, 3311, 3298)];
  const a = afterSale(realized, new Set(), () => 3900, id)[0];
  assert.equal(a.lastSell, '2026-08-25'); assert.equal(a.qtySold, 36); assert.equal(a.avgSellPx, 3298);
  assert.ok(Math.abs(a.amount - 36 * 602) < 1e-6);
  // cash funds and demerged lots are not in it
  assert.equal(afterSale([r('L', 'LIQUIDCASE', '2025-01-01', '2025-02-01', 10, 100, 101)], new Set(), () => 102, id).length, 0);
});
