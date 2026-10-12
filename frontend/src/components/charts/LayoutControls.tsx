'use client';
// zzz944 — chart LAYOUTS for /charts: the store hook, the layout picker (name ▾ ● Save), the Indicators panel and the
// TradingView-style legend at the top-left of the chart with an eye toggle per line.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHART_LAYOUTS_KEY, EXTRA_INFO, EXTRA_TYPES, SPECIAL_EXTRAS, MAX_EXTRAS, MAX_LINES, activeLayout, cleanLayout, deleteLayout, mergeLayoutStores,
  newExtra, newLayoutId, renameLayout, saveLayout, saveLayoutAs, sameSettings, toggleRow,
  type ChartLayout, type Extra, type ExtraType, type LayoutStore, type LegendRow, type MaLine,
} from '@/lib/chart-layouts';
import { loadLayoutStore, saveLayoutStore } from '@/lib/chart-storage';
import { fmtPrice } from '@/lib/chart-math';
import { patternsOn, withPatterns } from './pattern-view';
import { stageOn, withStage } from './stage-view';
import { STAGE_TOOLTIP } from '@/lib/stage-analysis';

// ── store hook ────────────────────────────────────────────────────────────────
const LAYOUT_DRAFT_KEY = 'mc:chart-layout-draft:v1';
/** Saved layouts + the working copy on screen. `dirty` = the working copy differs from the saved layout (● in the picker). */
export function useLayouts() {
  // the /charts workspace renders in the browser only (ssr:false), so storage is read on first render
  const [store, setStore] = useState<LayoutStore>(() => loadLayoutStore());
  // zzz969 — an unsaved indicator change survives a reload (kept as a draft per layout until Save / Undo / switch)
  const [working, setWorking] = useState<ChartLayout>(() => {
    const base = cleanLayout(activeLayout(store));
    try {
      const d = JSON.parse(localStorage.getItem(LAYOUT_DRAFT_KEY) || 'null');
      if (d && d.id === store.activeId && d.working) { const w = cleanLayout(d.working); if (!sameSettings(w, base)) return w; }
    } catch { /* no draft */ }
    return base;
  });
  const lastWritten = useRef('');
  const workingRef = useRef(working);
  useEffect(() => { workingRef.current = working; }, [working]);
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);

  useEffect(() => {
    const json = JSON.stringify(store);
    if (json === lastWritten.current) return;
    lastWritten.current = json;
    saveLayoutStore(store);
  }, [store]);

  // another tab or device changed the layouts: merge, and follow the saved layout unless there are unsaved changes here
  useEffect(() => {
    const reload = () => {
      let raw: string | null = null;
      try { raw = localStorage.getItem(CHART_LAYOUTS_KEY); } catch { return; }
      if (!raw || raw === lastWritten.current) return;
      let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return; }
      const merged = mergeLayoutStores(storeRef.current, parsed);
      const wasClean = sameSettings(workingRef.current, activeLayout(storeRef.current));
      lastWritten.current = JSON.stringify(merged);
      setStore(merged);
      if (wasClean) setWorking(cleanLayout(activeLayout(merged)));
    };
    const onStorage = (e: StorageEvent) => { if (e.key === CHART_LAYOUTS_KEY) reload(); };
    const onRestored = (e: Event) => { const keys = (e as CustomEvent).detail?.keys; if (Array.isArray(keys) && keys.includes(CHART_LAYOUTS_KEY)) reload(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mc:vault:restored', onRestored);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('mc:vault:restored', onRestored); };
  }, []);

  const saved = activeLayout(store);
  const dirty = !sameSettings(working, saved);
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(LAYOUT_DRAFT_KEY, JSON.stringify({ id: store.activeId, working, at: Date.now() }));
      else localStorage.removeItem(LAYOUT_DRAFT_KEY);
    } catch { /* drafts are a convenience */ }
  }, [dirty, working, store.activeId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const switchTo = useCallback((id: string, saveFirst = false) => {
    const base = saveFirst ? saveLayout(storeRef.current, workingRef.current) : storeRef.current;
    const n = { ...base, activeId: id };
    storeRef.current = n; setStore(n); setWorking(cleanLayout(activeLayout(n)));
  }, []);
  const save = useCallback(() => setStore((s) => saveLayout(s, workingRef.current)), []);
  const saveAs = useCallback((name: string) => setStore((s) => saveLayoutAs(s, workingRef.current, name)), []);
  const rename = useCallback((name: string) => setStore((s) => renameLayout(s, s.activeId, name)), []);
  const remove = useCallback(() => {
    const n = deleteLayout(storeRef.current, storeRef.current.activeId);
    storeRef.current = n; setStore(n); setWorking(cleanLayout(activeLayout(n)));
  }, []);
  const revert = useCallback(() => setWorking(cleanLayout(activeLayout(storeRef.current))), []);
  return { store, working, setWorking, saved, dirty, switchTo, save, saveAs, rename, remove, revert };
}

const smallBtn = (active = false): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`,
  background: active ? 'var(--mc-accent)' : 'var(--mc-bg-1)', color: active ? '#ffffff' : 'var(--mc-text-1)',
});
const menuStyle: React.CSSProperties = { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 230, padding: 4, borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', boxShadow: '0 8px 24px rgba(0,0,0,.15)' };
const menuItem: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', background: 'none', color: 'var(--mc-text-1)', fontSize: 13, borderRadius: 4, cursor: 'pointer' };

// ── layout picker: [Manual Support Resistance ● ▾] [Save] ─────────────────────
export function LayoutPicker({ L }: { L: ReturnType<typeof useLayouts> }) {
  const [open, setOpen] = useState(false);
  const pick = (id: string) => {
    if (id === L.store.activeId) { setOpen(false); return; }
    if (L.dirty) {
      // zzz969 — Save / Discard / Stay instead of a yes-no that only offered to drop the changes
      const ans = window.prompt(`“${L.saved.name}” has unsaved indicator changes.\nType S to save them first, D to discard them, or press Cancel to stay.`, 'S');
      if (ans == null) return;
      const keep = /^s/i.test(ans.trim());
      if (!keep && !/^d/i.test(ans.trim())) return;
      L.switchTo(id, keep); setOpen(false); return;
    }
    L.switchTo(id); setOpen(false);
  };
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', border: '1px solid var(--mc-border-1)', borderRadius: 6, overflow: 'visible' }}>
      <button type="button" aria-label="Chart layout" title="Chart layouts (indicator sets)" onClick={() => setOpen((v) => !v)}
        style={{ ...smallBtn(), border: 'none', borderRadius: '6px 0 0 6px', maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {L.saved.name}{L.dirty ? <span title="Unsaved changes" style={{ color: 'var(--mc-accent)', marginLeft: 4 }}>●</span> : null} ▾
      </button>
      <button type="button" disabled={!L.dirty} onClick={L.save} title={L.dirty ? `Save these indicators into “${L.saved.name}”` : 'Nothing to save'}
        style={{ ...smallBtn(L.dirty), border: 'none', borderLeft: '1px solid var(--mc-border-1)', borderRadius: '0 6px 6px 0', opacity: L.dirty ? 1 : 0.55, cursor: L.dirty ? 'pointer' : 'default' }}>Save</button>
      {open && (
        <div style={menuStyle} onMouseLeave={() => setOpen(false)}>
          <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--mc-text-3)', fontWeight: 700 }}>LAYOUTS</div>
          {L.store.layouts.map((l) => (
            <button key={l.id} type="button" style={{ ...menuItem, fontWeight: l.id === L.store.activeId ? 700 : 400 }} onClick={() => pick(l.id)}>
              {l.id === L.store.activeId ? '✓ ' : ''}{l.name}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--mc-border-3)', margin: '4px 0' }} />
          <button type="button" style={menuItem} onClick={() => { const n = window.prompt('Name for the new layout:', `${L.saved.name} copy`); if (n && n.trim()) { L.saveAs(n); setOpen(false); } }}>Save as…</button>
          <button type="button" style={menuItem} onClick={() => { const n = window.prompt('New name for this layout:', L.saved.name); if (n && n.trim()) { L.rename(n); setOpen(false); } }}>Rename…</button>
          {L.dirty && <button type="button" style={menuItem} onClick={() => { L.revert(); setOpen(false); }}>Undo unsaved changes</button>}
          <button type="button" style={{ ...menuItem, color: 'var(--mc-bearish, #DC2626)', opacity: L.store.layouts.length > 1 ? 1 : 0.5 }} disabled={L.store.layouts.length <= 1}
            onClick={() => { if (window.confirm(`Delete the layout “${L.saved.name}”? Drawings are not touched.`)) { L.remove(); setOpen(false); } }}>Delete layout</button>
        </div>
      )}
    </div>
  );
}

// ── Indicators panel ──────────────────────────────────────────────────────────
const input: React.CSSProperties = { width: 58, padding: '3px 5px', borderRadius: 4, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-0)', fontSize: 13 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-text-3)', fontSize: 12, padding: 0 };

export function IndicatorsPanel({ L, onClose }: { L: ReturnType<typeof useLayouts>; onClose: () => void }) {
  const w = L.working;
  const setW = (fn: (l: ChartLayout) => ChartLayout) => L.setWorking((cur) => cleanLayout(fn(cur)));
  const setLine = (id: string, patch: Partial<MaLine>) => setW((l) => ({ ...l, lines: l.lines.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const setExtra = (id: string, patch: Partial<Extra>) => setW((l) => ({ ...l, extras: l.extras.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const [adding, setAdding] = useState('');
  const add = (what: string) => {
    if (what === 'EMA' || what === 'SMA') setW((l) => ({ ...l, lines: [...l.lines, { id: newLayoutId('m'), kind: what, period: 200, color: '#607D8B', on: true }] }));
    else if (what) setW((l) => ({ ...l, extras: [...l.extras, newExtra(what as ExtraType)] }));
    setAdding('');
  };
  return (
    <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, width: 340, maxHeight: '75vh', overflowY: 'auto', padding: 12, borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', fontSize: 13, color: 'var(--mc-text-1)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontWeight: 700, color: 'var(--mc-text-0)' }}>
        <span>Indicators — {L.saved.name}{L.dirty ? ' ●' : ''}</span>
        <button type="button" onClick={onClose} aria-label="Close indicators" style={{ ...linkBtn, fontSize: 16 }}>×</button>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text-3)', margin: '4px 0' }}>MOVING AVERAGES</div>
      {w.lines.map((x) => (
        <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <input type="checkbox" checked={x.on} onChange={(e) => setLine(x.id, { on: e.target.checked })} aria-label={`Show ${x.kind} ${x.period}`} />
          <select value={x.kind} onChange={(e) => setLine(x.id, { kind: e.target.value === 'SMA' ? 'SMA' : 'EMA' })} style={{ ...input, width: 62 }} aria-label="Average type">
            <option value="EMA">EMA</option><option value="SMA">SMA</option>
          </select>
          <input type="number" min={1} max={500} value={x.period} onChange={(e) => setLine(x.id, { period: Number(e.target.value) || x.period })} style={input} aria-label="Length" />
          <input type="color" value={x.color} onChange={(e) => setLine(x.id, { color: e.target.value })} aria-label="Colour" style={{ width: 30, height: 24, border: 'none', background: 'transparent', padding: 0 }} />
          <button type="button" style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => setW((l) => ({ ...l, lines: l.lines.filter((y) => y.id !== x.id) }))} aria-label={`Remove ${x.kind} ${x.period}`}>remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0', paddingTop: 8, borderTop: '1px solid var(--mc-border-3)' }}>
        <input type="checkbox" checked={w.volume.on} onChange={(e) => setW((l) => ({ ...l, volume: { ...l.volume, on: e.target.checked } }))} aria-label="Show volume" />
        <span>Volume, average of</span>
        <input type="number" min={1} max={200} value={w.volume.avg} onChange={(e) => setW((l) => ({ ...l, volume: { ...l.volume, avg: Number(e.target.value) || l.volume.avg } }))} style={{ ...input, width: 50 }} aria-label="Volume average length" />
        <span>bars</span>
      </div>
      {/* zzz982 — chart-pattern detection on the daily bars, one line at the top of the chart */}
      <div style={{ margin: '8px 0', paddingTop: 8, borderTop: '1px solid var(--mc-border-3)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={patternsOn(w)} onChange={(e) => setW((l) => withPatterns(l, e.target.checked))} aria-label="Automate chart patterns" />
          <b style={{ fontWeight: 600 }}>📐 Automate chart patterns</b>
        </label>
        <div style={{ paddingLeft: 22, marginTop: 2, fontSize: 12, color: 'var(--mc-text-3)' }}>
          Names the pattern the daily chart is forming (flat base, cup with handle, VCP, flags, double bottom, head &amp; shoulders …) in one line at the top of the chart, with its pivot, and draws it.
        </div>
      </div>
      {/* zzz987 — Stage Analysis (TheWrap method): our own version from the published rules */}
      <div style={{ margin: '8px 0', paddingTop: 8, borderTop: '1px solid var(--mc-border-3)' }} title={STAGE_TOOLTIP}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={stageOn(w)} onChange={(e) => setW((l) => withStage(l, e.target.checked))} aria-label="Stage Analysis (TheWrap method)" />
          <b style={{ fontWeight: 600 }}>Stage Analysis (TheWrap method)</b>
        </label>
        <div style={{ paddingLeft: 22, marginTop: 2, fontSize: 12, color: 'var(--mc-text-3)' }}>
          Weekly stages 1–4 as coloured bands (blue basing, green advancing, blue topping, red declining), the SATA score out of 10 and a Mansfield RS pane against the S&amp;P 500 / Nifty 50. Our own version that follows the published rules — not the original script.
        </div>
      </div>
      {w.extras.some((x) => !SPECIAL_EXTRAS.has(x.type)) && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text-3)', margin: '8px 0 4px', paddingTop: 8, borderTop: '1px solid var(--mc-border-3)' }}>OTHER INDICATORS</div>}
      {w.extras.filter((x) => !SPECIAL_EXTRAS.has(x.type)).map((x) => {
        const info = EXTRA_INFO[x.type];
        return (
          <div key={x.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={x.on} onChange={(e) => setExtra(x.id, { on: e.target.checked })} aria-label={`Show ${info.label}`} />
              <b style={{ fontWeight: 600 }}>{info.label}</b>
              {x.type !== 'ST' && <input type="color" value={x.color} onChange={(e) => setExtra(x.id, { color: e.target.value })} aria-label={`${info.label} colour`} style={{ width: 30, height: 22, border: 'none', background: 'transparent', padding: 0 }} />}
              <button type="button" style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => setW((l) => ({ ...l, extras: l.extras.filter((y) => y.id !== x.id) }))} aria-label={`Remove ${info.label}`}>remove</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, paddingLeft: 22 }}>
              {info.names.map((n, i) => (
                <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mc-text-3)' }}>{n}
                  <input type="number" step={info.min[i] < 1 ? 0.1 : 1} min={info.min[i]} max={info.max[i]} value={x.params[i]} aria-label={`${info.label} ${n}`}
                    onChange={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v)) return; const p = x.params.slice(); p[i] = v; setExtra(x.id, { params: p }); }} style={input} />
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--mc-border-3)' }}>
        <select aria-label="Add an indicator" value={adding} onChange={(e) => add(e.target.value)} style={{ ...input, width: 'auto', flex: 1 }}>
          <option value="">+ Add an indicator…</option>
          {w.lines.length < MAX_LINES && <option value="EMA">EMA line</option>}
          {w.lines.length < MAX_LINES && <option value="SMA">SMA line</option>}
          {w.extras.length < MAX_EXTRAS && EXTRA_TYPES.filter((t) => !SPECIAL_EXTRAS.has(t)).map((t) => <option key={t} value={t}>{EXTRA_INFO[t].label}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 8, color: 'var(--mc-text-3)', fontSize: 12 }}>
        Changes show at once; press <b>Save</b> next to the layout name to keep them in “{L.saved.name}”. VWAP is not offered — it needs bars inside the day, and these charts are daily or longer.
      </div>
    </div>
  );
}

// ── legend at the top-left of the chart ───────────────────────────────────────
export function IndicatorLegend({ rows, valueOf, onToggle, decimals, colorOf = (c: string) => c, textOf = (c: string) => c }: {
  rows: LegendRow[]; valueOf: (row: LegendRow) => (number | null)[]; onToggle: (id: string) => void; decimals: number; colorOf?: (c: string) => string;
  /** zzz967 (UI-01) — readable text colour for a line colour (the swatch keeps the line colour itself) */
  textOf?: (c: string) => string;
}) {
  if (!rows.length) return null;
  return (
    <div style={{ position: 'absolute', left: 8, top: 28, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, pointerEvents: 'none' }}>
      {rows.map((r) => {
        const vals = r.on ? valueOf(r) : [];
        return (
          <div key={r.id} className="mc-legend-row" style={{ display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none', color: r.on ? 'var(--mc-text-1)' : 'var(--mc-text-4)', lineHeight: '18px' }}>
            <span style={{ fontWeight: 600 }}>{r.label}</span>
            {r.pane && r.on && <span style={{ color: 'var(--mc-text-3)' }}>(lower pane)</span>}
            {!r.pane && r.on && <span style={{ color: 'var(--mc-text-3)' }}>close</span>}
            {!r.on && <span>(hidden)</span>}
            {vals.map((v, i) => {
              const lineC = colorOf(r.series[i]?.color || (r.label.startsWith('MACD') && i === 1 ? '#FF6D00' : r.color));
              return (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: textOf(lineC), fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: lineC, display: 'inline-block' }} />
                  {v != null ? fmtPrice(v, decimals) : '—'}
                </span>
              );
            })}
            <button type="button" onClick={() => onToggle(r.id)} aria-label={`${r.on ? 'Hide' : 'Show'} ${r.label}`} title={r.on ? 'Hide this line' : 'Show this line'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 12, color: 'var(--mc-text-3)', lineHeight: 1, pointerEvents: 'auto' }}>{r.on ? '👁' : '◌'}</button>
          </div>
        );
      })}
    </div>
  );
}
export { toggleRow };
