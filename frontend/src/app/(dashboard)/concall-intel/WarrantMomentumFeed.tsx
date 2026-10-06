'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect } from 'react';
import { decodeHTMLEntities } from '@/lib/html-decode';
import type { WarrantFeedPayload } from './types';
import { WarrantAnalytics } from './WarrantAnalytics';

export function WarrantMomentumFeed() {
  const [data, setData] = useState<WarrantFeedPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PATCH 0693 — show a slow-fetch hint after 15s so the user sees a
  // visible Retry option instead of staring at "Loading…" for 52s
  // while the warrant feed warms its cache (BUG-18).
  const [slowFetch, setSlowFetch] = useState(false);
  // PATCH 0536 — passingOnly default OFF so the user immediately sees the
  // full ranked-by-conviction warrant universe instead of the strict-gate
  // empty state. Days default raised 7 → 30 (the 30d sub-window cache
  // (Patch 0413) returns instantly after first warm-up).
  const [passingOnly, setPassingOnly] = useState(false);
  const [days, setDays] = useState(30);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // PATCH 0425 — ticker search box so user can probe coverage (e.g. is
  // STLTECH detected at all? if so what fields extracted? if not, was the
  // subject classified as a warrant filing?).
  const [tickerSearch, setTickerSearch] = useState('');

  /*
   * PATCH 0965 BUG #3 — Warrant Momentum feed: permanent "Loading..." spinner.
   * --------------------------------------------------------------
   * ROOT CAUSE: Timeout was 25s but on slow Vercel cold-starts the
   * Loading spinner felt permanent. More importantly, errors surfaced
   * a small inline chip rather than a prominent ErrorState card with
   * a Retry button, so users didn't realise they could re-fire.
   *
   * FIX:
   *   - Timeout tightened 25s → 15s via AbortSignal.timeout(45_000).
   *   - Error always sets an empty-shape data so the empty-state
   *     branch (with its prominent Retry button) renders instead of
   *     the spinner.
   */
  const fetchFeed = async (force = false) => {
    setLoading(true);
    setError(null);
    // Slow-fetch hint fires at 8s for retry CTA visibility (was 15s).
    setSlowFetch(false);
    const slowTimer = setTimeout(() => setSlowFetch(true), 8000);
    try {
      const params = new URLSearchParams({
        days: String(days),
        // PATCH 0536 — gate lowered 6.5 → 5.5 to match warrant-momentum.ts
        // floor (post promoter-premium-proxy gateD).
        threshold: passingOnly ? '5.5' : '0',
        ...(passingOnly ? { passingOnly: '1' } : {}),
        ...(force ? { force: '1' } : {}),
      });
      // PATCH 0965 BUG #3 — AbortSignal.timeout(45_000) per spec; replaces
      // the bespoke 25s AbortController so the spinner is bounded.
      const res = await fetch(`/api/v1/concall-intel/warrant-feed?${params}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status} — warrant feed unavailable`);
        setData((prev) => prev || { filings: [], count_total: 0, count_relevant: 0, count_passing: 0 } as any);
        return;
      }
      const j = await res.json();
      setData(j);
      setLastRefresh(new Date());
    } catch (e: any) {
      // PATCH 0965 BUG #3 — distinguish timeout from generic errors so the
      // banner copy matches what the user actually saw.
      const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout|abort/i.test(String(e?.message || ''));
      setError(isTimeout
        ? '⚠ Warrant momentum data unavailable — pipeline may be processing (timed out after 45s)'
        : `⚠ Warrant momentum fetch failed: ${e?.message || 'unknown error'}`);
      // Surface an empty-shape so the UI rolls forward instead of spinning.
      setData((prev) => prev || { filings: [], count_total: 0, count_relevant: 0, count_passing: 0 } as any);
    } finally {
      clearTimeout(slowTimer); // PATCH 0693
      setSlowFetch(false); // PATCH 0693
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed();
    // Warrants are slow-moving — refresh every 15 min
    // AUDIT_100 #7 — skip poll when tab is hidden
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchFeed();
    }, 15 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, passingOnly]);

  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)', borderLeft: '4px solid var(--mc-state-persistent)', borderRadius: 10, padding: '14px 18px', marginBottom: 14, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--mc-state-persistent)', letterSpacing: '0.4px' }}>🚀 WARRANT MOMENTUM — promoter warrants + post-breakout + business momentum</div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginTop: 2 }}>
            {data ? (
              <>
                {data.count_total} filings · {data.count_relevant} warrant-related · <strong style={{ color: 'var(--mc-bullish)' }}>{data.count_passing} passing gate (≥5.5/10)</strong>
                {lastRefresh && <> · refreshed {lastRefresh.toLocaleTimeString()}</>}
              </>
            ) : loading ? (slowFetch ? 'Loading… (cache warming, ~30s)' : 'Loading…') : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* PATCH 0425 — ticker coverage probe */}
          <input
            value={tickerSearch}
            onChange={(e) => setTickerSearch(e.target.value.toUpperCase())}
            placeholder="🔍 ticker (STLTECH...)"
            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: `1px solid ${tickerSearch ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`, background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', width: 160, outline: 'none' }}
          />
          <button onClick={() => setPassingOnly(v => !v)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: `1px solid ${passingOnly ? 'var(--mc-bullish)' : 'var(--mc-bg-4)'}`, background: passingOnly ? 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)' : 'transparent', color: passingOnly ? 'var(--mc-bullish)' : 'var(--mc-text-3)', cursor: 'pointer' }}>
            ★ High conviction only {passingOnly ? '✓' : ''}
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
          <button onClick={() => fetchFeed(true)} disabled={loading} style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--mc-state-persistent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', color: 'var(--mc-state-persistent)', cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/*
        PATCH 0420 — Suppress red HTTP 500 chip when warrant data is loaded.
        PATCH 0965 BUG #3 — Upgraded inline chip to a full red-border
        ErrorState card with a prominent Retry button so users can see
        unambiguously that the pipeline isn't returning data.
      */}
      {error && (!data || data.count_total === 0) && (
        <div style={{
          fontSize: 12, color: '#FCA5A5', marginBottom: 10,
          border: '2px solid var(--mc-bearish)', borderRadius: 6,
          background: 'rgba(239,68,68,0.06)',
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span style={{ flex: 1, minWidth: 200 }}>{error}</span>
          {/* PATCH 0693 — explicit Retry button on terminal error */}
          <button onClick={() => fetchFeed(true)} style={{ fontSize: 11, fontWeight: 800, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--mc-bearish)', background: 'color-mix(in srgb, var(--mc-bearish) 19%, transparent)', color: '#FCA5A5', cursor: 'pointer' }}>↻ Retry</button>
        </div>
      )}
      {/* PATCH 0693 — slow-fetch warning during long initial load. */}
      {/* PATCH 0965 BUG #3 — message updated to reflect new 15s ceiling. */}
      {loading && slowFetch && !data && (
        <div style={{ fontSize: 11, color: 'var(--mc-warn)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>⚠ Warrant feed is slow — cache warming up. Will time out at 15s.</span>
          <button onClick={() => fetchFeed(true)} style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 4, border: '1px solid var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', cursor: 'pointer' }}>↻ Retry now</button>
        </div>
      )}
      {error && data && data.count_total > 0 && (
        <div style={{ fontSize: 10, color: 'var(--mc-warn)', marginBottom: 8, fontStyle: 'italic' }}>
          · last refresh slow ({error}); showing previous results
        </div>
      )}

      {data && data.filings.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic', padding: '12px 0' }}>
          {data.count_relevant > 0
            ? `No warrants passing the strict gate in current filter. Total relevant: ${data.count_relevant}. Toggle "High conviction only" off to inspect.`
            : 'No warrant filings detected yet — try widening to 90/180 days or toggling "High conviction only" OFF so partial-conviction names also surface.'}
        </div>
      )}

      {/* PATCH 0407 — Auto-disable strict gate when zero filings exist
          at the current threshold so the user sees a ranked list rather
          than a dead-end empty state. Surfaces a notice that we relaxed
          the gate. */}
      {data && data.filings.length === 0 && data.count_relevant > 0 && passingOnly && !loading && (
        <button
          onClick={() => setPassingOnly(false)}
          style={{
            fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 5,
            border: '1px solid var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)',
            cursor: 'pointer', marginTop: 6,
          }}
        >
          → Show {data.count_relevant} below-threshold warrant filings (auto-relax gate)
        </button>
      )}

      {/* PATCH 0425 — Ticker coverage probe panel.
          When user types a ticker (e.g. STLTECH), surface ALL filings in
          the dataset matching that symbol — classified or not — with
          their classification + extraction-diagnostics. Answers the
          'why is X missing?' question directly: was it classified as a
          warrant filing? did its PDF get extracted? what failed? */}
      {data && tickerSearch.trim() && (() => {
        const q = tickerSearch.trim().toUpperCase();
        const source: any[] = (data as any).ranked_all && (data as any).ranked_all.length > 0
          ? (data as any).ranked_all
          : data.filings;
        const matches = (source || []).filter((r: any) =>
          (r.symbol || '').toUpperCase().includes(q) ||
          (r.company_name || '').toUpperCase().includes(q)
        );
        return (
          <div style={{ marginBottom: 12, padding: 12, background: 'var(--mc-bg-0)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--mc-cyan)', marginBottom: 8 }}>
              🔍 COVERAGE PROBE: {q} — {matches.length} filing{matches.length === 1 ? '' : 's'} in last {days} days
            </div>
            {matches.length === 0 ? (
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>
                Not classified as a warrant filing in this window. Could mean: (a) no warrant filing exists, (b) subject didn&apos;t match warrant patterns (try widening to 180d), (c) filing fell outside the per-sub-window NSE/BSE chunked fetch coverage. Toggle &quot;High conviction only&quot; OFF and widen to 180d for max coverage.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 6 }}>
                {matches.slice(0, 10).map((m: any, i: number) => (
                  <div key={'probe-' + i} style={{ padding: 8, background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 5 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-1)' }}>
                      {m.symbol} <span style={{ fontSize: 9, color: 'var(--mc-text-3)' }}>{m.warrant_type}</span>
                      <span style={{ float: 'right', color: m.conviction.passes_gate ? 'var(--mc-bullish)' : 'var(--mc-warn)', fontWeight: 900 }}>{m.conviction.conviction.toFixed(1)}/10</span>
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--mc-text-3)', marginTop: 2 }}>{m.subject?.slice(0, 110)}{m.subject?.length > 110 ? '…' : ''}</div>
                    {m.conviction.diagnostics && (
                      <div style={{ fontSize: 9, marginTop: 4, color: 'var(--mc-text-3)' }}>
                        {m.conviction.diagnostics.pdf_extracted ? '✓ PDF' : '✗ PDF NOT EXTRACTED'} ·
                        {m.conviction.diagnostics.promoter_subscribed_found ? ' ✓ Promoter' : ' ✗ Promoter'} ·
                        {m.conviction.diagnostics.issue_price_found ? ' ✓ Price' : ' ✗ Price'} ·
                        {m.conviction.diagnostics.cmp_found ? ' ✓ CMP' : ' ✗ CMP'}
                      </div>
                    )}
                    <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 2 }}>{new Date(m.filing_datetime).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* PATCH 0591 — Warrant Analytics block. Mirrors the Multibagger /
          Special Situations Analytics philosophy: one consolidated view
          of the whole warrant universe before diving into individual
          cards. Surfaces bucket / use-of-proceeds / promoter-participation
          mix, extraction-quality matrix, and a top-by-weighted-score
          shortlist — entirely off the same `data` payload, no new fetch. */}
      {data && data.filings.length > 0 && (
        <WarrantAnalytics data={data} />
      )}

      {/* PATCH 0428 — BUCKETED RENDERING replaces flat Top 10 list.
          Production-grade pattern (institutional review item 4.C):
          🟢 STRATEGIC CAPITAL INFUSION — hard-filter passes
          🟡 NEUTRAL RESTRUCTURING — partial signals
          🔴 DISTRESS / SURVIVAL — auto-flagged via dilution + intent + use
          User sees classification structure FIRST, not a soft-ranked list. */}
      {data && (() => {
        const source: any[] = (data as any).ranked_all && (data as any).ranked_all.length > 0
          ? (data as any).ranked_all
          : data.filings;
        if (!source || source.length === 0) return null;
        const green = source.filter((r: any) => r.conviction.bucket === 'GREEN');
        const amber = source.filter((r: any) => r.conviction.bucket === 'AMBER').slice(0, 6);
        const red   = source.filter((r: any) => r.conviction.bucket === 'RED').slice(0, 4);
        // Sort each bucket by weighted final score
        const byWeighted = (a: any, b: any) => (b.conviction.weighted?.final ?? 0) - (a.conviction.weighted?.final ?? 0);
        green.sort(byWeighted); amber.sort(byWeighted); red.sort(byWeighted);
        return (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6, fontStyle: 'italic' }}>
              ⚙ Weighted formula: <strong>0.35×funding_quality + 0.30×balance_sheet + 0.25×business_trajectory − 0.10×dilution_penalty</strong>
              {' · '}Buckets are hard-filter rules, not soft rankings.
            </div>
            {([
              { label: '🟢 STRATEGIC CAPITAL INFUSION', color: '#10B981', list: green, note: 'Tier 1 + low distress + weighted ≥ 6.5' },
              { label: '🟡 NEUTRAL RESTRUCTURING',      color: '#F59E0B', list: amber, note: 'Partial signals — balance-sheet repair / unclear capital use / mixed' },
              { label: '🔴 DISTRESS / SURVIVAL',         color: '#EF4444', list: red,   note: 'Distress ≥55% OR weighted ≤3 OR heavy dilution + non-strategic use' },
            ] as Array<{ label: string; color: string; list: any[]; note: string }>).map((b, bi) => b.list.length === 0 ? (
              <div key={'bk-' + bi} style={{ marginBottom: 8, padding: 8, background: `${b.color}08`, border: `1px dashed ${b.color}30`, borderRadius: 6, fontSize: 10, color: 'var(--mc-text-3)' }}>
                <strong style={{ color: b.color }}>{b.label}</strong> — none in this window. <span style={{ fontStyle: 'italic' }}>{b.note}</span>
              </div>
            ) : (
              <div key={'bk-' + bi} style={{ marginBottom: 10, padding: 10, background: `${b.color}10`, border: `1px solid ${b.color}50`, borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: b.color, letterSpacing: '0.5px' }}>{b.label} · {b.list.length}</div>
                  <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>{b.note}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 6 }}>
                  {b.list.map((r: any, i: number) => {
                    const w = r.conviction.weighted || {};
                    return (
                      <div key={'bk-card-' + bi + '-' + i} style={{ padding: 8, background: 'var(--mc-bg-0)', border: `1px solid ${b.color}40`, borderRadius: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--mc-text-1)' }}>{r.symbol || r.company_name}</span>
                            {r.group_aliases && r.group_aliases.length > 0 && (
                              <span title={`Related group entities: ${r.group_aliases.join(', ')}`} style={{ fontSize: 8, marginLeft: 6, color: 'var(--mc-state-persistent)', fontWeight: 700 }}>+{r.group_aliases.length} grp</span>
                            )}
                          </div>
                          <span title={`Weighted = 0.35×F + 0.30×BS + 0.25×BT − 0.10×D`} style={{ fontSize: 14, fontWeight: 900, color: b.color }}>{(w.final ?? 0).toFixed(1)}</span>
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--mc-text-3)', marginBottom: 4 }}>{r.company_name}</div>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: 8, marginBottom: 3 }}>
                          <span title="Funding quality (promoter intent + capital use + premium)" style={{ padding: '1px 4px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)' }}>F {(w.funding_quality ?? 0).toFixed(1)}</span>
                          <span title="Balance sheet (inverse of distress)" style={{ padding: '1px 4px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)' }}>BS {(w.balance_sheet ?? 0).toFixed(1)}</span>
                          <span title="Business trajectory (concall + 90d + 52w-high)" style={{ padding: '1px 4px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', color: 'var(--mc-state-persistent)' }}>BT {(w.business_trajectory ?? 0).toFixed(1)}</span>
                          <span title="Dilution penalty (scaled from dilution %)" style={{ padding: '1px 4px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: 'var(--mc-bearish)' }}>−D {(w.dilution_penalty ?? 0).toFixed(1)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: 8 }}>
                          {r.conviction.capital_use && r.conviction.capital_use !== 'UNKNOWN' && (
                            <span style={{ padding: '1px 4px', borderRadius: 3, background: 'var(--mc-bg-4)', color: 'var(--mc-text-2)' }}>{r.conviction.capital_use.replace(/_/g, ' ')}</span>
                          )}
                          {r.conviction.promoter_intent && r.conviction.promoter_intent !== 'UNKNOWN' && (
                            <span style={{ padding: '1px 4px', borderRadius: 3, background: 'var(--mc-bg-4)', color: 'var(--mc-text-2)' }}>{r.conviction.promoter_intent.replace(/_/g, ' ')}</span>
                          )}
                          {r.conviction.dilution_pct != null && (
                            <span style={{ padding: '1px 4px', borderRadius: 3, background: r.conviction.dilution_pct >= 15 ? 'color-mix(in srgb, var(--mc-bearish) 15%, transparent)' : 'var(--mc-bg-4)', color: r.conviction.dilution_pct >= 15 ? 'var(--mc-bearish)' : 'var(--mc-text-3)' }}>Dil {r.conviction.dilution_pct.toFixed(1)}%</span>
                          )}
                          {r.details.total_size_cr != null && (
                            <span style={{ padding: '1px 4px', borderRadius: 3, background: 'var(--mc-bg-4)', color: 'var(--mc-text-2)' }}>₹{r.details.total_size_cr.toFixed(0)}Cr</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* PATCH 0406/0411/0427 — Legacy Top 10 Ranked Warrants panel,
          kept BELOW the bucketed view for users who still want the
          raw conviction ranking + diagnostics. */}
      {data && (() => {
        const source: any[] = (data as any).ranked_all && (data as any).ranked_all.length > 0
          ? (data as any).ranked_all
          : data.filings;
        if (!source || source.length === 0) return null;
        const ranked = [...source]
          .sort((a, b) => b.conviction.conviction - a.conviction.conviction)
          .slice(0, 10);
        // PATCH 0427 — Decide panel mode from data quality
        const tier1Count = source.filter((r: any) => r.conviction.tier === 'TIER_1_INSTITUTIONAL').length;
        const passingCount = source.filter((r: any) => r.conviction.passes_gate).length;
        const isActionable = tier1Count > 0 || passingCount > 0;
        const headerLabel = isActionable
          ? `🏆 TIER 1 — INSTITUTIONAL WARRANTS · ${tier1Count} tier-1 + ${passingCount - tier1Count} passing`
          : `⚠ WARRANT EVENT SCANNER — no Tier 1 alpha in window · best-of-rest ranking`;
        const headerColor = isActionable ? '#10B981' : '#F59E0B';
        return (
          <div style={{ marginBottom: 12, padding: 12, background: `linear-gradient(135deg, ${headerColor}10, color-mix(in srgb, var(--mc-cyan) 6%, transparent))`, border: `1px solid ${headerColor}50`, borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: headerColor, letterSpacing: '0.5px' }}>{headerLabel}</div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 600 }}>· window: last {days} day{days === 1 ? '' : 's'}</div>
            </div>
            {!isActionable && (
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontStyle: 'italic', marginBottom: 8, padding: '6px 8px', background: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 4 }}>
                Treat below as an <strong>event scanner</strong>, not alpha signal. Scores 4-6 mean a warrant exists with partial conviction markers — NOT that the stock is a buy. Use Tier-1/2/3 classification + Distress P% on each card for real assessment.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
              {ranked.map((r, i) => {
                const cv = r.conviction.conviction;
                const color = cv >= 8 ? '#10B981' : cv >= 5 ? '#22D3EE' : cv >= 3 ? '#F59E0B' : '#94A3B8';
                const prem = r.conviction.premium_pct;
                return (
                  <div key={r.symbol + '-warr-rank-' + i} style={{ padding: 10, background: 'var(--mc-bg-0)', border: `1px solid ${color}50`, borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div>
                        <span style={{ fontSize: 9, color: 'var(--mc-state-persistent)', fontWeight: 900, marginRight: 6 }}>#{i + 1}</span>
                        <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-text-1)' }}>{r.symbol || r.company_name}</span>
                      </div>
                      <span title={`Conviction = ${cv.toFixed(1)} / 10`} style={{ fontSize: 16, fontWeight: 900, color }}>{cv.toFixed(1)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 4 }}>{r.company_name}</div>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: 9 }}>
                      {/* PATCH 0427 — Tier chip on every Top 10 card */}
                      {r.conviction.tier && (() => {
                        const tColor = r.conviction.tier === 'TIER_1_INSTITUTIONAL' ? '#10B981' : r.conviction.tier === 'TIER_2_NEUTRAL' ? '#22D3EE' : '#EF4444';
                        const tLbl = r.conviction.tier === 'TIER_1_INSTITUTIONAL' ? '🏆 T1' : r.conviction.tier === 'TIER_2_NEUTRAL' ? '◐ T2' : '⚠ T3';
                        return <span title={r.conviction.tier_rationale || ''} style={{ padding: '1px 5px', borderRadius: 3, background: `${tColor}25`, color: tColor, fontWeight: 900 }}>{tLbl}</span>;
                      })()}
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: `${color}20`, color, fontWeight: 800 }}>{r.warrant_type.replace(/_/g, ' ')}</span>
                      {r.conviction.passes_gate && <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 15%, transparent)', color: 'var(--mc-bullish)', fontWeight: 800 }}>★ GATE</span>}
                      {prem != null && <span style={{ padding: '1px 5px', borderRadius: 3, background: 'var(--mc-bg-4)', color: prem >= 0 ? 'var(--mc-bullish)' : prem >= -10 ? 'var(--mc-warn)' : 'var(--mc-bearish)' }}>{prem >= 0 ? '+' : ''}{prem.toFixed(1)}% vs CMP</span>}
                      {r.details.total_size_cr != null && <span style={{ padding: '1px 5px', borderRadius: 3, background: 'var(--mc-bg-4)', color: 'var(--mc-text-2)' }}>₹{r.details.total_size_cr.toFixed(0)}Cr</span>}
                      {r.details.promoter_participation_pct != null && <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)' }}>Promo {r.details.promoter_participation_pct.toFixed(0)}%</span>}
                      {r.conviction.distress_probability != null && r.conviction.distress_probability >= 0.3 && (
                        <span title="Distress probability" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: 'var(--mc-bearish)', fontWeight: 700 }}>
                          Distress {(r.conviction.distress_probability * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(data?.filings || []).slice(0, 50).map((f, i) => {
          const cvColor = f.conviction.conviction >= 8 ? '#10B981' : f.conviction.conviction >= 5 ? '#22D3EE' : f.conviction.conviction >= 3 ? '#F59E0B' : '#94A3B8';
          const premium = f.conviction.premium_pct;
          const premiumColor = premium == null ? '#94A3B8' : premium >= 0 ? '#10B981' : premium >= -10 ? '#F59E0B' : '#EF4444';
          return (
            <div key={f.symbol + '-' + i} style={{ padding: '10px 12px', background: 'var(--mc-bg-0)', border: `1px solid ${f.conviction.passes_gate ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'var(--mc-bg-4)'}`, borderLeft: `3px solid ${cvColor}`, borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-text-1)' }}>{f.symbol || f.company_name}</span>
                  {f.symbol && <span style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>{f.company_name}</span>}
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--mc-bg-4)', color: 'var(--mc-text-3)', fontWeight: 700 }}>{f.exchange}</span>
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${cvColor}20`, color: cvColor, fontWeight: 700 }}>{f.warrant_type.replace(/_/g, ' ')}</span>
                  {f.conviction.passes_gate && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 15%, transparent)', color: 'var(--mc-bullish)', fontWeight: 800, border: '1px solid var(--mc-bullish)' }}>★ PASSES GATE</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: cvColor }}>{f.conviction.conviction.toFixed(1)}</span>
                  <span style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>/10</span>
                </div>
              </div>

              <div style={{ fontSize: 11, color: 'var(--mc-text-2)', marginBottom: 6, lineHeight: 1.4 }}>{decodeHTMLEntities(f.subject)}</div>

              {/* PATCH 0426 — Tier 1/2/3 classification + capital use + promoter intent + distress strip */}
              {(f.conviction as any).tier && (() => {
                const tier = (f.conviction as any).tier;
                const tierColor = tier === 'TIER_1_INSTITUTIONAL' ? '#10B981' : tier === 'TIER_2_NEUTRAL' ? '#22D3EE' : '#EF4444';
                const tierLabel = tier === 'TIER_1_INSTITUTIONAL' ? '🏆 TIER 1 — INSTITUTIONAL'
                                : tier === 'TIER_2_NEUTRAL'       ? '◐ TIER 2 — NEUTRAL'
                                                                  : '⚠ TIER 3 — DISTRESS';
                const cap = (f.conviction as any).capital_use;
                const capColor = cap === 'CAPEX' || cap === 'ACQUISITION' ? '#10B981'
                              : cap === 'DEBT_REPAY' ? '#F59E0B'
                              : cap === 'WORKING_CAPITAL' || cap === 'GENERAL_CORPORATE' ? '#EF4444'
                              : '#94A3B8';
                const intent = (f.conviction as any).promoter_intent;
                const intentColor = intent === 'INCREASING_STAKE' ? '#10B981'
                                  : intent === 'MAINTAINING_STAKE' ? '#22D3EE'
                                  : intent === 'EXITING' ? '#EF4444'
                                  : intent === 'THIRD_PARTY_ONLY' ? '#F59E0B' : '#94A3B8';
                const distress = (f.conviction as any).distress_probability ?? 0;
                return (
                  <div style={{ marginBottom: 6, padding: '6px 8px', background: `${tierColor}10`, border: `1px solid ${tierColor}50`, borderRadius: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 900, color: tierColor, letterSpacing: '0.4px' }}>{tierLabel}</span>
                      <span title="0 = clean institutional, 1.0 = clear distress" style={{ fontSize: 9, color: distress >= 0.5 ? 'var(--mc-bearish)' : distress >= 0.3 ? 'var(--mc-warn)' : 'var(--mc-bullish)', fontWeight: 700 }}>
                        Distress P = {(distress * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 3 }}>
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${capColor}15`, color: capColor, fontWeight: 700 }}>
                        💰 Use: {cap?.replace(/_/g, ' ') || 'UNKNOWN'}
                      </span>
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${intentColor}15`, color: intentColor, fontWeight: 700 }}>
                        👥 Promoter: {intent?.replace(/_/g, ' ') || 'UNKNOWN'}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>{(f.conviction as any).tier_rationale}</div>
                  </div>
                );
              })()}

              {/* Key facts */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6, fontSize: 10 }}>
                {f.details.issue_price != null && (
                  <div><span style={{ color: 'var(--mc-text-3)' }}>Issue:</span> <strong style={{ color: 'var(--mc-text-1)' }}>₹{f.details.issue_price.toFixed(0)}</strong></div>
                )}
                {f.price.cmp != null && (
                  <div><span style={{ color: 'var(--mc-text-3)' }}>CMP:</span> <strong style={{ color: 'var(--mc-text-1)' }}>₹{f.price.cmp.toFixed(0)}</strong></div>
                )}
                {premium != null && (
                  <div><span style={{ color: 'var(--mc-text-3)' }}>vs CMP:</span> <strong style={{ color: premiumColor }}>{premium >= 0 ? '+' : ''}{premium.toFixed(1)}%</strong></div>
                )}
                {f.details.total_size_cr != null && (
                  <div><span style={{ color: 'var(--mc-text-3)' }}>Size:</span> <strong style={{ color: 'var(--mc-text-1)' }}>₹{f.details.total_size_cr.toFixed(0)}Cr</strong></div>
                )}
                {f.details.promoter_participation_pct != null && (
                  <div><span style={{ color: 'var(--mc-text-3)' }}>Promoter:</span> <strong style={{ color: 'var(--mc-bullish)' }}>{f.details.promoter_participation_pct.toFixed(0)}%</strong></div>
                )}
                {f.price.perf_52w_high_pct != null && (
                  <div><span style={{ color: 'var(--mc-text-3)' }}>vs 52wH:</span> <strong style={{ color: f.price.perf_52w_high_pct >= -5 ? 'var(--mc-bullish)' : 'var(--mc-text-3)' }}>{f.price.perf_52w_high_pct.toFixed(1)}%</strong></div>
                )}
                {f.price.perf_90d_pct != null && (
                  <div><span style={{ color: 'var(--mc-text-3)' }}>90d:</span> <strong style={{ color: f.price.perf_90d_pct >= 20 ? 'var(--mc-bullish)' : f.price.perf_90d_pct >= 0 ? 'var(--mc-cyan)' : 'var(--mc-bearish)' }}>{f.price.perf_90d_pct >= 0 ? '+' : ''}{f.price.perf_90d_pct.toFixed(0)}%</strong></div>
                )}
                {f.business_momentum_score != null && (
                  <div><span style={{ color: 'var(--mc-text-3)' }}>Momentum:</span> <strong style={{ color: f.business_momentum_score >= 6 ? 'var(--mc-bullish)' : 'var(--mc-text-3)' }}>{f.business_momentum_score.toFixed(1)}/10</strong></div>
                )}
              </div>

              {/* Signals + risks */}
              {f.conviction.signals.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 700, marginRight: 4 }}>WHY:</span>
                  {f.conviction.signals.slice(0, 5).map((s, j) => (
                    <span key={j} style={{ fontSize: 10, color: 'var(--mc-text-2)', marginRight: 8 }}>› {s}</span>
                  ))}
                </div>
              )}
              {f.conviction.red_flags.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--mc-bearish)', fontWeight: 700, marginRight: 4 }}>RISKS:</span>
                  {f.conviction.red_flags.slice(0, 3).map((s, j) => (
                    <span key={j} style={{ fontSize: 10, color: 'var(--mc-text-2)', marginRight: 8 }}>› {s}</span>
                  ))}
                </div>
              )}

              {/* Historical memory */}
              {f.conviction.history_summary && (
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--mc-state-persistent)', fontStyle: 'italic' }}>
                  📜 {f.conviction.history_summary}
                </div>
              )}

              {/* PATCH 0395 — Warrant scoring transparency: full component breakdown */}
              <div style={{ marginTop: 6, padding: '6px 8px', background: '#13131a', border: '1px solid var(--mc-bg-4)', borderRadius: 4 }}>
                <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontWeight: 700, marginBottom: 3, letterSpacing: '0.4px' }}>SCORE DECOMPOSITION (raw {f.conviction.raw_score.toFixed(1)} / 10)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 9 }}>
                  <span title="Promoter / promoter-group participation (0-3, MANDATORY)" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>Promoter {f.conviction.components.promoter_participation.toFixed(1)}/3</span>
                  <span title="Issue price vs CMP. Premium = good (+3), -10% OK (+1), deeper discount = bad" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', fontWeight: 700 }}>Pricing {f.conviction.components.pricing_premium >= 0 ? '+' : ''}{f.conviction.components.pricing_premium.toFixed(1)}</span>
                  <span title="Near 52w high or strong 90d perf = +2; weak structure = -" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', color: 'var(--mc-state-persistent)', fontWeight: 700 }}>Breakout {f.conviction.components.breakout_relative_strength.toFixed(1)}/2</span>
                  <span title="Concall bullish score: ≥6 = +2; 4-6 = +1; <2 = negative" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', color: 'var(--mc-warn)', fontWeight: 700 }}>Momentum {f.conviction.components.business_momentum.toFixed(1)}/2</span>
                  {f.conviction.components.history_boost > 0 && <span title="Prior warrants rallied ≥25% = boost" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>History +{f.conviction.components.history_boost.toFixed(1)}</span>}
                  {f.conviction.components.governance_penalty < 0 && <span title="Microcap / pledge / dilution pattern penalty" style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: 'var(--mc-bearish)', fontWeight: 700 }}>Govern {f.conviction.components.governance_penalty.toFixed(1)}</span>}
                </div>
                <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 3, fontStyle: 'italic' }}>
                  Gate (≥ 8/10): A) promoter present · B) pricing ≥ -10% · C) no critical governance · D) breakout OR momentum present
                </div>
                {/* PATCH 0423 — extraction diagnostics. Shows user EXACTLY why a
                    warrant scored low: which fields were missing from the PDF
                    body, and which conviction gates failed. No black box. */}
                {(f.conviction as any).diagnostics && (
                  <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--mc-text-3)', letterSpacing: '0.4px', marginBottom: 3 }}>🔍 EXTRACTION DIAGNOSTICS</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                      {[
                        { lbl: 'PDF', ok: (f.conviction as any).diagnostics.pdf_extracted },
                        { lbl: 'Promoter', ok: (f.conviction as any).diagnostics.promoter_subscribed_found },
                        { lbl: 'Issue px', ok: (f.conviction as any).diagnostics.issue_price_found },
                        { lbl: 'Conv period', ok: (f.conviction as any).diagnostics.conversion_period_found },
                        { lbl: 'CMP', ok: (f.conviction as any).diagnostics.cmp_found },
                        { lbl: 'Momentum', ok: (f.conviction as any).diagnostics.momentum_found },
                      ].map((d, j) => (
                        <span key={j} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: d.ok ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: d.ok ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>
                          {d.ok ? '✓' : '✗'} {d.lbl}
                        </span>
                      ))}
                    </div>
                    {(f.conviction as any).diagnostics.gate_failures.length > 0 && (
                      <div style={{ fontSize: 9, color: 'var(--mc-warn)' }}>
                        <span style={{ fontWeight: 800 }}>FAILED GATES:</span> {(f.conviction as any).diagnostics.gate_failures.join(' · ')}
                      </div>
                    )}
                    {(f.conviction as any).diagnostics.missing_fields.length > 0 && (
                      <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontStyle: 'italic', marginTop: 2 }}>
                        missing: {(f.conviction as any).diagnostics.missing_fields.join(' · ')}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--mc-text-4)', marginTop: 6 }}>
                <span>{new Date(f.filing_datetime).toLocaleString()}</span>
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
    </div>
  );
}
