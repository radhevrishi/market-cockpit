'use client';

// zzz341 — Multibagger sub-route: auto-fetched per-screener breakdown.
// Aggregates 8 hand-picked Screener.in screens into one sortable UI so we can
// see today's fresh winners across multiple lenses side by side. Cross-highlights
// any ticker already in the Conviction Beats bench so we can spot overlaps.
// Auto-fetches via /api/v1/screens/[id] on each tab visit — no CSV upload needed.

import React, { useEffect, useMemo, useState } from 'react';

type ScreenDef = { id: string; label: string; emoji: string; url: string };

const SCREENS: ScreenDef[] = [
  { id: '3549314', label: 'Stocks like Bajaj Consumer', emoji: '🧴', url: 'https://www.screener.in/screens/3549314/stocks-like-bajaj-consumer/' },
  { id: '3565418', label: 'Rajeev Thakkar PPFAS', emoji: '💎', url: 'https://www.screener.in/screens/3565418/rajeev-thakkar-ppfas-screener/' },
  { id: '3612486', label: 'PEAD Master (Rishi Framework)', emoji: '🎯', url: 'https://www.screener.in/screens/3612486/pead-master-screener-rishi-framework/' },
  { id: '3601571', label: 'Multibagger: Acutaas/Atlanta/Dee-Dev', emoji: '🚀', url: 'https://www.screener.in/screens/3601571/multibagger-like-acutaasatlantadee-dev/' },
  { id: '3545352', label: 'Multibagger 2 (Ignoring Trend)', emoji: '💥', url: 'https://www.screener.in/screens/3545352/multibagger2-ignoring-trend/' },
  { id: '3443614', label: 'FII Screener', emoji: '🏦', url: 'https://www.screener.in/screens/3443614/fii/' },
  { id: '3470949', label: 'Future Leaders', emoji: '👑', url: 'https://www.screener.in/screens/3470949/future-leaders/' },
  { id: '3658091', label: 'Great Results + Pullback', emoji: '📉', url: 'https://www.screener.in/screens/3658091/great-results-and-pullback/' },
];

const C = { bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937', text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B', green: '#22C55E', red: '#EF4444', cyan: '#06B6D4', gold: '#FBBF24' };

const PRIORITY_COLS = ['S.No.','Name','CMP Rs.','Mar Cap Rs.Cr.','P/E','Qtr Profit Var %','Qtr Sales Var %','Sales growth %','Profit growth %','ROCE %','ROIC %','OPM %','CFO/PAT','Debt / Eq','PEG','1Yr return %','Prom. Hold. %','FII Hold %','DII Hold %','Pledged %'];

type Row = Record<string, string | number> & { __ticker?: string };
type ScreenResp = { id: string; name?: string; columns: string[]; rows: Row[]; count?: number; fetchedAt?: string; err?: string; hint?: string };

export default function MultibaggerScreensPage() {
  const [activeId, setActiveId] = useState<string>(SCREENS[0].id);
  const [data, setData] = useState<Record<string, ScreenResp>>({});
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
    if (data[activeId] || loading[activeId]) return;
    setLoading((prev) => ({ ...prev, [activeId]: true }));
    fetch(`/api/v1/screens/${activeId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setData((prev) => ({ ...prev, [activeId]: j })))
      .catch((e) => setData((prev) => ({ ...prev, [activeId]: { id: activeId, columns: [], rows: [], err: String(e) } })))
      .finally(() => setLoading((prev) => ({ ...prev, [activeId]: false })));
  }, [activeId]);

  const activeScreen = SCREENS.find((s) => s.id === activeId)!;
  const activeData = data[activeId];
  const isLoading = loading[activeId];

  const orderedCols = useMemo(() => {
    if (!activeData?.columns?.length) return [];
    const cols = activeData.columns;
    const prio = PRIORITY_COLS.filter((c) => cols.includes(c));
    const rest = cols.filter((c) => !prio.includes(c));
    return [...prio, ...rest];
  }, [activeData]);

  const filteredRows = useMemo(() => {
    if (!activeData?.rows?.length) return [];
    let rows = activeData.rows.slice();
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
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

  const cellStyle = (col: string, val: any) => {
    const base: React.CSSProperties = { padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, color: C.text, whiteSpace: 'nowrap' };
    if (typeof val !== 'number') return base;
    if (col.includes('Profit Var') || col.includes('Sales Var') || col.includes('return') || col.includes('growth')) {
      if (val > 0) base.color = C.green; else if (val < 0) base.color = C.red;
    }
    if (col.includes('P/E') || col.includes('PEG')) {
      if (val > 0 && val < 20) base.color = C.green; else if (val > 50) base.color = C.red;
    }
    if (col === 'Debt / Eq') { if (val < 0.3) base.color = C.green; else if (val > 1.5) base.color = C.red; }
    if (col === 'CFO/PAT') { if (val >= 0.8) base.color = C.green; else if (val < 0.3) base.color = C.red; }
    return base;
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, padding: '24px 28px 80px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.text3, marginBottom: 4, letterSpacing: '0.5px' }}>MULTIBAGGER · AUTO-FETCH</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 4px', letterSpacing: '-0.4px' }}>🔍 Per-Screener Breakdown</h1>
        <div style={{ fontSize: 13, color: C.text2 }}>8 hand-picked Screener.in screens · auto-fetched · sortable tables · CB bench overlap in gold</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {SCREENS.map((s) => {
          const active = s.id === activeId;
          const rows = data[s.id]?.rows?.length ?? null;
          return (
            <button key={s.id} onClick={() => setActiveId(s.id)} style={{ padding: '9px 16px', background: active ? C.cyan + '22' : C.panel, border: `1px solid ${active ? C.cyan : C.border}`, borderRadius: 8, color: active ? C.cyan : C.text, fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.2px' }}>
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
            {activeData?.count ?? 0} stocks
            {overlapCount > 0 && (<span style={{ marginLeft: 12, color: C.gold, fontWeight: 700 }}>· ⭐ {overlapCount} in your CB bench</span>)}
            {activeData?.fetchedAt && (<span style={{ marginLeft: 12, color: C.text3 }}>· fetched {new Date(activeData.fetchedAt).toLocaleTimeString()}</span>)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: '7px 12px', background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 13, width: 200, outline: 'none' }} />
          <a href={activeScreen.url} target="_blank" rel="noreferrer" style={{ padding: '7px 12px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text2, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>🔗 Open on Screener</a>
          <button onClick={() => { setData((prev) => { const n = { ...prev }; delete n[activeId]; return n; }); }} style={{ padding: '7px 12px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text2, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>🔄 Refresh</button>
        </div>
      </div>

      {isLoading && (<div style={{ padding: 40, textAlign: 'center', color: C.text2 }}>Loading screen data from Screener.in…</div>)}
      {!isLoading && activeData?.err && (
        <div style={{ padding: 20, background: C.red + '11', border: `1px solid ${C.red}44`, borderRadius: 8 }}>
          <div style={{ color: C.red, fontWeight: 700, marginBottom: 6 }}>Fetch failed</div>
          <div style={{ color: C.text2, fontSize: 13 }}>{activeData.hint || activeData.err}</div>
          <div style={{ color: C.text3, fontSize: 12, marginTop: 8 }}>If this screen is private on Screener.in, mark it Public in your Screener account settings — or wait for the CF Worker screen endpoint to ship.</div>
        </div>
      )}
      {!isLoading && activeData && !activeData.err && orderedCols.length > 0 && (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'auto', maxHeight: '75vh' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
            <thead style={{ position: 'sticky', top: 0, background: C.panel2, zIndex: 2 }}>
              <tr>
                {orderedCols.map((col) => {
                  const isSort = col === sortCol;
                  return (
                    <th key={col} onClick={() => { if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortCol(col); setSortDir('desc'); } }} style={{ padding: '10px 12px', borderBottom: `2px solid ${C.border}`, textAlign: 'left', fontSize: 11, fontWeight: 700, color: isSort ? C.cyan : C.text2, cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.3px', userSelect: 'none' }}>
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
                    {orderedCols.map((col) => {
                      const val = r[col];
                      const isName = col === 'Name';
                      return (
                        <td key={col} style={cellStyle(col, val)}>
                          {isName && t ? (
                            <a href={`https://www.screener.in/company/${t}/consolidated/`} target="_blank" rel="noreferrer" style={{ color: inBench ? C.gold : C.cyan, textDecoration: 'none', fontWeight: 600 }}>
                              {inBench && '⭐ '}{String(val || '')}
                            </a>
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
        Data source: Screener.in · auto-fetched on each tab visit · gold rows = ticker in CB bench · click column header to sort
      </div>
    </div>
  );
}

