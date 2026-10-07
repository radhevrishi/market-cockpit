'use client';
// zzz938 — STOCK SCREENER page (our own, replaces the TradingView screener). Downloads the day's snapshot once and filters in the
// browser, so every change is instant. Filters are chips like TradingView's: click to change, × to remove, + to add.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ScreenRow, ScreenMarket } from '@/lib/screener/types';
import {
  FIELDS, BUILT_IN_SCREENS, SCREENS_KEY, cleanScreens, fieldOf, filterCounts, filterLabel, fmtValue, runScreen,
  type Filter, type NumKey, type Screen,
} from '@/lib/screener/filters';

const C = {
  text: 'var(--mc-text-0)', text1: 'var(--mc-text-1)', dim: 'var(--mc-text-3, #6b7280)', border: 'var(--mc-border-1)',
  bg: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', accent: 'var(--mc-accent)', green: 'var(--mc-bullish, #059669)', red: 'var(--mc-bearish, #DC2626)', amber: 'var(--mc-warn, #D97706)',
};
interface Snap { builtAt: string | null; rows: ScreenRow[]; notes: string[]; sources: string[] }

function readSaved(): Screen[] {
  try { return cleanScreens(JSON.parse(localStorage.getItem(SCREENS_KEY) || '[]')); } catch { return []; }
}
function writeSaved(list: Screen[]) {
  try { localStorage.setItem(SCREENS_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
}
const saved0 = (): Screen[] => (typeof window === 'undefined' ? [] : readSaved());
const newId = () => `my-${Date.now().toString(36)}`;

export default function StockScreener() {
  const [market, setMarket] = useState<ScreenMarket>('US');
  const [snaps, setSnaps] = useState<Partial<Record<ScreenMarket, Snap>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Screen[]>(() => readSaved());   // the page loads in the browser only (ssr:false)
  const first = BUILT_IN_SCREENS[0];
  const [screenId, setScreenId] = useState<string>(first.id);
  const [filters, setFilters] = useState<Filter[]>(() => JSON.parse(JSON.stringify((saved0().find((x) => x.id === first.id) || first).filters)));
  const [name, setName] = useState(() => (saved0().find((x) => x.id === first.id) || first).name);
  const [dirty, setDirty] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'mc', dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // every screen the owner can pick: his saved ones win over a built-in with the same id
  const screens = useMemo(() => {
    const m = new Map<string, Screen>();
    for (const s of BUILT_IN_SCREENS) m.set(s.id, s);
    for (const s of saved) m.set(s.id, s);
    return Array.from(m.values());
  }, [saved]);
  const loadScreen = useCallback((id: string, list = screens) => {
    const s = list.find((x) => x.id === id);
    if (!s) return;
    setScreenId(s.id); setMarket(s.market); setFilters(JSON.parse(JSON.stringify(s.filters))); setName(s.name); setDirty(false); setEditIdx(null); setShowAll(false);
  }, [screens]);

  useEffect(() => {
    if (snaps[market]) return;
    let stop = false;
    fetch(`/api/v1/stock-screener?market=${market}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (stop) return; if (!j?.ok) { setErr(j?.error || 'could not load'); return; } setErr(null); setSnaps((p) => ({ ...p, [market]: { builtAt: j.builtAt, rows: j.rows || [], notes: j.notes || [], sources: j.sources || [] } })); })
      .catch(() => { if (!stop) setErr('could not load the screener data'); });
    return () => { stop = true; };
  }, [market, snaps]);

  const snap = snaps[market];
  // the first build may still be running on the server: look again every 90 s until it has rows
  useEffect(() => {
    if (!snap || snap.rows.length) return;
    const id = setTimeout(() => setSnaps((p) => { const n = { ...p }; delete n[market]; return n; }), 90_000);
    return () => clearTimeout(id);
  }, [snap, market]);
  const rows = useMemo(() => snap?.rows || [], [snap]);
  const result = useMemo(() => runScreen(rows, filters), [rows, filters]);
  const counts = useMemo(() => filterCounts(rows, filters), [rows, filters]);
  const sectors = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.sec) m.set(r.sec, (m.get(r.sec) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  // the columns: basics + every field a filter uses
  const cols = useMemo(() => {
    const keys: NumKey[] = ['px', 'chg', 'mc'];
    for (const f of filters) {
      if (f.kind === 'num' && !keys.includes(f.key)) keys.push(f.key);
      if (f.kind === 'cmp') { if (!keys.includes(f.key)) keys.push(f.key); if (!keys.includes(f.other)) keys.push(f.other); }
    }
    return keys;
  }, [filters]);
  const sorted = useMemo(() => {
    const out = result.slice();
    const k = sort.key as keyof ScreenRow;
    out.sort((a, b) => {
      const x = a[k] as any, y = b[k] as any;
      if (typeof x === 'string' || typeof y === 'string') return String(x ?? '').localeCompare(String(y ?? '')) * sort.dir;
      const fx = typeof x === 'number' ? x : -Infinity, fy = typeof y === 'number' ? y : -Infinity;
      return (fx - fy) * sort.dir;
    });
    return out;
  }, [result, sort]);
  const shown = showAll ? sorted : sorted.slice(0, 200);

  const change = (next: Filter[]) => { setFilters(next); setDirty(true); };
  const save = (asNew: boolean) => {
    const id = asNew ? newId() : screenId;
    const nm = asNew ? (window.prompt('Name for this screen', `${name} (copy)`) || '').trim() : name;
    if (!nm) return;
    const s: Screen = { id, name: nm.slice(0, 80), market, filters };
    const list = [...saved.filter((x) => x.id !== id), s];
    writeSaved(list); setSaved(list); setScreenId(id); setName(s.name); setDirty(false);
    setMsg(`Saved "${s.name}"`); setTimeout(() => setMsg(null), 2500);
  };
  const removeSaved = () => {
    const isBuiltIn = BUILT_IN_SCREENS.some((b) => b.id === screenId);
    if (!window.confirm(isBuiltIn ? 'Put this screen back to how it was first set up?' : `Delete "${name}"?`)) return;
    const list = saved.filter((x) => x.id !== screenId);
    writeSaved(list); setSaved(list);
    loadScreen(isBuiltIn ? screenId : BUILT_IN_SCREENS[0].id, [...BUILT_IN_SCREENS, ...list]);
  };
  const copyTickers = () => {
    const txt = sorted.map((r) => (market === 'IN' ? `NSE:${r.t}` : r.t)).join(',');
    navigator.clipboard?.writeText(txt).then(() => { setMsg(`Copied ${sorted.length} tickers`); setTimeout(() => setMsg(null), 2500); }).catch(() => {});
  };
  const downloadCsv = () => {
    const head = ['Ticker', 'Company', 'Sector', ...cols.map((k) => fieldOf(k)?.label || k)];
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = sorted.map((r) => [r.t, r.n, r.sec, ...cols.map((k) => r[k])].map(esc).join(','));
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name.replace(/[^\w-]+/g, '_')}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const pick = (key: string) => {
    if (key === 'sector') { change([...filters, { kind: 'sector', sectors: [] }]); setEditIdx(filters.length); return; }
    if (key === 'sma-up') { change([...filters, { kind: 'cmp', key: 'sma50', op: 'above', other: 'sma200' }]); return; }
    const d = fieldOf(key); if (!d) return;
    change([...filters, { kind: 'num', key: d.key, op: 'gt', v: 0 }]); setEditIdx(filters.length);
  };
  const btn = (on = false): React.CSSProperties => ({ padding: '5px 10px', borderRadius: 6, border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.bg1, color: on ? '#fff' : C.text1, fontSize: 13, fontWeight: 600, cursor: 'pointer' });
  const builtAt = snap?.builtAt ? new Date(snap.builtAt) : null;
  const withFigures = useMemo(() => rows.filter((r) => r.q).length, [rows]);
  const latestQ = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) if (r.q) m.set(r.q, (m.get(r.q) || 0) + 1); return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null; }, [rows]);

  return (
    <div style={{ padding: '12px 16px', display: 'grid', gap: 10, color: C.text }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 18 }}>Stock Screener</b>
        <select value={screenId} onChange={(e) => loadScreen(e.target.value)} style={{ ...btn(), fontSize: 14, maxWidth: 320 }} aria-label="Saved screens">
          {screens.map((s) => <option key={s.id} value={s.id}>{s.market === 'IN' ? '🇮🇳' : '🇺🇸'} {s.name}</option>)}
        </select>
        <button type="button" style={btn(dirty)} onClick={() => save(false)} title="Save the filters into this screen">Save{dirty ? ' •' : ''}</button>
        <button type="button" style={btn()} onClick={() => save(true)}>Save as new…</button>
        <button type="button" style={btn()} onClick={removeSaved} title="Delete a screen you made, or put a built-in screen back to its first setup">{BUILT_IN_SCREENS.some((b) => b.id === screenId) ? 'Reset' : 'Delete'}</button>
        <span style={{ marginLeft: 8, display: 'inline-flex', gap: 4 }}>
          {(['US', 'IN'] as const).map((m) => <button key={m} type="button" style={btn(market === m)} onClick={() => { setMarket(m); setDirty(true); }}>{m === 'US' ? '🇺🇸 USA' : '🇮🇳 India'}</button>)}
        </span>
        {msg ? <span style={{ color: C.green, fontSize: 13, fontWeight: 700 }}>{msg}</span> : null}
      </div>

      {/* filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {filters.map((f, i) => {
          const d = f.kind === 'num' ? fieldOf(f.key) : null;
          const approx = d?.approxNote?.[market];
          const wrongMarket = (f.kind === 'num' || f.kind === 'cmp') && !fieldOf(f.key)?.markets.includes(market);
          return (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 6, background: editIdx === i ? C.accent : '#374151', color: '#fff', fontSize: 13, overflow: 'hidden' }}>
              <button type="button" onClick={() => setEditIdx(editIdx === i ? null : i)} title={approx ? `Approximate — ${approx}` : wrongMarket ? 'Not available for this market' : 'Click to change'}
                style={{ all: 'unset', cursor: 'pointer', padding: '5px 9px' }}>
                {filterLabel(f, market)}{approx ? ' ≈' : ''}{wrongMarket ? ' (n/a)' : ''} <span style={{ opacity: 0.65, fontSize: 11 }}>· {counts[i] ?? 0}</span>
              </button>
              <button type="button" aria-label="Remove filter" onClick={() => { change(filters.filter((_, k) => k !== i)); setEditIdx(null); }}
                style={{ all: 'unset', cursor: 'pointer', padding: '5px 8px', borderLeft: '1px solid rgba(255,255,255,0.2)' }}>×</button>
            </span>
          );
        })}
        <select value="" onChange={(e) => { if (e.target.value) pick(e.target.value); }} style={{ ...btn(), fontWeight: 700 }} aria-label="Add a filter">
          <option value="">+ Add filter</option>
          <option value="sector">Sector</option>
          <option value="sma-up">SMA 50 above SMA 200</option>
          {FIELDS.filter((f) => f.markets.includes(market)).map((f) => <option key={f.key} value={f.key}>{f.label}{f.approxNote?.[market] ? ' ≈' : ''}</option>)}
        </select>
      </div>

      {editIdx != null && filters[editIdx] ? (
        <FilterEditor f={filters[editIdx]} market={market} sectors={sectors} onChange={(nf) => change(filters.map((x, k) => (k === editIdx ? nf : x)))} onClose={() => setEditIdx(null)} />
      ) : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 13 }}>
        <b style={{ fontSize: 15 }}>{snap ? `${result.length} of ${rows.length} companies match` : err ? '' : 'Loading…'}</b>
        {builtAt ? <span style={{ color: C.dim }}>data built {builtAt.toLocaleString()}{latestQ ? ` · most figures to ${latestQ}` : ''}{rows.length && withFigures < rows.length * 0.9 ? ` · company figures read for ${withFigures} of ${rows.length} so far (the rest are read in the next runs)` : ''} · the small number on each filter = companies passing that filter alone</span> : null}
        {err ? <span style={{ color: C.red }}>{err}</span> : null}
        <span style={{ flex: 1 }} />
        <button type="button" style={btn()} onClick={copyTickers} disabled={!sorted.length}>Copy tickers</button>
        <button type="button" style={btn()} onClick={downloadCsv} disabled={!sorted.length}>Download CSV</button>
      </div>
      {snap?.notes?.length ? (
        <details style={{ fontSize: 12, color: C.dim }}>
          <summary style={{ cursor: 'pointer' }}>Where the figures come from, and what could not be read</summary>
          <div>Sources: {snap.sources.join(' · ')}. A company whose figure is not known fails that filter. ≈ marks a figure worked out in a rougher way (hover a filter for how).</div>
          <ul style={{ margin: '4px 0 0 16px' }}>{snap.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      ) : null}

      <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.bg1 }}>
              <th style={th}>#</th>
              <Th label="Company" k="t" sort={sort} setSort={setSort} />
              <Th label="Sector" k="sec" sort={sort} setSort={setSort} />
              {cols.map((k) => <Th key={k} label={fieldOf(k)?.label || k} k={k} sort={sort} setSort={setSort} num />)}
              <Th label="Quarter" k="q" sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.t} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ ...td, color: C.dim }}>{i + 1}</td>
                <td style={td}>
                  <Link href={`/charts?t=${encodeURIComponent(r.t)}&m=${market}&tf=D`} style={{ color: C.accent, fontWeight: 700, textDecoration: 'none' }} title="Open the chart">{r.t}</Link>
                  <div style={{ fontSize: 11.5, color: C.dim, maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.n}</div>
                </td>
                <td style={{ ...td, fontSize: 12, color: C.dim, maxWidth: 160 }}>{r.sec || '—'}</td>
                {cols.map((k) => {
                  const d = fieldOf(k); const v = r[k] as number | null;
                  const ax = r.approx?.includes(k);
                  const col = k === 'chg' && typeof v === 'number' ? (v >= 0 ? C.green : C.red) : C.text;
                  return <td key={k} style={{ ...td, textAlign: 'right', color: col, whiteSpace: 'nowrap' }} title={ax ? 'Approximate for this company' : undefined}>{ax ? '≈' : ''}{fmtValue(v, d?.unit || 'num', market)}</td>;
                })}
                <td style={{ ...td, fontSize: 12, color: C.dim, whiteSpace: 'nowrap' }}>{r.q || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 200 ? (
          <div style={{ padding: 8, textAlign: 'center' }}><button type="button" style={btn()} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show the first 200' : `Show all ${sorted.length}`}</button></div>
        ) : null}
        {snap && !sorted.length ? <div style={{ padding: 14, color: C.dim, fontSize: 13 }}>{rows.length ? 'No company passes every filter. The small number on each filter shows which one is the tight one.' : (snap.notes[0] || 'No data yet.')}</div> : null}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', fontSize: 11.5, fontWeight: 800, color: 'var(--mc-text-3, #6b7280)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
function Th({ label, k, sort, setSort, num }: { label: string; k: string; sort: { key: string; dir: 1 | -1 }; setSort: (s: { key: string; dir: 1 | -1 }) => void; num?: boolean }) {
  const on = sort.key === k;
  return (
    <th style={{ ...th, textAlign: num ? 'right' : 'left' }}>
      <button type="button" onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : num ? -1 : 1 })} style={{ all: 'unset', cursor: 'pointer', color: on ? 'var(--mc-accent)' : undefined }}>
        {label} {on ? (sort.dir === -1 ? '▼' : '▲') : ''}
      </button>
    </th>
  );
}

function FilterEditor({ f, market, sectors, onChange, onClose }: { f: Filter; market: ScreenMarket; sectors: [string, number][]; onChange: (f: Filter) => void; onClose: () => void }) {
  const box: React.CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: C.bg1, display: 'grid', gap: 8, fontSize: 13 };
  const inp: React.CSSProperties = { width: 110, padding: '4px 6px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.bg, color: C.text };
  if (f.kind === 'sector') {
    const all = f.sectors.length === 0;
    return (
      <div style={box}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b>Sectors</b><span style={{ color: C.dim }}>{all ? 'none ticked = all sectors' : `${f.sectors.length} ticked`}</span><span style={{ flex: 1 }} /><button type="button" onClick={() => onChange({ kind: 'sector', sectors: [] })} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Clear</button><button type="button" onClick={onClose} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Done</button></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {sectors.map(([s, n]) => (
            <label key={s} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={f.sectors.includes(s)} onChange={(e) => onChange({ kind: 'sector', sectors: e.target.checked ? [...f.sectors, s] : f.sectors.filter((x) => x !== s) })} />
              {s} <span style={{ color: C.dim, fontSize: 11 }}>{n}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (f.kind === 'cmp') {
    return (
      <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>{fieldOf(f.key)?.label}</b>
        <select value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as 'above' | 'below' })} style={inp}><option value="above">above</option><option value="below">below</option></select>
        <select value={f.other} onChange={(e) => onChange({ ...f, other: e.target.value as NumKey })} style={{ ...inp, width: 'auto' }}>
          {FIELDS.filter((x) => x.unit === fieldOf(f.key)?.unit).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <button type="button" onClick={onClose} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Done</button>
      </div>
    );
  }
  const d = fieldOf(f.key);
  const unitWord = d?.unit === '%' ? '%' : d?.unit === 'money' ? (market === 'US' ? '$ million' : '₹ crore') : d?.unit === 'x' ? '×' : '';
  return (
    <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <b>{d?.label}</b>
      <select value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as 'gt' | 'lt' | 'between', v2: e.target.value === 'between' ? (f.v2 ?? f.v) : undefined })} style={inp}>
        <option value="gt">greater than</option><option value="lt">less than</option><option value="between">between</option>
      </select>
      <input type="number" value={Number.isFinite(f.v) ? f.v : ''} onChange={(e) => onChange({ ...f, v: Number(e.target.value) })} style={inp} />
      {f.op === 'between' ? <>and <input type="number" value={Number.isFinite(f.v2 as number) ? f.v2 : ''} onChange={(e) => onChange({ ...f, v2: Number(e.target.value) })} style={inp} /></> : null}
      <span style={{ color: C.dim }}>{unitWord}</span>
      {d?.approxNote?.[market] ? <span style={{ color: C.amber, fontSize: 12 }}>≈ {d.approxNote[market]}</span> : null}
      <button type="button" onClick={onClose} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Done</button>
    </div>
  );
}
