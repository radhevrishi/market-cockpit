'use client';
// zzz938 — STOCK SCREENER page (our own, replaces the TradingView screener). Downloads the day's snapshot once and filters in the
// browser, so every change is instant. Filters are chips like TradingView's: click to change, × to remove, + to add.
// zzz948 — all of the owner's own TradingView screens are built in (grouped USA / India, under their TradingView names), with
// "≥ another field", "within 0–10% above", exchange and date filters, and a note on a filter whose data is still being filled.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { ScreenRow, ScreenMarket } from '@/lib/screener/types';
import {
  FIELDS, BUILT_IN_SCREENS, SCREENS_KEY, cleanScreens, fieldOf, filterCounts, filterKeys, filterLabel, fmtValue, fmtPrice, runScreen,
  evalPattern, tagDirDist, shapeWord, patTagsOf, DEFAULT_PATTERN_RULE, type Filter, type NumKey, type Screen, type FieldGroup, type RowTag,
} from '@/lib/screener/filters';
import { makeHandoff, PINE_HANDOFF_KEY } from '@/lib/screener/pine-handoff';
import { tvSectorOf, tvSectorMapping } from '@/lib/screener/tv-sectors';
import { writeReviewQueue, REVIEW_STATES, readReviewStates, writeReviewState, reviewKey, readViewState, writeViewState, findInResults, type ReviewState } from '@/lib/screener/workflow';
import { pollWhenVisible } from '@/lib/client-fetch';
import { useWorkspaceLight, workspaceThemeClass } from '@/lib/workspace-theme';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';
import { useWatchlistStore } from '@/components/charts/WatchlistPanel';
import { activeList, updateList, addItem, listCount, type WlItem } from '@/lib/chart-watchlist';
import { toCsv } from '@/lib/csv';
import { FilterEditor, readDensity, writeDensity, cellPad, pinnedCell, type Density } from './FilterEditor';
import { scopeItems, scopeCounts, scopeLabel, countsLine, emptyState, confirmAddText, effectiveScope, type ActionScope } from '@/lib/screener/action-scope';
import { PATTERN_META } from '@/lib/chart-patterns';
import { COLUMN_VIEWS, cellText, readColumnView, viewColumns, writeColumnView, type ColumnView } from '@/lib/screener/column-views';
import { SCREENER_CSS, listKeys, usePopover } from './screener-ui';
import ScreenPicker from './ScreenPicker';
import AddFilterPanel from './AddFilterPanel';
import ReviewBadge from './ReviewBadge';
import CompanyDetail from './CompanyDetail';
import {
  explainRow, naReason, closeConfirmed, stableOrder, exact, makeShortlist, cleanShortlists, diffShortlist, formulaImpact, changesSince, membership,
  FORMULA_VERSION, SHORTLISTS_KEY, SCREEN_RUNS_KEY, type Shortlist, type ScreenRun,
} from '@/lib/screener/research';

const C = {
  text: 'var(--mc-text-0)', text1: 'var(--mc-text-1)', dim: 'var(--mc-text-3, #6b7280)', border: 'var(--mc-border-1)',
  bg: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', accent: 'var(--mc-accent)', green: 'var(--mc-bullish, #059669)', red: 'var(--mc-bearish, #DC2626)', amber: 'var(--mc-warn, #D97706)',
};
interface Snap { builtAt: string | null; rows: ScreenRow[]; notes: string[]; sources: string[] }
const LAST_KEY = 'mc:stock-screener:last:v1';   // the screen open last time (this browser only)
const PATCOL_KEY = 'mc:screener-patcol:v1';   // zzz1006: show the chart-pattern column on fundamental views (display preference)

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
const rowKey = (r: ScreenRow) => r.t;
/** zzz994 (MC-01 display) — the latest quote differs from the scan close the averages / patterns were read from (beyond rounding). */
const pxDiffers = (r: ScreenRow) => typeof r.scanPx === 'number' && typeof r.px === 'number' && r.scanPx > 0 && Math.abs(r.px / r.scanPx - 1) * 100 >= 0.15;
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
  // zzz974 — coming back from a chart keeps the sort, the find text and the place on the page (this tab only)
  const [sort, setSortRaw] = useState<{ key: string; dir: 1 | -1 }>(() => readViewState(first.id)?.sort || { key: 'mc', dir: -1 });
  const [findText, setFindText] = useState<string>(() => readViewState(first.id)?.find || '');
  const [reviewFilter, setReviewFilter] = useState<ReviewState | 'all'>('all');
  const [reviewStates, setReviewStates] = useState<Record<string, ReviewState>>(() => readReviewStates());
  const [showAll, setShowAll] = useState(() => !!readViewState(first.id)?.showAll);
  const [msg, setMsg] = useState<string | null>(null);
  const [watchlists, updateWatchlists, watchlistSaveError, retryWatchlistSave] = useWatchlistStore();
  const [addingMatches, setAddingMatches] = useState(false);
  const [targetList, setTargetList] = useState('');
  const [whyTicker, setWhyTicker] = useState('');
  const [shortlists, setShortlists] = useState<Shortlist[]>(() => { try { return cleanShortlists(JSON.parse(localStorage.getItem(SHORTLISTS_KEY) || '[]')); } catch { return []; } });
  const [openSl, setOpenSl] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  // zzz994 (MC-04) — which companies Copy / CSV / Add to watchlist / Save shortlist act on: the searched result (default) or
  // explicitly every filter match; and the table density (shared with the Pine Screener)
  const [actScope, setActScope] = useState<ActionScope>('results');
  const [density, setDensityRaw] = useState<Density>(() => readDensity());
  const setDensity = (d: Density) => { setDensityRaw(d); writeDensity(d); };
  // zzz1006 — presentation only: visible-column preset, optional chart-pattern column, ticked rows, the company side panel
  const [colView, setColViewRaw] = useState<ColumnView>(() => readColumnView());
  const setColView = (v: ColumnView) => { setColViewRaw(v); writeColumnView(v); };
  const [patCol, setPatCol] = useState(() => { try { return localStorage.getItem(PATCOL_KEY) === '1'; } catch { return false; } });
  const togglePatCol = () => setPatCol((v) => { try { localStorage.setItem(PATCOL_KEY, v ? '0' : '1'); } catch { /* display preference only */ } return !v; });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [detailT, setDetailT] = useState<string | null>(null);
  const [addFrom, setAddFrom] = useState<'scope' | 'selected'>('scope');
  const [showCoverage, setShowCoverage] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const { open: topOpen, setOpen: setTopOpen, ref: topRef } = usePopover();
  const { open: actOpen, setOpen: setActOpen, ref: actRef } = usePopover();
  const { open: colOpen, setOpen: setColOpen, ref: colRef } = usePopover();

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
    const vs = readViewState(s.id); setSortRaw(vs?.sort || { key: 'mc', dir: -1 }); setFindText(vs?.find || '');
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
  // zzz974 (N-01) — sectors are worked out again here so a corrected mapping applies before the next snapshot build
  const rawRows = useMemo(() => (snap?.rows || []).map((r) => { const tv = tvSectorOf(market, r.sec, r.ind, r.t); return tv && tv !== r.tvSec ? { ...r, tvSec: tv } : r; }), [snap, market]);
  const intradayRows = useMemo(() => rawRows.filter((r) => r.cc).length, [rawRows]);
  const rows = useMemo(() => (closeOnly ? rawRows.map(closeConfirmed) : rawRows), [rawRows, closeOnly]);
  const valuationDropped = useMemo(() => (closeOnly ? rows.filter((r) => r.ccBasis === 'unavailable').length : 0), [rows, closeOnly]);
  const setSort = (s2: { key: string; dir: 1 | -1 }) => { setSortRaw(s2); writeViewState(screenId, { sort: s2 }); };
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
  const narrowed = useMemo(() => findInResults(ordered.rows, findText).filter((r) => reviewFilter === 'all' || (reviewStates[reviewKey(market, r.t)] || 'unreviewed') === reviewFilter), [ordered.rows, findText, reviewFilter, reviewStates, market]);
  const shown = showAll ? narrowed : narrowed.slice(0, 200);
  // zzz994 (MC-04 / MC-06) — action scope + the counts kept apart (shown / search matches / filter matches)
  const searching = !!findText.trim() || reviewFilter !== 'all';
  const scopeSets = useMemo(() => ({ results: narrowed, all: ordered.rows, selected }), [narrowed, ordered.rows, selected]);
  const sCounts = scopeCounts(scopeSets, shown.length, rowKey);
  const scopeNow = effectiveScope(actScope === 'all' && !searching ? 'results' : actScope, sCounts);
  const actRows = scopeItems(scopeSets, scopeNow, rowKey);
  const actLabel = scopeLabel(scopeNow, sCounts, searching);
  // zzz1006 — the ticked rows (only those still matching the filters, in table order)
  const selRows = scopeItems(scopeSets, 'selected', rowKey);
  const selLabel = scopeLabel('selected', sCounts, searching);
  const [selCtx, setSelCtx] = useState(`${market}|${screenId}`);
  if (selCtx !== `${market}|${screenId}`) { setSelCtx(`${market}|${screenId}`); setSelected(new Set()); setDetailT(null); }   // another screen: a fresh selection
  const empty = snap ? emptyState({ dataRows: rows.length, filterMatches: sorted.length, searchMatches: narrowed.length, searching }) : null;
  const patternFilters = useMemo(() => filters.filter((f): f is Extract<Filter, { kind: 'pattern' }> => f.kind === 'pattern' && !f.off), [filters]);
  // zzz994 (MC-01 display) — rows whose latest quote differs from the scan close the moving averages / patterns were read from
  const patTagsFor = (r: ScreenRow): RowTag[] => {
    const seen = new Map<string, RowTag>();
    for (const f of patternFilters) for (const t of evalPattern(r, f).tags) { const k = `${t.tf || 'D'}:${t.id}`; const o = seen.get(k); if (!o || t.c > o.c) seen.set(k, t); }
    return Array.from(seen.values()).sort((a, b) => b.c - a.c);
  };
  // zzz999 — the chart-pattern column is always there once the data has pattern scans: with a pattern rule it shows the matching
  // patterns; without one, the strongest current pattern on any timeframe (failed readings left out) — the Pine Screener's view.
  const hasPatternData = useMemo(() => rows.some((r) => patTagsOf(r, 'D') != null), [rows]);
  const rowPatterns = (r: ScreenRow): RowTag[] => {
    if (patternFilters.length) return patTagsFor(r);
    const all: RowTag[] = [];
    for (const tf of ['D', 'W', 'M'] as const) for (const t of patTagsOf(r, tf) || []) if (t.s !== 'x') all.push(t.tf ? t : { ...t, tf });
    return all.sort((a, b) => b.c - a.c);
  };
  /** zzz999 — "Open in Pine Screener": the companies the actions apply to go to the Pine Screener as its company list. */
  const openInPine = (e: React.MouseEvent, list: readonly ScreenRow[] = actRows, label = name) => {
    const h = makeHandoff(market, label, list.map((r) => r.t));
    try { if (!h) throw new Error('empty'); sessionStorage.setItem(PINE_HANDOFF_KEY, JSON.stringify(h)); } catch { e.preventDefault(); setMsg('Could not hand the list over: browser storage is blocked.'); }
  };
  const pxVsMa = filters.some((f) => !f.off && (f.kind === 'cmp' || f.kind === 'near') && (f.key === 'px' || f.other === 'px'));
  const pxDiffCount = useMemo(() => (pxVsMa ? sorted.filter(pxDiffers).length : 0), [sorted, pxVsMa]);
  useEffect(() => { writeViewState(screenId, { find: findText }); }, [screenId, findText]);
  // the place on the page: remembered on leaving, restored once when the rows are back
  const scrollRestored = useRef(false);
  useEffect(() => {
    const save = () => writeViewState(screenId, { scrollY: window.scrollY, showAll });
    window.addEventListener('pagehide', save);
    return () => { save(); window.removeEventListener('pagehide', save); };
  }, [screenId, showAll]);
  useEffect(() => {
    if (scrollRestored.current || !sorted.length) return;
    scrollRestored.current = true;
    const y = readViewState(screenId)?.scrollY;
    if (typeof y === 'number' && y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [sorted.length, screenId]);
  const setReview = (t: string, st: ReviewState) => setReviewStates(writeReviewState(market, t, st));
  /** zzz974 — open a chart in "review the screen's results" mode: Next / Previous step through this result, in this order */
  const openForReview = (t: string, exch?: string | null) => {
    writeReviewQueue(name, narrowed.map((r) => ({ symbol: r.t, exchange: market === 'IN' ? (r.exch?.[0] || 'NSE') : (r.exch?.[0] || 'US'), name: r.n })));
    writeViewState(screenId, { scrollY: window.scrollY, showAll });
    const ex = market === 'IN' ? (exch || 'NSE') : (exch || '');
    return `/charts?symbol=${encodeURIComponent(t)}&exchange=${encodeURIComponent(ex)}&t=${encodeURIComponent(t)}&m=${market}&tf=D&review=screener`;
  };
  const addMatches = () => {
    const addRows = addFrom === 'selected' ? selRows : actRows;   // zzz1006: the selection toolbar adds the ticked rows
    if (!watchlists || !addRows.length) return;
    if (targetList && !watchlists.lists.some((l) => l.id === targetList)) { setMsg('Could not add: the selected watchlist no longer exists. Choose a destination.'); return; }
    const target = watchlists.lists.find((l) => l.id === targetList) || activeList(watchlists);
    let next = target;
    for (const r of addRows) {
      const item: WlItem = { m: market, t: r.t, ...(r.exch?.[0] ? { x: r.exch[0] } : {}) };
      next = addItem(next, null, item);
    }
    const added = listCount(next) - listCount(target);
    updateWatchlists((s) => updateList(s, target.id, () => next));
    setMsg(`${added} symbols added to ${target.name}${addRows.length > added ? `; ${addRows.length - added} already present or beyond the list limit` : ''}.`);
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
    if (!actRows.length) return;
    const nm = (window.prompt(`Name for this shortlist — ${actLabel}`, `${name} — ${new Date().toLocaleDateString()}${actRows.length !== sorted.length ? ` (${actRows.length} of ${sorted.length})` : ''}`) || '').trim();
    if (!nm) return;
    const sl = makeShortlist({ name: nm.slice(0, 80), market, screenId, screenName: name, filters, exactOnly, closeOnly, snapshotBuiltAt: snap?.builtAt || null, sort }, actRows, cols as string[]);
    if (writeShortlists([...shortlists, sl].slice(-60))) { setMsg(`Shortlist "${sl.name}" saved (${sl.total} companies${(sl.total ?? 0) > sl.rows.length ? `; figures kept for the first ${sl.rows.length}` : ''})`); setTimeout(() => setMsg(null), 3000); }
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
  const copyTickers = (list: readonly ScreenRow[] = actRows, label = actLabel) => {
    const txt = list.map((r) => (market === 'IN' ? `NSE:${r.t}` : r.t)).join(',');
    navigator.clipboard?.writeText(txt).then(() => { setMsg(`Copied ${list.length} tickers — ${label}`); setTimeout(() => setMsg(null), 2500); }).catch(() => setMsg('Could not copy — the browser refused clipboard access'));
  };
  const downloadCsv = (list: readonly ScreenRow[] = actRows, label = actLabel) => {
    // zzz967 (SC-01) — headers go through the same encoder as cells ("Revenue growth, quarterly YoY" used to split into two
    // columns: 26 header fields over 18 data fields); units in the header; market, snapshot time and ≈ fields on every row.
    const unitOf = (k: string) => {
      const u = fieldOf(k as any)?.unit;
      return u === '%' ? '%' : u === 'x' ? '×' : u === 'money' ? (market === 'US' ? '$ million' : '₹ crore') : u === 'price' ? (market === 'US' ? 'USD' : 'INR') : u === 'usd' ? 'USD' : u === 'shares' ? 'shares' : u === 'date' ? 'date' : '';
    };
    // zzz974 — also the quarter the figures describe, the price basis (live / last close) and the export format version
    // zzz994 — values unrounded; the scan close (what moving averages / patterns were read from) beside the latest quote; any
    // pattern rule's matches with timeframe and shape score; the export scope on every row
    const head = ['Ticker', 'Market', 'Company', 'Sector', 'Sector basis', ...cols.map((k) => { const l = fieldOf(k)?.label || k; const u = unitOf(k); return u ? `${l} (${u})` : l; }),
      ...(patternFilters.length ? ['Matching patterns (timeframe · shape score 0–100)'] : []),
      `Scan close (${market === 'US' ? 'USD' : 'INR'})`, 'Scan close date', 'Quote vs scan close (%)', 'Price sources disagree',
      'Quarter', 'Approximate (≈) fields', 'Price basis', 'Snapshot built (UTC)', 'Formula version', 'Export scope', 'Export format'];
    const built = snap?.builtAt || '';
    const body = list.map((r) => [r.t, market === 'IN' ? 'NSE' : 'US', r.n, r.tvSec || r.sec, tvSectorMapping(market, r.sec, r.ind, r.t).basis, ...cols.map((k) => r[k]),
      ...(patternFilters.length ? [patTagsFor(r).map((t) => `${PATTERN_META[t.id]?.label || t.id} [${t.tf || 'D'}] ${t.c}`).join('; ')] : []),
      r.scanPx ?? '', r.scanAt || '', r.pxGap ?? '', r.pxConflict ? 'yes' : '', r.q || '',
      (r.approx || []).filter((k: string) => cols.includes(k as any)).map((k: string) => fieldOf(k as any)?.label || k).join('; '),
      closeOnly && r.cc ? (r.ccBasis === 'unavailable' ? 'last completed session (valuations dropped: price gap too large)' : 'last completed session') : r.cc ? 'live (read during trading)' : 'last close', built, FORMULA_VERSION, label, 'mc-screener-csv/3']);
    const blob = new Blob(['\uFEFF' + toCsv([head, ...body])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name.replace(/[^\w-]+/g, '_')}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const pick = (key: string) => {
    const add = (f: Filter) => { change([...filters, f]); setEditIdx(filters.length); };
    if (key === 'sector') return add({ kind: 'sector', sectors: [] });
    if (key === 'exch') return add({ kind: 'exch', ex: market === 'US' ? ['NASDAQ', 'NYSE'] : ['NSE'] });
    if (key === 'cmp') return add({ kind: 'cmp', key: 'sma50', op: 'ge', other: 'sma200' });
    if (key === 'near') return add({ kind: 'near', key: 'px', other: 'ema10', lo: 0, hi: 10 });
    if (key === 'pattern') return add({ kind: 'pattern', ...DEFAULT_PATTERN_RULE, tfs: ['D'], stages: ['f', 'b'] });
    const d = fieldOf(key); if (!d) return;
    if (d.unit === 'date') return add({ kind: 'date', key: d.key, op: d.key === 'earnD' ? 'thisMonth' : 'pastYears', v: 5 });
    add({ kind: 'num', key: d.key, op: 'gt', v: 0 });
  };
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
  const isBuiltIn = builtInIds.has(screenId);
  const pausedCount = filters.filter((f) => f.off).length;
  const visibleCols = useMemo(() => viewColumns(colView, filters, market), [colView, filters, market]);
  const showPatCol = (patternFilters.length > 0 || ((colView === 'technicals' || patCol) && hasPatternData));
  const fillingNote = filters.some((f) => filterKeys(f).some((k) => rows.length && !fieldOf(k)?.sparse?.[market] && (known.get(k) || 0) < rows.length * 0.5));
  const detailRow = detailT ? rows.find((r) => r.t === detailT) || null : null;
  const detailIdx = detailRow ? narrowed.findIndex((r) => r.t === detailRow.t) : -1;
  const allShownTicked = shown.length > 0 && shown.every((r) => selected.has(r.t));
  const toggleRow = (t: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const chartHref = (r: ScreenRow) => `/charts?t=${encodeURIComponent(r.t)}&m=${market}&tf=D`;
  const chartClick = (r: ScreenRow) => (e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); window.location.assign(openForReview(r.t, r.exch?.[0])); };
  const intradayLine = intradayRows > 0 ? (closeOnly
    ? `Completed sessions only: ${intradayRows} companies read during trading are shown at the last close${valuationDropped ? ` (valuation figures left unknown for ${valuationDropped}: close and live price too far apart)` : ''}.`
    : `${intradayRows} companies were read during today's session — a cross above an average now may not hold at the close.`) : null;
  const intradayTip = closeOnly
    ? `For companies read during today's trading session, price, change, moving averages, market cap and valuation ratios are worked out at the last CLOSE, not today's live price.${valuationDropped ? ` For ${valuationDropped} the close and live price are too far apart to be one share count (a split or a bad quote), so their valuation figures are left unknown.` : ''}`
    : 'Tick "Close only" to screen on the last completed session instead.';

  return (
    <div className={`mcss ${workspaceThemeClass(light, true)}`} style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, color: C.text, background: 'var(--mc-bg-0)', minHeight: '100%', alignContent: 'start' }}>
      <style>{SCREENER_CSS}</style>
      {/* ── top bar: title · market · screen · Save · ⋯ ─────────────────────────────────────────────────────────── */}
      <div className="mcss-row" style={{ gap: 10 }}>
        <h1 className="mcss-title" style={{ margin: 0 }}>Stock Screener</h1>
        <span className="mcss-seg" role="group" aria-label="Market">
          {(['US', 'IN'] as const).map((m) => <button key={m} type="button" aria-pressed={market === m} onClick={() => { if (m !== market) { setMarket(m); setDirty(true); } }}>{m === 'US' ? '🇺🇸 USA' : '🇮🇳 India'}</button>)}
        </span>
        <ScreenPicker screens={screens} builtInIds={builtInIds} currentId={screenId} currentName={name} currentMarket={market} dirty={dirty} onPick={askSwitch} />
        <button type="button" className={`mcss-btn${dirty ? ' primary' : ''}`} onClick={() => save(false)} title={dirty ? 'Save the filter changes into this screen' : 'Save the filters into this screen'}>Save{dirty ? ' •' : ''}</button>
        <div ref={topRef} style={{ position: 'relative' }}>
          <button type="button" className="mcss-btn" aria-label="More screen options" aria-haspopup="menu" aria-expanded={topOpen} onClick={() => setTopOpen((v) => !v)}>⋯</button>
          {topOpen ? (
            <div className="mcss-pop" role="menu" aria-label="More screen options" style={{ minWidth: 260 }} onKeyDown={(e) => listKeys(e)}>
              <button type="button" role="menuitem" className="mcss-item" onClick={() => { setTopOpen(false); save(true); }}>Save as new…</button>
              <button type="button" role="menuitem" className="mcss-item" onClick={() => { setTopOpen(false); removeSaved(); }} title="Delete a screen you made, or put a built-in screen back to its TradingView setup">{isBuiltIn ? 'Reset to the TradingView setup' : 'Delete this screen'}</button>
              <div className="mcss-sep" />
              <button type="button" role="menuitem" className="mcss-item" onClick={() => { setTopOpen(false); setShowWhy(true); }}>Why is a company in or out?…</button>
              <div className="mcss-sep" />
              <Link href="/pine-screener" role="menuitem" className="mcss-item" title="Chart setups (patterns, stage, distance to the pivot) live in the Pine Screener">Chart setups: Pine Screener</Link>
            </div>
          ) : null}
        </div>
        {msg ? <span role="status" style={{ color: /^(Not saved|Could not)/.test(msg) ? C.red : C.text1, fontSize: 13, fontWeight: 650 }}>{msg}</span> : null}
        <span style={{ flex: 1 }} />
        <WorkspaceThemeToggle light={light} onToggle={toggleLight} />
      </div>
      {note && !dirty ? <div className="mcss-dim" style={{ fontSize: 12.5, marginTop: -4 }}>{note}</div> : null}
      {pendingSwitch ? (
        <div role="dialog" aria-label="Unsaved filters" className="mcss-note mcss-row" style={{ borderColor: C.amber }}>
          <b>&quot;{name}&quot; has unsaved filter changes.</b>
          <button type="button" className="mcss-btn primary sm" onClick={() => { save(false); switchTo(pendingSwitch); }}>Save and switch</button>
          <button type="button" className="mcss-btn sm" onClick={() => switchTo(pendingSwitch)} title="Your changes stay saved as a draft for this screen and come back when you open it again">Keep draft and switch</button>
          <button type="button" className="mcss-btn sm" onClick={() => { writeDraft(screenId, null); switchTo(pendingSwitch); }}>Discard and switch</button>
          <button type="button" className="mcss-btn sm" onClick={() => setPendingSwitch(null)}>Stay</button>
        </div>
      ) : null}
      {draftNote ? <div className="mcss-row" style={{ fontSize: 12.5, color: C.amber }}>✎ {draftNote} <button type="button" className="mcss-btn sm" onClick={() => save(false)}>Save</button> <button type="button" className="mcss-btn sm" onClick={discardDraft}>Discard draft</button></div> : null}
      {impact ? (
        <div className="mcss-note">
          <b>Formulas changed since this screen last ran here</b> — {impact.added.length} entered, {impact.removed.length} left
          {impact.added.length ? <span> · in: {impact.added.slice(0, 12).join(', ')}{impact.added.length > 12 ? '…' : ''}</span> : null}
          {impact.removed.length ? <span> · out: {impact.removed.slice(0, 12).join(', ')}{impact.removed.length > 12 ? '…' : ''}</span> : null}
          <ul style={{ margin: '4px 0 0 16px', color: C.dim }}>{impact.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <span style={{ color: C.dim }}>(price moves and new filings can also change the list — the shortlist panel shows the cause per company)</span>
          <button type="button" className="mcss-btn sm" style={{ marginLeft: 8 }} onClick={() => setImpactSeen(screenId)}>OK</button>
        </div>
      ) : null}

      {/* ── filter chips ───────────────────────────────────────────────────────────────────────────────────────────── */}
      <div className="mcss-row" style={{ gap: 6 }} role="group" aria-label="Filters">
        {filters.map((f, i) => {
          const keys = filterKeys(f);
          const approx = keys.map((k) => fieldOf(k)?.approxNote?.[market]).filter(Boolean).join(' · ');
          const wrongMarket = keys.some((k) => !fieldOf(k)?.markets.includes(market));
          const have = keys.length && rows.length ? Math.min(...keys.map((k) => known.get(k) || 0)) : rows.length;
          const sparse = keys.map((k) => fieldOf(k)?.sparse?.[market]).filter(Boolean).join(' · ');
          const filling = rows.length > 0 && !wrongMarket && !sparse && have < rows.length * 0.5;
          const pass = counts[i] ?? 0;
          const tip = [f.off ? 'Paused — not applied. Click to change or turn back on.' : '', snap ? `${pass.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} companies pass this filter alone` : '', approx ? `Approximate — ${approx}` : '', sparse ? `${have} of ${rows.length} companies have this figure — ${sparse}` : '', wrongMarket ? 'Not available for this market' : '', filling ? `Data still filling: ${have} of ${rows.length} companies have this figure so far (the rest come in the next runs)` : '', 'Click to change'].filter(Boolean).join('\n');
          return (
            <span key={i} className={`mcss-chip${editIdx === i ? ' editing' : ''}${f.off ? ' paused' : ''}`} data-pass={pass}>
              <button type="button" onClick={() => setEditIdx(editIdx === i ? null : i)} title={tip} aria-expanded={editIdx === i}>
                <span className="lab">{filterLabel(f, market)}{approx ? ' ≈' : ''}{wrongMarket ? ' (n/a)' : ''}</span>
                {f.off ? <span className="tag paused">Paused</span> : null}
                {filling ? <span className="tag fill" aria-label="data still filling">⏳</span> : null}
                {sparse ? <span className="tag" style={{ color: C.dim }}>few have it</span> : null}
                {snap && !f.off && pass === 0 ? <span className="tag zero">0 pass</span> : null}
              </button>
              <button type="button" className="ic" aria-label={f.off ? 'Turn this filter back on' : 'Pause this filter'} title={f.off ? 'Turn back on' : 'Pause (keep it, but do not apply it)'} onClick={() => change(filters.map((x, k) => (k === i ? ({ ...x, off: !x.off } as Filter) : x)))}><Icon d={f.off ? PLAY : PAUSE} /></button>
              <button type="button" className="ic" aria-label="Remove filter" title="Remove this filter" onClick={() => { change(filters.filter((_, k) => k !== i)); setEditIdx(null); }}><Icon d={CROSS} /></button>
            </span>
          );
        })}
        <AddFilterPanel market={market} onPick={pick} />
      </div>
      {editIdx != null && filters[editIdx] ? (
        <FilterEditor f={filters[editIdx]} market={market} tvSecCount={tvSecCount} onChange={(nf) => change(filters.map((x, k) => (k === editIdx ? nf : x)))} onClose={() => setEditIdx(null)} />
      ) : null}

      {/* ── data status: one line, details on request ──────────────────────────────────────────────────────────────── */}
      <div className="mcss-status">
        {builtAt ? <span title={`Data built ${builtAt.toLocaleString()}`}>Updated {builtAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{builtAt.toDateString() !== new Date().toDateString() ? `, ${builtAt.toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}</span> : <span aria-busy={!err}>{err ? 'No data' : 'Loading…'}</span>}
        {snap ? <><span className="dot" /><span title={intradayRows ? `${intradayRows} companies were read during today's trading session` : 'Every price is a completed-session close'}>{intradayRows ? (closeOnly ? 'Closing prices' : 'Quotes during session') : 'Last close'}</span></> : null}
        {latestQ ? <><span className="dot" /><span>Figures to {latestQ}</span></> : null}
        {snap ? <><span className="dot" /><button type="button" className="mcss-link" aria-expanded={showCoverage} onClick={() => setShowCoverage((v) => !v)}>Coverage details {showCoverage ? '▴' : '▾'}</button></> : null}
        <span style={{ flex: 1 }} />
        <label title="On: a figure worked out with an assumption (shown with ≈, e.g. EV / revenue with debt taken as 0 because the company files no debt line) does not count as passing a filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: exactOnly ? C.accent : undefined }}>
          <input type="checkbox" checked={exactOnly} onChange={toggleExact} aria-label="Exact figures only" /> Exact figures only
        </label>
        <label title="On: for companies read during today's trading session, price, change and moving averages are taken from the last completed session (a close-confirmed breakout), not the live price" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: closeOnly ? C.accent : undefined }}>
          <input type="checkbox" checked={closeOnly} onChange={toggleClose} aria-label="Completed sessions only" /> Close only
        </label>
        <button type="button" className="mcss-btn sm" disabled={loading} onClick={() => setRefresh((v) => v + 1)}>{loading ? 'Refreshing…' : err ? 'Retry' : 'Refresh'}</button>
      </div>
      {err ? <div role="alert" style={{ color: C.red, fontSize: 13 }}>{err}{snap ? ' — showing the last loaded snapshot' : ''}</div> : null}
      {intradayLine ? <div className="mcss-warn" style={{ color: closeOnly ? C.green : C.amber }} title={intradayTip}>{closeOnly ? '◉' : '◌'} {intradayLine}</div> : null}
      {fillingNote ? <div className="mcss-warn">⏳ marks a figure still being filled in (read a slice at a time) — fewer companies than TradingView can pass it until the reads finish. Hover a filter for how many have it.</div> : null}
      {pausedCount ? <div className="mcss-warn">{pausedCount} filter{pausedCount > 1 ? 's' : ''} paused — not applied to the result.</div> : null}
      {showCoverage && snap ? (
        <div className="mcss-note" style={{ display: 'grid', gap: 4 }}>
          <div>Data built {builtAt ? builtAt.toLocaleString() : 'unknown'}{latestQ ? ` · most figures to ${latestQ}` : ''} · company figures for {withFigures.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')}{withFigures < rows.length && coverageWhy ? ` — ${coverageWhy}` : ''}.</div>
          <div className="mcss-dim">Hover a filter for how many companies pass it alone. A company whose figure is not known fails that filter. ≈ marks a figure worked out in a rougher way. Sectors are TradingView&apos;s 21, worked out from each company&apos;s industry (right for about 4 in 5 companies).</div>
          {snap.sources.length ? <div className="mcss-dim">Sources: {snap.sources.join(' · ')}.</div> : null}
          {snap.notes.length ? <details><summary style={{ cursor: 'pointer' }}>What could not be read ({snap.notes.length})</summary><ul style={{ margin: '4px 0 0 16px' }}>{snap.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details> : null}
        </div>
      ) : null}
      {showWhy ? (
        <div className="mcss-panel" style={{ fontSize: 13 }}>
          <div className="mcss-row">
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Why is a company in or out?
              <input list="mc-screener-tickers" value={whyTicker} onChange={(e) => setWhyTicker(e.target.value)} placeholder="ticker" aria-label="Explain a company" className="mcss-input" style={{ width: 130 }} autoFocus />
            </label>
            <datalist id="mc-screener-tickers">{rows.slice(0, 3000).map((r) => <option key={r.t} value={r.t}>{r.n}</option>)}</datalist>
            {whyTicker && !whyRow ? <span className="mcss-dim">not in this snapshot</span> : null}
            <span style={{ flex: 1 }} />
            <button type="button" className="mcss-btn sm" onClick={() => { setShowWhy(false); setWhyTicker(''); }}>Close</button>
          </div>
          {whyRow ? (
            <div style={{ marginTop: 8 }}>
              <b>{whyRow.t}</b> <span style={{ color: C.dim }}>{whyRow.n}</span> — {whyChecks.every((c) => c.pass) ? <span style={{ color: C.green }}>passes every filter</span> : <span style={{ color: C.red }}>fails {whyChecks.filter((c) => !c.pass).length} of {whyChecks.length}</span>}
              <ul style={{ margin: '6px 0 0 16px' }}>
                {whyChecks.map((c, i) => <li key={i} style={{ color: c.pass ? C.text1 : C.red }}>{c.pass ? '✓' : '✗'} {c.label}: <span style={{ color: c.nearMiss ? C.amber : C.dim }}>{c.detail}</span></li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {addingMatches && watchlists && <div role="dialog" aria-label="Add to watchlist" className="mcss-panel mcss-row">
        <label>Destination <select aria-label="Watchlist for screener matches" value={targetList || activeList(watchlists).id} onChange={(e) => setTargetList(e.target.value)} className="mcss-input">{watchlists.lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({listCount(l)})</option>)}</select></label>
        <span style={{ fontSize: 12.5, color: C.dim }}>{confirmAddText(addFrom === 'selected' ? selRows.length : actRows.length, (watchlists.lists.find((l) => l.id === targetList) || activeList(watchlists)).name, addFrom === 'selected' ? selLabel : actLabel)}</span>
        <button type="button" className="mcss-btn primary sm" onClick={addMatches}>Add symbols</button>
        <button type="button" className="mcss-btn sm" onClick={() => setAddingMatches(false)}>Cancel</button>
      </div>}
      {watchlistSaveError && <div role="alert" style={{ color: C.amber }}>{watchlistSaveError} <button type="button" className="mcss-btn sm" onClick={retryWatchlistSave}>Retry watchlist save</button></div>}

      {openShortlist ? (
        <div className="mcss-panel" style={{ fontSize: 13, display: 'grid', gap: 6 }}>
          <div className="mcss-row" style={{ alignItems: 'baseline' }}>
            <b>Shortlist: {openShortlist.name}</b>
            <span style={{ color: C.dim }}>saved {new Date(openShortlist.savedAt).toLocaleString()} · screen “{openShortlist.screenName}” · data built {openShortlist.snapshotBuiltAt ? new Date(openShortlist.snapshotBuiltAt).toLocaleString() : 'unknown'} · formulas {openShortlist.formulaVersion}{openShortlist.exactOnly ? ' · exact only' : ''}{openShortlist.closeOnly ? ' · completed sessions only' : ''}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="mcss-btn sm" onClick={() => { setFilters(JSON.parse(JSON.stringify(openShortlist.filters))); setMarket(openShortlist.market); setDirty(true); }}>Load its filters</button>
            <button type="button" className="mcss-btn sm" onClick={() => { navigator.clipboard?.writeText(membership(openShortlist).tickers.map((t) => (openShortlist.market === 'IN' ? `NSE:${t}` : t)).join(',')); setMsg('Copied the saved tickers'); }}>Copy saved tickers</button>
            <button type="button" className="mcss-btn sm" onClick={() => { if (window.confirm(`Delete shortlist "${openShortlist.name}"?`)) { writeShortlists(shortlists.filter((x) => x.id !== openShortlist.id)); setOpenSl(null); } }}>Delete</button>
            <button type="button" className="mcss-btn sm" onClick={() => setOpenSl(null)}>Close</button>
          </div>
          {(() => { const m = membership(openShortlist); return (
            <div style={{ color: C.dim }}>Saved result ({m.tickers.length}): {m.tickers.slice(0, 60).join(', ')}{m.tickers.length > 60 ? '…' : ''}
              {!m.complete ? <span style={{ color: C.amber }}> · saved before full lists were kept: only the first {m.tickers.length} were stored, so companies that entered cannot be told apart from ones beyond that cut — entrants are not listed</span> : null}
              {openShortlist.total && openShortlist.total > openShortlist.rows.length ? <span> · figures kept for the first {openShortlist.rows.length}</span> : null}
            </div>
          ); })()}
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

      {empty === 'no-search-match' ? (
        <div role="status" className="mcss-note">
          No filter match contains “{findText}”{reviewFilter !== 'all' ? ` with review state “${REVIEW_STATES.find((x) => x.id === reviewFilter)?.label}”` : ''} — {sorted.length} companies pass the filters.{' '}
          {findText ? <button type="button" className="mcss-btn sm" onClick={() => setFindText('')}>Clear search</button> : null}{' '}
          {reviewFilter !== 'all' ? <button type="button" className="mcss-btn sm" onClick={() => setReviewFilter('all')}>Show every review state</button> : null}
        </div>
      ) : null}

      {/* ── results ────────────────────────────────────────────────────────────────────────────────────────────────── */}
      <div>
        <div className="mcss-toolbar">
          <span className="mcss-count">{snap ? `${result.length} of ${rows.length} companies match` : err ? 'No data' : 'Loading…'}</span>
          {snap ? <span className="mcss-dim" style={{ fontSize: 12.5 }} data-testid="result-counts">{countsLine(sCounts, searching)}</span> : <span aria-busy="true" className="mcss-dim">Loading counts…</span>}
          {searching ? (
            <label className="mcss-dim" style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12.5 }} title="Which companies Copy tickers, Download CSV, Save shortlist and Add matches act on">Actions apply to
              <select value={scopeNow} onChange={(e) => setActScope(e.target.value as ActionScope)} className="mcss-input" style={{ height: 26, fontSize: 12.5 }} aria-label="Action scope">
                <option value="results">{scopeLabel('results', sCounts, searching)}</option>
                <option value="all">{scopeLabel('all', sCounts, searching)}</option>
              </select>
            </label>
          ) : null}
          {ordered.moved ? <button type="button" className="mcss-btn primary sm" onClick={() => setResortTick((v) => v + 1)} title="New data arrived; rows were kept in place so you do not click the wrong one">Re-sort now</button> : null}
          <span style={{ flex: 1 }} />
          <input type="search" value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="Find ticker or name" aria-label="Find in results" className="mcss-input" style={{ width: 170 }} />
          {findText ? <button type="button" className="mcss-btn ghost sm" onClick={() => setFindText('')}>Clear search</button> : null}
          <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value as ReviewState | 'all')} className="mcss-input mcss-hide-sm" aria-label="Show companies by review state" style={{ width: 'auto' }}>
            <option value="all">Review: all</option>
            {REVIEW_STATES.map((x) => <option key={x.id} value={x.id}>{x.label} ({ordered.rows.filter((r) => (reviewStates[reviewKey(market, r.t)] || 'unreviewed') === x.id).length})</option>)}
          </select>
          <div ref={colRef} style={{ position: 'relative' }}>
            <button type="button" className="mcss-btn" aria-haspopup="menu" aria-expanded={colOpen} aria-label={`Columns: ${COLUMN_VIEWS.find((v) => v.id === colView)?.label}`} onClick={() => setColOpen((v) => !v)}>
              Columns: {COLUMN_VIEWS.find((v) => v.id === colView)?.label} <span className="mcss-dim" aria-hidden>▾</span>
            </button>
            {colOpen ? (
              <div className="mcss-pop right" role="menu" aria-label="Column view" style={{ minWidth: 300 }} onKeyDown={(e) => listKeys(e)}>
                <div className="mcss-grp">Visible columns — the filters and the result stay the same</div>
                {COLUMN_VIEWS.map((v) => (
                  <button key={v.id} type="button" role="menuitemradio" aria-checked={colView === v.id} className="mcss-item" title={v.hint} onClick={() => { setColView(v.id); setColOpen(false); }}>
                    <span style={{ width: 14 }}>{colView === v.id ? '✓' : ''}</span>{v.label}<span className="end" style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.hint}</span>
                  </button>
                ))}
                <div className="mcss-sep" />
                <button type="button" role="menuitemcheckbox" aria-checked={patCol} className="mcss-item" disabled={!hasPatternData} onClick={togglePatCol}
                  title="Always shown with a chart-pattern filter or the Technicals view">
                  <span style={{ width: 14 }}>{patCol ? '✓' : ''}</span>Chart-pattern column
                </button>
                <div className="mcss-sep" />
                <div className="mcss-grp">Row density</div>
                <div role="radiogroup" aria-label="Row density" className="mcss-seg sm" style={{ margin: '2px 8px 6px' }}>
                  {(['comfortable', 'compact'] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={density === d} onClick={() => setDensity(d)}>{d === 'comfortable' ? 'Comfortable' : 'Compact'}</button>)}
                </div>
              </div>
            ) : null}
          </div>
          <div ref={actRef} style={{ position: 'relative' }}>
            <button type="button" className="mcss-btn" aria-haspopup="menu" aria-expanded={actOpen} onClick={() => setActOpen((v) => !v)} disabled={!snap}>Actions <span aria-hidden className="mcss-dim">▾</span></button>
            {actOpen ? (
              <div className="mcss-pop right" role="menu" aria-label="Actions" style={{ minWidth: 280 }} onKeyDown={(e) => listKeys(e)}>
                <div className="mcss-grp">Applies to {actLabel.charAt(0).toLowerCase() + actLabel.slice(1)}</div>
                <button type="button" role="menuitem" className="mcss-item" onClick={() => { setActOpen(false); copyTickers(); }} disabled={!actRows.length} title={`Copies ${actLabel}`}>Copy tickers</button>
                <button type="button" role="menuitem" className="mcss-item" onClick={() => { setActOpen(false); downloadCsv(); }} disabled={!actRows.length} title={`Exports ${actLabel}`}>Download CSV</button>
                <button type="button" role="menuitem" className="mcss-item" onClick={() => { setActOpen(false); setAddFrom('scope'); setAddingMatches(true); }} disabled={!actRows.length || !watchlists}>Add matches to watchlist</button>
                {actRows.length ? <a role="menuitem" className="mcss-item" href={`/pine-screener?from=stock&market=${market}`} onClick={openInPine} title={`See which of these charts are setting up: opens the Pine Screener limited to ${actLabel}`}>Open in Pine Screener</a> : null}
                <div className="mcss-sep" />
                <button type="button" role="menuitem" className="mcss-item" onClick={() => { setActOpen(false); saveShortlist(); }} disabled={!actRows.length} title={`Keep this result (${actLabel}): the companies, their figures, the filters and the snapshot time — reopen it later to see what changed`}>Save shortlist</button>
                {shortlists.length ? (<>
                  <div className="mcss-grp">Shortlists · {shortlists.length}</div>
                  {shortlists.slice().reverse().slice(0, 12).map((x) => (
                    <button key={x.id} type="button" role="menuitem" className="mcss-item" onClick={() => { setActOpen(false); setOpenSl(x.id); }}>
                      <span className="mcss-mk">{x.market === 'IN' ? 'IN' : 'US'}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span><span className="end">{x.total ?? membership(x).tickers.length}</span>
                    </button>
                  ))}
                </>) : null}
              </div>
            ) : null}
          </div>
        </div>
        {selected.size ? (
          <div className="mcss-sel" role="toolbar" aria-label="Selected companies">
            <b>{selRows.length} selected</b>
            <span className="mcss-dim" style={{ fontSize: 12 }}>{selRows.length < selected.size ? `(${selected.size - selRows.length} no longer match)` : ''}</span>
            <button type="button" className="mcss-btn primary sm" disabled={!selRows.length || !watchlists} onClick={() => { setAddFrom('selected'); setAddingMatches(true); }}>Add to watchlist</button>
            <button type="button" className="mcss-btn sm" disabled={!selRows.length} onClick={() => copyTickers(selRows, selLabel)}>Copy tickers</button>
            <button type="button" className="mcss-btn sm" disabled={!selRows.length} onClick={() => downloadCsv(selRows, selLabel)}>Export CSV</button>
            {selRows.length ? <a className="mcss-btn sm" href={`/pine-screener?from=stock&market=${market}`} onClick={(e) => openInPine(e, selRows, `${name} (selected)`)}>Open in Pine</a> : null}
            <span style={{ flex: 1 }} />
            <button type="button" className="mcss-btn ghost sm" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        ) : null}
        <div className="mcss-tablewrap" style={selected.size ? { borderTopColor: 'var(--mc-accent)' } : undefined}>
          <table className="mcss-table" style={{ fontSize: density === 'compact' ? 12.5 : 13 }}>
            <thead>
              <tr>
                <th className="pin">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" aria-label={allShownTicked ? 'Clear the selection' : `Select the ${shown.length} rows shown`} checked={allShownTicked} disabled={!shown.length}
                      onChange={() => setSelected(allShownTicked ? new Set() : new Set(shown.map((r) => r.t)))} />
                    <Th bare label="Company" k="t" sort={sort} setSort={setSort} />
                  </span>
                </th>
                <th title="Your review progress for each company (kept in this browser, synced with your other devices)">Review</th>
                <Th label="Sector" k="tvSec" sort={sort} setSort={setSort} />
                {showPatCol ? <th title={patternFilters.length ? 'Patterns matching your pattern rule — timeframe in brackets, shape score 0–100 (not a probability)' : 'The strongest current chart pattern on daily / weekly / monthly bars — the Pine Screener has the full view'}>Chart pattern</th> : null}
                {visibleCols.map((k) => <Th key={k} label={fieldOf(k)?.label || k} k={k} sort={sort} setSort={setSort} num />)}
                <Th label="Quarter" k="q" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const rs = reviewStates[reviewKey(market, r.t)] || 'unreviewed';
                const m = tvSectorMapping(market, r.sec, r.ind, r.t);
                return (
                  <tr key={r.t} className={`${selected.has(r.t) ? 'sel' : ''}${detailT === r.t ? ' open' : ''}`}>
                    <td className="pin" style={{ padding: cellPad(density) }}>
                      <div style={{ display: 'flex', alignItems: density === 'compact' ? 'center' : 'flex-start', gap: 8 }}>
                        <input type="checkbox" aria-label={`Select ${r.t}`} checked={selected.has(r.t)} onChange={() => toggleRow(r.t)} style={{ marginTop: density === 'compact' ? 0 : 3 }} />
                        <span className="mcss-dim" style={{ fontSize: 11.5, minWidth: 18, textAlign: 'right', paddingTop: density === 'compact' ? 0 : 2 }}>{i + 1}</span>
                        <div style={{ minWidth: 0, whiteSpace: density === 'compact' ? 'nowrap' : undefined }}>
                          <Link href={chartHref(r)} onClick={chartClick(r)} className="co" title="Open the chart — Next / Previous on the chart step through these results in this order">{r.t}</Link>
                          <button type="button" data-detail={r.t} className={`mcss-name${density === 'compact' ? ' inline' : ''}`} onClick={() => setDetailT(detailT === r.t ? null : r.t)} aria-expanded={detailT === r.t}
                            title="Show this company's figures, the filter checks and links">{r.n || 'Details'}</button>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: cellPad(density) }}><ReviewBadge ticker={r.t} state={rs} onChange={(st) => setReview(r.t, st)} /></td>
                    <td style={{ padding: cellPad(density), fontSize: 12, color: C.dim, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Source: ${[r.sec, r.ind].filter(Boolean).join(' · ') || 'none'}\nTradingView sector ${m.note}`}>{r.tvSec || r.sec || '—'}{m.basis === 'sector' ? ' ≈' : m.basis === 'checked' ? ' ✓' : ''}</td>
                    {showPatCol ? (
                      <td style={{ padding: cellPad(density) }}>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 300 }}>
                          {rowPatterns(r).slice(0, patternFilters.length ? 4 : 1).map((t) => { const col = t.b === 'U' ? C.green : C.red; const d = tagDirDist(t); return (
                            <span key={`${t.tf}-${t.id}`} title={`${PATTERN_META[t.id]?.label} — ${t.tf === 'W' ? 'weekly' : t.tf === 'M' ? 'monthly' : 'daily'} bars, ${t.s === 'f' ? 'forming' : t.s === 'b' ? 'breakout' : 'failed'}, shape score ${t.c}/100 (${shapeWord(t.c)})${d != null ? `, ${d > 0 ? '+' : ''}${Math.round(d * 10) / 10}% to pivot (from the scan close)` : ''}`}
                              style={{ padding: '1px 6px', borderRadius: 999, border: `1px solid ${col}`, color: col, fontSize: 11, fontWeight: 650, whiteSpace: 'nowrap' }}>{t.b === 'U' ? '▲' : '▼'} {PATTERN_META[t.id]?.label} <span style={{ opacity: 0.75 }}>{t.tf || 'D'} · {t.c}</span></span>
                          ); })}
                        </div>
                      </td>
                    ) : null}
                    {visibleCols.map((k) => {
                      const d = fieldOf(k); const v = r[k] as number | null;
                      const ax = r.approx?.includes(k);
                      const col = k === 'chg' && typeof v === 'number' ? (v >= 0 ? C.green : C.red) : C.text;
                      const na = naReason(r, k);
                      const tip = [typeof v === 'number' ? `Exact value: ${exact(v)} (filters compare this, not the rounded figure)` : na ? `Not applicable: ${na}` : 'Not known', ax ? 'Approximate for this company' : '', na && typeof v === 'number' ? 'Not meaningful for financial companies' : ''].filter(Boolean).join('\n');
                      // zzz994 (MC-01 display) — the latest quote next to the scan close the averages / patterns were read from
                      const scanNote = k === 'px' && pxDiffers(r) ? `\nScan close ${fmtPrice(r.scanPx, market)}${r.scanAt ? ` (${r.scanAt}` : ' ('}${r.scanSrc ? `, ${r.scanSrc}` : ''}) — moving averages, RSI and patterns use it; quote ${r.pxSrc ? `from ${r.pxSrc}` : ''}${typeof r.pxGap === 'number' ? `, ${r.pxGap > 0 ? '+' : ''}${r.pxGap}% vs scan close` : ''}${r.pxConflict ? '\n⚠ The two sources disagree on the same day — neither is certified as the exchange close' : ''}` : '';
                      return <td key={k} className="num" style={{ padding: cellPad(density), color: col, whiteSpace: 'nowrap' }} title={tip + scanNote}>{k === 'px' && r.pxConflict ? <span style={{ color: C.amber }} aria-label="Price sources disagree">⚠ </span> : null}{ax ? '≈' : ''}{v == null && na ? <span style={{ color: C.dim, fontStyle: 'italic' }}>n/a</span> : cellText(v, d?.unit || 'num', market, k)}{scanNote ? <span style={{ color: C.amber }}>†</span> : null}{k === 'px' && scanNote && density !== 'compact' ? <div style={{ fontSize: 11, color: C.dim }}>scan {fmtPrice(r.scanPx, market)}</div> : null}</td>;
                    })}
                    <td style={{ padding: cellPad(density), fontSize: 12, color: C.dim, whiteSpace: 'nowrap' }}>{r.q || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {narrowed.length > 200 ? (
            <div style={{ padding: 8, textAlign: 'center' }}><button type="button" className="mcss-btn sm" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show the first 200' : `Show all ${narrowed.length}`}</button></div>
          ) : null}
          {empty === 'no-data' ? <div role="status" style={{ padding: 14, color: C.dim, fontSize: 13 }}>{snap?.notes[0] || 'No data yet — the first build of this market has not finished.'}</div> : null}
          {empty === 'no-filter-match' ? <div role="status" style={{ padding: 14, color: C.dim, fontSize: 13 }}>No company passes every filter. A filter marked “0 pass” is the tight one; hover any filter for how many companies pass it alone.{patternFilters.length ? ' A pattern rule only passes companies whose selected timeframe has been scanned.' : ''}</div> : null}
          {empty === 'no-search-match' ? <div style={{ padding: 14, color: C.dim, fontSize: 13 }}>No match for the search — see above.</div> : null}
        </div>
        {pxDiffCount ? <div className="mcss-warn" style={{ marginTop: 6 }} title="Moving averages, RSI and patterns are worked out from the daily bars (scan close); the Price column is the latest quote, which can come from another source. Price-vs-average rules compare the quote.">† {pxDiffCount} matches: latest quote differs from the scan close the averages were read from</div> : null}
      </div>
      {detailRow ? (
        <CompanyDetail row={detailRow} market={market} filters={filters} exactOnly={exactOnly} review={reviewStates[reviewKey(market, detailRow.t)] || 'unreviewed'} onReview={(st) => setReview(detailRow.t, st)}
          chartHref={chartHref(detailRow)} onChart={chartClick(detailRow)} onPine={(e) => openInPine(e, [detailRow], `${name}: ${detailRow.t}`)}
          onClose={() => { const t = detailRow.t; setDetailT(null); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-detail="${CSS.escape(t)}"]`)?.focus({ preventScroll: true })); }}
          position={detailIdx >= 0 ? `${detailIdx + 1} of ${narrowed.length}` : 'not in the result'} />
      ) : null}
    </div>
  );
}

const PAUSE = 'M4 3h2.5v10H4zM9.5 3H12v10H9.5z', PLAY = 'M5 3l8 5-8 5z', CROSS = 'M4.2 3.1 8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z';
function Icon({ d }: { d: string }) { return <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden fill="currentColor"><path d={d} /></svg>; }
function Th({ label, k, sort, setSort, num, bare }: { label: string; k: string; sort: { key: string; dir: 1 | -1 }; setSort: (s: { key: string; dir: 1 | -1 }) => void; num?: boolean; bare?: boolean }) {
  const on = sort.key === k;
  const b = (
    <button type="button" onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : num ? -1 : 1 })} style={{ all: 'unset', cursor: 'pointer', color: on ? 'var(--mc-accent)' : undefined }}>
      {label}{on ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
    </button>
  );
  return bare ? b : <th className={num ? 'num' : undefined} aria-sort={on ? (sort.dir === -1 ? 'descending' : 'ascending') : undefined}>{b}</th>;
}
