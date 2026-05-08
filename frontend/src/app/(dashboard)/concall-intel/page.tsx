'use client';

import React, { useEffect, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

// ─────────────────────────────────────────────────────────────────────────
// CONCALL INTEL — guidance credibility tracker
//
// Stores every concall extraction we've ever produced (per ticker, per
// period) and surfaces:
//   - Guidance history: what management said by quarter
//   - Contradiction detection: did Q-1 guidance match Q outcome?
//   - Credibility score: track record across multiple cycles
//
// MVP: read concall history from /api/concall/history. As more transcripts
// are uploaded over time the contradiction engine becomes more useful.
// ─────────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  period: string;
  capturedAt: string;
  concallScore: number;
  concallGrade: string;
  positiveCount: number;
  negativeCount: number;
  cautiousCount: number;
  guidanceDirection: string;
  guidanceCommentary: string[];
  topQuotes: string[];
  actualRevenue?: number | null;
  actualPat?: number | null;
}

export default function ConcallIntelPage() {
  const { palette } = useTheme();
  const [ticker, setTicker] = useState('');
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!ticker.trim()) return;
    setLoading(true); setError(''); setHistory(null);
    try {
      const res = await fetch(`/api/concall/history?ticker=${encodeURIComponent(ticker.trim().toUpperCase())}`);
      const json = await res.json();
      if (!json.ok) setError(json.error || 'No history');
      else setHistory(json.history || []);
    } catch (e: any) {
      setError(e?.message || 'Fetch failed');
    }
    setLoading(false);
  };

  // Build credibility score: across stored snapshots, count how many
  // 'raised' or 'introduced' guidance announcements were followed by
  // weak negative signals in the next snapshot.
  const credibility = history && history.length >= 2 ? (() => {
    let aligned = 0;
    let contradictions = 0;
    for (let i = 0; i < history.length - 1; i++) {
      const prev = history[i + 1]; // older
      const curr = history[i];     // newer
      const guidedPositive = prev.guidanceDirection === 'raised' || prev.guidanceDirection === 'introduced' || prev.positiveCount > prev.negativeCount + prev.cautiousCount;
      const deliveredPositive = curr.concallScore >= 60 && curr.negativeCount <= curr.positiveCount;
      if (guidedPositive && deliveredPositive) aligned++;
      else if (guidedPositive && !deliveredPositive) contradictions++;
      else if (!guidedPositive && deliveredPositive) {} // surprise upside
      else aligned++; // both negative — at least consistent
    }
    const credibilityScore = aligned + contradictions > 0 ? Math.round((aligned / (aligned + contradictions)) * 100) : 50;
    return { score: credibilityScore, aligned, contradictions };
  })() : null;

  return (
    <div style={{ background: palette.BG, minHeight: '100vh', padding: '24px 20px', maxWidth: 1100, margin: '0 auto', color: palette.TEXT, fontFamily: palette.FONT }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Concall Intelligence</h1>
      <div style={{ fontSize: 12, color: palette.MUTED, marginTop: 4, marginBottom: 18 }}>
        Per-ticker guidance history + contradiction detection. Each concall you upload via Earnings AI is stored here so we can compare what management said in Q-1 vs what actually happened in Q.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          placeholder="e.g. BAJAJCON.NS"
          style={{ flex: 1, padding: '10px 14px', background: palette.BG2, color: palette.TEXT, border: `1px solid ${palette.BORDER2}`, borderRadius: 6 }}
        />
        <button onClick={load} disabled={loading || !ticker.trim()}
          style={{ padding: '10px 18px', background: palette.ACCENT, color: palette.BG, border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>

      {error && <div style={{ color: palette.ORANGE, fontSize: 12, marginBottom: 12 }}>⚠ {error}</div>}

      {history !== null && history.length === 0 && (
        <div style={{ background: palette.PANEL, border: `1px solid ${palette.BORDER}`, borderRadius: 8, padding: 16, fontSize: 12, color: palette.MUTED }}>
          No concall history stored yet. Upload a transcript on the <a href="/earnings-analysis" style={{ color: palette.ACCENT }}>Earnings AI</a> page and it'll be archived here automatically. After 2+ quarters, the Contradiction Engine will compare guidance vs outcome.
        </div>
      )}

      {history && history.length > 0 && (
        <>
          {credibility && (
            <div style={{ background: palette.PANEL, border: `1px solid ${palette.BORDER}`, borderLeft: `3px solid ${palette.ACCENT}`, borderRadius: 8, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: palette.MUTED, textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: 700 }}>Management Credibility</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }}>
                <div style={{ fontSize: 32, fontWeight: 800, fontFamily: palette.MONO, color: credibility.score >= 70 ? palette.GREEN : credibility.score >= 50 ? palette.ACCENT : palette.RED }}>
                  {credibility.score}<span style={{ fontSize: 13, color: palette.MUTED }}>/100</span>
                </div>
                <div style={{ flex: 1, fontSize: 12, color: palette.TEXT }}>
                  {credibility.aligned} aligned · {credibility.contradictions} contradiction{credibility.contradictions === 1 ? '' : 's'} across {history.length - 1} guidance/outcome pair{history.length - 1 === 1 ? '' : 's'}.
                  <div style={{ fontSize: 10, color: palette.MUTED, marginTop: 4 }}>
                    Score = aligned / (aligned + contradictions). Tracks whether positive guidance was followed by positive results.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map((h) => (
              <div key={h.period + h.capturedAt} style={{ background: palette.PANEL, border: `1px solid ${palette.BORDER}`, borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: palette.TEXT }}>{h.period}</div>
                    <div style={{ fontSize: 10, color: palette.MUTED }}>captured {new Date(h.capturedAt).toLocaleDateString()}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, fontFamily: palette.MONO }}>
                    <span style={{ color: palette.ACCENT, fontWeight: 700 }}>Score {h.concallScore}/100 · {h.concallGrade}</span>
                    <span style={{ color: palette.GREEN }}>+{h.positiveCount}</span>
                    <span style={{ color: palette.ACCENT }}>~{h.cautiousCount}</span>
                    <span style={{ color: palette.RED }}>−{h.negativeCount}</span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: palette.MUTED, marginBottom: 6 }}>
                  Guidance direction: <strong style={{ color: palette.TEXT, textTransform: 'uppercase' }}>{h.guidanceDirection}</strong>
                </div>
                {h.guidanceCommentary.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: palette.TEXT, lineHeight: 1.6 }}>
                    {h.guidanceCommentary.slice(0, 3).map((c, i) => <li key={i} style={{ fontStyle: 'italic' }}>{c}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
