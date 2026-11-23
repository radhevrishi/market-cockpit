// zzz1291 — Company Lab: share-count scale repair, capex gaps, business breaks, Rule of 40, growth trend, cash squeeze,
// dilution, CFO/PAT, D/E and the "cash up, price flat" lead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { repairShares, capexGapFcf, businessBreak } from '../company-lab/annual';
import { quarterReport, squeeze, dilution, cfoPat, deOf, fcfPriceGap, type QIn } from '../company-lab/quarterly';
import type { AnnualRow } from '../company-lab/core';

const row = (y: number, o: Partial<AnnualRow> = {}): AnnualRow => ({ end: `${y}-12-31`, label: `FY${y}`, revenue: 100, netIncome: 10, eps: 1, cfo: 12, capex: -2, fcf: 10, debt: 20, shares: 10, sbc: null, ...o });

test('shares tagged in thousands are rescaled; nonsense dropped', () => {
  const m = new Map([['2021', 30e6], ['2022', 30e3], ['2023', 31e6], ['2024', 5]]);
  const r = repairShares(m);
  assert.equal(r.get('2022'), 30e6); assert.equal(r.get('2021'), 30e6); assert.equal(r.has('2024'), false);
});
test('capex stops being tagged on a tiny-capex company → FCF ≈ CFO, marked; otherwise unknown', () => {
  const rows = [row(2018, { capex: -0.5 }), row(2019, { capex: -0.4 }), row(2020, { capex: null, fcf: 12 }), row(2021, { capex: null, fcf: 12 })];
  const r = capexGapFcf(rows);
  assert.equal(r[2].fcfApprox, true); assert.equal(r[2].fcf, 12);
  const big = capexGapFcf([row(2018, { capex: -20 }), row(2019, { capex: -20 }), row(2020, { capex: null, fcf: 12 })]);
  assert.equal(big[2].fcf, null);
});
test('a business sold off (revenue −99%) cuts the earlier years', () => {
  const rows = [row(2019, { revenue: 3000 }), row(2020, { revenue: 4800 }), row(2021, { revenue: 13 }), row(2022, { revenue: 120 }), row(2023, { revenue: 500 })];
  const b = businessBreak(rows);
  assert.equal(b.rows[0].label, 'FY2021'); assert.match(b.note!, /different company/);
  assert.equal(businessBreak([row(2019, { revenue: 100 }), row(2020, { revenue: 10 }), row(2021, { revenue: 90 })]).rows.length, 3);
});
const q = (e: string, v: number) => ({ s: new Date(Date.parse(e) - 90 * 86_400_000).toISOString().slice(0, 10), e, v, d: 0 as const });
test('Rule of 40 = latest quarter revenue YoY + FCF margin; acceleration read', () => {
  const ends = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'];
  const rev = ends.map((e, i) => q(e, i < 4 ? 100 : [110, 115, 125, 140][i - 4]));
  const input: QIn = { basis: 'quarterly', rev, gp: rev.map((x) => q(x.e, x.v * 0.5)), op: rev.map((x) => q(x.e, x.v * 0.1)), cfo: rev.map((x) => q(x.e, x.v * 0.3)), capex: rev.map((x) => q(x.e, x.v * 0.1)), cash: new Map(), debt: new Map(), recv: new Map() };
  const r = quarterReport(input, []);
  assert.equal(r.r40.revYoY, 40); assert.equal(r.r40.fcfMargin, 20); assert.equal(r.r40.value, 60);
  assert.equal(r.accel.state, 'accelerating'); assert.equal(r.gm.now, 50);
});
test('cash squeeze: capex surge + FCF worse + cash falling = High with the key combo; few known = Unknown', () => {
  const ends = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'];
  const cfo = ends.map((e, i) => q(e, i < 4 ? 30 : 25)), capex = ends.map((e, i) => q(e, i < 4 ? 10 : 40));
  const s = squeeze({ basis: 'quarterly', rev: ends.map((e) => q(e, 100)), gp: [], op: [], cfo, capex, cash: new Map([['2024-12-31', 500], ['2025-12-31', 200]]), debt: new Map([['2024-12-31', 100], ['2025-12-31', 200]]), recv: new Map() });
  assert.equal(s.keyCombo, true); assert.equal(s.level, 'High'); assert.ok(s.ratios.runwayQ! > 0);
  assert.equal(squeeze({ basis: 'quarterly', rev: [], gp: [], op: [], cfo: [], capex: [], cash: new Map(), debt: new Map(), recv: new Map() }).level, 'Unknown');
});
test('dilution, CFO/PAT, debt ÷ equity', () => {
  const rows = [row(2021, { shares: 100 }), row(2022, { shares: 105 }), row(2023, { shares: 110 }), row(2024, { shares: 121, equity: 40, debt: 20 })];
  assert.equal(dilution(rows).pct, 21); assert.match(dilution(rows).text, /diluting/);
  assert.equal(cfoPat(rows).latest, 1.2);
  assert.equal(deOf(rows).value, 0.5);
  assert.equal(deOf([row(2024, { equity: -5 })]).value, null);
});
test('cash up, price flat lead', () => {
  const ys = [{ label: 'FY2022', fcfPs: 1, priceAtEnd: 50 }, { label: 'FY2023', fcfPs: 1.3 , priceAtEnd: 48 }, { label: 'FY2024', fcfPs: 1.6, priceAtEnd: 52 }];
  assert.equal(fcfPriceGap(ys, 53).flag, true);
  assert.equal(fcfPriceGap(ys, 80).flag, false);
});
