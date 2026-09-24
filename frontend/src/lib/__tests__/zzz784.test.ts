// zzz784 — the owner's QA of the live Portfolio Catalysts page:
//   stage ladder / next evidence, runway wording, business semantics (stores,
//   floor space, money), one normalized capex state, one state per variable
//   (count partitions), provenance tags, target ≠ actual, intact ≠ confirmed,
//   one-offs as a qualification, level ≠ growth, header arithmetic, guidance
//   metric labels. Run: npx tsx --test src/lib/__tests__/zzz784.test.ts
//   LIVE_LEDGERS=<path to ledgers_live.json> [LIVE_GRADED=<graded_live.json>]
//   additionally runs the count invariant over every live ledger.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { detectPersistentCatalysts, capacityClass, isUtilisationReading, CAPACITY_STAGES, CAPACITY_STAGE_LABEL } from '../catalyst/persistence';
import { assessThesis, tallyPartitionSum, croreOf } from '../thesis/status';
import { extractVariables, planGuard, provenanceLabel, guidanceMetric, utilisationGap } from '../thesis/variables';
import { capexBuild, buildCapexChain, capexProjects, completionDate } from '../thesis/capex-chain';
import { forwardSentence, volumeContext } from '../thesis/fact-normalize';
import { universeCounts } from '../thesis/evidence-counts';
import { chipValue } from '../../components/thesis-card';
import { classifyGradedRow } from '../earnings/pattern-abfg';

let n = 0;
const fact = (period: string, metric: string, after: string, o: Partial<{ before: string; stmt: string; date: string; type: string; quote: string }> = {}) => ({
  id: `f${n++}`, ticker: 'T', reporting_period: period, evidence_type: o.type || (o.stmt === 'TARGET' || o.stmt === 'GUIDANCE' ? 'forward' : 'mechanism'),
  metric_name: metric, metric_label: metric, value: after, before_value: o.before ?? null, after_value: after, unit: null, delta: null, direction: 'up',
  source_document_id: null, source_name: `Concall ${period}`, source_date: o.date || '2026-08-01', source_type: 'transcript', source_quote: o.quote || `we ${metric} ${after}`,
  fact_or_management_statement: o.stmt || 'FACT', confidence: 'HIGH', evidence_quality: 'sentence', extracted_at: '', updated_at: '', record_status: 'ACTIVE',
});
const ledger = (facts: any[], period = 'Q1 FY27') => ({ latest_period: period, latest_document_date: '2026-08-01', periods: { [period]: { reporting_period: period, facts, summary: null } } });
const cap = (l: any, extra: any = {}) => detectPersistentCatalysts({ ticker: 'T', ledger: l, origin: 'portfolio', today: '2026-09-24', ...extra }).find((p) => p.kind === 'CAPACITY_RAMP')!;
const EARLIER_THAN = (stage: string) => CAPACITY_STAGES.slice(0, CAPACITY_STAGES.findIndex((s) => CAPACITY_STAGE_LABEL[s] === stage));

describe('zzz784 · 1 — the capacity stage ladder; next evidence never an earlier stage', () => {
  test('GIPCL: 600 MW added and running at a 19.89% CUF → next is the next comparable utilisation, never "commissioning"; no headroom from a load factor', () => {
    const pc = cap(ledger([
      fact('Q1 FY27', 'capacity_addition', '600 MW', { quote: 'The Company added 600 MW Solar Plant Capacity at Khavda RE Park in phased manner during the year.' }),
      fact('Q1 FY27', 'utilisation', '19.89% CUF', { quote: 'The 600 MW Project generated 468.81 MUS during Financial year with CUF of 19.89%' }),
    ]));
    assert.equal(pc.stage, 'Production / running');
    assert.doesNotMatch(pc.nextMilestone!, /commissioning/i);
    assert.match(pc.nextEvidence!, /comparable installed-capacity basis/);
    assert.doesNotMatch(pc.runway.text, /points of installed capacity|80\.11/);
    assert.match(pc.runway.text, /FACTOR/);
    assert.ok(!pc.notYet.some((x) => /commission/i.test(x)), pc.notYet.join(' | '));
  });

  test('HAPPYFORGE / E2E shape: capacity added, utilisation disclosed, volume up → the next rung is revenue contribution (with comparable utilisation), never commissioning', () => {
    for (const [c, u] of [['4,000 tons', '59%'], ['29 MW', '11.2%']]) {
      const pc = cap(ledger([
        fact('Q1 FY27', 'capacity_addition', c, { quote: `We added ${c} of capacity during the quarter.` }),
        fact('Q1 FY27', 'utilisation', u, { quote: `The capacity utilization stood at ${u}.` }),
        fact('Q1 FY27', 'volume', 'volume grew 22% YoY'),
      ]));
      assert.equal(pc.stage, 'Volume ramp');
      assert.match(pc.nextEvidence!, /^Revenue contribution from the new capacity/);
      assert.match(pc.nextEvidence!, new RegExp(`utilisation above ${u.replace('.', '\\.')} on the same installed-capacity basis`));
      for (const early of EARLIER_THAN(pc.stage)) assert.doesNotMatch(pc.nextEvidence!, new RegExp(`^${CAPACITY_STAGE_LABEL[early]}`, 'i'));
    }
  });

  test('TATVA shape: headroom is said in percentage points of utilisation, never as physical capacity, and never with float noise', () => {
    const pc = cap(ledger([
      fact('Q1 FY27', 'capacity_addition', '344 KL', { quote: 'We added 344 KL of reactor capacity.' }),
      fact('Q1 FY27', 'utilisation', '76.9%', { quote: 'Capacity utilisation was 76.9% for the quarter.' }),
    ]));
    assert.match(pc.runway.text, /23\.1 percentage points of utilisation headroom/);
    assert.doesNotMatch(`${pc.runway.text} ${pc.mechanism}`, /\d\.\d{4,}|installed capacity still unused/);
  });

  test('MILKYMIST shape: 72 → 192 MT/day "commissioned & put to use" is running — next is its first utilisation, not commissioning', () => {
    const pc = cap(ledger([fact('Q1 FY27', 'capacity', '192 MT per day', { before: '72 MT per day', quote: 'CAPACITY EXPANSION COMMISSIONED & PUT TO USE: capacity increased from 72 MT per day to 192 MT per day' })]));
    assert.equal(pc.stage, 'Production / running');
    assert.match(pc.nextEvidence!, /first disclosed utilisation/i);
    assert.doesNotMatch(pc.nextMilestone!, /commissioning/i);
  });

  test('a management target is offered only for a LATER rung, labelled a milestone; an earlier-rung target is dropped', () => {
    const later = cap(ledger([
      fact('Q1 FY27', 'capacity_addition', '4,000 tons', { quote: 'We added 4,000 tons.' }),
      fact('Q1 FY27', 'utilisation', '59%', { quote: 'utilization stood at 59%' }),
      fact('Q1 FY27', 'utilisation', '80%', { stmt: 'TARGET', quote: 'we target 80% utilisation by FY28' }),
      fact('Q1 FY27', 'commissioning', 'December 2026', { stmt: 'GUIDANCE', quote: 'The line will be commissioned by December 2026' }),
    ]));
    assert.match(later.managementTarget!, /^Management target \(milestone, not evidence\): .*80%/);
    assert.doesNotMatch(later.nextMilestone!, /December 2026/, 'commissioning is an earlier rung than a running plant');
  });

  test('a capacity whose own sentence speaks about the future is a plan (IMFA "will stand at 355 MVA", "to increase … in FY27")', () => {
    assert.equal(forwardSentence('355 MVA', 'With the greenfield ferro chrome project in Kalinganagar, total furnace capacity will stand at 355 MVA (534,000 tpa).'), true);
    assert.equal(forwardSentence('484k TPA', 'Installed ferro chrome capacity to increase from 384k TPA to 484k TPA in FY27.'), true);
    assert.equal(forwardSentence('4,000 tons', 'We also added capacity during the quarter by commissioning another 4,000-ton forging press line, adding 4,000 tons of forging capacity.'), false);
    assert.equal(forwardSentence('1024', 'So that does not include another 1,024 B200 we are expecting soon.'), true);
    const pc = cap(ledger([fact('Q1 FY27', 'capacity', '355 MVA', { before: '256 MVA', quote: 'Currently we have 256 MVA and with the commissioning of the greenfield project, total furnace capacity will stand at 355 MVA.' })]));
    assert.notEqual(pc?.stage, 'Commissioned');
  });
});

describe('zzz784 · 3 — business semantics: stores, floor space and money are not production capacity', () => {
  test('ETHOSLTD: boutiques are a network expansion; same-store sales growth is not utilisation; no "production running"', () => {
    assert.equal(capacityClass('103 boutiques'), 'NETWORK');
    assert.equal(isUtilisationReading('13.2%', '13.2% Same Store Sales Growth (SSSG)'), false);
    const pc = cap(ledger([
      fact('Q1 FY27', 'capacity', '103 boutiques', { quote: 'Our boutique network grew from 94 boutiques at the end of FY26 to 103 boutiques as on date' }),
      fact('Q1 FY27', 'capacity', '94 boutiques', { quote: 'We closed the year with 94 boutiques, and have since grown to 103' }),
      fact('Q1 FY27', 'capacity_addition', 'Opened 9 Boutiques', { quote: 'Opened 9 Boutiques' }),
      fact('Q1 FY27', 'utilisation', '13.2%', { quote: '13.2% Same Store Sales Growth (SSSG)' }),
    ]));
    assert.equal(pc.label, 'Network expansion (stores)');
    assert.equal(pc.variant, 'NETWORK');
    const all = JSON.stringify(pc);
    assert.doesNotMatch(all, /production running|commissioned|capacity utilisation|utilisation 13\.2/i);
    assert.match(pc.mechanism, /94 → 103 boutiques/);
  });

  test('CYIENTDLM: lab floor space is a facility expansion; a renewable-energy share is not utilisation', () => {
    assert.equal(capacityClass('15,000 sq ft', 'we completed the expansion of our build-to-specifications lab from 6,000 square feet to 15,000 square feet'), 'FLOOR_SPACE');
    assert.equal(capacityClass('1,200 lakh square feet', 'This facility will add approximately 1,200 lakh square feet of annual capacity'), 'PRODUCTION');
    const pc = cap(ledger([
      fact('Q1 FY27', 'capacity', '15,000 sq ft', { before: '6,000 sq ft', quote: 'we completed the expansion of our build-to-specifications lab from 6,000 square feet to 15,000 square feet' }),
      fact('Q1 FY27', 'capacity', '63.61%', { quote: 'renewable energy (RE) accounted for 63.61% of our total electricity consumption' }),
    ]));
    assert.equal(pc.label, 'Facility expansion (floor space)');
    assert.equal(pc.specialFocus, false);
    assert.doesNotMatch(JSON.stringify(pc), /63\.61|commissioned|utilisation 6/);
  });

  test('INNOVACAP: "installed capacity ₹1,400 crores" is money, never capacity; EXICOM "capacity added capacity added 3x" is said once', () => {
    assert.equal(capacityClass('INR1,400 crores'), 'MONEY');
    const pc = cap(ledger([fact('Q1 FY27', 'capacity', 'INR1,400 crores', { quote: 'our Jammu plant at peak will do a revenue of around INR1,400 crores' }), fact('Q1 FY27', 'utilisation', '70%', { quote: 'capacity utilisation 70%' })]));
    assert.doesNotMatch(JSON.stringify(pc), /1,400/);
    const ex = detectPersistentCatalysts({ ticker: 'T', origin: 'portfolio', today: '2026-09-24', ledger: ledger([]),
      assessment: { status: 'ON_TRACK', mechanismEvidence: [{ key: 'capacity_addition', text: 'capacity added capacity added 3x' }] } }).find((p) => p.kind === 'CAPACITY_RAMP');
    if (ex) assert.doesNotMatch(ex.mechanism, /capacity added capacity added/);
  });

  test('GPPL / GOODLUCK: a tonnage the sentence calls volume grown / handled is volume, not capacity', () => {
    assert.equal(volumeContext('1.6 million metric tonnes', 'Fundamentally, the liquids have grown over the last three years. From a little less than 1,000,000 metric tonnes to last year, financial year at 1.6 million metric tonnes.'), true);
    assert.equal(volumeContext('1,22,718 MT', 'stand-alone volume has increased 8.8% Y-o-Y to 1,22,718 metric tons, while annualized capacity utilization remains strong at 98%.'), true);
    assert.equal(volumeContext('103 boutiques', 'Our boutique network grew from 94 to 103 boutiques'), false);
  });
});

describe('zzz784 · 4 / 12 — one normalized capex state: build ≠ economics, narrative = capex row = Special Focus', () => {
  const summary = { capex_projects: [
    { name: 'Coal Based Steam Plant Dahej', type: 'greenfield', amount: 'INR613 crores', capacity_added: '150 MT/Hr Steam', status: 'commercial_production', completion_period: '26-27 (steam commissioned; power expected in ~45 days)', revenue_from: 'not stated' },
    { name: 'Ammonia Expansion Bharuch', type: 'brownfield', amount: '', capacity_added: '50 KTPA', status: 'under_construction', completion_period: '27-28', revenue_from: 'not stated' },
  ] };
  const l = { latest_period: 'Q1 FY27', latest_document_date: '2026-08-01', periods: { 'Q1 FY27': { events: [] } } } as any;

  test('several projects in different states say so — never one project\'s state for all', () => {
    const b = capexBuild(capexProjects(summary, l, []))!;
    assert.equal(b.mixed, true);
    assert.equal(b.anyOperating, true);
    assert.match(b.text, /^multiple projects: Coal Based Steam Plant Dahej — commercial production; Ammonia Expansion Bharuch — under construction/);
    const chain = buildCapexChain(summary, [], l);
    assert.match(chain.earning.label, /^MIXED/);
    assert.match(chain.earning.operational!, /multiple projects/);
    assert.match(chain.earning.economic!, /not yet earning/);
  });

  test('a reported "commercial production" whose completion date is still ahead is a conflict, not a running plant (IMFA KNR-1)', () => {
    const s2 = { capex_projects: [{ name: 'KNR-1 greenfield ferrochrome project', type: 'greenfield', amount: '', capacity_added: '100k TPA', status: 'commercial_production', completion_period: 'Q3 FY27 (first furnace Aug 2026, second Sep 2026)', revenue_from: 'Q3 FY27' }] };
    const b = capexBuild(capexProjects(s2, l, []))!;
    assert.equal(b.projects[0].build, 'under construction');
    assert.match(b.text, /conflicts with its stated completion/);
    assert.ok(completionDate('May 2025')!.getTime() < completionDate('Q3 FY27')!.getTime());
  });

  test('the status narrative reads the SAME build state as the capex row: no "producing" beside "under construction"', () => {
    const vars: any[] = [
      { key: 'revenue_growth', label: 'Revenue growth', before: null, after: '+30%', delta: '+30%', verdict: 'improving', evidence: '', source: 'grader', kind: 'fact' },
      { key: 'earnings_growth', label: 'Earnings growth', before: null, after: '+45%', delta: '+45%', verdict: 'improving', evidence: '', source: 'grader', kind: 'fact' },
      { key: 'capex_status', label: 'Capex status', before: null, after: 'commercial_production; under_construction', delta: null, verdict: 'improving', evidence: '', source: 'filing', kind: 'fact' },
    ];
    const allUnderConstruction = { build: { text: '2 projects, all under construction: A; B', anyOperating: false, mixed: false }, economic: 'not yet earning (not built)', earningState: 'NOT_STARTED' };
    const a = assessThesis({ pattern: 'A', variables: vars, evidenceReviewed: true, hasGraderRow: true, capexState: allUnderConstruction });
    assert.doesNotMatch(a.because, /producing|commercial production/);
    const mixed = { build: { text: 'multiple projects: A — commercial production; B — under construction', anyOperating: true, mixed: true }, economic: 'not yet earning — no revenue attributed to it', earningState: 'SPENT_NOT_EARNING' };
    const b = assessThesis({ pattern: 'A', variables: vars, evidenceReviewed: true, hasGraderRow: true, capexState: mixed });
    assert.match(b.because, /capex: multiple projects: A — commercial production; B — under construction — economic status: not yet earning/);
  });

  test('Special Focus never runs ahead of the card: with nothing built on the card, lifecycle words cannot make the capacity "running"', () => {
    const lf = ledger([fact('Q1 FY27', 'capex_status', 'commercial production of the new line', { quote: 'commercial production of the new line' })]);
    const on = cap(lf);
    const off = cap(lf, { capex: { build: { anyOperating: false, projects: [{ name: 'New line', build: 'under construction' }] } } });
    assert.equal(on?.stage, 'Production / running');
    assert.equal(off?.stage, 'Under construction');
  });
});

describe('zzz784 · 5 — one state per variable; every count is a partition', () => {
  const fx = (f: string) => readFileSync(join(__dirname, 'fixtures', f), 'utf8');
  const live = JSON.parse(fx('live-ledgers-zzz765c.json'));
  const bench: any[] = JSON.parse(fx('bench-rows.json'));
  const check = (a: ReturnType<typeof assessThesis>, who: string) => {
    for (const [name, t] of Object.entries({ mechanism: a.coverage.mechanism, output: a.coverage.output, forward: a.coverage.forward, structural: a.coverage.structural! })) {
      assert.equal(tallyPartitionSum(t), t.total, `${who} ${name}: parts ${tallyPartitionSum(t)} ≠ total ${t.total}`);
      assert.equal(t.core_variables, t.total - t.not_applicable, `${who} ${name}: core = total − n/a`);
    }
    assert.equal(a.coverage.structural!.confirmed, a.verdict!.coverage.confirmed, `${who}: structural confirmed = the status line's X`);
    assert.equal(a.coverage.structural!.core_variables, a.verdict!.coverage.applicable, `${who}: structural core = the status line's Y`);
    const ev = a.evidenceItems!;
    assert.equal(ev.structural.length + ev.supporting.length, (a.mechanismEvidence || []).length, `${who}: evidence items partition`);
  };
  test('fixture ledgers + bench rows', () => {
    for (const t of Object.keys(live.ledgers)) {
      const l = live.ledgers[t];
      for (const p of [null, 'A', 'B', 'F', 'G'] as any[]) check(assessThesis({ pattern: p, variables: extractVariables(l.graded, { ...l.summary, events: l.events }), evidenceReviewed: true, hasGraderRow: !!l.graded }), `${t}/${p}`);
    }
    for (const r of bench) check(assessThesis({ pattern: classifyGradedRow(r)?.pattern ?? null, variables: extractVariables(r, null), evidenceReviewed: true }), r.symbol || 'bench');
  });
  test('GANDHAR shape: "drivers evidenced" is labelled as evidence items, split structural / supporting — never a bare count beside X/Y', () => {
    const V = (key: string, verdict: string, o: any = {}) => ({ key, label: key, before: null, after: o.after ?? null, delta: o.delta ?? null, verdict, evidence: '', source: o.source ?? 'filing', kind: 'fact', statement: 'ACTUAL' }) as any;
    const a = assessThesis({ pattern: 'F', evidenceReviewed: true, hasGraderRow: true, variables: [
      V('revenue_growth', 'improving', { delta: '+91.8%', source: 'grader' }), V('earnings_growth', 'improving', { delta: '+692%', source: 'grader' }), V('margin', 'improving', { delta: '+11.0pp', source: 'grader' }),
      V('capacity_addition', 'improving', { after: '20,000 kL' }), V('volume', 'improving', { after: '1,31,449 kl' }),
      V('exports', 'improving', { after: '54% year-on-year' }), V('regulatory_approval', 'improving', { after: 'US FDA approval received' }),
    ] });
    check(a, 'GANDHAR-shape');
    assert.doesNotMatch(a.verdict!.directionWhy, /\d mechanism drivers? evidenced/);
    if (a.status === 'ON_TRACK') {
      assert.match(a.verdict!.directionWhy, /structural confirmed; \d+ evidence items? in the documents \(\d+ structural, \d+ supporting — not counted in/);
      assert.match(a.because, /Mechanism evidence in the documents — structural \(\d+\/\d+ confirmed\)/);
    }
  });
  const livePath = process.env.LIVE_LEDGERS;
  test('every live ledger (LIVE_LEDGERS)', { skip: !livePath || !existsSync(livePath) }, async () => {
    const { applyLedger } = await import('../thesis/use-book');
    const { migrateLedger } = await import('../thesis/evidence-ledger');
    const L = JSON.parse(readFileSync(livePath!, 'utf8'));
    const G = process.env.LIVE_GRADED && existsSync(process.env.LIVE_GRADED) ? JSON.parse(readFileSync(process.env.LIVE_GRADED, 'utf8')).rows : {};
    let k = 0;
    for (const [t, raw] of Object.entries<any>(L.ledgers)) {
      const g = G[t] && G[t].source !== 'none' ? G[t] : null;
      const row0: any = { symbol: t, origin: 'book', market: 'IN', graded: g, tier: g?.tier || null, pattern: g ? classifyGradedRow(g) : null, summary: null, state: 'idle', assessment: null, capex: null };
      const r = applyLedger(row0, migrateLedger(raw), L.freshness?.[t] || null);
      if (r.assessment) { check(r.assessment, t); k++; }
    }
    assert.ok(k > 50);
  });
});

describe('zzz784 · 6 / 7 — provenance: a management statement and a target are tagged on the row itself', () => {
  test('a management-statement row says so on the chip; a guidance capacity never wears the installed-capacity label', () => {
    assert.match(chipValue({ verdict: 'stated', before: null, after: '2,50,000 shells per annum', delta: null, statement: 'MANAGEMENT_STATEMENT' } as any), /“2,50,000 shells per annum” — management statement, not a filed figure/);
    const g = provenanceLabel({ key: 'capacity', label: 'Installed capacity', before: null, after: '360 LSF per annum', delta: null, verdict: 'stated', evidence: '', source: 'filing', statement: 'GUIDANCE' } as any);
    assert.match(g.label, /^Capacity target \(guidance only — not installed capacity\)$/);
    const add = provenanceLabel({ key: 'capacity_addition', label: 'Capacity added', before: null, after: '5.2 million MT', delta: null, verdict: 'stated', evidence: '', source: 'filing', statement: 'GUIDANCE' } as any);
    assert.match(add.label, /not capacity added/);
    const vol = provenanceLabel({ key: 'capacity', label: 'Installed capacity', before: null, after: '260 to 270,000', delta: null, verdict: 'stated', evidence: '', source: 'filing', statement: 'GUIDANCE', quote: 'RoRo is expected to have a volume of about 260 to 270,000 cars.' } as any);
    assert.match(vol.label, /^Volume target/);
    const store = provenanceLabel({ key: 'capacity', label: 'Installed capacity', before: null, after: '103 boutiques', delta: null, verdict: 'improving', evidence: '', source: 'filing', statement: 'ACTUAL' } as any);
    assert.match(store.label, /Store network/);
  });

  test('a planned addition (TATVA 344 KL "within 21 months", project announced) is a TARGET, never capacity added, never confirmed', () => {
    const summary = { capacity: { added: '344 kilolitres (KL)', added_by: '21 months (approximately)' }, capex_projects: [{ name: 'Dahej-III', capacity_added: 'aggregate reactor capacity of 344 kilolitres (KL)', status: 'announced' }] };
    const v = planGuard({ key: 'capacity_addition', label: 'Capacity added', before: null, after: '344 kilolitres (KL)', delta: null, verdict: 'improving', evidence: 'Capacity added: 344 KL.', source: 'filing', statement: 'ACTUAL' } as any, summary, 'Q1 FY27');
    assert.equal(v.statement, 'TARGET');
    assert.notEqual(v.verdict, 'improving');
    // "2 VLGCs inducted" is never matched to a project by the digit "2" inside "52,000".
    const sci = planGuard({ key: 'capacity_addition', label: 'Capacity added', before: null, after: '2 VLGCs inducted', delta: null, verdict: 'improving', evidence: '', source: 'filing', statement: 'ACTUAL' } as any,
      { capacity: { added: '2 VLGCs inducted', added_by: 'not stated' }, capex_projects: [{ name: 'MR Tanker', capacity_added: '30,000 GT / 52,000 DWT each', status: 'announced' }] }, 'Q1 FY27');
    assert.equal(sci.statement, 'ACTUAL');
    // A claim that "improved" is never structurally confirmed.
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      { key: 'capacity_addition', label: 'Capacity added', before: null, after: '2,50,000 shells per annum', delta: null, verdict: 'improving', evidence: '', source: 'filing', kind: 'claim', statement: 'MANAGEMENT_STATEMENT' } as any,
    ] });
    assert.equal(a.verdict!.coverage.confirmed, 0);
    assert.ok(a.structuralStates!.some((s) => s.key === 'capacity_addition' && s.state === 'statement_only'));
  });

  test('GALAXYSURF: a per-tonne guidance keeps the source\'s metric (EBITDA per MT), not a generic "guidance"', () => {
    assert.equal(guidanceMetric('INR 24,000 to INR 25,000 per metric ton', 'we maintain our volume guidance at 6% to 8%, but increased the range of the EBITDA per metric ton to INR 24,000 to INR 25,000 per metric ton'), 'EBITDA per MT');
    const r = provenanceLabel({ key: 'guidance', label: 'Guidance', before: null, after: 'INR 24,000 to INR 25,000 per metric ton', delta: null, verdict: 'stated', evidence: '', source: 'filing', statement: 'GUIDANCE',
      quote: 'increased the range of the EBITDA per metric ton to INR 24,000 to INR 25,000 per metric ton' } as any);
    assert.equal(r.label, 'Guidance — EBITDA per MT');
  });
});

describe('zzz784 · 8 — intact ≠ confirmed', () => {
  test('ON TRACK with under half the structural mechanism confirmed says it in the status sentence; the status is unchanged', () => {
    const V = (key: string, verdict: string, o: any = {}) => ({ key, label: key, before: null, after: o.after ?? null, delta: o.delta ?? null, verdict, evidence: '', source: o.source ?? 'filing', kind: 'fact', statement: 'ACTUAL' }) as any;
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      V('revenue_growth', 'improving', { delta: '+30%', source: 'grader' }), V('earnings_growth', 'improving', { delta: '+45%', source: 'grader' }),
      V('capacity_addition', 'improving', { after: '5000MTPA → 9,600MTPA' }),
    ] });
    assert.equal(a.status, 'ON_TRACK');
    assert.match(a.because, /Thesis intact — nothing contradicts it — but mechanism evidence is incomplete \(1\/\d core confirmed\); intact does not mean the catalyst is confirmed\./);
  });
});

describe('zzz784 · 9 — one-offs stay visible as a QUALIFICATION', () => {
  const V = (key: string, verdict: string, o: any = {}) => ({ key, label: key, before: o.before ?? null, after: o.after ?? null, delta: o.delta ?? null, verdict, evidence: o.evidence ?? '', source: o.source ?? 'filing', kind: 'fact', statement: 'ACTUAL', unjudged: o.unjudged ?? null }) as any;
  const OUT = [V('revenue_growth', 'improving', { delta: '+30%', source: 'grader' }), V('earnings_growth', 'improving', { before: '50 Cr', after: '74 Cr', delta: '+48%', source: 'grader' })];
  test('GOLDIAM: a tariff refund inside the margin driver is set aside, sized vs quarterly PAT, and the driver keeps only its structural clause', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [...OUT,
      V('margin_driver', 'improving', { after: 'Other income includes tariff refund of approximately INR22 crores contributing to Q1 EBITDA; Steady-state margin expansion attributed to higher lab-grown jewellery mix' })] });
    assert.ok(a.qualification!.length >= 1);
    assert.match(a.qualification![0], /^QUALIFICATION \/ WATCH — one-off benefit in reported earnings: .*tariff refund.* ≈ 30% of the quarter's reported profit \(₹74 Cr\) — material/);
    const md = a.checked.find((c) => c.key === 'margin_driver');
    if (md) assert.doesNotMatch(String(md.after), /tariff refund/);
    assert.match(a.because, /QUALIFICATION \/ WATCH/);
  });
  test('a margin driver that is only a one-off is not a structural driver', () => {
    const a = assessThesis({ pattern: 'F', evidenceReviewed: true, hasGraderRow: true, variables: [...OUT,
      V('margin_driver', 'improving', { after: 'Duty benefit scripts Rs.31.6 crores and provision reversals' })] });
    assert.equal(a.structuralStates!.find((s) => s.key === 'margin_driver')?.state === 'confirmed', false);
  });
  test('GOPAL shape: a one-off larger than the quarter\'s profit is DATA VALIDATION REQUIRED', () => {
    const a = assessThesis({ pattern: 'F', evidenceReviewed: true, hasGraderRow: true, variables: [...OUT,
      V('one_offs', 'stated', { after: '₹120 Cr · other', evidence: '+ ₹120 Cr · other — “Rajkot insurance claim”', unjudged: 'the stated one-off exceeds the reported profit, so the two are on different bases' })] });
    assert.match(a.qualification!.join(' '), /DATA VALIDATION REQUIRED/);
    assert.equal(croreOf('INR22 crores'), 22);
  });
});

describe('zzz784 · 10 — level ≠ growth', () => {
  test('SAMBHV: a utilisation target below the current reading is "not comparable", never a gap', () => {
    assert.match(utilisationGap('utilisation', '60%', 'around 35%')!, /^not comparable/);
    assert.equal(utilisationGap('utilisation', '60%', '80%'), '-20pp');
  });
  test('a single utilisation level (98%) is never "improving": steady state, not a ramp', () => {
    const pc = cap(ledger([fact('Q1 FY27', 'utilisation', '98%', { quote: 'capacity utilisation remains strong at 98%' })]));
    assert.equal(pc.stage, 'Steady state');
    assert.equal(pc.state, 'MATURE');
    assert.ok(!pc.happened.some((h) => /Utilisation ramp/.test(h)));
  });
});

describe('zzz784 · 13 — header arithmetic reconciles visibly', () => {
  test('total − hidden = shown = book + bench; buckets + not assessed = shown; exportable + excluded = evaluated', () => {
    const row = (origin: string, status: string | null, market = 'IN', fit: string | null = null) => ({ origin, market, assessment: status ? { status } : null, pattern: fit ? { fit } : null });
    const all = [row('book', 'ON_TRACK'), row('both', 'WEAKENING'), row('bench', 'THESIS_NOT_SET'), row('bench', 'CONFIRMATION_REQUIRED', 'IN', 'nearest'), row('bench', null), row('bench', 'ON_TRACK', 'US'), row('bench', 'NEUTRAL')];
    const shown = all.slice(0, 6);
    const u = universeCounts(all, shown, ['STRENGTHENING', 'ON_TRACK', 'CONFIRMATION_REQUIRED', 'POSITIVE_EXPECTATION_GAP']);
    assert.equal(u.total - u.hiddenLargeCap, u.shown);
    assert.equal(u.book + u.bench, u.shown);
    assert.equal(u.statusSum + u.notAssessed, u.shown);
    assert.equal(u.exportable + u.exportableUs + u.excludedN, u.evaluated);
    assert.equal(u.provisional, 1);
    assert.match(u.line, /^7 total − 1 large caps hidden = 6 shown = 2 book \+ 4 bench · 5 evaluated \+ 1 not yet assessed/);
  });
});
