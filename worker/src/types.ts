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
