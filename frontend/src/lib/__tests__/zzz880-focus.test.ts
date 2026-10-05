// zzz880 — the focus list at the top of the guidance page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFocusList, raiseLine } from '../gu-focus';

const ev = (ticker: string, market: 'IN' | 'US', date: string, before: [number, number], after: [number, number], extra: any = {}) => ({
  guidance_event_id: `e-${ticker}`, ticker, company: `${ticker} Ltd`, market, announcement_date: date, verification: 'VERIFIED', taxonomy: 'formal_upgrade',
  pipeline: { status: 'CARD' },
  changes: [{ metric: 'REVENUE', direction: 'UP', percentageChange: Math.round(((after[0] + after[1]) / 2 / ((before[0] + before[1]) / 2) - 1) * 1000) / 10, percentagePointChange: null,
    before: { period: 'FY27', low: before[0], high: before[1], midpoint: (before[0] + before[1]) / 2, unit: 'Cr', currency: '₹', isGrowthRate: false },
    after: { period: 'FY27', low: after[0], high: after[1], midpoint: (after[0] + after[1]) / 2, unit: 'Cr', currency: '₹', isGrowthRate: false } }],
  ...extra,
}) as any;
const hg = (ticker: string, market: 'IN' | 'US', v: number, trust = 'verified') => ({ id: ticker, entityKey: `${market}:${ticker}`, company: `${ticker} Ltd`, ticker, market, cohort: 'ANNUAL', trust, metrics: [], text: `Revenue +${v}%`, headline: { compareValue: v, period: 'FY27' }, sourceName: 's', sourceDate: null, sourceUrl: null }) as any;
const groups = (rows: any[]) => ({ threshold: 30, label: '', rule: '', cohorts: { ANNUAL: rows, MULTI_YEAR_CAGR: [], QUARTERLY: [] }, trust: {} as any, counts: {} as any }) as any;
const NOW = new Date('2026-10-05T12:00:00Z');

test('both signals first, then a big raise, then high growth; each row says why', () => {
  const evs = [ev('STALLION', 'IN', '2026-09-20', [250, 250], [275, 275]), ev('BIG', 'US', '2026-09-01', [100, 110], [140, 150]), ev('MISC', 'US', '2026-09-01', [100, 100], [103, 103], { verification: 'UNVERIFIED' })];
  const g = groups([hg('STALLION', 'IN', 45), hg('FAST', 'IN', 80), hg('SLOW', 'US', 31, 'partial')]);
  const out = buildFocusList(g, evs, NOW);
  assert.deepEqual(out.map((r) => r.ticker), ['STALLION', 'FAST', 'BIG']);
  assert.equal(out[0].verdict, 'TOP FOCUS'); assert.match(out[0].why, /both signals/);
  assert.equal(out[1].verdict, 'HIGH GROWTH'); assert.equal(out[2].verdict, 'STRONG RAISE');
  assert.match(out[0].raised!, /FY27 revenue: ₹250 Cr → ₹275 Cr \(\+10%\)/);
  assert.ok(!out.some((r) => r.ticker === 'MISC' || r.ticker === 'SLOW'), 'unverified raise and partial growth are left out');
});
test('raise line names the largest raise and how many more', () => {
  const e = ev('X', 'US', '2026-09-01', [10, 10], [11, 11]);
  e.changes.push({ ...e.changes[0], metric: 'EBITDA', percentageChange: 40, before: { ...e.changes[0].before, low: 5, high: 5 }, after: { ...e.changes[0].after, low: 7, high: 7 } });
  const l = raiseLine(e)!; assert.match(l.text, /EBITDA: ₹5 Cr → ₹7 Cr \(\+40%\) \+ 1 more/); assert.equal(l.pct, 40);
});
test('empty inputs give an empty list', () => { assert.deepEqual(buildFocusList(null, [], NOW), []); });

import { sizeOf } from '../gu-focus';
test('zzz880 — size: caps, large-cap list, unknown; a tiny raise is not top focus', () => {
  assert.deepEqual(sizeOf('IN', 'X', { caps: { IN: { X: 1140 } } }), { size: 'SMALL_MID', capText: '₹1,140 Cr' });
  assert.equal(sizeOf('US', 'DELL', { caps: { US: { DELL: 90_000 } } }).size, 'LARGE');
  assert.equal(sizeOf('IN', 'BAJFINANCE', { indiaLarge: new Set(['BAJFINANCE']) }).size, 'LARGE');
  assert.equal(sizeOf('US', 'NTWK', {}).size, null);
  const small = ev('KMTS', 'US', '2026-09-14', [137, 137], [141, 141]);
  const out = buildFocusList(groups([hg('KMTS', 'US', 48)]), [small], NOW);
  assert.equal(out[0].verdict, 'HIGH GROWTH'); assert.match(out[0].why, /small guidance raise/);
});
