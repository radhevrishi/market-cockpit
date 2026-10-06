'use client';
// PATCH 1081d — Acronym tooltips on table headers.

import { useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Flag, Trophy,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DrilldownKB } from './DrilldownKB';
import { RotationTracker } from './RotationTracker';
import { SerenityChecklist } from './SerenityChecklist';
import { StockScanner } from './StockScanner';
import { TAB_META, GeoOverlay, ConferenceCalendar, SupplyChainMap } from './components';
import { TABS } from './constants';
import { useDashboard, useBNNews, useGeoNews, useUSQuotes, buildEnrichedStocks } from './helpers';
import { type Tab } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function BottleneckIntelPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Rotation');

  const { data: dashboard, isLoading: dashLoading, refetch: refetchDash, dataUpdatedAt: dashTs } = useDashboard();
  const { data: bnArticles = [], isLoading: bnLoading, refetch: refetchBN } = useBNNews();
  // AUDIT_100 #94 — only fire heavy Geo aggregate when user is on Geo tab.
  const { data: geoArticles = [], isLoading: geoLoading, refetch: refetchGeo } = useGeoNews(activeTab === 'Geo');
  const { data: usQuotes = [], isLoading: quotesLoading } = useUSQuotes(activeTab === 'Scanner');

  const lastRefreshed = useMemo(() => {
    if (!dashTs) return null;
    try { return formatDistanceToNow(new Date(dashTs), { addSuffix: true }); } catch { return null; }
  }, [dashTs]);

  const handleRefresh = useCallback(() => { refetchDash(); refetchBN(); refetchGeo(); }, [refetchDash, refetchBN, refetchGeo]);
  const isLoading = dashLoading || bnLoading;

  return (
    <div style={{ minHeight: '100%', backgroundColor: 'var(--mc-bg-0)' }}>

      {/* Header */}
      <div style={{ padding: '18px 20px 0', borderBottom: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-1)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
              <span style={{ fontSize: '20px' }}>🔬</span>
              <h1 style={{ fontSize: '18px', fontWeight: '800', margin: 0, letterSpacing: '-0.5px', background: 'linear-gradient(90deg,var(--mc-text-0) 60%,var(--mc-text-4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                BOTTLENECK INTELLIGENCE
              </h1>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', margin: 0 }}>
              Serenity 37-Model Framework · Live Supply Chain Analysis
              {lastRefreshed && <span> · Updated {lastRefreshed}</span>}
            </p>
          </div>
          <button onClick={handleRefresh} disabled={isLoading} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', cursor: isLoading ? 'default' : 'pointer', backgroundColor: 'transparent', border: '1px solid var(--mc-bg-4)', color: isLoading ? 'var(--mc-text-4)' : 'var(--mc-text-4)', fontSize: '12px', flexShrink: 0 }}>
            <RefreshCw className="w-3 h-3" style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            {isLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {TABS.map(tab => {
            const meta = TAB_META[tab];
            const active = activeTab === tab;
            return (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '9px 16px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: active ? 'var(--mc-accent)' : 'var(--mc-text-4)', fontSize: '12px', fontWeight: active ? '700' : '400', borderBottom: active ? '2px solid var(--mc-accent)' : '2px solid transparent', marginBottom: '-1px', flexShrink: 0, transition: 'all 0.15s' }}>
                {meta.icon}<span>{meta.short}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Description */}
      <div style={{ padding: '8px 20px', backgroundColor: '#060E1A', borderBottom: '1px solid var(--mc-bg-4)' }}>
        <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', margin: 0 }}>{TAB_META[activeTab].description}</p>
      </div>

      {/* Content */}
      {activeTab === 'Rotation'  && <RotationTracker dashboard={dashboard} isLoading={dashLoading} articles={bnArticles} />}
      {activeTab === 'Scanner'   && <StockScanner articles={bnArticles} isLoading={bnLoading} quotes={usQuotes} quotesLoading={quotesLoading} />}
      {activeTab === 'Drilldown' && <DrilldownKB articles={bnArticles} />}
      {activeTab === 'Geo'       && <GeoOverlay articles={geoArticles} isLoading={geoLoading} />}
      {activeTab === 'Calendar'  && <ConferenceCalendar />}
      {activeTab === 'Map'       && <ErrorBoundary context="Supply Chain Map"><SupplyChainMap dashboard={dashboard} articles={bnArticles ?? []} /></ErrorBoundary>}
      {activeTab === 'Checklist' && (() => {
        try {
          const enriched = buildEnrichedStocks(bnArticles ?? [], usQuotes ?? []);
          return <SerenityChecklist enriched={enriched} />;
        } catch { return <div style={{ padding: 20, color: 'var(--mc-text-4)' }}>Could not load checklist data. Try refreshing.</div>; }
      })()}
    </div>
  );
}
