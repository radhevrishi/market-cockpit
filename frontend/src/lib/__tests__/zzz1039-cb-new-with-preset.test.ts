// zzz1039 — owner: "preset on with NEW 10d should work; remove NEW 10d should work; only preset should work — all combinations".
// NEW · 10d was a bypass (it ignored the Quality Preset). It is now a recency filter that combines with every other choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILTER_DEFAULT, indiaPresetFilters, passesConvictionFilter, cbFailReasons, filingAgeDays, type ConvFilters } from '../conviction-filter-india';

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const good: any = { ticker: 'GOODCO', tier: 'STRONG', composite_score: 80, filing_date: day(3), sales_yoy_pct: 40, net_profit_yoy_pct: 60, eps_yoy_pct: 55,
  opm_pct: 20, opm_prev_pct: 16, cfo_to_pat_ratio: 1.2, market_cap_cr: 9000, pe: 25, roce: 25, move_pct: 4, pead_score: 75, pledged_pct: 0 };
const tiny: any = { ...good, ticker: 'TINY', market_cap_cr: 60 };
const old: any = { ...good, ticker: 'OLDCO', filing_date: day(40) };
// zzz1068 — the preset's size floor is now Any size by default; these combinations test it with the ₹3k Cr floor picked
const preset: ConvFilters = { ...FILTER_DEFAULT, ...indiaPresetFilters(3000) };
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
  // the age is counted from 09:30 IST and rounded, so a date 40 calendar days back reads 40 or 41 depending on the hour
  const age = filingAgeDays(old.filing_date);
  assert.ok(age === 40 || age === 41, String(age));
  assert.ok(r.some((x) => x.includes(`filed ${age} days ago (NEW shows the last `)), r.join(' | '));
});

test('zzz1040 — new results come first by default on both pages', async () => {
  const { readFileSync } = await import('node:fs');
  const ind = readFileSync(new URL('../../app/(dashboard)/watchlists/ConvictionBeatsPanel.tsx', import.meta.url), 'utf8');
  assert.match(ind, /filteredEntries = \[\.\.\.filteredEntries\.filter\(isNew\), \.\.\.filteredEntries\.filter\(\(e\) => !isNew\(e\)\)\];/);
  const us = readFileSync(new URL('../../app/(dashboard)/us-conviction-beats/page.tsx', import.meta.url), 'utf8');
  assert.match(us, /if \(na !== nb\) return na - nb;/);
});
