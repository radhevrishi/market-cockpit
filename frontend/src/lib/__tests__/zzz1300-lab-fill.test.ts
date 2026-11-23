import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dilution } from '../company-lab/quarterly';

test('zzz1300 — a share-count estimate that falls is worded "fell", never "jumped -67%"', () => {
  const rows: any[] = [
    { label: 'Mar 2023', revenue: 100, netIncome: 30, eps: 1, sharesEst: 30 },
    { label: 'Mar 2024', revenue: 110, netIncome: 30, eps: 2, sharesEst: 15 },
    { label: 'Mar 2025', revenue: 120, netIncome: 30, eps: 3, sharesEst: 10 },
  ];
  const d = dilution(rows);
  assert.match(d.text, /fell 66\.7%/);
  assert.doesNotMatch(d.text, /jumped -/);
});
