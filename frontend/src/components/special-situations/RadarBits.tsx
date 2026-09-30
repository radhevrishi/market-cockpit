'use client';
// zzz841 — small presentational pieces shared by the radar cards, ledger and monitor.

import React from 'react';
import { R, tint } from './radar-tokens';

export function Chip({ color, children, dashed, title }: { color: string; children: React.ReactNode; dashed?: boolean; title?: string }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, letterSpacing: 0.3, padding: '2px 7px', borderRadius: 4,
      whiteSpace: 'nowrap', lineHeight: 1.4, border: `1px ${dashed ? 'dashed' : 'solid'} ${color}`, background: dashed ? 'transparent' : tint(color, 10), color,
    }}>{children}</span>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: R.faint, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 12.5, color: R.text, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

export const btn = (color: string = R.dim, solid = false): React.CSSProperties => ({
  fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
  border: `1px solid ${color}`, background: solid ? tint(color, 16) : 'transparent', color,
});
export const input: React.CSSProperties = {
  width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 5, border: `1px solid ${R.border}`, background: R.bg2, color: R.text, boxSizing: 'border-box',
};
