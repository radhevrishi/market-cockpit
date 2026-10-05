// zzz872 — a day the GitHub India collector fully indexed counts as READ even when the live NSE / BSE feeds refuse the server.
// Before: a day had to be answered by EVERY primary source, so India showed "0 of 86 days" after a 130-day collector backfill.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageCard, checkCoverageCard, isCollectorSource } from '../guidance-upgrades-coverage';
import { pipelineStateOf, type GuPipelineInput } from '../guidance-pipeline-state';
import { scanIndia } from '../guidance-upgrades-scan';
import type { GuScanSource, GuScanStatus } from '../guidance-upgrades-types';

const now = new Date('2026-10-05T12:00:00Z');
const dayList = (n: number) => Array.from({ length: n }, (_, i) => new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
const weekdays = (ds: string[]) => ds.filter((d) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; });

function scanStatus(sources: GuScanSource[], days: string[]): GuScanStatus {
  return { market: 'IN', windowFrom: days[days.length - 1], windowTo: days[0], complete: false, lastScanAt: now.toISOString(), sources, daysCovered: 0, daysRequested: days.length, candidatesFound: 0, processed: 0, awaitingGrading: 0, verified: 0, newestItemAt: null, note: '' } as GuScanStatus;
}
const blocked = (name: string, days: string[]): GuScanSource => ({ name, tier: 'PRIMARY', state: 'FAILED', scanned: 0, daysTried: days.slice(), daysOk: [], failReasons: ['HTTP 403 blocked'], detail: 'blocked' });

describe('zzz872 — collector-indexed days are read days', () => {
  test('isCollectorSource names the GitHub collector only', () => {
    assert.equal(isCollectorSource({ name: 'GitHub India collector', tier: 'PRIMARY' }), true);
    assert.equal(isCollectorSource({ name: 'NSE announcements', tier: 'PRIMARY' }), false);
    assert.equal(isCollectorSource({ name: 'Scraped filings blob', tier: 'FALLBACK' }), false);
  });

  test('120D: NSE + BSE blocked, collector indexed every day → every trading day read, overall not FAILED, card consistent', () => {
    const days = dayList(120);
    const coll: GuScanSource = { name: 'GitHub India collector', tier: 'PRIMARY', state: 'COMPLETE', scanned: days.length, daysTried: days.slice(), daysOk: days.slice(), detail: 'all indexed' };
    const c = buildCoverageCard({ market: 'IN', window: '120D', windowDays: 120, now, scan: scanStatus([blocked('NSE announcements', days.slice(0, 30)), blocked('BSE announcements', days.slice(0, 30)), coll], days), documentsAwaitingGrading: 3487 });
    assert.equal(c.daysSuccessfullyRead, c.tradingDays, 'every trading day read');
    assert.ok(c.tradingDays >= 85 && c.tradingDays <= 87, `trading days ${c.tradingDays}`);
    assert.equal(c.daysPartialCoverage, 0); assert.equal(c.daysFailed, 0); assert.equal(c.daysNotAttempted, 0);
    assert.equal(c.overall, 'PARTIAL', 'documents still await grading');
    assert.match(c.overallReason, /GitHub collector/); assert.match(c.overallReason, /3487 documents awaiting grading/);
    assert.doesNotMatch(c.overallReason, /NSE announcements FAILED/);
    assert.deepEqual(checkCoverageCard(c), []);
  });

  test('nothing waiting + collector full → overall COMPLETE even though the live feeds are FAILED rows', () => {
    const days = dayList(30);
    const coll: GuScanSource = { name: 'GitHub India collector', tier: 'PRIMARY', state: 'COMPLETE', scanned: 30, daysTried: days.slice(), daysOk: days.slice(), detail: 'all indexed' };
    const c = buildCoverageCard({ market: 'IN', window: '30D', windowDays: 30, now, scan: scanStatus([blocked('NSE announcements', days), blocked('BSE announcements', days), coll], days), documentsAwaitingGrading: 0 });
    assert.equal(c.overall, 'COMPLETE');
    assert.deepEqual(checkCoverageCard(c), []);
  });

  test('collector covering only part of the window: the rest stays partial / not read (never zero events)', () => {
    const days = dayList(30);
    const half = days.slice(0, 10);
    const coll: GuScanSource = { name: 'GitHub India collector', tier: 'PRIMARY', state: 'PARTIAL', scanned: 10, daysTried: days.slice(), daysOk: half, detail: 'partly indexed' };
    const c = buildCoverageCard({ market: 'IN', window: '30D', windowDays: 30, now, scan: scanStatus([blocked('NSE announcements', days), blocked('BSE announcements', days), coll], days) });
    assert.equal(c.daysSuccessfullyRead, weekdays(half).length);
    assert.equal(c.daysFailed, c.tradingDays - weekdays(half).length);
    assert.equal(c.overall, 'PARTIAL');
    assert.match(c.overallReason, /NSE announcements FAILED/);
    assert.deepEqual(checkCoverageCard(c), []);
  });

  test('without a collector the old rule holds: every exchange feed must answer', () => {
    const days = dayList(7);
    const ok: GuScanSource = { name: 'NSE announcements', tier: 'PRIMARY', state: 'COMPLETE', scanned: 50, daysTried: days.slice(), daysOk: days.slice(), detail: 'ok' };
    const c = buildCoverageCard({ market: 'IN', window: '7D', windowDays: 7, now, scan: scanStatus([ok, blocked('BSE announcements', days)], days) });
    assert.equal(c.daysSuccessfullyRead, 0); assert.equal(c.daysPrimaryPartial, c.tradingDays);
  });

  test('pipeline state: collector OK → blocked NSE/BSE are "covered", coverage COMPLETE, documents waiting is a verification matter', () => {
    const base: GuPipelineInput = {
      market: 'IN', scanAt: 'x', servedFromStaleCache: false, staleCacheSavedAt: null,
      sources: [
        { name: 'NSE', state: 'FAILED', documents: 2000, daysOk: 0, daysTried: 30, detail: 'blocked' },
        { name: 'BSE', state: 'FAILED', documents: 0, daysOk: 0, daysTried: 30, detail: 'blocked' },
        { name: 'GitHub India collector', state: 'OK', documents: 86, daysOk: 86, daysTried: 86, detail: null },
      ],
      documentsDiscovered: 4000, documentsProcessed: 500, documentsPending: 3500, queueAwaiting: 0, queueReadNoGuidance: 0, queueUnavailable: 0,
      claims: 9, claimsPrimaryFound: 9, claimsPrimaryRead: 9, claimsVerified: 9, claimsContradicted: 0, verifiedGuidance: 19, processedNoGuidance: 0,
      daysFailed: 0, daysPartial: 0, daysNotRead: 0, tradingDays: 86, scanTradingDays: 86, scanDaysRead: 86,
    };
    const s = pipelineStateOf(base);
    assert.equal(s.sourceCoverage, 'COMPLETE');
    assert.equal(s.verification, 'PARTLY_VERIFIED');
    assert.equal(s.state, 'GUIDANCE_VERIFIED');
    assert.ok(s.reasons.some((r) => /NSE and BSE refuse this server; the GitHub collector read/.test(r)), s.reasons.join('|'));
    assert.ok(!s.reasons.some((r) => /do not answer/.test(r)));
    assert.deepEqual(s.scan, { read: 86, total: 86 });
    // no collector: the old wording and PARTIAL coverage stay
    const old = pipelineStateOf({ ...base, sources: base.sources.slice(0, 2) });
    assert.equal(old.sourceCoverage, 'PARTIAL');
    assert.ok(old.reasons.some((r) => /do not answer/.test(r)));
  });

  test('scanIndia 120D: the collector source row carries the whole window and its indexed days need no graded session', async () => {
    const cd = new Set(dayList(130).map((d) => d));   // collector indexed every day (IST days ≈ the same list here)
    const fail = async () => ({ ok: false, filings: [], reason: 'blocked' });
    const r = await scanIndia({ now, days: 120, window: '120D', fetchNse: fail, fetchBse: fail, collectorDays: cd, gradedDays: new Set<string>(), budgetMs: 500 });
    const row = r.status.sources.find((s) => s.name === 'GitHub India collector')!;
    assert.ok(row.daysTried!.length >= 120, `collector row tried ${row.daysTried!.length} days`);
    assert.equal(row.daysOk!.length, row.daysTried!.length);
    assert.equal(row.state, 'COMPLETE');
    assert.equal(r.status.daysCovered, r.status.daysRequested, 'every day of the window covered');
    assert.equal(r.status.missingDaysCount ?? 0, 0);
  });
});
