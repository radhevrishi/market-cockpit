'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Shield, RefreshCw, TrendingUp, TrendingDown, Minus, Eye, Filter, Zap, Building2, DollarSign } from 'lucide-react';

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

// ── Types ──
type ActionFlag = 'BUY WATCH' | 'HOLD CONTEXT' | 'IGNORE';
type ImpactType = 'Revenue Impact' | 'Margin Impact' | 'Sentiment Only' | 'Noise';

interface Signal {
  symbol: string;
  company: string;
  date: string;
  source: 'order' | 'deal';
  eventType: string;
  headline: string;
  valueCr: number | null;
  valueUsd: string | null;
  mcapCr: number | null;
  revenueCr: number | null;
  pctRevenue: number | null;
  pctMcap: number | null;
  client: string | null;
  segment: string | null;
  timeline: string | null;
  buyerSeller: string | null;
  premiumDiscount: number | null;
  impactType: ImpactType;
  action: ActionFlag;
  score: number;
  sentiment: 'Bullish' | 'Neutral' | 'Bearish';
  isWatchlist: boolean;
}

interface DailyBias {
  netBias: 'Bullish' | 'Neutral' | 'Bearish';
  highImpactCount: number;
  activeSectors: string[];
  buyWatchCount: number;
  totalSignals: number;
  totalOrderValueCr: number;
  totalDealValueCr: number;
  summary: string;
}

// ── Helpers ──
const actionColor = (a: ActionFlag) => a === 'BUY WATCH' ? GREEN : a === 'HOLD CONTEXT' ? YELLOW : TEXT3;
const actionBg = (a: ActionFlag) => a === 'BUY WATCH' ? 'rgba(16,185,129,0.12)' : a === 'HOLD CONTEXT' ? 'rgba(251,191,36,0.10)' : 'rgba(100,116,139,0.08)';
const impactColor = (t: ImpactType) => t === 'Revenue Impact' ? GREEN : t === 'Margin Impact' ? CYAN : TEXT3;
const biasColor = (b: string) => b === 'Bullish' ? GREEN : b === 'Bearish' ? RED : YELLOW;
const biasIcon = (b: string) => b === 'Bullish' ? <TrendingUp size={16} /> : b === 'Bearish' ? <TrendingDown size={16} /> : <Minus size={16} />;

const fmtCr = (v: number | null): string => {
  if (v === null || v === undefined) return '—';
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  if (v >= 1) return `₹${Math.round(v)} Cr`;
  return `₹${Math.round(v * 100)}L`;
};

const fmtDate = (d: string) => {
  try {
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

type FilterType = 'ALL' | 'ORDERS' | 'CAPEX' | 'DEALS' | 'STRATEGIC';

export default function CompanyIntelligencePage() {
  const [top3, setTop3] = useState<Signal[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [bias, setBias] = useState<DailyBias | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [daysFilter, setDaysFilter] = useState(7);
  const [typeFilter, setTypeFilter] = useState<FilterType>('ALL');
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let watchlist: string[] = [];
      try {
        const wlRes = await fetch('/api/watchlist?chatId=5057319640');
        const wlData = await wlRes.json();
        if (wlData.watchlist?.length) {
          watchlist = wlData.watchlist;
          localStorage.setItem('mc_watchlist_tickers', JSON.stringify(watchlist));
        }
      } catch {
        const s = localStorage.getItem('mc_watchlist_tickers') || '[]';
        watchlist = JSON.parse(s);
      }

      const wlParam = watchlist.length > 0 ? `&watchlist=${watchlist.join(',')}` : '';
      const res = await fetch(`/api/market/intelligence?days=${daysFilter}${wlParam}`);
      const data = await res.json();

      setTop3(data.top3 || []);
      setSignals(data.signals || []);
      setBias(data.bias || null);
      setLastUpdated(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error('[Intelligence] Error:', err);
    }
    setLoading(false);
  }, [daysFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const iv = setInterval(fetchData, 120000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // Filter signals
  const filteredSignals = useMemo(() => {
    let list = signals;
    if (showWatchlistOnly) list = list.filter(s => s.isWatchlist);
    if (typeFilter === 'ORDERS') list = list.filter(s => ['Order Win', 'Contract', 'LOI'].includes(s.eventType));
    if (typeFilter === 'CAPEX') list = list.filter(s => ['Capex/Expansion', 'Fund Raising', 'Guidance'].includes(s.eventType));
    if (typeFilter === 'DEALS') list = list.filter(s => s.source === 'deal');
    if (typeFilter === 'STRATEGIC') list = list.filter(s => ['M&A', 'Demerger', 'JV/Partnership', 'Buyback'].includes(s.eventType));
    return list;
  }, [signals, typeFilter, showWatchlistOnly]);

  // Stats
  const orderSignals = signals.filter(s => ['Order Win', 'Contract', 'LOI'].includes(s.eventType));
  const capexSignals = signals.filter(s => ['Capex/Expansion', 'Fund Raising'].includes(s.eventType));
  const dealSignals = signals.filter(s => s.source === 'deal');
  const watchlistSignals = signals.filter(s => s.isWatchlist);

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={22} color={ACCENT} />
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: TEXT1 }}>Company Intelligence</h1>
            <p style={{ fontSize: '11px', color: TEXT3, margin: 0 }}>
              Material events · Orders · Capex · Deals · Institutional-grade signals
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
          <button onClick={fetchData} style={{
            background: 'none', border: `1px solid ${BORDER}`, borderRadius: '5px',
            padding: '4px 8px', cursor: 'pointer', color: TEXT3,
          }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {lastUpdated && <span style={{ fontSize: '11px', color: TEXT3 }}>{lastUpdated}</span>}
        </div>
      </div>

      {/* ── DAILY MARKET BIAS PANEL ── */}
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
                {bias.netBias}
              </div>
              <span style={{ fontSize: '12px', color: TEXT2 }}>{bias.summary}</span>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              {[
                { label: 'BUY WATCH', value: bias.buyWatchCount, color: GREEN },
                { label: 'High Impact', value: bias.highImpactCount, color: ACCENT },
                { label: 'Total Signals', value: bias.totalSignals, color: CYAN },
                ...(bias.totalOrderValueCr > 0 ? [{ label: 'Order Value', value: fmtCr(bias.totalOrderValueCr), color: PURPLE }] : []),
                ...(bias.totalDealValueCr > 0 ? [{ label: 'Deal Value', value: fmtCr(bias.totalDealValueCr), color: ORANGE }] : []),
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '10px', color: TEXT3 }}>{s.label}</div>
                </div>
              ))}
            </div>
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

      {/* Loading */}
      {loading && top3.length === 0 && (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <div style={{ width: '28px', height: '28px', border: '3px solid #1A2840', borderTopColor: ACCENT, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
          <p style={{ color: TEXT3, fontSize: '13px' }}>Scanning corporate announcements, block deals, bulk deals...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
                border: `1px solid ${actionColor(s.action)}30`,
                borderLeft: `4px solid ${actionColor(s.action)}`,
                borderRadius: '10px',
                padding: '14px 18px',
              }}>
                {/* Row 1: Symbol, Action, Value, Materiality */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px' }}>{eventTypeIcon(s.eventType)}</span>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#3B82F6' }}>{s.symbol}</span>
                  {s.isWatchlist && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600, padding: '1px 5px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.15)' }}>WL</span>}
                  <span style={{
                    fontSize: '11px', fontWeight: 700, color: actionColor(s.action),
                    padding: '2px 8px', borderRadius: '4px', backgroundColor: actionBg(s.action),
                  }}>{s.action}</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: ACCENT, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(15,122,191,0.1)' }}>{s.eventType}</span>
                  {s.valueCr !== null && s.valueCr > 0 && (
                    <span style={{ fontSize: '13px', fontWeight: 700, color: CYAN }}>{fmtCr(s.valueCr)}</span>
                  )}
                  <span style={{ fontSize: '11px', color: TEXT3, marginLeft: 'auto' }}>Score: {s.score}</span>
                </div>

                {/* Row 2: Materiality badges */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px', paddingLeft: '2px' }}>
                  {s.pctRevenue !== null && s.pctRevenue > 0 && (
                    <span style={{
                      fontSize: '12px', fontWeight: 700, padding: '3px 10px', borderRadius: '6px',
                      backgroundColor: s.pctRevenue >= 5 ? 'rgba(16,185,129,0.15)' : s.pctRevenue >= 1 ? 'rgba(251,191,36,0.12)' : 'rgba(100,116,139,0.1)',
                      color: s.pctRevenue >= 5 ? GREEN : s.pctRevenue >= 1 ? YELLOW : TEXT2,
                    }}>{s.pctRevenue.toFixed(1)}% of Revenue</span>
                  )}
                  {s.pctMcap !== null && s.pctMcap > 0 && (
                    <span style={{
                      fontSize: '12px', fontWeight: 700, padding: '3px 10px', borderRadius: '6px',
                      backgroundColor: s.pctMcap >= 5 ? 'rgba(16,185,129,0.15)' : 'rgba(6,182,212,0.12)',
                      color: s.pctMcap >= 5 ? GREEN : CYAN,
                    }}>{s.pctMcap.toFixed(1)}% of MCap</span>
                  )}
                  {s.mcapCr && <span style={{ fontSize: '11px', color: TEXT3 }}>MCap: {fmtCr(s.mcapCr)}</span>}
                  {s.revenueCr && <span style={{ fontSize: '11px', color: TEXT3 }}>Rev: {fmtCr(s.revenueCr)}</span>}
                  <span style={{ fontSize: '11px', color: impactColor(s.impactType), fontWeight: 600 }}>{s.impactType}</span>
                </div>

                {/* Row 3: Headline / context */}
                <div style={{ fontSize: '12px', color: TEXT2, lineHeight: 1.6, paddingLeft: '2px' }}>
                  {s.headline.length > 200 ? s.headline.slice(0, 200) + '...' : s.headline}
                </div>

                {/* Row 4: Meta */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', paddingLeft: '2px' }}>
                  {s.client && <span style={{ fontSize: '10px', color: PURPLE }}>Client: {s.client}</span>}
                  {s.segment && <span style={{ fontSize: '10px', color: ACCENT }}>Sector: {s.segment}</span>}
                  {s.timeline && <span style={{ fontSize: '10px', color: ORANGE }}>Timeline: {s.timeline}</span>}
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
          {([
            { key: 'ALL' as FilterType, label: 'All', count: signals.length },
            { key: 'ORDERS' as FilterType, label: 'Orders', count: orderSignals.length },
            { key: 'CAPEX' as FilterType, label: 'Capex/Growth', count: capexSignals.length },
            { key: 'DEALS' as FilterType, label: 'Block/Bulk', count: dealSignals.length },
            { key: 'STRATEGIC' as FilterType, label: 'Strategic', count: signals.filter(s => ['M&A', 'Demerger', 'JV/Partnership', 'Buyback'].includes(s.eventType)).length },
          ]).map(f => (
            <button key={f.key} onClick={() => setTypeFilter(f.key)} style={{
              padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${typeFilter === f.key ? ACCENT : BORDER}`,
              background: typeFilter === f.key ? 'rgba(15,122,191,0.15)' : 'transparent',
              color: typeFilter === f.key ? ACCENT : TEXT3,
            }}>{f.label} ({f.count})</button>
          ))}
          <button onClick={() => setShowWatchlistOnly(!showWatchlistOnly)} style={{
            padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${showWatchlistOnly ? GREEN : BORDER}`,
            background: showWatchlistOnly ? 'rgba(16,185,129,0.15)' : 'transparent',
            color: showWatchlistOnly ? GREEN : TEXT3, marginLeft: 'auto',
          }}>WL Only ({watchlistSignals.length})</button>
        </div>
      )}

      {/* ── ALL SIGNALS ── */}
      {filteredSignals.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
            {typeFilter === 'ALL' ? 'ALL SIGNALS' : typeFilter} ({filteredSignals.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filteredSignals.map((s, i) => (
              <div key={`sig-${i}`} style={{
                backgroundColor: CARD,
                border: `1px solid ${s.isWatchlist ? `${ACCENT}40` : BORDER}`,
                borderRadius: '8px',
                padding: '12px 16px',
              }}>
                {/* Row 1: Core info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px' }}>{eventTypeIcon(s.eventType)}</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6', minWidth: '80px' }}>{s.symbol}</span>
                  {s.isWatchlist && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600 }}>WL</span>}
                  <span style={{
                    fontSize: '10px', fontWeight: 600, color: ACCENT,
                    padding: '1px 6px', borderRadius: '3px', backgroundColor: 'rgba(15,122,191,0.1)',
                  }}>{s.eventType}</span>

                  {/* Value */}
                  {s.valueCr !== null && s.valueCr > 0 && (
                    <span style={{ fontSize: '12px', fontWeight: 700, color: CYAN }}>{fmtCr(s.valueCr)}</span>
                  )}

                  {/* Materiality */}
                  {s.pctRevenue !== null && s.pctRevenue > 0 && (
                    <span style={{
                      fontSize: '11px', fontWeight: 700,
                      color: s.pctRevenue >= 5 ? GREEN : s.pctRevenue >= 1 ? YELLOW : TEXT2,
                    }}>{s.pctRevenue.toFixed(1)}% Rev</span>
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
                    <span style={{ fontSize: '10px', color: impactColor(s.impactType) }}>{s.impactType.replace(' Impact', '')}</span>
                    <span style={{
                      fontWeight: 700, fontSize: '10px',
                      color: actionColor(s.action),
                      padding: '2px 6px', borderRadius: '4px',
                      backgroundColor: actionBg(s.action),
                    }}>{s.action}</span>
                  </div>
                </div>

                {/* Row 2: Headline */}
                <div style={{ fontSize: '11px', color: TEXT2, marginTop: '5px', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                  {s.headline.length > 250 ? s.headline.slice(0, 250) + '...' : s.headline}
                </div>

                {/* Row 3: Meta tags */}
                {(s.client || s.segment || s.timeline) && (
                  <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                    {s.client && <span style={{ fontSize: '10px', color: PURPLE }}>Client: {s.client}</span>}
                    {s.segment && <span style={{ fontSize: '10px', color: ACCENT }}>{s.segment}</span>}
                    {s.timeline && <span style={{ fontSize: '10px', color: ORANGE }}>{s.timeline}</span>}
                    <span style={{ fontSize: '10px', color: TEXT3, marginLeft: 'auto' }}>{fmtDate(s.date)}</span>
                  </div>
                )}
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
