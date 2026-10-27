// zzz1193 — guidance AI check (checked answers only reach the focus list), Sky Gold framework gates, and the screener fallback
// registered on globalThis (instrumentation and routes are separate bundles).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, quoteInText, parseNames, cleanTargets, aiFocusRows, mergeStore, noDocResult, type AiCheckTarget } from '../gu-ai-check';
import { skyGoldScore, guidanceOfRow, PRICED_IN_CAP } from '../gu-skygold-score';
import { emptyFacts } from '../gu-skygold-facts';
import { setScreenerRowsSource } from '../guidance-extract-reader';

const T: AiCheckTarget = { market: 'IN', ticker: 'PITTIENG', company: 'Pitti Engineering Ltd' };
const TEXT = 'Good morning. For FY27 we expect revenue of about INR 2,350 crores to INR 2,400 crores, backed by our order book of INR 3,000 crores. Our capacity is 72,000 tonnes.';
const doc = { kind: 'TRANSCRIPT', filedAt: '2026-10-27T10:00:00Z', url: 'https://www.bseindia.com/x.pdf', title: 'Earnings call transcript (Pitti)', via: 'stored' as const };
const base = (a: any, rep: any = { year: 'FY26', sales: 1800, pat: 120, source: 'screener.in annual results' }) =>
  checkAnswer(a, { target: T, text: TEXT, reported: rep, mode: 'new', now: new Date('2026-10-27T12:00:00Z'), doc, model: 'm', costUsd: 0.004 });
const ans = (o: any = {}) => ({ decision: 'GUIDANCE', metric: 'REVENUE', period: 'FY27', years: 1, growth_low: null, growth_high: null, stated_pct: false, target_low: 2350, target_high: 2400, target_unit: 'crore', base_value: null, base_period: null, raised_from: null,
  quote: 'For FY27 we expect revenue of about INR 2,350 crores to INR 2,400 crores', reason: 'FY27 revenue target', cover: 'COVERED', cover_text: 'order book covers it', capacity: '72,000 tonnes', orders: 'INR 3,000 crores', customers: null, track: 'UNKNOWN', track_text: null, language: 'EXPECTED', deferral: null, ...o });

test('quote must appear word for word (spacing / dashes normalised)', () => {
  assert.ok(quoteInText('For FY27  we expect revenue of about INR 2,350 crores', TEXT));
  assert.ok(!quoteInText('For FY27 we expect revenue of INR 5,000 crores', TEXT));
  assert.ok(!quoteInText('short', TEXT));
});

test('an amount target is set against the reported last full year and recomputed here', () => {
  const r = base(ans());
  assert.equal(r.decision, 'ADD');
  assert.equal(r.growthHow, 'WORKED_OUT');
  assert.equal(r.growthLow, 30.6); assert.equal(r.growthHigh, 33.3);
  assert.match(r.baseText!, /FY26 reported ₹1,800 Cr/);
});

test('a base far from the reported revenue, a missing quote, or not-guidance never adds', () => {
  assert.equal(base(ans({ base_value: 500 })).decision, 'CHECK');
  assert.equal(base(ans({ quote: 'We will reach INR 9,999 crores soon in revenue' })).decision, 'CHECK');
  assert.equal(base(ans({ decision: 'NOT_GUIDANCE' })).decision, 'NOT_GUIDANCE');
  assert.equal(base(ans({ target_low: 1900, target_high: 1950 })).decision, 'NOT_FOCUS');   // ~+7%
  const stated = base(ans({ growth_low: 35, growth_high: 40, stated_pct: true, target_low: null, target_high: null }));
  assert.equal(stated.decision, 'ADD'); assert.equal(stated.growthHow, 'STATED');
});

test('names typed by the owner, and page targets, are cleaned', () => {
  const n = parseNames('Acutaas, KROSS; pitti engineering\nKROSS');
  assert.equal(n.length, 3);
  assert.equal(n[1].ticker, 'KROSS');
  assert.equal(n[2].ticker, null);
  assert.equal(cleanTargets([{ market: 'IN', ticker: 'ABC<script>', company: 'x' }, { market: 'US', ticker: 'NVDA', company: 'Nvidia' }]).length, 1);   // a bad symbol with no usable name is dropped
});

test('added rows join the focus list once, labelled, and the store keeps an earlier ADD on an evidence re-read', () => {
  const r = base(ans());
  const rows = aiFocusRows([r], new Set(), () => ({ size: 'SMALL_MID', capText: '₹2,900 Cr' }), new Date('2026-10-28T00:00:00Z'));
  assert.equal(rows.length, 1); assert.ok(rows[0].aiAdded); assert.match(rows[0].why, /AI check/);
  assert.equal(aiFocusRows([r], new Set([r.key]), () => ({ size: null, capText: null }), new Date()).length, 0);
  const st = mergeStore(null, [r], new Date());
  const ev = { ...noDocResult(T, 'evidence', new Date(), 'x'), decision: 'NOT_FOCUS' as const, evidence: r.evidence };
  const st2 = mergeStore(st, [ev], new Date());
  assert.equal(st2.results[r.key].decision, 'ADD');
});

test('Sky Gold: price far ahead holds the score; AI evidence adds checks and red flags; old guidance counts less', () => {
  const f = { ...emptyFacts('IN', 'X', 't'), salesYoyQ: 60, salesCagr3y: 45, opmNow: 20, opmYearAgo: 18, roce: 30, cfoToPat: 1.1, debtToEquity: 0.1, pe: 200 };
  const g = { growthPct: 80, growthTrust: 'verified', growthType: 'EXPLICIT', growthMetric: 'REVENUE', growthMetrics: ['REVENUE'], multiYear: false, raised: false, smallRaise: false, cutInWindow: false };
  const s = skyGoldScore(g, f);
  assert.ok(s.score! <= PRICED_IN_CAP); assert.match(s.capNote!, /price already pays/);
  const cheap = skyGoldScore(g, { ...f, pe: 40 });
  assert.ok(cheap.score! > PRICED_IN_CAP);
  const withAi = skyGoldScore(g, { ...f, pe: 40 }, { cover: 'NOT_COVERED', coverText: null, capacity: null, orders: null, customers: null, track: 'MISSED', trackText: 'missed FY26', language: 'ASPIRATIONAL', deferral: 'target moved to FY29' });
  assert.ok(withAi.flags.some((x) => x.id === 'deferral') && withAi.flags.some((x) => x.id === 'powerpoint'));
  assert.ok(withAi.score! < cheap.score!);
  const old = skyGoldScore({ ...g, ageDays: 150 }, { ...f, pe: 40 });
  assert.equal(old.checks.find((c) => c.id === 'fresh')!.status, 'fail');
  assert.equal(guidanceOfRow({ growthPct: 40, growthTrust: 'verified', raised: null, growthVerifiedDaysAgo: 20 }).ageDays, 20);
});

test('the screener fallback source is kept on globalThis', () => {
  setScreenerRowsSource(async () => []);
  assert.equal(typeof (globalThis as any).__mcGuidanceScreenerRows, 'function');
});
