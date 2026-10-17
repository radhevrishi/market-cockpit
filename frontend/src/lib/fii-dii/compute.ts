// zzz1055 — FII / DII flows: pure maths for the page and the API (streaks, cumulative flow, rolling net, sector table).

export type FlowSource = 'nse' | 'nsdl';
export interface DailyRow {
  date: string;                 // trading day (IST), YYYY-MM-DD
  fiiBuy: number | null; fiiSell: number | null; fiiNet: number | null;
  diiBuy: number | null; diiSell: number | null; diiNet: number | null;
  provisional: boolean;         // true = NSE provisional figure not yet confirmed by NSDL
  source: FlowSource;           // where fii*/dii* came from
  fetchedAt: string | null;
  fpiFinalNet: number | null;   // NSDL-confirmed FPI equity net for the same trading day (when it has arrived)
  finalAt: string | null;
  // zzz1060 — NSDL FPI asset-class split for the trading day (equity incl. primary market, debt, hybrid), when stored
  fpiEqTotal?: number | null; fpiDebt?: number | null; fpiHybrid?: number | null;
}

export type Dir = 'buy' | 'sell';
/**
 * zzz1067 (F02) — `days` counts OBSERVED same-direction days. `continuous` says whether those days were back-to-back trading
 * sessions: true = checked against the NSE holiday list and nothing is missing, false = `missing` sessions have no stored
 * figure (the run may really have been broken), null = the calendar for that period is not known, so continuity is unproven.
 */
export interface Streak { dir: Dir | null; days: number; totalCr: number; since: string | null; continuous: boolean | null; missing: number }

// ── zzz1067 (F02): the NSE session calendar ──────────────────────────────────

/** Which weekdays are NSE holidays, and for which dates that is actually known (a year without a stored holiday list is not). */
export interface SessionCalendar { isHoliday: (iso: string) => boolean; knows: (iso: string) => boolean }
/** No calendar: every weekday could be a session, nothing is known — continuity is never claimed. */
export const UNKNOWN_CALENDAR: SessionCalendar = { isHoliday: () => false, knows: () => false };
/** A calendar from a holiday predicate and the years whose holiday list is stored. */
export function sessionCalendar(isHoliday: (iso: string) => boolean, knownYears: Iterable<string>): SessionCalendar {
  const years = new Set(knownYears);
  return { isHoliday, knows: (iso) => years.has(iso.slice(0, 4)) };
}

export const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isWeekday = (iso: string) => { const wd = new Date(`${iso}T00:00:00Z`).getUTCDay(); return wd !== 0 && wd !== 6; };

/** Sessions the calendar EXPECTS in [from, to] (weekdays that are not holidays, in years whose holidays are known). */
export function expectedSessions(from: string, to: string, cal: SessionCalendar): string[] {
  const out: string[] = [];
  for (let d = from, i = 0; d <= to && i < 4000; d = addDaysIso(d, 1), i++) if (isWeekday(d) && cal.knows(d) && !cal.isHoliday(d)) out.push(d);
  return out;
}

/** Between two observed days (exclusive): how many expected sessions have no row, and whether any day there is unknown. */
export function gapBetween(a: string, b: string, cal: SessionCalendar, observed: ReadonlySet<string>): { missing: number; unknown: boolean } {
  let missing = 0, unknown = false;
  for (let d = addDaysIso(a, 1), i = 0; d < b && i < 400; d = addDaysIso(d, 1), i++) {
    if (!isWeekday(d) || observed.has(d)) continue;
    if (!cal.knows(d)) { unknown = true; continue; }
    if (!cal.isHoliday(d)) missing++;
  }
  return { missing, unknown };
}

/** Consecutive OBSERVED days of net buying (or selling), counted back from the latest day that has a figure. A day with no
 *  figure (e.g. DII before NSE rows exist) ends the count; a net of exactly 0 ends it too. zzz1067: sessions missing between
 *  two observed days (on the NSE calendar) are counted in `missing` and make `continuous` false — the run is then "observed
 *  days", not proven back-to-back sessions. */
export function streakOf(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null, cal: SessionCalendar = UNKNOWN_CALENDAR): Streak {
  const asc = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const none: Streak = { dir: null, days: 0, totalCr: 0, since: null, continuous: null, missing: 0 };
  let i = asc.length - 1;
  while (i >= 0 && pick(asc[i]) == null) i--;
  if (i < 0) return none;
  const first = pick(asc[i])!;
  if (first === 0) return none;
  const dir: Dir = first > 0 ? 'buy' : 'sell';
  const observed = new Set(asc.map((r) => r.date));
  let days = 0, total = 0, since: string | null = null, missing = 0, unknown = false;
  for (; i >= 0; i--) {
    const v = pick(asc[i]);
    if (v == null || v === 0 || (v > 0) !== (dir === 'buy')) break;
    if (since) { const g = gapBetween(asc[i].date, since, cal, observed); missing += g.missing; unknown = unknown || g.unknown; }
    days++; total += v; since = asc[i].date;
  }
  // no weekday between two observed days = certainly back-to-back, whatever the holiday list says
  const continuous = missing > 0 ? false : unknown ? null : true;
  return { dir, days, totalCr: Math.round(total * 100) / 100, since, continuous, missing };
}

/** Share of the day's turnover that was buying, in %. */
export function buyShare(buy: number | null, sell: number | null): number | null {
  if (buy == null || sell == null || buy + sell <= 0) return null;
  return Math.round((buy / (buy + sell)) * 1000) / 10;
}

export type Range = '1M' | '3M' | '6M' | '1Y' | '3Y' | 'ALL';
export const RANGES: readonly Range[] = ['1M', '3M', '6M', '1Y', '3Y', 'ALL'];
export function parseRange(s: unknown): Range {
  const t = String(s || '').toUpperCase();
  return (RANGES as readonly string[]).includes(t) ? (t as Range) : '3M';
}
/** zzz1067 (F02) — `iso` moved back `months` calendar months, the day clamped to the end of the target month:
 *  31 Mar − 1 month = 28 Feb (29 in a leap year), never 3 Mar (JavaScript's Date overflow). */
export function minusMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12), tm = total - ty * 12;           // tm 0–11
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** First date (inclusive) of a range ending at `latest`. ALL → null. */
export function rangeStart(range: Range, latest: string): string | null {
  if (range === 'ALL') return null;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36 }[range];
  return minusMonths(latest, months);
}

export interface CumPoint { date: string; daily: number; cum: number }
/** Running total of the picked daily net, starting at 0 before the first day in the list (rows outside [from, …] dropped). */
export function cumulativeSeries(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null, from: string | null = null): CumPoint[] {
  const out: CumPoint[] = [];
  let cum = 0;
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (from && r.date < from) continue;
    const v = pick(r);
    if (v == null) continue;
    cum += v;
    out.push({ date: r.date, daily: v, cum: Math.round(cum * 100) / 100 });
  }
  return out;
}

/** The session list a rolling window walks: every stored day plus every session the calendar expects between the first and
 *  the last stored day (a year without a holiday list adds nothing — there only stored days count). */
export function sessionLine(rows: readonly DailyRow[], cal: SessionCalendar = UNKNOWN_CALENDAR): string[] {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  if (!dates.length) return [];
  return [...new Set([...dates, ...expectedSessions(dates[0], dates[dates.length - 1], cal)])].sort();
}

/** zzz1067 (F02) — rolling n-SESSION sum of the picked net: the window is the last n trading sessions (calendar-aware, see
 *  sessionLine), and the sum is null unless every one of those n sessions has a figure. A stored row without a figure (e.g.
 *  DII before NSE rows exist) or a missing expected session therefore blanks the window — it is never "the last 20 days we
 *  happen to know". Only stored days are returned. */
export function rollingSum(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null, n = 20, cal: SessionCalendar = UNKNOWN_CALENDAR): Array<{ date: string; sum: number | null }> {
  const val = new Map<string, number | null>();
  for (const r of rows) { const v = pick(r); if (!val.has(r.date) || v != null) val.set(r.date, v); }
  const line = sessionLine(rows, cal);
  const out: Array<{ date: string; sum: number | null }> = [];
  let win = 0, have = 0;
  for (let i = 0; i < line.length; i++) {
    const v = val.get(line[i]);
    if (v != null) { win += v; have++; }
    if (i >= n) { const o = val.get(line[i - n]); if (o != null) { win -= o; have--; } }
    if (val.has(line[i])) out.push({ date: line[i], sum: i >= n - 1 && have === n ? Math.round(win * 100) / 100 : null });
  }
  return out;
}

/** zzz1067 (F02) — sessions in a row (ending at the latest session) that have a figure: "Need 20 sessions; N available". */
export function trailingSessions(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null, cal: SessionCalendar = UNKNOWN_CALENDAR): number {
  const have = new Set(rows.filter((r) => pick(r) != null).map((r) => r.date));
  const line = sessionLine(rows, cal);
  let n = 0;
  for (let i = line.length - 1; i >= 0 && have.has(line[i]); i--) n++;
  return n;
}

/** Sum of the picked net from `from` to the latest row. zzz1067 (F02): `expected` = sessions the calendar expects in that
 *  span (null when the calendar is not known there); `days` < `expected` means the sum is a PARTIAL period. */
export function sumSince(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null, from: string, cal: SessionCalendar = UNKNOWN_CALENDAR): { sum: number; days: number; expected: number | null } {
  let sum = 0, days = 0, last: string | null = null;
  for (const r of rows) {
    if (!last || r.date > last) last = r.date;
    if (r.date < from) continue;
    const v = pick(r);
    if (v == null) continue;
    sum += v; days++;
  }
  let expected: number | null = null;
  if (last && last >= from && cal.knows(from) && cal.knows(last)) {
    const known = new Set(expectedSessions(from, last, cal));
    for (const r of rows) if (r.date >= from && r.date <= last && pick(r) != null) known.add(r.date);
    expected = known.size;
  }
  return { sum: Math.round(sum * 100) / 100, days, expected };
}

// ── sectors ──────────────────────────────────────────────────────────────────

export interface SectorFortnightRow { reportDate: string; sector: string; aucCr: number; netCr: number }
export interface SectorLine {
  sector: string;
  aucCr: number;
  sharePct: number;            // of total FPI equity AUC in the latest report
  fortnightCr: number;         // net investment in the latest fortnight
  fortnightPctOfAuc: number | null;
  oneYearCr: number;           // net investment over the reports of the last 12 months
  oneYearPctOfAuc: number | null;
  reports1y: number;           // how many fortnights the 1-year figure covers (24 = full)
}
export interface SectorTable { lastReport: string | null; totalAucCr: number; totalFortnightCr: number; totalOneYearCr: number; reports1y: number; lines: SectorLine[] }

const r2 = (v: number) => Math.round(v * 100) / 100;
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Sector table from stored fortnight rows. 'Total' rows are ignored (totals are re-added from the sectors). */
export function sectorTable(rows: readonly SectorFortnightRow[]): SectorTable {
  const real = rows.filter((r) => r.sector !== 'Total');
  const last = real.reduce<string | null>((m, r) => (!m || r.reportDate > m ? r.reportDate : m), null);
  if (!last) return { lastReport: null, totalAucCr: 0, totalFortnightCr: 0, totalOneYearCr: 0, reports1y: 0, lines: [] };
  const yearAgo = (() => { const d = new Date(`${last}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); })();
  const latest = real.filter((r) => r.reportDate === last);
  const reportsIn = new Set(real.filter((r) => r.reportDate > yearAgo).map((r) => r.reportDate));
  const totalAuc = latest.reduce((s, r) => s + Math.max(r.aucCr, 0), 0);
  const lines: SectorLine[] = latest.map((l) => {
    const yr = real.filter((r) => r.sector === l.sector && r.reportDate > yearAgo);
    const one = yr.reduce((s, r) => s + r.netCr, 0);
    return {
      sector: l.sector,
      aucCr: l.aucCr,
      sharePct: pctOf(l.aucCr, totalAuc) ?? 0,
      fortnightCr: l.netCr,
      fortnightPctOfAuc: pctOf(l.netCr, l.aucCr),
      oneYearCr: r2(one),
      oneYearPctOfAuc: pctOf(one, l.aucCr),
      reports1y: new Set(yr.map((r) => r.reportDate)).size,
    };
  });
  lines.sort((a, b) => b.aucCr - a.aucCr);
  return {
    lastReport: last,
    totalAucCr: r2(totalAuc),
    totalFortnightCr: r2(latest.reduce((s, r) => s + r.netCr, 0)),
    totalOneYearCr: r2(lines.reduce((s, l) => s + l.oneYearCr, 0)),
    reports1y: reportsIn.size,
    lines,
  };
}

export type SectorSort = 'auc' | 'fortnight' | 'oneYear';
export function sortSectors(lines: readonly SectorLine[], by: SectorSort, desc = true): SectorLine[] {
  const key = (l: SectorLine) => (by === 'auc' ? l.aucCr : by === 'fortnight' ? l.fortnightCr : l.oneYearCr);
  return [...lines].sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
}
