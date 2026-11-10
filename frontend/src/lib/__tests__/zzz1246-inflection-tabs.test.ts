// zzz1246 — the India and USA radar tabs showed the same industries with the same headlines. News is now placed per tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRIES, geoOf, industriesOf, industryOnTab, newsFitsTab, isCompanyResultsHeadline } from '../inflection/core';

const ind = (id: string) => INDUSTRIES.find((i) => i.id === id)!;
const fits = (id: string, market: 'IN' | 'US', h: string) => newsFitsTab(ind(id), market, geoOf(h));

test('Indian news stays off the USA tab, US news off the India tab', () => {
  const jwl = 'Jupiter Wagons Secures Orders Worth Over ₹324 Crore from GATX India and Chetak International - Machine Maker';
  assert.ok(industriesOf(jwl).includes('rail'));
  assert.ok(fits('rail', 'IN', jwl));
  assert.ok(!fits('rail', 'US', jwl));
  const mahindra = 'Mahindra Aerospace flags talent shortage as India scales up aircraft manufacturing - ETHRWorld.com';
  assert.ok(!fits('aerospace', 'US', mahindra));
  const railcar = 'Greenbrier reports railcar orders backlog rises in North America';
  assert.ok(fits('rail', 'US', railcar) && !fits('rail', 'IN', railcar));
});

test('global news counts on both tabs; US truck builds also count for Indian forgers', () => {
  const tsmc = "TSMC reportedly weighs 20% CoWoS price increase as packaging capacity is tight — Tom's Hardware";
  assert.ok(fits('semis-packaging', 'IN', tsmc) && fits('semis-packaging', 'US', tsmc));
  const trucks = 'US trailer orders soar 385% as Class 8 truck market sends mixed signals - FreightWaves';
  assert.ok(fits('class8-trucks', 'IN', trucks) && fits('class8-trucks', 'US', trucks));
});

test('each tab has industries of its own', () => {
  const inIds = INDUSTRIES.filter((i) => industryOnTab(i, 'IN')).map((i) => i.id);
  const usIds = INDUSTRIES.filter((i) => industryOnTab(i, 'US')).map((i) => i.id);
  for (const id of ['defence-europe', 'defence-india', 'ems-india']) assert.ok(inIds.includes(id) && !usIds.includes(id), id);
  for (const id of ['dc-power-us', 'nuclear-us', 'defence-us', 'optical-us']) assert.ok(usIds.includes(id) && !inIds.includes(id), id);
  assert.ok(industriesOf('Centrus wins HALEU enrichment capacity contract from Department of Energy').includes('nuclear-us'));
  assert.ok(!industriesOf('Iran says uranium enrichment will continue').includes('nuclear-us'));
  assert.ok(industriesOf('Defence Acquisition Council approves procurement worth ₹67,000 crore').includes('defence-india'));
  const nato = 'NATO Faces Critical Ammunition Crisis as Cotton Linter Shortage Empties Propellant Stocks';
  assert.ok(fits('defence-europe', 'IN', nato));
});

test('company results headline stays out', () => {
  assert.ok(isCompanyResultsHeadline('RBC Bearings Q2 2027: Earnings Beat, $2.4B Backlog, and Stronger Half Ahead - 24/7 Wall St.'));
});
