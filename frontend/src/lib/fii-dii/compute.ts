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
}

export type Dir = 'buy' | 'sell';
export interface Streak { dir: Dir | null; days: number; totalCr: number; since: string | null }

/** Consecutive trading days of net buying (or selling), counted back from the latest day that has a figure. A day with no
 *  figure (e.g. DII before NSE rows exist) ends the count; a net of exactly 0 ends it too. */
export function streakOf(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null): Streak {
  const asc = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  let i = asc.length - 1;
  while (i >= 0 && pick(asc[i]) == null) i--;
  if (i < 0) return { dir: null, days: 0, totalCr: 0, since: null };
  const first = pick(asc[i])!;
  if (first === 0) return { dir: null, days: 0, totalCr: 0, since: null };
  const dir: Dir = first > 0 ? 'buy' : 'sell';
  let days = 0, total = 0, since: string | null = null;
  for (; i >= 0; i--) {
    const v = pick(asc[i]);
    if (v == null || v === 0 || (v > 0) !== (dir === 'buy')) break;
    days++; total += v; since = asc[i].date;
  }
  return { dir, days, totalCr: Math.round(total * 100) / 100, since };
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
/** First date (inclusive) of a range ending at `latest`. ALL → null. */
export function rangeStart(range: Range, latest: string): string | null {
  if (range === 'ALL') return null;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36 }[range];
  const d = new Date(`${latest}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
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

/** Rolling n-trading-day sum of the picked net (null until n days with a figure exist). */
export function rollingSum(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null, n = 20): Array<{ date: string; sum: number | null }> {
  const asc = [...rows].sort((a, b) => a.date.localeCompare(b.date)).filter((r) => pick(r) != null);
  const out: Array<{ date: string; sum: number | null }> = [];
  let win = 0;
  for (let i = 0; i < asc.length; i++) {
    win += pick(asc[i])!;
    if (i >= n) win -= pick(asc[i - n])!;
    out.push({ date: asc[i].date, sum: i >= n - 1 ? Math.round(win * 100) / 100 : null });
  }
  return out;
}

/** Sum of the picked net over the last `days` calendar days ending at the latest row. */
export function sumSince(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null, from: string): { sum: number; days: number } {
  let sum = 0, days = 0;
  for (const r of rows) {
    if (r.date < from) continue;
    const v = pick(r);
    if (v == null) continue;
    sum += v; days++;
  }
  return { sum: Math.round(sum * 100) / 100, days };
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
