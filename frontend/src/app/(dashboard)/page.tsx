'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AlertCircle, RefreshCw, Plus, TrendingUp, TrendingDown, Calendar, Newspaper } from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Position { id: string; ticker: string; exchange: string; company_name: string; quantity: number; avg_cost: number; cmp: number; pnl: number; pnl_pct: number; day_change_pct: number; weight_pct: number; [key: string]: string | number | undefined; }
interface PortfolioSummary { portfolio_id: string; portfolio_name: string; currency: string; total_value: number; total_pnl: number; total_pnl_pct: number; day_pnl: number; day_pnl_pct: number; position_count: number; positions: Position[]; }
interface NewsArticle { id: string; title: string; source: string; published_at: string; importance_score: number; tickers: string[]; region: string; url: string; }
interface CalendarEvent {
  id: string; event_type: string; ticker: string; title: string; event_date: string;
  event_time?: string; impact_level: string; company_name: string; exchange?: string;
  analyst_firm?: string; rating_prev?: string; rating_new?: string; price_target?: number;
  change_type?: string; from_rating?: string; to_rating?: string;
  indicator_name?: string; country?: string; forecast?: string; actual?: string; prior?: string;
  fiscal_quarter?: string; eps_estimate?: string; eps_actual?: string;
  dividend_amount?: number; dividend_currency?: string; source_url?: string;
  description?: string;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────
function usePortfolios() {
  return useQuery<{ id: string; name: string; currency: string }[]>({
    queryKey: ['portfolios'],
    queryFn: async () => { const { data } = await api.get('/portfolios'); return data; },
    retry: 1,
  });
}

function usePortfolioSummary(portfolioId: string | null) {
  return useQuery<PortfolioSummary>({
    queryKey: ['portfolios', portfolioId, 'summary'],
    queryFn: async () => {
      const { data } = await api.get(`/portfolios/${portfolioId}/summary`);
      return data ?? {};
    },
    enabled: !!portfolioId,
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useMustKnowNews() {
  return useQuery<NewsArticle[]>({
    queryKey: ['news', 'must-know'],
    queryFn: async () => { const { data } = await api.get('/news?min_importance=4&limit=5'); return data; },
    refetchInterval: 120_000,
    retry: 1,
  });
}

function useTodayEvents() {
  return useQuery<CalendarEvent[]>({
    queryKey: ['calendar', 'today'],
    queryFn: async () => {
      // First try today's events
      const { data: todayData } = await api.get('/calendar/today');
      if (Array.isArray(todayData) && todayData.length > 0) return todayData;
      // Fallback: show upcoming 7-day events so the section isn't always empty
      const { data: upcomingData } = await api.get('/calendar/upcoming?days=7');
      return Array.isArray(upcomingData) ? upcomingData : [];
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

// ─── Event helpers ───────────────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  EARNINGS:      { label: 'Earnings',       color: '#8B5CF6', icon: '📊' },
  RATING_CHANGE: { label: 'Rating change',  color: '#F59E0B', icon: '⭐' },
  ECONOMIC:      { label: 'Economic data',  color: '#06B6D4', icon: '📈' },
  DIVIDEND:      { label: 'Dividend',        color: '#10B981', icon: '💰' },
  SPLIT:         { label: 'Stock split',     color: '#EC4899', icon: '✂️' },
  IPO:           { label: 'IPO',             color: '#F97316', icon: '🚀' },
};

function getEventMeta(type: string) {
  return EVENT_TYPE_LABELS[type] ?? { label: type.replace(/_/g, ' '), color: '#4A5B6C', icon: '📅' };
}

/** Client-side dedup by composite key so the same event never renders twice. */
function dedupEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const ev of events) {
    const dateStr = ev.event_date ? ev.event_date.split('T')[0] : '';
    let extra = '';
    if (ev.event_type === 'RATING_CHANGE') extra = ev.analyst_firm ?? '';
    else if (ev.event_type === 'ECONOMIC') extra = ev.indicator_name ?? '';
    else if (ev.event_type === 'EARNINGS') extra = ev.fiscal_quarter ?? '';
    const key = `${ev.event_type}|${ev.ticker ?? ''}|${dateStr}|${extra}|${ev.title}`;
    if (!seen.has(key)) { seen.add(key); out.push(ev); }
  }
  return out;
}

function formatEventDate(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
    if (isToday) return `Today`;
    if (isTomorrow) return `Tomorrow`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

/** Build a human-readable subtitle for an event based on its type. */
function eventSubtitle(ev: CalendarEvent): string {
  if (ev.event_type === 'RATING_CHANGE') {
    const firm = ev.analyst_firm ?? '';
    const from = ev.from_rating ?? ev.rating_prev ?? '';
    const to = ev.to_rating ?? ev.rating_new ?? '';
    const pt = ev.price_target ? ` · PT ${ev.exchange === 'NSE' || ev.exchange === 'BSE' ? '₹' : '$'}${ev.price_target}` : '';
    if (from && to) return `${firm}: ${from} → ${to}${pt}`;
    if (firm) return `${firm}${pt}`;
    return '';
  }
  if (ev.event_type === 'EARNINGS') {
    const parts: string[] = [];
    if (ev.fiscal_quarter) parts.push(ev.fiscal_quarter);
    if (ev.eps_estimate) parts.push(`Est EPS: ${ev.eps_estimate}`);
    if (ev.eps_actual) parts.push(`Actual: ${ev.eps_actual}`);
    return parts.join(' · ');
  }
  if (ev.event_type === 'ECONOMIC') {
    const parts: string[] = [];
    if (ev.country) parts.push(ev.country === 'US' ? '🇺🇸' : ev.country === 'IN' ? '🇮🇳' : ev.country);
    if (ev.forecast) parts.push(`Fcst: ${ev.forecast}`);
    if (ev.prior) parts.push(`Prior: ${ev.prior}`);
    if (ev.actual) parts.push(`Actual: ${ev.actual}`);
    return parts.join(' · ');
  }
  if (ev.event_type === 'DIVIDEND') {
    const cur = ev.dividend_currency === 'INR' || ev.exchange === 'NSE' || ev.exchange === 'BSE' ? '₹' : '$';
    if (ev.dividend_amount) return `${cur}${ev.dividend_amount}/share`;
    return '';
  }
  return '';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Decode HTML entities like &amp; → & , &lt; → <, etc.
const decodeHtml = (html: string): string => {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.documentElement.textContent || html;
};

const pnlColor = (v: number) => v >= 0 ? '#10B981' : '#EF4444';
const fmtCurrency = (v: number, currency = 'INR') => {
  const abs = Math.abs(v);
  const prefix = currency === 'INR' ? '₹' : '$';
  if (abs >= 10000000) return `${prefix}${(v / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000)   return `${prefix}${(v / 100000).toFixed(2)}L`;
  if (abs >= 1000)     return `${prefix}${(v / 1000).toFixed(1)}K`;
  return `${prefix}${v.toFixed(2)}`;
};
const timeAgo = (iso: string) => {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  // If less than 1 minute, show "Just now"
  if (diff < 60000) return 'Just now';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ago`;
  return `${m}m ago`;
};
const importanceDot = (score: number) => {
  if (score >= 5) return '#EF4444';
  if (score >= 4) return '#F59E0B';
  return '#10B981';
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px', padding: '18px 20px' }}>
      <p style={{ fontSize: '10px', fontWeight: '600', color: '#4A5B6C', letterSpacing: '1px', textTransform: 'uppercase', margin: 0 }}>{label}</p>
      <p style={{ fontSize: '22px', fontWeight: '700', color: color || '#F5F7FA', margin: '8px 0 4px', letterSpacing: '-0.5px' }}>{value}</p>
      {sub && <p style={{ fontSize: '11px', color: '#4A5B6C', margin: 0 }}>{sub}</p>}
    </div>
  );
}

function HeatmapTile({ pos }: { pos: Position }) {
  const pct = pos.day_change_pct || 0;
  const bg = pct > 3 ? '#064e3b' : pct > 1 ? '#065f46' : pct > 0 ? '#0f766e' : pct > -1 ? '#7f1d1d' : pct > -3 ? '#991b1b' : '#450a0a';
  const border = pct > 0 ? '#10B981' : '#EF4444';
  return (
    <div style={{ backgroundColor: bg, border: `1px solid ${border}40`, borderRadius: '10px', padding: '10px 12px', cursor: 'pointer' }}>
      <p style={{ fontSize: '11px', fontWeight: '700', color: '#F5F7FA', margin: '0 0 4px' }}>{pos.ticker}</p>
      <p style={{ fontSize: '13px', fontWeight: '700', color: pct >= 0 ? '#10B981' : '#EF4444', margin: 0, whiteSpace: 'nowrap' }}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</p>
    </div>
  );
}

// ─── Empty Portfolio State ────────────────────────────────────────────────────
function EmptyPortfolioState() {
  const router = useRouter();
  return (
    <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '16px', padding: '40px', textAlign: 'center', gridColumn: '1 / -1' }}>
      <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
      <p style={{ fontSize: '16px', fontWeight: '700', color: '#F5F7FA', margin: '0 0 8px' }}>No portfolio yet</p>
      <p style={{ fontSize: '13px', color: '#4A5B6C', margin: '0 0 20px' }}>Create your first portfolio to see your P&L, movers and briefings here</p>
      <button onClick={() => router.push('/portfolios')}
        style={{ backgroundColor: '#0F7ABF', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
        + Create Portfolio
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MissionControlPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: portfolios, isLoading: ploading, error: perror } = usePortfolios();
  const primaryPortfolioId = portfolios?.[0]?.id ?? null;
  const { data: summary, isLoading: sloading, error: serror, refetch: srefetch } = usePortfolioSummary(primaryPortfolioId);
  const { data: news, isLoading: nloading } = useMustKnowNews();
  const { data: events, isLoading: eloading } = useTodayEvents();

  const currency = portfolios?.[0]?.currency || 'INR';
  const hasPortfolio = !ploading && Array.isArray(portfolios) && portfolios.length > 0;
  const noPortfolio  = !ploading && Array.isArray(portfolios) && portfolios.length === 0;
  const apiError     = !ploading && perror;

  const positions = summary?.positions || [];
  // Check if we have live day data; if not, fall back to total P&L %
  const hasLiveDayData = positions.some(p => (p.day_change_pct ?? 0) !== 0);
  const sortKey = hasLiveDayData ? 'day_change_pct' : 'pnl_pct';
  const gainers = [...positions].sort((a,b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0)).filter(p => (p[sortKey] ?? 0) > 0).slice(0,3);
  const losers  = [...positions].sort((a,b) => (a[sortKey] ?? 0) - (b[sortKey] ?? 0)).filter(p => (p[sortKey] ?? 0) < 0).slice(0,3);
  // Check if all movements are zero (indicating prices loading)
  const allMovementsZero = positions.length > 0 && positions.every(p => (p[sortKey] ?? 0) === 0);

  const handleRetry = () => {
    qc.invalidateQueries({ queryKey: ['portfolios'] });
    qc.invalidateQueries({ queryKey: ['portfolios', primaryPortfolioId, 'summary'] });
    qc.invalidateQueries({ queryKey: ['news', 'must-know'] });
    qc.invalidateQueries({ queryKey: ['calendar', 'today'] });
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>

      {/* ── API Error ── */}
      {apiError && (
        <div style={{ backgroundColor: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: '12px', padding: '12px 16px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertCircle style={{ width: '16px', height: '16px', color: '#EF4444', flexShrink: 0 }} />
          <span style={{ fontSize: '13px', color: '#fca5a5' }}>
            {(perror as any)?.response?.status === 401
              ? 'Session expired. Please sign in again.'
              : 'Could not connect to backend. Make sure the API server is running.'}
          </span>
          <button onClick={() => {
            if ((perror as any)?.response?.status === 401) {
              localStorage.removeItem('token');
              window.location.href = '/login';
            } else {
              handleRetry();
            }
          }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <RefreshCw style={{ width: '12px', height: '12px' }} /> {(perror as any)?.response?.status === 401 ? 'Sign In' : 'Retry'}
          </button>
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' }}>
        {noPortfolio ? (
          <EmptyPortfolioState />
        ) : sloading || ploading ? (
          Array.from({length: 4}).map((_,i) => (
            <div key={i} style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px', padding: '18px 20px', height: '90px' }} className="animate-shimmer" />
          ))
        ) : summary && summary.portfolio_id ? (
          <>
            <SummaryCard label="Portfolio Value"  value={fmtCurrency(summary.total_value ?? 0, summary.currency || currency)}  sub={summary.portfolio_name || portfolios?.[0]?.name} />
            <SummaryCard label="Today's P&L"     value={(summary.day_pnl ?? 0) === 0 && (summary.day_pnl_pct ?? 0) === 0 ? '—' : fmtCurrency(summary.day_pnl ?? 0, summary.currency || currency)}   sub={(summary.day_pnl ?? 0) === 0 && (summary.day_pnl_pct ?? 0) === 0 ? 'Waiting for market data' : `${(summary.day_pnl ?? 0) >= 0 ? '+' : ''}${(summary.day_pnl_pct ?? 0).toFixed(2)}%`} color={(summary.day_pnl ?? 0) === 0 && (summary.day_pnl_pct ?? 0) === 0 ? '#4A5B6C' : pnlColor(summary.day_pnl ?? 0)} />
            <SummaryCard label="Total Return"     value={fmtCurrency(summary.total_pnl ?? 0, summary.currency || currency)} sub={`${(summary.total_pnl ?? 0) >= 0 ? '+' : ''}${(summary.total_pnl_pct ?? 0).toFixed(2)}%`} color={pnlColor(summary.total_pnl ?? 0)} />
            <SummaryCard label="Positions"        value={String(summary.position_count ?? 0)}           sub="Active holdings" />
          </>
        ) : (
          <EmptyPortfolioState />
        )}
      </div>

      {/* ── Heatmap ── */}
      {positions.length > 0 && (
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <p style={{ fontSize: '12px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 14px', letterSpacing: '0.5px' }}>PORTFOLIO HEATMAP — TODAY</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
            {positions.map(pos => <HeatmapTile key={pos.id} pos={pos} />)}
          </div>
        </div>
      )}

      {/* ── Bottom 3-col grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>

        {/* Today's Events — deduplicated, labelled, structured */}
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '16px', padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calendar style={{ width: '14px', height: '14px', color: '#0F7ABF' }} />
              <p style={{ fontSize: '12px', fontWeight: '600', color: '#C9D4E0', margin: 0, letterSpacing: '0.3px' }}>EVENTS</p>
            </div>
            <button onClick={() => router.push('/calendars')} style={{ background: 'none', border: 'none', color: '#0F7ABF', fontSize: '10px', fontWeight: '600', cursor: 'pointer' }}>View all →</button>
          </div>
          {eloading ? (
            Array.from({length:4}).map((_,i)=><div key={i} style={{height:'52px',backgroundColor:'#1E2D45',borderRadius:'10px',marginBottom:'8px'}} className="animate-shimmer"/>)
          ) : !events?.length ? (
            <div style={{ textAlign: 'center', padding: '24px 8px' }}>
              <p style={{ fontSize: '24px', margin: '0 0 8px' }}>📅</p>
              <p style={{ fontSize: '12px', color: '#4A5B6C', margin: 0 }}>No upcoming events for your portfolio.<br/>Add tickers to your watchlist to see relevant events.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '380px', overflowY: 'auto' }}>
              {dedupEvents(events).slice(0, 10).map(ev => {
                const meta = getEventMeta(ev.event_type);
                const sub = eventSubtitle(ev);
                return (
                  <div
                    key={ev.id}
                    onClick={() => ev.source_url ? window.open(ev.source_url, '_blank') : router.push('/calendars')}
                    style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D4580', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = meta.color + '80')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#1E2D4580')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      {/* Ticker badge */}
                      {ev.ticker && (
                        <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: '#0F7ABF18', color: '#0F7ABF', padding: '2px 6px', borderRadius: '4px', border: '1px solid #0F7ABF30' }}>
                          {ev.ticker}
                        </span>
                      )}
                      {/* Event type badge (friendly label) */}
                      <span style={{
                        fontSize: '9px', fontWeight: '600', padding: '2px 6px', borderRadius: '4px',
                        backgroundColor: meta.color + '18', color: meta.color, border: `1px solid ${meta.color}30`,
                      }}>
                        {meta.label}
                      </span>
                      {/* Impact indicator */}
                      {ev.impact_level === 'HIGH' && (
                        <span style={{ fontSize: '9px', fontWeight: '600', padding: '2px 5px', borderRadius: '4px', backgroundColor: '#EF444418', color: '#EF4444', border: '1px solid #EF444430' }}>
                          High impact
                        </span>
                      )}
                      {/* Date — right-aligned */}
                      <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: 'auto', flexShrink: 0 }}>
                        {formatEventDate(ev.event_date)}
                        {ev.event_time ? ` · ${ev.event_time}` : ''}
                      </span>
                    </div>
                    {/* Title */}
                    <p style={{ fontSize: '12px', fontWeight: '500', color: '#C9D4E0', margin: '0 0 2px', lineHeight: '1.4' }}>{ev.title}</p>
                    {/* Subtitle — source, rating details, etc. */}
                    {sub && (
                      <p style={{ fontSize: '10px', color: '#4A5B6C', margin: 0 }}>{sub}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top Movers */}
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '16px', padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <TrendingUp style={{ width: '14px', height: '14px', color: '#10B981' }} />
            <p style={{ fontSize: '12px', fontWeight: '600', color: '#C9D4E0', margin: 0, letterSpacing: '0.3px' }}>
              {hasLiveDayData ? 'TOP MOVERS (TODAY)' : 'TOP MOVERS (TOTAL RETURN)'}
            </p>
          </div>
          {noPortfolio || positions.length === 0 ? (
            <p style={{ fontSize: '12px', color: '#4A5B6C', textAlign: 'center', padding: '20px 0' }}>Add positions to see movers</p>
          ) : allMovementsZero ? (
            <>
              <p style={{ fontSize: '10px', color: '#4A5B6C', margin: '0 0 8px', fontWeight: '600', fontStyle: 'italic' }}>
                Live day data unavailable — showing total return
              </p>
              {gainers.length > 0 && (
                <>
                  <p style={{ fontSize: '10px', color: '#10B981', margin: '0 0 8px', fontWeight: '600' }}>▲ GAINERS</p>
                  {gainers.map(p => {
                    const val = (p.pnl_pct ?? 0);
                    return (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1E2D4530' }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: '#F5F7FA' }}>{p.ticker}</span>
                          {p.company_name && <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: '6px' }}>{p.company_name}</span>}
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#10B981' }}>+{val.toFixed(2)}%</span>
                      </div>
                    );
                  })}
                </>
              )}
              {losers.length > 0 && (
                <>
                  <p style={{ fontSize: '10px', color: '#EF4444', margin: '12px 0 8px', fontWeight: '600' }}>▼ LOSERS</p>
                  {losers.map(p => {
                    const val = (p.pnl_pct ?? 0);
                    return (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1E2D4530' }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: '#F5F7FA' }}>{p.ticker}</span>
                          {p.company_name && <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: '6px' }}>{p.company_name}</span>}
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#EF4444' }}>{val.toFixed(2)}%</span>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          ) : gainers.length === 0 && losers.length === 0 ? (
            <p style={{ fontSize: '12px', color: '#4A5B6C', textAlign: 'center', padding: '20px 0' }}>No price movement data available yet</p>
          ) : (
            <>
              {gainers.length > 0 && (
                <>
                  <p style={{ fontSize: '10px', color: '#10B981', margin: '0 0 8px', fontWeight: '600' }}>▲ GAINERS</p>
                  {gainers.map(p => {
                    const val = (p[sortKey] ?? 0);
                    return (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1E2D4530' }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: '#F5F7FA' }}>{p.ticker}</span>
                          {p.company_name && <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: '6px' }}>{p.company_name}</span>}
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#10B981' }}>+{val.toFixed(2)}%</span>
                      </div>
                    );
                  })}
                </>
              )}
              {losers.length > 0 && (
                <>
                  <p style={{ fontSize: '10px', color: '#EF4444', margin: '12px 0 8px', fontWeight: '600' }}>▼ LOSERS</p>
                  {losers.map(p => {
                    const val = (p[sortKey] ?? 0);
                    return (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1E2D4530' }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: '#F5F7FA' }}>{p.ticker}</span>
                          {p.company_name && <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: '6px' }}>{p.company_name}</span>}
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#EF4444' }}>{val.toFixed(2)}%</span>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>

        {/* Must Know News */}
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '16px', padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Newspaper style={{ width: '14px', height: '14px', color: '#F59E0B' }} />
            <p style={{ fontSize: '12px', fontWeight: '600', color: '#C9D4E0', margin: 0, letterSpacing: '0.3px' }}>MUST KNOW</p>
          </div>
          {nloading ? (
            Array.from({length:3}).map((_,i)=><div key={i} style={{height:'48px',backgroundColor:'#1E2D45',borderRadius:'8px',marginBottom:'8px'}} className="animate-shimmer"/>)
          ) : !news?.length ? (
            <p style={{ fontSize: '12px', color: '#4A5B6C', textAlign: 'center', padding: '20px 0' }}>No high-importance news yet today</p>
          ) : news.slice(0,5).map(item => (
            <div key={item.id} style={{ padding: '8px 0', borderBottom: '1px solid #1E2D45', cursor: 'pointer' }} onClick={() => item.url && window.open(item.url, '_blank')}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: importanceDot(item.importance_score), flexShrink: 0, marginTop: '4px' }} />
                <div>
                  <p style={{ fontSize: '12px', color: '#C9D4E0', margin: '0 0 3px', lineHeight: '1.4' }}>{decodeHtml(item.title)}</p>
                  <p style={{ fontSize: '10px', color: '#4A5B6C', margin: 0 }}>{item.source} · {timeAgo(item.published_at)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
