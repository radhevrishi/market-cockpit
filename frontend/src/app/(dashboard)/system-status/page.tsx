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
  const [data, setData] = useState<{ summary: any; probes: ProbeResult[]; generated_at: string; signalsVersions?: any; anthropicSpend?: any; dataWatch?: any } | null>(null);
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
    return <div style={{ padding: 30, color: 'var(--mc-text-3)' }}>{loading ? '📡 Probing endpoints…' : 'Failed to load'}</div>;
  }

  const byCategory: Record<string, ProbeResult[]> = {};
  for (const p of data.probes) {
    if (!byCategory[p.category]) byCategory[p.category] = [];
    byCategory[p.category].push(p);
  }

  return (
    <div style={{ padding: 20, color: 'var(--mc-text-1)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>📡 System Status</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <PanelFreshness dataUpdatedAt={updatedAt} staleAfterMs={120_000} />
          <button onClick={fetchStatus} disabled={loading}
            style={{ padding: '6px 14px', fontSize: 12, borderRadius: 5, border: '1px solid var(--mc-bg-4)', background: loading ? 'var(--mc-bg-4)' : 'var(--mc-accent)', color: '#fff', fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
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

      {/* zzz749 — Data watch: did each pipeline PRODUCE data (not just run) */}
      {data.dataWatch !== undefined && (() => {
        const w = data.dataWatch;
        if (!w || w.error || !Array.isArray(w.checks)) {
          return (
            <div style={{ marginBottom: 22, padding: '10px 14px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, fontSize: 12, color: 'var(--mc-text-3)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>Data watch</div>
              {w?.error ? `unavailable: ${w.error}` : 'no run recorded yet — the data-watch workflow runs at 11:00 IST, 16:00 IST and 10:30 ET'}
            </div>
          );
        }
        const ageMin = Math.round((Date.now() - Date.parse(w.ran_at)) / 60000);
        const color = (lvl: string) => lvl === 'fail' ? 'var(--mc-bearish)' : lvl === 'warn' ? 'var(--mc-warn)' : 'var(--mc-bullish)';
        return (
          <div style={{ marginBottom: 22, padding: '10px 14px', background: 'var(--mc-bg-1)', border: `1px solid ${w.fails ? 'var(--mc-bearish)' : 'var(--mc-bg-4)'}`, borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
              Data watch · {w.ist_date} · ran {ageMin}m ago · <span style={{ color: color(w.fails ? 'fail' : w.warns ? 'warn' : 'ok') }}>{w.fails} failing · {w.warns} warning · {w.healed} self-healed</span>{w.alerted ? ' · Telegram sent' : ''}
            </div>
            <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
              {w.checks.map((c: any) => (
                <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '10px 1fr', gap: 8, alignItems: 'start' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, background: color(c.level) }} />
                  <div>
                    <b style={{ color: '#E2E8F0' }}>{c.name}</b> <span style={{ color: 'var(--mc-text-3)' }}>— {c.detail}</span>
                    {c.healed && <div style={{ color: 'var(--mc-bullish)', fontSize: 11 }}>↻ {c.healed}</div>}
                    {c.action && <div style={{ color: 'var(--mc-warn)', fontSize: 11 }}>→ {c.action}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* zzz747 — Anthropic spend this month, per feature, from the API's own usage counts */}
      {data.anthropicSpend && !data.anthropicSpend.error && (() => {
        const sp = data.anthropicSpend;
        const cap = Number(sp.cap_usd || 0);
        const pct = cap > 0 ? Math.min(100, (Number(sp.total_usd || 0) / cap) * 100) : 0;
        const rows = Object.entries(sp.by_feature || {}) as Array<[string, any]>;
        rows.sort((a, b) => Number(b[1].usd) - Number(a[1].usd));
        const barColor = pct >= 90 ? 'var(--mc-bearish)' : pct >= 60 ? 'var(--mc-warn)' : 'var(--mc-bullish)';
        return (
          <div style={{ marginBottom: 22, padding: '10px 14px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
              Anthropic spend · {sp.month}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: '#E2E8F0', fontFamily: 'ui-monospace, monospace', alignItems: 'center' }}>
              <span><span style={{ color: 'var(--mc-text-3)' }}>month to date:</span> <b style={{ color: barColor }}>${Number(sp.total_usd || 0).toFixed(2)}</b> <span style={{ color: 'var(--mc-text-3)' }}>of ${cap} cap</span></span>
              <span><span style={{ color: 'var(--mc-text-3)' }}>calls:</span> <b>{sp.calls}</b></span>
              {sp.blocked > 0 && <span><span style={{ color: 'var(--mc-text-3)' }}>blocked by cap:</span> <b style={{ color: 'var(--mc-bearish)' }}>{sp.blocked}</b></span>}
              {sp.unrecorded > 0 && <span><span style={{ color: 'var(--mc-text-3)' }}>unrecorded (KV miss):</span> <b>{sp.unrecorded}</b></span>}
              <span style={{ flexBasis: '100%', height: 4, background: 'var(--mc-bg-4)', borderRadius: 2, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: barColor }} />
              </span>
            </div>
            {rows.length > 0 && (
              <table style={{ marginTop: 8, fontSize: 11, fontFamily: 'ui-monospace, monospace', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--mc-text-3)', textAlign: 'left' }}>
                    <th style={{ paddingRight: 16, fontWeight: 600 }}>feature</th>
                    <th style={{ paddingRight: 16, fontWeight: 600, textAlign: 'right' }}>calls</th>
                    <th style={{ paddingRight: 16, fontWeight: 600, textAlign: 'right' }}>in tok</th>
                    <th style={{ paddingRight: 16, fontWeight: 600, textAlign: 'right' }}>out tok</th>
                    <th style={{ paddingRight: 16, fontWeight: 600, textAlign: 'right' }}>$ / call</th>
                    <th style={{ fontWeight: 600, textAlign: 'right' }}>$ month</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([name, f]) => (
                    <tr key={name} style={{ color: '#E2E8F0' }}>
                      <td style={{ paddingRight: 16 }}>{name}</td>
                      <td style={{ paddingRight: 16, textAlign: 'right' }}>{f.calls}</td>
                      <td style={{ paddingRight: 16, textAlign: 'right' }}>{Number(f.input_tokens).toLocaleString()}</td>
                      <td style={{ paddingRight: 16, textAlign: 'right' }}>{Number(f.output_tokens).toLocaleString()}</td>
                      <td style={{ paddingRight: 16, textAlign: 'right' }}>{f.calls ? (Number(f.usd) / Number(f.calls)).toFixed(4) : '—'}</td>
                      <td style={{ textAlign: 'right' }}><b>{Number(f.usd).toFixed(2)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--mc-text-3)' }}>
              Priced from each response's usage block (Haiku 4.5: $1 in / $5 out per M tokens). Cap = ANTHROPIC_MONTHLY_CAP_USD (default 60); at the cap every model call is refused with a labelled error, nothing runs unmetered.
            </div>
          </div>
        );
      })()}

      {/* PATCH 0853 — Signals compute/filter/universe version stamps */}
      {data.signalsVersions && (
        <div style={{ marginBottom: 22, padding: '10px 14px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6 }}>
          <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
            Signals build stamp
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: '#E2E8F0', fontFamily: 'ui-monospace, monospace' }}>
            <span><span style={{ color: 'var(--mc-text-3)' }}>compute:</span> <b>v{data.signalsVersions.computeVersion}</b></span>
            <span><span style={{ color: 'var(--mc-text-3)' }}>filter:</span> <b>v{data.signalsVersions.filterVersion}</b></span>
            <span><span style={{ color: 'var(--mc-text-3)' }}>universe:</span> <b>{data.signalsVersions.universeVersion}</b></span>
            <span><span style={{ color: 'var(--mc-text-3)' }}>last compute:</span> <b style={{ color: typeof data.signalsVersions.computedAgeMin === 'number' && data.signalsVersions.computedAgeMin > 60 ? 'var(--mc-bearish)' : 'var(--mc-bullish)' }}>
              {data.signalsVersions.computedAgeMin == null ? '—' : `${data.signalsVersions.computedAgeMin}m ago`}
            </b></span>
            <span><span style={{ color: 'var(--mc-text-3)' }}>signals:</span> <b>{data.signalsVersions.signalCount}</b></span>
            {data.signalsVersions.signalHashShort && (
              <span><span style={{ color: 'var(--mc-text-3)' }}>hash:</span> <b>{data.signalsVersions.signalHashShort}</b></span>
            )}
          </div>
          {typeof data.signalsVersions.computedAgeMin === 'number' && data.signalsVersions.computedAgeMin > 60 && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--mc-warn)' }}>
              ⚠ Last compute is older than 1 hour — cron may have stalled. Try <code style={{ background: 'var(--mc-bg-4)', padding: '1px 4px', borderRadius: 2 }}>/api/market/intelligence/compute?clearLock=1</code>
            </div>
          )}
        </div>
      )}

      {/* Probes by category */}
      {Object.entries(byCategory).map(([cat, probes]) => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{cat}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {probes.map((p) => (
              <div key={p.name} style={{
                padding: 10, background: 'var(--mc-bg-1)', border: `1px solid ${COLOR[p.status]}55`,
                borderLeft: `4px solid ${COLOR[p.status]}`, borderRadius: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)' }}>{p.name}</div>
                  <span style={{ fontSize: 9, color: COLOR[p.status], fontWeight: 800, padding: '2px 6px', background: `${COLOR[p.status]}22`, borderRadius: 3 }}>{p.status}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginTop: 4 }}>
                  {p.latencyMs}ms{p.recordCount !== undefined && ` · ${p.recordCount} records`}
                  {p.httpCode !== 200 && p.httpCode != null && ` · HTTP ${p.httpCode}`}
                  {p.error && ` · ${p.error.slice(0, 30)}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 16, fontStyle: 'italic' }}>
        Probes refresh every 30s. Cached at edge for 60s. Built {data.generated_at ? new Date(data.generated_at).toLocaleString('en-IN') : '—'}.
      </div>
    </div>
  );
}
