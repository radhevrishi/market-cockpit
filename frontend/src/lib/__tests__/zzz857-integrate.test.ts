// zzz857 — the Guidance UNIVERSE and the Guidance EVENTS consume AI-extracted, quote-checked rows from the companies' OWN documents.
// Fixture-based, no network. Man Industries (public, owner's regression example) + synthetic US tickers (ZZ...).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildUniverse, summarize, type GuUniverseRecordX } from '../guidance-universe';
import { getUniverseBundle, buildUniverseResponse, getSeedRows } from '../guidance-universe-service';
import { checkUniverseInvariants, checkUniverseCountEquations } from '../guidance-invariants';
import { buildExtractedEvents, mergeExtractedEvents, skeletonsFromExtracted, partitionPipeline, pipelineCounts, classifyEvent, extractedPeriod, EXTRACTED_VIA } from '../guidance-upgrades';
import { eventStatusesOf } from '../guidance-upgrades-reconcile';
import {
  listExtractResults, docIdsOf, fyActualFromDatedSeries, universeUnitOf, priorPeriodOf, actualKey, actualsFromDocs, loadPriorActuals, coverageOf, loadExtractedForUniverse,
  EXTRACT_INDEX_KEY, extractKey, DOCS_INDEX_KEY, type PriorActual, type ExtractIo,
} from '../guidance-extract-reader';
import type { GuidanceExtractResult, ExtractedGuidance } from '../guidance-docs-types';
import type { GuidanceEvent } from '../guidance-upgrades-types';

const MAN_URL = 'https://mangroup.com/wp-content/uploads/2026/06/Concall-Transcript_26.05.2026.pdf';
const row = (o: Partial<ExtractedGuidance>): ExtractedGuidance => ({
  metric: 'REVENUE', metricLabel: 'consolidated revenue', period: 'FY27', periodKind: 'ANNUAL', basis: 'REPORTED', currency: 'INR', unit: 'crore', low: null, high: null, status: 'NEW',
  quote: 'quote', confidence: 0.9, ...o,
});
const res = (o: Partial<GuidanceExtractResult>): GuidanceExtractResult => ({
  docId: 'd', market: 'IN', ticker: 'MANINDS', company: 'Man Industries (India) Ltd', docUrl: MAN_URL, docKind: 'TRANSCRIPT', filedAt: '2026-05-27', extractedAt: '2026-10-02T06:00:00Z',
  model: 'test', status: 'ok', rows: [], dropped: 0, ...o,
});
const MAN_MAY = res({ docId: 'man-may', rows: [
  row({ low: 5000, high: 5500, quote: 'For FY27 we are guiding a consolidated revenue of ₹5,000 crore to ₹5,500 crore, excluding Merino Shelters.' }),
  row({ metric: 'EBITDA_MARGIN', metricLabel: 'EBITDA margin', currency: null, unit: '%', low: 13, high: 15, quote: 'EBITDA margin should be in the range of 13% to 15%.' }),
] });
const MAN_AUG = res({ docId: 'man-aug', filedAt: '2026-08-13', docUrl: 'https://mangroup.com/wp-content/uploads/2026/08/Concall-Transcript_13.08.2026.pdf', rows: [
  row({ low: 5000, high: 5000, status: 'REITERATED', quote: 'We reiterate a revenue guidance of about INR 5,000 crore for FY27.' }),
] });
const ACT: Map<string, PriorActual> = new Map([[actualKey('IN', 'MANINDS', 'REVENUE', 'FY26'), { market: 'IN', ticker: 'MANINDS', metric: 'REVENUE', period: 'FY26', value: 3592, unit: '₹ Cr', source: 'FY26 results (total income)' }]]);
// US: a RAISED guide with the prior stated in the release, and a NEW guide
const US_RAISED = res({ docId: 'zz-raise', market: 'US', ticker: 'ZZRAISE', company: 'ZZ Raise Corp', docUrl: 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/ex99-1.htm', docKind: 'RESULTS_RELEASE', filedAt: '2026-08-06',
  rows: [row({ period: 'FY2026', currency: 'USD', unit: 'million', basis: 'GAAP', low: 450, high: 470, status: 'RAISED', prior: { low: 420, high: 440, statedIn: 'May 2026 release' }, quote: 'The company raised its fiscal 2026 revenue outlook to $450 million to $470 million, from $420 million to $440 million.' })] });
const US_NEW = res({ docId: 'zz-new', market: 'US', ticker: 'ZZNEW', company: 'ZZ New Inc', docUrl: 'https://www.sec.gov/Archives/edgar/data/2/000000000226000002/ex99-1.htm', docKind: 'RESULTS_RELEASE', filedAt: '2026-08-20',
  rows: [row({ period: 'FY2027', currency: 'USD', unit: 'million', basis: 'GAAP', low: 300, high: 320, status: 'NEW', quote: 'For fiscal 2027 the company expects revenue of $300 million to $320 million.' })] });

const JUNE = new Date('2026-06-10T09:00:00Z');
const OCT = new Date('2026-10-02T09:00:00Z');
const seed = getSeedRows().rows;
const manOf = (l: GuUniverseRecordX[] | undefined) => (l || []).find((r) => r.tickers.includes('MANINDS') || r.record.ticker === 'MANINDS');
const revPt = (r: GuUniverseRecordX | undefined) => r?.points.find((p) => p.metric === 'REVENUE' && p.period === 'FY27');

describe('zzz857 universe: Man Industries from its own transcript', () => {
  const b = buildUniverse([], [], seed, JUNE, { extracted: { results: [MAN_MAY], actuals: ACT } });
  const man = manOf(b.defaultRecords); const p = revPt(man);
  test('Active, India, company-document source with the transcript link', () => {
    assert.ok(man, 'Man Industries is in the Active list');
    assert.equal(man!.record.market, 'IN');
    assert.equal(p!.origin, 'COMPANY_DOC');
    assert.equal(p!.listBucket, 'ACTIVE');
    assert.equal(p!.sourceUrl, MAN_URL);
    assert.equal(p!.sourceTier, 1);
    assert.equal(p!.primarySourceRead, true);
    assert.match(p!.statement, /5,000 crore to ₹5,500 crore/);
  });
  test('revenue +39% to +53% derived vs FY26 actual ₹3,592 Cr, labelled (derived)', () => {
    assert.equal(p!.growthType, 'DERIVED');
    assert.equal(p!.verificationState, 'DERIVED');
    assert.ok(Math.abs(p!.growthExact!.low - 39.2) < 0.1 && Math.abs(p!.growthExact!.high - 53.1) < 0.1, JSON.stringify(p!.growthExact));
    assert.match(p!.display, /^\+39–53% vs FY26 actual \(derived: ₹5,000–5,500 Cr vs ₹3,592 Cr\)$/);
    assert.equal(p!.growthDerivation!.basis, 'absolute_vs_prior_year_actual');
    assert.equal(p!.revision, 'INITIAL');
    assert.match(String(p!.notes), /EBITDA margin 13–15% \(FY27/);
  });
  test('the high-growth (>=30%) list includes it', () => {
    const s = summarize(b.defaultRecords, JUNE, 30, b.inactive, b.reviewQueue, b.claimsAwaiting);
    const row = s.highGrowthGroups.cohorts.ANNUAL.find((r) => r.ticker === 'MANINDS');
    assert.ok(row, 'in the ANNUAL cohort'); assert.equal(row!.trust, 'derived'); assert.match(row!.text, /Revenue \+39–53% \(derived\)/);
    assert.equal(row!.sourceUrl, MAN_URL);
    assert.ok(s.byMarket.IN.companies >= 1);
    assert.ok(s.countEquations.active.holds && s.countEquations.highestActive.holds);
    assert.deepEqual(checkUniverseCountEquations(s.countEquations), []);
    assert.deepEqual(checkUniverseInvariants({ defaultRecords: b.defaultRecords, reviewQueue: b.reviewQueue, claimsAwaiting: b.claimsAwaiting, inactive: b.inactive, excluded: b.excluded }), []);
  });
  test('the media seed row for the same company + metric + period is superseded (no claim awaiting verification, no conflict)', () => {
    assert.equal(manOf(b.claimsAwaiting), undefined);
    assert.equal(manOf(b.reviewQueue), undefined);
    assert.ok(b.inactive.some((x) => x.ticker === 'MANINDS' && x.status === 'SUPERSEDED' && /company's own document/.test(x.reason)));
    assert.equal(p!.sourceConflict, false);
  });
  test('without a prior-year actual: the absolute guidance, growth not established, still Active (never a guess)', () => {
    const b2 = buildUniverse([], [], [], JUNE, { extracted: { results: [MAN_MAY], actuals: new Map() } });
    const q = revPt(manOf(b2.defaultRecords));
    assert.ok(q); assert.equal(q!.growthType, 'UNKNOWN'); assert.equal(q!.low, null); assert.equal(q!.verificationState, 'PARTIAL');
    assert.match(q!.display, /₹5,000–5,500 Cr target \(growth not established: no FY26 actual available\)/);
    assert.equal(q!.compareValue, null);
    const s = summarize(b2.defaultRecords, JUNE, 30, b2.inactive, b2.reviewQueue, b2.claimsAwaiting);
    assert.equal(s.highGrowthGroups.cohorts.ANNUAL.some((r) => r.ticker === 'MANINDS'), false);
  });
  test('August REITERATED ~₹5,000 crore: stays Active, range kept, lastVerified Aug 2026, note', () => {
    const b3 = buildUniverse([], [], seed, OCT, { extracted: { results: [MAN_AUG, MAN_MAY], actuals: ACT } });
    const q = revPt(manOf(b3.defaultRecords));
    assert.ok(q, 'still Active in October (verified 50 days ago)');
    assert.equal(q!.lastVerified, '2026-08-13');
    assert.equal(q!.absolute!.valueLow, 5000); assert.equal(q!.absolute!.value, 5500);
    assert.match(String(q!.notes), /reiterated ~₹5,000 crore \(lower end\)/);
    assert.equal(q!.revision, 'MAINTAINED');
    assert.equal(q!.sourceUrl, MAN_URL);
    assert.ok(q!.sources.some((s) => /13\.08\.2026/.test(String(s.url)) && s.role === 'PRIMARY'));
    // zzz880: without the August document the May record is ~130 days old in October — inside the 135-day limit, so it stays Active with
    // the stale caveat; past 135 days it goes to review
    const b4 = buildUniverse([], [], [], OCT, { extracted: { results: [MAN_MAY], actuals: ACT } });
    assert.ok(revPt(manOf(b4.defaultRecords)), 'still Active at ~130 days');
    const LATE = new Date(OCT.getTime() + 30 * 86_400_000);
    const b5 = buildUniverse([], [], [], LATE, { extracted: { results: [MAN_MAY], actuals: ACT } });
    assert.ok(revPt(manOf(b5.reviewQueue))!.reviewReasons.some((r) => r.code === 'STALE_VERIFICATION'));
  });
  test('a newer NEW figure for the same slot supersedes the older one (kept as prior); LOWERED moves the revision', () => {
    const nov = res({ docId: 'man-nov', filedAt: '2026-09-20', rows: [row({ low: 4600, high: 4800, status: 'LOWERED', quote: 'We now expect FY27 revenue of ₹4,600 to 4,800 crore.' })] });
    const b5 = buildUniverse([], [], [], OCT, { extracted: { results: [MAN_MAY, nov], actuals: ACT } });
    const q = revPt(manOf([...b5.defaultRecords, ...b5.reviewQueue]))!;
    assert.equal(q.revision, 'LOWERED'); assert.equal(q.absolute!.value, 4800); assert.equal(q.priors.length, 1); assert.equal(q.priors[0].abs!.value, 5500);
    const w = res({ docId: 'man-wd', filedAt: '2026-09-25', rows: [row({ status: 'WITHDRAWN', low: null, high: null, quote: 'We withdraw the FY27 guidance.' })] });
    const b6 = buildUniverse([], [], [], OCT, { extracted: { results: [MAN_MAY, w], actuals: ACT } });
    assert.equal(revPt(manOf(b6.defaultRecords)), undefined);
    assert.ok(b6.inactive.some((x) => x.ticker === 'MANINDS' && x.status === 'WITHDRAWN'));
  });
  test('quarter rows never enter the universe; stated growth % wins over derivation', () => {
    const q = res({ docId: 'zq', rows: [row({ period: 'Q2 FY27', periodKind: 'QUARTER', low: 1200, high: 1300 }), row({ low: 5000, high: 5500, growthPctLow: 40, growthPctHigh: 50 })] });
    const b7 = buildUniverse([], [], [], JUNE, { extracted: { results: [q], actuals: ACT } });
    const m = manOf(b7.defaultRecords)!;
    assert.equal(m.points.some((x) => /^Q/.test(x.period)), false);
    const p7 = revPt(m)!; assert.equal(p7.growthType, 'EXPLICIT'); assert.equal(p7.verificationState, 'VERIFIED'); assert.equal(p7.low, 40); assert.equal(p7.high, 50);
  });
});

describe('zzz857 universe: US company documents', () => {
  const b = buildUniverse([], [], [], OCT, { extracted: { results: [US_RAISED, US_NEW], actuals: new Map() } });
  test('a RAISED guide is Active with its stated prior as the revision vs prior guidance', () => {
    const r = b.defaultRecords.find((x) => x.record.ticker === 'ZZRAISE'); assert.ok(r);
    const p = r!.points[0]; assert.equal(p.revision, 'RAISED'); assert.ok(p.revisionVsPriorGuidance); assert.equal(p.revisionVsPriorGuidance!.direction, 'RAISED');
    assert.equal(p.sourceTier, 1);
  });
  test('a NEW guide is Active (universe only), revision INITIAL', () => {
    const r = b.defaultRecords.find((x) => x.record.ticker === 'ZZNEW'); assert.ok(r); assert.equal(r!.points[0].revision, 'INITIAL');
  });
});

describe('zzz857 events: extracted rows as primary candidates through the same engine', () => {
  test('Man Industries May: first_guidance, review queue, NOT an upgrade card', () => {
    const evs = buildExtractedEvents([MAN_MAY], () => ({}), JUNE, '120D');
    assert.equal(evs.length, 1); const e = evs[0];
    assert.equal(e.taxonomy, 'first_guidance');
    assert.equal(e.pipeline!.status, 'QUEUE'); assert.equal(e.pipeline!.bucket, 'firstGuidance');
    assert.equal(e.verification, 'VERIFIED'); assert.equal(e.primarySourceUrl, MAN_URL);
    assert.equal(classifyEvent(e as any).isUpgrade, false);
    assert.ok(e.v2!.detectedVia.includes(EXTRACTED_VIA));
    const part = partitionPipeline(evs); assert.equal(part.cards.length, 0); assert.equal(part.queue.length, 1); assert.equal(part.queue[0].status, 'first_guidance');
    // the universe reads the event as NO_NUMBERS (never a raise)
    assert.ok(eventStatusesOf(evs).every((s) => s.status === 'NO_NUMBERS'));
  });
  test('Man Industries August: REITERATED -> reiteration (audit row)', () => {
    const e = buildExtractedEvents([MAN_AUG], () => ({}), OCT, '120D')[0];
    assert.equal(e.taxonomy, 'reiteration'); assert.equal(e.pipeline!.status, 'AUDIT'); assert.equal(e.pipeline!.bucket, 'reiterations');
    const st = eventStatusesOf([e]).find((s) => s.metric === 'REVENUE')!; assert.equal(st.status, 'REITERATED'); assert.equal(st.verified, true);
    // and the universe record (MAINTAINED) does not conflict with it
    const b = buildUniverse([], [], [], OCT, { extracted: { results: [MAN_MAY, MAN_AUG], actuals: ACT }, eventStatuses: eventStatusesOf([e]) });
    assert.ok(revPt(manOf(b.defaultRecords)));
  });
  test('US RAISED with stated prior: verified formal upgrade card', () => {
    const e = buildExtractedEvents([US_RAISED], () => ({}), OCT, '120D')[0];
    assert.equal(e.taxonomy, 'formal_upgrade'); assert.equal(e.pipeline!.status, 'CARD'); assert.equal(e.verification, 'VERIFIED');
    assert.equal(e.changes[0].before!.low, 420); assert.equal(e.changes[0].after.high, 470); assert.equal(e.changes[0].direction, 'UP');
    assert.equal(e.primarySourceState, 'read_numbers_found');
    // the universe record (RAISED, same date) and the RAISED event agree: still Active
    const b = buildUniverse([], [], [], OCT, { extracted: { results: [US_RAISED], actuals: new Map() }, eventStatuses: eventStatusesOf([e]) });
    assert.ok(b.defaultRecords.find((x) => x.record.ticker === 'ZZRAISE'));
  });
  test('US NEW: universe only (first guidance queue), never a card; LOWERED -> lowered audit; RAISED without prior waits for numbers', () => {
    const n = buildExtractedEvents([US_NEW], () => ({}), OCT, '120D')[0];
    assert.equal(n.taxonomy, 'first_guidance'); assert.equal(n.pipeline!.status, 'QUEUE');
    const low = res({ ...US_RAISED, docId: 'zz-low', rows: [{ ...US_RAISED.rows[0], status: 'LOWERED', low: 400, high: 410, quote: 'Revenue outlook lowered to $400 million to $410 million from $420 million to $440 million.' }] });
    const l = buildExtractedEvents([low], () => ({}), OCT, '120D')[0];
    assert.equal(l.taxonomy, 'downgrade'); assert.equal(l.pipeline!.bucket, 'lowered');
    const np = res({ ...US_RAISED, docId: 'zz-np', rows: [{ ...US_RAISED.rows[0], prior: null }] });
    const x = buildExtractedEvents([np], () => ({}), OCT, '120D')[0];
    assert.notEqual(x.pipeline!.status, 'CARD');
  });
  test('validators still apply: a stale period is never a card', () => {
    const stale = res({ ...US_RAISED, docId: 'zz-stale', rows: [{ ...US_RAISED.rows[0], period: 'FY2024' }], filedAt: '2026-09-30' });
    const e = buildExtractedEvents([stale], () => ({}), OCT, '120D')[0];
    assert.notEqual(e.pipeline!.status, 'CARD'); assert.ok((e.validationIssues || []).some((i) => i.code === 'STALE_PERIOD'));
  });
  test('window is cut on the document date; pipeline partition adds up', () => {
    assert.equal(buildExtractedEvents([MAN_MAY], () => ({}), OCT, '30D').length, 0);
    const evs = buildExtractedEvents([MAN_MAY, MAN_AUG, US_RAISED, US_NEW], () => ({}), OCT, '120D');   // May 27 is outside 120 days of Oct 2
    assert.equal(evs.some((e) => e.ticker === 'MANINDS' && e.announcement_date === '2026-05-27'), false);
    const c = pipelineCounts(evs);
    const sum = c.verifiedUpgrades + c.reiterations + c.mixed + c.lowered + c.firstGuidance + c.invalidOrStale + c.capitalRaise + c.awaitingNumbers + c.unverified + c.nonGuidance;
    assert.equal(sum, c.processed); assert.equal(c.processed, 3); assert.equal(c.cards + c.audit + c.queue + c.dropped, c.processed);
    assert.equal(c.verifiedUpgrades, 1); assert.equal(c.firstGuidance, 1); assert.equal(c.reiterations, 1);
  });
  test('a company-document event replaces the text-derived event of the same company and announcement', () => {
    const doc = buildExtractedEvents([US_RAISED], () => ({}), OCT, '120D')[0];
    const text = { ...doc, guidance_event_id: 'news-1', announcement_date: '2026-08-07', company: 'ZZ Raise Corporation' } as GuidanceEvent;
    const other = { ...doc, guidance_event_id: 'news-2', ticker: 'ZZOTHER', company: 'ZZ Other', announcement_date: '2026-08-07' } as GuidanceEvent;
    const far = { ...doc, guidance_event_id: 'news-3', announcement_date: '2026-07-01' } as GuidanceEvent;
    const m = mergeExtractedEvents([text, other, far], [doc]);
    assert.deepEqual(m.replaced, ['news-1']);
    assert.deepEqual(m.events.map((e) => e.guidance_event_id).sort(), [doc.guidance_event_id, 'news-2', 'news-3'].sort());
  });
  test('skeleton mapping: EBITDA margin -> OP_MARGIN (rate), periods normalised, withdrawn rows skipped', () => {
    const sk = skeletonsFromExtracted([MAN_MAY])[0];
    assert.deepEqual(sk.changes.map((c) => c.metric), ['REVENUE', 'OP_MARGIN']);
    assert.equal(sk.changes[0].after.currency, '₹'); assert.equal(sk.changes[0].after.unit, 'Cr'); assert.equal(sk.changes[1].after.isGrowthRate, true);
    assert.equal(sk.sources[0].tier, 'PRIMARY');
    assert.equal(extractedPeriod('FY2027'), 'FY27'); assert.equal(extractedPeriod('Q3 FY2027'), 'Q3 FY27'); assert.equal(extractedPeriod('FY27-FY29'), 'FY27-29');
    assert.equal(skeletonsFromExtracted([res({ rows: [row({ status: 'WITHDRAWN' })] })]).length, 0);
  });
});

describe('zzz857 reader', () => {
  const store = new Map<string, any>([
    [EXTRACT_INDEX_KEY, ['man-aug', 'man-may', 'zz-raise', 'bad', 'empty']],
    [extractKey('man-aug'), MAN_AUG], [extractKey('man-may'), MAN_MAY], [extractKey('zz-raise'), US_RAISED], [extractKey('bad'), { docId: 'bad' }],
    [extractKey('empty'), res({ docId: 'empty', status: 'no_guidance', rows: [] })],
    [DOCS_INDEX_KEY, { updatedAt: 'x', rows: [{}, {}, {}, {}, {}, {}] }],
    ['enrich:v18:ZZIN', { quarters_sales: [800, 850, 900, 950, 1000], quarters_dates: ['Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026'] }],
  ]);
  const io: ExtractIo = { get: async (k) => store.get(k) ?? null, mget: async (ks) => ks.map((k) => store.get(k) ?? null) };
  test('lists newest first, by market, drops malformed and empty results', async () => {
    const all = await listExtractResults({ io });
    assert.deepEqual(all.results.map((r) => r.docId), ['man-aug', 'zz-raise', 'man-may']);
    assert.equal(all.indexed, 5);
    assert.deepEqual((await listExtractResults({ io, market: 'IN' })).results.map((r) => r.docId), ['man-aug', 'man-may']);
    assert.deepEqual(docIdsOf({ rows: [{ docId: 'a' }, { docId: 'a' }, 'b'] }), ['a', 'b']);
    const broken: ExtractIo = { get: async () => { throw new Error('down'); }, mget: async () => [] };
    const r = await listExtractResults({ io: broken }); assert.equal(r.results.length, 0); assert.match(String(r.error), /down/);
  });
  test('coverage: docs / extracted / rows / lastExtractAt', async () => {
    const x = await loadExtractedForUniverse(io);
    const { quality: _q, ...cov } = x.coverage as any; assert.ok(_q, 'zzz860: data quality is attached'); assert.deepEqual(cov, { docs: 6, extracted: 5, rows: 4, lastExtractAt: '2026-10-02T06:00:00Z' });
    assert.deepEqual(coverageOf(null, [], 0), { docs: 0, extracted: 0, rows: 0, lastExtractAt: null });
  });
  test('prior-year actual from a dated quarterly series (by date, never by position); none when a quarter is missing', async () => {
    assert.equal(fyActualFromDatedSeries([800, 850, 900, 950, 1000], ['Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026'], 'FY26', 'IN'), 3700);
    assert.equal(fyActualFromDatedSeries([850, 900, 1000], ['Jun 2025', 'Sep 2025', 'Mar 2026'], 'FY26', 'IN'), null);
    assert.equal(fyActualFromDatedSeries([1, 2, 3, 4], ['Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025'], 'CY25', 'US'), 10);
    assert.equal(fyActualFromDatedSeries([1, 2, 3, 4], ['Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025'], 'FY25', 'US'), null);
    const zz = res({ docId: 'zzin', ticker: 'ZZIN', company: 'ZZ India', rows: [row({ low: 5000, high: 5000 })] });
    const a = await loadPriorActuals([zz], io);
    assert.equal(a.get(actualKey('IN', 'ZZIN', 'REVENUE', 'FY26'))!.value, 3700);
    // the document's own stated actual wins
    const withPa = res({ docId: 'pa', ticker: 'ZZIN', company: 'ZZ India', rows: [row({ low: 5000, high: 5000, priorActual: { period: 'FY2026', value: 3600, quote: 'FY26 revenue of ₹3,600 crore' } })] });
    assert.equal(actualsFromDocs([withPa]).get(actualKey('IN', 'ZZIN', 'REVENUE', 'FY26'))!.value, 3600);
    assert.equal((await loadPriorActuals([withPa], io)).get(actualKey('IN', 'ZZIN', 'REVENUE', 'FY26'))!.value, 3600);
  });
  test('units and periods', () => {
    assert.equal(universeUnitOf('INR', 'crore'), '₹ Cr'); assert.equal(universeUnitOf('USD', 'million'), '$M'); assert.equal(universeUnitOf('USD', 'billion'), '$B');
    assert.equal(universeUnitOf('USD', 'crore'), null); assert.equal(universeUnitOf(null, '%'), null);
    assert.equal(priorPeriodOf('FY27'), 'FY26'); assert.equal(priorPeriodOf('CY2026'), 'CY25'); assert.equal(priorPeriodOf('Q1 FY27'), null);
  });
});

describe('zzz857 service + route body: sources and extractCoverage, count equations hold', () => {
  test('bundle built from company documents only (live empty) has Man Active and exposes sources / extractCoverage', async () => {
    const b = await getUniverseBundle(Date.now(), true, {
      getLive: async () => ({ all: [], ledger: null, scan: { complete: true, note: 'ok', sources: [] } as any }),
      readStored: async () => null, writeStored: async () => true, kvGet: async () => null, kvSet: async () => undefined, now: () => JUNE, useMemory: false,
      getEventStatuses: async () => ({ statuses: [], source: 'test' }),
      getExtracted: async () => ({ results: [MAN_MAY, US_RAISED], actuals: ACT, coverage: { docs: 10, extracted: 2, rows: 3, lastExtractAt: '2026-10-02T06:00:00Z' } }),
    });
    const body: any = buildUniverseResponse(b, { market: 'IN' });
    assert.ok(body.records.some((r: any) => r.tickers.includes('MANINDS')));
    assert.deepEqual(body.extractCoverage, { docs: 10, extracted: 2, rows: 3, lastExtractAt: '2026-10-02T06:00:00Z' });
    const cd = body.sources.find((s: any) => s.id === 'COMPANY_DOC'); assert.ok(cd); assert.ok(cd.rows >= 2);
    assert.deepEqual(body.invariantViolations, []);
    assert.ok(body.countEquations.active.holds && body.countEquations.rows.holds);
    assert.ok(body.summary.highGrowthGroups.cohorts.ANNUAL.some((r: any) => r.ticker === 'MANINDS'));
  });
  test('an extract read failure never empties the universe', async () => {
    const b = await getUniverseBundle(Date.now(), true, {
      getLive: async () => ({ all: [], ledger: null, scan: { complete: true, note: 'ok', sources: [] } as any }),
      readStored: async () => null, writeStored: async () => true, kvGet: async () => null, kvSet: async () => undefined, now: () => JUNE, useMemory: false,
      getExtracted: async () => { throw new Error('kv down'); },
    });
    const body: any = buildUniverseResponse(b, {});
    assert.ok(body.records.length > 0);
    assert.match(String(body.extractCoverage.error), /kv down/);
  });
});
