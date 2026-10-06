'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useCallback, useEffect, useMemo } from 'react';
import type { LiveFeedPayload, WarrantFeedPayload, KwWatchPayload, MoversPayload } from './types';
import { KW_GROUP_COLORS } from './constants';
import { FeedStatusNote } from './FeedStatusNote';
import { WarrantAnalytics } from './WarrantAnalytics';
import { ConcallBottleneckPanel } from './components';

// ═══════════════════════════════════════════════════════════════════════════
// CONCALL ANALYTICS TAB — PATCH 0592
//
// Dedicated tab inside Concall Intelligence. Aggregates EVERY signal stream
// the page produces — warrants, daily movers, live bullish concall filings,
// keyword watch — into a single institutional-format dashboard.
//
// Fetches all four endpoints in parallel on mount; cached for 5 min after
// first hit. Each section follows the same visual pattern as the
// Multibagger / Special Situations Analytics views.
//
// SECTIONS:
//   1. UNIVERSE SUMMARY            — KPI strip across all four streams
//   2. WARRANT ANALYTICS           — bucket / use / promoter / extraction (reuses
//                                    the inline WarrantAnalytics card from 0591)
//   3. BULLISH CONCALL ANALYTICS   — tier distribution, sentiment heatmap,
//                                    top-by-score, sector overlay rollup
//   4. KEYWORD WATCH ANALYTICS     — by-group heatmap, by-sentiment, top
//                                    matched keywords, top filings
//   5. MOVERS ANALYTICS            — new-entries / big-jumps / lost-momentum
//                                    summary + ranking top
//   6. CROSS-STREAM INSIGHTS       — tickers showing up across multiple
//                                    streams (warrant + bullish + keyword)
//   7. INSTITUTIONAL DISCLOSURE    — how to read + what's heuristic vs hard
// ═══════════════════════════════════════════════════════════════════════════

export function ConcallAnalyticsTab() {
  const [warrantData, setWarrantData] = useState<WarrantFeedPayload | null>(null);
  const [liveBullishData, setLiveBullishData] = useState<LiveFeedPayload | null>(null);
  const [kwData, setKwData] = useState<KwWatchPayload | null>(null);
  const [moversData, setMoversData] = useState<MoversPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  /*
   * PATCH 0965 BUG #3 — Concall Intel Analytics tab stuck on Loading.
   * --------------------------------------------------------------
   * ROOT CAUSE: The previous outer timer set loading=false silently
   * without setting an error, so the user saw the empty Analytics
   * shell after 20s with no explanation and no retry hint. The
   * per-endpoint safeFetch helper also swallowed every exception
   * (returning null), which on a backend-wide outage left ALL four
   * datasets as null and no banner.
   *
   * FIX:
   *   - Track an explicit `loadError` state.
   *   - Use AbortSignal.timeout(45_000) on every fetch (per spec).
   *   - Count failures; if every endpoint failed, surface a red
   *     ErrorState card with a Retry button.
   *   - Outer timer trimmed 20s → 16s (just past per-fetch timeout)
   *     so we never spin past 16s.
   */
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    let settled = false;
    const outerTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setLastRefresh(new Date());
      setLoading(false);
      // PATCH 0965 BUG #3 — make the outer-timeout case visible.
      setLoadError('Concall Intel analytics timed out after 45s. Pipeline may be processing — Retry.');
    }, 16_000);
    let failures = 0;
    const safeFetch = async <T,>(url: string): Promise<T | null> => {
      try {
        // PATCH 0965 BUG #3 — AbortSignal.timeout(45_000) per spec.
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
        if (!res.ok) { failures++; return null; }
        return await res.json() as T;
      } catch { failures++; return null; }
    };
    try {
      const [w, b, k, m] = await Promise.all([
        safeFetch<WarrantFeedPayload>('/api/v1/concall-intel/warrant-feed?days=30&threshold=0'),
        safeFetch<LiveFeedPayload>('/api/v1/concall-intel/live-feed?days=30'), // PATCH 1014 — was /live (404) + days=7 too narrow post Q4-peak
        safeFetch<KwWatchPayload>('/api/v1/concall-intel/keyword-watch?days=30'), // PATCH 1014 — widen to 30d
        safeFetch<MoversPayload>('/api/v1/concall-intel/movers'),
      ]);
      if (settled) return;
      settled = true;
      clearTimeout(outerTimer);
      setWarrantData(w);
      setLiveBullishData(b);
      setKwData(k);
      setMoversData(m);
      setLastRefresh(new Date());
      setLoading(false);
      // PATCH 0965 BUG #3 — if every endpoint failed, surface red banner.
      if (failures === 4) {
        setLoadError('All Concall Intel endpoints failed (warrant · live · keyword · movers). Backend may be down — Retry.');
      }
    } catch (e: any) {
      if (settled) return;
      settled = true;
      clearTimeout(outerTimer);
      setLastRefresh(new Date());
      setLoading(false);
      setLoadError(`Concall Intel analytics fetch crashed: ${e?.message || String(e)}`);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Cross-stream tickers (in ≥2 of warrant / bullish / keyword) ────────
  const crossStream = useMemo(() => {
    const sets = {
      warrant: new Set((warrantData?.filings || []).map(f => f.symbol.toUpperCase())),
      bullish: new Set((liveBullishData?.filings || []).map(f => f.symbol.toUpperCase())),
      keyword: new Set((kwData?.filings || []).map(f => f.symbol.toUpperCase())),
    };
    const allTickers = new Set([...sets.warrant, ...sets.bullish, ...sets.keyword]);
    const out: Array<{ symbol: string; streams: string[]; count: number; company?: string }> = [];
    for (const t of allTickers) {
      const streams: string[] = [];
      let company: string | undefined;
      if (sets.warrant.has(t)) {
        streams.push('warrant');
        company = company || warrantData?.filings.find(f => f.symbol.toUpperCase() === t)?.company_name;
      }
      if (sets.bullish.has(t)) {
        streams.push('bullish');
        company = company || liveBullishData?.filings.find(f => f.symbol.toUpperCase() === t)?.company_name;
      }
      if (sets.keyword.has(t)) {
        streams.push('keyword');
        company = company || kwData?.filings.find(f => f.symbol.toUpperCase() === t)?.company_name;
      }
      if (streams.length >= 2) out.push({ symbol: t, streams, count: streams.length, company });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, 12);
  }, [warrantData, liveBullishData, kwData]);

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#0D1623', border: '1px solid #1A2540',
    borderRadius: 6, padding: '12px 14px',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: '#6B7A8D', letterSpacing: '0.3px', marginBottom: 4,
  };
  const Bar = ({ pct, color, height }: { pct: number; color: string; height?: number }) => (
    <div style={{ flex: 1, height: height ?? 6, background: 'var(--mc-bg-4)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color }} />
    </div>
  );

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--mc-text-3)', fontSize: 12 }}>
        📡 Loading Concall Intelligence analytics across warrants · movers · bullish · keyword watch…
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--mc-text-4)' }}>(≤ 16s · times out gracefully)</div>
      </div>
    );
  }

  /*
   * PATCH 0965 BUG #3 — ErrorState for the Analytics tab.
   * Renders when the outer 16s timer fires OR all 4 endpoints fail.
   * Red border + Retry button per spec.
   */
  if (loadError && !warrantData && !liveBullishData && !kwData && !moversData) {
    return (
      <div style={{
        margin: 16, padding: '18px 22px', borderRadius: 8,
        border: '2px solid var(--mc-bearish)', background: 'rgba(239,68,68,0.06)',
        color: '#FCA5A5', fontSize: 13,
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mc-bearish)', marginBottom: 6 }}>⚠ Concall Intel analytics unavailable</div>
        <div style={{ marginBottom: 10 }}>{loadError}</div>
        <button onClick={fetchAll} style={{
          padding: '6px 14px', borderRadius: 5, border: '1px solid var(--mc-bearish)',
          background: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', color: 'var(--mc-bearish)', cursor: 'pointer', fontSize: 12, fontWeight: 700,
        }}>↻ Retry</button>
      </div>
    );
  }

  // ── Bullish tier rollup ───────────────────────────────────────────────
  const tierCounts: Record<string, number> = {};
  const sentimentCounts: Record<string, number> = {};
  const sectorOverlayCounts: Record<string, number> = {};
  for (const f of liveBullishData?.filings || []) {
    const tier = (f.bullish?.tier || 'NEUTRAL');
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    const sent = (f.bullish?.sentiment || 'NEUTRAL');
    sentimentCounts[sent] = (sentimentCounts[sent] || 0) + 1;
    const ov = (f as any).sector_overlay?.sector || (f as any).sector_overlay?.label;
    if (ov) sectorOverlayCounts[ov] = (sectorOverlayCounts[ov] || 0) + 1;
  }
  const topBullish = [...(liveBullishData?.filings || [])]
    .sort((a, b) => (b.bullish?.score ?? 0) - (a.bullish?.score ?? 0))
    .slice(0, 12);

  // ── Keyword Watch rollup ──────────────────────────────────────────────
  const kwByGroup = kwData?.totals?.by_group || {};
  const kwBySentiment = kwData?.totals?.by_sentiment || {};
  const topKwFilings = [...(kwData?.filings || [])]
    .sort((a, b) => b.hit_count - a.hit_count)
    .slice(0, 10);

  // ── Movers rollup ────────────────────────────────────────────────────
  const moversNew = moversData?.new_entries?.length || 0;
  const moversJump = moversData?.big_jumps?.length || 0;
  const moversLost = moversData?.lost_momentum?.length || 0;
  const moversTop = (moversData?.ranking_today || []).slice(0, 10);

  // PATCH 0597 — warrant rollup vars removed alongside Universe Summary.
  // WarrantAnalytics card surfaces these inline already; per user feedback
  // the cross-stream summary added noise without surface value.

  // Reference-date awareness for daily movers: when this is the first
  // run of the cron there's no yesterday snapshot, so jump / lost
  // momentum buckets are empty by design. We surface that as an
  // explanatory note instead of a hollow "none" string.
  const moversHasReference = !!(moversData?.reference_date);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--mc-cyan)', letterSpacing: '0.5px' }}>
          📊 CONCALL INTELLIGENCE — CONSOLIDATED ANALYTICS
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--mc-text-3)', alignItems: 'center' }}>
          {lastRefresh && <span>as of {lastRefresh.toLocaleTimeString()}</span>}
          <button onClick={fetchAll} disabled={loading} style={{
            fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 4,
            border: '1px solid var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', cursor: loading ? 'wait' : 'pointer',
          }}>↻ Refresh all</button>
        </div>
      </div>

      {/* zzz810 — the concall sections below hide when the feed is empty;
          say WHY (could not reach NSE/BSE vs nothing filed) instead of
          silently rendering nothing. */}
      {!loading && (liveBullishData?.fetch_status
        ? <FeedStatusNote status={liveBullishData.fetch_status} compact={liveBullishData.fetch_status.state === 'OK'} />
        : !liveBullishData && lastRefresh
          ? <FeedStatusNote status={{ state: 'FAILED', message: "Couldn't load the live concall feed (request failed or timed out) — press ↻ Refresh all.", last_success_at: null, announcements_total: 0, concall_filings: 0, transcripts: 0, window_days: 30, retrying: false }} />
          : null)}

      {/* ── 📐 INSTITUTIONAL CALIBRATION DISCLOSURE (PATCH 0598) ──────────
          User feedback called out "synthetic confidence" — 100% / 95% /
          CRITICAL labels are overstated for a regex-and-lexicon engine
          with no realized-alpha feedback loop. This banner sets the
          right calibration up-front so the analyst doesn't over-trust
          the scores. Every score below is labelled as evidence-density
          / cross-source-confirmation / signal-persistence — not as a
          probability. */}
      <div style={{
        background: 'linear-gradient(90deg, color-mix(in srgb, var(--mc-border-1) 19%, transparent) 0%, var(--mc-bg-1) 100%)',
        border: '1px solid var(--mc-border-1)',
        borderLeft: '3px solid var(--mc-warn)',
        borderRadius: 6, padding: '10px 14px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.5px', marginBottom: 4 }}>
          📐 CALIBRATION DISCLOSURE — read this once
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5 }}>
          All scores on this page are <strong>evidence-density / cross-source-confirmation</strong> measures
          (regex + lexicon over filings + news, no backtested probabilities, no realized-alpha attribution).
          Read scores as <em>"how many independent signals agree?"</em>, not as <em>"how likely is the trade to work?"</em>.
          Treat ±5 differences as noise; only ±15 deltas reflect real signal shifts. Cross-reference the source
          filings before any capital allocation decision.
        </div>
      </div>

      {/* PATCH 0597 — Universe Summary panel removed per user feedback
          ("i dont care this data"). Bottleneck Themes panel added below
          (loads /news/bottleneck-dashboard, severity-sorted with key
          tickers) per user request to bring news-side bottleneck data
          into the Concall Intelligence Analytics tab. */}

      {/* ── 🏗 BOTTLENECK THEMES (news-side, severity-sorted) ───────────── */}
      <ConcallBottleneckPanel />

      {/* ── 2. WARRANT ANALYTICS (reuse) ────────────────────────────────── */}
      {warrantData && warrantData.filings.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-state-persistent)', letterSpacing: '0.4px', marginBottom: 6 }}>
            🚀 WARRANT MOMENTUM ANALYTICS
          </div>
          <WarrantAnalytics data={warrantData} />
        </div>
      )}

      {/* ── 3. BULLISH CONCALL ANALYTICS ────────────────────────────────── */}
      {(liveBullishData?.filings.length ?? 0) > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.4px', marginBottom: 6 }}>
            🔥 LIVE BULLISH CONCALL ANALYTICS ({liveBullishData?.count_relevant ?? 0})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>

            {/* Tier breakdown */}
            <div style={{ ...cardStyle, background: 'var(--mc-bg-0)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>TIER DISTRIBUTION</div>
              {([
                { key: 'ULTRA_BULLISH',   label: '🔥 ULTRA',         color: '#10B981' },
                { key: 'BULLISH',         label: '✓ BULLISH',         color: '#22D3EE' },
                { key: 'MIXED_POSITIVE',  label: '◐ MIXED+',          color: '#F59E0B' },
                { key: 'NEUTRAL',         label: '· NEUTRAL',         color: '#94A3B8' },
                { key: 'BEARISH',         label: '▼ BEARISH',         color: '#EF4444' },
                { key: 'INSUFFICIENT',    label: '? INSUFFICIENT',    color: '#6B7A8D' },
                { key: 'DATA_PENDING',    label: '⏳ PENDING',         color: '#6B7A8D' },
              ] as const).map((row) => {
                const n = tierCounts[row.key] || 0;
                if (n === 0) return null;
                const total = liveBullishData?.filings.length || 1;
                const pct = (n / total) * 100;
                return (
                  <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 700, minWidth: 120 }}>{row.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                    <Bar pct={pct} color={row.color} />
                    <span style={{ fontSize: 10, color: row.color, fontWeight: 700, minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* Sector overlay rollup */}
            {Object.keys(sectorOverlayCounts).length > 0 && (
              <div style={{ ...cardStyle, background: 'var(--mc-bg-0)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>SECTOR OVERLAY</div>
                {Object.entries(sectorOverlayCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([sector, n]) => {
                  const total = liveBullishData?.filings.length || 1;
                  const pct = (n / total) * 100;
                  return (
                    <div key={sector} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 600, minWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sector}</span>
                      <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                      <Bar pct={pct} color="#22D3EE" />
                      <span style={{ fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 700, minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top bullish by score */}
          {topBullish.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>🎯 TOP 12 BY BULLISH SCORE</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                {topBullish.map((f, i) => {
                  const tier = f.bullish?.tier || 'NEUTRAL';
                  const tColor = tier === 'ULTRA_BULLISH' ? '#10B981' : tier === 'BULLISH' ? '#22D3EE' : tier === 'MIXED_POSITIVE' ? '#F59E0B' : tier === 'BEARISH' ? '#EF4444' : '#94A3B8';
                  return (
                    <a key={f.symbol + i} href={f.source_url} target="_blank" rel="noopener noreferrer" style={{
                      display: 'flex', flexDirection: 'column', gap: 2,
                      padding: '6px 8px', borderRadius: 4,
                      border: `1px solid ${tColor}30`, background: `${tColor}08`,
                      textDecoration: 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 22 }}>#{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.company_name}</div>
                          <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600 }}>{f.symbol} · {f.exchange}</div>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 800, color: tColor, fontVariantNumeric: 'tabular-nums' }}>{f.bullish?.score?.toFixed(0) ?? '—'}</span>
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>{tier} · {f.filing_type}</div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 4. KEYWORD WATCH ANALYTICS ──────────────────────────────────── */}
      {(kwData?.count_matched ?? 0) > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px', marginBottom: 6 }}>
            🔎 KEYWORD WATCH ANALYTICS ({kwData?.count_matched ?? 0} filings · {kwData?.totals?.total_hits ?? 0} hits)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>

            {/* By group */}
            {Object.keys(kwByGroup).length > 0 && (
              <div style={{ ...cardStyle, background: 'var(--mc-bg-0)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>HITS BY GROUP</div>
                {Object.entries(kwByGroup).sort((a, b) => b[1] - a[1]).map(([group, n]) => {
                  const total = kwData?.totals?.total_hits || 1;
                  const pct = (n / total) * 100;
                  const color = KW_GROUP_COLORS[group] || '#6B7A8D';
                  return (
                    <div key={group} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 700, minWidth: 110 }}>{group}</span>
                      <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                      <Bar pct={pct} color={color} />
                      <span style={{ fontSize: 10, color, fontWeight: 700, minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* By sentiment */}
            {Object.keys(kwBySentiment).length > 0 && (
              <div style={{ ...cardStyle, background: 'var(--mc-bg-0)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>HITS BY SENTIMENT</div>
                {Object.entries(kwBySentiment).sort((a, b) => b[1] - a[1]).map(([sent, n]) => {
                  const total = kwData?.totals?.total_hits || 1;
                  const pct = (n / total) * 100;
                  const color = sent.toLowerCase().includes('positive') ? '#10B981'
                              : sent.toLowerCase().includes('negative') ? '#EF4444'
                              : '#94A3B8';
                  return (
                    <div key={sent} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 700, minWidth: 110 }}>{sent}</span>
                      <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                      <Bar pct={pct} color={color} />
                      <span style={{ fontSize: 10, color, fontWeight: 700, minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top filings by hit_count */}
          {topKwFilings.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>🎯 TOP {topKwFilings.length} BY KEYWORD HIT COUNT</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                {topKwFilings.map((f, i) => (
                  <a key={f.symbol + i} href={f.source_url} target="_blank" rel="noopener noreferrer" style={{
                    display: 'flex', flexDirection: 'column', gap: 2,
                    padding: '6px 8px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-warn) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)',
                    textDecoration: 'none',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 22 }}>#{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.company_name}</div>
                        <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600 }}>{f.symbol} · {f.exchange}</div>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-warn)', fontVariantNumeric: 'tabular-nums' }}>{f.hit_count}</span>
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--mc-text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {f.hit_groups.join(' · ') || 'no groups'}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 5. MOVERS ANALYTICS ─────────────────────────────────────────── */}
      {moversData && (moversNew + moversJump + moversLost) > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px', marginBottom: 6 }}>
            📈 DAILY MOVERS — {moversHasReference ? `vs ${moversData.reference_date}` : 'first snapshot today (no prior reference yet)'}
          </div>
          {!moversHasReference && (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 8, lineHeight: 1.5, padding: '6px 10px', background: 'color-mix(in srgb, var(--mc-warn) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 4 }}>
              ⚠ Big Jumps and Lost Momentum will populate after the next cron snapshot. Until then only New Entries
              (top filings discovered today) is meaningful.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {[
              { label: '🆕 NEW ENTRIES',   items: moversData.new_entries || [],   color: '#10B981', emptyHint: 'no new entries today' },
              { label: '🔥 BIG JUMPS',     items: moversData.big_jumps || [],     color: '#F59E0B', emptyHint: moversHasReference ? 'no big jumps vs yesterday' : 'needs prior-day snapshot' },
              { label: '📉 LOST MOMENTUM', items: moversData.lost_momentum || [], color: '#EF4444', emptyHint: moversHasReference ? 'no rankings dropped' : 'needs prior-day snapshot' },
            ].map((b) => (
              <div key={b.label} style={{ ...cardStyle, background: 'var(--mc-bg-0)', borderColor: `${b.color}30` }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: b.color, marginBottom: 6 }}>{b.label} ({b.items.length})</div>
                {b.items.length === 0 ? (
                  <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>{b.emptyHint}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {b.items.slice(0, 6).map((m, i) => (
                      <div key={m.symbol + i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.company_name}</div>
                          <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, monospace' }}>{m.symbol}</div>
                        </div>
                        <span style={{ fontSize: 11, color: b.color, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{m.composite_today?.toFixed(1) ?? '—'}</span>
                        {typeof m.delta === 'number' && (
                          <span style={{ fontSize: 9, color: m.delta > 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>{m.delta > 0 ? '+' : ''}{m.delta.toFixed(1)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Today's top ranking */}
          {moversTop.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>🎯 TODAY&apos;S TOP {moversTop.length}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
                {moversTop.map((m, i) => (
                  <div key={m.symbol + i} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 8px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-cyan) 15%, transparent)', background: 'color-mix(in srgb, var(--mc-cyan) 3%, transparent)',
                  }}>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 22 }}>#{m.rank_today}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.company_name}</div>
                      <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, monospace' }}>{m.symbol}</div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 800 }}>{m.composite_today?.toFixed(1) ?? '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 6. CROSS-STREAM EVIDENCE CONVERGENCE (PATCH 0598) ─────────────
          Renamed from 'Cross-stream confirmation' per user feedback that
          'confirmation' overstates what a regex engine can claim. This
          is an EVIDENCE-DENSITY measure — multiple independent datasets
          mention the same ticker. Lower false-positive rate than any
          single stream alone, but NOT a probability that the trade
          works. */}
      {crossStream.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px' }}>
              🎯 CROSS-STREAM EVIDENCE CONVERGENCE ({crossStream.length})
            </div>
            <span style={{ fontSize: 9, color: 'var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>EVIDENCE-DENSITY</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 8, lineHeight: 1.5 }}>
            Tickers mentioned in <strong style={{ color: 'var(--mc-text-1)' }}>≥ 2 independent streams</strong> simultaneously
            (warrant filing · bullish concall · keyword watch). Higher ×N count means more orthogonal datasets agree.
            Read as <em>"this name has wider evidence"</em>, NOT <em>"this name will outperform"</em>.
            Validate with price action / earnings revisions before sizing.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
            {crossStream.map((c, i) => {
              const color = c.count >= 3 ? '#10B981' : '#F59E0B';
              const evidenceLabel = c.count >= 3 ? 'WIDE EVIDENCE' : 'PAIR EVIDENCE';
              return (
                <a key={c.symbol + i} href={`/stock-sheet?ticker=${encodeURIComponent(c.symbol)}`} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', borderRadius: 4,
                  border: `1px solid ${color}40`, background: `${color}10`,
                  textDecoration: 'none',
                }}>
                  <span title={evidenceLabel} style={{ fontSize: 10, color, fontWeight: 800, minWidth: 22, padding: '1px 5px', borderRadius: 3, background: `${color}22` }}>×{c.count}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.company || c.symbol}</div>
                    <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, monospace' }}>{c.symbol} · {c.streams.join(' + ')}</div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 7. PORTFOLIO BASKET SUGGESTIONS (PATCH 0598) ───────────────────
          User feedback: "great intelligence, weak monetization framework —
          you have idea generation, not deployable portfolio intelligence."
          This block turns the cross-stream convergence into three baskets:
            CORE       — wide evidence (≥3 streams) + named ticker
            TACTICAL   — pair evidence + named ticker
            WATCH      — single-stream signals (informational, not sized)
          NOT a portfolio. Just a starting structure the analyst can prune
          before final allocation. */}
      {crossStream.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.4px' }}>
              📦 PORTFOLIO BASKET SCAFFOLD
            </div>
            <span style={{ fontSize: 9, color: 'var(--mc-bullish)', background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>STARTING STRUCTURE</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 8, lineHeight: 1.5 }}>
            A starting structure derived from cross-stream evidence — <strong>not a recommendation</strong>.
            CORE = wide evidence (≥3 streams). TACTICAL = pair evidence with at least one strong stream.
            Use this as a candidate list, then prune by valuation, liquidity, and your own conviction work
            before allocation. Suggested position-size ranges are mcap-tier heuristics, not realized-volatility models.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {([
              { key: 'core', label: '💎 CORE', color: '#10B981', sizeHint: '3-5% / name', items: crossStream.filter(c => c.count >= 3) },
              { key: 'tactical', label: '⚡ TACTICAL', color: '#22D3EE', sizeHint: '1-3% / name', items: crossStream.filter(c => c.count === 2) },
            ] as const).map((b) => (
              <div key={b.key} style={{ ...cardStyle, background: 'var(--mc-bg-0)', borderColor: `${b.color}30` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: b.color, fontWeight: 800 }}>{b.label}</span>
                  <span style={{ fontSize: 10, color: b.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>({b.items.length})</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--mc-text-4)' }}>{b.sizeHint}</span>
                </div>
                {b.items.length === 0 ? (
                  <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>no candidates at this evidence-density tier</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {b.items.slice(0, 12).map((c) => (
                      <a key={c.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(c.symbol)}`}
                        title={`${c.symbol} · ${c.streams.join(' + ')} streams`}
                        style={{
                          fontSize: 10, fontWeight: 700, color: b.color,
                          padding: '3px 8px', borderRadius: 3,
                          border: `1px solid ${b.color}40`, background: `${b.color}10`,
                          textDecoration: 'none',
                        }}>
                        {c.company ? c.company.split(' ').slice(0, 3).join(' ') : c.symbol}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 8. INSTITUTIONAL DISCLOSURE (PATCH 0598 recalibrated) ───────── */}
      <div style={{ ...cardStyle, borderColor: 'var(--mc-bg-4)' }}>
        <div style={{ fontSize: 12, color: 'var(--mc-text-3)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 6 }}>
          📚 HOW TO READ THIS ANALYTICS (recalibrated)
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.6 }}>
          <li>
            <strong style={{ color: 'var(--mc-bullish)' }}>Cross-stream evidence convergence</strong> is
            this engine&apos;s strongest output — but it is <em>evidence-density</em>, not a
            probability of trade success. Validate with price action / volume / earnings revisions
            (a market-implied confirmation layer is on the roadmap but not yet shipped).
          </li>
          <li>
            <strong style={{ color: 'var(--mc-state-persistent)' }}>Warrant Analytics</strong> currently has known
            extraction gaps — promoter participation and use-of-proceeds are unknown on most rows.
            Treat as <em>anomaly detector</em>, not <em>investment ranking</em>, until the
            filings-extraction pipeline matures.
          </li>
          <li>
            <strong style={{ color: 'var(--mc-cyan)' }}>Bullish Tier distribution</strong> distinguishes
            real signal from spam. ULTRA + BULLISH tiers carry actionable evidence-density;
            INSUFFICIENT / DATA_PENDING signal extraction gaps (not bearish reality).
          </li>
          <li>
            <strong style={{ color: 'var(--mc-warn)' }}>Keyword Watch by group</strong> shows the
            thematic loading of this week&apos;s concall pipeline. Heavy RISK loading with
            light OPPORTUNITY suggests caution; verify by reading the actual matched articles.
          </li>
          <li>
            <strong style={{ color: 'var(--mc-text-3)' }}>Movers</strong> capture day-over-day delta in
            composite score — a stock breaking into TOP 25 today that wasn't there yesterday
            is a high-velocity signal worth investigating.
          </li>
          <li>
            All scores on this page are <strong>heuristic regex + lexicon</strong> based.
            Treat 5-pt differences as noise; only 15+ pt deltas reflect real signal shifts.
            Cross-reference the source filings before acting.
          </li>
          <li>
            <strong style={{ color: 'var(--mc-bearish)' }}>Counter-thesis caveat:</strong> the engine
            currently has structural-bullish bias by construction (every theme is named for
            its bottleneck, not its normalisation cycle). Curated counter-thesis lives on the
            Bottleneck Workbench detail pages (lib/bottleneck-intel.ts catalog). For themes
            without a catalog entry yet, manually consider failure modes — every bottleneck
            eventually normalises, overbuilds, or gets substituted.
          </li>
          <li>
            <strong style={{ color: 'var(--mc-text-3)' }}>Missing layers</strong> (institutional roadmap):
            market-implied confirmation (price/volume/options-flow/short-interest/earnings-revisions),
            realized-alpha feedback loop, factor-overlap analysis, crowding metrics. Without these,
            this engine is an idea-generation surface, not a deployable portfolio.
          </li>
        </ul>
      </div>

    </div>
  );
}
