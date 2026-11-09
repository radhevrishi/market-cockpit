// zzz1231 — Conviction Beats: liquidity gate, gross profit growth, Rule of 40, ROCE trend, founder / moat, CFO/PAT 0.7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extrasOf, liquidityOf, passesLiquidity, r40Cell, roceTrendCell, gpCell, liquidityCell } from '../cb-extras';
import { parseFmAnswer, founderCell, moatCell } from '../cb-founder-moat';
import { rawFromHtml, inFiguresFromRaw, parseShareholding } from '../screener/in-assemble';
import { INDIA_PRESET } from '../quality-preset';
import { US_PRESET, usCbSavedFilters, usPresetFilters, isUsPresetActive, passesUsConvictionFilter } from '../conviction-beats-us';
import { FILTER_DEFAULT, indiaPresetFilters, isIndiaPresetActive, passesConvictionFilter } from '../conviction-filter-india';

// GNG Electronics, live figures 8 Nov 2026: promoters 71.77% (Sep 2026), market cap ₹6,658 Cr, 30-day volume 1.05M at ₹584
const GNG = { t: 'EBGNG', prom: 71.77, mc: 6658.4, px: 584.35, avgVol30: 1049031, revQYoY: 42, fcfmTTM: -13.8, gpQYoY: 180.2, roceFY: 20, roceP: 28 };

test('GNG Electronics is low float (28% free float) — the preset leaves it out', () => {
  const l = liquidityOf(GNG, 'IN');
  assert.equal(l.floatPct, 28.2);
  assert.equal(l.lowFloat, true);
  assert.equal(l.lowTurnover, false, 'it trades about ₹61 Cr a day — not low turnover');
  assert.ok(l.tradedValue! > 60 && l.tradedValue! < 62);
  assert.equal(passesLiquidity({ cbx: extrasOf(GNG, 'IN') }), false);
  assert.match(liquidityCell(extrasOf(GNG, 'IN'), 'IN').text, /LOW FLOAT/);
});

test('thin trading is low turnover; unknown figures pass', () => {
  const thin = liquidityOf({ prom: 50, mc: 800, px: 100, avgVol30: 20000 }, 'IN');   // ₹0.2 Cr a day
  assert.equal(thin.lowTurnover, true);
  assert.equal(passesLiquidity({}), true);
  assert.equal(passesLiquidity({ cbx: extrasOf({ t: 'X' }, 'IN') }), true);
  const us = liquidityOf({ flt: 85, mc: 2000, px: 40, avgVol30: 500000 }, 'US');   // $20M a day
  assert.equal(us.lowFloat || us.lowTurnover, false);
  assert.equal(liquidityOf({ flt: 18, mc: 2000, px: 40, avgVol30: 500000 }, 'US').lowFloat, true);
});

test('Rule of 40 = quarterly revenue growth YoY + FCF margin, value shown; US prefers the trailing figure', () => {
  const x = extrasOf(GNG, 'IN');
  assert.equal(x.r40, 28.2);
  assert.match(r40Cell(x).text, /^28\.2 \(\+42% \+ -13\.8%\)/);
  const u = extrasOf({ revQYoY: 30, fcfmTTM: 5, fcfmT: 15, fcfmTAt: '2026-09-30' }, 'US');
  assert.equal(u.r40, 45); assert.equal(u.fcfmBasis, 'ttm');
  assert.equal(r40Cell(u).tone, 'good');
  assert.equal(r40Cell(extrasOf({ revQYoY: 30 }, 'US')).text, '—');
});

test('ROCE trend and gross profit growth', () => {
  assert.equal(extrasOf(GNG, 'IN').roceTrend, 'contracting');
  assert.equal(extrasOf({ roceFY: 24, roceP: 18 }, 'IN').roceTrend, 'expanding');
  assert.equal(extrasOf({ roceFY: 24, roceP: 23.5 }, 'IN').roceTrend, 'stable');
  assert.match(roceTrendCell(extrasOf({ roceFY: 24, roceP: 18 }, 'IN')).text, /expanding 18→24%/);
  assert.equal(gpCell(extrasOf(GNG, 'IN')).text, '+180.2%');
  assert.equal(gpCell(extrasOf({ gpAYoY: 12 }, 'US')).text, '+12% (year)');
});

test('screener.in shareholding table and the year-before ROCE are read', () => {
  const html = readFileSync(join(__dirname, 'fixtures', 'screener-company-kmew.html'), 'utf8');
  const shp = parseShareholding(html);
  assert.equal(shp?.prom, 49.99); assert.equal(shp?.at, 'Aug 2026');
  const f = inFiguresFromRaw(rawFromHtml(html, {}));
  assert.equal(f.prom, 49.99);
  assert.equal(typeof f.roceP, 'number');
  assert.equal(parseShareholding('<html></html>'), null);
});

test('founder / moat: only schema answers are kept; a moat of NONE carries no kinds', () => {
  assert.equal(parseFmAnswer({ founder: 'MAYBE', moat: 'WIDE', confidence: 'HIGH' }), null);
  const fm = parseFmAnswer({ founder: 'FOUNDER_LED', founder_who: 'A. Kumar, founder and MD', moat: 'NONE', moat_kinds: ['brand'], moat_why: 'Commodity product.', confidence: 'MEDIUM' }, '2026-11-09')!;
  assert.deepEqual(fm.moatKinds, []);
  assert.equal(founderCell(fm).text, 'founder-led');
  assert.equal(moatCell(fm).tone, 'bad');
  assert.match(founderCell(null).title, /Not read yet/);
  const w = parseFmAnswer({ founder: 'PROFESSIONAL', founder_who: null, moat: 'WIDE', moat_kinds: ['switching costs', 'made up'], moat_why: 'x', confidence: 'HIGH' })!;
  assert.deepEqual(w.moatKinds, ['switching costs']);
});

test('preset: CFO/PAT at least 0.7 and the liquidity gate (India + USA); old US saved preset still recognised', () => {
  assert.equal(INDIA_PRESET.cfoPatMin, 0.7);
  assert.equal(US_PRESET.cfoPatMin, 0.7);
  const fi = { ...FILTER_DEFAULT, ...indiaPresetFilters(null) };
  assert.equal(isIndiaPresetActive(fi), true);
  assert.equal(isIndiaPresetActive({ ...fi, liqOk: null }), false);
  const e: any = { ticker: 'EBGNG', sales_yoy_pct: 40, eps_yoy_pct: 60, net_profit_yoy_pct: 60, cbx: extrasOf(GNG, 'IN') };
  assert.equal(passesConvictionFilter(e, { ...FILTER_DEFAULT, liqOk: true }), false);
  assert.equal(passesConvictionFilter({ ...e, cbx: extrasOf({ ...GNG, prom: 55 }, 'IN') }, { ...FILTER_DEFAULT, liqOk: true }), true);
  const fu = usPresetFilters();
  assert.equal(isUsPresetActive(fu), true);
  const old = usCbSavedFilters(JSON.stringify({ ...fu, cfoPatMin: 0.5, liqOk: undefined }));
  assert.equal(old?.cfoPatMin, 0.7);
  assert.equal(old?.liqOk, true);
  assert.equal(passesUsConvictionFilter({ ticker: 'X', cbx: extrasOf({ flt: 10, mc: 500 }, 'US') } as any, { ...fu, sales: null, eps: null, pead: null, opmDelta: null, cfoPatMin: null, opmMin: null, mktCapMin: null, verdicts: null, aboveMa50: false, aboveMa200: false, stage2: null }), false);
});
