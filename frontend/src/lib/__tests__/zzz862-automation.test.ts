// zzz862 — the fully automatic path (a company that already has guidance files again: it is read first, no manual step), claim stages, exact trust counts.
// No network, no clock. Company names are TEST INPUT taken from the owner's list; no production code names a company.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rowTrustLine, rowCohortLine } from '../../components/guidance-upgrades/gu-ui';
import { resolveClaims, claimCountsOf, CLAIM_STAGE_TEXT } from '../guidance-claims';
import { pipelineStateOf, type GuPipelineInput } from '../guidance-pipeline-state';
import { watchOf, watchMatcher, promoteWatched, validWatch, GUIDANCE_BEARING_SUBJECT } from '../guidance-watch';
import { queueInputsFromFilings } from '../guidance-upgrades-sources';
import { enqueue, emptyQueue, processQueue, selectDue, reportQueue } from '../guidance-upgrades-queue';
import { docFromQueueRead } from '../guidance-queue-bridge';
import { validateDoc } from '../guidance-docs-store';
import { planQueue } from '../ai-guidance-extract';
import { buildUniverse, type GuUniverseRecordX } from '../guidance-universe';
import { getSeedRows } from '../guidance-universe-service';
import { pipelineReport } from '../guidance-pipeline-report';
import type { GuidanceDocIndexRow, GuidanceExtractResult } from '../guidance-docs-types';

const NOW = new Date('2026-10-02T09:00:00Z');
const seed = getSeedRows().rows;
const build = buildUniverse([], null, seed, NOW, {});
const claimOf = (n: RegExp): GuUniverseRecordX => { const r = (build.claimsAwaiting ?? []).find((x) => n.test(x.record.company)); assert.ok(r); return r!; };
const grow = (trust: string, id: string): any => ({ id, trust, company: id, market: 'US' });

describe('trust counts count what is listed (companies), not page-wide rows', () => {
  test('9 companies listed: 8 verified + 1 derived = 9 (the page used to say 8 + 0 + 19)', () => {
    const rows: any = { ANNUAL: [...Array(8).keys()].map((i) => grow('verified', `v${i}`)).concat([grow('derived', 'h')]), MULTI_YEAR_CAGR: [], QUARTERLY: [] };
    assert.equal(rowTrustLine(rows), '8 verified · 1 derived · 0 partial · 0 unverified (9 companies listed)');
    assert.equal(rowCohortLine(rows), '9 annual · 0 multi-year CAGR · 0 quarterly');
  });
});

describe('claim stages: a found document is never "waiting for a document"', () => {
  const hf = claimOf(/hfcl/i);
  const row = (o: Partial<GuidanceDocIndexRow> = {}): GuidanceDocIndexRow => ({ docId: 'b'.repeat(20), market: 'IN', ticker: hf.tickers[0], company: hf.record.company, kind: 'RESULTS_RELEASE', filedAt: '2026-08-10', url: 'https://nsearchives.nseindia.com/x.pdf', textChars: 900, ...o });
  const qi = (o: any = {}) => ({ id: 'q', discovered_at: '2026-10-01', priority: 'P0', company_id: null, ticker: hf.tickers[0], company: hf.record.company, market: 'IN', source_url: 'https://nsearchives.nseindia.com/y.pdf', source_type: 'Results', subject: 's', event_date: '2026-10-01', processing_status: 'QUEUED', attempt_count: 0, last_error: null, next_attempt: null, ...o });
  test('no document -> PRIMARY_NOT_FOUND; queued -> DOCUMENT_QUEUED; reading -> DOCUMENT_BEING_READ; failed -> DOCUMENT_FAILED', () => {
    assert.equal(resolveClaims([hf], {})[0].stage, 'PRIMARY_NOT_FOUND');
    assert.equal(resolveClaims([hf], { queue: [qi() as any] })[0].stage, 'DOCUMENT_QUEUED');
    assert.equal(resolveClaims([hf], { queue: [qi({ processing_status: 'READING' }) as any] })[0].stage, 'DOCUMENT_BEING_READ');
    assert.equal(resolveClaims([hf], { queue: [qi({ processing_status: 'FAILED' }) as any] })[0].stage, 'DOCUMENT_FAILED');
  });
  test('Cupid case: document on file, the queue already read it (Done) -> "awaiting extraction", not "Done"', () => {
    const c = resolveClaims([hf], { docs: [row()], queue: [qi({ processing_status: 'DONE', result: { complete: false }, doc_id: 'b'.repeat(20), handoff: { to: 'AI_EXTRACTOR' } }) as any] })[0];
    assert.equal(c.verification_status, 'PRIMARY_NOT_READ'); assert.equal(c.processing, 'AWAITING_EXTRACTION'); assert.equal(c.stage, 'DOCUMENT_READ_AWAITING_EXTRACTION'); assert.equal(c.primary, 'FOUND');
    assert.match(c.next_action, /hourly/); assert.ok(CLAIM_STAGE_TEXT[c.stage]);
  });
  test('stage counts split the open claims so the banner never says all of them lack a document', () => {
    const all = resolveClaims(build.claimsAwaiting ?? [], { docs: [row()], queue: [] }); const c = claimCountsOf(all, { IN: 0, US: 0 });
    assert.equal((c.IN.queued ?? 0) + (c.IN.noDocument ?? 0), c.IN.claims);
    const s = pipelineStateOf({ market: 'IN', sources: [{ name: 'NSE', state: 'OK', documents: 5, daysOk: 7, daysTried: 7, detail: null }, { name: 'BSE', state: 'FAILED', documents: 0, daysOk: 0, daysTried: 7, detail: null }], scanAt: 'x', servedFromStaleCache: false, staleCacheSavedAt: null, documentsDiscovered: 0, documentsProcessed: 0, documentsPending: 0, queueAwaiting: 0, queueReadNoGuidance: 0, queueUnavailable: 0,
      claims: 19, claimsPrimaryFound: 2, claimsPrimaryRead: 0, claimsVerified: 0, claimsContradicted: 0, verifiedGuidance: 0, processedNoGuidance: 0, claimsQueued: 8, claimsNoDocument: 11, daysFailed: 7, daysPartial: 0, daysNotRead: 0, tradingDays: 5 } as GuPipelineInput);
    assert.ok(s.reasons.some((r) => /11 with no company document found, 8 with a document queued/.test(r)), s.reasons.join('|'));
  });
  test('two separate dimensions: source coverage vs guidance verification', () => {
    const base: GuPipelineInput = { market: 'IN', sources: [{ name: 'NSE', state: 'OK', documents: 9, daysOk: 7, daysTried: 7, detail: null }, { name: 'BSE', state: 'FAILED', documents: 0, daysOk: 0, daysTried: 7, detail: null }], scanAt: 'x', servedFromStaleCache: false, staleCacheSavedAt: null, documentsDiscovered: 0, documentsProcessed: 0, documentsPending: 0, queueAwaiting: 0, queueReadNoGuidance: 0, queueUnavailable: 0, claims: 5, claimsPrimaryFound: 0, claimsPrimaryRead: 0, claimsVerified: 0, claimsContradicted: 0, verifiedGuidance: 0, processedNoGuidance: 0, daysFailed: 0, daysPartial: 0, daysNotRead: 0, tradingDays: 5 };
    const a = pipelineStateOf(base); assert.equal(a.sourceCoverage, 'PARTIAL'); assert.equal(a.verification, 'PRIMARY_PENDING');
    const ok = pipelineStateOf({ ...base, sources: [{ ...base.sources[0] }, { ...base.sources[0], name: 'BSE' }], claims: 0, verifiedGuidance: 3 }); assert.equal(ok.sourceCoverage, 'COMPLETE'); assert.equal(ok.verification, 'VERIFIED');
    assert.equal(pipelineStateOf({ ...base, sources: [{ ...base.sources[0], state: 'FAILED', documents: 0 }, base.sources[1]], claims: 0 }).sourceCoverage, 'SOURCE_FAILED');
  });
});

describe('watch set: companies that already have guidance are queued and read first', () => {
  const w = watchOf([{ market: 'IN', ticker: 'syrma', company: 'Syrma SGS Technology Limited' }, { market: 'US', ticker: 'NTWK', company: 'Netsol Technologies Inc' }, { market: 'IN', ticker: null, company: '' }], NOW);
  const isW = watchMatcher(w);
  test('match by ticker or normalised name; per market; JSON round-trip', () => {
    assert.ok(isW({ market: 'IN', ticker: 'SYRMA' })); assert.ok(isW({ market: 'IN', ticker: null, company: 'Syrma SGS Technology Ltd' })); assert.ok(!isW({ market: 'US', ticker: 'SYRMA' })); assert.ok(!isW({ market: 'IN', ticker: 'OTHER', company: 'Other Ltd' }));
    assert.ok(validWatch(JSON.parse(JSON.stringify(w)))); assert.equal(validWatch({}), null); assert.ok(!watchMatcher(null)({ market: 'IN', ticker: 'SYRMA' }));
  });
  test('a watched company results filing is queued P0 even when its subject is not "raise-bearing"; others are not', () => {
    const f = (ticker: string, company: string, subject: string) => ({ market: 'IN' as const, ticker, company, subject, date: '2026-10-02', url: `https://nsearchives.nseindia.com/${ticker}.pdf`, exchange: 'NSE' });
    const inputs = queueInputsFromFilings([f('SYRMA', 'Syrma SGS Technology Limited', 'Financial Results for the quarter ended September 30, 2026'), f('OTHER', 'Other Ltd', 'Financial Results for the quarter'), f('SYRMA', 'Syrma SGS Technology Limited', 'Change in Registered Office')], new Set(), isW);
    const mine = inputs.filter((x) => x.ticker === 'SYRMA'); const other = inputs.filter((x) => x.ticker === 'OTHER');
    assert.equal(mine.length, 1); assert.equal(mine[0].priority, 'P0');            // watched: results filing, first
    assert.ok(other.every((x) => x.priority !== 'P0'));                              // not watched: ordinary priority
    assert.ok(!inputs.some((x) => /registered office/i.test(x.subject)));            // watched but not guidance-bearing: not queued
  });
  test('waiting items of watched companies move to P0 (guidance-bearing subjects only, never a processed one)', () => {
    let q = emptyQueue(NOW);
    q = enqueue(q, [{ market: 'IN', ticker: 'SYRMA', company: 'Syrma SGS Technology Limited', sourceUrl: 'https://nsearchives.nseindia.com/a.pdf', sourceType: 'NSE', subject: 'Investor Presentation', eventDate: '2026-09-01' }, { market: 'IN', ticker: 'SYRMA', company: 'Syrma SGS Technology Limited', sourceUrl: 'https://nsearchives.nseindia.com/b.pdf', sourceType: 'NSE', subject: 'Intimation of trading window', eventDate: '2026-09-01', priority: undefined }, { market: 'IN', ticker: 'ZZZ', company: 'Zed Ltd', sourceUrl: 'https://nsearchives.nseindia.com/c.pdf', sourceType: 'NSE', subject: 'Investor Presentation', eventDate: '2026-09-01' }] as any, NOW).queue;
    const n = promoteWatched(q.items, isW); assert.equal(n, 1);
    assert.deepEqual(q.items.map((x) => [x.ticker, x.priority]).sort(), [['SYRMA', 'P0'], ['SYRMA', 'P2'], ['ZZZ', 'P1']].sort()); assert.ok(GUIDANCE_BEARING_SUBJECT.test('Outcome of Board Meeting'));
  });
  test('the extractor reads a watched company\'s document before older and newer unwatched ones (both markets)', () => {
    const mk = (id: string, market: 'IN' | 'US', ticker: string, day: string): GuidanceDocIndexRow => ({ docId: id.repeat(20).slice(0, 20), market, ticker, company: ticker, kind: 'TRANSCRIPT', filedAt: day, url: 'u', textChars: 1 });
    const rows = [mk('a', 'IN', 'NEWER', '2026-10-02'), mk('b', 'IN', 'SYRMA', '2026-09-20'), mk('c', 'US', 'NTWK', '2026-09-01'), mk('d', 'US', 'ZZ', '2026-10-01')];
    const p = planQueue(rows, { handoff: null, graded: null, verified: null, looked: new Set(), watched: isW });
    assert.deepEqual(p.rows.slice(0, 2).map((r) => r.ticker).sort(), ['NTWK', 'SYRMA']);
    assert.deepEqual(planQueue(rows, { handoff: null, graded: null, verified: null, looked: new Set() }).rows[0].ticker, 'NEWER');   // without a watch set: unchanged
  });
});

describe('the whole automatic chain for a company that guided a month ago and files again today (Syrma-style)', () => {
  test('claim on file -> new filing -> queue P0 -> read -> stored -> extracted -> universe Active, primary verified; no manual step', async () => {
    const sy = claimOf(/syrma/i); const tk = sy.tickers[0]; const company = sy.record.company; const p = sy.points[0];
    const isW = watchMatcher(watchOf([{ market: 'IN', ticker: tk, company }], NOW));
    // 1) a big unrelated backlog is already queued; today's results filing arrives
    let q = emptyQueue(NOW);
    q = enqueue(q, Array.from({ length: 40 }, (_, i) => ({ market: 'IN' as const, ticker: `X${i}`, company: `X${i} Ltd`, sourceUrl: `https://nsearchives.nseindia.com/x${i}.pdf`, sourceType: 'NSE', subject: 'Investor Presentation', eventDate: '2026-09-15' })), new Date('2026-09-16T00:00:00Z')).queue;
    const filing = { market: 'IN' as const, ticker: tk, company, subject: 'Outcome of Board Meeting - Financial Results Q2 FY27', date: '2026-10-02', url: 'https://nsearchives.nseindia.com/corporate/syrma_q2.pdf', exchange: 'NSE' };
    q = enqueue(q, queueInputsFromFilings([filing], new Set(), isW), NOW).queue;
    // 2) the next run reads P0 first even though 40 documents waited longer
    const due = selectDue(q, NOW, 5); assert.equal(due[0].ticker, tk); assert.equal(due[0].priority, 'P0');
    const text = `${company}. Results release for the quarter ended September 30, 2026. ${'Order book remains strong across segments. '.repeat(8)} For FY27 we now guide revenue of Rs 5,000 crore to Rs 5,400 crore.`;
    const raws: Array<Record<string, unknown>> = [];
    const r = await processQueue(q, { now: NOW, maxDocs: 5, fetchDoc: async () => ({ ok: true, status: 200, contentType: 'application/pdf', text }), onRead: (it, d) => { const x = docFromQueueRead(it, d, NOW); if (x) raws.push(x); } });
    assert.ok(r.done >= 1); const mine = raws.find((x) => x.ticker === tk); assert.ok(mine, 'the worker stored the document');
    const v = validateDoc(mine, 'events-queue'); assert.ok(v.ok);
    // 3) the extractor orders it first and reads it (simulated model output with a quote that contains the numbers)
    const idx: GuidanceDocIndexRow = { docId: String(mine!.docId), market: 'IN', ticker: tk, company, kind: 'RESULTS_RELEASE', filedAt: '2026-10-02', url: String(mine!.url), textChars: 800 };
    const plan = planQueue([{ ...idx, docId: 'z'.repeat(20), ticker: 'NEWERUNWATCHED', company: 'N' }, idx], { handoff: null, graded: null, verified: null, looked: new Set(), watched: isW });
    assert.equal(plan.rows[0].ticker, tk);
    const extracted: GuidanceExtractResult = { docId: idx.docId, market: 'IN', ticker: tk, company, docUrl: idx.url, docKind: 'RESULTS_RELEASE', filedAt: '2026-10-02', extractedAt: NOW.toISOString(), model: 't', status: 'ok', dropped: 0,
      rows: [{ metric: 'REVENUE', metricLabel: 'revenue', period: p.period, periodKind: 'ANNUAL', basis: 'REPORTED', currency: 'INR', unit: 'crore', low: 5000, high: 5400, status: 'RAISED', prior: { low: 4500, high: 4800, statedIn: null }, quote: 'we now guide revenue of Rs 5,000 crore to Rs 5,400 crore', confidence: 0.9 }] };
    // 4) the universe now carries it as company-document guidance; the claim is resolved; the pipeline report says PRIMARY_VERIFIED / raised
    const b2 = buildUniverse([], null, seed, NOW, { extracted: { results: [extracted], actuals: new Map() } });
    const rep = pipelineReport(b2, [{ name: 'Syrma', ticker: tk, market: 'IN' }], { docs: [idx], extracted: [extracted] }).rows[0];
    assert.ok(rep.primary_source_found && rep.primary_source_opened && rep.guidance_found);
    assert.notEqual(rep.terminal, 'PRIMARY_SOURCE_NOT_FOUND'); assert.notEqual(rep.terminal, 'SECONDARY_ONLY');
    const rec = [...(b2.defaultRecords ?? []), ...(b2.reviewQueue ?? [])].find((x) => x.tickers.includes(tk));
    assert.ok(rec, 'the company document produced a record'); assert.equal(rec!.points[0].origin, 'COMPANY_DOC'); assert.equal(rec!.primarySourceRead, true);
    if (process.env.GU_PRINT) console.log(JSON.stringify({ terminal: rep.terminal, state: rep.state, list: (b2.defaultRecords ?? []).includes(rec!) ? 'ACTIVE' : 'REVIEW', display: rec!.points[0].display, event: rec!.points[0].eventType, verification: rec!.points[0].verificationStatus, report: reportQueue(r.queue).note.slice(0, 120) }));
  });
});
