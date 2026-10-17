// zzz1055 — FII / DII Flows: parsers (real NSE / NSDL pages, trimmed into fixtures on 15 Oct 2026), streaks, cumulative and
// rolling series, the sector table, the job's schedule and run plan, the migration, the API answer and the page wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseNseFiiDii, parseNsdlDaily, parseSectorReport, parseSectorReportList, parseInNumber, ddMonYyyyToIso, monthDayYearToIso,
  prevTradingDay, nsdlTradeDates,
} from '../fii-dii/parse';
import { streakOf, cumulativeSeries, rollingSum, sectorTable, sortSectors, buyShare, rangeStart, parseRange, type DailyRow } from '../fii-dii/compute';
import { FII_DII_CRONS, FII_DII_JOB, expectedNseDate, isFinalSlot, planFiiDiiRun, backfillMonths } from '../fii-dii/schedule';
import { buildView } from '../fii-dii/view';
import { APP_JOBS, parseCron, prevSlot, nextSlot, slotWindowMs, lockTtlSec } from '../app-scheduler';
import { MIGRATIONS, migrationsValid } from '../db-migrate';
import { fmtCr, fmtAxisCr, fmtDate } from '../../app/(dashboard)/fii-dii/format';

const FX = join(__dirname, 'fixtures');
const APP = join(__dirname, '../../app');
const read = (p: string) => readFileSync(p, 'utf8');
const noHol = () => false;
const at = (s: string) => new Date(s);

const row = (date: string, fii: number | null, dii: number | null, over: Partial<DailyRow> = {}): DailyRow => ({
  date, fiiBuy: null, fiiSell: null, fiiNet: fii, diiBuy: null, diiSell: null, diiNet: dii,
  provisional: true, source: 'nse', fetchedAt: null, fpiFinalNet: null, finalAt: null, ...over,
});

// ── parsers ──────────────────────────────────────────────────────────────────

test('NSE fiidiiTradeReact JSON → one day with FII and DII buy / sell / net', () => {
  const d = parseNseFiiDii(JSON.parse(read(join(FX, 'nse-fiidii-2026-10-15.json'))))!;
  assert.equal(d.date, '2026-10-15');
  assert.deepEqual(d.fii, { buy: 12735.59, sell: 18020.96, net: -5285.37 });
  assert.deepEqual(d.dii, { buy: 19438.65, sell: 16119.26, net: 3319.39 });
  assert.equal(parseNseFiiDii({ data: [{ category: 'FII/FPI', date: '01-Jan-2026', buyValue: '10', sellValue: '4' }] })!.fii!.net, 6);  // net worked out when missing
  assert.equal(parseNseFiiDii([]), null);
  assert.equal(parseNseFiiDii({ error: 'blocked' }), null);
  assert.equal(parseNseFiiDii([{ category: 'DII', date: 'yesterday', buyValue: '1', sellValue: '1' }]), null);
});

test('number + date helpers: Indian grouping, brackets as minus, month names', () => {
  assert.equal(parseInNumber('5,07,517'), 507517);
  assert.equal(parseInNumber('(1094.47)'), -1094.47);
  assert.equal(parseInNumber('-2,670'), -2670);
  assert.equal(parseInNumber('Rs.95.0317'), 95.0317);
  assert.equal(parseInNumber(''), null);
  assert.equal(parseInNumber('n/a'), null);
  assert.equal(ddMonYyyyToIso('15-Oct-2026'), '2026-10-15');
  assert.equal(ddMonYyyyToIso('31-Feb-2026'), null);
  assert.equal(monthDayYearToIso('AUC as on September 30, 2026'), '2026-09-30');
  assert.equal(monthDayYearToIso('JUNE 15, 2026'), '2026-06-15');
});

test('NSDL daily page → equity stock-exchange rows; each filed under the trading day before its reporting date', () => {
  const rows = parseNsdlDaily(read(join(FX, 'nsdl-daily-2026-03.html')));
  assert.deepEqual(rows.map((r) => r.reportDate), ['2026-03-02', '2026-03-04', '2026-03-05', '2026-03-06']);
  assert.deepEqual(rows[0], { reportDate: '2026-03-02', buy: 38228.4, sell: 45060.35, net: -6831.95 });
  // 3 Mar 2026 is an NSE holiday (Holi): the 4 Mar report covers 2 Mar; Monday 2 Mar covers Friday 27 Feb
  const hol = (iso: string) => iso === '2026-03-03';
  assert.equal(prevTradingDay('2026-03-04', hol), '2026-03-02');
  assert.equal(prevTradingDay('2026-03-02', hol), '2026-02-27');
  const mapped = nsdlTradeDates(rows, hol);
  assert.deepEqual(mapped.map((r) => [r.reportDate, r.tradeDate]), [['2026-03-02', '2026-02-27'], ['2026-03-04', '2026-03-02'], ['2026-03-05', '2026-03-04'], ['2026-03-06', '2026-03-05']]);
  // without the holiday list two reports would claim 3 Mar → the earlier one steps back, never two rows on one day
  const blind = nsdlTradeDates([{ reportDate: '2026-03-04', buy: 1, sell: 1, net: 0 }, { reportDate: '2026-03-03', buy: 1, sell: 1, net: 0 }, { reportDate: '2026-03-05', buy: 1, sell: 1, net: 0 }], noHol);
  assert.equal(new Set(blind.map((r) => r.tradeDate)).size, 3);
});

test('NSDL fortnight sector report → equity AUC + net per sector (₹ crore), Grand Total kept apart', () => {
  const rep = parseSectorReport(read(join(FX, 'nsdl-sector-2026-09-30.html')))!;
  assert.equal(rep.reportDate, '2026-09-30');
  assert.equal(rep.fortnight, 'September 16-30, 2026');
  assert.deepEqual(rep.sectors.map((s) => s.sector), ['Automobile and Auto Components', 'Capital Goods', 'Others']);
  assert.deepEqual(rep.sectors[0], { sector: 'Automobile and Auto Components', aucCr: 498295, netCr: -3542, netPrevCr: -2670 });
  assert.deepEqual(rep.total, { sector: 'Total', aucCr: 6617164, netCr: -21745, netPrevCr: -14116 });
  assert.equal(parseSectorReport('<table><tr><td>nothing</td></tr></table>'), null);
});

test('NSDL report list → newest first with absolute URLs (old misspelt file names included)', () => {
  const list = parseSectorReportList(read(join(FX, 'nsdl-sector-list.html')));
  assert.equal(list[0].date, '2026-09-30');
  assert.match(list[0].url, /^https:\/\/www\.fpi\.nsdl\.co\.in\/web\/StaticReports\/Fortnightly_Sector_wise_FII_Investment_Data\/FIIInvestSector_Sep302026\.html$/);
  assert.equal(list[list.length - 1].date, '2012-01-31');
  assert.equal(list.length, 5);
});

// ── maths ────────────────────────────────────────────────────────────────────

test('streaks count consecutive net-buy / net-sell days back from the latest day', () => {
  const rows = [row('2026-10-07', 100, -50), row('2026-10-08', -10, 20), row('2026-10-09', -20, 30), row('2026-10-12', -30, 40), row('2026-10-13', -40, 50)];
  const fii = streakOf(rows, (r) => r.fiiNet);
  // zzz1067: no weekday is missing between the observed days (9 Oct Fri → 12 Oct Mon), so the run is proven back-to-back
  assert.deepEqual(fii, { dir: 'sell', days: 4, totalCr: -100, since: '2026-10-08', continuous: true, missing: 0 });
  const dii = streakOf(rows, (r) => r.diiNet);
  assert.equal(dii.dir, 'buy'); assert.equal(dii.days, 4);
  // a day without a figure (DII before NSE rows existed) ends the streak; an unsorted input is fine
  const mixed = [row('2026-10-02', null, null, { source: 'nsdl' }), row('2026-10-01', 5, null, { source: 'nsdl' }), row('2026-10-05', 1, 2), row('2026-10-06', 1, 3)];
  assert.equal(streakOf(mixed, (r) => r.diiNet).days, 2);
  assert.equal(streakOf([], (r) => r.fiiNet).dir, null);
  assert.equal(buyShare(12735.59, 18020.96), 41.4);
});

test('cumulative series starts at 0 before the first day; rolling 20-day sum is blank until 20 days exist', () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(`2026-09-${String(i + 1).padStart(2, '0')}`, i % 2 ? -10 : 30, 5));
  const cum = cumulativeSeries(rows, (r) => r.fiiNet);
  assert.equal(cum[0].cum, 30);
  assert.equal(cum[1].cum, 20);
  assert.equal(cum[24].cum, 13 * 30 - 12 * 10);
  assert.equal(cumulativeSeries(rows, (r) => r.fiiNet, '2026-09-24').length, 2);
  const roll = rollingSum(rows, (r) => r.diiNet, 20);
  assert.equal(roll[18].sum, null);
  assert.equal(roll[19].sum, 100);
  assert.equal(roll[24].sum, 100);
  assert.equal(rangeStart('1M', '2026-10-15'), '2026-09-15');
  assert.equal(rangeStart('ALL', '2026-10-15'), null);
  assert.equal(parseRange('1y'), '1Y');
  assert.equal(parseRange('bogus'), '3M');
});

test('sector table: share of AUM, last fortnight, 1-year net flow over the last 12 months of reports, sortable', () => {
  const rep = (d: string, a: number, b: number) => [
    { reportDate: d, sector: 'Auto', aucCr: 500000, netCr: a },
    { reportDate: d, sector: 'IT', aucCr: 300000, netCr: b },
    { reportDate: d, sector: 'Total', aucCr: 800000, netCr: a + b },
  ];
  const rows = [...rep('2025-09-30', -9999, 9999), ...rep('2025-10-15', -100, 50), ...rep('2026-09-15', -200, 70), ...rep('2026-09-30', -300, 80)];
  const t = sectorTable(rows);
  assert.equal(t.lastReport, '2026-09-30');
  assert.equal(t.reports1y, 3);                           // 30 Sep 2025 is exactly a year back → outside
  const auto = t.lines.find((l) => l.sector === 'Auto')!;
  assert.equal(auto.sharePct, 62.5);
  assert.equal(auto.fortnightCr, -300);
  assert.equal(auto.oneYearCr, -600);
  assert.equal(auto.oneYearPctOfAuc, -0.1);
  assert.equal(t.totalAucCr, 800000);                     // Total rows ignored, re-added from sectors
  assert.deepEqual(sortSectors(t.lines, 'fortnight').map((l) => l.sector), ['IT', 'Auto']);
  assert.deepEqual(sortSectors(t.lines, 'auc', false).map((l) => l.sector), ['IT', 'Auto']);
  assert.equal(sectorTable([]).lastReport, null);
});

test('API answer: today = latest NSE day (provisional until NSDL confirms), coverage says where DII starts', () => {
  const rows = [
    row('2026-10-12', -1000, null, { source: 'nsdl', provisional: false, fpiFinalNet: -1000 }),
    row('2026-10-13', -2000, 1500, { fiiBuy: 8000, fiiSell: 10000, diiBuy: 9000, diiSell: 7500, provisional: false, fpiFinalNet: -1800 }),
    row('2026-10-14', -500, 400, { fiiBuy: 9500, fiiSell: 10000 }),
  ];
  const v = buildView(rows, [], '1M');
  assert.equal(v.today!.date, '2026-10-14');
  assert.equal(v.today!.provisional, true);
  assert.equal(v.today!.combinedNet, -100);
  assert.equal(v.today!.fii.buySharePct, 48.7);
  // zzz1067 (F01): sources are never joined. The headline streak is NSE's own (13 + 14 Oct); the charts use ONE series —
  // here NSDL final (picked automatically because NSE history does not cover the range): −1,000 then −1,800, and 14 Oct has
  // no final figure yet, so the running total stays flat instead of adding NSE's −500.
  assert.equal(v.streaks.fii.days, 2);
  assert.equal(v.streaks.fiiFinal.days, 2);
  assert.equal(v.streaks.dii.days, 2);
  assert.equal(v.basis, 'nsdl'); assert.equal(v.basisAuto, true);
  assert.deepEqual(v.history.map((h) => h.fiiCum), [-1000, -2800, -2800]);
  assert.deepEqual(v.history.map((h) => h.fiiNse), [null, -2000, -500]);
  assert.equal(v.coverage.firstNseDate, '2026-10-13');
  assert.equal(v.coverage.firstDate, '2026-10-12');
  assert.equal(buildView([], [], '3M').available, false);
});

// ── schedule / job ───────────────────────────────────────────────────────────

test('job: weekdays every 15 min 13:00–15:30 UTC + 17:45 and 04:20 UTC; app-scheduler entry matches; lock fits every window', () => {
  const job = APP_JOBS.find((j) => j.name === FII_DII_JOB)!;
  assert.ok(job, 'fii-dii is an app job');
  assert.deepEqual([...job.crons], [...FII_DII_CRONS]);
  for (const c of job.crons) assert.ok(parseCron(c), c);
  // Thursday 15 Oct 2026: first slot 13:00, last evening slot 15:30, then 17:45
  assert.equal(nextSlot(job.crons, at('2026-10-15T12:59:00Z'))!.toISOString(), '2026-10-15T13:00:00.000Z');
  assert.equal(nextSlot(job.crons, at('2026-10-15T15:20:00Z'))!.toISOString(), '2026-10-15T15:30:00.000Z');
  // zzz1060: hourly ':55' backfill slots outside the evening window (16:55 comes before 17:45)
  assert.equal(nextSlot(job.crons, at('2026-10-15T15:31:00Z'))!.toISOString(), '2026-10-15T16:55:00.000Z');
  assert.equal(nextSlot(job.crons, at('2026-10-15T17:00:00Z'))!.toISOString(), '2026-10-15T17:45:00.000Z');
  // Friday evening → Monday morning (no weekend slots)
  // zzz1060: the weekend now has hourly backfill slots (no NSE call in them)
  assert.equal(nextSlot(job.crons, at('2026-10-16T17:46:00Z'))!.toISOString(), '2026-10-16T17:55:00.000Z');
  assert.equal(nextSlot(job.crons, at('2026-10-17T12:00:00Z'))!.toISOString(), '2026-10-17T12:55:00.000Z');
  let s = prevSlot(job.crons, at('2026-10-15T00:00:00Z'))!;
  for (let k = 0; k < 100; k++) { assert.ok(slotWindowMs(job, s) > lockTtlSec(job) * 1000, s.toISOString()); s = nextSlot(job.crons, s)!; }
  assert.ok(isFinalSlot(at('2026-10-15T15:30:00Z')) && isFinalSlot(at('2026-10-15T17:45:00Z')) && isFinalSlot(at('2026-10-16T04:20:00Z')));
  assert.ok(!isFinalSlot(at('2026-10-15T13:15:00Z')));
});

test('job gating: NSE only until today’s row is in; holidays and before-publication use the previous trading day', () => {
  const hol = (iso: string) => iso === '2026-10-20';
  assert.equal(expectedNseDate(at('2026-10-15T13:00:00Z'), noHol), '2026-10-15');   // 18:30 IST → today
  assert.equal(expectedNseDate(at('2026-10-15T04:20:00Z'), noHol), '2026-10-14');   // morning → yesterday
  assert.equal(expectedNseDate(at('2026-10-19T04:20:00Z'), noHol), '2026-10-16');   // Monday morning → Friday
  assert.equal(expectedNseDate(at('2026-10-20T14:00:00Z'), hol), '2026-10-19');     // holiday evening → last trading day
  const base = { needFinal: null, dailyBackfillDone: true, sectorBackfillDone: true };
  const waiting = planFiiDiiRun({ ...base, slot: at('2026-10-15T13:15:00Z'), missingNse: '2026-10-15' });
  assert.deepEqual(waiting, { nse: true, nsdlLatest: false, sectors: false, backfillDaily: false, backfillSectors: false, oi: false, backfillOi: false, nifty: false });
  const haveIt = planFiiDiiRun({ ...base, slot: at('2026-10-15T13:30:00Z'), missingNse: null });
  assert.equal(haveIt.nse, false, 'no NSE call once the row is stored');
  const late = planFiiDiiRun({ ...base, slot: at('2026-10-15T17:45:00Z'), missingNse: null, needFinal: '2026-10-15' });
  assert.ok(late.nsdlLatest && late.sectors && !late.nse);
  const fill = planFiiDiiRun({ ...base, slot: at('2026-10-15T13:45:00Z'), missingNse: null, dailyBackfillDone: false });
  assert.ok(fill.backfillDaily);
});

test('backfill walks month-ends backwards a few per run, stops at the depth limit', () => {
  assert.deepEqual(backfillMonths('2026-10-15', null, 60, 3), ['2026-10-15', '2026-09-30', '2026-08-31']);
  assert.deepEqual(backfillMonths('2026-10-15', '2026-08-31', 60, 2), ['2026-07-31', '2026-06-30']);
  assert.deepEqual(backfillMonths('2026-10-15', '2021-10-31', 60, 6), []);
  assert.deepEqual(backfillMonths('2026-10-15', '2021-11-30', 60, 6), ['2021-10-31']);
});

test('migration 6 (renumbered after price alerts) creates fii_dii_daily + fii_sector_fortnight with the asked-for columns', () => {
  assert.ok(migrationsValid());
  const m = MIGRATIONS.find((x) => x.name === 'fii_dii')!;
  assert.ok(m);
  for (const col of ['fii_dii_daily', 'date', 'fii_buy', 'fii_sell', 'fii_net', 'dii_buy', 'dii_sell', 'dii_net', 'provisional', 'source', 'fetched_at', 'fii_sector_fortnight', 'auc_cr', 'net_cr']) {
    assert.match(m.sql, new RegExp(`\\b${col}\\b`), col);
  }
});

// ── API / page / nav / favourite wiring ──────────────────────────────────────

test('route, page, nav and home favourite are wired; page exports only its default', () => {
  const route = read(join(APP, 'api/v1/fii-dii/route.ts'));
  assert.match(route, /export async function GET/);
  assert.match(route, /hasServiceKey/);                 // writes need the service key
  assert.match(route, /Cache-Control/);
  const page = read(join(APP, '(dashboard)/fii-dii/page.tsx'));
  assert.match(page, /\/api\/v1\/fii-dii\?range=/);
  assert.equal([...page.matchAll(/^export\s+(?!default)/gm)].length, 0, 'no named exports in page.tsx');
  assert.match(page, /How to read this/);
  assert.match(page, /PROVISIONAL/);
  const nav = read(join(APP, '(dashboard)/DashboardClient.tsx'));
  assert.ok(nav.indexOf("href: '/fii-dii'") > nav.indexOf("href: '/smart-money'"), 'sidebar: right after Smart Money');
  const home = read(join(APP, '(dashboard)/page.tsx'));
  assert.ok(home.includes("{ href: '/fii-dii', label: '🏦 FII / DII Flows', color: '#22D3EE' },"));
  assert.ok(existsSync(join(__dirname, '../../../../.github/workflows/scrape-fii-dii.yml')));
});

test('Indian number formatting: crore below 1 lakh crore, L Cr above, signed nets', () => {
  assert.equal(fmtCr(-5285.37, { signed: true }), '−₹5,285 Cr');
  assert.equal(fmtCr(3319.39, { signed: true }), '+₹3,319 Cr');
  assert.equal(fmtCr(507517), '₹5.08 L Cr');
  assert.equal(fmtCr(null), '—');
  assert.equal(fmtAxisCr(-25000), '−25k');
  assert.equal(fmtAxisCr(250000), '2.5L');
  assert.equal(fmtDate('2026-10-15'), '15 Oct 2026');
});
