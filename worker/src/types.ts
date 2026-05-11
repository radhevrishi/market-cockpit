// ─── Canonical event shape ─────────────────────────────────────────────────
// Every adapter normalises its raw payload into this shape before the
// reconciliation engine sees it.  The ingest endpoint consumes this shape.

export interface CanonicalEvent {
  symbol: string;                 // NSE symbol (uppercase, no exchange suffix)
  company: string;                // Display name
  filing_date: string;            // YYYY-MM-DD
  filing_dt_iso?: string | null;  // Full ISO timestamp if known
  quarter?: string;               // 'Q4FY26' (computed from period_ended)
  period_ended?: string;          // 'DD-Mon-YYYY' as provided
  audited?: boolean;
  consolidated?: boolean;
  period_type?: 'Quarterly' | 'Annual' | 'Half-Yearly' | 'Other';
  attachment?: string | null;     // URL to the filing PDF / source page
  source_url?: string;            // Fallback URL when no attachment
  exchange?: 'NSE' | 'BSE' | 'BOTH';
  // Provenance
  source: SourceName;
  source_priority: number;        // 1=primary (NSE/BSE), 2=aggregator, 3=fallback
  scraped_at: string;
  // Cross-source identifiers (used by reconciliation)
  isin?: string;
  bse_code?: string;

  // ─── PATCH 0137: enriched financials (populated by screener adapter) ───────
  // Absolute Cr pairs from the company's quarterly P&L
  sales_curr_cr?: number | null;
  sales_prev_cr?: number | null;
  op_profit_curr_cr?: number | null;
  op_profit_prev_cr?: number | null;
  pat_curr_cr?: number | null;
  pat_prev_cr?: number | null;
  eps_curr?: number | null;
  eps_prev?: number | null;
  // Derived YoY percentages
  sales_yoy_pct?: number | null;
  pat_yoy_pct?: number | null;
  eps_yoy_pct?: number | null;
  op_profit_yoy_pct?: number | null;
  opm_pct?: number | null;
  opm_prev_pct?: number | null;
  // Static / current metadata (from screener stock page)
  sector?: string;
  pe?: number | null;
  market_cap_cr?: number | null;
  market_cap_bucket?: 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO' | null;
  current_price?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  pct_from_52w_high?: number | null;
  // Enrichment provenance
  financials_source?: 'screener' | null;
  financials_scraped_at?: string;
}

export type SourceName = 'nse' | 'bse' | 'trendlyne' | 'tickertape' | 'rss';

export interface SourceAdapter {
  name: SourceName;
  priority: number;
  fetch(opts: FetchOptions): Promise<CanonicalEvent[]>;
}

export interface FetchOptions {
  from: Date;
  to: Date;
  signal?: AbortSignal;
}

export interface RunResult {
  source: SourceName;
  ok: boolean;
  count: number;
  error?: string;
  duration_ms: number;
}
