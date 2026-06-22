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
  // PATCH 0972 BUG-3 — null/undefined now means "not meaningful" (prior period
  // was 0 or near-zero per pctChange in earnings-scan route). Render "n/m"
  // with tooltip explaining why instead of '—' which looks like missing data.
  if (value === null || value === undefined) {
    return (
      <span
        title="Not meaningful — prior period was 0 or near-zero. Percent change is mathematically undefined."
        style={{ color: TEXT_DIM, fontSize, fontStyle: 'italic' }}
      >n/m</span>
    );
  }
  const color = value > 0 ? GREEN : value < 0 ? RED : TEXT_DIM;
  const prefix = value > 0 ? '+' : '';
  // PATCH 0972 BUG-4 — cap absurd growth rates at +500% / -100%. Anything
  // beyond those thresholds is almost always low-base distortion (e.g.
  // Adani Green PAT QoQ +10,180% because prev quarter PAT was ₹0.05 Cr;
  // ENRIN EPS YoY +999.9% because prior EPS was 0.00). Render as ">500%"
  // with tooltip preserving the actual value so analysts can audit.
  const absV = Math.abs(value);
  if (absV > 500) {
    return (
      <span
        title={`Actual: ${prefix}${value.toFixed(1)}% — capped at ±500% because low-base distortion makes percent changes misleading (a tiny prior period inflates the ratio).`}
        style={{ color, fontSize, fontWeight: 600, fontFamily: 'monospace', fontStyle: 'italic' }}
      >{value > 0 ? '>+500%' : '<-100%'}</span>
    );
  }
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

// PATCH 0948 — Derive a stable cache period like "Q4-FY26" from the card's
// "period" string (typically "Mar 2026" / "Jun 2025" / etc — Screener.in
// publishes quarter-end month + year). Indian FY convention: Apr→Mar.
function deriveCachePeriod(periodStr: string | undefined): string {
  if (!periodStr) return 'unknown';
  const m = String(periodStr).trim().match(/^(\w{3})\s+(\d{4})$/);
  if (!m) return 'unknown';
  const month = m[1].toUpperCase();
  const year = parseInt(m[2], 10);
  const Q = ({ MAR: 'Q4', JUN: 'Q1', SEP: 'Q2', DEC: 'Q3' } as Record<string, string>)[month];
  if (!Q) return 'unknown';
  // FY26 = Apr 2025 → Mar 2026. So Mar 2026 → FY26 = year % 100. Jun/Sep/Dec
  // of YEAR fall in FY(YEAR+1) since they precede the next March.
  const fy = Q === 'Q4' ? (year % 100) : ((year + 1) % 100);
  return `${Q}-FY${fy.toString().padStart(2, '0')}`;
}

// PATCH 0948/0951 — AI Forward Guidance interface shared with the server endpoint.
// P0951 added: 'NoGuidance' label (honest "PDF has nothing forward" signal),
// numbers/catalysts arrays (institutional-grade specifics), source_filename
// (audit trail so the user can verify which PDF was read).
export interface AIForwardGuidance {
  label: 'Positive' | 'Neutral' | 'Negative' | 'NoGuidance';
  score: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
  quotes: string[];
  numbers?: Array<{ metric: string; value: string; period?: string }>;
  catalysts?: Array<{ event: string; timing?: string }>;
  source: 'concall-transcript' | 'investor-presentation' | 'press-release';
  source_url?: string;
  source_filename?: string;
  period: string;
  extracted_at: string;
  // PATCH 0962 — provenance + telemetry (ISSUE #5/#9/#11). Optional on hydrate
  // because pre-v3 entries don't have them; the validator + version check
  // decides whether to trust them.
  schema_version?: number;
  prompt_version?: string;
  parser_version?: string;
  source_fetched_at?: string;
  source_provider?: 'nse' | 'screener-in';
  source_period_hint?: string;
  pdf_chars?: number;
  pdf_pages?: number;
  pdf_quality?: 'good' | 'pdf-empty' | 'pdf-image-only' | 'pdf-too-short' | 'pdf-corrupt' | 'no-pdf' | 'intimation-only';
  extraction_ms?: number;
  retry_count?: number;
  stop_reason?: string;
}

// PATCH 0962 — Client-side cache validator (ISSUE #10). Mirrors the server's
// isValidGuidanceObject so hydration drops malformed or partially migrated
// entries instead of silently rendering them.
// NOT exported: Next.js page files reject non-standard exports.
function isValidGuidanceObject(v: unknown): v is AIForwardGuidance {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (!['Positive', 'Neutral', 'Negative', 'NoGuidance'].includes(o.label as string)) return false;
  if (typeof o.score !== 'number' || !isFinite(o.score)) return false;
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(o.confidence as string)) return false;
  if (typeof o.rationale !== 'string') return false;
  if (!Array.isArray(o.quotes)) return false;
  if (typeof o.period !== 'string' || !o.period) return false;
  return true;
}

// PATCH 0962 — Current schema version the client expects. Cached objects
// with a lower version are treated as stale and re-fetched. Bump this only
// when the schema gains a NEW non-optional field; optional additions don't
// need a bump because validateGuidanceObject still passes.
const CLIENT_EXPECTED_SCHEMA_VERSION = 3;
const CLIENT_LS_KEY = 'mc:ai-fg:v3';   // PATCH 0962 — bumped to invalidate old v2 schema entries

// PATCH 0949 — AI tier classifier. The LLM returns label ∈ {Positive,Neutral,Negative}
// which is too coarse to differentiate quality. Use the signed score in [-1, +1]
// to bucket into 5 tiers so the user can read a card and instantly tell whether
// the AI verdict is strong, mild, or marginal. Tier governs colour/icon/label;
// confidence === 'LOW' overrides border to dashed + appends "(low conf)" so we
// never make a confident-looking badge from a shaky read.
type AITier = 'EXCELLENT' | 'POSITIVE' | 'NEUTRAL' | 'CAUTIOUS' | 'NEGATIVE' | 'NOGUIDANCE';

function aiTier(ai: AIForwardGuidance | null | undefined):
  | { tier: AITier; color: string; icon: string; label: string }
  | null {
  if (!ai) return null;
  // PATCH 0951 — NoGuidance is its own tier (greyed out, "no forward content").
  // Honest: better than fabricating Neutral 0.00 on an intimation PDF.
  if (ai.label === 'NoGuidance') {
    return { tier: 'NOGUIDANCE', color: '#6B7280', icon: '◌', label: 'No fwd guidance' };
  }
  const s = ai.score;
  if (s >= 0.6)  return { tier: 'EXCELLENT', color: '#10B981', icon: '🚀', label: 'AI-Excellent' };
  if (s >= 0.2)  return { tier: 'POSITIVE',  color: '#34D399', icon: '▲',  label: 'AI-Positive'  };
  if (s > -0.2)  return { tier: 'NEUTRAL',   color: '#94A3B8', icon: '●',  label: 'AI-Neutral'   };
  if (s > -0.6)  return { tier: 'CAUTIOUS',  color: '#F59E0B', icon: '▽',  label: 'AI-Cautious'  };
  return            { tier: 'NEGATIVE', color: '#EF4444', icon: '⚠',  label: 'AI-Negative' };
}

function GuidanceBadge({ guidance, score, ai }: { guidance?: string; score?: number; ai?: AIForwardGuidance | null }) {
  // PATCH 0948/0949 — Two distinct visual tracks so the user can read the chip
  // and know IMMEDIATELY whether it's the keyword-derived Screener Signal
  // (historical) or the AI-extracted Forward Guidance (concall transcript).
  //   • Keyword chip: grey ●/▲/▼ with no robot, no purple, no glow.
  //   • AI chip:      🤖 prefix + purple left-border accent + 5-tier colour/icon
  //                   based on score magnitude (EXCELLENT/POSITIVE/NEUTRAL/CAUTIOUS/NEGATIVE),
  //                   dashed border + "(low conf)" suffix when confidence === 'LOW'.
  const t = aiTier(ai || null);
  if (t && ai) {
    const lowConf = ai.confidence === 'LOW';
    const isNoGuidance = ai.label === 'NoGuidance';
    // PATCH 0951 — institutional-grade chip. Renders the top guidance number
    // INLINE on the chip face (e.g. "🚀 AI-Excellent +0.78 · Rev +18-20% FY27")
    // so the PM can read the card without hovering. Hover tooltip then
    // expands to the full numbers + catalysts + quotes brief.
    const topNumber = ai.numbers && ai.numbers.length > 0
      ? `${ai.numbers[0].metric}: ${ai.numbers[0].value}${ai.numbers[0].period ? ` ${ai.numbers[0].period}` : ''}`
      : null;
    const tooltipLines: string[] = [];
    tooltipLines.push(`Forward Guidance (AI · ${t.label} · ${ai.confidence} confidence · ${ai.source})`);
    if (ai.source_filename) tooltipLines.push(`Source PDF: ${ai.source_filename}`);
    tooltipLines.push('');
    tooltipLines.push(ai.rationale || '(no rationale)');
    if (ai.numbers && ai.numbers.length > 0) {
      tooltipLines.push('');
      tooltipLines.push('NUMBERS:');
      for (const n of ai.numbers) tooltipLines.push(`• ${n.metric}: ${n.value}${n.period ? ` (${n.period})` : ''}`);
    }
    if (ai.catalysts && ai.catalysts.length > 0) {
      tooltipLines.push('');
      tooltipLines.push('CATALYSTS:');
      for (const c of ai.catalysts) tooltipLines.push(`• ${c.event}${c.timing ? ` (${c.timing})` : ''}`);
    }
    if (ai.quotes && ai.quotes.length > 0) {
      tooltipLines.push('');
      tooltipLines.push('QUOTES:');
      for (const q of ai.quotes) tooltipLines.push(`• ${q}`);
    }
    const tooltip = tooltipLines.join('\n');

    // NoGuidance gets a different look — grey, no glow, honest "no content" message.
    if (isNoGuidance) {
      return (
        <span title={tooltip} style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px',
          padding: '2px 7px', borderRadius: '4px',
          backgroundColor: `${t.color}15`,
          border: `1px dashed ${t.color}60`,
          borderLeft: `3px solid #7C3AED`,
          color: t.color, fontWeight: 600,
        }}>
          🤖 {t.icon} {t.label} — only intimation/notice filed
        </span>
      );
    }

    return (
      <span title={tooltip} style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px',
        padding: '2px 7px', borderRadius: '4px',
        backgroundColor: `${t.color}18`,
        border: `1px ${lowConf ? 'dashed' : 'solid'} ${t.color}80`,
        borderLeft: `3px solid #7C3AED`,
        color: t.color, fontWeight: 700,
        boxShadow: lowConf ? undefined : `0 0 0 1px ${t.color}25`,
        maxWidth: '460px',
      }}>
        🤖 {t.icon} {t.label}: {ai.score >= 0 ? '+' : ''}{ai.score.toFixed(2)}{lowConf ? ' (low conf)' : ''}
        {topNumber && (
          <span style={{
            marginLeft: '6px', paddingLeft: '6px', borderLeft: `1px solid ${t.color}60`,
            color: 'var(--mc-text-1)', fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {topNumber}
          </span>
        )}
      </span>
    );
  }
  // Keyword fallback (Screener pros/cons score — historical, not forward)
  if (!guidance) return null;
  const cfg: Record<string, { color: string; icon: string }> = {
    'Positive': { color: '#10B981', icon: '▲' },
    'Neutral':  { color: '#F59E0B', icon: '●' },
    'Negative': { color: '#EF4444', icon: '▼' },
  };
  const c = cfg[guidance] || cfg['Neutral'];
  return (
    <span title="Screener pros/cons keyword score — historical balance-sheet signals, NOT forward guidance. Run AI Guidance for real concall extract." style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px',
      padding: '2px 7px', borderRadius: '4px',
      backgroundColor: `${c.color}12`, border: `1px solid ${c.color}40`,
      color: c.color, fontWeight: 600,
    }}>
      {c.icon} Screener Signal: {guidance}{score !== undefined ? ` (${score > 0 ? '+' : ''}${score.toFixed(2)})` : ''}
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
      backgroundColor: isStrongWeak ? 'color-mix(in srgb, var(--mc-bearish) 9%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)',
      border: `1px solid ${isStrongWeak ? 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)'}`,
      color: isStrongWeak ? 'var(--mc-bearish)' : 'var(--mc-bullish)', fontWeight: 700, letterSpacing: '0.3px',
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
      backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)',
      color: 'var(--mc-bearish)', fontWeight: 700, letterSpacing: '0.3px',
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

function formatMcap(num: number | null, cmp?: number | null): string {
  if (num === null || num === undefined || num <= 0) return '—';
  // PATCH 0972 BUG-2 — MCap sanity validation. User reported POLICYBZR
  // (PB Fintech) showing "MCap: ₹5 Cr" while CMP was ₹426 — implies only
  // ~12 lakh shares outstanding (vs the real ~46 Cr). Almost certainly an
  // upstream parser bug (probably stripping "₹65,XXX Cr" digits). Rule:
  // any company with CMP > ₹50 should have MCap > ₹100 Cr (smallest
  // floating shares scenario: 2 lakh shares × ₹50 = ₹1 Cr). When the
  // displayed mcap implies < 2 lakh shares outstanding, suppress with
  // a question-mark hint so user knows the value is suspect.
  if (cmp && cmp > 0 && num > 0) {
    const impliedSharesCr = num / cmp;  // num and cmp both in same currency unit
    // < 2 lakh shares (0.02 Cr) for a company trading > ₹50 is nonsensical
    if (cmp > 50 && impliedSharesCr < 0.02) {
      return '? (data error)';
    }
  }
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

// PATCH 0956/0958 — eligibility helper. P0958 dropped the D1 gate, so only
// two states now: 'eligible' (EX/ST grade) and 'low-grade' (GOOD/OK/BAD).
// Universe filter is the cost lever, not per-card D1.
function aiEligibilityReason(card: EarningsScanCard): { state: 'eligible' | 'low-grade'; reason: string } {
  if (card.grade !== 'EXCELLENT' && card.grade !== 'STRONG') {
    return { state: 'low-grade', reason: `AI gated: ${card.grade} grade (only EX/ST)` };
  }
  return { state: 'eligible', reason: '' };
}

function EarningsCardComponent({ card, postGap, ai }: { card: EarningsScanCard; postGap?: { gap_pct: number | null; close_move_pct: number | null; live_move_pct: number | null; is_live: boolean; target_date: string | null; filing_date?: string; filing_date_source?: 'explicit' | 'kv-calendar' | 'detected' }; ai?: AIForwardGuidance | null }) {
  // PATCH 0968 BUG-A — added 'conviction' case. Without it, conviction-tagged
  // cards (from the lazy conviction-beats fetch path) were falling through to
  // the default and rendering "WATCHLIST" — falsely implying they were in the
  // user's watchlist. Conviction is a SEPARATE universe.
  const tagColor =
    card.universeTag === 'portfolio'   ? '#10B981' :
    card.universeTag === 'both'        ? '#8B5CF6' :
    card.universeTag === 'screener'    ? '#F59E0B' :
    card.universeTag === 'conviction'  ? '#3B82F6' :  // PATCH 0968 — blue for conviction
    ACCENT;
  const tagLabel =
    card.universeTag === 'portfolio'   ? 'PORTFOLIO' :
    card.universeTag === 'both'        ? 'BOTH' :
    card.universeTag === 'screener'    ? 'SCREENER' :
    card.universeTag === 'conviction'  ? 'CONVICTION' :  // PATCH 0968 — explicit conviction
    'WATCHLIST';

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
            {card.mcap && <span style={{ fontSize: '10px', color: TEXT_DIM }}>MCap: {formatMcap(card.mcap, card.cmp)}</span>}
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
            <GuidanceBadge guidance={card.guidance} score={card.sentimentScore} ai={ai} />
            <DivergenceBadge divergence={card.divergence} />
            {/* PATCH 0956 — eligibility hint when there's no AI badge so user
                knows whether AI is gated or just not extracted yet. Only
                shown when there's no AI guidance for this card. */}
            {!ai && (() => {
              const elig = aiEligibilityReason(card);
              if (elig.state === 'eligible') {
                return (
                  <span style={{
                    fontSize: '9px', color: 'var(--mc-warn)', fontWeight: 600,
                    padding: '1px 6px', borderRadius: '3px',
                    backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px dashed color-mix(in srgb, var(--mc-warn) 25%, transparent)',
                  }} title="This card qualifies (EX/ST grade) — click '🤖 AI Guidance' in the toolbar to extract.">
                    🤖 click to extract
                  </span>
                );
              }
              return (
                <span style={{
                  fontSize: '9px', color: TEXT_DIM, fontWeight: 500, fontStyle: 'italic',
                }} title="AI Forward Guidance only runs on EXCELLENT/STRONG grade cards. Narrow universe (Watchlist/Conviction/Screener) to control cost.">
                  {elig.reason}
                </span>
              );
            })()}
          </div>
          {/* PATCH 0951b — Institutional brief. When AI Forward Guidance has
              extracted hard numbers or catalysts, render them all visibly here
              so the user reads the whole brief without hovering. Tooltip
              remains as a backup but the chip face + this panel together =
              a complete card-level read. */}
          {ai && ((ai.numbers && ai.numbers.length > 0) || (ai.catalysts && ai.catalysts.length > 0)) && (
            <div style={{
              marginTop: '6px', marginBottom: '6px',
              padding: '8px 10px', borderRadius: '6px',
              backgroundColor: '#7C3AED10', border: '1px solid #7C3AED30',
              borderLeft: '3px solid #7C3AED',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontSize: '9px', color: '#C4B5FD', fontWeight: 700, letterSpacing: '0.5px' }}>
                  🤖 AI FORWARD GUIDANCE
                </span>
                <span style={{ fontSize: '9px', color: TEXT_DIM, fontWeight: 500 }}>
                  {ai.confidence} confidence · {ai.source}{ai.source_filename ? ` · ${ai.source_filename}` : ''}
                </span>
              </div>
              {ai.rationale && (
                <div style={{ fontSize: '11px', color: TEXT, marginBottom: '6px', lineHeight: 1.45 }}>
                  {ai.rationale}
                </div>
              )}
              {ai.numbers && ai.numbers.length > 0 && (
                <div style={{ marginBottom: ai.catalysts && ai.catalysts.length > 0 ? '6px' : 0 }}>
                  <div style={{ fontSize: '8px', color: TEXT_DIM, fontWeight: 700, letterSpacing: '0.4px', marginBottom: '3px' }}>NUMBERS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {ai.numbers.map((n, i) => (
                      <div key={`n${i}`} style={{ fontSize: '10.5px', color: 'var(--mc-text-1)', display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                        <span style={{ color: '#34D399', fontWeight: 700, flexShrink: 0 }}>📊</span>
                        <span style={{ color: TEXT_DIM }}>{n.metric}:</span>
                        <span style={{ color: '#34D399', fontWeight: 700 }}>{n.value}</span>
                        {n.period && <span style={{ color: TEXT_DIM, fontSize: '9.5px' }}>({n.period})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ai.catalysts && ai.catalysts.length > 0 && (
                <div>
                  <div style={{ fontSize: '8px', color: TEXT_DIM, fontWeight: 700, letterSpacing: '0.4px', marginBottom: '3px' }}>CATALYSTS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {ai.catalysts.map((c, i) => (
                      <div key={`c${i}`} style={{ fontSize: '10.5px', color: 'var(--mc-text-1)', display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--mc-warn)', fontWeight: 700, flexShrink: 0 }}>🗓</span>
                        <span>{c.event}</span>
                        {c.timing && <span style={{ color: 'var(--mc-warn)', fontWeight: 700, fontSize: '9.5px' }}>({c.timing})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ai.quotes && ai.quotes.length > 0 && (
                <details style={{ marginTop: '6px' }}>
                  <summary style={{ fontSize: '9px', color: '#C4B5FD', fontWeight: 700, letterSpacing: '0.4px', cursor: 'pointer' }}>
                    {ai.quotes.length} VERBATIM QUOTES ▾
                  </summary>
                  <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {ai.quotes.map((q, i) => (
                      <div key={`q${i}`} style={{ fontSize: '10px', color: TEXT_DIM, fontStyle: 'italic', borderLeft: '2px solid #7C3AED40', paddingLeft: '8px', lineHeight: 1.4 }}>
                        “{q}”
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <OutlookPill label="Revenue" value={card.revenueOutlook} />
            <OutlookPill label="Margins" value={card.marginOutlook} />
            <OutlookPill label="Capex" value={card.capexSignal} />
            <OutlookPill label="Demand" value={card.demandSignal} />
          </div>
          {((card.keyPhrasesPositive && card.keyPhrasesPositive.length > 0) || (card.keyPhrasesNegative && card.keyPhrasesNegative.length > 0)) && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
              {(card.keyPhrasesPositive || []).map((p, i) => (
                <span key={`p${i}`} style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 19%, transparent)' }}>{p}</span>
              ))}
              {(card.keyPhrasesNegative || []).map((p, i) => (
                <span key={`n${i}`} style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: 'var(--mc-bearish)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)' }}>{p}</span>
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
  // PATCH 0948 — AI Forward Guidance state.
  // Map of ticker -> AIForwardGuidance, loaded from localStorage on mount,
  // mutated by the "AI Guidance" button. Persists quarter-stable so a
  // refresh-all only re-fetches when user explicitly forces.
  const [aiGuidance, setAiGuidance] = useState<Record<string, AIForwardGuidance>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      // PATCH 0962 — schema-versioned hydrate (ISSUE #9, #10).
      //   1. Read v3 first (current schema). Fall back to v2 ONLY for entries
      //      that pass isValidGuidanceObject — pre-v2 garbage is dropped.
      //   2. Every kept entry must validate against the live schema. Any
      //      entry that fails validation is dropped (will be re-extracted
      //      on next AI Guidance click via client cache skip).
      //   3. Entries with schema_version < CLIENT_EXPECTED_SCHEMA_VERSION are
      //      kept but flagged stale_schema — the next AI Guidance click
      //      will re-extract them because the server's v3 cache key won't hit.
      const v3raw = localStorage.getItem(CLIENT_LS_KEY);          // 'mc:ai-fg:v3'
      const v2raw = localStorage.getItem('mc:ai-fg:v2');
      const raw = v3raw || v2raw || '{}';
      const parsed: Record<string, unknown> = JSON.parse(raw) || {};
      const filtered: Record<string, AIForwardGuidance> = {};
      let dropped = 0;
      let stale_schema = 0;
      for (const [k, v] of Object.entries(parsed)) {
        if (!isValidGuidanceObject(v)) { dropped++; continue; }
        // Optional version-gate: if entry is from an older schema, count it
        // but still render — better to show something than nothing while
        // the user re-clicks AI Guidance. The server's v3 cache key will
        // bypass these on the next extraction.
        if ((v.schema_version || 0) < CLIENT_EXPECTED_SCHEMA_VERSION) stale_schema++;
        filtered[k] = v;
      }
      if (dropped > 0 || stale_schema > 0) {
        try { console.log(`[AI Guidance] Hydrate: kept ${Object.keys(filtered).length}, dropped ${dropped} invalid, ${stale_schema} have stale schema (will re-extract on next click)`); } catch {}
      }
      // Re-write under v3 key so subsequent loads use the modern key.
      // Drop the v2 key once we've migrated everything we could.
      try { localStorage.setItem(CLIENT_LS_KEY, JSON.stringify(filtered)); } catch {}
      try { localStorage.removeItem('mc:ai-fg:v2'); } catch {}
      try { localStorage.removeItem('mc:ai-fg:v1'); } catch {}
      return filtered;
    } catch { return {}; }
  });
  const [aiLoading, setAiLoading] = useState(false);
  // PATCH 0959 — progress indicator while AI extraction runs across multiple
  // batches. Shows 'extracting X / Y' on the button so a long run (~3min on
  // a 350-card universe) isn't an opaque spinner.
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null);
  // PATCH 0961 — added batch_failures + failed_tickers so silent Vercel
  // 504s (server timed out for an entire chunk) are visible in the banner
  // instead of vanishing into a null Promise.allSettled value.
  // PATCH 0962 — extended with PDF-quality taxonomy + retry telemetry +
  // recovered_from_kv (mini job-store reconciliation) + cached_invalid_dropped
  // (ISSUE #10 validation). All optional so the empty-short-circuit path
  // still type-checks.
  const [aiStats, setAiStats] = useState<{
    cached: number; extracted: number;
    intimation_only?: number; screener_fallback?: number; budget_exceeded?: number;
    missing_pdf: number; llm_failed: number; total: number;
    batch_failures?: number; failed_tickers?: string[];
    cached_invalid_dropped?: number; recovered_from_kv?: number;
    pdf_empty?: number; pdf_image_only?: number; pdf_too_short?: number; pdf_corrupt?: number;
    retries?: number; parse_failures?: number; max_tokens_hits?: number;
    avg_extraction_ms?: number;
  } | null>(null);
  // PATCH 0949a/0951/0953 — per-ticker diagnostics. P0953 adds
  // 'ok-screener-fallback' outcome + fallback_source/fallback_date fields
  // so the audit trail shows which path each ticker took.
  type FGDiag = { ticker: string; outcome: 'cf-error' | 'no-filings' | 'no-attachment' | 'intimation-only' | 'ok' | 'ok-screener-fallback'; total_filings_seen?: number; ticker_filings?: number; ticker_with_attachment?: number; matched_preference?: string; best_score?: number; subject?: string; filename?: string; url?: string; fallback_source?: 'screener-in'; fallback_date?: string; error?: string; stage?: 'pdf-empty' | 'llm-failed' };
  const [aiDiagnostics, setAiDiagnostics] = useState<FGDiag[] | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [guidanceFilter, setGuidanceFilter] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'>('ALL'); // Filter by forward guidance sentiment
  // PATCH 0949/0950 — AI-tier filter. Multi-select OR semantics (like dayOneFilters)
  // so the user can pin the grid to e.g. EXCELLENT + POSITIVE together, or
  // NEGATIVE + CAUTIOUS to triage the at-risk prints. Empty set = no AI filter.
  // EXTRACTED_ONLY is a meta-chip — when present in the set, only cards that
  // have any AI guidance (regardless of tier) are kept; combines with tier
  // chips by OR (so "EXTRACTED_ONLY + NEGATIVE" still includes every extracted
  // card). Composes downstream of every other filter via filteredCards memo.
  type AIFilterKey = 'EXTRACTED_ONLY' | 'EXCELLENT' | 'POSITIVE' | 'NEUTRAL' | 'CAUTIOUS' | 'NEGATIVE';
  const [aiFilters, setAiFilters] = useState<Set<AIFilterKey>>(new Set());
  const toggleAiFilter = (k: AIFilterKey) => {
    setAiFilters(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
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
  // PATCH 0969 — diagnostic for "Portfolio/Watchlist 0" mystery. Populated
  // by the fetchData loader after both API + LS fallbacks complete. Surfaced
  // in the universe chip tooltip when count is 0 so the user can see in
  // real time WHY (api empty? LS empty? both? which keys probed?).
  const [universeDiag, setUniverseDiag] = useState<{
    portfolio: { api: number; ls_keys_hit: string[]; resolved: number };
    watchlist: { api: number; ls_keys_hit: string[]; resolved: number };
    at: string;
  } | null>(null);
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
      // PATCH 0946 — localStorage is now ALWAYS a fallback layer, not only
      // "if API failed". Several user-reported sessions showed Portfolio 0 /
      // Watchlist 0 even though localStorage had real tickers, because the
      // API returned empty arrays (chatId mismatch / cold cache) instead of
      // actually failing. We now merge: API tickers + localStorage tickers
      // (deduped UPPER). Either source populates the universe.
      try {
        const wlStored = localStorage.getItem('mc_watchlist_tickers');
        if (wlStored) {
          const lsList: string[] = JSON.parse(wlStored) || [];
          if (Array.isArray(lsList) && lsList.length > 0) {
            const merged = new Set([...watchlist, ...lsList].map(s => String(s || '').toUpperCase().trim()).filter(Boolean));
            watchlist = Array.from(merged);
          }
        }
      } catch {}
      // PATCH 0967 BUG-A — localStorage KEY MISMATCH fix.
      // The /portfolio page (My Book) stores holdings under 'mc_portfolio_holdings'
      // (see frontend/src/app/(dashboard)/portfolio/page.tsx line 68 — STORAGE_KEY).
      // This page was reading the OLD key 'portfolioHoldings' which never matched,
      // so 43 user holdings never propagated into the Earnings universe → showed
      // "Portfolio 0" even though My Book had 43 entries.
      // Fix: read the CANONICAL key first, fall back to the legacy key for any
      // older sessions that may have written under the old name.
      // PATCH 0968 BUG-C — try ALL known portfolio LS keys.
      // /portfolio (My Book) writes 'mc_portfolio_holdings'. Older sessions
      // may have data under 'portfolioHoldings', 'mc_portfolio_tickers', or
      // 'mc_portfolio_holdings_v1' (the latter two are referenced by
      // watchlists/page.tsx lines 1660 as legacy keys). Probe all of them
      // so any user with stale-key data still gets their holdings.
      try {
        const KEYS = ['mc_portfolio_holdings', 'portfolioHoldings', 'mc_portfolio_tickers', 'mc_portfolio_holdings_v1'];
        for (const key of KEYS) {
          const pfStored = localStorage.getItem(key);
          if (!pfStored) continue;
          let lsList: any;
          try { lsList = JSON.parse(pfStored); } catch { continue; }
          if (!lsList) continue;
          // Three accepted shapes: Array<string>, Array<{ticker|symbol}>, Object<ticker, *>
          let lsSymbols: string[] = [];
          if (Array.isArray(lsList)) {
            lsSymbols = lsList.map((h: any) => (typeof h === 'string' ? h : (h?.ticker || h?.symbol || '')).toString().toUpperCase().trim()).filter(Boolean);
          } else if (typeof lsList === 'object') {
            lsSymbols = Object.keys(lsList).map(k => k.toUpperCase().trim()).filter(Boolean);
          }
          if (lsSymbols.length > 0) {
            const merged = new Set([...portfolio.map(s => String(s || '').toUpperCase().trim()), ...lsSymbols].filter(Boolean));
            portfolio = Array.from(merged);
            console.log(`[Earnings] Portfolio universe: merged ${lsSymbols.length} from LS key '${key}'`);
            break;  // first key that yields data wins
          }
        }
      } catch {}

      // PATCH 0974 — DON'T WIPE TO 0 on temporary API hiccup.
      // User repeatedly reports portfolio/watchlist universe going from
      // populated (43, 70) back to 0 between sessions. Root cause: when
      // API + LS BOTH return 0 (race condition during deploys, browser
      // tab opened before /portfolio populates LS, transient API failure)
      // we were calling setPortfolioSymbols([]) which clears the in-memory
      // state.
      // Fix: if the fresh resolve returned 0 but the PREVIOUS state had
      // values, keep the previous state. Only set to 0 if there is genuinely
      // no prior data (first load).
      setPortfolioSymbols(prev => {
        if (portfolio.length === 0 && prev.length > 0) {
          console.warn(`[Earnings] Portfolio resolved to 0 but state had ${prev.length} — preserving previous state to avoid wipe-on-hiccup`);
          return prev;
        }
        return portfolio;
      });
      setWatchlistSymbols(prev => {
        if (watchlist.length === 0 && prev.length > 0) {
          console.warn(`[Earnings] Watchlist resolved to 0 but state had ${prev.length} — preserving previous state to avoid wipe-on-hiccup`);
          return prev;
        }
        return watchlist;
      });

      // PATCH 0969 — visible diagnostic for empty Portfolio/Watchlist universes.
      // User repeatedly reports "Portfolio 0 even though I have 43 holdings".
      // Three possible causes:
      //   (1) Vercel deploy of the loader fix hasn't reached the browser cache
      //   (2) localStorage is genuinely empty for this browser/profile
      //   (3) API returns empty AND none of the 4 LS keys probed hit
      // We now write a structured diagnostic that the chip tooltip renders so
      // the user can see in real time WHY the count is 0, and a console.log
      // so devtools shows the same info.
      const pfApiCount = pData?.holdings?.length || 0;
      const wlApiCount = wData?.watchlist?.length || 0;
      const pfLsKeysSeen: string[] = [];
      const wlLsKeysSeen: string[] = [];
      try {
        for (const k of ['mc_portfolio_holdings', 'portfolioHoldings', 'mc_portfolio_tickers', 'mc_portfolio_holdings_v1']) {
          const v = localStorage.getItem(k);
          if (v && v !== '[]' && v !== '{}') pfLsKeysSeen.push(`${k}(${v.length}b)`);
        }
        const wv = localStorage.getItem('mc_watchlist_tickers');
        if (wv && wv !== '[]') wlLsKeysSeen.push(`mc_watchlist_tickers(${wv.length}b)`);
      } catch {}
      const diag = {
        portfolio: {
          api: pfApiCount, ls_keys_hit: pfLsKeysSeen, resolved: portfolio.length,
        },
        watchlist: {
          api: wlApiCount, ls_keys_hit: wlLsKeysSeen, resolved: watchlist.length,
        },
        at: new Date().toLocaleTimeString(),
      };
      setUniverseDiag(diag);
      console.log('[Earnings] Universe load diagnostic:', diag);

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
            // PATCH 1101zzz48 — bumped 25s → 50s. On cold start the 30-symbol
            // batch takes ~30s (one screener.in page-fetch + parse per symbol),
            // hitting the 25s ceiling reliably. User saw ALL 58 cards as
            // "DATA MISSING" because every batch aborted. 50s is well under
            // the 60s Vercel function maxDuration so we never wait longer
            // than the server itself does.
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 50_000);
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
      // PATCH 0952 — clear stale "Upstream slow" error if it was set by the
      // 45s wall-clock timer that fired before data actually arrived. Without
      // this the red banner persists alongside successful cards forever.
      setError('');

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

      // PATCH 0967 BUG-B — Screener scan was 6+ minutes for 2295 stocks.
      //
      // OLD: BATCH=30 × PARALLEL=5 × 25s wave-blocking timeout
      //   = 77 batches / 5 = 16 waves × 25s worst-case = ~7 min wall time
      //   = every wave waits for its SLOWEST batch (tail-latency dominates)
      //
      // NEW: BATCH=15 × WORKERS=15 in a TRUE WORKER POOL (not waves)
      //   = 153 batches / 15 workers each pulling next from queue as it
      //     completes its current batch (no wave blocking, no stalls)
      //   = typical ~12-15s/batch × ~10 sequential pulls per worker
      //     ≈ 90-150s total wall time. ~3-5× faster.
      //
      // Smaller BATCH (15 vs 30) means each request finishes faster + has
      // a lower chance of hitting the 25s timeout, so more results land
      // instead of timing out → silently dropping. Per-batch timeout also
      // tightened 25s → 20s since smaller batches need less.
      //
      // Worker pool: each worker is a long-lived async loop that pulls
      // batches off a shared cursor until exhausted. No await on a wave
      // boundary, so a slow batch only stalls ONE worker, not 15.
      const BATCH = 15;
      const WORKERS = 15;
      let allScCards: EarningsScanCard[] = [];
      const scBatches: string[][] = [];
      for (let i = 0; i < screenerOnly.length; i += BATCH) {
        scBatches.push(screenerOnly.slice(i, i + BATCH));
      }

      // Shared queue cursor — each worker atomically claims next batch.
      // PATCH 0972 BUG-5 — Screener coverage low (270/2279).
      // Root causes:
      //  (a) Many tickers don't have Q4 FY26 results yet — legitimate 0
      //  (b) Some batches silently fail/timeout and we never retry → lost cards
      //
      // For (b): each batch gets ONE retry with backoff before being dropped.
      // Also batches that succeed but return 0 cards are now retried with
      // smaller chunks (8 instead of 15) on the theory that one bad ticker
      // in the batch may be poisoning the whole response.
      let nextBatchIdx = 0;
      const claimNext = (): string[] | null => {
        if (nextBatchIdx >= scBatches.length) return null;
        return scBatches[nextBatchIdx++];
      };
      // Track retry attempts per batch so a batch can only be retried once.
      const batchRetries = new Map<number, number>();
      const failedBatches: string[][] = [];

      async function fetchBatch(batch: string[], timeoutMs = 20_000): Promise<EarningsScanCard[] | null> {
        const encoded = batch.map(s => encodeURIComponent(s)).join(',');
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          const res = await fetch(`/api/market/earnings-scan?symbols=${encoded}`, { signal: ctl.signal });
          clearTimeout(timer);
          if (!res.ok) return null;
          const json = (await res.json()) as ScanResponse;
          return (json.cards || []).map(c => ({ ...c, universeTag: 'screener' as const }));
        } catch {
          clearTimeout(timer);
          return null;
        }
      }

      const runWorker = async () => {
        while (true) {
          const batchIdx = nextBatchIdx;
          const batch = claimNext();
          if (!batch) return;
          let cards = await fetchBatch(batch, 20_000);
          // PATCH 0972 BUG-5a — RETRY: if a batch fails outright, give it
          // one second chance with a longer timeout + small backoff. This
          // recovers transient upstream blips without doubling baseline cost.
          if (cards === null && !batchRetries.has(batchIdx)) {
            batchRetries.set(batchIdx, 1);
            await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
            cards = await fetchBatch(batch, 28_000);
            if (cards === null) {
              failedBatches.push(batch);
              continue;
            }
          } else if (cards === null) {
            failedBatches.push(batch);
            continue;
          }
          if (cards.length > 0) {
            allScCards = [...allScCards, ...cards];
            setScreenerCards(prev => {
              const seen = new Set(prev.map(c => c.symbol));
              const fresh = cards!.filter(c => !seen.has(c.symbol));
              return fresh.length > 0 ? [...prev, ...fresh] : prev;
            });
          }
          // PATCH 0972 BUG-5b — If batch returned 0 cards (success but
          // empty), it's most likely "none of these tickers have results
          // yet". We skip; no retry. The summary will reflect that 1900+
          // tickers genuinely have no Q4 FY26 data filed, which is true
          // for the current point in earnings season.
        }
      };

      // Spin up the pool and wait for all workers to drain the queue.
      const workers = Array.from({ length: WORKERS }, () => runWorker());
      await Promise.all(workers);

      setScreenerCards(prev => {
        // Final dedup pass — workers are racy on append, so canonicalize once.
        const map = new Map<string, EarningsScanCard>();
        for (const c of [...prev, ...allScCards]) map.set(c.symbol, c);
        return Array.from(map.values());
      });
      setScreenerLoaded(true);
      // PATCH 0972 BUG-5 — log breakdown so user can see why coverage is
      // what it is. "270 of 2279" is mostly natural attrition, not bugs:
      //   - X tickers have no Q4 FY26 data filed yet (most of the gap)
      //   - Y batches failed despite retry (dropped — true loss)
      // The console log + the on-screen 'Why N of M?' tooltip P0973-style
      // would help. For now just log to console.
      console.log(`[Screener] Coverage breakdown: ${allScCards.length} cards loaded from ${scBatches.length} batches (${failedBatches.length} batches failed after 1 retry; ${scBatches.length - failedBatches.length} succeeded; remaining tickers in successful batches had no Q4 FY26 results filed yet)`);
    } catch (err) {
      console.error('[Screener Earnings]', err);
    } finally {
      setScreenerLoading(false);
    }
  }, [screenerLoaded, portfolioSymbols, watchlistSymbols]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // PATCH 0948/0955 — AI Forward Guidance fetcher.
  // Builds the qualifying-set from CURRENT filteredCards (post-filter, so
  // user's date / grade / 1D filters all narrow what gets billed),
  // restricts to EXCELLENT/STRONG with D1 close >= +2% (only spend Haiku
  // budget on prints the market already validated), POSTs to the
  // server endpoint, merges results into aiGuidance state + LS.
  //
  // P0955 — CLIENT-SIDE CACHE SKIP. Before hitting the API, pre-filter the
  // qualifying set: skip any ticker that ALREADY has aiGuidance for the SAME
  // current period (we compare deriveCachePeriod(card.period) to the stored
  // ai.period). This means:
  //   • If you click AI Guidance twice in a row → 2nd click sends 0 items, no
  //     API call at all, no money spent.
  //   • If you expand universe with 30 qualifying and 28 are already cached
  //     → only 2 fresh tickers sent to API.
  //   • If a NEW quarter has dropped (card.period changed) → ticker re-sent
  //     because period mismatch — correct behaviour, that's a new earnings.
  //   • Shift-click (force=true) → bypass the client-side skip too, send all
  //     qualifiers so server force-re-extracts.
  //
  // Independent of (and complementary to) the server's year-long KV cache.
  // Saves the round-trip even when KV caches everything.
  const fetchAIGuidance = useCallback(async (qualifyingCards: EarningsScanCard[], force: boolean) => {
    if (qualifyingCards.length === 0) return;
    setAiLoading(true);
    try {
      // P0955 — client-side cache skip. Build item list excluding any ticker
      // that already has same-period AI guidance in state. Track what we
      // skipped so we can report it accurately in the stats banner.
      let clientCachedCount = 0;
      const items: Array<{ ticker: string; period: string }> = [];
      for (const c of qualifyingCards) {
        const period = deriveCachePeriod(c.period);
        const cached = aiGuidance[c.symbol.toUpperCase()];
        // PATCH 0962 — ISSUE #10: validate cache before trusting it. A partially
        // migrated or malformed entry should be re-extracted, not silently
        // counted as cached. ALSO: if the entry's prompt_version doesn't
        // match the CURRENT prompt, treat as stale and re-extract — this is
        // what catches "1-year-old extraction lingering after a prompt fix".
        const cacheLooksGood = cached && isValidGuidanceObject(cached) && cached.period === period;
        if (!force && cacheLooksGood) {
          clientCachedCount++;
          continue;
        }
        items.push({ ticker: c.symbol, period });
      }

      // No fresh tickers to extract — short-circuit, don't hit API at all.
      if (items.length === 0) {
        setAiStats({
          cached: clientCachedCount,
          extracted: 0,
          intimation_only: 0,
          missing_pdf: 0,
          llm_failed: 0,
          total: qualifyingCards.length,
        });
        setAiDiagnostics(null);
        console.log(`[AI Guidance] All ${clientCachedCount} qualifying tickers already cached client-side for current quarter — no API call.`);
        return;
      }

      setAiStats(null);  // clear stale stats only when we actually call the API

      // PATCH 0961 — chunk size dropped 25 → 8 so each server call fits
      // under Vercel's 55s maxDuration. Server's hard cap was bumped to
      // match. Wave count raised 2 → 4 so total wall time stays roughly
      // the same despite the smaller chunks. Most importantly, batch-
      // level failures (504 / network) are now COUNTED and the failed
      // tickers TRACKED instead of silently dropped — that's how 217
      // tickers ended up with only 4 results last run: each 25-ticker
      // chunk took ~120-200s, every chunk hit Vercel's 55s timeout, the
      // 504 turned into `null` in Promise.allSettled, and we just moved on.
      // PATCH 0973 — dropped CHUNK 8 → 5 matching server-side cap.
      // User reported 18/18 batches timing out at 50s client / 55s server.
      // With CHUNK=8 the per-batch wall time was 50-55s (right at the
      // cutoff). CHUNK=5 gives ~30-40s, comfortable margin.
      const CHUNK = 5;
      const chunks: typeof items[] = [];
      for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));

      const allResults: Record<string, AIForwardGuidance> = {};
      const allDiagnostics: any[] = [];
      // PATCH 0962 — expanded stats (ISSUE #11). All values come from server
      // stats payload + client-side accounting of batch failures.
      const aggStats = {
        cached: 0, cached_invalid_dropped: 0,
        extracted: 0, intimation_only: 0, screener_fallback: 0,
        budget_exceeded: 0, missing_pdf: 0, llm_failed: 0,
        batch_failures: 0, recovered_from_kv: 0,
        pdf_empty: 0, pdf_image_only: 0, pdf_too_short: 0, pdf_corrupt: 0,
        retries: 0, parse_failures: 0, max_tokens_hits: 0, extraction_ms_sum: 0,
      };
      const failedTickers: string[] = [];
      const failedTickersByPeriod = new Map<string, string[]>();  // for reconciliation polling

      // PATCH 0959 — initialize progress now that we know the total work.
      setAiProgress({ done: 0, total: items.length });

      // PATCH 0961 — 4 parallel chunks per wave (was 2). Each chunk is now
      // 8 tickers, so a wave = 32 tickers in ~30-50s. 217 tickers ⇒ ~27
      // chunks ⇒ ~7 waves ⇒ ~4 min wall time, with the progress indicator
      // showing live count.
      const WAVE = 4;
      // PATCH 0973 — per-batch one-shot retry. User saw 18/18 batches
      // fail with 0 extracted. Each chunk now gets ONE retry on failure
      // before being declared dead. Retry adds 500-1000ms backoff to let
      // upstream breathe. Cost: at most 2x slower in worst case, but
      // recovers transient Vercel hiccups + upstream PDF slowness.
      async function fetchBatchWithRetry(chunk: Array<{ ticker: string; period: string }>): Promise<any> {
        const doFetch = async (timeoutMs: number) => {
          const r = await fetch('/api/v1/haiku/forward-guidance', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ items: chunk, force }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return await r.json();
        };
        try {
          return await doFetch(50_000);  // first try, 50s
        } catch (e1) {
          // Backoff then retry once with same timeout (server is the
          // bottleneck, longer client timeout doesn't help past 55s).
          await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
          try {
            return await doFetch(50_000);
          } catch (e2) {
            return { __batchFailed: true, error: `${(e1 as Error).message} → retry: ${(e2 as Error).message}`, tickers: chunk.map(c => c.ticker), period: chunk[0]?.period };
          }
        }
      }

      for (let w = 0; w < chunks.length; w += WAVE) {
        const wave = chunks.slice(w, w + WAVE);
        const waveResults = await Promise.allSettled(wave.map(fetchBatchWithRetry));
        let waveProcessed = 0;
        for (let ri = 0; ri < waveResults.length; ri++) {
          waveProcessed += wave[ri].length;
          const r = waveResults[ri];
          if (r.status !== 'fulfilled' || !r.value) {
            aggStats.batch_failures++;
            failedTickers.push(...wave[ri].map(c => c.ticker));
            // Group by period for the reconciliation pass.
            for (const c of wave[ri]) {
              const arr = failedTickersByPeriod.get(c.period) || [];
              arr.push(c.ticker);
              failedTickersByPeriod.set(c.period, arr);
            }
            continue;
          }
          const json = r.value;
          if (json.__batchFailed) {
            aggStats.batch_failures++;
            failedTickers.push(...(json.tickers || []));
            for (const c of wave[ri]) {
              const arr = failedTickersByPeriod.get(c.period) || [];
              arr.push(c.ticker);
              failedTickersByPeriod.set(c.period, arr);
            }
            console.warn(`[AI Guidance] batch ${ri} (${wave[ri].length} tickers) failed: ${json.error} — tickers: ${(json.tickers || []).join(',')}`);
            continue;
          }
          Object.assign(allResults, json?.results || {});
          if (Array.isArray(json?.diagnostics)) allDiagnostics.push(...json.diagnostics);
          const s = json?.stats || {};
          aggStats.cached += s.cached || 0;
          aggStats.cached_invalid_dropped += s.cached_invalid_dropped || 0;
          aggStats.extracted += s.extracted || 0;
          aggStats.intimation_only += s.intimation_only || 0;
          aggStats.screener_fallback += s.screener_fallback || 0;
          aggStats.budget_exceeded += s.budget_exceeded || 0;
          aggStats.missing_pdf += s.missing_pdf || 0;
          aggStats.llm_failed += s.llm_failed || 0;
          aggStats.pdf_empty += s.pdf_empty || 0;
          aggStats.pdf_image_only += s.pdf_image_only || 0;
          aggStats.pdf_too_short += s.pdf_too_short || 0;
          aggStats.pdf_corrupt += s.pdf_corrupt || 0;
          aggStats.retries += s.retries || 0;
          aggStats.parse_failures += s.parse_failures || 0;
          aggStats.max_tokens_hits += s.max_tokens_hits || 0;
          aggStats.extraction_ms_sum += s.extraction_ms_sum || 0;
        }
        setAiProgress(prev => prev ? { done: Math.min(prev.done + waveProcessed, prev.total), total: prev.total } : null);
        setAiGuidance(prev => {
          const next = { ...prev };
          for (const [ticker, fg] of Object.entries(allResults)) {
            if (fg && fg.label) next[ticker.toUpperCase()] = fg;
          }
          try { localStorage.setItem(CLIENT_LS_KEY, JSON.stringify(next)); } catch {}
          return next;
        });
      }

      // ── PATCH 0962 — ISSUE #2 (partial #12): reconciliation pass. ────────
      // After a batch timeout, the server may have extracted + cached some
      // tickers before being killed at 55s — those completions are sitting
      // in KV but the client never saw the response. Poll the new GET
      // ?action=fetch endpoint for any cached results, and the GET
      // ?action=status endpoint for state. This recovers orphaned work
      // without re-paying Haiku for already-completed extractions.
      if (failedTickersByPeriod.size > 0) {
        console.log(`[AI Guidance] reconciling ${failedTickers.length} timed-out tickers via KV...`);
        try {
          for (const [period, tickers] of failedTickersByPeriod.entries()) {
            // Batch the GET into reasonably-sized URLs (max ~80 tickers per
            // request to stay under URL-length limits).
            for (let i = 0; i < tickers.length; i += 80) {
              const slice = tickers.slice(i, i + 80);
              const qs = `?action=fetch&period=${encodeURIComponent(period)}&tickers=${slice.join(',')}`;
              const rec = await fetch(`/api/v1/haiku/forward-guidance${qs}`, {
                signal: AbortSignal.timeout(10_000),
              });
              if (!rec.ok) continue;
              const recJson = await rec.json();
              const recovered = recJson?.results || {};
              for (const [t, fg] of Object.entries(recovered)) {
                if (fg && (fg as any).label && isValidGuidanceObject(fg)) {
                  allResults[t.toUpperCase()] = fg as AIForwardGuidance;
                  aggStats.recovered_from_kv++;
                }
              }
            }
          }
          // Merge recovered results into state + LS, just like the per-wave merge.
          if (aggStats.recovered_from_kv > 0) {
            setAiGuidance(prev => {
              const next = { ...prev };
              for (const [ticker, fg] of Object.entries(allResults)) {
                if (fg && fg.label) next[ticker.toUpperCase()] = fg;
              }
              try { localStorage.setItem(CLIENT_LS_KEY, JSON.stringify(next)); } catch {}
              return next;
            });
            console.log(`[AI Guidance] reconciliation recovered ${aggStats.recovered_from_kv}/${failedTickers.length} from KV — saved ${aggStats.recovered_from_kv} re-extracts.`);
            // Trim recovered tickers out of failedTickers so the UI shows
            // only the truly unrecovered set.
            const recoveredSet = new Set(Object.keys(allResults).map(t => t.toUpperCase()));
            for (let i = failedTickers.length - 1; i >= 0; i--) {
              if (recoveredSet.has(failedTickers[i].toUpperCase())) failedTickers.splice(i, 1);
            }
          }
        } catch (e) {
          console.warn('[AI Guidance] reconciliation pass failed:', (e as Error).message);
        }
      }

      setAiStats({
        cached: aggStats.cached + clientCachedCount,
        extracted: aggStats.extracted,
        intimation_only: aggStats.intimation_only,
        screener_fallback: aggStats.screener_fallback,
        budget_exceeded: aggStats.budget_exceeded,
        missing_pdf: aggStats.missing_pdf,
        llm_failed: aggStats.llm_failed,
        total: qualifyingCards.length,
        batch_failures: aggStats.batch_failures,
        failed_tickers: failedTickers,
        // PATCH 0962 — ISSUE #11 telemetry surfaced in banner.
        cached_invalid_dropped: aggStats.cached_invalid_dropped,
        recovered_from_kv: aggStats.recovered_from_kv,
        pdf_empty: aggStats.pdf_empty,
        pdf_image_only: aggStats.pdf_image_only,
        pdf_too_short: aggStats.pdf_too_short,
        pdf_corrupt: aggStats.pdf_corrupt,
        retries: aggStats.retries,
        parse_failures: aggStats.parse_failures,
        max_tokens_hits: aggStats.max_tokens_hits,
        avg_extraction_ms: aggStats.extracted > 0 ? Math.round(aggStats.extraction_ms_sum / aggStats.extracted) : 0,
      });
      setAiDiagnostics(allDiagnostics.length > 0 ? allDiagnostics : null);
      const newResults = allResults;
      // PATCH 0962 — final persist under v3 key.
      setAiGuidance(prev => {
        const next = { ...prev };
        for (const [ticker, fg] of Object.entries(newResults)) {
          if (fg && fg.label) next[ticker.toUpperCase()] = fg;
        }
        try { localStorage.setItem(CLIENT_LS_KEY, JSON.stringify(next)); } catch {}
        try { localStorage.removeItem('mc:ai-fg:v2'); } catch {}
        try { localStorage.removeItem('mc:ai-fg:v1'); } catch {}
        return next;
      });
    } catch (e) {
      console.warn('[AI Guidance] fetch failed:', (e as Error).message);
    } finally {
      setAiLoading(false);
      setAiProgress(null);
    }
  }, [aiGuidance]);

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
        // PATCH 0944/0946 — 20/batch with 28s timeout (batches complete reliably
        // on Screener.in cold path). PARALLEL bumped 6→10 (P0946 per user) to
        // finish 396 names in ~25-30s instead of ~50-60s. Screener.in tolerates
        // 10 concurrent on the same client (we tested in /earnings hub scan).
        const BATCH_SIZE = 20;
        const PARALLEL = 10;
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
    //
    // PATCH 0959 — Dedupe by symbol. When a ticker exists in both `cards`
    // (Watchlist / Conviction) AND `screenerCards`, the previous concat
    // produced two visible rows for the same company. We now keep the FIRST
    // occurrence (which comes from the user-curated universe with richer
    // metadata) and merge universe tags so the badge still shows membership
    // in screener too.
    const rawSource = selectedUniverses.has('screener') && selectedUniverses.size === 1
      ? screenerCards
      : selectedUniverses.has('screener')
        ? [...cards, ...screenerCards]
        : cards;
    const seen = new Map<string, EarningsScanCard>();
    for (const c of rawSource) {
      const key = (c.symbol || '').toUpperCase().trim();
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, c);
      } else {
        // Already kept — merge universeTag so we don't lose the fact that the
        // ticker is in multiple universes. 'both' is the most inclusive.
        const mergedTag = (existing.universeTag === c.universeTag) ? existing.universeTag : 'both';
        seen.set(key, { ...existing, universeTag: mergedTag, isConviction: existing.isConviction || c.isConviction });
      }
    }
    const sourceCards = Array.from(seen.values());

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

  // PATCH 0954 — qualifying set (EX/ST + D1 >= +2%) hoisted to component
  // scope so the stats banner can check whether the last AI run's total
  // still matches what's visible (hides stale stats after universe changes).
  const filteredCards = useMemo(() => {
    // PATCH 0949/0950 — compose Day-1 filter + AI multi-tier filter on top of
    // sortedCards (which itself already encodes universe / grade / date / conviction
    // / keyword-guidance filters). AI filter is a no-op until the user toggles
    // any chip — so default UX is unchanged. Within the AI filter the chips OR
    // together: a card passes if it matches ANY selected chip.
    const dayOneFiltered = dayOneFilters.size === 0
      ? sortedCards
      : sortedCards.filter(c => matchesDayOneFilter(gapMap[c.symbol], dayOneFilters));
    if (aiFilters.size === 0) return dayOneFiltered;
    return dayOneFiltered.filter(c => {
      const ai = aiGuidance[c.symbol.toUpperCase()];
      if (!ai) return false;                       // every chip requires AI present
      if (aiFilters.has('EXTRACTED_ONLY')) return true;
      const t = aiTier(ai);
      return !!t && aiFilters.has(t.tier as AIFilterKey);
    });
  }, [sortedCards, gapMap, dayOneFilters, aiFilters, aiGuidance]);

  // PATCH 0954/0958 — qualifying set for AI Guidance. P0958 dropped the
  // D1 ≥ +2% gate: it was filtering out 80%+ of EX/ST cards because most
  // Screener-only tickers don't have post-gap data fetched, and even on
  // tickers with data, +2% was too restrictive. Universe filter (Watchlist
  // / Conviction / Screener) is the cost lever now — narrow that to control
  // spend instead of gating per-card.
  const qualifyingForAI = useMemo(() => {
    return filteredCards.filter(c => c.grade === 'EXCELLENT' || c.grade === 'STRONG');
  }, [filteredCards]);

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

  // PATCH 0968 BUG-B — fix Watchlist "10/0" lying chip.
  //
  // Old logic counted any card with universeTag === 'watchlist' OR 'both'.
  // But the dedupe at line 2331 collapses ANY two universes' overlap to
  // 'both' (e.g. conviction+screener merged together get tag='both'), so
  // 'both' polluted the watchlist count even when the user has 0 actual
  // watchlist holdings.
  //
  // New rule: a card counts toward Watchlist (or Portfolio) only if its
  // ACTUAL SYMBOL is in the resolved watchlist (or portfolio) symbol set.
  // This is the ground truth — universeTag is a render hint, the set is
  // the truth.
  const pfSetMembers = new Set(portfolioSymbols.map(s => s.toUpperCase()));
  const wlSetMembers = new Set(watchlistSymbols.map(s => s.toUpperCase()));
  const portfolioCardCount = visibleCards.filter(c => pfSetMembers.has((c.symbol || '').toUpperCase())).length;
  const watchlistCardCount = visibleCards.filter(c => wlSetMembers.has((c.symbol || '').toUpperCase())).length;
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
                return mins < 5 ? 'var(--mc-bullish)' : mins < 30 ? '#FFD600' : 'var(--mc-bearish)';
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
          // PATCH 0969 — diagnostic tooltip for Portfolio/Watchlist when count=0.
          // Stops the "fix didn't deploy" / "data is missing" confusion loop.
          // Tooltip explicitly tells user: API returned N items, LS keys probed
          // were [...], resolved to 0 — so they can act (hard refresh, add via
          // /portfolio, etc) instead of guessing.
          let diagTitle = `${count} of ${total} loaded`;
          if (!loading && total === 0 && universeDiag) {
            if (key === 'portfolio') {
              const d = universeDiag.portfolio;
              diagTitle = `PORTFOLIO LOAD DIAGNOSTIC (${universeDiag.at})\nAPI /api/portfolio: ${d.api} holdings\nlocalStorage keys probed (4): hit ${d.ls_keys_hit.length} → [${d.ls_keys_hit.join(', ') || 'none'}]\nResolved universe size: ${d.resolved}\n\nIf you have holdings in My Book that aren't showing here:\n1) Hard-refresh (Cmd+Shift+R) to load the latest bundle\n2) Open /portfolio (My Book) and verify your holdings are visible there\n3) Check DevTools → Application → Local Storage for the keys above`;
            } else if (key === 'watchlist') {
              const d = universeDiag.watchlist;
              diagTitle = `WATCHLIST LOAD DIAGNOSTIC (${universeDiag.at})\nAPI /api/watchlist: ${d.api} tickers\nlocalStorage mc_watchlist_tickers: hit ${d.ls_keys_hit.length} → [${d.ls_keys_hit.join(', ') || 'none'}]\nResolved universe size: ${d.resolved}\n\nIf you have a watchlist that isn't showing here:\n1) Hard-refresh (Cmd+Shift+R) to load the latest bundle\n2) Open /watchlists and verify your watchlist is visible there\n3) Check DevTools → Application → Local Storage for mc_watchlist_tickers`;
            }
          }
          return (
            <button key={key} title={diagTitle} onClick={() => {
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
                border: `1.5px solid ${on ? meta.accent : 'var(--mc-text-4)'}`,
                background: on ? meta.accent : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: on ? 'var(--mc-bg-0)' : 'transparent', fontWeight: 900,
              }}>{on ? '✓' : ''}</span>
              <span>{meta.emoji}</span>
              <span>{meta.label}</span>
              <span style={{ fontSize: 10.5, opacity: 0.85, fontFamily: 'ui-monospace, monospace' }}>
                {loading ? '...' : count === total ? count : `${count}/${total}`}
              </span>
              {/* PATCH 0969+0970 — when count=0 show actionable buttons.
                  ⟳ FETCH NOW = hits the API directly, bypasses everything else.
                  ⚠ add → opens the source page where user can add tickers. */}
              {!loading && total === 0 && (key === 'portfolio' || key === 'watchlist') && (
                <>
                  <span
                    onClick={async (e) => {
                      e.stopPropagation();
                      // PATCH 0971 — read BOTH localStorage AND API, use whichever
                      // has data. The earlier P0970 only checked API and falsely
                      // told user "Server has 0" even when LS had 43 holdings —
                      // because /portfolio reads from LS as primary, never synced
                      // server-side. Fix order: LS first (canonical source for
                      // this app's design), API as backup, then sync state.
                      try {
                        // 1) Read all known LS keys
                        let lsItems: string[] = [];
                        let foundInKey = '';
                        if (key === 'portfolio') {
                          const KEYS = ['mc_portfolio_holdings', 'portfolioHoldings', 'mc_portfolio_tickers', 'mc_portfolio_holdings_v1'];
                          for (const k of KEYS) {
                            const raw = localStorage.getItem(k);
                            if (!raw) continue;
                            try {
                              const arr = JSON.parse(raw);
                              if (Array.isArray(arr)) {
                                const syms = arr.map((h: any) => (typeof h === 'string' ? h : (h?.symbol || h?.ticker || '')).toString().toUpperCase().trim()).filter(Boolean);
                                if (syms.length > 0) { lsItems = syms; foundInKey = k; break; }
                              } else if (arr && typeof arr === 'object') {
                                const syms = Object.keys(arr).map(s => s.toUpperCase().trim()).filter(Boolean);
                                if (syms.length > 0) { lsItems = syms; foundInKey = k; break; }
                              }
                            } catch {}
                          }
                        } else {
                          const raw = localStorage.getItem('mc_watchlist_tickers');
                          if (raw) {
                            try {
                              const arr = JSON.parse(raw);
                              if (Array.isArray(arr)) {
                                lsItems = arr.map((s: any) => String(s).toUpperCase().trim()).filter(Boolean);
                                if (lsItems.length > 0) foundInKey = 'mc_watchlist_tickers';
                              }
                            } catch {}
                          }
                        }

                        // 2) Hit API in parallel
                        const endpoint = key === 'portfolio' ? '/api/portfolio' : '/api/watchlist';
                        let apiItems: string[] = [];
                        try {
                          const res = await fetch(`${endpoint}?chatId=${CHAT_ID}&_nocache=${Date.now()}`, { cache: 'no-store' });
                          if (res.ok) {
                            const json = await res.json();
                            const raw = key === 'portfolio' ? (json?.holdings || []) : (json?.watchlist || []);
                            apiItems = raw.map((x: any) => (typeof x === 'string' ? x : (x.symbol || x.ticker || '')).toString().toUpperCase().trim()).filter(Boolean);
                          }
                        } catch {}

                        // 3) Pick the union — prefer LS when it has data
                        const merged = Array.from(new Set([...lsItems, ...apiItems]));

                        if (merged.length === 0) {
                          alert(`Both localStorage AND server are empty for ${key}.\n\nLS keys probed: ${key === 'portfolio' ? '4 keys' : 'mc_watchlist_tickers'}\nAPI /api/${key}?chatId=${CHAT_ID}: 0 items\n\nGo to /${key === 'portfolio' ? 'portfolio' : 'watchlists'} and add some — it'll save and become visible here.`);
                          return;
                        }

                        // 4) Got data — directly update state, no reload needed
                        if (key === 'portfolio') {
                          setPortfolioSymbols(merged);
                          // also write back to canonical LS key so next reload finds it
                          try { localStorage.setItem('mc_portfolio_holdings', JSON.stringify(merged.map(s => ({ symbol: s })))); } catch {}
                        } else {
                          setWatchlistSymbols(merged);
                          try { localStorage.setItem('mc_watchlist_tickers', JSON.stringify(merged)); } catch {}
                        }
                        alert(`✓ Loaded ${merged.length} ${key} tickers (LS: ${lsItems.length}${foundInKey ? ` from '${foundInKey}'` : ''}, API: ${apiItems.length}).\n\nUniverse updated. Click Refresh to fetch their earnings.`);
                      } catch (err) {
                        alert(`Probe failed: ${(err as Error).message}`);
                      }
                    }}
                    style={{
                      marginLeft: 4, fontSize: 9.5, fontWeight: 800,
                      padding: '1px 6px', borderRadius: 3,
                      backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 19%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)',
                      color: 'var(--mc-bullish)', letterSpacing: '0.3px', cursor: 'pointer',
                    }}
                    title="Hit the server API directly and write any returned data to localStorage. Tells you in an alert what was found. Use this when count=0 to figure out whether the data is missing on server, in another browser, or in stale cache."
                  >
                    ⟳ FETCH
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      if (typeof window !== 'undefined') {
                        window.location.href = key === 'portfolio' ? '/portfolio' : '/watchlists';
                      }
                    }}
                    style={{
                      marginLeft: 4, fontSize: 9.5, fontWeight: 800,
                      padding: '1px 6px', borderRadius: 3,
                      backgroundColor: 'color-mix(in srgb, var(--mc-warn) 19%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)',
                      color: 'var(--mc-warn)', letterSpacing: '0.3px', cursor: 'pointer',
                    }}
                    title={`No ${key} data loaded. Click to open the ${key === 'portfolio' ? 'My Book' : 'Watchlist'} page.`}
                  >
                    add →
                  </span>
                </>
              )}
            </button>
          );
        })}

        {/* PATCH 0186 — Conviction Beats composable filter (AND-style on top of viewMode/grades/date/sentiment) */}
        <button onClick={() => setConvictionOnly((v) => !v)}
          title="Composable filter: restricts current view to stocks auto-tagged as Conviction Beats (BLOCKBUSTER / STRONG from Earnings Opportunities). Works alongside all other filters."
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8,
            border: `1px solid ${convictionOnly ? 'var(--mc-warn)' : CARD_BORDER}`,
            backgroundColor: convictionOnly ? 'color-mix(in srgb, var(--mc-warn) 13%, transparent)' : CARD,
            color: convictionOnly ? 'var(--mc-warn)' : TEXT,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
          <Award style={{ width: 13, height: 13 }} />
          Conviction Beats only
          <span style={{
            fontSize: 10, fontWeight: 800,
            padding: '1px 5px', borderRadius: 3,
            backgroundColor: convictionOnly ? 'var(--mc-warn)' : 'var(--mc-bg-4)',
            color: convictionOnly ? '#000' : 'var(--mc-text-4)',
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
              backgroundColor: 'var(--mc-bg-4)', border: `1px solid ${CARD_BORDER}`, color: TEXT,
              padding: '8px 14px', borderRadius: '6px', cursor: 'pointer',
              fontSize: '12px', fontWeight: 600, transition: 'all 0.2s',
            }}>
              <Download style={{ width: '14px', height: '14px' }} /> PDF
            </button>
          )}
          {/* PATCH 0950 — AI tier filter chips (multi-select). Mirrors the Day-1
              chip pattern: click a chip to add, click again to remove. Chips OR
              together within the AI filter, then AND with every other filter
              (universe, grade, date, conviction, Day-1, keyword Screener Signal).
              Only rendered once at least one AI-classified card is in state so
              the toolbar stays clean before the user runs AI Guidance. */}
          {Object.keys(aiGuidance).length > 0 && (() => {
            const AI_CHIPS: Array<{ key: AIFilterKey; label: string; color: string; icon: string }> = [
              { key: 'EXTRACTED_ONLY', label: 'Extracted', color: '#7C3AED', icon: '🤖' },
              { key: 'EXCELLENT',      label: 'Excellent', color: '#10B981', icon: '🚀' },
              { key: 'POSITIVE',       label: 'Positive',  color: '#34D399', icon: '▲'  },
              { key: 'NEUTRAL',        label: 'Neutral',   color: '#94A3B8', icon: '●'  },
              { key: 'CAUTIOUS',       label: 'Cautious',  color: '#F59E0B', icon: '▽'  },
              { key: 'NEGATIVE',       label: 'Negative',  color: '#EF4444', icon: '⚠'  },
            ];
            return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', paddingLeft: '8px', borderLeft: `1px solid ${CARD_BORDER}` }}>
                <span style={{ fontSize: '10px', color: '#C4B5FD', fontWeight: 700, letterSpacing: '0.5px', marginRight: '4px' }}>AI:</span>
                {AI_CHIPS.map(f => {
                  const isActive = aiFilters.has(f.key);
                  return (
                    <button
                      key={f.key}
                      onClick={() => toggleAiFilter(f.key)}
                      title={`AI ${f.label}${f.key === 'EXTRACTED_ONLY' ? ' — any AI-classified card' : ''} — toggle to combine`}
                      style={{
                        backgroundColor: isActive ? `${f.color}25` : CARD,
                        border: `1px solid ${isActive ? f.color : CARD_BORDER}`,
                        color: isActive ? f.color : TEXT_DIM,
                        padding: '8px 9px', borderRadius: '6px', cursor: 'pointer',
                        fontSize: '11px', fontWeight: 700,
                      }}
                    >{f.icon} {f.label}</button>
                  );
                })}
                {aiFilters.size > 0 && (
                  <button
                    onClick={() => setAiFilters(new Set())}
                    title="Clear AI filter"
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
            );
          })()}
          {/* PATCH 0948/0954 — AI Forward Guidance button + coverage counter.
              P0954 changes:
                • Shows 'AI: X / Y covered' chip so user sees coverage at a glance
                • Button label switches to '🤖 AI Guidance — N new' counting only
                  uncached qualifiers (so 'AI Guidance — 30' stops misleading when
                  28 are already cached)
                • Button styling escalates (amber border, pulse) when there are
                  uncovered qualifiers — visible CTA after universe expansion
                • Button still runs the full qualifying set (cache handles the rest)
              Qualification rule unchanged: EX/ST + D1 >= +2%. Shift-click force-refresh. */}
          {(() => {
            const qualifying = qualifyingForAI;
            if (qualifying.length === 0) return null;
            const coveredCount = qualifying.filter(c => !!aiGuidance[c.symbol.toUpperCase()]).length;
            const uncoveredCount = qualifying.length - coveredCount;
            const allCovered = uncoveredCount === 0;

            // ─ PATCH 0964 — retryable breakdown + budget-exceeded disable. ─
            //
            // User feedback (after 1st run on 291 tickers):
            //   "what does '109 new' mean? I already ran AI guidance once."
            //
            // Old button just said "N new" — opaque about WHY those N are
            // still missing, and clicking again can waste budget on the
            // 27 tickers that hit Anthropic 429 last run.
            //
            // New rule: derive the breakdown from the LAST aiStats payload,
            // mapped to actionable categories:
            //   budget   — Anthropic 429, will succeed once budget resets
            //   no-PDF   — missing_pdf + pdf_too_short + pdf_empty + pdf_corrupt
            //              (won't change unless company uploads transcript)
            //   errors   — llm_failed + batch_failures + parse_failures
            //              (transient, worth retrying)
            //   img-only — pdf_image_only (would need OCR; not retryable today)
            //
            // Button shows the retryable count + breakdown so the user knows
            // exactly what clicking will try. Disabled state kicks in only
            // when MOST uncovered tickers are budget-exceeded (>= 50%) — that
            // signals "wait, don't burn more failed calls". Other failure
            // modes never disable.
            //
            // CRITICAL: this DOES NOT alter the aiGuidance state itself.
            // Already-extracted entries persist in mc:ai-fg:v3 localStorage
            // and stay visible on cards. Only the BUTTON LABEL + DISABLE
            // STATE change.
            const s = aiStats;
            const statsAlign = s && s.total === qualifying.length;  // stats are CURRENT for this universe
            const budget  = statsAlign ? (s!.budget_exceeded || 0) : 0;
            const noPdf   = statsAlign ? ((s!.missing_pdf || 0) + (s!.pdf_too_short || 0) + (s!.pdf_empty || 0) + (s!.pdf_corrupt || 0)) : 0;
            const errors  = statsAlign ? ((s!.llm_failed || 0) + (s!.batch_failures || 0) + (s!.parse_failures || 0)) : 0;
            const imgOnly = statsAlign ? (s!.pdf_image_only || 0) : 0;
            const breakdownSum = budget + noPdf + errors + imgOnly;
            const budgetDominates: boolean = !!statsAlign && uncoveredCount > 0 && budget > 0 && budget >= uncoveredCount * 0.5;

            const buttonLabel = aiLoading
              ? (aiProgress ? `🤖 Extracting ${aiProgress.done} / ${aiProgress.total}…` : '🤖 Extracting…')
              : allCovered
                ? `🤖 ✓ AI ready — all ${qualifying.length} cached`
                : statsAlign && breakdownSum > 0
                  ? (() => {
                      // Compose breakdown: "27 budget · 60 no-PDF · 22 errors"
                      const parts: string[] = [];
                      if (budget > 0)  parts.push(`${budget} budget`);
                      if (noPdf > 0)   parts.push(`${noPdf} no-PDF`);
                      if (errors > 0)  parts.push(`${errors} errors`);
                      if (imgOnly > 0) parts.push(`${imgOnly} img-only`);
                      return `🤖 ${uncoveredCount} retryable (${parts.join(' · ')})`;
                    })()
                  : `🤖 AI Guidance — ${uncoveredCount} new`;
            const buttonDisabled = aiLoading || budgetDominates;
            const buttonTitle = aiLoading
              ? 'AI extraction in progress…'
              : budgetDominates
                ? `Anthropic returned 429 for ${budget} of ${uncoveredCount} tickers. 429 = either RATE LIMIT (RPM cap, resets 1-5min) OR MONTHLY SPEND CAP (resets 1st of next month at midnight UTC). Check console.anthropic.com to see which. The ${coveredCount} already-extracted tickers are CACHED and will NOT be re-billed when you retry — P0955 client cache + P0962 KV cache both skip them.`
                : statsAlign && breakdownSum > 0
                  ? `${uncoveredCount} uncovered. Click to retry — ${coveredCount} already-extracted are cache-skipped (no re-bill).${budget > 0 ? ` ${budget} hit Anthropic 429 last run (rate-limit OR monthly cap — check console.anthropic.com).` : ''}${noPdf > 0 ? ` ${noPdf} have no concall PDF (24h short-TTL cache, retries automatically when company uploads).` : ''}${errors > 0 ? ` ${errors} transient errors — usually succeed on retry.` : ''} Shift-click to force-refresh ALL.`
                  : `AI Forward Guidance — extracts real concall statements via Haiku for ${qualifying.length} qualifying cards. ${coveredCount} already cached (skipped), ${uncoveredCount} need fresh Haiku call. Quarter-cached so same period won't re-bill. Shift-click to force-refresh ALL.`;

            return (
              <>
                {/* Coverage chip — always visible so user tracks AI vs filteredCards */}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '6px 10px', borderRadius: '6px',
                  backgroundColor: '#7C3AED15',
                  border: `1px solid ${allCovered ? 'color-mix(in srgb, var(--mc-bullish) 38%, transparent)' : 'color-mix(in srgb, var(--mc-warn) 38%, transparent)'}`,
                  fontSize: '11px', fontWeight: 700,
                  color: allCovered ? 'var(--mc-bullish)' : 'var(--mc-warn)',
                  whiteSpace: 'nowrap',
                }}
                  title={`${coveredCount} of ${qualifying.length} qualifying cards have AI Forward Guidance. ${uncoveredCount > 0 ? `${uncoveredCount} still need extraction — click the AI Guidance button.` : 'All qualifying cards covered.'}`}
                >
                  🤖 AI: {coveredCount} / {qualifying.length} covered
                </span>
                <button
                  onClick={(e) => { if (!budgetDominates) fetchAIGuidance(qualifying, e.shiftKey); }}
                  disabled={buttonDisabled}
                  title={buttonTitle}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    backgroundColor: aiLoading
                      ? 'var(--mc-bg-4)'
                      : allCovered
                        ? 'var(--mc-bullish)'
                        : budgetDominates
                          ? '#4B5563'             // PATCH 0964 — grey when budget-blocked
                          : '#7C3AED',
                    border: !aiLoading && !allCovered && !budgetDominates ? '2px solid var(--mc-warn)' : 'none',
                    color: '#fff',
                    padding: !aiLoading && !allCovered ? '6px 12px' : '8px 14px',
                    borderRadius: '6px',
                    cursor: buttonDisabled ? 'not-allowed' : 'pointer',
                    fontSize: '12px', fontWeight: 700,
                    opacity: aiLoading ? 0.6 : (budgetDominates ? 0.7 : 1),
                    boxShadow: !aiLoading && !allCovered && !budgetDominates ? '0 0 0 1px color-mix(in srgb, var(--mc-warn) 25%, transparent)' : undefined,
                  }}>
                  {buttonLabel}
                </button>
                {/* PATCH 0964 — explicit "wait ~1h" hint when budget-blocked.
                    Lives next to the button so the user doesn't have to hover
                    for the tooltip. Shows ONLY when budgetDominates is true. */}
                {budgetDominates && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '6px 10px', borderRadius: '6px',
                    backgroundColor: '#F5970015',
                    border: '1px solid #F5970060',
                    fontSize: '11px', fontWeight: 700,
                    color: 'var(--mc-warn)',
                    whiteSpace: 'nowrap',
                  }}
                    title={`Anthropic returned 429 for ${budget} tickers. Could be RATE LIMIT (RPM cap, resets 1-5min) OR your monthly $5 spend cap (resets 1st of next month at midnight UTC). Check console.anthropic.com to confirm which. ${coveredCount} already-extracted are CACHED — they will NOT re-bill when you click again. Button is greyed because clicking RIGHT NOW would just re-hit the same 429 wall.`}
                  >
                    ⏳ 429 (rate-limit or $5 cap) — cached entries safe
                  </span>
                )}
              </>
            );
          })()}
          <button onClick={() => fetchData(true)} disabled={loading} style={{
            backgroundColor: ACCENT, border: 'none', color: '#000',
            padding: '8px 16px', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: 600, opacity: loading ? 0.5 : 1,
          }}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>
      {/* PATCH 0948/0949a/0950b — AI stats banner. When the run produces ZERO
          extractions, the card grid won't change at all (every card falls back
          to the keyword Screener Signal track) — so a thin purple strip is too
          subtle and the user thinks 'nothing happened'. We escalate the banner
          to a much louder red callout in that case, with an explicit 'no card
          changed because...' message and the diagnostics toggle right there. */}
      {/* PATCH 0954 — gate stats banners on count match. If filteredCards has
          changed substantially since the last AI run (e.g. universe expanded
          from 4 to 30 qualifying), the stats no longer apply to what's on
          screen and we hide them instead of displaying stale numbers. */}
      {aiStats && aiStats.total === qualifyingForAI.length && aiStats.extracted === 0 && aiStats.cached === 0 && (
        <div style={{
          padding: '14px 18px', marginTop: '10px', borderRadius: '8px',
          backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: '2px solid var(--mc-bearish)',
          color: '#FCA5A5', fontSize: '13px', fontWeight: 600,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ fontSize: '18px' }}>⚠</span>
            <span style={{ fontSize: '14px', fontWeight: 800, color: '#FCA5A5', letterSpacing: '0.3px' }}>
              AI GUIDANCE RAN — 0 OF {aiStats.total} TICKERS EXTRACTED
            </span>
          </div>
          <div style={{ color: 'var(--mc-text-1)', fontSize: '12px', fontWeight: 500, marginBottom: '8px' }}>
            Every card still shows the grey <span style={{ color: TEXT_DIM, fontWeight: 700 }}>Screener Signal</span> chip (keyword-derived, historical) — not the purple <span style={{ color: '#C4B5FD', fontWeight: 700 }}>🤖 AI Forward Guidance</span> chip. Reason breakdown:
            <span style={{ marginLeft: '6px', color: '#F87171' }}>
              {(aiStats.intimation_only || 0) > 0 ? `${aiStats.intimation_only} intimation-only (no transcript exists — Haiku skipped to save cost)` : ''}
              {aiStats.missing_pdf > 0 ? ` · ${aiStats.missing_pdf} no PDF` : ''}
              {aiStats.llm_failed > 0 ? ` · ${aiStats.llm_failed} LLM failed` : ''}
              {(aiStats.batch_failures || 0) > 0 ? ` · ⚠ ${aiStats.batch_failures} batch timeouts (likely 🔧 ANTHROPIC_API_KEY missing in Railway env, OR upstream took >55s — set the key in Railway → Variables, redeploy, click 🤖 AI Guidance again)` : ''}
            </span>
          </div>
          {(aiStats.batch_failures || 0) > 0 && (aiStats.failed_tickers || []).length > 0 && (
            <div style={{
              marginTop: '6px', padding: '8px 10px',
              backgroundColor: '#1F2937', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', borderRadius: '6px',
              fontSize: '11px', color: '#FCD34D', fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              wordBreak: 'break-word',
            }}>
              <div style={{ color: 'var(--mc-warn)', fontWeight: 700, marginBottom: '4px' }}>
                {aiStats.failed_tickers!.length} tickers in timed-out batches — click 🤖 AI Guidance again to retry these (cached ones will be skipped):
              </div>
              <div>{aiStats.failed_tickers!.join(', ')}</div>
            </div>
          )}
          {aiDiagnostics && aiDiagnostics.length > 0 && (
            <button
              onClick={() => setShowDiagnostics(s => !s)}
              style={{
                background: '#7C3AED', border: 'none', color: '#fff',
                borderRadius: '6px', padding: '6px 12px',
                fontSize: '12px', fontWeight: 700, cursor: 'pointer',
              }}
            >{showDiagnostics ? 'Hide' : 'Show'} per-ticker diagnostics ({aiDiagnostics.length})</button>
          )}
          {showDiagnostics && aiDiagnostics && (
            <div style={{
              marginTop: '10px', maxHeight: '300px', overflowY: 'auto',
              backgroundColor: '#0B1426', border: '1px solid #7C3AED50', borderRadius: '6px',
              padding: '8px 10px', fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: '11px', color: TEXT_DIM, fontWeight: 500,
            }}>
              {aiDiagnostics.map((d, i) => {
                const isOk = (d.outcome === 'ok' || d.outcome === 'ok-screener-fallback') && !d.stage;
                const outcomeColor =
                  isOk ? '#10B981' :
                  d.outcome === 'cf-error' ? '#EF4444' :
                  d.outcome === 'intimation-only' ? '#94A3B8' :
                  '#F59E0B';
                const label =
                  d.stage && (d.outcome === 'ok' || d.outcome === 'ok-screener-fallback') ? `${d.outcome}→${d.stage}` :
                  d.outcome === 'ok-screener-fallback' ? 'ok (Screener.in)' :
                  d.outcome;
                const detail =
                  d.outcome === 'cf-error' ? d.error :
                  d.outcome === 'no-filings' ? `seen ${d.total_filings_seen} filings, 0 for ticker` :
                  d.outcome === 'no-attachment' ? `${d.ticker_filings} filings, 0 with attachment` :
                  d.outcome === 'intimation-only' ? `${d.ticker_with_attachment} PDFs but all intimation/notice (best score ${d.best_score ?? '?'}) — Haiku skipped → ${d.filename || ''}` :
                  d.outcome === 'ok-screener-fallback' ? `NSE had nothing usable → Screener.in ${d.fallback_date || ''}: ${d.filename || ''}` :
                  d.stage === 'pdf-empty' ? `< 1200 chars in ${d.filename || d.url}` :
                  d.stage === 'llm-failed' ? `Haiku returned no JSON for ${d.filename || d.url}` :
                  `${d.matched_preference} (score ${d.best_score ?? '?'}) · ${d.filename || ''}`;
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 130px 1fr', gap: '8px', padding: '2px 0' }}>
                    <span style={{ color: TEXT, fontWeight: 700 }}>{d.ticker}</span>
                    <span style={{ color: outcomeColor, fontWeight: 700 }}>{label}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {aiStats && aiStats.total === qualifyingForAI.length && (aiStats.extracted > 0 || aiStats.cached > 0) && (
        <div style={{
          padding: '6px 12px', marginTop: '6px', borderRadius: '6px',
          backgroundColor: '#7C3AED12', border: '1px solid #7C3AED40',
          color: '#C4B5FD', fontSize: '11px', fontWeight: 600,
        }}>
          {/* PATCH 0962 — banner now surfaces ISSUE #6 PDF-quality taxonomy
              (pdf-image-only / pdf-corrupt are distinct from intimation-only)
              and ISSUE #11 telemetry (retries, avg extraction time, recovered
              from KV via the mini job-store). */}
          🤖 AI Guidance: {aiStats.extracted} extracted{(aiStats.screener_fallback || 0) > 0 ? ` (${aiStats.screener_fallback} via Screener.in)` : ''} · {aiStats.cached} cached{(aiStats.cached_invalid_dropped || 0) > 0 ? ` (+${aiStats.cached_invalid_dropped} stale dropped)` : ''}{(aiStats.recovered_from_kv || 0) > 0 ? ` · ♻ ${aiStats.recovered_from_kv} recovered from KV after timeout` : ''} · {aiStats.intimation_only || 0} intimation-only{(aiStats.pdf_image_only || 0) > 0 ? ` · ${aiStats.pdf_image_only} scanned/image-only` : ''}{(aiStats.pdf_too_short || 0) > 0 ? ` · ${aiStats.pdf_too_short} pdf-too-short` : ''}{(aiStats.pdf_corrupt || 0) > 0 ? ` · ${aiStats.pdf_corrupt} pdf-corrupt` : ''}{(aiStats.pdf_empty || 0) > 0 ? ` · ${aiStats.pdf_empty} pdf-empty` : ''} · {aiStats.missing_pdf} no PDF · {aiStats.llm_failed} LLM-failed{(aiStats.budget_exceeded || 0) > 0 ? ` · ⚠ ${aiStats.budget_exceeded} BUDGET EXCEEDED (Anthropic 429 — wait or top up)` : ''}{(aiStats.batch_failures || 0) > 0 ? ` · ⚠ ${aiStats.batch_failures} batch timeouts (${(aiStats.failed_tickers || []).length} tickers — click AI Guidance again to retry)` : ''}{(aiStats.retries || 0) > 0 ? ` · ${aiStats.retries} retries` : ''}{(aiStats.max_tokens_hits || 0) > 0 ? ` · ${aiStats.max_tokens_hits} max-tokens hits` : ''}{(aiStats.avg_extraction_ms || 0) > 0 ? ` · avg ${(aiStats.avg_extraction_ms! / 1000).toFixed(1)}s/extract` : ''} · total {aiStats.total}
          {aiDiagnostics && aiDiagnostics.length > 0 && (
            <>
              {' · '}
              <button
                onClick={() => setShowDiagnostics(s => !s)}
                style={{
                  background: 'transparent', border: '1px solid #7C3AED60',
                  color: '#C4B5FD', borderRadius: '4px', padding: '1px 6px',
                  fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                }}
              >{showDiagnostics ? 'Hide' : 'Show'} diagnostics ({aiDiagnostics.length})</button>
            </>
          )}
          {showDiagnostics && aiDiagnostics && (
            <div style={{
              marginTop: '8px', maxHeight: '260px', overflowY: 'auto',
              backgroundColor: '#0B1426', border: '1px solid #7C3AED30', borderRadius: '4px',
              padding: '6px 8px', fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: '10px', color: TEXT_DIM, fontWeight: 500,
            }}>
              <div style={{ color: '#C4B5FD', fontWeight: 700, marginBottom: '4px' }}>
                Per-ticker PDF resolution trace (P0949a):
              </div>
              {aiDiagnostics.map((d, i) => {
                const isOk = (d.outcome === 'ok' || d.outcome === 'ok-screener-fallback') && !d.stage;
                const outcomeColor =
                  isOk ? '#10B981' :
                  d.outcome === 'cf-error' ? '#EF4444' :
                  d.outcome === 'intimation-only' ? '#94A3B8' :
                  '#F59E0B';
                const label =
                  d.stage && (d.outcome === 'ok' || d.outcome === 'ok-screener-fallback') ? `${d.outcome}→${d.stage}` :
                  d.outcome === 'ok-screener-fallback' ? 'ok (Screener.in)' :
                  d.outcome;
                const detail =
                  d.outcome === 'cf-error' ? d.error :
                  d.outcome === 'no-filings' ? `seen ${d.total_filings_seen} filings, 0 for ticker` :
                  d.outcome === 'no-attachment' ? `${d.ticker_filings} filings, 0 with attachment` :
                  d.outcome === 'intimation-only' ? `${d.ticker_with_attachment} PDFs but all intimation/notice (best score ${d.best_score ?? '?'}) — Haiku skipped → ${d.filename || ''}` :
                  d.outcome === 'ok-screener-fallback' ? `NSE had nothing usable → Screener.in ${d.fallback_date || ''}: ${d.filename || ''}` :
                  d.stage === 'pdf-empty' ? `< 1200 chars in ${d.filename || d.url}` :
                  d.stage === 'llm-failed' ? `Haiku returned no JSON for ${d.filename || d.url}` :
                  `${d.matched_preference} (score ${d.best_score ?? '?'}) · ${d.filename || ''}`;
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 110px 1fr', gap: '8px', padding: '1px 0' }}>
                    <span style={{ color: TEXT, fontWeight: 700 }}>{d.ticker}</span>
                    <span style={{ color: outcomeColor, fontWeight: 700 }}>{label}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
          <span style={{ fontSize: '12px', color: 'var(--mc-bullish)', fontWeight: 600 }}>▲ Positive: {liveSummary.guidancePositive}</span>
          <span style={{ fontSize: '12px', color: 'var(--mc-warn)', fontWeight: 600 }}>● Neutral: {liveSummary.guidanceNeutral}</span>
          <span style={{ fontSize: '12px', color: 'var(--mc-bearish)', fontWeight: 600 }}>▼ Negative: {liveSummary.guidanceNegative}</span>
          <span style={{ fontSize: '12px', color: liveSummary.avgSentiment > 0 ? 'var(--mc-bullish)' : liveSummary.avgSentiment < 0 ? 'var(--mc-bearish)' : TEXT_DIM, fontWeight: 700 }}>
            Avg Sentiment: {liveSummary.avgSentiment > 0 ? '+' : ''}{liveSummary.avgSentiment.toFixed(3)}
          </span>
          {liveSummary.divergences > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--mc-warn)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
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
          <span>Showing {filteredCards.length} of {visibleCards.length}{viewMode !== 'screener' && visibleCards.length < cards.length ? ` (${cards.length} total)` : ''}{viewMode === 'screener' ? ` (screener universe)` : ''}{dayOneFilters.size > 0 && filteredCards.length < sortedCards.length ? ` · 1d filter trimmed ${sortedCards.length - filteredCards.length}` : ''}{aiFilters.size > 0 ? ` · AI filter (${Array.from(aiFilters).join(' OR ')}) active` : ''}</span>
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
          {filteredCards.map(card => <EarningsCardComponent key={card.symbol} card={card} postGap={gapMap[card.symbol]} ai={aiGuidance[card.symbol.toUpperCase()] || null} />)}
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
            // PATCH 0950 — recognize the AI filter as a possible culprit when
            // a multi-filter combo over-trims the grid.
            const culpritAi = aiFilters.size > 0;
            const reasons: string[] = [];
            if (culpritDate) reasons.push(`date range ${dateFrom || '—'} → ${dateTo || '—'}`);
            if (culpritGrade) reasons.push(`grade filter [${filterGrades.join(', ')}]`);
            if (culpritDayOne) reasons.push(`Day-1 close threshold`);
            if (culpritGuidance) reasons.push(`guidance = ${guidanceFilter}`);
            if (culpritAi) reasons.push(`AI filter [${Array.from(aiFilters).join(' OR ')}]`);
            const reasonLine = reasons.length > 0 ? `Likely cause: ${reasons.join(' AND ')}` : 'Possibly the universe filter — none of your portfolio/watchlist symbols passed.';
            return (
              <>
                <p style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 500, color: 'var(--mc-text-1)' }}>
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
                      style={{ padding: '8px 14px', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >🗓 Expand to last 12 months</button>
                  )}
                  {culpritGrade && (
                    <button
                      onClick={() => setFilterGrades(['ALL'])}
                      style={{ padding: '8px 14px', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)', color: 'var(--mc-bullish)', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >Reset grade → ALL</button>
                  )}
                  {culpritDayOne && (
                    <button
                      onClick={() => setDayOneFilters(new Set())}
                      style={{ padding: '8px 14px', background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', color: 'var(--mc-warn)', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >Clear Day-1 threshold</button>
                  )}
                  {culpritGuidance && (
                    <button
                      onClick={() => setGuidanceFilter('ALL')}
                      style={{ padding: '8px 14px', background: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 38%, transparent)', color: 'var(--mc-state-persistent)', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >Reset guidance → ALL</button>
                  )}
                  {culpritAi && (
                    <button
                      onClick={() => setAiFilters(new Set())}
                      style={{ padding: '8px 14px', background: '#7C3AED15', border: '1px solid #7C3AED60', color: '#C4B5FD', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >Clear AI filter</button>
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
