// zzz934 — focus-list values: US one-off profits, US sales pace, raise-rate growth, US general multiples, valuation words, no lost names.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fairValue, fvGrowthOf, fvStatus, type FvFacts } from '../gu-fair-value';

const US = (o: Partial<FvFacts>): FvFacts => ({ market: 'US', price: 50, mcap: 1000, salesBase: 1000, opFy: null, patFy: 60, borrowings: null, salesGrowthFy: null, salesCagr3y: null, sector: 'Consumer Discretionary', industry: 'Restaurants', ...o });

describe('zzz934 · fair value fills', () => {
  test('a raise of a growth RATE is used as the growth (BJ\'s showed "no growth rate guided")', () => {
    const g = fvGrowthOf({ growthPct: null, growthTrust: null, raiseDetail: { metric: 'REVENUE_GROWTH', afterMid: 3.5, isGrowthRate: true, periodKind: null } });
    assert.equal(g?.growthPct, 3.5); assert.equal(g?.growthMetric, 'REVENUE');
    const r = fairValue(US({}), g);
    assert.equal(r.ok, true); assert.equal(r.basis, 'guided');
    // a margin-rate raise is not a growth to project
    const m = fvGrowthOf({ growthPct: null, growthTrust: null, raiseDetail: { metric: 'OP_MARGIN', afterMid: 27, isGrowthRate: true, periodKind: null } });
    assert.equal(m?.growthPct, null);
  });
  test('USA: the latest quarter\'s sales growth is the history when the SEC row has no yearly figures', () => {
    const r = fairValue(US({ salesYoyQ: 8 }), { growthPct: null, growthTrust: null });
    assert.equal(r.ok, true); assert.equal(r.basis, 'history');
    assert.ok(r.inputs.some((i) => /latest quarter vs the year-ago quarter/.test(i)));
  });
  test('USA: a net profit far above the operating margin is a one-off and gets no P/E (Twilio-like)', () => {
    const r = fairValue(US({ salesBase: 6000, patFy: 4269, mcap: 43000, price: 280, opmNow: 4, salesYoyQ: 12 }), { growthPct: null, growthTrust: null });
    assert.ok(r.inputs.some((i) => /one-off/.test(i)));
    assert.ok(!r.methods.some((m) => m.method === 'PE'));
  });
  test('USA: India-only sector bands are not used (a restaurant is on the general multiples)', () => {
    const r = fairValue(US({ industry: 'Department/Specialty Retail Stores', salesYoyQ: 5 }), { growthPct: null, growthTrust: null });
    assert.match(r.sectorLabel, /general US market multiples/);
    const steel = fairValue(US({ industry: 'Steel/Iron Ore', salesYoyQ: 5 }), { growthPct: null, growthTrust: null });
    assert.equal(steel.sectorLabel, 'Steel & Metals');
  });
  test('valuation words, kept apart from the guidance verdict; the market P/E is reported', () => {
    assert.equal(fvStatus(40).key, 'below'); assert.equal(fvStatus(0).key, 'near'); assert.equal(fvStatus(-30).key, 'above'); assert.equal(fvStatus(-75).key, 'far-above');
    const r = fairValue(US({ salesYoyQ: 5 }), { growthPct: null, growthTrust: null });
    assert.equal(r.marketPe, 16.7);
  });
});

describe('zzz934 · no name is lost', () => {
  const route = readFileSync(join(__dirname, '../../app/api/v1/guidance-upgrades/skygold/route.ts'), 'utf8');
  const hook = readFileSync(join(__dirname, '../../components/guidance-upgrades/GuSkyGold.tsx'), 'utf8');
  test('names past the per-call limit and US names whose price read was cut off come back as pending', () => {
    assert.match(route, /usAll\.slice\(MAX_PER_MARKET\)/);
    assert.match(route, /capSkipped\.has\(t\)\) \{ pending\.push/);
  });
  test('the page asks in slices of 40', () => {
    assert.match(hook, /const CHUNK = 40/);
  });
});
