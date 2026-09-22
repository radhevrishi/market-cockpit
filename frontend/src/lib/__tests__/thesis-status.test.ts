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
const NO_ACTION = /^NO THESIS ACTION TRIGGERED — no thesis-specific break condition fired\. Structural evidence reviewed: (\d+)\/(\d+) variables confirmed\. Financial output: [^.]+/;

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
      V('volume', 'improving', { after: '+12%' }),
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
    assert.equal(a.action, 'NO THESIS ACTION TRIGGERED');
    assert.equal(a.headline, STRENGTHENING_SENTENCE);
    const m = a.actionLine.match(NO_ACTION);
    assert.ok(m, a.actionLine);
    // A's structural set in its ledger: utilisation, volume, capacity, capacity addition,
    // operating leverage (grader → output, excluded). Two confirmed of four.
    assert.equal(`${m![1]}/${m![2]}`, '2/4');
    assert.equal(`${a.structural.confirmed}/${a.structural.total}`, '2/4');
    assert.match(a.because, /Financial output: revenue \+30% · earnings \+45% · margin \+2\.0pp\./);
    assert.match(a.because, /THESIS STRENGTHENING — structural mechanism confirmed and supporting output confirmed/);
  });

  test('A · the same numbers without volume are CONFIRMATION REQUIRED, output-only sentence', () => {
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      ...GOOD_OUTPUT,
      V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('utilisation', 'improving', { after: '84%', delta: '+12pp' }),
      V('margin_driver', 'improving', { after: 'absorption' }),
    ] });
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.ok(a.because.startsWith(OUTPUT_ONLY_SENTENCE), a.because);
    assert.equal(a.headline, 'CONFIRMATION REQUIRED — financial output improved, but the structural mechanism is not yet fully established.');
    assert.deepEqual(a.structural.missingRequired, ['Volume']);
  });

  test('B · green needs order intake, order book and book-to-bill each confirmed', () => {
    const orders = [V('order_intake', 'improving', { delta: '+40%' }), V('order_book', 'improving', { delta: '+25%' }), V('book_to_bill', 'improving', { after: '1.4' })];
    const full = assessThesis({ pattern: 'B', evidenceReviewed: true, variables: [...GOOD_OUTPUT, ...orders] });
    assert.equal(full.status, 'STRENGTHENING');
    assert.match(full.actionLine, NO_ACTION);
    const flatBtb = assessThesis({ pattern: 'B', evidenceReviewed: true, variables: [...GOOD_OUTPUT, orders[0], orders[1], V('book_to_bill', 'flat', { after: '1.0' })] });
    assert.equal(flatBtb.status, 'CONFIRMATION_REQUIRED');
    assert.ok(flatBtb.because.startsWith(OUTPUT_ONLY_SENTENCE));
  });

  test('F · live SJS: margin driver + one-offs cleared + cash → green, 3/3', () => {
    const a = liveAssess('SJS', 'F');
    assert.equal(a.status, 'STRENGTHENING');
    const m = a.actionLine.match(NO_ACTION);
    assert.ok(m, a.actionLine);
    assert.equal(`${m![1]}/${m![2]}`, '3/3');
  });

  test('F · live GIPCL: output up, margin driver never disclosed → output-only CONFIRMATION REQUIRED', () => {
    const a = liveAssess('GIPCL', 'F');
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.ok(a.because.startsWith(OUTPUT_ONLY_SENTENCE), a.because);
    assert.deepEqual(a.structural.missingRequired, ['Margin driver']);
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
  test('live TI (PAT −30%, CFO negative) stays WEAKENING', () => {
    const a = liveAssess('TI', null);
    assert.equal(a.status, 'WEAKENING');
    assert.match(a.because, /single cash-conversion reading is a review prompt/);
  });

  test('TI with guidance cut on top still does not break — the only core condition fired is cash', () => {
    const l = live.ledgers.TI;
    const vars = extractVariables(l.graded, { ...l.summary, events: l.events, guidance: { action: 'lowered', detail: 'x' } });
    const a = assessThesis({ pattern: null, variables: vars, evidenceReviewed: true, hasGraderRow: true });
    assert.notEqual(a.status, 'BROKEN');
    assert.equal(a.status, 'WEAKENING');
  });

  test('live E2E (F, cash −7.84×) is WEAKENING at most', () => {
    const a = liveAssess('E2E', 'F');
    assert.equal(a.status, 'WEAKENING');
  });

  test('F · cash + a material one-off: only the one-off counts towards a break', () => {
    const vars = [...GOOD_OUTPUT, V('cash_conversion', 'deteriorating', { after: '0.2×', source: 'grader' }), V('one_offs', 'deteriorating', { after: '1 item' }), V('margin_driver', 'improving')];
    assert.equal(assessThesis({ pattern: 'F', evidenceReviewed: true, variables: vars }).status, 'WEAKENING');
  });

  test('A and B · cash alone never weakens a strategy where cash is not core — it is shown as context', () => {
    for (const pattern of ['A', 'B'] as const) {
      const a = assessThesis({ pattern, evidenceReviewed: true, variables: [
        ...GOOD_OUTPUT, V('cash_conversion', 'deteriorating', { after: '-3.1×', source: 'grader' }),
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
