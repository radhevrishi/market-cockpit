// zzz854 — Guidance Upgrades EVENT pipeline: taxonomy, validation (period / actual-vs-guide / unit / stale / range / duplicate),
// GAAP vs adjusted, capital raises, review queue, one primary-source state, decision rule, materiality, repeated upgrader,
// specific WHY NOW / next evidence / audit notes, and the exact pipeline partition.
// Synthetic names (Zed ..., ZZ...) plus the public example shapes from the brief. No network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuidanceEvent, processCandidates, materiality, extractGuidance, computeGap, partitionPipeline, pipelineCounts, summarise, priorRaiseDates,
  taxonomyOfReason, isGuidanceUpgradeCandidate, withClassification, AUDIT_NOTE,
} from '../guidance-upgrades';
import { usGradedRowToCandidate, nonGuidanceRaiseSentence, sanitizeRaiseCandidate } from '../guidance-upgrades-candidates';
import {
  validateChanges, isStalePeriod, periodEndBound, splitByBasis, financingVerdict, consensusLooksMismatched, duplicatesAcrossEvents, brokerWordIsCompanyName, GU_VALIDATION,
} from '../guidance-upgrades-validate';
import { stageNote, primaryStateLine, pipelineCountsLine, reviewItemLine } from '../guidance-upgrades-format';
import { ledgerRowsOf, isLedgerWorthy } from '../guidance-upgrades-ledger';
import type { GuCandidate, GuContext, GuidanceEvent, GuLedgerRow } from '../guidance-upgrades-types';

const NOW = new Date('2026-09-30T12:00:00Z');
const SEC = 'https://www.sec.gov/Archives/edgar/data/1/zz-ex99.htm';
const NSE = 'https://www.nseindia.com/corp/zz.pdf';
let n = 0;
const us = (title: string, text: string, o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: `usgraded:ZZUS${++n}:2026-09-29`, ticker: 'ZZUS', company: 'Zed US Inc', market: 'US', title, text, url: SEC,
  sourceName: 'Company earnings release (SEC 8-K exhibit)', publishedAt: '2026-09-29', kind: 'RELEASE', ...o,
});
const india = (title: string, text: string, o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: `filing:zz${++n}`, ticker: 'ZZIN', company: 'Zed India Ltd', market: 'IN', title, text, url: NSE, sourceName: 'NSE filing', publishedAt: '2026-09-29T10:00:00Z', kind: 'FILING', ...o,
});
const media = (title: string, text: string, o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: `news:zz${++n}`, ticker: 'ZZIN', company: 'Zed India Ltd', market: 'IN', title, text, url: 'https://www.livemint.com/zz', sourceName: 'Mint', publishedAt: '2026-09-29T10:00:00Z', kind: 'NEWS', ...o,
});
const build = (cs: GuCandidate[], ctx: GuContext = {}): GuidanceEvent => buildGuidanceEvent(cs, ctx, NOW);
const row = (o: Record<string, unknown>) => ({ ticker: 'ZZQ', company: 'Zed Q Inc', filing_date: '2026-09-29', guidance: 'RAISED', guidance_url: SEC, guide_change: [], guidance_figures: [], ...o });
const fromRow = (o: Record<string, unknown>) => processCandidates([usGradedRowToCandidate(row(o), '2026-09-29')!.cand], () => ({}), NOW, '7D');
const BUCKETS = ['verifiedUpgrades', 'reiterations', 'mixed', 'lowered', 'firstGuidance', 'invalidOrStale', 'capitalRaise', 'awaitingNumbers', 'unverified', 'nonGuidance'] as const;

// ═══ 1. taxonomy ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('1. taxonomy on every event; only a verified formal upgrade is GUIDANCE UPGRADE', () => {
  test('formal upgrade: old and new, same metric, basis and period -> CARD, GUIDANCE UPGRADE', () => {
    const e = build([us('Zed raises FY26 guidance', 'Zed US Inc raised FY26 revenue guidance to $10.8 billion from $10.0 billion.')]);
    assert.equal(e.taxonomy, 'formal_upgrade'); assert.equal(e.pipeline!.status, 'CARD'); assert.equal(e.pipeline!.bucket, 'verifiedUpgrades');
    assert.equal(e.displayLabel, 'GUIDANCE UPGRADE'); assert.equal(e.isUpgrade, true); assert.equal(e.auditOnly, false);
  });
  test('reiteration -> AUDIT row with a specific note', () => {
    const e = build([us('Zed reiterates FY26 guidance', 'Zed US Inc reiterated FY26 revenue guidance of $10.0 billion, unchanged from $10.0 billion earlier.')]);
    assert.equal(e.taxonomy, 'reiteration'); assert.equal(e.pipeline!.status, 'AUDIT'); assert.equal(e.displayLabel, 'REITERATION');
    assert.match(e.auditNote!, /^Reiteration: FY26 revenue \$10B unchanged$/); assert.notEqual(e.auditNote, AUDIT_NOTE);
  });
  test('downgrade -> AUDIT lowered, REJECT, note names the cut end', () => {
    const e = build([us('Zed updates FY26 EPS outlook', 'Zed US Inc now expects FY26 EPS of $4.20 to $4.30, compared with $4.20 to $4.50 previously.')]);
    assert.equal(e.taxonomy, 'downgrade'); assert.equal(e.pipeline!.bucket, 'lowered'); assert.equal(e.decision, 'REJECT');
    assert.equal(e.auditNote, 'Lowered: FY26 EPS high end cut from $4.50 to $4.30');
  });
  test('mixed: revenue up and EBITDA down in the same release -> mixed audit row, never an upgrade', () => {
    const [e] = fromRow({ guide_change: [
      { metric: 'revenue', basis: 'gaap', period_label: 'FY26', prev_low: 1.0e9, prev_high: 1.0e9, new_low: 1.05e9, new_high: 1.05e9, direction: 'raised', unit: 'usd' },
      { metric: 'ebitda', basis: 'adjusted', period_label: 'FY26', prev_low: 200e6, prev_high: 200e6, new_low: 180e6, new_high: 180e6, direction: 'lowered', unit: 'usd' }] });
    assert.equal(e.taxonomy, 'mixed_range_change'); assert.equal(e.pipeline!.status, 'AUDIT'); assert.equal(e.isUpgrade, false);
    assert.equal(e.displayLabel, 'MIXED / RANGE CHANGE'); assert.match(e.auditNote!, /^Mixed: revenue up, EBITDA down/);
  });
  test('first guidance (no earlier figure) is never a raise', () => {
    const e = build([india('Zed India initiates FY27 guidance', 'Zed India Ltd initiates FY27 guidance: now expects revenue of ₹305–315 crore for FY27.')]);
    assert.equal(e.taxonomy, 'first_guidance'); assert.equal(e.pipeline!.bucket, 'firstGuidance'); assert.equal(e.isUpgrade, false);
    assert.equal(e.decision, 'UNVERIFIED'); assert.notEqual(e.displayLabel, 'GUIDANCE UPGRADE');
  });
  test('qualitative commentary, analyst revision and earnings beat are classified, never events', () => {
    assert.equal(isGuidanceUpgradeCandidate(us('Zed upbeat', 'Zed US Inc is confident and optimistic about demand.')).taxonomy, 'qualitative_commentary');
    assert.equal(isGuidanceUpgradeCandidate(us('Jefferies raises Zed price target', 'Analysts raised the price target to $90.')).taxonomy, 'analyst_revision');
    assert.equal(isGuidanceUpgradeCandidate(us('Zed beats estimates', 'Zed US Inc beat consensus estimates for the quarter.')).taxonomy, 'earnings_beat');
    assert.equal(taxonomyOfReason(false, 'New contract or order without an explicit guidance change'), 'operational_disclosure');
    const a = build([us('Jefferies raises Zed FY27 EBITDA forecast', 'Analysts at Jefferies raised their FY27 EBITDA forecast to $2.4 billion from $2.0 billion.', { kind: 'NEWS', url: 'https://www.reuters.com/x', sourceName: 'Reuters' })]);
    assert.equal(a.taxonomy, 'analyst_revision'); assert.equal(a.pipeline!.status, 'DROPPED'); assert.equal(a.pipeline!.bucket, 'nonGuidance');
  });
  test('management target (multi-year aspiration) is not formal guidance', () => {
    const e = build([india('Zed India raises medium-term growth target', 'Zed India Ltd raised its revenue growth target to 30-35% over FY27-FY29, from 25-30% earlier.')]);
    assert.equal(e.taxonomy, 'management_target'); assert.equal(e.pipeline!.bucket, 'nonGuidance'); assert.equal(e.isUpgrade, false);
  });
});

// ═══ 2. validation ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('2. unit / period / actual-vs-guidance validation', () => {
  test('(a) period mismatch: an old figure stated for another period is not comparable', () => {
    const e = build([us('Zed raises FY26 revenue outlook', 'Zed US Inc now expects FY26 revenue of $330 million to $340 million, up from $71.1 million in Q2 FY26.')]);
    assert.ok(e.validationIssues!.some((i) => i.code === 'PERIOD_MISMATCH' && i.severity === 'INVALID'), JSON.stringify(e.validationIssues));
    assert.equal(e.pipeline!.bucket, 'invalidOrStale'); assert.equal(e.isUpgrade, false);
  });
  test('(a) old figure tied to a single quarter vs an annual new figure', () => {
    const e = build([us('Zed raises FY26 revenue outlook', 'Zed US Inc now expects FY26 revenue of $330 million to $340 million, up from $71.1 million in the quarter.')]);
    assert.ok(e.validationIssues!.some((i) => i.code === 'PERIOD_MISMATCH'));
    assert.notEqual(e.pipeline!.status, 'CARD');
  });
  test('(a) UNSTATED period -> needs review, never a card', () => {
    const e = build([us('Zed raises outlook', 'Zed US Inc raised revenue guidance to $10.8 billion from $10.0 billion.')]);
    assert.ok(e.validationIssues!.some((i) => i.code === 'PERIOD_UNSTATED' && i.severity === 'REVIEW'));
    assert.equal(e.pipeline!.reviewStatus, 'needs_review'); assert.equal(e.displayLabel, 'NEEDS REVIEW'); assert.equal(e.decision, 'UNVERIFIED');
  });
  test('(b) a reported actual used as the old figure', () => {
    const e = build([us('Zed raises FY26 EBITDA outlook', 'Zed US Inc now expects FY26 EBITDA of $146 million, up from reported EBITDA of $135 million.')]);
    assert.ok(e.validationIssues!.some((i) => i.code === 'ACTUAL_VS_GUIDANCE' && i.severity === 'INVALID'), JSON.stringify(e.validationIssues));
    assert.notEqual(e.pipeline!.status, 'CARD');
  });
  test('(b)(d) Fulgent shape: $71.1M single figure -> $330–340M annual range is requeued (implausible / quarterly actual)', () => {
    const [e] = fromRow({ ticker: 'FLGT', company: 'Fulgent', guidance_figures: [{ metric: 'revenue', basis: 'gaap', period: 'year', period_label: 'FY26', low: 330e6, high: 340e6, unit: 'usd', prior_low: 71.1e6, prior_high: 71.1e6, raised: true }] });
    assert.equal(e.pipeline!.reviewStatus, 'needs_review'); assert.match(e.pipeline!.reason, /implausible change, likely period or unit mix-up/);
    assert.ok(e.validationIssues!.some((i) => i.code === 'ACTUAL_VS_GUIDANCE'));
    assert.equal(e.isUpgrade, false); assert.equal(e.decision, 'UNVERIFIED');
  });
  test('(d) Digi shape: EBITDA $35.5–37M -> $146–147.5M (+305%) needs review; ADM shape net profit $298M -> $908M needs review', () => {
    const [d] = fromRow({ ticker: 'DGII', company: 'Digi', guide_change: [{ metric: 'ebitda', basis: 'adjusted', period_label: 'FY26', prev_low: 35.5e6, prev_high: 37e6, new_low: 146e6, new_high: 147.5e6, direction: 'raised', unit: 'usd' }] });
    assert.equal(d.pipeline!.reviewStatus, 'needs_review');
    const [a] = fromRow({ ticker: 'ADM', company: 'ADM', guide_change: [{ metric: 'net_income', basis: 'gaap', period_label: 'FY26', prev_low: 298e6, prev_high: 298e6, new_low: 908e6, new_high: 908e6, direction: 'raised', unit: 'usd' }] });
    assert.equal(a.pipeline!.reviewStatus, 'needs_review');
    assert.equal(GU_VALIDATION.IMPLAUSIBLE_PROFIT_PCT, 100); assert.equal(GU_VALIDATION.IMPLAUSIBLE_REVENUE_PCT, 50);
  });
  test('(b) Matson shape: several single figures with reported-style precision look like actuals -> needs review', () => {
    const [e] = fromRow({ ticker: 'MATX', company: 'Matson', guide_change: [
      { metric: 'eps', basis: 'gaap', period_label: 'FY26', prev_low: 2.92, prev_high: 2.92, new_low: 4.27, new_high: 4.27, direction: 'raised', unit: 'usd_share' },
      { metric: 'operating_income', basis: 'gaap', period_label: 'FY26', prev_low: 113e6, prev_high: 113e6, new_low: 158.9e6, new_high: 158.9e6, direction: 'raised', unit: 'usd' },
      { metric: 'net_income', basis: 'gaap', period_label: 'FY26', prev_low: 94.7e6, prev_high: 94.7e6, new_low: 129.4e6, new_high: 129.4e6, direction: 'raised', unit: 'usd' }] });
    assert.equal(e.pipeline!.reviewStatus, 'needs_review'); assert.match(e.pipeline!.reason, /reported-style precision/);
  });
  test('(c) B&W shape: the same figures under Q2 2026 and FY26 -> both invalid (across separate events)', () => {
    const t1 = us('Zed BW raises Q2 2026 revenue outlook', 'Zed BW now expects Q2 2026 revenue of $319.7 million, up from $138.9 million previously.', { ticker: 'ZZBW', company: 'Zed BW' });
    const t2 = us('Zed BW raises FY26 revenue outlook', 'Zed BW now expects FY26 revenue of $319.7 million, up from $138.9 million previously.', { ticker: 'ZZBW', company: 'Zed BW' });
    const evs = processCandidates([t1, t2], () => ({}), NOW, '7D');
    assert.equal(evs.length, 2);
    for (const e of evs) { assert.equal(e.pipeline!.bucket, 'invalidOrStale', JSON.stringify(e.pipeline)); assert.ok(e.validationIssues!.some((i) => i.code === 'DUPLICATE_ACROSS_PERIODS')); assert.equal(e.isUpgrade, false); }
    // and inside one release
    const iss = validateChanges(extractGuidance('Zed BW now expects Q2 2026 revenue of $319.7 million, up from $138.9 million previously. Zed BW now expects FY26 revenue of $319.7 million, up from $138.9 million previously.'), { announcementDate: '2026-09-29', market: 'US' });
    assert.equal(iss.filter((i) => i.code === 'DUPLICATE_ACROSS_PERIODS').length, 2);
    assert.equal(duplicatesAcrossEvents([]).size, 0);
  });
  test('(e) Flutter shape: a "range" whose high end is more than 5x its low end is invalid', () => {
    const e = build([us('Zed raises FY26 revenue outlook', 'Zed US Inc now expects FY26 revenue of $0.4 billion to $17.9 billion, up from $0.3 billion to $16.0 billion.')]);
    assert.ok(e.validationIssues!.some((i) => i.code === 'DEGENERATE_RANGE' && i.severity === 'INVALID'));
    assert.equal(e.pipeline!.bucket, 'invalidOrStale');
  });
  test('(f) stale periods: FY25 raised in a Sept 2026 announcement (US), Q2 2025 margins, India FY26 after March 2026', () => {
    assert.equal(isStalePeriod('FY25', '2026-09-29', 'US'), true); assert.equal(isStalePeriod('FY26', '2026-09-29', 'US'), false);
    assert.equal(isStalePeriod('Q2 2025', '2026-09-29', 'US'), true); assert.equal(isStalePeriod('Q2 2026', '2026-07-15', 'US'), false);
    assert.equal(isStalePeriod('FY26', '2026-09-29', 'IN'), true); assert.equal(isStalePeriod('FY27', '2026-09-29', 'IN'), false);
    assert.equal(isStalePeriod('Q2 FY27', '2026-11-05', 'IN'), true); assert.equal(periodEndBound('Q2 FY27', 'IN'), '2026-09-30');
    const e = build([us('Zed raises FY25 guidance', 'Zed US Inc raised FY25 revenue guidance to $10.8 billion from $10.0 billion.')]);
    assert.equal(e.pipeline!.reviewStatus, 'stale'); assert.equal(e.displayLabel, 'STALE PERIOD'); assert.equal(e.decision, 'REJECT');
    const m = build([us('Zed raises Q2 2025 margin outlook', 'Zed US Inc raised Q2 2025 operating margin guidance to 24% from 22%.')]);
    assert.equal(m.pipeline!.reviewStatus, 'stale');
  });
  test('(g) EPS with a scale word is dropped; a per-share-sized figure under an absolute metric is invalid', () => {
    const e = build([us('Zed raises FY26 EPS outlook', 'Zed US Inc raised FY26 EPS guidance to $4.75 million from $4.20 million.')]);
    assert.ok(e.v2!.unitWarnings.some((w) => /Unit error: EPS carried a scale/.test(w))); assert.notEqual(e.pipeline!.status, 'CARD');
    const np = build([us('Zed raises FY26 profit outlook', 'Zed US Inc raised FY26 net income guidance to $1.35 from $1.25.')]);
    assert.ok(np.validationIssues!.some((i) => i.code === 'PER_SHARE_MISMATCH'), JSON.stringify(np.validationIssues)); assert.notEqual(np.pipeline!.status, 'CARD');
  });
  test('(h) Host Hotels shape: consensus 57.6% away is another metric or basis -> gap DATA UNAVAILABLE', () => {
    const e = build([us('Zed raises FY26 adjusted EPS outlook', 'Zed US Inc raised FY26 adjusted EPS guidance to $2.11 to $2.21 from $2.00 to $2.10.')],
      { consensus: { metric: 'ADJ_EPS', period: 'FY26', value: 1.37, unit: '$', source: 'vendor' } });
    assert.equal(e.expectationGap, 'UNKNOWN'); assert.equal(e.gapPct, null);
    assert.ok(e.evidenceGaps.some((g) => /likely measures a different metric or basis/.test(g)));
    assert.ok(e.validationIssues!.some((i) => i.code === 'CONSENSUS_METRIC_MISMATCH'));
    assert.equal(consensusLooksMismatched(57.6), true); assert.equal(consensusLooksMismatched(-3), false);
  });
});

// ═══ 3. GAAP vs adjusted ════════════════════════════════════════════════════════════════════════════════════════
describe('3. GAAP vs adjusted: never mixed; adjusted is the headline', () => {
  test('Caleres shape: GAAP EPS +83.6% vs adjusted +3.3% -> headline adjusted +3.3%, GAAP shown separately', () => {
    const [e] = fromRow({ ticker: 'CAL', company: 'Caleres', guide_change: [
      { metric: 'eps', basis: 'gaap', period_label: 'FY26', prev_low: 1.0, prev_high: 1.2, new_low: 1.9, new_high: 2.14, direction: 'raised', unit: 'usd_share' },
      { metric: 'eps', basis: 'adjusted', period_label: 'FY26', prev_low: 2.1, prev_high: 2.2, new_low: 2.17, new_high: 2.27, direction: 'raised', unit: 'usd_share' }] });
    assert.equal(e.headlineBasis, 'ADJUSTED');
    assert.deepEqual(e.changes.map((c) => c.metric), ['ADJ_EPS']);
    assert.ok(e.otherChanges!.some((c) => c.metric === 'EPS'));
    assert.equal(e.valuation!.earningsEffectPct.value, 3.26); assert.match(e.valuation!.earningsEffectPct.source!, /adjusted/);
    assert.equal(e.materiality, 'LOW');   // +3.3% EPS is small; the GAAP +83.6% never sizes it
    assert.match(e.basisNote!, /Headline uses adjusted EPS \+3\.3%.*GAAP EPS \+83\.6% is shown separately — the gap between the two usually comes from one-off items/);
    assert.match(e.whyNow, /raised adjusted EPS guidance/);
  });
  test('splitByBasis keeps a single basis untouched', () => {
    const ch = extractGuidance('Zed raised FY26 revenue guidance to $10.8 billion from $10.0 billion.');
    const s = splitByBasis(ch); assert.equal(s.headline.length, 1); assert.equal(s.secondary.length, 0); assert.equal(s.note, null);
  });
});

// ═══ 4. capital raise ═══════════════════════════════════════════════════════════════════════════════════════════
describe('4. capital raise / financing is classified and removed, guidance raises are not', () => {
  test('a financing narrative -> capital_raise_or_financing, DROPPED, REJECT (never an event card)', () => {
    const e = build([us('Zed raises guidance', 'Zed US Inc announced the pricing of its $400 million senior notes offering, upsized to $400 million from $300 million.')]);
    assert.equal(e.taxonomy, 'capital_raise_or_financing'); assert.equal(e.pipeline!.status, 'DROPPED'); assert.equal(e.pipeline!.bucket, 'capitalRaise');
    assert.equal(e.displayLabel, 'CAPITAL RAISE (NOT GUIDANCE)'); assert.equal(e.isUpgrade, false);
    assert.equal(financingVerdict('Zed Ltd raises Rs 500 crore via QIP', '').capitalRaise, true);
    assert.equal(financingVerdict('Zed raises full-year outlook', 'Zed raised its FY26 revenue outlook. It also amended its revolving credit facility.').capitalRaise, false);
  });
  test('ANF / CTRN / J / PBI shapes were FALSE flags: a broker word inside a company name, or a cash-flow guide', () => {
    assert.equal(nonGuidanceRaiseSentence('Abercrombie & Fitch raised revenue guidance for FY26 to $5.2 billion from $5.0 billion.'), false);
    assert.equal(nonGuidanceRaiseSentence('Citi Trends raised revenue guidance for FY26 to $800 million from $780 million.'), false);
    assert.equal(nonGuidanceRaiseSentence('Pitney Bowes raised free cash flow guidance for FY26 to $340 million from $300 million.'), false);
    assert.equal(nonGuidanceRaiseSentence('Jacobs raised adjusted free cash flow guidance for FY26.'), false);
    // the real things are still caught
    assert.equal(nonGuidanceRaiseSentence('Jefferies raises Zed FY27 EBITDA forecast'), true);
    assert.equal(nonGuidanceRaiseSentence('Zed raises Rs 13,000 crore via bonds'), true);
    assert.equal(brokerWordIsCompanyName('Abercrombie & Fitch raised', 'Abercrombie & '.length, 5), true);
    assert.equal(brokerWordIsCompanyName('Goldman Sachs raises', 0, 7), false);
    // the same headlines survive the candidate guard
    const anf = us('Abercrombie & Fitch raises FY26 sales outlook', 'Abercrombie & Fitch raised FY26 revenue guidance to $5.2 billion from $5.0 billion.', { ticker: 'ANF', company: 'Abercrombie & Fitch' });
    assert.equal(sanitizeRaiseCandidate(anf), anf);
  });
  test('the narrative the engine writes for a real raise never reads as a capital raise (the invariant no longer fires)', () => {
    for (const [tk, co, txt] of [
      ['ANF', 'Abercrombie & Fitch', 'Abercrombie & Fitch raised FY26 revenue guidance to $5.2 billion from $5.0 billion.'],
      ['CTRN', 'Citi Trends', 'Citi Trends raised FY26 revenue guidance to $820 million from $800 million.'],
      ['PBI', 'Pitney Bowes', 'Pitney Bowes raised FY26 free cash flow guidance to $340 million from $300 million.'],
      ['J', 'Jacobs Solutions', 'Jacobs Solutions raised FY26 adjusted EPS guidance to $6.30 from $6.10.'],
    ] as const) {
      const e = build([us(`${co} raises FY26 guidance`, txt, { ticker: tk, company: co })]);
      assert.equal(e.taxonomy, 'formal_upgrade', `${tk} ${JSON.stringify(e.pipeline)}`);
      assert.equal(nonGuidanceRaiseSentence(e.whyNow), false, `${tk}: ${e.whyNow}`);
    }
  });
});

// ═══ 5. review queue + one primary-source state ═════════════════════════════════════════════════════════════════
describe('5. DETECTED items are queue items, never cards; one primary-source state', () => {
  test('primary document read but no numbers -> awaiting_numbers; no "Awaiting primary source" next to "read"', () => {
    const e = build([india('Zed India raises FY27 guidance at AGM', 'Zed India Ltd raised its FY27 revenue guidance at the AGM.')]);
    assert.equal(e.pipeline!.status, 'QUEUE'); assert.equal(e.pipeline!.reviewStatus, 'awaiting_numbers'); assert.equal(e.displayLabel, 'AWAITING NUMBERS');
    assert.equal(e.primarySourceState, 'read_numbers_not_found');
    assert.equal(stageNote(e), 'Primary source read — old and new figures not found in it');
    assert.ok(!/awaiting primary/i.test(`${stageNote(e)} ${primaryStateLine(e)}`), `${stageNote(e)} | ${primaryStateLine(e)}`);
    assert.equal(e.decision, 'UNVERIFIED');
  });
  test('media only, no numbers -> awaiting_primary with primarySourceState not_found', () => {
    const e = build([media('Zed India raises FY27 guidance', 'Zed India Ltd raised its FY27 guidance, management said.')]);
    assert.equal(e.pipeline!.reviewStatus, 'awaiting_primary'); assert.equal(e.primarySourceState, 'not_found'); assert.equal(stageNote(e), 'Awaiting primary source');
  });
  test('media only WITH numbers -> unverified bucket, queued (not a main card), label UNVERIFIED CLAIM', () => {
    const e = build([media('Zed India raises FY27 revenue guidance', 'Zed India Ltd now expects revenue of ₹725–750 crore for FY27, up from ₹600 crore earlier.')]);
    assert.equal(e.pipeline!.bucket, 'unverified'); assert.equal(e.pipeline!.status, 'QUEUE'); assert.equal(e.displayLabel, 'UNVERIFIED CLAIM');
  });
  test('a later verification re-derives the pipeline and the decision (withClassification)', () => {
    const e = build([media('Zed India raises FY27 revenue guidance', 'Zed India Ltd now expects revenue of ₹725–750 crore for FY27, up from ₹600 crore earlier, driven by strong demand.')]);
    const v = withClassification({ ...e, verification: 'VERIFIED', primaryAvailable: true, sources: [...e.sources, { name: 'NSE filing', tier: 'PRIMARY', type: 'Exchange filing', url: NSE }] });
    assert.equal(v.pipeline!.status, 'CARD'); assert.equal(v.displayLabel, 'GUIDANCE UPGRADE'); assert.notEqual(v.decision, 'UNVERIFIED'); assert.equal(v.primarySourceState, 'read_numbers_found');
  });
  test('partitionPipeline: cards / audit / queue rows with reasons', () => {
    const evs = processCandidates([
      us('Zed raises FY26 guidance', 'Zed US Inc raised FY26 revenue guidance to $10.8 billion from $10.0 billion.', { ticker: 'ZZA' }),
      us('Zed raises FY26 guidance', 'Zed US Inc raised FY26 revenue guidance to $10.0 billion from $10.0 billion.', { ticker: 'ZZB' }),   // headline says raised, numbers say reiterated
      us('Zed raises FY25 guidance', 'Zed US Inc raised FY25 revenue guidance to $10.8 billion from $10.0 billion.', { ticker: 'ZZC' }),
      media('Zed India raises FY27 guidance', 'Zed India Ltd raised its FY27 guidance, management said.'),
    ], () => ({}), NOW, '7D');
    const p = partitionPipeline(evs);
    assert.equal(p.cards.length, 1); assert.equal(p.cards[0].ticker, 'ZZA');
    assert.equal(p.audit.length, 1); assert.equal(p.audit[0].ticker, 'ZZB');
    assert.equal(p.queue.length, 2); assert.ok(p.queue.every((q) => q.reason.length > 10));
    assert.ok(p.queue.some((q) => q.status === 'stale')); assert.ok(p.queue.some((q) => q.status === 'awaiting_primary'));
    assert.match(reviewItemLine(p.queue.find((q) => q.status === 'stale')!), /^STALE PERIOD · /);
  });
});

// ═══ 6. decision rule ═══════════════════════════════════════════════════════════════════════════════════════════
describe('6. REJECT is never driven by tiny or missing consensus gaps', () => {
  const T = 'Zed US Inc raised FY26 revenue guidance to $10.8 billion from $10.0 billion and EPS to $4.75 from $4.00, driven by strong demand and a multi-year backlog. Demand should continue over the next few quarters.';
  test('gap within +/-2% is INLINE (neutral) and never REJECT', () => {
    assert.equal(computeGap(10.4, 10.46).gap, 'INLINE'); assert.equal(computeGap(10.4, 10.41).gap, 'INLINE');
    const e = build([us('Zed raises FY26 guidance', T)], { consensus: { metric: 'REVENUE', period: 'FY26', value: 10.7, unit: '$B', source: 'c' }, priceContext: { pe: 20 } });
    assert.equal(e.expectationGap, 'INLINE'); assert.notEqual(e.decision, 'REJECT'); assert.equal(e.decision, 'WATCHLIST');
  });
  test('a clearly negative gap on a verified raise lowers to WATCHLIST, never REJECT', () => {
    const e = build([us('Zed raises FY26 guidance', T)], { consensus: { metric: 'REVENUE', period: 'FY26', value: 11.4, unit: '$B', source: 'c' } });
    assert.equal(e.expectationGap, 'NEGATIVE'); assert.equal(e.decision, 'WATCHLIST');
  });
  test('missing consensus is unknown, not negative; UNVERIFIED = no decision; price never used', () => {
    const e = build([us('Zed raises FY26 guidance', T)]);
    assert.equal(e.expectationGap, 'UNKNOWN'); assert.notEqual(e.decision, 'REJECT');
    const u = build([us('Zed raises FY26 guidance', T, { kind: 'NEWS', url: 'https://www.reuters.com/z', sourceName: 'Reuters' })]);
    assert.equal(u.decision, 'UNVERIFIED');
    const a = build([us('Zed raises FY26 guidance', T)], { priceContext: { pe: 25, move7dPct: 0 } }); const b = build([us('Zed raises FY26 guidance', T)], { priceContext: { pe: 25, move7dPct: 40 } });
    assert.equal(a.decision, b.decision);
  });
  test('REJECT reserved for lowered / invalid / stale / capital raise', () => {
    assert.equal(build([us('Zed cuts', 'Zed US Inc lowered FY26 revenue guidance to $9.5 billion from $10.0 billion.')]).decision, 'REJECT');
    assert.equal(build([us('Zed raises FY25 guidance', 'Zed US Inc raised FY25 revenue guidance to $10.8 billion from $10.0 billion.')]).decision, 'REJECT');
    assert.equal(build([us('Zed raises FY26 guidance', 'Zed US Inc raised FY26 revenue guidance to $10.1 billion from $10.0 billion.')]).decision, 'WATCHLIST');
  });
});

// ═══ 7. materiality + repeated upgrader ═════════════════════════════════════════════════════════════════════════
describe('7. materiality from the headline midpoint %, and REPEATED UPGRADER needs a PRIOR raise', () => {
  const m = (t: string) => materiality(extractGuidance(t)).level;
  test('+0.3% and +2% are LOW; Lands End net profit +1.9% is LOW; revenue +6% HIGH; EPS +12% HIGH; EPS +6% MEDIUM', () => {
    assert.equal(m('raised FY26 revenue guidance to $10.03 billion from $10.0 billion'), 'LOW');
    assert.equal(m('raised FY26 revenue guidance to $10.2 billion from $10.0 billion'), 'LOW');
    assert.equal(m('raised FY26 net income guidance to $10.7 million from $10.5 million'), 'LOW');
    assert.equal(m('raised FY26 revenue guidance to $10.6 billion from $10.0 billion'), 'HIGH');
    assert.equal(m('raised FY26 EPS guidance to $4.48 from $4.00'), 'HIGH');
    assert.equal(m('raised FY26 EPS guidance to $4.24 from $4.00'), 'MEDIUM');
    assert.equal(m('raised FY26 revenue guidance to $10.3 billion from $10.0 billion'), 'MEDIUM');
  });
  const T = 'Zed US Inc raised FY26 revenue guidance to $10.8 billion from $10.0 billion and EPS to $4.75 from $4.00.';
  const raised = (date: string): GuLedgerRow => ({ date, metric: 'REVENUE', period: 'FY26', text: '$10B', change: 'RAISED' });
  test('no flag for the current event alone (even with two metrics raised, or the same event stored in the ledger before)', () => {
    assert.ok(!build([us('Zed raises FY26 guidance', T)]).flags.includes('REPEATED_UPGRADER'));
    assert.ok(!build([us('Zed raises FY26 guidance', T)], { ledger: [raised('2026-09-29'), { ...raised('2026-09-29'), metric: 'EPS' }] }).flags.includes('REPEATED_UPGRADER'));
  });
  test('flag with >= 1 prior verified raise in the last ~12 months; not with one older than that', () => {
    assert.ok(build([us('Zed raises FY26 guidance', T)], { ledger: [raised('2026-06-15')] }).flags.includes('REPEATED_UPGRADER'));
    assert.ok(!build([us('Zed raises FY26 guidance', T)], { ledger: [raised('2025-06-15')] }).flags.includes('REPEATED_UPGRADER'));
    assert.deepEqual(priorRaiseDates([raised('2026-06-15'), raised('2026-06-15'), raised('2026-09-29')], '2026-09-29'), ['2026-06-15']);
  });
  test('the ledger only stores formal raises of verified cards as RAISED', () => {
    const fu = build([us('Zed raises FY26 adjusted EPS guidance', 'Zed US Inc now expects Adjusted EPS for FY26 of $4.70–4.85, up from $4.60–4.90 previously.')]);
    assert.equal(fu.pipeline!.status, 'AUDIT'); assert.ok(isLedgerWorthy(fu)); assert.ok(ledgerRowsOf(fu).every((r) => r.change !== 'RAISED'));
    const st = build([us('Zed raises FY25 guidance', 'Zed US Inc raised FY25 revenue guidance to $10.8 billion from $10.0 billion.')]);
    assert.equal(isLedgerWorthy(st), false);
  });
});

// ═══ 8. why now / next evidence / audit notes ═══════════════════════════════════════════════════════════════════
describe('8-9. WHY NOW, next evidence and audit rows are specific', () => {
  test('no driver: dated and names the document; never the old boilerplate', () => {
    const e = build([us('Zed raises FY26 guidance', 'Zed US Inc raised FY26 revenue guidance to $10.8 billion from $10.0 billion.')]);
    assert.match(e.whyNow, /Why now: guidance raised on 2026-09-29 in Company earnings release \(SEC 8-K exhibit\); driver not stated in the release\.$/);
    assert.ok(!e.decisionReason.join(' ').includes('Driver unresolved'));
  });
  test('next evidence: metric, direction, window, source', () => {
    const e = build([us('Zed raises FY26 guidance', 'Zed US Inc raised FY26 revenue guidance to $330 million to $340 million from $320 million to $330 million.')]);
    assert.match(e.nextEvidence[0], /^Next quarterly results \(~Dec 2026\): quarterly revenue of about \$82\.5M or more \(guided low end ÷ 4, seasonality not considered\) to stay on track for the guided \$330–340M for FY26 — source: the company's next results release\.$/);
    const q = build([us('Zed raises Q4 FY26 guidance', 'Zed US Inc raised Q4 FY26 revenue guidance to $90 million from $85 million.')]);
    assert.match(q.nextEvidence[0], /^Q4 FY26 results: revenue at or above the guided \$90M/);
  });
  test('operating variable only when stated', () => {
    const e = build([us('Zed raises FY26 guidance', 'Zed US Inc raised FY26 revenue guidance to $10.8 billion from $10.0 billion.')]);
    assert.equal(e.v2!.operatingVariable, null); assert.equal(e.nextEvidence.length, 2); assert.ok(!/stated driver/.test(e.nextEvidence.join(' ')));
  });
  test('audit notes: reiteration / lowered / mixed / midpoint-only are each specific', () => {
    const fu = build([us('Zed raises FY26 adjusted EPS guidance', 'Zed US Inc now expects Adjusted EPS for FY26 of $4.70–4.85, up from $4.60–4.90 previously.')]);
    assert.equal(fu.auditNote, 'Midpoint up but range narrowed: FY26 adjusted EPS top end cut from $4.90 to $4.85 (midpoint $4.75 → $4.78)');
    const low = build([us('Zed cuts', 'Zed US Inc lowered FY26 revenue guidance to $9.5 billion from $10.0 billion.')]);
    assert.equal(low.auditNote, 'Lowered: FY26 revenue $10B → $9.5B');
    const notes = new Set([fu.auditNote, low.auditNote]); assert.equal(notes.size, 2);
  });
});

// ═══ 10. exact partition ════════════════════════════════════════════════════════════════════════════════════════
describe('10. summary counts partition exactly', () => {
  test('the ten buckets add up to processed; summarise exposes pipeline and pipelineByMarket', () => {
    const evs = processCandidates([
      us('Zed raises FY26 guidance', 'Zed US Inc raised FY26 revenue guidance to $10.8 billion from $10.0 billion.', { ticker: 'ZA' }),
      us('Zed raises FY26 guidance', 'Zed US Inc raised FY26 revenue guidance to $10.0 billion from $10.0 billion.', { ticker: 'ZB' }),
      us('Zed cuts', 'Zed US Inc now expects FY26 EPS of $4.20 to $4.30, compared with $4.20 to $4.50 previously, after it raised guidance in June.', { ticker: 'ZC', title: 'Zed raises guidance' }),
      us('Zed raises FY25 guidance', 'Zed US Inc raised FY25 revenue guidance to $10.8 billion from $10.0 billion.', { ticker: 'ZD' }),
      us('Zed raises guidance', 'Zed US Inc announced the pricing of its $400 million senior notes offering, upsized to $400 million from $300 million.', { ticker: 'ZE' }),
      us('Zed raises outlook', 'Zed US Inc raised revenue guidance to $10.8 billion from $10.0 billion.', { ticker: 'ZF' }),
      media('Zed India raises FY27 guidance', 'Zed India Ltd raised its FY27 guidance, management said.'),
      media('Zed India Two raises FY27 revenue guidance', 'Zed India Two Ltd now expects revenue of ₹725–750 crore for FY27, up from ₹600 crore earlier.', { ticker: 'ZZI2', company: 'Zed India Two Ltd' }),
    ], () => ({}), NOW, '7D');
    const c = pipelineCounts(evs);
    assert.equal(BUCKETS.reduce((a, k) => a + c[k], 0), c.processed);
    assert.equal(c.processed, evs.length);
    assert.equal(c.cards + c.audit + c.queue + c.dropped, c.processed);
    assert.equal(c.verifiedUpgrades, 1); assert.equal(c.reiterations, 1); assert.ok(c.invalidOrStale >= 1); assert.equal(c.stale, 1); assert.equal(c.capitalRaise, 1);
    assert.ok(c.needsReview >= 1); assert.equal(c.unverified, 1);
    const s = summarise(evs, '7D', NOW);
    assert.deepEqual(s.pipeline, c);
    assert.equal(s.pipelineByMarket!.IN.processed + s.pipelineByMarket!.US.processed, c.processed);
    assert.equal(s.verified, c.cards + c.audit); assert.ok(s.material <= c.verifiedUpgrades);
    assert.match(pipelineCountsLine(c), / = \d+ processed$/);
  });
});

describe('extra: capital-raise false flags on bank / REIT / long qualifier guidance, thesis on queued items', () => {
  test('bank, REIT and long-qualifier guidance sentences are not read as capital raises', () => {
    for (const s of [
      'Zed Bank raised net interest income guidance for FY26 to $1.2 billion from $1.1 billion.',
      'Zed REIT raised FY26 AFFO per share guidance to $2.10 from $2.00.',
      'Zed raised its full-year adjusted free cash flow guidance to $300 million from $250 million.',
      'Zed raised comparable sales guidance to 3% from 2%.',
    ]) assert.equal(nonGuidanceRaiseSentence(s), false, s);
    assert.equal(nonGuidanceRaiseSentence('Zed raises $300 million via a public offering of common stock'), true);
  });
  test('a queued claim carries no thesis label (TCI shape: thesis A on a REJECT / detected card)', () => {
    const e = build([india('Zed India raises FY27 guidance at AGM', 'Zed India Ltd raised its FY27 revenue guidance at the AGM, citing capacity utilisation and new plant commissioning.')]);
    assert.equal(e.pipeline!.status, 'QUEUE'); assert.equal(e.thesis, null); assert.notEqual(e.decision, 'REJECT');
  });
});

// ═══ wave 2: the producer carries what the PRIOR figure is and its own period; the validator uses it ═════════════
import { classifyPriorText, priorPeriodLabel, guidanceFiguresFromText } from '../us-guidance-figures';
describe('wave 2: prior kind + prior period from the producer (Ethos class)', () => {
  test('classifyPriorText reads only the words: guidance / actual / unknown, and the prior figure\'s own period', () => {
    assert.deepEqual(classifyPriorText('up from the prior guidance of $561 million to $565 million'), { kind: 'guidance', periodLabel: null });
    assert.deepEqual(classifyPriorText('up from $561 million in fiscal 2025'), { kind: 'unknown', periodLabel: 'FY25' });
    assert.deepEqual(classifyPriorText('up from reported revenue of $561 million in 2025'), { kind: 'actual', periodLabel: 'FY25' });
    assert.equal(classifyPriorText('up from $561 million to $565 million').kind, 'unknown');
    assert.equal(priorPeriodLabel('compared with $71.1 million in the second quarter of fiscal 2026'), 'Q2 FY26');
    assert.equal(priorPeriodLabel('versus $1.20 last year'), null);
  });
  test('the release parser stamps prior_kind / prior_period_label on a figure with a prior', () => {
    const figs = guidanceFiguresFromText('Outlook\\nFor fiscal 2026, the company now expects revenue of $727 million to $731 million, up from $561 million to $565 million in fiscal 2025.');
    const f = figs.find((x) => x.metric === 'revenue' && x.prior_low != null);
    assert.ok(f); assert.equal(f!.prior_period_label, 'FY25'); assert.equal(f!.prior_kind, 'unknown');
    const g = guidanceFiguresFromText('Outlook\\nFor fiscal 2026, the company now expects revenue of $727 million to $731 million, up from the prior guidance of $700 million to $710 million.').find((x) => x.metric === 'revenue' && x.prior_low != null);
    assert.ok(g); assert.equal(g!.prior_kind, 'guidance'); assert.equal(g!.prior_period_label, null);
  });
  const fig = (o: Record<string, unknown>) => ({ metric: 'revenue', basis: 'gaap', period: 'year', period_label: 'FY26', low: 727e6, high: 731e6, unit: 'usd', prior_low: 561e6, prior_high: 565e6, raised: true, ...o });
  test('prior = reported actual -> INVALID actual_vs_guidance (never an upgrade)', () => {
    const [e] = fromRow({ ticker: 'ETHS', company: 'Ethos', guidance_figures: [fig({ prior_kind: 'actual', prior_period_label: null })] });
    assert.ok(e.validationIssues!.some((i) => i.code === 'ACTUAL_VS_GUIDANCE' && i.severity === 'INVALID'), JSON.stringify(e.validationIssues));
    assert.equal(e.pipeline!.bucket, 'invalidOrStale'); assert.equal(e.isUpgrade, false);
  });
  test('prior period != new period -> PERIOD_MISMATCH (Ethos: FY25 actual-sized figure against an FY26 guide)', () => {
    const [e] = fromRow({ ticker: 'ETHS', company: 'Ethos', guidance_figures: [fig({ prior_kind: 'unknown', prior_period_label: 'FY25' })] });
    assert.ok(e.validationIssues!.some((i) => i.code === 'PERIOD_MISMATCH' && i.severity === 'INVALID'), JSON.stringify(e.validationIssues));
    assert.equal(e.pipeline!.bucket, 'invalidOrStale');
  });
  test('prior stated as guidance for the same period stays a formal upgrade; guide_change carries prev_kind guidance', () => {
    const [e] = fromRow({ ticker: 'ZZG', guidance_figures: [fig({ low: 600e6, high: 610e6, prior_low: 570e6, prior_high: 580e6, prior_kind: 'guidance', prior_period_label: 'FY26' })] });
    assert.equal(e.taxonomy, 'formal_upgrade'); assert.equal(e.pipeline!.status, 'CARD');
    const [g] = fromRow({ ticker: 'ZZH', guide_change: [{ metric: 'revenue', basis: 'gaap', period_label: 'FY26', prev_low: 570e6, prev_high: 580e6, new_low: 600e6, new_high: 610e6, direction: 'raised', unit: 'usd', prev_kind: 'guidance', prev_period_label: 'FY26' }] });
    assert.equal(g.pipeline!.status, 'CARD');
  });
});
