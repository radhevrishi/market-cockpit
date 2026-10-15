// zzz1032 — THE LATEST EARNINGS RESULT of each company, for the Pine Screener (and any screener row).
//
// Owner: "also add the latest earnings result to this — Earnings Opportunities gives you this data, or Conviction Beats, or a
// combination of both". India and US.
//
// Sources, combined per company (pure here; the server reads them in latest-result-server.ts):
//   · Earnings Opportunities — the graded days (India `graded:<v>:<date>`, US `us-graded:<engine>:<date>|1`): every graded result,
//     whatever its grade (BLOCKBUSTER / STRONG / MIXED / AVOID).
//   · Conviction Beats — the server bench (BLOCKBUSTER / STRONG names, kept longer than the scan window) and, in the browser, this
//     browser's own bench. A company on a bench gets the 🏆 mark.
// Rules: one record per company; the NEWEST filing date wins (on the same filing, the more recent grading wins); a board meeting is
// not a result — a row marked 'Upcoming', a row without a grade and a filing date in the future are ignored. Nothing is made up:
// a figure the source does not carry stays blank, and a company with no result found has no record.

export type ResultTier = 'BLOCKBUSTER' | 'STRONG' | 'GOOD' | 'MIXED' | 'AVOID';
export const RESULT_TIERS: readonly ResultTier[] = ['BLOCKBUSTER', 'STRONG', 'GOOD', 'MIXED', 'AVOID'];
/** Grade order for sorting / "grade at least" (higher = stronger result). */
export const TIER_RANK: Record<ResultTier, number> = { BLOCKBUSTER: 5, STRONG: 4, GOOD: 3, MIXED: 2, AVOID: 1 };
export type ResultSource = 'EO' | 'CB' | 'EO+CB';

/** One company's latest result, kept small (it travels for every company of a market). */
export interface LatestResult {
  /** filing date, YYYY-MM-DD ('' = a Conviction Beats name whose result is not on file here) */
  d: string;
  /** quarter label, e.g. 'Q2 FY27' */
  q?: string;
  g?: ResultTier;
  /** sales / profit (India PAT, US net income) / EPS, year on year, % */
  s?: number; p?: number; e?: number;
  /** the grader's composite score */
  sc?: number;
  /** the day the result was graded (Earnings Opportunities date) */
  gd?: string;
  src: ResultSource;
  /** on the Conviction Beats bench */
  cb?: 1;
}
export type LatestResultIndex = Record<string, LatestResult>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
// two decimals: a figure rounded once for display (15.47 → '+15%'), never twice (15.47 → 15.5 → '+16%')
const r1 = (v: unknown): number | undefined => (fin(v) ? Math.round(v * 100) / 100 : undefined);
export const tierOf = (v: unknown): ResultTier | undefined => {
  const t = String(v ?? '').toUpperCase().trim();
  return (RESULT_TIERS as readonly string[]).includes(t) ? (t as ResultTier) : undefined;
};
/** A screener ticker key: upper case, no exchange prefix / Yahoo suffix / bench quarter suffix ('MTAR@Q3-2026'). */
export function resultKey(t: unknown): string {
  return String(t ?? '').split('@')[0].trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');
}
/** Company names compared loosely (India: a BSE scrip id and an NSE symbol for the same company). */
export function nameKey(n: unknown): string {
  return String(n ?? '').toLowerCase().replace(/&amp;/g, '&').replace(/&/g, ' and ')
    .replace(/\b(limited|ltd|inc|incorporated|corp|corporation|co|company|plc|the)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const quarterLabel = (r: any): string | undefined => {
  const q = typeof r?.quarter === 'string' ? r.quarter.trim() : '';
  if (!q) return undefined;
  // a browser bench entry keeps 'Q2' + fiscal_year 2027
  if (/^Q[1-4]$/.test(q) && fin(r?.fiscal_year)) return `${q} FY${String(r.fiscal_year).slice(-2)}`;
  return q.slice(0, 24);
};

/** One graded row (or a bench entry) → its result record; null when it is not a result (no grade, upcoming, no / future date). */
export function resultFromRow(r: any, gradedDay: string | null, src: ResultSource, today: string): LatestResult | null {
  if (!r || typeof r !== 'object') return null;
  if (String(r.quality ?? '') === 'Upcoming' || r.upcoming === true || r.scheduled === true) return null;   // a board meeting is not a filing
  const g = tierOf(r.tier);
  if (!g) return null;
  const fd = typeof r.filing_date === 'string' ? r.filing_date.slice(0, 10) : '';
  const d = ISO.test(fd) ? fd : gradedDay && ISO.test(gradedDay) ? gradedDay : '';
  if (!d || d > today) return null;
  const out: LatestResult = { d, g, src };
  const q = quarterLabel(r); if (q) out.q = q;
  const s = r1(r.sales_yoy_pct), p = r1(r.net_profit_yoy_pct), e = r1(r.eps_yoy_pct), sc = r1(r.composite_score);
  if (s !== undefined) out.s = s;
  if (p !== undefined) out.p = p;
  if (e !== undefined) out.e = e;
  if (sc !== undefined) out.sc = Math.round(sc);
  const gd = gradedDay || (typeof r.seen_date === 'string' ? r.seen_date.slice(0, 10) : '');
  if (gd && ISO.test(gd)) out.gd = gd;
  if (src !== 'EO') out.cb = 1;
  return out;
}

/** Newer of two records for the same company: the newer filing; same filing → the later grading (then the higher grade). */
export function newerResult(a: LatestResult | undefined, b: LatestResult): boolean {
  if (!a) return true;
  if (b.d !== a.d) return b.d > a.d;
  if ((b.gd || '') !== (a.gd || '')) return (b.gd || '') > (a.gd || '');
  return (b.g ? TIER_RANK[b.g] : 0) > (a.g ? TIER_RANK[a.g] : 0);
}
/** Put `rec` into the index, keeping the Conviction Beats mark and the combined source. */
export function mergeResult(index: LatestResultIndex, key: string, rec: LatestResult): void {
  const had = index[key];
  if (!had) { index[key] = { ...rec }; return; }
  let next: LatestResult;
  if (!had.d) next = { ...(rec.d ? rec : had) };
  else if (!rec.d) next = { ...had };
  else if (rec.d === had.d && rec.src !== had.src) {
    // the same filing seen by both sources: one record, both named — the Earnings Opportunities grading (the full day's grade) leads
    const eo = (x: LatestResult) => x.src !== 'CB';
    const base = eo(had) && eo(rec) ? (newerResult(had, rec) ? rec : had) : eo(had) ? had : eo(rec) ? rec : newerResult(had, rec) ? rec : had;
    next = { ...base, src: 'EO+CB' };
  } else next = newerResult(had, rec) ? { ...rec } : { ...had };
  if (had.cb || rec.cb) next.cb = 1;
  index[key] = next;
}

export interface GradedDay { date: string; payload: any }
/**
 * Build the index from graded days (any order) and bench entries. `today` = YYYY-MM-DD (a later filing date is ignored).
 * `universe` (optional): the screener's companies, to match a result filed under another code (India: a BSE scrip id for an NSE
 * company) by company name — only when that name belongs to exactly one company and the code itself is not in the universe.
 */
export function buildLatestResultIndex(o: {
  days: readonly GradedDay[]; bench?: readonly any[] | null; today: string;
  universe?: ReadonlyArray<{ t: string; n?: string | null }> | null;
  /** match codes outside the universe by company name (India only: US tickers are the issuer's own; a note or preferred line of
   *  the same issuer would otherwise be folded in) */
  byNameMatch?: boolean;
}): { index: LatestResultIndex; byName: number; rows: number } {
  const raw: LatestResultIndex = {};
  const names = new Map<string, string>();   // result key → company name (for the name match)
  let rows = 0;
  for (const day of o.days) {
    const bt = day?.payload?.by_tier;
    if (!bt || typeof bt !== 'object') continue;
    for (const list of Object.values(bt)) {
      if (!Array.isArray(list)) continue;
      for (const r of list) {
        const k = resultKey(r?.ticker);
        if (!k) continue;
        const rec = resultFromRow(r, day.date, 'EO', o.today);
        if (!rec) continue;
        rows++;
        mergeResult(raw, k, rec);
        if (r.company && !names.has(k)) names.set(k, String(r.company));
      }
    }
  }
  for (const e of o.bench || []) {
    const k = resultKey(e?.ticker);
    if (!k) continue;
    const rec = resultFromRow(e, null, 'CB', o.today);
    if (rec) mergeResult(raw, k, rec);
    else if (tierOf(e?.tier) || !e?.tier) mergeResult(raw, k, { d: '', src: 'CB', cb: 1 });
    if (e?.company && !names.has(k)) names.set(k, String(e.company));
  }
  if (!o.universe) return { index: raw, byName: 0, rows };
  // keep only universe companies; a code outside the universe is matched by a unique company name
  const inU = new Set(o.universe.map((u) => resultKey(u.t)));
  const nameToT = new Map<string, string | null>();
  for (const u of o.universe) {
    const nk = nameKey(u.n);
    if (!nk) continue;
    nameToT.set(nk, nameToT.has(nk) ? null : resultKey(u.t));   // null = two companies share the name: never matched by name
  }
  const index: LatestResultIndex = {};
  let byName = 0;
  for (const [k, rec] of Object.entries(raw)) if (inU.has(k)) mergeResult(index, k, rec);
  for (const [k, rec] of Object.entries(raw)) {
    if (inU.has(k) || o.byNameMatch === false) continue;
    const t = nameToT.get(nameKey(names.get(k)));
    if (!t) continue;
    mergeResult(index, t, rec); byName++;
  }
  return { index, byName, rows };
}

/** A browser Conviction Beats bench (India: getConvictionList(); US: the stored map's values) folded into the server index. Only
 *  companies of `universe` (when given) are added. Returns a new index. */
export function withBrowserBench(index: LatestResultIndex | null, entries: readonly any[], today: string, universe?: ReadonlySet<string> | null): LatestResultIndex {
  const out: LatestResultIndex = { ...(index || {}) };
  for (const e of entries) {
    const k = resultKey(e?.ticker);
    if (!k || (universe && !universe.has(k))) continue;
    const rec = resultFromRow(e, null, 'CB', today);
    mergeResult(out, k, rec || { d: '', src: 'CB', cb: 1 });
  }
  return out;
}

/** Each row with its latest result as `lr` (rows without one are returned unchanged). */
export function attachLatestResults<T extends { t: string }>(rows: readonly T[], index: LatestResultIndex | null): Array<T & { lr?: LatestResult }> {
  if (!index) return rows as Array<T & { lr?: LatestResult }>;
  return rows.map((r) => { const lr = index[resultKey(r.t)]; return lr ? { ...r, lr } : r; });
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-12' → '12 Oct' (with the year when it is not `today`'s year). */
export function shortDate(d: string, today?: string): string {
  if (!ISO.test(d)) return '';
  const [y, m, day] = d.split('-');
  return `${Number(day)} ${MON[Number(m) - 1]}${today && today.slice(0, 4) !== y ? ` ${y}` : ''}`;
}
/** Whole days from the filing date to `today` (both YYYY-MM-DD); null without a date. */
export function daysSince(d: string | undefined, today: string): number | null {
  if (!d || !ISO.test(d) || !ISO.test(today)) return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
}
export const profitWord = (market: 'US' | 'IN') => (market === 'US' ? 'Net income' : 'PAT');
const sg = (v: number) => `${v > 0 ? '+' : ''}${Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(0)}%`;
/** The compact cell text: 'Q2 FY27 · 12 Oct · STRONG · Sales +24% · PAT +41%' ('' when there is no result). */
export function resultText(lr: LatestResult | null | undefined, market: 'US' | 'IN', today: string): string {
  if (!lr || !lr.d) return lr?.cb ? '🏆 CB · result not on file' : '';
  const parts = [lr.q, shortDate(lr.d, today), lr.g].filter(Boolean) as string[];
  if (lr.s !== undefined) parts.push(`Sales ${sg(lr.s)}`);
  if (lr.p !== undefined) parts.push(`${profitWord(market)} ${sg(lr.p)}`);
  return `${lr.cb ? '🏆 ' : ''}${parts.join(' · ')}`;
}
export const SOURCE_WORDS: Record<ResultSource, string> = {
  EO: 'Earnings Opportunities', CB: 'Conviction Beats bench', 'EO+CB': 'Earnings Opportunities + Conviction Beats bench',
};
/** The tooltip / detail lines. */
export function resultLines(lr: LatestResult | null | undefined, market: 'US' | 'IN', today: string): string[] {
  if (!lr) return ['No graded result on file for this company (Earnings Opportunities, last ~100 days, or Conviction Beats).'];
  if (!lr.d) return ['On the Conviction Beats bench — its result is not in the graded data on file.'];
  const ago = daysSince(lr.d, today);
  const fy = `${shortDate(lr.d)} ${lr.d.slice(0, 4)}`;
  const figs = [lr.s !== undefined ? `Sales ${sg(lr.s)}` : '', lr.p !== undefined ? `${profitWord(market)} ${sg(lr.p)}` : '', lr.e !== undefined ? `EPS ${sg(lr.e)}` : ''].filter(Boolean);
  return [
    `Result filed ${fy}${ago != null ? ` (${ago === 0 ? 'today' : ago === 1 ? '1 day ago' : `${ago} days ago`})` : ''}${lr.q ? ` — ${lr.q}` : ''}`,
    lr.g ? `Grade: ${lr.g}${lr.sc !== undefined ? ` (composite ${lr.sc})` : ''}` : '',
    figs.length ? `${figs.join(' · ')} (year on year)` : 'Year-on-year figures not on file',
    `Source: ${SOURCE_WORDS[lr.src]}${lr.gd && lr.gd !== lr.d ? ` (graded ${shortDate(lr.gd)})` : ''}${lr.cb && lr.src === 'EO' ? ' · on the Conviction Beats bench' : ''}`,
    'The grade reads the reported figures only (not the share price).',
  ].filter(Boolean);
}
export const resultLink = (market: 'US' | 'IN') => (market === 'US' ? '/us-earnings-opportunities' : '/earnings-opportunities');

// ── filters / sorting ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ResultRule { resDays?: number | null; resTier?: 'STRONG' | 'BLOCKBUSTER' | null; resCb?: boolean }
export const RES_DAY_CHOICES: readonly number[] = [7, 14, 30, 60, 90];
export const resultRuleOn = (q: ResultRule): boolean => q.resDays != null || q.resTier != null || !!q.resCb;
/** Does a row's latest result pass the result rules? (no rule on → true) */
export function passesResult(lr: LatestResult | null | undefined, q: ResultRule, today: string): boolean {
  if (!resultRuleOn(q)) return true;
  if (q.resCb && !lr?.cb) return false;
  if (q.resDays != null) { const n = daysSince(lr?.d, today); if (n == null || n > q.resDays) return false; }
  if (q.resTier != null && !(lr?.g && TIER_RANK[lr.g] >= TIER_RANK[q.resTier])) return false;
  return true;
}
/** The result rules in words, for the query summary ('' when off). */
export function resultRuleText(q: ResultRule): string {
  return [q.resDays != null ? `Result in last ${q.resDays} days` : '', q.resTier ? `Grade ≥ ${q.resTier}` : '', q.resCb ? 'Conviction Beats only' : ''].filter(Boolean).join(' · ');
}
/** Sort values: by result date (epoch day) and by grade (then date). null = no result (last). */
export function resultSortDate(lr: LatestResult | null | undefined): number | null {
  return lr?.d && ISO.test(lr.d) ? Date.parse(`${lr.d}T00:00:00Z`) / 86_400_000 : null;
}
export function resultSortTier(lr: LatestResult | null | undefined): number | null {
  if (!lr?.g) return null;
  const d = resultSortDate(lr);
  return TIER_RANK[lr.g] * 1e6 + (d ?? 0);
}
/** CSV columns for the latest result. */
export const RESULT_CSV_HEAD = ['Latest result date', 'Latest result quarter', 'Latest result grade', 'Days since result', 'Sales YoY (%)', 'Profit YoY (%) (India PAT / US net income)', 'EPS YoY (%)', 'Result source', 'Conviction Beats'];
export function resultCsvCells(lr: LatestResult | null | undefined, today: string): Array<string | number> {
  if (!lr) return ['', '', '', '', '', '', '', '', ''];
  return [lr.d || '', lr.q || '', lr.g || '', daysSince(lr.d, today) ?? '', lr.s ?? '', lr.p ?? '', lr.e ?? '', lr.d ? SOURCE_WORDS[lr.src] : '', lr.cb ? 'yes' : ''];
}
/** Today's date (YYYY-MM-DD) in the market's own time zone. */
export function marketToday(market: 'US' | 'IN', now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: market === 'US' ? 'America/New_York' : 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
