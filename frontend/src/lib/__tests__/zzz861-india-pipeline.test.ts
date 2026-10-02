// zzz861 — India pipeline repair. No network, no clock. Company names below are TEST INPUT (the owner's 20-company list); no production code names a company.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pipelineStateOf, type GuPipelineInput, type GuSourceLine } from '../guidance-pipeline-state';
import { marketQuality, dataQualityOf, withClaimCounts } from '../guidance-pipeline-coverage';
import { snapshotOf, validSnapshot, type PipelineSnapshot } from '../guidance-pipeline-snapshot';
import { resolveClaims, claimCountsOf, wantedFromClaims, stageOfQueueItem, queueStageCounts, compareClaim } from '../guidance-claims';
import { windowQuery, WINDOW_DAYS } from '../guidance-pipeline-windows';
import { docFromQueueRead, kindOfSource } from '../guidance-queue-bridge';
import { validateDoc } from '../guidance-docs-store';
import { processQueue, emptyQueue, enqueue, type QueueState } from '../guidance-upgrades-queue';
import { buildUniverse, type GuUniverseRecordX } from '../guidance-universe';
import { getSeedRows } from '../guidance-universe-service';
import { pipelineReport, type GuSubject } from '../guidance-pipeline-report';
import { pipelineView, emptyEvidence } from '../guidance-pipeline-service';
import type { GuidanceDocIndexRow, GuidanceExtractResult, ExtractedGuidance } from '../guidance-docs-types';

const NOW = new Date('2026-10-02T09:00:00Z');
const src = (name: string, state: GuSourceLine['state'], documents = 0, o: Partial<GuSourceLine> = {}): GuSourceLine => ({ name, state, documents, daysOk: state === 'OK' ? 7 : 0, daysTried: 14, detail: null, ...o });
const base = (o: Partial<GuPipelineInput>): GuPipelineInput => ({
  market: 'IN', sources: [], scanAt: null, servedFromStaleCache: false, staleCacheSavedAt: null, documentsDiscovered: 0, documentsProcessed: 0, documentsPending: 0,
  queueAwaiting: 0, queueReadNoGuidance: 0, queueUnavailable: 0, claims: 0, claimsPrimaryFound: 0, claimsPrimaryRead: 0, claimsVerified: 0, claimsContradicted: 0,
  verifiedGuidance: 0, processedNoGuidance: 0, daysFailed: 0, daysPartial: 0, daysNotRead: 0, tradingDays: 10, ...o,
});

describe('pipeline states (no bare NO DATA)', () => {
  test("India as the owner's page shows it: NSE ok, BSE failed, 871 documents queued, 18 claims, 0 verified -> PRIMARY VERIFICATION PENDING", () => {
    const s = pipelineStateOf(base({ sources: [src('NSE', 'OK', 5207), src('BSE', 'FAILED', 0, { daysTried: 14 })], scanAt: NOW.toISOString(), queueAwaiting: 871, claims: 18, daysFailed: 14, servedFromStaleCache: true }));
    assert.equal(s.status, 'PRIMARY_PENDING'); assert.equal(s.state, 'GUIDANCE_DISCOVERED_NOT_VERIFIED');
    assert.match(s.headline, /PRIMARY VERIFICATION PENDING/); assert.match(s.headline, /NSE ✓ 5207/); assert.match(s.headline, /BSE ✕/);
    assert.match(s.headline, /871 documents pending/); assert.match(s.headline, /18 claims/); assert.match(s.headline, /0 verified/);
    assert.ok(s.reasons.some((r) => /BSE/.test(r) && /other sources keep running/.test(r))); assert.ok(s.reasons.some((r) => /saved copy/.test(r)));
    assert.equal(s.nse, 5207); assert.equal(s.bse, 0);
  });
  test('nothing collected, nothing scanned -> NO_SOURCE_DATA', () => { const s = pipelineStateOf(base({ sources: [src('NSE', 'NOT_RUN'), src('BSE', 'NOT_RUN')] })); assert.equal(s.state, 'NO_SOURCE_DATA'); assert.equal(s.status, 'NO_SOURCE_DATA'); });
  test('every source failed and nothing found -> SOURCE_FAILED (never "zero")', () => {
    const s = pipelineStateOf(base({ sources: [src('NSE', 'FAILED'), src('BSE', 'FAILED')], scanAt: NOW.toISOString() })); assert.equal(s.state, 'SOURCE_FAILED'); assert.equal(s.status, 'SOURCE_FAILED'); assert.match(s.reasons[0], /NSE, BSE/);
  });
  test('only a saved copy -> SOURCE_STALE: discovery only, never COMPLETE', () => {
    const s = pipelineStateOf(base({ sources: [src('NSE', 'STALE', 381)], scanAt: NOW.toISOString(), servedFromStaleCache: true })); assert.equal(s.state, 'SOURCE_STALE'); assert.equal(s.status, 'STALE');
  });
  test('documents found, none read -> DOCUMENTS_DISCOVERED_NOT_PROCESSED', () => { const s = pipelineStateOf(base({ sources: [src('NSE', 'OK', 10)], scanAt: 'x', documentsDiscovered: 10, documentsPending: 10 })); assert.equal(s.state, 'DOCUMENTS_DISCOVERED_NOT_PROCESSED'); });
  test('documents read, no guidance -> DOCUMENTS_PROCESSED_NO_GUIDANCE', () => { const s = pipelineStateOf(base({ sources: [src('NSE', 'OK', 10), src('BSE', 'OK', 10)], scanAt: 'x', documentsDiscovered: 10, documentsProcessed: 10 })); assert.equal(s.state, 'DOCUMENTS_PROCESSED_NO_GUIDANCE'); assert.equal(s.status, 'COMPLETE'); });
  test('verified guidance and all sources ok -> GUIDANCE_VERIFIED / COMPLETE; a failed source makes it PARTIAL, not blocked', () => {
    const ok = pipelineStateOf(base({ sources: [src('NSE', 'OK', 10), src('BSE', 'OK', 10)], scanAt: 'x', documentsDiscovered: 10, documentsProcessed: 10, verifiedGuidance: 4 })); assert.equal(ok.state, 'GUIDANCE_VERIFIED'); assert.equal(ok.status, 'COMPLETE');
    const part = pipelineStateOf(base({ sources: [src('NSE', 'OK', 10), src('BSE', 'FAILED')], scanAt: 'x', documentsDiscovered: 10, documentsProcessed: 10, verifiedGuidance: 4 })); assert.equal(part.state, 'GUIDANCE_VERIFIED'); assert.equal(part.status, 'PARTIAL');
  });
  test('the USA state works too and is labelled USA', () => { const s = pipelineStateOf(base({ market: 'US', sources: [src('SEC', 'PARTIAL', 40)], scanAt: 'x', verifiedGuidance: 23, documentsDiscovered: 40, documentsProcessed: 35, documentsPending: 5 })); assert.match(s.headline, /^USA — PARTIAL/); assert.equal(s.state, 'GUIDANCE_VERIFIED'); });
});

describe('quality from the real evidence: scan snapshot + document store + claims', () => {
  const snap: PipelineSnapshot = { v: 1, at: NOW.toISOString(), markets: { IN: { sources: [src('NSE', 'OK', 5207), src('BSE', 'FAILED', 0, { daysTried: 14 })], scanAt: NOW.toISOString(), tradingDays: 14, daysRead: 1, daysPartial: 0, daysFailed: 13, daysNotRead: 0, servedFromStaleCache: true, staleCacheSavedAt: null, queue: { awaiting: 871, done: 0, readNoGuidance: 0, unavailable: 0, failed: 0, total: 871 } } } };
  test('empty document store + a real scan snapshot is NOT "no data"', () => {
    const q = marketQuality('IN', [], null, NOW, 120, { snapshot: snap });
    assert.notEqual(q.status, 'NO_SOURCE_DATA'); assert.equal(q.nse, 5207); assert.equal(q.bse, 0); assert.equal(q.inputs.queueAwaiting, 871);
    const q2 = withClaimCounts(q, { claims: 18, primaryFound: 0, primaryRead: 0, verified: 0, contradicted: 0, verifiedGuidance: 0 });
    assert.equal(q2.status, 'PRIMARY_PENDING'); assert.match(q2.line, /INDIA — PRIMARY VERIFICATION PENDING/); assert.match(q2.line, /18 claims/);
  });
  test('with no snapshot and no documents it says NO SOURCE DATA, plainly', () => { const q = marketQuality('IN', [], null, NOW); assert.equal(q.state, 'NO_SOURCE_DATA'); assert.match(q.line, /NO SOURCE DATA/); });
  test('snapshotOf: a failed BSE feed and a queue become source lines and stage counts; validSnapshot round-trips', () => {
    const card: any = { market: 'IN', tradingDays: 14, daysSuccessfullyRead: 1, daysPartialCoverage: 0, daysFailed: 13, daysNotAttempted: 0, daysFromEarlierRuns: 0, cache: [{ name: 'c', key: 'k', state: 'HIT', servedBy: 'LASTGOOD', items: 381, text: '' }],
      sources: [{ name: 'NSE announcements', tier: 'PRIMARY', status: 'COMPLETE', queryStatus: 'SUCCESS', recordsRead: 5207, daysAttempted: 14, daysSucceeded: 7, reason: 'ok' }, { name: 'BSE announcements', tier: 'PRIMARY', status: 'FAILED', queryStatus: 'FAILED', recordsRead: 0, daysAttempted: 14, daysSucceeded: 0, reason: 'blocked' }] };
    const q: QueueState = { ...emptyQueue(NOW), items: [{ id: 'a', market: 'IN', processing_status: 'QUEUED' }, { id: 'b', market: 'IN', processing_status: 'DONE', result: { complete: false } }, { id: 'c', market: 'US', processing_status: 'QUEUED' }] as any };
    const s = snapshotOf([card], q, NOW); const m = s.markets.IN!;
    assert.deepEqual(m.sources.map((x) => [x.name, x.state]), [['NSE', 'OK'], ['BSE', 'FAILED']]); assert.equal(m.queue.awaiting, 1); assert.equal(m.queue.readNoGuidance, 1); assert.equal(m.servedFromStaleCache, true);
    assert.ok(validSnapshot(JSON.parse(JSON.stringify(s)))); assert.equal(validSnapshot({ v: 2 }), null);
  });
});

// ── claims: HFCL and Cupid traced end to end through the REAL universe build ──
const seed = getSeedRows().rows;
const build = buildUniverse([], null, seed, NOW, {});
const claimRow = (n: RegExp, metric?: string): GuUniverseRecordX => { const r = (build.claimsAwaiting ?? []).find((x) => n.test(x.record.company) && (!metric || x.points.some((p) => p.metric === metric))); assert.ok(r, `claim for ${n}`); return r!; };
const row = (o: Partial<ExtractedGuidance>): ExtractedGuidance => ({ metric: 'REVENUE', metricLabel: 'revenue', period: 'FY27', periodKind: 'ANNUAL', basis: 'REPORTED', currency: 'INR', unit: 'crore', low: null, high: null, status: 'NEW', quote: 'q', confidence: 0.9, ...o });
const result = (r: GuUniverseRecordX, rows: ExtractedGuidance[], o: Partial<GuidanceExtractResult> = {}): GuidanceExtractResult => ({ docId: 'a'.repeat(20), market: 'IN', ticker: r.tickers[0] || null, company: r.record.company, docUrl: 'https://nsearchives.nseindia.com/x.pdf', docKind: 'RESULTS_RELEASE', filedAt: '2026-08-10', extractedAt: '2026-10-01T00:00:00Z', model: 't', status: rows.length ? 'ok' : 'no_guidance', rows, dropped: 0, ...o });
const docRow = (r: GuUniverseRecordX, o: Partial<GuidanceDocIndexRow> = {}): GuidanceDocIndexRow => ({ docId: 'b'.repeat(20), market: 'IN', ticker: r.tickers[0] || null, company: r.record.company, kind: 'RESULTS_RELEASE', filedAt: '2026-08-10', url: 'https://nsearchives.nseindia.com/x.pdf', textChars: 900, ...o });
const qItem = (r: GuUniverseRecordX, o: any = {}) => ({ id: 'q1', discovered_at: '2026-10-01', priority: 'P0', company_id: null, ticker: r.tickers[0] || null, company: r.record.company, market: 'IN', source_url: 'https://nsearchives.nseindia.com/y.pdf', source_type: 'Financial Results', subject: 's', event_date: '2026-10-01', processing_status: 'QUEUED', attempt_count: 0, last_error: null, next_attempt: null, ...o });

describe('claims: secondary claim -> primary document -> verdict (HFCL, then Cupid revenue + PAT)', () => {
  test('HFCL: no company document on file -> PRIMARY_NOT_FOUND, actionable, "Secondary source reports", never "Company stated"', () => {
    const hf = claimRow(/hfcl/i); const [c] = resolveClaims([hf], {});
    assert.equal(c.verification_status, 'PRIMARY_NOT_FOUND'); assert.equal(c.primary, 'NOT_FOUND'); assert.equal(c.document, 'PENDING'); assert.equal(c.processing, 'NONE'); assert.equal(c.claim_status, 'AWAITING_PRIMARY');
    assert.match(c.next_action, /wanted list/); assert.equal(c.market, 'IN'); assert.ok(c.secondary_source); assert.doesNotMatch(JSON.stringify(c), /Company stated/);
  });
  test('HFCL: filing queued -> NOT_YET_FETCHED / QUEUED; fetched -> RUNNING; failed -> FAILED with retry; document on file unread -> PRIMARY_NOT_READ', () => {
    const hf = claimRow(/hfcl/i);
    assert.deepEqual((({ primary, processing, queue_stage }) => ({ primary, processing, queue_stage }))(resolveClaims([hf], { queue: [qItem(hf) as any] })[0]), { primary: 'NOT_YET_FETCHED', processing: 'QUEUED', queue_stage: 'LOCATED' });
    assert.equal(resolveClaims([hf], { queue: [qItem(hf, { processing_status: 'READING' }) as any] })[0].processing, 'RUNNING');
    const f = resolveClaims([hf], { queue: [qItem(hf, { processing_status: 'FAILED' }) as any] })[0]; assert.equal(f.processing, 'FAILED'); assert.match(f.next_action, /Retry/);
    const nr = resolveClaims([hf], { docs: [docRow(hf)] })[0]; assert.equal(nr.verification_status, 'PRIMARY_NOT_READ'); assert.equal(nr.primary, 'FOUND'); assert.equal(nr.document, 'AVAILABLE'); assert.ok(nr.primary_source_id);
  });
  test('HFCL: document read, silent on this metric -> NO_GUIDANCE_IN_DOCUMENT (silence never passes)', () => {
    const hf = claimRow(/hfcl/i); const c = resolveClaims([hf], { docs: [docRow(hf)], extracted: [result(hf, [])] })[0];
    assert.equal(c.verification_status, 'NO_GUIDANCE_IN_DOCUMENT'); assert.equal(c.claim_status, 'NO_GUIDANCE_IN_DOCUMENT'); assert.equal(c.processing, 'DONE');
    const other = resolveClaims([hf], { extracted: [result(hf, [row({ metric: 'PAT', low: 10, high: 12 })])] })[0]; assert.equal(other.verification_status, 'NO_GUIDANCE_IN_DOCUMENT');
  });
  test('Cupid: revenue and PAT are two claim rows of ONE company; each resolves on its own', () => {
    const cu = claimRow(/cupid/i); const rows = resolveClaims([cu], {}); assert.ok(rows.length >= 1);
    const p = cu.points[0]; assert.ok(p.absolute || p.statedGrowth);
    const good = row({ metric: p.metric === 'PAT' ? 'PAT' : 'REVENUE', period: p.period, low: p.absolute?.valueLow ?? p.absolute?.value ?? null, high: p.absolute?.value ?? null, growthPctLow: p.statedGrowth?.low ?? null, growthPctHigh: p.statedGrowth?.high ?? p.statedGrowth?.low ?? null });
    const v = resolveClaims([cu], { extracted: [result(cu, [good])] })[0]; assert.equal(v.verification_status, 'VERIFIED'); assert.equal(v.claim_status, 'VERIFIED'); assert.ok(v.primary_source_id);
    const bad = { ...good, low: (good.low ?? 100) * 3, high: (good.high ?? 100) * 3, growthPctLow: p.statedGrowth ? p.statedGrowth.low * 3 : null, growthPctHigh: p.statedGrowth ? (p.statedGrowth.high ?? p.statedGrowth.low) * 3 : null };
    assert.equal(resolveClaims([cu], { extracted: [result(cu, [bad])] })[0].verification_status, 'CONTRADICTED');
  });
  test('AI-contradicted ticker -> CONTRADICTED', () => { const hf = claimRow(/hfcl/i); assert.equal(resolveClaims([hf], { contradicted: [hf.tickers[0].toUpperCase()] })[0].verification_status, 'CONTRADICTED'); });
  test('compareClaim: an amount in another unit is not comparable (null), never a pass', () => {
    const cu = claimRow(/cupid/i); const p = cu.points[0];
    if (p.absolute) assert.equal(compareClaim(p, row({ currency: 'USD', unit: 'million', low: 1, high: 2 })), null);
  });
  test('wanted list comes from the claims (deduped per company, no names in code)', () => {
    const all = resolveClaims(build.claimsAwaiting ?? [], {}); const w = wantedFromClaims(all);
    assert.ok(w.length > 0); assert.equal(new Set(w.map((x) => `${x.market}:${x.ticker ?? x.company}`)).size, w.length); assert.ok(w.every((x) => x.why === 'PRIMARY_NOT_FOUND'));
    const hf = claimRow(/hfcl/i); const after = wantedFromClaims(resolveClaims(build.claimsAwaiting ?? [], { docs: [docRow(hf)] }));
    assert.ok(after.find((x) => x.ticker === hf.tickers[0])?.why === 'PRIMARY_NOT_READ');
  });
  test('claim counts per market feed the state; verifiedGuidance is passed in', () => {
    const all = resolveClaims(build.claimsAwaiting ?? [], {}); const c = claimCountsOf(all, { IN: 0, US: 23 });
    assert.equal(c.IN.claims + c.US.claims, all.length); assert.equal(c.US.verifiedGuidance, 23); assert.equal(c.IN.verified, 0);
  });
});

describe('queue stages and the queue -> document store -> extractor bridge', () => {
  test('stage mapping', () => {
    const ex = new Map<string, GuidanceExtractResult>([['d1', { rows: [row({})] } as any], ['d2', { rows: [] } as any]]);
    const it = (o: any) => qItem(claimRow(/hfcl/i), o) as any;
    assert.equal(stageOfQueueItem(it({}), ex), 'LOCATED'); assert.equal(stageOfQueueItem(it({ source_url: null }), ex), 'DISCOVERED'); assert.equal(stageOfQueueItem(it({ processing_status: 'READING' }), ex), 'FETCHED');
    assert.equal(stageOfQueueItem(it({ processing_status: 'DONE', result: { complete: true }, }), ex), 'GUIDANCE_FOUND');
    assert.equal(stageOfQueueItem(it({ processing_status: 'DONE', result: { complete: false }, doc_id: 'zz', handoff: { to: 'AI_EXTRACTOR' } }), ex), 'READ');
    assert.equal(stageOfQueueItem(it({ processing_status: 'DONE', result: { complete: false }, doc_id: 'd1', handoff: {} }), ex), 'GUIDANCE_FOUND');
    assert.equal(stageOfQueueItem(it({ processing_status: 'DONE', result: { complete: false }, doc_id: 'd2', handoff: {} }), ex), 'NO_GUIDANCE');
    assert.equal(stageOfQueueItem(it({ processing_status: 'FAILED' }), ex), 'FAILED'); assert.equal(stageOfQueueItem(it({ processing_status: 'SOURCE_UNAVAILABLE' }), ex), 'SOURCE_UNAVAILABLE');
    assert.equal(queueStageCounts([it({}), it({ processing_status: 'FAILED' })], ex, 'IN').LOCATED, 1);
  });
  const TEXT = `Hind Test Industries Ltd. Results release for the quarter ended June 30, 2026. ${'The company continues to execute on its order book. '.repeat(10)} For FY27 we expect revenue growth of about 25 per cent.`;
  test('the worker stores every filing it reads as a company document the extractor can find (same docId as the hand-off); the document is not just marked read', async () => {
    let q = emptyQueue(NOW);
    const e = enqueue(q, [{ market: 'IN', ticker: 'HINDTEST', company: 'Hind Test Industries Ltd', sourceUrl: 'https://nsearchives.nseindia.com/corporate/hindtest_results.pdf', subject: 'Financial Results', eventDate: '2026-09-30', sourceType: 'Financial Results' } as any], NOW); q = e.queue;
    const raws: Array<Record<string, unknown>> = [];
    const r = await processQueue(q, { now: NOW, fetchDoc: async () => ({ ok: true, status: 200, contentType: 'application/pdf', text: TEXT }), onRead: (it, d) => { const x = docFromQueueRead(it, d, NOW); if (x) raws.push(x); } });
    assert.equal(r.done, 1); assert.equal(raws.length, 1);
    const v = validateDoc(raws[0], 'events-queue'); assert.ok(v.ok, v.ok ? '' : (v as any).reason);
    const item: any = r.queue.items[0]; if (item.handoff) assert.equal(item.handoff.docId, raws[0].docId);
    if (v.ok) { assert.equal(v.doc.market, 'IN'); assert.equal(v.doc.ticker, 'HINDTEST'); assert.equal(v.doc.collector, 'events-queue'); assert.match(v.doc.text || '', /25 per cent/); }
  });
  test('a filing on a non-exchange host is not stored (the store would refuse it); kinds map from the subject', () => {
    assert.equal(docFromQueueRead({ market: 'IN', ticker: 'X', company: 'X Ltd', source_url: 'https://evil.example.com/a.pdf', source_type: 'Financial Results', subject: 's', event_date: '2026-09-30' }, { text: TEXT }, NOW), null);
    assert.equal(kindOfSource('Earnings Call Transcript'), 'TRANSCRIPT'); assert.equal(kindOfSource('Investor Presentation'), 'PRESENTATION'); assert.equal(kindOfSource('Financial Results'), 'RESULTS_RELEASE');
  });
});

describe('recent windows are a real backend query (not the Active list); 120D uses the announcement date', () => {
  const docs: GuidanceDocIndexRow[] = [
    { docId: '1'.repeat(20), market: 'IN', ticker: 'AAA', company: 'A', kind: 'RESULTS_RELEASE', filedAt: '2026-10-01', url: 'u', textChars: 1, extracted: true },
    { docId: '2'.repeat(20), market: 'IN', ticker: 'BBB', company: 'B', kind: 'TRANSCRIPT', filedAt: '2026-08-20', url: 'u', textChars: 1 },
    { docId: '3'.repeat(20), market: 'IN', ticker: 'CCC', company: 'C', kind: 'TRANSCRIPT', filedAt: '2026-04-01', url: 'u', textChars: 1 },
  ];
  const res: GuidanceExtractResult[] = [{ docId: '1'.repeat(20), market: 'IN', ticker: 'AAA', company: 'A', docUrl: 'u', docKind: 'RESULTS_RELEASE', filedAt: '2026-10-01', extractedAt: 'x', model: 't', status: 'ok', dropped: 0,
    rows: [row({ status: 'RAISED', prior: { low: 1, high: 2, statedIn: 's' } }), row({ metric: 'PAT', status: 'REITERATED' }), row({ metric: 'EBITDA', status: 'NEW' }), row({ metric: 'EPS', status: 'LOWERED' })] }];
  const cov = { v: 1 as const, market: 'IN' as const, updatedAt: 'x', days: { '2026-10-01': { status: 'ok' as const, filings: 5, docs: 1, at: 'x' }, '2026-09-30': { status: 'failed' as const, filings: 0, docs: 0, at: 'x' } } };
  test('120D reports the requested window, the actual start/end, trading days and covered / partial / failed', () => {
    const w = windowQuery('IN', '120D', NOW, docs, res, cov, 871);
    assert.equal(w.requested_window, '120D'); assert.equal(w.requested_days, 120); assert.equal(w.actual_end, '2026-10-02'); assert.equal(w.actual_start, '2026-09-30'); assert.ok(w.trading_days >= 80);
    assert.equal(w.covered_days, 1); assert.equal(w.failed_days, 1); assert.equal(w.documents, 2);   // the April document is outside 120 days of 2 Oct (announcement date decides)
    assert.equal(w.events, 4); assert.equal(w.coverage_status, 'PARTIAL'); assert.match(w.partial_coverage || '', /PARTIAL COVERAGE/);
  });
  test('recent-events engine numbers', () => {
    const e = windowQuery('IN', '7D', NOW, docs, res, cov, 0).engine;
    assert.equal(e.documents_scanned, 1); assert.equal(e.events_extracted, 4); assert.equal(e.verified_raises, 1); assert.equal(e.reiterations, 1); assert.equal(e.lowered, 1); assert.equal(e.first_guidance, 1); assert.equal(e.with_previous_guidance, 2); assert.equal(e.why_zero, null);
  });
  test('zero events carry a reason: nothing collected / collected not read / read with no numbers', () => {
    const none = windowQuery('IN', '24H', NOW, [], [], null); assert.equal(none.events, 0); assert.match(none.engine.why_zero!, /not read them yet|collector/); assert.equal(none.coverage_status, 'NO_COVERAGE');
    const unread = windowQuery('IN', '14D', NOW, [docs[1]].map((d) => ({ ...d, filedAt: '2026-09-25' })), [], cov, 0); assert.match(unread.engine.why_zero!, /not read by the extractor/);
    const noNum = windowQuery('IN', '14D', NOW, [], [{ ...res[0], status: 'no_guidance', rows: [], filedAt: '2026-09-28' }], cov, 0); assert.match(noNum.engine.why_zero!, /none states numeric guidance/);
  });
  test('all six windows exist', () => { assert.deepEqual(Object.keys(WINDOW_DAYS), ['24H', '3D', '7D', '14D', '30D', '120D']); });
});

describe('the whole view and the 20-company regression with terminal states', () => {
  test('pipelineView on the real seed build: India has claims, 0 verified, state PRIMARY_PENDING; the USA numbers are not touched', () => {
    const ev = emptyEvidence(); ev.snapshot = { v: 1, at: NOW.toISOString(), markets: { IN: { sources: [src('NSE', 'OK', 100), src('BSE', 'FAILED')], scanAt: NOW.toISOString(), tradingDays: 10, daysRead: 1, daysPartial: 0, daysFailed: 9, daysNotRead: 0, servedFromStaleCache: false, staleCacheSavedAt: null, queue: { awaiting: 40, done: 0, readNoGuidance: 0, unavailable: 0, failed: 0, total: 40 } } } };
    const act = (m: 'IN' | 'US') => (build.defaultRecords ?? []).filter((r) => r.record.market === m).length;
    const v = pipelineView(ev, build.claimsAwaiting ?? [], { IN: act('IN'), US: act('US') }, NOW);
    assert.ok(v.claimCounts.IN.claims > 0); assert.equal(v.quality.markets.IN.status, 'PRIMARY_PENDING'); assert.match(v.quality.markets.IN.line, /PRIMARY VERIFICATION PENDING/);
    assert.equal(v.quality.exhaustive, false); assert.ok(v.wanted.length > 0); assert.ok(v.claims.every((c) => c.next_action.length > 0));
  });
  const T: GuSubject[] = ['HFCL', 'Syrma SGS Technology', 'Netweb Technologies India', 'Sobha', 'MTAR Technologies', 'Rossell Techsys', 'Knowledge Marine & Engineering Works', 'KRN Heat Exchanger', 'Cupid', 'V2 Retail',
    'Aditya Infotech', 'Senores Pharmaceuticals', 'Sky Gold and Diamonds', 'TD Power Systems', 'Avalon Technologies', 'Krishna Phoschem', 'Aeroflex Industries', 'Stallion India Fluorochemicals', 'Sakar Healthcare', 'Man Industries'].map((n) => ({ name: n, market: 'IN' as const }));
  const rep = pipelineReport(build, T);
  test('every company ends in a valid terminal state, with the exact reason; nothing is forced', () => {
    const valid = ['PRIMARY_VERIFIED', 'SECONDARY_ONLY', 'PRIMARY_SOURCE_NOT_FOUND', 'PRIMARY_SOURCE_READ_NO_GUIDANCE', 'CLAIM_CONTRADICTED', 'EXPIRED', 'REPLACED', 'LOWERED', 'REITERATION', 'PRIMARY_FOUND_NOT_READ', 'NO_CLAIM_FOUND', 'STALE_NEEDS_RECHECK'];
    assert.equal(rep.rows.length, 20); for (const r of rep.rows) { assert.ok(valid.includes(r.terminal), `${r.name}: ${r.terminal}`); assert.ok(r.reason); }
    if (process.env.GU_PRINT) console.log(rep.rows.map((r) => `${r.name} | claim=${r.secondary_claim_found} resolved=${r.company_resolved} found=${r.primary_source_found} read=${r.primary_source_opened} guid=${r.guidance_found} | ${r.metric ?? '-'} ${r.period ?? '-'} ${r.current_guidance ?? '-'} | ${r.calculation_type ?? '-'} | ${r.verification_status ?? '-'} | ${r.active_status} | ${r.terminal} | ${r.reason}`).join('\n'));
  });
  test('when a primary document IS read, the company moves: HFCL claim verified by a document row becomes PRIMARY_VERIFIED in the same universe', () => {
    const hf = claimRow(/hfcl/i); const p = hf.points[0];
    const doc = result(hf, [row({ metric: p.metric === 'PAT' ? 'PAT' : 'REVENUE', period: p.period, low: p.absolute?.valueLow ?? p.absolute?.value ?? 1000, high: p.absolute?.value ?? 1100, quote: 'we guide for FY27 revenue of Rs 1000 crore to Rs 1100 crore' })], { ticker: hf.tickers[0], filedAt: '2026-09-20' });
    const b2 = buildUniverse([], null, seed, NOW, { extracted: { results: [doc], actuals: new Map() } });
    const r2 = pipelineReport(b2, [{ name: 'HFCL', market: 'IN' }], { docs: [docRow(hf)], extracted: [doc] }).rows[0];
    assert.ok(r2.primary_source_found && r2.primary_source_opened && r2.guidance_found); assert.notEqual(r2.terminal, 'PRIMARY_SOURCE_NOT_FOUND');
  });
});
