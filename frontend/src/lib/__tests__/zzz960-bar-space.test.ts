import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBarSpace, MAX_FIT_BAR_SPACE } from '../chart-view-prefs';

test('zzz960 bar spacing: wide screen + 3M stays at TradingView spacing, shows more history', () => {
  const wide = fitBarSpace(1600, 63, '3M');
  assert.equal(wide.space, MAX_FIT_BAR_SPACE);
  assert.ok(wide.pad >= 4 && wide.pad <= 12);
  const narrow = fitBarSpace(700, 63, '3M');
  assert.ok(narrow.space < MAX_FIT_BAR_SPACE);           // a narrow chart still fits 3 months exactly
  assert.ok(fitBarSpace(1600, 21, '1M').space > MAX_FIT_BAR_SPACE);  // 1M still fills the screen
  assert.ok(fitBarSpace(1600, 250, '1Y').space < 8);
});
