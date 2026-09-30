import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanIndia, scanUs, normaliseBlobRow, runBounded, finaliseScan } from '../guidance-upgrades-scan';
import type { DayFetcher } from '../guidance-upgrades-scan';
import { looksLikeGuidanceRaise, isGuidanceRelevantFiling, coverageLine, consensusLabel, dedupeCandidates, filingToCandidate, type MarketCoverage } from '../guidance-upgrades-candidates';
import { isGuidanceUpgradeCandidate, processCandidates } from '../guidance-upgrades';

const NOW = new Date('2026-09-23T10:00:00Z');
const cupidRow = (day: string) => ({
  exchange: 'NSE', symbol: 'CUPID', company_name: 'Cupid Ltd',
  subject: 'Corporate Announcement - Outcome of AGM / Investor Presentation',
  detail: 'At the 33rd AGM the company further raised FY27 guidance: revenue target raised to Rs 725-750 crore from Rs 600 crore, and net profit guidance raised to Rs 210-225 crore from Rs 180 crore.',
  category: 'Company Update', subcategory: null, filing_datetime: `${day}T05:30:00.000Z`,
  attachment_urls: ['https://example.test/agm.pdf'], source_url: 'https://example.test/s', content_hash: `h-${day}`,
});
const noise = (day: string) => ({ exchange: 'NSE', symbol: 'ZZZ1', company_name: 'Zed', subject: 'Trading Window closure', category: 'Insider Trading', filing_datetime: `${day}T04:00:00.000Z`, attachment_urls: [], source_url: 'x', content_hash: `n-${day}` });
const okFetch = (rows: (d: string) => any[]): DayFetcher => async (d) => ({ ok: true, filings: rows(d) });
const today = NOW.toISOString().slice(0, 10);

test('Cupid-style same-day raise is discovered with NO consensus', async () => {
  const r = await scanIndia({ now: NOW, days: 7, fetchNse: okFetch((d) => (d === today ? [cupidRow(d), noise(d)] : [noise(d)])), fetchBse: okFetch(() => []), readBlob: async () => null });
  assert.equal(r.status.complete, true);
  assert.equal(r.status.daysCovered, 7);
  assert.equal(r.candidates.length, 1);
  const c = r.candidates[0];
  assert.equal(c.market, 'IN'); assert.equal(c.ticker, 'CUPID');
  assert.equal(isGuidanceUpgradeCandidate(c).include || looksLikeGuidanceRaise(`${c.title}. ${c.text}`), true);
  // engine level: no consensus supplied anywhere
  try {
    const ev = processCandidates([c], () => ({}), NOW, '7D');
    assert.ok(Array.isArray(ev));
    if (ev.length) assert.equal(ev[0].consensus.value, null);
  } catch (e) { assert.fail(`engine must not require consensus: ${e}`); }
});

test('partial failure: complete=false, SCAN INCOMPLETE note, line never blames consensus', async () => {
  const nse: DayFetcher = async (d) => (d < '2026-09-22' ? { ok: false, filings: [], reason: 'NSE HTTP 403' } : { ok: true, filings: [] });
  const r = await scanIndia({ now: NOW, days: 7, fetchNse: nse, fetchBse: okFetch(() => []) });
  assert.equal(r.status.complete, false);
  assert.ok(r.status.daysCovered < r.status.daysRequested);
  assert.match(r.status.note, /SCAN INCOMPLETE/);
  assert.match(r.status.note, /NOT a confirmation/);
  const nseSrc = r.status.sources.find((s) => s.name.startsWith('NSE'))!;
  assert.equal(nseSrc.state, 'PARTIAL');
  const cov: MarketCoverage = { market: 'IN', candidates: { graded: 0, filings: 0, news: 0 }, cacheEmpty: [], events: 0, withConsensus: 0, newest: null, scan: r.status };
  const line = coverageLine(cov, NOW);
  assert.match(line, /SCAN INCOMPLETE/);
  assert.match(line, /NOT a confirmation of no upgrades/);
  assert.doesNotMatch(line, /consensus unavailable|because consensus/i);
});

test('all sources failing or not wired is never COMPLETE', async () => {
  const bad: DayFetcher = async () => { throw new Error('boom'); };
  const r = await scanIndia({ now: NOW, days: 3, fetchNse: bad, fetchBse: bad });
  assert.equal(r.status.complete, false);
  assert.equal(r.status.sources[0].state, 'FAILED');
  const r2 = await scanIndia({ now: NOW, days: 3 });
  assert.equal(r2.status.complete, false);
});

test('complete line and consensus formatting', async () => {
  const r = await scanIndia({ now: NOW, days: 7, fetchNse: okFetch(() => []), fetchBse: okFetch(() => []), readBlob: async (d) => (d === today ? [cupidRow(d)] : null) });
  assert.equal(r.status.complete, true);
  const cov: MarketCoverage = { market: 'IN', candidates: { graded: 0, filings: 4, news: 0 }, cacheEmpty: [], events: 2, withConsensus: 0, newest: null, scan: r.status, verified: 2 };
  const line = coverageLine(cov, NOW);
  assert.match(line, /^India: SCAN COMPLETE — 7 of 7 days, 3 sources; 4 candidates, 2 verified/);
  assert.match(line, /Consensus available 0 of 2/);
  assert.equal(consensusLabel(1, 3), 'Consensus available 1 of 3');
  assert.equal(r.candidates.length, 1);   // from the blob
});

test('0-candidate India state never mentions consensus as a reason', () => {
  const cov: MarketCoverage = { market: 'IN', candidates: { graded: 0, filings: 0, news: 0 }, cacheEmpty: ['results cache'], events: 0, withConsensus: 0, newest: null };
  const line = coverageLine(cov, NOW);
  assert.doesNotMatch(line, /raise candidates|because consensus|no analyst estimates feed/i);
});

test('US: 6 of 7 warm sessions is PARTIAL with awaitingGrading, not coverage', async () => {
  const r = await scanUs({
    now: NOW, days: 5, warmSessions: 6, totalSessions: 7, gradedTickers: new Set(['AAA']), warmDates: new Set(['2026-09-22']),
    fetchEdgar: async (d) => (d === '2026-09-23' ? [{ form: '8-K', items: ['2.02'], ticker: 'BBB', company: 'B', filed: d, filing_url: 'u' }, { form: '8-K', items: ['5.02'], ticker: 'CCC', company: 'C', filed: d, filing_url: 'u' }] : []),
  });
  assert.equal(r.status.complete, false);
  assert.equal(r.status.awaitingGrading, 1);
  assert.equal(r.status.sources[0].state, 'PARTIAL');
  assert.match(r.status.note, /SCAN INCOMPLETE/);
  assert.match(r.status.note, /awaiting grading/);
});

test('US: EDGAR not run is honest NOT_RUN and incomplete', async () => {
  const r = await scanUs({ now: NOW, days: 5, warmSessions: 7, totalSessions: 7 });
  assert.equal(r.status.sources[1].state, 'NOT_RUN');
  assert.equal(r.status.complete, false);
});

test('semantic phrases kept; analyst wording not', () => {
  for (const t of ['Company raises FY27 guidance', 'Management now expects revenue of 500 crore', 'revises outlook upward', 'hikes revenue target for FY27', 'upgrades guidance for the year'])
    assert.equal(looksLikeGuidanceRaise(t), true, t);
  assert.equal(looksLikeGuidanceRaise('Broker raises price target on stock'), false);
  assert.equal(looksLikeGuidanceRaise('Trading window closure'), false);
  assert.equal(isGuidanceRelevantFiling({ subject: 'Outcome of Board Meeting' }), true);
  assert.equal(isGuidanceRelevantFiling({ subject: 'Change in Director' }), false);
});

test('helpers: bounded runner tolerates failures and budget; blob row normaliser; dedupe with cache', async () => {
  const res = await runBounded([1, 2, 3], async (x) => { if (x === 2) throw new Error('x'); return x; }, { budgetMs: 500 });
  assert.deepEqual(res.map((r) => r.ok), [true, false, true]);
  const slow = await runBounded([1], () => new Promise<number>((r) => setTimeout(() => r(1), 400)), { budgetMs: 50 });
  assert.equal(slow[0].ok, false);
  assert.equal(normaliseBlobRow({ subject: 's', an_dt: '2026-09-22T00:00:00Z', SYMBOL: 'abc' })?.symbol, 'ABC');
  assert.equal(normaliseBlobRow({ subject: '' }), null);
  const a = filingToCandidate(cupidRow(today))!;
  assert.equal(dedupeCandidates([a, { ...a }]).length, 1);
  const s = finaliseScan({ market: 'IN', windowFrom: '', windowTo: '', complete: true, lastScanAt: '', sources: [], daysCovered: 2, daysRequested: 2, candidatesFound: 0, processed: 0, awaitingGrading: 0, verified: 0, newestItemAt: null, note: '' }, { found: 3, processed: 2, verified: 1 });
  assert.equal(s.candidatesFound, 3);
});
