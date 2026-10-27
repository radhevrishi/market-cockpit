'use client';
// zzz1192 — Conviction Analytics tab (India on /watchlists, USA on /us-conviction-beats). Reads the bench the Conviction Beats
// tab shows and answers: which themes lead, which are crowded, which are one company's story, and which names to research
// first inside each — with every score broken into named parts. Logic: lib/conviction-analytics.ts (pure).
import React, { useEffect, useMemo, useState } from 'react';
import { classifyTheme } from '@/lib/theme-classify';
import { useThemeVerdicts } from '@/lib/theme-confluence';
import { useDecisionsMap } from '@/components/CbMarkControl';
import { cbMarkReader } from '@/lib/cb-decisions';
import {
  analyseBench, shortlist, themeQuadrant, STANCE_META, SMALL_MID_CAP,
  type CaCompany, type CaMarket, type CaRow, type CaTheme, type CaStance,
} from '@/lib/conviction-analytics';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const C = { text: 'var(--mc-text-0)', dim: 'var(--mc-text-2)', faint: 'var(--mc-text-3)', border: 'var(--mc-border-1)', bg: 'var(--mc-bg-0)', bg2: 'var(--mc-bg-2)', green: '#16A34A', red: '#DC2626', amber: '#D97706', cyan: '#0891B2', blue: '#2453C4' };
const card: React.CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 10, background: C.bg, padding: 14 };
const h2: React.CSSProperties = { fontSize: 13, fontWeight: 900, letterSpacing: 0.3, textTransform: 'uppercase', color: C.dim, margin: '0 0 8px' };

/** Turn a bench entry (India or USA shape) into one analytics row. */
function toRow(e: any, market: CaMarket, ind: Record<string, { ind?: string; sec?: string }>): Omit<CaRow, 'themeName' | 'themeEmoji' | 'tracked' | 'tape' | 'mark'> {
  const t = String(e.ticker || '').split('@')[0].toUpperCase();
  const x = ind[t] || {};
  const sector = e.sector || x.sec || null;
  const industry = e.industry || x.ind || null;
  const roce = market === 'US' ? num(e.roce?.pct) ?? num(e.roce) : num(e.roce);
  const cfo = market === 'US' ? num(e.cfo_to_pat_ratio) : (Array.isArray(e.annual_cfo_pat) ? num(e.annual_cfo_pat[e.annual_cfo_pat.length - 1]) : null);
  return {
    ticker: t, company: String(e.company || t), market,
    themeId: classifyTheme(sector, industry, market === 'US' ? 'us' : 'india', t, e.company) ?? null,
    industry: industry || sector || null,
    tier: e.tier, engineScore: num(e.composite_score),
    salesYoY: num(e.sales_yoy_pct), profitYoY: num(e.net_profit_yoy_pct), epsYoY: num(e.eps_yoy_pct),
    opm: num(e.opm_pct), opmPrev: num(e.opm_prev_pct),
    pe: num(e.pe), roce, de: num(e.de_ratio) ?? num(e.debtToEquity), cashToProfit: cfo,
    mcap: market === 'US' ? num(e.market_cap_musd) : num(e.market_cap_cr),
    filingDate: e.filing_date || null, sincePrint: num(e.move_pct), day1: num(e.d1_pct),
  };
}

export function ConvictionAnalytics({ market, entries }: { market: CaMarket; entries: any[] }) {
  const region = market === 'US' ? 'us' : 'india';
  const { byId, loading: tapeLoading } = useThemeVerdicts(region);
  const decisions = useDecisionsMap();
  const markOf = useMemo(() => cbMarkReader(decisions, market), [decisions, market]);
  const [ind, setInd] = useState<Record<string, { ind?: string; sec?: string }>>({});
  const [smallMid, setSmallMid] = useState(true);
  const [days, setDays] = useState<number | null>(null);
  const [hideRejected, setHideRejected] = useState(true);
  const [themeSel, setThemeSel] = useState<string | null>(null);
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  const [stanceSel, setStanceSel] = useState<CaStance | null>(null);

  // one entry per company (archived quarters share a ticker — keep the newest filing)
  const latest = useMemo(() => {
    const m = new Map<string, any>();
    for (const e of entries || []) {
      const t = String(e?.ticker || '').split('@')[0].toUpperCase(); if (!t) continue;
      const p = m.get(t); if (!p || String(e.filing_date || '') > String(p.filing_date || '')) m.set(t, e);
    }
    return [...m.values()];
  }, [entries]);

  // industry / sector from the stock screener (the bench rarely carries an industry, and the theme map needs one)
  const tickersKey = useMemo(() => latest.map((e) => String(e.ticker).split('@')[0].toUpperCase()).sort().join(','), [latest]);
  useEffect(() => {
    if (!tickersKey) return;
    let alive = true;
    const list = tickersKey.split(',').slice(0, 400);
    fetch(`/api/v1/stock-screener?market=${market}&tickers=${encodeURIComponent(list.join(','))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!alive || !j?.rows) return; const o: Record<string, { ind?: string; sec?: string }> = {}; for (const r of j.rows) o[String(r.t).toUpperCase()] = { ind: r.ind, sec: r.sec }; setInd(o); })
      .catch(() => {});
    return () => { alive = false; };
  }, [tickersKey, market]);

  const today = istToday();
  const rows: CaRow[] = useMemo(() => latest.map((e) => {
    const r = toRow(e, market, ind);
    const tv = r.themeId ? byId.get(r.themeId) : undefined;
    const st = markOf(r.ticker).decision?.status ?? null;
    return {
      ...r,
      themeName: tv?.name || (r.themeId ? r.themeId.replace(/[-_]/g, ' ') : (r.industry || 'Unclassified')),
      themeEmoji: tv?.emoji || (r.themeId ? '◆' : '·'), tracked: !!r.themeId, tape: tv?.verdict ?? null,
      mark: st,
    };
  }).filter((r) => (days == null || !r.filingDate || (Date.parse(today) - Date.parse(r.filingDate)) / 86_400_000 <= days)
    && (!smallMid || r.mcap == null || r.mcap <= SMALL_MID_CAP[market])
    && (!hideRejected || r.mark !== 'REJECTED')), [latest, market, ind, byId, markOf, days, smallMid, hideRejected, today]);

  const a = useMemo(() => analyseBench(rows, today), [rows, today]);
  const sl = useMemo(() => shortlist(a.themes, { smallMidOnly: smallMid }), [a.themes, smallMid]);
  const themesShown = stanceSel ? a.themes.filter((t) => t.stance === stanceSel) : a.themes;
  const compShown = themeSel ? a.companies.filter((c) => (c.themeId ? `t:${c.themeId}` : `i:${(c.industry || 'Unclassified').toLowerCase()}`) === themeSel) : a.companies;
  const capWord = market === 'US' ? '$10B' : '₹25,000 Cr';
  const fmtCap = (v: number | null) => (v == null ? '—' : market === 'US' ? (v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M`) : `₹${Math.round(v).toLocaleString('en-IN')} Cr`);
  const chip = (on: boolean, c = C.blue): React.CSSProperties => ({ cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999, border: `1px solid ${on ? c : C.border}`, background: on ? `${c}18` : C.bg, color: on ? c : C.dim });

  if (!latest.length) return <div style={{ ...card, color: C.dim }}>The Conviction Beats bench is empty — the analytics fill as names qualify.</div>;

  const stanceCount = (s: CaStance) => a.themes.filter((t) => t.stance === s).length;
  const quad = (q: ReturnType<typeof themeQuadrant>) => a.themes.filter((t) => t.n >= 2 && themeQuadrant(t) === q);

  return (
    <div style={{ display: 'grid', gap: 14, color: C.text }}>
      {/* controls */}
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 10 }}>
        <b style={{ fontSize: 13 }}>📊 Conviction Analytics · {market === 'US' ? 'USA' : 'India'}</b>
        <span style={{ fontSize: 12, color: C.faint }}>from the {latest.length} names on the bench</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={chip(smallMid, C.green)} onClick={() => setSmallMid((v) => !v)} title={`Market cap up to ${capWord}`}>Small & mid only</button>
        {[null, 90, 45, 30].map((d) => <button key={String(d)} type="button" style={chip(days === d)} onClick={() => setDays(d)}>{d == null ? 'All results' : `Results in ${d}d`}</button>)}
        <button type="button" style={chip(hideRejected, C.red)} onClick={() => setHideRejected((v) => !v)} title="Names you marked REJECTED in the logbook">Hide rejected</button>
      </div>

      {/* summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {[
          { k: 'Names', v: a.summary.names, sub: `${Math.round(a.summary.blockbusterShare * 100)}% BLOCKBUSTER` },
          { k: 'Themes', v: a.summary.themes, sub: `${stanceCount('LEAD')} leading · ${stanceCount('EMERGING')} emerging` },
          { k: 'Median sales', v: pct(a.summary.salesMed), sub: `profit ${pct(a.summary.profitMed)}` },
          { k: 'Median P/E', v: a.summary.peMed == null ? '—' : Math.round(a.summary.peMed), sub: 'profitable names' },
          { k: 'Tape agrees', v: a.summary.aligned, sub: `${a.summary.against} against${tapeLoading ? ' · loading board…' : ''}` },
          { k: 'Biggest theme', v: `${Math.round(a.summary.topThemeShare * 100)}%`, sub: 'of the bench', warn: a.summary.topThemeShare >= 0.3 },
        ].map((x) => (
          <div key={x.k} style={{ ...card, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.faint, textTransform: 'uppercase' }}>{x.k}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: (x as any).warn ? C.amber : C.text, fontVariantNumeric: 'tabular-nums' }}>{x.v}</div>
            <div style={{ fontSize: 11, color: C.dim }}>{x.sub}</div>
          </div>
        ))}
      </div>

      {/* research shortlist */}
      <div style={card}>
        <h2 style={h2}>Where to concentrate research</h2>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>Leading and emerging themes, the best two or three names in each (rejected names left out). A theme cap stops one theme dominating — themes turn together. A research order, not a recommendation.</div>
        {sl.length === 0 ? <div style={{ fontSize: 13, color: C.dim }}>No theme qualifies as leading or emerging yet — the bench is a set of company stories. Judge each name on its own filing, and keep positions small.</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {sl.map(({ theme: t, picks, cap }) => (
              <div key={t.key} style={{ border: `1px solid ${STANCE_META[t.stance].color}55`, borderRadius: 8, padding: 10, background: `${STANCE_META[t.stance].color}08` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <b>{t.emoji} {t.name}</b>
                  <span style={{ fontSize: 11, fontWeight: 900, color: STANCE_META[t.stance].color }}>{STANCE_META[t.stance].word} · {t.score}</span>
                </div>
                <div style={{ fontSize: 11, color: C.faint, margin: '2px 0 6px' }}>cap this theme at ~{cap}% of new money · {t.n} names</div>
                {picks.map((c) => (
                  <div key={c.ticker} title={[...c.plus.map((p) => `+ ${p}`), ...c.minus.map((m) => `− ${m}`)].join('\n')} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12.5, padding: '3px 0', borderTop: `1px solid ${C.border}` }}>
                    <span><b>{c.ticker}</b> <span style={{ color: C.faint }}>{c.company.slice(0, 26)}</span>{c.mark && c.mark !== 'NEUTRAL' ? <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 800, color: c.mark === 'BUY' ? C.green : C.cyan }}>{c.mark}</span> : null}</span>
                    <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{c.score}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* theme leaderboard */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ ...h2, margin: 0 }}>Themes, ranked</h2>
          <span style={{ flex: 1 }} />
          {(['LEAD', 'EMERGING', 'CROWDED', 'NEUTRAL', 'SINGLE', 'WEAK'] as CaStance[]).map((s) => stanceCount(s) > 0 && (
            <button key={s} type="button" title={STANCE_META[s].hint} style={chip(stanceSel === s, STANCE_META[s].color)} onClick={() => setStanceSel((v) => (v === s ? null : s))}>{STANCE_META[s].word} {stanceCount(s)}</button>
          ))}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: C.faint, fontSize: 11, textTransform: 'uppercase' }}>
              {['Theme', 'Stance', 'Score', 'Names', 'Sales', 'Profit', 'Margins up', 'ROCE', 'Cash-backed', 'P/E', 'PEG', 'Since results', 'Tape', 'Best names'].map((h) => <th key={h} style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {themesShown.map((t) => <ThemeRow key={t.key} t={t} open={openTheme === t.key} onOpen={() => setOpenTheme((v) => (v === t.key ? null : t.key))} onPick={() => setThemeSel((v) => (v === t.key ? null : t.key))} picked={themeSel === t.key} />)}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Score = breadth 22% · earnings 22% · margins 14% · quality 14% · value 14% · tape 9% · fresh prints 5%. Click a row for its parts; click the names count to list its companies below. Themes come from the same map as Theme Rotation; a name it cannot place is grouped by industry (·).</div>
      </div>

      {/* 2×2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        {([
          ['STRONG_ROOM', 'Strong earnings · price room', C.green, 'The sweet spot — broad earnings strength the market has not fully paid for.'],
          ['STRONG_PRICED', 'Strong earnings · priced', C.amber, 'Right theme, late entry. Wait for a pause or the next print.'],
          ['SOFT_ROOM', 'Softer earnings · cheap', C.cyan, 'Cheap for a reason until margins or breadth improve — watch.'],
          ['SOFT_PRICED', 'Softer earnings · priced', C.red, 'Paying up for narrow earnings — the setup to avoid.'],
        ] as const).map(([q, title, col, hint]) => (
          <div key={q} style={{ ...card, borderColor: `${col}66` }}>
            <div style={{ fontWeight: 900, color: col, fontSize: 13 }}>{title}</div>
            <div style={{ fontSize: 11, color: C.faint, marginBottom: 6 }}>{hint}</div>
            {quad(q).length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>—</div> : quad(q).map((t) => <div key={t.key} style={{ fontSize: 12.5 }}>{t.emoji} {t.name} <span style={{ color: C.faint }}>({t.n})</span></div>)}
          </div>
        ))}
      </div>

      {/* companies */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <h2 style={{ ...h2, margin: 0 }}>Companies, ranked {themeSel ? `· ${a.themes.find((t) => t.key === themeSel)?.name}` : ''}</h2>
          {themeSel && <button type="button" style={chip(true)} onClick={() => setThemeSel(null)}>show all ✕</button>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: C.faint, fontSize: 11, textTransform: 'uppercase' }}>
              {['#', 'Company', 'Theme', 'Score', 'Grade', 'Sales', 'Profit', 'Margin Δ', 'ROCE', 'P/E', 'PEG', 'Since results', 'Size', 'Why'].map((h) => <th key={h} style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>{compShown.slice(0, 80).map((c, i) => <CompanyRow key={c.ticker} c={c} i={i} fmtCap={fmtCap} />)}</tbody>
          </table>
        </div>
        {compShown.length > 80 && <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Top 80 of {compShown.length} shown.</div>}
      </div>

      {/* risks + discipline */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
        <div style={card}>
          <h2 style={h2}>Risks across the bench</h2>
          {a.summary.risks.length === 0 ? <div style={{ fontSize: 13, color: C.dim }}>No bench-wide warning.</div> : a.summary.risks.map((r) => <div key={r} style={{ fontSize: 12.5, padding: '4px 0', borderTop: `1px solid ${C.border}` }}>⚠ {r}</div>)}
        </div>
        <div style={card}>
          <h2 style={h2}>How to use this</h2>
          {[
            'A theme counts only when three or more companies print it. Two is a hint, one is a company story.',
            'Pick from Leading first, Emerging second. Crowded themes are right but late — wait for the next print or a pause.',
            'Inside a theme, prefer cash-backed profit, rising margins and a PEG near or below 1 over the biggest growth number.',
            'Two or three names per theme, and no theme above about a quarter of new money — themes rise and fall together.',
            'Before buying, write what would prove you wrong (a margin, an order, a date). Re-read it at every result.',
          ].map((r) => <div key={r} style={{ fontSize: 12.5, padding: '3px 0' }}>• {r}</div>)}
          <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Research priorities from filed figures — not a forecast or advice.</div>
        </div>
      </div>
    </div>
  );
}

function ThemeRow({ t, open, onOpen, onPick, picked }: { t: CaTheme; open: boolean; onOpen: () => void; onPick: () => void; picked: boolean }) {
  const m = STANCE_META[t.stance];
  const td: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const tapeC = t.tape === 'BUY' || t.tape === 'EARLY BUY' ? C.green : t.tape === 'AVOID' || t.tape === 'TRIM' ? C.red : C.dim;
  return (
    <>
      <tr onClick={onOpen} style={{ cursor: 'pointer', background: open ? C.bg2 : undefined }}>
        <td style={{ ...td, fontWeight: 800 }}>{t.emoji} {t.name}{!t.tracked && <span style={{ color: C.faint, fontWeight: 400 }} title="Not on the Theme Rotation map — grouped by industry"> (industry)</span>}</td>
        <td style={td}><span title={m.hint} style={{ fontSize: 11, fontWeight: 900, color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '1px 7px' }}>{m.word}</span></td>
        <td style={td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><b>{t.score}</b><span style={{ width: 50, height: 5, background: C.bg2, borderRadius: 3 }}><span style={{ display: 'block', height: 5, width: `${t.score}%`, background: m.color, borderRadius: 3 }} /></span></span></td>
        <td style={td}><button type="button" onClick={(e) => { e.stopPropagation(); onPick(); }} style={{ cursor: 'pointer', border: `1px solid ${picked ? C.blue : C.border}`, background: picked ? `${C.blue}15` : C.bg, borderRadius: 6, fontWeight: 800, padding: '1px 7px', color: C.text }}>{t.n}{t.blockbusters ? ` · ${t.blockbusters}★` : ''}</button></td>
        <td style={td}>{pct(t.salesMed)}</td>
        <td style={td}>{pct(t.profitMed)}</td>
        <td style={td}>{t.marginUpShare == null ? '—' : `${Math.round(t.marginUpShare * 100)}%`}</td>
        <td style={td}>{t.roceMed == null ? '—' : `${Math.round(t.roceMed)}%`}</td>
        <td style={td}>{t.cashShare == null ? '—' : `${Math.round(t.cashShare * 100)}%`}</td>
        <td style={td}>{t.peMed == null ? '—' : Math.round(t.peMed)}</td>
        <td style={td}>{t.pegMed == null ? '—' : t.pegMed.toFixed(1)}</td>
        <td style={{ ...td, color: (t.sinceMed ?? 0) > 50 ? C.amber : C.text }}>{pct(t.sinceMed)}</td>
        <td style={{ ...td, color: tapeC, fontWeight: 700 }}>{t.tape || '—'}</td>
        <td style={{ ...td, whiteSpace: 'normal', minWidth: 160 }}>{t.companies.slice(0, 3).map((c) => c.ticker).join(', ')}</td>
      </tr>
      {open && (
        <tr><td colSpan={14} style={{ padding: '8px 12px', background: C.bg2, fontSize: 12.5 }}>
          <div style={{ marginBottom: 6 }}>{t.why.join(' · ')}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {Object.entries(t.parts).map(([k, v]) => <span key={k} style={{ fontSize: 11.5 }}><b style={{ color: v >= 60 ? C.green : v < 40 ? C.red : C.dim }}>{v}</b> {k}</span>)}
          </div>
          <div style={{ marginTop: 6, color: C.dim }}>{STANCE_META[t.stance].hint}</div>
        </td></tr>
      )}
    </>
  );
}

function CompanyRow({ c, i, fmtCap }: { c: CaCompany; i: number; fmtCap: (v: number | null) => string }) {
  const [open, setOpen] = useState(false);
  const td: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const dm = c.opm != null && c.opmPrev != null ? c.opm - c.opmPrev : null;
  const sc = c.score >= 70 ? C.green : c.score >= 55 ? C.cyan : c.score >= 40 ? C.amber : C.red;
  return (
    <>
      <tr onClick={() => setOpen((v) => !v)} style={{ cursor: 'pointer', opacity: c.mark === 'REJECTED' ? 0.5 : 1 }}>
        <td style={{ ...td, color: C.faint }}>{i + 1}</td>
        <td style={td}><b>{c.ticker}</b> <span style={{ color: C.faint }}>{c.company.slice(0, 28)}</span>{c.mark && c.mark !== 'NEUTRAL' && <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 800, color: c.mark === 'BUY' ? C.green : c.mark === 'REJECTED' ? C.red : C.cyan }}>{c.mark}</span>}</td>
        <td style={{ ...td, color: C.dim }}>{c.themeEmoji} {c.themeName}</td>
        <td style={td}><b style={{ color: sc }}>{c.score}</b></td>
        <td style={{ ...td, fontSize: 11, fontWeight: 800, color: c.tier === 'BLOCKBUSTER' ? C.amber : C.green }}>{c.tier}</td>
        <td style={td}>{pct(c.salesYoY)}</td>
        <td style={td}>{pct(c.profitYoY ?? c.epsYoY)}</td>
        <td style={{ ...td, color: dm == null ? C.text : dm >= 0 ? C.green : C.red }}>{dm == null ? '—' : `${dm >= 0 ? '+' : ''}${dm.toFixed(1)}pt`}</td>
        <td style={td}>{c.roce == null ? '—' : `${Math.round(c.roce)}%`}</td>
        <td style={td}>{c.pe == null ? '—' : c.pe <= 0 ? 'loss' : Math.round(c.pe)}</td>
        <td style={td}>{c.peg == null ? '—' : c.peg.toFixed(1)}</td>
        <td style={{ ...td, color: (c.sincePrint ?? 0) > 80 ? C.amber : C.text }}>{pct(c.sincePrint)}</td>
        <td style={td}>{fmtCap(c.mcap)}</td>
        <td style={{ ...td, color: C.faint }}>{open ? '▲' : `${c.plus.length}+ ${c.minus.length}−`}</td>
      </tr>
      {open && (
        <tr><td colSpan={14} style={{ padding: '8px 12px', background: C.bg2, fontSize: 12.5 }}>
          {c.plus.map((p) => <div key={p} style={{ color: C.green }}>+ {p}</div>)}
          {c.minus.map((p) => <div key={p} style={{ color: C.red }}>− {p}</div>)}
          {c.filingDate && <div style={{ color: C.faint, marginTop: 4 }}>results filed {c.filingDate}{c.industry ? ` · ${c.industry}` : ''}</div>}
        </td></tr>
      )}
    </>
  );
}
