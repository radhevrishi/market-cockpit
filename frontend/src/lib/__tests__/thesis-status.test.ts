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
import { assessThesis, OUTPUT_ONLY_SENTENCE, STRENGTHENING_SENTENCE } from '../thesis/status';
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

  test('A · one evidenced driver is enough (zzz765); an undisclosed core is listed as still to confirm', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('utilisation', 'improving', { after: '84%', delta: '+12pp' }),
      V('margin_driver', 'improving', { after: 'better product mix and operating leverage' }),
    ] });
    assert.equal(a.status, 'STRENGTHENING');
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

  test('A · MANINDS shape: target-only utilisation no longer blocks green when a stated margin driver is evidenced', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '2.8×', source: 'grader' }),
      V('utilisation', 'stated', { after: 'target 50% to 60%', statement: 'TARGET', kind: 'claim' } as any),
      V('capacity_addition', 'stated', { after: '22,000 MTPA' }),
      V('margin_driver', 'improving', { after: "optimized product and geographic mix and higher share of value-added/coated orders" }),
    ] });
    assert.equal(a.status, 'STRENGTHENING', a.because);
    assert.match(a.because, /Still to confirm next quarter: utilisation/);
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

  test('F · live GIPCL: margin driver not disclosed, but 600 MW commissioned capacity explains the jump → green, driver named', () => {
    const a = liveAssess('GIPCL', 'F');
    assert.equal(a.status, 'STRENGTHENING', a.because);
    assert.match(a.because, /capacity added/i);
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

  test('G · every thesis-critical variable reviewed and flat → NO MATERIAL CHANGE; a level-only one is not enough', () => {
    const flatB = [
      V('order_book', 'flat', { after: '₹1,200 Cr' }), V('book_to_bill', 'flat', { after: '1.0' }), V('order_intake', 'flat', { after: '₹300 Cr' }),
      V('capacity', 'flat', { after: '40,000 t' }), V('margin', 'flat', { after: '14%', source: 'grader' }), V('revenue_visibility', 'flat', { after: '2.1 years' }),
      V('revenue_growth', 'flat', { after: '+2%', source: 'grader' }),
    ];
    const a = R({ pattern: 'B', variables: flatB });
    fixtures.G = a;
    assert.equal(a.status, 'NEUTRAL', a.because);
    assert.ok(a.actionLine.startsWith('NO MATERIAL CHANGE — '), a.actionLine);
    const levelOnly = R({ pattern: 'B', variables: flatB.map((v) => (v.key === 'revenue_visibility' ? V('revenue_visibility', 'stated', { after: '2.1 years' }) : v)) });
    assert.notEqual(levelOnly.status, 'NEUTRAL', 'a level with nothing to compare is not "nothing changed"');
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
    assert.equal(a.coverage.mechanism.pending + a.coverage.mechanism.not_applicable + a.coverage.mechanism.confirmed + a.coverage.mechanism.contradicted
      + a.coverage.mechanism.stated + a.coverage.mechanism.flat + a.coverage.mechanism.unclear, a.coverage.mechanism.total);
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
    // Volume (the same absorption mechanism) evidenced → green is available.
    const withVolume = R({ pattern: 'A', variables: [...GOOD_OUTPUT, LEV, V('volume', 'improving', { after: '+18% tonnage' })] });
    assert.equal(withVolume.status, 'STRENGTHENING');
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
