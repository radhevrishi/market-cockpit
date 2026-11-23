import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accelOf } from '../company-lab/quarterly';
import { labScore, type ScoreInput } from '../company-lab/score';

test('growth trend: a late jump is speeding up, a rebound off a fall is uneven, a slide is slowing', () => {
  assert.equal(accelOf([6, 8, 4, 44]).state, 'accelerating');        // ROLEXRINGS
  assert.equal(accelOf([37, 12, -52, 144]).state, 'uneven');         // HEGAM
  assert.equal(accelOf([17, 36, 14, 79]).state, 'uneven');           // KOPRAN
  assert.equal(accelOf([31, 27, 35, 10]).state, 'decelerating');     // ANURAS
  assert.equal(accelOf([43, 25, 56, 40]).state, 'steady');           // MACPOWER
  assert.equal(accelOf([141, 87, 172, 335]).state, 'accelerating');  // NETWEB
  assert.equal(accelOf([5]).state, 'unknown');
});

const base: ScoreInput = { revQ: 40, accel: 'accelerating', epsG: 50, revY: 30, r40: 45, om: 18, omChg: 3, gmChg: 1, fcfPassed: 5, fcfKnown: 7, fcfM: 6, cfoPat: 1, de: 0.3, squeeze: 'Low', dilution: 1, stage: 2, tt: 6, rs: 92 };
test('overall score: a fast grower in Stage 2 scores A; balance caps stop one pillar carrying it', () => {
  const s = labScore(base);
  assert.ok(s.score! >= 75, `got ${s.score}`); assert.equal(s.grade, 'A');
  const s4 = labScore({ ...base, stage: 4, tt: 1, rs: 10 });
  assert.ok(s4.score! <= 55); assert.ok(s4.caps.some((c) => /Stage 4/.test(c)));
  const noGrowth = labScore({ ...base, revQ: -15, epsG: -40, accel: 'decelerating', r40: 0, revY: -10 });
  assert.ok(noGrowth.score! <= 60);
  const broken = labScore({ ...base, squeeze: 'High', squeezeCombo: true, cfoPat: -0.4, de: 2.5, dilution: 30, fcfPassed: 0, fcfKnown: 7 });
  assert.ok(broken.score! <= 65);
});
test('overall score: with few inputs known it is pulled toward 50 and says so', () => {
  const s = labScore({ revQ: null, accel: null, epsG: null, revY: null, r40: null, om: null, omChg: null, gmChg: null, fcfPassed: 0, fcfKnown: 0, fcfM: null, cfoPat: null, de: null, squeeze: null, dilution: null, stage: 2, tt: 6, rs: 99 });
  assert.ok(s.score! < 80);
  assert.ok(s.caps.some((c) => /pulled toward 50/.test(c)));
});
