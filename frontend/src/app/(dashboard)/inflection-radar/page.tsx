'use client';
// zzz1235 — Hidden Inflection Radar: abnormal industry signals (Class 8 trucks, grid, packaging, aerospace …) found
// automatically from industry news, scored with the owner's framework, and mapped to Indian listed suppliers.
// zzz1241 — full-width layout: overview tiles, a score bar per industry, cards in two columns, colour by score band,
// signal-type chips, score parts as small bars, one card per story (×N sources), quiet industries folded away, and
// the EPS sensitivity prefilled from a chosen company's sales and shares.
import { useEffect, useMemo, useState } from 'react';
import { SIGNAL_WORD, epsSensitivity, type SignalClass } from '@/lib/inflection/core';
import type { RadarData, RadarIndustry } from '@/lib/inflection/server';

const C = {
  panel: 'var(--mc-bg-1)', base: 'var(--mc-bg-0)', line: 'var(--mc-border-2)', txt: 'var(--mc-text-1)', mute: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: '#10B981', red: '#EF4444', amber: '#F59E0B', blue: '#3B82F6', violet: '#8B5CF6', teal: '#14B8A6', pink: '#EC4899', cyan: '#06B6D4', slate: '#64748B',
};
const tint = (c: string, pct = 10) => `color-mix(in srgb, ${c} ${pct}%, var(--mc-bg-1))`;
const pc = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`);
const tone = (v: number | null | undefined) => (v == null ? C.dim : v >= 0 ? C.green : C.red);
const heat = (v: number | null | undefined) => (v == null ? 'transparent' : tint(v >= 0 ? C.green : C.red, Math.min(28, 6 + Math.abs(v) / 4)));
const bandCol = (s: number) => (s >= 90 ? C.green : s >= 70 ? C.blue : s >= 40 ? C.amber : C.slate);
const CLASS_COL: Record<SignalClass, string> = { DEMAND: C.green, BOTTLENECK: C.red, UTILISATION: C.amber, QUALIFICATION: C.violet, POLICY: C.cyan, TECHNOLOGY: C.pink };
const CLASS_SHORT: Record<SignalClass, string> = { DEMAND: 'Demand', BOTTLENECK: 'Bottleneck', UTILISATION: 'Utilisation', QUALIFICATION: 'Qualification', POLICY: 'Policy', TECHNOLOGY: 'Technology' };
const PARTS: Array<[keyof RadarIndustry['signals'][number]['parts'], string, number]> = [
  ['magnitude', 'Magnitude', 20], ['acceleration', 'Acceleration', 15], ['duration', 'Duration', 15], ['eps', 'EPS impact', 20], ['neglect', 'Neglect', 15], ['bottleneck', 'Bottleneck', 15],
];
const ago = (iso: string) => { const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000)); return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; };

function Chip({ c, children, title }: { c: string; children: React.ReactNode; title?: string }) {
  return <span title={title} style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, color: c, background: tint(c, 16), border: `1px solid ${tint(c, 40)}`, whiteSpace: 'nowrap' }}>{children}</span>;
}

function ScoreBar({ v, c, w = 120 }: { v: number; c: string; w?: number }) {
  return <span style={{ display: 'inline-block', width: w, height: 7, borderRadius: 4, background: 'var(--mc-border-2)', overflow: 'hidden', verticalAlign: 'middle' }}><span style={{ display: 'block', width: `${Math.max(2, Math.min(100, v))}%`, height: '100%', background: c, borderRadius: 4 }} /></span>;
}

function Tile({ label, value, sub, c }: { label: string; value: React.ReactNode; sub?: string; c: string }) {
  return (
    <div style={{ background: tint(c, 9), border: `1px solid ${tint(c, 35)}`, borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, color: c, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: C.txt, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  );
}

function Sens({ companies }: { companies: RadarIndustry['companies'] }) {
  const usable = companies.filter((c) => c.salesCr && c.sharesCr);
  const [pick, setPick] = useState<string>(usable[0]?.ticker ?? '');
  const [share, setShare] = useState(30);
  const co = usable.find((c) => c.ticker === pick) ?? null;
  const [rev, setRev] = useState(co ? Math.round((co.salesCr! * 30) / 100) : 500);
  const [sh, setSh] = useState(co?.sharesCr ?? 10);
  const choose = (t: string, s = share) => {
    setPick(t); const c = usable.find((x) => x.ticker === t);
    if (c) { setRev(Math.round((c.salesCr! * s) / 100)); setSh(c.sharesCr!); }
  };
  const rows = useMemo(() => epsSensitivity(rev, sh), [rev, sh]);
  const inp = { padding: '4px 6px', borderRadius: 6, border: `1px solid ${C.line}`, background: C.base, color: C.txt, fontSize: 12 } as const;
  const caseCol = { Bear: C.red, Base: C.blue, Bull: C.green } as const;
  return (
    <div style={{ fontSize: 12, color: C.mute }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {usable.length > 0 && (
          <label>Company <select value={pick} onChange={(e) => choose(e.target.value)} style={inp}>{usable.map((c) => <option key={c.ticker} value={c.ticker}>{c.ticker}</option>)}</select></label>
        )}
        {co && <label>Share of sales from this end market <input type="number" value={share} min={1} max={100} onChange={(e) => { const s = parseFloat(e.target.value) || 0; setShare(s); setRev(Math.round((co.salesCr! * s) / 100)); }} style={{ ...inp, width: 60 }} /> %</label>}
        <label>Linked revenue <input type="number" value={rev} onChange={(e) => setRev(parseFloat(e.target.value) || 0)} style={{ ...inp, width: 90 }} /> ₹ Cr</label>
        <label>Shares <input type="number" value={sh} onChange={(e) => setSh(parseFloat(e.target.value) || 0)} style={{ ...inp, width: 70 }} /> Cr</label>
      </div>
      {co && <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 6 }}>{co.ticker}: sales ₹{co.salesCr!.toLocaleString('en-IN')} Cr (last 12 months) · {co.sharesCr} Cr shares. The {share}% share is your assumption — check it in the annual report.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.case} style={{ background: tint(caseCol[r.case], 9), border: `1px solid ${tint(caseCol[r.case], 35)}`, borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: caseCol[r.case] }}>{r.case.toUpperCase()}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: C.txt }}>{r.eps != null ? `₹${r.eps.toFixed(2)}` : '—'} <span style={{ fontSize: 11, color: C.mute, fontWeight: 600 }}>extra EPS</span></div>
            <div style={{ fontSize: 11, color: C.mute }}>growth {(r.growth * 100).toFixed(0)}% · margin {(r.margin * 100).toFixed(0)}% · profit ₹{r.pat.toFixed(1)} Cr</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, color: C.dim }}>A range, not a forecast: orders are not builds, builds are not supplier revenue, revenue is not EPS.</div>
    </div>
  );
}

function IndustryCard({ x, open, onToggle, smallOnly }: { x: RadarIndustry; open: boolean; onToggle: () => void; smallOnly: boolean }) {
  const companies = x.companies.filter((c) => !smallOnly || !c.large);
  const col = bandCol(x.top);
  const classes = Array.from(new Set(x.signals.flatMap((s) => s.read.classes as SignalClass[])));
  const top = x.signals[0];
  return (
    <div id={`ind-${x.id}`} style={{ gridColumn: open ? '1 / -1' : undefined, background: `linear-gradient(135deg, ${tint(col, 12)} 0%, var(--mc-bg-1) 55%)`, border: `1px solid ${tint(col, 40)}`, borderRadius: 14, padding: 16, borderLeft: `5px solid ${col}`, scrollMarginTop: 80 }}>
      <button onClick={onToggle} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: C.txt }}>{x.name}</div>
            <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>{x.why}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: col, lineHeight: 1 }}>{x.top}<span style={{ fontSize: 12, color: C.dim }}>/100</span></div>
            <div style={{ fontSize: 11, fontWeight: 800, color: col }}>{x.band.label}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <ScoreBar v={x.top} c={col} w={140} />
          {classes.map((k) => <Chip key={k} c={CLASS_COL[k]} title={SIGNAL_WORD[k]}>{CLASS_SHORT[k]}</Chip>)}
          <span style={{ fontSize: 11.5, color: C.dim }}>{x.signals.length} signal{x.signals.length === 1 ? '' : 's'} · {x.confirmations} confirming · {x.newsCount} headlines · {companies.length} Indian names</span>
        </div>
        {top && (
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: tint(col, 7), border: `1px solid ${tint(col, 22)}`, fontSize: 12.5, color: C.txt }}>
            <b style={{ color: bandCol(top.score) }}>{top.score}</b> · {top.headline}
            <span style={{ fontSize: 11, color: C.dim }}> — {top.source ? `${top.source}, ` : ''}{ago(top.at)}{(top.sources ?? 1) > 1 ? ` · ×${top.sources} sources` : ''}</span>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: col, marginTop: 8, fontWeight: 700 }}>{x.band.action} <span style={{ color: C.dim, fontWeight: 600 }}>{open ? '▴ close' : '▾ signals, companies, EPS'}</span></div>
      </button>
      {open && (
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))', gap: 14 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: C.dim, letterSpacing: 0.4, marginBottom: 6 }}>SIGNALS · BEST FIRST</div>
            {x.signals.length === 0 && <div style={{ fontSize: 12, color: C.dim }}>No abnormal signal in the news yet — the industry is watched, nothing has moved.</div>}
            {x.signals.map((s, i) => (
              <div key={i} style={{ padding: '8px 0', borderTop: i ? `1px dashed ${C.line}` : 'none' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ minWidth: 34, textAlign: 'center', fontSize: 13, fontWeight: 900, color: '#fff', background: bandCol(s.score), borderRadius: 7, padding: '2px 0' }}>{s.score}</span>
                  <div style={{ minWidth: 0, fontSize: 12.5 }}>
                    {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: C.txt, textDecoration: 'none', fontWeight: 600 }}>{s.headline}</a> : <span style={{ color: C.txt, fontWeight: 600 }}>{s.headline}</span>}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                      {(s.read.classes as SignalClass[]).map((k) => <Chip key={k} c={CLASS_COL[k]}>{CLASS_SHORT[k]}</Chip>)}
                      {!s.read.classes.length && <Chip c={C.slate}>Numbers only</Chip>}
                      {(s.sources ?? 1) > 1 && <Chip c={C.teal} title="The same story from several outlets — counted once">×{s.sources} sources</Chip>}
                      <span style={{ fontSize: 11, color: C.dim }}>{s.source ? `${s.source} · ` : ''}{ago(s.at)}{s.reasons.length ? ` · ${s.reasons.join(' · ')}` : ''}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '3px 12px', marginTop: 6 }}>
                      {PARTS.map(([k, label, w]) => (
                        <div key={k} title={`${label}: ${s.parts[k]}/10 (weight ${w})`} style={{ fontSize: 10.5, color: C.dim }}>
                          {label} <b style={{ color: C.mute }}>{s.parts[k]}</b><div><ScoreBar v={s.parts[k] * 10} c={s.parts[k] >= 7 ? C.green : s.parts[k] >= 4 ? C.blue : C.slate} w={100} /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 14, alignContent: 'start', minWidth: 0 }}>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, overflowX: 'auto' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.dim, letterSpacing: 0.4, marginBottom: 6 }}>INDIAN SUPPLY-CHAIN MAP <span style={{ fontWeight: 600 }}>— research leads, not proof</span></div>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 }}>
                <thead><tr>{['Company', 'M-cap ₹Cr', 'Sales Q', 'EPS Q', 'OPM', '3M', '1Y', 'P/E', 'Stage'].map((h, i) => <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '5px 8px', color: C.dim, fontSize: 10.5, fontWeight: 800, borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
                <tbody>{companies.map((c) => (
                  <tr key={c.ticker} title={`Verify: ${c.verify}`}>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, minWidth: 170 }}>
                      <a href={`/charts?ticker=${encodeURIComponent(c.ticker)}&market=IN`} style={{ color: C.txt, fontWeight: 900, textDecoration: 'none' }}>{c.ticker}</a>
                      {c.large && <span style={{ marginLeft: 5 }}><Chip c={C.slate}>large</Chip></span>}
                      <div style={{ fontSize: 10.5, color: C.dim }}>{c.name} · <span style={{ color: C.violet }}>{c.bucket}</span></div>
                      <div style={{ fontSize: 10.5, color: C.mute }}>Verify: {c.verify}</div>
                      {!c.inUniverse && <div style={{ fontSize: 10.5, color: C.amber }}>Not in our NSE data (BSE-only or not listed) — check figures on BSE.</div>}
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, textAlign: 'right' }}>{c.mc != null ? Math.round(c.mc).toLocaleString('en-IN') : '—'}</td>
                    {[c.revQYoY, c.epsQYoY].map((v, i) => <td key={i} style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, textAlign: 'right', color: tone(v), background: heat(v), fontWeight: 700 }}>{pc(v)}</td>)}
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, textAlign: 'right' }}>{c.opm != null ? `${c.opm.toFixed(0)}%` : '—'}</td>
                    {[c.perf3M, c.perf1Y].map((v, i) => <td key={i} style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, textAlign: 'right', color: tone(v), background: heat(v), fontWeight: 700 }}>{pc(v)}</td>)}
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, textAlign: 'right' }}>{c.pe != null ? c.pe.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, textAlign: 'right' }}>{c.stage != null ? <Chip c={c.stage === 2 ? C.green : c.stage === 4 ? C.red : c.stage === 3 ? C.amber : C.slate}>{c.stage}</Chip> : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
              {companies.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: 6 }}>Only large companies are mapped here — untick "Small and mid caps only" to see them.</div>}
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.dim, letterSpacing: 0.4, marginBottom: 6 }}>INCREMENTAL EPS · SENSITIVITY</div>
              <Sens key={x.id} companies={companies} />
            </div>
          </div>
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
  const [showQuiet, setShowQuiet] = useState(false);
  const load = async (force = false) => {
    setBusy(true); setErr(null);
    try { const j = await fetch(`/api/v1/inflection-radar${force ? '?force=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(150_000) }).then((r) => r.json()); if (!j?.ok) throw new Error(j?.error || 'failed'); setD(j); }
    catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const active = d?.industries.filter((x) => x.signals.length > 0) ?? [];
  const quiet = d?.industries.filter((x) => x.signals.length === 0) ?? [];
  const strong = active.filter((x) => x.top >= 70);
  const best = active[0];
  const go = (id: string) => { setOpen(id); setTimeout(() => document.getElementById(`ind-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  return (
    <div style={{ padding: '18px clamp(12px, 2vw, 28px) 28px' }}>
      <div style={{ background: `linear-gradient(120deg, ${tint(C.violet, 18)} 0%, ${tint(C.blue, 12)} 45%, ${tint(C.teal, 10)} 100%)`, border: `1px solid ${tint(C.violet, 35)}`, borderRadius: 16, padding: '16px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ maxWidth: 900 }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: C.txt, margin: 0 }}>📡 Hidden Inflection Radar</h1>
            <p style={{ fontSize: 13, color: C.mute, margin: '4px 0 0' }}>
              Abnormal change in an industry — orders, shortages, utilisation, approvals, rules, technology — found from industry news every 6 hours, scored with your framework, and traced to the Indian suppliers whose earnings could move most. A theme is not an investment: verify product fit, customer, utilisation and materiality.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: C.txt, display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', borderRadius: 8, background: C.panel, border: `1px solid ${C.line}` }}><input type="checkbox" checked={smallOnly} onChange={(e) => setSmallOnly(e.target.checked)} /> Small and mid caps only</label>
            <button onClick={() => load(true)} disabled={busy} style={{ fontSize: 12, fontWeight: 800, padding: '7px 14px', borderRadius: 8, border: 'none', color: '#fff', background: C.blue, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>{busy ? 'Searching industry news…' : '↻ Search the news now'}</button>
            {d && <span style={{ fontSize: 11.5, color: C.mute }}>as of {d.builtAt.slice(0, 16).replace('T', ' ')} UTC</span>}
          </div>
        </div>
      </div>

      {err && <div style={{ color: C.red, fontSize: 12.5, marginBottom: 10 }}>⚠ {err}</div>}
      {!d && !err && <div style={{ fontSize: 13, color: C.mute, padding: 20 }}>Reading industry news…</div>}

      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Tile label="Industries watched" value={d.industries.length} sub={`${active.length} with a signal · ${quiet.length} quiet`} c={C.violet} />
            <Tile label="Strong (70+)" value={strong.length} sub={strong.length ? strong.map((x) => x.name).slice(0, 2).join(', ') : 'none yet — map and monitor'} c={C.blue} />
            <Tile label="Top industry" value={best ? best.top : '—'} sub={best ? best.name : 'no signal yet'} c={best ? bandCol(best.top) : C.slate} />
            <Tile label="Signals" value={active.reduce((s, x) => s + x.signals.length, 0)} sub={`${active.reduce((s, x) => s + x.confirmations, 0)} confirming others`} c={C.teal} />
            <Tile label="Indian names mapped" value={d.industries.reduce((s, x) => s + x.companies.filter((c) => !smallOnly || !c.large).length, 0)} sub={smallOnly ? 'small and mid caps' : 'all sizes'} c={C.green} />
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.dim, letterSpacing: 0.4 }}>INDUSTRY SCORES · CLICK TO OPEN</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[[90, '90+ deep research'], [70, '70–89 company work'], [40, '40–69 map the industry'], [0, 'under 40 monitor']].map(([s, l]) => <Chip key={s} c={bandCol(s as number)}>{l}</Chip>)}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))', gap: '6px 22px' }}>
              {active.map((x) => (
                <button key={x.id} onClick={() => go(x.id)} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px 34px', gap: 10, alignItems: 'center', padding: '4px 6px', borderRadius: 7, background: open === x.id ? tint(bandCol(x.top), 14) : 'transparent' }}>
                  <span style={{ fontSize: 12.5, color: C.txt, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                  <ScoreBar v={x.top} c={bandCol(x.top)} w={140} />
                  <span style={{ fontSize: 12.5, fontWeight: 900, color: bandCol(x.top), textAlign: 'right' }}>{x.top}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 560px), 1fr))', gap: 14 }}>
            {active.map((x) => <IndustryCard key={x.id} x={x} open={open === x.id} onToggle={() => setOpen(open === x.id ? null : x.id)} smallOnly={smallOnly} />)}
          </div>

          {quiet.length > 0 && (
            <div style={{ marginTop: 14, background: C.panel, border: `1px dashed ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
              <button onClick={() => setShowQuiet(!showQuiet)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12.5, fontWeight: 800, color: C.mute }}>
                {showQuiet ? '▾' : '▸'} {quiet.length} industries watched with no signal in the news yet
              </button>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {quiet.map((x) => <span key={x.id} title={x.why} style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 999, border: `1px solid ${C.line}`, color: C.mute }}>{x.name}{x.newsCount ? ` · ${x.newsCount} headlines, none abnormal` : ''}</span>)}
              </div>
              {showQuiet && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 560px), 1fr))', gap: 14, marginTop: 12 }}>
                {quiet.map((x) => <IndustryCard key={x.id} x={x} open={open === x.id} onToggle={() => setOpen(open === x.id ? null : x.id)} smallOnly={smallOnly} />)}
              </div>}
            </div>
          )}

          <div style={{ marginTop: 14, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: C.dim, letterSpacing: 0.4, marginBottom: 4 }}>HOW THIS IS BUILT</div>
            <ul style={{ fontSize: 11.5, color: C.mute, margin: 0, paddingLeft: 18 }}>{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        </>
      )}
    </div>
  );
}
