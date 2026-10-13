'use client';
// zzz983 — PINE SCREENER page: our own pattern & rule screener (a TypeScript pattern engine — it does not run Pine Script). Every
// company whose chart shows one of the 22 chart patterns right now (bullish bases, flags, triangles, bottoms; bearish tops, flags,
// wedges), combined with rules on the screener's figures. The patterns are read once a day by the stock screener's build from the
// same daily bars as its price figures (lib/screener/pine.ts); this page downloads the companies and filters in the browser, so
// every change is instant. Built-in screens are data (lib/screener/pine-presets.ts); the owner's own screens are kept in
// 'mc:pine-screens:v1' (synced to his database by the vault).
// zzz994 — explicit stages (MC-03), one action scope for Copy / CSV / watchlist / chart review with row selection (MC-04/06), shape
// score instead of "likelihood" (MC-05), strict results with a separate provisional preview (MC-07), price precision (MC-08), scan
// close beside the latest quote (MC-01 display), D / W / M analysis timeframes, an "Add rule" editor, a collapsible catalogue.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ScreenMarket, ScreenRow } from '@/lib/screener/types';
import { PATTERN_META, PATTERN_IDS, type PatternId } from '@/lib/chart-patterns';
import {
  DEFAULT_QUERY, LIKELIHOODS, OPTIONAL_COLS, PINE_GROUPS, PINE_SCREENS_KEY, STAGES, TIMEFRAMES, SHAPE_SCORE_LABEL, SHAPE_SCORE_TIP, cleanPineScreens, cleanQuery, dirDist,
  likelihoodWord, patternCounts, patternGroups, runPineFull, turnoverOf, onList, ruleCoverage, pineRuleFields,
  type PerfKey, type PineHit, type PineQuery, type PineScreen, type PineStage, type ScreenPatternTag,
} from '@/lib/screener/pine';
import { BUILT_IN_PINE_SCREENS } from '@/lib/screener/pine-presets';
import { fmtValue, fmtPrice, fmtMoney, fmtExact, filterLabel, fieldOf, patTagsOf, patMissingWhy, type Filter, type NumKey, type PatTf } from '@/lib/screener/filters';
import { TV_SECTORS } from '@/lib/screener/tv-sectors';
import { writeReviewQueue } from '@/lib/screener/workflow';
import { scopeItems, scopeCounts, scopeLabel, countsLine, emptyState, confirmAddText, effectiveScope, type ActionScope } from '@/lib/screener/action-scope';
import { pollWhenVisible } from '@/lib/client-fetch';
import { useWorkspaceLight, workspaceThemeClass } from '@/lib/workspace-theme';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';
import { FilterEditor, readDensity, writeDensity, cellPad, pinnedCell, type Density } from '@/components/stock-screener/FilterEditor';
import { useWatchlistStore } from '@/components/charts/WatchlistPanel';
import { activeList, updateList, addItem, removeItem, findItem, itemKey, listCount, type WlItem } from '@/lib/chart-watchlist';
import { getConvictionTickers } from '@/lib/conviction-beats';
import { toCsv } from '@/lib/csv';

const C = {
  text: 'var(--mc-text-0)', text1: 'var(--mc-text-1)', dim: 'var(--mc-text-3, #6b7280)', border: 'var(--mc-border-1)',
  bg: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', accent: 'var(--mc-accent)', green: 'var(--mc-bullish, #059669)', red: 'var(--mc-bearish, #DC2626)', amber: 'var(--mc-warn, #D97706)',
};
type Row = ScreenRow & { live?: 1 };
interface Snap { builtAt: string | null; rows: Row[]; total: number; scanned: number; withPattern: number; patAt: string | null; notes: string[]; building: boolean; stale: number; insufficient: number; pxConflicts: number }
const SCOPE_KEY = 'mc:pine-screener:scope:v1';   // zzz989 — which list the results are limited to (this browser only)
const LAST_KEY = 'mc:pine-screener:last:v1';   // the screen + unsaved choices open last time (this browser only)
const PANEL_KEY = 'mc:pine-screener:panel:v1';   // zzz994 — the catalogue / advanced-filter panel open or closed (open the first time)
type Last = { id: string; market: ScreenMarket; q: PineQuery; dirty: boolean };

function readSaved(): PineScreen[] { try { return cleanPineScreens(JSON.parse(localStorage.getItem(PINE_SCREENS_KEY) || '[]')); } catch { return []; } }
function writeSaved(list: PineScreen[]): boolean { try { localStorage.setItem(PINE_SCREENS_KEY, JSON.stringify(list.map(({ builtIn: _b, ...s }) => s))); return true; } catch { return false; } }
function readLast(): Last | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    return v && typeof v.id === 'string' ? { id: v.id, market: v.market === 'IN' ? 'IN' : 'US', q: cleanQuery(v.q), dirty: !!v.dirty } : null;
  } catch { return null; }
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const STAGE_GLYPH = (t: ScreenPatternTag) => (t.s === 'f' ? '◌' : t.s === 'b' ? (t.b === 'U' ? '▲' : '▼') : '✕');
const stageWord = (t: ScreenPatternTag) => (t.s === 'f' ? 'forming' : t.s === 'b' ? (t.b === 'U' ? 'broke out' : 'broke down') : (t.b === 'U' ? 'breakout failed' : 'breakdown failed'));
const tfWord = (tf?: string) => (tf === 'W' ? 'weekly' : tf === 'M' ? 'monthly' : 'daily');
const keyOf = (h: PineHit) => h.row.t;
const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
const PERF_LABEL: Record<PerfKey, string> = { perf1M: '1M', perf3M: '3M', perf6M: '6M', perf1Y: '1Y' };
/** zzz984 — short headers for the optional columns (the full label is the header's tooltip). */
const COL_SHORT: Partial<Record<NumKey, string>> = {
  tt: 'TT rules', ttOk: 'TT all 6', rsR: 'RS Rating', stage: 'Stage', st12: 'Stage 1→2', r40: 'Rule of 40', revQYoY: 'Rev Q YoY', fcfmTTM: 'FCF margin',
  rsiMA: 'RSI avg', rsiX: 'RSI × avg (d)', gcD: 'Golden × (d)', dcD: 'Death × (d)', emaXU: 'EMA10×21 up (d)', emaXD: 'EMA10×21 dn (d)', ppD: 'Pocket pivot (d)',
  rvol: 'RVol', 'adv$': 'Avg value', adrP: 'ADR %', ripB: 'Ripster', perf1M: 'Perf 1M', perf6M: 'Perf 6M', perf1Y: 'Perf 1Y',
  twSt: 'TW stage', sata: 'SATA', mrs: 'Mansfield RS', twWk: 'Weeks in stage',   // zzz987 — Stage Analysis (TheWrap method)
};
const YES_NO = new Set<string>(['ttOk', 'st12', 'ripB']);
function fmtCol(k: NumKey, v: number | null | undefined, market: ScreenMarket): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (YES_NO.has(k)) return v >= 1 ? 'yes' : 'no';
  if (k === 'tt') return `${v}/6`;
  if (k === 'sata') return `${v}/10`;
  if (k === 'mrs') return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  if (k === 'rvol') return `${v.toFixed(2)}×`;
  const d = fieldOf(k);
  if (d?.unit === '%') return pct(v);
  return fmtValue(v, d?.unit || 'num', market);
}
/** zzz995 — the API sends the current scan version / engine / price basis once (not on every row): put them back on each row. */
function withHoisted(rows: Row[], j: { scanV?: number; engine?: string; scanBasis?: string }): Row[] {
  const fill = (m: any) => (m && m.v == null && m.st !== 'stale-version' ? { ...m, v: j.scanV, e: j.engine } : m);
  return rows.map((r: any) => ({ ...r, ...(r.scan ? { scan: fill(r.scan) } : {}), ...(r.scanW ? { scanW: fill(r.scanW) } : {}), ...(r.scanM ? { scanM: fill(r.scanM) } : {}), ...(!r.scanBasis && j.scanBasis && r.scanPx != null ? { scanBasis: j.scanBasis } : {}) }));
}
/** zzz994 (MC-01 display) — the latest quote differs from the close the patterns were read from (beyond rounding). */
const pxDiffers = (r: Row) => typeof r.scanPx === 'number' && typeof r.px === 'number' && r.scanPx > 0 && Math.abs(r.px / r.scanPx - 1) * 100 >= 0.15;
const scanTip = (r: Row, market: ScreenMarket) => [
  `Scan close ${fmtPrice(r.scanPx, market)}${r.scanAt ? ` on ${r.scanAt}` : ''}${r.scanSrc ? ` (${r.scanSrc}${r.scanBasis ? `, ${r.scanBasis}` : ''})` : ''} — patterns, pivots, stages and "To pivot" use this close`,
  `Latest quote ${fmtPrice(r.px, market)}${r.pxSrc ? ` (${r.pxSrc}${r.pxAt ? `, ${r.pxAt}` : ''})` : ''}${typeof r.pxGap === 'number' ? ` — ${r.pxGap > 0 ? '+' : ''}${r.pxGap}% vs the scan close` : ''}`,
  typeof r.pxAlt === 'number' ? `Nasdaq's list still showed ${fmtPrice(r.pxAlt, market)} (the previous session's close), so the last daily bar's close is used` : '',
  r.pxConflict ? '⚠ The two sources disagree on the same day; neither is certified as the exchange close' : '',
].filter(Boolean).join('\n');

export default function PineScreener() {
  const [light, toggleLight] = useWorkspaceLight();
  const [saved, setSaved] = useState<PineScreen[]>(() => readSaved());
  const screens = useMemo(() => {
    const m = new Map<string, PineScreen>();
    for (const s of BUILT_IN_PINE_SCREENS) m.set(s.id, s);
    for (const s of saved) m.set(s.id, s);
    return Array.from(m.values());
  }, [saved]);
  const builtInIds = useMemo(() => new Set(BUILT_IN_PINE_SCREENS.map((s) => s.id)), []);
  const [first] = useState(() => {
    const last = readLast();
    const all = [...BUILT_IN_PINE_SCREENS, ...readSaved()];
    const s = all.find((x) => x.id === last?.id) || BUILT_IN_PINE_SCREENS[0];
    return { s, market: last?.market || s.market || 'US', q: last?.dirty && last.id === s.id ? last.q : cleanQuery(clone(s.q)), dirty: !!(last?.dirty && last.id === s.id) };
  });
  const [screenId, setScreenId] = useState(first.s.id);
  const [name, setName] = useState(first.s.name);
  const [market, setMarket] = useState<ScreenMarket>(first.market);
  const [q, setQ] = useState<PineQuery>(first.q);
  const [dirty, setDirty] = useState(first.dirty);
  const [snaps, setSnaps] = useState<Partial<Record<ScreenMarket, Snap>>>({});
  const [errors, setErrors] = useState<Partial<Record<ScreenMarket, string | null>>>({});
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'conf', dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [findText, setFindText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [watchlists, updateWatchlists, watchlistSaveError, retryWatchlistSave] = useWatchlistStore();
  const [adding, setAdding] = useState(false);
  const [targetList, setTargetList] = useState('');
  const [showMore, setShowMore] = useState(false);
  // zzz994 — action scope + row selection, density, the collapsible catalogue, pattern search, rule editor
  const [actScope, setActScope] = useState<ActionScope>('results');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [density, setDensityRaw] = useState<Density>(() => readDensity());
  const setDensity = (d: Density) => { setDensityRaw(d); writeDensity(d); };
  const [panelOpen, setPanelOpenRaw] = useState<boolean>(() => { try { return localStorage.getItem(PANEL_KEY) !== '0'; } catch { return true; } });
  const setPanelOpen = (v: boolean) => { setPanelOpenRaw(v); try { localStorage.setItem(PANEL_KEY, v ? '1' : '0'); } catch { /* a convenience */ } };
  const [patFind, setPatFind] = useState('');
  const [ruleEdit, setRuleEdit] = useState<number | null>(null);
  // zzz989 — watchlist link: '' = every company, 'wl:<id>' = one of my watchlists, 'cb' = the Conviction Beats bench
  const [scope, setScope] = useState<string>(() => { try { return localStorage.getItem(SCOPE_KEY) || ''; } catch { return ''; } });
  useEffect(() => { try { localStorage.setItem(SCOPE_KEY, scope); } catch { /* a convenience */ } }, [scope]);
  const [cbTick, setCbTick] = useState(0);
  useEffect(() => {
    const bump = () => setCbTick((v) => v + 1);
    window.addEventListener('conviction-beats:updated', bump); window.addEventListener('storage', bump);
    return () => { window.removeEventListener('conviction-beats:updated', bump); window.removeEventListener('storage', bump); };
  }, []);
  const note = screens.find((s) => s.id === screenId)?.note;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2800); };

  useEffect(() => { try { localStorage.setItem(LAST_KEY, JSON.stringify({ id: screenId, market, q, dirty })); } catch { /* a convenience */ } }, [screenId, market, q, dirty]);
  useEffect(() => {
    const reload = () => setSaved(readSaved());
    const storage = (e: StorageEvent) => { if (e.key === PINE_SCREENS_KEY || e.key === null) reload(); };
    const restored = (e: Event) => { const keys = (e as CustomEvent).detail?.keys; if (!Array.isArray(keys) || keys.includes(PINE_SCREENS_KEY)) reload(); };
    window.addEventListener('storage', storage); window.addEventListener('mc:vault:restored', restored);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('mc:vault:restored', restored); };
  }, []);

  useEffect(() => {
    let stopped = false, empty = false;
    let ctrl: AbortController | null = null;
    const load = () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      setLoading(true);
      fetch(`/api/v1/pine-screener?market=${market}`, { cache: 'no-store', signal })
        .then(async (r) => { const j = await r.json(); if (!r.ok || !j?.ok || !Array.isArray(j.rows)) throw new Error(j?.error || 'Could not load the pattern data'); return j; })
        .then((j) => {
          if (stopped || signal.aborted) return;
          empty = !j.rows.length || !j.scanned || !!j.building;
          setErrors((p) => ({ ...p, [market]: null }));
          setSnaps((p) => ({ ...p, [market]: {
            builtAt: j.builtAt, rows: withHoisted(j.rows, j), total: j.total || 0, scanned: j.scanned || 0, withPattern: j.withPattern || 0, patAt: j.patAt || null, notes: Array.isArray(j.notes) ? j.notes : [],
            building: !!j.building, stale: j.stale || 0, insufficient: j.insufficient || 0, pxConflicts: j.pxConflicts || 0,
          } }));
        })
        .catch((e) => { if (!stopped && !signal.aborted) setErrors((p) => ({ ...p, [market]: e?.message || 'Could not load the pattern data' })); })
        .finally(() => { if (!stopped && !signal.aborted) setLoading(false); });
    };
    const stop = pollWhenVisible(load, () => (empty ? 60_000 : 300_000), { runImmediately: true });
    return () => { stopped = true; stop(); ctrl?.abort(); };
  }, [market, refresh]);

  const snap = snaps[market];
  const err = errors[market] || null;
  const rows = useMemo(() => snap?.rows || [], [snap]);
  const listTickers = useMemo<Set<string> | null>(() => {
    void cbTick;
    if (!scope) return null;
    if (scope === 'cb') { try { return new Set(Array.from(getConvictionTickers()).map((t) => String(t).toUpperCase())); } catch { return new Set(); } }
    const l = watchlists?.lists.find((x) => `wl:${x.id}` === scope);
    if (!l) return null;
    const s = new Set<string>();
    for (const sec of l.sections) for (const it of sec.items) if (it.m === market) s.add(it.t.toUpperCase());
    return s;
  }, [scope, watchlists, market, cbTick]);
  const scopeName = scope === 'cb' ? 'Conviction Beats' : watchlists?.lists.find((x) => `wl:${x.id}` === scope)?.name || '';
  // zzz994 (MC-07) — STRICT results (every rule evaluated and passed) + a separate provisional preview (a rule could not be
  // evaluated for that company: a figure missing, or a selected timeframe not scanned). Bulk actions use strict unless the
  // owner picks the provisional scope explicitly.
  const run = useMemo(() => runPineFull(rows, q, market), [rows, q, market]);
  const hits = useMemo(() => onList(run.strict, listTickers), [run, listTickers]);
  const provHits = useMemo(() => onList(run.provisional, listTickers), [run, listTickers]);
  const coverage = useMemo(() => ruleCoverage(rows, q.filters, market), [rows, q.filters, market]);
  const counts = useMemo(() => patternCounts(listTickers ? rows.filter((r) => listTickers.has(r.t.toUpperCase())) : rows, q, market), [rows, q, market, listTickers]);
  // which analysis timeframes have been scanned at all in this market (W / M fill in once the weekly / monthly scan runs)
  const tfScanned = useMemo<Record<PatTf, boolean>>(() => ({
    D: rows.some((r) => patTagsOf(r, 'D') != null), W: rows.some((r) => patTagsOf(r, 'W') != null), M: rows.some((r) => patTagsOf(r, 'M') != null),
  }), [rows]);
  // the ★ on each row: on / off in the chosen watchlist (or the active one when the results are not limited to a watchlist)
  const starList = watchlists ? (watchlists.lists.find((x) => `wl:${x.id}` === scope) || watchlists.lists.find((x) => x.id === targetList) || activeList(watchlists)) : null;
  const starKey = (r: Row) => itemKey({ m: market, t: r.t, ...(r.exch?.[0] ? { x: r.exch[0] } : {}) });
  const onStar = (r: Row): boolean => !!starList && !!(findItem(starList, starKey(r)) || findItem(starList, `${market}:${r.t}`));
  const toggleStar = (r: Row) => {
    if (!starList) return;
    const key = findItem(starList, starKey(r)) ? starKey(r) : findItem(starList, `${market}:${r.t}`) ? `${market}:${r.t}` : null;
    if (key) { updateWatchlists((s) => updateList(s, starList.id, (l) => removeItem(l, key))); flash(`${r.t} removed from ${starList.name}`); return; }
    const before = listCount(starList);
    const next = addItem(starList, null, { m: market, t: r.t, ...(r.exch?.[0] ? { x: r.exch[0] } : {}) });
    if (listCount(next) === before) { flash(`Could not add ${r.t}: ${starList.name} is full (1,000)`); return; }
    updateWatchlists((s) => updateList(s, starList.id, () => next));
    flash(`${r.t} added to ${starList.name}`);
  };
  const groups = useMemo(() => patternGroups(q.bias), [q.bias]);
  const sortHits = useCallback((list: PineHit[]) => {
    const val = (h: PineHit): number | string | null => {
      const r = h.row, b = h.best;
      switch (sort.key) {
        case 'conf': return b ? b.c + (b.s === 'b' ? 0.5 : 0) : null;
        case 'dist': return b ? dirDist(b) : null;
        case 'len': return b?.l ?? null;
        case 'pivot': return b?.p ?? null;
        case 'pattern': return b ? PATTERN_META[b.id].label : null;
        case 't': return r.t;
        case 'tvSec': return r.tvSec || r.sec || '';
        case 'turn': return turnoverOf(r, market);
        default: { const v = (r as any)[sort.key]; return typeof v === 'number' ? v : null; }
      }
    };
    return list.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      if (typeof x === 'string' || typeof y === 'string') return String(x ?? '').localeCompare(String(y ?? '')) * sort.dir;
      if (x == null && y == null) return a.row.t.localeCompare(b.row.t);
      if (x == null) return 1;   // missing figures last, whichever way the column is sorted
      if (y == null) return -1;
      return ((x as number) - (y as number)) * sort.dir || a.row.t.localeCompare(b.row.t);
    });
  }, [sort, market]);
  const sorted = useMemo(() => sortHits(hits), [hits, sortHits]);
  const narrowed = useMemo(() => {
    const s = findText.trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');
    return s ? sorted.filter((h) => h.row.t.toUpperCase().includes(s) || String(h.row.n || '').toUpperCase().includes(s)) : sorted;
  }, [sorted, findText]);
  const shown = showAll ? narrowed : narrowed.slice(0, 200);
  const searching = !!findText.trim();
  // zzz994 (MC-04 / MC-06) — one action scope for Copy / CSV / watchlist / chart review, with every count kept apart
  const scopeSets = useMemo(() => ({ results: narrowed, all: sorted, selected, provisional: sortHits(provHits) }), [narrowed, sorted, selected, provHits, sortHits]);
  const sCounts = scopeCounts(scopeSets, shown.length, keyOf);
  const scopeNow = effectiveScope(actScope === 'all' && !searching ? 'results' : actScope, sCounts);
  const actHits = scopeItems(scopeSets, scopeNow, keyOf);
  const actLabel = scopeLabel(scopeNow, sCounts, searching);
  const empty = snap ? emptyState({ dataRows: rows.length, filterMatches: sorted.length, searchMatches: narrowed.length, searching }) : null;
  const showScanCol = useMemo(() => shown.some((h) => pxDiffers(h.row)), [shown]);

  // ── changing the query / screens ────────────────────────────────────────────────────────────────────────────────────
  const change = (patch: Partial<PineQuery>) => { setQ((p) => ({ ...p, ...patch })); setDirty(true); setShowAll(false); };
  const loadScreen = useCallback((id: string) => {
    const s = screens.find((x) => x.id === id);
    if (!s) return;
    if (dirty && !window.confirm(`Discard the unsaved changes to "${name}"?`)) return;
    setScreenId(s.id); setName(s.name); setQ(cleanQuery(clone(s.q))); setDirty(false); setShowAll(false); setSelected(new Set()); setRuleEdit(null);
    if (s.market) setMarket(s.market);
  }, [screens, dirty, name]);
  const save = (asNew: boolean) => {
    const isBuiltIn = builtInIds.has(screenId);
    const id = asNew ? `my-${Date.now().toString(36)}` : screenId;
    const nm = asNew ? (window.prompt('Name for this Pine screen', `${name}${isBuiltIn ? '' : ' (copy)'}`) || '').trim() : name;
    if (!nm) return;
    const s: PineScreen = { id, name: nm.slice(0, 80), q, ...(asNew ? { market } : screens.find((x) => x.id === id)?.market ? { market: screens.find((x) => x.id === id)!.market } : {}) };
    const list = [...readSaved().filter((x) => x.id !== id), s];
    if (!writeSaved(list)) { flash('Not saved: storage is full or blocked.'); return; }
    setSaved(list); setScreenId(id); setName(s.name); setDirty(false);
    flash(`Saved "${s.name}"`);
  };
  const removeSaved = () => {
    const isBuiltIn = builtInIds.has(screenId);
    if (!window.confirm(isBuiltIn ? 'Put this screen back to its built-in setup?' : `Delete "${name}"?`)) return;
    const list = readSaved().filter((x) => x.id !== screenId);
    if (!writeSaved(list)) { flash('Could not save: storage is full or blocked.'); return; }
    setSaved(list);
    const s = isBuiltIn ? BUILT_IN_PINE_SCREENS.find((x) => x.id === screenId)! : BUILT_IN_PINE_SCREENS[0];
    setScreenId(s.id); setName(s.name); setQ(cleanQuery(clone(s.q))); setDirty(false);
  };
  const setBias = (bias: PineQuery['bias']) => change({ bias, ids: q.ids.filter((id) => bias === 'both' || (PATTERN_META[id].bias === 'bullish') === (bias === 'U')) });
  const toggleId = (id: PatternId) => change({ ids: q.ids.includes(id) ? q.ids.filter((x) => x !== id) : [...q.ids, id] });
  const toggleStage = (s: PineStage) => change({ stages: q.stages.includes(s) ? q.stages.filter((x) => x !== s) : [...q.stages, s] });
  const allStages = STAGES.every((s) => q.stages.includes(s.id));
  const toggleTf = (tf: PatTf) => { const next = q.tfs.includes(tf) ? q.tfs.filter((x) => x !== tf) : [...q.tfs, tf]; if (next.length) change({ tfs: next }); };
  const ofBias = PATTERN_IDS.filter((id) => q.bias === 'both' || (PATTERN_META[id].bias === 'bullish') === (q.bias === 'U'));
  const patMatchesFind = (id: PatternId) => !patFind.trim() || PATTERN_META[id].label.toLowerCase().includes(patFind.trim().toLowerCase());
  const ruleFields = useMemo(() => pineRuleFields(market), [market]);
  const addRule = (v: string) => {
    let f: Filter | null = null;
    if (v === '__cmp') f = { kind: 'cmp', key: 'sma50', op: 'ge', other: 'sma200' };
    else { const d = ruleFields.find((x) => x.key === v); if (d) f = d.unit === 'date' ? { kind: 'date', key: d.key, op: 'pastYears', v: 5 } : { kind: 'num', key: d.key, op: 'gt', v: 0 }; }
    if (!f) return;
    change({ filters: [...q.filters, f] }); setRuleEdit(q.filters.length); setPanelOpen(true);
  };

  // ── actions on the result ───────────────────────────────────────────────────────────────────────────────────────────
  const exchOf = (r: Row) => (market === 'IN' ? (r.exch?.[0] || 'NSE') : (r.exch?.[0] || 'US'));
  const openForReview = (r: Row, tf: string) => {
    // the chart's Next / Previous step through the same companies the actions use (the searched result by default)
    const queue = actHits.some((h) => h.row.t === r.t) ? actHits : narrowed;
    writeReviewQueue(`Pine: ${name}${scopeNow !== 'results' ? ` · ${actLabel}` : ''}`, queue.map((h) => ({ symbol: h.row.t, exchange: exchOf(h.row), name: h.row.n })), '/pine-screener');
    const ex = market === 'IN' ? (r.exch?.[0] || 'NSE') : (r.exch?.[0] || '');
    return `/charts?symbol=${encodeURIComponent(r.t)}&exchange=${encodeURIComponent(ex)}&t=${encodeURIComponent(r.t)}&m=${market}&tf=${tf}&review=screener`;
  };
  const copyTickers = () => {
    const txt = actHits.map((h) => (market === 'IN' ? `NSE:${h.row.t}` : h.row.t)).join(',');
    navigator.clipboard?.writeText(txt).then(() => flash(`Copied ${actHits.length} tickers for TradingView — ${actLabel}`)).catch(() => flash('Could not copy — the browser refused clipboard access'));
  };
  const money = market === 'US' ? '$ million' : '₹ crore';
  const cur = market === 'US' ? 'USD' : 'INR';
  const downloadCsv = () => {
    // zzz994 (MC-05) — "Shape score (0–100)", never a percentage probability; timeframe, volume confirmation, scan status and
    // version on every row; prices unrounded; the scan close beside the latest quote (MC-01); the export scope.
    const head = ['Ticker', 'Market', 'Company', 'Sector', 'Pattern', 'Timeframe', 'Bias', 'Stage', SHAPE_SCORE_LABEL, 'Shape score band', 'Volume confirmed', `Pivot (${cur})`,
      'To pivot from scan close (%)', 'To pivot from latest quote (%)', 'Length (weeks)', 'Depth (%)', 'Other patterns',
      `Latest quote (${cur})`, 'Quote source', `Scan close (${cur})`, 'Scan close date', 'Scan source', 'Quote vs scan close (%)', 'Price sources disagree',
      'Change (%)', `Market cap (${money})`, `Avg daily value (${money})`, `Perf ${PERF_LABEL[q.perfKey]} (%)`, 'RSI 14',
      ...q.cols.map((k) => { const d = fieldOf(k); const u = d?.unit === '%' ? ' (%)' : d?.unit === 'money' ? ` (${money})` : d?.unit === 'price' ? ` (${cur})` : ''; return `${d?.label || k}${u}`; }),
      'Approximate (≈) fields', 'Scan status', 'Scan engine version', 'Patterns as of', 'Not evaluated (provisional)', 'Snapshot built (UTC)', 'Export scope'];
    const body = actHits.map(({ row: r, best: b, tags, missing }) => [r.t, market === 'IN' ? 'NSE' : 'US', r.n, r.tvSec || r.sec || '', b ? PATTERN_META[b.id].label : '', b ? (b.tf || 'D') : '',
      b ? (b.b === 'U' ? 'bullish' : 'bearish') : '', b ? stageWord(b) : '', b?.c ?? '', b ? likelihoodWord(b.c) : '', b ? ((b as any).vq === 0 ? 'no (too little volume data)' : 'not flagged') : '', b?.p ?? '',
      b ? dirDist(b) ?? '' : '', b && typeof (b as any).dq === 'number' ? (b.b === 'U' ? (b as any).dq : -(b as any).dq) : '', b?.l != null ? Math.round((b.l / 5) * 10) / 10 : '', b?.dp ?? '',
      tags.filter((t) => t !== b).map((t) => `${PATTERN_META[t.id].label} [${t.tf || 'D'}] (${t.c})`).join('; '),
      r.px ?? '', r.pxSrc || '', r.scanPx ?? '', r.scanAt || '', r.scanSrc || '', r.pxGap ?? '', r.pxConflict ? 'yes' : '',
      r.chg ?? '', r.mc ?? '', turnoverOf(r, market) ?? '', r[q.perfKey] ?? '', r.rsi ?? '',
      ...q.cols.map((k) => (r as any)[k] ?? ''), (r.approx || []).filter((k) => (q.cols as string[]).includes(k)).join('; '),
      r.scan?.st || '', r.scan?.v ?? '', r.patAt || '', (missing || []).join('; '), snap?.builtAt || '', actLabel]);
    const blob = new Blob(['﻿' + toCsv([head, ...body])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pine_${name.replace(/[^\w-]+/g, '_')}_${market}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const addMatches = () => {
    if (!watchlists || !actHits.length) return;
    if (targetList && !watchlists.lists.some((l) => l.id === targetList)) { flash('Could not add: the selected watchlist no longer exists.'); return; }
    const target = watchlists.lists.find((l) => l.id === targetList) || activeList(watchlists);
    let next = target;
    for (const { row: r } of actHits) { const item: WlItem = { m: market, t: r.t, ...(r.exch?.[0] ? { x: r.exch[0] } : {}) }; next = addItem(next, null, item); }
    const added = listCount(next) - listCount(target);
    updateWatchlists((s) => updateList(s, target.id, () => next));
    flash(`${added} symbols added to ${target.name}${actHits.length > added ? `; ${actHits.length - added} already there or beyond the list limit` : ''}.`);
    setAdding(false);
  };
  const toggleSel = (t: string) => setSelected((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const allShownSel = shown.length > 0 && shown.every((h) => selected.has(h.row.t));

  const btn = (on = false): React.CSSProperties => ({ padding: '5px 10px', borderRadius: 6, border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.bg1, color: on ? '#fff' : C.text1, fontSize: 13, fontWeight: 600, cursor: 'pointer' });
  const small = (on = false): React.CSSProperties => ({ ...btn(on), padding: '3px 8px', fontSize: 12.5 });
  const inp: React.CSSProperties = { width: 86, padding: '4px 6px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13 };
  const numIn = (v: number | null, set: (v: number | null) => void, label: string, width = 86) => (
    <input type="number" aria-label={label} value={v ?? ''} placeholder="any" onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} style={{ ...inp, width }} />
  );
  const opt = (s: PineScreen) => <option key={s.id} value={s.id}>{s.market ? (s.market === 'IN' ? '🇮🇳 ' : '🇺🇸 ') : ''}{s.name}</option>;
  const mine = screens.filter((s) => !builtInIds.has(s.id));
  const builtAt = snap?.builtAt ? new Date(snap.builtAt) : null;
  const notScanned = !!snap && snap.total > 0 && snap.scanned === 0;
  const allOfBias = q.ids.length === 0;
  const unscannedTfs = q.tfs.filter((tf) => !!snap && rows.length > 0 && !tfScanned[tf]);
  const unsupported = coverage.filter((c) => c.status === 'unsupported-pine' || c.status === 'unsupported-market');
  const pending = coverage.filter((c) => c.status === 'pending');
  const companyFilterCount = [q.mcMin, q.mcMax, q.pxMin, q.turnMin, q.perfMin].filter((v) => v != null).length + (q.sectors.length ? 1 : 0);
  const pad = cellPad(density);
  const tdD: React.CSSProperties = { ...td, padding: pad };

  return (
    <div className={workspaceThemeClass(light, true)} style={{ padding: '12px 16px', display: 'grid', gap: 10, color: C.text, background: 'var(--mc-bg-0)', minHeight: '100%', minWidth: 0 }}>
      {/* header: screens + market */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 18 }}>Pine Screener</b>
        <span style={{ fontSize: 12, color: C.dim }} title="Market Cockpit's own TypeScript pattern engine and rules. It does not run or import TradingView Pine Script; screens named after your TradingView scripts follow their published rules and are not certified equivalents.">our own chart-pattern &amp; rule screener — it does not run Pine Script</span>
        <WorkspaceThemeToggle light={light} onToggle={toggleLight} />
        <select value={screenId} onChange={(e) => loadScreen(e.target.value)} style={{ ...btn(), fontSize: 14, maxWidth: 360 }} aria-label="Pine screens">
          {PINE_GROUPS.map((g) => <optgroup key={g.id} label={g.label}>{screens.filter((s) => builtInIds.has(s.id) && (s.group || 'patterns') === g.id).map(opt)}</optgroup>)}
          {mine.length ? <optgroup label="Made here">{mine.map(opt)}</optgroup> : null}
        </select>
        <button type="button" style={btn(dirty)} onClick={() => (builtInIds.has(screenId) ? save(true) : save(false))} title={builtInIds.has(screenId) ? 'Built-in screens are kept as they are: this saves your choices as a new screen' : 'Save the choices into this screen'}>Save{dirty ? ' •' : ''}</button>
        <button type="button" style={btn()} onClick={() => save(true)}>Save as new…</button>
        {builtInIds.has(screenId)
          ? (dirty ? <button type="button" style={btn()} onClick={() => loadScreen(screenId)} title="Back to this screen's built-in choices">Reset</button> : null)
          : <button type="button" style={btn()} onClick={removeSaved}>Delete</button>}
        <span style={{ marginLeft: 8, display: 'inline-flex', gap: 4 }}>
          {(['US', 'IN'] as const).map((m) => <button key={m} type="button" style={btn(market === m)} onClick={() => { setMarket(m); setShowAll(false); setSelected(new Set()); }}>{m === 'US' ? '🇺🇸 USA' : '🇮🇳 India'}</button>)}
        </span>
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 13 }} title="Limit the results to one of your watchlists or the Conviction Beats bench (same market)">
          <span style={{ color: C.dim }}>Companies</span>
          <select value={scope} onChange={(e) => { setScope(e.target.value); setShowAll(false); }} style={{ ...btn(!!scope), maxWidth: 240 }} aria-label="Limit to a list">
            <option value="">All listed companies</option>
            {watchlists ? <optgroup label="My watchlists">{watchlists.lists.map((l) => <option key={l.id} value={`wl:${l.id}`}>★ {l.name} ({listCount(l)})</option>)}</optgroup> : null}
            <option value="cb">🏆 Conviction Beats</option>
          </select>
        </label>
        {msg ? <span role="status" style={{ color: /^(Not saved|Could not)/.test(msg) ? C.red : C.text1, fontSize: 13, fontWeight: 700 }}>{msg}</span> : null}
      </div>
      {note && !dirty ? <div style={{ fontSize: 12.5, color: C.dim }}>ℹ {note}</div> : null}

      {/* compact controls above the results: bias, timeframe, stage, shape score, pivot window */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <span role="radiogroup" aria-label="Bias" style={{ display: 'inline-flex', borderRadius: 7, overflow: 'hidden', border: `1px solid ${C.border}` }}>
          {([['U', '▲ Bullish', C.green], ['D', '▼ Bearish', C.red], ['both', 'Both', C.accent]] as const).map(([b, label, col]) => (
            <button key={b} type="button" role="radio" aria-checked={q.bias === b} onClick={() => setBias(b)}
              style={{ all: 'unset', cursor: 'pointer', padding: '6px 14px', fontWeight: 800, fontSize: 13.5, background: q.bias === b ? col : C.bg1, color: q.bias === b ? '#fff' : C.text1 }}>{label}</button>
          ))}
        </span>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} title="Analysis timeframe of the pattern scan (separate from the chart's display timeframe): D daily, W weekly, M monthly bars">
          <span style={{ color: C.dim }}>Timeframe</span>
          {TIMEFRAMES.map((t) => (
            <button key={t.id} type="button" aria-pressed={q.tfs.includes(t.id)} aria-label={`${t.long} patterns`} title={`${t.long} bars${snap && !tfScanned[t.id] ? ' — not scanned yet' : ''}`} style={small(q.tfs.includes(t.id))} onClick={() => toggleTf(t.id)}>
              {t.label}{snap && !tfScanned[t.id] ? <span style={{ opacity: 0.7 }}> ⏳</span> : null}
            </button>
          ))}
          {q.tfs.length > 1 ? (
            <select value={q.tfMode} onChange={(e) => change({ tfMode: e.target.value === 'all' ? 'all' : 'any' })} style={{ ...inp, width: 'auto' }} aria-label="Timeframes combine">
              <option value="any">ANY selected</option><option value="all">ALL selected</option>
            </select>
          ) : null}
        </span>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: C.dim }}>Stage</span>
          {STAGES.map((s) => <button key={s.id} type="button" title={s.tip} aria-pressed={q.stages.includes(s.id)} style={small(q.stages.includes(s.id))} onClick={() => toggleStage(s.id)}>{s.label}</button>)}
          <button type="button" aria-pressed={allStages} title="Forming, breakout and failed — every stage" style={small(allStages)} onClick={() => change({ stages: allStages ? DEFAULT_QUERY.stages.slice() : STAGES.map((s) => s.id) })}>All stages</button>
        </span>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} title={SHAPE_SCORE_TIP}><span style={{ color: C.dim }}>Shape score</span>
          <select value={q.minConf} onChange={(e) => change({ minConf: Number(e.target.value) })} style={btn()} aria-label="Minimum shape score">
            {LIKELIHOODS.map((l) => <option key={l.min} value={l.min}>{l.label}</option>)}
          </select>
        </label>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} title="Scan close against the pivot, in the pattern's direction: − = not reached yet (bullish: below the buy point; bearish: above the breakdown level), + = beyond it">
          <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={q.dist.on} onChange={(e) => change({ dist: { ...q.dist, on: e.target.checked } })} aria-label="Limit distance to pivot" /> <span style={{ color: C.dim }}>To pivot</span>
          </label>
          <input type="number" aria-label="Distance to pivot from %" value={q.dist.lo} disabled={!q.dist.on} onChange={(e) => change({ dist: { ...q.dist, lo: Number(e.target.value) } })} style={{ ...inp, width: 60 }} />
          <span>to</span>
          <input type="number" aria-label="Distance to pivot to %" value={q.dist.hi} disabled={!q.dist.on} onChange={(e) => change({ dist: { ...q.dist, hi: Number(e.target.value) } })} style={{ ...inp, width: 60 }} />
          <span style={{ color: C.dim }}>%</span>
        </span>
        <label title="Off: the screen's rules alone decide (e.g. the trend-template rules) and any chart pattern is shown beside the company" style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={q.need !== 'any'} onChange={(e) => change({ need: e.target.checked ? 'pattern' : 'any' })} aria-label="Require a chart pattern" /> Require a chart pattern
        </label>
      </div>

      {/* active choices as chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
        <span style={{ color: C.dim }}>{allOfBias ? `All ${q.bias === 'U' ? 'bullish' : q.bias === 'D' ? 'bearish' : ''} pattern types under these constraints` : 'Pattern types (any of):'}</span>
        {q.ids.map((id) => (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: `1px solid ${PATTERN_META[id].bias === 'bullish' ? C.green : C.red}`, color: PATTERN_META[id].bias === 'bullish' ? C.green : C.red, fontWeight: 700 }}>
            <span style={{ padding: '2px 8px' }}>{PATTERN_META[id].label}</span>
            <button type="button" aria-label={`Remove ${PATTERN_META[id].label}`} onClick={() => toggleId(id)} style={{ all: 'unset', cursor: 'pointer', padding: '2px 7px' }}>×</button>
          </span>
        ))}
        {q.filters.map((f, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 6, background: ruleEdit === i ? C.accent : '#374151', color: '#fff', overflow: 'hidden', opacity: f.off ? 0.55 : 1 }}>
            <button type="button" onClick={() => { setRuleEdit(ruleEdit === i ? null : i); setPanelOpen(true); }} title={f.off ? 'Paused — not applied. Click to change.' : 'Click to change this rule'} style={{ all: 'unset', cursor: 'pointer', padding: '3px 8px', textDecoration: f.off ? 'line-through' : undefined }}>{f.off ? '⏸ ' : ''}{filterLabel(f, market)}</button>
            <button type="button" aria-label="Remove rule" onClick={() => { change({ filters: q.filters.filter((_, k) => k !== i) }); setRuleEdit(null); }} style={{ all: 'unset', cursor: 'pointer', padding: '3px 7px', borderLeft: '1px solid rgba(255,255,255,0.2)' }}>×</button>
          </span>
        ))}
        {companyFilterCount ? <span style={{ color: C.dim }}>· {companyFilterCount} company filter{companyFilterCount > 1 ? 's' : ''}</span> : null}
        <span style={{ flex: 1 }} />
        <button type="button" aria-expanded={panelOpen} aria-controls="pine-panel" style={small(panelOpen)} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? '▾' : '▸'} Patterns &amp; filters</button>
      </div>

      {panelOpen ? (
        <div id="pine-panel" style={{ display: 'grid', gap: 8, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
          {/* pattern catalogue */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" style={small(allOfBias)} onClick={() => change({ ids: [] })} title="No pattern ticked = every pattern type of the chosen bias">
              All {q.bias === 'U' ? 'bullish' : q.bias === 'D' ? 'bearish' : 'patterns'}
            </button>
            <input value={patFind} onChange={(e) => setPatFind(e.target.value)} placeholder="find a pattern" aria-label="Find a pattern type" style={{ ...inp, width: 140 }} />
            <button type="button" style={small()} onClick={() => change({ ids: Array.from(new Set([...q.ids, ...ofBias.filter(patMatchesFind)])) })}>Select all</button>
            <button type="button" style={small()} onClick={() => change({ ids: [] })}>Clear</button>
            <button type="button" style={small()} onClick={() => change({ ids: ofBias.filter((id) => !q.ids.includes(id)) })}>Invert</button>
            <span style={{ fontSize: 12, color: C.dim }}>{allOfBias ? 'tick one or more to narrow' : `${q.ids.length} ticked`} · the number on each = companies showing it with the other choices</span>
          </div>
          {groups.map((g) => {
            const ids = g.ids.filter(patMatchesFind);
            if (!ids.length) return null;
            return (
              <div key={`${g.bias}-${g.group}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ width: 150, fontSize: 11.5, fontWeight: 800, color: g.bias === 'bullish' ? C.green : C.red, textTransform: 'uppercase', letterSpacing: 0.3 }}>{g.group}{q.bias === 'both' ? (g.bias === 'bullish' ? ' ▲' : ' ▼') : ''}</span>
                {ids.map((id) => {
                  const on = q.ids.includes(id); const col = g.bias === 'bullish' ? C.green : C.red; const n = snap ? counts[id] || 0 : null;
                  return (
                    <button key={id} type="button" aria-pressed={on} onClick={() => toggleId(id)} title={PATTERN_META[id].short}
                      style={{ padding: '4px 9px', borderRadius: 999, border: `1px solid ${on ? col : C.border}`, background: on ? col : C.bg1, color: on ? '#fff' : n ? C.text : C.dim, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                      {PATTERN_META[id].label} <span style={{ opacity: 0.7, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }} aria-busy={n == null}>{n == null ? '…' : n}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* company filters */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><span style={{ color: C.dim }}>Market cap ({money})</span>
              {numIn(q.mcMin, (v) => change({ mcMin: v }), 'Minimum market cap')}<span>–</span>{numIn(q.mcMax, (v) => change({ mcMax: v }), 'Maximum market cap')}</span>
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><span style={{ color: C.dim }}>Price ≥</span>{numIn(q.pxMin, (v) => change({ pxMin: v }), 'Minimum price', 70)}</span>
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} title={`Average daily traded value: price × 30-day average volume, in ${money}`}><span style={{ color: C.dim }}>Daily value ≥</span>{numIn(q.turnMin, (v) => change({ turnMin: v }), 'Minimum average daily traded value', 70)}</span>
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} title="Relative strength: price performance over the period">
              <select value={q.perfKey} onChange={(e) => change({ perfKey: e.target.value as PerfKey })} style={{ ...inp, width: 'auto' }} aria-label="Performance period">
                {(Object.keys(PERF_LABEL) as PerfKey[]).map((k) => <option key={k} value={k}>Perf {PERF_LABEL[k]}</option>)}
              </select>
              <span style={{ color: C.dim }}>≥</span>{numIn(q.perfMin, (v) => change({ perfMin: v }), 'Minimum performance %', 64)}<span style={{ color: C.dim }}>%</span>
            </span>
            <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><span style={{ color: C.dim }}>Sector</span>
              <select value={q.sectors.length === 1 ? q.sectors[0] : q.sectors.length ? '__many' : ''} onChange={(e) => change({ sectors: e.target.value && e.target.value !== '__many' ? [e.target.value] : [] })} style={{ ...inp, width: 'auto', maxWidth: 220 }} aria-label="Sector">
                <option value="">All sectors</option>
                {q.sectors.length > 1 ? <option value="__many">{q.sectors.length} sectors</option> : null}
                {TV_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {companyFilterCount ? <button type="button" style={small()} onClick={() => change({ mcMin: null, mcMax: null, pxMin: null, turnMin: null, perfMin: null, sectors: [] })}>Clear company filters</button> : null}
          </div>

          {/* zzz994 (section B) — rules on the screener's figures (only fields this page receives) */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            <select value="" onChange={(e) => { if (e.target.value) addRule(e.target.value); }} style={{ ...small(), fontWeight: 700 }} aria-label="Add a rule">
              <option value="">+ Add rule</option>
              <option value="__cmp">One figure against another (e.g. SMA 50 ≥ SMA 200)</option>
              {Array.from(new Set(ruleFields.map((f) => f.group))).map((g) => (
                <optgroup key={g} label={g}>{ruleFields.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label}{f.approxNote?.[market] ? ' ≈' : ''}</option>)}</optgroup>
              ))}
            </select>
            <span style={{ fontSize: 12, color: C.dim }}>{ruleFields.length} figures available here (the Stock Screener has more — a rule on a figure this page does not receive cannot be evaluated here).</span>
          </div>
          {ruleEdit != null && q.filters[ruleEdit] ? (
            <FilterEditor f={q.filters[ruleEdit]} market={market} fields={ruleFields} onChange={(nf) => change({ filters: q.filters.map((x, k) => (k === ruleEdit ? nf : x)) })} onClose={() => setRuleEdit(null)} />
          ) : null}

          {/* zzz984 — extra columns (the TradingView-script fields and more) */}
          <details style={{ fontSize: 12.5 }}>
            <summary style={{ cursor: 'pointer', color: C.dim }}>Columns{q.cols.length ? ` (${q.cols.length} extra)` : ''} — trend template, RS Rating, stage, Rule of 40, RSI, crosses, pocket pivots, volume…</summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
              {OPTIONAL_COLS.map((k) => (
                <label key={k} title={fieldOf(k)?.label} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={q.cols.includes(k)} onChange={(e) => change({ cols: e.target.checked ? [...q.cols, k] : q.cols.filter((x) => x !== k) })} />
                  {COL_SHORT[k] || fieldOf(k)?.label || k}
                </label>
              ))}
            </div>
          </details>
          <details open={showMore} onToggle={(e) => setShowMore((e.target as HTMLDetailsElement).open)} style={{ fontSize: 12, color: C.dim }}>
            <summary style={{ cursor: 'pointer' }}>How the patterns are found</summary>
            <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
              <div>Each company&apos;s daily history (about 5 years) is read by the screener build — as daily candles and, aggregated, as completed weekly and monthly candles — by the screener build with the same pattern engine as the chart&apos;s pattern line — Market Cockpit&apos;s own TypeScript engine, not TradingView Pine Script. Definitions follow O&apos;Neil, Minervini and Bulkowski; each rule passed adds to the <b>shape score</b> (0–100: possible ≥ 35, likely ≥ 55, very likely ≥ 75). The score measures how closely the shape fits — it is not a probability of the pattern working.</div>
              <div><b>Timeframe</b>: D = daily bars. W / M = weekly / monthly bars, shown only once the weekly / monthly scan has run (⏳ = not scanned yet); a daily pattern is never relabelled as weekly or monthly.</div>
              <div><b>Stage</b>: forming = no close beyond the pivot yet; breakout = first close beyond it within the last 5 sessions; failed = broke out in the last 40 sessions and is now more than 7.5% back through it. No stage selected = nothing matches.</div>
              <div><b>To pivot</b>: the scan close against the pivot (the buy point; for bearish patterns the breakdown level) in the pattern&apos;s direction — −5% means 5% short of it. When the latest quote differs from the scan close, the quote distance is in the tooltip. A company read during a session (◷) uses that day&apos;s unfinished bar.</div>
              <div><b>Strict results</b>: a company is listed only when every rule could be evaluated and passed. Companies with a rule that cannot be evaluated (figure missing, timeframe not scanned) are kept apart as provisional.</div>
              <div>Not advice — a pattern is a starting point for a chart review. Click a ticker to open its chart; Next / Previous on the chart step through this list.</div>
            </div>
          </details>
        </div>
      ) : null}

      {/* summary + actions */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 13 }}>
        <b style={{ fontSize: 15 }} aria-busy={!snap && !err}>{snap ? `${hits.length} companies match` : err ? '' : 'Loading…'}</b>
        {snap?.building ? <span style={{ color: C.amber, fontWeight: 700 }} title="A screener build for this market is running now">● building</span> : null}
        {snap ? <span style={{ color: C.dim }}>{snap.withPattern} of {snap.total} show any pattern{snap.patAt ? ` · patterns as of the ${snap.patAt} close` : ''}{builtAt ? ` · data built ${builtAt.toLocaleString()}` : ''}{snap.scanned && snap.scanned < snap.total ? ` · ${snap.total - snap.scanned} companies without a current scan` : ''}</span> : null}
        {err ? <span role="alert" style={{ color: C.red }}>{err}{snap ? ' — showing the last loaded data' : ''}</span> : null}
        <span style={{ flex: 1 }} />
        <input value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="find ticker or name" aria-label="Find in results" style={{ ...inp, width: 150 }} />
        {findText ? <button type="button" style={small()} onClick={() => setFindText('')}>Clear search</button> : null}
        <button type="button" style={btn()} disabled={loading} onClick={() => setRefresh((v) => v + 1)}>{loading ? 'Refreshing…' : err ? 'Retry' : 'Refresh'}</button>
        <button type="button" style={btn()} onClick={copyTickers} disabled={!actHits.length} title={`${actLabel} — ${market === 'IN' ? 'NSE:TICKER, comma separated' : 'tickers, comma separated'}, to paste into a TradingView watchlist`}>Copy for TradingView</button>
        <button type="button" style={btn()} onClick={downloadCsv} disabled={!actHits.length} title={`Exports ${actLabel}`}>Download CSV</button>
        <button type="button" style={btn()} onClick={() => setAdding((v) => !v)} disabled={!actHits.length || !watchlists}>Add to watchlist</button>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: C.dim }}>
        {snap ? <span data-testid="result-counts">{countsLine(sCounts, searching)}{sCounts.provisional ? ` · ${sCounts.provisional} provisional (not counted)` : ''}</span> : <span aria-busy="true">Loading counts…</span>}
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} title="Which companies Copy, CSV, Add to watchlist and the chart review queue act on">Actions apply to
          <select value={scopeNow} onChange={(e) => setActScope(e.target.value as ActionScope)} style={{ ...small(), padding: '3px 6px' }} aria-label="Action scope">
            <option value="results">{scopeLabel('results', sCounts, searching)}</option>
            {searching ? <option value="all">{scopeLabel('all', sCounts, searching)}</option> : null}
            {sCounts.selected ? <option value="selected">{scopeLabel('selected', sCounts, searching)}</option> : null}
            {sCounts.provisional ? <option value="provisional">{scopeLabel('provisional', sCounts, searching)}</option> : null}
          </select>
        </label>
        {selected.size ? <button type="button" style={small()} onClick={() => setSelected(new Set())}>Clear selection ({sCounts.selected})</button> : null}
        <span style={{ flex: 1 }} />
        <span role="radiogroup" aria-label="Row density" style={{ display: 'inline-flex', gap: 4 }}>
          {(['comfortable', 'compact'] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={density === d} style={small(density === d)} onClick={() => setDensity(d)}>{d === 'comfortable' ? 'Comfortable' : 'Compact'}</button>)}
        </span>
      </div>
      {adding && watchlists ? (
        <div role="dialog" aria-label="Add to watchlist" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <label>Destination <select aria-label="Watchlist for pattern matches" value={targetList || activeList(watchlists).id} onChange={(e) => setTargetList(e.target.value)} style={btn()}>{watchlists.lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({listCount(l)})</option>)}</select></label>
          <span style={{ fontSize: 12, color: C.dim }}>{confirmAddText(actHits.length, (watchlists.lists.find((l) => l.id === targetList) || activeList(watchlists)).name, actLabel)}</span>
          <button type="button" style={btn()} onClick={addMatches}>Add symbols</button>
          <button type="button" style={btn()} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : null}
      {watchlistSaveError ? <div role="alert" style={{ color: C.amber }}>{watchlistSaveError} <button type="button" style={btn()} onClick={retryWatchlistSave}>Retry watchlist save</button></div> : null}
      {notScanned || snap?.notes.length ? <div style={{ fontSize: 12.5, color: C.amber, display: 'grid', gap: 2 }}>{(snap?.notes.length ? snap.notes : ['Chart patterns are read during the screener build; the next build adds them.']).map((n, i) => <div key={i}>⏳ {n}</div>)}</div> : null}
      {/* zzz994 (MC-07) — never "next build fills it" for a figure this page cannot receive */}
      {unsupported.length || pending.length || unscannedTfs.length || (notScanned && q.need !== 'any') ? (
        <div role="status" style={{ fontSize: 12.5, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 6, padding: '6px 10px', display: 'grid', gap: 3 }}>
          {unsupported.map((c) => <div key={c.key}>✕ <b>{c.label}</b>: {c.status === 'unsupported-market' ? `not available for ${market === 'US' ? 'US' : 'Indian'} companies` : 'not delivered to the Pine Screener'} — this rule cannot be evaluated here, so no company passes it strictly. Use the Stock Screener for it, or remove the rule.</div>)}
          {pending.map((c) => <div key={c.key}>⏳ <b>{c.label}</b>: no company has this figure yet{snap?.building ? ' (a build is running now)' : ' (it is filled by the screener build)'} — companies are held as provisional, not counted as matches.</div>)}
          {unscannedTfs.map((tf) => <div key={tf}>⏳ <b>{tf === 'W' ? 'Weekly' : tf === 'M' ? 'Monthly' : 'Daily'} patterns</b>: not scanned yet — {q.tfMode === 'all' || q.tfs.length === 1 ? 'no company can pass until it is' : 'only the other selected timeframes can match meanwhile'}. Daily patterns are never relabelled as {tf === 'W' ? 'weekly' : tf === 'M' ? 'monthly' : 'other'}.</div>)}
          {notScanned && q.need !== 'any' ? <div>⏳ Chart patterns have not been scanned for this market yet — the pattern requirement cannot be evaluated; every company is provisional.</div> : null}
        </div>
      ) : null}
      {snap && q.need !== 'any' && !q.stages.length ? <div role="status" style={{ fontSize: 13, color: C.amber }}>No stage selected — choose Forming, Breakout or Failed (or All stages) to see patterns.</div> : null}
      {scope && listTickers ? <div style={{ fontSize: 12.5, color: C.dim }}>Limited to <b style={{ color: C.text1 }}>{scopeName}</b> ({listTickers.size} {market === 'IN' ? 'Indian' : 'US'} symbols on it) · <button type="button" style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setScope('')}>show every company</button></div> : null}
      {empty === 'no-search-match' ? (
        <div role="status" style={{ padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13 }}>
          No match contains “{findText}” — {sorted.length} companies pass the screen. <button type="button" style={small()} onClick={() => setFindText('')}>Clear search</button>
        </div>
      ) : null}

      <div style={{ overflow: 'auto', maxHeight: '78vh', border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: density === 'compact' ? 12.5 : 13 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
            <tr style={{ background: C.bg1 }}>
              <th style={{ ...th, ...pinnedCell(C.bg1), zIndex: 4 }}>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" aria-label="Select every shown row" checked={allShownSel} onChange={(e) => setSelected((s) => { const n = new Set(s); for (const h of shown) { if (e.target.checked) n.add(h.row.t); else n.delete(h.row.t); } return n; })} />
                  <span title={starList ? `★ = on ${starList.name}; click to add / remove` : 'Watchlists'}>★</span>
                  <Th bare label="Company" k="t" sort={sort} setSort={setSort} />
                </span>
              </th>
              <Th label="Pattern" k="pattern" sort={sort} setSort={setSort} />
              <Th label="Shape score" k="conf" sort={sort} setSort={setSort} num title={SHAPE_SCORE_TIP} />
              <Th label="Pivot" k="pivot" sort={sort} setSort={setSort} num />
              <Th label="To pivot" k="dist" sort={sort} setSort={setSort} num title="From the scan close (the close the pattern was read from)" />
              <Th label="Length" k="len" sort={sort} setSort={setSort} num />
              {q.cols.map((k) => <Th key={k} label={COL_SHORT[k] || fieldOf(k)?.label || k} k={k} sort={sort} setSort={setSort} num title={fieldOf(k)?.label} />)}
              <Th label="Price" k="px" sort={sort} setSort={setSort} num title="Latest quote" />
              {showScanCol ? <Th label="Scan close" k="scanPx" sort={sort} setSort={setSort} num title="The close the patterns, pivots and averages were read from — shown because it differs from the latest quote for some rows" /> : null}
              <Th label="Chg" k="chg" sort={sort} setSort={setSort} num />
              <Th label="Mkt cap" k="mc" sort={sort} setSort={setSort} num />
              <Th label={`Perf ${PERF_LABEL[q.perfKey]}`} k={q.perfKey} sort={sort} setSort={setSort} num />
              <Th label="RSI" k="rsi" sort={sort} setSort={setSort} num />
              <Th label="Daily value" k="turn" sort={sort} setSort={setSort} num />
              <Th label="Sector" k="tvSec" sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row: r, tags, best: b }, i) => {
              const dd = b ? dirDist(b) : null;
              const dq = b && typeof (b as any).dq === 'number' ? (b.b === 'U' ? (b as any).dq : -(b as any).dq) as number : null;
              const turn = turnoverOf(r, market);
              const sel = selected.has(r.t);
              const noD = patTagsOf(r, 'D') == null;
              return (
                <tr key={r.t} style={{ borderTop: `1px solid ${C.border}`, background: sel ? 'color-mix(in srgb, var(--mc-accent) 8%, transparent)' : undefined }}>
                  <td style={{ ...tdD, ...pinnedCell(C.bg) }}>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={sel} onChange={() => toggleSel(r.t)} aria-label={`Select ${r.t}`} style={{ marginTop: 3 }} />
                      <button type="button" onClick={() => toggleStar(r)} disabled={!starList} aria-pressed={onStar(r)} aria-label={`${onStar(r) ? 'Remove' : 'Add'} ${r.t} ${onStar(r) ? 'from' : 'to'} ${starList?.name || 'watchlist'}`}
                        title={starList ? `${onStar(r) ? 'On' : 'Add to'} ${starList.name}` : ''} style={{ all: 'unset', cursor: starList ? 'pointer' : 'default', fontSize: 15, color: onStar(r) ? C.amber : C.dim }}>{onStar(r) ? '★' : '☆'}</button>
                      <span>
                        <span style={{ color: C.dim, fontSize: 11, marginRight: 5, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                        <Link data-ticker={r.t} href={`/charts?t=${encodeURIComponent(r.t)}&m=${market}&tf=${b?.tf || 'D'}`} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); window.location.assign(openForReview(r, b?.tf || 'D')); }}
                          style={{ color: C.accent, fontWeight: 700, textDecoration: 'none' }} title={`Open the ${tfWord(b?.tf)} chart — Next / Previous on the chart step through these results in this order`}>{r.t}</Link>
                        {(r as Row).live ? <span title="Read during a trading session: the latest bar was unfinished" style={{ color: C.amber, marginLeft: 4 }}>◷</span> : null}
                        {density === 'compact' ? null : <div style={{ fontSize: 11.5, color: C.dim, maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.n}</div>}
                      </span>
                    </span>
                  </td>
                  <td style={tdD}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 380 }}>
                      {tags.map((t) => <PatternChip key={`${t.tf || 'D'}-${t.id}`} t={t} main={t === b} market={market} patAt={r.patAt} />)}
                    </div>
                  </td>
                  {b ? (
                    <>
                      <td style={{ ...tdD, ...numTd }} title={`${likelihoodWord(b.c)} — shape score ${b.c}/100 (not a probability)`}>{b.c} <span style={{ fontSize: 11, color: C.dim }}>{likelihoodWord(b.c)}</span></td>
                      <td style={{ ...tdD, ...numTd }} title={`Exact: ${fmtExact(b.p)}`}>{fmtPrice(b.p, market)}</td>
                      <td style={{ ...tdD, ...numTd, color: dd == null ? C.dim : dd >= 0 ? (b.b === 'U' ? C.green : C.red) : C.text }}
                        title={[b.d == null ? '' : `Scan close ${Math.abs(b.d).toFixed(2)}% ${b.d < 0 ? 'below' : 'above'} the ${b.b === 'U' ? 'pivot' : 'breakdown level'}${r.scanAt ? ` (close of ${r.scanAt})` : ''}`,
                          dq != null ? `From the latest quote: ${pct(dq, 2)}${r.pxSrc ? ` (${r.pxSrc})` : ''} — shown apart; the filter uses the scan close` : ''].filter(Boolean).join('\n')}>
                        {pct(dd)}{dq != null && dd != null && Math.abs(dq - dd) >= 0.15 ? <span style={{ color: C.amber }}>†</span> : null}
                      </td>
                      <td style={{ ...tdD, ...numTd }} title={b.dp != null ? `${b.dp}% deep` : ''}>{b.l != null ? (b.l >= 10 ? `${Math.max(1, Math.round(b.l / 5))} wk` : `${b.l} d`) : '—'}</td>
                    </>
                  ) : <td colSpan={4} style={{ ...tdD, color: C.dim, fontSize: 12 }}>{noD ? patMissingWhy(r, 'D') : 'no matching chart pattern'}</td>}
                  {q.cols.map((k) => {
                    const d = fieldOf(k); const v = (r as any)[k] as number | null | undefined; const ax = r.approx?.includes(k);
                    return <td key={k} style={{ ...tdD, ...numTd }} title={[d?.label, typeof v === 'number' ? `Exact: ${fmtExact(v)}` : '', ax ? `Approximate — ${d?.approxNote?.[market] || ''}` : ''].filter(Boolean).join('\n')}>{ax && v != null ? '≈' : ''}{fmtCol(k, v, market)}</td>;
                  })}
                  <td style={{ ...tdD, ...numTd }} title={pxDiffers(r) ? scanTip(r, market) : `Exact: ${fmtExact(r.px)}${r.pxSrc ? ` (${r.pxSrc})` : ''}`}>
                    {r.pxConflict ? <span style={{ color: C.amber }} aria-label="Price sources disagree">⚠ </span> : null}{fmtPrice(r.px, market)}
                  </td>
                  {showScanCol ? <td style={{ ...tdD, ...numTd, color: pxDiffers(r) ? C.text : C.dim }} title={pxDiffers(r) ? scanTip(r, market) : 'Same as the latest quote'}>{pxDiffers(r) ? fmtPrice(r.scanPx, market) : '='}</td> : null}
                  <td style={{ ...tdD, ...numTd, color: typeof r.chg === 'number' ? (r.chg >= 0 ? C.green : C.red) : C.dim }}>{pct(r.chg)}</td>
                  <td style={{ ...tdD, ...numTd }} title={`Exact: ${fmtExact(r.mc)} ${money}`}>{fmtMoney(r.mc, market)}</td>
                  <td style={{ ...tdD, ...numTd, color: typeof r[q.perfKey] === 'number' ? ((r[q.perfKey] as number) >= 0 ? C.green : C.red) : C.dim }}>{pct(r[q.perfKey] as number | null | undefined, 0)}</td>
                  <td style={{ ...tdD, ...numTd }}>{typeof r.rsi === 'number' ? Math.round(r.rsi) : '—'}</td>
                  <td style={{ ...tdD, ...numTd }} title={`price × 30-day average volume, ${money}`}>{fmtMoney(turn, market)}</td>
                  <td style={{ ...tdD, fontSize: 12, color: C.dim, maxWidth: 160 }}>{r.tvSec || r.sec || '—'}</td>
                </tr>
              );
            })}
            {!snap && !err ? [0, 1, 2].map((k) => (
              <tr key={`ph-${k}`} aria-hidden style={{ borderTop: `1px solid ${C.border}` }}><td colSpan={14} style={{ ...tdD, color: C.dim }}><span style={{ display: 'inline-block', width: `${60 - k * 12}%`, height: 10, borderRadius: 4, background: C.bg1 }} /></td></tr>
            )) : null}
          </tbody>
        </table>
        {narrowed.length > 200 ? <div style={{ padding: 8, textAlign: 'center' }}><button type="button" style={btn()} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show the first 200' : `Show all ${narrowed.length}`}</button></div> : null}
        {empty === 'no-data' ? (
          <div role="status" style={{ padding: 14, color: C.dim, fontSize: 13 }}>{snap?.building ? 'The first build of this market is running — companies appear here when it finishes.' : 'No companies in the stored data yet.'}</div>
        ) : empty === 'no-filter-match' ? (
          <div role="status" style={{ padding: 14, color: C.dim, fontSize: 13 }}>
            {scope && listTickers && !listTickers.size ? `${scopeName} has no ${market === 'IN' ? 'Indian' : 'US'} symbols — switch market or list.`
              : q.need !== 'any' && !q.stages.length ? 'No stage selected — nothing can match. Choose a stage above.'
              : `No company matches every rule.${provHits.length ? ` ${provHits.length} could not be fully evaluated (see Provisional below).` : ''} Widen the pivot window, lower the shape score, add a stage or untick patterns — the number on each pattern shows where the matches are.`}
          </div>
        ) : null}
      </div>
      {provHits.length ? (
        <details style={{ fontSize: 12.5, border: `1px dashed ${C.amber}`, borderRadius: 8, padding: '6px 10px' }}>
          <summary style={{ cursor: 'pointer', color: C.amber }}>Provisional — {provHits.length} {provHits.length === 1 ? 'company' : 'companies'} not counted: a rule could not be evaluated ({Array.from(new Set(provHits.flatMap((h) => h.missing || []))).slice(0, 3).join('; ')}{new Set(provHits.flatMap((h) => h.missing || [])).size > 3 ? '…' : ''})</summary>
          <div style={{ color: C.dim, margin: '4px 0' }}>These passed every rule that could be checked. They are not matches; bulk actions use them only when you choose the “Provisional” scope.</div>
          <ul style={{ margin: '4px 0 0 16px', columns: 2, columnGap: 24 }}>
            {scopeSets.provisional.slice(0, 60).map((h) => <li key={h.row.t}><b>{h.row.t}</b> <span style={{ color: C.dim }}>— not evaluated: {(h.missing || []).join('; ')}</span></li>)}
          </ul>
          {provHits.length > 60 ? <div style={{ color: C.dim }}>… and {provHits.length - 60} more (download them with the Provisional scope).</div> : null}
        </details>
      ) : null}
      <div style={{ fontSize: 11.5, color: C.dim }}>Defaults: <button type="button" style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { setQ(clone({ ...DEFAULT_QUERY, bias: q.bias })); setDirty(true); }}>reset every choice</button> (daily patterns, shape score likely or better, forming + breakout, −15% to +5% from the pivot).</div>
    </div>
  );
}

function PatternChip({ t, main, market, patAt }: { t: ScreenPatternTag; main: boolean; market: ScreenMarket; patAt?: string }) {
  const m = PATTERN_META[t.id];
  const failed = t.s === 'x';
  const col = failed ? C.dim : t.b === 'U' ? C.green : C.red;   // a failed formation is neutral, never the active narrative colour
  const tf = t.tf || 'D';
  const vq = (t as any).vq === 0;
  const tip = [`${m.label} (${m.bias}) on ${tfWord(tf)} bars — ${stageWord(t)}, shape score ${t.c}/100 (${likelihoodWord(t.c)}; not a probability)`,
    t.p != null ? `${t.b === 'U' ? 'Pivot' : 'Breakdown level'} ${fmtPrice(t.p, market)}${t.d != null ? `, scan close ${Math.abs(t.d).toFixed(2)}% ${t.d < 0 ? 'below' : 'above'}` : ''}` : '',
    typeof (t as any).dq === 'number' ? `From the latest quote: ${(t as any).dq > 0 ? '+' : ''}${(t as any).dq}%` : '',
    t.l != null ? `${t.l >= 10 ? `${Math.round(t.l / 5)} weeks` : `${t.l} days`} long${t.dp != null ? `, ${t.dp}% deep` : ''}` : '',
    vq ? 'Volume not confirmed: too little usable volume data for this pattern' : '',
    m.short, patAt ? `As of the ${patAt} close` : ''].filter(Boolean).join('\n');
  return (
    <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 999, fontSize: 11.5, fontWeight: main ? 800 : 600, whiteSpace: 'nowrap',
      border: `1px ${failed ? 'dashed' : 'solid'} ${col}`, background: main && !failed ? col : 'transparent', color: main && !failed ? '#fff' : col }}>
      <span aria-hidden>{STAGE_GLYPH(t)}</span>{m.label}
      <span style={{ fontSize: 10, fontWeight: 800, padding: '0 4px', borderRadius: 4, border: '1px solid currentColor', opacity: 0.85 }} aria-label={`${tfWord(tf)} timeframe`}>{tf}</span>
      <span style={{ opacity: 0.8, fontWeight: 600 }}>{t.c}</span>
      {vq ? <span title="Volume not confirmed" aria-label="volume not confirmed" style={{ opacity: 0.85 }}>v?</span> : null}
    </span>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', fontSize: 11.5, fontWeight: 800, color: 'var(--mc-text-3, #6b7280)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
const numTd: React.CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
function Th({ label, k, sort, setSort, num, title, bare }: { label: string; k: string; sort: { key: string; dir: 1 | -1 }; setSort: (s: { key: string; dir: 1 | -1 }) => void; num?: boolean; title?: string; bare?: boolean }) {
  const on = sort.key === k;
  const b = (
    <button type="button" title={title} onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : num ? -1 : 1 })} style={{ all: 'unset', cursor: 'pointer', color: on ? 'var(--mc-accent)' : undefined }}>
      {label} {on ? (sort.dir === -1 ? '▼' : '▲') : ''}
    </button>
  );
  return bare ? b : <th style={{ ...th, textAlign: num ? 'right' : 'left' }} title={title}>{b}</th>;
}
