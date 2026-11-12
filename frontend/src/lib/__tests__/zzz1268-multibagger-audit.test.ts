// zzz1268 — Multibagger audit: the Operating Leverage Cluster reads India figures; decisions, AVOID and baselines are per market;
// a past results date is not "results soon"; guidance mode uses the scorer's ceilings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeClusterScore } from '../op-leverage-cluster';
import { decisionLookup } from '../decisions';

const read = (...p: string[]) => readFileSync(new URL(['..', '..', ...p].join('/'), import.meta.url), 'utf8');

test('an India row with strong figures can reach the top cluster tier (it stopped at 54 before)', () => {
  const r = computeClusterScore({ symbol: 'X', sector: 'Capital Goods', roce: 32, opm: 24, opmPrev: 19, yoySalesGrowth: 34, salesGrowth3y: 26, yoyProfitGrowth: 70, de: 0.1, interestCoverage: 14, fcfAbsolute: 120, gpm: 55, roic: 25, capex3yr: 900 });
  assert.ok(r.score >= 65, `score ${r.score}`);
  assert.equal(r.downgrades.some((d: string) => /Capex/.test(d)), false);   // a rupee capex amount is not "capex ÷ sales"
});

test('US and India decisions do not cross', () => {
  const map: any = { 'US:INFY': { symbol: 'INFY', market: 'US', status: 'BUY' }, INFY: { symbol: 'INFY', market: 'IN', status: 'REJECTED' } };
  assert.equal(decisionLookup(map, 'INFY', 'US')!.status, 'BUY');
  assert.equal(decisionLookup(map, 'INFY', 'IN')!.status, 'REJECTED');
});

test('wiring', () => {
  const a = read('app', '(dashboard)', 'multibagger', 'analytics.tsx');
  assert.match(a, /decisionLookup\(decisionMap as any, stripSym\(s\.symbol\), s\.market === 'USA' \? 'US' : 'IN'\)/);
  assert.match(a, /if \(s\.market !== 'INDIA'\) return false;/);
  assert.doesNotMatch(a, /\{ \.\.\.ind, \.\.\.us \}/);
  const u = read('app', '(dashboard)', 'multibagger', 'usa-analytics.tsx');
  assert.match(u, /d >= 0 && d <= 7/);
  assert.doesNotMatch(u, /earningsProximityDays \?\? 999/);
  const t = read('app', '(dashboard)', 'multibagger', 'india-tab.tsx');
  assert.doesNotMatch(t, /bucket === 'MONITOR'\)\s+newScore = Math\.min\(newScore, 45\)/);
  assert.match(t, /DECELERATING'\) newScore = Math\.min\(newScore, 62\)/);
});
