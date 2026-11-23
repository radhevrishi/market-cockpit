// zzz1291b — regime-change alert decision, recent listings out of the leader list, basket leaders before sector indices.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { regimeDecision } from '../market-leadership/regime-watch';
import { pickLeaders, listedDaysOf, type Row } from '../market-leadership/core';
import { marketCycles } from '../market-leadership/perf';

test('regime decision: first reading stored, change alerts, missing data never alerts, flip-back flagged', () => {
  assert.deepEqual(regimeDecision(null, { regime: 'MIXED', label: 'Mixed' }, '2026-11-20').alert, false);
  const last = { regime: 'STRONG_UPTREND', label: 'Strong uptrend', since: '2026-11-01', prev: null };
  assert.equal(regimeDecision(last, { regime: 'STRONG_UPTREND', label: 'Strong uptrend' }, '2026-11-20').alert, false);
  assert.equal(regimeDecision(last, { regime: 'INSUFFICIENT_DATA', label: '—' }, '2026-11-20').next, null);
  const d = regimeDecision(last, { regime: 'MARKET_CORRECTION', label: 'Market correction' }, '2026-11-20');
  assert.equal(d.alert, true); assert.equal(d.next!.prev!.regime, 'STRONG_UPTREND'); assert.equal(d.flipBack, false);
  const back = regimeDecision(d.next, { regime: 'STRONG_UPTREND', label: 'Strong uptrend' }, '2026-11-21');
  assert.equal(back.alert, true); assert.equal(back.flipBack, true);
});
test('a company listed under 6 months is not a leader; under a year is marked', () => {
  const now = Date.parse('2026-11-23');
  const day = Math.floor(now / 86_400_000);
  const row = (t: string, o: Partial<Row>): Row => ({ t, n: t, px: 195, mc: 50000, avgVol30: 3e6, sma21: 180, sma50: 170, sma200: 120, sma50P: 168, hi52: 200, lo52: 70, perf1Y: 160, perf1M: 5, ...o });
  const rows: Row[] = [];
  for (let i = 0; i < 300; i++) rows.push(row(`X${i}`, { perf1Y: 5, px: 100, hi52: 102 }));
  rows.push(row('IPO', { ipoD: day - 60 }), row('YOUNG', { ipoD: day - 250 }), row('OLD', { ipoD: day - 2000 }));
  const { leaders, recentLeft } = pickLeaders(rows, 'US', new Map(), 1, now);
  assert.ok(!leaders.some((l) => l.t === 'IPO')); assert.equal(recentLeft, 1);
  assert.equal(leaders.find((l) => l.t === 'YOUNG')?.listedMonths, 8);
  assert.equal(leaders.find((l) => l.t === 'OLD')?.listedMonths, undefined);
  assert.equal(listedDaysOf(row('Z', {}), now), null);
});
test('before a sector index exists, an equal-weight basket leads, marked *', () => {
  const w = { d: ['2003-01-01', '2004-01-01', '2005-01-01', '2006-01-01'], c: [100, 80, 130, 200] };
  const m1 = { d: w.d, c: [10, 8, 20, 40] }, m2 = { d: w.d, c: [10, 8, 12, 20] };
  const { cycles } = marketCycles(w, [{ name: 'Capital goods', s: null, members: [m1, m2], until: '2011-07-01' }], 'india', 0.2);
  const c = cycles.find((x) => x.start === '2004-01-01')!;
  assert.equal(c.ledBy[0].name, 'Capital goods*'); assert.match(c.ledNote!, /hindsight/);
});
test('wired: jobs, holdings marks', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
  assert.match(read('lib/app-scheduler.ts'), /leadership-regime-in[\s\S]*leadership-regime-us/);
  assert.match(read('components/market-leadership/MarketLeadership.tsx'), /Your holdings vs leadership/);
  assert.match(read('components/market-leadership/PerfTabs.tsx'), /export function useHeld/);
});
