// ═══════════════════════════════════════════════════════════════════════════
// PATCH zzz67 — System Health page.
//
// One-screen self-service checkup. Designed for the user who will lose AI
// access in 2 days and needs to monitor everything without writing code.
//
// Every card has:
//   - Live status (green/yellow/red)
//   - Per-item details
//   - INLINE troubleshooting (plain English, no jargon)
//   - Direct links to GitHub/CF/Railway
//
// Refreshes every 60 seconds. Manual refresh button.
// ═══════════════════════════════════════════════════════════════════════════
'use client';

import { useEffect, useState, useCallback } from 'react';

type ItemStatus = 'ok' | 'warn' | 'fail';
type SectionStatus = 'healthy' | 'degraded' | 'critical';

interface HealthItem {
  name: string;
  status: ItemStatus;
  url?: string;
  details?: string;
  latency_ms?: number;
}
interface HealthSection {
  name: string;
  status: SectionStatus;
  items: HealthItem[];
  troubleshooting: string[];
  links?: Array<{ label: string; url: string }>;
}
interface HealthPayload {
  generated_at: string;
  overall_status: SectionStatus;
  sections: HealthSection[];
  links: Array<{ label: string; url: string }>;
}

const COLOR = {
  ok:       '#10B981',
  warn:     '#F59E0B',
  fail:     '#EF4444',
  healthy:  '#10B981',
  degraded: '#F59E0B',
  critical: '#EF4444',
};

const STATUS_LABEL: Record<SectionStatus, string> = {
  healthy:  'ALL SYSTEMS HEALTHY',
  degraded: 'DEGRADED — SOMETHING NEEDS ATTENTION',
  critical: 'CRITICAL — IMMEDIATE ACTION REQUIRED',
};

const ITEM_GLYPH: Record<ItemStatus, string> = {
  ok:   '✓',
  warn: '!',
  fail: 'X',
};

function StatusDot({ s, size = 10 }: { s: ItemStatus | SectionStatus; size?: number }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: (COLOR as any)[s] || '#94A3B8', verticalAlign: 'middle',
    }} />
  );
}

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

export default function SystemHealthPage() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/v1/system-health?_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 60_000);
    return () => clearInterval(id);
  }, [fetchHealth]);

  // Initial expand: any non-healthy section auto-opens so problems are visible.
  useEffect(() => {
    if (!data) return;
    const next: Record<string, boolean> = { ...expanded };
    let changed = false;
    for (const s of data.sections) {
      if (s.status !== 'healthy' && next[s.name] === undefined) {
        next[s.name] = true;
        changed = true;
      }
    }
    if (changed) setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.generated_at]);

  if (!data && loading) {
    return <div style={{ padding: 30, color: 'var(--mc-text-3)' }}>Loading system health…</div>;
  }
  if (!data) {
    return (
      <div style={{ padding: 30, color: 'var(--mc-text-3)' }}>
        <div style={{ marginBottom: 12 }}>Could not load health data: {error || 'unknown error'}</div>
        <button onClick={fetchHealth} style={btnStyle()}>Retry</button>
      </div>
    );
  }

  const overall = data.overall_status;

  return (
    <div style={{ padding: 20, color: 'var(--mc-text-1)', fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1100, margin: '0 auto' }}>

      {/* ─── Header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>System Health</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: 'var(--mc-text-3)' }}>
          <span>Last updated {timeAgo(data.generated_at)}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>Auto-refresh 60s</span>
          <button onClick={fetchHealth} disabled={loading} style={btnStyle(loading)}>
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ─── Overall status banner ───────────────────────────────────── */}
      <div style={{
        padding: '20px 24px',
        background: `${COLOR[overall]}15`,
        border: `2px solid ${COLOR[overall]}`,
        borderRadius: 10,
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <StatusDot s={overall} size={22} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: COLOR[overall], letterSpacing: 0.5 }}>
            {STATUS_LABEL[overall]}
          </div>
          <div style={{ fontSize: 12, color: 'var(--mc-text-3)', marginTop: 4 }}>
            {data.sections.length} sections checked · {data.sections.flatMap(s => s.items).length} probes ·{' '}
            generated at {new Date(data.generated_at).toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* ─── Top-level links ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {data.links.map(l => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={linkChipStyle()}>
            {l.label} ↗
          </a>
        ))}
      </div>

      {/* ─── Sections ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.sections.map(section => {
          const isOpen = expanded[section.name] ?? false;
          return (
            <div key={section.name} style={cardStyle(section.status)}>
              {/* Card header — always visible */}
              <button
                onClick={() => setExpanded(e => ({ ...e, [section.name]: !isOpen }))}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'transparent', border: 'none', color: 'inherit', padding: 0, cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <StatusDot s={section.status} size={14} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{section.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginTop: 2 }}>
                      {section.items.filter(i => i.status === 'ok').length} ok ·{' '}
                      {section.items.filter(i => i.status === 'warn').length} warn ·{' '}
                      {section.items.filter(i => i.status === 'fail').length} fail
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>
                  {isOpen ? 'Hide details ▲' : 'Show details ▼'}
                </div>
              </button>

              {isOpen && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--mc-bg-4)' }}>
                  {/* Items table */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {section.items.map(item => (
                      <div key={item.name} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        padding: '8px 10px', background: 'var(--mc-bg-1)', borderRadius: 5,
                        borderLeft: `3px solid ${COLOR[item.status]}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                          <span style={{
                            fontFamily: 'monospace', fontWeight: 700, color: COLOR[item.status],
                            width: 16, textAlign: 'center', flexShrink: 0,
                          }}>{ITEM_GLYPH[item.status]}</span>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</span>
                          {item.details && (
                            <span style={{ fontSize: 11, color: 'var(--mc-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              · {item.details}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--mc-text-3)', flexShrink: 0 }}>
                          {item.latency_ms != null && <span>{item.latency_ms}ms</span>}
                          {item.url && (
                            <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-accent)', textDecoration: 'none' }}>open ↗</a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Troubleshooting — inline manual */}
                  <div style={{
                    background: 'var(--mc-bg-1)',
                    border: '1px solid var(--mc-bg-4)',
                    borderRadius: 6, padding: 12,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--mc-text-3)', marginBottom: 8 }}>
                      What to do
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55, color: 'var(--mc-text-2)' }}>
                      {section.troubleshooting.map((t, i) => (
                        <li key={i} style={{ marginBottom: 6 }}>{t}</li>
                      ))}
                    </ol>
                    {section.links && section.links.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--mc-bg-4)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {section.links.map(l => (
                          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={linkChipStyle()}>
                            {l.label} ↗
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Footer note ─────────────────────────────────────────────── */}
      <div style={{
        marginTop: 28, padding: 14, fontSize: 12, color: 'var(--mc-text-3)',
        background: 'var(--mc-bg-1)', border: '1px dashed var(--mc-bg-4)', borderRadius: 6, lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--mc-text-2)' }}>How to use this page:</strong> Green dot = working. Yellow = degraded but not down. Red = broken, action needed.
        Each card expands to show exactly what to check and direct links to fix it. This page calls the same endpoints your users see, so what you see here is what they see.
      </div>

    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
function btnStyle(loading = false): React.CSSProperties {
  return {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid var(--mc-bg-4)',
    background: loading ? 'var(--mc-bg-4)' : 'var(--mc-accent)',
    color: '#fff', fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
  };
}

function linkChipStyle(): React.CSSProperties {
  return {
    fontSize: 12, padding: '4px 10px', borderRadius: 4,
    background: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--mc-accent) 38%, transparent)',
    color: 'var(--mc-accent)', textDecoration: 'none', fontWeight: 600,
  };
}

function cardStyle(s: SectionStatus): React.CSSProperties {
  return {
    background: 'var(--mc-bg-2)',
    border: '1px solid var(--mc-bg-4)',
    borderLeft: `4px solid ${COLOR[s]}`,
    borderRadius: 8,
    padding: 16,
  };
}
