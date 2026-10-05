// zzz879 — India Conviction Beats: preset size floor; browser list checked against the server list.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { indiaPresetFilters, isIndiaPresetActive, parseCbCapFloor, cbCapFloorRaw, FILTER_DEFAULT, passesConvictionFilter } from '../conviction-filter-india';
import { cbServerReconcile, cbIsRemoved, tierNowLabel, presetBarText } from '../india-cb-view';

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('zzz879 — preset size floor', () => {
  test('three floors, all count as the preset', () => {
    for (const v of [3000, 500, null] as const) assert.equal(isIndiaPresetActive({ ...FILTER_DEFAULT, ...indiaPresetFilters(v) } as any), true, String(v));
    assert.equal(isIndiaPresetActive({ ...FILTER_DEFAULT, ...indiaPresetFilters(), mktCapMin: 1000 } as any), false);
    assert.equal(indiaPresetFilters().mktCapMin, 3000, 'server / nothing saved → ₹3k Cr');
  });
  test('saved value round-trips', () => {
    assert.equal(parseCbCapFloor('500'), 500); assert.equal(parseCbCapFloor('none'), null); assert.equal(parseCbCapFloor(null), 3000); assert.equal(parseCbCapFloor('junk'), 3000);
    assert.equal(cbCapFloorRaw(null), 'none'); assert.equal(cbCapFloorRaw(500), '500');
  });
  test('HIIL (≈₹1,140 Cr) passes at ₹500 Cr, not at ₹3k Cr; the bar text says which', () => {
    const hiil: any = { ticker: 'HIIL', tier: 'STRONG', market_cap_cr: 1140 };
    assert.equal(passesConvictionFilter(hiil, { ...FILTER_DEFAULT, mktCapMin: 500 } as any), true);
    assert.equal(passesConvictionFilter(hiil, { ...FILTER_DEFAULT, mktCapMin: 3000 } as any), false);
    assert.match(presetBarText(500), /market cap ≥₹500 Cr/); assert.match(presetBarText(), /≥₹3k Cr/); assert.match(presetBarText(null), /any market cap/);
  });
});

describe('zzz879 — browser bench vs server bench', () => {
  test('a recent name the server does not list is greyed; a listed one is cleared; fresh and old names are not judged', () => {
    const local = [
      { ticker: 'STEAMHOUSE', filing_date: day(5) },
      { ticker: 'HIIL', filing_date: day(3) },
      { ticker: 'NEWONE', filing_date: day(0) },
      { ticker: 'OLDONE', filing_date: day(80) },
      { ticker: 'BACK', filing_date: day(10), _not_on_server: true },
      { ticker: 'X@Q1-2026', filing_date: day(10) },
    ];
    const p = cbServerReconcile(local, ['HIIL', 'back']);
    assert.deepEqual(p, [{ ticker: 'STEAMHOUSE', patch: { _not_on_server: true } }, { ticker: 'BACK', patch: { _not_on_server: null } }]);
    assert.deepEqual(cbServerReconcile([{ ticker: 'STEAMHOUSE', filing_date: day(5), _not_on_server: true }], ['HIIL']), [], 'already greyed: no write');
  });
  test('the greyed card says why', () => {
    assert.equal(cbIsRemoved({ _not_on_server: true }), true);
    assert.match(tierNowLabel({ _not_on_server: true })!, /no longer on the results list/);
    assert.equal(tierNowLabel({ _tier_now: 'MIXED' }), 'now MIXED under current rules');
  });
});
