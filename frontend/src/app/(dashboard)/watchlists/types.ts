// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type EarningsScanCard } from '@/components/EarningsScanCard';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StockQuote {
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  // zzz1000 (CW-01) — null = not given by the quote source (never 0)
  price: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  market?: 'IN' | 'US';      // which quote feed it came from (US bulk list → US; everything else → India)
}

export interface WatchlistItem {
  ticker: string;
  company: string;
  sector: string;
  price: number | null;          // zzz1000 (CW-01) — null = unknown, shown as '—', exported blank
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  market?: 'IN' | 'US';
  marketCap?: number | null; // For weighted averages
  flag?: string | null;      // 🟢 🟠 🔴 or null
  flagStatus?: 'saved' | 'saving' | 'error';   // zzz1044c (F09) — 'error' = last change not saved; flag shown is the saved one
  flagFailed?: string | null;                  // zzz1044c — the flag whose save failed (offered on retry)
  // PATCH 0442 BUG-020 — extra columns
  volume?: number | null;
  week52High?: number | null;
  week52Low?: number | null;
  peRatio?: number | null;
  avgVolume?: number | null;
}

export type SortField = 'ticker' | 'company' | 'sector' | 'price' | 'changePercent' | 'dayHigh' | 'dayLow' | 'flag' | 'volume' | 'week52High' | 'week52Low' | 'marketCap' | 'peRatio';

export type SortOrder = 'asc' | 'desc';

// PATCH 0442 BUG-020/027 — Optional columns the user can toggle on. Persisted
// to localStorage so the choice survives reloads.
export type OptionalCol = 'volume' | 'week52High' | 'week52Low' | 'marketCap' | 'peRatio' | 'avgVolume';

 // 24h

export interface RichCache {
  cards: Record<string, { card: EarningsScanCard; ts: number }>;
}

// PATCH 0539 — Hub-Scan-style filter rail for the rich view.
export type HubFilters = {
  grades: Set<'EXCELLENT' | 'STRONG' | 'GOOD' | 'OK' | 'BAD'>;
  scoreMin: number | null;           // 60 / 75 / 85
  divergenceOnly: boolean;
  dataQuality: Set<'FULL' | 'PARTIAL' | 'PRICE_ONLY'>;
  audience: Set<'PORTFOLIO' | 'WATCHLIST' | 'BOTH' | 'BANK'>;
};

// zzz261 — EI Elite tab. Fetches EXCELLENT+STRONG from Earnings Intelligence
// via /api/market/earnings-scan for the user's Conviction Beats + Watchlist
// tickers. Cached in localStorage 4h TTL. Renders sortable table + export toolbar.
export interface EIEliteRow {
  symbol: string;
  company: string;
  grade: string;
  score?: number;
  pe?: number;
  marketCapCr?: number;
  revenueYoy?: number;
  patYoy?: number;
  epsYoy?: number;
  opmPct?: number;
  guidance?: string;
  price?: number;
  d1_close_pct?: number;
  filed_date?: string;
  period?: string;
  fetched_at?: string;
}
