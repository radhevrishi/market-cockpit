'use client';
// zzz938 — STOCK SCREENER page (our own, replaces the TradingView screener). Downloads the day's snapshot once and filters in the
// browser, so every change is instant. Filters are chips like TradingView's: click to change, × to remove, + to add.
// zzz948 — all of the owner's own TradingView screens are built in (grouped USA / India, under their TradingView names), with
// "≥ another field", "within 0–10% above", exchange and date filters, and a note on a filter whose data is still being filled.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ScreenRow, ScreenMarket } from '@/lib/screener/types';
import {
  FIELDS, BUILT_IN_SCREENS, SCREENS_KEY, cleanScreens, fieldOf, filterCounts, filterKeys, filterLabel, fmtValue, runScreen,
  type CmpOp, type Filter, type NumKey, type NumOp, type Screen, type FieldGroup,
} from '@/lib/screener/filters';
import { TV_SECTORS } from '@/lib/screener/tv-sectors';
import { pollWhenVisible } from '@/lib/client-fetch';
import { useWorkspaceLight, workspaceThemeClass } from '@/lib/workspace-theme';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';
import { useWatchlistStore } from '@/components/charts/WatchlistPanel';
import { activeList, updateList, addItem, listCount, type WlItem } from '@/lib/chart-watchlist';
import { toCsv } from '@/lib/csv';
import {
  explainRow, naReason, closeConfirmed, stableOrder, exact, makeShortlist, cleanShortlists, diffShortlist, formulaImpact, changesSince,
  FORMULA_VERSION, SHORTLISTS_KEY, SCREEN_RUNS_KEY, type Shortlist, type ScreenRun,
} from '@/lib/screener/research';

const C = {
  text: 'var(--mc-text-0)', text1: 'var(--mc-text-1)', dim: 'var(--mc-text-3, #6b7280)', border: 'var(--mc-border-1)',
  bg: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', accent: 'var(--mc-accent)', green: 'var(--mc-bullish, #059669)', red: 'var(--mc-bearish, #DC2626)', amber: 'var(--mc-warn, #D97706)',
};
interface Snap { builtAt: string | null; rows: ScreenRow[]; notes: string[]; sources: string[] }
const LAST_KEY = 'mc:stock-screener:last:v1';   // the screen open last time (this browser only)

function readSaved(): Screen[] {
  try { return cleanScreens(JSON.parse(localStorage.getItem(SCREENS_KEY) || '[]')); } catch { return []; }
}
function writeSaved(list: Screen[]): boolean {
  try { localStorage.setItem(SCREENS_KEY, JSON.stringify(list)); return true; } catch { return false; }
}
const saved0 = (): Screen[] => (typeof window === 'undefined' ? [] : readSaved());
const newId = () => `my-${Date.now().toString(36)}`;
// zzz969 — unsaved filters per screen, kept so a reload or a screen switch does not lose them
const DRAFTS_KEY = 'mc:screener-drafts:v1';
type Draft = { market: ScreenMarket; name: string; filters: Filter[]; at: string };
function readDrafts(): Record<string, Draft> { try { return typeof window === 'undefined' ? {} : (JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') || {}); } catch { return {}; } }
function writeDraft(id: string, d: Omit<Draft, 'at'> | null): void {
  try { const all = readDrafts(); if (d) all[id] = { ...d, at: new Date().toISOString() }; else delete all[id]; localStorage.setItem(DRAFTS_KEY, JSON.stringify(all)); } catch { /* drafts are a convenience */ }
}
const GROUPS: FieldGroup[] = ['Price & volume', 'Moving averages', 'Momentum', 'Growth', 'Margins & returns', 'Valuation', 'Balance sheet', 'Company'];
function firstScreen(): Screen {
  let id: string | null = null;
  try { id = typeof window === 'undefined' ? null : localStorage.getItem(LAST_KEY); } catch { /* blocked */ }
  return saved0().find((x) => x.id === id) || BUILT_IN_SCREENS.find((x) => x.id === id) || BUILT_IN_SCREENS[0];
}

export default function StockScreener() {
  const [light, toggleLight] = useWorkspaceLight();   // zzz954: shared white / dark choice
  // zzz957: "exact figures only" — approximate (≈) figures fail filters instead of passing on an assumption; remembered here
  const [exactOnly, setExactOnly] = useState(() => { try { return localStorage.getItem('mc:screener-exact:v1') === '1'; } catch { return false; } });
  const toggleExact = () => setExactOnly((v) => { try { localStorage.setItem('mc:screener-exact:v1', v ? '0' : '1'); } catch { /* this visit only */ } return !v; });
  // zzz969 — close-confirmed mode: price figures of the last COMPLETED session when the snapshot was read during trading
  const [closeOnly, setCloseOnly] = useState(() => { try { return localStorage.getItem('mc:screener-close-only:v1') === '1'; } catch { return false; } });
  const toggleClose = () => setCloseOnly((v) => { try { localStorage.setItem('mc:screener-close-only:v1', v ? '0' : '1'); } catch { /* this visit only */ } return !v; });
  const [first] = useState<Screen>(() => firstScreen());
  const [draft0] = useState<Draft | null>(() => { const d = readDrafts()[first.id]; return d && Array.isArray(d.filters) ? d : null; });
  const [market, setMarket] = useState<ScreenMarket>(draft0?.market || first.market);
  const [snaps, setSnaps] = useState<Partial<Record<ScreenMarket, Snap>>>({});
  const [errors, setErrors] = useState<Partial<Record<ScreenMarket, string | null>>>({});
  const err = errors[market] || null;
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<Screen[]>(() => readSaved());   // the page loads in the browser only (ssr:false)
  const [screenId, setScreenId] = useState<string>(first.id);
  const [filters, setFilters] = useState<Filter[]>(() => draft0?.filters || JSON.parse(JSON.stringify((saved0().find((x) => x.id === first.id) || first).filters)));
  const [name, setName] = useState(() => draft0?.name || (saved0().find((x) => x.id === first.id) || first).name);
  const [dirty, setDirty] = useState(!!draft0);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'mc', dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [watchlists, updateWatchlists, watchlistSaveError, retryWatchlistSave] = useWatchlistStore();
  const [addingMatches, setAddingMatches] = useState(false);
  const [targetList, setTargetList] = useState('');
  const [whyTicker, setWhyTicker] = useState('');
  const [shortlists, setShortlists] = useState<Shortlist[]>(() => { try { return cleanShortlists(JSON.parse(localStorage.getItem(SHORTLISTS_KEY) || '[]')); } catch { return []; } });
  const [openSl, setOpenSl] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  // every screen the owner can pick: his saved ones win over a built-in with the same id
  const screens = useMemo(() => {
    const m = new Map<string, Screen>();
    for (const s of BUILT_IN_SCREENS) m.set(s.id, s);
    for (const s of saved) m.set(s.id, s);
    return Array.from(m.values());
  }, [saved]);
  const builtInIds = useMemo(() => new Set(BUILT_IN_SCREENS.map((s) => s.id)), []);
  const loadScreen = useCallback((id: string, list = screens) => {
    const s = list.find((x) => x.id === id);
    if (!s) return;
    setScreenId(s.id); setMarket(s.market); setFilters(JSON.parse(JSON.stringify(s.filters))); setName(s.name); setDirty(false); setEditIdx(null); setShowAll(false);
    try { localStorage.setItem(LAST_KEY, s.id); } catch { /* blocked */ }
  }, [screens]);
  const note = BUILT_IN_SCREENS.find((s) => s.id === screenId)?.note;

  useEffect(() => {
    const reload = () => {
      const next = readSaved();
      setSaved(next);
      if (dirty) { setMsg('Saved screens updated; your unsaved filters have been kept.'); return; }
      const list = new Map(BUILT_IN_SCREENS.map((s) => [s.id, s]));
      for (const s of next) list.set(s.id, s);
      loadScreen(list.has(screenId) ? screenId : BUILT_IN_SCREENS[0].id, Array.from(list.values()));
    };
    const storage = (e: StorageEvent) => { if (e.key === SCREENS_KEY || e.key === null) reload(); };
    const restored = (e: Event) => { const keys = (e as CustomEvent).detail?.keys; if (!Array.isArray(keys) || keys.includes(SCREENS_KEY)) reload(); };
    window.addEventListener('storage', storage); window.addEventListener('mc:vault:restored', restored);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('mc:vault:restored', restored); };
  }, [dirty, screenId, loadScreen]);

  useEffect(() => {
    let stopped = false, empty = false;
    let ctrl: AbortController | null = null;
    const load = () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      setLoading(true);
      fetch(`/api/v1/stock-screener?market=${market}`, { cache: 'no-store', signal })
        .then(async (r) => { const j = await r.json(); if (!r.ok || !j?.ok || !Array.isArray(j.rows)) throw new Error(j?.error || 'Could not load the screener data'); return j; })
        .then((j) => {
          if (stopped || signal.aborted) return;
          empty = !j.rows.length;
          setErrors((p) => ({ ...p, [market]: null }));
          setSnaps((p) => ({ ...p, [market]: { builtAt: j.builtAt, rows: j.rows, notes: j.notes || [], sources: j.sources || [] } }));
        })
        .catch((e) => { if (!stopped && !signal.aborted) setErrors((p) => ({ ...p, [market]: e?.message || 'Could not load the screener data' })); })
        .finally(() => { if (!stopped && !signal.aborted) setLoading(false); });
    };
    const stop = pollWhenVisible(load, () => empty ? 90_000 : 300_000, { runImmediately: true });
    return () => { stopped = true; stop(); ctrl?.abort(); };
  }, [market, refresh]);

  const snap = snaps[market];
  const rawRows = useMemo(() => snap?.rows || [], [snap]);
  const intradayRows = useMemo(() => rawRows.filter((r) => r.cc).length, [rawRows]);
  const rows = useMemo(() => (closeOnly ? rawRows.map(closeConfirmed) : rawRows), [rawRows, closeOnly]);
  const result = useMemo(() => runScreen(rows, filters, new Date(), exactOnly), [rows, filters, exactOnly]);
  const counts = useMemo(() => filterCounts(rows, filters, new Date(), exactOnly), [rows, filters, exactOnly]);
  // how many companies have each field yet (a field still filling shows a note on its filter)
  const known = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of FIELDS) m.set(f.key, 0);
    for (const r of rows) for (const f of FIELDS) { const v = r[f.key]; if (typeof v === 'number' && Number.isFinite(v)) m.set(f.key, (m.get(f.key) || 0) + 1); }
    return m;
  }, [rows]);
  const tvSecCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.tvSec) m.set(r.tvSec, (m.get(r.tvSec) || 0) + 1);
    return m;
  }, [rows]);
  // the columns: basics + every field a filter uses
  const cols = useMemo(() => {
    const keys: NumKey[] = ['px', 'chg', 'mc'];
    for (const f of filters) for (const k of filterKeys(f)) if (!keys.includes(k)) keys.push(k);
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
  // zzz969 — rows keep their places when new data arrives (the snapshot reloads every few minutes); "Re-sort now" re-orders
  const [resortTick, setResortTick] = useState(0);
  const ctx = `${market}|${screenId}|${JSON.stringify(filters)}|${sort.key}|${sort.dir}|${exactOnly}|${closeOnly}|${resortTick}`;
  const [frozen, setFrozen] = useState<{ ctx: string; keys: string[] } | null>(null);
  const ordered = useMemo(() => stableOrder(frozen && frozen.ctx === ctx ? frozen.keys : null, sorted, (r) => r.t), [sorted, ctx, frozen]);
  if (sorted.length && (!frozen || frozen.ctx !== ctx)) setFrozen({ ctx, keys: sorted.map((r) => r.t) });   // a new view: its own order
  const shown = showAll ? ordered.rows : ordered.rows.slice(0, 200);
  const addMatches = () => {
    if (!watchlists || !sorted.length) return;
    if (targetList && !watchlists.lists.some((l) => l.id === targetList)) { setMsg('Could not add: the selected watchlist no longer exists. Choose a destination.'); return; }
    const target = watchlists.lists.find((l) => l.id === targetList) || activeList(watchlists);
    let next = target;
    for (const r of sorted) {
      const item: WlItem = { m: market, t: r.t, ...(r.exch?.[0] ? { x: r.exch[0] } : {}) };
      next = addItem(next, null, item);
    }
    const added = listCount(next) - listCount(target);
    updateWatchlists((s) => updateList(s, target.id, () => next));
    setMsg(`${added} symbols added to ${target.name}${sorted.length > added ? `; ${sorted.length - added} already present or beyond the list limit` : ''}.`);
    setAddingMatches(false);
  };

  const change = (next: Filter[]) => { setFilters(next); setDirty(true); };

  // ── zzz969 — drafts: unsaved filters survive a reload, and switching screens asks first ──────────────────────────────
  useEffect(() => { if (dirty) writeDraft(screenId, { market, name, filters }); }, [dirty, screenId, market, name, filters]);
  const [draftNote, setDraftNote] = useState<string | null>(() => (draft0 ? `Restored your unsaved filters from ${new Date(draft0.at).toLocaleString()}.` : null));
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const askSwitch = (id: string) => { if (id === screenId) return; if (dirty) setPendingSwitch(id); else switchTo(id); };
  const switchTo = (id: string) => {
    setPendingSwitch(null); setDraftNote(null);
    const d = readDrafts()[id];
    loadScreen(id);
    if (d && Array.isArray(d.filters)) { setFilters(d.filters); setMarket(d.market); setName(d.name); setDirty(true); setDraftNote(`Your unsaved filters for this screen (from ${new Date(d.at).toLocaleString()}) are open.`); }
  };
  const discardDraft = () => { writeDraft(screenId, null); setDraftNote(null); loadScreen(screenId); };

  // ── zzz969 — shortlists: a saved result that can be reopened exactly, and what changed since ────────────────────────
  const writeShortlists = (list: Shortlist[]) => { try { localStorage.setItem(SHORTLISTS_KEY, JSON.stringify(list)); setShortlists(list); return true; } catch { setMsg('Not saved: storage is full or blocked.'); return false; } };
  const saveShortlist = () => {
    if (!sorted.length) return;
    const nm = (window.prompt('Name for this shortlist', `${name} — ${new Date().toLocaleDateString()}`) || '').trim();
    if (!nm) return;
    const sl = makeShortlist({ name: nm.slice(0, 80), market, screenId, screenName: name, filters, exactOnly, closeOnly, snapshotBuiltAt: snap?.builtAt || null }, sorted, cols as string[]);
    if (writeShortlists([...shortlists, sl].slice(-60))) { setMsg(`Shortlist "${sl.name}" saved (${sl.rows.length} companies)`); setTimeout(() => setMsg(null), 3000); }
  };
  const openShortlist = openSl ? shortlists.find((x) => x.id === openSl) || null : null;
  const slDiff = useMemo(() => {
    if (!openShortlist || openShortlist.market !== market || !rawRows.length) return null;
    const base = openShortlist.closeOnly ? rawRows.map(closeConfirmed) : rawRows;
    return diffShortlist(openShortlist, base, runScreen(base, openShortlist.filters, new Date(), openShortlist.exactOnly), market);
  }, [openShortlist, rawRows, market]);

  // ── zzz969 — formula-version impact: did a calculation change since this screen last ran in this browser? ───────────
  const [impactSeen, setImpactSeen] = useState<string | null>(null);
  const prevRun = useMemo<ScreenRun | undefined>(() => { try { return (JSON.parse(localStorage.getItem(SCREEN_RUNS_KEY) || '{}') || {})[screenId]; } catch { return undefined; } }, [screenId]);   // read once per screen
  const impact = useMemo(() => {
    if (!snap || !rows.length || dirty || impactSeen === screenId) return null;
    const imp = formulaImpact(prevRun, result.map((r) => r.t));
    return imp && (imp.added.length || imp.removed.length) ? imp : null;
  }, [snap, rows.length, dirty, impactSeen, screenId, prevRun, result]);
  useEffect(() => {
    if (!snap || !rows.length || dirty) return;
    let runs: Record<string, ScreenRun> = {};
    try { runs = JSON.parse(localStorage.getItem(SCREEN_RUNS_KEY) || '{}') || {}; } catch { /* none */ }
    runs[screenId] = { v: FORMULA_VERSION, at: new Date().toISOString(), tickers: result.map((r) => r.t).slice(0, 2000) };
    try { localStorage.setItem(SCREEN_RUNS_KEY, JSON.stringify(runs)); } catch { /* a convenience */ }
  }, [snap, screenId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const whyRow = useMemo(() => { const t = whyTicker.trim().toUpperCase(); return t ? rows.find((r) => r.t === t) || null : null; }, [whyTicker, rows]);
  const whyChecks = useMemo(() => (whyRow ? explainRow(whyRow, filters, market, new Date(), exactOnly) : []), [whyRow, filters, market, exactOnly]);
  const save = (asNew: boolean) => {
    const id = asNew ? newId() : screenId;
    const nm = asNew ? (window.prompt('Name for this screen', `${name} (copy)`) || '').trim() : name;
    if (!nm) return;
    const s: Screen = { id, name: nm.slice(0, 80), market, filters };
    const list = [...readSaved().filter((x) => x.id !== id), s];
    if (!writeSaved(list)) { setDirty(true); setMsg('Not saved: storage is full or blocked. Your filters are still open; retry Save or download the results.'); return; }
    setSaved(list); setScreenId(id); setName(s.name); setDirty(false);
    writeDraft(screenId, null); writeDraft(id, null); setDraftNote(null);
    try { localStorage.setItem(LAST_KEY, id); } catch { /* blocked */ }
    setMsg(`Saved "${s.name}"`); setTimeout(() => setMsg(null), 2500);
  };
  const removeSaved = () => {
    const isBuiltIn = builtInIds.has(screenId);
    if (!window.confirm(isBuiltIn ? 'Put this screen back to how it is in TradingView?' : `Delete "${name}"?`)) return;
    const list = readSaved().filter((x) => x.id !== screenId);
    if (!writeSaved(list)) { setMsg('Could not save the deletion/reset: storage is full or blocked. Please retry.'); return; }
    setSaved(list);
    loadScreen(isBuiltIn ? screenId : BUILT_IN_SCREENS[0].id, [...BUILT_IN_SCREENS, ...list]);
  };
  const copyTickers = () => {
    const txt = sorted.map((r) => (market === 'IN' ? `NSE:${r.t}` : r.t)).join(',');
    navigator.clipboard?.writeText(txt).then(() => { setMsg(`Copied ${sorted.length} tickers`); setTimeout(() => setMsg(null), 2500); }).catch(() => {});
  };
  const downloadCsv = () => {
    // zzz967 (SC-01) — headers go through the same encoder as cells ("Revenue growth, quarterly YoY" used to split into two
    // columns: 26 header fields over 18 data fields); units in the header; market, snapshot time and ≈ fields on every row.
    const unitOf = (k: string) => {
      const u = fieldOf(k as any)?.unit;
      return u === '%' ? '%' : u === 'x' ? '×' : u === 'money' ? (market === 'US' ? '$ million' : '₹ crore') : u === 'price' ? (market === 'US' ? 'USD' : 'INR') : u === 'usd' ? 'USD' : u === 'shares' ? 'shares' : u === 'date' ? 'date' : '';
    };
    const head = ['Ticker', 'Market', 'Company', 'Sector', ...cols.map((k) => { const l = fieldOf(k)?.label || k; const u = unitOf(k); return u ? `${l} (${u})` : l; }), 'Approximate (≈) fields', 'Snapshot built (UTC)'];
    const built = snap?.builtAt || '';
    const body = sorted.map((r) => [r.t, market === 'IN' ? 'NSE' : 'US', r.n, r.tvSec || r.sec, ...cols.map((k) => r[k]),
      (r.approx || []).filter((k: string) => cols.includes(k as any)).map((k: string) => fieldOf(k as any)?.label || k).join('; '), built]);
    const blob = new Blob(['\uFEFF' + toCsv([head, ...body])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name.replace(/[^\w-]+/g, '_')}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const pick = (key: string) => {
    const add = (f: Filter) => { change([...filters, f]); setEditIdx(filters.length); };
    if (key === 'sector') return add({ kind: 'sector', sectors: [] });
    if (key === 'exch') return add({ kind: 'exch', ex: market === 'US' ? ['NASDAQ', 'NYSE'] : ['NSE'] });
    if (key === 'cmp') return add({ kind: 'cmp', key: 'sma50', op: 'ge', other: 'sma200' });
    if (key === 'near') return add({ kind: 'near', key: 'px', other: 'ema10', lo: 0, hi: 10 });
    const d = fieldOf(key); if (!d) return;
    if (d.unit === 'date') return add({ kind: 'date', key: d.key, op: d.key === 'earnD' ? 'thisMonth' : 'pastYears', v: 5 });
    add({ kind: 'num', key: d.key, op: 'gt', v: 0 });
  };
  const btn = (on = false): React.CSSProperties => ({ padding: '5px 10px', borderRadius: 6, border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.bg1, color: on ? '#fff' : C.text1, fontSize: 13, fontWeight: 600, cursor: 'pointer' });
  const builtAt = snap?.builtAt ? new Date(snap.builtAt) : null;
  const withFigures = useMemo(() => rows.filter((r) => r.q).length, [rows]);
  // zzz967 (SC-02) — say WHY the rest have none: a refresh cannot add quarterly figures an annual-only filer never files
  const coverageWhy = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) if (!r.q) { const k = r.nq || (market === 'IN' ? 'pending' : 'unknown'); c[k] = (c[k] || 0) + 1; }
    const label: Record<string, string> = { 'annual-only': 'annual-only filers (20-F / 40-F, no quarterly figures)', 'recent-listing': 'recent listings (no year-ago quarter yet)',
      'not-in-sec': 'not in SEC’s company list', 'missing-tags': 'in SEC but without the tags read', pending: 'still to be read (next runs)', unknown: 'reason not recorded (older snapshot)' };
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${label[k] || k}`).join(', ');
  }, [rows, market]);
  const latestQ = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) if (r.q) m.set(r.q, (m.get(r.q) || 0) + 1); return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null; }, [rows]);
  const opt = (s: Screen) => <option key={s.id} value={s.id}>{s.name}</option>;
  const mine = screens.filter((s) => !builtInIds.has(s.id));

  return (
    <div className={workspaceThemeClass(light, true)} style={{ padding: '12px 16px', display: 'grid', gap: 10, color: C.text, background: 'var(--mc-bg-0)', minHeight: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 18 }}>Stock Screener</b>
        <WorkspaceThemeToggle light={light} onToggle={toggleLight} />
        <select value={screenId} onChange={(e) => askSwitch(e.target.value)} style={{ ...btn(), fontSize: 14, maxWidth: 380 }} aria-label="Screens">
          <optgroup label="🇺🇸 USA — your TradingView screens">{screens.filter((s) => builtInIds.has(s.id) && s.market === 'US').map(opt)}</optgroup>
          <optgroup label="🇮🇳 India — your TradingView screens">{screens.filter((s) => builtInIds.has(s.id) && s.market === 'IN').map(opt)}</optgroup>
          {mine.length ? <optgroup label="Made here">{mine.map((s) => <option key={s.id} value={s.id}>{s.market === 'IN' ? '🇮🇳' : '🇺🇸'} {s.name}</option>)}</optgroup> : null}
        </select>
        <button type="button" style={btn(dirty)} onClick={() => save(false)} title="Save the filters into this screen">Save{dirty ? ' •' : ''}</button>
        <button type="button" style={btn()} onClick={() => save(true)}>Save as new…</button>
        <button type="button" style={btn()} onClick={removeSaved} title="Delete a screen you made, or put a built-in screen back to its TradingView setup">{builtInIds.has(screenId) ? 'Reset' : 'Delete'}</button>
        <span style={{ marginLeft: 8, display: 'inline-flex', gap: 4 }}>
          {(['US', 'IN'] as const).map((m) => <button key={m} type="button" style={btn(market === m)} onClick={() => { setMarket(m); setDirty(true); }}>{m === 'US' ? '🇺🇸 USA' : '🇮🇳 India'}</button>)}
        </span>
        {msg ? <span role="status" style={{ color: /^(Not saved|Could not)/.test(msg) ? C.red : C.text1, fontSize: 13, fontWeight: 700 }}>{msg}</span> : null}
      </div>
      {note && !dirty ? <div style={{ fontSize: 12.5, color: C.dim }}>ℹ {note}</div> : null}
      {pendingSwitch ? (
        <div role="dialog" aria-label="Unsaved filters" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 10, border: `1px solid ${C.amber}`, borderRadius: 8, fontSize: 13 }}>
          <b>&quot;{name}&quot; has unsaved filter changes.</b>
          <button type="button" style={btn(true)} onClick={() => { save(false); switchTo(pendingSwitch); }}>Save and switch</button>
          <button type="button" style={btn()} onClick={() => switchTo(pendingSwitch)} title="Your changes stay saved as a draft for this screen and come back when you open it again">Keep draft and switch</button>
          <button type="button" style={btn()} onClick={() => { writeDraft(screenId, null); switchTo(pendingSwitch); }}>Discard and switch</button>
          <button type="button" style={btn()} onClick={() => setPendingSwitch(null)}>Stay</button>
        </div>
      ) : null}
      {draftNote ? <div style={{ fontSize: 12.5, color: C.amber }}>✎ {draftNote} <button type="button" style={btn()} onClick={() => save(false)}>Save</button> <button type="button" style={btn()} onClick={discardDraft}>Discard draft</button></div> : null}
      {impact ? (
        <div style={{ fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
          <b>Formulas changed since this screen last ran here</b> — {impact.added.length} entered, {impact.removed.length} left
          {impact.added.length ? <span> · in: {impact.added.slice(0, 12).join(', ')}{impact.added.length > 12 ? '…' : ''}</span> : null}
          {impact.removed.length ? <span> · out: {impact.removed.slice(0, 12).join(', ')}{impact.removed.length > 12 ? '…' : ''}</span> : null}
          <ul style={{ margin: '4px 0 0 16px', color: C.dim }}>{impact.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <span style={{ color: C.dim }}>(price moves and new filings can also change the list — the shortlist panel shows the cause per company)</span>
          <button type="button" style={{ ...btn(), marginLeft: 8 }} onClick={() => setImpactSeen(screenId)}>OK</button>
        </div>
      ) : null}
      {intradayRows > 0 ? (
        <div style={{ fontSize: 12.5, color: closeOnly ? C.green : C.amber }}>
          {closeOnly
            ? `◉ Completed sessions only: ${intradayRows} companies were read during trading — their price, change and moving averages are the last CLOSE, not today's live values.`
            : `◌ ${intradayRows} companies were read during today's session — a cross above SMA 50 now may not hold at the close. Tick "Completed sessions only" to screen on closing prices.`}
        </div>
      ) : null}

      {/* filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {filters.map((f, i) => {
          const keys = filterKeys(f);
          const approx = keys.map((k) => fieldOf(k)?.approxNote?.[market]).filter(Boolean).join(' · ');
          const wrongMarket = keys.some((k) => !fieldOf(k)?.markets.includes(market));
          const have = keys.length && rows.length ? Math.min(...keys.map((k) => known.get(k) || 0)) : rows.length;
          const sparse = keys.map((k) => fieldOf(k)?.sparse?.[market]).filter(Boolean).join(' · ');
          const filling = rows.length > 0 && !wrongMarket && !sparse && have < rows.length * 0.5;
          const tip = [approx ? `Approximate — ${approx}` : '', sparse ? `${have} of ${rows.length} companies have this figure — ${sparse}` : '', wrongMarket ? 'Not available for this market' : '', filling ? `Data still filling: ${have} of ${rows.length} companies have this figure so far (the rest come in the next runs)` : '', 'Click to change'].filter(Boolean).join('\n');
          return (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 6, background: editIdx === i ? C.accent : '#374151', color: '#fff', fontSize: 13, overflow: 'hidden' }}>
              <button type="button" onClick={() => setEditIdx(editIdx === i ? null : i)} title={tip} style={{ all: 'unset', cursor: 'pointer', padding: '5px 9px' }}>
                {filterLabel(f, market)}{approx ? ' ≈' : ''}{wrongMarket ? ' (n/a)' : ''}{filling ? ' ⏳' : ''}{sparse ? <span style={{ opacity: 0.7, fontSize: 11 }}> (few have it)</span> : null} <span style={{ opacity: 0.65, fontSize: 11 }}>· {counts[i] ?? 0}</span>
              </button>
              <button type="button" aria-label="Remove filter" onClick={() => { change(filters.filter((_, k) => k !== i)); setEditIdx(null); }}
                style={{ all: 'unset', cursor: 'pointer', padding: '5px 8px', borderLeft: '1px solid rgba(255,255,255,0.2)' }}>×</button>
            </span>
          );
        })}
        <select value="" onChange={(e) => { if (e.target.value) pick(e.target.value); }} style={{ ...btn(), fontWeight: 700 }} aria-label="Add a filter">
          <option value="">+ Add filter</option>
          <optgroup label="Lists and comparisons">
            <option value="sector">Sector (TradingView&apos;s sectors)</option>
            <option value="exch">Exchange</option>
            <option value="cmp">One figure against another (e.g. SMA 50 ≥ SMA 200)</option>
            <option value="near">Within a % range above another (e.g. price 0–10% above EMA 10)</option>
          </optgroup>
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {FIELDS.filter((f) => f.group === g && f.markets.includes(market)).map((f) => <option key={f.key} value={f.key}>{f.label}{f.approxNote?.[market] ? ' ≈' : ''}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {filters.some((f) => filterKeys(f).some((k) => rows.length && !fieldOf(k)?.sparse?.[market] && (known.get(k) || 0) < rows.length * 0.5)) ? (
        <div style={{ fontSize: 12, color: C.amber }}>⏳ = this figure is still being filled in (read a slice at a time) — fewer companies than TradingView can pass it until the reads finish. Hover a filter for how many have it.</div>
      ) : null}

      {editIdx != null && filters[editIdx] ? (
        <FilterEditor f={filters[editIdx]} market={market} tvSecCount={tvSecCount} onChange={(nf) => change(filters.map((x, k) => (k === editIdx ? nf : x)))} onClose={() => setEditIdx(null)} />
      ) : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 13 }}>
        <b style={{ fontSize: 15 }}>{snap ? `${result.length} of ${rows.length} companies match` : err ? '' : 'Loading…'}</b>
        {builtAt ? <span style={{ color: C.dim }}>data built {builtAt.toLocaleString()}{latestQ ? ` · most figures to ${latestQ}` : ''}{rows.length && withFigures < rows.length * 0.9 ? ` · company figures for ${withFigures} of ${rows.length}${coverageWhy ? ` — ${coverageWhy}` : ''}` : ''} · the small number on each filter = companies passing that filter alone</span> : null}
        {err ? <span role="alert" style={{ color: C.red }}>{err}{snap ? ' — showing the last loaded snapshot' : ''}</span> : null}
        <span style={{ flex: 1 }} />
        <label title="On: a figure worked out with an assumption (shown with ≈, e.g. EV / revenue with debt taken as 0 because the company files no debt line) does not count as passing a filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={exactOnly} onChange={toggleExact} aria-label="Exact figures only" /> Exact figures only (no ≈)
        </label>
        <label title="On: for companies read during today's trading session, price, change and moving averages are taken from the last completed session (a close-confirmed breakout), not the live price" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={closeOnly} onChange={toggleClose} aria-label="Completed sessions only" /> Completed sessions only
        </label>
        {ordered.moved ? <button type="button" style={btn(true)} onClick={() => setResortTick((v) => v + 1)} title="New data arrived; rows were kept in place so you do not click the wrong one">Re-sort now</button> : null}
        <button type="button" style={btn()} onClick={saveShortlist} disabled={!sorted.length} title="Keep this result: the companies, their figures, the filters and the snapshot time — reopen it later to see what changed">Save shortlist</button>
        {shortlists.length ? (
          <select value={openSl || ''} onChange={(e) => setOpenSl(e.target.value || null)} style={btn()} aria-label="Saved shortlists">
            <option value="">Shortlists ({shortlists.length})</option>
            {shortlists.slice().reverse().map((x) => <option key={x.id} value={x.id}>{x.market === 'IN' ? '🇮🇳' : '🇺🇸'} {x.name} · {x.rows.length}</option>)}
          </select>
        ) : null}
        <button type="button" style={btn()} disabled={loading} onClick={() => setRefresh((v) => v + 1)}>{loading ? 'Refreshing…' : err ? 'Retry' : 'Refresh'}</button>
        <button type="button" style={btn()} onClick={copyTickers} disabled={!sorted.length}>Copy tickers</button>
        <button type="button" style={btn()} onClick={downloadCsv} disabled={!sorted.length}>Download CSV</button>
        <button type="button" style={btn()} onClick={() => setAddingMatches((v) => !v)} disabled={!sorted.length || !watchlists}>Add matches to watchlist</button>
      </div>
      {addingMatches && watchlists && <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <label>Destination <select aria-label="Watchlist for screener matches" value={targetList || activeList(watchlists).id} onChange={(e) => setTargetList(e.target.value)} style={btn()}>{watchlists.lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({listCount(l)})</option>)}</select></label>
        <span style={{ fontSize: 12, color: C.dim }}>{sorted.length} matching symbols; duplicates are skipped; each list holds up to 1,000.</span>
        <button type="button" style={btn()} onClick={addMatches}>Add symbols</button>
        <button type="button" style={btn()} onClick={() => setAddingMatches(false)}>Cancel</button>
      </div>}
      {watchlistSaveError && <div role="alert" style={{ color: C.amber }}>{watchlistSaveError} <button type="button" style={btn()} onClick={retryWatchlistSave}>Retry watchlist save</button></div>}
      {snap?.notes?.length ? (
        <details style={{ fontSize: 12, color: C.dim }}>
          <summary style={{ cursor: 'pointer' }}>Where the figures come from, and what could not be read</summary>
          <div>Sources: {snap.sources.join(' · ')}. A company whose figure is not known fails that filter. ≈ marks a figure worked out in a rougher way (hover a filter for how). Sectors are TradingView&apos;s 21, worked out from each company&apos;s industry (right for about 4 in 5 companies).</div>
          <ul style={{ margin: '4px 0 0 16px' }}>{snap.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      ) : null}

      {openShortlist ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 13, display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <b>Shortlist: {openShortlist.name}</b>
            <span style={{ color: C.dim }}>saved {new Date(openShortlist.savedAt).toLocaleString()} · screen “{openShortlist.screenName}” · data built {openShortlist.snapshotBuiltAt ? new Date(openShortlist.snapshotBuiltAt).toLocaleString() : 'unknown'} · formulas {openShortlist.formulaVersion}{openShortlist.exactOnly ? ' · exact only' : ''}{openShortlist.closeOnly ? ' · completed sessions only' : ''}</span>
            <span style={{ flex: 1 }} />
            <button type="button" style={btn()} onClick={() => { setFilters(JSON.parse(JSON.stringify(openShortlist.filters))); setMarket(openShortlist.market); setDirty(true); }}>Load its filters</button>
            <button type="button" style={btn()} onClick={() => { navigator.clipboard?.writeText(openShortlist.rows.map((r) => (openShortlist.market === 'IN' ? `NSE:${r.t}` : r.t)).join(',')); setMsg('Copied the saved tickers'); }}>Copy saved tickers</button>
            <button type="button" style={btn()} onClick={() => { if (window.confirm(`Delete shortlist "${openShortlist.name}"?`)) { writeShortlists(shortlists.filter((x) => x.id !== openShortlist.id)); setOpenSl(null); } }}>Delete</button>
            <button type="button" style={btn()} onClick={() => setOpenSl(null)}>Close</button>
          </div>
          <div style={{ color: C.dim }}>Saved result ({openShortlist.rows.length}): {openShortlist.rows.slice(0, 60).map((r) => r.t).join(', ')}{openShortlist.rows.length > 60 ? '…' : ''}</div>
          {openShortlist.market !== market ? <div style={{ color: C.amber }}>Switch to {openShortlist.market === 'IN' ? 'India' : 'USA'} to compare with today.</div> : slDiff ? (
            <>
              <div><b>Today with the same filters:</b> {slDiff.stayed} still in · <span style={{ color: C.green }}>{slDiff.entered.length} entered</span> · <span style={{ color: C.red }}>{slDiff.exited.length} left</span></div>
              {slDiff.formulaChanged.length ? <div style={{ color: C.amber }}>Formulas changed since it was saved: {slDiff.formulaChanged.join(' · ')}</div> : null}
              {slDiff.exited.length ? <details open><summary style={{ cursor: 'pointer' }}>Left ({slDiff.exited.length})</summary><ul style={{ margin: '4px 0 0 16px' }}>{slDiff.exited.slice(0, 80).map((x) => <li key={x.t}><b>{x.t}</b> — {x.why}</li>)}</ul></details> : null}
              {slDiff.entered.length ? <details><summary style={{ cursor: 'pointer' }}>Entered ({slDiff.entered.length})</summary><ul style={{ margin: '4px 0 0 16px' }}>{slDiff.entered.slice(0, 80).map((x) => <li key={x.t}><b>{x.t}</b> — {x.why}</li>)}</ul></details> : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Why is a company in or out?
          <input list="mc-screener-tickers" value={whyTicker} onChange={(e) => setWhyTicker(e.target.value)} placeholder="ticker" aria-label="Explain a company" style={{ ...btn(), width: 120, fontWeight: 400 }} />
        </label>
        <datalist id="mc-screener-tickers">{rows.slice(0, 3000).map((r) => <option key={r.t} value={r.t}>{r.n}</option>)}</datalist>
        {whyTicker && !whyRow ? <span style={{ color: C.dim }}>not in this snapshot</span> : null}
      </div>
      {whyRow ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 13 }}>
          <b>{whyRow.t}</b> <span style={{ color: C.dim }}>{whyRow.n}</span> — {whyChecks.every((c) => c.pass) ? <span style={{ color: C.green }}>passes every filter</span> : <span style={{ color: C.red }}>fails {whyChecks.filter((c) => !c.pass).length} of {whyChecks.length}</span>}
          <ul style={{ margin: '6px 0 0 16px' }}>
            {whyChecks.map((c, i) => <li key={i} style={{ color: c.pass ? C.text1 : C.red }}>{c.pass ? '✓' : '✗'} {c.label}: <span style={{ color: c.nearMiss ? C.amber : C.dim }}>{c.detail}</span></li>)}
          </ul>
        </div>
      ) : null}

      <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.bg1, position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={th}>#</th>
              <Th label="Company" k="t" sort={sort} setSort={setSort} />
              <Th label="Sector" k="tvSec" sort={sort} setSort={setSort} />
              {cols.map((k) => <Th key={k} label={fieldOf(k)?.label || k} k={k} sort={sort} setSort={setSort} num />)}
              <Th label="Quarter" k="q" sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.t} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ ...td, color: C.dim }}><button type="button" onClick={() => setWhyTicker(r.t)} title="Show every filter for this company, with exact values" style={{ all: 'unset', cursor: 'pointer' }}>{i + 1}</button></td>
                <td style={td}>
                  <Link href={`/charts?t=${encodeURIComponent(r.t)}&m=${market}&tf=D`} style={{ color: C.accent, fontWeight: 700, textDecoration: 'none' }} title="Open the chart">{r.t}</Link>
                  <div style={{ fontSize: 11.5, color: C.dim, maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.n}</div>
                </td>
                <td style={{ ...td, fontSize: 12, color: C.dim, maxWidth: 160 }} title={[r.sec, r.ind].filter(Boolean).join(' · ')}>{r.tvSec || r.sec || '—'}</td>
                {cols.map((k) => {
                  const d = fieldOf(k); const v = r[k] as number | null;
                  const ax = r.approx?.includes(k);
                  const col = k === 'chg' && typeof v === 'number' ? (v >= 0 ? C.green : C.red) : C.text;
                  const na = naReason(r, k);
                  const tip = [typeof v === 'number' ? `Exact value: ${exact(v)} (filters compare this, not the rounded figure)` : na ? `Not applicable: ${na}` : 'Not known', ax ? 'Approximate for this company' : '', na && typeof v === 'number' ? 'Not meaningful for financial companies' : ''].filter(Boolean).join('\n');
                  return <td key={k} style={{ ...td, textAlign: 'right', color: col, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} title={tip}>{ax ? '≈' : ''}{v == null && na ? <span style={{ color: C.dim, fontStyle: 'italic' }}>n/a</span> : fmtValue(v, d?.unit || 'num', market)}</td>;
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

function FilterEditor({ f, market, tvSecCount, onChange, onClose }: { f: Filter; market: ScreenMarket; tvSecCount: Map<string, number>; onChange: (f: Filter) => void; onClose: () => void }) {
  const box: React.CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: C.bg1, display: 'grid', gap: 8, fontSize: 13 };
  const inp: React.CSSProperties = { width: 110, padding: '4px 6px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.bg, color: C.text };
  const done = <button type="button" onClick={onClose} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Done</button>;
  const fieldSelect = (value: NumKey, set: (k: NumKey) => void, unit?: string) => (
    <select value={value} onChange={(e) => set(e.target.value as NumKey)} style={{ ...inp, width: 'auto' }}>
      {FIELDS.filter((x) => x.markets.includes(market) && (!unit || x.unit === unit)).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
    </select>
  );
  if (f.kind === 'sector') {
    const all = f.sectors.length === 0;
    return (
      <div style={box}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b>Sectors</b><span style={{ color: C.dim }}>{all ? 'none ticked = all sectors' : `${f.sectors.length} ticked`}</span><span style={{ flex: 1 }} /><button type="button" onClick={() => onChange({ kind: 'sector', sectors: [] })} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Clear</button>{done}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {TV_SECTORS.map((s) => (
            <label key={s} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={f.sectors.includes(s)} onChange={(e) => onChange({ kind: 'sector', sectors: e.target.checked ? [...f.sectors, s] : f.sectors.filter((x) => x !== s) })} />
              {s} <span style={{ color: C.dim, fontSize: 11 }}>{tvSecCount.get(s) || 0}</span>
            </label>
          ))}
        </div>
        <div style={{ color: C.dim, fontSize: 12 }}>≈ TradingView&apos;s sectors, worked out from each company&apos;s industry — right for about 4 companies in 5.</div>
      </div>
    );
  }
  if (f.kind === 'exch') {
    const all = market === 'US' ? ['NASDAQ', 'NYSE', 'AMEX'] : ['NSE', 'BSE'];
    return (
      <div style={{ ...box, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>Exchange</b>
        {all.map((e) => (
          <label key={e} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={f.ex.includes(e)} onChange={(ev) => onChange({ kind: 'exch', ex: ev.target.checked ? [...f.ex, e] : f.ex.filter((x) => x !== e) })} />{e}
          </label>
        ))}
        {market === 'IN' ? <span style={{ color: C.dim, fontSize: 12 }}>Every company here trades on NSE; BSE = also listed on BSE.</span> : null}
        {done}
      </div>
    );
  }
  if (f.kind === 'date') {
    return (
      <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>{fieldOf(f.key)?.label}</b>
        <select value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as 'thisMonth' | 'pastYears' })} style={{ ...inp, width: 'auto' }}>
          <option value="thisMonth">this calendar month</option><option value="pastYears">within the last … years</option>
        </select>
        {f.op === 'pastYears' ? <input type="number" value={f.v ?? 5} onChange={(e) => onChange({ ...f, v: Number(e.target.value) })} style={inp} /> : null}
        {done}
      </div>
    );
  }
  if (f.kind === 'cmp') {
    const unit = fieldOf(f.key)?.unit;
    return (
      <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {fieldSelect(f.key, (k) => onChange({ ...f, key: k, other: fieldOf(k)?.unit === fieldOf(f.other)?.unit ? f.other : k }))}
        <select value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as CmpOp })} style={inp}>
          <option value="above">above (&gt;)</option><option value="ge">at or above (≥)</option><option value="below">below (&lt;)</option><option value="le">at or below (≤)</option>
        </select>
        {fieldSelect(f.other, (k) => onChange({ ...f, other: k }), unit)}
        {done}
      </div>
    );
  }
  if (f.kind === 'near') {
    return (
      <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {fieldSelect(f.key, (k) => onChange({ ...f, key: k }))}
        <span>is</span>
        <input type="number" value={f.lo} onChange={(e) => onChange({ ...f, lo: Number(e.target.value) })} style={{ ...inp, width: 70 }} />
        <span>to</span>
        <input type="number" value={f.hi} onChange={(e) => onChange({ ...f, hi: Number(e.target.value) })} style={{ ...inp, width: 70 }} />
        <span>% above</span>
        {fieldSelect(f.other, (k) => onChange({ ...f, other: k }), fieldOf(f.key)?.unit)}
        {done}
      </div>
    );
  }
  const d = fieldOf(f.key);
  const unitWord = d?.unit === '%' ? '%' : d?.unit === 'money' ? (market === 'US' ? '$ million' : '₹ crore') : d?.unit === 'x' ? '×' : d?.unit === 'usd' ? '$' : '';
  return (
    <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <b>{d?.label}</b>
      <select value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as NumOp, v2: e.target.value === 'between' ? (f.v2 ?? f.v) : undefined })} style={inp}>
        <option value="gt">greater than</option><option value="ge">at least</option><option value="lt">less than</option><option value="le">at most</option><option value="between">between</option>
      </select>
      <input type="number" value={Number.isFinite(f.v) ? f.v : ''} onChange={(e) => onChange({ ...f, v: Number(e.target.value) })} style={inp} />
      {f.op === 'between' ? <>and <input type="number" value={Number.isFinite(f.v2 as number) ? f.v2 : ''} onChange={(e) => onChange({ ...f, v2: Number(e.target.value) })} style={inp} /></> : null}
      <span style={{ color: C.dim }}>{unitWord}</span>
      {d?.approxNote?.[market] ? <span style={{ color: C.amber, fontSize: 12 }}>≈ {d.approxNote[market]}</span> : null}
      {done}
    </div>
  );
}
