// zzz1249 — per-stock scorecard, holding-period buckets, what happened after selling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockScorecard, holdBuckets, afterSale, type Trade, type Realized } from '../tradebook/core';

const t = (isin: string, symbol: string, date: string, side: 'buy' | 'sell', qty: number, price: number): Trade =>
  ({ key: `${isin}|${date}|${side}|${qty}`, isin, symbol, date, exchange: 'NSE', segment: 'EQ', side, qty, price, orderId: '', tradeId: '', time: null });
const r = (isin: string, symbol: string, buyDate: string, sellDate: string, qty: number, buyPx: number, sellPx: number, days: number): Realized =>
  ({ isin, symbol, buyDate, sellDate, qty, buyPx, sellPx, pnl: qty * (sellPx - buyPx), days, kind: days > 365 ? 'LTCG' : days === 0 ? 'INTRADAY' : 'STCG' });

test('scorecard adds realised, unrealised and dividends per company; return on money bought', () => {
  const trades = [t('A', 'AAA', '2024-01-01', 'buy', 10, 100), t('A', 'AAA', '2024-06-01', 'sell', 5, 150), t('B', 'BBB', '2024-02-01', 'buy', 10, 50), t('B', 'BBB', '2024-03-01', 'sell', 10, 40)];
  const realized = [r('A', 'AAA', '2024-01-01', '2024-06-01', 5, 100, 150, 152), r('B', 'BBB', '2024-02-01', '2024-03-01', 10, 50, 40, 29)];
  const s = stockScorecard(trades, realized, [{ isin: 'A', pnl: 300, qty: 5 }], [{ isin: 'A', amount: 20 }], (_i, f) => f);
  const a = s.find((x) => x.isin === 'A')!, b = s.find((x) => x.isin === 'B')!;
  assert.equal(a.status, 'PART_SOLD'); assert.equal(a.total, 250 + 300 + 20); assert.equal(a.bought, 1000); assert.ok(Math.abs(a.pct! - 0.57) < 1e-9);
  assert.equal(b.status, 'EXITED'); assert.equal(b.total, -100); assert.equal(b.losses, 1);
});

test('holding buckets and after-sale', () => {
  const realized = [r('A', 'AAA', '2024-01-01', '2024-01-01', 1, 10, 12, 0), r('B', 'BBB', '2024-01-01', '2024-01-20', 10, 10, 12, 19), r('C', 'CCC', '2022-01-01', '2024-01-02', 10, 10, 8, 731)];
  const b = holdBuckets(realized);
  assert.deepEqual(b.map((x) => x.label), ['Intraday', 'Up to 1 month', 'Over 1 year']);
  assert.equal(b[2].winRate, 0);
  const after = afterSale(realized, new Set(['C']), (isin) => (isin === 'B' ? 24 : 5), (_i, f) => f);
  assert.equal(after.length, 1);   // A was intraday, C is still held
  assert.equal(after[0].amount, 120); assert.ok(Math.abs(after[0].movePct - 1) < 1e-9);
});
