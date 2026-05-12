'use client';

// PATCH 0274 — Global data-freshness chip helper.
//
// Originally lived in src/app/(dashboard)/news/page.tsx as a local
// PanelFreshness component (Patch 0212). Extracted into a shared
// component so every dashboard panel — earnings, transmission, screener,
// portfolio, etc. — can surface "as of HH:MM · Xm ago" with the same
// visual semantics (amber when stale, mono font, monospaced) without
// each page rolling its own age-formatter and re-render timer.
//
// Usage (most common):
//   <PanelFreshness dataUpdatedAt={query.dataUpdatedAt} isFetching={query.isFetching} />
//   <PanelFreshness dataUpdatedAt={query.dataUpdatedAt} staleAfterMs={15 * 60_000} />
//
// React Query exposes `dataUpdatedAt` on every useQuery result. For
// non-React-Query callers, pass Date.now() at the moment data lands.

import { useEffect, useState } from 'react';

export interface PanelFreshnessProps {
  /** Epoch ms when the panel's data was last successfully refreshed. */
  dataUpdatedAt: number;
  /** Show ↻ prefix while a background refetch is in flight. */
  isFetching?: boolean;
  /** Age beyond which the chip turns amber. Default 5 min. */
  staleAfterMs?: number;
  /** Label prefix. Default "as of". */
  label?: string;
  /** Optional className for layout hooks. */
  className?: string;
  /** Override default style (merged on top). */
  style?: React.CSSProperties;
}

/**
 * Compact "as of HH:MM · Xm ago" chip.
 *
 * Re-renders once a minute so the relative-age portion stays accurate
 * without consumers needing their own tickers. Returns null when
 * `dataUpdatedAt` is 0/undefined so it cleanly hides on first load.
 */
export function PanelFreshness({
  dataUpdatedAt,
  isFetching,
  staleAfterMs = 5 * 60_000,
  label = 'as of',
  className,
  style,
}: PanelFreshnessProps) {
  // Force a re-render once a minute so the chip stays accurate.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!dataUpdatedAt) return null;

  const now = Date.now();
  const age = Math.max(0, now - dataUpdatedAt);
  const isStale = age > staleAfterMs;
  const d = new Date(dataUpdatedAt);
  const hhmm = d.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const ageStr =
    age < 60_000        ? 'now' :
    age < 3_600_000     ? `${Math.floor(age / 60_000)}m ago` :
    age < 86_400_000    ? `${Math.floor(age / 3_600_000)}h ago` :
                          `${Math.floor(age / 86_400_000)}d ago`;

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 9,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: isStale ? '#F59E0B' : '#6B7B8C',
    padding: '2px 6px',
    borderRadius: 4,
    backgroundColor: isStale ? 'rgba(245,158,11,0.08)' : 'transparent',
    border: `1px solid ${isStale ? 'rgba(245,158,11,0.25)' : '#1E2D45'}`,
    letterSpacing: '0.3px',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  };

  return (
    <span
      className={className}
      title={`Last successful refresh: ${d.toLocaleString()}\nClick the Refresh button to pull fresh data.`}
      style={{ ...baseStyle, ...(style || {}) }}
    >
      {isFetching ? '↻ ' : ''}{label} {hhmm} · {ageStr}
    </span>
  );
}

export default PanelFreshness;
