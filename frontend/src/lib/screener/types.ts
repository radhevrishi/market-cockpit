// zzz938 — STOCK SCREENER (our own, replaces the TradingView screener). Shared shapes for the snapshot rows and the filters.
// One row per company, built once a day on the server from free sources (USA: Nasdaq list + SEC filings + Yahoo prices;
// India: NSE + screener.in). The page downloads the whole snapshot once and filters in the browser, so changing a filter is instant.

export type ScreenMarket = 'US' | 'IN';

/** One company in the snapshot. Money: USA $ million, India ₹ crore. Percent fields are plain percent (25 = 25%). null = not known. */
export interface ScreenRow {
  t: string;                 // ticker
  n: string;                 // company name
  sec: string | null;        // sector (the source's own words)
  ind: string | null;        // industry
  px: number | null;         // last price
  chg: number | null;        // day change %
  vol: number | null;        // last day's volume (shares)
  avgVol10: number | null;   // 10-day average volume (shares)
  mc: number | null;         // market cap
  sma50: number | null; sma200: number | null;
  revQYoY: number | null;    // revenue growth, latest quarter vs the same quarter a year ago
  revAYoY: number | null;    // revenue growth, latest full year
  gpQYoY: number | null;     // gross profit growth, quarterly YoY
  gmFY: number | null;       // gross margin, latest full year
  ebitdaQoQ: number | null;  // EBITDA growth, quarter vs previous quarter
  ebitdaAYoY: number | null; // EBITDA growth, latest full year
  epsQYoY: number | null;    // diluted EPS growth, quarterly YoY
  opmTTM: number | null;     // operating margin, last 4 quarters
  ps: number | null;         // price ÷ sales (last 4 quarters)
  evRev: number | null;      // enterprise value ÷ sales (last 4 quarters)
  de: number | null;         // debt ÷ equity, latest quarter (negative equity → 99)
  cash: number | null;       // cash on hand, latest
  emp: number | null;        // employees
  flt: number | null;        // free float, % of shares
  bb: number | null;         // shares buyback ratio, latest full year: (shares a year ago − now) ÷ a year ago, %
  fs: number | null;         // Piotroski F-score (0–9), latest full year
  q: string | null;          // the latest quarter the figures describe (e.g. 'Q2 2026')
  approx?: string[];         // fields worked out in a rougher way for this company (shown with ≈)
}

export interface ScreenSnapshot {
  market: ScreenMarket;
  builtAt: string;
  rows: ScreenRow[];
  notes: string[];           // what the build could not read, in plain words
  sources: string[];
}
