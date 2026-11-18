import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeOf, trimDanglingHeadline, bestHeadline, isJunkText, marginDeltaOf, inflectionOf } from '../transformational/core';
import { turnaroundOf } from '../turnaround/core';

test('zzz1276 themes: catch-all Nasdaq industries let the filing decide; Finance: buckets are financials', () => {
  assert.equal(themeOf(['Establishment Labs breast implants FDA approval of Motiva implants'], 'Industrial Specialties', 'Establishment Labs').theme, 'Pharma CDMO / API / healthcare');
  assert.equal(themeOf(['Perella Weinberg revenue'], 'Finance: Consumer Services', 'Perella Weinberg Partners').theme, 'Financials / lending');
  assert.equal(themeOf(['Sezzle results'], 'Finance: Consumer Services', 'Sezzle Inc.').theme, 'Financials / lending');
  assert.equal(themeOf(['revenue grew'], 'Industrial Specialties', 'X Corp').theme, 'Capital goods / industrial machinery');   // no theme word in the text: bucket stays
  assert.equal(themeOf([''], 'Ophthalmic Goods', 'Y').theme, 'Pharma CDMO / API / healthcare');
  assert.equal(themeOf([''], 'Ordnance And Accessories', 'Y').theme, 'Defence & aerospace');
  assert.equal(themeOf([''], 'Railroads', 'Y').theme, 'Railways & metro');
  assert.equal(themeOf([''], 'Telecommunications Equipment', 'Y').theme, 'Telecom / networking');
  assert.equal(themeOf([''], 'Precious Metals', 'Y').theme, 'Metals & mining');
  assert.equal(themeOf([''], 'Electric Utilities: Central', 'Y').theme, 'Power utilities & distribution');
  assert.equal(themeOf([''], 'Investment Managers', 'Y').theme, 'Financials / lending');
});

test('zzz1276 headlines: cut-off figures trimmed back to the whole phrase; page furniture is junk', () => {
  assert.equal(trimDanglingHeadline('HawkEye 360 Announces Third Quarter 2026 Financial Results Revenue of $59.3'), 'HawkEye 360 Announces Third Quarter 2026 Financial Results');
  assert.equal(trimDanglingHeadline('Delcath Systems Reports Third Quarter 2026 Results and Business Highlights Increases 2026 Revenue Guidance to a Range of $115'),
    'Delcath Systems Reports Third Quarter 2026 Results and Business Highlights Increases 2026 Revenue Guidance');
  assert.equal(trimDanglingHeadline('Ouster Announces Results for Third Quarter 2026'), 'Ouster Announces Results for Third Quarter 2026');
  assert.equal(trimDanglingHeadline('Enovis Announces Third Quarter 2026 Results •'), 'Enovis Announces Third Quarter 2026 Results');
  for (const j of ['Vericel Corporation 25 Blue Sky Drive Burlington, MA 01803 T 617 588-5555 F 617 588-5554', 'NEWS RELEASE For Immediate Release',
    'News Release Financial News Brief', 'Investor Contact: Media Contact: Garen Sarafian Alexis', 'Earnings Release of Terex Corporation Dated October 28, 2026'])
    assert.ok(isJunkText(j), j);
  // a figure line (what changed) is never trimmed
  const h = bestHeadline({ headline: 'NEWS RELEASE For Immediate Release', whatChanged: 'Revenue $1.5B (+127%) · Diluted EPS $6.92 vs $2.97', quote: null, signals: [] });
  assert.equal(h, 'Revenue $1.5B (+127%) · Diluted EPS $6.92 vs $2.97');
});

test('zzz1276 margin on a tiny / loss-making base is not a margin move', () => {
  assert.equal(marginDeltaOf({ marginNow: 0, marginPrior: -400 }), null);
  assert.equal(marginDeltaOf({ marginNow: 21.4, marginPrior: -4 }), 25.4);
  assert.equal(inflectionOf({ revenueYoY: 1.8, patYoY: null, marginNow: 2, marginPrior: -100, cfoToPat: null, guidance: null }), null);
});

test('zzz1276 a US company scaling 40%+ into profit is not a turnaround; a slow grower reviving still is', () => {
  const ids = ['turned_profitable'];
  assert.equal(turnaroundOf({ market: 'US', texts: ['Hinge Health swung to a profit'], ids, facts: { revenueYoY: 52, patYoY: null, marginNow: 21, marginPrior: -4 } }), null);
  assert.equal(turnaroundOf({ market: 'US', texts: ['returned to profit'], ids, facts: { revenueYoY: 25, patYoY: null, marginNow: 6, marginPrior: -2 } })?.archetype, 'OPERATING_REVIVAL');
  assert.equal(turnaroundOf({ market: 'IN', texts: ['returned to profit'], ids, facts: { revenueYoY: 55, patYoY: null, marginNow: 6, marginPrior: -2 } })?.archetype, 'OPERATING_REVIVAL');
});

test('zzz1276 one company keeps one theme when the text named it on one event', async () => {
  const { unifyCompanyThemes } = await import('../transformational/core');
  const base: any = { market: 'US', ticker: 'ESTA', industry: 'Industrial Specialties' };
  const out = unifyCompanyThemes([{ ...base, id: 'a', theme: 'Capital goods / industrial machinery', themeWhy: "the company's industry: Industrial Specialties" },
    { ...base, id: 'b', theme: 'Pharma CDMO / API / healthcare', themeWhy: 'the filing says "FDA" (industry "Industrial Specialties" is a catch-all)' }]);
  assert.deepEqual(out.map((x: any) => x.theme), ['Pharma CDMO / API / healthcare', 'Pharma CDMO / API / healthcare']);
  assert.equal(themeOf([''], 'Radio And Television Broadcasting And Communications Equipment', 'BlackSky').theme, 'Telecom / networking');
});
