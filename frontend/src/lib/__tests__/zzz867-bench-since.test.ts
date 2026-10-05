import { test } from 'node:test';
import assert from 'node:assert/strict';
const store: Record<string, string> = {};
(globalThis as any).window = { dispatchEvent() {}, addEventListener() {} };
(globalThis as any).CustomEvent = class { constructor(public type: string) {} };
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } };
import { syncFromEarningsOps, getConvictionList, setBenchSince, getBenchSince, clearConvictionBeats } from '../conviction-beats';

const mk = (ticker: string, filing_date: string) => ({ ticker, company: ticker, tier: 'STRONG' as const, composite_score: 70, sales_yoy_pct: 20, net_profit_yoy_pct: 30, eps_yoy_pct: 30, filing_date });

test('start date: older filings are not added back after a clear', () => {
  clearConvictionBeats(); setBenchSince('2026-09-25');
  syncFromEarningsOps([mk('OLDCO', '2026-08-10'), mk('NEWCO', '2026-09-30')] as any);
  assert.deepEqual(getConvictionList().map((e) => e.ticker), ['NEWCO']);
});
test('removing the start date allows all again', () => {
  setBenchSince(null); assert.equal(getBenchSince(), null);
  syncFromEarningsOps([mk('OLDCO', '2026-08-10')] as any);
  assert.ok(getConvictionList().some((e) => e.ticker === 'OLDCO'));
});
