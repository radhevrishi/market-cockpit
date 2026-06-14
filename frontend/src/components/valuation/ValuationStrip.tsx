// ═══════════════════════════════════════════════════════════════════════════
// VALUATION-B — inline FV strip on every Multibagger row
//
// Shows next to P/E:
//   FV ₹2,890
//   ±N% MoS · 6/7 ✓
//
// Compact, color-coded by margin of safety:
//   MoS ≥ +15%  → green (UNDERVALUED)
//   −15% to +15% → amber (FAIR)
//   ≤ −15%      → red   (OVERVALUED)
//
// Click → opens /valuations?symbol=SYMBOL (handled by parent).
// ═══════════════════════════════════════════════════════════════════════════

'use client';
import React, { useMemo } from 'react';
import { computeValuations } from '@/lib/valuation';
import type { ValuationReport } from '@/lib/valuation/types';

interface Props {
  row: any;
  /** Optional click handler — parent can wire to expand panel or /valuations route. */
  onClick?: (report: ValuationReport) => void;
  /** Compact mode (default true) — shows 2 short lines */
  compact?: boolean;
}

function formatINR(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  if (v >= 1) return `₹${v.toFixed(0)}`;
  return `₹${v.toFixed(2)}`;
}

export function ValuationStrip({ row, onClick, compact = true }: Props) {
  const report = useMemo(() => computeValuations(row), [row]);
  const c = report.consensus;

  if (c.verdict === 'INSUFFICIENT_DATA' || c.fairValueBase === undefined) {
    return (
      <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontFamily: 'system-ui', lineHeight: 1.3 }} title="Not enough data for valuation models">
        FV: insufficient data
      </div>
    );
  }

  const mos = c.marginOfSafety ?? 0;
  const color = mos >= 15 ? '#10b981' : mos <= -15 ? '#ef4444' : '#f59e0b';
  const verdictIcon = c.verdict === 'UNDERVALUED' ? '▲' : c.verdict === 'OVERVALUED' ? '▼' : '◆';

  if (compact) {
    return (
      <div
        onClick={() => onClick?.(report)}
        style={{
          fontSize: 10, color: 'var(--mc-text-3)', fontFamily: 'system-ui', lineHeight: 1.35,
          cursor: onClick ? 'pointer' : 'default',
        }}
        title={`Bull ${formatINR(c.fairValueBull ?? 0)} · Base ${formatINR(c.fairValueBase)} · Bear ${formatINR(c.fairValueBear ?? 0)}\n${c.modelsBuy}/${c.modelsApplicable} models say BUY`}
      >
        <div style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          FV {formatINR(c.fairValueBase)}
        </div>
        <div style={{ fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color }}>{verdictIcon} {mos >= 0 ? '+' : ''}{mos.toFixed(0)}%</span>
          <span style={{ color: 'var(--mc-text-4)' }}> · {c.modelsBuy}/{c.modelsApplicable}</span>
        </div>
      </div>
    );
  }

  // Wide mode — 3 lines
  return (
    <div
      onClick={() => onClick?.(report)}
      style={{
        fontSize: 11, color: 'var(--mc-text-3)', fontFamily: 'system-ui', lineHeight: 1.4,
        cursor: onClick ? 'pointer' : 'default',
        background: '#0b1220', border: '1px solid var(--mc-bg-4)', borderRadius: 6,
        padding: '5px 8px',
      }}
    >
      <div style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        FV {formatINR(c.fairValueBase)}
      </div>
      <div style={{ fontSize: 10, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
        Range {formatINR(c.fairValueBear ?? 0)} – {formatINR(c.fairValueBull ?? 0)}
      </div>
      <div style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color }}>{verdictIcon} {mos >= 0 ? '+' : ''}{mos.toFixed(0)}% MoS</span>
        <span style={{ color: 'var(--mc-text-4)' }}> · {c.modelsBuy}/{c.modelsApplicable} ✓</span>
      </div>
    </div>
  );
}
