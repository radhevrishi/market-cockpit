'use client';

// ═══════════════════════════════════════════════════════════════════════════
// MARKET SNAPSHOT — patch 0090
//
// Merges /heatmap and /movers into a single tab with a toggle.  Both tabs draw
// from the same /api/market/quotes endpoint with different visual treatment;
// keeping them as separate sidebar entries was redundant.
//
// The original routes /heatmap and /movers are KEPT alive for deeplink
// compatibility — this page just dynamic-imports their components and
// conditionally renders one based on a ?tab=heatmap|movers URL param.
// Only the active tab mounts, so the hidden tab does not run its queries.
// ═══════════════════════════════════════════════════════════════════════════

import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Grid3X3, TrendingUp } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

const HeatmapPage = dynamic(() => import('../heatmap/page'), {
  ssr: false,
  loading: () => <PanelLoader label="Heatmap" />,
});
const MoversPage = dynamic(() => import('../movers/page'), {
  ssr: false,
  loading: () => <PanelLoader label="Movers" />,
});

type Tab = 'heatmap' | 'movers';

function PanelLoader({ label }: { label: string }) {
  return (
    <div style={{ padding: 24, color: 'var(--mc-text-4)', fontSize: 12 }}>
      Loading {label}…
    </div>
  );
}

export default function MarketSnapshotPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams?.get('tab') as Tab) || 'heatmap';
  const [active, setActive] = useState<Tab>(initialTab);

  // Keep URL in sync so a refresh / share preserves the active sub-tab
  useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (sp.get('tab') !== active) {
      sp.set('tab', active);
      router.replace(`/market-snapshot?${sp.toString()}`, { scroll: false });
    }
  }, [active, searchParams, router]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div
        style={{
          backgroundColor: 'var(--mc-bg-1)',
          borderBottom: '1px solid var(--mc-border-1)',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-cyan)', letterSpacing: '0.6px', marginRight: 12 }}>
          📊 MARKET SNAPSHOT
        </span>
        {([
          { id: 'heatmap', label: 'Heatmap', Icon: Grid3X3 },
          { id: 'movers',  label: 'Movers',  Icon: TrendingUp },
        ] as const).map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => setActive(id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: isActive ? '1px solid #0F7ABF60' : '1px solid var(--mc-bg-4)',
                backgroundColor: isActive ? '#0F7ABF20' : 'transparent',
                color: isActive ? '#38A9E8' : 'var(--mc-text-3)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.4px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <Icon style={{ width: 14, height: 14 }} />
              {label.toUpperCase()}
            </button>
          );
        })}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-text-4)' }}>
          Same data — different lens. Heatmap = sector treemap · Movers = top gainers / losers grid.
        </span>
      </div>

      {/* Active panel */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Suspense fallback={<PanelLoader label={active} />}>
          {active === 'heatmap' ? <HeatmapPage /> : <MoversPage />}
        </Suspense>
      </div>
    </div>
  );
}
