// zzz1037 — owner asked what "×4 76.22" means: tags now say it — R / S (resistance above / support below the price), the price and
// the number of touches; trendlines "S line · 3 touches"; merged nearby levels "R 130.00–131.40 · 5/4/3 touches".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelTagText, lineTagText } from '../../components/charts/auto-lines-kline';

test('level and line tags explain themselves', () => {
  assert.equal(levelTagText('R', '76.22', 4, false), 'R 76.22 · 4 touches');
  assert.equal(levelTagText('S', '65.81', 6, true), 'S 65.81 · 6 touches · provisional');
  assert.equal(lineTagText('support', 3, false), 'S line · 3 touches');
  assert.equal(lineTagText('resistance', 4, false), 'R line · 4 touches');
});
