// ═══════════════════════════════════════════════════════════════════════════
// PATCH zzz69 — System Health page (real numbers + visual polish).
//
// One-screen self-service checkup. Designed for the user who will lose AI
// access in 2 days and needs to monitor everything without writing code.
//
// zzz69 changes over zzz68:
//   - Executive summary card at the very top ("All systems within free-tier
//     limits. Largest consumer: CF KV writes at 37%. No action needed.")
//   - Resource section now shows PROGRESS BARS (visual % filled) with
//     colour-coded fill (green <50%, yellow 50-80%, red >80%)
//   - Compact metric chips in section headers (e.g. "4.5% used")
//   - Removed "Unknown — check dashboard" — replaced with honest estimates
//     and a small "estimated" / "live" badge so the source is clear
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
  description?: string;
  limit?: string;
  current?: string;
  percent?: number | null;
}
interface HealthSection {
  name: string;
  status: SectionStatus;
  items: HealthItem[];
  troubleshooting: string[];
  links?: Array<{ label: string; url: string }>;
  kind?: 'standard' | 'resources';
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
  // zzz68 polish: guard against expanding empty sections (no items yet → loading)
  useEffect(() => {
    if (!data) return;
    const next: Record<string, boolean> = { ...expanded };
    let changed = false;
    for (const s of data.sections) {
      if (s.items.length === 0) continue;  // zzz68: skip empty/loading sections
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

  // zzz69: Pull the resources section so we can build an executive summary.
  const resourcesSection = data.sections.find(s => s.kind === 'resources');
  const resourceItems = resourcesSection?.items || [];
  const largestConsumer = [...resourceItems]
    .filter(i => typeof i.percent === 'number' && (i.percent ?? 0) > 0)
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0];
  const allHealthy = resourceItems.every(i => i.status === 'ok' || (i.percent ?? 0) < 50);
  const execSummary = (() => {
    if (resourceItems.length === 0) return null;
    if (largestConsumer && (largestConsumer.percent ?? 0) > 80) {
      return `CRITICAL: ${largestConsumer.name} at ${largestConsumer.percent}% of free tier. Action required.`;
    }
    if (largestConsumer && (largestConsumer.percent ?? 0) > 50) {
      return `Watch ${largestConsumer.name} at ${largestConsumer.percent}%. Approaching free-tier ceiling — plan a fix.`;
    }
    if (largestConsumer) {
      return `All systems within free-tier limits. Largest consumer: ${largestConsumer.name} at ${largestConsumer.percent}%. No action needed.`;
    }
    return allHealthy ? 'All systems within free-tier limits. No action needed.' : null;
  })();

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

      {/* ─── zzz69: Executive summary card ───────────────────────────── */}
      {execSummary && (
        <div style={{
          padding: '14px 18px',
          background: 'var(--mc-bg-2)',
          border: '1px solid var(--mc-bg-4)',
          borderLeft: `4px solid ${allHealthy ? COLOR.ok : COLOR.warn}`,
          borderRadius: 8,
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
            color: allHealthy ? COLOR.ok : COLOR.warn,
            padding: '3px 8px', borderRadius: 4,
            background: `${allHealthy ? COLOR.ok : COLOR.warn}18`,
            whiteSpace: 'nowrap',
          }}>
            Executive Summary
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--mc-text-1)', fontWeight: 500, lineHeight: 1.5 }}>
            {execSummary}
          </div>
        </div>
      )}

      {/* ─── zzz69: Resource chips row (compact metric banner) ───────── */}
      {resourceItems.length > 0 && (
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18,
          padding: '10px 14px',
          background: 'var(--mc-bg-1)',
          border: '1px dashed var(--mc-bg-4)',
          borderRadius: 8,
        }}>
          {resourceItems
            .filter(i => typeof i.percent === 'number')
            .map(i => (
            <ResourceChip key={i.name} item={i} />
          ))}
        </div>
      )}

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
          const isResources = section.kind === 'resources';
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
                  {isResources ? (
                    <ResourcesTable items={section.items} />
                  ) : (
                    <StandardItemList items={section.items} />
                  )}

                  {/* Troubleshooting — inline manual */}
                  <div style={{
                    background: 'var(--mc-bg-1)',
                    border: '1px solid var(--mc-bg-4)',
                    borderRadius: 6, padding: 12, marginTop: 16,
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
        Each card expands to show exactly what each item is for, which pages use it, and how to fix it. This page calls the same endpoints your users see, so what you see here is what they see.
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Standard item list (Workers, Workflows, Data Freshness)
// Shows: status glyph, name, details, AND the new description line.
// ═══════════════════════════════════════════════════════════════════════════
function StandardItemList({ items }: { items: HealthItem[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(item => (
        <div key={item.name} style={{
          display: 'flex', flexDirection: 'column', gap: 4,
          padding: '10px 12px', background: 'var(--mc-bg-1)', borderRadius: 5,
          borderLeft: `3px solid ${COLOR[item.status]}`,
        }}>
          {/* Top row: status + name + details + latency + link */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
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
          {/* zzz68: Description row — "What this is for + which page uses it" */}
          {item.description && (
            <div style={{
              fontSize: 11.5, lineHeight: 1.5, color: 'var(--mc-text-3)',
              paddingLeft: 26, paddingRight: 4, marginTop: 2,
            }}>
              {item.description}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Resources table — zzz69
// Now ships with PROGRESS BARS (visual % filled) + colour-coded thresholds.
//   green  <50% (safe)
//   yellow 50-80% (watch)
//   red    >80% (over)
// Each row: name + limit + current (with source tag) + progress bar + status pill.
// ═══════════════════════════════════════════════════════════════════════════

// Colour for a progress bar based on percent filled.
function barColor(p: number | null | undefined): string {
  if (p == null) return '#94A3B8';
  if (p > 80) return COLOR.fail;
  if (p > 50) return COLOR.warn;
  return COLOR.ok;
}

// Inline progress bar.
function ProgressBar({ percent, height = 8 }: { percent: number | null | undefined; height?: number }) {
  const p = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const c = barColor(percent);
  return (
    <div style={{
      width: '100%', height, borderRadius: height / 2,
      background: 'var(--mc-bg-4)', overflow: 'hidden', position: 'relative',
    }}>
      <div style={{
        width: `${p}%`, height: '100%',
        background: c,
        borderRadius: height / 2,
        transition: 'width 600ms ease, background 600ms ease',
      }} />
    </div>
  );
}

// Compact chip used in the metric banner row at top of page.
function ResourceChip({ item }: { item: HealthItem }) {
  const p = item.percent;
  const c = barColor(p);
  return (
    <div style={{
      display: 'inline-flex', flexDirection: 'column', gap: 4,
      padding: '6px 10px', borderRadius: 6,
      background: 'var(--mc-bg-2)',
      border: `1px solid ${c}55`,
      minWidth: 130,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-text-2)' }}>{item.name}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: c }}>{p != null ? `${p}%` : '—'}</span>
      </div>
      <ProgressBar percent={p} height={5} />
    </div>
  );
}

function ResourcesTable({ items }: { items: HealthItem[] }) {
  const safeBadge = (s: ItemStatus, p: number | null) => {
    const label = s === 'ok' ? '✓ Safe' : s === 'warn' ? '⚠ Watch' : '✗ Over';
    return (
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 4,
        background: `${COLOR[s]}22`, color: COLOR[s], whiteSpace: 'nowrap',
        border: `1px solid ${COLOR[s]}55`,
      }}>
        {label}{p != null ? ` ${p}%` : ''}
      </span>
    );
  };

  // Helper to detect whether "current" string carries a live/estimated/observed source tag.
  const sourceTag = (current?: string): { label: string; color: string } | null => {
    if (!current) return null;
    const c = current.toLowerCase();
    if (c.includes('live')) return { label: 'live', color: COLOR.ok };
    if (c.includes('observed')) return { label: 'observed', color: COLOR.ok };
    if (c.includes('estimate')) return { label: 'estimated', color: COLOR.warn };
    if (c.includes('unlimited')) return { label: 'unlimited', color: COLOR.ok };
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(item => {
        const tag = sourceTag(item.current);
        return (
          <div key={item.name} style={{
            padding: '12px 14px', background: 'var(--mc-bg-1)', borderRadius: 6,
            borderLeft: `3px solid ${COLOR[item.status]}`,
          }}>
            {/* Top row: name on the left, status pill on the right */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{item.name}</span>
                  {tag && (
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
                      padding: '2px 6px', borderRadius: 3,
                      background: `${tag.color}18`, color: tag.color,
                      border: `1px solid ${tag.color}44`,
                    }}>
                      {tag.label}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>
                  Limit: {item.limit || '—'}
                </div>
              </div>
              {safeBadge(item.status, item.percent ?? null)}
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: 8 }}>
              <ProgressBar percent={item.percent} height={8} />
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 11, color: 'var(--mc-text-2)', marginTop: 4,
              }}>
                <span>{item.current || '—'}</span>
                <span style={{ color: barColor(item.percent), fontWeight: 700 }}>
                  {item.percent != null ? `${item.percent}% of limit` : ''}
                </span>
              </div>
            </div>

            {/* Description sub-row */}
            {item.description && (
              <div style={{
                fontSize: 11.5, lineHeight: 1.5, color: 'var(--mc-text-3)',
                marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--mc-bg-4)',
              }}>
                {item.description}
              </div>
            )}

            {/* Detail / methodology line */}
            {item.details && (
              <div style={{
                fontSize: 10.5, lineHeight: 1.5, color: 'var(--mc-text-3)',
                marginTop: 6, fontStyle: 'italic',
              }}>
                {item.details}
              </div>
            )}

            {item.url && (
              <div style={{ marginTop: 8, fontSize: 11 }}>
                <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-accent)', textDecoration: 'none' }}>
                  Open dashboard ↗
                </a>
              </div>
            )}
          </div>
        );
      })}
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
