// zzz1232 — Return Simulator maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, requiredGrowth, buyBelow, yearsToMultiple, cagrFor, guidanceToPrice, pegFair, epsAfterDilution } from '../return-sim';

const near = (a: number | null | undefined, b: number, e = 1e-6) => assert.ok(a != null && Math.abs(a - b) < e, `${a} vs ${b}`);

test('the owner\'s example: 25% EPS growth, P/E 30 → 25 over 5 years', () => {
  const s = simulate(0.25, 30, 25, 5, 100000)!;
  near(s.peDrift, Math.pow(25 / 30, 1 / 5) - 1);
  near(s.annualReturn, 1.25 * Math.pow(25 / 30, 0.2) - 1);
  near(s.multiple, Math.pow(1.25, 5) * 25 / 30, 1e-9);
  near(s.endValue, 100000 * s.multiple, 1e-6);
});
test('reverse: the EPS growth needed; buy-below; timelines; guidance; PEG; dilution', () => {
  const need = requiredGrowth(0.25, 40, 25, 5)!;
  near(simulate(need, 40, 25, 5)!.annualReturn, 0.25);
  const b = buyBelow(20, 0.25, 5, 25, 0.2, 500)!;
  near(b.futurePrice, 20 * Math.pow(1.25, 5) * 25);
  near(b.maxPrice, b.futurePrice / Math.pow(1.2, 5));
  assert.ok(b.marginOfSafety! > 0);
  near(yearsToMultiple(2, 0.072)!, Math.log(2) / Math.log(1.072));
  near(cagrFor(5, 5)!, Math.pow(5, 0.2) - 1);
  const g = guidanceToPrice(1000, 0.12, 5, 30, 1500, 2)!;
  near(g.eps, 24); near(g.targetPrice, 720); near(g.upside!, 720 / 1500 - 1);
  assert.equal(pegFair(30, 1, 45)!.fairPe, 30);
  near(epsAfterDilution(0.3, 0.05)!, 1.3 / 1.05 - 1);
  assert.equal(simulate(0.2, 0, 10, 5), null);
});
