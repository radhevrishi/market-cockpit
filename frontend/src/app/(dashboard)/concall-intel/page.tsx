'use client';

// ═══════════════════════════════════════════════════════════════════════════
// CONCALL INTELLIGENCE ENGINE v2 (PATCH 0107 / 0171)
//
// Paste a concall transcript (or supply a PDF URL) and get structured
// analysis: tone score, guidance map, key themes, red flags, key numbers.
// Pure heuristic — runs entirely on Vercel, no LLM dependency.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';

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
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, marginBottom: 6 }}>🎙️ Concall Intelligence v2</h1>
      <p style={{ fontSize: 12, color: '#94A3B8', margin: 0, marginBottom: 18 }}>
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
