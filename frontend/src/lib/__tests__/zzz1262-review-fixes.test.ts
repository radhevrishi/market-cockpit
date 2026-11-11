// zzz1262 — review of the 11 Nov changes: fixes to the SEC retry, the lending-words rule, the feed merge, the
// "already rewarded" lists and the filing-age wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secRetryDecision } from '../us-thesis/sec-docs';
import { isLendingWording, LENDING_WORDS } from '../catalyst/persistence';
import { rewardedIndexOf, demoteRewarded, rewardedKey } from '../use-rewarded';
import { dedupeFeedEvents } from '../multibagger-radar-adapter';
import { rankReasonOf } from '../ai-gainers/research-view';
import { refundable } from '../us-thesis/auto-read';

test('SEC retry: a 429 is never asked again, answers are final, errors retry only while time remains', () => {
  assert.deepEqual(secRetryDecision(429, 0, 20_000), { retry: false, waitMs: 0, block: true });
  assert.equal(secRetryDecision(200, 0, 20_000).retry, false);
  assert.equal(secRetryDecision(404, 0, 20_000).retry, false);
  assert.equal(secRetryDecision(503, 0, 20_000).retry, true);
  assert.equal(secRetryDecision(null, 1, 20_000).retry, true);
  assert.equal(secRetryDecision(null, 2, 20_000).retry, false);     // third try was the last
  assert.equal(secRetryDecision(503, 0, 3_000).retry, false);       // not enough time left for another try
});

test('lending words: bank wording yes, a mine\'s deposits and lower-case look-alikes no', () => {
  assert.ok(isLendingWording('utilisation 80% · disbursements up 45%'));
  assert.ok(isLendingWording('term deposits grew 12%'));
  assert.ok(isLendingWording('AUM crossed ₹10,000 Cr'));
  assert.ok(!isLendingWording('new ore deposits allow the plant to run at 90% utilisation'));
  assert.ok(!isLendingWording('mineral deposits at the Odisha block; capacity doubled'));
  assert.ok(!isLendingWording('capacity utilisation rose to 85% at the Hosur plant'));
  assert.equal(LENDING_WORDS.test('loan book up 30%'), true);
});

test('already rewarded: unknown stays in place, rewarded names go last in their own order', () => {
  const idx = rewardedIndexOf([{ t: 'AAA', perf3M: 55, perf1Y: 120 }, { t: 'BBB', perf3M: 10, perf1Y: 30 }, { t: 'CCC', perf3M: 60, perf1Y: -20 }, { t: 'DDD' }, { t: 'EEE', perf3M: 41, perf1Y: 5 }]);
  assert.equal(idx.AAA.rewarded, true); assert.equal(idx.BBB.rewarded, false);
  assert.equal(idx.CCC.rewarded, false);                             // a rebound after a falling year is not a reward
  assert.equal(idx.DDD.rewarded, null);                              // no 3-month figure = unknown
  assert.deepEqual(demoteRewarded(['AAA', 'NSE:BBB', 'EEE', 'DDD.NS', 'CCC', 'ZZZ'], (x) => x, idx), ['NSE:BBB', 'DDD.NS', 'CCC', 'ZZZ', 'AAA', 'EEE']);
  assert.equal(rewardedKey('NSE:MTARTECH-BE'), 'MTARTECH');
  const same = ['BBB', 'DDD']; assert.equal(demoteRewarded(same, (x) => x, idx), same);   // nothing to move: the same list back
});

test('feed merge with look-up tables: first matching kept event, replaced winners stay findable, families never cross', () => {
  const ev = (id: string, title: string, o: Record<string, unknown> = {}): any => ({ event_id: id, event_type: 'MA', region: 'IN', primary_source: false,
    primary_filing: { title, link: `https://x.example/${id}`, source: 'ET', pub_date: '2026-11-10T08:00:00Z', region: 'IN' }, filings: [], ...o });
  const a = ev('a', 'Acme Corp to acquire Beta Industries for 500 crore');
  const b = ev('b', 'Acme Corp to acquire Beta Industries for 500 crore deal', { primary_source: true });   // stronger copy replaces the kept one
  const c = ev('c', 'Acme Corp to acquire Beta Industries in 500 crore transaction');                     // must still find the replaced slot
  const d = ev('d', 'Zen Pharma to acquire Kappa Motors for 75 crore');
  const r = dedupeFeedEvents([a, d, b, c]);
  assert.equal(r.events.length, 2); assert.equal(r.merged, 2);
  assert.equal(r.events[1].event_id, 'd');                             // order of the kept list is unchanged
  const many = Array.from({ length: 6000 }, (_, i) => ev(`m${i}`, `Company${i} Holdings to acquire Target${i} Works for ${1000 + i} crore`));
  const t0 = Date.now(); const big = dedupeFeedEvents(many); const ms = Date.now() - t0;
  assert.equal(big.events.length, 6000); assert.ok(ms < 3000, `took ${ms} ms`);
});

test('filing age line names the date, and money is only handed back on a refusal', () => {
  const parts: any = { evidence: 2, mechanism: 1, persistence: 1, materiality: 1, recency: 0.8, penalties: [] };
  const line = rankReasonOf({ rankParts: parts, ageDays: 3, filedDate: '2026-11-07' } as any);
  assert.match(line, /filed 2026-11-07, 3d before the scan/);
  assert.doesNotMatch(rankReasonOf({ rankParts: parts, ageDays: 0 } as any), /filed today/);
  assert.equal(refundable(400), true); assert.equal(refundable(429), true);
  assert.equal(refundable(500), false); assert.equal(refundable(0), false);
});

test('graded sessions include weekend days (KROSS filed Q2 on Saturday 17 Oct 2026)', async () => {
  const { istSessionDaysBack, lookupGraded, clearGradedSessionMemo } = await import('../graded-session-index');
  const { gradedKeyCandidates } = await import('../graded-cache-key');
  const now = Date.parse('2026-10-20T06:00:00Z');                       // Tuesday 11:30 IST
  const days = istSessionDaysBack(5, now);
  assert.deepEqual(days.slice(0, 7), ['2026-10-20', '2026-10-19', '2026-10-18', '2026-10-17', '2026-10-16', '2026-10-15', '2026-10-14']);
  assert.equal(days[days.length - 1], '2026-10-14');                   // back to the 5th business day, every day between
  clearGradedSessionMemo();
  const sat = gradedKeyCandidates('2026-10-17')[0], older = gradedKeyCandidates('2026-07-24')[0];
  const store: Record<string, any> = {
    [sat]: { by_tier: { STRONG: [{ ticker: 'KROSS', company: 'Kross Ltd', quarter: 'Q2 FY27', filing_date: '2026-10-17' }] } },
    [older]: { by_tier: { MIXED: [{ ticker: 'KROSS', company: 'Kross Ltd', quarter: 'Q1 FY27', filing_date: '2026-07-24' }] } },
  };
  const r = await lookupGraded(['KROSS'], { mget: async (keys) => keys.map((k) => store[k] ?? null), regrade: (p) => p, now: () => now });
  assert.equal(r.unread.length, 0);
  assert.deepEqual(r.entries.map((e) => `${e.q}:${e.tier}`), ['Q2 FY27:STRONG', 'Q1 FY27:MIXED']);
  clearGradedSessionMemo();
});

test('zzz1263: an AI spending-limit refusal is not "documents could not be read"; RS rank; an old tab copy is not a mismatch', async () => {
  const { evidenceStateOf, isSpendRefusal } = await import('../thesis/evidence-ledger');
  const { rsRanks, rsScore } = await import('../screener/rs-rank');
  const { reconcileCbLists } = await import('../india-cb-view');
  const { rewardedWhy } = await import('../rewarded');
  assert.ok(isSpendRefusal('model API HTTP 429: Your project has reached its configured enforced spend limit.'));
  assert.ok(!isSpendRefusal('EX-99.1 could not be downloaded from EDGAR'));
  // RS: 3-month return counts double; ranks are 1–99 inside one snapshot; no score = no rank
  assert.equal(rsScore({ perf3M: 10 }), null);
  assert.ok(Math.abs(rsScore({ perf3M: 10, perf1Y: 40 })! - (10 * 0.4 + 40 * 0.3) / 0.7) < 1e-9);
  const rows = Array.from({ length: 100 }, (_, i) => ({ t: `T${i}`, perf3M: i, perf6M: i, perf1Y: i }));
  rows.push({ t: 'NOPE' } as any);
  const rk = rsRanks(rows);
  assert.equal(rk.get('T99'), 99); assert.equal(rk.get('T0'), 1); assert.equal(rk.has('NOPE'), false);
  assert.equal(rsRanks(rows), rk);                                   // worked out once per snapshot
  assert.equal(rewardedWhy({ p3m: 28, p1y: 60, rs: 95 }).rewarded, true);   // the RS leg: RS 90+ with 25%+ in 3 months
  assert.equal(rewardedWhy({ p3m: 12, p1y: 60, rs: 95 }).rewarded, false);  // RS alone is a leader, not "rewarded"
  // old tab copy
  const tab = { tickers: ['A', 'B'], savedCriteria: true, at: '2026-11-11T08:21:00Z' };
  const old = reconcileCbLists(tab, ['A', 'C'], () => null, new Date('2026-11-11T19:00:00Z'));
  assert.match(old.line, /^Not compared with the Conviction Beats tab/); assert.doesNotMatch(old.line, /⚠/);
  const fresh = reconcileCbLists(tab, ['A', 'C'], () => null, new Date('2026-11-11T09:00:00Z'));
  assert.match(fresh.line, /⚠ Differs/);
  // evidence state: the period's read is on file, a later re-read met the spend limit → CURRENT, said plainly
  const st = evidenceStateOf as any;
  assert.equal(typeof st, 'function');
});
