import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plausibleUsdInr, FX_FALLBACK } from '../fx';
import { passesConvictionFilter, FILTER_DEFAULT, indiaPresetFilters, CB_SMALL_MID_MAX_CR } from '../conviction-filter-india';

test('a USD/INR rate must be plausible', () => {
  assert.equal(plausibleUsdInr(88.4), true); assert.equal(plausibleUsdInr(0.0113), false); assert.equal(plausibleUsdInr(NaN), false);
  assert.equal(FX_FALLBACK, 85);
});
test('zzz1068: the Conviction preset has no size ceiling; a ceiling set by hand still works and keeps an unknown size', () => {
  assert.equal(indiaPresetFilters(null).mktCapMax, null);
  assert.equal(passesConvictionFilter({ ticker: 'BIG', market_cap_cr: 45_000 } as any, { ...FILTER_DEFAULT, mktCapMax: indiaPresetFilters(null).mktCapMax }), true);
  const f = { ...FILTER_DEFAULT, mktCapMax: CB_SMALL_MID_MAX_CR };
  assert.equal(CB_SMALL_MID_MAX_CR, 30_000);
  assert.equal(passesConvictionFilter({ ticker: 'BIG', market_cap_cr: 45_000 } as any, f), false);
  assert.equal(passesConvictionFilter({ ticker: 'MID', market_cap_cr: 12_000 } as any, f), true);
  assert.equal(passesConvictionFilter({ ticker: 'NA' } as any, f), true);
});
