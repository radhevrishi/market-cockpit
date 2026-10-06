// zzz923 — THE FACTS THE "NEXT SKY GOLD" SCORE READS, one plain shape for India and the USA.
// India: parsed from the screener.in company page (the same page the book's screener-live row reads), so one fetch gives the
// quarter, the annual P&L, the balance sheet, the cash-flow, the ratio table and the shareholding table.
// USA: the cached SEC XBRL row (lib/us-thesis/facts-server) plus the analyst EPS estimate trend (lib/us-prices).
// Every figure is copied from a table cell or one simple division between two cells; a figure the page does not print is null
// (the score shows it as "not known", never as a pass). Pure: no fetch, no storage. No price is read here except the P/E and
// market cap screener.in prints (used for the valuation check and the size label, never in lib/thesis).
import { financialsFromHtml, parseSection } from './thesis/screener-financials';
import { parseTopRatios } from './ai-gainers/screener-company';

export interface SkyFacts {
  market: 'IN' | 'US'; ticker: string;
  /** where the figures came from, in words */ source: string;
  /** the latest quarter the figures describe, e.g. 'Jun 2026' */ period: string | null;
  salesYoyQ: number | null; patYoyQ: number | null;
  /** compounded 3-year sales / profit growth (India, screener.in) */ salesCagr3y: number | null; profitCagr3y: number | null;
  /** latest full-year sales growth and operating-profit growth (India annual P&L) */ salesGrowthFy: number | null; opGrowthFy: number | null;
  opmNow: number | null; opmYearAgo: number | null;
  roce: number | null; cfoToPat: number | null; cfoYear: string | null;
  /** latest quarter's profit after tax is a loss */ lossMaking: boolean | null;
  /** latest full year (India, ₹ Cr) or latest quarter (USA, $M) */ cfo: number | null; fcf: number | null;
  /** borrowings / (equity capital + reserves), latest balance sheet */ debtToEquity: number | null;
  /** borrowings latest vs a year earlier (×) */ debtGrowthX: number | null;
  /** share count change over two years, %, from profit ÷ EPS (a bonus issue or split also moves it — the line says so) */ shareCountChange2y: number | null;
  promoterNow: number | null; promoterYearAgo: number | null;
  debtorDaysNow: number | null; debtorDaysPrev: number | null;
  /** other income as % of profit before tax (TTM or latest year) */ otherIncomePctOfPbt: number | null;
  /** latest annual sales: India ₹ Cr, USA $M (latest quarter × 4) */ salesBase: number | null;
  pe: number | null; mcap: number | null;
  /** USA: remaining performance obligations (order backlog) vs a year earlier, % */ backlogGrowth: number | null;
  /** USA: next-fiscal-year EPS estimate now vs about 90 days ago, % */ estimateChange: number | null;
  /** zzz927 (fair value inputs, public figures only): the share price the source printed (India ₹ from screener.in, USA $ from Nasdaq), the day it was read */
  price: number | null; priceDate: string | null;
  /** the company's own sector / industry words (screener.in "Sector" / "Industry", Nasdaq "Sector" / "Industry") */ sector: string | null; industry: string | null;
  /** latest full-year net profit and operating profit (India ₹ Cr); USA: latest quarter × 4 ($M, net income only; no operating-profit-before-depreciation figure exists) */ patFy: number | null; opFy: number | null;
  /** borrowings on the latest balance sheet (India ₹ Cr); cash is not read, so this is gross debt */ borrowings: number | null;
  /** zzz929 (India only, screener.in): the last quarters and last full years as printed — header ('Jun 2026', 'Mar 2026') with sales, operating profit and net profit (₹ Cr).
   *  Used to work out how much growth is still needed in the rest of the guided year. null when the table is missing. */
  quarters: PeriodSeries | null; years: PeriodSeries | null;
  /** zzz929 (USA, Yahoo estimate trend): the street's EPS growth for the NEXT fiscal year over the current one (+1y estimate ÷ 0y estimate − 1), and the calendar year that next fiscal year ends in */
  streetEpsGrowthPct: number | null; streetEpsEndYear: number | null;
}
/** zzz929: parallel arrays, oldest first; a figure the page does not print is null. */
export interface PeriodSeries { labels: string[]; sales: (number | null)[]; op: (number | null)[]; pat: (number | null)[] }

export const emptyFacts = (market: 'IN' | 'US', ticker: string, source: string): SkyFacts => ({
  market, ticker, source, period: null, salesYoyQ: null, patYoyQ: null, salesCagr3y: null, profitCagr3y: null, salesGrowthFy: null, opGrowthFy: null,
  opmNow: null, opmYearAgo: null, roce: null, cfoToPat: null, cfoYear: null, lossMaking: null, cfo: null, fcf: null, debtToEquity: null, debtGrowthX: null,
  shareCountChange2y: null, promoterNow: null, promoterYearAgo: null, debtorDaysNow: null, debtorDaysPrev: null, otherIncomePctOfPbt: null,
  salesBase: null, pe: null, mcap: null, backlogGrowth: null, estimateChange: null,
  price: null, priceDate: null, sector: null, industry: null, patFy: null, opFy: null, borrowings: null,
  quarters: null, years: null, streetEpsGrowthPct: null, streetEpsEndYear: null,
});

const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r1 = (v: number) => Math.round(v * 10) / 10;
const pctChange = (cur: number | null, prev: number | null): number | null => (cur != null && prev != null && prev > 0 ? r1(((cur - prev) / prev) * 100) : null);

type Table = { headers: string[]; rows: Record<string, (number | null)[]> };
const row = (t: Table | null, ...labels: string[]): (number | null)[] | null => {
  if (!t) return null;
  for (const l of labels) { const k = Object.keys(t.rows).find((x) => x.toLowerCase() === l.toLowerCase()); if (k) return t.rows[k]; }
  return null;
};
/** index of the newest dated column (skips a trailing 'TTM' or blank) */
const lastDated = (t: Table | null): number => { if (!t) return -1; let k = t.headers.length - 1; while (k >= 0 && !/\d{4}/.test(t.headers[k])) k--; return k; };
const at = (r: (number | null)[] | null, k: number): number | null => (r && k >= 0 && k < r.length ? r[k] : null);

/** "Compounded Sales Growth … 3 Years: 25%" from the profit-loss section text. */
export function compounded(html: string, title: 'Sales' | 'Profit', span = '3 Years'): number | null {
  const i = html.indexOf(`Compounded ${title} Growth`);
  if (i < 0) return null;
  const text = html.slice(i, i + 2500).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const m = new RegExp(`${span}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*%`).exec(text);
  return m ? Number(m[1]) : null;
}

/** The quarterly shareholding table (the first table in the shareholding section): promoters now and four quarters back. */
export function promoterTrend(html: string): { now: number | null; yearAgo: number | null } {
  const i = html.indexOf('id="shareholding"');
  if (i < 0) return { now: null, yearAgo: null };
  const tbl = /<table[\s\S]*?<\/table>/.exec(html.slice(i, i + 60_000))?.[0];
  if (!tbl) return { now: null, yearAgo: null };
  for (const tr of tbl.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const cells = (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) || []).map((c) => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    if (!/^Promoters/i.test(cells[0] || '')) continue;
    const vals = cells.slice(1).map((c) => { const n = Number(c.replace(/[%,]/g, '')); return c && Number.isFinite(n) ? n : null; });
    const L = vals.length - 1;
    return { now: at(vals, L), yearAgo: L >= 4 ? at(vals, L - 4) : at(vals, 0) };
  }
  return { now: null, yearAgo: null };
}

/** zzz929: the last `n` dated columns of a screener.in table as a PeriodSeries (a trailing 'TTM' or blank column is skipped). null when the table or its sales row is missing. */
export function seriesOf(t: Table | null, n: number): PeriodSeries | null {
  if (!t) return null;
  const L = lastDated(t);
  const sales = row(t, 'Sales', 'Revenue'), op = row(t, 'Operating Profit', 'Financing Profit'), pat = row(t, 'Net Profit');
  if (L < 0 || !sales) return null;
  const from = Math.max(0, L - n + 1);
  const cut = (r: (number | null)[] | null) => { const o: (number | null)[] = []; for (let k = from; k <= L; k++) o.push(at(r, k)); return o; };
  return { labels: t.headers.slice(from, L + 1).map((h) => h.trim()), sales: cut(sales), op: cut(op), pat: cut(pat) };
}

/** Pure: the screener.in company page into SkyFacts. Null when the page has no quarterly table. */
export function inFactsFromHtml(ticker: string, html: string, basis: 'consolidated' | 'standalone', url: string): SkyFacts | null {
  const q = financialsFromHtml(ticker, html, basis, url);
  if (!q) return null;
  const f = emptyFacts('IN', ticker.toUpperCase(), `screener.in company page (${basis})`);
  f.period = q.period; f.salesYoyQ = q.sales_yoy_pct; f.patYoyQ = q.net_profit_yoy_pct;
  f.opmNow = q.opm_pct; f.opmYearAgo = q.opm_prev_pct; f.roce = q.roce_pct; f.cfoToPat = q.cfo_to_pat_ratio; f.cfoYear = q.cfo_year;
  f.lossMaking = q.pat_curr_cr != null ? q.pat_curr_cr < 0 : null; f.pe = q.pe; f.mcap = q.market_cap_cr;
  f.salesCagr3y = compounded(html, 'Sales'); f.profitCagr3y = compounded(html, 'Profit');

  const pl = parseSection(html, 'profit-loss');
  const L = lastDated(pl);
  const sales = row(pl, 'Sales', 'Revenue'), op = row(pl, 'Operating Profit', 'Financing Profit'), np = row(pl, 'Net Profit'), eps = row(pl, 'EPS in Rs');
  const oi = row(pl, 'Other Income'), pbt = row(pl, 'Profit before tax');
  f.salesBase = at(sales, L);
  f.years = seriesOf(pl, 3);
  f.quarters = seriesOf(parseSection(html, 'quarters'), 10);
  f.patFy = at(np, L); f.opFy = at(op, L);
  f.salesGrowthFy = pctChange(at(sales, L), at(sales, L - 1));
  f.opGrowthFy = pctChange(at(op, L), at(op, L - 1));
  // other income against profit before tax: the TTM column when printed, else the latest year
  const T = pl ? pl.headers.length - 1 : -1;
  const oiT = at(oi, T) ?? at(oi, L), pbtT = at(pbt, T) ?? at(pbt, L);
  if (oiT != null && pbtT != null && pbtT > 0) f.otherIncomePctOfPbt = r1((oiT / pbtT) * 100);
  // share count from profit ÷ EPS, latest year vs two years earlier
  const sh = (k: number) => { const p = at(np, k), e = at(eps, k); return p != null && e != null && p > 0 && e > 0 ? p / e : null; };
  f.shareCountChange2y = pctChange(sh(L), sh(L - 2));

  const bs = parseSection(html, 'balance-sheet');
  const B = lastDated(bs);
  const cap = row(bs, 'Equity Capital', 'Share Capital'), res = row(bs, 'Reserves'), bor = row(bs, 'Borrowings', 'Borrowing');
  const eq = (k: number) => { const c = at(cap, k), r = at(res, k); return c != null && r != null ? c + r : null; };
  const bNow = at(bor, B), eNow = eq(B);
  if (bNow != null && eNow != null && eNow > 0) f.debtToEquity = Math.round((bNow / eNow) * 100) / 100;
  f.borrowings = bNow;
  const bPrev = at(bor, B - 1);
  if (bNow != null && bPrev != null && bPrev > 0) f.debtGrowthX = Math.round((bNow / bPrev) * 100) / 100;

  const cf = parseSection(html, 'cash-flow');
  const C = lastDated(cf);
  f.cfo = at(row(cf, 'Cash from Operating Activity'), C);
  f.fcf = at(row(cf, 'Free Cash Flow'), C);

  const ra = parseSection(html, 'ratios');
  const R = lastDated(ra);
  const dd = row(ra, 'Debtor Days');
  f.debtorDaysNow = at(dd, R); f.debtorDaysPrev = at(dd, R - 1);

  // zzz927: the price printed on the page and the company's own sector / industry words (for the fair-value estimate)
  const top = parseTopRatios(html);
  f.price = top.price != null && top.price > 0 ? top.price : null;
  const tag = (t: string) => { const m = new RegExp(`title="${t}">([^<]+)<`).exec(html); return m ? m[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null; };
  f.sector = tag('Sector'); f.industry = tag('Industry');

  const pr = promoterTrend(html);
  f.promoterNow = pr.now; f.promoterYearAgo = pr.yearAgo;
  return f;
}

/** Pure: the cached SEC row (us-thesis:facts) and the estimate trend rows into SkyFacts. Null when the row has no figures. */
export function usFactsFromRow(ticker: string, r: any, trend?: Array<{ period: string; current: number | null; d90: number | null; d60?: number | null; end_date?: string | null }> | null): SkyFacts | null {
  if (!r || r.source !== 'sec-xbrl') return null;
  const f = emptyFacts('US', ticker.toUpperCase(), 'SEC XBRL filings (latest quarter)');
  f.period = r.fiscal_label || r.q_end || null;
  f.salesYoyQ = fin(r.sales_yoy_pct); f.patYoyQ = fin(r.net_profit_yoy_pct);
  f.opmNow = fin(r.opm_pct); f.opmYearAgo = fin(r.opm_prev_pct);
  f.roce = fin(r.roce_pct);
  // a cash ratio off a tiny profit says nothing about cash quality (adapter note) — left as not known
  f.cfoToPat = r.cfo_to_pat_note ? null : fin(r.cfo_to_pat_ratio);
  const ni = fin(r.net_income_curr_musd);
  f.lossMaking = ni != null ? ni < 0 : null;
  const cfo = fin(r.cfo_curr_musd), capex = fin(r.capex_curr_musd);
  f.cfo = cfo; f.fcf = cfo != null && capex != null ? r1(cfo - Math.abs(capex)) : null;
  const rev = fin(r.revenue_curr_musd);
  f.salesBase = rev != null ? Math.round(rev * 4) : null;
  f.patFy = ni != null ? Math.round(ni * 4) : null;   // latest quarter × 4 (a run-rate, said so wherever it is shown)
  f.backlogGrowth = fin(r.rpo_growth_pct);
  const fy = (trend || []).find((x) => x?.period === '+1y') || (trend || []).find((x) => x?.period === '0y');
  const before = fy ? fin(fy.d90) ?? fin(fy.d60 ?? null) : null, now = fy ? fin(fy.current) : null;
  if (before != null && now != null && Math.abs(before) >= 0.05) f.estimateChange = r1(((now - before) / Math.abs(before)) * 100);
  // zzz929: the street's EPS growth for the next fiscal year over the current one (needs a positive current-year estimate, so the % means something)
  const cur = (trend || []).find((x) => x?.period === '0y'), nxt = (trend || []).find((x) => x?.period === '+1y');
  const c0 = cur ? fin(cur.current) : null, c1 = nxt ? fin(nxt.current) : null;
  const yr = Number(String((nxt as any)?.end_date ?? '').slice(0, 4));
  if (c0 != null && c1 != null && c0 >= 0.05) { f.streetEpsGrowthPct = r1(((c1 - c0) / c0) * 100); f.streetEpsEndYear = Number.isFinite(yr) && yr > 1990 ? yr : null; }
  return f;
}
