// ═══════════════════════════════════════════════════════════════════════════
// SHARED EarningsScanCard component (PATCH 0539)
//
// Extracted from /earnings page so /watchlists Conviction Beats tab can
// render the same rich card. Pure presentational — no fetching, no state
// beyond hover. Consumer passes a fully-enriched EarningsScanCard +
// optional postGap blob.
//
// Public surface:
//   - type EarningsScanCard          (the card shape)
//   - type QuarterFinancials          (sub-shape)
//   - type PostGapBadge               (postGap prop shape)
//   - <EarningsCardComponent />        the rich card
//   - <CoverageStatsBar />             top-strip with covered / sentiment / counts
//   - tiny helpers re-exported for callers that need them
// ═══════════════════════════════════════════════════════════════════════════
'use client';

import React from 'react';

// ── color tokens (mirror /earnings page) ──
const CARD = '#0D1623';
const CARD_BORDER = '#1A2540';
const ACCENT = '#0F7ABF';
const TEXT = '#E8ECF1';
const TEXT_DIM = '#8899AA';
const GREEN = '#00C853';
const YELLOW = '#FFD600';
const RED = '#F44336';
const HEADER_BG = '#0A1628';

// ── types ──
export interface QuarterFinancials {
  period: string;
  revenue: number;
  operatingProfit: number;
  opm: number;
  pat: number;
  npm: number;
  eps: number;
}

export interface EarningsScanCard {
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
  guidance?: 'Positive' | 'Neutral' | 'Negative';
  sentimentScore?: number;
  revenueOutlook?: 'Up' | 'Flat' | 'Down' | 'Unknown';
  marginOutlook?: 'Expanding' | 'Stable' | 'Contracting' | 'Unknown';
  capexSignal?: 'Expanding' | 'Stable' | 'Reducing' | 'Unknown';
  demandSignal?: 'Strong' | 'Moderate' | 'Weak' | 'Unknown';
  keyPhrasesPositive?: string[];
  keyPhrasesNegative?: string[];
  divergence?: 'StrongEarnings_WeakGuidance' | 'WeakEarnings_StrongGuidance' | 'None';
  source?: 'nse' | 'screener.in' | 'trendlyne' | 'moneycontrol' | 'none';
  sourceConfidence?: number;
  dataStatus?: 'FULL' | 'PARTIAL' | 'ESTIMATED' | 'MISSING';
  dataAge?: 'fresh' | 'stale' | 'missing';
  failureReasons?: string[];
  screenerUrl: string;
  nseUrl: string;
  universeTag?: 'portfolio' | 'watchlist' | 'both' | 'screener' | 'conviction';
  isConviction?: boolean;
}

export interface PostGapBadge {
  gap_pct: number | null;
  close_move_pct: number | null;
  live_move_pct: number | null;
  is_live: boolean;
  target_date: string | null;
  filing_date?: string;
  filing_date_source?: 'explicit' | 'kv-calendar' | 'detected';
}

// ── helpers ──
export function formatMcap(num: number | null): string {
  if (num === null || num === undefined || num <= 0) return '—';
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L Cr`;
  if (num >= 1000) return `₹${Math.round(num).toLocaleString('en-IN')} Cr`;
  return `₹${num.toFixed(0)} Cr`;
}

function parseQuarterDate(quarterStr: string): Date | null {
  if (!quarterStr || quarterStr === 'N/A' || quarterStr === '-') return null;
  const parts = quarterStr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const monthStr = parts[0];
  const year = parseInt(parts[parts.length - 1]);
  if (isNaN(year)) return null;
  const months: Record<string, number> = {
    January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
    July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const m = months[monthStr];
  if (m === undefined) return null;
  return new Date(year, m, 1);
}

export function isDataStale(quarterStr: string, maxMonths = 6): boolean {
  const d = parseQuarterDate(quarterStr);
  if (!d) return true;
  const now = new Date();
  const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  return monthsAgo > maxMonths;
}

// ── sub-badges ──
function GrowthBadge({ value, fontSize = 12 }: { value: number | null | undefined; fontSize?: number }) {
  if (value === null || value === undefined) return <span style={{ color: TEXT_DIM, fontSize }}>—</span>;
  const color = value > 0 ? GREEN : value < 0 ? RED : TEXT_DIM;
  const prefix = value > 0 ? '+' : '';
  return <span style={{ color, fontSize, fontWeight: 600, fontFamily: 'monospace' }}>{prefix}{value.toFixed(1)}%</span>;
}

function GradeBadge({ grade, color, score }: { grade: string; color: string; score: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: `${color}20`, border: `1px solid ${color}50`, borderRadius: '6px', padding: '4px 10px' }}>
      <span style={{ color, fontWeight: 700, fontSize: '13px' }}>{grade}</span>
      <span style={{ color: TEXT_DIM, fontSize: '11px' }}>{score}</span>
    </div>
  );
}

function DataQualityDot({ quality }: { quality: string }) {
  const colors: Record<string, string> = { FULL: GREEN, PARTIAL: YELLOW, PRICE_ONLY: RED };
  const labels: Record<string, string> = { FULL: 'Full Data', PARTIAL: 'Partial', PRICE_ONLY: 'Price Only' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: colors[quality] || TEXT_DIM }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: colors[quality] || TEXT_DIM, display: 'inline-block' }} />
      {labels[quality] || quality}
    </span>
  );
}

function SourceBadge({ source, confidence }: { source?: string; confidence?: number }) {
  if (!source || source === 'none') return null;
  const colors: Record<string, string> = { nse: '#0F7ABF', moneycontrol: '#2E7D32', 'screener.in': '#F57C00', trendlyne: '#7B1FA2' };
  const labels: Record<string, string> = { nse: 'NSE', moneycontrol: 'MC', 'screener.in': 'SCR', trendlyne: 'TL' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px', color: colors[source] || TEXT_DIM, backgroundColor: `${colors[source] || TEXT_DIM}15`, border: `1px solid ${colors[source] || TEXT_DIM}40`, borderRadius: '3px', padding: '1px 5px' }}>
      {labels[source] || source}{confidence ? ` ${confidence}%` : ''}
    </span>
  );
}

function GuidanceBadge({ guidance, score }: { guidance?: string; score?: number }) {
  if (!guidance) return null;
  const cfg: Record<string, { color: string; icon: string }> = {
    Positive: { color: '#10B981', icon: '▲' },
    Neutral: { color: '#F59E0B', icon: '●' },
    Negative: { color: '#EF4444', icon: '▼' },
  };
  const c = cfg[guidance] || cfg['Neutral'];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', padding: '2px 7px', borderRadius: '4px', backgroundColor: `${c.color}18`, border: `1px solid ${c.color}40`, color: c.color, fontWeight: 600 }}>
      {c.icon} {guidance}{score !== undefined ? ` (${score > 0 ? '+' : ''}${score.toFixed(2)})` : ''}
    </span>
  );
}

function DivergenceBadge({ divergence }: { divergence?: string }) {
  if (!divergence || divergence === 'None') return null;
  const isStrongWeak = divergence === 'StrongEarnings_WeakGuidance';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px', padding: '2px 6px', borderRadius: '4px', backgroundColor: isStrongWeak ? 'color-mix(in srgb, var(--mc-bearish) 9%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)', border: `1px solid ${isStrongWeak ? 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)'}`, color: isStrongWeak ? 'var(--mc-bearish)' : 'var(--mc-bullish)', fontWeight: 700, letterSpacing: '0.3px' }}>
      ⚡ {isStrongWeak ? 'DIVERGENCE: Strong Earnings + Weak Guidance' : 'DIVERGENCE: Weak Earnings + Strong Guidance'}
    </span>
  );
}

function StaleBadge({ quarterStr }: { quarterStr: string }) {
  if (!isDataStale(quarterStr, 6)) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', color: 'var(--mc-bearish)', fontWeight: 700, letterSpacing: '0.3px' }}>
      ⚠ STALE
    </span>
  );
}

function OutlookPill({ label, value }: { label: string; value?: string }) {
  if (!value || value === 'Unknown') return null;
  const colorMap: Record<string, string> = {
    Up: '#10B981', Expanding: '#10B981', Strong: '#10B981',
    Flat: '#F59E0B', Stable: '#F59E0B', Moderate: '#F59E0B',
    Down: '#EF4444', Contracting: '#EF4444', Weak: '#EF4444', Reducing: '#EF4444',
  };
  const color = colorMap[value] || TEXT_DIM;
  return <span style={{ fontSize: '9px', color, fontWeight: 600 }}>{label}: {value}</span>;
}

function FinancialTable({ card }: { card: EarningsScanCard }) {
  // PATCH 0545 — defensive against payloads where quarters is missing/null.
  // Earnings-scan API normally returns [] but server hiccups can drop the field.
  const quarters = Array.isArray(card.quarters) ? card.quarters.slice(0, 3) : [];
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

// ── one-line earnings verdict ──
type CommentarySignal = 'POSITIVE' | 'MIXED' | 'RED_FLAG';

function generateEarningsCommentary(card: EarningsScanCard): { text: string; forward: string; signal: CommentarySignal } | null {
  // PATCH 0545 — defensive against missing/null quarters in partial payloads.
  if (card.dataQuality === 'PRICE_ONLY' || !Array.isArray(card.quarters) || card.quarters.length === 0) return null;

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
  const hasRev = rev !== null;
  const hasPat = pat !== null;
  const prevQ = card.quarters[1] || null;

  const posKeys = (card.keyPhrasesPositive || []).map(k => k.toLowerCase());
  const negKeys = (card.keyPhrasesNegative || []).map(k => k.toLowerCase());
  const guidance = card.guidance;
  const capexSignal = card.capexSignal;

  const isDebtFree = posKeys.some(k => k.includes('debt free') || k.includes('zero debt'));
  const hasOrderBook = posKeys.some(k => k.includes('order') || k.includes('book'));
  const hasHighDebt = negKeys.some(k => k.includes('debt') || k.includes('leverage') || k.includes('borrowing'));
  const hasWCStress = negKeys.some(k => k.includes('working capital') || k.includes('inventory') || k.includes('receivable') || k.includes('cash flow'));

  const profitConversion = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;

  let label: 'Beat' | 'Strong' | 'Mixed' | 'Miss';
  if (q0.pat < 0) label = 'Miss';
  else if (!hasRev || !hasPat) label = 'Mixed';
  else if (rev! <= -5 && pat! <= -10) label = 'Miss';
  else if (rev! <= 0 && pat! <= 0) label = 'Miss';
  else if (rev! > 5 && pat! <= 0) label = 'Mixed';
  else if (rev! > 15 && profitConversion < 0.25 && opmDelta < -3) label = 'Mixed';
  else if (rev! > 10 && profitConversion < 0.3 && opmDelta < -2) label = 'Mixed';
  else if (hasWCStress && opmDelta < -3) label = 'Mixed';
  else if (rev! > 12 && pat! > 18 && opmDelta >= -1) label = 'Beat';
  else if (rev! > 8 && pat! > 10) label = pat! > rev! ? 'Beat' : 'Strong';
  else if (rev! > 0 && pat! > 0) label = 'Strong';
  else label = 'Mixed';

  let driver: string;
  if (label === 'Miss') {
    if (q0.pat < 0 && hasHighDebt) driver = 'Interest burden pushed earnings into loss';
    else if (q0.pat < 0) driver = 'Operating losses; cost base exceeds revenue';
    else if (hasRev && rev! > 5 && hasPat && pat! < -10) {
      if (hasHighDebt) driver = 'Finance costs eroded operating gains';
      else if (opmDelta < -4) driver = 'Scaling costs squeezed margins despite growth';
      else driver = 'Rising costs absorbed revenue growth';
    } else if (hasRev && rev! < -5 && hasHighDebt) driver = 'Demand weakness compounded by debt burden';
    else if (hasRev && rev! < -5 && hasWCStress) driver = 'Demand weakness compounded by working capital strain';
    else if (hasRev && rev! < -5) driver = 'Revenue decline and weaker demand dragged profits';
    else driver = 'Revenue and profit both declined';
  } else if (label === 'Mixed') {
    if (hasRev && rev! > 30 && opmDelta < -4) {
      if (capexSignal === 'Expanding' || hasOrderBook) driver = 'Capacity ramp-up costs absorbed the revenue surge';
      else driver = 'Scaling costs absorbed most of the revenue surge';
    } else if (hasRev && rev! > 10 && opmDelta < -3) driver = 'Employee and project costs squeezed margins';
    else if (hasRev && rev! > 5 && hasPat && pat! <= 0) {
      if (hasHighDebt) driver = 'Finance costs capped profit despite revenue growth';
      else driver = 'Rising costs offset revenue growth entirely';
    } else if (hasWCStress && hasRev && rev! > 0) driver = 'Growth stretched working capital and weakened cash quality';
    else if (hasRev && hasPat && profitConversion < 0.3 && rev! > 10) {
      if (opmDelta < -2) driver = 'Input cost inflation squeezed operating margins';
      else driver = 'Weaker operating leverage capped profit growth';
    } else if (hasRev && Math.abs(rev!) < 5 && hasPat && Math.abs(pat!) < 8) {
      if (guidance === 'Negative') driver = 'Flat quarter with cautious forward outlook';
      else driver = 'No clear earnings inflection this quarter';
    } else driver = 'Earnings lacked clear direction this quarter';
  } else {
    const patRevRatio = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;
    const marginExpanded = opmDelta > 2;
    const marginHeld = opmDelta >= -1;
    const marginSoftened = opmDelta < -1 && opmDelta >= -4;
    const marginCrushed = opmDelta < -4;
    if (marginExpanded && patRevRatio > 1.3) driver = 'Margin expansion and operating leverage lifted profits';
    else if (marginExpanded && isDebtFree) driver = 'Margins expanded on a debt-free base';
    else if (marginExpanded) driver = 'Cost discipline and mix improvement drove margin expansion';
    else if (patRevRatio > 2 && marginHeld) driver = 'Operating leverage amplified profit growth';
    else if (marginCrushed && hasRev && rev! > 30) driver = 'Scaling costs diluted margins during rapid growth phase';
    else if (marginCrushed) driver = 'Input cost inflation squeezed margins despite growth';
    else if (marginSoftened && hasPat && pat! > 20) driver = 'Volume growth drove profits despite softer margins';
    else if (marginSoftened) driver = 'Revenue growth partly offset by margin dilution';
    else if (hasWCStress && hasPat && pat! > 10) driver = 'Earnings grew but working capital absorbed cash';
    else if (hasHighDebt && hasPat && pat! > 15) driver = 'Earnings grew but financial leverage remains elevated';
    else if (isDebtFree && hasPat && pat! > 20) driver = 'Strong profit growth on a clean balance sheet';
    else if (hasOrderBook) driver = 'Order book execution supported earnings growth';
    else if (hasRev && rev! > 20 && marginHeld) driver = 'Strong revenue growth with margins intact';
    else if (hasPat && pat! > 30) driver = 'Profit surge driven by volume and cost control';
    else if (hasRev && rev! > 10) driver = 'Revenue momentum supported earnings this quarter';
    else driver = 'Incremental growth across revenue and profits';
  }

  const fwdRevQoQ = card.revenueQoQ;
  const fwdQoqOpmUp = prevQ ? q0.opm > prevQ.opm : false;
  const fwdQoqOpmDelta = prevQ ? q0.opm - prevQ.opm : 0;
  const patRevRatio2 = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;
  const dem = card.demandSignal;
  const cap = card.capexSignal;

  let forward = '';
  const insights: string[] = [];
  if (q0.pat < 0 && hasRev && rev! > 0) insights.push('losses despite revenue growth — cost base unsustainable');
  if (hasPat && pat! > 10 && opmDelta < -3 && fwdQoqOpmDelta < -1) insights.push('profit growth masks deteriorating margin trend');
  if (hasRev && rev! > 15 && hasPat && pat! < 3 && pat! > -10) insights.push('revenue surge not reaching bottom line');
  if (hasWCStress) insights.push('working capital stretched — watch cash conversion');
  if (hasHighDebt && hasPat && pat! > 0 && patRevRatio2 < 0.5) insights.push('finance costs capping profit conversion');
  if (hasPat && hasRev && pat! > rev! * 1.3 && opmDelta > 0) insights.push('operating leverage visible — profit outpacing revenue');
  else if (hasPat && hasRev && rev! > 8 && pat! < rev! * 0.3 && pat! > 0 && insights.length === 0) insights.push('operating deleverage — profit lagging revenue growth');
  if (opmDelta > 3) insights.push(`OPM expanded ${opmDelta.toFixed(0)}pp YoY`);
  else if (opmDelta < -3 && fwdQoqOpmUp && fwdQoqOpmDelta > 0.5) insights.push('margin inflection — QoQ recovery despite YoY decline');
  else if (opmDelta < -3) insights.push(`OPM contracted ${Math.abs(opmDelta).toFixed(0)}pp YoY`);
  if (fwdRevQoQ !== null && fwdRevQoQ > 15) insights.push('sequential revenue momentum strong');
  else if (fwdRevQoQ !== null && fwdRevQoQ < -10) insights.push('sequential revenue declined — watch for demand softness');
  if (cap === 'Expanding') insights.push('capex expanding — capacity addition underway');
  else if (cap === 'Reducing') insights.push('capex reducing');
  if (dem === 'Strong') insights.push('demand signals strong');
  else if (dem === 'Weak') insights.push('demand weakening');
  if (isDebtFree && insights.every(i => !i.includes('debt') && !i.includes('leverage'))) insights.push('debt-free balance sheet');
  if (posKeys.length > 0 && negKeys.length > 0) insights.push(`${posKeys.slice(0, 2).join(', ')}; but ${negKeys.slice(0, 2).join(', ')}`);
  else if (negKeys.length > 0 && insights.length < 2) insights.push(negKeys.slice(0, 2).join(', '));
  else if (posKeys.length > 0 && insights.length < 2) insights.push(posKeys.slice(0, 2).join(', '));

  if (insights.length > 0) {
    const unique = insights.filter((v, i, a) => a.findIndex(x => x.slice(0, 15) === v.slice(0, 15)) === i);
    const combined = unique.slice(0, 2).join('. ');
    forward = combined.charAt(0).toUpperCase() + combined.slice(1);
  }

  const text = `${label} | ${driver}`;
  const signal: CommentarySignal = label === 'Beat' || label === 'Strong' ? 'POSITIVE' : label === 'Miss' ? 'RED_FLAG' : 'MIXED';
  return { text, forward, signal };
}

const COMMENTARY_COLORS: Record<CommentarySignal, { bg: string; border: string; text: string }> = {
  POSITIVE: { bg: '#10B98110', border: '#10B98130', text: '#10B981' },
  MIXED: { bg: '#F59E0B10', border: '#F59E0B30', text: '#F59E0B' },
  RED_FLAG: { bg: '#EF444410', border: '#EF444430', text: '#EF4444' },
};

// ── main card ──
export function EarningsCardComponent({ card, postGap }: { card: EarningsScanCard; postGap?: PostGapBadge }) {
  const tagColor = card.universeTag === 'portfolio' ? '#10B981'
    : card.universeTag === 'both' ? '#8B5CF6'
    : card.universeTag === 'screener' ? '#F59E0B'
    : card.universeTag === 'conviction' ? '#F59E0B'
    : ACCENT;
  const tagLabel = card.universeTag === 'portfolio' ? 'PORTFOLIO'
    : card.universeTag === 'both' ? 'BOTH'
    : card.universeTag === 'screener' ? 'SCREENER'
    : card.universeTag === 'conviction' ? 'CONVICTION'
    : 'WATCHLIST';

  const staleData = isDataStale(card.period, 6);
  const veryOldData = isDataStale(card.period, 120);
  const displayScore = staleData && veryOldData ? Math.min(40, card.totalScore) : card.totalScore;

  if (card.dataStatus === 'MISSING') {
    return (
      <div style={{ backgroundColor: CARD, border: `1px solid #F4433650`, borderRadius: '10px', overflow: 'hidden', opacity: 0.7 }}>
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
    <div
      style={{ backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '10px', overflow: 'hidden', transition: 'border-color 0.2s' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = ACCENT)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = CARD_BORDER)}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px 10px', borderBottom: `1px solid ${CARD_BORDER}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: TEXT }}>{card.symbol}</span>
            <GradeBadge grade={card.grade} color={card.gradeColor} score={displayScore} />
            <span style={{ fontSize: '8px', padding: '2px 6px', borderRadius: '3px', backgroundColor: `${tagColor}20`, border: `1px solid ${tagColor}50`, color: tagColor, fontWeight: 700, letterSpacing: '0.5px' }}>{tagLabel}</span>
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
          {postGap && postGap.live_move_pct != null && (
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <div style={{ fontSize: 9, color: TEXT_DIM, fontWeight: 700, letterSpacing: '0.4px' }}>POST-EARNINGS {postGap.is_live ? '(LIVE)' : '(CLOSE)'}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, backgroundColor: (postGap.live_move_pct >= 0 ? GREEN : RED) + '20', border: `1px solid ${(postGap.live_move_pct >= 0 ? GREEN : RED)}50` }}>
                <span style={{ fontSize: 13, fontWeight: 900, color: postGap.live_move_pct >= 0 ? GREEN : RED, fontFamily: 'ui-monospace, monospace' }}>
                  {postGap.live_move_pct >= 0 ? '▲' : '▼'} {Math.abs(postGap.live_move_pct).toFixed(1)}%
                </span>
              </div>
              {postGap.gap_pct != null && postGap.gap_pct !== postGap.live_move_pct && (
                <div style={{ fontSize: 9, color: TEXT_DIM, fontFamily: 'ui-monospace, monospace' }}>gap {postGap.gap_pct >= 0 ? '+' : ''}{postGap.gap_pct.toFixed(1)}%</div>
              )}
              {!postGap.is_live && postGap.close_move_pct != null && postGap.close_move_pct !== postGap.live_move_pct && (
                <div style={{ fontSize: 9, fontFamily: 'ui-monospace, monospace', color: postGap.close_move_pct >= 0 ? GREEN : RED, fontWeight: 600 }}>
                  1d close {postGap.close_move_pct >= 0 ? '+' : ''}{postGap.close_move_pct.toFixed(1)}%
                </div>
              )}
              {postGap.filing_date && (
                <div
                  title={
                    postGap.filing_date_source === 'kv-calendar' ? 'Filing date from NSE+BSE corp announcements (authoritative)'
                    : postGap.filing_date_source === 'detected' ? 'Filing date inferred from price-action signature (Tier 3 fallback)'
                    : 'Filing date supplied directly'
                  }
                  style={{ fontSize: 8, color: TEXT_DIM, fontFamily: 'ui-monospace, monospace', opacity: 0.75 }}
                >
                  {postGap.filing_date_source === 'kv-calendar' ? '✓ ' : postGap.filing_date_source === 'detected' ? '~ ' : ''}
                  filed {postGap.filing_date.slice(5)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Financial table */}
      {card.dataQuality !== 'PRICE_ONLY' && Array.isArray(card.quarters) && card.quarters.length > 0 ? (
        <div style={{ padding: '8px 12px 12px' }}><FinancialTable card={card} /></div>
      ) : (
        <div style={{ padding: '16px', textAlign: 'center', color: YELLOW, fontSize: '12px', backgroundColor: `${YELLOW}08` }}>
          Quarterly financial data not available for this stock
        </div>
      )}

      {/* Earnings verdict */}
      {(() => {
        const commentary = generateEarningsCommentary(card);
        if (!commentary) return null;
        const colors = COMMENTARY_COLORS[commentary.signal];
        const pipeIdx = commentary.text.indexOf(' | ');
        const label = pipeIdx > 0 ? commentary.text.slice(0, pipeIdx) : commentary.text;
        const driver = pipeIdx > 0 ? commentary.text.slice(pipeIdx + 3) : '';
        return (
          <div style={{ padding: '7px 16px', borderTop: `1px solid ${CARD_BORDER}`, backgroundColor: colors.bg }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: colors.text, flexShrink: 0, padding: '2px 7px', borderRadius: '4px', backgroundColor: `${colors.text}18`, border: `1px solid ${colors.text}30` }}>{label}</span>
              <span style={{ fontSize: '11px', color: '#C0CCD8', fontWeight: 500, lineHeight: '1.4' }}>{driver}</span>
            </div>
            {commentary.forward && (
              <div style={{ fontSize: '10px', color: TEXT_DIM, lineHeight: '1.4', fontStyle: 'italic', paddingLeft: '2px' }}>{commentary.forward}</div>
            )}
          </div>
        );
      })()}

      {/* Guidance & sentiment */}
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
                <span key={`p${i}`} style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 19%, transparent)' }}>{p}</span>
              ))}
              {(card.keyPhrasesNegative || []).map((p, i) => (
                <span key={`n${i}`} style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: 'var(--mc-bearish)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)' }}>{p}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
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

// ═══════════════════════════════════════════════════════════════════════════
// COVERAGE STATS BAR — top-strip that surfaces the same aggregates the
// /earnings page renders above its card grid (covered, sentiment, full vs
// partial, etc). Pure computation from a EarningsScanCard[] slice.
// ═══════════════════════════════════════════════════════════════════════════
export function computeCoverageStats(cards: EarningsScanCard[]) {
  const total = cards.length;
  const excellent = cards.filter(c => c.grade === 'EXCELLENT').length;
  const strong = cards.filter(c => c.grade === 'STRONG').length;
  const good = cards.filter(c => c.grade === 'GOOD').length;
  const ok = cards.filter(c => c.grade === 'OK').length;
  const bad = cards.filter(c => c.grade === 'BAD').length;
  const withScore = cards.filter(c => c.totalScore > 0);
  const avgScore = withScore.length ? Math.round(withScore.reduce((s, c) => s + c.totalScore, 0) / withScore.length) : 0;

  const withGuidance = cards.filter(c => c.guidance);
  const guidanceCoverage = withGuidance.length;
  const guidancePositive = cards.filter(c => c.guidance === 'Positive').length;
  const guidanceNeutral = cards.filter(c => c.guidance === 'Neutral').length;
  const guidanceNegative = cards.filter(c => c.guidance === 'Negative').length;
  const avgSentiment = guidanceCoverage > 0
    ? withGuidance.reduce((s, c) => s + (c.sentimentScore || 0), 0) / guidanceCoverage
    : 0;
  const divergences = cards.filter(c => c.divergence && c.divergence !== 'None').length;
  const dqFull = cards.filter(c => c.dataQuality === 'FULL').length;
  const dqPartial = cards.filter(c => c.dataQuality === 'PARTIAL').length;
  const dqPriceOnly = cards.filter(c => c.dataQuality === 'PRICE_ONLY').length;
  const fullData = dqFull;
  const qualityRatio = total > 0 ? (fullData / total) * 100 : 0;

  return {
    total, excellent, strong, good, ok, bad, avgScore,
    guidanceCoverage, guidancePositive, guidanceNeutral, guidanceNegative,
    avgSentiment, divergences,
    dataQualityBreakdown: { full: dqFull, partial: dqPartial, priceOnly: dqPriceOnly },
    qualityRatio,
  };
}

export function CoverageStatsBar({
  cards,
  totalCount,
  showingCount,
}: {
  cards: EarningsScanCard[];
  totalCount?: number;
  showingCount?: number;
}) {
  if (cards.length === 0) return null;
  const s = computeCoverageStats(cards);
  const qLabel = s.qualityRatio >= 70 ? 'HIGH' : s.qualityRatio >= 40 ? 'MED' : 'LOW';
  const grades = [
    { label: 'Total', value: s.total, color: ACCENT },
    { label: 'EXCELLENT', value: s.excellent, color: '#7C3AED' },
    { label: 'STRONG', value: s.strong, color: '#00C853' },
    { label: 'GOOD', value: s.good, color: '#4CAF50' },
    { label: 'OK', value: s.ok, color: '#FFD600' },
    { label: 'BAD', value: s.bad, color: '#F44336' },
    { label: 'Avg Score', value: s.avgScore, color: ACCENT },
  ];
  return (
    <div style={{
      backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 8,
      padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {grades.map(g => (
          <div key={g.label} style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ fontSize: 10, color: TEXT_DIM, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{g.label}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: g.color, fontFamily: 'ui-monospace, monospace' }}>{g.value}</span>
          </div>
        ))}
      </div>
      {s.guidanceCoverage > 0 && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
          <span style={{ color: TEXT_DIM }}>{s.guidanceCoverage} of {s.total} covered</span>
          <span style={{ color: 'var(--mc-bullish)', fontWeight: 600 }}>▲ Positive: {s.guidancePositive}</span>
          <span style={{ color: 'var(--mc-warn)', fontWeight: 600 }}>● Neutral: {s.guidanceNeutral}</span>
          <span style={{ color: 'var(--mc-bearish)', fontWeight: 600 }}>▼ Negative: {s.guidanceNegative}</span>
          <span style={{ color: s.avgSentiment > 0 ? 'var(--mc-bullish)' : s.avgSentiment < 0 ? 'var(--mc-bearish)' : TEXT_DIM, fontWeight: 700 }}>
            Avg Sentiment: {s.avgSentiment > 0 ? '+' : ''}{s.avgSentiment.toFixed(3)}
          </span>
          {s.divergences > 0 && (
            <span style={{ color: 'var(--mc-warn)', fontWeight: 600 }}>⚡ {s.divergences} Divergence{s.divergences > 1 ? 's' : ''}</span>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: GREEN }}>● Full: {s.dataQualityBreakdown.full}</span>
        <span style={{ color: YELLOW }}>● Partial: {s.dataQualityBreakdown.partial}</span>
        <span style={{ color: RED }}>● Price Only: {s.dataQualityBreakdown.priceOnly}</span>
        {showingCount != null && totalCount != null && (
          <span style={{ color: TEXT_DIM }}>Showing {showingCount} of {totalCount}</span>
        )}
        <span style={{ color: TEXT_DIM }}>Data Quality: {s.qualityRatio.toFixed(0)}% ({qLabel})</span>
      </div>
    </div>
  );
}
