// zzz1048 — THE TRADINGVIEW CSVs, MADE BY OUR OWN SCREENER.
//
// Until now a GitHub workflow (tradingview-sync.yml) logged into TradingView twice a day with a headless browser, downloaded
// the owner's saved TradingView screens as CSVs into public/data/tradingview/ and committed them to git. Several pages read
// those files: the Technicals tab, the USA Multibagger tab, the India Multibagger pool, the Fundamentals page (USA portfolio and
// the USA "other exports" pool), the home-page Technicals tiers and the AI gainers fallback.
//
// Our own Stock Screener (lib/screener/*) now holds every one of those screens as a built-in screen (BUILT_IN_SCREENS, same
// rules), run over our own daily snapshot. This module turns a screen result into the SAME CSV the TradingView export was —
// the same file names, the same column names, the same money units (TradingView writes raw currency: dollars / rupees) — so
// every existing parser reads it unchanged. Pure: no I/O (the server side is tv-replacement-server.ts).
//
// Honest gaps: a TradingView column our snapshot has no figure for is written EMPTY (never guessed). TV_BLANK_COLUMNS lists
// them; the parsers already treat an empty cell as "not known".

import type { ScreenRow, ScreenMarket } from './types';
import { BUILT_IN_SCREENS, runScreen, type Screen } from './filters';

/** One file the old TradingView sync produced, and where its rows now come from. */
export interface TvReplacementFile {
  /** file name as the pages ask for it (unchanged) */
  name: string;
  /** the TradingView screen / watchlist name it replaced */
  tvName: string;
  /** TradingView screener / watchlist id (for the record) */
  tvId: string;
  kind: 'screener' | 'watchlist';
  /** built-in screens (lib/screener/filters.ts) whose results make up the file — a TradingView screen on both markets is two */
  screens: string[];
  /** watchlist: where the list comes from instead */
  list?: 'us-book';
  /** how the rules were matched (read from the TradingView screen's own saved filters) */
  why: string;
}

/**
 * The mapping. Every file the sync wrote is here. The screen rules were compared with the filters TradingView itself sent
 * when the sync opened each screen (the scanner requests it saved in public/data/tradingview/_debug on 15 Oct 2026 — that
 * folder is removed in zzz1048; the three Multibagger screens' rules are kept in zzz1048-tv-replacement.test.ts):
 *   · the five screens TradingView runs on BOTH markets wrote US and Indian rows into one file → both copies here;
 *   · the three "Multibagger" screens have no built-in screen under their TradingView names, but their saved rules are exactly
 *     two built-in screens: GHHf1HVl = "Future Super Scalers like NBIS Main (= NBIS 2)", SwBe8R8b = "ZACHS SCREENER", and
 *     I0y51g1p = "ZACHS SCREENER India" (same rules, India market).
 *   · the watchlist "USA Portfolio" is not a screen: it is the owner's US holdings — now read from his US Portfolio Book
 *     (/api/v1/us-book), the list the rest of the app already treats as the US portfolio. Figures for each holding come from
 *     the US snapshot; a holding not in the snapshot is reported, never invented.
 */
export const TV_REPLACEMENT_FILES: readonly TvReplacementFile[] = [
  { name: 'minervini-stocks.csv', tvName: 'Minervni Stocks', tvId: 'sBtiBahk', kind: 'screener', screens: ['us-minervini', 'in-minervini'], why: 'same name and rules; TradingView runs it on USA + India' },
  { name: 'qullamaggie-leaders.csv', tvName: 'Qualmaggie Leader Stocks in Bearmarket or Corrections', tvId: 'WJDx6FZ9', kind: 'screener', screens: ['us-qullamaggie-leaders', 'in-qullamaggie-leaders'], why: 'same name and rules; USA + India (its NASDAQ / NYSE filter leaves no Indian rows on TradingView)' },
  { name: 'episodic-pivot.csv', tvName: 'EPISODIC PIVOT / VOLUME SURGE', tvId: 'Px4kG2hQ', kind: 'screener', screens: ['us-episodic-pivot', 'in-episodic-pivot'], why: 'same name and rules; USA + India' },
  { name: 'liquidity-leaders.csv', tvName: 'Liquidity Leaders', tvId: '9IcX30Ez', kind: 'screener', screens: ['us-liquidity-leaders', 'in-liquidity-leaders'], why: 'same name and rules; USA + India' },
  { name: 'weekly-gainer-usa.csv', tvName: 'Weekly Gainer Stocks USA', tvId: 'Neuim2Bm', kind: 'screener', screens: ['us-weekly-gainer-usa', 'in-weekly-gainer-usa'], why: 'same name and rules; USA + India (despite "USA" in the name)' },
  { name: 'sales-eps-growth-bonde.csv', tvName: 'Sales And EPS Growth for EP - Pradeep Bonde style', tvId: 'RtSuWTgK', kind: 'screener', screens: ['us-bonde-ep'], why: 'same name and rules; USA' },
  { name: 'future-nvda-alab-app-pltr.csv', tvName: 'Future NVDIA ALAB APP PLTR (USA)', tvId: '5gzenlmQ', kind: 'screener', screens: ['us-future-nvda'], why: 'same name and rules; USA' },
  { name: 'future-super-scalers-nbis.csv', tvName: 'Future Super Scalers like NBIS Full', tvId: 'oRvEFfVY', kind: 'screener', screens: ['us-super-scalers-full'], why: 'same name and rules; USA' },
  { name: 'usa-multibagger-3.csv', tvName: 'USA Multibagger (GHHf1HVl)', tvId: 'GHHf1HVl', kind: 'screener', screens: ['us-super-scalers-main'], why: 'its saved rules are exactly "Future Super Scalers like NBIS Main (= NBIS 2)"' },
  { name: 'usa-multibagger-tv-1.csv', tvName: 'USA Multibagger (SwBe8R8b)', tvId: 'SwBe8R8b', kind: 'screener', screens: ['us-zachs'], why: 'its saved rules are exactly "ZACHS SCREENER"' },
  { name: 'india-multibagger-tv-1.csv', tvName: 'India Multibagger (I0y51g1p)', tvId: 'I0y51g1p', kind: 'screener', screens: ['in-zachs'], why: 'its saved rules are exactly "ZACHS SCREENER India"' },
  { name: 'watchlist-usa-339270482.csv', tvName: 'USA Portfolio (TradingView 339270482)', tvId: '339270482', kind: 'watchlist', screens: [], list: 'us-book', why: 'a TradingView watchlist, not a screen: replaced by the US Portfolio Book holdings' },
];

export const tvFileOf = (name: string): TvReplacementFile | undefined => TV_REPLACEMENT_FILES.find((f) => f.name === name);
export const screenById = (id: string): Screen | undefined => BUILT_IN_SCREENS.find((s) => s.id === id);
/** The markets a file needs a snapshot for. */
export function marketsOf(f: TvReplacementFile): ScreenMarket[] {
  if (f.list === 'us-book') return ['US'];
  return Array.from(new Set(f.screens.map((id) => screenById(id)?.market).filter((m): m is ScreenMarket => !!m)));
}
/** The name shown for a file: the built-in screen it now comes from. */
export function displayNameOf(f: TvReplacementFile): string {
  if (f.list === 'us-book') return 'USA Portfolio (US Portfolio Book)';
  const s = screenById(f.screens[0]);
  return s ? s.name : f.tvName;
}

// ── the CSV shape ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Every column the TradingView exports carried (the union of all 12 files, in their order). Each generated file has all of
 *  them, so every parser finds the column it looks for. */
export const TV_COLUMNS: readonly string[] = [
  'Symbol', 'Exchange', 'Description', 'Market capitalization', 'Price', 'Sector', 'Gross profit growth %, Quarterly YoY',
  'Revenue growth %, Quarterly YoY', 'Gross margin %, Trailing 12 months', 'Free cash flow margin %, Annual', 'Revenue growth %, Annual YoY',
  'Price to earnings ratio', 'Forward non-GAAP price to earnings, Annual', 'Net debt, Annual', 'Enterprise value to EBITDA ratio, Trailing 12 months',
  'Enterprise value to revenue ratio, Trailing 12 months', 'Price to sales ratio', 'Operating margin %, Trailing 12 months', 'Price to book ratio',
  'Return on equity %, Trailing 12 months', 'Upcoming earnings date', 'Cash and equivalents, Annual', 'Long term debt, Annual',
  'Earnings per share diluted growth %, TTM YoY', 'Return on invested capital %, Annual', 'Debt to equity ratio, Quarterly', 'Performance % 1 year',
  'Net margin %, Trailing 12 months', 'Revenue growth %, 5 year CAGR', 'Price to earning to growth, Trailing 12 months', 'Analyst Rating',
  'Piotroski F-score, Trailing 12 months', 'Altman Z-score, Trailing 12 months', 'Shares buyback ratio %, Annual', 'Interest coverage, Annual',
  'Return on capital employed %, Annual', 'Sloan ratio %, Annual', 'Buyback yield %', 'Research and development ratio, Annual',
  'Net debt to EBITDA ratio, Annual', 'Revenue per employee, Annual', 'Sustainable growth rate, Annual', 'Free float %',
  'Free cash flow per share, Trailing 12 months', 'Exponential moving average, 50, 1 day', 'Exponential moving average, 200, 1 day',
  'Cash and short-term investments, Annual', 'Performance %, 3 months', 'Performance %, 6 months', 'Earnings per share estimate, Annual',
  'Beta, 5 years', 'EBITDA margin %, Trailing 12 months', 'Capital expenditures per share, Trailing 12 months',
  'Earnings per share diluted growth %, Quarterly YoY', 'Target price, 1 year', 'Average volume, 30 days', 'Relative strength index, 14, 1 day',
  'Total common shares outstanding', 'Number of employees, Annual', 'Free cash flow, Annual', 'Free cash flow, Trailing 12 months',
  'High, 52 weeks', 'Performance %, 1 week', 'Performance %, 1 month', 'Average true range, 14, 1 day', 'Simple moving average, 50, 1 day',
  'Simple moving average, 150, 1 day', 'Simple moving average, 200, 1 day', 'Volatility, 1 month', 'Volatility, 1 week', 'Low, 52 weeks',
  'Relative volume, 1 week', 'Volume', 'Exponential moving average, 21, 1 day', 'Industry', 'Gap', 'Gross margin %, Annual', 'net_debt_fq',
  'gross_profit_yoy_growth_fy', 'net_debt_to_ebitda_fq', 'Piotroski F-score, Annual', 'Altman Z-score, Annual', 'sloan_ratio_ttm',
  'research_and_dev_ratio_ttm', 'free_cash_flow_per_employee_fy', 'debt_to_equity_fy', 'ebitda_per_employee_fy', 'return_on_capital_employed_fq',
  'ebitda_yoy_growth_fy',
];
/** India-only files also carry "Market Capitalization" (capital C) in ₹ CRORE: the India Multibagger column map reads that exact
 *  header as crore and prefers it over the raw-rupee TradingView column (which it used to read as crore — 10 million × too big). */
export const IN_CRORE_CAP_COLUMN = 'Market Capitalization';

type Cell = string | number;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Our money is $ million (US) / ₹ crore (India); TradingView writes raw dollars / rupees. */
export const rawMoney = (v: number | null | undefined, m: ScreenMarket): number | null => (fin(v) ? (m === 'US' ? v * 1e6 : v * 1e7) : null);

/** Which snapshot figure fills which TradingView column. Anything not here is left empty. */
type Getter = (r: ScreenRow, m: ScreenMarket) => Cell | null | undefined;
const num = (k: keyof ScreenRow): Getter => (r) => { const v = r[k]; return fin(v) ? v : null; };
const money = (k: keyof ScreenRow): Getter => (r, m) => rawMoney(r[k] as number | null | undefined, m);
export const TV_COLUMN_SOURCES: Readonly<Record<string, { get: Getter; from: string }>> = {
  'Symbol': { get: (r) => r.t, from: 't' },
  'Exchange': { get: (r, m) => (m === 'IN' ? (Array.isArray(r.exch) && r.exch.length && !r.exch.includes('NSE') ? r.exch[0] : 'NSE') : (Array.isArray(r.exch) && r.exch[0]) || ''), from: 'exch' },
  'Description': { get: (r) => r.n, from: 'n' },
  'Market capitalization': { get: money('mc'), from: 'mc × 1e6 ($) / × 1e7 (₹)' },
  'Price': { get: num('px'), from: 'px' },
  'Sector': { get: (r) => r.tvSec || r.sec || '', from: 'tvSec (TradingView sector), else the source sector' },
  'Industry': { get: (r) => r.ind || '', from: 'ind (the source\'s industry words, not TradingView\'s)' },
  'Gross profit growth %, Quarterly YoY': { get: num('gpQYoY'), from: 'gpQYoY' },
  'gross_profit_yoy_growth_fy': { get: num('gpAYoY'), from: 'gpAYoY' },
  'Revenue growth %, Quarterly YoY': { get: num('revQYoY'), from: 'revQYoY' },
  'Revenue growth %, Annual YoY': { get: num('revAYoY'), from: 'revAYoY' },
  'Gross margin %, Annual': { get: num('gmFY'), from: 'gmFY' },
  'Free cash flow margin %, Annual': { get: num('fcfmTTM'), from: 'fcfmTTM (latest full fiscal year; India a cash-flow proxy)' },
  'Price to earnings ratio': { get: num('pe'), from: 'pe' },
  'Enterprise value to revenue ratio, Trailing 12 months': { get: num('evRev'), from: 'evRev' },
  'Price to sales ratio': { get: num('ps'), from: 'ps' },
  'Operating margin %, Trailing 12 months': { get: num('opmTTM'), from: 'opmTTM' },
  'Return on equity %, Trailing 12 months': { get: num('roeTTM'), from: 'roeTTM' },
  'Earnings per share diluted growth %, TTM YoY': { get: num('epsTTMYoY'), from: 'epsTTMYoY' },
  'Earnings per share diluted growth %, Quarterly YoY': { get: num('epsQYoY'), from: 'epsQYoY' },
  'Debt to equity ratio, Quarterly': { get: num('de'), from: 'de' },
  'debt_to_equity_fy': { get: num('deFY'), from: 'deFY' },
  'net_debt_fq': { get: money('netDebt'), from: 'netDebt (latest quarter) × 1e6 / × 1e7' },
  'Performance % 1 year': { get: num('perf1Y'), from: 'perf1Y' },
  'Performance %, 6 months': { get: num('perf6M'), from: 'perf6M' },
  'Performance %, 3 months': { get: num('perf3M'), from: 'perf3M' },
  'Performance %, 1 month': { get: num('perf1M'), from: 'perf1M' },
  'Performance %, 1 week': { get: num('perf1W'), from: 'perf1W (7 calendar days, TradingView\'s definition)' },
  'Net margin %, Trailing 12 months': { get: num('nmTTM'), from: 'nmTTM' },
  'Piotroski F-score, Annual': { get: num('fs'), from: 'fs (latest full year)' },
  'Shares buyback ratio %, Annual': { get: num('bb'), from: 'bb' },
  'Return on capital employed %, Annual': { get: num('roceFY'), from: 'roceFY' },
  'Free float %': { get: num('flt'), from: 'flt (USA only)' },
  'Cash and short-term investments, Annual': { get: money('cash'), from: 'cash (latest reported) × 1e6 / × 1e7' },
  'Number of employees, Annual': { get: num('emp'), from: 'emp' },
  'free_cash_flow_per_employee_fy': { get: num('fcfEmp'), from: 'fcfEmp (USA, $)' },
  'ebitda_yoy_growth_fy': { get: num('ebitdaAYoY'), from: 'ebitdaAYoY' },
  'Exponential moving average, 21, 1 day': { get: num('ema21'), from: 'ema21' },
  'Exponential moving average, 50, 1 day': { get: num('ema50'), from: 'ema50' },
  'Simple moving average, 50, 1 day': { get: num('sma50'), from: 'sma50' },
  'Simple moving average, 150, 1 day': { get: num('sma150'), from: 'sma150' },
  'Simple moving average, 200, 1 day': { get: num('sma200'), from: 'sma200' },
  'Relative strength index, 14, 1 day': { get: num('rsi'), from: 'rsi' },
  'Average true range, 14, 1 day': {
    // ATR in price units = ATR % × the close of the bar it was worked out on (the same bar, so this is a unit change, not a guess)
    get: (r) => { const base = fin(r.scanPx) ? r.scanPx : r.px; return fin(r.atrP) && fin(base) ? Math.round(r.atrP * base) / 100 : null; },
    from: 'atrP × the close it was computed on ÷ 100',
  },
  'High, 52 weeks': { get: num('hi52'), from: 'hi52' },
  'Average volume, 30 days': { get: num('avgVol30'), from: 'avgVol30' },
  'Volume': { get: num('vol'), from: 'vol' },
};
/** TradingView columns our snapshot has no figure for — written empty. */
export const TV_BLANK_COLUMNS: readonly string[] = TV_COLUMNS.filter((c) => !TV_COLUMN_SOURCES[c]);

/** One snapshot row → one TradingView-shaped record. */
export function tvRecordOf(r: ScreenRow, m: ScreenMarket, withCroreCap = false): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const c of TV_COLUMNS) {
    const src = TV_COLUMN_SOURCES[c];
    const v = src ? src.get(r, m) : null;
    out[c] = v == null ? '' : v;
  }
  if (withCroreCap) out[IN_CRORE_CAP_COLUMN] = m === 'IN' && fin(r.mc) ? r.mc : '';
  return out;
}

const cellText = (v: Cell): string => {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Records → CSV text (header first, "\n" line ends, fields with a comma or quote quoted — what the existing readers expect). */
export function toCsv(records: ReadonlyArray<Record<string, Cell>>, columns: readonly string[]): string {
  const lines = [columns.map((c) => cellText(c)).join(',')];
  for (const rec of records) lines.push(columns.map((c) => cellText(rec[c] ?? '')).join(','));
  return lines.join('\n') + '\n';
}

export interface FileRows { rows: Array<{ row: ScreenRow; market: ScreenMarket }>; perScreen: Array<{ id: string; name: string; market: ScreenMarket; count: number }> }
/** Run a file's screens over the snapshots: USA rows first, then India, each by market cap (largest first); a ticker appears once
 *  per market. A screen whose market has no snapshot is skipped (the caller reports it). */
export function screenRowsOf(f: TvReplacementFile, snaps: Partial<Record<ScreenMarket, readonly ScreenRow[]>>, now: Date = new Date()): FileRows {
  const out: FileRows = { rows: [], perScreen: [] };
  for (const m of ['US', 'IN'] as const) {
    const seen = new Set<string>();
    const bucket: ScreenRow[] = [];
    for (const id of f.screens) {
      const s = screenById(id);
      if (!s || s.market !== m) continue;
      const rows = snaps[m];
      if (!rows) continue;
      const hit = runScreen(rows, s.filters, now);
      out.perScreen.push({ id, name: s.name, market: m, count: hit.length });
      for (const r of hit) if (!seen.has(r.t)) { seen.add(r.t); bucket.push(r); }
    }
    bucket.sort((a, b) => (fin(b.mc) ? b.mc : -1) - (fin(a.mc) ? a.mc : -1));
    for (const r of bucket) out.rows.push({ row: r, market: m });
  }
  return out;
}

/** Ticker spellings compared loosely (BRK.B = BRK-B = BRK/B). */
export const tickerLoose = (t: string) => String(t || '').toUpperCase().replace(/^[A-Z]+:/, '').replace(/[./\-\s]/g, '');
/** The US book's holdings looked up in the US snapshot; holdings the snapshot does not have are returned as `missing`. */
export function bookRowsOf(tickers: readonly string[], us: readonly ScreenRow[]): { rows: ScreenRow[]; missing: string[] } {
  const by = new Map<string, ScreenRow>();
  for (const r of us) by.set(tickerLoose(r.t), r);
  const rows: ScreenRow[] = [], missing: string[] = [];
  const seen = new Set<string>();
  for (const t of tickers) {
    const k = tickerLoose(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const r = by.get(k);
    if (r) rows.push(r); else missing.push(t);
  }
  return { rows, missing };
}

/** The CSV text of a file from its rows. India-only files carry the extra ₹ crore market-cap column. */
export function fileCsv(f: TvReplacementFile, rows: ReadonlyArray<{ row: ScreenRow; market: ScreenMarket }>): string {
  const inOnly = marketsOf(f).length === 1 && marketsOf(f)[0] === 'IN';
  const cols = inOnly ? [...TV_COLUMNS, IN_CRORE_CAP_COLUMN] : TV_COLUMNS;
  return toCsv(rows.map(({ row, market }) => tvRecordOf(row, market, inOnly)), cols);
}

/** The manifest the pages read (same shape as the old TradingView manifest.json, plus where each file came from). */
export interface TvManifestFile {
  name: string; displayName: string; tvName: string; kind: 'screener' | 'watchlist'; ok: boolean; size: number; rowCount: number;
  error: string | null; source: 'own-screener' | 'old-tradingview-export' | 'none'; builtAt: string | null; screens: string[]; note?: string;
}
export interface TvManifest {
  lastSync: string | null; ok: number; fail: number; source: 'own-screener'; approach: string; files: TvManifestFile[];
  /** TradingView columns written empty (no figure in our snapshot) */
  blankColumns: readonly string[];
}
export const TV_REPLACEMENT_APPROACH = 'Built from our own Stock Screener snapshots (the same rules as the TradingView screens) — no TradingView login';
