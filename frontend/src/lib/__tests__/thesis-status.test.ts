// ═══════════════════════════════════════════════════════════════════════════
// zzz765c — STRUCTURAL vs OUTPUT, STATUS SENTENCES, CASH, ONE-OFF DETAIL.
//
// Real ledgers where it matters: `live-ledgers-zzz765c.json` is the TI, E2E,
// SJS and GIPCL evidence ledgers and graded rows as the production endpoints
// served them on 22 Sept, plus every one-off item in the nine live ledgers.
// Hand-built variable sets are used only where a rule needs a shape no live
// holding has yet (a B or G holding with every order variable disclosed).
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractVariables } from '../thesis/variables';
import { assessThesis, OUTPUT_ONLY_SENTENCE, STRENGTHENING_SENTENCE, selfDescribedMarginal } from '../thesis/status';
import { classifyGradedRow } from '../earnings/pattern-abfg';
import { parseOneOff, oneOffLine } from '../thesis/one-offs';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const live = JSON.parse(fx('live-ledgers-zzz765c.json'));
const bench: any[] = JSON.parse(fx('bench-rows.json'));

const OUTPUT_LABELS = ['Revenue growth', 'Earnings growth', 'Operating margin', 'Operating leverage'];
// zzz770 (spec §6): the green line opens with its own label — never "NO THESIS ACTION TRIGGERED".
const NO_ACTION = /^THESIS STRENGTHENING — structural mechanism confirmed and financial evidence supports it\. No separate invalidation trigger is present\. Structural evidence reviewed: (\d+)\/(\d+) variables confirmed\. Financial output: [^.]+/;

function liveAssess(t: string, pattern: any, extra: Partial<Parameters<typeof assessThesis>[0]> = {}) {
  const l = live.ledgers[t];
  const vars = extractVariables(l.graded, { ...l.summary, events: l.events });
  return assessThesis({ pattern, variables: vars, evidenceReviewed: true, hasGraderRow: !!l.graded, ...extra });
}

/** A variable row as extractVariables emits it. */
const V = (key: string, verdict: string, o: { after?: string; delta?: string; source?: 'grader' | 'filing'; kind?: string } = {}) => ({
  key, label: key, before: null, after: o.after ?? (verdict === 'stated' ? '1' : null), delta: o.delta ?? null,
  verdict, evidence: `${key} evidence`, source: o.source ?? 'filing', kind: o.kind ?? 'fact',
}) as any;
const GOOD_OUTPUT = [
  V('revenue_growth', 'improving', { delta: '+30%', source: 'grader' }),
  V('earnings_growth', 'improving', { delta: '+45%', source: 'grader' }),
  V('margin', 'improving', { delta: '+2.0pp', source: 'grader' }),
];

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz765c · financial output is never mechanism evidence', () => {
  test('no mechanism link and no structural confirmation is ever a financial-output variable — live ledgers and bench', () => {
    const cases = [
      ...['TI', 'E2E', 'SJS', 'GIPCL'].map((t) => liveAssess(t, t === 'TI' ? null : 'F')),
      ...bench.map((r) => assessThesis({ pattern: classifyGradedRow(r)?.pattern ?? null, variables: extractVariables(r, null), evidenceReviewed: true })),
    ];
    for (const a of cases) {
      for (const m of a.mechanismCheck) assert.ok(!OUTPUT_LABELS.includes(m.link), `${a.thesis.name}: "${m.link}" is output, not a mechanism link`);
      for (const l of a.structural.confirmedLabels) assert.ok(!OUTPUT_LABELS.includes(l), `${l} counted as structural`);
    }
  });

  test('A · grader operating leverage, margin and revenue all up — zero structural confirmations, no green', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('utilisation', 'stated', { after: '74%' }),
      V('volume', 'stated', { after: '3.4 million cases' }),
    ] });
    assert.equal(a.structural.confirmed, 0);
    assert.notEqual(a.status, 'STRENGTHENING');
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.ok(!a.mechanismCheck.some((m) => m.state === 'confirmed'), 'output cannot make a link hold');
  });

  test('a mechanism variable is confirmed only by its own fact — a management claim does not count', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('utilisation', 'improving', { after: '80% plus (target)', kind: 'claim' }),
      V('volume', 'stated', { after: '3.4 million cases' }),
    ] });
    assert.ok(!a.structural.confirmedLabels.includes('utilisation'));
    assert.ok(a.structural.missingRequired.includes('utilisation'));
    assert.notEqual(a.status, 'STRENGTHENING');
  });

  test('operating leverage STATED in a filing is structural; the grader\'s ratio is not', () => {
    const base = [...GOOD_OUTPUT, V('utilisation', 'improving', { after: '84%' }), V('volume', 'improving', { after: '+12%' })];
    const grader = assessThesis({ pattern: 'A', evidenceReviewed: true, variables: [...base, V('operating_leverage', 'improving', { source: 'grader', delta: '1.5×' })] });
    const filing = assessThesis({ pattern: 'A', evidenceReviewed: true, variables: [...base, V('operating_leverage', 'improving', { source: 'filing', after: 'absorption' })] });
    assert.equal(filing.structural.confirmed, grader.structural.confirmed + 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz765c · status sentences', () => {
  test('A · green only with utilisation AND volume confirmed, and the action line reads as specified with real X/Y', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('utilisation', 'improving', { after: '84%', delta: '+12pp' }),
      V('volume', 'improving', { after: '+12%' }),
      V('margin_driver', 'improving', { after: 'absorption' }),
    ] });
    assert.equal(a.status, 'STRENGTHENING');
    assert.equal(a.action, 'THESIS STRENGTHENING');
    assert.equal(a.headline, STRENGTHENING_SENTENCE);
    const m = a.actionLine.match(NO_ACTION);
    assert.ok(m, a.actionLine);
    // A's structural set in its ledger: utilisation, volume, capacity, capacity addition,
    // operating leverage (grader → output, excluded). Two confirmed of four.
    // The sentence counts the strategy's structural set plus other evidenced
    // drivers (margin driver here): 3 of 5. The structural object keeps the
    // strategy-only count.
    assert.equal(`${m![1]}/${m![2]}`, '2/4');
    assert.equal(`${a.structural.confirmed}/${a.structural.total}`, '2/4');
    assert.match(a.because, /Financial output: revenue \+30% · earnings \+45% · margin \+2\.0pp\./);
    assert.match(a.actionLine, /^THESIS STRENGTHENING — structural mechanism confirmed and financial evidence supports it/);
  });

  // zzz771: RETITLED. This shape has TWO distinct drivers (utilisation and the
  // margin driver) with the core mechanism (utilisation) confirmed — that is
  // why it is still green; one driver alone no longer is.
  test('A · two distinct drivers with the core mechanism confirmed → green (zzz771)', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('utilisation', 'improving', { after: '84%', delta: '+12pp' }),
      // zzz771 (integration): the card's x/y must be at least half — two of
      // five structural variables is still incomplete, so volume is evidenced too.
      V('volume', 'improving', { after: '+12%' }),
      V('margin_driver', 'improving', { after: 'better product mix and operating leverage' }),
    ] });
    assert.equal(a.status, 'STRENGTHENING');
  });

  test('A · zzz771: two drivers but 2/5 structural on the card is CONFIRMATION REQUIRED — one ratio for label, gate and chip', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('utilisation', 'improving', { after: '84%', delta: '+12pp' }),
      V('margin_driver', 'improving', { after: 'better product mix and operating leverage' }),
    ] });
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.deepEqual([a.verdict!.coverage.confirmed, a.verdict!.coverage.applicable], [2, 5]);
    assert.match(a.because, /^Evidence incomplete — financial output strengthening; structural mechanism not yet fully confirmed \(2\/5/);
  });

  test('A · output up with only levels and targets (no driver evidenced) is CONFIRMATION REQUIRED', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('utilisation', 'stated', { after: '50% to 60%', statement: 'TARGET' } as any),
      V('capacity', 'stated', { after: '430,000 MTPA' }),
    ] });
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.ok(a.because.startsWith(OUTPUT_ONLY_SENTENCE) || /level|disclos/.test(a.because), a.because);
  });

  // zzz771: UPDATED. The owner named MANINDS ("STRENGTHENING … 1/5 confirmed")
  // as the failure: one evidenced driver with the core mechanism unconfirmed
  // is CONFIRMATION REQUIRED, in his words. A target-only utilisation still
  // does not BLOCK the assessment — it is listed as still to confirm.
  test('A · MANINDS shape: target-only utilisation + one stated margin driver is CONFIRMATION REQUIRED, naming what is open', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '2.8×', source: 'grader' }),
      // zzz771: `statement` spread onto the row — V() does not copy it.
      { ...V('utilisation', 'stated', { after: 'target 50% to 60%', kind: 'claim' }), statement: 'TARGET' },
      V('capacity_addition', 'stated', { after: '22,000 MTPA' }),
      V('margin_driver', 'improving', { after: "optimized product and geographic mix and higher share of value-added/coated orders" }),
    ] });
    assert.equal(a.status, 'CONFIRMATION_REQUIRED', a.because);
    assert.ok(a.because.startsWith('Evidence incomplete — financial output strengthening; structural mechanism not yet fully confirmed (1/5: margin driver).'), a.because);
    assert.match(a.because, /Still to confirm: .*utilisation \(target only/);
  });

  test('a temporary-only margin driver (refund, forex) is not a structural driver', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('margin_driver', 'improving', { after: 'one-time tariff refund and forex gain' }),
    ] });
    assert.notEqual(a.status, 'STRENGTHENING');
  });

  test('B · green needs an order driver evidenced; book-to-bill flat alone is not enough', () => {
    const orders = [V('order_intake', 'improving', { delta: '+40%' }), V('order_book', 'improving', { delta: '+25%' }), V('book_to_bill', 'improving', { after: '1.4' })];
    const full = assessThesis({ pattern: 'B', evidenceReviewed: true, variables: [...GOOD_OUTPUT, ...orders] });
    assert.equal(full.status, 'STRENGTHENING');
    assert.match(full.actionLine, NO_ACTION);
    const noOrders = assessThesis({ pattern: 'B', evidenceReviewed: true, variables: [...GOOD_OUTPUT, V('book_to_bill', 'flat', { after: '1.0' })] });
    assert.equal(noOrders.status, 'CONFIRMATION_REQUIRED');
    assert.ok(noOrders.because.startsWith(OUTPUT_ONLY_SENTENCE));
  });

  test('F · live SJS: margin driver + one-offs cleared + cash → green, 3/3', () => {
    const a = liveAssess('SJS', 'F');
    assert.equal(a.status, 'STRENGTHENING');
    const m = a.actionLine.match(NO_ACTION);
    assert.ok(m, a.actionLine);
    assert.ok(Number(m![1]) >= 3 && Number(m![1]) <= Number(m![2]), a.actionLine);
  });

  test('a loss-making company is not green however fast the loss shrinks (EXICOM)', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      V('revenue_growth', 'improving', { delta: '+61.5%', source: 'grader' }),
      { ...V('margin', 'improving', { delta: '+12.0pp', source: 'grader' }), before: '-19.0%', after: '-7.0%' },
      V('capacity_addition', 'improving', { after: '3x' }),
    ] });
    assert.notEqual(a.status, 'STRENGTHENING');
  });

  // zzz771: UPDATED. One driver (capacity added) with the margin driver not
  // disclosed is no longer green — it is CONFIRMATION REQUIRED, and the
  // driver is still named as confirmed.
  test('F · live GIPCL: margin driver not disclosed, 600 MW commissioned capacity is ONE driver → CONFIRMATION REQUIRED, driver named', () => {
    const a = liveAssess('GIPCL', 'F');
    assert.equal(a.status, 'CONFIRMATION_REQUIRED', a.because);
    assert.ok(a.because.startsWith('Evidence incomplete — financial output strengthening'), a.because);
    assert.match(a.because, /capacity added/i);
    assert.match(a.because, /margin driver \(not disclosed\)/);
  });

  test('F · an approval or new product does not explain a profit jump on its own', () => {
    const a = assessThesis({ pattern: 'F', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT, V('regulatory_approval', 'improving', { after: 'USFDA approval' }), V('new_customer', 'improving', { after: 'new OEM' }),
    ] });
    assert.notEqual(a.status, 'STRENGTHENING');
  });

  test('G · cash and ROCE both confirmed for green; ROCE flat is not enough', () => {
    const g = (roce: string) => assessThesis({ pattern: 'G', evidenceReviewed: true, variables: [
      ...GOOD_OUTPUT,
      V('cash_conversion', 'improving', { after: '1.3×', source: 'grader' }),
      V('roce', roce, { after: roce === 'improving' ? '24%' : '15%', source: 'grader' }),
    ] });
    assert.equal(g('improving').status, 'STRENGTHENING');
    assert.equal(g('flat').status, 'CONFIRMATION_REQUIRED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz765c · a single cash reading is a review, never a break', () => {
  // zzz770 (spec §4): cash is thesis-critical only for F/G, and a negative
  // grader ratio is UNCLEAR. TI (unclassified) is WEAKENING on its earnings,
  // not on cash; the cash figure is shown and counted neither way.
  test('live TI (PAT −30%, CFO negative) stays WEAKENING — on earnings, not on cash', () => {
    const a = liveAssess('TI', null);
    assert.equal(a.status, 'WEAKENING');
    assert.doesNotMatch(a.because, /cash conversion/i);
    assert.equal(a.checked.find((c) => c.key === 'cash_conversion')!.state, 'UNCLEAR');
  });

  test('TI with guidance cut on top still does not break — the cash reading is not a condition', () => {
    const l = live.ledgers.TI;
    const vars = extractVariables(l.graded, { ...l.summary, events: l.events, guidance: { action: 'lowered', detail: 'x' } });
    const a = assessThesis({ pattern: null, variables: vars, evidenceReviewed: true, hasGraderRow: true });
    assert.notEqual(a.status, 'BROKEN');
  });

  // zzz770 (spec §4): a negative grader cash ratio is UNCLEAR — validation
  // required — and counted neither way, even for F.
  test('live E2E (F, cash −7.84×) is never WEAKENING or BROKEN on an unclear ratio', () => {
    const a = liveAssess('E2E', 'F');
    assert.ok(a.status !== 'WEAKENING' && a.status !== 'BROKEN', a.status);
    const cash = a.checked.find((c) => c.key === 'cash_conversion')!;
    assert.equal(cash.state, 'UNCLEAR');
    assert.match(String(cash.stateReason), /validation required/);
  });

  test('F · cash + a material one-off: only the one-off counts towards a break', () => {
    const vars = [...GOOD_OUTPUT, V('cash_conversion', 'deteriorating', { after: '0.2×', source: 'grader' }), V('one_offs', 'deteriorating', { after: '1 item' }), V('margin_driver', 'improving')];
    assert.equal(assessThesis({ pattern: 'F', evidenceReviewed: true, variables: vars }).status, 'WEAKENING');
  });

  test('A and B · cash alone never weakens a strategy where cash is not core — it is shown as context', () => {
    for (const pattern of ['A', 'B'] as const) {
      const a = assessThesis({ pattern, evidenceReviewed: true, variables: [
        // zzz770: a positive weak ratio — a negative one is UNCLEAR, not a warning.
        ...GOOD_OUTPUT, V('cash_conversion', 'deteriorating', { after: '0.31×', source: 'grader' }),
      ] });
      assert.notEqual(a.status, 'WEAKENING', pattern);
      assert.notEqual(a.status, 'BROKEN', pattern);
      assert.ok(a.financialWarning.some((w) => w.label === 'cash_conversion'), `${pattern}: the warning is still shown`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz765c · one-off detail from the live ledgers', () => {
  const item = (t: string, startsWith: string) => live.one_offs.find((o: any) => o.ticker === t && String(o.quote).startsWith(startsWith));
  const parse = (o: any) => parseOneOff(o.quote, o.value);

  test('every live one-off parses, keeps its quote, and never claims a field it was not told', () => {
    assert.ok(live.one_offs.length >= 10);
    for (const o of live.one_offs) {
      const d = parse(o);
      assert.equal(d.source_quote, String(o.quote).trim());
      // None of the live quotes says where the item sits relative to EBITDA,
      // or whether it is cash — so none may claim to know.
      assert.equal(d.cash, null, o.quote);
      assert.ok(d.pl_line !== 'below EBITDA' && d.pl_line !== 'within EBITDA', o.quote);
      // The model's own "will_not_recur" label is not the company's words.
      assert.equal(d.recurring, null, o.quote);
    }
  });

  test('TI · Rs. 30 crore of TSMA fees and integration expenses', () => {
    const d = parse(item('TI', 'TSMA'));
    assert.deepEqual([d.one_off_type, d.amount_cr, d.amount_raw, d.effect, d.pl_line], ['other', 30, 'Rs. 30 crore', 'expense', null]);
    assert.equal(oneOffLine(d), '₹30 Cr · other expense');
  });

  test('GIPCL · income tax refund is a tax item — and its P&L line is not stated', () => {
    const d = parse(item('GIPCL', 'Income tax'));
    assert.equal(d.one_off_type, 'tax');
    assert.equal(d.amount_cr, 17);
    assert.equal(d.pl_line, null);
    const ins = parse(item('GIPCL', 'Insurance'));
    assert.equal(ins.one_off_type, 'insurance claim');
    assert.equal(ins.amount_raw, null);
    assert.equal(ins.amount_cr, null);
  });

  test('SJS · Rs. 241.7 Mn is ₹24.17 Cr, an asset sale', () => {
    const d = parse(item('SJS', 'Sale of'));
    assert.equal(d.one_off_type, 'asset sale');
    assert.equal(d.amount_cr, 24.17);
    assert.equal(oneOffLine(d), '₹24.17 Cr · asset sale');
  });

  test('UFLEX · Rs. 825 million forex is ₹82.5 Cr', () => {
    const d = parse(item('UFLEX', 'Forex'));
    assert.equal(d.one_off_type, 'forex');
    assert.equal(d.amount_cr, 82.5);
  });

  test('MINDACORP · exceptional gain, Rs. 106 crore', () => {
    const d = parse(item('MINDACORP', 'Exceptional'));
    assert.deepEqual([d.one_off_type, d.amount_cr, d.pl_line, d.effect], ['exceptional item', 106, 'exceptional', 'gain']);
    assert.equal(oneOffLine(d), '₹106 Cr · exceptional item gain');
  });

  test('KIRIINDUS · two different figures, or USD against INR, give NO amount — never a pick', () => {
    const oi = parse(item('KIRIINDUS', 'Other income'));
    assert.equal(oi.pl_line, 'other income');
    assert.equal(oi.amount_cr, null);
    assert.ok(oi.amount_raw);
    const dy = parse(item('KIRIINDUS', 'Exceptional income'));
    assert.equal(dy.one_off_type, 'exceptional item');
    assert.equal(dy.amount_cr, null);
  });

  test('ETHOSLTD · a signed crore amount keeps its sign; the "2026" in the quote is not an amount', () => {
    for (const o of live.one_offs.filter((x: any) => x.ticker === 'ETHOSLTD')) {
      const d = parse(o);
      assert.equal(d.amount_cr, -1.6, o.quote);
    }
    assert.equal(parseOneOff('Participation in Watches & Wonder 2026 included in Q1FY27', null).amount_raw, null);
  });

  test('scale words convert honestly — lakh, bn — and a bare number is never scaled', () => {
    assert.equal(parseOneOff('VRS cost', 'Rs 250 lakh').amount_cr, 2.5);
    assert.equal(parseOneOff('VRS cost', 'Rs 250 lakh').one_off_type, 'VRS');
    assert.equal(parseOneOff('Impairment', 'INR 1.2 bn').amount_cr, 120);
    const bare = parseOneOff('Impairment of goodwill', '56');
    assert.equal(bare.amount_cr, null);
    assert.equal(bare.amount_raw, '56');
    assert.equal(parseOneOff('Earn-out', 'USD 5 million').amount_cr, null, 'no FX rate is assumed');
  });

  test('the line format: amount · type + effect · P&L line · cash · recurrence, only when stated', () => {
    const d = parseOneOff('Earn-out expense of ₹56 Cr is a non-recurring item shown below EBITDA.', null);
    assert.equal(oneOffLine(d), '₹56 Cr · earn-out expense · below EBITDA · non-recurring');
    const nc = parseOneOff('Non-cash impairment charge on the Europe subsidiary', 'Rs 12 crore');
    assert.equal(oneOffLine(nc), '₹12 Cr · impairment expense · non-cash');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz770 PC-C — THESIS-SPECIFIC MAP, EVIDENCE STATES, STATUS DEFINITIONS,
// STATUS TEXT = LABEL, CAPEX LIFECYCLE, NO PRICE.
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync } from 'node:fs';
import { STATUS_META, CONFIRMATION_SENTENCE, INCOMPLETE_SENTENCE, exitReasonOf, cashIsThesisCritical } from '../thesis/status';
import { isServicesBusiness, evidenceStateLine } from '../thesis/taxonomy';
import { buildCapexChain, capexProjects, stageOf } from '../thesis/capex-chain';

describe('zzz770 PC-C · status definitions, evidence states, capex lifecycle, no price', () => {
  const R = (x: Partial<Parameters<typeof assessThesis>[0]>) => assessThesis({ pattern: null, variables: [], evidenceReviewed: true, hasGraderRow: true, ...x } as any);
  const LEV = V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' });
  const ORDERS_UP = [V('order_intake', 'improving', { delta: '+40%' }), V('order_book', 'improving', { delta: '+25%' }), V('book_to_bill', 'improving', { after: '1.4' })];
  const fixtures: Record<string, ReturnType<typeof R>> = {};

  test('A · output up, mechanism unknown → CONFIRMATION REQUIRED, in the owner\'s words', () => {
    const a = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV] });
    fixtures.A = a;
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.equal(a.headline, CONFIRMATION_SENTENCE);
    assert.ok(a.actionLine.startsWith('CONFIRMATION REQUIRED — financial output improved, but the structural cause has not yet been established.'), a.actionLine);
    assert.equal(a.checked.find((c) => c.key === 'utilisation')!.state, 'NOT_DISCLOSED');
    assert.equal(a.logicChain.find((l) => l.step === 'CAUSE')!.established, false);
    assert.match(a.logicChain.find((l) => l.step === 'CAUSE')!.text, /^not established/);
  });

  test('B · mechanism confirmed and output confirms → STRENGTHENING, never "NO THESIS ACTION TRIGGERED"', () => {
    const a = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('utilisation', 'improving', { after: '84%', delta: '+12pp' }), V('volume', 'improving', { after: '+12%' })] });
    fixtures.B = a;
    assert.equal(a.status, 'STRENGTHENING');
    assert.ok(a.actionLine.startsWith('THESIS STRENGTHENING — structural mechanism confirmed and financial evidence supports it. No separate invalidation trigger is present.'), a.actionLine);
    assert.doesNotMatch(a.actionLine, /NO THESIS ACTION TRIGGERED/);
    assert.match(a.mechanismVerdict, /CONFIRMED/);
    assert.doesNotMatch(a.mechanismVerdict, /NOT YET CONFIRMED/);
  });

  test('C · a core mechanism variable deteriorates → WEAKENING; radar reason is structural, not price', () => {
    const a = R({ pattern: 'B', variables: [...GOOD_OUTPUT, V('order_intake', 'deteriorating', { delta: '-35%' }), V('order_book', 'improving', { delta: '+5%' })] });
    fixtures.C = a;
    assert.equal(a.status, 'WEAKENING');
    assert.equal(exitReasonOf(a), 'STRUCTURAL DETERIORATION');
  });

  test('D · an explicit stated break condition → BROKEN, naming the condition', () => {
    const a = R({ pattern: 'B', variables: [...GOOD_OUTPUT, V('order_book', 'deteriorating', { delta: '-30%' }), V('book_to_bill', 'deteriorating', { after: '0.6' })] });
    fixtures.D = a;
    assert.equal(a.status, 'BROKEN');
    assert.ok(a.actionLine.startsWith('THESIS BROKEN — EXIT REVIEW — '), a.actionLine);
    assert.match(a.because, /Order intake turns negative, or the book shrinks/);
    assert.equal(exitReasonOf(a), 'BREAK CONDITION MET');
  });

  test('E · explicit guidance exceeded → RUNNING AHEAD OF PLAN (plan and actual printed)', () => {
    const a = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV], promiseGap: { gap: true, direction: 'ahead', plan: 'utilisation 70% by Q1 FY27', actual: '84%', variance: '+14pp', detail: 'Beat the utilisation management set.' } });
    fixtures.E = a;
    assert.equal(a.status, 'POSITIVE_EXPECTATION_GAP');
    assert.ok(a.actionLine.startsWith('RUNNING AHEAD OF PLAN'), a.actionLine);
    assert.match(a.because, /Plan: utilisation 70% by Q1 FY27 · Actual: 84%/);
  });

  test('F · explicit guidance missed → RUNNING BEHIND PLAN; never inferred from earnings alone', () => {
    const a = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV], promiseGap: { gap: true, direction: 'behind', plan: 'revenue ₹1,000 Cr in FY27', actual: '₹820 Cr', variance: '−18%', detail: 'Missed the stated revenue plan.' } });
    fixtures.F = a;
    assert.equal(a.status, 'NEGATIVE_EXPECTATION_GAP');
    assert.ok(a.actionLine.startsWith('RUNNING BEHIND PLAN'), a.actionLine);
    assert.equal(exitReasonOf(a), 'GUIDANCE FAILURE');
    // A "gap" with no documented plan and actual is not a plan comparison.
    const inferred = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV], promiseGap: { gap: true, direction: 'behind', detail: 'earnings slowed' } });
    assert.notEqual(inferred.status, 'NEGATIVE_EXPECTATION_GAP');
  });

  // zzz771: UPDATED. "Unchanged" needs TWO readings. The fixture now carries
  // a before → after on every flat figure; a single-reading flat (the old
  // fixture shape) is asserted NOT to reach NO MATERIAL CHANGE.
  test('G · every thesis-critical variable reviewed on two readings and flat → NO MATERIAL CHANGE; a level-only or single-reading one is not enough', () => {
    const F2 = (key: string, before: string, after: string, source?: 'grader' | 'filing') => ({ ...V(key, 'flat', { after, source }), before, delta: 'FLAT' });
    const flatB = [
      F2('order_book', '₹1,200 Cr', '₹1,200 Cr'), F2('book_to_bill', '1.0', '1.0'), F2('order_intake', '₹300 Cr', '₹300 Cr'),
      F2('capacity', '40,000 t', '40,000 t'), F2('margin', '14%', '14%', 'grader'), F2('revenue_visibility', '2.1 years', '2.1 years'),
      V('revenue_growth', 'flat', { after: '+2%', delta: '+2%', source: 'grader' }),
    ];
    const a = R({ pattern: 'B', variables: flatB });
    fixtures.G = a;
    assert.equal(a.status, 'NEUTRAL', a.because);
    assert.ok(a.actionLine.startsWith('NO MATERIAL CHANGE — '), a.actionLine);
    // Execution delay passed by silence: named as not mentioned, never as unchanged.
    assert.match(a.because, /Not mentioned in the documents read \(silence, not a reading\): execution delay/);
    const levelOnly = R({ pattern: 'B', variables: flatB.map((v) => (v.key === 'revenue_visibility' ? V('revenue_visibility', 'stated', { after: '2.1 years' }) : v)) });
    assert.notEqual(levelOnly.status, 'NEUTRAL', 'a level with nothing to compare is not "nothing changed"');
    const singleReading = R({ pattern: 'B', variables: flatB.map((v) => (v.key === 'order_book' ? V('order_book', 'flat', { after: '₹1,200 Cr' }) : v)) });
    assert.notEqual(singleReading.status, 'NEUTRAL', 'a flat on one reading is a level, not "unchanged"');
    assert.match(singleReading.because, /order book \(₹1,200 Cr\) is a single reading/);
  });

  test('H · required evidence not read → EVIDENCE INCOMPLETE, stated as unknown not bad', () => {
    const a = R({ pattern: 'A', evidenceReviewed: false, variables: [...GOOD_OUTPUT, LEV] });
    fixtures.H = a;
    assert.equal(a.status, 'EVIDENCE_INCOMPLETE');
    assert.equal(a.headline, INCOMPLETE_SENTENCE);
    assert.ok(a.actionLine.startsWith('EVIDENCE INCOMPLETE — required thesis variables remain unreviewed. This is not evidence of deterioration.'), a.actionLine);
    assert.equal(a.checked.find((c) => c.key === 'utilisation')!.state, 'NOT_SEARCHED');
  });

  test('status text agrees with the label on every fixture, live ledger and bench row', () => {
    const all = [
      ...Object.values(fixtures),
      ...['TI', 'E2E', 'SJS', 'GIPCL'].map((t) => liveAssess(t, t === 'TI' ? null : 'F')),
      ...bench.map((r) => assessThesis({ pattern: classifyGradedRow(r)?.pattern ?? null, variables: extractVariables(r, null), evidenceReviewed: true })),
      ...bench.map((r) => assessThesis({ pattern: classifyGradedRow(r)?.pattern ?? null, variables: extractVariables(r, null), evidenceReviewed: false })),
    ];
    assert.ok(all.length > 10);
    for (const a of all) {
      const label = STATUS_META[a.status].label;
      assert.ok(a.actionLine.startsWith(label), `${a.status}: "${a.actionLine.slice(0, 90)}" must open with "${label}"`);
      assert.doesNotMatch(a.actionLine, /NO THESIS ACTION TRIGGERED/);
      if (a.status !== 'STRENGTHENING') assert.doesNotMatch(a.actionLine, /THESIS STRENGTHENING/);
      if (a.status === 'STRENGTHENING') assert.doesNotMatch(a.mechanismVerdict, /NOT YET CONFIRMED/);
      if (a.status === 'CONFIRMATION_REQUIRED' && a.actionLine.includes('financial output improved')) assert.ok(a.actionLine.startsWith('CONFIRMATION REQUIRED — financial output improved'));
    }
  });

  test('a conviction label (BLOCKBUSTER / STRONG) never changes the thesis status', () => {
    const base = { pattern: 'A' as const, variables: [...GOOD_OUTPUT, LEV], evidenceReviewed: true, hasGraderRow: true };
    const s0 = assessThesis(base).status;
    for (const tier of ['BLOCKBUSTER', 'STRONG', 'GOOD', null]) assert.equal(assessThesis({ ...base, tier } as any).status, s0);
    const src = readFileSync(join(__dirname, '..', 'thesis', 'status.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\btier\b|BLOCKBUSTER/, 'the status engine reads no conviction label');
  });

  test('services / software business: capacity and utilisation are N/A, never pending', () => {
    const a = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV], business: { sector: 'IT Services', industry: 'Software' } } as any);
    const u = a.checked.find((c) => c.key === 'utilisation')!;
    assert.equal(u.state, 'NOT_APPLICABLE');
    assert.equal(u.absence, 'not_applicable');
    assert.ok(!a.coverage.missingCore.includes(u.label), 'N/A is not a missing core variable');
    assert.ok(a.coverage.mechanism.not_applicable >= 1);
    // zzz771: `silent` (risk variables passed by silence) is the eighth count; the sum still adds up.
    assert.equal(a.coverage.mechanism.pending + a.coverage.mechanism.not_applicable + a.coverage.mechanism.confirmed + a.coverage.mechanism.contradicted
      + a.coverage.mechanism.stated + a.coverage.mechanism.flat + a.coverage.mechanism.unclear + a.coverage.mechanism.silent, a.coverage.mechanism.total);
    assert.equal(a.coverage.mechanism.core_variables, a.coverage.mechanism.total - a.coverage.mechanism.not_applicable);
    assert.ok(!a.coreMechanismGaps.includes(u.label));
    assert.match(evidenceStateLine(u.state, { reason: u.stateReason }), /^N\/A — /);
    // Conservative: a manufacturer that mentions software is not a services business.
    assert.equal(isServicesBusiness({ text: 'Software-defined controllers shipped from the Pune plant; capacity utilisation at 80%.' }), false);
    assert.equal(isServicesBusiness({ text: 'Services segment grew; deal momentum strong; anchor accounts diversified; attrition fell.' }), true);
    // A disclosed figure is kept, whatever the business.
    const kept = R({ pattern: 'A', variables: [...GOOD_OUTPUT, V('utilisation', 'improving', { after: '84%' })], business: { sector: 'IT Services' } } as any);
    assert.equal(kept.checked.find((c) => c.key === 'utilisation')!.state, 'FOUND');
  });

  test('UNCLEAR is never contradicted: a negative cash ratio (LLOYDSENGG −3.72×) is validation-required, counted neither way', () => {
    for (const pattern of ['F', 'G', null] as const) {
      const a = R({ pattern, variables: [...GOOD_OUTPUT, V('margin_driver', 'improving', { after: 'value-added mix' }), V('cash_conversion', 'deteriorating', { after: '-3.72× (last FY)', source: 'grader' })] });
      const cash = a.checked.find((c) => c.key === 'cash_conversion')!;
      assert.equal(cash.state, 'UNCLEAR', String(pattern));
      assert.match(String(cash.stateReason), /validation required/);
      assert.notEqual(a.status, 'WEAKENING');
      assert.notEqual(a.status, 'BROKEN');
      assert.equal(a.coverage.output.contradicted, 0, 'unclear is not contradicted');
      assert.ok(a.coverage.output.unclear >= 1);
      assert.ok(!a.financialWarning.some((w) => w.label === 'cash_conversion'), 'unclear is not a warning either');
    }
  });

  test('cash is thesis-critical only for F and G; elsewhere a weak ratio is a FINANCIAL WARNING with the status unchanged', () => {
    assert.deepEqual(['A', 'B', 'F', 'G', 'UNCLASSIFIED'].map(cashIsThesisCritical), [false, false, true, true, false]);
    const cupid = R({ pattern: null, variables: [...GOOD_OUTPUT, V('cash_conversion', 'deteriorating', { after: '0.43× (last FY)', source: 'grader' })] });
    assert.notEqual(cupid.status, 'WEAKENING');
    const w = cupid.financialWarning.find((x) => x.label === 'cash_conversion');
    assert.ok(w && /not thesis-critical/.test(String(w.note)));
  });

  test('MOREPENLAB shape (F: earnings +409%, margin 6→14%, cash 0.59×, no mechanism) — WEAKENING, stated precisely, not thesis failure', () => {
    const a = R({ pattern: 'F', variables: [
      V('revenue_growth', 'improving', { delta: '+34.1%', source: 'grader' }), V('earnings_growth', 'improving', { delta: '+409.1%', source: 'grader' }),
      { ...V('margin', 'improving', { delta: '+8.0pp', source: 'grader' }), before: '6.0%', after: '14.0%' },
      V('cash_conversion', 'deteriorating', { after: '0.59× (last FY)', source: 'grader' }),
    ] });
    assert.equal(a.status, 'WEAKENING');
    assert.match(a.because, /^Financial output improved \(revenue \+34\.1% · earnings \+409\.1% · margin \+8\.0pp\), but the structural mechanism is not established/);
    assert.match(a.because, /this is not thesis failure/);
    assert.match(a.because, /cash conversion, thesis-critical for a profit jump \(the forensic test\), reads 0\.59×/);
    assert.equal(a.coverage.mechanism.confirmed, 0, 'output never counts as mechanism confirmation');
    assert.notEqual(exitReasonOf(a), null);
  });

  test('GOLDIAM shape (A: utilisation core, read and not disclosed, only a mix driver) — the gap is named as UNKNOWN, not negative', () => {
    const a = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('margin_driver', 'improving', { after: 'higher lab-grown jewellery mix' })] });
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.deepEqual(a.coreMechanismGaps, ['Capacity utilisation']);
    assert.match(a.because, /capacity utilisation — core to this thesis, so it is UNKNOWN\. Unknown, not negative/);
    // Volume (the same absorption mechanism) evidenced lifts the UNKNOWN gap —
    // zzz771: UPDATED — but one driver with utilisation itself unconfirmed is
    // CONFIRMATION REQUIRED, not green. Volume AND a margin driver, with
    // utilisation confirmed, is.
    const withVolume = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('volume', 'improving', { after: '+18% tonnage' })] });
    assert.deepEqual(withVolume.coreMechanismGaps, []);
    assert.equal(withVolume.status, 'CONFIRMATION_REQUIRED');
    assert.ok(withVolume.because.startsWith('Evidence incomplete — financial output strengthening'), withVolume.because);
  });

  test('evidence-state lines never print a bare dash once evidence was read', () => {
    const docs = [{ kind: 'transcript', label: 'Concall transcript Aug 2026' }, { kind: 'results', label: 'Unaudited Results For The Quarter Ended 30-06-2026' }];
    assert.equal(evidenceStateLine('NOT_DISCLOSED', { docs }), 'NOT DISCLOSED — searched concall + results filing');
    assert.equal(evidenceStateLine('NOT_APPLICABLE', {}), 'N/A — not relevant to this thesis');
    assert.equal(evidenceStateLine('UNCLEAR', { reason: 'ratio sign/denominator ambiguous' }), 'UNCLEAR — ratio sign/denominator ambiguous');
    const a = fixtures.A;
    for (const c of a.checked) assert.ok(c.state && c.state.length > 0, c.key);
  });

  test('capex lifecycle — INNOVACAP shape: capex → commercial production → utilisation → ₹107 cr revenue → margin pending', () => {
    const summary = {
      capex_projects: [{ name: 'Kathua, Jammu facility', type: 'greenfield', amount: 'Total Capital Investment 480+ crore', status: 'commissioned',
        completion_period: 'commercialized in January 2025', revenue_from: 'already contributing; Q1 FY27 revenue INR107 crores' }],
      utilisation: { current: 'Jammu annualised ~25% to 30%', prior: '', expected: 'Jammu optimum utilization 60-70%', basis: 'Kathua, Jammu plant' },
    };
    const vars = [V('capex_earning', 'improving', { after: 'Jammu capex (~INR480+ crore) is already contributing revenue (INR107 crores in Q1), but management states full margin contribution will come as utilization increases.' })];
    const chain = buildCapexChain(summary, vars, { periods: {} } as any);
    const p = chain.lifecycleProjects!.find((x) => /Jammu/.test(x.name))!;
    assert.ok(p, 'the Jammu project is on the card');
    const st = (s: string) => p.steps.find((x) => x.step === s)!.state;
    assert.equal(st('ANNOUNCED'), 'actual');
    assert.notEqual(st('SPENT'), 'actual', 'announced is not spent');
    assert.equal(st('COMMERCIAL_PRODUCTION'), 'actual');
    assert.equal(st('REVENUE_CONTRIBUTION'), 'actual');
    assert.notEqual(st('MARGIN_CONTRIBUTION'), 'actual', 'revenue contribution is not margin contribution');
    assert.match(p.line, /^Capex ₹480\+ crore → commercial production January 2025 → utilisation .*25% to 30%.* → revenue contribution INR107 crores in Q1(?: FY27)? → margin contribution pending/i);
    assert.equal(chain.state, 'starting_to_earn');
    assert.match(String(p.revenue_contribution), /^INR107 crores in Q1/);
    assert.equal(p.margin_contribution && /will come as utilization increases/.test(p.margin_contribution), true);
  });

  test('capex lifecycle — HAPPYFORGE shape: new heavy-forging capacity → revenue expected FY28 → earning pending; a commissioned press line is separate', () => {
    const ev = (variable: string, value_type: string, after: string, period: string | null, text: string, id: string) =>
      ({ variable, value_type, before: null, after, unit: null, period, direction: 'up', confidence: 'HIGH', source: 'Investor presentation Aug 2026', evidence_text: text, id });
    const ledger = { periods: { 'Q1 FY27': { events: [
      ev('capex_status', 'GUIDANCE', 'installation of equipment for our ultra-heavy component manufacturing facilities is expected to be completed by the end of the financial year', 'FY27',
        'Installation of equipment for our ultra-heavy component manufacturing facilities is expected to be completed by the end of the financial year, positioning us for the commencement of commercial revenue.', 'e1'),
      ev('capacity_addition', 'ACTUAL', '4,000 tons', 'Q1 FY27', 'We also added capacity during the quarter by commissioning another 4,000-ton forging press line, adding 4,000 tons of forging capacity.', 'e2'),
    ] } } } as any;
    const summary = { capex_projects: [{ name: 'Heavy-forgings capacity expansion (part of Rs.650 cr programme)', type: 'greenfield', amount: 'Rs.650 cr (programme)',
      capacity_added: 'up to ~3,000 kg components', status: 'under_construction', completion_period: 'operational by FY28 for planned additions', revenue_from: 'FY28 (commercial revenues expected from FY28 onwards)' }] };
    const ps = capexProjects(summary, ledger, []);
    const heavy = ps.find((x) => /Heavy/.test(x.name))!;
    const st = (s: string) => heavy.steps.find((x) => x.step === s)!.state;
    assert.equal(st('REVENUE_CONTRIBUTION'), 'target');
    assert.notEqual(st('COMMISSIONED'), 'actual', 'a plan to complete is not commissioned');
    assert.notEqual(st('SPENT'), 'actual', 'a programme amount is not spent');
    assert.match(heavy.line, /revenue contribution expected from FY28 → earning pending$/);
    assert.ok(heavy.source_ids.includes('e1'));
    const other = ps.find((x) => !/Heavy/.test(x.name))!;
    assert.equal(other.steps.find((x) => x.step === 'CAPACITY_CREATED')!.state, 'actual');
    assert.equal(other.steps.find((x) => x.step === 'COMMISSIONED')!.state, 'actual');
    assert.equal(other.steps.find((x) => x.step === 'REVENUE_CONTRIBUTION')!.state, 'pending', 'commissioned is not earning');
  });

  test('capex lifecycle — CUPID shape: announced ₹331.53 cr ≠ ₹82.88 cr deployed; "upon full commissioning" is a plan, not a plant', () => {
    const ev = (variable: string, value_type: string, after: string, period: string | null, text: string, id: string) =>
      ({ variable, value_type, before: null, after, unit: null, period, direction: 'up', confidence: 'HIGH', source: 'Reg. 34 (1) Annual Report.', evidence_text: text, id });
    const ledger = { periods: { 'Q1 FY27': { events: [
      ev('capex', 'TARGET', '331.53 Cr', 'Planned investment in Baazar Style Retail', 'Planned investment of 331.53 Cr in Baazar Style Retail to accelerate the growth of its consumer FMCG business.', 'c1'),
      ev('capex_status', 'ACTUAL', '82.88 crore deployed in April 2026', 'April 2026', 'We made a strategic investment of 331.53 crore in Baazar Style Retail, of which 82.88 crore is deployed in April 2026.', 'c2'),
      ev('capacity_addition', 'ACTUAL', '770 million male condoms', 'upon full commissioning', 'Upon full commissioning, the Palava facility will increase annual production capacity, adding around 770 million male condoms.', 'c3'),
    ] } } } as any;
    const summary = { capex_projects: [{ name: 'Palava manufacturing facility', type: 'greenfield', amount: '', capacity_added: '', status: 'under_construction', completion_period: 'FY27', revenue_from: 'not stated' }] };
    const ps = capexProjects(summary, ledger, []);
    const baazar = ps.find((x) => /Baazar/.test(x.name))!;
    assert.equal(baazar.announced, '₹331.53 Cr');
    assert.deepEqual(baazar.spent, ['₹82.88 cr (April 2026)']);
    assert.match(baazar.line, /^Capex ₹331\.53 Cr → spent ₹82\.88 cr \(April 2026\) → revenue contribution pending$/);
    const palava = ps.find((x) => /Palava/.test(x.name))!;
    assert.equal(palava.steps.find((x) => x.step === 'CAPACITY_CREATED')!.state, 'target');
    assert.notEqual(palava.steps.find((x) => x.step === 'COMMISSIONED')!.state, 'actual');
    assert.equal(stageOf({ variable: 'capacity_addition', value_type: 'ACTUAL', after: '770 million', period: 'upon full commissioning', evidence_text: 'Upon full commissioning, capacity rises.' }), null);
  });

  // ── NO PRICE, ANYWHERE IN THIS ENGINE. ─────────────────────────────────
  // Scans the code (comments, string literals and JSX text removed) of every
  // Portfolio Catalysts engine file for price inputs used as logic. Display
  // copy that SAYS "no price" is text, not an input, and is not flagged.
  test('static: no price / close / LTP / CMP / change% / technicals / drawdown / target price / market-cap trigger in the thesis engine', () => {
    const SRC = join(__dirname, '..', '..');
    const files = [
      ...readdirSync(join(SRC, 'lib', 'thesis')).filter((f) => /\.tsx?$/.test(f)).map((f) => join(SRC, 'lib', 'thesis', f)),
      join(SRC, 'components', 'thesis-card.tsx'),
      join(SRC, 'app', '(dashboard)', 'portfolio-catalysts', 'page.tsx'),
      join(SRC, 'app', '(dashboard)', 'exit-radar', 'page.tsx'),
    ];
    const code = (s: string) => s
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
      .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''")
      .replace(/>[^<>{}]*</g, '><');
    const BANNED = /\b(ltp|cmp|last_?price|lastPrice|current_?price|currentPrice|close_?price|closePrice|prev_?close|prevClose|change_?pct|changePct|pct_?change|percentChange|draw_?down|drawdown|target_?price|targetPrice|market_?cap(?:_cr)?|marketCap(?:Cr)?|mcap|pct52|high52|low52|week52\w*|perf1y|technicals?|live_move_pct|move_pct|day1_?\w*|price_?move|stock_?price|stockPrice|pe_ratio)\b|\.pe\b|\b(?:graded|g|row|r|quote|quotes|q|live|market|ohlc|bar|candle)\??\.(?:price|close|open|high|low)\b/;
    // The only two places a price-derived field may appear, and why:
    //  · screener-financials.ts PARSES the screener page and passes the row
    //    through (market cap, P/E); nothing in the engine reads them back.
    //  · universe.ts sizes the BENCH candidate list (small/mid band). It
    //    never touches a holding, a status or the radar.
    const ALLOW: Record<string, RegExp> = {
      'screener-financials.ts': /market_cap_cr|marketCapCr|\.pe\b/,
      'universe.ts': /market_cap_cr/,
    };
    const hits: string[] = [];
    for (const f of files) {
      const name = f.split(/[\\/]/).pop()!;
      code(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
        const m = line.match(BANNED);
        if (m && !(ALLOW[name] && ALLOW[name].test(m[0]))) hits.push(`${name}:${i + 1} ${m[0]}`);
      });
    }
    assert.deepEqual(hits, [], `price inputs found: ${hits.join(', ')}`);
    // The judging modules import nothing that could carry a price.
    for (const f of ['status.ts', 'capex-chain.ts', 'variables.ts', 'comparison.ts', 'ledger.ts', 'taxonomy.ts']) {
      const src = readFileSync(join(SRC, 'lib', 'thesis', f), 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g)) assert.doesNotMatch(m[1], /quote|price|technical|chart|ohlc|universe|quality-preset/i, `${f} imports ${m[1]}`);
    }
    // The radar's reasons are the six thesis reasons, never a price.
    assert.ok(!(['BROKEN', 'WEAKENING', 'NEGATIVE_EXPECTATION_GAP'] as const).some((s) => /price|drawdown/i.test(String(exitReasonOf({ status: s, checked: [], triggered: [] } as any)))));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz771 PC-2 — STRICT GREEN, THE THREE-QUESTION VERDICT, UNKNOWN ≠ FLAT ≠
// CONFIRMED, AND THE LABEL AGREES WITH THE VERDICT.
//
// The owner's verdict on the previous build: "EMCURE is THESIS STRENGTHENING
// while only 1/5 structural variables are confirmed. Incomplete structural
// evidence ≠ strengthening thesis." And: "Did a break trigger? Did the thesis
// strengthen? Did evidence merely fail to contradict it? — three different
// questions." And: "Unknown ≠ Flat ≠ Confirmed."
// ═══════════════════════════════════════════════════════════════════════════
import { OUTPUT_STRENGTHENING_BECAUSE, OUTPUT_STRENGTHENING_SENTENCE } from '../thesis/status';

describe('zzz771 PC-2 · strict green, verdict separation, unknown ≠ flat ≠ confirmed', () => {
  const R = (x: Partial<Parameters<typeof assessThesis>[0]>) => assessThesis({ pattern: null, variables: [], evidenceReviewed: true, hasGraderRow: true, ...x } as any);
  const LEV = V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' });
  const OPENING = 'Evidence incomplete — financial output strengthening; structural mechanism not yet fully confirmed (';
  assert.ok(OUTPUT_STRENGTHENING_BECAUSE.startsWith(OPENING));

  // ── 1. STRICT GREEN ────────────────────────────────────────────────────
  test('EMCURE / MANINDS shape (A: output up, one margin driver, 1/5 confirmed) → CONFIRMATION REQUIRED with the exact opening sentence', () => {
    const a = R({ pattern: 'A', variables: [
      ...GOOD_OUTPUT, LEV,
      { ...V('utilisation', 'stated', { after: '50% to 60% (target)', kind: 'claim' }), statement: 'TARGET' },
      V('capacity_addition', 'stated', { after: '22,000 MTPA' }),
      V('margin_driver', 'improving', { after: 'optimised product mix and higher value-added share' }),
    ] });
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.equal(a.because.slice(0, OPENING.length), OPENING);
    assert.match(a.because, /\(1\/5: margin driver\)\. Still to confirm: /);
    assert.match(a.because, /capacity utilisation \(target only: 50% to 60% \(target\)\)/);
    assert.match(a.because, /volume \(not disclosed\)/);
    assert.match(a.because, /capacity added \(level only: 22,000 MTPA\)/);
    assert.equal(a.headline, OUTPUT_STRENGTHENING_SENTENCE);
    assert.ok(a.actionLine.startsWith('CONFIRMATION REQUIRED — evidence incomplete — financial output strengthening'), a.actionLine);
    assert.doesNotMatch(a.actionLine, /THESIS STRENGTHENING/);
    assert.equal(a.structural.gatePassed, false);
  });

  test('gate passed → STRENGTHENING (A: utilisation and volume both confirmed from their own evidence)', () => {
    const a = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('utilisation', 'improving', { after: '84%', delta: '+12pp' }), V('volume', 'improving', { after: '+12%' })] });
    assert.equal(a.status, 'STRENGTHENING');
    assert.equal(a.structural.gatePassed, true);
    assert.equal(a.verdict!.evidence, 'CONFIRMED');
    assert.equal(a.verdict!.direction, 'STRENGTHENING');
  });

  test('two distinct drivers + core coverage 50% → STRENGTHENING; two drivers + 40% → not', () => {
    // A: applicable core mechanism = utilisation (operating leverage from the
    // grader and margin are output). Two drivers (volume, margin driver) and
    // utilisation confirmed = 1/1 → green.
    // zzz771 (integration): coverage is the card's printed x/y (structural ∪
    // evidenced drivers); three of five confirmed is at least half.
    const half = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV,
      V('utilisation', 'improving', { after: '84%', delta: '+12pp' }), V('volume', 'improving', { after: '+12%' }), V('margin_driver', 'improving', { after: 'operating leverage and better mix' })] });
    assert.equal(half.status, 'STRENGTHENING', half.because);
    assert.equal(half.verdict!.coverage.confirmed, 3);
    assert.equal(half.verdict!.coverage.applicable, 5);
    // Two distinct drivers (volume, margin driver) but utilisation only a
    // level → 0/1 core confirmed → below half → not green. The gate is not
    // passed either (volume is required and confirmed; utilisation is not).
    const below = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV,
      V('utilisation', 'stated', { after: '74%' }), V('volume', 'improving', { after: '+12%' }), V('margin_driver', 'improving', { after: 'operating leverage and better mix' })] });
    assert.notEqual(below.status, 'STRENGTHENING', below.because);
    assert.equal(below.status, 'CONFIRMATION_REQUIRED');
    assert.equal(below.verdict!.coverage.confirmed, 2);
    assert.equal(below.verdict!.coverage.applicable, 5);
    assert.ok(below.verdict!.coverage.missing.includes('Capacity utilisation'));
    // A hand-built 2-of-5 (40%) with two distinct drivers: F core mechanism is
    // one-offs and cash conversion; margin driver + volume evidenced, cash
    // confirmed, one-offs disclosed but not judged → 1/2 = 50% → green.
    // Take away the cash confirmation → 0/2 → not green.
    const fHalf = R({ pattern: 'F', variables: [...GOOD_OUTPUT, V('margin_driver', 'improving', { after: 'mix and scale' }), V('volume', 'improving', { after: '+9%' }),
      V('cash_conversion', 'improving', { after: '1.4×', delta: '+0.3×', source: 'grader' }), V('one_offs', 'stated', { after: '1 item' })] });
    assert.equal(fHalf.status, 'STRENGTHENING', fHalf.because);
    const fBelow = R({ pattern: 'F', variables: [...GOOD_OUTPUT, V('margin_driver', 'improving', { after: 'mix and scale' }), V('volume', 'improving', { after: '+9%' }),
      V('cash_conversion', 'stated', { after: '0.9×', source: 'grader' }), V('one_offs', 'stated', { after: '1 item' })] });
    assert.notEqual(fBelow.status, 'STRENGTHENING', fBelow.because);
    assert.equal(fBelow.verdict!.direction, 'UNKNOWN');
  });

  // ── 2. THE VERDICT: THREE SEPARATE QUESTIONS ───────────────────────────
  test('every assessment carries a verdict, and its coverage excludes N/A and financial output', () => {
    const all = [
      ...['TI', 'E2E', 'SJS', 'GIPCL'].map((t) => liveAssess(t, t === 'TI' ? null : 'F')),
      ...bench.map((r) => assessThesis({ pattern: classifyGradedRow(r)?.pattern ?? null, variables: extractVariables(r, null), evidenceReviewed: true })),
      ...bench.map((r) => assessThesis({ pattern: classifyGradedRow(r)?.pattern ?? null, variables: extractVariables(r, null), evidenceReviewed: false })),
    ];
    for (const a of all) {
      const v = a.verdict!;
      assert.ok(v, 'verdict filled');
      assert.ok(['STRENGTHENING', 'WEAKENING', 'UNCHANGED', 'UNKNOWN'].includes(v.direction));
      assert.ok(v.directionWhy.length > 10);
      assert.ok(v.evidenceWhy.length > 10);
      assert.equal(v.breakTrigger.fired, v.breakTrigger.conditions.length > 0);
      assert.ok(v.breakTrigger.fired ? v.breakTrigger.text.startsWith('Fired: ') : v.breakTrigger.text === 'None fired');
      assert.ok(v.coverage.confirmed <= v.coverage.applicable);
      // zzz772: a contradicted variable is reported under `contradicted`, never
      // `missing`; the two together are what is not confirmed.
      assert.equal(v.coverage.missing.length + (v.coverage.contradicted?.length ?? 0), v.coverage.applicable - v.coverage.confirmed);
      for (const c of v.coverage.contradicted ?? []) assert.ok(!v.coverage.missing.includes(c), `${c} is contradicted, not missing`);
      for (const m of v.coverage.missing) assert.ok(!OUTPUT_LABELS.includes(m), `${m} is output, not core mechanism`);
    }
  });

  test('"no action triggered" with direction UNKNOWN and evidence INCOMPLETE — three different answers on one card', () => {
    // Output improved, no invalidation condition fired, utilisation not disclosed.
    const a = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV] });
    const v = a.verdict!;
    assert.equal(v.breakTrigger.fired, false);
    assert.equal(v.breakTrigger.text, 'None fired');
    assert.equal(v.direction, 'UNKNOWN');
    assert.match(v.directionWhy, /^output improved .*; mechanism 0\/4 confirmed — direction cannot be called from output alone$/);
    assert.equal(v.evidence, 'INCOMPLETE');
    assert.match(v.evidenceWhy, /capacity utilisation \(not disclosed\).*Unknown is not neutral evidence/);
    // zzz772: coverage also carries `contradicted` (empty here).
    assert.deepEqual(v.coverage, { confirmed: 0, applicable: 4, missing: ['Capacity utilisation', 'Volume', 'Capacity added', 'Installed capacity'], contradicted: [] });
  });

  test('a fired condition is answer 1 only: WEAKENING carries the fired text; BROKEN says the break is met', () => {
    const weak = R({ pattern: 'B', variables: [...GOOD_OUTPUT, V('order_intake', 'deteriorating', { delta: '-35%' }), V('order_book', 'improving', { delta: '+5%' })] });
    assert.equal(weak.status, 'WEAKENING');
    assert.equal(weak.verdict!.breakTrigger.fired, true);
    assert.match(weak.verdict!.breakTrigger.text, /^Fired: "New order intake falls materially or stops\." — one condition on a single reading; a break needs/);
    assert.equal(weak.verdict!.direction, 'WEAKENING');
    assert.equal(weak.verdict!.evidence, 'CONTRADICTED');
    const broken = R({ pattern: 'B', variables: [...GOOD_OUTPUT, V('order_book', 'deteriorating', { delta: '-30%' }), V('book_to_bill', 'deteriorating', { after: '0.6' })] });
    assert.equal(broken.status, 'BROKEN');
    assert.match(broken.verdict!.breakTrigger.text, /thesis-break condition met/);
    assert.equal(broken.verdict!.direction, 'WEAKENING');
    assert.equal(broken.verdict!.evidence, 'CONTRADICTED');
  });

  test('evidence states: UNCHECKED with no document; NOT_CONTRADICTED when read and nothing confirms or contradicts; PARTIALLY_CONFIRMED with one driver; UNCHANGED only for NEUTRAL', () => {
    const unread = R({ pattern: 'A', evidenceReviewed: false, variables: [...GOOD_OUTPUT, LEV] });
    assert.equal(unread.verdict!.evidence, 'UNCHECKED');
    assert.equal(unread.verdict!.direction, 'UNKNOWN');
    const level = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('utilisation', 'stated', { after: '74%' })] });
    assert.equal(level.verdict!.evidence, 'NOT_CONTRADICTED', level.verdict!.evidenceWhy);
    assert.equal(level.verdict!.direction, 'UNKNOWN');
    const one = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('volume', 'improving', { after: '+18% tonnage' })] });
    assert.equal(one.verdict!.evidence, 'PARTIALLY_CONFIRMED');
    assert.equal(one.verdict!.direction, 'UNKNOWN');
    assert.equal(one.status, 'CONFIRMATION_REQUIRED');
    // UNCHANGED belongs to NEUTRAL alone.
    const F2 = (key: string, before: string, after: string, source?: 'grader' | 'filing') => ({ ...V(key, 'flat', { after, source }), before, delta: 'FLAT' });
    const neutral = R({ pattern: 'B', variables: [
      F2('order_book', '₹1,200 Cr', '₹1,200 Cr'), F2('book_to_bill', '1.0', '1.0'), F2('order_intake', '₹300 Cr', '₹300 Cr'),
      F2('capacity', '40,000 t', '40,000 t'), F2('margin', '14%', '14%', 'grader'), F2('revenue_visibility', '2.1 years', '2.1 years'),
      V('revenue_growth', 'flat', { after: '+2%', delta: '+2%', source: 'grader' }),
    ] });
    assert.equal(neutral.status, 'NEUTRAL');
    assert.equal(neutral.verdict!.direction, 'UNCHANGED');
    assert.equal(neutral.verdict!.evidence, 'NOT_CONTRADICTED');
  });

  // ── 3. UNKNOWN ≠ FLAT ≠ CONFIRMED ──────────────────────────────────────
  test('silence on a risk variable passes its gate but is never counted as flat or confirmed, and is never printed as "checked, nothing material"', () => {
    // F with margin driver + volume + cash confirmed; one-offs never mentioned.
    const a = R({ pattern: 'F', variables: [...GOOD_OUTPUT, V('margin_driver', 'improving', { after: 'mix and scale' }), V('volume', 'improving', { after: '+9%' }),
      V('cash_conversion', 'improving', { after: '1.4×', delta: '+0.3×', source: 'grader' })] });
    const oo = a.checked.find((c) => c.key === 'one_offs')!;
    assert.equal(oo.verdict, 'flat', 'the gate still passes by silence');
    assert.equal(oo.silence, true);
    assert.equal(oo.readings, 0);
    assert.ok(!a.structural.confirmedLabels.includes(oo.label), 'silence is not a confirmation');
    assert.ok(!a.structural.missingRequired.includes(oo.label), 'silence still passes the gate');
    assert.equal(a.structural.gatePassed, true);
    assert.equal(a.coverage.mechanism.silent, 1);
    assert.equal(a.coverage.mechanism.flat, 0, 'silence is not flat');
    assert.equal(a.coverage.mechanism.confirmed, a.checked.filter((c) => c.weight >= 3 && c.verdict === 'improving' && c.key === 'margin_driver').length, 'only the evidenced margin driver is confirmed; silence is not');
    assert.equal(a.mechanismCheck.find((m) => m.link === oo.label)!.state, 'unchecked', 'a silent link does not hold');
    assert.doesNotMatch(a.because, /checked, nothing material/);
    assert.doesNotMatch(a.because, /one-offs checked, not material/);
    assert.match(a.because, /one-offs none disclosed in the documents read \(silence, not a confirmation\)/);
    assert.ok(a.verdict!.coverage.missing.includes('One-offs'), 'silence stays in the missing list of the verdict coverage');
  });

  test('a single reading never counts as flat or confirmed: one-reading flats are levels, two-reading flats are unchanged', () => {
    const one = R({ pattern: 'B', variables: [V('order_book', 'flat', { after: '₹1,200 Cr' })] });
    const ob1 = one.checked.find((c) => c.key === 'order_book')!;
    assert.equal(ob1.readings, 1);
    assert.equal(one.coverage.mechanism.flat, 0);
    assert.ok(one.coverage.mechanism.stated >= 1, 'a one-reading flat is a level');
    const two = R({ pattern: 'B', variables: [{ ...V('order_book', 'flat', { after: '₹1,200 Cr' }), before: '₹1,200 Cr', delta: 'FLAT' }] });
    assert.equal(two.checked.find((c) => c.key === 'order_book')!.readings, 2);
    assert.equal(two.coverage.mechanism.flat, 1);
    // An undisclosed variable is UNKNOWN: pending, never flat, never confirmed.
    const u = one.checked.find((c) => c.key === 'book_to_bill')!;
    assert.equal(u.verdict, 'unknown');
    assert.equal(u.state, 'NOT_DISCLOSED');
    assert.equal(u.readings, 0);
    assert.equal(u.silence, false);
    assert.ok(one.verdict!.coverage.missing.includes(u.label));
    // A disclosed one-off is 'checked, not material' only when judged flat on its own figures — never when silent.
    for (const a of [one, two]) assert.doesNotMatch(a.because, /checked, nothing material|unchanged/);
  });

  test('unknown is never neutral evidence: no core variable that is NOT_DISCLOSED / NOT_SEARCHED / UNCLEAR is ever confirmed, flat or a held link', () => {
    const cases = [
      ...['TI', 'E2E', 'SJS', 'GIPCL'].map((t) => liveAssess(t, t === 'TI' ? null : 'F')),
      ...bench.map((r) => assessThesis({ pattern: classifyGradedRow(r)?.pattern ?? null, variables: extractVariables(r, null), evidenceReviewed: true })),
      R({ pattern: 'F', variables: [...GOOD_OUTPUT, V('margin_driver', 'improving', { after: 'value-added mix' }), V('cash_conversion', 'deteriorating', { after: '-3.72× (last FY)', source: 'grader' })] }),
    ];
    for (const a of cases) {
      for (const c of a.checked) {
        if (c.state === 'NOT_DISCLOSED' || c.state === 'NOT_SEARCHED' || c.state === 'UNCLEAR' || c.state === 'SOURCE_UNAVAILABLE') {
          assert.ok(c.verdict !== 'improving', `${c.key} ${c.state} counted as confirmed`);
          assert.ok(!(c.verdict === 'flat' && !c.silence), `${c.key} ${c.state} counted as flat`);
          assert.ok(!a.structural.confirmedLabels.includes(c.label), `${c.key} ${c.state} in structural.confirmed`);
          const link = a.mechanismCheck.find((m) => m.link === c.label);
          if (link) assert.notEqual(link.state, 'confirmed', `${c.key} ${c.state} holds a link`);
        }
      }
      const t = a.coverage.mechanism;
      assert.equal(t.confirmed + t.pending + t.contradicted + t.stated + t.flat + t.unclear + t.not_applicable + t.silent, t.total);
    }
  });

  // ── 4. THE LABEL AGREES WITH THE VERDICT ───────────────────────────────
  test('"THESIS STRENGTHENING" appears only when evidence is CONFIRMED and direction is STRENGTHENING — on every fixture, live ledger, bench row and shape', () => {
    const shapes = [
      R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV] }),
      R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('margin_driver', 'improving', { after: 'higher lab-grown jewellery mix' })] }),
      R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('utilisation', 'improving', { after: '84%', delta: '+12pp' }), V('volume', 'improving', { after: '+12%' })] }),
      R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('utilisation', 'improving', { after: '84%', delta: '+12pp' }), V('volume', 'improving', { after: '+12%' })], evidencePeriod: 'Q4 FY24', expectedPeriod: 'Q1 FY27' }),
      R({ pattern: 'B', variables: [...GOOD_OUTPUT, V('order_intake', 'improving', { delta: '+40%' }), V('order_book', 'improving', { delta: '+25%' }), V('book_to_bill', 'improving', { after: '1.4' })] }),
      R({ pattern: 'A', evidenceReviewed: false, variables: [...GOOD_OUTPUT, LEV] }),
    ];
    const all = [
      ...shapes,
      ...['TI', 'E2E', 'SJS', 'GIPCL'].map((t) => liveAssess(t, t === 'TI' ? null : 'F')),
      ...bench.map((r) => assessThesis({ pattern: classifyGradedRow(r)?.pattern ?? null, variables: extractVariables(r, null), evidenceReviewed: true })),
      ...bench.map((r) => assessThesis({ pattern: classifyGradedRow(r)?.pattern ?? null, variables: extractVariables(r, null), evidenceReviewed: false })),
    ];
    assert.ok(all.some((a) => a.status === 'STRENGTHENING'), 'at least one green case is exercised');
    for (const a of all) {
      const v = a.verdict!;
      const green = v.evidence === 'CONFIRMED' && v.direction === 'STRENGTHENING';
      for (const text of [a.headline, a.actionLine, a.action, a.because, STATUS_META[a.status].label]) {
        if (!green) assert.doesNotMatch(text, /THESIS STRENGTHENING/, `${a.thesis.name} ${a.status} (${v.evidence}/${v.direction}): "${text.slice(0, 120)}"`);
      }
      assert.equal(a.status === 'STRENGTHENING', green, `${a.thesis.name}: status ${a.status} vs verdict ${v.evidence}/${v.direction}`);
      if (a.status === 'STRENGTHENING') assert.equal(a.headline, STRENGTHENING_SENTENCE);
      // Direction is never called from output alone.
      if (v.direction === 'STRENGTHENING') assert.ok(a.structural.gatePassed || v.coverage.confirmed * 2 >= v.coverage.applicable, a.because);
      if (v.direction === 'UNCHANGED') assert.equal(a.status, 'NEUTRAL');
      if (v.direction === 'WEAKENING') assert.ok(['WEAKENING', 'BROKEN', 'NEGATIVE_EXPECTATION_GAP'].includes(a.status));
    }
    // Stale evidence: the mechanism was confirmed on an old period — capped, and the direction says why.
    const stale = shapes[3];
    assert.equal(stale.status, 'CONFIRMATION_REQUIRED');
    assert.equal(stale.verdict!.direction, 'UNKNOWN');
    assert.match(stale.verdict!.directionWhy, /quarters old/);
  });
});

describe('zzz771 PC-2 · break-trigger and evidence wording on real shapes', () => {
  test('a fired condition on a non-critical variable (cash for A) is a financial warning, never "a break needs a second condition"', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT, V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('margin_driver', 'improving', { after: 'higher lab-grown jewellery mix' }),
      V('cash_conversion', 'deteriorating', { after: '0.43× (last FY)', source: 'grader' }),
    ] });
    const b = a.verdict!.breakTrigger;
    assert.equal(b.fired, true);
    assert.match(b.text, /^Fired \(financial warning only — not thesis-critical for this strategy, cannot move toward a break\): "Operating cash flow falls below reported profit for two quarters\."\.$/);
    assert.doesNotMatch(b.text, /a break needs/);
    assert.notEqual(a.status, 'WEAKENING');
  });

  test('live TI: WEAKENING on output while no core mechanism variable moved — evidence says where the deterioration is, never "Nothing contradicted"', () => {
    const a = liveAssess('TI', null);
    assert.equal(a.status, 'WEAKENING');
    assert.equal(a.verdict!.direction, 'WEAKENING');
    assert.doesNotMatch(a.verdict!.evidenceWhy, /Nothing contradicted/);
    assert.match(a.verdict!.evidenceWhy, /No core mechanism variable contradicted; the deterioration is in financial output: /);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz771 integration · one ratio for label, gate and chip', () => {
  test('ANTELOPUS shape: an unclassified holding confirmed only by a cash ratio (1/5) is never green', () => {
    const a = assessThesis({ pattern: null, evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('cash_conversion', 'improving', { after: '1.3×', delta: '+0.4×', source: 'grader' }),
    ] });
    assert.notEqual(a.status, 'STRENGTHENING', a.because);
    assert.notEqual(a.verdict!.evidence, 'CONFIRMED');
    assert.doesNotMatch(a.headline + a.actionLine, /THESIS STRENGTHENING/);
  });
  test('the verdict coverage equals the "Structural evidence reviewed: x/y" the card prints', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT, V('utilisation', 'improving', { after: '84%', delta: '+12pp' }), V('margin_driver', 'improving', { after: 'operating leverage and better mix' }),
    ] });
    const m = a.because.match(/(\d+)\/(\d+)/);
    assert.ok(m, a.because);
    assert.deepEqual([a.verdict!.coverage.confirmed, a.verdict!.coverage.applicable], [Number(m![1]), Number(m![2])]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz772 · status-engine defects from the owner's live page, one test per rule.
// Shapes are the live cards' own figures; nothing here is keyed to a ticker.
// ═══════════════════════════════════════════════════════════════════════════
import { EARNINGS_EXCEED_REVENUE, figureIdentity, isForwardRow, isImmaterialDecline, conditionText } from '../thesis/status';
describe('zzz772 · status engine', () => {
  const R = (x: Partial<Parameters<typeof assessThesis>[0]>) => assessThesis({ pattern: null, variables: [], evidenceReviewed: true, hasGraderRow: true, ...x } as any);
  const W = (key: string, verdict: string, o: Record<string, unknown> = {}) => ({ ...V(key, verdict), ...o }) as any;
  const noTurnNegative = (a: ReturnType<typeof R>) => {
    for (const c of a.invalidationConditions) assert.doesNotMatch(c.condition, /Earnings turn negative/);
    for (const c of a.verdict!.breakTrigger.conditions) assert.doesNotMatch(c, /Earnings turn negative/);
  };

  test('1 · an immaterial decline is shown, never deteriorates, never fires, never makes output "not improved"', () => {
    // LLOYDSENT: revenue growth −1.2% (the line is −5%).
    const rev = R({ variables: [W('revenue_growth', 'deteriorating', { delta: '-1.2%', after: '-1.2%', source: 'grader' }),
      W('earnings_growth', 'improving', { delta: '+45%', source: 'grader' }), W('margin', 'improving', { delta: '+2.0pp', source: 'grader' })] });
    assert.notEqual(rev.status, 'WEAKENING');
    assert.equal(rev.verdict!.breakTrigger.fired, false);
    const rrow = rev.checked.find((c) => c.key === 'revenue_growth')!;
    assert.equal(rrow.verdict, 'flat'); assert.equal(rrow.withinMateriality, true); assert.equal(rrow.invalidation, null);
    assert.ok(rev.invalidationConditions.every((c) => c.status !== 'fired'));
    // RISHABH: earnings growth −1.4% (the line is −10%).
    const earn = R({ variables: [W('revenue_growth', 'improving', { delta: '+20%', source: 'grader' }),
      W('earnings_growth', 'deteriorating', { delta: '-1.4%', before: '100 Cr', after: '98.6 Cr', source: 'grader' }), W('margin', 'improving', { delta: '+2.0pp', source: 'grader' })] });
    assert.notEqual(earn.status, 'WEAKENING');
    assert.equal(earn.verdict!.breakTrigger.fired, false);
    noTurnNegative(earn);
    // AETHER: margin −1.0pp with revenue +27.2% — no trigger, and the direction says output improved.
    const ae = R({ variables: [W('revenue_growth', 'improving', { delta: '+27.2%', source: 'grader' }),
      W('earnings_growth', 'improving', { delta: '+34%', before: '47 Cr', after: '63 Cr', source: 'grader' }),
      W('margin', 'deteriorating', { before: '32.0%', after: '31.0%', delta: '-1.0pp', source: 'filing' })] });
    assert.equal(ae.verdict!.breakTrigger.fired, false);
    assert.doesNotMatch(ae.verdict!.directionWhy, /output did not improve/);
    assert.match(ae.verdict!.directionWhy, /^output improved/);
    // A material decline still fires — phrased as a material decline, not "turn negative".
    const mat = R({ variables: [W('revenue_growth', 'improving', { delta: '+20%', source: 'grader' }),
      W('earnings_growth', 'deteriorating', { delta: '-30.3%', before: '249 Cr', after: '174 Cr', source: 'grader' })] });
    assert.equal(mat.verdict!.breakTrigger.fired, true);
    assert.deepEqual(mat.verdict!.breakTrigger.conditions, ['Earnings decline materially — down 10% or more year on year.']);
    noTurnNegative(mat);
    assert.equal(conditionText('earnings_growth' as any, 'Earnings turn negative.', { after: '-12 Cr', verdict: 'deteriorating' }), 'Earnings turn into a loss.');
    // The lines themselves: −5% revenue, −10% earnings, −3pp margin are material.
    assert.equal(isImmaterialDecline({ key: 'revenue_growth' as any, delta: '-4.9%' }), true);
    assert.equal(isImmaterialDecline({ key: 'revenue_growth' as any, delta: '-5%' }), false);
    assert.equal(isImmaterialDecline({ key: 'earnings_growth' as any, delta: '-9.9%' }), true);
    assert.equal(isImmaterialDecline({ key: 'earnings_growth' as any, delta: '-10%' }), false);
    assert.equal(isImmaterialDecline({ key: 'margin' as any, delta: '-3.0pp' }), false);
    assert.equal(isImmaterialDecline({ key: 'margin' as any, delta: '-2.9pp' }), true);
  });

  test('2 · one ratio: the status line prints the same x/y as the verdict (structural ∪ drivers)', () => {
    // UNIMECH shape: status line said 1/5, verdict 4/8.
    const a = R({ variables: [W('revenue_growth', 'improving', { delta: '+71.4%', source: 'grader' }),
      W('earnings_growth', 'improving', { delta: '+47.4%', source: 'grader' }), W('margin', 'improving', { delta: '+5.0pp', source: 'grader' }),
      W('cash_conversion', 'flat', { after: '0.97× (last FY)', source: 'grader' }),
      W('order_book', 'deteriorating', { after: 'approximately INR280 crores' }),
      W('working_capital', 'deteriorating', { after: 'approximately 130 days' }),
      W('new_customer', 'improving', { after: 'two new aerospace customers onboarded' }),
      W('qualification', 'improving', { after: 'AS9100 audit cleared' }),
      W('margin_driver', 'improving', { after: 'favourable product mix' })] });
    const m = a.because.match(/Structural evidence reviewed: (\d+)\/(\d+)/);
    assert.ok(m, a.because);
    assert.deepEqual([Number(m![1]), Number(m![2])], [a.verdict!.coverage.confirmed, a.verdict!.coverage.applicable]);
    assert.deepEqual([a.verdict!.coverage.confirmed, a.verdict!.coverage.applicable], [3, 8]);
  });

  test('3 · missing ≠ contradicted: a variable that moved the wrong way is listed as contradicted, never missing', () => {
    // MOREPENLAB: F, profit jump, cash conversion 0.34×.
    const a = R({ pattern: 'F', variables: [W('revenue_growth', 'improving', { delta: '+34.1%', source: 'grader' }),
      W('earnings_growth', 'improving', { delta: '+409.1%', source: 'grader' }), W('margin', 'improving', { delta: '+8.0pp', source: 'grader' }),
      W('cash_conversion', 'deteriorating', { after: '0.34× (last FY)', source: 'grader' })] });
    const cov = a.verdict!.coverage;
    assert.equal(a.verdict!.evidence, 'CONTRADICTED');
    assert.ok(!cov.missing.includes('Cash conversion'), cov.missing.join(', '));
    assert.deepEqual(cov.contradicted, ['Cash conversion']);
    assert.equal(cov.missing.length + cov.contradicted!.length, cov.applicable - cov.confirmed);
  });

  test('4 · a target is never a driver and never structurally confirmed', () => {
    const OUT = [W('revenue_growth', 'improving', { delta: '+23.4%', source: 'grader' }), W('earnings_growth', 'improving', { delta: '+20.6%', source: 'grader' }),
      W('margin', 'improving', { delta: '+1.0pp', source: 'grader' }), W('cash_conversion', 'improving', { after: '1.91× (last FY)', source: 'grader' })];
    const target = W('capacity_addition', 'improving', { after: 'Post-expansion target c.27 MTPA by FY31', statement: 'ACTUAL' });
    const a = R({ variables: [...OUT, W('capacity', 'improving', { before: '0.25 MT', after: '0.4 MT', delta: '+60%' }),
      target, W('margin_driver', 'improving', { after: 'improved product mix, more value-added products' })] });
    assert.notEqual(a.status, 'STRENGTHENING', a.because);
    assert.ok(!a.because.includes('c.27 MTPA'), 'a target is not listed as an evidenced driver');
    assert.equal(isForwardRow(target), true);
    assert.equal(isForwardRow({ after: '80,000 sq. ft. hangar; planned ~100,000 sq. ft.' }), false, 'the leading clause is an actual');
    assert.equal(isForwardRow({ after: 'faster-than-expected break-even of new hubs' }), false);
    assert.equal(isForwardRow({ after: '70%', statement: 'TARGET' }), true);
    assert.equal(isForwardRow({ after: 'Imperial Blue reintroduction expected to reaccess customers' }), true);
    // Structural confirmation too (A: capacity_addition is structural).
    const b = R({ pattern: 'A', variables: [...OUT, W('capacity_addition', 'improving', { after: '27 MTPA by FY31' })] });
    assert.ok(!b.structural.confirmedLabels.includes('capacity_addition'));
  });

  test('5 · the same figure under two variables counts once', () => {
    // SANSERA: "80k sq. ft." installed capacity and "80,000 sq. ft." capacity added.
    const OUT = [W('revenue_growth', 'improving', { delta: '+25%', source: 'grader' }), W('earnings_growth', 'improving', { delta: '+30%', source: 'grader' }),
      W('margin', 'improving', { delta: '+2.0pp', source: 'grader' })];
    const both = R({ variables: [...OUT, W('capacity', 'improving', { after: 'Addition of 80k sq. ft. manufacturing capacity' }),
      W('capacity_addition', 'improving', { after: '80,000 sq. ft. hangar' })] });
    const one = R({ variables: [...OUT, W('capacity', 'improving', { after: 'Addition of 80k sq. ft. manufacturing capacity' })] });
    assert.equal(both.verdict!.coverage.confirmed, one.verdict!.coverage.confirmed);
    assert.equal(both.verdict!.coverage.applicable, one.verdict!.coverage.applicable);
    assert.equal(figureIdentity('Addition of 80k sq. ft.'), figureIdentity('80,000 sq. ft. hangar'));
    assert.notEqual(figureIdentity('80,000 sq. ft.'), figureIdentity('80,000 MT'));
    assert.equal(figureIdentity('80,000'), null, 'a bare number is not an identity');
  });

  test('6 · a not-established list never prints a bare "(flat)"', () => {
    // SFL / BHAGCHEM / AETHER: "cash conversion (flat)", "one-offs (flat)".
    const a = R({ variables: [W('revenue_growth', 'improving', { delta: '+27.2%', source: 'grader' }),
      W('cash_conversion', 'flat', { after: '0.65× (last FY)', source: 'grader' })] });
    assert.doesNotMatch(a.because, /\(flat\)/);
    assert.doesNotMatch(a.verdict!.evidenceWhy, /\(flat\)/);
    assert.match(a.because, /cash conversion \(single reading: 0\.65× \(last FY\)\)/);
  });

  test('7 · evidence older than the expected period is INCOMPLETE, and the status line opens with it', () => {
    // MINDSPACE: Q4 FY24 evidence, card read "2/4 confirmed … partially confirmed".
    const a = R({ pattern: 'A', evidencePeriod: 'Q4 FY24', expectedPeriod: 'Q1 FY27', variables: [
      W('revenue_growth', 'improving', { delta: '+27.8%', source: 'grader' }), W('earnings_growth', 'improving', { delta: '+62.9%', source: 'grader' }),
      W('margin', 'improving', { delta: '+1.0pp', source: 'grader' }),
      W('capacity_addition', 'improving', { before: '0.24 msf', after: '4.4 msf', delta: '+4.16 msf' }),
      W('volume', 'improving', { after: '+12%', delta: '+12%' })] });
    const why = "Evidence is Q4 FY24, 9 quarters older than Q1 FY27 — too old to confirm or contradict today's mechanism.";
    assert.equal(a.verdict!.evidence, 'INCOMPLETE');
    assert.equal(a.verdict!.evidenceWhy, why);
    assert.ok(a.because.startsWith(why) || a.because.startsWith('The evidence on file is Q4 FY24 — too old'), a.because);
    assert.notEqual(a.status, 'STRENGTHENING');
  });

  test('8 · earnings larger than revenue for the same period are UNCLEAR, not judged', () => {
    // LLOYDSENT: revenue 613.01 → 605.44 Crore beside earnings 342.73 → 1,200.65 Crore.
    const a = R({ variables: [
      W('revenue_growth', 'deteriorating', { before: '613.01 Crore', after: '605.44 Crore', delta: '-1.2%' }),
      W('earnings_growth', 'improving', { before: '342.73 Crore', after: '1,200.65 Crore', delta: '+250.3%' }),
      W('margin', 'improving', { delta: '+9.0pp', source: 'grader' })] });
    const e = a.checked.find((c) => c.key === 'earnings_growth')!;
    assert.equal(e.state, 'UNCLEAR');
    assert.equal(e.stateReason, EARNINGS_EXCEED_REVENUE);
    assert.notEqual(e.verdict, 'improving');
    assert.notEqual(a.status, 'WEAKENING');
    // Ordinary bases are untouched.
    const ok = R({ variables: [W('revenue_growth', 'improving', { before: '613 Crore', after: '705 Crore', delta: '+15%' }),
      W('earnings_growth', 'improving', { before: '42 Crore', after: '60 Crore', delta: '+42.9%' })] });
    assert.equal(ok.checked.find((c) => c.key === 'earnings_growth')!.verdict, 'improving');
  });

  test('9 · a growth rate is two readings, and a small non-zero move is "within materiality", not flat', () => {
    // JINDRILL: "Revenue growth +8.4% · single reading".
    const a = R({ variables: [W('revenue_growth', 'flat', { after: '+8.4%', source: 'grader' }),
      W('earnings_growth', 'flat', { after: '+18.5%', source: 'grader' }), W('margin', 'flat', { delta: '+0.0pp', source: 'grader' })] });
    const rev = a.checked.find((c) => c.key === 'revenue_growth')!;
    const earn = a.checked.find((c) => c.key === 'earnings_growth')!;
    const mar = a.checked.find((c) => c.key === 'margin')!;
    assert.equal(rev.readings, 2); assert.equal(earn.readings, 2);
    assert.equal(rev.withinMateriality, true); assert.equal(earn.withinMateriality, true);
    assert.equal(mar.withinMateriality, false, 'a zero move is unchanged, not "within materiality"');
  });
});

describe('zzz772 integration · a fall the company calls marginal is within materiality', () => {
  test('UNIMECH shape: "marginally lower" order book with no figure is not a contradiction', () => {
    const a = assessThesis({ pattern: 'B', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      { key: 'order_book', label: 'Order book', before: null, after: 'approximately INR280 crores', delta: null, verdict: 'deteriorating',
        evidence: 'Our consolidated order book stood at approximately INR280 crores, marginally lower than the level indicated earlier.', source: 'filing' } as any,
    ] });
    assert.notEqual(a.status, 'WEAKENING', a.because);
    assert.ok(!(a.verdict!.coverage as any).contradicted?.includes('Order book'));
  });
  test('a stated fall with a figure is still judged by its size', () => {
    assert.equal(selfDescribedMarginal({ before: '300 Cr', after: '280 Cr', evidence: 'marginally lower' }), false);
  });
});
