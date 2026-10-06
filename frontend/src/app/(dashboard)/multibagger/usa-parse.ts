// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { usaSerialDate } from '@/lib/multibagger-usa-scoring';
import type { USARow } from '@/lib/multibagger-usa-scoring';
import { F } from './constants';

export function parseUSARow(row: Record<string,unknown>): USARow | null {
  const n = (v: unknown): number|undefined => {
    if (v===''||v===null||v===undefined) return undefined;
    const parsed = parseFloat(String(v).replace(/[,$%]/g,''));
    return isNaN(parsed) ? undefined : parsed;
  };
  const sym = String(row['Symbol']??'').trim().toUpperCase();
  if (!sym) return null;
  const mcapRaw = n(row['Market capitalization']);
  // PATCH 0342: TradingView exports use "Cash and equivalents" (with "and"),
  // not "Cash & equivalents" (with ampersand). Old parser missed this column.
  const cashRaw = n(
    row['Cash and equivalents, Annual'] ??
    row['Cash & equivalents, Annual'] ??
    row['Cash and equivalents']
  );
  const ltDebtRaw = n(row['Long term debt, Annual']);
  const netDebtRaw = n(row['Net debt, Annual']);
  const revQtr = n(row['Revenue growth %, Quarterly YoY']);
  const revAnn = n(row['Revenue growth %, Annual YoY']);
  return {
    symbol: sym,
    company: String(row['Description']??'').trim(),
    sector:  String(row['Sector']??'').trim() || 'Technology services',
    exchange: String(row['Exchange']??'').trim(),
    marketCapUsd: mcapRaw,
    marketCapB: mcapRaw !== undefined ? Math.round(mcapRaw/1e9*100)/100 : undefined,
    revenueGrowthQtr: revQtr,
    revenueGrowthAnn: revAnn,
    // Gross margin: use TTM (TradingView now provides Trailing 12 months) OR Annual as fallback
    grossMarginAnn:   n(row['Gross margin %, Annual'] ??
                        row['Gross margin %, Trailing 12 months']),  // TTM = primary if Annual missing
    fcfMarginAnn:     n(row['Free cash flow margin %, Annual']),
    grossProfitGrowthQtr: n(row['Gross profit growth %, Quarterly YoY']),
    pe:          n(row['Price to earnings ratio']),
    forwardPe:   n(row['Forward non-GAAP price to earnings, Annual']),
    netDebtUsd:  netDebtRaw,
    evEbitda:    n(row['Enterprise value to EBITDA ratio, Trailing 12 months']),
    evRevenue:   n(row['Enterprise value to revenue ratio, Trailing 12 months']),
    ps:          n(row['Price to sales ratio']),
    opmTtm:      n(row['Operating margin %, Trailing 12 months']),
    pb:          n(row['Price to book ratio']),
    roe:         n(row['Return on equity %, Trailing 12 months']),
    cashUsd:     cashRaw,
    ltDebtUsd:   ltDebtRaw,
    // Fix: TradingView exports dates as Excel serial numbers (e.g. 46148.08 = May 4 2026)
    nextEarnings: usaSerialDate(row['Upcoming earnings date']),
    // Optional extra fields — maps both TradingView exact names AND common variants
    epsGrowth: n(
      row['Earnings per share diluted growth %, TTM YoY'] ??   // TradingView exact
      row['EPS diluted growth %, TTM YoY'] ??
      row['EPS growth %, TTM YoY']
    ),
    roic: n(
      row['Return on invested capital %, Annual'] ??            // TradingView exact
      row['ROIC']
    ),
    de: n(
      row['Debt to equity ratio, Quarterly'] ??                 // TradingView exact
      row['Debt / equity ratio'] ??
      row['Debt to equity ratio']
    ),
    netProfitMargin: n(
      row['Net margin %, Trailing 12 months'] ??                // TradingView exact
      row['Net profit margin %, TTM'] ??
      row['Net profit margin %, Annual']
    ),
    perf1y: n(
      row['Performance % 1 year'] ??                            // TradingView exact
      row['Performance, 1 Year %'] ??
      row['1-year performance %'] ??
      row['Perf.Y']
    ),
    pctFrom52wHigh: n(
      row['Change from 52-week high, %'] ??
      row['% from 52W high'] ??
      row['Change from 52W High']
    ),
    // ── TradingView fields (confirmed to exist) ──────────────────────────────
    // 5-year CAGR (TradingView column: "Revenue growth %, 5 year CAGR")
    revGrowth3yr: n(
      row['Revenue growth %, 5 year CAGR'] ??  // TradingView exact name
      row['Revenue growth %, 3-year CAGR'] ??  // fallback for old exports
      row['Revenue 3-year CAGR, %'] ??
      row['Revenue growth %, 3 year CAGR']
    ),
    // zzz904 — the field is named 3yr but TradingView's 5-year column wins when present; record which span it really is.
    revGrowthCagrYears: n(row['Revenue growth %, 5 year CAGR']) !== undefined ? 5
      : n(row['Revenue growth %, 3-year CAGR'] ?? row['Revenue 3-year CAGR, %'] ?? row['Revenue growth %, 3 year CAGR']) !== undefined ? 3 : undefined,
    ruleOf40RevBasis: revQtr !== undefined ? 'QTR' : revAnn !== undefined ? 'ANN' : undefined,
    // Gross margin TTM (TradingView: "Gross margin %, Trailing 12 months")
    grossMarginTtm: n(
      row['Gross margin %, Trailing 12 months'] ??  // TradingView exact
      row['Gross margin %, TTM']
    ),
    // PEG ratio TTM (TradingView: "Price to earning to growth, Trailing 12 months")
    peg: n(
      row['Price to earning to growth, Trailing 12 months'] ??  // TradingView exact
      row['Price to earnings growth ratio'] ??
      row['PEG ratio'] ??
      row['PEG']
    ),
    // Analyst Rating (TradingView: "Analyst Rating" — string: Strong buy/Buy/Neutral/Sell)
    analystRating: (() => {
      const v = String(row['Analyst Rating'] ?? row['Analyst rating'] ?? '').trim();
      return v || undefined;
    })(),
    // RSI (TradingView: "Relative strength index, 14")
    rsi14: n(
      row['Relative strength index, 14'] ??
      row['RSI, 14'] ??
      row['RSI']
    ),
    // P/FCF (TradingView: "Price to free cash flow, TTM")
    pFcf: n(
      row['Price to free cash flow, TTM'] ??
      row['Price to free cash flow ratio, TTM'] ??
      row['P/FCF']
    ),
    // ── PATCH 0341: NEW FORENSIC COLUMNS (TradingView confirmed names) ───────
    piotroskiFScore: n(
      row['Piotroski F-score, Annual'] ??
      row['Piotroski F-score, Trailing 12 months'] ??
      row['Piotroski F-score']
    ),
    altmanZScore: n(
      row['Altman Z-score, Annual'] ??
      row['Altman Z-score, Trailing 12 months'] ??  // PATCH 0342: NVDIA-format file uses TTM
      row['Altman Z-score']
    ),
    sloanRatio: n(
      row['Sloan ratio %, Trailing 12 months'] ??
      row['Sloan ratio %, Annual'] ??
      row['Sloan ratio %']
    ),
    sharesBuybackRatio: n(
      row['Shares buyback ratio %, Annual'] ??
      row['Shares buyback ratio %, Quarterly'] ??
      row['Shares buyback ratio %']
    ),
    buybackYield: n(row['Buyback yield %']),
    rdRatio: n(
      row['Research and development ratio, Trailing 12 months'] ??
      row['Research and development ratio, Annual'] ??
      row['Research and development ratio'] ??
      row['Research & development to revenue ratio %']
    ),
    interestCoverage: n(
      row['Interest coverage, Annual'] ??
      row['Interest coverage, Trailing 12 months'] ??
      row['Interest coverage']
    ),
    netDebtEbitda: n(
      row['Net debt to EBITDA ratio, Trailing 12 months'] ??
      row['Net debt to EBITDA ratio, Annual'] ??
      row['Net debt to EBITDA ratio']
    ),
    cashStInvest: n(
      row['Cash and short-term investments, Annual'] ??
      row['Cash and short-term investments, Quarterly'] ??
      row['Cash and short-term investments']
    ),
    revPerEmployee: n(
      row['Revenue per employee, Annual'] ??
      row['Revenue per employee']
    ),
    sustainableGrowth: n(
      row['Sustainable growth rate, Annual'] ??
      row['Sustainable growth rate']
    ),
    freeFloatPct: n(row['Free float %']),
    fcfPerEmployee: n(
      row['Free cash flow per employee, Annual'] ??
      row['Free cash flow per employee']
    ),
    fcfAnnUsd: n(row['Free cash flow, Annual']),
    fcfTtmUsd: n(
      row['Free cash flow, Trailing 12 months'] ??
      row['Free cash flow, TTM']
    ),
    totalSharesOutstanding: n(
      row['Total common shares outstanding'] ??
      row['Total common shares outstanding, Quarterly'] ??
      row['Shares outstanding']
    ),
    numEmployees: n(
      row['Number of employees, Annual'] ??
      row['Number of employees']
    ),
    ebitdaPerEmployee: n(
      row['EBITDA per employee, Annual'] ??
      row['EBITDA per employee']
    ),
    // PATCH 0342: FCF per share TTM (NVDIA-style export has this instead
    // of absolute FCF). Wired as a separate signal — positive value is a
    // clean cash-generation signal even without absolute FCF.
    fcfPerShareTtm: n(
      row['Free cash flow per share, Trailing 12 months'] ??
      row['Free cash flow per share, TTM'] ??
      row['Free cash flow per share']
    ),
    roce: n(
      row['Return on capital employed %, Annual'] ??
      row['Return on capital employed %, Trailing 12 months'] ??
      row['Return on capital employed %']
    ),
    // ── Kept for forward compatibility but not standard in TradingView ───────
    insiderOwnership: n(row['Insider ownership, %'] ?? row['Insider ownership %']),
    analystCount:     n(row['Number of analyst estimates'] ?? row['Analysts']),
    forwardRevGrowth: n(row['Forward revenue growth %, FY1'] ?? row['Revenue growth %, next year']),
    // PATCH 0577 — Liquidity intelligence. TradingView CSV usually has Price
    // and either "Average Volume (30 day)" or just "Volume" (daily). When
    // both are present we derive avgDailyValueUsdM in millions; otherwise
    // fall back to the single value we have. Heavy-instituional desks need
    // ADV ≥ $10M before position sizing can be 5%+; this surfaces it.
    price: n(row['Price'] ?? row['Last'] ?? row['Close']),
    avgVolume30d: n(
      row['Average Volume (30 day)'] ??
      row['Average Volume, 30 day'] ??
      row['Avg Volume (30d)'] ??
      row['Volume'] ??  // Single-day fallback; less ideal but better than nothing
      row['Average Volume']
    ),
    avgDailyValueUsdM: (() => {
      const p = n(row['Price'] ?? row['Last'] ?? row['Close']);
      const v = n(
        row['Average Volume (30 day)'] ??
        row['Average Volume, 30 day'] ??
        row['Avg Volume (30d)'] ??
        row['Volume'] ??
        row['Average Volume']
      );
      if (typeof p === 'number' && typeof v === 'number' && p > 0 && v > 0) {
        return Math.round((p * v) / 1e6 * 10) / 10;
      }
      return undefined;
    })(),
    // PATCH 1101qq — New TradingView fields user added in latest export.
    perf3m: n(row['Performance %, 3 months'] ?? row['Performance % 3 months']),
    perf6m: n(row['Performance %, 6 months'] ?? row['Performance % 6 months']),
    epsEstimateAnnual: n(row['Earnings per share estimate, Annual'] ?? row['EPS estimate, Annual']),
    beta5y: n(row['Beta, 5 years'] ?? row['Beta 5y'] ?? row['Beta']),
    ebitdaMargin: n(row['EBITDA margin %, Trailing 12 months'] ?? row['EBITDA margin %, TTM']),
    capexPerShareTtm: n(row['Capital expenditures per share, Trailing 12 months'] ?? row['Capital expenditures per share, TTM']),
    epsGrowthQtr: n(row['Earnings per share diluted growth %, Quarterly YoY'] ?? row['EPS diluted growth %, Quarterly YoY']),
    targetPrice1y: n(row['Target price, 1 year'] ?? row['Target price 1 year'] ?? row['Price target - mean']),
    ema50: n(row['Exponential moving average, 50, 1 day'] ?? row['EMA 50']),
    ema200: n(row['Exponential moving average, 200, 1 day'] ?? row['EMA 200']),
    // zzz138 — EMA 21 is Qullamaggie's EXACT entry rule (not SMA50 proxy).
    ema21: n(row['Exponential moving average, 21, 1 day'] ?? row['EMA 21']),
    // multi-pivot — EMA 89 (deeper trend pullback pivot). Optional; degrades to
    // "unavailable" until the user adds this column to their TradingView export.
    ema89: n(row['Exponential moving average, 89, 1 day'] ?? row['EMA 89']),
    ema100: n(row['Exponential moving average, 100, 1 day'] ?? row['EMA 100'] ?? row['Simple moving average, 100, 1 day'] ?? row['SMA 100']),
    // zzz130 — New technical fields user added to TradingView export for the
    // Technicals tab (Qulla/Zanger/Bonde/Minervini). All optional; the tab
    // gracefully falls back if any are missing.
    perf1w: n(row['Performance %, 1 week'] ?? row['Performance % 1 week']),
    perf1m: n(row['Performance %, 1 month'] ?? row['Performance % 1 month']),
    atr14: n(row['Average true range, 14, 1 day'] ?? row['ATR 14']),
    sma50: n(row['Simple moving average, 50, 1 day'] ?? row['SMA 50']),
    sma150: n(row['Simple moving average, 150, 1 day'] ?? row['SMA 150']),
    sma200: n(row['Simple moving average, 200, 1 day'] ?? row['SMA 200']),
    vol1m: n(row['Volatility, 1 month'] ?? row['Volatility 1M']),
    vol1w: n(row['Volatility, 1 week'] ?? row['Volatility 1W']),
    low52w: n(row['Low, 52 weeks'] ?? row['Low 52w']),
    relVol1w: n(row['Relative volume, 1 week'] ?? row['Relative volume, 10 days'] ?? row['Relative volume']),
    vol1d: n(row['Volume, 1 day'] ?? row['Volume 1d']),
    rsi: n(row['Relative strength index, 14, 1 day'] ?? row['RSI 14']),
    avgVol30d: n(row['Average volume, 30 days'] ?? row['Avg Vol 30d']),
    // zzz140 — Industry (sub-industry, granular vs Sector) enables Industry RS leaderboards
    industry: (typeof row['Industry'] === 'string' && row['Industry']) ? row['Industry'] : undefined,
    high52w: n(row['High, 52 weeks'] ?? row['High 52w']),
    // Derived at parse time
    revenueAccel: (revQtr !== undefined && revAnn !== undefined) ? Math.round(revQtr - revAnn) : undefined,
    accelSignal: (revQtr !== undefined && revAnn !== undefined)
      ? (revQtr - revAnn >= 5 ? 'ACCELERATING' : revQtr - revAnn <= -5 ? 'DECELERATING' : 'STABLE')
      : undefined,
    // Rule of 40 = revenue growth + FCF margin (≥40 = institutional benchmark)
    // PATCH 0346 — R40 uses Quarterly Rev + FCF margin (more current view).
    // Falls back to Annual when Quarterly missing.
    ruleOf40: ((revQtr ?? revAnn) !== undefined && n(row['Free cash flow margin %, Annual']) !== undefined)
      ? Math.round(((revQtr ?? revAnn) as number) + (n(row['Free cash flow margin %, Annual']) as number))
      : undefined,
    // Gross margin expansion = TTM vs Annual (positive = improving pricing power)
    grossMarginExpansion: (() => {
      const ttm = n(row['Gross margin %, TTM'] ?? row['Gross margin %, Trailing 12 months']);
      const ann = n(row['Gross margin %, Annual']);
      return (ttm !== undefined && ann !== undefined) ? Math.round((ttm - ann) * 10) / 10 : undefined;
    })(),
    // PATCH 0341: RUNWAY MONTHS = cash / (annual FCF burn rate, only meaningful when FCF<0)
    runwayMonths: (() => {
      const cash = n(row['Cash and short-term investments, Annual'])
                ?? n(row['Cash and short-term investments, Quarterly']);
      const fcfTtm = n(row['Free cash flow, Trailing 12 months'])
                  ?? n(row['Free cash flow, TTM']);
      const fcfAnn = n(row['Free cash flow, Annual']);
      const fcf = fcfTtm ?? fcfAnn;
      if (cash === undefined || fcf === undefined || fcf >= 0) return undefined;
      const annualBurn = Math.abs(fcf);
      return Math.round(cash / annualBurn * 12); // months of runway at current burn
    })(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// USA RESEARCH CHECKLIST — 28 criteria covering US multibagger framework
// Fisher 100-Bagger + MOSL SQGLP adapted for US growth stocks + Rule of 40
// ═══════════════════════════════════════════════════════════════════════════════
