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

import { baseNote } from '../company-lab/quarterly';
test('zzz1300 — growth trend says when a big quarter sat on a weak base, and shows the last 3 quarters', () => {
  const rv = [113, 87, 101, 120, 137, 132, 132, 137], y = [0, -17.9, -7.3, 13.2, 21.2, 51.7, 30.7, 14.2];
  const pts: any[] = rv.map((v, i) => ({ e: '', label: `Q${i}`, rev: v, revYoY: y[i], gm: null, om: null }));
  const t = baseNote(pts);
  assert.match(t, /Q5 \+51\.7% came after Q1 fell 17\.9% \(weak base\)/);
  assert.match(t, /132 → 132 → 137 \(about flat\)/);
});
