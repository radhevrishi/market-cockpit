'use client';

// zzz344 + zzz345 — Multibagger per-screener breakdown + cross-screen Analytics.
// Reads local /data/screener/*.csv (auto-synced daily by GitHub Action).
// Two views: Analytics (cross-screen overlaps, metric aggregates) + Per-Screener (individual tables).

import React, { useEffect, useMemo, useState } from 'react';

type ScreenDef = { slug: string; label: string; emoji: string; url: string };

const SCREENS: ScreenDef[] = [
  { slug: 'stocks-like-bajaj-consumer', label: 'Stocks like Bajaj Consumer', emoji: '🧴', url: 'https://www.screener.in/screens/3549314/stocks-like-bajaj-consumer/' },
  { slug: 'rajeev-thakkar-ppfas-screener', label: 'Rajeev Thakkar PPFAS', emoji: '💎', url: 'https://www.screener.in/screens/3565418/rajeev-thakkar-ppfas-screener/' },
  { slug: 'pead-master-screener-rishi-framework', label: 'PEAD Master (Rishi Framework)', emoji: '🎯', url: 'https://www.screener.in/screens/3612486/pead-master-screener-rishi-framework/' },
  { slug: 'multibagger-like-acutaasatlantadee-dev', label: 'Multibagger: Acutaas/Atlanta/Dee-Dev', emoji: '🚀', url: 'https://www.screener.in/screens/3601571/multibagger-like-acutaasatlantadee-dev/' },
  { slug: 'multibagger2-ignoring-trend', label: 'Multibagger 2 (Ignoring Trend)', emoji: '💥', url: 'https://www.screener.in/screens/3545352/multibagger2-ignoring-trend/' },
  { slug: 'fii', label: 'FII Screener', emoji: '🏦', url: 'https://www.screener.in/screens/3443614/fii/' },
  { slug: 'future-leaders', label: 'Future Leaders', emoji: '👑', url: 'https://www.screener.in/screens/3470949/future-leaders/' },
  { slug: 'great-results-and-pullback', label: 'Great Results + Pullback', emoji: '📉', url: 'https://www.screener.in/screens/3658091/great-results-and-pullback/' },
];

const C = { bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937', text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B', green: '#22C55E', red: '#EF4444', cyan: '#06B6D4', gold: '#FBBF24', purple: '#A78BFA', amber: '#F59E0B' };

const PRIORITY_COLS = ['S.No.','Name','CMP Rs.','Mar Cap Rs.Cr.','P/E','Qtr Profit Var %','Qtr Sales Var %','Sales growth %','Profit growth %','ROCE %','ROIC %','OPM %','CFO/PAT','Debt / Eq','PEG','1Yr return %','Prom. Hold. %','FII Hold %','DII Hold %','Pledged %'];

type Row = Record<string, string | number> & { __ticker?: string };
type ScreenData = { columns: string[]; rows: Row[]; err?: string };

function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; continue; } inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function toNumber(s: string): number | string {
  const t = String(s).replace(/,/g, '').trim();
  if (!t || t === '—' || t === '-' || t === 'N/A') return '';
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : s;
}

function parseCsv(csv: string): ScreenData {
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { columns: [], rows: [] };
  const columns = splitCsvLine(lines[0]);
  const nameIdx = columns.findIndex(c => c.toLowerCase() === 'name');
  const rows: Row[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    if (cells.length < 3) continue;
    const row: Row = {};
    for (let i = 0; i < cells.length; i++) {
      const col = columns[i] || `col_${i}`;
      row[col] = toNumber(cells[i]);
    }
    if (nameIdx >= 0) {
      const nm = String(cells[nameIdx] || '').trim();
      row.__ticker = nm.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
    }
    rows.push(row);
  }
  return { columns, rows };
}

// ── ANALYTICS TAB ─────────────────────────────────────────────────────────
function AnalyticsView({ allData, benchTickers }: { allData: Record<string, ScreenData>; benchTickers: Set<string> }) {
  // Build ticker → screens map + row cache
  const analysis = useMemo(() => {
    const tickerToScreens: Record<string, { slugs: string[]; row: Row; name: string }> = {};
    for (const s of SCREENS) {
      const d = allData[s.slug];
      if (!d?.rows) continue;
      for (const r of d.rows) {
        const t = String(r.__ticker || '').toUpperCase();
        const name = String(r['Name'] || t);
        if (!t) continue;
        if (!tickerToScreens[t]) tickerToScreens[t] = { slugs: [], row: r, name };
        if (!tickerToScreens[t].slugs.includes(s.slug)) tickerToScreens[t].slugs.push(s.slug);
      }
    }
    const entries = Object.entries(tickerToScreens).map(([t, v]) => ({ t, ...v, count: v.slugs.length }));
    entries.sort((a, b) => b.count - a.count);
    return entries;
  }, [allData]);

  const multiScreen = analysis.filter(e => e.count >= 2);
  const inBench = analysis.filter(e => benchTickers.has(e.t));
  const inBenchAndMulti = multiScreen.filter(e => benchTickers.has(e.t));

  // Screen ↔ screen intersection matrix
  const matrix = useMemo(() => {
    const m: number[][] = [];
    for (let i = 0; i < SCREENS.length; i++) {
      m[i] = [];
      const si = new Set((allData[SCREENS[i].slug]?.rows || []).map(r => String(r.__ticker || '').toUpperCase()).filter(Boolean));
      for (let j = 0; j < SCREENS.length; j++) {
        if (i === j) { m[i][j] = si.size; continue; }
        const sj = allData[SCREENS[j].slug]?.rows || [];
        let overlap = 0;
        for (const r of sj) if (si.has(String(r.__ticker || '').toUpperCase())) overlap++;
        m[i][j] = overlap;
      }
    }
    return m;
  }, [allData]);

  // Sector distribution (all screens combined)
  const sectorDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of analysis) {
      // Sector guess: use 'GPM Qtr %' proximity or sector column if present in row. Screener CSV has no sector col.
      // Fallback: skip sector until Screener export exposes it.
    }
    return counts;
  }, [analysis]);

  // Metric leaders across combined universe
  const metricLeaders = useMemo(() => {
    const flat: Array<Row & { __t: string }> = [];
    const seen = new Set<string>();
    for (const s of SCREENS) {
      for (const r of (allData[s.slug]?.rows || [])) {
        const t = String(r.__ticker || '').toUpperCase();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        flat.push({ ...r, __t: t });
      }
    }
    const top = (col: string, n = 5, asc = false) => {
      const withVal = flat.filter(r => typeof r[col] === 'number');
      withVal.sort((a, b) => asc ? (a[col] as number) - (b[col] as number) : (b[col] as number) - (a[col] as number));
      return withVal.slice(0, n).map(r => ({ t: r.__t, name: r['Name'], v: r[col] as number }));
    };
    return {
      roce: top('ROCE %', 5),
      cfoPat: top('CFO/PAT', 5),
      profitVar: top('Qtr Profit Var %', 5),
      salesGrowth: top('Sales growth %', 5),
      lowPE: top('P/E', 5, true),
      returnY: top('1Yr return %', 5),
    };
  }, [allData]);

  const loaded = SCREENS.filter(s => allData[s.slug]?.rows?.length).length;
  const totalStocks = Object.values(allData).reduce((sum, d) => sum + (d?.rows?.length || 0), 0);
  const uniqueTickers = analysis.length;

  if (loaded === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.text2 }}>Loading all 8 CSVs…</div>;
  }

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Screens loaded" value={`${loaded}/8`} color={C.cyan} />
        <StatCard label="Total picks" value={String(totalStocks)} color={C.text} />
        <StatCard label="Unique tickers" value={String(uniqueTickers)} color={C.text} />
        <StatCard label="In 2+ screens" value={String(multiScreen.length)} color={C.gold} sub="high-conviction overlap" />
        <StatCard label="In your CB bench" value={String(inBench.length)} color={C.gold} sub={`${inBenchAndMulti.length} also in 2+ screens`} />
      </div>

      {/* Multi-screen leaderboard */}
      <Panel title="🏆 Multi-Screen Conviction Leaders" subtitle="Tickers appearing in 2 or more screens ranked by count. More appearances = higher institutional conviction across different lenses.">
        {multiScreen.length === 0 ? (
          <div style={{ padding: 20, color: C.text3 }}>No cross-screen overlaps yet.</div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: 500 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, background: C.panel2, zIndex: 1 }}>
                <tr>
                  <th style={thStyle}>Rank</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Screens</th>
                  <th style={thStyle}>In</th>
                  <th style={thStyle}>CB?</th>
                  <th style={thStyle}>CMP</th>
                  <th style={thStyle}>P/E</th>
                  <th style={thStyle}>ROCE %</th>
                  <th style={thStyle}>1Y Ret</th>
                </tr>
              </thead>
              <tbody>
                {multiScreen.map((e, i) => {
                  const cb = benchTickers.has(e.t);
                  return (
                    <tr key={e.t} style={{ background: cb ? C.gold + '11' : (i % 2 ? C.panel2 : 'transparent'), borderLeft: cb ? `3px solid ${C.gold}` : '3px solid transparent' }}>
                      <td style={tdStyle}><span style={{ fontWeight: 800, color: e.count >= 3 ? C.amber : C.cyan }}>#{i+1}</span></td>
                      <td style={tdStyle}><span style={{ color: cb ? C.gold : C.cyan, fontWeight: 600 }}>{cb && '⭐ '}{e.name}</span></td>
                      <td style={tdStyle}><span style={{ background: C.gold + '22', color: C.gold, padding: '2px 8px', borderRadius: 4, fontWeight: 800 }}>{e.count}</span></td>
                      <td style={{ ...tdStyle, fontSize: 11 }}>
                        {e.slugs.map(sl => SCREENS.find(s => s.slug === sl)?.emoji).join(' ')}
                      </td>
                      <td style={tdStyle}>{cb ? '✓' : '—'}</td>
                      <td style={tdStyle}>{fmt(e.row['CMP Rs.'])}</td>
                      <td style={{ ...tdStyle, color: peColor(e.row['P/E']) }}>{fmt(e.row['P/E'])}</td>
                      <td style={{ ...tdStyle, color: goodBadColor(e.row['ROCE %'], 15, 5) }}>{fmt(e.row['ROCE %'])}</td>
                      <td style={{ ...tdStyle, color: numColor(e.row['1Yr return %']) }}>{fmt(e.row['1Yr return %'])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Screen intersection matrix */}
      <Panel title="🔗 Screen × Screen Overlap Matrix" subtitle="How many tickers each pair of screens shares. Diagonal = size of each screen.">
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, position: 'sticky', left: 0, background: C.panel2 }}></th>
                {SCREENS.map(s => (
                  <th key={s.slug} style={{ ...thStyle, textAlign: 'center', minWidth: 60 }} title={s.label}>{s.emoji}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SCREENS.map((s, i) => (
                <tr key={s.slug}>
                  <td style={{ ...tdStyle, fontWeight: 700, position: 'sticky', left: 0, background: C.panel2, whiteSpace: 'nowrap' }} title={s.label}>{s.emoji} {s.label.slice(0, 22)}</td>
                  {SCREENS.map((_, j) => {
                    const v = matrix[i]?.[j] ?? 0;
                    const isDiag = i === j;
                    const bg = isDiag ? C.cyan + '22' : v > 0 ? `rgba(251,191,36,${Math.min(v / 10, 0.6)})` : 'transparent';
                    return (
                      <td key={j} style={{ ...tdStyle, textAlign: 'center', background: bg, fontWeight: isDiag ? 700 : 500, color: v > 0 ? C.text : C.text3 }}>{v}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Metric leaders */}
      <Panel title="🥇 Metric Leaders Across All Screens" subtitle="Top 5 tickers (across combined 8-screen universe) for each key metric.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          <MetricLeader title="Highest ROCE %" data={metricLeaders.roce} color={C.green} bench={benchTickers} />
          <MetricLeader title="Best CFO/PAT" data={metricLeaders.cfoPat} color={C.green} bench={benchTickers} />
          <MetricLeader title="Top Qtr Profit Var %" data={metricLeaders.profitVar} color={C.green} bench={benchTickers} />
          <MetricLeader title="Top Sales Growth %" data={metricLeaders.salesGrowth} color={C.green} bench={benchTickers} />
          <MetricLeader title="Lowest P/E (value)" data={metricLeaders.lowPE} color={C.cyan} bench={benchTickers} />
          <MetricLeader title="Top 1Y Return %" data={metricLeaders.returnY} color={C.amber} bench={benchTickers} />
        </div>
      </Panel>
    </div>
  );
}

// ── HELPER COMPONENTS ────────────────────────────────────────────────────
const thStyle: React.CSSProperties = { padding: '9px 10px', borderBottom: `2px solid ${C.border}`, textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.text2, whiteSpace: 'nowrap', letterSpacing: '0.3px' };
const tdStyle: React.CSSProperties = { padding: '7px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, whiteSpace: 'nowrap' };

function StatCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: C.text3, letterSpacing: '0.5px', marginBottom: 6 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.text2, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 16 }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: C.text2, marginTop: 4 }}>{subtitle}</div>}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function MetricLeader({ title, data, color, bench }: { title: string; data: Array<{ t: string; name: any; v: number }>; color: string; bench: Set<string> }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: color, marginBottom: 8, letterSpacing: '0.3px' }}>{title.toUpperCase()}</div>
      {data.length === 0 ? (<div style={{ color: C.text3, fontSize: 12 }}>No data</div>) : (
        <table style={{ width: '100%', fontSize: 12.5 }}>
          <tbody>
            {data.map((d, i) => {
              const cb = bench.has(d.t);
              return (
                <tr key={d.t} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '5px 6px', color: C.text3, width: 20 }}>{i+1}</td>
                  <td style={{ padding: '5px 6px', color: cb ? C.gold : C.text, fontWeight: 600 }}>{cb && '⭐ '}{String(d.name || d.t).slice(0, 24)}</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', color: color, fontWeight: 700 }}>{fmt(d.v)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function fmt(v: any): string { return typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v || ''); }
function peColor(v: any): string { if (typeof v !== 'number') return C.text; if (v > 0 && v < 20) return C.green; if (v > 50) return C.red; return C.text; }
function numColor(v: any): string { if (typeof v !== 'number') return C.text; return v > 0 ? C.green : v < 0 ? C.red : C.text; }
function goodBadColor(v: any, good: number, bad: number): string { if (typeof v !== 'number') return C.text; if (v >= good) return C.green; if (v < bad) return C.red; return C.text; }

// ── MAIN PAGE ────────────────────────────────────────────────────────────
export default function MultibaggerScreensPage() {
  const [view, setView] = useState<'analytics' | 'per-screener'>('analytics');
  const [activeSlug, setActiveSlug] = useState<string>(SCREENS[0].slug);
  const [data, setData] = useState<Record<string, ScreenData>>({});
  const [benchTickers, setBenchTickers] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [q, setQ] = useState<string>('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('mc:conviction-beats:v1') || '{}';
      const bench = JSON.parse(raw);
      const set = new Set<string>();
      for (const k of Object.keys(bench)) {
        const t = String(bench[k]?.ticker || k).toUpperCase();
        if (t) set.add(t);
      }
      setBenchTickers(set);
    } catch {}
  }, []);

  // Fetch all screens on mount (Analytics needs them all)
  useEffect(() => {
    for (const s of SCREENS) {
      if (data[s.slug]) continue;
      fetch(`/data/screener/${s.slug}.csv`, { cache: 'no-store' })
        .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
        .then(csv => setData(prev => ({ ...prev, [s.slug]: parseCsv(csv) })))
        .catch(e => setData(prev => ({ ...prev, [s.slug]: { columns: [], rows: [], err: String(e) } })));
    }
  }, []);

  const activeScreen = SCREENS.find(s => s.slug === activeSlug)!;
  const activeData = data[activeSlug];

  const orderedCols = useMemo(() => {
    if (!activeData?.columns?.length) return [];
    const cols = activeData.columns;
    const prio = PRIORITY_COLS.filter(c => cols.includes(c));
    const rest = cols.filter(c => !prio.includes(c));
    return [...prio, ...rest];
  }, [activeData]);

  const filteredRows = useMemo(() => {
    if (!activeData?.rows?.length) return [];
    let rows = activeData.rows.slice();
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(needle));
    }
    if (sortCol) {
      rows.sort((a, b) => {
        const av = a[sortCol]; const bv = b[sortCol];
        const an = typeof av === 'number' ? av : parseFloat(String(av)) || 0;
        const bn = typeof bv === 'number' ? bv : parseFloat(String(bv)) || 0;
        return sortDir === 'asc' ? an - bn : bn - an;
      });
    }
    return rows;
  }, [activeData, sortCol, sortDir, q]);

  const overlapCount = useMemo(() => {
    if (!activeData?.rows) return 0;
    let n = 0;
    for (const r of activeData.rows) {
      const t = String(r.__ticker || '').toUpperCase();
      if (t && benchTickers.has(t)) n++;
    }
    return n;
  }, [activeData, benchTickers]);

  const cellStyleFn = (col: string, val: any): React.CSSProperties => {
    const base: React.CSSProperties = { padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, color: C.text, whiteSpace: 'nowrap' };
    if (typeof val !== 'number') return base;
    if (col.includes('Profit Var') || col.includes('Sales Var') || col.includes('return') || col.includes('growth')) { if (val > 0) base.color = C.green; else if (val < 0) base.color = C.red; }
    if (col.includes('P/E') || col.includes('PEG')) { if (val > 0 && val < 20) base.color = C.green; else if (val > 50) base.color = C.red; }
    if (col === 'Debt / Eq') { if (val < 0.3) base.color = C.green; else if (val > 1.5) base.color = C.red; }
    if (col === 'CFO/PAT') { if (val >= 0.8) base.color = C.green; else if (val < 0.3) base.color = C.red; }
    return base;
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, padding: '24px 28px 80px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.text3, marginBottom: 4, letterSpacing: '0.5px' }}>MULTIBAGGER · CSV-BACKED</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 4px', letterSpacing: '-0.4px' }}>🔍 Per-Screener Breakdown</h1>
        <div style={{ fontSize: 13, color: C.text2 }}>8 screens · /data/screener/ (synced daily) · CB bench overlap in gold</div>
      </div>

      {/* View switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
        <button onClick={() => setView('analytics')} style={{ padding: '10px 20px', background: view === 'analytics' ? C.cyan + '22' : C.panel, border: `1px solid ${view === 'analytics' ? C.cyan : C.border}`, borderRadius: 8, color: view === 'analytics' ? C.cyan : C.text, fontSize: 14, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.3px' }}>📊 Analytics</button>
        <button onClick={() => setView('per-screener')} style={{ padding: '10px 20px', background: view === 'per-screener' ? C.cyan + '22' : C.panel, border: `1px solid ${view === 'per-screener' ? C.cyan : C.border}`, borderRadius: 8, color: view === 'per-screener' ? C.cyan : C.text, fontSize: 14, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.3px' }}>📋 Per-Screener</button>
      </div>

      {view === 'analytics' && <AnalyticsView allData={data} benchTickers={benchTickers} />}

      {view === 'per-screener' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {SCREENS.map(s => {
              const active = s.slug === activeSlug;
              const rows = data[s.slug]?.rows?.length ?? null;
              return (
                <button key={s.slug} onClick={() => setActiveSlug(s.slug)} style={{ padding: '9px 16px', background: active ? C.cyan + '22' : C.panel, border: `1px solid ${active ? C.cyan : C.border}`, borderRadius: 8, color: active ? C.cyan : C.text, fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.2px' }}>
                  {s.emoji} {s.label}
                  {rows !== null && (<span style={{ marginLeft: 8, color: active ? C.cyan : C.text3, fontWeight: 600 }}>({rows})</span>)}
                </button>
              );
            })}
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 18px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{activeScreen.emoji} {activeScreen.label}</div>
              <div style={{ fontSize: 12, color: C.text2, marginTop: 4 }}>
                {activeData?.rows?.length ?? 0} stocks
                {overlapCount > 0 && (<span style={{ marginLeft: 12, color: C.gold, fontWeight: 700 }}>· ⭐ {overlapCount} in your CB bench</span>)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ padding: '7px 12px', background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 13, width: 200, outline: 'none' }} />
              <a href={activeScreen.url} target="_blank" rel="noreferrer" style={{ padding: '7px 12px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text2, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>🔗 Open on Screener</a>
            </div>
          </div>

          {activeData?.err && (
            <div style={{ padding: 20, background: C.red + '11', border: `1px solid ${C.red}44`, borderRadius: 8 }}>
              <div style={{ color: C.red, fontWeight: 700 }}>Load failed: {activeData.err}</div>
            </div>
          )}
          {activeData && !activeData.err && orderedCols.length > 0 && (
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'auto', maxHeight: '75vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
                <thead style={{ position: 'sticky', top: 0, background: C.panel2, zIndex: 2 }}>
                  <tr>
                    {orderedCols.map(col => {
                      const isSort = col === sortCol;
                      return (
                        <th key={col} onClick={() => { if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc'); } }} style={{ padding: '10px 12px', borderBottom: `2px solid ${C.border}`, textAlign: 'left', fontSize: 11, fontWeight: 700, color: isSort ? C.cyan : C.text2, cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.3px', userSelect: 'none' }}>
                          {col} {isSort && (sortDir === 'asc' ? '▲' : '▼')}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, i) => {
                    const t = String(r.__ticker || '').toUpperCase();
                    const inBench = t && benchTickers.has(t);
                    return (
                      <tr key={i} style={{ background: inBench ? C.gold + '11' : (i % 2 ? C.panel2 : 'transparent'), borderLeft: inBench ? `3px solid ${C.gold}` : '3px solid transparent' }}>
                        {orderedCols.map(col => {
                          const val = r[col];
                          const isName = col === 'Name';
                          return (
                            <td key={col} style={cellStyleFn(col, val)}>
                              {isName && val ? (<span style={{ color: inBench ? C.gold : C.cyan, fontWeight: 600 }}>{inBench && '⭐ '}{String(val)}</span>) : (typeof val === 'number' ? val.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(val || ''))}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: C.text3, textAlign: 'center' }}>
        Data source: /data/screener/*.csv · synced daily by GitHub Action · gold rows = ticker in CB bench
      </div>
    </div>
  );
}
