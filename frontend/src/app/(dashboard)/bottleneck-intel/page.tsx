'use client';

import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw, ExternalLink, ChevronDown, ChevronRight,
  Zap, AlertCircle, Activity, TrendingUp, Globe, Flag,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BnSignalArticle {
  id: string;
  headline: string;
  source_name: string;
  source_url: string;
  published_at: string;
  importance_score: number;
  sentiment: string;
}

interface BnSignal {
  headline: string;
  summary: string;
  evidence_count: number;
  sources: string[];
  latest_at: string;
  tickers: string[];
  articles: BnSignalArticle[];
}

interface BnBucket {
  bucket_id: string;
  label: string;
  description: string;
  severity: number;
  severity_label: string;
  severity_color: string;
  severity_icon: string;
  signal_count: number;
  article_count: number;
  key_tickers: string[];
  signals: BnSignal[];
}

interface BnDashboard {
  success: boolean;
  total_articles: number;
  buckets: BnBucket[];
}

interface NewsArticle {
  id: string;
  headline: string;
  title: string;
  source_name: string;
  source: string;
  source_url: string;
  url: string;
  published_at: string;
  tickers: Array<{ ticker: string; exchange: string; confidence?: number } | string>;
  ticker_symbols: string[];
  region: string;
  article_type: string;
  importance_score: number;
  bottleneck_sub_tag?: string;
  bottleneck_level?: string;
  sentiment?: string;
}

interface QuoteData {
  symbol: string;
  price?: number;
  market_cap?: number;
  exchange?: string;
  company_name?: string;
  change_pct?: number;
}

// ── Sub-tab config ─────────────────────────────────────────────────────────────

const TABS = ['Rotation', 'Scanner'] as const;
type Tab = typeof TABS[number];

const TAB_CONFIG: Record<Tab, { label: string; icon: ReactNode; description: string }> = {
  Rotation: {
    label: 'Rotation Tracker',
    icon: <Activity className="w-4 h-4" />,
    description: 'Which supply chain layer is the active bottleneck right now',
  },
  Scanner: {
    label: 'Stock Scanner',
    icon: <TrendingUp className="w-4 h-4" />,
    description: 'Bottleneck companies ranked by evidence strength and size asymmetry',
  },
};

// ── Severity styling ──────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { bg: string; border: string; badge: string; badgeBg: string; glow: string }> = {
  CRITICAL: { bg: '#EF444408', border: '#EF444430', badge: '#EF4444', badgeBg: '#EF444418', glow: '0 0 20px #EF444415' },
  HIGH:     { bg: '#F59E0B06', border: '#F59E0B28', badge: '#F59E0B', badgeBg: '#F59E0B14', glow: '0 0 20px #F59E0B10' },
  ELEVATED: { bg: '#8B5CF606', border: '#8B5CF628', badge: '#8B5CF6', badgeBg: '#8B5CF614', glow: '0 0 20px #8B5CF610' },
  WATCH:    { bg: '#0F7ABF06', border: '#0F7ABF28', badge: '#0F7ABF', badgeBg: '#0F7ABF14', glow: 'none' },
  DEFAULT:  { bg: 'transparent', border: '#1A2840', badge: '#4A5B6C', badgeBg: '#4A5B6C14', glow: 'none' },
};

function getSeverityStyle(label: string) {
  for (const key of Object.keys(SEVERITY_STYLES)) {
    if (label?.toUpperCase().includes(key)) return SEVERITY_STYLES[key];
  }
  return SEVERITY_STYLES.DEFAULT;
}

// ── Bottleneck level badge ────────────────────────────────────────────────────

const LEVEL_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  CRITICAL:   { color: '#EF4444', bg: '#EF444418', border: '#EF444440' },
  BOTTLENECK: { color: '#F59E0B', bg: '#F59E0B14', border: '#F59E0B30' },
  WATCH:      { color: '#0F7ABF', bg: '#0F7ABF14', border: '#0F7ABF30' },
  RESOLVED:   { color: '#10B981', bg: '#10B98114', border: '#10B98130' },
};

function getLevelStyle(level?: string) {
  if (!level) return null;
  return LEVEL_STYLES[level.toUpperCase()] ?? null;
}

// ── Exchange flag helper ──────────────────────────────────────────────────────

function exchangeFlag(exchange?: string): { flag: string; color: string } | null {
  if (!exchange) return null;
  const e = exchange.toUpperCase();
  if (e === 'NSE' || e === 'BSE')         return { flag: '🇮🇳', color: '#F59E0B' };
  if (e === 'STO' || e.includes('STO'))   return { flag: '🇸🇪', color: '#0F7ABF' };
  if (e === 'TSE' || e.includes('TSE') || e === 'JPX') return { flag: '🇯🇵', color: '#EF4444' };
  if (e === 'KRX' || e.includes('KRX'))   return { flag: '🇰🇷', color: '#0F7ABF' };
  if (e === 'FRA' || e.includes('FRA'))   return { flag: '🇩🇪', color: '#F59E0B' };
  return null; // US exchanges — no special flag needed
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const timeAgo = (iso: string) => {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
};

function cleanUrl(raw: string): string {
  if (!raw || raw === '#') return '#';
  let u = raw.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
  const httpIdx = u.indexOf('http', 1);
  if (httpIdx > 0 && u.startsWith('http')) u = u.slice(httpIdx);
  return u;
}

function getTickerSymbols(article: NewsArticle): string[] {
  const JUNK = new Set(['ON', 'A', 'IT', 'ALL', 'AN', 'IS', 'ARE', 'OR', 'SO', 'GO', 'DO', 'HE', 'WE', 'AI']);
  const raw = article.ticker_symbols?.length
    ? article.ticker_symbols
    : (article.tickers ?? []).map(t =>
        typeof t === 'string' ? t : (t as { ticker: string }).ticker ?? ''
      ).filter(Boolean);
  return raw.filter(t => !JUNK.has(t.toUpperCase()));
}

function formatMarketCap(mc?: number): string {
  if (!mc) return '—';
  if (mc >= 1e12) return `$${(mc / 1e12).toFixed(1)}T`;
  if (mc >= 1e9)  return `$${(mc / 1e9).toFixed(1)}B`;
  if (mc >= 1e6)  return `$${(mc / 1e6).toFixed(0)}M`;
  return `$${mc.toFixed(0)}`;
}

// ── API hooks ─────────────────────────────────────────────────────────────────

function useBottleneckDashboard() {
  return useQuery<BnDashboard>({
    queryKey: ['bn', 'dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/news/bottleneck-dashboard');
      return data;
    },
    refetchInterval: 180_000,
    staleTime: 120_000,
    retry: 1,
  });
}

function useBottleneckNews() {
  return useQuery<NewsArticle[]>({
    queryKey: ['bn', 'news'],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '300', importance_min: '2', article_type: 'BOTTLENECK' });
      const { data } = await api.get(`/news?${params}`);
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: 1,
  });
}

function useMarketQuotes(symbols: string[]) {
  return useQuery<QuoteData[]>({
    queryKey: ['bn', 'quotes', symbols.slice(0, 30).join(',')],
    queryFn: async () => {
      if (!symbols.length) return [];
      const top = symbols.slice(0, 30).join(',');
      const { data } = await api.get(`/market/quotes?symbols=${top}`);
      return Array.isArray(data) ? data : [];
    },
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 1,
  });
}

// ── Scanner data builder ──────────────────────────────────────────────────────

interface ScannerRow {
  symbol: string;
  sub_tag?: string;
  level?: string;
  evidence_count: number;
  latest_at?: string;
  headlines: string[];
  exchange?: string;
  price?: number;
  market_cap?: number;
  change_pct?: number;
  company_name?: string;
  is_small_cap: boolean;
  is_non_us: boolean;
}

function buildScannerRows(articles: NewsArticle[], quotes: QuoteData[]): ScannerRow[] {
  const map = new Map<string, ScannerRow>();

  for (const a of articles) {
    const tickers = getTickerSymbols(a);
    for (const sym of tickers) {
      if (!map.has(sym)) {
        map.set(sym, {
          symbol: sym,
          sub_tag: a.bottleneck_sub_tag,
          level: a.bottleneck_level,
          evidence_count: 0,
          latest_at: a.published_at,
          headlines: [],
          is_small_cap: false,
          is_non_us: false,
        });
      }
      const row = map.get(sym)!;
      row.evidence_count++;
      // Keep highest severity level
      const levels = ['CRITICAL', 'BOTTLENECK', 'WATCH', 'RESOLVED'];
      if (a.bottleneck_level) {
        const newIdx = levels.indexOf(a.bottleneck_level.toUpperCase());
        const curIdx = levels.indexOf((row.level ?? '').toUpperCase());
        if (newIdx !== -1 && (curIdx === -1 || newIdx < curIdx)) row.level = a.bottleneck_level;
      }
      if (!row.sub_tag && a.bottleneck_sub_tag) row.sub_tag = a.bottleneck_sub_tag;
      const headline = a.title || a.headline || '';
      if (headline && row.headlines.length < 3) row.headlines.push(headline);
      // Track most recent
      if (a.published_at && (!row.latest_at || a.published_at > row.latest_at)) {
        row.latest_at = a.published_at;
      }
    }
  }

  // Enrich with quote data
  const quoteMap = new Map(quotes.map(q => [q.symbol.toUpperCase(), q]));
  for (const [sym, row] of map) {
    const q = quoteMap.get(sym.toUpperCase());
    if (q) {
      row.price = q.price;
      row.market_cap = q.market_cap;
      row.change_pct = q.change_pct;
      row.company_name = q.company_name;
      row.exchange = q.exchange;
      row.is_small_cap = !!(q.market_cap && q.market_cap < 2_000_000_000);
      const ef = exchangeFlag(q.exchange);
      row.is_non_us = !!ef;
    }
  }

  // Sort: CRITICAL first, then by evidence count, then by small-cap flag
  const levelOrder: Record<string, number> = { CRITICAL: 0, BOTTLENECK: 1, WATCH: 2, RESOLVED: 3 };
  return Array.from(map.values())
    .filter(r => r.evidence_count >= 1)
    .sort((a, b) => {
      const la = levelOrder[a.level?.toUpperCase() ?? ''] ?? 4;
      const lb = levelOrder[b.level?.toUpperCase() ?? ''] ?? 4;
      if (la !== lb) return la - lb;
      return b.evidence_count - a.evidence_count;
    });
}

// ── Section 1: Rotation Tracker ───────────────────────────────────────────────

function RotationTracker({ dashboard, isLoading, refetch }: {
  dashboard?: BnDashboard;
  isLoading: boolean;
  refetch: () => void;
}) {
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px', padding: '20px' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ height: '140px', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '12px', animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
        <style>{`@keyframes pulse { 0%,100% { opacity:0.4 } 50% { opacity:0.8 } }`}</style>
      </div>
    );
  }

  if (!dashboard?.buckets?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#4A5B6C' }}>
        <AlertCircle className="w-10 h-10" style={{ margin: '0 auto 12px', color: '#1A2840' }} />
        <p style={{ fontSize: '14px' }}>No bottleneck data available. Check that the backend is running.</p>
      </div>
    );
  }

  // Sort buckets by severity descending
  const sorted = [...dashboard.buckets].sort((a, b) => b.severity - a.severity);
  // Active bottleneck = highest severity
  const topBucket = sorted[0];

  return (
    <div style={{ padding: '20px' }}>

      {/* Active Bottleneck Banner */}
      {topBucket && (
        <div style={{
          marginBottom: '20px',
          padding: '14px 20px',
          backgroundColor: '#060E1A',
          border: `1px solid ${getSeverityStyle(topBucket.severity_label).border}`,
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          boxShadow: getSeverityStyle(topBucket.severity_label).glow,
        }}>
          <span style={{ fontSize: '22px' }}>{topBucket.severity_icon || '⚡'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '1px', color: '#4A5B6C' }}>ACTIVE BOTTLENECK</span>
              <span style={{
                fontSize: '10px', fontWeight: '700', letterSpacing: '1px',
                color: getSeverityStyle(topBucket.severity_label).badge,
                backgroundColor: getSeverityStyle(topBucket.severity_label).badgeBg,
                padding: '2px 8px', borderRadius: '4px',
              }}>{topBucket.severity_label}</span>
            </div>
            <p style={{ fontSize: '15px', fontWeight: '700', color: '#F5F7FA', margin: '2px 0 0' }}>
              {topBucket.label}
            </p>
            <p style={{ fontSize: '12px', color: '#6B7A8D', margin: '2px 0 0' }}>{topBucket.description}</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: '20px', fontWeight: '700', color: getSeverityStyle(topBucket.severity_label).badge, margin: 0 }}>{topBucket.signal_count}</p>
            <p style={{ fontSize: '10px', color: '#4A5B6C', margin: 0 }}>signals</p>
          </div>
        </div>
      )}

      {/* Rotation Legend */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', color: '#4A5B6C', letterSpacing: '0.5px' }}>ROTATION SEQUENCE:</span>
        {sorted.slice(0, 5).map((b, i) => (
          <span key={b.bucket_id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {i > 0 && <span style={{ color: '#1A2840', fontSize: '12px' }}>→</span>}
            <span style={{
              fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px',
              color: getSeverityStyle(b.severity_label).badge,
              backgroundColor: getSeverityStyle(b.severity_label).badgeBg,
              border: `1px solid ${getSeverityStyle(b.severity_label).border}`,
            }}>{b.label}</span>
          </span>
        ))}
      </div>

      {/* Bucket Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
        {sorted.map((bucket) => {
          const style = getSeverityStyle(bucket.severity_label);
          const isExpanded = expandedBucket === bucket.bucket_id;

          return (
            <div key={bucket.bucket_id} style={{
              backgroundColor: style.bg || '#0D1623',
              border: `1px solid ${style.border}`,
              borderRadius: '12px',
              overflow: 'hidden',
              transition: 'border-color 0.2s',
              boxShadow: isExpanded ? style.glow : 'none',
            }}>
              {/* Card Header */}
              <button
                onClick={() => setExpandedBucket(isExpanded ? null : bucket.bucket_id)}
                style={{
                  width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '20px', flexShrink: 0, marginTop: '2px' }}>{bucket.severity_icon || '🔹'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{bucket.label}</span>
                      <span style={{
                        fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px',
                        color: style.badge, backgroundColor: style.badgeBg,
                        padding: '2px 6px', borderRadius: '3px',
                      }}>{bucket.severity_label}</span>
                    </div>
                    <p style={{ fontSize: '11px', color: '#6B7A8D', margin: '0 0 8px', lineHeight: '1.4' }}>{bucket.description}</p>

                    {/* Stats row */}
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: '#8A95A3' }}>
                        <span style={{ color: style.badge, fontWeight: '700' }}>{bucket.signal_count}</span> signals
                      </span>
                      <span style={{ fontSize: '11px', color: '#8A95A3' }}>
                        <span style={{ fontWeight: '600', color: '#C9D4E0' }}>{bucket.article_count}</span> articles
                      </span>
                    </div>

                    {/* Key tickers */}
                    {bucket.key_tickers?.length > 0 && (
                      <div style={{ marginTop: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {bucket.key_tickers.slice(0, 8).map(t => (
                          <span key={t} style={{
                            fontSize: '10px', fontWeight: '600',
                            color: '#0F7ABF', backgroundColor: '#0F7ABF14',
                            border: '1px solid #0F7ABF30',
                            padding: '1px 6px', borderRadius: '4px',
                          }}>{t}</span>
                        ))}
                        {bucket.key_tickers.length > 8 && (
                          <span style={{ fontSize: '10px', color: '#4A5B6C' }}>+{bucket.key_tickers.length - 8}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, color: '#4A5B6C' }}>
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                </div>
              </button>

              {/* Expanded: Signal list */}
              {isExpanded && bucket.signals?.length > 0 && (
                <div style={{ borderTop: `1px solid ${style.border}`, padding: '4px 0' }}>
                  {bucket.signals.slice(0, 5).map((signal, si) => {
                    const sigKey = `${bucket.bucket_id}-${si}`;
                    const sigExpanded = expandedSignal === sigKey;

                    return (
                      <div key={si} style={{ borderBottom: si < Math.min(bucket.signals.length, 5) - 1 ? '1px solid #1A284040' : 'none' }}>
                        <button
                          onClick={() => setExpandedSignal(sigExpanded ? null : sigKey)}
                          style={{
                            width: '100%', textAlign: 'left', background: 'none', border: 'none',
                            cursor: 'pointer', padding: '10px 16px',
                            display: 'flex', alignItems: 'flex-start', gap: '8px',
                          }}
                        >
                          <Zap className="w-3 h-3" style={{ color: style.badge, flexShrink: 0, marginTop: '2px' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: '12px', color: '#C9D4E0', margin: 0, lineHeight: '1.4', textAlign: 'left' }}>
                              {signal.headline}
                            </p>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', color: '#4A5B6C' }}>
                                {signal.evidence_count} evidence{signal.evidence_count !== 1 ? 's' : ''}
                              </span>
                              {signal.latest_at && (
                                <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{timeAgo(signal.latest_at)}</span>
                              )}
                              {signal.tickers?.slice(0, 3).map(t => (
                                <span key={t} style={{ fontSize: '10px', color: '#0F7ABF', fontWeight: '600' }}>${t}</span>
                              ))}
                            </div>
                          </div>
                          <div style={{ color: '#4A5B6C', flexShrink: 0 }}>
                            {sigExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </div>
                        </button>

                        {/* Signal summary + articles */}
                        {sigExpanded && (
                          <div style={{ padding: '0 16px 12px 36px' }}>
                            {signal.summary && (
                              <p style={{ fontSize: '11px', color: '#8A95A3', lineHeight: '1.5', margin: '0 0 8px' }}>
                                {signal.summary}
                              </p>
                            )}
                            {signal.articles?.slice(0, 3).map((art, ai) => (
                              <a
                                key={ai}
                                href={cleanUrl(art.source_url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'flex', alignItems: 'flex-start', gap: '6px',
                                  padding: '6px 8px', marginBottom: '4px',
                                  backgroundColor: '#060E1A', borderRadius: '6px',
                                  textDecoration: 'none',
                                  border: '1px solid #1A2840',
                                }}
                              >
                                <ExternalLink className="w-3 h-3" style={{ color: '#4A5B6C', flexShrink: 0, marginTop: '2px' }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontSize: '11px', color: '#C9D4E0', margin: 0, lineHeight: '1.3' }}>{art.headline}</p>
                                  <p style={{ fontSize: '10px', color: '#4A5B6C', margin: '2px 0 0' }}>
                                    {art.source_name} · {timeAgo(art.published_at)}
                                  </p>
                                </div>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      {dashboard && (
        <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '11px', color: '#4A5B6C' }}>
          {dashboard.total_articles} total articles analyzed · refreshes every 3 min
        </div>
      )}
    </div>
  );
}

// ── Section 2: Stock Scanner ──────────────────────────────────────────────────

function StockScanner({ articles, isLoading, quotes, quotesLoading }: {
  articles: NewsArticle[];
  isLoading: boolean;
  quotes: QuoteData[];
  quotesLoading: boolean;
}) {
  const [sortBy, setSortBy] = useState<'evidence' | 'marketcap' | 'level'>('level');
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const rows = useMemo(() => buildScannerRows(articles, quotes), [articles, quotes]);

  const filtered = useMemo(() => {
    let r = rows;
    if (filterLevel !== 'ALL') r = r.filter(row => row.level?.toUpperCase() === filterLevel);
    if (sortBy === 'evidence') r = [...r].sort((a, b) => b.evidence_count - a.evidence_count);
    if (sortBy === 'marketcap') r = [...r].sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0));
    // 'level' sort is already applied in buildScannerRows
    return r;
  }, [rows, sortBy, filterLevel]);

  const LEVELS = ['ALL', 'CRITICAL', 'BOTTLENECK', 'WATCH'];

  if (isLoading) {
    return (
      <div style={{ padding: '20px' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ height: '52px', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '8px', marginBottom: '8px', animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
        <style>{`@keyframes pulse { 0%,100% { opacity:0.4 } 50% { opacity:0.8 } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Level filter */}
        <div style={{ display: 'flex', gap: '4px', backgroundColor: '#060E1A', borderRadius: '8px', padding: '3px', border: '1px solid #1A2840' }}>
          {LEVELS.map(lv => (
            <button
              key={lv}
              onClick={() => setFilterLevel(lv)}
              style={{
                padding: '4px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                fontSize: '11px', fontWeight: filterLevel === lv ? '700' : '400',
                backgroundColor: filterLevel === lv ? '#0F7ABF22' : 'transparent',
                color: filterLevel === lv ? '#0F7ABF' : '#6B7A8D',
                transition: 'all 0.15s',
              }}
            >{lv}</button>
          ))}
        </div>

        {/* Sort */}
        <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto', backgroundColor: '#060E1A', borderRadius: '8px', padding: '3px', border: '1px solid #1A2840' }}>
          {(['level', 'evidence', 'marketcap'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              style={{
                padding: '4px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                fontSize: '11px', fontWeight: sortBy === s ? '700' : '400',
                backgroundColor: sortBy === s ? '#0F7ABF22' : 'transparent',
                color: sortBy === s ? '#0F7ABF' : '#6B7A8D',
                transition: 'all 0.15s',
              }}
            >{{level:'Severity', evidence:'Evidence', marketcap:'Market Cap'}[s]}</button>
          ))}
        </div>

        <span style={{ fontSize: '11px', color: '#4A5B6C' }}>
          {filtered.length} companies · {quotesLoading ? 'loading quotes…' : 'live prices'}
        </span>
      </div>

      {/* Asymmetry alert */}
      {rows.filter(r => r.is_small_cap && r.level === 'CRITICAL').length > 0 && (
        <div style={{
          marginBottom: '12px', padding: '10px 14px',
          backgroundColor: '#F59E0B08', border: '1px solid #F59E0B28', borderRadius: '8px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <Flag className="w-4 h-4" style={{ color: '#F59E0B', flexShrink: 0 }} />
          <span style={{ fontSize: '12px', color: '#F59E0B' }}>
            <strong>{rows.filter(r => r.is_small_cap && r.level === 'CRITICAL').length}</strong> CRITICAL small-caps (&lt;$2B) — potential size asymmetry plays
          </span>
        </div>
      )}

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '100px 1fr 120px 110px 70px 90px',
        gap: '8px',
        padding: '8px 12px',
        fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px',
        color: '#4A5B6C',
        borderBottom: '1px solid #1A2840',
      }}>
        <span>TICKER</span>
        <span>LAYER</span>
        <span>LEVEL</span>
        <span>MARKET CAP</span>
        <span>SIGNALS</span>
        <span>PRICE</span>
      </div>

      {/* Table rows */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#4A5B6C', fontSize: '13px' }}>
          No bottleneck stocks found for this filter.
        </div>
      ) : (
        filtered.map((row) => {
          const lvStyle = getLevelStyle(row.level);
          const ef = exchangeFlag(row.exchange);
          const isExpanded = expandedRow === row.symbol;
          const changePct = row.change_pct ?? 0;

          return (
            <div key={row.symbol} style={{ borderBottom: '1px solid #1A284030' }}>
              <button
                onClick={() => setExpandedRow(isExpanded ? null : row.symbol)}
                style={{
                  width: '100%', background: isExpanded ? '#0D162380' : 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left', padding: '10px 12px',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '100px 1fr 120px 110px 70px 90px',
                  gap: '8px', alignItems: 'center',
                }}>
                  {/* Ticker */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{row.symbol}</span>
                    {ef && <span title={`Non-US: ${row.exchange}`} style={{ fontSize: '13px' }}>{ef.flag}</span>}
                    {row.is_small_cap && (
                      <span title="Small-cap (<$2B) — size asymmetry" style={{ fontSize: '9px', color: '#F59E0B', border: '1px solid #F59E0B40', padding: '0 4px', borderRadius: '3px', fontWeight: '700' }}>S</span>
                    )}
                  </div>

                  {/* Layer */}
                  <span style={{ fontSize: '11px', color: '#8A95A3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.sub_tag
                      ? row.sub_tag.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
                      : '—'}
                  </span>

                  {/* Level badge */}
                  {lvStyle ? (
                    <span style={{
                      fontSize: '10px', fontWeight: '700',
                      color: lvStyle.color, backgroundColor: lvStyle.bg,
                      border: `1px solid ${lvStyle.border}`,
                      padding: '2px 8px', borderRadius: '4px',
                      display: 'inline-block', textAlign: 'center',
                    }}>{row.level}</span>
                  ) : (
                    <span style={{ fontSize: '11px', color: '#4A5B6C' }}>—</span>
                  )}

                  {/* Market cap */}
                  <span style={{ fontSize: '12px', color: row.is_small_cap ? '#F59E0B' : '#C9D4E0' }}>
                    {formatMarketCap(row.market_cap)}
                  </span>

                  {/* Evidence count */}
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#C9D4E0' }}>{row.evidence_count}</span>

                  {/* Price */}
                  <div>
                    {row.price ? (
                      <>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: '#F5F7FA' }}>
                          ${row.price.toFixed(2)}
                        </span>
                        {changePct !== 0 && (
                          <span style={{ fontSize: '10px', marginLeft: '4px', color: changePct >= 0 ? '#10B981' : '#EF4444' }}>
                            {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#4A5B6C' }}>—</span>
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded evidence panel */}
              {isExpanded && (
                <div style={{ padding: '0 12px 12px 28px', backgroundColor: '#060E1A40' }}>
                  {row.company_name && (
                    <p style={{ fontSize: '12px', color: '#8A95A3', margin: '0 0 8px' }}>
                      {row.company_name}
                      {row.exchange && <span style={{ color: '#4A5B6C' }}> · {row.exchange}</span>}
                    </p>
                  )}
                  <p style={{ fontSize: '11px', color: '#4A5B6C', margin: '0 0 8px', fontWeight: '600', letterSpacing: '0.5px' }}>
                    EVIDENCE HEADLINES
                  </p>
                  {row.headlines.map((h, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: '6px', alignItems: 'flex-start',
                      padding: '6px 8px', marginBottom: '4px',
                      backgroundColor: '#060E1A', borderRadius: '6px',
                      border: '1px solid #1A2840',
                    }}>
                      <Zap className="w-3 h-3" style={{ color: '#0F7ABF', flexShrink: 0, marginTop: '2px' }} />
                      <span style={{ fontSize: '11px', color: '#C9D4E0', lineHeight: '1.4' }}>{h}</span>
                    </div>
                  ))}
                  {row.latest_at && (
                    <p style={{ fontSize: '10px', color: '#4A5B6C', margin: '6px 0 0' }}>
                      Last signal: {timeAgo(row.latest_at)}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BottleneckIntelPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Rotation');

  // Rotation Tracker data
  const {
    data: dashboard,
    isLoading: dashLoading,
    refetch: refetchDash,
    dataUpdatedAt: dashUpdatedAt,
  } = useBottleneckDashboard();

  // Stock Scanner data
  const {
    data: articles = [],
    isLoading: articlesLoading,
    refetch: refetchArticles,
    dataUpdatedAt: articlesUpdatedAt,
  } = useBottleneckNews();

  // Extract unique tickers from bottleneck news for quote enrichment
  const tickerList = useMemo(() => {
    const seen = new Set<string>();
    for (const a of articles) {
      for (const t of getTickerSymbols(a)) seen.add(t);
    }
    return Array.from(seen).slice(0, 40);
  }, [articles]);

  const { data: quotes = [], isLoading: quotesLoading } = useMarketQuotes(tickerList);

  const lastRefreshed = useMemo(() => {
    const ts = activeTab === 'Rotation' ? dashUpdatedAt : articlesUpdatedAt;
    if (!ts) return null;
    try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); } catch { return null; }
  }, [activeTab, dashUpdatedAt, articlesUpdatedAt]);

  const handleRefresh = useCallback(() => {
    refetchDash();
    refetchArticles();
  }, [refetchDash, refetchArticles]);

  const isLoading = activeTab === 'Rotation' ? dashLoading : articlesLoading;

  return (
    <div style={{ minHeight: '100%', backgroundColor: '#0A0E1A' }}>

      {/* Page Header */}
      <div style={{
        padding: '20px 20px 0',
        borderBottom: '1px solid #1A2840',
        backgroundColor: '#0D1623',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <span style={{ fontSize: '18px' }}>🔬</span>
              <h1 style={{
                fontSize: '18px', fontWeight: '800', margin: 0,
                background: 'linear-gradient(90deg, #F5F7FA, #8A95A3)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>BOTTLENECK INTELLIGENCE</h1>
            </div>
            <p style={{ fontSize: '12px', color: '#4A5B6C', margin: 0 }}>
              Serenity Framework · Live Supply Chain Analysis
              {lastRefreshed && <span style={{ marginLeft: '8px' }}>· Updated {lastRefreshed}</span>}
            </p>
          </div>

          <button
            onClick={handleRefresh}
            disabled={isLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', borderRadius: '8px', cursor: 'pointer',
              backgroundColor: 'transparent', border: '1px solid #1A2840',
              color: isLoading ? '#4A5B6C' : '#6B7A8D', fontSize: '12px',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            <RefreshCw className="w-3 h-3" style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
            <span>{isLoading ? 'Loading…' : 'Refresh'}</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </button>
        </div>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: '0' }}>
          {TABS.map((tab) => {
            const cfg = TAB_CONFIG[tab];
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '10px 18px', border: 'none', cursor: 'pointer',
                  backgroundColor: 'transparent',
                  color: active ? '#0F7ABF' : '#6B7A8D',
                  fontSize: '13px', fontWeight: active ? '700' : '400',
                  borderBottom: active ? '2px solid #0F7ABF' : '2px solid transparent',
                  transition: 'all 0.15s', marginBottom: '-1px',
                }}
              >
                {cfg.icon}
                <span>{cfg.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Description */}
      <div style={{ padding: '10px 20px', backgroundColor: '#060E1A', borderBottom: '1px solid #1A2840' }}>
        <p style={{ fontSize: '11px', color: '#4A5B6C', margin: 0 }}>
          {TAB_CONFIG[activeTab].description}
        </p>
      </div>

      {/* Content */}
      {activeTab === 'Rotation' && (
        <RotationTracker
          dashboard={dashboard}
          isLoading={dashLoading}
          refetch={refetchDash}
        />
      )}

      {activeTab === 'Scanner' && (
        <StockScanner
          articles={articles}
          isLoading={articlesLoading}
          quotes={quotes}
          quotesLoading={quotesLoading}
        />
      )}
    </div>
  );
}
