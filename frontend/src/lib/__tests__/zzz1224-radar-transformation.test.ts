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
const CASES: Array<{ name: string; quote: string; facts?: Record<string, unknown>; extra?: Record<string, unknown>; want: ResearchState; tier: 'CONFIRMED' | 'WATCH' | 'EXCLUDED' }> = [
  { name: 'BEPL — 20 new products / colour grades = product development', quote: 'Commercialization: Successfully transitioned 20 new/improved products (including 18 color grades) from R&D to commercial production.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'KANOHAR — high-voltage share 53% → 78% = mix shift', quote: 'The share of high-voltage products in our revenue increased from 53% to 78% over the year.', facts: { salesCr: 400, resultsVerdict: 'STRONGER_LATEST' }, want: 'EARNINGS_POWER', tier: 'CONFIRMED' },
  { name: 'KROSS — extruded axle beam production commenced; scale unknown', quote: 'Commercial vehicles -- commercial production of our extruded axle beam has commenced and the capacity utilization of this is approximately 80% of our current output.', want: 'COMMERCIAL', tier: 'WATCH' },
  { name: 'BALAMINES — ACN capacity 1,440 TPM; capacity is not profit', quote: 'During the period, commercial production commenced at the expanded Acetonitrile (ACN) facility, increasing installed capacity to 1,440 TPM.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'TINNARUBR — one plant turned around; consolidated size unknown', quote: 'Internationally, our Oman plant ran at 90% utilization in H1 and its EBITDA margins improved to 11.5% from only 6.4% in FY26.', want: 'EMERGING', tier: 'WATCH' },
  { name: 'PARACABLES — HTLS order ≈ 9% of sales, capacity only planned', quote: 'We have already secured an HTLS order book of INR 200 crores plus as on date and the capacity augmentation for specialized conductors is planned at our new plant at Narmadapuram.', facts: { salesCr: 2126 }, want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'ADVAIT — ₹116 Cr order credited to "NRE" (entity unclear)', quote: 'NRE order win: NREwon a 116 crore solar EPC order for a 200 MW project from KPI Green Energy, strengtheningitsrenewableexecutionpipeline.', facts: { salesCr: 830 }, extra: { symbol: 'ADVAIT', company_name: 'Advait Energy Transitions Ltd' }, want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'CONCORDBIO — capability ("enabling scale-up"), not commercialisation', quote: 'Advanced fermenters and pilot plant facilities for seamless scale-up from lab to commercial production.', want: 'INSUFFICIENT', tier: 'EXCLUDED' },
  { name: 'BLS — segment margins up, consolidated margin moderated', quote: 'While EBITDA Margins expanded across both business segments, a shift in the segment mix resulted in a slight moderation in the consolidated EBITDA margin to 25%.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'NETWEB — total order book, not a new order', quote: 'The relatively higher inventory levels are intentional and reflect our preparation for executing the order book of approximately INR2,629 crores as of September 26.', facts: { salesCr: 1100 }, want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'POLYCAB — margin up on mix and efficiency = operational', quote: 'EBITDA increased by 39% year-on-year, while EBITDA margins expanded by more than 50 basis points sequentially to 14.4%, supported by a favourable business mix and continued focus on operational efficiencies.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'BETA — first purchase order from a hospital chain', quote: 'As discussed, we have got successfully our first purchase order from the Tata Hospitals.', want: 'EMERGING', tier: 'WATCH' },
  { name: 'PACEDIGITK — orders "before IPO" are old', quote: '3,250 Cr of BESS orders secured before IPO.', facts: { salesCr: 2818 }, extra: { quote_role: 'COMPANY' }, want: 'ROUTINE', tier: 'EXCLUDED' },
];
// ── negative controls (the owner's list) and early, pre-earnings positives ──
const CONTROLS: typeof CASES = [
  { name: 'old milestones in a new deck', quote: 'Over the last 10 years we commissioned 5 plants and won orders worth ₹2,000 crore.', facts: { salesCr: 500 }, want: 'INSUFFICIENT', tier: 'EXCLUDED' },
  { name: 'guidance without execution', quote: 'We expect revenue to double by FY28 as the new plant ramps up.', want: 'INSUFFICIENT', tier: 'EXCLUDED' },
  { name: 'commodity spread margin', quote: 'EBITDA margin improved to 18% on the back of lower raw material prices and better realisations.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'low base', quote: 'Revenue grew 180% on a low base as the previous year was hit by the plant shutdown.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'generic optimism', quote: 'We are very optimistic about the strong opportunities ahead in all our businesses.', want: 'INSUFFICIENT', tier: 'EXCLUDED' },
  { name: 'capacity without utilisation', quote: 'We added 20,000 TPA of capacity during the quarter.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'acquisition-driven growth', quote: 'Revenue grew 60% driven by the acquisition of XYZ Ltd which was consolidated from this quarter.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'accounting gain', quote: 'Profit includes an exceptional gain of ₹45 crore on sale of land.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'label change', quote: 'We have renamed our specialty segment as the Advanced Materials division.', want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'chart fragment', quote: 'Revenue 120 150 180 210 240 270 300 330 EBITDA 20 25 30', want: 'INSUFFICIENT', tier: 'EXCLUDED' },
  { name: 'single small order', quote: 'We received an order worth ₹40 crore from a state utility for transformers.', facts: { salesCr: 1000 }, want: 'ROUTINE', tier: 'EXCLUDED' },
  { name: 'order not yet revenue (large) = commercial, never earnings-power', quote: 'We received an order worth ₹600 crore from NTPC for supply of transformers.', facts: { salesCr: 1000, resultsVerdict: 'GROWING' }, want: 'EMERGING', tier: 'WATCH' },
  { name: 'early: regulated-market approval', quote: 'We received USFDA approval for our Visakhapatnam API facility, our first regulated-market approval.', want: 'EMERGING', tier: 'WATCH' },
  { name: 'early: capacity step of 2.5×', quote: 'Installed capacity increased from 40,000 TPA to 100,000 TPA with commissioning of the new plant.', want: 'EMERGING', tier: 'WATCH' },
  { name: 'early: qualified by new customers', quote: 'Our new line was qualified by two global innovator customers this quarter.', want: 'EMERGING', tier: 'WATCH' },
  { name: 'analyst said it', quote: 'Your high-voltage share has gone from 53% to 78%, is that sustainable?', extra: { quote_role: 'ANALYST' }, want: 'INSUFFICIENT', tier: 'EXCLUDED' },
];

test('01 owner-named cases from the live radar', () => {
  for (const c of CASES) {
    const t = T(c.quote, c.facts, c.extra);
    assert.equal(t.state, c.want, `${c.name}: ${t.state} — ${t.stateReason}`);
    assert.equal(t.tier, c.tier, `${c.name}: ${t.tier}`);
  }
});

test('02 negative controls and early positives', () => {
  for (const c of CONTROLS) {
    const t = T(c.quote, c.facts, c.extra);
    assert.equal(t.state, c.want, `${c.name}: ${t.state} — ${t.stateReason}`);
    assert.equal(t.tier, c.tier, `${c.name}: ${t.tier}`);
  }
});

test('03 curated fixtures (rule consistency, NOT a real-world error rate): nothing excluded is promoted, nothing kept is dropped', () => {
  const all = [...CASES, ...CONTROLS];
  let fp = 0, fn = 0, kept = 0;
  for (const c of all) {
    const got = T(c.quote, c.facts, c.extra).tier !== 'EXCLUDED';
    const want = c.tier !== 'EXCLUDED';
    if (got && !want) fp++; else if (!got && want) fn++; else if (got) kept++;
  }
  assert.equal(fp, 0);
  assert.equal(fn, 0);
  assert.ok(kept >= 8);
  // an unknown gate never confirms: only the measured mix shift is CONFIRMED in the whole set
  assert.deepEqual(all.filter((c) => T(c.quote, c.facts, c.extra).tier === 'CONFIRMED').map((c) => c.name.split(' ')[0]), ['KANOHAR']);
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
  // zzz1224d — and a single order of 14% of sales is normal order flow anyway
  const t = T(CASES[6].quote, { salesCr: 830 }, CASES[6].extra);
  assert.equal(t.tier, 'EXCLUDED');
  const big = T('NRE won a 400 crore solar EPC order from KPI Green Energy this quarter.', { salesCr: 830 }, CASES[6].extra);
  assert.equal(big.tier, 'WATCH');
  assert.match(big.stateReason, /not the listed company/);
});

test('06 BLS: a weaker consolidated figure is surfaced, never hidden', () => {
  assert.match(String(contradictionOf([CASES[8].quote])), /consolidated figure weakened/);
  const mix = T('The share of value-added products rose from 30% to 55% of revenue.', { resultsVerdict: 'GROWING' }, { change_lines: ['Consolidated EBITDA margin moderated to 12% due to the segment mix.'] });
  assert.equal(mix.state, 'COMMERCIAL');   // never earnings-power while the consolidated figure weakened
  assert.equal(mix.tier, 'WATCH');
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

test('12 zzz1224b — first live shortlist review: routine growth, passive approvals, MoUs and order-book stock are not transformations', () => {
  const s = (q: string, f: Record<string, unknown> = {}) => T(q, f).state;
  // ACEVECTOR / CAMS: new customers added is ordinary growth
  assert.equal(T('65% of the new customers added in H1 FY27 were GenZ. Annual transacting customers increased 12% to 130.8 lakhs.').tier, 'EXCLUDED');
  assert.equal(T('This is typically usage growth, both by the base and by new clients which have been onboarded.').tier, 'EXCLUDED');
  // CGCL / UCOBANK: a lender's new state or MoU
  assert.equal(s('This footprint expanded further in Q2 with our maiden foray into Tamil Nadu metro market.', { industry: 'Non Banking Financial Company (NBFC)' }), 'ROUTINE');
  assert.equal(s('We have entered into an MOU with the Government of Bihar for their employees salary accounts.', { industry: 'Public Sector Bank' }), 'INSUFFICIENT');
  // HINDZINC / SAMBHV: MoU or a PLI incentive approval
  assert.equal(s('We have tied up for a high-density plantation and also entered an MoU to deploy further 30 electric vehicles.'), 'INSUFFICIENT');
  assert.equal(T('We have also received our PLI approval and we have also signed MoU under PLI 1.2 for seamless pipe sales.').tier, 'EXCLUDED');
  // AUROPHARMA / DRREDDY / SHAREINDIA: a passive "approved by" status is not a new approval
  assert.equal(T('The company has 30+ manufacturing facilities that are approved by leading regulatory agencies including USFDA.').tier, 'EXCLUDED');
  assert.equal(T('Strategy Validation A library of 20 approved strategies, backed by historical backtesting.').tier, 'EXCLUDED');
  // a real new approval still counts; in a ₹30,000 Cr company it is small unless sized
  assert.equal(s('We received USFDA approval for our new oncology injectable facility this quarter.'), 'EMERGING');
  assert.equal(T('We received USFDA approval for our new oncology injectable facility this quarter.', { salesCr: 33000 }).tier, 'EXCLUDED');
  // ZENTEC: the order book in the same sentence is not the new order
  const z = T('Order inflow during the quarter was 481.81 crore, taking the consolidated order book to 1,375.70 crore as at 30 September 2026.', { salesCr: 672 });
  assert.equal(z.mechanism, 'ROUTINE');
  assert.match(z.stateReason, /≈ 72% of annual sales over the period — normal order flow/);
});

test('13 zzz1224c — second review: one evidence record, orders are visibility, unknown gates go to research watch', () => {
  // ZENTEC: inflow, not the backlog, and a large order is not a change in the business by itself
  const z = T('Order inflow during the quarter was 481.81 crore, taking the consolidated order book to 1,375.70 crore as at 30 September 2026.', { salesCr: 672 });
  assert.equal(z.state, 'ROUTINE');
  assert.equal(z.tier, 'EXCLUDED');
  const one = T('We received an order worth ₹600 crore from NTPC for supply of transformers in Q2.', { salesCr: 1000 });
  assert.equal(one.tier, 'WATCH');
  assert.match(one.stateReason, /not by itself a change in the business/);
  // a filing date alone does not date the event
  const undated = T('Commercial production of our new forged crankshaft line has commenced.');
  assert.equal(undated.gates.find((g) => g.key === 'dated')?.result, 'UNKNOWN');
  assert.equal(undated.tier, 'WATCH');
  // the card's proof verdict and size come from the same sentence as the thesis
  const base = { patterns: [{ key: 'capacity' }], evidence_score: 6, tone: 'POSITIVE', quote_role: 'MANAGEMENT', quote_quality: 'USABLE', filing_datetime: '2026-10-21T00:00:00Z' };
  const i = radarInsight({ ...base, evidence_label: 'Order received', evidence_quote: 'Exports remained a key growth driver.', change_lines: ['The share of exports in our revenue increased from 20% to 45% in H1 FY27.'] }, { revQ: 30, revTTM: 15, epsQ: 40 }, NOW);
  assert.match(i.proof.reason, /20% to 45%|Share moved/);
  assert.equal(i.proof.kind, 'MILESTONE');
  assert.equal(i.transformation.evidence.quote, 'The share of exports in our revenue increased from 20% to 45% in H1 FY27.');
  // business today states sales and says the segment split is missing
  assert.match(T('x', { industry: 'Rubber', salesCr: 610 }).thesis.oldBusiness, /₹610 Cr of annual sales \(segment split not in the data\)/);
});

test('14 zzz1224d — change lines from real transcripts: shares, firsts, "entered" and order totals read strictly', () => {
  const st = (q: string, f: Record<string, unknown> = {}) => T(q, f).tier;
  // a range, an industry statistic, a margin, a planned share are not mix shifts
  assert.equal(shareShift('And you understand that 30% to 40% of the business of automobile is in the South part of the country.'), null);
  assert.equal(shareShift('5G usage alone growing 79% year-on-year, representing 44% of total data consumption, up from 32% in the prior year.'), null);
  assert.equal(shareShift('There have been improvement in gross margins by 1.2% to 71.1% from 69.9% previous year.'), null);
  assert.equal(st('So that is how the journey of we are trying to cross till FY29 to 19% to 40% in terms of share of the brand business.'), 'EXCLUDED');
  // "increased by 6% to 74%" is a 6-point move
  assert.deepEqual(shareShift('Trade volumes increased by 8.6% Y-on-Y, while trade share rose by 6% to 74% of sales.'), { from: 68, to: 74 });
  // "first" noise
  for (const q of ['First is engage the customer, talk to the customer and understand why they want to go out.', 'The first step is to start our own commercial building.',
    'After a soft first quarter, export revenue grew 69% Y-o-Y in Q2.', 'Difficult to comment on realization until we have started the first supply.',
    'We also completed our first customer migration using our AI-powered migration technology.']) assert.equal(st(q), 'EXCLUDED', q);
  assert.equal(st('The Company marked an important milestone by securing its first order from the United States.'), 'WATCH');
  assert.equal(T('I am happy to say that this was our first quarter of commercial revenue from the Battery Chemicals business.').mechanism, 'NEW_BUSINESS');
  // "entered" noise
  for (const q of ['So when we entered the FY27, it was on a positive note.', 'This has been there from 2014 when we first entered the Indian market.',
    'We have not entered ventured into the tissue line.', 'And that is why we have entered this segment.', 'Entered global markets in 1998, diversified into specialty-grade papers in 2003.']) assert.equal(st(q), 'EXCLUDED', q);
  assert.equal(st('We have also recently entered the industrial-shaft and defence segments.'), 'WATCH');
  // order totals: inflow is ordinary; a total book with "newly secured" projects is not a sized new order
  assert.equal(st('We won new orders totalling INR3,011 crores for cells and modules, taking our total order book to INR15,000 crores.', { salesCr: 8300 }), 'EXCLUDED');
  assert.equal(st('Company s unexecuted order book, including newly secured two NHAI HAM projects, stands at ₹20,000 crore.', { salesCr: 6500 }), 'EXCLUDED');
  // an insurance-claim approval is not a market approval
  assert.equal(st('The Company also received approval for a full and final insurance claim of Rs. 36.40 crores.'), 'EXCLUDED');
});

test('15 zzz1224e — live watch review: counts in crore, industry capacity, quarterly order totals, future qualification', () => {
  const st = (q: string, f: Record<string, unknown> = {}) => T(q, f).tier;
  assert.equal(st('The last tender that came against an order of 1,050 crore liters, the offers received were 1,800 crore litres.', { salesCr: 1500 }), 'EXCLUDED');
  assert.equal(st('On supply, large Indian growers are adding reactors and are doubling their capacity in 3 years.'), 'EXCLUDED');
  assert.equal(st('On the order front, we received a total order of INR90 crores only in the first quarter of FY27.', { salesCr: 200 }), 'EXCLUDED');
  assert.equal(st('Our process wafers have been qualified and we are working with partners ahead of our first customer samples, which will happen next year.'), 'EXCLUDED');
  assert.equal(st('So the paracetamol capacity, we started with 3,600 MTPA which we tripled last year.'), 'WATCH');
});
