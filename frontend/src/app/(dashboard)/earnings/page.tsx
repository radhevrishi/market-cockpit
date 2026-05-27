'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Download, AlertTriangle, Award } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { CHAT_ID, BOT_SECRET } from '@/lib/config';
import { getConvictionTickers } from '@/lib/conviction-beats';
import TickerExportToolbar from '@/components/TickerExportToolbar';
// PATCH 0557 — BUG-AUDIT-2: backend-degraded banner.
import DegradedBanner from '@/components/DegradedBanner';

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


// PATCH 0199 — Persistent localStorage cache (was per-tab in-memory only,
// which meant every fresh browser tab re-scanned 685 stocks from scratch).
// Now: cache survives across browser sessions for 1 hour, auto-invalidates
// on calendar-month change, and renders cards INSTANTLY from disk while a
// background refresh runs in parallel (stale-while-revalidate pattern).
const EARNINGS_CACHE_TTL = 60 * 60 * 1000;  // 1 hour
const _cacheMonth = () => new Date().toISOString().slice(0, 7); // "2026-05"
const LS_CACHE_KEY = 'mc:earnings-scan:v1';

const _earningsCache = {
  get: (): { data: any; timestamp: number; month: string } | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(LS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { return null; }
  },
  set: (v: { data: any; timestamp: number; month: string }) => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify(v)); } catch {}
  },
};

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
  universeTag?: 'portfolio' | 'watchlist' | 'both' | 'screener' | 'conviction';
  // PATCH 0186 — orthogonal flag: ticker is on the Conviction Beats list
  isConviction?: boolean;
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

type ViewMode = 'portfolio' | 'watchlist' | 'both' | 'screener' | 'conviction';

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
  // PATCH 0357 — loosen risk-flag detector. Old condition required BOTH
  // PAT < -10% AND revenue < 0% — too narrow (missed JSWINFRA PAT -167%
  // when rev was still +20%, DIXON PAT -36% when rev was barely positive).
  // New condition fires when any of: PAT YoY < -20% OR revenue YoY < -10%
  // OR an earnings/guidance divergence is flagged on the card.
  const riskCount = withData.filter(c => {
    const patBad = (c.patYoY ?? 0) < -20;
    const revBad = (c.revenueYoY ?? 0) < -10;
    const divergence = !!c.divergence && c.divergence !== 'None';
    return patBad || revBad || divergence;
  }).length;

  const items = [
    { label: 'Total Analyzed', value: `${withData.length}`, color: ACCENT },
    { label: 'Rising Earnings', value: `${risingCount} (${withData.length > 0 ? ((risingCount / withData.length) * 100).toFixed(0) : 0}%)`, color: GREEN },
    { label: 'Margin Expansion', value: `${marginExpCount} (${withData.length > 0 ? ((marginExpCount / withData.length) * 100).toFixed(0) : 0}%)`, color: marginExpCount > withData.length / 2 ? GREEN : YELLOW },
    { label: 'Risk Flags', value: `${riskCount}`, color: riskCount > 0 ? RED : GREEN, sub: 'PAT decline > 20% · revenue decline > 10% · or guidance divergence' },
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
// One-line earnings verdict.
//
// FORMAT:  [Beat/Strong/Mixed/Miss] | [causal driver in plain English]
//
// Rules (institutional analyst voice):
// - Explain the business driver, not the metric relationship
// - Use strong verbs: lifted, squeezed, dragged, capped, stretched, absorbed
// - No numbers in commentary — the table already shows numbers
// - 3-10 words, 14 max
// - No emojis, no bullets, one line only
// ══════════════════════════════════════════════

function generateEarningsCommentary(card: EarningsScanCard): { text: string; forward: string; signal: CommentarySignal } | null {
  if (card.dataQuality === 'PRICE_ONLY' || card.quarters.length === 0) return null;

  const rev = card.revenueYoY;
  const pat = card.patYoY;
  const q0 = card.quarters[0];
  const latestMonth = q0?.period?.split(' ')[0];
  const latestYear = parseInt(q0?.period?.split(' ')[1] || '0');
  const yoyQ = card.quarters.find(q => {
    const m = q.period.split(' ')[0];
    const y = parseInt(q.period.split(' ')[1]);
    return m === latestMonth && y === latestYear - 1;
  });
  const opmDelta = yoyQ ? q0.opm - yoyQ.opm : 0;
  const opmNow = q0.opm;
  const hasRev = rev !== null;
  const hasPat = pat !== null;

  // QoQ margin check (did margins improve sequentially?)
  const prevQ = card.quarters[1] || null;
  const qoqOpmDelta = prevQ ? q0.opm - prevQ.opm : 0;

  // Qualitative flags from screener.in Pros/Cons
  const posKeys = (card.keyPhrasesPositive || []).map(k => k.toLowerCase());
  const negKeys = (card.keyPhrasesNegative || []).map(k => k.toLowerCase());
  const guidance = card.guidance;
  const capexSignal = card.capexSignal;

  const isDebtFree = posKeys.some(k => k.includes('debt free') || k.includes('zero debt'));
  const hasOrderBook = posKeys.some(k => k.includes('order') || k.includes('book'));
  const hasHighDebt = negKeys.some(k => k.includes('debt') || k.includes('leverage') || k.includes('borrowing'));
  const hasWCStress = negKeys.some(k => k.includes('working capital') || k.includes('inventory') || k.includes('receivable') || k.includes('cash flow'));

  // Revenue-PAT divergence ratio: how much of revenue growth reached profit
  const profitConversion = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;

  // ── CLASSIFY ──
  let label: 'Beat' | 'Strong' | 'Mixed' | 'Miss';
  if (q0.pat < 0) {
    label = 'Miss';
  } else if (!hasRev || !hasPat) {
    label = 'Mixed';
  } else if (rev! <= -5 && pat! <= -10) {
    label = 'Miss';
  } else if (rev! <= 0 && pat! <= 0) {
    label = 'Miss';
  } else if (rev! > 5 && pat! <= 0) {
    label = 'Mixed';
  } else if (rev! > 15 && profitConversion < 0.25 && opmDelta < -3) {
    // Revenue surging but profit barely moved + margins crushed = Mixed
    label = 'Mixed';
  } else if (rev! > 10 && profitConversion < 0.3 && opmDelta < -2) {
    // Good revenue but weak profit conversion with margin pressure
    label = 'Mixed';
  } else if (hasWCStress && opmDelta < -3) {
    // Working capital stress + margin compression = quality concern overrides P&L
    label = 'Mixed';
  } else if (rev! > 12 && pat! > 18 && opmDelta >= -1) {
    label = 'Beat';
  } else if (rev! > 8 && pat! > 10) {
    label = pat! > rev! ? 'Beat' : 'Strong';
  } else if (rev! > 0 && pat! > 0) {
    label = 'Strong';
  } else {
    label = 'Mixed';
  }

  // ── IDENTIFY PRIMARY DRIVER ──
  let driver: string;

  // --- MISS patterns ---
  if (label === 'Miss') {
    if (q0.pat < 0 && hasHighDebt) {
      driver = 'Interest burden pushed earnings into loss';
    } else if (q0.pat < 0) {
      driver = 'Operating losses; cost base exceeds revenue';
    } else if (hasRev && rev! > 5 && hasPat && pat! < -10) {
      // Revenue up but profit down
      if (hasHighDebt) {
        driver = 'Finance costs eroded operating gains';
      } else if (opmDelta < -4) {
        driver = 'Scaling costs squeezed margins despite growth';
      } else {
        driver = 'Rising costs absorbed revenue growth';
      }
    } else if (hasRev && rev! < -5 && hasHighDebt) {
      driver = 'Demand weakness compounded by debt burden';
    } else if (hasRev && rev! < -5 && hasWCStress) {
      driver = 'Demand weakness compounded by working capital strain';
    } else if (hasRev && rev! < -5) {
      driver = 'Revenue decline and weaker demand dragged profits';
    } else {
      driver = 'Revenue and profit both declined';
    }

  // --- MIXED patterns ---
  } else if (label === 'Mixed') {
    if (hasRev && rev! > 30 && opmDelta < -4) {
      // Hyper-growth + margin crush
      if (capexSignal === 'Expanding' || hasOrderBook) {
        driver = 'Capacity ramp-up costs absorbed the revenue surge';
      } else {
        driver = 'Scaling costs absorbed most of the revenue surge';
      }
    } else if (hasRev && rev! > 10 && opmDelta < -3) {
      driver = 'Employee and project costs squeezed margins';
    } else if (hasRev && rev! > 5 && hasPat && pat! <= 0) {
      if (hasHighDebt) {
        driver = 'Finance costs capped profit despite revenue growth';
      } else {
        driver = 'Rising costs offset revenue growth entirely';
      }
    } else if (hasWCStress && hasRev && rev! > 0) {
      driver = 'Growth stretched working capital and weakened cash quality';
    } else if (hasRev && hasPat && profitConversion < 0.3 && rev! > 10) {
      if (opmDelta < -2) {
        driver = 'Input cost inflation squeezed operating margins';
      } else {
        driver = 'Weaker operating leverage capped profit growth';
      }
    } else if (hasRev && Math.abs(rev!) < 5 && hasPat && Math.abs(pat!) < 8) {
      if (guidance === 'Negative') {
        driver = 'Flat quarter with cautious forward outlook';
      } else {
        driver = 'No clear earnings inflection this quarter';
      }
    } else {
      driver = 'Earnings lacked clear direction this quarter';
    }

  // --- BEAT / STRONG patterns (merged — each card gets a unique driver) ---
  } else {
    // Identify the DOMINANT driver from the actual numbers
    const patRevRatio = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;
    const marginExpanded = opmDelta > 2;
    const marginHeld = opmDelta >= -1;
    const marginSoftened = opmDelta < -1 && opmDelta >= -4;
    const marginCrushed = opmDelta < -4;

    if (marginExpanded && patRevRatio > 1.3) {
      // PAT grew much faster than revenue + margins expanded = operating leverage
      driver = 'Margin expansion and operating leverage lifted profits';
    } else if (marginExpanded && isDebtFree) {
      driver = 'Margins expanded on a debt-free base';
    } else if (marginExpanded) {
      driver = 'Cost discipline and mix improvement drove margin expansion';
    } else if (patRevRatio > 2 && marginHeld) {
      // PAT grew 2x revenue = strong leverage even without big margin move
      driver = 'Operating leverage amplified profit growth';
    } else if (marginCrushed && hasRev && rev! > 30) {
      driver = 'Scaling costs diluted margins during rapid growth phase';
    } else if (marginCrushed) {
      driver = 'Input cost inflation squeezed margins despite growth';
    } else if (marginSoftened && hasPat && pat! > 20) {
      driver = 'Volume growth drove profits despite softer margins';
    } else if (marginSoftened) {
      driver = 'Revenue growth partly offset by margin dilution';
    } else if (hasWCStress && hasPat && pat! > 10) {
      driver = 'Earnings grew but working capital absorbed cash';
    } else if (hasHighDebt && hasPat && pat! > 15) {
      driver = 'Earnings grew but financial leverage remains elevated';
    } else if (isDebtFree && hasPat && pat! > 20) {
      driver = 'Strong profit growth on a clean balance sheet';
    } else if (hasOrderBook) {
      driver = 'Order book execution supported earnings growth';
    } else if (hasRev && rev! > 20 && marginHeld) {
      driver = 'Strong revenue growth with margins intact';
    } else if (hasPat && pat! > 30) {
      driver = 'Profit surge driven by volume and cost control';
    } else if (hasRev && rev! > 10) {
      driver = 'Revenue momentum supported earnings this quarter';
    } else {
      driver = 'Incremental growth across revenue and profits';
    }
  }

  // ── LINE 2: FORWARD OUTLOOK (operating leverage, capex, inflection) ──
  const g = card.guidance;
  const cap = card.capexSignal;
  const dem = card.demandSignal;
  const mar = card.marginOutlook;

  // ── LINE 2: QUALITY & INFLECTION — pattern detection from financials ──
  // Detects: divergences, cash quality flags, operating leverage shifts,
  // margin inflection, inorganic distortion, one-off items. Every statement
  // must be backed by data in the card — no filler.

  // ── LINE 2: QUALITY & INFLECTION — always generate, never blank ──
  const fwdRevQoQ = card.revenueQoQ;
  const fwdQoqOpmUp = prevQ ? q0.opm > prevQ.opm : false;
  const fwdQoqOpmDelta = prevQ ? q0.opm - prevQ.opm : 0;
  const patRevRatio2 = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;

  let forward = '';
  const insights: string[] = [];

  // ── RED FLAGS ──
  if (q0.pat < 0 && hasRev && rev! > 0)
    insights.push('losses despite revenue growth — cost base unsustainable');
  if (hasPat && pat! > 10 && opmDelta < -3 && fwdQoqOpmDelta < -1)
    insights.push('profit growth masks deteriorating margin trend');
  if (hasRev && rev! > 15 && hasPat && pat! < 3 && pat! > -10)
    insights.push('revenue surge not reaching bottom line');
  if (hasWCStress)
    insights.push('working capital stretched — watch cash conversion');
  if (hasHighDebt && hasPat && pat! > 0 && patRevRatio2 < 0.5)
    insights.push('finance costs capping profit conversion');

  // ── OPERATING LEVERAGE / DELEVERAGE ──
  if (hasPat && hasRev && pat! > rev! * 1.3 && opmDelta > 0)
    insights.push('operating leverage visible — profit outpacing revenue');
  else if (hasPat && hasRev && rev! > 8 && pat! < rev! * 0.3 && pat! > 0 && insights.length === 0)
    insights.push('operating deleverage — profit lagging revenue growth');

  // ── MARGIN TRAJECTORY ──
  if (opmDelta > 3)
    insights.push(`OPM expanded ${opmDelta.toFixed(0)}pp YoY`);
  else if (opmDelta < -3 && fwdQoqOpmUp && fwdQoqOpmDelta > 0.5)
    insights.push('margin inflection — QoQ recovery despite YoY decline');
  else if (opmDelta < -3)
    insights.push(`OPM contracted ${Math.abs(opmDelta).toFixed(0)}pp YoY`);

  // ── MOMENTUM ──
  if (fwdRevQoQ !== null && fwdRevQoQ > 15)
    insights.push('sequential revenue momentum strong');
  else if (fwdRevQoQ !== null && fwdRevQoQ < -10)
    insights.push('sequential revenue declined — watch for demand softness');

  // ── CAPEX / QUALITATIVE (screener data) ──
  if (cap === 'Expanding')
    insights.push('capex expanding — capacity addition underway');
  else if (cap === 'Reducing')
    insights.push('capex reducing');
  if (dem === 'Strong')
    insights.push('demand signals strong');
  else if (dem === 'Weak')
    insights.push('demand weakening');

  // ── BALANCE SHEET SIGNAL ──
  if (isDebtFree && insights.every(i => !i.includes('debt') && !i.includes('leverage')))
    insights.push('debt-free balance sheet');

  // ── SCREENER PROS/CONS as additive context ──
  if (posKeys.length > 0 && negKeys.length > 0) {
    insights.push(`${posKeys.slice(0, 2).join(', ')}; but ${negKeys.slice(0, 2).join(', ')}`);
  } else if (negKeys.length > 0 && insights.length < 2) {
    insights.push(negKeys.slice(0, 2).join(', '));
  } else if (posKeys.length > 0 && insights.length < 2) {
    insights.push(posKeys.slice(0, 2).join(', '));
  }

  // Always produce line 2 — pick best 2 insights, capitalize
  if (insights.length > 0) {
    // Deduplicate similar insights
    const unique = insights.filter((v, i, a) => a.findIndex(x => x.slice(0, 15) === v.slice(0, 15)) === i);
    const combined = unique.slice(0, 2).join('. ');
    forward = combined.charAt(0).toUpperCase() + combined.slice(1);
  }

  const text = `${label} | ${driver}`;
  const signal: CommentarySignal = label === 'Beat' || label === 'Strong' ? 'POSITIVE' : label === 'Miss' ? 'RED_FLAG' : 'MIXED';

  return { text, forward, signal };
}

const COMMENTARY_COLORS: Record<CommentarySignal, { bg: string; border: string; text: string }> = {
  POSITIVE:  { bg: '#10B98110', border: '#10B98130', text: '#10B981' },
  MIXED:     { bg: '#F59E0B10', border: '#F59E0B30', text: '#F59E0B' },
  RED_FLAG:  { bg: '#EF444410', border: '#EF444430', text: '#EF4444' },
};

// ══════════════════════════════════════════════
// CARD COMPONENT
// ══════════════════════════════════════════════

function EarningsCardComponent({ card, postGap }: { card: EarningsScanCard; postGap?: { gap_pct: number | null; close_move_pct: number | null; live_move_pct: number | null; is_live: boolean; target_date: string | null; filing_date?: string; filing_date_source?: 'explicit' | 'kv-calendar' | 'detected' } }) {
  const tagColor = card.universeTag === 'portfolio' ? '#10B981' : card.universeTag === 'both' ? '#8B5CF6' : card.universeTag === 'screener' ? '#F59E0B' : ACCENT;
  const tagLabel = card.universeTag === 'portfolio' ? 'PORTFOLIO' : card.universeTag === 'both' ? 'BOTH' : card.universeTag === 'screener' ? 'SCREENER' : 'WATCHLIST';

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
          {/* PATCH 0201 — Post-earnings price gap (next-trading-day vs filing-day close) */}
          {postGap && postGap.live_move_pct != null && (
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <div style={{ fontSize: 9, color: TEXT_DIM, fontWeight: 700, letterSpacing: '0.4px' }}>
                POST-EARNINGS {postGap.is_live ? '(LIVE)' : '(CLOSE)'}
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 4,
                backgroundColor: (postGap.live_move_pct >= 0 ? GREEN : RED) + '20',
                border: `1px solid ${(postGap.live_move_pct >= 0 ? GREEN : RED)}50`,
              }}>
                <span style={{
                  fontSize: 13, fontWeight: 900,
                  color: postGap.live_move_pct >= 0 ? GREEN : RED,
                  fontFamily: 'ui-monospace, monospace',
                }}>
                  {postGap.live_move_pct >= 0 ? '▲' : '▼'} {Math.abs(postGap.live_move_pct).toFixed(1)}%
                </span>
              </div>
              {/* Overnight gap (target-day open vs filing-day close).
                  Hidden when same as live cumulative (no extra info). */}
              {postGap.gap_pct != null && postGap.gap_pct !== postGap.live_move_pct && (
                <div style={{ fontSize: 9, color: TEXT_DIM, fontFamily: 'ui-monospace, monospace' }}>
                  gap {postGap.gap_pct >= 0 ? '+' : ''}{postGap.gap_pct.toFixed(1)}%
                </div>
              )}
              {/* PATCH 0204 — Day 1 close (T+1 reaction): close of first
                  trading day after filing vs filing-day close. The market's
                  first full verdict on the print — the metric institutional
                  desks quote most. Hidden when target day is still trading
                  (is_live=true) or when it equals the live cumulative. */}
              {!postGap.is_live && postGap.close_move_pct != null && postGap.close_move_pct !== postGap.live_move_pct && (
                <div style={{
                  fontSize: 9, fontFamily: 'ui-monospace, monospace',
                  color: postGap.close_move_pct >= 0 ? GREEN : RED,
                  fontWeight: 600,
                }}>
                  1d close {postGap.close_move_pct >= 0 ? '+' : ''}{postGap.close_move_pct.toFixed(1)}%
                </div>
              )}
              {/* PATCH 0205/0206 — Filing-date provenance. Anchor visibility
                  + confidence at a glance:
                    ✓  = kv-calendar (authoritative, NSE+BSE corp filing)
                    ~  = detected (price-action inference, Tier 3 fallback)
                       = explicit (caller-supplied, legacy path) */}
              {postGap.filing_date && (
                <div
                  title={
                    postGap.filing_date_source === 'kv-calendar' ? 'Filing date from NSE+BSE corp announcements (authoritative)'
                    : postGap.filing_date_source === 'detected'  ? 'Filing date inferred from price-action signature (Tier 3 fallback)'
                    : 'Filing date supplied directly'
                  }
                  style={{ fontSize: 8, color: TEXT_DIM, fontFamily: 'ui-monospace, monospace', opacity: 0.75 }}
                >
                  {postGap.filing_date_source === 'kv-calendar' ? '✓ ' :
                   postGap.filing_date_source === 'detected'    ? '~ ' : ''}
                  filed {postGap.filing_date.slice(5)}
                </div>
              )}
            </div>
          )}
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

      {/* Earnings Verdict — Line 1: [Label] | [Driver], Line 2: Forward Outlook */}
      {(() => {
        const commentary = generateEarningsCommentary(card);
        if (!commentary) return null;
        const colors = COMMENTARY_COLORS[commentary.signal];
        const pipeIdx = commentary.text.indexOf(' | ');
        const label = pipeIdx > 0 ? commentary.text.slice(0, pipeIdx) : commentary.text;
        const driver = pipeIdx > 0 ? commentary.text.slice(pipeIdx + 3) : '';
        return (
          <div style={{
            padding: '7px 16px', borderTop: `1px solid ${CARD_BORDER}`,
            backgroundColor: colors.bg,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
              <span style={{
                fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                color: colors.text, flexShrink: 0,
                padding: '2px 7px', borderRadius: '4px',
                backgroundColor: `${colors.text}18`, border: `1px solid ${colors.text}30`,
              }}>{label}</span>
              <span style={{ fontSize: '11px', color: '#C0CCD8', fontWeight: 500, lineHeight: '1.4' }}>
                {driver}
              </span>
            </div>
            {commentary.forward && (
              <div style={{ fontSize: '10px', color: TEXT_DIM, lineHeight: '1.4', fontStyle: 'italic', paddingLeft: '2px' }}>
                {commentary.forward}
              </div>
            )}
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
  // PATCH 0357 — broadened risk-flag detector (matches the system-summary
  // detector above): fires on PAT < -20% OR rev < -10% OR divergence.
  const riskCount = withData.filter(c => {
    const patBad = (c.patYoY ?? 0) < -20;
    const revBad = (c.revenueYoY ?? 0) < -10;
    const divergence = !!c.divergence && c.divergence !== 'None';
    return patBad || revBad || divergence;
  }).length;

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
  // PATCH 0199 — Hydrate from localStorage IMMEDIATELY on mount.
  // If we have a fresh cached payload, render it instantly (no loading screen)
  // while the background refresh runs in parallel.
  const _initial = (() => {
    if (typeof window === 'undefined') return null;
    const cached = _earningsCache.get();
    if (!cached) return null;
    if (cached.month !== _cacheMonth()) return null;  // month changed → stale
    if (Date.now() - cached.timestamp > EARNINGS_CACHE_TTL) return null;
    return cached;
  })();
  const [cards, setCards] = useState<EarningsScanCard[]>(_initial?.data?.cards || []);
  // Don't show loading screen if we have cached data to render immediately
  const [loading, setLoading] = useState(!_initial);
  const [error, setError] = useState('');
  // PATCH 0693 — last-scan timestamp so the error/empty states can show
  // "Last scan: 14:32 IST" instead of a context-free spinner trace.
  const [lastScanAt, setLastScanAt] = useState<number | null>(_initial ? Date.now() : null);
  const [summary, setSummary] = useState<ScanResponse['summary'] | null>(_initial?.data?.summary || null);
  const [source, setSource] = useState<string>(_initial?.data?.source || '');
  const [updatedAt, setUpdatedAt] = useState<string>(_initial?.data?.updatedAt || '');
  const [sortBy, setSortBy] = useState<'score' | 'symbol' | 'revenueYoY' | 'patYoY'>('score');
  const [filterGrades, setFilterGrades] = useState<string[]>(['ALL']);
  // PATCH 0186 — Conviction Beats filter (composable with all other filters).
  // When ON, only cards whose ticker is in localStorage conviction list are shown.
  // Works AND-style with viewMode, filterGrades, dateRange, guidanceFilter.
  const [convictionOnly, setConvictionOnly] = useState<boolean>(false);
  const [convictionTickersState, setConvictionTickersState] = useState<Set<string>>(() => getConvictionTickers());
  // PATCH 0352 — speed fix: lazy-load conviction beats. Initial scan only
  // does portfolio + watchlist; conviction tickers (up to 95+) only get
  // fetched when the user first opts into the Conviction universe filter.
  const [convictionScanned, setConvictionScanned] = useState<boolean>(false);
  const [convictionLoading, setConvictionLoading] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => setConvictionTickersState(getConvictionTickers());
    window.addEventListener('conviction-beats:updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('conviction-beats:updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const [viewMode, setViewMode] = useState<ViewMode>('watchlist');
  // PATCH 0198 — Multi-select universe sources. Lets user combine ANY of
  // Portfolio + Watchlist + Conviction Beats + Screener. A card is included
  // when it belongs to ANY of the selected universes (OR/union semantics).
  // Default: just Watchlist (preserves prior single-select behaviour).
  type UniverseSource = 'portfolio' | 'watchlist' | 'conviction' | 'screener';
  const [selectedUniverses, setSelectedUniverses] = useState<Set<UniverseSource>>(() => new Set(['watchlist']));
  const toggleUniverse = (u: UniverseSource) => {
    setSelectedUniverses((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      // Never leave the set empty — fall back to watchlist
      if (next.size === 0) next.add('watchlist');
      return next;
    });
  };
  // Helper: does this card match ANY selected universe (OR-union)?
  const matchesSelectedUniverses = (c: { symbol: string; universeTag?: string }): boolean => {
    if (selectedUniverses.has('screener')) {
      // Screener is a separate dataset; if selected, all screener cards pass.
      // For non-screener cards, fall through to other checks.
      if (c.universeTag === 'screener') return true;
    }
    if (selectedUniverses.has('portfolio') && (c.universeTag === 'portfolio' || c.universeTag === 'both')) return true;
    if (selectedUniverses.has('watchlist') && (c.universeTag === 'watchlist' || c.universeTag === 'both')) return true;
    if (selectedUniverses.has('conviction') && convictionTickersState.has(c.symbol)) return true;
    return false;
  };
  // Date range filter.
  // PATCH 0446 BUG-039 v2 — Default window was 7 days (Patch 0355). Audit
  // reported '86 cards loaded but ALL filter shows 0' because every loaded
  // card had a resultDate older than 7 days. The date filter was silently
  // eliminating the entire set. Default extended to 60 days so the most
  // recent quarter's prints always render on first paint.
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 60);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [guidanceFilter, setGuidanceFilter] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'>('ALL'); // Filter by forward guidance sentiment
  // PATCH 0207 — Day-1 close threshold filter. Multi-select with OR semantics.
  // Empty set = no filter (show all cards regardless of close_move_pct).
  const [dayOneFilters, setDayOneFilters] = useState<Set<DayOneFilter>>(new Set());
  const toggleDayOneFilter = (k: DayOneFilter) => {
    setDayOneFilters(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [failedSymbols, setFailedSymbols] = useState<string[]>([]);
  // Screener tab: separate universe — loaded on demand, never mixed into portfolio/watchlist
  const [screenerCards, setScreenerCards] = useState<EarningsScanCard[]>([]);
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerLoaded, setScreenerLoaded] = useState(false);
  const [screenerSymbolCount, setScreenerSymbolCount] = useState(0);

  const fetchData = useCallback(async (forceRefresh = false) => {
    // Tab cache check — per-tab (no cross-tab race) + month-keyed invalidation
    const currentMonth = _cacheMonth();
    const _cached = _earningsCache.get();
    if (!forceRefresh && _cached &&
        _cached.month === currentMonth &&
        (Date.now() - _cached.timestamp) < EARNINGS_CACHE_TTL) {
      const c = _cached.data;
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
    // PATCH 0434 BUG-003 — Hard 45s wall-clock timeout. Previously if the
    // earnings-scan endpoint hung, loading sat forever with no fallback.
    const fetchTimeoutId = setTimeout(() => {
      setError('Earnings scan timed out after 45s. Try Refresh, or check System Status for backend health.');
      setLoading(false);
    }, 45000);
    try {
      // PATCH 0352 — parallelize portfolio + watchlist fetch (was serial).
      // Saves 300-800ms on initial load.
      const [pData, wData] = await Promise.all([
        fetch(`/api/portfolio?chatId=${CHAT_ID}`)
          .then(r => r.ok ? r.json() : null)
          .catch(e => { console.error('Portfolio fetch failed:', e); return null; }),
        fetch(`/api/watchlist?chatId=${CHAT_ID}`)
          .then(r => r.ok ? r.json() : null)
          .catch(e => { console.error('Watchlist fetch failed:', e); return null; }),
      ]);
      let portfolio: string[] = pData ? (pData.holdings || []).map((h: any) => h.symbol) : [];
      let watchlist: string[] = wData ? (wData.watchlist || []) : [];
      // Fallback to localStorage if watchlist API failed
      if (!wData) {
        try {
          const stored = localStorage.getItem('mc_watchlist_tickers');
          if (stored) watchlist = JSON.parse(stored);
        } catch {}
      }

      setPortfolioSymbols(portfolio);
      setWatchlistSymbols(watchlist);

      // Normalize symbols BEFORE passing to earnings pipeline (BUG-04 fix)
      const normalizeSymbol = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
      portfolio = portfolio.map(normalizeSymbol).filter(s => s.length > 0);
      watchlist = watchlist.map(normalizeSymbol).filter(s => s.length > 0);

      // PATCH 0352 — SPEED FIX: Conviction Beats are now LAZY-loaded.
      // Previously (Patch 0186) we scanned portfolio + watchlist + ALL 95+
      // conviction tickers on EVERY initial load — ballooning the universe
      // from ~30-50 to ~140 and tripling wall-time.
      //
      // New behaviour: initial scan = portfolio + watchlist only. When the
      // user toggles the Conviction universe ON for the first time, a
      // separate effect lazy-fetches conviction tickers and merges them in.
      // See `useEffect` watching `selectedUniverses.has('conviction')`
      // below the fetchData definition.
      const convictionSet = getConvictionTickers();

      const portfolioSet = new Set(portfolio);
      const watchlistSet = new Set(watchlist);
      // Initial union: portfolio + watchlist (no conviction).
      const symbols = [...new Set([...portfolio, ...watchlist])];

      console.log(`[Earnings] Initial scan: ${symbols.length} symbols (portfolio: ${portfolio.length}, watchlist: ${watchlist.length}). Conviction ${convictionSet.size} lazy-loaded on first toggle.`);

      if (symbols.length === 0) {
        setCards([]);
        setSummary(null);
        setLoading(false);
        return;
      }

      // Batch symbols into groups of 30, run up to 3 batches in parallel
      const BATCH_SIZE = 30;
      const PARALLEL = 3;
      let allCards: EarningsScanCard[] = [];
      let allFailed: string[] = [];
      let lastSummary: any = null;
      let lastSource = 'unknown';
      let lastUpdatedAt = new Date().toISOString();

      const batches: string[][] = [];
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        batches.push(symbols.slice(i, i + BATCH_SIZE));
      }

      // Process in waves of PARALLEL concurrent batches
      for (let w = 0; w < batches.length; w += PARALLEL) {
        const wave = batches.slice(w, w + PARALLEL);
        const results = await Promise.allSettled(
          wave.map(async (batch) => {
            const encoded = batch.map(s => encodeURIComponent(s)).join(',');
            // PATCH 0467 — 25s per-batch timeout. Without this, one stuck
            // batch would prevent the wave from settling and the user sees
            // the spinner forever.
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 25_000);
            try {
              const res = await fetch(`/api/market/earnings-scan?symbols=${encoded}&debug=true`, { signal: ctl.signal });
              if (!res.ok) return null;
              return res.json() as Promise<ScanResponse>;
            } finally { clearTimeout(timer); }
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            const data = r.value;
            allCards = [...allCards, ...(data.cards || [])];
            if (data.failed) allFailed = [...allFailed, ...data.failed];
            if (data.summary) lastSummary = data.summary;
            if (data.source) lastSource = data.source;
            if (data.updatedAt) lastUpdatedAt = data.updatedAt;
          }
        }
      }

      // Tag each card with universe membership (legacy universeTag for
      // portfolio/watchlist/both/conviction-only) PLUS a separate
      // isConviction flag so multi-membership doesn't lose data.
      allCards = allCards.map(c => {
        const inP = portfolioSet.has(c.symbol);
        const inW = watchlistSet.has(c.symbol);
        const inC = convictionSet.has(c.symbol);
        return {
          ...c,
          universeTag: (inP && inW) ? 'both' : inP ? 'portfolio' : inW ? 'watchlist' : inC ? 'conviction' : 'watchlist',
          isConviction: inC,
        };
      });

      // Enrich cards with live CMP/MCap data from quotes APIs
      try {
        const cardSymbols = allCards.map(c => c.symbol);
        // quoteMap stores: price, mcapCr (market cap in Crores)
        const quoteMap = new Map<string, { price: number; mcapCr: number | null }>();

        // 1) Try bulk quotes (fast, covers index stocks)
        //    Bulk API returns marketCap in raw rupees → convert to Cr by dividing by 1,00,00,000
        try {
          // PATCH 0467 — bounded bulk quotes fetch
          const bqCtl = new AbortController();
          const bqTimer = setTimeout(() => bqCtl.abort(), 12_000);
          let quotesRes: Response;
          try {
            quotesRes = await fetch('/api/market/quotes', { signal: bqCtl.signal });
          } finally { clearTimeout(bqTimer); }
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
            // PATCH 0716 — added 10s timeout + safe JSON parse + array shape guard.
            try {
              const _iqCtl = new AbortController();
              const _iqTimer = setTimeout(() => _iqCtl.abort(), 10_000);
              try {
                const iqRes = await fetch(`/api/market/quote?symbols=${batch.join(',')}`, { signal: _iqCtl.signal });
                clearTimeout(_iqTimer);
                if (iqRes.ok) {
                  let iqData: any = {};
                  try { iqData = await iqRes.json(); } catch { iqData = {}; }
                  const quotesArr = Array.isArray(iqData?.quotes) ? iqData.quotes : [];
                  quotesArr.forEach((q: any) => {
                    if (q && typeof q.ticker === 'string') {
                      quoteMap.set(q.ticker, { price: q?.price || 0, mcapCr: q?.marketCap || null });
                    }
                  });
                }
              } finally { clearTimeout(_iqTimer); }
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

      // Cache for tab switching — per-tab + month-keyed
      _earningsCache.set({
        data: { cards: allCards, failedSymbols: allFailed, summary: lastSummary, source: lastSource, updatedAt: lastUpdatedAt },
        timestamp: Date.now(),
        month: currentMonth,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load earnings data');
    } finally {
      clearTimeout(fetchTimeoutId);
      setLoading(false);
      setLastScanAt(Date.now()); // PATCH 0693
    }
  }, []);

  // ── Screener earnings: fetch ALL NSE stocks, then scan earnings in batches ──
  const fetchScreenerEarnings = useCallback(async () => {
    if (screenerLoaded) return; // Already loaded — don't refetch
    setScreenerLoading(true);
    try {
      // Step 1: Get all NSE stock tickers from the quotes API
      // PATCH 0716 — 15s timeout + safe JSON parse + array guard.
      const _qCtl = new AbortController();
      const _qTimer = setTimeout(() => _qCtl.abort(), 15_000);
      let quotesData: any = {};
      try {
        const quotesRes = await fetch('/api/market/quotes?market=india', { signal: _qCtl.signal });
        clearTimeout(_qTimer);
        if (!quotesRes.ok) throw new Error(`Failed to fetch stock list (HTTP ${quotesRes.status})`);
        try { quotesData = await quotesRes.json(); } catch { throw new Error('Stock list returned malformed JSON'); }
      } finally { clearTimeout(_qTimer); }
      const allStocks: string[] = (Array.isArray(quotesData?.stocks) ? quotesData.stocks : [])
        .map((s: any) => s?.ticker)
        .filter((t: any): t is string => typeof t === 'string' && t.length > 0);

      // Exclude portfolio + watchlist symbols (they're already in the main cards)
      const pfSet = new Set(portfolioSymbols);
      const wlSet = new Set(watchlistSymbols);
      const screenerOnly = allStocks.filter(s => !pfSet.has(s) && !wlSet.has(s));
      setScreenerSymbolCount(screenerOnly.length);

      if (screenerOnly.length === 0) {
        setScreenerCards([]);
        setScreenerLoaded(true);
        setScreenerLoading(false);
        return;
      }

      // Step 2: Fetch earnings in parallel batches (5 concurrent)
      const BATCH = 30;
      const PARALLEL = 5;
      let allScCards: EarningsScanCard[] = [];
      const scBatches: string[][] = [];
      for (let i = 0; i < screenerOnly.length; i += BATCH) {
        scBatches.push(screenerOnly.slice(i, i + BATCH));
      }

      for (let w = 0; w < scBatches.length; w += PARALLEL) {
        const wave = scBatches.slice(w, w + PARALLEL);
        const results = await Promise.allSettled(
          wave.map(async (batch) => {
            const encoded = batch.map(s => encodeURIComponent(s)).join(',');
            // PATCH 0467 — 25s per-batch timeout (matches earlier wave)
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 25_000);
            let res: Response;
            try {
              res = await fetch(`/api/market/earnings-scan?symbols=${encoded}`, { signal: ctl.signal });
            } catch { clearTimeout(timer); return null; }
            clearTimeout(timer);
            if (!res.ok) return null;
            return res.json() as Promise<ScanResponse>;
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            const batchCards = (r.value.cards || []).map(c => ({ ...c, universeTag: 'screener' as const }));
            allScCards = [...allScCards, ...batchCards];
          }
        }
        // Update progress after each wave
        setScreenerCards(prev => [...prev, ...allScCards.slice(prev.length)]);
      }

      setScreenerCards(allScCards);
      setScreenerLoaded(true);
    } catch (err) {
      console.error('[Screener Earnings]', err);
    } finally {
      setScreenerLoading(false);
    }
  }, [screenerLoaded, portfolioSymbols, watchlistSymbols]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // PATCH 0352 — Lazy-load conviction-beats earnings cards. Fires once,
  // when the user first selects the 'conviction' universe or toggles
  // the Conviction Beats only filter ON. Fetches ONLY the conviction
  // tickers that aren't already in the loaded cards (i.e. not part of
  // portfolio/watchlist), then merges them into `cards` with the
  // proper isConviction flag set.
  useEffect(() => {
    if (convictionScanned || convictionLoading) return;
    const wantsConviction = selectedUniverses.has('conviction') || convictionOnly;
    if (!wantsConviction) return;
    const cbTickers = [...convictionTickersState];
    if (cbTickers.length === 0) {
      setConvictionScanned(true);
      return;
    }
    // Subtract what's already loaded
    const loadedSymbols = new Set(cards.map(c => c.symbol));
    const newTickers = cbTickers.filter(t => !loadedSymbols.has(t));
    if (newTickers.length === 0) {
      // Just tag existing cards as conviction
      setCards(prev => prev.map(c => ({ ...c, isConviction: convictionTickersState.has(c.symbol) || c.isConviction })));
      setConvictionScanned(true);
      return;
    }
    setConvictionLoading(true);
    (async () => {
      try {
        // PATCH 0944 — Right-size CB scan. P0942 used 50/batch with 18s timeout
        // but the upstream earnings-scan endpoint takes ~4s per ticker on
        // Screener.in cold path → 50 tickers would need ~200s, aborting after
        // ~4 tickers per batch (so almost no data came back). Now: 20/batch
        // with 28s timeout so each batch can actually complete (20 × 4s ≈ 80s
        // worst case, but Screener cache cuts this to 6-15s typical).
        // 6 parallel waves still keeps wall-clock around 50-60s for 396 names.
        const BATCH_SIZE = 20;
        const PARALLEL = 6;
        const batches: string[][] = [];
        for (let i = 0; i < newTickers.length; i += BATCH_SIZE) batches.push(newTickers.slice(i, i + BATCH_SIZE));
        // Tag existing cards as conviction immediately — no wait for fetch
        setCards(prev => prev.map(c => ({ ...c, isConviction: convictionTickersState.has(c.symbol) || c.isConviction })));

        for (let w = 0; w < batches.length; w += PARALLEL) {
          const wave = batches.slice(w, w + PARALLEL);
          const results = await Promise.allSettled(
            wave.map(async (batch) => {
              const encoded = batch.map(s => encodeURIComponent(s)).join(',');
              // PATCH 0944 — 28s per-batch. P0942's 18s was too tight when
              // combined with 50 tickers — Screener.in takes ~4s/ticker on
              // cold path so batches aborted before yielding data. 28s gives
              // a 20-ticker batch room to finish (typical 6-15s warm).
              const _ctl = new AbortController();
              const _timer = setTimeout(() => _ctl.abort(), 28_000);
              try {
                const res = await fetch(`/api/market/earnings-scan?symbols=${encoded}`, { signal: _ctl.signal });
                if (!res.ok) return null;
                try { return (await res.json()) as ScanResponse; } catch { return null; }
              } catch { return null; }
              finally { clearTimeout(_timer); }
            })
          );
          const waveCards: EarningsScanCard[] = [];
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              const batchCards = (r.value.cards || []).map(c => ({
                ...c,
                universeTag: 'conviction' as const,
                isConviction: true,
              }));
              waveCards.push(...batchCards);
            }
          }
          // PATCH 0942 — progressive render: push each wave's results
          // into state immediately so the user sees N more cards appear
          // every ~10s instead of waiting for the full 40s.
          if (waveCards.length > 0) {
            setCards(prev => {
              const existingSymbols = new Set(prev.map(c => c.symbol));
              const additions = waveCards.filter(c => !existingSymbols.has(c.symbol));
              return [...prev, ...additions];
            });
          }
        }
        setConvictionScanned(true);
      } catch (e) {
        console.error('[Earnings] Conviction lazy-load failed:', e);
      } finally {
        setConvictionLoading(false);
      }
    })();
  }, [selectedUniverses, convictionOnly, convictionScanned, convictionLoading, convictionTickersState, cards]);

  // Trigger screener fetch ONLY when user has Screener explicitly selected
  // in the multi-select universe. PATCH 0941: was firing on viewMode==='screener'
  // alone — that left the 2364-stock scan stuck in 'forever loading' if the
  // user had ever clicked Screener once (the chip handler at line 1964 always
  // calls setViewMode(key) even when toggling OFF, so viewMode stayed stuck).
  useEffect(() => {
    if (selectedUniverses.has('screener') && viewMode === 'screener' && !screenerLoaded && !screenerLoading) {
      fetchScreenerEarnings();
    }
  }, [viewMode, selectedUniverses, screenerLoaded, screenerLoading, fetchScreenerEarnings]);

  // Sort and filter
  const sortedCards = useMemo(() => {
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null;

    // Screener tab uses completely separate data — never mixed
    // PATCH 0198 — Multi-select: source pool = screenerCards (when screener selected
    // alone) OR cards (the normal scan universe). When multiple selected, we use
    // cards plus optionally union with screenerCards.
    const sourceCards = selectedUniverses.has('screener') && selectedUniverses.size === 1
      ? screenerCards
      : selectedUniverses.has('screener')
        ? [...cards, ...screenerCards]
        : cards;

    // PATCH 0445 BUG-039 — Defensive grade resolver. The filter previously
    // depended on `c.grade` being exactly one of EXCELLENT/STRONG/GOOD/OK/BAD.
    // If a cached/legacy payload shaped grade differently (quality/rating/tier)
    // or set it to lowercase, every specific-grade filter returned 0 even
    // though 86 cards were loaded. We now coerce + uppercase + fall back to
    // siblings so the filter is robust to API shape drift.
    const getGrade = (c: any): string => {
      const g = c?.grade ?? c?.quality ?? c?.rating ?? c?.tier ?? '';
      return String(g).toUpperCase().trim() || 'UNKNOWN';
    };

    return [...sourceCards]
      .filter(c => {
        // Multi-select universe filter — OR/union of selected sources
        if (!matchesSelectedUniverses(c)) return false;
        // PATCH 0186 — Conviction-only standalone toggle still composes (AND)
        if (convictionOnly && !convictionTickersState.has(c.symbol)) return false;
        // Filter by grade — defensive resolver (PATCH 0445)
        if (!filterGrades.includes('ALL') && !filterGrades.includes(getGrade(c))) return false;
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
    [cards, screenerCards, filterGrades, sortBy, viewMode, selectedUniverses, dateFrom, dateTo, guidanceFilter, convictionOnly, convictionTickersState]
  );

  // PATCH 0207 — Day-1 close filter pipeline.
  // 1. sortedCards above = base set after universe/date/grade/guidance/conviction
  //    filters. Stable input for the post-gap fetch (refetches only when this
  //    base set changes, not when the Day-1 chip is toggled).
  // 2. gapMap is fetched from /api/v1/earnings/post-gap for the base set.
  // 3. filteredCards = base set ∩ matchesDayOneFilter(gapMap, dayOneFilters).
  //    All downstream consumers (card grid, summary, export toolbar) use this
  //    so every filter composes correctly.
  const gapMap = usePostGapData(sortedCards);
  const filteredCards = useMemo(() => {
    if (dayOneFilters.size === 0) return sortedCards;
    return sortedCards.filter(c => matchesDayOneFilter(gapMap[c.symbol], dayOneFilters));
  }, [sortedCards, gapMap, dayOneFilters]);

  // ── Visible cards: filtered by viewMode + date, but NOT grade ──
  // Used for summary counts so the grade buttons show accurate numbers.
  const visibleCards = useMemo(() => {
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null;

    // PATCH 0198 — same multi-select logic as sortedCards
    const sourceCards = selectedUniverses.has('screener') && selectedUniverses.size === 1
      ? screenerCards
      : selectedUniverses.has('screener')
        ? [...cards, ...screenerCards]
        : cards;

    return sourceCards.filter(c => {
      if (!matchesSelectedUniverses(c)) return false;
      if (convictionOnly && !convictionTickersState.has(c.symbol)) return false;
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
  }, [cards, screenerCards, viewMode, dateFrom, dateTo, guidanceFilter]);

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

  // PATCH 0186 — Count of cards in conviction (post-filter, respecting other filters)
  const convictionCardCount = cards.filter((c) => convictionTickersState.has(c.symbol)).length;

  const VIEW_TABS: { key: ViewMode; label: string; emoji: string; count: number; total: number }[] = [
    { key: 'portfolio', label: 'Portfolio', emoji: '💼', count: portfolioCardCount, total: portfolioSymbols.length },
    { key: 'watchlist', label: 'Watchlist', emoji: '📋', count: watchlistCardCount, total: watchlistSymbols.length },
    { key: 'both', label: 'Both', emoji: '🔗', count: bothCardCount, total: new Set([...portfolioSymbols, ...watchlistSymbols]).size },
    { key: 'conviction', label: 'Conviction Beats', emoji: '🏆', count: convictionCardCount, total: convictionTickersState.size },
    { key: 'screener', label: 'Screener', emoji: '🔍', count: screenerCards.length, total: screenerSymbolCount },
  ];

  // ── PDF Download ──
  const handleDownloadPDF = useCallback(async () => {
    // PATCH 0207 — PDF reflects the user's visible set (includes Day-1 filter).
    if (filteredCards.length === 0) return;
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
    doc.text(`${modeLabel} · ${filteredCards.length} companies · ${now}`, pageW - 14, 11, { align: 'right' });

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
    const body = filteredCards.map((c, i) => {
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
  }, [filteredCards, viewMode, summary, source, failedSymbols]);

  return (
    <div style={{ backgroundColor: BG, minHeight: '100vh', padding: '24px', color: TEXT, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px 0' }}>Earnings Intelligence</h1>
        {/* PATCH 0557 — backend-degraded banner. */}
        <DegradedBanner />
        <p style={{ color: TEXT_DIM, margin: 0, fontSize: '13px' }}>
          {/* PATCH 0762 — Source label fallback. Was '...' forever when the
              API didn't echo back the source string. Now resolves to a sane
              default once the fetch settles. */}
          Custom universe quarterly results · Portfolio + Watchlist + Conviction Beats · Source: {source || (loading ? 'loading…' : 'FMP + NSE')}
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

      {/* View Mode Toggle (PATCH 0198 — multi-select)
          User can pick ANY combination of Portfolio + Watchlist + Conviction + Screener.
          The 'Both' option is removed since it's now P+W via multi-select. */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: TEXT_DIM, letterSpacing: '0.5px' }}>UNIVERSE:</span>
        {(['portfolio', 'watchlist', 'conviction', 'screener'] as const).map((key) => {
          const meta = ({
            portfolio: { emoji: '💼', label: 'Portfolio', accent: '#10B981' },
            watchlist: { emoji: '📋', label: 'Watchlist', accent: '#22D3EE' },
            conviction: { emoji: '🏆', label: 'Conviction Beats', accent: '#F59E0B' },
            screener: { emoji: '🔍', label: 'Screener', accent: '#8B5CF6' },
          } as const)[key];
          const tab = VIEW_TABS.find((t) => t.key === key);
          const count = tab?.count ?? 0;
          const total = tab?.total ?? 0;
          const on = selectedUniverses.has(key);
          return (
            <button key={key} onClick={() => {
                // PATCH 0941: only setViewMode when ENABLING (not toggling off).
                // Previously setViewMode(key) always fired, leaving viewMode
                // stuck on 'screener' after the user un-checked the Screener
                // chip — which kept the 2364-stock scan running forever.
                const wasOn = selectedUniverses.has(key);
                toggleUniverse(key);
                if (!wasOn) setViewMode(key);
                else if (viewMode === key) {
                  // unchecked the chip whose viewMode is active → fall back
                  const fallback: ViewMode = selectedUniverses.has('portfolio') ? 'portfolio'
                    : selectedUniverses.has('watchlist') ? 'watchlist'
                    : selectedUniverses.has('conviction') ? 'conviction' : 'watchlist';
                  setViewMode(fallback);
                }
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 16px', borderRadius: 8,
                border: `1.5px solid ${on ? meta.accent : CARD_BORDER}`,
                background: on ? `${meta.accent}25` : CARD,
                color: on ? meta.accent : TEXT,
                cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                transition: 'all 0.15s',
              }}>
              <span style={{
                width: 14, height: 14, borderRadius: 3,
                border: `1.5px solid ${on ? meta.accent : '#4A5B6C'}`,
                background: on ? meta.accent : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: on ? '#0A0E1A' : 'transparent', fontWeight: 900,
              }}>{on ? '✓' : ''}</span>
              <span>{meta.emoji}</span>
              <span>{meta.label}</span>
              <span style={{ fontSize: 10.5, opacity: 0.85, fontFamily: 'ui-monospace, monospace' }}>
                {loading ? '...' : count === total ? count : `${count}/${total}`}
              </span>
            </button>
          );
        })}

        {/* PATCH 0186 — Conviction Beats composable filter (AND-style on top of viewMode/grades/date/sentiment) */}
        <button onClick={() => setConvictionOnly((v) => !v)}
          title="Composable filter: restricts current view to stocks auto-tagged as Conviction Beats (BLOCKBUSTER / STRONG from Earnings Opportunities). Works alongside all other filters."
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8,
            border: `1px solid ${convictionOnly ? '#F59E0B' : CARD_BORDER}`,
            backgroundColor: convictionOnly ? '#F59E0B22' : CARD,
            color: convictionOnly ? '#F59E0B' : TEXT,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
          <Award style={{ width: 13, height: 13 }} />
          Conviction Beats only
          <span style={{
            fontSize: 10, fontWeight: 800,
            padding: '1px 5px', borderRadius: 3,
            backgroundColor: convictionOnly ? '#F59E0B' : '#1A2840',
            color: convictionOnly ? '#000' : '#6B7A8D',
          }}>{convictionTickersState.size}</span>
        </button>

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
          {/* PATCH 0354 — Last 7 days quick-set */}
          <button
            onClick={() => {
              const d = new Date(); d.setDate(d.getDate() - 7);
              setDateFrom(d.toISOString().slice(0, 10));
              setDateTo(new Date().toISOString().slice(0, 10));
            }}
            style={{
              background: 'none', border: `1px solid ${CARD_BORDER}`, borderRadius: '4px',
              color: TEXT_DIM, padding: '2px 6px', cursor: 'pointer', fontSize: '10px',
              whiteSpace: 'nowrap',
            }}
            title="Reset to last 7 days"
          >
            7D
          </button>
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
              const d = new Date(); d.setDate(d.getDate() - 60);
              setDateFrom(d.toISOString().slice(0, 10));
              setDateTo(new Date().toISOString().slice(0, 10));
            }}
            style={{
              background: 'none', border: `1px solid ${CARD_BORDER}`, borderRadius: '4px',
              color: TEXT_DIM, padding: '2px 6px', cursor: 'pointer', fontSize: '10px',
              whiteSpace: 'nowrap',
            }}
            title="Reset to last 60 days"
          >
            60D
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

        {/* PATCH 0207 — Day-1 close threshold (multi-select OR). Composes with
            every other filter. Click a chip to add it; click again to remove.
            Example combinations: '≥ +4%' alone = strong Day-1 winners only.
            '≥ +4%' + '≤ -5%' = both extreme winners AND losers. */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', paddingLeft: '4px', borderLeft: `1px solid ${CARD_BORDER}`, marginLeft: '4px' }}>
          <span style={{ fontSize: '10px', color: TEXT_DIM, fontWeight: 700, letterSpacing: '0.5px', marginRight: '4px' }}>1D CLOSE:</span>
          {DAY_ONE_FILTERS.map(f => {
            const isActive = dayOneFilters.has(f.key);
            return (
              <button
                key={f.key}
                onClick={() => toggleDayOneFilter(f.key)}
                title={`Day-1 close ${f.label} — toggle to combine`}
                style={{
                  backgroundColor: isActive ? `${f.color}20` : CARD,
                  border: `1px solid ${isActive ? f.color : CARD_BORDER}`,
                  color: isActive ? f.color : TEXT_DIM,
                  padding: '8px 10px', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '11px', fontWeight: 600, fontFamily: 'ui-monospace, monospace',
                }}
              >{f.label}</button>
            );
          })}
          {dayOneFilters.size > 0 && (
            <button
              onClick={() => setDayOneFilters(new Set())}
              title="Clear Day-1 filter"
              style={{
                backgroundColor: 'transparent',
                border: `1px solid ${CARD_BORDER}`,
                color: TEXT_DIM,
                padding: '8px 8px', borderRadius: '6px', cursor: 'pointer',
                fontSize: '10px', fontWeight: 600,
              }}
            >clear</button>
          )}
        </div>

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

      {/* Screener Loading State */}
      {viewMode === 'screener' && screenerLoading && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ width: '44px', height: '44px', border: `3px solid ${CARD_BORDER}`, borderTop: `3px solid ${ACCENT}`, borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
          <p style={{ color: TEXT_DIM, margin: 0 }}>Scanning earnings for {screenerSymbolCount} screener stocks...</p>
          <p style={{ color: TEXT_DIM, margin: '8px 0 0', fontSize: '12px' }}>This may take 30-60 seconds (fetching from multiple sources in batches)</p>
          <p style={{ color: TEXT_DIM, margin: '4px 0 0', fontSize: '11px' }}>{screenerCards.length} loaded so far</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Aggregation Panels — not for screener */}
      {!loading && viewMode !== 'screener' && cards.length > 0 && (
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
          <span>Showing {filteredCards.length} of {visibleCards.length}{viewMode !== 'screener' && visibleCards.length < cards.length ? ` (${cards.length} total)` : ''}{viewMode === 'screener' ? ` (screener universe)` : ''}{dayOneFilters.size > 0 && filteredCards.length < sortedCards.length ? ` · 1d filter trimmed ${sortedCards.length - filteredCards.length}` : ''}</span>
          {/* Data completeness ratio.
              PATCH 0566 — BUG-AUDIT-11: previously divided viewCards by the
              UNIVERSE size (totalRequested) which produced "Data Quality:
              0% (LOW)" when the user's filter narrowed the visible list to
              one or two enriched tickers — even though those tickers had
              full growth/score/grade. New behaviour: when the filtered list
              has data, scope the ratio to filteredCards itself and show
              "N/N enriched ✓" instead of misleading LOW. */}
          {(() => {
            const visible = filteredCards;
            const enriched = visible.filter(c => c.dataQuality !== 'PRICE_ONLY').length;
            if (visible.length === 0) return null;
            // When everything visible is enriched, show a calm "✓" pill.
            if (enriched === visible.length) {
              return (
                <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, backgroundColor: `${GREEN}15`, border: `1px solid ${GREEN}40`, color: GREEN }}>
                  {visible.length}/{visible.length} enriched ✓
                </span>
              );
            }
            // Otherwise show the ratio against the visible view, not the
            // entire universe (which made the badge useless under filters).
            const ratio = (enriched / visible.length) * 100;
            const color = ratio >= 80 ? GREEN : ratio >= 60 ? YELLOW : RED;
            const label = ratio >= 80 ? 'HIGH' : ratio >= 60 ? 'MEDIUM' : 'LOW';
            return (
              <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, backgroundColor: `${color}15`, border: `1px solid ${color}40`, color }}>
                Data Quality: {ratio.toFixed(0)}% ({label}) · {enriched}/{visible.length} enriched
              </span>
            );
          })()}
        </div>
      )}

      {/* Loading — only for portfolio/watchlist/both, not screener (screener has its own) */}
      {loading && viewMode !== 'screener' && (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{ width: '44px', height: '44px', border: `3px solid ${CARD_BORDER}`, borderTop: `3px solid ${ACCENT}`, borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
          <p style={{ color: TEXT_DIM, margin: 0 }}>Scanning quarterly results for {viewMode === 'both' ? 'portfolio + watchlist' : viewMode} stocks...</p>
          <p style={{ color: TEXT_DIM, margin: '8px 0 0', fontSize: '12px' }}>This may take 15-30 seconds (fetching from multiple sources)</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error */}
      {/* PATCH 0693 — explicit terminal error w/ last-scan timestamp. */}
      {error && !loading && (
        <div style={{ backgroundColor: `${RED}15`, border: `1px solid ${RED}40`, borderRadius: '8px', padding: '16px', color: RED, marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span><strong>{error.includes('timed out') ? '⚠ Upstream slow' : '⚠ Fetch failed'}:</strong> {error}</span>
            {lastScanAt && (
              <span style={{ fontSize: 11, color: TEXT_DIM }}>
                Last scan: {new Date(lastScanAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST
              </span>
            )}
          </div>
          <button onClick={() => fetchData(true)} style={{ backgroundColor: RED, border: 'none', color: '#fff', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>↻ Retry</button>
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

      {/* PATCH 0196 — Export toolbar above cards. Uses sortedCards (post-filter)
          so it always exports what the user is actually looking at. Tier groups
          derived from EXCELLENT/STRONG/GOOD/OK grades, plus a 'Conviction Beats'
          group when those tickers are present in the current filtered view. */}
      {!loading && !error && filteredCards.length > 0 && (() => {
        // PATCH 0207 — Export toolbar uses filteredCards so the exported list
        // matches exactly what's visible to the user (Day-1 filter included).
        const visibleTickers = filteredCards.map((c) => c.symbol);
        const gradeGroups: { label: string; emoji?: string; tickers: string[]; color?: string }[] = [];
        const gExcellent = filteredCards.filter((c) => c.grade === 'EXCELLENT').map((c) => c.symbol);
        const gStrong = filteredCards.filter((c) => c.grade === 'STRONG').map((c) => c.symbol);
        const gGood = filteredCards.filter((c) => c.grade === 'GOOD').map((c) => c.symbol);
        if (gExcellent.length > 0) gradeGroups.push({ label: 'EXCELLENT', emoji: '⭐', tickers: gExcellent, color: '#F59E0B' });
        if (gStrong.length > 0) gradeGroups.push({ label: 'STRONG', emoji: '🟢', tickers: gStrong, color: '#10B981' });
        if (gGood.length > 0) gradeGroups.push({ label: 'GOOD', emoji: '🔵', tickers: gGood, color: '#3B82F6' });
        // Conviction overlay
        const conviction = filteredCards.filter((c) => convictionTickersState.has(c.symbol)).map((c) => c.symbol);
        if (conviction.length > 0) gradeGroups.push({ label: 'Conviction', emoji: '🏆', tickers: conviction, color: '#F59E0B' });
        // PATCH 0366 — Build ticker -> company map so Screener.in export
        // uses readable company names instead of cryptic NSE symbols.
        const tickerCompanyMap: Record<string, string> = {};
        for (const c of filteredCards) {
          if (c.symbol && c.company) tickerCompanyMap[c.symbol.toUpperCase()] = c.company;
        }
        return (
          <div style={{ marginBottom: '12px' }}>
            <TickerExportToolbar
              tickers={visibleTickers}
              groups={gradeGroups}
              exchange="NSE"
              filenameHint="earnings-scan"
              tickerCompanyMap={tickerCompanyMap}
            />
          </div>
        );
      })()}

      {/* PATCH 0201/0207 — Post-earnings price gap. gapMap is lifted up via
          usePostGapData hook so the Day-1 close filter (and any future
          gap-aware filters) compose with the rest of the filter pipeline. */}
      {!loading && !error && filteredCards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '16px' }}>
          {filteredCards.map(card => <EarningsCardComponent key={card.symbol} card={card} postGap={gapMap[card.symbol]} />)}
        </div>
      )}

      {/* Empty State — PATCH 0446 BUG-039 v2: Smarter diagnostic message
          that identifies WHICH filter is eliminating cards (date / universe /
          grade / dayOne / guidance) instead of always blaming the grade
          filter. Surfaces a one-click "expand date range" CTA when the date
          window is the apparent culprit. */}
      {!loading && !error && filteredCards.length === 0 && (
        <div style={{ backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '8px', padding: '60px 20px', textAlign: 'center', color: TEXT_DIM }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
          {(() => {
            const total = cards.length;
            if (total === 0) {
              // PATCH 0762 — universe-aware empty state. Was always saying
              // 'no watchlist stocks found' even when Conviction Beats was
              // the active filter (BUG 2). Now reflects the actual selected
              // universe set.
              const cbSelected = selectedUniverses.has('conviction');
              const wlSelected = selectedUniverses.has('watchlist');
              const ptSelected = selectedUniverses.has('portfolio');
              const scSelected = selectedUniverses.has('screener');
              const cbCount = convictionTickersState.size;
              let title = 'No results yet';
              let hint = 'Pick a universe filter (Portfolio · Watchlist · Conviction Beats · Screener).';
              if (cbSelected && cbCount > 0 && !convictionScanned) {
                title = `Scanning ${cbCount} Conviction Beats names…`;
                hint = 'CB scan is lazy-loaded — may take 10-20s on first hit.';
              } else if (cbSelected && cbCount === 0) {
                title = 'Conviction Beats bench is empty';
                hint = 'Build the bench from /earnings-opportunities (BLOCKBUSTER + STRONG rows auto-add).';
              } else if (wlSelected && !cbSelected) {
                title = 'No watchlist stocks found';
                hint = 'Add stocks to your watchlist · or check the Conviction Beats checkbox.';
              } else if (ptSelected && !cbSelected) {
                title = 'No portfolio holdings found';
                hint = 'Upload your portfolio from /portfolio first.';
              } else if (scSelected) {
                title = 'No screener results';
                hint = 'Run a fresh screen on /screener · results auto-flow here.';
              }
              return (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 500 }}>{title}</p>
                  <p style={{ margin: 0, fontSize: '13px' }}>{hint}</p>
                </>
              );
            }
            const passedUniverse = cards.filter(c => matchesSelectedUniverses(c)).length;
            // Which filter eliminated the most?
            const culpritDate = dateFrom || dateTo;
            const culpritGrade = !filterGrades.includes('ALL');
            const culpritDayOne = dayOneFilters.size > 0 && sortedCards.length > 0;
            const culpritGuidance = guidanceFilter !== 'ALL';
            const reasons: string[] = [];
            if (culpritDate) reasons.push(`date range ${dateFrom || '—'} → ${dateTo || '—'}`);
            if (culpritGrade) reasons.push(`grade filter [${filterGrades.join(', ')}]`);
            if (culpritDayOne) reasons.push(`Day-1 close threshold`);
            if (culpritGuidance) reasons.push(`guidance = ${guidanceFilter}`);
            const reasonLine = reasons.length > 0 ? `Likely cause: ${reasons.join(' AND ')}` : 'Possibly the universe filter — none of your portfolio/watchlist symbols passed.';
            return (
              <>
                <p style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 500, color: '#E6EDF3' }}>
                  {total} cards loaded · {passedUniverse} passed universe · 0 visible
                </p>
                <p style={{ margin: '0 0 12px', fontSize: '13px' }}>{reasonLine}</p>
                <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {culpritDate && (
                    <button
                      onClick={() => {
                        const d = new Date(); d.setFullYear(d.getFullYear() - 1);
                        setDateFrom(d.toISOString().slice(0, 10));
                        setDateTo(new Date().toISOString().slice(0, 10));
                      }}
                      style={{ padding: '8px 14px', background: '#22D3EE15', border: '1px solid #22D3EE60', color: '#22D3EE', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >🗓 Expand to last 12 months</button>
                  )}
                  {culpritGrade && (
                    <button
                      onClick={() => setFilterGrades(['ALL'])}
                      style={{ padding: '8px 14px', background: '#10B98115', border: '1px solid #10B98160', color: '#10B981', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >Reset grade → ALL</button>
                  )}
                  {culpritDayOne && (
                    <button
                      onClick={() => setDayOneFilters(new Set())}
                      style={{ padding: '8px 14px', background: '#F59E0B15', border: '1px solid #F59E0B60', color: '#F59E0B', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >Clear Day-1 threshold</button>
                  )}
                  {culpritGuidance && (
                    <button
                      onClick={() => setGuidanceFilter('ALL')}
                      style={{ padding: '8px 14px', background: '#8B5CF615', border: '1px solid #8B5CF660', color: '#8B5CF6', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >Reset guidance → ALL</button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Bottom Summary */}
      {!loading && cards.length > 0 && <BottomSummary cards={cards} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// POST-EARNINGS GAP PROVIDER (PATCH 0201, normalizer added in 0202)
// Fetches Yahoo-based post-earnings price action for the visible cards.
// Render-prop pattern so the same hook lives once per visible set, not per card.
// ═══════════════════════════════════════════════════════════════════════════

/** Convert Screener-style resultDate strings into ISO YYYY-MM-DD.
 *  Accepts:
 *    "2026-04-15" / "2026-04-15T17:30:00"        → already ISO, slice to date
 *    "15-Apr-2026" / "15-Apr-2026 17:30:00"      → human format, parse + emit ISO
 *    "Mar 2026" / "-" / "N/A" / empty / null     → null (no real filing date) */
function toIsoFilingDate(resultDate?: string | null): string | null {
  if (!resultDate) return null;
  const trimmed = resultDate.trim();
  if (!trimmed || trimmed === '-' || trimmed === 'N/A') return null;
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // Just a quarter period like "Mar 2026" — no real filing date. Caller decides
  // whether to fall back to an estimate (see toFilingOrEstimate).
  if (/^[A-Za-z]{3,9}\s+\d{4}$/.test(trimmed)) return null;
  // Human format like "15-Apr-2026 17:30:00" → "Apr 15, 2026 17:30:00"
  const normalized = trimmed.replace(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/, '$2 $1, $3');
  const parsed = new Date(normalized);
  if (isNaN(parsed.getTime())) return null;
  // Local-day components — filing date is calendar-day specific; safe for IST/UTC.
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Estimate an approximate filing date from a quarter period string like
 *  "Mar 2026". Uses end-of-quarter + 15-day reporting lag — the SAME rule
 *  applied by the date-range filter at /earnings (lines 1416 / 1476).
 *  Returns null if the period is unparseable or if the estimated date is in
 *  the future (filing hasn't happened yet → no post-gap to show). */
function estimateFilingFromPeriod(period?: string | null): string | null {
  if (!period) return null;
  const quarterEnd = parseQuarterDate(period);
  if (!quarterEnd) return null;
  const endOfMonth = new Date(quarterEnd.getFullYear(), quarterEnd.getMonth() + 1, 0);
  const est = new Date(endOfMonth.getTime() + 15 * 24 * 60 * 60 * 1000);
  if (est.getTime() > Date.now()) return null;  // filing not yet expected
  const y = est.getFullYear();
  const m = String(est.getMonth() + 1).padStart(2, '0');
  const d = String(est.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Best-effort filing date: prefer the real date, fall back to quarter estimate. */
function toFilingOrEstimate(resultDate?: string | null, period?: string | null): string | null {
  return toIsoFilingDate(resultDate) || estimateFilingFromPeriod(period);
}

interface PostGap {
  gap_pct: number | null;
  close_move_pct: number | null;
  live_move_pct: number | null;
  is_live: boolean;
  target_date: string | null;
  filing_date?: string;                                                  // PATCH 0205
  filing_date_source?: 'explicit' | 'kv-calendar' | 'detected';          // PATCH 0205/0206
}
// PATCH 0207 — Converted from render-prop component to a hook so `gapMap` is
// available to the filter pipeline (Day-1 close threshold). Behaviour
// otherwise identical to the previous PostGapProvider.
function usePostGapData(cards: EarningsScanCard[]): Record<string, PostGap> {
  const items = useMemo(() => {
    return cards.slice(0, 80).map((c) => ({
      ticker: c.symbol,
      filing_date: toFilingOrEstimate(c.resultDate, c.period),
      period: c.period || '',
      timing: 'post' as const,
    })).filter((x): x is { ticker: string; filing_date: string; period: string; timing: 'post' } => !!x.ticker && !!x.filing_date);
  }, [cards]);

  const key = useMemo(() => items.map((i) => `${i.ticker}|${i.filing_date}`).join(','), [items]);
  const { data } = useQuery<Record<string, PostGap>>({
    queryKey: ['post-earnings-gap', key],
    enabled: items.length > 0,
    queryFn: async () => {
      // PATCH 0716 — added 20s timeout + safe JSON parse.
      const _pgCtl = new AbortController();
      const _pgTimer = setTimeout(() => _pgCtl.abort(), 20_000);
      let res: Response;
      try {
        res = await fetch('/api/v1/earnings/post-gap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
          signal: _pgCtl.signal,
        });
      } catch { clearTimeout(_pgTimer); return {} as Record<string, PostGap>; }
      finally { clearTimeout(_pgTimer); }
      if (!res.ok) return {};
      let j: any = {};
      try { j = await res.json(); } catch { return {} as Record<string, PostGap>; }
      return (j && typeof j === 'object' && j.data && typeof j.data === 'object') ? j.data : {};
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return data || {};
}

// PATCH 0207 — Day-1 close threshold filter. Multi-select with OR semantics;
// a card passes if its close_move_pct satisfies ANY selected threshold.
// Cards without resolved gap data are excluded when any filter is active.
type DayOneFilter = 'GE2' | 'GE4' | 'GE7' | 'GE10' | 'NEG2' | 'NEG5';
const DAY_ONE_FILTERS: { key: DayOneFilter; label: string; predicate: (v: number) => boolean; color: string }[] = [
  { key: 'GE2',  label: '≥ +2%',  predicate: v => v >= 2,   color: '#22D3EE' },
  { key: 'GE4',  label: '≥ +4%',  predicate: v => v >= 4,   color: '#10B981' },
  { key: 'GE7',  label: '≥ +7%',  predicate: v => v >= 7,   color: '#10B981' },
  { key: 'GE10', label: '≥ +10%', predicate: v => v >= 10,  color: '#F59E0B' },
  { key: 'NEG2', label: '≤ -2%',  predicate: v => v <= -2,  color: '#F87171' },
  { key: 'NEG5', label: '≤ -5%',  predicate: v => v <= -5,  color: '#EF4444' },
];
function matchesDayOneFilter(postGap: PostGap | undefined, filters: Set<DayOneFilter>): boolean {
  if (filters.size === 0) return true;
  const v = postGap?.close_move_pct;
  if (v == null) return false;
  for (const f of filters) {
    const def = DAY_ONE_FILTERS.find(d => d.key === f);
    if (def && def.predicate(v)) return true;
  }
  return false;
}
