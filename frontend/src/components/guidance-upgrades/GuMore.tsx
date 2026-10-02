'use client';
// zzz855 — rendering helpers for long lists (speed only; nothing here changes a count, a label or the order).
//   CappedList   renders the first `step` items, then "Show N more" / "Show all". Totals always come from the full list.
//   LazyDetails  a <details> whose body is only built the first time it is opened (the summary line is always there).
// Printing (Ctrl+P) expands every capped list so a printout is never cut short.
import React, { useEffect, useState } from 'react';

export const LIST_STEP = 30;

/** True after the browser fires `beforeprint` (until `afterprint`). */
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const on = () => setPrinting(true);
    const off = () => setPrinting(false);
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => { window.removeEventListener('beforeprint', on); window.removeEventListener('afterprint', off); };
  }, []);
  return printing;
}

/** How many of `total` to render given the current limit. Pure; used by the list and the tests. */
export function cappedCount(total: number, limit: number): number {
  return Math.max(0, Math.min(total, limit));
}

/** Words on the "more" control. Pure. */
export function moreText(shown: number, total: number, step = LIST_STEP): { more: string; all: string; note: string } {
  const rest = Math.max(0, total - shown);
  return {
    more: `Show ${Math.min(step, rest)} more`,
    all: `Show all ${total}`,
    note: `Showing ${shown} of ${total}`,
  };
}

const moreBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid currentColor', background: 'transparent', color: 'inherit',
};

export function ShowMoreBar({ shown, total, step = LIST_STEP, onMore, onAll, color, as = 'div' }: { shown: number; total: number; step?: number; onMore: () => void; onAll: () => void; color?: string; as?: 'div' | 'li' }) {
  if (shown >= total) return null;
  const t = moreText(shown, total, step);
  const Tag = as;
  return (
    <Tag className="gu-noprint" data-show-more style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: color || 'inherit', listStyle: 'none' }}>
      <span style={{ opacity: 0.8 }}>{t.note}</span>
      <button type="button" style={moreBtn} onClick={onMore}>{t.more}</button>
      {total - shown > step && <button type="button" style={moreBtn} onClick={onAll}>{t.all}</button>}
    </Tag>
  );
}

/** Renders items[0..limit) with a "Show N more" control. Order is the order given. */
export function CappedList<T>({ items, render, step = LIST_STEP, color, inList }: { items: readonly T[]; render: (item: T, index: number) => React.ReactNode; step?: number; color?: string; /** true inside <ul>/<ol>: the control renders as an <li> */ inList?: boolean }) {
  const [limit, setLimit] = useState(step);
  const printing = usePrinting();
  const n = printing ? items.length : cappedCount(items.length, limit);
  return (
    <>
      {items.slice(0, n).map((it, i) => render(it, i))}
      <ShowMoreBar as={inList ? 'li' : 'div'} shown={n} total={items.length} step={step} color={color} onMore={() => setLimit((l) => l + step)} onAll={() => setLimit(items.length)} />
    </>
  );
}

type DetailsProps = Omit<React.DetailsHTMLAttributes<HTMLElement>, 'children'> & { summary: React.ReactNode; children: React.ReactNode };

/**
 * <details> that builds its body only once it has been opened. In a server
 * render (no window) the body is included, so static output keeps the text.
 * A controlled `open` prop is respected.
 */
export function LazyDetails({ summary, children, open, onToggle, ...rest }: DetailsProps) {
  const [seen, setSeen] = useState(!!open);
  useEffect(() => { if (open) setSeen(true); }, [open]);
  const body = seen || typeof window === 'undefined';
  return (
    <details {...rest} open={open} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setSeen(true); onToggle?.(e); }}>
      {summary}
      {body ? children : null}
    </details>
  );
}
