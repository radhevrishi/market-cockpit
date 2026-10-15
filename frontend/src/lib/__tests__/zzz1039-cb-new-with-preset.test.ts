// zzz1039 — owner: "preset on with NEW 10d should work; remove NEW 10d should work; only preset should work — all combinations".
// NEW · 10d was a bypass (it ignored the Quality Preset). It is now a recency filter that combines with every other choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILTER_DEFAULT, indiaPresetFilters, passesConvictionFilter, cbFailReasons, type ConvFilters } from '../conviction-filter-india';

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const good: any = { ticker: 'GOODCO', tier: 'STRONG', composite_score: 80, filing_date: day(3), sales_yoy_pct: 40, net_profit_yoy_pct: 60, eps_yoy_pct: 55,
  opm_pct: 20, opm_prev_pct: 16, cfo_to_pat_ratio: 1.2, market_cap_cr: 9000, pe: 25, roce: 25, move_pct: 4, pead_score: 75, pledged_pct: 0 };
const tiny: any = { ...good, ticker: 'TINY', market_cap_cr: 60 };
const old: any = { ...good, ticker: 'OLDCO', filing_date: day(40) };
const preset: ConvFilters = { ...FILTER_DEFAULT, ...indiaPresetFilters() };
const pass = (e: any, f: ConvFilters) => passesConvictionFilter(e, f);

test('all four combinations', () => {
  // preset only
  assert.equal(pass(tiny, preset), false);
  assert.equal(pass(old, preset), pass(good, preset));
  // NEW only (preset off): every name filed in the window, small or not
  const newOnly = { ...FILTER_DEFAULT, newOnly: true };
  assert.equal(pass(good, newOnly), true);
  assert.equal(pass(tiny, newOnly), true);
  assert.equal(pass(old, newOnly), false);
  // preset + NEW: new AND passing the preset
  const both = { ...preset, newOnly: true };
  assert.equal(pass(tiny, both), false, 'a new name that fails the preset stays hidden');
  assert.equal(pass(old, both), false, 'an old name stays hidden');
  assert.equal(pass(good, both), pass(good, preset));
  // neither
  assert.equal(pass(tiny, FILTER_DEFAULT), true);
});

test('the reason list names the NEW window', () => {
  const r = cbFailReasons(old, { ...FILTER_DEFAULT, newOnly: true });
  assert.ok(r.some((x) => /filed 40 days ago \(NEW shows the last \d+ days\)/.test(x)), r.join(' | '));
});
