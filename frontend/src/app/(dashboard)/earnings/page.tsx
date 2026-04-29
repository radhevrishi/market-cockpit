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

// Tab cache: avoid refetching on every tab switch
const EARNINGS_CACHE_TTL = 180000; // 3 min
let _earningsCache: { data: any; timestamp: number } | null = null;

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
  grade: 'EXCELLENT' | 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  dataQuality: 'FULL' | 'PARTIAL' | 'PRICE_ONLY';
  mcap: number | null;
  pe: number | null;
  cmp: number | null;
  isBanking: boolean;
  // Guidance & Sentiment
  guidance?: 'Positive' | 'Neutral' | 'Negative';
  sentimentScore?: number;
  revenueOutlook?: 'Up' | 'Flat' | 'Down' | 'Unknown';
  marginOutlook?: 'Expanding' | 'Stable' | 'Contracting' | 'Unknown';
  capexSignal?: 'Expanding' | 'Stable' | 'Reducing' | 'Unknown';
  demandSignal?: 'Strong' | 'Moderate' | 'Weak' | 'Unknown';
  keyPhrasesPositive?: string[];
  keyPhrasesNegative?: string[];
  divergence?: 'StrongEarnings_WeakGuidance' | 'WeakEarnings_StrongGuidance' | 'None';
  // Source attribution
  source?: 'nse' | 'screener.in' | 'trendlyne' | 'moneycontrol' | 'none';
  sourceConfidence?: number;
  dataStatus?: 'FULL' | 'PARTIAL' | 'ESTIMATED' | 'MISSING';
  dataAge?: 'fresh' | 'stale' | 'missing';
  failureReasons?: string[];
  screenerUrl: string;
  nseUrl: string;
  // Extended: which universe the stock belongs to
  universeTag?: 'portfolio' | 'watchlist' | 'both';
}

interface ScanResponse {
  cards: EarningsScanCard[];
  summary: {
    total: number;
    withData?: number;
    missing?: number;
    excellent: number;
    strong: number;
    good: number;
    ok: number;
    bad: number;
    avgScore: number;
    sourceBreakdown?: { nse: number; moneycontrol: number; screener: number; trendlyne: number; none: number };
    avgConfidence?: number;
    guidanceCoverage?: number;
    guidancePositive?: number;
    guidanceNeutral?: number;
    guidanceNegative?: number;
    avgSentiment?: number;
    divergences?: number;
    dataQualityBreakdown: { full: number; partial: number; priceOnly: number };
    dataStatusBreakdown?: { full: number; partial: number; estimated: number; missing: number };
    dataAgeBreakdown?: { fresh: number; stale: number; missing: number };
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

function SourceBadge({ source, confidence }: { source?: string; confidence?: number }) {
  if (!source || source === 'none') return null;
  const colors: Record<string, string> = {
    'nse': '#0F7ABF', 'moneycontrol': '#2E7D32', 'screener.in': '#F57C00', 'trendlyne': '#7B1FA2',
  };
  const labels: Record<string, string> = {
    'nse': 'NSE', 'moneycontrol': 'MC', 'screener.in': 'SCR', 'trendlyne': 'TL',
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px',
      color: colors[source] || TEXT_DIM, backgroundColor: `${colors[source] || TEXT_DIM}15`,
      border: `1px solid ${colors[source] || TEXT_DIM}40`, borderRadius: '3px', padding: '1px 5px',
    }}>
      {labels[source] || source}{confidence ? ` ${confidence}%` : ''}
    </span>
  );
}

function GuidanceBadge({ guidance, score }: { guidance?: string; score?: number }) {
  if (!guidance) return null;
  const cfg: Record<string, { color: string; icon: string }> = {
    'Positive': { color: '#10B981', icon: '▲' },
    'Neutral': { color: '#F59E0B', icon: '●' },
    'Negative': { color: '#EF4444', icon: '▼' },
  };
  const c = cfg[guidance] || cfg['Neutral'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px',
      padding: '2px 7px', borderRadius: '4px',
      backgroundColor: `${c.color}18`, border: `1px solid ${c.color}40`, color: c.color, fontWeight: 600,
    }}>
      {c.icon} {guidance}{score !== undefined ? ` (${score > 0 ? '+' : ''}${score.toFixed(2)})` : ''}
    </span>
  );
}

function DivergenceBadge({ divergence }: { divergence?: string }) {
  if (!divergence || divergence === 'None') return null;
  const isStrongWeak = divergence === 'StrongEarnings_WeakGuidance';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px',
      padding: '2px 6px', borderRadius: '4px',
      backgroundColor: isStrongWeak ? '#EF444418' : '#10B98118',
      border: `1px solid ${isStrongWeak ? '#EF444440' : '#10B98140'}`,
      color: isStrongWeak ? '#EF4444' : '#10B981', fontWeight: 700, letterSpacing: '0.3px',
    }}>
      ⚡ {isStrongWeak ? 'DIVERGENCE: Strong Earnings + Weak Guidance' : 'DIVERGENCE: Weak Earnings + Strong Guidance'}
    </span>
  );
}

function StaleBadge({ quarterStr }: { quarterStr: string }) {
  if (!isDataStale(quarterStr, 6)) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px',
      padding: '2px 6px', borderRadius: '4px',
      backgroundColor: '#EF444415', border: '1px solid #EF444440',
      color: '#EF4444', fontWeight: 700, letterSpacing: '0.3px',
    }}>
      ⚠ STALE
    </span>
  );
}

function OutlookPill({ label, value }: { label: string; value?: string }) {
  if (!value || value === 'Unknown') return null;
  const colorMap: Record<string, string> = {
    'Up': '#10B981', 'Expanding': '#10B981', 'Strong': '#10B981',
    'Flat': '#F59E0B', 'Stable': '#F59E0B', 'Moderate': '#F59E0B',
    'Down': '#EF4444', 'Contracting': '#EF4444', 'Weak': '#EF4444', 'Reducing': '#EF4444',
  };
  const color = colorMap[value] || TEXT_DIM;
  return (
    <span style={{ fontSize: '9px', color, fontWeight: 600 }}>
      {label}: {value}
    </span>
  );
}

function formatMcap(num: number | null): string {
  if (num === null || num === undefined || num <= 0) return '—';
  // num is in Cr
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L Cr`;  // lakh crore
  if (num >= 1000) return `₹${Math.round(num).toLocaleString('en-IN')} Cr`;
  return `₹${num.toFixed(0)} Cr`;
}

function parseQuarterDate(quarterStr: string): Date | null {
  if (!quarterStr || quarterStr === 'N/A' || quarterStr === '-') return null;
  // Parse "Mar 2023" or "December 2024" format
  const parts = quarterStr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const monthStr = parts[0];
  const year = parseInt(parts[parts.length - 1]);
  if (isNaN(year)) return null;

  const months: Record<string, number> = {
    'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5,
    'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11,
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11,
  };

  const month = months[monthStr];
  if (month === undefined) return null;
  return new Date(year, month, 1);
}

function isDataStale(quarterStr: string, maxMonths: number = 6): boolean {
  const quarterDate = parseQuarterDate(quarterStr);
  if (!quarterDate) return true;

  const now = new Date();
  const monthsAgo = (now.getFullYear() - quarterDate.getFullYear()) * 12 + (now.getMonth() - quarterDate.getMonth());
  return monthsAgo > maxMonths;
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
// EARNINGS COMMENTARY — one-line institutional insight
// Generated from financial data: revenue, PAT, EPS, OPM trends.
// Signal: 🟢 POSITIVE / 🟡 MIXED / 🔴 RED FLAG
// ══════════════════════════════════════════════

type CommentarySignal = 'POSITIVE' | 'MIXED' | 'RED_FLAG';

// ══════════════════════════════════════════════
// FORMAT: [TREND] | [QUALITY] | [DRIVER]
//
// TREND  = P&L direction (Beat / Strong / Mixed / Weak / Miss)
// QUALITY = balance sheet + qualitative trust signal (Clean ✓ / Weak CF ⚠️ / Leverage-led ⚠️)
// DRIVER  = root cause or anomaly (Margin expansion / Receivables ↑ / Exceptionals / etc.)
//
// Core question every line answers: "Can I trust this earnings print?"
// ══════════════════════════════════════════════

function generateEarningsCommentary(card: EarningsScanCard): { text: string; signal: CommentarySignal } | null {
  if (card.dataQuality === 'PRICE_ONLY' || card.quarters.length === 0) return null;

  const rev = card.revenueYoY;
  const pat = card.patYoY;
  const eps = card.epsYoY;
  const q0 = card.quarters[0];
  const latestMonth = q0?.period?.split(' ')[0];
  const latestYear = parseInt(q0?.period?.split(' ')[1] || '0');
  const yoyQ = card.quarters.find(q => {
    const m = q.period.split(' ')[0];
    const y = parseInt(q.period.split(' ')[1]);
    return m === latestMonth && y === latestYear - 1;
  });
  const prevQ = card.quarters[1] || null;
  const opmDelta = yoyQ ? q0.opm - yoyQ.opm : 0;
  const hasRev = rev !== null;
  const hasPat = pat !== null;

  // ── Qualitative signals from screener.in Pros/Cons ──
  const posKeys = (card.keyPhrasesPositive || []).map(k => k.toLowerCase());
  const negKeys = (card.keyPhrasesNegative || []).map(k => k.toLowerCase());
  const guidance = card.guidance;
  const marginOutlook = card.marginOutlook;
  const capexSignal = card.capexSignal;
  const demandSignal = card.demandSignal;

  // Detect qualitative flags
  const isDebtFree = posKeys.some(k => k.includes('debt free') || k.includes('zero debt'));
  const hasOrderBook = posKeys.some(k => k.includes('order') || k.includes('book'));
  const hasPromoterBuy = posKeys.some(k => k.includes('promoter') && k.includes('increas'));
  const hasHighDebt = negKeys.some(k => k.includes('debt') || k.includes('leverage') || k.includes('borrowing'));
  const hasWCStress = negKeys.some(k => k.includes('working capital') || k.includes('inventory') || k.includes('receivable') || k.includes('cash flow'));
  const hasLowROE = negKeys.some(k => k.includes('roe') || k.includes('return on equity'));

  // ── Build TREND ──
  let trend: string;
  if (!hasRev || !hasPat) {
    trend = 'Mixed';
  } else if (rev! > 15 && pat! > 20 && opmDelta >= 0) {
    trend = 'Beat';
  } else if (rev! > 10 && pat! > 10) {
    trend = 'Strong';
  } else if (rev! > 0 && pat! > 0) {
    trend = rev! > 5 ? 'Strong' : 'Steady';
  } else if (rev! > 5 && pat! <= 0) {
    trend = 'Mixed';
  } else if (rev! <= 0 && pat! <= 0) {
    trend = rev! < -5 && pat! < -10 ? 'Miss' : 'Weak';
  } else {
    trend = 'Mixed';
  }
  if (q0.pat < 0) trend = 'Miss';

  // ── Build QUALITY ──
  let quality: string;
  let qualityIcon: string;
  if (isDebtFree && !hasWCStress) {
    quality = 'Clean'; qualityIcon = '✓';
  } else if (hasHighDebt && hasWCStress) {
    quality = 'Leverage + WC stress'; qualityIcon = '⚠️';
  } else if (hasHighDebt) {
    quality = 'Leverage-led'; qualityIcon = '⚠️';
  } else if (hasWCStress) {
    quality = 'Weak CF'; qualityIcon = '⚠️';
  } else if (hasLowROE) {
    quality = 'Low ROE'; qualityIcon = '⚠️';
  } else if (isDebtFree) {
    quality = 'Clean'; qualityIcon = '✓';
  } else {
    // Infer from margin + guidance
    if (opmDelta > 2 && (trend === 'Beat' || trend === 'Strong')) {
      quality = 'Clean'; qualityIcon = '✓';
    } else if (opmDelta < -5) {
      quality = 'Margin stress'; qualityIcon = '⚠️';
    } else {
      quality = 'Adequate'; qualityIcon = '–';
    }
  }

  // ── Build DRIVER (the WHY — this is the institutional insight) ──
  let driver: string;

  if (q0.pat < 0) {
    driver = hasHighDebt ? 'Interest burden driving losses' : 'Net loss — profitability broken';
  } else if (hasRev && rev! > 30 && opmDelta < -4) {
    // Hyper-growth with margin crush — scaling/FAI pattern
    if (guidance === 'Positive' || marginOutlook === 'Expanding' || capexSignal === 'Expanding') {
      driver = 'Growth investment phase — margin recovery guided';
      quality = 'Investment phase'; qualityIcon = '→';
    } else if (hasOrderBook) {
      driver = 'Scaling into new segments — order visibility intact';
      quality = 'Investment phase'; qualityIcon = '→';
    } else {
      driver = `Margin collapse ${Math.abs(opmDelta).toFixed(0)}pp — growth not converting`;
    }
  } else if (hasRev && hasPat && rev! > 5 && pat! < -10) {
    driver = hasHighDebt ? 'Finance costs eroding operating gains' :
             hasWCStress ? 'Working capital consuming operating profit' :
             'Cost structure outpacing revenue growth';
  } else if (opmDelta > 3 && hasPat && pat! > 15) {
    driver = 'Margin expansion driving earnings leverage';
  } else if (opmDelta > 1 && isDebtFree) {
    driver = 'Debt-free + margins expanding';
  } else if (opmDelta < -3 && hasPat && pat! > 0) {
    if (guidance === 'Positive' || marginOutlook === 'Expanding') {
      driver = `OPM ↓ ${Math.abs(opmDelta).toFixed(0)}pp — management guides recovery`;
    } else {
      driver = `OPM ↓ ${Math.abs(opmDelta).toFixed(0)}pp — no recovery signal`;
    }
  } else if (hasRev && hasPat && rev! < -5 && pat! < -10) {
    driver = demandSignal === 'Weak' ? 'Demand deterioration' :
             hasHighDebt ? 'Debt + declining demand' :
             guidance === 'Positive' ? 'Cyclical trough — recovery guided' :
             'Broad-based decline';
  } else if (hasRev && hasPat && rev! > 0 && pat! > 0 && pat! < rev! * 0.3) {
    driver = hasWCStress ? 'Revenue growing but cash conversion weak' :
             hasHighDebt ? 'Finance costs capping profit conversion' :
             'Topline growth not flowing to bottom line';
  } else if (isDebtFree && hasOrderBook) {
    driver = 'Debt-free with order visibility';
  } else if (isDebtFree) {
    driver = 'Clean balance sheet';
  } else if (hasOrderBook) {
    driver = 'Order book provides visibility';
  } else if (hasPromoterBuy) {
    driver = 'Promoter increasing stake';
  } else if (guidance === 'Positive' && demandSignal === 'Strong') {
    driver = 'Demand strong, guidance constructive';
  } else if (guidance === 'Negative') {
    driver = 'Forward guidance cautious';
  } else if (negKeys.length > 0) {
    driver = negKeys.slice(0, 2).join(', ');
  } else if (posKeys.length > 0) {
    driver = posKeys.slice(0, 2).join(', ');
  } else {
    driver = trend === 'Beat' || trend === 'Strong' ? 'Steady execution' : 'Limited visibility';
  }

  // ── Compose the 3-block line ──
  const text = `${trend} | ${quality} ${qualityIcon} | ${driver}`;

  // ── Signal from trend + quality ──
  let signal: CommentarySignal;
  if (trend === 'Miss' || (trend === 'Weak' && qualityIcon === '⚠️')) {
    signal = 'RED_FLAG';
  } else if (trend === 'Beat' && qualityIcon !== '⚠️') {
    signal = 'POSITIVE';
  } else if (trend === 'Strong' && qualityIcon !== '⚠️') {
    signal = 'POSITIVE';
  } else if (trend === 'Weak' || trend === 'Miss') {
    signal = 'RED_FLAG';
  } else if (trend === 'Mixed' || qualityIcon === '⚠️' || qualityIcon === '→') {
    signal = 'MIXED';
  } else if (trend === 'Steady') {
    signal = quality === 'Clean' ? 'POSITIVE' : 'MIXED';
  } else {
    signal = 'MIXED';
  }

  return { text, signal };
}

const COMMENTARY_COLORS: Record<CommentarySignal, { bg: string; border: string; text: string; icon: string }> = {
  POSITIVE:  { bg: '#10B98110', border: '#10B98130', text: '#10B981', icon: '✓' },
  MIXED:     { bg: '#F59E0B10', border: '#F59E0B30', text: '#F59E0B', icon: '●' },
  RED_FLAG:  { bg: '#EF444410', border: '#EF444430', text: '#EF4444', icon: '⚠' },
};

// ══════════════════════════════════════════════
// CARD COMPONENT
// ══════════════════════════════════════════════

function EarningsCardComponent({ card }: { card: EarningsScanCard }) {
  const tagColor = card.universeTag === 'portfolio' ? '#10B981' : card.universeTag === 'both' ? '#8B5CF6' : ACCENT;
  const tagLabel = card.universeTag === 'portfolio' ? 'PORTFOLIO' : card.universeTag === 'both' ? 'BOTH' : 'WATCHLIST';

  // Check if data is stale (>6 months old) and cap score at 40 if >4 quarters old
  const staleData = isDataStale(card.period, 6);
  const veryOldData = isDataStale(card.period, 120); // >10 years old
  const displayScore = staleData && veryOldData ? Math.min(40, card.totalScore) : card.totalScore;

  // DATA_MISSING: show a minimal card with failure reasons
  if (card.dataStatus === 'MISSING') {
    return (
      <div style={{
        backgroundColor: CARD, border: `1px solid #F4433650`, borderRadius: '10px',
        overflow: 'hidden', opacity: 0.7,
      }}>
        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: TEXT }}>{card.symbol}</span>
            <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '3px', backgroundColor: '#F4433620', border: '1px solid #F4433650', color: '#F44336', fontWeight: 700 }}>DATA MISSING</span>
            <span style={{ fontSize: '8px', padding: '2px 6px', borderRadius: '3px', backgroundColor: `${tagColor}20`, border: `1px solid ${tagColor}50`, color: tagColor, fontWeight: 700, letterSpacing: '0.5px' }}>{tagLabel}</span>
          </div>
          <div style={{ fontSize: '11px', color: TEXT_DIM, marginBottom: '6px' }}>All data sources failed for this symbol</div>
          {card.failureReasons && card.failureReasons.length > 0 && (
            <div style={{ fontSize: '10px', color: '#F4433690', lineHeight: '1.5' }}>
              {card.failureReasons.slice(0, 3).map((r, i) => <div key={i}>• {r}</div>)}
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <a href={card.nseUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '10px', color: ACCENT, textDecoration: 'none' }}>NSE ↗</a>
            <a href={card.screenerUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '10px', color: ACCENT, textDecoration: 'none' }}>Screener ↗</a>
          </div>
        </div>
      </div>
    );
  }

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
            <GradeBadge grade={card.grade} color={card.gradeColor} score={displayScore} />
            <span style={{
              fontSize: '8px', padding: '2px 6px', borderRadius: '3px',
              backgroundColor: `${tagColor}20`, border: `1px solid ${tagColor}50`,
              color: tagColor, fontWeight: 700, letterSpacing: '0.5px',
            }}>{tagLabel}</span>
            {card.isBanking && (
              <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '3px', backgroundColor: '#FF980020', border: '1px solid #FF980050', color: '#FF9800', fontWeight: 700 }}>BANK</span>
            )}
            <DataQualityDot quality={card.dataQuality} />
            <SourceBadge source={card.source} confidence={card.sourceConfidence} />
            <StaleBadge quarterStr={card.period} />
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

      {/* Earnings Verdict — institutional 3-block: TREND | QUALITY | DRIVER */}
      {(() => {
        const commentary = generateEarningsCommentary(card);
        if (!commentary) return null;
        const colors = COMMENTARY_COLORS[commentary.signal];
        // Split on pipes for individual block styling
        const blocks = commentary.text.split(' | ');
        return (
          <div style={{
            padding: '7px 16px', borderTop: `1px solid ${CARD_BORDER}`,
            backgroundColor: colors.bg, display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <span style={{ fontSize: '12px', flexShrink: 0 }}>{colors.icon}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 600, lineHeight: '1.4' }}>
              {blocks.map((block, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  {i === 0 ? (
                    <span style={{ color: colors.text, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{block}</span>
                  ) : i === 1 ? (
                    <span style={{ color: '#8899AA' }}>{block}</span>
                  ) : (
                    <span style={{ color: colors.text }}>{block}</span>
                  )}
                  {i < blocks.length - 1 && <span style={{ color: '#2A3B4C', margin: '0 2px' }}>|</span>}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Guidance & Sentiment Section */}
      {card.guidance && (
        <div style={{ padding: '8px 16px 10px', borderTop: `1px solid ${CARD_BORDER}`, backgroundColor: `${HEADER_BG}30` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', color: TEXT_DIM, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Guidance</span>
            <GuidanceBadge guidance={card.guidance} score={card.sentimentScore} />
            <DivergenceBadge divergence={card.divergence} />
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <OutlookPill label="Revenue" value={card.revenueOutlook} />
            <OutlookPill label="Margins" value={card.marginOutlook} />
            <OutlookPill label="Capex" value={card.capexSignal} />
            <OutlookPill label="Demand" value={card.demandSignal} />
          </div>
          {((card.keyPhrasesPositive && card.keyPhrasesPositive.length > 0) || (card.keyPhrasesNegative && card.keyPhrasesNegative.length > 0)) && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
              {(card.keyPhrasesPositive || []).map((p, i) => (
                <span key={`p${i}`} style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', backgroundColor: '#10B98115', color: '#10B981', border: '1px solid #10B98130' }}>{p}</span>
              ))}
              {(card.keyPhrasesNegative || []).map((p, i) => (
                <span key={`n${i}`} style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', backgroundColor: '#EF444415', color: '#EF4444', border: '1px solid #EF444430' }}>{p}</span>
              ))}
            </div>
          )}
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
  const [filterGrades, setFilterGrades] = useState<string[]>(['ALL']);
  const [viewMode, setViewMode] = useState<ViewMode>('watchlist');
  // Date range filter — defaults to last 30 days → today
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [guidanceFilter, setGuidanceFilter] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'>('ALL'); // Filter by forward guidance sentiment
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [failedSymbols, setFailedSymbols] = useState<string[]>([]);

  const fetchData = useCallback(async (forceRefresh = false) => {
    // Tab cache check
    if (!forceRefresh && _earningsCache && (Date.now() - _earningsCache.timestamp) < EARNINGS_CACHE_TTL) {
      const c = _earningsCache.data;
      setCards(c.cards || []);
      setFailedSymbols(c.failedSymbols || []);
      setSummary(c.summary);
      setSource(c.source || '');
      setUpdatedAt(c.updatedAt || '');
      setLoading(false);
      return;
    }

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

      // Normalize symbols BEFORE passing to earnings pipeline (BUG-04 fix)
      // Ensures consistent mapping between portfolio store and earnings engine
      const normalizeSymbol = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
      portfolio = portfolio.map(normalizeSymbol).filter(s => s.length > 0);
      watchlist = watchlist.map(normalizeSymbol).filter(s => s.length > 0);

      // Always scan ALL symbols (union) regardless of viewMode — display filters later
      const portfolioSet = new Set(portfolio);
      const watchlistSet = new Set(watchlist);
      const symbols = [...new Set([...portfolio, ...watchlist])];

      console.log(`[Earnings] Scanning ALL symbols: ${symbols.length} (portfolio: ${portfolio.length}, watchlist: ${watchlist.length})`);

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
        // URL-encode symbols to handle & in tickers like M&M, S&SPOWER (BUG-04 fix)
        const encodedSymbols = batch.map(s => encodeURIComponent(s)).join(',');
        const res = await fetch(`/api/market/earnings-scan?symbols=${encodedSymbols}&debug=true`);
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
        //    Bulk API returns marketCap in raw rupees → convert to Cr by dividing by 1,00,00,000
        try {
          const quotesRes = await fetch('/api/market/quotes');
          if (quotesRes.ok) {
            const quotesData = await quotesRes.json();
            (quotesData.stocks || []).forEach((q: any) => {
              const mcapRaw = q.marketCap || 0;
              quoteMap.set(q.ticker, {
                price: q.price || 0,
                mcapCr: mcapRaw > 0 ? Math.round(mcapRaw / 10000000) : null,
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
        const excellent = allCards.filter(c => c.grade === 'EXCELLENT').length;
        const strong = allCards.filter(c => c.grade === 'STRONG').length;
        const good = allCards.filter(c => c.grade === 'GOOD').length;
        const ok = allCards.filter(c => c.grade === 'OK').length;
        const bad = allCards.filter(c => c.grade === 'BAD').length;
        const avgScore = allCards.reduce((s, c) => s + c.totalScore, 0) / allCards.length;
        const full = allCards.filter(c => c.dataQuality === 'FULL').length;
        const partial = allCards.filter(c => c.dataQuality === 'PARTIAL').length;
        const priceOnly = allCards.filter(c => c.dataQuality === 'PRICE_ONLY').length;
        const withGuidance = allCards.filter(c => c.guidance);
        const guidanceCoverage = withGuidance.length;
        const guidancePositive = withGuidance.filter(c => c.guidance === 'Positive').length;
        const guidanceNeutral = withGuidance.filter(c => c.guidance === 'Neutral').length;
        const guidanceNegative = withGuidance.filter(c => c.guidance === 'Negative').length;
        const avgSentiment = guidanceCoverage > 0 ? withGuidance.reduce((s, c) => s + (c.sentimentScore || 0), 0) / guidanceCoverage : 0;
        const divergences = allCards.filter(c => c.divergence && c.divergence !== 'None').length;

        lastSummary = { total: allCards.length, excellent, strong, good, ok, bad, avgScore, guidanceCoverage, guidancePositive, guidanceNeutral, guidanceNegative, avgSentiment, divergences, dataQualityBreakdown: { full, partial, priceOnly } };
      }

      setCards(allCards);
      setFailedSymbols(allFailed);
      setSummary(lastSummary);
      setSource(lastSource);
      setUpdatedAt(lastUpdatedAt);

      // Cache for tab switching
      _earningsCache = {
        data: { cards: allCards, failedSymbols: allFailed, summary: lastSummary, source: lastSource, updatedAt: lastUpdatedAt },
        timestamp: Date.now(),
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load earnings data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Sort and filter
  const sortedCards = useMemo(() => {
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null;

    return [...cards]
      .filter(c => {
        // Filter by viewMode (universe membership)
        if (viewMode === 'portfolio' && c.universeTag !== 'portfolio' && c.universeTag !== 'both') return false;
        if (viewMode === 'watchlist' && c.universeTag !== 'watchlist' && c.universeTag !== 'both') return false;
        // Filter by grade
        if (!filterGrades.includes('ALL') && !filterGrades.includes(c.grade)) return false;
        // ── Reporting Period Filter ──
        // Determines when earnings were REPORTED (not when the quarter ended).
        // - If resultDate is an actual date like "15-Apr-2026", use it directly.
        // - If resultDate is just the quarter period like "Mar 2026", it means
        //   Q4 FY26 ended March 31 — results are typically reported 15-45 days later.
        //   So we use END of that month + 15 days as the estimated report date.
        if (fromDate || toDate) {
          let reportDate: Date | null = null;

          // Try resultDate first (ISO string or full date like "15-Apr-2026 17:30:00")
          if (c.resultDate && c.resultDate !== '-' && c.resultDate !== 'N/A') {
            // Check if it's a real date (not just "Mar 2026")
            const isJustPeriod = /^[A-Za-z]{3,9}\s+\d{4}$/.test(c.resultDate.trim());
            if (!isJustPeriod) {
              // Try parsing as ISO / human date
              const parsed = new Date(c.resultDate.replace(/(\d{2})-([A-Za-z]{3})-(\d{4})/, '$2 $1, $3'));
              if (!isNaN(parsed.getTime())) reportDate = parsed;
            }
          }

          // Fall back to period (e.g. "Mar 2026") with reporting lag estimate
          if (!reportDate && c.period) {
            const quarterEnd = parseQuarterDate(c.period);
            if (quarterEnd) {
              // Shift to end of month + 15 days to estimate actual report date.
              // Q4 ending March → results typically reported mid-April.
              const endOfMonth = new Date(quarterEnd.getFullYear(), quarterEnd.getMonth() + 1, 0);
              reportDate = new Date(endOfMonth.getTime() + 15 * 24 * 60 * 60 * 1000);
            }
          }

          if (reportDate) {
            if (fromDate && reportDate < fromDate) return false;
            if (toDate && reportDate > toDate) return false;
          }
          // If no parseable date at all, keep the card (don't hide data)
        }
        // Guidance sentiment filter
        if (guidanceFilter !== 'ALL') {
          if (guidanceFilter === 'POSITIVE' && (c.sentimentScore || 0) <= 0) return false;
          if (guidanceFilter === 'NEGATIVE' && (c.sentimentScore || 0) >= 0) return false;
          if (guidanceFilter === 'NEUTRAL' && c.guidance !== 'Neutral') return false;
        }
        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'symbol': return a.symbol.localeCompare(b.symbol);
          case 'revenueYoY': return (b.revenueYoY || -999) - (a.revenueYoY || -999);
          case 'patYoY': return (b.patYoY || -999) - (a.patYoY || -999);
          default: return b.totalScore - a.totalScore;
        }
      });
    },
    [cards, filterGrades, sortBy, viewMode, dateFrom, dateTo, guidanceFilter]
  );

  // ── Visible cards: filtered by viewMode + date, but NOT grade ──
  // Used for summary counts so the grade buttons show accurate numbers.
  const visibleCards = useMemo(() => {
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null;

    return cards.filter(c => {
      // Filter by viewMode
      if (viewMode === 'portfolio' && c.universeTag !== 'portfolio' && c.universeTag !== 'both') return false;
      if (viewMode === 'watchlist' && c.universeTag !== 'watchlist' && c.universeTag !== 'both') return false;
      // Date filter (same logic as sortedCards)
      if (fromDate || toDate) {
        let reportDate: Date | null = null;
        if (c.resultDate && c.resultDate !== '-' && c.resultDate !== 'N/A') {
          const isJustPeriod = /^[A-Za-z]{3,9}\s+\d{4}$/.test(c.resultDate.trim());
          if (!isJustPeriod) {
            const parsed = new Date(c.resultDate.replace(/(\d{2})-([A-Za-z]{3})-(\d{4})/, '$2 $1, $3'));
            if (!isNaN(parsed.getTime())) reportDate = parsed;
          }
        }
        if (!reportDate && c.period) {
          const quarterEnd = parseQuarterDate(c.period);
          if (quarterEnd) {
            const endOfMonth = new Date(quarterEnd.getFullYear(), quarterEnd.getMonth() + 1, 0);
            reportDate = new Date(endOfMonth.getTime() + 15 * 24 * 60 * 60 * 1000);
          }
        }
        if (reportDate) {
          if (fromDate && reportDate < fromDate) return false;
          if (toDate && reportDate > toDate) return false;
        }
      }
      // Guidance sentiment filter
      if (guidanceFilter !== 'ALL') {
        if (guidanceFilter === 'POSITIVE' && (c.sentimentScore || 0) <= 0) return false;
        if (guidanceFilter === 'NEGATIVE' && (c.sentimentScore || 0) >= 0) return false;
        if (guidanceFilter === 'NEUTRAL' && c.guidance !== 'Neutral') return false;
      }
      return true;
    });
  }, [cards, viewMode, dateFrom, dateTo, guidanceFilter]);

  // Compute aggregations from visible cards (respects date + viewMode)
  const portfolioAgg = useMemo(() =>
    computeAggregation(visibleCards.filter(c => c.universeTag === 'portfolio' || c.universeTag === 'both'), 'PORTFOLIO SUMMARY'),
    [visibleCards]
  );

  const watchlistAgg = useMemo(() =>
    computeAggregation(visibleCards.filter(c => c.universeTag === 'watchlist' || c.universeTag === 'both'), 'WATCHLIST SUMMARY'),
    [visibleCards]
  );

  // Live grade counts from visible cards (what user will see when clicking each grade)
  const liveSummary = useMemo(() => {
    const vc = visibleCards;
    const withGuidance = vc.filter(c => c.guidance);
    return {
      total: vc.length,
      excellent: vc.filter(c => c.grade === 'EXCELLENT').length,
      strong: vc.filter(c => c.grade === 'STRONG').length,
      good: vc.filter(c => c.grade === 'GOOD').length,
      ok: vc.filter(c => c.grade === 'OK').length,
      bad: vc.filter(c => c.grade === 'BAD').length,
      avgScore: vc.length > 0 ? vc.reduce((s, c) => s + c.totalScore, 0) / vc.length : 0,
      guidanceCoverage: withGuidance.length,
      guidancePositive: withGuidance.filter(c => c.guidance === 'Positive').length,
      guidanceNeutral: withGuidance.filter(c => c.guidance === 'Neutral').length,
      guidanceNegative: withGuidance.filter(c => c.guidance === 'Negative').length,
      avgSentiment: withGuidance.length > 0 ? withGuidance.reduce((s, c) => s + (c.sentimentScore || 0), 0) / withGuidance.length : 0,
      divergences: vc.filter(c => c.divergence && c.divergence !== 'None').length,
      dataQualityBreakdown: {
        full: vc.filter(c => c.dataQuality === 'FULL').length,
        partial: vc.filter(c => c.dataQuality === 'PARTIAL').length,
        priceOnly: vc.filter(c => c.dataQuality === 'PRICE_ONLY').length,
      },
    };
  }, [visibleCards]);

  // Show actual card count (with data) vs total requested symbols
  const portfolioCardCount = visibleCards.filter(c => c.universeTag === 'portfolio' || c.universeTag === 'both').length;
  const watchlistCardCount = visibleCards.filter(c => c.universeTag === 'watchlist' || c.universeTag === 'both').length;
  const bothCardCount = visibleCards.length;

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
          if (grade === 'EXCELLENT') data.cell.styles.textColor = [124, 58, 237];
          else if (grade === 'STRONG') data.cell.styles.textColor = [0, 160, 60];
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
          Custom universe quarterly results · Portfolio + Watchlist only · Source: {source || '...'}
          {updatedAt && (
            <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
              backgroundColor: (() => {
                const mins = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000);
                return mins < 5 ? 'rgba(16,185,129,0.15)' : mins < 30 ? 'rgba(255,214,0,0.15)' : 'rgba(239,68,68,0.15)';
              })(),
              color: (() => {
                const mins = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000);
                return mins < 5 ? '#10B981' : mins < 30 ? '#FFD600' : '#EF4444';
              })(),
            }}>
              {(() => {
                const mins = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000);
                return mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
              })()}
            </span>
          )}
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

        {/* Date Range Filter */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '6px',
          padding: '4px 10px',
        }}>
          <span style={{ fontSize: '10px', color: TEXT_DIM, fontWeight: 600, whiteSpace: 'nowrap' }}>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            style={{
              backgroundColor: 'transparent', border: 'none', color: TEXT,
              fontSize: '12px', cursor: 'pointer', outline: 'none',
              colorScheme: 'dark',
            }}
          />
          <span style={{ fontSize: '10px', color: TEXT_DIM, fontWeight: 600, whiteSpace: 'nowrap' }}>To</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            style={{
              backgroundColor: 'transparent', border: 'none', color: TEXT,
              fontSize: '12px', cursor: 'pointer', outline: 'none',
              colorScheme: 'dark',
            }}
          />
          <button
            onClick={() => {
              const d = new Date(); d.setDate(d.getDate() - 30);
              setDateFrom(d.toISOString().slice(0, 10));
              setDateTo(new Date().toISOString().slice(0, 10));
            }}
            style={{
              background: 'none', border: `1px solid ${CARD_BORDER}`, borderRadius: '4px',
              color: TEXT_DIM, padding: '2px 6px', cursor: 'pointer', fontSize: '10px',
              whiteSpace: 'nowrap',
            }}
            title="Reset to last 30 days"
          >
            30D
          </button>
          <button
            onClick={() => {
              const d = new Date(); d.setDate(d.getDate() - 90);
              setDateFrom(d.toISOString().slice(0, 10));
              setDateTo(new Date().toISOString().slice(0, 10));
            }}
            style={{
              background: 'none', border: `1px solid ${CARD_BORDER}`, borderRadius: '4px',
              color: TEXT_DIM, padding: '2px 6px', cursor: 'pointer', fontSize: '10px',
              whiteSpace: 'nowrap',
            }}
            title="Reset to last 90 days"
          >
            90D
          </button>
          <button
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
            style={{
              background: 'none', border: `1px solid ${CARD_BORDER}`, borderRadius: '4px',
              color: TEXT_DIM, padding: '2px 6px', cursor: 'pointer', fontSize: '10px',
              whiteSpace: 'nowrap',
            }}
            title="Show all dates — no date filter"
          >
            ALL
          </button>
        </div>

        {['ALL', 'EXCELLENT', 'STRONG', 'GOOD', 'OK', 'BAD'].map(g => {
          const isActive = filterGrades.includes(g);
          return (
            <button key={g} onClick={() => {
              if (g === 'ALL') {
                setFilterGrades(['ALL']);
              } else {
                setFilterGrades(prev => {
                  const withoutAll = prev.filter(x => x !== 'ALL');
                  if (withoutAll.includes(g)) {
                    const next = withoutAll.filter(x => x !== g);
                    return next.length === 0 ? ['ALL'] : next;
                  } else {
                    return [...withoutAll, g];
                  }
                });
              }
            }} style={{
              backgroundColor: isActive ? ACCENT : CARD,
              border: `1px solid ${isActive ? ACCENT : CARD_BORDER}`,
              color: isActive ? '#000' : TEXT,
              padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
            }}>{g}</button>
          );
        })}

        {/* Guidance Sentiment Filter */}
        {([
          { key: 'ALL' as const, label: 'All Guidance', icon: '', color: TEXT_DIM },
          { key: 'POSITIVE' as const, label: '▲ Positive', icon: '', color: '#10B981' },
          { key: 'NEUTRAL' as const, label: '● Neutral', icon: '', color: '#F59E0B' },
          { key: 'NEGATIVE' as const, label: '▼ Negative', icon: '', color: '#EF4444' },
        ] as const).map(g => {
          const isActive = guidanceFilter === g.key;
          return (
            <button key={g.key} onClick={() => setGuidanceFilter(g.key)} style={{
              backgroundColor: isActive ? `${g.color}20` : CARD,
              border: `1px solid ${isActive ? g.color : CARD_BORDER}`,
              color: isActive ? g.color : TEXT_DIM,
              padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
            }}>{g.label}</button>
          );
        })}

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
          <button onClick={() => fetchData(true)} disabled={loading} style={{
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

      {/* Grade Summary Bar — uses liveSummary (respects viewMode + date filter) */}
      {!loading && visibleCards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          {[
            { label: 'Total', value: liveSummary.total, color: ACCENT },
            { label: 'EXCELLENT', value: liveSummary.excellent, color: '#7C3AED' },
            { label: 'STRONG', value: liveSummary.strong, color: '#00C853' },
            { label: 'GOOD', value: liveSummary.good, color: '#4CAF50' },
            { label: 'OK', value: liveSummary.ok, color: '#FFD600' },
            { label: 'BAD', value: liveSummary.bad, color: '#F44336' },
            { label: 'Avg Score', value: liveSummary.avgScore, color: ACCENT },
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

      {/* Guidance Sentiment Aggregation — uses liveSummary */}
      {!loading && liveSummary.guidanceCoverage > 0 && (
        <div style={{
          display: 'flex', gap: '16px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap',
          backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '8px', padding: '10px 16px',
        }}>
          <span style={{ fontSize: '10px', color: TEXT_DIM, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Forward Guidance</span>
          <span style={{ fontSize: '12px', color: TEXT_DIM }}>{liveSummary.guidanceCoverage} of {liveSummary.total} covered</span>
          <span style={{ fontSize: '12px', color: '#10B981', fontWeight: 600 }}>▲ Positive: {liveSummary.guidancePositive}</span>
          <span style={{ fontSize: '12px', color: '#F59E0B', fontWeight: 600 }}>● Neutral: {liveSummary.guidanceNeutral}</span>
          <span style={{ fontSize: '12px', color: '#EF4444', fontWeight: 600 }}>▼ Negative: {liveSummary.guidanceNegative}</span>
          <span style={{ fontSize: '12px', color: liveSummary.avgSentiment > 0 ? '#10B981' : liveSummary.avgSentiment < 0 ? '#EF4444' : TEXT_DIM, fontWeight: 700 }}>
            Avg Sentiment: {liveSummary.avgSentiment > 0 ? '+' : ''}{liveSummary.avgSentiment.toFixed(3)}
          </span>
          {liveSummary.divergences > 0 && (
            <span style={{ fontSize: '11px', color: '#F59E0B', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
              ⚡ {liveSummary.divergences} Divergence{liveSummary.divergences > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Data Quality + Completeness Gate */}
      {!loading && visibleCards.length > 0 && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', fontSize: '11px', color: TEXT_DIM, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: GREEN }}>● Full: {liveSummary.dataQualityBreakdown.full}</span>
          <span style={{ color: YELLOW }}>● Partial: {liveSummary.dataQualityBreakdown.partial}</span>
          <span style={{ color: RED }}>● Price Only: {liveSummary.dataQualityBreakdown.priceOnly}</span>
          <span>Showing {sortedCards.length} of {visibleCards.length}{visibleCards.length < cards.length ? ` (${cards.length} total)` : ''}</span>
          {/* Data completeness ratio */}
          {(() => {
            const totalRequested = viewMode === 'portfolio' ? portfolioSymbols.length : viewMode === 'watchlist' ? watchlistSymbols.length : new Set([...portfolioSymbols, ...watchlistSymbols]).size;
            // Count cards that match current viewMode (not grade-filtered sortedCards, not total cards)
            const viewCards = cards.filter(c => {
              if (viewMode === 'portfolio') return c.universeTag === 'portfolio' || c.universeTag === 'both';
              if (viewMode === 'watchlist') return c.universeTag === 'watchlist' || c.universeTag === 'both';
              return true; // 'both' mode
            }).length;
            const ratio = totalRequested > 0 ? (viewCards / totalRequested) * 100 : 0;
            const color = ratio >= 80 ? GREEN : ratio >= 60 ? YELLOW : RED;
            const label = ratio >= 80 ? 'HIGH' : ratio >= 60 ? 'MEDIUM' : 'LOW';
            return (
              <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, backgroundColor: `${color}15`, border: `1px solid ${color}40`, color }}>
                Data Quality: {ratio.toFixed(0)}% ({label}) · {viewCards}/{totalRequested} resolved
              </span>
            );
          })()}
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
          <button onClick={() => fetchData(true)} style={{ marginLeft: '12px', backgroundColor: RED, border: 'none', color: '#fff', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Retry</button>
        </div>
      )}

      {/* Failed Symbols Warning — shown above cards so user sees it first */}
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
            {cards.length > 0 ? `${cards.length} cards loaded but none match "${filterGrades.join(', ')}" filter` : viewMode === 'portfolio' ? 'No portfolio holdings found' : 'No watchlist stocks found'}
          </p>
          <p style={{ margin: 0, fontSize: '13px' }}>
            {cards.length > 0 ? 'Try selecting "ALL" grade filter.' : `Add stocks to your ${viewMode === 'portfolio' ? 'portfolio' : 'watchlist'} first.`}
          </p>
        </div>
      )}

      {/* Bottom Summary */}
      {!loading && cards.length > 0 && <BottomSummary cards={cards} />}
    </div>
  );
}
