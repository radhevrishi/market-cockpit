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

export interface ScreenerGainer {
  ticker: string;
  company: string;
  movePct: number | null;
  volume: number | null;
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
  /** Null when the fetch failed; otherwise when this data was read. */
  fetchedAt: string | null;
  pages: number;
  totalReported: number | null;
  url: string;
  /** Populated only on failure or partial failure. Never silently empty. */
  error: string | null;
}

/** The owner's screen. A public screener.in screen needs no session cookie. */
export const INDIA_GAINERS_URL = 'https://www.screener.in/screens/3725746/suresh-daily-gainers/';

const MAX_PAGES = 6;             // 25 rows a page; his screen runs ~122 names
const PAGE_TIMEOUT_MS = 12_000;

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
    const ticker = link ? link[1].toUpperCase() : '';
    if (!ticker) continue;
    const at = (i: number) => (i >= 0 && i < cells.length ? decode(stripTags(cells[i])) : '');
    rows.push({
      ticker,
      company: at(iCompany) || ticker,
      movePct: num(at(iMove)),
      volume: num(at(iVol)),
      pe: num(at(iPe)),
      marketCapCr: num(at(iMcap)),
      profitVarPct: num(at(iProfitVar)),
      salesVarPct: num(at(iSalesVar)),
      roce: num(at(iRoce)),
    });
  }

  const totalM = /([\d,]+)\s*results/i.exec(html);
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

    const parsed = parsePage(html);
    if (parsed.error && !parsed.rows.length) {
      if (!firstError) firstError = `page ${p}: ${parsed.error}`;
      break;
    }
    if (parsed.total != null) total = parsed.total;
    pages = p;
    let added = 0;
    for (const row of parsed.rows) {
      if (seen.has(row.ticker)) continue;
      seen.add(row.ticker);
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
    fetchedAt: out.length ? new Date().toISOString() : null,
    pages,
    totalReported: total,
    url: INDIA_GAINERS_URL,
    error: out.length ? (firstError ? `partial read — ${firstError}` : null) : (firstError || 'no rows parsed'),
  };
}
