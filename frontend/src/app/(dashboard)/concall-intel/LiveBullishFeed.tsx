'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useRef, useEffect, useMemo } from 'react';
import { decodeHTMLEntities } from '@/lib/html-decode';
import type { LiveFeedPayload } from './types';
import { FeedStatusNote } from './FeedStatusNote';

export function LiveBullishFeed() {
  const [data, setData] = useState<LiveFeedPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PATCH 0395 — bullish-only toggle defaults to FALSE (no selection bias).
  // User flagged that defaulting to bullish-only is a confirmation-bias risk.
  // Full universe is now the default lens; bullish-only is opt-in.
  const [bullishOnly, setBullishOnly] = useState(false);
  const [exchange, setExchange] = useState<'ALL' | 'NSE' | 'BSE'>('ALL');
  // PATCH 1022 — bump default 7→30 days. The 7d window misses the bulk of
  // Q4 FY26 concalls (April-May 2026 peak) once we're past late-May. Users were
  // seeing only ~7 filings in the default view when 1500+ exist in the 30d window.
  const [days, setDays] = useState(30);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // PATCH 0391 — tier filter chips. Default to ALL TIERS for full-universe view.
  // PATCH 0397 — Added DATA_PENDING to default set.
  // PATCH 0410 — DATA_PENDING removed from defaults.
  // PATCH 0416 — Per user: "i only want bearish and bullish .neutral isnot
  // my importance. i do nothing with such list make it better useful for
  // investing". So default = actionable signals only (ULTRA, BULLISH,
  // MIXED_POSITIVE, BEARISH). NEUTRAL and DATA_PENDING hidden behind chip
  // toggles for when user wants to inspect the broader universe.
  // PATCH 1022 — include NEUTRAL by default. Excluding it hid filings where the
  // PDF extractor couldn't parse a numeric anchor — on quiet days that's ~80% of
  // the queue. User can toggle NEUTRAL off via the tier chips if too noisy.
  const [tierFilter, setTierFilter] = useState<Set<string>>(new Set(['ULTRA_BULLISH', 'BULLISH', 'MIXED_POSITIVE', 'NEUTRAL', 'BEARISH']));
  const toggleTier = (t: string) => {
    setTierFilter(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const fetchFeed = async (force = false) => {
    setLoading(true);
    setError(null);
    // PATCH 0435 BUG-011 — Hard 50s timeout. Vercel route is 60s; 50s gives
    // us a chance to display "timed out" instead of letting the browser
    // hang on the network call indefinitely.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000);
    try {
      const params = new URLSearchParams({
        days: String(days),
        ...(force ? { force: '1' } : {}),
      });
      const res = await fetch(`/api/v1/concall-intel/live-feed?${params}`, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = await res.json();
      setData(j);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.name === 'AbortError' ? 'Timed out after 50s — try Refresh' : (e?.message || 'fetch failed'));
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  // zzz810 — when the exchanges could not be reached, retry every 90s
  // (up to 5 times) instead of waiting for the 5-minute poll.
  const retryCount = useRef(0);
  useEffect(() => {
    const st = data?.fetch_status?.state;
    if (st !== 'FAILED' && st !== 'PARTIAL') { retryCount.current = 0; return; }
    if (retryCount.current >= 5) return;
    const t = setTimeout(() => { retryCount.current++; fetchFeed(true); }, 90_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Initial fetch + auto-poll every 5 min
  useEffect(() => {
    fetchFeed();
    // AUDIT_100 #7 — skip poll when tab is hidden
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchFeed();
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let out = data.filings;
    if (exchange !== 'ALL') out = out.filter(f => f.exchange === exchange);
    if (bullishOnly) {
      // PATCH 1101zzz36 — bullishOnly should ACTUALLY narrow the feed.
      // Previously it just intersected with tierFilter (which defaults to include
      // NEUTRAL), so toggling did almost nothing. Now: restrict to actionable
      // bullish tiers AND drop 1-page subject-only noise (raw composite <= 0.5).
      // The tier chips below still let the user re-widen if needed.
      const BULLISH_TIERS = new Set(['ULTRA_BULLISH', 'BULLISH', 'MIXED_POSITIVE']);
      out = out.filter(f => {
        if (!f.bullish.tier || !BULLISH_TIERS.has(f.bullish.tier)) return false;
        // Drop 1-page subject-only noise (raw_score ≤ 0.5 = no parsed signal)
        if ((f.bullish.raw_score ?? 0) <= 0.5) return false;
        // Honour explicit chip overrides on top of the narrowed default
        if (!tierFilter.has(f.bullish.tier)) return false;
        return true;
      });
    }
    return out;
  }, [data, exchange, bullishOnly, tierFilter]);

  // Tier counts for the filter chip badges
  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = { ULTRA_BULLISH: 0, BULLISH: 0, MIXED_POSITIVE: 0, NEUTRAL: 0, BEARISH: 0, DATA_PENDING: 0 };
    if (!data) return counts;
    for (const f of data.filings) {
      const t = f.bullish.tier;
      if (t && counts[t] != null) counts[t]++;
    }
    return counts;
  }, [data]);

  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-warn) 19%, transparent)', borderLeft: '4px solid var(--mc-warn)', borderRadius: 10, padding: '14px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--mc-warn)', letterSpacing: '0.4px' }}>🔥 LIVE BULLISH FEED — NSE / BSE concall + presentation filings</div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginTop: 2 }}>
            {data ? (
              <>
                {data.count_total} total · {data.count_relevant} concall-relevant ·
                {' '}<strong style={{ color: 'var(--mc-cyan)' }}>{tierCounts.ULTRA_BULLISH || 0} 🚀</strong> ·
                {' '}<strong style={{ color: 'var(--mc-bullish)' }}>{tierCounts.BULLISH || 0} 🟢</strong> ·
                {' '}<strong style={{ color: 'var(--mc-warn)' }}>{tierCounts.MIXED_POSITIVE || 0} 🟡</strong> ·
                {' '}<strong style={{ color: 'var(--mc-text-3)' }}>{tierCounts.NEUTRAL || 0} ⚪</strong> ·
                {' '}<strong style={{ color: 'var(--mc-bearish)' }}>{tierCounts.BEARISH || 0} 🔴</strong> ·
                {' '}<strong style={{ color: 'var(--mc-info)' }}>{tierCounts.DATA_PENDING || 0} 🟦</strong>
                {' '}· sources: NSE <strong style={{ color: data.sources.nse === 'NSE_OK' ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{({NSE_OK:'OK', BSE_EMPTY:'no filings'} as Record<string,string>)[data.sources.nse] || data.sources.nse}</strong> · BSE <strong style={{ color: data.sources.bse === 'BSE_OK' ? 'var(--mc-bullish)' : 'var(--mc-text-3)' }}>{({NSE_OK:'OK', BSE_EMPTY:'no filings'} as Record<string,string>)[data.sources.bse] || data.sources.bse}</strong>
                {lastRefresh && <> · refreshed {lastRefresh.toLocaleTimeString()}</>}
              </>
            ) : loading ? 'Loading…' : '—'}
          </div>
          {/* PATCH 0399 — Universe distribution bar chart (visual baseline) */}
          {data && (() => {
            const total = Object.values(tierCounts).reduce((s, n) => s + n, 0);
            if (total === 0) return null;
            const segments = [
              { key: 'ULTRA_BULLISH', color: '#22D3EE' },
              { key: 'BULLISH',       color: '#10B981' },
              { key: 'MIXED_POSITIVE',color: '#F59E0B' },
              { key: 'NEUTRAL',       color: '#94A3B8' },
              { key: 'BEARISH',       color: '#EF4444' },
              { key: 'DATA_PENDING',  color: '#3B82F6' },
            ];
            return (
              <div style={{ display: 'flex', height: 5, width: '100%', borderRadius: 2, overflow: 'hidden', marginTop: 4, background: 'var(--mc-bg-0)' }}>
                {segments.map(s => {
                  const n = tierCounts[s.key] || 0;
                  const pct = total > 0 ? (n / total) * 100 : 0;
                  if (pct === 0) return null;
                  return <div key={s.key} title={`${s.key} ${n} (${pct.toFixed(1)}%)`} style={{ width: `${pct}%`, background: s.color }} />;
                })}
              </div>
            );
          })()}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setBullishOnly(v => !v)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: `1px solid ${bullishOnly ? 'var(--mc-bullish)' : 'var(--mc-bg-4)'}`, background: bullishOnly ? 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)' : 'transparent', color: bullishOnly ? 'var(--mc-bullish)' : 'var(--mc-text-3)', cursor: 'pointer' }}>
            ★ Bullish only {bullishOnly ? '✓' : ''}
          </button>
          {(['ALL', 'NSE', 'BSE'] as const).map(e => (
            <button key={e} onClick={() => setExchange(e)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: `1px solid ${exchange === e ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`, background: exchange === e ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent', color: exchange === e ? 'var(--mc-cyan)' : 'var(--mc-text-3)', cursor: 'pointer' }}>
              {e}
            </button>
          ))}
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid var(--mc-bg-4)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)' }}>
            <option value={1}>1 day</option>
            <option value={2}>2 days</option>
            <option value={3}>3 days</option>
            <option value={5}>5 days</option>
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

      {/* PATCH 0420 — Suppress red error chip when usable data IS loaded.
          Vercel's 60s hard timeout can kill the function before our try/catch
          returns a graceful 200, producing a real HTTP 500 even when the
          last successful response still has fresh data shown on screen.
          Show a soft amber notice instead, only if no data is rendered. */}
      {error && (!data || (data.filings?.length || 0) === 0) && (
        <div style={{ fontSize: 11, color: 'var(--mc-bearish)', marginBottom: 8 }}>⚠ {error}</div>
      )}
      {error && data && (data.filings?.length || 0) > 0 && (
        <div style={{ fontSize: 10, color: 'var(--mc-warn)', marginBottom: 8, fontStyle: 'italic' }}>
          · last refresh slow ({error}); showing previous results
        </div>
      )}

      {/* PATCH 0391 — Tier filter chips */}
      {data && bullishOnly && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            { id: 'ULTRA_BULLISH',  label: '🚀 Ultra Bullish',    color: '#22D3EE' },
            { id: 'BULLISH',        label: '🟢 Bullish',           color: '#10B981' },
            { id: 'MIXED_POSITIVE', label: '🟡 Mixed Positive',    color: '#F59E0B' },
            { id: 'NEUTRAL',        label: '⚪ Neutral',            color: '#94A3B8' },
            { id: 'BEARISH',        label: '🔴 Bearish',           color: '#EF4444' },
            { id: 'DATA_PENDING',   label: '🟦 Data Pending',      color: '#3B82F6' },
          ].map(t => {
            const active = tierFilter.has(t.id);
            const count = tierCounts[t.id] || 0;
            return (
              <button key={t.id} onClick={() => toggleTier(t.id)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 5, border: `1px solid ${active ? t.color : 'var(--mc-bg-4)'}`, background: active ? `${t.color}20` : 'transparent', color: active ? t.color : 'var(--mc-text-3)', cursor: 'pointer' }}>
                {t.label} · {count}
              </button>
            );
          })}
        </div>
      )}

      {/* zzz810 — say whether the exchanges were reached, with real counts. */}
      {data?.fetch_status && (
        <div style={{ marginBottom: 8 }}><FeedStatusNote status={data.fetch_status} compact={data.fetch_status.state === 'OK'} /></div>
      )}
      {filtered.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic', padding: '12px 0' }}>
          {data && data.count_relevant > 0
            ? `No filings match the selected tiers. Try enabling more tiers above (e.g. Mixed Positive surfaces realistic mid-quality bullish setups).`
            : data?.fetch_status
              ? (data.fetch_status.state === 'FAILED' ? 'No filings to show until NSE/BSE can be reached — see the note above.' : data.fetch_status.message)
              : 'No concall filings loaded — the feed did not say whether NSE/BSE were reached. Press ↻ Refresh.'}
        </div>
      )}

      {/* PATCH 0421 — DEDICATED BOTTLENECK PANEL pinned ABOVE everything.
          User asked: "is bottleneck/bushing coming naturally or hardcoded?".
          Answer: DETECTION is 100% pattern-based regex on concall text
          (no company-specific hardcoding, no stale data). Only the SYMPATHY
          BENEFICIARIES (which listed tickers serve a constrained component)
          are mapped via curated industry knowledge — that's a deliberate
          read-through aid, not detection.
          This panel surfaces EVERY bottleneck detection across the window,
          including single-company ones (the Theme Cluster panel below
          requires ≥3 companies and skips lone-wolf signals like Quality
          Power's bushing miss). */}
      {data && (() => {
        const filings: any[] = (data.filings || []) as any[];
        const detected = filings.filter(f => f.bottleneck && f.bottleneck.detected);
        if (detected.length === 0) return null;
        // Group by component key (component names normalized in scanner)
        type Group = { component: string; critical: boolean; companies: Array<{ symbol: string; company_name: string; subject: string; evidence: string }>; beneficiaries: Set<string>; sectors: Set<string> };
        const groups = new Map<string, Group>();
        const ungrouped: Array<{ symbol: string; company_name: string; subject: string; evidence: string; critical: boolean }> = [];
        for (const f of detected) {
          const ev = (f.bottleneck.evidence || [])[0] || '';
          const comps: string[] = f.bottleneck.components || [];
          if (comps.length === 0) {
            // Bottleneck phrasing fired but no known component vocab match.
            // Surface raw evidence — this is exactly the "future bottlenecks
            // I can identify with this" case the user asked for.
            ungrouped.push({
              symbol: f.symbol || '',
              company_name: f.company_name || '',
              subject: f.subject || '',
              evidence: ev,
              critical: !!f.bottleneck.critical,
            });
            continue;
          }
          for (const c of comps) {
            const g = groups.get(c) || { component: c, critical: false, companies: [], beneficiaries: new Set<string>(), sectors: new Set<string>() };
            if (f.bottleneck.critical) g.critical = true;
            g.companies.push({ symbol: f.symbol || '', company_name: f.company_name || '', subject: f.subject || '', evidence: ev });
            for (const b of (f.bottleneck.beneficiaries || [])) g.beneficiaries.add(b);
            for (const s of (f.bottleneck.sectors || [])) g.sectors.add(s);
            groups.set(c, g);
          }
        }
        const groupArr = Array.from(groups.values()).sort((a, b) => {
          if (a.critical !== b.critical) return a.critical ? -1 : 1;
          return b.companies.length - a.companies.length;
        });
        return (
          <div style={{ marginBottom: 14, padding: 14, background: 'linear-gradient(135deg, color-mix(in srgb, var(--mc-bearish) 8%, transparent), color-mix(in srgb, var(--mc-warn) 6%, transparent))', border: '1px solid color-mix(in srgb, var(--mc-bearish) 38%, transparent)', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-bearish)', letterSpacing: '0.5px' }}>
                🚨 SUPPLY-CHAIN BOTTLENECKS DETECTED — {detected.length} filing{detected.length === 1 ? '' : 's'} across {groupArr.length} component{groupArr.length === 1 ? '' : 's'}{ungrouped.length > 0 ? ` + ${ungrouped.length} unmapped` : ''}
              </div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 600 }}>last {days}d · pattern-detected</div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 10, fontStyle: 'italic' }}>
              Detection is 100% regex on concall text — no company hardcoding. Sympathy beneficiaries are mapped from curated industry knowledge; verify independently.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 10 }}>
              {groupArr.slice(0, 12).map((g, gi) => (
                <div key={g.component + '-bg-' + gi} style={{ padding: 10, background: 'var(--mc-bg-0)', border: `1px solid ${g.critical ? 'var(--mc-bearish)' : 'var(--mc-warn)'}60`, borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: g.critical ? 'var(--mc-bearish)' : 'var(--mc-warn)' }}>
                      {g.critical ? '🚨 ' : '⚠ '}{g.component.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>{g.companies.length} co{g.companies.length === 1 ? '' : 's'}</div>
                  </div>
                  {g.sectors.size > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--mc-text-3)', marginBottom: 4 }}>sector: {Array.from(g.sectors).join(' · ')}</div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--mc-text-2)', marginBottom: 6, lineHeight: 1.45 }}>
                    {g.companies.slice(0, 2).map((c, ci) => (
                      <div key={c.symbol + '-c-' + ci} style={{ marginBottom: 3 }}>
                        <strong style={{ color: 'var(--mc-cyan)' }}>[{c.symbol || c.company_name}]</strong> &ldquo;{(c.evidence || '').slice(0, 180)}{(c.evidence || '').length > 180 ? '…' : ''}&rdquo;
                      </div>
                    ))}
                    {g.companies.length > 2 && (
                      <div style={{ fontSize: 9, color: 'var(--mc-text-3)' }}>+ {g.companies.length - 2} more</div>
                    )}
                  </div>
                  {g.beneficiaries.size > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--mc-bullish)' }}>
                      <span style={{ fontWeight: 800 }}>↪ POTENTIAL READ-THROUGH:</span> {Array.from(g.beneficiaries).slice(0, 8).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {ungrouped.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, background: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-state-persistent)', marginBottom: 6, letterSpacing: '0.5px' }}>
                  📡 RAW BOTTLENECK EVIDENCE (component not in known vocab — surface so future bottlenecks aren't missed)
                </div>
                {ungrouped.slice(0, 6).map((u, ui) => (
                  <div key={u.symbol + '-u-' + ui} style={{ fontSize: 10, color: 'var(--mc-text-2)', marginBottom: 4, lineHeight: 1.45 }}>
                    <strong style={{ color: 'var(--mc-cyan)' }}>[{u.symbol || u.company_name}]</strong> {u.critical ? '🚨 ' : ''}&ldquo;{(u.evidence || '').slice(0, 200)}{(u.evidence || '').length > 200 ? '…' : ''}&rdquo;
                  </div>
                ))}
                {ungrouped.length > 6 && (
                  <div style={{ fontSize: 9, color: 'var(--mc-text-3)', marginTop: 4 }}>+ {ungrouped.length - 6} more raw evidence lines</div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* PATCH 0408 — Cross-Company Theme Aggregator panel.
          When ≥3 unrelated companies independently surface the same
          industrial signal (bottleneck component / tag / sector), that
          cross-confirmation is institutional-grade conviction. Pinned
          ABOVE the Top 10 because the read-through value is higher than
          any single filing — these are the themes the broader market is
          about to discover. */}
      {data && (data as any).theme_clusters && (data as any).theme_clusters.length > 0 && (
        <div style={{ marginBottom: 14, padding: 14, background: 'linear-gradient(135deg, #06B6D420, color-mix(in srgb, var(--mc-state-persistent) 6%, transparent))', border: '1px solid #06B6D470', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: '#06B6D4', letterSpacing: '0.5px' }}>
              🌐 CROSS-COMPANY THEME CLUSTERS — institutional cross-confirmation across the window
            </div>
            <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 600 }}>
              {(data as any).theme_clusters.length} cluster{(data as any).theme_clusters.length === 1 ? '' : 's'} · last {days}d
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 10 }}>
            {((data as any).theme_clusters as any[]).slice(0, 12).map((tc, ti) => {
              const convictionColor = tc.conviction === 'INSTITUTIONAL' ? '#22D3EE'
                : tc.conviction === 'CONFIRMED' ? '#10B981'
                : tc.conviction === 'EMERGING' ? '#F59E0B'
                : '#94A3B8';
              const kindIcon = tc.kind === 'COMPONENT' ? '🧩' : tc.kind === 'SECTOR' ? '🏷' : '#';
              return (
                <div key={tc.key + '-tc-' + ti} style={{ padding: 10, background: 'var(--mc-bg-0)', border: `1px solid ${convictionColor}50`, borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--mc-text-1)' }}>
                      <span style={{ marginRight: 6 }}>{kindIcon}</span>{tc.label}
                    </div>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: `${convictionColor}25`, color: convictionColor, fontWeight: 900, letterSpacing: '0.4px' }}>
                      {tc.conviction}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6 }}>
                    {tc.company_count} unique compan{tc.company_count === 1 ? 'y' : 'ies'} · {tc.filing_count} filings · avg composite {tc.avg_score.toFixed(1)}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                    {tc.top_companies.slice(0, 8).map((c: any) => (
                      <span key={c.symbol} title={`${c.company_name} · composite ${c.score.toFixed(1)}`} style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, background: 'var(--mc-bg-4)', color: 'var(--mc-text-2)', border: '1px solid var(--mc-bg-4)' }}>
                        {c.symbol} <span style={{ color: convictionColor, marginLeft: 3 }}>{c.score.toFixed(1)}</span>
                      </span>
                    ))}
                  </div>
                  {tc.kind === 'COMPONENT' && Array.isArray(tc.beneficiaries) && tc.beneficiaries.length > 0 && (
                    <div style={{ marginBottom: 5 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mc-text-3)', marginBottom: 3 }}>★ READ-THROUGH BENEFICIARIES (verify independently)</div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {tc.beneficiaries.slice(0, 10).map((b: string) => (
                          <span key={b} style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)' }}>{b}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {tc.evidence_excerpts && tc.evidence_excerpts.length > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontStyle: 'italic', marginTop: 4, lineHeight: 1.4 }}>
                      {tc.evidence_excerpts.slice(0, 2).map((ex: string, i: number) => (
                        <div key={i} style={{ marginBottom: 2 }}>› {ex}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PATCH 0395 — Top 10 Ranked Ideas pinned panel
          PATCH 0397: Now ranks by composite_score (0.5*Quality + 0.3*Cycle +
          0.2*Sentiment), the institutional-grade weighting per spec, instead
          of raw_score which over-favors narrative density.
          PATCH 0405: Widened from Top 3 to Top 10 so a longer lookback
          window (60 / 90 days) surfaces more institutional ideas. The
          panel re-derives from `data.filings` on every refetch, so changing
          the days selector immediately refreshes the shortlist. The
          chip-count below shows how many days the current window covers. */}
      {data && (() => {
        // PATCH 0417 — HARD-ACTIONABLE ONLY. User: "i want top 10 ranking
        // bullish not neutral its no news also". No NEUTRAL fallback. If
        // fewer than 10 actionable signals exist, show fewer. If zero,
        // render explicit empty state.
        const ranked = [...data.filings]
          .filter(f => f.bullish.tier && ['ULTRA_BULLISH', 'BULLISH', 'MIXED_POSITIVE', 'BEARISH'].includes(f.bullish.tier))
          .sort((a, b) => {
            const compA = (a.bullish.components as any).composite_score ?? a.bullish.raw_score;
            const compB = (b.bullish.components as any).composite_score ?? b.bullish.raw_score;
            return compB - compA;
          })
          .slice(0, 10);
        if (ranked.length === 0) {
          return (
            <div style={{ marginBottom: 12, padding: 16, background: 'linear-gradient(135deg, color-mix(in srgb, var(--mc-bullish) 6%, transparent), color-mix(in srgb, var(--mc-cyan) 6%, transparent))', border: '1px solid var(--mc-bg-4)', borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-text-3)', letterSpacing: '0.5px', marginBottom: 4 }}>
                ★ TOP RANKED — institutional shortlist
              </div>
              <div style={{ fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.5 }}>
                No actionable signals in the last {days} day{days === 1 ? '' : 's'} yet.
                Strict calibration filters out boilerplate. As more PDFs are extracted from
                background cache (each refresh adds 50-100), real BULLISH / MIXED_POSITIVE
                transcripts will surface here.
              </div>
            </div>
          );
        }
        return (
          <div style={{ marginBottom: 12, padding: 12, background: 'linear-gradient(135deg, color-mix(in srgb, var(--mc-bullish) 6%, transparent), color-mix(in srgb, var(--mc-cyan) 6%, transparent))', border: '1px solid color-mix(in srgb, var(--mc-bullish) 31%, transparent)', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--mc-bullish)', letterSpacing: '0.5px' }}>★ TOP {ranked.length} RANKED — institutional shortlist (by composite: 0.5×Quality + 0.3×Cycle + 0.2×Sentiment)</div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 600 }}>· window: last {days} day{days === 1 ? '' : 's'}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }}>
              {ranked.map((r, i) => {
                const tierColor = r.bullish.tier === 'ULTRA_BULLISH' ? '#22D3EE' : r.bullish.tier === 'BULLISH' ? '#10B981' : '#F59E0B';
                return (
                  <div key={r.symbol + '-rank-' + i} style={{ padding: 10, background: 'var(--mc-bg-0)', border: `1px solid ${tierColor}50`, borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div>
                        <span style={{ fontSize: 9, color: 'var(--mc-warn)', fontWeight: 900, marginRight: 6 }}>#{i + 1}</span>
                        <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-text-1)' }}>{r.symbol || r.company_name}</span>
                      </div>
                      <span title={`Composite = 0.5×Q + 0.3×C + 0.2×S. Raw bullish: ${r.bullish.raw_score.toFixed(1)}`} style={{ fontSize: 16, fontWeight: 900, color: tierColor }}>{((r.bullish.components as any).composite_score ?? r.bullish.raw_score).toFixed(1)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 4 }}>{r.company_name}</div>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: 8 }}>
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: `${tierColor}20`, color: tierColor, fontWeight: 800 }}>{r.bullish.tier?.replace('_', ' ')}</span>
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)' }}>Mgmt {r.bullish.components.management_confidence.toFixed(1)}</span>
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)' }}>Biz {r.bullish.components.business_evidence.toFixed(1)}</span>
                      {(r.bullish.components.blockers || 0) > 0 && <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: 'var(--mc-bearish)' }}>Risk {r.bullish.components.blockers.toFixed(1)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.slice(0, 150).map((f, i) => {  /* PATCH 1022 — was 50; show more filings */
          const scoreColor = f.bullish.raw_score >= 8 ? '#10B981' : f.bullish.raw_score >= 5 ? '#22D3EE' : f.bullish.raw_score >= 2 ? '#F59E0B' : '#94A3B8';
          const filingTypeLabel: Record<string, string> = {
            TRANSCRIPT: '📜 Transcript',
            INVESTOR_PRESENTATION: '📊 Investor Pres',
            CONCALL_INVITE: '📞 Concall',
            ANALYST_MEET: '🤝 Analyst Meet',
            AUDIO_RECORDING: '🎧 Audio',
            RESULTS_PRESENTATION: '📈 Results Pres',
            WEBCAST: '📡 Webcast',
            PRESS_RELEASE: '📰 Press Release',
          };
          return (
            <div key={f.symbol + '-' + i} style={{ padding: '10px 12px', background: 'var(--mc-bg-0)', border: `1px solid ${f.is_high_bullish ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'var(--mc-bg-4)'}`, borderLeft: `3px solid ${scoreColor}`, borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-text-1)' }}>{f.symbol || f.company_name}</span>
                  {f.symbol && <span style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>{f.company_name}</span>}
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--mc-bg-4)', color: 'var(--mc-text-3)', fontWeight: 700 }}>{f.exchange}</span>
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${scoreColor}20`, color: scoreColor, fontWeight: 700 }}>{filingTypeLabel[f.filing_type] || f.filing_type}</span>
                  {/* PATCH 0391 — tier badge replaces single HIGH BULLISH */}
                  {(() => {
                    const tier = f.bullish.tier;
                    const tierLabel: Record<string, { label: string; color: string }> = {
                      ULTRA_BULLISH:  { label: '🚀 ULTRA BULLISH', color: '#22D3EE' },
                      BULLISH:        { label: '🟢 BULLISH',        color: '#10B981' },
                      MIXED_POSITIVE: { label: '🟡 MIXED POSITIVE', color: '#F59E0B' },
                      NEUTRAL:        { label: '⚪ NEUTRAL',         color: '#94A3B8' },
                      BEARISH:        { label: '🔴 BEARISH',         color: '#EF4444' },
                      DATA_PENDING:   { label: '🟦 DATA PENDING',   color: '#3B82F6' },
                    };
                    const t = tier ? tierLabel[tier] : null;
                    if (!t) return null;
                    return <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${t.color}20`, color: t.color, fontWeight: 800, border: `1px solid ${t.color}` }}>{t.label}</span>;
                  })()}
                  {f.bullish.fatal_blockers && f.bullish.fatal_blockers.length > 0 && (
                    <span title={`Fatal blockers: ${f.bullish.fatal_blockers.join(', ')}`} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 15%, transparent)', color: 'var(--mc-bearish)', fontWeight: 800, border: '1px solid var(--mc-bearish)' }}>☠ FATAL</span>
                  )}
                  {f.scored_from === 'PDF' && <span title={`Scored from extracted PDF text${f.pdf_pages ? ` (${f.pdf_pages}p)` : ''}`} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', fontWeight: 700 }}>📄 PDF</span>}
                  {f.scored_from === 'SUBJECT' && f.pdf_failure_reason && <span title={`PDF extraction failed: ${f.pdf_failure_reason}`} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-text-3) 8%, transparent)', color: 'var(--mc-text-3)', fontWeight: 700 }}>📝 subject only</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  {/* PATCH 0398 — Composite is the primary score now per
                      institutional spec. raw_score becomes diagnostic. */}
                  {(() => {
                    const composite = (f.bullish.components as any).composite_score;
                    const primary = composite != null ? composite : f.bullish.raw_score;
                    return (
                      <>
                        <span title={`Composite = 0.5×Quality + 0.3×Cycle + 0.2×Sentiment. Raw bullish score: ${f.bullish.raw_score.toFixed(1)}`} style={{ fontSize: 16, fontWeight: 900, color: scoreColor }}>{primary.toFixed(1)}</span>
                        {composite != null && (
                          <span style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>· raw {f.bullish.raw_score.toFixed(1)}</span>
                        )}
                        <span style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>· {f.bullish.confidence}</span>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--mc-text-2)', marginBottom: 6, lineHeight: 1.4 }}>{decodeHTMLEntities(f.subject)}</div>
              {f.bullish.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {f.bullish.tags.map((t, j) => (
                    <span key={j} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>{t}</span>
                  ))}
                </div>
              )}
              {f.bullish.red_flags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {f.bullish.red_flags.map((t, j) => (
                    <span key={j} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: 'var(--mc-bearish)', fontWeight: 700 }}>⚠ {t}</span>
                  ))}
                </div>
              )}
              {/* PATCH 0407 — Bottleneck + sympathy beneficiary read-through */}
              {(f as any).bottleneck && (f as any).bottleneck.detected && (
                <div style={{ marginTop: 6, padding: '8px 10px', background: 'linear-gradient(135deg, color-mix(in srgb, var(--mc-warn) 8%, transparent), color-mix(in srgb, var(--mc-bearish) 8%, transparent))', border: `1px solid ${(f as any).bottleneck.critical ? 'var(--mc-bearish)' : 'var(--mc-warn)'}60`, borderRadius: 5 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: (f as any).bottleneck.critical ? 'var(--mc-bearish)' : 'var(--mc-warn)', letterSpacing: '0.5px', marginBottom: 4 }}>
                    {(f as any).bottleneck.critical ? '🚨 CRITICAL BOTTLENECK DETECTED' : '⚠ BOTTLENECK DETECTED'}
                    {(f as any).bottleneck.components.length > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--mc-text-2)', fontWeight: 700 }}>· components: {(f as any).bottleneck.components.join(', ')}</span>
                    )}
                  </div>
                  {(f as any).bottleneck.evidence && (f as any).bottleneck.evidence.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--mc-text-2)', marginBottom: 4, fontStyle: 'italic' }}>
                      &ldquo;{((f as any).bottleneck.evidence[0] || '').slice(0, 220)}{((f as any).bottleneck.evidence[0]?.length || 0) > 220 ? '…' : ''}&rdquo;
                    </div>
                  )}
                  {(f as any).bottleneck.beneficiaries && (f as any).bottleneck.beneficiaries.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mc-text-3)', letterSpacing: '0.4px', marginBottom: 3 }}>
                        ★ POTENTIAL READ-THROUGH BENEFICIARIES (verify independently)
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {((f as any).bottleneck.beneficiaries as string[]).slice(0, 8).map((b: string) => (
                          <span key={b} style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)' }}>{b}</span>
                        ))}
                      </div>
                      {(f as any).bottleneck.sectors && (f as any).bottleneck.sectors.length > 0 && (
                        <div style={{ fontSize: 9, color: 'var(--mc-text-3)', marginTop: 3 }}>
                          · sectors: {((f as any).bottleneck.sectors as string[]).join(' · ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* PATCH 0410 — Evidence Hierarchy transparency chip strip */}
              {(f as any).evidence && (() => {
                const ev = (f as any).evidence;
                const chips: Array<{ label: string; bg: string; fg: string; title?: string }> = [];
                chips.push({
                  label: `${ev.filing_type_weight.toFixed(2)}× ${f.filing_type.replace(/_/g, ' ').toLowerCase()}`,
                  bg: ev.filing_type_weight >= 0.80 ? '#10B98120' : ev.filing_type_weight >= 0.45 ? '#F59E0B20' : '#EF444420',
                  fg: ev.filing_type_weight >= 0.80 ? '#10B981' : ev.filing_type_weight >= 0.45 ? '#F59E0B' : '#EF4444',
                  title: 'Filing-type trust weight applied to composite score',
                });
                chips.push({
                  label: `${ev.numeric_evidence_count} numeric`,
                  bg: ev.numeric_evidence_count >= 2 ? '#10B98120' : '#EF444420',
                  fg: ev.numeric_evidence_count >= 2 ? '#10B981' : '#EF4444',
                  title: ev.numeric_examples?.join(' · ') || 'Distinct numeric anchors',
                });
                if (ev.has_financial_evidence) chips.push({ label: 'Tier-1 financial ✓', bg: '#10B98125', fg: '#10B981', title: 'Reported margin/PAT/revenue/ROCE/CFO improvement' });
                if (ev.has_business_evidence)  chips.push({ label: 'Tier-2 business ✓', bg: '#22D3EE25', fg: '#22D3EE', title: 'Order book / capex / commissioning / capacity' });
                if (ev.has_guidance_evidence)  chips.push({ label: 'Tier-3 guidance ✓', bg: '#A78BFA25', fg: '#A78BFA', title: 'Quantified forward outlook' });
                if (ev.boilerplate_hits >= 3)  chips.push({ label: `${ev.boilerplate_hits} boilerplate`, bg: '#EF444420', fg: '#EF4444', title: 'Generic deck language detected' });
                if (ev.cap_reason)             chips.push({ label: 'Capped', bg: '#F59E0B25', fg: '#F59E0B', title: ev.cap_reason });
                return (
                  <div style={{ marginTop: 5, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {chips.map((c, i) => (
                      <span key={i} title={c.title} style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, background: c.bg, color: c.fg, letterSpacing: '0.3px' }}>
                        {c.label}
                      </span>
                    ))}
                  </div>
                );
              })()}

              {/* PATCH 0389 — Evidence sentences pulled from PDF */}
              {f.bullish.evidence && f.bullish.evidence.length > 0 && (() => {
                const bull = f.bullish.evidence.filter(e => e.polarity === 'BULL' && !e.negated);
                const bear = f.bullish.evidence.filter(e => e.polarity === 'BEAR' || e.negated);
                return (
                  <div style={{ marginTop: 6, marginBottom: 4, fontSize: 10, lineHeight: 1.5 }}>
                    {bull.length > 0 && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--mc-bullish)', fontWeight: 700, marginRight: 4 }}>WHY BULLISH:</span>
                        <div style={{ marginLeft: 0, marginTop: 2 }}>
                          {bull.slice(0, 4).map((e, k) => (
                            <div key={k} style={{ color: 'var(--mc-text-2)', padding: '1px 0' }}>› <span style={{ color: 'color-mix(in srgb, var(--mc-bullish) 50%, transparent)', fontWeight: 700 }}>[{e.tag}]</span> &ldquo;{e.text}&rdquo;</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {bear.length > 0 && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--mc-bearish)', fontWeight: 700, marginRight: 4 }}>RISKS:</span>
                        <div style={{ marginLeft: 0, marginTop: 2 }}>
                          {bear.slice(0, 3).map((e, k) => (
                            <div key={k} style={{ color: 'var(--mc-text-2)', padding: '1px 0' }}>› <span style={{ color: 'color-mix(in srgb, var(--mc-bearish) 50%, transparent)', fontWeight: 700 }}>[{e.tag}{e.negated ? ' — negated' : ''}]</span> &ldquo;{e.text}&rdquo;</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* PATCH 0424 — Earnings Delta Predictor + Narrative-vs-Financial
                  2-axis split. Institutional review item 4.4 + 4.5.
                  Translates concall tags into directional revenue / margin
                  reads + a story-vs-numbers split so users can spot the
                  "strong story / weak earnings" mismatch class. */}
              {(f as any).earnings_delta && (
                <div style={{ marginTop: 6, padding: '7px 9px', background: 'linear-gradient(135deg, #06B6D410, color-mix(in srgb, var(--mc-state-persistent) 3%, transparent))', border: '1px solid #06B6D440', borderRadius: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#06B6D4', letterSpacing: '0.4px' }}>
                      💡 EARNINGS DELTA · <span style={{ color:
                        (f as any).earnings_delta.net_read === 'BULLISH' ? 'var(--mc-bullish)' :
                        (f as any).earnings_delta.net_read === 'BEARISH' ? 'var(--mc-bearish)' :
                        (f as any).earnings_delta.net_read === 'MIXED'   ? 'var(--mc-warn)' : 'var(--mc-text-3)'
                      }}>{(f as any).earnings_delta.net_read}</span>
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>{(f as any).earnings_delta.rationale}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    {[
                      { lbl: 'Revenue',
                        val: `${(f as any).earnings_delta.revenue_direction === 'POSITIVE' ? '↑' : (f as any).earnings_delta.revenue_direction === 'NEGATIVE' ? '↓' : '→'} ${(f as any).earnings_delta.revenue_magnitude}`,
                        color: (f as any).earnings_delta.revenue_direction === 'POSITIVE' ? '#10B981' : (f as any).earnings_delta.revenue_direction === 'NEGATIVE' ? '#EF4444' : '#94A3B8' },
                      { lbl: 'Margin',
                        val: `${(f as any).earnings_delta.margin_direction === 'POSITIVE' ? '↑' : (f as any).earnings_delta.margin_direction === 'NEGATIVE' ? '↓' : '→'} ${(f as any).earnings_delta.margin_magnitude}`,
                        color: (f as any).earnings_delta.margin_direction === 'POSITIVE' ? '#10B981' : (f as any).earnings_delta.margin_direction === 'NEGATIVE' ? '#EF4444' : '#94A3B8' },
                      { lbl: 'Cycle risk',
                        val: (f as any).earnings_delta.cycle_risk,
                        color: (f as any).earnings_delta.cycle_risk === 'HIGH' ? '#EF4444' : (f as any).earnings_delta.cycle_risk === 'MEDIUM' ? '#F59E0B' : '#10B981' },
                    ].map((c, j) => (
                      <span key={j} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: `${c.color}15`, color: c.color, fontWeight: 800 }}>
                        {c.lbl}: {c.val}
                      </span>
                    ))}
                  </div>
                  {/* Narrative vs Financial split — review item 4.5 */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 9 }}>
                    <span style={{ color: 'var(--mc-text-3)', fontWeight: 700 }}>NARR vs FIN:</span>
                    <span title="Narrative strength: story quality (tag breadth + forward language)" style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', color: 'var(--mc-state-persistent)', fontWeight: 800 }}>
                      📖 {(f as any).earnings_delta.narrative_strength.toFixed(1)}/10
                    </span>
                    <span title="Financial strength: actual numbers + concrete guidance + composite score" style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', fontWeight: 800 }}>
                      💰 {(f as any).earnings_delta.financial_strength.toFixed(1)}/10
                    </span>
                    {Math.abs((f as any).earnings_delta.narrative_strength - (f as any).earnings_delta.financial_strength) >= 3 && (
                      <span style={{ color: 'var(--mc-warn)', fontStyle: 'italic' }}>
                        ⚠ {(f as any).earnings_delta.narrative_strength > (f as any).earnings_delta.financial_strength ? 'story-ahead-of-numbers' : 'numbers-ahead-of-story'}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* PATCH 0395+0397 — Decomposed score breakdown (transparency) */}
              <div style={{ marginTop: 6, padding: '6px 8px', background: '#13131a', border: '1px solid var(--mc-bg-4)', borderRadius: 4 }}>
                <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontWeight: 700, marginBottom: 3, letterSpacing: '0.4px' }}>
                  SCORE DECOMPOSITION (raw {f.bullish.raw_score.toFixed(1)} / 10)
                  {(f.bullish.components as any).composite_score != null && (
                    <span style={{ marginLeft: 8, color: 'var(--mc-bullish)' }}>· composite {(f.bullish.components as any).composite_score.toFixed(1)} / 10</span>
                  )}
                  {(f.bullish.components as any).earnings_anchored && (
                    <span title={`Anchors: ${((f.bullish.components as any).anchor_evidence || []).join(' · ')}`} style={{ marginLeft: 8, color: 'var(--mc-bullish)', fontWeight: 800 }}>· ⚓ EARNINGS-ANCHORED</span>
                  )}
                  {!(f.bullish.components as any).earnings_anchored && (
                    <span style={{ marginLeft: 8, color: 'var(--mc-warn)', fontWeight: 700 }}>· ⚠ no financial anchor (capped at 6)</span>
                  )}
                </div>
                {/* PATCH 0401 — Sector overlay chip + signals */}
                {f.sector_overlay && f.sector_overlay.sector !== 'UNKNOWN' && (
                  <div style={{ marginBottom: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 9 }}>
                    <span title={`Sector confidence: ${f.sector_overlay.sector_confidence}/10`} style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', color: 'var(--mc-state-persistent)', fontWeight: 800 }}>
                      🏷 {f.sector_overlay.sector.replace('_', ' ')}
                    </span>
                    {f.sector_overlay.overlay_score !== 0 && (
                      <span title="Sector overlay adjusts base score by +/-3 based on sector-specific signals" style={{ padding: '1px 6px', borderRadius: 3, background: f.sector_overlay.overlay_score > 0 ? 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', color: f.sector_overlay.overlay_score > 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 800 }}>
                        overlay {f.sector_overlay.overlay_score > 0 ? '+' : ''}{f.sector_overlay.overlay_score.toFixed(1)}
                      </span>
                    )}
                    {f.sector_overlay.positive_signals.slice(0, 3).map((s, j) => (
                      <span key={j} title="Sector positive signal" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>✓ {s}</span>
                    ))}
                    {f.sector_overlay.negative_signals.slice(0, 2).map((s, j) => (
                      <span key={j} title="Sector negative signal" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: 'var(--mc-bearish)', fontWeight: 700 }}>✗ {s}</span>
                    ))}
                  </div>
                )}
                {/* PATCH 0397 — 3-LAYER score bars (Quality / Cycle / Sentiment) */}
                {(f.bullish.components as any).quality_score != null && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 9, marginBottom: 4 }}>
                    <span title="Quality layer: margin stability + cash flow + deleveraging" style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', color: 'var(--mc-cyan)', fontWeight: 800 }}>Q {((f.bullish.components as any).quality_score ?? 0).toFixed(1)}/10</span>
                    <span title="Cycle layer: order book + capacity + demand + new customer + capex" style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', color: 'var(--mc-state-persistent)', fontWeight: 800 }}>C {((f.bullish.components as any).cycle_score ?? 0).toFixed(1)}/10</span>
                    <span title="Sentiment layer: guidance + management tone + outlook" style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', fontWeight: 800 }}>S {((f.bullish.components as any).sentiment_score ?? 0).toFixed(1)}/10</span>
                    <span style={{ fontSize: 9, color: 'var(--mc-text-4)', fontStyle: 'italic', alignSelf: 'center' }}>composite = 0.5×Q + 0.3×C + 0.2×S</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 9 }}>
                  <span title="Sum of bullish combo points before penalties" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>Positive {(f.bullish.components.positive_score ?? f.bullish.raw_score).toFixed(1)}</span>
                  <span title="Management confidence pillar (Guidance + Demand + Margin + Outlook)" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', fontWeight: 700 }}>Mgmt {f.bullish.components.management_confidence.toFixed(1)}</span>
                  <span title="Business evidence pillar (Order Book + Capacity + Customer + Capex + etc.)" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', color: 'var(--mc-state-persistent)', fontWeight: 700 }}>Biz {f.bullish.components.business_evidence.toFixed(1)}</span>
                  <span title="Total blocker weight (LOW + MEDIUM + FATAL) — deduped per tag" style={{ padding: '1px 5px', borderRadius: 3, background: f.bullish.components.blockers > 0 ? 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)' : 'color-mix(in srgb, var(--mc-text-3) 8%, transparent)', color: f.bullish.components.blockers > 0 ? 'var(--mc-bearish)' : 'var(--mc-text-3)', fontWeight: 700 }}>Risk -{f.bullish.components.blockers.toFixed(1)}</span>
                  {(f.bullish.components.blocker_severity_fatal ?? 0) > 0 && <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 19%, transparent)', color: 'var(--mc-bearish)', fontWeight: 800 }}>FATAL -{(f.bullish.components.blocker_severity_fatal ?? 0).toFixed(1)}</span>}
                  {(f.bullish.components.blocker_severity_medium ?? 0) > 0 && <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', color: 'var(--mc-warn)', fontWeight: 700 }}>MED -{(f.bullish.components.blocker_severity_medium ?? 0).toFixed(1)}</span>}
                  {(f.bullish.components.blocker_severity_low ?? 0) > 0 && <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-text-3) 8%, transparent)', color: 'var(--mc-text-3)', fontWeight: 700 }}>LOW -{(f.bullish.components.blocker_severity_low ?? 0).toFixed(1)}</span>}
                </div>
                <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 3, fontStyle: 'italic' }}>
                  Formula: positive − (blockers × 0.65) · blockers deduped per tag · ULTRA requires 0 red flags · score capped at 6 without earnings anchor
                </div>
              </div>
              {/* PATCH 0395 — Traceability footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--mc-text-4)', marginTop: 6 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span title="Filing timestamp (ISO)">{new Date(f.filing_datetime).toLocaleString()}</span>
                  {f.pdf_pages != null && <span title="PDF page count">📄 {f.pdf_pages}p</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {f.attachment_urls.slice(0, 2).map((u, j) => (
                    <a key={j} href={u} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>📎 attachment</a>
                  ))}
                  <a href={f.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>↗ {f.exchange} filing</a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length > 50 && (
        <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginTop: 8, textAlign: 'center' }}>… {filtered.length - 50} more (showing top 50 by score)</div>
      )}
    </div>
  );
}
