import type { RadarEvidenceRecord } from '@/lib/concall-evidence-ledger';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

// zzz432 — automatic multibagger transformation radar block
export interface TransformationRadarData {
  patterns: Array<{ key: string; label: string; emoji: string; hits: number }>;
  events: Array<{ kw: string; hits: number }>;
  evidence_score: number;
  evidence_label: string;
  evidence_quote?: string;      // zzz462 — exact proof sentence
  evidence_breadth?: number;    // zzz462 — distinct proof rungs fired
  caution_level?: number;       // zzz467 — 0 none / 1 mixed / 2 cautious
  caution_flags?: string[];     // zzz467 — the negatives found
  stage: number;
  stage_sweet_spot: boolean;
  velocity: string;
  pattern_count: number;
  triple: { industry: boolean; company: boolean; financial: boolean; count: number };
}

export interface Analysis {
  ticker: string;
  length: number;
  tone: { score: number; pos: number; neg: number; defensive: number; label: string };
  guidance: Array<{ kind: string; pct: string | null; snippet: string }>;
  numbers:  Array<{ metric: string; value: string; snippet: string }>;
  themes:   Array<{ theme: string; mentions: number }>;
  red_flags: string[];
  transformation?: TransformationRadarData;
  generated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0387 — LIVE BULLISH FEED (auto-poll NSE/BSE)
// ═══════════════════════════════════════════════════════════════════════════

export interface EvidenceSentence {
  text: string;
  tag: string;
  polarity: 'BULL' | 'BEAR';
  negated: boolean;
}

// PATCH 0401 — sector overlay payload
export interface SectorOverlayResult {
  sector: string;
  sector_confidence: number;
  overlay_score: number;
  positive_signals: string[];
  negative_signals: string[];
  positive_evidence: Array<{ tag: string; sentence: string }>;
  negative_evidence: Array<{ tag: string; sentence: string }>;
}

export interface LiveFeedFiling {
  exchange: 'NSE' | 'BSE';
  symbol: string;
  company_name: string;
  subject: string;
  filing_datetime: string;
  attachment_urls: string[];
  source_url: string;
  filing_type: string;
  bullish: {
    score: number;
    raw_score: number;
    sentiment: string;
    tier?: 'ULTRA_BULLISH' | 'BULLISH' | 'MIXED_POSITIVE' | 'NEUTRAL' | 'BEARISH' | 'INSUFFICIENT' | 'DATA_PENDING';  // PATCH 0391+0397
    confidence: string;
    tags: string[];
    bullish_phrases: string[];
    red_flags: string[];
    fatal_blockers?: string[];        // PATCH 0391
    components: {
      management_confidence: number;
      business_evidence: number;
      positive_score?: number;
      blockers: number;
      blocker_severity_low?: number;
      blocker_severity_medium?: number;
      blocker_severity_fatal?: number;
    };
    evidence?: EvidenceSentence[];     // PATCH 0389
  };
  is_high_bullish: boolean;
  // PATCH 0388
  scored_from?: 'PDF' | 'SUBJECT';
  pdf_pages?: number;
  pdf_failure_reason?: string;
  // PATCH 0401
  sector_overlay?: SectorOverlayResult;
}

// zzz810 — the feed's honest status, built server-side (lib/concall-feed).
// FAILED = we could not fetch NSE/BSE (never shown as "no filings");
// EMPTY = the exchanges answered and nothing concall-related was filed;
// PARTIAL = one exchange answered; OK = real counts.
export interface FeedStatusLite {
  state: 'OK' | 'PARTIAL' | 'EMPTY' | 'FAILED';
  message: string;
  reason?: string;
  nse?: 'OK' | 'EMPTY' | 'BLOCKED'; bse?: 'OK' | 'EMPTY' | 'BLOCKED';   // zzz1212
  last_success_at: string | null;
  announcements_total: number;
  concall_filings: number;
  transcripts: number;
  window_days: number;
  retrying: boolean;
}

export interface LiveFeedPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_high_bullish: number;
  filings: LiveFeedFiling[];
  sources: { nse: string; bse: string };
  fetch_status?: FeedStatusLite;
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0390 — WARRANT MOMENTUM INTELLIGENCE
// Separate intelligence lane. Warrants are slow-moving structural signals
// vs concall's short-term narrative — different alpha category.
// ═══════════════════════════════════════════════════════════════════════════

export interface WarrantFiling {
  exchange: 'NSE' | 'BSE';
  symbol: string;
  company_name: string;
  subject: string;
  filing_datetime: string;
  attachment_urls: string[];
  source_url: string;
  warrant_type: string;
  details: {
    issue_price: number | null;
    warrant_count: number | null;
    conversion_period_months: number | null;
    promoter_participation_pct: number | null;
    total_size_cr: number | null;
    is_promoter_subscribed: boolean;
  };
  price: { cmp: number | null; perf_90d_pct: number | null; perf_52w_high_pct: number | null };
  conviction: {
    conviction: number;
    raw_score: number;
    passes_gate: boolean;
    signals: string[];
    red_flags: string[];
    components: {
      promoter_participation: number;
      pricing_premium: number;
      business_momentum: number;
      breakout_relative_strength: number;
      history_boost: number;
      governance_penalty: number;
    };
    premium_pct: number | null;
    history_summary?: string;
  };
  business_momentum_score: number | null;
  prior_warrants: Array<{ date: string; price_at_filing: number | null; current_perf_pct: number | null }>;
}

export interface WarrantFeedPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_passing: number;
  filings: WarrantFiling[];
  sources: { nse: string; bse: string };
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0394 — KEYWORD WATCH FEED (third intelligence lane)
// User-defined keyword/phrase watchlist scanning all concall PDFs.
// ═══════════════════════════════════════════════════════════════════════════

export interface KeywordSpec {
  id: string; display: string; group: string; sentiment: string;
}

export interface KeywordHit {
  keyword_id: string; display: string; group: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  sentence: string;
}

export interface KwWatchFiling {
  exchange: 'NSE' | 'BSE';
  symbol: string;
  company_name: string;
  subject: string;
  filing_datetime: string;
  attachment_urls: string[];
  source_url: string;
  filing_type: string;
  hits: KeywordHit[];
  hit_keywords: string[];
  hit_groups: string[];
  hit_count: number;
}

export interface KwWatchPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_matched: number;
  filings: KwWatchFiling[];
  totals: {
    total_hits: number;
    by_group: Record<string, number>;
    by_sentiment: Record<string, number>;
  };
  sources: { nse: string; bse: string };
  catalog: KeywordSpec[];
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0400 — MOVERS PANEL (daily delta detection)
// ═══════════════════════════════════════════════════════════════════════════

export interface MoverEntry {
  symbol: string;
  company_name: string;
  tier: string;
  composite_today: number;
  composite_yesterday: number | null;
  delta: number | null;
  rank_today: number;
  rank_yesterday: number | null;
}

export interface MoversPayload {
  generated_at: string;
  today_date: string;
  reference_date: string | null;
  new_entries: MoverEntry[];
  big_jumps: MoverEntry[];
  lost_momentum: MoverEntry[];
  ranking_today: MoverEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CONCALL BOTTLENECK PANEL — PATCH 0597
//
// Pulls the same /news/bottleneck-dashboard payload that powers the
// /bottleneck-intel and /bottleneck-workbench pages and renders a
// compact severity-sorted strip inside the Concall Intelligence Analytics
// tab. User feedback: "same ke botlenecks from the other concallintelligence
// should be taken also to analytics" — surface the cross-app bottleneck
// data here so the analyst doesn't have to navigate away.
// ═══════════════════════════════════════════════════════════════════════════

export interface CiBottleneckBucket {
  bucket_id: string;
  label: string;
  description?: string;
  severity?: number;
  severity_label?: string;
  severity_color?: string;
  severity_icon?: string;
  signal_count?: number;
  article_count?: number;
  key_tickers?: string[];
}

export interface CiBottleneckDashboard {
  buckets: CiBottleneckBucket[];
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz433 — TRANSFORMATION SCREENER TAB (🔭 Radar)
//
// Consumes GET /api/v1/concall-intel/transformation-screener, which runs the
// same deterministic radar the single-paste flow runs — but over EVERY concall
// in the live feed. Presents a ranked leaderboard so the terminal auto-surfaces
// early-inflection multibaggers without the user pasting anything.
// ═══════════════════════════════════════════════════════════════════════════
export interface TransformScreenEntry {
  symbol: string; company_name: string; exchange: string; subject: string;
  filing_datetime: string; source_url: string; attachment_url: string | null;
  bullish_tier: string;
  transformation_score: number; pattern_count: number;
  patterns: Array<{ key: string; label: string; emoji: string; hits: number }>;
  evidence_score: number; evidence_label: string; evidence_quote?: string; evidence_breadth?: number; caution_level?: number; caution_flags?: string[];
  stage: number; stage_sweet_spot: boolean; velocity: string;
  triple: { industry: boolean; company: boolean; financial: boolean; count: number };
  top_events: string[]; scored_from: 'PDF' | 'SUBJECT';
  evidence_record?: RadarEvidenceRecord; // optional for older cached scans
  doc_class?: string; doc_label?: string; doc_confidence?: 'HIGH' | 'MEDIUM' | 'LOW';   // zzz1212 — what the document really is
  // zzz1214 — who said it, document tone, market data checks
  tone?: string; tone_pos?: number; tone_neg?: number; tier_source?: 'feed' | 'document';
  quote_role?: 'MANAGEMENT' | 'ANALYST' | 'COMPANY' | 'UNKNOWN'; quote_speaker?: string | null;
  speakers_parsed?: boolean; analyst_share?: number | null;
  market_cap_cr?: number | null;
  facts?: import('@/lib/radar-insight').RadarFacts;
  insight?: import('@/lib/radar-insight').RadarInsight;
}

export interface ScannedNoSignal {
  symbol: string; company_name: string; subject: string; filing_datetime: string;
  source_url: string; attachment_url: string | null; bullish_tier: string; scored_from: 'PDF' | 'SUBJECT';
  doc_class?: string; doc_label?: string;
}

/** zzz1212 — a filing the radar did not score, with the honest reason */
export interface RadarExcludedLite {
  symbol: string; company_name: string; subject: string; filing_datetime: string; attachment_url: string | null;
  doc_class: string; label: string; reason: string; basis: 'SUBJECT' | 'CONTENT'; link?: string;
}
export interface RadarFunnelLite {
  announcements_total: number | null; feed_rows: number;
  routine: { meeting_schedule: number; call_invite: number; recording_link: number; admin_notice: number; no_attachment: number };
  out_of_scope: number; eligible: number; examined: number; read_full: number; cover_only: number; unreadable: number;
  not_yet_read: number; with_signal: number; fresh_reads: number;
}

export interface TransformScreenPayload {
  generated_at: string; window_days: number; analyzed: number; pdf_cache_hits: number;
  candidates_total: number; entries: TransformScreenEntry[]; scanned_no_signal?: ScannedNoSignal[]; error?: string;
  building?: boolean; message?: string; // async radar refresh: not an empty research result
  feed_status?: FeedStatusLite | null; concalls_in_feed?: number; transcripts_in_feed?: number;   // zzz810
  funnel?: RadarFunnelLite; coverage_note?: string; excluded?: RadarExcludedLite[]; excluded_counts?: Record<string, number>;   // zzz1212
}
