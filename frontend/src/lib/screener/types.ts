// zzz938 — STOCK SCREENER (our own, replaces the TradingView screener). Shared shapes for the snapshot rows and the filters.
// One row per company, built on the server from free sources (USA: Nasdaq list + SEC filings + Yahoo prices;
// India: NSE + screener.in + Yahoo prices). The page downloads the whole snapshot once and filters in the browser, so changing a filter is instant.

import type { ScreenPatternTag, ScanMeta, LiveScanMeta } from './pine';

export type ScreenMarket = 'US' | 'IN';

/** One company in the snapshot. Money: USA $ million, India ₹ crore. Percent fields are plain percent (25 = 25%). null = not known.
 *  zzz948: the fields after `q` were added for the owner's full set of TradingView screens; they are optional so older snapshots
 *  (built before them) still load — a missing field simply fails a filter on it. */
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
  /** zzz969 — read during a trading session: the same price figures as of the last COMPLETED session (close-confirmed mode) */
  cc?: Partial<Record<string, number | null>>;
  /** zzz974 — set by the completed-sessions view: valuation figures re-worked at the close ('scaled') or dropped ('unavailable') */
  ccBasis?: 'scaled' | 'unavailable';
  nq?: 'recent-listing' | 'not-in-sec' | 'annual-only' | 'missing-tags';   // zzz967 (SC-02) — why there are no quarterly figures (US)

  // ── zzz948: TradingView names ───────────────────────────────────────────────────────────────────────────────────────
  tvSec?: string | null;     // TradingView sector (worked out from the industry — lib/screener/tv-sectors.ts)
  exch?: string[] | null;    // exchanges the stock trades on: NASDAQ / NYSE / AMEX, or NSE / BSE
  // ── price-based (daily bars) ─────────────────────────────────────────────────────────────────────────────────────────
  sma21?: number | null; sma100?: number | null; sma150?: number | null;
  ema10?: number | null; ema21?: number | null; ema50?: number | null; ema200?: number | null;
  rsi?: number | null; rsiW?: number | null; rsiM?: number | null;   // RSI 14 on daily / weekly / monthly closes
  atrP?: number | null;      // ATR 14 as % of price
  adrP?: number | null;      // average day range %, 20 days
  chgOpen?: number | null;   // change from today's open %
  chg1W?: number | null;     // change this week (vs last week's close) %
  perf5D?: number | null; perf1W?: number | null; perf1M?: number | null; perf3M?: number | null; perf6M?: number | null;
  perfYTD?: number | null; perf1Y?: number | null; perf5Y?: number | null; perfAll?: number | null;
  avgVol30?: number | null; avgVol60?: number | null;
  vol1W?: number | null;     // this week's volume so far
  hi52?: number | null;      // 52-week high
  ipoD?: number | null;      // first trading day, days since 1970-01-01
  earnD?: number | null;     // most recent results date, days since 1970-01-01
  // ── company figures ──────────────────────────────────────────────────────────────────────────────────────────────────
  roeTTM?: number | null; roeFY?: number | null; roceTTM?: number | null; roceFY?: number | null;
  nmTTM?: number | null;     // net margin, last 4 quarters
  ptmTTM?: number | null;    // pre-tax margin, last 4 quarters
  opmFY?: number | null;     // operating margin, latest full year
  pe?: number | null;        // price ÷ earnings (last 4 quarters; loss-makers have none)
  pcf?: number | null;       // price ÷ cash (market cap ÷ cash and short-term investments)
  netDebt?: number | null;   // debt − cash, latest quarter (money)
  niFY?: number | null;      // net income, latest full year (money)
  epsTTMYoY?: number | null; revTTMYoY?: number | null; gpAYoY?: number | null;
  ebitdaTTMYoY?: number | null; ebitdaQYoY?: number | null;
  deFY?: number | null;      // debt ÷ equity at the latest year end
  fcfEmp?: number | null;    // free cash flow per employee, latest full year ($)
  debtEbitdaQ?: number | null; debtEbitdaA?: number | null;
  liabQ?: number | null; liabA?: number | null;            // total liabilities (money)
  debtAssetsQ?: number | null; debtAssetsA?: number | null;
  debtCapQ?: number | null; debtCapA?: number | null;      // debt ÷ (debt + equity)
  // ── zzz983: chart patterns (Pine Screener) — read from the same daily bars as the price figures (lib/screener/pine.ts) ──
  pat?: ScreenPatternTag[];  // patterns the latest bars show, likelihood ≥ 35 (absent = none found, or not scanned yet)
  patAt?: string;            // date of the last bar the patterns were read from (absent = not scanned yet)
  // ── zzz993 (MC-02): scan quality — status / version / usable bars / as-of / volume coverage (pine.ts ScanMeta) ───────────────
  scan?: ScanMeta;           // daily scan; tags (pat) are present only when scan.st is 'ready' and the version is current
  patW?: ScreenPatternTag[]; patM?: ScreenPatternTag[];   // weekly / monthly patterns (tags carry tf 'W' / 'M') — filled once wired
  scanW?: ScanMeta; scanM?: ScanMeta;
  // zzz1003 (PS-03): `pat` / `scan` are read from COMPLETED sessions (scan.session 'completed', scan.asOf / scan.px = the last completed
  //    session and its close; scan.obsAt = when the bars were observed). When the build read during a session, the unfinished bar's
  //    own reading is kept apart: patLive (daily tags with lv: 1, provisional) + scanLive { st, session: 'open', at, asOf, px }.
  patLive?: ScreenPatternTag[];
  scanLive?: LiveScanMeta;
  // ── zzz993 (MC-01): price provenance. Patterns, pivot distances (tag.d), stages AND the moving averages / RSI / performance
  //    figures are all worked out from ONE set of daily bars, whose last close is scanPx. `px` / `chg` are the latest quote and can
  //    come from another source (US: Nasdaq's list; India: NSE's daily price file). Neither is certified as the exchange close.
  scanPx?: number;           // close of the last bar the patterns and price figures were computed from
  scanAt?: string;           // that bar's date (YYYY-MM-DD; a live, unfinished session when the row has `cc`)
  scanSrc?: string;          // 'yahoo' | 'yahoo+nse-bhav' (Yahoo bars with NSE's own official prices laid over the last ~3 months)
  scanBasis?: string;        // 'split-adjusted price' — Yahoo chart closes: adjusted for splits / bonuses, not for dividends
  scanEx?: string;           // exchange Yahoo names for the symbol (US: consolidated listing, e.g. 'NasdaqGS'; India: 'NSE')
  pxSrc?: string;            // source of px / chg: 'nasdaq' (US screener list, last sale) | 'nse-bhav' (NSE official close)
  pxAt?: string;             // date of px when known (India: the NSE file's date; US: unknown — the snapshot's builtAt)
  pxGap?: number;            // (px ÷ scanPx − 1) × 100, 0.01
  pxAlt?: number;            // zzz996 — Nasdaq's quote when it was a session behind and the last bar's close replaced it
  pxLive?: 1;                // zzz1008 — px is the close of today's UNFINISHED daily bar (Nasdaq's list was a session behind during the
                             // session): provisional, observed when the bars were read (scanLive.at) — not a completed close
  pxConflict?: 1;            // |pxGap| > 2 on the same (or an unknown) day: the two vendors disagree materially
  // ── zzz984: the owner's TradingView Pine Screener setups (lib/screener/tv-screens.ts), from the same daily bars ─────────────
  tt?: number | null;        // Minervini trend template: rules passed 0–6
  ttOk?: number | null;      // 1 = all six rules pass, 0 = not
  rsiMA?: number | null;     // 14-session average of RSI 14
  rsiX?: number | null;      // sessions since RSI crossed above its average (within 10; absent = none)
  gcD?: number | null; dcD?: number | null;       // sessions since SMA 50 crossed above / below SMA 200 (within 20)
  emaXU?: number | null; emaXD?: number | null;   // sessions since EMA 10 crossed above / below EMA 21 (within 20)
  rsR?: number | null;       // RS Rating 1–99 within the market's snapshot (IBD-style weighted 12-month performance)
  stage?: number | null;     // Weinstein stage 1–4 (30-week average)
  st12?: number | null;      // 1 = stage 2 now after stage 1 within the previous 6 weeks
  ppD?: number | null;       // sessions since the latest volume pocket pivot (within 10)
  rvol?: number | null;      // relative volume: last session ÷ 50-session average
  'adv$'?: number | null;    // average daily traded value, 20 sessions (money: $ million / ₹ crore)
  ripB?: number | null;      // Ripster EMA clouds bullish (1 / 0)
  fcfmTTM?: number | null;   // free-cash-flow margin % (≈ latest full year — see FIELDS)
  fcfmAt?: string;            // zzz1044 (F03) — the fiscal year the FCF margin is for (US: year-end date; India: 'Mar 2026')
  r40?: number | null;       // revenue growth quarterly YoY + FCF margin (the owner's custom Rule of 40)
  // zzz1045e — USA only: TRUE trailing-12-month FCF margin (last four fiscal quarters, from year-to-date cash-flow totals; fcf-ttm.ts)
  fcfmT?: number | null;     // (Σ 4 quarters operating cash flow − Σ 4 quarters capex) ÷ the same 4 quarters' revenue, %
  fcfmTAt?: string;          // end date of the last of those four quarters
  r40T?: number | null;      // revenue growth quarterly YoY + fcfmT (Rule of 40 on the trailing figure)
  // ── zzz987: Stage Analysis (TheWrap method — our own version from the published rules, lib/stage-analysis.ts) ──────────
  twSt?: number | null;      // stage 1–4 on weekly bars (state machine)
  sata?: number | null;      // SATA score 0–10
  mrs?: number | null;       // Mansfield RS vs S&P 500 (US) / Nifty 50 (India)
  twWk?: number | null;      // weeks in the current stage
  twH?: number | null;       // zzz1047 — Stage 2 health: 2 healthy · 1 losing momentum · 0 weakening (topping risk); null outside Stage 2
  twDd?: number | null;      // zzz1047 — % below the highest weekly close since the current stage began (0 = at the high)
  // ── zzz1020: trader setups (lib/setups.ts — our own version of the published rules), from the completed daily sessions. Present
  //    only when the company's setups were read with the current SETUP_VERSION (pine.ts); windowed fields are null when nothing fired.
  wt3?: number | null;       // 3 weeks tight: weekly closes in the tight run (≥ 3, price above SMA 50)
  wt3P?: number | null;      // its pivot (highest weekly high of the run)
  udv?: number | null;       // up / down volume ratio, 50 sessions
  x10A?: number | null; x50A?: number | null;   // (close − EMA 10) / (close − SMA 50), in ATR 14s
  dvx?: number | null;       // Darvas: 1 inside a box, 2 top broken (≤ 5 sessions), 3 bottom broken (≤ 5 sessions)
  dvT?: number | null; dvB?: number | null;     // Darvas box top / bottom
  dc20D?: number | null; dc55D?: number | null; // sessions since a close above the prior 20 / 55-session high (within 10)
  dc20W?: number | null;     // weeks since a weekly close above the prior 20-week high (within 10)
  sqzN?: number | null; sqzF?: number | null; sqzM?: number | null;   // squeeze bars / sessions since it fired / momentum sign
  nr7?: number | null;       // 7 / 4 / 0 — narrowest range of 7 / 4 sessions
  ib?: number | null;        // 1 = inside bar
  epD?: number | null; epG?: number | null;     // episodic pivot: sessions since (within 10), gap %
  epE?: number | null;       // 1 = that gap came within 3 days of the results date (India; when both dates are known)
  gvD?: number | null; mbD?: number | null; antD?: number | null; wpD?: number | null; ecbD?: number | null;
  nhD?: number | null; athD?: number | null; hgD?: number | null; sprD?: number | null;
  td9?: number | null;       // TD setup count −9 … +9
  csl?: number | null;       // CANSLIM points 0–5 (C, A, N, S, L; M not counted)
  // ── zzz1046a: volume & accumulation (lib/accumulation.ts via acc-row.ts — our own version of the published O'Neil / Wyckoff rules),
  //    from the completed daily sessions. Present only when the company was read with the current ACC_VERSION. The 50-session up /
  //    down volume is `udv` above (the same figure).
  accS?: number | null;      // accumulation score 0–100
  accR?: number | null;      // grade as a number: A 5 · B 4 · C 3 · D 2 · E 1
  accG?: string;             // grade letter A–E
  accM?: string;             // zzz1047 — a high score not graded A / B: the unmet conditions
  accP?: number[];           // the score's parts [money flow /25, days /20, up-down volume /15, OBV /15, weeks /15, pullback /10]
  accD?: number | null; disD?: number | null; chD?: number | null;   // accumulation / distribution (incl. stalling) / stalling sessions, last 25
  cmf21?: number | null; cmf65?: number | null;                       // Chaikin money flow, 21 / 65 sessions
  obvSlope?: number | null;  // On-Balance Volume trend over 50 sessions, in average sessions of volume
  obvLead?: number | null;   // 1 OBV at its 120-session high while price is not · −1 price at its high, OBV well below · 0
  bigUpW?: number | null; bigDnW?: number | null;                     // big-volume up / down weeks among the last 10 completed weeks
  vdu?: number | null;       // 1 quiet (light-volume) pullback · 0 pullback on heavy volume · absent = not pulling back
  vboD?: number | null; vboX?: number | null;                         // sessions since a volume breakout (last 10) and its volume ÷ average
  distWarn?: number | null;  // 1 = distribution piling up
  dlv10?: number | null;     // India: delivery % of traded shares, 10-session average (NSE price files)
  dlvChg?: number | null;    // India: dlv10 minus the 40 sessions before, percentage points
}

export interface ScreenSnapshot {
  market: ScreenMarket;
  builtAt: string;
  rows: ScreenRow[];
  notes: string[];           // what the build could not read, in plain words
  sources: string[];
}

/** zzz948: the snapshot as stored and sent to the page — unknown figures (null) are left out, which keeps ~75 fields per company
 *  small; the page treats a missing figure exactly like null (it fails a filter on it). */
export const rowsJson = (rows: ScreenRow[]): string => JSON.stringify(rows, (_k, v) => (v === null ? undefined : v));
