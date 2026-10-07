// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import type { MoverAttribution } from '@/lib/movers-attribution';

export interface NewsItem { id?: string; title?: string; headline?: string; source?: string; source_name?: string; url?: string; source_url?: string; published_at?: string; importance_score?: number; ticker_symbols?: any[]; }

export interface BottleneckBucket { bucket_id: string; label: string; severity_label?: string; severity_color?: string; severity_icon?: string; article_count?: number; signal_count?: number; key_tickers?: string[]; }

export interface PortfolioHolding { symbol: string; quantity: number; entryPrice: number; }

export interface GradedCard { ticker: string; company: string; composite_score: number; tier: string; filing_date?: string; sector?: string; }

export interface AlertRule { id: string; name: string; enabled: boolean; lastFiredAt?: number; }

export interface TierAction {
  symbol: string; company?: string; score?: number; grade?: string; sector?: string;
  thesis: string; risk: string; horizon: string; trigger: string;
  scoreBreakdown?: Record<string, number>;  // factor → points
  href: string;
  cbConfirmed?: boolean;  // PATCH 0611 — true = on Conviction Beats bench, false = top-up A-grade
  market?: 'IN' | 'US' | string;  // PATCH 0617 — country chip on card
  decisionStatus?: string;  // PATCH 1101r — BUY/WATCH/REJECTED if already in Decision Log
}

export interface ChangedRow {
  symbol: string; company?: string; sector?: string;
  fromState: string; toState: string; delta?: number;
  color: string;
}

export interface HomeState {
  loading: boolean;
  inPlay: NewsItem[];
  // PATCH 1096b — separate older context items so IN-PLAY top stays fresh (<36h)
  // and stale-but-relevant items get a dedicated collapsed "Recent Context" tail.
  inPlayRecent?: NewsItem[];
  inPlayDiag?: { fetched: number; recent: number; clean: number; fellBack: boolean; error?: string; status?: number };  // PATCH 0617/0618 — visible diagnostics including fetch error
  bottleneck: BottleneckBucket[];
  earningsToday: GradedCard[];
  earningsLabel: string;  // 'today' or 'last working day (YYYY-MM-DD)'
  portfolio: PortfolioHolding[];
  alerts: AlertRule[];
  tier1: TierAction[];
  tier2: TierAction[];
  tier3: TierAction[];
  // PATCH 0897 — Dedicated turnaround setups (different playbook than multibagger)
  turnaroundTier1?: TierAction[];
  changedToday: ChangedRow[];
  portfolioBySector: Array<{ sector: string; count: number; tickers: string[]; }>;
  concallHits?: Array<{ ticker: string; company?: string; headline: string; tier?: string; published_at?: string }>;  // PATCH 0617
  // PATCH 0621 — four new live panels
  stratVis?: Array<{ id?: string; title?: string; headline?: string; source_name?: string; source_url?: string; published_at?: string; ticker_symbols?: any[] }>;
  gainers?: Array<{ ticker: string; company?: string; changePercent?: number; price?: number }>;
  losers?: Array<{ ticker: string; company?: string; changePercent?: number; price?: number }>;
  moversUpdatedAt?: string;
  // PATCH 0708 — richer attribution payload (catalyst type, move type,
  // scope, confidence, peer count). Replaces the kind/label/url tuple.
  moversAttrib?: Record<string, MoverAttribution>;
  // PATCH 0624 — extended shape: kind='flow' (live) or 'roster' (static curated holdings)
  signals?: Array<{ id?: string; title?: string; headline?: string; published_at?: string; source_name?: string; primary_ticker?: string; ticker_symbols?: any[]; importance_score?: number }>;
  // PATCH 0800 — Screener fundamentals per ticker, fetched on-demand for top movers
  moverFundamentals?: Record<string, any>;
  // PATCH 0801 — Multi-source news headlines per extreme mover (no LLM)
  moverReasons?: Record<string, { topReason?: any; narrative?: any; allReasons?: any[] }>;
  // PATCH 0622 — institutional enhancements
  portfolioPnl?: { totalPct: number; totalChangeRs: number; bestMover?: { ticker: string; pct: number }; worstMover?: { ticker: string; pct: number }; positions: number; covered: number };
  watchlistPulse?: Array<{ ticker: string; company?: string; changePercent: number; price?: number; reason?: string; cap?: string; attrib?: MoverAttribution }>;
  upcomingEarnings?: Array<{ ticker: string; company?: string; resultDate: string; sector?: string; daysAhead: number; onCb: boolean; onWatchlist: boolean }>;
  sectorRotation?: { topSector?: { sector: string; pct: number }; bottomSector?: { sector: string; pct: number } };
  // PATCH 0905 — Full sector pulse list for the mini heatmap on home.
  // Aggregated from the same /api/market/quotes call that already
  // powers Movers + Watchlist Pulse. Each entry carries avg pct, sample
  // size, and a list of the top 2 tickers contributing to the move.
  sectorPulse?: Array<{ sector: string; pct: number; count: number; topGainer?: { ticker: string; pct: number }; topLoser?: { ticker: string; pct: number } }>;
  // PATCH 0905 — Conviction Beats with live price overlay. User said
  // "keep conviction bets in watchlist also here in home screen i use
  // that more" — so we surface the bench inline instead of forcing a
  // /watchlists round-trip every morning.
  convictionLive?: Array<{ ticker: string; company?: string; tier?: string; sector?: string; price?: number; changePercent?: number; cap?: string; addedAt?: string; filingDate?: string }>;
  ratingActionsToday?: Array<{ ticker?: string; headline: string; agency?: string; action?: string; source_name?: string; url?: string }>;
  orderBookToday?: Array<{ ticker?: string; headline: string; customer?: string; valueCr?: number; source_name?: string; url?: string }>;
  alphaFeedback?: { sample: number; avgScoreNow: number; avgScoreBefore: number; held: number };
  staleDataAgeDays?: number;  // days since most recent multibagger upload
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 1104 — DAILY SIGNAL INBOX (⭐)
//
// One glanceable inbox of what's actionable RIGHT NOW, aggregated across the
// intelligence feeds the terminal already runs — so the user doesn't have to
// open five tabs to find the day's live setups. Three reliable lanes:
//   • Momentum   — new entries + big score-jumps in the concall top-30 (movers)
//   • Warrant    — promoter-warrant / breakout setups that just qualified
//   • Transform  — early-inflection multibaggers from the batch radar (sweet spot)
// Each row deep-links to the source tab. Pure client-side reads of existing
// endpoints; degrades gracefully if any feed is cold.
// ═══════════════════════════════════════════════════════════════════════════
export interface InboxSignal {
  lane: 'MOMENTUM' | 'WARRANT' | 'TRANSFORM' | 'BENCH';
  symbol: string;
  company: string;
  headline: string;
  detail: string;
  score: number;        // for sorting within lane
  href: string;
  soft?: boolean;       // zzz435 — a "watch"/fallback item, not a fired event
  hColor?: string;      // zzz452 — headline colour override (e.g. transform stance)
  note?: string;        // zzz452 — hover tooltip with the full plain-English read
  quote?: string;       // zzz464 — inline proof snippet shown on the card (verifiability)
}

export type LaneKey = 'momentum' | 'warrant' | 'transform' | 'bench';

// zzz445 — QUALITY PULLBACKS. Great-earnings names (the institutional quality
// preset) that are now DOWN the most from their 52-week high — i.e. the rule
// "buy great earnings picks on the pullback." Everything is read from the
// Conviction Bench, which already carries every preset field + the 52w-high
// distance, so this is a pure client-side derivation, no new fetch.
export interface InboxPullback {
  symbol: string; company: string; tier: string;
  correction: number;               // % below its 52-week high (positive number)
  basis: '52w high' | 'since filing';
  sales?: number | null; pat?: number | null; pead?: number | null; mcap?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 1105 — PIPELINE HEALTH
//
// One row per data feed showing how fresh it is, so a stale scraper or a cold
// cache is visible immediately instead of silently serving old data behind the
// dashboards. Reads each feed's own timestamp (generated_at / updatedAt /
// lastSync) and colour-codes by age. Collapsed by default — it's an ops panel,
// not a daily-driver. Pure client-side; a feed that errors shows as DOWN.
// ═══════════════════════════════════════════════════════════════════════════
export interface FeedHealth {
  key: string;
  label: string;
  ts: number | null;        // epoch ms of last update, null = unknown/down
  status: 'FRESH' | 'AGING' | 'STALE' | 'DOWN';
  note: string;
  freshH: number;           // hours under which = FRESH
  ageH: number;             // hours under which = AGING (else STALE)
}
