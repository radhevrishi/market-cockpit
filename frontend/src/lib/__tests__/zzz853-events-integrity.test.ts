// zzz853 — Guidance Upgrades EVENT engine + SCAN/COVERAGE integrity. Synthetic names only (Zed Alpha, ZZAA ...). No network: every fetcher is injected.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  processCandidates, buildGuidanceEvent, extractGuidance, classifyEvent, contractIsMechanism, extractDriverSentence, DRIVER_NOT_STATED, PRIMARY_NOT_FOUND_TEXT, AUDIT_NOTE, withinWindow,
} from '../guidance-upgrades';
import { nonGuidanceRaiseSentence, sanitizeRaiseCandidate, quarantineUnresolved, newsToCandidate, buildCompanyIndex } from '../guidance-upgrades-candidates';
import { scanIndia, type DayFetcher } from '../guidance-upgrades-scan';
import { buildCoverageCard, checkCoverageCard, sourceRow, windowNoteText } from '../guidance-upgrades-coverage';
import { readNewsWithLastGood, cacheStateText, newsFallbackNote, _resetNewsCacheThrottle, NEWS_KEY, NEWS_LASTGOOD_KEY, NEWS_LASTGOOD_TTL_S, FALLBACK_NEWS_TEXT, type NewsIo } from '../guidance-upgrades-cache';
import {
  priorityOf, enqueue, emptyQueue, selectDue, processQueue, doneCandidates, reportQueue, validateDocument, extractFromDocument, MAX_DOCS_PER_RUN, awaitingCount, type FetchDoc,
} from '../guidance-upgrades-queue';
import { assignEventDates, reconcilePrimary, type PrimaryFiling } from '../guidance-upgrades-sources';
import { computeCounts, checkEventInvariants } from '../guidance-upgrades-counts';
import { raiseVsPreviousText, sourceConflictLine, primaryStateLine, countsLine } from '../guidance-upgrades-format';
import type { GuCandidate, GuContext, GuScanSource, GuScanStatus, GuidanceEvent } from '../guidance-upgrades-types';

const NOW = new Date('2026-09-25T06:00:00Z');   // a Friday
const NSE_URL = 'https://www.nseindia.com/corp/zz-agm-outcome.pdf';
let n = 0;
const mk = (title: string, text: string, o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: `t${++n}`, ticker: 'ZZAA', company: 'Zed Alpha Ltd', market: 'IN', title, text, sourceName: 'Mint', publishedAt: '2026-09-24T07:00:00Z', kind: 'NEWS', url: 'https://www.livemint.com/zz', ...o,
});
const primary = (title: string, text: string, o: Partial<GuCandidate> = {}): GuCandidate => mk(title, text, { sourceName: 'NSE filing', kind: 'FILING', url: NSE_URL, id: `filing:p${++n}`, ...o });
const build = (cs: GuCandidate[], ctx: GuContext = {}): GuidanceEvent => buildGuidanceEvent(cs, ctx, NOW);
const BASE = 'Zed Alpha Ltd now expects revenue of ₹725–750 crore for FY27, up from ₹600 crore earlier. Net profit is now expected at ₹210–225 crore for FY27 versus ₹180 crore earlier.';

// ═══ A. coverage model: contradictions are impossible ═══════════════════════════════════════════════════════════
const src = (o: Partial<GuScanSource> & { name: string }): GuScanSource => ({ state: 'COMPLETE', scanned: 5, detail: 'x', ...o });
const scanOf = (sources: GuScanSource[], extra: Partial<GuScanStatus> = {}): GuScanStatus => ({
  market: 'IN', windowFrom: '2026-09-19', windowTo: '2026-09-25', complete: false, lastScanAt: NOW.toISOString(), sources, daysCovered: 0, daysRequested: 7,
  candidatesFound: 0, processed: 0, awaitingGrading: 0, verified: 0, newestItemAt: null, note: '', ...extra,
});
const DAYS7 = ['2026-09-25', '2026-09-24', '2026-09-23', '2026-09-22', '2026-09-21', '2026-09-20', '2026-09-19'];   // Fri..Sat; 5 weekdays
const card = (sources: GuScanSource[], o: Partial<Parameters<typeof buildCoverageCard>[0]> = {}) =>
  buildCoverageCard({ market: 'IN', window: '7D', windowDays: 7, now: NOW, scan: scanOf(sources), ...o });

describe('A. coverage model', () => {
  test('a failed query is UNKNOWN, never ZERO_RESULTS; EMPTY is never COMPLETE', () => {
    const failed = sourceRow(src({ name: 'NSE announcements', tier: 'PRIMARY', state: 'FAILED', scanned: 0, daysTried: DAYS7, daysOk: [] }));
    assert.equal(failed.queryStatus, 'FAILED'); assert.equal(failed.dataStatus, 'UNKNOWN'); assert.equal(failed.status, 'FAILED');
    const empty = sourceRow(src({ name: 'NSE announcements', tier: 'PRIMARY', state: 'COMPLETE', scanned: 0, daysTried: DAYS7, daysOk: DAYS7 }));
    assert.equal(empty.queryStatus, 'SUCCESS'); assert.equal(empty.dataStatus, 'ZERO_RESULTS'); assert.equal(empty.status, 'EMPTY'); assert.notEqual(empty.status, 'COMPLETE');
    const ok = sourceRow(src({ name: 'NSE announcements', tier: 'PRIMARY', daysTried: DAYS7, daysOk: DAYS7 }));
    assert.equal(ok.status, 'COMPLETE'); assert.equal(ok.dataStatus, 'DATA_FOUND');
    const na = sourceRow(src({ name: 'Persisted event store', tier: 'SECONDARY', state: 'NOT_AVAILABLE', scanned: 0 }));
    assert.equal(na.queryStatus, 'NOT_AVAILABLE'); assert.equal(na.dataStatus, 'UNKNOWN');
  });
  test('every primary answers every day -> COMPLETE, read + partial + failed === attempted', () => {
    const c = card([src({ name: 'NSE announcements', tier: 'PRIMARY', daysTried: DAYS7, daysOk: DAYS7 }), src({ name: 'BSE announcements', tier: 'PRIMARY', daysTried: DAYS7, daysOk: DAYS7 })]);
    assert.equal(c.tradingDays, 5); assert.equal(c.daysAttempted, 5); assert.equal(c.daysSuccessfullyRead, 5);
    assert.equal(c.daysSuccessfullyRead + c.daysPartialCoverage + c.daysFailed, c.daysAttempted);
    assert.equal(c.overall, 'COMPLETE'); assert.deepEqual(checkCoverageCard(c), []);
  });
  test('NSE answers, BSE fails: the day is PARTIAL, never covered; overall PARTIAL', () => {
    const c = card([src({ name: 'NSE announcements', tier: 'PRIMARY', daysTried: DAYS7, daysOk: DAYS7 }), src({ name: 'BSE announcements', tier: 'PRIMARY', state: 'FAILED', scanned: 0, daysTried: DAYS7, daysOk: [], failReasons: ['HTTP 403'] })]);
    assert.equal(c.daysSuccessfullyRead, 0); assert.equal(c.daysPrimaryPartial, 5); assert.equal(c.daysPartialCoverage, 5); assert.equal(c.overall, 'PARTIAL');
    assert.match(c.partialLabel ?? '', /partial coverage/); assert.deepEqual(checkCoverageCard(c), []);
    assert.equal(c.sources.find((s) => s.name.startsWith('BSE'))!.dataStatus, 'UNKNOWN');
  });
  test('a fallback / blob day is labelled partial coverage and never covered; both primaries failed -> FAILED', () => {
    const c = card([
      src({ name: 'NSE announcements', tier: 'PRIMARY', state: 'FAILED', scanned: 0, daysTried: DAYS7, daysOk: [] }),
      src({ name: 'BSE announcements', tier: 'PRIMARY', state: 'FAILED', scanned: 0, daysTried: DAYS7, daysOk: [] }),
      src({ name: 'Scraped filings blob', tier: 'FALLBACK', scanned: 9, daysTried: DAYS7, daysOk: DAYS7 }),
    ]);
    assert.equal(c.daysSuccessfullyRead, 0); assert.equal(c.daysFallbackOnly, 5); assert.equal(c.daysPartialCoverage, 5); assert.equal(c.daysFailed, 0);
    assert.equal(c.overall, 'FAILED'); assert.deepEqual(checkCoverageCard(c), []);
    assert.match(c.headline, /says nothing about whether events exist/);
  });
  test('documents awaiting grading stop COMPLETE; an EMPTY primary stops COMPLETE', () => {
    const full = [src({ name: 'NSE announcements', tier: 'PRIMARY', daysTried: DAYS7, daysOk: DAYS7 }), src({ name: 'BSE announcements', tier: 'PRIMARY', daysTried: DAYS7, daysOk: DAYS7 })];
    const a = card(full, { documentsAwaitingGrading: 3, candidatesDiscovered: 3 });
    assert.equal(a.overall, 'PARTIAL'); assert.equal(a.documentsAwaitingGrading, 3); assert.equal(a.verified, 0);
    const e = card([src({ name: 'NSE announcements', tier: 'PRIMARY', scanned: 0, daysTried: DAYS7, daysOk: DAYS7 }), full[1]]);
    assert.equal(e.overall, 'PARTIAL'); assert.deepEqual(checkCoverageCard(e), []);
  });
  test('the checker catches a hand-built contradiction', () => {
    const c = card([src({ name: 'NSE announcements', tier: 'PRIMARY', state: 'FAILED', scanned: 0, daysTried: DAYS7, daysOk: [] })]);
    assert.deepEqual(checkCoverageCard(c), []);
    const bad = { ...c, overall: 'COMPLETE' as const, daysSuccessfullyRead: 7 };
    assert.ok(checkCoverageCard(bad).length >= 2);
    const zero = { ...c, sources: c.sources.map((s) => ({ ...s, dataStatus: 'ZERO_RESULTS' as const })) };
    assert.ok(checkCoverageCard(zero).some((m) => /failed but is reported as zero/.test(m)));
  });
  test('scanIndia end to end with injected feeds: BSE failing gives partial days, never "7 of 7 covered"', async () => {
    const ok: DayFetcher = async () => ({ ok: true, filings: [{ exchange: 'NSE', symbol: 'ZZAA', company_name: 'Zed Alpha Ltd', subject: 'Board meeting', filing_datetime: '2026-09-24T10:00:00+05:30' } as any] });
    const bad: DayFetcher = async () => ({ ok: false, filings: [], reason: 'HTTP 403' });
    const res = await scanIndia({ now: NOW, days: 7, window: '7D', fetchNse: ok, fetchBse: bad, budgetMs: 4_000 });
    const c = buildCoverageCard({ market: 'IN', window: '7D', windowDays: 7, now: NOW, scan: res.status });
    assert.equal(c.daysSuccessfullyRead, 0); assert.ok(c.daysPrimaryPartial > 0); assert.equal(c.overall, 'PARTIAL');
    assert.deepEqual(checkCoverageCard(c), []);
    const bse = c.sources.find((s) => s.name.startsWith('BSE'))!; assert.equal(bse.queryStatus, 'FAILED'); assert.notEqual(bse.dataStatus, 'ZERO_RESULTS');
  });
  test('the 14-day vs 7-day window mismatch is explained, and both markets share the requested window', () => {
    const t = windowNoteText('7D', 7);
    assert.match(t, /7D window/); assert.match(t, /14-day/); assert.match(t, /announcement date only/);
    const inC = card([src({ name: 'NSE announcements', tier: 'PRIMARY', daysTried: DAYS7, daysOk: DAYS7 })]);
    const usC = buildCoverageCard({ market: 'US', window: '7D', windowDays: 7, now: NOW, scan: scanOf([src({ name: 'SEC EDGAR 8-K (items 2.02/7.01)', tier: 'PRIMARY', daysTried: DAYS7.slice(0, 5), daysOk: DAYS7.slice(0, 5) })], { market: 'US' }) });
    assert.equal(inC.windowDays, usC.windowDays); assert.equal(inC.requestedWindow, usC.requestedWindow);
  });
});

// ═══ B. cache: miss vs empty vs failed; last-good ═══════════════════════════════════════════════════════════════
const memIo = (store: Record<string, any>, o: { failLive?: boolean; sets?: any[] } = {}): NewsIo => ({
  now: () => NOW.getTime(),
  async get(key) { if (o.failLive && key === NEWS_KEY) return { value: null, failed: true }; return { value: store[key] ?? null }; },
  async set(key, value, ttl) { store[key] = value; o.sets?.push({ key, ttl, value }); },
});
describe('B. cache wording and last-good fallback', () => {
  beforeEach(() => _resetNewsCacheThrottle());
  test('three different wordings for miss / empty / failed', () => {
    const miss = cacheStateText('CACHE_MISS', NEWS_KEY); const empty = cacheStateText('SOURCE_EMPTY', NEWS_KEY); const fail = cacheStateText('FETCH_FAILED', NEWS_KEY);
    assert.match(miss, /CACHE MISS/); assert.match(miss, /says nothing about investment data/);
    assert.match(empty, /SOURCE EMPTY/); assert.match(empty, /zero items/);
    assert.match(fail, /FETCH FAILED/); assert.match(fail, /unknown, not zero/);
    assert.ok(new Set([miss, empty, fail]).size === 3);
    assert.ok(!/expires after 5 minutes/.test(miss));
  });
  test('a live hit writes a 24h last-good copy; later a miss is served from it', async () => {
    const store: Record<string, any> = { [NEWS_KEY]: [{ id: 'a1', title: 'Zed Alpha raises FY27 guidance', published_at: '2026-09-24T07:00:00Z' }] };
    const sets: any[] = [];
    const live = await readNewsWithLastGood(memIo(store, { sets })); await live.wrote;
    assert.equal(live.servedBy, 'LIVE'); assert.equal(sets.length, 1); assert.equal(sets[0].key, NEWS_LASTGOOD_KEY); assert.equal(sets[0].ttl, NEWS_LASTGOOD_TTL_S); assert.equal(NEWS_LASTGOOD_TTL_S, 86_400);
    delete store[NEWS_KEY];
    const miss = await readNewsWithLastGood(memIo(store));
    assert.equal(miss.servedBy, 'LASTGOOD'); assert.equal(miss.liveState, 'CACHE_MISS'); assert.equal(miss.articles!.length, 1); assert.match(miss.row.text, /last good copy/);
    assert.equal(newsFallbackNote(miss, 0).note?.includes('last good copy'), true);
  });
  test('nothing anywhere: CACHE_MISS / SOURCE_EMPTY / FETCH_FAILED are reported apart', async () => {
    const miss = await readNewsWithLastGood(memIo({})); assert.equal(miss.articles, null); assert.equal(miss.row.state, 'CACHE_MISS');
    const empty = await readNewsWithLastGood(memIo({ [NEWS_KEY]: [] })); assert.equal(empty.row.state, 'SOURCE_EMPTY');
    const failed = await readNewsWithLastGood(memIo({}, { failLive: true })); assert.equal(failed.row.state, 'FETCH_FAILED'); assert.match(failed.row.text, /unknown, not zero/);
  });
  test('the fallback sentence appears only when it is true, and names the source that supplied data', () => {
    assert.equal(newsFallbackNote({ servedBy: 'LIVE', liveState: 'HIT' }, 40).note, null);
    const f = newsFallbackNote({ servedBy: 'NONE', liveState: 'CACHE_MISS' }, 40);
    assert.equal(f.note, 'Primary news cache unavailable; fallback scraped feed active.'); assert.equal(f.note, FALLBACK_NEWS_TEXT); assert.match(f.suppliedBy, /Scraped India news/);
    const none = newsFallbackNote({ servedBy: 'NONE', liveState: 'CACHE_MISS' }, 0);
    assert.ok(!/fallback scraped feed active/.test(none.note ?? '')); assert.equal(none.suppliedBy, 'none');
  });
});

// ═══ C. queue ═══════════════════════════════════════════════════════════════════════════════════════════════════
const DOC_OK = `Zed Alpha Ltd — Investor Presentation, September 2026. Zed Alpha Ltd now expects revenue of ₹725–750 crore for FY27, up from ₹600 crore earlier. Net profit is now expected at ₹210–225 crore for FY27 versus ₹180 crore earlier. Management commentary on the order pipeline, capacity and exports follows in the next slides of this presentation.`;
const DOC_NO_PERIOD = `Zed Alpha Ltd — Investor Presentation 2026. The company expects revenue guidance of ₹750 crore with healthy margins and a strong pipeline of orders across all of its segments, as discussed by the management team during the presentation to analysts today.`;
const input = (o: Record<string, any> = {}) => ({ market: 'IN' as const, ticker: 'ZZAA', company: 'Zed Alpha Ltd', sourceUrl: NSE_URL, sourceType: 'NSE', subject: 'Investor Presentation', eventDate: '2026-09-22', ...o });
const docs = (m: Record<string, any>): FetchDoc => async (url) => (m[url] ?? { ok: false, text: '', status: 500, reason: 'HTTP 500' });
const okDoc = (text: string) => ({ ok: true, status: 200, contentType: 'application/pdf', text });

describe('C. queue', () => {
  test('priority: guidance wording P0, results / presentation P1, anything else P2', () => {
    assert.equal(priorityOf('Raises FY27 revenue guidance'), 'P0'); assert.equal(priorityOf('Outlook for FY27'), 'P0');
    assert.equal(priorityOf('Investor Presentation'), 'P1'); assert.equal(priorityOf('Press Release'), 'P1'); assert.equal(priorityOf('Change in registrar'), 'P2');
  });
  test('record fields, idempotent enqueue, a null URL is never due and never says it is found', () => {
    const t0 = enqueue(emptyQueue(NOW), [input({ priority: 'P0' }), input(), input({ sourceUrl: null, subject: 'AGM outcome', ticker: 'ZZBB', company: 'Zed Beta Ltd' })], NOW);
    assert.equal(t0.added, 2); assert.equal(t0.queue.items.length, 2);
    const it = t0.queue.items.find((x) => x.source_url)!;
    for (const k of ['discovered_at', 'priority', 'company_id', 'ticker', 'market', 'source_url', 'source_type', 'processing_status', 'attempt_count', 'last_error', 'next_attempt'] as const) assert.ok(k in it, k);
    assert.equal(it.priority, 'P0'); assert.equal(it.processing_status, 'QUEUED'); assert.equal(it.attempt_count, 0);
    assert.equal(selectDue(t0.queue, NOW).length, 1, 'only the item with a URL is due');
    assert.equal(enqueue(t0.queue, [input()], NOW).added, 0);
  });
  test('P0 first, newest first inside a priority, at most 12 per run', () => {
    const inputs = [
      ...Array.from({ length: 10 }, (_, i) => input({ ticker: `ZP${i}`, company: `Zed P${i} Ltd`, sourceUrl: `https://x.test/p2-${i}.pdf`, subject: 'Change in registrar', eventDate: '2026-09-20' })),
      input({ ticker: 'ZPA', company: 'Zed PA Ltd', sourceUrl: 'https://x.test/a.pdf', subject: 'Raises FY27 guidance', eventDate: '2026-09-18' }),
      input({ ticker: 'ZPB', company: 'Zed PB Ltd', sourceUrl: 'https://x.test/b.pdf', subject: 'Raises FY27 guidance', eventDate: '2026-09-23' }),
      input({ ticker: 'ZPC', company: 'Zed PC Ltd', sourceUrl: 'https://x.test/c.pdf', subject: 'Investor Presentation', eventDate: '2026-09-24' }),
    ];
    const q = enqueue(emptyQueue(NOW), inputs, NOW).queue;
    const due = selectDue(q, NOW);
    assert.equal(due.length, MAX_DOCS_PER_RUN); assert.equal(MAX_DOCS_PER_RUN, 12);
    assert.deepEqual(due.slice(0, 3).map((x) => x.ticker), ['ZPB', 'ZPA', 'ZPC']);
  });
  test('backoff 10 min, 2 h, then SOURCE_UNAVAILABLE; a 404 is unavailable at once', async () => {
    let q = enqueue(emptyQueue(NOW), [input()], NOW).queue;
    const fail = docs({});
    let t = NOW;
    let r = await processQueue(q, { now: t, fetchDoc: fail }); q = r.queue;
    let it = q.items[0]; assert.equal(it.processing_status, 'FAILED'); assert.equal(it.attempt_count, 1); assert.match(it.last_error ?? '', /500/);
    assert.equal(Date.parse(it.next_attempt!) - t.getTime(), 10 * 60_000);
    assert.equal(selectDue(q, new Date(t.getTime() + 5 * 60_000)).length, 0, 'not due before the backoff ends');
    t = new Date(t.getTime() + 11 * 60_000);
    r = await processQueue(q, { now: t, fetchDoc: fail }); q = r.queue; it = q.items[0];
    assert.equal(it.attempt_count, 2); assert.equal(Date.parse(it.next_attempt!) - t.getTime(), 120 * 60_000);
    t = new Date(t.getTime() + 121 * 60_000);
    r = await processQueue(q, { now: t, fetchDoc: fail }); q = r.queue; it = q.items[0];
    assert.equal(it.processing_status, 'SOURCE_UNAVAILABLE'); assert.equal(it.attempt_count, 3);
    assert.equal(selectDue(q, new Date(t.getTime() + 60 * 60_000)).length, 0);
    const nf = await processQueue(enqueue(emptyQueue(NOW), [input({ sourceUrl: 'https://x.test/gone.pdf' })], NOW).queue, { now: NOW, fetchDoc: docs({ 'https://x.test/gone.pdf': { ok: false, status: 404, text: '', reason: 'HTTP 404' } }) });
    assert.equal(nf.queue.items[0].processing_status, 'SOURCE_UNAVAILABLE');
  });
  test('validation: HTTP success, content type, company and a date must all be present', () => {
    const it = { company: 'Zed Alpha Ltd', ticker: 'ZZAA' };
    assert.equal(validateDocument(okDoc(DOC_OK), it), null);
    assert.ok(validateDocument({ ok: false, status: 500, text: '', reason: 'HTTP 500' }, it));
    assert.ok(validateDocument({ ok: true, status: 200, contentType: 'image/png', text: DOC_OK }, it));
    assert.ok(validateDocument(okDoc(DOC_OK.replace(/Zed Alpha/g, 'Someone Else')), it), 'a document that does not name the company is rejected');
    assert.ok(validateDocument(okDoc('Zed Alpha Ltd short'), it));
  });
  test('extraction upgrades a candidate only when company + metric + period + value are all read', () => {
    const base = { id: 'q1', ticker: 'ZZAA', company: 'Zed Alpha Ltd', market: 'IN' as const, source_url: NSE_URL, source_type: 'NSE', subject: 'Investor Presentation', event_date: '2026-09-22' };
    const ok = extractFromDocument(DOC_OK, base);
    assert.equal(ok.complete, true); assert.ok(ok.candidate); assert.equal(ok.candidate!.kind === 'DECK' || ok.candidate!.kind === 'FILING', true);
    const noPeriod = extractFromDocument(DOC_NO_PERIOD, base);
    assert.equal(noPeriod.complete, false); assert.equal(noPeriod.candidate, null);
    const noValue = extractFromDocument('Zed Alpha Ltd presentation for FY27. The company discussed revenue and margins in general terms with analysts and investors during the call and gave no figures at all for the year ahead, only commentary.', base);
    assert.equal(noValue.complete, false); assert.equal(noValue.candidate, null);
  });
  test('a read document becomes a VERIFIED event only through the engine; a partial read stays unverified / absent', async () => {
    const q0 = enqueue(emptyQueue(NOW), [input(), input({ ticker: 'ZZBB', company: 'Zed Beta Ltd', sourceUrl: 'https://x.test/b.pdf', eventDate: '2026-09-23' })], NOW).queue;
    const r = await processQueue(q0, { now: NOW, fetchDoc: docs({ [NSE_URL]: okDoc(DOC_OK), 'https://x.test/b.pdf': okDoc(DOC_NO_PERIOD.replace(/Zed Alpha/g, 'Zed Beta')) }) });
    assert.equal(r.done, 2); assert.equal(r.complete, 1);
    const cs = doneCandidates(r.queue); assert.equal(cs.length, 1);
    const ev = processCandidates(cs, () => ({}), NOW, '30D');
    assert.equal(ev.length, 1); assert.equal(ev[0].verification, 'VERIFIED'); assert.equal(ev[0].displayLabel, 'GUIDANCE UPGRADE');
    assert.equal(ev[0].ticker, 'ZZAA');
    const rep = reportQueue(r.queue, { processed: r.done, verified: r.complete, failed: 0 });
    assert.equal(rep.done, 2); assert.equal(rep.processedThisRun, 2); assert.equal(rep.verifiedThisRun, 1);
  });
  test('the run is bounded: unfinished documents stay queued, never lost', async () => {
    const inputs = Array.from({ length: 20 }, (_, i) => input({ ticker: `ZQ${i}`, company: `Zed Q${i} Ltd`, sourceUrl: `https://x.test/${i}.pdf`, subject: 'Raises FY27 guidance' }));
    const q = enqueue(emptyQueue(NOW), inputs, NOW).queue;
    const r = await processQueue(q, { now: NOW, fetchDoc: docs({}) });
    assert.ok(r.attempted <= 12);
    assert.equal(r.queue.items.length, 20); assert.ok(awaitingCount(r.queue, 'IN') >= 8);
  });
});

// ═══ D. source reconciliation ════════════════════════════════════════════════════════════════════════════════════
const media = () => mk('Zed Alpha raises FY27 revenue, profit guidance at 33rd AGM', BASE);
const filing = (o: Partial<PrimaryFiling> = {}): PrimaryFiling => ({ market: 'IN', ticker: 'ZZAA', company: 'Zed Alpha Ltd', subject: 'Outcome of 33rd Annual General Meeting', date: '2026-09-22', url: NSE_URL, exchange: 'NSE', ...o });

describe('D. primary source reconciliation', () => {
  test('a filing within 10 days is attached: PRIMARY SOURCE FOUND, queued P0, announcement date = filing date, media date kept', () => {
    const e0 = build([media()]); assert.equal(e0.verification, 'UNVERIFIED');
    const r = reconcilePrimary([e0], [filing()]);
    const e = r.events[0];
    assert.equal(r.found, 1); assert.equal(e.primaryState, 'PRIMARY_SOURCE_FOUND'); assert.equal(e.primaryStateText, 'PRIMARY SOURCE FOUND'); assert.equal(e.primarySourceUrl, NSE_URL);
    assert.equal(e.announcement_date, '2026-09-22'); assert.equal(e.media_date, '2026-09-24');
    assert.equal(r.queueInputs.length, 1); assert.equal(r.queueInputs[0].priority, 'P0'); assert.equal(r.queueInputs[0].sourceUrl, NSE_URL);
    const all = [e.primaryStateText, ...e.evidenceGaps, ...e.nextEvidence].join(' | ');
    assert.ok(!/awaiting primary source/i.test(all), 'a known URL never reads "Awaiting primary source"');
    assert.ok(e.nextEvidence.some((x) => /queued for automated reading/.test(x))); assert.ok(!e.nextEvidence.some((x) => /^Open the/.test(x)));
    assert.equal(e.verification, 'UNVERIFIED', 'finding the document is not reading it');
    assert.equal(e.displayLabel, 'UNVERIFIED CLAIM');
  });
  test('"Awaiting primary source" only when the URL is null', () => {
    const r = reconcilePrimary([build([media()])], [filing({ url: null })]);
    assert.equal(r.events[0].primaryState, 'AWAITING_PRIMARY_SOURCE'); assert.equal(r.events[0].primaryStateText, 'Awaiting primary source');
    assert.equal(primaryStateLine(r.events[0]), 'Awaiting primary source');
    const found = reconcilePrimary([build([media()])], [filing()]).events[0];
    assert.match(primaryStateLine(found)!, /^PRIMARY SOURCE FOUND/);
  });
  test('no filing within 10 days (or another company, or a non-guidance subject): SECONDARY-SOURCE CLAIM + the exact not-found text', () => {
    for (const pool of [[filing({ date: '2026-09-05' })], [filing({ ticker: 'ZZBB', company: 'Zed Beta Ltd' })], [filing({ subject: 'Change in registrar address' })], []]) {
      const e = reconcilePrimary([build([media()])], pool).events[0];
      assert.equal(e.primaryState, 'SECONDARY_SOURCE_CLAIM'); assert.equal(e.primaryStateText, 'SECONDARY-SOURCE CLAIM');
      assert.ok(e.evidenceGaps.includes(PRIMARY_NOT_FOUND_TEXT)); assert.equal(PRIMARY_NOT_FOUND_TEXT, 'Primary source: not found in the filings read so far');
      assert.match(primaryStateLine(e)!, /Primary source: not found in the filings read so far/);
    }
  });
  test('primary and media disagree: both kept side by side, shown as "Primary source: X; Media claim: Y", never averaged', () => {
    const p = primary('Zed Alpha raises FY27 guidance', 'Zed Alpha Ltd now expects revenue of ₹725–750 crore for FY27, up from ₹600 crore earlier.', { publishedAt: '2026-09-22T10:00:00Z' });
    const m = mk('Zed Alpha lifts FY27 revenue target', 'Zed Alpha Ltd now expects revenue of ₹800–850 crore for FY27, up from ₹600 crore earlier.', { publishedAt: '2026-09-23T07:00:00Z' });
    const e = build([p, m]);
    assert.ok(e.sourceConflict, 'a conflict is recorded'); assert.equal(e.verification, 'VERIFIED');
    const line = sourceConflictLine(e)!;
    assert.match(line, /^Primary source: .*725.*750.*; Media claim: .*800.*850/);
    assert.ok(e.sources.every((s) => s.claims === undefined || s.claims.length > 0)); assert.ok(e.sources.some((s) => s.claims?.some((c) => c.low === 800)));
    assert.equal(e.changes[0].after.low, 725, 'the engine numbers come from the primary source');
    assert.ok(e.evidenceGaps[0].startsWith('Source conflict'));
  });
  test('Cupid-type numbers: revenue 600 -> 725-750 is +22.9%, net profit 180 -> 210-225 is +20.8% "raise vs previous guidance"', () => {
    const e = build([primary('Zed Alpha raises FY27 guidance', BASE)]);
    const t = e.changes.map(raiseVsPreviousText);
    assert.ok(t.includes('+22.9% raise vs previous guidance')); assert.ok(t.includes('+20.8% raise vs previous guidance'));
    assert.equal(e.classification, 'RAISE'); assert.equal(e.displayLabel, 'GUIDANCE UPGRADE');
  });
});

// ═══ E. labels ══════════════════════════════════════════════════════════════════════════════════════════════════
describe('E. labels follow the numbers', () => {
  test('GUIDANCE UPGRADE only for a verified RAISE; the same numbers from media only are UNVERIFIED CLAIM', () => {
    const v = build([primary('Zed Alpha raises FY27 guidance', BASE)]); const u = build([media()]);
    assert.equal(v.displayLabel, 'GUIDANCE UPGRADE'); assert.equal(v.isUpgrade, true); assert.equal(v.auditOnly, false);
    assert.equal(u.displayLabel, 'UNVERIFIED CLAIM'); assert.equal(u.verification, 'UNVERIFIED');
  });
  test('REITERATION and MIXED / RANGE CHANGE are never upgrades', () => {
    const re = build([primary('Zed Alpha reiterates FY27 guidance', 'Zed Alpha Ltd reiterates FY27 revenue growth guidance of 13%, unchanged from 13% earlier.')]);
    assert.equal(re.classification, 'REITERATION'); assert.equal(re.displayLabel, 'REITERATION'); assert.equal(re.isUpgrade, false);
    const fu = build([primary('Zed Alpha raises FY26 adjusted EPS guidance', 'Zed Alpha Ltd now expects Adjusted EPS for FY26 of $4.70–4.85, up from $4.60–4.90 previously.', { market: 'US', ticker: 'ZZUS' })]);
    assert.equal(fu.displayLabel, 'MIXED / RANGE CHANGE'); assert.equal(fu.isUpgrade, false);
  });
  test('Fuller-style: a "raise" headline over a narrowed range is auditOnly with the exact explanation', () => {
    const fu = build([primary('Zed Alpha raises FY26 adjusted EPS guidance', 'Zed Alpha Ltd now expects Adjusted EPS for FY26 of $4.70–4.85, up from $4.60–4.90 previously.', { market: 'US', ticker: 'ZZUS' })]);
    assert.equal(fu.auditOnly, true); assert.equal(fu.auditNote, 'Adjusted: headline described a raise; normalised guidance did not constitute a clean raise.'); assert.equal(fu.auditNote, AUDIT_NOTE);
    assert.notEqual(fu.classification, 'RAISE');
  });
  test('no before / after numbers: a detected claim is not an upgrade', () => {
    const e = build([mk('Zed Alpha raises guidance', 'Zed Alpha Ltd raised its guidance at the AGM today, management said.')]);
    assert.notEqual(e.displayLabel, 'GUIDANCE UPGRADE'); assert.equal(e.isUpgrade, false);
  });
});

// ═══ F. dates and windows ═══════════════════════════════════════════════════════════════════════════════════════
describe('F. event date = company announcement date', () => {
  const OLD = '2026-07-07T10:00:00Z';   // 80 days before NOW
  const old = () => primary('Zed Alpha raises FY27 guidance', BASE, { publishedAt: OLD });
  const repub = () => mk('Zed Alpha raises FY27 guidance (republished)', BASE, { publishedAt: '2026-09-25T05:00:00Z', url: 'https://www.livemint.com/zz2' });
  test('an 80-day-old event is in 120D, not 30D / 7D, even when a media article is republished today', () => {
    const dated = assignEventDates([old(), repub()]);
    assert.equal(dated.reassigned, 1); assert.equal(dated.cands[1].eventDate, '2026-07-07'); assert.equal(dated.cands[1].publishedAt, '2026-09-25T05:00:00Z', 'the media date is kept');
    const run = (w: any) => processCandidates(dated.cands, () => ({}), NOW, w);
    assert.equal(run('7D').length, 0); assert.equal(run('30D').length, 0);
    const e120 = run('120D'); assert.equal(e120.length, 1);
    assert.equal(e120[0].announcement_date, '2026-07-07'); assert.equal(e120[0].media_date, '2026-09-25'); assert.equal(e120[0].dateBasis, 'ANNOUNCEMENT');
  });
  test('control: without the event date the republished article would wrongly appear in 7D', () => {
    assert.equal(processCandidates([old(), repub()], () => ({}), NOW, '7D').length >= 1, true);
  });
  test('a fresh event stays in every window it belongs to; windows use the announcement date', () => {
    const fresh = primary('Zed Alpha raises FY27 guidance', BASE, { publishedAt: '2026-09-24T10:00:00Z' });
    for (const w of ['3D', '7D', '30D', '120D'] as const) assert.equal(processCandidates([fresh], () => ({}), NOW, w).length, 1, w);
    assert.equal(withinWindow('2026-07-07', '30D', NOW), false); assert.equal(withinWindow('2026-07-07', '120D', NOW), true);
  });
  test('a media-only candidate near a raise-bearing filing takes the filing date (+-10 days)', () => {
    const f = primary('Outcome of 33rd Annual General Meeting', 'Outcome of AGM.', { publishedAt: '2026-09-18T10:00:00Z' });
    const m = mk('Zed Alpha raises FY27 guidance', BASE, { publishedAt: '2026-09-24T07:00:00Z' });
    assert.equal(assignEventDates([f, m]).cands[1].eventDate, '2026-09-18');
    const far = primary('Outcome of 33rd Annual General Meeting', 'Outcome of AGM.', { publishedAt: '2026-08-01T10:00:00Z' });
    assert.equal(assignEventDates([far, m]).cands[1].eventDate, undefined);
  });
});

// ═══ G. why-now driver, durability, next evidence ═══════════════════════════════════════════════════════════════
describe('G. driver and durability come from the text only', () => {
  test('driver sentence from the text, else "Driver not stated"', () => {
    const d = build([primary('Zed Alpha raises FY27 guidance', `${BASE} The raise is driven by strong demand from export customers and a full order book.`)]);
    assert.match(d.whyNowDriver ?? '', /strong demand|order book/i);
    const none = build([primary('Zed Alpha raises FY27 guidance', BASE)]);
    assert.equal(none.whyNowDriver, DRIVER_NOT_STATED); assert.equal(DRIVER_NOT_STATED, 'Driver not stated');
    assert.equal(extractDriverSentence('Nothing relevant here at all.'), null);
  });
  test('"Several years" only when the contract / backlog is the stated mechanism of the guided metric', () => {
    assert.equal(contractIsMechanism('The multi-year order backlog of ₹5,000 crore supports the higher FY27 revenue guidance as it converts into sales.'), true);
    assert.equal(contractIsMechanism('Zed Alpha signed a multi-year contract with a vendor for office cleaning. Revenue guidance for FY27 was raised.'), false);
    const mech = build([primary('Zed Alpha raises FY27 guidance', `${BASE} The multi-year order backlog supports the higher revenue guidance as it converts into sales over three years.`)]);
    const generic = build([primary('Zed Alpha raises FY27 guidance', `${BASE} Zed Alpha also signed a multi-year lease for a new office. Management is optimistic about the next few years.`)]);
    assert.equal(mech.duration, 'MULTI_YEAR'); assert.notEqual(generic.duration, 'MULTI_YEAR');
  });
  test('once VERIFIED, the next evidence is tied to the guided metric and range', () => {
    const e = build([primary('Zed Alpha raises FY27 guidance', `${BASE} The raise is driven by strong demand from export customers.`)]);
    assert.equal(e.verification, 'VERIFIED');
    assert.ok(e.nextEvidence.some((x) => /confirmation of progress toward the guided revenue .*725.*750.*FY27/.test(x)), e.nextEvidence.join(' | '));
  });
});

// ═══ H. price never changes the classification or the materiality ═══════════════════════════════════════════════
describe('H. price independence', () => {
  test('changing the price context (PE, market cap, 7-day move) never changes label, classification, materiality or auditOnly', () => {
    const variants: GuContext[] = [{}, { priceContext: { pe: 8, move7dPct: -30 } }, { priceContext: { pe: 90, marketCap: 1e9, move7dPct: 60, evEbitda: 80, fcfYield: 0.1 } }];
    for (const text of [BASE, 'Zed Alpha Ltd reiterates FY27 revenue growth guidance of 13%, unchanged from 13% earlier.', 'Zed Alpha Ltd now expects Adjusted EPS for FY26 of $4.70–4.85, up from $4.60–4.90 previously.']) {
      const evs = variants.map((ctx) => build([primary('Zed Alpha raises FY27 guidance', text)], ctx));
      for (const e of evs) { assert.equal(e.classification, evs[0].classification); assert.equal(e.displayLabel, evs[0].displayLabel); assert.equal(e.materiality, evs[0].materiality); assert.equal(e.auditOnly, evs[0].auditOnly); assert.equal(e.isUpgrade, evs[0].isUpgrade); }
    }
  });
});

// ═══ the 8 owner regression cases ═══════════════════════════════════════════════════════════════════════════════
describe('Owner regression cases', () => {
  test('1. 119-139 -> 141-158 is a clean raise', () => {
    const e = build([primary('Zed Alpha raises FY27 outlook', 'Zed Alpha Ltd now expects adjusted EBITDA of $141–158 million for FY27, up from $119–139 million earlier.')]);
    assert.equal(e.classification, 'RAISE'); assert.equal(e.v2!.ranges[0].klass, 'CLEAN_RAISE');
  });
  test('2. 13% -> 13% is a reiteration, not a raise', () => {
    const e = build([primary('Zed Alpha raises guidance', 'Zed Alpha Ltd reiterates FY27 revenue growth guidance of 13%, unchanged from 13% earlier.')]);
    assert.equal(e.classification, 'REITERATION'); assert.notEqual(e.displayLabel, 'GUIDANCE UPGRADE');
  });
  test('3. 4.60-4.90 -> 4.70-4.85 is not a clean raise', () => {
    const e = build([primary('Zed Alpha raises FY26 EPS guidance', 'Zed Alpha Ltd now expects Adjusted EPS for FY26 of $4.70–4.85, up from $4.60–4.90 previously.')]);
    assert.notEqual(e.classification, 'RAISE'); assert.equal(e.auditOnly, true);
  });
  test('4. a Rs13,000 Cr bond is not guidance', () => {
    assert.equal(nonGuidanceRaiseSentence('Zed Alpha raises Rs 13,000 crore via bonds'), true);
    const c = mk('Zed Alpha raises Rs 13,000 crore via bonds', 'Zed Alpha Ltd raises Rs 13,000 crore via bonds for FY27 expansion.');
    assert.equal(sanitizeRaiseCandidate(c), null);
  });
  test('5. a generic consumer-goods headline stays unresolved (no company event)', () => {
    const idx = buildCompanyIndex([{ symbol: 'ZZIN2', name: 'Zed Two Limited' }]);
    const c = newsToCandidate({ id: 'et-9', title: 'Buoyant Q2 demand for consumer goods lifts FY27 revenue outlook, company raises guidance', summary: '', source_name: 'ET Companies', source_url: 'https://example.test/z', published_at: '2026-09-24T07:00:00.000Z', region: 'IN' }, idx)!;
    const q = quarantineUnresolved([c]); assert.equal(q.kept.length, 0); assert.equal(q.unresolved.length, 1);
  });
  test('6. Rs100 -> Rs160 is a derived +60%', () => {
    const c = extractGuidance('Zed Alpha raises FY27 revenue guidance to Rs 160 crore from Rs 100 crore.')[0];
    assert.equal(c.percentageChange, 60); assert.equal(raiseVsPreviousText(c), '+60% raise vs previous guidance');
  });
  test('7. Q4 with no year: the period is unclear and the event says so', () => {
    const e = build([primary('Zed Alpha raises guidance', 'Zed Alpha raises Q4 revenue guidance to Rs 160 crore from Rs 100 crore.')]);
    assert.equal(e.changes[0].after.period, 'UNSTATED'); assert.ok(e.evidenceGaps.some((g) => /period unclear/i.test(g)));
  });
  test('8. 30-35% over FY27-FY29 is a 3-year CAGR, not a single-year figure', () => {
    const c = extractGuidance('Zed Alpha expects revenue growth of 30-35% over FY27-FY29, up from 25-30% earlier.')[0];
    assert.equal(c.after.periodKind, 'MULTI_YEAR_CAGR'); assert.equal(c.after.periodYears, 3); assert.notEqual(c.after.period, 'FY27');
    const e = build([primary('Zed Alpha raises guidance', 'Zed Alpha expects revenue growth of 30-35% over FY27-FY29, up from 25-30% earlier.')]);
    assert.match(e.whyNow, /3-year CAGR/); assert.ok(e.evidenceGaps.some((g) => /multi-year/i.test(g)));
  });
});

// ═══ count invariants ═══════════════════════════════════════════════════════════════════════════════════════════
describe('count invariants', () => {
  const evs = (): GuidanceEvent[] => [
    build([primary('Zed Alpha raises FY27 guidance', BASE)]),
    build([primary('Zed Beta reiterates guidance', 'Zed Beta Ltd reiterates FY27 revenue growth guidance of 13%, unchanged from 13% earlier.', { ticker: 'ZZBB', company: 'Zed Beta Ltd' })]),
    build([primary('Zed Gamma raises FY26 EPS guidance', 'Zed Gamma Ltd now expects Adjusted EPS for FY26 of $4.70–4.85, up from $4.60–4.90 previously.', { ticker: 'ZZGG', company: 'Zed Gamma Ltd' })]),
    build([mk('Zed Delta raises FY27 guidance', BASE.replace(/Zed Alpha/g, 'Zed Delta'), { ticker: 'ZZDD', company: 'Zed Delta Ltd' })]),
  ];
  test('clean data: counts add up and no invariant is violated', () => {
    const e = evs();
    const c = computeCounts(e, { documentsAwaitingGrading: 4, documentsUnavailable: 1, documentsReadNoEvent: 2 });
    assert.equal(c.verified, 3); assert.equal(c.upgrade, 1); assert.equal(c.reiteration, 1); assert.equal(c.mixed, 1); assert.equal(c.unverifiedClaims, 1);
    assert.ok(c.verified <= c.processed && c.processed <= c.discovered); assert.ok(c.material <= c.verified && c.upgrade <= c.verified && c.expectationPositive <= c.verified);
    assert.equal(c.documentsAwaitingGrading, 4, 'awaiting is reported apart from verified'); assert.equal(c.discovered, 4 + 4 + 1 + 2);
    assert.deepEqual(checkEventInvariants(e, c), []);
    assert.match(countsLine(c), /4 awaiting grading \(not counted as verified\)/);
  });
  test('broken data is caught', () => {
    const e = evs(); const c = computeCounts(e);
    assert.ok(checkEventInvariants(e, { ...c, verified: c.processed + 5 }).some((m) => /verified .* greater than processed/.test(m)));
    const re = { ...e[1], displayLabel: 'GUIDANCE UPGRADE', isUpgrade: true };
    assert.ok(checkEventInvariants([re], computeCounts([re])).some((m) => /reiteration is labelled as a raise|labelled as an upgrade/.test(m)));
    const gap = { ...e[0], expectationGap: 'POSITIVE' as const, consensus: { value: null, label: 'UNAVAILABLE' as const } };
    assert.ok(checkEventInvariants([gap], computeCounts([gap])).some((m) => /no consensus number/.test(m)));
    const unv = { ...e[3], displayLabel: 'GUIDANCE UPGRADE' };
    assert.ok(checkEventInvariants([unv], computeCounts([unv])).some((m) => /without a primary source/.test(m)));
    const audit = { ...e[2], isUpgrade: true };
    assert.ok(checkEventInvariants([audit], computeCounts([audit])).length > 0);
  });
  test('classifyEvent is a pure function of the numbers', () => {
    const e = evs()[0]; const again = classifyEvent(e);
    assert.equal(again.displayLabel, e.displayLabel); assert.equal(again.classification, e.classification);
  });
});
