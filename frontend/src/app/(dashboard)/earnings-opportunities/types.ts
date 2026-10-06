// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import type { EarningsQuadrant } from '@/lib/earnings-grade-shared';

// ─── Calendar payload types ────────────────────────────────────────────────
export interface CalendarItem {
  symbol: string;
  company: string;
  filing_date: string;
  filing_dt_iso?: string | null;
  quarter?: string;
  period_ended?: string;
  audited?: boolean;
  consolidated?: boolean;
  attachment?: string | null;
  source_url?: string;
  exchange?: string;
}

export interface CalendarPayload {
  scraped_at?: string;
  total: number;
  by_date: Record<string, CalendarItem[]>;
  ingested_dates?: string[];
  empty_reason?: string;
}

// PATCH 0152 — switch to the Earnings Hub canonical source.
// /api/market/earnings is the SAME endpoint Earnings Hub Calendar uses (NSE
// Financial Results API + BSE proxy with quality rating). Each result has
// ticker + resultDate + quality. We join this with the worker's v1 calendar
// (which holds Screener+Yahoo enrichment) by ticker → enriched grading.
export type MarketEarningsResult = {
  ticker: string;
  company: string;
  resultDate: string;
  quarter: string;
  quality: 'Excellent' | 'Great' | 'Good' | 'OK' | 'Weak' | 'Upcoming' | 'Preview';
  sector?: string;
  industry?: string;
  marketCap?: string;
  edp?: number | null;
  cmp?: number | null;
  priceMove?: number | null;
  timing?: string;
  source?: string;
};

export type MarketEarningsResponse = {
  results: MarketEarningsResult[];
  summary?: { total: number; excellent?: number; great?: number; good?: number; ok?: number; weak?: number; upcoming?: number };
  quarter?: string;
  source?: string;
  updatedAt?: string;
  ingested_dates?: string[];
};

export type EarningsTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

export interface ParsedEarning {
  ticker: string;
  company: string;
  sector?: string;
  filing_date: string;
  quarter: string;
  market_cap_bucket?: string;
  market_cap_cr?: number | null;
  pe?: number | null;
  price?: number | null;
  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  sales_curr_cr: number | null;
  sales_prev_cr: number | null;
  pat_curr_cr: number | null;
  pat_prev_cr: number | null;
  eps_curr: number | null;
  eps_prev: number | null;
  adtv_cr?: number | null;  // PATCH 1034 — liquidity (median ₹Cr/day)
  // PATCH 0150 — price / RS / stage overlay
  gap_pct: number | null;
  d1_pct: number | null;
  move_pct: number | null;
  rs_rating: number | null;
  stage: 1 | 2 | 3 | 4 | null;
  pct_from_52w_high: number | null;
  composite_score: number;
  tier: EarningsTier;
  methodology_tags: string[];
  caveat_tags: string[];
  narrative: string;
  filing_url?: string;
  source: string;
  // ── QUALITY × INFLECTION — the second axis (see @/lib/earnings-grade-shared).
  // Absolute quality and rate of change are different questions and one tier
  // cannot answer both, so every row carries BOTH scores plus the quadrant they
  // define. All optional: a preview-shape card (a filing with no financials yet)
  // has no basis for either score and carries none — the card then renders
  // nothing, never a zero or a placeholder.
  quality_score?: number | null;
  inflection_score?: number | null;
  quadrant?: EarningsQuadrant | null;
  quadrant_parts?: {
    quality: Array<{ label: string; points: number; of: number }>;
    inflection: Array<{ label: string; points: number; of: number }>;
  } | null;
  /** Screener's ROCE % — the strongest quality input, shown on the card. */
  roce?: number | null;
  // zzz694 — the operating margin and the cash ratio were both being read off
  // the row with `as any` because neither was declared here, which is how the
  // cash figure ended up decided the tier while appearing nowhere on the card.
  // The payload has always carried them; only the type was silent.
  opm_pct?: number | null;
  opm_prev_pct?: number | null;
  /** Operating cash flow over reported profit, annual. Below 0.6 raises 'ocf
   *  divergence'; below zero caps the tier at MIXED unconditionally. */
  ocf_to_pat_ratio?: number | null;
  cfo_to_pat_ratio?: number | null;
}

export interface OpportunitiesPayload {
  filing_date: string | null;
  candidates_total: number;
  raw_items_total: number;
  by_tier: Record<EarningsTier, ParsedEarning[]>;
  generated_at: string;
  sources_polled: number;
}

export type ViewMode = 'CALENDAR' | 'GRADED';
