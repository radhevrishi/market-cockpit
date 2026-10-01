// zzz853 — Guidance Upgrades UI pass: pure helpers + render-string checks for the new fields. No network, no clock (dates are passed in).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SECTIONS, verificationBadge, recordBadge, stateCountsLine, groupCountsLine, cohortLabel, reasonsPlain, reasonCountsLine, viewLabel, viewCountsLine,
  basisText, recordBasis, revisionShort, splitDerivedBasis, lastVerifiedText, freshnessLines, sourceDisplayName, fallbackMessage, dataText, documentsLine,
  qualityStrip, violationTexts, sectionRows, cohortTotal, safeEventLabel, splitAudit, eventCountsStrip, groupRowText, FALLBACK_MESSAGE, INVARIANT_BANNER,
} from '../../components/guidance-upgrades/gu-ui';
import { VerBadge, QualityStrip, FreshnessBlock, BasisLine } from '../../components/guidance-upgrades/GuBits';
import { CoverageCardView } from '../../components/guidance-upgrades/GuCoverage';
import { GuGroupList } from '../../components/guidance-upgrades/GuHighGrowthList';
import { GuAuditArea } from '../../components/guidance-upgrades/GuCard';
import { guUniverseUrl } from '../../components/guidance-upgrades/useGuUniverse';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const metric = (o: any = {}): any => ({ metric: 'REVENUE', metricFamily: 'REVENUE', sourceMetricLabel: null, display: '+60%', short: '+60%', compareValue: 60, period: 'FY27', periodNormalized: 'FY27', verificationState: 'VERIFIED', growthType: 'EXPLICIT', guidanceType: 'GROWTH_RATE', basisLabel: 'stated by company', headlineBasis: 'GROWTH_VS_PRIOR_YEAR', revisionVsPriorGuidance: null, sourceConflict: false, ...o });
const row = (company: string, o: any = {}): any => ({ id: `${company}|a`, rank: 1, entityKey: company, company, ticker: company.toUpperCase(), market: 'IN', cohort: 'ANNUAL', trust: 'verified', metrics: [metric()], text: 'Revenue +60%', headline: metric(), sourceName: 'NSE filings', sourceDate: '2026-09-01', sourceUrl: null, ...o });
const groups = (): any => ({
  threshold: 30, label: 'x', rule: 'y',
  cohorts: { ANNUAL: [row('A'), row('D', { trust: 'derived', market: 'US' })], MULTI_YEAR_CAGR: [row('C', { cohort: 'MULTI_YEAR_CAGR' })], QUARTERLY: [row('Q', { cohort: 'QUARTERLY', trust: 'partial' })] },
  trust: {
    verified: { ANNUAL: [row('A')], MULTI_YEAR_CAGR: [row('C', { cohort: 'MULTI_YEAR_CAGR' })], QUARTERLY: [] },
    derived: { ANNUAL: [row('D', { trust: 'derived', market: 'US' })], MULTI_YEAR_CAGR: [], QUARTERLY: [] },
    partial: { ANNUAL: [], MULTI_YEAR_CAGR: [], QUARTERLY: [row('Q', { cohort: 'QUARTERLY', trust: 'partial' })] },
    claimsAwaiting: { ANNUAL: [], MULTI_YEAR_CAGR: [], QUARTERLY: [] },
  },
  counts: { rows: 4, verified: 2, derived: 1, partial: 1, claimsAwaiting: 0, ANNUAL: 2, MULTI_YEAR_CAGR: 1, QUARTERLY: 1 },
});

describe('sections and cohorts', () => {
  test('four sections, renamed, in order; no BUY or SELL wording', () => {
    assert.deepEqual(SECTIONS.map((s) => s.title), ['HIGHEST ACTIVE GUIDANCE', 'HIGHEST VERIFIED', 'HIGHEST DERIVED', 'CLAIMS AWAITING VERIFICATION']);
    assert.ok(!SECTIONS.some((s) => /highest verified guidance/i.test(s.title)));
    assert.ok(!SECTIONS.some((s) => /\b(buy|sell)\b/i.test(`${s.title} ${s.hint}`)));
  });
  test('sectionRows: active = all cohorts; verified/derived come from trust groups; market filter applies; missing groups are empty', () => {
    const g = groups();
    assert.equal(cohortTotal(sectionRows(g, 'active', 'ALL')), 4);
    assert.deepEqual(sectionRows(g, 'verified', 'ALL').ANNUAL.map((r) => r.company), ['A']);
    assert.deepEqual(sectionRows(g, 'derived', 'US').ANNUAL.map((r) => r.company), ['D']);
    assert.equal(cohortTotal(sectionRows(g, 'derived', 'IN')), 0);
    assert.equal(cohortTotal(sectionRows(undefined, 'active', 'ALL')), 0);
    assert.equal(cohortTotal(sectionRows({ ...g, trust: undefined }, 'verified', 'ALL')), 0);
  });
  test('cohort labels and unknown', () => {
    assert.equal(cohortLabel('MULTI_YEAR_CAGR'), 'Multi-year CAGR');
    assert.equal(cohortLabel('QUARTERLY'), 'Quarterly');
    assert.equal(cohortLabel(null), 'Unknown');
  });
  test('GuGroupList prints each cohort apart, with the row badge and basis', () => {
    const out = html(React.createElement(GuGroupList, { cohorts: sectionRows(groups(), 'active', 'ALL'), emptyText: 'none' }));
    assert.match(out, /Annual \(one year\)/); assert.match(out, /Multi-year CAGR/); assert.match(out, /Quarterly/);
    assert.ok(out.indexOf('Annual (one year)') < out.indexOf('Multi-year CAGR') && out.indexOf('Multi-year CAGR') < out.indexOf('Quarterly'));
    assert.match(out, /stated by company/);
    assert.match(html(React.createElement(GuGroupList, { cohorts: sectionRows(undefined, 'active', 'ALL'), emptyText: 'No rows here' })), /No rows here/);
  });
});

describe('split counts', () => {
  test('X verified · Y partial · Z unverified/derived', () => {
    assert.equal(stateCountsLine({ activeRecords: 10, verified: 4, partial: 2, derived: 1, unverified: 2, periodUnclear: 1 }), '4 verified · 2 partial · 4 unverified/derived');
    assert.equal(groupCountsLine(groups().counts), '2 verified · 1 partial · 1 unverified/derived');
    assert.equal(stateCountsLine(undefined), null); assert.equal(groupCountsLine(null), null);
  });
});

describe('verification badges', () => {
  test('each glyph with a plain tooltip', () => {
    assert.equal(verificationBadge('VERIFIED').glyph, '✓');
    assert.equal(verificationBadge('PARTIAL').glyph, '◐');
    assert.equal(verificationBadge('DERIVED').glyph, '◑');
    assert.equal(verificationBadge('UNVERIFIED').glyph, '○');
    assert.equal(verificationBadge('PERIOD_UNCLEAR').glyph, '⚠');
    assert.equal(verificationBadge('VERIFIED', { sourceConflict: true }).glyph, '⚠');
    assert.equal(verificationBadge('VERIFIED', { sourceConflict: true }).label, 'sources disagree');
    assert.equal(verificationBadge(undefined).glyph, '○');
    for (const s of ['VERIFIED', 'PARTIAL', 'DERIVED', 'UNVERIFIED', 'PERIOD_UNCLEAR']) assert.ok(verificationBadge(s).tip.length > 20);
  });
  test('old records fall back to the older verification field', () => {
    assert.equal(recordBadge({ record: { verification: 'VERIFIED' } }).glyph, '✓');
    assert.equal(recordBadge({ record: { verification: 'PARTIALLY_VERIFIED' } }).glyph, '◐');
    assert.equal(recordBadge({ mediaOnly: true, record: { verification: 'VERIFIED' } }).glyph, '○');
    assert.equal(recordBadge({ verificationState: 'DERIVED', inReviewQueue: true }).glyph, '⚠');
  });
  test('render: glyph and word both printed, tooltip present', () => {
    const out = html(React.createElement(VerBadge, { b: verificationBadge('DERIVED') }));
    assert.match(out, /◑/); assert.match(out, /derived/); assert.match(out, /title="Derived\./);
  });
});

describe('review reasons and views', () => {
  test('plain English by code, backend text as fallback, no duplicates', () => {
    assert.deepEqual(reasonsPlain({ reviewReasonCodes: ['PERIOD_UNCLEAR', 'SECONDARY_ONLY'], reviewReasons: ['x', 'y'] }), ['The year is not stated in the source, so the period is unclear.', 'Only media reported this. No company document yet.']);
    assert.deepEqual(reasonsPlain({ reviewReasons: ['Custom reason'] }), ['Custom reason']);
    assert.deepEqual(reasonsPlain({ reviewReasonCodes: ['NEW_CODE'] }), ['New code']);
    assert.deepEqual(reasonsPlain(null), []);
    assert.equal(reasonCountsLine({ PERIOD_UNCLEAR: 5, SECONDARY_ONLY: 7, EXPIRED: 0 }), 'Media only 7 · Period unclear 5');
    assert.equal(reasonCountsLine({}), null);
  });
  test('view labels use viewCounts; default view is active', () => {
    const vc = { default: 40, review: 9, expired: 3, superseded: 2, withdrawn: 1, excluded: 4 };
    assert.equal(viewLabel('active', vc), 'Active (40)'); assert.equal(viewLabel('review', vc), 'Needs review (9)'); assert.equal(viewLabel('history', vc), 'History (10)');
    assert.equal(viewLabel('active'), 'Active');
    assert.match(viewCountsLine(vc)!, /^40 active · 9 need review/);
    assert.equal(viewCountsLine(undefined), null);
  });
  test('request url carries view=review and never a window', () => {
    assert.match(guUniverseUrl({ view: 'review' }), /view=review/); assert.match(guUniverseUrl({}), /view=active/); assert.ok(!/window=/.test(guUniverseUrl({ view: 'history' })));
  });
});

describe('growth basis', () => {
  test('derived growth shows its base and both bases when both exist', () => {
    const t = basisText({ short: '+94% (derived)', growthType: 'DERIVED', basisLabel: 'vs FY26 actual (derived: ₹210–225 Cr vs ₹108.23 Cr)', revisionVsPriorGuidance: 'raised +20.8% vs prior guidance (₹180 Cr → ₹217 Cr, prior dated 2026-05-01)' });
    assert.equal(t.line, '+94% vs FY26 actual (derived) · +20.8% vs prior guidance');
    assert.equal(t.detail, '₹210–225 Cr vs ₹108.23 Cr');
  });
  test('stated, implied, unknown never invent a number', () => {
    assert.equal(basisText({ short: '+60%', growthType: 'EXPLICIT', basisLabel: 'stated by company' }).line, '+60% stated by company');
    assert.match(basisText({ short: '', growthType: 'IMPLIED', basisLabel: 'implied; no stated % and no sourced base' }).line, /^Unknown \(implied/);
    assert.equal(basisText({ growthType: 'UNKNOWN', basisLabel: 'no % stated' }).line, 'Unknown · no % stated');
  });
  test('revision text: raise, lowered, pp, unchanged, unparsed', () => {
    assert.equal(revisionShort('raised 20.8% vs prior guidance (x)'), '+20.8% vs prior guidance');
    assert.equal(revisionShort('lowered -5% vs prior guidance (x)'), '-5% vs prior guidance');
    assert.equal(revisionShort('lowered 5% vs prior guidance (x)'), '-5% vs prior guidance');
    assert.equal(revisionShort('raised +3.0 pp vs prior guidance (x)'), '+3.0 pp vs prior guidance');
    assert.equal(revisionShort('unchanged 0% vs prior guidance'), 'unchanged vs prior guidance');
    assert.equal(revisionShort('something else'), 'something else'); assert.equal(revisionShort(null), null);
    assert.deepEqual(splitDerivedBasis('stated by company'), { head: 'stated by company', detail: null });
  });
  test('record basis shows both bases from the record fields', () => {
    const b = recordBasis({ growthVsPriorYear: { type: 'DERIVED', display: '+94% vs FY26 actual (derived: A vs B)', baseLabel: 'FY26 ₹108 Cr' }, revisionVsPriorGuidance: { display: 'raised +20.8% vs prior guidance (x)' } });
    assert.equal(b!.line, '+94% vs FY26 actual (derived) · +20.8% vs prior guidance');
    assert.equal(recordBasis(null), null); assert.equal(recordBasis({}), null);
  });
  test('BasisLine render', () => assert.match(html(React.createElement(BasisLine, { t: basisText({ short: '+94% (derived)', growthType: 'DERIVED', basisLabel: 'vs FY26 actual (derived: A vs B)' }) })), /\+94% vs FY26 actual \(derived\)/));
  test('group row text falls back to metrics', () => {
    assert.equal(groupRowText({ text: 'Revenue +30% · PAT +60%', metrics: [] }), 'Revenue +30% · PAT +60%');
    assert.equal(groupRowText({ text: '', metrics: [metric({ short: '+30%' }), metric({ metric: 'PAT', short: '+60%' })] }), 'Revenue +30% · PAT +60%');
    assert.equal(groupRowText({ text: '', metrics: [] }), 'Unknown');
  });
});

describe('freshness and last verified', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  test('three lines with sources', () => {
    const l = freshnessLines({ builtAt: '2026-10-01T08:12:00Z', servedFrom: 'last_good', scanRuns: ['2026-10-01T06:00:00Z', '2026-09-30T06:00:00Z'], newestItems: ['2026-09-29T10:00:00Z', null], now });
    assert.equal(l.length, 3);
    assert.equal(l[0].text, '2026-10-01 08:12 UTC (saved copy from the last good build)');
    assert.equal(l[1].text, '2026-10-01 06:00 UTC');
    assert.equal(l[2].text, 'newest source item is 2 days old');
  });
  test('missing data says Unknown, never a made-up time', () => {
    const l = freshnessLines({ now });
    assert.deepEqual(l.map((x) => x.text), ['Unknown', 'Unknown', 'Unknown']); assert.ok(l.every((x) => !x.known));
    assert.match(html(React.createElement(FreshnessBlock, { now })), /Guidance data last updated/);
  });
  test('last verified: days, stale mark, unknown', () => {
    assert.deepEqual(lastVerifiedText({ lastVerifiedDaysAgo: 12, staleVerification: false }), { text: 'Last verified 12 days ago', stale: false });
    assert.deepEqual(lastVerifiedText({ lastVerifiedDaysAgo: 75, staleVerification: true }), { text: 'Last verified 75 days ago (stale)', stale: true });
    assert.equal(lastVerifiedText({ lastVerifiedDaysAgo: 0 }).text, 'Last verified today');
    assert.equal(lastVerifiedText({ lastVerifiedDaysAgo: 1 }).text, 'Last verified 1 day ago');
    assert.equal(lastVerifiedText({}).text, 'Last verified: Unknown');
    assert.equal(lastVerifiedText({ lastVerifiedDaysAgo: 90 }).stale, true);
  });
});

describe('coverage card', () => {
  const card = (o: any = {}): any => ({
    market: 'IN', requestedWindow: '7D', windowDays: 7, calendarDays: 7, tradingDays: 5, daysAttempted: 5, daysSuccessfullyRead: 3, daysPartialCoverage: 1, daysPrimaryPartial: 1, daysFallbackOnly: 0, daysNotAttempted: 0, daysFromEarlierRuns: 0, daysFailed: 1,
    coveredLabel: '3 of 5 trading days read from primary exchange feeds', partialLabel: null,
    sources: [
      { name: 'NSE filings', tier: 'PRIMARY', queryStatus: 'FAILED', dataStatus: 'UNKNOWN', status: 'FAILED', recordsRead: 0, reason: 'query failed: timeout', daysAttempted: 5, daysSucceeded: 0 },
      { name: 'Graded results cache', tier: 'SECONDARY', queryStatus: 'SUCCESS', dataStatus: 'ZERO_RESULTS', status: 'EMPTY', recordsRead: 0, reason: 'zero rows', daysAttempted: 5, daysSucceeded: 5 },
    ],
    cache: [{ name: 'News cache', key: 'k', state: 'CACHE_MISS', servedBy: 'FALLBACK_FEED', items: 4, text: 'News cache key missing; fallback used' }],
    fallbackNote: null, documentsAwaitingGrading: 6, documentsUnavailable: 1, candidatesDiscovered: 12, processed: 5, verified: 2, overall: 'PARTIAL', overallReason: 'NSE filings FAILED', headline: 'India: coverage partial', ...o,
  });
  test('query status and data status are separate; a failed query is never a zero', () => {
    const out = html(React.createElement(CoverageCardView, { c: card() }));
    assert.match(out, /Query:<\/b> Query failed/); assert.match(out, /Data:<\/b> Unknown \(a failed query is never a zero\)/);
    assert.match(out, /Query:<\/b> Query worked/); assert.match(out, /Data:<\/b> Zero results/);
    for (const w of ['PARTIAL', 'FAILED', 'EMPTY']) assert.match(out, new RegExp(`>${w}<`));
    assert.equal(dataText({ dataStatus: 'DATA_FOUND', recordsRead: 1 }), '1 record found');
  });
  test('fallback message shown when applicable, absent otherwise', () => {
    assert.equal(fallbackMessage(card()), `${FALLBACK_MESSAGE}.`);
    assert.match(html(React.createElement(CoverageCardView, { c: card() })), /Primary news cache unavailable; fallback scraped feed active/);
    const none = card({ cache: [{ name: 'News cache', key: 'k', state: 'HIT', servedBy: 'LIVE', items: 9, text: 'ok' }] });
    assert.equal(fallbackMessage(none), null); assert.doesNotMatch(html(React.createElement(CoverageCardView, { c: none })), /fallback scraped feed/);
    assert.equal(fallbackMessage(card({ fallbackNote: 'Backend wording.' })), 'Backend wording.');
  });
  test('documents awaiting grading are separate from verified events', () => {
    assert.deepEqual(documentsLine(card()), ['Verified events: 2', 'Documents awaiting grading: 6 (not counted as verified)', 'Documents whose source was unavailable: 1']);
    assert.match(html(React.createElement(CoverageCardView, { c: card() })), /Documents awaiting grading: 6 \(not counted as verified\)/);
  });
  test('human-readable source names', () => {
    assert.equal(sourceDisplayName('SEC EDGAR 8-K (items 2.02/7.01)'), 'SEC filings (8-K)');
    assert.equal(sourceDisplayName('Scraped filings blob'), 'Scraped filings copy (backup)');
    assert.equal(sourceDisplayName('Persisted event store'), 'Saved events from earlier runs');
    assert.equal(sourceDisplayName('Reuters'), 'Reuters'); assert.equal(sourceDisplayName(''), 'Unknown');
  });
});

describe('data-quality strip', () => {
  test('counts, reasons, stale, conflicts, violations banner and live notice', () => {
    const d: any = { summary: { counts: { activeRecords: 5, verified: 2, partial: 1, derived: 1, unverified: 1, periodUnclear: 0 }, reviewReasonCounts: { PERIOD_UNCLEAR: 3 }, staleVerificationCount: 2, sourceConflictCount: 1, reviewQueueCount: 3 },
      invariantViolations: [{ code: 'x', entityKey: null, company: null, metric: null, message: 'count mismatch' }, 'plain text'], liveError: 'news cache down', servedFrom: 'last_good' };
    const out = html(React.createElement(QualityStrip, { data: d }));
    assert.match(out, /2 verified · 1 partial · 2 unverified\/derived/); assert.match(out, /2 verification stale/); assert.match(out, /1 source conflict</);
    assert.match(out, /Period unclear 3/); assert.ok(out.includes(INVARIANT_BANNER)); assert.match(out, /count mismatch/); assert.match(out, /news cache down/); assert.match(out, /saved copy/);
    assert.deepEqual(violationTexts([{ message: 'a' }, 'b', 5]), ['a', 'b']);
  });
  test('nothing to say renders nothing; zero violations means no banner; old answers do not crash', () => {
    assert.equal(html(React.createElement(QualityStrip, { data: { summary: {}, invariantViolations: [] } as any })), '');
    assert.equal(html(React.createElement(QualityStrip, { data: null })), '');
    assert.deepEqual(qualityStrip({ summary: { counts: undefined } }).violations, []);
  });
});

describe('event labels', () => {
  const ev = (o: any = {}): any => ({ displayLabel: 'GUIDANCE UPGRADE', classification: 'RAISE', verification: 'VERIFIED', auditOnly: false, v2: undefined, changes: [], ...o });
  test('GUIDANCE UPGRADE only for RAISE + VERIFIED', () => {
    assert.equal(safeEventLabel(ev()).label, 'GUIDANCE UPGRADE');
    assert.equal(safeEventLabel(ev({ verification: 'UNVERIFIED' })).label, 'UNVERIFIED CLAIM');
    assert.equal(safeEventLabel(ev({ classification: 'MIXED' })).label, 'UNVERIFIED CLAIM');
    assert.equal(safeEventLabel(ev({ classification: 'REITERATION', verification: 'VERIFIED' })).label, 'UNVERIFIED CLAIM');
  });
  test('other labels pass through, and old events with no label are derived safely', () => {
    assert.equal(safeEventLabel(ev({ displayLabel: 'REITERATION', classification: 'REITERATION' })).label, 'REITERATION');
    assert.equal(safeEventLabel(ev({ displayLabel: 'MIXED / RANGE CHANGE', classification: 'MIXED' })).label, 'MIXED / RANGE CHANGE');
    assert.equal(safeEventLabel(ev({ displayLabel: 'UNVERIFIED CLAIM', verification: 'UNVERIFIED' })).dashed, true);
    assert.equal(safeEventLabel(ev({ displayLabel: undefined, classification: 'MIXED' })).label, 'MIXED / RANGE CHANGE');
    assert.equal(safeEventLabel(ev({ displayLabel: undefined, classification: undefined, verification: 'UNVERIFIED' })).label, 'UNVERIFIED CLAIM');
    assert.equal(safeEventLabel(ev({ displayLabel: undefined, classification: 'DOWNGRADE' })).label, 'GUIDANCE LOWERED');
  });
  test('audit-only events are split out and show their note', () => {
    const a = ev({ guidance_event_id: 'a', company: 'AdjCo', ticker: 'ADJ', market: 'US', displayLabel: 'REITERATION', classification: 'REITERATION', auditOnly: true, auditNote: 'Adjusted EPS only; GAAP unchanged', announcement_date: '2026-09-30', sources: [{ name: 'SEC EDGAR 8-K (items 2.02/7.01)' }] });
    const b = ev({ guidance_event_id: 'b', company: 'RaiseCo' });
    const s = splitAudit([a, b]);
    assert.deepEqual(s.main.map((e) => e.guidance_event_id), ['b']); assert.deepEqual(s.audit.map((e) => e.guidance_event_id), ['a']);
    assert.equal(safeEventLabel(a).note, 'Adjusted EPS only; GAAP unchanged');
    const out = html(React.createElement(GuAuditArea, { events: s.audit, onOpen: () => {}, now: new Date('2026-10-01T00:00:00Z') }));
    assert.match(out, /AUDIT ONLY \(1\)/); assert.match(out, /Adjusted EPS only; GAAP unchanged/); assert.match(out, /SEC filings \(8-K\)/); assert.match(out, /REITERATION/);
    assert.equal(html(React.createElement(GuAuditArea, { events: [], onOpen: () => {}, now: new Date() })), '');
  });
  test('counts strip', () => {
    assert.equal(eventCountsStrip({ upgrade: 3, reiteration: 2, mixed: 1, lowered: 0, unverifiedClaims: 4 }), 'Verified upgrades 3 · Reiterations 2 · Mixed or range change 1 · Lowered 0 · Unverified claims 4');
    assert.equal(eventCountsStrip(undefined), null);
  });
});

describe('wording rules', () => {
  test('no visible 0-100 score or BUY/SELL in the helper text', () => {
    const text = JSON.stringify([SECTIONS, verificationBadge('VERIFIED'), verificationBadge('DERIVED'), viewLabel('review')]);
    assert.ok(!/\b(buy|sell)\b/i.test(text)); assert.ok(!/\b\d{1,3}\s*\/\s*100\b/.test(text));
  });
});
