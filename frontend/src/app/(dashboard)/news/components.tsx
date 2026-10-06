'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect } from 'react';
import { isInReadingList, toggleReadingList } from '@/lib/reading-list';
import { hasTickerCI, readRawWatchlistTickers, writeRawWatchlistTickers } from './helpers';

// PATCH 0230 — Hard-stale strip.
// Companion to PanelFreshness: when data is older than staleAfterMs × 3 we
// render a full-width amber strip across the top of the panel so the user
// can't miss that they're looking at very-old data. Click-to-refresh.
export function PanelStaleStrip({
  dataUpdatedAt,
  staleAfterMs,
  onRefresh,
  label = 'data',
}: {
  dataUpdatedAt: number;
  staleAfterMs: number;
  onRefresh?: () => void;
  label?: string;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!dataUpdatedAt) return null;
  const age = Date.now() - dataUpdatedAt;
  const veryStaleAfterMs = staleAfterMs * 3;
  if (age <= veryStaleAfterMs) return null;
  const d = new Date(dataUpdatedAt);
  const hhmm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });  // zzz382 — UI labels these IST
  const ageMin = Math.floor(age / 60_000);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 14px', marginBottom: 8,
        backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)',
        borderRadius: 8,
        color: 'var(--mc-warn)',
        fontSize: 11, fontWeight: 600,
      }}
      title={`This panel's data is from ${d.toLocaleString(undefined, { timeZone: 'Asia/Kolkata' })} IST — refresh to pull fresh.`}
    >
      <span>⚠ Showing {label} as of {hhmm} ({ageMin} min ago). Older than the freshness window.</span>
      {onRefresh && (
        <button
          onClick={onRefresh}
          style={{
            marginLeft: 'auto',
            backgroundColor: 'transparent',
            border: '1px solid var(--mc-warn)',
            color: 'var(--mc-warn)',
            borderRadius: 5, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >REFRESH</button>
      )}
    </div>
  );
}
// ── Components ────────────────────────────────────────────────────────────────

// AUDIT_100 #58 — Read-it-later button. Inline component so we don't have to
// extract NewsCard into its own file.
export function ReadingListButton({ id }: { id: string }) {
  const [marked, setMarked] = useState(false);
  useEffect(() => {
    setMarked(isInReadingList(id));
    const onUpdate = () => setMarked(isInReadingList(id));
    window.addEventListener('mc:reading-list:updated', onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener('mc:reading-list:updated', onUpdate);
      window.removeEventListener('storage', onUpdate);
    };
  }, [id]);
  if (!id) return null;
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMarked(toggleReadingList(id)); }}
      style={{
        background: marked ? 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)' : 'none',
        border: `1px solid ${marked ? 'color-mix(in srgb, var(--mc-cyan) 38%, transparent)' : 'var(--mc-border-1)'}`,
        borderRadius: '10px',
        color: marked ? 'var(--mc-cyan)' : 'var(--mc-text-4)',
        cursor: 'pointer', padding: '10px', flexShrink: 0,
        display: 'flex', alignItems: 'center', minWidth: '40px', minHeight: '40px',
        justifyContent: 'center', fontSize: 14,
      }}
      title={marked ? 'Saved to Read it later — click to remove' : 'Save to Read it later'}
    >
      {marked ? '★' : '☆'}
    </button>
  );
}
export function WatchlistButton({ ticker }: { ticker: string | null | undefined }) {
  const upper = (ticker || '').toUpperCase();
  const [inList, setInList] = useState(false);
  useEffect(() => {
    if (!upper) return;
    setInList(hasTickerCI(readRawWatchlistTickers(), upper));
    const onUpdate = () => setInList(hasTickerCI(readRawWatchlistTickers(), upper));
    window.addEventListener('mc:watchlist:updated', onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener('mc:watchlist:updated', onUpdate);
      window.removeEventListener('storage', onUpdate);
    };
  }, [upper]);
  if (!upper) return null;
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const raw = readRawWatchlistTickers();
    const present = hasTickerCI(raw, upper);
    const next = present
      ? raw.filter(t => String(t).toUpperCase() !== upper)
      : [...raw, upper];
    writeRawWatchlistTickers(next);
    setInList(!present);
  };
  return (
    <button
      onClick={onClick}
      title={inList ? `${upper} is in your Watchlist — click to remove` : `Add ${upper} to your Watchlist`}
      style={{
        background: inList ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : 'none',
        border: `1px solid ${inList ? 'color-mix(in srgb, var(--mc-bullish) 38%, transparent)' : 'var(--mc-border-1)'}`,
        borderRadius: '10px',
        color: inList ? 'var(--mc-bullish)' : 'var(--mc-text-4)',
        cursor: 'pointer', padding: '6px 10px', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', minHeight: '32px',
        justifyContent: 'center', fontSize: 11, fontWeight: 700, letterSpacing: '0.3px',
      }}
    >
      {inList ? `✓ ${upper}` : `+ Watch`}
    </button>
  );
}
