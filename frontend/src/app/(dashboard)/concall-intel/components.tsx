'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect, useMemo } from 'react';
import { decodeHTMLEntities } from '@/lib/html-decode';
import { resolveTicker } from '@/lib/bse-nse-mapping';
import type { KeywordSpec, KwWatchPayload, MoverEntry, MoversPayload, CiBottleneckDashboard } from './types';
import { KW_GROUP_COLORS } from './constants';

export function KeywordWatchFeed() {
  const [data, setData] = useState<KwWatchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(14);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const fetchFeed = async (force = false) => {
    setLoading(true);
    setError(null);
    // PATCH 0435 BUG-011 — Hard 50s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000);
    try {
      const params = new URLSearchParams({
        days: String(days),
        ...(selectedKeywords.size > 0 ? { keywords: Array.from(selectedKeywords).join(',') } : {}),
        ...(selectedGroups.size > 0 ? { groups: Array.from(selectedGroups).join(',') } : {}),
        ...(force ? { force: '1' } : {}),
      });
      const res = await fetch(`/api/v1/concall-intel/keyword-watch?${params}`, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      const j = await res.json();
      setData(j);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.name === 'AbortError' ? 'Timed out after 50s — try Refresh' : (e?.message || 'fetch failed'));
    }
    finally { clearTimeout(timeoutId); setLoading(false); }
  };

  useEffect(() => {
    fetchFeed();
    // AUDIT_100 #7 — skip poll when tab is hidden
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchFeed();
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, selectedKeywords.size, selectedGroups.size]);

  const toggleKeyword = (id: string) => {
    setSelectedKeywords(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleGroup = (g: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  const catalog = data?.catalog || [];
  const groupedCatalog = useMemo(() => {
    const groups: Record<string, KeywordSpec[]> = {};
    for (const k of catalog) (groups[k.group] = groups[k.group] || []).push(k);
    return groups;
  }, [catalog]);

  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderLeft: '4px solid var(--mc-cyan)', borderRadius: 10, padding: '14px 18px', marginBottom: 14, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--mc-cyan)', letterSpacing: '0.4px' }}>🔎 KEYWORD WATCH — scan every concall for theme / risk / regulatory phrases</div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginTop: 2 }}>
            {data ? (
              <>
                {data.count_relevant} concall-relevant · <strong style={{ color: 'var(--mc-cyan)' }}>{data.count_matched} matched</strong> · {data.totals.total_hits} total hits ·
                {' '}<span style={{ color: 'var(--mc-bearish)' }}>{data.totals.by_group.RISK || 0} RISK</span> ·
                {' '}<span style={{ color: 'var(--mc-bullish)' }}>{data.totals.by_group.OPPORTUNITY || 0} OPP</span> ·
                {' '}<span style={{ color: 'var(--mc-state-persistent)' }}>{data.totals.by_group.THEME || 0} THEME</span> ·
                {' '}<span style={{ color: 'var(--mc-warn)' }}>{data.totals.by_group.REGULATORY || 0} REG</span> ·
                {' '}<span style={{ color: 'var(--mc-cyan)' }}>{data.totals.by_group.SECTOR || 0} SECTOR</span>
                {lastRefresh && <> · refreshed {lastRefresh.toLocaleTimeString()}</>}
              </>
            ) : loading ? 'Loading…' : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setShowCatalog(v => !v)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', color: 'var(--mc-cyan)', cursor: 'pointer' }}>
            {showCatalog ? '▲ Hide keywords' : '▼ Edit watchlist'}
          </button>
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid var(--mc-bg-4)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)' }}>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
          <button onClick={() => fetchFeed(true)} disabled={loading} style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', color: 'var(--mc-cyan)', cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Group filter row — always visible.
          PATCH 0567 — BUG-AUDIT-12: when the user has no configured
          keywords AND no counts are coming back from the API, swap the
          row of "0"-counters for a single "Add keywords" prompt. */}
      {(() => {
        const totalCount = Object.keys(KW_GROUP_COLORS).reduce(
          (s, g) => s + (data?.totals.by_group[g] || 0), 0
        );
        if (catalog.length === 0 && totalCount === 0 && !loading) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '8px 12px', background: 'var(--mc-bg-0)', border: '1px dashed color-mix(in srgb, var(--mc-cyan) 38%, transparent)', borderRadius: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 700 }}>
                Add keywords to start monitoring concalls
              </span>
              <button
                onClick={() => setShowCatalog(true)}
                style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', color: 'var(--mc-cyan)', cursor: 'pointer' }}
              >
                ▼ Edit watchlist
              </button>
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, marginRight: 4 }}>GROUPS:</span>
            {Object.keys(KW_GROUP_COLORS).map(g => {
              const active = selectedGroups.has(g);
              const color = KW_GROUP_COLORS[g];
              const count = data?.totals.by_group[g] || 0;
              return (
                <button key={g} onClick={() => toggleGroup(g)} style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 5, border: `1px solid ${active ? color : 'var(--mc-bg-4)'}`, background: active ? `${color}20` : 'transparent', color: active ? color : 'var(--mc-text-3)', cursor: 'pointer' }}>
                  {g} · {count}
                </button>
              );
            })}
            {selectedGroups.size > 0 && (
              <button onClick={() => setSelectedGroups(new Set())} style={{ fontSize: 10, color: 'var(--mc-text-3)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                clear groups
              </button>
            )}
          </div>
        );
      })()}

      {/* Keyword catalog editor (collapsible) */}
      {showCatalog && (
        <div style={{ marginBottom: 10, padding: 10, background: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6 }}>
          <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6 }}>Click keywords to filter. Empty = all keywords active. {selectedKeywords.size > 0 && <button onClick={() => setSelectedKeywords(new Set())} style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>clear all</button>}</div>
          {Object.entries(groupedCatalog).map(([group, kws]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: KW_GROUP_COLORS[group] || 'var(--mc-text-3)', letterSpacing: '0.5px', marginBottom: 4 }}>{group}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {kws.map(k => {
                  const active = selectedKeywords.has(k.id);
                  const color = KW_GROUP_COLORS[group] || '#94A3B8';
                  return (
                    <button key={k.id} onClick={() => toggleKeyword(k.id)} style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, border: `1px solid ${active ? color : 'var(--mc-bg-4)'}`, background: active ? `${color}20` : 'transparent', color: active ? color : 'var(--mc-text-3)', cursor: 'pointer' }}>
                      {k.display}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PATCH 0420 — soft amber when refresh slow but data is loaded; red only when truly empty */}
      {error && (!data || (data.filings?.length || 0) === 0) && (
        <div style={{ fontSize: 11, color: 'var(--mc-bearish)', marginBottom: 8 }}>⚠ {error}</div>
      )}
      {error && data && (data.filings?.length || 0) > 0 && (
        <div style={{ fontSize: 10, color: 'var(--mc-warn)', marginBottom: 8, fontStyle: 'italic' }}>
          · last refresh slow ({error}); showing previous results
        </div>
      )}

      {data && data.filings.length === 0 && !loading && (
        <div style={{
          padding: '20px 16px',
          marginTop: 8,
          backgroundColor: 'var(--mc-bg-0)',
          border: '1px solid var(--mc-bg-4)',
          borderLeft: '3px solid var(--mc-cyan)',
          borderRadius: 8,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
          <div style={{ fontSize: 13, color: 'var(--mc-text-1)', fontWeight: 700, marginBottom: 6 }}>
            No filings matched these keywords in the last {days}d
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.6, marginBottom: 10 }}>
            This either means the chosen theme genuinely hasn&apos;t surfaced in recent transcripts,
            or our window is too narrow for low-frequency topics.
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', lineHeight: 1.6 }}>
            Try: <span style={{ color: 'var(--mc-cyan)', fontWeight: 700 }}>widen to 90 or 180 days</span>{' '}
            · <span style={{ color: 'var(--mc-cyan)', fontWeight: 700 }}>clear keyword filter</span>{' '}
            · pick a broader group (e.g. all &ldquo;capex&rdquo; or &ldquo;China+1&rdquo;).
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(data?.filings || []).slice(0, 60).map((f, i) => (
          <div key={f.symbol + '-' + i} style={{ padding: '10px 12px', background: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-text-1)' }}>{f.symbol || f.company_name}</span>
                {f.symbol && <span style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>{f.company_name}</span>}
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--mc-bg-4)', color: 'var(--mc-text-3)', fontWeight: 700 }}>{f.exchange}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--mc-cyan)' }}>{f.hit_count} hit{f.hit_count > 1 ? 's' : ''}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--mc-text-2)', marginBottom: 6, lineHeight: 1.4 }}>{decodeHTMLEntities(f.subject)}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              {Array.from(new Set(f.hits.map(h => `${h.keyword_id}|${h.display}|${h.group}|${h.sentiment}`))).slice(0, 10).map((tag, j) => {
                const [, display, group, sent] = tag.split('|');
                const color = sent === 'NEGATIVE' ? '#EF4444' : sent === 'POSITIVE' ? '#10B981' : KW_GROUP_COLORS[group] || '#94A3B8';
                return <span key={j} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${color}15`, color, fontWeight: 700, border: `1px solid ${color}40` }}>{sent === 'NEGATIVE' ? '⚠ ' : sent === 'POSITIVE' ? '★ ' : ''}{display}</span>;
              })}
            </div>
            <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.5 }}>
              {f.hits.slice(0, 5).map((h, j) => {
                const c = h.sentiment === 'NEGATIVE' ? '#EF4444' : h.sentiment === 'POSITIVE' ? '#10B981' : KW_GROUP_COLORS[h.group];
                return (
                  <div key={j} style={{ padding: '2px 0', color: 'var(--mc-text-2)' }}>
                    › <span style={{ color: c, fontWeight: 700 }}>[{h.display}]</span> &ldquo;{h.sentence}&rdquo;
                  </div>
                );
              })}
              {f.hits.length > 5 && <div style={{ color: 'var(--mc-text-3)', fontStyle: 'italic', padding: '2px 0' }}>+ {f.hits.length - 5} more matches</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--mc-text-4)', marginTop: 6 }}>
              <span>{new Date(f.filing_datetime).toLocaleString()}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {f.attachment_urls.slice(0, 1).map((u, j) => (
                  <a key={j} href={u} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>📎 attachment</a>
                ))}
                <a href={f.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>↗ {f.exchange}</a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MoversPanel() {
  const [data, setData] = useState<MoversPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      // PATCH 0466 — 20s timeout so a stuck movers endpoint doesn't
      // freeze this panel's loading state forever.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20_000);
      try {
        const r = await fetch('/api/v1/concall-intel/movers', { cache: 'no-store', signal: ctl.signal });
        if (!r.ok) return;
        const j = await r.json();
        if (mounted) setData(j);
      } catch {} finally { clearTimeout(timer); if (mounted) setLoading(false); }
    };
    load();
    // AUDIT_100 #7 — skip poll when tab is hidden
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      load();
    }, 15 * 60 * 1000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  if (!data || (data.new_entries.length === 0 && data.big_jumps.length === 0 && data.lost_momentum.length === 0)) {
    return null;
  }

  const tierColor = (tier: string): string => {
    if (tier === 'ULTRA_BULLISH') return '#22D3EE';
    if (tier === 'BULLISH') return '#10B981';
    if (tier === 'MIXED_POSITIVE') return '#F59E0B';
    return '#94A3B8';
  };

  const Section = ({ title, items, icon, color }: { title: string; items: MoverEntry[]; icon: string; color: string }) => {
    if (items.length === 0) return null;
    return (
      <div style={{ flex: '1 1 280px', minWidth: 240 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 5 }}>{icon} {title} ({items.length})</div>
        {items.slice(0, 6).map(m => {
          const tc = tierColor(m.tier);
          return (
            <div key={m.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 6px', borderRadius: 4, marginBottom: 3, background: 'var(--mc-bg-0)', border: `1px solid ${tc}30`, fontSize: 11 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
                {(() => {
                  // PATCH 0490 QA-#14 — display NSE symbol when symbol is a raw BSE code.
                  const r = resolveTicker(m.symbol);
                  return (
                    <span style={{ fontWeight: 800, color: 'var(--mc-text-1)' }} title={r.bseCode ? `BSE: ${r.bseCode}` : ''}>
                      {r.nseSymbol || r.display}
                    </span>
                  );
                })()}
                <span style={{ color: 'var(--mc-text-3)', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(() => { const r = resolveTicker(m.symbol); return m.company_name || r.shortName || ''; })()}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
                {m.delta != null && (
                  <span style={{ fontSize: 9, color: m.delta > 0 ? 'var(--mc-bullish)' : m.delta < 0 ? 'var(--mc-bearish)' : 'var(--mc-text-3)', fontWeight: 700 }}>
                    {m.delta > 0 ? '+' : ''}{m.delta.toFixed(1)}
                  </span>
                )}
                <span style={{ fontSize: 11, fontWeight: 900, color: tc }}>
                  {m.composite_today > 0 ? m.composite_today.toFixed(1) : '—'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)', borderLeft: '4px solid var(--mc-state-persistent)', borderRadius: 10, padding: '14px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-state-persistent)', letterSpacing: '0.4px' }}>📈 MOVERS — daily delta vs last snapshot</div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginTop: 2 }}>
            today {data.today_date} vs {data.reference_date || 'no prior snapshot'} · {loading ? 'loading…' : `${data.new_entries.length} new · ${data.big_jumps.length} big jumps · ${data.lost_momentum.length} lost momentum`}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Section title="NEW ENTRIES" items={data.new_entries} icon="🆕" color="#10B981" />
        <Section title="BIG JUMPS" items={data.big_jumps} icon="⬆️" color="#22D3EE" />
        <Section title="LOST MOMENTUM" items={data.lost_momentum} icon="⬇️" color="#EF4444" />
      </div>
    </div>
  );
}

export function ConcallBottleneckPanel() {
  const [data, setData] = useState<CiBottleneckDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20_000);
    setLoading(true);
    fetch('/api/v1/news/bottleneck-dashboard', { cache: 'no-store', signal: ctl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: CiBottleneckDashboard) => { if (!cancelled) setData(j); })
      .catch((e: any) => { if (!cancelled) setError(e?.name === 'AbortError' ? 'timeout' : (e?.message || 'fetch failed')); })
      .finally(() => { clearTimeout(t); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; ctl.abort(); };
  }, []);

  // Sort by severity desc (HIGH first) then by article count desc.
  const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = useMemo(() => {
    const buckets = data?.buckets || [];
    return [...buckets].sort((a, b) => {
      const sa = sevOrder[(a.severity_label || '').toLowerCase()] ?? 99;
      const sb = sevOrder[(b.severity_label || '').toLowerCase()] ?? 99;
      if (sa !== sb) return sa - sb;
      return (b.article_count || 0) - (a.article_count || 0);
    });
  }, [data]);

  const totalArticles = sorted.reduce((s, b) => s + (b.article_count || 0), 0);
  const totalSignals = sorted.reduce((s, b) => s + (b.signal_count || 0), 0);
  const high = sorted.filter(b => (b.severity_label || '').toLowerCase() === 'high').length;
  const med = sorted.filter(b => (b.severity_label || '').toLowerCase() === 'medium').length;

  if (loading) {
    return (
      <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px', marginBottom: 6 }}>
          🏗 BOTTLENECK THEMES (news-side)
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>📡 Loading bottleneck dashboard…</div>
      </div>
    );
  }

  if (error || sorted.length === 0) {
    return (
      <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px', marginBottom: 6 }}>
          🏗 BOTTLENECK THEMES (news-side)
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>
          {error ? `Could not load bottleneck dashboard (${error}). Visit /bottleneck-intel directly to inspect.` : 'No themes in the active news window.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px' }}>
          🏗 BOTTLENECK THEMES (news-side, severity-sorted)
        </div>
        <div style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>
          {sorted.length} themes · {totalArticles} articles · {totalSignals} signals · <span style={{ color: 'var(--mc-bearish)', fontWeight: 700 }}>{high} HIGH</span>{med > 0 && <> · <span style={{ color: 'var(--mc-warn)', fontWeight: 700 }}>{med} MED</span></>}
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginBottom: 8, lineHeight: 1.5 }}>
        Cross-app bottleneck themes from /bottleneck-intel. Click any theme to drill into its workbench
        (transmission ladder, related articles, India proxies, counter-thesis).
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
        {sorted.slice(0, 18).map((b) => {
          const sev = (b.severity_label || '').toLowerCase();
          const color = b.severity_color || (sev === 'high' ? '#EF4444' : sev === 'medium' ? '#F59E0B' : '#94A3B8');
          return (
            <a
              key={b.bucket_id}
              href={`/bottleneck-workbench?theme=${encodeURIComponent(b.bucket_id)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', flexDirection: 'column', gap: 3,
                padding: '7px 10px', borderRadius: 4,
                border: `1px solid ${color}30`, background: `${color}08`,
                textDecoration: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>{b.severity_icon || '⚡'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.label || b.bucket_id}
                  </div>
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 800, color, padding: '1px 5px', borderRadius: 3,
                  background: `${color}22`, border: `1px solid ${color}50`, letterSpacing: '0.4px',
                }}>{b.severity_label || '—'}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--mc-text-3)', display: 'flex', gap: 8 }}>
                <span>{b.article_count ?? 0} art</span>
                <span>{b.signal_count ?? 0} sig</span>
                {(b.key_tickers && b.key_tickers.length > 0) && (
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🎯 {b.key_tickers.slice(0, 3).join(' · ')}{b.key_tickers.length > 3 ? ` +${b.key_tickers.length - 3}` : ''}
                  </span>
                )}
              </div>
            </a>
          );
        })}
      </div>
      {sorted.length > 18 && (
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 8, fontStyle: 'italic' }}>
          Showing top 18 of {sorted.length}. Open <a href="/bottleneck-intel" style={{ color: 'var(--mc-cyan)' }}>/bottleneck-intel</a> for the full rotation tracker.
        </div>
      )}
    </div>
  );
}
