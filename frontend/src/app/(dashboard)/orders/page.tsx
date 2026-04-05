'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Shield, RefreshCw, TrendingUp, TrendingDown, Minus, Eye, Filter, Zap, AlertTriangle } from 'lucide-react';

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
const CACHE_TTL = 120000; // 2 min
let _cache: { data: any; timestamp: number } | null = null;

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

  // v8: Thematic alpha
  alphaTheme?: {
    tag: string;
    label: string;
    score: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    narrative: string;
  };
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

type FilterType = 'ALL' | 'BUY' | 'ADD' | 'HOLD' | 'WATCH' | 'TRIM' | 'ORDERS' | 'CAPEX' | 'DEALS' | 'STRATEGIC' | 'NEGATIVE';
type UniverseFilter = 'ALL' | 'PORTFOLIO' | 'WATCHLIST';

const CHAT_ID = '5057319640';

export default function CompanyIntelligencePage() {
  const [top3, setTop3] = useState<Signal[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trends, setTrends] = useState<CompanyTrend[]>([]);
  const [bias, setBias] = useState<DailyBias | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [productionStatus, setProductionStatus] = useState<string>('');

  const fetchData = useCallback(async (forceRefresh = false) => {
    // Tab cache: if data was fetched recently and not forcing refresh, use cached data
    if (!forceRefresh && _cache && (Date.now() - _cache.timestamp) < CACHE_TTL) {
      const data = _cache.data;
      setTop3(data.top3 || []);
      setSignals(data.signals || []);
      setNotableSignals(data.notable || []);
      setThematicIdeas(data.thematicIdeas || []);
      setTrends(data.trends || []);
      setBias(data.bias || null);
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

      const wlParam = watchlist.length > 0 ? `&watchlist=${watchlist.join(',')}` : '';
      const pfParam = portfolio.length > 0 ? `&portfolio=${portfolio.join(',')}` : '';
      const res = await fetch(`/api/market/intelligence?days=${daysFilter}${wlParam}${pfParam}&debug=true`);
      const data = await res.json();

      setTop3(data.top3 || []);
      setSignals(data.signals || []);
      setNotableSignals(data.notable || []);
      setThematicIdeas(data.thematicIdeas || []);
      setTrends(data.trends || []);
      setBias(data.bias || null);
      setNoHighConfSignals(!!data.noHighConfSignals);
      setNoActionableSignals(!!data.noActionableSignals);
      setMonitorList(data.observations || []);
      setProductionStatus(data._stats ?
        `${data._stats.actionable || 0} actionable · ${data._stats.notable || 0} notable · ${data._stats.monitor || 0} monitor · ${data._stats.rejected || 0} rejected` : (data._productionStatus || ''));
      if (data.debug) setDebugInfo(data.debug);
      setIsStale(!!data.stale);
      const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      setLastUpdated(ts);

      // Detect computing state
      const isComputing = data._meta?.computing === true || data._meta?.source === 'skeleton';
      setComputing(isComputing);
      if (!isComputing) setComputePollCount(0);

      // Cache for tab switching (only cache real data, not skeletons)
      if (!isComputing) {
        _cache = { data: { ...data, notable: data.notable || [], thematicIdeas: data.thematicIdeas || [], flags, addedPrices: prices, lastUpdated: ts }, timestamp: Date.now() };
      }
    } catch (err) {
      console.error('[Intelligence] Error:', err);
    }
    setLoading(false);
  }, [daysFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-poll every 20s when computing (up to 15 attempts = ~5 min)
  useEffect(() => {
    if (!computing) return;
    if (computePollCount >= 15) return;
    const timer = setTimeout(() => {
      setComputePollCount(p => p + 1);
      fetchData(true);
    }, 20000);
    return () => clearTimeout(timer);
  }, [computing, computePollCount, fetchData]);

  useEffect(() => {
    // Regular auto-refresh every 2 min when NOT computing
    if (computing) return;
    const iv = setInterval(() => fetchData(true), 120000);
    return () => clearInterval(iv);
  }, [fetchData, computing]);

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
  const totalSignalValue = signals.filter(s => s.valueCr > 0).reduce((sum, s) => sum + s.valueCr, 0);

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={22} color={ACCENT} />
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: TEXT1 }}>Company Intelligence</h1>
            <p style={{ fontSize: '11px', color: TEXT3, margin: 0 }}>
              Decision-ready signals · Impact-ranked · Time-weighted · Deduped
              {computing && <span style={{ marginLeft: '8px', color: ACCENT }}>⟳ Computing...</span>}
            </p>
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
        </div>
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
                { label: 'High Impact', value: bias.highImpactCount, color: GREEN, filter: null as FilterType | null },
                { label: 'Actionable', value: bias.buyCount || 0, color: GREEN, filter: 'BUY' as FilterType | null },
                { label: 'HOLD', value: bias.holdCount || 0, color: ACCENT, filter: 'HOLD' as FilterType | null },
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

      {/* Loading */}
      {loading && top3.length === 0 && (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <div style={{ width: '28px', height: '28px', border: '3px solid #1A2840', borderTopColor: ACCENT, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
          <p style={{ color: TEXT3, fontSize: '13px' }}>Scanning corporate announcements, block deals, bulk deals...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── TREND LAYER (Signal Stacking) ── */}
      {trends.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
            SIGNAL STACKING — MULTI-EVENT COMPANIES
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {trends.map(t => {
              const stackColor = t.stackLevel === 'STRONG' ? GREEN : t.stackLevel === 'BUILDING' ? YELLOW : TEXT3;
              return (
                <div key={t.symbol} style={{
                  backgroundColor: CARD, border: `1px solid ${stackColor}30`, borderLeft: `3px solid ${stackColor}`,
                  borderRadius: '8px', padding: '10px 14px', minWidth: '200px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6' }}>{t.symbol}</span>
                    <span style={{
                      fontSize: '9px', fontWeight: 700, color: stackColor,
                      padding: '1px 5px', borderRadius: '3px', backgroundColor: `${stackColor}15`,
                    }}>{t.stackLevel}</span>
                    <span style={{
                      fontSize: '9px', fontWeight: 600, color: actionColor(remapActionLabel(t.topAction)),
                      padding: '1px 5px', borderRadius: '3px', backgroundColor: actionBg(remapActionLabel(t.topAction)),
                    }}>{remapActionLabel(t.topAction)}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: TEXT2, marginBottom: '2px' }}>{t.company}</div>
                  <div style={{ display: 'flex', gap: '10px', fontSize: '10px' }}>
                    <span style={{ color: stackColor }}>{t.signalCount} signals</span>
                    <span style={{ color: sentimentColor(t.netSentiment) }}>{t.netSentiment}</span>
                    <span style={{ color: impactColor(t.topImpact) }}>{t.topImpact}</span>
                    <span style={{ color: TEXT3 }}>Top: {t.maxScore ?? t.avgScore}</span>
                    <span style={{ color: TEXT3 }}>Avg: {t.avgScore}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {noActionableSignals && !loading && (
        <div style={{
          padding: '12px 16px', marginBottom: '16px', borderRadius: '8px',
          backgroundColor: 'rgba(15,122,191,0.06)',
          border: '1px solid rgba(15,122,191,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: ACCENT, fontWeight: 600 }}>
              NO HIGH-CONFIDENCE ACTIONABLE SIGNALS TODAY
            </span>
            <span style={{ fontSize: '11px', color: TEXT3 }}>
              {notableSignals.length > 0 ? `${notableSignals.length} Notable · ` : ''}{monitorList.length > 0 ? `${Math.min(monitorList.length, 10)} Monitor` : 'System functioning correctly'}
            </span>
          </div>
          {productionStatus && (
            <span style={{ fontSize: '10px', color: TEXT3 }}>{productionStatus}</span>
          )}
        </div>
      )}

      {/* ── THEMATIC INTELLIGENCE (v8) — always shown when ideas available ── */}
      {thematicIdeas.length > 0 && !loading && (
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
      {top3.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {noActionableSignals || signals.length === 0 ? (top3.length > 0 ? 'TOP MONITOR SIGNALS' : 'NO HIGH-CONFIDENCE ACTIONABLE SIGNALS TODAY') : `✅ ACTIONABLE SIGNALS (${signals.length})`}
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
                  {s.signalStackLevel && s.signalStackLevel !== 'WEAK' && (
                    <span style={{ fontSize: '9px', color: s.signalStackLevel === 'STRONG' ? GREEN : YELLOW, fontWeight: 600 }}>
                      ⚡{s.signalStackCount} signals
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
                  {s.confidenceType && <span style={{ fontSize: '10px', color: s.confidenceType === 'ACTUAL' ? GREEN : s.confidenceType === 'INFERRED' ? YELLOW : TEXT3, marginLeft: '4px' }}>✓ {s.confidenceType}</span>}
                  {s.dataSource && <span style={{ fontSize: '10px', color: TEXT3, marginLeft: '4px' }}>· {s.dataSource}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── NOTABLE SIGNALS ── */}
      {notableSignals.length > 0 && (
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
                    {s.inferenceUsed && (
                      <span style={{ fontSize: '8px', color: ORANGE, fontWeight: 600 }}>~INFERRED</span>
                    )}
                    {s.confidenceScore !== undefined && (
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

      {/* ── FILTER BAR ── */}
      {signals.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Filter size={13} color={TEXT3} />

          {/* Universe filter */}
          {([
            { key: 'ALL' as UniverseFilter, label: 'All', count: signals.length },
            { key: 'PORTFOLIO' as UniverseFilter, label: 'Portfolio', count: portfolioCount },
            { key: 'WATCHLIST' as UniverseFilter, label: 'Watchlist', count: watchlistCount },
          ]).map(f => (
            <button key={f.key} onClick={() => setUniverseFilter(f.key)} style={{
              padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${universeFilter === f.key ? PURPLE : BORDER}`,
              background: universeFilter === f.key ? 'rgba(139,92,246,0.15)' : 'transparent',
              color: universeFilter === f.key ? PURPLE : TEXT3,
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
            {filteredSignals.filter(s => s.weightedScore > 70).length > 0 && (
              <>
                <div style={{ fontSize: '10px', fontWeight: 700, color: GREEN, marginTop: '8px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {'✓ HIGH CONVICTION (Score > 70)'}
                </div>
                {filteredSignals
                  .filter(s => s.weightedScore > 70)
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

                {/* Row 2: WHY explanation (institutional-grade) */}
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
            {filteredSignals.filter(s => s.weightedScore >= 40 && s.weightedScore <= 70).length > 0 && (
              <>
                <div style={{ fontSize: '10px', fontWeight: 700, color: YELLOW, marginTop: '8px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {'→ EMERGING SIGNALS (Score 40-70)'}
                </div>
                {filteredSignals
                  .filter(s => s.weightedScore >= 40 && s.weightedScore <= 70)
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
            {filteredSignals.filter(s => s.weightedScore < 40).length > 0 && (
              <>
                <div style={{ fontSize: '10px', fontWeight: 700, color: TEXT3, marginTop: '8px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {'◇ NOISE (Score < 40)'}
                </div>
                {filteredSignals
                  .filter(s => s.weightedScore < 40)
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

      {/* ── MONITOR LIST ── */}
      {monitorList.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, letterSpacing: '0.05em', marginBottom: '12px' }}>
            MONITOR LIST ({monitorList.length})
            <span style={{ fontSize: '9px', fontWeight: 400, color: TEXT3, letterSpacing: 'normal', marginLeft: '8px' }}>
              Ranked by signal quality score
            </span>
          </div>
          {monitorList.slice(0, 30).map((s, i) => {
            const mScore = s.materialityScore || 0;
            // Tier color coding based on materialityScore thresholds: ≥75: GREEN, ≥60: BLUE, ≥45: AMBER, <45: GRAY
            const mTier = mScore >= 75 ? 'HIGH' : mScore >= 60 ? 'MEDIUM' : mScore >= 45 ? 'WATCH' : 'LOW';
            const tierColor = mScore >= 75 ? GREEN : mScore >= 60 ? '#3B82F6' : mScore >= 45 ? '#F59E0B' : TEXT3;
            const tierBg = mScore >= 75 ? 'rgba(16,185,129,0.06)' : mScore >= 60 ? 'rgba(59,130,246,0.06)' : mScore >= 45 ? 'rgba(245,158,11,0.06)' : 'rgba(100,116,139,0.03)';
            const tierBorder = mScore >= 75 ? 'rgba(16,185,129,0.15)' : mScore >= 60 ? 'rgba(59,130,246,0.15)' : mScore >= 45 ? 'rgba(245,158,11,0.15)' : 'rgba(100,116,139,0.08)';
            return (
              <div key={`mon-${i}`} style={{
                padding: '8px 12px', marginBottom: '4px', borderRadius: '6px',
                backgroundColor: tierBg,
                border: `1px solid ${tierBorder}`,
                borderLeft: `3px solid ${tierColor}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: TEXT1 }}>{s.symbol}</span>
                    <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(100,116,139,0.1)', color: TEXT3 }}>
                      {s.eventType}
                    </span>
                    {s.headline && (
                      <span style={{ fontSize: '10px', color: TEXT2 }}>
                        {(() => {
                          const nonFinTypes = ['Mgmt Change', 'Board Appointment', 'CEO Exit', 'CFO Exit', 'Leadership Transition', 'Regulatory'];
                          let h = s.headline;
                          if (nonFinTypes.includes(s.eventType)) {
                            h = h.replace(/\[UNVERIFIED\]\s*/g, '').replace(/₹[\d,.]+\s*(?:Cr|crore|cr)/gi, '')
                              .replace(/\d+\.?\d*%\s*(?:of\s+)?(?:revenue|mcap|impact)/gi, '')
                              .replace(/\(est\.?\)/g, '').replace(/\s*—\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
                          }
                          return h.substring(0, 80) + (h.length > 80 ? '...' : '');
                        })()}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 600, color: tierColor,
                      padding: '1px 6px', borderRadius: '3px', backgroundColor: `${tierColor}15` }}>
                      {mScore}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty / Computing state */}
      {!loading && signals.length === 0 && monitorList.length === 0 && (
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
              <p style={{ color: TEXT2, fontSize: '14px', fontWeight: 600 }}>No actionable signals</p>
              <p style={{ color: TEXT3, fontSize: '12px' }}>Try a wider date range or check during market hours</p>
            </>
          )}
        </div>
      )}
      <style>{`@keyframes progress-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
    </div>
  );
}
