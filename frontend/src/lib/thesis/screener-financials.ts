// ═══════════════════════════════════════════════════════════════════════════
// SCREENER.IN FINANCIALS — the row for a name nobody else has a row for. (zzz764)
//
// 18 holdings sat at EVIDENCE INCOMPLETE and 68 bench names were excluded
// from the preset because the only screener data this portal carried was a
// static CSV snapshot that did not contain them. screener.in's own company
// page prints the quarterly results table, the annual P&L, the cash-flow
// statement and the ratio table for every listed company. This parses them.
//
// Every figure is COPIED from a table cell; the only arithmetic is the
// year-on-year change between two cells of one row (latest quarter against
// the same quarter a year earlier) and CFO over PAT for one year. A growth
// rate between a loss and anything is left null — the thesis engine reads
// the two PAT figures and says why it is not judging.
//
// It is also RICHER than the CSV it replaces for the same names: the CSV only
// carries this quarter's and last quarter's margin (a sequential move); the
// table carries the year-ago quarter, which is the margin bridge the engine
// actually wants, and it carries the profit figures themselves.
// ═══════════════════════════════════════════════════════════════════════════

import { fetchScreenerHtml } from '@/lib/earnings/screener-fetch';
import { screenerSymbol } from '@/lib/earnings/screener-documents';
import { parseTopRatios } from '@/lib/ai-gainers/screener-company';

type Table = { headers: string[]; rows: Record<string, (number | null)[]> };

const decode = (s: string) => s
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();

const cellNum = (s: string): number | null => {
  const t = s.replace(/,/g, '').replace(/%$/, '').trim();
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Pure: one `<section id="…">` table into headers + named rows. */
export function parseSection(html: string, id: string): Table | null {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return null;
  const j = html.indexOf('</section>', i);
  const sec = html.slice(i, j > i ? j : undefined);
  const trs = sec.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  if (!trs.length) return null;
  const cells = (tr: string) => (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) || []).map(decode);
  const head = cells(trs[0] || '');
  const headers = head.slice(1);
  const rows: Table['rows'] = {};
  for (const tr of trs.slice(1)) {
    const c = cells(tr);
    if (!c.length) continue;
    const label = (c[0] || "").replace(/\s*\+\s*$/, "").trim();
    if (!label) continue;
    rows[label] = c.slice(1).map(cellNum);
  }
  return { headers, rows };
}

const pick = (t: Table | null, ...labels: string[]): (number | null)[] | null => {
  if (!t) return null;
  for (const l of labels) {
    const k = Object.keys(t.rows).find((x) => x.toLowerCase() === l.toLowerCase());
    if (k) return t.rows[k];
  }
  return null;
};

const growth = (cur: number | null, prev: number | null): number | null => {
  if (cur == null || prev == null || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
};

export interface ScreenerFinancials {
  ticker: string;
  market: 'IN';
  source: 'screener-live';
  basis: 'consolidated' | 'standalone';
  period: string | null;              // latest quarter header, e.g. "Jun 2026"
  comparison_period: string | null;   // the quarter a year earlier
  sales_curr_cr: number | null;
  sales_prev_cr: number | null;
  sales_yoy_pct: number | null;
  pat_curr_cr: number | null;
  pat_prev_cr: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  opm_pct: number | null;
  opm_prev_pct: number | null;
  cfo_to_pat_ratio: number | null;
  cfo_year: string | null;
  roce_pct: number | null;
  market_cap_cr: number | null;
  pe: number | null;
  source_url: string;
}

/** Pure: a company page's HTML into a thesis-data row. Null when the page has
 *  no quarterly table (delisted, wrong symbol, a login wall). */
export function financialsFromHtml(ticker: string, html: string, basis: 'consolidated' | 'standalone', url: string): ScreenerFinancials | null {
  const q = parseSection(html, 'quarters');
  if (!q || q.headers.length < 2) return null;
  const sales = pick(q, 'Sales', 'Revenue', 'Revenue from Operations');
  const pat = pick(q, 'Net Profit', 'Profit after tax');
  const opm = pick(q, 'OPM %', 'OPM', 'Financing Margin %');
  const eps = pick(q, 'EPS in Rs', 'EPS');
  if (!sales && !pat) return null;
  // The last column is the latest quarter; the year-ago quarter is four back.
  // A "TTM" or blank trailing column is skipped.
  let L = q.headers.length - 1;
  while (L > 0 && !/\d{4}/.test(q.headers[L])) L--;
  const Y = L - 4;
  const at = (r: (number | null)[] | null, k: number) => (r && k >= 0 && k < r.length ? r[k] : null);

  // Cash conversion for the latest full year that has BOTH figures, matched
  // by the year header so CFO and PAT are never from different years.
  const pl = parseSection(html, 'profit-loss');
  const cf = parseSection(html, 'cash-flow');
  let cfoToPat: number | null = null, cfoYear: string | null = null;
  const cfo = pick(cf, 'Cash from Operating Activity');
  const plPat = pick(pl, 'Net Profit');
  if (cf && pl && cfo && plPat) {
    for (let k = cf.headers.length - 1; k >= 0; k--) {
      const yr = cf.headers[k];
      const pk = pl.headers.indexOf(yr);
      const c = cfo[k], p = pk >= 0 ? plPat[pk] : null;
      if (c != null && p != null && p !== 0) {
        cfoToPat = Math.round((c / p) * 100) / 100;
        cfoYear = yr;
        break;
      }
    }
  }
  const ratios = parseSection(html, 'ratios');
  const roce = pick(ratios, 'ROCE %', 'ROE %');
  let roceLast: number | null = null;
  if (roce) for (let k = roce.length - 1; k >= 0; k--) if (roce[k] != null) { roceLast = roce[k]; break; }
  const top = parseTopRatios(html);
  return {
    ticker: ticker.toUpperCase(), market: 'IN', source: 'screener-live', basis,
    period: q.headers[L] || null, comparison_period: Y >= 0 ? q.headers[Y] : null,
    sales_curr_cr: at(sales, L), sales_prev_cr: at(sales, Y),
    sales_yoy_pct: growth(at(sales, L), at(sales, Y)),
    pat_curr_cr: at(pat, L), pat_prev_cr: at(pat, Y),
    net_profit_yoy_pct: growth(at(pat, L), at(pat, Y)),
    eps_yoy_pct: growth(at(eps, L), at(eps, Y)),
    opm_pct: at(opm, L), opm_prev_pct: at(opm, Y),
    cfo_to_pat_ratio: cfoToPat, cfo_year: cfoYear,
    roce_pct: roceLast,
    market_cap_cr: top.marketCapCr, pe: top.pe,
    source_url: url,
  };
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** Pure: is the latest quarter recent enough to stand as "this quarter"?
 *  A cached or archived page that ends two years ago must never be shown as
 *  current. Eight months covers the longest normal gap between a quarter
 *  end and the next results (60 days) plus a missed quarter. */
export function isCurrentPeriod(period: string | null, now = new Date()): boolean {
  const m = /([A-Za-z]{3})\w*\s+(\d{4})/.exec(String(period || ''));
  if (!m) return false;
  const mo = MONTHS[m[1].toLowerCase()];
  if (mo == null) return false;
  const end = Date.UTC(Number(m[2]), mo + 1, 0);
  return (now.getTime() - end) / 86_400_000 <= 245;
}

/** Consolidated first (it is what the market reads); standalone when the
 *  consolidated page carries no quarterly table. */
export async function fetchScreenerFinancials(ticker: string): Promise<{ row: ScreenerFinancials | null; error: string | null }> {
  const sym = encodeURIComponent(screenerSymbol(ticker));
  let lastErr: string | null = null;
  // ── CONSOLIDATED FIRST, BUT NOT AT ANY PRICE.                     (zzz765)
  // ALKYLAMINE's consolidated page ends in Mar 2020 (the company stopped
  // consolidating) and E2E / LCL / VAML have fewer than five consolidated
  // quarters, so there is no year-ago column and growth came out blank.
  // A stale or growth-less consolidated table falls back to standalone; a
  // current consolidated table without a year-ago column is kept only when
  // standalone cannot do better.
  let fallback: ScreenerFinancials | null = null;
  for (const [basis, url] of [
    ['consolidated', `https://www.screener.in/company/${sym}/consolidated/`],
    ['standalone', `https://www.screener.in/company/${sym}/`],
  ] as const) {
    const got = await fetchScreenerHtml(url, 15_000);
    if (!got.html) { lastErr = got.error || 'unreachable'; continue; }
    const row = financialsFromHtml(ticker, got.html, basis, url);
    if (!row || (row.sales_curr_cr == null && row.pat_curr_cr == null)) { lastErr = 'no quarterly table'; continue; }
    if (!isCurrentPeriod(row.period)) { lastErr = `latest ${basis} quarter on the page is ${row.period} — too old to stand as this quarter`; continue; }
    if (row.comparison_period) return { row, error: null };
    fallback = fallback || row;
    lastErr = `${basis} table has no year-ago quarter`;
  }
  return fallback ? { row: fallback, error: null } : { row: null, error: lastErr };
}
