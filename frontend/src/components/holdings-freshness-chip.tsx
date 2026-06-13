'use client';

// ─────────────────────────────────────────────────────────────────────────
// HOLDINGS FRESHNESS CHIP — PATCH 1065 (HANDOFF5)
//
// Self-contained widget for the SuperInvestors page. Renders a freshness
// chip + a manual Refresh button next to the existing holdings header so
// the user can see whether holdings are coming from the live KV cache or
// the static fallback, and force a re-fetch.
//
// Single import + single render line is all it takes to wire this up:
//
//   import { HoldingsFreshnessChip } from '@/components/holdings-freshness-chip';
//   ...
//   <HoldingsFreshnessChip investorId={selectedId} />
//
// The page's existing holdings render path stays unchanged — this chip
// is purely an information layer. If you want the live holdings to drive
// the table itself, the chip exposes the fetched data via a callback
// (onData) so the parent can swap the array in:
//
//   <HoldingsFreshnessChip
//     investorId={selectedId}
//     onData={(d) => setLive(d)}
//   />
//   const holdings = live?.holdings ?? selected.topHoldings;
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/design-system';

interface DisclosedHolding {
  ticker: string;
  company: string;
  stakePct?: number;
  disclosedOn: string;
  tier: string;
  exchange?: string;
  thesis?: string;
}

interface HoldingsResponse {
  id: string;
  name: string;
  trendlyneUrl: string | null;
  holdings: DisclosedHolding[];
  source: 'kv' | 'static';
  fetchedAt: string;
  lastRefreshedAt: string;
  lastDisclosedAt: string;
  stale: boolean;
  staleAfterMs: number;
  count: number;
}

export interface HoldingsFreshnessChipProps {
  investorId: string;
  /** Optional callback fired every time the chip receives new data. */
  onData?: (data: HoldingsResponse) => void;
  /** How often to auto-refresh in ms. Default 0 = no auto refresh. */
  autoRefreshMs?: number;
}

function formatAge(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms) || ms < 0) return iso;
    const min = Math.floor(ms / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}

export function HoldingsFreshnessChip({
  investorId,
  onData,
  autoRefreshMs = 0,
}: HoldingsFreshnessChipProps) {
  const [data, setData] = useState<HoldingsResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(
    async (silent = false) => {
      setRefreshing(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/v1/super-investor-holdings/${encodeURIComponent(investorId)}`,
          { cache: 'no-store' },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as HoldingsResponse;
        setData(j);
        onData?.(j);
        if (!silent) {
          toast({
            title:
              j.source === 'kv'
                ? `Refreshed ${j.count} live holdings`
                : `Showing ${j.count} static holdings`,
            description:
              j.source === 'static'
                ? 'No live data yet — using last-disclosed snapshot.'
                : `Last scrape: ${formatAge(j.lastRefreshedAt)}`,
            tone: j.source === 'kv' ? 'ok' : 'warn',
          });
        }
      } catch (e: any) {
        setError(String(e?.message || e));
        if (!silent) {
          toast({ title: 'Refresh failed', description: String(e), tone: 'err' });
        }
      } finally {
        setRefreshing(false);
      }
    },
    [investorId, onData, toast],
  );

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs < 10_000) return;
    const id = setInterval(() => refresh(true), autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, refresh]);

  const chipColor =
    error || !data
      ? 'var(--mc-text-4)'
      : data.source === 'kv' && !data.stale
        ? 'var(--mc-state-live)'
        : data.source === 'kv' && data.stale
          ? 'var(--mc-warn)'
          : 'var(--mc-text-3)';

  const chipLabel = error
    ? 'fetch error'
    : !data
      ? 'loading…'
      : data.source === 'kv'
        ? `live · ${formatAge(data.lastRefreshedAt)}`
        : `static · ${data.lastDisclosedAt || 'no date'}`;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginLeft: 8,
        fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
        color: chipColor,
        verticalAlign: 'middle',
      }}
      role="status"
      aria-label={`Holdings freshness: ${chipLabel}`}
      title={
        data
          ? `source=${data.source}; lastRefreshedAt=${data.lastRefreshedAt}; count=${data.count}; stale=${data.stale}`
          : undefined
      }
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: chipColor,
          display: 'inline-block',
        }}
        aria-hidden
      />
      <span>{chipLabel}</span>
      <button
        type="button"
        onClick={() => refresh(false)}
        disabled={refreshing}
        className="mc-tap"
        style={{
          background: 'transparent',
          border: '1px solid var(--mc-border-0)',
          color: 'var(--mc-text-2)',
          borderRadius: 'var(--mc-radius-sm)',
          padding: '1px 6px',
          fontSize: 10,
          cursor: refreshing ? 'wait' : 'pointer',
          opacity: refreshing ? 0.6 : 1,
        }}
        aria-label="Refresh holdings"
      >
        {refreshing ? '…' : '↻'}
      </button>
    </span>
  );
}

export default HoldingsFreshnessChip;
