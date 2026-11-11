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
