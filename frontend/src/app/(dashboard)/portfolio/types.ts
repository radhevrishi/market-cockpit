// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

 // zzz526 — symbol → Stock Passport // zzz514

/* ── Types ──────────────────────────────────────────────────────────── */

export interface StockQuote {
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  indexGroup?: string;   // PATCH 1100 — cap bucket (Large/Mid/Small/Micro) from quotes universe
  marketCap?: number;    // PATCH 1100 — est. market cap (₹, may be 0 on weekends)
}

export interface PortfolioHolding {
  symbol: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  addedAt: string;
  notes?: string;
}

export interface Signal {
  symbol: string;
  weightedScore: number;
  action: string; // BUY | ADD | HOLD | TRIM | EXIT | AVOID
  sectorTrend: string; // Bullish | Neutral | Bearish
}

export interface PortfolioRow {
  symbol: string;
  company: string;
  sector: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  cmp: number;
  change: number;
  changePercent: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  dayPnl: number;
  notes?: string;
  score?: number;
  sectorTrend?: string;
  decision?: string;
  cap?: string;          // PATCH 1100 — Large/Mid/Small/Micro
  marketCap?: number;    // PATCH 1100
}

export type SortField = 'symbol' | 'company' | 'sector' | 'entryPrice' | 'quantity' | 'cmp' | 'changePercent' | 'pnlPercent' | 'weight' | 'investedValue' | 'currentValue' | 'score' | 'decision';

export type SortOrder = 'asc' | 'desc';

export interface CashPosition {
  id: string;
  label: string;
  amount: number;
  addedAt: string;
}

export type RegimeBucket = 'FAVORED' | 'NEUTRAL' | 'EXPOSED';
