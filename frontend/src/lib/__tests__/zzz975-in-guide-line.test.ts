import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  inGuideLine, applyInGuideLine, applyInGuideLines, extractsForFiling, IN_OVERLAY_VERSION,
  inLoweredInText, inRaisedInText, inKeptInText, inCautionInText,
} from '../in-guide-line';
import { haikuPeriodOf, haikuFgKey } from '../haiku-fg-key';

const row = (o: any = {}) => ({ ticker: 'ACME', company: 'Acme Ltd', filing_date: '2026-08-10', quarter: 'Q1 FY27', tier: 'STRONG', caveat_tags: [], ...o });
const doc = (rows: any[], o: any = {}) => ({ docId: 'd1', docKind: 'TRANSCRIPT', docUrl: 'https://www.bseindia.com/x.pdf', filedAt: '2026-08-20', status: 'ok', rows, ...o });
const fig = (o: any) => ({ metric: 'REVENUE', period: 'FY27', unit: 'crore', currency: 'INR', low: 1000, high: 1100, status: 'NEW', quote: 'We expect FY27 revenue of Rs 1,000-1,100 crore.', ...o });

test('zzz975 Indian phrasing: cuts, raises, kept outlooks and profit guided below last year', () => {
  // cuts
  assert.ok(inLoweredInText('We have revised down our FY27 revenue guidance to 12-14%.'));
  assert.ok(inLoweredInText('Our revenue guidance has been revised downwards to 10% for FY27.'));
  assert.ok(inLoweredInText('We have moderated our FY27 growth guidance to 15% from 20% earlier.'));
  assert.ok(inLoweredInText('We now expect revenue growth for FY27 to be lower than earlier guided because of project delays.'));
  assert.ok(inLoweredInText('We have cut our volume guidance for FY27 to 8%.'));
  // not cuts
  assert.equal(inLoweredInText('Revenue growth came in at 20% this quarter, in line with guidance.'), null);
  assert.equal(inLoweredInText('We have not revised down our guidance despite the monsoon.'), null);
  assert.equal(inLoweredInText('We have brought down our debt and interest cost guidance is lower.'), null);
  assert.equal(inLoweredInText('We reduced our borrowings by Rs 200 crore during the quarter.'), null);
  // raises
  assert.ok(inRaisedInText('We are raising our FY27 revenue guidance to 30% from 25%.'));
  assert.ok(inRaisedInText('We have revised our guidance upwards to 25% growth.'));
  assert.ok(inRaisedInText('Our FY27 revenue guidance has been revised upwards to Rs 1,500 crore.'));
  assert.equal(inRaisedInText('The board approved raising funds via QIP of Rs 500 crore.'), null);
  // kept
  assert.ok(inKeptInText('We have maintained our guidance of 20% revenue growth for FY27.'));
  assert.ok(inKeptInText('We reiterate our guidance of Rs 1,000 crore revenue for FY27.'));
  assert.ok(inKeptInText('We retain our guidance of 25% growth.'));
  assert.ok(inKeptInText('We are on track to achieve our FY27 guidance.'));
  assert.ok(inKeptInText('There is no change in our guidance of 20% growth.'));
  // profit line below last year
  assert.ok(inCautionInText('We expect PAT to decline year-on-year in FY27 because of the one-time gain in FY26.'));
  assert.ok(inCautionInText('EBITDA margin is expected to be lower than last year due to raw material inflation.'));
  assert.equal(inCautionInText('Interest costs are expected to be lower than last year.'), null);
});

test('zzz975 cascade 1: extracted figures — lowered wins, raised and kept never move the tier', () => {
  const lowered = inGuideLine(row(), { extracts: [doc([fig({ status: 'LOWERED', low: 900, high: 950, prior: { low: 1000, high: 1100, statedIn: 'Q4 FY26' } })])] });
  assert.equal(lowered.direction, 'lowered'); assert.equal(lowered.lowered, true);
  assert.match(lowered.text, /FY27 revenue ₹900 Cr–₹950 Cr \(was ₹1,000 Cr–₹1,100 Cr\)/);
  assert.equal(lowered.source, 'concall transcript');

  const raised = inGuideLine(row(), { extracts: [doc([fig({ status: 'RAISED' })])] });
  assert.equal(raised.direction, 'raised'); assert.equal(raised.lowered, false);
  const kept = inGuideLine(row(), { extracts: [doc([fig({ status: 'REITERATED', growthPctLow: 20, growthPctHigh: 20, low: null, high: null, unit: '%' })])] });
  assert.equal(kept.direction, 'maintained'); assert.match(kept.text, /20% growth/); assert.equal(kept.lowered, false);
  const neu = inGuideLine(row(), { extracts: [doc([fig({})])] });
  assert.equal(neu.direction, 'none'); assert.match(neu.text, /no earlier figure/);

  // raised revenue + cut PAT = mixed and moves; raised revenue + trimmed margin only = mixed, does not move
  const mixed = inGuideLine(row(), { extracts: [doc([fig({ status: 'RAISED' }), fig({ metric: 'PAT', status: 'LOWERED', low: 80, high: 90 })])] });
  assert.equal(mixed.direction, 'mixed'); assert.equal(mixed.lowered, true);
  const marginOnly = inGuideLine(row(), { extracts: [doc([fig({ status: 'RAISED' }), fig({ metric: 'EBITDA_MARGIN', unit: '%', status: 'LOWERED', low: 14, high: 15 })])] });
  assert.equal(marginOnly.direction, 'mixed'); assert.equal(marginOnly.lowered, false);

  // a profit line guided below last year = cautious
  const below = inGuideLine(row(), { extracts: [doc([fig({ metric: 'PAT', status: 'NEW', growthPctLow: -10, growthPctHigh: -5, low: null, high: null, unit: '%' })])] });
  assert.equal(below.direction, 'cautious'); assert.equal(below.lowered, true);
  const belowActual = inGuideLine(row(), { extracts: [doc([fig({ metric: 'EBITDA', status: 'NEW', low: 180, high: 190, priorActual: { period: 'FY26', value: 210, quote: 'FY26 EBITDA of Rs 210 crore' } })])] });
  assert.equal(belowActual.direction, 'cautious');

  // the newest document's figure for a metric + period wins (the call corrected the release)
  const two = inGuideLine(row(), { extracts: [doc([fig({ status: 'RAISED' })], { docId: 'pr', docKind: 'RESULTS_RELEASE', filedAt: '2026-08-10' }), doc([fig({ status: 'LOWERED' })], { docId: 'call', filedAt: '2026-08-25' })] });
  assert.equal(two.direction, 'lowered');
});

test('zzz975 documents outside the results season are not read', () => {
  const docs = [doc([], { docId: 'old', filedAt: '2026-05-20' }), doc([], { docId: 'pre', filedAt: '2026-08-08' }), doc([], { docId: 'call', filedAt: '2026-09-01' }), doc([], { docId: 'late', filedAt: '2026-11-15' })];
  assert.deepEqual(extractsForFiling(docs, '2026-08-10').map((d) => d.docId), ['call', 'pre']);
  const r = inGuideLine(row(), { extracts: [doc([fig({ status: 'LOWERED' })], { filedAt: '2026-05-20' })] });
  assert.notEqual(r.direction, 'lowered');
});

test('zzz975 cascade 2: the stored AI read cuts only with HIGH / MEDIUM confidence AND a quote', () => {
  const q = ['We have moderated our FY27 revenue growth guidance to 12% from 18% due to slower exports.'];
  const hi = inGuideLine(row(), { ai: { label: 'Negative', confidence: 'HIGH', quotes: q, source: 'concall-transcript' } });
  assert.equal(hi.direction, 'lowered'); assert.equal(hi.lowered, true); assert.match(hi.source, /AI read/);
  const cautious = inGuideLine(row(), { ai: { label: 'Negative', confidence: 'MEDIUM', quotes: ['Demand in exports remains weak and we see pressure in H2.'] } });
  assert.equal(cautious.direction, 'cautious'); assert.equal(cautious.lowered, true);
  assert.equal(inGuideLine(row(), { ai: { label: 'Negative', confidence: 'LOW', quotes: q } }).lowered, false);
  assert.equal(inGuideLine(row(), { ai: { label: 'Negative', confidence: 'HIGH', quotes: [] } }).lowered, false);
  const pos = inGuideLine(row(), { ai: { label: 'Positive', confidence: 'HIGH', quotes: ['We are confident of strong growth in FY27.'] } });
  assert.equal(pos.direction, 'positive'); assert.equal(pos.lowered, false);
  const posUp = inGuideLine(row(), { ai: { label: 'Positive', confidence: 'HIGH', quotes: ['We are raising our FY27 revenue guidance to 30%.'] } });
  assert.equal(posUp.direction, 'raised');
});

test('zzz975 cascade order: a cut anywhere beats a raise in the figures; figures beat AI beat text', () => {
  // figures raised, AI cut with a quote → mixed (a cut anywhere wins) and the tier moves
  const r1 = inGuideLine(row(), { extracts: [doc([fig({ status: 'RAISED' })])], ai: { label: 'Negative', confidence: 'HIGH', quotes: ['We have revised down our margin guidance to 14%.'] } });
  assert.equal(r1.direction, 'mixed'); assert.equal(r1.lowered, true);
  // figures raised, filing text cuts → mixed
  const r2 = inGuideLine(row({ grade_input: { guidance_text: 'Management has revised its FY27 PAT guidance downwards.' } }), { extracts: [doc([fig({ status: 'RAISED' })])] });
  assert.equal(r2.direction, 'mixed'); assert.equal(r2.lowered, true); assert.equal(r2.source, 'the filing text');
  // figures cut: source is the document even when the AI read is positive
  const r3 = inGuideLine(row(), { extracts: [doc([fig({ status: 'LOWERED' })])], ai: { label: 'Positive', confidence: 'HIGH', quotes: ['We are raising our guidance.'] } });
  assert.equal(r3.source, 'concall transcript');
  // nothing stored, text only
  const r4 = inGuideLine(row({ grade_input: { announcement_text: 'We reiterate our guidance of 20% growth for FY27.' } }), null);
  assert.equal(r4.direction, 'maintained');
  // nothing at all
  assert.equal(inGuideLine(row(), null).direction, 'unknown');
  // the concall feed word list alone is said, never moves the tier
  const feed = inGuideLine(row({ guidance_status: 'cut' }), null);
  assert.equal(feed.lowered, false); assert.match(feed.text, /no sentence kept/);
});

test('zzz975 demotion: only BLOCKBUSTER / STRONG move to MIXED; raised never demotes; idempotent', () => {
  const cut = { extracts: [doc([fig({ status: 'LOWERED' })])] };
  for (const tier of ['BLOCKBUSTER', 'STRONG']) {
    const r: any = row({ tier });
    assert.equal(applyInGuideLine(r, cut), true);
    assert.equal(r.tier, 'MIXED'); assert.equal(r.tier_before_guide_check, tier);
    assert.ok(r.caveat_tags.some((t: string) => t.startsWith('guidance lowered — ')));
    assert.equal(applyInGuideLine(r, cut), false);   // second pass: no second tag, no second move
    assert.equal(r.caveat_tags.filter((t: string) => t.startsWith('guidance lowered')).length, 1);
  }
  for (const tier of ['MIXED', 'AVOID']) {
    const r: any = row({ tier });
    assert.equal(applyInGuideLine(r, cut), false); assert.equal(r.tier, tier); assert.equal(r.tier_before_guide_check, undefined);
    assert.equal(r.guide_line.direction, 'lowered');
  }
  const up: any = row({ tier: 'BLOCKBUSTER' });
  assert.equal(applyInGuideLine(up, { extracts: [doc([fig({ status: 'RAISED' })])] }), false);
  assert.equal(up.tier, 'BLOCKBUSTER'); assert.equal(up.guide_line.direction, 'raised');
});

test('zzz975 served day: moved rows go to the top of MIXED, every row carries the line, the day is stamped', () => {
  const p = { filing_date: '2026-08-10', by_tier: { BLOCKBUSTER: [row({ ticker: 'CUT', tier: 'BLOCKBUSTER' }), row({ ticker: 'UP', tier: 'BLOCKBUSTER' })], STRONG: [], MIXED: [row({ ticker: 'OLD', tier: 'MIXED' })], AVOID: [] } };
  const out = applyInGuideLines(p, (r) => (r.ticker === 'CUT' ? { extracts: [doc([fig({ status: 'LOWERED' })])] } : r.ticker === 'UP' ? { extracts: [doc([fig({ status: 'RAISED' })])] } : null));
  assert.deepEqual(out.by_tier.BLOCKBUSTER.map((r: any) => r.ticker), ['UP']);
  assert.deepEqual(out.by_tier.MIXED.map((r: any) => r.ticker), ['CUT', 'OLD']);
  assert.equal(out.in_overlay_v, IN_OVERLAY_VERSION);
  assert.ok(out.by_tier.MIXED.every((r: any) => r.guide_line && typeof r.guide_line.text === 'string'));
  assert.equal((p.by_tier.BLOCKBUSTER[0] as any).tier, 'BLOCKBUSTER', 'the stored payload is not mutated');
  assert.match(out.notes[0], /1 top-tier row moved to MIXED/);
});

test('zzz975 stored AI key: the quarter label maps to the cache period of the writer', () => {
  assert.equal(haikuPeriodOf('Q1 FY27'), 'Q1-FY27');
  assert.equal(haikuPeriodOf('Q4 FY2026'), 'Q4-FY26');
  assert.equal(haikuPeriodOf('Q2'), null);
  assert.match(haikuFgKey('acme', 'Q1-FY27'), /^haiku-fg:v3:p1055-balanced-v1:p1055-hedge-v1:ACME:Q1-FY27$/);
  const route = readFileSync(join(__dirname, '../../app/api/v1/haiku/forward-guidance/route.ts'), 'utf8');
  assert.match(route, /return haikuFgKey\(ticker, period\)/, 'writer and reader share one key');
});

test('zzz975 wiring: graded + graded-window serve the overlay; the page refetches days saved before it; no new page exports', () => {
  const src = (p: string) => readFileSync(join(__dirname, '../../', p), 'utf8');
  const graded = src('app/api/v1/earnings/graded/route.ts');
  assert.match(graded, /overlayInGuideLines\(body\)/);
  assert.match(graded, /export async function GET\(req: Request\) \{\n  const res = await gradedSwrGET\(req\);/);
  assert.match(src('app/api/v1/earnings/graded-window/route.ts'), /stripGradeInput\(await overlayInGuideLines\(f\.payload\)\)/);
  const page = src('app/(dashboard)/earnings-opportunities/page.tsx');
  assert.match(page, /in_overlay_v !== IN_OVERLAY_VERSION\) return undefined/);
  assert.match(page, /readLsCache\(resolvedDateForGrading, \{ current: true \}\)/);
  assert.match(page, /<InGuideOneLiner stock=\{stock\} \/>/);
  assert.equal((page.match(/^export (?!default)/gm) || []).length, 0, 'page.tsx keeps no named exports');
  // no new paid AI call: the overlay only reads KV
  const chk = src('lib/in-guide-check.ts');
  assert.doesNotMatch(chk, /anthropic|openai|webResearch|fetch\(/i);
});

test('zzz975 joined clauses are not read as a cut or a raise', () => {
  assert.equal(inLoweredInText('We are comfortable with our guidance and we cut working capital days by 10.'), null);
  assert.equal(inRaisedInText('Our outlook remains strong and we increased capacity by 20%.'), null);
});

test('zzz975 server overlay reads the stored documents and AI read for the row (memory KV)', async () => {
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL']) delete process.env[k];
  const kv = await import('../kv');
  const { overlayInGuideLines, _resetInGuideMemo } = await import('../in-guide-check');
  _resetInGuideMemo();
  await kv.kvSet('guidance-docs:v1:index', { updatedAt: '2026-08-21', rows: [
    { docId: 'd-call', market: 'IN', ticker: 'CUTCO', company: 'Cutco', kind: 'TRANSCRIPT', filedAt: '2026-08-20', url: 'https://x/y.pdf', textChars: 9000, extracted: true },
    { docId: 'd-us', market: 'US', ticker: 'CUTCO', company: 'Cutco Inc', kind: 'TRANSCRIPT', filedAt: '2026-08-20', url: 'https://x/z.pdf', textChars: 9000, extracted: true },
  ] });
  await kv.kvSet('guidance-extract:v1:d-call', { docId: 'd-call', market: 'IN', ticker: 'CUTCO', company: 'Cutco', docUrl: 'https://x/y.pdf', docKind: 'TRANSCRIPT', filedAt: '2026-08-20', extractedAt: '2026-08-21', model: null, status: 'ok', dropped: 0,
    rows: [fig({ status: 'LOWERED', quote: 'We have revised down our FY27 revenue guidance to Rs 900 crore.' })] });
  await kv.kvSet(haikuFgKey('AIUP', 'Q1-FY27'), { label: 'Positive', confidence: 'HIGH', quotes: ['We are raising our FY27 revenue guidance to 30%.'], rationale: '', score: 0.7, period: 'Q1-FY27', source: 'concall-transcript', extracted_at: '' });
  const p = { by_tier: { BLOCKBUSTER: [row({ ticker: 'CUTCO', tier: 'BLOCKBUSTER' }), row({ ticker: 'AIUP', tier: 'BLOCKBUSTER' })], STRONG: [], MIXED: [], AVOID: [] } };
  const out = await overlayInGuideLines(p);
  assert.deepEqual(out.by_tier.MIXED.map((r: any) => r.ticker), ['CUTCO']);
  assert.equal(out.by_tier.MIXED[0].guide_line.direction, 'lowered');
  assert.equal(out.by_tier.BLOCKBUSTER[0].guide_line.direction, 'raised');
  assert.equal(out.in_overlay_v, IN_OVERLAY_VERSION);
});
