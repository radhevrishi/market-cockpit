// zzz1224 — Transformation Radar rebuilt around real business transformations.
// A benchmark of the owner's named cases (from the live radar, 3 Nov 2026) and the negative controls he listed. Every
// sentence below is the kind of line the radar reads from a filing; the expected state is the owner's own judgement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyTransformation, changeLinesOf, shareShift, capacityStep, entityOf, contradictionOf, type ResearchState } from '../radar-transformation';
import { radarInsight } from '../radar-insight';

const NOW = new Date('2026-11-03T12:00:00Z');
const T = (quote: string, f: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  classifyTransformation({ evidence_quote: quote, quote_role: 'MANAGEMENT', filing_datetime: '2026-10-25T00:00:00Z', ...extra }, f, NOW);

// ── the owner's named cases ──
const CASES: Array<{ name: string; quote: string; facts?: Record<string, unknown>; extra?: Record<string, unknown>; want: ResearchState; shortlist: boolean }> = [
  { name: 'BEPL — 20 new products / colour grades = product development', quote: 'Commercialization: Successfully transitioned 20 new/improved products (including 18 color grades) from R&D to commercial production.', want: 'ROUTINE', shortlist: false },
  { name: 'KANOHAR — high-voltage share 53% → 78% = mix shift', quote: 'The share of high-voltage products in our revenue increased from 53% to 78% over the year.', facts: { salesCr: 400, resultsVerdict: 'STRONGER_LATEST' }, want: 'EARNINGS_POWER', shortlist: true },
  { name: 'KROSS — extruded axle beam production commenced; scale unknown', quote: 'Commercial vehicles -- commercial production of our extruded axle beam has commenced and the capacity utilization of this is approximately 80% of our current output.', want: 'COMMERCIAL', shortlist: true },
  { name: 'BALAMINES — ACN capacity 1,440 TPM; capacity is not profit', quote: 'During the period, commercial production commenced at the expanded Acetonitrile (ACN) facility, increasing installed capacity to 1,440 TPM.', want: 'ROUTINE', shortlist: false },
  { name: 'TINNARUBR — one plant turned around; consolidated size unknown', quote: 'Internationally, our Oman plant ran at 90% utilization in H1 and its EBITDA margins improved to 11.5% from only 6.4% in FY26.', want: 'EMERGING', shortlist: true },
  { name: 'PARACABLES — HTLS order ≈ 9% of sales, capacity only planned', quote: 'We have already secured an HTLS order book of INR 200 crores plus as on date and the capacity augmentation for specialized conductors is planned at our new plant at Narmadapuram.', facts: { salesCr: 2126 }, want: 'ROUTINE', shortlist: false },
  { name: 'ADVAIT — ₹116 Cr order credited to "NRE" (entity unclear)', quote: 'NRE order win: NREwon a 116 crore solar EPC order for a 200 MW project from KPI Green Energy, strengtheningitsrenewableexecutionpipeline.', facts: { salesCr: 830 }, extra: { symbol: 'ADVAIT', company_name: 'Advait Energy Transitions Ltd' }, want: 'EMERGING', shortlist: true },
  { name: 'CONCORDBIO — capability ("enabling scale-up"), not commercialisation', quote: 'Advanced fermenters and pilot plant facilities for seamless scale-up from lab to commercial production.', want: 'INSUFFICIENT', shortlist: false },
  { name: 'BLS — segment margins up, consolidated margin moderated', quote: 'While EBITDA Margins expanded across both business segments, a shift in the segment mix resulted in a slight moderation in the consolidated EBITDA margin to 25%.', want: 'ROUTINE', shortlist: false },
  { name: 'NETWEB — total order book, not a new order', quote: 'The relatively higher inventory levels are intentional and reflect our preparation for executing the order book of approximately INR2,629 crores as of September 26.', facts: { salesCr: 1100 }, want: 'ROUTINE', shortlist: false },
  { name: 'POLYCAB — margin up on mix and efficiency = operational', quote: 'EBITDA increased by 39% year-on-year, while EBITDA margins expanded by more than 50 basis points sequentially to 14.4%, supported by a favourable business mix and continued focus on operational efficiencies.', want: 'ROUTINE', shortlist: false },
  { name: 'BETA — first purchase order from a hospital chain', quote: 'As discussed, we have got successfully our first purchase order from the Tata Hospitals.', want: 'EMERGING', shortlist: true },
  { name: 'PACEDIGITK — orders "before IPO" are old', quote: '3,250 Cr of BESS orders secured before IPO.', facts: { salesCr: 2818 }, extra: { quote_role: 'COMPANY' }, want: 'ROUTINE', shortlist: false },
];
// ── negative controls (the owner's list) and early, pre-earnings positives ──
const CONTROLS: typeof CASES = [
  { name: 'old milestones in a new deck', quote: 'Over the last 10 years we commissioned 5 plants and won orders worth ₹2,000 crore.', facts: { salesCr: 500 }, want: 'INSUFFICIENT', shortlist: false },
  { name: 'guidance without execution', quote: 'We expect revenue to double by FY28 as the new plant ramps up.', want: 'INSUFFICIENT', shortlist: false },
  { name: 'commodity spread margin', quote: 'EBITDA margin improved to 18% on the back of lower raw material prices and better realisations.', want: 'ROUTINE', shortlist: false },
  { name: 'low base', quote: 'Revenue grew 180% on a low base as the previous year was hit by the plant shutdown.', want: 'ROUTINE', shortlist: false },
  { name: 'generic optimism', quote: 'We are very optimistic about the strong opportunities ahead in all our businesses.', want: 'INSUFFICIENT', shortlist: false },
  { name: 'capacity without utilisation', quote: 'We added 20,000 TPA of capacity during the quarter.', want: 'ROUTINE', shortlist: false },
  { name: 'acquisition-driven growth', quote: 'Revenue grew 60% driven by the acquisition of XYZ Ltd which was consolidated from this quarter.', want: 'ROUTINE', shortlist: false },
  { name: 'accounting gain', quote: 'Profit includes an exceptional gain of ₹45 crore on sale of land.', want: 'ROUTINE', shortlist: false },
  { name: 'label change', quote: 'We have renamed our specialty segment as the Advanced Materials division.', want: 'ROUTINE', shortlist: false },
  { name: 'chart fragment', quote: 'Revenue 120 150 180 210 240 270 300 330 EBITDA 20 25 30', want: 'INSUFFICIENT', shortlist: false },
  { name: 'single small order', quote: 'We received an order worth ₹40 crore from a state utility for transformers.', facts: { salesCr: 1000 }, want: 'ROUTINE', shortlist: false },
  { name: 'order not yet revenue (large) = commercial, never earnings-power', quote: 'We received an order worth ₹600 crore from NTPC for supply of transformers.', facts: { salesCr: 1000, resultsVerdict: 'GROWING' }, want: 'COMMERCIAL', shortlist: true },
  { name: 'early: regulated-market approval', quote: 'We received USFDA approval for our Visakhapatnam API facility, our first regulated-market approval.', want: 'EMERGING', shortlist: true },
  { name: 'early: capacity step of 2.5×', quote: 'Installed capacity increased from 40,000 TPA to 100,000 TPA with commissioning of the new plant.', want: 'EMERGING', shortlist: true },
  { name: 'early: qualified by new customers', quote: 'Our new line was qualified by two global innovator customers this quarter.', want: 'EMERGING', shortlist: true },
  { name: 'analyst said it', quote: 'Your high-voltage share has gone from 53% to 78%, is that sustainable?', extra: { quote_role: 'ANALYST' }, want: 'INSUFFICIENT', shortlist: false },
];

test('01 owner-named cases from the live radar', () => {
  for (const c of CASES) {
    const t = T(c.quote, c.facts, c.extra);
    assert.equal(t.state, c.want, `${c.name}: ${t.state} — ${t.stateReason}`);
    assert.equal(t.shortlist, c.shortlist, c.name);
  }
});

test('02 negative controls and early positives', () => {
  for (const c of CONTROLS) {
    const t = T(c.quote, c.facts, c.extra);
    assert.equal(t.state, c.want, `${c.name}: ${t.state} — ${t.stateReason}`);
    assert.equal(t.shortlist, c.shortlist, c.name);
  }
});

test('03 benchmark: no false positive on the shortlist, no named positive missed', () => {
  const all = [...CASES, ...CONTROLS];
  let fp = 0, fn = 0, tp = 0;
  for (const c of all) {
    const got = T(c.quote, c.facts, c.extra).shortlist;
    if (got && !c.shortlist) fp++; else if (!got && c.shortlist) fn++; else if (got) tp++;
  }
  assert.equal(fp, 0);
  assert.equal(fn, 0);
  assert.ok(tp >= 8);
});

test('04 unknown materiality earns nothing; a small step fails the gate', () => {
  const kross = T(CASES[2].quote);
  assert.equal(kross.materiality.level, 'UNKNOWN');
  assert.equal(kross.gates.find((g) => g.key === 'materiality')?.result, 'UNKNOWN');
  assert.notEqual(kross.confidence, 'HIGH');
  const small = T('We received an order worth ₹40 crore from a state utility.', { salesCr: 1000 });
  assert.equal(small.gates.find((g) => g.key === 'materiality')?.result, 'FAIL');
});

test('05 ADVAIT: an order credited to another entity is not the listed company’s yet', () => {
  assert.equal(entityOf('NRE won a 116 crore solar EPC order', 'ADVAIT', 'Advait Energy Transitions Ltd').ok, false);
  assert.equal(entityOf('We won a 116 crore order', 'ADVAIT', 'Advait Energy Transitions Ltd').ok, true);
  const t = T(CASES[6].quote, { salesCr: 830 }, CASES[6].extra);
  assert.match(t.stateReason, /not the listed company/);
});

test('06 BLS: a weaker consolidated figure is surfaced, never hidden', () => {
  assert.match(String(contradictionOf([CASES[8].quote])), /consolidated figure weakened/);
  const mix = T('The share of value-added products rose from 30% to 55% of revenue.', { resultsVerdict: 'GROWING' }, { change_lines: ['Consolidated EBITDA margin moderated to 12% due to the segment mix.'] });
  assert.equal(mix.state, 'COMMERCIAL');   // never earnings-power while the consolidated figure weakened
  assert.ok(mix.contradiction);
});

test('07 change lines from the management text can carry the thesis when the keyword quote is ordinary', () => {
  const text = 'Good afternoon. EBITDA margins improved to 28.3% for the quarter, expanding by 550 basis points. '
    + 'The share of 220 kV and 400 kV products in our revenue increased from 53% to 78% this year as the new EHV line ramped up. '
    + 'We remain focused on execution. Will the margins sustain?';
  const lines = changeLinesOf(text);
  assert.equal(lines.length, 1);
  const t = T('EBITDA margins improved to 28.3% for the quarter, expanding by 550 basis points.', { resultsVerdict: 'STRONGER_LATEST' }, { change_lines: lines });
  assert.equal(t.mechanism, 'MIX_SHIFT');
  assert.equal(t.state, 'EARNINGS_POWER');
  assert.match(t.evidence.quote, /53% to 78%/);
});

test('08 share / capacity readers', () => {
  assert.deepEqual(shareShift('High-voltage products now contribute 78% of revenue, up from 53% a year ago.'), { from: 53, to: 78 });
  assert.equal(shareShift('Revenue grew 53% to ₹78 crore'), null);
  assert.equal(capacityStep('capacity doubled to 2 GW'), 2);
  assert.equal(capacityStep('Installed capacity increased from 40,000 TPA to 100,000 TPA'), 2.5);
  assert.equal(capacityStep('capacity from 10 MW to 20 GW'), null);
});

test('09 radar insight: lanes follow the research state; ordinary business is never on the shortlist', () => {
  const base = { patterns: [{ key: 'capacity' }, { key: 'mix' }], evidence_score: 7, tone: 'POSITIVE', quote_role: 'COMPANY', quote_quality: 'USABLE', filing_datetime: '2026-10-21T00:00:00Z' };
  const bepl = radarInsight({ ...base, evidence_label: 'Commercial production started', evidence_quote: CASES[0].quote }, { revQ: 30, revTTM: 15, epsQ: 40 }, NOW);
  assert.equal(bepl.lane, 'NONE');
  assert.equal(bepl.best, false);
  assert.match(bepl.headline, /^Ordinary business/);
  const kan = radarInsight({ ...base, evidence_quote: CASES[1].quote }, { revQ: 40, revTTM: 20, epsQ: 60, salesCr: 400 }, NOW);
  assert.equal(kan.lane, 'INFLECTION');
  assert.equal(kan.best, true);
  assert.equal(kan.checks.causalLink, false);
});

test('10 the page: shortlist table columns, thesis + evidence first, ordinary growth folded', () => {
  const ui = readFileSync(new URL('../../app/(dashboard)/concall-intel/components2.tsx', import.meta.url), 'utf8');
  for (const h of ['Company', 'Old business', 'What changes', 'Potential earnings impact', 'Proof stage', 'Key risk', 'Next milestone']) assert.ok(ui.includes(`'${h}'`), h);
  assert.match(ui, /Operational improvements \/ ordinary growth — not structural transformations/);
  assert.match(ui, /an empty shortlist is a valid answer/);
  const card = readFileSync(new URL('../../app/(dashboard)/concall-intel/radar-card.tsx', import.meta.url), 'utf8');
  assert.match(card, /Transformation thesis:/);
  assert.match(card, /Evidence:/);
  assert.doesNotMatch(card, /QUALITY<\/div>/);
});

test('11 the route stores change lines and the coverage job backfills older reads without throwing them away', () => {
  const route = readFileSync(new URL('../../app/api/v1/concall-intel/transformation-screener/route.ts', import.meta.url), 'utf8');
  assert.match(route, /change_lines: changeLinesOf\(scoring\)/);
  assert.match(route, /const RADAR_RULES_VERSION = 'r1217'/);   // stored reads keep serving
  assert.match(route, /mode === MODE_COVERAGE \? eligible\.filter\(\(e\) => needsLines/);
  assert.match(route, /transformation\?\.rankKey/);
});
