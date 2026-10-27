'use client';
// zzz1174 → zzz1183 — 🔥 Choke-Point Themes on the News page (v2: company J-curves). Shows the LAST SUCCESSFUL AI run (static
// until the owner clicks; a failed update keeps it and says so). Per theme: the bottleneck mechanism (necessity, supply
// constraint, value capture, what could remove it), small / mid-cap candidates with exposure, J-stage, exact product,
// inflection evidence, next milestone and concern — expandable to the stock-screener facts and the CALCULATED scenarios —
// reference leaders apart, and the live pulse (news / squeeze / company proof / crowding, no AI). Playbook without
// price-fall buying rules. "What changed" is computed from the stored runs.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { pollJob, startAndPoll } from '@/lib/ai-panel-client';
import type { ThemePulse } from '@/lib/choke-themes/pulse';
import { chokeAsText, DISCOVERY_CAP, DRIVER_WORD, fmtChokeCap, EXPOSURE_WHY, J_WHY, J_WORD, type ChokeCandidate, type ChokeChange, type ChokeReport, type ChokeRegion, type ChokeTheme, type JStage } from '@/lib/choke-themes/core';

const OPEN_KEY = 'mc:choke-themes:open:v1';
const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-border-1)', text: 'var(--mc-text-1)', dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)',
  red: 'var(--mc-bearish)', green: 'var(--mc-bullish)', accent: 'var(--mc-accent)', warn: 'var(--mc-warn)',
};
const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
const J_C: Record<JStage, string> = { J0: C.faint, J1: C.warn, J2: C.green, J3: C.green, J4: C.accent, J5: C.red };
const EXPO_C: Record<string, string> = { DIRECT: C.green, ENABLER: C.accent, PROXY: C.warn, SPECULATIVE: C.faint };
const CHECK: Record<string, { w: string; c: string; why: string }> = {
  CONFIRMS: { w: '✓ screener figures agree', c: C.green, why: 'The stock-screener sales figures (latest quarter vs a year earlier, last fiscal year) agree with the stage. Not reconciled to filings; does not verify product exposure or governance.' },
  MIXED: { w: '≈ screener figures mixed', c: C.warn, why: 'The figures neither clearly back nor contradict the stage' },
  CONTRADICTS: { w: '✗ screener figures contradict', c: C.red, why: 'Sales are shrinking while an inflection is claimed' },
  NO_DATA: { w: '? no figures', c: C.faint, why: 'No stock-screener figures — evidence confidence is lower' },
};
const pc = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}%`);
const tag = (text: string, c: string, title?: string) => <span title={title} style={{ display: 'inline-block', fontSize: 12, fontWeight: 900, padding: '2px 7px', borderRadius: 5, color: c, border: `1px solid ${c}`, background: tint(c, 10), whiteSpace: 'nowrap' }}>{text}</span>;
const label = (t: string) => <div style={{ fontWeight: 800, color: C.faint, fontSize: 12, letterSpacing: 0.5, marginBottom: 3 }}>{t}</div>;

const TREND = { RISING: { a: '↑', c: 'var(--mc-bullish)', w: 'rising' }, STEADY: { a: '→', c: 'var(--mc-text-3)', w: 'steady' }, COOLING: { a: '↓', c: 'var(--mc-bearish)', w: 'cooling' } } as const;
const strengthColor = (v: number) => (v >= 60 ? C.green : v >= 35 ? C.accent : C.faint);

function StrengthBadge({ p }: { p: ThemePulse }) {
  const c = strengthColor(p.strength); const tr = TREND[p.trend];
  return (
    <span title={`Live strength ${p.strength}/100 · news ${p.trend.toLowerCase()} · ${p.reasons.join(' · ')}`} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13.5, fontWeight: 900, padding: '3px 8px', borderRadius: 6, color: c, border: `1px solid ${c}`, background: tint(c, 10) }}>
      {p.strength}<span style={{ fontWeight: 600, opacity: 0.8 }}>/100</span><span style={{ color: tr.c }}>{tr.a}</span>
    </span>
  );
}

function PulseView({ p }: { p: ThemePulse }) {
  const bar = (label: string, v: number, c: string, hint: string, invert = false) => (
    <div title={hint} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 30px', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
      <span style={{ color: C.dim }}>{label}</span>
      <div style={{ height: 7, borderRadius: 4, background: tint(c, 15) }}><div style={{ height: 7, borderRadius: 4, width: `${v}%`, background: c }} /></div>
      <b style={{ textAlign: 'right', color: invert && v >= 50 ? C.warn : C.text }}>{v}</b>
    </div>
  );
  return (
    <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {bar('News heat', p.heat, C.accent, 'Important news in the last 7 days, and whether it is rising versus the 3 weeks before')}
        {bar('Bottleneck', p.bottleneck, C.red, 'Share of the last 30 days of news that speaks of a squeeze: sold out, shortage, lead times, price hikes, allocation, record backlog')}
        {bar('Company proof', p.proof, C.green, 'Theme companies with revenue accelerating, growth level, margins, plus filed transformational events and key contracts (60 days)')}
        {bar('Crowding', p.crowding, C.warn, 'How far the theme’s shares already ran in a year — high means much is priced in (it lowers the strength)', true)}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: C.dim, lineHeight: 1.5 }}>{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {p.events.length > 0 && (
        <div>
          <div style={{ fontWeight: 800, color: C.faint, fontSize: 12, letterSpacing: 0.5, marginBottom: 4 }}>FILED EVENTS & KEY CONTRACTS (60 DAYS)</div>
          {p.events.map((e) => <div key={`${e.ticker}${e.date}${e.headline}`} style={{ fontSize: 13.5, lineHeight: 1.45, padding: '2px 0' }}><span style={{ color: C.faint }}>{e.date}</span> <b>{e.ticker}</b> <span style={{ color: e.kind === 'CONTRACT' ? C.green : C.accent, fontWeight: 700 }}>{e.kind === 'CONTRACT' ? 'contract' : String(e.strength).toLowerCase()}</span> — {e.headline}</div>)}
        </div>
      )}
      <div>
        <div style={{ fontWeight: 800, color: C.faint, fontSize: 12, letterSpacing: 0.5, marginBottom: 4 }}>LATEST NEWS ({p.news60} IN 60 DAYS · ⚡ = SQUEEZE)</div>
        {p.news.length === 0 && <div style={{ fontSize: 13.5, color: C.faint }}>No matching news yet — the archive grows every hour.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
          {p.news.map((n) => (
            <div key={n.title + n.date} style={{ fontSize: 13.5, lineHeight: 1.45 }}>
              <span style={{ color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{n.date}</span>{' '}
              {n.squeeze && <span title="Speaks of a squeeze" style={{ color: C.red, fontWeight: 900 }}>⚡ </span>}
              {n.url && /^https?:\/\//.test(n.url) ? <a href={n.url} target="_blank" rel="noopener noreferrer" style={{ color: C.text, fontWeight: 600 }}>{n.title}</a> : <span style={{ fontWeight: 600 }}>{n.title}</span>}
              {n.tickers.length > 0 && <span style={{ color: C.accent, fontWeight: 700 }}> · {n.tickers.join(', ')}</span>}
              {n.source && <span style={{ color: C.faint }}> · {n.source}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


function CandDetail({ c, region }: { c: ChokeCandidate; region: ChokeRegion }) {
  const f = c.facts;
  return (
    <div style={{ padding: '10px 12px', background: C.bg2, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 12, fontSize: 14, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div>{label('INFLECTION EVIDENCE')}{c.inflection}</div>
        <div>{label('NEXT MILESTONE')}{c.milestone}</div>
        <div>{label('WHAT WOULD PROVE IT WRONG')}<span style={{ color: C.red }}>{c.invalidation}</span></div>
        <div>{label('FUNDING / VALUATION / GOVERNANCE')}{c.concern}</div>
        {c.secondary?.length ? <div style={{ color: C.dim }}>Also exposed to: {c.secondary.join(', ')}</div> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          {label('STOCK-SCREENER FIGURES')}
          {f ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, fontSize: 13 }}>
              {[['Mkt cap', fmtChokeCap(f.cap, region) || '—'], ['Sales qtr YoY', pc(f.revQ)], ['Sales last FY', pc(f.revA)], ['EPS qtr YoY', pc(f.epsQ)], ['Op margin TTM', f.opm == null ? '—' : `${Math.round(f.opm)}%${f.opmFY != null && Math.abs(f.opm - f.opmFY) >= 15 ? ` (FY ${Math.round(f.opmFY)}% — TTM has one-offs?)` : ''}`], ['P/E', f.pe == null || f.pe <= 0 ? '—' : String(Math.round(f.pe))], ['FCF margin', f.fcfm == null ? '—' : `${Math.round(f.fcfm)}%`], ['D/E', f.de == null ? '—' : f.de.toFixed(1)]].map(([k, v]) => (
                <span key={k} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 7px', background: C.bg }}><span style={{ color: C.faint }}>{k}</span> <b>{v}</b></span>
              ))}
            </div>
          ) : <span style={{ color: C.faint }}>{c.found === false ? '⚠ Ticker not found in the stock screener — check the identity before acting.' : 'No figures.'}</span>}
          {f && <div style={{ fontSize: 12.5, color: C.faint, marginTop: 4 }}>Price context only (not the stage): 1y {pc(f.p1y)} · 5y {pc(f.p5y)}</div>}
        </div>
        <div>
          {label(`SCENARIO${c.scenario ? ` · ${c.scenario.years} YEARS` : ''} (CALCULATED)`)}
          {c.multiples && c.scenario ? (
            <>
              <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
                <thead><tr>{['', 'EPS growth / yr', 'Exit P/E', 'Share price'].map((h) => <th key={h} style={{ textAlign: 'left', color: C.faint, fontWeight: 700, padding: '2px 6px' }}>{h}</th>)}</tr></thead>
                <tbody>{(['bear', 'base', 'bull'] as const).map((k) => (
                  <tr key={k}><td style={{ padding: '2px 6px', fontWeight: 800, color: k === 'bear' ? C.red : k === 'bull' ? C.green : C.text }}>{k}</td><td style={{ padding: '2px 6px' }}>{pc(c.scenario!.epsCagr[k])}</td><td style={{ padding: '2px 6px' }}>{Math.round(c.scenario!.exitPe[k])}</td><td style={{ padding: '2px 6px', fontWeight: 900 }}>{c.multiples![k]}×</td></tr>
                ))}</tbody>
              </table>
              <div style={{ fontSize: 12.5, color: C.dim, marginTop: 4 }}>Price multiple = (1 + EPS growth)^{c.scenario.years} × (1 − {c.scenario.dilutionPct}% dilution) × exit P/E ÷ today’s P/E {c.multiples.currentPe}. No dividends. Assumptions: {c.scenario.basis}</div>
            </>
          ) : <span style={{ color: C.faint }}>{c.scenarioNote || 'Scenario not estimated — insufficient evidence'}</span>}
        </div>
      </div>
    </div>
  );
}

function CandTable({ list, region, title }: { list: ChokeCandidate[]; region: ChokeRegion; title: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return null;
  return (
    <div>
      {label(title)}
      <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead><tr style={{ background: C.bg2 }}>{['Company', 'Exposure', 'J-stage', 'Product', 'Inflection evidence', 'Next milestone'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12, color: C.faint, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map((c) => {
              const k = c.ticker; const isOpen = open === k; const sym = c.ticker.replace(/,.*$/, '').trim();
              const chk = CHECK[c.dataCheck || 'NO_DATA'];
              return (
                <Fragment key={k}>
                  <tr onClick={() => setOpen(isOpen ? null : k)} style={{ cursor: 'pointer', borderTop: `1px solid ${C.border}`, verticalAlign: 'top' }}>
                    <td style={{ padding: '7px 8px', minWidth: 140 }}>
                      <a href={`/charts?m=${region}&t=${encodeURIComponent(sym)}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontWeight: 900, color: C.text }}>{sym}</a>{c.found === false && <span title="Not found in the stock screener" style={{ color: C.warn }}> ⚠</span>}
                      <div style={{ color: C.dim, fontSize: 12.5 }}>{c.name}{c.facts?.cap != null ? ` · ${fmtChokeCap(c.facts.cap, region)}` : ''}</div>
                      {c.sizeNote && <div style={{ color: C.warn, fontSize: 12 }}>{c.sizeNote}</div>}
                    </td>
                    <td style={{ padding: '7px 8px' }}>{tag(c.exposure, EXPO_C[c.exposure], EXPOSURE_WHY[c.exposure])}</td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{tag(J_WORD[c.jstage], J_C[c.jstage], J_WHY[c.jstage])}<div style={{ marginTop: 3 }}><span title={chk.why} style={{ fontSize: 12, color: chk.c, fontWeight: 700 }}>{chk.w}</span></div></td>
                    <td style={{ padding: '7px 8px', minWidth: 160 }}>{c.product}</td>
                    <td style={{ padding: '7px 8px', minWidth: 220 }}>{c.inflection}</td>
                    <td style={{ padding: '7px 8px', minWidth: 160 }}>{c.milestone}<div style={{ color: C.faint, fontSize: 12 }}>{isOpen ? '▲ less' : '▼ evidence, figures, scenario'}</div></td>
                  </tr>
                  {isOpen && <tr><td colSpan={6} style={{ padding: 0 }}><CandDetail c={c} region={region} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ThemeCard({ t, i, region, pulse }: { t: ChokeTheme; i: number; region: ChokeRegion; pulse?: ThemePulse | null }) {
  const [showPulse, setShowPulse] = useState(false);
  const mech = ([['NECESSITY', t.necessity], ['SUPPLY CONSTRAINT', t.constraint], ['SUPPLY NOW', t.supply ? `${({ TIGHT: '🔴 Tight', EASING: '🟡 Easing', AMPLE: '⚪ Ample — not a choke point', UNKNOWN: '❔ Not established' } as Record<string, string>)[t.supply]}${t.tightness ? ` — ${t.tightness}` : ''}` : t.tightness === undefined ? '' : (t.tightness || 'Not established')], ['VALUE CAPTURE', t.valueCapture], ['WHAT COULD REMOVE IT', t.breakers]] as const).filter(([, v]) => v);
  return (
    <div style={{ border: `1px solid ${t.qualifies ? tint(C.green, 45) : C.border}`, borderRadius: 12, background: C.bg, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: tint(C.accent, 14), color: C.accent, fontWeight: 900, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
        <div style={{ fontWeight: 900, fontSize: 17.5, lineHeight: 1.3, flex: 1, minWidth: 200 }}>🔥 {t.name} <span style={{ whiteSpace: 'nowrap' }}>{t.emoji}</span></div>
        {t.qualifies ? tag('✓ figures support a candidate', C.green, 'At least one DIRECT / ENABLER company at J2 / J3 whose screener figures agree. Verified: the financial turn in screener figures. NOT verified here: that the product is the earnings driver, the scarcity economics, governance.') : tag(t.supply === 'AMPLE' ? 'not a choke point — supply ample' : 'watch — no confirmed inflection yet', C.warn, 'Needs a DIRECT / ENABLER candidate at J2 / J3 backed by its figures, in a theme whose supply is not ample')}
        {t.driver && t.driver !== 'DOMESTIC' && tag(`🌍 ${DRIVER_WORD[t.driver] || t.driver}`, C.accent, 'Where the demand step-up comes from')}
        {pulse && <StrengthBadge p={pulse} />}
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.55 }}>{t.why}</div>
      {mech.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 8 }}>
          {mech.map(([k, v]) => <div key={k} style={{ fontSize: 14, lineHeight: 1.5, padding: '7px 9px', borderRadius: 8, background: k === 'WHAT COULD REMOVE IT' ? tint(C.red, 6) : C.bg2, border: `1px solid ${C.border}` }}>{label(k)}{v}</div>)}
        </div>
      )}
      <CandTable list={t.candidates || []} region={region} title={`DISCOVERY CANDIDATES · SMALL & MID (${fmtChokeCap(DISCOVERY_CAP[region][0], region)}–${fmtChokeCap(DISCOVERY_CAP[region][1], region)})`} />
      {!(t.candidates || []).length && <div style={{ fontSize: 14, color: C.warn }}>No qualifying small / mid-cap candidates in this run.</div>}
      <CandTable list={t.reference || []} region={region} title="REFERENCE LEADERS (LARGER — CONTEXT, NOT DISCOVERY)" />
      {(t.unknowns || t.evidence) && (
        <div style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.5, borderTop: `1px dashed ${C.border}`, paddingTop: 7 }}>
          {t.evidence && <div>📰 <b>Recent:</b> {t.evidence}</div>}
          {t.unknowns && <div>❓ <b>Unknowns:</b> {t.unknowns}</div>}
        </div>
      )}
      <button type="button" onClick={() => setShowPulse((v) => !v)} disabled={pulse === undefined}
        style={{ alignSelf: 'flex-start', cursor: pulse === undefined ? 'wait' : 'pointer', fontSize: 13.5, fontWeight: 800, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.accent}`, color: C.accent, background: tint(C.accent, showPulse ? 14 : 6) }}>
        {pulse === undefined ? '📊 Market & news pulse · loading…' : pulse === null ? '📊 Market & news pulse · not available' : `📊 Market & news pulse · ${pulse.news7} news this week ${TREND[pulse.trend].a} · ${showPulse ? 'hide' : 'open'}`}
      </button>
      {showPulse && pulse && <PulseView p={pulse} />}
    </div>
  );
}

// zzz1185 — at the END of the panel, collapsed: theme changes first, company changes grouped per theme in one line each
function Changes({ changes }: { changes: Array<ChokeChange | string> }) {
  const [open, setOpen] = useState(false);
  if (!changes.length) return null;
  const KC: Record<string, string> = { ADDED: C.green, DROPPED: C.red, CHANGED: C.accent };
  const rows = changes.filter((x): x is ChokeChange => typeof x !== 'string');
  const themeRows = rows.filter((x) => x.what.startsWith('theme: '));
  const groups = new Map<string, { kind: string; region: string; theme: string; items: string[] }>();
  for (const x of rows.filter((r) => !r.what.startsWith('theme: '))) {
    const m = /^(\S+) \((.*)\)$/.exec(x.what);
    const key = `${x.kind}|${x.region}|${m ? m[2] : ''}`;
    const g = groups.get(key) || { kind: x.kind, region: x.region, theme: m ? m[2] : '', items: [] };
    g.items.push(m ? `${m[1]}${x.to ? ` (${x.to})` : ''}` : `${x.what}${x.from || x.to ? ` ${x.from ?? '—'} → ${x.to ?? '—'}` : ''}`);
    groups.set(key, g);
  }
  const counts = { ADDED: rows.filter((x) => x.kind === 'ADDED').length, DROPPED: rows.filter((x) => x.kind === 'DROPPED').length, CHANGED: rows.filter((x) => x.kind === 'CHANGED').length };
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', marginTop: 12, background: C.bg2 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.text, fontWeight: 900, fontSize: 15 }}>
        {open ? '▾' : '▸'} 🔄 What changed since the last run <span style={{ fontWeight: 600, fontSize: 13.5, color: C.dim }}>· {counts.ADDED} added · {counts.DROPPED} dropped · {counts.CHANGED} stage changes</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
          {themeRows.map((x, k) => <div key={`t${k}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 14 }}>{tag(x.kind, KC[x.kind])}<span>{x.region === 'US' ? '🇺🇸' : '🇮🇳'}</span><b>{x.what.replace(/^theme: /, '')}</b></div>)}
          {[...groups.values()].map((g, k) => (
            <div key={`g${k}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13.5, lineHeight: 1.5 }}>
              {tag(g.kind, KC[g.kind])}<span>{g.region === 'US' ? '🇺🇸' : '🇮🇳'}</span>
              <span>{g.theme && <span style={{ color: C.dim }}>{g.theme}: </span>}{g.items.join(', ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChokeThemesPanel() {
  const [report, setReport] = useState<ChokeReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ at: string; error: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ChokeRegion>('US');
  const [pulses, setPulses] = useState<Record<string, ThemePulse> | null | undefined>(undefined);
  const [order, setOrder] = useState<'evidence' | 'strength'>('evidence');

  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get('choke') === '1') { setOpen(true); setTimeout(() => document.getElementById('choke-themes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400); } else setOpen(localStorage.getItem(OPEN_KEY) === '1'); } catch { /* optional */ }
  }, []);
  const toggle = () => setOpen((v) => { try { localStorage.setItem(OPEN_KEY, v ? '0' : '1'); } catch { /* optional */ } return !v; });

  const finish = useCallback((res: { report: any; error: string | null }) => {
    if (res.report) setReport(res.report);
    if (res.error) { setFailed({ at: new Date().toISOString(), error: res.error }); setMsg(null); } else { setFailed(null); setMsg(null); }
    setBusy(false);
  }, []);
  useEffect(() => {
    fetch('/api/v1/choke-themes', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (j?.report) setReport(j.report);
      const job = j?.job;
      if (job?.state === 'running') { setBusy(true); setMsg('An AI run is in progress…'); pollJob<any>('/api/v1/choke-themes', job.startedAt, (s) => setMsg(`The AI is researching — ${s} s…`)).then(finish); }
      else if (job?.state === 'error' && job.startedAt && (!j?.report || Date.parse(job.startedAt) > Date.parse(j.report.generatedAt))) setFailed({ at: job.finishedAt || job.startedAt, error: job.error || 'failed' });
    }).catch(() => undefined).finally(() => setLoaded(true));
  }, [finish]);
  useEffect(() => {
    if (!open || !report || report.version !== 2) return;
    setPulses(undefined);
    fetch('/api/v1/choke-themes/pulse', { cache: 'no-store' }).then((r) => r.json()).then((j) => setPulses(j?.ok ? (j.pulses || {}) : null)).catch(() => setPulses(null));
  }, [open, report?.generatedAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async () => {
    setBusy(true); setFailed(null); setOpen(true); setMsg('The AI is researching companies on a J-curve — usually 2–4 minutes. You can leave this page; the result is saved.');
    try { finish(await startAndPoll<any>('/api/v1/choke-themes', (s) => setMsg(`The AI is researching — ${s} s…`))); }
    catch (e: any) { finish({ report: null, error: String(e?.message || e) }); }
  }, [finish]);

  const copy = () => { if (report) navigator.clipboard?.writeText(chokeAsText(report)).then(() => setMsg('Copied as text.')).catch(() => undefined); };
  const v2 = report?.version === 2;
  const g = report?.regions.find((x) => x.region === tab) || null;
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const btn = (on = false): React.CSSProperties => ({ cursor: 'pointer', fontSize: 13.5, fontWeight: 800, padding: '6px 12px', borderRadius: 8, border: `1px solid ${on ? C.accent : C.border}`, color: on ? C.accent : C.text, background: on ? tint(C.accent, 10) : 'transparent' });
  const themes = g ? (order === 'strength' && pulses ? [...g.themes].sort((a, b) => (pulses[`${g.region}|${b.name}`]?.strength ?? -1) - (pulses[`${g.region}|${a.name}`]?.strength ?? -1)) : g.themes) : [];

  return (
    <div id="choke-themes" style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text, fontSize: 17.5, fontWeight: 900, padding: 0 }}>
          {open ? '▾' : '▸'} 🔥 Choke-Point Themes <span style={{ fontWeight: 600, color: C.dim, fontSize: 14.5 }}>· companies on an earnings J-curve · 🇺🇸 US + 🇮🇳 India</span>
        </button>
        <span style={{ fontSize: 13.5, color: C.faint }}>
          {!loaded ? 'loading…' : report ? `Last successful research: ${fmt(report.generatedAt)}${report.marketDataAt ? ` · market data ${fmt(report.marketDataAt)}` : ''} · ${report.newsUsed} news items${report.keptFromPrevious?.length ? ` · ${report.keptFromPrevious.map((r) => (r === 'US' ? 'US' : 'India')).join(' and ')} kept from the previous run (its AI call failed)` : ''}` : 'not run yet'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {report && <button type="button" style={btn()} onClick={copy} title="Copy the whole report as text">⧉ Copy</button>}
          <button type="button" disabled={busy} onClick={run} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }} title="Runs the AI research once and saves the result. Nothing runs unless you click (at most 6 a day).">{busy ? '🤖 Researching…' : '🤖 Update with AI'}</button>
        </span>
      </div>
      {msg && <div style={{ fontSize: 14, color: busy ? C.accent : C.dim, marginTop: 6 }}>{msg}</div>}
      {failed && <div style={{ fontSize: 14, color: C.warn, marginTop: 6 }} title={failed.error}>⚠ Last update attempt failed ({fmt(failed.at)}): {failed.error}. {report ? `Showing the last successful research from ${fmt(report.generatedAt)} — it is stale.` : ''}</div>}

      {open && report && !v2 && (
        <div style={{ marginTop: 12, fontSize: 14.5, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.warn}`, background: tint(C.warn, 6) }}>
          The stored run used the old method (sector stories, price-based J-curve). Click <b>🤖 Update with AI</b> for the new company-level view: candidates with J-stage, evidence, next milestone and calculated scenarios.
          <div style={{ marginTop: 6, color: C.dim }}>Old themes: {report.regions.map((r) => `${r.region === 'US' ? '🇺🇸' : '🇮🇳'} ${r.themes.map((t) => t.name).join(' · ')}`).join('   ')}</div>
        </div>
      )}

      {open && report && v2 && g && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            {(['US', 'IN'] as ChokeRegion[]).map((r) => { const rg = report.regions.find((x) => x.region === r); return <button key={r} type="button" style={btn(tab === r)} onClick={() => setTab(r)}>{r === 'US' ? '🇺🇸 United States' : '🇮🇳 India'} <span style={{ color: C.faint }}>{rg?.themes.filter((t) => t.qualifies).length}/{rg?.themes.length}</span></button>; })}
            <span style={{ width: 1, height: 22, background: C.border, margin: '0 6px' }} />
            <button type="button" style={btn(order === 'evidence')} onClick={() => setOrder('evidence')} title="Themes ranked by the quality of their evidence-backed candidates">Rank: evidence</button>
            <button type="button" style={btn(order === 'strength')} onClick={() => setOrder('strength')} title="Market & news pulse (news, squeeze talk, company figures, contracts) — not investment quality">Rank: market & news pulse</button>
          </div>
          {(() => {   // zzz1186 — how wide the search was, so a short list is not mistaken for a full sweep
            const cv = report.coverage?.[g.region]; if (!cv) return null;
            const cands = g.themes.reduce((n, t) => n + (t.candidates || []).length, 0), q = g.themes.filter((t) => t.qualifies).length;
            return <div style={{ fontSize: 13, color: C.dim, marginBottom: 8, lineHeight: 1.5 }}>🔎 Search: {cv.universe.toLocaleString()} listed companies → {cv.inBand.toLocaleString()} in the small / mid band → {cv.turning} with turning figures + {cv.industry} in bottleneck industries sent to the AI with {cv.news} news items → {g.themes.length} themes, {cands} candidates → {q} with figure-supported candidates{report.researchUsed?.[g.region] ? ' · a reasoning research pass ran first (lists + the AI’s own knowledge of listed suppliers)' : ''}. Filings are not read one by one; screener figures are not reconciled to filings.</div>;
          })()}
          {themes.length === 0 && <div style={{ fontSize: 15, padding: 12, border: `1px dashed ${C.border}`, borderRadius: 10 }}>No theme qualified for {g.region === 'US' ? 'the US' : 'India'} in this run — better no list than filler.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {themes.map((t, i) => <ThemeCard key={t.name} t={t} i={i} region={g.region} pulse={pulses === undefined ? undefined : pulses === null ? null : (pulses[`${g.region}|${t.name}`] ?? null)} />)}
          </div>

          <div style={{ marginTop: 12, border: `1px solid ${tint(C.accent, 35)}`, borderRadius: 12, padding: 14, background: tint(C.accent, 4) }}>
            <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 8 }}>🎯 Investor Playbook — {g.region === 'US' ? '🇺🇸 US' : '🇮🇳 India'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 14 }}>
              {([['STRONGEST EVIDENCE', g.playbook.strongest, C.green], ['NEEDS CONFIRMATION', g.playbook.confirm, C.warn], ['UPCOMING MILESTONES', g.playbook.milestones, C.accent], ['WOULD WEAKEN THE THESIS', g.playbook.disconfirming, C.red], ['VALUATION TO WATCH', g.playbook.valuation, C.text]] as const).filter(([, a]) => a?.length).map(([h, a, c]) => (
                <div key={h}>
                  <div style={{ fontWeight: 900, color: c, fontSize: 12.5, letterSpacing: 0.5, marginBottom: 4 }}>{h}</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14.5, lineHeight: 1.55 }}>{a.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, color: C.dim, marginTop: 8 }}>Entry is a matter of evidence, not of price falls: reassess when a milestone is met or missed, and size by the strength of the evidence.</div>
          </div>
          <Changes changes={(report.changes || []).filter((x) => typeof x === 'string' || x.region === g.region)} />
          <div style={{ fontSize: 13, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
            J-stages and exposure classes are the AI analyst’s classifications under this method — not tested forecasts. Figures from the stock screener; scenarios calculated here from the stated assumptions. Screened using available disclosures and the AI’s knowledge as of {fmt(report.generatedAt)} — governance is not certified; check filings before acting. The market & news pulse is separate from the fundamental view. Model: {report.model || 'AI'}. Not investment advice.
          </div>
        </div>
      )}
    </div>
  );
}
