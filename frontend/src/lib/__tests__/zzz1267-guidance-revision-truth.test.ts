// zzz1266 / zzz1267 — Guidance Upgrades: one build at a time; a point's own sentence decides its revision; other-measure priors are
// dropped; "+16% +17%" in a table is not an open-ended "+16%+"; one company under two symbols is one row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textSaysGuidanceRaised, saysUnchanged, sameMeasureAs, familyOfLabel, type GuVersionIn } from '../guidance-universe-integrity';
import { isLowBoundOnly } from '../guidance-horizon';

const read = (...p: string[]) => readFileSync(new URL(['..', ...p].join('/'), import.meta.url), 'utf8');
const ver = (absLow: number | null, absHigh: number | null, unit: string | null, low: number | null = null, high: number | null = null): GuVersionIn => ({ date: '2026-10-27', low, high, absLow, absHigh, unit, source: 's', display: 'd' });

test('a raise stated with "raising" beside a reaffirmed other measure is a raise', () => {
  assert.equal(textSaysGuidanceRaised('raising revenue growth guidance to 4.5 to 5.5 percent and reaffirming its organic growth guidance of 3 to 4 percent'), true);
  assert.equal(textSaysGuidanceRaised('The Company also reiterated its expectations to generate full year net income in the range of $455 million to $470 million.'), false);
});

test('"unchanged" wording', () => {
  assert.equal(saysUnchanged('Net sales $3.43B to $3.50B (Unchanged) +1.0% to +3.0%'), true);
  assert.equal(saysUnchanged('DTE Energy confirms 2026 operating EPS guidance of $7.59 to $7.73.'), true);
  assert.equal(saysUnchanged('We expect revenue to grow 20% in FY27.'), false);
});

test('an earlier figure more than 4x away is another measure', () => {
  assert.equal(sameMeasureAs(ver(28, 32, '$M'), ver(2.43, 2.44, '$B')), false);      // EXLS: a $28–32M fragment beside $2.43B revenue
  assert.equal(sameMeasureAs(ver(2.39, 2.415, '$B'), ver(2.43, 2.44, '$B')), true);
  assert.equal(sameMeasureAs(ver(43000, 45000, '₹ Cr'), ver(44000, 46000, '₹ Cr')), true);
  assert.equal(sameMeasureAs(ver(null, null, null, 10, 15), ver(2.43, 2.44, '$B')), true);   // a percent prior: cannot be judged, kept
});

test('table columns "+16% +17%" are not an open-ended floor; real floors still are', () => {
  assert.equal(isLowBoundOnly('Revenue $1,143 - $1,163 $1,130 - $1,150 $994 $982 +16% \n +17%', 16), false);
  assert.equal(isLowBoundOnly('growth of 30%+ next year', 30), true);
  assert.equal(isLowBoundOnly('at least 30% growth', 30), true);
});

test('operating cash flow is not read as net profit', () => {
  assert.equal(familyOfLabel('Net cash provided by operating activities from continuing operations'), 'FCF');
  assert.equal(familyOfLabel('Net income'), 'NET_PROFIT');
  assert.equal(familyOfLabel('Net sales'), 'REVENUE');
});

test('wiring: single build, own-sentence guard, same-name merge, derived wording accepted', () => {
  const svc = read('guidance-universe-service.ts');
  assert.match(svc, /if \(building\) return building;/);
  const u = read('guidance-universe.ts');
  assert.match(u, /revision === 'RAISED' && !movedUp && !textSaysGuidanceRaised\(stmt\)/);
  assert.match(u, /the same company under another symbol/);
  assert.match(u, /totalVsYearly/);
  assert.match(read('guidance-invariants.ts'), /worked out from /);
  assert.match(read('boot-warm.ts'), /guidance lists/);
});
