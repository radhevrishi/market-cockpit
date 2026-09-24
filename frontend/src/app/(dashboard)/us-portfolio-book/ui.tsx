// US PORTFOLIO BOOK — shared look + number formatting for the page's tabs. (zzz793)
'use client';

import type { ReactNode } from 'react';

export const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2, var(--mc-bg-1))', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)',
  green: 'var(--mc-verdict-up, #34D399)', red: 'var(--mc-verdict-down, #F87171)', cyan: 'var(--tc-accent, #22D3EE)',
};

const SYM: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

/** Full amount with currency sign; '—' for unknown (never 0). */
export function money(v: number | null | undefined, ccy = 'USD', dp = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = SYM[ccy];
  return `${v < 0 ? '−' : ''}${s || ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}${s ? '' : ` ${ccy}`}`;
}
export const signedMoney = (v: number | null | undefined, ccy = 'USD', dp = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${money(v, ccy, dp)}`);
export const pct = (v: number | null | undefined, dp = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`);
export const wt = (v: number | null | undefined, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(dp)}%`);
export const tone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v === 0 ? C.faint : v > 0 ? C.green : C.red);

/** "Sep 24, 4:00 PM ET" — US market time, the time the price is from. */
export function fmtEt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return `${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

export const card: React.CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', background: C.bg };
export const cardTitle: React.CSSProperties = { fontSize: 12, fontWeight: 900, color: C.cyan, letterSpacing: '0.4px', textTransform: 'uppercase', marginBottom: 8 };

export function Tile({ label, value, sub, color, testId }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; testId?: string }) {
  return (
    <div data-testid={testId} style={{ ...card, padding: '10px 12px', minWidth: 170, flex: '1 1 170px' }}>
      <div style={{ fontSize: 11, color: C.faint, fontWeight: 800, letterSpacing: '0.4px' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color: color || C.text, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

export function Bar({ label, pctValue, right, color = C.cyan, sub }: { label: ReactNode; pctValue: number; right?: ReactNode; color?: string; sub?: ReactNode }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, marginBottom: 3 }}>
        <span style={{ color: C.text, fontWeight: 700 }}>{label}</span>
        <span style={{ color: C.dim, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{right}</span>
      </div>
      <div style={{ height: 7, background: C.bg2, borderRadius: 4, overflow: 'hidden', border: `1px solid ${C.border}` }}>
        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pctValue))}%`, background: color }} />
      </div>
      {sub && <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
