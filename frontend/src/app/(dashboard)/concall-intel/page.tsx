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
    confidence: string;
    tags: string[];
    bullish_phrases: string[];
    red_flags: string[];
    components: { management_confidence: number; business_evidence: number; blockers: number };
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
    if (bullishOnly) out = out.filter(f => f.is_high_bullish);
    return out;
  }, [data, exchange, bullishOnly]);

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
          </select>
          <button onClick={() => fetchFeed(true)} disabled={loading} style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 5, border: '1px solid #22D3EE', background: '#22D3EE20', color: '#22D3EE', cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: 11, color: '#EF4444', marginBottom: 8 }}>⚠ {error}</div>}

      {filtered.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic', padding: '12px 0' }}>
          {data && data.count_relevant > 0
            ? `No high-bullish filings in current filter. Total relevant: ${data.count_relevant}. Try toggling "Bullish only" off or expanding the date range.`
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
                  {f.is_high_bullish && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#10B98125', color: '#10B981', fontWeight: 800, border: '1px solid #10B981' }}>★ HIGH BULLISH</span>}
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
