// zzz788 — the owner's latest Portfolio Catalysts QA:
//   1 a silent check is UNKNOWN, never "check passes" (one invariant)
//   2 near-miss count and its list reconcile; each button names its list
//   3 "eligible" theses in Research priority
//   4 Special Focus reads the latest normalized figure (₹2,600 Cr) and shows
//     the thesis status beside the catalyst, never merged
//   5 unused capacity is not persistence (FCL / EXICOM → candidate)
//   6 capacity headroom is labelled as headroom, never runway
//   7 OUTPUT CHECK · observed
// Run: npx tsx --test src/lib/__tests__/zzz788.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { assessThesis, MECH_STATE_WORD, tallyPartitionSum } from '../thesis/status';
import { SILENT_CHECK_WORD, NONE_STATED_WORD, silentCountWord, explicitNoneStated, isSilentCheck, checkPasses, silentCheckState } from '../thesis/silent-check';
import { ThesisCard, rowTreatment, treatmentWord, outputCountWord, ROW_TREATMENT } from '../../components/thesis-card';
import { researchPriorityTitle, researchPriorityEligible } from '../thesis/evidence-counts';
import { detectPersistentCatalysts, rupeeCr, persistenceWords, catalystThesisLine, demandContinuation } from '../catalyst/persistence';
import { nearMissList, focusButtonWords, specialFocusQueue } from '../catalyst/cross-view';

const ROOT = join(__dirname, '..', '..', '..');
const V = (key: string, verdict: string, o: { after?: string; delta?: string; source?: 'grader' | 'filing'; kind?: string; before?: string } = {}) => ({
  key, label: key, before: o.before ?? null, after: o.after ?? (verdict === 'stated' ? '1' : null), delta: o.delta ?? null,
  verdict, evidence: `${key} evidence`, source: o.source ?? 'filing', kind: o.kind ?? 'fact',
}) as any;
const GOOD_OUTPUT = [
  V('revenue_growth', 'improving', { delta: '+30%', source: 'grader' }),
  V('earnings_growth', 'improving', { delta: '+45%', source: 'grader' }),
  V('margin', 'improving', { delta: '+2.0pp', source: 'grader' }),
];
const F_BASE = [...GOOD_OUTPUT, V('margin_driver', 'improving', { after: 'mix and scale' }), V('volume', 'improving', { after: '+9%' }),
  V('cash_conversion', 'improving', { after: '1.4×', delta: '+0.3×', source: 'grader' })];
const R = (x: any) => assessThesis({ pattern: null, variables: [], evidenceReviewed: true, hasGraderRow: true, ...x });
const render = (a: any, sym = 'CYIENTDLM') => {
  (globalThis as any).React = React;
  return renderToStaticMarkup(React.createElement(ThesisCard as any, { symbol: sym, market: 'IN', assessment: a, defaultOpen: true })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
};

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz788 · 1 — a silent check is UNKNOWN, never passed (one invariant)', () => {
  test('the helper: silence → "NOT DISCLOSED · unknown"; only an explicit "none" passes', () => {
    assert.equal(SILENT_CHECK_WORD, 'NOT DISCLOSED · unknown');
    assert.equal(silentCountWord(1), '1 silent (unknown, not a reading)');
    assert.equal(isSilentCheck({ verdict: 'flat', silence: true, readings: 0 }), true);
    assert.equal(checkPasses({ verdict: 'flat', silence: true, readings: 0 }), false, 'silence never passes');
    assert.equal(silentCheckState({ verdict: 'flat', silence: true }), 'unknown');
    for (const t of ['No exceptional items during the quarter', 'There were no one-off items', 'Exceptional items: nil', 'None']) {
      assert.equal(explicitNoneStated(t), true, t);
      assert.equal(checkPasses({ verdict: 'flat', readings: 1, after: t }), true, t);
    }
    for (const t of ['exceptional gain of ₹25.83 Cr', 'tariff refund ₹4 Cr', '', null]) assert.equal(explicitNoneStated(t as any), false, String(t));
  });

  test('the row: CYIENTDLM / MOREPENLAB "One-offs · none disclosed · check passes" → "One-offs · NOT DISCLOSED · unknown"', () => {
    const tr = rowTreatment({ key: 'one_offs', verdict: 'flat' as any, state: 'FOUND', after: null, before: null });
    assert.equal(tr, 'SILENT');
    assert.equal(treatmentWord(tr, { verdict: 'flat' as any }), 'NOT DISCLOSED · unknown');
    assert.doesNotMatch(ROW_TREATMENT.SILENT.word, /pass/i);
    const said = rowTreatment({ key: 'one_offs', verdict: 'flat' as any, state: 'FOUND', after: 'No exceptional items during the quarter' });
    assert.equal(said, 'NONE_STATED');
    assert.equal(ROW_TREATMENT.NONE_STATED.word, NONE_STATED_WORD);
    assert.match(NONE_STATED_WORD, /check passes/);
  });

  test('the verdict: silent one-offs never clear the F gate — not STRENGTHENING (unknown ≠ positive), not WEAKENING (unknown ≠ negative)', () => {
    const silent = R({ pattern: 'F', variables: F_BASE });
    const oo = silent.checked.find((c) => c.key === 'one_offs')!;
    assert.equal(oo.silence, true);
    assert.equal(silent.structural.gatePassed, false);
    assert.ok(silent.structural.missingRequired.includes(oo.label));
    assert.notEqual(silent.status, 'STRENGTHENING');
    assert.notEqual(silent.status, 'WEAKENING');
    assert.notEqual(silent.status, 'EVIDENCE_INCOMPLETE', 'silence after a read is not an evidence gap either');
    assert.match(silent.because, /one-offs \(NOT DISCLOSED · unknown/);
    assert.doesNotMatch(`${silent.because} ${oo.evidence}`, /check passes|check passing|passes, not a reading|none disclosed in the documents read/);
    // An explicit "none" from the company is the ONLY way the check passes.
    const said = R({ pattern: 'F', variables: [...F_BASE, V('one_offs', 'flat', { after: 'No exceptional items during the quarter' })] });
    assert.equal(said.structural.gatePassed, true);
    assert.equal(said.status, 'STRENGTHENING', said.because);
    assert.match(said.because, /one-offs none stated by the company — check passes/);
  });

  test('the counts: silence is its own bucket — never passed, flat or confirmed — and the partition still sums', () => {
    const a = R({ pattern: 'F', variables: F_BASE });
    for (const t of [a.coverage.mechanism, a.coverage.structural!]) {
      assert.equal(t.silent, 1);
      assert.equal(tallyPartitionSum(t), t.total);
      assert.ok(!(t.named?.confirmed || []).some((x) => /one-offs/i.test(x)));
    }
    assert.equal(a.coverage.mechanism.flat, 0);
    assert.deepEqual(a.coverage.structural!.named!.silent, ['One-offs']);
    assert.match(MECH_STATE_WORD.silent, /NOT DISCLOSED — unknown/);
    assert.doesNotMatch(MECH_STATE_WORD.silent, /pass/);
  });

  test('NO MATERIAL CHANGE names a silent thesis-critical check as UNKNOWN', () => {
    const F2 = (key: string, before: string, after: string, source?: 'grader' | 'filing') => ({ ...V(key, 'flat', { after, source }), before, delta: 'FLAT' });
    const a = R({ pattern: 'B', variables: [
      F2('order_book', '₹1,200 Cr', '₹1,200 Cr'), F2('book_to_bill', '1.0', '1.0'), F2('order_intake', '₹300 Cr', '₹300 Cr'),
      F2('capacity', '40,000 t', '40,000 t'), F2('margin', '14%', '14%', 'grader'), F2('revenue_visibility', '2.1 years', '2.1 years'),
      V('revenue_growth', 'flat', { after: '+2%', delta: '+2%', source: 'grader' }),
    ] });
    assert.match(a.because, /NOT DISCLOSED · unknown — silence, not a reading: execution delay/);
  });

  test('the card: "1 silent (unknown, not a reading)" and the row word — never "check passes"', () => {
    const html = render(R({ pattern: 'F', variables: F_BASE }));
    assert.match(html, /1 silent \(unknown, not a reading\)/);
    assert.match(html, /NOT DISCLOSED · unknown/);
    assert.doesNotMatch(html, /check passes|passes, not a reading|none disclosed · check/);
  });

  test('grep: no source file still says a silent check passes', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/__tests__|node_modules/.test(p)) walk(p); } else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
    walk(join(ROOT, 'src'));
    // silent-check.ts quotes the old wording in its header, as the record of what was wrong.
    for (const f of files.filter((x) => !/silent-check\.ts$/.test(x))) {
      const s = readFileSync(f, 'utf8');
      assert.doesNotMatch(s, /none disclosed · check passes|passes, not a reading|silence passes the gate|For this variable that is the check passing/, f);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz788 · 2 — near-miss count and list reconcile', () => {
  const mk = (ticker: string, kind: string, o: Partial<{ nearMiss: boolean; specialFocus: boolean; confidence: string; state: string }> = {}) => ({
    id: `${ticker}:${kind}`, ticker, kind, label: kind, mechanism: 'm', state: o.state || 'VALIDATED', confidence: o.confidence || 'EARLY', runway: { ok: false, text: '' },
    evidence: [], forward: [], beforeAfter: [], happened: [], notYet: [], nextMilestone: null, confirmWith: '', invalidateIf: '', duration: '', firstEvidenceDate: null,
    latestEvidenceDate: null, freshness: 'CURRENT', periods: [], hardCount: 2, distinctMetrics: 2, temporarySignals: [], origins: ['portfolio'], specialFocus: !!o.specialFocus,
    stage: '', nextEvidence: null, managementTarget: null, sourceQuality: '', why: [], toQualify: ['x'], nearMiss: !!o.nearMiss,
  }) as any;
  test('the button count is the length of the SAME list the rows render; queue names are excluded and counted; each button names its list', () => {
    const live = new Map<string, { pc: any; row: any }>();
    const add = (pc: any) => live.set(pc.id, { pc, row: { symbol: pc.ticker } });
    // 29 live near-miss mechanisms over 27 companies (two companies have two), one company also in Special Focus.
    for (let i = 0; i < 27; i++) add(mk(`N${i}`, 'CAPACITY_RAMP', { nearMiss: true }));
    add(mk('N0', 'ORDER_VISIBILITY', { nearMiss: true })); add(mk('N1', 'CUSTOMER_RAMP', { nearMiss: true }));
    add(mk('SF1', 'ORDER_VISIBILITY', { specialFocus: true, confidence: 'HIGH' })); add(mk('SF1', 'CAPACITY_RAMP', { nearMiss: true }));
    const q = specialFocusQueue(live as any, {}, () => null);
    const { near, excludedInQueue, mechanisms } = nearMissList(live as any, q.entries);
    assert.equal(near.length, 27, 'one line per company');
    assert.equal(mechanisms, 29, 'mechanisms counted separately, never printed as the company count');
    assert.equal(excludedInQueue, 1);
    const w = focusButtonWords(q.entries.length, near.length);
    assert.equal(w.near, '27 near misses — one piece of evidence away (not in Special Focus)');
    assert.equal(w.all, 'Show all 1 Special Focus');
    assert.ok(near.every((x) => x.pc.ticker !== 'SF1'));
  });
  test('the panel uses nearMissList for both the count and the rows', () => {
    const src = readFileSync(join(ROOT, 'src/components/special-focus-panel.tsx'), 'utf8');
    assert.match(src, /nearMissList<FocusRow>\(live, onLists\)/ /* zzz823: entries still on your lists */);
    assert.match(src, /focusButtonWords\(shown\.length, near\.length\)\.near/);
    assert.match(src, /focusButtonWords\(shown\.length, near\.length\)\.all/);
    assert.doesNotMatch(src, /`Show all \$\{shown\.length\}`/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz788 · 3 — Research priority says "eligible"', () => {
  test('"71 eligible theses" — strengthening / on-track only', () => {
    // zzz790: the title also says what the list is for (research allocation, not a buy list, no price).
    assert.equal(researchPriorityTitle(71), 'Research priority — 71 eligible theses ranked by evidenced catalyst — research allocation only, not a buy list, no price used');
    assert.equal(researchPriorityTitle(1), 'Research priority — 1 eligible thesis ranked by evidenced catalyst — research allocation only, not a buy list, no price used');
    assert.ok(researchPriorityEligible('STRENGTHENING') && researchPriorityEligible('ON_TRACK'));
    for (const s of ['NEUTRAL', 'CONFIRMATION_REQUIRED', 'WEAKENING', 'THESIS_NOT_SET', null]) assert.equal(researchPriorityEligible(s as any), false, String(s));
    const page = readFileSync(join(ROOT, 'src/app/(dashboard)/portfolio-catalysts/page.tsx'), 'utf8');
    assert.doesNotMatch(page, /intact theses ranked by evidenced catalyst/);
    assert.match(page, /researchPriorityTitle\(ranked\.length\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
let n = 0;
const fact = (period: string, metric: string, after: string, o: Partial<{ before: string; stmt: string; date: string; quote: string; source: string }> = {}) => ({
  id: `z${n++}`, ticker: 'T', reporting_period: period, evidence_type: o.stmt === 'TARGET' || o.stmt === 'GUIDANCE' ? 'forward' : 'mechanism',
  metric_name: metric, metric_label: metric, value: after, before_value: o.before ?? null, after_value: after, unit: null, delta: null, direction: 'up',
  source_document_id: null, source_name: o.source || `Concall ${period}`, source_date: o.date || '2026-08-01', source_type: 'transcript', source_quote: o.quote || `we ${metric} ${after}`,
  fact_or_management_statement: o.stmt || 'FACT', confidence: 'HIGH', evidence_quality: 'sentence', extracted_at: '', updated_at: '', record_status: 'ACTIVE',
});
const ledger = (periods: Record<string, any[]>, latestDate = '2026-08-01') => ({ latest_period: Object.keys(periods).pop(), latest_document_date: latestDate,
  periods: Object.fromEntries(Object.entries(periods).map(([p, facts]) => [p, { reporting_period: p, facts, summary: null }])) });

describe('zzz788 · 4 — Special Focus baseline = the card\'s latest normalized figure; thesis beside the catalyst', () => {
  test('money is printed in the card\'s format; digits are the document\'s', () => {
    assert.equal(rupeeCr('INR2,598 crores'), '₹2,598 Cr');
    assert.equal(rupeeCr('Rs.950 crores'), '₹950 Cr');
    assert.equal(rupeeCr('INR26 billion in Q1 FY27'), '₹2,600 Cr');
    assert.equal(rupeeCr('approximately INR280 crores'), 'approximately ₹280 Cr');
    assert.equal(rupeeCr('₹ 1,400 Cr'), '₹1,400 Cr');
    assert.equal(rupeeCr('USD 30 million'), 'USD 30 million', 'never converted at a guessed rate');
    assert.equal(rupeeCr('26 billion'), '26 billion', 'no currency, no conversion');
  });
  test('CYIENTDLM: ledger INR2,598 crores + the card\'s latest "INR26 billion in Q1 FY27" → ₹2,600 Cr; next evidence "above ₹2,600 Cr, with revenue conversion"', () => {
    const l = ledger({ 'Q1 FY27': [
      fact('Q1 FY27', 'order_book', 'INR2,598 crores', { date: '2026-04-27' }),
      fact('Q1 FY27', 'order_book', 'INR2,598 crores', { date: '2026-07-01' }),
      fact('Q1 FY27', 'order_intake', 'INR551.9 crores', { date: '2026-07-01' }),
      fact('Q1 FY27', 'book_to_bill', '1.5x', { date: '2026-07-01' }),
    ] }, '2026-07-24');
    const assessment = { status: 'WEAKENING', mechanismEvidence: [{ key: 'order_book', text: 'order book INR26 billion in Q1 FY27' }],
      checked: [{ key: 'working_capital', label: 'working-capital days', verdict: 'deteriorating', watch: false, historical: null }] };
    const pc = detectPersistentCatalysts({ ticker: 'CYIENTDLM', ledger: l, assessment, origin: 'portfolio', today: '2026-09-24', quarterRevenueCr: 380 })
      .find((p) => p.kind === 'ORDER_VISIBILITY')!;
    assert.match(pc.mechanism, /^order book ₹2,600 Cr/);
    assert.equal(pc.nextEvidence, 'Next disclosed order book above ₹2,600 Cr, with revenue conversion');
    assert.doesNotMatch(`${pc.mechanism} ${pc.runway.text} ${pc.nextEvidence} ${pc.happened.join(' ')}`, /INR2,598|INR26 billion/);
    // Validated catalyst + weakening thesis: side by side, never merged.
    assert.equal(catalystThesisLine(pc, assessment), 'Catalyst: validated · Thesis: weakening (working capital)');
    assert.equal(assessment.status, 'WEAKENING', 'the persistence layer never changes the thesis status');
  });
  test('the latest disclosure of a figure wins over an earlier one of the same figure', () => {
    const l = ledger({ 'Q4 FY26': [fact('Q4 FY26', 'order_book', '₹2,598 Cr', { date: '2026-05-01' })], 'Q1 FY27': [fact('Q1 FY27', 'order_book', '₹2,600 Cr', { date: '2026-08-01' }), fact('Q1 FY27', 'book_to_bill', '1.4x')] });
    const pc = detectPersistentCatalysts({ ticker: 'T', ledger: l, origin: 'portfolio', today: '2026-09-24' }).find((p) => p.kind === 'ORDER_VISIBILITY')!;
    assert.match(pc.mechanism, /^order book ₹2,600 Cr/);
  });
  test('the Special Focus card prints the thesis line', () => {
    const src = readFileSync(join(ROOT, 'src/components/special-focus-panel.tsx'), 'utf8');
    assert.match(src, /data-testid="sf-thesis-line"[^>]*>\{catalystThesisLine\(pc, e\.row\?\.assessment\)\}/);
    assert.equal(catalystThesisLine({ state: 'VALIDATED' }, { status: 'ON_TRACK' }), 'Catalyst: validated · Thesis: on track');
    assert.equal(catalystThesisLine({ state: 'VALIDATED' }, { status: 'THESIS_NOT_SET' }), 'Catalyst: validated · Thesis: not set');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
const capOf = (facts: any[], extra: any = {}) => detectPersistentCatalysts({ ticker: 'T', ledger: ledger({ 'Q1 FY27': facts }), origin: 'portfolio', today: '2026-09-24', ...extra }).find((p) => p.kind === 'CAPACITY_RAMP')!;
describe('zzz788 · 5/6 — unused capacity is headroom, not persistence', () => {
  test('FCL: 80,000 → 148,000 MTPA, commissioned, utilisation 63% → "Capacity ramp · Evidence validated · Persistence: candidate", not Special Focus', () => {
    const pc = capOf([
      fact('Q1 FY27', 'capacity', '1,48,000 MTPA', { before: '80,000 MTPA', quote: 'installed capacity expanded from 80,000 MTPA to 1,48,000 MTPA' }),
      fact('Q1 FY27', 'utilisation', '63%', { quote: 'capacity utilisation was 63%' }),
      fact('Q1 FY27', 'capex_status', 'Texas capacity expansion commissioned', { quote: 'the Texas capacity expansion was commissioned' }),
    ]);
    assert.equal(persistenceWords(pc).line, 'Capacity ramp · Evidence validated · Persistence: candidate');
    assert.equal(pc.specialFocus, false);
    assert.notEqual(pc.confidence, 'HIGH');
    assert.equal(pc.runway.ok, false);
    assert.equal(pc.headroom, 'Capacity headroom: Utilisation 63% — 37 percentage points available on the current installed-capacity basis.');
    assert.doesNotMatch(pc.runway.text, /headroom —|can still contribute/);
  });
  test('EXICOM: 3x added, commissioned, 65%, an order book LEVEL (≈1.1× revenue, no growth) → candidate; the headroom sentence is the owner\'s', () => {
    const pc = capOf([
      fact('Q1 FY27', 'capacity_addition', '3x', { quote: 'we have added 3x capacity at Hyderabad' }),
      fact('Q1 FY27', 'utilisation', '65%', { quote: 'capacity utilisation of 65%' }),
      fact('Q1 FY27', 'commissioning', 'Hyderabad plant commissioned', { quote: 'Hyderabad plant commissioned' }),
      fact('Q1 FY27', 'order_book', 'INR1,400 crores'), fact('Q1 FY27', 'order_intake', 'INR85 crores'), fact('Q1 FY27', 'order_intake', 'INR700 crores'),
    ], { quarterRevenueCr: 320 });
    assert.equal(persistenceWords(pc).persistence, 'Persistence: candidate');
    assert.equal(pc.specialFocus, false);
    assert.equal(pc.headroom, 'Capacity headroom: Utilisation 65% — 35 percentage points available on the current installed-capacity basis.');
    assert.equal(pc.continuation, null);
    assert.ok(pc.nearMiss, 'a near miss: one piece of continuation evidence away');
    assert.ok(pc.toQualify.some((q) => /continuation evidence/.test(q)));
  });
  test('INNOVACAP / HAPPYFORGE shape: recurring volume growth is continuation → stays HIGH and Special Focus; headroom still said as headroom', () => {
    const pc = capOf([
      fact('Q1 FY27', 'capacity_addition', '4,000 tons', { quote: 'We added 4,000 tons of capacity.' }),
      fact('Q1 FY27', 'utilisation', '59%', { quote: 'The capacity utilization stood at 59%.' }),
      fact('Q1 FY27', 'volume', 'volume grew 23.1% YoY'),
    ]);
    assert.equal(pc.confidence, 'HIGH');
    assert.ok(pc.specialFocus, pc.why.join(' | '));
    assert.match(pc.runway.text, /^Continuation evidence: recurring volume growth/);
    assert.match(pc.headroom || '', /^Capacity headroom: Utilisation 59% — 41 percentage points available/);
  });
  test('BDL / GOPAL shape: capacity plus a continuing order book (≥1.5× revenue, or growing) is continuation → high', () => {
    const pc = capOf([
      fact('Q1 FY27', 'capacity', '5,000 units', { before: '3,000 units', quote: 'capacity expanded from 3,000 units to 5,000 units' }),
      fact('Q1 FY27', 'utilisation', '70%', { quote: 'capacity utilisation 70%' }),
      fact('Q1 FY27', 'order_book', '₹20,000 Cr', { before: '₹16,000 Cr', quote: 'order book grew to ₹20,000 Cr from ₹16,000 Cr' }),
    ], { quarterRevenueCr: 800 });
    assert.equal(pc.runway.ok, true);
    assert.match(pc.continuation || '', /order book growing ₹16,000 Cr → ₹20,000 Cr/);
    assert.ok(['HIGH', 'MEDIUM'].includes(pc.confidence));
    assert.ok(pc.specialFocus, pc.why.join(' | '));
  });
  test('headroom never counts as runway on its own, in any grade; "Runway:" is reserved for continuation', () => {
    for (const u of ['40%', '65%', '79%']) {
      const pc = capOf([fact('Q1 FY27', 'capacity_addition', '10,000 MTPA', { quote: 'we added 10,000 MTPA' }), fact('Q1 FY27', 'utilisation', u, { quote: `capacity utilisation ${u}` })]);
      assert.equal(pc.runway.ok, false, u);
      assert.ok(pc.confidence === 'EARLY', `${u}: ${pc.confidence}`);
      assert.match(pc.headroom || '', /^Capacity headroom: /);
      assert.doesNotMatch(pc.runway.text, /percentage points/);
    }
    assert.equal(demandContinuation([]), null);
  });
  test('the Special Focus card prints evidence and persistence apart, and headroom on its own line', () => {
    const src = readFileSync(join(ROOT, 'src/components/special-focus-panel.tsx'), 'utf8');
    assert.match(src, /persistenceWords\(pc\)\.evidence/);
    assert.match(src, /persistenceWords\(pc\)\.persistence/);
    assert.match(src, /data-testid="sf-headroom"/);
    assert.doesNotMatch(src, /CONFIDENCE_LABEL\[/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz788 · 7 — OUTPUT CHECK · observed', () => {
  test('the output row is a check: "OUTPUT CHECK — 3 core · 3 observed"', () => {
    assert.equal(outputCountWord('OUTPUT CHECK'), 'observed');
    assert.equal(outputCountWord('MECHANISM'), 'confirmed');
    const html = render(R({ pattern: 'F', variables: F_BASE }));
    assert.match(html, /OUTPUT CHECK 3 core · 3 observed/);
    assert.doesNotMatch(html, /OUTPUT 3 core · 3 confirmed/);
  });
});
