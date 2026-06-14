'use client';

// ════════════════════════════════════════════════════════════════════════════
// MFIConcentrationTile.tsx — PATCH 1081b
// Dashboard tile that surfaces the top-N most-concentrated names from the
// /api/v1/mfi-concentration endpoint shipped in PATCH 1081. Drop alongside
// FIIDIIFlowTile + MacroCalendarTile in the top utility row.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';

interface ConcRow {
  ticker: string;
  company: string;
  investorCount: number;
  netActions: number;
  signalScore: number;
  concentrationScore: number;
  direction: 'ACCUMULATION' | 'DISTRIBUTION' | 'MIXED';
}

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-border-1)',
  text: 'var(--mc-text-1)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: 'var(--mc-warn)',
  accent: 'var(--mc-cyan)',
};

export function MFIConcentrationTile({ days = 90, limit = 10 }: { days?: number; limit?: number }) {
  const [rows, setRows] = useState<ConcRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/mfi-concentration?days=${days}&limit=${limit}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [days, limit]);

  return (
    <div style={{ background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.3, color: C.accent, textTransform: 'uppercase' }}>🎯 MFI Concentration</div>
        <div style={{ fontSize: 9, color: C.dim }}>top {limit} · last {days}d</div>
      </div>
      {err ? (
        <div style={{ fontSize: 11, color: C.red }}>{err}</div>
      ) : !rows ? (
        <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>No concentrated names in window</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {rows.map((r) => {
            const dirColor = r.direction === 'ACCUMULATION' ? C.green : r.direction === 'DISTRIBUTION' ? C.red : C.amber;
            const dirGlyph = r.direction === 'ACCUMULATION' ? '↑' : r.direction === 'DISTRIBUTION' ? '↓' : '↕';
            return (
              <div key={r.ticker + r.company} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11, paddingBottom: 2, borderBottom: '1px dashed ' + C.border }}>
                <span style={{ color: dirColor, fontWeight: 800, width: 12 }}>{dirGlyph}</span>
                <span style={{ flex: 1, color: C.text, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ticker}</span>
                <span style={{ fontSize: 9, color: C.muted, fontFamily: 'ui-monospace, monospace' }}>{r.investorCount}inv</span>
                <span style={{ fontSize: 10, fontWeight: 800, color: dirColor, fontFamily: 'ui-monospace, monospace' }}>{r.netActions > 0 ? '+' : ''}{r.netActions}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MFIConcentrationTile;
