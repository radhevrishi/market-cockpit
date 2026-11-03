// zzz1227 — Turnaround → Compounder read (owner's monograph, 3 Nov 2026). Additive to AI Daily Gainers and Transformational Gainers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { turnaroundOf, turnaroundFromGainer, turnaroundFromTg } from '../turnaround/core';

test('01 TBZ: control transfer closed = ownership rescue, stage 2, research — not yet operating proof', () => {
  const t = turnaroundOf({ texts: ['Change in control: transfer of 4,94,59,775 shares to GRT Jewellers completed; board reconstituted.'] });
  assert.equal(t?.archetype, 'OWNERSHIP_RESCUE');
  assert.equal(t?.stage, 2);
  assert.equal(t?.decision, 'RESEARCH');
  assert.match(String(t?.nextProof), /first full quarter under the new owner/);
});

test('02 CG Power, Aug 2020: a proposed control deal with warrants = stage 1, dilution to re-work', () => {
  const t = turnaroundOf({ texts: ['Board approved a proposal from Tube Investments for change in control; subject to lender approval; equity shares and warrants of about ₹700 crore.'] });
  assert.equal(t?.archetype, 'OWNERSHIP_RESCUE');
  assert.equal(t?.stage, 1);
  assert.equal(t?.gates.dilution, 'OPEN');
  assert.equal(t?.decision, 'MONITOR');
});

test('03 Timex: a licence LOI is a brand catalyst; the earnings rule catches the operating revival without any event', () => {
  const lic = turnaroundOf({ texts: ['Letter of intent for manufacturing and distribution rights for Guess and Gc watches in India.'] });
  assert.equal(lic?.archetype, 'BRAND_LICENSE');
  assert.equal(lic?.stage, 1);
  const rev = turnaroundOf({ texts: ['Results for the quarter'], facts: { revenueYoY: 45, marginNow: 9, marginPrior: 3, cfoToPat: 1.1 } });
  assert.equal(rev?.archetype, 'OPERATING_REVIVAL');
  assert.equal(rev?.stage, 3);
  // an ordinary good quarter from an already healthy margin is NOT a turnaround
  assert.equal(turnaroundOf({ texts: ['Results for the quarter'], facts: { revenueYoY: 30, marginNow: 21, marginPrior: 18 } }), null);
});

test('04 hard gates override everything; pledge and loss are flagged', () => {
  const stop = turnaroundOf({ texts: ['Turned profitable this quarter.', 'Resignation of the statutory auditor citing non-availability of information.'] });
  assert.equal(stop?.decision, 'HARD_STOP');
  assert.ok(stop?.hardStops.includes('Auditor resigned'));
  const rba = turnaroundOf({ texts: ['Standalone India PAT ₹15.6 Cr, first profitable quarter.', '40% of promoter holdings encumbered.'] });
  assert.equal(rba?.gates.governance, 'OPEN');
  const vip = turnaroundOf({ texts: ['Strategic investor Multiples took control; net loss of ₹338 crore for the year.'] });
  assert.equal(vip?.gates.survive, 'OPEN');
});

test('05 not a turnaround: a SAST stake disclosure, the company buying a stake elsewhere, a plain order', () => {
  assert.equal(turnaroundOf({ texts: ['Disclosure under SAST Regulation 29(2): acquirer purchased 0.5% of shares.'] }), null);
  assert.equal(turnaroundOf({ texts: ['The company acquired a 60% stake in XYZ Pvt Ltd.'] }), null);
  assert.equal(turnaroundOf({ texts: ['Received an order worth ₹120 crore from NTPC.'] }), null);
});

test('06 Zudio-type format roll-out; funding repair needs a repair word, not just a rights issue', () => {
  assert.equal(turnaroundOf({ texts: ['The chain crossed its 1,000th store in Q2 with same-store sales growth of 9%.'] })?.archetype, 'FORMAT_SCALING');
  assert.equal(turnaroundOf({ texts: ['One-time settlement with lenders completed; rating upgraded to BBB.'] })?.archetype, 'FUNDING_REPAIR');
  assert.equal(turnaroundOf({ texts: ['Board approved a rights issue of ₹900 crore.'] }), null);
});

test('07 adapters: gainers card catalysts (ids incl. negative ones) and stored Transformational rows', () => {
  const g = turnaroundFromGainer({ market: 'IN', headline: 'Open offer triggered', inCard: { catalysts: [{ id: 'open_offer', label: 'Open offer (SAST)', sentence: 'GRT Jewellers to acquire 74.12% via share purchase agreement; open offer made.' }, { id: 'pledge', label: 'Promoter pledge change', sentence: 'pledge created' }] } });
  assert.equal(g?.archetype, 'OWNERSHIP_RESCUE');
  assert.equal(g?.gates.governance, 'OPEN');
  const tg = turnaroundFromTg({ kind: 'TURNAROUND', headline: 'Swung to profit', signals: ['Turnaround to profit'], facts: { revenueYoY: 24 } });
  assert.equal(tg?.archetype, 'OPERATING_REVIVAL');
  assert.equal(tg?.stage, 3);
});

test('08 additive wiring: badge on the gainers card after the existing badge; filter + chip on the board', () => {
  const card = readFileSync(new URL('../../components/ai-gainers/ResearchCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /<TgCardBadge it=\{it\} \/>\s*\{\/\* zzz1227[^]*?<TurnaroundBadge ta=/);
  const page = readFileSync(new URL('../../app/(dashboard)/transformational-gainers/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /🔄 Turnarounds/);
  assert.match(page, /\(!turnOnly \|\| taById\.has\(x\.id\)\)/);
});
