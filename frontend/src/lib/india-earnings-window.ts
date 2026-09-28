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

import { withHonestQuarter, growthView, prepareDisplayRow, decodeEntities } from './india-eo-card-data';

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
  /** zzz817 — companies that filed that day but did not become a card, with
   *  the grader's reason (the payload's `_dropped`). */
  dropped?: ReadonlyArray<{ ticker: string; reason?: string; company?: string }> | null;
  /** zzz817 — the day was built while the results hub was down (the payload's
   *  `_hub_fail`): a partial list, not the whole day. */
  hub_fail?: string | null;
  /** zzz820 — when the day was last graded (the payload's generated_at), so a
   *  "not on Screener yet" reason can say when it was last checked. */
  checked_at?: string | null;
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
  /** zzz817 — the other results for this company in the window, with their
   *  tier (older ones), so the card can say "also 13 Aug · STRONG". */
  _earlier?: Array<{ date: string; tier: string }>;
  /** zzz817 — NEWER results for this company that are not the one shown,
   *  and why: hidden by the active filters, or filed without financial data
   *  (so an older graded result is shown instead of the company vanishing). */
  _newer?: Array<{ date: string; tier: string; why: 'filtered' | 'no-data' }>;
};

/** zzz817 — one graded result in the window, before the per-company dedupe. */
export type WindowEntry<R extends WindowRowBase = WindowRowBase> = R & {
  _window_date: string;
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
  return dedupeWindowEntries(windowEntries(days).entries);
}

// ─── zzz817 — entries, error rows, filter-aware dedupe ─────────────────────
//
// The owner: "some companies missing". The old merge picked each company's
// latest result FIRST and applied the page's filters AFTER, so a company whose
// newest entry failed a filter (a re-filing with no market cap, say) vanished
// even though an older result in the window passed. It also dropped, without
// a word, any row with no ticker, any row under a tier name it did not know
// (older engines), and every company the grader could not grade that day
// (the payload's `_dropped` list was never read).
//
// Now: every graded result is an ENTRY; the page's filters run on entries;
// the dedupe runs on what passes; a result filed without financial data never
// hides an older graded one; and everything that could not be shown is
// COUNTED (windowIssues) instead of disappearing.

/** A tier name as stored, or null when it is not one of the four. Older
 *  payloads may carry lower-case names. */
export function normTier(t: any): WindowTier | null {
  const s = String(t ?? '').trim().toUpperCase();
  return (WINDOW_TIER_ORDER as readonly string[]).includes(s) ? (s as WindowTier) : null;
}

/** True when the grader had no financial numbers at all for the row (a
 *  "preview" card: filed, but Screener/NSE returned nothing yet). The card is
 *  still shown — it is counted, and never preferred over a graded result. */
export function hasNoFinancialData(r: any): boolean {
  const keys = ['sales_yoy_pct', 'net_profit_yoy_pct', 'pat_yoy_pct', 'eps_yoy_pct', 'sales_curr_cr', 'pat_curr_cr', 'eps_curr'];
  if (keys.some((k) => typeof r?.[k] === 'number' && Number.isFinite(r[k]))) return false;
  const qs = r?.quarters_sales;
  if (Array.isArray(qs) && qs.some((x: any) => typeof x === 'number')) return false;
  return true;
}
/** True when the card has no share price (the price feed missed it). */
export function hasNoPrice(r: any): boolean {
  return !(typeof r?.price === 'number' && r.price > 0) && !(typeof r?.current_price === 'number' && r.current_price > 0);
}

export interface WindowBadRow { date: string; ticker: string; company?: string; reason: string }

/**
 * Every graded result of every loaded day, stamped with its date. Rows that
 * cannot be shown as a card (no ticker, a tier that is not one of the four)
 * come back in `bad` with the reason — counted, never silently skipped. A row
 * with `symbol` but no `ticker` (older payloads) is repaired, not dropped.
 */
export function windowEntries<R extends WindowRowBase>(days: ReadonlyArray<WindowDay<R>>): { entries: WindowEntry<R>[]; bad: WindowBadRow[] } {
  const entries: WindowEntry<R>[] = [];
  const bad: WindowBadRow[] = [];
  for (const day of days) {
    if (!day || !day.by_tier) continue;
    for (const [key, list] of Object.entries(day.by_tier)) {
      if (!Array.isArray(list)) continue;
      for (const raw of list as any[]) {
        if (!raw || typeof raw !== 'object') continue;
        const ticker = String(raw.ticker || raw.symbol || '').trim();
        const tier = normTier(raw.tier) || normTier(key);
        if (!ticker) { bad.push({ date: day.date, ticker: '?', company: raw.company, reason: 'row has no ticker' }); continue; }
        if (!tier) { bad.push({ date: day.date, ticker, company: raw.company, reason: `unrecognised tier "${String(raw.tier ?? key)}"` }); continue; }
        // zzz820 — an impossible stored quarter label (a quarter that had not
        // ended on the filing date) is replaced by the one the date implies.
        // zzz820b — a top tier built on unverified growth is held (see holdUnconfirmed).
        // zzz822 — …and every text field decoded (no "&amp;" on screen).
        entries.push(prepareDisplayRow({
          ...withHonestQuarter({ ...raw, _window_date: day.date }), ticker, tier,
          _window_date: day.date,
          _engine_stale: !!day.engine_stale,
          _engine: day.engine ?? null,
        }) as WindowEntry<R>);
      }
    }
  }
  return { entries, bad };
}

/**
 * ONE row per company among the entries that pass `pass` (the page's filters —
 * but NOT the tier filter, see below). The rule:
 *   1. a result WITH financial data beats one without (a re-filing that has
 *      not been parsed yet never hides the graded quarter);
 *   2. then the LATEST date wins;
 *   3. same date: NSE ticker over BSE code, better tier, higher score.
 * Newer results that lost (filtered out, or no data) are listed in `_newer`;
 * older ones in `_also_reported` / `_earlier`.
 *
 * The tier filter is applied to the result of this, not inside it: the tier
 * a company is listed under is the tier of its latest result, so the tier
 * chips add up to the total and a chip's count is exactly what it shows.
 */
export function dedupeWindowEntries<R extends WindowRowBase>(
  entries: ReadonlyArray<WindowEntry<R>>,
  pass?: (r: WindowEntry<R>) => boolean,
): WindowRow<R>[] {
  const groups = new Map<string, WindowEntry<R>[]>();
  for (const e of entries) {
    const key = companyKey(e);
    if (!key) continue;
    (groups.get(key) || groups.set(key, []).get(key)!).push(e);
  }
  const out: WindowRow<R>[] = [];
  for (const list of groups.values()) {
    const ok = pass ? list.filter(pass) : list;
    if (ok.length === 0) continue;
    let best = ok[0];
    for (const e of ok.slice(1)) {
      const eNo = hasNoFinancialData(e), bNo = hasNoFinancialData(best);
      if (eNo !== bNo) { if (!eNo) best = e; continue; }
      if (e._window_date !== best._window_date) { if (e._window_date > best._window_date) best = e; continue; }
      if (betterSameDay(e, best)) best = e;
    }
    const olderMap = new Map<string, string>();
    const newerMap = new Map<string, { date: string; tier: string; why: 'filtered' | 'no-data' }>();
    for (const e of list) {
      if (e._window_date < best._window_date) {
        if (!olderMap.has(e._window_date)) olderMap.set(e._window_date, String(e.tier));
      } else if (e._window_date > best._window_date && !newerMap.has(e._window_date)) {
        newerMap.set(e._window_date, { date: e._window_date, tier: String(e.tier), why: pass && !pass(e) ? 'filtered' : 'no-data' });
      }
    }
    const older = [...olderMap.keys()].sort().reverse();
    out.push({
      ...best,
      _also_reported: older,
      _earlier: older.map((d) => ({ date: d, tier: olderMap.get(d)! })),
      _newer: [...newerMap.values()].sort((a, b) => (a.date < b.date ? 1 : -1)),
    } as WindowRow<R>);
  }
  return out;
}

// ─── zzz817 — the tier filter (?tier=BLOCKBUSTER,STRONG) ───────────────────

export const TIER_PARAM = 'tier';

/** ?tier= → the selected tiers, valid and in the fixed order (empty = all). */
export function parseTierParam(raw: string | null | undefined): WindowTier[] {
  const want = new Set(String(raw ?? '').split(',').map(normTier).filter(Boolean) as WindowTier[]);
  const sel = WINDOW_TIER_ORDER.filter((t) => want.has(t));
  return sel.length === WINDOW_TIER_ORDER.length ? [] : sel;
}
/** The href with ?tier= set (or removed for "all"), everything else untouched. */
export function withTierParam(href: string, tiers: readonly string[]): string {
  const u = new URL(href, 'http://x');
  const sel = parseTierParam(tiers.join(','));
  if (sel.length) u.searchParams.set(TIER_PARAM, sel.join(',')); else u.searchParams.delete(TIER_PARAM);
  const qs = u.searchParams.toString().replace(/%2C/gi, ',');
  return u.pathname + (qs ? '?' + qs : '') + u.hash;
}
/** Click on a tier chip: add or remove it (multi-select). Selecting all four = all. */
export function toggleTier(sel: readonly WindowTier[], t: WindowTier): WindowTier[] {
  const s = new Set(sel);
  if (s.has(t)) s.delete(t); else s.add(t);
  return parseTierParam([...s].join(','));
}
/** Does a row pass the tier selection? (empty selection = every tier) */
export function passesTier(r: { tier: any }, sel: readonly string[]): boolean {
  return sel.length === 0 || sel.includes(String(r.tier));
}
/** Count per tier — call it with the rows that pass every OTHER filter, so the
 *  chips always show what clicking them would show. */
export function countByTier(rows: ReadonlyArray<{ tier: any }>): Record<WindowTier, number> {
  const out: Record<WindowTier, number> = { BLOCKBUSTER: 0, STRONG: 0, MIXED: 0, AVOID: 0 };
  for (const r of rows) { const t = normTier(r.tier); if (t) out[t]++; }
  return out;
}

// ─── zzz817 — per-day groups with their own MIXED / AVOID expander ─────────

export interface DayGroupView<R> {
  date: string;
  /** every row of that day that passes the filters (tier order within) */
  rows: R[];
  /** what is on screen now */
  visible: R[];
  /** folded behind this day's own "show N MIXED · N AVOID" expander */
  folded: { MIXED: number; AVOID: number };
  counts: Record<WindowTier, number>;
}
/**
 * The By-date groups. With no tier filter and no other filter, each day shows
 * BLOCKBUSTER and STRONG and folds MIXED and AVOID behind ITS OWN expander
 * (openDays). A tier filter, or any other filter, shows everything it selects.
 * `keep` forces a row visible (the searched-for card).
 */
export function dayGroups<R extends WindowRow<WindowRowBase>>(
  rows: ReadonlyArray<R>,
  opts: { openDays?: ReadonlySet<string>; showAll?: boolean; within?: Cmp<R>; keep?: (r: R) => boolean } = {},
): DayGroupView<R>[] {
  return sortByDate(rows, opts.within).map((g) => {
    const open = !!opts.showAll || !!opts.openDays?.has(g.date);
    const folded = { MIXED: 0, AVOID: 0 };
    const visible: R[] = [];
    for (const r of g.rows) {
      const t = String(r.tier);
      if (!open && (t === 'MIXED' || t === 'AVOID') && !(opts.keep && opts.keep(r))) folded[t]++;
      else visible.push(r);
    }
    return { date: g.date, rows: g.rows, visible, folded, counts: countByTier(g.rows) };
  });
}

// ─── zzz817 — what could not be shown, and the header arithmetic ───────────

export interface WindowIssues {
  /** filed, but the grader could not grade them (payload `_dropped`), minus
   *  companies graded on another date in the window (those are on screen) */
  notGraded: Array<{ date: string; ticker: string; reason: string; checked?: string | null; unconfirmed?: boolean }>;
  /** rows that could not be read as a card (no ticker, unknown tier) */
  badRows: WindowBadRow[];
  /** companies shown whose result has no financial numbers yet */
  noData: Array<{ date: string; ticker: string }>;
  /** companies shown without a share price */
  noPrice: number;
  /** days built while the results hub was down — partial lists */
  partialDays: string[];
  /** notGraded + badRows + noData by short reason, for the one-line summary */
  byReason: Record<string, number>;
  byDate: Record<string, number>;
  total: number;
}

/** The grader's long drop reasons, as a few plain words. */
export function shortDropReason(reason: string | undefined | null): string {
  const s = String(reason || '').toLowerCase();
  if (/ghost/.test(s)) return 'no confirmed filing';
  // zzz820 — a scheduled board meeting with no confirmed filing is not a
  // company that "filed but couldn't be graded".
  if (/scheduled|upcoming/.test(s)) return 'board meeting only — filing not confirmed';
  // zzz820 — "Screener's latest quarter 2016-03-31 is 3788d before the filing"
  // is not "not on Screener YET": the Screener page itself is years stale
  // (typically the consolidated page of a company that stopped consolidating).
  const lag = s.match(/is\s+(\d+)d\s+before the filing/);
  if (lag && +lag[1] > 200) return 'Screener page years out of date';
  if (/quarter .* before the filing|not on screener|stale/.test(s)) return 'new quarter not on Screener yet';
  if (/no financial|no data|missing/.test(s)) return 'no financial data';
  if (/price|quote/.test(s)) return 'no price';
  if (/timeout|fetch|failed|http|error/.test(s)) return 'fetch failed';
  return s ? 'could not grade' : 'unknown reason';
}

/** zzz820 — reasons that mean "no results filing confirmed yet", as opposed to
 *  "filed, but the grader could not read the numbers". */
export function isUnconfirmedDrop(shortReason: string): boolean {
  return shortReason === 'board meeting only — filing not confirmed' || shortReason === 'no confirmed filing';
}

/** zzz820 — "new quarter not on Screener yet — last checked 27 Sep". */
export function dropReasonWithCheck(shortReason: string, checkedAt?: string | null): string {
  const d = String(checkedAt || '').slice(0, 10);
  if (!ISO_RE.test(d)) return shortReason;
  return `${shortReason} — last checked ${fmtShortDate(d)}`;
}

export function windowIssues<R extends WindowRowBase>(
  days: ReadonlyArray<WindowDay<R>>,
  entries: ReadonlyArray<WindowEntry<R>>,
  bad: ReadonlyArray<WindowBadRow>,
  shown: ReadonlyArray<WindowRow<R>>,
): WindowIssues {
  const gradedTickers = new Set<string>();
  const gradedKeys = new Set<string>();
  for (const e of entries) { gradedTickers.add(String(e.ticker).toUpperCase()); gradedKeys.add(companyKey(e)); }
  const notGraded: WindowIssues['notGraded'] = [];
  const seenDrop = new Set<string>();
  const partialDays: string[] = [];
  for (const d of days) {
    if (!d) continue;
    if (d.hub_fail) partialDays.push(d.date);
    for (const x of d.dropped || []) {
      const t = String(x?.ticker || '').trim().toUpperCase();
      if (!t || gradedTickers.has(t) || (x.company && gradedKeys.has(companyKey({ ticker: t, company: x.company })))) continue;
      if (seenDrop.has(t)) continue;            // one company, counted once
      seenDrop.add(t);
      const reason = shortDropReason(x.reason);
      notGraded.push({ date: d.date, ticker: t, reason, checked: d.checked_at ?? null, unconfirmed: isUnconfirmedDrop(reason) });
    }
  }
  const noData = shown.filter(hasNoFinancialData).map((r) => ({ date: r._window_date, ticker: r.ticker }));
  const noPrice = shown.filter(hasNoPrice).length;
  const byReason: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  const add = (reason: string, date: string) => { byReason[reason] = (byReason[reason] || 0) + 1; byDate[date] = (byDate[date] || 0) + 1; };
  for (const x of notGraded) add(x.reason, x.date);
  for (const x of bad) add(x.reason.startsWith('unrecognised') ? 'unrecognised tier' : x.reason, x.date);
  for (const x of noData) add('no financial data yet', x.date);
  return { notGraded, badRows: [...bad], noData, noPrice, partialDays: partialDays.sort().reverse(), byReason, byDate, total: notGraded.length + bad.length + noData.length };
}

export interface WindowTotals {
  /** graded results read, summed over the loaded days */
  results: number;
  daysLoaded: number;
  /** one per company */
  companies: number;
  /** companies with results on 2+ dates (latest shown) */
  repeated: number;
  /** extra rows for the same company on the same date (NSE + BSE) */
  sameDayDupes: number;
  line: string;
}
const fmtN = (n: number) => n.toLocaleString('en-IN');
/** The plain arithmetic behind the header: results − repeats = companies. */
export function windowTotals<R extends WindowRowBase>(
  days: ReadonlyArray<WindowDay<R>>,
  entries: ReadonlyArray<WindowEntry<R>>,
  companies: ReadonlyArray<WindowRow<R>>,
): WindowTotals {
  const daysLoaded = days.filter((d) => d && d.by_tier).length;
  const perKeyDates = new Map<string, Set<string>>();
  let sameDayDupes = 0;
  const perKeyDay = new Set<string>();
  for (const e of entries) {
    const k = companyKey(e);
    const kd = k + '@' + e._window_date;
    if (perKeyDay.has(kd)) sameDayDupes++; else perKeyDay.add(kd);
    (perKeyDates.get(k) || perKeyDates.set(k, new Set()).get(k)!).add(e._window_date);
  }
  let repeated = 0;
  for (const s of perKeyDates.values()) if (s.size > 1) repeated++;
  const results = entries.length;
  const n = companies.length;
  const extra = results - n;
  const bits: string[] = [];
  if (repeated > 0) bits.push(`${fmtN(repeated)} reported on more than one date — latest shown`);
  if (sameDayDupes > 0) bits.push(`${fmtN(sameDayDupes)} NSE/BSE duplicate${sameDayDupes === 1 ? '' : 's'} merged`);
  const line = extra > 0
    ? `${fmtN(results)} results across ${daysLoaded} day${daysLoaded === 1 ? '' : 's'} = ${fmtN(n)} companies (${bits.join('; ')})`
    : `${fmtN(results)} results across ${daysLoaded} day${daysLoaded === 1 ? '' : 's'} = ${fmtN(n)} companies (no company reported twice)`;
  return { results, daysLoaded, companies: n, repeated, sameDayDupes, line };
}

/** Per date: how many companies filed that day but are listed under ANOTHER
 *  date — usually a later one (their newest result), or an earlier one when
 *  the newer filing had no numbers / failed a filter. Read from the rows'
 *  `_also_reported` and `_newer`, so per-day counts + this = results read. */
export function shownElsewhereByDate(rows: ReadonlyArray<{ _also_reported?: string[]; _newer?: Array<{ date: string }> }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const d of r._also_reported || []) out[d] = (out[d] || 0) + 1;
    for (const n of r._newer || []) out[n.date] = (out[n.date] || 0) + 1;
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
  // zzz820b — no 0–100 score columns (owner rule: no scores shown).
  'Date', 'Tier', 'Ticker', 'Company', 'Quarter', 'Quadrant',
  'Sales_YoY', 'PAT_YoY', 'EPS_YoY', 'Market_Cap_Cr', 'Also_Reported', 'Graded_Under', 'Source',
];

/** CSV of the rows exactly as passed (the caller passes what is on screen). */
export function windowCsv(rows: ReadonlyArray<any>, dateOf: (r: any) => string = (r) => r._window_date || r.filing_date || ''): string {
  const lines = [WINDOW_CSV_HEADER.join(',')];
  for (const c of rows) {
    lines.push([
      dateOf(c), c._tier_unconfirmed ? `UNCONFIRMED (stored ${c._tier_unconfirmed})` : c.tier, c.ticker, decodeEntities(String(c.company ?? '')), c.quarter, c.quadrant ?? '',
      // zzz820 — the same honest growth the card shows (withheld when the
      // year-ago quarter could not be matched).
      numCell(growthView(c).sales), numCell(growthView(c).pat), numCell(growthView(c).eps), numCell(c.market_cap_cr),
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

// ─── zzz818 — the one-click "BLOCKBUSTER + STRONG" chip (India + US) ───────
//
// The owner: "add one filter blockbuster+strong … and make it work". It is
// exactly the multi-select of those two tiers — same state, same URL
// (?tier=BLOCKBUSTER,STRONG) — so the two ways of picking them never disagree.

export const TOP_TIERS: readonly WindowTier[] = ['BLOCKBUSTER', 'STRONG'];

/** True when the selection is exactly BLOCKBUSTER + STRONG. */
export function isTopTiersSel(sel: readonly string[]): boolean {
  const s = parseTierParam(sel.join(','));
  return s.length === 2 && s[0] === 'BLOCKBUSTER' && s[1] === 'STRONG';
}
/** Click on the combined chip: select exactly both; click again clears. */
export function toggleTopTiers(sel: readonly string[]): WindowTier[] {
  return isTopTiersSel(sel) ? [] : [...TOP_TIERS];
}
/** Its count: the sum of the two tiers under every other active filter. */
export function topTiersCount(counts: Partial<Record<string, number>>): number {
  return (counts.BLOCKBUSTER || 0) + (counts.STRONG || 0);
}
/** The plain empty-state line when a tier filter leaves nothing to show. */
export function tierEmptyMessage(sel: readonly string[], scope: 'window' | 'date' = 'window'): string {
  const s = parseTierParam(sel.join(','));
  if (s.length === 0) return scope === 'window' ? 'No results in this window — widen the window or clear a filter' : 'No results on this date — pick another date or clear a filter';
  const names = s.length === 1 ? s[0] : `${s.slice(0, -1).join(', ')} or ${s[s.length - 1]}`;
  return scope === 'window'
    ? `No ${names} results in this window — widen the window or clear a filter`
    : `No ${names} results on this date — widen the window or clear a filter`;
}
