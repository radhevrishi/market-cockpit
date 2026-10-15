'use client';

// zzz1056 — 🇺🇸 US TOP MOVERS · TOP LOSERS on the home page, beside the India panel. Same row anatomy as India:
// 👁 · ticker · % move · one-line WHY · Q score · trend arrow · chips. Loads only when scrolled into view; reads
// /api/v1/us-movers (memory-cached on the server). Theme colours come from the --mc-* tokens (white in light mode).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usWatchKeys, usKey, type UsMoversPayload, type UsMoverRow, type UsMoversMode } from '@/lib/us-movers';

const MODE_KEY = 'mc:home-us-movers-mode:v1';
const TEXT = 'var(--mc-text-1)';
const DIM = 'var(--mc-text-3)';
const Q_COLOR: Record<string, string> = { EXCELLENT: 'var(--mc-bullish)', GOOD: 'var(--mc-cyan)', WEAK: 'var(--mc-warn)', POOR: 'var(--mc-bearish)' };
const KIND_COLOR: Record<string, string> = {
  EARNINGS: 'var(--mc-bullish)', FILING: 'var(--mc-cyan)', DILUTION: 'var(--mc-bearish)', NEWS: '#8B5CF6', ANALYST: '#8B5CF6', INSIDER: '#EC4899',
  INDUSTRY: 'var(--mc-warn)', SECTOR: 'var(--mc-text-3)', NONE: 'var(--mc-text-4)',
};
const KIND_LABEL: Record<string, string> = {
  EARNINGS: 'earnings', FILING: 'SEC filing', DILUTION: 'dilution', NEWS: 'news', ANALYST: 'analyst action', INSIDER: 'insider / holder trade',
  INDUSTRY: 'industry move (peers moved together)', SECTOR: 'broad sector move only', NONE: 'no confirmed catalyst',
};

const chip = (color: string): React.CSSProperties => ({
  fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 2, letterSpacing: 0.3, flexShrink: 0,
  background: `color-mix(in srgb, ${color} 14%, transparent)`, color,
});

function readWatch(): Set<string> {
  try {
    const parse = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    return usWatchKeys(parse('mc:chart-watchlists:v1'), parse('mc:conviction-beats-us:v1'));
  } catch { return new Set(); }
}

function Row({ m, watch }: { m: UsMoverRow; watch: Set<string> }) {
  const up = m.chg >= 0;
  const c = up ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
  const q = m.quality;
  const tip = [
    `${m.ticker} — ${m.company}${m.sector ? ` · ${m.sector}` : ''}`,
    `${up ? '+' : ''}${m.chg.toFixed(2)}% · $${m.price?.toFixed(2) ?? '—'} · cap $${m.mcapM != null ? (m.mcapM >= 1000 ? `${(m.mcapM / 1000).toFixed(1)}B` : `${m.mcapM}M`) : '—'} · avg traded $${m.avgDollarVolM ?? '—'}M/day${m.relVol != null ? ` · vol ${m.relVol}× avg` : ''}`,
    `WHY (${KIND_LABEL[m.why.kind]}, confidence ${m.why.confidence}${m.why.source ? `, ${m.why.source}` : ''}${m.why.date ? `, ${m.why.date}` : ''}): ${m.why.text}`,
    ...(m.why.context || []).map((c) => `· ${c}`),
    `checked: ${m.why.checked.join(', ') || '—'}`,
    m.industry ? `industry: ${m.industry}` : '',
    `── Move Quality ${q.q}/100 (${q.label}) · rel-vol ${Math.round(q.parts.relVol)} · company ${Math.round(q.parts.fundamentals)} · structure ${Math.round(q.parts.structure)} · sector ${Math.round(q.parts.sector)} · trigger ${Math.round(q.parts.trigger)}`,
    q.vsSma50Pct != null ? `${q.trend === 'up' ? '↑ above' : '↓ below'} its 50-day average (${q.vsSma50Pct >= 0 ? '+' : ''}${q.vsSma50Pct}%)` : '',
  ].filter(Boolean).join('\n');
  return (
    <div title={tip} style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '4px 6px', borderBottom: '1px solid var(--mc-border-3)' }}>
      {watch.has(usKey(m.ticker)) && <span style={{ fontSize: 10, color: 'var(--mc-cyan)', flexShrink: 0 }} title="In your US watchlists / book / US Conviction Beats">👁</span>}
      <Link href={`/charts?m=US&t=${encodeURIComponent(m.ticker)}`} style={{ fontSize: 11, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 58, textDecoration: 'none', whiteSpace: 'nowrap' }}>{m.ticker}</Link>
      <span style={{ fontSize: 11, color: c, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 52, textAlign: 'right' }}>{up ? '+' : ''}{m.chg.toFixed(1)}%</span>
      <span style={{ fontSize: 11, lineHeight: 1, flexShrink: 0, color: KIND_COLOR[m.why.kind] }} title={KIND_LABEL[m.why.kind]}>●</span>
      {m.why.url && /^https?:/.test(m.why.url) ? (
        <a href={m.why.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 10, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'none', fontStyle: m.why.kind === 'NONE' ? 'italic' : 'normal' }}>{m.why.text}</a>
      ) : (
        <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: m.why.kind === 'NONE' ? DIM : TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: m.why.kind === 'NONE' ? 'italic' : 'normal' }}>{m.why.text}</span>
      )}
      {m.earningsTier && <span style={chip('var(--mc-bullish)')} title={`Graded results: ${m.earningsTier}`}>📊</span>}
      {(m.why.context || []).some((c) => /^earnings due/.test(c)) && <span style={chip('var(--mc-warn)')} title={(m.why.context || []).find((c) => /^earnings due/.test(c))}>ER</span>}
      {m.why.kind === 'DILUTION' && <span style={chip('var(--mc-bearish)')} title="Offering / dilution filed">DIL</span>}
      {(m.accG === 'A' || m.accG === 'B') && <span style={chip('#8B5CF6')} title={`Accumulation grade ${m.accG} (Stock Screener)`}>ACC {m.accG}</span>}
      <span style={chip(Q_COLOR[q.label])}>Q{q.q}</span>
      {q.trend && <span style={chip(q.trend === 'up' ? 'var(--mc-bullish)' : 'var(--mc-bearish)')}>{q.trend === 'up' ? '↑' : '↓'}</span>}
      {m.thin && <span style={chip('var(--mc-bearish)')} title="Average traded value under $10M a day — thin for real size">⌀</span>}
    </div>
  );
}

export function UsMovers() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<UsMoversMode>('smallmid');
  useEffect(() => { try { if (localStorage.getItem(MODE_KEY) === 'all') setMode('all'); } catch { /* default */ } }, []);
  const [data, setData] = useState<UsMoversPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [watch, setWatch] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const read = () => setWatch(readWatch());
    read();
    window.addEventListener('storage', read);
    window.addEventListener('conviction-beats-us:updated', read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener('conviction-beats-us:updated', read); };
  }, []);

  const load = useCallback(async (m: UsMoversMode, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/v1/us-movers?mode=${m}`, { signal: signal ?? AbortSignal.timeout(60_000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok === false && !Array.isArray(j.gainers)) setErr(j?.error || `HTTP ${r.status}`);
      else { setData(j); setErr(null); }
    } catch (e: any) { if (e?.name !== 'AbortError') setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const ctl = new AbortController();
    void load(mode, ctl.signal);
    return () => ctl.abort();
  }, [visible, mode, load]);

  // while the US session is live: re-read every 3 minutes, only when the tab is visible
  useEffect(() => {
    if (!visible || !data?.notice?.live) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(mode); }, 3 * 60_000);
    return () => clearInterval(id);
  }, [visible, data?.notice?.live, mode, load]);

  const setModeSaved = (m: UsMoversMode) => { setMode(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* this visit only */ } };

  const cov = useMemo(() => {
    if (!data) return null;
    const n = data.gainers.length + data.losers.length;
    // a broad-sector line is a context, not a reason: only stock-specific / industry answers count as found
    const explained = n - (data.coverage?.NONE || 0) - (data.coverage?.SECTOR || 0);
    return { n, explained };
  }, [data]);

  return (
    <div ref={ref} style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-0)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 8, padding: '14px 16px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px' }}>🇺🇸 US TOP MOVERS · TOP LOSERS</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          {(['smallmid', 'all'] as const).map((m) => (
            <button key={m} onClick={() => setModeSaved(m)} title={m === 'smallmid' ? 'Small & mid caps: $300M–$30B, price ≥ $3, ≥ $5M traded a day' : 'All caps ≥ $300M (large caps included), price ≥ $3, ≥ $5M traded a day'}
              style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, cursor: 'pointer', fontWeight: 700, background: mode === m ? 'color-mix(in srgb, var(--mc-cyan) 15%, transparent)' : 'transparent', border: `1px solid ${mode === m ? 'var(--mc-cyan)' : 'var(--mc-border-1)'}`, color: mode === m ? 'var(--mc-cyan)' : DIM }}>
              {m === 'smallmid' ? 'Small+Mid' : 'All caps'}
            </button>
          ))}
          <button onClick={() => void load(mode)} disabled={loading} title="Re-read (the server keeps one answer for 3 min while the session is live)" style={{ fontSize: 10, color: 'var(--mc-warn)', background: 'transparent', border: '1px solid var(--mc-warn)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}>{loading ? '…' : '🔄 Refresh'}</button>
          <Link href="/ai-gainers?market=US" title="The full US gainers board with filing research" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open →</Link>
        </span>
      </div>
      <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
        {data ? (
          <>
            {data.notice.live ? `${mode === 'all' ? 'All caps' : 'Small + mid caps'} · ${data.notice.text}` : data.notice.text}
            {cov && cov.n > 0 && <> · reasons found for {cov.explained}/{cov.n}</>}
          </>
        ) : visible ? 'Loading US movers…' : 'US movers load when scrolled into view'}
      </div>
      {data?.sourceNote && <div style={{ fontSize: 10, color: 'var(--mc-warn)', padding: '4px 6px', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 3, marginBottom: 6 }}>⚠ {data.sourceNote}</div>}
      {err && !data && <div style={{ fontSize: 11, color: 'var(--mc-bearish)', padding: '6px' }}>Could not load US movers ({err}). <button onClick={() => void load(mode)} style={{ fontSize: 10, cursor: 'pointer' }}>Retry</button></div>}
      {data && data.gainers.length === 0 && data.losers.length === 0 && (
        <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic', padding: '8px 6px' }}>No US movers data right now{data.notes[0] ? ` (${data.notes[0]})` : ''}.</div>
      )}
      {data && (data.gainers.length > 0 || data.losers.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            {data.gainers.length > 0 && <>
              <div style={{ fontSize: 9, color: 'var(--mc-bullish)', fontWeight: 700, margin: '2px 0', letterSpacing: '0.3px' }}>▲ GAINERS ({data.gainers.length})</div>
              {data.gainers.map((m) => <Row key={`g-${m.ticker}`} m={m} watch={watch} />)}
            </>}
            {data.losers.length > 0 && <>
              <div style={{ fontSize: 9, color: 'var(--mc-bearish)', fontWeight: 700, margin: '6px 0 2px', letterSpacing: '0.3px' }}>▼ LOSERS ({data.losers.length})</div>
              {data.losers.map((m) => <Row key={`l-${m.ticker}`} m={m} watch={watch} />)}
            </>}
          </div>
          {data.breadth?.top && data.breadth?.bottom && (
            <div style={{ fontSize: 9.5, color: DIM, padding: '4px 6px', borderTop: '1px solid var(--mc-border-3)', lineHeight: 1.6 }}>
              <div>
                <span style={{ fontWeight: 700 }}>Sector breadth</span> <span style={{ color: 'var(--mc-text-4)' }}>({data.universe.kept} names, avg move)</span>:{' '}
                <span style={{ color: 'var(--mc-bullish)' }}>{data.breadth.top.sector} {data.breadth.top.avg >= 0 ? '+' : ''}{data.breadth.top.avg.toFixed(1)}%</span>
                {' · '}
                <span style={{ color: 'var(--mc-bearish)' }}>{data.breadth.bottom.sector} {data.breadth.bottom.avg >= 0 ? '+' : ''}{data.breadth.bottom.avg.toFixed(1)}%</span>
              </div>
              {(data.breadth.leaders.length > 0 || data.breadth.laggards.length > 0) && (
                <div style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>
                  {data.breadth.leaders.length > 0 && <>▲ leaders: <span style={{ color: 'var(--mc-text-3)' }}>{data.breadth.leaders.join(', ')}</span></>}
                  {data.breadth.leaders.length > 0 && data.breadth.laggards.length > 0 && ' · '}
                  {data.breadth.laggards.length > 0 && <>▼ laggards: <span style={{ color: 'var(--mc-text-3)' }}>{data.breadth.laggards.join(', ')}</span></>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
