// zzz854 — Guidance UNIVERSE: cross-tab consistency with the events layer, verification gating, count equations, enforced invariants,
// data-feed fallbacks (news last-good, concall feed fallback), coverage failure states, queue throughput, scan-note wording.
// Synthetic tickers only (ZZ...). No network: every KV / fetch is injected.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildUniverse, summarize, type GuSeedRow, type GuUniverseBuild } from '../guidance-universe';
import { checkUniverseInvariants, checkUniverseCountEquations, activePointViolations } from '../guidance-invariants';
import { classifySourceTier, STALE_DEMOTE_DAYS } from '../guidance-config';
import { getUniverseBundle, buildUniverseResponse, parseView } from '../guidance-universe-service';
import { eventStatusesOf, eventVerdictOf, mergeEventStatuses } from '../guidance-upgrades-reconcile';
import { computeCounts, computeCountsX, countsDetail, checkEventInvariants, enforceEventInvariants, eventBucketOf, GUIDANCE_BUCKETS } from '../guidance-upgrades-counts';
import { buildCoverageCard, checkCoverageCard, EXCHANGE_COOLDOWN_MIN } from '../guidance-upgrades-coverage';
import { selectDue, enqueue, emptyQueue, drainEstimate, MAX_DOCS_PER_RUN, DOC_BUDGET_MS, QUEUE_CONCURRENCY, reportQueue } from '../guidance-upgrades-queue';
import { readConcallFeedWithFallback, CONCALL_FEED_LASTGOOD_KEY, CONCALL_FEED_LASTGOOD_TTL_S, _resetConcallLastGoodThrottle, type FeedIo } from '../concall-feed';
import { refreshNewsLastGood, readNewsWithLastGood, NEWS_SHARED_LASTGOOD_KEY, NEWS_SHARED_LASTGOOD_TTL_S, NEWS_KEY, _resetNewsCacheThrottle, type NewsIo } from '../guidance-upgrades-cache';
import { scanNoteText, stripScanPrefix } from '../growth-guidance-format';
import type { GuEventStatus } from '../guidance-universe-types';
import type { GuidanceEvent, GuScanSource, GuScanStatus } from '../guidance-upgrades-types';

const NOW = new Date('2026-10-01T09:00:00Z');
const mk = (o: Partial<GuSeedRow> = {}): GuSeedRow => ({
  company: 'ZZ Alpha Inc', ticker: 'ZZALPHA', market: 'US', metric: 'REVENUE', growthLow: 40, growthHigh: 40, growthOrigin: 'STATED', absoluteTarget: null, period: 'FY26', periodKind: 'FY', kind: 'MANAGEMENT_GUIDANCE', organic: 'ORGANIC',
  statement: 'Management now guides revenue growth of 40% for the year.', driver: null, mechanisms: [], sourceName: 'Q2 2026 earnings release', sourceType: 'Earnings release', sourceUrl: 'https://www.sec.gov/Archives/x.htm', sourceDate: '2026-08-10', sourceRank: 4, verification: 'VERIFIED',
  priorGuidance: [], supersededBy: null, notes: '', ownerListText: null, ...o,
});
const co = (n: string, o: Partial<GuSeedRow> = {}) => mk({ company: `ZZ ${n} Inc`, ticker: `ZZ${n.toUpperCase()}`, ...o });
const bld = (rows: GuSeedRow[], statuses: GuEventStatus[] = []) => buildUniverse([], [], rows, NOW, { eventStatuses: statuses });
const inList = (l: GuUniverseBuild['defaultRecords'] | undefined, name: string) => (l || []).find((r) => r.record.company === `ZZ ${name} Inc`);
const st = (o: Partial<GuEventStatus>): GuEventStatus => ({ market: 'US', ticker: 'ZZALPHA', company: 'ZZ Alpha Inc', metric: 'REVENUE', period: 'FY26', date: '2026-08-10', status: 'RAISED', verified: true, label: 'x', display: null, sourceName: '8-K', sourceUrl: null, eventId: 'e1', ...o });
const raisedRow = (n: string, o: Partial<GuSeedRow> = {}) => co(n, { growthLow: 100, growthHigh: 100, priorGuidance: [{ date: '2026-05-05', growthLow: 20, growthHigh: 20, note: 'Q1 release' }], statement: 'Management raised EBITDA growth guidance to 100% from 20%.', metric: 'EBITDA', ...o });

// a minimal event (only the fields the counts / status code reads)
let nEv = 0;
const ev = (o: Partial<GuidanceEvent> & Record<string, any> = {}): GuidanceEvent => ({
  guidance_event_id: `ev${++nEv}`, canonical_key: `k${nEv}`, ticker: 'ZZALPHA', company: 'ZZ Alpha Inc', market: 'US', announcement_date: '2026-08-10', verification: 'VERIFIED', primaryAvailable: true,
  sources: [{ name: '8-K', tier: 'PRIMARY', type: 'SEC filing', url: 'https://www.sec.gov/x' }],
  changes: [{ metric: 'REVENUE', before: { metric: 'REVENUE', period: 'FY26', low: 100, high: 110, midpoint: 105, isGrowthRate: false, currency: '$', unit: 'M' }, after: { metric: 'REVENUE', period: 'FY26', low: 120, high: 130, midpoint: 125, isGrowthRate: false, currency: '$', unit: 'M' }, absoluteChange: 20, percentageChange: 19, percentagePointChange: null, direction: 'UP' }],
  classification: 'RAISE', isUpgrade: true, auditOnly: false, displayLabel: 'GUIDANCE UPGRADE', whyNow: 'Management raised FY26 revenue guidance.', decision: 'WATCHLIST',
  expectationGap: 'UNKNOWN', consensus: { value: null, label: 'UNAVAILABLE' }, materiality: 'HIGH', chain: { event: '' } as any,
  ...o,
} as unknown as GuidanceEvent);

// ═══ 1. cross-tab: the latest primary-source event overrides the universe record ═══════════════════════════════════
describe('1. events layer overrides the universe', () => {
  test('record RAISED +80pp but the filing says REITERATION: leaves Active, review reason names the filing, revision follows the filing', () => {
    const b = bld([raisedRow('Net')], [st({ ticker: 'ZZNET', metric: 'EBITDA', status: 'REITERATED', date: '2026-08-10', label: 'GUIDANCE REITERATED' })]);
    assert.equal(inList(b.defaultRecords, 'Net'), undefined, 'never Active while a newer filing disagrees');
    const r = inList(b.reviewQueue, 'Net')!; assert.ok(r);
    assert.ok(r.reviewReasonCodes.includes('EVENT_CONFLICT'));
    assert.match(r.reviewReasons.join(' '), /Latest filing \(2026-08-10\) says guidance REITERATED/);
    const p = r.points[0]; assert.equal(p.revision, 'MAINTAINED'); assert.equal(p.revisionVsPriorGuidance, null); assert.equal(p.eventOverride?.eventStatus, 'REITERATED');
  });
  test('record RAISED but the filing says LOWERED: event wins', () => {
    const b = bld([co('Dav', { growthLow: 23, growthHigh: 23, priorGuidance: [{ date: '2026-05-01', growthLow: 20, growthHigh: 20, note: 'Q1' }], statement: 'Raised revenue growth guidance to 23%.' })],
      [st({ ticker: 'ZZDAV', status: 'LOWERED', date: '2026-08-12', display: '$500M → $480M' })]);
    const r = inList(b.reviewQueue, 'Dav')!; assert.equal(r.points[0].revision, 'LOWERED'); assert.match(r.reviewReasons.join(' '), /says guidance LOWERED: \$500M → \$480M/);
    assert.equal(inList(b.defaultRecords, 'Dav'), undefined);
  });
  test('period check: a verified event for a LATER fiscal year moves an annual record to review (FY26 record vs FY27 event)', () => {
    const b = bld([co('Kes', { growthLow: 48, growthHigh: 48, sourceDate: '2026-08-05', statement: 'Revenue growth of 48%.' })], [st({ ticker: 'ZZKES', period: 'FY27', date: '2026-09-15', display: '$137M → $141M' })]);
    const r = inList(b.reviewQueue, 'Kes')!; assert.ok(r.reviewReasonCodes.includes('NEWER_PERIOD_GUIDANCE')); assert.match(r.reviewReasons.join(' '), /already guides FY27 \(\$137M → \$141M\)/);
  });
  test('unverified, older or consistent events never override (unknown is not negative)', () => {
    const rows = [co('Unv'), co('Old'), raisedRow('Same')];
    const b = bld(rows, [
      st({ ticker: 'ZZUNV', status: 'LOWERED', verified: false, date: '2026-09-01' }),
      st({ ticker: 'ZZOLD', status: 'LOWERED', date: '2026-07-01' }),
      st({ ticker: 'ZZSAME', metric: 'EBITDA', status: 'RAISED', date: '2026-08-10' }),
    ]);
    for (const n of ['Unv', 'Old', 'Same']) assert.ok(inList(b.defaultRecords, n), n);
    assert.equal(inList(b.defaultRecords, 'Unv')!.points[0].latestEvent?.status, 'LOWERED', 'the unverified event is still attached for display');
    assert.deepEqual(checkUniverseInvariants({ defaultRecords: b.defaultRecords, reviewQueue: b.reviewQueue, claimsAwaiting: b.claimsAwaiting, inactive: b.inactive, excluded: b.excluded }), []);
  });
  test('event statuses come from the engine classification (never a headline verb); per-metric direction refines a mixed event', () => {
    const e = ev({ classification: 'MIXED', changes: [
      { metric: 'REVENUE', before: { metric: 'REVENUE', period: 'FY2026', low: 1, high: 2, midpoint: 1.5, isGrowthRate: false }, after: { metric: 'REVENUE', period: 'FY2026', low: 1.1, high: 2.1, midpoint: 1.6, isGrowthRate: false }, absoluteChange: 0.1, percentageChange: 6, percentagePointChange: null, direction: 'UP' },
      { metric: 'EBITDA', before: { metric: 'EBITDA', period: 'FY26', low: 5, high: 6, midpoint: 5.5, isGrowthRate: false }, after: { metric: 'EBITDA', period: 'FY26', low: 4, high: 5, midpoint: 4.5, isGrowthRate: false }, absoluteChange: -1, percentageChange: -18, percentagePointChange: null, direction: 'DOWN' },
    ] as any });
    const s = eventStatusesOf([e]);
    assert.deepEqual(s.map((x) => [x.metric, x.period, x.status]), [['REVENUE', 'FY26', 'MIXED'], ['EBITDA', 'FY26', 'LOWERED']]);
    assert.equal(eventVerdictOf(ev({ taxonomy: 'reiteration' } as any)).status, 'REITERATED', 'the event agent taxonomy field is read when present');
    assert.equal(mergeEventStatuses(s, s).length, 2, 'merge is idempotent');
  });
  test('4. a capital-raise narrative is INVALID: never a raise in the universe, excluded from event counts with its reason', () => {
    const cap = ev({ ticker: 'ZZCAP', whyNow: 'ZZ Cap raised $200 million through a convertible notes offering.' });
    const s = eventStatusesOf([cap]); assert.equal(s[0].status, 'INVALID'); assert.match(String(s[0].reason), /capital raise/);
    const b = bld([raisedRow('Cap', { metric: 'REVENUE' })], s.map((x) => ({ ...x, period: 'FY26' })));
    assert.ok(inList(b.reviewQueue, 'Cap')); assert.equal(inList(b.defaultRecords, 'Cap'), undefined);
    const ok = ev({ ticker: 'ZZOK' });
    const c = computeCountsX([cap, ok]);
    assert.equal((cap as any).excludedFromEvents, true); assert.equal((cap as any).pipeline.status, 'DROPPED'); assert.equal(cap.isUpgrade, false); assert.match(String(cap.auditNote), /capital raise, not guidance/);
    assert.equal(c.buckets.capitalRaise, 1); assert.equal(c.notGuidance, 1); assert.equal(c.detected, 1, 'not counted as detected guidance'); assert.equal(c.verified, 1);
    assert.deepEqual(checkEventInvariants([cap, ok], c), [], 'handled, so no "Data check failed" banner');
    assert.equal(enforceEventInvariants([cap, ok]).excluded.length, 1, 'idempotent');
  });
  test('duplicates collapse to ONE canonical row per company + metric + period', () => {
    // an unresolved name that duplicates a resolved company with the same slot is superseded, not shown twice
    // (two longer names share the prefix, so the name is not merged automatically: the duplicate check catches it)
    const b = bld([co('Orion Labs', { ticker: 'ZZORL' }), co('Orion Foods', { ticker: 'ZZORF' }), mk({ company: 'ZZ Orion', ticker: null, statement: 'Revenue growth of 40%.' })]);
    assert.equal(b.records.filter((r) => r.record.company === 'ZZ Orion').length, 0);
    assert.ok(b.inactive.some((x) => x.company === 'ZZ Orion' && /Duplicate of ZZ Orion (Labs|Foods) Inc/.test(x.reason)));
    // a company with a verified revenue and a derived PAT is ONE row in the ranked Active list (each metric keeps its own badge)
    const h = bld([co('Hims'), co('Hims', { metric: 'PAT', growthLow: 60, growthHigh: 60, growthOrigin: 'IMPLIED', absoluteTarget: { value: 160, unit: '$M' }, impliedBase: { value: 100, unit: '$M', period: 'FY25' }, statement: 'Targets net income of $160 million.' })]);
    const s = summarize(h.defaultRecords, NOW, 30, h.inactive, h.reviewQueue, h.claimsAwaiting);
    const rows = s.highGrowthGroups.cohorts.ANNUAL.filter((r) => r.company === 'ZZ Hims Inc');
    assert.equal(rows.length, 1); assert.deepEqual(rows[0].metrics.map((m) => m.verificationState).sort(), ['DERIVED', 'VERIFIED']);
    assert.equal(s.highGrowthGroups.counts.rows, 1);
  });
});

// ═══ 2. verification gating ════════════════════════════════════════════════════════════════════════════════════════
describe('2. Active = verified / derived / partial-with-document-read; everything else is a claim awaiting verification', () => {
  test('aggregator / social / call-summary sources are TIER4 whatever rank the feed gave them; a verbatim transcript keeps its tier', () => {
    for (const name of ['Sahi news on ZZ AGM guidance', 'Q4 call summary (Multibagg)', 'ScanX report', 'CompoundingAI post on X', 'Trade Brains article', 'Q1 FY27 call (TradingKey summary)'])
      assert.equal(classifySourceTier({ rank: 7, type: 'Company voice', name }).tier, 4, name);
    assert.equal(classifySourceTier({ rank: 7, type: 'Concall', name: 'Q4 FY26 earnings call transcript (AlphaStreet)' }).tier, 1);
    assert.equal(classifySourceTier({ rank: 10, type: 'Media', name: 'Sahi', url: 'https://www.bseindia.com/x.pdf' }).tier, 1, 'an exchange URL still wins');
  });
  test('media rows, last-verified-unknown rows and document-not-read rows are claims: never Active, never ranked, counted apart', () => {
    const b = bld([
      co('Ver'),
      co('Med', { sourceName: 'Sahi news: ZZ raises guidance', sourceType: 'Media', sourceRank: 10, sourceUrl: null, verification: 'PARTIALLY_VERIFIED', growthLow: 60, growthHigh: 60, statement: 'Revenue growth of 60%.' }),
      co('Unk', { sourceDate: null, growthLow: 70, growthHigh: 70, statement: 'Revenue growth of 70%.' }),
      co('Nrd', { primarySourceRead: false, growthLow: 80, growthHigh: 80, statement: 'Revenue growth of 80%.' }),
    ]);
    assert.deepEqual(b.defaultRecords.map((r) => r.record.company), ['ZZ Ver Inc']);
    for (const n of ['Med', 'Unk', 'Nrd']) { const c = inList(b.claimsAwaiting, n)!; assert.ok(c, n); assert.equal(c.listBucket, 'CLAIMS'); assert.equal(c.points[0].verificationState, 'UNVERIFIED'); assert.ok(c.points[0].awaitingVerificationReason); }
    assert.match(inList(b.claimsAwaiting, 'Unk')!.points[0].awaitingVerificationReason!, /Last verified date unknown/);
    const s = summarize(b.defaultRecords, NOW, 30, b.inactive, b.reviewQueue, b.claimsAwaiting);
    const active = Object.values(s.highGrowthGroups.cohorts).flat().map((r) => r.company);
    assert.deepEqual(active, ['ZZ Ver Inc'], 'the ranked Active list holds only Active rows');
    assert.deepEqual(Object.values(s.highGrowthGroups.trust.claimsAwaiting).flat().map((r) => r.company).sort(), ['ZZ Med Inc', 'ZZ Nrd Inc', 'ZZ Unk Inc']);
    assert.equal(s.claimsAwaitingCount, 3); assert.equal(s.counts.unverified, 0);
    assert.deepEqual(checkUniverseInvariants({ defaultRecords: b.defaultRecords, reviewQueue: b.reviewQueue, claimsAwaiting: b.claimsAwaiting, inactive: b.inactive, excluded: b.excluded }), []);
  });
  test(`stale: last verified more than ${STALE_DEMOTE_DAYS} days ago leaves Active for review (documented decision)`, () => {
    const b = bld([co('Stale', { sourceDate: '2026-05-01' })]);   // zzz880: older than 135 days on 1 Oct
    assert.equal(b.defaultRecords.length, 0); assert.ok(inList(b.reviewQueue, 'Stale')!.reviewReasonCodes.includes('STALE_VERIFICATION'));
  });
  test('invariants are enforced, not only reported: the shared rule set flags a media / unread / stale / conflicted Active point', () => {
    const b = bld([co('Ver')]); const p = { ...b.defaultRecords[0].points[0] };
    assert.deepEqual(activePointViolations({ companyId: 'US:ZZVER', ticker: 'ZZVER', market: 'US' }, p), []);
    const bad = { ...p, sourceTier: 4 as const, primarySourceRead: false, lastVerified: null, lastVerifiedDaysAgo: 200 };
    const codes = activePointViolations({ companyId: 'US:ZZVER', ticker: 'ZZVER', market: 'US' }, bad).map((x) => x.code);
    for (const c of ['ACTIVE_SECONDARY_SOURCE', 'ACTIVE_PRIMARY_NOT_READ', 'ACTIVE_LAST_VERIFIED_UNKNOWN', 'ACTIVE_STALE']) assert.ok(codes.includes(c), c);
    // a hand-built bundle with a claim in Active is caught
    const m = bld([co('Med', { sourceName: 'Trade Brains', sourceType: 'Media', sourceRank: 10, sourceUrl: null, verification: 'PARTIALLY_VERIFIED' })]);
    const broken = JSON.parse(JSON.stringify(m.claimsAwaiting)); broken[0].points[0].inDefaultView = true; broken[0].points[0].listBucket = 'ACTIVE';
    assert.ok(checkUniverseInvariants({ defaultRecords: broken }).some((v) => v.code === 'ACTIVE_SECONDARY_SOURCE'));
    assert.ok(checkUniverseInvariants({ claimsAwaiting: broken }).some((v) => v.code === 'CLAIM_IN_ACTIVE'));
  });
});

// ═══ 3. counts reconcile ═══════════════════════════════════════════════════════════════════════════════════════════
describe('3. every header count comes from the same filtered set, with its equation', () => {
  const rows = [co('A'), co('B', { growthLow: 10, growthHigh: 10, statement: 'Revenue growth of 10%.' }),
    co('D', { growthLow: 60, growthHigh: 60, growthOrigin: 'IMPLIED', absoluteTarget: { value: 160, unit: '$M' }, impliedBase: { value: 100, unit: '$M', period: 'FY25' }, statement: 'Targets revenue of $160 million.' }),
    co('M', { sourceName: 'ScanX', sourceType: 'Media', sourceRank: 10, sourceUrl: null, verification: 'PARTIALLY_VERIFIED' }), co('Q', { period: 'Q3', periodKind: 'QUARTER' })];
  test('Active = verified + derived + partial; highest active is a labelled subset of Active; rows = active + review + claims', () => {
    const b = bld(rows); const s = summarize(b.defaultRecords, NOW, 30, b.inactive, b.reviewQueue, b.claimsAwaiting);
    const e = s.countEquations;
    assert.equal(e.active.value, b.defaultRecords.length); assert.equal(e.active.parts!.verified + e.active.parts!.derived + e.active.parts!.partial, e.active.value); assert.equal(e.active.holds, true);
    assert.equal(e.highestActive.value, Object.values(s.highGrowthGroups.cohorts).flat().length); assert.ok(e.highestActive.companies <= e.active.value);
    assert.match(e.highestActive.text, /Active rows with Revenue, PAT or EBITDA guided growth of 30% or more/);
    assert.equal(e.rows.value, b.defaultRecords.length + b.reviewQueue.length + (b.claimsAwaiting || []).length);
    assert.deepEqual(checkUniverseCountEquations(e), []);
    assert.ok(checkUniverseCountEquations({ ...e, active: { ...e.active, value: e.active.value + 3 } }).some((v) => v.code === 'COUNT_ACTIVE_NOT_SUM'));
  });
  test('the route response: viewCounts and countEquations agree, view=claims lists the claims, no invariant violations', async () => {
    const b = await getUniverseBundle(0, true, { kvGet: async () => null, kvSet: async () => {}, readStored: async () => null, writeStored: async () => true, now: () => NOW, seed: { rows },
      getLive: async () => { throw new Error('down'); }, getEventStatuses: async () => ({ statuses: [], source: 'test' }) });
    const r = buildUniverseResponse(b) as any;
    assert.equal(r.viewCounts.default, r.countEquations.active.value); assert.equal(r.viewCounts.review, r.countEquations.needsReview.value); assert.equal(r.viewCounts.claimsAwaiting, r.countEquations.claimsAwaiting.value);
    assert.deepEqual(r.invariantViolations, []); assert.equal(r.eventReconciliation.source, 'test');
    assert.equal(parseView('claims'), 'claims');
    const c = buildUniverseResponse(b, { view: 'claims' }) as any; assert.ok(c.records.length >= 1); assert.ok(c.records.every((x: any) => x.listBucket === 'CLAIMS'));
  });
  test('the service reconciles against injected event statuses (a failing loader never empties the universe)', async () => {
    const deps = { kvGet: async () => null, kvSet: async () => {}, readStored: async () => null, writeStored: async () => true, now: () => NOW, seed: { rows: [raisedRow('Net')] }, getLive: async () => { throw new Error('down'); } };
    const ok = await getUniverseBundle(0, true, { ...deps, getEventStatuses: async () => ({ statuses: [st({ ticker: 'ZZNET', metric: 'EBITDA', status: 'REITERATED' })], source: 'test' }) });
    assert.equal(ok.build.defaultRecords.length, 0); assert.equal(ok.build.reviewQueue.length, 1); assert.equal(ok.events?.statuses, 1);
    const bad = await getUniverseBundle(0, true, { ...deps, getEventStatuses: async () => { throw new Error('kv down'); } });
    assert.equal(bad.build.defaultRecords.length, 1); assert.match(bad.events?.error || '', /kv down/);
  });
  test('events: detected = sum of exclusive buckets; verified = verified formal upgrades only; pipeline buckets are used when present', () => {
    const list = [
      ev(), ev({ verification: 'UNVERIFIED', primaryAvailable: false, isUpgrade: false, displayLabel: 'UNVERIFIED CLAIM' }),
      ev({ classification: 'REITERATION', isUpgrade: false, auditOnly: true, displayLabel: 'REITERATION', whyNow: 'Guidance maintained.' }),
      ev({ classification: 'DOWNGRADE', isUpgrade: false, auditOnly: true, displayLabel: 'GUIDANCE LOWERED', whyNow: 'Guidance cut.' }),
      ev({ classification: 'MIXED', isUpgrade: false, auditOnly: true, displayLabel: 'MIXED / RANGE CHANGE', whyNow: 'Range narrowed.' }),
      ev({ classification: 'DETECTED', isUpgrade: false, displayLabel: 'DETECTED, NUMBERS NOT FOUND', changes: [], whyNow: '' }),
      ev({ pipeline: { status: 'QUEUE', bucket: 'firstGuidance', reviewStatus: 'first_guidance', reason: 'first guidance' }, isUpgrade: false, displayLabel: 'FIRST GUIDANCE (NOT A RAISE)' }),
    ];
    const c = computeCountsX(list, { documentsAwaitingGrading: 87, documentsUnavailable: 2 });
    assert.equal(c.detected, GUIDANCE_BUCKETS.reduce((a, k) => a + c.buckets[k], 0)); assert.equal(c.detected, 7);
    assert.deepEqual([c.buckets.verifiedUpgrades, c.buckets.unverified, c.buckets.reiterations, c.buckets.lowered, c.buckets.mixed, c.buckets.awaitingNumbers, c.buckets.firstGuidance], [1, 1, 1, 1, 1, 1, 1]);
    assert.equal(c.verified, 1); assert.equal(c.upgrade, 1); assert.equal(c.verifiedPrimaryRead, 6);
    assert.match(c.equation, /^Detected 7 = 1 verified upgrades \+ 1 reiterations \+ 1 mixed/);
    assert.ok(c.verified <= c.processed && c.processed <= c.discovered); assert.equal(c.discovered, 7 + 87 + 2);
    assert.equal(c.shown + c.queued + c.dropped, c.detected + c.notGuidance);
    assert.deepEqual(checkEventInvariants(list, c), []);
    assert.ok(countsDetail(computeCounts(list)), 'computeCounts keeps the GuCounts type and carries the detail');
    assert.ok(checkEventInvariants(list, { ...c, detected: c.detected + 1 }).some((m) => /not the sum of its buckets/.test(m)));
  });
  test('a violation demotes the event: an unverified "GUIDANCE UPGRADE" becomes a queued claim; a verified event with no primary is unverified', () => {
    const lab = ev({ verification: 'UNVERIFIED', primaryAvailable: false });
    const nop = ev({ primaryAvailable: false });
    const r = enforceEventInvariants([lab, nop]);
    assert.equal(r.demoted.length, 2); assert.notEqual(lab.displayLabel, 'GUIDANCE UPGRADE'); assert.equal(lab.isUpgrade, false);
    assert.equal(nop.verification, 'UNVERIFIED'); assert.equal(eventBucketOf(nop), 'unverified'); assert.equal((nop as any).pipeline.status, 'QUEUE');
    assert.match(String(nop.auditNote), /verified without a primary source/);
  });
});

// ═══ 5. data-feed coverage and freshness ═════════════════════════════════════════════════════════════════════════
const memIo = (init: Record<string, any> = {}, failing: string[] = []) => {
  const store = new Map<string, any>(Object.entries(init)); const sets: Array<{ key: string; ttl: number }> = [];
  const io = {
    get: async (k: string) => (failing.includes(k) ? { value: null, failed: true, reason: 'ECONNRESET' } : { value: store.has(k) ? store.get(k) : null }),
    set: async (k: string, v: any, ttl: number) => { store.set(k, JSON.parse(JSON.stringify(v))); sets.push({ key: k, ttl }); },
    now: () => NOW.getTime(),
  };
  return { io, store, sets };
};
const art = (i: number) => ({ id: `a${i}`, title: `ZZ headline ${i}`, published_at: '2026-10-01T08:00:00Z' });

describe('5a. news cache: durable last-good copy (>= 26 h), read as a labelled-stale fallback', () => {
  test('a successful refresh writes news:articles:v39:lastgood with a long TTL; a collapsed refresh serves it, labelled stale with its age', async () => {
    const m = memIo();
    const ok = await refreshNewsLastGood(m.io as NewsIo, Array.from({ length: 12 }, (_, i) => art(i)));
    assert.equal(ok.servedFromLastGood, false); const w = m.sets.find((s) => s.key === NEWS_SHARED_LASTGOOD_KEY)!; assert.ok(w); assert.ok(w.ttl >= 26 * 3600); assert.ok(NEWS_SHARED_LASTGOOD_TTL_S >= 26 * 3600);
    m.store.get(NEWS_SHARED_LASTGOOD_KEY).savedAt = new Date(NOW.getTime() - 3 * 3600_000).toISOString();
    const bad = await refreshNewsLastGood(m.io as NewsIo, [{ title: '[STRUCTURAL ALERT] placeholder' }]);
    assert.equal(bad.servedFromLastGood, true); assert.equal(bad.articles!.length, 12); assert.equal(bad.ageMinutes, 180); assert.match(bad.label!, /STALE: .* saved 3 hours ago/);
  });
  test('the guidance reader falls back to the shared last-good copy when the 5-minute key is absent, and labels it', async () => {
    _resetNewsCacheThrottle();
    const m = memIo({ [NEWS_SHARED_LASTGOOD_KEY]: { savedAt: new Date(NOW.getTime() - 50 * 60_000).toISOString(), articles: [art(1), art(2)] } });
    const r = await readNewsWithLastGood(m.io as NewsIo);
    assert.equal(r.servedBy, 'SHARED_LASTGOOD'); assert.equal(r.liveState, 'CACHE_MISS'); assert.match(r.row.text, new RegExp(`${NEWS_KEY}: CACHE MISS .* last good copy saved 50 minutes ago`));
  });
});

describe('5b. concall feed: next-best key, then last-good; a failed read is never zero', () => {
  test('days:30 missing -> days:14 is used and labelled; the last-good copy is written', async () => {
    _resetConcallLastGoodThrottle();
    const m = memIo({ 'concall-feed:v26:days:14': { filings: [{ id: 1 }, { id: 2 }] } });
    const r = await readConcallFeedWithFallback(m.io as FeedIo); await r.wrote;
    assert.equal(r.servedBy, 'FALLBACK_KEY'); assert.equal(r.keyUsed, 'concall-feed:v26:days:14'); assert.equal(r.stale, true);
    assert.match(r.label, /concall-feed:v26:days:30 missing; using concall-feed:v26:days:14 \(2 filings/);
    const w = m.sets.find((s) => s.key === CONCALL_FEED_LASTGOOD_KEY)!; assert.ok(w && w.ttl >= 26 * 3600); assert.ok(CONCALL_FEED_LASTGOOD_TTL_S >= 26 * 3600);
  });
  test('every key missing -> the last-good copy serves, STALE with its age; every read failing -> FAILED, unknown not zero', async () => {
    const m = memIo({ [CONCALL_FEED_LASTGOOD_KEY]: { savedAt: new Date(NOW.getTime() - 5 * 3600_000).toISOString(), filings: [{ id: 1 }] } });
    const r = await readConcallFeedWithFallback(m.io as FeedIo);
    assert.equal(r.servedBy, 'LASTGOOD'); assert.equal(r.ageMinutes, 300); assert.match(r.label, /last good copy saved 5 hours ago \(1 filings, STALE\)/);
    const keys = ['concall-feed:v26:days:30', 'concall-feed:v26:days:14', 'concall-feed:v26:days:7', 'concall-feed:v26:days:2', CONCALL_FEED_LASTGOOD_KEY];
    const f = await readConcallFeedWithFallback(memIo({}, keys).io as FeedIo);
    assert.equal(f.feed, null); assert.equal(f.allFailed, true); assert.match(f.label, /every read FAILED .* unknown, not zero filings/);
    const miss = await readConcallFeedWithFallback(memIo().io as FeedIo);
    assert.equal(miss.allFailed, false); assert.match(miss.label, /needs a refresh, this says nothing about whether filings exist/);
  });
});

describe('5c. NSE 403 / BSE empty are FAILED (not partial reads), with a retry-after cool-down', () => {
  const DAYS = ['2026-09-29', '2026-09-28', '2026-09-27', '2026-09-26', '2026-09-25', '2026-09-24', '2026-09-23'];
  const scan = (sources: GuScanSource[]): GuScanStatus => ({ market: 'IN', windowFrom: DAYS[6], windowTo: DAYS[0], complete: false, lastScanAt: NOW.toISOString(), sources, daysCovered: 0, daysRequested: 7,
    candidatesFound: 0, processed: 0, awaitingGrading: 0, verified: 0, newestItemAt: null, note: '' });
  test('NSE HTTP 403 + BSE answering with zero rows -> overall FAILED, both named, 0 trading days read, retry time given', () => {
    const c = buildCoverageCard({ market: 'IN', window: '7D', windowDays: 7, now: new Date('2026-09-29T12:00:00Z'), scan: scan([
      { name: 'NSE announcements', tier: 'PRIMARY', state: 'FAILED', scanned: 0, detail: 'HTTP 403', daysTried: DAYS, daysOk: [], failReasons: ['HTTP 403 Forbidden'] },
      { name: 'BSE announcements', tier: 'PRIMARY', state: 'COMPLETE', scanned: 0, detail: 'query worked', daysTried: DAYS, daysOk: DAYS },
    ]) });
    assert.equal(c.overall, 'FAILED'); assert.equal(c.daysSuccessfullyRead, 0);
    const nse = c.sources.find((s) => s.name.startsWith('NSE'))!; const bse = c.sources.find((s) => s.name.startsWith('BSE'))!;
    assert.equal(nse.status, 'FAILED'); assert.equal(nse.failureKind, 'BLOCKED'); assert.ok(nse.retryAfter);
    assert.equal(Date.parse(nse.retryAfter!) - Date.parse('2026-09-29T12:00:00Z'), EXCHANGE_COOLDOWN_MIN * 60_000);
    assert.equal(bse.status, 'FAILED'); assert.equal(bse.dataStatus, 'UNKNOWN', 'a failed read is unknown, never zero results'); assert.equal(bse.failureKind, 'EMPTY_RESPONSE');
    assert.match(c.headline, /India: scan FAILED, 0 of 5 trading days read .*NSE announcements blocked by the exchange; BSE announcements answered with no announcements \(treated as failed\); next retry after 12:30 UTC/);
    assert.equal(c.retryAfter, nse.retryAfter); assert.deepEqual(checkCoverageCard(c), []);
  });
});

describe('5d. document queue throughput', () => {
  test('more documents per run, a time budget, longest-waiting first inside a priority, and a drain estimate', () => {
    assert.ok(MAX_DOCS_PER_RUN >= 30 && QUEUE_CONCURRENCY >= 5 && DOC_BUDGET_MS <= 20_000);
    const t1 = new Date(NOW.getTime() - 3 * 3600_000), t2 = new Date(NOW.getTime() - 3600_000);
    let q = enqueue(emptyQueue(t1), [{ market: 'IN', ticker: 'ZZOLD', company: 'ZZ Old Ltd', sourceUrl: 'https://x.test/old.pdf', sourceType: 'Filing', subject: 'Investor Presentation', eventDate: '2026-09-01' }], t1).queue;
    q = enqueue(q, [{ market: 'IN', ticker: 'ZZNEW', company: 'ZZ New Ltd', sourceUrl: 'https://x.test/new.pdf', sourceType: 'Filing', subject: 'Investor Presentation', eventDate: '2026-09-30' },
      { market: 'IN', ticker: 'ZZP0', company: 'ZZ P0 Ltd', sourceUrl: 'https://x.test/p0.pdf', sourceType: 'Filing', subject: 'Raises FY27 guidance', eventDate: '2026-09-30' }], t2).queue;
    assert.deepEqual(selectDue(q, NOW).map((x) => x.ticker), ['ZZP0', 'ZZOLD', 'ZZNEW']);
    const d = drainEstimate(87); assert.equal(d.runs, 5); assert.equal(d.hours, 3); assert.match(d.text, /to read all 87/);
    assert.match(reportQueue(q).note, /up to 30 are read per run \(5 at a time\)/);
  });
});

// ═══ 6. scan text ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('6. scan note wording', () => {
  test('a repeated SCAN INCOMPLETE prefix collapses to one; other notes are unchanged', () => {
    assert.equal(scanNoteText('SCAN INCOMPLETE — SCAN INCOMPLETE — India: 0 of 86 days covered.'), 'SCAN INCOMPLETE — India: 0 of 86 days covered.');
    assert.equal(scanNoteText('SCAN INCOMPLETE — India: x. SCAN INCOMPLETE — US: y.'), 'SCAN INCOMPLETE — India: x. US: y.');
    assert.equal(scanNoteText('Scan complete for the sources read.'), 'Scan complete for the sources read.');
    assert.equal(stripScanPrefix('SCAN INCOMPLETE — India: z'), 'India: z');
  });
});
