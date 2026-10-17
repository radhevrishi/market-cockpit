'use client';

// zzz1056 — 🇺🇸 US TOP MOVERS · TOP LOSERS on the home page, beside the India panel. Same row anatomy as India:
// 👁 · ticker · % move · one-line WHY · Q score · trend arrow · chips. Loads only when scrolled into view; reads
// /api/v1/us-movers (memory-cached on the server). Theme colours come from the --mc-* tokens (white in light mode).
// zzz1067 (U01 / U02 / design) —
//   • refresh: every 3 min while the session is live, every 15 min otherwise, at the session changes (09:30 open, the close,
//     after the post-close prewarm) and when the tab comes back into focus; every request is tagged and older answers are
//     dropped (a mode switch or a manual refresh can never be overwritten by a slower earlier request);
//   • the time the moves were observed is shown; a failed refresh keeps the old rows under a clear "could not refresh" banner,
//     a server-side stale answer says so, and while another mode loads the rows are labelled with the mode they belong to;
//   • status: "N company catalysts · N sector context · N unresolved" (industry / sector correlation is not a catalyst);
//   • rows: readable type, column headers, tap / Enter opens an evidence drawer (full company name, source, timestamp, what
//     was checked, and what the Q score is made of — Q is move quality, not a buy rating).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NavLink from '@/components/NavLink';
import {
  usWatchKeys, usKey, whyCoverageSplit, usMoversPollMs, msToNextUsTransition, etClock, evidenceTime,
  type UsMoversPayload, type UsMoverRow, type UsMoversMode,
} from '@/lib/us-movers';
import { usPhaseAt } from '@/lib/ai-gainers/us-gainers';

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
  INDUSTRY: 'industry move (peers moved together — context, not a company catalyst)', SECTOR: 'broad sector move only (context)', NONE: 'no confirmed catalyst',
};
const MODE_LABEL: Record<UsMoversMode, string> = { smallmid: 'Small + mid caps', all: 'All caps' };
/** Q weights (us-movers usMoveQuality) — explained in the drawer. */
const Q_PARTS: Array<{ k: keyof UsMoverRow['quality']['parts']; label: string; w: string; what: string }> = [
  { k: 'relVol', label: 'Volume', w: '30%', what: 'today’s volume vs its average — heavy volume backs the move' },
  { k: 'fundamentals', label: 'Company figures', w: '25%', what: 'revenue growth, margin, cash flow, Rule of 40, accumulation grade' },
  { k: 'structure', label: 'Price structure', w: '15%', what: 'near the 52-week high and a rising month' },
  { k: 'sector', label: 'Sector agreement', w: '15%', what: 'its sector moving the same way' },
  { k: 'trigger', label: 'Evidence strength', w: '15%', what: 'how solid the WHY is (high / medium / low confidence)' },
];

const chip = (color: string): React.CSSProperties => ({
  fontSize: 10, fontWeight: 800, padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3, flexShrink: 0,
  background: `color-mix(in srgb, ${color} 14%, transparent)`, color,
});

function readWatch(): Set<string> {
  try {
    const parse = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    return usWatchKeys(parse('mc:chart-watchlists:v1'), parse('mc:conviction-beats-us:v1'));
  } catch { return new Set(); }
}

const fmtCap = (m: number | null) => (m == null ? '—' : m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m}M`);
const ago = (iso: string | null | undefined, now: number) => {
  if (!iso) return '';
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  return !Number.isFinite(m) ? '' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

function Row({ m, watch, open, onToggle }: { m: UsMoverRow; watch: Set<string>; open: boolean; onToggle: () => void }) {
  const up = m.chg >= 0;
  const c = up ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
  const q = m.quality;
  const when = evidenceTime(m.why.at, m.why.date);
  const drawerId = `usm-${m.ticker}-${up ? 'g' : 'l'}`;
  return (
    <div style={{ borderBottom: '1px solid var(--mc-border-3)' }}>
      <div role="button" tabIndex={0} aria-expanded={open} aria-controls={drawerId} onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="usm-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(54px, auto) 56px minmax(0, 1fr) auto', alignItems: 'center', columnGap: 8, padding: '6px 6px', cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          {watch.has(usKey(m.ticker)) && <span style={{ fontSize: 11, color: 'var(--mc-cyan)' }} title="In your US watchlists / book / US Conviction Beats" aria-label="on your US lists">👁</span>}
          <span style={{ fontSize: 13, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{m.ticker}</span>
        </span>
        <span style={{ fontSize: 13, color: c, fontWeight: 800, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{up ? '+' : ''}{m.chg.toFixed(1)}%</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 10, lineHeight: 1, flexShrink: 0, color: KIND_COLOR[m.why.kind] }} aria-hidden>●</span>
          <span style={{ minWidth: 0, fontSize: 12, color: m.why.kind === 'NONE' ? DIM : TEXT, whiteSpace: open ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: m.why.kind === 'NONE' ? 'italic' : 'normal' }}>
            <span className="usm-kind" style={{ color: KIND_COLOR[m.why.kind], fontWeight: 700 }}>{KIND_LABEL[m.why.kind].split(' (')[0]}: </span>{m.why.text}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {m.earningsTier && <span style={chip('var(--mc-bullish)')} title={`Graded results: ${m.earningsTier}`}>📊</span>}
          {(m.why.context || []).some((x) => /^earnings due/.test(x)) && <span style={chip('var(--mc-warn)')}>ER</span>}
          {m.why.kind === 'DILUTION' && <span style={chip('var(--mc-bearish)')}>DIL</span>}
          {(m.accG === 'A' || m.accG === 'B') && <span style={chip('#8B5CF6')}>ACC {m.accG}</span>}
          <span style={chip(Q_COLOR[q.label])} aria-label={`move quality ${q.q} of 100, ${q.label.toLowerCase()}`}>Q{q.q}</span>
          {q.trend && <span style={chip(q.trend === 'up' ? 'var(--mc-bullish)' : 'var(--mc-bearish)')} aria-label={q.trend === 'up' ? 'above its 50-day average' : 'below its 50-day average'}>{q.trend === 'up' ? '↑' : '↓'}</span>}
          {m.thin && <span style={chip('var(--mc-bearish)')} aria-label="thin trading">⌀</span>}
          <span aria-hidden style={{ fontSize: 10, color: DIM }}>{open ? '▴' : '▾'}</span>
        </span>
      </div>
      {open && (
        <div id={drawerId} style={{ padding: '6px 10px 10px', fontSize: 12, color: TEXT, lineHeight: 1.55, background: 'color-mix(in srgb, var(--mc-cyan) 4%, transparent)' }}>
          <div style={{ fontWeight: 700 }}>{m.company} <span style={{ color: DIM, fontWeight: 400 }}>({m.exchange}: {m.ticker}{m.sector ? ` · ${m.sector}` : ''}{m.industry ? ` · ${m.industry}` : ''})</span></div>
          <div style={{ color: DIM }}>
            Price ${m.price?.toFixed(2) ?? '—'} · move {up ? '+' : ''}{m.chg.toFixed(2)}% · market cap {fmtCap(m.mcapM)} · avg traded ${m.avgDollarVolM ?? '—'}M a day{m.relVol != null ? ` · volume ${m.relVol}× average` : ''}{m.thin ? ' · thin for real size (under $10M a day)' : ''}
          </div>
          <div style={{ marginTop: 6 }}>
            <b>Why ({KIND_LABEL[m.why.kind]}, confidence {m.why.confidence.toLowerCase()}):</b> {m.why.text}
          </div>
          <div style={{ color: DIM }}>
            Source: {m.why.source || '—'}{when ? ` · ${when}` : ''}
            {m.why.url ? <> · {/^https?:/.test(m.why.url)
              ? <a href={m.why.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-cyan)' }}>open source ↗</a>
              : <NavLink href={m.why.url} style={{ color: 'var(--mc-cyan)' }}>open →</NavLink>}</> : null}
          </div>
          {m.why.kind === 'INDUSTRY' || m.why.kind === 'SECTOR' ? <div style={{ color: 'var(--mc-warn)' }}>Context only: other names moved the same way. That is correlation, not a confirmed reason for this company.</div> : null}
          {(m.why.context || []).map((x) => <div key={x} style={{ color: DIM }}>· {x}</div>)}
          <div style={{ color: DIM }}>Checked: {m.why.checked.join(', ') || '—'}</div>
          <div style={{ marginTop: 6 }}>
            <b>Q {q.q}/100 ({q.label.toLowerCase()}) = move quality</b> — how strong and well-supported today’s move looks. It is not a buy rating and not a forecast; a falling stock can score high when the fall is heavy-volume and well explained.
          </div>
          <table style={{ borderCollapse: 'collapse', marginTop: 4, fontSize: 11, width: '100%', maxWidth: 520 }}>
            <caption style={{ textAlign: 'left', color: DIM, fontSize: 11 }}>What Q is made of (each part 0–100, weighted)</caption>
            <tbody>
              {Q_PARTS.map((p) => (
                <tr key={p.k}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 600, padding: '1px 6px 1px 0', whiteSpace: 'nowrap' }}>{p.label} <span style={{ color: DIM, fontWeight: 400 }}>{p.w}</span></th>
                  <td style={{ textAlign: 'right', padding: '1px 6px', fontVariantNumeric: 'tabular-nums' }}>{Math.round(q.parts[p.k])}</td>
                  <td style={{ color: DIM, padding: '1px 0' }}>{p.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.vsSma50Pct != null ? <div style={{ color: DIM, marginTop: 4 }}>Trend (separate from Q): {q.trend === 'up' ? '↑ above' : '↓ below'} its 50-day average ({q.vsSma50Pct >= 0 ? '+' : ''}{q.vsSma50Pct}%).</div> : null}
          <div style={{ marginTop: 6 }}><NavLink href={`/charts?m=US&t=${encodeURIComponent(m.ticker)}`} style={{ color: 'var(--mc-cyan)', fontWeight: 700 }}>Open {m.ticker} chart →</NavLink></div>
        </div>
      )}
    </div>
  );
}

const ROW_CSS = `
@media (max-width: 520px) {
  .usm-row { grid-template-columns: minmax(50px, auto) 52px minmax(0, 1fr) !important; }
  .usm-row > span:last-child { grid-column: 1 / -1; justify-content: flex-start !important; }
  .usm-kind { display: none; }
}
.usm-row:focus-visible { outline: 2px solid var(--mc-cyan); outline-offset: -2px; }
`;

export function UsMovers() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<UsMoversMode>('smallmid');
  useEffect(() => { try { if (localStorage.getItem(MODE_KEY) === 'all') setMode('all'); } catch { /* default */ } }, []);
  const [data, setData] = useState<UsMoversPayload | null>(null);
  const [serverStale, setServerStale] = useState(false);
  const [err, setErr] = useState<{ msg: string; at: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [watch, setWatch] = useState<Set<string>>(() => new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // request generation + the live controller: only the newest request may write state
  const gen = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const lastOk = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

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

  const load = useCallback(async (m: UsMoversMode) => {
    const my = ++gen.current;
    ctl.current?.abort();
    const ac = new AbortController();
    ctl.current = ac;
    const timer = setTimeout(() => ac.abort(), 60_000);
    setLoading(true);
    try {
      const r = await fetch(`/api/v1/us-movers?mode=${m}`, { signal: ac.signal, cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (my !== gen.current) return;                       // a newer request owns the panel now
      if (!r.ok || !j || (j.ok === false && !Array.isArray(j.gainers))) setErr({ msg: j?.error || `HTTP ${r.status}`, at: Date.now() });
      else if (j.mode && j.mode !== m) setErr({ msg: `server answered for ${j.mode}`, at: Date.now() });
      else { setData(j); setServerStale(r.headers.get('x-mc-cache') === 'stale'); setErr(null); lastOk.current = Date.now(); }
    } catch (e: any) {
      if (my !== gen.current) return;
      setErr({ msg: e?.name === 'AbortError' ? 'timed out' : String(e?.message || e), at: Date.now() });
    } finally {
      clearTimeout(timer);
      if (my === gen.current) setLoading(false);
    }
  }, []);

  // first load and every mode change (the old request is aborted and its answer ignored)
  useEffect(() => {
    if (!visible) return;
    void load(mode);
  }, [visible, mode, load]);
  useEffect(() => () => { gen.current++; ctl.current?.abort(); }, []);

  // low-cadence polling in every phase (3 min live, 15 min otherwise) + a timer at the next session change
  const phase = data?.notice?.phase ?? usPhaseAt(new Date());
  useEffect(() => {
    if (!visible) return;
    const tick = () => { if (document.visibilityState === 'visible') void load(modeRef.current); };
    const id = setInterval(tick, usMoversPollMs(phase));
    const wait = msToNextUsTransition(new Date());
    const tr = wait != null && wait < 6 * 3600_000 ? setTimeout(tick, wait) : null;
    return () => { clearInterval(id); if (tr) clearTimeout(tr); };
  }, [visible, phase, load, data?.generatedAt]);

  // back to the tab / window: re-read when the shown answer is older than a minute
  useEffect(() => {
    if (!visible) return;
    const back = () => { if (document.visibilityState === 'visible' && Date.now() - lastOk.current > 60_000) void load(modeRef.current); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); };
  }, [visible, load]);

  // the "x min ago" label
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const setModeSaved = (m: UsMoversMode) => { setMode(m); setOpenKey(null); try { localStorage.setItem(MODE_KEY, m); } catch { /* this visit only */ } };

  const cov = useMemo(() => (data ? { n: data.gainers.length + data.losers.length, ...whyCoverageSplit(data.coverage) } : null), [data]);
  const shownMode = data?.mode ?? null;
  const modeMismatch = !!data && shownMode !== mode;
  const observed = etClock(data?.generatedAt);
  const toggle = (k: string) => setOpenKey((o) => (o === k ? null : k));

  return (
    <div ref={ref} style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-0)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 8, padding: '14px 16px', minWidth: 0 }}>
      <style>{ROW_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px', margin: 0 }}>🇺🇸 US TOP MOVERS · TOP LOSERS</h2>
        <span role="group" aria-label="Market-cap filter" style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
          {(['smallmid', 'all'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setModeSaved(m)} title={m === 'smallmid' ? 'Small & mid caps: $300M–$30B, price ≥ $3, ≥ $5M traded a day' : 'All caps ≥ $300M (large caps included), price ≥ $3, ≥ $5M traded a day'}
              style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', fontWeight: 700, background: mode === m ? 'color-mix(in srgb, var(--mc-cyan) 15%, transparent)' : 'transparent', border: `1px solid ${mode === m ? 'var(--mc-cyan)' : 'var(--mc-border-1)'}`, color: mode === m ? 'var(--mc-cyan)' : DIM }}>
              {m === 'smallmid' ? 'Small+Mid' : 'All caps'}
            </button>
          ))}
          <button type="button" onClick={() => void load(mode)} disabled={loading} aria-busy={loading} title="Re-read now (the server keeps one answer for 3 min while the session is live)" style={{ fontSize: 11, color: 'var(--mc-warn)', background: 'transparent', border: '1px solid var(--mc-warn)', borderRadius: 4, padding: '2px 7px', cursor: 'pointer' }}>{loading ? 'Loading…' : '🔄 Refresh'}</button>
          <NavLink href="/ai-gainers?market=US" title="The full US gainers board with filing research" style={{ fontSize: 11, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open →</NavLink>
        </span>
      </div>
      <div style={{ fontSize: 11, color: DIM, marginBottom: 6, lineHeight: 1.5 }} aria-live="polite">
        {data ? (
          <>
            {shownMode ? MODE_LABEL[shownMode] : ''} · {data.notice.text}
            {observed ? <> · observed {observed}{data.generatedAt ? ` (${ago(data.generatedAt, now)})` : ''}</> : null}
            {cov && cov.n > 0 && <div>{cov.text}</div>}
          </>
        ) : visible ? (loading ? 'Loading US movers…' : '') : 'US movers load when scrolled into view'}
      </div>
      {modeMismatch && (
        <div role="status" style={{ fontSize: 11, color: 'var(--mc-cyan)', padding: '4px 6px', border: '1px solid color-mix(in srgb, var(--mc-cyan) 30%, transparent)', borderRadius: 3, marginBottom: 6 }}>
          {loading ? `Loading ${MODE_LABEL[mode]}… ` : ''}The rows below are still {MODE_LABEL[shownMode!]}.
        </div>
      )}
      {serverStale && data && !loading && (
        <div role="status" style={{ fontSize: 11, color: 'var(--mc-warn)', padding: '4px 6px', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 3, marginBottom: 6 }}>
          ⏳ This is the server’s previous answer (observed {observed}); a fresh one is being built — the next refresh picks it up.
        </div>
      )}
      {err && data && (
        <div role="alert" style={{ fontSize: 11, color: 'var(--mc-bearish)', padding: '4px 6px', border: '1px solid color-mix(in srgb, var(--mc-bearish) 30%, transparent)', borderRadius: 3, marginBottom: 6 }}>
          ⚠ Could not refresh ({err.msg}) — still showing the moves observed {observed || 'earlier'}. <button type="button" onClick={() => void load(mode)} style={{ fontSize: 11, cursor: 'pointer' }}>Retry</button>
        </div>
      )}
      {data?.sourceNote && <div style={{ fontSize: 11, color: 'var(--mc-warn)', padding: '4px 6px', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 3, marginBottom: 6 }}>⚠ {data.sourceNote}</div>}
      {err && !data && <div role="alert" style={{ fontSize: 12, color: 'var(--mc-bearish)', padding: '6px' }}>Could not load US movers ({err.msg}). <button type="button" onClick={() => void load(mode)} style={{ fontSize: 11, cursor: 'pointer' }}>Retry</button></div>}
      {data && data.gainers.length === 0 && data.losers.length === 0 && (
        <div style={{ fontSize: 12, color: DIM, fontStyle: 'italic', padding: '8px 6px' }}>No US movers data right now{data.notes[0] ? ` (${data.notes[0]})` : ''}.</div>
      )}
      {data && (data.gainers.length > 0 || data.losers.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: modeMismatch ? 0.6 : 1 }}>
          <div role="list" aria-label="US movers">
            <div aria-hidden className="usm-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(54px, auto) 56px minmax(0, 1fr) auto', columnGap: 8, padding: '0 6px 2px', fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: 0.3 }}>
              <span>TICKER</span><span style={{ textAlign: 'right' }}>CHANGE</span><span>WHY (tap a row for evidence, price, Q)</span><span style={{ textAlign: 'right' }} title="Q = move quality 0–100 (not a buy rating); ↑/↓ = vs the 50-day average">Q · TREND</span>
            </div>
            {data.gainers.length > 0 && <>
              <div style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 700, margin: '4px 0 2px', letterSpacing: '0.3px' }}>▲ GAINERS ({data.gainers.length})</div>
              {data.gainers.map((m) => <div role="listitem" key={`g-${m.ticker}`}><Row m={m} watch={watch} open={openKey === `g-${m.ticker}`} onToggle={() => toggle(`g-${m.ticker}`)} /></div>)}
            </>}
            {data.losers.length > 0 && <>
              <div style={{ fontSize: 11, color: 'var(--mc-bearish)', fontWeight: 700, margin: '8px 0 2px', letterSpacing: '0.3px' }}>▼ LOSERS ({data.losers.length})</div>
              {data.losers.map((m) => <div role="listitem" key={`l-${m.ticker}`}><Row m={m} watch={watch} open={openKey === `l-${m.ticker}`} onToggle={() => toggle(`l-${m.ticker}`)} /></div>)}
            </>}
          </div>
          {data.breadth?.top && data.breadth?.bottom && (
            <div style={{ fontSize: 11, color: DIM, padding: '4px 6px', borderTop: '1px solid var(--mc-border-3)', lineHeight: 1.6 }}>
              <div>
                <span style={{ fontWeight: 700 }}>Sector breadth</span> <span style={{ color: 'var(--mc-text-4)' }}>({data.universe.kept} names, avg move)</span>:{' '}
                <span style={{ color: 'var(--mc-bullish)' }}>{data.breadth.top.sector} {data.breadth.top.avg >= 0 ? '+' : ''}{data.breadth.top.avg.toFixed(1)}%</span>
                {' · '}
                <span style={{ color: 'var(--mc-bearish)' }}>{data.breadth.bottom.sector} {data.breadth.bottom.avg >= 0 ? '+' : ''}{data.breadth.bottom.avg.toFixed(1)}%</span>
              </div>
              {(data.breadth.leaders.length > 0 || data.breadth.laggards.length > 0) && (
                <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>
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
