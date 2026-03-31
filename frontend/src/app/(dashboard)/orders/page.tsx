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

// ── Tab cache: Avoid refetching on every tab switch ──
// Module-level cache persists across component remounts (tab switches)
// Only refetches on explicit refresh or after CACHE_TTL expires
const CACHE_TTL = 120000; // 2 min
let _cache: { data: any; timestamp: number } | null = null;

// ── Types ──
type ActionFlag = 'BUY WATCH' | 'TRACK' | 'IGNORE';
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
}

interface DailyBias {
  netBias: 'Bullish' | 'Neutral' | 'Bearish';
  highImpactCount: number;
  activeSectors: string[];
  buyWatchCount: number;
  trackCount: number;
  totalSignals: number;
  totalOrderValueCr: number;
  totalDealValueCr: number;
  portfolioAlerts: number;
  negativeSignals: number;
  summary: string;
}

// ── Helpers ──
const actionColor = (a: ActionFlag) => a === 'BUY WATCH' ? GREEN : a === 'TRACK' ? ACCENT : TEXT3;
const actionBg = (a: ActionFlag) => a === 'BUY WATCH' ? 'rgba(16,185,129,0.12)' : a === 'TRACK' ? 'rgba(15,122,191,0.10)' : 'rgba(100,116,139,0.08)';
const impactColor = (l: ImpactLevel) => l === 'HIGH' ? GREEN : l === 'MEDIUM' ? YELLOW : TEXT3;
const impactBg = (l: ImpactLevel) => l === 'HIGH' ? 'rgba(16,185,129,0.12)' : l === 'MEDIUM' ? 'rgba(251,191,36,0.10)' : 'rgba(100,116,139,0.06)';
const biasColor = (b: string) => b === 'Bullish' ? GREEN : b === 'Bearish' ? RED : YELLOW;
const biasIcon = (b: string) => b === 'Bullish' ? <TrendingUp size={16} /> : b === 'Bearish' ? <TrendingDown size={16} /> : <Minus size={16} />;
const sentimentColor = (s: string) => s === 'Bullish' ? GREEN : s === 'Bearish' ? RED : TEXT3;

const fmtCr = (v: number | null): string => {
  if (v === null || v === undefined) return '—';
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  if (v >= 1) return `₹${Math.round(v)} Cr`;
  return `₹${Math.round(v * 100)}L`;
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

type FilterType = 'ALL' | 'BUY_WATCH' | 'ORDERS' | 'CAPEX' | 'DEALS' | 'STRATEGIC' | 'NEGATIVE';
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

  const fetchData = useCallback(async (forceRefresh = false) => {
    // Tab cache: if data was fetched recently and not forcing refresh, use cached data
    if (!forceRefresh && _cache && (Date.now() - _cache.timestamp) < CACHE_TTL) {
      const data = _cache.data;
      setTop3(data.top3 || []);
      setSignals(data.signals || []);
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
      setTrends(data.trends || []);
      setBias(data.bias || null);
      if (data.debug) setDebugInfo(data.debug);
      setIsStale(!!data.stale);
      const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      setLastUpdated(ts);

      // Cache for tab switching
      _cache = { data: { ...data, flags, addedPrices: prices, lastUpdated: ts }, timestamp: Date.now() };
    } catch (err) {
      console.error('[Intelligence] Error:', err);
    }
    setLoading(false);
  }, [daysFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    // Auto-refresh forces fresh data every 2 min
    const iv = setInterval(() => fetchData(true), 120000);
    return () => clearInterval(iv);
  }, [fetchData]);

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
    if (typeFilter === 'BUY_WATCH') list = list.filter(s => s.action === 'BUY WATCH');
    if (typeFilter === 'ORDERS') list = list.filter(s => ['Order Win', 'Contract', 'LOI'].includes(s.eventType));
    if (typeFilter === 'CAPEX') list = list.filter(s => ['Capex/Expansion', 'Fund Raising', 'Guidance'].includes(s.eventType));
    if (typeFilter === 'DEALS') list = list.filter(s => s.source === 'deal');
    if (typeFilter === 'STRATEGIC') list = list.filter(s => ['M&A', 'Demerger', 'JV/Partnership', 'Buyback'].includes(s.eventType));
    if (typeFilter === 'NEGATIVE') list = list.filter(s => s.isNegative);
    return list;
  }, [signals, typeFilter, universeFilter]);

  // Stats
  const buyWatchSignals = signals.filter(s => s.action === 'BUY WATCH');
  const negativeCount = signals.filter(s => s.isNegative).length;
  const portfolioCount = signals.filter(s => s.isPortfolio).length;
  const watchlistCount = signals.filter(s => s.isWatchlist).length;

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
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {[3, 7, 14, 30].map(d => (
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
                { label: 'High Impact', value: bias.highImpactCount, color: GREEN },
                { label: 'BUY WATCH', value: bias.buyWatchCount, color: GREEN },
                { label: 'TRACK', value: bias.trackCount, color: ACCENT },
                { label: 'Portfolio Alerts', value: bias.portfolioAlerts, color: PURPLE },
                ...(bias.negativeSignals > 0 ? [{ label: '⚠ Negative', value: bias.negativeSignals, color: RED }] : []),
                ...(bias.totalOrderValueCr > 0 ? [{ label: 'Order Value', value: fmtCr(bias.totalOrderValueCr) as any, color: CYAN }] : []),
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
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
                      fontSize: '9px', fontWeight: 600, color: actionColor(t.topAction),
                      padding: '1px 5px', borderRadius: '3px', backgroundColor: actionBg(t.topAction),
                    }}>{t.topAction}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: TEXT2, marginBottom: '2px' }}>{t.company}</div>
                  <div style={{ display: 'flex', gap: '10px', fontSize: '10px' }}>
                    <span style={{ color: stackColor }}>{t.signalCount} signals</span>
                    <span style={{ color: sentimentColor(t.netSentiment) }}>{t.netSentiment}</span>
                    <span style={{ color: impactColor(t.topImpact) }}>{t.topImpact}</span>
                    <span style={{ color: TEXT3 }}>Score: {t.avgScore}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TOP ACTIONABLE SIGNALS ── */}
      {top3.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
            TOP ACTIONABLE SIGNALS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {top3.map((s, i) => (
              <div key={`top-${i}`} style={{
                backgroundColor: CARD,
                border: `1px solid ${s.isNegative ? `${RED}40` : `${actionColor(s.action)}30`}`,
                borderLeft: `4px solid ${s.isNegative ? RED : actionColor(s.action)}`,
                borderRadius: '10px',
                padding: '14px 18px',
              }}>
                {/* Row 1: Symbol, Action, Impact, Value */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px' }}>{eventTypeIcon(s.eventType)}</span>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#3B82F6' }}>{s.symbol}</span>
                  {s.isPortfolio && <span style={{ fontSize: '9px', color: PURPLE, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(139,92,246,0.15)' }}>PF</span>}
                  {s.isWatchlist && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.15)' }}>WL</span>}
                  {s.isNegative && <span style={{ fontSize: '9px', color: RED, fontWeight: 700, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(239,68,68,0.12)' }}>⚠ NEGATIVE</span>}
                  <span style={{
                    fontSize: '11px', fontWeight: 700, color: actionColor(s.action),
                    padding: '2px 8px', borderRadius: '4px', backgroundColor: actionBg(s.action),
                  }}>{s.action}</span>
                  <span style={{
                    fontSize: '10px', fontWeight: 700, color: impactColor(s.impactLevel),
                    padding: '2px 6px', borderRadius: '4px', backgroundColor: impactBg(s.impactLevel),
                  }}>{s.impactLevel} IMPACT</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: ACCENT, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(15,122,191,0.1)' }}>{s.eventType}</span>
                  {s.valueCr !== null && s.valueCr > 0 && (
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

                {/* Row 2: QUANT DATA — Event Value | Revenue | Impact % */}
                <div style={{
                  display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '6px', padding: '6px 8px',
                  backgroundColor: 'rgba(6,182,212,0.05)', borderRadius: '6px', border: '1px solid rgba(6,182,212,0.1)',
                }}>
                  <span style={{ fontSize: '12px', color: TEXT2 }}>
                    Event: <span style={{ fontWeight: 700, color: CYAN }}>{fmtCr(s.valueCr)}</span>
                    {s.inferenceUsed && <span style={{ fontSize: '9px', color: TEXT3, marginLeft: '3px' }}>(est.)</span>}
                  </span>
                  {s.revenueCr && s.revenueCr > 0 && (
                    <span style={{ fontSize: '12px', color: TEXT2 }}>
                      Rev: <span style={{ fontWeight: 700, color: TEXT1 }}>{fmtCr(s.revenueCr)}</span>
                    </span>
                  )}
                  <span style={{
                    fontSize: '13px', fontWeight: 800, padding: '2px 10px', borderRadius: '6px',
                    backgroundColor: s.impactPct >= 8 ? 'rgba(16,185,129,0.2)' : s.impactPct >= 3 ? 'rgba(251,191,36,0.15)' : 'rgba(100,116,139,0.1)',
                    color: s.impactPct >= 8 ? GREEN : s.impactPct >= 3 ? YELLOW : TEXT2,
                  }}>Impact: {s.impactPct.toFixed(1)}% {s.impactPct >= 8 ? '→ HIGH' : s.impactPct >= 3 ? '→ MEDIUM' : '→ LOW'}
                    {s.inferenceUsed && ' (est.)'}
                  </span>
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
                  {s.confidenceType && (
                    <span style={{
                      fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
                      backgroundColor: s.confidenceType === 'ACTUAL' ? 'rgba(16,185,129,0.15)' : s.confidenceType === 'INFERRED' ? 'rgba(251,191,36,0.15)' : 'rgba(100,116,139,0.12)',
                      color: s.confidenceType === 'ACTUAL' ? GREEN : s.confidenceType === 'INFERRED' ? YELLOW : TEXT3,
                    }}>
                      {s.confidenceType === 'ACTUAL' ? '✓ ACTUAL' : s.confidenceType === 'INFERRED' ? '~ INFERRED' : '? HEURISTIC'}
                    </span>
                  )}
                </div>

                {/* Row 3: WHY IT MATTERS — the institutional insight */}
                <div style={{
                  fontSize: '12px', color: s.isNegative ? RED : GREEN, fontWeight: 600, lineHeight: 1.5,
                  padding: '6px 10px', marginBottom: '6px', borderRadius: '6px',
                  backgroundColor: s.isNegative ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.06)',
                  borderLeft: `3px solid ${s.isNegative ? RED : GREEN}`,
                }}>
                  💡 {s.whyItMatters}
                </div>

                {/* Row 4: Headline / context */}
                <div style={{ fontSize: '11px', color: TEXT2, lineHeight: 1.5, paddingLeft: '2px' }}>
                  {s.headline.length > 200 ? s.headline.slice(0, 200) + '...' : s.headline}
                </div>

                {/* Row 5: Meta */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', paddingLeft: '2px' }}>
                  {s.client && <span style={{ fontSize: '10px', color: PURPLE }}>Client: {s.client}</span>}
                  {s.segment && <span style={{ fontSize: '10px', color: ACCENT }}>Sector: {s.segment}</span>}
                  {s.timeline && <span style={{ fontSize: '10px', color: ORANGE }}>Timeline: {s.timeline}</span>}
                  <span style={{ fontSize: '10px', color: sentimentColor(s.sentiment) }}>{s.sentiment}</span>
                  <span style={{ fontSize: '10px', color: TEXT3 }}>{fmtDate(s.date)}</span>
                </div>
              </div>
            ))}
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
            { key: 'BUY_WATCH' as FilterType, label: `🎯 BUY WATCH (${buyWatchSignals.length})` },
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
        </div>
      )}

      {/* ── ALL SIGNALS ── */}
      {filteredSignals.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
            {typeFilter === 'ALL' ? 'ALL SIGNALS' : typeFilter.replace('_', ' ')} ({filteredSignals.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filteredSignals.map((s, i) => (
              <div key={`sig-${i}`} style={{
                backgroundColor: CARD,
                border: `1px solid ${s.isNegative ? `${RED}30` : s.isPortfolio ? `${PURPLE}40` : s.isWatchlist ? `${ACCENT}30` : BORDER}`,
                borderRadius: '8px',
                padding: '12px 16px',
              }}>
                {/* Row 1: Core info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px' }}>{eventTypeIcon(s.eventType)}</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6', minWidth: '80px' }}>{s.symbol}</span>
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

                  {/* Value — always shown */}
                  <span style={{ fontSize: '12px', fontWeight: 700, color: CYAN }}>
                    {fmtCr(s.valueCr)}{s.inferenceUsed ? '*' : ''}
                  </span>

                  {/* Impact % — always shown */}
                  <span style={{
                    fontSize: '11px', fontWeight: 700,
                    color: s.impactPct >= 8 ? GREEN : s.impactPct >= 3 ? YELLOW : TEXT2,
                  }}>{s.impactPct.toFixed(1)}%</span>
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

                {/* Row 2: Why It Matters */}
                <div style={{ fontSize: '11px', color: s.isNegative ? '#F87171' : '#6EE7B7', marginTop: '5px', lineHeight: 1.4, fontWeight: 500 }}>
                  💡 {s.whyItMatters}
                </div>

                {/* Row 3: Headline */}
                <div style={{ fontSize: '11px', color: TEXT2, marginTop: '3px', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                  {s.headline.length > 250 ? s.headline.slice(0, 250) + '...' : s.headline}
                </div>

                {/* Row 4: Meta tags */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '4px', alignItems: 'center' }}>
                  {s.client && <span style={{ fontSize: '10px', color: PURPLE }}>Client: {s.client}</span>}
                  {s.segment && <span style={{ fontSize: '10px', color: ACCENT }}>{s.segment}</span>}
                  {s.timeline && <span style={{ fontSize: '10px', color: ORANGE }}>{s.timeline}</span>}
                  <span style={{ fontSize: '10px', color: sentimentColor(s.sentiment) }}>{s.sentiment}</span>
                  {s.signalStackLevel && s.signalStackLevel !== 'WEAK' && (
                    <span style={{ fontSize: '9px', color: s.signalStackLevel === 'STRONG' ? GREEN : YELLOW }}>
                      ⚡{s.signalStackCount}
                    </span>
                  )}
                  {s.confidenceType && (
                    <span style={{
                      fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                      backgroundColor: s.confidenceType === 'ACTUAL' ? 'rgba(16,185,129,0.15)' : s.confidenceType === 'INFERRED' ? 'rgba(251,191,36,0.15)' : 'rgba(100,116,139,0.12)',
                      color: s.confidenceType === 'ACTUAL' ? GREEN : s.confidenceType === 'INFERRED' ? YELLOW : TEXT3,
                    }}>
                      {s.confidenceType === 'ACTUAL' ? '✓' : s.confidenceType === 'INFERRED' ? '~' : '?'}
                    </span>
                  )}
                  {s.dataSource && (
                    <span style={{ fontSize: '8px', color: TEXT3, padding: '1px 4px', borderRadius: '3px', backgroundColor: 'rgba(100,116,139,0.08)' }}>
                      {s.dataSource}
                    </span>
                  )}
                  {s.confidenceScore !== undefined && s.confidenceScore <= 50 && (
                    <span style={{ fontSize: '8px', color: ORANGE, fontWeight: 600 }}>
                      low conf.
                    </span>
                  )}
                  <span style={{ fontSize: '10px', color: TEXT3, marginLeft: 'auto' }}>
                    {fmtDate(s.date)} · {Math.round(s.timeWeight * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && signals.length === 0 && (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <Eye size={40} color={TEXT3} style={{ margin: '0 auto 12px', display: 'block' }} />
          <p style={{ color: TEXT2, fontSize: '14px', fontWeight: 600 }}>No actionable signals</p>
          <p style={{ color: TEXT3, fontSize: '12px' }}>Try a wider date range or check during market hours</p>
        </div>
      )}
    </div>
  );
}
