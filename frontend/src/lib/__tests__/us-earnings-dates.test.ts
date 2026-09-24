// US earnings calendar — ET day boundary, snapshot finality, ticker matching,
// after-close re-dating, counted exclusions, remembered date, XBRL freshness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  usEasternDate, etMidnightAfterUtcMs, isFinalSnapshot, snapshotFresh, prevWeekdayIso,
  normalizeUsTicker, afterHoursAnnouncementDate, countExclusion, mergeExclusions, formatExclusions,
  encodeSelectedDate, restoreSelectedDate, classifyXbrlFreshness,
} from '../us-earnings-dates';
import { parseNasdaqEarningsRow } from '../us-nasdaq';
import { mergeDayPayloads } from '../us-merge';

const utc = (s: string) => Date.parse(s);
const MIN = 60_000, H = 3600_000, D = 86_400_000;

test('ET day boundary: a 16:05 ET release on 24 Sep is 24 Sep, though IST says 25 Sep', () => {
  // 16:05 EDT = 20:05 UTC = 01:35 IST next day
  assert.equal(usEasternDate(utc('2026-09-24T20:05:00Z')), '2026-09-24');
  // 23:59 EDT is still the 24th; 00:00 EDT (04:00 UTC) is the 25th
  assert.equal(usEasternDate(utc('2026-09-25T03:59:00Z')), '2026-09-24');
  assert.equal(usEasternDate(utc('2026-09-25T04:00:00Z')), '2026-09-25');
  // pre-market 07:12 ET = 11:12 UTC = 16:42 IST, same date everywhere
  assert.equal(usEasternDate(utc('2026-09-24T11:12:00Z')), '2026-09-24');
  // Early IST morning (09:00 IST = 23:30 ET the previous day) is still yesterday in the US
  assert.equal(usEasternDate(utc('2026-09-24T03:30:00Z')), '2026-09-23');
});

test('ET day boundary in winter (EST): the old UTC−4 rule flipped the date an hour early', () => {
  // 23:30 EST on 15 Jan = 04:30 UTC on 16 Jan. UTC−4 would say the 16th.
  assert.equal(usEasternDate(utc('2027-01-16T04:30:00Z')), '2027-01-15');
  assert.equal(new Date(utc('2027-01-16T04:30:00Z') - 4 * H).toISOString().slice(0, 10), '2027-01-16');
  assert.equal(usEasternDate(utc('2027-01-16T05:00:00Z')), '2027-01-16');
});

test('midnight after an ET day: 04:00 UTC in EDT, 05:00 UTC in EST, correct across DST changes', () => {
  assert.equal(etMidnightAfterUtcMs('2026-09-24'), utc('2026-09-25T04:00:00Z'));
  assert.equal(etMidnightAfterUtcMs('2027-01-15'), utc('2027-01-16T05:00:00Z'));
  // DST ends 1 Nov 2026 at 02:00 — midnight starting 1 Nov is still EDT
  assert.equal(etMidnightAfterUtcMs('2026-10-31'), utc('2026-11-01T04:00:00Z'));
  assert.equal(etMidnightAfterUtcMs('2026-11-01'), utc('2026-11-02T05:00:00Z'));
  // DST starts 14 Mar 2027 at 02:00 — midnight starting 14 Mar is still EST
  assert.equal(etMidnightAfterUtcMs('2027-03-13'), utc('2027-03-14T05:00:00Z'));
  assert.equal(etMidnightAfterUtcMs('2027-03-14'), utc('2027-03-15T04:00:00Z'));
});

test('a snapshot taken during the day is NOT final once the day ends (the frozen-day bug)', () => {
  const day = '2026-09-24';
  const morning = utc('2026-09-24T13:00:00Z');      // 09:00 ET — before after-close reporters
  const nextDay = utc('2026-09-25T14:00:00Z');
  assert.equal(isFinalSnapshot(day, morning), false);
  // the old read-time rule: "date is past → 30 days" would have served it
  assert.equal(snapshotFresh(day, morning, nextDay, 10 * MIN, 30 * D), false);
  // while the day is running, a live TTL applies
  assert.equal(snapshotFresh(day, morning, morning + 5 * MIN, 10 * MIN, 30 * D), true);
  assert.equal(snapshotFresh(day, morning, morning + 11 * MIN, 10 * MIN, 30 * D), false);
  // a snapshot taken after ET midnight is final and long-lived
  const after = utc('2026-09-25T04:30:00Z');
  assert.equal(isFinalSnapshot(day, after), true);
  assert.equal(snapshotFresh(day, after, after + 20 * D, 10 * MIN, 30 * D), true);
  assert.equal(snapshotFresh(day, after, after + 31 * D, 10 * MIN, 30 * D), false);
  // 23:55 ET snapshot, read at 00:05 ET: day over, snapshot not final → refetch
  assert.equal(snapshotFresh(day, utc('2026-09-25T03:55:00Z'), utc('2026-09-25T04:05:00Z'), 10 * MIN, 30 * D), false);
  // garbage timestamps are never fresh
  assert.equal(snapshotFresh(day, NaN, nextDay, 10 * MIN, 30 * D), false);
  // a future date keeps the live TTL
  assert.equal(snapshotFresh('2026-10-01', morning, morning + 5 * MIN, 10 * MIN, 30 * D), true);
});

test('ticker matching across SEC / Nasdaq / TradingView spellings; short tickers intact', () => {
  assert.equal(normalizeUsTicker('BRK.B'), 'BRK-B');
  assert.equal(normalizeUsTicker('brk/b'), 'BRK-B');
  assert.equal(normalizeUsTicker('BRK-B'), 'BRK-B');
  assert.equal(normalizeUsTicker(' bb '), 'BB');
  assert.equal(normalizeUsTicker('F'), 'F');
  assert.equal(normalizeUsTicker(null), '');
});

test('after-close 8-K dated the next business day is placed on its scheduled after-hours day', () => {
  const sched: Record<string, Array<{ ticker: string; time: string }>> = {
    '2026-09-24': [{ ticker: 'XYZ', time: 'after-hours' }, { ticker: 'BB', time: 'pre-market' }],
    '2026-09-25': [{ ticker: 'ABC', time: 'pre-market' }],
    '2026-09-25x': [],
  };
  const f = (d: string) => sched[d];
  // XYZ scheduled AMC Thu, 8-K dated Fri → Thu
  assert.equal(afterHoursAnnouncementDate('XYZ', '2026-09-25', f), '2026-09-24');
  // ABC scheduled on the filing day → stays
  assert.equal(afterHoursAnnouncementDate('ABC', '2026-09-25', f), null);
  // BB scheduled PRE-market the day before → no evidence for an evening release → stays
  assert.equal(afterHoursAnnouncementDate('BB', '2026-09-25', f), null);
  // unknown to the schedule → stays where EDGAR put it
  assert.equal(afterHoursAnnouncementDate('QQQQ', '2026-09-25', f), null);
  // Monday filing looks back to Friday, not Sunday
  assert.equal(prevWeekdayIso('2026-09-28'), '2026-09-25');
  const fri = (d: string) => (d === '2026-09-25' ? [{ ticker: 'MON', time: 'after-hours' }] : []);
  assert.equal(afterHoursAnnouncementDate('MON', '2026-09-28', fri), '2026-09-25');
});

test('exclusions are counted and rendered as "N excluded: reason"', () => {
  const a = countExclusion(countExclusion({}, 'not listed on a major US exchange'), 'not listed on a major US exchange');
  countExclusion(a, 'shell / SPAC / trust');
  countExclusion(a, 'ignored', 0);
  assert.deepEqual(a, { 'not listed on a major US exchange': 2, 'shell / SPAC / trust': 1 });
  assert.equal(formatExclusions(a), '3 excluded: 2 not listed on a major US exchange, 1 shell / SPAC / trust');
  assert.equal(formatExclusions({}), '');
  assert.equal(formatExclusions(null), '');
  assert.deepEqual(mergeExclusions(a, { 'shell / SPAC / trust': 2 }, null), { 'not listed on a major US exchange': 2, 'shell / SPAC / trust': 3 });
});

test('remembered page date: "today" reopens as the new today; a picked day stays pinned', () => {
  // saved on Monday while Monday was today → Thursday opens on Thursday
  assert.equal(restoreSelectedDate(encodeSelectedDate('2026-09-21', '2026-09-21'), '2026-09-24'), '2026-09-24');
  // deliberately picked an earlier day → kept
  assert.equal(restoreSelectedDate(encodeSelectedDate('2026-09-10', '2026-09-21'), '2026-09-24'), '2026-09-10');
  // legacy bare string cannot say → today
  assert.equal(restoreSelectedDate('2026-09-21', '2026-09-24'), '2026-09-24');
  assert.equal(restoreSelectedDate(null, '2026-09-24'), '2026-09-24');
  assert.equal(restoreSelectedDate('{"d":"bad","pinned":true}', '2026-09-24'), '2026-09-24');
  // a pinned date in the future is clamped
  assert.equal(restoreSelectedDate('{"d":"2026-12-01","pinned":true}', '2026-09-24'), '2026-09-24');
});

test('XBRL freshness: fast reporters are "numbers pending", not "reported earlier"', () => {
  // a bank reporting Q2 on 14 Jul; XBRL still Q1 (31 Mar, filed 1 May) — 105 days
  assert.equal(classifyXbrlFreshness({ filed: '2026-07-14', qEnd: '2026-03-31', qFiled: '2026-05-01' }), 'quarter-stale');
  // AIN: a strategic-review 2.02 8-K 63 days after a quarter already on EDGAR
  assert.equal(classifyXbrlFreshness({ filed: '2026-09-01', qEnd: '2026-06-30', qFiled: '2026-08-04' }), 'reported-earlier');
  // BlackBerry fiscal Q2 (Aug) on 24 Sep; XBRL holds fiscal Q1 (31 May) — 116 days
  assert.equal(classifyXbrlFreshness({ filed: '2026-09-24', qEnd: '2026-05-31', qFiled: '2026-06-25' }), 'quarter-stale');
  // the 10-Q/8-K land together: current
  assert.equal(classifyXbrlFreshness({ filed: '2026-08-05', qEnd: '2026-06-30', qFiled: '2026-08-05' }), 'current');
  // explicit mode skips the already-public guard
  assert.equal(classifyXbrlFreshness({ filed: '2026-09-01', qEnd: '2026-06-30', qFiled: '2026-08-04', checkAlreadyPublic: false }), 'current');
});

test('Nasdaq row parse: 2-letter ticker, pre-market time, market cap in $M, no filter on missing estimates', () => {
  const r = parseNasdaqEarningsRow({
    lastYearRptDt: 'N/A', lastYearEPS: '$0.03', time: 'time-pre-market', symbol: 'BB',
    name: 'BlackBerry Limited', marketCap: '$5,061,469,700', fiscalQuarterEnding: 'Aug/2026',
    epsForecast: '$0.03', noOfEsts: 'N/A',
  });
  assert.ok(r);
  assert.equal(r!.ticker, 'BB');
  assert.equal(r!.time, 'pre-market');
  assert.equal(Math.round(r!.market_cap_musd!), 5061);
  assert.equal(r!.estimates_n, null);
  assert.equal(r!.last_year_report_date, null);
  assert.equal(parseNasdaqEarningsRow({ symbol: 'BRK/B', time: 'time-after-hours', marketCap: 'N/A' })!.time, 'after-hours');
  assert.equal(parseNasdaqEarningsRow({ symbol: '' }), null);
});

test('window merge sums per-day exclusions and drops a scheduled name once graded under another spelling', () => {
  const empty = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] } as any;
  const base = {
    window_days: 1, window_start: null, candidates_total: 0, raw_items_total: 0, pending_xbrl_total: 0,
    no_price_total: 0, pending: [], scheduled: [], generated_at: '2026-09-24T12:00:00Z', sources_polled: 3,
    truncated: false, notes: [],
  };
  const d1 = { ...base, filing_date: '2026-09-23', by_tier: empty, excluded: { 'shell / SPAC / trust': 1 }, notes: ['1 excluded: 1 shell / SPAC / trust'] };
  const d2 = {
    ...base, filing_date: '2026-09-24',
    by_tier: { ...empty, MIXED: [{ ticker: 'BRK-B', tier: 'MIXED', composite_score: 1, filing_date: '2026-09-24' }] },
    scheduled: [{ ticker: 'BRK/B', time: 'pre-market' }, { ticker: 'BB', time: 'pre-market' }],
    excluded: { 'shell / SPAC / trust': 2, 'not listed on a major US exchange': 1 },
  };
  const m = mergeDayPayloads([d1 as any, d2 as any], '2026-09-24', '2026-09-23', 2);
  assert.deepEqual(m.excluded, { 'shell / SPAC / trust': 3, 'not listed on a major US exchange': 1 });
  assert.ok(m.notes.includes('4 excluded: 3 shell / SPAC / trust, 1 not listed on a major US exchange'));
  assert.ok(!m.notes.includes('1 excluded: 1 shell / SPAC / trust'));
  assert.deepEqual(m.scheduled.map((s: any) => s.ticker), ['BB']);
});
