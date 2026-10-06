// ═══════════════════════════════════════════════════════════════════════════
// INDIA DAILY GAINERS — THE OWNER'S OWN SCREEN, READ LIVE.          (zzz722)
//
// Until now the India side of AI Daily Gainers had no gainers list at all. It
// ranked the day's filed results and said so, which was honest and nearly
// useless: the eight names on screen were filings from sixteen to thirty-eight
// days ago with day-one reactions of −2.9% and +0.2%, presented on a page
// called "gainers". The owner supplied the missing input — his public
// screener.in screen — and this reads it.
//
// WHY LIVE RATHER THAN A COMMITTED CSV. Every other screener.in screen in this
// repo arrives through the nightly sync workflow, which is right for a
// fundamental screen that changes once a day. A DAILY GAINERS screen is
// different: its whole content is today's move, so a copy synced at 2am is a
// list of yesterday's gainers wearing today's date. That is exactly the class
// of silently-stale answer this pipeline has already shipped three times, so
// the screen is fetched at request time and the response states when.
//
// THE COLUMN IS FOUND BY ITS HEADER, NOT ITS POSITION. The US side of this
// same pipeline shipped with every gainer reading exactly 0% because the CSV
// key was guessed ("Performance % 1 week" instead of "Performance %, 1 week").
// The owner can add or reorder a column on his screen at any time, so the
// "1day return" column is located by matching the header text, and when no
// such column exists the reader FAILS LOUDLY instead of returning a list of
// companies with no moves attached.
//
// A FAILURE IS REPORTED, NEVER SWALLOWED. Every function here returns its
// error text rather than an empty array, because the page must be able to
// tell "screener.in did not answer" from "nothing gained today" — and on this
// pipeline specifically, an empty list that looked like an answer has been
// the single most repeated bug.
// ═══════════════════════════════════════════════════════════════════════════

import { fetchScreenerHtml, screenerProxyConfigured } from '@/lib/earnings/screener-fetch';
import { isNseHolidayDate } from '@/lib/market-hours';

export interface ScreenerGainer {
  ticker: string;
  company: string;
  movePct: number | null;
  /** The screen's "Avg Vol 1Wk" column — a one-week AVERAGE daily volume,
   *  not the session's volume. Anything derived from it is labelled so. */
  volume: number | null;
  /** Current market price from the screen's CMP column (₹). */
  price?: number | null;
  /** screener.in's internal company id — the dedup key. The same company can
   *  appear under its NSE symbol and its BSE code. */
  companyId?: string | null;
  pe: number | null;
  marketCapCr: number | null;
  profitVarPct: number | null;
  salesVarPct: number | null;
  roce: number | null;
}

export interface ScreenerGainersResult {
  rows: ScreenerGainer[];
  /** Whether a reachable proxy is configured — so the page can say whether it
   *  is one environment variable away from working. */
  proxyConfigured?: boolean;
  /** Null when the fetch failed; otherwise WHEN THE SCREEN WAS READ FROM
   *  screener.in — the proxy's cache age is subtracted, so an hour-old
   *  cached page is never stamped as read "now". (zzz766) */
  fetchedAt: string | null;
  /** Age of the proxy-cached page in ms, when the proxy served from cache. */
  proxyCacheAgeMs?: number | null;
  pages: number;
  totalReported: number | null;
  url: string;
  /** Populated only on failure or partial failure. Never silently empty. */
  error: string | null;
}

/** The owner's screen. A public screener.in screen needs no session cookie. */
export const INDIA_GAINERS_URL = 'https://www.screener.in/screens/3725746/suresh-daily-gainers/';

const MAX_PAGES = 6;             // 25 rows a page; his screen runs ~122 names
// zzz734 — 12s was too tight once the chain grew to three hops: the first
// (misconfigured) hop burns time before the working one is even tried, and a
// Worker cold start costs a second or two of that budget.
const PAGE_TIMEOUT_MS = 20_000;

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const num = (s: string): number | null => {
  const t = s.replace(/[%,\s]/g, '');
  if (!t || t === '-') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** Match a header by meaning, not by index. */
function findCol(headers: string[], re: RegExp): number {
  return headers.findIndex((h) => re.test(h));
}

/** Pure: HTML in, rows out. Exported so it can be tested against a captured
 *  page without touching the network — the parse is where the bugs live
 *  (the US side once read every move as 0% from a guessed column key). */
export function parsePage(html: string): { rows: ScreenerGainer[]; total: number | null; error: string | null } {
  const tStart = html.indexOf('<table');
  if (tStart < 0) return { rows: [], total: null, error: 'no results table in the page' };
  const table = html.slice(tStart, html.indexOf('</table>', tStart) + 8);

  const headers = Array.from(table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g))
    .map((m) => decode(stripTags(m[1])));
  if (!headers.length) return { rows: [], total: null, error: 'no header row' };

  const iCompany = findCol(headers, /^company/i);
  // The owner's column is literally "1day return %". Matched loosely so a
  // rename to "1 day return" or "Day return" still resolves.
  const iMove = findCol(headers, /1\s*-?\s*day\s*return|day\s*return|1d\s*return/i);
  const iPrice = findCol(headers, /^cmp|current\s*price/i);
  const iVol = findCol(headers, /avg\s*vol/i);
  const iPe = findCol(headers, /^p\s*\/\s*e/i);
  const iMcap = findCol(headers, /mar\s*cap/i);
  const iProfitVar = findCol(headers, /qtr\s*profit\s*var/i);
  const iSalesVar = findCol(headers, /qtr\s*sales\s*var/i);
  const iRoce = findCol(headers, /^roce/i);

  if (iMove < 0) {
    // FAIL LOUDLY. A gainers list with no move column is a list of companies,
    // and returning it as gainers is how every row ended up reading 0% on the
    // US side of this same pipeline.
    return {
      rows: [], total: null,
      error: `the screen has no "1day return" column (headers found: ${headers.slice(0, 14).join(', ')})`,
    };
  }

  const rows: ScreenerGainer[] = [];
  for (const m of table.matchAll(/<tr[^>]*data-row-company-id[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tr = m[1];
    const cells = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (!cells.length) continue;
    // The NSE symbol lives in the company link, not in the visible text —
    // the visible text is a truncated display name ("Sr.Rayala.Hypo").
    const link = /href="\/company\/([^/"?]+)/.exec(tr);
    const cid = /data-row-company-id="(\d+)"/.exec(m[0])?.[1] ?? null;
    const ticker = link ? link[1].toUpperCase() : '';
    if (!ticker) continue;
    const at = (i: number) => (i >= 0 && i < cells.length ? decode(stripTags(cells[i])) : '');
    rows.push({
      ticker,
      company: at(iCompany) || ticker,
      movePct: num(at(iMove)),
      volume: num(at(iVol)),
      price: num(at(iPrice)),
      companyId: cid,
      pe: num(at(iPe)),
      marketCapCr: num(at(iMcap)),
      profitVarPct: num(at(iProfitVar)),
      salesVarPct: num(at(iSalesVar)),
      roce: num(at(iRoce)),
    });
  }

  // "98 results" — anchored to a tag boundary so a phrase like "Q1 2026
  // results" in a company name or note cannot be read as the row count.
  const totalM = />\s*([\d,]+)\s*results\b/i.exec(html) || /([\d,]+)\s*results/i.exec(html);
  const total = totalM ? num(totalM[1]) : null;
  return { rows, total, error: rows.length ? null : 'the results table had no company rows' };
}

/**
 * Read the screen, all pages. Pages are fetched in sequence rather than in
 * parallel: this is someone else's free service and a public screen, and
 * firing six simultaneous requests at it to save two seconds is not a trade
 * worth making.
 */
export async function fetchIndiaGainers(limitPages = MAX_PAGES): Promise<ScreenerGainersResult> {
  const out: ScreenerGainer[] = [];
  const seen = new Set<string>();
  let oldestAgeMs: number | null = null;
  let total: number | null = null;
  let pages = 0;
  let firstError: string | null = null;

  for (let p = 1; p <= Math.max(1, Math.min(MAX_PAGES, limitPages)); p++) {
    const url = p === 1 ? INDIA_GAINERS_URL : `${INDIA_GAINERS_URL}?page=${p}`;
    // zzz729 — through the proxy chain. A direct fetch from a datacenter IP
    // is refused by screener.in, which is why this shipped reading 0 rows in
    // production while working perfectly from a laptop.
    const got = await fetchScreenerHtml(url, PAGE_TIMEOUT_MS);
    if (!got.html) {
      if (!firstError) firstError = `page ${p}: ${got.error}`;
      break;
    }
    const html = got.html;
    if (typeof got.ageMs === 'number') oldestAgeMs = Math.max(oldestAgeMs ?? 0, got.ageMs);

    const parsed = parsePage(html);
    if (parsed.error && !parsed.rows.length) {
      if (!firstError) firstError = `page ${p}: ${parsed.error}`;
      break;
    }
    if (parsed.total != null) total = parsed.total;
    pages = p;
    let added = 0;
    for (const row of parsed.rows) {
      const k = row.companyId ? `id:${row.companyId}` : `t:${row.ticker}`;
      if (seen.has(k) || seen.has(`t:${row.ticker}`)) continue;
      seen.add(k); seen.add(`t:${row.ticker}`);
      out.push(row);
      added++;
    }
    // A page that adds nothing new means we have run past the end.
    if (!added) break;
    if (total != null && out.length >= total) break;
  }

  return {
    rows: out,
    proxyConfigured: screenerProxyConfigured(),
    fetchedAt: out.length ? new Date(Date.now() - (oldestAgeMs ?? 0)).toISOString() : null,
    proxyCacheAgeMs: oldestAgeMs,
    pages,
    totalReported: total,
    url: INDIA_GAINERS_URL,
    error: out.length ? (firstError ? `partial read — ${firstError}` : null) : (firstError || 'no rows parsed'),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WHICH SESSION THE SCREEN DESCRIBES.                               (zzz766)
//
// A "1day return" column always describes the LAST session that traded. Read
// at 01:47 IST on a Wednesday it is Tuesday's move; read on a Saturday it is
// Friday's; read on an exchange holiday it is the day before. The research
// store was keyed by the IST calendar date, so a sweep that ran after
// midnight filed Tuesday's gainers under Wednesday — and Wednesday's real
// gainers were then merged into the same day, keeping Tuesday's moves for
// every name that appeared on both boards. The key is the SESSION, not the
// calendar.
// ═══════════════════════════════════════════════════════════════════════════

export interface IndiaSession {
  /** The trading date the screen's 1-day return belongs to, YYYY-MM-DD (IST). */
  date: string;
  /** open = in session now; pre_open = today before 09:15 (last session shown);
   *  closed = today after 15:30; weekend / holiday = no session today. */
  state: 'open' | 'pre_open' | 'closed' | 'weekend' | 'holiday';
  /** True when the move is today's (in progress or just closed). */
  isToday: boolean;
  label: string;
}

const IST_MS = 5.5 * 3600_000;
const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const isTradingDate = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !isNseHolidayDate(ymd(d));

export function indiaSession(now: Date = new Date()): IndiaSession {
  const ist = new Date(now.getTime() + IST_MS);            // wall-clock IST in the UTC fields
  const today = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const dow = today.getUTCDay();
  let state: IndiaSession['state'];
  if (dow === 0 || dow === 6) state = 'weekend';
  else if (isNseHolidayDate(ymd(today))) state = 'holiday';
  else if (mins < 9 * 60 + 15) state = 'pre_open';
  else if (mins <= 15 * 60 + 30) state = 'open';
  else state = 'closed';
  const d = new Date(today);
  if (state === 'weekend' || state === 'holiday' || state === 'pre_open') {
    do { d.setUTCDate(d.getUTCDate() - 1); } while (!isTradingDate(d));
  }
  const date = ymd(d);
  const nice = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const label = state === 'open' ? `${nice} — session in progress (moves are intraday)`
    : state === 'closed' ? `${nice} — today's closed session`
      : `${nice} — last completed session (${state === 'pre_open' ? 'market not open yet today' : state === 'weekend' ? 'weekend' : 'exchange holiday today'})`;
  return { date, state, isToday: state === 'open' || state === 'closed', label };
}

// ═══════════════════════════════════════════════════════════════════════════
// SMALL AND MID CAPS ONLY.                                           (zzz766)
//
// The owner's brief is small/mid caps. His screen filters market cap > ₹500 Cr
// with no upper bound, so a ₹1.1 lakh Cr name (MEESHO, 22 Sep 2026) sat on
// the board next to ₹700 Cr names and was researched like one. SEBI/AMFI
// define large caps as the top 100 by full market cap; the 100th name sits
// near ₹1,00,000 Cr, so that is the line. A name whose cap is unknown is
// KEPT and flagged — dropping it would hide a gainer for a missing field.
// ═══════════════════════════════════════════════════════════════════════════
export const LARGE_CAP_MIN_CR = 100_000;

export function isLargeCap(marketCapCr: number | null | undefined): boolean {
  return typeof marketCapCr === 'number' && Number.isFinite(marketCapCr) && marketCapCr >= LARGE_CAP_MIN_CR;
}

export function partitionByCap<T extends { marketCapCr?: number | null }>(rows: T[]): { kept: T[]; largeCaps: T[] } {
  const kept: T[] = [], largeCaps: T[] = [];
  for (const r of rows) (isLargeCap(r.marketCapCr) ? largeCaps : kept).push(r);
  return { kept, largeCaps };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA SCAN-CRITERIA LINE.                                       (zzz835)
// The US page states the filters its list was read with; India stated none.
// Only what the code actually knows is printed: which screen, which column is
// the move, how many rows, the large-cap cut-off, and the catalyst windows.
// The screen's OWN filters (market cap floor, volume …) live in the owner's
// screener.in account and are not readable here — the line says so.
// ═══════════════════════════════════════════════════════════════════════════
export function describeIndiaCriteria(o: { total?: number | null; read: number; largeCapsExcluded?: number; windowThisMove?: number; windowRecent?: number }): string {
  const rows = o.total != null && o.total !== o.read ? `${o.read} read of ${o.total} reported` : `${o.read} read`;
  const win = o.windowThisMove != null && o.windowRecent != null ? ` · catalyst window: filed ≤ ${o.windowThisMove} days = this move, ≤ ${o.windowRecent} days = recent, older = context` : '';
  return `your screener.in gainers screen (1-day return; the screen's own filters are set on screener.in and are not read here) · ${rows} · small/mid caps only: market cap ≥ ₹${LARGE_CAP_MIN_CR.toLocaleString('en-IN')} Cr excluded${o.largeCapsExcluded ? ` (${o.largeCapsExcluded} excluded)` : ''}${win}`;
}
