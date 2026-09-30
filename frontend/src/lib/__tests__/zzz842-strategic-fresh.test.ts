// zzz842 — Transformational Contracts: tender notices are not contracts; real awards qualify.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStrategicVisibility as c } from '../news/strategic-visibility';

const q = (title: string, desc = '') => c({ title, desc });

describe('tender / bid notices never qualify', () => {
  for (const t of [
    'NTPC REL floats tender for 500 MW solar project worth Rs 4,000 crore',
    'PGCIL invites bids for HVDC transmission project worth Rs 9,000 crore',
    'State utility issues RFP for 1 GW BESS project, $1.2 billion',
    'XYZ emerges as L1 bidder for Rs 2,500 crore transmission line order',
  ]) test(t, () => assert.equal(q(t).qualifies, false));
});

describe('signed / approved awards qualify', () => {
  test('OPG nuclear refurbishment contract', () => {
    const r = q('OPG signs $1.7B contract for Pickering nuclear refurbishment');
    assert.equal(r.qualifies, true);
    assert.equal(r.contract_value_usd_m, 1700);
  });
  test('tender that reports an award still passes the exclusion', () => {
    const r = q('PGCIL floated tender; XYZ awarded Rs 9,000 crore HVDC transmission project by Power Grid');
    assert.equal(r.qualifies, true);
  });
  test('cabinet-approved national corridor with stated value', () => {
    const r = q('Union Cabinet approves Green Energy Corridor-III transmission programme at Rs 1.86 lakh crore');
    assert.equal(r.qualifies, true);
  });
  test('no stated value → never invents one', () => {
    const r = q('OPG signs contract for nuclear refurbishment');
    assert.equal(r.qualifies, false);
    assert.equal(r.contract_value_usd_m, undefined);
  });
});
