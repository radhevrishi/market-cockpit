'use client';
// zzz1249 — shared look of the Tradebook tab (moved out of TradebookTab.tsx)
import type React from 'react';

export const C = {
  panel: 'var(--mc-bg-1)', line: 'var(--mc-border-2)', txt: 'var(--mc-text-1)', mute: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: '#D97706', blue: '#3B82F6', violet: '#8B5CF6',
};
export const inr = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `₹${Math.round(v * 10 ** d) / 10 ** d >= 0 ? '' : '−'}${Math.abs(v) >= 1e7 ? `${(Math.abs(v) / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `${(Math.abs(v) / 1e5).toFixed(2)} L` : Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: d })}`);
export const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
export const tone = (v: number | null | undefined) => (v == null ? C.mute : v >= 0 ? C.green : C.red);

export function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.txt, letterSpacing: 0.3 }}>{title}</div>{right}
      </div>
      {children}
    </div>
  );
}
export function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ minWidth: 150, padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 8 }}>
      <div style={{ fontSize: 10.5, color: C.dim, fontWeight: 800, letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || C.txt, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
export const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: C.dim, fontWeight: 800, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` };
export const thL: React.CSSProperties = { ...th, textAlign: 'left' };
export const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 12.5, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` };
export const tdL: React.CSSProperties = { ...td, textAlign: 'left' };
