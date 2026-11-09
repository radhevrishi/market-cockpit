// zzz1238 — Conviction Beats preset: debt ÷ equity ≤ 0.5 and Rule of 40 ≥ 40 (India + USA);
// the owner's 31 screener.in screens run on our data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrasOf, passesR40Min, r40FailText } from '../cb-extras';
import { INDIA_PRESET } from '../quality-preset';
import { US_PRESET, usPresetFilters, isUsPresetActive } from '../conviction-beats-us';
import { indiaPresetFilters, isIndiaPresetActive, FILTER_DEFAULT } from '../conviction-filter-india';
import { compileQuery } from '../screener/screenerin-query';
import { SCREENERIN_DEFAULT_SCREENS } from '../screener/screenerin-defaults';

test('both presets carry debt ÷ equity ≤ 0.5 and Rule of 40 ≥ 40', () => {
  assert.equal(INDIA_PRESET.deMax, 0.5); assert.equal(INDIA_PRESET.r40Min, 40);
  assert.equal(US_PRESET.deMax, 0.5); assert.equal(US_PRESET.r40Min, 40);
  const fi = { ...FILTER_DEFAULT, ...indiaPresetFilters() };
  assert.equal(fi.deMax, 0.5); assert.equal(fi.r40Min, 40); assert.equal(isIndiaPresetActive(fi), true);
  assert.equal(isIndiaPresetActive({ ...fi, r40Min: null }), false);
  const fu = usPresetFilters() as any;
  assert.equal(fu.deMax, 0.5); assert.equal(fu.r40Min, 40);
});

test('Rule of 40: 30% growth + 15% FCF margin passes, 20 + 5 fails, unknown passes', () => {
  const good = { cbx: extrasOf({ t: 'A', revQYoY: 30, fcfmTTM: 15 }, 'IN') };
  const weak = { cbx: extrasOf({ t: 'B', revQYoY: 20, fcfmTTM: 5 }, 'IN') };
  assert.equal(passesR40Min(good, 40), true);
  assert.equal(passesR40Min(weak, 40), false);
  assert.match(r40FailText(weak, 40), /40/);
  assert.equal(passesR40Min({}, 40), true);
  assert.equal(passesR40Min(weak, null), true);
});

test('every screener.in screen compiles with no unknown names', () => {
  assert.equal(SCREENERIN_DEFAULT_SCREENS.length, 31);
  for (const d of SCREENERIN_DEFAULT_SCREENS) {
    const c = compileQuery(d.query);
    assert.equal(c.error, null, d.slug);
    assert.deepEqual(c.unknown, [], d.slug);
  }
});

test('%, coalesce, Is not SME and the pledge assumption', () => {
  const ipo = compileQuery('coalesce (Market Capitalization 3years back, -.001) = -.001 AND Is not SME AND Return on capital employed > 12%');
  assert.equal(ipo.test({ 'Market Capitalization 3years back': null, 'Return on capital employed': 13 }), true, 'listed under 3 years');
  assert.equal(ipo.test({ 'Market Capitalization 3years back': 900, 'Return on capital employed': 13 }), false);
  assert.equal(ipo.test({ 'Market Capitalization 3years back': null, 'Return on capital employed': 11 }), false);
  assert.equal(compileQuery('Is SME').test({}), false);
  const pl = compileQuery('Pledged percentage < 0.5% AND OPM > 10');
  assert.deepEqual(pl.assumed, ['Pledged percentage']);
  assert.equal(pl.test({ OPM: 12 }), true);
  assert.equal(pl.test({ OPM: 8 }), false);
  const gc = compileQuery('DMA 50 > DMA 200 AND DMA 50 previous day < DMA 200 previous day');
  assert.equal(gc.test({ 'DMA 50': 101, 'DMA 200': 100, 'DMA 50 previous day': 99, 'DMA 200 previous day': 100 }), true);
  assert.equal(gc.test({ 'DMA 50': 101, 'DMA 200': 100, 'DMA 50 previous day': 100.5, 'DMA 200 previous day': 100 }), false);
});

test('capex screen: net block doubled in 3 years OR (net block + CWIP) up 1.5×', () => {
  const q = SCREENERIN_DEFAULT_SCREENS.find((d) => d.slug === 'capex-and-less-public-holding')!.query;
  const c = compileQuery(q);
  const base = { 'Sales growth': 20, 'Debt to equity': 0.2, 'Market Capitalization': 5000, 'Down from 52w high': 10, 'Return on capital employed': 15, 'Average return on capital employed 3Years': 18, 'Public holding': 25 };
  assert.equal(c.test({ ...base, 'Net block': 300, 'Net block 3Years back': 100, 'Capital work in progress': 0, 'Net block preceding year': 280, 'Capital work in progress preceding year': 0 }), true);
  assert.equal(c.test({ ...base, 'Net block': 150, 'Net block 3Years back': 100, 'Capital work in progress': 10, 'Net block preceding year': 140, 'Capital work in progress preceding year': 5 }), false);
});

// ── Hidden Inflection Radar fixes (owner's page, 9 Nov 2026) ──
import { industriesOf, readSignal, isSyntheticHeadline, recencyWeight, industryScore } from '../inflection/core';

test('radar: chip packaging is not packaging; our alert lines are not news', () => {
  assert.ok(!industriesOf('TSMC expands CoWoS advanced packaging capacity').includes('packaging'));
  assert.ok(industriesOf('TSMC expands CoWoS advanced packaging capacity').includes('semis-packaging'));
  assert.ok(industriesOf('Corrugated box prices rise 12% as kraft paper tightens').includes('packaging'));
  assert.equal(isSyntheticHeadline('[STRUCTURAL ALERT] Packaging bottleneck shifting upstream'), true);
  assert.equal(isSyntheticHeadline('Kraft paper prices rise'), false);
});

test('radar: a won order is demand (rail headlines were all scored 0 before)', () => {
  assert.ok(readSignal('Titagarh Rail bags ₹1,200 crore wagon order from Indian Railways').classes.includes('DEMAND'));
  assert.ok(readSignal('Jupiter Wagons secures order worth Rs 950 crore').classes.includes('DEMAND'));
});

test('radar: older news counts less; one headline alone scores below a confirmed theme', () => {
  assert.equal(recencyWeight(5), 1); assert.equal(recencyWeight(45), 0.75); assert.equal(recencyWeight(100), 0.6);
  const one = industryScore([{ score: 60, ageDays: 3, headline: 'a' }]);
  const many = industryScore([{ score: 60, ageDays: 3, headline: 'a' }, { score: 50, ageDays: 10, headline: 'b' }, { score: 45, ageDays: 20, headline: 'c' }]);
  assert.equal(one.top, 60); assert.equal(one.confirmations, 0);
  assert.equal(many.top, 66); assert.equal(many.confirmations, 2);
});
