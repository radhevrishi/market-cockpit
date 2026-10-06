'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { TEXT_DIM, GREEN, RED, YELLOW, CARD, TEXT, ACCENT, CARD_BORDER, HEADER_BG } from './constants';
import { isDataStale } from './helpers';
import { type UniverseAggregation, type EarningsScanCard } from './types';

// ══════════════════════════════════════════════
// HELPER COMPONENTS
// ══════════════════════════════════════════════

export function GrowthBadge({ value, fontSize = 12 }: { value: number | null | undefined; fontSize?: number }) {
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
export function GradeBadge({ grade, color, score }: { grade: string; color: string; score: number }) {
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
export function DataQualityDot({ quality }: { quality: string }) {
  const colors: Record<string, string> = { 'FULL': GREEN, 'PARTIAL': YELLOW, 'PRICE_ONLY': RED };
  const labels: Record<string, string> = { 'FULL': 'Full Data', 'PARTIAL': 'Partial', 'PRICE_ONLY': 'Price Only' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: colors[quality] || TEXT_DIM }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: colors[quality] || TEXT_DIM, display: 'inline-block' }} />
      {labels[quality] || quality}
    </span>
  );
}
export function SourceBadge({ source, confidence }: { source?: string; confidence?: number }) {
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
export function DivergenceBadge({ divergence }: { divergence?: string }) {
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
export function StaleBadge({ quarterStr }: { quarterStr: string }) {
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
export function OutlookPill({ label, value }: { label: string; value?: string }) {
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
// ══════════════════════════════════════════════
// AGGREGATION PANEL
// Shows avg growth metrics for Portfolio / Watchlist
// ══════════════════════════════════════════════

export function AggregationPanel({ agg, color }: { agg: UniverseAggregation; color: string }) {
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

export function BottomSummary({ cards }: { cards: EarningsScanCard[] }) {
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

export function FinancialTable({ card }: { card: EarningsScanCard }) {
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
