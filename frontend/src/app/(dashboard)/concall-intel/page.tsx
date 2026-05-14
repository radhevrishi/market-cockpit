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
    tier?: 'ULTRA_BULLISH' | 'BULLISH' | 'MIXED_POSITIVE' | 'NEUTRAL' | 'BEARISH' | 'INSUFFICIENT';  // PATCH 0391
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
  const [bullishOnly, setBullishOnly] = useState(true);
  const [exchange, setExchange] = useState<'ALL' | 'NSE' | 'BSE'>('ALL');
  const [days, setDays] = useState(2);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // PATCH 0391 — tier filter chips
  const [tierFilter, setTierFilter] = useState<Set<string>>(new Set(['ULTRA_BULLISH', 'BULLISH', 'MIXED_POSITIVE']));
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
    const counts: Record<string, number> = { ULTRA_BULLISH: 0, BULLISH: 0, MIXED_POSITIVE: 0, NEUTRAL: 0, BEARISH: 0 };
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
                {data.count_total} total · {data.count_relevant} concall-relevant · <strong style={{ color: '#10B981' }}>{data.count_high_bullish} high bullish</strong> · sources: NSE <strong style={{ color: data.sources.nse === 'NSE_OK' ? '#10B981' : '#EF4444' }}>{data.sources.nse}</strong> · BSE <strong style={{ color: data.sources.bse === 'BSE_OK' ? '#10B981' : '#94A3B8' }}>{data.sources.bse}</strong>
                {lastRefresh && <> · refreshed {lastRefresh.toLocaleTimeString()}</>}
              </>
            ) : loading ? 'Loading…' : '—'}
          </div>
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
          </select>
          <button onClick={() => fetchFeed(true)} disabled={loading} style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 5, border: '1px solid #22D3EE', background: '#22D3EE20', color: '#22D3EE', cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: 11, color: '#EF4444', marginBottom: 8 }}>⚠ {error}</div>}

      {/* PATCH 0391 — Tier filter chips */}
      {data && bullishOnly && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            { id: 'ULTRA_BULLISH',  label: '🚀 Ultra Bullish',    color: '#22D3EE' },
            { id: 'BULLISH',        label: '🟢 Bullish',           color: '#10B981' },
            { id: 'MIXED_POSITIVE', label: '🟡 Mixed Positive',    color: '#F59E0B' },
            { id: 'NEUTRAL',        label: '⚪ Neutral',            color: '#94A3B8' },
            { id: 'BEARISH',        label: '🔴 Bearish',           color: '#EF4444' },
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
                  <span style={{ fontSize: 16, fontWeight: 900, color: scoreColor }}>{f.bullish.raw_score.toFixed(1)}</span>
                  <span style={{ fontSize: 10, color: '#94A3B8' }}>· {f.bullish.confidence}</span>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: '#6B7A8D' }}>
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
          </select>
          <button onClick={() => fetchFeed(true)} disabled={loading} style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 5, border: '1px solid #A78BFA', background: '#A78BFA20', color: '#A78BFA', cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: 11, color: '#EF4444', marginBottom: 8 }}>⚠ {error}</div>}

      {data && data.filings.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic', padding: '12px 0' }}>
          {data.count_relevant > 0
            ? `No warrants passing the strict gate in current filter. Total relevant: ${data.count_relevant}. Toggle "High conviction only" off to inspect.`
            : 'No warrant filings detected yet. Try widening the date range.'}
        </div>
      )}

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

      {error && <div style={{ fontSize: 11, color: '#EF4444', marginBottom: 8 }}>⚠ {error}</div>}

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
