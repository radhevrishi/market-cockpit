'use client';
// zzz1178 — 🚀 Future 100-baggers (USA + India). Shows the last AI run; "Update with AI" runs it once with today's stock-screener
// shortlist and saves the result for every device. Nothing runs unless the owner clicks.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { pollJob, startAndPoll } from '@/lib/ai-panel-client';
import { HB_CLASS_WORD, HB_FACTORS, hbAsText, type HbPick, type HbReport } from '@/lib/hundred-baggers/core';
import { capText, type CandMarket } from '@/lib/screener/ai-candidates';

const C = { bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-border-1)', text: 'var(--mc-text-1)', dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)', red: 'var(--mc-bearish)', green: 'var(--mc-bullish)', accent: 'var(--mc-accent)', warn: 'var(--mc-warn)' };
const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}%`);
const scoreColor = (total: number) => (total >= 110 ? C.green : total >= 90 ? C.accent : total >= 70 ? C.warn : C.red);

function Bar({ v, max, c }: { v: number; max: number; c: string }) {
  return <div style={{ height: 6, borderRadius: 3, background: tint(c, 15), width: '100%' }}><div style={{ height: 6, borderRadius: 3, width: `${Math.round((v / max) * 100)}%`, background: c }} /></div>;
}

function Detail({ p, m }: { p: HbPick; m: CandMarket }) {
  const d = p.data;
  const box = (title: string, text: string, c = C.text) => text ? <div><div style={{ fontSize: 11, fontWeight: 800, color: C.faint, letterSpacing: 0.5 }}>{title}</div><div style={{ fontSize: 13, lineHeight: 1.5, color: c }}>{text}</div></div> : null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 16, padding: '12px 14px', background: C.bg2 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.faint, letterSpacing: 0.5, marginBottom: 6 }}>THE 15 SCORES (0–10)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px 22px', gap: '4px 8px', alignItems: 'center', fontSize: 12 }}>
          {HB_FACTORS.map(([k, l]) => (
            <Fragment key={k}><span style={{ color: C.dim }}>{l}</span><Bar v={p.scores[k]} max={10} c={p.scores[k] >= 8 ? C.green : p.scores[k] >= 6 ? C.accent : p.scores[k] >= 4 ? C.warn : C.red} /><b style={{ textAlign: 'right' }}>{p.scores[k]}</b></Fragment>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {d && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12 }}>
            {[['Mkt cap', capText(d.mc, m)], ['Sales (qtr)', pct(d.revQ)], ['Sales (yr)', pct(d.revA)], ['EPS (qtr)', pct(d.epsQ)], ['Op margin', d.opm == null ? '—' : `${Math.round(d.opm)}%`], ['ROCE', d.roce == null ? '—' : `${Math.round(d.roce)}%`], ['D/E', d.de == null ? '—' : d.de.toFixed(1)], ['P/E', d.pe == null ? '—' : String(Math.round(d.pe))], ['P/S', d.ps == null ? '—' : d.ps.toFixed(1)], ['1y', pct(d.p1y)]].map(([k, v]) => (
              <span key={k} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 7px', background: C.bg }}><span style={{ color: C.faint }}>{k}</span> <b>{v}</b></span>
            ))}
            <span style={{ fontSize: 11, color: C.faint, alignSelf: 'center' }}>stock-screener figures</span>
          </div>
        )}
        {box('FORWARD METRICS', p.forwardMetrics)}
        {box('MOAT EVIDENCE', p.moat)}
        {box('MEGATREND FIT', p.megatrend)}
        {box('VALUATION', p.valuation)}
        {box('MAIN RISKS', p.risks, C.red)}
        {box('MISSING VS HISTORIC 100-BAGGERS', p.missing, C.warn)}
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.faint, letterSpacing: 0.5 }}>SCENARIO (CALCULATED)</div>
          {p.multiples && p.scenario ? (
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              {(['bear', 'base', 'bull'] as const).map((k) => <div key={k}><b style={{ color: k === 'bear' ? C.red : k === 'bull' ? C.green : C.text }}>{k}</b>: EPS +{p.scenario!.epsCagr[k]}% a year for {p.scenario!.years}y, exit P/E {p.scenario!.exitPe[k]} → <b>{p.multiples![k]}×</b></div>)}
              <div style={{ color: C.dim, fontSize: 12 }}>(1 + EPS growth)^years × (1 − {p.scenario.dilutionPct}% dilution) × exit P/E ÷ today’s P/E {p.multiples.currentPe}; no dividends. Assumes: {p.scenario.basis}</div>
            </div>
          ) : <div style={{ fontSize: 13, color: C.faint }}>{p.scenarioNote || 'Not estimated in this run — click Update with AI.'}</div>}
        </div>
      </div>
    </div>
  );
}

export default function HundredBaggersPage() {
  const [report, setReport] = useState<HbReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mkt, setMkt] = useState<CandMarket>('US');
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());   // zzz1184 — several rows open; expand all / collapse all
  const [cls, setCls] = useState<'ALL' | 'SECULAR_COMPOUNDER' | 'CYCLE_PLAYER'>('ALL');

  useEffect(() => { fetch('/api/v1/hundred-baggers', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (j?.report) setReport(j.report);
      if (j?.job?.state === 'running') { setBusy(true); setMsg('An AI run is in progress…'); pollJob<any>('/api/v1/hundred-baggers', j.job.startedAt, (s) => setMsg(`The AI is scoring the stock-screener shortlist for the USA and India — ${s} s…`)).then(finish); }
    }).catch(() => undefined).finally(() => setLoaded(true)); }, []);
  // zzz1181 — the run continues on the server; the page checks its state every 5 s (a long request was cut with HTTP 502)
  const finish = useCallback((res: { report: any; error: string | null }) => {
    if (res.report) setReport(res.report);
    setMsg(res.error ? `${res.error} — the previous run is still shown.` : null);
    setBusy(false);
  }, []);
  const run = useCallback(async () => {
    setBusy(true); setMsg('The AI is scoring the stock-screener shortlist for the USA and India — usually 1–3 minutes. You can leave this page; the result is saved.');
    try { finish(await startAndPoll<any>('/api/v1/hundred-baggers', (s) => setMsg(`The AI is scoring the stock-screener shortlist for the USA and India — ${s} s…`))); }
    catch (e: any) { finish({ report: null, error: `Update failed: ${String(e?.message || e)}` }); }
  }, [finish]);
  const copy = () => { if (report) navigator.clipboard?.writeText(hbAsText(report)).then(() => setMsg('Copied as text.')).catch(() => undefined); };

  const g = report?.markets.find((x) => x.market === mkt) || null;
  const picks = (g?.picks || []).filter((p) => cls === 'ALL' || p.classification === cls);
  const btn = (on = false, c: string = C.accent): React.CSSProperties => ({ cursor: 'pointer', fontSize: 13, fontWeight: 800, padding: '7px 14px', borderRadius: 8, border: `1px solid ${on ? c : C.border}`, color: on ? c : C.text, background: on ? tint(c, 10) : 'transparent' });
  const when = report ? new Date(report.generatedAt).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div style={{ padding: '14px 20px 28px', color: C.text, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>🚀 Future 100-baggers</h1>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 2 }}>Hidden small-to-mid caps ($500M–$5B) with the early DNA of NVIDIA, Tesla, Amazon, Infosys, Asian Paints, Deepak Nitrite · scored on 15 factors (/150) · return scenarios calculated, not promised</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.faint }}>{!loaded ? 'loading…' : report ? `AI update ${when} · chose from ${report.shortlist.US} US + ${report.shortlist.IN} India screened companies` : 'not run yet'}</span>
          {report && <button type="button" style={btn()} onClick={copy}>⧉ Copy</button>}
          <button type="button" disabled={busy} onClick={run} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }} title="Runs the AI once on today's stock-screener shortlist and saves the result. Nothing runs unless you click (at most 6 a day).">{busy ? '🤖 Updating…' : '🤖 Update with AI'}</button>
        </div>
      </div>
      {msg && <div style={{ fontSize: 13, color: busy ? C.accent : C.dim, marginTop: 8 }}>{msg}</div>}

      {loaded && !report && !busy && <div style={{ marginTop: 16, padding: 16, border: `1px dashed ${C.border}`, borderRadius: 10, fontSize: 14, color: C.dim }}>No run yet. Click <b>🤖 Update with AI</b> — the AI picks 10 per market from real companies in your stock screener (in the size band, growing, returns on capital, low debt, little dilution, not priced for perfection).</div>}

      {report && g && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0 10px' }}>
            {(['US', 'IN'] as CandMarket[]).map((m) => <button key={m} type="button" style={btn(mkt === m)} onClick={() => { setMkt(m); setOpenSet(new Set()); }}>{m === 'US' ? '🇺🇸 Top 10 USA' : '🇮🇳 Top 10 India'}</button>)}
            <span style={{ width: 1, height: 24, background: C.border, margin: '0 6px' }} />
            {([['ALL', 'All'], ['SECULAR_COMPOUNDER', 'Secular compounders'], ['CYCLE_PLAYER', 'Cycle players']] as const).map(([k, l]) => <button key={k} type="button" style={btn(cls === k, k === 'CYCLE_PLAYER' ? C.warn : C.green)} onClick={() => setCls(k)}>{l}</button>)}
            <span style={{ width: 1, height: 24, background: C.border, margin: '0 6px' }} />
            {(() => { const keys = picks.map((p) => `${mkt}:${p.ticker}`); const all = keys.length > 0 && keys.every((k) => openSet.has(k));
              return <button type="button" style={btn(all)} onClick={() => setOpenSet(all ? new Set() : new Set(keys))}>{all ? '▲ Collapse all' : '▼ Expand all'}</button>; })()}
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', background: C.bg }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: C.bg2 }}>
                  {['#', 'Company', 'Score /150', 'Class', 'Base case (calculated)', 'Thesis', ''].map((h) => <th key={h} style={{ textAlign: 'left', padding: '9px 10px', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: C.faint, borderBottom: `2px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {picks.map((p, i) => {
                    const k = `${mkt}:${p.ticker}`; const isOpen = openSet.has(k); const sc = scoreColor(p.total);
                    return (
                      <Fragment key={k}>
                        <tr onClick={() => setOpenSet((s0) => { const n = new Set(s0); if (n.has(k)) n.delete(k); else n.add(k); return n; })} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '10px', fontWeight: 900, color: C.faint, width: 30 }}>{i + 1}</td>
                          <td style={{ padding: '10px', minWidth: 180 }}>
                            <a href={`/charts?m=${mkt}&t=${encodeURIComponent(p.ticker)}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontWeight: 900, fontSize: 14, color: C.text, textDecoration: 'none' }}>{p.ticker} ↗</a>
                            <div style={{ fontSize: 12, color: C.dim }}>{p.name}</div>
                            {p.data && <div style={{ fontSize: 11, color: C.faint }}>{capText(p.data.mc, mkt)}{p.data.ind ? ` · ${p.data.ind}` : ''}</div>}
                          </td>
                          <td style={{ padding: '10px', minWidth: 130 }}>
                            <div style={{ fontSize: 18, fontWeight: 900, color: sc, fontVariantNumeric: 'tabular-nums' }}>{p.total}</div>
                            <Bar v={p.total} max={150} c={sc} />
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 900, padding: '3px 8px', borderRadius: 6, color: p.classification === 'CYCLE_PLAYER' ? C.warn : C.green, border: `1px solid ${p.classification === 'CYCLE_PLAYER' ? C.warn : C.green}`, background: tint(p.classification === 'CYCLE_PLAYER' ? C.warn : C.green, 10) }}>{HB_CLASS_WORD[p.classification]}</span>
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap' }} title={p.scenarioNote || ''}>
                            {p.multiples && p.scenario ? <><div style={{ fontSize: 16, fontWeight: 900 }}>{p.multiples.base}×</div><div style={{ fontSize: 12, color: C.faint }}>{p.scenario.years}y · bear {p.multiples.bear}× · bull {p.multiples.bull}×</div></> : <span style={{ fontSize: 12, color: C.faint }}>not estimated</span>}
                          </td>
                          <td style={{ padding: '10px', lineHeight: 1.45, minWidth: 260 }}>
                            {p.thesis}
                            {(p.flags || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{(p.flags || []).map((f) => <span key={f} style={{ fontSize: 12, fontWeight: 700, color: C.warn, border: `1px solid ${tint(C.warn, 50)}`, background: tint(C.warn, 8), borderRadius: 5, padding: '1px 6px' }}>⚠ {f}</span>)}</div>}
                            <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>TAM {p.scores.tam} · Moat {p.scores.moat} · Founder {p.scores.founder} · Optionality {p.scores.optionality} · Valuation {p.scores.valuation}</div>
                          </td>
                          <td style={{ padding: '10px', fontSize: 12, color: C.faint, whiteSpace: 'nowrap' }}>{isOpen ? '▲ less' : '▼ more'}</td>
                        </tr>
                        {isOpen && <tr><td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}><Detail p={p} m={mkt} /></td></tr>}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {g.note && <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.55, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 10, background: C.bg }}><b>Versus historic 100-baggers:</b> {g.note}</div>}
          <p style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>AI research view ({report.model || 'AI'}) from real stock-screener companies and figures; the total is the sum of the 15 scores. Governance screened by the AI from what it knows — check filings before acting. Not investment advice.</p>
        </>
      )}
    </div>
  );
}
