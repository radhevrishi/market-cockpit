'use client';

// PATCH 0557 — BUG-AUDIT-2: backend-degraded banner.
//
// The window event `mc:backend-recovering` is dispatched from
// `src/lib/api.ts` whenever the upstream Render API returns a 5xx or
// network error and the retry budget kicks in. Pages that depend on
// live enrichment (Settings, Earnings Calendar, Re-Rating Screener,
// Watchlists prices, Earnings Scan) should mount this banner so the
// user sees a single, calm explanation instead of multiple inscrutable
// loading spinners.
//
// Auto-hide rule: stays visible for 3 minutes after the LAST event.
// Each new event resets the timer. When idle for 3 min the banner
// hides itself without affecting any other state.

import { useEffect, useState } from 'react';

export interface DegradedBannerProps {
  /** Optional copy override. */
  message?: string;
  /** Auto-hide threshold after the last event. Default 3 min. */
  idleMs?: number;
  /** Optional className for layout hooks. */
  className?: string;
}

const DEFAULT_MSG =
  'Data pipeline temporarily offline. Showing cached data. Live enrichment paused.';

export default function DegradedBanner({
  message = DEFAULT_MSG,
  idleMs = 3 * 60_000,
  className,
}: DegradedBannerProps) {
  const [visible, setVisible] = useState(false);
  const [lastTs, setLastTs] = useState<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      setVisible(true);
      setLastTs(Date.now());
    };
    window.addEventListener('mc:backend-recovering', handler as EventListener);
    return () => {
      window.removeEventListener('mc:backend-recovering', handler as EventListener);
    };
  }, []);

  // Auto-hide check (re-evaluates every 30s while visible).
  useEffect(() => {
    if (!visible) return;
    const tick = () => {
      if (Date.now() - lastTs > idleMs) setVisible(false);
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [visible, lastTs, idleMs]);

  if (!visible) return null;

  return (
    <div
      className={className}
      role="alert"
      style={{
        backgroundColor: '#F59E0B15',
        border: '1px solid var(--mc-warn)',
        borderRadius: 10,
        padding: '10px 14px',
        margin: '8px 0 12px',
        color: 'var(--mc-warn)',
        fontSize: 13,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 16 }}>⚠</span>
      <span>{message}</span>
      <button
        onClick={() => setVisible(false)}
        style={{
          marginLeft: 'auto',
          background: 'transparent',
          border: '1px solid var(--mc-warn)',
          borderRadius: 6,
          color: 'var(--mc-warn)',
          fontSize: 11,
          padding: '3px 8px',
          cursor: 'pointer',
          fontWeight: 600,
        }}
        title="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
