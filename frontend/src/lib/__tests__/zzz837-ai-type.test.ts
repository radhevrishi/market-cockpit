// zzz837 — LET AI CHOOSE THE THESIS TYPE (India + US).
// Run: npx tsx --test src/lib/__tests__/zzz837-ai-type.test.ts
// No network: the AI answer is a literal object handed to the validator.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildAiTypePrompt, promptText, sanitizeAiTypeInput, validateAiTypeAnswer, toAiTypeRecord, aiPattern, aiTypeInputIndia, aiTypeInputUs,
  aiTypePlan, confirmationBreakdown, aiTypeLabel, RESOLVE_ALL_LABEL, RESOLVE_ALL_NOTE, CARD_AI_TYPE_LABEL, CONFIRMATION_BANNER, checkLabelsOf,
  numbersIn, inventedNumbers, type AiTypeInput, type AiTypeRecord,
} from '../thesis/ai-type';
import { applyAiRecord, applyUserType, isUserChosen } from '../thesis/ai-type-store';
import { resolveSummary } from '../thesis/use-ai-type';
import { isProtectedApi, PROTECTED_API_PREFIXES } from '../site-auth';
import { assessBookRow, applyLedger } from '../thesis/use-book';
import { migrateLedger } from '../thesis/evidence-ledger';
import { classifyOrNearest, manualPattern } from '../earnings/pattern-abfg';
import { PROVISIONAL_BLOCKED } from '../thesis/status';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// An exchange: a name the auto rules call "nearest A · capacity" but which has no plant.
const EXCHANGE: AiTypeInput = {
  market: 'IN', symbol: 'BSE', name: 'BSE Limited', industry: 'Capital Markets / Exchanges',
  description: 'Runs a stock exchange and a clearing corporation. Earns transaction charges, listing fees and data fees.',
  figures: [
    { label: 'Revenue growth, year on year (%)', value: '+62' },
    { label: 'Earnings growth, year on year (%)', value: '+84' },
    { label: 'Operating margin change (points)', value: '+6.5' },
    { label: 'Profit after tax, this period (crore)', value: '432' },
  ],
  provisional: { type: 'A', weak: false, because: 'Nearest fit (auto, provisional) — A · operating inflection: revenue +62%', checks: [{ label: 'Capacity utilisation', state: 'not disclosed' }, { label: 'Volume', state: 'not disclosed' }] },
};
const GOOD = {
  type: 'G',
  reason: 'An exchange earns fees on trading volume, so growth and cash quality are the story, not plant capacity.',
  justification: ['Revenue growth, year on year (%): +62', 'Operating margin change (points): +6.5'],
  not_applicable: [{ check: 'Capacity utilisation', why: 'An exchange has no plant.', instead: 'trading volume growth' }],
};
// G's own list has no utilisation; use A for the not-applicable check.
const GOOD_A = { ...GOOD, type: 'A' };

describe('zzz837 · the prompt', () => {
  test('carries no price, market value or valuation — only business words and filed figures', () => {
    const t = promptText(EXCHANGE);
    assert.doesNotMatch(t, /\bprice\b|priced|share price|market cap|valuation|target price|p\/e|\bcmp\b/i);
    assert.match(t, /BSE Limited/); assert.match(t, /Revenue growth/); assert.match(t, /Capacity utilisation/);
    assert.match(t, /A, B, F, G, or undecided/);
  });
  test('a price-like figure or sentence is dropped before it can reach the prompt', () => {
    const dirty = sanitizeAiTypeInput({ ...EXCHANGE, description: 'Runs an exchange. The share price doubled last year. Earns fees.',
      figures: [...EXCHANGE.figures, { label: 'Market cap (crore)', value: '90000' }, { label: 'Share price', value: '5000' }] })!;
    assert.equal(dirty.figures.length, EXCHANGE.figures.length);
    assert.doesNotMatch(promptText(dirty), /share price|market cap|5000|90000/i);
    assert.match(dirty.description, /Earns fees/);
  });
  test('the input built from a row uses only its figures (India and US builders)', () => {
    const inR = aiTypeInputIndia({ symbol: 'ABC', graded: { sales_yoy_pct: 20, eps_yoy_pct: 30, opm_pct: 15, opm_prev_pct: 14, price: 999, market_cap_cr: 5000, industry: 'Engineering' }, summary: null,
      pattern: { pattern: 'A', fit: 'nearest', because: 'Nearest fit', weak: false }, assessment: null });
    assert.doesNotMatch(promptText(inR), /999|5000|market cap/i);
    assert.ok(inR.figures.some((f) => /Revenue growth/.test(f.label) && f.value === '+20'));
    const inU = aiTypeInputUs({ symbol: 'XYZ', graded: { sales_yoy_pct: 12, net_profit_yoy_pct: 15, price: 250, sic: '3559', industry: 'Special industry machinery' }, sec: null, pattern: null, assessment: null });
    assert.equal(inU.market, 'US'); assert.doesNotMatch(promptText(inU), /\b250\b/);
  });
  test('the prompt lists each type\'s own checks, price-free', () => {
    for (const t of ['A', 'B', 'F', 'G'] as const) assert.ok(checkLabelsOf(t).length >= 4);
    assert.ok(checkLabelsOf('A').includes('Capacity utilisation'));
    assert.ok(!checkLabelsOf('G').includes('Capacity utilisation'));
  });
});

describe('zzz837 · the validator', () => {
  test('accepts a well-formed answer whose numbers are all in the input', () => {
    const v = validateAiTypeAnswer(GOOD_A, EXCHANGE);
    assert.equal(v.ok, true);
    if (v.ok) { assert.equal(v.result.type, 'A'); assert.equal(v.result.notApplicable[0].check, 'Capacity utilisation'); }
  });
  test('rejects a type outside A / B / F / G / undecided', () => {
    for (const t of ['C', 'H', 'a', '', 'BUY', 'nearest', null, 7]) {
      const v = validateAiTypeAnswer({ ...GOOD, type: t }, EXCHANGE);
      assert.equal(v.ok, false, String(t));
    }
    assert.equal(validateAiTypeAnswer('not json', EXCHANGE).ok, false);
    assert.equal(validateAiTypeAnswer([], EXCHANGE).ok, false);
  });
  test('rejects a missing reason', () => {
    assert.equal(validateAiTypeAnswer({ ...GOOD, reason: '' }, EXCHANGE).ok, false);
    assert.equal(validateAiTypeAnswer({ ...GOOD, reason: undefined }, EXCHANGE).ok, false);
    assert.equal(validateAiTypeAnswer({ type: 'undecided', justification: [] }, EXCHANGE).ok, false);
  });
  test('rejects invented numbers in the justification (and in the reason)', () => {
    const bad = validateAiTypeAnswer({ ...GOOD, justification: ['Revenue growth: +62', 'Order book of 4,500 crore'] }, EXCHANGE);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.errors.join(' '), /not in the facts given: 4,500/);
    assert.equal(validateAiTypeAnswer({ ...GOOD, reason: 'Revenue up 75% a year, so growth is the story.' }, EXCHANGE).ok, false);
    // a rounding of a given figure is not an invention; a new figure is.
    assert.equal(validateAiTypeAnswer({ ...GOOD, justification: ['Revenue growth about +62%', 'Margin up 6.5 points'] }, EXCHANGE).ok, true);
    assert.deepEqual(inventedNumbers('grew 84% and 300 crore', 'Earnings growth +84'), ['300']);
    assert.deepEqual(numbersIn('Jun-26 Q1 FY27 ₹2,450.5 crore'), [26, 2450.5]);
  });
  test('a decided type needs 2 or 3 justification items; advice or market words are refused', () => {
    assert.equal(validateAiTypeAnswer({ ...GOOD, justification: ['Revenue growth +62'] }, EXCHANGE).ok, false);
    assert.equal(validateAiTypeAnswer({ ...GOOD, justification: ['a +62', 'b +84', 'c +6.5', 'd 432'] }, EXCHANGE).ok, false);
    assert.equal(validateAiTypeAnswer({ ...GOOD, reason: 'A clear buy on the share price.' }, EXCHANGE).ok, false);
  });
  test('a not-applicable check that is not one of the type\'s checks is dropped, not trusted', () => {
    const v = validateAiTypeAnswer({ ...GOOD_A, not_applicable: [{ check: 'Capacity utilisation', why: 'No plant.', instead: 'volume growth' }, { check: 'Made-up check', why: 'x' }] }, EXCHANGE);
    assert.equal(v.ok, true);
    if (v.ok) { assert.equal(v.result.notApplicable.length, 1); assert.deepEqual(v.dropped, ['Made-up check']); }
  });
  test('undecided is a valid answer; an invalid answer becomes undecided, never a guess', () => {
    const u = validateAiTypeAnswer({ type: 'undecided', reason: 'The facts do not point at one type.', justification: [] }, EXCHANGE);
    assert.equal(u.ok, true);
    const rec = toAiTypeRecord(u, { model: 'm', at: '2026-09-29T10:00:00Z' });
    assert.equal(rec.type, 'undecided'); assert.equal(rec.source, 'ai'); assert.equal(rec.at, '2026-09-29');
    const bad = toAiTypeRecord(validateAiTypeAnswer({ ...GOOD, type: 'Z' }, EXCHANGE), { model: 'm', at: '2026-09-29T10:00:00Z' });
    assert.equal(bad.type, 'undecided'); assert.match(bad.rejected || '', /not one of A, B, F, G/);
  });
});

// ── status: use the QA fixtures the provisional rule was built on ─────────
const NAMED = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zzz790-pc-named.json'), 'utf8'));
function build(t: string, pattern?: any): any {
  const g = NAMED.graded[t] && NAMED.graded[t].source !== 'none' ? NAMED.graded[t] : null;
  const row0: any = { symbol: t, origin: 'book', market: 'IN', graded: g, tier: g?.tier || null, pattern: pattern === undefined ? (g ? classifyOrNearest(g) : null) : pattern,
    radarScore: null, summary: null, sourceUrl: null, state: 'idle', assessment: null, capex: null, promiseNote: null, dataSource: g ? 'screener.in data' : null };
  return NAMED.ledgers[t] ? applyLedger(row0, migrateLedger(NAMED.ledgers[t]), NAMED.freshness[t] || null) : assessBookRow(row0);
}
const REC = (type: any = 'A'): AiTypeRecord => ({ source: 'ai', at: '2026-09-29', model: 'test-model', promptVersion: 'x', type, reason: 'A capacity-led business.', justification: ['a', 'b'], notApplicable: [] });

describe('zzz837 · status', () => {
  const prov = build('AARTIPHARM');
  test('fixture: a provisional nearest-fit name with real evidence is capped at CONFIRMATION REQUIRED', () => {
    assert.equal(prov.pattern.fit, 'nearest');
    assert.equal(prov.assessment.status, 'CONFIRMATION_REQUIRED');
  });
  test('the same name, type chosen by AI, is judged on its evidence — no longer capped by the type', () => {
    const r = build('AARTIPHARM', aiPattern('A', REC('A')));
    assert.equal(r.pattern.fit, 'manual'); assert.equal(r.pattern.source, 'ai');
    assert.doesNotMatch(r.assessment.because, /^Provisional thesis/);
    assert.notEqual(r.pattern.fit, 'nearest');
    // it is now free to read an affirmative status when the evidence allows (the same as a user-chosen type would)
    const user = build('AARTIPHARM', manualPattern('A'));
    assert.equal(r.assessment.status, user.assessment.status, 'AI type reads exactly like a confirmed type');
    assert.match(r.pattern.because, /type chosen by AI on 2026-09-29 — change it with the picker/);
  });
  test('promotion only when the evidence rules allow: an AI-typed name with no mechanism evidence never passes', () => {
    const names = Object.keys(NAMED.ledgers);
    let checked = 0;
    for (const t of names) {
      const r = build(t, aiPattern('A', REC('A')));
      const u = build(t, manualPattern('A'));
      assert.equal(r.assessment.status, u.assessment.status, t);
      assert.ok(!PROVISIONAL_BLOCKED.has(r.assessment.status) || (r.assessment.checked || []).length > 0);
      checked++;
    }
    assert.ok(checked > 3);
    // no filed evidence at all: AI type does not manufacture a pass (silence never passes)
    const g = { ticker: 'TEST', source: 'screener-live', sales_yoy_pct: 20, eps_yoy_pct: 25, opm_pct: 15, opm_prev_pct: 14 };
    const bare = assessBookRow({ symbol: 'TEST', origin: 'book', market: 'IN', graded: g, tier: null, pattern: aiPattern('A', REC('A')), radarScore: null, summary: null, sourceUrl: null, state: 'idle', assessment: null, capex: null, promiseNote: null, dataSource: 'screener-live' } as any) as any;
    assert.ok(['EVIDENCE_INCOMPLETE', 'CONFIRMATION_REQUIRED'].includes(bare.assessment.status), bare.assessment.status);
    assert.doesNotMatch(bare.assessment.because, /^Provisional thesis/);
  });
  test('undecided keeps the name provisional (no override is made)', () => {
    const { types, ai, applied } = applyAiRecord({}, {}, 'AARTIPHARM', REC('undecided'));
    assert.equal(applied, true); assert.equal(types.AARTIPHARM, undefined); assert.equal(ai.AARTIPHARM.type, 'undecided');
    assert.equal(prov.pattern.fit, 'nearest'); assert.equal(prov.assessment.status, 'CONFIRMATION_REQUIRED');
  });
  test('needs type / needs evidence / both — a sub-line, and no new status word', () => {
    const cr = (fit: string, ev: string) => ({ pattern: { fit }, assessment: { status: 'CONFIRMATION_REQUIRED', verdict: { evidence: ev, coverage: { confirmed: 1, applicable: 4 } } } });
    const b = confirmationBreakdown([cr('nearest', 'CONFIRMED'), cr('nearest', 'INCOMPLETE'), cr('manual', 'INCOMPLETE'), cr('manual', 'CONFIRMED'), { assessment: { status: 'ON_TRACK' } }]);
    assert.deepEqual([b.needsType, b.needsEvidence, b.both, b.other, b.total], [1, 1, 1, 1, 4]);
    assert.match(b.line, /^needs type: 1 · needs evidence: 1 · both: 1 · other: 1$/);
    assert.equal(confirmationBreakdown([cr('nearest', 'CONFIRMED')]).line, 'needs type: 1 · needs evidence: 0 · both: 0');
    const st = read('src/lib/thesis/status.ts');
    assert.equal((st.match(/'CONFIRMATION REQUIRED'/g) || []).length > 0, true);
    assert.doesNotMatch(read('src/lib/thesis/ai-type.ts'), /THESIS_STATUS_NEW|NEEDS TYPE'/);
  });
});

describe('zzz837 · user choice always wins', () => {
  test('AI never overwrites a type the user chose, and the picker removes the AI record', () => {
    const user = applyAiRecord({ ABC: 'F' }, {}, 'abc', REC('A'));
    assert.equal(user.applied, false); assert.equal(user.why, 'user'); assert.equal(user.types.ABC, 'F');
    assert.equal(isUserChosen({ ABC: 'F' }, {}, 'ABC'), true);
    const a1 = applyAiRecord({}, {}, 'ABC', REC('G'));
    assert.equal(a1.types.ABC, 'G'); assert.equal(isUserChosen(a1.types, a1.ai, 'ABC'), false);
    // AI may re-decide its own earlier answer
    assert.equal(applyAiRecord(a1.types, a1.ai, 'ABC', REC('B')).types.ABC, 'B');
    // the user picks: the AI record is gone and the choice is theirs
    const u = applyUserType(a1.types, a1.ai, 'ABC', 'A');
    assert.equal(u.types.ABC, 'A'); assert.equal(u.ai.ABC, undefined); assert.equal(isUserChosen(u.types, u.ai, 'ABC'), true);
    assert.equal(applyUserType(a1.types, a1.ai, 'ABC', null).types.ABC, undefined);
  });
  test('the bulk plan asks only provisional names with no type, and leaves undecided ones alone', () => {
    const rows = [
      { symbol: 'A1', pattern: { fit: 'nearest' } }, { symbol: 'A2', pattern: { fit: 'nearest' } }, { symbol: 'A3', pattern: { fit: 'nearest' } },
      { symbol: 'A4', pattern: { fit: 'exact' } }, { symbol: 'A5', pattern: { fit: 'nearest' }, state: 'loading' }, { symbol: 'A6', pattern: null },
    ];
    const p = aiTypePlan(rows, { A2: 'B' }, { A3: REC('undecided') });
    assert.deepEqual(p.names, ['A1']); assert.deepEqual(p.undecided, ['A3']); assert.equal(p.total, 1);
    assert.equal(p.label, '✨ Let AI choose types — 1 name (uses AI · 1 call, only on click)');
    assert.equal(aiTypeLabel(60), '✨ Let AI choose types — 60 names (uses AI · 60 calls, only on click)');
  });
  test('the result summary line is the one the owner asked for', () => {
    assert.equal(resolveSummary({ set: 40, undecided: 5, detailsFilled: 30, stillIncomplete: 12, failed: 0 }), 'types set: 40 · undecided: 5 · details filled: 30 · still incomplete: 12');
  });
});

describe('zzz837 · route, storage and UI words', () => {
  test('the route is login-protected', () => {
    assert.ok((PROTECTED_API_PREFIXES as readonly string[]).includes('/api/v1/thesis-ai'));
    assert.equal(isProtectedApi('/api/v1/thesis-ai/type'), true);
    assert.equal(isProtectedApi('/api/v1/thesis-ai'), true);
  });
  test('the route: key from env only, strict validator, user wins, rate-limited, timeout, cache', () => {
    const r = read('src/app/api/v1/thesis-ai/type/route.ts');
    assert.match(r, /anthropicMessages\('thesis-ai-type'/); assert.match(r, /validateAiTypeAnswer/); assert.match(r, /rateLimitResponse/);
    assert.match(r, /AbortSignal\.timeout/); assert.match(r, /applyAiRecord/); assert.match(r, /skipped: 'user'/); assert.match(r, /kvSet\(cacheKey/);
    assert.doesNotMatch(r, /sk-ant|process\.env\.[A-Z_]*KEY\b.*console/i);
    assert.doesNotMatch(r.replace(/\/\/.*$/gm, ''), /yahoo|fetchChart|quotes|\bprice\b/i);
  });
  test('both pickers drop the AI record; both hooks load and mirror it', () => {
    assert.match(read('src/app/api/v1/portfolio/evidence/route.ts'), /applyUserType/);
    assert.match(read('src/app/api/v1/us-thesis/evidence/route.ts'), /applyUserType/);
    assert.match(read('src/lib/thesis/use-book.ts'), /applyAiType/); assert.match(read('src/lib/us-thesis/use-us-book.ts'), /applyAiType/);
  });
  test('UI strings say the AI is used only on click; both pages carry the same three buttons', () => {
    assert.match(aiTypeLabel(3), /only on click/); assert.match(RESOLVE_ALL_NOTE, /only on click/i);
    assert.equal(RESOLVE_ALL_LABEL, '✨ Resolve everything with AI (types + missing details)');
    assert.equal(CARD_AI_TYPE_LABEL, '✨ Let AI choose the type');
    assert.match(CONFIRMATION_BANNER, /let AI choose the types/); assert.match(CONFIRMATION_BANNER, /only on click/);
    assert.ok(CONFIRMATION_BANNER.length < 320);
    const bar = read('src/components/thesis-ai-resolve.tsx');
    assert.match(bar, /uses AI, only on click/); assert.match(bar, /only on click/);
    for (const pg of ['src/app/(dashboard)/portfolio-catalysts/page.tsx', 'src/app/(dashboard)/us-portfolio-catalysts/page.tsx']) {
      const s = read(pg);
      assert.match(s, /AiResolveBar/); assert.match(s, /ProvisionalBanner/); assert.match(s, /useAiTypeResolver/); assert.match(s, /confirmationBreakdown/);
      assert.match(s, /pc-cr-breakdown/); assert.match(s, /onAiType=/); assert.doesNotMatch(s, /^export (function|const|interface)/m);
      assert.doesNotMatch(s, /useEffect\([^)]*runTypes|useEffect\([^)]*resolveAll/);
    }
    const card = read('src/components/thesis-card.tsx');
    assert.match(card, /CARD_AI_TYPE_LABEL/); assert.match(card, /aiTypeLine/); assert.match(card, /the figures and the status are worked out by rules/);
  });
  test('AI is never started automatically: the runner is only called from click handlers', () => {
    const hook = read('src/lib/thesis/use-ai-type.ts');
    assert.doesNotMatch(hook, /useEffect/);
  });
});
