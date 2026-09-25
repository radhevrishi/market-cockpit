// zzz802 — India Portfolio Catalysts: "only 2 thesis strong and 50+
// confirmation needed". Root causes fixed here, each tested:
//   1. a nearest-fit (provisional) type was capped at CONFIRMATION REQUIRED
//      however much the filings confirmed → promotion rule;
//   2. type A's only core mechanism check was utilisation, which Indian
//      companies rarely publish, so no A name could ever read STRENGTHENING →
//      filed alternates (volume, capacity added / commissioned, stated
//      operating leverage) satisfy it, India only;
//   3. status-distribution sanity on the fixtures in the repo (and on the live
//      harness when it is on this machine).
//
// Run: npx tsx --test src/lib/__tests__/zzz802-india-pc-status.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { assessThesis, PROVISIONAL_BLOCKED, UTILISATION_ALTERNATES } from '../thesis/status';
import { promotionFromFilings, promotedType, PROMOTE_MIN_CONFIRMED, TYPE_CORE_CHECKS, provisionalType } from '../thesis/provisional-type';
import { applyLedger, assessBookRow } from '../thesis/use-book';
import { migrateLedger } from '../thesis/evidence-ledger';
import { classifyOrNearest } from '../earnings/pattern-abfg';
import { universeCounts } from '../thesis/evidence-counts';

const FX = join(__dirname, 'fixtures');
const LIVE_DIR = process.env.PC_LIVE_DIR || '/tmp/claude-0/-home-claude/2a0c2ebb-646f-5f80-9739-6dea50423a8e/scratchpad';
const HAVE_LIVE = existsSync(join(LIVE_DIR, 'ledgers_live.json')) && existsSync(join(LIVE_DIR, 'graded_live.json'));

/** A variable row as extractVariables emits it. */
const V = (key: string, verdict: string, o: { after?: string; delta?: string; source?: 'grader' | 'filing'; kind?: string; before?: string } = {}) => ({
  key, label: key, before: o.before ?? null, after: o.after ?? (verdict === 'stated' ? '1' : null), delta: o.delta ?? null,
  verdict, evidence: `${key} evidence`, source: o.source ?? 'filing', kind: o.kind ?? 'fact', statement: 'ACTUAL',
}) as any;
const GOOD_OUTPUT = [
  V('revenue_growth', 'improving', { delta: '+26.8%', source: 'grader' }),
  V('earnings_growth', 'improving', { delta: '+37.9%', source: 'grader' }),
  V('margin', 'improving', { delta: '+2.0pp', source: 'grader' }),
];
/** An A name the way Indian filings usually read: utilisation a bare level,
 *  volume and capacity added stated, a margin driver naming operating leverage. */
const A_INDIA = [
  ...GOOD_OUTPUT,
  V('utilisation', 'stated', { after: '59%' }),
  V('volume', 'improving', { after: 'Finished goods volumes 17,793 MT from 14,457 MT (+23.1% YoY)' }),
  V('capacity_addition', 'improving', { after: 'capacity added 4,000 tons' }),
  V('margin_driver', 'improving', { after: 'EBITDA margin up ~275 bps, supported by operating leverage and a richer product mix' }),
];
const run = (vars: any[], extra: any = {}) => assessThesis({ pattern: 'A', variables: vars, evidenceReviewed: true, hasGraderRow: true, ...extra });

describe('zzz802 · type A — utilisation alternates (India only)', () => {
  test('the alternates are the absorption mechanism in other words', () => {
    for (const k of ['volume', 'capacity_addition', 'commissioning', 'capex_earning', 'operating_leverage']) assert.ok(UTILISATION_ALTERNATES.includes(k as any), k);
    assert.ok(!UTILISATION_ALTERNATES.includes('margin_driver' as any), 'a bare margin driver is not absorption');
  });

  test('India: filed volume + capacity added satisfy the core check → STRENGTHENING, and the card says which alternate', () => {
    const a = run(A_INDIA, { indiaDisclosure: true });
    assert.equal(a.status, 'STRENGTHENING', a.because);
    assert.match(String(a.utilisationAlternate), /Utilisation is a level only \(59%\) — no direction on file; the core absorption check is satisfied by an alternate stated in the filings: /);
    assert.match(a.because, /satisfied by an alternate stated in the filings/);
    // Utilisation itself is never counted as confirmed — it stays open.
    assert.ok(!a.structural.confirmedLabels.includes('utilisation'));
    assert.ok(a.verdict!.coverage.missing.some((m) => /utilisation/i.test(m)), 'utilisation still listed as open');
  });

  test('US (no indiaDisclosure): exactly the old behaviour — utilisation must itself be confirmed', () => {
    const a = run(A_INDIA);
    assert.notEqual(a.status, 'STRENGTHENING');
    assert.equal(a.utilisationAlternate, null);
  });

  test('unknown stays unknown: silent utilisation + only a mix / pricing driver → no alternate, not STRENGTHENING', () => {
    const a = run([...GOOD_OUTPUT, V('margin_driver', 'improving', { after: 'richer product mix and better realisations' })], { indiaDisclosure: true });
    assert.equal(a.utilisationAlternate, null);
    assert.notEqual(a.status, 'STRENGTHENING');
    assert.ok(!['WEAKENING', 'BROKEN'].includes(a.status), 'unknown is never negative');
  });

  test('a utilisation figure that FELL is never overridden by an alternate', () => {
    const a = run([...A_INDIA.filter((v) => v.key !== 'utilisation'), V('utilisation', 'deteriorating', { before: '82%', after: '71%', delta: '-11pp' })], { indiaDisclosure: true });
    assert.equal(a.utilisationAlternate, null);
    assert.notEqual(a.status, 'STRENGTHENING');
  });

  test('a target / management claim is not an alternate', () => {
    const vars = [...GOOD_OUTPUT, V('capacity_addition', 'improving', { after: 'to add 10,000 tons by FY28 (target)', kind: 'claim' }),
      V('margin_driver', 'improving', { after: 'mix' })];
    assert.equal(run(vars, { indiaDisclosure: true }).utilisationAlternate, null);
  });

  test('stated operating leverage (a margin driver in the company\'s words) is an alternate', () => {
    const a = run([...GOOD_OUTPUT, V('margin_driver', 'improving', { after: 'margin expansion driven by operating leverage on higher volumes' }),
      V('product_mix', 'improving', { after: 'value-added share up to 41%' })], { indiaDisclosure: true });
    assert.match(String(a.utilisationAlternate), /operating leverage/);
  });
});

describe('zzz802 · provisional type promotion', () => {
  const S = (key: string, state: string, role: 'structural' | 'driver' = 'structural', figure: string | null = null) => ({ key, label: key.replace(/_/g, ' '), state, role, figure });
  const chk = (key: string, source = 'filing', kind: string | null = 'fact') => ({ key, source, kind });
  const nearestA = { pattern: 'A', fit: 'nearest', ratio: null, because: 'Nearest fit (auto, provisional) — A · operating inflection: revenue +27% (results for Jun 2026). Worked out from the company\'s own figures, not confirmed by you.', exitCondition: 'x', fallback: true, weak: false } as any;

  test('3 of 5 checks confirmed from filings (the HAPPYFORGE shape) → promoted, with the plain-English reason', () => {
    const pr = promotionFromFilings(nearestA, {
      evidenceReviewed: true, freshnessState: 'CURRENT',
      structuralStates: [S('utilisation', 'level_only'), S('volume', 'confirmed', 'structural', '17,793 MT (+23.1%)'), S('capacity_addition', 'confirmed', 'driver', '4,000 tons'), S('capacity', 'level_only'), S('margin_driver', 'confirmed', 'driver', 'operating leverage')],
      checked: [chk('volume'), chk('utilisation')],
    });
    assert.equal(pr.promoted, true, pr.why);
    assert.equal(pr.confirmedCount, 3);
    assert.match(pr.why, /^Type confirmed from filings: 3 of 5 of the A · operating inflection checks confirmed from the company's filed figures — /);
    const p = promotedType(nearestA, pr) as any;
    assert.equal(p.fit, 'exact'); assert.equal(p.promoted, true); assert.equal(p.fallback, true, 're-derived every pass');
    assert.match(p.because, /^Type confirmed from filings:/);
    assert.match(p.because, /the owner's choice in the picker still wins/);
  });

  test('weak fits stay provisional, whatever the filings say', () => {
    const pr = promotionFromFilings({ ...nearestA, weak: true }, { evidenceReviewed: true, structuralStates: [S('volume', 'confirmed'), S('capacity', 'confirmed')], checked: [chk('volume'), chk('capacity')] });
    assert.equal(pr.promoted, false); assert.match(pr.why, /weak fit/);
  });

  test(`fewer than ${PROMOTE_MIN_CONFIRMED} filed checks, under 40%, or no core check → stays provisional`, () => {
    const one = promotionFromFilings(nearestA, { evidenceReviewed: true, structuralStates: [S('utilisation', 'pending'), S('volume', 'confirmed'), S('capacity_addition', 'pending'), S('capacity', 'pending')], checked: [chk('volume')] });
    assert.equal(one.promoted, false);
    const thin = promotionFromFilings(nearestA, { evidenceReviewed: true,
      structuralStates: [S('utilisation', 'pending'), S('volume', 'confirmed'), S('capacity_addition', 'pending'), S('capacity', 'pending'), S('working_capital', 'pending', 'driver'), S('margin_driver', 'confirmed', 'driver')],
      checked: [chk('volume')] });
    assert.equal(thin.promoted, false, '2 of 6 is under 40%'); assert.match(thin.why, /40%/);
    const noCore = promotionFromFilings(nearestA, { evidenceReviewed: true,
      structuralStates: [S('utilisation', 'pending'), S('volume', 'pending'), S('working_capital', 'confirmed', 'driver'), S('margin_driver', 'confirmed', 'driver')], checked: [] });
    assert.equal(noCore.promoted, false); assert.match(noCore.why, /core mechanism/);
    assert.ok(TYPE_CORE_CHECKS.A.includes('volume') && TYPE_CORE_CHECKS.B.includes('order_book'));
  });

  test('independent FILED evidence only: a grader ratio, a claim and cash conversion never count; one figure counts once', () => {
    const grader = promotionFromFilings(nearestA, { evidenceReviewed: true,
      structuralStates: [S('volume', 'confirmed'), S('capacity', 'confirmed'), S('utilisation', 'pending')], checked: [chk('volume', 'grader'), chk('capacity', 'filing', 'claim')] });
    assert.equal(grader.promoted, false);
    const cash = promotionFromFilings({ ...nearestA, pattern: 'F' }, { evidenceReviewed: true,
      structuralStates: [S('cash_conversion', 'confirmed'), S('margin_driver', 'confirmed', 'driver'), S('one_offs', 'pending')], checked: [chk('cash_conversion')] });
    assert.equal(cash.promoted, false, 'cash conversion is earnings quality, not a mechanism');
    const dup = promotionFromFilings(nearestA, { evidenceReviewed: true,
      structuralStates: [S('capacity_addition', 'confirmed', 'driver', '~69,000–70,000 MTPA (Texas)'), S('capacity', 'confirmed', 'driver', '~69,000–70,000 MTPA'), S('utilisation', 'pending'), S('volume', 'pending')], checked: [] });
    assert.equal(dup.promoted, false, 'the same figure printed twice is one check');
    assert.equal(dup.confirmedCount, 1);
  });

  test('contradicted mechanism, stale evidence or nothing read → stays provisional', () => {
    const base = [S('volume', 'confirmed'), S('capacity_addition', 'confirmed', 'driver', '4,000 t'), S('utilisation', 'pending')];
    assert.equal(promotionFromFilings(nearestA, { evidenceReviewed: true, structuralStates: [...base, S('capacity', 'contradicted')], checked: [chk('volume')] }).promoted, false);
    assert.equal(promotionFromFilings(nearestA, { evidenceReviewed: true, freshnessState: 'STALE', structuralStates: base, checked: [chk('volume')] }).promoted, false);
    assert.equal(promotionFromFilings(nearestA, { evidenceReviewed: false, structuralStates: base, checked: [chk('volume')] }).promoted, false);
    assert.equal(promotionFromFilings({ ...nearestA, fit: 'exact' }, { evidenceReviewed: true, structuralStates: base, checked: [chk('volume')] }).promoted, false, 'only a nearest fit is promoted');
  });

  test('end to end on the engine: provisional reads CONFIRMATION REQUIRED; promoted, the same evidence reads STRENGTHENING', () => {
    const prov = run(A_INDIA, { indiaDisclosure: true, patternFit: 'nearest' });
    assert.equal(prov.status, 'CONFIRMATION_REQUIRED');
    assert.match(prov.because, /^Provisional thesis/);
    const pr = promotionFromFilings(nearestA, { evidenceReviewed: true, freshnessState: (prov as any).evidenceFreshness?.state,
      structuralStates: prov.structuralStates as any, checked: prov.checked as any });
    assert.equal(pr.promoted, true, pr.why);
    const conf = run(A_INDIA, { indiaDisclosure: true, patternFit: 'exact' });
    assert.equal(conf.status, 'STRENGTHENING');
  });

  test('through the page\'s row builder: a US row is never promoted, the owner\'s type is never touched', () => {
    const g = { ticker: 'TEST', source: 'screener-live', sales_yoy_pct: 20.6, eps_yoy_pct: 22.2, opm_pct: 15, opm_prev_pct: 14 };
    const us: any = assessBookRow({ symbol: 'TEST', origin: 'book', market: 'US', graded: g, pattern: provisionalType(g, null), state: 'idle' } as any);
    assert.ok(!us.pattern?.promoted);
    const inNoDoc: any = assessBookRow({ symbol: 'TEST', origin: 'book', market: 'IN', graded: g, pattern: null, state: 'idle' } as any);
    assert.equal(inNoDoc.pattern.fit, 'nearest', 'nothing read → never promoted');
  });
});

// ── STATUS DISTRIBUTION SANITY ──────────────────────────────────────────────
function buildRow(t: string, raw: any | null, g: any | null, fresh: any | null): any {
  const row0: any = { symbol: t, origin: 'book', market: 'IN', graded: g, tier: g?.tier || null, pattern: g ? classifyOrNearest(g) : null,
    radarScore: null, summary: null, sourceUrl: null, state: 'idle', assessment: null, capex: null, promiseNote: null, dataSource: g ? 'screener.in data' : null };
  return raw ? applyLedger(row0, migrateLedger(raw), fresh) : assessBookRow(row0);
}
function invariants(rows: any[]) {
  for (const r of rows) {
    const a = r.assessment; const s = a.status;
    assert.ok(!(r.pattern?.fit === 'nearest' && PROVISIONAL_BLOCKED.has(s)), `${r.symbol}: provisional type read ${s}`);
    if (r.pattern?.promoted) assert.match(String(r.pattern.because), /^Type confirmed from filings: \d+ of \d+/, r.symbol);
    if (s === 'STRENGTHENING') assert.equal(a.verdict.evidence, 'CONFIRMED', `${r.symbol}: green over unconfirmed evidence`);
    assert.doesNotMatch(`${a.because} ${a.actionLine}`, /\b(BUY|SELL)\b|target price|stop[- ]loss/, r.symbol);
    assert.ok(['STRENGTHENING', 'ON_TRACK', 'NEUTRAL', 'CONFIRMATION_REQUIRED', 'EVIDENCE_INCOMPLETE', 'WEAKENING', 'BROKEN',
      'POSITIVE_EXPECTATION_GAP', 'NEGATIVE_EXPECTATION_GAP', 'THESIS_NOT_SET'].includes(s), `${r.symbol}: ${s} is not in the fixed status set`);
    if (r.pattern) assert.ok(['A', 'B', 'F', 'G'].includes(r.pattern.pattern), r.symbol);
  }
}

describe('zzz802 · status distribution sanity (fixtures in the repo)', () => {
  const named = JSON.parse(readFileSync(join(FX, 'zzz790-pc-named.json'), 'utf8'));
  const untyped = JSON.parse(readFileSync(join(FX, 'zzz794-in-thesis-type-untyped.json'), 'utf8'));
  const rows = [
    ...Object.keys(named.ledgers).map((t) => buildRow(t, named.ledgers[t], named.graded[t] && named.graded[t].source !== 'none' ? named.graded[t] : null, named.freshness[t] || null)),
    ...Object.keys(untyped.rows).map((t) => assessBookRow({ symbol: t, origin: 'book', market: 'IN', graded: untyped.rows[t].graded, tier: null,
      pattern: classifyOrNearest(untyped.rows[t].graded), summary: untyped.rows[t].summary, state: 'idle' } as any)),
  ];
  test('38 rows, every rule holds', () => { assert.equal(rows.length, 38); invariants(rows); });
  test('the header line reconciles and names promoted types when there are any', () => {
    const uc = universeCounts(rows, rows, ['STRENGTHENING', 'ON_TRACK', 'CONFIRMATION_REQUIRED', 'POSITIVE_EXPECTATION_GAP']);
    assert.equal(uc.statusSum + uc.notAssessed, uc.shown);
    assert.equal(uc.promoted, rows.filter((r) => r.pattern?.promoted).length);
    if (uc.promoted) assert.match(uc.line, /type(s)? confirmed from filings/);
  });
});

describe('zzz802 · status distribution on the live harness', { skip: HAVE_LIVE ? false : `live harness not found at ${LIVE_DIR}` }, () => {
  const live = HAVE_LIVE ? JSON.parse(readFileSync(join(LIVE_DIR, 'ledgers_live.json'), 'utf8')) : { ledgers: {}, freshness: {} };
  const graded = HAVE_LIVE ? JSON.parse(readFileSync(join(LIVE_DIR, 'graded_live.json'), 'utf8')).rows : {};
  const rows = Object.entries<any>(live.ledgers).map(([t, raw]) => buildRow(t, raw, graded[t] && graded[t].source !== 'none' ? graded[t] : null, live.freshness?.[t] || null));
  const dist = (st: string) => rows.filter((r) => r.assessment.status === st).length;
  test('every rule holds on every card', () => invariants(rows));
  test('before zzz802: 2 STRENGTHENING / 67 CONFIRMATION REQUIRED of 115 — now more reach green, fewer sit in confirmation', () => {
    assert.ok(dist('STRENGTHENING') >= 6, `STRENGTHENING ${dist('STRENGTHENING')}`);
    assert.ok(dist('CONFIRMATION_REQUIRED') <= 60, `CONFIRMATION_REQUIRED ${dist('CONFIRMATION_REQUIRED')}`);
    assert.ok(rows.filter((r) => r.pattern?.promoted).length >= 5, 'nearest fits confirmed by the filings are promoted');
  });
  test('type A can reach STRENGTHENING through a filed alternate for utilisation', () => {
    assert.ok(rows.some((r) => r.pattern?.pattern === 'A' && r.assessment.status === 'STRENGTHENING' && r.assessment.utilisationAlternate));
  });
});
