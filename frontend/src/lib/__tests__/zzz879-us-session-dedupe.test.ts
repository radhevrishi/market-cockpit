// zzz879 — one card per company per quarter across US sessions; US bench age + cap default.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sessionIndexOf, priorSessions, dropShownEarlier, usQuarterId } from '../us-session-dedupe';
import { mergeDayPayloads } from '../us-merge';
import { isUsBenchAged, usCbMigrateU30, usCbFiltersForOwner, passesUsConvictionFilter, US_FILTER_DEFAULT, US_CB_U30_FLAG_KEY } from '../conviction-beats-us';

const row = (ticker: string, date: string, extra: any = {}) => ({ ticker, company: `${ticker} Inc`, quarter: 'Q4 FY26', period_end: '2026-06-30', form: '8-K', filing_date: date, filing_url: 'u', tier: 'MIXED', composite_score: 50, prelim: null, ...extra });
const day = (date: string, rows: any[]) => ({ filing_date: date, window_days: 1, window_start: date, candidates_total: rows.length, raw_items_total: 0, pending_xbrl_total: 0, no_price_total: 0,
  by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: rows, AVOID: [] }, pending: [], scheduled: [], generated_at: `${date}T20:00:00Z`, sources_polled: 3, truncated: false, notes: [] } as any);

describe('zzz879 — US session dedupe', () => {
  test('quarter identity and the index', () => {
    assert.equal(usQuarterId(row('A', '2026-09-24')), '2026-06-30');
    assert.equal(usQuarterId({ quarter: 'q4 fy26' }), 'Q4 FY26');
    assert.deepEqual(sessionIndexOf(day('2026-09-24', [row('lgcy', '2026-09-24'), row('WOR', '2026-09-24', { prelim: true })])).sort(), ['LGCY|2026-06-30|F', 'WOR|2026-06-30|P']);
  });
  test('prior sessions skip weekends', () => {
    assert.deepEqual(priorSessions('2026-09-29', 3), ['2026-09-28', '2026-09-25', '2026-09-24']);
  });
  test('LGCY: 10-K on 24 Sep, 8-K on 29 Sep → the 29 Sep card moves to "reported earlier"', () => {
    const later = day('2026-09-29', [row('LGCY', '2026-09-29'), row('NEW', '2026-09-29')]);
    const out = dropShownEarlier(later, [{ date: '2026-09-24', index: ['LGCY|2026-06-30|F'] }, { date: '2026-09-25', index: [] }]);
    assert.deepEqual(out.by_tier.MIXED.map((r: any) => r.ticker), ['NEW']);
    assert.equal(out.pending[0].ticker, 'LGCY'); assert.equal(out.pending[0].reason, 'reported-earlier'); assert.equal(out.pending[0].shown_on, '2026-09-24');
    assert.equal(out.session_dedupe, 1); assert.ok(out.notes[0].includes('LGCY (2026-09-24)'));
    assert.equal(later.by_tier.MIXED.length, 2, 'input untouched');
  });
  test('a different quarter is not a duplicate; the oldest showing is the one named', () => {
    const later = day('2026-09-29', [row('LGCY', '2026-09-29', { period_end: '2026-09-30' })]);
    assert.equal(dropShownEarlier(later, [{ date: '2026-09-24', index: ['LGCY|2026-06-30|F'] }]).by_tier.MIXED.length, 1);
    const twice = dropShownEarlier(day('2026-09-29', [row('ATCH', '2026-09-29')]), [{ date: '2026-09-25', index: ['ATCH|2026-06-30|F'] }, { date: '2026-09-23', index: ['ATCH|2026-06-30|F'] }]);
    assert.equal(twice.pending[0].shown_on, '2026-09-23');
  });
  test('an earlier PRELIM card does not hide a later full-numbers card; an earlier prelim hides a later prelim', () => {
    const full = dropShownEarlier(day('2026-09-25', [row('WOR', '2026-09-25')]), [{ date: '2026-09-22', index: ['WOR|2026-06-30|P'] }]);
    assert.equal(full.by_tier.MIXED.length, 1);
    const pre = dropShownEarlier(day('2026-09-25', [row('WOR', '2026-09-25', { prelim: true })]), [{ date: '2026-09-22', index: ['WOR|2026-06-30|P'] }]);
    assert.equal(pre.by_tier.MIXED.length, 0);
  });
  test('re-applying is harmless; a multi-day window shows the card and no "already shown" chip', () => {
    const once = dropShownEarlier(day('2026-09-29', [row('LGCY', '2026-09-29')]), [{ date: '2026-09-24', index: ['LGCY|2026-06-30|F'] }]);
    const twice = dropShownEarlier(once, [{ date: '2026-09-24', index: ['LGCY|2026-06-30|F'] }]);
    assert.equal(twice.pending.length, 1); assert.equal(twice.notes.filter((n: string) => n.startsWith('already shown')).length, 0, 'nothing new moved, old note dropped');
    const merged = mergeDayPayloads([day('2026-09-24', [row('LGCY', '2026-09-24', { form: '10-K' })]), once], '2026-09-29', '2026-09-24', 5);
    assert.equal(merged.by_tier.MIXED.length, 1);
    assert.equal(merged.pending.filter((p: any) => p.ticker === 'LGCY').length, 0);
  });
});

describe('zzz879 — US Conviction Beats age + cap default', () => {
  test('older than 60 days is greyed', () => {
    const d = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    assert.equal(isUsBenchAged({ filing_date: d(30) }), false);
    assert.equal(isUsBenchAged({ filing_date: d(75) }), true);
    assert.equal(isUsBenchAged({ filing_date: null }), false);
  });
  test('the Under $30B band and its one-time default', () => {
    const e = (m: number | null) => ({ ticker: 'X', company: 'X', market_cap_musd: m } as any);
    const f = { ...US_FILTER_DEFAULT, cap: 'u30' };
    assert.equal(passesUsConvictionFilter(e(25_000), f), true);
    assert.equal(passesUsConvictionFilter(e(31_000), f), false);
    assert.equal(passesUsConvictionFilter(e(null), f), false);
    assert.equal(usCbMigrateU30({ ...US_FILTER_DEFAULT, cap: 'smid' }).cap, 'u30');
    assert.equal(usCbMigrateU30({ ...US_FILTER_DEFAULT, cap: 'all' }).cap, 'u30');
    assert.equal(usCbMigrateU30({ ...US_FILTER_DEFAULT, cap: 'small' }).cap, 'small', 'a hand-picked band is kept');
    assert.equal(usCbFiltersForOwner(() => null).cap, 'u30');
    const saved = JSON.stringify({ ...US_FILTER_DEFAULT, cap: 'all' });
    const get = (flag: boolean) => (k: string) => (k === US_CB_U30_FLAG_KEY ? (flag ? '1' : null) : k === 'mc:us-cb:filters:v1' ? saved : k === 'mc:us-cb:preset:v1:optout' ? '1' : null);
    assert.equal(usCbFiltersForOwner(get(false)).cap, 'u30');
    assert.equal(usCbFiltersForOwner(get(true)).cap, 'all', 'after the move, All chosen by hand stays');
  });
});
