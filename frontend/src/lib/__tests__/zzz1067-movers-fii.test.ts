// zzz1067 — release-audit fixes for US Top Movers (U01 / U02 / row design) and FII / DII Flows (F01 / F02 / F03 /
// accessibility / themes). Pure logic is tested directly; the components are checked for the wiring that matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inMoveWindow, newsInMoveWindow, isPriceTalk, priceMoveOnly, attributeUsMover, whyCoverageSplit, usMoversPollMs,
  msToNextUsTransition, evidenceTime, etClock, filingWhy, type FilingClass, type UsWhyInput,
} from '../us-movers';
import { classifyUsFiling } from '../ai-gainers/us-gainers';
import {
  rangeStart, minusMonths, streakOf, rollingSum, trailingSessions, sumSince, sessionCalendar, UNKNOWN_CALENDAR, type DailyRow,
} from '../fii-dii/compute';
import { monthlyTotals } from '../fii-dii/insights';
import { checkNseFiiDii, parseNseFiiDii, parseNsdlDaily, sectorReportProblems, type SectorReport } from '../fii-dii/parse';
import { buildView, autoBasis } from '../fii-dii/view';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');
const classify = (f: { subject: string }): FilingClass | null => {
  const c = classifyUsFiling(f);
  return c ? { kind: c.kind as FilingClass['kind'], category: (c.category as string) || null, routineReason: c.routineReason } : null;
};

// ═══ US movers ═══════════════════════════════════════════════════════════════

test('U02: the previous session closes at 13:00 on a half day — 13:00–16:00 news after it explains the next session', () => {
  // 27 Nov 2026 closes at 13:00; the next session is Mon 30 Nov
  assert.equal(inMoveWindow('2026-11-27T14:30:00-05:00', '2026-11-30', '2026-11-27'), true, 'after the 13:00 close');
  assert.equal(inMoveWindow('2026-11-27T12:30:00-05:00', '2026-11-30', '2026-11-27'), false, 'before the close moved the 27th');
  // an ordinary day is unchanged
  assert.equal(inMoveWindow('2026-10-14T15:30:00-04:00', '2026-10-15', '2026-10-14'), false);
  assert.equal(inMoveWindow('2026-10-14T16:05:00-04:00', '2026-10-15', '2026-10-14'), true);
});

test('U02: zoned stamps are read on the New York clock (a UTC "Z" stamp is not taken as ET)', () => {
  // 20:30Z on 15 Oct = 16:30 ET → after the 15th close → explains the 16th, not the 15th
  assert.equal(inMoveWindow('2026-10-15T20:30:00Z', '2026-10-15', '2026-10-14'), false);
  assert.equal(inMoveWindow('2026-10-15T20:30:00Z', '2026-10-16', '2026-10-15'), true);
  assert.equal(inMoveWindow('2026-10-15T13:00:00Z', '2026-10-15', '2026-10-14'), true, '09:00 ET pre-market');
  // news: a timed item uses its time, a date-only item its date
  assert.equal(newsInMoveWindow({ date: '2026-10-15', at: '2026-10-15T17:10:00-04:00' }, '2026-10-15', '2026-10-14'), false, 'after-close news of the shown session');
  assert.equal(newsInMoveWindow({ date: '2026-10-15', at: null }, '2026-10-15', '2026-10-14'), true);
});

test('U02: after-close news is not attached to the completed session it came after', () => {
  const base: UsWhyInput = { ticker: 'AAA', chg: -6, session: '2026-10-15', prevSession: '2026-10-14', filings: [], news: [] };
  const late = { title: 'Alpha Corp announces CEO departure effective immediately', url: 'https://x/1', date: '2026-10-15', at: '2026-10-15T18:00:00-04:00', source: 'Wire' };
  assert.notEqual(attributeUsMover({ ...base, news: [late] }, classify).kind, 'NEWS');
  const early = { ...late, at: '2026-10-15T07:00:00-04:00' };
  const w = attributeUsMover({ ...base, news: [early] }, classify);
  assert.equal(w.kind, 'NEWS');
  assert.equal(w.at, '2026-10-15T07:00:00-04:00', 'the timestamp travels with the WHY');
  assert.equal(evidenceTime(w.at, w.date), '15 Oct 2026 07:00 ET');
  assert.equal(evidenceTime(null, '2026-10-15'), '15 Oct 2026 (time not given)');
  // a filing keeps its time too
  const f = filingWhy([{ subject: '8-K: Material definitive agreement signed [Item 1.01] · filed 07:02 ET pre-market', url: 'https://sec/1', dateIso: '2026-10-15T07:02:00-04:00', announced: 'a supply deal with the Navy' }], 5, classify, base);
  assert.equal(f?.at, '2026-10-15T07:02:00-04:00');
});

test('U02: price-only headlines are rejected — ECO 1-year high, CRML "Rises 4%" — real business news is kept', () => {
  for (const junk of [
    'Okeanis Eco Tankers (NYSE:ECO) Sets New 1-Year High',               // the live ECO case (already rejected by zzz1059)
    'Critical Metals Rises 4% After Volatile Session',                   // the live CRML case
    'Critical Metals Corp (CRML) rises 4.2% in early trade',
    'Alpha Corp slips 3% as market weakens',
    'Beta Inc hits fresh 52-week high',
    'Gamma Ltd touches all-time high',
    'Delta shares edge up 2% on heavy volume',
    'Epsilon is up 8% today',
  ]) assert.ok(isPriceTalk(junk), junk);
  for (const real of [
    'Alpha Corp Q3 revenue rises 25% as orders climb',
    'Beta Inc orders up 40% year over year',
    'Gamma deliveries jump 12% to a record',
    'FDA approves Verastem combination for ovarian cancer',
    'Delta raises full-year outlook after strong quarter',
    'Recursion Announces Sanofi Milestone',
  ]) assert.ok(!isPriceTalk(real), real);
  assert.equal(priceMoveOnly('Same-store sales rise 6%'), false);
  // the ECO case: the 1-year-high headline is skipped, so the WHY falls through (no news reason)
  const w = attributeUsMover({ ticker: 'ECO', chg: -6.8, session: '2026-10-15', prevSession: '2026-10-14', filings: [], news: [
    { title: 'Okeanis Eco Tankers (NYSE:ECO) Sets New 1-Year High', url: 'https://x', date: '2026-10-15', source: 'MarketBeat' },
  ] }, classify);
  assert.notEqual(w.kind, 'NEWS');
});

test('U02: status splits company catalysts, sector context and unresolved', () => {
  const s = whyCoverageSplit({ EARNINGS: 5, FILING: 3, NEWS: 2, ANALYST: 1, INSIDER: 1, DILUTION: 0, INDUSTRY: 9, SECTOR: 7, NONE: 12 });
  assert.deepEqual([s.company, s.context, s.unresolved], [12, 16, 12]);
  assert.equal(s.text, '12 company catalysts · 16 sector context · 12 unresolved');
  assert.equal(whyCoverageSplit(null).text, '0 company catalysts · 0 sector context · 0 unresolved');
});

test('U01: the panel polls in every phase and wakes at the open / close / after-close prewarm', () => {
  assert.equal(usMoversPollMs('regular'), 3 * 60_000);
  assert.equal(usMoversPollMs('pre_market'), 15 * 60_000);
  assert.equal(usMoversPollMs('closed_day'), 15 * 60_000);
  // 09:00 ET on Thu 15 Oct (13:00Z) → wake 30 min later at the open (+5 s)
  assert.equal(msToNextUsTransition(new Date('2026-10-15T13:00:00Z')), 30 * 60_000 + 5_000);
  // 15:50 ET → one minute after the 16:00 close
  assert.equal(msToNextUsTransition(new Date('2026-10-15T19:50:00Z')), 11 * 60_000 + 5_000);
  // half day 27 Nov: 12:50 ET → 13:01
  assert.equal(msToNextUsTransition(new Date('2026-11-27T17:50:00Z')), 11 * 60_000 + 5_000);
  // 16:10 ET → the post-close prewarm at 16:21
  assert.equal(msToNextUsTransition(new Date('2026-10-15T20:10:00Z')), 11 * 60_000 + 5_000);
  assert.equal(msToNextUsTransition(new Date('2026-10-17T15:00:00Z')), null, 'Saturday');
  assert.equal(msToNextUsTransition(new Date('2026-10-15T23:00:00Z')), null, '19:00 ET — nothing until tomorrow');
  assert.equal(etClock('2026-10-15T14:42:00Z'), '10:42 ET');
});

test('U01 / design: the panel keeps old rows on error, binds rows to their mode, guards requests, and explains rows', () => {
  const c = read('..', '..', 'app', '(dashboard)', '_home', 'UsMovers.tsx');
  assert.match(c, /gen\.current/, 'request generation guard');
  assert.match(c, /ctl\.current\?\.abort\(\)/, 'the earlier request is aborted');
  assert.match(c, /if \(my !== gen\.current\) return;/);
  assert.match(c, /visibilitychange/); assert.match(c, /'focus'/);
  assert.match(c, /msToNextUsTransition/); assert.match(c, /usMoversPollMs/);
  assert.match(c, /Could not refresh/, 'stale banner with the old rows');
  assert.match(c, /x-mc-cache/, 'server-side stale answer shown');
  assert.match(c, /modeMismatch/, 'rows labelled with the mode they belong to');
  assert.match(c, /observed \{observed\}/);
  assert.match(c, /whyCoverageSplit/);
  assert.match(c, /aria-expanded=\{open\}/); assert.match(c, /onKeyDown/);
  assert.match(c, /move quality/); assert.match(c, /not a buy rating/);
  for (const h of ['TICKER', 'CHANGE', 'Q · TREND']) assert.ok(c.includes(h), h);
  assert.match(c, /import NavLink from '@\/components\/NavLink'/);
  assert.ok(!/from 'next\/link'/.test(c), 'no bare next/link (no viewport prefetch)');
  assert.ok(!/fontSize: (8|9|9\.5),/.test(c), 'no 8–9 px body text');
});

// ═══ FII / DII ═══════════════════════════════════════════════════════════════

const row = (date: string, fii: number | null, dii: number | null, over: Partial<DailyRow> = {}): DailyRow => ({
  date, fiiBuy: null, fiiSell: null, fiiNet: fii, diiBuy: null, diiSell: null, diiNet: dii,
  provisional: true, source: 'nse', fetchedAt: null, fpiFinalNet: null, finalAt: null, ...over,
});
const cal2026 = sessionCalendar((d) => ['2026-10-02', '2026-10-20', '2026-11-10'].includes(d), ['2026']);

test('F02: month subtraction clamps to the end of the month', () => {
  assert.equal(rangeStart('1M', '2026-03-31'), '2026-02-28');
  assert.equal(rangeStart('1M', '2024-03-31'), '2024-02-29');
  assert.equal(rangeStart('3M', '2026-05-31'), '2026-02-28');
  assert.equal(rangeStart('1Y', '2026-02-28'), '2025-02-28');
  assert.equal(rangeStart('1M', '2026-01-15'), '2025-12-15');
  assert.equal(minusMonths('2026-10-15', -1), '2026-11-15');
});

test('F02: streaks over a missing session are "observed days", not proven back-to-back', () => {
  // Mon 12 Oct and Thu 15 Oct with nothing between: 13 + 14 Oct are sessions with no figure
  const rows = [row('2026-10-12', -10, 5), row('2026-10-15', -20, 6)];
  const s = streakOf(rows, (r) => r.fiiNet, cal2026);
  assert.equal(s.days, 2); assert.equal(s.continuous, false); assert.equal(s.missing, 2);
  // without a calendar the gap cannot be judged
  assert.equal(streakOf(rows, (r) => r.fiiNet).continuous, null);
  // a holiday in between is not a missing session (2 Oct 2026 is a holiday here)
  const h = streakOf([row('2026-10-01', -1, 1), row('2026-10-05', -2, 1)], (r) => r.fiiNet, cal2026);
  assert.equal(h.continuous, true); assert.equal(h.missing, 0);
});

test('F02: 20-session sums need 20 real sessions — a missing session blanks the window', () => {
  const days: string[] = [];
  for (let d = new Date('2026-09-01T00:00:00Z'); days.length < 22; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10); const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && iso !== '2026-10-02') days.push(iso);
  }
  const full = days.map((d) => row(d, 10, 1));
  const r = rollingSum(full, (x) => x.fiiNet, 20, cal2026);
  assert.equal(r[18].sum, null); assert.equal(r[19].sum, 200); assert.equal(r[21].sum, 200);
  // drop one session in the middle: every window covering it is blank (not "the last 20 known days")
  const holed = full.filter((x) => x.date !== days[10]);
  const r2 = rollingSum(holed, (x) => x.fiiNet, 20, cal2026);
  assert.ok(r2.every((p) => p.sum == null), 'no complete 20-session window exists');
  assert.equal(trailingSessions(holed, (x) => x.fiiNet, cal2026), 11);
  assert.equal(trailingSessions(full, (x) => x.fiiNet, cal2026), 22);
  // a stored row with no figure (DII before NSE) also blanks it
  assert.equal(rollingSum(full.map((x, i) => (i === 5 ? { ...x, diiNet: null } : x)), (x) => x.diiNet, 20, cal2026)[19].sum, null);
});

test('F02: period sums and months say when they are partial', () => {
  const rows = [row('2026-10-14', -500, 300), row('2026-10-15', -5285.37, 3319.39)];
  const s = sumSince(rows, (r) => r.fiiNet, rangeStart('1M', '2026-10-15')!, cal2026);
  assert.equal(s.days, 2);
  assert.ok(s.expected != null && s.expected > 20, `expected ~22 sessions, got ${s.expected}`);
  assert.equal(sumSince(rows, (r) => r.fiiNet, '2026-09-15').expected, null, 'unknown calendar → unknown coverage');
  const m = monthlyTotals([row('2026-09-30', 1, 1), ...rows], 24, cal2026);
  const oct = m.find((x) => x.month === '2026-10')!;
  assert.equal(oct.partial, true); assert.equal(oct.toDate, true);
  const sep = m.find((x) => x.month === '2026-09')!;
  assert.equal(sep.partial, true, 'one of ~21 September sessions');
  assert.equal(sep.toDate, false);
});

test('F01: the headline stays "provisional NSE" after NSDL arrives; charts use one labelled series; combined only from NSE', () => {
  const rows = [
    row('2026-10-12', -1000, null, { source: 'nsdl', provisional: false, fpiFinalNet: -1000 }),
    row('2026-10-13', -2000, 1500, { provisional: false, fpiFinalNet: -1800 }),
    row('2026-10-14', -500, 400, { provisional: false, fpiFinalNet: -450 }),
  ];
  const v = buildView(rows, [], '1M');
  assert.equal(v.today!.date, '2026-10-14');
  assert.equal(v.today!.provisional, true, 'the shown −500 is NSE provisional even though NSDL confirmed −450');
  assert.equal(v.today!.fii.net, -500);
  assert.equal(v.today!.fpiConfirmedNet, -450);
  assert.equal(v.today!.fiiLabel, 'NSE provisional');
  assert.equal(v.today!.combinedNet, -100);
  // explicit NSE series: no NSDL value leaks into the line
  const nse = buildView(rows, [], '1M', { basis: 'nse' });
  assert.deepEqual(nse.history.map((h) => h.fii), [null, -2000, -500]);
  assert.equal(nse.basisAuto, false);
  const nsdl = buildView(rows, [], '1M', { basis: 'nsdl' });
  assert.deepEqual(nsdl.history.map((h) => h.fii), [-1000, -1800, -450]);
  assert.deepEqual(nsdl.history.map((h) => h.fiiCum), [-1000, -2800, -3250]);
  assert.match(nsdl.basisLabel, /NSDL final/);
  // auto: NSE only when it covers the range start
  assert.equal(autoBasis(rows, '2026-09-14'), 'nsdl');
  assert.equal(autoBasis(rows.slice(1), '2026-10-13'), 'nse');
  // DII and combined never come from an NSDL row
  assert.equal(nsdl.history[0].dii, null);
  assert.equal(nsdl.streaks.combined.days, 2);
});

test('F03: NSE file — dates, unique categories, non-negative gross, buy − sell = net — else quarantined', () => {
  const ok = JSON.parse(read('fixtures', 'nse-fiidii-2026-10-15.json'));
  assert.deepEqual(checkNseFiiDii(ok).problems, []);
  assert.equal(parseNseFiiDii(ok)!.date, '2026-10-15');
  const mixed = [{ category: 'FII/FPI', date: '15-Oct-2026', buyValue: '10', sellValue: '5', netValue: '5' }, { category: 'DII', date: '14-Oct-2026', buyValue: '8', sellValue: '4', netValue: '4' }];
  const m = checkNseFiiDii(mixed);
  assert.equal(m.day, null); assert.match(m.problems.join(), /different dates/);
  const bad = checkNseFiiDii([{ category: 'FII/FPI', date: '15-Oct-2026', buyValue: '10', sellValue: '5', netValue: '999' }]);
  assert.equal(bad.day, null); assert.match(bad.problems.join(), /does not match the stated net/);
  assert.equal(checkNseFiiDii([{ category: 'FII/FPI', date: '15-Oct-2026', buyValue: '-10', sellValue: '5', netValue: '-15' }]).day, null);
  const twice = checkNseFiiDii([...ok, { category: 'DII', date: '15-Oct-2026', buyValue: '1', sellValue: '1', netValue: '0' }]);
  assert.equal(twice.day, null); assert.match(twice.problems.join(), /more than once/);
  // rounding is tolerated
  assert.ok(checkNseFiiDii([{ category: 'FII/FPI', date: '15-Oct-2026', buyValue: '12735.59', sellValue: '18020.96', netValue: '-5285.38' }]).day);
  // NSDL rows that do not add up are dropped
  const html = '<table><tr><td>15-Oct-2026</td><td>Equity</td><td>Stock Exchange</td><td>100</td><td>50</td><td>999</td></tr><tr><td>16-Oct-2026</td><td>Equity</td><td>Stock Exchange</td><td>100</td><td>50</td><td>50</td></tr></table>';
  assert.deepEqual(parseNsdlDaily(html).map((r) => r.reportDate), ['2026-10-16']);
});

test('F03: a sector report must add up to its own Grand Total', () => {
  const rep: SectorReport = {
    reportDate: '2026-09-30', fortnight: 'September 16-30, 2026',
    sectors: [{ sector: 'Auto', aucCr: 500000, netCr: -300, netPrevCr: null }, { sector: 'IT', aucCr: 300000, netCr: 80, netPrevCr: null }],
    total: { sector: 'Total', aucCr: 800000, netCr: -220, netPrevCr: null },
  };
  assert.deepEqual(sectorReportProblems(rep), []);
  assert.match(sectorReportProblems({ ...rep, total: { ...rep.total!, aucCr: 900000 } }).join(), /holdings add up/);
  assert.match(sectorReportProblems({ ...rep, total: { ...rep.total!, netCr: 5000 } }).join(), /net flows add up/);
  assert.match(sectorReportProblems({ ...rep, sectors: [...rep.sectors, rep.sectors[0]], total: null }).join(), /appears twice/);
});

test('F01–F03 / accessibility / themes: the page is wired', () => {
  const page = read('..', '..', 'app', '(dashboard)', 'fii-dii', 'page.tsx');
  const sectors = read('..', '..', 'app', '(dashboard)', 'fii-dii', 'sectors.tsx');
  const charts = read('..', '..', 'app', '(dashboard)', 'fii-dii', 'charts.tsx');
  const route = read('..', '..', 'app', 'api', 'v1', 'fii-dii', 'route.ts');
  const job = read('..', 'fii-dii', 'job.ts');
  assert.match(page, /PROVISIONAL · NSE/);
  assert.ok(!page.includes("'FPI CONFIRMED'"), 'the old label that sat on the NSE number is gone');
  assert.ok(!/no free public source has older DII history/.test(page));
  assert.match(page, /This installation has collected NSE FII and DII history from/);
  assert.match(page, /Need 20 sessions in a row/);
  assert.match(page, /aria-pressed=\{on\}/);
  assert.match(page, /The latest NSE FII\/DII file was rejected/);
  assert.match(page, /stock-exchange<\/i> rows only/);
  assert.match(page, /ChartSummary/);
  assert.match(sectors, /aria-sort=/); assert.match(sectors, /role="columnheader"/); assert.match(sectors, /aria-pressed=\{mode === m\}/);
  assert.match(charts, /tabIndex: 0/); assert.match(charts, /ArrowLeft/);
  assert.match(route, /basis/); assert.match(route, /sessionCalendar/); assert.match(route, /nse_quarantine/);
  assert.match(job, /writeQuarantine\('nse_quarantine'/); assert.match(job, /sectorReportProblems/);
  // themes: no hard-coded white card / page backgrounds left in the page
  assert.ok(!/background: '#fff(?:fff)?'/.test(page), 'page');
  assert.ok(!/background: '#fff(?:fff)?'/.test(sectors), 'sectors');
  assert.ok(!/background: '#fff'/.test(read('..', '..', 'app', '(dashboard)', 'fii-dii', 'panels.tsx')), 'panels');
  assert.match(read('..', '..', 'app', '(dashboard)', 'fii-dii', 'format.ts'), /var\(--mc-bg-1, #ffffff\)/, 'white stays the default');
  assert.match(page, /overflowX: 'hidden'/, '390 px: no horizontal page scroll');
  void UNKNOWN_CALENDAR;
});
