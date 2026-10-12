import { test } from 'node:test';
import assert from 'node:assert/strict';
import { returnFromToday, guidanceToEps, impliedPe, cagr } from '../return-math';

const near = (a: number, b: number, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('zzz966 the ₹800 example: EPS almost triples, ~1.7% a year', () => {
  const r = returnFromToday({ price: 800, eps0: 10, growthPct: 30, years: 4, exitPe: 30, hurdlePct: 20 });
  near(r.exitPrice, 856.83);
  near(r.priceCagrPct, 1.73);
  near(r.path[4].peOnToday, 28.0);
  near(r.path[2].peOnToday, 47.34);
  near(r.hurdleEntryPrice, 413.21);
  near(r.priceMultiple, r.epsMultiple * r.peRatio, 1e-9);   // the identity
  assert.equal(r.verdict, 'insufficient');
  near(cagr(856.83 / 200, 4), 43.85, 0.1);
  near(cagr(856.83 / 400, 4), 20.98, 0.1);
});

test('zzz966 guidance → diluted EPS and P/S ↔ P/E', () => {
  const g = guidanceToEps(30, 10, 12, 10);
  near(g.patGrowthPct, 56); near(g.epsGrowthPct, 41.82);
  near(impliedPe(10, 10), 100); near(impliedPe(10, 25), 40);
});
