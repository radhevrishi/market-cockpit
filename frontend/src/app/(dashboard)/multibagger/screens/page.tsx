'use client';

// zzz344 — Multibagger per-screener breakdown, reads local CSVs from /data/screener/.
// Same data source as the main /multibagger page (auto-synced daily by GitHub Action),
// so no live Screener.in fetch or CF Worker is needed. Just parse the CSVs client-side.

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

const C = { bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937', text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B', green: '#22C55E', red: '#EF4444', cyan: '#06B6D4', gold: '#FBBF24' };

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
      // Screener CSV Name column contains the company display name — but the ticker
      // is not directly in export. Approximate: uppercase alphanumeric compact.
      row.__ticker = nm.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
    }
    rows.push(row);
  }
  return { columns, rows };
}

export default function MultibaggerScreensPage() {
  const [activeSlug, setActiveSlug] = useState<string>(SCREENS[0].slug);
  const [data, setData] = useState<Record<string, ScreenData>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
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

  useEffect(() => {
    if (data[activeSlug] || loading[activeSlug]) return;
    setLoading(prev => ({ ...prev, [activeSlug]: true }));
    fetch(`/data/screener/${activeSlug}.csv`, { cache: 'no-store' })
      .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(csv => setData(prev => ({ ...prev, [activeSlug]: parseCsv(csv) })))
      .catch(e => setData(prev => ({ ...prev, [activeSlug]: { columns: [], rows: [], err: String(e) } })))
      .finally(() => setLoading(prev => ({ ...prev, [activeSlug]: false })));
  }, [activeSlug]);

  const activeScreen = SCREENS.find(s => s.slug === activeSlug)!;
  const activeData = data[activeSlug];
  const isLoading = loading[activeSlug];

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

  const cellStyle = (col: string, val: any): React.CSSProperties => {
    const base: React.CSSProperties = { padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, color: C.text, whiteSpace: 'nowrap' };
    if (typeof val !== 'number') return base;
    if (col.includes('Profit Var') || col.includes('Sales Var') || col.includes('return') || col.includes('growth')) {
      if (val > 0) base.color = C.green; else if (val < 0) base.color = C.red;
    }
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
        <div style={{ fontSize: 13, color: C.text2 }}>8 screens · data from /data/screener/ (synced daily by GitHub Action) · CB bench overlap in gold</div>
      </div>

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
          <button onClick={() => { setData(prev => { const n = { ...prev }; delete n[activeSlug]; return n; }); }} style={{ padding: '7px 12px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text2, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>🔄 Reload</button>
        </div>
      </div>

      {isLoading && (<div style={{ padding: 40, textAlign: 'center', color: C.text2 }}>Loading CSV…</div>)}
      {!isLoading && activeData?.err && (
        <div style={{ padding: 20, background: C.red + '11', border: `1px solid ${C.red}44`, borderRadius: 8 }}>
          <div style={{ color: C.red, fontWeight: 700, marginBottom: 6 }}>Load failed</div>
          <div style={{ color: C.text2, fontSize: 13 }}>{activeData.err}</div>
          <div style={{ color: C.text3, fontSize: 12, marginTop: 8 }}>Trigger the GitHub Action to refresh /data/screener/*.csv.</div>
        </div>
      )}
      {!isLoading && activeData && !activeData.err && orderedCols.length > 0 && (
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
                        <td key={col} style={cellStyle(col, val)}>
                          {isName && val ? (
                            <span style={{ color: inBench ? C.gold : C.cyan, fontWeight: 600 }}>
                              {inBench && '⭐ '}{String(val)}
                            </span>
                          ) : (typeof val === 'number' ? val.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(val || ''))}
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

      <div style={{ marginTop: 16, fontSize: 11, color: C.text3, textAlign: 'center' }}>
        Data source: /data/screener/*.csv · same as main Multibagger tab · gold rows = ticker in CB bench · click column header to sort
      </div>
    </div>
  );
}
