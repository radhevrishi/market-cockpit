// zzz1242 — tradebook units checked against prices, SIKA's split read from a price gap, dividends in the gain, day-by-day series.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, dailySeries, dayMs, splitsForInstrument, splitsFromTradeGaps, splitsMismatch, windowReturn, type Trade } from '../tradebook/core';

let n = 0;
const T = (date: string, side: 'buy' | 'sell', qty: number, price: number, isin = 'INE263A01'): Trade =>
  ({ key: `k${n++}`, isin, symbol: 'X', date, exchange: 'NSE', segment: 'EQ', side, qty, price, orderId: '', tradeId: String(n), time: null });
// adjusted closes: ₹85 throughout (a 1:2 bonus — 3× — on 2023-09-20 is already in them)
const closeOn = () => 85;

test('a split the price source does not list is read from the trades (BEL: 200 bought at ₹254, 600 sold at ₹85)', () => {
  const tr = [T('2022-04-21', 'buy', 200, 254), T('2023-11-03', 'sell', 600, 86)];
  assert.equal(splitsMismatch(tr, closeOn, undefined), true);
  const r = splitsForInstrument(tr, closeOn, undefined, undefined);
  assert.equal(r.source, 'trades');
  assert.deepEqual(r.splits?.map((s) => s.ratio), [3]);
  const l = buildLedger(tr, () => r.splits);
  assert.equal(l.unmatched.length, 0);
  assert.equal(l.positions.length, 0);
});

test('a listed split that matches the trades is kept as it is', () => {
  const tr = [T('2022-04-21', 'buy', 200, 254), T('2023-11-03', 'sell', 600, 86)];
  const ev = [{ t: dayMs('2023-09-20'), ratio: 3 }];
  const r = splitsForInstrument(tr, closeOn, ev, undefined);
  assert.equal(r.source, 'price-source');
  assert.deepEqual(r.splits, ev);
});

test('a listed split the trades contradict (twice the ratio) is replaced', () => {
  const tr = [T('2022-04-21', 'buy', 200, 254), T('2023-11-03', 'sell', 600, 86)];
  const r = splitsForInstrument(tr, closeOn, [{ t: dayMs('2023-09-20'), ratio: 6 }], undefined);
  assert.equal(r.source, 'trades');
  assert.deepEqual(r.splits?.map((s) => s.ratio), [3]);
});

test('an intraday move of 15% is not a split', () => {
  const tr = [T('2026-05-20', 'buy', 10, 650), T('2026-06-01', 'sell', 10, 570)];
  assert.equal(splitsMismatch(tr, (t) => (t >= dayMs('2026-06-01') ? 492 : 650), undefined), false);
});

test('no price history: a 1:5 split read from the price fall and the quantities (SIKA)', () => {
  const tr = [T('2025-01-07', 'buy', 30, 2554), T('2025-03-06', 'sell', 7, 2505), T('2025-03-17', 'sell', 23, 536), T('2025-03-18', 'sell', 90, 520), T('2025-03-19', 'sell', 2, 503)];
  const sp = splitsFromTradeGaps(tr);
  assert.deepEqual(sp.map((s) => s.ratio), [5]);
  const l = buildLedger(tr, () => sp);
  assert.equal(l.unmatched.length, 0);
});

test('dividends are in a period\'s gain; the series carries the cost of the shares held', () => {
  const tr = [T('2025-04-01', 'buy', 100, 100), T('2025-10-01', 'sell', 50, 120)];
  const l = buildLedger(tr);
  const pa = () => 110;
  const w = windowReturn(l, 'FY26', dayMs('2025-04-01'), dayMs('2026-03-31'), pa, undefined, [{ t: dayMs('2025-08-01'), amt: 500 }]);
  assert.equal(w.dividends, 500);
  assert.equal(Math.round(w.gain), 50 * 110 + 50 * 120 + 500 - 100 * 100);
  assert.equal(w.top[0].qty, 50);
  const s = dailySeries(l, [dayMs('2025-04-01'), dayMs('2025-10-01')], pa);
  assert.equal(s[0].cost, 10000);
  assert.equal(s[1].cost, 5000);
  assert.equal(s[1].value, 5500);
});

// zzz1243 — SHARDACROP: two buys at the open of a day it fell 20% are not a 1:4 bonus; the position is sold out.
test('an intraday fall is not read as a bonus (SHARDACROP stays sold out)', () => {
  const D = (d: string) => dayMs(d);
  const close = (t: number) => (t >= D('2026-05-14') ? 958.5 : 1189.7);
  const tr = [T('2026-05-13', 'buy', 89, 1168.4, 'INE221J01'), T('2026-05-14', 'buy', 6, 1080, 'INE221J01'), T('2026-05-14', 'buy', 7, 1081.9, 'INE221J01'),
    T('2026-05-14', 'buy', 25, 964.4, 'INE221J01'), T('2026-05-14', 'sell', 127, 951.8, 'INE221J01')];
  assert.equal(splitsMismatch(tr, close, undefined), false);
  const r = splitsForInstrument(tr, close, undefined, undefined);
  assert.equal(r.splits, undefined);
  const l = buildLedger(tr, () => r.splits);
  assert.equal(l.positions.length, 0);
});

test('the stored result is served on a visit; only Recompute or an upload works it out again', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../tradebook/server.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(!force\) \{\s*const hit = _cache \?\? \(await kvGet/);
  assert.doesNotMatch(src, /3 \* 3600_000/);
});

test('a portfolio symbol with a series suffix (MTARTECH-BE) is the sold-out tradebook company — offered for removal', async () => {
  const { holdingsDiff, reconcilePortfolio } = await import('../tradebook/core');
  const l = { positions: [], unmatchedIsins: [], tradedSymbols: [{ symbol: 'MTARTECH', isin: 'INE864I01' }] };
  const cur = [{ symbol: 'MTARTECH-BE', quantity: 21, entryPrice: 5194 }];
  assert.deepEqual(holdingsDiff(l, cur).map((d) => [d.symbol, d.action]), [['MTARTECH-BE', 'remove']]);
  assert.match(reconcilePortfolio(l, cur).rows[0].note, /sold out/);
});
