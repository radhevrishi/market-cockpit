'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, TrendingUp, TrendingDown, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Quote {
  ticker?: string;
  symbol?: string;
  price?: number;
  change?: number;
  change_pct?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  market_cap?: number;
  pe_ratio?: number;
  currency?: string;
  name?: string;
  company_name?: string;
}

interface NewsItem {
  id: string;
  title?: string;
  headline?: string;
  source?: string;
  source_name?: string;
  url?: string;
  source_url?: string;
  published_at: string;
  sentiment?: string;
  article_type?: string;
}

interface TickerDrawerProps {
  symbol: string;
  exchange?: string;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number | undefined | null, decimals = 2) =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: decimals });

const sentimentColor = (s?: string) =>
  s === 'BULLISH' ? '#10B981' : s === 'BEARISH' ? '#EF4444' : '#8A95A3';

const timeAgo = (iso: string) => {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); }
  catch { return ''; }
};

// Decode HTML entities like &amp; → & , &lt; → <, etc.
const decodeHtml = (html: string): string => {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.documentElement.textContent || html;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function TickerDrawer({ symbol, exchange = 'NASDAQ', onClose }: TickerDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const { data: quote, isLoading: qLoading, error: qError, refetch: qRefetch } = useQuery<Quote>({
    queryKey: ['quote', symbol, exchange],
    queryFn: async () => {
      const { data } = await api.get(`/market/quote/${encodeURIComponent(symbol)}`, { params: { exchange } });
      return data;
    },
    staleTime: 30_000,
    retry: 1,
  });

  const { data: news, isLoading: nLoading } = useQuery<NewsItem[]>({
    queryKey: ['ticker-news', symbol],
    queryFn: async () => {
      const { data } = await api.get(`/news/ticker/${encodeURIComponent(symbol)}`);
      return Array.isArray(data) ? data.slice(0, 5) : [];
    },
    staleTime: 60_000,
    retry: 1,
  });

  const up = (quote?.change_pct ?? 0) >= 0;
  const displayName = quote?.name || quote?.company_name || symbol;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 300 }}
      />

      {/* Drawer panel */}
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: '380px', maxWidth: '95vw',
        backgroundColor: '#111B35', borderLeft: '1px solid #1E2D45',
        zIndex: 301, overflowY: 'auto', display: 'flex', flexDirection: 'column',
        boxShadow: '-20px 0 60px rgba(0,0,0,0.5)',
      }}>

        {/* Header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #1E2D45', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: '20px', fontWeight: '800', color: '#F5F7FA', margin: '0 0 2px', letterSpacing: '-0.5px' }}>{symbol}</p>
            <p style={{ fontSize: '12px', color: '#4A5B6C', margin: 0 }}>{exchange}</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer', padding: '4px', marginTop: '2px' }}
          >
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        {/* Quote section */}
        <div style={{ padding: '20px', borderBottom: '1px solid #1E2D45', flexShrink: 0 }}>
          {qLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: i === 1 ? '36px' : '18px', backgroundColor: '#1A2B3C', borderRadius: '6px' }} className="animate-shimmer" />
              ))}
            </div>
          ) : qError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '12px 0' }}>
              <AlertCircle style={{ width: '20px', height: '20px', color: '#EF4444' }} />
              <p style={{ fontSize: '13px', color: '#8A95A3', margin: 0 }}>Could not load quote for {symbol}</p>
              <button onClick={() => qRefetch()} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#0F7ABF', background: 'none', border: 'none', cursor: 'pointer' }}>
                <RefreshCw style={{ width: '12px', height: '12px' }} /> Retry
              </button>
            </div>
          ) : quote ? (
            <>
              <p style={{ fontSize: '12px', color: '#8A95A3', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '28px', fontWeight: '800', color: '#F5F7FA', letterSpacing: '-1px' }}>
                  {fmt(quote.price)}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '14px', fontWeight: '600', color: up ? '#10B981' : '#EF4444' }}>
                  {up ? <TrendingUp style={{ width: '14px', height: '14px' }} /> : <TrendingDown style={{ width: '14px', height: '14px' }} />}
                  {up ? '+' : ''}{fmt(quote.change)} ({up ? '+' : ''}{fmt(quote.change_pct)}%)
                </span>
                <span style={{ fontSize: '11px', color: '#4A5B6C' }}>{quote.currency ?? 'USD'}</span>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                {[
                  { label: 'Open', value: fmt(quote.open) },
                  { label: 'High', value: fmt(quote.high) },
                  { label: 'Low',  value: fmt(quote.low) },
                  { label: 'Volume', value: quote.volume ? (quote.volume >= 1e6 ? `${(quote.volume / 1e6).toFixed(1)}M` : `${(quote.volume / 1e3).toFixed(0)}K`) : '—' },
                  { label: 'Mkt Cap', value: quote.market_cap ? (quote.market_cap >= 1e12 ? `$${(quote.market_cap / 1e12).toFixed(1)}T` : quote.market_cap >= 1e9 ? `$${(quote.market_cap / 1e9).toFixed(1)}B` : `$${(quote.market_cap / 1e6).toFixed(0)}M`) : '—' },
                  { label: 'P/E', value: quote.pe_ratio != null ? fmt(quote.pe_ratio, 1) : '—' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ backgroundColor: '#0D1B2E', borderRadius: '8px', padding: '8px 10px' }}>
                    <p style={{ fontSize: '9px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 3px', letterSpacing: '0.5px' }}>{label}</p>
                    <p style={{ fontSize: '12px', color: '#C9D4E0', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* News section */}
        <div style={{ padding: '16px 20px', flex: 1 }}>
          <p style={{ fontSize: '11px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 12px', letterSpacing: '0.5px' }}>RECENT NEWS</p>

          {nLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[1, 2, 3].map(i => <div key={i} style={{ height: '52px', backgroundColor: '#1A2B3C', borderRadius: '8px' }} className="animate-shimmer" />)}
            </div>
          ) : !news?.length ? (
            <p style={{ fontSize: '12px', color: '#4A5B6C', fontStyle: 'italic' }}>No recent news found for {symbol}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {news.map(n => {
                const title = decodeHtml(n.title || n.headline || '(no title)');
                const src   = n.source || n.source_name || '';
                const url   = n.url || n.source_url || '#';
                return (
                  <a
                    key={n.id}
                    href={url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', padding: '10px 12px', backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: '10px', textDecoration: 'none', transition: 'border-color 0.15s' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      {n.sentiment && (
                        <span style={{ fontSize: '9px', fontWeight: '700', color: sentimentColor(n.sentiment), border: `1px solid ${sentimentColor(n.sentiment)}40`, padding: '1px 5px', borderRadius: '4px' }}>
                          {n.sentiment}
                        </span>
                      )}
                      <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: 'auto', flexShrink: 0 }}>{timeAgo(n.published_at)}</span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#C9D4E0', margin: 0, lineHeight: '1.4' }}>
                      {title.slice(0, 100)}{title.length > 100 ? '…' : ''}
                    </p>
                    {src && <p style={{ fontSize: '10px', color: '#4A5B6C', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: '3px' }}>{src} <ExternalLink style={{ width: '8px', height: '8px' }} /></p>}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
