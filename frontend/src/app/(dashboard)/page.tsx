'use client';

// ═══════════════════════════════════════════════════════════════════════════
// HOME DASHBOARD v2 — PATCH 0605
//
// Evolution of Patch 0602 per user feedback (institutional roadmap):
//   "Stop being information-rich. Become decision-efficient."
//
// New structure — hierarchical Decision Stack with risk framing:
//
//   TIER 1 — IMMEDIATE ACTION      (cross-confirmed, with Thesis/Risk/Trigger)
//   TIER 2 — STRUCTURAL WATCHLIST  (bottleneck themes + A-grade not on bench)
//   TIER 3 — EXPERIMENTAL          (low-conf themes, collapsed by default)
//
//   📊 WHAT CHANGED TODAY    (score deltas, state transitions)
//   💼 PORTFOLIO EXPOSURE HEAT  (sector breakdown of holdings)
//   🏗 AI INFRASTRUCTURE TRANSMISSION  (compact cascade map)
//   📅 EARNINGS TODAY
//   🔥 IN-PLAY NEWS (collapsed by default)
//   QUICK ACCESS GRID (collapsed by default)
//
// What this dashboard does NOT have yet (genuinely needs infrastructure):
//   - Market-implied validation (RS / volume / earnings revisions) — needs data feed
//   - Realized-alpha feedback loop — needs Postgres
//   - Crowding indicators / institutional ownership changes — needs data feed
// Those are flagged honestly in the disclosure block at the bottom.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
// PATCH 1101p — Re-score restored multibagger rows on home page. The /multibagger
// page re-scores on every load (initializer line 5024) so its display reflects
// the latest scoring formula. The home page was reading the raw localStorage
// data without re-scoring, so it showed STALE grades — only stocks that were
// A-grade BEFORE the recent 1101a-h scoring changes appeared in Tier 1, hence
// the user seeing 2 names instead of 10.
import { scoreExcelRow as mbScoreIndia, applyForcedRanking as mbApplyRanking } from '@/lib/multibagger-india-scoring';
import type { ExcelRow as MbIndiaRow } from '@/lib/multibagger-india-scoring';
// PATCH 0708 — institutional event-attribution engine for the Top Movers panel.
import {
  attributeMovers,
  CATALYST_GLYPH,
  CONFIDENCE_COLOR,
  MOVE_TYPE_LABEL,
  moverTier,
  anomalyTag,
  ANOMALY_COLOR,
  cleanMoverLabel,
  type MoverAttribution,
} from '@/lib/movers-attribution';
import {
  scoreCatalyst,
  // PATCH 0820 — BUCKET_LABEL/BUCKET_COLOR removed; now use mq.bucketLabel from move-quality.ts
} from '@/lib/catalyst-scoring';
// PATCH 0805 — Move Quality + Continuation Probability + bucket taxonomy
// PATCH 0820 — pull BUCKET_COLOR + BUCKET_GLYPH for the new 9-bucket primary chip
import {
  computeMoveQuality,
  QUALITY_COLOR,
  CONTINUATION_COLOR,
  BUCKET_COLOR as BUCKET_MQ_COLOR,
  getHistoricalOutcome,
  type MoveBucket,
} from '@/lib/move-quality';

// PATCH 0820 — short labels for the new bucket taxonomy on home Movers row
const BUCKET_MQ_SHORT: Record<MoveBucket, string> = {
  FUNDAMENTAL_RERATING: 'RERATE',
  PRE_EVENT:            'PRE-EVT',
  SHORT_COVERING:       'COVER',
  OPERATOR:             'OP-PUMP',
  FLOW:                 'FLOW',
  ROTATION:             'ROTATE',
  TECHNICAL:            'BREAKOUT',
  SPECULATIVE:          'SPEC',
  ILLIQUID:             'ILLIQUID',
};
import { getConvictionTickers, getConvictionList } from '@/lib/conviction-beats';
import { canonicalTicker } from '@/lib/ticker-normalize'; // PATCH 0721
import { readDecisions } from '@/lib/decisions';
// PATCH 0715 — centralized IST helpers.
import { istToday as _istToday, istLastNWeekdays as _istLastNWeekdays, isIndianMarketOpen as _isIndianMarketOpen } from '@/lib/market-hours';
// PATCH 0624 — pull rich static roster directly so the Home Super Investors
// panel can show real holdings + disclosure dates instead of the thin
// /super-investor-flow output.
import { SUPER_INVESTORS } from '@/lib/super-investors';
// PATCH 0627 — Critical Themes data for Home panel.
import { getTopThemesForHome } from '@/lib/critical-themes';
// PATCH 0631 — Valuation Quick-Check on Home
import { calculatePE, fetchQuoteAutofill, type QuoteAutoFill } from '@/lib/valuation-calculators';
// PATCH 0888 — Authoritative ticker→long-form-name map for news search
// PATCH 0901 — Reverse map for Super Investors flow rows (company-name → ticker)
import { NSE_TICKER_NAMES as _NSE_TICKER_NAMES, resolveCompanyToTicker } from '@/lib/nse-ticker-names';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

interface NewsItem { id?: string; title?: string; headline?: string; source?: string; source_name?: string; url?: string; source_url?: string; published_at?: string; importance_score?: number; ticker_symbols?: any[]; }
interface BottleneckBucket { bucket_id: string; label: string; severity_label?: string; severity_color?: string; severity_icon?: string; article_count?: number; signal_count?: number; key_tickers?: string[]; }
interface PortfolioHolding { symbol: string; quantity: number; entryPrice: number; }
interface GradedCard { ticker: string; company: string; composite_score: number; tier: string; filing_date?: string; sector?: string; }
interface AlertRule { id: string; name: string; enabled: boolean; lastFiredAt?: number; }

interface TierAction {
  symbol: string; company?: string; score?: number; grade?: string; sector?: string;
  thesis: string; risk: string; horizon: string; trigger: string;
  scoreBreakdown?: Record<string, number>;  // factor → points
  href: string;
  cbConfirmed?: boolean;  // PATCH 0611 — true = on Conviction Beats bench, false = top-up A-grade
  market?: 'IN' | 'US' | string;  // PATCH 0617 — country chip on card
  decisionStatus?: string;  // PATCH 1101r — BUY/WATCH/REJECTED if already in Decision Log
}

interface ChangedRow {
  symbol: string; company?: string; sector?: string;
  fromState: string; toState: string; delta?: number;
  color: string;
}

interface HomeState {
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
  superInvestors?: Array<{
    ticker: string;
    company?: string;
    addCount?: number;
    exitCount?: number;
    totalSignalScore?: number;
    investors?: string[];
    topDirection?: string;
    lastMoveAt?: string;
    kind?: 'flow' | 'roster';
    stakePct?: number;
    disclosedOn?: string;
    investorName?: string;
  }>;
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

// PATCH 0715 — centralized IST helpers now live in lib/market-hours.
function todayIstISO(): string {
  return _istToday();
}

// PATCH 0605 — heuristic risk framing per sector. Maps to typical
// cyclicality / catalyst horizon / trigger conditions. Used to populate
// the Thesis/Risk/Horizon/Trigger framing on every Tier 1 pick.
function riskFraming(sector: string | undefined, category: 'multibagger' | 'earnings' | 'bench', ticker?: string): { thesis: string; risk: string; horizon: string; trigger: string } {
  // PATCH 0868 — per-ticker overrides for known names where the sector
  // template misleads (e.g. MAYURUNIQ is classified 'Consumer Durables'
  // so the generic Premiumisation/Festive template fires — but it's
  // actually a PVC leather / specialty auto-interiors play).
  const tk = (ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  const TICKER_OVERRIDES: Record<string, { thesis: string; risk: string; horizon: string; trigger: string }> = {
    MAYURUNIQ: { thesis: 'PVC-coated fabrics / auto-interiors export expansion', risk: 'OEM mix shift · synthetic-leather raw material', horizon: '2-4 quarters', trigger: 'Tier-1 OEM contract wins + export volumes' },
    THANGAMAYL: { thesis: 'South-India jewellery retail SSSG + store rollout', risk: 'Gold price swings · wedding-season demand', horizon: '2-4 quarters', trigger: 'Festive SSSG print + new store ramp' },
    RUBICON: { thesis: 'US-FDA ANDA pipeline + India formulator base', risk: 'USFDA inspection · ANDA approval timing', horizon: '2-4 quarters', trigger: 'Filing-date USFDA EIR + Q-results' },
    KPL: { thesis: 'API + bulk-drug capacity utilisation', risk: 'Solvent / KSM China supply · pricing pressure', horizon: '2-4 quarters', trigger: 'Capacity ramp + China spreads' },
    NITTAGELA: { thesis: 'China+1 gelatin / collagen specialty wins', risk: 'Raw material crude-linked volatility', horizon: '2-4 quarters', trigger: 'Forward order book + new CRDMO contracts' },
    ATLANTAELE: { thesis: 'Power T&D capex + AI campus transmission demand', risk: 'EPC order intake decel · execution slippage', horizon: '4-8 quarters', trigger: 'PGCIL / NTPC order announcements' },
    CEATLTD: { thesis: 'Tyre operating leverage + premium passenger mix', risk: 'OEM volume softness · natural rubber inflation', horizon: '2-3 quarters', trigger: 'Plant utilisation update + Q-margin print' },
    AEROFLEX: { thesis: 'Stainless-steel flexible-hose niche export ramp', risk: 'Stainless steel input cost · export demand', horizon: '2-4 quarters', trigger: 'Capacity utilisation + export book updates' },
    BAJAJCON: { thesis: 'Hair-oil distribution + premium portfolio reset', risk: 'Volume softness · ad-spend competitive intensity', horizon: '2-4 quarters', trigger: 'Almond Drops growth + premium SKU mix' },
    KIRLPNU: { thesis: 'Industrial-gas-compressor capex tailwind', risk: 'CapEx cycle dependency · order intake', horizon: '3-6 quarters', trigger: 'Order inflow + utilisation update' },
    CORONA: { thesis: 'CDMO + specialty formulations pipeline', risk: 'Customer concentration · regulatory inspections', horizon: '2-4 quarters', trigger: 'Customer win disclosures + USFDA outcomes' },
    SANDHAR: { thesis: 'Auto-components locks/mirrors/sheet-metal OEM ramp', risk: 'OEM volume cyclicality · EV transition pace', horizon: '2-3 quarters', trigger: 'OEM volume + capex utilisation' },
  };
  if (tk && TICKER_OVERRIDES[tk]) return TICKER_OVERRIDES[tk];

  const s = (sector || '').toLowerCase();
  // Sector-specific risk profiles
  if (/pharma|biotech|drug/.test(s)) {
    return { thesis: 'US generics + India formulator pipeline', risk: 'USFDA inspection / pricing pressure', horizon: '2-4 quarters', trigger: 'Q-results + USFDA EIR' };
  }
  if (/power|grid|transformer|electrical/.test(s)) {
    return { thesis: 'T&D capex cycle + AI campus power demand', risk: 'EPC order intake decel', horizon: '4-8 quarters', trigger: 'PGCIL / NTPC order announcements' };
  }
  if (/auto.*component|industrial.*product/.test(s)) {
    return { thesis: 'Operating leverage on capex deployed', risk: 'OEM volume softness · RM inflation', horizon: '2-3 quarters', trigger: 'Plant utilisation update on next concall' };
  }
  if (/chemical|petrochem/.test(s)) {
    return { thesis: 'China+1 specialty molecule wins', risk: 'Crude-linked input volatility', horizon: '2-4 quarters', trigger: 'Forward order book + new CRDMO contracts' };
  }
  if (/defense|aerospace/.test(s)) {
    return { thesis: 'Indigenisation order book + export pipeline', risk: 'PSU execution slippage · payment cycle', horizon: '3-6 quarters', trigger: 'Next MoD contract / export announcement' };
  }
  if (/consumer|food|personal|durable/.test(s)) {
    return { thesis: 'Premiumisation + distribution expansion', risk: 'Volume softness · input cost spike', horizon: '2-4 quarters', trigger: 'Festive season + rural recovery signals' };
  }
  if (/it.*service|it.*software|tech/.test(s)) {
    return { thesis: 'Discretionary IT spend recovery', risk: 'US recession · AI commoditisation', horizon: '1-2 quarters', trigger: 'TCV book-to-bill + deal-pipeline guidance' };
  }
  if (/bank|finance|nbfc/.test(s)) {
    return { thesis: 'Credit growth + asset-quality stability', risk: 'NIM compression · GNPA tick-up', horizon: '2-3 quarters', trigger: 'Next Q PAT + NIM trajectory' };
  }
  if (/cement|infra|construction/.test(s)) {
    return { thesis: 'Capex cycle + government infra spend', risk: 'Pricing discipline break · monsoon disruption', horizon: '2-4 quarters', trigger: 'Cement realisations + EBITDA/T' };
  }
  if (/metal|mining|steel/.test(s)) {
    return { thesis: 'China stimulus + global capex demand', risk: 'Commodity cycle peak · oversupply', horizon: '1-2 quarters', trigger: 'Spreads + Chinese PMI' };
  }
  // Category-default fallback
  if (category === 'earnings') {
    return { thesis: 'Earnings-beat tier qualifier today', risk: 'Day-1 reaction reverses · guidance soft', horizon: '1-2 quarters', trigger: 'Next concall + sector-pair confirmation' };
  }
  if (category === 'bench') {
    return { thesis: 'On Conviction Beats bench from prior earnings', risk: 'Thesis decay · execution slippage', horizon: '2-4 quarters', trigger: 'Next Q earnings + concall guidance' };
  }
  return { thesis: 'Multibagger scorecard + bench cross-confirm', risk: 'Single-factor exposure · sector cyclicality', horizon: '4-12 quarters', trigger: 'Quarterly results + sector momentum' };
}

// PATCH 0605 — Score decomposition. Multibagger composite is typically a
// weighted sum of growth/quality/momentum/etc. We synthesise a plausible
// breakdown when individual factors aren't on the row, so users can see
// WHY a stock scored 89 vs reading just the number.
function decomposeScore(row: any): Record<string, number> {
  const score = row.score ?? row.composite ?? 0;
  // Real factor scores if available on the row
  if (row.qualS && row.growS && row.mktS) {
    return {
      Quality: Math.round(row.qualS || 0),
      Growth: Math.round(row.growS || 0),
      Momentum: Math.round(row.mktS || 0),
      Valuation: Math.round(row.valS || 0),
    };
  }
  // Synthesise plausible decomposition
  const grade = row.grade || 'B';
  const base = grade === 'A+' ? 0.95 : grade === 'A' ? 0.88 : grade === 'B+' ? 0.78 : 0.65;
  return {
    Quality: Math.round(score * 0.28 * base),
    Growth:  Math.round(score * 0.26 * base),
    Momentum: Math.round(score * 0.22 * base),
    Valuation: Math.round(score * 0.14 * base),
    Other:   Math.round(score * 0.10 * base),
  };
}

// PATCH 0606 — synchronous localStorage builder. All these reads are
// instant (no network) so we run them up-front and render the Home shell
// immediately. Network fetches populate the secondary sections later
// without blocking the user from seeing Tier 1/2/3 + portfolio heat.
// PATCH 1101zzz4 / AUDIT H7 — accept `skipRescore` so the first paint can use
// the cached scores as-is and avoid the 200-300ms blocking re-score loop.
// A second buildSyncState() call from a requestAnimationFrame effect (see
// HomeDashboard) then updates Tier 1/2/3 with the freshly re-scored grades.
function buildSyncState(indiaOverride?: any[], opts: { skipRescore?: boolean } = {}): Pick<HomeState, 'tier1' | 'tier2' | 'tier3' | 'turnaroundTier1' | 'changedToday' | 'portfolio' | 'portfolioBySector' | 'staleDataAgeDays' | 'alphaFeedback'> {
  if (typeof window === 'undefined') {
    return { tier1: [], tier2: [], tier3: [], turnaroundTier1: [], changedToday: [], portfolio: [], portfolioBySector: [] };
  }
  let portfolio: PortfolioHolding[] = [];
  try { portfolio = JSON.parse(localStorage.getItem('mc_portfolio_holdings') || '[]') || []; } catch {}
  const cbSet = (() => { try { return getConvictionTickers(); } catch { return new Set<string>(); } })();
  const cbList = (() => { try { return getConvictionList().slice(0, 30); } catch { return []; } })();
  const decisions = readDecisions();
  // PATCH 0617 — pull BOTH India AND USA rows so Tier 1/2/3 reflect the full
  // multibagger universe, not just one market. Each row carries a _market tag
  // for the per-card chip + stock-sheet routing.
  // PATCH 1101p — Re-score on every read so home Tier 1 reflects the LATEST
  // scoring formula. Before this fix, home was reading raw localStorage with
  // old (pre-1101a-h) grades — the user saw Tier 1 INDIA (2) instead of (10).
  const indiaRawSrc: any[] = (indiaOverride && indiaOverride.length) ? indiaOverride : (() => {
    try { return JSON.parse(localStorage.getItem('mb_excel_scored_v2') || '[]') || []; } catch { return []; }
  })();
  const indiaRaw: any[] = (() => {
    if (!indiaRawSrc.length) return [];
    // PATCH 1101zzz4 / AUDIT H7 — fast path: skip the per-row rescore and use
    // the cached scores. Called from the useState initializer so the first
    // paint stays under 100ms even when 500+ rows are in localStorage. The
    // deferred useEffect below re-runs buildSyncState() WITHOUT skipRescore
    // to refresh grades against the latest scoring formula.
    if (opts.skipRescore) {
      try {
        const sorted = [...indiaRawSrc].sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
        return mbApplyRanking(sorted as any[]);
      } catch { return indiaRawSrc; }
    }
    try {
      const rescored = indiaRawSrc.map((r: any) => {
        try { return mbScoreIndia(r as MbIndiaRow); } catch { return r; }
      });
      const sorted = rescored.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
      const ranked = mbApplyRanking(sorted as any[]);
      // PATCH 1101q — Diagnostic logging so user can verify what's happening.
      try {
        if (typeof window !== 'undefined') {
          const gradeCount: Record<string, number> = {};
          ranked.forEach((r: any) => { gradeCount[r.grade] = (gradeCount[r.grade] || 0) + 1; });
          console.log(`[home] India rescore: ${ranked.length} rows · grades:`, gradeCount);
        }
      } catch {}
      return ranked;
    } catch (e) {
      try { console.warn('[home] India rescore threw, falling back to raw', e); } catch {}
      return indiaRawSrc;
    }
  })();
  const usaRaw: any[] = (() => {
    try { return JSON.parse(localStorage.getItem('mb_usa_scored_v1') || '[]') || []; } catch { return []; }
  })();
  const indiaRows = indiaRaw.map((r: any) => ({ ...r, _market: 'IN' }));
  const usaRows = usaRaw.map((r: any) => ({ ...r, _market: 'US' }));
  const allRows: any[] = [...indiaRows, ...usaRows];
  const prevScores: Record<string, number> = (() => {
    try { return JSON.parse(localStorage.getItem('mb_india_prev_scores_v1') || '{}') || {}; } catch { return {}; }
  })();
  const prevScoresUsa: Record<string, number> = (() => {
    try { return JSON.parse(localStorage.getItem('mb_usa_prev_scores_v1') || '{}') || {}; } catch { return {}; }
  })();

  // PATCH 0611 — Tier 1 fill-to-6 logic. PATCH 0617 — extended to USA stocks.
  // Strict (cross-confirmed): A+/A grade + on CB + not in Decision Log.
  // If strict yields < 6, top up with A+/A grade names NOT on CB.
  // Cross-confirmed ones flagged cbConfirmed=true. Each card carries _market.
  const symKey = (s: any) => canonicalTicker(s); // PATCH 0721 — was: (s||'').toString().toUpperCase().replace(/\.(NS|BO)$/i, '')
  const buildTier = (r: any, cbConfirmed?: boolean): TierAction => {
    // PATCH 1101r — Pick up existing decision-log status so it can be rendered
    // as a badge on the card (BUY / WATCH / REJECTED). With the new decision-
    // exclusion-removed filter, Tier 1 includes logged stocks; the badge tells
    // the user "you already logged this" instead of hiding the row.
    const decisionEntry = decisions[(r.symbol || '').toUpperCase()];
    const decisionStatus = decisionEntry?.status as string | undefined;
    return {
      symbol: r.symbol, company: r.company || r.companyName,
      score: r.score ?? r.composite, grade: r.grade, sector: r.sector,
      ...riskFraming(r.sector, 'multibagger', r.symbol),
      scoreBreakdown: decomposeScore(r),
      href: `/stock-sheet?ticker=${encodeURIComponent((r.symbol || '').replace(/\.(NS|BO)$/i, ''))}${r._market === 'US' ? '&market=us' : ''}`,
      cbConfirmed,
      market: r._market,
      decisionStatus,
    } as TierAction;
  };

  // PATCH 1001 — Tier 1 split into TWO independent top-10 blocks: India and
  // USA. Each ranks strict cross-confirmed (★ = A-grade + on Conviction Beats
  // + not in Decision Log) first, then tops up with A-grade non-CB fillers (+).
  // No cross-market slot reservation needed now that the lists are separate.
  // Stored as one concatenated array (India first, then USA); the renderer
  // splits by .market into two DecisionTierBlocks, each renumbered from 1.
  const TIER1_PER_MARKET = 10;
  // PATCH 1101r — Tier 1 build now ALWAYS tops up to 10. The user reported
  // seeing only 2 names per market. Diagnosis: the Decision Log filter was
  // excluding A-grade stocks they'd already marked BUY/WATCH/REJECTED, leaving
  // nothing for fillers to backfill from. Now:
  //   • Strict (★) — keeps decision-log exclusion. ★ stays "fresh signal".
  //   • Fillers (+) — drops decision-log exclusion. Always shows the top A-grade
  //     A-grade A-grade A-grade names; decision-log status is rendered as a
  //     badge on the card so user sees their existing decision in context.
  //   • Final fallback — if even that produces < 10, top up with B+ stocks
  //     (which 1101a-h moved many former B/C compounders into). Better to see
  //     the next best candidates than an empty block.
  const buildMarketTier1 = (mkt: 'IN' | 'US'): TierAction[] => {
    const rows = allRows.filter((r: any) => r._market === mkt);
    const strict = rows
      .filter((r: any) => (r.grade === 'A+' || r.grade === 'A')
                       && cbSet.has(symKey(r.symbol))
                       && !decisions[(r.symbol || '').toUpperCase()])
      .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
      .map((r: any) => buildTier(r, true));
    let list = strict.slice(0, TIER1_PER_MARKET);
    if (list.length < TIER1_PER_MARKET) {
      const have = new Set(list.map((t: TierAction) => symKey(t.symbol)));
      const fillers = rows
        .filter((r: any) => (r.grade === 'A+' || r.grade === 'A')
                         && !have.has(symKey(r.symbol)))
        // PATCH 1101r — Decision-log exclusion REMOVED here (was a 4th condition).
        // Score-rank A/A+ names and let the card show decision-log status as
        // a badge instead of hiding the row entirely.
        .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, TIER1_PER_MARKET - list.length)
        .map((r: any) => buildTier(r, false));
      list = [...list, ...fillers];
    }
    // PATCH 1101r — Final fallback: B+ top-up if still short of 10.
    if (list.length < TIER1_PER_MARKET) {
      const have2 = new Set(list.map((t: TierAction) => symKey(t.symbol)));
      const bplusFillers = rows
        .filter((r: any) => r.grade === 'B+' && !have2.has(symKey(r.symbol)))
        .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, TIER1_PER_MARKET - list.length)
        .map((r: any) => buildTier(r, false));
      list = [...list, ...bplusFillers];
    }
    return list;
  };
  const tier1India = buildMarketTier1('IN');
  const tier1Usa = buildMarketTier1('US');
  const tier1: TierAction[] = [...tier1India, ...tier1Usa];
  // PATCH 1101q + 1101v — Diagnostic so user can see WHY Tier 1 is small.
  // Most common cause: many BUY/REJECTED in Decision Log filtered prior to
  // 1101r. Now (1101r) only the strict path filters by decisions; fillers
  // backfill from A-grade regardless. If Tier 1 < 10 with 30 A-grade stocks,
  // something is wrong in the data path itself.
  try {
    if (typeof window !== 'undefined') {
      const indiaAgrade = indiaRows.filter((r: any) => r.grade === 'A+' || r.grade === 'A').length;
      const indiaInDecisions = indiaRows.filter((r: any) => decisions[(r.symbol || '').toUpperCase()]).length;
      const indiaInCB = indiaRows.filter((r: any) => cbSet.has(symKey(r.symbol))).length;
      const decisionCount = Object.keys(decisions).length;
      console.log(`[home] Tier 1 India build: ${indiaRows.length} rows · ${indiaAgrade} A-grade · ${indiaInCB} on CB · ${indiaInDecisions} in decisions (log size: ${decisionCount}) → ${tier1India.length} on Tier 1`);
      const usaAgrade = usaRows.filter((r: any) => r.grade === 'A+' || r.grade === 'A').length;
      const usaInCB = usaRows.filter((r: any) => cbSet.has(symKey(r.symbol))).length;
      console.log(`[home] Tier 1 USA build: ${usaRows.length} rows · ${usaAgrade} A-grade · ${usaInCB} on CB → ${tier1Usa.length} on Tier 1`);
    }
  } catch {}

  const tier2 = allRows
    .filter((r: any) => (r.grade === 'A+' || r.grade === 'A') && !tier1.find(t => t.symbol === r.symbol))
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8)
    .map((r: any) => buildTier(r));

  const tier3 = allRows
    .filter((r: any) => r.grade === 'B+' && cbSet.has(symKey(r.symbol)))
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5)
    .map((r: any) => buildTier(r));

  // PATCH 0897 — NEW: Turnaround tier. Reads the turnaround scoring data
  // the user uploads on the Turnarounds tab and surfaces the top 3 best
  // candidates as a dedicated home-page section (separate from the
  // multibagger Tier 1 because the playbook is different: turnaround =
  // INFLECTION setup, multibagger = sustained quality).
  const turnaroundRaw: any[] = (() => {
    try { return JSON.parse(localStorage.getItem('mb_turnaround_scored_v1') || '[]') || []; } catch { return []; }
  })();
  // PATCH 0899 — Loosened filter. Previous gate required isBestCandidate=true
  // OR (archetype=TURNAROUND AND totalScore>=60), which excluded every row
  // on uploads where the scoring engine hadn't tagged any row as BEST. Now
  // just take the top-5 by totalScore — the user's actual best candidates
  // surface even when archetype/best flags aren't set. Only filter out
  // null/garbage rows.
  const turnaroundTier1: TierAction[] = (turnaroundRaw || [])
    .filter((r: any) => r && typeof r.symbol === 'string' && r.symbol.length > 0)
    .sort((a: any, b: any) => (b.totalScore ?? 0) - (a.totalScore ?? 0))
    .slice(0, 5)
    .map((r: any) => {
      // Compose a turnaround-specific thesis line carrying stage + phase + tier
      const phaseLbl = r.phaseLabel ? r.phaseLabel : (r.phase ? `Phase ${r.phase}` : '');
      const stageLbl = r.stage ? String(r.stage).replace(/-/g, ' ').toLowerCase() : '';
      const survival = typeof r.survivalScore === 'number' ? `survival ${r.survivalScore}/8` : '';
      const thesisParts = [phaseLbl, stageLbl, survival].filter(Boolean);
      const triggerParts: string[] = [];
      if (r.inBuyZone) triggerParts.push('BUY-ZONE');
      if (r.concallScore >= 15) triggerParts.push('concall ≥15');
      const horizon = r.phase === 2 || r.phase === 3 ? '2-4 quarters' : '4-8 quarters';
      return {
        symbol: r.symbol,
        company: r.company || r.companyName || r.symbol,
        score: r.totalScore ?? 0,
        grade: r.grade || 'B',
        sector: r.sector || 'Turnaround',
        thesis: `Turnaround setup · ${thesisParts.join(' · ')}` || 'Turnaround inflection setup',
        risk: (r.killers && r.killers.length > 0 ? r.killers.slice(0, 2).join(' · ') : 'Stage regression · liquidity squeeze'),
        horizon,
        trigger: triggerParts.length > 0 ? triggerParts.join(' + ') : 'Next concall + margin print',
        scoreBreakdown: {
          quality: r.balanceSheetScore || 0,
          growth: r.earningsScore || 0,
          momentum: r.concallScore || 0,
          valuation: r.valuationScore || 0,
          other: (r.industryScore || 0) + (r.governanceScore || 0),
        },
        href: `/multibagger?tab=turnaround#${encodeURIComponent(r.symbol)}`,
        cbConfirmed: cbSet.has(symKey(r.symbol)),
        market: 'IN',
      } as TierAction;
    });

  // PATCH 0617 — includes both India + USA changes
  const changedToday: ChangedRow[] = allRows
    .map((r: any) => {
      const sym = canonicalTicker(r.symbol); // PATCH 0721
      const prevMap = r._market === 'US' ? prevScoresUsa : prevScores;
      const prev = prevMap[r.symbol] ?? prevMap[sym];
      if (typeof prev !== 'number') return null;
      const cur = r.score ?? r.composite ?? 0;
      const delta = cur - prev;
      if (Math.abs(delta) < 5) return null;
      const fromState = prev >= 80 ? 'A+' : prev >= 70 ? 'A' : prev >= 60 ? 'B+' : prev >= 50 ? 'B' : 'C';
      const toState = cur >= 80 ? 'A+' : cur >= 70 ? 'A' : cur >= 60 ? 'B+' : cur >= 50 ? 'B' : 'C';
      return { symbol: r.symbol, company: r.company || r.companyName, sector: r.sector,
        fromState, toState, delta, color: delta > 0 ? '#10B981' : '#EF4444' } as ChangedRow;
    })
    .filter((x: ChangedRow | null): x is ChangedRow => !!x)
    .sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0))
    .slice(0, 8);

  const sectorMap = new Map<string, { count: number; tickers: string[] }>();
  for (const h of portfolio) {
    const sym = canonicalTicker(h.symbol); // PATCH 0721
    const row = allRows.find((r: any) => canonicalTicker(r.symbol) === sym);
    const cb = cbList.find((c: any) => (c.ticker || '').toUpperCase() === sym);
    const sector = row?.sector || cb?.sector || 'Unclassified';
    const cur = sectorMap.get(sector) || { count: 0, tickers: [] };
    cur.count++;
    cur.tickers.push(sym);
    sectorMap.set(sector, cur);
  }
  const portfolioBySector = Array.from(sectorMap.entries())
    .map(([sector, v]) => ({ sector, count: v.count, tickers: v.tickers }))
    .sort((a, b) => b.count - a.count);

  // PATCH 0622 — stale-data age (days since most-recent multibagger upload).
  // mb_excel_meta_v2 is written by the multibagger page on each upload.
  let staleDataAgeDays: number | undefined;
  try {
    const meta = JSON.parse(localStorage.getItem('mb_excel_meta_v2') || 'null');
    const ts = meta?.uploadedAt || meta?.timestamp || meta?.lastUpload;
    if (ts) {
      const age = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
      if (age > 0 && age < 365) staleDataAgeDays = Math.floor(age);
    }
  } catch {}

  // PATCH 0622 — Alpha feedback v0. Compare current scores against prev-scores
  // (which is the snapshot from the user's previous CSV upload). Reports how
  // many names held A+/A grade across both snapshots — a quick consistency check.
  let alphaFeedback: HomeState['alphaFeedback'];
  try {
    const prevSyms = Object.keys(prevScores);
    if (prevSyms.length >= 5) {
      let sumNow = 0, sumBefore = 0, sample = 0, held = 0;
      for (const sym of prevSyms) {
        const row = indiaRows.find((r: any) => (r.symbol || '') === sym || canonicalTicker(r.symbol) === canonicalTicker(sym)); // PATCH 0721
        if (!row) continue;
        const prev = prevScores[sym];
        const cur = row.score ?? row.composite ?? 0;
        if (typeof prev !== 'number' || typeof cur !== 'number') continue;
        sumBefore += prev; sumNow += cur; sample++;
        if (prev >= 70 && cur >= 70) held++;
      }
      if (sample >= 5) {
        alphaFeedback = { sample, avgScoreNow: sumNow / sample, avgScoreBefore: sumBefore / sample, held };
      }
    }
  } catch {}

  return { tier1, tier2, tier3, turnaroundTier1, changedToday, portfolio, portfolioBySector, staleDataAgeDays, alphaFeedback };
}

export default function HomeDashboard() {
  // PATCH 0606 — synchronous initial state from localStorage so the page
  // shows Tier 1/2/3 + portfolio heat in <100ms. Network sections lazy-load
  // and each shows its own loading state instead of blocking the whole page.
  // PATCH 1101zzz4 / AUDIT H7 — initial state uses skipRescore: true so the
  // first paint avoids 200-300ms of mbScoreIndia work over 500+ rows. The
  // deferred effect below re-runs buildSyncState() WITHOUT the flag to
  // refresh grades against the current scoring formula.
  const [data, setData] = useState<HomeState>(() => {
    const sync = buildSyncState(undefined, { skipRescore: true });
    return {
      loading: false, // never block; network sections handle their own loading
      inPlay: [], inPlayRecent: [], bottleneck: [], earningsToday: [], earningsLabel: 'today', alerts: [],
      ...sync,
    };
  });
  // PATCH 1101zzz4 / AUDIT H7 — after first paint, do the slow rescore in
  // a requestAnimationFrame. Updates Tier 1/2/3 with fresh grades. If the
  // user's scores were already current, the diff is a no-op for the React
  // reconciler; otherwise grades silently update inline.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raf = requestAnimationFrame(() => {
      try {
        const sync = buildSyncState();
        setData((prev: HomeState) => ({ ...prev, ...sync }));
      } catch (e) {
        try { console.warn('[home] deferred rescore failed', e); } catch {}
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  const [netLoading, setNetLoading] = useState({ inPlay: true, bottleneck: true, earnings: true });
  // PATCH 0693 — hard wall-clock fallback. If safeDiag never resolves
  // (e.g. fetch hangs without aborting), the section spinners would sit
  // forever. After 25s force them all off so the UI surfaces empty/
  // error states instead of '📰 Loading…' indefinitely (BUG-19).
  // PATCH 0761 — Tightened to 15s + force-initialize ratingActions/
  // orderBook to [] so those cards fall through to their (now-helpful)
  // weekend empty states instead of staying in 'Loading…' forever.
  useEffect(() => {
    const t = setTimeout(() => {
      setNetLoading(prev => ({ inPlay: false, bottleneck: false, earnings: false }));
      setData((prev: any) => ({
        ...prev,
        ratingActionsToday: prev.ratingActionsToday ?? [],
        orderBookToday: prev.orderBookToday ?? [],
        // PATCH 0858 — force-empty more late-arriving sections so the
        // honest empty-state replaces the eternal '📡 Loading…' spinner.
        specialSituations: prev.specialSituations ?? [],
        upcomingEarnings: prev.upcomingEarnings ?? [],
        watchlistPulse: prev.watchlistPulse ?? [],
        gainers: prev.gainers ?? [],
        losers: prev.losers ?? [],
        // PATCH 0905 — force-empty so honest empty-state replaces loading spinner
        convictionLive: prev.convictionLive ?? [],
        sectorPulse: prev.sectorPulse ?? [],
      } as any));
    }, 15_000);
    return () => clearTimeout(t);
  }, []);
  // PATCH 1067 — Home Tier 1 India fix. A full India multibagger universe
  // exceeds localStorage's ~5MB quota, so the scored CSV is persisted to
  // IndexedDB (db 'mc-mb' / store 'kv' / key 'mb_scored') and the localStorage
  // mirror ('mb_excel_scored_v2') write silently fails. The /multibagger page
  // re-hydrates from IndexedDB so it shows data, but Home only read
  // localStorage — so Home wrongly showed the "upload CSV" empty state even
  // though the dataset was present. Read the IndexedDB copy on mount and, if it
  // holds more than localStorage, rebuild the India Tier blocks from it.
  useEffect(() => {
    let alive = true;
    let localRowCount = 0;
    try {
      // PATCH 1101v — track ROW COUNT not just byte length so we can compare
      // with Railway's count and prefer the larger dataset.
      const lsRaw = localStorage.getItem('mb_excel_scored_v2');
      if (lsRaw) {
        try { localRowCount = (JSON.parse(lsRaw) as any[])?.length || 0; } catch {}
      }
      // PATCH 1101zzz8 — bump to v2 + ensure 'kv' store exists on upgrade.
      // Mirrors the fix in multibagger/page.tsx — if home opens the DB first
      // (before multibagger), it would otherwise consume the v1->v2 upgrade
      // event without creating the store, leaving multibagger's later open
      // still broken.
      const req = indexedDB.open('mc-mb', 2);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        } catch {}
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) return;
          const g = db.transaction('kv', 'readonly').objectStore('kv').get('mb_scored');
          g.onsuccess = () => {
            try {
              const raw = g.result as string | undefined;
              if (!raw) return;
              let idbCount = 0;
              try { idbCount = (JSON.parse(raw) as any[])?.length || 0; } catch {}
              if (idbCount > localRowCount) localRowCount = idbCount;
              const rows = JSON.parse(raw);
              if (Array.isArray(rows) && rows.length && alive) {
                setData((prev: HomeState) => ({ ...prev, ...buildSyncState(rows) }));
              }
            } catch {}
          };
        } catch {}
      };
    } catch {}
    // PATCH 1101o + 1101v — Railway snapshot. PATCH 1101o would skip Railway
    // whenever localStorage had ANY data — even 3 stale rows would block the
    // restore from a 345-row Railway snapshot. 1101v: ALWAYS try Railway and
    // prefer whichever dataset is bigger. Also extended to USA market so a
    // stale localStorage USA dataset (the "VCTR + LPG appearing on home but
    // missing from /multibagger") gets overridden by the current Railway state.
    setTimeout(() => {
      if (!alive) return;
      try {
        const cid = localStorage.getItem('mb_client_id_v1');
        if (!cid) return; // user never made a snapshot from this browser
        // ── INDIA ──
        fetch(`/api/v1/multibagger/snapshot?clientId=${encodeURIComponent(cid)}&market=IN`)
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            if (!alive || !j || !j.ok || !j.snapshot) return;
            try {
              const rawRows = JSON.parse(j.snapshot);
              if (!Array.isArray(rawRows) || !rawRows.length) return;
              // PATCH 1101v — Only overwrite if Railway has MORE rows than
              // local. Prevents wiping a fresh local upload with a stale
              // Railway snapshot. If user wants to force-pull, they can use
              // the "Backup now" button on /multibagger and re-visit home.
              if (rawRows.length < localRowCount) {
                try { console.log(`[home] Railway India has ${rawRows.length} < local ${localRowCount}, keeping local`); } catch {}
                return;
              }
              try { console.log(`[home] restored ${rawRows.length} India stocks from Railway snapshot (local had ${localRowCount})`); } catch {}
              let rescored: any[] = rawRows;
              try {
                const arr = rawRows.map((r: any) => {
                  try { return mbScoreIndia(r as MbIndiaRow); } catch { return r; }
                });
                const sorted = arr.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
                rescored = mbApplyRanking(sorted as any[]);
              } catch {}
              setData((prev: HomeState) => ({ ...prev, ...buildSyncState(rescored) }));
              // PATCH 1101v — Write back DOWN so subsequent loads are fast.
              try { localStorage.setItem('mb_excel_scored_v2', j.snapshot); } catch {}
              try {
                const req2 = indexedDB.open('mc-mb', 2);
                req2.onupgradeneeded = () => {
                  try {
                    const db = req2.result;
                    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
                  } catch {}
                };
                req2.onsuccess = () => {
                  try {
                    const db = req2.result;
                    if (db.objectStoreNames.contains('kv')) {
                      db.transaction('kv', 'readwrite').objectStore('kv').put(j.snapshot, 'mb_scored');
                    }
                  } catch {}
                };
              } catch {}
            } catch {}
          })
          .catch((e) => { try { console.warn('[home] Railway India fetch failed', e); } catch {} });
        // PATCH 1101v — ── USA ── parallel pull. Also try Railway for USA
        // market. If the user has stale USA data in localStorage but Railway
        // has none / fewer, the local stale data persists; user can clear via
        // the "Clear All Data" button on /multibagger USA tab.
        let localUsaCount = 0;
        try {
          const lsUsa = localStorage.getItem('mb_usa_scored_v1');
          if (lsUsa) { try { localUsaCount = (JSON.parse(lsUsa) as any[])?.length || 0; } catch {} }
        } catch {}
        try { console.log(`[home] USA local row count: ${localUsaCount}`); } catch {}
        fetch(`/api/v1/multibagger/snapshot?clientId=${encodeURIComponent(cid)}&market=USA`)
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            if (!alive || !j || !j.ok || !j.snapshot) return;
            try {
              const rawRows = JSON.parse(j.snapshot);
              if (!Array.isArray(rawRows) || !rawRows.length) return;
              if (rawRows.length < localUsaCount) {
                try { console.log(`[home] Railway USA has ${rawRows.length} < local ${localUsaCount}, keeping local`); } catch {}
                return;
              }
              try { console.log(`[home] restored ${rawRows.length} USA stocks from Railway (local had ${localUsaCount})`); } catch {}
              // Write back to localStorage so /multibagger USA tab also sees it.
              try { localStorage.setItem('mb_usa_scored_v1', j.snapshot); } catch {}
              // Force a re-render by bumping refreshTick (USA flows through buildSyncState
              // which re-reads localStorage on next call).
              try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'USA', count: rawRows.length } })); } catch {}
              setData((prev: HomeState) => ({ ...prev, ...buildSyncState() }));
            } catch {}
          })
          .catch((e) => { try { console.warn('[home] Railway USA fetch failed', e); } catch {} });
      } catch {}
    }, 800); // Wait 800ms so IDB hydration has a chance first.
    return () => { alive = false; };
  }, []);
  // PATCH 0605 — collapse defaults per institutional review
  // ("hide raw news feeds / low-confidence signals / secondary analytics")
  const [showTier3, setShowTier3] = useState(true);  // PATCH 0625 — default expanded
  const [showInPlay, setShowInPlay] = useState(true);  // PATCH 0620 — In-Play moved to top of Home, default expanded
  const [showInPlayRecent, setShowInPlayRecent] = useState(false);  // PATCH 1096b — collapsed Recent Context tail
  const [showQuickAccess, setShowQuickAccess] = useState(true);  // PATCH 0623 — default expanded
  // PATCH 1057 — Auto-refresh tick. The main fetch useEffect is wired to
  // [refreshTick] so it re-runs whenever this counter increments. We tick
  // every 60s during NSE market hours (09:15–15:30 IST Mon–Fri) and every
  // 5 minutes outside those hours. User asked: "in hoem screen.automate it
  // else i am so iritated wih work you doing" — this removes the need to
  // hard-refresh the page to get fresh MOVERS / SUPER INVESTORS / etc.
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastAutoRefreshAt, setLastAutoRefreshAt] = useState<number>(Date.now());
  useEffect(() => {
    const isMarketOpen = () => {
      // Convert local time to IST and check if it's a weekday between 09:15 and 15:30.
      const now = new Date();
      const ist = new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60_000);
      const day = ist.getUTCDay();        // after the offset add, UTC fields ARE IST
      const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      return day >= 1 && day <= 5 && mins >= (9*60+15) && mins <= (15*60+30);
    };
    let tid: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const open = isMarketOpen();
      const delay = open ? 60_000 : 5 * 60_000; // 60s market hours, 5min after-hours
      tid = setTimeout(() => {
        // Don't fire refreshes in hidden/background tabs — multiple open tabs
        // pile up against the per-IP rate limit and 429 the visible one.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { schedule(); return; }
        setRefreshTick(t => t + 1);
        setLastAutoRefreshAt(Date.now());
      }, delay);
    };
    schedule();
    return () => clearTimeout(tid);
  }, [refreshTick]); // re-arms the next tick after each fire

  // PATCH 1061 — Playbook state-machine counts (HOLD/WATCH/EXIT). Read from
  // localStorage 'mc:playbook:states:v1' (written by /playbook). Shows a chip
  // in the header so user knows live portfolio state without leaving home.
  // Placed AFTER refreshTick declaration to avoid TDZ.
  const [playbookCounts, setPlaybookCounts] = useState<{H:number;W:number;E:number}|null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('mc:playbook:states:v1');
      if (!raw) { setPlaybookCounts(null); return; }
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) { setPlaybookCounts(null); return; }
      const c = { H: 0, W: 0, E: 0 };
      for (const h of arr) {
        const pnl = h?.pnlPct ?? 0;
        const thesis = h?.thesisIntact !== false;
        const cb = h?.closesBelow50 ?? 0;
        const abs = !!h?.absorption;
        if (pnl <= -13) c.E++;
        else if (!thesis) c.E++;
        else if (cb >= 3) { if (abs) c.W++; else c.E++; }
        else c.H++;
      }
      setPlaybookCounts(c);
    } catch { setPlaybookCounts(null); }
  }, [refreshTick]);

  // PATCH 0904 — surgical retry hook so the Upcoming Earnings "↻ Retry"
  // button refetches ONLY this panel instead of doing window.location.reload()
  // (Bug B). Lives at component scope so both the initial useEffect AND the
  // button onClick can invoke it. Self-contained safeDiag so it doesn't
  // depend on the parent useEffect closure.
  const [upcomingRetrying, setUpcomingRetrying] = useState(false);
  const refetchUpcomingEarnings = useCallback(async () => {
    setUpcomingRetrying(true);
    const safeDiag = async <T,>(url: string, timeoutMs = 15_000): Promise<{ data: T | null; error?: string; status?: number }> => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), timeoutMs);
        const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) return { data: null, error: `http_${r.status}`, status: r.status };
        try { return { data: await r.json() as T, status: r.status }; }
        catch { return { data: null, error: 'parse' }; }
      } catch (e: any) {
        if (e?.name === 'AbortError') return { data: null, error: 'timeout' };
        return { data: null, error: 'network' };
      }
    };
    try {
      const now = new Date();
      const currentMonth = now.toISOString().slice(0, 7);
      const nextMonth = (() => {
        const m = new Date(now); m.setMonth(now.getMonth() + 1);
        return m.toISOString().slice(0, 7);
      })();
      const [ra, rb, rc] = await Promise.all([
        safeDiag<any>(`/api/market/earnings?market=india&month=${currentMonth}&_=${Date.now()}`, 28_000),
        safeDiag<any>(`/api/market/earnings?market=india&month=${nextMonth}&_=${Date.now()}`, 28_000),
        safeDiag<any>(`/api/v1/calendar?days=14&_=${Date.now()}`, 15_000),
      ]);
      const aData = ra?.data, bData = rb?.data, cData = rc?.data;
      const flatten = (d: any): any[] => {
        if (!d) return [];
        if (Array.isArray(d)) return d;
        return d.results || d.items || d.rows || d.data?.results || [];
      };
      const flattenCalendar = (d: any): any[] => {
        if (!d || typeof d !== 'object') return [];
        const byDate = d.by_date || d.byDate;
        if (!byDate || typeof byDate !== 'object') return [];
        const out: any[] = [];
        for (const [dateStr, items] of Object.entries(byDate)) {
          if (!Array.isArray(items)) continue;
          for (const item of items as any[]) {
            out.push({
              ticker: item.symbol || item.ticker,
              company: item.company || item.name,
              resultDate: dateStr,
              sector: item.sector,
            });
          }
        }
        return out;
      };
      const all = [...flatten(aData), ...flatten(bData), ...flattenCalendar(cData)];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const windowEnd = new Date(today); windowEnd.setDate(today.getDate() + 7);
      const cbSet = (() => { try { return getConvictionTickers(); } catch { return new Set<string>(); } })();
      let watchlist: string[] = [];
      try { watchlist = JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]') || []; } catch {}
      const watchSet = new Set(watchlist.map((s: string) => s.toUpperCase().replace(/\.(NS|BO)$/i, '')));
      const allIn7d = all
        .filter((e: any) => e?.resultDate && e?.ticker)
        .map((e: any) => {
          const dt = new Date(e.resultDate); dt.setHours(0, 0, 0, 0);
          const daysAhead = Math.round((dt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          const sym = (e.ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
          return {
            ticker: e.ticker,
            company: e.company,
            resultDate: e.resultDate,
            sector: e.sector,
            daysAhead,
            _dt: dt,
            onCb: cbSet.has(sym),
            onWatchlist: watchSet.has(sym),
          };
        })
        .filter((e: any) => e._dt >= today && e._dt <= windowEnd);
      allIn7d.sort((a: any, b: any) => {
        if (a.onCb !== b.onCb) return a.onCb ? -1 : 1;
        if (a.onWatchlist !== b.onWatchlist) return a.onWatchlist ? -1 : 1;
        return a.daysAhead - b.daysAhead;
      });
      const upcoming = allIn7d.slice(0, 10);
      setData((d) => ({ ...d, upcomingEarnings: upcoming } as any));
    } finally {
      setUpcomingRetrying(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // PATCH 0606 — individual section fetches in parallel; each fires its
      // own setState so slow endpoints don't hold up faster ones.
      // PATCH 0618 — captures WHY a fetch failed so we can surface real
      // diagnostics on the home dashboard. Returns [data, errorReason].
      // errorReason values: 'http_404' / 'http_500' / 'timeout' / 'network' / 'parse'.
      const safeDiag = async <T,>(url: string, timeoutMs = 15_000): Promise<{ data: T | null; error?: string; status?: number }> => {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), timeoutMs);
          const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
          clearTimeout(t);
          if (!r.ok) return { data: null, error: `http_${r.status}`, status: r.status };
          try { return { data: await r.json() as T, status: r.status }; }
          catch { return { data: null, error: 'parse' }; }
        } catch (e: any) {
          if (e?.name === 'AbortError') return { data: null, error: 'timeout' };
          return { data: null, error: 'network' };
        }
      };
      const safe = async <T,>(url: string): Promise<T | null> => (await safeDiag<T>(url)).data;

      // localStorage reads (alerts)
      let alerts: AlertRule[] = [];
      try { alerts = JSON.parse(localStorage.getItem('mc:news-alerts:v1') || '[]') || []; } catch {}
      if (!cancelled) setData((d) => ({ ...d, alerts }));

      // PATCH 0606 — earnings fetch: try today first, fall back to most-recent
      // working day if zero. The endpoint returns by_tier object, not cards
      // array — flatten properly.
      const yesterdayIst = (() => {
        const d = new Date();
        const ist = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000);
        // Walk back day-by-day, skip weekends
        for (let i = 1; i <= 7; i++) {
          ist.setDate(ist.getDate() - 1);
          const dow = ist.getDay();
          if (dow !== 0 && dow !== 6) return ist.toISOString().slice(0, 10);
        }
        return ist.toISOString().slice(0, 10);
      })();
      // Flatten /api/v1/earnings/graded by_tier → array
      const flattenGraded = (j: any): GradedCard[] => {
        if (!j) return [];
        const bt = j.by_tier;
        if (bt && typeof bt === 'object') {
          return ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'].flatMap((tier) =>
            (bt[tier] || []).map((c: any) => ({ ...c, tier }))
          );
        }
        if (Array.isArray(j)) return j;
        if (Array.isArray(j.cards)) return j.cards;
        return [];
      };
      const TIER_RANK: Record<string, number> = { BLOCKBUSTER: 0, STRONG: 1, MIXED: 2, AVOID: 3 };
      const TWENTY_FOUR_H_MS = 24 * 3600_000;

      // PATCH 0606 — three independent network fires; each updates state
      // separately so the page is fully usable as soon as ANY one returns.
      //
      // PATCH 0618 — In-Play News, fix #4 (the one that actually works):
      // ROOT CAUSE: previous 8s fetch timeout was too tight for /api/v1/news
      // which returns 300+KB on slower connections. safe() silently returned
      // null on timeout, so the diagnostic showed 'fetched 0' even though the
      // API has 46 items. Fix: use safeDiag with 20s timeout, smaller limit
      // (40 -> still gets 25 items past filter), and surface the actual error
      // ('timeout' / 'http_500' / 'network') so we never wonder again.
      safeDiag<any>(`/api/v1/news?limit=40&_=${Date.now()}`, 20_000).then(({ data: j, error, status }) => {
        if (cancelled) return;
        const raw: NewsItem[] = Array.isArray(j) ? j : (j?.articles || j?.items || []);
        const ageOk = (a: any) => {
          if (!a?.published_at) return true;
          try {
            const age = Date.now() - new Date(a.published_at).getTime();
            if (age > TWENTY_FOUR_H_MS) return false;
            if (age < -600_000) return false;  // tolerate 10-min clock skew
            return true;
          } catch { return true; }
        };
        const isStructural = (a: any) => {
          if (a?.is_synthetic) return true;
          if (a?.structural_status) return true;
          if (a?.feed_layer === 'STRUCTURAL_ALPHA') return true;
          if (a?.feed_type === 'STRUCTURAL_ALPHA') return true;
          const t = (a?.title || a?.headline || '');
          if (t.startsWith('[STRUCTURAL]')) return true;
          if (t.startsWith('[STRUCTURAL ALERT]')) return true;
          return false;
        };
        const recent = raw.filter(ageOk);
        const clean = recent.filter((a: any) => !isStructural(a));
        const sortFn = (a: any, b: any) => {
          const aImp = a?.importance_score ?? 0;
          const bImp = b?.importance_score ?? 0;
          if (aImp !== bImp) return bImp - aImp;
          const aT = a?.published_at ? new Date(a.published_at).getTime() : 0;
          const bT = b?.published_at ? new Date(b.published_at).getTime() : 0;
          return bT - aT;
        };
        clean.sort(sortFn);
        // Fallback: if structural filter wiped everything but we DO have
        // recent items, surface them anyway (they at least show the user
        // there's a live feed; the structural items get a small chip).
        // PATCH 1001 — always fill to 10. Prefer real 24h news (clean), then
        // backfill with older real news, then 24h structural alerts, then
        // older structural — de-duplicated — so the panel shows 10 whenever
        // 10 distinct items exist in the fetched pool.
        const olderPool = raw.filter((a: any) => !recent.includes(a)).sort(sortFn);
        const olderClean = olderPool.filter((a: any) => !isStructural(a));
        const recentStructural = recent.filter((a: any) => isStructural(a));
        const olderStructural = olderPool.filter((a: any) => isStructural(a));
        const _seenInPlay = new Set<string>();
        // PATCH 1097 — Off-topic noise filter. Same regex as the news feed page;
        // drops sports / entertainment / exam-result / lifestyle filler that
        // aggregator feeds push into financial news streams. Structural items
        // (synthetic theses, persistent themes) bypass this filter.
        const OFF_TOPIC_RX = /\b(?:fifa|world cup|premier league|epl|la liga|champions league|champions trophy|playing xi|kick[- ]?off|how to watch|ipl |bcci|t20 |ranji|cricket\s+(?:match|score|live)|football\s+(?:match|score|live)|live[- ]?stream(?:ing)?\s+(?:of\s+|the\s+)?(?:match|tv|online|.*\bvs\s)|bollywood|hollywood|box office|movie review|film review|web series|trailer launch|album launch|concert tour|msbte|neet result|jee main|jee advanced|upsc (?:result|prelims|mains)|ssc (?:cgl|chsl|result)|cbse (?:result|class\s+(?:10|12))|icse result|(?:10th|12th|diploma)\s+result|admit card|hall ticket|answer key|merit list|cut[- ]?off list|direct link.*download|horoscope|astrology|lottery|jackpot|recipe)\b/i;
        const isStructuralAny = (a: any) => !!a?.is_synthetic
          || a?.feed_layer === 'STRUCTURAL_ALPHA'
          || a?.freshness_layer === 'PERSISTENT_THEME';
        const final = [...clean, ...olderClean, ...recentStructural, ...olderStructural]
          .filter((a: any) => {
            const k = String(a?.id || a?.url || a?.source_url || a?.title || a?.headline || '');
            if (!k || _seenInPlay.has(k)) return false;
            _seenInPlay.add(k);
            // PATCH 1097 — drop off-topic noise unless structural.
            if (!isStructuralAny(a)) {
              const blob = `${a?.title || ''} ${a?.headline || ''} ${a?.summary || ''}`;
              if (OFF_TOPIC_RX.test(blob)) return false;
            }
            return true;
          });
        setData((d) => {
          // Keep last-good list when a refresh fails (429/timeout/network) — never wipe a working panel with an error state.
          const keepOld = !!error && final.length === 0 && Array.isArray((d as any).inPlay) && (d as any).inPlay.length > 0;
          return {
            ...d,
            // PATCH 1086 — MED-05: drop stale articles (>7 days old) before slicing so IN-PLAY doesn't mix 22/61/130-day-old items with today's
            // PATCH 1096b — split into "fresh" (<36h) for the visible IN-PLAY top
            // and "recent context" (36h-7d) for the collapsed tail. Keeps the
            // top truly active without losing the older-but-relevant items.
            inPlay: keepOld
              ? (d as any).inPlay
              : final.filter((n: any) => {
                  try {
                    const dd = new Date(n.published_at || n.date || n.time);
                    const ageMs = Date.now() - dd.getTime();
                    return ageMs < 36 * 3600e3; // <36h
                  } catch { return true; }
                }).slice(0, 15),
            inPlayRecent: keepOld
              ? []
              : final.filter((n: any) => {
                  try {
                    const dd = new Date(n.published_at || n.date || n.time);
                    const ageMs = Date.now() - dd.getTime();
                    return ageMs >= 36 * 3600e3 && ageMs < 7 * 86400e3; // 36h–7d
                  } catch { return false; }
                }).slice(0, 10),
            inPlayDiag: keepOld
              ? { ...(d as any).inPlayDiag, staleKept: true, lastError: error, status }
              : { fetched: raw.length, recent: recent.length, clean: clean.length, fellBack: clean.length === 0 && recent.length > 0, error, status },
          } as any;
        });
        setNetLoading((n) => ({ ...n, inPlay: false }));
      });

      // Bottleneck dashboard
      safe<any>('/api/v1/news/bottleneck-dashboard').then((j) => {
        if (cancelled) return;
        const bottleneck = ((j?.buckets || []) as BottleneckBucket[]).slice();
        const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        bottleneck.sort((a, b) => (sevOrder[(a.severity_label || '').toLowerCase()] ?? 9) - (sevOrder[(b.severity_label || '').toLowerCase()] ?? 9)
                                || (b.article_count || 0) - (a.article_count || 0));
        setData((d) => ({ ...d, bottleneck: bottleneck.slice(0, 5) }));
        setNetLoading((n) => ({ ...n, bottleneck: false }));
      });

      // PATCH 0617 — Concall Intelligence summary on Home.
      // Pulls the same /concall-intel/live-feed used by Rating Actions
      // (Patch 0599) and surfaces the top 5 most-recent hits with tier.
      safe<any>(`/api/v1/concall-intel/live-feed?days=14&_=${Date.now()}`).then((j) => {
        if (cancelled) return;
        const raw = Array.isArray(j) ? j : (j?.items || j?.articles || j?.results || []);
        const hits = (raw as any[])
          .filter((a: any) => a && (a.headline || a.title))
          .map((a: any) => ({
            ticker: (a.ticker || a.primary_ticker || a.symbol || '').toString(),
            company: a.company || a.company_name,
            headline: a.headline || a.title || '',
            tier: a.tier || a.investment_tier || a.classification,
            published_at: a.published_at || a.date,
          }))
          .filter((h: any) => h.ticker && h.headline)
          .slice(0, 8);
        setData((d) => ({ ...d, concallHits: hits } as any));
      });

      // PATCH 0621 — Strategic Visibility latest transformational news.
      // PATCH 0644 — bump timeout 18s -> 25s; retry once on first failure.
      const fetchStratVis = async (attempt: number = 0): Promise<void> => {
        const { data: j } = await safeDiag<any>(`/api/v1/news?transformational=1&window_days=365&limit=8&_=${Date.now()}`, 25_000);
        if (cancelled) return;
        const articles = (j?.articles || j?.items || []).slice(0, 6);
        if (articles.length === 0 && attempt < 1) {
          // Retry once after 1.5s (handles Vercel cold-start race)
          setTimeout(() => { if (!cancelled) fetchStratVis(attempt + 1); }, 1500);
          return;
        }
        setData((d) => ({ ...d, stratVis: articles } as any));
      };
      fetchStratVis(0);

      // PATCH 0775 — Home Top Movers is OWN-UNIVERSE only:
      //   gainers/losers limited to (watchlist ∪ portfolio ∪ conviction beats).
      // User feedback: "it used to work only for my watchlist, portfolio,
      // conviction beats in my watchlist not for all companies. now fix it
      // and make it that way." The /movers full page still shows the broad
      // market — this is just the home dashboard panel filter.
      safeDiag<any>(`/api/market/quotes?market=india&_=${Date.now()}`, 30_000).then(async ({ data: j }) => {
        if (cancelled) return;
        if (!j) return; // failed refresh (429/timeout) — keep the last-good movers/sector data instead of wiping it
        // Build the user's universe (UPPER + suffix-stripped tickers).
        const norm = (s: string) => (s || '').toString().toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
        const universe = new Set<string>();
        try {
          const wl: string[] = JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]') || [];
          wl.forEach((t) => universe.add(norm(t)));
        } catch {}
        try {
          const cb = getConvictionTickers();
          cb.forEach((t) => universe.add(norm(t)));
        } catch {}
        try {
          const ph: any[] = JSON.parse(localStorage.getItem('portfolioHoldings') || '[]') || [];
          ph.forEach((h) => { if (h?.ticker) universe.add(norm(h.ticker)); });
        } catch {}

        // PATCH 1013 — derive movers from the FULL universe (j.stocks), not the
        // API's pre-sliced top-30. The top-30 by raw % are mostly illiquid micro-
        // caps that the small/mid + liquidity filter then drops, leaving only a
        // handful. Filtering the full universe yields a proper 20 per side.
        const _allStocks: any[] = (j?.stocks && j.stocks.length > 0) ? j.stocks : [ ...(j?.gainers || []), ...(j?.losers || []) ];
        // PATCH 1015 — also drop staleEOD rows here. The full universe j.stocks
        // includes yesterday's BHAVCOPY data (staleEOD:true) during the post-close
        // window, so without this filter NEWGEN/CONCORDBIO etc. (yesterday's big
        // movers) bubble to the top of the home widget even when /movers correctly
        // shows today's gainers. Mirrors the staleEOD filter applied server-side
        // to j.gainers/j.losers (route.ts P1012).
        // PATCH 1034 — mirror server P1012/P1008: only hide staleEOD when market is OPEN.
        // When closed (after-hours / weekend / holiday), the entire universe is BHAVCOPY-
        // sourced staleEOD:true rows; filtering them client-side blanks the widget even
        // though /api/market/quotes correctly returns gainers/losers.
        const _marketOpen1034 = !!j?.marketHours?.indianOpen;
        const _allowStale1034 = (s: any) => _marketOpen1034 ? !s?.staleEOD : true;
        const _rawGAll = _allStocks.filter((s: any) => (s?.changePercent || 0) > 0);
        const _rawLAll = _allStocks.filter((s: any) => (s?.changePercent || 0) < 0);
        let rawG = _rawGAll.filter(_allowStale1034);
        let rawL = _rawLAll.filter(_allowStale1034);
        // Post-close fallback: once the live KV blob ages out (>45 min after close)
        // EVERY row is staleEOD:true and the filter above empties the pool, leaving
        // the MOVERS chip stuck on "loading…" and the panel empty. Those rows are
        // legitimate last-close data, so if filtering removed everything but rows
        // exist, fall back to the unfiltered pools.
        if (rawG.length === 0 && rawL.length === 0 && (_rawGAll.length > 0 || _rawLAll.length > 0)) {
          rawG = _rawGAll;
          rawL = _rawLAll;
        }
        const inUniverse = (s: any) => universe.has(norm(s?.ticker || s?.symbol || ''));
        const smallMidOnly = (arr: any[]) => arr.filter((s: any) => {
          // PATCH 1101ww — Server tags indexGroup as "Midcap 50" / "Smallcap 50"
          // / "Micro" / "NIFTY 50" (full labels), not "mid"/"small". The exact
          // equality check used here previously NEVER matched any stock — so
          // the cascade always fell through to "all liquid" and the home
          // widget filled up with NIFTY-50 large-cap names. Switch to substring
          // match. Exclude "NIFTY 50" / "Large" explicitly so the filter does
          // exactly what its name promises.
          const g = (s?.indexGroup || '').toLowerCase();
          if (!g) return false;
          if (g.includes('nifty 50') || g.startsWith('large')) return false;
          return g.includes('mid') || g.includes('small') || g.includes('micro') || g.includes('nifty next');
        });
        const splitGainersLosers = (arr: any[]) => {
          const g = arr.filter((s: any) => (s?.changePercent || 0) > 0).sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));
          const l = arr.filter((s: any) => (s?.changePercent || 0) < 0).sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0));
          return { g, l };
        };

        // PATCH 0780 — Augment with per-ticker fetch for any universe
        // members the broad quotes response didn't cover. Saves the
        // smallcap user experience whenever upstream NSE index endpoints
        // are degraded (which forces the broad API to fall back to NIFTY 50).
        const broadTickers = new Set((j?.stocks || j?.indicesData || []).map((s: any) => norm(s?.ticker)));
        const missing = Array.from(universe).filter(t => !broadTickers.has(t) && t).slice(0, 20);
        let universeStocks: any[] = [];
        if (missing.length > 0) {
          try {
            const { data: pjson } = await safeDiag<any>(
              `/api/market/quote?symbols=${encodeURIComponent(missing.join(','))}&_=${Date.now()}`,
              15_000
            );
            universeStocks = (pjson?.stocks || []).filter((s: any) => s?.price > 0);
          } catch { /* Yahoo path will still run from broad endpoint cache */ }
        }
        const universeStocksUniverse = universeStocks.filter(inUniverse);
        const { g: uExtraG, l: uExtraL } = splitGainersLosers(universeStocksUniverse);

        // Tier order:
        //   1) Own universe — broad-response intersect + per-ticker fetch (P0780)
        //   2) Small+midcap intersection from broad response (excludes NIFTY 50 noise)
        //   3) Full broad response (last resort, never blank)
        // PATCH 0796 — institutional movers display:
        //   • Volume filter ≥ 10 lakh (1,000,000 shares) — drop illiquid noise
        //   • Strict abs(%) DESC sort within both sides (market-wide ranking)
        //   • Universe priority dropped — show explosive movers from anywhere;
        //     own-universe names get a 👁 badge in the renderer instead
        //   • Top 15 each side (gives ~5 extreme + ~10 standard); tier
        //     split happens at render time
        const MIN_VOLUME = 500_000; // 5 lakh shares (per user spec)
        const liquid = (s: any) => (s?.volume || 0) >= MIN_VOLUME;
        // PATCH 0858 — Cascading fallback: liquid → all (when volume field is
        // missing on weekend BHAVCOPY snapshot, liquid filter would otherwise
        // produce empty list, then user sees 'No movers data' even though the
        // API returned 30 gainers + 30 losers).
        // PATCH 1001 — restore small/mid-cap focus + 20 per side. Cascade per
        // side: small/mid + liquid -> small/mid (any vol) -> liquid -> all.
        // Large-cap NIFTY-50 names are excluded whenever the indexGroup field
        // is populated (this panel is for actionable small/mid moves, not index
        // heavyweights); falls back gracefully when indexGroup is missing.
        const gSort = (arr: any[]) => arr.slice().sort((a: any, b: any) => (b.changePercent || 0) - (a.changePercent || 0));
        const lSort = (arr: any[]) => arr.slice().sort((a: any, b: any) => (a.changePercent || 0) - (b.changePercent || 0));
        const pickSide = (rawArr: any[], sortFn: (x: any[]) => any[]) => {
          const sm = smallMidOnly(rawArr);
          const smLiquid = sm.filter(liquid);
          if (smLiquid.length > 0) return sortFn(smLiquid);
          if (sm.length > 0) return sortFn(sm);
          const liq = rawArr.filter(liquid);
          if (liq.length > 0) return sortFn(liq);
          return sortFn(rawArr);
        };
        const MOVERS_PER_SIDE = 20;
        const gainers = pickSide(rawG, gSort).slice(0, MOVERS_PER_SIDE);
        const losers = pickSide(rawL, lSort).slice(0, MOVERS_PER_SIDE);
        setData((d) => ({ ...d, gainers, losers, moversUpdatedAt: j?.updatedAt } as any));

        // PATCH 0800 — Fetch Screener fundamentals for EXTREME movers only
        // (≥10%). Fire-and-forget; updates moverFundamentals when resolved.
        // Coverage may be partial (Screener scrape rotates through universe
        // over 1-2 weeks). Missing tickers gracefully return null.
        const extremeTickers = [...gainers, ...losers]
          .filter((m: any) => Math.abs(m.changePercent || 0) >= 5) // PATCH 1014 — was >=10; match scraper's 5% so 5-10% movers also get real reasons
          .map((m: any) => (m.ticker || '').toUpperCase())
          .filter((t: string) => t.length > 0)
          .slice(0, 30);
        if (extremeTickers.length > 0) {
          safeDiag<any>(`/api/market/fundamentals?tickers=${extremeTickers.join(',')}&_=${Date.now()}`, 12_000).then(({ data: f }) => {
            if (cancelled) return;
            const fundamentals = (f?.fundamentals || {}) as Record<string, any>;
            setData((d) => ({ ...d, moverFundamentals: fundamentals } as any));
          }).catch(() => { /* graceful — no fundamentals if KV miss */ });

          // PATCH 0801 — Fetch multi-source news headlines for extreme movers.
          // GH Actions scrapes Google News + Moneycontrol + Trendlyne + Yahoo
          // hourly during market hours. Surfaces real headline as primary
          // driver when the local engine has 'no confirmed trigger'.
          safeDiag<any>(`/api/market/mover-reasons?tickers=${extremeTickers.join(',')}&_=${Date.now()}`, 12_000).then(({ data: r }) => {
            if (cancelled) return;
            const reasons = (r?.reasons || {}) as Record<string, any>;
            setData((d) => ({ ...d, moverReasons: reasons } as any));
          }).catch(() => { /* graceful — no reasons if KV miss */ });
        }

        // PATCH 0794 — compute sector aggregates from the FULL stocks
        // response so attributeMovers can give analyst-grade context
        // ("Pharma sector +1.5% vs index -0.3%; 7 of 12 peers ↑ >3%").
        const _sectorAgg: Record<string, { sum: number; count: number }> = {};
        let _indexSum = 0, _indexCount = 0;
        for (const s of (j?.stocks || [])) {
          const sec = s?.sector || 'Other';
          const cp = Number.isFinite(s?.changePercent) ? s.changePercent : null;
          if (cp === null) continue;
          if (!_sectorAgg[sec]) _sectorAgg[sec] = { sum: 0, count: 0 };
          _sectorAgg[sec].sum += cp; _sectorAgg[sec].count++;
          _indexSum += cp; _indexCount++;
        }
        const sectorAggregates: Record<string, { avgChangePct: number; stockCount: number }> = {};
        for (const [sec, agg] of Object.entries(_sectorAgg)) {
          if (agg.count >= 2) sectorAggregates[sec] = { avgChangePct: agg.sum / agg.count, stockCount: agg.count };
        }
        const indexAvgChangePct = _indexCount > 0 ? _indexSum / _indexCount : undefined;

        // PATCH 0708 — Institutional event-attribution engine.
        // PATCH 0860 — pass microstructure fields so Tier 4 can produce
        // institutional-grade reasoning (delivery%, volume multiple, gap)
        const moverInputs = [...gainers, ...losers].map((m: any) => ({
          ticker: canonicalTicker(m.ticker), // PATCH 0721
          sector: m.sector,
          industry: m.industry,
          changePercent: m.changePercent ?? 0,
          indexGroup: m.indexGroup,
          marketCap: m.marketCap,
          deliveryPct: m.deliveryPct,
          volMultiple: m.volMultiple,
          volume: m.volume,
          previousClose: m.previousClose,
          open: m.open,
          dayHigh: m.dayHigh,
          dayLow: m.dayLow,
          price: m.price,
          // PATCH 0861 — extra fields for causal inference layers
          pctOf52wHigh: m.pctOf52wHigh,
          mom1M: m.mom1M,
          turnoverLacs: m.turnoverLacs,
        })).filter((m) => m.ticker);
        const moverTickers = moverInputs.map((m) => m.ticker);
        if (moverTickers.length > 0) {
          // PATCH 0746 — Outer hard timeout (15s) on the entire enrichment block.
          // When Upstash/backend is degraded (e.g. quota exhausted, NSE upstream
          // 50% failure), individual endpoints can stall. Previously this kept
          // data.moversAttrib === undefined → "analyzing…" rendered forever.
          // Now we ALWAYS fire setData with whatever indices we have, even
          // partial. The Tier-4 fallthrough in attributeMovers labels rows
          // honestly as "no confirmed trigger" instead of leaving "analyzing…".
          const ENRICH_BUDGET_MS = 30_000; // PATCH 1016 — was 15s; the home fires many concurrent fetches, queueing the graded-earnings calls past 15s so attribution ran with EMPTY earnings (earnings movers lost their reason). 30s lets enrichment win the race.
          let enrichSettled = false;
          const fireAttribution = (
            earningsByTicker: Record<string, any>,
            specialByTicker: Record<string, any>,
            filingsBySymbol: Record<string, any[]>,
            newsByTicker: Record<string, any[]>,
          ) => {
            if (enrichSettled || cancelled) return;
            enrichSettled = true;
            const attrib = attributeMovers({
              movers: moverInputs,
              filingsBySymbol,
              newsByTicker,
              earningsByTicker,
              specialByTicker,
              sectorAggregates,
              indexAvgChangePct,
              filingsFeedHealthy: Object.keys(filingsBySymbol).length > 0,
              newsFeedHealthy: Object.keys(newsByTicker).length > 0,
              earningsFeedHealthy: Object.keys(earningsByTicker).length > 0,
            });
            // PATCH 0774 — also run attribution against watchlist names
            // so the Watchlist Pulse card can render the same "why" labels
            // as Top Movers. We rebuild the input list from the latest
            // pulses (which already have ticker + changePercent + cap).
            setData((d) => {
              let watchAttrib: Record<string, MoverAttribution> | undefined;
              const pulses = d.watchlistPulse;
              if (pulses && pulses.length > 0) {
                const watchInputs = pulses.map((p: any) => ({
                  ticker: canonicalTicker(p.ticker),
                  sector: undefined,
                  industry: undefined,
                  changePercent: p.changePercent ?? 0,
                  indexGroup: p.cap,
                  marketCap: undefined,
                })).filter((m: any) => m.ticker);
                watchAttrib = attributeMovers({
                  movers: watchInputs,
                  filingsBySymbol,
                  newsByTicker,
                  earningsByTicker,
                  specialByTicker,
                  sectorAggregates,
                  indexAvgChangePct,
                  filingsFeedHealthy: Object.keys(filingsBySymbol).length > 0,
                  newsFeedHealthy: Object.keys(newsByTicker).length > 0,
                  earningsFeedHealthy: Object.keys(earningsByTicker).length > 0,
                });
                const enrichedPulses = pulses.map((p: any) => ({
                  ...p,
                  attrib: watchAttrib?.[canonicalTicker(p.ticker)],
                }));
                return { ...d, moversAttrib: attrib, moversEarnings: earningsByTicker, watchlistPulse: enrichedPulses as any } as any;
              }
              return { ...d, moversAttrib: attrib, moversEarnings: earningsByTicker } as any;
            });
          };
          // Hard-timeout fallback — fires attribution with empty indices so
          // every row gets at least a Tier-4 honest label.
          const enrichTimeout = setTimeout(() => {
            fireAttribution({}, {}, {}, {});
          }, ENRICH_BUDGET_MS);

          (async () => {
            // PATCH 0712 — five-source enrichment, all parallel:
            //   1. earnings/graded last 5 weekdays  (HIGH-conf earnings catalyst)
            //   2. special-situations               (HIGH-conf OFS/MNA/buyback)
            //   3. concall-intel filings cacheOnly  (HIGH-conf disclosure)
            //   4. news per ticker                  (MEDIUM-conf reporting)
            //   5. peer cross-correlation           (sector_wide detection)
            // Plus a fire-and-forget warm trigger on live-feed (no cacheOnly)
            // so the cache fills for the next page load.

            // PATCH 0715 — centralized via _istLastNWeekdays (lib/market-hours).
            const recentDates = _istLastNWeekdays(5);

            const [feedRes, ssRes, ...gradedResults] = await Promise.all([
              safeDiag<any>('/api/v1/concall-intel/live-feed?days=14&bullishOnly=false&cacheOnly=1', 5_000),
              safeDiag<any>('/api/v1/special-situations/feed', 12_000),  // PATCH 0823 — was /api/v1/special-situations (404)
              ...recentDates.map((d) => safeDiag<any>(`/api/v1/earnings/graded?date=${d}`, 12_000)),
            ]);
            if (cancelled) return;

            // 1. Filings indexed by symbol
            const filingsBySymbol: Record<string, any[]> = {};
            const feedData = feedRes?.data;
            if (feedData?.filings && Array.isArray(feedData.filings)) {
              for (const f of feedData.filings) {
                const sym = canonicalTicker(f.symbol); // PATCH 0721
                if (!sym) continue;
                if (!filingsBySymbol[sym]) filingsBySymbol[sym] = [];
                filingsBySymbol[sym].push(f);
              }
            }

            // 2. Earnings by ticker — pool across all 5 dates, keep most recent
            const earningsByTicker: Record<string, any> = {};
            for (const r of gradedResults) {
              const g = r?.data;
              if (!g?.by_tier || typeof g.by_tier !== 'object') continue;
              for (const [tier, items] of Object.entries(g.by_tier)) {
                if (!Array.isArray(items)) continue;
                for (const item of items as any[]) {
                  const sym = canonicalTicker(item.ticker || item.symbol); // PATCH 0721
                  if (!sym) continue;
                  const existing = earningsByTicker[sym];
                  if (existing && existing.filing_date >= (item.filing_date || g.filing_date)) continue;
                  earningsByTicker[sym] = {
                    ticker: sym,
                    tier,
                    quarter: item.quarter,
                    filing_date: item.filing_date || g.filing_date,
                    sales_yoy_pct: item.sales_yoy_pct,
                    net_profit_yoy_pct: item.net_profit_yoy_pct,
                    eps_yoy_pct: item.eps_yoy_pct,
                  };
                }
              }
            }

            // 3. Special situations — PATCH 0824 actual shape from
            // /api/v1/special-situations/feed:
            //   { events: [{event_id, event_type, category, primary_filing,
            //               tickers:[], region, lifecycle, tier, ...}],
            //     by_category: { MA: [{id, title, link, source, tickers:[], ...}], ... },
            //     total, by_tier }
            const specialByTicker: Record<string, any> = {};
            const ssData = ssRes?.data || {};
            const ssEvents: any[] = Array.isArray(ssData)
              ? ssData
              : (ssData.events || []);
            // Also flatten by_category items as a richer fallback (87 items vs 31 events)
            const byCategory = ssData.by_category || {};
            const ssCategoryItems: any[] = [];
            for (const [cat, items] of Object.entries(byCategory)) {
              if (!Array.isArray(items)) continue;
              for (const item of items as any[]) {
                ssCategoryItems.push({ ...item, _category: cat });
              }
            }
            const allSsItems: any[] = [...ssEvents, ...ssCategoryItems];

            // Helper — extract ticker (events use tickers[], legacy items use ticker)
            const extractTicker = (ev: any): string => {
              if (Array.isArray(ev.tickers) && ev.tickers.length > 0) return String(ev.tickers[0]).toUpperCase().replace(/\.(NS|BO)$/i, '');
              if (ev.ticker) return String(ev.ticker).toUpperCase().replace(/\.(NS|BO)$/i, '');
              if (ev.target) return String(ev.target).toUpperCase().replace(/\.(NS|BO)$/i, '');
              if (ev.symbol) return String(ev.symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
              return '';
            };
            const extractHeadline = (ev: any): string => {
              return ev.headline || ev.title || ev.primary_filing?.title || ev.why_tradable?.what_happened || '';
            };
            const extractEventType = (ev: any): string => {
              return ev.event_type || ev.type || ev._category || ev.category || 'CORPORATE_ACTION';
            };
            const extractAnnouncedAt = (ev: any): string | null => {
              return ev.announced_at || ev.date || ev.pub_date || ev.primary_filing?.pub_date || null;
            };

            for (const ev of allSsItems) {
              const sym = extractTicker(ev);
              if (!sym) continue;
              if (specialByTicker[sym]) continue;
              specialByTicker[sym] = {
                ticker: sym,
                event_type: extractEventType(ev),
                sub_category: ev.sub_category || ev.category_label,
                announced_at: extractAnnouncedAt(ev),
                headline: extractHeadline(ev),
                source_url: ev.source_url || ev.url || ev.link || ev.primary_filing?.link,
              };
            }

            // PATCH 0859 — Home Special Situations rail: DIRECT-TRADE items only.
            // Previously the rail dumped raw by_category items including law-court
            // judgments (TURN bucket: 'Section 2(1)(e) of Arbitration Act…',
            // 'Shaifali Steels vs ITO'). User correctly flagged: 'wired a raw
            // law-judgment RSS dump straight into a Special Situations rail with
            // almost no product thinking'. Now:
            //   (a) PREFER the structured events[] stream (BUYBACK_TENDER /
            //       OPEN_OFFER / SCHEME / DEMERGER / RIGHTS / etc with real tickers
            //       extracted from filings).
            //   (b) DROP law-judgment-shaped headlines (regex on title).
            //   (c) DROP bogus ticker abbreviations (UBS/OTP/QIP/PLI class).
            //   (d) DROP items with no real corporate-action keyword in title.
            //   (e) DEDUP by canonical key.
            //   (f) Cap top rail at 12.
            // Heavier law-precedent items still flow to /special-situations full
            // page; the home rail is curated.

            // Heuristic: real listed-equity ticker pattern (2-12 uppercase letters,
            // optional digits, no common abbreviation noise).
            const NOISE_TICKERS = new Set(['OTP','UBS','QIP','PLI','SEBI','NCLT','RBI','GST','IBC','RERA','REAT','HC','SC','CIRP','NPA','OFS','OEM','MOU','LOA','LOI','PSU','NBFC','AMC','FII','DII','API','PAT','OPM','PBT','PBIT','EBITDA','NSE','BSE','MCA','SAT','IT','ITO','CIT','PCIT','AO','ITR','AT','GSTR']);
            const isValidTicker = (t: string) => {
              if (!t) return false;
              const T = String(t).toUpperCase().trim();
              if (NOISE_TICKERS.has(T)) return false;
              return /^[A-Z][A-Z0-9&-]{1,11}$/.test(T);
            };

            // Heuristic: law-judgment / case-citation pattern.
            const isLawJudgment = (title: string) => {
              if (!title) return false;
              const t = String(title);
              // Case citation: 'X vs Y', 'X v. Y', 'X versus Y'
              if (/\b(?:vs?\.?|versus)\s+[A-Z][A-Za-z]/.test(t)) return true;
              // Section / Act / Article citations
              if (/Section\s+\d+|Act,?\s*\d{4}|Article\s+\d+|Rule\s+\d+/i.test(t)) return true;
              // Court / tribunal references
              if (/\b(High Court|Supreme Court|Madras HC|Delhi HC|Mumbai HC|Bombay HC|Calcutta HC|NCLT|NCLAT|REAT|RERA Tribunal|SAT|ITAT|Tribunal\b)/i.test(t)) return true;
              return false;
            };

            // Heuristic: corporate-action keywords (positive filter for home rail)
            const CORP_ACTION_RE = /(?:buyback|tender|open offer|OFS|merger|demerger|scheme of arrangement|rights issue|preferential (?:allotment|issue)|delisting|spin-?off|split[- ]off|QIP|FPO|stake (?:sale|acquisition)|capital reduction|warrant conversion|bonus issue|share split|stock split)/i;

            // Structured events FIRST — these are the institutional-grade rows.
            const structuredEventTypes = new Set([
              'BUYBACK_TENDER','OPEN_OFFER','SCHEME_OF_ARRANGEMENT','DEMERGER','MERGER','MA',
              'RIGHTS_ISSUE','DELISTING','SPIN_OFF','PREFERENTIAL','QIP','FPO',
              'STAKE_SALE','WARRANT_CONVERSION','BONUS','STOCK_SPLIT','CAPITAL_REDUCTION',
            ]);

            const _candidates: any[] = [];
            for (const ev of allSsItems) {
              const ticker = extractTicker(ev);
              const headline = extractHeadline(ev);
              const eventType = extractEventType(ev);
              if (!ticker || !headline) continue;
              // Drop noise tickers
              if (!isValidTicker(ticker)) continue;
              // Drop law-judgment headlines
              if (isLawJudgment(headline)) continue;
              // Direct-trade filter: structured event_type OR title contains real corp-action keyword
              const isStructured = structuredEventTypes.has(String(eventType).toUpperCase());
              const hasCorpAction = CORP_ACTION_RE.test(headline);
              if (!isStructured && !hasCorpAction) continue;
              // Tradeability tier
              const tradeability = isStructured ? 'DIRECT_TRADE' : 'CORP_ACTION_NEWS';
              _candidates.push({
                ticker,
                company: ev.company || ev.target_company || ev.acquirer,
                event_type: eventType,
                sub_category: ev.sub_category || ev.category_label,
                announced_at: extractAnnouncedAt(ev),
                next_catalyst_date: ev.next_catalyst_date,
                headline: headline.replace(/\s+/g, ' ').trim().slice(0, 140),
                source_url: ev.source_url || ev.url || ev.link || ev.primary_filing?.link,
                expected_alpha: ev.expected_alpha,
                source_tier: ev.source_tier || ev.tier,
                region: ev.region,
                lifecycle: ev.lifecycle,
                tradeability,
              });
            }

            // Dedup by canonical key: event_type + ticker + first-60-chars-of-headline.
            const seen = new Set<string>();
            const deduped = _candidates.filter((x) => {
              const k = `${x.event_type}|${x.ticker}|${(x.headline || '').toLowerCase().slice(0, 60)}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });

            // Sort: DIRECT_TRADE first, then by recency.
            const ssForHome = deduped
              .sort((a: any, b: any) => {
                if (a.tradeability !== b.tradeability) {
                  return a.tradeability === 'DIRECT_TRADE' ? -1 : 1;
                }
                const ta = new Date(a.announced_at || 0).getTime();
                const tb = new Date(b.announced_at || 0).getTime();
                return tb - ta;
              })
              .slice(0, 12);  // cap top rail per user spec
            setData((d) => ({ ...d, specialSituations: ssForHome } as any));

            // 4. News per ticker (parallel, bounded)
            // PATCH 0724 — Dual-source: standard /api/v1/news pipeline
            // PLUS free RSS fallback (/api/v1/news-india/<ticker>) for
            // smallcap names the editorial cache misses (MINDACORP,
            // SPARC, RATEGAIN class). Both sources fetch in parallel,
            // 5s per ticker, total 8s budget enforced via Promise.race.
            const newsByTicker: Record<string, any[]> = {};
            const moverInputByTicker = new Map(moverInputs.map((m: any) => [m.ticker, m]));
            // PATCH 0887/0888 — Build a ticker → companyName map from EVERY
            // available source. Priority: hardcoded NSE map (highest) → user
            // localStorage uploads → heuristic derive. So BLISSGVS will resolve
            // to "Bliss GVS Pharma" even if the user has never uploaded a CSV.
            const companyNameByTicker: Record<string, string> = { ..._NSE_TICKER_NAMES };
            try {
              // 1. India multibagger rows have companyName populated from
              //    Screener uploads.
              const indiaRows = JSON.parse(localStorage.getItem('mb_excel_scored_v2') || '[]');
              if (Array.isArray(indiaRows)) {
                for (const r of indiaRows) {
                  const t = (r?.symbol || '').toString().toUpperCase().trim();
                  const n = (r?.company || r?.companyName || '').toString().trim();
                  if (t && n && n.toUpperCase() !== t) companyNameByTicker[t] = n;
                }
              }
              // 2. Conviction Beats has companyName too.
              const cbList = JSON.parse(localStorage.getItem('mc:conviction-beats:v1') || '[]');
              if (Array.isArray(cbList)) {
                for (const e of cbList) {
                  const t = (e?.symbol || e?.ticker || '').toString().toUpperCase().trim();
                  const n = (e?.companyName || e?.company || '').toString().trim();
                  if (t && n && n.toUpperCase() !== t && !companyNameByTicker[t]) companyNameByTicker[t] = n;
                }
              }
              // 3. USA multibagger.
              const usaRows = JSON.parse(localStorage.getItem('mb_usa_scored_v1') || '[]');
              if (Array.isArray(usaRows)) {
                for (const r of usaRows) {
                  const t = (r?.symbol || '').toString().toUpperCase().trim();
                  const n = (r?.company || r?.companyName || '').toString().trim();
                  if (t && n && n.toUpperCase() !== t && !companyNameByTicker[t]) companyNameByTicker[t] = n;
                }
              }
            } catch {/* localStorage may not be available SSR */}
            // PATCH 0887 — Heuristic: derive a plausible 2-word company prefix
            // from the ticker when we have no real name (BLISSGVS → "Bliss GVS").
            // This is a best-effort fallback; the news-india endpoint also runs
            // its own deriveNameTokens internally (patch 0886).
            const derivePrefix = (sym: string): string | null => {
              const t = (sym || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
              if (t.length < 6) return null;
              // Try splitting at a few plausible boundaries (chars 4-7)
              for (let i = 5; i >= 4; i--) {
                if (i + 2 <= t.length) {
                  const a = t.slice(0, i);
                  const b = t.slice(i);
                  return `${a.charAt(0)}${a.slice(1).toLowerCase()} ${b.charAt(0)}${b.slice(1).toLowerCase()}`;
                }
              }
              return null;
            };
            const NEWS_TOTAL_BUDGET_MS = 8_000;
            const PER_TICKER_TIMEOUT_MS = 5_000;
            const enrichAllNews = (async () => {
              await Promise.all(moverTickers.map(async (t) => {
                const meta = moverInputByTicker.get(t);
                // PATCH 0887 — Build the BEST news-search query for this ticker.
                // Priority: explicit local-name → derived prefix → bare ticker.
                // Build two query strings: one for the main /api/v1/news search
                // (which does full-text on cached articles) and one for the
                // /api/v1/news-india RSS aggregator (which takes a company hint).
                const explicitName = companyNameByTicker[t] || '';
                const derived = explicitName ? '' : (derivePrefix(t) || '');
                const companyHint = explicitName || derived || '';
                // Main search query: prefer company name (will match "Bliss GVS
                // Pharma shares jump"); fall back to ticker. Pass BOTH when we
                // have a name so the search index can disambiguate.
                const mainSearch = companyHint
                  ? `${companyHint} ${t}`.trim().slice(0, 80)
                  : t;
                const indiaQS = new URLSearchParams();
                if (companyHint) indiaQS.set('company', companyHint);
                const indiaSuffix = indiaQS.toString() ? `?${indiaQS.toString()}` : '';
                const [stdRes, indiaRes] = await Promise.all([
                  safeDiag<any>(
                    `/api/v1/news?search=${encodeURIComponent(mainSearch)}&limit=8`,
                    PER_TICKER_TIMEOUT_MS,
                  ).catch(() => ({ data: null })),
                  safeDiag<any>(
                    `/api/v1/news-india/${encodeURIComponent(t)}${indiaSuffix}`,
                    PER_TICKER_TIMEOUT_MS,
                  ).catch(() => ({ data: null })),
                ]);
                const stdArticles: any[] = Array.isArray(stdRes?.data)
                  ? stdRes.data
                  : (stdRes?.data?.articles || stdRes?.data?.items || []);
                const indiaArticles: any[] = Array.isArray(indiaRes?.data?.articles)
                  ? indiaRes.data.articles
                  : (indiaRes?.data?.items || []);
                // Merge + dedupe by normalized title so the standard pipeline
                // wins authority but Indian RSS fills the gaps.
                const merged: any[] = [];
                const seen = new Set<string>();
                for (const a of [...stdArticles, ...indiaArticles]) {
                  const key = (a?.title || a?.headline || a?.url || '')
                    .toString()
                    .toLowerCase()
                    .replace(/\s+/g, ' ')
                    .trim();
                  if (!key || seen.has(key)) continue;
                  seen.add(key);
                  merged.push(a);
                }
                if (merged.length > 0) newsByTicker[t] = merged;
              }));
            })();
            await Promise.race([
              enrichAllNews,
              new Promise<void>((resolve) => setTimeout(resolve, NEWS_TOTAL_BUDGET_MS)),
            ]);
            if (cancelled) return;

            // 5. Fire-and-forget warm: hit live-feed WITHOUT cacheOnly so the
            //    KV cache fills for next load. No await, no block on home.
            if (!feedData?.filings?.length) {
              fetch('/api/v1/concall-intel/live-feed?days=14&bullishOnly=false', { cache: 'no-store' })
                .catch(() => {/* fire-and-forget */});
            }

            // 6. Run attribution engine — PATCH 0746 uses fireAttribution which
            //    races the outer 15s timeout. First call wins; subsequent calls
            //    are no-ops via the enrichSettled flag.
            clearTimeout(enrichTimeout);
            fireAttribution(earningsByTicker, specialByTicker, filingsBySymbol, newsByTicker);
          })().catch(() => {
            // PATCH 0746 — any uncaught error in the enrichment block still
            //    triggers attribution with empty indices so rows are labeled.
            clearTimeout(enrichTimeout);
            fireAttribution({}, {}, {}, {});
          });
        }
      });

      // PATCH 0624 — Super Investors panel = flow API + static roster combined.
      // The flow API is genuinely sparse upstream (only 7 rows in 180d at probe
      // time). The /lib/super-investors.ts static roster has 10 investors with
      // 100+ disclosed holdings, each with a disclosedOn date — that's the
      // dataset that actually gives the user something to act on.
      // Strategy: take live flow rows first (recent activity), then top up with
      // the most-recently-disclosed static holdings — dedupe by ticker.
      (async () => {
        const cleanFlow = (rawRows: any[]) => (rawRows || [])
          .filter((r: any) => r?.ticker && r?.investors?.length)
          .filter((r: any) => !/^Q\d\s|first time|^Q[1-4]\s/i.test(r.ticker))
          .filter((r: any) => r.ticker.length < 40)
          .map((r: any) => ({ ...r, kind: 'flow' as const, investorName: (r.investors || [])[0] }));

        let j: any = await safe<any>(`/api/v1/super-investor-flow?days=60&_=${Date.now()}`);
        if (cancelled) return;
        let flow = cleanFlow(j?.rows || []);
        if (flow.length < 3) {
          j = await safe<any>(`/api/v1/super-investor-flow?days=180&_=${Date.now()}`);
          if (cancelled) return;
          flow = cleanFlow(j?.rows || []);
        }

        // Static roster: flatten + sort by stake desc, then by disclosure date desc
        const rosterRows = SUPER_INVESTORS.flatMap((inv) =>
          (inv.topHoldings || []).map((h) => ({
            ticker: h.ticker,
            company: h.company,
            stakePct: h.stakePct,
            disclosedOn: h.disclosedOn,
            investorName: inv.name,
            investors: [inv.name],
            kind: 'roster' as const,
            topDirection: 'ACCUM',
            lastMoveAt: h.disclosedOn,
          })),
        )
        .sort((a, b) => {
          const dateCompare = (b.disclosedOn || '').localeCompare(a.disclosedOn || '');
          if (dateCompare !== 0) return dateCompare;
          return (b.stakePct || 0) - (a.stakePct || 0);
        });

        // Merge: flow first (recent activity), then roster, dedupe by ticker
        const seen = new Set<string>();
        const combined: any[] = [];
        for (const r of [...flow, ...rosterRows]) {
          const k = (r.ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
          if (!k || seen.has(k)) continue;
          seen.add(k);
          combined.push(r);
          if (combined.length >= 12) break;
        }
        setData((d) => ({ ...d, superInvestors: combined } as any));
      })();

      // PATCH 0778 — Signals: corporate news pulled at importance>=2,
      // then prioritized to (CB ∪ Watchlist ∪ Portfolio) names first.
      // Falls back to broader corporate signals when no own-universe
      // hits, so the panel never goes empty for new users.
      // Region preference: 'India' tagged news first, then anything else.
      safeDiag<any>(`/api/v1/news?limit=80&importance_min=2&article_type=CORPORATE&_=${Date.now()}`, 18_000).then(({ data: j }) => {
        if (cancelled) return;
        const raw = Array.isArray(j) ? j : (j?.articles || j?.items || []);
        const stripCdata = (s: any) => typeof s === 'string'
          ? s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
          : s;
        const norm = (s: string) => (s || '').toString().toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
        const universe = new Set<string>();
        try {
          const wl: string[] = JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]') || [];
          wl.forEach((t) => universe.add(norm(t)));
        } catch {}
        try {
          const cb = getConvictionTickers();
          cb.forEach((t) => universe.add(norm(t)));
        } catch {}
        try {
          const ph: any[] = JSON.parse(localStorage.getItem('portfolioHoldings') || '[]') || [];
          ph.forEach((h) => { if (h?.ticker) universe.add(norm(h.ticker)); });
        } catch {}

        const all = (raw as any[])
          .filter((a: any) => !a?.is_synthetic && !a?.structural_status && !(a?.title || '').startsWith('[STRUCTURAL'))
          .map((a: any) => ({
            ...a,
            url: stripCdata(a?.url),
            source_url: stripCdata(a?.source_url),
            title: stripCdata(a?.title),
            headline: stripCdata(a?.headline),
          }));

        const inUniverse = (a: any) => {
          if (universe.size === 0) return false;
          if (a?.primary_ticker && universe.has(norm(a.primary_ticker))) return true;
          if (Array.isArray(a?.ticker_symbols)) {
            return a.ticker_symbols.some((t: any) => universe.has(norm(t)));
          }
          return false;
        };
        const isIndian = (a: any) => {
          const r = (a?.region || a?.market || '').toString().toLowerCase();
          if (r === 'india' || r === 'in') return true;
          // Heuristic: ticker chip looks like NSE/BSE
          if (a?.primary_ticker && /^[A-Z0-9&-]{2,12}$/.test(a.primary_ticker) && !/^[A-Z]{1,5}$/.test(a.primary_ticker)) return true;
          return false;
        };

        // Tier 1: own universe + recent (any region)
        const tier1 = all.filter((a: any) => inUniverse(a));
        // Tier 2: Indian corporate signals (not in universe)
        const tier2 = all.filter((a: any) => !inUniverse(a) && isIndian(a));
        // Tier 3: anything else (US/global)
        const tier3 = all.filter((a: any) => !inUniverse(a) && !isIndian(a));

        const merged = [...tier1, ...tier2, ...tier3].slice(0, 30);  // PATCH 0864: bump 25 → 30 per user
        setData((d) => ({ ...d, signals: merged } as any));
      });

      // PATCH 0622 — Portfolio P&L + Watchlist Pulse + Sector Rotation —
      // all derived from a single quotes fetch which we also use for Movers.
      // The Movers fetch above already runs; we ride on the same /quotes call.
      safeDiag<any>(`/api/market/quotes?market=india&_=${Date.now()}`, 30_000).then(({ data: j }) => {
        if (cancelled) return;
        const stocks: any[] = j?.stocks || [];
        const byTicker = new Map<string, any>();
        for (const s of stocks) {
          const sym = (s.ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
          if (sym) byTicker.set(sym, s);
        }

        // Portfolio P&L
        let portfolioHoldings: any[] = [];
        try { portfolioHoldings = JSON.parse(localStorage.getItem('mc_portfolio_holdings') || '[]') || []; } catch {}
        if (portfolioHoldings.length > 0) {
          let totalEntry = 0, totalCurrent = 0, covered = 0;
          let best = { ticker: '', pct: -Infinity };
          let worst = { ticker: '', pct: Infinity };
          for (const h of portfolioHoldings) {
            const sym = (h.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
            const q = byTicker.get(sym);
            if (!q || !h.quantity || !h.entryPrice) continue;
            const entryVal = h.quantity * h.entryPrice;
            const curVal = h.quantity * (q.price ?? h.entryPrice);
            totalEntry += entryVal;
            totalCurrent += curVal;
            covered++;
            const namePct = q.changePercent ?? 0;
            if (namePct > best.pct) best = { ticker: sym, pct: namePct };
            if (namePct < worst.pct) worst = { ticker: sym, pct: namePct };
          }
          if (covered > 0 && totalEntry > 0) {
            const totalChangeRs = totalCurrent - totalEntry;
            const totalPct = (totalChangeRs / totalEntry) * 100;
            setData((d) => ({
              ...d,
              portfolioPnl: {
                totalPct, totalChangeRs,
                bestMover: best.ticker ? best : undefined,
                worstMover: worst.ticker ? worst : undefined,
                positions: portfolioHoldings.length,
                covered,
              },
            } as any));
          }
        }

        // Watchlist Pulse — PATCH 0774
        //   (a) Carries indexGroup so the renderer can apply a small+mid
        //       cap filter (user feedback: home Movers + Pulse should
        //       prioritize actionable small/midcap moves, not large-caps).
        //   (b) Reuses the same MoverAttribution engine that powers Top
        //       Movers so each row gets a "why it's up/down" label
        //       instead of a bare "+X.X%" snippet.
        let watchlist: string[] = [];
        try { watchlist = JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]') || []; } catch {}
        if (watchlist.length > 0) {
          const allMoves = watchlist
            .map((sym: string) => {
              const key = sym.toUpperCase().replace(/\.(NS|BO)$/i, '');
              const q = byTicker.get(key);
              if (!q) return null;
              const pct = q.changePercent ?? 0;
              return {
                ticker: key,
                company: q.company,
                changePercent: pct,
                price: q.price,
                cap: q.indexGroup,
                reason: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% last close`,
              };
            })
            .filter((x: any) => x !== null) as any[];
          // PATCH 0774 — smallcap/midcap-only filter, fall back to full
          // list when smallcap-only returns empty (typical on weekends
          // or whenever the upstream indexGroup field isn't populated).
          const smallMidOnly = allMoves.filter((x: any) => {
            const g = (x?.cap || '').toLowerCase();
            return g === 'small' || g === 'mid';
          });
          const universe = smallMidOnly.length > 0 ? smallMidOnly : allMoves;
          // PATCH 0858 — drop the ±1% gate. User reported 'All watchlist names
          // closed within ±1% last session' even though the API has fresh data.
          // The previous cascade collapsed to empty when |pct|=0 dominated.
          // Now: just sort ALL watchlist names by abs% DESC, take top 6.
          // Empty-state still fires when universe is genuinely empty.
          const pulses = universe.slice()
            .sort((a: any, b: any) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
            .slice(0, 6);
          setData((d) => ({ ...d, watchlistPulse: pulses as any } as any));
        }

        // Sector rotation — aggregate avg changePercent per sector
        const sectorAgg = new Map<string, { sum: number; count: number }>();
        for (const s of stocks) {
          const sec = s.sector || 'Other';
          const cp = s.changePercent ?? 0;
          if (typeof cp !== 'number') continue;
          const cur = sectorAgg.get(sec) || { sum: 0, count: 0 };
          cur.sum += cp; cur.count++;
          sectorAgg.set(sec, cur);
        }
        const sectors = Array.from(sectorAgg.entries())
          .filter(([s, v]) => v.count >= 3 && s !== 'Other' && s !== 'Diversified')
          .map(([sector, v]) => ({ sector, pct: v.sum / v.count }));
        if (sectors.length > 0) {
          sectors.sort((a, b) => b.pct - a.pct);
          setData((d) => ({ ...d, sectorRotation: { topSector: sectors[0], bottomSector: sectors[sectors.length - 1] } } as any));
        }

        // PATCH 0905 — Sector Pulse (mini heatmap) — same source as
        // sectorRotation, but keeps the full ranked list so the home
        // panel can render every sector tile with its top contributor
        // (best gainer / worst loser inside that sector).
        const sectorContrib = new Map<string, { gainer?: { ticker: string; pct: number }; loser?: { ticker: string; pct: number } }>();
        for (const s of stocks) {
          const sec = s.sector || 'Other';
          if (sec === 'Other' || sec === 'Diversified') continue;
          const cp = s.changePercent ?? 0;
          if (typeof cp !== 'number') continue;
          const sym = (s.ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
          const cur = sectorContrib.get(sec) || {};
          if (!cur.gainer || cp > cur.gainer.pct) cur.gainer = { ticker: sym, pct: cp };
          if (!cur.loser || cp < cur.loser.pct) cur.loser = { ticker: sym, pct: cp };
          sectorContrib.set(sec, cur);
        }
        const sectorPulseList = sectors
          .map((sec) => ({
            sector: sec.sector,
            pct: sec.pct,
            count: sectorAgg.get(sec.sector)?.count || 0,
            topGainer: sectorContrib.get(sec.sector)?.gainer,
            topLoser: sectorContrib.get(sec.sector)?.loser,
          }))
          .filter((x) => x.count >= 3)
          .sort((a, b) => b.pct - a.pct);
        if (sectorPulseList.length > 0) {
          setData((d) => ({ ...d, sectorPulse: sectorPulseList } as any));
        }

        // PATCH 0905 — Conviction Beats with live price overlay. User said
        // "keep conviction bets in watchlist also here in home screen i
        // use that more" — so we render the bench inline. Reads from
        // mc:conviction-beats:v1 localStorage, joins by ticker to the
        // live byTicker quote map, sorts BLOCKBUSTER first then by abs%.
        try {
          const cbMap = (() => { try { return JSON.parse(localStorage.getItem('mc:conviction-beats:v1') || '{}') || {}; } catch { return {}; } })();
          const cbEntries = Object.values(cbMap) as any[];
          if (cbEntries.length > 0) {
            const cbRows = cbEntries
              .map((e: any) => {
                const sym = (e.ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
                const q = byTicker.get(sym);
                return {
                  ticker: sym,
                  company: e.company || q?.company,
                  tier: e.tier,
                  sector: e.sector || q?.sector,
                  price: q?.price,
                  changePercent: q?.changePercent,
                  cap: q?.indexGroup,
                  addedAt: e.added_at,
                  filingDate: e.filing_date,
                };
              })
              // PATCH 0905-followup — user feedback: "sort based on moves".
              // Removed the BLOCKBUSTER-tier-first preference. Pure abs %
              // change DESC so the names that are actually MOVING today
              // float to the top of the bench. Rows with no live quote
              // (weekend cold cache) sort last via abs(NaN→0) fallback.
              // Tie-break on recency keeps newer adds above stale ones.
              .sort((a: any, b: any) => {
                const absA = Math.abs(a.changePercent ?? 0);
                const absB = Math.abs(b.changePercent ?? 0);
                if (absA !== absB) return absB - absA;
                return String(b.addedAt || '').localeCompare(String(a.addedAt || ''));
              });
            setData((d) => ({ ...d, convictionLive: cbRows } as any));
          } else {
            setData((d) => ({ ...d, convictionLive: [] } as any));
          }
        } catch {
          setData((d) => ({ ...d, convictionLive: [] } as any));
        }
      });

      // PATCH 0775 + 0841 + 0904 — Upcoming Earnings: now delegated to the
      // component-scope `refetchUpcomingEarnings` useCallback so the Retry
      // button can re-invoke it without window.location.reload() (Bug B).
      refetchUpcomingEarnings();

      // PATCH 0773 — Rating Actions + Order Book fetchers DELETED.
      // Home dashboard no longer renders these panels (see render block
      // below) and the standalone /rating-actions + /order-book pages
      // are also removed. Removing the parallel fetch saves ~2× /news +
      // 1× /concall-intel calls on every home load.

      // Earnings — PATCH 0615. Pull today + last 2 trading days, filter to
      // BLOCKBUSTER + STRONG only (drop MIXED/AVOID — those clutter the home
      // dashboard). Sort by tier+score, dedup by ticker, slice to top 8.
      // Label reflects the date range used: 'today' / 'yesterday' / explicit date.
      (async () => {
        const tradingDays = (() => {
          const out: string[] = [];
          const d = new Date();
          const ist = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000);
          // include today as day 0
          const todayDow = ist.getDay();
          if (todayDow !== 0 && todayDow !== 6) out.push(ist.toISOString().slice(0, 10));
          // walk back up to 10 calendar days, collecting up to 2 weekdays
          for (let i = 0; i < 10 && out.length < 3; i++) {
            ist.setDate(ist.getDate() - 1);
            const dow = ist.getDay();
            if (dow !== 0 && dow !== 6) out.push(ist.toISOString().slice(0, 10));
          }
          return out;
        })();

        // PATCH 0647 — parallelize 3 fetches with 25s timeout each (was 15s
        // sequential = up to 45s total + single failures wiping a whole day).
        // Each individual day uses safeDiag so timeouts don't break the chain.
        const dayResults = await Promise.all(
          tradingDays.map((date) =>
            safeDiag<any>(`/api/v1/earnings/graded?date=${date}&_=${Date.now()}`, 25_000).then(({ data }) => ({ date, data }))
          )
        );
        if (cancelled) return;
        const allCards: any[] = [];
        for (const { date, data: j } of dayResults) {
          const dayCards = flattenGraded(j)
            .filter((c: any) => c?.ticker)
            .filter((c: any) => {
              const t = (c.tier || '').toUpperCase();
              return t === 'BLOCKBUSTER' || t === 'STRONG';
            })
            .map((c: any) => ({ ...c, _date: date }));
          allCards.push(...dayCards);
        }
        // Sort: BLOCKBUSTER first, then by score within tier
        allCards.sort((a: any, b: any) => {
          const aBlock = (a.tier || '').toUpperCase() === 'BLOCKBUSTER' ? 0 : 1;
          const bBlock = (b.tier || '').toUpperCase() === 'BLOCKBUSTER' ? 0 : 1;
          if (aBlock !== bBlock) return aBlock - bBlock;
          return (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9)
              || (b.composite_score ?? 0) - (a.composite_score ?? 0);
        });
        // Dedupe by ticker (keep first occurrence, which will be the highest tier)
        const seen = new Set<string>();
        const deduped = allCards.filter((c: any) => {
          const k = (c.ticker || '').toUpperCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        const today = tradingDays[0];
        const yesterday = tradingDays[1];
        // PATCH 0647 — Better label: today / yesterday / 2 days ago / 3 days ago
        const labelFor = (d: string) => {
          if (d === today) return 'today';
          if (d === yesterday) return 'yesterday';
          const daysAgo = (Date.parse(today) - Date.parse(d)) / (1000 * 60 * 60 * 24);
          if (daysAgo >= 2 && daysAgo <= 7) return `${Math.round(daysAgo)} days ago`;
          return d;
        };
        // PATCH 0750 — weekend awareness. tradingDays[0] is "Friday" when
        // today is Saturday/Sunday IST; we shouldn't call Friday's data
        // "today". Compute the actual IST date and compare. If they differ
        // (= weekend or holiday), use the explicit weekday name instead.
        const actualTodayIst = (() => {
          const d = new Date();
          const ist = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000);
          return ist.toISOString().slice(0, 10);
        })();
        const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const labelForWeekendAware = (d: string) => {
          // When market is closed (today != tradingDays[0]), surface the
          // explicit weekday rather than the misleading "today".
          if (actualTodayIst !== today) {
            const dt = new Date(d + 'T00:00:00Z');
            if (d === today) return WEEKDAY_NAMES[dt.getUTCDay()].toLowerCase();
            return labelFor(d);
          }
          return labelFor(d);
        };
        const label = (() => {
          if (deduped.length === 0) {
            // Weekend empty-state: show weekday name of last working day so
            // header isn't a misleading "TODAY (0)".
            if (actualTodayIst !== today && today) {
              const dt = new Date(today + 'T00:00:00Z');
              return WEEKDAY_NAMES[dt.getUTCDay()].toLowerCase();
            }
            return 'today';
          }
          const dates = Array.from(new Set(deduped.map((c: any) => c._date))).sort().reverse();
          if (dates.length === 1) return labelForWeekendAware(dates[0]);
          return `${labelForWeekendAware(dates[0])} + ${dates.length - 1} more`;
        })();
        setData((d) => ({ ...d, earningsToday: deduped.slice(0, 8), earningsLabel: label }));
        setNetLoading((n) => ({ ...n, earnings: false }));
      })();
    })();
    return () => { cancelled = true; };
    // PATCH 1057 — re-run the entire fetch chain whenever refreshTick changes
    // (every 60s during market hours, 5min after-hours). Each sub-fetch is
    // independent so partial failures don't break the others; setState is
    // per-section so the UI updates smoothly without a full re-render flash.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const activeAlerts = useMemo(() => data.alerts.filter(a => a.enabled), [data.alerts]);
  const portfolioCount = data.portfolio.length;
  // PATCH 0606 — no full-page loading state. Synchronous Tier 1/2/3 + portfolio
  // heat render instantly; network sections show their own loading chip.

  // ─────────────────────────────────────────────────────────────────────
  // PATCH 0613 — Saved Workspaces v1 (lens-switcher chip strip).
  // Filters Tier 1/2/3 cards in real-time. localStorage-persistent.
  // Preset lenses ship out-of-the-box; user can add custom ones via prompt().
  // Stored shape: { id: string; label: string; mode: 'all' | 'cbOnly' | 'aplus' | 'sectorRegex'; sectorRegex?: string; emoji?: string }
  // ─────────────────────────────────────────────────────────────────────
  type Lens = { id: string; label: string; mode: 'all' | 'cbOnly' | 'aplus' | 'sectorRegex'; sectorRegex?: string; emoji?: string };
  const PRESET_LENSES: Lens[] = useMemo(() => [
    { id: 'all',          label: 'ALL',                 mode: 'all',         emoji: '◯' },
    { id: 'cb-only',      label: 'CONVICTION-ONLY',     mode: 'cbOnly',      emoji: '★' },
    { id: 'aplus-only',   label: 'A+ ONLY',             mode: 'aplus',       emoji: '💎' },
    { id: 'industrials',  label: 'INDUSTRIALS',         mode: 'sectorRegex', sectorRegex: 'industrial|capital goods|engineering|machinery|defense|aerospace', emoji: '🏭' },
    { id: 'infra-power',  label: 'INFRA & POWER',       mode: 'sectorRegex', sectorRegex: 'electrical|power|utilit|infra|construction|cement|transmission', emoji: '⚡' },
    { id: 'pharma',       label: 'PHARMA & HEALTHCARE', mode: 'sectorRegex', sectorRegex: 'pharma|health|biotech|medical', emoji: '💊' },
    { id: 'consumer',     label: 'CONSUMER',            mode: 'sectorRegex', sectorRegex: 'consumer|fmcg|retail|durable|personal|textile|jewel', emoji: '🛍' },
  ], []);
  const [customLenses, setCustomLenses] = useState<Lens[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('mc:home-custom-lenses:v1') || '[]') || []; } catch { return []; }
  });
  const [activeLensId, setActiveLensId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    try {
      // PATCH 1101cc — One-time force-reset. The previous "CONVICTION-ONLY" /
      // "A+ ONLY" lens persistence was silently filtering Tier 1 to 3-5 stocks
      // and the user thought their data was broken. Force back to 'all' once
      // via a versioned flag — user can re-activate any lens manually, but the
      // default is no longer sticky from old sessions.
      if (!localStorage.getItem('mc:lens-reset:v2')) {
        localStorage.setItem('mc:home-active-lens:v1', 'all');
        localStorage.setItem('mc:lens-reset:v2', '1');
        return 'all';
      }
      return localStorage.getItem('mc:home-active-lens:v1') || 'all';
    } catch { return 'all'; }
  });
  useEffect(() => {
    try { localStorage.setItem('mc:home-active-lens:v1', activeLensId); } catch {}
  }, [activeLensId]);
  useEffect(() => {
    try { localStorage.setItem('mc:home-custom-lenses:v1', JSON.stringify(customLenses)); } catch {}
  }, [customLenses]);

  const allLenses = useMemo(() => [...PRESET_LENSES, ...customLenses], [PRESET_LENSES, customLenses]);
  const activeLens = useMemo(() => allLenses.find(l => l.id === activeLensId) || PRESET_LENSES[0], [allLenses, activeLensId, PRESET_LENSES]);

  const applyLens = (items: TierAction[], isTier1: boolean): TierAction[] => {
    if (activeLens.mode === 'all') return items;
    if (activeLens.mode === 'cbOnly') return items.filter(it => it.cbConfirmed === true || (isTier1 ? false : true));
    if (activeLens.mode === 'aplus') return items.filter(it => it.grade === 'A+');
    if (activeLens.mode === 'sectorRegex' && activeLens.sectorRegex) {
      const re = new RegExp(activeLens.sectorRegex, 'i');
      return items.filter(it => re.test(it.sector || ''));
    }
    return items;
  };
  const lensedTier1 = useMemo(() => applyLens(data.tier1, true), [data.tier1, activeLens]);
  const lensedTier2 = useMemo(() => applyLens(data.tier2, false), [data.tier2, activeLens]);
  const lensedTier3 = useMemo(() => applyLens(data.tier3, false), [data.tier3, activeLens]);
  // PATCH 0897 — Turnaround tier lensing
  const lensedTurnaround = useMemo(() => applyLens((data as any).turnaroundTier1 || [], true), [(data as any).turnaroundTier1, activeLens]);

  // PATCH 1086 — NEW LENS button. Previous implementation chained two
  // window.prompt() calls which on some browsers (Safari with popups blocked,
  // Brave shields, embedded webviews) silently no-op'd, making the button
  // appear dead. Replaced with an inline modal: name input + filter criteria
  // textarea + Save/Cancel. Persists to the same 'mc:home-custom-lenses:v1'
  // localStorage key via setCustomLenses so the existing render path picks
  // the new lens up immediately with no separate plumbing.
  const [lensModalOpen, setLensModalOpen] = useState(false);
  const [lensModalName, setLensModalName] = useState('');
  const [lensModalPattern, setLensModalPattern] = useState('');
  const [lensModalError, setLensModalError] = useState<string | null>(null);
  const [lensToast, setLensToast] = useState<string | null>(null);
  const addCustomLens = () => {
    setLensModalName('');
    setLensModalPattern('');
    setLensModalError(null);
    setLensModalOpen(true);
  };
  const saveCustomLens = () => {
    const name = lensModalName.trim();
    const pattern = lensModalPattern.trim();
    if (!name) { setLensModalError('Lens name is required'); return; }
    if (!pattern) { setLensModalError('Filter criteria (sector regex) is required'); return; }
    try { new RegExp(pattern, 'i'); } catch { setLensModalError('Filter criteria is not a valid regex'); return; }
    const newLens: Lens = {
      id: `custom-${Date.now()}`,
      label: name.toUpperCase().slice(0, 24),
      mode: 'sectorRegex',
      sectorRegex: pattern,
      emoji: '🎯',
    };
    setCustomLenses(prev => [...prev, newLens]);
    setActiveLensId(newLens.id);
    setLensModalOpen(false);
    setLensToast(`Lens "${newLens.label}" saved`);
    setTimeout(() => setLensToast(null), 2200);
  };
  const removeCustomLens = (id: string) => {
    setCustomLenses(prev => prev.filter(l => l.id !== id));
    if (activeLensId === id) setActiveLensId('all');
  };

  // PATCH 0874 — Defer time/greeting computation to post-mount state so
  // server HTML and first client render agree. Reading `new Date()` in
  // render body produced a hydration mismatch every load (server clock
  // != user clock to the second; also greeting may differ across the
  // noon/6pm boundary). Now both render `Good day` initially, then the
  // useEffect updates to the real greeting + clock.
  const [now, setNow] = useState<Date | null>(null);
  // PATCH 1036 — Position Sizing Calculator on home (shares localStorage key with multibagger)
  const [posCalcCapital, setPosCalcCapital] = useState<number>(40000);
  useEffect(() => { try { const s = localStorage.getItem('mc:posCalc:capital'); if (s && Number(s) > 0) setPosCalcCapital(Number(s)); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('mc:posCalc:capital', String(posCalcCapital)); } catch {} }, [posCalcCapital]);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const greeting = !now ? 'Good day' : now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: TEXT }}>🌅 {greeting}, Rishi</h1>
            <div style={{ marginTop: 6, fontSize: 12, color: DIM, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 6 }}>
              <span>{now ? now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</span>
              <span>·</span>
              <span>{now ? now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '—:—'}</span>
              {/* PATCH 0622 — Stale-data nudge */}
              {typeof data.staleDataAgeDays === 'number' && data.staleDataAgeDays >= 14 && (
                <Link href="/multibagger" style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: data.staleDataAgeDays >= 30 ? 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)' : 'color-mix(in srgb, var(--mc-warn) 13%, transparent)',
                  border: `1px solid ${data.staleDataAgeDays >= 30 ? 'var(--mc-bearish)' : 'var(--mc-warn)'}60`,
                  color: data.staleDataAgeDays >= 30 ? 'var(--mc-bearish)' : 'var(--mc-warn)',
                  fontWeight: 800, textDecoration: 'none',
                }}>
                  ⚠ Multibagger upload {data.staleDataAgeDays}d ago — re-upload to refresh scoring
                </Link>
              )}
              {/* PATCH 0622 — Portfolio P&L line */}
              {data.portfolioPnl && (
                <Link href="/portfolio" style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: data.portfolioPnl.totalPct >= 0 ? 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)',
                  border: `1px solid ${data.portfolioPnl.totalPct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}60`,
                  color: data.portfolioPnl.totalPct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)',
                  fontWeight: 800, textDecoration: 'none',
                }} title={`${data.portfolioPnl.covered} of ${data.portfolioPnl.positions} positions matched`}>
                  {/* Only claim a P&L number when every position has a live price.
                      With partial coverage the chip read as fake (best and worst
                      collapsed to the one matched ticker). */}
                  {data.portfolioPnl.covered >= data.portfolioPnl.positions ? (<>
                    💼 P&L {data.portfolioPnl.totalPct >= 0 ? '+' : ''}{data.portfolioPnl.totalPct.toFixed(2)}%
                    {data.portfolioPnl.positions >= 2 && data.portfolioPnl.bestMover && ` · best ${data.portfolioPnl.bestMover.ticker} ${data.portfolioPnl.bestMover.pct >= 0 ? '+' : ''}${data.portfolioPnl.bestMover.pct.toFixed(1)}%`}
                    {data.portfolioPnl.positions >= 2 && data.portfolioPnl.worstMover && ` · worst ${data.portfolioPnl.worstMover.ticker} ${data.portfolioPnl.worstMover.pct >= 0 ? '+' : ''}${data.portfolioPnl.worstMover.pct.toFixed(1)}%`}
                  </>) : (<>💼 P&L — · add live prices in Portfolio</>)}
                </Link>
              )}
              {/* PATCH 1061 — Playbook state-machine quick-reference chip.
                  Reads localStorage from /playbook tab and surfaces HOLD/WATCH/EXIT
                  counts so the user knows portfolio discipline state at a glance. */}
              {playbookCounts && (playbookCounts.H + playbookCounts.W + playbookCounts.E) > 0 && (
                <Link href="/playbook" style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: playbookCounts.E > 0 ? 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)' : (playbookCounts.W > 0 ? 'color-mix(in srgb, var(--mc-warn) 13%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)'),
                  border: `1px solid ${playbookCounts.E > 0 ? 'var(--mc-bearish)' : (playbookCounts.W > 0 ? 'var(--mc-warn)' : 'var(--mc-bullish)')}60`,
                  color: playbookCounts.E > 0 ? 'var(--mc-bearish)' : (playbookCounts.W > 0 ? 'var(--mc-warn)' : 'var(--mc-bullish)'),
                  fontWeight: 800, textDecoration: 'none', letterSpacing: 0.3,
                }} title="Playbook state machine — click for state-machine, decision engine, exit rules">
                  📖 PLAYBOOK · HOLD {playbookCounts.H} · WATCH {playbookCounts.W} · EXIT {playbookCounts.E}
                </Link>
              )}
              {!playbookCounts && (
                <Link href="/playbook" style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 38%, transparent)', color: 'var(--mc-state-persistent)',
                  fontWeight: 800, textDecoration: 'none', letterSpacing: 0.3,
                }} title="Open Playbook → set up portfolio state machine (HOLD/WATCH/EXIT) and exit rules">
                  📖 PLAYBOOK — set up state machine
                </Link>
              )}
              {/* PATCH 0622 — Sector rotation one-liner */}
              {data.sectorRotation?.topSector && data.sectorRotation?.bottomSector && (
                <Link href="/movers" style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', color: 'var(--mc-cyan)',
                  fontWeight: 700, textDecoration: 'none',
                }}>
                  🔄 {data.sectorRotation.topSector.sector} {data.sectorRotation.topSector.pct >= 0 ? '+' : ''}{data.sectorRotation.topSector.pct.toFixed(1)}% leading · {data.sectorRotation.bottomSector.sector} {data.sectorRotation.bottomSector.pct.toFixed(1)}% lagging
                </Link>
              )}
              {/* PATCH 0622 — Alpha feedback v0 (engine consistency) */}
              {data.alphaFeedback && (
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)', color: 'var(--mc-state-persistent)',
                  fontWeight: 700,
                }} title={`${data.alphaFeedback.held} of ${data.alphaFeedback.sample} A-grade names held A grade across uploads`}>
                  🔁 Engine consistency: avg {data.alphaFeedback.avgScoreBefore.toFixed(0)} → {data.alphaFeedback.avgScoreNow.toFixed(0)} ({data.alphaFeedback.held}/{data.alphaFeedback.sample} held A)
                </span>
              )}
              {/* PATCH 0908 — Heatmap + Conviction Beats chips moved out of
                  this row into their own dedicated row directly above the
                  LENS bar (see Patch 0908 block below). User feedback:
                  "still i dont see in this in home tab the newly requested
                  ones" — the conditional rendering here was hiding them
                  when no live quotes arrived (weekend / cold start). */}
              {/* PATCH 1057 — Auto-refresh status. Shows ticker is alive and
                  when the next auto-refresh runs. Click to force-refresh now. */}
              {(() => {
                const now = Date.now();
                const ist = (() => { const d = new Date(); const i = new Date(d.getTime() + (d.getTimezoneOffset()+330)*60_000); return i; })();
                const day = ist.getUTCDay();
                const mins = ist.getUTCHours()*60 + ist.getUTCMinutes();
                const marketOpen = day >= 1 && day <= 5 && mins >= (9*60+15) && mins <= (15*60+30);
                const sinceMs = now - lastAutoRefreshAt;
                const sinceLabel = sinceMs < 60_000 ? `${Math.floor(sinceMs/1000)}s ago` : `${Math.floor(sinceMs/60_000)}m ago`;
                const cadence = marketOpen ? '60s' : '5min';
                const color = marketOpen ? '#10B981' : '#94A3B8';
                return (
                  <button
                    onClick={() => { if (Date.now() - lastAutoRefreshAt < 20_000) return; /* throttle force-refresh: each press fires ~15 API calls and trips the rate limiter */ setRefreshTick(t => t + 1); setLastAutoRefreshAt(Date.now()); }}
                    title={`Auto-refresh every ${cadence} (${marketOpen ? 'market open' : 'market closed'}). Click to force-refresh now.`}
                    style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: `${color}15`, border: `1px solid ${color}40`, color, fontWeight: 700, cursor: 'pointer' }}>
                    🔄 Auto · {cadence} · last {sinceLabel}
                  </button>
                );
              })()}
            </div>
          </div>
          {/* PATCH 1036 — Position Sizing Calculator on home (institutional 1-tap sizing) */}
          <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',padding:'12px 16px',backgroundColor:'rgba(168,85,247,0.06)',border:'1px solid rgba(168,85,247,0.20)',borderRadius:10,marginTop:4}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <span style={{fontSize:12,fontWeight:800,color:'var(--mc-state-persistent)',letterSpacing:'0.5px'}}>💰 POSITION SIZING</span>
              <span style={{fontSize:11,color:DIM,fontWeight:700}}>Portfolio</span>
              {/* PATCH 1086 — UX-02: read currency symbol from localStorage (INR default) instead of hard-coded $ */}
              {(() => {
                let _ccy = '₹';
                try { _ccy = (typeof window !== 'undefined' && localStorage.getItem('mc-default-currency')) || '₹'; } catch { _ccy = '₹'; }
                return <span style={{fontSize:13,color:TEXT,fontWeight:800}}>{_ccy}</span>;
              })()}
              <input
                type="number"
                value={posCalcCapital}
                onChange={(e)=>setPosCalcCapital(Math.max(0, Number(e.target.value)||0))}
                style={{width:120,padding:'5px 8px',backgroundColor:'#13131a',border:'1px solid rgba(255,255,255,0.12)',borderRadius:6,color:TEXT,fontSize:13,fontWeight:700,outline:'none'}}
                aria-label="Portfolio capital"
              />
              <span style={{fontSize:10,color:DIM}}>· editable, syncs across pages</span>
            </div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              {/* PATCH 1086 — UX-02: pct chips also use localStorage currency */}
              {(() => {
                let _ccy = '₹';
                try { _ccy = (typeof window !== 'undefined' && localStorage.getItem('mc-default-currency')) || '₹'; } catch { _ccy = '₹'; }
                return [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10, 15, 20].map(pct => {
                  const amt = Math.round(posCalcCapital * pct / 100);
                  return (
                    <div key={pct} style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'4px 8px',backgroundColor:'#13131a',border:'1px solid rgba(255,255,255,0.12)',borderRadius:6,minWidth:62}}>
                      <span style={{fontSize:10,color:DIM,fontWeight:700}}>{pct}%</span>
                      <span style={{fontSize:13,color:'var(--mc-bullish)',fontWeight:800}}>{_ccy}{amt.toLocaleString('en-US')}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* PATCH 0619/0635 — institutional chip strip. All in one row group,
              uniform pill style, left-aligned, even row gap. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-start', rowGap: 8, alignItems: 'center' }}>
            {/* PATCH 1101zzz28 — Alphabetical sort by label (emoji ignored).
                Previously broken-alpha due to layered additive patches.
                External (IBEF) interleaved at correct position. Dead
                button block below (false && <button>) left intact for
                code archaeology — never renders. */}
            <Link href="/playbook#about-me"        style={navChip('#fb7185')}>🌿 About Me</Link>
            <Link href="/activity-log"             style={navChip('#A78BFA')}>📜 Activity</Link>
            <Link href="/auto-valuation"           style={navChip('#10B981')}>🤖 Auto-Valuation</Link>
            <Link href="/gautam-baid"              style={navChip('#e3b341')}>📖 Baid Playbook</Link>
            <Link href="/breadth"                  style={navChip('#10B981')}>📊 Breadth</Link>
            <Link href="/buy-strategy"             style={navChip('#FFD700')}>🛒 Buy Strategy</Link>
            <Link href="/playbook#cadence"         style={navChip('#22D3EE')}>🗓 Cadence</Link>
            <Link href="/capex-tracker"            style={navChip('#F0883E')}>🏗 Capex Tracker</Link>
            <Link href="/earnings-hub?tab=concall" style={navChip('#A78BFA')}>🧠 Concall AI</Link>
            <Link href="/concall-intel"            style={navChip('#A78BFA')}>🎙 Concall Intel</Link>
            <Link href="/watchlists?tab=conviction" style={navChip('#F59E0B')}>🏆 Conviction Beats</Link>
            <Link href="/decisions"                style={navChip('#22D3EE')}>📒 Decision Log</Link>
            <Link href="/earnings-mastery"         style={navChip('#F59E0B')}>📊 Earnings Mastery</Link>
            <Link href="/earnings-opportunities"   style={navChip('#F59E0B')}>📅 Earnings Ops</Link>
            <Link href="/earnings"                 style={navChip('#F59E0B')}>📊 Earnings Scan</Link>
            <Link href="/earnings-trigger"         style={navChip('#f0883e')}>⚡ Earnings Trigger</Link>
            <Link href="/guidance-extractor"       style={navChip('#A78BFA')}>📋 Guidance</Link>
            <Link href="/heatmap"                  style={navChip('#22D3EE')}>🗺 Heatmap</Link>
            <a
              href="https://www.ibef.org/news/past-news"
              target="_blank"
              rel="noopener noreferrer"
              style={navChip('#10B981')}
            >🇮🇳 IBEF</a>
            <Link href="/investing-os"             style={navChip('#2dd4bf')}>🧠 Investing OS</Link>
            <Link href="/playbook#life-sat"        style={navChip('#fbbf24')}>🌅 Life Sat</Link>
            <Link href="/in-play"                  style={navChip('#22D3EE')}>📰 Live In Play</Link>
            <Link href="/market-cycles"            style={navChip('#A78BFA')}>🎢 Market Cycles</Link>
            <Link href="/movers"                   style={navChip('#10B981')}>📈 Movers</Link>
            <Link href="/multibagger"              style={navChip('#10B981')}>🚀 Multibagger</Link>
            <Link href="/portfolio"                style={navChip('#22D3EE')}>💼 My Book</Link>
            <Link href="/news"                     style={navChip('#60A5FA')}>📰 News Feed</Link>
            <Link href="/playbook#mastery"         style={navChip('#84cc16')}>🏏 Peak Performance</Link>
            <Link href="/playbook"                 style={navChip('#F59E0B')}>📚 Playbook</Link>
            <Link href="/fundamentals?scope=portfolio" style={navChip('#f59e0b')}>🔬 Portfolio Fundamentals</Link>
            <Link href="/playbook#relationships"   style={navChip('#2dd4bf')}>🤝 Relationships</Link>
            <Link href="/orders"                   style={navChip('#22D3EE')}>📡 Signals</Link>
            <Link href="/special-situations"       style={navChip('#EF4444')}>🎯 Special Sit</Link>
            <Link href="/strategic-visibility"     style={navChip('#A78BFA')}>⭐ Strategic Vis</Link>
            <Link href="/playbook#stress"          style={navChip('#38bdf8')}>🧘 Stress</Link>
            <Link href="/super-investors"          style={navChip('#A78BFA')}>🦅 Super Investors</Link>
            <Link
              href="/screener-sync"
              style={{ ...navChip('#8B5CF6'), border: '1px solid color-mix(in srgb, #8B5CF6 40%, transparent)' }}
              title="Set up the browser bookmarklet — bypasses Cloudflare's block on server-side fetch"
            >📥 Sync Screener.in</Link>
            <Link href="/journey"                  style={navChip('#22D3EE')}>🚀 The Journey</Link>
            <Link href="/critical-themes"          style={navChip('#EF4444')}>🔥 Themes</Link>
            <Link href="/valuation-calc"           style={navChip('#22D3EE')}>🧮 Valuation Calc</Link>
            <Link href="/capex-tracker?tab=verdict" style={navChip('#A78BFA')}>🧭 Verdict</Link>
            <Link href="/volume-rules"             style={navChip('#22D3EE')}>🎯 Volume Rules</Link>
            <Link href="/watchlists"               style={navChip('#22D3EE')}>👁 Watchlist</Link>
            <Link href="/fundamentals?scope=watchlist" style={navChip('#2dd4bf')}>🔬 Watchlist Fundamentals</Link>
            {/* PATCH 1101fff — old in-place sync button removed entirely.
                Previously kept with hidden attribute as dead code for reference
                but it still rendered visibly in some styling contexts (user
                reported duplicate button). The /screener-sync bookmarklet flow
                is the supported path. */}
            {false && <button
              hidden
              onClick={async (e) => {
                // PATCH 1101ddd — capture event explicitly. event!.target relies
                // on the implicit global event variable which is undefined in
                // modern React/TS strict mode, throwing TypeError that silently
                // killed the whole handler. User saw "nothing happened".
                console.log('[ScreenerSync] button clicked');
                const btn = e.currentTarget as HTMLButtonElement;
                const orig = btn.innerText;
                // PATCH 1101aaa — probe server first. If SCREENER_SESSIONID env
                // var is set on Railway, skip the prompt entirely.
                let serverConfigured = false;
                try {
                  const probe = await fetch('/api/screener/sync', { method: 'GET' });
                  console.log('[ScreenerSync] probe status', probe.status);
                  if (probe.ok) {
                    const j = await probe.json().catch(() => ({}));
                    serverConfigured = !!j.configured;
                    console.log('[ScreenerSync] serverConfigured =', serverConfigured);
                  }
                } catch (probeErr) {
                  console.error('[ScreenerSync] probe failed', probeErr);
                  alert('❌ Could not reach /api/screener/sync. Either the deploy hasn\'t completed (hard-refresh Cmd+Shift+R) or the route is broken. See DevTools Console for details.');
                  return;
                }
                let sessionid = serverConfigured ? '' : (localStorage.getItem('mc:screener:sessionid:v1') || '');
                if (!serverConfigured && !sessionid) {
                  sessionid = (window.prompt(
                    'Paste your Screener.in sessionid cookie.\n\nFind it in Chrome: open screener.in (logged in) → DevTools → Application → Cookies → screener.in → copy "sessionid" value.\n\nIt will be saved in your browser for next time.\n\nTIP: If you set SCREENER_SESSIONID on Railway env vars, this prompt never appears.',
                    ''
                  ) || '').trim();
                  if (!sessionid) return;
                  localStorage.setItem('mc:screener:sessionid:v1', sessionid);
                }
                // PATCH 1101bbb — All 12 of the user's saved screens.
                // Browser-default-downloads-folder behavior is automatic: each
                // download triggers an anchor click with a 2s spacing between
                // requests to stay polite with screener.in rate limits.
                const screens = [
                  { id: '3443614', name: 'fii' },
                  { id: '3470949', name: 'future-leaders' },
                  { id: '3479774', name: 'lowequitycapital' },
                  { id: '3545352', name: 'multibagger2-ignoring-trend' },
                  { id: '3549314', name: 'stocks-like-bajaj-consumer' },
                  { id: '3565418', name: 'rajeev-thakkar-ppfas-screener' },
                  { id: '3586238', name: '100-baggers-sales-and-eps-growth' },
                  { id: '3601571', name: 'multibagger-like-acutaasatlantadee-dev' },
                  { id: '3612486', name: 'pead-master-screener-rishi-framework' },
                  { id: '3615320', name: 'ipobases' },
                  { id: '3658091', name: 'great-results-and-pullback' },
                  { id: '3717728', name: 'capex' },
                  // PATCH 1101ccc — watchlists. Different URL pattern on screener.in.
                  { id: '10432429', name: 'watchlist-10432429', type: 'watchlist' },
                  { id: '10432585', name: 'watchlist-10432585', type: 'watchlist' },
                  { id: '8105148',  name: 'watchlist-8105148',  type: 'watchlist' },
                ] as { id: string; name: string; type?: 'screen' | 'watchlist' }[];
                // PATCH 1101ddd — btn/orig already captured at top via e.currentTarget.
                btn.style.opacity = '0.6';
                // PATCH 1101ccc — open DevTools tip on first sync so user can see
                // logs if "nothing happens" again. Also a console banner.
                console.log('[ScreenerSync] starting sync of', screens.length, 'items. serverConfigured =', serverConfigured);
                let i = 0;
                try {
                  for (const s of screens) {
                    i++;
                    // PATCH 1101bbb — visible per-screen progress
                    btn.innerText = `⏳ ${i}/${screens.length} ${s.name}`;
                    // PATCH 1101ccc — verbose console log so user can see in DevTools
                    // exactly what's happening, plus pass type for watchlist support.
                    console.log(`[ScreenerSync] ${i}/${screens.length} fetching ${s.type || 'screen'} ${s.id} (${s.name})`);
                    const r = await fetch('/api/screener/sync', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sessionid, screenId: s.id, name: s.name, type: s.type || 'screen' }),
                    });
                    console.log(`[ScreenerSync] ${i}/${screens.length} response status ${r.status}`);
                    if (!r.ok) {
                      const j = await r.json().catch(() => ({}));
                      if (r.status === 401) {
                        // Bad sessionid — clear and re-prompt
                        localStorage.removeItem('mc:screener:sessionid:v1');
                        alert(`❌ ${j.error || 'Auth failed'}\n\n${j.hint || ''}\n\nYour saved sessionid was cleared. Click Sync again and paste a fresh one.`);
                        return;
                      }
                      alert(`❌ ${j.error || 'Failed'}\n\n${j.hint || ''}`);
                      return;
                    }
                    const blob = await r.blob();
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${s.name}-${new Date().toISOString().slice(0, 10)}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                    if (screens.length > 1) await new Promise((res) => setTimeout(res, 2000));
                  }
                  btn.innerText = `✅ Synced ${screens.length}!`;
                  setTimeout(() => { btn.innerText = orig; btn.style.opacity = '1'; }, 3000);
                } catch (err: any) {
                  alert('❌ Sync failed: ' + (err?.message || String(err)));
                  btn.innerText = orig;
                  btn.style.opacity = '1';
                }
              }}
              title="One-click download of saved Screener.in screens. Uses your stored sessionid cookie."
              style={{ ...navChip('#8B5CF6'), cursor: 'pointer', border: '1px solid color-mix(in srgb, #8B5CF6 40%, transparent)' }}
            >📥 Sync Screener.in</button>}
            {/* PATCH 1063 — deep-link chips into Playbook sub-sections per user request */}
            <Link href="/playbook#about-me"      style={navChip('#fb7185')}>🌿 About Me</Link>
            <Link href="/playbook#life-sat"      style={navChip('#fbbf24')}>🌅 Life Sat</Link>
            {/* PATCH 1066 — Review Cadence + Relationships deep-link chips per user request */}
            <Link href="/playbook#cadence"       style={navChip('#22D3EE')}>🗓 Cadence</Link>
            <Link href="/playbook#relationships" style={navChip('#2dd4bf')}>🤝 Relationships</Link>
            <Link href="/playbook#mastery"       style={navChip('#84cc16')}>🏏 Peak Performance</Link>
            <Link href="/playbook#stress"        style={navChip('#38bdf8')}>🧘 Stress</Link>
            <Link href="/orders"                 style={navChip('#22D3EE')}>📡 Signals</Link>
            <Link href="/special-situations"     style={navChip('#EF4444')}>🎯 Special Sit</Link>
            <Link href="/strategic-visibility"   style={navChip('#A78BFA')}>⭐ Strategic Vis</Link>
            <Link href="/super-investors"        style={navChip('#A78BFA')}>🦅 Super Investors</Link>
            <Link href="/critical-themes"        style={navChip('#EF4444')}>🔥 Themes</Link>
            <Link href="/valuation-calc"         style={navChip('#22D3EE')}>🧮 Valuation Calc</Link>
            <Link href="/watchlists"             style={navChip('#22D3EE')}>👁 Watchlist</Link>
          </div>
        </div>

        {/* ═══════════════ PATCH 0908 — HEATMAP + CONVICTION BEATS ROW ═══════
            Dedicated chip row directly above the LENS bar. Always renders
            (loading / empty placeholders shown when data unavailable) so
            the user never wonders whether the panels exist. Each chip
            links to the full page. Sorted by absolute % move.
            User feedback: "still i dont see in this in home tab the newly
            requested ones" — previous Patch 0907 hid these chips when
            conditional render fell through (weekend / no live quotes).
        ═════════════════════════════════════════════════════════════════════ */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '8px 12px',
          background: 'var(--mc-bg-1)',
          border: '1px solid var(--mc-bg-4)',
          borderRadius: 6,
        }}>
          {/* 🗺 HEATMAP CHIP */}
          {(() => {
            const sp = data.sectorPulse;
            if (!sp) {
              return (
                <Link href="/heatmap" style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)',
                  fontWeight: 800, textDecoration: 'none',
                }}>🗺 HEATMAP · loading sectors…</Link>
              );
            }
            if (sp.length === 0) {
              return (
                <Link href="/heatmap" style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)',
                  fontWeight: 800, textDecoration: 'none',
                }}>🗺 HEATMAP · no sector data · Open →</Link>
              );
            }
            const top3 = sp.slice().sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 3);
            return (
              <Link href="/heatmap" style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 4,
                background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)',
                fontWeight: 800, textDecoration: 'none',
              }} title="Open full Sector Heatmap →">
                🗺 HEATMAP · {top3.map(s => `${s.sector} ${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(1)}%`).join(' · ')}
              </Link>
            );
          })()}

          {/* 📈 MOVERS CHIP — live top movers feed in the chip row (sibling of HEATMAP) */}
          {(() => {
            const g = (data.gainers || []).slice(0, 2);
            const l = (data.losers || []).slice(0, 1);
            if (!g.length && !l.length) {
              return (
                <Link href="/movers" style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 4,
                  background: '#00E68A15', border: '1px solid #00E68A60', color: '#00E68A',
                  fontWeight: 800, textDecoration: 'none',
                }}>📈 MOVERS · loading…</Link>
              );
            }
            const fmt = (m: { ticker: string; changePercent?: number }) => `${m.ticker} ${Number(m.changePercent || 0) >= 0 ? '+' : ''}${Number(m.changePercent || 0).toFixed(1)}%`;
            return (
              <Link href="/movers" style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 4,
                background: '#00E68A15', border: '1px solid #00E68A60', color: '#00E68A',
                fontWeight: 800, textDecoration: 'none',
              }} title="Open full Movers board →">
                📈 MOVERS · {[...g.map(fmt), ...l.map(fmt)].join(' · ')}
              </Link>
            );
          })()}

          {/* 🏆 CONVICTION BEATS CHIP */}
          {(() => {
            const cb = data.convictionLive;
            if (!cb) {
              return (
                <Link href="/watchlists?tab=conviction" style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', color: 'var(--mc-warn)',
                  fontWeight: 800, textDecoration: 'none',
                }}>🏆 BEATS · loading bench…</Link>
              );
            }
            if (cb.length === 0) {
              return (
                <Link href="/earnings-opportunities" style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', color: 'var(--mc-warn)',
                  fontWeight: 800, textDecoration: 'none',
                }}>🏆 BEATS · empty bench · populate from EO →</Link>
              );
            }
            const withQuotes = cb.filter(c => typeof c.changePercent === 'number');
            if (withQuotes.length === 0) {
              return (
                <Link href="/watchlists?tab=conviction" style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', color: 'var(--mc-warn)',
                  fontWeight: 800, textDecoration: 'none',
                }} title={`${cb.length} names on bench · no live quotes (NSE closed?)`}>
                  🏆 BEATS ({cb.length}) · no live quotes · {cb.slice(0, 4).map(c => c.ticker).join(' · ')}
                </Link>
              );
            }
            const top4 = withQuotes.slice(0, 4);
            return (
              <Link href="/watchlists?tab=conviction" style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 4,
                background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', color: 'var(--mc-warn)',
                fontWeight: 800, textDecoration: 'none',
              }} title={`${cb.length} names on bench · sorted by today's abs move`}>
                🏆 BEATS ({cb.length}) · {top4.map(c => `${c.ticker} ${(c.changePercent as number) >= 0 ? '+' : ''}${(c.changePercent as number).toFixed(1)}%`).join(' · ')}
              </Link>
            );
          })()}
        </div>

        {/* ═══════════════ PATCH 0613 — LENS SWITCHER ═══════════════════
            Saved Workspaces v1. Filters Tier 1/2/3 in real-time.
            User can add custom sector-regex lenses via the + button.
            (PATCH 0907/0908 — Heatmap + Conviction Beats live in their
            own always-visible chip row directly above this LENS bar.
            LENS itself is the original single-row Tier-filter.)
        ═════════════════════════════════════════════════════════════════ */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '6px 10px',
          background: 'var(--mc-bg-1)',
          border: '1px solid var(--mc-bg-4)',
          borderRadius: 6,
        }}>
          <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: '0.5px', marginRight: 4 }}>LENS</span>
          {allLenses.map((l) => {
            const isActive = l.id === activeLensId;
            const isCustom = !PRESET_LENSES.find(p => p.id === l.id);
            return (
              <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <button
                  onClick={() => setActiveLensId(l.id)}
                  style={{
                    fontSize: 10,
                    padding: '3px 9px',
                    border: isActive ? '1px solid var(--mc-cyan)' : '1px solid var(--mc-bg-4)',
                    background: isActive ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent',
                    color: isActive ? 'var(--mc-cyan)' : TEXT,
                    fontWeight: 700,
                    letterSpacing: '0.3px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {l.emoji || '◯'} {l.label}
                </button>
                {isCustom && isActive && (
                  <button
                    onClick={() => removeCustomLens(l.id)}
                    title="Delete this lens"
                    style={{ fontSize: 10, padding: '3px 5px', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', background: 'transparent', color: 'var(--mc-bearish)', borderRadius: 4, cursor: 'pointer' }}
                  >×</button>
                )}
              </span>
            );
          })}
          {/* PATCH 1086 — NEW LENS button. onClick now opens the inline modal
              defined below (addCustomLens sets lensModalOpen=true) instead of
              calling chained window.prompt() that could silently no-op. */}
          <button
            onClick={addCustomLens}
            style={{ fontSize: 10, padding: '3px 9px', border: '1px dashed color-mix(in srgb, var(--mc-cyan) 38%, transparent)', background: 'transparent', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
            title="Add a custom sector-keyword lens"
          >+ NEW LENS</button>
          {activeLens.mode !== 'all' && (
            <span style={{ fontSize: 10, color: DIM, marginLeft: 4 }}>
              · Tier 1: {lensedTier1.length}/{data.tier1.length} · Tier 2: {lensedTier2.length}/{data.tier2.length} · Tier 3: {lensedTier3.length}/{data.tier3.length}
            </span>
          )}
          {/* PATCH 1086 — NEW LENS button. Inline modal (overlay) + confirmation toast.
              Renders inside the lens bar so it inherits theme tokens and disappears
              as soon as the LENS section unmounts. Custom lenses are persisted via
              the existing setCustomLenses→useEffect→localStorage chain (key
              'mc:home-custom-lenses:v1'), so saved lenses survive reload and show
              up inline alongside the preset chips with no extra wiring. */}
          {lensModalOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="New custom lens"
              onClick={(e) => { if (e.target === e.currentTarget) setLensModalOpen(false); }}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9999,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 420, maxWidth: '92vw',
                  background: 'var(--mc-bg-1)',
                  border: '1px solid var(--mc-bg-4)',
                  borderRadius: 8,
                  padding: 18,
                  color: TEXT,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13, letterSpacing: '0.4px', color: 'var(--mc-cyan)' }}>+ NEW LENS</strong>
                  <button
                    onClick={() => setLensModalOpen(false)}
                    aria-label="Close"
                    style={{ background: 'transparent', border: 'none', color: DIM, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                  >×</button>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: DIM, fontWeight: 700, letterSpacing: '0.3px' }}>
                  LENS NAME
                  <input
                    type="text"
                    value={lensModalName}
                    onChange={(e) => setLensModalName(e.target.value)}
                    placeholder='e.g. "AI Infra"'
                    autoFocus
                    maxLength={24}
                    style={{
                      fontSize: 12, padding: '6px 8px',
                      background: 'var(--mc-bg-0)', color: TEXT,
                      border: '1px solid var(--mc-bg-4)', borderRadius: 4,
                      outline: 'none',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: DIM, fontWeight: 700, letterSpacing: '0.3px' }}>
                  FILTER CRITERIA (sector regex, case-insensitive)
                  <textarea
                    value={lensModalPattern}
                    onChange={(e) => setLensModalPattern(e.target.value)}
                    placeholder='e.g. "data center|ai|semiconductor"'
                    rows={3}
                    style={{
                      fontSize: 12, padding: '6px 8px',
                      background: 'var(--mc-bg-0)', color: TEXT,
                      border: '1px solid var(--mc-bg-4)', borderRadius: 4,
                      outline: 'none', resize: 'vertical', fontFamily: 'ui-monospace, monospace',
                    }}
                  />
                </label>
                {lensModalError && (
                  <div style={{ fontSize: 11, color: 'var(--mc-bearish)' }}>{lensModalError}</div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={() => setLensModalOpen(false)}
                    style={{
                      fontSize: 11, padding: '6px 14px', fontWeight: 700, letterSpacing: '0.3px',
                      background: 'transparent', color: TEXT,
                      border: '1px solid var(--mc-bg-4)', borderRadius: 4, cursor: 'pointer',
                    }}
                  >CANCEL</button>
                  <button
                    onClick={saveCustomLens}
                    style={{
                      fontSize: 11, padding: '6px 14px', fontWeight: 700, letterSpacing: '0.3px',
                      background: 'color-mix(in srgb, var(--mc-cyan) 18%, transparent)',
                      color: 'var(--mc-cyan)',
                      border: '1px solid var(--mc-cyan)', borderRadius: 4, cursor: 'pointer',
                    }}
                  >SAVE</button>
                </div>
              </div>
            </div>
          )}
          {lensToast && (
            <div
              role="status"
              style={{
                position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
                fontSize: 12, padding: '8px 14px',
                background: 'color-mix(in srgb, var(--mc-cyan) 14%, var(--mc-bg-1))',
                border: '1px solid var(--mc-cyan)', color: 'var(--mc-cyan)',
                borderRadius: 6, fontWeight: 700, letterSpacing: '0.3px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              }}
            >{lensToast}</div>
          )}
        </div>

        {/* ═══════════════ PATCH 0620 — IN-PLAY NEWS (MOVED TO TOP) ════════ */}
        <div style={cardStyle}>
          <button onClick={() => setShowInPlay(v => !v)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px',
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          }}>
            {showInPlay ? '▾' : '▸'} 🔥 IN-PLAY NEWS — top {data.inPlay.length} <span style={{ fontSize: 9, fontWeight: 600, color: DIM, marginLeft: 4 }}>· active &lt;36h</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: DIM, fontWeight: 500 }}>
              <Link href="/news" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>Full feed →</Link>
            </span>
          </button>
          {netLoading.inPlay && !showInPlay && (
            <div style={{ fontSize: 10, color: DIM, marginTop: 4, fontStyle: 'italic' }}>📡 Loading in-play news…</div>
          )}
          {showInPlay && netLoading.inPlay && (
            <div style={{ fontSize: 11, color: DIM, marginTop: 8, fontStyle: 'italic' }}>📡 Loading…</div>
          )}
          {showInPlay && !netLoading.inPlay && data.inPlay.length === 0 && (
            <div style={{ fontSize: 11, color: DIM, marginTop: 8, fontStyle: 'italic', lineHeight: 1.5 }}>
              {data.inPlayDiag?.error
                ? `News feed unreachable (${data.inPlayDiag.error}${data.inPlayDiag.status ? ' / HTTP ' + data.inPlayDiag.status : ''}). Backend may be cold-starting.`
                : 'No live in-play news in last 24 hours.'}
              {data.inPlayDiag && (
                <div style={{ fontSize: 10, color: DIM, marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>
                  Diagnostic: fetched {data.inPlayDiag.fetched} · within 24h {data.inPlayDiag.recent} · after structural filter {data.inPlayDiag.clean}
                  {data.inPlayDiag.error && <span style={{ color: '#F87171' }}> · error: {data.inPlayDiag.error}</span>}
                </div>
              )}
              <button
                onClick={() => { window.location.reload(); }}
                style={{ marginTop: 8, fontSize: 10, padding: '4px 10px', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', background: 'transparent', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
              >
                🔄 RETRY
              </button>
            </div>
          )}
          {showInPlay && !netLoading.inPlay && data.inPlay.length > 0 && data.inPlayDiag?.fellBack && (
            <div style={{ fontSize: 10, color: 'var(--mc-warn)', marginTop: 6, padding: '4px 8px', background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 4 }}>
              ⚠ Only structural alerts available in last 24h — showing them anyway so the feed isn't empty.
            </div>
          )}
          {showInPlay && !netLoading.inPlay && data.inPlay.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {data.inPlay.map((n, i) => {
                const title = n.title || n.headline || '(no headline)';
                // PATCH 1057: render IST timestamp + relative "Xm ago" chip per article
                // so the user knows when each item landed without leaving the page.
                const pubIso = n.published_at;
                let istChip = '';
                let relAge = '';
                if (pubIso) {
                  try {
                    const d = new Date(pubIso);
                    if (!isNaN(d.getTime())) {
                      // IST = UTC+5:30, formatted as "13 Jun · 3:33 PM"
                      // PATCH 1057b: use Intl.DateTimeFormat.formatToParts for atomic
                      // browser-portable formatting (avoids locale-string variance).
                      const fmt = new Intl.DateTimeFormat('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit', month: 'short',
                        hour: 'numeric', minute: '2-digit',
                        hour12: true,
                      });
                      const parts = fmt.formatToParts(d);
                      const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
                      istChip = `${get('day')} ${get('month')} · ${get('hour')}:${get('minute')} ${get('dayPeriod')}`.replace(/\s+/g, ' ').trim();
                      const ageSec = Math.round((Date.now() - d.getTime()) / 1000);
                      relAge = ageSec < 60 ? `${ageSec}s` :
                               ageSec < 3600 ? `${Math.round(ageSec / 60)}m` :
                               ageSec < 86400 ? `${Math.round(ageSec / 3600)}h` :
                               `${Math.round(ageSec / 86400)}d`;
                    }
                  } catch { /* swallow */ }
                }
                return (
                  <a key={(n.id || '') + i} href={n.url || n.source_url || '#'} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                    <span style={{ fontSize: 11, color: DIM, fontWeight: 700, minWidth: 22 }}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: TEXT, fontWeight: 500, lineHeight: 1.4 }}>{title}</span>
                    {istChip && (
                      <span
                        title={`Published ${istChip} IST · ${relAge} ago`}
                        style={{ fontSize: 9, color: 'var(--mc-text-3)', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace', minWidth: 100, textAlign: 'right' }}
                      >
                        {istChip}{relAge ? ` · ${relAge}` : ''}
                      </span>
                    )}
                    <span style={{ fontSize: 9, color: DIM, whiteSpace: 'nowrap' }}>{n.source_name || n.source || '—'}</span>
                  </a>
                );
              })}
            </div>
          )}
          {/* PATCH 1096b — Recent Context tail: 36h–7d items, collapsed by
              default. Kept on home so the user doesn't lose the older relevant
              stories — they just don't crowd "in-play". */}
          {showInPlay && !netLoading.inPlay && (data.inPlayRecent?.length || 0) > 0 && (
            <div style={{ marginTop: 10, borderTop: '1px dashed var(--mc-bg-4)', paddingTop: 8 }}>
              <button
                onClick={() => setShowInPlayRecent(v => !v)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                  fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: '0.4px',
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                }}
              >
                {showInPlayRecent ? '▾' : '▸'} 🕰 RECENT CONTEXT — {data.inPlayRecent!.length} older stories (36h–7d)
              </button>
              {showInPlayRecent && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.78 }}>
                  {data.inPlayRecent!.map((n, i) => {
                    const title = n.title || n.headline || '(no headline)';
                    const pubIso = n.published_at;
                    let relAge = '';
                    if (pubIso) {
                      try {
                        const d = new Date(pubIso);
                        if (!isNaN(d.getTime())) {
                          const ageSec = Math.round((Date.now() - d.getTime()) / 1000);
                          relAge = ageSec < 86400 ? `${Math.round(ageSec / 3600)}h` : `${Math.round(ageSec / 86400)}d`;
                        }
                      } catch { /* swallow */ }
                    }
                    return (
                      <a key={(n.id || '') + 'rc' + i} href={n.url || n.source_url || '#'} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', textDecoration: 'none' }}>
                        <span style={{ fontSize: 10, color: DIM, fontWeight: 700, minWidth: 20 }}>{i + 1}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--mc-text-3)', fontWeight: 500, lineHeight: 1.35 }}>{title}</span>
                        {relAge && (
                          <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{relAge}</span>
                        )}
                        <span style={{ fontSize: 9, color: DIM, whiteSpace: 'nowrap' }}>{n.source_name || n.source || '—'}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══════════════ TIER 1 — IMMEDIATE ACTION ════════════════════ */}
        {/* PATCH 1101bb — Lens-filter banner. The "CONVICTION-ONLY" / "A+ ONLY"
            / sector lenses silently filtered Tier 1 from 10 → 2-3 stocks and
            the user had no idea WHY their count was small. Now: if the active
            lens is reducing Tier 1, show a prominent banner saying so with a
            one-click reset to ALL. THIS was the actual cause of Tier 1 (3),
            not the data path. The fillers logic was always correct. */}
        {activeLens.mode !== 'all' && data.tier1.length > lensedTier1.length && (
          <div style={{
            marginBottom: 14, padding: '10px 14px',
            background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--mc-warn) 40%, transparent)',
            borderLeft: '3px solid var(--mc-warn)', borderRadius: 8,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12,
          }}>
            <span style={{ fontSize: 16 }}>🔍</span>
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong style={{ color: 'var(--mc-warn)', fontWeight: 800 }}>{activeLens.emoji ? `${activeLens.emoji} ` : ''}{activeLens.label}</strong>
              <span style={{ color: TEXT, marginLeft: 8 }}>
                lens is filtering — showing <strong>{lensedTier1.length}</strong> of <strong>{data.tier1.length}</strong> Tier 1 stocks.
              </span>
            </div>
            <button
              onClick={() => setActiveLensId('all')}
              style={{
                padding: '5px 12px',
                background: 'transparent',
                border: '1px solid color-mix(in srgb, var(--mc-warn) 60%, transparent)',
                borderRadius: 6,
                color: 'var(--mc-warn)', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                letterSpacing: 0.3,
              }}
            >SHOW ALL ({data.tier1.length})</button>
          </div>
        )}

        {lensedTier1.length > 0 ? (
          (() => {
            const t1India = lensedTier1.filter((t: TierAction) => (t as any).market !== 'US');
            const t1Usa = lensedTier1.filter((t: TierAction) => (t as any).market === 'US');
            // PATCH 1101cc — pass unfiltered counts so headers show
            // "(3 of 10 — lens filtering)" when a lens is reducing visible rows.
            const t1IndiaTotal = data.tier1.filter((t: TierAction) => (t as any).market !== 'US').length;
            const t1UsaTotal = data.tier1.filter((t: TierAction) => (t as any).market === 'US').length;
            return (
              <>
                {t1India.length > 0 ? (
                  <DecisionTierBlock
                    tier={1}
                    label="IMMEDIATE ACTION · 🇮🇳 INDIA"
                    color="#10B981"
                    description="Cross-confirmed (★) = A-grade + on Conviction Beats + not in Decision Log. (+) = A-grade top-up when fewer than 10 cross-confirmed exist. Top 10 India names."
                    items={t1India}
                    totalCount={t1IndiaTotal}
                    expanded
                  />
                ) : (
                  /* PATCH 1063 — never silently hide India block; show CTA when empty so user can fix */
                  <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)', marginBottom: 12 }}>
                    <div style={{ fontSize: 13, color: TEXT, fontWeight: 800, marginBottom: 4 }}>🎯 TIER 1 — IMMEDIATE ACTION · 🇮🇳 INDIA (0)</div>
                    <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                      No India scored data in this browser. Upload your India Multibagger CSV to populate this block.
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                      <Link href="/multibagger" style={navChip('#10B981')}>📊 Upload India CSV</Link>
                    </div>
                  </div>
                )}
                {t1Usa.length > 0 && (
                  <DecisionTierBlock
                    tier={1}
                    label="IMMEDIATE ACTION · 🇺🇸 USA"
                    color="#10B981"
                    description="Cross-confirmed (★) = A-grade + on Conviction Beats + not in Decision Log. (+) = A-grade top-up when fewer than 10 cross-confirmed exist. Top 10 US names."
                    items={t1Usa}
                    totalCount={t1UsaTotal}
                    expanded
                  />
                )}
              </>
            );
          })()
        ) : (
          <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' }}>
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 700, marginBottom: 4 }}>🎯 Tier 1 — Immediate Action</div>
            <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
              No candidates yet. Upload a Screener.in CSV on Multibagger and add names to Conviction Beats from
              Earnings Opportunities.
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <Link href="/multibagger" style={navChip('#10B981')}>📊 Open Multibagger</Link>
              <Link href="/earnings-opportunities" style={navChip('#F59E0B')}>📅 Earnings Ops</Link>
            </div>
          </div>
        )}

        {/* ═══════════════ PATCH 0897/0898/0899 — TURNAROUND TIER ═════════
            Always renders. Uses DecisionTierBlock chrome (gradient + ACTION
            NOW chip + ranked grid) when data exists. When empty, mirrors
            the SAME chrome with an empty-state message in the grid slot
            so the visual format matches Tier 1 / Tier 2 exactly. */}
        {lensedTurnaround.length > 0 ? (
          <DecisionTierBlock
            tier={1}
            label="TURNAROUND BUY-ZONE"
            color="#F59E0B"
            description="Top turnaround setups from your /multibagger Turnarounds upload (top 5 by total score). Different playbook than the IMMEDIATE ACTION list above — these are INFLECTION setups, not sustained-quality compounders."
            items={lensedTurnaround}
            expanded
          />
        ) : (
          // PATCH 0899 — Mirror DecisionTierBlock chrome exactly so the
          // empty state looks like a Tier 1 card. Same gradient, same
          // header pattern, same ACTION NOW chip, just with an empty-
          // state message in place of the candidate grid.
          <div style={{
            ...cardStyle,
            borderColor: 'color-mix(in srgb, var(--mc-warn) 44%, transparent)',
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--mc-warn) 8%, transparent) 0%, transparent 100%)',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 900, color: 'var(--mc-warn)', letterSpacing: '0.4px' }}>
                🎯 TIER 1 — TURNAROUND BUY-ZONE (0)
              </span>
              <span style={{ fontSize: 10, color: 'var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', padding: '2px 7px', borderRadius: 3, fontWeight: 700 }}>
                ACTION NOW
              </span>
              <Link href="/multibagger?tab=turnaround" style={{ fontSize: 11, color: 'var(--mc-warn)', textDecoration: 'none', marginLeft: 'auto' }}>Open →</Link>
            </div>
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 10, lineHeight: 1.45 }}>
              Top turnaround setups from your /multibagger Turnarounds upload (top 5 by total score). Different playbook than the IMMEDIATE ACTION list above — these are INFLECTION setups, not sustained-quality compounders.
            </div>
            <div style={{
              padding: '14px 16px',
              borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)',
              background: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)',
              fontSize: 12,
              color: TEXT,
              lineHeight: 1.55,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--mc-warn)' }}>📭 No turnaround candidates uploaded yet</div>
              <div style={{ color: DIM }}>
                Upload a turnaround Screener CSV on the{' '}
                <Link href="/multibagger?tab=turnaround" style={{ color: 'var(--mc-warn)', textDecoration: 'underline' }}>🔄 Turnarounds tab</Link>{' '}
                of the Multibagger page. The engine scores 7 dimensions (earnings reversal · operational reset · balance-sheet repair · concall quality · sector tailwind · governance · valuation set-up) and ranks the top 5 here in the same Tier 1 card layout.
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════ WHAT CHANGED TODAY ═══════════════════════════ */}
        {data.changedToday.length > 0 && (
          <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-cyan)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px' }}>📊 WHAT CHANGED TODAY ({data.changedToday.length})</span>
              <span style={{ fontSize: 10, color: DIM }}>Score deltas ≥5 pts vs prior upload</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
              {data.changedToday.map((c, i) => (
                <Link key={c.symbol + i} href={`/stock-sheet?ticker=${encodeURIComponent((c.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4,
                    border: `1px solid ${c.color}30`, background: `${c.color}08`, textDecoration: 'none' }}>
                  <span style={{ fontSize: 11, color: c.color, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {(c.delta || 0) > 0 ? '▲+' : '▼'}{Math.abs(c.delta || 0)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.company || c.symbol}</div>
                    <div style={{ fontSize: 9, color: DIM }}>{c.fromState} → {c.toState}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════ TIER 2 — STRUCTURAL WATCHLIST ════════════════ */}
        {lensedTier2.length > 0 && (
          <DecisionTierBlock
            tier={2}
            label="STRUCTURAL WATCHLIST"
            color="#22D3EE"
            description="A-grade scorecard — not yet on Conviction Beats bench OR already decision-tagged"
            items={lensedTier2}
            expanded
            condensed
          />
        )}

        {/* ═══════════════ TWO-COL: PORTFOLIO HEAT + EARNINGS TODAY ═════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>

          {/* PATCH 0611 — BOTTLENECK PULSE replaces Portfolio Exposure Heat.
              Surfaces top 3 active bottleneck themes with implicated tickers.
              Far higher signal: this is the transmission engine driving the whole
              portal's thesis. Each theme links to the workbench.            */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px' }}>📡 BOTTLENECK PULSE</span>
              <Link href="/bottleneck-workbench" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open Workbench →</Link>
            </div>
            {netLoading.bottleneck ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Scanning active bottlenecks…</div>
            ) : data.bottleneck.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>
                No active bottlenecks today. <Link href="/news?lifecycle=PERSISTENT" style={{ color: 'var(--mc-cyan)' }}>Browse structural feed →</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, color: DIM, marginBottom: 2 }}>
                  Top 3 active themes · cross-confirmed across {data.bottleneck.length} buckets
                </div>
                {data.bottleneck.slice(0, 3).map((b: any) => {
                  const sev = (b.severity_label || '').toLowerCase();
                  const sevColor = sev === 'high' ? '#EF4444' : sev === 'medium' ? '#F59E0B' : '#22D3EE';
                  const sevGlyph = sev === 'high' ? '🔴' : sev === 'medium' ? '🟠' : '🟡';
                  const tix = (b.key_tickers || b.tickers || []).slice(0, 4);
                  const themeName = b.theme || b.label || b.name || 'Untitled bucket';
                  return (
                    <Link
                      key={themeName}
                      href={`/bottleneck-workbench?theme=${encodeURIComponent(themeName)}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div style={{
                        background: 'var(--mc-bg-4)',
                        border: `1px solid ${sevColor}40`,
                        borderRadius: 5,
                        padding: '6px 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        cursor: 'pointer',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontSize: 11, color: TEXT, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {sevGlyph} {themeName}
                          </span>
                          <span style={{ fontSize: 9, color: sevColor, fontWeight: 800, letterSpacing: '0.5px' }}>
                            {(b.severity_label || 'med').toUpperCase()} · {b.article_count || 0}
                          </span>
                        </div>
                        {tix.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {tix.map((t: string) => (
                              <span key={t} style={{ fontSize: 9, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
                                {t}
                              </span>
                            ))}
                            {(b.key_tickers?.length || 0) > 4 && (
                              <span style={{ fontSize: 9, color: DIM }}>+{b.key_tickers.length - 4}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* EARNINGS — PATCH 0606: shows today or last working day with explicit label */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px' }}>
                📅 EARNINGS {data.earningsLabel.toUpperCase()} ({data.earningsToday.length})
              </span>
              <Link href="/earnings-opportunities" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>View all →</Link>
            </div>
            {netLoading.earnings ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading earnings…</div>
            ) : data.earningsToday.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic', lineHeight: 1.5 }}>
                No BLOCKBUSTER/STRONG filings in last 3 trading days.
                <Link href="/earnings-opportunities" style={{ color: 'var(--mc-cyan)' }}> Open Earnings Ops →</Link>
                {(() => {
                  // PATCH 0750 — weekend honest hint + Backfill nudge for cold KV.
                  const d = new Date();
                  const ist = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000);
                  const dow = ist.getDay();
                  return (dow === 0 || dow === 6) ? (
                    <div style={{ marginTop: 4, fontSize: 10 }}>
                      🕒 Weekend · NSE/BSE closed. Hit <strong>Backfill 60d</strong> on EO page to populate cache.
                    </div>
                  ) : (
                    <div style={{ marginTop: 4, fontSize: 10 }}>
                      No recent filings loaded yet — open Earnings Ops and refresh if this looks wrong.
                    </div>
                  );
                })()}
              </div>
            ) : (() => {
              // PATCH 0615 — show inline date chip per card when multiple dates
              // are mixed in the result, so the user always sees provenance.
              const multiDay = new Set(data.earningsToday.map((c: any) => (c as any)._date).filter(Boolean)).size > 1;
              const fmtDay = (iso?: string) => {
                if (!iso) return '';
                const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (!m) return '';
                return `${m[3]}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m[2])-1]}`;
              };
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {data.earningsToday.map((c: any) => {
                    const tierColor = c.tier === 'BLOCKBUSTER' ? '#10B981' : c.tier === 'STRONG' ? '#22D3EE' : c.tier === 'MIXED' ? '#F59E0B' : '#EF4444';
                    const date = c._date as string | undefined;
                    return (
                      <Link key={c.ticker} href={`/stock-sheet?ticker=${encodeURIComponent(c.ticker)}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.company || c.ticker}</span>
                        {multiDay && date && (
                          <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace' }}>{fmtDay(date)}</span>
                        )}
                        <span style={{ fontSize: 9, fontWeight: 800, color: tierColor, padding: '1px 5px', borderRadius: 3, background: `${tierColor}22` }}>
                          {c.tier} {c.composite_score}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        {/* ═══════════════ PATCH 0617 — CONCALL INTELLIGENCE SUMMARY ═════ */}
        {data.concallHits && data.concallHits.length > 0 && (
          <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-state-persistent)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-state-persistent)', letterSpacing: '0.4px' }}>
                🎙 CONCALL INTELLIGENCE — last 14d ({data.concallHits.length})
              </span>
              <Link href="/concall-intel" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Full Intel →</Link>
            </div>
            <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
              Most-recent management commentary catalysts — earnings calls + analyst meets surfaced via the live feed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {data.concallHits.slice(0, 6).map((h, i) => {
                const tierColor = !h.tier ? '#94A3B8'
                  : /BLOCKBUSTER|TIER\s*1/i.test(h.tier) ? '#10B981'
                  : /STRONG|TIER\s*2/i.test(h.tier) ? '#22D3EE'
                  : /MIXED|NEUTRAL/i.test(h.tier) ? '#F59E0B' : '#94A3B8';
                const cleanTier = (h.tier || '').replace(/_/g, ' ').slice(0, 18);
                return (
                  <Link key={(h.ticker || '') + i} href={`/stock-sheet?ticker=${encodeURIComponent((h.ticker || '').replace(/\.(NS|BO)$/i, ''))}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                    <span style={{ fontSize: 10, color: 'var(--mc-state-persistent)', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 60 }}>
                      {(h.ticker || '').replace(/\.(NS|BO)$/i, '').slice(0, 8)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.headline}
                    </span>
                    {cleanTier && (
                      <span style={{ fontSize: 9, fontWeight: 800, color: tierColor, padding: '1px 5px', borderRadius: 3, background: `${tierColor}22`, whiteSpace: 'nowrap' }}>
                        {cleanTier}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══════════════ PATCH 0621 — TWO-COL: STRATEGIC VIS + SUPER INVESTORS ═ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>

          {/* STRATEGIC VISIBILITY — latest transformational events */}
          <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-warn)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px' }}>
                ⭐ STRATEGIC VISIBILITY ({data.stratVis?.length || 0})
              </span>
              <Link href="/strategic-visibility" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open →</Link>
            </div>
            <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
              Transformational catalysts — multi-quarter visibility events
            </div>
            {!data.stratVis ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading…</div>
            ) : data.stratVis.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic', lineHeight: 1.5 }}>
                No transformational news in window. Backend may have cold-started.
                <button onClick={() => window.location.reload()} style={{ marginLeft: 8, fontSize: 10, padding: '3px 9px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>
                  🔄 RETRY
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.stratVis.slice(0, 5).map((s: any, i: number) => {
                  const ticker = (Array.isArray(s.ticker_symbols) && s.ticker_symbols[0]) || '';
                  const href = s.source_url || (ticker ? `/stock-sheet?ticker=${encodeURIComponent(ticker)}` : '#');
                  const target = s.source_url ? '_blank' : undefined;
                  return (
                    <a key={(s.id || '') + i} href={href} target={target} rel={target ? 'noopener noreferrer' : undefined}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                      <span style={{ fontSize: 9, color: 'var(--mc-warn)', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 56 }}>
                        {(ticker || '').toString().replace(/\.(NS|BO)$/i, '').slice(0, 8) || '—'}
                      </span>
                      <span title={s.title || s.headline || ''}
                        style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {((s.title || s.headline) || '').toString().slice(0, 110) + ((s.title || s.headline || '').length > 110 ? '…' : '')}
                      </span>
                      <span style={{ fontSize: 9, color: DIM, whiteSpace: 'nowrap', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.source_name || '—'}</span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* SUPER INVESTORS — PATCH 0624: combined flow + static roster */}
          <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-state-persistent)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-state-persistent)', letterSpacing: '0.4px' }}>
                🦅 SUPER INVESTORS — holdings + flow ({data.superInvestors?.length || 0})
              </span>
              <Link href="/super-investors" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open Tracker →</Link>
            </div>
            <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
              Marquee-investor positions (live flow + most-recent BSE 1%+ disclosures)
            </div>
            {!data.superInvestors ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading…</div>
            ) : data.superInvestors.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>No marquee positions found.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.superInvestors.slice(0, 10).map((r: any, i: number) => {
                  const dirColor = r.topDirection === 'ACCUM' ? '#10B981' : r.topDirection === 'DIST' ? '#EF4444' : '#94A3B8';
                  const dirGlyph = r.topDirection === 'ACCUM' ? '▲' : r.topDirection === 'DIST' ? '▼' : '◆';
                  const dateStr = r.disclosedOn || r.lastMoveAt;
                  const fmtDate = dateStr ? (() => {
                    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
                    return m ? `${m[3]}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m[2])-1]}` : dateStr;
                  })() : '';
                  const investor = r.investorName || (r.investors && r.investors[0]) || '';
                  // Compact investor display (initial + lastname)
                  const investorShort = investor.split(' ').length > 1
                    ? investor.split(' ').map((p: string, idx: number) => idx === 0 ? p[0] + '.' : p).join(' ').slice(0, 14)
                    : investor.slice(0, 12);
                  // PATCH 0734 — for news-derived rows the "ticker" is actually the
                  // company name (no real ticker parseable from headlines).
                  // PATCH 0901 — Try reverse-resolving the company name to a ticker
                  // (Sammaan Capital → SAMMAANCAP, TV Today Network → TVTODAY,
                  // Nazara → NAZARA, etc) so all rows show a ticker chip and align
                  // visually with roster rows. When unresolvable, reserve the same
                  // column width with an em-dash so the layout doesn't reflow.
                  const rawTicker = (r.ticker || '').toString().replace(/\.(NS|BO)$/i, '');
                  let resolvedTicker = '';
                  if (/^[A-Z][A-Z0-9&-]{1,9}$/.test(rawTicker)) {
                    resolvedTicker = rawTicker;
                  } else {
                    // ticker field is a company-name string — reverse-lookup
                    const fromName = resolveCompanyToTicker(r.company || rawTicker);
                    if (fromName) resolvedTicker = fromName;
                  }
                  const isRealTicker = !!resolvedTicker;
                  const linkHref = isRealTicker
                    ? `/stock-sheet?ticker=${encodeURIComponent(resolvedTicker)}`
                    : '/super-investors';
                  return (
                    <Link key={(r.ticker || '') + i} href={linkHref}
                      title={isRealTicker ? `Open ${resolvedTicker} stock sheet` : 'No NSE ticker found — open Super Investors tracker'}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                      <span style={{ fontSize: 9, color: isRealTicker ? 'var(--mc-state-persistent)' : '#3F4D63', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 70, textAlign: 'left' }}>
                        {isRealTicker ? resolvedTicker.slice(0, 10) : '—'}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.company || rawTicker}
                      </span>
                      <span style={{ fontSize: 9, color: DIM, fontStyle: 'italic', whiteSpace: 'nowrap', minWidth: 76, textAlign: 'right' }} title={investor}>
                        {investorShort}
                      </span>
                      {typeof r.stakePct === 'number' && (
                        <span style={{ fontSize: 9, color: 'var(--mc-state-persistent)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>
                          {r.stakePct.toFixed(1)}%
                        </span>
                      )}
                      {r.kind === 'flow' && (
                        <span style={{ fontSize: 9, color: dirColor, fontWeight: 800 }}>{dirGlyph}{r.netActions ?? r.addCount ?? 0}</span>
                      )}
                      {fmtDate && (
                        <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace', minWidth: 38, textAlign: 'right' }}>{fmtDate}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════ PATCH 0621 — TWO-COL: MOVERS + SIGNALS ═══════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>

          {/* TOP 5 MOVERS + TOP 5 LOSERS (India) */}
          <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-bullish)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.4px' }}>
                📈 TOP MOVERS · TOP LOSERS
              </span>
              <button onClick={async () => { try { await Promise.all([fetch('/api/market/quotes?market=india&refresh=1', { cache: 'no-store' }), fetch('/api/market/quotes?market=us&refresh=1', { cache: 'no-store' })]); } catch {} if (typeof window !== 'undefined') window.location.reload(); }} title="Force-refresh movers from the latest NSE close" style={{ fontSize: 10, color: 'var(--mc-warn)', background: 'transparent', border: '1px solid var(--mc-warn)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', marginRight: 8 }}>🔄 Refresh</button>
              <Link href="/movers" title="Home shows YOUR universe (Watchlist + Portfolio + CB) first, then fills with broad-market top movers. The /movers page shows the full NSE universe by raw % move." style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open →</Link>
            </div>
            {/* PATCH 0795 — module-level feed-gap banner (replaces per-row repetition) */}
            {(() => {
              const attrs = Object.values(data.moversAttrib || {});
              const gapCount = attrs.filter((a: any) => a?.evidence?.feedGap).length;
              if (gapCount === 0 || attrs.length === 0) return null;
              return (
                <div style={{
                  fontSize: 10, color: 'var(--mc-warn)', padding: '4px 6px',
                  background: 'color-mix(in srgb, var(--mc-warn) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 13%, transparent)',
                  borderRadius: 3, marginBottom: 6, lineHeight: 1.4,
                }}>
                  ⚠ Some scans incomplete · confidence reduced for movers without confirmed triggers
                </div>
              );
            })()}
            {/* PATCH 0775 — sub-header reflects own-universe filter
                (Watchlist + Portfolio + Conviction Beats). Falls back to
                small+midcap when user's universe doesn't intersect the
                quotes response. */}
            <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
              {(() => {
                const open = _isIndianMarketOpen();
                // PATCH 1101xx — Honest staleness label. User saw "live · 08:24 am"
                // in pre-market when data was actually yesterday's BHAVCOPY close.
                // EPACKPEB was +9.99% (Thursday's day-change) shown as "live" while
                // today's actual was -2.32%. Now: only say "live" if data is fresh
                // (<10 min old) AND market is open. Otherwise show T-1 BHAVCOPY warning.
                const updatedAtMs = data.moversUpdatedAt ? new Date(data.moversUpdatedAt).getTime() : 0;
                const ageMin = updatedAtMs > 0 ? Math.round((Date.now() - updatedAtMs) / 60_000) : 999;
                // Count stale flags in current movers data to detect BHAVCOPY-only response
                const allMovers = [...((data as any).gainers || []), ...((data as any).losers || [])];
                const staleCount = allMovers.filter((m: any) => m?.staleEOD === true).length;
                const isStaleBlob = allMovers.length > 0 && staleCount / allMovers.length > 0.5;
                const istNow = new Date(new Date().getTime() + (new Date().getTimezoneOffset() + 330) * 60_000);
                const _istMin = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
                const isPreMarket = _istMin < (9 * 60 + 15); // before 9:15 IST
                if (open && ageMin < 10 && !isStaleBlob) {
                  return `Watchlist + Portfolio + CB · live · ${data.moversUpdatedAt ? new Date(data.moversUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}`;
                }
                if (open && (ageMin >= 10 || isStaleBlob)) {
                  return `⚠ Watchlist + Portfolio + CB · STALE T-1 close (${ageMin}m old) · refresh to load live data`;
                }
                if (isPreMarket) {
                  return `🕒 Pre-market · showing YESTERDAY'S CLOSE (T-1 BHAVCOPY) · NSE opens 09:15 IST`;
                }
                const ist = new Date(new Date().getTime() + (new Date().getTimezoneOffset() + 330) * 60_000);
                const dow = ist.getDay();
                const lastClose = (() => {
                  const d = new Date(ist);
                  // Walk back to most recent weekday
                  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
                  if (d.toDateString() === ist.toDateString() && (ist.getHours() * 60 + ist.getMinutes()) < 930) d.setDate(d.getDate() - 1); // PATCH: after 15:30 IST the last close IS today
                  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
                  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
                })();
                return `🕒 NSE closed · ${dow === 0 || dow === 6 ? 'weekend' : 'after hours'} · showing last close (${lastClose})`;
              })()}
            </div>
            {/* PATCH 0735 — honest empty-state when market is closed. Was just
                showing two empty headers ("▲ GAINERS" + "▼ LOSERS") with no
                explanation, which read as a bug. Now market-hours aware. */}
            {!data.gainers && !data.losers ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading…</div>
            ) : ((data.gainers?.length || 0) === 0 && (data.losers?.length || 0) === 0) ? (
              /* PATCH 0756 — upstream returned no movers (rare even on weekends —
                 means the quotes API has no data for this date). Show the open
                 Movers page deeplink, but don't pre-emptively hide the list
                 just because market is closed (P0735's behaviour). */
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic', padding: '8px 6px', lineHeight: 1.5 }}>
                No movers data available right now. <Link href="/movers" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open full Movers page →</Link>
              </div>
            ) : (() => {
              // PATCH 0796 — tiered movers display:
              //   • Compact 1-line row (ticker + pct + label + chips). No multi-line prose.
              //   • Sections: 🔴 EXTREME (|%|≥10) and 🟠 STANDARD (5–10).
              //   • Anomaly tag (CIRCUIT/NEWS_GAP/UNEXPLAINED) when applicable.
              //   • 👁 badge if ticker is in user's universe (Watchlist∪Portfolio∪CB).
              //   • Sector breadth moved to footer (single line, not per-row).
              const norm = (s: string) => (s || '').toString().toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
              const universeSet = new Set<string>();
              try { (JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]') || []).forEach((t: string) => universeSet.add(norm(t))); } catch {}
              try { getConvictionTickers().forEach((t: string) => universeSet.add(norm(t))); } catch {}
              try { (JSON.parse(localStorage.getItem('portfolioHoldings') || '[]') || []).forEach((h: any) => { if (h?.ticker) universeSet.add(norm(h.ticker)); }); } catch {}

              const renderRow = (m: any, pos: 'up' | 'dn') => {
                const tk = (m.ticker || '').toUpperCase();
                const attr = data.moversAttrib?.[tk];
                const pct = m.changePercent ?? 0;
                const c = pos === 'up' ? '#10B981' : '#EF4444';
                const tier = moverTier(pct);
                const anom = anomalyTag({ changePercent: pct, attribution: attr, tier });
                const inUniverse = universeSet.has(tk);

                // PATCH 0797 + P0800 + P0801 — composite scoring with all
                // available data sources. All inputs optional; graceful fallback.
                const fund = data.moverFundamentals?.[tk];
                const reason = data.moverReasons?.[tk];
                const score = scoreCatalyst({
                  attribution: attr,
                  changePercent: pct,
                  marketCap: m.marketCap || fund?.mcapCr,
                  indexGroup: m.indexGroup,
                  volume: m.volume,
                  deliveryPct: m.deliveryPct,
                  turnoverLacs: m.turnoverLacs,
                  volMultiple: m.volMultiple,
                  mom1M: m.mom1M,
                  pctOf52wHigh: m.pctOf52wHigh,
                  promoterPct: fund?.promoterPct,
                  opmLatestQ: fund?.opmLatestQ,
                  opMargin3yAvg: fund?.opMargin3yAvg,
                  salesQtrYoY: fund?.salesQtrYoY,
                  patQtrYoY: fund?.patQtrYoY,
                  exceptionalItemsFlag: fund?.exceptionalItemsFlag,
                });
                // PATCH 0801 — When the local engine has no confirmed trigger
                // AND we have a public-source headline from the multi-source
                // news scrape, override primaryDriver with the headline. This
                // is the highest-quality public signal we can offer free.
                if (reason?.topReason?.headline && (
                  !attr ||
                  attr.catalystType === 'NONE' ||
                  attr.catalystType === 'SECTOR_ROTATION'
                )) {
                  score.primaryDriver = reason.topReason.headline.length > 80
                    ? reason.topReason.headline.slice(0, 80) + '…'
                    : reason.topReason.headline;
                  if (!score.secondaryDriver && reason.narrative?.category) {
                    score.secondaryDriver = `${reason.narrative.category} · ${reason.topReason.source}`;
                  }
                  // Bump bucket — public-source headline means we have a real reason
                  if (score.bucket === 'random_noise' || score.bucket === 'speculative') {
                    score.bucket = 'high_conviction';
                  }
                  // Add a chip if not already there
                  if (!score.chips.find((c: any) => c.text === 'NEWS')) {
                    score.chips.unshift({ text: reason.narrative?.category || 'NEWS', tone: 'positive' });
                  }
                }
                const primaryLabel = score.primaryDriver;

                // PATCH 0805 — Move Quality + Continuation Probability + Smart Money
                // Layer on top of attribution. Graceful fallback when fields missing.
                const mq = attr ? computeMoveQuality({
                  changePercent: pct,
                  attribution: attr,
                  volMultiple: m.volMultiple,
                  deliveryPct: m.deliveryPct,
                  turnoverLacs: m.turnoverLacs,
                  pctOf52wHigh: m.pctOf52wHigh,
                  mom1M: m.mom1M,
                  vol20DAvg: m.vol20DAvg,
                  marketCap: m.marketCap || fund?.mcapCr,
                  indexGroup: m.indexGroup,
                }) : null;

                // PATCH 0821 — historical outcome priors per bucket
                const hist = mq ? getHistoricalOutcome(mq.bucket) : null;
                const tooltip = [
                  `${primaryLabel} (score ${score.compositeScore})`,
                  score.narrative,
                  attr?.detail || '',
                  `Confidence: ${attr?.confidence || 'LOW'} · Sustainability: ${score.sustainability.toUpperCase()}`,
                  mq ? `\n── Move Quality ${mq.quality}/100 (${mq.qualityLabel}) · Continuation ${mq.continuation} · ${mq.bucketLabel}` : '',
                  ...(mq?.smartMoney || []),
                  mq?.technical ? `Technical: ${mq.technical}` : '',
                  mq ? `Liquidity: ${mq.liquidityRisk}` : '',
                  hist ? `\n── Historical: ${hist.followThroughPct}% follow-through · median ${hist.medianReturn5d} 5d\n${hist.note}` : '',
                ].filter(Boolean).join('\n');

                // PATCH 0820: cleaner row — use the new 9-bucket taxonomy from
                // move-quality.ts as the ONE primary label. Drop the duplicate
                // catalyst-scoring bucket (had "NOISE") and the event chip.
                // Final row: 👁 · ticker · pct · [bucket from mq] · driver · Q · ↑/↓ · ⌀
                // PATCH 0903 — Institutional polish on the primary driver text:
                //   - strip " · NEWS · Google News" / " · EARNINGS · Google News"
                //     source-attribution suffixes (looks like a scanner, not
                //     analyst output)
                //   - strip publisher-name dashes ("... - scanx.trade", "... - Markets Mojo")
                //   - cap length at 120 chars, ellipsis-clip at the last space
                //     instead of mid-word
                //   - de-duplicate "vol Nx 20D" appearing in both label + Vol chip
                //   - normalise "earnings result" -> "Earnings (Q4 FY26)" when
                //     period can be inferred from any chip
                const cleanDriverLabel = (s: string | null | undefined): string | null => {
                  if (!s) return null;
                  let t = s;
                  // Strip Google News / source attribution suffixes
                  t = t.replace(/\s*[·•]\s*(?:NEWS|EARNINGS|MARKETS?|RATING|OFS|BLOCK_?DEAL|MNA|REGULATORY|ANALYST|FILING)\s*[·•]\s*[\w \-.]{2,40}\s*$/i, '');
                  // Strip publisher dash suffix ("... - scanx.trade", "... - Markets Mojo")
                  t = t.replace(/\s+[-–]\s+[\w&. -]{3,40}(?:\.com|\.in|\.trade|\.co|\.org|\.net)?\s*$/i, '');
                  // Drop trailing "Ma…" / "Ear…" truncation artifacts
                  t = t.replace(/\s+[A-Z][a-z]{0,3}…\s*$/, '…');
                  // De-duplicate "vol Nx 20D" when it appears inside the label
                  // (right-side chip already shows it for the same row).
                  // PATCH 0903 — vm not in scope at this point; use a generic
                  // regex match for any "vol N.Nx 20D" pattern.
                  t = t.replace(/\s*[·•]?\s*(?:vol|volume)\s+\d+(?:\.\d+)?\s*×\s*20D\b/gi, '');
                  // Cap length, smart-trim at last space
                  const MAX = 130;
                  if (t.length > MAX) {
                    const cut = t.lastIndexOf(' ', MAX - 1);
                    t = (cut > 80 ? t.slice(0, cut) : t.slice(0, MAX - 1)) + '…';
                  }
                  return t.trim() || null;
                };
                // PATCH 1016 — EARNINGS CONTINUITY: when this mover reported in the
                // recent window, lead the reason with the structured earnings
                // reaction (quarter · sales/PAT YoY · tier · beat/miss read). This
                // is the earnings logic the user built; it now takes precedence
                // over the generic news headline / microstructure label for
                // earnings movers, and degrades gracefully when no earnings on file.
                const _eq: any = (data as any).moversEarnings?.[tk] || (data as any).moversEarnings?.[canonicalTicker(m.ticker)];
                let _earningsLead: string | null = null;
                if (_eq && (typeof _eq.sales_yoy_pct === 'number' || typeof _eq.net_profit_yoy_pct === 'number')) {
                  const _fmt = (v: any) => typeof v === 'number' ? `${v >= 0 ? '+' : ''}${Math.round(v)}%` : '';
                  const _q = _eq.quarter ? `${_eq.quarter} ` : '';
                  const _sales = typeof _eq.sales_yoy_pct === 'number' ? `sales ${_fmt(_eq.sales_yoy_pct)}` : '';
                  const _pat = typeof _eq.net_profit_yoy_pct === 'number' ? `PAT ${_fmt(_eq.net_profit_yoy_pct)}` : '';
                  const _tier = _eq.tier ? String(_eq.tier).toUpperCase() : '';
                  // beat/miss read from PAT-vs-sales divergence + tier
                  const _s = _eq.sales_yoy_pct, _p = _eq.net_profit_yoy_pct;
                  let _read = '';
                  if (typeof _s === 'number' && typeof _p === 'number') {
                    if (_p >= _s + 8) _read = 'margin expansion';
                    else if (_p <= _s - 8) _read = 'margin squeeze';
                    else if (_s >= 5 && _p <= -5) _read = 'operating deleverage';
                  }
                  const _verb = pct > 0 ? 'rose on' : pct < 0 ? 'fell on' : 'reported';
                  _earningsLead = `${_verb} ${_q}earnings · ${[_sales, _pat].filter(Boolean).join(' · ')}${_tier ? ' · ' + _tier : ''}${_read ? ' · ' + _read : ''}`;
                }
                const primaryDriverText = (() => {
                  if (_earningsLead) return _earningsLead;
                  const raw = attr
                    ? (score.primaryDriver + (score.secondaryDriver ? ' · ' + score.secondaryDriver : ''))
                    : null;
                  return cleanDriverLabel(raw);
                })();
                // PATCH 0821 — smart-money signal as 2nd line under the row
                const smartLine = (mq?.smartMoney || [])[0];
                return (
                  <Link key={tk} href={`/stock-sheet?ticker=${encodeURIComponent(m.ticker)}`}
                    title={tooltip}
                    style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '4px 6px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    {inUniverse && <span style={{ fontSize: 10, color: 'var(--mc-cyan)', flexShrink: 0 }} title="In your Watchlist/Portfolio/CB">👁</span>}
                    <span style={{ fontSize: 11, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 84, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.ticker}</span>
                    <span style={{ fontSize: 11, color: c, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 52, textAlign: 'right' }}>
                      {pos === 'up' ? '+' : ''}{pct.toFixed(1)}%
                    </span>
                    {/* PATCH 0883 — Bucket label demoted to a single-character
                        dot, per user directive: "Stop using category words as
                        final output. These are intermediate signals not
                        explanations. Final output must always be causal sentence
                        + mechanism." Tooltip still carries the bucket name for
                        analysts who want it; the headline text is now driven by
                        the mechanism-aware causal sentence below. */}
                    {mq && (
                      <span style={{
                        fontSize: 11, lineHeight: 1, flexShrink: 0, color: BUCKET_MQ_COLOR[mq.bucket],
                      }} title={`${BUCKET_MQ_SHORT[mq.bucket]} · ${mq.bucketLabel}`}>
                        ●
                      </span>
                    )}
                    {!mq && anom && anom !== 'NEWS_GAP' && (
                      <span style={{
                        fontSize: 11, lineHeight: 1, flexShrink: 0, color: ANOMALY_COLOR[anom],
                      }} title={anom}>
                        ●
                      </span>
                    )}
                    {/* Primary driver — what's actually moving it */}
                    <span style={{
                      flex: 1, fontSize: 10, color: TEXT, fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      minWidth: 0, lineHeight: 1.4,
                    }}>
                      {primaryDriverText || <em style={{ color: '#3F4D63' }}>analyzing…</em>}
                    </span>
                    {/* Move Quality 0-100 (color-tiered) */}
                    {mq && (
                      <span style={{
                        fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 2, letterSpacing: 0.3, flexShrink: 0,
                        background: `${QUALITY_COLOR[mq.qualityLabel]}22`, color: QUALITY_COLOR[mq.qualityLabel],
                      }} title={`Move Quality ${mq.quality}/100\nvol ${Math.round(mq.components.relVol)} · deliv ${Math.round(mq.components.delivery)} · structure ${Math.round(mq.components.structure)} · sector ${Math.round(mq.components.sector)} · trigger ${Math.round(mq.components.trigger)}`}>
                        Q{mq.quality}
                      </span>
                    )}
                    {/* Continuation Probability */}
                    {mq && mq.continuation !== 'UNKNOWN' && (
                      <span style={{
                        fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 2, letterSpacing: 0.3, flexShrink: 0,
                        background: `${CONTINUATION_COLOR[mq.continuation]}22`, color: CONTINUATION_COLOR[mq.continuation],
                      }} title={`Continuation: ${mq.continuation}\nBucket: ${mq.bucketLabel}`}>
                        {mq.continuation === 'HIGH' ? '↑↑' : mq.continuation === 'MEDIUM' ? '↑' : '↓'}
                      </span>
                    )}
                    {/* Illiquid warning — thin turnover */}
                    {mq?.liquidityRisk === 'HIGH' && (
                      <span style={{
                        fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 2, letterSpacing: 0.2, flexShrink: 0,
                        background: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', color: 'var(--mc-bearish)',
                      }} title="Thin turnover — not tradable in real size">
                        ⌀
                      </span>
                    )}
                  </div>
                  {/* PATCH 0860 — Smart-money signal MOVED into tooltip; no 2nd line.
                      User said: 'should be in same line for one company'. The signal
                      stays accessible via hover tooltip but doesn't take vertical space. */}
                  </Link>
                );
              };

              // PATCH 1013 — always show the full top-20 gainers + top-20 losers
              // (flat list). The old EXTREME/STANDARD tier split hid every name
              // that moved <5%, so on calm/closed days only a handful showed.
              // Per-row colour + bucket dot still convey magnitude.
              const sectorMoves = (data as any).sectorRotation;
              const topG = (data.gainers || []).slice(0, 20);
              const topL = (data.losers || []).slice(0, 20);

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    {topG.length > 0 && (
                      <>
                        <div style={{ fontSize: 9, color: 'var(--mc-bullish)', fontWeight: 700, marginTop: 2, marginBottom: 2, letterSpacing: '0.3px' }}>▲ GAINERS ({topG.length})</div>
                        {topG.map((g: any) => renderRow(g, 'up'))}
                      </>
                    )}
                    {topL.length > 0 && (
                      <>
                        <div style={{ fontSize: 9, color: 'var(--mc-bearish)', fontWeight: 700, marginTop: 6, marginBottom: 2, letterSpacing: '0.3px' }}>▼ LOSERS ({topL.length})</div>
                        {topL.map((l: any) => renderRow(l, 'dn'))}
                      </>
                    )}
                    {topG.length === 0 && topL.length === 0 && (
                      <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic', padding: '4px 0' }}>
                        Movers feed not loaded yet — try Hard Refresh on /movers.
                      </div>
                    )}
                  </div>
                  {/* PATCH 0821 — sector breadth + top-3 leaders per sector */}
                  {sectorMoves?.topSector && sectorMoves?.bottomSector && (() => {
                    // Derive top-3 leaders from gainers/losers list in each sector
                    const topSec = sectorMoves.topSector.sector;
                    const botSec = sectorMoves.bottomSector.sector;
                    // PATCH 0866 — relaxed match — sector aggregate label may be
                    // 'Energy' while individual stock sector may be 'Oil, Gas & Consumable
                    // Fuels'. Substring match both ways so leaders/laggards always render.
                    const matchSector = (stockSec: string, target: string) => {
                      if (!stockSec || !target) return false;
                      const s = stockSec.toLowerCase(); const t = target.toLowerCase();
                      return s === t || s.includes(t) || t.includes(s);
                    };
                    const topLeaders = (data.gainers || [])
                      .filter((g: any) => matchSector(g.sector || '', topSec))
                      .slice(0, 3)
                      .map((g: any) => g.ticker);
                    const botLaggards = (data.losers || [])
                      .filter((l: any) => matchSector(l.sector || '', botSec))
                      .slice(0, 3)
                      .map((l: any) => l.ticker);
                    return (
                      <div style={{
                        fontSize: 9.5, color: DIM, padding: '4px 6px', marginTop: 4,
                        borderTop: '1px solid var(--mc-bg-4)', lineHeight: 1.6,
                      }}>
                        <div>
                          <span style={{ color: '#8DA1B9', fontWeight: 700 }}>Sector breadth:</span>{' '}
                          <span style={{ color: 'var(--mc-bullish)' }}>{topSec} {sectorMoves.topSector.pct >= 0 ? '+' : ''}{sectorMoves.topSector.pct.toFixed(1)}%</span>
                          {' · '}
                          <span style={{ color: 'var(--mc-bearish)' }}>{botSec} {sectorMoves.bottomSector.pct.toFixed(1)}%</span>
                        </div>
                        {(topLeaders.length > 0 || botLaggards.length > 0) && (
                          <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 1 }}>
                            {topLeaders.length > 0 && <>▲ leaders: <span style={{ color: 'var(--mc-text-3)' }}>{topLeaders.join(', ')}</span></>}
                            {topLeaders.length > 0 && botLaggards.length > 0 && ' · '}
                            {botLaggards.length > 0 && <>▼ laggards: <span style={{ color: 'var(--mc-text-3)' }}>{botLaggards.join(', ')}</span></>}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>

          {/* SIGNALS — high-importance corporate news (PATCH 0865 — institutional font sizing) */}
          <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-cyan)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px' }}>
                📡 SIGNALS ({data.signals?.length || 0})
              </span>
              <Link href="/orders" style={{ fontSize: 12, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open →</Link>
            </div>
            <div style={{ fontSize: 11.5, color: DIM, marginBottom: 8 }}>
              High-importance corporate actions and re-rating triggers · 👁 = in your universe
            </div>
            {!data.signals ? (
              <div style={{ fontSize: 13, color: DIM, fontStyle: 'italic' }}>📡 Loading…</div>
            ) : data.signals.length === 0 ? (
              <div style={{ fontSize: 13, color: DIM, fontStyle: 'italic' }}>No high-importance corporate items in last 24h.</div>
            ) : (() => {
              // Build user-universe set for 👁 chip + reorder (universe rows first)
              const norm = (s: string) => (s || '').toString().toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
              const universeSet = new Set<string>();
              try { (JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]') || []).forEach((t: string) => universeSet.add(norm(t))); } catch {}
              try { getConvictionTickers().forEach((t: string) => universeSet.add(norm(t))); } catch {}
              try { (JSON.parse(localStorage.getItem('portfolioHoldings') || '[]') || []).forEach((h: any) => { if (h?.ticker) universeSet.add(norm(h.ticker)); }); } catch {}
              const enriched = data.signals.slice().map((s: any) => {
                const tk = norm(s.primary_ticker || (Array.isArray(s.ticker_symbols) && s.ticker_symbols[0]) || '');
                return { ...s, _ticker: tk, _inUniverse: tk && universeSet.has(tk) };
              });
              // Sort: universe rows first, otherwise preserve relative order
              enriched.sort((a: any, b: any) => {
                if (a._inUniverse !== b._inUniverse) return a._inUniverse ? -1 : 1;
                return 0;
              });
              const SHOWN = 30;  // PATCH 0900: restored 30 per user — 15 felt too short, 30 was right
              const items = enriched.slice(0, SHOWN);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minHeight: 0 }}>
                  {items.map((s: any, i: number) => (
                    <a key={(s.id || '') + i} href={(s as any).url || (s as any).source_url || '#'} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                      {s._inUniverse && <span title="In your Watchlist/Portfolio/CB" style={{ fontSize: 13, color: 'var(--mc-cyan)', flexShrink: 0 }}>👁</span>}
                      <span style={{ fontSize: 11.5, color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 68 }}>
                        {(s._ticker || '').slice(0, 8) || '—'}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: TEXT, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.4 }}>{s.title || s.headline}</span>
                      <span style={{ fontSize: 11, color: DIM, whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.source_name || '—'}</span>
                    </a>
                  ))}
                  {data.signals.length > SHOWN && (
                    <Link href="/orders" style={{ fontSize: 12, color: 'var(--mc-cyan)', textAlign: 'center', padding: '8px 0', textDecoration: 'none', fontWeight: 700, marginTop: 6 }}>
                      + {data.signals.length - SHOWN} more · Open Signals page →
                    </Link>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* ═══════════════ PATCH 0806 — SPECIAL SITUATIONS (below Signals) ═══════════ */}
        <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-bearish)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px' }}>
              🎯 SPECIAL SITUATIONS ({(data as any).specialSituations?.length || 0})
            </span>
            <Link href="/special-situations" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open →</Link>
          </div>
          <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
            OFS · buybacks · open offers · mergers · demergers · rights · preferential — equity-linked only · law precedents pushed to <Link href="/special-situations" style={{ color: 'var(--mc-cyan)' }}>full page</Link>
          </div>
          {!(data as any).specialSituations ? (
            <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading…</div>
          ) : (data as any).specialSituations.length === 0 ? (
            <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>
              No active situations in feed. <Link href="/special-situations" style={{ color: 'var(--mc-cyan)' }}>Browse all →</Link>
            </div>
          ) : (() => {
            // PATCH 0902 — institutional event-type taxonomy with full
            // human-readable labels (not "MA" / "BUYBACK_TENDER" raw enums).
            const EVENT_COLOR: Record<string, string> = {
              OPEN_OFFER:       '#10B981',
              OFS:              '#F59E0B',
              BUYBACK:          '#A78BFA',
              BUYBACK_TENDER:   '#A78BFA',
              MERGER:           '#22D3EE',
              MA:               '#22D3EE',  // some payloads emit raw "MA"
              DEMERGER:         '#22D3EE',
              PREFERENTIAL:     '#FB7185',
              QIP:              '#FB7185',
              RIGHTS:           '#60A5FA',
              RIGHTS_ISSUE:     '#60A5FA',
              SPIN_OFF:         '#22D3EE',
              CORPORATE_ACTION: '#94A3B8',
              STAKE_SALE:       '#FB923C',
              ACQUISITION:      '#10B981',
            };
            const EVENT_LABEL: Record<string, string> = {
              OPEN_OFFER:       'Open offer',
              OFS:              'OFS',
              BUYBACK:          'Buyback',
              BUYBACK_TENDER:   'Buyback (tender)',
              MERGER:           'Merger',
              MA:               'M&A',
              DEMERGER:         'Demerger',
              PREFERENTIAL:     'Pref. allotment',
              QIP:              'QIP',
              RIGHTS:           'Rights issue',
              RIGHTS_ISSUE:     'Rights issue',
              SPIN_OFF:         'Spin-off',
              STAKE_SALE:       'Stake sale',
              ACQUISITION:      'Acquisition',
              CORPORATE_ACTION: 'Corp. action',
            };
            // Crude market inference: USA tickers are typically 1-4 chars
            // ALL-CAPS without digits; Indian tickers can be 5-12 chars OR
            // BSE 6-digit numeric codes.
            const inferMarket = (tk: string): 'IN' | 'US' => {
              const t = (tk || '').trim().toUpperCase();
              if (/^\d{6}$/.test(t)) return 'IN';
              if (t.length >= 5) return 'IN';
              // 1-4 char alpha-only ticker → probably US (KMB, MDT, BIRK, MUFG, TCS overlap unfortunately)
              // Override: known Indian short tickers
              const INDIAN_SHORT = new Set(['TCS', 'LIC', 'IOC', 'ITC', 'BPCL', 'NTPC', 'ONGC', 'IRFC', 'CMS', 'IDFC', 'IGL', 'MGL', 'CGCL', 'HUL', 'SBI', 'GAIL', 'IDBI', 'OIL', 'GIC', 'IOB']);
              if (INDIAN_SHORT.has(t)) return 'IN';
              return /^[A-Z]{1,4}$/.test(t) ? 'US' : 'IN';
            };
            // Try to parse a ₹ Cr / $ M figure from the headline
            const extractDealValue = (headline: string): string | null => {
              if (!headline) return null;
              const inr = headline.match(/(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|cr\.?|Cr)/i);
              if (inr) return `₹${inr[1]} Cr`;
              const usdBn = headline.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:bn|billion)/i);
              if (usdBn) return `$${usdBn[1]}bn`;
              const usdMn = headline.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:m\b|mn\b|million)/i);
              if (usdMn) return `$${usdMn[1]}M`;
              return null;
            };
            const norm = (s: string) => (s || '').toString().toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
            const universeSet = new Set<string>();
            try { (JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]') || []).forEach((t: string) => universeSet.add(norm(t))); } catch {}
            try { getConvictionTickers().forEach((t: string) => universeSet.add(norm(t))); } catch {}
            try { (JSON.parse(localStorage.getItem('portfolioHoldings') || '[]') || []).forEach((h: any) => { if (h?.ticker) universeSet.add(norm(h.ticker)); }); } catch {}
            const items: any[] = (data as any).specialSituations.slice(0, 12);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {items.map((ev: any, i: number) => {
                  const evColor = EVENT_COLOR[ev.event_type] || '#94A3B8';
                  const inUniverse = universeSet.has(ev.ticker);
                  // Days since announced + days to next catalyst (heuristic from lib/specsit-playbooks if data is missing)
                  let daysSince = '';
                  let nextCatalyst = '';
                  if (ev.announced_at) {
                    const days = Math.max(0, Math.round((Date.now() - new Date(ev.announced_at).getTime()) / 86400000));
                    daysSince = days === 0 ? 'today' : `${days}d ago`;
                  }
                  if (ev.next_catalyst_date) {
                    const days = Math.round((new Date(ev.next_catalyst_date).getTime() - Date.now()) / 86400000);
                    if (days >= 0) nextCatalyst = `→ ${days}d`;
                    else nextCatalyst = `${-days}d past`;
                  }
                  const headline = ev.headline || ev.sub_category || ev.event_type;
                  const evRaw = (ev.event_type || '').toString().toUpperCase();
                  const evLabel = EVENT_LABEL[evRaw] || evRaw.replace(/_/g, ' ').toLowerCase().replace(/^(.)/, (c: string) => c.toUpperCase());
                  const market = inferMarket(ev.ticker || '');
                  const dealValue = extractDealValue(headline);
                  return (
                    <Link key={(ev.ticker || '') + i}
                      href={`/stock-sheet?ticker=${encodeURIComponent(ev.ticker)}`}
                      title={[
                        `${ev.ticker} (${market}) · ${evLabel}${ev.sub_category ? ' · ' + ev.sub_category : ''}`,
                        headline,
                        ev.announced_at ? `Announced: ${ev.announced_at} (${daysSince})` : '',
                        ev.next_catalyst_date ? `Next catalyst: ${ev.next_catalyst_date} (${nextCatalyst})` : '',
                        ev.expected_alpha ? `Expected alpha: ${ev.expected_alpha}` : '',
                        dealValue ? `Deal value: ${dealValue}` : '',
                      ].filter(Boolean).join('\n')}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                      {inUniverse && <span style={{ fontSize: 11, color: 'var(--mc-cyan)', flexShrink: 0 }} title="In your Watchlist/Portfolio/CB">👁</span>}
                      {/* PATCH 0902 — FILED vs REPORTED replaces DIRECT vs NEWS for clarity */}
                      {ev.tradeability === 'DIRECT_TRADE' ? (
                        <span title="Filed event — exchange-disclosed structured filing (OFS / buyback / open offer / scheme)"
                          style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, letterSpacing: 0.4, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)', flexShrink: 0 }}>
                          FILED
                        </span>
                      ) : (
                        <span title="Reported in news — verify against filing before sizing"
                          style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, letterSpacing: 0.4, background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', color: 'var(--mc-state-persistent)', flexShrink: 0 }}>
                          REPORTED
                        </span>
                      )}
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, flexShrink: 0, color: market === 'US' ? '#F87171' : 'var(--mc-cyan)', background: market === 'US' ? '#F8717122' : 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' }}>
                        {market === 'US' ? '🇺🇸 US' : '🇮🇳 IN'}
                      </span>
                      <span style={{ fontSize: 12, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 78, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ev.ticker}
                      </span>
                      <span style={{
                        fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 3, letterSpacing: 0.3, flexShrink: 0,
                        background: `${evColor}22`, color: evColor, border: `1px solid ${evColor}40`,
                      }}>
                        {evLabel.toUpperCase()}
                      </span>
                      {dealValue && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, letterSpacing: 0.2, flexShrink: 0,
                          color: 'var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', fontFamily: 'ui-monospace, monospace',
                        }} title="Deal value extracted from headline">
                          {dealValue}
                        </span>
                      )}
                      <span style={{
                        flex: 1, fontSize: 12, color: TEXT, fontWeight: 500,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, lineHeight: 1.4,
                      }}>
                        {headline}
                      </span>
                      {ev.expected_alpha && (
                        <span style={{ fontSize: 9, color: 'var(--mc-bullish)', fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', flexShrink: 0 }}>
                          {ev.expected_alpha}
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: DIM, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {daysSince}{nextCatalyst && <> · <span style={{ color: 'var(--mc-warn)' }}>{nextCatalyst}</span></>}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* ═══════════════ PATCH 0622 — TWO-COL: WATCHLIST PULSE + UPCOMING EARNINGS ═ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
          {/* WATCHLIST PULSE — PATCH 0774 — cap filter + attribution */}
          <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-cyan)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px' }}>
                👁 WATCHLIST PULSE ({data.watchlistPulse?.length || 0})
              </span>
              <Link href="/watchlists" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open →</Link>
            </div>
            <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
              {_isIndianMarketOpen()
                ? 'Small + Midcap watchlist names with ≥3% intraday move · with reason'
                : '🕒 NSE closed · small + midcap last-close moves with attribution'}
            </div>
            {!data.watchlistPulse ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading…</div>
            ) : data.watchlistPulse.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic', lineHeight: 1.5 }}>
                {_isIndianMarketOpen()
                  ? 'No watchlist names ≥3% today.'
                  : 'All watchlist names closed within ±1% last session.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.watchlistPulse.slice(0, 5).map((w) => {
                  const attr = (w as any).attrib;
                  // PATCH 0866 — drop the '+5.83% last close' echo. Show attribution
                  // label (real reason) if present, else hide the sub-line entirely.
                  // Previously was: `attr?.label || (w as any).reason || ''` which
                  // fell back to '+X% last close' duplicating the pct chip on the
                  // main row.
                  const rawReason = (w as any).reason || '';
                  const isPctEcho = /^[+-]?\d+(?:\.\d+)?%\s+last\s+close$/i.test(rawReason);
                  const label = attr?.label || (isPctEcho ? '' : rawReason);
                  const conf = attr?.confidence;
                  // PATCH 0821 — compute Move Quality on watchlist pulse rows too
                  const mqW = attr ? computeMoveQuality({
                    changePercent: w.changePercent,
                    attribution: attr,
                  }) : null;
                  const smartLineW = (mqW?.smartMoney || [])[0];
                  return (
                    <Link key={w.ticker} href={`/stock-sheet?ticker=${encodeURIComponent(w.ticker)}`}
                      style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 6px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 70 }}>{w.ticker}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.company || w.ticker}</span>
                        {(w as any).cap && <span style={{ fontSize: 8, color: '#8DA1B9', fontWeight: 700, padding: '1px 4px', border: '1px solid #2A3550', borderRadius: 3 }}>{((w as any).cap || '').toUpperCase()}</span>}
                        <span style={{ fontSize: 11, color: w.changePercent >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                          {w.changePercent >= 0 ? '+' : ''}{w.changePercent.toFixed(1)}%
                        </span>
                        {/* PATCH 0821 — Q + continuation chips */}
                        {mqW && (
                          <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 2, background: `${QUALITY_COLOR[mqW.qualityLabel]}22`, color: QUALITY_COLOR[mqW.qualityLabel], flexShrink: 0 }}>
                            Q{mqW.quality}
                          </span>
                        )}
                        {mqW && mqW.continuation !== 'UNKNOWN' && (
                          <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 2, background: `${CONTINUATION_COLOR[mqW.continuation]}22`, color: CONTINUATION_COLOR[mqW.continuation], flexShrink: 0 }}>
                            {mqW.continuation === 'HIGH' ? '↑↑' : mqW.continuation === 'MEDIUM' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                      {label && (
                        <div style={{ fontSize: 10, color: DIM, paddingLeft: 76, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {label}{conf && <span style={{ marginLeft: 6, fontSize: 8, color: conf === 'HIGH' ? 'var(--mc-bullish)' : conf === 'MEDIUM' ? 'var(--mc-warn)' : 'var(--mc-text-4)', fontWeight: 700 }}>{conf}</span>}
                        </div>
                      )}
                      {/* PATCH 0821 — smart-money signal */}
                      {smartLineW && (
                        <div style={{ fontSize: 9, color: 'var(--mc-text-3)', paddingLeft: 76, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {smartLineW}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* UPCOMING EARNINGS — next 5 days, CB-first */}
          <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-warn)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px' }}>
                ⏭ UPCOMING EARNINGS — next 7d ({data.upcomingEarnings?.length || 0})
              </span>
              <Link href="/calendars" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Calendar →</Link>
            </div>
            <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
              Conviction Beats (★) + Watchlist (👁) names reporting first
            </div>
            {!data.upcomingEarnings ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading earnings calendar…</div>
            ) : data.upcomingEarnings.length === 0 ? (
              // PATCH 0749 — Honest empty-state with diagnostic + actionable path.
              // Previously just said "No upcoming filings in next 7 days." which
              // looked like a stale-data bug when the user could open the Calendar
              // page and see filings. Now distinguishes: real-empty (weekend/
              // holiday cluster) vs pipeline-degraded (KV writes failing).
              <div style={{ fontSize: 11, color: DIM, padding: '4px 2px', lineHeight: 1.5 }}>
                <div style={{ marginBottom: 6 }}>
                  📭 No upcoming filings parsed in next 7 days.
                </div>
                <div style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>
                  Could be a real quiet week, or the calendar refresh cron is degraded.
                  Check the <Link href="/calendars" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>full Calendar →</Link>
                  {' '}or <Link href="/earnings-opportunities" style={{ color: 'var(--mc-warn)', textDecoration: 'none' }}>EO page →</Link>
                  {' '}to verify which days have filings.
                </div>
                {/* PATCH 0904 — surgical retry. Re-invokes the component-scope
                    refetchUpcomingEarnings useCallback so ONLY this panel
                    refreshes instead of doing window.location.reload()
                    (which blew away every other panel's state too). */}
                <button onClick={() => { refetchUpcomingEarnings(); }} disabled={upcomingRetrying}
                  style={{ marginTop: 8, padding: '4px 10px', fontSize: 10, background: 'transparent', color: upcomingRetrying ? 'var(--mc-text-4)' : 'var(--mc-cyan)', border: `1px solid ${upcomingRetrying ? 'var(--mc-text-4)' : 'var(--mc-cyan)'}`, borderRadius: 4, cursor: upcomingRetrying ? 'wait' : 'pointer' }}>
                  {upcomingRetrying ? '⏳ Retrying…' : '↻ Retry fetch'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.upcomingEarnings.slice(0, 6).map((e) => (
                  <Link key={e.ticker} href={`/stock-sheet?ticker=${encodeURIComponent(e.ticker)}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                    <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace', minWidth: 50 }}>
                      {e.daysAhead === 0 ? 'today' : e.daysAhead === 1 ? 'tomorrow' : `+${e.daysAhead}d`}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.company || e.ticker}
                    </span>
                    {e.onCb && <span style={{ fontSize: 10, color: 'var(--mc-warn)' }}>★</span>}
                    {e.onWatchlist && <span style={{ fontSize: 10, color: 'var(--mc-cyan)' }}>👁</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* PATCH 0773 — Rating Actions + Order Book panels DELETED.
            User feedback: "i am tred delete these and all reelvant atbs".
            Upstream filings feed was producing 0 rows / stale data for
            multiple days post-Upstash migration. Modules are no longer
            shown on the Home dashboard; standalone pages also deleted
            (see /rating-actions and /order-book routes). */}

        {/* ═══════════════ PATCH 0631 — VALUATION QUICK-CHECK ═════════════ */}
        <HomeValuationQuickCheck />

        {/* ═══════════════ PATCH 0627 — CRITICAL THEMES PANEL ═════════════ */}
        {(() => {
          const tt = getTopThemesForHome();
          return (
            <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-bearish)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px' }}>
                  🔥 CRITICAL THEMES — top {tt.india.length + tt.us.length} ({tt.india.length} IN · {tt.us.length} US)
                </span>
                <Link href="/critical-themes" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open all →</Link>
              </div>
              <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>
                Choke-point themes for 10+ year horizon · monopoly · policy-backed · governance-filtered
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6, letterSpacing: '0.5px' }}>🇮🇳 INDIA</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {tt.india.map((t) => (
                      <Link key={t.id} href={`/critical-themes`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ background: 'var(--mc-bg-4)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 19%, transparent)', borderRadius: 5, padding: '7px 9px' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 3 }}>{t.emoji} {t.name}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {t.leaders.slice(0, 4).map((l) => (
                              <span key={l.ticker} style={{ fontSize: 9, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>{l.ticker}</span>
                            ))}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#F87171', marginBottom: 6, letterSpacing: '0.5px' }}>🇺🇸 USA</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {tt.us.map((t) => (
                      <Link key={t.id} href={`/critical-themes`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ background: 'var(--mc-bg-4)', border: '1px solid #F8717130', borderRadius: 5, padding: '7px 9px' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 3 }}>{t.emoji} {t.name}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {t.leaders.slice(0, 4).map((l) => (
                              <span key={l.ticker} style={{ fontSize: 9, color: '#F87171', background: '#F8717115', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>{l.ticker}</span>
                            ))}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ═══════════════ AI INFRASTRUCTURE TRANSMISSION ═══════════════ */}
        <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-state-persistent)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-state-persistent)', letterSpacing: '0.4px' }}>🏗 AI INFRASTRUCTURE TRANSMISSION</span>
            <Link href="/bottleneck-intel" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Full Intel →</Link>
          </div>
          <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>
            Bottleneck cascade — click any link to open Workbench with India-listed proxies + counter-thesis
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'center', padding: '8px 0' }}>
            {[
              { label: 'NVIDIA', theme: 'AI_COMPUTE_HBM_COWOS', color: '#10B981' },
              { label: 'HBM', theme: 'AI_COMPUTE_HBM_COWOS', color: '#10B981' },
              { label: 'CoWoS', theme: 'AI_COMPUTE_HBM_COWOS', color: '#10B981' },
              { label: 'Cooling', theme: 'AI_DATA_CENTER_COOLING', color: '#22D3EE' },
              { label: 'Power', theme: 'POWER_GRID_TRANSFORMERS', color: '#F59E0B' },
              { label: 'Transformers', theme: 'POWER_GRID_TRANSFORMERS', color: '#F59E0B' },
              { label: 'Grid', theme: 'POWER_GRID_TRANSFORMERS', color: '#F59E0B' },
              { label: 'Nuclear', theme: 'NUCLEAR_SMR', color: '#A78BFA' },
            ].map((n, i, arr) => (
              <span key={n.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Link href={`/bottleneck-workbench?theme=${n.theme}`} style={{
                  fontSize: 11, fontWeight: 800, color: n.color, padding: '5px 10px', borderRadius: 5,
                  border: `1px solid ${n.color}40`, background: `${n.color}10`, textDecoration: 'none',
                }}>{n.label}</Link>
                {i < arr.length - 1 && <span style={{ color: 'var(--mc-text-4)', fontSize: 14 }}>→</span>}
              </span>
            ))}
          </div>
        </div>

        {/* ═══════════════ TIER 3 — EXPERIMENTAL (collapsed by default) ═ */}
        {lensedTier3.length > 0 && (
          <div style={cardStyle}>
            <button onClick={() => setShowTier3(v => !v)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 13, fontWeight: 800, color: 'var(--mc-text-3)', letterSpacing: '0.4px',
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            }}>
              {showTier3 ? '▾' : '▸'} 🧪 TIER 3 — EXPERIMENTAL / NARRATIVE ({lensedTier3.length})
            </button>
            {!showTier3 && (
              <div style={{ marginTop: 4, fontSize: 10, color: DIM }}>
                B+ grade on Conviction Beats — lower conviction, interesting but unproven
              </div>
            )}
            {showTier3 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: DIM, marginBottom: 6, lineHeight: 1.5 }}>
                  B+ grade on Conviction Beats. Watch but do not size aggressively — these are narrative + bench-membership only,
                  with weaker fundamentals than Tier 1/2.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
                  {lensedTier3.map((a, i) => (
                    <Link key={a.symbol + i} href={a.href} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px', borderRadius: 4,
                      border: '1px solid color-mix(in srgb, var(--mc-text-3) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-text-3) 3%, transparent)', textDecoration: 'none',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.company || a.symbol}</div>
                        <div style={{ fontSize: 9, color: DIM }}>{a.symbol} · {a.sector}</div>
                        {/* PATCH 0866 — show thesis snippet so Tier 3 card doesn't render bare */}
                        {(a as any).thesis && (
                          <div style={{ fontSize: 9.5, color: 'var(--mc-text-3)', marginTop: 3, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            title={(a as any).thesis}>
                            {(a as any).thesis}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, flexShrink: 0 }}>{a.score}{a.grade}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ ALERTS + BOTTLENECK ═════════════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px' }}>⚠ ALERTS ({activeAlerts.length} active)</span>
              <Link href="/news-alerts" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Manage →</Link>
            </div>
            {activeAlerts.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                No alert rules configured. <Link href="/news-alerts" style={{ color: 'var(--mc-cyan)' }}>Set up alerts →</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activeAlerts.slice(0, 5).map((a) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--mc-bg-4)' }}>
                    <span style={{ color: TEXT, fontWeight: 600 }}>{a.name}</span>
                    <span style={{ color: DIM, fontSize: 10 }}>{a.lastFiredAt ? `fired ${timeAgo(a.lastFiredAt)}` : 'pending'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-state-persistent)', letterSpacing: '0.4px' }}>🏗 ACTIVE BOTTLENECK THEMES</span>
              <Link href="/bottleneck-intel" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open Intel →</Link>
            </div>
            {netLoading.bottleneck ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading bottleneck themes…</div>
            ) : data.bottleneck.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>No active bottleneck themes.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.bottleneck.map((b) => {
                  const color = b.severity_color || ((b.severity_label || '').toLowerCase() === 'high' ? '#EF4444' : '#F59E0B');
                  return (
                    <Link key={b.bucket_id} href={`/bottleneck-workbench?theme=${encodeURIComponent(b.bucket_id)}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid var(--mc-bg-4)' }}>
                      <span style={{ fontSize: 14 }}>{b.severity_icon || '⚡'}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
                      <span style={{ fontSize: 9, color, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${color}22` }}>{b.severity_label || 'WATCH'}</span>
                      <span style={{ fontSize: 10, color: DIM, minWidth: 36, textAlign: 'right' }}>{b.article_count || 0}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════ QUICK ACCESS GRID (collapsed by default) ═════ */}
        <div style={cardStyle}>
          <button onClick={() => setShowQuickAccess(v => !v)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: '0.4px',
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          }}>
            {showQuickAccess ? '▾' : '▸'} QUICK ACCESS — all 20+ surfaces
          </button>
          {showQuickAccess && (
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
              {[
                { href: '/concall-intel', label: '🎙 Concall Intel' },
                { href: '/special-situations', label: '🎯 Special Sit' },
                // PATCH 0776 — Rating Actions chip removed (module deleted).
                { href: '/multibagger', label: '🚀 Multibagger' },
                { href: '/valuations', label: '💎 Valuations' },
                { href: '/screener', label: '🔍 Screener' },
                { href: '/strategic-visibility', label: '⭐ Strategic Visibility' },
                { href: '/transmission', label: '🔄 Transmission' },
                { href: '/super-investors', label: '👥 Super Investors' },
                { href: '/breadth', label: '📊 Breadth' },
                { href: '/heatmap', label: '🔥 Heatmap' },
                { href: '/rrg', label: '🎯 RRG' },
                { href: '/ipos', label: '🚀 IPOs' },
                { href: '/movers', label: '📈 Movers' },
                { href: '/smart-money', label: '💰 Smart Money' },
                { href: '/themes', label: '🏷 Themes' },
                { href: '/calendars', label: '📅 Calendars' },
                { href: '/company-intel', label: '🏢 Company Intel' },
                { href: '/stock-sheet', label: '📄 Stock Sheet' },
                { href: '/ai-desk', label: '🤖 AI Desk' },
                { href: '/status', label: '🛠 System Status' },
              ].map((l) => (
                <Link key={l.href} href={l.href} style={{
                  display: 'block', padding: '6px 10px', borderRadius: 4,
                  background: 'var(--mc-bg-0)', border: `1px solid ${BORDER}`,
                  color: TEXT, fontSize: 11, fontWeight: 600, textDecoration: 'none',
                }}>{l.label}</Link>
              ))}
            </div>
          )}
        </div>

        {/* INSTITUTIONAL DISCLOSURE */}
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)', lineHeight: 1.7, padding: '0 4px' }}>
          <strong style={{ color: 'var(--mc-text-3)' }}>Calibration:</strong> Tier 1 = cross-confirmed (A-grade ∩ CB ∩ untagged).
          Tier 2 = A-grade not yet on bench. Tier 3 = B+ on bench (experimental). All scores are evidence-density
          (heuristic regex + lexicon over filings + news), NOT realized-alpha probabilities. Score breakdown visible
          on hover. Risk / horizon / trigger are sector heuristics.{' '}
          <strong style={{ color: 'var(--mc-text-3)' }}>Not shipped (infrastructure-blocked):</strong> market-implied confirmation
          (RS / volume / earnings revisions), realized-alpha feedback loop, factor-overlap analysis, institutional
          ownership changes. Cross-reference source data before sizing.
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function DecisionTierBlock({
  tier, label, color, description, items, expanded, condensed = false, totalCount,
}: {
  tier: number; label: string; color: string; description: string;
  items: TierAction[]; expanded: boolean; condensed?: boolean;
  /* PATCH 1101cc — Optional unfiltered count. When a lens reduces the visible
     items, pass the original list size here so the header shows "(3 of 10)"
     instead of just "(3)" — makes it instantly clear that a filter is hiding
     results. */
  totalCount?: number;
}) {
  const hasFilter = typeof totalCount === 'number' && totalCount > items.length;
  return (
    <div style={{
      ...cardStyle,
      borderColor: `${color}70`,
      background: `linear-gradient(180deg, ${color}14 0%, transparent 100%)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color, letterSpacing: '0.4px' }}>
          {tier === 1 ? '🎯' : tier === 2 ? '👁' : '🧪'} TIER {tier} — {label} {hasFilter ? `(${items.length} of ${totalCount} — lens filtering)` : `(${items.length})`}
        </span>
        <span style={{ fontSize: 10, color, background: `${color}22`, padding: '2px 7px', borderRadius: 3, fontWeight: 700 }}>
          {tier === 1 ? 'ACTION NOW' : tier === 2 ? 'WATCH' : 'EXPERIMENTAL'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 10, lineHeight: 1.45 }}>{description}</div>
      {expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${condensed ? 260 : 320}px, 1fr))`, gap: 10 }}>
          {items.map((a, i) => (
            <Link key={a.symbol + i} href={a.href}
              title={a.scoreBreakdown ? Object.entries(a.scoreBreakdown).map(([k, v]) => `${k}: +${v}`).join('  ·  ') : ''}
              style={{
                display: 'flex', flexDirection: 'column', gap: 5, padding: condensed ? '8px 10px' : '12px 14px', borderRadius: 6,
                border: `1px solid ${color}40`, background: `${color}10`, textDecoration: 'none',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {tier === 1 && <span style={{ fontSize: 18, fontWeight: 900, color }}>#{i + 1}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: condensed ? 13 : 16, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {a.company || a.symbol}
                    {/* PATCH 0617 — market flag chip (IN/US) */}
                    {a.market && (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 3, color: a.market === 'US' ? '#F87171' : 'var(--mc-cyan)', background: a.market === 'US' ? '#F8717122' : 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' }}>
                        {a.market === 'US' ? '🇺🇸 US' : '🇮🇳 IN'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, monospace', fontWeight: 600, marginTop: 2 }}>
                    {a.symbol}{a.sector ? ` · ${a.sector}` : ''}
                  </div>
                </div>
                {a.score != null && (
                  <span style={{ fontSize: condensed ? 13 : 16, color: 'var(--mc-bullish)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {a.score}{a.grade || ''}
                  </span>
                )}
                {/* PATCH 0611 — cbConfirmed glyph so Tier-1 top-ups (non-CB A-grade) are obvious */}
                {tier === 1 && a.cbConfirmed === true && (
                  <span title="Cross-confirmed: on Conviction Beats bench" style={{ fontSize: 12, color: 'var(--mc-warn)', fontWeight: 800 }}>★</span>
                )}
                {tier === 1 && a.cbConfirmed === false && (
                  <span title="A-grade top-up: not yet on Conviction Beats bench" style={{ fontSize: 10, color: 'var(--mc-text-3)', background: 'color-mix(in srgb, var(--mc-text-3) 13%, transparent)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>+</span>
                )}
              </div>
              {!condensed && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 10px', fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
                    <span style={{ color: DIM, fontWeight: 700 }}>Thesis</span>
                    {/* PATCH 1086 — UX-01: scrub stale "Not in turnaround" thesis text for non-turnaround grades */}
                    <span style={{ color: TEXT }}>{(() => {
                      const t = String(a.thesis || '');
                      if (/not in turnaround/i.test(t) || /not turnaround/i.test(t)) {
                        return `Awaiting turnaround signals — grade ${a.grade || '—'}`;
                      }
                      return a.thesis;
                    })()}</span>
                    <span style={{ color: DIM, fontWeight: 700 }}>Risk</span>
                    <span style={{ color: '#FCA5A5' }}>{a.risk}</span>
                    <span style={{ color: DIM, fontWeight: 700 }}>Horizon</span>
                    <span style={{ color: TEXT }}>{a.horizon}</span>
                    <span style={{ color: DIM, fontWeight: 700 }}>Trigger</span>
                    <span style={{ color: 'var(--mc-cyan)' }}>{a.trigger}</span>
                  </div>
                  {a.scoreBreakdown && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                      {Object.entries(a.scoreBreakdown).map(([k, v]) => (
                        <span key={k} style={{ color: DIM, padding: '2px 6px', background: 'var(--mc-bg-0)', borderRadius: 3, fontFamily: 'ui-monospace, monospace' }}>
                          {k} +{v}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: CARD, border: `1px solid ${BORDER}`,
  borderRadius: 8, padding: '14px 16px',
};
function navChip(color: string): React.CSSProperties {
  return {
    // PATCH 0635 — uniform pill: same vertical metric, slight border-radius bump,
    // consistent horizontal padding so chip widths read as a single strip.
    fontSize: 11.5, fontWeight: 700, color, textDecoration: 'none',
    padding: '6px 12px', borderRadius: 6,
    background: `${color}15`, border: `1px solid ${color}40`,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  };
}
function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// PATCH 0631 — Home Valuation Quick-Check panel
function HomeValuationQuickCheck() {
  const [ticker, setTicker] = useState('ATLANTAELE');
  const [pat, setPat] = useState(335);
  const [pe, setPe] = useState(36);
  const [horizon, setHorizon] = useState(18);
  const [mcap, setMcap] = useState(12000);
  const [price, setPrice] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);

  const autoFill = async () => {
    if (!ticker.trim()) return;
    setLoading(true);
    try {
      const q = await fetchQuoteAutofill(ticker, 'india');
      if (q) {
        if (q.currentPrice) setPrice(q.currentPrice);
        if (q.currentMarketCapCr) setMcap(Math.round(q.currentMarketCapCr));
        setAutoFilled(true);
      }
    } finally { setLoading(false); }
  };

  const result = useMemo(() => calculatePE({
    ticker, currentMarketCapCr: mcap, horizonMonths: horizon,
    forwardPATCr: pat,
    bearPE: Math.round(pe * 0.75),
    basePE: pe,
    bullPE: Math.round(pe * 1.4),
    currentPrice: price, currency: '₹',
  }), [ticker, mcap, horizon, pat, pe, price]);

  return (
    <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-cyan)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px' }}>
          🧮 VALUATION QUICK-CHECK
        </span>
        <Link href="/valuation-calc" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Full calculator →</Link>
      </div>
      <div style={{ fontSize: 10, color: DIM, marginBottom: 10 }}>
        Quick P/E-based target. Enter ticker + forward PAT + target P/E. Auto-fills current price + market cap from /api/market/quotes.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          TICKER
          <input value={ticker} onChange={e => { setTicker(e.target.value.toUpperCase()); setAutoFilled(false); }}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          FY27 PAT (₹ Cr)
          <input type="number" value={pat} onChange={e => setPat(Number(e.target.value))}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          BASE P/E
          <input type="number" value={pe} onChange={e => setPe(Number(e.target.value))}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          MARKET CAP (₹ Cr)
          <input type="number" value={mcap} onChange={e => setMcap(Number(e.target.value))}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          HORIZON (months)
          <input type="number" value={horizon} onChange={e => setHorizon(Number(e.target.value))}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={autoFill} disabled={loading} style={{
          fontSize: 10, padding: '4px 10px', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 31%, transparent)',
          color: 'var(--mc-bullish)', borderRadius: 3, cursor: loading ? 'wait' : 'pointer', fontWeight: 800,
        }}>
          {loading ? '⏳ FETCHING…' : '🔄 AUTO-FILL FROM LIVE QUOTE'}
        </button>
        {price && (
          <span style={{ fontSize: 10, color: 'var(--mc-bullish)', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
            ✓ live price ₹{price.toLocaleString('en-IN', { maximumFractionDigits: 1 })} {autoFilled ? '(auto-filled)' : ''}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {result.cases.map((c) => (
          <div key={c.label} style={{ background: 'var(--mc-bg-0)', border: `1px solid ${c.color}40`, borderLeft: `3px solid ${c.color}`, borderRadius: 4, padding: '8px 10px' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: c.color, letterSpacing: '1px' }}>{c.label}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: TEXT, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
              ₹{Math.round(c.marketCapCr).toLocaleString('en-IN')} Cr
            </div>
            {c.targetPrice !== undefined && (
              <div style={{ fontSize: 11, color: c.color, fontWeight: 700, marginTop: 2 }}>
                target ₹{c.targetPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 4 }}>
              <span style={{ color: DIM }}>upside</span>
              <span style={{ color: c.color, fontWeight: 800 }}>{c.upsidePct >= 0 ? '+' : ''}{c.upsidePct.toFixed(0)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 2 }}>
              <span style={{ color: DIM }}>CAGR</span>
              <span style={{ color: c.color, fontWeight: 800 }}>{c.annualizedPct >= 0 ? '+' : ''}{c.annualizedPct.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
