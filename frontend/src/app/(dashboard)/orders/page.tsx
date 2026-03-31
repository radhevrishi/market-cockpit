'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Briefcase, RefreshCw, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Shield } from 'lucide-react';

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
const TEXT1 = '#E8ECF1';
const TEXT2 = '#9CA3AF';
const TEXT3 = '#6B7280';

// ── Types ──
interface EnrichedOrder {
  symbol: string;
  company: string;
  date: string;
  orderType: string;
  orderValueCr: number | null;
  orderValueUsd: string | null;
  mcapCr: number | null;
  pctOfMcap: number | null;
  annualRevenueCr: number | null;
  pctOfRevenue: number | null;
  client: string | null;
  segment: string | null;
  timeline: string | null;
  impactScore: number;
  signal: 'HIGH' | 'MEDIUM' | 'HIDE';
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  eventSummary: string;
  isWatchlist: boolean;
}

interface EnrichedDeal {
  symbol: string;
  company: string;
  dealDate: string;
  dealType: 'Block' | 'Bulk';
  clientName: string;
  buyOrSell: string;
  quantity: number;
  tradePrice: number;
  dealValueCr: number;
  cmp: number | null;
  premiumDiscount: number | null;
  pctEquity: number | null;
  volumeVsAvg: number | null;
  dealScore: number;
  signal: 'HIGH' | 'MEDIUM' | 'HIDE';
  isWatchlist: boolean;
}

interface IntelSummary {
  totalOrders: number;
  totalDeals: number;
  highSignalOrders: number;
  highSignalDeals: number;
  totalOrderValueCr: number;
  totalDealValueCr: number;
}

// ── Helpers ──
const fmtCr = (v: number | null): string => {
  if (v === null || v === undefined) return '—';
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  if (v >= 1) return `₹${v.toFixed(0)} Cr`;
  return `₹${(v * 100).toFixed(0)} L`;
};

const fmtPct = (v: number | null): string => {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(2)}%`;
};

const fmtDate = (dateStr: string): string => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
};

const signalColor = (s: string): string => {
  if (s === 'HIGH') return GREEN;
  if (s === 'MEDIUM') return YELLOW;
  return TEXT3;
};

const sentimentIcon = (s: string) => {
  if (s === 'Positive') return { color: GREEN, label: '▲ Positive' };
  if (s === 'Negative') return { color: RED, label: '▼ Negative' };
  return { color: TEXT2, label: '— Neutral' };
};

const orderTypeColor = (t: string): string => {
  switch (t) {
    case 'Order Win': return GREEN;
    case 'Contract': return ACCENT;
    case 'Partnership/JV': return PURPLE;
    case 'M&A': return ORANGE;
    case 'Fund Raising': return CYAN;
    case 'LOI': return YELLOW;
    case 'Management Change': return '#EC4899';
    default: return TEXT2;
  }
};

export default function CompanyIntelligencePage() {
  const [orders, setOrders] = useState<EnrichedOrder[]>([]);
  const [deals, setDeals] = useState<EnrichedDeal[]>([]);
  const [summary, setSummary] = useState<IntelSummary>({
    totalOrders: 0, totalDeals: 0, highSignalOrders: 0, highSignalDeals: 0,
    totalOrderValueCr: 0, totalDealValueCr: 0,
  });
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [daysFilter, setDaysFilter] = useState(7);

  const fetchIntelligence = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch watchlist from API (synced from Telegram via Redis) — fallback to localStorage
      let watchlist: string[] = [];
      try {
        const wlRes = await fetch('/api/watchlist?chatId=5057319640');
        const wlData = await wlRes.json();
        if (wlData.watchlist && Array.isArray(wlData.watchlist)) {
          watchlist = wlData.watchlist;
          // Also sync to localStorage for other pages
          localStorage.setItem('mc_watchlist_tickers', JSON.stringify(watchlist));
        }
      } catch {
        const watchlistStr = localStorage.getItem('mc_watchlist_tickers') || '[]';
        watchlist = JSON.parse(watchlistStr);
      }
      const wlParam = watchlist.length > 0 ? `&watchlist=${watchlist.join(',')}` : '';

      const res = await fetch(`/api/market/intelligence?days=${daysFilter}${wlParam}`);
      const data = await res.json();

      setOrders(data.corporateOrders || []);
      setDeals(data.deals || []);
      setSummary(data.summary || {
        totalOrders: 0, totalDeals: 0, highSignalOrders: 0, highSignalDeals: 0,
        totalOrderValueCr: 0, totalDealValueCr: 0,
      });
      setLastUpdated(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error('[Intelligence] Fetch error:', err);
    }
    setLoading(false);
  }, [daysFilter]);

  useEffect(() => { fetchIntelligence(); }, [fetchIntelligence]);

  // Auto-refresh every 90s
  useEffect(() => {
    const iv = setInterval(fetchIntelligence, 90000);
    return () => clearInterval(iv);
  }, [fetchIntelligence]);

  const totalHighSignal = summary.highSignalOrders + summary.highSignalDeals;
  const totalItems = orders.length + deals.length;

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Shield size={24} color={ACCENT} />
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0, color: TEXT1 }}>Company Intelligence</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Days filter */}
          {[3, 7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDaysFilter(d)}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                border: `1px solid ${daysFilter === d ? ACCENT : BORDER}`,
                background: daysFilter === d ? 'rgba(15,122,191,0.15)' : 'transparent',
                color: daysFilter === d ? ACCENT : TEXT2,
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {d}D
            </button>
          ))}
          <button
            onClick={fetchIntelligence}
            style={{
              background: 'none', border: `1px solid ${BORDER}`, borderRadius: '6px',
              padding: '5px 10px', cursor: 'pointer', color: TEXT2, display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {lastUpdated && <span style={{ fontSize: '11px', color: TEXT3 }}>{lastUpdated}</span>}
        </div>
      </div>

      {/* Summary Bar */}
      <div style={{
        display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap',
      }}>
        {[
          { label: 'Total Signals', value: totalItems, color: ACCENT },
          { label: 'High Signal', value: totalHighSignal, color: GREEN },
          { label: 'Order Value', value: fmtCr(summary.totalOrderValueCr), color: CYAN },
          { label: 'Deal Value', value: fmtCr(summary.totalDealValueCr), color: PURPLE },
        ].map((s, i) => (
          <div key={i} style={{
            backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px',
            padding: '10px 16px', flex: '1 1 140px', minWidth: '120px',
          }}>
            <div style={{ fontSize: '11px', color: TEXT3, marginBottom: '4px' }}>{s.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && orders.length === 0 && deals.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ width: '32px', height: '32px', border: '3px solid #1A2840', borderTopColor: ACCENT, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ color: TEXT3, fontSize: '13px' }}>Fetching intelligence...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── CORPORATE ORDERS ── */}
      {orders.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: TEXT2, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Corporate Orders ({orders.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {orders.map((o, i) => {
              const sent = sentimentIcon(o.sentiment);
              return (
                <div key={`order-${i}`} style={{
                  backgroundColor: CARD,
                  border: `1px solid ${o.isWatchlist ? ACCENT : BORDER}`,
                  borderLeft: `3px solid ${signalColor(o.signal)}`,
                  borderRadius: '8px',
                  padding: '12px 16px',
                }}>
                  {/* Row 1: Symbol | Value | MCap% | Revenue% | Signal */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: TEXT1 }}>{o.symbol}</span>
                    <span style={{ fontSize: '11px', color: orderTypeColor(o.orderType), fontWeight: 600, padding: '1px 6px', borderRadius: '4px', backgroundColor: `${orderTypeColor(o.orderType)}15` }}>
                      {o.orderType}
                    </span>
                    {o.orderValueCr !== null && (
                      <span style={{ fontSize: '13px', fontWeight: 700, color: CYAN }}>
                        {fmtCr(o.orderValueCr)}
                      </span>
                    )}
                    {o.orderValueUsd && (
                      <span style={{ fontSize: '11px', color: TEXT3 }}>({o.orderValueUsd})</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: signalColor(o.signal) }}>
                      {o.signal} ({o.impactScore})
                    </span>
                  </div>

                  {/* Row 2: Metrics grid */}
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    {o.pctOfMcap !== null && (
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: TEXT3 }}>MCap%</span>{' '}
                        <span style={{ color: TEXT1, fontWeight: 600 }}>{fmtPct(o.pctOfMcap)}</span>
                      </div>
                    )}
                    {o.pctOfRevenue !== null && (
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: TEXT3 }}>Rev%</span>{' '}
                        <span style={{ color: TEXT1, fontWeight: 600 }}>{fmtPct(o.pctOfRevenue)}</span>
                      </div>
                    )}
                    {o.mcapCr !== null && (
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: TEXT3 }}>MCap</span>{' '}
                        <span style={{ color: TEXT2 }}>{fmtCr(o.mcapCr)}</span>
                      </div>
                    )}
                    {o.client && (
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: TEXT3 }}>Client</span>{' '}
                        <span style={{ color: TEXT1 }}>{o.client}</span>
                      </div>
                    )}
                    {o.segment && (
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: TEXT3 }}>Segment</span>{' '}
                        <span style={{ color: PURPLE }}>{o.segment}</span>
                      </div>
                    )}
                    {o.timeline && (
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: TEXT3 }}>Timeline</span>{' '}
                        <span style={{ color: TEXT2 }}>{o.timeline}</span>
                      </div>
                    )}
                  </div>

                  {/* Row 3: Summary + Sentiment + Date */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: TEXT2, flex: 1, minWidth: '200px' }}>{o.eventSummary}</span>
                    <span style={{ fontSize: '11px', color: sent.color, fontWeight: 600 }}>{sent.label}</span>
                    <span style={{ fontSize: '11px', color: TEXT3 }}>{fmtDate(o.date)}</span>
                    {o.isWatchlist && (
                      <span style={{ fontSize: '10px', color: ACCENT, fontWeight: 700, padding: '1px 5px', border: `1px solid ${ACCENT}`, borderRadius: '3px' }}>WL</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── BLOCK & BULK DEALS ── */}
      {deals.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: TEXT2, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Block & Bulk Deals ({deals.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {deals.map((d, i) => {
              const isBuy = d.buyOrSell === 'Buy' || d.buyOrSell === 'BUY';
              return (
                <div key={`deal-${i}`} style={{
                  backgroundColor: CARD,
                  border: `1px solid ${d.isWatchlist ? ACCENT : BORDER}`,
                  borderLeft: `3px solid ${signalColor(d.signal)}`,
                  borderRadius: '8px',
                  padding: '12px 16px',
                }}>
                  {/* Row 1: Symbol | Client | Buy/Sell | Score */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: TEXT1 }}>{d.symbol}</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: isBuy ? GREEN : RED, padding: '1px 6px', borderRadius: '4px', backgroundColor: isBuy ? `${GREEN}15` : `${RED}15` }}>
                      {isBuy ? '▲ BUY' : '▼ SELL'}
                    </span>
                    <span style={{ fontSize: '11px', color: TEXT3, padding: '1px 5px', borderRadius: '3px', border: `1px solid ${BORDER}` }}>
                      {d.dealType}
                    </span>
                    <span style={{ fontSize: '12px', color: TEXT2, flex: 1, minWidth: '100px' }}>{d.clientName}</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: signalColor(d.signal) }}>
                      {d.signal} ({d.dealScore})
                    </span>
                  </div>

                  {/* Row 2: Metrics */}
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <div style={{ fontSize: '12px' }}>
                      <span style={{ color: TEXT3 }}>Value</span>{' '}
                      <span style={{ color: CYAN, fontWeight: 700 }}>{fmtCr(d.dealValueCr)}</span>
                    </div>
                    <div style={{ fontSize: '12px' }}>
                      <span style={{ color: TEXT3 }}>Price</span>{' '}
                      <span style={{ color: TEXT1 }}>₹{d.tradePrice.toFixed(2)}</span>
                    </div>
                    {d.cmp !== null && (
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: TEXT3 }}>CMP</span>{' '}
                        <span style={{ color: TEXT2 }}>₹{d.cmp.toFixed(2)}</span>
                      </div>
                    )}
                    {d.premiumDiscount !== null && (
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: TEXT3 }}>{d.premiumDiscount >= 0 ? 'Premium' : 'Discount'}</span>{' '}
                        <span style={{ color: d.premiumDiscount >= 0 ? GREEN : RED, fontWeight: 600 }}>
                          {d.premiumDiscount >= 0 ? '+' : ''}{d.premiumDiscount.toFixed(1)}%
                        </span>
                      </div>
                    )}
                    {d.pctEquity !== null && d.pctEquity > 0 && (
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: TEXT3 }}>% Equity</span>{' '}
                        <span style={{ color: PURPLE, fontWeight: 600 }}>{d.pctEquity.toFixed(3)}%</span>
                      </div>
                    )}
                    <div style={{ fontSize: '12px' }}>
                      <span style={{ color: TEXT3 }}>Qty</span>{' '}
                      <span style={{ color: TEXT2 }}>{d.quantity.toLocaleString()}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: TEXT3, marginLeft: 'auto' }}>{fmtDate(d.dealDate)}</span>
                    {d.isWatchlist && (
                      <span style={{ fontSize: '10px', color: ACCENT, fontWeight: 700, padding: '1px 5px', border: `1px solid ${ACCENT}`, borderRadius: '3px' }}>WL</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && orders.length === 0 && deals.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Shield size={48} color={TEXT3} style={{ margin: '0 auto 16px' }} />
          <p style={{ color: TEXT2, fontSize: '15px', fontWeight: 600 }}>No intelligence signals found</p>
          <p style={{ color: TEXT3, fontSize: '13px' }}>Try expanding the date range or check back during market hours</p>
        </div>
      )}
    </div>
  );
}
