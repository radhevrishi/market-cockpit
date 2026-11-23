'use client';
// zzz1291 — Company Lab side-by-side table: column groups the owner can switch on and off (kept in this browser),
// Rule of 40, growth acceleration, margins, dilution, cash conversion, debt ÷ equity and the cash-squeeze score,
// plus the per-company squeeze panel and the one-button book loader.
import { useEffect, useMemo, useState } from 'react';
import { R, tint } from '@/components/special-situations/radar-tokens';
import type { LabCard } from '@/lib/company-lab/server';
import { fcfPriceGap, type QuarterReport } from '@/lib/company-lab/quarterly';

const COLS_KEY = 'mc:company-lab:cols:v1';
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const capText = (c: LabCard) => (c.cap == null ? 'size n/a' : c.market === 'IN' ? `₹${Math.round(c.cap).toLocaleString('en-IN')} Cr` : c.cap >= 1000 ? `$${(c.cap / 1000).toFixed(1)}B` : `$${Math.round(c.cap)}M`);
const LEVEL_C: Record<string, string> = { Low: R.green, Watch: R.amber, High: R.red, Unknown: R.faint };
const ACC: Record<string, { t: string; c: string }> = { accelerating: { t: '▲ speeding up', c: R.green }, decelerating: { t: '▼ slowing', c: R.red }, steady: { t: '● steady', c: R.dim }, unknown: { t: '—', c: R.faint } };
const TR: Record<string, string> = { up: '▲', down: '▼', flat: '●', unknown: '' };

type Col = { id: string; group: string; h: string; tip: string; cell: (c: LabCard) => React.ReactNode; sort: (c: LabCard) => number };
const Q = (c: LabCard): QuarterReport | undefined => c.quarter;
const last = (c: LabCard) => c.years[c.years.length - 1];
const yieldOf = (c: LabCard) => { const y = last(c); return y?.fcf != null && c.cap ? (y.fcf / c.cap) * 100 : null; };
const gapOf = (c: LabCard) => fcfPriceGap(c.years, c.price);
const col = (v: number | null | undefined, good: (x: number) => boolean, bad: (x: number) => boolean) => (v == null ? R.faint : good(v) ? R.green : bad(v) ? R.red : R.text);

export const COLS: Col[] = [
  { id: 'fcfChecks', group: 'Free cash flow', h: 'FCF checks', tip: 'FCF checklist items passed ÷ items that could be checked', cell: (c) => `${c.fcf.passed}/${c.fcf.known}`, sort: (c) => (c.fcf.known ? c.fcf.passed / c.fcf.known : -1) },
  { id: 'fcfM', group: 'Free cash flow', h: 'FCF margin', tip: 'Latest full year: FCF ÷ revenue', cell: (c) => <span style={{ color: col(last(c)?.fcfM, (x) => x >= 10, (x) => x < 0) }}>{pct(last(c)?.fcfM)}</span>, sort: (c) => last(c)?.fcfM ?? -999 },
  { id: 'fcfY', group: 'Free cash flow', h: 'FCF yield', tip: "Latest full year FCF ÷ today's market cap", cell: (c) => pct(yieldOf(c)), sort: (c) => yieldOf(c) ?? -999 },
  { id: 'gap', group: 'Free cash flow', h: 'FCF/share vs price (3 yr)', tip: 'FCF per share change vs share price change over up to three full years. ◆ = cash up 30%+, price flat (≤ +10%): a research lead, not a buy signal.', cell: (c) => { const g = gapOf(c); return g.fcfPsG == null ? '—' : <span title={g.from ? `from ${g.from}` : ''} style={{ color: g.flag ? R.cyan : R.text, fontWeight: g.flag ? 800 : 400 }}>{g.flag ? '◆ ' : ''}{pct(g.fcfPsG)} / {pct(g.priceG)}</span>; }, sort: (c) => { const g = gapOf(c); return g.fcfPsG != null && g.priceG != null ? g.fcfPsG - g.priceG : -999; } },
  { id: 'r40', group: 'Growth', h: 'Rule of 40', tip: "Latest quarter's revenue growth vs the same quarter a year earlier + FCF margin (last 4 quarters, else latest year). 40+ passes.", cell: (c) => { const r = Q(c)?.r40; return r?.value == null ? '—' : <span title={`${pct(r.revYoY)} revenue (${r.quarter}) + ${pct(r.fcfMargin)} FCF margin (${r.fcfFrom})`} style={{ fontWeight: 800, color: r.value >= 40 ? R.green : r.value >= 20 ? R.amber : R.red }}>{r.value.toFixed(0)} <span style={{ fontWeight: 400, color: R.faint, fontSize: 12 }}>= {r.revYoY?.toFixed(0)}+{r.fcfMargin?.toFixed(0)}</span></span>; }, sort: (c) => Q(c)?.r40.value ?? -999 },
  { id: 'revQ', group: 'Growth', h: 'Revenue YoY (qtr)', tip: 'Latest quarter vs the same quarter a year earlier', cell: (c) => pct(Q(c)?.r40.revYoY), sort: (c) => Q(c)?.r40.revYoY ?? -999 },
  { id: 'accel', group: 'Growth', h: 'Growth trend (last 4 qtrs)', tip: 'Year-on-year revenue growth of the last four quarters, oldest → newest', cell: (c) => { const a = Q(c)?.accel; if (!a) return '—'; const s = ACC[a.state]; return <span title={a.text}><span style={{ color: s.c, fontWeight: 800 }}>{s.t}</span> <span style={{ color: R.faint, fontSize: 12 }}>{a.last.map((v) => (v == null ? '·' : v.toFixed(0))).join(' → ')}</span></span>; }, sort: (c) => { const a = Q(c)?.accel; return a?.state === 'accelerating' ? 2 : a?.state === 'steady' ? 1 : a?.state === 'decelerating' ? 0 : -1; } },
  { id: 'revG', group: 'Growth', h: 'Revenue growth (yr)', tip: 'Latest full year vs the year before', cell: (c) => pct(last(c)?.revG), sort: (c) => last(c)?.revG ?? -999 },
  { id: 'epsG', group: 'Growth', h: 'EPS growth (yr)', tip: 'Latest full year vs the year before', cell: (c) => pct(last(c)?.epsG), sort: (c) => last(c)?.epsG ?? -999 },
  { id: 'gm', group: 'Margins', h: 'Gross margin', tip: 'Latest quarter, and the move vs the same quarter a year earlier', cell: (c) => { const g = Q(c)?.gm; return g?.now == null ? '—' : <span title={g.label}>{g.now.toFixed(1)}% <span style={{ color: g.trend === 'up' ? R.green : g.trend === 'down' ? R.red : R.faint }}>{TR[g.trend]}{g.yearAgo != null ? ` ${(g.now - g.yearAgo) > 0 ? '+' : ''}${(g.now - g.yearAgo).toFixed(1)}` : ''}</span></span>; }, sort: (c) => Q(c)?.gm.now ?? -999 },
  { id: 'om', group: 'Margins', h: 'Operating margin', tip: 'Latest quarter, and the move vs the same quarter a year earlier', cell: (c) => { const g = Q(c)?.om; return g?.now == null ? '—' : <span title={g.label}>{g.now.toFixed(1)}% <span style={{ color: g.trend === 'up' ? R.green : g.trend === 'down' ? R.red : R.faint }}>{TR[g.trend]}{g.yearAgo != null ? ` ${(g.now - g.yearAgo) > 0 ? '+' : ''}${(g.now - g.yearAgo).toFixed(1)}` : ''}</span></span>; }, sort: (c) => Q(c)?.om.now ?? -999 },
  { id: 'dil', group: 'Quality', h: 'Dilution (3 yr)', tip: 'Change in share count over up to three years (positive = more shares)', cell: (c) => { const d = Q(c)?.dilution; return d?.pct == null ? '—' : <span title={d.text} style={{ color: d.pct >= 10 ? R.red : d.pct >= 4 ? R.amber : d.pct <= -3 ? R.green : R.text }}>{pct(d.pct)}</span>; }, sort: (c) => -(Q(c)?.dilution.pct ?? 999) },
  { id: 'cfoPat', group: 'Quality', h: 'CFO / PAT', tip: 'Operating cash ÷ net profit, latest year (3-year in the tooltip). Above 1 = profit backed by cash.', cell: (c) => { const x = Q(c)?.cfoPat; return x?.latest == null ? <span style={{ color: R.faint }} title={x?.text}>—</span> : <span title={x.text} style={{ color: col(x.latest, (v) => v >= 0.9, (v) => v < 0.6) }}>{x.latest.toFixed(2)}×</span>; }, sort: (c) => Q(c)?.cfoPat.latest ?? -999 },
  { id: 'de', group: 'Quality', h: 'Debt ÷ equity', tip: 'Total debt ÷ shareholders’ equity, latest year end', cell: (c) => { const x = Q(c)?.de; return x?.value == null ? <span style={{ color: R.faint }} title={x?.text}>—</span> : <span title={x.text} style={{ color: col(x.value, (v) => v <= 0.5, (v) => v > 1.5) }}>{x.value.toFixed(2)}×</span>; }, sort: (c) => -(Q(c)?.de.value ?? 99) },
  { id: 'squeeze', group: 'Cash squeeze', h: 'Cash squeeze', tip: 'Six checks: cash, capex, operating cash, FCF, debt, receivables vs revenue. 3+ warnings = look closer.', cell: (c) => { const s = Q(c)?.squeeze; if (!s) return '—'; return <span title={s.items.filter((i) => i.state === 'warn').map((i) => `⚠ ${i.label}: ${i.value}`).join('\n') || 'no warnings'} style={{ color: LEVEL_C[s.level], fontWeight: 800 }}>{s.level}{s.level !== 'Unknown' ? ` ${s.warns}/${s.known}` : ''}{s.keyCombo ? ' ⚡' : ''}</span>; }, sort: (c) => { const s = Q(c)?.squeeze; return s && s.level !== 'Unknown' ? -s.warns : -99; } },
  { id: 'capexOcf', group: 'Cash squeeze', h: 'Capex ÷ OCF', tip: 'Capital spending ÷ operating cash (last 4 quarters; India: whole investing outflow)', cell: (c) => { const v = Q(c)?.squeeze.ratios.capexToOcf; return v == null ? '—' : <span style={{ color: col(v, (x) => x <= 50, (x) => x > 100) }}>{v.toFixed(0)}%</span>; }, sort: (c) => -(Q(c)?.squeeze.ratios.capexToOcf ?? 999) },
  { id: 'runway', group: 'Cash squeeze', h: 'Cash runway', tip: 'Quarters of cash left at the current free-cash burn (only when FCF is negative)', cell: (c) => { const v = Q(c)?.squeeze.ratios.runwayQ; return v == null ? <span style={{ color: R.faint }}>no burn</span> : <span style={{ color: v < 6 ? R.red : v < 12 ? R.amber : R.text }}>{v.toFixed(1)} qtrs</span>; }, sort: (c) => Q(c)?.squeeze.ratios.runwayQ ?? 999 },
  { id: 'stage', group: 'Technicals', h: 'Stage', tip: 'Weekly Stage Analysis', cell: (c) => (c.stage.st != null ? `Stage ${c.stage.st}` : '—'), sort: (c) => (c.stage.st === 2 ? 2 : c.stage.st === 1 ? 1 : 0) },
  { id: 'tt', group: 'Technicals', h: 'Trend template', tip: 'Minervini trend template rules met', cell: (c) => `${c.stage.tt ?? c.trend.filter((r) => r.ok).length}/6`, sort: (c) => c.stage.tt ?? c.trend.filter((r) => r.ok).length },
  { id: 'rsIdx', group: 'Technicals', h: 'RS vs index', tip: 'Stock return ÷ index return', cell: (c) => (c.rs?.ratio == null ? '—' : `${c.rs.ratio.toFixed(2)}×`), sort: (c) => c.rs?.ratio ?? -1 },
  { id: 'rs', group: 'Technicals', h: 'RS', tip: 'RS rating 1–99', cell: (c) => (c.stage.rsR == null ? '—' : String(Math.round(c.stage.rsR))), sort: (c) => c.stage.rsR ?? -1 },
];
const DEFAULT = ['fcfChecks', 'fcfM', 'fcfY', 'gap', 'r40', 'accel', 'gm', 'om', 'dil', 'cfoPat', 'de', 'squeeze', 'stage', 'rs'];
const GROUPS = Array.from(new Set(COLS.map((c) => c.group)));

export function Compare({ cards }: { cards: LabCard[] }) {
  const [on, setOn] = useState<string[]>(DEFAULT);
  const [sortId, setSortId] = useState('r40');
  const [desc, setDesc] = useState(true);
  const [pick, setPick] = useState(false);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(COLS_KEY) || 'null'); if (Array.isArray(v) && v.length) setOn(v.filter((x) => COLS.some((c) => c.id === x))); } catch { /* default */ } }, []);
  const save = (v: string[]) => { setOn(v); try { localStorage.setItem(COLS_KEY, JSON.stringify(v)); } catch { /* not kept */ } };
  const cols = COLS.filter((c) => on.includes(c.id));
  const ok = cards.filter((c) => c.ok);
  const sc = COLS.find((c) => c.id === sortId) ?? cols[0];
  const rows = useMemo(() => ok.slice().sort((a, b) => (desc ? 1 : -1) * ((sc?.sort(b) ?? 0) - (sc?.sort(a) ?? 0))), [ok, sc, desc]);
  if (ok.length < 1) return null;
  const groupSpans = GROUPS.map((g) => ({ g, n: cols.filter((c) => c.group === g).length })).filter((x) => x.n);
  return (
    <div style={{ border: `1px solid ${R.border}`, borderRadius: 10, background: R.bg }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderBottom: `1px solid ${R.border}` }}>
        <b style={{ fontSize: 14 }}>Side by side · {ok.length} companies</b>
        <button type="button" onClick={() => setPick((p) => !p)} style={{ fontSize: 13, fontWeight: 800, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${R.cyan}`, background: tint(R.cyan, pick ? 14 : 6), color: R.cyan }}>⚙ Columns ({cols.length}/{COLS.length})</button>
        {pick && <button type="button" onClick={() => save(DEFAULT)} style={{ fontSize: 12.5, padding: '4px 8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${R.border}`, background: 'transparent', color: R.faint }}>Reset</button>}
      </div>
      {pick && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, padding: 10, borderBottom: `1px solid ${R.border}`, background: R.bg2 }}>
          {GROUPS.map((g) => {
            const gc = COLS.filter((c) => c.group === g), all = gc.every((c) => on.includes(c.id));
            return (
              <div key={g}>
                <label style={{ fontSize: 12.5, fontWeight: 900, color: R.dim, cursor: 'pointer', display: 'flex', gap: 6 }}><input type="checkbox" checked={all} onChange={() => save(all ? on.filter((x) => !gc.some((c) => c.id === x)) : Array.from(new Set([...on, ...gc.map((c) => c.id)])))} />{g.toUpperCase()}</label>
                {gc.map((c) => <label key={c.id} title={c.tip} style={{ fontSize: 13, display: 'flex', gap: 6, marginLeft: 14, cursor: 'pointer' }}><input type="checkbox" checked={on.includes(c.id)} onChange={() => save(on.includes(c.id) ? on.filter((x) => x !== c.id) : COLS.map((k) => k.id).filter((id) => id === c.id || on.includes(id)))} />{c.h}</label>)}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ background: R.bg2 }}>
              <th />
              {groupSpans.map(({ g, n }) => <th key={g} colSpan={n} style={{ fontSize: 11, letterSpacing: '0.5px', color: R.faint, padding: '4px 8px', borderLeft: `1px solid ${R.border}`, textAlign: 'center' }}>{g.toUpperCase()}</th>)}
            </tr>
            <tr style={{ background: R.bg2 }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', position: 'sticky', left: 0, background: R.bg2 }}>Company</th>
              {GROUPS.flatMap((g) => cols.filter((c) => c.group === g)).map((c, i, arr) => (
                <th key={c.id} title={c.tip} onClick={() => { if (sortId === c.id) setDesc((d) => !d); else { setSortId(c.id); setDesc(true); } }}
                  style={{ textAlign: 'right', padding: '6px 8px', cursor: 'pointer', color: c.id === sortId ? R.cyan : R.faint, whiteSpace: 'nowrap', borderLeft: i === 0 || arr[i - 1].group !== c.group ? `1px solid ${R.border}` : undefined }}>
                  {c.h}{c.id === sortId ? (desc ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.market}:${c.ticker}`} style={{ borderTop: `1px solid ${R.border}` }}>
                <td style={{ padding: '6px 8px', position: 'sticky', left: 0, background: R.bg, whiteSpace: 'nowrap' }}>
                  <a href={`#lab-${c.market}-${c.ticker}`} style={{ color: R.text, textDecoration: 'none' }}><b>{c.ticker}</b></a> <span style={{ color: R.faint, fontSize: 12 }}>{c.market === 'US' ? '🇺🇸' : '🇮🇳'} {capText(c)}</span>
                  {c.name && <div style={{ fontSize: 12, color: R.dim, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>}
                </td>
                {GROUPS.flatMap((g) => cols.filter((k) => k.group === g)).map((k, i, arr) => <td key={k.id} style={{ textAlign: 'right', padding: '6px 8px', whiteSpace: 'nowrap', borderLeft: i === 0 || arr[i - 1].group !== k.group ? `1px solid ${R.border}` : undefined }}>{k.cell(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12.5, color: R.faint, padding: '6px 10px', lineHeight: 1.5 }}>
        Click a column to sort (again to flip). Hover a heading or a value for how it is worked out. ⚡ = rising capex + worsening free cash flow + falling cash together.
        India: cash flow and balance sheet are yearly on screener.in, so its squeeze check is yearly and receivables are not known.
        <br />◆ A rising FCF/share line with a flat share price is a research lead — not an automatic undervaluation signal. The market may be anticipating weaker future economics.
      </div>
    </div>
  );
}

/** Per-company cash-squeeze + quarterly read, shown inside each company card. */
export function QuarterPanel({ c }: { c: LabCard }) {
  const q = c.quarter;
  if (!q) return null;
  const s = q.squeeze;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {[
          ['RULE OF 40', q.r40.value == null ? '—' : `${q.r40.value.toFixed(0)}`, q.r40.value == null ? 'needs quarterly revenue and FCF' : `${pct(q.r40.revYoY)} revenue (${q.r40.quarter}) + ${pct(q.r40.fcfMargin)} FCF margin (${q.r40.fcfFrom})`, q.r40.value == null ? R.faint : q.r40.value >= 40 ? R.green : q.r40.value >= 20 ? R.amber : R.red],
          ['GROWTH TREND', ACC[q.accel.state].t, q.accel.text, ACC[q.accel.state].c],
          ['GROSS MARGIN', q.gm.now == null ? '—' : `${q.gm.now.toFixed(1)}% ${TR[q.gm.trend]}`, q.gm.yearAgo == null ? q.gm.label : `${q.gm.label} vs ${q.gm.yearAgo.toFixed(1)}% a year earlier`, q.gm.trend === 'down' ? R.red : q.gm.trend === 'up' ? R.green : R.text],
          ['OPERATING MARGIN', q.om.now == null ? '—' : `${q.om.now.toFixed(1)}% ${TR[q.om.trend]}`, q.om.yearAgo == null ? q.om.label : `${q.om.label} vs ${q.om.yearAgo.toFixed(1)}% a year earlier`, q.om.trend === 'down' ? R.red : q.om.trend === 'up' ? R.green : R.text],
          ['DILUTION', q.dilution.pct == null ? '—' : pct(q.dilution.pct), q.dilution.text, q.dilution.pct == null ? R.faint : q.dilution.pct >= 10 ? R.red : q.dilution.pct <= -3 ? R.green : R.text],
          ['CFO / PAT', q.cfoPat.latest == null ? '—' : `${q.cfoPat.latest.toFixed(2)}×`, q.cfoPat.text, q.cfoPat.latest == null ? R.faint : q.cfoPat.latest >= 0.9 ? R.green : q.cfoPat.latest < 0.6 ? R.red : R.text],
          ['DEBT ÷ EQUITY', q.de.value == null ? '—' : `${q.de.value.toFixed(2)}×`, q.de.text, q.de.value == null ? R.faint : q.de.value <= 0.5 ? R.green : q.de.value > 1.5 ? R.red : R.text],
        ].map(([h, v, sub, c2]) => (
          <div key={h as string} style={{ border: `1px solid ${R.border}`, borderRadius: 8, padding: '6px 9px' }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: R.faint, letterSpacing: '0.5px' }}>{h}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: c2 as string }}>{v}</div>
            <div style={{ fontSize: 12, color: R.dim, lineHeight: 1.35 }}>{sub}</div>
          </div>
        ))}
      </div>
      <div style={{ border: `1px solid ${tint(LEVEL_C[s.level], 50)}`, borderRadius: 8, padding: '8px 10px', background: tint(LEVEL_C[s.level], 5) }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>Cash-squeeze check</b>
          <span style={{ fontWeight: 900, color: LEVEL_C[s.level] }}>{s.level === 'Unknown' ? 'Not enough data' : `${s.level} · ${s.warns} of ${s.known} warnings`}</span>
          {s.keyCombo && <span style={{ fontWeight: 900, color: R.red }}>⚡ rising capex + worsening FCF + falling cash</span>}
          <span style={{ fontSize: 12, color: R.faint }}>{s.period}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 4, marginTop: 6 }}>
          {s.items.map((i) => (
            <div key={i.id} title={i.why} style={{ fontSize: 13 }}>
              <span style={{ color: i.state === 'warn' ? R.red : i.state === 'ok' ? R.green : R.faint, fontWeight: 900 }}>{i.state === 'warn' ? '⚠' : i.state === 'ok' ? '✓' : '?'}</span> {i.label} <span style={{ color: R.dim }}>· {i.value}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: R.dim, marginTop: 6 }}>
          Capex ÷ operating cash: <b>{s.ratios.capexToOcf == null ? '—' : `${s.ratios.capexToOcf.toFixed(0)}%`}</b> · Cash runway: <b>{s.ratios.runwayQ == null ? 'no cash burn' : `${s.ratios.runwayQ.toFixed(1)} quarters`}</b> · Receivables vs revenue growth: <b>{s.ratios.recvG == null ? '—' : `${pct(s.ratios.recvG)} vs ${pct(s.ratios.revG)}`}</b>
          <span style={{ color: R.faint }}> · Rule: 3+ warnings = investigate before trusting the growth.</span>
        </div>
      </div>
    </div>
  );
}

type Entry = { m: 'IN' | 'US'; t: string };
const clean = (s: string) => String(s || '').toUpperCase().trim().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|US|IN):/, '').replace(/\.(NS|BO)$/, '').replace(/[^A-Z0-9&.\-]/g, '');
/** One-button loaders: the watchlist, the India book and the US book, plus Refresh (latest filings). */
export function BookLoader({ onAdd, onRefresh, busy }: { onAdd: (e: Entry[], replace: boolean) => void; onRefresh: () => void; busy: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const fromLs = (k: string): any[] => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const watch = () => {
    const out: Entry[] = [];
    for (const x of fromLs('mc_watchlist_tickers')) { const t = clean(typeof x === 'string' ? x : x?.ticker ?? x?.symbol); if (t) out.push({ m: /^\d+$/.test(t) ? 'IN' : 'IN', t }); }
    // chart watchlists carry the exchange
    try { const lists = JSON.parse(localStorage.getItem('mc:chart-watchlists:v1') || 'null'); const all: any[] = Array.isArray(lists) ? lists : Array.isArray(lists?.lists) ? lists.lists : []; for (const l of all) for (const r of (l?.items || l?.rows || [])) { const t = clean(r?.symbol ?? r?.ticker ?? r); if (!t) continue; const ex = String(r?.exchange || r?.market || '').toUpperCase(); const m = /NSE|BSE|IN/.test(ex) ? 'IN' : ex ? 'US' : 'IN'; if (!out.some((e) => e.t === t)) out.push({ m, t }); } } catch { /* none */ }
    setMsg(out.length ? `Watchlist: ${out.length} names (a name not found in India is looked up in the USA)` : 'Watchlist is empty in this browser');
    if (out.length) onAdd(out, replace);
  };
  const book = async (m: 'IN' | 'US') => {
    const out: Entry[] = [];
    for (const h of fromLs('mc_portfolio_holdings')) { const t = clean(h?.symbol); if (t && (h?.market ?? 'IN') === m) out.push({ m, t }); }
    if (m === 'US') {
      try { const r = await fetch('/api/v1/us-book', { cache: 'no-store' }); const j: any = await r.json(); for (const h of j?.book?.holdings || j?.holdings || []) { const t = clean(h?.ticker); if (t && !out.some((e) => e.t === t)) out.push({ m: 'US', t }); } } catch { /* local only */ }
    }
    setMsg(out.length ? `${m === 'IN' ? 'India' : 'US'} book: ${out.length} holdings` : `No ${m === 'IN' ? 'India' : 'US'} holdings found`);
    if (out.length) onAdd(out, replace);
  };
  const btn = (t: string, f: () => void, c: string) => <button type="button" disabled={busy} onClick={f} style={{ fontSize: 13, fontWeight: 800, padding: '5px 11px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', border: `1px solid ${c}`, background: tint(c, 8), color: c }}>{t}</button>;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 12.5, fontWeight: 900, color: R.faint }}>ONE CLICK:</span>
      {btn('📋 My watchlist', watch, R.cyan)}
      {btn('💼 India book', () => void book('IN'), R.green)}
      {btn('💼 US book', () => void book('US'), R.green)}
      {btn('🔄 Refresh all — latest filings', onRefresh, R.amber)}
      <label style={{ fontSize: 12.5, color: R.dim, display: 'inline-flex', gap: 5, cursor: 'pointer' }}><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> replace the list (else add)</label>
      {msg && <span style={{ fontSize: 12.5, color: R.dim }}>{msg}</span>}
    </div>
  );
}
