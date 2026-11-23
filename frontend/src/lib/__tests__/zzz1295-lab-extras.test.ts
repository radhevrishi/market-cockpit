import test from 'node:test';
import assert from 'node:assert/strict';
import { labExtras } from '../company-lab/extras';
import { labScore } from '../company-lab/score';

const NOW = Date.parse('2026-11-23T12:00:00Z');

test('NBIS-like crash under the 30-week line: Stage 2 read as broken', () => {
  const x = labExtras({ row: { px: 100.7, sma150: 202, sma50: 150, hi52: 240, pe: null }, epsCagr3: null, lastResult: null, guidanceUp: null, stage: 2, rsRatio: 0.8, now: NOW });
  assert.equal(x.stageCheck.flag, 'broken');
  assert.equal(x.stageCheck.effective, 3);
  assert.ok(x.ext150! < -40);
});

test('APLAPOLLO-like laggard: Stage 2 near its line but RS vs index under 1 = lagging', () => {
  const x = labExtras({ row: { px: 1990, sma150: 2004 }, epsCagr3: null, lastResult: null, guidanceUp: null, stage: 2, rsRatio: 0.97, now: NOW });
  assert.equal(x.stageCheck.flag, 'lagging');
});

test('PEG, entry, next result estimate, promoter change', () => {
  const earnD = Math.floor(Date.parse('2026-10-25') / 86_400_000);
  const x = labExtras({
    row: { px: 110, sma50: 100, pe: 30, epsTTMYoY: 40, earnD, roceTTM: 22, roceFY: 21, roceP: 17 }, epsCagr3: null, lastResult: null, guidanceUp: '2026-11-01',
    shpQ: { h: ['Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026', 'Sep 2026'], prom: [60, 59, 58, 57, 55], fii: [5, 5, 5, 5, 6], dii: [3, 3, 3, 3, 4] }, stage: 2, rsRatio: 1.3, now: NOW,
  });
  assert.equal(x.peg, 0.75);
  assert.equal(x.ext50, 10);
  assert.equal(x.nextResultEst, '2027-01-24');
  assert.equal(x.promChg, -5);
  assert.equal(x.inst, 10);
  assert.equal(x.stageCheck.flag, null);
});

test('score: a broken Stage 2 is capped at 65 and ranks below the same company still healthy', () => {
  const base = { revQ: 40, accel: 'accelerating' as const, epsG: 50, revY: 35, r40: 45, om: 18, omChg: 2, gmChg: 1, fcfPassed: 3, fcfKnown: 4, fcfM: 8, cfoPat: 1.1, de: 0.2, squeeze: 'Low' as const, dilution: 1, stage: 2, tt: 6, rs: 90, roce: 25, roceFY: 25, rocePrev: 20, roe: 22, peg: 0.9, ext50: 8 };
  const ok = labScore(base), bad = labScore({ ...base, stageFlag: 'broken' });
  assert.ok((bad.score ?? 99) <= 65);
  assert.ok((ok.score ?? 0) > (bad.score ?? 0));
  assert.equal(ok.pillars.length, 6);
});
