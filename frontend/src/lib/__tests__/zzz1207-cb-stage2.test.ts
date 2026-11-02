// zzz1207 — Conviction Beats (India + USA): Stage 2 yes / no in the preset, from the weekly Stage Analysis stage on the
// screener snapshot; 30-week stage, then the stage at results, as labelled fallbacks; no stage passes neither.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stageOf, passesStage2, stageIndex, parseStage2 } from '../cb-stage2';
import { passesConvictionFilter, FILTER_DEFAULT } from '../conviction-filter-india';
import { passesUsConvictionFilter, US_FILTER_DEFAULT } from '../conviction-beats-us';
import { withDebtEquity } from '../use-debt-equity';

test('weekly stage first, labelled fallbacks, unknown passes neither', () => {
  assert.equal(stageOf({ wst: 2, st30: 4, stage: 1, wst_wk: 14, wst_h: 2 }).text, 'Stage 2 · 14 wk · healthy');
  assert.equal(stageOf({ st30: 3, stage: 2 }).text, 'Stage 3 (30-week)');
  assert.equal(stageOf({ stage: 2 }).text, 'Stage 2 (at results)');
  assert.equal(passesStage2({ wst: 2 }, 'yes'), true);
  assert.equal(passesStage2({ wst: 1 }, 'yes'), false);
  assert.equal(passesStage2({ wst: 1 }, 'no'), true);
  assert.equal(passesStage2({}, 'yes'), false);
  assert.equal(passesStage2({}, 'no'), false);
  assert.equal(passesStage2({}, 'any'), true);
  assert.equal(parseStage2('junk'), 'any');
});

test('the slim screener rows are laid on the cards and both filters use them', () => {
  const st = stageIndex([{ t: 'AEROFLEX', twSt: 2, twWk: 20, twH: 2 }, { t: 'VEDL', twSt: 4 }]);
  const [a, v] = withDebtEquity([{ ticker: 'NSE:AEROFLEX' }, { ticker: 'VEDL' }] as any[], {}, st);
  assert.equal(a.wst, 2); assert.equal(v.wst, 4);
  const inF = { ...FILTER_DEFAULT, stage2: 'yes' as const };
  assert.equal(passesConvictionFilter(a as any, inF), true);
  assert.equal(passesConvictionFilter(v as any, inF), false);
  const usF = { ...US_FILTER_DEFAULT, stage2: 'no' as const };
  assert.equal(passesUsConvictionFilter(v as any, usF), true);
  assert.equal(passesUsConvictionFilter(a as any, usF), false);
});
