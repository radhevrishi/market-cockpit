// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { TABS } from './constants';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BnSignalArticle {
  id: string; headline: string; source_name: string;
  source_url: string; published_at: string; importance_score: number; sentiment: string;
}
export interface BnSignal {
  headline: string; summary: string; evidence_count: number;
  sources: string[]; latest_at: string; tickers: string[]; articles: BnSignalArticle[];
}
export interface BnBucket {
  bucket_id: string; label: string; description: string;
  severity: number; severity_label: string; severity_color: string; severity_icon: string;
  signal_count: number; article_count: number; key_tickers: string[]; signals: BnSignal[];
}
export interface BnDashboard { success: boolean; total_articles: number; buckets: BnBucket[]; }
export interface NewsArticle {
  id: string; headline: string; title: string; source_name: string;
  source: string; source_url: string; url: string; published_at: string;
  tickers: Array<{ ticker: string; exchange: string; confidence?: number } | string>;
  ticker_symbols: string[]; region: string; article_type: string; importance_score: number;
  bottleneck_sub_tag?: string; bottleneck_level?: string; sentiment?: string; summary?: string;
}
export interface QuoteStock { ticker: string; company: string; price: number; changePercent: number; marketCap: number; sector?: string; }
export type Tab = typeof TABS[number];
// ── Hierarchical Taxonomy — prevents overlap across adjacent power/cooling buckets ──────
// Parent themes group related buckets so overlapping evidence is properly attributed.
export interface ThemeParent {
  id: string; label: string; icon: string; color: string;
  children: string[]; // bucket_ids + emerging theme ids
  overlap_note: string; // why these could overlap
}
export interface BucketSnapshot { id: string; severity: number; signal_count: number; week: number; timestamp: number }
export type BucketLifecycleState = 'ACCELERATING' | 'ACTIVE' | 'STRUCTURAL' | 'FADING' | 'STALE';
// ── Drilldown knowledge base ──────────────────────────────────────────────────

export interface IndiaPick { ticker: string; exchange: 'NSE'|'BSE'; thesis: string; }
// Qualification stages per Serenity framework: tracks where each company is in customer adoption
export type QualStage = 'PRE_QUAL' | 'DESIGN_WIN' | 'QUALIFICATION' | 'RAMP' | 'VOLUME' | 'UNKNOWN';
export interface Chokepoint {
  ticker: string; name: string; exchange: string;
  monopoly_basis: string;     // why this is the chokepoint
  public_competitors: number; // global public competitors
  customers: string[];        // confirmed hyperscaler/OEM customers
  qual_stage: QualStage;
  evidence_types: string[];   // ['earnings_transcript','sec_filing','conference_pdf','ir_page','news']
  tier: number;               // supply chain tier (1-10)
}
export interface CoverageMap {
  confirmed_public: string[];  // named public companies with confirmed exposure
  known_private: string[];     // private companies in supply chain (not investable)
  likely_missing: string[];    // probable gaps — research candidates
  uncovered_nodes: string[];   // chain links with no confirmed company
}
export type EvidenceType = 'earnings' | 'sec_filing' | 'conference_pdf' | 'wayback' | 'ir_page' | 'news_article' | 'startup_deck';
export interface DrilldownEntry {
  label: string; icon: string; why: string; supply: string; demand: string;
  lifecycle: 'structural' | 'cyclical';
  winners: { ticker: string; thesis: string }[];
  losers:  { ticker: string; thesis: string }[];
  confirms:  string[];
  breaks:    string[];
  contradictions: string[];
  watch_kpi: string[];
  causal_chain: string[];
  india_plays: IndiaPick[];
  // ── Serenity P1: Chokepoint Intelligence ────────────────────────────────
  chokepoints: Chokepoint[];         // exact public companies at the chokepoint
  coverage: CoverageMap;             // known / private / missing / uncovered
  evidence_types: EvidenceType[];    // what source types confirm this theme
  theme_family?: string;             // related themes (for overlap detection)
}
// ── Conference calendar ───────────────────────────────────────────────────────

export interface Conference {
  name: string; date: string; theme: string; relevance: string;
  tags: string[]; url?: string;
}
// ── Serenity Universe — curated from framework document ──────────────────────
// These are the stocks Serenity explicitly covers or would look at per her framework.
// The scanner shows these + enriches with live news evidence + live prices.

export interface UniverseStock {
  ticker: string;
  name: string;
  exchange: string;      // NYSE | NASDAQ | STO | TSE | KRX | TWO | FRA | OTC
  sub_tag: string;
  val_tier: number;      // 1 = raw materials (most upstream / most asymmetric)
  competitors: string;   // "1 public" | "2–3 public" | "3–5 public" | ">5 public"
  key_customers: string[]; // who they supply → ultimately hyperscalers
  serenity_note: string;
  is_serenity_pick: boolean; // explicitly mentioned by Serenity
  models: number[];
}
export interface EnrichedStock extends UniverseStock {
  evidence_count: number;
  headlines: string[];
  latest_at?: string;
  price?: number;
  market_cap?: number;
  change_pct?: number;
  quote_name?: string;
  is_small_cap: boolean;
  is_non_us: boolean;
  score: number;
  velocity: { week: number; prev: number; trend: '🔥' | '📉' | '→'; isNew: boolean; accel: number };
}
export interface DetectedTheme {
  id: string; label: string; icon: string; color: string;
  count: number; weekCount: number; headlines: string[];
  isNew: boolean; // true if NOT already in existing 9 buckets
}
