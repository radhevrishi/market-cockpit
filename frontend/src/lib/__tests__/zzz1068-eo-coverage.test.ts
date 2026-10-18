import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isNseResultsAnnouncement, nseIstToIso, istDateOf, periodEndFromText, fyQuarterLabelForEnd, filedFiguresPendingReason,
} from '../india-results-filing';
import { pendingReasonWord } from '../eo-pending-reason';
import { shortDropReason, isUnconfirmedDrop } from '../india-earnings-window';
import { cashTileView, yearCashFigures, fmtCrSigned } from '../india-eo-card-data';
import { cbCashView, indiaPresetFilters, passesConvictionFilter, FILTER_DEFAULT, parseCbCapFloor, CB_PRESET_CAP_KEY, cbCriteriaCheck, CB_CAP_FLOORS } from '../conviction-filter-india';
import { parseSmallMidPref, EO_SMALL_MID_KEY, EO_SMALL_MID_DEFAULT } from '../small-mid-filter';
import { usCbFiltersForOwner, usCbMigrateAllSize, usPresetFilters, US_FILTER_DEFAULT, US_CB_ALL_SIZE_FLAG_KEY, passesUsConvictionFilter } from '../conviction-beats-us';
import { eoTodayPollMs, eoTodayPollLabel } from '../eo-poll';
import { deCell, deFromSnapshotRow, deIndex, passesDeMax, growthCell, returnCell } from '../cb-metric-view';
import { annualCashFromSeries } from '../us-annual-cash';

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// Real NSE corporate-announcements rows from Saturday 17 Oct 2026 (trimmed).
const KROSS = { symbol: 'KROSS', desc: 'Outcome of Board Meeting', an_dt: '17-Oct-2026 18:00:50', attchmntText: 'The Unaudited Financial Results for the quarter and half-year ended on 30th September 2026, duly reviewed by the Audit Committee and approved by the Board of the Directors at their meeting held today' };
const ICICI = { symbol: 'ICICIBANK', desc: 'Outcome of Board Meeting', an_dt: '17-Oct-2026 15:21:44', attchmntText: 'ICICI Bank Limited has submitted to the Exchange, the unaudited financial results of the Bank (standalone and consolidated) for the quarter and six months ended September 30, 2026.' };
const PSB = { symbol: 'PSB', desc: 'Outcome of Board Meeting', an_dt: '17-Oct-2026 18:41:06', attchmntText: 'Punjab & Sind Bank has submitted to the Exchange, the financial results for the period ended September 30, 2026.' };
const YES_PR = { symbol: 'YESBANK', desc: 'Press Release', an_dt: '17-Oct-2026 20:12:08', attchmntText: 'Press Release and Investor Presentation on the Financial Results for the Quarter (Q2) ended on September 30, 2026' };
const NOT = [
  { symbol: 'ROSSARI', desc: 'Outcome of Board Meeting', attchmntText: 'Outcome of Board Meeting held on October 17, 2026.' },
  { symbol: 'YESBANK', desc: 'Outcome of Board Meeting', attchmntText: 'Disclosure under Regulation 30 of SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015   Change in Senior Management Personnel (SMP) of the Bank' },
  { symbol: 'ICICIBANK', desc: 'Analysts/Institutional Investor Meet/Con. Call Updates', attchmntText: 'link of audio recording of the call with media and of earnings call with analysts and investors on the financial results for quarter ended' },
  { symbol: 'KROSS', desc: 'Investor Presentation', attchmntText: 'Kross Limited has informed the Exchange about Investor Presentation' },
  { symbol: 'X', desc: 'Board Meeting Intimation', attchmntText: 'to consider and approve the unaudited financial results for the quarter ended September 30, 2026' },
  { symbol: 'Y', desc: 'Outcome of Board Meeting', attchmntText: 'Clarification on the financial results for the quarter ended June 30, 2026' },
  { symbol: 'Z', desc: 'Copy of Newspaper Publication', attchmntText: 'Newspaper publication of unaudited financial results for the quarter ended September 30, 2026' },
];

describe('zzz1068 — a Saturday results filing is detected', () => {
  test('NSE category + attachment text: results filings pass, look-alikes do not', () => {
    for (const e of [KROSS, ICICI, PSB, YES_PR]) assert.equal(isNseResultsAnnouncement(e), true, e.symbol);
    for (const e of NOT) assert.equal(isNseResultsAnnouncement(e), false, `${e.symbol}: ${e.attchmntText}`);
  });
  test('the old scanner read only `desc` — a bare "Outcome of Board Meeting" — and could never pass', () => {
    const src = read('src/app/api/v1/earnings/today-live/route.ts');
    assert.match(src, /isNseResultsAnnouncement\(e\)/);
    assert.doesNotMatch(src, /const subject = String\(e\.subject \|\| e\.desc/);
    assert.match(src, /today-live:v2:/);
  });
  test('the filing time is IST, on Saturday 17 Oct, and names its quarter', () => {
    const iso = nseIstToIso(KROSS.an_dt)!;
    assert.equal(iso, '2026-10-17T12:30:50.000Z');
    assert.equal(istDateOf(iso), '2026-10-17');
    assert.equal(new Date(iso).getUTCDay(), 6, 'a Saturday');
    assert.equal(istDateOf(nseIstToIso('17-Oct-2026 23:43:36')!), '2026-10-17', 'a late-evening filing stays on its IST date');
    assert.equal(periodEndFromText(KROSS.attchmntText), '2026-09-30');
    assert.equal(periodEndFromText(PSB.attchmntText), '2026-09-30');
    assert.equal(periodEndFromText('results for the quarter ended 30.06.2026'), '2026-06-30');
    assert.equal(fyQuarterLabelForEnd('2026-09-30'), 'Q2 FY27');
    assert.equal(fyQuarterLabelForEnd('2026-03-31'), 'Q4 FY26');
    assert.equal(fyQuarterLabelForEnd('2026-10-17'), null);
  });
  test('the hub confirms a meeting held TODAY (was: only past meetings)', () => {
    const src = read('src/app/api/market/earnings/route.ts');
    assert.match(src, /quality: \(confirmed && meetingDate\.getTime\(\) <= today\.getTime\(\)\)/);
    assert.doesNotMatch(src, /quality: \(isPast && confirmed\)/);
  });
  test('the graded route upgrades a board-meeting row the exchange feed shows as filed', () => {
    const src = read('src/app/api/v1/earnings/graded/route.ts');
    assert.match(src, /upgradeToConfirmedByLiveFiling\(dayList, sym, f\)/);
    assert.match(src, /m\.quality = 'Confirmed'/);
  });
  test('today\'s page re-checks through the evening and on weekends', () => {
    const sat1900 = Date.parse('2026-10-17T13:30:00Z');   // 19:00 IST, Saturday
    assert.equal(eoTodayPollMs(sat1900), 6 * 60_000);
    assert.equal(eoTodayPollMs(Date.parse('2026-10-17T05:00:00Z')), 4 * 60_000);   // 10:30 IST
    assert.equal(eoTodayPollMs(Date.parse('2026-10-16T22:00:00Z')), false);        // 03:30 IST
    assert.equal(eoTodayPollLabel(sat1900).live, true);
    assert.doesNotMatch(read('src/app/(dashboard)/earnings-opportunities/page.tsx'), /MARKET CLOSED · manual refresh only/);
  });
});

describe('zzz1068 — a filed company is never "board meeting only"', () => {
  const reason = filedFiguresPendingReason('Q2 FY27', '2026-10-17', '2026-06-30', 'exchange-filing');
  test('the reason for a confirmed filing says filed', () => {
    assert.doesNotMatch(reason, /scheduled/i);
    assert.equal(pendingReasonWord(reason).word, 'filed — figures being read');
    assert.equal(shortDropReason(reason), 'filed — figures being read');
    assert.equal(isUnconfirmedDrop(shortDropReason(reason)), false);
  });
  test('a real board-meeting-only name still says so', () => {
    assert.equal(pendingReasonWord('scheduled (Upcoming) — no filing confirmed and no fresh quarter on Screener').word, 'board meeting only — results not out yet');
    assert.equal(shortDropReason('scheduled (Upcoming) — no filing confirmed'), 'board meeting only — filing not confirmed');
  });
});

describe('zzz1068 — CFO/PAT: the figures are there, the year was a loss', () => {
  const crompton = { company: 'Crompton Greaves Consumer Electricals Ltd', industry: 'Household Appliances', cash_fy: 'Mar 2026', cash_basis: 'FY26 full year', ocf_annual_cr: 723, pat_annual_cr: -231, ocf_to_pat_ratio: null };
  test('EO card shows the cash figure and "loss year", not "not in source"', () => {
    const v = cashTileView(crompton);
    assert.equal(v.text, 'CFO ₹723 Cr');
    assert.match(v.note, /loss year \(−₹231 Cr\)/);
    assert.equal(v.color, 'warn');
    assert.equal(cashTileView({ ...crompton, ocf_annual_cr: -27, pat_annual_cr: -67 }).color, 'bad');
    assert.equal(cashTileView({ company: 'Aksh Optifibre Ltd', ocf_to_pat_ratio: 0 }).note, 'not in source', 'no figures → still says so');
    // zzz1089 — a bank's real figures are shown (never as a cash test), not a blank
    assert.match(cashTileView({ company: 'HDFC Bank Ltd', industry: 'Private Sector Bank', ocf_annual_cr: 5, pat_annual_cr: -1, cash_fy: 'Mar 2026' }).note, /loss year · bank/);   // zzz1094 — short note
    assert.equal(yearCashFigures({ ocf_annual_cr: 10, pat_annual_cr: -2 }), null, 'no fiscal-year label → not used');
    assert.equal(fmtCrSigned(-0.78), '−₹0.8 Cr');
  });
  test('Conviction Beats: a loss year is known (not "not checked") and the preset cash gate does not apply', () => {
    const cv = cbCashView({ ticker: 'SOLARA', ...crompton, ocf_annual_cr: 153, pat_annual_cr: -7 });
    assert.equal(cv.state, 'loss');
    assert.match(cv.text, /loss year/);
    const f = { ...FILTER_DEFAULT, cfoPatMin: 0.5 };
    assert.equal(passesConvictionFilter({ ticker: 'SOLARA', ...crompton } as any, f), true);
  });
  test('a profit that turned from a loss is "turned profitable", never missing', () => {
    const g = growthCell('PAT', null, 28, -10);
    assert.equal(g.text, 'turned profitable'); assert.equal(g.tone, 'good');
    assert.equal(growthCell('EPS', null, -1, -3).text, 'loss narrowed');
    assert.equal(growthCell('EPS', null, null, null).text, '—');
    const e = { ticker: 'SOLARA', tier: 'STRONG', sales_yoy_pct: 30, pat_curr_cr: 28, pat_prev_cr: -10, eps_curr: 7, eps_prev: -2.5, net_profit_yoy_pct: null, eps_yoy_pct: null } as any;
    const ck = cbCriteriaCheck(e, { ...FILTER_DEFAULT, pead: 40 });
    assert.ok(!ck.missing.some((m) => /profit growth|EPS growth/.test(m)), `missing: ${ck.missing.join(', ')}`);
  });
  test('US: an 8-K with no cash flow yet shows the last 10-K\'s same-year ratio, labelled', () => {
    const cfo = [{ start: '2025-01-01', end: '2025-12-31', days: 364, val: 1_200e6 }, { start: '2026-01-01', end: '2026-06-30', days: 180, val: 500e6 }];
    const ni = [{ start: '2025-01-01', end: '2025-12-31', days: 364, val: 800e6 }];
    const a = annualCashFromSeries(cfo, ni, '2026-09-30')!;
    assert.equal(a.ratio, 1.5); assert.equal(a.cfo_musd, 1200); assert.match(a.basis, /fiscal year to Dec 2025 \(10-K\)/);
    assert.equal(annualCashFromSeries(cfo, [], null), null);
    assert.equal(annualCashFromSeries(cfo, [{ ...ni[0], val: -100e6 }], null)!.ratio, null, 'a loss year has no ratio');
    assert.match(read('src/components/us-earnings-card.tsx'), /quarter cash flow not filed yet/);
  });
});

describe('zzz1068 — any size by default, and the Conviction Beats preset has no size limit', () => {
  test('Earnings Opportunities opens on all sizes (new key, so the default reaches everyone once)', () => {
    assert.equal(EO_SMALL_MID_DEFAULT, false);
    assert.equal(EO_SMALL_MID_KEY, 'mc:eo:small-mid-only:v2');
    assert.equal(parseSmallMidPref(null, EO_SMALL_MID_DEFAULT), false);
    assert.equal(parseSmallMidPref('1', EO_SMALL_MID_DEFAULT), true, 'a choice made after the move is kept');
    assert.match(read('src/app/(dashboard)/earnings-opportunities/page.tsx'), /readSmallMidPref\(EO_SMALL_MID_KEY, false\)/);
  });
  test('India preset: no ceiling, Any size floor by default', () => {
    const p = indiaPresetFilters();
    assert.equal(p.mktCapMax, null);
    assert.equal(p.mktCapMin, null);
    assert.equal(parseCbCapFloor(null), null);
    assert.equal(parseCbCapFloor('3000'), 3000);
    assert.equal(CB_PRESET_CAP_KEY, 'mc:cb:preset-cap:v2');
    assert.equal(CB_CAP_FLOORS[0].label, 'Any size');
    const f = { ...FILTER_DEFAULT, ...p };
    const big = { ticker: 'BIG', market_cap_cr: 450_000, sales_yoy_pct: 30, eps_yoy_pct: 40, net_profit_yoy_pct: 40, opm_pct: 20, opm_prev_pct: 18 } as any;
    assert.equal(passesConvictionFilter(big, { ...FILTER_DEFAULT, mktCapMax: p.mktCapMax, mktCapMin: p.mktCapMin }), true);
    void f;
  });
  test('US preset: All sizes, one-time move off the automatic Under $30B / Small+Mid band', () => {
    assert.equal(usCbFiltersForOwner(() => null).cap, 'all');
    assert.deepEqual(usCbFiltersForOwner(() => null), { ...usPresetFilters(), cap: 'all' });
    assert.equal(usCbMigrateAllSize({ ...US_FILTER_DEFAULT, cap: 'u30' }).cap, 'all');
    assert.equal(usCbMigrateAllSize({ ...US_FILTER_DEFAULT, cap: 'smid' }).cap, 'all');
    assert.equal(usCbMigrateAllSize({ ...US_FILTER_DEFAULT, cap: 'small' }).cap, 'small', 'a hand-picked band is kept');
    const saved = JSON.stringify({ ...US_FILTER_DEFAULT, cap: 'u30' });
    const get = (moved: boolean) => (k: string) => (k === US_CB_ALL_SIZE_FLAG_KEY ? (moved ? '1' : null) : k === 'mc:us-cb:filters:v1' ? saved : k === 'mc:us-cb:preset:v1:optout' ? '1' : null);
    assert.equal(usCbFiltersForOwner(get(false)).cap, 'all');
    assert.equal(usCbFiltersForOwner(get(true)).cap, 'u30', 'after the move, Under $30B chosen by hand stays');
  });
});

describe('zzz1068 — debt / equity on the Conviction Beats cards', () => {
  test('colours, debt-free, negative equity, lender, missing', () => {
    assert.deepEqual([deCell(0.02, 'latest quarter', false).text, deCell(0.02, null, false).tone], ['debt-free', 'good']);
    assert.equal(deCell(0.4, null, false).tone, 'good');
    assert.equal(deCell(0.8, null, false).tone, 'warn');
    assert.equal(deCell(1.6, null, false).tone, 'bad');
    assert.equal(deCell(99, null, false).text, 'negative equity');
    assert.equal(deCell(0.4, null, true).text, 'n/a (lender)');
    const miss = deCell(undefined, null, false);
    assert.equal(miss.text, '—'); assert.match(miss.title, /not in the source/);
  });
  test('source: the stock-screener snapshot (latest quarter, else fiscal year)', () => {
    assert.deepEqual(deFromSnapshotRow({ t: 'A', de: 0.3, deFY: 0.5 }), { de: 0.3, basis: 'latest quarter' });
    assert.deepEqual(deFromSnapshotRow({ t: 'A', de: null, deFY: 0.5 }), { de: 0.5, basis: 'fiscal year' });
    assert.equal(deFromSnapshotRow({ t: 'A' }), null);
    assert.deepEqual(Object.keys(deIndex([{ t: 'kross', deFY: 0.2 }, { t: 'NONE' }])), ['KROSS']);
    assert.match(read('src/app/api/v1/stock-screener/route.ts'), /SLIM_KEYS = \[[^\]]*'de', 'deFY'\]/);
  });
  test('D/E MAX filter: a known value above the limit fails; lenders and unknown pass', () => {
    assert.equal(passesDeMax(0.6, false, 0.5), false);
    assert.equal(passesDeMax(0.4, false, 0.5), true);
    assert.equal(passesDeMax(null, false, 0.3), true);
    assert.equal(passesDeMax(3, true, 0.3), true);
    assert.equal(passesConvictionFilter({ ticker: 'A', de_ratio: 1.4 } as any, { ...FILTER_DEFAULT, deMax: 1 }), false);
    assert.equal(passesConvictionFilter({ ticker: 'A', de_ratio: 0.2 } as any, { ...FILTER_DEFAULT, deMax: 0.3 }), true);
    assert.equal(passesUsConvictionFilter({ ticker: 'A', company: 'A', de_ratio: 2 } as any, { ...US_FILTER_DEFAULT, deMax: 1 }), false);
  });
  test('ROCE / ROE share the colour logic; card, table and Excel carry D/E', () => {
    assert.equal(returnCell('ROCE', 30, 25).tone, 'good');
    assert.equal(returnCell('ROE', 10, 18).tone, 'warn');
    assert.equal(returnCell('ROE', -3, 18).tone, 'bad');
    const table = read('src/app/(dashboard)/watchlists/ConvictionTable.tsx');
    assert.match(table, /testId="cb-de"/);
    assert.match(table, /key: 'de',\s+label: 'D\/E'/);
    const panel = read('src/app/(dashboard)/watchlists/ConvictionBeatsPanel.tsx');
    assert.match(panel, /'Debt \/ equity'/);
    assert.match(panel, /renderChipGroup\('D\/E MAX'/);
    const us = read('src/app/(dashboard)/us-conviction-beats/page.tsx');
    assert.match(us, /label="D\/E MAX"/);
    assert.match(us, /'Debt \/ equity'/);
  });
});
