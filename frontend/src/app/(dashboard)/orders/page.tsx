'use client';

import { useEffect, useState, useCallback } from 'react';
import { Shield, RefreshCw, TrendingUp, TrendingDown, Minus, Eye, ArrowUpRight } from 'lucide-react';

// Theme — darker text for readability
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
const TEXT1 = '#E2E8F0'; // Primary text
const TEXT2 = '#94A3B8'; // Secondary
const TEXT3 = '#64748B'; // Muted

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
const sentimentColor = (s: string) => s === 'Bullish' ? GREEN : s === 'Bearish' ? RED : TEXT3;

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

export default function CompanyIntelligencePage() {
  const [top3, setTop3] = useState<Signal[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [bias, setBias] = useState<DailyBias | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [daysFilter, setDaysFilter] = useState(7);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Get watchlist from Redis API
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

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={22} color={ACCENT} />
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: TEXT1 }}>Company Intelligence</h1>
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
            {/* Net Bias */}
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
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color: GREEN }}>{bias.buyWatchCount}</div>
                <div style={{ fontSize: '10px', color: TEXT3 }}>BUY WATCH</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color: ACCENT }}>{bias.highImpactCount}</div>
                <div style={{ fontSize: '10px', color: TEXT3 }}>High Impact</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color: CYAN }}>{bias.totalSignals}</div>
                <div style={{ fontSize: '10px', color: TEXT3 }}>Signals</div>
              </div>
              {bias.totalOrderValueCr > 0 && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: PURPLE }}>{fmtCr(bias.totalOrderValueCr)}</div>
                  <div style={{ fontSize: '10px', color: TEXT3 }}>Orders</div>
                </div>
              )}
              {bias.totalDealValueCr > 0 && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: ORANGE }}>{fmtCr(bias.totalDealValueCr)}</div>
                  <div style={{ fontSize: '10px', color: TEXT3 }}>Deals</div>
                </div>
              )}
            </div>
          </div>

          {/* Active sectors */}
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
          <p style={{ color: TEXT3, fontSize: '13px' }}>Scanning market signals...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── TOP 3 ACTIONABLE SIGNALS ── */}
      {top3.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
            TOP ACTIONABLE SIGNALS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {top3.map((s, i) => (
              <div key={`top-${i}`} style={{
                backgroundColor: CARD,
                border: `1px solid ${actionColor(s.action)}30`,
                borderLeft: `4px solid ${actionColor(s.action)}`,
                borderRadius: '8px',
                padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  {/* Rank */}
                  <span style={{
                    fontSize: '14px', fontWeight: 800, color: actionColor(s.action),
                    width: '22px', textAlign: 'center',
                  }}>{i + 1}</span>

                  {/* Symbol */}
                  <span style={{ fontSize: '15px', fontWeight: 700, color: TEXT1 }}>{s.symbol}</span>

                  {/* Action badge */}
                  <span style={{
                    fontSize: '11px', fontWeight: 700, color: actionColor(s.action),
                    padding: '2px 8px', borderRadius: '4px', backgroundColor: actionBg(s.action),
                  }}>{s.action}</span>

                  {/* Value */}
                  {s.valueCr !== null && s.valueCr > 0 && (
                    <span style={{ fontSize: '13px', fontWeight: 700, color: CYAN }}>{fmtCr(s.valueCr)}</span>
                  )}

                  {/* % Revenue */}
                  {s.pctRevenue !== null && (
                    <span style={{
                      fontSize: '12px', fontWeight: 700,
                      color: s.pctRevenue >= 5 ? GREEN : s.pctRevenue >= 1 ? YELLOW : TEXT2,
                    }}>{s.pctRevenue.toFixed(1)}% Rev</span>
                  )}

                  {/* Impact type */}
                  <span style={{ fontSize: '11px', color: impactColor(s.impactType) }}>{s.impactType}</span>

                  {/* Score */}
                  <span style={{ fontSize: '11px', color: TEXT3, marginLeft: 'auto' }}>Score: {s.score}</span>
                </div>

                {/* Headline */}
                <div style={{ fontSize: '12px', color: TEXT2, marginTop: '4px', paddingLeft: '32px' }}>
                  {s.headline}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SIGNAL TABLE ── */}
      {signals.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: TEXT3, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
            ALL SIGNALS ({signals.length})
          </div>

          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '100px 1fr 100px 80px 80px 90px',
            gap: '8px', padding: '6px 12px', marginBottom: '2px',
            fontSize: '10px', fontWeight: 600, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            <div>Company</div>
            <div>Event</div>
            <div>Impact</div>
            <div>% Rev</div>
            <div>Value</div>
            <div>Action</div>
          </div>

          {/* Signal rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {signals.map((s, i) => (
              <div key={`sig-${i}`} style={{
                display: 'grid',
                gridTemplateColumns: '100px 1fr 100px 80px 80px 90px',
                gap: '8px', padding: '10px 12px',
                backgroundColor: CARD,
                border: `1px solid ${s.isWatchlist ? `${ACCENT}40` : BORDER}`,
                borderRadius: '6px',
                alignItems: 'center',
                fontSize: '12px',
              }}>
                {/* Company */}
                <div>
                  <div style={{ fontWeight: 700, color: TEXT1, fontSize: '13px' }}>{s.symbol}</div>
                  {s.isWatchlist && <span style={{ fontSize: '9px', color: ACCENT, fontWeight: 600 }}>WL</span>}
                </div>

                {/* Event */}
                <div style={{ color: TEXT2, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{
                    color: s.source === 'deal'
                      ? (s.sentiment === 'Bullish' ? GREEN : RED)
                      : ACCENT,
                    fontWeight: 600, marginRight: '6px',
                  }}>{s.eventType}</span>
                  {s.client && <span style={{ color: TEXT3 }}>from {s.client} </span>}
                  {s.segment && <span style={{ color: PURPLE }}>• {s.segment} </span>}
                  {s.buyerSeller && <span style={{ color: TEXT3 }}>{s.buyerSeller.slice(0, 25)} </span>}
                  {s.premiumDiscount !== null && (
                    <span style={{ color: s.premiumDiscount >= 0 ? GREEN : RED }}>
                      {s.premiumDiscount > 0 ? '+' : ''}{s.premiumDiscount.toFixed(1)}%
                    </span>
                  )}
                </div>

                {/* Impact */}
                <div style={{ color: impactColor(s.impactType), fontSize: '11px', fontWeight: 600 }}>
                  {s.impactType.replace(' Impact', '')}
                </div>

                {/* % Revenue */}
                <div style={{
                  fontWeight: 700, fontSize: '12px',
                  color: s.pctRevenue !== null
                    ? (s.pctRevenue >= 5 ? GREEN : s.pctRevenue >= 1 ? YELLOW : TEXT3)
                    : TEXT3,
                }}>
                  {s.pctRevenue !== null ? `${s.pctRevenue.toFixed(1)}%` : '—'}
                </div>

                {/* Value */}
                <div style={{ color: s.valueCr && s.valueCr > 0 ? CYAN : TEXT3, fontWeight: 600 }}>
                  {s.valueCr && s.valueCr > 0 ? fmtCr(s.valueCr) : '—'}
                </div>

                {/* Action */}
                <div style={{
                  fontWeight: 700, fontSize: '11px',
                  color: actionColor(s.action),
                  padding: '2px 6px', borderRadius: '4px',
                  backgroundColor: actionBg(s.action),
                  textAlign: 'center',
                }}>
                  {s.action}
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
