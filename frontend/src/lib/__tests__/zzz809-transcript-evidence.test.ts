// zzz809 — Portfolio Catalysts: reading a concall / business-update transcript
// as the kind of statement each sentence actually is.
//
// Built from short excerpts of IOLCP's "Business Update Call" transcript
// (call 11 Sep 2026, filed with NSE/BSE on 17 Sep 2026 — a public exchange
// filing) plus generic synthetic sentences. No rule here names a ticker.
//
// Run: npx tsx --test src/lib/__tests__/zzz809-transcript-evidence.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  utilisationTense, utilisationLow, productOfCapacity, deriveCurrentCapacity, isPostExpansionTotal, powerOfTenApart,
  capexAmountKind, incurredShare, commercialStartOf, bottleneckHurtsSales, transcriptCommentary,
} from '../thesis/transcript-evidence';
import { normalizeEvent } from '../thesis/fact-normalize';
import { varsFromEvents, extractVariables, forwardGuidanceLines } from '../thesis/variables';
import { assessThesis } from '../thesis/status';
import { buildCapexChain, capexProgramme } from '../thesis/capex-chain';
import { candidatesFromBse, classifyExchangeDoc } from '../thesis/evidence-discovery';
import { IOLCP_EVENTS, IOLCP_SUMMARY } from './fixtures/zzz809-iolcp';

const SRC = 'Concall transcript Sep 2026';
const E = (variable: string, value_type: string, after: string, evidence_text: string, source = SRC, extra: any = {}) => ({
  variable, value_type, before: null, after, unit: null, period: null, direction: 'unknown', evidence_text, source,
  confidence: 'HIGH', evidence_quality: 'sentence', ...extra,
}) as any;

// ── Short excerpts of the transcript (verbatim) ────────────────────────────
const X_CURRENT_UT = 'And additionally, like our current capacity is exhausted up to the level of 90% to 95%.';
const X_TARGET_UT = 'But in FY28, I think around 25% utilization we can reach.';
const X_EXPAND = 'First, we are expanding our Ibuprofen capacity by 6,000 MTPA, taking our total capacity to 18,000 MTPA.';
const X_DEPLOY = 'Also, across the three initiatives, approximately INR495 crores of investment is being deployed.';
const X_INCURRED = 'Around 30% of overall funding requirements has already been incurred.';
const X_EA = 'Ethyl Acetate capacity increased to 1,20,000 MTPA Acetic Anhydride capacity increased to 32,000 MTPA.';
// A multi-turn excerpt: management answers, analyst questions, confirmations.
const X_CALL = [
  'Moderator: The next question comes from the line of Rishabh Malik with Artha Capital. Please go ahead.',
  'Rishabh Malik: But have Ibuprofen prices then accordingly fallen down, or are they still just where they were at the elevated levels?',
  'Abhay Raj Singh: So, the prices of various products were gone up during the war situation, so were the prices of the input materials also. And since peak, many products prices have softened down, but I think Ibu prices are more or less same. So, there is not much change in the prices of the Ibuprofen.',
  'Rishabh Malik: Okay. So, considering our company is completely backward integrated, so then we are looking at a probable margin expansion. Is that understanding correct?',
  'Abhay Raj Singh: Yes, that\'s correct.',
  'Moderator: The next question comes from the line of Shaikh Mohd Ayaz, an Individual Investor.',
  'Shaikh Mohd Ayaz: So, under those commitments, are we able to pass those fluctuations to the final customers?',
  'Abhay Raj Singh: Yes. And in every contract, we have a clause of price adjustment.',
  'Abhay Raj Singh: Collectively, these initiatives are expected to contribute an incremental 25% to around 30% to our top line over the coming years.',
  'Abhay Raj Singh: Generally, our pharmaceuticals investment has 1.75x to 2x top line.',
  'Rakesh Mahajan: As a company as a whole, we are expecting more about 15% ROCE when the -- all the project will be fully implemented.',
  'Abhay Raj Singh: So, we would like to maintain the financial guidance in the similar line what we\'ve given in the last call also, something around 15% to 20%.',
  'Kushal Kumar Rana: But, yes, considering our development with new customers in terms of API, we are forecasting some good volumes, that is why we have gone for this capacity.',
].join(' ');

const OUT = [
  { key: 'revenue_growth', label: 'Revenue growth', before: null, after: '+37%', delta: '+37%', verdict: 'improving', evidence: 'Revenue +37% YoY', source: 'grader', statement: 'ACTUAL' },
  { key: 'earnings_growth', label: 'Earnings growth', before: null, after: '+88.2%', delta: '+88.2%', verdict: 'improving', evidence: 'PAT +88%', source: 'grader', statement: 'ACTUAL' },
  { key: 'margin', label: 'Operating margin', before: '11.0%', after: '14.0%', delta: '+3.0pp', verdict: 'improving', evidence: 'OPM', source: 'grader', statement: 'ACTUAL' },
  { key: 'operating_leverage', label: 'Operating leverage', before: 'revenue +37%', after: 'earnings +88.2%', delta: '2.4×', verdict: 'improving', evidence: 'OL', source: 'grader', statement: 'ACTUAL' },
] as any[];
const IOLCP_GRADED = { sales_yoy_pct: 36.96, net_profit_yoy_pct: 88.24, pat_curr_cr: 64, pat_prev_cr: 34, opm_pct: 14, opm_prev_pct: 11, source: 'graded' };

describe('zzz809 · current vs target utilisation', () => {
  test('"current capacity is exhausted up to 90% to 95%" is CURRENT; "in FY28 … 25% we can reach" is a TARGET', () => {
    assert.equal(utilisationTense(X_CURRENT_UT), 'CURRENT');
    assert.equal(utilisationTense('Our existing facilities are operating at high utilization level of 92%.'), 'CURRENT');
    assert.equal(utilisationTense('The plant is currently running at 85% utilisation.'), 'CURRENT');
    assert.equal(utilisationTense(X_TARGET_UT), 'TARGET');
    assert.equal(utilisationTense('Optimal is more than 80%.'), 'TARGET');
    assert.equal(utilisationTense('We expect utilisation to reach 75% by FY28.'), 'TARGET');
    // Past tense is not a target: "improved to 80% in the quarter across the plants".
    assert.notEqual(utilisationTense('Capacity utilisation improved to 80% in the quarter across the eight plants.'), 'TARGET');
    assert.equal(utilisationLow('90% to 95%'), 90);
  });

  test('a current utilisation the model filed as guidance is re-typed ACTUAL; the ramp target stays forward and is never its plan', () => {
    const cur = normalizeEvent(E('utilisation', 'GUIDANCE', '90% to 95%', X_CURRENT_UT), 'Q1 FY27');
    assert.equal(cur.value_type, 'ACTUAL');
    assert.match(String(cur.retyped_because), /current utilisation/);
    const tgt = normalizeEvent(E('utilisation', 'GUIDANCE', '25%', X_TARGET_UT, SRC, { period: 'FY28' }), 'Q1 FY27');
    assert.equal(tgt.value_type, 'GUIDANCE');
    const vars = varsFromEvents([E('utilisation', 'GUIDANCE', '90% to 95%', X_CURRENT_UT), E('utilisation', 'GUIDANCE', '25%', X_TARGET_UT, SRC, { period: 'FY28' })], 'Q1 FY27');
    const u = vars.find((v) => v.key === 'utilisation')!;
    assert.equal(u.after, '90% to 95%');
    assert.equal(u.statement, 'ACTUAL');
    assert.equal(u.plan ?? null, null, 'a 25% ramp target of new capacity is not the plan for a plant at 90%');
    assert.match(u.evidence, /Separate guidance for the new capacity's ramp: 25%/);
  });

  test('A · OPERATING INFLECTION: current ≥80% with capacity being added SUPPORTS the thesis; a target, a low level or another thesis type does not', () => {
    const vars = (u: any, extra: any[] = []) => [...OUT, u,
      { key: 'capacity_addition', label: 'Capacity added', before: null, after: '6,000 MTPA (guidance)', delta: null, verdict: 'stated', evidence: X_EXPAND, source: 'filing', kind: 'claim', statement: 'GUIDANCE' }, ...extra] as any[];
    const u = { key: 'utilisation', label: 'Capacity utilisation', before: null, after: '90% to 95%', delta: null, verdict: 'stated', evidence: X_CURRENT_UT, source: 'filing', kind: 'fact', statement: 'ACTUAL' };
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true, variables: vars(u) });
    const row = a.checked.find((c) => c.key === 'utilisation')!;
    assert.equal(row.verdict, 'improving');
    assert.match(String(row.supports), /nearly full/);
    assert.ok(!['WEAKENING', 'BROKEN'].includes(a.status));
    // A target, a 60% level, or a B thesis: unchanged.
    const t = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true, variables: vars({ ...u, after: '90% (target)', statement: 'TARGET', kind: 'claim' }) });
    assert.notEqual(t.checked.find((c) => c.key === 'utilisation')!.verdict, 'improving');
    const low = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true, variables: vars({ ...u, after: '60%' }) });
    assert.notEqual(low.checked.find((c) => c.key === 'utilisation')!.verdict, 'improving');
    const noAdd = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true, variables: [...OUT, u] as any });
    assert.notEqual(noAdd.checked.find((c) => c.key === 'utilisation')!.verdict, 'improving', 'high utilisation alone, with nothing being added, is a level');
  });

  test('a capacity bottleneck is ✕ only when it is said to be costing sales or volumes', () => {
    assert.ok(!bottleneckHurtsSales('Existing Ibuprofen facilities operating at 90%-95% utilisation (implying capacity constraint).'));
    assert.ok(bottleneckHurtsSales('We were unable to meet demand and lost orders because the plant is full.'));
    assert.ok(bottleneckHurtsSales('Sales volumes were constrained by the kiln shutdown.'));
    const full = extractVariables(null, { capacity: { bottleneck: 'Existing Ibuprofen facilities operating at 90%-95% utilisation (implying capacity constraint).' } })
      .find((v) => v.key === 'capacity_bottleneck')!;
    assert.equal(full.verdict, 'stated');
    assert.match(full.evidence, /not stated to be costing sales or volumes/);
    const hurt = extractVariables(null, { capacity: { bottleneck: 'Capacity constraint — unable to meet demand; orders were turned away in the quarter.' } })
      .find((v) => v.key === 'capacity_bottleneck')!;
    assert.equal(hurt.verdict, 'deteriorating');
  });
});

describe('zzz809 · capacity figures', () => {
  test('"expanding … by 6,000 MTPA, taking total capacity to 18,000 MTPA" → 12,000 MTPA installed, derived and said so', () => {
    const d = deriveCurrentCapacity(X_EXPAND)!;
    assert.equal(d.current, '12,000 MTPA');
    assert.equal(d.product, 'Ibuprofen');
    assert.match(d.basis, /derived/);
    // Indian grouping is kept; a synthetic case in another unit.
    assert.equal(deriveCurrentCapacity('We are increasing our cement capacity by 2 MTPA, bringing total capacity to 12 MTPA.')!.current, '10 MTPA');
    assert.equal(deriveCurrentCapacity('We are adding capacity by 20,000 TPA, taking our total capacity to 1,20,000 TPA.')!.current, '1,00,000 TPA');
    // Never across units, never across sentences, never when total ≤ addition.
    assert.equal(deriveCurrentCapacity('We are expanding capacity by 6 MW, taking our total capacity to 18 MTPA.'), null);
    assert.equal(deriveCurrentCapacity('We are expanding our capacity by 6,000 MTPA. Total capacity to 18,000 MTPA is the plan.'), null);
    assert.equal(deriveCurrentCapacity('We are expanding capacity by 20,000 MTPA, taking our total capacity to 18,000 MTPA.'), null);
    // The post-expansion total is a plan, not installed capacity today.
    assert.ok(isPostExpansionTotal(X_EXPAND, '18,000 MTPA'));
    assert.equal(normalizeEvent(E('capacity', 'ACTUAL', '18,000 MTPA', X_EXPAND), 'Q1 FY27').value_type, 'TARGET');
  });

  test('each capacity figure belongs to its product', () => {
    assert.equal(productOfCapacity(X_EA, '1,20,000 MTPA'), 'Ethyl Acetate');
    assert.equal(productOfCapacity(X_EA, '32,000 MTPA'), 'Acetic Anhydride');
    assert.equal(productOfCapacity(X_EXPAND, '18,000 MTPA'), 'Ibuprofen');
    assert.equal(productOfCapacity('Commissioned new Paracetamol Unit-11 with installed capacity of 10,800 MTPA.', '10,800 MTPA'), 'Paracetamol');
    assert.equal(productOfCapacity('Management said installed capacity at the site is now 3.0 MW.', '3.0 MW'), null, 'no product named');
  });

  test('the installed row is the product being expanded; another product\'s figure is context, never a conflict and never its confirmation', () => {
    const vars = varsFromEvents([
      E('capacity_addition', 'ACTUAL', '6,000 MTPA', X_EXPAND),
      E('capacity', 'ACTUAL', '18,000 MTPA', X_EXPAND),
      E('capacity', 'ACTUAL', '1,20,000 MTPA', X_EA, 'Investor presentation Aug 2026'),
      E('capacity', 'ACTUAL', '120,000 MTPA', 'During the year, we successfully expanded Ethyl Acetate capacity to 120,000 MTPA and enhanced Acetic Anhydride capacity to 32,000 MTPA.', 'Annual Report 2026'),
    ], 'Q1 FY27');
    const cap = vars.find((v) => v.key === 'capacity')!;
    assert.equal(cap.after, '12,000 MTPA');
    assert.match(cap.label, /Ibuprofen/);
    assert.notEqual(cap.verdict, 'improving');
    assert.equal(cap.plan?.value, '18,000 MTPA');
    assert.match(String(cap.retyped), /derived/);
    assert.ok(!cap.conflict || !cap.conflict.some((c) => /1,?20,000/.test(c.value)), 'Ethyl Acetate is another product, not a disagreement');
    assert.match(cap.evidence, /Other product lines on file[^]*Ethyl Acetate/);
  });

  test('a 10× conflict for the same product across documents: neither is shown as confirmed', () => {
    assert.ok(powerOfTenApart(12_000, 120_000));
    assert.ok(powerOfTenApart(1_500, 150_000));
    assert.ok(!powerOfTenApart(12_000, 18_000));
    assert.ok(!powerOfTenApart(10_800, 120_000));
    const vars = varsFromEvents([
      E('capacity', 'ACTUAL', '12,000 MTPA', 'Our installed API capacity stands at 12,000 MTPA across the two plants.', 'Concall transcript Aug 2026'),
      E('capacity', 'ACTUAL', '1,20,000 MTPA', 'The installed API capacity increased to 1,20,000 MTPA across the two plants.', 'Investor presentation Aug 2026'),
    ], 'Q1 FY27');
    const cap = vars.find((v) => v.key === 'capacity')!;
    assert.equal(cap.verdict, 'stated');
    assert.match(String(cap.unjudged), /figures conflict across documents/);
    assert.match(cap.evidence, /figures conflict across documents/);
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true, variables: [...OUT, ...vars] as any });
    const row = a.checked.find((c) => c.key === 'capacity')!;
    assert.notEqual(row.verdict, 'improving');
    assert.equal(row.state, 'UNCLEAR');
  });
});

describe('zzz809 · capex: planned vs incurred', () => {
  test('"is being deployed" is the plan; "has already been incurred" is spend; the share is read, never a rupee figure', () => {
    assert.equal(capexAmountKind(X_DEPLOY), 'PLANNED');
    assert.equal(capexAmountKind('Three strategic growth initiatives, involving a proposed investment of approximately INR500 crores.'), 'PLANNED');
    assert.equal(capexAmountKind('We have spent INR120 crores so far on the new block.'), 'SPENT');
    assert.equal(capexAmountKind('The total capex for Q1 of FY27 was INR943 million, largely towards the new site.'), null);
    assert.deepEqual(incurredShare(X_INCURRED)?.pct, 30);
    assert.equal(incurredShare('As you say and we already disclosed that 30% of capex is already been done.')?.pct, 30);
    assert.equal(incurredShare('Exports were 30% of revenue in the quarter.'), null);
    const e = normalizeEvent(E('capex', 'ACTUAL', 'approximately INR495 crores', X_DEPLOY), 'Q1 FY27');
    assert.equal(e.value_type, 'GUIDANCE');
    assert.match(String(e.retyped_because), /plan, not money already spent/);
  });

  test('IOLCP capex: plan ₹495–500 Cr, about 30% incurred — never "Spent: ₹495 crores", never a computed rupee spend', () => {
    const ledger: any = { latest_period: 'Q1 FY27', latest_document_date: '2026-09-17', periods: { 'Q1 FY27': { events: IOLCP_EVENTS } } };
    const prog = capexProgramme(IOLCP_SUMMARY, ledger);
    assert.equal(prog.share?.pct, 30);
    assert.ok(prog.planned.some((p) => /495/.test(p)) && prog.planned.some((p) => /500/.test(p)), JSON.stringify(prog.planned));
    assert.ok(!prog.planned.some((p) => /350/.test(p)), 'one project inside the programme is not the programme');
    const vars = extractVariables(IOLCP_GRADED, { ...IOLCP_SUMMARY, events: IOLCP_EVENTS }, null, { period: 'Q1 FY27' });
    const chain = buildCapexChain({ ...IOLCP_SUMMARY, events: IOLCP_EVENTS }, vars, ledger);
    const lines = chain.earning.lines.join(' | ');
    assert.doesNotMatch(lines, /Spent: approximately INR495 crores/);
    assert.match(lines, /Spent: about 30% of the planned programme/);
    assert.match(lines, /rupee amount spent is not stated/);
    assert.doesNotMatch(lines, /148|149|150(?!\d)/, 'no rupee spend is computed from 30% × plan');
  });
});

describe('zzz809 · projects', () => {
  const ledger: any = { latest_period: 'Q1 FY27', latest_document_date: '2026-09-17', periods: { 'Q1 FY27': { events: IOLCP_EVENTS } } };

  test('all three named initiatives are counted — a project with no amount yet is announced, not dropped', () => {
    const vars = extractVariables(IOLCP_GRADED, { ...IOLCP_SUMMARY, events: IOLCP_EVENTS }, null, { period: 'Q1 FY27' });
    const chain = buildCapexChain({ ...IOLCP_SUMMARY, events: IOLCP_EVENTS }, vars, ledger);
    const named = (chain.lifecycleProjects || []).filter((p) => p.name !== 'Capacity and capex not tied to a named project');
    assert.equal(named.length, 3, named.map((p) => p.name).join(', '));
    assert.equal(chain.build?.projects.length, 3);
    assert.match(String(chain.earning.operational), /Ibuprofen expansion — under construction/);
    assert.match(String(chain.earning.operational), /Specialty chemical tolling facility — announced/);
    assert.doesNotMatch(String(chain.earning.operational), /^2 projects/);
  });

  test('established + EU-GMP certified + commercialisation in Q3 FY27 is "built — commercial start", not a conflict', () => {
    assert.equal(commercialStartOf('commissioned', 'commercialization expected Q3 FY27'), 'Q3 FY27');
    assert.equal(commercialStartOf('under_construction', 'commercialization expected Q3 FY27'), null);
    assert.equal(commercialStartOf('commissioned', 'by December 2027'), null);
    const vars = extractVariables(IOLCP_GRADED, { ...IOLCP_SUMMARY, events: IOLCP_EVENTS }, null, { period: 'Q1 FY27' });
    const chain = buildCapexChain({ ...IOLCP_SUMMARY, events: IOLCP_EVENTS }, vars, ledger);
    const cdmo = chain.lifecycleProjects!.find((p) => /CDMO/.test(p.name))!;
    assert.equal(cdmo.statusConflict ?? null, null);
    assert.equal(cdmo.statusNote, 'built & EU-GMP certified — commercial start Q3 FY27');
    assert.doesNotMatch(JSON.stringify(chain), /conflicts with its stated completion|validation required/);
  });
});

describe('zzz809 · price, margin driver and volume in words', () => {
  const ev = transcriptCommentary(X_CALL, SRC);

  test('price and margin statements are captured as management commentary (◐), never as figures', () => {
    const price = ev.filter((e) => e.variable === 'price');
    assert.ok(price.some((e) => /Ibu prices are more or less same|not much change in the prices of the Ibuprofen/.test(String(e.after))), JSON.stringify(price.map((e) => e.after)));
    assert.ok(price.some((e) => /clause of price adjustment/.test(String(e.after))));
    for (const e of price) { assert.equal(e.value_type, 'MANAGEMENT_CLAIM'); assert.ok(e.qualitative); }
    // The analyst's question on its own is not evidence.
    assert.ok(!price.some((e) => /have Ibuprofen prices then accordingly fallen down/.test(e.evidence_text) && !/more or less/.test(e.evidence_text)));
    const margin = ev.filter((e) => e.variable === 'margin_driver');
    const conf = margin.find((e) => /probable margin expansion/.test(String(e.after)))!;
    assert.ok(conf, 'the analyst\'s reading, confirmed by management, is captured');
    assert.match(String(conf.after), /put to management and confirmed/);
    assert.match(conf.evidence_text, /Yes, that's correct/);

    const vars = varsFromEvents(ev as any, 'Q1 FY27');
    for (const k of ['price', 'margin_driver']) {
      const row = vars.find((v) => v.key === k)!;
      assert.equal(row.kind, 'claim', k);
      assert.equal(row.statement, 'MANAGEMENT_STATEMENT', k);
      assert.equal(row.verdict, 'stated', k);
      assert.equal(row.fact_type, 'MANAGEMENT_COMMENTARY', k);
    }
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true, variables: [...OUT, ...vars] as any });
    for (const k of ['price', 'margin_driver']) {
      const c = a.checked.find((x) => x.key === k)!;
      assert.equal(c.verdict, 'stated', `${k} is not confirmed by words`);
      assert.notEqual(c.state, 'UNCLEAR', `${k} is commentary, not "validation required"`);
    }
  });

  test('volume stays qualitative — never a figure', () => {
    const vol = ev.filter((e) => e.variable === 'volume');
    assert.equal(vol.length, 1);
    assert.doesNotMatch(String(vol[0].after), /\d/);
    const row = varsFromEvents(ev as any, 'Q1 FY27').find((v) => v.key === 'volume')!;
    assert.equal(row.verdict, 'stated');
    assert.equal(row.kind, 'claim');
  });

  test('stored readings: price remarks in the pricing-power / raw-material fields fill the price row as commentary', () => {
    const v = extractVariables(null, IOLCP_SUMMARY).find((x) => x.key === 'price')!;
    assert.equal(v.statement, 'MANAGEMENT_STATEMENT');
    assert.equal(v.verdict, 'stated');
    assert.match(String(v.after), /price adjustment clauses/);
  });
});

describe('zzz809 · forward guidance lines', () => {
  test('incremental revenue %, asset turn, ROCE and growth guidance are captured as guidance lines', () => {
    const lines = transcriptCommentary(X_CALL, SRC).filter((e) => e.guidance_line);
    const text = lines.map((e) => e.after).join(' | ');
    assert.match(text, /Incremental revenue from the new capacity: 25% to around 30%/);
    assert.match(text, /Asset turn \(revenue ÷ investment\): 1\.75x to 2x/);
    assert.match(text, /Company ROCE when the projects are implemented: about 15%/);
    assert.match(text, /Revenue growth guidance: 15% to 20%/);
    for (const e of lines) assert.equal(e.value_type, 'GUIDANCE');
  });

  test('the guidance row carries the lines; the stored summary\'s targets ride on it too', () => {
    const ev = transcriptCommentary(X_CALL, SRC);
    const v = extractVariables(IOLCP_GRADED, { guidance: { action: 'maintained', detail: 'Revenue Growth 15%-20%', period: 'FY27' }, events: ev }, null, { period: 'Q1 FY27' });
    const g = v.find((x) => x.key === 'guidance')!;
    assert.equal(g.after, 'maintained');
    assert.ok((g.forwardLines || []).some((l) => /ROCE/.test(l)));
    const stored = forwardGuidanceLines(null, IOLCP_SUMMARY);
    assert.ok(stored.some((l) => /incremental 25%-30%/.test(l)), JSON.stringify(stored));
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true, variables: v });
    assert.ok((a.checked.find((c) => c.key === 'guidance')!.forwardLines || []).length > 0);
  });
});

describe('zzz809 · no invented figures', () => {
  test('every figure a commentary event prints is in its own evidence sentence', () => {
    const nums = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/,/g, ''));
    for (const e of transcriptCommentary(X_CALL, SRC)) {
      const evNums = nums(e.evidence_text.replace(/\s+x\b/g, 'x'));
      for (const n of nums(String(e.after))) assert.ok(evNums.includes(n), `${n} in "${e.after}" is not in "${e.evidence_text}"`);
    }
  });

  test('a derived figure says it is derived; the incurred share never becomes a rupee number', () => {
    const d = deriveCurrentCapacity(X_EXPAND)!;
    assert.match(d.basis, /18,000 MTPA − 6,000 MTPA/);
    const sh = incurredShare(X_INCURRED)!;
    assert.deepEqual(Object.keys(sh).sort(), ['pct', 'quote']);
  });
});

describe('zzz809 · IOLCP card, end to end (stored ledger fixture)', () => {
  test('the eight wrong lines now read correctly; status is decided by the existing rules', () => {
    const summary = { ...IOLCP_SUMMARY, events: IOLCP_EVENTS };
    const vars = extractVariables(IOLCP_GRADED, summary, null, { period: 'Q1 FY27' });
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, indiaDisclosure: true, variables: vars,
      evidencePeriod: 'Q1 FY27', expectedPeriod: 'Q1 FY27' });
    const row = (k: string) => a.checked.find((c) => c.key === k)!;
    // ✓ Installed capacity 120,000 MTPA → the product being expanded, a derived level.
    assert.equal(row('capacity').after, '12,000 MTPA');
    assert.notEqual(row('capacity').verdict, 'improving');
    // ◐ utilisation "target only" → current, supporting.
    assert.equal(row('utilisation').after, '90% to 95%');
    assert.equal(row('utilisation').statement, 'ACTUAL');
    assert.equal(row('utilisation').verdict, 'improving');
    // ✕ capacity bottleneck → shown, not against the thesis.
    assert.notEqual(row('capacity_bottleneck').verdict, 'deteriorating');
    // ? Price NOT DISCLOSED → management commentary.
    assert.equal(row('price').verdict, 'stated');
    assert.equal(row('price').statement, 'MANAGEMENT_STATEMENT');
    // Nothing thesis-critical moved the wrong way.
    assert.ok(!a.checked.some((c) => c.verdict === 'deteriorating'), a.checked.filter((c) => c.verdict === 'deteriorating').map((c) => c.key).join(','));
    assert.ok(!['WEAKENING', 'BROKEN'].includes(a.status), a.status);
    // STRENGTHENING needs two distinct evidenced drivers or the full A gate
    // (volume is not disclosed): it is not forced.
    assert.notEqual(a.status, 'STRENGTHENING');
    assert.equal(a.verdict?.coverage.confirmed, 1);
  });
});

describe('zzz809 · discovery picks up a Reg 30 business-update transcript', () => {
  test('a BSE row whose subject is only the category is classified by its headline', () => {
    const c = candidatesFromBse([{
      NEWSSUB: 'Analysts/Institutional Investor Meet/Con. Call Updates',
      HEADLINE: 'Transcript of Business Update Call with Investors and Analysts held on 11th September 2026',
      NEWS_DT: '2026-09-17T18:20:00', CATEGORYNAME: 'Company Update', ATTACHMENTNAME: '7912f1a3-c48a-4865-b87e-9fb39f63bbfc.pdf', PDFFLAG: 0,
    }]);
    assert.equal(c.length, 1);
    assert.equal(c[0].kind, 'transcript');
    assert.match(c[0].label, /Transcript of Business Update Call/);
    assert.equal(c[0].dateIso?.slice(0, 10), '2026-09-17');
  });

  test('transcripts of business-update, investor and analyst calls are transcripts; an intimation that one will be available is not', () => {
    assert.equal(classifyExchangeDoc('Transcript of Business Update Call', 'x.pdf'), 'transcript');
    assert.equal(classifyExchangeDoc('Analyst Meet - Transcript', 'x.pdf'), 'transcript');
    assert.equal(classifyExchangeDoc('Investor Call Transcript', 'x.pdf'), 'transcript');
    assert.notEqual(classifyExchangeDoc('Intimation of Investor Call - transcript will be made available on the website', 'x.pdf'), 'transcript');
  });
});
