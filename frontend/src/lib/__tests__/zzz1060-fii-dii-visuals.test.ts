// zzz1060 — FII / DII page as graphics + extra insights: participant-OI parsing (real NSE file, 14 Oct 2026), the NSDL
// equity / debt / hybrid split (real NSDL Latest + Archive rows, trimmed), positioning verdicts, DII absorption, streak
// ranking, sector grid / heatmap colours / rotation call-outs, monthly totals, FII vs Nifty, the rule-written summary,
// hidden-when-empty blocks, the hourly self-running backfill and the collector's cursor-continuing archive ingest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParticipantOi, parseNsdlAssetMix, parseNsdlDaily, oiFileDate, participantOiUrl } from '../fii-dii/parse';
import {
  longPct, positioningVerdict, buildPositioning, absorption, allRuns, streakHistory, sectorGrid, heatColor, rotation,
  monthlyTotals, fiiVsMarket, assetMixMonths, summarize, type OiRow,
} from '../fii-dii/insights';
import { sectorTable, type DailyRow, type SectorFortnightRow } from '../fii-dii/compute';
import { buildView } from '../fii-dii/view';
import {
  FII_DII_CRONS, planFiiDiiRun, isBackfillSlot, oiBackfillDates, expectedOiDate, acceptArchiveMonths, looksLikeNsdlTrends,
} from '../fii-dii/schedule';
import { APP_JOBS, nextSlot, prevSlot, slotWindowMs, lockTtlSec } from '../app-scheduler';
import { MIGRATIONS, migrationsValid } from '../db-migrate';

const FX = join(__dirname, 'fixtures');
const APP = join(__dirname, '../../app');
const read = (p: string) => readFileSync(p, 'utf8');
const noHol = () => false;
const at = (s: string) => new Date(s);
const row = (date: string, fii: number | null, dii: number | null, over: Partial<DailyRow> = {}): DailyRow => ({
  date, fiiBuy: null, fiiSell: null, fiiNet: fii, diiBuy: null, diiSell: null, diiNet: dii,
  provisional: true, source: 'nse', fetchedAt: null, fpiFinalNet: null, finalAt: null, ...over,
});
/** n weekdays ending at `end` (inclusive), oldest first. */
function weekdays(end: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${end}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
const oi = (date: string, long: number, short: number, over: Partial<OiRow> = {}): OiRow => ({
  date, fiiIdxLong: long, fiiIdxShort: short, fiiCallLong: 100, fiiCallShort: 100, fiiPutLong: 100, fiiPutShort: 100,
  clientIdxLong: null, clientIdxShort: null, ...over,
});

// ── parsers ──────────────────────────────────────────────────────────────────

test('participant OI CSV → per-participant index / stock futures and index options (contracts)', () => {
  const d = parseParticipantOi(read(join(FX, 'nse-participant-oi-2026-10-14.csv')))!;
  assert.equal(d.date, '2026-10-14');
  assert.deepEqual(Object.keys(d.byParticipant).sort(), ['Client', 'DII', 'FII', 'Pro']);
  assert.deepEqual(d.byParticipant.FII, {
    futIdxLong: 34282, futIdxShort: 330979, futStkLong: 3594546, futStkShort: 2850560,
    optIdxCallLong: 675757, optIdxPutLong: 1095900, optIdxCallShort: 1008663, optIdxPutShort: 551135,
  });
  assert.equal(d.byParticipant.Client.futIdxLong, 296818);
  assert.equal(parseParticipantOi('not,a,csv\n1,2,3\n4,5,6'), null);
  assert.equal(parseParticipantOi(''), null);
  assert.equal(oiFileDate('2026-10-14'), '14102026');
  assert.equal(participantOiUrl('2026-01-05'), 'https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_05012026.csv');
});

test('NSDL asset split: equity sub-total incl. primary market, debt = General + VRR + FAR (not MF debt schemes), hybrid', () => {
  const html = read(join(FX, 'nsdl-asset-mix-2026-10.html'));
  const mix = parseNsdlAssetMix(html);
  const latest = mix.find((m) => m.reportDate === '2026-10-15')!;
  assert.deepEqual(latest, { reportDate: '2026-10-15', equityNet: -1102.13, debtNet: 2389.73, hybridNet: 22.32 });   // −381.19 + 160.75 + 2610.17
  const sep1 = mix.find((m) => m.reportDate === '2026-09-01')!;
  assert.deepEqual(sep1, { reportDate: '2026-09-01', equityNet: -5432.83, debtNet: -278.78, hybridNet: 242.19 });
  // the month-total block of the archive page is not filed under the last date
  assert.equal(mix.length, 3);
  // equity stock-exchange rows from the same page still parse as before
  assert.deepEqual(parseNsdlDaily(html).map((r) => r.reportDate), ['2026-09-01', '2026-09-02', '2026-10-15']);
  // older layout without sub-totals (March 2026 fixture): the route rows are added up
  const old = parseNsdlAssetMix(read(join(FX, 'nsdl-daily-2026-03.html')));
  assert.equal(old[0].equityNet, -6831.95);
  assert.equal(old[0].debtNet, -515.38);
  assert.ok(looksLikeNsdlTrends(html));
  assert.ok(!looksLikeNsdlTrends('<html>Session expired</html>'));
});

// ── positioning ──────────────────────────────────────────────────────────────

test('FII index-futures long %, ratio and verdict thresholds (<30 very bearish, >70 bullish, ≤15 washout)', () => {
  assert.equal(longPct(34282, 330979), 9.4);
  assert.equal(longPct(0, 0), null);
  assert.equal(positioningVerdict(9.4).label, 'Extremely short');
  assert.match(positioningVerdict(9.4).text, /washout/);
  assert.equal(positioningVerdict(25).tone, 'very-bearish');
  assert.equal(positioningVerdict(30).tone, 'bearish');
  assert.equal(positioningVerdict(50).tone, 'neutral');
  assert.equal(positioningVerdict(60).tone, 'bullish');
  assert.equal(positioningVerdict(71).tone, 'very-bullish');
  const days = weekdays('2026-10-14', 30);
  const rows = days.map((d, i) => oi(d, 40 - i, 60 + i));       // long % falling day by day
  rows[rows.length - 1] = oi(days[days.length - 1], 34282, 330979, { fiiCallLong: 675757, fiiCallShort: 1008663, fiiPutLong: 1095900, fiiPutShort: 551135, clientIdxLong: 296818, clientIdxShort: 51460 });
  const p = buildPositioning(rows)!;
  assert.equal(p.latest.longPct, 9.4);
  assert.equal(p.latest.ratio, 0.1);
  assert.equal(p.latest.net, 34282 - 330979);
  assert.equal(p.latest.clientLongPct, 85.2);
  assert.equal(p.rankPct, 0, 'lowest reading of the stored year');
  assert.equal(p.yearLow, 9.4);
  assert.ok(p.change5! < 0);
  assert.equal(p.options.tone, 'bearish');                     // net calls −332,906 vs net puts +544,765
  assert.match(p.options.text, /net −3,32,906 calls and \+5,44,765 puts/);
  assert.equal(buildPositioning([]), null);
});

// ── absorption, streaks ──────────────────────────────────────────────────────

test('DII absorption over 5 / 20 / 60 sessions; windows without enough DII days are left out', () => {
  const d = weekdays('2026-10-14', 25);
  const rows = d.map((x) => row(x, -1000, 650));
  const a = absorption(rows);
  assert.deepEqual(a.map((x) => x.sessions), [5, 20]);            // only 25 days → no 60-session box
  assert.equal(a[0].pct, 65);
  assert.equal(a[0].tone, 'neutral');
  assert.match(a[1].verdict, /most of it \(65%\)/);
  assert.equal(absorption(d.map((x) => row(x, -1000, 1200)))[0].tone, 'bullish');
  assert.equal(absorption(d.map((x) => row(x, -1000, -10)))[0].verdict, 'Both sold — no domestic support.');
  assert.equal(absorption(d.map((x) => row(x, 500, 100)))[0].ratio, null);
  assert.equal(absorption(d.map((x) => row(x, -1000, 200)))[0].tone, 'very-bearish');
  assert.deepEqual(absorption(d.slice(0, 3).map((x) => row(x, -1, 1))), []);
  // NSDL-only history days (no DII) never count
  assert.deepEqual(absorption(d.map((x) => row(x, -1000, null, { source: 'nsdl' }))), []);
});

test('streak history: all runs, today’s rank among same-direction runs, longest lists', () => {
  const d = weekdays('2026-10-14', 30);
  const nets = [-1, -1, -1, -1, -1, -1, 1, 1, -1, -1, 1, 1, 1, 1, 0, -1, -1, -1, 1, -1, -1, -1, -1, -1, -1, -1, 1, -1, -1, -1];
  const rows = d.map((x, i) => row(x, nets[i] * 100, null, { source: 'nsdl' }));
  const runs = allRuns(rows);
  // selling runs: 6, 2, 3, 7, 3 (today) — buying runs: 2, 4, 1, 1
  assert.deepEqual(runs.filter((r) => r.dir === 'sell').map((r) => r.days), [6, 2, 3, 7, 3]);
  const h = streakHistory(rows);
  assert.equal(h.current!.dir, 'sell');
  assert.equal(h.current!.days, 3);
  assert.equal(h.current!.totalCr, -300);
  assert.equal(h.rank, 3);                                        // only the 7- and 6-day runs were longer; the earlier 3-day run ties
  assert.equal(h.ofRuns, 5);
  assert.deepEqual(h.topSell.map((r) => r.days), [7, 6, 3, 3, 2]);
  assert.equal(h.topBuy[0].days, 4);
  assert.equal(h.longerLastSeen, d[25]);                          // the 7-day run ended on the 26th day
  // a 0 ends a run; the latest day without a figure does not count as "today"
  assert.equal(streakHistory([row('2026-10-13', -5, null), row('2026-10-14', 0, null)]).current, null);
});

// ── sectors ──────────────────────────────────────────────────────────────────

const SEC = (date: string, sector: string, auc: number, net: number): SectorFortnightRow => ({ reportDate: date, sector, aucCr: auc, netCr: net });
const fortnights = ['2026-08-15', '2026-08-31', '2026-09-15', '2026-09-30'];
const secRows: SectorFortnightRow[] = [
  ...fortnights.map((d, i) => SEC(d, 'Financial Services', 1_500_000, [-3000, -5000, -8000, -12000][i])),
  ...fortnights.map((d, i) => SEC(d, 'Information Technology', 600_000, [-1000, 800, -400, -6000][i])),
  ...fortnights.map((d, i) => SEC(d, 'Capital Goods', 300_000, [500, 900, -700, 2500][i])),
  ...fortnights.map((d, i) => SEC(d, 'Healthcare', 400_000, [1200, 1500, 2000, 3100][i])),
  ...fortnights.map((d, i) => SEC(d, 'Telecommunication', 250_000, [100, 50, 400, 900][i])),
  ...fortnights.map((d, i) => SEC(d, 'Power', 200_000, [-100, -50, -20, -300][i])),
  SEC('2026-09-30', 'Total', 3_250_000, -11800),
];

test('sector grid: sectors × fortnights (oldest → newest), momentum = last 3 fortnights, scale maxima', () => {
  const g = sectorGrid(secRows, 24);
  assert.deepEqual(g.dates, fortnights);
  assert.equal(g.rows[0].sector, 'Financial Services');           // biggest holding first
  assert.deepEqual(g.rows[0].net, [-3000, -5000, -8000, -12000]);
  assert.equal(g.rows[0].momentumCr, -25000);
  assert.equal(g.maxAbs, 12000);
  assert.equal(g.rows.find((r) => r.sector === 'Total'), undefined);
  assert.equal(sectorGrid(secRows, 2).dates.length, 2);
  assert.deepEqual(sectorGrid([], 24), { dates: [], rows: [], maxAbs: 0, maxAbsPct: 0 });
  // a sector missing in an older report shows a gap, not a zero
  const gap = sectorGrid([...secRows, SEC('2026-09-30', 'New Sector', 1000, 50)], 24);
  assert.deepEqual(gap.rows.find((r) => r.sector === 'New Sector')!.net, [null, null, null, 50]);
});

test('heatmap colours: green for buying, red for selling, stronger with size; blank / zero cells stay light', () => {
  assert.equal(heatColor(null, 100), '#f1f5f9');
  assert.equal(heatColor(0, 100), '#ffffff');
  assert.equal(heatColor(100, 100), 'rgb(4,120,87)');
  assert.equal(heatColor(-100, 100), 'rgb(185,28,28)');
  const [r1] = heatColor(10, 100).match(/\d+/g)!.map(Number);
  const [r2] = heatColor(50, 100).match(/\d+/g)!.map(Number);
  assert.ok(r2 < r1, 'bigger buying = deeper green');
  assert.match(heatColor(-5, 100), /^rgb\(\d+,\d+,\d+\)$/);
});

test('rotation call-outs: top 3 in / out (fortnight and 1 year) and direction flips above ₹250 Cr', () => {
  const tbl = sectorTable(secRows);
  const g = sectorGrid(secRows);
  const r = rotation(tbl.lines, g);
  assert.deepEqual(r.fortnightIn.map((x) => x.sector), ['Healthcare', 'Capital Goods', 'Telecommunication']);
  assert.deepEqual(r.fortnightOut.map((x) => x.sector), ['Financial Services', 'Information Technology', 'Power']);
  assert.equal(r.fortnightOut[0].cr, -12000);
  assert.deepEqual(r.yearIn.map((x) => x.sector), ['Healthcare', 'Capital Goods', 'Telecommunication']);
  assert.equal(r.yearOut[0].sector, 'Financial Services');
  // Capital Goods −700 → +2,500 is a flip; IT −400 → −6,000 is not; Power −20 → −300 not; Telecom +400 → +900 not
  assert.deepEqual(r.flips.map((f) => [f.sector, f.to]), [['Capital Goods', 'buy']]);
  // IT +800 → −400 is a flip only if both ≥ the threshold
  const g2 = { ...g, dates: g.dates.slice(0, 3), rows: g.rows.map((x) => ({ ...x, net: x.net.slice(0, 3) })) };
  assert.deepEqual(rotation(tbl.lines, g2, 250).flips.map((f) => f.sector).sort(), ['Capital Goods', 'Information Technology']);
  assert.deepEqual(rotation(tbl.lines, g2, 1000).flips, []);
});

// ── monthly, market, asset mix ───────────────────────────────────────────────

test('monthly totals: FII and DII per calendar month, DII only where it exists', () => {
  const rows = [row('2026-08-28', -100, null, { source: 'nsdl' }), row('2026-09-01', -200, null, { source: 'nsdl' }), row('2026-09-30', -50, null, { source: 'nsdl' }), row('2026-10-14', -300, 250), row('2026-10-15', 100, 40)];
  const m = monthlyTotals(rows);
  assert.deepEqual(m.map((x) => [x.month, x.fii, x.dii, x.days, x.diiDays]), [['2026-08', -100, null, 1, 0], ['2026-09', -250, null, 2, 0], ['2026-10', -200, 290, 2, 2]]);
  assert.equal(monthlyTotals(rows, 2).length, 2);
});

test('FII selling vs market: 20 sessions of Nifty move against FII net, plain verdicts', () => {
  const d = weekdays('2026-10-14', 21);
  const closes = d.map((x, i) => ({ date: x, close: 25000 - i * 12.5 }));     // −1% over 20 sessions
  const rows = d.map((x) => row(x, -2100, 1800));
  const m = fiiVsMarket(rows, closes, 20)!;
  assert.equal(m.niftyPct, -1);
  assert.equal(m.fiiCr, -42000);
  assert.equal(m.diiCr, 36000);
  assert.equal(m.tone, 'neutral');
  assert.equal(m.verdict, 'FIIs sold ₹42,000 crore in 20 sessions but Nifty fell only 1% — domestic buying is absorbing it.');
  const down = fiiVsMarket(rows, d.map((x, i) => ({ date: x, close: 25000 - i * 100 })), 20)!;
  assert.equal(down.tone, 'very-bearish');
  const up = fiiVsMarket(rows, d.map((x, i) => ({ date: x, close: 25000 + i * 10 })), 20)!;
  assert.match(up.verdict, /yet Nifty rose/);
  assert.equal(fiiVsMarket(rows.map((r) => ({ ...r, fiiNet: 500 })), closes, 20)!.tone, 'bearish');
  assert.equal(fiiVsMarket(rows.slice(0, 10), closes, 20), null, 'not enough sessions → no box');
});

test('FPI shares vs bonds per month, months without figures left out', () => {
  const m = assetMixMonths([
    { date: '2026-09-01', equity: -5432.83, debt: -278.78, hybrid: 242.19 },
    { date: '2026-09-02', equity: 1764.2, debt: 146.91, hybrid: 94.15 },
    { date: '2026-10-14', equity: -1102.13, debt: 2389.73, hybrid: 22.32 },
    { date: '2026-10-15', equity: null, debt: null, hybrid: null },
  ]);
  assert.deepEqual(m.map((x) => [x.month, x.equity, x.debt, x.days]), [['2026-09', -3668.63, -131.87, 2], ['2026-10', -1102.13, 2389.73, 1]]);
  assert.deepEqual(assetMixMonths([]), []);
});

// ── summary + view ───────────────────────────────────────────────────────────

test('"What it means today": streak count, absorption, sector concentration, positioning, market — each only with data', () => {
  const d = weekdays('2026-10-14', 16);
  const rows = d.map((x) => row(x, -1000, null, { source: 'nsdl' }));
  rows[rows.length - 1] = row(d[d.length - 1], -5000, 3150);
  const sh = streakHistory(rows);
  const tbl = sectorTable(secRows);
  const lines = summarize({
    today: { date: d[d.length - 1], fii: -5000, dii: 3150 }, streak: sh, absorption: [], todayAbsorbPct: 63,
    rotation: rotation(tbl.lines, sectorGrid(secRows)), positioning: buildPositioning([oi(d[d.length - 1], 22, 78)]), market: null,
  });
  assert.equal(lines[0], 'On 14 Oct 2026 FIIs net sold ₹5,000 crore — the 16th selling day in a row (₹20,000 crore in total).');
  assert.equal(lines[1], 'DIIs bought ₹3,150 crore, absorbing 63% of the foreign selling.');
  assert.equal(lines[2], 'In the last fortnight selling was heaviest in Financial Services and Information Technology; buying went mostly to Healthcare and Capital Goods.');
  assert.equal(lines[3], 'FII index-futures positioning is 22% long — very bearish positioning.');
  assert.equal(lines.length, 4);
  assert.deepEqual(summarize({ today: null, streak: null, absorption: [], todayAbsorbPct: null, rotation: null, positioning: null, market: null }), []);
  assert.match(summarize({ today: null, streak: null, absorption: [], todayAbsorbPct: null, rotation: null, positioning: buildPositioning([oi('2026-10-14', 9, 91)]), market: null })[0], /historically near a washout/);
});

test('API view: extra blocks are empty / null without their data (the page then hides them), filled when stored', () => {
  const empty = buildView([row('2026-10-14', -500, 400)], [], '1M');
  assert.equal(empty.positioning, null);
  assert.equal(empty.market, null);
  assert.equal(empty.rotation, null);
  assert.deepEqual(empty.absorption, []);
  assert.deepEqual(empty.assetMix, []);
  assert.deepEqual(empty.sectorGrid.dates, []);
  assert.equal(empty.status, null);
  assert.equal(empty.today!.absorbPct, 80);
  assert.equal(buildView([], [], '3M').summary.length, 0);
  const d = weekdays('2026-10-14', 25);
  const rows = d.map((x) => row(x, -1000, 700, { fiiBuy: 9000, fiiSell: 10000, diiBuy: 8700, diiSell: 8000, fpiEqTotal: -900, fpiDebt: 300, fpiHybrid: 0 }));
  const closes = d.map((x, i) => ({ date: x, close: 25000 + i }));
  const v = buildView(rows, secRows, '1M', { oi: [oi(d[24], 30, 70)], closes, status: { daily: { cursor: '2025-01-31', done: false }, sectors: { done: true }, oi: null, oiLatest: d[24], niftyLatest: d[24] } });
  assert.equal(v.today!.combinedBuy, 17700);
  assert.equal(v.today!.combinedSell, 18000);
  assert.equal(v.today!.combinedBuySharePct, 49.6);
  assert.equal(v.positioning!.latest.longPct, 30);
  assert.ok(v.market);
  assert.equal(v.history[v.history.length - 1].nifty, 25024);
  assert.deepEqual(v.absorption.map((a) => a.sessions), [5, 20]);
  assert.equal(v.assetMix[0].month, '2026-09');
  assert.equal(v.rotation!.fortnightOut[0].sector, 'Financial Services');
  assert.equal(v.monthly.length, 2);
  assert.ok(v.summary.length >= 4);
  assert.equal(v.status!.daily!.cursor, '2025-01-31');
});

// ── automation ───────────────────────────────────────────────────────────────

test('backfill runs by itself: hourly ":55" slots every day (incl. weekends) outside the evening window, no NSE call there', () => {
  const job = APP_JOBS.find((j) => j.name === 'fii-dii')!;
  assert.deepEqual([...job.crons], [...FII_DII_CRONS]);
  // every hour of a Saturday and of a weekday night has a slot
  for (let h = 0; h < 24; h++) {
    const sat = nextSlot(job.crons, at(`2026-10-17T${String(h).padStart(2, '0')}:00:00Z`))!;
    assert.equal(sat.toISOString(), `2026-10-17T${String(h).padStart(2, '0')}:55:00.000Z`);
  }
  assert.equal(nextSlot(job.crons, at('2026-10-15T20:00:00Z'))!.toISOString(), '2026-10-15T20:55:00.000Z');
  // the evening NSE window is untouched; no slot crowds it
  assert.equal(nextSlot(job.crons, at('2026-10-15T12:00:00Z'))!.toISOString(), '2026-10-15T13:00:00.000Z');
  let s = prevSlot(job.crons, at('2026-10-15T00:00:00Z'))!;
  for (let k = 0; k < 400; k++) { assert.ok(slotWindowMs(job, s) > lockTtlSec(job) * 1000, s.toISOString()); s = nextSlot(job.crons, s)!; }
  assert.ok(isBackfillSlot(at('2026-10-17T03:55:00Z')) && !isBackfillSlot(at('2026-10-15T13:45:00Z')));
  const base = { needFinal: '2026-10-14', missingNse: '2026-10-15', dailyBackfillDone: false, sectorBackfillDone: false, oiBackfillDone: false, missingOi: '2026-10-15', missingNifty: '2026-10-15' };
  const light = planFiiDiiRun({ ...base, slot: at('2026-10-16T02:55:00Z') });
  assert.deepEqual(light, { nse: false, nsdlLatest: false, sectors: false, backfillDaily: true, backfillSectors: true, oi: true, backfillOi: true, nifty: true });
  const done = planFiiDiiRun({ ...base, slot: at('2026-10-16T02:55:00Z'), dailyBackfillDone: true, sectorBackfillDone: true, oiBackfillDone: true, missingOi: null, missingNifty: null });
  assert.ok(Object.values(done).every((v) => v === false), 'a finished backfill costs nothing in the hourly slots');
  const evening = planFiiDiiRun({ ...base, slot: at('2026-10-15T13:15:00Z') });
  assert.ok(evening.nse && evening.oi && evening.backfillDaily);
});

test('participant-OI schedule: expected day after ~19:00 IST, a year of trading days walked back in chunks', () => {
  assert.equal(expectedOiDate(at('2026-10-15T13:00:00Z'), noHol), '2026-10-14');   // 18:30 IST → not out yet
  assert.equal(expectedOiDate(at('2026-10-15T14:00:00Z'), noHol), '2026-10-15');
  assert.equal(expectedOiDate(at('2026-10-18T06:00:00Z'), noHol), '2026-10-16');   // Sunday → Friday
  const first = oiBackfillDates('2026-10-15', null, noHol, 380, 5);
  assert.deepEqual(first, ['2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-09']);
  const hol = (iso: string) => iso === '2026-10-08';
  assert.deepEqual(oiBackfillDates('2026-10-15', '2026-10-09', hol, 380, 2), ['2026-10-07', '2026-10-06']);
  assert.deepEqual(oiBackfillDates('2026-10-15', '2025-09-30', noHol, 380, 40), []);
  assert.equal(oiBackfillDates('2026-10-15', null, noHol, 380, 400).length, 273);    // all weekdays in the 380 days back from 15 Oct 2026
});

test('collector archive months are taken only when they continue the cursor (no skipped months, no repeats)', () => {
  assert.deepEqual(acceptArchiveMonths('2026-10-15', null, ['2026-10-15', '2026-09-30', '2026-08-31']), ['2026-10-15', '2026-09-30', '2026-08-31']);
  assert.deepEqual(acceptArchiveMonths('2026-10-15', '2026-08-31', ['2026-07-31', '2026-05-31']), ['2026-07-31']);   // gap stops
  assert.deepEqual(acceptArchiveMonths('2026-10-15', '2026-08-31', ['2026-08-31']), []);                           // repeat refused
  assert.deepEqual(acceptArchiveMonths('2026-10-15', '2021-10-31', ['2021-09-30']), []);                           // beyond the 5-year limit
  const coll = read(join(__dirname, '../../../../.github/scripts/scrape-fii-dii.mjs'));
  assert.match(coll, /nsdlArchive/);
  assert.match(coll, /oiBackfillCursor/);
  assert.match(coll, /fao_participant_oi_/);
  assert.match(coll, /status/);
  const wf = read(join(__dirname, '../../../../.github/workflows/scrape-fii-dii.yml'));
  assert.match(wf, /cron: '40 0 \* \* \*'/);
});

test('migration 7 adds participant OI, index closes and the FPI asset split; migrations stay 1..n', () => {
  assert.ok(migrationsValid());
  const m = MIGRATIONS.find((x) => x.name === 'fii_dii_insights')!;
  assert.equal(m.id, 7);
  for (const w of ['fii_participant_oi', 'fut_idx_long', 'fut_idx_short', 'opt_idx_call_long', 'opt_idx_put_short', 'fii_index_close', 'fpi_debt_net', 'fpi_eq_total_net', 'fpi_hybrid_net']) assert.match(m.sql, new RegExp(`\\b${w}\\b`), w);
});

test('page: graphics components wired, sibling helpers only, no named exports in page.tsx', () => {
  const page = read(join(APP, '(dashboard)/fii-dii/page.tsx'));
  assert.equal([...page.matchAll(/^export\s+(?!default)/gm)].length, 0);
  for (const c of ['SectorBoard', 'SectorHeatmap', 'RotationCallouts', 'MonthlyBars', 'PositioningPanel', 'AbsorptionPanel', 'MarketPanel', 'StreakPanel', 'AssetMixPanel', 'SummaryBox', 'SplitBar']) assert.match(page, new RegExp(`<${c}\\b`), c);
  const sectors = read(join(APP, '(dashboard)/fii-dii/sectors.tsx'));
  for (const k of ["'auc'", "'fortnight'", "'oneYear'", "'momentum'", '@media (max-width']) assert.ok(sectors.includes(k), k);
  const panels = read(join(APP, '(dashboard)/fii-dii/panels.tsx'));
  // every insight panel renders nothing when its data is missing
  for (const g of ['if (!lines.length) return null', 'if (!p) return null', 'if (!rows || !rows.length) return null', 'if (!m) return null', 'if (!months || !months.length) return null']) assert.ok(panels.includes(g), g);
  const charts = read(join(APP, '(dashboard)/fii-dii/charts.tsx'));
  assert.match(charts, /clipPath/);                      // green above / red below the zero line
  assert.ok(!/yAxisRight|rightAxis/.test(charts), 'no dual-axis chart');
});
