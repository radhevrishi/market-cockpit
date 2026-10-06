'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { openPassport } from '@/lib/engines';
import { BOTTLENECK_DRILLDOWN } from './constants';
import { decodeHtml, timeAgo } from './helpers';
import { type BnDashboard } from './types';

// ── Bottleneck Dashboard ──────────────────────────────────────────────────────

export function BottleneckDashboard({
  dashboard,
  isLoading,
  onOpenDrilldown,
  bottleneckLevel = 'ALL',
  bottleneckCategory = 'ALL',
}: {
  dashboard?: BnDashboard;
  isLoading: boolean;
  onOpenDrilldown?: (subTag: string) => void;
  bottleneckLevel?: string;
  bottleneckCategory?: string;
}) {
  // All buckets expanded by default
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(new Set());

  // Filter buckets by the active level/category sub-filters so the dashboard
  // stays consistent with the top article list.
  const filteredBuckets = useMemo(() => {
    if (!dashboard?.buckets) return [];
    const levelToSeverity: Record<string, (sev: number) => boolean> = {
      CRITICAL_BOTTLENECK: sev => sev >= 5,
      BOTTLENECK: sev => sev === 4,
      WATCH: sev => sev <= 3 && sev >= 2,
      RESOLVED_EASING: sev => sev <= 1,
    };
    return dashboard.buckets.filter(b => {
      if (bottleneckLevel !== 'ALL') {
        const pred = levelToSeverity[bottleneckLevel];
        if (pred && !pred(b.severity)) return false;
      }
      if (bottleneckCategory !== 'ALL' && b.bucket_id !== bottleneckCategory) return false;
      return true;
    });
  }, [dashboard, bottleneckLevel, bottleneckCategory]);

  // Compat: expandedBuckets derived from collapsedBuckets (inverted logic)
  const expandedBuckets = useMemo(() => {
    if (!filteredBuckets.length) return new Set<string>();
    const all = new Set(filteredBuckets.map(b => b.bucket_id));
    for (const id of collapsedBuckets) all.delete(id);
    return all;
  }, [filteredBuckets, collapsedBuckets]);

  const toggleBucket = (id: string) => {
    setCollapsedBuckets(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSignal = (id: string) => {
    setExpandedSignals(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: '100px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '14px' }} className="animate-shimmer" />
        ))}
      </div>
    );
  }

  if (!dashboard?.buckets?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <p style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</p>
        <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--mc-text-0)', margin: '0 0 8px' }}>No active bottleneck signals</p>
        <p style={{ fontSize: '13px', color: 'var(--mc-text-4)', margin: 0 }}>Bottleneck signals will appear when supply-chain constraint articles are detected</p>
      </div>
    );
  }

  if (!filteredBuckets.length) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '12px' }}>
        <p style={{ fontSize: '28px', marginBottom: '10px' }}>🔎</p>
        <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--mc-text-0)', margin: '0 0 6px' }}>No dashboard buckets match current filters</p>
        <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', margin: 0 }}>Try clearing the level or category filter to see the full intelligence grid.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Summary bar */}
      <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--mc-bearish)', letterSpacing: '0.5px' }}>BOTTLENECK INTELLIGENCE</span>
        <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>
          {filteredBuckets.length} categories · {filteredBuckets.reduce((s, b) => s + b.signal_count, 0)} signals · {filteredBuckets.reduce((s, b) => s + b.article_count, 0)} evidence articles
        </span>
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
          {[
            { label: 'CRITICAL', count: filteredBuckets.filter(b => b.severity >= 5).length, color: '#EF4444' },
            { label: 'HIGH', count: filteredBuckets.filter(b => b.severity === 4).length, color: '#F59E0B' },
            { label: 'ELEVATED', count: filteredBuckets.filter(b => b.severity === 3).length, color: '#3B82F6' },
            { label: 'WATCH', count: filteredBuckets.filter(b => b.severity <= 2).length, color: '#6B7280' },
          ].filter(s => s.count > 0).map(s => (
            <span key={s.label} style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', backgroundColor: s.color + '15', color: s.color, border: `1px solid ${s.color}30` }}>
              {s.count} {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Bucket cards */}
      {filteredBuckets.map(bucket => {
        const isExpanded = expandedBuckets.has(bucket.bucket_id);
        return (
          <div key={bucket.bucket_id} style={{ backgroundColor: 'var(--mc-bg-2)', border: `1px solid ${bucket.severity >= 4 ? bucket.severity_color + '40' : 'var(--mc-border-1)'}`, borderRadius: '14px', overflow: 'hidden' }}>
            {/* Bucket header */}
            <div
              onClick={() => toggleBucket(bucket.bucket_id)}
              style={{ padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}
            >
              {/* Severity indicator */}
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: bucket.severity_color + '18', border: `1px solid ${bucket.severity_color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                {bucket.severity_icon}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--mc-text-0)' }}>{bucket.label}</span>
                  <span style={{
                    fontSize: '9px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px',
                    backgroundColor: bucket.severity_color + '20', color: bucket.severity_color,
                    border: `1px solid ${bucket.severity_color}40`, letterSpacing: '0.5px',
                  }}>
                    {bucket.severity_label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>
                    {bucket.signal_count} signal{bucket.signal_count !== 1 ? 's' : ''} · {bucket.article_count} article{bucket.article_count !== 1 ? 's' : ''}
                  </span>
                  {(bucket.key_tickers ?? []).slice(0, 4).map(t => (  /* zzz381 — guard partial payload → no white-screen */
                    <span key={t} style={{ fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', color: 'var(--mc-accent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 15%, transparent)' }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {onOpenDrilldown && BOTTLENECK_DRILLDOWN[bucket.bucket_id] && (
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenDrilldown(bucket.bucket_id); }}
                  style={{
                    fontSize: '10px', fontWeight: '700', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer',
                    border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', color: 'var(--mc-state-persistent)',
                    flexShrink: 0, letterSpacing: '0.3px',
                  }}
                  title="Open supply/demand drilldown"
                >
                  DEEP DIVE
                </button>
              )}
              {isExpanded
                ? <ChevronDown style={{ width: '16px', height: '16px', color: 'var(--mc-text-4)', flexShrink: 0 }} />
                : <ChevronRight style={{ width: '16px', height: '16px', color: 'var(--mc-text-4)', flexShrink: 0 }} />
              }
            </div>

            {/* Expanded: show signals */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--mc-border-1)', padding: '4px 0' }}>
                {/* Description */}
                <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', margin: '10px 18px 12px', lineHeight: '1.5' }}>
                  {bucket.description}
                </p>

                {(bucket.signals ?? []).map((signal, idx) => {  /* zzz381 */
                  const signalKey = `${bucket.bucket_id}-${idx}`;
                  const signalExpanded = expandedSignals.has(signalKey);
                  return (
                    <div key={signalKey} style={{ margin: '0 12px 8px', backgroundColor: 'var(--mc-bg-1)', borderRadius: '10px', border: '1px solid var(--mc-bg-4)' }}>
                      {/* Signal header */}
                      <div
                        onClick={() => toggleSignal(signalKey)}
                        style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '10px' }}
                      >
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: bucket.severity_color, flexShrink: 0, marginTop: '6px' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {signal.articles?.[0]?.source_url ? (
                            <a
                              href={signal.articles[0].source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontSize: '13px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 4px', lineHeight: '1.4', display: 'block', textDecoration: 'none' }}
                            >
                              {decodeHtml(signal.headline)}
                              <ExternalLink style={{ width: '10px', height: '10px', color: '#3A4B5C', marginLeft: '6px', display: 'inline' }} />
                            </a>
                          ) : (
                            <p style={{ fontSize: '13px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 4px', lineHeight: '1.4' }}>
                              {decodeHtml(signal.headline)}
                            </p>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>
                              {(signal.sources ?? []).join(', ')}
                            </span>
                            {signal.evidence_count > 1 && (
                              <span style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-warn)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', padding: '1px 6px', borderRadius: '3px' }}>
                                +{signal.evidence_count - 1} related
                              </span>
                            )}
                            {(signal.tickers ?? []).slice(0, 3).map(t => (  /* zzz381 */
                              <span key={t} onClick={(e) => { e.stopPropagation(); openPassport(t); }} title="Open Stock Passport" style={{ cursor: 'pointer', fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 7%, transparent)', color: 'var(--mc-accent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 13%, transparent)' }}>
                                {t}
                              </span>
                            ))}
                            <span style={{ fontSize: '10px', color: '#3A4B5C' }}>
                              {timeAgo(signal.latest_at)}
                            </span>
                          </div>
                        </div>
                        {signal.evidence_count > 1 && (
                          signalExpanded
                            ? <ChevronDown style={{ width: '14px', height: '14px', color: 'var(--mc-text-4)', flexShrink: 0, marginTop: '2px' }} />
                            : <ChevronRight style={{ width: '14px', height: '14px', color: 'var(--mc-text-4)', flexShrink: 0, marginTop: '2px' }} />
                        )}
                      </div>

                      {/* Expanded: evidence articles */}
                      {signalExpanded && signal.evidence_count > 1 && (
                        <div style={{ borderTop: '1px solid var(--mc-bg-4)', padding: '8px 14px 10px', paddingLeft: '30px' }}>
                          <p style={{ fontSize: '9px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 6px', letterSpacing: '0.5px' }}>EVIDENCE ARTICLES</p>
                          {(signal.articles ?? []).map((art, aidx) => (  /* zzz381 */
                            <a
                              key={aidx}
                              href={art.source_url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', textDecoration: 'none', borderBottom: aidx < signal.articles.length - 1 ? '1px solid #15213a' : 'none' }}
                            >
                              <span style={{ fontSize: '11px', color: 'var(--mc-text-2)', flex: 1 }}>
                                {/* PATCH 0267 — defend against null headline */}
                                {decodeHtml((art.headline || '')).slice(0, 90)}{(art.headline || '').length > 90 ? '…' : ''}
                              </span>
                              <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', flexShrink: 0 }}>{art.source_name}</span>
                              <ExternalLink style={{ width: '10px', height: '10px', color: '#3A4B5C', flexShrink: 0 }} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
