import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainRow, naReason, closeConfirmed, stableOrder, makeShortlist, diffShortlist, formulaImpact, FORMULA_VERSION, isLender } from '../screener/research';
import { runScreen, type Filter } from '../screener/filters';

const row = (o: any) => ({ t: 'X', n: 'X Ltd', sec: 'Technology', ind: 'Software', px: 10, chg: 1, vol: 1, mc: 100, q: 'Q2 2026', ...o });

test('zzz969 exact explanation: 8.96 shown as 9.0 fails > 9 and says so', () => {
  const f: Filter[] = [{ kind: 'num', key: 'revQYoY', op: 'gt', v: 9 }];
  const [c] = explainRow(row({ revQYoY: 8.96 }) as any, f, 'US');
  assert.equal(c.pass, false);
  assert.equal(c.nearMiss, true);
  assert.match(c.detail, /8\.96/);
  assert.match(c.detail, /compared unrounded/);
});

test('zzz969 applicability: a bank gross margin is not applicable, not missing', () => {
  const bank = row({ tvSec: 'Finance', ind: 'Banks', gmFY: null });
  assert.ok(isLender(bank as any));
  assert.ok(naReason(bank as any, 'gmFY'));
  assert.equal(naReason(row({}) as any, 'gmFY'), null);
  const [c] = explainRow(bank as any, [{ kind: 'num', key: 'gmFY', op: 'gt', v: 15 }], 'IN');
  assert.match(c.detail, /not applicable/);
});

test('zzz969 close-confirmed: price figures of the last completed session replace intraday ones', () => {
  const r = row({ px: 105, sma50: 100, cc: { px: 98, chg: -0.5 } });
  const f: Filter[] = [{ kind: 'cmp', key: 'px', op: 'above', other: 'sma50' }];
  assert.equal(runScreen([r as any], f).length, 1);
  assert.equal(runScreen([closeConfirmed(r as any)], f).length, 0);
});

test('zzz969 stable order keeps rows in place and appends new ones', () => {
  const s = stableOrder(['B', 'A'], [{ k: 'A' }, { k: 'C' }, { k: 'B' }], (x) => x.k);
  assert.deepEqual(s.rows.map((x) => x.k), ['B', 'A', 'C']);
  assert.equal(s.moved, true);
});

test('zzz969 shortlist diff names entered / exited and the cause', () => {
  const f: Filter[] = [{ kind: 'num', key: 'chg', op: 'gt', v: 4 }];
  const sl = makeShortlist({ name: 's', market: 'US', screenId: 'x', screenName: 'x', filters: f, exactOnly: false, closeOnly: false, snapshotBuiltAt: null }, [row({ t: 'A', chg: 5 }) as any], ['chg']);
  const nowRows = [row({ t: 'A', chg: 2 }), row({ t: 'B', chg: 6 })] as any[];
  const d = diffShortlist(sl, nowRows, runScreen(nowRows, f), 'US');
  assert.equal(d.exited[0].t, 'A');
  assert.match(d.exited[0].why, /price movement/);
  assert.equal(d.entered[0].t, 'B');
  assert.equal(formulaImpact({ v: FORMULA_VERSION, at: '', tickers: [] }, ['A']), null);
  assert.ok(formulaImpact({ v: '2000.01.01', at: '', tickers: ['A'] }, ['B'])?.removed.includes('A'));
});
