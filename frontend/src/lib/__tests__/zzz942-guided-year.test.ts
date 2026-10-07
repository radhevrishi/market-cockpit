// zzz942 — the guided year, not the comparison base year (Kestra: "Increased FY27 revenue guidance … 48% compared to FY26" showed FY26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodOf, exFromEntry } from '../growth-guidance';

const s = 'Increased FY27 revenue guidance to $141 million, representing growth of 48% compared to FY26.';
test('a base year after "compared to" is not the guided year', () => {
  assert.equal(periodOf(s, s, new Date('2026-09-14'), 'US', false, s.indexOf('48%')).period, 'FY27');
  const only = 'Revenue growth of 30% in FY27.';
  assert.equal(periodOf(only, only, new Date('2026-09-14'), 'US', false, only.indexOf('30%')).period, 'FY27');
  const baseOnly = 'Growth of 20% over FY26 levels expected.';
  assert.equal(periodOf(baseOnly, baseOnly, new Date('2026-09-14'), 'US', false, 0).period, 'FY26', 'only a base year named: kept as before');
});
test('an entry stored with the base year is read back with the guided year', () => {
  const e: any = { metric: 'REVENUE', kind: 'MANAGEMENT_GUIDANCE', low: 48, high: 48, growthOrigin: 'STATED', absLow: null, absHigh: null, absUnit: null, period: 'FY26', periodKind: 'FY', statement: s, unit: '%', source: 'SEC filing (8-K)', sourceRank: 2, date: '2026-09-14', sourceUrl: null, docId: 'd', key: 'k' };
  assert.equal(exFromEntry(e, 'US', 'KMTS').point.period, 'FY27');
});
