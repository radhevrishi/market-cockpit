'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Shield, RefreshCw, TrendingUp, TrendingDown, Minus, Eye, Filter, Zap, AlertTriangle } from 'lucide-react';
import { CHAT_ID, BOT_SECRET } from '@/lib/config';

// Theme
const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2840';
const ACCENT = '#0F7ABF';
const GREEN = '#10B981';
const RED = '#EF4444';
const YELLOW = '#FBBF24';
const PURPLE = '#8B5CF6';
const CYAN = '#06B6D4';
const ORANGE = '#F97316';
const TEXT1 = '#E2E8F0';
const TEXT2 = '#94A3B8';
const TEXT3 = '#64748B';

const DECISION_COLORS: Record<ActionFlag, string> = {
  'BUY': '#10B981',      // Green
  'ADD': '#059669',      // Dark Green
  'HOLD': '#FBBF24',     // Yellow
  'WATCH': '#A78BFA',    // Purple
  'TRIM': '#F97316',     // Orange
  'EXIT': '#EF4444',     // Red
  'AVOID': '#64748B',    // Grey
  'MONITOR': '#0F7ABF',  // Cyan (Accent)
};

const FRESHNESS_COLORS: Record<string, string> = {
  'FRESH': '#10B981',
  'RECENT': '#06B6D4',
  'AGING': '#FBBF24',
  'STALE': '#64748B',
};

// ── Tab cache: Avoid refetching on every tab switch ──
// Module-level cache persists across component remounts (tab switches)
// Only refetches on explicit refresh or after CACHE_TTL expires
const CACHE_TTL = 30 * 60 * 1000; // 30 min — user controls refresh manually
let _cache: { data: any; timestamp: number; daysFilter: number } | null = null;

// ── Types ──
type ActionFlag = 'BUY' | 'ADD' | 'HOLD' | 'WATCH' | 'TRIM' | 'EXIT' | 'AVOID' | 'MONITOR';
type ScoreClassification = 'HIGH_CONVICTION' | 'STRONG' | 'BUILDING' | 'WEAK' | 'NOISE';
type FreshnessLabel = 'FRESH' | 'RECENT' | 'AGING' | 'STALE';
type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';

interface Signal {
  symbol: string;
  company: string;
  date: string;
  source: 'order' | 'deal';
  eventType: string;
  headline: string;
  valueCr: number;               // NEVER null — always populated
  valueUsd: string | null;
  mcapCr: number | null;
  revenueCr: number | null;
  impactPct: number;             // Core metric: (valueCr / revenueCr) * 100
  pctRevenue: number | null;     // Legacy alias for impactPct
  pctMcap: number | null;
  inferenceUsed: boolean;        // True if value was inferred
  client: string | null;
  segment: string | null;
  timeline: string | null;
  buyerSeller: string | null;
  premiumDiscount: number | null;
  impactLevel: ImpactLevel;
  impactConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceScore?: number;        // 90=ACTUAL / 70=INFERRED / 50=HEURISTIC
  confidenceType?: 'ACTUAL' | 'INFERRED' | 'HEURISTIC';
  dataConfidence?: 'VERIFIED' | 'ESTIMATED' | 'LOW';  // Data quality indicator
  action: ActionFlag;
  score: number;
  timeWeight: number;
  weightedScore: number;
  sentiment: 'Bullish' | 'Neutral' | 'Bearish';
  whyItMatters: string;
  isNegative: boolean;
  earningsBoost: boolean;
  isWatchlist: boolean;
  isPortfolio: boolean;
  isExcel?: boolean;          // from Multibagger Excel Score & Rank engine
  lastPrice?: number | null;       // Current stock price for performance tracking
  dataSource?: string;             // 'NSE' | 'Moneycontrol' | 'Google News' | 'Block Deal' | 'Bulk Deal'
  signalStackCount?: number;
  signalStackLevel?: 'STRONG' | 'BUILDING' | 'WEAK';
  portfolioImpactScore?: number;   // Score for portfolio impact ranking
  scoreDelta?: number;
  scoreClassification?: ScoreClassification;
  freshness?: FreshnessLabel;
  sectorScore?: number;
  sectorTrend?: 'Bullish' | 'Neutral' | 'Bearish';
  decision?: ActionFlag;
  decisionReason?: string;
  tag?: string;

  // 3-Axis Normalized Scores (0-100 each)
  fundamentalScore?: number;     // 0-100 Fundamental Delta
  signalStrengthScore?: number;  // 0-100 Signal Strength
  dataConfidenceScore?: number;  // 0-100 Data Confidence

  // Institutional-grade fields
  signalTier?: 'TIER1_VERIFIED' | 'TIER2_INFERRED';
  contradictions?: string[];
  whyAction?: string;
  anomalyFlags?: string[];
  sourceUrl?: string;
  revenueGrowth?: number | null;
  marginChange?: number | null;
  catalystStrength?: 'WEAK' | 'MODERATE' | 'STRONG';
  conflictResolution?: string;
  sectorCyclical?: boolean;
  priceReactionNote?: string;
  evidenceTier?: 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';
  timeHorizon?: 'SHORT' | 'MEDIUM' | 'LONG';
  watchSubtype?: 'ACTIVE' | 'PASSIVE';
  eventNovelty?: 'NEW' | 'REPEAT' | 'STALE';
  heuristicSuppressed?: boolean;
  extremeValueFlag?: string;
  // v3 fields
  templatePattern?: string;
  identicalPctFlag?: boolean;
  sourceMismatch?: string;
  guidanceAnomalyFlag?: string;
  visibility?: 'VISIBLE' | 'DIMMED' | 'HIDDEN';
  netSignalScore?: number;
  conflictBadge?: string;
  riskFactors?: string[];
  sourceExtract?: string;
  // v4 fields
  sourceTier?: 'VERIFIED' | 'HEURISTIC' | 'INFERRED';
  dataQuality?: 'HIGH' | 'MEDIUM' | 'LOW' | 'BROKEN';
  guidanceScope?: 'COMPANY' | 'SEGMENT' | 'PRODUCT' | 'REGION' | 'UNKNOWN';
  guidancePeriod?: 'FY' | 'Q' | 'RUN_RATE' | 'UNKNOWN';
  actionScore?: number;
  guidanceRangeLow?: number;
  guidanceRangeHigh?: number;
  guidanceRangeConfPenalty?: number;

  // v5 fields
  srcVerified?: boolean;
  numValidated?: boolean;
  scopeValidated?: boolean;
  verified?: boolean;
  confidenceLayer?: number;
  signalCategory?: 'ACTIONABLE' | 'OBSERVATION';
  observationReason?: string;

  // Decision engine fields
  signalClass?: 'ECONOMIC' | 'STRATEGIC' | 'GOVERNANCE' | 'COMPLIANCE';
  materialityScore?: number;
  managementRole?: string;

  // v7 fields
  portfolioCritical?: boolean;
  v7RankScore?: number;
  signalTierV7?: 'ACTIONABLE' | 'NOTABLE' | 'MONITOR';

  // v9: Signal quality model
  dataType?: 'FACT' | 'INFERENCE';
  monitorScore?: number;
  monitorTier?: 'HIGH' | 'MEDIUM' | 'LOW';
  priceChange?: number;
  volumeRatio?: number;
  corroborationCount?: number;

  // v8: Thematic alpha
  alphaTheme?: {
    tag: string;
    label: string;
    score: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    narrative: string;
  };

  // v9: Event taxonomy + signal card format
  eventTaxonomyTier?: 'TIER_1' | 'TIER_2' | 'TIER_3';
  signalScoreBreakdown?: {
    materiality: number;
    confidence: number;
    freshness: number;
    investability: number;
  };
  conflictRange?: { min: number; max: number; sources: string[] };
  whatHappened?: string;
  economicImpact?: string;
  evidence?: string;
  risks?: string[];
  nextConfirmation?: string;
  _speculative?: boolean;
  _stackIndependent?: boolean;
  _stackRawCount?: number;
}

// ── v8: Thematic Idea for always-present alpha section ──
interface ThematicIdea {
  symbol: string;
  company: string;
  theme: {
    tag: string;
    label: string;
    score: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    narrative: string;
  };
  signals: number;
  isPortfolio: boolean;
  isWatchlist: boolean;
  lastPrice?: number | null;
  segment?: string | null;
}

interface TrendSignalDetail {
  headline: string;
  eventType: string;
  date: string;
  sentiment: string;
  action: string;
  impactLevel: string;
  weightedScore: number;
  confidenceScore: number;
  valueCr: number;
  whyItMatters: string;
  dataSource?: string;
}

interface CompanyTrend {
  symbol: string;
  company: string;
  signalCount: number;
  stackLevel: 'STRONG' | 'BUILDING' | 'WEAK';
  topAction: ActionFlag;
  topImpact: ImpactLevel;
  netSentiment: 'Bullish' | 'Neutral' | 'Bearish';
  avgScore: number;
  maxScore?: number;
  signals?: TrendSignalDetail[];
  isExcel?: boolean;   // tagged client-side from Multibagger engine
  isPortfolio?: boolean;
  isWatchlist?: boolean;
}

interface DailyBias {
  netBias: 'Bullish' | 'Neutral' | 'Bearish';
  highImpactCount: number;
  activeSectors: string[];
  buyCount: number;
  addCount?: number;
  holdCount: number;
  watchCount?: number;
  trimExitCount?: number;
  totalSignals: number;
  totalOrderValueCr: number;
  totalDealValueCr: number;
  portfolioAlerts: number;
  negativeSignals: number;
  summary: string;
  // Legacy fields for backwards compatibility
  buyWatchCount?: number;
  trackCount?: number;
}

// ── Helpers ──
const remapActionLabel = (a: ActionFlag): ActionFlag => {
  if (a === 'BUY' || a === 'ADD') return 'MONITOR';
  return a;
};
const actionColor = (a: ActionFlag) => DECISION_COLORS[a] || TEXT3;
const actionBg = (a: ActionFlag) => {
  const colorMap: Record<ActionFlag, string> = {
    'BUY': 'rgba(16,185,129,0.12)',
    'ADD': 'rgba(5,150,105,0.12)',
    'HOLD': 'rgba(251,191,36,0.12)',
    'WATCH': 'rgba(167,139,250,0.12)',
    'TRIM': 'rgba(249,115,22,0.12)',
    'EXIT': 'rgba(239,68,68,0.12)',
    'AVOID': 'rgba(100,116,139,0.08)',
    'MONITOR': 'rgba(15,122,191,0.12)',
  };
  return colorMap[a] || 'rgba(100,116,139,0.08)';
};
const impactColor = (l: ImpactLevel) => l === 'HIGH' ? GREEN : l === 'MEDIUM' ? YELLOW : TEXT3;
const impactBg = (l: ImpactLevel) => l === 'HIGH' ? 'rgba(16,185,129,0.12)' : l === 'MEDIUM' ? 'rgba(251,191,36,0.10)' : 'rgba(100,116,139,0.06)';
const biasColor = (b: string) => b === 'Bullish' ? GREEN : b === 'Bearish' ? RED : YELLOW;
const biasIcon = (b: string) => b === 'Bullish' ? <TrendingUp size={16} /> : b === 'Bearish' ? <TrendingDown size={16} /> : <Minus size={16} />;
const sentimentColor = (s: string) => s === 'Bullish' ? GREEN : s === 'Bearish' ? RED : TEXT3;

const fmtCr = (v: number | null): string => {
  if (v === null || v === undefined || v === 0) return '—';
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  if (v >= 1) return `₹${Math.round(v)} Cr`;
  return `₹${Math.round(v * 100)}L`;
};

const fmtPrice = (v: number | null | undefined): string => {
  if (v === null || v === undefined || v === 0) return 'N/A';
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${v.toFixed(2)}`;
};

const fmtDate = (d: string) => {
  try {
    // Handle DD-MM-YYYY format
    if (d.length === 10 && d[2] === '-') {
      const [dd, mm, yyyy] = d.split('-');
      const dt = new Date(`${yyyy}-${mm}-${dd}`);
      if (!isNaN(dt.getTime())) return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch { return d; }
};

const eventTypeIcon = (t: string) => {
  if (t.includes('Order') || t.includes('Contract') || t.includes('LOI')) return '📋';
  if (t.includes('Capex') || t.includes('Expansion')) return '🏗️';
  if (t.includes('M&A') || t.includes('Demerger')) return '🤝';
  if (t.includes('JV') || t.includes('Partnership')) return '🔗';
  if (t.includes('Fund') || t.includes('QIP')) return '💰';
  if (t.includes('Buyback')) return '🔄';
  if (t.includes('Dividend')) return '💵';
  if (t.includes('Guidance')) return '🎯';
  if (t.includes('Mgmt')) return '👤';
  if (t.includes('Block') || t.includes('Bulk')) return '📊';
  return '📌';
};

type FilterType = 'ALL' | 'BUY' | 'ADD' | 'HOLD' | 'WATCH' | 'TRIM' | 'ORDERS' | 'CAPEX' | 'DEALS' | 'STRATEGIC' | 'NEGATIVE' | 'HIGH_IMPACT' | 'NOTABLE';
type UniverseFilter = 'ALL' | 'PORTFOLIO' | 'WATCHLIST' | 'EXCEL';


/** Filter out GOVERNANCE / Mgmt Change signals — not useful for portfolio decisions */
const _filterGovNoise = (list: any[]) =>
  list.filter(s => {
    const et = (s.eventType || '').toLowerCase();
    if (et === 'mgmt change' || et === 'board appointment' || et === 'board meeting') return false;
    const sc = (s.signalClass || '').toLowerCase();
    if (sc === 'governance' && (et.includes('change') || et.includes('appointment') || et.includes('board'))) return false;
    return true;
  });

// ══════════════════════════════════════════════════════════════════════════════
// 🧠 CONCALL INTELLIGENCE ENGINE v2 — institutional-grade management signal extractor
// Belongs in CONCALL tab: management intent, order/capex/margin guidance, MRI
// News-feed signals (analyst capitulation, sector tailwind) routed separately
// ══════════════════════════════════════════════════════════════════════════════

type ConcallSignalType =
  // CONCALL SIGNALS — from management statements (earnings calls, investor presentations)
  'ORDER'|'LTA'|'DEMAND_CONSTRAINT'|'CAPEX'|'CAPEX_DELAY'|'MARGIN'|'MARGIN_PRESSURE'|
  'PRICING'|'GUIDANCE_UP'|'GUIDANCE_DOWN'|'CONSERVATIVE_GUIDANCE'|'VISIBILITY_CONFIDENCE'|
  'EXPORT_DEMAND'|'ORDER_EXECUTION_DELAY'|'DEBT_REDUCTION'|'EQUITY_DILUTION'|
  'REGULATORY_RISK'|'CUSTOMER_DELAY'|'WORKING_CAPITAL_STRESS'|'SECTOR_TAILWIND'|
  // NEWS SIGNALS — routed to news feed
  'ANALYST_CAP'|'SUPPLY_CHAIN';

type SignalHorizon = '0-3M'|'3-6M'|'6-12M'|'12M+';
type SignalCategory = 'DEMAND'|'MARGIN'|'CAPEX'|'PRICING'|'GUIDANCE'|'SUPPLY_CHAIN'|'RISK'|'MGMT_STYLE';
type SignalTemporality = 'FORWARD'|'CURRENT'|'HISTORICAL'; // forward = highest value

interface NumericalExtract { value?: number; unit?: string; currency?: string; timing?: string }

type SignalOrigin = 'COMPANY' | 'SECTOR' | 'DERIVED'; // COMPANY = article matched this ticker; SECTOR = cross-stock; DERIVED = inferred

interface ExtractedSignal {
  type: ConcallSignalType; category: SignalCategory;
  text: string;           // extracted sentence — MANDATORY, empty = invalid signal
  positive: boolean;
  strength: 1|2|3|4|5;
  horizon: SignalHorizon;
  isAlpha: boolean;
  temporality: SignalTemporality;
  numerical?: NumericalExtract;
  isForConcall: boolean;
  source: string;
  date: string;
  ageWeight: number;
  // NEW: subject + origin — the two fields that fix "DEMAND_CONSTRAINT everywhere"
  subject: string;        // WHAT: "Insulators", "₹300Cr Order", "Q4 FY26 Capacity"
  origin: SignalOrigin;   // WHO: company-specific vs sector-wide vs derived
  dupCount?: number;      // how many duplicate signals were merged into this one
}

interface CompositeSignal {
  category: SignalCategory;
  label: string;
  direction: 'UP'|'DOWN'|'STABLE';
  strength: number;       // 1-5 composite
  evidence: string[];     // supporting quotes
  count: number;          // articles supporting this
}

interface CompanyConcallSummary {
  symbol: string; company: string; sector: string;
  grade?: string; score?: number; source?: string;
  signals: ExtractedSignal[];
  composite: CompositeSignal[]; // stacked multi-article composite
  signalScore: number;
  mriScore: number;
  expectationShift: number; // 0-100: how much did this change forward expectations
  trend: 'IMPROVING'|'STABLE'|'DETERIORATING'|'UNKNOWN';
  tone: string;
  missedByMarket: boolean; // strong signals + low article coverage
  surprisePotential: 'HIGH'|'MEDIUM'|'LOW';
  freshness: 'FRESH'|'ACTIVE'|'STALE';
  lastDate?: string;
  articleCount: number;
  alphaCount: number;
  noiseCount: number;
  whyItMatters: string; // auto-generated "why this matters" statement
  // Article headlines for display even when no signals extracted
  recentHeadlines: { title: string; source: string; date: string; url?: string }[];
}

// ── Hybrid Pattern Library (Layer 1: keywords, Layer 2: semantic rules) ───────
// CONCALL-specific: things management says in calls, presentations, interviews
const CONCALL_PATTERNS: {
  type: ConcallSignalType; category: SignalCategory;
  keywords: string[];       // Layer 1: direct keyword matches
  semantic: string[];       // Layer 2: indirect/paraphrased signals
  positive: boolean; strength: 1|2|3|4|5; horizon: SignalHorizon; isAlpha: boolean;
}[] = [
  // ── DEMAND & ORDERS (highest alpha for Indian small-caps) ────────────────────
  { type:'DEMAND_CONSTRAINT', category:'DEMAND', isAlpha:true, positive:true, strength:5, horizon:'6-12M',
    keywords:['demand exceed','demand higher than supply','would have done more','capacity constraint','demand outpac','global shortage','insulator shortage','demand exceeds capacity'],
    semantic:['demand remains robust','strong demand environment','demand continues to be','demand visibility strong','demand pickup','demand trend improving','capacity fully utilized','running at full capacity','demand far exceeds'],
  },
  { type:'ORDER', category:'DEMAND', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    keywords:['crore order','crore orders','₹','order book','order inflow','order pipeline','large order','order worth','order of around','order visibility'],
    semantic:['healthy order book','strong order pipeline','order momentum','significant orders','order traction','robust order inflow','order inquiry strong','inquiries at record'],
  },
  { type:'LTA', category:'SUPPLY_CHAIN', isAlpha:true, positive:true, strength:5, horizon:'12M+',
    keywords:['long-term agreement','long term agreement','lta','multi-year contract','multi year contract','committed volume','offtake agreement','supply agreement'],
    semantic:['multi-quarter visibility','assured offtake','tied up volume','secured supply','visibility for next'],
  },
  { type:'EXPORT_DEMAND', category:'DEMAND', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    keywords:['export order','export inquiry','export demand','international order','overseas order','global order'],
    semantic:['international demand growing','export traction','global customers','foreign inquiry'],
  },
  // ── CAPACITY & CAPEX ─────────────────────────────────────────────────────────
  { type:'CAPEX', category:'CAPEX', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['capacity expansion','new capacity','commissioning','capex','new plant','go live','capacity online','additional capacity','capacity addition'],
    semantic:['expansion on track','new line operational','adding capacity','plant coming online','brownfield expansion','greenfield underway','additional line'],
  },
  { type:'CAPEX_DELAY', category:'CAPEX', isAlpha:true, positive:false, strength:3, horizon:'3-6M',
    keywords:['capex delayed','expansion delayed','postponed','pushed back','deferred','phase shift','commissioning delay'],
    semantic:['delay in commissioning','timeline extended','capacity ramp slower','expansion taking longer'],
  },
  { type:'ORDER_EXECUTION_DELAY', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['order execution delay','delivery delay','project delay','execution slowed'],
    semantic:['slower execution','pending deliveries','execution pace slower','backlog taking longer'],
  },
  // ── MARGIN & PRICING ─────────────────────────────────────────────────────────
  { type:'MARGIN', category:'MARGIN', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['no margin pressure','stable margin','margin stable','pass through','pass-through','full pass','pricing power','margin expansion','opm expansion'],
    semantic:['margins expected to improve','comfortable on margins','margin trajectory positive','margin protection intact','we expect improvement in margins','no near-term margin impact'],
  },
  { type:'MARGIN_PRESSURE', category:'MARGIN', isAlpha:true, positive:false, strength:3, horizon:'3-6M',
    keywords:['margin pressure','margin headwind','cost pressure','commodity cost','input cost pressure','margin impact','squeeze'],
    semantic:['margins under pressure','cost inflation impacting','input costs elevated','margin headwinds expected'],
  },
  { type:'PRICING', category:'PRICING', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['price hike','price increase','asp rising','higher realisation','higher realization','improved pricing'],
    semantic:['pricing power intact','able to pass on costs','realizations improving','better pricing environment'],
  },
  // ── GUIDANCE ─────────────────────────────────────────────────────────────────
  { type:'GUIDANCE_UP', category:'GUIDANCE', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    keywords:['guidance raised','raised guidance','above guidance','conservative deliver','deliver above','guidance upgrade','bullish outlook'],
    semantic:['expect to do better','confident of outperforming','comfortable with higher','positive guidance','optimistic about growth','expect acceleration'],
  },
  { type:'GUIDANCE_DOWN', category:'GUIDANCE', isAlpha:true, positive:false, strength:4, horizon:'0-3M',
    keywords:['guidance cut','cut guidance','lowered guidance','below guidance','miss','disappointed','challenging demand','weak demand'],
    semantic:['expect challenging quarter','demand softening','expect lower revenues','moderated our outlook','tempered expectations'],
  },
  // ── MANAGEMENT STYLE SIGNALS (your biggest edge) ──────────────────────────────
  { type:'CONSERVATIVE_GUIDANCE', category:'MGMT_STYLE', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    keywords:['conservative','not providing guidance but','management remains conservative','guiding conservatively','comfortable'],
    semantic:['management conservative','not guiding but expect','comfortable without giving numbers','traditionally conservative','conservative management'],
  },
  { type:'VISIBILITY_CONFIDENCE', category:'MGMT_STYLE', isAlpha:true, positive:true, strength:4, horizon:'6-12M',
    keywords:['visibility strong','order visibility','revenue visibility','confident about growth','confident of achieving'],
    semantic:['strong visibility into next','good revenue visibility','very confident on numbers','clear line of sight','outlook very positive'],
  },
  // ── CAPITAL ALLOCATION ────────────────────────────────────────────────────────
  { type:'DEBT_REDUCTION', category:'SUPPLY_CHAIN', isAlpha:false, positive:true, strength:2, horizon:'6-12M',
    keywords:['debt reduction','debt free','repaid debt','working capital improvement','reduced borrowing'],
    semantic:['becoming debt free','reduced debt levels','balance sheet improving','reduced working capital cycle'],
  },
  { type:'EQUITY_DILUTION', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['qip','equity dilution','rights issue','preferential allotment','fresh equity'],
    semantic:['fund raise planned','equity infusion','additional equity'],
  },
  // ── RISK SIGNALS ─────────────────────────────────────────────────────────────
  { type:'CUSTOMER_DELAY', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['customer delay','customer slowdown','order deferral','project delayed by customer'],
    semantic:['customer capex delayed','customer pushing delivery','slower customer offtake'],
  },
  { type:'REGULATORY_RISK', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'3-6M',
    keywords:['regulatory', 'compliance issue', 'approval delayed', 'license pending', 'regulatory hurdle'],
    semantic: ['awaiting regulatory approval', 'pending clearances', 'regulatory environment uncertain'],
  },
  { type:'WORKING_CAPITAL_STRESS', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['working capital stress','receivables stretched','debtors outstanding','collection pressure'],
    semantic:['stretched receivables','working capital cycle elongated','collections delayed'],
  },
  // ── SUPPLY CHAIN (noise — confirms thesis, low horizon) ───────────────────────
  { type:'SUPPLY_CHAIN', category:'SUPPLY_CHAIN', isAlpha:false, positive:true, strength:2, horizon:'0-3M',
    keywords:['inventory build','higher inventory','managing inventory','commodity management','raw material secured'],
    semantic:['managing commodity exposure','inventory buffer maintained','raw material covered'],
  },
  // ── SECTOR TAILWIND (news feed routing) ──────────────────────────────────────
  { type:'SECTOR_TAILWIND', category:'DEMAND', isAlpha:true, positive:true, strength:4, horizon:'6-12M',
    keywords:['sector tailwind','industry tailwind','structural demand','sector beneficiary'],
    semantic:['sector growing strongly','industry demand accelerating','structural growth story'],
  },
];

// NEWS FEED SIGNALS — these belong in general news feed, not concall
const NEWS_FEED_PATTERNS: { type: ConcallSignalType; category: SignalCategory; keywords: string[]; semantic: string[]; positive: boolean; strength: 1|2|3|4|5; isAlpha: boolean }[] = [
  { type:'ANALYST_CAP', category:'GUIDANCE', isAlpha:true, positive:true, strength:5,
    keywords:['clearly missed','we were wrong','should have','underestimated demand','underestimated growth','raising target after','raising after skepticism','capitulat','raising estimates after'],
    semantic:['analyst upgrades after','raised target on','consensus wrong on','street underestimated'],
  },
];

// ── NEWS HEADLINE PATTERNS — catch news article language (NOT management speech) ──────
// This is a SEPARATE tier from CONCALL_PATTERNS.
// News headlines use different language: "wins order", "bags contract", "revenue up X%"
// These generate signals with LOWER strength (1-3) since they're less specific than mgmt statements.
// They run AFTER compound patterns and CONCALL_PATTERNS, filling the gap for news-covered companies.
const HEADLINE_PATTERNS: {
  type: ConcallSignalType; category: SignalCategory; subject: string;
  keywords: string[];
  positive: boolean; strength: 1|2|3|4|5; horizon: SignalHorizon; isAlpha: boolean;
}[] = [
  // ── ORDERS — news headline style ──────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Order Win', isAlpha:true, positive:true, strength:3, horizon:'0-3M',
    keywords:['wins order','wins contract','bags order','bags contract','secures order','secures contract','receives order','awarded order','awarded contract','order win','contract win','new order worth','new contract worth','loi received','letter of intent','contract signed'] },
  { type:'ORDER', category:'DEMAND', subject:'Defense Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    keywords:['defence order','defense order','army order','navy contract','air force contract','drdo order','drdo contract','hal contract','ministry of defence','mod contract','defence ministry order','sos order','strategic order'] },
  { type:'ORDER', category:'DEMAND', subject:'Government Order', isAlpha:true, positive:true, strength:3, horizon:'0-3M',
    keywords:['government order','government contract','public sector order','psu order','nnpcl order','npcil order','powergrid order','pgcil order','nhpc order','seci order','rrecl order','state order','central order','nh order','nhai contract'] },
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Long-Term Contract', isAlpha:true, positive:true, strength:4, horizon:'12M+',
    keywords:['long-term supply agreement','multi-year order','long term contract','5-year supply','10-year contract','framework agreement','rate contract','annual rate contract','multi year supply'] },

  // ── RESULTS & EARNINGS — headline style ──────────────────────────────────
  { type:'GUIDANCE_UP', category:'GUIDANCE', subject:'Quarterly Results Beat', isAlpha:true, positive:true, strength:2, horizon:'0-3M',
    keywords:['q1 results','q2 results','q3 results','q4 results','quarterly results','revenue up','profit up','pat up','net profit up','revenue rises','profit rises','pat rises','revenue grows','profit grows','record revenue','record profit','highest revenue','highest profit'] },
  { type:'GUIDANCE_DOWN', category:'GUIDANCE', subject:'Results Miss', isAlpha:true, positive:false, strength:2, horizon:'0-3M',
    keywords:['profit down','revenue down','pat down','net profit falls','revenue falls','revenue decline','profit declines','misses estimates','below estimates','disappoints','revenue miss'] },
  { type:'GUIDANCE_UP', category:'GUIDANCE', subject:'Guidance Raise', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['raises guidance','upgrades guidance','guidance raised','upgrades target','target price raised','analyst upgrades','buy rating','strong buy'] },

  // ── CAPACITY & EXPANSION ──────────────────────────────────────────────────
  { type:'CAPEX', category:'CAPEX', subject:'Expansion', isAlpha:true, positive:true, strength:2, horizon:'3-6M',
    keywords:['capacity expansion','new plant','plant expansion','greenfield project','brownfield expansion','new facility','new manufacturing','new production line','doubles capacity','triples capacity','capacity addition','manufacturing expansion'] },
  { type:'CAPEX', category:'CAPEX', subject:'New Facility', isAlpha:true, positive:true, strength:2, horizon:'6-12M',
    keywords:['inaugurates plant','inaugurates factory','new factory','sets up plant','sets up manufacturing','commissions plant','commissions factory','plant commissioned','facility commissioned'] },

  // ── STRATEGIC DEALS ───────────────────────────────────────────────────────
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Partnership/JV', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    keywords:['joint venture','jv agreement','partnership agreement','strategic alliance','mou signed','mou with','ties up with','collaboration agreement','supply agreement signed'] },
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Export Order', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['export order','exports to','supplies to','international order','overseas contract','us order','european order','german customer','us customer','export contract','global customer','foreign order'] },

  // ── DEBT / CAPITAL ────────────────────────────────────────────────────────
  { type:'DEBT_REDUCTION', category:'SUPPLY_CHAIN', subject:'Balance Sheet', isAlpha:false, positive:true, strength:1, horizon:'6-12M',
    keywords:['becomes debt free','debt-free','repays debt','reduces debt','zero debt','debt reduction','repaid loans','loan repaid'] },
  { type:'EQUITY_DILUTION', category:'RISK', subject:'Equity Raise', isAlpha:true, positive:false, strength:2, horizon:'0-3M',
    keywords:['qip opens','qip launch','rights issue','preferential allotment','fundraising','fund raise','fresh equity','dilutes equity','new shares'] },

  // ── NEGATIVE ──────────────────────────────────────────────────────────────
  { type:'REGULATORY_RISK', category:'RISK', subject:'Regulatory Action', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['sebi notice','sebi order','regulatory action','show cause notice','penalty imposed','fine imposed','regulatory penalty','suspended','blacklisted','debarred','nclat order','nclt order','insolvency'] },
  { type:'CUSTOMER_DELAY', category:'RISK', subject:'Order Slowdown', isAlpha:true, positive:false, strength:2, horizon:'0-3M',
    keywords:['order slowdown','order deferral','project delayed','execution delay','order cancellation','cancelled order','deal falls through','contract terminated'] },
];

// ── Forward/Backward Tagger ───────────────────────────────────────────────────
function tagTemporality(sentence: string): SignalTemporality {
  const s = sentence.toLowerCase();
  const forwardWords = ['expect','anticipate','plan to','going forward','next quarter','upcoming','will see','should see','likely to','over the next','in the coming','target','guidance','outlook','forecast','aspire','project to','aim to'];
  const historicalWords = ['last quarter','last year','previously','was','had been','in q1','in q2','in q3','in q4','fy23','fy24','reported','achieved'];
  if (forwardWords.some(w => s.includes(w))) return 'FORWARD';
  if (historicalWords.some(w => s.includes(w))) return 'HISTORICAL';
  return 'CURRENT';
}

// ── Numerical Extractor ───────────────────────────────────────────────────────
function extractNumerical(text: string): NumericalExtract | undefined {
  // Match ₹XXX crore/lakh, or X Cr/Lakh patterns
  const m1 = text.match(/₹\s*([\d,]+(?:\.\d+)?)\s*(cr|crore|lakh|lac|mn|bn|billion)/i);
  const m2 = text.match(/([\d,]+(?:\.\d+)?)\s*(crore|cr|lakh|lac)\s+(order|contract|revenue|sales)/i);
  const timingWords = ['next few weeks','next quarter','q1','q2','q3','q4','fy','this year','by march','by june','by september','by december','h1','h2'];
  const timing = timingWords.find(t => text.toLowerCase().includes(t));
  const match = m1 || m2;
  if (!match) return undefined;
  const raw = match[1].replace(/,/g,'');
  const unit = (match[2]||'').toLowerCase();
  const value = parseFloat(raw) * (unit.startsWith('lakh') || unit.startsWith('lac') ? 0.01 : unit.startsWith('bn') || unit.startsWith('billion') ? 100 : 1);
  return { value: Math.round(value * 10) / 10, unit: 'Cr', currency: 'INR', timing };
}

// ── Signal Age Decay ─────────────────────────────────────────────────────────
function getAgeWeight(dateStr: string): number {
  if (!dateStr) return 0.5;
  const ageDays = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  if (ageDays <= 3)  return 1.0;
  if (ageDays <= 10) return 0.8;
  if (ageDays <= 20) return 0.6;
  return 0.4;
}

// ── Generic words that must NEVER be used as single-word aliases ──────────────
// These appear in too many unrelated article headlines and cause false positives.
const ALIAS_BLOCKLIST = new Set([
  'global','digital','data','power','energy','india','national','new','smart','advance',
  'next','tech','net','pro','max','plus','prime','core','one','first','alpha','beta',
  'clean','pure','green','blue','nova','apex','ace','star','sky','sun','wind','rapid',
  'swift','agile','flex','zen','peak','mega','micro','nano','pico','meta','omni','uni',
  'multi','poly','trans','eco','bio','geo','neo','ultra','hyper','super','elite','premium',
  'select','excel','royal','shield','forte','vista','clarity','horizon','nexus','vertex',
]);

// ── Manual alias overrides for tickers where auto-generation fails ───────────
// Key = UPPERCASE NSE symbol; value = additional aliases to add
const MANUAL_ALIASES: Record<string, string[]> = {
  // ── Power T&D ──────────────────────────────────────────────────────────────
  'GVT&D':      ['ge vernova t&d india', 'ge vernova t&d', 'ge vernova', 'ge t&d india', 'vernova india'],
  'GVTD':       ['ge vernova t&d india', 'ge vernova t&d', 'ge vernova', 'ge t&d india', 'vernova india'],
  'QPOWER':     ['quality power electrical', 'quality power el', 'quality power engineering'],
  'ATLANTAELE': ['atlanta electric', 'atlanta electrics limited'],
  'WEBELSOLAR': ['websol energy', 'websol solar', 'webel solar system'],
  'SKIPPER':    ['skipper limited', 'skipper towers', 'skipper conductor', 'skipper transmission'],
  'AZAD':       ['azad engineering limited', 'azad aerospace'],
  'VENUSPIPES': ['venus pipes and tubes', 'venus pipes', 'venus wire'],
  'INA':        ['insolation energy', 'insolation ener', 'insolation solar'],
  'VERTIS':     ['vertis infrastructure limited', 'vertis infra'],
  // ── Defense & Aerospace ────────────────────────────────────────────────────
  // CRITICAL: "data patterns" is a generic tech phrase — use FULL legal name only
  'DATAPATTNS': ['data patterns limited', 'data patterns (india)', 'data patterns india limited'],
  // ── Consumer / FMCG ────────────────────────────────────────────────────────
  // FIXED: Removed "bajaj consumer" (too generic — matches Bajaj Auto articles)
  // Only use more specific aliases that uniquely identify Bajaj Consumer Care
  'BAJAJCON':   ['bajaj consumer care', 'bajaj almond drops', 'bajaj nomarks', 'bajaj consumer care limited'],
  'BAJAJFINSERV':['bajaj finserv', 'bajaj financial services'],
  // ── Financials ─────────────────────────────────────────────────────────────
  // FIXED: MCX is a commodity exchange — articles about "order" or "supply" are commodity orders, not equipment
  'MCX':        ['multi commodity exchange', 'mcx india limited'],
  'IIFL':       ['iifl finance limited', 'iifl wealth', 'iifl securities limited', 'iifl samasta'],
  // ── Other ──────────────────────────────────────────────────────────────────
  'TRAVELFOOD': ['travel food services', 'travel food limited'],
  'PARKHOSPS':  ['park mediclinics', 'park hospitals limited', 'park medi world'],
  'ATHERENERG': ['ather energy limited'],
  'CLEANMAX':   ['clean max enviro', 'cleanmax enviro energy'],
  'UTLSOLAR':   ['fujiyama power systems', 'utl solar', 'utl renewable energy'],
  'GLOBAL':     ['global education limited', 'global indian international school'],
};

// ── Company Alias Generator v2 — smarter matching for Indian small-caps ──────
function buildAliases(symbol: string, companyName: string): string[] {
  const sym = symbol.toUpperCase().replace(/\.NS$|\.BO$/i, '');
  const aliases: string[] = [];
  const name = companyName.toLowerCase().trim();

  // 1. Always add the full company name (most specific, least ambiguous)
  if (name.length >= 4) aliases.push(name);

  // 2. Manual overrides first — highest precision
  const manualExtra = MANUAL_ALIASES[sym] ?? [];
  for (const m of manualExtra) aliases.push(m.toLowerCase());

  // 3. Strip common business suffixes but keep meaningful parts
  const cleaned = name
    .replace(/\b(ltd|limited|pvt|private|industries|solutions|technologies|technology|systems|services|engineering|enterprises|corporation|corp|inc|company)\b/g, '')
    .replace(/[&+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 4. Use cleaned name only if it's meaningfully different and long enough
  if (cleaned.length >= 8 && cleaned !== name) aliases.push(cleaned);

  // 5. Two-word combos from cleaned name (require both words >= 4 chars)
  const words = cleaned.split(/\s+/).filter(w => w.length >= 4);
  if (words.length >= 2) {
    const twoWord = words.slice(0, 2).join(' ');
    if (twoWord.length >= 8) aliases.push(twoWord);
  }

  // 6. Single-word from first word ONLY if it's:
  //    - long enough (>= 7 chars to avoid generic words)
  //    - NOT in the blocklist
  //    - NOT a common word that appears everywhere
  if (words.length >= 1) {
    const firstWord = words[0];
    if (firstWord.length >= 7 && !ALIAS_BLOCKLIST.has(firstWord)) {
      aliases.push(firstWord);
    }
  }

  // 7. NSE symbol itself (only if >= 4 chars — minimum to be meaningful)
  const symLower = sym.toLowerCase();
  if (symLower.length >= 4) aliases.push(symLower);

  return [...new Set(aliases.filter(a => a.length >= 4))];
}

// ── Cross-Stock Sector Signal Library ────────────────────────────────────────
// When an article mentions a sector-wide shortage, auto-apply to relevant tracked stocks
// ── Rich Sector Signal Library — subject + driver + relevance scoring ─────────
// Each sector signal specifies: WHAT (subject), WHY (driver), WHO benefits (products+sectors)
// relevanceThreshold: company must score >= this to receive the signal
interface SectorSignalDef {
  id: string; label: string;
  signalType: 'DEMAND_SURGE'|'SUPPLY_CONSTRAINT'|'INFRASTRUCTURE_BOTTLENECK'|'CAPACITY_SHORTAGE'|'INPUT_SHORTAGE';
  subject: string;    // WHAT: "Insulator Supply", "Grid Infrastructure"
  driver: string;     // WHY: "T&D capex cycle", "Data center demand"
  impact: string;     // WHAT IT MEANS for beneficiaries
  keywords: string[]; // at least one must appear in article
  // Multi-condition: both product AND state keyword must co-occur in same sentence
  compoundRequired?: { product: string[]; state: string[] };
  beneficiaryProducts: string[]; // company names/sectors matching these get relevance bonus
  targetSectors: string[];       // high-relevance sectors (score 0.85)
  excludeSectors: string[];      // zero relevance — don't propagate
  relevanceThreshold: number;    // 0.0-1.0: min relevance to inject signal
}
const SECTOR_SIGNALS: SectorSignalDef[] = [
  { id:'INSULATOR_SHORTAGE', label:'Insulator Shortage',
    signalType:'SUPPLY_CONSTRAINT', subject:'Insulator Supply', driver:'T&D and grid expansion cycle',
    impact:'Higher order inflow for insulator manufacturers operating at full capacity',
    keywords:['insulator shortage','insulator demand','global insulator','disc insulator','string insulator','insulator supply constrained','insulator backlog'],
    compoundRequired:{ product:['insulator','disc insulator','composite insulator'], state:['shortage','demand strong','constraint','full capacity','order book','backlog','high demand'] },
    beneficiaryProducts:['insulator','electrical equipment','T&D','transmission equipment'],
    targetSectors:['electrical','insulator','power transmission','T&D equipment'],
    excludeSectors:['IT','software','pharma','bank','finance','FMCG','consumer','textile','media'],
    relevanceThreshold: 0.6 },

  { id:'TRANSFORMER_SHORTAGE', label:'Transformer Shortage',
    signalType:'CAPACITY_SHORTAGE', subject:'Transformer Supply', driver:'Grid modernisation and data center power buildout',
    impact:'Lead times expanding, order books building for transformer OEMs',
    keywords:['transformer shortage','transformer demand','power transformer','grid transformer','transformer backlog','transformer lead time','transformer supply'],
    compoundRequired:{ product:['transformer','power transformer','distribution transformer'], state:['shortage','backlog','lead time','demand','constraint','delay','strong order'] },
    beneficiaryProducts:['transformer','electrical equipment','switchgear','power equipment'],
    targetSectors:['electrical','transformer','power','T&D','switchgear'],
    excludeSectors:['IT','pharma','bank','FMCG','consumer','software'],
    relevanceThreshold: 0.6 },

  { id:'CABLE_DEMAND', label:'Cable/Conductor Demand',
    signalType:'DEMAND_SURGE', subject:'Cable/Conductor Demand', driver:'Power infra capex and renewable connectivity',
    impact:'Volume growth and order visibility for cable & conductor manufacturers',
    keywords:['cable demand','conductor demand','wire demand','cable order','cable backlog','conductor order'],
    compoundRequired:{ product:['cable','conductor','wire','acsr','opgw'], state:['demand','order','growth','backlog','strong','surge','shortage'] },
    beneficiaryProducts:['cable','conductor','wire','electrical cables'],
    targetSectors:['cable','conductor','wire','electrical','power','telecom'],
    excludeSectors:['IT','pharma','bank','FMCG','consumer'],
    relevanceThreshold: 0.6 },

  { id:'DEFENCE_INDIGENISATION', label:'Defence Push',
    signalType:'DEMAND_SURGE', subject:'Defence Indigenisation', driver:'Atmanirbhar Bharat + DPP policy push',
    impact:'Domestic order visibility improving for defence electronics and equipment',
    keywords:['make in india defence','defence indigenisation','atmanirbhar defence','defence offset','defence import substitution','idex','drdo'],
    beneficiaryProducts:['defence','defense','military','electronics','aerospace','ordnance'],
    targetSectors:['defence','defense','aerospace','electronics','engineering','military'],
    excludeSectors:['pharma','bank','FMCG','consumer','textile'],
    relevanceThreshold: 0.65 },

  { id:'SOLAR_BOOM', label:'Solar Demand',
    signalType:'DEMAND_SURGE', subject:'Solar Equipment Demand', driver:'500GW renewable target + PLI schemes',
    impact:'Order visibility building for solar EPC, module, and balance-of-system suppliers',
    keywords:['solar capacity','renewable target','solar tender','solar auction','solar order','green energy target'],
    beneficiaryProducts:['solar','module','inverter','EPC','renewable','wind','energy'],
    targetSectors:['solar','renewable','energy','EPC','electrical'],
    excludeSectors:['IT','bank','pharma','FMCG'],
    relevanceThreshold: 0.55 },

  { id:'GRID_INFRA_BOTTLENECK', label:'Grid Infra Bottleneck',
    signalType:'INFRASTRUCTURE_BOTTLENECK', subject:'Grid Infrastructure', driver:'AI data center + EV + renewable power demand',
    impact:'Long order visibility and pricing power for T&D equipment, substations, EPC players',
    keywords:['grid infrastructure','grid constraint','power grid','grid modernisation','transmission bottleneck','grid expansion','substation'],
    compoundRequired:{ product:['grid','substation','transmission','distribution','T&D','switchgear'], state:['constraint','bottleneck','shortage','demand','expansion','upgrade','investment'] },
    beneficiaryProducts:['grid equipment','T&D','substation','switchgear','transformer','cable','EPC'],
    targetSectors:['electrical','power','T&D','transmission','EPC','grid','infrastructure'],
    excludeSectors:['IT','pharma','bank','FMCG','consumer'],
    relevanceThreshold: 0.65 },

  // ── RAILWAY SECTOR ──────────────────────────────────────────────────────────
  { id:'RAILWAY_CAPEX_SURGE', label:'Railway Capex Surge',
    signalType:'DEMAND_SURGE', subject:'Railway Rolling Stock Demand', driver:'₹2.5L Cr railway budget + 100-year infra ambition',
    impact:'Multi-year order pipeline for wagon, coach, and rail component makers',
    keywords:['indian railways','railway budget','vande bharat','kavach','freight corridor','metro project','rvnl','rail vikas','konkan railway'],
    beneficiaryProducts:['wagon','coach','locomotive','rail component','bogie','wheel','axle','coupling','track material'],
    targetSectors:['railway','rolling stock','rail components','transportation','defence','engineering'],
    excludeSectors:['pharma','bank','FMCG','consumer','textile','IT'],
    relevanceThreshold: 0.60 },

  // ── DEFENSE MACRO ────────────────────────────────────────────────────────────
  { id:'DEFENCE_BUDGET_ALLOCATION', label:'Defence Budget Growth',
    signalType:'DEMAND_SURGE', subject:'Defence Capital Budget', driver:'Geopolitical tensions + modernisation drive',
    impact:'Allocation for procurement rising — orders to HAL, BDL, BEL, and private defence OEMs',
    keywords:['defence budget','defense budget','capital allocation defence','defence procurement','dai','mod allocation','defence ministry','def capex'],
    compoundRequired:{ product:['defence','defense','military','naval','army','air force'], state:['budget','allocation','increase','higher','capex','procurement','modernisation','crore'] },
    beneficiaryProducts:['defence electronics','aerospace','ordnance','shipbuilding','vehicle','armament'],
    targetSectors:['defence','defense','aerospace','military electronics','engineering','naval'],
    excludeSectors:['pharma','FMCG','consumer','real estate','bank','textile'],
    relevanceThreshold: 0.60 },

  // ── PHARMA API DEMAND ────────────────────────────────────────────────────────
  { id:'CHINA_PLUS_ONE_PHARMA', label:'China+1 Pharma Shift',
    signalType:'DEMAND_SURGE', subject:'API/CDMO China+1 Migration', driver:'US-China tensions + PLI for pharma',
    impact:'New customer inquiries and supply agreements for Indian API and CDMO players',
    keywords:['china plus one pharma','api import substitution','cdmo india','api supply chain','china api shortage','usfda inspection','qualifies api'],
    beneficiaryProducts:['api','active pharmaceutical','fermentation','cdmo','crams','bulk drug'],
    targetSectors:['pharma','api','cdmo','specialty chemical'],
    excludeSectors:['IT','bank','FMCG','consumer','real estate'],
    relevanceThreshold: 0.65 },

  // ── AGROCHEMICAL DESTOCKING ──────────────────────────────────────────────────
  { id:'AGROCHEM_RESTOCKING', label:'Agrochem Restocking Cycle',
    signalType:'DEMAND_SURGE', subject:'Agrochem Channel Restocking', driver:'Post-destocking normalisation',
    impact:'Volume recovery for agrochemical formulators and technicals suppliers',
    keywords:['agrochem restocking','channel inventory normalised','agrochemical demand recovery','crop protection demand','formulation demand'],
    compoundRequired:{ product:['agrochemical','pesticide','herbicide','fungicide','formulation','crop protection'], state:['restocking','recovery','normalise','improving','demand picking','uptick','channel clear'] },
    beneficiaryProducts:['agrochemical','pesticide','crop protection','technical','formulation'],
    targetSectors:['agrochemical','specialty chemical','crop protection'],
    excludeSectors:['IT','bank','real estate','railway','defence'],
    relevanceThreshold: 0.70 },

  // ── REAL ESTATE DEMAND ───────────────────────────────────────────────────────
  { id:'HOUSING_DEMAND_SURGE', label:'Housing Demand Strong',
    signalType:'DEMAND_SURGE', subject:'Residential Housing Demand', driver:'Mortgage rates stable + urbanisation',
    impact:'Pre-sales volume and price realisation improving for residential developers',
    keywords:['housing demand','residential demand','pre-sales growth','home sales','new launches sold','real estate demand','property prices'],
    compoundRequired:{ product:['residential','housing','apartment','villa','plotted','township'], state:['demand','presales','sold out','record','growth','increase','strong','bookings'] },
    beneficiaryProducts:['real estate','developer','construction','housing finance'],
    targetSectors:['real estate','housing','construction','infrastructure'],
    excludeSectors:['IT','pharma','FMCG','bank','defence'],
    relevanceThreshold: 0.65 },
];

// Sectors that are ALWAYS irrelevant for industrial/equipment/supply signals.
// Financial companies trade instruments and provide services — NOT manufacturing beneficiaries.
const ALWAYS_EXCLUDED_FROM_INDUSTRIAL_SIGNALS = new Set([
  'capital markets','financial services','banking','bank','nbfc','insurance','asset management',
  'diversified financials','consumer finance','multi-sector','holding company','investment',
  'commodity exchange','stock exchange','futures exchange','derivatives exchange',
  'financial','financial technology','fintech','payments','brokerage',
  'media','entertainment','retail','restaurants','hotels','airlines','logistics services',
  'education','telecom','it services','software','health services','hospital',
]);

// Company-level financial check (catches companies where sector tag is generic but company is financial)
function isFinancialCompany(sector: string, company: string): boolean {
  const sl = sector.toLowerCase();
  const cl = company.toLowerCase();
  // Explicit sector matches
  if (ALWAYS_EXCLUDED_FROM_INDUSTRIAL_SIGNALS.has(sl)) return true;
  // Regex pattern — catches "capital markets", "financial services", "exchange" etc.
  return /\b(bank|finance|capital market|exchange|commodity exchange|broker|insurance|invest|asset manag|fund|nbfc|fintech|payment|trading platform)\b/i.test(sl + ' ' + cl);
}

// Compute how relevant a sector signal is for a specific company (0.0 – 1.0)
// Rule: relevance < threshold → signal NOT propagated to this company
function computeSectorRelevance(company: {sector:string;company:string}, sig: SectorSignalDef): number {
  const sl = (company.sector||'').toLowerCase();
  const cl = (company.company||'').toLowerCase();

  // Hard block: financial/exchange/service sector companies — NEVER get industrial signals
  // FIXED: Removed the '!== DEMAND_SURGE' exception that was letting pharma signals through to IIFL
  if (isFinancialCompany(sl, cl)) return 0;

  if (sig.excludeSectors.some(e => sl.includes(e.toLowerCase()) || cl.includes(e.toLowerCase()))) return 0;
  if (sig.targetSectors.some(t => sl.includes(t.toLowerCase()) || cl.includes(t.toLowerCase()))) return 0.85;
  if (sig.beneficiaryProducts.some(b => sl.includes(b.toLowerCase()) || cl.includes(b.toLowerCase()))) return 0.7;
  return 0.2; // default very low — most stocks don't benefit from any given sector signal
}

// Check if compound requirement is met: both product AND state keyword in same sentence
function meetsCompoundRequirement(sentence: string, compound?: {product: string[]; state: string[]}): boolean {
  if (!compound) return true;
  const s = sentence.toLowerCase();
  const hasProduct = compound.product.some(p => s.includes(p));
  const hasState   = compound.state.some(st => s.includes(st));
  return hasProduct && hasState;
}

// ── Subject Extractor — "WHAT" field that prevents generic DEMAND_CONSTRAINT everywhere ──
// Maps raw article text + signal type → a specific subject ("Insulators", "₹300Cr", "Q4 FY26")
function extractSubject(type: ConcallSignalType, text: string): string {
  const t = text.toLowerCase();
  // Product/material subjects — detect WHAT is constrained
  if (t.includes('insulator')) return 'Insulators';
  if (t.includes('transformer')) return 'Transformers';
  if (t.includes('cable') || t.includes('conductor')) return 'Cables/Conductors';
  if (t.includes('solar') || t.includes('module') || t.includes('panel')) return 'Solar';
  if (t.includes('semiconductor') || t.includes('chip')) return 'Semiconductors';
  if (t.includes('defence') || t.includes('defense') || t.includes('military')) return 'Defence';
  if (t.includes('railway') || t.includes('rail')) return 'Railways';
  if (t.includes('water') || t.includes('sewage') || t.includes('municipal')) return 'Water Infra';
  if (t.includes('real estate') || t.includes('housing') || t.includes('construction')) return 'Real Estate';
  if (t.includes('pharma') || t.includes('drug') || t.includes('api')) return 'Pharma';
  if (t.includes('export') || t.includes('overseas') || t.includes('international')) return 'Export';
  // Order subject: use numerical extract or generic
  if (type === 'ORDER' || type === 'LTA') {
    const m = text.match(/₹\s*[\d,.]+\s*(cr|crore|lakh)/i);
    if (m) return m[0].trim();
    return 'Order Pipeline';
  }
  // Capex subject: extract timing
  if (type === 'CAPEX') {
    const m = text.match(/[Qq][1-4]\s*[Ff][Yy]\s*\d{2,4}/i) || text.match(/[Ff][Yy]\s*\d{2,4}/i);
    if (m) return `Capacity (${m[0].toUpperCase()})`;
    return 'Capacity Expansion';
  }
  if (type === 'CAPEX_DELAY') return 'Expansion Delay';
  if (type === 'MARGIN' || type === 'MARGIN_PRESSURE') return 'Operating Margin';
  if (type === 'PRICING') return 'Pricing Power';
  if (type === 'GUIDANCE_UP') return 'Management Outlook';
  if (type === 'GUIDANCE_DOWN') return 'Guidance Risk';
  if (type === 'CONSERVATIVE_GUIDANCE') return 'Conservative Management';
  if (type === 'VISIBILITY_CONFIDENCE') return 'Order Visibility';
  if (type === 'EXPORT_DEMAND') return 'Export Orders';
  if (type === 'DEBT_REDUCTION') return 'Balance Sheet';
  if (type === 'DEMAND_CONSTRAINT') return 'Supply Constraint';
  return type.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Signal Deduplicator — merges same-type signals, increments strength ──────
// Fixes: DEMAND_CONSTRAINT × 3 → DEMAND_CONSTRAINT (Strength 4, merged)
function deduplicateSignals(signals: ExtractedSignal[]): ExtractedSignal[] {
  // Key = type + origin (company-specific ORDER stays separate from sector ORDER)
  const grouped = new Map<string, ExtractedSignal[]>();
  for (const s of signals) {
    const key = `${s.type}:${s.origin}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }
  const deduped: ExtractedSignal[] = [];
  for (const group of grouped.values()) {
    // Pick the best (highest strength × ageWeight, with evidence text)
    const withText = group.filter(s => s.text && s.text.length > 10);
    const best = (withText.length > 0 ? withText : group).sort((a,b) => (b.strength * b.ageWeight) - (a.strength * a.ageWeight))[0];
    // Merge subjects from all duplicates
    const subjects = [...new Set(group.map(s => s.subject).filter(Boolean))].slice(0, 3);
    const mergedStrength = Math.min(5, best.strength + Math.floor((group.length - 1) / 2)) as 1|2|3|4|5;
    deduped.push({ ...best, subject: subjects.join(' + ') || best.subject, strength: mergedStrength, dupCount: group.length });
  }
  return deduped.sort((a,b) => (b.strength * b.ageWeight) - (a.strength * a.ageWeight));
}

// ── Hybrid Signal Extractor (Layer 1 + Layer 2) ───────────────────────────────
// ── Product-specific compound patterns for extractSignals ──────────────────────
// These fire ONLY when BOTH product keyword AND state keyword co-occur in same sentence.
// This prevents "demand" → DEMAND_CONSTRAINT for every stock. Must be specific.
// Coverage: Power T&D, Defense, Railways, Pharma/API, Chemicals, IT/ITES, Cement,
//           Real Estate, Textiles, Auto Components, Capital Goods, Metals.
const COMPOUND_EXTRACT_PATTERNS: {
  type: ConcallSignalType; category: SignalCategory; subject: string;
  products: string[]; states: string[];
  positive: boolean; strength: 1|2|3|4|5; horizon: SignalHorizon; isAlpha: boolean;
}[] = [
  // ── POWER T&D ─────────────────────────────────────────────────────────────────
  { type:'DEMAND_CONSTRAINT', category:'DEMAND', subject:'Insulators', isAlpha:true, positive:true, strength:5, horizon:'6-12M',
    products:['insulator','disc insulator','composite insulator','glass insulator','porcelain insulator'],
    states:['shortage','demand strong','high demand','robust demand','capacity constraint','order full','supply constrained','operating at full','full capacity','exceed','more orders than'] },
  { type:'DEMAND_CONSTRAINT', category:'DEMAND', subject:'Transformers', isAlpha:true, positive:true, strength:5, horizon:'6-12M',
    products:['transformer','power transformer','distribution transformer','hvdc transformer'],
    states:['backlog','lead time','shortage','demand surge','constrained','order book','strong demand','cannot meet','full order'] },
  { type:'ORDER', category:'DEMAND', subject:'Cables/Conductors', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['cable','conductor','acsr','opgw','underground cable','aerial bundled'],
    states:['order','demand','inflow','pipeline','growing','strong','visibility','secured'] },
  { type:'ORDER', category:'DEMAND', subject:'T&D Equipment', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['switchgear','breaker','reactor','capacitor bank','substation','bus bar'],
    states:['order','demand','backlog','inflow','strong','secured','tendered'] },
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Power Sector LTA', isAlpha:true, positive:true, strength:5, horizon:'12M+',
    products:['power supply','grid supply','pgcil','seci','rrecl','powergrid','state discom','discom order'],
    states:['long-term','multi-year','framework agreement','rate contract','secured','five year','annual rate','empanelled'] },

  // ── DEFENSE & AEROSPACE ───────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Defense Order', isAlpha:true, positive:true, strength:5, horizon:'3-6M',
    products:['missile','radar','helicopter','aircraft','warship','aero engine','armament','ammunition','defence','defense','military','naval','army','air force','drdo','hal','tejas','akash','brahmos'],
    states:['order','contract','supply','secured','nominated','loi','award','qualify','trial','evaluation','indigenous','offset','make in india','ae order','production order'] },
  { type:'CAPEX', category:'CAPEX', subject:'Defense Capacity', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['ordnance','ammunition','explosive','propellant','defence production','defense manufacturing'],
    states:['capacity','expansion','greenfield','new line','commissioning','fy','production facility','scale up'] },
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Defense LTA', isAlpha:true, positive:true, strength:5, horizon:'12M+',
    products:['defence','defense','ministry of defence','mod','army','navy','air force','coast guard'],
    states:['long-term order','multi-year contract','repeat order','framework','annual order','5-year','10-year','sos order'] },
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Defense Exports', isAlpha:true, positive:true, strength:4, horizon:'6-12M',
    products:['defence export','defense export','arms export','mil export','drdo export','hal export'],
    states:['export order','foreign military','us sale','fms','nato','friendly nation','export clearance','export approval','₹','crore'] },

  // ── RAILWAYS ─────────────────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Railway Order', isAlpha:true, positive:true, strength:5, horizon:'3-6M',
    products:['wagon','coach','locomotive','bogey','railway','vande bharat','kavach','metro','emu','demu','rail coach','freight wagon','passenger coach'],
    states:['order','tender','award','secured','won','nominated','irctc','rvnl','indian railways','ministry of railways'] },
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Railway LTA', isAlpha:true, positive:true, strength:5, horizon:'12M+',
    products:['wagon','coach','locomotive','bogie','wheel','axle','coupler','rail fastener'],
    states:['rate contract','annual','long term','framework','repeat','assured order','standing order'] },
  { type:'CAPEX', category:'CAPEX', subject:'Rail Manufacturing Capex', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['wagon','coach factory','locomotive','foundry','forging','casting'],
    states:['new plant','expansion','greenfield','doubling','capacity addition','new facility','commission'] },
  { type:'DEMAND_CONSTRAINT', category:'DEMAND', subject:'Railway Wagon Shortage', isAlpha:true, positive:true, strength:4, horizon:'6-12M',
    products:['wagon','freight wagon','coal wagon'],
    states:['shortage','demand strong','delivery','order backlog','waiting period','queue','lead time','more orders'] },

  // ── PHARMA / API / CDMO ───────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Pharma API Order', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['api','active pharmaceutical','bulk drug','fermentation','synthesis','crams','cdmo','contract manufacturing'],
    states:['order','inquiry','rfq','award','new customer','new molecule','signed','contract','long-term supply','partnership'] },
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Pharma Export', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['fdf','finished dosage','formulation','generic','abbreviated','anda','dossier','us fda','usfda','eu gmp','tga','health canada'],
    states:['approval','clearance','filing','launch','export','eu','us','uk','latam','row market','inspection completed','no observations'] },
  { type:'MARGIN', category:'MARGIN', subject:'Pharma Gross Margin', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['api price','raw material','solvent','bulk drug price','specialty api'],
    states:['stable','no pressure','margin intact','price stable','pass through','no headwind','commodity stable'] },
  { type:'CAPEX', category:'CAPEX', subject:'Pharma Capacity', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['reactor','kg block','api plant','fermentation','synthesis block','formulation line','oral solid'],
    states:['commissioning','validation','who gmp','usfda','eu gmp','ready','operational','online','new block'] },

  // ── SPECIALTY CHEMICALS ────────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Agrochemical Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['agrochemical','pesticide','herbicide','fungicide','insecticide','crop protection'],
    states:['new molecule','molecule transfer','csr','import substitution','china plus one','registration','order','inquiry','customer qualified'] },
  { type:'ORDER', category:'DEMAND', subject:'Specialty Chemical Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['specialty chemical','fine chemical','fluorine','chloro','bromine','performance material','polymer','dye intermediate','pigment'],
    states:['order','new customer','import substitution','china+1','rfq','contract','qualification','approved','supply agreement'] },
  { type:'MARGIN_PRESSURE', category:'MARGIN', subject:'Chemical Margin Pressure', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    products:['inventory destocking','channel inventory','agrochemical inventory','chinese inventory','dumping'],
    states:['high','excess','elevated','correction','pricing pressure','lower realisation','headwind'] },
  { type:'CAPEX', category:'CAPEX', subject:'Chemical Plant', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['chemical plant','multipurpose plant','mpp','reactor','distillation','recovery unit','effluent treatment'],
    states:['commissioning','operational','going live','fy','new block','expansion','on track','greenfield'] },

  // ── IT / ITES / SOFTWARE ─────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'IT Deal Win', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['deal','tvc','tcv','contract value','it services','digital transformation','cloud migration','erp implementation','ai services','data analytics'],
    states:['win','won','awarded','signed','new logo','large deal','mega deal','multiyear','tvc','tcv','crore','mn dollar','total contract'] },
  { type:'GUIDANCE_UP', category:'GUIDANCE', subject:'IT Revenue Guidance', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['revenue guidance','growth guidance','pipeline','deal pipeline','demand environment'],
    states:['raised','upgraded','higher than','comfortable','positive','sequential growth','fy guidance raised','improving demand'] },
  { type:'MARGIN', category:'MARGIN', subject:'IT Margin', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['ebit margin','operating margin','attrition','headcount','utilization','subcontracting'],
    states:['improving','stable','expansion','lower attrition','better utilization','subcon down','no wage hike headwind'] },

  // ── CEMENT ────────────────────────────────────────────────────────────────────
  { type:'PRICING', category:'PRICING', subject:'Cement Realisation', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['cement price','bag price','realisation','trade segment','ex-works','dealer price'],
    states:['increase','hike','stable','improve','higher','better pricing','per bag','quarter on quarter'] },
  { type:'CAPEX', category:'CAPEX', subject:'Cement Capacity', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['clinker','cement plant','grinding unit','kiln','blending','capacity addition','mtpa'],
    states:['commissioning','operational','new line','on track','fy','expansion','greenfield','brown field'] },
  { type:'MARGIN', category:'MARGIN', subject:'Cement Operating Margin', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['pet coke','coal','power fuel','freight','logistics','opex per tonne'],
    states:['lower','reducing','declining','benefit','stable','passed through','no pressure','below peak'] },

  // ── REAL ESTATE / CONSTRUCTION ────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Pre-sales / Bookings', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['pre-sales','booking','registration','sold','new launch','inventory sold','units sold','residential'],
    states:['strong','robust','higher','record','crore','growing','strong demand','oversubscribed','fully sold','sellout'] },
  { type:'GUIDANCE_UP', category:'GUIDANCE', subject:'Pre-sales Guidance', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['pre-sales guidance','new launch','pipeline launches','launch pipeline','expected collections','cash flow guidance'],
    states:['raise','upgrade','positive','better','comfortable','higher than','growth expected','on track'] },
  { type:'ORDER', category:'DEMAND', subject:'EPC/Infra Order', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['epc','highway','road','bridge','dam','irrigation','water supply','tunnel','metro','airport','port'],
    states:['order','award','loa','loi','secured','won','bid','nominated','nh','nhai','nhmb','state government','central government','nmcg'] },

  // ── AUTO COMPONENTS ──────────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Auto Component Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['oem','tier 1','automobile','passenger vehicle','commercial vehicle','two wheeler','ev','electric vehicle','battery','motor'],
    states:['order','new program','nomination','sop','start of production','new model','platform win','supply agreement'] },
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Auto Export Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['auto component','forging','casting','stamping','machined','pump','bearing','filtration'],
    states:['export','global oem','tier 1 global','us customer','european','new customer','supply agreement','rfq won'] },

  // ── METALS / STEEL / ALUMINIUM ────────────────────────────────────────────────
  { type:'PRICING', category:'PRICING', subject:'Metal Realization', isAlpha:true, positive:true, strength:3, horizon:'0-3M',
    products:['hrc','crc','flat product','long product','rebar','wire rod','aluminium','copper','zinc'],
    states:['realisation','price','asp','better','increase','improved','higher','stable'] },
  { type:'ORDER', category:'DEMAND', subject:'Metal Order Pipeline', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['special steel','alloy steel','stainless','aerospace grade','defense grade','armour plate','automotive grade'],
    states:['order','supply agreement','qualified','approved','qualification complete','new application','certified','ramp'] },

  // ── TEXTILES / APPAREL ────────────────────────────────────────────────────────
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Textile Export Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['yarn','fabric','garment','apparel','home textile','technical textile','fibre','polyester','cotton yarn'],
    states:['export','new customer','us order','eu order','bangladesh','vietnam','china plus','order book','inquiry','strong demand'] },

  // ── GENERIC CAPACITY / MARGIN (unchanged) ────────────────────────────────────
  { type:'CAPEX', category:'CAPEX', subject:'Capacity Expansion', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['plant','line','furnace','kiln','capacity','unit'],
    states:['commissioning','go live','operational','expansion','fy','q1','q2','q3','q4','new line','greenfield','brownfield'] },
  { type:'MARGIN', category:'MARGIN', subject:'Operating Margin', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['margin','opm','ebitda'],
    states:['stable','expand','improve','intact','no pressure','protected','maintained','guidance'] },
];

function extractSignals(articleText: string, source: string, date: string): ExtractedSignal[] {
  const text = articleText.toLowerCase();
  const results: ExtractedSignal[] = [];
  const ageWeight = getAgeWeight(date);

  // Process compound patterns FIRST (higher specificity, higher confidence)
  for (const cp of COMPOUND_EXTRACT_PATTERNS) {
    // Split into sentences first
    const sentences = articleText.split(/[.!?]/).map(s => s.trim()).filter(s => s.length >= 15);
    for (const sentence of sentences) {
      const sl = sentence.toLowerCase();
      const hasProduct = cp.products.some(p => sl.includes(p));
      const hasState   = cp.states.some(s => sl.includes(s));
      if (hasProduct && hasState) {
        const numerical = extractNumerical(sentence);
        const temporality = tagTemporality(sentence);
        const effectiveAlpha = cp.isAlpha && temporality !== 'HISTORICAL';
        // Avoid duplicating if same type already found with better evidence
        if (!results.some(r => r.type === cp.type && r.subject === cp.subject)) {
          results.push({
            type: cp.type, category: cp.category, text: sentence.split(' ').slice(0,40).join(' '),
            positive: cp.positive, strength: cp.strength, horizon: cp.horizon,
            isAlpha: effectiveAlpha, temporality, numerical,
            subject: cp.subject, origin: 'COMPANY', isForConcall: true,
            source, date, ageWeight,
          });
        }
        break; // one compound signal per pattern per article
      }
    }
  }

  // Process generic concall patterns
  for (const p of CONCALL_PATTERNS) {
    let matched = false;
    let matchedText = '';

    // Layer 1: Keyword match
    for (const kw of p.keywords) {
      if (text.includes(kw)) {
        const idx = text.indexOf(kw);
        const start = Math.max(0, text.lastIndexOf('.', idx - 1) + 1);
        const end = Math.min(articleText.length, (text.indexOf('.', idx + kw.length) + 1) || articleText.length);
        matchedText = articleText.slice(start, end).trim().split(' ').slice(0, 40).join(' ');
        matched = true;
        break;
      }
    }

    // Layer 2: Semantic match (only if Layer 1 missed)
    if (!matched) {
      for (const sem of p.semantic) {
        if (text.includes(sem)) {
          const idx = text.indexOf(sem);
          const start = Math.max(0, text.lastIndexOf('.', idx - 1) + 1);
          const end = Math.min(articleText.length, (text.indexOf('.', idx + sem.length) + 1) || articleText.length);
          matchedText = articleText.slice(start, end).trim().split(' ').slice(0, 40).join(' ');
          matched = true;
          break;
        }
      }
    }

    // EVIDENCE INTEGRITY: only create signal if we extracted actual text (≥15 chars)
    // This prevents signals without traceable evidence — the core trust issue
    if (matched && matchedText.length >= 15) {
      const temporality = tagTemporality(matchedText);
      const numerical = extractNumerical(matchedText);
      const effectiveAlpha = p.isAlpha && temporality !== 'HISTORICAL';
      const subject = extractSubject(p.type, matchedText);
      results.push({
        type: p.type, category: p.category, text: matchedText,
        positive: p.positive, strength: p.strength, horizon: p.horizon,
        isAlpha: effectiveAlpha, temporality,
        numerical, isForConcall: true,
        subject, origin: 'COMPANY', // extractSignals = company match; sector signals tagged separately
        source, date, ageWeight,
      });
    }
  }

  // Process news-feed patterns (analyst cap etc.) — tagged differently
  for (const p of NEWS_FEED_PATTERNS) {
    for (const kw of [...p.keywords, ...p.semantic]) {
      if (text.includes(kw)) {
        const idx = text.indexOf(kw);
        const start = Math.max(0, text.lastIndexOf('.', idx - 1) + 1);
        const end = Math.min(articleText.length, (text.indexOf('.', idx + kw.length) + 1) || articleText.length);
        const matchedText = articleText.slice(start, end).trim().split(' ').slice(0, 40).join(' ');
        if (matchedText.length >= 15) {
          results.push({
            type: p.type, category: p.category, text: matchedText,
            positive: p.positive, strength: p.strength, horizon: '0-3M',
            isAlpha: p.isAlpha, temporality: 'CURRENT' as const,
            isForConcall: false,
            subject: extractSubject(p.type, matchedText), origin: 'COMPANY' as SignalOrigin,
            source, date, ageWeight,
          });
        }
        break;
      }
    }
  }

  // ── HEADLINE PATTERNS — catch news-style language that CONCALL_PATTERNS misses ──
  // These run last and only add signals if no stronger signal of the same type already exists.
  for (const p of HEADLINE_PATTERNS) {
    // Skip if we already have a stronger signal of this type from management language
    const existingOfType = results.filter(r => r.type === p.type);
    const bestExisting = existingOfType.reduce((best, r) => Math.max(best, r.strength), 0);
    if (bestExisting >= p.strength + 1) continue; // already have a better signal

    let matched = false;
    let matchedText = '';
    for (const kw of p.keywords) {
      if (text.includes(kw)) {
        const idx = text.indexOf(kw);
        // Grab the surrounding sentence (or whole short headline)
        const start = Math.max(0, text.lastIndexOf('.', idx - 1) + 1);
        const end = Math.min(articleText.length, (text.indexOf('.', idx + kw.length) + 1) || articleText.length);
        matchedText = articleText.slice(start, end).trim().split(' ').slice(0, 50).join(' ');
        // For very short headlines, use full text
        if (matchedText.length < 15 && articleText.length < 200) {
          matchedText = articleText.trim().split(' ').slice(0, 50).join(' ');
        }
        if (matchedText.length >= 10) { matched = true; break; }
      }
    }
    if (matched && matchedText.length >= 10) {
      const temporality = tagTemporality(matchedText);
      const numerical = extractNumerical(matchedText);
      results.push({
        type: p.type, category: p.category,
        text: matchedText,
        positive: p.positive, strength: p.strength, horizon: p.horizon,
        isAlpha: p.isAlpha, temporality,
        numerical, isForConcall: false, // headline = news, not concall
        subject: p.subject, origin: 'COMPANY' as SignalOrigin,
        source, date, ageWeight,
      });
    }
  }

  return results;
}

// ── Multi-Article Signal Aggregation ─────────────────────────────────────────
function buildCompositeSignals(signals: ExtractedSignal[]): CompositeSignal[] {
  const cats = new Map<SignalCategory, ExtractedSignal[]>();
  for (const s of signals) {
    if (!cats.has(s.category)) cats.set(s.category, []);
    cats.get(s.category)!.push(s);
  }
  const composites: CompositeSignal[] = [];
  for (const [cat, sigs] of cats) {
    if (sigs.length === 0) continue;
    const posCount = sigs.filter(s=>s.positive).length;
    const negCount = sigs.filter(s=>!s.positive).length;
    const direction: 'UP'|'DOWN'|'STABLE' = posCount > negCount ? 'UP' : negCount > posCount ? 'DOWN' : 'STABLE';
    const compositeStrength = Math.min(5, Math.round(sigs.reduce((s,sig)=>s+sig.strength * sig.ageWeight,0) / sigs.length) + (sigs.length >= 3 ? 1 : 0));
    const catLabels: Record<string, string> = {
      DEMAND:'Demand', MARGIN:'Margin', CAPEX:'Capacity', PRICING:'Pricing',
      GUIDANCE:'Guidance', SUPPLY_CHAIN:'Supply Chain', RISK:'Risk', MGMT_STYLE:'Management Style',
    };
    composites.push({
      category: cat,
      label: catLabels[cat] || cat,
      direction,
      strength: compositeStrength as 1|2|3|4|5,
      evidence: sigs.filter(s=>s.isAlpha).slice(0,3).map(s=>s.text),
      count: sigs.length,
    });
  }
  return composites.sort((a,b) => b.strength - a.strength);
}

// ── Expectation Shift Score ───────────────────────────────────────────────────
function computeExpectationShift(signals: ExtractedSignal[]): number {
  // HIGH SHIFT: new information materially different from steady-state
  // LOW SHIFT: confirmatory / steady-state
  let shift = 0;
  const HIGH_SHIFT_TYPES: ConcallSignalType[] = ['DEMAND_CONSTRAINT','LTA','GUIDANCE_UP','GUIDANCE_DOWN','ANALYST_CAP','CONSERVATIVE_GUIDANCE','VISIBILITY_CONFIDENCE'];
  const forwardAlpha = signals.filter(s=>s.isAlpha && s.temporality==='FORWARD');
  shift += forwardAlpha.length * 12;
  shift += signals.filter(s=>HIGH_SHIFT_TYPES.includes(s.type)).length * 8;
  shift += signals.filter(s=>s.numerical !== undefined).length * 10; // numerical = concrete = high shift
  shift -= signals.filter(s=>s.temporality==='HISTORICAL').length * 5; // historical = no shift
  return Math.max(0, Math.min(100, shift));
}

// ── Why It Matters Generator ──────────────────────────────────────────────────
// Upgraded: uses actual signal subjects for dynamic, company-specific narrative
function generateWhyItMatters(composites: CompositeSignal[], signals: ExtractedSignal[]): string {
  const demandSig = signals.find(s=>s.type==='DEMAND_CONSTRAINT'&&s.positive&&s.text);
  const orderSig  = signals.find(s=>s.type==='ORDER'&&s.positive&&s.text);
  const capexSig  = signals.find(s=>s.type==='CAPEX'&&s.positive&&s.text);
  const marginSig = signals.find(s=>s.type==='MARGIN'&&s.positive&&s.text);
  const guidanceSig = signals.find(s=>s.type==='GUIDANCE_UP'&&s.positive&&s.text);
  const negSigs   = signals.filter(s=>!s.positive&&s.isAlpha&&s.text);

  if (signals.length === 0) return 'No traceable management signals in 30D window.';

  // Build specific narrative using subjects (e.g., "Insulators constrained, ₹300Cr order pipeline")
  const parts: string[] = [];
  if (demandSig) parts.push(`${demandSig.subject} constrained${demandSig.origin==='SECTOR'?' (sector-wide)':' (company confirmed)'}`);
  if (orderSig)  parts.push(`${orderSig.subject || 'order pipeline'} confirmed`);
  if (capexSig)  parts.push(`${capexSig.subject || 'capacity'} expanding`);
  if (marginSig) parts.push(`${marginSig.subject || 'margins'} stable`);
  if (guidanceSig) parts.push(`management ${guidanceSig.subject?.toLowerCase() || 'outlook'} positive`);

  const negParts = negSigs.slice(0,2).map(s=>`${s.subject || s.type} risk`);

  if (parts.length === 0 && negParts.length > 0) {
    return `Risk signals: ${negParts.join(' + ')}. No positive confirmation. Watch closely.`;
  }
  if (parts.length >= 3 && negParts.length === 0) {
    return `${parts.slice(0,-1).join(' + ')} → ${parts[parts.length-1]} → revenue acceleration likely 2-4 quarters.`;
  }
  if (parts.length >= 2 && negParts.length === 0) {
    return `${parts.join(' + ')} → multi-signal convergence, improving conviction.`;
  }
  if (parts.length >= 1 && negParts.length > 0) {
    return `${parts.join(' + ')} but ${negParts.join(' + ')} — mixed signals, monitor resolution.`;
  }
  if (parts.length === 1) {
    const isOnlySector = signals.filter(s=>s.isAlpha&&s.positive).every(s=>s.origin==='SECTOR');
    return isOnlySector
      ? `${parts[0]} — sector signal only. No company-specific confirmation found. Low conviction.`
      : `${parts[0]} — single signal. Needs corroboration before sizing up.`;
  }
  return 'Insufficient signals for synthesis. Verify manually.';
}

// ── Fixed MRI Score (incorporates management style signals) ──────────────────
function computeMRI(signals: ExtractedSignal[]): number {
  // MRI = management reliability — only company-confirmed signals contribute
  const companySigs = signals.filter(s => s.origin === 'COMPANY' && s.text && s.text.length >= 8);
  if (companySigs.length === 0) return 50; // neutral: no company data
  let score = 50;
  score += companySigs.filter(s=>s.type==='GUIDANCE_UP'||s.type==='CONSERVATIVE_GUIDANCE').length * 10;
  score += companySigs.filter(s=>s.type==='VISIBILITY_CONFIDENCE').length * 8;
  score += companySigs.filter(s=>s.isAlpha&&s.positive&&s.temporality==='FORWARD').length * 5;
  score -= companySigs.filter(s=>s.type==='CAPEX_DELAY'||s.type==='ORDER_EXECUTION_DELAY').length * 10;
  score -= companySigs.filter(s=>s.type==='GUIDANCE_DOWN').length * 12;
  score -= companySigs.filter(s=>!s.positive&&s.isAlpha).length * 4;
  const hasConservative = companySigs.some(s=>s.type==='CONSERVATIVE_GUIDANCE');
  const hasStrong = companySigs.some(s=>s.strength>=4&&s.positive);
  if (hasConservative && hasStrong) score += 10; // underpromise-overdeliver pattern
  return Math.max(10, Math.min(95, score));
}

// ── Fixed Signal Score (corrected weights: alpha 1.0, negative -1.2, noise 0.3) ─
function computeSignalScore(signals: ExtractedSignal[]): number {
  // CRITICAL: Only COMPANY-matched signals score. Sector signals are context, not evidence.
  // This prevents "Data center power demand" → phantom 100 score for every electrical company.
  // Lowered threshold to 8 chars: headline-style signals like "wins order" are < 15 chars
  // but are valid COMPANY evidence (defense orders, quarterly results etc.)
  const companySignals = signals.filter(s => s.origin === 'COMPANY' && s.text && s.text.length >= 8);
  if (companySignals.length === 0) return 0; // no company evidence = score 0
  const weightedSum = companySignals.reduce((sum, s) => {
    let w = s.strength * s.ageWeight;
    if (s.isAlpha && s.positive)    w *= 1.0;
    else if (!s.positive && s.isAlpha) w *= -1.2;
    else if (!s.isAlpha)            w *= 0.3;
    return sum + w;
  }, 0);
  // Scale by coverage: more articles = higher confidence (log scale)
  const coverageMultiplier = 1 + Math.log2(1 + companySignals.length) * 0.15;
  return Math.max(0, Math.min(100, Math.round((50 + weightedSum * 4) * coverageMultiplier)));
}

// ── Reusable Signal Card — ensures consistent display of label + subject + evidence ──
function SignalCard({ sig, horizonColor }: { sig: ExtractedSignal; horizonColor: (h:string)=>string }) {
  const c = sig.positive ? '#10b981' : '#ef4444';
  const originBadge = sig.origin === 'SECTOR' ? '🌍' : sig.origin === 'DERIVED' ? '🔮' : '🏢';
  return (
    <div style={{padding:'10px 12px',backgroundColor:sig.positive?'#10b98108':'#ef444408',border:`1px solid ${sig.positive?'#10b98120':'#ef444420'}`,borderLeft:`3px solid ${c}`,borderRadius:7}}>
      <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:5,flexWrap:'wrap'}}>
        {/* Signal label + subject together — the key fix */}
        <span style={{fontSize:11,fontWeight:800,color:c}}>
          {sig.positive?'↑':'↓'} {sig.type.replace(/_/g,' ')}:&nbsp;
          <span style={{fontWeight:600,color:'#C9D4E0'}}>{sig.subject}</span>
        </span>
        {sig.dupCount && sig.dupCount > 1 && (
          <span style={{fontSize:8,color:'#4A5B6C',border:'1px solid #1A2840',padding:'0 4px',borderRadius:3}}>×{sig.dupCount} merged</span>
        )}
        <span title={`Origin: ${sig.origin}`} style={{fontSize:9,color:'#4A5B6C'}}>{originBadge} {sig.origin}</span>
        <span style={{fontSize:9,color:'#4A5B6C',fontStyle:'italic'}}>{sig.temporality}</span>
        <span style={{fontSize:9,fontWeight:700,color:horizonColor(sig.horizon),border:`1px solid ${horizonColor(sig.horizon)}40`,padding:'1px 5px',borderRadius:3}}>{sig.horizon}</span>
        {sig.numerical && (
          <span style={{fontSize:10,fontWeight:800,color:'#F59E0B',border:'1px solid #F59E0B40',padding:'2px 7px',borderRadius:3}}>
            ₹{sig.numerical.value}{sig.numerical.unit}{sig.numerical.timing?` · ${sig.numerical.timing}`:''}
          </span>
        )}
        <span style={{fontSize:8,color:'#4A5B6C',marginLeft:'auto'}}>{sig.date?new Date(sig.date).toLocaleDateString('en-IN'):''}</span>
      </div>
      {/* Evidence sentence — MANDATORY. If missing, flag it */}
      {sig.text && sig.text.length >= 15 ? (
        <div style={{fontSize:11,color:'#C9D4E0',lineHeight:1.6,backgroundColor:'#060E1A',padding:'6px 10px',borderRadius:5,borderLeft:'2px solid #4A5B6C',marginBottom:4}}>
          "{sig.text}"
        </div>
      ) : (
        <div style={{fontSize:10,color:'#F59E0B',padding:'4px 8px',backgroundColor:'#F59E0B08',borderRadius:4,marginBottom:4}}>
          ⚠ No traceable evidence sentence — do not act on this signal
        </div>
      )}
      <div style={{fontSize:9,color:'#4A5B6C'}}>📰 {sig.source || 'Unknown source'}</div>
    </div>
  );
}

function ConcallIntelligence() {
  const [loading, setLoading] = useState(false);
  const [summaries, setSummaries] = useState<CompanyConcallSummary[]>([]);
  const [lastFetched, setLastFetched] = useState('');
  const [expandedSym, setExpandedSym] = useState<string|null>(null);
  const [showAlphaOnly, setShowAlphaOnly] = useState(false);

  // Read screener stocks from localStorage
  // Combine ALL tracked stocks: Screener + Watchlist + Portfolio (so no stock is missed)
  const screenerStocks: {symbol:string;company:string;sector:string;source:string;grade?:string;score?:number}[] = (() => {
    const seen = new Set<string>();
    const all: {symbol:string;company:string;sector:string;source:string;grade?:string;score?:number}[] = [];
    // 1. Multibagger screener stocks (mb_excel_scored_v2)
    try {
      const d = JSON.parse(localStorage.getItem('mb_excel_scored_v2')||'[]');
      if (Array.isArray(d)) d.forEach((r:any) => {
        const sym = (r.symbol||'').toUpperCase();
        if (sym && !seen.has(sym)) { seen.add(sym); all.push({symbol:r.symbol,company:r.company||r.symbol,sector:r.sector||'',grade:r.grade,score:r.score,source:'Screener'}); }
      });
    } catch {}
    // 2. Watchlist tickers (mc_watchlist_tickers)
    try {
      const wl = JSON.parse(localStorage.getItem('mc_watchlist_tickers')||'[]');
      if (Array.isArray(wl)) wl.forEach((sym:string) => {
        const s = sym.toUpperCase();
        if (s && !seen.has(s)) { seen.add(s); all.push({symbol:s,company:s,sector:'',source:'Watchlist'}); }
      });
    } catch {}
    // 3. Portfolio holdings (mc_portfolio_holdings)
    try {
      const pf = JSON.parse(localStorage.getItem('mc_portfolio_holdings')||'[]');
      if (Array.isArray(pf)) pf.forEach((h:any) => {
        const s = (h.symbol||'').toUpperCase();
        if (s && !seen.has(s)) { seen.add(s); all.push({symbol:s,company:h.company||s,sector:'',source:'Portfolio'}); }
      });
    } catch {}
    return all;
  })();

  async function fetchConcallData() {
    if (screenerStocks.length === 0) return;
    setLoading(true);
    try {
      // Fetch broad news covering last 30 days
      const fetches = await Promise.allSettled([
        fetch('/api/v1/news?limit=500&importance_min=1&article_type=EARNINGS'),
        fetch('/api/v1/news?limit=300&importance_min=1&article_type=CORPORATE'),
        fetch('/api/v1/news?limit=200&importance_min=2&article_type=GENERAL'),
      ]);
      const arrays = await Promise.all(fetches.map(async r => {
        if (r.status !== 'fulfilled' || !r.value.ok) return [];
        try { const d = await r.value.json(); return Array.isArray(d) ? d : []; } catch { return []; }
      }));
      const allArticles = arrays.flat();
      const now = Date.now();
      const THIRTY_DAYS = 30 * 86400000;

      // Match articles to screener stocks
      const result: CompanyConcallSummary[] = [];
      for (const stock of screenerStocks) {
        const sym = stock.symbol.toUpperCase().replace(/\.NS$|\.BO$/i,'');
        // Build alias list for better Indian small-cap matching
        const aliases = buildAliases(sym, stock.company||sym);

        // ── Company families: when multiple tickers share a common prefix ─────────
        // e.g., BAJAJ → BAJAJCON, BAJAJAUTO, BAJAJFINSERV, BAJAJHLDNG
        // If an article's PRIMARY ticker is a DIFFERENT member of the same family,
        // we only include it if our company's specific name appears in the text.
        const FAMILY_PREFIXES = ['BAJAJ','TATA','ADANI','BIRLA','MAHINDRA','RELIANCE','HDFC','ICICI','KOTAK','L&T','LT','HCL'];
        const symFamily = FAMILY_PREFIXES.find(fp => sym.startsWith(fp));

        const relevant = allArticles.filter(a => {
          if (!a.published_at) return false;
          const age = now - new Date(a.published_at).getTime();
          if (age > THIRTY_DAYS) return false;
          const text = ((a.title||'')+(a.headline||'')+(a.summary||'')).toLowerCase();
          const artTickers = ((a.ticker_symbols||[]) as string[]).map((t:string)=>t.toUpperCase().replace(/\.NS$|\.BO$/i,''));

          // Primary ticker match (highest confidence):
          if (artTickers.includes(sym)) {
            // Cross-contamination guard: if the article's PRIMARY ticker is a DIFFERENT
            // company in the same family (e.g., BAJAJAUTO when we want BAJAJCON),
            // require our specific company name to appear in the text.
            const primaryTicker = artTickers[0];
            if (primaryTicker && primaryTicker !== sym && symFamily && primaryTicker.startsWith(symFamily)) {
              // Different company in same family — verify our name actually appears
              const nameInText = aliases.some(alias =>
                alias.length >= 8 && text.includes(alias.toLowerCase())
              );
              return nameInText;
            }
            return true;
          }

          // Alias match — use word-boundary awareness for short aliases
          for (const alias of aliases) {
            if (alias.length < 4) continue;
            // For long aliases (>= 8 chars): simple substring match is fine
            if (alias.length >= 8) {
              if (text.includes(alias)) return true;
              continue;
            }
            // For short aliases (4-7 chars): require word boundary
            const idx = text.indexOf(alias);
            if (idx === -1) continue;
            const before = idx === 0 || !/[a-z0-9]/.test(text[idx - 1]);
            const after = idx + alias.length >= text.length || !/[a-z0-9]/.test(text[idx + alias.length]);
            if (before && after) return true;
          }
          return false;
        });

        // Cross-stock sector signals: inject sector-wide signals for this company
        const sectorText = (stock.sector||'').toLowerCase();
        const sectorSignalArticles = allArticles.filter(a => {
          if (!a.published_at || (now - new Date(a.published_at).getTime()) > THIRTY_DAYS) return false;
          const text = ((a.title||'')+(a.headline||'')+(a.summary||'')).toLowerCase();
          return SECTOR_SIGNALS.some(ss =>
            ss.targetSectors.some(ts => sectorText.includes(ts)) &&
            ss.keywords.some(kw => text.includes(kw))
          );
        });

        // Don't skip 0-article companies — still show them with "no news" state
        // (helps user understand which companies have no press coverage)
        // Only skip if the company has truly nothing useful to display AND there are many stocks tracked
        // i.e., only skip if stock score is low-grade (D) AND 0 articles AND 0 sector signals
        if (relevant.length === 0 && sectorSignalArticles.length === 0) {
          // Show high-grade or watchlist/portfolio stocks even with no news
          const isHighPriority = ['A+','A','B+'].includes(stock.grade||'') || stock.source === 'Portfolio' || stock.source === 'Watchlist';
          if (!isHighPriority) continue; // skip D/C grade screener stocks with 0 articles
        }

        // For financial companies (exchanges, banks, NBFCs): only allow GUIDANCE/RESULTS signals
        // They don't get supply-chain, order, or capacity signals from articles
        const stockIsFinancial = isFinancialCompany(stock.sector||'', stock.company||'');

        // Extract signals — COMPANY signals first, then SECTOR signals (clearly separated)
        const rawSignals: ExtractedSignal[] = [];

        // Company signals: from articles that matched THIS company's ticker/name
        for (const a of relevant) {
          const fullText = [(a.title||''),(a.headline||''),(a.summary||'')].join(' ');
          const sigs = extractSignals(fullText, a.title||a.headline||'', a.published_at||'');
          // Financial companies: filter to only GUIDANCE/RESULTS type signals
          // (prevent commodity order language being interpreted as equipment orders)
          const filtered = stockIsFinancial
            ? sigs.filter(s => ['GUIDANCE_UP','GUIDANCE_DOWN','MARGIN','MARGIN_PRESSURE','EQUITY_DILUTION','REGULATORY_RISK'].includes(s.type))
            : sigs;
          rawSignals.push(...filtered);
        }

        // Sector signals: injected ONLY when relevance >= threshold AND compound requirement met
        // These do NOT affect signalScore (score uses COMPANY signals only) — purely context
        const stockMeta = { sector: stock.sector||'', company: stock.company||'' };
        const appliedSectorSignals = new Set<string>(); // deduplicate sector signals per company
        for (const a of sectorSignalArticles) {
          if (relevant.includes(a)) continue; // already processed as COMPANY
          const fullText = [(a.title||''),(a.headline||''),(a.summary||'')].join(' ');
          const fullTextLower = fullText.toLowerCase();
          // Match to specific sector signal definition (not just generic extraction)
          for (const ss of SECTOR_SIGNALS) {
            const alreadyApplied = appliedSectorSignals.has(ss.id);
            if (alreadyApplied) continue;
            // Relevance gate: company must be relevant enough to receive this signal
            const relevance = computeSectorRelevance(stockMeta, ss);
            if (relevance < ss.relevanceThreshold) continue;
            // Keyword gate: article must mention at least one keyword
            const hasKeyword = ss.keywords.some(kw => fullTextLower.includes(kw));
            if (!hasKeyword) continue;
            // Extract the specific sentence containing the matched keyword
            const matchedKw = ss.keywords.find(kw => fullTextLower.includes(kw));
            if (!matchedKw) continue;
            const idx = fullTextLower.indexOf(matchedKw);
            const sentStart = Math.max(0, fullText.lastIndexOf('.', idx - 1) + 1);
            const sentEnd = Math.min(fullText.length, (fullText.indexOf('.', idx + matchedKw.length) + 1) || fullText.length);
            const sentence = fullText.slice(sentStart, sentEnd).trim().split(' ').slice(0, 40).join(' ');
            // HARD VALIDATION: sentence must exist AND meet compound requirement
            if (sentence.length < 15) continue;
            if (!meetsCompoundRequirement(sentence, ss.compoundRequired)) continue;
            appliedSectorSignals.add(ss.id);
            rawSignals.push({
              type: 'DEMAND_CONSTRAINT', category: 'DEMAND', text: sentence,
              positive: true, strength: 3, horizon: '6-12M', isAlpha: true,
              temporality: 'CURRENT',
              subject: `${ss.subject} (${ss.signalType.replace(/_/g,' ')})`,
              origin: 'SECTOR', isForConcall: true,
              source: a.title || a.headline || '', date: a.published_at || '',
              ageWeight: getAgeWeight(a.published_at || ''),
              // Store sector metadata for richer display
              ...(({ sectorDef: ss } as any)),
            } as ExtractedSignal & { sectorDef: SectorSignalDef });
          }
        }

        // DEDUPLICATION: merge same-type signals, preventing DEMAND_CONSTRAINT × 3
        const allSignals = deduplicateSignals(rawSignals);

        const composite = buildCompositeSignals(allSignals);
        const signalScore = computeSignalScore(allSignals);
        const mriScore = computeMRI(allSignals);
        const expectationShift = computeExpectationShift(allSignals);
        // Dynamic why-it-matters using actual signal subjects
        const whyItMatters = generateWhyItMatters(composite, allSignals);
        const posCount = allSignals.filter(s=>s.positive).length;
        const negCount = allSignals.filter(s=>!s.positive).length;

        const trend: 'IMPROVING'|'STABLE'|'DETERIORATING'|'UNKNOWN' =
          allSignals.length === 0 ? 'UNKNOWN' :
          posCount > negCount * 2 ? 'IMPROVING' : negCount > posCount ? 'DETERIORATING' : 'STABLE';

        const hasConservativeStyle = allSignals.some(s=>s.type==='CONSERVATIVE_GUIDANCE');
        const hasBullish = allSignals.some(s=>['ORDER','DEMAND_CONSTRAINT','GUIDANCE_UP','VISIBILITY_CONFIDENCE'].includes(s.type));
        const tone = hasConservativeStyle && hasBullish ? 'Conservative-Bullish' : hasBullish ? 'Bullish' : negCount > 0 ? 'Cautious' : 'Neutral';

        const latestDate = [...relevant,...sectorSignalArticles].reduce((latest, a) =>
          !latest || (a.published_at && a.published_at > latest) ? a.published_at : latest, '');
        const ageHours = latestDate ? (now - new Date(latestDate).getTime()) / 3600000 : 9999;
        const freshness: 'FRESH'|'ACTIVE'|'STALE' = ageHours < 48 ? 'FRESH' : ageHours < 168 ? 'ACTIVE' : 'STALE';

        const alphaCount = allSignals.filter(s=>s.isAlpha).length;
        const surprisePotential: 'HIGH'|'MEDIUM'|'LOW' =
          (expectationShift >= 60 || allSignals.filter(s=>s.strength>=4&&s.positive).length>=2) ? 'HIGH' :
          allSignals.length >= 3 ? 'MEDIUM' : 'LOW';

        // "Missed by market" — strong signals but few articles (market hasn't priced it yet)
        const missedByMarket = alphaCount >= 2 && relevant.length <= 2 && signalScore >= 60;

        // Collect recent headlines for display (even when 0 signals)
        const recentHeadlines = relevant
          .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
          .slice(0, 5)
          .map(a => ({
            title: (a.title || a.headline || '').trim(),
            source: (a.source_name || a.source || '').trim(),
            date: a.published_at || '',
            url: a.url || a.source_url || '',
          }))
          .filter(h => h.title.length > 10);

        result.push({
          symbol: stock.symbol, company: stock.company, sector: stock.sector,
          grade: stock.grade, score: stock.score, source: (stock as any).source||'Screener',
          signals: allSignals.sort((a,b) => (b.strength * b.ageWeight) - (a.strength * a.ageWeight)),
          composite, signalScore, mriScore, expectationShift, trend, tone,
          surprisePotential, freshness, missedByMarket, whyItMatters,
          lastDate: latestDate, articleCount: relevant.length,
          alphaCount, noiseCount: allSignals.filter(s=>!s.isAlpha).length,
          recentHeadlines,
        } as any);
      }

      // Sort by signal score desc
      setSummaries(result.sort((a,b)=>b.signalScore - a.signalScore));
      setLastFetched(new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
    } catch(e) { console.error('[Concall]',e); }
    setLoading(false);
  }

  useEffect(() => { if (screenerStocks.length > 0) fetchConcallData(); }, []); // eslint-disable-line

  const ACCENT2 = '#a78bfa';
  // ── Manual Concall Input state — paste raw transcript/highlight text ──
  const [manualInput, setManualInput] = useState('');
  const [manualSymbol, setManualSymbol] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const MANUAL_KEY = 'mb_concall_manual_v1';

  const [manualParseStatus, setManualParseStatus] = useState<{type:'ok'|'warn'|'error';msg:string}|null>(null);

  function processManualInput() {
    if (!manualInput.trim() || !manualSymbol.trim()) return;
    const sym = manualSymbol.trim().toUpperCase();
    const sigs = extractSignals(manualInput, 'Manual Concall Input', new Date().toISOString());
    if (sigs.length === 0) {
      setManualParseStatus({type:'warn', msg:'No signals detected. Try phrases like "₹300 Cr order", "capacity expansion", "margin stable", "demand strong".'});
      return;
    }
    // Store manual signals in localStorage keyed by symbol
    try {
      const stored = JSON.parse(localStorage.getItem(MANUAL_KEY)||'{}');
      stored[sym] = { text: manualInput, signals: sigs, timestamp: Date.now() };
      localStorage.setItem(MANUAL_KEY, JSON.stringify(stored));
    } catch {}
    // Inject into existing summary or create new entry
    setSummaries(prev => {
      const existing = prev.find(s => s.symbol === sym);
      if (existing) {
        const merged = deduplicateSignals([...existing.signals, ...sigs]);
        const updated = { ...existing, signals: merged, signalScore: computeSignalScore(merged), mriScore: computeMRI(merged), alphaCount: merged.filter(s=>s.isAlpha).length, articleCount: existing.articleCount, composite: buildCompositeSignals(merged), whyItMatters: generateWhyItMatters(buildCompositeSignals(merged), merged) };
        return prev.map(s => s.symbol === sym ? updated : s).sort((a,b)=>b.signalScore-a.signalScore);
      }
      const stock = screenerStocks.find(s => s.symbol.toUpperCase() === sym);
      const newEntry: CompanyConcallSummary = {
        symbol: sym, company: stock?.company || sym, sector: stock?.sector || '', grade: stock?.grade, score: stock?.score, source: 'Manual',
        signals: sigs, composite: buildCompositeSignals(sigs), signalScore: computeSignalScore(sigs), mriScore: computeMRI(sigs),
        expectationShift: computeExpectationShift(sigs), trend: 'IMPROVING', tone: 'Bullish', surprisePotential: 'HIGH',
        freshness: 'FRESH', missedByMarket: false, whyItMatters: generateWhyItMatters(buildCompositeSignals(sigs), sigs),
        lastDate: new Date().toISOString(), articleCount: 0, alphaCount: sigs.filter(s=>s.isAlpha).length, noiseCount: sigs.filter(s=>!s.isAlpha).length,
        recentHeadlines: [{ title: 'Manual concall input', source: 'User paste', date: new Date().toISOString(), url: '' }],
      } as any;
      return [...prev, newEntry].sort((a,b)=>b.signalScore-a.signalScore);
    });
    setManualInput(''); setManualSymbol('');
    setManualParseStatus({type:'ok', msg:`✅ ${sigs.length} signal${sigs.length!==1?'s':''} extracted for ${sym}. Card updated above.`});
    setTimeout(() => { setShowManualInput(false); setManualParseStatus(null); }, 3000);
  }

  const displayed = showAlphaOnly ? summaries.filter(s=>s.alphaCount>0) : summaries;
  const toneColor = (t:string) => t.includes('Bull')?'#10b981':t==='Cautious'?'#ef4444':'#f59e0b';
  const freshColor = (f:string) => f==='FRESH'?'#10b981':f==='ACTIVE'?'#f59e0b':'#4A5B6C';
  const horizonColor = (h:string) => h==='0-3M'?'#ef4444':h==='3-6M'?'#f59e0b':h==='6-12M'?'#10b981':'#06b6d4';

  if (screenerStocks.length === 0) return (
    <div style={{textAlign:'center',padding:'60px 20px',color:TEXT3}}>
      <div style={{fontSize:40,marginBottom:12}}>🧠</div>
      <div style={{fontSize:16,fontWeight:700,color:TEXT1,marginBottom:8}}>No screener stocks loaded</div>
      <div style={{fontSize:13,color:TEXT3}}>Upload your Screener.in export in the Multibagger tab first. Concall Intelligence will automatically track your portfolio companies.</div>
    </div>
  );

  return (
    <div style={{padding:'0 0 20px'}}>
      {/* Header */}
      <div style={{padding:'16px 0 12px',borderBottom:`1px solid ${BORDER}`,marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:ACCENT2}}>🧠 Concall Intelligence — 30D Rolling Window</div>
            <div style={{fontSize:11,color:TEXT3,marginTop:2}}>
              Management signal extraction · MRI scoring · Signal vs Noise · {screenerStocks.length} companies tracked
              <span style={{color:'#4A5B6C',marginLeft:8}}>
                ({screenerStocks.filter(s=>s.source==='Screener').length} Screener · {screenerStocks.filter(s=>s.source==='Watchlist').length} Watchlist · {screenerStocks.filter(s=>s.source==='Portfolio').length} Portfolio)
              </span>
            </div>
            <div style={{fontSize:10,color:'#F59E0B',marginTop:4}}>
              💡 To add more stocks: in Screener.in click Export → downloads ALL results (all pages). Upload the CSV in Multibagger tab.
            </div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={()=>setShowAlphaOnly(v=>!v)} style={{fontSize:11,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${showAlphaOnly?ACCENT2+'60':BORDER}`,background:showAlphaOnly?`${ACCENT2}18`:'transparent',color:showAlphaOnly?ACCENT2:TEXT3,cursor:'pointer'}}>
              ⭐ Alpha Only ({summaries.filter(s=>s.alphaCount>0).length})
            </button>
            <button onClick={()=>setShowManualInput(v=>!v)} style={{fontSize:11,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${showManualInput?'#F59E0B60':BORDER}`,background:showManualInput?`#F59E0B18`:'transparent',color:showManualInput?'#F59E0B':TEXT3,cursor:'pointer'}}>
              📝 Paste Concall
            </button>
            <button onClick={fetchConcallData} disabled={loading} style={{fontSize:11,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${BORDER}`,background:'transparent',color:TEXT3,cursor:'pointer'}}>
              {loading ? '⏳ Scanning...' : '↻ Refresh'}
            </button>
            {lastFetched && <span style={{fontSize:10,color:TEXT3}}>Updated {lastFetched}</span>}
          </div>
        </div>
        {/* Stats row */}
        {summaries.length > 0 && (
          <>
            <div style={{display:'flex',gap:16,marginTop:10,flexWrap:'wrap'}}>
              {[
                {label:'Companies tracked',value:summaries.length,color:ACCENT2},
                {label:'With alpha signals',value:summaries.filter(s=>s.alphaCount>0).length,color:'#10b981'},
                {label:'Improving',value:summaries.filter(s=>s.trend==='IMPROVING').length,color:'#10b981'},
                {label:'Deteriorating',value:summaries.filter(s=>s.trend==='DETERIORATING').length,color:'#ef4444'},
                {label:'High surprise',value:summaries.filter(s=>s.surprisePotential==='HIGH').length,color:'#f59e0b'},
                {label:'Missed by market',value:summaries.filter(s=>s.missedByMarket).length,color:'#8b5cf6'},
                {label:'Conservative mgmt',value:summaries.filter(s=>s.signals.some(sg=>sg.type==='CONSERVATIVE_GUIDANCE')).length,color:'#06b6d4'},
              ].map(({label,value,color})=>(
                <div key={label} style={{textAlign:'center'}}>
                  <div style={{fontSize:18,fontWeight:900,color}}>{value}</div>
                  <div style={{fontSize:9,color:TEXT3}}>{label}</div>
                </div>
              ))}
            </div>
            {/* Sector breakdown strip */}
            {(() => {
              const bySector: Record<string,{count:number;alpha:number;improving:number}> = {};
              for (const s of summaries.filter(x=>x.alphaCount>0)) {
                const sec = (s.sector||'Unknown').replace(/&/g,'&').replace(/\s*\/\s*/g,'/').trim() || 'Other';
                if (!bySector[sec]) bySector[sec] = {count:0,alpha:0,improving:0};
                bySector[sec].count++;
                bySector[sec].alpha += s.alphaCount;
                if (s.trend==='IMPROVING') bySector[sec].improving++;
              }
              const sectorEntries = Object.entries(bySector).sort((a,b)=>b[1].alpha-a[1].alpha).slice(0,8);
              if (sectorEntries.length === 0) return null;
              return (
                <div style={{marginTop:10,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                  <span style={{fontSize:9,fontWeight:700,color:TEXT3,letterSpacing:'0.5px'}}>SECTORS WITH SIGNALS:</span>
                  {sectorEntries.map(([sec,data])=>(
                    <span key={sec} style={{fontSize:9,fontWeight:700,padding:'3px 8px',borderRadius:5,
                      backgroundColor: data.improving > 0 ? '#10b98114' : '#1A2840',
                      color: data.improving > 0 ? '#10b981' : TEXT3,
                      border: `1px solid ${data.improving > 0 ? '#10b98130' : '#1A2840'}`,
                    }}>
                      {sec} · {data.alpha} signals{data.improving>0?` · ${data.improving}↑`:''}
                    </span>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* ── Manual Concall Input — paste transcript / highlight text ── */}
      {showManualInput && (
        <div style={{marginBottom:14,padding:'14px 16px',backgroundColor:'#F59E0B08',border:'1px solid #F59E0B30',borderRadius:10}}>
          <div style={{fontSize:11,fontWeight:800,color:'#F59E0B',marginBottom:8}}>
            📝 PASTE CONCALL HIGHLIGHTS — add transcript-level signals not in news articles
          </div>
          <div style={{fontSize:10,color:'#4A5B6C',marginBottom:10}}>
            Paste raw concall text, investor presentation excerpts, or management commentary. The engine will extract signals and add to the relevant company.
          </div>
          <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
            <input value={manualSymbol} onChange={e=>setManualSymbol(e.target.value.toUpperCase())}
              placeholder="NSE Symbol (e.g. QPOWER)"
              style={{padding:'7px 12px',backgroundColor:'#0D1B2E',border:`1px solid ${BORDER}`,borderRadius:7,color:TEXT1,fontSize:12,width:180}}/>
            <button onClick={processManualInput} style={{padding:'7px 16px',borderRadius:7,border:'none',backgroundColor:'#F59E0B',color:'#000',fontWeight:800,fontSize:12,cursor:'pointer'}}>
              Extract Signals →
            </button>
            <button onClick={()=>setShowManualInput(false)} style={{padding:'7px 12px',borderRadius:7,border:`1px solid ${BORDER}`,backgroundColor:'transparent',color:TEXT3,fontSize:12,cursor:'pointer'}}>
              Cancel
            </button>
          </div>
          <textarea value={manualInput} onChange={e=>setManualInput(e.target.value)}
            placeholder="Paste concall transcript highlights here...&#10;Example:&#10;'Insulator demand remains robust and we are operating at full capacity. We expect ₹300 crore order in the next few weeks. New capacity will go live in Q4 FY26. Commodity costs are being passed to customers so no near-term margin pressure.'"
            rows={6}
            style={{width:'100%',backgroundColor:'#0D1B2E',border:`1px solid ${BORDER}`,borderRadius:8,padding:'10px 12px',color:TEXT1,fontSize:12,resize:'vertical',boxSizing:'border-box',lineHeight:1.6}}
          />
          <div style={{fontSize:10,color:'#4A5B6C',marginTop:6}}>
            💡 Signals extracted from this input are tagged as COMPANY origin with highest confidence. They are NOT from news articles — they are from management statements.
          </div>
          {/* Inline status feedback — replaces alert() */}
          {manualParseStatus && (
            <div style={{marginTop:8,padding:'8px 12px',borderRadius:7,
              backgroundColor: manualParseStatus.type==='ok'?'#10b98114':manualParseStatus.type==='warn'?'#f59e0b14':'#ef444414',
              border:`1px solid ${manualParseStatus.type==='ok'?'#10b98130':manualParseStatus.type==='warn'?'#f59e0b30':'#ef444430'}`,
              color: manualParseStatus.type==='ok'?'#10b981':manualParseStatus.type==='warn'?'#f59e0b':'#ef4444',
              fontSize:11, fontWeight:600,
            }}>
              {manualParseStatus.msg}
            </div>
          )}
        </div>
      )}

      {loading && summaries.length === 0 && (
        <div style={{textAlign:'center',padding:'40px 20px',color:TEXT3}}>
          <div style={{fontSize:28,marginBottom:8}}>⏳</div>
          <div style={{fontSize:13}}>Scanning {screenerStocks.length} companies for management signals...</div>
        </div>
      )}

      {/* Company signal cards — redesigned for maximum info density without expanding */}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {displayed.map(s => {
          const isExp = expandedSym === s.symbol;
          const gradeColor = (g:string|undefined) => ({
            'A+':'#10b981','A':'#34d399','B+':'#f59e0b','B':'#f97316','C':'#fb923c','D':'#ef4444'
          }[g||'']||TEXT3);
          const scoreColor = (n:number) => n>=70?'#10b981':n>=45?'#f59e0b':n>0?'#ef4444':'#334155';
          const bestSig = s.signals.find(sig=>sig.isAlpha&&sig.positive&&sig.origin==='COMPANY');
          const bestNegSig = s.signals.find(sig=>sig.isAlpha&&!sig.positive&&sig.origin==='COMPANY');
          const topHeadline = (s as any).recentHeadlines?.[0];
          const topNumerical = s.signals.find(sig=>sig.numerical)?.numerical;
          const borderColor = s.alphaCount>0
            ? (s.signalScore>=70?'#10b981':(s.trend==='DETERIORATING'?'#ef4444':'#a78bfa'))
            : BORDER;

          return (
            <div key={s.symbol} style={{
              backgroundColor:'#0D1B2E',
              border:`1px solid ${borderColor}50`,
              borderLeft:`3px solid ${borderColor}`,
              borderRadius:10, overflow:'hidden',
            }}>
              <button onClick={()=>setExpandedSym(isExp?null:s.symbol)} style={{width:'100%',textAlign:'left',background:'none',border:'none',cursor:'pointer',padding:'10px 14px 8px'}}>

                {/* ── ROW 1: Identity + Scores ── */}
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>

                  {/* Symbol + Grade */}
                  <div style={{flexShrink:0,minWidth:70}}>
                    <div style={{fontSize:13,fontWeight:800,color:TEXT1,letterSpacing:'-0.3px'}}>{s.symbol}</div>
                    <div style={{display:'flex',gap:4,alignItems:'center',marginTop:1}}>
                      {s.grade && <span style={{fontSize:8,fontWeight:700,color:gradeColor(s.grade),border:`1px solid ${gradeColor(s.grade)}40`,padding:'0px 4px',borderRadius:3}}>{s.grade}</span>}
                      {(s as any).source && (s as any).source !== 'Screener' && <span style={{fontSize:7,color:'#475569',border:'1px solid #1A2840',padding:'0 3px',borderRadius:2}}>{(s as any).source}</span>}
                    </div>
                  </div>

                  {/* Company + Sector */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#C9D4E0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.company}</div>
                    <div style={{fontSize:8,color:'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.sector||'—'}</div>
                  </div>

                  {/* Right: compact metrics strip */}
                  <div style={{display:'flex',gap:10,alignItems:'center',flexShrink:0}}>
                    {/* Signal score */}
                    <div style={{textAlign:'center',minWidth:32}}>
                      <div style={{fontSize:15,fontWeight:900,lineHeight:1,color:scoreColor(s.signalScore)}}>{s.articleCount===0?'—':s.signalScore}</div>
                      <div style={{fontSize:7,color:TEXT3,marginTop:1}}>SIG</div>
                    </div>
                    {/* MRI with bar */}
                    <div style={{textAlign:'center',minWidth:36}}>
                      <div style={{fontSize:12,fontWeight:700,color:s.mriScore>=70?'#10b981':s.mriScore===50?TEXT3:'#f59e0b',lineHeight:1}}>{s.mriScore===50&&s.articleCount===0?'—':s.mriScore}</div>
                      <div style={{width:32,height:2,backgroundColor:'#1A2840',borderRadius:1,marginTop:2,overflow:'hidden'}}>
                        {s.articleCount>0&&<div style={{height:'100%',width:`${s.mriScore}%`,backgroundColor:s.mriScore>=70?'#10b981':s.mriScore>=50?'#f59e0b':'#ef4444',borderRadius:1}} />}
                      </div>
                      <div style={{fontSize:7,color:TEXT3}}>MRI</div>
                    </div>
                    {/* Trend + articles */}
                    <div style={{textAlign:'center',minWidth:40}}>
                      <div style={{fontSize:11,fontWeight:700,color:s.trend==='IMPROVING'?'#10b981':s.trend==='DETERIORATING'?'#ef4444':s.trend==='UNKNOWN'?'#334155':'#f59e0b'}}>
                        {s.trend==='IMPROVING'?'↑':s.trend==='DETERIORATING'?'↓':s.trend==='UNKNOWN'?'·':'→'} {s.trend==='UNKNOWN'?'—':s.trend.slice(0,4)}
                      </div>
                      <div style={{fontSize:7,color:TEXT3}}>{s.articleCount} art.</div>
                    </div>
                    {/* Freshness dot */}
                    <div style={{width:8,height:8,borderRadius:'50%',backgroundColor:s.freshness==='FRESH'?'#10b981':s.freshness==='ACTIVE'?'#f59e0b':'#334155',flexShrink:0}} title={s.freshness} />
                    {/* Expand chevron */}
                    <span style={{fontSize:10,color:'#334155',marginLeft:2}}>{isExp?'▲':'▼'}</span>
                  </div>
                </div>

                {/* ── ROW 2: Signal evidence OR article headline — THE KEY INFO ROW ── */}
                <div style={{borderTop:'1px solid #1A284030',paddingTop:6}}>
                  {s.alphaCount > 0 && bestSig ? (
                    // HAS SIGNALS: show the best signal with evidence text
                    <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                      {/* Signal type pill */}
                      <span style={{
                        fontSize:8,fontWeight:800,flexShrink:0,marginTop:1,
                        padding:'1px 6px',borderRadius:4,
                        color:bestSig.positive?'#10b981':'#ef4444',
                        backgroundColor:(bestSig.positive?'#10b98114':'#ef444414'),
                        border:`1px solid ${bestSig.positive?'#10b98130':'#ef444430'}`,
                        whiteSpace:'nowrap',
                      }}>
                        {bestSig.positive?'↑':'↓'} {(bestSig.subject||bestSig.type.replace(/_/g,' ')).slice(0,20)}
                        {topNumerical?` ₹${topNumerical.value}Cr`:''}
                      </span>
                      {/* Evidence text — the actual signal sentence */}
                      <div style={{flex:1,fontSize:10,color:'#8A95A3',lineHeight:1.4,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',textOverflow:'ellipsis'}}>
                        {bestSig.text && bestSig.text.length > 8
                          ? `"${bestSig.text.slice(0,120)}${bestSig.text.length>120?'…':'"'}`
                          : topHeadline?.title?.slice(0,100) || 'Expand for details'
                        }
                      </div>
                      {/* Negative signal warning if any */}
                      {bestNegSig && (
                        <span style={{fontSize:8,fontWeight:700,flexShrink:0,padding:'1px 5px',borderRadius:3,color:'#ef4444',backgroundColor:'#ef444410',border:'1px solid #ef444425'}}>
                          ⚠ {(bestNegSig.subject||bestNegSig.type).replace(/_/g,' ').slice(0,12)}
                        </span>
                      )}
                    </div>
                  ) : s.articleCount > 0 && topHeadline ? (
                    // HAS ARTICLES BUT NO SIGNALS: show the latest article headline
                    <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                      <span style={{fontSize:8,flexShrink:0,color:'#334155',marginTop:1}}>📰</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:10,color:'#64748B',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                          {topHeadline.title.slice(0,100)}{topHeadline.title.length>100?'…':''}
                        </div>
                        <div style={{fontSize:8,color:'#334155',marginTop:1}}>
                          {topHeadline.source} · {topHeadline.date?new Date(topHeadline.date).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):''}
                          <span style={{marginLeft:8,color:'#475569'}}>{s.articleCount} article{s.articleCount!==1?'s':''}, 0 signals — expand to see all</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // 0 ARTICLES
                    <div style={{fontSize:9,color:'#334155'}}>
                      📭 No news found in last 30 days — expand for details
                    </div>
                  )}
                </div>
              </button>

              {isExp && (
                <div style={{padding:'0 16px 16px',borderTop:`1px solid ${BORDER}`}}>
                  {s.signals.length === 0 ? (
                    <div style={{padding:'16px 0',color:TEXT3,fontSize:11,textAlign:'center'}}>No management signals detected in 30D window. Try refreshing or check back post earnings.</div>
                  ) : (
                    <div style={{marginTop:12}}>

                      {/* ── ARTICLE HEADLINES (always shown when articles exist) ── */}
                      {(s as any).recentHeadlines?.length > 0 && (
                        <div style={{marginBottom:14,padding:'10px 12px',backgroundColor:'#060E1A',border:'1px solid #1A2840',borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:800,color:'#64748B',letterSpacing:'1px',marginBottom:8}}>
                            📰 RECENT NEWS ({s.articleCount} article{s.articleCount!==1?'s':''} found for {s.company})
                            {s.alphaCount === 0 && <span style={{color:'#F59E0B',marginLeft:6}}>— no actionable management signals detected yet</span>}
                          </div>
                          <div style={{display:'flex',flexDirection:'column',gap:5}}>
                            {(s as any).recentHeadlines.map((h: {title:string;source:string;date:string;url?:string}, hi: number) => (
                              <div key={hi} style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                                <span style={{fontSize:10,color:'#334155',flexShrink:0}}>›</span>
                                <div style={{flex:1,minWidth:0}}>
                                  {h.url ? (
                                    <a href={h.url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'#94A3B8',lineHeight:1.4,textDecoration:'none',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                      {h.title}
                                    </a>
                                  ) : (
                                    <span style={{fontSize:11,color:'#94A3B8',lineHeight:1.4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block'}}>{h.title}</span>
                                  )}
                                  <span style={{fontSize:9,color:'#334155'}}>{h.source}{h.date?' · '+new Date(h.date).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):''}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {s.alphaCount === 0 && (
                            <div style={{marginTop:8,padding:'6px 8px',backgroundColor:'#F59E0B08',border:'1px solid #F59E0B20',borderRadius:5}}>
                              <span style={{fontSize:9,color:'#F59E0B'}}>💡 To extract signals: paste the earnings call transcript in "📝 Paste Concall" above → instant signal extraction.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* No articles at all — explain why and what to do */}
                      {s.articleCount === 0 && (
                        <div style={{marginBottom:14,padding:'10px 12px',backgroundColor:'#060E1A',border:'1px solid #1A2840',borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:800,color:'#334155',marginBottom:6}}>📭 NO NEWS FOUND IN LAST 30 DAYS</div>
                          <div style={{fontSize:10,color:'#475569',lineHeight:1.6}}>
                            No articles matching <strong style={{color:'#64748B'}}>{s.company}</strong> in the news database.
                            This can happen when: (1) the company uses a different name in press coverage,
                            (2) no significant news in 30 days, or (3) stock is too small for mainstream coverage.
                          </div>
                          <div style={{marginTop:8,padding:'6px 8px',backgroundColor:'#0F7ABF08',border:'1px solid #0F7ABF20',borderRadius:5}}>
                            <span style={{fontSize:9,color:'#0F7ABF'}}>💡 Use "📝 Paste Concall" above to directly paste earnings call highlights for this company.</span>
                          </div>
                        </div>
                      )}

                      {/* ── SIGNAL STACK (composite across articles) ── */}
                      {(s as any).composite && (s as any).composite.length > 0 && (
                        <div style={{marginBottom:14,padding:'12px 14px',backgroundColor:'#0A0F1A',border:'1px solid #8B5CF620',borderRadius:8}}>
                          <div style={{fontSize:10,fontWeight:800,color:ACCENT2,letterSpacing:'1px',marginBottom:8}}>📊 SIGNAL STACK — composite view across all articles</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {(s as any).composite.map((c: CompositeSignal, ci: number) => {
                              const dc = c.direction==='UP'?'#10b981':c.direction==='DOWN'?'#ef4444':'#f59e0b';
                              return (
                                <div key={ci} style={{padding:'6px 10px',backgroundColor:dc+'10',border:`1px solid ${dc}30`,borderRadius:6,minWidth:90}}>
                                  <div style={{fontSize:10,fontWeight:700,color:dc}}>{c.direction==='UP'?'↑':c.direction==='DOWN'?'↓':'→'} {c.label}</div>
                                  <div style={{fontSize:8,color:'#4A5B6C'}}>{c.count} signal{c.count!==1?'s':''} · str:{c.strength}/5</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ── WHY IT MATTERS ── */}
                      {(s as any).whyItMatters && (
                        <div style={{marginBottom:14,padding:'10px 14px',backgroundColor:'#F59E0B08',border:'1px solid #F59E0B20',borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:800,color:'#F59E0B',marginBottom:4}}>💡 WHY THIS MATTERS FOR YOUR POSITION</div>
                          <div style={{fontSize:11,color:'#C9D4E0',lineHeight:1.5}}>{(s as any).whyItMatters}</div>
                        </div>
                      )}

                      {/* ── MISSED BY MARKET ── */}
                      {(s as any).missedByMarket && (
                        <div style={{marginBottom:14,padding:'10px 14px',backgroundColor:'#8B5CF608',border:'1px solid #8B5CF630',borderRadius:8}}>
                          <div style={{fontSize:10,fontWeight:800,color:'#8B5CF6',marginBottom:4}}>🔍 POTENTIALLY MISSED BY MARKET</div>
                          <div style={{fontSize:11,color:'#8A95A3'}}>Strong alpha signals ({s.alphaCount}) found but only {s.articleCount} article(s) — low coverage suggests market hasn't fully priced this yet. Verify independently before acting.</div>
                        </div>
                      )}

                      {/* Alpha signals — split by origin: COMPANY vs SECTOR */}
                      {s.signals.filter(sig=>sig.isAlpha).length > 0 && (
                        <div style={{marginBottom:12}}>
                          {/* Company-specific signals */}
                          {s.signals.filter(sig=>sig.isAlpha&&sig.origin==='COMPANY').length > 0 && (
                            <div style={{marginBottom:10}}>
                              <div style={{fontSize:10,fontWeight:800,color:'#10b981',letterSpacing:'1px',marginBottom:6}}>🏢 COMPANY SIGNALS — confirmed for {s.symbol}</div>
                              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                {s.signals.filter(sig=>sig.isAlpha&&sig.origin==='COMPANY').map((sig,i)=>(
                                  <SignalCard key={i} sig={sig} horizonColor={horizonColor} />
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Sector signals */}
                          {s.signals.filter(sig=>sig.isAlpha&&sig.origin==='SECTOR').length > 0 && (
                            <div style={{marginBottom:10}}>
                              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                                <div style={{fontSize:10,fontWeight:800,color:'#06b6d4',letterSpacing:'1px'}}>🌍 SECTOR CONTEXT — does NOT affect score</div>
                                <span style={{fontSize:9,color:'#4A5B6C',border:'1px solid #1A2840',padding:'1px 6px',borderRadius:3}}>Informational only</span>
                              </div>
                              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                {s.signals.filter(sig=>sig.isAlpha&&sig.origin==='SECTOR').map((sig,i)=>{
                                  const sd = (sig as any).sectorDef as (SectorSignalDef|undefined);
                                  return (
                                    <div key={i} style={{padding:'10px 12px',backgroundColor:'#06b6d408',border:'1px solid #06b6d420',borderLeft:'3px solid #06b6d4',borderRadius:7}}>
                                      <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:4,flexWrap:'wrap'}}>
                                        <span style={{fontSize:11,fontWeight:800,color:'#06b6d4'}}>🌍 {sig.subject}</span>
                                        {sd && <span style={{fontSize:9,color:'#4A5B6C',fontStyle:'italic'}}>driven by: {sd.driver}</span>}
                                        <span style={{fontSize:8,color:'#4A5B6C',marginLeft:'auto'}}>{sig.date?new Date(sig.date).toLocaleDateString('en-IN'):''}</span>
                                      </div>
                                      {sd && <div style={{fontSize:10,color:'#0F7ABF',marginBottom:4}}>→ {sd.impact}</div>}
                                      {sig.text && sig.text.length >= 15 ? (
                                        <div style={{fontSize:11,color:'#8A95A3',lineHeight:1.5,backgroundColor:'#060E1A',padding:'5px 9px',borderRadius:5,borderLeft:'2px solid #06b6d430',marginBottom:3}}>
                                          "{sig.text}"
                                        </div>
                                      ) : (
                                        <div style={{fontSize:10,color:'#F59E0B'}}>⚠ No direct evidence — sector inference only</div>
                                      )}
                                      <div style={{fontSize:9,color:'#4A5B6C'}}>📰 {sig.source}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {/* Negative alpha */}
                          {s.signals.filter(sig=>sig.isAlpha&&!sig.positive).length > 0 && (
                            <div>
                              <div style={{fontSize:10,fontWeight:800,color:'#ef4444',letterSpacing:'1px',marginBottom:6}}>⚠ RISK SIGNALS</div>
                              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                {s.signals.filter(sig=>sig.isAlpha&&!sig.positive).map((sig,i)=>(
                                  <SignalCard key={i} sig={sig} horizonColor={horizonColor} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {/* Noise signals */}
                      {s.signals.filter(sig=>!sig.isAlpha).length > 0 && (
                        <div>
                          <div style={{fontSize:10,fontWeight:800,color:TEXT3,letterSpacing:'1px',marginBottom:6}}>📰 NOISE SIGNALS — 1-5D relevance only</div>
                          <div style={{display:'flex',flexDirection:'column',gap:4}}>
                            {s.signals.filter(sig=>!sig.isAlpha).map((sig,i)=>(
                              <div key={i} style={{padding:'7px 10px',backgroundColor:'#1A2840',borderRadius:6,fontSize:10,color:'#8A95A3'}}>
                                <span style={{fontWeight:600,color:sig.positive?'#10b981':'#ef4444'}}>{sig.type.replace(/_/g,' ')}</span>: {sig.text.slice(0,80)}...
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {summaries.length === 0 && !loading && (
        <div style={{textAlign:'center',padding:'40px 20px',color:TEXT3}}>
          <div style={{fontSize:30,marginBottom:8}}>🔍</div>
          <div style={{fontSize:13,fontWeight:600,color:TEXT1,marginBottom:6}}>No management signals found in last 30 days</div>
          <div style={{fontSize:11,color:TEXT3}}>Your screener stocks have {screenerStocks.length} companies loaded. Try refreshing or check back after earnings season.</div>
        </div>
      )}
    </div>
  );
}

export default function CompanyIntelligencePage() {
  const [mainTab, setMainTab] = useState<'intelligence'|'concall'>('intelligence');
  const [top3, setTop3] = useState<Signal[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trends, setTrends] = useState<CompanyTrend[]>([]);
  const [expandedTrends, setExpandedTrends] = useState<Set<string>>(new Set());
  const [bias, setBias] = useState<DailyBias | null>(null);
  const [stats, setStats] = useState<any>(null);
  // FIX: Only show loading spinner on first ever load (no cache).
  // On tab switch, the module-level _cache persists — restore silently.
  const [loading, setLoading] = useState(() => _cache === null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [daysFilter, setDaysFilter] = useState(7);
  const [typeFilter, setTypeFilter] = useState<FilterType>('ALL');
  const [universeFilter, setUniverseFilter] = useState<UniverseFilter>('ALL');
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [isStale, setIsStale] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [watchlistFlags, setWatchlistFlags] = useState<Record<string, string>>({});
  const [addedPrices, setAddedPrices] = useState<Record<string, number>>({});
  const [computing, setComputing] = useState(false);
  const [computePollCount, setComputePollCount] = useState(0);
  const [showNoise, setShowNoise] = useState(false);
  const [noHighConfSignals, setNoHighConfSignals] = useState(false);
  const [noActionableSignals, setNoActionableSignals] = useState(false);
  const [monitorList, setMonitorList] = useState<Signal[]>([]);
  const [notableSignals, setNotableSignals] = useState<Signal[]>([]);
  const [thematicIdeas, setThematicIdeas] = useState<ThematicIdea[]>([]);
  const [speculativeSignals, setSpeculativeSignals] = useState<Signal[]>([]);
  const [quietMarket, setQuietMarket] = useState(false);
  const [productionStatus, setProductionStatus] = useState<string>('');

  // ── Excel News Digest — news articles for Excel picks with no corporate signals ──
  // When Excel stocks have no M&A / order events, this provides news coverage
  type ExcelNewsItem = { symbol: string; company: string; headline: string; published: string; sentiment: string };
  const [excelNewsDigest, setExcelNewsDigest] = useState<ExcelNewsItem[]>([]);
  const [excelNewsLoading, setExcelNewsLoading] = useState(false);

  const fetchData = useCallback(async (forceRefresh = false) => {
    // Read Excel scored stocks from Multibagger engine (mb_excel_scored_v2 in localStorage)
    // Done here (before cache check) so tagging works even on cache hits
    let _excelSymbols: string[] = [];
    try {
      const raw = localStorage.getItem('mb_excel_scored_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          _excelSymbols = parsed
            .map((r: any) => (r.symbol || '').toString().trim().toUpperCase())
            .filter(Boolean);
        }
      }
    } catch {}
    const _excelSet = new Set(_excelSymbols);
    // Generic tagger — works for Signal[], CompanyTrend[], ThematicIdea[], or any {symbol:string}[]
    const _tagExcel = <T extends { symbol: string }>(arr: T[]): T[] => arr.map(s =>
      _excelSet.has((s.symbol || '').toString().trim().toUpperCase())
        ? { ...s, isExcel: true } : s
    );

    // Tab cache: if data was fetched recently and not forcing refresh, use cached data
    if (!forceRefresh && _cache && _cache.daysFilter === daysFilter && (Date.now() - _cache.timestamp) < CACHE_TTL) {
      const data = _cache.data;
      setTop3(_tagExcel(data.top3 || []));
      setSignals(_tagExcel(data.signals || []));
      setNotableSignals(_filterGovNoise(_tagExcel(data.notable || [])));
      setSpeculativeSignals(_tagExcel(data.speculative || []));
      setQuietMarket(!!data.quietMarket);
      setThematicIdeas(_tagExcel(data.thematicIdeas || []));
      setTrends(_tagExcel(data.trends || []));
      setBias(data.bias || null);
      setStats(data._stats || null);
      if (data.debug) setDebugInfo(data.debug);
      if (data.flags) setWatchlistFlags(data.flags);
      if (data.addedPrices) setAddedPrices(data.addedPrices);
      setIsStale(!!data.stale);
      setLastUpdated(data.lastUpdated || '');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let watchlist: string[] = [];
      let portfolio: string[] = [];

      // Fetch portfolio
      try {
        const pRes = await fetch(`/api/portfolio?chatId=${CHAT_ID}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          portfolio = (pData.holdings || []).map((h: any) => h.symbol);
        }
      } catch {}

      // Fetch watchlist + flags + prices
      let flags: Record<string, string> = {};
      let prices: Record<string, number> = {};
      try {
        const wlRes = await fetch(`/api/watchlist?chatId=${CHAT_ID}`);
        const wlData = await wlRes.json();
        if (wlData.watchlist?.length) {
          watchlist = wlData.watchlist;
          localStorage.setItem('mc_watchlist_tickers', JSON.stringify(watchlist));
        }
        if (wlData.flags) { flags = wlData.flags; setWatchlistFlags(flags); }
        if (wlData.addedPrices) { prices = wlData.addedPrices; setAddedPrices(prices); }
      } catch {
        const s = localStorage.getItem('mc_watchlist_tickers') || '[]';
        watchlist = JSON.parse(s);
      }

      // ── KEY FIX: merge Excel symbols into the portfolio param ──────────────────
      // The backend ONLY enriches tickers from &portfolio= and &watchlist=.
      // &excel= was silently ignored. By merging Excel symbols into &portfolio=,
      // the backend will actually look up corporate events / signals for them.
      // We then re-tag client-side so portfolio/watchlist/excel flags stay accurate.
      // Cap at 80 symbols total (top-scored first) to stay within URL limits.
      const portfolioSet  = new Set(portfolio.map(s => s.toUpperCase()));
      const watchlistSet  = new Set(watchlist.map(s => s.toUpperCase()));
      // Excel-only = in Excel but not already in portfolio or watchlist
      const excelOnlySymbols = _excelSymbols
        .filter(s => !portfolioSet.has(s) && !watchlistSet.has(s))
        .slice(0, Math.max(0, 80 - portfolio.length - watchlist.length));

      // Merged portfolio = real portfolio + excel-only symbols (backend enriches all)
      const mergedPortfolio = [...portfolio, ...excelOnlySymbols];

      // Full re-tagger: correctly sets all three flags based on original sets
      const _retag = <T extends { symbol: string }>(arr: T[]): T[] => arr.map(s => {
        const sym = (s.symbol || '').toString().trim().toUpperCase();
        return {
          ...s,
          isPortfolio: portfolioSet.has(sym),
          isWatchlist: watchlistSet.has(sym),
          isExcel: _excelSet.has(sym),
        };
      });

      const wlParam = watchlist.length > 0 ? `&watchlist=${watchlist.join(',')}` : '';
      const pfParam = mergedPortfolio.length > 0 ? `&portfolio=${mergedPortfolio.join(',')}` : '';
      const res = await fetch(`/api/market/intelligence?days=${daysFilter}${wlParam}${pfParam}&debug=true`);
      const data = await res.json();

      setTop3(_retag(data.top3 || []));
      setSignals(_retag(data.signals || []));
      setNotableSignals(_filterGovNoise(_retag(data.notable || [])));
      setSpeculativeSignals(_retag(data.speculative || []));
      setQuietMarket(!!data.quietMarket);
      setThematicIdeas(_retag(data.thematicIdeas || []));
      setTrends(_retag(data.trends || []));
      setBias(data.bias || null);
      setStats(data._stats || null);
      setNoHighConfSignals(!!data.noHighConfSignals);
      setNoActionableSignals(!!data.noActionableSignals);
      setMonitorList(_filterGovNoise(_tagExcel(data.observations || [])));
      const statsLine = data._stats ?
        `${data._stats.actionable || 0} actionable · ${data._stats.notable || 0} notable · ${data._stats.monitor || 0} monitor · ${data._stats.speculative || 0} speculative · ${data._stats.rejected || 0} rejected` : '';
      const filterLine = data._meta?.filterRange ? ` · Filter: ${data._meta.filterRange} (${data._meta.totalSignalsBefore ?? '?'}→${data._meta.totalSignalsDateFiltered ?? data._meta.totalSignalsBefore ?? '?'}→${data._meta.totalSignalsAfter ?? '?'})` : '';
      setProductionStatus(statsLine + filterLine || (data._productionStatus || ''));
      if (data.debug) setDebugInfo(data.debug);
      setIsStale(!!data.stale);
      const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      setLastUpdated(ts);

      // Detect computing state
      const isComputing = data._meta?.computing === true || data._meta?.source === 'skeleton';
      setComputing(isComputing);
      if (!isComputing) setComputePollCount(0);

      // Cache retagged data so cache hits preserve correct portfolio/watchlist/excel flags
      if (!isComputing) {
        _cache = { data: {
          ...data,
          signals:       _retag(data.signals        || []),
          notable:       _retag(data.notable        || []),
          speculative:   _retag(data.speculative    || []),
          thematicIdeas: _retag(data.thematicIdeas  || []),
          trends:        _retag(data.trends         || []),
          top3:          _retag(data.top3           || []),
          flags, addedPrices: prices, lastUpdated: ts,
        }, timestamp: Date.now(), daysFilter };
      }
      // ── Excel News Digest — fetch news for Excel picks with NO corporate signals ──
      // Corporate events (M&A, orders) only exist for ~20% of stocks in any period.
      // For the remaining 80%, use news articles as the monitoring signal.
      try {
        const coveredByIntelligence = new Set<string>();
        [..._retag(data.signals||[]) as Signal[], ..._retag(data.notable||[]) as Signal[], ..._retag(data.trends||[]) as CompanyTrend[]]
          .filter((s: any) => s.isExcel)
          .forEach((s: any) => coveredByIntelligence.add((s.symbol||'').toUpperCase()));

        const uncoveredExcel = _excelSymbols
          .filter(s => !coveredByIntelligence.has(s))
          .slice(0, 40); // cap at 40 to keep URL size manageable

        if (uncoveredExcel.length > 0) {
          setExcelNewsLoading(true);
          // Fetch news for all uncovered Excel tickers in one call using | search
          const searchQuery = uncoveredExcel.join('|');
          const newsRes = await fetch(
            `${(typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) || '/api/v1'}/news?limit=200&importance_min=1&search=${encodeURIComponent(searchQuery)}`
          );
          if (newsRes.ok) {
            const newsData = await newsRes.json();
            const articles: any[] = Array.isArray(newsData) ? newsData : [];

            // Match articles to Excel symbols
            const digestItems: ExcelNewsItem[] = [];
            const seenSymbols = new Set<string>();

            for (const sym of uncoveredExcel) {
              const symLower = sym.toLowerCase();
              // Find the most recent article mentioning this ticker
              const match = articles.find(a => {
                const tickers: string[] = (a.ticker_symbols || []).map((t: string) =>
                  t.toUpperCase().replace(/\.NS$|\.BO$/i, ''));
                if (tickers.some(t => t === sym || t.startsWith(sym.slice(0, 5)))) return true;
                const text = ((a.title||'') + ' ' + (a.headline||'')).toLowerCase();
                return text.includes(symLower);
              });

              if (match && !seenSymbols.has(sym)) {
                seenSymbols.add(sym);
                const text = (match.title || match.headline || '').toLowerCase();
                const sentiment = ['raised','upgrade','beat','record','growth','order','win','expand'].some(w => text.includes(w)) ? 'Bullish'
                  : ['miss','cut','loss','warn','decline','fall'].some(w => text.includes(w)) ? 'Bearish' : 'Neutral';
                // Get company name from Excel data
                const excelEntry = (() => { try { return (JSON.parse(localStorage.getItem('mb_excel_scored_v2')||'[]') as any[]).find(r => (r.symbol||'').toUpperCase() === sym); } catch { return null; } })();
                digestItems.push({
                  symbol: sym,
                  company: excelEntry?.company || sym,
                  headline: match.title || match.headline || '',
                  published: match.published_at || '',
                  sentiment,
                });
              }
            }
            setExcelNewsDigest(digestItems);
          }
          setExcelNewsLoading(false);
        }
      } catch (e) {
        setExcelNewsLoading(false);
      }

    } catch (err) {
      console.error('[Intelligence] Error:', err);
    }
    setLoading(false);
  }, [daysFilter]);

  // FIX: "I will click Refresh when I need new data."
  // Only fetch automatically in two cases:
  //   1. First ever load (no cache at all)
  //   2. daysFilter changed (user explicitly changed the time window)
  // Never auto-fetch on every tab switch — that's the core complaint.
  useEffect(() => {
    if (_cache === null) {
      // First load: no data at all, must fetch
      fetchData();
    } else if (_cache.daysFilter !== daysFilter) {
      // User changed day filter — need fresh data for new filter
      fetchData();
    } else {
      // Cache exists for this filter: restore from it silently, no loading spinner
      fetchData(false); // fetchData(false) hits cache path → sets loading=false immediately
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysFilter]); // Only reruns when daysFilter changes, not on every tab switch

  // Keep computing poll — needed for background compute jobs
  useEffect(() => {
    if (!computing) return;
    if (computePollCount >= 15) return;
    const timer = setTimeout(() => {
      setComputePollCount(p => p + 1);
      fetchData(true);
    }, 20000);
    return () => clearTimeout(timer);
  }, [computing, computePollCount, fetchData]);
  // REMOVED: 2-min auto-refresh interval — user controls refresh manually

  // Toggle watchlist flag (Green → Orange → Red → None → Green...)
  const toggleFlag = useCallback(async (symbol: string) => {
    const current = watchlistFlags[symbol] || null;
    const cycle: (string | null)[] = [null, 'GREEN', 'ORANGE', 'RED'];
    const nextIdx = (cycle.indexOf(current) + 1) % cycle.length;
    const nextFlag = cycle[nextIdx];
    setWatchlistFlags(prev => {
      const updated = { ...prev };
      if (nextFlag) updated[symbol] = nextFlag;
      else delete updated[symbol];
      return updated;
    });
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: CHAT_ID, action: 'set-flag', symbol, flag: nextFlag }),
      });
    } catch {}
  }, [watchlistFlags]);

  const flagColors: Record<string, string> = { GREEN: '#10B981', ORANGE: '#F97316', RED: '#EF4444' };
  const flagEmoji: Record<string, string> = { GREEN: '🟢', ORANGE: '🟠', RED: '🔴' };

  // Filter signals
  const filteredSignals = useMemo(() => {
    let list = signals;
    // Universe filter
    if (universeFilter === 'PORTFOLIO') list = list.filter(s => s.isPortfolio);
    if (universeFilter === 'WATCHLIST') list = list.filter(s => s.isWatchlist);
    if (universeFilter === 'EXCEL')     list = list.filter(s => s.isExcel);
    // Type filter
    if (typeFilter === 'BUY') list = list.filter(s => s.action === 'BUY');
    if (typeFilter === 'ADD') list = list.filter(s => s.action === 'ADD');
    if (typeFilter === 'HOLD') list = list.filter(s => s.action === 'HOLD');
    if (typeFilter === 'WATCH') list = list.filter(s => s.action === 'WATCH');
    if (typeFilter === 'TRIM') list = list.filter(s => s.action === 'TRIM' || s.action === 'EXIT');
    if (typeFilter === 'ORDERS') list = list.filter(s => ['Order Win', 'Contract', 'LOI'].includes(s.eventType));
    if (typeFilter === 'CAPEX') list = list.filter(s => ['Capex/Expansion', 'Fund Raising', 'Guidance'].includes(s.eventType));
    if (typeFilter === 'DEALS') list = list.filter(s => s.source === 'deal');
    if (typeFilter === 'STRATEGIC') list = list.filter(s => ['M&A', 'Demerger', 'JV/Partnership', 'Buyback'].includes(s.eventType));
    if (typeFilter === 'NEGATIVE') list = list.filter(s => s.isNegative);
    if (typeFilter === 'HIGH_IMPACT') list = list.filter(s => s.impactLevel === 'HIGH');
    if (typeFilter === 'NOTABLE') list = list.filter(s => s.signalTierV7 === 'NOTABLE');
    // Hide Mgmt Change / GOVERNANCE signals — not useful for portfolio decisions
    list = list.filter(s => {
      const et = (s.eventType || '').toLowerCase();
      const sc = (s.signalClass || '').toLowerCase();
      if (et === 'mgmt change' || et === 'board appointment' || et === 'board meeting') return false;
      if (sc === 'governance' && (et.includes('change') || et.includes('appointment') || et.includes('board'))) return false;
      return true;
    });
    // Noise filter — filter out NOISE classification by default unless showNoise is true
    // ALWAYS show results for NEGATIVE and TRIM filters (risk signals should never be hidden)
    if (!showNoise && typeFilter !== 'NEGATIVE' && typeFilter !== 'TRIM') list = list.filter(s => s.scoreClassification !== 'NOISE');
    // Hide TIER_D (template/auto-suppressed) signals by default unless showNoise is enabled
    if (!showNoise) list = list.filter(s => s.visibility !== 'HIDDEN');
    return list;
  }, [signals, typeFilter, universeFilter, showNoise]);

  // Stats
  const buySignals = signals.filter(s => s.action === 'BUY');
  const addSignals = signals.filter(s => s.action === 'ADD');
  const holdSignals = signals.filter(s => s.action === 'HOLD');
  const watchSignals = signals.filter(s => s.action === 'WATCH');
  const trimSignals = signals.filter(s => s.action === 'TRIM' || s.action === 'EXIT');
  const negativeCount = signals.filter(s => s.isNegative).length;
  const portfolioCount = signals.filter(s => s.isPortfolio).length;
  const watchlistCount = signals.filter(s => s.isWatchlist).length;
  // Count unique Excel-tagged symbols across ALL signal arrays
  const excelSymbolsSeen = new Set<string>();
  [...signals, ...notableSignals, ...speculativeSignals, ...monitorList].forEach(s => {
    if (s.isExcel) excelSymbolsSeen.add(s.symbol);
  });
  trends.forEach(t => { if (t.isExcel) excelSymbolsSeen.add(t.symbol); });
  const excelCount = excelSymbolsSeen.size;
  const totalSignalValue = signals.filter(s => s.valueCr > 0).reduce((sum, s) => sum + s.valueCr, 0);

  // ── #20: Cross-universe overlap — stocks appearing in 2+ tracked universes ──
  // A signal in Portfolio AND Watchlist AND Excel = highest conviction zone
  const allTaggedSignals = [...signals, ...notableSignals];
  const overlapMap = new Map<string, { signal: Signal; universes: string[] }>();
  for (const s of allTaggedSignals) {
    const universes: string[] = [];
    if (s.isPortfolio) universes.push('Portfolio');
    if (s.isWatchlist) universes.push('Watchlist');
    if (s.isExcel)     universes.push('Excel Picks');
    if (universes.length >= 2 && !overlapMap.has(s.symbol)) {
      overlapMap.set(s.symbol, { signal: s, universes });
    }
  }
  const overlapSignals = [...overlapMap.values()].sort((a, b) => (b.signal.weightedScore || 0) - (a.signal.weightedScore || 0));

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={22} color={ACCENT} />
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: TEXT1 }}>Company Intelligence</h1>
            <p style={{ fontSize: '11px', color: TEXT3, margin: 0 }}>
              Materiality-ranked · Confidence-scored · Evidence-tiered · Deduped
              {computing && <span style={{ marginLeft: '8px', color: ACCENT }}>⟳ Computing...</span>}
            </p>
            {/* Main tabs */}
            <div style={{ display: 'flex', gap: 0, marginTop: 8 }}>
              {([
                { id: 'intelligence' as const, label: '📡 Signals', color: ACCENT },
                { id: 'concall' as const, label: '🧠 Concall Intel', color: '#a78bfa' },
              ]).map(tab => (
                <button key={tab.id} onClick={() => setMainTab(tab.id)} style={{
                  padding: '6px 16px', border: 'none', cursor: 'pointer', background: 'transparent',
                  fontSize: 12, fontWeight: mainTab === tab.id ? 700 : 400,
                  color: mainTab === tab.id ? tab.color : TEXT3,
                  borderBottom: `2px solid ${mainTab === tab.id ? tab.color : 'transparent'}`,
                  transition: 'all 0.15s',
                }}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {[3, 7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDaysFilter(d)} style={{
              padding: '4px 10px', borderRadius: '5px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${daysFilter === d ? ACCENT : BORDER}`,
              background: daysFilter === d ? 'rgba(15,122,191,0.15)' : 'transparent',
              color: daysFilter === d ? ACCENT : TEXT3,
            }}>{d}D</button>
          ))}
          <button onClick={() => fetchData(true)} style={{
            background: 'none', border: `1px solid ${BORDER}`, borderRadius: '5px',
            padding: '4px 8px', cursor: 'pointer', color: TEXT3,
          }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {lastUpdated && <span style={{ fontSize: '11px', color: TEXT3 }}>{lastUpdated}</span>}

          {/* Export to XLSX — all visible filtered signals */}
          <button
            onClick={async () => {
              if (!filteredSignals.length) return;
              const XLSX = await import('xlsx');
              const rows = filteredSignals.map(s => ({
                Symbol:       s.symbol,
                Company:      s.company,
                Date:         s.date,
                Action:       s.action,
                Score:        s.score,
                'Wtd Score':  s.weightedScore,
                Sentiment:    s.sentiment,
                Impact:       s.impactLevel,
                Confidence:   s.impactConfidence,
                'Event Type': s.eventType,
                'Value (Cr)': s.valueCr || '',
                Headline:     s.headline,
                Source:       s.dataSource || s.source,
                Portfolio:    s.isPortfolio ? 'Yes' : '',
                Watchlist:    s.isWatchlist ? 'Yes' : '',
                'Excel Pick': s.isExcel    ? 'Yes' : '',
              }));
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Intelligence');
              XLSX.writeFile(wb, `intelligence-${new Date().toISOString().slice(0,10)}.xlsx`);
            }}
            title="Export visible signals to Excel"
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: 'none', border: `1px solid ${BORDER}`, borderRadius: '5px',
              padding: '4px 10px', cursor: filteredSignals.length ? 'pointer' : 'not-allowed',
              color: filteredSignals.length ? '#10b981' : TEXT3, fontSize: '11px', fontWeight: 600,
              opacity: filteredSignals.length ? 1 : 0.4,
            }}
          >
            ↓ XLSX ({filteredSignals.length})
          </button>
        </div>
      </div>

      {/* ── CONCALL INTELLIGENCE TAB ── */}
      {mainTab === 'concall' && <ConcallIntelligence />}

      {mainTab === 'intelligence' && <>
      {/* ── SCORING LEGEND (inline, compact) ── */}
      <div style={{
        display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center',
        padding: '4px 14px', marginBottom: '8px', fontSize: '9px', color: TEXT3,
      }}>
        <span>Materiality: <span style={{ color: GREEN }}>■75+</span> <span style={{ color: '#3B82F6' }}>■60</span> <span style={{ color: '#F59E0B' }}>■45</span> <span style={{ color: TEXT3 }}>■&lt;45</span></span>
        <span>Conf: <span style={{ color: GREEN }}>70+</span> <span style={{ color: YELLOW }}>50+</span> <span style={{ color: ORANGE }}>&lt;50</span></span>
        <span>Evidence: <span style={{ color: '#059669' }}>A</span>=Filed <span style={{ color: '#D97706' }}>B</span>=Likely <span style={{ color: '#DC2626' }}>C</span>=Probable <span style={{ color: '#6B7280' }}>D</span>=Weak</span>
        <span><span style={{ color: PURPLE }}>PF</span>=Portfolio <span style={{ color: ACCENT }}>WL</span>=Watchlist <span style={{ color: '#F59E0B' }}>EST</span>=Estimated</span>
      </div>

      {/* ── DAILY DECISION SUMMARY ── */}
      {bias && (
        <div style={{
          backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '10px',
          padding: '14px 18px', marginBottom: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px', color: biasColor(bias.netBias),
                fontSize: '16px', fontWeight: 700,
              }}>
                {biasIcon(bias.netBias)}
                Market Bias: {bias.netBias}
              </div>
            </div>

            {/* Decision-ready stats */}
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              {[
                { label: 'High Impact', value: bias.highImpactCount, color: GREEN, filter: 'HIGH_IMPACT' as FilterType | null },
                { label: 'Actionable', value: stats?.actionable ?? bias.buyCount ?? 0, color: GREEN, filter: 'BUY' as FilterType | null },
                { label: 'Notable', value: stats?.notable ?? notableSignals.length ?? 0, color: '#3B82F6', filter: 'NOTABLE' as FilterType | null },
                { label: 'Monitor', value: (stats?.monitor ?? 0) + (stats?.notable ?? 0), color: ACCENT, filter: 'HOLD' as FilterType | null },
                ...(bias.watchCount !== undefined && bias.watchCount > 0 ? [{ label: 'Monitor', value: bias.watchCount, color: '#A78BFA', filter: 'WATCH' as FilterType | null }] : []),
                ...(bias.trimExitCount !== undefined && bias.trimExitCount > 0 ? [{ label: 'Reduce/Exit', value: bias.trimExitCount, color: ORANGE, filter: 'TRIM' as FilterType | null }] : []),
                { label: 'Portfolio Alerts', value: bias.portfolioAlerts, color: PURPLE, filter: null as FilterType | null },
                ...(bias.negativeSignals > 0 ? [{ label: '⚠ Negative', value: bias.negativeSignals, color: RED, filter: 'NEGATIVE' as FilterType | null }] : []),
                ...(totalSignalValue > 0 ? [{ label: 'Signal Value (est.)', value: fmtCr(totalSignalValue) as any, color: CYAN, filter: null as FilterType | null }] : []),
              ].map(s => (
                <div key={s.label}
                  onClick={() => s.filter && setTypeFilter(s.filter === typeFilter ? 'ALL' : s.filter)}
                  style={{
                    textAlign: 'center',
                    cursor: s.filter ? 'pointer' : 'default',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    backgroundColor: s.filter && s.filter === typeFilter ? `${s.color}20` : 'transparent',
                    border: s.filter && s.filter === typeFilter ? `1px solid ${s.color}40` : '1px solid transparent',
                    transition: 'all 0.15s ease',
                  }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '10px', color: TEXT3 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Summary text */}
          <div style={{ marginTop: '8px', fontSize: '12px', color: TEXT2, lineHeight: 1.5 }}>
            {bias.summary}
          </div>

          {bias.activeSectors.length > 0 && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: TEXT3 }}>Active:</span>
              {bias.activeSectors.map((s, i) => (
                <span key={i} style={{
                  fontSize: '11px', color: ACCENT, padding: '1px 7px',
                  borderRadius: '4px', backgroundColor: 'rgba(15,122,191,0.1)',
                  border: `1px solid rgba(15,122,191,0.2)`,
                }}>{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── STALE DATA WARNING ── */}
      {isStale && (
        <div style={{
          backgroundColor: 'rgba(255,152,0,0.08)', border: '1px solid rgba(255,152,0,0.3)', borderRadius: '8px',
          padding: '10px 14px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ fontSize: '16px' }}>⚠️</span>
          <span style={{ fontSize: '12px', color: '#FFB74D' }}>
            Showing cached signals — live data sources unavailable. Scores may be decayed.
          </span>
        </div>
      )}

      {/* ── DEBUG PANEL ── */}
      {debugInfo && (
        <div style={{ marginBottom: '12px' }}>
          <button onClick={() => setShowDebug(!showDebug)} style={{
            fontSize: '11px', color: TEXT3, background: 'none', border: 'none', cursor: 'pointer',
            textDecoration: 'underline', padding: 0,
          }}>
            {showDebug ? 'Hide' : 'Show'} Data Sources
          </button>
          {showDebug && (
            <div style={{
              backgroundColor: 'rgba(15,122,191,0.05)', border: `1px solid ${BORDER}`, borderRadius: '8px',
              padding: '10px 14px', marginTop: '6px', fontSize: '11px', color: TEXT2, lineHeight: 1.6,
            }}>
              <div><strong style={{ color: TEXT1 }}>Sources:</strong> {(debugInfo.dataSources || []).join(', ') || 'None'}</div>
              <div>NSE: {debugInfo.nseAnnouncements || 0} raw → {debugInfo.nseMaterial || 0} material | MC: {debugInfo.mcNewsItems || 0} → {debugInfo.mcMaterial || 0} | Google: {debugInfo.googleNewsItems || 0} → {debugInfo.googleMaterial || 0}</div>
              <div>Deals: {debugInfo.nseBlockDeals || 0} block, {debugInfo.nseBulkDeals || 0} bulk | Enriched: {debugInfo.enrichedSymbols || 0} symbols | Earnings cache: {debugInfo.earningsCacheHits || 0}</div>
              <div>Signals: {debugInfo.totalSignalsAfterDedup || 0} after dedup{debugInfo.cachedSignals > 0 ? ` | Cached: ${debugInfo.cachedSignals}` : ''}</div>
              {debugInfo.errors?.length > 0 && (
                <div style={{ color: '#FF8A80', marginTop: '4px' }}>{debugInfo.errors.join(' | ')}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SIGNAL PIPELINE STATUS BAR ── */}
      {productionStatus && !loading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 14px', marginBottom: '12px', borderRadius: '6px',
          backgroundColor: 'rgba(15,122,191,0.04)', border: `1px solid rgba(15,122,191,0.12)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', color: TEXT3, flexWrap: 'wrap' }}>
            <span style={{ color: ACCENT, fontWeight: 700 }}>PIPELINE</span>
            {productionStatus.split(' · ').map((part, i) => {
              const isHighlight = part.includes('actionable') || part.includes('notable');
              return (
                <span key={i} style={{ color: isHighlight ? TEXT2 : TEXT3, fontWeight: isHighlight ? 600 : 400 }}>
                  {part}
                </span>
              );
            })}
          </div>
          <div style={{ fontSize: '9px', color: TEXT3 }}>
            NSE · MoneyControl · Google
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && top3.length === 0 && (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <div style={{ width: '28px', height: '28px', border: '3px solid #1A2840', borderTopColor: ACCENT, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
          <p style={{ color: TEXT3, fontSize: '13px' }}>Scanning corporate announcements, block deals, bulk deals...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── #20: CROSS-UNIVERSE OVERLAP — highest conviction zone ── */}
      {overlapSignals.length > 0 && typeFilter === 'ALL' && universeFilter === 'ALL' && (
        <div style={{ marginBottom: '16px', padding: '14px 16px', backgroundColor: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.25)', borderLeft: '3px solid #8b5cf6', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#a78bfa', letterSpacing: '1px' }}>⭐ CROSS-UNIVERSE OVERLAP</span>
            <span style={{ fontSize: '11px', color: TEXT3 }}>Stocks with signals in 2+ tracked universes — highest conviction</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {overlapSignals.map(({ signal: s, universes }) => {
              const actionCol = s.action === 'BUY' || s.action === 'ADD' ? GREEN
                : s.action === 'TRIM' || s.action === 'EXIT' ? RED : YELLOW;
              return (
                <div key={s.symbol} style={{
                  padding: '8px 14px', backgroundColor: 'rgba(139,92,246,0.10)',
                  border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', minWidth: '160px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: TEXT1 }}>{s.symbol}</span>
                    <span style={{ fontSize: '9px', fontWeight: 700, color: actionCol, padding: '1px 5px', borderRadius: '3px', backgroundColor: `${actionCol}15` }}>{s.action}</span>
                  </div>
                  <div style={{ fontSize: '10px', color: TEXT3, marginBottom: '4px' }}>{s.company}</div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {universes.map(u => (
                      <span key={u} style={{ fontSize: '9px', fontWeight: 600, padding: '1px 6px', borderRadius: '10px',
                        backgroundColor: u === 'Portfolio' ? 'rgba(139,92,246,0.2)' : u === 'Watchlist' ? 'rgba(15,122,191,0.2)' : 'rgba(16,185,129,0.2)',
                        color: u === 'Portfolio' ? '#a78bfa' : u === 'Watchlist' ? '#38bdf8' : '#10b981',
                      }}>{u}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── EXCEL NEWS DIGEST — news coverage for Excel picks with no corporate signals ── */}
      {(excelNewsDigest.length > 0 || excelNewsLoading) && (universeFilter === 'ALL' || universeFilter === 'EXCEL') && typeFilter === 'ALL' && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#10b981', letterSpacing: '1px' }}>
              📊 EXCEL PICKS — NEWS MONITOR {excelNewsLoading ? '⏳' : `(${excelNewsDigest.length})`}
            </span>
            <span style={{ fontSize: '10px', color: TEXT3 }}>
              Excel stocks without corporate signals — recent news coverage
            </span>
          </div>
          {excelNewsLoading && (
            <div style={{ fontSize: '11px', color: TEXT3, padding: '8px 0' }}>Fetching news for uncovered Excel picks…</div>
          )}
          {!excelNewsLoading && excelNewsDigest.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {excelNewsDigest.map(item => {
                const sentColor = item.sentiment === 'Bullish' ? GREEN : item.sentiment === 'Bearish' ? RED : TEXT3;
                const relDate = item.published ? (() => {
                  const d = new Date(item.published);
                  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
                  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`;
                })() : '';
                return (
                  <div key={item.symbol} style={{
                    padding: '8px 12px', minWidth: '180px', maxWidth: '260px', flex: '1 1 200px',
                    backgroundColor: CARD, border: `1px solid ${sentColor}25`,
                    borderLeft: `3px solid ${sentColor}`, borderRadius: '8px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: TEXT1 }}>{item.symbol}</span>
                      <span style={{ fontSize: '9px', fontWeight: 700, color: sentColor, padding: '1px 5px', borderRadius: '3px', backgroundColor: `${sentColor}15` }}>{item.sentiment}</span>
                      {relDate && <span style={{ fontSize: '9px', color: TEXT3, marginLeft: 'auto' }}>{relDate}</span>}
                    </div>
                    <div style={{ fontSize: '10px', color: TEXT3, marginBottom: '4px' }}>{item.company}</div>
                    <div style={{ fontSize: '10px', color: TEXT2, lineHeight: 1.4,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.headline}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!excelNewsLoading && excelNewsDigest.length === 0 && !loading && (
            <div style={{ fontSize: '11px', color: TEXT3 }}>No recent news found for uncovered Excel picks in this period.</div>
          )}
        </div>
      )}

      {/* ── TREND LAYER (Signal Stacking) ── */}
      {trends.length > 0 && typeFilter === 'ALL' && (universeFilter === 'ALL' || universeFilter === 'PORTFOLIO' || universeFilter === 'WATCHLIST' || universeFilter === 'EXCEL') && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
            SIGNAL STACKING — MULTI-EVENT COMPANIES
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {trends
              .filter(t => universeFilter === 'PORTFOLIO' ? t.isPortfolio :
                           universeFilter === 'WATCHLIST'  ? t.isWatchlist  :
                           universeFilter === 'EXCEL'      ? t.isExcel      : true)
              .map(t => {
              const stackColor = t.stackLevel === 'STRONG' ? GREEN : t.stackLevel === 'BUILDING' ? YELLOW : TEXT3;
              const isExpanded = expandedTrends.has(t.symbol);
              return (
                <div key={t.symbol} style={{
                  backgroundColor: CARD, border: `1px solid ${stackColor}30`, borderLeft: `3px solid ${stackColor}`,
                  borderRadius: '8px', padding: '10px 14px', minWidth: '200px', cursor: 'pointer',
                  width: isExpanded ? '100%' : 'auto', transition: 'width 0.2s ease',
                }} onClick={() => {
                  setExpandedTrends(prev => {
                    const next = new Set(prev);
                    if (next.has(t.symbol)) next.delete(t.symbol); else next.add(t.symbol);
                    return next;
                  });
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '10px', color: TEXT3, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6' }}>{t.symbol}</span>
                    <span style={{
                      fontSize: '9px', fontWeight: 700, color: stackColor,
                      padding: '1px 5px', borderRadius: '3px', backgroundColor: `${stackColor}15`,
                    }}>{t.stackLevel}</span>
                    <span style={{
                      fontSize: '9px', fontWeight: 600, color: actionColor(remapActionLabel(t.topAction)),
                      padding: '1px 5px', borderRadius: '3px', backgroundColor: actionBg(remapActionLabel(t.topAction)),
                      textTransform: 'uppercase',
                    }}>{remapActionLabel(t.topAction)}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: TEXT2, marginBottom: '2px', textTransform: 'capitalize' }}>{t.company}</div>
                  <div style={{ display: 'flex', gap: '10px', fontSize: '10px' }}>
                    <span style={{ color: stackColor }}>{t.signalCount} signal{t.signalCount !== 1 ? 's' : ''} {isExpanded ? '▾' : '▸ tap to expand'}</span>
                    <span style={{ color: sentimentColor(t.netSentiment) }}>{t.netSentiment}</span>
                    <span style={{ color: impactColor(t.topImpact) }}>{t.topImpact}</span>
                    <span style={{ color: TEXT3 }}>Top: {t.maxScore ?? t.avgScore}</span>
                    <span style={{ color: TEXT3 }}>Avg: {t.avgScore}</span>
                  </div>

                  {/* ── Expanded: individual event details ── */}
                  {isExpanded && t.signals && t.signals.length > 0 && (
                    <div style={{ marginTop: '10px', borderTop: `1px solid ${stackColor}20`, paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {t.signals.map((sig, idx) => {
                        const sigSentColor = sig.sentiment === 'Bullish' ? GREEN : sig.sentiment === 'Bearish' ? RED : YELLOW;
                        const sigImpColor = sig.impactLevel === 'HIGH' ? RED : sig.impactLevel === 'MEDIUM' ? YELLOW : TEXT3;
                        return (
                          <div key={`${t.symbol}-sig-${idx}`} style={{
                            backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '6px', padding: '8px 10px',
                          }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
                              <span style={{
                                fontSize: '8px', fontWeight: 700, color: sigSentColor,
                                padding: '1px 4px', borderRadius: '3px', backgroundColor: `${sigSentColor}15`,
                                flexShrink: 0, marginTop: '2px',
                              }}>{sig.sentiment}</span>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: TEXT1, lineHeight: 1.3 }}>{sig.headline}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '9px', marginBottom: '4px' }}>
                              <span style={{ color: TEXT3 }}>{sig.date}</span>
                              <span style={{ color: TEXT3, textTransform: 'uppercase' }}>{sig.eventType}</span>
                              <span style={{ color: sigImpColor, fontWeight: 600 }}>{sig.impactLevel}</span>
                              <span style={{ color: sig.weightedScore >= 60 ? GREEN : sig.weightedScore >= 40 ? YELLOW : TEXT3 }}>Score: {sig.weightedScore}</span>
                              <span style={{ color: sig.confidenceScore >= 70 ? GREEN : sig.confidenceScore >= 50 ? YELLOW : TEXT3 }}>Conf: {sig.confidenceScore}</span>
                              {sig.valueCr > 0 && <span style={{ color: ACCENT }}>₹{sig.valueCr.toLocaleString('en-IN')} Cr</span>}
                              {sig.dataSource && <span style={{ color: TEXT3 }}>via {sig.dataSource}</span>}
                            </div>
                            {sig.whyItMatters && (
                              <div style={{ fontSize: '10px', color: TEXT2, lineHeight: 1.4, fontStyle: 'italic' }}>
                                {sig.whyItMatters}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {isExpanded && (!t.signals || t.signals.length === 0) && (
                    <div style={{ marginTop: '8px', fontSize: '10px', color: TEXT3, fontStyle: 'italic' }}>
                      Event details not available — signal data from older cache
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {noActionableSignals && !loading && typeFilter === 'ALL' && (
        <div style={{
          padding: '14px 18px', marginBottom: '16px', borderRadius: '10px',
          backgroundColor: 'rgba(15,122,191,0.04)',
          border: '1px solid rgba(15,122,191,0.12)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '8px',
              backgroundColor: 'rgba(15,122,191,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px', flexShrink: 0,
            }}>📊</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', color: TEXT1, fontWeight: 700, marginBottom: '2px' }}>
                Quiet Period — No Actionable Signals
              </div>
              <div style={{ fontSize: '11px', color: TEXT2, lineHeight: 1.4 }}>
                {notableSignals.length > 0 || monitorList.length > 0
                  ? `${notableSignals.length} notable and ${monitorList.length} monitor-level events detected. Review below for emerging opportunities.`
                  : 'No material corporate events for your portfolio/watchlist in this period.'}
              </div>
            </div>
          </div>
          {(notableSignals.length > 0 || monitorList.length > 0) && (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {notableSignals.length > 0 && (
                <div style={{ fontSize: '11px', color: YELLOW, background: 'rgba(251,191,36,0.08)', padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(251,191,36,0.15)' }}>
                  {notableSignals.length} Notable
                </div>
              )}
              {monitorList.length > 0 && (
                <div style={{ fontSize: '11px', color: ACCENT, background: 'rgba(15,122,191,0.08)', padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(15,122,191,0.15)' }}>
                  {monitorList.length} Monitor
                </div>
              )}
              {thematicIdeas.length > 0 && (
                <div style={{ fontSize: '11px', color: PURPLE, background: 'rgba(139,92,246,0.08)', padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(139,92,246,0.15)' }}>
                  {thematicIdeas.length} Themes
                </div>
              )}
            </div>
          )}
          {notableSignals.length === 0 && monitorList.length === 0 && thematicIdeas.length === 0 && (
            <div style={{ fontSize: '10px', color: TEXT3, fontStyle: 'italic', marginTop: '4px' }}>
              {daysFilter <= 7 ? `No events in ${daysFilter}D. Try 14D or 30D for wider coverage.` : 'Add more stocks to your watchlist for broader coverage.'}
            </div>
          )}
        </div>
      )}

      {/* ── THEMATIC INTELLIGENCE (v8) — always shown when ideas available ── */}
      {thematicIdeas.length > 0 && !loading && typeFilter === 'ALL' && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: PURPLE, letterSpacing: '0.05em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            🧠 THEMATIC INTELLIGENCE ({thematicIdeas.length})
            <span style={{ fontSize: '9px', fontWeight: 400, color: TEXT3, letterSpacing: 'normal' }}>
              Alpha signals · Multi-event narratives · Portfolio-first
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {thematicIdeas.map((idea, i) => {
              const confColor = idea.theme.confidence === 'HIGH' ? GREEN : idea.theme.confidence === 'MEDIUM' ? YELLOW : TEXT3;
              return (
                <div key={`theme-${i}`} style={{
                  backgroundColor: CARD,
                  border: `1px solid ${idea.isPortfolio ? 'rgba(139,92,246,0.25)' : idea.isWatchlist ? 'rgba(15,122,191,0.2)' : 'rgba(167,139,250,0.15)'}`,
                  borderLeft: `3px solid ${idea.isPortfolio ? PURPLE : idea.isWatchlist ? ACCENT : 'rgba(167,139,250,0.5)'}`,
                  borderRadius: '8px',
                  padding: '10px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6' }}>{idea.symbol}</span>
                    {idea.lastPrice && idea.lastPrice > 0 && (
                      <span style={{ fontSize: '11px', color: TEXT2 }}>₹{idea.lastPrice.toLocaleString('en-IN')}</span>
                    )}
                    {idea.isPortfolio && <span style={{ fontSize: '9px', color: PURPLE, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(139,92,246,0.15)' }}>PF</span>}
                    {idea.isWatchlist && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.15)' }}>WL</span>}
                    {idea.segment && <span style={{ fontSize: '9px', color: TEXT3, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(100,116,139,0.08)' }}>{idea.segment}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '9px', fontWeight: 700, color: confColor, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(167,139,250,0.08)' }}>
                        {idea.theme.confidence} · {Math.round(idea.theme.score)}
                      </span>
                      <span style={{ fontSize: '9px', color: TEXT3 }}>{idea.signals} signal{idea.signals !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  {/* Theme label */}
                  <div style={{ fontSize: '12px', fontWeight: 600, color: PURPLE, marginTop: '4px' }}>
                    → {idea.theme.label}
                  </div>
                  {/* Narrative */}
                  <div style={{ fontSize: '11px', color: TEXT2, marginTop: '3px', lineHeight: 1.4 }}>
                    {idea.theme.narrative}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TOP SIGNALS ── */}
      {top3.length > 0 && typeFilter === 'ALL' && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {signals.length > 0 ? `✅ ACTIONABLE SIGNALS (${signals.length})` : noActionableSignals ? (top3.length > 0 ? 'TOP MONITOR SIGNALS' : 'NO HIGH-CONFIDENCE SIGNALS') : (top3.length > 0 ? 'TOP SIGNALS' : 'SIGNALS')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {top3.map((s, i) => (
              <div key={`top-${i}`} style={{
                backgroundColor: CARD,
                border: `1px solid ${noActionableSignals ? 'rgba(167,139,250,0.3)' : (s.isNegative ? `${RED}40` : `${actionColor(s.action)}30`)}`,
                borderLeft: `4px solid ${noActionableSignals ? '#A78BFA' : (s.isNegative ? RED : actionColor(s.action))}`,
                borderRadius: '10px',
                padding: '14px 18px',
              }}>
                {/* Row 1: Symbol, Action, Impact, Value */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px' }}>{eventTypeIcon(s.eventType)}</span>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#3B82F6' }}>{s.symbol}</span>
                  {/* Current price with confidence indicator */}
                  <span style={{
                    fontSize: '11px', fontWeight: 600,
                    color: (s.lastPrice && s.lastPrice > 0) ? TEXT1 : TEXT3,
                    padding: '2px 6px', borderRadius: '3px',
                    backgroundColor: (s.lastPrice && s.lastPrice > 0) ? 'rgba(226,232,240,0.08)' : 'rgba(100,116,139,0.06)',
                    display: 'flex', alignItems: 'center', gap: '3px'
                  }}>
                    {fmtPrice(s.lastPrice)}
                    {s.dataConfidence === 'LOW' && <span style={{ fontSize: '10px', color: ORANGE }}>!</span>}
                  </span>
                  {s.isPortfolio && <span style={{ fontSize: '9px', color: PURPLE, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(139,92,246,0.15)' }}>PF</span>}
                  {s.isWatchlist && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.15)' }}>WL</span>}
                  {s.tag && <span style={{ 
  fontSize: '9px', 
  fontWeight: 700, 
  padding: '1px 5px', 
  borderRadius: '3px', 
  color: s.tag === 'RISK-WATCH' ? '#EF4444' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? '#F59E0B' : '#A78BFA',
  backgroundColor: s.tag === 'RISK-WATCH' ? 'rgba(239,68,68,0.12)' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? 'rgba(245,158,11,0.12)' : 'rgba(167,139,250,0.12)',
  border: `1px solid ${s.tag === 'RISK-WATCH' ? 'rgba(239,68,68,0.25)' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? 'rgba(245,158,11,0.25)' : 'rgba(167,139,250,0.25)'}`,
}}>{s.tag}</span>}
                  {s.isNegative && <span style={{ fontSize: '9px', color: RED, fontWeight: 700, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(239,68,68,0.12)' }}>⚠ NEGATIVE</span>}
                  {s.signalClass && s.signalClass !== 'COMPLIANCE' && (
                    <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '2px',
                      color: s.signalClass === 'ECONOMIC' ? '#10B981' : s.signalClass === 'STRATEGIC' ? '#8B5CF6' : '#F59E0B',
                      backgroundColor: s.signalClass === 'ECONOMIC' ? 'rgba(16,185,129,0.1)' : s.signalClass === 'STRATEGIC' ? 'rgba(139,92,246,0.1)' : 'rgba(245,158,11,0.1)',
                    }}>{s.signalClass}</span>
                  )}
                  <span style={{
                    fontSize: '11px', fontWeight: 700, color: actionColor(s.action),
                    padding: '2px 8px', borderRadius: '4px', backgroundColor: actionBg(s.action),
                  }}>{s.action}</span>
                  <span style={{
                    fontSize: '10px', fontWeight: 700, color: impactColor(s.impactLevel),
                    padding: '2px 6px', borderRadius: '4px', backgroundColor: impactBg(s.impactLevel),
                  }}>{s.impactLevel} IMPACT</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: ACCENT, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(15,122,191,0.1)' }}>{s.eventType}</span>
                  {s.valueCr && s.valueCr > 0 && (
                    <span style={{ fontSize: '13px', fontWeight: 700, color: CYAN }}>{fmtCr(s.valueCr)}</span>
                  )}
                  {s.signalStackLevel && s.signalStackLevel !== 'WEAK' && s._stackIndependent && (
                    <span style={{ fontSize: '9px', color: s.signalStackLevel === 'STRONG' ? GREEN : YELLOW, fontWeight: 600 }}>
                      ⚡{s.signalStackCount} independent signals
                    </span>
                  )}
                  <span style={{ fontSize: '10px', color: TEXT3, marginLeft: 'auto' }}>
                    {s.weightedScore} ({Math.round(s.timeWeight * 100)}% fresh)
                  </span>
                </div>

                {/* 3-Axis Score Bars */}
                {(s.fundamentalScore !== undefined || s.signalStrengthScore !== undefined || s.dataConfidenceScore !== undefined) && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    {s.fundamentalScore !== undefined && (
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: '9px', color: TEXT3 }}>Fund</div>
                        <div style={{ height: '3px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${s.fundamentalScore}%`, backgroundColor: s.fundamentalScore >= 60 ? GREEN : s.fundamentalScore >= 40 ? ACCENT : RED, borderRadius: '2px', transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: '9px', color: s.fundamentalScore >= 60 ? GREEN : s.fundamentalScore >= 40 ? ACCENT : RED }}>{s.fundamentalScore}</div>
                      </div>
                    )}
                    {s.signalStrengthScore !== undefined && (
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: '9px', color: TEXT3 }}>Signal</div>
                        <div style={{ height: '3px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${s.signalStrengthScore}%`, backgroundColor: s.signalStrengthScore >= 60 ? GREEN : s.signalStrengthScore >= 40 ? ACCENT : RED, borderRadius: '2px', transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: '9px', color: s.signalStrengthScore >= 60 ? GREEN : s.signalStrengthScore >= 40 ? ACCENT : RED }}>{s.signalStrengthScore}</div>
                      </div>
                    )}
                    {s.dataConfidenceScore !== undefined && (
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: '9px', color: TEXT3 }}>Conf</div>
                        <div style={{ height: '3px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${s.dataConfidenceScore}%`, backgroundColor: s.dataConfidenceScore >= 70 ? GREEN : s.dataConfidenceScore >= 45 ? ACCENT : RED, borderRadius: '2px', transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: '9px', color: s.dataConfidenceScore >= 70 ? GREEN : s.dataConfidenceScore >= 45 ? ACCENT : RED }}>{s.dataConfidenceScore}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Row 2: QUANT DATA — Event Value | Revenue | Impact % */}
                <div style={{
                  display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '6px', padding: '6px 8px',
                  backgroundColor: 'rgba(6,182,212,0.05)', borderRadius: '6px', border: '1px solid rgba(6,182,212,0.1)',
                }}>
                  {s.valueCr && s.valueCr > 0 ? (
                    <span style={{ fontSize: '12px', color: TEXT2 }}>
                      Event: <span style={{ fontWeight: 700, color: CYAN }}>{fmtCr(s.valueCr)}</span>
                      {s.inferenceUsed && <span style={{ fontSize: '9px', color: TEXT3, marginLeft: '3px' }}>(est.)</span>}
                    </span>
                  ) : (
                    <span style={{ fontSize: '12px', color: TEXT3, fontStyle: 'italic' }}>{
                      s.signalClass === 'GOVERNANCE' ? 'Governance event' :
                      s.signalClass === 'STRATEGIC' ? 'Strategic event' :
                      s.eventType === 'Guidance' ? 'Guidance signal' :
                      'Corporate event'
                    }</span>
                  )}
                  {s.revenueCr && s.revenueCr > 0 && (
                    <span style={{ fontSize: '12px', color: TEXT2 }}>
                      Rev: <span style={{ fontWeight: 700, color: TEXT1 }}>{fmtCr(s.revenueCr)}</span>
                    </span>
                  )}
                  {s.impactPct > 0 && (
                    <span style={{
                      fontSize: '13px', fontWeight: 800, padding: '2px 10px', borderRadius: '6px',
                      backgroundColor: s.impactPct >= 8 ? 'rgba(16,185,129,0.2)' : s.impactPct >= 3 ? 'rgba(251,191,36,0.15)' : 'rgba(100,116,139,0.1)',
                      color: s.impactPct >= 8 ? GREEN : s.impactPct >= 3 ? YELLOW : TEXT2,
                    }}>Impact: {s.impactPct.toFixed(1)}% {s.impactPct >= 8 ? '→ HIGH' : s.impactPct >= 3 ? '→ MEDIUM' : '→ LOW'}
                      {s.inferenceUsed && ' (est.)'}
                    </span>
                  )}
                  {s.pctMcap !== null && s.pctMcap > 0 && (
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px',
                      backgroundColor: 'rgba(6,182,212,0.12)', color: CYAN,
                    }}>{s.pctMcap.toFixed(1)}% MCap</span>
                  )}
                  {s.earningsBoost && (
                    <span style={{ fontSize: '10px', fontWeight: 700, color: GREEN, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(16,185,129,0.12)' }}>
                      ⚡ EARNINGS BOOST
                    </span>
                  )}
                  {s.verified && (
                    <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(16,185,129,0.15)', color: GREEN }}>
                      ✓ VERIFIED
                    </span>
                  )}
                </div>

                {/* Row 3: WHY IT MATTERS — the institutional insight */}
                {/* Contradiction warnings */}
                {s.contradictions && s.contradictions.length > 0 && (
                  <div style={{
                    fontSize: '11px', color: '#FF6B6B', fontWeight: 600, lineHeight: 1.4,
                    padding: '4px 10px', marginBottom: '4px', borderRadius: '5px',
                    backgroundColor: 'rgba(255,107,107,0.08)', borderLeft: '3px solid #FF6B6B',
                  }}>
                    ⚠ {s.contradictions.join(' · ')}
                  </div>
                )}

                {/* WHY explanation with risk/reason */}
                {s.whyAction ? (
                  <div style={{
                    fontSize: '12px', color: s.isNegative ? RED : GREEN, fontWeight: 600, lineHeight: 1.5,
                    padding: '6px 10px', marginBottom: '4px', borderRadius: '6px',
                    backgroundColor: s.isNegative ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.06)',
                    borderLeft: `3px solid ${s.isNegative ? RED : GREEN}`,
                  }}>
                    {s.action}: {s.whyAction}
                  </div>
                ) : (
                  <div style={{
                    fontSize: '12px', color: s.isNegative ? RED : GREEN, fontWeight: 600, lineHeight: 1.5,
                    padding: '6px 10px', marginBottom: '4px', borderRadius: '6px',
                    backgroundColor: s.isNegative ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.06)',
                    borderLeft: `3px solid ${s.isNegative ? RED : GREEN}`,
                  }}>
                    {s.whyItMatters}
                  </div>
                )}
                {/* Risk factors panel */}
                {s.riskFactors && s.riskFactors.length > 0 && (
                  <div style={{
                    fontSize: '10px', color: '#F59E0B', lineHeight: 1.4, padding: '3px 10px',
                    marginBottom: '4px', borderLeft: '2px solid rgba(245,158,11,0.3)',
                  }}>
                    Risk: {s.riskFactors.slice(0, 3).join(' · ')}
                  </div>
                )}

                {/* Row 4: Headline / context */}
                <div style={{ fontSize: '11px', color: TEXT2, lineHeight: 1.5, paddingLeft: '2px' }}>
                  {s.headline.length > 200 ? s.headline.slice(0, 200) + '...' : s.headline}
                </div>
                {/* Source panel */}
                {s.sourceExtract && (
                  <div style={{ fontSize: '9px', color: TEXT3, lineHeight: 1.3, paddingLeft: '2px', marginTop: '2px', fontStyle: 'italic' }}>
                    Source: &quot;{s.sourceExtract.slice(0, 100)}{s.sourceExtract.length > 100 ? '...' : ''}&quot;
                  </div>
                )}

                {/* Row 5: Meta */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', paddingLeft: '2px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Signal tier badge */}
                  {s.signalTier && (
                    <span style={{
                      fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '3px',
                      color: s.signalTier === 'TIER1_VERIFIED' ? '#10B981' : '#94A3B8',
                      backgroundColor: s.signalTier === 'TIER1_VERIFIED' ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.08)',
                      border: `1px solid ${s.signalTier === 'TIER1_VERIFIED' ? 'rgba(16,185,129,0.3)' : 'rgba(100,116,139,0.2)'}`,
                    }}>
                      {s.signalTier === 'TIER1_VERIFIED' ? '✓ VERIFIED' : '~ INFERRED'}
                    </span>
                  )}
                  {/* Anomaly flags */}
                  {s.anomalyFlags && s.anomalyFlags.map((flag, i) => (
                    <span key={i} style={{
                      fontSize: '9px', fontWeight: 600, padding: '1px 5px', borderRadius: '3px',
                      color: '#FF6B6B', backgroundColor: 'rgba(255,107,107,0.08)',
                      border: '1px solid rgba(255,107,107,0.2)',
                    }}>
                      ⚠ {flag.replace(/_/g, ' ')}
                    </span>
                  ))}
                  {s.client && <span style={{ fontSize: '10px', color: PURPLE }}>Client: {s.client}</span>}
                  {s.segment && <span style={{ fontSize: '10px', color: ACCENT }}>Sector: {s.segment}</span>}
                  {s.timeline && <span style={{ fontSize: '10px', color: ORANGE }}>Timeline: {s.timeline}</span>}
                  <span style={{ fontSize: '10px', color: sentimentColor(s.sentiment) }}>{s.sentiment}</span>
                  <span style={{ fontSize: '10px', color: TEXT3 }}>{fmtDate(s.date)}</span>
                  {s.freshness && (
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 600,
                      color: FRESHNESS_COLORS[s.freshness] || TEXT3,
                      marginLeft: 'auto',
                    }}>
                      {s.freshness}
                    </span>
                  )}
                  {s.dataType && <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px', color: s.dataType === 'FACT' ? '#10B981' : '#F59E0B', backgroundColor: s.dataType === 'FACT' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${s.dataType === 'FACT' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}` }}>{s.dataType === 'FACT' ? '✅ Confirmed' : '⚠️ Inferred'}</span>}
                  {s.monitorScore !== undefined && <span style={{ fontSize: '9px', color: s.monitorTier === 'HIGH' ? GREEN : s.monitorTier === 'MEDIUM' ? YELLOW : TEXT3, fontWeight: 600 }}>Conf: {s.monitorScore}/100</span>}
                  {s.confidenceType && <span style={{ fontSize: '10px', color: s.confidenceType === 'ACTUAL' ? GREEN : s.confidenceType === 'INFERRED' ? YELLOW : TEXT3, marginLeft: '4px' }}>✓ {s.confidenceType}</span>}
                  {s.dataSource && <span style={{ fontSize: '10px', color: TEXT3, marginLeft: '4px' }}>· {s.dataSource}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── NOTABLE SIGNALS ── */}
      {notableSignals.length > 0 && typeFilter === 'ALL' && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: YELLOW, letterSpacing: '0.05em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            ⭐ NOTABLE SIGNALS ({notableSignals.length})
            <span style={{ fontSize: '9px', fontWeight: 400, color: TEXT3, letterSpacing: 'normal' }}>
              Watch-worthy · materialityScore 50–70 · Conf≥50
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {notableSignals.map((s, i) => {
              const nScore = s.v7RankScore || s.materialityScore || s.weightedScore || 0;
              return (
                <div key={`notable-${i}`} style={{
                  backgroundColor: CARD,
                  border: `1px solid rgba(251,191,36,0.2)`,
                  borderLeft: `3px solid ${YELLOW}`,
                  borderRadius: '8px',
                  padding: '10px 14px',
                  opacity: 0.92,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px' }}>{eventTypeIcon(s.eventType)}</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6' }}>{s.symbol}</span>
                    {s.lastPrice && s.lastPrice > 0 && (
                      <span style={{ fontSize: '11px', color: TEXT2 }}>{fmtPrice(s.lastPrice)}</span>
                    )}
                    {s.isPortfolio && <span style={{ fontSize: '9px', color: PURPLE, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(139,92,246,0.15)' }}>PF</span>}
                    {s.isWatchlist && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.15)' }}>WL</span>}
                    <span style={{ fontSize: '10px', color: ACCENT, padding: '1px 6px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.08)' }}>{s.eventType}</span>
                    {s.valueCr > 0 && <span style={{ fontSize: '11px', fontWeight: 700, color: CYAN }}>{fmtCr(s.valueCr)}{s.inferenceUsed ? '*' : ''}</span>}
                    {s.impactPct > 0 && (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: s.impactPct >= 8 ? GREEN : s.impactPct >= 3 ? YELLOW : TEXT2 }}>
                        {s.impactPct.toFixed(1)}%
                      </span>
                    )}
                    {s.signalClass && s.signalClass !== 'COMPLIANCE' && (
                      <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '2px',
                        color: s.signalClass === 'ECONOMIC' ? '#10B981' : s.signalClass === 'STRATEGIC' ? '#8B5CF6' : '#F59E0B',
                        backgroundColor: s.signalClass === 'ECONOMIC' ? 'rgba(16,185,129,0.1)' : s.signalClass === 'STRATEGIC' ? 'rgba(139,92,246,0.1)' : 'rgba(245,158,11,0.1)',
                      }}>{s.signalClass}</span>
                    )}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '9px', color: YELLOW, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(251,191,36,0.1)' }}>
                        NOTABLE · {Math.round(nScore)}
                      </span>
                      <span style={{ fontSize: '10px', color: TEXT3 }}>{fmtDate(s.date)}</span>
                    </div>
                  </div>
                  {/* Why it matters */}
                  <div style={{ fontSize: '11px', color: TEXT2, marginTop: '5px', lineHeight: 1.4 }}>
                    {s.whyItMatters || s.headline.slice(0, 120) + (s.headline.length > 120 ? '...' : '')}
                  </div>
                  {/* Meta */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                    {s.signalTier && (
                      <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                        color: s.signalTier === 'TIER1_VERIFIED' ? '#10B981' : '#64748B',
                        backgroundColor: s.signalTier === 'TIER1_VERIFIED' ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.06)',
                      }}>{s.signalTier === 'TIER1_VERIFIED' ? '✓ VERIFIED' : '~ INFERRED'}</span>
                    )}
                    {s.dataType && <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px', color: s.dataType === 'FACT' ? '#10B981' : '#F59E0B', backgroundColor: s.dataType === 'FACT' ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)' }}>{s.dataType === 'FACT' ? '✅ Confirmed' : '⚠️ Inferred'}</span>}
                    {s.monitorScore !== undefined && <span style={{ fontSize: '8px', color: s.monitorTier === 'HIGH' ? GREEN : s.monitorTier === 'MEDIUM' ? YELLOW : TEXT3, fontWeight: 600 }}>Conf:{s.monitorScore}</span>}
                    {!s.monitorScore && s.confidenceScore !== undefined && (
                      <span style={{ fontSize: '8px', color: s.confidenceScore >= 70 ? GREEN : s.confidenceScore >= 60 ? YELLOW : TEXT3 }}>
                        Conf:{s.confidenceScore}
                      </span>
                    )}
                    <span style={{ fontSize: '10px', color: sentimentColor(s.sentiment) }}>{s.sentiment}</span>
                    {s.dataSource && <span style={{ fontSize: '9px', color: TEXT3 }}>· {s.dataSource}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── QUIET MARKET DASHBOARD ── */}
      {quietMarket && !loading && (
        <div style={{
          backgroundColor: 'rgba(100,116,139,0.08)',
          border: `1px solid rgba(100,116,139,0.2)`,
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px' }}>🌊</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: TEXT2 }}>Quiet Market</div>
              <div style={{ fontSize: '11px', color: TEXT3, marginTop: '2px' }}>
                No high-conviction signals. Showing monitor-worthy activity below.
              </div>
            </div>
          </div>
          {/* Show thematic developments on quiet days */}
          {thematicIdeas.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: PURPLE, marginBottom: '6px' }}>THEMATIC DEVELOPMENTS</div>
              {thematicIdeas.slice(0, 3).map((t, i) => (
                <div key={`qt-${i}`} style={{ fontSize: '11px', color: TEXT2, marginBottom: '4px', paddingLeft: '8px', borderLeft: `2px solid ${PURPLE}40` }}>
                  <span style={{ fontWeight: 600, color: '#3B82F6' }}>{t.symbol}</span>
                  {t.isPortfolio && <span style={{ fontSize: '8px', color: PURPLE, marginLeft: '4px' }}>PF</span>}
                  {' — '}{t.theme.narrative}
                </div>
              ))}
            </div>
          )}
          {/* Show monitor signals on quiet days */}
          {monitorList.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: ACCENT, marginBottom: '6px' }}>MONITORING ({monitorList.length})</div>
              {monitorList.slice(0, 5).map((s, i) => (
                <div key={`qm-${i}`} style={{ fontSize: '11px', color: TEXT2, marginBottom: '4px', paddingLeft: '8px', borderLeft: `2px solid ${ACCENT}40` }}>
                  <span style={{ fontWeight: 600, color: '#3B82F6' }}>{s.symbol}</span>
                  {s.isPortfolio && <span style={{ fontSize: '8px', color: PURPLE, marginLeft: '4px' }}>PF</span>}
                  {' — '}{s.whatHappened || s.whyItMatters || s.eventType}
                  <span style={{ fontSize: '9px', color: TEXT3, marginLeft: '6px' }}>{fmtDate(s.date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SPECULATIVE SIGNALS (suppressed from main feed) ── */}
      {speculativeSignals.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, letterSpacing: '0.05em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            🔍 SPECULATIVE ({speculativeSignals.length})
            <span style={{ fontSize: '9px', fontWeight: 400, color: TEXT3, letterSpacing: 'normal' }}>
              Early signal — requires confirmation before action
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {speculativeSignals.map((s, i) => {
              const confScore = s.monitorScore || s.confidenceScore || s.dataConfidenceScore || 0;
              return (
                <div key={`spec-${i}`} style={{
                  backgroundColor: CARD,
                  border: `1px solid rgba(100,116,139,0.15)`,
                  borderLeft: `3px solid ${TEXT3}`,
                  borderRadius: '8px',
                  padding: '8px 12px',
                  opacity: 0.65,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px' }}>{eventTypeIcon(s.eventType)}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: TEXT2 }}>{s.symbol}</span>
                    <span style={{ fontSize: '10px', color: TEXT3 }}>{s.eventType}</span>
                    {s.eventTaxonomyTier && (
                      <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '2px',
                        color: s.eventTaxonomyTier === 'TIER_1' ? GREEN : s.eventTaxonomyTier === 'TIER_2' ? YELLOW : TEXT3,
                        backgroundColor: s.eventTaxonomyTier === 'TIER_1' ? 'rgba(16,185,129,0.08)' : s.eventTaxonomyTier === 'TIER_2' ? 'rgba(251,191,36,0.08)' : 'rgba(100,116,139,0.06)',
                      }}>{s.eventTaxonomyTier}</span>
                    )}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '8px', color: RED, fontWeight: 600 }}>Conf:{Math.round(confScore)} Mat:{s.materialityScore || 0}</span>
                      <span style={{ fontSize: '10px', color: TEXT3 }}>{fmtDate(s.date)}</span>
                    </div>
                  </div>
                  {s.whatHappened && (
                    <div style={{ fontSize: '10px', color: TEXT3, marginTop: '4px' }}>{s.whatHappened}</div>
                  )}
                  {!s.whatHappened && s.whyItMatters && (
                    <div style={{ fontSize: '10px', color: TEXT3, marginTop: '4px' }}>{s.whyItMatters}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── FILTER BAR ── */}
      {signals.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Filter size={13} color={TEXT3} />

          {/* Universe filter */}
          {([
            { key: 'ALL'       as UniverseFilter, label: 'All',          count: signals.length,  color: PURPLE },
            { key: 'PORTFOLIO' as UniverseFilter, label: 'Portfolio',    count: portfolioCount,  color: PURPLE },
            { key: 'WATCHLIST' as UniverseFilter, label: 'Watchlist',    count: watchlistCount,  color: ACCENT },
            { key: 'EXCEL'     as UniverseFilter, label: '📊 Excel Picks', count: excelCount,    color: '#10b981' },
          ]).map(f => (
            <button key={f.key} onClick={() => setUniverseFilter(f.key)} style={{
              padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${universeFilter === f.key ? f.color : BORDER}`,
              background: universeFilter === f.key ? `${f.color}22` : 'transparent',
              color: universeFilter === f.key ? f.color : TEXT3,
            }}>{f.label} ({f.count})</button>
          ))}

          <span style={{ width: '1px', height: '16px', backgroundColor: BORDER, margin: '0 4px' }} />

          {/* Type filter */}
          {([
            { key: 'ALL' as FilterType, label: 'All' },
            { key: 'BUY' as FilterType, label: `🎯 BUY (${buySignals.length})` },
            { key: 'ADD' as FilterType, label: `ADD (${addSignals.length})` },
            { key: 'HOLD' as FilterType, label: `HOLD (${holdSignals.length})` },
            { key: 'ORDERS' as FilterType, label: 'Orders' },
            { key: 'CAPEX' as FilterType, label: 'Capex' },
            { key: 'DEALS' as FilterType, label: 'Deals' },
            { key: 'STRATEGIC' as FilterType, label: 'Strategic' },
            ...(negativeCount > 0 ? [{ key: 'NEGATIVE' as FilterType, label: `⚠ Negative (${negativeCount})` }] : []),
          ]).map(f => (
            <button key={f.key} onClick={() => setTypeFilter(f.key)} style={{
              padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${typeFilter === f.key ? ACCENT : BORDER}`,
              background: typeFilter === f.key ? 'rgba(15,122,191,0.15)' : 'transparent',
              color: typeFilter === f.key ? ACCENT : TEXT3,
            }}>{f.label}</button>
          ))}

          <span style={{ width: '1px', height: '16px', backgroundColor: BORDER, margin: '0 4px' }} />

          {/* Noise toggle */}
          <button
            onClick={() => setShowNoise(!showNoise)}
            style={{
              fontSize: '10', padding: '3px 8px', borderRadius: 4,
              background: showNoise ? `${TEXT3}33` : 'transparent',
              color: TEXT3, border: `1px solid ${TEXT3}33`, cursor: 'pointer',
            }}
          >
            {showNoise ? 'Hide Noise' : 'Show Noise'}
          </button>
        </div>
      )}

      {/* ── ALL SIGNALS ── */}
      {filteredSignals.length > 0 && (
        <div>
          {/* Portfolio Critical Events — v7: requires portfolioCritical===true (conf≥70, verified, impact≥3% or key event) */}
          {filteredSignals.filter(s => s.portfolioCritical === true).length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', paddingLeft: '4px' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: ORANGE, letterSpacing: '1px' }}>🔥 PORTFOLIO CRITICAL</span>
                <span style={{ fontSize: '11px', color: TEXT3 }}>Verified · Conf≥70 · Impact≥3%</span>
              </div>
              {filteredSignals
                .filter(s => s.portfolioCritical === true)
                .sort((a, b) => (b.v7RankScore || b.portfolioImpactScore || b.weightedScore) - (a.v7RankScore || a.portfolioImpactScore || a.weightedScore))
                .slice(0, 5)
                .map((signal, idx) => (
                  <div key={`pf-${signal.symbol}-${idx}`} style={{
                    background: 'linear-gradient(135deg, #1a1a2e 0%, #0D1623 100%)',
                    border: `1px solid ${ORANGE}33`,
                    borderRadius: '8px', padding: '10px 14px', marginBottom: '6px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: TEXT1, fontSize: '13px' }}>{signal.symbol}</span>
                        <span style={{ fontSize: '10px', color: ORANGE, fontWeight: 600, padding: '1px 6px', background: `${ORANGE}22`, borderRadius: '4px' }}>PF</span>
                        <span style={{ fontSize: '11px', color: signal.sentiment === 'Bullish' ? GREEN : signal.sentiment === 'Bearish' ? RED : TEXT2 }}>{signal.eventType}</span>
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          color: '#fff',
                          backgroundColor: DECISION_COLORS[signal.action] || TEXT3,
                        }}>
                          {signal.action}
                        </span>
                        {signal.scoreDelta !== undefined && signal.scoreDelta !== 0 && (
                          <span style={{
                            fontSize: '10px',
                            color: signal.scoreDelta > 0 ? GREEN : RED,
                            marginLeft: '4px',
                          }}>
                            {signal.scoreDelta > 0 ? '↑' : '↓'}{Math.abs(signal.scoreDelta)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: TEXT2, marginTop: '2px' }}>{signal.headline.slice(0, 100)}</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: '80px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: signal.isNegative ? RED : GREEN }}>{fmtCr(signal.valueCr)}</div>
                      <div style={{ fontSize: '10px', color: TEXT3 }}>Score: {signal.weightedScore}</div>
                    </div>
                  </div>
                ))}
            </div>
          )}

          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
            {typeFilter === 'ALL' ? 'ALL SIGNALS' : typeFilter.replace('_', ' ')} ({filteredSignals.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {/* High Conviction Signals */}
            {filteredSignals.filter(s => (s.weightedScore ?? 0) > 70).length > 0 && (
              <>
                <div style={{ fontSize: '10px', fontWeight: 700, color: GREEN, marginTop: '8px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {'✓ HIGH CONVICTION (Score > 70)'}
                </div>
                {filteredSignals
                  .filter(s => (s.weightedScore ?? 0) > 70)
                  .map((s, i) => (
                    <div key={`sig-hc-${i}`} style={{
                      backgroundColor: CARD,
                      border: `1px solid ${s.isNegative ? `${RED}30` : s.isPortfolio ? `${PURPLE}40` : s.isWatchlist ? `${ACCENT}30` : BORDER}`,
                      borderRadius: '8px',
                      padding: '12px 16px',
                      borderLeft: `3px solid ${s.signalTier === 'TIER1_VERIFIED' ? '#10B981' : s.isNegative ? '#EF4444' : '#475569'}`,
                      opacity: s.signalTier === 'TIER2_INFERRED' ? 0.85 : 1,
                    }}>
                      {/* Row 1: Core info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px' }}>{eventTypeIcon(s.eventType)}</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6', minWidth: '80px' }}>{s.symbol}</span>
                  {/* Current price with confidence indicator */}
                  <span style={{
                    fontSize: '11px', fontWeight: 600,
                    color: (s.lastPrice && s.lastPrice > 0) ? TEXT1 : TEXT3,
                    padding: '2px 6px', borderRadius: '3px',
                    backgroundColor: (s.lastPrice && s.lastPrice > 0) ? 'rgba(226,232,240,0.08)' : 'rgba(100,116,139,0.06)',
                    display: 'flex', alignItems: 'center', gap: '3px'
                  }}>
                    {fmtPrice(s.lastPrice)}
                    {s.dataConfidence === 'LOW' && <span style={{ fontSize: '10px', color: ORANGE }}>!</span>}
                  </span>
                  {/* Watchlist flag — clickable to cycle */}
                  {(s.isWatchlist || s.isPortfolio) && (
                    <button onClick={(e) => { e.stopPropagation(); toggleFlag(s.symbol); }} style={{
                      fontSize: '10px', cursor: 'pointer', padding: '0 2px', border: 'none', background: 'none',
                      opacity: watchlistFlags[s.symbol] ? 1 : 0.3,
                    }} title={`Flag: ${watchlistFlags[s.symbol] || 'None'} (click to cycle)`}>
                      {watchlistFlags[s.symbol] ? flagEmoji[watchlistFlags[s.symbol]] : '⚪'}
                    </button>
                  )}
                  {s.isPortfolio && <span style={{ fontSize: '9px', color: PURPLE, fontWeight: 600 }}>PF</span>}
                  {s.isWatchlist && !s.isPortfolio && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600 }}>WL</span>}
                  {s.tag && <span style={{ 
  fontSize: '9px', 
  fontWeight: 700, 
  padding: '1px 5px', 
  borderRadius: '3px', 
  color: s.tag === 'RISK-WATCH' ? '#EF4444' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? '#F59E0B' : '#A78BFA',
  backgroundColor: s.tag === 'RISK-WATCH' ? 'rgba(239,68,68,0.12)' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? 'rgba(245,158,11,0.12)' : 'rgba(167,139,250,0.12)',
  border: `1px solid ${s.tag === 'RISK-WATCH' ? 'rgba(239,68,68,0.25)' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? 'rgba(245,158,11,0.25)' : 'rgba(167,139,250,0.25)'}`,
}}>{s.tag}</span>}
                  {s.isNegative && <span style={{ fontSize: '9px', color: RED, fontWeight: 700 }}>⚠</span>}
                  {/* Price performance since added to watchlist */}
                  {s.lastPrice && addedPrices[s.symbol] && addedPrices[s.symbol] > 0 && (() => {
                    const pctChange = ((s.lastPrice! - addedPrices[s.symbol]) / addedPrices[s.symbol]) * 100;
                    return (
                      <span style={{
                        fontSize: '10px', fontWeight: 700,
                        color: pctChange >= 0 ? GREEN : RED,
                        padding: '1px 4px', borderRadius: '3px',
                        backgroundColor: pctChange >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                      }}>
                        {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(1)}%
                      </span>
                    );
                  })()}
                  <span style={{
                    fontSize: '10px', fontWeight: 600, color: ACCENT,
                    padding: '1px 6px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.1)',
                  }}>{s.eventType}</span>

                  {/* Value — only shown if > 0 */}
                  {s.valueCr > 0 && (
                    <span style={{ fontSize: '12px', fontWeight: 700, color: CYAN }}>
                      {fmtCr(s.valueCr)}{s.inferenceUsed ? '*' : ''}
                    </span>
                  )}

                  {/* Impact % — only shown if > 0 */}
                  {s.impactPct > 0 && (
                    <span style={{
                      fontSize: '11px', fontWeight: 700,
                      color: s.impactPct >= 8 ? GREEN : s.impactPct >= 3 ? YELLOW : TEXT2,
                    }}>{s.impactPct.toFixed(1)}%</span>
                  )}
                  {s.pctMcap !== null && s.pctMcap > 0 && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: CYAN }}>
                      {s.pctMcap.toFixed(1)}% MCap
                    </span>
                  )}

                  {/* For deals: buyer/seller + premium */}
                  {s.buyerSeller && (
                    <span style={{ fontSize: '11px', color: TEXT3 }}>{s.buyerSeller.slice(0, 30)}</span>
                  )}
                  {s.premiumDiscount !== null && (
                    <span style={{ color: s.premiumDiscount >= 0 ? GREEN : RED, fontSize: '11px', fontWeight: 600 }}>
                      {s.premiumDiscount > 0 ? '+' : ''}{s.premiumDiscount.toFixed(1)}%
                    </span>
                  )}

                  {/* Impact + Action */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                    <span style={{
                      fontSize: '9px', fontWeight: 700, color: impactColor(s.impactLevel),
                      padding: '1px 5px', borderRadius: '3px', backgroundColor: impactBg(s.impactLevel),
                    }}>{s.impactLevel}</span>
                    <span style={{
                      fontWeight: 700, fontSize: '10px',
                      color: actionColor(s.action),
                      padding: '2px 6px', borderRadius: '4px',
                      backgroundColor: actionBg(s.action),
                    }}>{s.action}</span>
                  </div>
                </div>

                {/* Contradiction warnings */}
                {s.contradictions && s.contradictions.length > 0 && (
                  <div style={{
                    fontSize: '10px', color: '#FF6B6B', fontWeight: 600, lineHeight: 1.3,
                    padding: '3px 8px', marginTop: '4px', borderRadius: '4px',
                    backgroundColor: 'rgba(255,107,107,0.06)', borderLeft: '2px solid #FF6B6B',
                  }}>
                    ⚠ {s.contradictions.join(' · ')}
                  </div>
                )}

                {/* Row 2: What Happened (institutional card) */}
                {s.whatHappened ? (
                  <div style={{ fontSize: '11px', color: TEXT1, marginTop: '5px', lineHeight: 1.4, fontWeight: 500 }}>
                    {s.whatHappened}
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: s.isNegative ? '#F87171' : '#6EE7B7', marginTop: '5px', lineHeight: 1.4, fontWeight: 500 }}>
                    {s.whyAction || s.whyItMatters}
                  </div>
                )}

                {/* Economic Impact + Evidence */}
                {(s.economicImpact || s.evidence) && (
                  <div style={{ fontSize: '10px', color: TEXT2, marginTop: '3px', lineHeight: 1.4 }}>
                    {s.economicImpact && <span style={{ color: CYAN }}>{s.economicImpact}</span>}
                    {s.economicImpact && s.evidence && <span style={{ color: TEXT3 }}> · </span>}
                    {s.evidence && <span style={{ color: TEXT3 }}>{s.evidence}</span>}
                  </div>
                )}

                {/* Conflict Range warning */}
                {s.conflictRange && s.conflictRange.min !== s.conflictRange.max && (
                  <div style={{ fontSize: '9px', color: ORANGE, marginTop: '2px', fontWeight: 600 }}>
                    ⚠ Value range: {'\u20B9'}{Math.round(s.conflictRange.min)}–{Math.round(s.conflictRange.max)} Cr ({s.conflictRange.sources.length} sources)
                  </div>
                )}

                {/* Signal Score Breakdown */}
                {s.signalScoreBreakdown && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    {(['materiality', 'confidence', 'freshness', 'investability'] as const).map(dim => {
                      const val = s.signalScoreBreakdown![dim];
                      const color = val >= 70 ? GREEN : val >= 50 ? YELLOW : val >= 30 ? ORANGE : RED;
                      return (
                        <span key={dim} style={{ fontSize: '8px', color, fontWeight: 600 }}>
                          {dim.charAt(0).toUpperCase()}:{val}
                        </span>
                      );
                    })}
                    {s.eventTaxonomyTier && (
                      <span style={{ fontSize: '8px', fontWeight: 700,
                        color: s.eventTaxonomyTier === 'TIER_1' ? GREEN : s.eventTaxonomyTier === 'TIER_2' ? YELLOW : TEXT3,
                      }}>{s.eventTaxonomyTier}</span>
                    )}
                    {s._stackIndependent === false && s._stackRawCount && s._stackRawCount >= 2 && (
                      <span style={{ fontSize: '8px', color: ORANGE, fontWeight: 600 }}>
                        ⚠ {s._stackRawCount} signals same source
                      </span>
                    )}
                  </div>
                )}

                {/* Risks + Next Confirmation (collapsed) */}
                {s.nextConfirmation && (
                  <div style={{ fontSize: '9px', color: TEXT3, marginTop: '3px', fontStyle: 'italic' }}>
                    Next: {s.nextConfirmation}
                  </div>
                )}

                {/* Row 3: Headline */}
                <div style={{ fontSize: '11px', color: TEXT2, marginTop: '3px', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                  {s.headline.length > 250 ? s.headline.slice(0, 250) + '...' : s.headline}
                </div>

                {/* Row 4: Meta tags */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '4px', alignItems: 'center' }}>
                  {/* Signal tier */}
                  {s.signalTier && (
                    <span style={{
                      fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                      color: s.signalTier === 'TIER1_VERIFIED' ? '#10B981' : '#64748B',
                      backgroundColor: s.signalTier === 'TIER1_VERIFIED' ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.06)',
                    }}>
                      {s.signalTier === 'TIER1_VERIFIED' ? '✓ VERIFIED' : '~ INFERRED'}
                    </span>
                  )}
                  {/* Anomaly flags */}
                  {s.anomalyFlags && s.anomalyFlags.length > 0 && (
                    <span style={{ fontSize: '8px', fontWeight: 600, color: '#FF6B6B', padding: '1px 4px', borderRadius: '3px', backgroundColor: 'rgba(255,107,107,0.06)' }}>
                      ⚠ {s.anomalyFlags.length} issue{s.anomalyFlags.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {/* Catalyst strength */}
                  {s.catalystStrength && (
                    <span style={{
                      fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                      color: s.catalystStrength === 'STRONG' ? '#10B981' : s.catalystStrength === 'MODERATE' ? '#F59E0B' : '#64748B',
                      backgroundColor: s.catalystStrength === 'STRONG' ? 'rgba(16,185,129,0.1)' : s.catalystStrength === 'MODERATE' ? 'rgba(245,158,11,0.1)' : 'rgba(100,116,139,0.06)',
                    }}>
                      {s.catalystStrength === 'STRONG' ? '⚡ STRONG' : s.catalystStrength === 'MODERATE' ? '◆ MOD' : '○ WEAK'}
                    </span>
                  )}
                  {/* Evidence tier badge */}
                  {s.evidenceTier && (
                    <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '2px',
                      color: s.evidenceTier === 'TIER_A' ? '#059669' : s.evidenceTier === 'TIER_B' ? '#D97706' : s.evidenceTier === 'TIER_D' ? '#6B7280' : '#DC2626',
                      backgroundColor: s.evidenceTier === 'TIER_A' ? 'rgba(5,150,105,0.08)' : s.evidenceTier === 'TIER_B' ? 'rgba(217,119,6,0.08)' : s.evidenceTier === 'TIER_D' ? 'rgba(107,114,128,0.08)' : 'rgba(220,38,38,0.08)',
                    }}>
                      {s.evidenceTier === 'TIER_A' ? 'A' : s.evidenceTier === 'TIER_B' ? 'B' : s.evidenceTier === 'TIER_D' ? 'D' : 'C'}
                    </span>
                  )}
                  {/* Time horizon badge */}
                  {s.timeHorizon && (
                    <span style={{ fontSize: '7px', fontWeight: 600, padding: '1px 3px', borderRadius: '2px', color: '#6366F1', backgroundColor: 'rgba(99,102,241,0.06)' }}>
                      {s.timeHorizon === 'SHORT' ? 'S' : s.timeHorizon === 'MEDIUM' ? 'M' : 'L'}
                    </span>
                  )}
                  {/* Watch subtype */}
                  {s.watchSubtype && (
                    <span style={{ fontSize: '7px', fontWeight: 600, padding: '1px 3px', borderRadius: '2px',
                      color: '#6366F1',
                      backgroundColor: 'rgba(99,102,241,0.08)',
                    }}>
                      MONITOR
                    </span>
                  )}
                  {/* Heuristic suppression warning */}
                  {s.heuristicSuppressed && (
                    <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '2px', color: '#DC2626', backgroundColor: 'rgba(220,38,38,0.08)', letterSpacing: '0.3px' }}
                      title={s.templatePattern || 'Unverified pattern detected'}>
                      ⚠ LOW-CONF PATTERN
                    </span>
                  )}
                  {s.conflictBadge && (
                    <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '2px', color: ORANGE, backgroundColor: 'rgba(249,115,22,0.08)' }}>
                      ⚠ {s.conflictBadge}
                    </span>
                  )}
                  {s.guidanceAnomalyFlag && (
                    <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '2px', color: YELLOW, backgroundColor: 'rgba(251,191,36,0.08)' }}>
                      ⚠ {s.guidanceAnomalyFlag}
                    </span>
                  )}
                  {s.client && <span style={{ fontSize: '10px', color: PURPLE }}>Client: {s.client}</span>}
                  {s.segment && <span style={{ fontSize: '10px', color: ACCENT }}>{s.segment}</span>}
                  {s.timeline && <span style={{ fontSize: '10px', color: ORANGE }}>{s.timeline}</span>}
                  <span style={{ fontSize: '10px', color: sentimentColor(s.sentiment) }}>{s.sentiment}</span>
                  {s.signalStackLevel && s.signalStackLevel !== 'WEAK' && (
                    <span style={{ fontSize: '9px', color: s.signalStackLevel === 'STRONG' ? GREEN : YELLOW }}>
                      ⚡{s.signalStackCount}
                    </span>
                  )}
                  {s.verified && (
                    <span style={{
                      fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                      backgroundColor: 'rgba(16,185,129,0.12)', color: GREEN,
                    }}>✓</span>
                  )}
                  {s.scoreDelta !== undefined && s.scoreDelta !== 0 && (
                    <span style={{
                      fontSize: '10px',
                      color: s.scoreDelta > 0 ? GREEN : RED,
                      marginLeft: 'auto',
                    }}>
                      {s.scoreDelta > 0 ? '↑' : '↓'}{Math.abs(s.scoreDelta)}
                    </span>
                  )}
                  {s.freshness && (
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 600,
                      color: FRESHNESS_COLORS[s.freshness] || TEXT3,
                    }}>
                      {s.freshness}
                    </span>
                  )}
                  {s.confidenceType && <span style={{ fontSize: '10px', color: s.confidenceType === 'ACTUAL' ? GREEN : s.confidenceType === 'INFERRED' ? YELLOW : TEXT3, marginLeft: '4px' }}>✓ {s.confidenceType}</span>}
                  {s.dataSource && <span style={{ fontSize: '10px', color: TEXT3, marginLeft: '4px' }}>· {s.dataSource}</span>}
                  <span style={{ fontSize: '10px', color: TEXT3, marginLeft: 'auto' }}>
                    {fmtDate(s.date)} · {Math.round(s.timeWeight * 100)}%
                  </span>
                </div>
              </div>
                    ))}
              </>
            )}

            {/* Emerging Signals */}
            {filteredSignals.filter(s => (s.weightedScore ?? 0) >= 40 && (s.weightedScore ?? 0) <= 70).length > 0 && (
              <>
                <div style={{ fontSize: '10px', fontWeight: 700, color: YELLOW, marginTop: '8px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {'→ EMERGING SIGNALS (Score 40-70)'}
                </div>
                {filteredSignals
                  .filter(s => (s.weightedScore ?? 0) >= 40 && (s.weightedScore ?? 0) <= 70)
                  .map((s, i) => (
                    <div key={`sig-em-${i}`} style={{
                      backgroundColor: CARD,
                      border: `1px solid ${s.isNegative ? `${RED}30` : s.isPortfolio ? `${PURPLE}40` : s.isWatchlist ? `${ACCENT}30` : BORDER}`,
                      borderRadius: '8px',
                      padding: '12px 16px',
                      borderLeft: `3px solid ${s.signalTier === 'TIER1_VERIFIED' ? '#10B981' : s.isNegative ? '#EF4444' : '#475569'}`,
                      opacity: s.signalTier === 'TIER2_INFERRED' ? 0.85 : 1,
                    }}>
                      {/* Row 1: Core info */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px' }}>{eventTypeIcon(s.eventType)}</span>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6', minWidth: '80px' }}>{s.symbol}</span>
                        {/* Current price with confidence indicator */}
                        <span style={{
                          fontSize: '11px', fontWeight: 600,
                          color: (s.lastPrice && s.lastPrice > 0) ? TEXT1 : TEXT3,
                          padding: '2px 6px', borderRadius: '3px',
                          backgroundColor: (s.lastPrice && s.lastPrice > 0) ? 'rgba(226,232,240,0.08)' : 'rgba(100,116,139,0.06)',
                          display: 'flex', alignItems: 'center', gap: '3px'
                        }}>
                          {fmtPrice(s.lastPrice)}
                          {s.dataConfidence === 'LOW' && <span style={{ fontSize: '10px', color: ORANGE }}>!</span>}
                        </span>
                        {(s.isWatchlist || s.isPortfolio) && (
                          <button onClick={(e) => { e.stopPropagation(); toggleFlag(s.symbol); }} style={{
                            fontSize: '10px', cursor: 'pointer', padding: '0 2px', border: 'none', background: 'none',
                            opacity: watchlistFlags[s.symbol] ? 1 : 0.3,
                          }} title={`Flag: ${watchlistFlags[s.symbol] || 'None'} (click to cycle)`}>
                            {watchlistFlags[s.symbol] ? flagEmoji[watchlistFlags[s.symbol]] : '⚪'}
                          </button>
                        )}
                        {s.isPortfolio && <span style={{ fontSize: '9px', color: PURPLE, fontWeight: 600 }}>PF</span>}
                        {s.isWatchlist && !s.isPortfolio && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600 }}>WL</span>}
                        {s.tag && <span style={{ 
  fontSize: '9px', 
  fontWeight: 700, 
  padding: '1px 5px', 
  borderRadius: '3px', 
  color: s.tag === 'RISK-WATCH' ? '#EF4444' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? '#F59E0B' : '#A78BFA',
  backgroundColor: s.tag === 'RISK-WATCH' ? 'rgba(239,68,68,0.12)' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? 'rgba(245,158,11,0.12)' : 'rgba(167,139,250,0.12)',
  border: `1px solid ${s.tag === 'RISK-WATCH' ? 'rgba(239,68,68,0.25)' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? 'rgba(245,158,11,0.25)' : 'rgba(167,139,250,0.25)'}`,
}}>{s.tag}</span>}
                        {s.isNegative && <span style={{ fontSize: '9px', color: RED, fontWeight: 700 }}>⚠</span>}
                        {s.lastPrice && addedPrices[s.symbol] && addedPrices[s.symbol] > 0 && (() => {
                          const pctChange = ((s.lastPrice! - addedPrices[s.symbol]) / addedPrices[s.symbol]) * 100;
                          return (
                            <span style={{
                              fontSize: '10px', fontWeight: 700,
                              color: pctChange >= 0 ? GREEN : RED,
                              padding: '1px 4px', borderRadius: '3px',
                              backgroundColor: pctChange >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                            }}>
                              {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(1)}%
                            </span>
                          );
                        })()}
                        <span style={{
                          fontSize: '10px', fontWeight: 600, color: ACCENT,
                          padding: '1px 6px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.1)',
                        }}>{s.eventType}</span>
                        {s.valueCr > 0 && (
                          <span style={{ fontSize: '12px', fontWeight: 700, color: CYAN }}>
                            {fmtCr(s.valueCr)}{s.inferenceUsed ? '*' : ''}
                          </span>
                        )}
                        {s.impactPct > 0 && (
                          <span style={{
                            fontSize: '11px', fontWeight: 700,
                            color: s.impactPct >= 8 ? GREEN : s.impactPct >= 3 ? YELLOW : TEXT2,
                          }}>{s.impactPct.toFixed(1)}%</span>
                        )}
                        {s.pctMcap !== null && s.pctMcap > 0 && (
                          <span style={{ fontSize: '11px', fontWeight: 700, color: CYAN }}>
                            {s.pctMcap.toFixed(1)}% MCap
                          </span>
                        )}
                        {s.buyerSeller && (
                          <span style={{ fontSize: '11px', color: TEXT3 }}>{s.buyerSeller.slice(0, 30)}</span>
                        )}
                        {s.premiumDiscount !== null && (
                          <span style={{ color: s.premiumDiscount >= 0 ? GREEN : RED, fontSize: '11px', fontWeight: 600 }}>
                            {s.premiumDiscount > 0 ? '+' : ''}{s.premiumDiscount.toFixed(1)}%
                          </span>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                          <span style={{
                            fontSize: '9px', fontWeight: 700, color: impactColor(s.impactLevel),
                            padding: '1px 5px', borderRadius: '3px', backgroundColor: impactBg(s.impactLevel),
                          }}>{s.impactLevel}</span>
                          <span style={{
                            fontWeight: 700, fontSize: '10px',
                            color: actionColor(s.action),
                            padding: '2px 6px', borderRadius: '4px',
                            backgroundColor: actionBg(s.action),
                          }}>{s.action}</span>
                        </div>
                      </div>
                      {/* Contradiction warnings */}
                      {s.contradictions && s.contradictions.length > 0 && (
                        <div style={{
                          fontSize: '10px', color: '#FF6B6B', fontWeight: 600, lineHeight: 1.3,
                          padding: '3px 8px', marginTop: '4px', borderRadius: '4px',
                          backgroundColor: 'rgba(255,107,107,0.06)', borderLeft: '2px solid #FF6B6B',
                        }}>
                          ⚠ {s.contradictions.join(' · ')}
                        </div>
                      )}
                      {/* Row 2: WHY explanation */}
                      <div style={{ fontSize: '11px', color: s.isNegative ? '#F87171' : '#6EE7B7', marginTop: '5px', lineHeight: 1.4, fontWeight: 500 }}>
                        {s.whyAction || s.whyItMatters}
                      </div>
                      {/* Row 3: Headline */}
                      <div style={{ fontSize: '11px', color: TEXT2, marginTop: '3px', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                        {s.headline.length > 250 ? s.headline.slice(0, 250) + '...' : s.headline}
                      </div>
                      {/* Row 4: Meta tags */}
                      <div style={{ display: 'flex', gap: '10px', marginTop: '4px', alignItems: 'center' }}>
                        {/* Signal tier */}
                        {s.signalTier && (
                          <span style={{
                            fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                            color: s.signalTier === 'TIER1_VERIFIED' ? '#10B981' : '#64748B',
                            backgroundColor: s.signalTier === 'TIER1_VERIFIED' ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.06)',
                          }}>
                            {s.signalTier === 'TIER1_VERIFIED' ? '✓ VERIFIED' : '~ INFERRED'}
                          </span>
                        )}
                        {/* Anomaly flags */}
                        {s.anomalyFlags && s.anomalyFlags.length > 0 && (
                          <span style={{ fontSize: '8px', fontWeight: 600, color: '#FF6B6B', padding: '1px 4px', borderRadius: '3px', backgroundColor: 'rgba(255,107,107,0.06)' }}>
                            ⚠ {s.anomalyFlags.length} issue{s.anomalyFlags.length > 1 ? 's' : ''}
                          </span>
                        )}
                        {/* Catalyst strength */}
                        {s.catalystStrength && (
                          <span style={{
                            fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                            color: s.catalystStrength === 'STRONG' ? '#10B981' : s.catalystStrength === 'MODERATE' ? '#F59E0B' : '#64748B',
                            backgroundColor: s.catalystStrength === 'STRONG' ? 'rgba(16,185,129,0.1)' : s.catalystStrength === 'MODERATE' ? 'rgba(245,158,11,0.1)' : 'rgba(100,116,139,0.06)',
                          }}>
                            {s.catalystStrength === 'STRONG' ? '⚡ STRONG' : s.catalystStrength === 'MODERATE' ? '◆ MOD' : '○ WEAK'}
                          </span>
                        )}
                        {s.evidenceTier && (
                          <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '2px',
                            color: s.evidenceTier === 'TIER_A' ? '#059669' : s.evidenceTier === 'TIER_B' ? '#D97706' : '#DC2626',
                            backgroundColor: s.evidenceTier === 'TIER_A' ? 'rgba(5,150,105,0.08)' : s.evidenceTier === 'TIER_B' ? 'rgba(217,119,6,0.08)' : 'rgba(220,38,38,0.08)',
                          }}>
                            {s.evidenceTier === 'TIER_A' ? 'A' : s.evidenceTier === 'TIER_B' ? 'B' : 'C'}
                          </span>
                        )}
                        {s.timeHorizon && (
                          <span style={{ fontSize: '7px', fontWeight: 600, padding: '1px 3px', borderRadius: '2px', color: '#6366F1', backgroundColor: 'rgba(99,102,241,0.06)' }}>
                            {s.timeHorizon === 'SHORT' ? 'S' : s.timeHorizon === 'MEDIUM' ? 'M' : 'L'}
                          </span>
                        )}
                        {s.watchSubtype && (
                          <span style={{ fontSize: '7px', fontWeight: 600, padding: '1px 3px', borderRadius: '2px',
                            color: '#6366F1',
                            backgroundColor: 'rgba(99,102,241,0.08)',
                          }}>
                            MONITOR
                          </span>
                        )}
                        {s.heuristicSuppressed && (
                          <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '2px', color: '#DC2626', backgroundColor: 'rgba(220,38,38,0.06)' }}>
                            TEMPLATE
                          </span>
                        )}
                        {s.client && <span style={{ fontSize: '10px', color: PURPLE }}>Client: {s.client}</span>}
                        {s.segment && <span style={{ fontSize: '10px', color: ACCENT }}>{s.segment}</span>}
                        {s.timeline && <span style={{ fontSize: '10px', color: ORANGE }}>{s.timeline}</span>}
                        <span style={{ fontSize: '10px', color: sentimentColor(s.sentiment) }}>{s.sentiment}</span>
                        {s.signalStackLevel && s.signalStackLevel !== 'WEAK' && (
                          <span style={{ fontSize: '9px', color: s.signalStackLevel === 'STRONG' ? GREEN : YELLOW }}>
                            ⚡{s.signalStackCount}
                          </span>
                        )}
                        {/* v7: conf<60 gated from actionable; show conf badge only if unusually low for context */}
                        {s.signalTierV7 === 'NOTABLE' && s.confidenceScore !== undefined && s.confidenceScore < 60 && (
                          <span style={{ fontSize: '8px', color: ORANGE, fontWeight: 600 }}>
                            conf:{s.confidenceScore}
                          </span>
                        )}
                        {s.scoreDelta !== undefined && s.scoreDelta !== 0 && (
                          <span style={{
                            fontSize: '10px',
                            color: s.scoreDelta > 0 ? GREEN : RED,
                            marginLeft: 'auto',
                          }}>
                            {s.scoreDelta > 0 ? '↑' : '↓'}{Math.abs(s.scoreDelta)}
                          </span>
                        )}
                        {s.freshness && (
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            color: FRESHNESS_COLORS[s.freshness] || TEXT3,
                          }}>
                            {s.freshness}
                          </span>
                        )}
                        <span style={{ fontSize: '10px', color: TEXT3, marginLeft: 'auto' }}>
                          {fmtDate(s.date)} · {Math.round(s.timeWeight * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
              </>
            )}

            {/* Noise */}
            {filteredSignals.filter(s => (s.weightedScore ?? 0) < 40).length > 0 && (
              <>
                <div style={{ fontSize: '10px', fontWeight: 700, color: TEXT3, marginTop: '8px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {'◇ NOISE (Score < 40)'}
                </div>
                {filteredSignals
                  .filter(s => (s.weightedScore ?? 0) < 40)
                  .map((s, i) => (
                    <div key={`sig-no-${i}`} style={{
                      backgroundColor: CARD,
                      border: `1px solid ${s.isNegative ? `${RED}30` : s.isPortfolio ? `${PURPLE}40` : s.isWatchlist ? `${ACCENT}30` : BORDER}`,
                      borderRadius: '8px',
                      padding: '12px 16px',
                      borderLeft: `3px solid ${s.signalTier === 'TIER1_VERIFIED' ? '#10B981' : s.isNegative ? '#EF4444' : '#475569'}`,
                      opacity: s.signalTier === 'TIER2_INFERRED' ? 0.85 : 1,
                    }}>
                      {/* Row 1: Core info */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px' }}>{eventTypeIcon(s.eventType)}</span>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6', minWidth: '80px' }}>{s.symbol}</span>
                        {/* Current price with confidence indicator */}
                        <span style={{
                          fontSize: '11px', fontWeight: 600,
                          color: (s.lastPrice && s.lastPrice > 0) ? TEXT1 : TEXT3,
                          padding: '2px 6px', borderRadius: '3px',
                          backgroundColor: (s.lastPrice && s.lastPrice > 0) ? 'rgba(226,232,240,0.08)' : 'rgba(100,116,139,0.06)',
                          display: 'flex', alignItems: 'center', gap: '3px'
                        }}>
                          {fmtPrice(s.lastPrice)}
                          {s.dataConfidence === 'LOW' && <span style={{ fontSize: '10px', color: ORANGE }}>!</span>}
                        </span>
                        {(s.isWatchlist || s.isPortfolio) && (
                          <button onClick={(e) => { e.stopPropagation(); toggleFlag(s.symbol); }} style={{
                            fontSize: '10px', cursor: 'pointer', padding: '0 2px', border: 'none', background: 'none',
                            opacity: watchlistFlags[s.symbol] ? 1 : 0.3,
                          }} title={`Flag: ${watchlistFlags[s.symbol] || 'None'} (click to cycle)`}>
                            {watchlistFlags[s.symbol] ? flagEmoji[watchlistFlags[s.symbol]] : '⚪'}
                          </button>
                        )}
                        {s.isPortfolio && <span style={{ fontSize: '9px', color: PURPLE, fontWeight: 600 }}>PF</span>}
                        {s.isWatchlist && !s.isPortfolio && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600 }}>WL</span>}
                        {s.tag && <span style={{ 
  fontSize: '9px', 
  fontWeight: 700, 
  padding: '1px 5px', 
  borderRadius: '3px', 
  color: s.tag === 'RISK-WATCH' ? '#EF4444' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? '#F59E0B' : '#A78BFA',
  backgroundColor: s.tag === 'RISK-WATCH' ? 'rgba(239,68,68,0.12)' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? 'rgba(245,158,11,0.12)' : 'rgba(167,139,250,0.12)',
  border: `1px solid ${s.tag === 'RISK-WATCH' ? 'rgba(239,68,68,0.25)' : s.tag === 'DATA-WATCH' || s.tag === 'DATA INSUFFICIENT' ? 'rgba(245,158,11,0.25)' : 'rgba(167,139,250,0.25)'}`,
}}>{s.tag}</span>}
                        {s.isNegative && <span style={{ fontSize: '9px', color: RED, fontWeight: 700 }}>⚠</span>}
                        {s.lastPrice && addedPrices[s.symbol] && addedPrices[s.symbol] > 0 && (() => {
                          const pctChange = ((s.lastPrice! - addedPrices[s.symbol]) / addedPrices[s.symbol]) * 100;
                          return (
                            <span style={{
                              fontSize: '10px', fontWeight: 700,
                              color: pctChange >= 0 ? GREEN : RED,
                              padding: '1px 4px', borderRadius: '3px',
                              backgroundColor: pctChange >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                            }}>
                              {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(1)}%
                            </span>
                          );
                        })()}
                        <span style={{
                          fontSize: '10px', fontWeight: 600, color: ACCENT,
                          padding: '1px 6px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.1)',
                        }}>{s.eventType}</span>
                        {s.valueCr > 0 && (
                          <span style={{ fontSize: '12px', fontWeight: 700, color: CYAN }}>
                            {fmtCr(s.valueCr)}{s.inferenceUsed ? '*' : ''}
                          </span>
                        )}
                        {s.impactPct > 0 && (
                          <span style={{
                            fontSize: '11px', fontWeight: 700,
                            color: s.impactPct >= 8 ? GREEN : s.impactPct >= 3 ? YELLOW : TEXT2,
                          }}>{s.impactPct.toFixed(1)}%</span>
                        )}
                        {s.pctMcap !== null && s.pctMcap > 0 && (
                          <span style={{ fontSize: '11px', fontWeight: 700, color: CYAN }}>
                            {s.pctMcap.toFixed(1)}% MCap
                          </span>
                        )}
                        {s.buyerSeller && (
                          <span style={{ fontSize: '11px', color: TEXT3 }}>{s.buyerSeller.slice(0, 30)}</span>
                        )}
                        {s.premiumDiscount !== null && (
                          <span style={{ color: s.premiumDiscount >= 0 ? GREEN : RED, fontSize: '11px', fontWeight: 600 }}>
                            {s.premiumDiscount > 0 ? '+' : ''}{s.premiumDiscount.toFixed(1)}%
                          </span>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                          <span style={{
                            fontSize: '9px', fontWeight: 700, color: impactColor(s.impactLevel),
                            padding: '1px 5px', borderRadius: '3px', backgroundColor: impactBg(s.impactLevel),
                          }}>{s.impactLevel}</span>
                          <span style={{
                            fontWeight: 700, fontSize: '10px',
                            color: actionColor(s.action),
                            padding: '2px 6px', borderRadius: '4px',
                            backgroundColor: actionBg(s.action),
                          }}>{s.action}</span>
                        </div>
                      </div>
                      {/* Contradiction warnings */}
                      {s.contradictions && s.contradictions.length > 0 && (
                        <div style={{
                          fontSize: '10px', color: '#FF6B6B', fontWeight: 600, lineHeight: 1.3,
                          padding: '3px 8px', marginTop: '4px', borderRadius: '4px',
                          backgroundColor: 'rgba(255,107,107,0.06)', borderLeft: '2px solid #FF6B6B',
                        }}>
                          ⚠ {s.contradictions.join(' · ')}
                        </div>
                      )}
                      {/* Row 2: WHY explanation */}
                      <div style={{ fontSize: '11px', color: s.isNegative ? '#F87171' : '#6EE7B7', marginTop: '5px', lineHeight: 1.4, fontWeight: 500 }}>
                        {s.whyAction || s.whyItMatters}
                      </div>
                      {/* Row 3: Headline */}
                      <div style={{ fontSize: '11px', color: TEXT2, marginTop: '3px', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                        {s.headline.length > 250 ? s.headline.slice(0, 250) + '...' : s.headline}
                      </div>
                      {/* Row 4: Meta tags */}
                      <div style={{ display: 'flex', gap: '10px', marginTop: '4px', alignItems: 'center' }}>
                        {/* Signal tier */}
                        {s.signalTier && (
                          <span style={{
                            fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                            color: s.signalTier === 'TIER1_VERIFIED' ? '#10B981' : '#64748B',
                            backgroundColor: s.signalTier === 'TIER1_VERIFIED' ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.06)',
                          }}>
                            {s.signalTier === 'TIER1_VERIFIED' ? '✓ VERIFIED' : '~ INFERRED'}
                          </span>
                        )}
                        {/* Anomaly flags */}
                        {s.anomalyFlags && s.anomalyFlags.length > 0 && (
                          <span style={{ fontSize: '8px', fontWeight: 600, color: '#FF6B6B', padding: '1px 4px', borderRadius: '3px', backgroundColor: 'rgba(255,107,107,0.06)' }}>
                            ⚠ {s.anomalyFlags.length} issue{s.anomalyFlags.length > 1 ? 's' : ''}
                          </span>
                        )}
                        {/* Catalyst strength */}
                        {s.catalystStrength && (
                          <span style={{
                            fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                            color: s.catalystStrength === 'STRONG' ? '#10B981' : s.catalystStrength === 'MODERATE' ? '#F59E0B' : '#64748B',
                            backgroundColor: s.catalystStrength === 'STRONG' ? 'rgba(16,185,129,0.1)' : s.catalystStrength === 'MODERATE' ? 'rgba(245,158,11,0.1)' : 'rgba(100,116,139,0.06)',
                          }}>
                            {s.catalystStrength === 'STRONG' ? '⚡ STRONG' : s.catalystStrength === 'MODERATE' ? '◆ MOD' : '○ WEAK'}
                          </span>
                        )}
                        {s.evidenceTier && (
                          <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '2px',
                            color: s.evidenceTier === 'TIER_A' ? '#059669' : s.evidenceTier === 'TIER_B' ? '#D97706' : '#DC2626',
                            backgroundColor: s.evidenceTier === 'TIER_A' ? 'rgba(5,150,105,0.08)' : s.evidenceTier === 'TIER_B' ? 'rgba(217,119,6,0.08)' : 'rgba(220,38,38,0.08)',
                          }}>
                            {s.evidenceTier === 'TIER_A' ? 'A' : s.evidenceTier === 'TIER_B' ? 'B' : 'C'}
                          </span>
                        )}
                        {s.timeHorizon && (
                          <span style={{ fontSize: '7px', fontWeight: 600, padding: '1px 3px', borderRadius: '2px', color: '#6366F1', backgroundColor: 'rgba(99,102,241,0.06)' }}>
                            {s.timeHorizon === 'SHORT' ? 'S' : s.timeHorizon === 'MEDIUM' ? 'M' : 'L'}
                          </span>
                        )}
                        {s.watchSubtype && (
                          <span style={{ fontSize: '7px', fontWeight: 600, padding: '1px 3px', borderRadius: '2px',
                            color: '#6366F1',
                            backgroundColor: 'rgba(99,102,241,0.08)',
                          }}>
                            MONITOR
                          </span>
                        )}
                        {s.heuristicSuppressed && (
                          <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '2px', color: '#DC2626', backgroundColor: 'rgba(220,38,38,0.06)' }}>
                            TEMPLATE
                          </span>
                        )}
                        {s.client && <span style={{ fontSize: '10px', color: PURPLE }}>Client: {s.client}</span>}
                        {s.segment && <span style={{ fontSize: '10px', color: ACCENT }}>{s.segment}</span>}
                        {s.timeline && <span style={{ fontSize: '10px', color: ORANGE }}>{s.timeline}</span>}
                        <span style={{ fontSize: '10px', color: sentimentColor(s.sentiment) }}>{s.sentiment}</span>
                        {s.signalStackLevel && s.signalStackLevel !== 'WEAK' && (
                          <span style={{ fontSize: '9px', color: s.signalStackLevel === 'STRONG' ? GREEN : YELLOW }}>
                            ⚡{s.signalStackCount}
                          </span>
                        )}
                        {/* v7: conf<60 gated from actionable; show conf badge only if unusually low for context */}
                        {s.signalTierV7 === 'NOTABLE' && s.confidenceScore !== undefined && s.confidenceScore < 60 && (
                          <span style={{ fontSize: '8px', color: ORANGE, fontWeight: 600 }}>
                            conf:{s.confidenceScore}
                          </span>
                        )}
                        {s.scoreDelta !== undefined && s.scoreDelta !== 0 && (
                          <span style={{
                            fontSize: '10px',
                            color: s.scoreDelta > 0 ? GREEN : RED,
                            marginLeft: 'auto',
                          }}>
                            {s.scoreDelta > 0 ? '↑' : '↓'}{Math.abs(s.scoreDelta)}
                          </span>
                        )}
                        {s.freshness && (
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            color: FRESHNESS_COLORS[s.freshness] || TEXT3,
                          }}>
                            {s.freshness}
                          </span>
                        )}
                        <span style={{ fontSize: '10px', color: TEXT3, marginLeft: 'auto' }}>
                          {fmtDate(s.date)} · {Math.round(s.timeWeight * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MONITOR LIST — Institutional Grade ── */}
      {monitorList.length > 0 && typeFilter === 'ALL' && (
        <div style={{ marginTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, letterSpacing: '0.05em' }}>
              MONITOR LIST ({monitorList.length})
              <span style={{ fontSize: '9px', fontWeight: 400, color: TEXT3, letterSpacing: 'normal', marginLeft: '8px' }}>
                Ranked by materiality · confidence-weighted
              </span>
            </div>
            {/* Data quality summary */}
            {(() => {
              const verified = monitorList.filter(s => s.confidenceType === 'ACTUAL' || s.dataType === 'FACT').length;
              const inferred = monitorList.filter(s => s.confidenceType === 'INFERRED' || s.confidenceType === 'HEURISTIC').length;
              return (
                <div style={{ display: 'flex', gap: '8px', fontSize: '9px' }}>
                  {verified > 0 && <span style={{ color: GREEN, fontWeight: 600 }}>{verified} verified</span>}
                  {inferred > 0 && <span style={{ color: TEXT3, fontWeight: 600 }}>{inferred} estimated</span>}
                </div>
              );
            })()}
          </div>
          {monitorList.slice(0, 30).map((s, i) => {
            const mScore = s.materialityScore || 0;
            const confScore = s.monitorScore || s.dataConfidenceScore || s.confidenceScore || 0;
            const tierColor = mScore >= 75 ? GREEN : mScore >= 60 ? '#3B82F6' : mScore >= 45 ? '#F59E0B' : TEXT3;
            const tierBg = mScore >= 75 ? 'rgba(16,185,129,0.06)' : mScore >= 60 ? 'rgba(59,130,246,0.06)' : mScore >= 45 ? 'rgba(245,158,11,0.06)' : 'rgba(100,116,139,0.03)';
            const tierBorder = mScore >= 75 ? 'rgba(16,185,129,0.15)' : mScore >= 60 ? 'rgba(59,130,246,0.15)' : mScore >= 45 ? 'rgba(245,158,11,0.15)' : 'rgba(100,116,139,0.08)';
            const isEstimated = s.inferenceUsed || s.confidenceType === 'HEURISTIC' || s.confidenceType === 'INFERRED';
            return (
              <div key={`mon-${i}`} style={{
                padding: '10px 14px', marginBottom: '5px', borderRadius: '8px',
                backgroundColor: tierBg,
                border: `1px solid ${tierBorder}`,
                borderLeft: `3px solid ${tierColor}`,
                opacity: isEstimated ? 0.85 : 1,
              }}>
                {/* Row 1: Symbol + Event + Value */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px' }}>{eventTypeIcon(s.eventType)}</span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#3B82F6' }}>{s.symbol}</span>
                    {s.company && s.company !== s.symbol && (
                      <span style={{ fontSize: '10px', color: TEXT3 }}>{s.company.length > 25 ? s.company.substring(0, 25) + '...' : s.company}</span>
                    )}
                    {s.isPortfolio && <span style={{ fontSize: '8px', color: PURPLE, fontWeight: 700, padding: '1px 4px', borderRadius: '3px', backgroundColor: 'rgba(139,92,246,0.15)' }}>PF</span>}
                    {s.isWatchlist && !s.isPortfolio && <span style={{ fontSize: '8px', color: ACCENT, fontWeight: 700, padding: '1px 4px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.15)' }}>WL</span>}
                    <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.08)', color: ACCENT, fontWeight: 600 }}>
                      {s.eventType}
                    </span>
                    {s.valueCr > 0 && (
                      <span style={{ fontSize: '12px', fontWeight: 700, color: CYAN }}>
                        {fmtCr(s.valueCr)}{isEstimated ? '*' : ''}
                      </span>
                    )}
                    {s.signalClass && s.signalClass !== 'COMPLIANCE' && (
                      <span style={{ fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '2px',
                        color: s.signalClass === 'ECONOMIC' ? '#10B981' : s.signalClass === 'STRATEGIC' ? '#8B5CF6' : '#F59E0B',
                        backgroundColor: s.signalClass === 'ECONOMIC' ? 'rgba(16,185,129,0.1)' : s.signalClass === 'STRATEGIC' ? 'rgba(139,92,246,0.1)' : 'rgba(245,158,11,0.1)',
                      }}>{s.signalClass}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                      fontSize: '9px', fontWeight: 600,
                      color: confScore >= 70 ? GREEN : confScore >= 50 ? YELLOW : confScore >= 35 ? ORANGE : RED,
                      padding: '1px 4px', borderRadius: '3px',
                      backgroundColor: confScore >= 70 ? 'rgba(16,185,129,0.08)' : confScore >= 50 ? 'rgba(251,191,36,0.08)' : 'rgba(239,68,68,0.06)',
                    }}>
                      C:{Math.round(confScore)}
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: tierColor,
                      padding: '2px 8px', borderRadius: '4px', backgroundColor: `${tierColor}15`,
                      border: `1px solid ${tierColor}25`,
                    }}>
                      {mScore}
                    </span>
                    <span style={{ fontSize: '9px', color: TEXT3 }}>{fmtDate(s.date)}</span>
                  </div>
                </div>
                {/* Row 2: Insight */}
                {(s.whyItMatters || s.whatHappened) && (
                  <div style={{ fontSize: '11px', color: TEXT2, lineHeight: 1.4, marginTop: '2px' }}>
                    {(() => {
                      let text = s.whatHappened || s.whyItMatters || '';
                      // Clean up template patterns that look repetitive
                      text = text.replace(/\[UNVERIFIED\]\s*/g, '');
                      return text.substring(0, 120) + (text.length > 120 ? '...' : '');
                    })()}
                  </div>
                )}
                {!s.whyItMatters && !s.whatHappened && s.headline && (
                  <div style={{ fontSize: '10px', color: TEXT3, lineHeight: 1.4, marginTop: '2px' }}>
                    {(() => {
                      let h = s.headline;
                      h = h.replace(/\[UNVERIFIED\]\s*/g, '').replace(/\(est\.?\)/g, '').replace(/\s{2,}/g, ' ').trim();
                      return h.substring(0, 100) + (h.length > 100 ? '...' : '');
                    })()}
                  </div>
                )}
                {/* Row 3: Meta badges */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {s.impactPct > 0 && !isEstimated && (
                    <span style={{ fontSize: '9px', fontWeight: 700, color: s.impactPct >= 8 ? GREEN : s.impactPct >= 3 ? YELLOW : TEXT3 }}>
                      {s.impactPct.toFixed(1)}% rev
                    </span>
                  )}
                  {s.pctMcap !== null && s.pctMcap > 0 && (
                    <span style={{ fontSize: '9px', fontWeight: 600, color: CYAN }}>
                      {s.pctMcap.toFixed(1)}% MCap
                    </span>
                  )}
                  {s.segment && <span style={{ fontSize: '9px', color: TEXT3 }}>{s.segment}</span>}
                  {s.evidenceTier && (
                    <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '2px',
                      color: s.evidenceTier === 'TIER_A' ? '#059669' : s.evidenceTier === 'TIER_B' ? '#D97706' : s.evidenceTier === 'TIER_C' ? '#DC2626' : '#6B7280',
                      backgroundColor: s.evidenceTier === 'TIER_A' ? 'rgba(5,150,105,0.08)' : s.evidenceTier === 'TIER_B' ? 'rgba(217,119,6,0.08)' : s.evidenceTier === 'TIER_C' ? 'rgba(220,38,38,0.08)' : 'rgba(107,114,128,0.08)',
                    }}>{s.evidenceTier.replace('TIER_', '')}</span>
                  )}
                  {isEstimated && (
                    <span style={{ fontSize: '7px', fontWeight: 600, padding: '1px 4px', borderRadius: '2px', color: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.08)' }}>EST</span>
                  )}
                  {s.dataType === 'FACT' && (
                    <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 4px', borderRadius: '2px', color: GREEN, backgroundColor: 'rgba(16,185,129,0.08)' }}>CONFIRMED</span>
                  )}
                  <span style={{ fontSize: '9px', color: sentimentColor(s.sentiment), marginLeft: 'auto' }}>{s.sentiment}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty / Computing state — only show if truly no signals at all */}
      {!loading && signals.length === 0 && monitorList.length === 0 && notableSignals.length === 0 && top3.length === 0 && speculativeSignals.length === 0 && (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          {computing ? (
            <>
              <Zap size={40} color={ACCENT} style={{ margin: '0 auto 12px', display: 'block' }} />
              <p style={{ color: ACCENT, fontSize: '14px', fontWeight: 600 }}>Computing intelligence signals...</p>
              <p style={{ color: TEXT3, fontSize: '12px' }}>
                Fetching from NSE + Moneycontrol. Auto-refresh in 20s (attempt {computePollCount + 1}/15).
              </p>
              <div style={{ width: '200px', height: '3px', backgroundColor: BORDER, borderRadius: '2px', margin: '16px auto 0', overflow: 'hidden' }}>
                <div style={{ height: '100%', backgroundColor: ACCENT, borderRadius: '2px', width: '35%', animation: 'progress-bar 2s linear infinite' }} />
              </div>
            </>
          ) : (
            <>
              <Eye size={40} color={TEXT3} style={{ margin: '0 auto 12px', display: 'block' }} />
              <p style={{ color: TEXT2, fontSize: '14px', fontWeight: 600 }}>No signals in {daysFilter}D window</p>
              <p style={{ color: TEXT3, fontSize: '12px' }}>
                {daysFilter <= 7 ? `Try 14D or 30D for a wider view` : 'Check during market hours or add more stocks to your watchlist'}
              </p>
            </>
          )}
        </div>
      )}
      <style>{`@keyframes progress-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
      </> /* end mainTab === 'intelligence' */}
    </div>
  );
}
