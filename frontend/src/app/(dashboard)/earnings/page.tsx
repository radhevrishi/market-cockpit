'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Download, AlertTriangle } from 'lucide-react';

// ══════════════════════════════════════════════
// EARNINGS PAGE — Custom Universe Only
// Sources: Portfolio / Watchlist / Both
// Shows: Revenue, OP, OPM%, PAT, NPM%, EPS with YoY/QoQ
// Aggregates: Avg growth metrics, trend analysis, risk flags
// ══════════════════════════════════════════════

const BG = '#0A0E1A';
const CARD = '#0D1623';
const CARD_BORDER = '#1A2540';
const ACCENT = '#0F7ABF';
const TEXT = '#E8ECF1';
const TEXT_DIM = '#8899AA';
const GREEN = '#00C853';
const YELLOW = '#FFD600';
const RED = '#F44336';
const HEADER_BG = '#0A1628';

const CHAT_ID = '5057319640';

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
  // Extended: which universe the stock belongs to
  universeTag?: 'portfolio' | 'watchlist' | 'both';
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
    dataQualityBreakdown: { full: number; partial: number; priceOnly: number };
  };
  source: string;
  updatedAt: string;
  failed?: string[];
  requestedSymbols?: string[];
}

type ViewMode = 'portfolio' | 'watchlist' | 'both';

// ── Aggregation Types ──

interface UniverseAggregation {
  label: string;
  count: number;
  avgRevenueYoY: number | null;
  avgPatYoY: number | null;
  avgEpsYoY: number | null;
  avgOpmChange: number | null;
  risingEarningsPct: number;
  marginExpansionPct: number;
  riskFlags: number; // high D/E + negative growth
  avgScore: number;
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
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      backgroundColor: `${color}20`, border: `1px solid ${color}50`,
      borderRadius: '6px', padding: '4px 10px',
    }}>
      <span style={{ color, fontWeight: 700, fontSize: '13px' }}>{grade}</span>
      <span style={{ color: TEXT_DIM, fontSize: '11px' }}>{score}</span>
    </div>
  );
}

function DataQualityDot({ quality }: { quality: string }) {
  const colors: Record<string, string> = { 'FULL': GREEN, 'PARTIAL': YELLOW, 'PRICE_ONLY': RED };
  const labels: Record<string, string> = { 'FULL': 'Full Data', 'PARTIAL': 'Partial', 'PRICE_ONLY': 'Price Only' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: colors[quality] || TEXT_DIM }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: colors[quality] || TEXT_DIM, display: 'inline-block' }} />
      {labels[quality] || quality}
    </span>
  );
}

function formatMcap(num: number | null): string {
  if (num === null || num === undefined) return '—';
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L Cr`;
  if (num >= 1000) return `₹${(num / 1000).toFixed(0)}K Cr`;
  return `₹${num.toFixed(0)} Cr`;
}

// ══════════════════════════════════════════════
// AGGREGATION PANEL
// Shows avg growth metrics for Portfolio / Watchlist
// ══════════════════════════════════════════════

function AggregationPanel({ agg, color }: { agg: UniverseAggregation; color: string }) {
  if (agg.count === 0) return null;

  const metrics = [
    { label: 'Avg Sales Growth', value: agg.avgRevenueYoY, suffix: '%' },
    { label: 'Avg Profit Growth', value: agg.avgPatYoY, suffix: '%' },
    { label: 'Avg EPS Growth', value: agg.avgEpsYoY, suffix: '%' },
    { label: 'Avg Score', value: agg.avgScore, suffix: '', isScore: true },
  ];

  return (
    <div style={{
      backgroundColor: CARD, border: `1px solid ${color}40`, borderRadius: '10px',
      padding: '16px', borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: TEXT }}>{agg.label}</span>
        <span style={{ fontSize: '11px', color: TEXT_DIM, backgroundColor: `${color}20`, padding: '2px 8px', borderRadius: '10px' }}>
          {agg.count} stocks
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        {metrics.map(m => (
          <div key={m.label}>
            <div style={{ fontSize: '10px', color: TEXT_DIM, marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{m.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: m.isScore ? ACCENT : (m.value !== null && m.value > 0 ? GREEN : m.value !== null && m.value < 0 ? RED : TEXT_DIM), fontFamily: 'monospace' }}>
              {m.value !== null ? `${m.value > 0 ? '+' : ''}${m.value.toFixed(1)}${m.suffix}` : '—'}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '16px', marginTop: '10px', fontSize: '11px' }}>
        <span style={{ color: GREEN }}>↑ Rising earnings: {agg.risingEarningsPct.toFixed(0)}%</span>
        <span style={{ color: agg.marginExpansionPct > 50 ? GREEN : YELLOW }}>Margin expansion: {agg.marginExpansionPct.toFixed(0)}%</span>
        {agg.riskFlags > 0 && <span style={{ color: RED }}>⚠ Risk flags: {agg.riskFlags}</span>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// BOTTOM SUMMARY
// ══════════════════════════════════════════════

function BottomSummary({ cards }: { cards: EarningsScanCard[] }) {
  const withData = cards.filter(c => c.dataQuality !== 'PRICE_ONLY');
  if (withData.length === 0) return null;

  const risingCount = withData.filter(c => (c.revenueYoY || 0) > 0 && (c.patYoY || 0) > 0).length;
  const marginExpCount = withData.filter(c => {
    if (c.quarters.length < 2) return false;
    return c.quarters[0].opm > c.quarters[1].opm;
  }).length;
  const riskCount = withData.filter(c => (c.patYoY || 0) < -10 && (c.revenueYoY || 0) < 0).length;

  const items = [
    { label: 'Total Analyzed', value: `${withData.length}`, color: ACCENT },
    { label: 'Rising Earnings', value: `${risingCount} (${withData.length > 0 ? ((risingCount / withData.length) * 100).toFixed(0) : 0}%)`, color: GREEN },
    { label: 'Margin Expansion', value: `${marginExpCount} (${withData.length > 0 ? ((marginExpCount / withData.length) * 100).toFixed(0) : 0}%)`, color: marginExpCount > withData.length / 2 ? GREEN : YELLOW },
    { label: 'Risk Flags', value: `${riskCount}`, color: riskCount > 0 ? RED : GREEN, sub: 'Negative growth + declining revenue' },
  ];

  return (
    <div style={{
      marginTop: '24px', backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '10px',
      padding: '16px',
    }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: TEXT_DIM, marginBottom: '12px', letterSpacing: '0.5px' }}>SYSTEM SUMMARY</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
        {items.map(item => (
          <div key={item.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: TEXT_DIM, marginBottom: '4px', textTransform: 'uppercase' }}>{item.label}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: item.color }}>{item.value}</div>
            {item.sub && <div style={{ fontSize: '9px', color: TEXT_DIM, marginTop: '2px' }}>{item.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// FINANCIAL TABLE
// ══════════════════════════════════════════════

function FinancialTable({ card }: { card: EarningsScanCard }) {
  const quarters = card.quarters.slice(0, 3);
  if (quarters.length === 0) return null;

  const metrics = card.isBanking
    ? [
        { label: 'Revenue', key: 'revenue' as const, fmt: (v: number) => `${v.toFixed(0)}`, yoy: card.revenueYoY, qoq: card.revenueQoQ },
        { label: 'PAT', key: 'pat' as const, fmt: (v: number) => `${v.toFixed(0)}`, yoy: card.patYoY, qoq: card.patQoQ },
        { label: 'NPM %', key: 'npm' as const, fmt: (v: number) => `${v.toFixed(1)}%`, yoy: null, qoq: null },
        { label: 'EPS', key: 'eps' as const, fmt: (v: number) => `${v.toFixed(2)}`, yoy: card.epsYoY, qoq: card.epsQoQ },
      ]
    : [
        { label: 'Revenue', key: 'revenue' as const, fmt: (v: number) => `${v.toFixed(0)}`, yoy: card.revenueYoY, qoq: card.revenueQoQ },
        { label: 'Op. Profit', key: 'operatingProfit' as const, fmt: (v: number) => `${v.toFixed(0)}`, yoy: card.opProfitYoY, qoq: card.opProfitQoQ },
        { label: 'OPM %', key: 'opm' as const, fmt: (v: number) => `${v.toFixed(1)}%`, yoy: null, qoq: null },
        { label: 'PAT', key: 'pat' as const, fmt: (v: number) => `${v.toFixed(0)}`, yoy: card.patYoY, qoq: card.patQoQ },
        { label: 'NPM %', key: 'npm' as const, fmt: (v: number) => `${v.toFixed(1)}%`, yoy: null, qoq: null },
        { label: 'EPS', key: 'eps' as const, fmt: (v: number) => `${v.toFixed(2)}`, yoy: card.epsYoY, qoq: card.epsQoQ },
      ];

  const cellStyle = (isHeader = false): React.CSSProperties => ({
    padding: '5px 8px', fontSize: '11px', textAlign: 'right', borderBottom: `1px solid ${CARD_BORDER}`,
    color: isHeader ? TEXT_DIM : TEXT, fontFamily: 'monospace', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
        <thead>
          <tr style={{ backgroundColor: `${HEADER_BG}80` }}>
            <th style={{ ...cellStyle(true), textAlign: 'left', fontWeight: 600 }}>Metric</th>
            {quarters.map(q => <th key={q.period} style={{ ...cellStyle(true), fontWeight: 600 }}>{q.period}</th>)}
            <th style={{ ...cellStyle(true), fontWeight: 600, color: ACCENT }}>YoY</th>
            <th style={{ ...cellStyle(true), fontWeight: 600, color: ACCENT }}>QoQ</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map(m => (
            <tr key={m.label}>
              <td style={{ ...cellStyle(), textAlign: 'left', color: TEXT_DIM, fontWeight: 500, fontFamily: 'inherit' }}>{m.label}</td>
              {quarters.map(q => <td key={q.period} style={cellStyle()}>{m.fmt(q[m.key])}</td>)}
              <td style={cellStyle()}><GrowthBadge value={m.yoy} fontSize={11} /></td>
              <td style={cellStyle()}><GrowthBadge value={m.qoq} fontSize={11} /></td>
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
  const tagColor = card.universeTag === 'portfolio' ? '#10B981' : card.universeTag === 'both' ? '#8B5CF6' : ACCENT;
  const tagLabel = card.universeTag === 'portfolio' ? 'PORTFOLIO' : card.universeTag === 'both' ? 'BOTH' : 'WATCHLIST';

  return (
    <div style={{
      backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '10px',
      overflow: 'hidden', transition: 'border-color 0.2s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = ACCENT}
      onMouseLeave={e => e.currentTarget.style.borderColor = CARD_BORDER}
    >
      {/* Card Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px 10px', borderBottom: `1px solid ${CARD_BORDER}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: TEXT }}>{card.symbol}</span>
            <GradeBadge grade={card.grade} color={card.gradeColor} score={card.totalScore} />
            <span style={{
              fontSize: '8px', padding: '2px 6px', borderRadius: '3px',
              backgroundColor: `${tagColor}20`, border: `1px solid ${tagColor}50`,
              color: tagColor, fontWeight: 700, letterSpacing: '0.5px',
            }}>{tagLabel}</span>
            {card.isBanking && (
              <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '3px', backgroundColor: '#FF980020', border: '1px solid #FF980050', color: '#FF9800', fontWeight: 700 }}>BANK</span>
            )}
            <DataQualityDot quality={card.dataQuality} />
          </div>
          <div style={{ fontSize: '12px', color: TEXT_DIM, marginBottom: '4px' }}>{card.company}</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '3px', backgroundColor: `${ACCENT}25`, color: ACCENT, fontWeight: 600 }}>{card.reportType}</span>
            <span style={{ fontSize: '10px', color: TEXT_DIM }}>{card.period}</span>
            {card.pe && <span style={{ fontSize: '10px', color: TEXT_DIM }}>PE: {card.pe.toFixed(1)}</span>}
            {card.mcap && <span style={{ fontSize: '10px', color: TEXT_DIM }}>MCap: {formatMcap(card.mcap)}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {card.cmp && <div style={{ fontSize: '18px', fontWeight: 700, color: TEXT }}>₹{card.cmp.toLocaleString('en-IN')}</div>}
        </div>
      </div>

      {/* Financial Table */}
      {card.dataQuality !== 'PRICE_ONLY' && card.quarters.length > 0 ? (
        <div style={{ padding: '8px 12px 12px' }}><FinancialTable card={card} /></div>
      ) : (
        <div style={{ padding: '16px', textAlign: 'center', color: YELLOW, fontSize: '12px', backgroundColor: `${YELLOW}08` }}>
          Quarterly financial data not available for this stock
        </div>
      )}

      {/* Card Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${CARD_BORDER}`, backgroundColor: `${HEADER_BG}40` }}>
        <div style={{ display: 'flex', gap: '16px' }}>
          <span style={{ fontSize: '10px', color: TEXT_DIM }}>F: {card.fundamentalsScore} | P: {card.priceScore} | Total: {card.totalScore}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <a href={card.screenerUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '10px', color: ACCENT, textDecoration: 'none', padding: '2px 6px', borderRadius: '3px', border: `1px solid ${ACCENT}40` }}
            onClick={e => e.stopPropagation()}>Screener</a>
          <a href={card.nseUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '10px', color: ACCENT, textDecoration: 'none', padding: '2px 6px', borderRadius: '3px', border: `1px solid ${ACCENT}40` }}
            onClick={e => e.stopPropagation()}>NSE</a>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// COMPUTE AGGREGATIONS
// ══════════════════════════════════════════════

function computeAggregation(cards: EarningsScanCard[], label: string): UniverseAggregation {
  const withData = cards.filter(c => c.dataQuality !== 'PRICE_ONLY');
  if (withData.length === 0) return { label, count: 0, avgRevenueYoY: null, avgPatYoY: null, avgEpsYoY: null, avgOpmChange: null, risingEarningsPct: 0, marginExpansionPct: 0, riskFlags: 0, avgScore: 0 };

  const revYoY = withData.filter(c => c.revenueYoY !== null).map(c => c.revenueYoY!);
  const patYoY = withData.filter(c => c.patYoY !== null).map(c => c.patYoY!);
  const epsYoY = withData.filter(c => c.epsYoY !== null).map(c => c.epsYoY!);

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  const risingCount = withData.filter(c => (c.revenueYoY || 0) > 0 && (c.patYoY || 0) > 0).length;
  const marginExpCount = withData.filter(c => {
    if (c.quarters.length < 2) return false;
    return c.quarters[0].opm > c.quarters[1].opm;
  }).length;
  const riskCount = withData.filter(c => (c.patYoY || 0) < -10 && (c.revenueYoY || 0) < 0).length;

  return {
    label,
    count: cards.length,
    avgRevenueYoY: avg(revYoY),
    avgPatYoY: avg(patYoY),
    avgEpsYoY: avg(epsYoY),
    avgOpmChange: null, // Not computed directly
    risingEarningsPct: withData.length > 0 ? (risingCount / withData.length) * 100 : 0,
    marginExpansionPct: withData.length > 0 ? (marginExpCount / withData.length) * 100 : 0,
    riskFlags: riskCount,
    avgScore: cards.length > 0 ? cards.reduce((s, c) => s + c.totalScore, 0) / cards.length : 0,
  };
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
  const [viewMode, setViewMode] = useState<ViewMode>('watchlist');
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [failedSymbols, setFailedSymbols] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    setFailedSymbols([]);
    try {
      // Always fetch both portfolio and watchlist
      let portfolio: string[] = [];
      let watchlist: string[] = [];

      // Fetch portfolio
      try {
        const pRes = await fetch(`/api/portfolio?chatId=${CHAT_ID}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          portfolio = (pData.holdings || []).map((h: any) => h.symbol);
        }
      } catch (e) { console.error('Portfolio fetch failed:', e); }

      // Fetch watchlist
      try {
        const wRes = await fetch(`/api/watchlist?chatId=${CHAT_ID}`);
        if (wRes.ok) {
          const wData = await wRes.json();
          watchlist = wData.watchlist || [];
        }
      } catch (e) {
        console.error('Watchlist fetch failed:', e);
        try {
          const stored = localStorage.getItem('mc_watchlist_tickers');
          if (stored) watchlist = JSON.parse(stored);
        } catch {}
      }

      setPortfolioSymbols(portfolio);
      setWatchlistSymbols(watchlist);

      // Determine which symbols to scan
      let symbols: string[] = [];
      const portfolioSet = new Set(portfolio);
      const watchlistSet = new Set(watchlist);

      if (viewMode === 'portfolio') {
        symbols = portfolio;
      } else if (viewMode === 'watchlist') {
        symbols = watchlist;
      } else {
        // Both — deduplicated union
        symbols = [...new Set([...portfolio, ...watchlist])];
      }

      if (symbols.length === 0) {
        setCards([]);
        setSummary(null);
        setLoading(false);
        return;
      }

      // Batch symbols into groups of 30
      const BATCH_SIZE = 30;
      let allCards: EarningsScanCard[] = [];
      let allFailed: string[] = [];
      let lastSummary: any = null;
      let lastSource = 'unknown';
      let lastUpdatedAt = new Date().toISOString();

      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE);
        const res = await fetch(`/api/market/earnings-scan?symbols=${batch.join(',')}&debug=true`);
        if (!res.ok) { console.error(`Batch ${i / BATCH_SIZE + 1} failed`); continue; }
        const data: ScanResponse = await res.json();
        allCards = [...allCards, ...(data.cards || [])];
        if (data.failed) allFailed = [...allFailed, ...data.failed];
        if (data.summary) lastSummary = data.summary;
        if (data.source) lastSource = data.source;
        if (data.updatedAt) lastUpdatedAt = data.updatedAt;
      }

      // Tag each card with universe membership
      allCards = allCards.map(c => ({
        ...c,
        universeTag: (portfolioSet.has(c.symbol) && watchlistSet.has(c.symbol)) ? 'both'
          : portfolioSet.has(c.symbol) ? 'portfolio'
          : 'watchlist',
      }));

      // Enrich cards with live CMP/MCap data from quotes APIs
      try {
        const cardSymbols = allCards.map(c => c.symbol);
        // quoteMap stores: price, mcapCr (market cap in Crores)
        const quoteMap = new Map<string, { price: number; mcapCr: number | null }>();

        // 1) Try bulk quotes (fast, covers index stocks)
        //    Bulk API returns marketCap in lakhs → convert to Cr by dividing by 100
        try {
          const quotesRes = await fetch('/api/market/quotes');
          if (quotesRes.ok) {
            const quotesData = await quotesRes.json();
            (quotesData.stocks || []).forEach((q: any) => {
              const mcapLakhs = q.marketCap || 0;
              quoteMap.set(q.ticker, {
                price: q.price || 0,
                mcapCr: mcapLakhs > 0 ? Math.round(mcapLakhs / 100) : null,
              });
            });
          }
        } catch {}

        // 2) Fetch individual quotes for symbols not in bulk (small/micro-cap)
        //    Individual API returns marketCap already in Cr
        const missingFromBulk = cardSymbols.filter(s => !quoteMap.has(s));
        if (missingFromBulk.length > 0) {
          for (let i = 0; i < missingFromBulk.length; i += 20) {
            const batch = missingFromBulk.slice(i, i + 20);
            try {
              const iqRes = await fetch(`/api/market/quote?symbols=${batch.join(',')}`);
              if (iqRes.ok) {
                const iqData = await iqRes.json();
                (iqData.quotes || []).forEach((q: any) => {
                  quoteMap.set(q.ticker, { price: q.price || 0, mcapCr: q.marketCap || null });
                });
              }
            } catch {}
          }
        }

        // 3) Merge live data into cards (mcap in Cr, cmp = live price)
        //    Always prefer live quote price. For mcap: prefer live if available, else keep screener's
        allCards = allCards.map(c => {
          const q = quoteMap.get(c.symbol);
          if (q) {
            return {
              ...c,
              cmp: q.price > 0 ? q.price : c.cmp,
              mcap: q.mcapCr && q.mcapCr > 0 ? q.mcapCr : c.mcap,
            };
          }
          return c;
        });
      } catch (e) { console.error('Quote enrichment failed:', e); }

      // Recompute summary across all cards
      if (allCards.length > 0) {
        const strong = allCards.filter(c => c.grade === 'STRONG').length;
        const good = allCards.filter(c => c.grade === 'GOOD').length;
        const ok = allCards.filter(c => c.grade === 'OK').length;
        const bad = allCards.filter(c => c.grade === 'BAD').length;
        const avgScore = allCards.reduce((s, c) => s + c.totalScore, 0) / allCards.length;
        const full = allCards.filter(c => c.dataQuality === 'FULL').length;
        const partial = allCards.filter(c => c.dataQuality === 'PARTIAL').length;
        const priceOnly = allCards.filter(c => c.dataQuality === 'PRICE_ONLY').length;

        lastSummary = { total: allCards.length, strong, good, ok, bad, avgScore, dataQualityBreakdown: { full, partial, priceOnly } };
      }

      setCards(allCards);
      setFailedSymbols(allFailed);
      setSummary(lastSummary);
      setSource(lastSource);
      setUpdatedAt(lastUpdatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load earnings data');
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Sort and filter
  const sortedCards = useMemo(() =>
    [...cards]
      .filter(c => filterGrade === 'ALL' || c.grade === filterGrade)
      .sort((a, b) => {
        switch (sortBy) {
          case 'symbol': return a.symbol.localeCompare(b.symbol);
          case 'revenueYoY': return (b.revenueYoY || -999) - (a.revenueYoY || -999);
          case 'patYoY': return (b.patYoY || -999) - (a.patYoY || -999);
          default: return b.totalScore - a.totalScore;
        }
      }),
    [cards, filterGrade, sortBy]
  );

  // Compute aggregations
  const portfolioAgg = useMemo(() =>
    computeAggregation(cards.filter(c => c.universeTag === 'portfolio' || c.universeTag === 'both'), 'PORTFOLIO SUMMARY'),
    [cards]
  );

  const watchlistAgg = useMemo(() =>
    computeAggregation(cards.filter(c => c.universeTag === 'watchlist' || c.universeTag === 'both'), 'WATCHLIST SUMMARY'),
    [cards]
  );

  // Show actual card count (with data) vs total requested symbols
  const portfolioCardCount = cards.filter(c => c.universeTag === 'portfolio' || c.universeTag === 'both').length;
  const watchlistCardCount = cards.filter(c => c.universeTag === 'watchlist' || c.universeTag === 'both').length;
  const bothCardCount = cards.length;

  const VIEW_TABS: { key: ViewMode; label: string; emoji: string; count: number; total: number }[] = [
    { key: 'portfolio', label: 'Portfolio', emoji: '💼', count: portfolioCardCount, total: portfolioSymbols.length },
    { key: 'watchlist', label: 'Watchlist', emoji: '📋', count: watchlistCardCount, total: watchlistSymbols.length },
    { key: 'both', label: 'Both', emoji: '🔗', count: bothCardCount, total: new Set([...portfolioSymbols, ...watchlistSymbols]).size },
  ];

  // ── PDF Download ──
  const handleDownloadPDF = useCallback(async () => {
    if (sortedCards.length === 0) return;
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.width;
    const now = new Date().toLocaleString('en-IN');
    const modeLabel = viewMode === 'both' ? 'Portfolio + Watchlist' : viewMode === 'portfolio' ? 'Portfolio' : 'Watchlist';

    // ── Header bar ──
    doc.setFillColor(10, 14, 26);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(245, 247, 250);
    doc.text(`Market Cockpit — Earnings Intelligence`, 14, 11);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180);
    doc.text(`${modeLabel} · ${sortedCards.length} companies · ${now}`, pageW - 14, 11, { align: 'right' });

    // ── Summary bar ──
    doc.setTextColor(60);
    let summaryY = 24;
    if (summary) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const summaryParts = [
        `Total: ${summary.total}`,
        `STRONG: ${summary.strong}`,
        `GOOD: ${summary.good}`,
        `OK: ${summary.ok}`,
        `BAD: ${summary.bad}`,
        `Avg Score: ${summary.avgScore.toFixed(1)}`,
      ];
      doc.text(summaryParts.join('  |  '), 14, summaryY);
      summaryY += 6;
    }

    // Helper: format number in lakhs/crores for compact display
    const fmtCr = (v: number) => {
      if (v >= 100000) return `${(v / 100000).toFixed(1)}L Cr`;
      if (v >= 1000) return `${(v / 1000).toFixed(1)}K Cr`;
      return `${v.toLocaleString('en-IN')} Cr`;
    };

    // ── Table ──
    const headers = [['#', 'Symbol', 'Company', 'Grade', 'Score', 'Period', 'Rev Cr', 'Rev YoY', 'OP Cr', 'OP YoY', 'OPM%', 'PAT Cr', 'PAT YoY', 'EPS', 'EPS YoY', 'CMP', 'MCap Cr', 'P/E']];
    const body = sortedCards.map((c, i) => {
      const q = c.quarters[0];
      const fmtPct = (v: number | null) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';
      return [
        i + 1,
        c.symbol,
        c.company.length > 24 ? c.company.slice(0, 22) + '..' : c.company,
        c.grade,
        c.totalScore.toFixed(0),
        c.period || q?.period || '—',
        q ? q.revenue.toLocaleString('en-IN') : '—',
        fmtPct(c.revenueYoY),
        q ? q.operatingProfit.toLocaleString('en-IN') : '—',
        fmtPct(c.opProfitYoY),
        q ? `${q.opm.toFixed(1)}%` : '—',
        q ? q.pat.toLocaleString('en-IN') : '—',
        fmtPct(c.patYoY),
        q ? q.eps.toFixed(2) : '—',
        fmtPct(c.epsYoY),
        c.cmp ? `${c.cmp.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—',
        c.mcap ? fmtCr(c.mcap) : '—',
        c.pe ? c.pe.toFixed(1) : '—',
      ];
    });

    autoTable(doc, {
      startY: summaryY + 1,
      head: headers,
      body,
      theme: 'striped',
      styles: { fontSize: 6.5, cellPadding: 1.2, overflow: 'linebreak', textColor: [40, 40, 40] },
      headStyles: { fillColor: [15, 122, 191], textColor: 255, fontSize: 6.5, fontStyle: 'bold', halign: 'center' },
      alternateRowStyles: { fillColor: [245, 248, 252] },
      columnStyles: {
        0: { cellWidth: 6, halign: 'center' },
        1: { cellWidth: 16, fontStyle: 'bold' },
        2: { cellWidth: 30 },
        3: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
        4: { cellWidth: 10, halign: 'center' },
        5: { cellWidth: 16 },
        6: { cellWidth: 14, halign: 'right' },
        7: { cellWidth: 14, halign: 'right' },
        8: { cellWidth: 12, halign: 'right' },
        9: { cellWidth: 14, halign: 'right' },
        10: { cellWidth: 10, halign: 'right' },
        11: { cellWidth: 12, halign: 'right' },
        12: { cellWidth: 14, halign: 'right' },
        13: { cellWidth: 10, halign: 'right' },
        14: { cellWidth: 14, halign: 'right' },
        15: { cellWidth: 14, halign: 'right' },
        16: { cellWidth: 16, halign: 'right' },
        17: { cellWidth: 10, halign: 'right' },
      },
      didParseCell: (data: any) => {
        if (data.section !== 'body') return;
        // Color grade cells
        if (data.column.index === 3) {
          const grade = data.cell.raw;
          if (grade === 'STRONG') data.cell.styles.textColor = [0, 160, 60];
          else if (grade === 'GOOD') data.cell.styles.textColor = [50, 140, 50];
          else if (grade === 'OK') data.cell.styles.textColor = [200, 130, 0];
          else if (grade === 'BAD') data.cell.styles.textColor = [220, 40, 40];
        }
        // Color YoY/growth % cells (indices 7,9,12,14)
        if ([7, 9, 12, 14].includes(data.column.index)) {
          const val = parseFloat(data.cell.raw);
          if (!isNaN(val)) {
            data.cell.styles.textColor = val >= 0 ? [0, 120, 40] : [200, 20, 20];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });

    // ── Failed symbols note ──
    if (failedSymbols.length > 0) {
      const lastPage = doc.getNumberOfPages();
      doc.setPage(lastPage);
      const finalY = (doc as any).lastAutoTable?.finalY || 180;
      doc.setFontSize(7);
      doc.setTextColor(180, 80, 80);
      doc.text(`Earnings data unavailable for: ${failedSymbols.join(', ')}`, 14, finalY + 6);
    }

    // ── Footer ──
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setTextColor(140);
      doc.text(`Market Cockpit · ${now} · Page ${p}/${pageCount}`, 14, doc.internal.pageSize.height - 5);
      doc.text('Source: screener.in + NSE', pageW - 14, doc.internal.pageSize.height - 5, { align: 'right' });
    }

    doc.save(`earnings-${viewMode}-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [sortedCards, viewMode, summary, source, failedSymbols]);

  return (
    <div style={{ backgroundColor: BG, minHeight: '100vh', padding: '24px', color: TEXT, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px 0' }}>Earnings Intelligence</h1>
        <p style={{ color: TEXT_DIM, margin: 0, fontSize: '13px' }}>
          Custom universe quarterly results · Portfolio + Watchlist only · Source: {source || '...'} · {updatedAt ? new Date(updatedAt).toLocaleString('en-IN') : ''}
        </p>
      </div>

      {/* View Mode Toggle */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${CARD_BORDER}` }}>
          {VIEW_TABS.map(tab => (
            <button key={tab.key} onClick={() => setViewMode(tab.key)} style={{
              backgroundColor: viewMode === tab.key ? ACCENT : CARD,
              border: 'none', color: viewMode === tab.key ? '#000' : TEXT,
              padding: '10px 18px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
              transition: 'all 0.2s', borderRight: `1px solid ${CARD_BORDER}`,
            }}>
              {tab.emoji} {tab.label} ({loading ? '...' : tab.count === tab.total ? tab.count : `${tab.count}/${tab.total}`})
            </button>
          ))}
        </div>

        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={{
          backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, color: TEXT,
          padding: '8px 12px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
        }}>
          <option value="score">Sort: Score</option>
          <option value="symbol">Sort: Symbol</option>
          <option value="revenueYoY">Sort: Revenue YoY</option>
          <option value="patYoY">Sort: PAT YoY</option>
        </select>

        {['ALL', 'STRONG', 'GOOD', 'OK', 'BAD'].map(g => (
          <button key={g} onClick={() => setFilterGrade(g)} style={{
            backgroundColor: filterGrade === g ? ACCENT : CARD,
            border: `1px solid ${filterGrade === g ? ACCENT : CARD_BORDER}`,
            color: filterGrade === g ? '#000' : TEXT,
            padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
          }}>{g}</button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {cards.length > 0 && (
            <button onClick={handleDownloadPDF} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              backgroundColor: '#1A2540', border: `1px solid ${CARD_BORDER}`, color: TEXT,
              padding: '8px 14px', borderRadius: '6px', cursor: 'pointer',
              fontSize: '12px', fontWeight: 600, transition: 'all 0.2s',
            }}>
              <Download style={{ width: '14px', height: '14px' }} /> PDF
            </button>
          )}
          <button onClick={fetchData} disabled={loading} style={{
            backgroundColor: ACCENT, border: 'none', color: '#000',
            padding: '8px 16px', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: 600, opacity: loading ? 0.5 : 1,
          }}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Aggregation Panels */}
      {!loading && cards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'both' ? '1fr 1fr' : '1fr', gap: '16px', marginBottom: '24px' }}>
          {(viewMode === 'portfolio' || viewMode === 'both') && <AggregationPanel agg={portfolioAgg} color="#10B981" />}
          {(viewMode === 'watchlist' || viewMode === 'both') && <AggregationPanel agg={watchlistAgg} color={ACCENT} />}
        </div>
      )}

      {/* Grade Summary Bar */}
      {summary && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          {[
            { label: 'Total', value: summary.total, color: ACCENT },
            { label: 'STRONG', value: summary.strong, color: '#00C853' },
            { label: 'GOOD', value: summary.good, color: '#4CAF50' },
            { label: 'OK', value: summary.ok, color: '#FFD600' },
            { label: 'BAD', value: summary.bad, color: '#F44336' },
            { label: 'Avg Score', value: summary.avgScore, color: ACCENT },
          ].map(s => (
            <div key={s.label} style={{ backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '8px', padding: '12px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: TEXT_DIM, textTransform: 'uppercase', marginBottom: '4px' }}>{s.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>
                {typeof s.value === 'number' && s.label === 'Avg Score' ? s.value.toFixed(1) : s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Data Quality */}
      {summary && !loading && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', fontSize: '11px', color: TEXT_DIM }}>
          <span style={{ color: GREEN }}>● Full: {summary.dataQualityBreakdown.full}</span>
          <span style={{ color: YELLOW }}>● Partial: {summary.dataQualityBreakdown.partial}</span>
          <span style={{ color: RED }}>● Price Only: {summary.dataQualityBreakdown.priceOnly}</span>
          <span>Showing {sortedCards.length} of {cards.length}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{ width: '44px', height: '44px', border: `3px solid ${CARD_BORDER}`, borderTop: `3px solid ${ACCENT}`, borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
          <p style={{ color: TEXT_DIM, margin: 0 }}>Scanning quarterly results for {viewMode === 'both' ? 'portfolio + watchlist' : viewMode} stocks...</p>
          <p style={{ color: TEXT_DIM, margin: '8px 0 0', fontSize: '12px' }}>This may take 15-30 seconds (fetching from multiple sources)</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ backgroundColor: `${RED}15`, border: `1px solid ${RED}40`, borderRadius: '8px', padding: '16px', color: RED, marginBottom: '24px' }}>
          <strong>Error:</strong> {error}
          <button onClick={fetchData} style={{ marginLeft: '12px', backgroundColor: RED, border: 'none', color: '#fff', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Retry</button>
        </div>
      )}

      {/* Cards Grid */}
      {!loading && !error && sortedCards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '16px' }}>
          {sortedCards.map(card => <EarningsCardComponent key={card.symbol} card={card} />)}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && sortedCards.length === 0 && (
        <div style={{ backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '8px', padding: '60px 20px', textAlign: 'center', color: TEXT_DIM }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
          <p style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 500 }}>
            {cards.length > 0 ? `${cards.length} cards loaded but none match "${filterGrade}" filter` : viewMode === 'portfolio' ? 'No portfolio holdings found' : 'No watchlist stocks found'}
          </p>
          <p style={{ margin: 0, fontSize: '13px' }}>
            {cards.length > 0 ? 'Try selecting "ALL" grade filter.' : `Add stocks to your ${viewMode === 'portfolio' ? 'portfolio' : 'watchlist'} first.`}
          </p>
        </div>
      )}

      {/* Failed Symbols Warning */}
      {!loading && failedSymbols.length > 0 && (
        <div style={{
          backgroundColor: '#1A1A0D', border: '1px solid #3D3D00', borderRadius: '10px',
          padding: '14px 18px', marginBottom: '16px', display: 'flex', alignItems: 'flex-start', gap: '10px',
        }}>
          <AlertTriangle style={{ width: '16px', height: '16px', color: YELLOW, flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: YELLOW, marginBottom: '4px' }}>
              {failedSymbols.length} ticker{failedSymbols.length > 1 ? 's' : ''} could not be scanned
            </div>
            <div style={{ fontSize: '11px', color: TEXT_DIM, lineHeight: 1.5 }}>
              No earnings data on screener.in for: <span style={{ color: TEXT, fontWeight: 500 }}>{failedSymbols.join(', ')}</span>
              <br/>These may be BSE-only codes, very new listings, or tickers with different screener.in names.
            </div>
          </div>
        </div>
      )}

      {/* Bottom Summary */}
      {!loading && cards.length > 0 && <BottomSummary cards={cards} />}
    </div>
  );
}
