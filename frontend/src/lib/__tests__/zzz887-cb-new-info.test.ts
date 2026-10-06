// zzz887 — Conviction Beats "new information" score. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newInfoScore, yoySeries, newInfoWord } from '../cb-new-info';

const q8 = (a: number[]) => a;   // oldest → newest
test('YoY series from 8 quarters', () => {
  assert.deepEqual(yoySeries(q8([100, 100, 100, 100, 110, 120, 130, 150])).map((v) => Math.round(v)), [10, 20, 30, 50]);
});
test('guidance raise + acceleration + margin turn + cash outranks a bigger but stale beat', () => {
  const fresh = newInfoScore({ sales_yoy_pct: 30, net_profit_yoy_pct: 45, guidanceRaised: true, quarters_sales: [100, 100, 100, 100, 112, 118, 125, 140], opm_pct: 18, opm_prev_pct: 14, annual_cfo_pat: [0.9, 1.1], move_pct: 8 });
  const stale = newInfoScore({ sales_yoy_pct: 60, net_profit_yoy_pct: 90, quarters_sales: [100, 100, 100, 100, 170, 165, 150, 130], opm_pct: 12, opm_prev_pct: 13, annual_cfo_pat: [0.3], move_pct: 2 });
  assert.ok(fresh.score > stale.score, `${fresh.score} > ${stale.score}`);
  assert.equal(fresh.price, 'CONFIRMS'); assert.match(fresh.why, /guidance raised/); assert.match(stale.why, /growth slowed/); assert.match(stale.why, /not backed by cash/);
});
test('price never adds points, it only confirms', () => {
  const base = { sales_yoy_pct: 30, net_profit_yoy_pct: 40, opm_pct: 15, opm_prev_pct: 12 };
  assert.equal(newInfoScore({ ...base, move_pct: 25 }).score, newInfoScore({ ...base, move_pct: -20 }).score);
  assert.equal(newInfoScore({ ...base, move_pct: -20 }).price, 'FADED');
  assert.equal(newInfoScore(base).price, 'NO_PRICE');
});
test('profit flattered by other income / one-offs is discounted, and missing data is named', () => {
  const clean = newInfoScore({ sales_yoy_pct: 20, net_profit_yoy_pct: 60 });
  const flat = newInfoScore({ sales_yoy_pct: 20, net_profit_yoy_pct: 60, other_income_pct_sales_curr: 25, exceptional_pct_pbt: 40 });
  assert.ok(flat.score < clean.score); assert.match(flat.why, /profit flattered/);
  assert.match(clean.why, /Not scored \(no data\): guidance, quarterly history, margin, cash flow/);
  assert.equal(newInfoWord(65), 'Major'); assert.equal(newInfoWord(5), 'None');
});
