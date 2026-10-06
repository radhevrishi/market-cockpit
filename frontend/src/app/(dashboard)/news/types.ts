// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NewsArticle {
  id: string;
  headline: string;
  title: string;
  source_name: string;
  source: string;
  source_url: string;
  url: string;
  published_at: string;
  ingested_at?: string;
  importance_score: number;
  tickers: Array<{ ticker: string; exchange: string; confidence?: number } | string>;
  ticker_symbols: string[];
  region: string;
  article_type: string;
  summary?: string;
  sentiment?: string;
  themes?: string[];
  investment_tier?: number;
  relevance_tags?: string[];
  impact_statement?: string;
  bottleneck_sub_tag?: string;
  bottleneck_level?: string;
  is_synthetic?: boolean;
  structural_status?: string;
  feed_layer?: string;
  // PATCH 0455 CLEANUP-1 — Pre-annotation fields stamped by the server-side
  // pipeline (event-detectors / source-quality / canonical clustering).
  // Promoted from `(article as any).__*` so type-checking catches misuse.
  __priority?: number;
  __priorityParts?: Record<string, number>;
  __sourceWeight?: number;
  __isListicle?: boolean;
  __isSpeculation?: boolean;
  __clusterSize?: number;
  __clusterSources?: string[];
  __clusterTimes?: number[];
  __confidence?: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  __creditStress?: any;
  __promoter?: any;
  __workingCapital?: any;
  __orderQuality?: any;
  __noise?: { isListicle: boolean; isSpeculation: boolean; qualityMultiplier: number };
  __expectation?: any;
  // Book/bench-aware priority boost — stamped when the article touches a name
  // the user holds / benches / watches (see BOOK_PRIORITY_BOOST).
  __inBook?: boolean;
  __bookMatch?: string;
}
// Bottleneck dashboard types
export interface BnSignalArticle {
  id: string;
  headline: string;
  source_name: string;
  source_url: string;
  published_at: string;
  importance_score: number;
  sentiment: string;
}
export interface BnSignal {
  headline: string;
  summary: string;
  evidence_count: number;
  sources: string[];
  latest_at: string;
  tickers: string[];
  articles: BnSignalArticle[];
}
export interface BnBucket {
  bucket_id: string;
  label: string;
  description: string;
  severity: number;
  severity_label: string;
  severity_color: string;
  severity_icon: string;
  signal_count: number;
  article_count: number;
  key_tickers: string[];
  signals: BnSignal[];
}
export interface BnDashboard {
  success: boolean;
  total_articles: number;
  buckets: BnBucket[];
}
// Layer classification for institutional hierarchy
export type FeedLayer = 'MACRO_REGIME' | 'STRUCTURAL' | 'COMPANY_ALPHA' | 'GENERAL';
// ── Phase 1.5: Forward Calendar ─────────────────────────────────────
export interface CalendarEvent {
  date: string;
  type: string;
  region: string;
  title: string;
  ticker?: string;
  importance: 'high' | 'medium';
}
// ── Phase 2.5: Anomaly detector ──────────────────────────────────────
// PATCH 0050: enriched response includes themes_v2 / tickers_v2 with
// display names + why_it_matters explanations.
export type AnomalySignal = {
  display_name: string;
  count: number;
  baseline_count: number;
  deviation: 'EMERGING' | 'ESCALATING' | 'DOMINANT';
  why_it_matters: string;
};
export type AnomalyResponse = {
  tickers: [string, number][];
  themes: [string, number][];
  section_title?: string;
  section_subtitle?: string;
  themes_v2?: AnomalySignal[];
  tickers_v2?: AnomalySignal[];
};
// PATCH 0068: 6-month Transformational Contracts ledger — for the
// main-news preview band. Shows top 6 by rank.
export interface TransformationalPreviewItem {
  id: string;
  title: string;
  source_name: string;
  source_url: string;
  published_at: string;
  region: string;
  ticker_symbols?: string[];
  primary_ticker?: string | null;
  strategic_visibility: {
    qualifies: boolean;
    theme: string;
    counterparty_tier: string;
    counterparty_name?: string;
    contract_value_usd_m?: number;
    visibility_years?: number;
    flags: string[];
    reason: string;
  };
  sv_signal_quality_tier?: string | null;
  sv_dependency_score?: number | null;
}
export interface TransformationalPreviewResp {
  count: number;
  total_in_ledger?: number;
  window_days?: number;
  summary?: { newest_recorded_at?: string | null };
  articles: TransformationalPreviewItem[];
}
// PATCH 0079 + 0080: Persistent Bottleneck Reading hook
export interface PersistentBottleneckSample {
  article_id: string;
  title: string;
  source: string;
  tier: string;
  recorded_at?: string;
}
// PATCH 0081 + 0082: architectural beneficiary entry with institutional dims
export interface AdaptationBeneficiary {
  ticker: string;
  score: number;
  sample_count: number;
  // PATCH 0082
  exposure_intensity?: 'DIRECT' | 'STRONG' | 'MEDIUM' | 'INDIRECT' | 'STRATEGIC';
  exposure_score?: number;
  economic_capture?: 'MASSIVE' | 'HIGH' | 'MODERATE' | 'MARGINAL' | 'STRATEGIC_ONLY';
  capture_score?: number;
  size_class?: 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP';
  rationale?: string;
  composite_score?: number;
}
export interface StructuralLoserItem {
  ticker: string;
  rationale: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}
export interface ArchitecturalAdaptation {
  adaptation: string;
  label: string;
  rationale: string;
  duration?: 'MULTI_YEAR_STRUCTURAL' | 'SECULAR' | 'CYCLICAL' | 'POLICY_SENSITIVE' | 'TRADING';
  beneficiaries: AdaptationBeneficiary[];
  structural_losers?: StructuralLoserItem[];
}
// PATCH 0085: 6-layer beneficiary engine on the persistent-bottleneck panel
export interface LayerTickerLite {
  ticker: string;
  rationale: string;
  pricing_leverage: 'STRONG' | 'MEDIUM' | 'WEAK';
  size: 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP';
  mandatory?: boolean;
  sub_layer?: 'GPU_SUB' | 'CPU_CYCLE';   // PATCH 0087 — only meaningful for L2
}
export interface LayeredBeneficiariesLite {
  bottleneck: string;
  bottleneck_label: string;
  fired_layers: string[];
  layers: Record<string, LayerTickerLite[]>;
  transmission: { T0: string; T1: string; T2: string; T3: string; T4: string };
}
export interface PersistentBottleneckItem {
  node: string;
  label?: string;        // PATCH 0080: rich label
  sub?: string;          // PATCH 0080: context line
  confidence_pct: number;
  cumulative_score: number;
  sample_count: number;
  last_seen: string;
  age_days: number;
  trend: 'rising' | 'steady' | 'falling' | 'cooling';
  is_structural: boolean;
  top_samples: PersistentBottleneckSample[];
  best_specialist_sample?: PersistentBottleneckSample | null;  // PATCH 0080
  architectural_adaptations?: ArchitecturalAdaptation[];        // PATCH 0081
  layered_beneficiaries?: LayeredBeneficiariesLite;             // PATCH 0085
  region?: 'IN' | 'GLOBAL';                                     // PATCH 0086
  first_seen?: string;                                          // PATCH 0088
  first_seen_age_days?: number;                                 // PATCH 0088
  is_latest?: boolean;                                          // PATCH 0088 — first_seen_age_days <= 10
}
export interface PersistentBottlenecksResp {
  section_title: string;
  section_subtitle: string;
  count: number;
  items: PersistentBottleneckItem[];
  last_updated?: string;                                        // PATCH 0086 — server-side ISO timestamp for liveness pill
}
// ── Drilldown knowledge base ─────────────────────────────────────────────────
// Maps bottleneck sub-tags to institutional narrative: why it's a bottleneck,
// supply vs demand dynamics, and listed company winners/losers.

export type DrilldownEntry = {
  label: string;
  icon: string;
  why: string;
  supply: string;
  demand: string;
  winners: Array<{ ticker: string; thesis: string }>;
  losers: Array<{ ticker: string; thesis: string }>;
};
// ── Page ──────────────────────────────────────────────────────────────────────

// PATCH 0225 — Named Saved Views.
// Sits on top of Patch 0218 (URL-persistent filter state). The full URL
// query string IS the view; we just give the user a way to name it and
// jump back via localStorage. No backend, no schema migration.
export interface SavedView { id: string; name: string; query: string; createdAt: number; }
