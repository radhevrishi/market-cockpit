'use client';

// zzz346 — Multibagger screens breakdown: Analytics + Combined (filterable) + Per-Screener.
// Reads /data/screener/*.csv. Uses actual CSV column names + NSE Code for ticker matching.

import React, { useEffect, useMemo, useState } from 'react';

type ScreenDef = { slug: string; label: string; short: string; emoji: string; url: string };
const SCREENS: ScreenDef[] = [
  { slug: 'stocks-like-bajaj-consumer', label: 'Stocks like Bajaj Consumer', short: 'Bajaj Consumer', emoji: '🧴', url: 'https://www.screener.in/screens/3549314/stocks-like-bajaj-consumer/' },
  { slug: 'rajeev-thakkar-ppfas-screener', label: 'Rajeev Thakkar PPFAS', short: 'PPFAS', emoji: '💎', url: 'https://www.screener.in/screens/3565418/rajeev-thakkar-ppfas-screener/' },
  { slug: 'pead-master-screener-rishi-framework', label: 'PEAD Master (Rishi Framework)', short: 'PEAD Master', emoji: '🎯', url: 'https://www.screener.in/screens/3612486/pead-master-screener-rishi-framework/' },
  { slug: 'multibagger-like-acutaasatlantadee-dev', label: 'Multibagger: Acutaas/Atlanta/Dee-Dev', short: 'Multibagger 1', emoji: '🚀', url: 'https://www.screener.in/screens/3601571/multibagger-like-acutaasatlantadee-dev/' },
  { slug: 'multibagger2-ignoring-trend', label: 'Multibagger 2 (Ignoring Trend)', short: 'Multibagger 2', emoji: '💥', url: 'https://www.screener.in/screens/3545352/multibagger2-ignoring-trend/' },
  { slug: 'fii', label: 'FII Screener', short: 'FII', emoji: '🏦', url: 'https://www.screener.in/screens/3443614/fii/' },
  { slug: 'future-leaders', label: 'Future Leaders', short: 'Future Leaders', emoji: '👑', url: 'https://www.screener.in/screens/3470949/future-leaders/' },
  { slug: 'great-results-and-pullback', label: 'Great Results + Pullback', short: 'Great Results', emoji: '📉', url: 'https://www.screener.in/screens/3658091/great-results-and-pullback/' },
];

const C = { bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937', text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B', green: '#22C55E', red: '#EF4444', cyan: '#06B6D4', gold: '#FBBF24', amber: '#F59E0B', purple: '#A78BFA' };

// Actual Screener CSV column names → display alias
const COL_ALIAS: Record<string, string> = {
  'Current Price': 'CMP', 'Market Capitalization': 'Mkt Cap ₹Cr',
  'YOY Quarterly profit growth': 'Qtr Profit %', 'YOY Quarterly sales growth': 'Qtr Sales %',
  'Price to Earning': 'P/E', 'Return over 1year': '1Y Ret %',
  'Debt to equity': 'D/E', 'CFO to PAT': 'CFO/PAT', 'PEG Ratio': 'PEG',
  'Sales growth': 'Sales Gr %', 'Profit growth': 'Profit Gr %',
  'Promoter holding': 'Prom %', 'FII holding': 'FII %', 'DII holding': 'DII %',
  'Return on invested capital': 'ROIC %', 'Return on capital employed': 'ROCE %',
  'OPM': 'OPM %', 'Pledged percentage': 'Pledge %', 'Industry PE': 'Ind PE',
  'From 52w high': '52W↓', 'Price to book value': 'P/BV',
  'EVEBITDA': 'EV/EBITDA', 'GPM latest quarter': 'GPM %', 'Interest Coverage Ratio': 'Int Cov',
  'EPS': 'EPS', 'Debt': 'Debt', 'Free cash flow last year': 'FCF',
  'Working Capital Days': 'WC Days', 'Sales growth 3Years': 'Sales 3Y %',
  'Profit growth 3Years': 'Profit 3Y %',
};

// Priority columns to show first
const PRIORITY_COLS = [
  'Name', 'NSE Code', 'Industry', 'Current Price', 'Market Capitalization', 'Price to Earning',
  'YOY Quarterly profit growth', 'YOY Quarterly sales growth', 'Sales growth', 'Profit growth',
  'Return on capital employed', 'Return on invested capital', 'OPM', 'CFO to PAT',
  'Debt to equity', 'PEG Ratio', 'Return over 1year',
  'Promoter holding', 'FII holding', 'DII holding',
];

type Row = Record<string, string | number> & { __ticker?: string; __sector?: string };
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
  const nseIdx = columns.findIndex(c => c === 'NSE Code');
  const bseIdx = columns.findIndex(c => c === 'BSE Code');
  const indIdx = columns.findIndex(c => c === 'Industry');
  const rows: Row[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    if (cells.length < 3) continue;
    const row: Row = {};
    for (let i = 0; i < cells.length; i++) {
      const col = columns[i] || `col_${i}`;
      row[col] = toNumber(cells[i]);
    }
    const nseCode = nseIdx >= 0 ? String(cells[nseIdx] || '').trim().toUpperCase() : '';
    const bseCode = bseIdx >= 0 ? String(cells[bseIdx] || '').trim() : '';
    row.__ticker = nseCode || bseCode;
    row.__sector = indIdx >= 0 ? String(cells[indIdx] || '').trim() : '';
    rows.push(row);
  }
  return { columns, rows };
}

// ── ANALYTICS TAB ────────────────────────────────────────────────
function AnalyticsView({ allData, benchTickers }: { allData: Record<string, ScreenData>; benchTickers: Set<string> }) {
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

  const sectorDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of analysis) {
      const sec = String(e.row.__sector || 'Unknown');
      counts[sec] = (counts[sec] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [analysis]);

  const mcapBuckets = useMemo(() => {
    const buckets = { 'MEGA (≥2L Cr)': 0, 'LARGE (20k-2L Cr)': 0, 'MID (5k-20k Cr)': 0, 'SMALL (500-5k Cr)': 0, 'MICRO (<500 Cr)': 0, 'Unknown': 0 };
    for (const e of analysis) {
      const mc = e.row['Market Capitalization'];
      if (typeof mc !== 'number') { buckets['Unknown']++; continue; }
      if (mc >= 200000) buckets['MEGA (≥2L Cr)']++;
      else if (mc >= 20000) buckets['LARGE (20k-2L Cr)']++;
      else if (mc >= 5000) buckets['MID (5k-20k Cr)']++;
      else if (mc >= 500) buckets['SMALL (500-5k Cr)']++;
      else buckets['MICRO (<500 Cr)']++;
    }
    return buckets;
  }, [analysis]);

  const metricLeaders = useMemo(() => {
    const flat = analysis.map(e => ({ ...e.row, __t: e.t, __name: e.name }));
    const top = (col: string, n = 5, asc = false) => {
      const withVal = flat.filter(r => typeof r[col] === 'number' && (col === 'Price to Earning' ? (r[col] as number) > 0 : true));
      withVal.sort((a, b) => asc ? (a[col] as number) - (b[col] as number) : (b[col] as number) - (a[col] as number));
      return withVal.slice(0, n).map(r => ({ t: r.__t, name: r.__name, v: r[col] as number }));
    };
    return {
      roce: top('Return on capital employed', 5),
      cfoPat: top('CFO to PAT', 5),
      profitVar: top('YOY Quarterly profit growth', 5),
      salesGrowth: top('Sales growth', 5),
      lowPE: top('Price to Earning', 5, true),
      returnY: top('Return over 1year', 5),
    };
  }, [analysis]);

  const loaded = SCREENS.filter(s => allData[s.slug]?.rows?.length).length;
  const totalStocks = Object.values(allData).reduce((sum, d) => sum + (d?.rows?.length || 0), 0);

  if (loaded === 0) return <div style={{ padding: 40, textAlign: 'center', color: C.text2 }}>Loading all 8 CSVs…</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Screens loaded" value={`${loaded}/8`} color={C.cyan} />
        <StatCard label="Total picks" value={String(totalStocks)} color={C.text} />
        <StatCard label="Unique tickers" value={String(analysis.length)} color={C.text} />
        <StatCard label="In 2+ screens" value={String(multiScreen.length)} color={C.gold} sub="high-conviction overlap" />
        <StatCard label="In your CB bench" value={String(inBench.length)} color={C.gold} sub={`${inBenchAndMulti.length} also in 2+ screens`} />
      </div>

      <Panel title="🏆 Multi-Screen Conviction Leaders" subtitle="Tickers appearing in 2+ screens ranked by count. More appearances = higher institutional conviction.">
        {multiScreen.length === 0 ? <Empty /> : (
          <div style={{ overflow: 'auto', maxHeight: 500 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, background: C.panel2, zIndex: 1 }}>
                <tr>
                  <th style={thStyle}>#</th><th style={thStyle}>Name</th><th style={thStyle}>NSE</th>
                  <th style={thStyle}>N</th><th style={thStyle}>In</th><th style={thStyle}>CB</th>
                  <th style={thStyle}>CMP</th><th style={thStyle}>Mkt Cap</th><th style={thStyle}>P/E</th>
                  <th style={thStyle}>ROCE</th><th style={thStyle}>CFO/PAT</th><th style={thStyle}>Sales Gr</th><th style={thStyle}>1Y Ret</th>
                </tr>
              </thead>
              <tbody>
                {multiScreen.map((e, i) => {
                  const cb = benchTickers.has(e.t);
                  return (
                    <tr key={e.t} style={{ background: cb ? C.gold + '11' : (i % 2 ? C.panel2 : 'transparent'), borderLeft: cb ? `3px solid ${C.gold}` : '3px solid transparent' }}>
                      <td style={tdStyle}><b style={{ color: e.count >= 3 ? C.amber : C.cyan }}>#{i+1}</b></td>
                      <td style={tdStyle}><span style={{ color: cb ? C.gold : C.cyan, fontWeight: 600 }}>{cb && '⭐ '}{e.name}</span></td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: C.text2 }}>{e.t}</td>
                      <td style={tdStyle}><span style={{ background: C.gold + '22', color: C.gold, padding: '2px 8px', borderRadius: 4, fontWeight: 800 }}>{e.count}</span></td>
                      <td style={{ ...tdStyle, fontSize: 11 }}>{e.slugs.map(sl => SCREENS.find(s => s.slug === sl)?.emoji).join(' ')}</td>
                      <td style={tdStyle}>{cb ? '✓' : '—'}</td>
                      <td style={tdStyle}>{fmt(e.row['Current Price'])}</td>
                      <td style={tdStyle}>{fmt(e.row['Market Capitalization'])}</td>
                      <td style={{ ...tdStyle, color: peColor(e.row['Price to Earning']) }}>{fmt(e.row['Price to Earning'])}</td>
                      <td style={{ ...tdStyle, color: goodBadColor(e.row['Return on capital employed'], 15, 5) }}>{fmt(e.row['Return on capital employed'])}</td>
                      <td style={{ ...tdStyle, color: goodBadColor(e.row['CFO to PAT'], 0.8, 0.3) }}>{fmt(e.row['CFO to PAT'])}</td>
                      <td style={{ ...tdStyle, color: numColor(e.row['Sales growth']) }}>{fmt(e.row['Sales growth'])}</td>
                      <td style={{ ...tdStyle, color: numColor(e.row['Return over 1year']) }}>{fmt(e.row['Return over 1year'])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <Panel title="🏭 Sector Distribution" subtitle="Top sectors across combined universe.">
          {sectorDist.length === 0 ? <Empty /> : (
            <div>{sectorDist.map(([sec, n]) => (
              <div key={sec} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: C.text }}>{sec}</span>
                  <span style={{ color: C.text2, fontWeight: 700 }}>{n}</span>
                </div>
                <div style={{ height: 6, background: C.panel2, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, (n / sectorDist[0][1]) * 100)}%`, height: '100%', background: C.cyan }} />
                </div>
              </div>
            ))}</div>
          )}
        </Panel>

        <Panel title="🏦 Market Cap Buckets" subtitle="Size distribution of picks.">
          <div>{Object.entries(mcapBuckets).map(([label, n]) => (
            <div key={label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: C.text }}>{label}</span>
                <span style={{ color: C.text2, fontWeight: 700 }}>{n}</span>
              </div>
              <div style={{ height: 6, background: C.panel2, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (n / Math.max(1, analysis.length)) * 100 * 3)}%`, height: '100%', background: label.includes('MEGA') ? C.purple : label.includes('LARGE') ? C.cyan : label.includes('MID') ? C.green : label.includes('SMALL') ? C.amber : C.red }} />
              </div>
            </div>
          ))}</div>
        </Panel>
      </div>

      <Panel title="🔗 Screen × Screen Overlap Matrix" subtitle="Shared tickers per pair. Diagonal = screen size.">
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr>
              <th style={{ ...thStyle, position: 'sticky', left: 0, background: C.panel2 }}></th>
              {SCREENS.map(s => <th key={s.slug} style={{ ...thStyle, textAlign: 'center', minWidth: 55 }} title={s.label}>{s.emoji}</th>)}
            </tr></thead>
            <tbody>
              {SCREENS.map((s, i) => (
                <tr key={s.slug}>
                  <td style={{ ...tdStyle, fontWeight: 700, position: 'sticky', left: 0, background: C.panel2, whiteSpace: 'nowrap' }} title={s.label}>{s.emoji} {s.short}</td>
                  {SCREENS.map((_, j) => {
                    const v = matrix[i]?.[j] ?? 0;
                    const isDiag = i === j;
                    const bg = isDiag ? C.cyan + '22' : v > 0 ? `rgba(251,191,36,${Math.min(v / 8, 0.6)})` : 'transparent';
                    return <td key={j} style={{ ...tdStyle, textAlign: 'center', background: bg, fontWeight: isDiag ? 700 : 500, color: v > 0 ? C.text : C.text3 }}>{v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="🥇 Metric Leaders Across All Screens" subtitle="Top 5 tickers per metric across combined universe.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          <MetricLeader title="Highest ROCE %" data={metricLeaders.roce} color={C.green} bench={benchTickers} />
          <MetricLeader title="Best CFO/PAT" data={metricLeaders.cfoPat} color={C.green} bench={benchTickers} />
          <MetricLeader title="Top Qtr Profit %" data={metricLeaders.profitVar} color={C.green} bench={benchTickers} />
          <MetricLeader title="Top Sales Growth %" data={metricLeaders.salesGrowth} color={C.green} bench={benchTickers} />
          <MetricLeader title="Lowest P/E (value)" data={metricLeaders.lowPE} color={C.cyan} bench={benchTickers} />
          <MetricLeader title="Top 1Y Return %" data={metricLeaders.returnY} color={C.amber} bench={benchTickers} />
        </div>
      </Panel>
    </div>
  );
}

// ── COMBINED TAB (filterable) ─────────────────────────────────────
function CombinedView({ allData, benchTickers }: { allData: Record<string, ScreenData>; benchTickers: Set<string> }) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(SCREENS.map(s => s.slug)));
  const [q, setQ] = useState<string>('');
  const [sortCol, setSortCol] = useState<string>('__count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [onlyBench, setOnlyBench] = useState(false);
  const [onlyMulti, setOnlyMulti] = useState(false);

  const merged = useMemo(() => {
    const m: Record<string, { row: Row; slugs: string[]; name: string }> = {};
    for (const s of SCREENS) {
      if (!enabled.has(s.slug)) continue;
      const d = allData[s.slug];
      if (!d?.rows) continue;
      for (const r of d.rows) {
        const t = String(r.__ticker || '').toUpperCase();
        if (!t) continue;
        if (!m[t]) m[t] = { row: r, slugs: [], name: String(r['Name'] || t) };
        if (!m[t].slugs.includes(s.slug)) m[t].slugs.push(s.slug);
      }
    }
    let rows = Object.entries(m).map(([t, v]) => ({ __ticker: t, __count: v.slugs.length, __slugs: v.slugs, __name: v.name, ...v.row }));
    if (q.trim()) { const n = q.trim().toLowerCase(); rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(n)); }
    if (onlyBench) rows = rows.filter(r => benchTickers.has(r.__ticker));
    if (onlyMulti) rows = rows.filter(r => r.__count >= 2);
    rows.sort((a: any, b: any) => {
      const av = a[sortCol]; const bv = b[sortCol];
      const an = typeof av === 'number' ? av : parseFloat(String(av)) || 0;
      const bn = typeof bv === 'number' ? bv : parseFloat(String(bv)) || 0;
      return sortDir === 'asc' ? an - bn : bn - an;
    });
    return rows;
  }, [allData, enabled, q, sortCol, sortDir, onlyBench, onlyMulti, benchTickers]);

  const tickersCsv = merged.map(r => r.__ticker).join(',');
  const copyTickers = () => { navigator.clipboard?.writeText(tickersCsv); };

  const cols = ['__count', 'Current Price', 'Market Capitalization', 'Price to Earning', 'YOY Quarterly profit growth', 'YOY Quarterly sales growth', 'Return on capital employed', 'CFO to PAT', 'OPM', 'Debt to equity', 'Return over 1year'];

  return (
    <div>
      <Panel title="🔀 Combined View — Toggle Screens On/Off" subtitle="Merged view across selected screens. Same ticker in multiple screens = 1 row with combined count.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {SCREENS.map(s => {
            const on = enabled.has(s.slug);
            return (
              <label key={s.slug} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: on ? C.cyan + '22' : C.panel2, border: `1px solid ${on ? C.cyan : C.border}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: on ? C.cyan : C.text2 }}>
                <input type="checkbox" checked={on} onChange={() => { const n = new Set(enabled); if (on) n.delete(s.slug); else n.add(s.slug); setEnabled(n); }} style={{ cursor: 'pointer' }} />
                {s.emoji} {s.short}
              </label>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <input type="text" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ padding: '7px 12px', background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 13, width: 220, outline: 'none' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: onlyBench ? C.gold : C.text2 }}>
            <input type="checkbox" checked={onlyBench} onChange={e => setOnlyBench(e.target.checked)} /> ⭐ Only in CB bench
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: onlyMulti ? C.gold : C.text2 }}>
            <input type="checkbox" checked={onlyMulti} onChange={e => setOnlyMulti(e.target.checked)} /> In 2+ screens
          </label>
          <span style={{ fontSize: 12, color: C.text2 }}>· {merged.length} tickers · {enabled.size}/8 screens</span>
          <button onClick={copyTickers} style={{ marginLeft: 'auto', padding: '6px 12px', background: C.cyan + '22', border: `1px solid ${C.cyan}`, borderRadius: 6, color: C.cyan, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📋 Copy tickers (TradingView)</button>
        </div>
        <div style={{ overflow: 'auto', maxHeight: '70vh', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead style={{ position: 'sticky', top: 0, background: C.panel2, zIndex: 2 }}>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>NSE</th>
                <th style={thStyle}>Screens</th>
                <th style={thStyle}>In</th>
                <th style={thStyle}>CB</th>
                {cols.slice(1).map(col => (
                  <th key={col} onClick={() => { if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc'); } }} style={{ ...thStyle, cursor: 'pointer', color: sortCol === col ? C.cyan : C.text2 }}>
                    {COL_ALIAS[col] || col} {sortCol === col && (sortDir === 'asc' ? '▲' : '▼')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {merged.map((r: any, i) => {
                const cb = benchTickers.has(r.__ticker);
                return (
                  <tr key={r.__ticker} style={{ background: cb ? C.gold + '11' : (i % 2 ? C.panel2 : 'transparent'), borderLeft: cb ? `3px solid ${C.gold}` : '3px solid transparent' }}>
                    <td style={tdStyle}><span style={{ color: cb ? C.gold : C.cyan, fontWeight: 600 }}>{cb && '⭐ '}{r.__name}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: C.text2 }}>{r.__ticker}</td>
                    <td style={tdStyle}><span style={{ background: r.__count >= 2 ? C.gold + '22' : 'transparent', color: r.__count >= 2 ? C.gold : C.text2, padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>{r.__count}</span></td>
                    <td style={{ ...tdStyle, fontSize: 11 }}>{r.__slugs.map((sl: string) => SCREENS.find(s => s.slug === sl)?.emoji).join(' ')}</td>
                    <td style={tdStyle}>{cb ? '✓' : '—'}</td>
                    {cols.slice(1).map(col => {
                      const val = r[col];
                      let color = C.text;
                      if (typeof val === 'number') {
                        if (col.includes('growth') || col.includes('return') || col.includes('profit')) color = numColor(val);
                        else if (col === 'Price to Earning') color = peColor(val);
                        else if (col === 'Return on capital employed') color = goodBadColor(val, 15, 5);
                        else if (col === 'CFO to PAT') color = goodBadColor(val, 0.8, 0.3);
                        else if (col === 'Debt to equity') color = val < 0.3 ? C.green : val > 1.5 ? C.red : C.text;
                      }
                      return <td key={col} style={{ ...tdStyle, color }}>{fmt(val)}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ── HELPERS ─────────────────────────────────────────────────────
const thStyle: React.CSSProperties = { padding: '9px 10px', borderBottom: `2px solid ${C.border}`, textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.text2, whiteSpace: 'nowrap', letterSpacing: '0.3px' };
const tdStyle: React.CSSProperties = { padding: '7px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, whiteSpace: 'nowrap' };
function StatCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) { return (<div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px' }}><div style={{ fontSize: 11, color: C.text3, letterSpacing: '0.5px', marginBottom: 6 }}>{label.toUpperCase()}</div><div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>{sub && <div style={{ fontSize: 11, color: C.text2, marginTop: 4 }}>{sub}</div>}</div>); }
function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return (<div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 16 }}><div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}><div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>{subtitle && <div style={{ fontSize: 12, color: C.text2, marginTop: 4 }}>{subtitle}</div>}</div><div style={{ padding: 14 }}>{children}</div></div>); }
function MetricLeader({ title, data, color, bench }: { title: string; data: Array<{ t: string; name: any; v: number }>; color: string; bench: Set<string> }) { return (<div><div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 8, letterSpacing: '0.3px' }}>{title.toUpperCase()}</div>{data.length === 0 ? <Empty /> : (<table style={{ width: '100%', fontSize: 12.5 }}><tbody>{data.map((d, i) => { const cb = bench.has(d.t); return (<tr key={d.t} style={{ borderBottom: `1px solid ${C.border}` }}><td style={{ padding: '5px 6px', color: C.text3, width: 20 }}>{i+1}</td><td style={{ padding: '5px 6px', color: cb ? C.gold : C.text, fontWeight: 600 }}>{cb && '⭐ '}{String(d.name || d.t).slice(0, 24)}</td><td style={{ padding: '5px 6px', textAlign: 'right', color, fontWeight: 700 }}>{fmt(d.v)}</td></tr>); })}</tbody></table>)}</div>); }
function Empty() { return <div style={{ padding: 12, color: C.text3, fontSize: 12 }}>No data</div>; }
function fmt(v: any): string { return typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v || ''); }
function peColor(v: any): string { if (typeof v !== 'number' || v <= 0) return C.text; if (v < 20) return C.green; if (v > 50) return C.red; return C.text; }
function numColor(v: any): string { if (typeof v !== 'number') return C.text; return v > 0 ? C.green : v < 0 ? C.red : C.text; }
function goodBadColor(v: any, good: number, bad: number): string { if (typeof v !== 'number') return C.text; if (v >= good) return C.green; if (v < bad) return C.red; return C.text; }

// ── MAIN ─────────────────────────────────────────────────────────
export default function MultibaggerScreensPage() {
  const [view, setView] = useState<'analytics' | 'combined' | 'per-screener'>('analytics');
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
        const t = String(bench[k]?.ticker || k).toUpperCase().replace(/-BE$/, '');
        if (t) set.add(t);
      }
      setBenchTickers(set);
    } catch {}
  }, []);

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
    if (q.trim()) { const n = q.trim().toLowerCase(); rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(n)); }
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
    for (const r of activeData.rows) { const t = String(r.__ticker || '').toUpperCase(); if (t && benchTickers.has(t)) n++; }
    return n;
  }, [activeData, benchTickers]);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, padding: '24px 28px 80px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.text3, marginBottom: 4, letterSpacing: '0.5px' }}>MULTIBAGGER · CSV-BACKED</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 4px', letterSpacing: '-0.4px' }}>🔍 Per-Screener Breakdown</h1>
        <div style={{ fontSize: 13, color: C.text2 }}>8 screens · /data/screener/ (synced daily) · CB bench overlap in gold</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
        {(['analytics','combined','per-screener'] as const).map(v => {
          const active = view === v;
          const labels = { analytics: '📊 Analytics', combined: '🔀 Combined', 'per-screener': '📋 Per-Screener' };
          return <button key={v} onClick={() => setView(v)} style={{ padding: '10px 20px', background: active ? C.cyan + '22' : C.panel, border: `1px solid ${active ? C.cyan : C.border}`, borderRadius: 8, color: active ? C.cyan : C.text, fontSize: 14, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.3px' }}>{labels[v]}</button>;
        })}
      </div>

      {view === 'analytics' && <AnalyticsView allData={data} benchTickers={benchTickers} />}
      {view === 'combined' && <CombinedView allData={data} benchTickers={benchTickers} />}
      {view === 'per-screener' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {SCREENS.map(s => {
              const active = s.slug === activeSlug;
              const rows = data[s.slug]?.rows?.length ?? null;
              return <button key={s.slug} onClick={() => setActiveSlug(s.slug)} style={{ padding: '9px 16px', background: active ? C.cyan + '22' : C.panel, border: `1px solid ${active ? C.cyan : C.border}`, borderRadius: 8, color: active ? C.cyan : C.text, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{s.emoji} {s.label}{rows !== null && <span style={{ marginLeft: 8, color: active ? C.cyan : C.text3, fontWeight: 600 }}>({rows})</span>}</button>;
            })}
          </div>
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 18px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{activeScreen.emoji} {activeScreen.label}</div>
              <div style={{ fontSize: 12, color: C.text2, marginTop: 4 }}>{activeData?.rows?.length ?? 0} stocks{overlapCount > 0 && <span style={{ marginLeft: 12, color: C.gold, fontWeight: 700 }}>· ⭐ {overlapCount} in your CB bench</span>}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ padding: '7px 12px', background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 13, width: 200, outline: 'none' }} />
              <a href={activeScreen.url} target="_blank" rel="noreferrer" style={{ padding: '7px 12px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text2, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>🔗 Open on Screener</a>
            </div>
          </div>
          {activeData?.err && <div style={{ padding: 20, background: C.red + '11', border: `1px solid ${C.red}44`, borderRadius: 8, color: C.red }}>Load failed: {activeData.err}</div>}
          {activeData && !activeData.err && orderedCols.length > 0 && (
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'auto', maxHeight: '75vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
                <thead style={{ position: 'sticky', top: 0, background: C.panel2, zIndex: 2 }}><tr>{orderedCols.map(col => { const isSort = col === sortCol; return <th key={col} onClick={() => { if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc'); } }} style={{ ...thStyle, cursor: 'pointer', color: isSort ? C.cyan : C.text2 }}>{COL_ALIAS[col] || col} {isSort && (sortDir === 'asc' ? '▲' : '▼')}</th>; })}</tr></thead>
                <tbody>{filteredRows.map((r, i) => { const t = String(r.__ticker || '').toUpperCase(); const inB = t && benchTickers.has(t); return <tr key={i} style={{ background: inB ? C.gold + '11' : (i % 2 ? C.panel2 : 'transparent'), borderLeft: inB ? `3px solid ${C.gold}` : '3px solid transparent' }}>{orderedCols.map(col => { const val = r[col]; const isName = col === 'Name'; return <td key={col} style={{ ...tdStyle, color: C.text }}>{isName && val ? <span style={{ color: inB ? C.gold : C.cyan, fontWeight: 600 }}>{inB && '⭐ '}{String(val)}</span> : (typeof val === 'number' ? val.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(val || ''))}</td>; })}</tr>; })}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div style={{ marginTop: 16, fontSize: 11, color: C.text3, textAlign: 'center' }}>Data source: /data/screener/*.csv · synced daily by GitHub Action · gold rows = ticker in CB bench</div>
    </div>
  );
}
