'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS HUB — patch 0091
//
// Merges the four-way earnings cluster into one tab with sub-tabs:
//   Calendar     — monthly earnings calendar grid (was /calendars)
//   Scan         — quarterly grade grid (Beat / Miss / Mixed) (was /earnings)
//   Guidance     — last-45-day earnings + guidance signals (was /earnings-guidance)
//   Concall AI   — concall transcript + filing PDF AI report (was /earnings-analysis)
//
// All four shared the same universe (portfolio + watchlist) and same data
// model. Keeping them as separate sidebar entries forced the user to mentally
// reconcile four near-identical surfaces.  This hub mirrors the same
// internal-tab pattern used by bottleneck-intel.
//
// Old routes are KEPT alive for deeplink compatibility.  Only the active
// sub-tab mounts so hidden tabs do not run their (often expensive) queries.
// ═══════════════════════════════════════════════════════════════════════════

import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Calendar, LineChart, BarChart3, Microscope } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

const CalendarPage  = dynamic(() => import('../calendars/page'),         { ssr: false, loading: () => <PanelLoader label="Calendar" /> });
const ScanPage      = dynamic(() => import('../earnings/page'),          { ssr: false, loading: () => <PanelLoader label="Scan" /> });
const GuidancePage  = dynamic(() => import('../earnings-guidance/page'), { ssr: false, loading: () => <PanelLoader label="Guidance" /> });
const ConcallAIPage = dynamic(() => import('../earnings-analysis/page'), { ssr: false, loading: () => <PanelLoader label="Concall AI" /> });

type Tab = 'calendar' | 'scan' | 'guidance' | 'concall';

const TABS: ReadonlyArray<{
  id: Tab;
  label: string;
  Icon: typeof Calendar;
  tagline: string;
}> = [
  { id: 'calendar', label: 'Calendar',   Icon: Calendar,   tagline: 'Monthly earnings calendar — what reports, when, with quality grade' },
  { id: 'scan',     label: 'Scan',       Icon: LineChart,  tagline: 'Quarterly Revenue / Margin / EPS grid for portfolio + watchlist' },
  { id: 'guidance', label: 'Guidance',   Icon: BarChart3,  tagline: 'Last-45-day guidance signals — revenue / margin / capex / operating leverage' },
  { id: 'concall',  label: 'Concall AI', Icon: Microscope, tagline: 'Upload concall transcript or filing PDF — AI institutional report' },
];

function PanelLoader({ label }: { label: string }) {
  return (
    <div style={{ padding: 24, color: '#6B7A8D', fontSize: 12 }}>
      Loading {label}…
    </div>
  );
}

export default function EarningsHubPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initial = (searchParams?.get('tab') as Tab) || 'calendar';
  const [active, setActive] = useState<Tab>(initial);

  // Keep URL in sync so refresh / share preserves the active sub-tab
  useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (sp.get('tab') !== active) {
      sp.set('tab', active);
      router.replace(`/earnings-hub?${sp.toString()}`, { scroll: false });
    }
  }, [active, searchParams, router]);

  const activeMeta = TABS.find((t) => t.id === active) || TABS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div
        style={{
          backgroundColor: '#0D1B2E',
          borderBottom: '1px solid #1E2D45',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: '#10B981', letterSpacing: '0.6px', marginRight: 12 }}>
          📈 EARNINGS HUB
        </span>
        {TABS.map(({ id, label, Icon }) => {
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
                border: isActive ? '1px solid #10B98160' : '1px solid #1A2840',
                backgroundColor: isActive ? '#10B98120' : 'transparent',
                color: isActive ? '#10B981' : '#8A95A3',
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
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4A5B6C', maxWidth: 480, textAlign: 'right' }}>
          {activeMeta.tagline}
        </span>
      </div>

      {/* Active panel */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Suspense fallback={<PanelLoader label={activeMeta.label} />}>
          {active === 'calendar' && <CalendarPage />}
          {active === 'scan'     && <ScanPage />}
          {active === 'guidance' && <GuidancePage />}
          {active === 'concall'  && <ConcallAIPage />}
        </Suspense>
      </div>
    </div>
  );
}
