'use client';

import { useState, useEffect, useCallback } from 'react';

// ══════════════════════════════════════════════
// EARNINGS PAGE — Watchlist Quarterly Financials
// Uses /api/market/earnings-scan (screener.in + fallbacks)
// Shows Revenue, OP, OPM%, PAT, NPM%, EPS with YoY/QoQ
// Consolidated/Standalone toggle per card
// Composite scoring: 60% fundamentals + 40% price
// ══════════════════════════════════════════════

const BG = '#0A0E1A';
const CARD = '#0D1623';
const CARD_BORDER = '#1A2540';
const ACCENT = '#0F7ABF';
const TEXT = '#E8ECF1';
const TEXT_DIM = '#8899AA';
const GREEN = '#00C853';
const LIGHT_GREEN = '#4CAF50';
const YELLOW = '#FFD600';
const RED = '#F44336';
const HEADER_BG = '#0A1628';

// No hardcoded default — always fetch from API/localStorage
const DEFAULT_WATCHLIST: string[] = [];

// ── Types matching earnings-scan API ──

interface QuarterFinancials {
  period: string;
  revenue: number;
  operatingProfit: number;
  opm: number;
  pat: number;
  npm: number;
  eps: number;
}

interface EarningsScanCard {
  symbol: string;
  company: string;
  period: string;
  resultDate: string;
  reportType: 'Consolidated' | 'Standalone';
  quarters: QuarterFinancials[];
  revenueYoY: number | null;
  revenueQoQ: number | null;
  opProfitYoY: number | null;
  opProfitQoQ: number | null;
  patYoY: number | null;
  patQoQ: number | null;
  epsYoY: number | null;
  epsQoQ: number | null;
  fundamentalsScore: number;
  priceScore: number;
  totalScore: number;
  grade: 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  dataQuality: 'FULL' | 'PARTIAL' | 'PRICE_ONLY';
  mcap: number | null;
  pe: number | null;
  cmp: number | null;
  isBanking: boolean;
  screenerUrl: string;
  nseUrl: string;
}

interface ScanResponse {
  cards: EarningsScanCard[];
  summary: {
    total: number;
    strong: number;
    good: number;
    ok: number;
    bad: number;
    avgScore: number;
    dataQualityBreakdown: {
      full: number;
      partial: number;
      priceOnly: number;
    };
  };
  source: string;
  updatedAt: string;
}

// ══════════════════════════════════════════════
// HELPER COMPONENTS
// ══════════════════════════════════════════════

function GrowthBadge({ value, fontSize = 12 }: { value: number | null | undefined; fontSize?: number }) {
  if (value === null || value === undefined) return <span style={{ color: TEXT_DIM, fontSize }}>—</span>;
  const color = value > 0 ? GREEN : value < 0 ? RED : TEXT_DIM;
  const prefix = value > 0 ? '+' : '';
  return (
    <span style={{ color, fontSize, fontWeight: 600, fontFamily: 'monospace' }}>
      {prefix}{value.toFixed(1)}%
    </span>
  );
}

function GradeBadge({ grade, color, score }: { grade: string; color: string; score: number }) {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      backgroundColor: `${color}20`,
      border: `1px solid ${color}50`,
      borderRadius: '6px',
      padding: '4px 10px',
    }}>
      <span style={{ color, fontWeight: 700, fontSize: '13px' }}>{grade}</span>
      <span style={{ color: TEXT_DIM, fontSize: '11px' }}>{score}</span>
    </div>
  );
}

function DataQualityDot({ quality }: { quality: string }) {
  const colors: Record<string, string> = {
    'FULL': GREEN,
    'PARTIAL': YELLOW,
    'PRICE_ONLY': RED,
  };
  const labels: Record<string, string> = {
    'FULL': 'Full Data',
    'PARTIAL': 'Partial',
    'PRICE_ONLY': 'Price Only',
  };
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '10px',
      color: colors[quality] || TEXT_DIM,
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        backgroundColor: colors[quality] || TEXT_DIM,
        display: 'inline-block',
      }} />
      {labels[quality] || quality}
    </span>
  );
}

function formatCr(num: number | null): string {
  if (num === null || num === undefined) return '—';
  if (Math.abs(num) >= 100000) return `${(num / 100000).toFixed(0)}L Cr`;
  if (Math.abs(num) >= 1000) return `${(num / 1000).toFixed(1)}K Cr`;
  return `${num.toFixed(0)} Cr`;
}

function formatMcap(num: number | null): string {
  if (num === null || num === undefined) return '—';
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L Cr`;
  if (num >= 1000) return `₹${(num / 1000).toFixed(0)}K Cr`;
  return `₹${num.toFixed(0)} Cr`;
}

// ══════════════════════════════════════════════
// FINANCIAL TABLE COMPONENT
// Shows: Revenue, Operating Profit, OPM%, PAT, NPM%, EPS
// across 3 quarters with YoY/QoQ columns
// ══════════════════════════════════════════════

function FinancialTable({ card }: { card: EarningsScanCard }) {
  const quarters = card.quarters.slice(0, 3);
  if (quarters.length === 0) return null;

  const latest = quarters[0];
  // For banking stocks: hide Op. Profit and OPM% (misleading), show PAT/NPM/EPS prominently
  const metrics = card.isBanking
    ? [
        {
          label: 'Revenue',
          key: 'revenue' as const,
          fmt: (v: number) => `${v.toFixed(0)}`,
          yoy: card.revenueYoY,
          qoq: card.revenueQoQ,
        },
        {
          label: 'PAT',
          key: 'pat' as const,
          fmt: (v: number) => `${v.toFixed(0)}`,
          yoy: card.patYoY,
          qoq: card.patQoQ,
        },
        {
          label: 'NPM %',
          key: 'npm' as const,
          fmt: (v: number) => `${v.toFixed(1)}%`,
          yoy: null,
          qoq: null,
        },
        {
          label: 'EPS',
          key: 'eps' as const,
          fmt: (v: number) => `${v.toFixed(2)}`,
          yoy: card.epsYoY,
          qoq: card.epsQoQ,
        },
      ]
    : [
        {
          label: 'Revenue',
          key: 'revenue' as const,
          fmt: (v: number) => `${v.toFixed(0)}`,
          yoy: card.revenueYoY,
          qoq: card.revenueQoQ,
        },
        {
          label: 'Op. Profit',
          key: 'operatingProfit' as const,
          fmt: (v: number) => `${v.toFixed(0)}`,
          yoy: card.opProfitYoY,
          qoq: card.opProfitQoQ,
        },
        {
          label: 'OPM %',
          key: 'opm' as const,
          fmt: (v: number) => `${v.toFixed(1)}%`,
          yoy: null,
          qoq: null,
        },
        {
          label: 'PAT',
          key: 'pat' as const,
          fmt: (v: number) => `${v.toFixed(0)}`,
          yoy: card.patYoY,
          qoq: card.patQoQ,
        },
        {
          label: 'NPM %',
          key: 'npm' as const,
          fmt: (v: number) => `${v.toFixed(1)}%`,
          yoy: null,
          qoq: null,
        },
        {
          label: 'EPS',
          key: 'eps' as const,
          fmt: (v: number) => `${v.toFixed(2)}`,
          yoy: card.epsYoY,
          qoq: card.epsQoQ,
        },
      ];

  const cellStyle = (isHeader = false): React.CSSProperties => ({
    padding: '5px 8px',
    fontSize: '11px',
    textAlign: 'right' as const,
    borderBottom: `1px solid ${CARD_BORDER}`,
    color: isHeader ? TEXT_DIM : TEXT,
    fontFamily: 'monospace',
    whiteSpace: 'nowrap' as const,
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
        <thead>
          <tr style={{ backgroundColor: `${HEADER_BG}80` }}>
            <th style={{ ...cellStyle(true), textAlign: 'left', fontWeight: 600 }}>Metric</th>
            {quarters.map(q => (
              <th key={q.period} style={{ ...cellStyle(true), fontWeight: 600 }}>
                {q.period}
              </th>
            ))}
            <th style={{ ...cellStyle(true), fontWeight: 600, color: ACCENT }}>YoY</th>
            <th style={{ ...cellStyle(true), fontWeight: 600, color: ACCENT }}>QoQ</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map(m => (
            <tr key={m.label}>
              <td style={{ ...cellStyle(), textAlign: 'left', color: TEXT_DIM, fontWeight: 500, fontFamily: 'inherit' }}>
                {m.label}
              </td>
              {quarters.map(q => (
                <td key={q.period} style={cellStyle()}>
                  {m.fmt(q[m.key])}
                </td>
              ))}
              <td style={cellStyle()}>
                <GrowthBadge value={m.yoy} fontSize={11} />
              </td>
              <td style={cellStyle()}>
                <GrowthBadge value={m.qoq} fontSize={11} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════
// CARD COMPONENT
// ══════════════════════════════════════════════

function EarningsCardComponent({ card }: { card: EarningsScanCard }) {
  return (
    <div style={{
      backgroundColor: CARD,
      border: `1px solid ${CARD_BORDER}`,
      borderRadius: '10px',
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = ACCENT}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = CARD_BORDER}
    >
      {/* Card Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '14px 16px 10px',
        borderBottom: `1px solid ${CARD_BORDER}`,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: TEXT }}>{card.symbol}</span>
            <GradeBadge grade={card.grade} color={card.gradeColor} score={card.totalScore} />
            {card.isBanking && (
              <span style={{
                fontSize: '9px',
                padding: '2px 6px',
                borderRadius: '3px',
                backgroundColor: '#FF980020',
                border: '1px solid #FF980050',
                color: '#FF9800',
                fontWeight: 700,
                letterSpacing: '0.5px',
              }}>BANK</span>
            )}
            <DataQualityDot quality={card.dataQuality} />
          </div>
          <div style={{ fontSize: '12px', color: TEXT_DIM, marginBottom: '4px' }}>
            {card.company}
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '3px',
              backgroundColor: `${ACCENT}25`,
              color: ACCENT,
              fontWeight: 600,
            }}>
              {card.reportType}
            </span>
            <span style={{ fontSize: '10px', color: TEXT_DIM }}>{card.period}</span>
            {card.pe && (
              <span style={{ fontSize: '10px', color: TEXT_DIM }}>PE: {card.pe.toFixed(1)}</span>
            )}
            {card.mcap && (
              <span style={{ fontSize: '10px', color: TEXT_DIM }}>MCap: {formatMcap(card.mcap)}</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {card.cmp && (
            <div style={{ fontSize: '18px', fontWeight: 700, color: TEXT }}>
              ₹{card.cmp.toLocaleString('en-IN')}
            </div>
          )}
        </div>
      </div>

      {/* Financial Table */}
      {card.dataQuality !== 'PRICE_ONLY' && card.quarters.length > 0 ? (
        <div style={{ padding: '8px 12px 12px' }}>
          <FinancialTable card={card} />
        </div>
      ) : (
        <div style={{
          padding: '16px',
          textAlign: 'center',
          color: YELLOW,
          fontSize: '12px',
          backgroundColor: `${YELLOW}08`,
        }}>
          Quarterly financial data not available for this stock
        </div>
      )}

      {/* Card Footer */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        borderTop: `1px solid ${CARD_BORDER}`,
        backgroundColor: `${HEADER_BG}40`,
      }}>
        <div style={{ display: 'flex', gap: '16px' }}>
          <span style={{ fontSize: '10px', color: TEXT_DIM }}>
            F: {card.fundamentalsScore} | P: {card.priceScore} | Total: {card.totalScore}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <a
            href={card.screenerUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '10px',
              color: ACCENT,
              textDecoration: 'none',
              padding: '2px 6px',
              borderRadius: '3px',
              border: `1px solid ${ACCENT}40`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            Screener
          </a>
          <a
            href={card.nseUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '10px',
              color: ACCENT,
              textDecoration: 'none',
              padding: '2px 6px',
              borderRadius: '3px',
              border: `1px solid ${ACCENT}40`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            NSE
          </a>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════

export default function EarningsPage() {
  const [cards, setCards] = useState<EarningsScanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ScanResponse['summary'] | null>(null);
  const [source, setSource] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'symbol' | 'revenueYoY' | 'patYoY'>('score');
  const [filterGrade, setFilterGrade] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'watchlist' | 'nifty50' | 'midcap150' | 'smallcap250'>('watchlist');
  const [watchlistTickers, setWatchlistTickers] = useState<string[]>([]);
  const [watchlistSource, setWatchlistSource] = useState<string>('');

  // Universe definitions — fetched live from /api/market/quotes which uses NSE index API
  // These are fallback static lists; the actual fetch uses the API dynamically
  const UNIVERSE_CONFIG: Record<string, { label: string; emoji: string; apiIndex?: string; fallbackTickers: string[] }> = {
    watchlist: { label: 'Watchlist', emoji: '📋', fallbackTickers: DEFAULT_WATCHLIST },
    nifty50: {
      label: 'Nifty 50', emoji: '📊',
      apiIndex: 'NIFTY 50',
      fallbackTickers: [
        'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 'ITC',
        'BHARTIARTL', 'SBIN', 'LT', 'BAJFINANCE', 'KOTAKBANK', 'AXISBANK',
        'MARUTI', 'TITAN', 'SUNPHARMA', 'WIPRO', 'HCLTECH', 'NESTLEIND', 'M&M',
      ],
    },
    midcap150: {
      label: 'Midcap 150', emoji: '🏢',
      apiIndex: 'NIFTY MIDCAP 150',
      fallbackTickers: [
        'POLYCAB', 'PERSISTENT', 'COFORGE', 'MPHASIS', 'TRENT',
        'OBEROI', 'CUMMINSIND', 'GODREJCP', 'VOLTAS', 'ESCORTS',
        'MFSL', 'PIIND', 'ATUL', 'METROPOLIS', 'LALPATHLAB',
        'IDFCFIRSTB', 'FEDERALBNK', 'BHEL', 'PNB', 'SAIL',
      ],
    },
    smallcap250: {
      label: 'Smallcap 250', emoji: '🔬',
      apiIndex: 'NIFTY SMALLCAP 250',
      fallbackTickers: [
        'KPITTECH', 'ROUTE', 'HAPPSTMNDS', 'TANLA', 'BSOFT',
        'DATAPATTNS', 'GRINDWELL', 'CLEAN', 'AFFLE', 'LATENTVIEW',
        'SAPPHIRE', 'GLAND', 'MEDPLUS', 'RAINBOW', 'DEVYANI',
        'BIKAJI', 'CAMPUS', 'ETHOS', 'KAYNES', 'NETWEB',
      ],
    },
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let symbols: string[] = [];
      let wlSource = 'default';
      const config = UNIVERSE_CONFIG[viewMode];

      if (viewMode === 'watchlist') {
        // Try to fetch watchlist from API first (remote is source of truth — synced via Telegram bot)
        let watchlist = DEFAULT_WATCHLIST;
        try {
          const apiRes = await fetch('/api/watchlist?chatId=5057319640');
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            if (apiData.watchlist && Array.isArray(apiData.watchlist) && apiData.watchlist.length > 0) {
              watchlist = apiData.watchlist;
              wlSource = apiData.source || 'api';
            }
          }
        } catch (e) {
          console.error('Failed to fetch from API, falling back to localStorage:', e);
          try {
            const stored = localStorage.getItem('mc_watchlist_tickers');
            if (stored) {
              const parsed = JSON.parse(stored);
              if (Array.isArray(parsed) && parsed.length > 0) {
                watchlist = parsed;
                wlSource = 'local';
              }
            }
          } catch {}
        }
        symbols = watchlist;
        setWatchlistTickers(watchlist);
        setWatchlistSource(wlSource);
        // Also sync to localStorage so other pages have latest
        try { localStorage.setItem('mc_watchlist_tickers', JSON.stringify(watchlist)); } catch {}
      } else {
        // Index-based mode (Nifty50/Midcap150/Smallcap250)
        // Try live fetch from quotes API to get current constituents
        let indexSymbols: string[] = [];
        if (config.apiIndex) {
          try {
            const quotesRes = await fetch(`/api/market/quotes`);
            if (quotesRes.ok) {
              const quotesData = await quotesRes.json();
              if (quotesData.stocks && Array.isArray(quotesData.stocks)) {
                // Extract symbols from quotes response
                indexSymbols = quotesData.stocks.map((s: any) => s.symbol).filter(Boolean);
              }
            }
          } catch (e) {
            console.warn(`Failed to fetch live index data for ${viewMode}, using fallback`);
          }
        }

        symbols = indexSymbols.length > 0 ? indexSymbols : config.fallbackTickers;
        wlSource = viewMode;
        setWatchlistTickers(symbols);
        setWatchlistSource(wlSource);
      }

      // Cap at 20 symbols for earnings scan (API scraping constraint)
      const symbolsParam = symbols.slice(0, 20).join(',');
      const res = await fetch(`/api/market/earnings-scan?symbols=${symbolsParam}&debug=true`);

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data: ScanResponse = await res.json();
      setCards(data.cards || []);
      setSummary(data.summary || null);
      setSource(data.source || 'unknown');
      setUpdatedAt(data.updatedAt || new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load earnings data');
      console.error('[Earnings Page]', err);
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sort and filter
  const sortedCards = [...cards]
    .filter(c => filterGrade === 'ALL' || c.grade === filterGrade)
    .sort((a, b) => {
      switch (sortBy) {
        case 'symbol': return a.symbol.localeCompare(b.symbol);
        case 'revenueYoY': return (b.revenueYoY || -999) - (a.revenueYoY || -999);
        case 'patYoY': return (b.patYoY || -999) - (a.patYoY || -999);
        default: return b.totalScore - a.totalScore;
      }
    });

  return (
    <div style={{
      backgroundColor: BG,
      minHeight: '100vh',
      padding: '24px',
      color: TEXT,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px 0' }}>
          Earnings Intelligence
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <p style={{ color: TEXT_DIM, margin: 0, fontSize: '13px' }}>
            Watchlist quarterly results with composite scoring &bull; Source: {source || '...'} &bull;{' '}
            {updatedAt ? new Date(updatedAt).toLocaleString('en-IN') : ''}
          </p>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: `${ACCENT}20`,
            border: `1px solid ${ACCENT}50`,
            borderRadius: '20px',
            padding: '4px 12px',
            fontSize: '11px',
            fontWeight: 600,
            color: ACCENT,
          }}>
            {UNIVERSE_CONFIG[viewMode]?.emoji} {UNIVERSE_CONFIG[viewMode]?.label} — {watchlistTickers.length} stocks
            {watchlistSource === 'redis' && <span style={{ color: GREEN }}>● synced</span>}
            {watchlistSource === 'memory' && <span style={{ color: YELLOW }}>● memory</span>}
            {watchlistSource === 'default' && <span style={{ color: TEXT_DIM }}>● default</span>}
          </span>
        </div>
      </div>

      {/* Summary Bar */}
      {summary && !loading && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
          marginBottom: '24px',
        }}>
          {[
            { label: 'Total', value: summary.total, color: ACCENT },
            { label: 'STRONG', value: summary.strong, color: '#00C853' },
            { label: 'GOOD', value: summary.good, color: '#4CAF50' },
            { label: 'OK', value: summary.ok, color: '#FFD600' },
            { label: 'BAD', value: summary.bad, color: '#F44336' },
            { label: 'Avg Score', value: summary.avgScore, color: ACCENT },
          ].map(s => (
            <div key={s.label} style={{
              backgroundColor: CARD,
              border: `1px solid ${CARD_BORDER}`,
              borderRadius: '8px',
              padding: '12px 16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '10px', color: TEXT_DIM, textTransform: 'uppercase', marginBottom: '4px' }}>
                {s.label}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>
                {typeof s.value === 'number' && s.label === 'Avg Score' ? s.value.toFixed(1) : s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters & Controls */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '24px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        {/* View Mode Toggle */}
        <div style={{
          display: 'flex',
          borderRadius: '6px',
          overflow: 'hidden',
          border: `1px solid ${CARD_BORDER}`,
        }}>
          {(Object.entries(UNIVERSE_CONFIG) as [string, typeof UNIVERSE_CONFIG[string]][]).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setViewMode(key as any)}
              style={{
                backgroundColor: viewMode === key ? ACCENT : CARD,
                border: 'none',
                color: viewMode === key ? '#000' : TEXT,
                padding: '8px 14px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600,
                transition: 'all 0.2s',
                borderRight: `1px solid ${CARD_BORDER}`,
              }}
            >
              {cfg.emoji} {cfg.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          style={{
            backgroundColor: CARD,
            border: `1px solid ${CARD_BORDER}`,
            color: TEXT,
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <option value="score">Sort: Score</option>
          <option value="symbol">Sort: Symbol</option>
          <option value="revenueYoY">Sort: Revenue YoY</option>
          <option value="patYoY">Sort: PAT YoY</option>
        </select>

        {/* Grade filter */}
        {['ALL', 'STRONG', 'GOOD', 'OK', 'BAD'].map(g => (
          <button
            key={g}
            onClick={() => setFilterGrade(g)}
            style={{
              backgroundColor: filterGrade === g ? ACCENT : CARD,
              border: `1px solid ${filterGrade === g ? ACCENT : CARD_BORDER}`,
              color: filterGrade === g ? '#000' : TEXT,
              padding: '8px 14px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              transition: 'all 0.2s',
            }}
          >
            {g}
          </button>
        ))}

        {/* Refresh */}
        <button
          onClick={fetchData}
          disabled={loading}
          style={{
            marginLeft: 'auto',
            backgroundColor: ACCENT,
            border: 'none',
            color: '#000',
            padding: '8px 16px',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: 600,
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Data Quality Summary */}
      {summary && !loading && (
        <div style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '20px',
          fontSize: '11px',
          color: TEXT_DIM,
        }}>
          <span style={{ color: GREEN }}>● Full: {summary.dataQualityBreakdown.full}</span>
          <span style={{ color: YELLOW }}>● Partial: {summary.dataQualityBreakdown.partial}</span>
          <span style={{ color: RED }}>● Price Only: {summary.dataQualityBreakdown.priceOnly}</span>
          <span>Showing {sortedCards.length} of {cards.length}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{
            width: '44px', height: '44px',
            border: `3px solid ${CARD_BORDER}`,
            borderTop: `3px solid ${ACCENT}`,
            borderRadius: '50%',
            margin: '0 auto 16px',
            animation: 'spin 1s linear infinite',
          }} />
          <p style={{ color: TEXT_DIM, margin: 0 }}>
            Scanning quarterly results for watchlist stocks...
          </p>
          <p style={{ color: TEXT_DIM, margin: '8px 0 0', fontSize: '12px' }}>
            This may take 15-30 seconds (fetching from multiple sources)
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{
          backgroundColor: `${RED}15`,
          border: `1px solid ${RED}40`,
          borderRadius: '8px',
          padding: '16px',
          color: RED,
          marginBottom: '24px',
        }}>
          <strong>Error:</strong> {error}
          <button
            onClick={fetchData}
            style={{
              marginLeft: '12px',
              backgroundColor: RED,
              border: 'none',
              color: '#fff',
              padding: '4px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Cards Grid */}
      {!loading && !error && sortedCards.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
          gap: '16px',
        }}>
          {sortedCards.map(card => (
            <EarningsCardComponent key={card.symbol} card={card} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && sortedCards.length === 0 && (
        <div style={{
          backgroundColor: CARD,
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: '8px',
          padding: '60px 20px',
          textAlign: 'center',
          color: TEXT_DIM,
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
          <p style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 500 }}>
            No earnings data available
          </p>
          <p style={{ margin: 0, fontSize: '13px' }}>
            {cards.length > 0
              ? `${cards.length} cards loaded but none match the "${filterGrade}" filter. Try "ALL".`
              : 'Add stocks to your watchlist or check back later.'
            }
          </p>
        </div>
      )}
    </div>
  );
}
