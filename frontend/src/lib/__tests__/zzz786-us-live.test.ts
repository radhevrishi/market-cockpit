import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowFromScan, describeLiveScan, liveScanBody, fetchUsLiveGainers } from '../ai-gainers/us-live-gainers';
import { screenUsGainers } from '../ai-gainers/us-gainers';

// columns: name, exchange, description, change, market_cap_basic, close, volume, relvol, gap, W, 1M, 3M, 6M, Y, sector, type, subtype
const row = (t: string, ex: string, chg: number, mcap: number) => [t, ex, `${t} Inc.`, chg, mcap, 12.5, 2_000_000, 3.1, 4.2, 18, 25, 30, 40, 55, 'Technology', 'stock', 'common'];

test('scanner row maps to today\'s 1-day move, $M market cap, weekly perf kept separately', () => {
  const r = rowFromScan(row('FSLY', 'NASDAQ', 13.7, 2_400_000_000))!;
  assert.equal(r.ticker, 'FSLY'); assert.equal(r.movePct, 13.7); assert.equal(r.marketCap, 2400);
  assert.equal(r.perf.w1, 18); assert.equal(r.perf.m1, 25);
});

test('screen keeps US small/mid gainers, drops OTC and large caps', () => {
  const rows = [row('AAA', 'NASDAQ', 9, 800e6), row('BBB', 'OTC', 20, 900e6), row('CCC', 'NYSE', 6, 50e9)].map((d) => rowFromScan(d)!);
  const { kept, excluded } = screenUsGainers(rows);
  assert.deepEqual(kept.map((k) => k.ticker), ['AAA']);
  assert.equal(excluded.length, 2);
});

test('session label: during the session it is TODAY and live; before the open it is the last completed session', () => {
  const open = describeLiveScan(new Date('2026-09-24T15:00:00Z'));      // 11:00 ET Thu
  assert.equal(open.intraday, true); assert.equal(open.session, '2026-09-24'); assert.equal(open.stale, false);
  assert.match(open.label, /today's \(2026-09-24\) move so far/);
  const pre = describeLiveScan(new Date('2026-09-24T11:00:00Z'));       // 07:00 ET Thu
  assert.equal(pre.intraday, false); assert.equal(pre.session, '2026-09-23');
  assert.match(pre.label, /not open yet/);
  const after = describeLiveScan(new Date('2026-09-24T21:00:00Z'));     // 17:00 ET Thu
  assert.equal(after.session, '2026-09-24'); assert.match(after.label, /completed session/);
});

test('query asks for US exchanges, stock type, $300M–$10B, sorted by today\'s change', () => {
  const b: any = liveScanBody();
  assert.equal(b.sort.sortBy, 'change');
  assert.ok(b.filter.some((f: any) => f.left === 'exchange' && f.right.includes('NASDAQ')));
  assert.ok(b.filter.some((f: any) => f.left === 'market_cap_basic' && f.right[0] === 300e6 && f.right[1] === 10e9));
});

test('a failed live read reports an error (never throws) so the page falls back loudly', async () => {
  const bad = (async () => { throw new Error('network down'); }) as any;
  const r = await fetchUsLiveGainers(new Date('2026-09-24T15:00:00Z'), bad);
  assert.equal(r.rows.length, 0); assert.match(r.error || '', /live US scan failed/);
});
