// zzz1189 — Guidance Upgrades: like-for-like raises only ("$0.08 → 94.5 occupancy" is not +119,275%), "other" measures never lead;
// prior-year actuals read for every India company (not the first 150); newest-guidance table; retired heartbeats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { raiseLine } from '../gu-focus';
import { loadPriorActuals, actualKey, type ExtractIo } from '../guidance-extract-reader';

const ch = (metric: string, before: any, after: any, pct: number | null) => ({ metric, direction: 'UP', before: { metric, period: 'FY26', ...before }, after: { metric, period: 'FY26', ...after }, percentageChange: pct });

test('a raise compares like with like; an other measure never leads, alone it is a small raise', () => {
  const fr: any = { changes: [
    ch('OTHER', { low: 0.08, high: 0.08, midpoint: 0.08, currency: '$', unit: '' }, { low: 94.5, high: 96.5, midpoint: 95.5, unit: '' }, 119275),
    ch('REVENUE_GROWTH', { low: 5.25, high: 6.25, midpoint: 5.75, isGrowthRate: true, unit: '%' }, { low: 6.25, high: 6.75, midpoint: 6.5, isGrowthRate: true, unit: '%' }, null),
  ] };
  fr.changes[1].percentagePointChange = 0.75;
  const l = raiseLine(fr)!;
  assert.doesNotMatch(l.text, /119275|occupancy/);
  assert.match(l.text, /revenue/i);
  const pine: any = { changes: [ch('OTHER', { low: 170, high: 200, midpoint: 185, currency: '$', unit: 'M' }, { low: 310, high: 350, midpoint: 330, currency: '$', unit: 'M' }, 78.4)] };
  const p = raiseLine(pine)!;
  assert.equal(p.smallBaseOnly, true);
  assert.match(p.text, /not a revenue/);
  const tdy: any = { changes: [ch('REVENUE', { low: 785, high: 785, midpoint: 785, currency: '$', unit: 'M' }, { low: 903, high: 903, midpoint: 903, currency: '$', unit: 'M' }, 15)] };
  assert.equal(raiseLine(tdy)!.smallBaseOnly, false);
});

test('prior-year actuals are read for every India company that needs one (chunks of 150)', async () => {
  const results: any[] = Array.from({ length: 320 }, (_, i) => ({ market: 'IN', ticker: `T${i}`, company: `C${i}`, docKind: 'TRANSCRIPT', filedAt: '2026-08-10T00:00:00Z',
    rows: [{ metric: 'REVENUE', periodKind: 'ANNUAL', period: 'FY27', currency: 'INR', unit: 'crore', low: 500, high: 500 }] }));
  const calls: number[] = [];
  const io = { get: async () => null, mget: async (keys: string[]) => { calls.push(keys.length); return keys.map(() => ({ quarters_sales: [100, 100, 100, 100], quarters_dates: ['Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026'] })); } } as unknown as ExtractIo;
  const a = await loadPriorActuals(results as any, io);
  assert.ok(calls.length >= 3 && calls.every((n) => n <= 150));
  assert.equal(a.get(actualKey('IN', 'T319', 'REVENUE', 'FY26'))?.value, 400);
});

test('the focus list has the newest-guidance table; removed jobs no longer count as silent heartbeats', () => {
  assert.match(readFileSync('src/components/guidance-upgrades/GuFocusList.tsx', 'utf8'), /C\. Newest guidance — last 14 days, any growth/);
  assert.match(readFileSync('src/app/api/v1/cron/heartbeat/route.ts', 'utf8'), /'scrape-super-investors', 'scrape-commodity-prices'/);
});
