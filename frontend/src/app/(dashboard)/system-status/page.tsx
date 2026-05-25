// PATCH 0840 — system status dashboard. Probes every critical data
// endpoint and shows healthy / degraded / empty / down. Refreshes every
// 30s. Institutional ops view of the app itself.
'use client';

import { useEffect, useState } from 'react';
import { PanelFreshness } from '@/components/PanelFreshness';

interface ProbeResult {
  name: string;
  category: string;
  status: 'HEALTHY' | 'DEGRADED' | 'EMPTY' | 'DOWN';
  httpCode?: number;
  latencyMs: number;
  recordCount?: number;
  error?: string;
}

const COLOR: Record<string, string> = {
  HEALTHY:  '#10B981',
  DEGRADED: '#F59E0B',
  EMPTY:    '#94A3B8',
  DOWN:     '#EF4444',
};

export default function SystemStatusPage() {
  const [data, setData] = useState<{ summary: any; probes: ProbeResult[]; generated_at: string; signalsVersions?: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number>(0);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/v1/system-status?_=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      setData(j);
      setUpdatedAt(Date.now());
    } catch (e) {/* swallow */}
    setLoading(false);
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!data) {
    return <div style={{ padding: 30, color: '#94A3B8' }}>{loading ? '📡 Probing endpoints…' : 'Failed to load'}</div>;
  }

  const byCategory: Record<string, ProbeResult[]> = {};
  for (const p of data.probes) {
    if (!byCategory[p.category]) byCategory[p.category] = [];
    byCategory[p.category].push(p);
  }

  return (
    <div style={{ padding: 20, color: '#E6EDF3', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>📡 System Status</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <PanelFreshness dataUpdatedAt={updatedAt} staleAfterMs={120_000} />
          <button onClick={fetchStatus} disabled={loading}
            style={{ padding: '6px 14px', fontSize: 12, borderRadius: 5, border: '1px solid #1A2540', background: loading ? '#1A2540' : '#0F7ABF', color: '#fff', fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? '...' : '↻ Re-probe'}
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {(['healthy', 'degraded', 'empty', 'down'] as const).map((tier) => {
          const count = (data.summary as any)[tier];
          const color = COLOR[tier.toUpperCase()];
          return (
            <div key={tier} style={{
              padding: '10px 16px', background: `${color}15`, border: `1px solid ${color}55`,
              borderRadius: 8, minWidth: 100,
            }}>
              <div style={{ fontSize: 11, color: color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{tier}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: color, fontVariantNumeric: 'tabular-nums' }}>{count}</div>
            </div>
          );
        })}
      </div>

      {/* PATCH 0853 — Signals compute/filter/universe version stamps */}
      {data.signalsVersions && (
        <div style={{ marginBottom: 22, padding: '10px 14px', background: '#0D1623', border: '1px solid #1A2540', borderRadius: 6 }}>
          <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
            Signals build stamp
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: '#E2E8F0', fontFamily: 'ui-monospace, monospace' }}>
            <span><span style={{ color: '#94A3B8' }}>compute:</span> <b>v{data.signalsVersions.computeVersion}</b></span>
            <span><span style={{ color: '#94A3B8' }}>filter:</span> <b>v{data.signalsVersions.filterVersion}</b></span>
            <span><span style={{ color: '#94A3B8' }}>universe:</span> <b>{data.signalsVersions.universeVersion}</b></span>
            <span><span style={{ color: '#94A3B8' }}>last compute:</span> <b style={{ color: typeof data.signalsVersions.computedAgeMin === 'number' && data.signalsVersions.computedAgeMin > 60 ? '#EF4444' : '#10B981' }}>
              {data.signalsVersions.computedAgeMin == null ? '—' : `${data.signalsVersions.computedAgeMin}m ago`}
            </b></span>
            <span><span style={{ color: '#94A3B8' }}>signals:</span> <b>{data.signalsVersions.signalCount}</b></span>
            {data.signalsVersions.signalHashShort && (
              <span><span style={{ color: '#94A3B8' }}>hash:</span> <b>{data.signalsVersions.signalHashShort}</b></span>
            )}
          </div>
          {typeof data.signalsVersions.computedAgeMin === 'number' && data.signalsVersions.computedAgeMin > 60 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#F59E0B' }}>
              ⚠ Last compute is older than 1 hour — cron may have stalled. Try <code style={{ background: '#1A2540', padding: '1px 4px', borderRadius: 2 }}>/api/market/intelligence/compute?clearLock=1</code>
            </div>
          )}
        </div>
      )}

      {/* Probes by category */}
      {Object.entries(byCategory).map(([cat, probes]) => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{cat}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {probes.map((p) => (
              <div key={p.name} style={{
                padding: 10, background: '#0D1623', border: `1px solid ${COLOR[p.status]}55`,
                borderLeft: `4px solid ${COLOR[p.status]}`, borderRadius: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#E6EDF3' }}>{p.name}</div>
                  <span style={{ fontSize: 9, color: COLOR[p.status], fontWeight: 800, padding: '2px 6px', background: `${COLOR[p.status]}22`, borderRadius: 3 }}>{p.status}</span>
                </div>
                <div style={{ fontSize: 10, color: '#8A95A3', marginTop: 4 }}>
                  {p.latencyMs}ms{p.recordCount !== undefined && ` · ${p.recordCount} records`}
                  {p.httpCode !== 200 && p.httpCode != null && ` · HTTP ${p.httpCode}`}
                  {p.error && ` · ${p.error.slice(0, 30)}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 16, fontStyle: 'italic' }}>
        Probes refresh every 30s. Cached at edge for 60s. Built {new Date(data.generated_at).toLocaleString('en-IN')}.
      </div>
    </div>
  );
}
