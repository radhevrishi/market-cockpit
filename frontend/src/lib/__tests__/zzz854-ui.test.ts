// zzz854 — UI pass for the new data-layer fields: security state, deal roles, information origins, one count model,
// AI verification state (Special Situations); pipeline partition, review queue, one primary-source state, AI check,
// claims view and count equations (Guidance). Pure helpers + render-string checks. Synthetic names plus the public
// example names from the brief as fixtures only. No network, no clock (dates are fixed strings).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RadarItem } from '../multibagger-radar-types';
import { RadarCard, RadarRow } from '../../components/special-situations/RadarCard';
import {
  TERMS_NOT_READ_BADGE, TICKER_NOT_ESTABLISHED, dealView, forbiddenWording, oneLineRow, originsLine, ownerLines, resultBadge, securityView, sourcesLine,
} from '../../components/special-situations/radar-tokens';
import {
  AI_UNAVAILABLE_TEXT, awaitingReasonCounts, awaitingRowLine, auditRowLine, beforeVerificationLine, countModelSummary, coverageRawRows, equationRows, headerFromModel,
  heldBackRows, otherCategories, radarReconcile, verificationLine,
} from '../../components/special-situations/ss-counts';
import { SsCountPanel } from '../../components/special-situations/SsCountPanel';
import {
  REVIEW_REASON_TEXT, REASON_SHORT, VIEW_ORDER, aiCheckOf, coverageFailureLine, displayStage, eventReconcileLines, guVerificationLists, highestActiveHeading, otherChangeLines,
  partitionView, primarySourceView, qualityStrip, reasonCountsLine, reasonsPlain, recordReconcileLines, reviewStatusCounts, stateCountsLine, taxonomyText, validationLines,
  viewCountsLine, viewLabel,
} from '../../components/guidance-upgrades/gu-ui';
import { guUniverseUrl } from '../../components/guidance-upgrades/useGuUniverse';
import { GuCard } from '../../components/guidance-upgrades/GuCard';
import { GuReviewQueue, GuVerificationBlock } from '../../components/guidance-upgrades/GuQueue';
import { GuTopBar } from '../../components/guidance-upgrades/GuTopBar';
import { CoverageCardView } from '../../components/guidance-upgrades/GuCoverage';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ');
const html = (el: React.ReactElement) => strip(renderToStaticMarkup(el));

// ─────────────────────────────── Special Situations ───────────────────────────────
function item(over: Partial<RadarItem> = {}): RadarItem {
  return {
    id: 'x1', ticker: null, company: 'Zetacorp', region: 'US', bucket: 'SPECIAL_SITUATION', kind: 'TENDER_OFFER', event: 'SC TO-T - ZETACORP (0000000001) (Subject)', whyItMatters: 'A tender offer.',
    changes: [], mechanism: '', financialImpact: '', duration: { code: null, label: '', basis: 'none', evidence: '' },
    evidence: { status: 'DEVELOPING', sourceRank: 1, sourceLabel: 'SEC filing', why: 'Form title only.', independentSources: 1 },
    link: 'NOT_ESTABLISHED', inflection: 'NOT_ASSESSED', chain: [], provenThrough: -1, bottleneckQuestion: null,
    proof: { what: '', when: null, kind: 'result' }, breakConditions: [], expectations: { state: 'NOT_ASSESSED', note: 'Not assessed' }, valuationContext: 'Not assessed',
    technical: { note: null }, governance: { status: 'NOT_CHECKED', flags: [], note: '' }, drivers: [], priority: 'MEDIUM', priorityReason: 'Read the filing.', lowSignal: false,
    sourceUrl: null, publishedAt: null, feedEventId: null, ...over,
  } as RadarItem;
}
const card = (it: RadarItem, hints?: any) => html(React.createElement(RadarCard as any, { item: it, held: false, ledgerIds: new Set<string>(), onSaveLedger: () => {}, now: '2026-10-01T00:00:00Z', hints }));

describe('security state replaces "No ticker"', () => {
  test('unresolved, unlisted subsidiary, resolved, label-only and nothing-known', () => {
    assert.deepEqual(securityView(null, { security: { state: 'UNRESOLVED', label: 'Unresolved - CIK not in ticker map', reason: 'CIK not in ticker map', ticker: null, exchange: null } }),
      { head: 'Ticker unresolved', line: 'Ticker unresolved — CIK not in ticker map', resolved: false });
    assert.equal(securityView(null, { security: { state: 'UNLISTED_SUBSIDIARY', label: 'x', reason: 'subsidiary', ticker: null, exchange: null, listedParent: { name: 'Vedanta', ticker: 'VEDL' } } }).line,
      'Unlisted subsidiary — listed parent: Vedanta (VEDL)');
    assert.equal(securityView(null, { securityState: 'UNRESOLVED', securityLabel: 'Unresolved - CIK not in ticker map' }).line, 'Ticker unresolved — CIK not in ticker map');
    const r = securityView('RGR', { security: { state: 'RESOLVED', label: 'Ticker: RGR (NYSE)', reason: 'catalog', ticker: 'RGR', exchange: 'NYSE' } });
    assert.equal(r.head, 'RGR'); assert.equal(r.resolved, true); assert.equal(r.line, 'RGR (NYSE)');
    assert.equal(securityView(null, null).head, TICKER_NOT_ESTABLISHED);
    assert.equal(securityView(null, { tickerLabel: 'Unlisted / private' }).head, 'Unlisted / private');
    for (const st of ['RESOLVED', 'RESOLVED_MULTIPLE', 'UNLISTED', 'UNLISTED_SUBSIDIARY', 'NON_EQUITY_ENTITY', 'NOT_APPLICABLE', 'UNRESOLVED'] as const) {
      assert.notEqual(securityView(null, { securityState: st }).head, 'No ticker');
      assert.notEqual(securityView(null, { securityState: st }).head.trim(), '');
    }
  });
  test('one-line rows never print the bare "No ticker"', () => {
    assert.ok(!/No ticker/.test(oneLineRow(item()).text));
    assert.match(oneLineRow(item(), { securityState: 'NON_EQUITY_ENTITY' }).who, /^Not a listed equity - Zetacorp/);
    assert.ok(!/No ticker/.test(html(React.createElement(RadarRow as any, { item: item({ bucket: 'NOISE' }) }))));
  });
});

describe('deal roles, subtype, form and terms-not-read badge', () => {
  test('dealView', () => {
    const d = dealView({ dealSubtype: 'THIRD_PARTY_TENDER', filingForm: 'SC TO-T', termsRead: false }, { dealRoles: { subject: 'T', filer: 'A', acquirer: 'Acme Holding', target: 'Target Co', financialOwner: 'Target Co shareholders', roleLine: 'Acquirer: Acme Holding -> Target: Target Co', notes: [] } });
    assert.equal(d.roleLine, 'Acquirer: Acme Holding → Target: Target Co');
    assert.equal(d.subtype, 'Third-party tender offer');
    assert.equal(d.form, 'SC TO-T');
    assert.equal(d.termsBadge, TERMS_NOT_READ_BADGE);
    assert.equal(dealView({ dealSubtype: 'GOING_PRIVATE' }, { eventSubtypeLabel: 'Going-private (SC 13E-3)' }).subtype, 'Going-private (SC 13E-3)');
    assert.equal(dealView({ termsRead: true }).termsBadge, null);
    assert.deepEqual(dealView({}), { roleLine: null, subtype: null, form: null, termsBadge: null });
  });
  test('card shows the security line, the role line, the terms badge and no bare ticker placeholder', () => {
    const t = card(item({ dealSubtype: 'THIRD_PARTY_TENDER', filingForm: 'SC TO-T', termsRead: false }), {
      security: { state: 'UNRESOLVED', label: 'Unresolved - CIK not in ticker map', reason: 'CIK not in ticker map', ticker: null, exchange: null },
      dealRoles: { subject: null, filer: null, acquirer: 'Acme Holding', target: 'Zetacorp', financialOwner: null, roleLine: 'Acquirer: Acme Holding -> Target: Zetacorp', notes: [] },
      sourceOrigins: { sourceCount: 4, independentOrigins: 1, syndicatedCopies: 0, amendmentCopies: 2, partyListings: 1, origins: [], line: '4 items - 1 independent origin (2 amendments, 1 party listing)' },
    });
    assert.match(t, /Ticker unresolved — CIK not in ticker map/);
    assert.match(t, /Acquirer: Acme Holding → Target: Zetacorp/);
    assert.match(t, /Filing exists — terms not read/);
    assert.match(t, /Form SC TO-T/);
    assert.match(t, /4 items · 1 independent origin/);
    assert.ok(!/No ticker/.test(t));
    assert.deepEqual(forbiddenWording(t).filter((x) => x !== 'bad literal'), []);
  });
});

describe('sources by information origin, numbers by owner, result label, context facts', () => {
  test('originsLine', () => {
    assert.equal(originsLine({ independentSources: 4, sourceCount: 5 }, { sourceCount: 5, independentOrigins: 1, syndicatedCopies: 4, amendmentCopies: 0, partyListings: 0, origins: [], line: '5 items - 1 independent origin (4 syndicated copies)' }),
      '5 items · 1 independent origin (4 syndicated copies)');
    assert.equal(originsLine({ independentSources: 1, independentOrigins: 1, sourceCount: 5 }), '5 items · 1 independent origin (4 copies of an origin already counted)');
    assert.equal(originsLine({ independentSources: 2, sourceCount: 5, duplicatesRemoved: 3 }), sourcesLine({ independentSources: 2, sourceCount: 5, duplicatesRemoved: 3 }));
  });
  test('ownerLines prefers metricOwnerLines, then ownerLabel, then numberLines', () => {
    assert.deepEqual(ownerLines({ metricOwnerLines: ["Target (Yoga Bar) revenue ₹452 cr — not ITC's revenue"], numberLines: ['old'] }), ["Target (Yoga Bar) revenue ₹452 cr — not ITC's revenue"]);
    assert.deepEqual(ownerLines({ ownedNumbers: [{ value: 900, raw: '₹900 cr', metric: 'DEAL_VALUE' as any, entity: 'transaction', entityRole: 'transaction' as any, sentence: 's', countsAsParentEarnings: false, ownerLabel: 'Transaction value ₹900 cr', nature: 'deal_consideration' }] }), ['Transaction value ₹900 cr (deal value)']);
    assert.deepEqual(ownerLines({ numberLines: ['Yoga Bar revenue: Rs 452 cr'] }), ['Yoga Bar revenue: Rs 452 cr']);
    assert.deepEqual(ownerLines({}), []);
  });
  test('result label: unverified said plainly; card shows owner line and context facts as context only', () => {
    assert.deepEqual(resultBadge({ resultLabel: 'Earnings result (unverified)', resultVerified: false }), { label: 'Earnings result (unverified)', verified: false });
    assert.equal(resultBadge({}), null);
    const t = card(item({ kind: 'EARNINGS_RESULT' as any, resultLabel: 'Earnings result (unverified)', resultVerified: false, ticker: 'ABCD',
      metricOwnerLines: ["Target (Yoga Bar) revenue ₹452 cr — not ITC's revenue"], contextFacts: ['Shares hit an all-time high'] }));
    assert.match(t, /Earnings result \(unverified\)/);
    assert.match(t, /Target \(Yoga Bar\) revenue ₹452 cr — not ITC's revenue/);
    assert.match(t, /Price response \(not evidence\)/);
    assert.match(t, /Context only: Shares hit an all-time high/);
  });
});

const model = (o: any = {}): any => ({
  raw_items: 1200, canonical_events: 727, merged_duplicates: 14, shown: 412, held_back: { total: 301, by_reason: { AWAITING_VERIFICATION: 167, FUND_REPURCHASE_OFFER: 134 } },
  shown_by_tier: { TIER_1: 10, TIER_2: 150, WATCHLIST: 200, NOISE: 52 }, shown_by_category: { MA: 300, SPIN: 40, TURN: 50, CAP: 20, UNCATEGORISED: 2 }, shown_by_coverage: { 'M&A': 412 },
  radar_sections: null, radar_excluded: null, coverage_raw: { label: 'RAW (pre-filter)', buckets: { 'M&A': 854 } }, coverage_shown_vs_raw: [{ bucket: 'M&A', shown: 300, raw: 854 }, { bucket: 'Spin-offs', shown: 40, raw: 41 }],
  equations: [{ id: 'E1', text: 'canonical events 727 = shown 412 + held back 301 + merged duplicates 14', holds: true }, { id: 'E3', text: 'category chips 412 = shown 412', holds: true }],
  reconciles: true, mismatches: [], ...o,
});

describe('one count model for the page', () => {
  test('summary line, equations, header numbers', () => {
    assert.equal(countModelSummary(model()), '1200 raw feed items → 727 distinct events = 412 shown + 301 held back + 14 merged duplicates');
    assert.equal(countModelSummary(model({ raw_items: null })), '727 distinct events = 412 shown + 301 held back + 14 merged duplicates');
    assert.equal(countModelSummary(null), null); assert.equal(countModelSummary({} as any), null);
    assert.equal(equationRows(model()).length, 2);
    assert.deepEqual(headerFromModel(model(), 'ALL')!.tiers, { TIER_1: 10, TIER_2: 150, WATCHLIST: 200 });
    assert.equal(headerFromModel(model(), 'ALL')!.categories.MA, 300);
    assert.equal(headerFromModel(model(), 'IN'), null, 'a region filter counts the region, never the all-region model');
    assert.equal(headerFromModel(undefined, 'ALL'), null);
    assert.equal(otherCategories(model(), ['SPIN', 'MA', 'TURN', 'CAP', 'CAPEX', 'CONCALL']), 'Not in a category box: uncategorised 2.');
    assert.equal(otherCategories(model({ shown_by_category: { MA: 1 } }), ['MA']), null);
  });
  test('held back by reason: route list first, else the model counts with plain labels', () => {
    const rows = heldBackRows({ reasons: [{ reason: 'FUND_REPURCHASE_OFFER', label: 'Fund repurchase offer', count: 134, examples: ['Example Credit Fund'] }, { reason: 'AWAITING_VERIFICATION', label: 'Awaiting', count: 167, examples: [] }] });
    assert.deepEqual(rows.map((r) => r.count), [167, 134]);
    const fromModel = heldBackRows(null, model());
    assert.equal(fromModel[0].reason, 'AWAITING_VERIFICATION');
    assert.match(fromModel[0].label, /Awaiting verification/);
    assert.deepEqual(heldBackRows(null, null), []);
  });
  test('verification line is never silent: unavailable says items stay hidden', () => {
    assert.equal(verificationLine(null), null);
    const u = verificationLine({ available: false, unavailableReason: 'No API key configured.' })!;
    assert.equal(u.available, false); assert.ok(u.text.startsWith(AI_UNAVAILABLE_TEXT)); assert.match(u.text, /No API key configured/);
    const a = verificationLine({ available: true, provider: 'openai', model: 'm1', checked: 10, confirmed: 7, contradicted: 1, awaiting: 30, primaryVerified: 50, lastRunAt: '2026-10-01T06:05:00Z', mode: 'enforce' })!;
    assert.match(a.text, /50 confirmed by the filing itself · 10 checked · 7 confirmed · 1 contradicted · 30 awaiting · last run 2026-10-01 06:05 UTC/);
    assert.match(verificationLine({ available: true, lastRunAt: null })!.text, /not run yet/);
    assert.equal(beforeVerificationLine({ TIER_1: 16, TIER_2: 281, WATCHLIST: 245 }), 'Before the AI check (raw tiers): Tier 1 16 · Tier 2 281 · Watchlist 245');
    assert.equal(beforeVerificationLine(null), null);
  });
  test('awaiting / audit rows, reason counts, coverage raw, radar check', () => {
    assert.equal(awaitingRowLine({ company: 'Zetacorp', ticker: 'ZETA', claimText: 'Zetacorp tender offer', reason: 'no_primary' }), 'Zetacorp (ZETA) — Zetacorp tender offer — No company document to read');
    assert.equal(awaitingRowLine({ company: 'Zetacorp', claimText: 'x', reason: 'queued', reasonText: 'Queued for the next run' }), 'Zetacorp — x — Queued for the next run');
    assert.match(auditRowLine({ company: 'Zetacorp', claimText: 'x', reason: 'figures differ' }), /removed: figures differ$/);
    assert.deepEqual(awaitingReasonCounts([{ reason: 'queued' }, { reason: 'no_primary' }, { reason: 'no_primary' }]).map((r) => r.count), [2, 1]);
    assert.deepEqual(awaitingReasonCounts([], { unreadable: 3 }).map((r) => r.label), ['Document could not be read']);
    assert.deepEqual(coverageRawRows(model()).map((r) => r.bucket), ['M&A', 'Spin-offs']);
    assert.deepEqual(radarReconcile({ A: 400, B: 12 }, 412), { text: 'Radar sections 412 = shown events 412', holds: true });
    assert.equal(radarReconcile({ A: 400 }, 412)!.holds, false);
    assert.deepEqual(radarReconcile({ A: 400 }, 412, 12), { text: 'Radar sections 400 + 12 merged into another card for the same deal = shown events 412', holds: true });
    assert.equal(radarReconcile({ A: 1 }, undefined), null);
  });
  test('panel renders the add-up line, the alarm on a failed equation, the AI state and the awaiting list', () => {
    const t = html(React.createElement(SsCountPanel, { feed: {
      count_model: model({ equations: [{ id: 'E2', text: 'tiers 400 = shown 412', holds: false }] }),
      verification: { available: false, unavailableReason: 'Monthly cap reached.', awaiting: 2 },
      awaitingVerification: [{ company: 'Zetacorp', claimText: 'Zetacorp tender', reason: 'verification_unavailable', claimId: 'c1' }],
      awaitingVerificationCount: 2, by_tier_before_verification: { TIER_1: 16, TIER_2: 281, WATCHLIST: 245 },
    }, knownCategories: ['MA', 'SPIN', 'TURN', 'CAP'] }));
    assert.match(t, /How these numbers add up: 1200 raw feed items → 727 distinct events = 412 shown/);
    assert.match(t, /Counts do not add up: E2 tiers 400 = shown 412/);
    assert.match(t, /AI check unavailable — items stay hidden until checked\. Monthly cap reached\./);
    assert.match(t, /Awaiting verification \(2\)/);
    assert.match(t, /Zetacorp — Zetacorp tender — AI check unavailable/);
    assert.match(t, /Held back \(301\)/);
    assert.match(t, /Before the AI check \(raw tiers\)/);
    assert.match(t, /RAW, pre-filter/);
    assert.equal(renderToStaticMarkup(React.createElement(SsCountPanel, { feed: {} })), '');
  });
});

// ─────────────────────────────── Guidance ───────────────────────────────
describe('universe: new review codes, claims view, equations', () => {
  test('plain English for the new review codes', () => {
    for (const c of ['AWAITING_VERIFICATION', 'EVENT_CONFLICT', 'NEWER_PERIOD_GUIDANCE', 'STALE_VERIFICATION', 'INVARIANT_FAILED']) {
      assert.ok(REVIEW_REASON_TEXT[c] && !/_/.test(REVIEW_REASON_TEXT[c]), c); assert.ok(REASON_SHORT[c], c);
    }
    assert.deepEqual(reasonsPlain({ reviewReasonCodes: ['EVENT_CONFLICT'] }), [REVIEW_REASON_TEXT.EVENT_CONFLICT]);
    assert.equal(reasonCountsLine({ AWAITING_VERIFICATION: 3, INVARIANT_FAILED: 1 }), 'Awaiting verification 3 · Data check failed 1');
  });
  test('state line uses the Active equation; older answers keep the older line', () => {
    const eq = { active: { value: 45, holds: true, text: 'Active 45 = 30 verified + 10 derived + 5 partial (company document read, growth % not stated by the company)' } };
    assert.equal(stateCountsLine({ activeRecords: 45, verified: 30, partial: 5, derived: 10, unverified: 0, periodUnclear: 0 }, eq), eq.active.text);
    assert.match(stateCountsLine(null, { active: { value: 1, holds: false, text: 'Active 1 = 0 verified' } })!, /data check failed/);
    assert.equal(stateCountsLine({ activeRecords: 10, verified: 4, partial: 2, derived: 1, unverified: 2, periodUnclear: 1 }), '4 verified · 2 partial · 4 unverified/derived');
    assert.equal(qualityStrip({ summary: {}, countEquations: eq } as any).stateLine, eq.active.text);
  });
  test('Highest active heading explains Active N vs Highest M', () => {
    const h = highestActiveHeading({ active: { value: 45, holds: true, text: '' }, highestActive: { value: 29, companies: 27, threshold: 30, holds: true, text: 'Highest active guidance 29 = Active rows ...' } }, 29, 30);
    assert.equal(h.title, 'HIGHEST ACTIVE GUIDANCE (29)');
    assert.match(h.note!, /^30% or more guided growth \(Revenue, PAT or EBITDA\) · 27 companies out of 45 active\./);
    assert.equal(highestActiveHeading(null, 12, 30).title, 'HIGHEST ACTIVE GUIDANCE (12)');
  });
  test('claims view: order, label, counts line and request url', () => {
    assert.deepEqual(VIEW_ORDER, ['active', 'review', 'claims', 'history']);
    assert.equal(viewLabel('claims', { default: 1, review: 2, claimsAwaiting: 7, expired: 0, superseded: 0, withdrawn: 0, excluded: 0 }), 'Claims awaiting verification (7)');
    assert.equal(viewLabel('claims'), 'Claims awaiting verification');
    assert.match(viewCountsLine({ default: 40, review: 9, claimsAwaiting: 7, expired: 0, superseded: 0, withdrawn: 0, excluded: 0 })!, /^40 active · 9 need review · 7 awaiting verification · /);
    assert.ok(!/awaiting/.test(viewCountsLine({ default: 40, review: 9, expired: 0, superseded: 0, withdrawn: 0, excluded: 0 })!));
    assert.match(guUniverseUrl({ view: 'claims' }), /view=claims/);
  });
  test('event reconciliation lines: newer filing wins, unverified latest event does not', () => {
    const o = eventReconcileLines({ eventOverride: { code: 'EVENT_CONFLICT', eventStatus: 'REITERATED', eventDate: '2026-08-14', eventPeriod: 'FY27', eventLabel: 'GUIDANCE REITERATED', eventDisplay: null, previousRevision: 'RAISED', text: 'Latest filing (2026-08-14) says GUIDANCE REITERATED; this record said RAISED.', sourceName: null, sourceUrl: null } });
    assert.deepEqual(o, [{ text: 'Latest filing (2026-08-14) says GUIDANCE REITERATED; this record said RAISED.', tone: 'red' }]);
    const l = eventReconcileLines({ latestEvent: { market: 'US', ticker: 'AAAA', company: 'A', metric: 'REVENUE' as any, period: 'FY27', date: '2026-09-01', status: 'RAISED', verified: false, label: 'UNVERIFIED CLAIM', display: '137 → 141', sourceName: null, sourceUrl: null, eventId: null } });
    assert.equal(l[0].tone, 'amber'); assert.match(l[0].text, /not verified, does not change this record/);
    assert.deepEqual(recordReconcileLines({ points: [{ awaitingVerificationReason: null }, { awaitingVerificationReason: 'Media only' }] } as any), [{ text: 'Awaiting verification: Media only', tone: 'amber' }]);
    assert.deepEqual(eventReconcileLines(null), []);
  });
});

const pt = (o: any = {}) => ({ metric: 'REVENUE', period: 'FY27', low: 100, high: 110, midpoint: 105, isGrowthRate: false, currency: '$', unit: 'M', ...o });
const ev = (o: any = {}): any => ({
  guidance_event_id: 'g1', canonical_key: 'k', ticker: 'AAAA', company: 'Alpha Test', market: 'US', announcement_date: '2026-09-30', verification: 'VERIFIED', primaryAvailable: true,
  sources: [{ name: 'SEC filings', tier: 'PRIMARY', type: 'SEC filing', date: '2026-09-30', url: 'https://example.com/doc' }],
  changes: [{ metric: 'REVENUE', before: pt({ low: 90, high: 100, midpoint: 95 }), after: pt(), absoluteChange: 10, percentageChange: 10.5, percentagePointChange: null, direction: 'UP' }],
  type: 'RAISE', guidance_quality: 'MEDIUM', guidance_driver: '', driverEvidence: 'STATED', history: [], historyStats: null, consensus: { value: null, label: 'UNAVAILABLE' }, expectationGap: 'UNKNOWN', gapPct: null,
  revenueImpact: { value: null, label: 'UNAVAILABLE' }, ebitdaImpact: { value: null, label: 'UNAVAILABLE' }, epsImpact: { value: null, label: 'UNAVAILABLE' }, fcfImpact: { value: null, label: 'UNAVAILABLE' },
  valuation: null, duration: 'MULTI_YEAR', thesis: null, materiality: 'HIGH', materialityBasis: '', evidence: 'STATED', links: {}, risks: [], evidenceGaps: [], nextEvidence: [], whyNow: '', whatItMeans: '', marketMissing: '',
  chain: {}, decision: 'WATCHLIST', decisionReason: [], flags: [], displayLabel: 'GUIDANCE UPGRADE', classification: 'RAISE', isUpgrade: true, rankKey: 0, created_at: '', updated_at: '', ...o,
});

describe('events: one primary-source state, taxonomy, validation, other changes, AI check', () => {
  test('primarySourceState wins: never "read" next to "awaiting"', () => {
    assert.deepEqual(primarySourceView({ primaryState: 'PRIMARY_SOURCE_READ' as any, primaryStateText: 'PRIMARY SOURCE READ', primarySourceUrl: null, primarySourceDate: null, primarySourceState: 'not_found' }),
      { text: 'Primary source: not found yet', tone: 'amber' });
    assert.deepEqual(primarySourceView({ primaryState: undefined as any, primaryStateText: undefined, primarySourceUrl: null, primarySourceDate: '2026-09-30', primarySourceState: 'read_numbers_found' }),
      { text: 'Primary source read — old and new figures found (2026-09-30)', tone: 'green' });
    assert.equal(primarySourceView({ primaryState: undefined as any, primaryStateText: undefined, primarySourceUrl: null, primarySourceDate: null }), null);
    assert.equal(displayStage({ primaryAvailable: true, verification: 'VERIFIED', v2: { stage: 'DECISION' } as any, primarySourceState: 'found_not_read' }), 'PRIMARY_SOURCE_FOUND');
    assert.equal(displayStage({ primaryAvailable: true, verification: 'VERIFIED', v2: { stage: 'DECISION' } as any, primarySourceState: 'read_numbers_found' }), 'DECISION');
  });
  test('taxonomy, validation and other changes in plain words', () => {
    assert.equal(taxonomyText({ taxonomy: 'first_guidance' } as any), 'First guidance (not a raise)');
    assert.equal(taxonomyText({} as any), null);
    assert.deepEqual(validationLines({ validationIssues: [{ code: 'ACTUAL_VS_GUIDANCE', severity: 'INVALID', metric: 'REVENUE', period: 'FY26', text: 'quarterly actual compared with an annual guide' }] } as any),
      [{ text: 'Invalid: quarterly actual compared with an annual guide', severity: 'INVALID' }]);
    const oc = otherChangeLines({ otherChanges: [{ metric: 'EPS', before: pt({ metric: 'EPS', low: 1.2, high: 1.2, midpoint: 1.2, basis: 'GAAP', unit: '' }), after: pt({ metric: 'EPS', low: 1.1, high: 1.1, midpoint: 1.1, basis: 'GAAP', unit: '' }), absoluteChange: -0.1, percentageChange: -8.3, percentagePointChange: null, direction: 'DOWN' }] } as any);
    assert.equal(oc.length, 1); assert.match(oc[0], /\(GAAP\): .* → .*lowered$/);
  });
  test('AI check badge text', () => {
    const c = aiCheckOf({ aiVerification: { status: 'AI_CONFIRMED', quote: 'We now expect revenue of $100 to $110 million', newValues: [100, 110], oldValues: [90, 100], period: 'FY27', basis: 'ADJUSTED', documentUrl: 'https://example.com/8k' } })!;
    assert.equal(c.label, '✓ AI-checked against filing'); assert.equal(c.tone, 'green'); assert.match(c.detail!, /new 100 to 110, old 90 to 100, period FY27, basis adjusted/);
    assert.equal(aiCheckOf({ aiVerification: { status: 'AWAITING', reasonText: 'No company document to read' } })!.detail, 'No company document to read');
    assert.equal(aiCheckOf({ aiVerification: { status: 'AI_CONTRADICTED', reasonText: 'figures differ' } })!.tone, 'red');
    assert.equal(aiCheckOf({}), null); assert.equal(aiCheckOf(null), null);
  });
  test('card: basis note under the headline, AI quote, taxonomy, and the contradiction is gone', () => {
    const t = html(React.createElement(GuCard, { e: ev({
      primaryState: 'PRIMARY_SOURCE_READ', primaryStateText: 'PRIMARY SOURCE READ', primarySourceState: 'read_numbers_not_found', taxonomy: 'formal_upgrade',
      headlineBasis: 'ADJUSTED', basisNote: 'GAAP EPS moved +83.7%; the adjusted figure (+3.3%) is used for the headline.',
      aiVerification: { status: 'AI_CONFIRMED', quote: 'We now expect revenue of $100 to $110 million', newValues: [100, 110], documentUrl: 'https://example.com/8k' },
      validationIssues: [{ code: 'PERIOD_UNSTATED', severity: 'REVIEW', metric: 'REVENUE', period: null, text: 'the period is not stated' }],
    }), onOpen: () => {}, now: new Date('2026-10-01T00:00:00Z') }));
    assert.match(t, /Headline uses adjusted figures\. GAAP EPS moved \+83\.7%/);
    assert.match(t, /✓ AI-checked against filing/);
    assert.match(t, /“We now expect revenue of \$100 to \$110 million”/);
    assert.match(t, /Formal upgrade/);
    assert.match(t, /Check: the period is not stated/);
    assert.equal((t.match(/Primary source read — old and new figures not found in it/g) || []).length, 1, 'said once, by the stage strip');
    assert.ok(!/PRIMARY SOURCE READ/.test(t), 'the older contradictory label is not printed when the one state exists');
    assert.ok(!/PRIMARY SOURCE AVAILABLE\? YES/.test(t));
  });
});

const pipe = (o: any = {}): any => ({
  processed: 20, verifiedUpgrades: 3, reiterations: 2, mixed: 1, lowered: 0, firstGuidance: 1, invalidOrStale: 2, capitalRaise: 1, awaitingNumbers: 4, unverified: 5, nonGuidance: 1,
  stale: 1, needsReview: 1, awaitingPrimary: 2, material: 2, expectationPositive: 0, cards: 3, audit: 3, queue: 13, dropped: 1, ...o,
});

describe('events: header partition, review queue, verification lists, coverage', () => {
  test('partitionView adds up; older payloads return null', () => {
    const p = partitionView(pipe(), { IN: pipe({ processed: 5, verifiedUpgrades: 1 }), US: pipe({ processed: 15, verifiedUpgrades: 2 }) })!;
    assert.match(p.line, /= 20 processed$/);
    assert.equal(p.listsHold, true);
    assert.match(p.listsLine, /^Shown as cards 3 \+ audit list 3 \+ review queue 13 \+ not guidance 1 .* = 20 of 20 processed$/);
    assert.equal(p.boxes.find((b) => b.label === 'Review queue')!.n, 14);
    assert.equal(p.byMarket, 'India 5 processed, 1 verified upgrades | USA 15 processed, 2 verified upgrades');
    assert.equal(partitionView(pipe({ queue: 10 }))!.listsHold, false);
    assert.equal(partitionView(undefined), null);
  });
  test('top bar shows the partition, not the old Detected / Verified pair', () => {
    const summary: any = { window: '7D', asOf: '', detected: 602, verified: 601, material: 140, expectationPositive: 3, inBook: 0, pipeline: pipe() };
    const t = html(React.createElement(GuTopBar, { summary, window: '7D', onWindow: () => {}, scope: 'ALL', onScope: () => {}, metric: 'ALL', onMetric: () => {}, inBookCount: 0, bookLoaded: true }));
    assert.match(t, /How these numbers add up: Verified upgrades 3 · Reiterations 2/);
    assert.ok(!/Detected/.test(t)); assert.ok(!/\b602\b/.test(t));
    const old = html(React.createElement(GuTopBar, { summary: { ...summary, pipeline: undefined }, window: '7D', onWindow: () => {}, scope: 'ALL', onScope: () => {}, metric: 'ALL', onMetric: () => {}, inBookCount: 0, bookLoaded: true }));
    assert.match(old, /Detected/);
  });
  test('review queue: grouped counts and one line per item (collapsed)', () => {
    const items: any[] = [
      { id: 'q1', ticker: 'FLGT', company: 'Fulgent', market: 'US', announcement_date: '2026-09-30', status: 'needs_review', reason: 'Needs review: implausible change', taxonomy: 'formal_upgrade', primarySourceState: 'read_numbers_found', primarySourceUrl: null, figures: ['revenue FY26: new 330–340'], sources: [] },
      { id: 'q2', ticker: 'AAAA', company: 'Alpha', market: 'US', announcement_date: '2026-09-29', status: 'awaiting_numbers', reason: 'old and new numbers not read', taxonomy: 'first_guidance', primarySourceState: 'found_not_read', primarySourceUrl: 'https://example.com', figures: [], sources: [], aiVerification: { status: 'AWAITING', reasonText: 'Not checked yet' } },
      { id: 'q3', ticker: 'BBBB', company: 'Beta', market: 'US', announcement_date: '2026-09-29', status: 'awaiting_numbers', reason: 'r', taxonomy: 'first_guidance', primarySourceState: 'not_found', primarySourceUrl: null, figures: [], sources: [], aiVerification: { status: 'AI_CONTRADICTED', reasonText: 'figures differ' } },
    ];
    assert.deepEqual(reviewStatusCounts(items).map((x) => `${x.label} ${x.n}`), ['Awaiting numbers 2', 'Needs review 1']);
    const h = renderToStaticMarkup(React.createElement(GuReviewQueue, { items, count: 3 }));
    assert.match(h, /^<details/); assert.ok(!/<details open/.test(h));
    const t = strip(h);
    assert.match(t, /REVIEW QUEUE \(3\)/);
    assert.match(t, /NEEDS REVIEW · Fulgent \(FLGT\) 2026-09-30 — Needs review: implausible change/);
    assert.match(t, /First guidance \(not a raise\) · Primary source found, not read yet/);
    const l = guVerificationLists({ reviewQueue: items });
    assert.deepEqual([l.awaiting.length, l.audit.length], [1, 1]);
    assert.deepEqual(guVerificationLists({ reviewQueue: items, awaitingVerification: [], verificationAudit: [] }), { awaiting: [], audit: [] });
    assert.equal(renderToStaticMarkup(React.createElement(GuReviewQueue, { items: [], count: 0 })), '');
  });
  test('verification block: unavailable is said plainly; awaiting and removed lists', () => {
    const items: any[] = [{ id: 'q2', ticker: 'AAAA', company: 'Alpha', market: 'US', announcement_date: '2026-09-29', status: 'awaiting_numbers', reason: 'old and new numbers not read', taxonomy: 'first_guidance', primarySourceState: 'found_not_read', primarySourceUrl: null, figures: [], sources: [], aiVerification: { status: 'AWAITING', reasonText: 'AI check unavailable' } }];
    const t = html(React.createElement(GuVerificationBlock, { data: { verification: { available: false, unavailableReason: 'No API key configured.' }, awaitingVerificationCount: 1, reviewQueue: items } }));
    assert.match(t, /AI check unavailable — items stay hidden until checked\. No API key configured\./);
    assert.match(t, /AWAITING VERIFICATION \(1\)/);
    assert.match(t, /Alpha \(AAAA\) 2026-09-29 — old and new numbers not read — AI check unavailable/);
    assert.equal(renderToStaticMarkup(React.createElement(GuVerificationBlock, { data: {} })), '');
  });
  test('coverage: blocked feed with retry time, empty response treated as failed', () => {
    assert.equal(coverageFailureLine({ name: 'NSE announcements', reason: 'query failed (HTTP 403)', failureKind: 'BLOCKED', retryAfter: '2026-10-01T22:40:00Z' }), 'NSE blocked (HTTP 403) — retrying after 22:40 UTC');
    assert.equal(coverageFailureLine({ name: 'BSE announcements', failureKind: 'EMPTY_RESPONSE' }), 'BSE answered with no announcements — treated as a failed read, not as zero events');
    assert.equal(coverageFailureLine({ name: 'NSE', failureKind: 'BLOCKED' }), 'NSE blocked — retry time not known');
    assert.equal(coverageFailureLine({ name: 'NSE', failureKind: null }), null);
    const c: any = { market: 'IN', requestedWindow: '7D', windowDays: 7, calendarDays: 7, tradingDays: 5, daysAttempted: 5, daysSuccessfullyRead: 0, daysPartialCoverage: 0, daysPrimaryPartial: 0, daysFallbackOnly: 0,
      daysFailed: 5, daysNotAttempted: 0, daysFromEarlierRuns: 0, coveredLabel: '0 of 5 trading days read from primary exchange feeds', partialLabel: null, overall: 'FAILED', overallReason: 'NSE FAILED', headline: 'India: scan FAILED',
      sources: [{ name: 'NSE announcements', tier: 'PRIMARY', queryStatus: 'FAILED', dataStatus: 'UNKNOWN', status: 'FAILED', recordsRead: 0, reason: 'query failed (HTTP 403)', daysAttempted: 5, daysSucceeded: 0, failureKind: 'BLOCKED', retryAfter: '2026-10-01T22:40:00Z' }],
      cache: [], fallbackNote: null, documentsAwaitingGrading: 0, documentsUnavailable: 0, candidatesDiscovered: 0, processed: 0, verified: 0, retryAfter: '2026-10-01T22:40:00Z' };
    const t = html(React.createElement(CoverageCardView, { c }));
    assert.match(t, /NSE blocked \(HTTP 403\) — retrying after 22:40 UTC/);
    assert.match(t, /Next try of the blocked exchange feed after 22:40 UTC/);
  });
});

describe('radar tab: same count model, hints reach the card', () => {
  test('sections reconcile with the feed count model; SEC form-title cards show the security state, never "No ticker"', async () => {
    const { default: MultibaggerRadar } = await import('../../components/special-situations/MultibaggerRadar');
    const { feedCountModelFromEvents } = await import('../multibagger-radar-adapter');
    const pf = (title: string, i: number, source = 'SEC EDGAR', region: 'US' | 'IN' = 'US') => ({ title, source, link: `https://example.test/${i}`, pub_date: '2026-09-30T00:00:00Z', region });
    const events: any[] = [
      { event_id: 'e1', event_type: 'TENDER_OFFER', region: 'US', tier: 'TIER_2', category: 'MA', primary_source: true, primary_filing: pf('SC TO-T - ZETAWIDGET CORP (0009990001) (Subject)', 1), filings: [pf('SC TO-T - ZETAWIDGET CORP (0009990001) (Subject)', 1)] },
      { event_id: 'e2', event_type: 'OTHER', region: 'IN', tier: 'WATCHLIST', category: 'TURN', primary_filing: pf('Omegaplast Ltd profit jumps 35% in Q2', 2, 'ET Industry', 'IN'), filings: [pf('Omegaplast Ltd profit jumps 35% in Q2', 2, 'ET Industry', 'IN')] },
      { event_id: 'e3', event_type: 'TENDER_OFFER', region: 'US', tier: 'TIER_2', category: 'MA', primary_source: true, primary_filing: pf('SC TO-I - Zephyr Private Credit Fund (0009990003) (Subject)', 3), filings: [pf('SC TO-I - Zephyr Private Credit Fund (0009990003) (Subject)', 3)] },
    ];
    const cm = feedCountModelFromEvents(events);
    const t = html(React.createElement(MultibaggerRadar, { events, holdings: [], countModel: cm }));
    assert.match(t, /✓ Radar sections \d+( \+ \d+ merged into another card for the same deal)? = shown events \d+ \(the same count model/);
    assert.ok(!/No ticker/.test(t));
    assert.ok(!/✕ Radar sections/.test(t));
    const off = html(React.createElement(MultibaggerRadar, { events, holdings: [] }));
    assert.ok(!/Radar sections/.test(off), 'no count model (older payload): no check line, no false alarm');
  });
});
