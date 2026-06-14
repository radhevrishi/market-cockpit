'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, TrendingUp, TrendingDown, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { coerceSentiment } from '@/lib/safeSentiment';

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
  exchange?: string; // PATCH 0692 — live exchange field returned by P0690 quote shape
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
  // PATCH 0351 — sentiment may be a string label ('BULLISH' / 'BEARISH' /
  // 'NEUTRAL') OR a {direction, magnitude} object from the institutional
  // news engine. Coerce via coerceSentiment() at render time.
  sentiment?: string | { direction?: string; magnitude?: number } | unknown;
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

// PATCH 0351 — coerce news API sentiment via shared helper. Centralised
// in lib/safeSentiment.ts so every consumer (TickerDrawer, /orders, etc.)
// uses one source of truth.

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

export default function TickerDrawer({ symbol, exchange, onClose }: TickerDrawerProps) {
  // PATCH 0486 QA-#5 — infer exchange from suffix when caller doesn't pass one.
  // PATCH 0692 — strengthen India detection: if symbol has no dot suffix and is
  // pure A-Z (no dot at all), treat as NSE rather than defaulting to NASDAQ.
  // Most Indian tickers are bare uppercase strings (RELIANCE, HAL, MTAR, NTPC)
  // while US tickers tend to be short (NVDA, AAPL) but also bare. Once the
  // quote returns we override using quote.currency==='INR' (more reliable).
  const inferredExchange = (() => {
    if (exchange) return exchange;
    const sym = (symbol || '').toUpperCase();
    if (sym.endsWith('.NS')) return 'NSE';
    if (sym.endsWith('.BO')) return 'BSE';
    if (/^\d{5,7}$/.test(sym)) return 'BSE';
    return 'NASDAQ';
  })();
  // Use inferredExchange initially; the actual exchange label below is recomputed
  // from the live quote currency / exchange field once it arrives.
  const initialExchange = inferredExchange;
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const { data: quote, isLoading: qLoading, error: qError, refetch: qRefetch } = useQuery<Quote>({
    queryKey: ['quote', symbol, initialExchange],
    queryFn: async () => {
      const { data } = await api.get(`/market/quote/${encodeURIComponent(symbol)}`, { params: { exchange: initialExchange } });
      return data;
    },
    staleTime: 30_000,
    retry: 1,
  });

  // PATCH 0692 — derive exchangeLabel from the LIVE quote response when possible:
  //   1. If the quote response has an explicit exchange field (P0690), use it
  //   2. Else if currency === 'INR', treat as NSE (avoid hardcoded NASDAQ)
  //   3. Else if symbol matches typical Indian pattern (no dot suffix, uppercase
  //      A-Z, length 3-10), also default to NSE — Indian tickers are bare while
  //      US tickers may also be bare but P0690 quotes returns currency
  //   4. Otherwise fall back to the suffix-inferred initialExchange
  const exchangeLabel = (() => {
    if (quote?.exchange) return quote.exchange;
    if (quote?.currency === 'INR') return 'NSE';
    return initialExchange;
  })();

  const { data: news, isLoading: nLoading } = useQuery<NewsItem[]>({
    queryKey: ['ticker-news', symbol],
    queryFn: async () => {
      const { data } = await api.get(`/news/ticker/${encodeURIComponent(symbol)}`);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60_000,
    retry: 1,
  });

  const up = (quote?.change_pct ?? 0) >= 0;
  const displayName = quote?.name || quote?.company_name || symbol;

  // PATCH 0692 — Filter news results to articles that actually mention the
  // ticker or company name (case-insensitive). Some backend endpoints return
  // generic global news when no ticker-tagged results exist; filter that out
  // to avoid showing unrelated headlines on the side panel.
  const filteredNews = (() => {
    if (!news || !news.length) return [];
    const sym = (symbol || '').toLowerCase();
    const company = String(displayName || '').toLowerCase();
    // Skip the filter only when both keys are empty (would never match anything)
    if (!sym && !company) return news.slice(0, 5);
    const matched = news.filter((n) => {
      const text = `${n.title || ''} ${n.headline || ''}`.toLowerCase();
      if (sym && text.includes(sym)) return true;
      if (company && company.length > 2 && text.includes(company)) return true;
      return false;
    });
    return matched.slice(0, 5);
  })();

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
        backgroundColor: 'var(--mc-bg-2)', borderLeft: '1px solid var(--mc-border-1)',
        zIndex: 301, overflowY: 'auto', display: 'flex', flexDirection: 'column',
        boxShadow: '-20px 0 60px rgba(0,0,0,0.5)',
      }}>

        {/* Header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--mc-border-1)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: '20px', fontWeight: '800', color: 'var(--mc-text-0)', margin: '0 0 2px', letterSpacing: '-0.5px' }}>{symbol}</p>
            <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', margin: 0 }}>{exchangeLabel}</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: '4px', marginTop: '2px' }}
          >
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        {/* Quote section */}
        <div style={{ padding: '20px', borderBottom: '1px solid var(--mc-border-1)', flexShrink: 0 }}>
          {qLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: i === 1 ? '36px' : '18px', backgroundColor: '#1A2B3C', borderRadius: '6px' }} className="animate-shimmer" />
              ))}
            </div>
          ) : qError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '12px 0' }}>
              <AlertCircle style={{ width: '20px', height: '20px', color: 'var(--mc-bearish)' }} />
              <p style={{ fontSize: '13px', color: '#8A95A3', margin: 0 }}>Could not load quote for {symbol}</p>
              <button onClick={() => qRefetch()} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--mc-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                <RefreshCw style={{ width: '12px', height: '12px' }} /> Retry
              </button>
            </div>
          ) : quote ? (
            <>
              <p style={{ fontSize: '12px', color: '#8A95A3', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '28px', fontWeight: '800', color: 'var(--mc-text-0)', letterSpacing: '-1px' }}>
                  {fmt(quote.price)}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '14px', fontWeight: '600', color: up ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
                  {up ? <TrendingUp style={{ width: '14px', height: '14px' }} /> : <TrendingDown style={{ width: '14px', height: '14px' }} />}
                  {up ? '+' : ''}{fmt(quote.change)} ({up ? '+' : ''}{fmt(quote.change_pct)}%)
                </span>
                <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>{quote.currency ?? 'USD'}</span>
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
                    <p style={{ fontSize: '9px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 3px', letterSpacing: '0.5px' }}>{label}</p>
                    <p style={{ fontSize: '12px', color: '#C9D4E0', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* News section */}
        <div style={{ padding: '16px 20px', flex: 1 }}>
          <p style={{ fontSize: '11px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 12px', letterSpacing: '0.5px' }}>RECENT NEWS</p>

          {nLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[1, 2, 3].map(i => <div key={i} style={{ height: '52px', backgroundColor: '#1A2B3C', borderRadius: '8px' }} className="animate-shimmer" />)}
            </div>
          ) : !filteredNews.length ? (
            /* PATCH 0692 — honest empty-state: only show 'no news' when the
                ticker/company filter matched zero, instead of showing unrelated
                global news. */
            <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', fontStyle: 'italic' }}>No recent news for {symbol}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredNews.map(n => {
                const title = decodeHtml(n.title || n.headline || '(no title)');
                const src   = n.source || n.source_name || '';
                const url   = n.url || n.source_url || '#';
                return (
                  <a
                    key={n.id}
                    href={url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', padding: '10px 12px', backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderRadius: '10px', textDecoration: 'none', transition: 'border-color 0.15s' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      {(() => {
                        const sentLabel = coerceSentiment(n.sentiment);
                        return sentLabel ? (
                          <span style={{ fontSize: '9px', fontWeight: '700', color: sentimentColor(sentLabel), border: `1px solid ${sentimentColor(sentLabel)}40`, padding: '1px 5px', borderRadius: '4px' }}>
                            {sentLabel}
                          </span>
                        ) : null;
                      })()}
                      <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', marginLeft: 'auto', flexShrink: 0 }}>{timeAgo(n.published_at)}</span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#C9D4E0', margin: 0, lineHeight: '1.4' }}>
                      {title.slice(0, 100)}{title.length > 100 ? '…' : ''}
                    </p>
                    {src && <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: '3px' }}>{src} <ExternalLink style={{ width: '8px', height: '8px' }} /></p>}
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
