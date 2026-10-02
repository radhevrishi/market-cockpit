'use client';
// zzz859 — Guidance Upgrades layout pieces: a section panel (coloured left edge, title, count badge, collapse) and a
// smaller fold for sub-lists. Light and print friendly: colour marks meaning only, tints are transparent, nothing dark.
// When printing, everything is open.
import React, { useState } from 'react';
import { R, tint } from './gu-tokens';
import { usePrinting } from './GuMore';

export function CountBadge({ n, color }: { n: number | null | undefined; color: string }) {
  if (n == null) return null;
  const c = n > 0 ? color : R.grey;
  return (
    <span data-gu-count style={{ fontSize: 11.5, fontWeight: 800, minWidth: 22, textAlign: 'center', padding: '1px 8px', borderRadius: 10, color: c, border: `1px solid ${tint(c, 45)}`, background: tint(c, 10) }}>
      {n}
    </span>
  );
}

const caret = (open: boolean) => <span aria-hidden style={{ display: 'inline-block', width: 12, fontSize: 11, color: R.dim, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▶</span>;

/** A page section: white card, coloured left edge, header with title + count + hint; body collapses. */
export function GuPanel({ id, icon, title, count, accent, hint, defaultOpen = true, right, children }: {
  id?: string; icon?: string; title: string; count?: number | null; accent: string; hint?: React.ReactNode; defaultOpen?: boolean;
  right?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const printing = usePrinting();
  const isOpen = open || printing;
  return (
    <section id={id} data-gu-panel={id || title} className="gu-card" style={{ border: `1px solid ${R.border}`, borderLeft: `4px solid ${accent}`, borderRadius: 10, background: R.bg, color: R.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', background: tint(accent, 6), borderRadius: isOpen ? '9px 9px 0 0' : 9 }}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={isOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: R.text, textAlign: 'left' }}>
          {caret(isOpen)}
          {icon && <span aria-hidden style={{ fontSize: 15 }}>{icon}</span>}
          <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase' }}>{title}</span>
          <CountBadge n={count} color={accent} />
        </button>
        {right && <div className="gu-noprint" style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>{right}</div>}
        {hint && <div style={{ flexBasis: '100%', fontSize: 12, color: R.dim, paddingLeft: 20 }}>{hint}</div>}
      </div>
      {isOpen && <div style={{ padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>}
    </section>
  );
}

/** A sub-list inside a panel: title, count, one-line hint; collapsed or open by default. */
export function GuFold({ title, count, accent, hint, defaultOpen = false, children }: {
  title: React.ReactNode; count?: number | null; accent: string; hint?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const printing = usePrinting();
  const isOpen = open || printing;
  return (
    <div data-gu-fold style={{ border: `1px solid ${R.border}`, borderTop: `3px solid ${accent}`, borderRadius: 8, background: R.bg }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={isOpen}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer', color: R.text, textAlign: 'left' }}>
        {caret(isOpen)}
        <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase' }}>{title}</span>
        <CountBadge n={count} color={accent} />
        {hint && <span style={{ fontSize: 12, color: R.dim, fontWeight: 400 }}>{hint}</span>}
      </button>
      {isOpen && <div style={{ padding: '0 12px 10px', display: 'grid', gap: 6 }}>{children}</div>}
    </div>
  );
}

/** Pill-style toggle button (market / view chips). */
export const pillStyle = (on: boolean, color: string = R.cyan): React.CSSProperties => ({
  fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, padding: '4px 12px', borderRadius: 14, cursor: 'pointer',
  border: `1px solid ${on ? color : R.border}`, background: on ? tint(color, 14) : R.bg, color: on ? color : R.dim,
});
