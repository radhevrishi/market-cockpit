'use client';

// ═══════════════════════════════════════════════════════════════════════════
// CONCALL INTELLIGENCE ENGINE v3 (PATCH 0107 / 0171 / 0387)
//
// PATCH 0387 — Added LIVE NSE/BSE BULLISH FEED at top of page. Polls
// /api/v1/concall-intel/live-feed every 5 min during market hours, shows
// only high-bullish filings (≥ raw 4 score, ≥1 mgmt confidence phrase,
// ≥1 business evidence phrase, no critical blockers).
//
// Plus the original manual transcript-paste analyser below.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';

interface Analysis {
  ticker: string;
  length: number;
  tone: { score: number; pos: number; neg: number; defensive: number; label: string };
  guidance: Array<{ kind: string; pct: string | null; snippet: string }>;
  numbers:  Array<{ metric: string; value: string; snippet: string }>;
  themes:   Array<{ theme: string; mentions: number }>;
  red_flags: string[];
  generated_at: string;
}

export default function ConcallIntelPage() {
  const [ticker, setTicker] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);

  const analyze = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/v1/concall/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, pdf_url: pdfUrl, transcript }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || `HTTP ${res.status}`);
        return;
      }
      const j = await res.json();
      setResult(j);
    } catch (e: any) {
      setError(e?.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const toneColor = (s: number) => s >= 70 ? '#10B981' : s >= 55 ? '#22D3EE' : s >= 40 ? '#F59E0B' : s >= 25 ? '#F97316' : '#EF4444';

  return (
    <div style={{ padding: '20px 24px', backgroundColor: '#0A0E1A', minHeight: '100%', color: '#E6EDF3' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, marginBottom: 6 }}>🎙️ Concall Intelligence v3</h1>
      <p style={{ fontSize: 12, color: '#94A3B8', margin: 0, marginBottom: 18 }}>
        🔥 LIVE bullish NSE/BSE concall + investor-presentation filings (auto-poll). ⬇️ Plus manual transcript / PDF analyser below.
      </p>

      {/* PATCH 0400 — MOVERS panel (daily delta detection) */}
      <MoversPanel />

      {/* PATCH 0387 — LIVE BULLISH FEED */}
      <LiveBullishFeed />

      {/* PATCH 0390 — WARRANT MOMENTUM INTELLIGENCE (separate lane) */}
      <WarrantMomentumFeed />

      {/* PATCH 0394 — KEYWORD WATCH (third intelligence lane) */}
      <KeywordWatchFeed />

      <h2 style={{ fontSize: 16, fontWeight: 900, margin: '32px 0 8px' }}>📝 Manual Transcript / PDF Analyser</h2>
      <p style={{ fontSize: 11, color: '#94A3B8', margin: 0, marginBottom: 14 }}>
        Paste a concall transcript OR enter a public PDF URL. Output: tone score, guidance map, key themes, red flags, key numbers.
      </p>

      {/* ── Input ───────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: '#0D1623', border: '1px solid #1A2540', borderRadius: 10, padding: '14px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker (optional)"
            style={{ flex: '0 0 140px', padding: '7px 10px', backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, color: '#E6EDF3', fontSize: 12, outline: 'none' }} />
          <input value={pdfUrl} onChange={(e) => setPdfUrl(e.target.value)} placeholder="Public PDF URL of concall (optional)"
            style={{ flex: 1, padding: '7px 10px', backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, color: '#E6EDF3', fontSize: 12, outline: 'none' }} />
        </div>
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)}
          placeholder="...or paste the transcript here (Q&A + management commentary, 200+ chars)"
          rows={6}
          style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, color: '#E6EDF3', fontSize: 12, outline: 'none', fontFamily: 'ui-sans-serif, system-ui', resize: 'vertical' }} />
        <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
          <button onClick={analyze} disabled={loading || (!pdfUrl.trim() && transcript.trim().length < 200)}
            style={{ padding: '8px 16px', backgroundColor: loading ? '#22D3EE40' : '#22D3EE', color: '#0A0E1A', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? 'Analysing…' : 'Analyse Concall'}
          </button>
          {error && <span style={{ color: '#EF4444', fontSize: 11 }}>⚠ {error}</span>}
        </div>
      </div>

      {/* ── Result ──────────────────────────────────────────────────── */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Tone Score */}
          <div style={{ backgroundColor: '#0D1623', border: `1px solid ${toneColor(result.tone.score)}40`, borderLeft: `4px solid ${toneColor(result.tone.score)}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.6px' }}>TONE & CONFIDENCE</div>
              <div style={{ fontSize: 44, fontWeight: 900, color: toneColor(result.tone.score), lineHeight: 1 }}>
                {result.tone.score}<span style={{ fontSize: 14, color: '#94A3B8' }}>/100</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: toneColor(result.tone.score), marginTop: 4 }}>{result.tone.label}</div>
            </div>
            <div style={{ flex: 1, fontSize: 11, color: '#94A3B8' }}>
              <div>📈 Positive cues: <strong style={{ color: '#10B981' }}>{result.tone.pos}</strong></div>
              <div>📉 Negative cues: <strong style={{ color: '#EF4444' }}>{result.tone.neg}</strong></div>
              <div>🛡 Defensive language: <strong style={{ color: '#F59E0B' }}>{result.tone.defensive}</strong></div>
              <div style={{ marginTop: 4 }}>Transcript length: {result.length.toLocaleString()} chars</div>
            </div>
          </div>

          {/* Guidance Map */}
          {result.guidance.length > 0 && (
            <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderLeft: '3px solid #22D3EE', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px', marginBottom: 8 }}>GUIDANCE MAP — {result.guidance.length}</div>
              {result.guidance.slice(0, 12).map((g, i) => {
                const col = g.kind === 'raise' ? '#10B981' : g.kind === 'cut' ? '#EF4444' : g.kind === 'withdraw' ? '#F97316' : '#94A3B8';
                return (
                  <div key={i} style={{ fontSize: 11, padding: '4px 0', borderBottom: '1px dashed #1A2840' }}>
                    <span style={{ fontWeight: 800, color: col, textTransform: 'uppercase', letterSpacing: '0.4px', marginRight: 6 }}>{g.kind}</span>
                    {g.pct && <span style={{ color: '#E6EDF3', fontWeight: 700 }}>{g.pct} </span>}
                    <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>… {g.snippet}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Themes + Numbers side-by-side */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 10 }}>
            {result.themes.length > 0 && (
              <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderLeft: '3px solid #FBBF24', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.4px', marginBottom: 8 }}>KEY THEMES</div>
                {result.themes.map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: '#E6EDF3' }}>{t.theme}</span>
                    <span style={{ color: '#94A3B8', fontFamily: 'ui-monospace, monospace' }}>{t.mentions}× mention{t.mentions === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            )}
            {result.red_flags.length > 0 && (
              <div style={{ backgroundColor: '#0A1422', border: '1px solid #EF444440', borderLeft: '3px solid #EF4444', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#EF4444', letterSpacing: '0.4px', marginBottom: 8 }}>⚠ RED FLAGS</div>
                {result.red_flags.map((f, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '4px 0', color: '#E6EDF3' }}>· {f}</div>
                ))}
              </div>
            )}
          </div>

          {/* Numbers Mentioned */}
          {result.numbers.length > 0 && (
            <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderLeft: '3px solid #10B981', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#10B981', letterSpacing: '0.4px', marginBottom: 8 }}>NUMBERS MENTIONED — {result.numbers.length}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                {result.numbers.map((n, i) => (
                  <div key={i} style={{ fontSize: 11, padding: '5px 8px', backgroundColor: '#0D1623', borderRadius: 4 }}>
                    <span style={{ color: '#FBBF24', fontWeight: 800, textTransform: 'uppercase' }}>{n.metric}</span>
                    <span style={{ color: '#E6EDF3', fontWeight: 800, marginLeft: 8 }}>{n.value}</span>
                    <div style={{ color: '#6B7A8D', fontSize: 10, marginTop: 2, fontStyle: 'italic' }}>…{n.snippet}…</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0387 — LIVE BULLISH FEED (auto-poll NSE/BSE)
// ═══════════════════════════════════════════════════════════════════════════

interface EvidenceSentence {
  text: string;
  tag: string;
  polarity: 'BULL' | 'BEAR';
  negated: boolean;
}

// PATCH 0401 — sector overlay payload
interface SectorOverlayResult {
  sector: string;
  sector_confidence: number;
  overlay_score: number;
  positive_signals: string[];
  negative_signals: string[];
  positive_evidence: Array<{ tag: string; sentence: string }>;
  negative_evidence: Array<{ tag: string; sentence: string }>;
}

interface LiveFeedFiling {
  exchange: 'NSE' | 'BSE';
  symbol: string;
  company_name: string;
  subject: string;
  filing_datetime: string;
  attachment_urls: string[];
  source_url: string;
  filing_type: string;
  bullish: {
    score: number;
    raw_score: number;
    sentiment: string;
    tier?: 'ULTRA_BULLISH' | 'BULLISH' | 'MIXED_POSITIVE' | 'NEUTRAL' | 'BEARISH' | 'INSUFFICIENT' | 'DATA_PENDING';  // PATCH 0391+0397
    confidence: string;
    tags: string[];
    bullish_phrases: string[];
    red_flags: string[];
    fatal_blockers?: string[];        // PATCH 0391
    components: {
      management_confidence: number;
      business_evidence: number;
      positive_score?: number;
      blockers: number;
      blocker_severity_low?: number;
      blocker_severity_medium?: number;
      blocker_severity_fatal?: number;
    };
    evidence?: EvidenceSentence[];     // PATCH 0389
  };
  is_high_bullish: boolean;
  // PATCH 0388
  scored_from?: 'PDF' | 'SUBJECT';
  pdf_pages?: number;
  pdf_failure_reason?: string;
  // PATCH 0401
  sector_overlay?: SectorOverlayResult;
}

interface LiveFeedPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_high_bullish: number;
  filings: LiveFeedFiling[];
  sources: { nse: string; bse: string };
}

function LiveBullishFeed() {
  const [data, setData] = useState<LiveFeedPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PATCH 0395 — bullish-only toggle defaults to FALSE (no selection bias).
  // User flagged that defaulting to bullish-only is a confirmation-bias risk.
  // Full universe is now the default lens; bullish-only is opt-in.
  const [bullishOnly, setBullishOnly] = useState(false);
  const [exchange, setExchange] = useState<'ALL' | 'NSE' | 'BSE'>('ALL');
  const [days, setDays] = useState(7);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // PATCH 0391 — tier filter chips. Default to ALL TIERS for full-universe view.
  // PATCH 0397 — Added DATA_PENDING to default set.
  // PATCH 0410 — DATA_PENDING removed from defaults.
  // PATCH 0416 — Per user: "i only want bearish and bullish .neutral isnot
  // my importance. i do nothing with such list make it better useful for
  // investing". So default = actionable signals only (ULTRA, BULLISH,
  // MIXED_POSITIVE, BEARISH). NEUTRAL and DATA_PENDING hidden behind chip
  // toggles for when user wants to inspect the broader universe.
  const [tierFilter, setTierFilter] = useState<Set<string>>(new Set(['ULTRA_BULLISH', 'BULLISH', 'MIXED_POSITIVE', 'BEARISH']));
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
    try {
      const params = new URLSearchParams({
        days: String(days),
        ...(force ? { force: '1' } : {}),
      });
      const res = await fetch(`/api/v1/concall-intel/live-feed?${params}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = await res.json();
      setData(j);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch + auto-poll every 5 min
  useEffect(() => {
    fetchFeed();
    const t = setInterval(() => fetchFeed(), 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let out = data.filings;
    if (exchange !== 'ALL') out = out.filter(f => f.exchange === exchange);
    if (bullishOnly) {
      // PATCH 0391 — when bullishOnly toggled, use tier filter
      out = out.filter(f => f.bullish.tier && tierFilter.has(f.bullish.tier));
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
    <div style={{ backgroundColor: '#0D1623', border: '1px solid #F59E0B30', borderLeft: '4px solid #F59E0B', borderRadius: 10, padding: '14px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#F59E0B', letterSpacing: '0.4px' }}>🔥 LIVE BULLISH FEED — NSE / BSE concall + presentation filings</div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
            {data ? (
              <>
                {data.count_total} total · {data.count_relevant} concall-relevant ·
                {' '}<strong style={{ color: '#22D3EE' }}>{tierCounts.ULTRA_BULLISH || 0} 🚀</strong> ·
                {' '}<strong style={{ color: '#10B981' }}>{tierCounts.BULLISH || 0} 🟢</strong> ·
                {' '}<strong style={{ color: '#F59E0B' }}>{tierCounts.MIXED_POSITIVE || 0} 🟡</strong> ·
                {' '}<strong style={{ color: '#94A3B8' }}>{tierCounts.NEUTRAL || 0} ⚪</strong> ·
                {' '}<strong style={{ color: '#EF4444' }}>{tierCounts.BEARISH || 0} 🔴</strong> ·
                {' '}<strong style={{ color: '#3B82F6' }}>{tierCounts.DATA_PENDING || 0} 🟦</strong>
                {' '}· sources: NSE <strong style={{ color: data.sources.nse === 'NSE_OK' ? '#10B981' : '#EF4444' }}>{data.sources.nse}</strong> · BSE <strong style={{ color: data.sources.bse === 'BSE_OK' ? '#10B981' : '#94A3B8' }}>{data.sources.bse}</strong>
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
              <div style={{ display: 'flex', height: 5, width: '100%', borderRadius: 2, overflow: 'hidden', marginTop: 4, background: '#0A1422' }}>
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
          <button onClick={() => setBullishOnly(v => !v)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: `1px solid ${bullishOnly ? '#10B981' : '#1A2540'}`, background: bullishOnly ? '#10B98120' : 'transparent', color: bullishOnly ? '#10B981' : '#94A3B8', cursor: 'pointer' }}>
            ★ Bullish only {bullishOnly ? '✓' : ''}
          </button>
          {(['ALL', 'NSE', 'BSE'] as const).map(e => (
            <button key={e} onClick={() => setExchange(e)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: `1px solid ${exchange === e ? '#22D3EE' : '#1A2540'}`, background: exchange === e ? '#22D3EE20' : 'transparent', color: exchange === e ? '#22D3EE' : '#94A3B8', cursor: 'pointer' }}>
              {e}
            </button>
          ))}
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid #1A2540', background: '#0A1422', color: '#E6EDF3' }}>
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
          <button onClick={() => fetchFeed(true)} disabled={loading} style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 5, border: '1px solid #22D3EE', background: '#22D3EE20', color: '#22D3EE', cursor: loading ? 'wait' : 'pointer' }}>
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
        <div style={{ fontSize: 11, color: '#EF4444', marginBottom: 8 }}>⚠ {error}</div>
      )}
      {error && data && (data.filings?.length || 0) > 0 && (
        <div style={{ fontSize: 10, color: '#F59E0B', marginBottom: 8, fontStyle: 'italic' }}>
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
              <button key={t.id} onClick={() => toggleTier(t.id)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 5, border: `1px solid ${active ? t.color : '#1A2540'}`, background: active ? `${t.color}20` : 'transparent', color: active ? t.color : '#94A3B8', cursor: 'pointer' }}>
                {t.label} · {count}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic', padding: '12px 0' }}>
          {data && data.count_relevant > 0
            ? `No filings match the selected tiers. Try enabling more tiers above (e.g. Mixed Positive surfaces realistic mid-quality bullish setups).`
            : 'No concall-related filings yet. NSE/BSE may be blocking the request (try refresh in a few minutes).'}
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
          <div style={{ marginBottom: 14, padding: 14, background: 'linear-gradient(135deg, #EF444415, #F59E0B10)', border: '1px solid #EF444460', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#EF4444', letterSpacing: '0.5px' }}>
                🚨 SUPPLY-CHAIN BOTTLENECKS DETECTED — {detected.length} filing{detected.length === 1 ? '' : 's'} across {groupArr.length} component{groupArr.length === 1 ? '' : 's'}{ungrouped.length > 0 ? ` + ${ungrouped.length} unmapped` : ''}
              </div>
              <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>last {days}d · pattern-detected</div>
            </div>
            <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 10, fontStyle: 'italic' }}>
              Detection is 100% regex on concall text — no company hardcoding. Sympathy beneficiaries are mapped from curated industry knowledge; verify independently.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 10 }}>
              {groupArr.slice(0, 12).map((g, gi) => (
                <div key={g.component + '-bg-' + gi} style={{ padding: 10, background: '#0A1422', border: `1px solid ${g.critical ? '#EF4444' : '#F59E0B'}60`, borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: g.critical ? '#EF4444' : '#F59E0B' }}>
                      {g.critical ? '🚨 ' : '⚠ '}{g.component.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: 10, color: '#94A3B8' }}>{g.companies.length} co{g.companies.length === 1 ? '' : 's'}</div>
                  </div>
                  {g.sectors.size > 0 && (
                    <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 4 }}>sector: {Array.from(g.sectors).join(' · ')}</div>
                  )}
                  <div style={{ fontSize: 10, color: '#C9D4E0', marginBottom: 6, lineHeight: 1.45 }}>
                    {g.companies.slice(0, 2).map((c, ci) => (
                      <div key={c.symbol + '-c-' + ci} style={{ marginBottom: 3 }}>
                        <strong style={{ color: '#22D3EE' }}>[{c.symbol || c.company_name}]</strong> &ldquo;{(c.evidence || '').slice(0, 180)}{(c.evidence || '').length > 180 ? '…' : ''}&rdquo;
                      </div>
                    ))}
                    {g.companies.length > 2 && (
                      <div style={{ fontSize: 9, color: '#94A3B8' }}>+ {g.companies.length - 2} more</div>
                    )}
                  </div>
                  {g.beneficiaries.size > 0 && (
                    <div style={{ fontSize: 9, color: '#10B981' }}>
                      <span style={{ fontWeight: 800 }}>↪ POTENTIAL READ-THROUGH:</span> {Array.from(g.beneficiaries).slice(0, 8).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {ungrouped.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, background: '#0A1422', border: '1px solid #1A2540', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#A78BFA', marginBottom: 6, letterSpacing: '0.5px' }}>
                  📡 RAW BOTTLENECK EVIDENCE (component not in known vocab — surface so future bottlenecks aren't missed)
                </div>
                {ungrouped.slice(0, 6).map((u, ui) => (
                  <div key={u.symbol + '-u-' + ui} style={{ fontSize: 10, color: '#C9D4E0', marginBottom: 4, lineHeight: 1.45 }}>
                    <strong style={{ color: '#22D3EE' }}>[{u.symbol || u.company_name}]</strong> {u.critical ? '🚨 ' : ''}&ldquo;{(u.evidence || '').slice(0, 200)}{(u.evidence || '').length > 200 ? '…' : ''}&rdquo;
                  </div>
                ))}
                {ungrouped.length > 6 && (
                  <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 4 }}>+ {ungrouped.length - 6} more raw evidence lines</div>
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
        <div style={{ marginBottom: 14, padding: 14, background: 'linear-gradient(135deg, #06B6D420, #A78BFA10)', border: '1px solid #06B6D470', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: '#06B6D4', letterSpacing: '0.5px' }}>
              🌐 CROSS-COMPANY THEME CLUSTERS — institutional cross-confirmation across the window
            </div>
            <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>
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
                <div key={tc.key + '-tc-' + ti} style={{ padding: 10, background: '#0A1422', border: `1px solid ${convictionColor}50`, borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#E6EDF3' }}>
                      <span style={{ marginRight: 6 }}>{kindIcon}</span>{tc.label}
                    </div>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: `${convictionColor}25`, color: convictionColor, fontWeight: 900, letterSpacing: '0.4px' }}>
                      {tc.conviction}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 6 }}>
                    {tc.company_count} unique compan{tc.company_count === 1 ? 'y' : 'ies'} · {tc.filing_count} filings · avg composite {tc.avg_score.toFixed(1)}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                    {tc.top_companies.slice(0, 8).map((c: any) => (
                      <span key={c.symbol} title={`${c.company_name} · composite ${c.score.toFixed(1)}`} style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, background: '#1A2540', color: '#C9D4E0', border: '1px solid #1A2540' }}>
                        {c.symbol} <span style={{ color: convictionColor, marginLeft: 3 }}>{c.score.toFixed(1)}</span>
                      </span>
                    ))}
                  </div>
                  {tc.kind === 'COMPONENT' && Array.isArray(tc.beneficiaries) && tc.beneficiaries.length > 0 && (
                    <div style={{ marginBottom: 5 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', marginBottom: 3 }}>★ READ-THROUGH BENEFICIARIES (verify independently)</div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {tc.beneficiaries.slice(0, 10).map((b: string) => (
                          <span key={b} style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, background: '#10B98120', color: '#10B981', border: '1px solid #10B98140' }}>{b}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {tc.evidence_excerpts && tc.evidence_excerpts.length > 0 && (
                    <div style={{ fontSize: 9, color: '#94A3B8', fontStyle: 'italic', marginTop: 4, lineHeight: 1.4 }}>
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
            <div style={{ marginBottom: 12, padding: 16, background: 'linear-gradient(135deg, #10B98110, #22D3EE10)', border: '1px solid #1A2540', borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#94A3B8', letterSpacing: '0.5px', marginBottom: 4 }}>
                ★ TOP RANKED — institutional shortlist
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.5 }}>
                No actionable signals in the last {days} day{days === 1 ? '' : 's'} yet.
                Strict calibration filters out boilerplate. As more PDFs are extracted from
                background cache (each refresh adds 50-100), real BULLISH / MIXED_POSITIVE
                transcripts will surface here.
              </div>
            </div>
          );
        }
        return (
          <div style={{ marginBottom: 12, padding: 12, background: 'linear-gradient(135deg, #10B98110, #22D3EE10)', border: '1px solid #10B98150', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#10B981', letterSpacing: '0.5px' }}>★ TOP {ranked.length} RANKED — institutional shortlist (by composite: 0.5×Quality + 0.3×Cycle + 0.2×Sentiment)</div>
              <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>· window: last {days} day{days === 1 ? '' : 's'}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }}>
              {ranked.map((r, i) => {
                const tierColor = r.bullish.tier === 'ULTRA_BULLISH' ? '#22D3EE' : r.bullish.tier === 'BULLISH' ? '#10B981' : '#F59E0B';
                return (
                  <div key={r.symbol + '-rank-' + i} style={{ padding: 10, background: '#0A1422', border: `1px solid ${tierColor}50`, borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div>
                        <span style={{ fontSize: 9, color: '#F59E0B', fontWeight: 900, marginRight: 6 }}>#{i + 1}</span>
                        <span style={{ fontSize: 13, fontWeight: 900, color: '#E6EDF3' }}>{r.symbol || r.company_name}</span>
                      </div>
                      <span title={`Composite = 0.5×Q + 0.3×C + 0.2×S. Raw bullish: ${r.bullish.raw_score.toFixed(1)}`} style={{ fontSize: 16, fontWeight: 900, color: tierColor }}>{((r.bullish.components as any).composite_score ?? r.bullish.raw_score).toFixed(1)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 4 }}>{r.company_name}</div>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: 8 }}>
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: `${tierColor}20`, color: tierColor, fontWeight: 800 }}>{r.bullish.tier?.replace('_', ' ')}</span>
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: '#10B98115', color: '#10B981' }}>Mgmt {r.bullish.components.management_confidence.toFixed(1)}</span>
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: '#22D3EE15', color: '#22D3EE' }}>Biz {r.bullish.components.business_evidence.toFixed(1)}</span>
                      {(r.bullish.components.blockers || 0) > 0 && <span style={{ padding: '1px 5px', borderRadius: 3, background: '#EF444415', color: '#EF4444' }}>Risk {r.bullish.components.blockers.toFixed(1)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.slice(0, 50).map((f, i) => {
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
            <div key={f.symbol + '-' + i} style={{ padding: '10px 12px', background: '#0A1422', border: `1px solid ${f.is_high_bullish ? '#10B98140' : '#1A2540'}`, borderLeft: `3px solid ${scoreColor}`, borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: '#E6EDF3' }}>{f.symbol || f.company_name}</span>
                  {f.symbol && <span style={{ fontSize: 11, color: '#94A3B8' }}>{f.company_name}</span>}
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#1A2540', color: '#94A3B8', fontWeight: 700 }}>{f.exchange}</span>
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
                    <span title={`Fatal blockers: ${f.bullish.fatal_blockers.join(', ')}`} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#EF444425', color: '#EF4444', fontWeight: 800, border: '1px solid #EF4444' }}>☠ FATAL</span>
                  )}
                  {f.scored_from === 'PDF' && <span title={`Scored from extracted PDF text${f.pdf_pages ? ` (${f.pdf_pages}p)` : ''}`} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#22D3EE15', color: '#22D3EE', fontWeight: 700 }}>📄 PDF</span>}
                  {f.scored_from === 'SUBJECT' && f.pdf_failure_reason && <span title={`PDF extraction failed: ${f.pdf_failure_reason}`} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#94A3B815', color: '#94A3B8', fontWeight: 700 }}>📝 subject only</span>}
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
                          <span style={{ fontSize: 9, color: '#6B7A8D' }}>· raw {f.bullish.raw_score.toFixed(1)}</span>
                        )}
                        <span style={{ fontSize: 10, color: '#94A3B8' }}>· {f.bullish.confidence}</span>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#C9D4E0', marginBottom: 6, lineHeight: 1.4 }}>{f.subject}</div>
              {f.bullish.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {f.bullish.tags.map((t, j) => (
                    <span key={j} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#10B98115', color: '#10B981', fontWeight: 700 }}>{t}</span>
                  ))}
                </div>
              )}
              {f.bullish.red_flags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {f.bullish.red_flags.map((t, j) => (
                    <span key={j} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#EF444415', color: '#EF4444', fontWeight: 700 }}>⚠ {t}</span>
                  ))}
                </div>
              )}
              {/* PATCH 0407 — Bottleneck + sympathy beneficiary read-through */}
              {(f as any).bottleneck && (f as any).bottleneck.detected && (
                <div style={{ marginTop: 6, padding: '8px 10px', background: 'linear-gradient(135deg, #F59E0B15, #EF444415)', border: `1px solid ${(f as any).bottleneck.critical ? '#EF4444' : '#F59E0B'}60`, borderRadius: 5 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: (f as any).bottleneck.critical ? '#EF4444' : '#F59E0B', letterSpacing: '0.5px', marginBottom: 4 }}>
                    {(f as any).bottleneck.critical ? '🚨 CRITICAL BOTTLENECK DETECTED' : '⚠ BOTTLENECK DETECTED'}
                    {(f as any).bottleneck.components.length > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 9, color: '#C9D4E0', fontWeight: 700 }}>· components: {(f as any).bottleneck.components.join(', ')}</span>
                    )}
                  </div>
                  {(f as any).bottleneck.evidence && (f as any).bottleneck.evidence.length > 0 && (
                    <div style={{ fontSize: 10, color: '#C9D4E0', marginBottom: 4, fontStyle: 'italic' }}>
                      &ldquo;{((f as any).bottleneck.evidence[0] || '').slice(0, 220)}{((f as any).bottleneck.evidence[0]?.length || 0) > 220 ? '…' : ''}&rdquo;
                    </div>
                  )}
                  {(f as any).bottleneck.beneficiaries && (f as any).bottleneck.beneficiaries.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.4px', marginBottom: 3 }}>
                        ★ POTENTIAL READ-THROUGH BENEFICIARIES (verify independently)
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {((f as any).bottleneck.beneficiaries as string[]).slice(0, 8).map((b: string) => (
                          <span key={b} style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, background: '#10B98120', color: '#10B981', border: '1px solid #10B98140' }}>{b}</span>
                        ))}
                      </div>
                      {(f as any).bottleneck.sectors && (f as any).bottleneck.sectors.length > 0 && (
                        <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 3 }}>
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
                        <span style={{ color: '#10B981', fontWeight: 700, marginRight: 4 }}>WHY BULLISH:</span>
                        <div style={{ marginLeft: 0, marginTop: 2 }}>
                          {bull.slice(0, 4).map((e, k) => (
                            <div key={k} style={{ color: '#C9D4E0', padding: '1px 0' }}>› <span style={{ color: '#10B98180', fontWeight: 700 }}>[{e.tag}]</span> &ldquo;{e.text}&rdquo;</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {bear.length > 0 && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: '#EF4444', fontWeight: 700, marginRight: 4 }}>RISKS:</span>
                        <div style={{ marginLeft: 0, marginTop: 2 }}>
                          {bear.slice(0, 3).map((e, k) => (
                            <div key={k} style={{ color: '#C9D4E0', padding: '1px 0' }}>› <span style={{ color: '#EF444480', fontWeight: 700 }}>[{e.tag}{e.negated ? ' — negated' : ''}]</span> &ldquo;{e.text}&rdquo;</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* PATCH 0395+0397 — Decomposed score breakdown (transparency) */}
              <div style={{ marginTop: 6, padding: '6px 8px', background: '#13131a', border: '1px solid #1A2540', borderRadius: 4 }}>
                <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 700, marginBottom: 3, letterSpacing: '0.4px' }}>
                  SCORE DECOMPOSITION (raw {f.bullish.raw_score.toFixed(1)} / 10)
                  {(f.bullish.components as any).composite_score != null && (
                    <span style={{ marginLeft: 8, color: '#10B981' }}>· composite {(f.bullish.components as any).composite_score.toFixed(1)} / 10</span>
                  )}
                  {(f.bullish.components as any).earnings_anchored && (
                    <span title={`Anchors: ${((f.bullish.components as any).anchor_evidence || []).join(' · ')}`} style={{ marginLeft: 8, color: '#10B981', fontWeight: 800 }}>· ⚓ EARNINGS-ANCHORED</span>
                  )}
                  {!(f.bullish.components as any).earnings_anchored && (
                    <span style={{ marginLeft: 8, color: '#F59E0B', fontWeight: 700 }}>· ⚠ no financial anchor (capped at 6)</span>
                  )}
                </div>
                {/* PATCH 0401 — Sector overlay chip + signals */}
                {f.sector_overlay && f.sector_overlay.sector !== 'UNKNOWN' && (
                  <div style={{ marginBottom: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 9 }}>
                    <span title={`Sector confidence: ${f.sector_overlay.sector_confidence}/10`} style={{ padding: '1px 6px', borderRadius: 3, background: '#A78BFA20', color: '#A78BFA', fontWeight: 800 }}>
                      🏷 {f.sector_overlay.sector.replace('_', ' ')}
                    </span>
                    {f.sector_overlay.overlay_score !== 0 && (
                      <span title="Sector overlay adjusts base score by +/-3 based on sector-specific signals" style={{ padding: '1px 6px', borderRadius: 3, background: f.sector_overlay.overlay_score > 0 ? '#10B98120' : '#EF444420', color: f.sector_overlay.overlay_score > 0 ? '#10B981' : '#EF4444', fontWeight: 800 }}>
                        overlay {f.sector_overlay.overlay_score > 0 ? '+' : ''}{f.sector_overlay.overlay_score.toFixed(1)}
                      </span>
                    )}
                    {f.sector_overlay.positive_signals.slice(0, 3).map((s, j) => (
                      <span key={j} title="Sector positive signal" style={{ padding: '1px 5px', borderRadius: 3, background: '#10B98115', color: '#10B981', fontWeight: 700 }}>✓ {s}</span>
                    ))}
                    {f.sector_overlay.negative_signals.slice(0, 2).map((s, j) => (
                      <span key={j} title="Sector negative signal" style={{ padding: '1px 5px', borderRadius: 3, background: '#EF444415', color: '#EF4444', fontWeight: 700 }}>✗ {s}</span>
                    ))}
                  </div>
                )}
                {/* PATCH 0397 — 3-LAYER score bars (Quality / Cycle / Sentiment) */}
                {(f.bullish.components as any).quality_score != null && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 9, marginBottom: 4 }}>
                    <span title="Quality layer: margin stability + cash flow + deleveraging" style={{ padding: '1px 6px', borderRadius: 3, background: '#22D3EE20', color: '#22D3EE', fontWeight: 800 }}>Q {((f.bullish.components as any).quality_score ?? 0).toFixed(1)}/10</span>
                    <span title="Cycle layer: order book + capacity + demand + new customer + capex" style={{ padding: '1px 6px', borderRadius: 3, background: '#A78BFA20', color: '#A78BFA', fontWeight: 800 }}>C {((f.bullish.components as any).cycle_score ?? 0).toFixed(1)}/10</span>
                    <span title="Sentiment layer: guidance + management tone + outlook" style={{ padding: '1px 6px', borderRadius: 3, background: '#F59E0B20', color: '#F59E0B', fontWeight: 800 }}>S {((f.bullish.components as any).sentiment_score ?? 0).toFixed(1)}/10</span>
                    <span style={{ fontSize: 9, color: '#6B7A8D', fontStyle: 'italic', alignSelf: 'center' }}>composite = 0.5×Q + 0.3×C + 0.2×S</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 9 }}>
                  <span title="Sum of bullish combo points before penalties" style={{ padding: '1px 5px', borderRadius: 3, background: '#10B98115', color: '#10B981', fontWeight: 700 }}>Positive {(f.bullish.components.positive_score ?? f.bullish.raw_score).toFixed(1)}</span>
                  <span title="Management confidence pillar (Guidance + Demand + Margin + Outlook)" style={{ padding: '1px 5px', borderRadius: 3, background: '#22D3EE15', color: '#22D3EE', fontWeight: 700 }}>Mgmt {f.bullish.components.management_confidence.toFixed(1)}</span>
                  <span title="Business evidence pillar (Order Book + Capacity + Customer + Capex + etc.)" style={{ padding: '1px 5px', borderRadius: 3, background: '#A78BFA15', color: '#A78BFA', fontWeight: 700 }}>Biz {f.bullish.components.business_evidence.toFixed(1)}</span>
                  <span title="Total blocker weight (LOW + MEDIUM + FATAL) — deduped per tag" style={{ padding: '1px 5px', borderRadius: 3, background: f.bullish.components.blockers > 0 ? '#EF444415' : '#94A3B815', color: f.bullish.components.blockers > 0 ? '#EF4444' : '#94A3B8', fontWeight: 700 }}>Risk -{f.bullish.components.blockers.toFixed(1)}</span>
                  {(f.bullish.components.blocker_severity_fatal ?? 0) > 0 && <span style={{ padding: '1px 5px', borderRadius: 3, background: '#EF444430', color: '#EF4444', fontWeight: 800 }}>FATAL -{(f.bullish.components.blocker_severity_fatal ?? 0).toFixed(1)}</span>}
                  {(f.bullish.components.blocker_severity_medium ?? 0) > 0 && <span style={{ padding: '1px 5px', borderRadius: 3, background: '#F59E0B15', color: '#F59E0B', fontWeight: 700 }}>MED -{(f.bullish.components.blocker_severity_medium ?? 0).toFixed(1)}</span>}
                  {(f.bullish.components.blocker_severity_low ?? 0) > 0 && <span style={{ padding: '1px 5px', borderRadius: 3, background: '#94A3B815', color: '#94A3B8', fontWeight: 700 }}>LOW -{(f.bullish.components.blocker_severity_low ?? 0).toFixed(1)}</span>}
                </div>
                <div style={{ fontSize: 9, color: '#6B7A8D', marginTop: 3, fontStyle: 'italic' }}>
                  Formula: positive − (blockers × 0.65) · blockers deduped per tag · ULTRA requires 0 red flags · score capped at 6 without earnings anchor
                </div>
              </div>
              {/* PATCH 0395 — Traceability footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: '#6B7A8D', marginTop: 6 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span title="Filing timestamp (ISO)">{new Date(f.filing_datetime).toLocaleString()}</span>
                  {f.pdf_pages != null && <span title="PDF page count">📄 {f.pdf_pages}p</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {f.attachment_urls.slice(0, 2).map((u, j) => (
                    <a key={j} href={u} target="_blank" rel="noopener noreferrer" style={{ color: '#22D3EE', textDecoration: 'none' }}>📎 attachment</a>
                  ))}
                  <a href={f.source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#22D3EE', textDecoration: 'none' }}>↗ {f.exchange} filing</a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length > 50 && (
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>… {filtered.length - 50} more (showing top 50 by score)</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0390 — WARRANT MOMENTUM INTELLIGENCE
// Separate intelligence lane. Warrants are slow-moving structural signals
// vs concall's short-term narrative — different alpha category.
// ═══════════════════════════════════════════════════════════════════════════

interface WarrantFiling {
  exchange: 'NSE' | 'BSE';
  symbol: string;
  company_name: string;
  subject: string;
  filing_datetime: string;
  attachment_urls: string[];
  source_url: string;
  warrant_type: string;
  details: {
    issue_price: number | null;
    warrant_count: number | null;
    conversion_period_months: number | null;
    promoter_participation_pct: number | null;
    total_size_cr: number | null;
    is_promoter_subscribed: boolean;
  };
  price: { cmp: number | null; perf_90d_pct: number | null; perf_52w_high_pct: number | null };
  conviction: {
    conviction: number;
    raw_score: number;
    passes_gate: boolean;
    signals: string[];
    red_flags: string[];
    components: {
      promoter_participation: number;
      pricing_premium: number;
      business_momentum: number;
      breakout_relative_strength: number;
      history_boost: number;
      governance_penalty: number;
    };
    premium_pct: number | null;
    history_summary?: string;
  };
  business_momentum_score: number | null;
  prior_warrants: Array<{ date: string; price_at_filing: number | null; current_perf_pct: number | null }>;
}

interface WarrantFeedPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_passing: number;
  filings: WarrantFiling[];
  sources: { nse: string; bse: string };
}

function WarrantMomentumFeed() {
  const [data, setData] = useState<WarrantFeedPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passingOnly, setPassingOnly] = useState(true);
  const [days, setDays] = useState(7);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchFeed = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        days: String(days),
        threshold: passingOnly ? '8' : '0',
        ...(passingOnly ? { passingOnly: '1' } : {}),
        ...(force ? { force: '1' } : {}),
      });
      const res = await fetch(`/api/v1/concall-intel/warrant-feed?${params}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = await res.json();
      setData(j);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed();
    // Warrants are slow-moving — refresh every 15 min
    const t = setInterval(() => fetchFeed(), 15 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, passingOnly]);

  return (
    <div style={{ backgroundColor: '#0D1623', border: '1px solid #A78BFA40', borderLeft: '4px solid #A78BFA', borderRadius: 10, padding: '14px 18px', marginBottom: 14, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#A78BFA', letterSpacing: '0.4px' }}>🚀 WARRANT MOMENTUM — promoter warrants + post-breakout + business momentum</div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
            {data ? (
              <>
                {data.count_total} filings · {data.count_relevant} warrant-related · <strong style={{ color: '#10B981' }}>{data.count_passing} passing strict gate (≥8/10)</strong>
                {lastRefresh && <> · refreshed {lastRefresh.toLocaleTimeString()}</>}
              </>
            ) : loading ? 'Loading…' : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setPassingOnly(v => !v)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: `1px solid ${passingOnly ? '#10B981' : '#1A2540'}`, background: passingOnly ? '#10B98120' : 'transparent', color: passingOnly ? '#10B981' : '#94A3B8', cursor: 'pointer' }}>
            ★ High conviction only {passingOnly ? '✓' : ''}
          </button>
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid #1A2540', background: '#0A1422', color: '#E6EDF3' }}>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
          <button onClick={() => fetchFeed(true)} disabled={loading} style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 5, border: '1px solid #A78BFA', background: '#A78BFA20', color: '#A78BFA', cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* PATCH 0420 — Suppress red HTTP 500 chip when warrant data is loaded */}
      {error && (!data || data.count_total === 0) && (
        <div style={{ fontSize: 11, color: '#EF4444', marginBottom: 8 }}>⚠ {error}</div>
      )}
      {error && data && data.count_total > 0 && (
        <div style={{ fontSize: 10, color: '#F59E0B', marginBottom: 8, fontStyle: 'italic' }}>
          · last refresh slow ({error}); showing previous results
        </div>
      )}

      {data && data.filings.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic', padding: '12px 0' }}>
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
            border: '1px solid #F59E0B', background: '#F59E0B20', color: '#F59E0B',
            cursor: 'pointer', marginTop: 6,
          }}
        >
          → Show {data.count_relevant} below-threshold warrant filings (auto-relax gate)
        </button>
      )}

      {/* PATCH 0406 — Top 10 Ranked Warrants pinned panel.
          PATCH 0411 — Renders from `ranked_all` (full ranked list,
          unfiltered by passingOnly) so even when 0 pass the strict gate
          the user still sees a ranked shortlist of warrant filings in
          the window. */}
      {data && (() => {
        const source: any[] = (data as any).ranked_all && (data as any).ranked_all.length > 0
          ? (data as any).ranked_all
          : data.filings;
        if (!source || source.length === 0) return null;
        const ranked = [...source]
          .sort((a, b) => b.conviction.conviction - a.conviction.conviction)
          .slice(0, 10);
        return (
          <div style={{ marginBottom: 12, padding: 12, background: 'linear-gradient(135deg, #A78BFA10, #22D3EE10)', border: '1px solid #A78BFA50', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#A78BFA', letterSpacing: '0.5px' }}>★ TOP {ranked.length} RANKED — warrant conviction shortlist</div>
              <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>· window: last {days} day{days === 1 ? '' : 's'}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
              {ranked.map((r, i) => {
                const cv = r.conviction.conviction;
                const color = cv >= 8 ? '#10B981' : cv >= 5 ? '#22D3EE' : cv >= 3 ? '#F59E0B' : '#94A3B8';
                const prem = r.conviction.premium_pct;
                return (
                  <div key={r.symbol + '-warr-rank-' + i} style={{ padding: 10, background: '#0A1422', border: `1px solid ${color}50`, borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div>
                        <span style={{ fontSize: 9, color: '#A78BFA', fontWeight: 900, marginRight: 6 }}>#{i + 1}</span>
                        <span style={{ fontSize: 13, fontWeight: 900, color: '#E6EDF3' }}>{r.symbol || r.company_name}</span>
                      </div>
                      <span title={`Conviction = ${cv.toFixed(1)} / 10`} style={{ fontSize: 16, fontWeight: 900, color }}>{cv.toFixed(1)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 4 }}>{r.company_name}</div>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: 9 }}>
                      <span style={{ padding: '1px 5px', borderRadius: 3, background: `${color}20`, color, fontWeight: 800 }}>{r.warrant_type.replace(/_/g, ' ')}</span>
                      {r.conviction.passes_gate && <span style={{ padding: '1px 5px', borderRadius: 3, background: '#10B98125', color: '#10B981', fontWeight: 800 }}>★ GATE</span>}
                      {prem != null && <span style={{ padding: '1px 5px', borderRadius: 3, background: '#1A2540', color: prem >= 0 ? '#10B981' : prem >= -10 ? '#F59E0B' : '#EF4444' }}>{prem >= 0 ? '+' : ''}{prem.toFixed(1)}% vs CMP</span>}
                      {r.details.total_size_cr != null && <span style={{ padding: '1px 5px', borderRadius: 3, background: '#1A2540', color: '#C9D4E0' }}>₹{r.details.total_size_cr.toFixed(0)}Cr</span>}
                      {r.details.promoter_participation_pct != null && <span style={{ padding: '1px 5px', borderRadius: 3, background: '#10B98115', color: '#10B981' }}>Promo {r.details.promoter_participation_pct.toFixed(0)}%</span>}
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
            <div key={f.symbol + '-' + i} style={{ padding: '10px 12px', background: '#0A1422', border: `1px solid ${f.conviction.passes_gate ? '#10B98140' : '#1A2540'}`, borderLeft: `3px solid ${cvColor}`, borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: '#E6EDF3' }}>{f.symbol || f.company_name}</span>
                  {f.symbol && <span style={{ fontSize: 11, color: '#94A3B8' }}>{f.company_name}</span>}
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#1A2540', color: '#94A3B8', fontWeight: 700 }}>{f.exchange}</span>
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${cvColor}20`, color: cvColor, fontWeight: 700 }}>{f.warrant_type.replace(/_/g, ' ')}</span>
                  {f.conviction.passes_gate && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#10B98125', color: '#10B981', fontWeight: 800, border: '1px solid #10B981' }}>★ PASSES GATE</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: cvColor }}>{f.conviction.conviction.toFixed(1)}</span>
                  <span style={{ fontSize: 10, color: '#94A3B8' }}>/10</span>
                </div>
              </div>

              <div style={{ fontSize: 11, color: '#C9D4E0', marginBottom: 6, lineHeight: 1.4 }}>{f.subject}</div>

              {/* Key facts */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6, fontSize: 10 }}>
                {f.details.issue_price != null && (
                  <div><span style={{ color: '#94A3B8' }}>Issue:</span> <strong style={{ color: '#E6EDF3' }}>₹{f.details.issue_price.toFixed(0)}</strong></div>
                )}
                {f.price.cmp != null && (
                  <div><span style={{ color: '#94A3B8' }}>CMP:</span> <strong style={{ color: '#E6EDF3' }}>₹{f.price.cmp.toFixed(0)}</strong></div>
                )}
                {premium != null && (
                  <div><span style={{ color: '#94A3B8' }}>vs CMP:</span> <strong style={{ color: premiumColor }}>{premium >= 0 ? '+' : ''}{premium.toFixed(1)}%</strong></div>
                )}
                {f.details.total_size_cr != null && (
                  <div><span style={{ color: '#94A3B8' }}>Size:</span> <strong style={{ color: '#E6EDF3' }}>₹{f.details.total_size_cr.toFixed(0)}Cr</strong></div>
                )}
                {f.details.promoter_participation_pct != null && (
                  <div><span style={{ color: '#94A3B8' }}>Promoter:</span> <strong style={{ color: '#10B981' }}>{f.details.promoter_participation_pct.toFixed(0)}%</strong></div>
                )}
                {f.price.perf_52w_high_pct != null && (
                  <div><span style={{ color: '#94A3B8' }}>vs 52wH:</span> <strong style={{ color: f.price.perf_52w_high_pct >= -5 ? '#10B981' : '#94A3B8' }}>{f.price.perf_52w_high_pct.toFixed(1)}%</strong></div>
                )}
                {f.price.perf_90d_pct != null && (
                  <div><span style={{ color: '#94A3B8' }}>90d:</span> <strong style={{ color: f.price.perf_90d_pct >= 20 ? '#10B981' : f.price.perf_90d_pct >= 0 ? '#22D3EE' : '#EF4444' }}>{f.price.perf_90d_pct >= 0 ? '+' : ''}{f.price.perf_90d_pct.toFixed(0)}%</strong></div>
                )}
                {f.business_momentum_score != null && (
                  <div><span style={{ color: '#94A3B8' }}>Momentum:</span> <strong style={{ color: f.business_momentum_score >= 6 ? '#10B981' : '#94A3B8' }}>{f.business_momentum_score.toFixed(1)}/10</strong></div>
                )}
              </div>

              {/* Signals + risks */}
              {f.conviction.signals.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#10B981', fontWeight: 700, marginRight: 4 }}>WHY:</span>
                  {f.conviction.signals.slice(0, 5).map((s, j) => (
                    <span key={j} style={{ fontSize: 10, color: '#C9D4E0', marginRight: 8 }}>› {s}</span>
                  ))}
                </div>
              )}
              {f.conviction.red_flags.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 700, marginRight: 4 }}>RISKS:</span>
                  {f.conviction.red_flags.slice(0, 3).map((s, j) => (
                    <span key={j} style={{ fontSize: 10, color: '#C9D4E0', marginRight: 8 }}>› {s}</span>
                  ))}
                </div>
              )}

              {/* Historical memory */}
              {f.conviction.history_summary && (
                <div style={{ marginTop: 4, fontSize: 10, color: '#A78BFA', fontStyle: 'italic' }}>
                  📜 {f.conviction.history_summary}
                </div>
              )}

              {/* PATCH 0395 — Warrant scoring transparency: full component breakdown */}
              <div style={{ marginTop: 6, padding: '6px 8px', background: '#13131a', border: '1px solid #1A2540', borderRadius: 4 }}>
                <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 700, marginBottom: 3, letterSpacing: '0.4px' }}>SCORE DECOMPOSITION (raw {f.conviction.raw_score.toFixed(1)} / 10)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 9 }}>
                  <span title="Promoter / promoter-group participation (0-3, MANDATORY)" style={{ padding: '1px 5px', borderRadius: 3, background: '#10B98115', color: '#10B981', fontWeight: 700 }}>Promoter {f.conviction.components.promoter_participation.toFixed(1)}/3</span>
                  <span title="Issue price vs CMP. Premium = good (+3), -10% OK (+1), deeper discount = bad" style={{ padding: '1px 5px', borderRadius: 3, background: '#22D3EE15', color: '#22D3EE', fontWeight: 700 }}>Pricing {f.conviction.components.pricing_premium >= 0 ? '+' : ''}{f.conviction.components.pricing_premium.toFixed(1)}</span>
                  <span title="Near 52w high or strong 90d perf = +2; weak structure = -" style={{ padding: '1px 5px', borderRadius: 3, background: '#A78BFA15', color: '#A78BFA', fontWeight: 700 }}>Breakout {f.conviction.components.breakout_relative_strength.toFixed(1)}/2</span>
                  <span title="Concall bullish score: ≥6 = +2; 4-6 = +1; <2 = negative" style={{ padding: '1px 5px', borderRadius: 3, background: '#F59E0B15', color: '#F59E0B', fontWeight: 700 }}>Momentum {f.conviction.components.business_momentum.toFixed(1)}/2</span>
                  {f.conviction.components.history_boost > 0 && <span title="Prior warrants rallied ≥25% = boost" style={{ padding: '1px 5px', borderRadius: 3, background: '#10B98115', color: '#10B981', fontWeight: 700 }}>History +{f.conviction.components.history_boost.toFixed(1)}</span>}
                  {f.conviction.components.governance_penalty < 0 && <span title="Microcap / pledge / dilution pattern penalty" style={{ padding: '1px 5px', borderRadius: 3, background: '#EF444415', color: '#EF4444', fontWeight: 700 }}>Govern {f.conviction.components.governance_penalty.toFixed(1)}</span>}
                </div>
                <div style={{ fontSize: 9, color: '#6B7A8D', marginTop: 3, fontStyle: 'italic' }}>
                  Gate (≥ 8/10): A) promoter present · B) pricing ≥ -10% · C) no critical governance · D) breakout OR momentum present
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: '#6B7A8D', marginTop: 6 }}>
                <span>{new Date(f.filing_datetime).toLocaleString()}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {f.attachment_urls.slice(0, 2).map((u, j) => (
                    <a key={j} href={u} target="_blank" rel="noopener noreferrer" style={{ color: '#22D3EE', textDecoration: 'none' }}>📎 attachment</a>
                  ))}
                  <a href={f.source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#22D3EE', textDecoration: 'none' }}>↗ {f.exchange} filing</a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0394 — KEYWORD WATCH FEED (third intelligence lane)
// User-defined keyword/phrase watchlist scanning all concall PDFs.
// ═══════════════════════════════════════════════════════════════════════════

interface KeywordSpec {
  id: string; display: string; group: string; sentiment: string;
}
interface KeywordHit {
  keyword_id: string; display: string; group: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  sentence: string;
}
interface KwWatchFiling {
  exchange: 'NSE' | 'BSE';
  symbol: string;
  company_name: string;
  subject: string;
  filing_datetime: string;
  attachment_urls: string[];
  source_url: string;
  filing_type: string;
  hits: KeywordHit[];
  hit_keywords: string[];
  hit_groups: string[];
  hit_count: number;
}
interface KwWatchPayload {
  generated_at: string;
  count_total: number;
  count_relevant: number;
  count_matched: number;
  filings: KwWatchFiling[];
  totals: {
    total_hits: number;
    by_group: Record<string, number>;
    by_sentiment: Record<string, number>;
  };
  sources: { nse: string; bse: string };
  catalog: KeywordSpec[];
}

const KW_GROUP_COLORS: Record<string, string> = {
  RISK: '#EF4444',
  OPPORTUNITY: '#10B981',
  THEME: '#A78BFA',
  REGULATORY: '#F59E0B',
  SECTOR: '#22D3EE',
};

function KeywordWatchFeed() {
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
    try {
      const params = new URLSearchParams({
        days: String(days),
        ...(selectedKeywords.size > 0 ? { keywords: Array.from(selectedKeywords).join(',') } : {}),
        ...(selectedGroups.size > 0 ? { groups: Array.from(selectedGroups).join(',') } : {}),
        ...(force ? { force: '1' } : {}),
      });
      const res = await fetch(`/api/v1/concall-intel/keyword-watch?${params}`, { cache: 'no-store' });
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      const j = await res.json();
      setData(j);
      setLastRefresh(new Date());
    } catch (e: any) { setError(e?.message || 'fetch failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchFeed();
    const t = setInterval(() => fetchFeed(), 5 * 60 * 1000);
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
    <div style={{ backgroundColor: '#0D1623', border: '1px solid #22D3EE40', borderLeft: '4px solid #22D3EE', borderRadius: 10, padding: '14px 18px', marginBottom: 14, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#22D3EE', letterSpacing: '0.4px' }}>🔎 KEYWORD WATCH — scan every concall for theme / risk / regulatory phrases</div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
            {data ? (
              <>
                {data.count_relevant} concall-relevant · <strong style={{ color: '#22D3EE' }}>{data.count_matched} matched</strong> · {data.totals.total_hits} total hits ·
                {' '}<span style={{ color: '#EF4444' }}>{data.totals.by_group.RISK || 0} RISK</span> ·
                {' '}<span style={{ color: '#10B981' }}>{data.totals.by_group.OPPORTUNITY || 0} OPP</span> ·
                {' '}<span style={{ color: '#A78BFA' }}>{data.totals.by_group.THEME || 0} THEME</span> ·
                {' '}<span style={{ color: '#F59E0B' }}>{data.totals.by_group.REGULATORY || 0} REG</span> ·
                {' '}<span style={{ color: '#22D3EE' }}>{data.totals.by_group.SECTOR || 0} SECTOR</span>
                {lastRefresh && <> · refreshed {lastRefresh.toLocaleTimeString()}</>}
              </>
            ) : loading ? 'Loading…' : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setShowCatalog(v => !v)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: '1px solid #22D3EE', background: '#22D3EE20', color: '#22D3EE', cursor: 'pointer' }}>
            {showCatalog ? '▲ Hide keywords' : '▼ Edit watchlist'}
          </button>
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid #1A2540', background: '#0A1422', color: '#E6EDF3' }}>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
          <button onClick={() => fetchFeed(true)} disabled={loading} style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 5, border: '1px solid #22D3EE', background: '#22D3EE20', color: '#22D3EE', cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Group filter row — always visible */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700, marginRight: 4 }}>GROUPS:</span>
        {Object.keys(KW_GROUP_COLORS).map(g => {
          const active = selectedGroups.has(g);
          const color = KW_GROUP_COLORS[g];
          const count = data?.totals.by_group[g] || 0;
          return (
            <button key={g} onClick={() => toggleGroup(g)} style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 5, border: `1px solid ${active ? color : '#1A2540'}`, background: active ? `${color}20` : 'transparent', color: active ? color : '#94A3B8', cursor: 'pointer' }}>
              {g} · {count}
            </button>
          );
        })}
        {selectedGroups.size > 0 && (
          <button onClick={() => setSelectedGroups(new Set())} style={{ fontSize: 10, color: '#94A3B8', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            clear groups
          </button>
        )}
      </div>

      {/* Keyword catalog editor (collapsible) */}
      {showCatalog && (
        <div style={{ marginBottom: 10, padding: 10, background: '#0A1422', border: '1px solid #1A2540', borderRadius: 6 }}>
          <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 6 }}>Click keywords to filter. Empty = all keywords active. {selectedKeywords.size > 0 && <button onClick={() => setSelectedKeywords(new Set())} style={{ fontSize: 10, color: '#22D3EE', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>clear all</button>}</div>
          {Object.entries(groupedCatalog).map(([group, kws]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: KW_GROUP_COLORS[group] || '#94A3B8', letterSpacing: '0.5px', marginBottom: 4 }}>{group}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {kws.map(k => {
                  const active = selectedKeywords.has(k.id);
                  const color = KW_GROUP_COLORS[group] || '#94A3B8';
                  return (
                    <button key={k.id} onClick={() => toggleKeyword(k.id)} style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, border: `1px solid ${active ? color : '#1A2540'}`, background: active ? `${color}20` : 'transparent', color: active ? color : '#94A3B8', cursor: 'pointer' }}>
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
        <div style={{ fontSize: 11, color: '#EF4444', marginBottom: 8 }}>⚠ {error}</div>
      )}
      {error && data && (data.filings?.length || 0) > 0 && (
        <div style={{ fontSize: 10, color: '#F59E0B', marginBottom: 8, fontStyle: 'italic' }}>
          · last refresh slow ({error}); showing previous results
        </div>
      )}

      {data && data.filings.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic', padding: '12px 0' }}>
          No matches for selected keywords / groups in last {days} days. Try widening the window or selecting different groups.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(data?.filings || []).slice(0, 60).map((f, i) => (
          <div key={f.symbol + '-' + i} style={{ padding: '10px 12px', background: '#0A1422', border: '1px solid #1A2540', borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#E6EDF3' }}>{f.symbol || f.company_name}</span>
                {f.symbol && <span style={{ fontSize: 11, color: '#94A3B8' }}>{f.company_name}</span>}
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#1A2540', color: '#94A3B8', fontWeight: 700 }}>{f.exchange}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 900, color: '#22D3EE' }}>{f.hit_count} hit{f.hit_count > 1 ? 's' : ''}</span>
            </div>
            <div style={{ fontSize: 11, color: '#C9D4E0', marginBottom: 6, lineHeight: 1.4 }}>{f.subject}</div>
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
                  <div key={j} style={{ padding: '2px 0', color: '#C9D4E0' }}>
                    › <span style={{ color: c, fontWeight: 700 }}>[{h.display}]</span> &ldquo;{h.sentence}&rdquo;
                  </div>
                );
              })}
              {f.hits.length > 5 && <div style={{ color: '#94A3B8', fontStyle: 'italic', padding: '2px 0' }}>+ {f.hits.length - 5} more matches</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: '#6B7A8D', marginTop: 6 }}>
              <span>{new Date(f.filing_datetime).toLocaleString()}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {f.attachment_urls.slice(0, 1).map((u, j) => (
                  <a key={j} href={u} target="_blank" rel="noopener noreferrer" style={{ color: '#22D3EE', textDecoration: 'none' }}>📎 attachment</a>
                ))}
                <a href={f.source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#22D3EE', textDecoration: 'none' }}>↗ {f.exchange}</a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0400 — MOVERS PANEL (daily delta detection)
// ═══════════════════════════════════════════════════════════════════════════

interface MoverEntry {
  symbol: string;
  company_name: string;
  tier: string;
  composite_today: number;
  composite_yesterday: number | null;
  delta: number | null;
  rank_today: number;
  rank_yesterday: number | null;
}
interface MoversPayload {
  generated_at: string;
  today_date: string;
  reference_date: string | null;
  new_entries: MoverEntry[];
  big_jumps: MoverEntry[];
  lost_momentum: MoverEntry[];
  ranking_today: MoverEntry[];
}

function MoversPanel() {
  const [data, setData] = useState<MoversPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/v1/concall-intel/movers', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (mounted) setData(j);
      } catch {} finally { if (mounted) setLoading(false); }
    };
    load();
    const t = setInterval(load, 15 * 60 * 1000);
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
            <div key={m.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 6px', borderRadius: 4, marginBottom: 3, background: '#0A1422', border: `1px solid ${tc}30`, fontSize: 11 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
                <span style={{ fontWeight: 800, color: '#E6EDF3' }}>{m.symbol}</span>
                <span style={{ color: '#94A3B8', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.company_name}</span>
              </div>
              <div style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
                {m.delta != null && (
                  <span style={{ fontSize: 9, color: m.delta > 0 ? '#10B981' : m.delta < 0 ? '#EF4444' : '#94A3B8', fontWeight: 700 }}>
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
    <div style={{ backgroundColor: '#0D1623', border: '1px solid #A78BFA40', borderLeft: '4px solid #A78BFA', borderRadius: 10, padding: '14px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#A78BFA', letterSpacing: '0.4px' }}>📈 MOVERS — daily delta vs last snapshot</div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
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
