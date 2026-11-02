// zzz1204 — India EO: inside a tier the best names lead (stage, RS, cash, margin, size, caveats); the other-day list is at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bestFirst, bestRankScore } from '../india-earnings-window';

const row = (t: string, o: any) => ({ ticker: t, composite_score: 80, filing_date: '2026-10-30', caveat_tags: [], ...o });
test('a large-cap in a downtrend falls below clean small/mid names of the same tier', () => {
  const rows = [
    row('VEDL', { stage: 4, rs_rating: 14, market_cap_cr: 93028, cfo_to_pat_ratio: 1.57, opm_pct: 38, opm_prev_pct: 29 }),
    row('AEROFLEX', { stage: 2, rs_rating: 97, market_cap_cr: 7098, cfo_to_pat_ratio: 1.18, opm_pct: 24, opm_prev_pct: 23 }),
    row('UNIMECH', { stage: 2, rs_rating: 95, market_cap_cr: 8039, cfo_to_pat_ratio: 0.97, caveat_tags: ['profit leaked below the operating line'] }),
  ];
  assert.deepEqual(rows.sort(bestFirst).map((r) => r.ticker), ['AEROFLEX', 'UNIMECH', 'VEDL']);
});
test('lenders are not marked down for negative operating cash', () => {
  assert.equal(bestRankScore(row('BANK', { sector: 'Banks', cfo_to_pat_ratio: -3 })), bestRankScore(row('BANK', { sector: 'Banks' })));
});
