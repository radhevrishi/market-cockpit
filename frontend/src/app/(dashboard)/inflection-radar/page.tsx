'use client';
// zzz1235 — Hidden Inflection Radar: abnormal industry signals (Class 8 trucks, grid, packaging, aerospace …) found
// automatically from industry news, scored with the owner's framework, and mapped to Indian listed suppliers.
import { useEffect, useMemo, useState } from 'react';
import { SIGNAL_WORD, epsSensitivity, type SignalClass } from '@/lib/inflection/core';
import type { RadarData, RadarIndustry } from '@/lib/inflection/server';

const C = { panel: 'var(--mc-bg-1)', line: 'var(--mc-border-2)', txt: 'var(--mc-text-1)', mute: 'var(--mc-text-3)', dim: 'var(--mc-text-4)', green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: '#D97706', blue: '#3B82F6', violet: '#8B5CF6' };
const pc = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`);
const tone = (v: number | null | undefined) => (v == null ? C.mute : v >= 0 ? C.green : C.red);
const bandCol = (s: number) => (s >= 90 ? C.green : s >= 70 ? C.blue : s >= 40 ? C.amber : C.dim);

function Sens() {
  const [rev, setRev] = useState(500), [sh, setSh] = useState(10);
  const rows = useMemo(() => epsSensitivity(rev, sh), [rev, sh]);
  return (
    <div style={{ fontSize: 12, color: C.mute }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <label>Revenue linked to this end market <input type="number" value={rev} onChange={(e) => setRev(parseFloat(e.target.value))} style={{ width: 90, padding: 4, borderRadius: 5, border: `1px solid ${C.line}`, background: 'var(--mc-bg-0)', color: C.txt }} /> ₹ Cr</label>
        <label>Shares <input type="number" value={sh} onChange={(e) => setSh(parseFloat(e.target.value))} style={{ width: 70, padding: 4, borderRadius: 5, border: `1px solid ${C.line}`, background: 'var(--mc-bg-0)', color: C.txt }} /> Cr</label>
      </div>
      <table style={{ borderCollapse: 'collapse' }}><thead><tr>{['Case', 'Supplier revenue growth', 'Incremental EBITDA margin', 'Extra profit (25% tax)', 'Extra EPS'].map((h) => <th key={h} style={{ padding: '3px 10px', textAlign: 'left', color: C.dim }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.case}><td style={{ padding: '3px 10px', fontWeight: 800 }}>{r.case}</td><td style={{ padding: '3px 10px' }}>{(r.growth * 100).toFixed(0)}%</td><td style={{ padding: '3px 10px' }}>{(r.margin * 100).toFixed(0)}%</td><td style={{ padding: '3px 10px' }}>₹{r.pat.toFixed(1)} Cr</td><td style={{ padding: '3px 10px' }}>{r.eps != null ? `₹${r.eps.toFixed(2)}` : '—'}</td></tr>)}</tbody></table>
      <div style={{ marginTop: 4, color: C.dim }}>A range, not a forecast: orders are not builds, builds are not supplier revenue, revenue is not EPS.</div>
    </div>
  );
}

function IndustryCard({ x, open, onToggle, smallOnly }: { x: RadarIndustry; open: boolean; onToggle: () => void; smallOnly: boolean }) {
  const companies = x.companies.filter((c) => !smallOnly || !c.large);
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, borderLeft: `4px solid ${bandCol(x.top)}` }}>
      <button onClick={onToggle} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div><span style={{ fontSize: 15, fontWeight: 900, color: C.txt }}>{x.name}</span> <span style={{ fontSize: 11.5, color: C.dim }}>· {x.newsCount} headlines · {x.signals.length} signals{typeof (x as any).confirmations === 'number' ? ` · ${(x as any).confirmations} confirming` : ''}</span></div>
          <div style={{ fontSize: 13, fontWeight: 900, color: bandCol(x.top) }}>{x.top}/100 · {x.band.label}</div>
        </div>
        <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>{x.why} <i>{x.band.action}</i></div>
        {x.signals[0] && <div style={{ fontSize: 12.5, color: C.txt, marginTop: 6 }}>▸ {x.signals[0].headline}</div>}
      </button>
      {open && (
        <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.dim, marginBottom: 4 }}>SIGNALS (best first)</div>
            {x.signals.length === 0 && <div style={{ fontSize: 12, color: C.dim }}>No abnormal signal in the news yet — the industry is watched, nothing has moved.</div>}
            {x.signals.map((s, i) => (
              <div key={i} style={{ fontSize: 12.5, padding: '5px 0', borderTop: `1px dashed ${C.line}` }}>
                <b style={{ color: bandCol(s.score) }}>{s.score}</b>{' '}
                {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: C.txt }}>{s.headline}</a> : s.headline}
                <div style={{ fontSize: 11, color: C.dim }}>{s.at.slice(0, 10)} · {(s.read.classes as SignalClass[]).map((c) => SIGNAL_WORD[c]).join(', ') || 'numbers only'}{s.reasons.length ? ` · ${s.reasons.join(' · ')}` : ''}
                  {' '}· magnitude {s.parts.magnitude} · acceleration {s.parts.acceleration} · duration {s.parts.duration} · EPS impact {s.parts.eps} · neglect {s.parts.neglect} · bottleneck {s.parts.bottleneck}</div>
              </div>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.dim, marginBottom: 4 }}>INDIAN SUPPLY-CHAIN MAP — research leads, not proof</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Company', 'Bucket', 'M-cap ₹Cr', 'Sales Q YoY', 'EPS Q YoY', 'OPM', '3M', '1Y', 'P/E', 'Stage', 'Must verify'].map((h) => <th key={h} style={{ textAlign: h === 'Company' || h === 'Bucket' || h === 'Must verify' ? 'left' : 'right', padding: '4px 8px', color: C.dim, fontSize: 11, borderBottom: `1px solid ${C.line}` }}>{h}</th>)}</tr></thead>
              <tbody>{companies.map((c) => (
                <tr key={c.ticker} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <td style={{ padding: '4px 8px' }}><a href={`/charts?ticker=${encodeURIComponent(c.ticker)}&market=IN`} style={{ color: C.txt, fontWeight: 800 }}>{c.ticker}</a>{c.large && <span style={{ fontSize: 10, color: C.dim }}> large</span>}<div style={{ fontSize: 10.5, color: C.dim }}>{c.name}</div></td>
                  <td style={{ padding: '4px 8px', color: C.mute }}>{c.bucket}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{c.mc != null ? Math.round(c.mc).toLocaleString('en-IN') : '—'}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: tone(c.revQYoY) }}>{pc(c.revQYoY)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: tone(c.epsQYoY) }}>{pc(c.epsQYoY)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{c.opm != null ? `${c.opm.toFixed(0)}%` : '—'}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: tone(c.perf3M) }}>{pc(c.perf3M)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: tone(c.perf1Y) }}>{pc(c.perf1Y)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{c.pe != null ? c.pe.toFixed(0) : '—'}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{c.stage ?? '—'}</td>
                  <td style={{ padding: '4px 8px', color: C.mute, fontSize: 11.5 }}>{c.verify}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div><div style={{ fontSize: 11, fontWeight: 800, color: C.dim, marginBottom: 4 }}>INCREMENTAL EPS — SENSITIVITY</div><Sens /></div>
        </div>
      )}
    </div>
  );
}

export default function InflectionRadarPage() {
  const [d, setD] = useState<RadarData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [smallOnly, setSmallOnly] = useState(true);
  const load = async (force = false) => {
    setBusy(true); setErr(null);
    try { const j = await fetch(`/api/v1/inflection-radar${force ? '?force=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(150_000) }).then((r) => r.json()); if (!j?.ok) throw new Error(j?.error || 'failed'); setD(j); if (!open && j.industries?.[0]) setOpen(j.industries[0].id); }
    catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ padding: '18px 20px', maxWidth: 1300, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: C.txt, margin: 0 }}>📡 Hidden Inflection Radar</h1>
      <p style={{ fontSize: 13, color: C.mute, margin: '4px 0 10px' }}>
        Abnormal change in an industry — orders, shortages, utilisation, approvals, rules, technology — found from industry news every 6 hours, scored with your framework, and traced to the Indian suppliers whose earnings could move most. A theme is not an investment: verify product fit, customer, utilisation and materiality.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: C.mute }}><input type="checkbox" checked={smallOnly} onChange={(e) => setSmallOnly(e.target.checked)} /> Small and mid caps only</label>
        <button onClick={() => load(true)} disabled={busy} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: `1px solid ${C.blue}`, color: C.blue, background: 'transparent', cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Searching industry news…' : '↻ Search the news now'}</button>
        {d && <span style={{ fontSize: 11.5, color: C.dim }}>as of {d.builtAt.slice(0, 16).replace('T', ' ')} UTC</span>}
      </div>
      {err && <div style={{ color: C.red, fontSize: 12.5 }}>⚠ {err}</div>}
      {d && <div style={{ display: 'grid', gap: 12 }}>{d.industries.map((x) => <IndustryCard key={x.id} x={x} open={open === x.id} onToggle={() => setOpen(open === x.id ? null : x.id)} smallOnly={smallOnly} />)}</div>}
      {d && <ul style={{ fontSize: 11.5, color: C.dim, marginTop: 12 }}>{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    </div>
  );
}
