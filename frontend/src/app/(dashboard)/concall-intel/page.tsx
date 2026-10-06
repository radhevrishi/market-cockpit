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

import { useState, useEffect } from 'react';
import type { Analysis } from './types';
import { LiveBullishFeed } from './LiveBullishFeed';
import { WarrantMomentumFeed } from './WarrantMomentumFeed';
import { KeywordWatchFeed, MoversPanel } from './components';
import { ConcallAnalyticsTab } from './ConcallAnalyticsTab';
import { TransformationRadar, TransformationFrameworkTab, TransformationScreenerTab } from './components2';
import { comparePriorCall, type ConcallCorpus } from '@/lib/concall-prior-compare'; // zzz904

export default function ConcallIntelPage() {
  const [ticker, setTicker] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  // zzz904 — corpus key of the analysis on screen, so the 'vs previous call' lookup never compares a call with itself.
  const [resultKey, setResultKey] = useState<string | null>(null);
  // AUDIT_100 #36 — phase hint during 65s spinner. Approximate timing based on
  // observed Vercel serverless behaviour for the existing route (download
  // → extract → analyze). Pure client-side timer; no SSE wiring required.
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!loading) { setElapsedSec(0); return; }
    const t = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);
  const progressHint = !loading ? '' :
    elapsedSec < 8 ? 'Downloading PDF…' :
    elapsedSec < 25 ? 'Extracting text…' :
    elapsedSec < 50 ? 'Scoring tone + extracting cues…' :
    'Finalising… (almost there)';

  // AUDIT_100 #61 — persistent corpus of last 25 analyses. Saves the user a
  // 65s wait when comparing two transcripts. Cache key is a 32-bit hash of
  // the input (ticker + pdfUrl + transcript). Bypass with Force Reanalyze.
  const CORPUS_KEY = 'mc:concall-corpus:v1';
  const hashInput = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h.toString(36);
  };
  const loadCorpus = (): Record<string, { result: Analysis; ticker: string; ts: number }> => {
    try { return JSON.parse(localStorage.getItem(CORPUS_KEY) || '{}'); } catch { return {}; }
  };
  const saveCorpus = (entry: Analysis) => {
    try {
      const corpus = loadCorpus();
      const key = hashInput(`${ticker}|${pdfUrl}|${transcript.slice(0, 500)}`);
      corpus[key] = { result: entry, ticker, ts: Date.now() };
      // Keep last 25 by timestamp
      const entries = Object.entries(corpus).sort((a, b) => b[1].ts - a[1].ts).slice(0, 25);
      const trimmed: typeof corpus = {};
      for (const [k, v] of entries) trimmed[k] = v;
      localStorage.setItem(CORPUS_KEY, JSON.stringify(trimmed));
    } catch {}
  };

  const analyze = async (force = false) => {
    setError(null);
    setResult(null);
    // AUDIT_100 #61 — cache hit check
    if (!force) {
      const corpus = loadCorpus();
      const key = hashInput(`${ticker}|${pdfUrl}|${transcript.slice(0, 500)}`);
      if (corpus[key]) {
        setResult(corpus[key].result);
        setResultKey(key);
        return;
      }
    }
    setLoading(true);
    // PATCH 0466 — 65s timeout (Vercel maxDuration on the route is 60s,
    // so 65s gives a buffer before client gives up). Previously the
    // fetch was unbounded and could hang the spinner indefinitely on
    // network issues.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 65_000);
    try {
      const res = await fetch('/api/v1/concall/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, pdf_url: pdfUrl, transcript }),
        signal: ctl.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || `HTTP ${res.status}`);
        return;
      }
      const j = await res.json();
      setResult(j);
      setResultKey(hashInput(`${ticker}|${pdfUrl}|${transcript.slice(0, 500)}`));
      saveCorpus(j);
    } catch (e: any) {
      setError(e?.name === 'AbortError' ? 'Request timed out after 65s' : (e?.message || 'fetch failed'));
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  // zzz904 — compare with the same company's earlier analysed call when one is on file; otherwise say so.
  const prior = (() => {
    if (!result) return null;
    let corpus: ConcallCorpus = {};
    try { corpus = JSON.parse(localStorage.getItem(CORPUS_KEY) || '{}'); } catch { /* empty corpus */ }
    return comparePriorCall(result, corpus, resultKey);
  })();

  const toneColor = (s: number) => s >= 70 ? '#10B981' : s >= 55 ? '#22D3EE' : s >= 40 ? '#F59E0B' : s >= 25 ? '#F97316' : '#EF4444';

  // PATCH 0592 — Tab system. User requested a dedicated Analytics view
  // separate from the Live feeds. Live tab keeps every existing
  // surface untouched; Analytics tab mounts a brand-new component that
  // fetches all 4 endpoints and renders an institutional-format
  // consolidated dashboard.
  const [tab, setTab] = useState<'live' | 'analytics' | 'transform' | 'radar'>('live');
  // zzz433 — honor ?tab= deep-link (e.g. Daily Signal Inbox → /concall-intel?tab=radar)
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('tab');
      if (q === 'radar' || q === 'transform' || q === 'analytics' || q === 'live') setTab(q);
    } catch { /* noop */ }
  }, []);

  return (
    <div style={{ padding: '20px 24px', backgroundColor: 'var(--mc-bg-0)', minHeight: '100%', color: 'var(--mc-text-1)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, marginBottom: 6 }}>🎙️ Concall Intelligence v3</h1>
      <p style={{ fontSize: 12, color: 'var(--mc-text-3)', margin: 0, marginBottom: 10 }}>
        🔥 LIVE bullish NSE/BSE concall + investor-presentation filings (auto-poll). ⬇️ Plus manual transcript / PDF analyser below.
      </p>

      {/* PATCH 1057 — The Earnings Blockbuster checklist. The 13 dimensions
          that compound into a multibagger. Use this row as the mental model
          while reading any concall. Order = importance (Guidance + Margins
          are the leading indicators; Valuation gates entry; Promoter Quality
          gates everything). */}
      <div style={{
        background: 'linear-gradient(90deg, rgba(46,160,67,0.08) 0%, rgba(245,158,11,0.06) 100%)',
        border: '1px solid var(--mc-bg-4)',
        borderLeft: '3px solid var(--mc-bullish-2)',
        borderRadius: 6,
        padding: '8px 12px',
        marginBottom: 14,
        fontSize: 11,
        color: 'var(--mc-text-2)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        lineHeight: 1.7,
      }}>
        <span style={{ fontWeight: 800, color: 'var(--mc-bullish-2)', letterSpacing: 0.3 }}>📌 EARNINGS BLOCKBUSTER CHECKLIST</span>
        <span style={{ color: 'var(--mc-text-4)', margin: '0 4px' }}>›</span>
        {[
          ['Good Guidance', '#2EA043'],
          ['Margins ↑', '#2EA043'],
          ['Theme', '#3B82F6'],
          ['Concall Tone', '#3B82F6'],
          ['Capex Cycle', '#F59E0B'],
          ['Pricing Power', '#F59E0B'],
          ['CFO/PAT ≥ 0.8', '#2EA043'],
          ['ROCE ≥ 18%', '#2EA043'],
          ['Low Leverage', '#94A3B8'],
          ['Moat', '#94A3B8'],
          ['Valuation Gate', '#EF4444'],
          ['Promoter Quality', '#94A3B8'],
          ['Operating Leverage', '#F59E0B'],
        ].map(([label, color], i) => (
          <span
            key={i}
            style={{
              border: `1px solid ${color}55`,
              background: `${color}15`,
              color: color,
              padding: '2px 8px',
              borderRadius: 3,
              fontWeight: 600,
              fontSize: 10,
              letterSpacing: 0.2,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
        ))}
      </div>

      {/* PATCH 0592 — Tab rail */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid var(--mc-bg-4)', paddingBottom: 6 }}>
        {([
          { id: 'live',      label: '🔥 Live Feeds',  hint: 'Warrant / Movers / Bullish / Keyword + Manual Analyser' },
          { id: 'analytics', label: '📊 Analytics',   hint: 'Institutional-format consolidated dashboard' },
          { id: 'transform', label: '🚀 Transformation', hint: 'Multibagger transformation-hunting framework — auto-radar runs on any analysed transcript' },
          { id: 'radar',     label: '🔭 Radar',          hint: 'Auto-scans EVERY concall in the live feed for transformation patterns — ranked leaderboard, no pasting' },
        ] as const).map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.hint}
              style={{
                fontSize: 12, fontWeight: 800, letterSpacing: '0.3px',
                padding: '6px 14px', borderRadius: 6,
                border: `1px solid ${isActive ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
                background: isActive ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent',
                color: isActive ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'radar' ? (
        <TransformationScreenerTab />
      ) : tab === 'transform' ? (
        <TransformationFrameworkTab lastRadar={result?.transformation ?? null} lastTicker={result?.ticker ?? ''} />
      ) : tab === 'analytics' ? (
        <ConcallAnalyticsTab />
      ) : (
        <>
      {/* PATCH 0422 — Warrant Momentum promoted to TOP. Promoter-warrant +
          post-breakout setups are the highest-conviction one-shot trades on
          the page (typically 50–200% in 12–24 months when they qualify).
          MOVERS / LIVE BULLISH / KEYWORD WATCH all surface signals that need
          interpretation; warrant gate is binary (pass / fail) so it belongs
          at the top of the decision funnel. */}
      <WarrantMomentumFeed />

      {/* PATCH 0400 — MOVERS panel (daily delta detection) */}
      <MoversPanel />

      {/* PATCH 0387 — LIVE BULLISH FEED */}
      <LiveBullishFeed />

      {/* PATCH 0394 — KEYWORD WATCH (third intelligence lane) */}
      <KeywordWatchFeed />

      <h2 style={{ fontSize: 16, fontWeight: 900, margin: '32px 0 8px' }}>📝 Manual Transcript / PDF Analyser</h2>
      <p style={{ fontSize: 11, color: 'var(--mc-text-3)', margin: 0, marginBottom: 14 }}>
        Paste a concall transcript OR enter a public PDF URL. Output: tone score, guidance map, key themes, red flags, key numbers.
      </p>
      {/* AUDIT_100 #80 — calibration disclosure. Tone score is regex/lexicon-based;
          a 78 vs 72 difference is NOT statistically meaningful. Communicate this
          explicitly so users don't over-trust small deltas. */}
      <p style={{ fontSize: 10.5, color: 'var(--mc-text-4)', margin: '0 0 14px', fontStyle: 'italic', lineHeight: 1.5 }}>
        Note: tone is computed from a positive/negative/defensive lexicon (no LLM). Treat ±5 differences as noise — only ±15 changes reflect real shifts. Use the cue counts (📈/📉/🛡) for the actual signal.
      </p>

      {/* ── Input ───────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10, padding: '14px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker (optional)"
            style={{ flex: '0 0 140px', padding: '7px 10px', backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, color: 'var(--mc-text-1)', fontSize: 12, outline: 'none' }} />
          <input value={pdfUrl} onChange={(e) => setPdfUrl(e.target.value)} placeholder="Public PDF URL of concall (optional)"
            style={{ flex: 1, padding: '7px 10px', backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, color: 'var(--mc-text-1)', fontSize: 12, outline: 'none' }} />
        </div>
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)}
          placeholder="...or paste the transcript here (Q&A + management commentary, 200+ chars)"
          rows={6}
          style={{ width: '100%', padding: '8px 10px', backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, color: 'var(--mc-text-1)', fontSize: 12, outline: 'none', fontFamily: 'ui-sans-serif, system-ui', resize: 'vertical' }} />
        <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
          <button onClick={() => analyze(false)} disabled={loading || (!pdfUrl.trim() && transcript.trim().length < 200)}
            style={{ padding: '8px 16px', backgroundColor: loading ? 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' : 'var(--mc-cyan)', color: 'var(--mc-bg-0)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? 'Analysing…' : 'Analyse Concall'}
          </button>
          {/* AUDIT_100 #61 — Force re-analyze bypasses the corpus cache. */}
          <button onClick={() => analyze(true)} disabled={loading || (!pdfUrl.trim() && transcript.trim().length < 200)}
            title="Bypass the local 25-analysis cache and re-run the full pipeline"
            style={{ padding: '8px 12px', backgroundColor: 'transparent', color: 'var(--mc-text-3)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}>
            ↻ Force re-analyze
          </button>
          {/* AUDIT_100 #36 — surface intermediate phase + elapsed time so 65s
              spinner doesn't look frozen. */}
          {loading && (
            <span style={{ color: 'var(--mc-cyan)', fontSize: 11, fontStyle: 'italic' }}>
              {progressHint} · {elapsedSec}s elapsed
            </span>
          )}
          {error && <span style={{ color: 'var(--mc-bearish)', fontSize: 11 }}>⚠ {error}</span>}
        </div>
      </div>

      {/* ── Result ──────────────────────────────────────────────────── */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* zzz432 — automatic Multibagger Transformation Radar */}
          {result.transformation && <TransformationRadar t={result.transformation} ticker={result.ticker} />}
          {/* Tone Score */}
          <div style={{ backgroundColor: 'var(--mc-bg-1)', border: `1px solid ${toneColor(result.tone.score)}40`, borderLeft: `4px solid ${toneColor(result.tone.score)}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.6px' }}>TONE & CONFIDENCE</div>
              <div style={{ fontSize: 44, fontWeight: 900, color: toneColor(result.tone.score), lineHeight: 1 }}>
                {result.tone.score}<span style={{ fontSize: 14, color: 'var(--mc-text-3)' }}>/100</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: toneColor(result.tone.score), marginTop: 4 }}>{result.tone.label}</div>
            </div>
            <div style={{ flex: 1, fontSize: 11, color: 'var(--mc-text-3)' }}>
              <div>📈 Positive cues: <strong style={{ color: 'var(--mc-bullish)' }}>{result.tone.pos}</strong></div>
              <div>📉 Negative cues: <strong style={{ color: 'var(--mc-bearish)' }}>{result.tone.neg}</strong></div>
              <div>🛡 Defensive language: <strong style={{ color: 'var(--mc-warn)' }}>{result.tone.defensive}</strong></div>
              <div style={{ marginTop: 4 }}>Transcript length: {result.length.toLocaleString()} chars</div>
            </div>
          </div>

          {/* zzz904 — vs previous call (real comparison against the earlier analysis on file, or an honest 'none yet') */}
          {prior && (
            <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderLeft: '3px solid var(--mc-text-3)', borderRadius: 8, padding: '12px 14px' }}>
              {prior.status === 'COMPARED' ? (
                <>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-text-2)', letterSpacing: '0.4px', marginBottom: 6 }}>{prior.heading.toUpperCase()}</div>
                  {prior.lines.map((l, i) => (
                    <div key={i} style={{ fontSize: 11.5, padding: '3px 0', color: 'var(--mc-text-1)' }}>· {l}</div>
                  ))}
                  <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 6, fontStyle: 'italic' }}>Compared with the earlier analysis of the same ticker stored in this browser. Wording tone uses a fixed word list (no AI).</div>
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: 'var(--mc-text-3)' }}>{prior.message}</div>
              )}
            </div>
          )}

          {/* Guidance Map */}
          {result.guidance.length > 0 && (
            <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px', marginBottom: 8 }}>GUIDANCE MAP — {result.guidance.length}</div>
              {result.guidance.slice(0, 12).map((g, i) => {
                const col = g.kind === 'raise' ? '#10B981' : g.kind === 'cut' ? '#EF4444' : g.kind === 'withdraw' ? '#F97316' : '#94A3B8';
                return (
                  <div key={i} style={{ fontSize: 11, padding: '4px 0', borderBottom: '1px dashed var(--mc-bg-4)' }}>
                    <span style={{ fontWeight: 800, color: col, textTransform: 'uppercase', letterSpacing: '0.4px', marginRight: 6 }}>{g.kind}</span>
                    {g.pct && <span style={{ color: 'var(--mc-text-1)', fontWeight: 700 }}>{g.pct} </span>}
                    <span style={{ color: 'var(--mc-text-3)', fontStyle: 'italic' }}>… {g.snippet}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Themes + Numbers side-by-side */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 10 }}>
            {result.themes.length > 0 && (
              <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderLeft: '3px solid var(--mc-warn)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px', marginBottom: 8 }}>KEY THEMES</div>
                {result.themes.map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: 'var(--mc-text-1)' }}>{t.theme}</span>
                    <span style={{ color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, monospace' }}>{t.mentions}× mention{t.mentions === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            )}
            {result.red_flags.length > 0 && (
              <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', borderLeft: '3px solid var(--mc-bearish)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px', marginBottom: 8 }}>⚠ RED FLAGS</div>
                {result.red_flags.map((f, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '4px 0', color: 'var(--mc-text-1)' }}>· {f}</div>
                ))}
              </div>
            )}
          </div>

          {/* Numbers Mentioned */}
          {result.numbers.length > 0 && (
            <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderLeft: '3px solid var(--mc-bullish)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.4px', marginBottom: 8 }}>NUMBERS MENTIONED — {result.numbers.length}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                {result.numbers.map((n, i) => (
                  <div key={i} style={{ fontSize: 11, padding: '5px 8px', backgroundColor: 'var(--mc-bg-1)', borderRadius: 4 }}>
                    <span style={{ color: 'var(--mc-warn)', fontWeight: 800, textTransform: 'uppercase' }}>{n.metric}</span>
                    <span style={{ color: 'var(--mc-text-1)', fontWeight: 800, marginLeft: 8 }}>{n.value}</span>
                    <div style={{ color: 'var(--mc-text-4)', fontSize: 10, marginTop: 2, fontStyle: 'italic' }}>…{n.snippet}…</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {/* PATCH 0592 — close the 'live' tab fragment */}
      </>
      )}
    </div>
  );
}
