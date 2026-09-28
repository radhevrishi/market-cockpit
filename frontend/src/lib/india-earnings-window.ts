// ═══════════════════════════════════════════════════════════════════════════
// INDIA EARNINGS OPPORTUNITIES — MULTI-DAY WINDOW  (zzz814)
//
// The owner: "in USA it's possible to check 60-day earnings at once in Earnings
// Opportunities — missing in India, also fix that."
//
// Everything here is pure (no fetch, no React) so the window maths, the merge,
// both sort orders and the progress line are unit-tested in one place
// (src/lib/__tests__/zzz814-india-earnings-window.test.ts).
//
// WHAT A WINDOW MEANS — same meaning as the US page:
//   "Window 5d" = the last 5 TRADING SESSIONS (Mon–Fri, IST), counted back
//   from the selected date. So 60d is roughly three calendar months, exactly
//   like the US 60d.
//
// The one India difference: Indian companies file results on Saturdays and
// Sundays too (board meetings often run at weekends). The US window can drop
// weekends because EDGAR publishes nothing then; dropping them here would
// silently lose real results. So the window reads every CALENDAR date from
// the oldest session up to the selected date — the weekends that fall between
// the sessions are included, and they do not count towards N.
//
//   Selected Wed 17 Sep, 3d  → sessions Wed 17, Tue 16, Mon 15
//                            → dates 17, 16, 15 (3 dates)
//   Selected Mon 15 Sep, 3d  → sessions Mon 15, Fri 12, Thu 11
//                            → dates 15, 14 (Sun), 13 (Sat), 12, 11 (5 dates)
//   Selected Sun 14 Sep, 1d  → just Sun 14 (1d keeps today's behaviour: the
//                              one date the page is on, weekend or not)
//
// Exchange holidays are not modelled (the US page does not model them either);
// a holiday is simply a date with no filings.
// ═══════════════════════════════════════════════════════════════════════════

export type WindowTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
export const WINDOW_TIER_ORDER: readonly WindowTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

/** Selectable windows, in trading sessions. 1 is today's single-date view. */
export const IN_WINDOWS: readonly number[] = [1, 3, 5, 10, 30, 60];
export const WINDOW_PARAM = 'w';
export const WINDOW_VIEW_PARAM = 'wv';

export type WindowView = 'date' | 'tier';

const DAY_MS = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
}
/** Day of week of a calendar date (0 = Sunday). The UTC weekday of an IST
 *  calendar-date string IS that date's weekday. */
function dow(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}
export function isWeekend(iso: string): boolean {
  const d = dow(iso);
  return d === 0 || d === 6;
}

/** ?w= → a supported window (anything else → 1, today's behaviour). */
export function parseWindowParam(raw: string | null | undefined): number {
  const n = parseInt(String(raw ?? ''), 10);
  return IN_WINDOWS.includes(n) ? n : 1;
}
export function parseWindowViewParam(raw: string | null | undefined): WindowView {
  return raw === 'tier' ? 'tier' : 'date';
}

/**
 * The href with ?w= (and ?wv=) set, every other parameter (?q= included) and
 * the hash untouched. 1d and the default "by date" view are removed from the
 * URL so the owner's plain link stays plain.
 */
export function withWindowParams(href: string, w: number, view: WindowView = 'date'): string {
  const u = new URL(href, 'http://x');
  if (w > 1) u.searchParams.set(WINDOW_PARAM, String(w)); else u.searchParams.delete(WINDOW_PARAM);
  if (w > 1 && view === 'tier') u.searchParams.set(WINDOW_VIEW_PARAM, 'tier'); else u.searchParams.delete(WINDOW_VIEW_PARAM);
  const qs = u.searchParams.toString();
  return u.pathname + (qs ? '?' + qs : '') + u.hash;
}

/** The N trading sessions (Mon–Fri) ending at `anchor`, newest first. */
export function windowSessions(anchor: string, sessions: number): string[] {
  const out: string[] = [];
  if (!ISO_RE.test(anchor) || sessions < 1) return out;
  for (let i = 0; out.length < sessions && i < sessions * 3 + 7; i++) {
    const d = addDays(anchor, -i);
    if (!isWeekend(d)) out.push(d);
  }
  return out;
}

/**
 * Every calendar date the window reads, newest first: from the oldest of the
 * N sessions up to the anchor, weekends included (Indian companies file on
 * them). Dates after `today` are dropped — nothing has been filed there yet.
 * A 1-session window is exactly the anchor date, whatever day it is.
 */
export function windowDates(anchor: string, sessions: number, today?: string): string[] {
  if (!ISO_RE.test(anchor)) return [];
  let out: string[];
  if (sessions <= 1) {
    out = [anchor];
  } else {
    const s = windowSessions(anchor, sessions);
    const oldest = s[s.length - 1] || anchor;
    out = [];
    for (let d = anchor; d >= oldest; d = addDays(d, -1)) out.push(d);
  }
  return today && ISO_RE.test(today) ? out.filter((d) => d <= today) : out;
}

// ─── Merge across days ─────────────────────────────────────────────────────

export interface WindowRowBase {
  ticker: string;
  company?: string;
  tier: WindowTier | string;
  composite_score?: number;
  filing_date?: string;
}

/** One graded day as read from the store (or just graded). */
export interface WindowDay<R extends WindowRowBase = WindowRowBase> {
  date: string;
  by_tier: Partial<Record<string, R[]>> | null | undefined;
  /** Served from an older engine's namespace — graded under the previous rules. */
  engine_stale?: boolean;
  engine?: string | null;
}

/** A merged row: the card plus where it sits in the window. */
export type WindowRow<R extends WindowRowBase = WindowRowBase> = R & {
  /** The date the row is shown under (the graded day it came from). */
  _window_date: string;
  /** Earlier dates in the window on which the same company also reported. */
  _also_reported: string[];
  /** True when that day was graded under the previous engine. */
  _engine_stale: boolean;
  _engine: string | null;
};

const TIER_RANK: Record<string, number> = { BLOCKBUSTER: 0, STRONG: 1, MIXED: 2, AVOID: 3 };
const tierRank = (t: any) => (TIER_RANK[String(t)] ?? 9);

/** Company identity across days: normalised name first (so NSE "DJML" and BSE
 *  "543193" collapse, as the single-day dedupe already does), ticker otherwise. */
export function companyKey(r: { ticker?: string; company?: string }): string {
  const name = String(r.company || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[.,()]/g, ' ')
    .replace(/\b(ltd|limited|pvt|private|corp|corporation|inc|company|co|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name || String(r.ticker || '').trim().toUpperCase();
}
const numericTicker = (t: any) => /^\d+$/.test(String(t || '').trim());

/** Is `a` the better of two rows for the SAME company on the SAME date? */
function betterSameDay(a: WindowRowBase, b: WindowRowBase): boolean {
  const an = numericTicker(a.ticker), bn = numericTicker(b.ticker);
  if (an !== bn) return !an;                                    // NSE ticker beats a BSE scrip code
  if (tierRank(a.tier) !== tierRank(b.tier)) return tierRank(a.tier) < tierRank(b.tier);
  return Number(a.composite_score ?? 0) > Number(b.composite_score ?? 0);
}

/**
 * Merge the graded days into one list, ONE row per company: the LATEST result
 * wins (a company that reported on two dates in the window — a correction, a
 * re-filing, standalone then consolidated — is shown once, on the newer date),
 * and `_also_reported` lists the earlier dates so the card can say so.
 * Rows come back in no particular order; use sortByDate / sortByTier.
 */
export function mergeWindowDays<R extends WindowRowBase>(days: ReadonlyArray<WindowDay<R>>): WindowRow<R>[] {
  const best = new Map<string, { row: R; day: WindowDay<R> }>();
  const seen = new Map<string, Set<string>>();
  for (const day of days) {
    if (!day || !day.by_tier) continue;
    for (const t of WINDOW_TIER_ORDER) {
      for (const row of (day.by_tier[t] || []) as R[]) {
        if (!row || !row.ticker) continue;
        const key = companyKey(row);
        if (!key) continue;
        (seen.get(key) || seen.set(key, new Set()).get(key)!).add(day.date);
        const cur = best.get(key);
        if (!cur || day.date > cur.day.date || (day.date === cur.day.date && betterSameDay(row, cur.row))) {
          best.set(key, { row, day });
        }
      }
    }
  }
  const out: WindowRow<R>[] = [];
  for (const [key, { row, day }] of best) {
    const also = [...(seen.get(key) || [])].filter((d) => d < day.date).sort().reverse();
    out.push({
      ...row,
      _window_date: day.date,
      _also_reported: also,
      _engine_stale: !!day.engine_stale,
      _engine: day.engine ?? null,
    });
  }
  return out;
}

/** The merged rows grouped back into tiers (for the counts, chips, search,
 *  exports and the Conviction Beats sync that already read `by_tier`). */
export function rowsByTier<R extends WindowRowBase>(rows: ReadonlyArray<R>): Record<WindowTier, R[]> {
  const out: Record<WindowTier, R[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  for (const r of rows) {
    const t = (WINDOW_TIER_ORDER as readonly string[]).includes(String(r.tier)) ? (r.tier as WindowTier) : 'AVOID';
    out[t].push(r);
  }
  for (const t of WINDOW_TIER_ORDER) out[t].sort(freshestFirst);
  return out;
}

type Cmp<R> = (a: R, b: R) => number;
// zzz815 — default within-tier order is freshest first (see freshestFirst).
const byScore: Cmp<WindowRowBase> = (a, b) => freshestFirst(a, b);

export interface DateGroup<R> { date: string; rows: R[] }
export interface TierGroup<R> { tier: WindowTier; rows: R[] }

/**
 * BY DATE (the default): newest date first, one group per date; inside a date
 * BLOCKBUSTER → STRONG → MIXED → AVOID, then the page's own order within a
 * tier (freshest filing time first, or the active filter's order when it has one).
 */
export function sortByDate<R extends WindowRow<WindowRowBase>>(rows: ReadonlyArray<R>, within: Cmp<R> = byScore as Cmp<R>): DateGroup<R>[] {
  const m = new Map<string, R[]>();
  for (const r of rows) (m.get(r._window_date) || m.set(r._window_date, []).get(r._window_date)!).push(r);
  return [...m.keys()].sort().reverse().map((date) => ({
    date,
    rows: m.get(date)!.slice().sort((a, b) => (tierRank(a.tier) - tierRank(b.tier)) || within(a, b)),
  }));
}

/**
 * BY TIER: every BLOCKBUSTER in the window first, then STRONG, MIXED, AVOID;
 * newest date first within a tier, then the page's order within a date.
 */
export function sortByTier<R extends WindowRow<WindowRowBase>>(rows: ReadonlyArray<R>, within: Cmp<R> = byScore as Cmp<R>): TierGroup<R>[] {
  const out: TierGroup<R>[] = [];
  for (const tier of WINDOW_TIER_ORDER) {
    const list = rows.filter((r) => r.tier === tier).slice()
      .sort((a, b) => (a._window_date === b._window_date ? within(a, b) : (a._window_date < b._window_date ? 1 : -1)));
    if (list.length) out.push({ tier, rows: list });
  }
  return out;
}

// ─── Progress ──────────────────────────────────────────────────────────────

/**
 *  loading  — being read from the graded store (batched)
 *  ready    — graded by the current engine
 *  stale    — graded, but under the previous rules (shown, labelled, not re-graded)
 *  queued   — not graded anywhere yet; waiting its turn in the one-at-a-time queue
 *  grading  — being graded now
 *  failed   — the grade attempt failed; retry is offered, nothing is hidden
 */
export type DayState = 'loading' | 'ready' | 'stale' | 'queued' | 'grading' | 'failed';

export interface WindowProgress {
  total: number;
  ready: number;       // ready + stale (both are on screen)
  stale: number;
  loading: number;
  queued: number;
  failed: number;
  grading: string | null;
  done: boolean;
  line: string;
}

export function fmtShortDate(iso: string): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? `${d} ${M[m - 1]}` : iso;
}

/** The newest date still waiting to be graded (the queue runs newest first). */
export function nextToGrade(dates: readonly string[], states: Readonly<Record<string, DayState | undefined>>): string | null {
  const q = dates.filter((d) => states[d] === 'queued').sort().reverse();
  return q[0] ?? null;
}

/** Honest progress: what is on screen, what is being graded, what is left. */
export function windowProgress(dates: readonly string[], states: Readonly<Record<string, DayState | undefined>>): WindowProgress {
  let ready = 0, stale = 0, loading = 0, queued = 0, failed = 0;
  const gradingDates: string[] = [];
  for (const d of dates) {
    const s = states[d] ?? 'loading';
    if (s === 'ready') ready++;
    else if (s === 'stale') { ready++; stale++; }
    else if (s === 'loading') loading++;
    else if (s === 'queued') queued++;
    else if (s === 'failed') failed++;
    else if (s === 'grading') gradingDates.push(d);
  }
  const grading: string | null = gradingDates.sort().reverse()[0] ?? null;
  const total = dates.length;
  const parts: string[] = [`${ready} of ${total} day${total === 1 ? '' : 's'} ready`];
  if (loading > 0) parts.push(`reading ${loading} from the graded store…`);
  if (grading) parts.push(`grading ${fmtShortDate(grading)}…`);
  if (queued > 0) parts.push(`${queued} waiting to be graded`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (stale > 0) parts.push(`${stale} graded under the previous rules`);
  const done = loading === 0 && queued === 0 && !grading;
  return { total, ready, stale, loading, queued, failed, grading, done, line: parts.join(' · ') };
}

// ─── Exports ───────────────────────────────────────────────────────────────

const csvCell = (v: any): string => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const numCell = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : '');

export const WINDOW_CSV_HEADER = [
  'Date', 'Tier', 'Ticker', 'Company', 'Quarter', 'Score', 'Quadrant', 'Quality_Score', 'Inflection_Score',
  'Sales_YoY', 'PAT_YoY', 'EPS_YoY', 'Market_Cap_Cr', 'Also_Reported', 'Graded_Under', 'Source',
];

/** CSV of the rows exactly as passed (the caller passes what is on screen). */
export function windowCsv(rows: ReadonlyArray<any>, dateOf: (r: any) => string = (r) => r._window_date || r.filing_date || ''): string {
  const lines = [WINDOW_CSV_HEADER.join(',')];
  for (const c of rows) {
    lines.push([
      dateOf(c), c.tier, c.ticker, c.company, c.quarter, numCell(c.composite_score), c.quadrant ?? '',
      numCell(c.quality_score), numCell(c.inflection_score),
      numCell(c.sales_yoy_pct), numCell(c.net_profit_yoy_pct), numCell(c.eps_yoy_pct), numCell(c.market_cap_cr),
      (c._also_reported || []).join(' '), c._engine_stale ? `previous rules (${c._engine || 'older engine'})` : 'current',
      c.filing_url || c.source || '',
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}

/** TradingView watchlist import: NSE:TICKER, unique, in the order given. BSE
 *  scrip codes go in as BSE:CODE (TradingView's own prefix for them). */
export function tradingViewList(rows: ReadonlyArray<{ ticker: string }>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const t = String(r.ticker || '').trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(`${/^\d+$/.test(t) ? 'BSE' : 'NSE'}:${t}`);
  }
  return out.join(',');
}

// ─── Freshest first (the default order everywhere)  (zzz815) ───────────────
//
// The owner: "by default, fresh should be at the top". Within a tier the most
// recent FILING TIME leads — not the score, not the alphabet. A card with no
// filing time falls back to its filing date and goes LAST within that date
// (a card we can time is placed exactly; one we cannot is not guessed ahead
// of it). Ties fall back to the score, then the ticker, so the order is stable.

/** The row's filing timestamp in ms, or null when only a date is known. */
export function filingTimeMs(r: any): number | null {
  for (const k of ['filing_time_iso', 'filing_iso', 'filing_dt_iso', 'filed_at', 'acceptance_datetime', 'accepted_at']) {
    const v = r?.[k];
    if (typeof v === 'string' && /\d{2}:\d{2}/.test(v)) {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}
/** The date the row belongs to: its window date, else its filing date. */
export function filingDateOf(r: any): string {
  return String(r?._window_date || r?.filing_date || r?.filed || '').slice(0, 10);
}
/** Newest date first; within a date, timed rows newest first, untimed last. */
export function freshestFirst(a: any, b: any): number {
  const da = filingDateOf(a), db = filingDateOf(b);
  if (da !== db) return da < db ? 1 : -1;
  const ta = filingTimeMs(a), tb = filingTimeMs(b);
  if (ta !== null && tb !== null && ta !== tb) return tb - ta;
  if ((ta === null) !== (tb === null)) return ta === null ? 1 : -1;
  const s = Number(b?.composite_score ?? 0) - Number(a?.composite_score ?? 0);
  if (s !== 0) return s;
  return String(a?.ticker || '').localeCompare(String(b?.ticker || ''));
}
