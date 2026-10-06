'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, Zap, ExternalLink } from 'lucide-react';
import { SkeletonGrid, EmptyState, EmergingThemes } from './components';
import { THEME_PARENTS, DRILLDOWN, STRUCTURAL_THEMES } from './constants';
import { calcBucketVelocity, saveSnapshot, getDecayedSeverity, getChanges, getBucketLifecycle, getInvestabilityScore, getSev, calcEvidenceDiversity, signalDiversityScore, timeAgo, cleanUrl } from './helpers';
import { type BnDashboard, type NewsArticle, type BnBucket } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — ROTATION TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

export function RotationTracker({ dashboard, isLoading, articles }: { dashboard?: BnDashboard; isLoading: boolean; articles: NewsArticle[] }) {
  const [expBucket, setExpBucket] = useState<string | null>(null);
  const [expSignal, setExpSignal] = useState<string | null>(null);
  const [activeBucket, setActiveBucket] = useState<string | null>(null); // which pill is selected
  // PATCH 0295 — Hide stale themes (0 articles this week, 0 last week, not
  // structural) behind a toggle. Audit feedback: 15/21 themes showing as
  // STALE was polluting the Conviction Matrix and signaling broken coverage.
  const [showStale, setShowStale] = useState(false);
  // PATCH 0569 (UX #5) — STALE · VERY LOW tiles are collapsed by default
  // in the Conviction Matrix so the eye lands on actionable rows first.
  // Click the chevron to reveal them.
  const [showStaleLow, setShowStaleLow] = useState(false);

  // PATCH: Move ALL hook calls BEFORE early returns to satisfy React's
  // rules-of-hooks. The previous version called useEffect at the bottom of
  // the function body, AFTER `if (isLoading) return ...`. When isLoading
  // flipped from true → false the hook count changed → React #310.
  // Wrapping velocities in useMemo also lets us reference it from the
  // useEffect without re-doing the work later in the render.
  const velocities = useMemo(() => {
    if (!dashboard?.buckets?.length) return {} as Record<string, ReturnType<typeof calcBucketVelocity>>;
    return Object.fromEntries(
      dashboard.buckets.map(b => [b.bucket_id, calcBucketVelocity(articles, b.bucket_id)])
    );
  }, [dashboard?.buckets, articles]);

  useEffect(() => {
    if (dashboard?.buckets?.length && Object.keys(velocities).length > 0) {
      saveSnapshot(dashboard.buckets, velocities);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.buckets?.length]);

  // ── Now safe to early-return: all hooks have already been called ──
  if (isLoading) return <SkeletonGrid count={6} height={150} />;
  if (!dashboard?.buckets?.length) return <EmptyState msg="No bottleneck dashboard data. Check backend." />;

  // Apply decay to severity scores before sorting
  const decayedSeverities = Object.fromEntries(
    dashboard.buckets.map(b => [b.bucket_id, getDecayedSeverity(b.bucket_id, b.severity, velocities[b.bucket_id] ?? {week:0,prev:0})])
  );

  const sorted = [...dashboard.buckets].sort((a, b) => {
    // Sort by EFFECTIVE (decayed) severity, not raw severity
    const sevA = decayedSeverities[a.bucket_id]?.effective ?? a.severity;
    const sevB = decayedSeverities[b.bucket_id]?.effective ?? b.severity;
    const sevDiff = sevB - sevA;
    if (sevDiff !== 0) return sevDiff;
    return (velocities[b.bucket_id]?.week ?? 0) - (velocities[a.bucket_id]?.week ?? 0);
  });
  const top = sorted[0];

  // What changed since last session
  const changes = getChanges(dashboard.buckets, velocities);

  return (
    <div style={{ padding: '20px' }}>
      {/* ── WHAT CHANGED — session-over-session delta ── */}
      {changes.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#060E1A', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '10px', fontWeight: '800', color: 'var(--mc-state-persistent)', letterSpacing: '1px' }}>🔄 WHAT CHANGED</span>
            <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>since last session</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {changes.map((c, i) => (
              <div key={i} style={{ padding: '5px 10px', borderRadius: '6px', border: `1px solid ${c.color}30`, backgroundColor: c.color + '10', fontSize: '10px' }}>
                <span style={{ fontWeight: '700', color: c.color }}>
                  {c.type === 'NEW' ? '🆕' : c.type === 'UPGRADED' ? '⬆️' : c.type === 'DOWNGRADED' ? '⬇️' : c.type === 'RISING' ? '📈' : '📉'} {c.type}
                </span>
                <span style={{ color: 'var(--mc-text-2)', marginLeft: '6px' }}>{c.label}</span>
                <span style={{ color: 'var(--mc-text-4)', marginLeft: '6px' }}>{c.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── THEME HIERARCHY — prevents overlap, shows parent-child structure ── */}
      {(() => {
        // Show which themes are conceptually overlapping (same parent)
        const activeParents = THEME_PARENTS.filter(p =>
          p.children.some(cId => {
            const b = dashboard.buckets.find(bk => bk.bucket_id === cId);
            return b && (velocities[cId]?.week ?? 0) > 0;
          })
        );
        if (activeParents.length === 0) return null;
        return (
          <div style={{ marginBottom: '14px', padding: '10px 14px', backgroundColor: '#060E1A', border: '1px solid color-mix(in srgb, var(--mc-bg-4) 19%, transparent)', borderRadius: '8px' }}>
            <div style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '8px' }}>📐 THEME HIERARCHY — active parent groups (prevents overlap confusion)</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {activeParents.map(p => (
                <div key={p.id} style={{ padding: '5px 10px', borderRadius: '6px', border: `1px solid ${p.color}30`, backgroundColor: p.color + '08', fontSize: '10px' }}>
                  <span style={{ color: p.color, fontWeight: '700' }}>{p.icon} {p.label}</span>
                  <span title={p.overlap_note} style={{ color: 'var(--mc-text-4)', marginLeft: '6px', cursor: 'help' }}>({p.children.length} themes ⓘ)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Emerging themes — discovery-first layer */}
      <EmergingThemes articles={articles} />

      {/* ── CONVICTION MATRIX — 2-axis view: velocity vs effective severity ── */}
      {sorted.length >= 2 && (() => {
        // Pre-compute max velocity once (safe against empty sorted / all-zero)
        const weekValues = sorted.map(x => velocities[x.bucket_id]?.week ?? 0);
        const maxWeek = Math.max(1, ...weekValues); // always >= 1 so we never divide by 0
        try {
          return (
            <div style={{ marginBottom: '20px', padding: '14px 16px', backgroundColor: '#060E1A', border: '1px solid color-mix(in srgb, var(--mc-bg-4) 19%, transparent)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '10px', fontWeight: '800', color: 'var(--mc-state-persistent)', letterSpacing: '1px' }}>📊 CONVICTION MATRIX</span>
                <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>velocity × severity → lifecycle state · click to inspect</span>
                <div style={{ display: 'flex', gap: '5px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                  {([
                    {label:'🔥 ACCEL', color:'#F59E0B'},{label:'⚡ ACTIVE', color:'#10B981'},
                    {label:'🏗 STRUCT', color:'#8B5CF6'},{label:'📉 FADING', color:'#4A5B6C'},
                  ] as const).map(s=>(
                    <span key={s.label} style={{fontSize:'8px',fontWeight:'700',color:s.color,padding:'1px 5px',borderRadius:3,border:`1px solid ${s.color}30`,backgroundColor:s.color+'10'}}>{s.label}</span>
                  ))}
                </div>
              </div>
              {/* Tile grid — each bucket is a tile.
                  PATCH 0569 (UX #5) — Split tiles into actionable vs
                  STALE·VERY LOW. The latter group collapses behind a
                  toggle so the eye sees the high-severity rows first. */}
              {(() => {
                const tileEntries = sorted.map(b => {
                  const vel = velocities[b.bucket_id] ?? { week: 0, prev: 0, trend: '→' as const };
                  const lc = getBucketLifecycle(b.bucket_id, { week: vel.week ?? 0, prev: vel.prev ?? 0, trend: vel.trend ?? '→' });
                  const decayed = decayedSeverities[b.bucket_id];
                  const eff = decayed?.effective ?? b.severity ?? 1;
                  const hasChokepoints = !!(DRILLDOWN[b.bucket_id]?.chokepoints?.length);
                  const invest = getInvestabilityScore(b.bucket_id, { week: vel.week ?? 0, trend: lc.state }, b.signal_count ?? 0, b.article_count ?? 0, hasChokepoints);
                  const isStaleVeryLow = lc.state === 'STALE' && invest.label.includes('VERY LOW');
                  return { b, vel, lc, decayed, eff, invest, isStaleVeryLow };
                });
                const visible = tileEntries.filter(t => !t.isStaleVeryLow);
                const hidden = tileEntries.filter(t => t.isStaleVeryLow);
                const renderTile = ({ b, vel, lc, decayed, eff, invest }: typeof tileEntries[number]) => {
                  const barW = Math.min(100, Math.round(((vel.week ?? 0) / maxWeek) * 100));
                  const lcParts = (lc.label ?? '').split(' ');
                  const lcEmoji = lcParts[0] ?? '';
                  const lcWord = lcParts.slice(1).join(' ') || lc.state;
                  const investWord = (invest.label ?? '').split(' ').slice(1).join(' ') || 'n/a';
                  return (
                    <div key={b.bucket_id} style={{
                      padding: '10px 12px', borderRadius: '8px',
                      backgroundColor: lc.color + '10',
                      border: `1px solid ${lc.color}30`,
                      borderLeft: `3px solid ${lc.color}`,
                      cursor: 'pointer', transition: 'filter 0.15s',
                    }}
                      onClick={() => setActiveBucket(activeBucket === b.bucket_id ? null : b.bucket_id)}
                    >
                      <div style={{ fontSize: '10px', fontWeight: '800', color: 'var(--mc-text-0)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.severity_icon ?? '⚡'} {b.label ?? b.bucket_id}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '5px' }}>
                        <div style={{ flex: 1, height: '3px', backgroundColor: 'var(--mc-bg-4)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barW}%`, backgroundColor: lc.color, borderRadius: '2px' }} />
                        </div>
                        <span style={{ fontSize: '9px', color: lc.color, fontWeight: '700', minWidth: '18px', textAlign: 'right' }}>{vel.week ?? 0}w</span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '8px', fontWeight: '700', padding: '1px 4px', borderRadius: '3px', backgroundColor: lc.color + '20', color: lc.color }}>{lcEmoji} {lcWord}</span>
                        <span style={{ fontSize: '8px', color: invest.color ?? 'var(--mc-text-4)', fontWeight: '700' }}>{investWord}</span>
                        {decayed?.decayed && <span style={{ fontSize: '7px', color: 'var(--mc-text-4)', fontStyle: 'italic' }}>eff:{eff}</span>}
                      </div>
                    </div>
                  );
                };
                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
                      {visible.map(renderTile)}
                    </div>
                    {hidden.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <button
                          onClick={() => setShowStaleLow(v => !v)}
                          title={showStaleLow ? 'Collapse low-conviction stale themes' : 'Reveal stale themes with very-low investability'}
                          style={{
                            background: 'transparent', border: '1px dashed var(--mc-border-1)', borderRadius: 6,
                            color: '#6B7B8C', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
                            padding: '6px 10px', cursor: 'pointer',
                          }}
                        >
                          {showStaleLow ? '▾' : '▸'} STALE · VERY LOW ({hidden.length}) — collapsed by default
                        </button>
                        {showStaleLow && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', marginTop: 8, opacity: 0.75 }}>
                            {hidden.map(renderTile)}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
              {/* Selected bucket detail */}
              {activeBucket && sorted.find(x => x.bucket_id === activeBucket) && (() => {
                const b = sorted.find(x => x.bucket_id === activeBucket)!;
                const vel = velocities[activeBucket] ?? { week: 0, prev: 0, trend: '→' as const };
                const lc = getBucketLifecycle(activeBucket, { week: vel.week ?? 0, prev: vel.prev ?? 0, trend: vel.trend ?? '→' });
                const invest = getInvestabilityScore(activeBucket, { week: vel.week ?? 0, trend: lc.state }, b.signal_count ?? 0, b.article_count ?? 0, !!(DRILLDOWN[activeBucket]?.chokepoints?.length));
                return (
                  <div style={{ marginTop: '10px', padding: '12px 14px', backgroundColor: '#060E1A', border: `1px solid ${lc.color}30`, borderRadius: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--mc-text-0)' }}>{b.label}</span>
                      <span style={{ fontSize: '9px', fontWeight: '700', padding: '1px 6px', borderRadius: '3px', backgroundColor: lc.color + '20', color: lc.color }}>{lc.label}</span>
                      <span style={{ fontSize: '9px', color: invest.color, fontWeight: '700' }}>{invest.label}</span>
                      <span style={{ fontSize: '9px', color: 'var(--mc-text-4)', marginLeft: 'auto', textAlign: 'right' }}>Reasoning: {invest.reasoning}</span>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--mc-text-3)', margin: '0 0 8px', lineHeight: '1.5' }}>{lc.desc}</p>
                    {(b.key_tickers?.length ?? 0) > 0 && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {(b.key_tickers ?? []).slice(0, 8).map(t => (
                          <span key={t} style={{ fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', color: 'var(--mc-accent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 15%, transparent)' }}>{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        } catch {
          return null; // silently skip the matrix if any unexpected data shape causes a render error
        }
      })()}

      {/* Banner */}
      {top && (
        <div style={{ marginBottom: '20px', padding: '16px 20px', backgroundColor: '#060E1A', border: `1px solid ${getSev(top.severity_label).border}`, borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: getSev(top.severity_label).glow }}>
          <span style={{ fontSize: '28px' }}>{top.severity_icon || '⚡'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', color: 'var(--mc-text-4)' }}>ACTIVE BOTTLENECK</span>
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px', color: getSev(top.severity_label).badge, backgroundColor: getSev(top.severity_label).badgeBg, padding: '2px 8px', borderRadius: '4px' }}>{top.severity_label}</span>
            </div>
            <p style={{ fontSize: '17px', fontWeight: '800', color: 'var(--mc-text-0)', margin: '0 0 2px', letterSpacing: '-0.4px' }}>{top.label}</p>
            <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', margin: 0 }}>{top.description}</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: '30px', fontWeight: '800', color: getSev(top.severity_label).badge, margin: 0, lineHeight: 1 }}>{top.signal_count}</p>
            <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', margin: '2px 0 0', letterSpacing: '0.5px' }}>SIGNALS</p>
          </div>
        </div>
      )}
      {/* Rotation strip — clickable pills to focus on a specific layer */}
      <div style={{ marginBottom: '20px', padding: '10px 16px', backgroundColor: '#060E1A', borderRadius: '8px', border: '1px solid var(--mc-bg-4)', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontWeight: '700', letterSpacing: '1px', marginRight: '4px' }}>ROTATION →</span>
        {activeBucket && (
          <button onClick={() => { setActiveBucket(null); setExpBucket(null); }} style={{ fontSize: '9px', color: 'var(--mc-text-4)', backgroundColor: 'var(--mc-bg-4)', border: '1px solid var(--mc-bg-4)', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', marginRight: '4px' }}>
            ✕ Show all
          </button>
        )}
        {sorted.map((b, i) => {
          const isSelected = activeBucket === b.bucket_id;
          const sty = getSev(b.severity_label);
          return (
            <span key={b.bucket_id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {i > 0 && <span style={{ color: 'var(--mc-bg-4)' }}>›</span>}
              <button
                onClick={() => {
                  if (isSelected) { setActiveBucket(null); setExpBucket(null); }
                  else { setActiveBucket(b.bucket_id); setExpBucket(b.bucket_id); }
                }}
                style={{
                  fontSize: '10px', fontWeight: isSelected ? '800' : '600',
                  padding: '3px 10px', borderRadius: '4px', cursor: 'pointer',
                  color: isSelected ? 'var(--mc-text-0)' : sty.badge,
                  backgroundColor: isSelected ? sty.badge + '40' : sty.badgeBg,
                  border: `1px solid ${isSelected ? sty.badge : sty.border}`,
                  opacity: isSelected ? 1 : Math.max(0.4, 1 - i * 0.1),
                  outline: 'none',
                  boxShadow: isSelected ? `0 0 8px ${sty.badge}40` : 'none',
                  transition: 'all 0.15s',
                }}
              >{b.label}</button>
            </span>
          );
        })}
        <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', marginLeft: 'auto' }}>Click any layer to focus</span>
      </div>
      {/* PATCH 0295 — Partition into active vs stale themes. A theme is
          "stale" when it has 0 articles this week + 0 last week + isn't
          marked structural. We hide stale themes by default to keep the
          matrix scannable; users can expand via the toggle below. */}
      {(() => {
        const isStale = (b: BnBucket) => {
          const v = velocities[b.bucket_id];
          const isStructural = STRUCTURAL_THEMES.has(b.bucket_id);
          return !isStructural && (v?.week ?? 0) === 0 && (v?.prev ?? 0) === 0;
        };
        const staleBuckets = sorted.filter(isStale);
        // PATCH 0434 BUG-015 — Data freshness warning when >30% stale.
        // Audit feedback: "60%+ themes showing as STALE makes matrix a sea
        // of grey noise". Add prominent banner so user understands data
        // health, not engine failure.
        const stalePct = sorted.length > 0 ? (staleBuckets.length / sorted.length) * 100 : 0;
        const showFreshnessWarning = stalePct > 30 && !activeBucket;
        return staleBuckets.length > 0 && !activeBucket ? (
          <>
            {showFreshnessWarning && (
              <div style={{ marginBottom: 8, padding: '8px 12px', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                <span style={{ fontWeight: 700, color: 'var(--mc-warn)' }}>⚠ DATA FRESHNESS WARNING</span>
                <span style={{ color: 'var(--mc-text-2)' }}>
                  {staleBuckets.length} of {sorted.length} themes ({stalePct.toFixed(0)}%) have 0 articles this week and last.
                </span>
                <span style={{ color: 'var(--mc-text-3)', fontStyle: 'italic' }}>
                  Could mean: news pipeline lag, theme rolled off, or genuinely quiet. Verify before drawing conviction.
                </span>
              </div>
            )}
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => setShowStale(v => !v)}
                style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--mc-text-3)',
                  padding: '4px 10px', borderRadius: 6,
                  border: '1px solid var(--mc-bg-4)', backgroundColor: showStale ? 'var(--mc-bg-4)' : 'transparent',
                  cursor: 'pointer', letterSpacing: '0.5px',
                }}
              >{showStale ? '▼' : '▶'} {staleBuckets.length} stale themes hidden</button>
              <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>
                0 articles this week + last week · {showStale ? 'showing all' : 'click to expand'}
              </span>
            </div>
          </>
        ) : null;
      })()}

      {/* Grid — filtered by activeBucket if one is selected. PATCH 0295: also
          hides stale themes unless showStale toggle is on. */}
      <div style={{ display: 'grid', gridTemplateColumns: activeBucket ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
        {(() => {
          const isStale = (b: BnBucket) => {
            const v = velocities[b.bucket_id];
            const isStructural = STRUCTURAL_THEMES.has(b.bucket_id);
            return !isStructural && (v?.week ?? 0) === 0 && (v?.prev ?? 0) === 0;
          };
          const list = activeBucket
            ? sorted.filter(b => b.bucket_id === activeBucket)
            : (showStale ? sorted : sorted.filter(b => !isStale(b)));
          return list;
        })().map((b) => {
          const sty = getSev(b.severity_label);
          const isExp = expBucket === b.bucket_id;
          const vel = velocities[b.bucket_id];
          const isAccel = vel?.trend === '🔥';
          const isFading = vel?.trend === '📉';
          return (
            <div key={b.bucket_id} style={{ backgroundColor: sty.bg || 'var(--mc-bg-1)', border: `1px solid ${isAccel ? 'color-mix(in srgb, var(--mc-warn) 38%, transparent)' : sty.border}`, borderRadius: '12px', overflow: 'hidden', boxShadow: isExp ? sty.glow : isAccel ? '0 0 12px color-mix(in srgb, var(--mc-warn) 9%, transparent)' : 'none' }}>
              <button onClick={() => setExpBucket(isExp ? null : b.bucket_id)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '22px', flexShrink: 0 }}>{b.severity_icon || '🔹'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--mc-text-0)' }}>{b.label}</span>
                      {/* Decayed severity — shows if stale themes had their rating auto-reduced */}
                      {(() => {
                        const decay = decayedSeverities[b.bucket_id];
                        if (decay?.decayed) {
                          return (
                            <span title={`Severity auto-decayed: ${b.severity} raw → ${decay.effective} effective (${decay.weeksStale}+ weeks with zero articles)`}
                              style={{ fontSize: '9px', color: 'var(--mc-text-4)', backgroundColor: 'var(--mc-bg-4)', border: '1px solid var(--mc-bg-4)', padding: '2px 6px', borderRadius: '3px', cursor: 'help' }}>
                              {b.severity_label} → <span style={{ color: 'var(--mc-warn)' }}>DECAYED</span>
                            </span>
                          );
                        }
                        return <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', color: sty.badge, backgroundColor: sty.badgeBg, padding: '2px 6px', borderRadius: '3px' }}>{b.severity_label}</span>;
                      })()}
                      {/* 3-state lifecycle badge — the core signal quality indicator */}
                      {(() => {
                        const lc = getBucketLifecycle(b.bucket_id, vel ?? { week: 0, prev: 0, trend: '→' });
                        return (
                          <span title={lc.desc} style={{ fontSize: '9px', fontWeight: '700', color: lc.color, backgroundColor: lc.color + '14', border: `1px solid ${lc.color}40`, padding: '2px 6px', borderRadius: '3px', cursor: 'help' }}>
                            {lc.label}
                          </span>
                        );
                      })()}
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', margin: '0 0 8px', lineHeight: '1.4' }}>
                      {b.description}
                      {/* Freshness decay warning — stale critical/high themes need context */}
                      {vel?.week === 0 && !STRUCTURAL_THEMES.has(b.bucket_id) && (b.severity ?? 0) >= 3 && (
                        <span style={{ marginLeft: '8px', fontSize: '9px', color: 'var(--mc-warn)', fontWeight: 600 }}>
                          ⚠ Zero articles this week — severity label may be stale residue, not live signal
                        </span>
                      )}
                    </p>
                    <div style={{ display: 'flex', gap: '14px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--mc-text-3)' }}><span style={{ color: sty.badge, fontWeight: '700', fontSize: '15px' }}>{b.signal_count}</span> signals</span>
                      <span style={{ fontSize: '11px', color: 'var(--mc-text-3)' }}><span style={{ fontWeight: '600', color: 'var(--mc-text-2)' }}>{b.article_count}</span> articles</span>
                      {vel && <span style={{ fontSize: '11px', color: isAccel ? 'var(--mc-warn)' : 'var(--mc-text-4)' }}>{vel.week} this wk</span>}
                      {/* PATCH 0445 BUG-015 — Per-theme last-article timestamp.
                          Lets the user verify why a theme is STALE — is it
                          genuinely cold (last article weeks ago) or is the
                          velocity calculation wrong (recent article but not
                          counted)? Tooltip shows absolute timestamp. */}
                      {(() => {
                        const sigs = b.signals || [];
                        let latest: string | null = null;
                        for (const s of sigs) {
                          if (s.latest_at && (!latest || s.latest_at > latest)) latest = s.latest_at;
                        }
                        if (!latest) return null;
                        const ageMs = Date.now() - new Date(latest).getTime();
                        const ageDays = Math.floor(ageMs / 86400000);
                        const label = ageDays < 1 ? 'today' : ageDays === 1 ? '1d ago' : ageDays < 7 ? `${ageDays}d ago` : ageDays < 30 ? `${Math.floor(ageDays / 7)}w ago` : `${Math.floor(ageDays / 30)}mo ago`;
                        const color = ageDays < 7 ? '#10B981' : ageDays < 30 ? '#F59E0B' : '#EF4444';
                        return (
                          <span title={`Latest article: ${new Date(latest).toLocaleString('en-IN')} (${label})`}
                            style={{ fontSize: '10px', color, cursor: 'help' }}>
                            📰 {label}
                          </span>
                        );
                      })()}
                      {/* Evidence diversity with full detail */}
                      {(() => {
                        const div = calcEvidenceDiversity(b.signal_count, b.article_count);
                        return (
                          <span title={div.detail} style={{ fontSize: '9px', color: div.color, cursor: 'help' }}>
                            {div.label}
                          </span>
                        );
                      })()}
                      {/* Investability score */}
                      {(() => {
                        const drillEntry = DRILLDOWN[b.bucket_id];
                        const inv = getInvestabilityScore(b.bucket_id, vel ?? {week:0,trend:'→'}, b.signal_count, b.article_count, !!(drillEntry?.chokepoints?.length));
                        return (
                          <span title={`Investability: ${inv.score}/100 — ${inv.reasoning}`} style={{ fontSize: '9px', fontWeight: '700', color: inv.color, cursor: 'help' }}>
                            💡 {inv.label}
                          </span>
                        );
                      })()}
                      {/* Legacy signal diversity warning: when signal≈article count → one-article-one-signal pattern */}
                      {(() => {
                        const div = signalDiversityScore(b.signal_count, b.article_count);
                        return div.warning ? (
                          <span title={div.label} style={{ fontSize: '9px', color: 'var(--mc-warn)', cursor: 'help' }}>⚠ low signal diversity</span>
                        ) : null;
                      })()}
                    </div>
                    {b.key_tickers?.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {b.key_tickers.slice(0, 8).map(t => <span key={t} style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-accent)', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 19%, transparent)', padding: '1px 6px', borderRadius: '4px' }}>${t}</span>)}
                        {b.key_tickers.length > 8 && <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>+{b.key_tickers.length - 8}</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ color: 'var(--mc-text-4)', flexShrink: 0 }}>{isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</div>
                </div>
              </button>
              {isExp && b.signals?.length > 0 && (
                <div style={{ borderTop: `1px solid ${sty.border}` }}>
                  {b.signals.slice(0, 5).map((sig, si) => {
                    const sk = `${b.bucket_id}-${si}`;
                    const se = expSignal === sk;
                    return (
                      <div key={si} style={{ borderBottom: si < Math.min(b.signals.length,5)-1 ? '1px solid color-mix(in srgb, var(--mc-bg-4) 19%, transparent)' : 'none' }}>
                        <button onClick={() => setExpSignal(se ? null : sk)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <Zap className="w-3 h-3" style={{ color: sty.badge, flexShrink: 0, marginTop: '2px' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', margin: 0, lineHeight: '1.4', textAlign: 'left' }}>{sig.headline}</p>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{sig.evidence_count} evidence</span>
                              {sig.latest_at && <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{timeAgo(sig.latest_at)}</span>}
                              {sig.tickers?.slice(0,3).map(t => <span key={t} style={{ fontSize: '10px', color: 'var(--mc-accent)', fontWeight: '600' }}>${t}</span>)}
                            </div>
                          </div>
                          <div style={{ color: 'var(--mc-text-4)', flexShrink: 0 }}>{se ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</div>
                        </button>
                        {se && (
                          <div style={{ padding: '0 16px 12px 36px' }}>
                            {sig.summary && <p style={{ fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.5', margin: '0 0 8px' }}>{sig.summary}</p>}
                            {sig.articles?.slice(0, 3).map((art, ai) => (
                              <a key={ai} href={cleanUrl(art.source_url)} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '6px 8px', marginBottom: '4px', backgroundColor: '#060E1A', borderRadius: '6px', textDecoration: 'none', border: '1px solid var(--mc-bg-4)' }}>
                                <ExternalLink className="w-3 h-3" style={{ color: 'var(--mc-text-4)', flexShrink: 0, marginTop: '2px' }} />
                                <div><p style={{ fontSize: '11px', color: 'var(--mc-text-2)', margin: 0, lineHeight: '1.3' }}>{art.headline}</p><p style={{ fontSize: '10px', color: 'var(--mc-text-4)', margin: '2px 0 0' }}>{art.source_name} · {timeAgo(art.published_at)}</p></div>
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
      {dashboard && <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '11px', color: 'var(--mc-text-4)' }}>{dashboard.total_articles} articles analyzed · refreshes every 3 min</p>}
    </div>
  );
}
