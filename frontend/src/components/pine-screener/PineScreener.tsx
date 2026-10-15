'use client';
// zzz983 — PINE SCREENER page: our own pattern & rule screener (a TypeScript pattern engine — it does not run Pine Script). Every
// company whose chart shows one of the chart patterns right now (bullish bases, flags, triangles, bottoms; bearish tops, flags,
// wedges). The patterns are read once a day by the stock screener's build from the same daily bars as its price figures
// (lib/screener/pine.ts); this page downloads the companies and filters in the browser, so every change is instant. Built-in
// screens are data (lib/screener/pine-presets.ts); the owner's own screens are kept in 'mc:pine-screens:v1' (synced by the vault).
// zzz994 — explicit stages, one action scope with row selection, shape score, strict results + provisional preview, scan close
// beside the latest quote, D / W / M analysis timeframes.
// zzz999 — REDESIGN (owner: "hard to understand by seeing", "not professional", "some functionalities belong in the screener"):
//   · this page answers ONE question — which charts are setting up now; fundamentals and the general rule editor live in the Stock
//     Screener, and any Stock screen (built-in or saved) can be the company list here ("Companies"), so the two combine;
//   · setup cards to start from (with today's counts), a compact filter panel on the left (on top on a phone), a ranked table with
//     fewer default columns and an expandable detail per company, and a "My portfolio" check of every holding.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { ScreenMarket, ScreenRow } from '@/lib/screener/types';
import { PATTERN_META, PATTERN_IDS, type PatternId } from '@/lib/chart-patterns';
import {
  DEFAULT_QUERY, LIKELIHOODS, OPTIONAL_COLS, PINE_GROUPS, PINE_SCREENS_KEY, STAGES, TIMEFRAMES, SHAPE_SCORE_LABEL, SHAPE_SCORE_TIP, cleanPineScreens, cleanQuery, dirDist,
  likelihoodWord, patternCounts, patternGroups, runPineFull, turnoverOf, onList, ruleCoverage, pineRuleFields, pineRuleMenu, tagLengthText,
  pineFilters, pineShownCols, R40_LEVELS, R40_MAX_GROWTH, R40_MAX_ABS_FCFM, R40_FORMULA, R40_FIELDS, r40Explain,
  type PerfKey, type PineHit, type PineQuery, type PineScreen, type PineStage, type ScreenPatternTag,
} from '@/lib/screener/pine';
import { BUILT_IN_PINE_SCREENS } from '@/lib/screener/pine-presets';
import { fmtValue, fmtPrice, fmtMoney, fmtExact, filterLabel, fieldOf, patTagsOf, patMissingWhy, BUILT_IN_SCREENS, SCREENS_KEY, cleanScreens, type Filter, type NumKey, type PatTf, type Screen } from '@/lib/screener/filters';
import { TV_SECTORS } from '@/lib/screener/tv-sectors';
import { writeReviewQueue } from '@/lib/screener/workflow';
import { scopeItems, scopeCounts, scopeLabel, countsLine, emptyState, confirmAddText, effectiveScope, type ActionScope } from '@/lib/screener/action-scope';
import {
  SETUP_CARDS, setupCounts, scopeKind, stockScreenTickers, cleanHandoff, PINE_HANDOFF_KEY, maPosition, portfolioCheck, stageWord, tfWord,
  querySummary, presetLine, scopeCoverage, coverageLine, chipApplicability, unsupportedNotice, familyOf, latestConditions, lengthDays, lengthTip,
  analysisOf, sessionLabel, chartIdentityParams, ANALYSIS_CSV_HEAD, analysisCsvCells, listCoverageRows, withCarriedR40, scopeAfterScreen, scopePicked, r40AfterScreen, r40WasUser, type ScopeState,
  queryRebuild, setupRebuild, tfCoverageWarnings, technicalSession, conflictWords,
  NO_STAGE_TEXT, ALL_TYPES_TEXT, conditionState, WORKFLOWS, workflowScope, stagesDiffer, presetStages, screenFunnel, perfPath, stageTip, stageWindowText,
  type PineHandoff, type Workflow, type SetupCard, type PortfolioMode,
} from '@/lib/screener/pine-view';
import { loadHoldings, localIndiaHoldings } from '@/lib/screener/portfolio-scope';
import { pollWhenVisible } from '@/lib/client-fetch';
import { useWorkspaceLight, workspaceThemeClass } from '@/lib/workspace-theme';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';
import { FilterEditor, readDensity, writeDensity, type Density } from '@/components/stock-screener/FilterEditor';
import { useWatchlistStore } from '@/components/charts/WatchlistPanel';
import { activeList, updateList, addItem, removeItem, findItem, itemKey, listCount, type WlItem } from '@/lib/chart-watchlist';
import { getConvictionTickers, getConvictionList } from '@/lib/conviction-beats';
import { attachLatestResults, withBrowserBench, marketToday, resultKey, resultSortDate, resultSortTier, RESULT_CSV_HEAD, resultCsvCells, RES_DAY_CHOICES, resultRuleOn, type LatestResultIndex } from '@/lib/screener/latest-result';
import { LatestResultCell } from './LatestResult';
import { toCsv } from '@/lib/csv';
import { C, PINE_CSS, PatternChip, ScoreBar, MaCell, Th, ConditionBadges, ConditionChip, Sparkline, PivotGauge, Kbd, HelpOverlay, FunnelStrip, SkeletonRows, SearchBox, pct, signColor } from './pine-ui';
import { WhyNot, WhyResultView } from './WhyNot';
import { SetupCards } from './SetupCards';
import { PortfolioCheck } from './PortfolioCheck';
import { HitDetail } from './HitDetail';

type Row = ScreenRow & { live?: 1 };
interface Snap { builtAt: string | null; rows: Row[]; total: number; scanned: number; withPattern: number; patAt: string | null; notes: string[]; building: boolean; stale: number; insufficient: number; pxConflicts: number }
const SCOPE_KEY = 'mc:pine-screener:scope:v1';   // zzz989 — which list the results are limited to (this browser only)
const SCOPE_ORIGIN_KEY = 'mc:pine-screener:scope-origin:v1';   // zzz1016 — whether that list was picked by hand or set by a screen, + the last list picked by hand
const LAST_KEY = 'mc:pine-screener:last:v1';   // the screen + unsaved choices open last time (this browser only)
const VIEW_KEY = 'mc:pine-screener:view:v1';   // zzz999 — setups or the portfolio check (this browser only)
const EXTRA_KEY = 'mc:pine-screener:cols:v1';  // zzz999 — the optional fixed columns switched on (this browser only)
const RES_COL_KEY = 'mc:pine-screener:res-col:v1';   // zzz1032 — the Latest result column on / off (on by default; this browser only)
const US_CB_KEY = 'mc:conviction-beats-us:v1';       // the US Conviction Beats bench of this browser (read directly: a light read)
/** zzz1032 — this browser's Conviction Beats bench for a market (India: the bench module; US: its stored map). */
function browserBench(market: ScreenMarket): any[] {
  try {
    if (market === 'IN') return getConvictionList();
    const o = JSON.parse(localStorage.getItem(US_CB_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? Object.values(o) : [];
  } catch { return []; }
}
type ResState = { status: 'loading' | 'ok' | 'error'; index: LatestResultIndex | null; error: string | null; info: string };
type Last = { id: string; market: ScreenMarket; q: PineQuery; dirty: boolean };
type View = 'setups' | 'portfolio';
type Extra = 'chg' | 'mc' | 'perf' | 'rsi' | 'turn';
const EXTRAS: ReadonlyArray<{ id: Extra; label: string }> = [
  { id: 'chg', label: 'Change today' }, { id: 'mc', label: 'Market cap' }, { id: 'perf', label: 'Performance' }, { id: 'rsi', label: 'RSI 14' }, { id: 'turn', label: 'Daily value traded' },
];
/** zzz1007 — why a Rule of 40 cell is blank although both inputs are there. */
const R40_GUARD_TIP = `Left blank when revenue growth is above +${R40_MAX_GROWTH}% or the FCF margin is outside −${R40_MAX_ABS_FCFM}% to +${R40_MAX_ABS_FCFM}% (growth from a tiny sales base) — such a company does not pass a Rule of 40 rule.`;

function readSaved(): PineScreen[] { try { return cleanPineScreens(JSON.parse(localStorage.getItem(PINE_SCREENS_KEY) || '[]')); } catch { return []; } }
function writeSaved(list: PineScreen[]): boolean { try { localStorage.setItem(PINE_SCREENS_KEY, JSON.stringify(list.map(({ builtIn: _b, ...s }) => s))); return true; } catch { return false; } }
function readLast(): Last | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    return v && typeof v.id === 'string' ? { id: v.id, market: v.market === 'IN' ? 'IN' : 'US', q: cleanQuery(v.q), dirty: !!v.dirty } : null;
  } catch { return null; }
}
function readStockScreens(): Screen[] { try { return cleanScreens(JSON.parse(localStorage.getItem(SCREENS_KEY) || '[]')); } catch { return []; } }
function readHandoff(): PineHandoff | null { try { return cleanHandoff(JSON.parse(sessionStorage.getItem(PINE_HANDOFF_KEY) || 'null')); } catch { return null; } }
function urlParam(k: string): string | null { try { return new URLSearchParams(window.location.search).get(k); } catch { return null; } }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const keyOf = (h: PineHit) => h.row.t;
const PERF_LABEL: Record<PerfKey, string> = { perf1M: '1M', perf3M: '3M', perf6M: '6M', perf1Y: '1Y' };
/** zzz984 — short headers for the optional columns (the full label is the header's tooltip). */
const COL_SHORT: Partial<Record<NumKey, string>> = {
  tt: 'TT rules', ttOk: 'TT all 6', rsR: 'RS Rating', stage: 'Stage', st12: 'Stage 1→2', r40: 'Rule of 40', revQYoY: 'Rev Q YoY', fcfmTTM: 'FCF margin FY',
  rsiMA: 'RSI avg', rsiX: 'RSI × avg (d)', gcD: 'Golden × (d)', dcD: 'Death × (d)', emaXU: 'EMA10×21 up (d)', emaXD: 'EMA10×21 dn (d)', ppD: 'Pocket pivot (d)',
  rvol: 'RVol', 'adv$': 'Avg value', adrP: 'ADR %', ripB: 'Ripster', perf1M: 'Perf 1M', perf6M: 'Perf 6M', perf1Y: 'Perf 1Y',
  twSt: 'TW stage', sata: 'SATA', mrs: 'Mansfield RS', twWk: 'Weeks in stage',   // zzz987 — Stage Analysis (TheWrap method)
};
/** zzz1011 — the Condition column's sort order: the strongest current condition first. */
const COND_ORDER = ['holding', 'crossed', 'retesting', 'forming', 'returned', 'expired', 'invalidated'] as const;
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
/** zzz1008 (PROF) — the close the best pattern was READ on (its own timeframe: daily / completed week / completed month) differs from
 *  the latest quote (beyond rounding). This column shows that analysis close, never the daily technical close under a W / M tag. */
const anClose = (h: PineHit) => analysisOf(h.row, h.best || { tf: 'D' }).close;
const pxDiffers = (h: PineHit) => { const c = anClose(h), px = h.row.px; return typeof c === 'number' && typeof px === 'number' && c > 0 && Math.abs(px / c - 1) * 100 >= 0.15; };
const scanTip = (h: PineHit, market: ScreenMarket) => {
  const r = h.row, an = analysisOf(r, h.best || { tf: 'D' });
  return [
    `${tfWord(an.tf).replace(/^./, (c) => c.toUpperCase())} analysis close ${an.close != null ? fmtPrice(an.close, market) : '(not stored)'} — ${sessionLabel(an)}: the pattern, its stage and "To pivot" were read on it`,
    `Daily technical close ${fmtPrice(r.scanPx, market)}${r.scanAt ? ` on ${r.scanAt}` : ''}${technicalSession(r) === 'provisional' ? ' (session open — provisional)' : ''}${r.scanSrc ? ` (${r.scanSrc}${r.scanBasis ? `, ${r.scanBasis}` : ''})` : ''} — the 21 / 50 / 200-day averages use it`,
    `Latest quote ${fmtPrice(r.px, market)}${r.pxSrc ? ` (${r.pxSrc}${r.pxAt ? `, ${r.pxAt}` : ''})` : ''}${typeof r.pxGap === 'number' ? ` — ${r.pxGap > 0 ? '+' : ''}${r.pxGap}% vs the daily technical close` : ''}`,
    typeof r.pxAlt === 'number' ? (market === 'IN' ? `NSE's price file for ${r.pxAt || 'the latest session'} is not out yet (it comes out in the evening): the completed close from the daily bars is shown; NSE's previous close was ${fmtPrice(r.pxAlt, market)}` : `Nasdaq's list still showed ${fmtPrice(r.pxAlt, market)} (the previous session's close), so the last daily bar's close is used${r.pxLive ? ' — today\'s unfinished bar, provisional' : ''}`) : '',
    r.pxConflict ? `⚠ ${conflictWords(r)}` : '',
  ].filter(Boolean).join('\n');
};

/** A disclosure section of the filter panel (its content stays in the page, hidden when closed). */
function Section({ title, hint, open, onToggle, children, id }: { title: string; hint?: string; open: boolean; onToggle: () => void; children: React.ReactNode; id: string }) {
  return (
    <div style={{ display: 'grid', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
      <button type="button" className="pnx-sum" aria-expanded={open} aria-controls={id} onClick={onToggle} style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12.5, fontWeight: 700, color: C.text2 }}>
        <span>{open ? '▾' : '▸'} {title}</span>{hint ? <span style={{ fontWeight: 600, color: C.dim }}>{hint}</span> : null}
      </button>
      <div id={id} hidden={!open} style={{ display: open ? 'grid' : undefined, gap: 8 }}>{children}</div>
    </div>
  );
}

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
    const um = urlParam('market');
    const hand = urlParam('from') === 'stock' ? readHandoff() : null;   // "Open in Pine Screener": the hand-off's market
    const market: ScreenMarket = hand ? hand.market : um === 'IN' || um === 'US' ? um : last?.market || s.market || 'US';
    // zzz1007 — 'tv-rule-of-40' is a Pine screen again (an old last-screen with that id simply opens it); the Rule of 40 control in
    // use last time survives like the company list does
    // zzz1016 — only a value the owner set himself travels (a Rule of 40 screen's own ≥ 40 does not)
    const same = !!(last?.dirty && last.id === s.id);
    const lastUser = !!last && r40WasUser(last.id, last.q);
    const q0 = same ? last!.q : withCarriedR40(cleanQuery(clone(s.q)), last ? r40AfterScreen(last.q, lastUser) : null);
    const r40User = same ? lastUser : lastUser && s.q.r40Min == null && q0.r40Min != null;
    return { s, market, q: q0, dirty: same, r40User };
  });
  const [screenId, setScreenId] = useState(first.s.id);
  const [name, setName] = useState(first.s.name);
  const [market, setMarket] = useState<ScreenMarket>(first.market);
  const [q, setQ] = useState<PineQuery>(first.q);
  const [dirty, setDirty] = useState(first.dirty);
  // zzz1016 — the Rule of 40 value in use was set by the owner in the control (carries to the next screen) — not by a screen itself
  const [r40User, setR40User] = useState<boolean>(first.r40User);
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
  const [actScope, setActScope] = useState<ActionScope>('results');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [density, setDensityRaw] = useState<Density>(() => readDensity());
  const setDensity = (d: Density) => { setDensityRaw(d); writeDensity(d); };
  const [patFind, setPatFind] = useState('');
  const [ruleEdit, setRuleEdit] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // zzz1011 — keyboard review: the row cursor (j / k), the shortcut sheet (?), the search box (/)
  const [cursorAt, setCursorAt] = useState<{ key: string; i: number }>({ key: '', i: -1 });
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // zzz999 — the view (setup results or the portfolio check), the filter panel's sections, the optional columns
  const [view, setViewRaw] = useState<View>(() => { const u = urlParam('view'); if (u === 'portfolio' || u === 'setups') return u; try { return localStorage.getItem(VIEW_KEY) === 'portfolio' ? 'portfolio' : 'setups'; } catch { return 'setups'; } });
  const setView = (v: View) => { setViewRaw(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* a convenience */ } };
  // zzz1004 (PS-04) — the portfolio check's All / Risks / Opportunities view
  const [pfMode, setPfMode] = useState<PortfolioMode>(() => { const u = urlParam('pf'); return u === 'risks' || u === 'opps' ? u : 'all'; });
  // the detail panel stays within the visible width of the (horizontally scrolling) table
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapW, setWrapW] = useState<number | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth || null));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, expanded]);
  const [filtersOpen, setFiltersOpen] = useState<boolean>(() => { try { return !window.matchMedia?.('(max-width: 899px)').matches; } catch { return true; } });
  // zzz1033 — owner: an option to hide the filter panel on wide screens too (shown by default; the choice is remembered)
  const [filtersHidden, setFiltersHidden] = useState<boolean>(() => { try { return localStorage.getItem('mc:pine-filters-hidden:v1') === '1'; } catch { return false; } });
  // zzz1033 — owner: coverage / scope / counts lines hidden by default behind "ⓘ Details" (warnings stay visible)
  const [showDetails, setShowDetails] = useState<boolean>(() => { try { return localStorage.getItem('mc:pine-details:v1') === '1'; } catch { return false; } });
  const toggleDetails = () => setShowDetails((v) => { const n = !v; try { localStorage.setItem('mc:pine-details:v1', n ? '1' : '0'); } catch { /* this visit */ } return n; });
  const toggleFiltersHidden = () => setFiltersHidden((v) => { const n = !v; try { localStorage.setItem('mc:pine-filters-hidden:v1', n ? '1' : '0'); } catch { /* this visit */ } return n; });
  const [sec, setSec] = useState<Record<string, boolean>>(() => ({ patterns: first.q.ids.length > 0, rules: first.q.filters.length > 0, size: false, res: resultRuleOn(first.q), cols: false, how: false }));
  const toggleSec = (k: string) => setSec((s) => ({ ...s, [k]: !s[k] }));
  const [extras, setExtrasRaw] = useState<Extra[]>(() => { try { const v = JSON.parse(localStorage.getItem(EXTRA_KEY) || '[]'); return Array.isArray(v) ? v.filter((x: unknown): x is Extra => EXTRAS.some((e) => e.id === x)) : []; } catch { return []; } });
  const setExtras = (v: Extra[]) => { setExtrasRaw(v); try { localStorage.setItem(EXTRA_KEY, JSON.stringify(v)); } catch { /* a convenience */ } };
  const has = (e: Extra) => extras.includes(e);
  // zzz989 / zzz999 — the company list: '' every company · 'wl:<id>' a watchlist · 'cb' Conviction Beats · 'pf' my portfolio ·
  // 'ss:<id>' a Stock Screener screen · 'hand' companies sent over from the Stock Screener
  const [handoff] = useState<PineHandoff | null>(() => readHandoff());
  // zzz1016 — the list, where it came from (picked by hand / set by a screen) and the last list picked by hand (scopeAfterScreen)
  const [scopeSt, setScopeSt] = useState<ScopeState>(() => {
    if (urlParam('from') === 'stock' && readHandoff()) return scopePicked('hand');
    let sc = '';
    try { sc = localStorage.getItem(SCOPE_KEY) || ''; } catch { /* a convenience */ }
    try {
      const o = JSON.parse(localStorage.getItem(SCOPE_ORIGIN_KEY) || 'null');
      if (o && o.origin === 'preset' && typeof o.user === 'string') return { scope: sc, origin: 'preset', user: o.user };
    } catch { /* a convenience */ }
    return scopePicked(sc);
  });
  const scope = scopeSt.scope;
  /** a list picked by hand (Companies control, "show every company") */
  const setScope = (v: string) => setScopeSt(scopePicked(v));
  useEffect(() => {
    try {
      localStorage.setItem(SCOPE_KEY, scope === 'hand' ? '' : scope);
      localStorage.setItem(SCOPE_ORIGIN_KEY, JSON.stringify({ origin: scopeSt.origin, user: scopeSt.user === 'hand' ? '' : scopeSt.user }));
    } catch { /* a convenience */ }
  }, [scope, scopeSt]);
  const [cbTick, setCbTick] = useState(0);
  useEffect(() => {
    const bump = () => setCbTick((v) => v + 1);
    window.addEventListener('conviction-beats:updated', bump); window.addEventListener('conviction-beats-us:updated', bump); window.addEventListener('storage', bump);
    return () => { window.removeEventListener('conviction-beats:updated', bump); window.removeEventListener('conviction-beats-us:updated', bump); window.removeEventListener('storage', bump); };
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

  // zzz999 — the owner's holdings (India: the Portfolio page's saved holdings; USA: the US portfolio book), per market
  const [holdings, setHoldings] = useState<Partial<Record<ScreenMarket, { status: 'loading' | 'ok' | 'error'; tickers: string[]; error: string | null; source: string }>>>(() => (market === 'IN' ? { IN: { status: 'loading', tickers: localIndiaHoldings(), error: null, source: 'this browser' } } : {}));
  useEffect(() => {
    const ctrl = new AbortController();
    let stopped = false;
    loadHoldings(market, ctrl.signal).then((h) => { if (!stopped) setHoldings((p) => ({ ...p, [market]: { status: h.error && !h.tickers.length ? 'error' : 'ok', tickers: h.tickers, error: h.error, source: h.source } })); });
    return () => { stopped = true; ctrl.abort(); };
  }, [market, refresh]);
  const hold = holdings[market];   // undefined = not read yet for this market (shown as loading)

  // zzz1032 — each company's latest earnings result (Earnings Opportunities + Conviction Beats), read once per market
  const [resData, setResData] = useState<Partial<Record<ScreenMarket, ResState>>>({});
  const [showRes, setShowResRaw] = useState<boolean>(() => { try { return localStorage.getItem(RES_COL_KEY) !== '0'; } catch { return true; } });
  const setShowRes = (v: boolean) => { setShowResRaw(v); try { localStorage.setItem(RES_COL_KEY, v ? '1' : '0'); } catch { /* a convenience */ } };
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/v1/pine-screener?market=${market}&results=1`, { cache: 'no-store', signal: ctrl.signal })
      .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j?.ok || !j.results || typeof j.results !== 'object' || Array.isArray(j.results)) throw new Error(j?.error || `HTTP ${r.status}`); return j; })
      .then((j) => setResData((p) => ({ ...p, [market]: { status: 'ok', index: j.results as LatestResultIndex, error: null,
        info: `${j.count ?? Object.keys(j.results).length} companies with a graded result · Earnings Opportunities, last ${j.days ?? 100} days (${j.graded ?? '?'} graded days) + Conviction Beats bench${j.partial ? ' · partial read' : ''}` } })))
      .catch((e) => { if (!ctrl.signal.aborted) setResData((p) => ({ ...p, [market]: { status: 'error', index: null, error: String(e?.message || e), info: '' } })); });
    return () => ctrl.abort();
  }, [market, refresh]);
  const res = resData[market];
  const resStatus: 'loading' | 'ok' | 'error' = res?.status || 'loading';
  const resToday = marketToday(market);

  // zzz999 — a Stock Screener screen as the company list: its filters run on the Stock Screener's own (full) data
  const stockScreens = useMemo(() => [...BUILT_IN_SCREENS, ...readStockScreens().filter((s) => !BUILT_IN_SCREENS.some((b) => b.id === s.id))], [scope]);   // eslint-disable-line react-hooks/exhaustive-deps
  const kind = scopeKind(scope);
  const stockScreen = kind === 'stock' ? stockScreens.find((s) => `ss:${s.id}` === scope) || null : null;
  const [stockData, setStockData] = useState<Partial<Record<ScreenMarket, { rows: ScreenRow[] | null; error: string | null }>>>({});
  useEffect(() => {
    if (kind !== 'stock' || stockData[market]?.rows) return;
    const ctrl = new AbortController();
    fetch(`/api/v1/stock-screener?market=${market}`, { cache: 'no-store', signal: ctrl.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok || !j?.ok || !Array.isArray(j.rows)) throw new Error(j?.error || 'Could not load the Stock Screener data'); return j.rows as ScreenRow[]; })
      .then((rows) => setStockData((p) => ({ ...p, [market]: { rows, error: null } })))
      .catch((e) => { if (!ctrl.signal.aborted) setStockData((p) => ({ ...p, [market]: { rows: null, error: e?.message || 'Could not load the Stock Screener data' } })); });
    return () => ctrl.abort();
  }, [kind, market, stockData]);
  const stockSet = useMemo(() => (stockScreen && stockData[market]?.rows ? stockScreenTickers(stockData[market]!.rows!, stockScreen, market) : null), [stockScreen, stockData, market]);

  const snap = snaps[market];
  const err = errors[market] || null;
  // zzz1032 — the latest result rides on each row as `lr` (server index + this browser's Conviction Beats bench); attached only once
  // the server index is read, so a result rule never runs on half the data
  const rows = useMemo<Row[]>(() => {
    const base = snap?.rows || [];
    if (!res?.index) return base;
    void cbTick;
    const universe = new Set(base.map((r) => resultKey(r.t)));
    return attachLatestResults(base, withBrowserBench(res.index, browserBench(market), resToday, universe));
  }, [snap, res, market, resToday, cbTick]);
  // zzz1011 — one watchlist's companies of this market (also used by the "Forming bases in a watchlist" workflow's count)
  const wlSet = useCallback((sc: string): Set<string> | null => {
    const l = watchlists?.lists.find((x) => `wl:${x.id}` === sc);
    if (!l) return null;
    const s = new Set<string>();
    for (const sct of l.sections) for (const it of sct.items) if (it.m === market) s.add(it.t.toUpperCase());
    return s;
  }, [watchlists, market]);
  // zzz1016 — any list's companies: the cards / workflows count on the list a click WILL show, which can be the list last picked by
  // hand (when the current one was set by a screen) — that one may be a Stock screen too
  const userStock = useMemo(() => {
    const sc = scopeSt.user, sr = stockData[market]?.rows;
    if (sc === scope || scopeKind(sc) !== 'stock' || !sr) return null;
    const ss = stockScreens.find((x) => `ss:${x.id}` === sc);
    return ss ? { sc, set: stockScreenTickers(sr, ss, market) } : null;
  }, [scopeSt.user, scope, stockScreens, stockData, market]);
  const tickersFor = useCallback((sc: string): Set<string> | null => {
    void cbTick;
    switch (scopeKind(sc)) {
      case 'all': return null;
      case 'cb': try { return new Set(Array.from(getConvictionTickers()).map((t) => String(t).toUpperCase())); } catch { return new Set(); }
      case 'portfolio': return new Set((hold?.tickers || []).map((t) => t.toUpperCase()));
      case 'stock': return sc === scope ? stockSet || new Set() : userStock && userStock.sc === sc ? userStock.set : new Set();
      case 'hand': return handoff && handoff.market === market ? new Set(handoff.tickers) : new Set();
      default: return wlSet(sc);
    }
  }, [scope, market, cbTick, hold, stockSet, userStock, handoff, wlSet]);
  /** the list is still being read (counts on it are not known yet) */
  const waitingFor = useCallback((sc: string): boolean => {
    const k = scopeKind(sc);
    if (k === 'portfolio') return !hold || (hold.status === 'loading' && !hold.tickers.length);
    if (k === 'stock') return sc === scope ? !stockSet && !stockData[market]?.error : !userStock && !stockData[market]?.error;
    return false;
  }, [hold, scope, stockSet, userStock, stockData, market]);
  const listTickers = useMemo<Set<string> | null>(() => tickersFor(scope), [tickersFor, scope]);
  const scopeName = kind === 'cb' ? 'Conviction Beats' : kind === 'portfolio' ? 'My portfolio' : kind === 'stock' ? (stockScreen ? `Stock screen “${stockScreen.name}”` : 'a Stock screen')
    : kind === 'hand' ? `From the Stock Screener: ${handoff?.label || ''}` : watchlists?.lists.find((x) => `wl:${x.id}` === scope)?.name || '';
  const scopeWaiting = (kind === 'stock' && !stockSet && !stockData[market]?.error) || (kind === 'portfolio' && hold?.status === 'loading' && !hold.tickers.length);
  // zzz994 (MC-07) — STRICT results (every rule evaluated and passed) + a separate provisional preview
  const run = useMemo(() => runPineFull(rows, q, market), [rows, q, market]);
  const hits = useMemo(() => onList(run.strict, listTickers), [run, listTickers]);
  const provHits = useMemo(() => onList(run.provisional, listTickers), [run, listTickers]);
  const activeRules = useMemo(() => pineFilters(q), [q]);   // zzz1007 — the extra rules + the Rule of 40 control
  const coverage = useMemo(() => ruleCoverage(rows, activeRules, market), [rows, activeRules, market]);
  // zzz1007 — the columns shown and exported: the chosen ones plus the Rule of 40 and its inputs while the control is on
  const shownCols = useMemo<NumKey[]>(() => pineShownCols(q), [q]);
  // zzz1004 (PS-02 / PS-05 / PS-06) — the active query in words, coverage of the SELECTED timeframes within the CURRENT list, types the
  // selected timeframes do not read, and the list members that are not matches (coverage rows)
  const summary = querySummary(q, kind === 'all' ? '' : scopeName);
  const scopeCov = useMemo(() => (snap ? scopeCoverage(rows, q.tfs, kind === 'all' ? null : listTickers) : null), [snap, rows, q.tfs, listTickers, kind]);
  const naNotice = useMemo(() => unsupportedNotice(q), [q]);
  // zzz1008 (item 5) — coverage warnings of the SELECTED timeframes, in their own units (weekly / monthly history, not sessions)
  const tfWarn = useMemo(() => (scopeCov ? tfCoverageWarnings(scopeCov.perTf) : []), [scopeCov]);
  const family = familyOf(screenId);
  const covList = !!snap && kind !== 'all' && !scopeWaiting && !!listTickers && listTickers.size > 0 && listTickers.size <= 300 ? listTickers : null;
  const listCov = useMemo(() => (covList ? listCoverageRows({ rows, q, market, list: covList, run }) : null), [covList, rows, q, market, run]);
  const counts = useMemo(() => patternCounts(listTickers ? rows.filter((r) => listTickers.has(r.t.toUpperCase())) : rows, q, market), [rows, q, market, listTickers]);
  // zzz1008 (item 1b) — a selected timeframe being re-read by the current scan: "cannot be determined yet", never "0 match"
  const qRebuild = useMemo(() => queryRebuild(rows, q, kind === 'all' ? null : listTickers), [rows, q, kind, listTickers]);
  // zzz1016 (QA) — the cards count on the CURRENT company list (My portfolio included: a card's number is what clicking it lists) and show
  // "…" while that list is still loading
  // (the setup cards' presets set no list of their own: a click keeps the list — or, when a screen had set it, goes back to the one picked
  // by hand; the Rule of 40 travels only when the owner set it — zzz1016)
  const cardScope = scopeAfterScreen(scopeSt, undefined).scope;
  const cardList = useMemo(() => tickersFor(cardScope), [tickersFor, cardScope]);
  const cardWaiting = waitingFor(cardScope);
  const r40Carry = r40AfterScreen(q, r40User).r40Min;
  const cardRebuild = useMemo(() => (snap ? setupRebuild(rows, cardList) : {}), [snap, rows, cardList]);
  const cardCounts = useMemo(() => {
    if (!snap) return {};
    const c = setupCounts(rows, market, cardList, hold && (hold.status !== 'loading' || hold.tickers.length) ? hold.tickers : null, undefined, { r40Min: r40Carry });
    if (cardWaiting) for (const k of Object.keys(c)) if (k !== 'portfolio') c[k] = null;
    return c;
  }, [snap, rows, market, cardList, hold, r40Carry, cardWaiting]);
  // zzz1011 — the one-click workflows: each one's count on its own company list (portfolio / watchlist / the current list)
  const activeWlId = watchlists ? activeList(watchlists).id : null;
  const wfCounts = useMemo(() => {
    const out: Record<string, number | null> = {};
    if (!snap) return out;
    for (const w of WORKFLOWS) {
      const s = BUILT_IN_PINE_SCREENS.find((x) => x.id === w.presetId);
      if (!s) continue;
      // zzz1016 — the list the click will show: the workflow's own, its screen's, else the list kept / picked by hand
      const sc = scopeAfterScreen(scopeSt, w.scope ? workflowScope(w, scope, activeWlId) : s.scope).scope;
      if (waitingFor(sc)) { out[w.id] = null; continue; }
      const list = tickersFor(sc);
      const base = list ? rows.filter((r) => list!.has(r.t.toUpperCase())) : rows;
      out[w.id] = queryRebuild(base, s.q, null).state === 'none' ? null : runPineFull(base, withCarriedR40(s.q, { r40Min: r40Carry }), market).strict.length;
    }
    return out;
  }, [snap, rows, scope, scopeSt, activeWlId, tickersFor, waitingFor, market, r40Carry]);
  const funnel = useMemo(() => (snap ? screenFunnel(rows, q, kind === 'all' ? null : listTickers, run) : null), [snap, rows, q, kind, listTickers, run]);
  const pfItems = useMemo(() => (view === 'portfolio' && hold ? portfolioCheck(rows, hold.tickers) : []), [view, rows, hold]);
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
        case 'len': return lengthDays(b);   // zzz1004 — elapsed duration: days, weeks × 5, months × 21
        case 'pivot': return b?.p ?? null;
        case 'pattern': return b ? PATTERN_META[b.id].label : null;
        case 't': return r.t;
        case 'tvSec': return r.tvSec || r.sec || '';
        case 'turn': return turnoverOf(r, market);
        case 'ma50': return maPosition(r).d50;
        case 'cond': return b ? COND_ORDER.indexOf(conditionState(r, b).id) : null;   // zzz1011
        case 'anClose': return analysisOf(r, b || { tf: 'D' }).close;
        case 'resD': return resultSortDate((r as any).lr);   // zzz1032 — latest result: by its filing date
        case 'resG': return resultSortTier((r as any).lr);   // … or by its grade (then date)
        default: { const v = (r as any)[sort.key]; return typeof v === 'number' ? v : null; }
      }
    };
    return list.slice().sort((a, b) => {
      const x0 = val(a), y0 = val(b);
      // zzz1016 (QA) — an empty text (no pattern, no sector) is missing like a missing number: last, whichever way the column is sorted
      const x = x0 === '' ? null : x0, y = y0 === '' ? null : y0;
      if ((typeof x === 'string' && y != null) || (typeof y === 'string' && x != null)) return String(x).localeCompare(String(y)) * sort.dir || a.row.t.localeCompare(b.row.t);
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
  // zzz1044 (F04) — ONE identity for the committed result batch (market, snapshot, query, list, search, sort). The count, the table and
  // the table carry it (data-batch), and the table is keyed by it, so a changed screen REPLACES the rows instead of patching them (seen
  // in an audit: the count said 54 while 155 rows of the previous screen stayed on screen). Sorting only reorders the same batch. An
  // open row detail belongs to one batch and is closed when it changes. Copy / CSV / watchlist / chart review use actHits, derived in
  // this same render from the same batch.
  const batchId = useMemo(() => {
    const raw = JSON.stringify([market, snap?.builtAt || '', q, scope, listTickers ? listTickers.size : -1, findText.trim()]);
    let h = 5381; for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }, [market, snap?.builtAt, q, scope, listTickers, findText]);
  const [batchSeen, setBatchSeen] = useState(batchId);
  if (batchSeen !== batchId) { setBatchSeen(batchId); setExpanded(null); }   // (the cursor is already keyed to the result list)
  const searching = !!findText.trim();
  // zzz994 (MC-04 / MC-06) — one action scope for Copy / CSV / watchlist / chart review, with every count kept apart
  const scopeSets = useMemo(() => ({ results: narrowed, all: sorted, selected, provisional: sortHits(provHits) }), [narrowed, sorted, selected, provHits, sortHits]);
  const sCounts = scopeCounts(scopeSets, shown.length, keyOf);
  const scopeNow = effectiveScope(actScope === 'all' && !searching ? 'results' : actScope, sCounts);
  const actHits = scopeItems(scopeSets, scopeNow, keyOf);
  const actLabel = scopeLabel(scopeNow, sCounts, searching);
  const empty = snap ? emptyState({ dataRows: rows.length, filterMatches: sorted.length, searchMatches: narrowed.length, searching }) : null;

  // ── changing the query / screens ────────────────────────────────────────────────────────────────────────────────────
  const change = (patch: Partial<PineQuery>) => { setQ((p) => ({ ...p, ...patch })); setDirty(true); setShowAll(false); if (view !== 'setups') setView('setups'); };
  const loadScreen = useCallback((id: string, scopeOverride?: string): boolean => {
    const s = screens.find((x) => x.id === id);
    if (!s) return false;
    if (dirty && !window.confirm(`Discard the unsaved changes to "${name}"?`)) return false;
    // zzz1016 — the Rule of 40 travels only when the owner set it in the control; a screen with its own value makes it the screen's
    const nq = withCarriedR40(cleanQuery(clone(s.q)), r40AfterScreen(q, r40User));
    setR40User(r40User && s.q.r40Min == null && nq.r40Min != null);
    setScreenId(s.id); setName(s.name); setQ(nq); setDirty(false); setShowAll(false); setSelected(new Set()); setRuleEdit(null); setExpanded(null);
    setSec((x) => ({ ...x, patterns: x.patterns || s.q.ids.length > 0, rules: x.rules || s.q.filters.length > 0 }));
    if (s.market) setMarket(s.market);
    // zzz1004 — a list picked by hand survives a screen change; a screen saved WITH a list (e.g. the portfolio screens) sets it.
    // zzz1016 — a list a screen / workflow set is not carried: the next screen without one goes back to the list last picked by hand
    setScopeSt((st) => scopeAfterScreen(st, scopeOverride !== undefined ? scopeOverride : s.scope));
    return true;
  }, [screens, dirty, name, q, r40User]);
  const pickWorkflow = (w: Workflow) => {
    const sc = workflowScope(w, scope, activeWlId);
    if (loadScreen(w.presetId, w.scope ? sc : undefined)) setView('setups');
  };
  const pickCard = (c: SetupCard) => {
    if (!c.presetId) { setView('portfolio'); return; }
    if (loadScreen(c.presetId)) setView('setups');
  };
  const activeCard = view === 'portfolio' ? 'portfolio' : (!dirty && SETUP_CARDS.find((c) => c.presetId === screenId)?.id) || null;
  const save = (asNew: boolean) => {
    const isBuiltIn = builtInIds.has(screenId);
    const id = asNew ? `my-${Date.now().toString(36)}` : screenId;
    const nm = asNew ? (window.prompt('Name for this Pine screen', `${name}${isBuiltIn ? '' : ' (copy)'}`) || '').trim() : name;
    if (!nm) return;
    const s: PineScreen = { id, name: nm.slice(0, 80), q, ...(asNew ? { market } : screens.find((x) => x.id === id)?.market ? { market: screens.find((x) => x.id === id)!.market } : {}),
      ...(scope !== 'hand' ? { scope } : {}) };   // zzz1004 — the company list is saved with the query
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
    setScreenId(s.id); setName(s.name); setQ(cleanQuery(clone(s.q))); setR40User(false); setDirty(false);
  };
  const setBias = (bias: PineQuery['bias']) => change({ bias, ids: q.ids.filter((id) => bias === 'both' || (PATTERN_META[id].bias === 'bullish') === (bias === 'U')) });
  const toggleId = (id: PatternId) => change({ ids: q.ids.includes(id) ? q.ids.filter((x) => x !== id) : [...q.ids, id] });
  // zzz1008 (item 1a) — the stage buttons look like a segmented control: pressing the only selected stage again used to clear it
  // ("No stage" → 0 matches everywhere). The last stage cannot be switched off from here; choose another one first.
  const toggleStage = (s: PineStage) => {
    if (q.stages.length === 1 && q.stages[0] === s) { flash(`At least one stage stays selected — pick another stage first, or "All stages"`); return; }
    change({ stages: q.stages.includes(s) ? q.stages.filter((x) => x !== s) : [...q.stages, s] });
  };
  const allStages = STAGES.every((s) => q.stages.includes(s.id));
  const toggleTf = (tf: PatTf) => { const next = q.tfs.includes(tf) ? q.tfs.filter((x) => x !== tf) : [...q.tfs, tf]; if (next.length) change({ tfs: next }); };
  const ofBias = PATTERN_IDS.filter((id) => q.bias === 'both' || (PATTERN_META[id].bias === 'bullish') === (q.bias === 'U'));
  const patMatchesFind = (id: PatternId) => !patFind.trim() || PATTERN_META[id].label.toLowerCase().includes(patFind.trim().toLowerCase());
  // zzz1007 — "+ Add a rule" offers every figure this page receives, grouped: Price & volume / Averages / Momentum / Growth & quality /
  // Valuation (zzz999 had limited it to chart figures). A company without the figure fails the rule (strict, zzz997).
  const ruleFields = useMemo(() => pineRuleFields(market), [market]);
  const ruleMenu = useMemo(() => pineRuleMenu(market), [market]);
  const addRule = (v: string) => {
    let f: Filter | null = null;
    if (v === '__cmp') f = { kind: 'cmp', key: 'px', op: 'ge', other: 'sma50' };
    else { const d = ruleMenu.flatMap((g) => g.fields).find((x) => x.key === v); if (d) f = d.unit === 'date' ? { kind: 'date', key: d.key, op: 'pastYears', v: 5 } : { kind: 'num', key: d.key, op: 'gt', v: 0 }; }
    if (!f) return;
    change({ filters: [...q.filters, f] }); setRuleEdit(q.filters.length); setSec((s) => ({ ...s, rules: true }));
  };

  // ── actions on the result ───────────────────────────────────────────────────────────────────────────────────────────
  const exchOf = (r: Pick<Row, 'exch'>) => (market === 'IN' ? (r.exch?.[0] || 'NSE') : (r.exch?.[0] || 'US'));
  const chartUrl = (t: string, ex: string, tf: string) => `/charts?symbol=${encodeURIComponent(t)}&exchange=${encodeURIComponent(ex)}&t=${encodeURIComponent(t)}&m=${market}&tf=${tf}&review=screener`;
  const openForReview = (r: Row, tf: string, tagOverride?: ScreenPatternTag | null) => {
    // the chart's Next / Previous step through the same companies the actions use (the searched result by default)
    const queue = actHits.some((h) => h.row.t === r.t) ? actHits : narrowed;
    writeReviewQueue(`Pine: ${name}${scopeNow !== 'results' ? ` · ${actLabel}` : ''}`, queue.map((h) => ({ symbol: h.row.t, exchange: exchOf(h.row), name: h.row.n })), '/pine-screener');
    const ex = market === 'IN' ? (r.exch?.[0] || 'NSE') : (r.exch?.[0] || '');
    const best = tagOverride || actHits.find((h) => h.row.t === r.t)?.best || narrowed.find((h) => h.row.t === r.t)?.best || null;
    // zzz1004 — the hand-off carries what the row was read on (pattern id, analysis timeframe, its as-of date and session)
    return `/charts?symbol=${encodeURIComponent(r.t)}&exchange=${encodeURIComponent(ex)}&t=${encodeURIComponent(r.t)}&m=${market}&tf=${tf}&review=screener${best && (best.tf || 'D') === tf ? chartIdentityParams(r, best) : ''}`;
  };
  const rowByT = useMemo(() => new Map(rows.map((r) => [r.t.toUpperCase(), r])), [rows]);
  const openPortfolioReview = (tickers: string[], t: string, tf: string) => {
    writeReviewQueue('Pine: My portfolio check', tickers.map((x) => ({ symbol: x, exchange: exchOf(rowByT.get(x) || {}), name: rowByT.get(x)?.n })), '/pine-screener');
    const r = rowByT.get(t);
    return chartUrl(t, market === 'IN' ? (r?.exch?.[0] || 'NSE') : (r?.exch?.[0] || ''), tf);
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
    // zzz999 — + the close against its 21 / 50 / 200-day averages and the length with its unit (days / weeks / months)
    // zzz1004 (PS-02 / PS-05) — the analysis timeframe's own close / date / session / scan status, the daily technical close and the
    // latest quote are separate columns (a W / M row never exports the daily close as its analysis close); length in ≈ trading days;
    // the active query and the preset name on every row.
    const withCur = (h: string) => (h === 'Analysis close' || h === 'Daily technical close' || h === 'Latest quote' ? `${h} (${cur})` : h);
    const covText = scopeCov ? scopeCov.perTf.map(coverageLine).join(' | ') : '';
    const head = ['Ticker', 'Market', 'Company', 'Sector', 'Pattern', 'Timeframe', 'Bias', 'Stage', 'Historical event', 'Condition (analysis close)', SHAPE_SCORE_LABEL, 'Shape score band', 'Volume confirmed', `Pivot (${cur})`,
      'To pivot from analysis close (%)', 'To pivot from latest quote (%)', 'Length', 'Depth (%)', 'Other patterns',
      ...ANALYSIS_CSV_HEAD.map(withCur), 'Daily bars source', 'Quote vs daily technical close (%)', 'Price sources disagree',
      'Change (%)', `Market cap (${money})`, `Avg daily value (${money})`, `Perf ${PERF_LABEL[q.perfKey]} (%)`, 'RSI 14', 'Close vs SMA 21 (%)', 'Close vs SMA 50 (%)', 'Close vs SMA 200 (%)', 'RS Rating',
      ...shownCols.map((k) => { const d = fieldOf(k); const u = d?.unit === '%' ? ' (%)' : d?.unit === 'money' ? ` (${money})` : d?.unit === 'price' ? ` (${cur})` : ''; return `${d?.label || k}${u}`; }),
      ...(shownCols.includes('r40') ? ['Rule of 40 state (formula: revenue growth latest quarter YoY + FCF margin latest full fiscal year; India FCF = cash-flow proxy)'] : []),
      'Approximate (≈) fields', 'Daily scan status', 'Daily scan version', 'Scan engine version', 'Daily patterns as of', 'Not evaluated (provisional)', 'Snapshot built (UTC)', 'Export scope',
      'Active query', 'Preset', 'Coverage (selected timeframes, this list)', ...RESULT_CSV_HEAD];
    const body = actHits.map(({ row: r, best: b, tags, missing }) => { const ma = maPosition(r); const an = analysisOf(r, b || { tf: 'D' }); return [r.t, market === 'IN' ? 'NSE' : 'US', r.n, r.tvSec || r.sec || '', b ? PATTERN_META[b.id].label : '', b ? (b.tf || 'D') : '',
      b ? (b.b === 'U' ? 'bullish' : 'bearish') : '', b ? stageWord(b) : '', b ? conditionState(r, b).event.label : '', b ? conditionState(r, b).label : '', b?.c ?? '', b ? likelihoodWord(b.c) : '', b ? ((b as any).vq === 0 ? 'no (too little volume data)' : 'not flagged') : '', b?.p ?? '',
      b ? dirDist(b) ?? '' : '', b && typeof (b as any).dq === 'number' ? (b.b === 'U' ? (b as any).dq : -(b as any).dq) : '', b ? tagLengthText(b) : '', b?.dp ?? '',
      tags.filter((t) => t !== b).map((t) => `${PATTERN_META[t.id].label} [${t.tf || 'D'}] (${t.c})`).join('; '),
      ...analysisCsvCells(r, b), r.scanSrc || '', r.pxGap ?? '', r.pxConflict ? 'yes' : '',
      r.chg ?? '', r.mc ?? '', turnoverOf(r, market) ?? '', r[q.perfKey] ?? '', r.rsi ?? '', ma.d21 ?? '', ma.d50 ?? '', ma.d200 ?? '', r.rsR ?? '',
      ...shownCols.map((k) => (r as any)[k] ?? ''), ...(shownCols.includes('r40') ? [r40Explain(r, q.r40Min).text] : []), (r.approx || []).filter((k) => (shownCols as string[]).includes(k)).join('; '),
      r.scan?.st || '', r.scan?.v ?? '', an.engine || r.scan?.e || '', r.patAt || '', (missing || []).join('; '), snap?.builtAt || '', actLabel,
      summary, presetLine(name, dirty), covText, ...resultCsvCells((r as any).lr, resToday, market)]; });
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

  // zzz1011 — keyboard review. "/" search · j / k move · Enter opens the chart · o the row detail · x selects · ? the shortcut sheet ·
  // Esc closes it / leaves the search box. Paused while typing in a box (except Esc), and on the portfolio view.
  // the cursor belongs to one result: a new screen / market / list / search starts without one
  const cursorKey = `${screenId}|${market}|${scope}|${findText}`;
  const cursor = cursorAt.key === cursorKey ? cursorAt.i : -1;
  const setCursor = (i: number) => setCursorAt({ key: cursorKey, i });
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    if (e.key === 'Escape') { if (help) { setHelp(false); e.preventDefault(); } else if (typing && el === searchRef.current) el.blur(); return; }
    if (typing) return;
    if (e.key === '?') { setHelp((v) => !v); e.preventDefault(); return; }
    if (help || view !== 'setups') return;
    if (e.key === '/') { searchRef.current?.focus(); searchRef.current?.select(); e.preventDefault(); return; }
    if (!shown.length) return;
    const at = Math.min(cursor, shown.length - 1);
    if (e.key === 'j') { setCursor(Math.min(shown.length - 1, at + 1)); e.preventDefault(); return; }
    if (e.key === 'k') { setCursor(Math.max(0, at < 0 ? 0 : at - 1)); e.preventDefault(); return; }
    if (at < 0) return;
    const h = shown[at];
    if (e.key === 'Enter') { e.preventDefault(); window.location.assign(openForReview(h.row, h.best?.tf || 'D')); return; }
    if (e.key === 'o') { setExpanded((x) => (x === h.row.t ? null : h.row.t)); e.preventDefault(); return; }
    if (e.key === 'x') { toggleSel(h.row.t); e.preventDefault(); }
  };
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // the cursor row stays on screen
  useEffect(() => {
    if (cursor < 0) return;
    const el = document.querySelector(`tr.pnx-row[data-idx="${cursor}"]`) as HTMLElement | null;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const opt = (s: PineScreen) => <option key={s.id} value={s.id}>{s.market ? (s.market === 'IN' ? '🇮🇳 ' : '🇺🇸 ') : ''}{s.name}</option>;
  const mine = screens.filter((s) => !builtInIds.has(s.id));
  const builtAt = snap?.builtAt ? new Date(snap.builtAt) : null;
  const notScanned = !!snap && snap.total > 0 && snap.scanned === 0;
  const allOfBias = q.ids.length === 0;
  // never scanned at all (no stale readings either); a timeframe being re-read is the rebuild banner's job
  const unscannedTfs = q.tfs.filter((tf) => !!snap && rows.length > 0 && !tfScanned[tf] && !qRebuild.perTf.some((x) => x.tf === tf && x.stale > 0));
  const unsupported = coverage.filter((c) => c.status === 'unsupported-pine' || c.status === 'unsupported-market');
  const pending = coverage.filter((c) => c.status === 'pending');
  const companyFilterCount = [q.mcMin, q.mcMax, q.pxMin, q.turnMin, q.perfMin].filter((v) => v != null).length + (q.sectors.length ? 1 : 0);
  const numIn = (v: number | null, set: (v: number | null) => void, label: string) => (
    <input type="number" className="pnx-in" aria-label={label} value={v ?? ''} placeholder="any" onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} />
  );
  // zzz1016 (QA) — 13 fixed columns (company, setup, condition, score, pivot, to pivot, length, analysis close, quote, 12M, averages, RS,
  // sector): the detail row / skeleton spanned one column too many
  const colCount = 13 + shownCols.length + extras.length + (showRes ? 1 : 0);
  const myStockScreens = stockScreens.filter((s) => s.market === market);
  const resCount = (q.resDays != null ? 1 : 0) + (q.resTier ? 1 : 0) + (q.resCb ? 1 : 0);
  const filtersOn = (q.ids.length ? 1 : 0) + q.filters.filter((f) => !f.off).length + companyFilterCount + (scope ? 1 : 0) + (q.r40Min != null ? 1 : 0) + resCount;
  const r40Mode = q.r40Min == null ? 'off' : R40_LEVELS.includes(q.r40Min) ? String(q.r40Min) : 'custom';

  return (
    <div className={`pnx ${workspaceThemeClass(light, true)}${density === 'compact' ? ' pnx-compact' : ''}`} style={{ padding: '16px 18px 32px', display: 'grid', gap: 14, background: 'var(--mc-bg-0)', minHeight: '100%', minWidth: 0 }}>
      <style>{PINE_CSS}</style>
      {help ? <HelpOverlay onClose={() => setHelp(false)} /> : null}
      {/* title, market, theme */}
      <header style={{ display: 'grid', gap: 6 }}>
        <div className="pnx-head">
          <h1 className="pnx-title">Pine Screener</h1>
          <span role="radiogroup" aria-label="Market" className="pnx-seg" style={{ width: 'auto' }}>
            {(['US', 'IN'] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={market === m} style={{ padding: '4px 14px' }} onClick={() => { setMarket(m); setShowAll(false); setSelected(new Set()); setExpanded(null); }}>{m === 'US' ? '🇺🇸 USA' : '🇮🇳 India'}</button>)}
          </span>
          <WorkspaceThemeToggle light={light} onToggle={toggleLight} />
          {msg ? <span role="status" style={{ color: /^(Not saved|Could not)/.test(msg) ? C.red : C.text1, fontSize: 12.5, fontWeight: 650 }}>{msg}</span> : null}
          <span style={{ flex: 1 }} />
          <button type="button" className="pnx-btn pnx-btn-ic pnx-hide-sm" onClick={() => setHelp(true)} title="Keyboard shortcuts" aria-label="Keyboard shortcuts"><Kbd>?</Kbd> Shortcuts</button>
          <Link href="/stock-screener" className="pnx-link" style={{ fontSize: 12.5 }}>Fundamentals: Stock Screener</Link>
        </div>
        {/* zzz1033 — the lede line removed at the owner's request (the 'How the patterns are found' panel explains the engine) */}
      </header>

      <SetupCards active={activeCard} counts={cardCounts} rebuild={cardRebuild} onPick={pickCard} loading={!snap} />

      {/* zzz1011 — one-click workflows (each opens its screen with its company list; the count is on that list) */}
      <nav className="pnx-flows" aria-label="Workflows" data-testid="workflows">
        <span className="pnx-lab" style={{ marginRight: 2 }}>Workflows</span>
        {WORKFLOWS.map((w) => {
          const n = wfCounts[w.id];
          const on = view === 'setups' && !dirty && screenId === w.presetId && (w.scope !== 'pf' || scope === 'pf') && (w.scope !== 'wl' || scope.startsWith('wl:'));
          return (
            <button key={w.id} type="button" className="pnx-flow" aria-pressed={on} data-flow={w.id} onClick={() => pickWorkflow(w)}
              title={`${screens.find((x) => x.id === w.presetId)?.note || w.label}${w.scope === 'wl' ? `\nRuns on ${scope.startsWith('wl:') ? 'the watchlist chosen under Companies' : 'your active watchlist'}.` : w.scope === 'pf' ? '\nRuns on your holdings.' : ''}`}>
              <span className="pnx-flow-dot" aria-hidden style={{ background: w.tone === 'down' ? C.red : w.tone === 'up' ? C.green : C.accent }} />
              {w.label}
              <span className="pnx-flow-n" data-flow-count aria-busy={n == null}>{n == null ? '…' : n.toLocaleString('en-US')}</span>
            </button>
          );
        })}
      </nav>


      <div className="pnx-layout" data-wide={view === 'portfolio'} data-filters-hidden={filtersHidden}>
        {/* ── filters ───────────────────────────────────────────────────────────────────────────────────────────── */}
        {view === 'portfolio' ? null : <aside className="pnx-side" data-open={filtersOpen} data-hidden={filtersHidden} aria-label="Filters">
          <div className="pnx-side-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 14 }}>Filters</b>
            <span className="pnx-note">{filtersOn ? `${filtersOn} on` : ''}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="pnx-btn pnx-side-collapse" aria-expanded={!filtersHidden} data-testid="pine-filters-collapse" onClick={toggleFiltersHidden}
              title={filtersHidden ? 'Show the filter panel' : 'Hide the filter panel — the table uses the full width (your filters stay on)'}>{filtersHidden ? 'Show ▸' : '◂ Hide'}</button>
            <button type="button" className="pnx-btn pnx-side-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>{filtersOpen ? 'Hide' : 'Show'}</button>
          </div>
          <div className="pnx-field">
            <span className="pnx-lab">Screen</span>
            <select value={screenId} onChange={(e) => { if (loadScreen(e.target.value)) setView('setups'); }} className="pnx-in" aria-label="Pine screens">
              {PINE_GROUPS.map((g) => <optgroup key={g.id} label={g.label}>{screens.filter((s) => builtInIds.has(s.id) && (s.group || 'patterns') === g.id).map(opt)}</optgroup>)}
              {mine.length ? <optgroup label="Made here">{mine.map(opt)}</optgroup> : null}
            </select>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="pnx-btn" data-on={dirty} onClick={() => (builtInIds.has(screenId) ? save(true) : save(false))} title={builtInIds.has(screenId) ? 'Built-in screens are kept as they are: this saves your choices as a new screen' : 'Save the choices into this screen'}>Save{dirty ? ' •' : ''}</button>
              <button type="button" className="pnx-btn" onClick={() => save(true)}>Save as new…</button>
              {builtInIds.has(screenId)
                ? (dirty ? <button type="button" className="pnx-btn" onClick={() => loadScreen(screenId)} title="Back to this screen's built-in choices">Reset</button> : null)
                : <button type="button" className="pnx-btn" onClick={removeSaved}>Delete</button>}
            </div>
          </div>
          <label className="pnx-field" title="Limit the results to one of your lists, your holdings, or the companies a Stock Screener screen passes (same market)">
            <span className="pnx-lab">Companies</span>
            <select value={scope} onChange={(e) => { setScope(e.target.value); setShowAll(false); }} className="pnx-in" aria-label="Limit to a list">
              <option value="">All listed companies</option>
              <option value="pf">My portfolio{hold && hold.status !== 'loading' ? ` (${hold.tickers.length})` : ''}</option>
              <option value="cb">🏆 Conviction Beats</option>
              {handoff && handoff.market === market ? <option value="hand">From the Stock Screener: {handoff.label} ({handoff.tickers.length})</option> : null}
              {watchlists ? <optgroup label="My watchlists">{watchlists.lists.map((l) => <option key={l.id} value={`wl:${l.id}`}>★ {l.name} ({listCount(l)})</option>)}</optgroup> : null}
              <optgroup label="Stock Screener screens (fundamentals)">{myStockScreens.map((s) => <option key={s.id} value={`ss:${s.id}`}>{s.name}</option>)}</optgroup>
            </select>
          </label>
          <div className="pnx-field">
            <span className="pnx-lab">Direction</span>
            <span role="radiogroup" aria-label="Bias" className="pnx-seg">
              {([['U', '▲ Bullish', 'pnx-up'], ['D', '▼ Bearish', 'pnx-down'], ['both', 'Both', '']] as const).map(([b, label, cls]) => (
                <button key={b} type="button" role="radio" className={cls} aria-checked={q.bias === b} onClick={() => setBias(b)}>{label}</button>
              ))}
            </span>
          </div>
          <div className="pnx-field" title="Analysis timeframe of the pattern scan (separate from the chart's display timeframe): D daily, W weekly, M monthly bars">
            <span className="pnx-lab">Timeframe</span>
            <span className="pnx-seg">
              {TIMEFRAMES.map((t) => (
                <button key={t.id} type="button" aria-pressed={q.tfs.includes(t.id)} aria-label={`${t.long} patterns`} title={`${t.long} bars${snap && !tfScanned[t.id] ? ' — not scanned yet' : ''}`} onClick={() => toggleTf(t.id)}>
                  {t.label}{snap && !tfScanned[t.id] ? <span style={{ opacity: 0.7 }}> ⏳</span> : null}
                </button>
              ))}
            </span>
            {q.tfs.length > 1 ? (
              <select value={q.tfMode} onChange={(e) => change({ tfMode: e.target.value === 'all' ? 'all' : 'any' })} className="pnx-in" aria-label="Timeframes combine">
                <option value="any">ANY — a pattern on one of them</option><option value="all">ALL — a pattern on every one</option>
              </select>
            ) : null}
          </div>
          <div className="pnx-field">
            <span className="pnx-lab">Stage</span>
            <span className="pnx-seg">
              {STAGES.map((s) => <button key={s.id} type="button" title={stageTip(s.id, q.tfs)} aria-pressed={q.stages.includes(s.id)} onClick={() => toggleStage(s.id)}>{s.label}</button>)}
            </span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="pnx-btn" aria-pressed={allStages} data-on={allStages} title="Forming, breakout and failed — every stage" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => change({ stages: allStages ? DEFAULT_QUERY.stages.slice() : STAGES.map((s) => s.id) })}>All stages</button>
              {/* zzz1011 — the screen's own stages back in one click (a timeframe or preset change never clears them; a manual change can) */}
              {stagesDiffer(screenId, q.stages) ? <button type="button" className="pnx-btn" data-testid="restore-stages" style={{ padding: '3px 9px', fontSize: 12 }} title={`Back to this screen's stages: ${(presetStages(screenId) || []).map((x) => STAGES.find((y) => y.id === x)?.label || x).join(' + ')}`} onClick={() => change({ stages: presetStages(screenId) || DEFAULT_QUERY.stages.slice() })}>Restore preset stages</button> : null}
            </span>
            {!q.stages.length ? <span className="pnx-note" style={{ color: C.amber }}>{NO_STAGE_TEXT}</span> : null}
            {q.stages.includes('b') ? (
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }} title="A breakout whose analysis close is back below the pivot (bearish: a breakdown back above the level) is shown as “broke out · back below pivot”. Untick to count only breakouts holding beyond the pivot.">
                <input type="checkbox" checked={q.returned !== false} onChange={(e) => change({ returned: e.target.checked })} aria-label="Include breakouts back below the pivot" /> Include breakouts back below the pivot
              </label>
            ) : null}
          </div>
          <label className="pnx-field" title={SHAPE_SCORE_TIP}>
            <span className="pnx-lab">Shape score</span>
            <select value={q.minConf} onChange={(e) => change({ minConf: Number(e.target.value) })} className="pnx-in" aria-label="Minimum shape score">
              {LIKELIHOODS.map((l) => <option key={l.min} value={l.min}>{l.label}</option>)}
            </select>
          </label>
          <div className="pnx-field" title="Scan close against the pivot, in the pattern's direction: − = not reached yet (bullish: below the buy point; bearish: above the breakdown level), + = beyond it">
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }} className="pnx-lab">
              <input type="checkbox" checked={q.dist.on} onChange={(e) => change({ dist: { ...q.dist, on: e.target.checked } })} aria-label="Limit distance to pivot" /> Distance to pivot
            </label>
            <span style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="number" className="pnx-in" aria-label="Distance to pivot from %" value={q.dist.lo} disabled={!q.dist.on} onChange={(e) => change({ dist: { ...q.dist, lo: Number(e.target.value) } })} />
              <span>to</span>
              <input type="number" className="pnx-in" aria-label="Distance to pivot to %" value={q.dist.hi} disabled={!q.dist.on} onChange={(e) => change({ dist: { ...q.dist, hi: Number(e.target.value) } })} />
              <span style={{ color: C.dim }}>%</span>
            </span>
          </div>
          <label title={q.ids.length ? 'Pattern types are ticked, so only companies showing one of them are listed — clear the ticked types to let the rules alone decide' : "Off: the screen's rules alone decide (e.g. the trend-template rules) and any chart pattern is shown beside the company"} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: q.ids.length ? 'default' : 'pointer', opacity: q.ids.length ? 0.75 : 1 }}>
            <input type="checkbox" checked={q.need !== 'any' || q.ids.length > 0} disabled={q.ids.length > 0} onChange={(e) => change({ need: e.target.checked ? 'pattern' : 'any' })} aria-label="Require a chart pattern" /> Require a chart pattern{q.ids.length ? ' (types ticked)' : ''}
          </label>

          {/* zzz1007 — the Rule of 40 control: combines AND-style with the setup, direction, timeframes, pattern types and company list */}
          <div className="pnx-field" data-testid="r40-control" title="Rule of 40 = latest quarter revenue growth YoY + FCF margin (your TradingView script). A company without a usable figure does not pass.">
            <span className="pnx-lab">Rule of 40</span>
            <span role="radiogroup" aria-label="Rule of 40" className="pnx-seg">
              {([['off', 'Off'], ['40', '≥ 40'], ['60', '≥ 60'], ['custom', 'Custom']] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={r40Mode === v} onClick={() => { setR40User(v !== 'off'); change({ r40Min: v === 'off' ? null : v === 'custom' ? (r40Mode === 'custom' ? q.r40Min : 50) : Number(v) }); }}>{label}</button>
              ))}
            </span>
            {r40Mode === 'custom' ? (
              <span style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <span>at least</span>
                <input type="number" className="pnx-in" aria-label="Rule of 40 at least" value={q.r40Min ?? ''} onChange={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); const nv = v != null && Number.isFinite(v) ? v : null; setR40User(nv != null); change({ r40Min: nv }); }} />
                <span style={{ color: C.dim }}>%</span>
              </span>
            ) : null}
            {q.r40Min != null ? <span className="pnx-note">Growth + FCF margin ≥ {q.r40Min}; combined with every other choice. Its columns are shown. {R40_GUARD_TIP}</span> : null}
            {/* zzz1011 — the exact formula, periods and required fields; a missing input is unknown (never 0, never a pass) */}
            <details className="pnx-note" data-testid="r40-formula">
              <summary className="pnx-sum" style={{ fontSize: 11.5 }}>Formula, periods and fields</summary>
              <div style={{ display: 'grid', gap: 3, marginTop: 4 }}>
                <span>{R40_FORMULA}.</span>
                {R40_FIELDS.map((f) => <span key={f.key}>· <b style={{ color: C.text1 }}>{f.label}</b> ({f.key}) — {f.period}</span>)}
                <span>A company missing either field shows “unknown”: not 0 and never a pass. A chart-pattern condition is separate — this is a fundamental rule.</span>
              </div>
            </details>
          </div>

          <Section id="pnx-sec-size" title="Size & liquidity" hint={companyFilterCount ? `${companyFilterCount} on` : ''} open={sec.size} onToggle={() => toggleSec('size')}>
            <div className="pnx-field"><span className="pnx-lab">Market cap ({money})</span>
              <span style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>{numIn(q.mcMin, (v) => change({ mcMin: v }), 'Minimum market cap')}<span>–</span>{numIn(q.mcMax, (v) => change({ mcMax: v }), 'Maximum market cap')}</span></div>
            <div className="pnx-field"><span className="pnx-lab">Price at least</span>{numIn(q.pxMin, (v) => change({ pxMin: v }), 'Minimum price')}</div>
            <div className="pnx-field" title={`Average daily traded value: price × 30-day average volume, in ${money}`}><span className="pnx-lab">Daily value traded at least ({money})</span>{numIn(q.turnMin, (v) => change({ turnMin: v }), 'Minimum average daily traded value')}</div>
            <div className="pnx-field" title="Relative strength: price performance over the period"><span className="pnx-lab">Performance at least</span>
              <span style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 6, alignItems: 'center' }}>
                <select value={q.perfKey} onChange={(e) => change({ perfKey: e.target.value as PerfKey })} className="pnx-in" aria-label="Performance period">{(Object.keys(PERF_LABEL) as PerfKey[]).map((k) => <option key={k} value={k}>{PERF_LABEL[k]}</option>)}</select>
                {numIn(q.perfMin, (v) => change({ perfMin: v }), 'Minimum performance %')}<span style={{ color: C.dim }}>%</span>
              </span></div>
            <label className="pnx-field"><span className="pnx-lab">Sector</span>
              <select value={q.sectors.length === 1 ? q.sectors[0] : q.sectors.length ? '__many' : ''} onChange={(e) => change({ sectors: e.target.value && e.target.value !== '__many' ? [e.target.value] : [] })} className="pnx-in" aria-label="Sector">
                <option value="">All sectors</option>
                {q.sectors.length > 1 ? <option value="__many">{q.sectors.length} sectors</option> : null}
                {TV_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {companyFilterCount ? <button type="button" className="pnx-btn" style={{ justifySelf: 'start' }} onClick={() => change({ mcMin: null, mcMax: null, pxMin: null, turnMin: null, perfMin: null, sectors: [] })}>Clear size filters</button> : null}
          </Section>

          {/* zzz1032 — the latest earnings result rules (Earnings Opportunities + Conviction Beats); combined AND-style with every other choice */}
          <Section id="pnx-sec-res" title="Latest result" hint={resCount ? `${resCount} on` : ''} open={!!sec.res} onToggle={() => toggleSec('res')}>
            <label className="pnx-field" title="The company's latest graded result was filed within this many days (a company with no graded result on file does not pass)"><span className="pnx-lab">Result filed in the last</span>
              <select className="pnx-in" aria-label="Result filed in the last" value={q.resDays ?? ''} onChange={(e) => change({ resDays: e.target.value ? Number(e.target.value) : null })}>
                <option value="">any time (off)</option>
                {RES_DAY_CHOICES.map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            </label>
            <label className="pnx-field" title="The grade Earnings Opportunities gave the latest result (from the reported figures only)"><span className="pnx-lab">Grade at least</span>
              <select className="pnx-in" aria-label="Result grade at least" value={q.resTier ?? ''} onChange={(e) => change({ resTier: e.target.value === 'STRONG' || e.target.value === 'BLOCKBUSTER' ? e.target.value : null })}>
                <option value="">any grade (off)</option>
                <option value="STRONG">STRONG or BLOCKBUSTER</option>
                <option value="BLOCKBUSTER">BLOCKBUSTER</option>
              </select>
            </label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }} title="Only companies on the Conviction Beats bench (the server's list and this browser's)">
              <input type="checkbox" checked={!!q.resCb} onChange={(e) => change({ resCb: e.target.checked })} aria-label="Conviction Beats only" /> 🏆 Conviction Beats only
            </label>
            <div className="pnx-note" data-testid="result-source">{resStatus === 'ok' ? res?.info : resStatus === 'loading' ? 'Reading the latest results…' : `The latest results could not be read (${res?.error || 'error'}) — these rules wait for them (companies are shown as provisional).`}</div>
            {resCount ? <button type="button" className="pnx-btn" style={{ justifySelf: 'start' }} onClick={() => change({ resDays: null, resTier: null, resCb: false })}>Clear result rules</button> : null}
          </Section>

          <Section id="pnx-sec-patterns" title="Pattern types" hint={allOfBias ? ALL_TYPES_TEXT : `${q.ids.length} ticked`} open={sec.patterns} onToggle={() => toggleSec('patterns')}>
            <div className="pnx-note">{allOfBias ? `${ALL_TYPES_TEXT}: none ticked, so every ${q.bias === 'U' ? 'bullish ' : q.bias === 'D' ? 'bearish ' : ''}pattern read on the selected timeframes counts (types marked n/a are not read there).` : 'Companies showing any ticked pattern.'} The number = companies with it under the other choices. Hover a pattern for what it means.</div>
            <span style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6 }}>
              <input value={patFind} onChange={(e) => setPatFind(e.target.value)} placeholder="find a pattern" aria-label="Find a pattern type" className="pnx-in" />
              <button type="button" className="pnx-btn" onClick={() => change({ ids: Array.from(new Set([...q.ids, ...ofBias.filter(patMatchesFind)])) })}>All</button>
              <button type="button" className="pnx-btn" onClick={() => change({ ids: [] })}>Clear</button>
            </span>
            {groups.map((g) => {
              const ids = g.ids.filter(patMatchesFind);
              if (!ids.length) return null;
              return (
                <div key={`${g.bias}-${g.group}`} style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: g.bias === 'bullish' ? C.green : C.red }}>{g.group}{q.bias === 'both' ? (g.bias === 'bullish' ? ' ▲' : ' ▼') : ''}</span>
                  <div className="pnx-chips">
                    {ids.map((id) => {
                      const on = q.ids.includes(id); const n = snap && qRebuild.state !== 'none' ? counts[id] || 0 : null;
                      const more = qRebuild.state === 'partial' ? '+' : '';
                      // zzz1004 (PS-06) — a type the engine does not read on any selected timeframe: disabled with the reason (a
                      // ticked one stays clickable so it can be removed); its count is "n/a", never a zero
                      const ap = chipApplicability(id, q.tfs);
                      return (
                        <button key={id} type="button" aria-pressed={on} disabled={ap.na && !on} onClick={() => toggleId(id)} title={ap.na ? ap.reason : `${PATTERN_META[id].short}${ap.reason ? `\n${ap.reason}` : ''}${qRebuild.state !== 'ok' ? `\n${qRebuild.text}` : ''}`}
                          className={`pnx-pat ${g.bias === 'bullish' ? 'pnx-up' : 'pnx-down'}`} data-zero={n === 0 && !ap.na} data-na={ap.na} data-pat={id}>
                          {PATTERN_META[id].label}<span className="pnx-n" aria-busy={n == null}>{ap.na ? `n/a on ${q.tfs.join('/')}` : n == null ? '…' : `${n}${more}`}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </Section>

          <Section id="pnx-sec-rules" title="Rules" hint={q.filters.length ? `${q.filters.length}` : ''} open={sec.rules} onToggle={() => toggleSec('rules')}>
            {q.filters.length ? (
              <div className="pnx-chips">
                {q.filters.map((f, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 7, border: `1px solid ${ruleEdit === i ? C.accent : C.border}`, background: C.bg, overflow: 'hidden', opacity: f.off ? 0.55 : 1, fontSize: 12.5 }}>
                    <button type="button" onClick={() => setRuleEdit(ruleEdit === i ? null : i)} title={f.off ? 'Paused — not applied. Click to change.' : 'Click to change this rule'} style={{ all: 'unset', cursor: 'pointer', padding: '4px 8px', textDecoration: f.off ? 'line-through' : undefined }}>{f.off ? '⏸ ' : ''}{filterLabel(f, market)}</button>
                    <button type="button" aria-label="Remove rule" onClick={() => { change({ filters: q.filters.filter((_, k) => k !== i) }); setRuleEdit(null); }} style={{ all: 'unset', cursor: 'pointer', padding: '4px 8px', borderLeft: `1px solid ${C.border}` }}>×</button>
                  </span>
                ))}
              </div>
            ) : <div className="pnx-note">No extra rules on this screen.</div>}
            <select value="" onChange={(e) => { if (e.target.value) addRule(e.target.value); }} className="pnx-in" style={{ fontWeight: 650 }} aria-label="Add a rule">
              <option value="">+ Add a rule</option>
              <option value="__cmp">One figure against another (e.g. price ≥ SMA 50)</option>
              {ruleMenu.map((g) => (
                <optgroup key={g.group} label={g.group}>{g.fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.approxNote?.[market] ? ' ≈' : ''}</option>)}</optgroup>
              ))}
            </select>
            {ruleEdit != null && q.filters[ruleEdit] ? (
              <FilterEditor f={q.filters[ruleEdit]} market={market} fields={ruleFields} onChange={(nf) => change({ filters: q.filters.map((x, k) => (k === ruleEdit ? nf : x)) })} onClose={() => setRuleEdit(null)} />
            ) : null}
            <div className="pnx-note">Growth, quality and valuation rules work here too (a company without the figure does not pass; ≈ = approximate figure). Figures this page does not receive are in the <Link href="/stock-screener" className="pnx-link">Stock Screener</Link> — pick one of its screens under Companies to combine it with a chart setup.</div>
          </Section>

          <Section id="pnx-sec-cols" title="Columns" hint={extras.length + q.cols.length ? `${extras.length + q.cols.length} extra` : ''} open={sec.cols} onToggle={() => toggleSec('cols')}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: 12.5 }}>
              <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }} title="The latest earnings result (Earnings Opportunities / Conviction Beats)">
                <input type="checkbox" checked={showRes} onChange={(e) => setShowRes(e.target.checked)} />Latest result
              </label>
              {EXTRAS.map((e) => (
                <label key={e.id} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={has(e.id)} onChange={(ev) => setExtras(ev.target.checked ? [...extras, e.id] : extras.filter((x) => x !== e.id))} />{e.label}
                </label>
              ))}
              {OPTIONAL_COLS.filter((k) => k !== 'rsR').map((k) => (
                <label key={k} title={fieldOf(k)?.label} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={q.cols.includes(k)} onChange={(e) => change({ cols: e.target.checked ? [...q.cols, k] : q.cols.filter((x) => x !== k) })} />
                  {COL_SHORT[k] || fieldOf(k)?.label || k}
                </label>
              ))}
            </div>
          </Section>

          <Section id="pnx-sec-how" title="How the patterns are found" open={sec.how} onToggle={() => toggleSec('how')}>
            <div style={{ display: 'grid', gap: 6, fontSize: 12.5, color: C.dim }}>
              <div>Our own chart-pattern &amp; rule screener — it does not run Pine Script; screens named after your TradingView scripts follow their published rules and are not certified equivalents.</div>
              <div>Each company&apos;s daily history (about 5 years) is read by the screener build as daily candles and, aggregated, as completed weekly and monthly candles, with the same pattern engine as the chart&apos;s pattern line. Definitions follow O&apos;Neil, Minervini and Bulkowski; each rule passed adds to the <b>shape score</b> (0–100: possible ≥ 35, likely ≥ 55, very likely ≥ 75). It measures how closely the shape fits, not a probability of the pattern working.</div>
              <div><b>Stage</b>: forming = no close beyond the pivot yet; breakout = first close beyond it {stageWindowText(q.tfs, 'breakout')}; failed = a close more than 7.5% back through it {stageWindowText(q.tfs, 'failed')} of the break. Each timeframe uses its own candles: a monthly breakout is a monthly close.</div>
              <div><b>To pivot</b>: the scan close against the pivot (the buy point; for bearish patterns the breakdown level) in the pattern&apos;s direction. −5% means 5% short of it.</div>
              <div><b>Strict results</b>: a company is listed only when every rule could be evaluated and passed; the rest are kept apart as provisional. Not advice: a pattern is a starting point for a chart review.</div>
            </div>
          </Section>
          <button type="button" className="pnx-link" style={{ fontSize: 12.5, justifySelf: 'start' }} onClick={() => { setQ(clone({ ...DEFAULT_QUERY, bias: q.bias })); setR40User(false); setDirty(true); }}>Reset every choice</button>
        </aside>}

        {/* ── results ───────────────────────────────────────────────────────────────────────────────────────────── */}
        <section style={{ display: 'grid', gap: 10, minWidth: 0, alignContent: 'start' }} aria-label="Results">
          {view === 'portfolio' ? (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 750 }}>My portfolio check</h2>
                <span className="pnx-note">Every {market === 'IN' ? 'Indian' : 'US'} holding: its chart patterns and how far the close is from the 21, 50 and 200-day averages.</span>
                <span style={{ flex: 1 }} />
                <button type="button" className="pnx-btn" onClick={() => setView('setups')}>Back to setups</button>
              </div>
              <PortfolioCheck items={pfItems} market={market} status={!snap || !hold || (loading && !rows.length) ? 'loading' : hold.status} error={hold?.error || null} source={hold?.source || ''}
                chartHref={(t, tf) => chartUrl(t, market === 'IN' ? 'NSE' : '', tf)} openReview={openPortfolioReview}
                mode={pfMode} onMode={setPfMode} onOpenScreen={(id) => { if (loadScreen(id)) setView('setups'); }} />
            </>
          ) : (
            <>
              <div className="pnx-qhead">
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="pnx-note" data-testid="preset-line">{presetLine(name, dirty)}</span>
                  {snap?.building ? <span style={{ color: C.amber, fontWeight: 650, fontSize: 12 }} title="A screener build for this market is running now">● building</span> : null}
                  <span style={{ flex: 1 }} />
                  <b style={{ fontSize: 13, color: C.text1 }} aria-busy={!snap && !err} data-testid="match-count" data-batch={batchId} data-rows={shown.length}>{!snap ? (err ? '' : 'Loading…') : qRebuild.state === 'none' ? 'Matches cannot be determined yet' : qRebuild.state === 'partial' ? `${hits.length} companies match so far` : `${hits.length} companies match`}</b>
                </div>
                {/* zzz1004 (PS-05) — the ACTIVE query, never a preset name that may contradict it; the preset name sits beside it, smaller */}
                <h2 className="pnx-query" data-testid="active-query">{summary}</h2>
                {/* zzz1011 — eligible / evaluated / matched / unavailable for this screen on this list */}
                {funnel ? <FunnelStrip f={funnel} rebuilding={qRebuild.state === 'none'} /> : <div className="pnx-funnel" aria-hidden>{[0, 1, 2, 3].map((k) => <div key={k}><span className="pnx-skel" style={{ width: 46, height: 16 }} /><span className="pnx-skel" style={{ width: 60, height: 8, marginTop: 4 }} /></div>)}</div>}
              </div>
              {family ? (
                <span role="radiogroup" aria-label={`${family.label} variants`} className="pnx-seg pnx-seg-sm" style={{ width: 'auto', justifySelf: 'start' }}>
                  {family.items.map((it) => <button key={it.presetId} type="button" role="radio" aria-checked={screenId === it.presetId && !dirty} onClick={() => loadScreen(it.presetId)}>{it.label}</button>)}
                </span>
              ) : null}
              {note && !dirty ? <div className="pnx-note" style={{ maxWidth: '90ch' }}>{note}</div> : null}
              {/* zzz1004 (PS-02 / PS-03) — coverage of the SELECTED timeframes within the CURRENT list, each with its own as-of and
                  session state (a provisional daily reading is never called a close) */}
              {showDetails && snap && scopeCov ? (
                <div className="pnx-note" data-testid="coverage" style={{ display: 'grid', gap: 1 }}>
                  {scopeCov.perTf.map((c) => <div key={c.tf} data-tf={c.tf}>{coverageLine(c)}</div>)}
                  <div>{kind === 'all' ? `${scopeCov.inData.toLocaleString('en-US')} companies in the ${market === 'IN' ? 'Indian' : 'US'} data` : `${scopeName}: ${scopeCov.inData} in the data${scopeCov.notInData.length ? `, ${scopeCov.notInData.length} not in the data (${scopeCov.notInData.slice(0, 8).join(', ')}${scopeCov.notInData.length > 8 ? '…' : ''})` : ''}`}{builtAt ? ` · data built ${builtAt.toLocaleString()}` : ''}</div>
                </div>
              ) : null}
              {snap && qRebuild.state !== 'ok' ? (
                <div role="status" data-testid="rebuild-banner" className="pnx-callout" data-tone="warn">
                  <span>⏳ {qRebuild.text}{qRebuild.state === 'none' ? '. The count is not “0 match”: no company of these timeframes has been re-read yet.' : '. Companies not yet re-read cannot match until they are.'}{snap.building ? ' A build is running.' : ''}</span>
                  {qRebuild.perTf.filter((x) => x.state !== 'ok').map((x) => (
                    <span key={x.tf} style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 8, alignItems: 'center', fontSize: 11.5 }} data-rebuild-tf={x.tf}>
                      <span>{tfWord(x.tf)}</span>
                      <span className="pnx-prog" role="progressbar" aria-valuemin={0} aria-valuemax={x.total} aria-valuenow={x.reread} aria-label={`${tfWord(x.tf)} re-read`}><i style={{ width: `${x.total ? Math.round((100 * x.reread) / x.total) : 0}%` }} /></span>
                      <span>{x.total ? Math.round((100 * x.reread) / x.total) : 0}%</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {naNotice.length ? (
                <div role="status" data-testid="unsupported-notice" className="pnx-callout" data-tone="warn">
                  {naNotice.map((t, i) => <div key={i}>✕ {t}</div>)}
                </div>
              ) : null}
              {err ? <div role="alert" style={{ color: C.red, fontSize: 13 }}>{err}{snap ? ' — showing the last loaded data' : ''}</div> : null}
              {showDetails && scope && listTickers ? (
                <div className="pnx-note">Limited to <b style={{ color: C.text1 }}>{scopeName}</b> ({scopeWaiting ? 'loading…' : kind === 'cb' ? `${listTickers.size} names on the bench, any market — ${scopeCov?.inData ?? 0} in the ${market === 'IN' ? 'Indian' : 'US'} data` : `${listTickers.size} ${market === 'IN' ? 'Indian' : 'US'} ${listTickers.size === 1 ? 'company' : 'companies'}`}){kind === 'stock' && stockData[market]?.error ? <span style={{ color: C.red }}> — {stockData[market]!.error}</span> : null} · <button type="button" className="pnx-link" onClick={() => setScope('')}>show every company</button></div>
              ) : null}

              {/* toolbar */}
              <div className="pnx-tools">
                <SearchBox value={findText} onChange={setFindText} inputRef={searchRef} placeholder="Find ticker or name" label="Find in results" />
                {findText ? <button type="button" className="pnx-btn" onClick={() => setFindText('')}>Clear search</button> : null}
                <span style={{ flex: 1 }} />
                <button type="button" className="pnx-btn" onClick={copyTickers} disabled={!actHits.length} title={`${actLabel} — ${market === 'IN' ? 'NSE:TICKER, comma separated' : 'tickers, comma separated'}, to paste into a TradingView watchlist`}>Copy for TradingView</button>
                <button type="button" className="pnx-btn" onClick={downloadCsv} disabled={!actHits.length} title={`Exports ${actLabel}`}>Download CSV</button>
                <button type="button" className="pnx-btn" onClick={() => setAdding((v) => !v)} disabled={!actHits.length || !watchlists}>Add to watchlist</button>
                <button type="button" className="pnx-btn" disabled={loading} onClick={() => setRefresh((v) => v + 1)}>{loading ? 'Refreshing…' : err ? 'Retry' : 'Refresh'}</button>
              </div>
              <div className="pnx-meta">
                <button type="button" className="pnx-link" data-testid="pine-details-toggle" aria-expanded={showDetails} onClick={toggleDetails}
                  title={showDetails ? 'Hide the coverage, list and count lines' : 'Show coverage (scanned / not in the data / data built), the company list in use, result counts and what the actions apply to'}>{showDetails ? 'ⓘ Hide details' : 'ⓘ Details'}</button>
                {showDetails ? (snap ? <span data-testid="result-counts">{countsLine(sCounts, searching)}{sCounts.provisional ? ` · ${sCounts.provisional} provisional (not counted)` : ''}</span> : <span aria-busy="true">Loading counts…</span>) : null}
                {showDetails || selected.size || searching ? <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} title="Which companies Copy, CSV, Add to watchlist and the chart review queue act on">Actions apply to
                  <select value={scopeNow} onChange={(e) => setActScope(e.target.value as ActionScope)} className="pnx-in" style={{ width: 'auto', padding: '3px 6px' }} aria-label="Action scope">
                    <option value="results">{scopeLabel('results', sCounts, searching)}</option>
                    {searching ? <option value="all">{scopeLabel('all', sCounts, searching)}</option> : null}
                    {sCounts.selected ? <option value="selected">{scopeLabel('selected', sCounts, searching)}</option> : null}
                    {sCounts.provisional ? <option value="provisional">{scopeLabel('provisional', sCounts, searching)}</option> : null}
                  </select>
                </label> : null}
                {selected.size ? <button type="button" className="pnx-btn" style={{ padding: '3px 8px' }} onClick={() => setSelected(new Set())}>Clear selection ({sCounts.selected})</button> : null}
                <span style={{ flex: 1 }} />
                <span role="radiogroup" aria-label="Row density" className="pnx-seg" style={{ width: 'auto' }}>
                  {(['comfortable', 'compact'] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={density === d} style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setDensity(d)}>{d === 'comfortable' ? 'Comfortable' : 'Compact'}</button>)}
                </span>
              </div>
              {adding && watchlists ? (
                <div role="dialog" aria-label="Add to watchlist" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 10, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                  <label>Destination <select aria-label="Watchlist for pattern matches" value={targetList || activeList(watchlists).id} onChange={(e) => setTargetList(e.target.value)} className="pnx-in" style={{ width: 'auto' }}>{watchlists.lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({listCount(l)})</option>)}</select></label>
                  <span className="pnx-note">{confirmAddText(actHits.length, (watchlists.lists.find((l) => l.id === targetList) || activeList(watchlists)).name, actLabel)}</span>
                  <button type="button" className="pnx-btn" data-on="true" onClick={addMatches}>Add symbols</button>
                  <button type="button" className="pnx-btn" onClick={() => setAdding(false)}>Cancel</button>
                </div>
              ) : null}
              {watchlistSaveError ? <div role="alert" style={{ color: C.amber }}>{watchlistSaveError} <button type="button" className="pnx-btn" onClick={retryWatchlistSave}>Retry watchlist save</button></div> : null}
              {notScanned || snap?.notes.length || tfWarn.length ? <div data-testid="scan-notes" style={{ fontSize: 12.5, color: C.amber, display: 'grid', gap: 2 }}>{[...(snap?.notes.length ? snap.notes : notScanned ? ['Chart patterns are read during the screener build; the next build adds them.'] : []), ...tfWarn].map((n, i) => <div key={i}>⏳ {n}</div>)}</div> : null}
              {/* zzz994 (MC-07) — never "next build fills it" for a figure this page cannot receive */}
              {unsupported.length || pending.length || unscannedTfs.length || (notScanned && q.need !== 'any') ? (
                <div role="status" className="pnx-callout" data-tone="warn">
                  {unsupported.map((c) => <div key={c.key}>✕ <b>{c.label}</b>: {c.status === 'unsupported-market' ? `not available for ${market === 'US' ? 'US' : 'Indian'} companies` : 'not delivered to the Pine Screener'} — this rule cannot be evaluated here, so no company passes it strictly. Use the Stock Screener for it, or remove the rule.</div>)}
                  {pending.map((c) => <div key={c.key}>⏳ <b>{c.label}</b>: no company has this figure yet{snap?.building ? ' (a build is running now)' : ' (it is filled by the screener build)'} — companies are held as provisional, not counted as matches.</div>)}
                  {unscannedTfs.map((tf) => <div key={tf}>⏳ <b>{tf === 'W' ? 'Weekly' : tf === 'M' ? 'Monthly' : 'Daily'} patterns</b>: not scanned yet — {q.tfMode === 'all' || q.tfs.length === 1 ? 'no company can pass until it is' : 'only the other selected timeframes can match meanwhile'}. Daily patterns are never relabelled as {tf === 'W' ? 'weekly' : tf === 'M' ? 'monthly' : 'other'}.</div>)}
                  {notScanned && q.need !== 'any' ? <div>⏳ Chart patterns have not been scanned for this market yet — the pattern requirement cannot be evaluated; every company is provisional.</div> : null}
                </div>
              ) : null}
              {snap && q.need !== 'any' && !q.stages.length ? <div role="status" className="pnx-callout" data-tone="warn" data-testid="no-stage">No stage selected. {NO_STAGE_TEXT} The empty result is not evidence that no company has a pattern.{stagesDiffer(screenId, q.stages) ? <> <button type="button" className="pnx-btn" onClick={() => change({ stages: presetStages(screenId) || DEFAULT_QUERY.stages.slice() })}>Restore preset stages</button></> : null}</div> : null}
              {empty === 'no-search-match' ? (
                <div role="status" style={{ padding: 10, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13 }}>
                  No match contains “{findText}” — {sorted.length} companies pass the screen. <button type="button" className="pnx-btn" onClick={() => setFindText('')}>Clear search</button>
                </div>
              ) : null}

              <div className="pnx-wrap" ref={wrapRef}>
                <table key={batchId} data-batch={batchId} className="pnx-table" style={{ fontSize: density === 'compact' ? 12.5 : 13 }}>
                  <thead>
                    <tr>
                      <th className="pnx-pin">
                        <span style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}>
                          <span aria-hidden style={{ width: 20 }} />
                          <input type="checkbox" aria-label="Select every shown row" checked={allShownSel} onChange={(e) => setSelected((s) => { const n = new Set(s); for (const h of shown) { if (e.target.checked) n.add(h.row.t); else n.delete(h.row.t); } return n; })} />
                          <span title={starList ? `★ = on ${starList.name}; click to add / remove` : 'Watchlists'}>★</span>
                          <Th bare label="Company" k="t" sort={sort} setSort={setSort} />
                        </span>
                      </th>
                      <Th label="Setup" k="pattern" sort={sort} setSort={setSort} title="The strongest matching pattern, its analysis timeframe (D / W / M) and its historical event (breakout / breakdown / failed). Stage, score and distance all come from this one reading." />
                      <Th label="Condition" k="cond" sort={sort} setSort={setSort} title="The latest condition on the analysis close, apart from the event: forming · crossed (< 0.5% past) · holding · retesting (quote back within ±1.5%) · back inside · invalidated · expired reading" />
                      <Th label="Shape score" k="conf" sort={sort} setSort={setSort} num title={SHAPE_SCORE_TIP} />
                      <Th label="Pivot" k="pivot" sort={sort} setSort={setSort} num title="The buy point (bearish: the breakdown level)" />
                      <Th label="To pivot" k="dist" sort={sort} setSort={setSort} num title="Pattern distance: the ANALYSIS close against the pivot, in the pattern's direction (− = not reached yet, + = beyond it). The gauge: filled dot = analysis close, ring = latest quote, shaded = the 0 to +5% entry window." />
                      <Th label="Length" k="len" sort={sort} setSort={setSort} num className="pnx-hide-md" />
                      <Th label="Analysis close" k="anClose" sort={sort} setSort={setSort} num title="The close the pattern was read on, on its own timeframe (daily session / completed week / completed month) — stage, condition and To pivot use it. Never the daily close under a W / M reading." />
                      <Th label="Quote" k="px" sort={sort} setSort={setSort} num title="Latest quote, with its own source and time — a separate observation from the analysis close" />
                      <th className="pnx-hide-sm" title="12-month price path from the stored performance figures (−12M, −6M, −3M, −1M, −1W, now)">12M</th>
                      <th className="pnx-num" title="The daily technical close against its 21, 50 and 200-day simple moving averages, % (same daily bars). Click to sort by the 50-day.">
                        <Th bare label={<span style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(3, 3.6em)', gap: 4, justifyItems: 'end' }}><span>21d</span><span>50d</span><span>200d</span></span>} k="ma50" sort={sort} setSort={setSort} num />
                      </th>
                      <Th label="RS" k="rsR" sort={sort} setSort={setSort} num title="RS Rating 1–99 (IBD-style), ranked against every company of this market" />
                      {showRes ? (
                        <th data-col="result" title="The latest earnings result: quarter · filing date · days since · grade (Earnings Opportunities) · sales and profit year on year. 🏆 = on the Conviction Beats bench. Sort by date or by grade.">
                          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
                            <Th bare label="Latest result" k="resD" sort={sort} setSort={setSort} num title="Sort by the result's filing date" />
                            <Th bare label="grade" k="resG" sort={sort} setSort={setSort} num title="Sort by the result's grade (then date)" />
                          </span>
                        </th>
                      ) : null}
                      {shownCols.map((k) => <Th key={k} label={COL_SHORT[k] || fieldOf(k)?.label || k} k={k} sort={sort} setSort={setSort} num title={[fieldOf(k)?.label, fieldOf(k)?.approxNote?.[market] ? `≈ ${fieldOf(k)!.approxNote![market]}` : '', k === 'r40' ? `${R40_FORMULA}. ${R40_GUARD_TIP}` : ''].filter(Boolean).join('\n')} />)}
                      {has('chg') ? <Th label="Chg" k="chg" sort={sort} setSort={setSort} num title="Change today" /> : null}
                      {has('mc') ? <Th label="Mkt cap" k="mc" sort={sort} setSort={setSort} num /> : null}
                      {has('perf') ? <Th label={`Perf ${PERF_LABEL[q.perfKey]}`} k={q.perfKey} sort={sort} setSort={setSort} num /> : null}
                      {has('rsi') ? <Th label="RSI" k="rsi" sort={sort} setSort={setSort} num /> : null}
                      {has('turn') ? <Th label="Daily value" k="turn" sort={sort} setSort={setSort} num /> : null}
                      <Th label="Sector" k="tvSec" sort={sort} setSort={setSort} className="pnx-hide-lg" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((h, i) => {
                      const { row: r, tags, best: b } = h;
                      const dd = b ? dirDist(b) : null;
                      const dq = b && typeof (b as any).dq === 'number' ? (b.b === 'U' ? (b as any).dq : -(b as any).dq) as number : null;
                      const sel = selected.has(r.t);
                      const noD = patTagsOf(r, 'D') == null;
                      const open = expanded === r.t;
                      const ma = maPosition(r);
                      const an = analysisOf(r, b || { tf: 'D' });
                      const conds = latestConditions(r, b);
                      const cs = b ? conditionState(r, b) : null;
                      const ev = b ? (b.s === 'b' ? (b.b === 'U' ? 'broke out' : 'broke down') : b.s === 'x' ? 'failed' : '') : '';
                      return (
                        <React.Fragment key={r.t}>
                          <tr className="pnx-row" data-sel={sel} data-idx={i} data-cursor={cursor === i} onClick={(e) => { if ((e.target as HTMLElement).closest('a, button, input, select, label')) return; setCursor(i); }}>
                            <td className="pnx-pin">
                              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <button type="button" className="pnx-exp" aria-expanded={open} aria-label={`Details for ${r.t}`} title="Why this company is listed — pattern, checks, prices, other timeframes (o)" onClick={() => { setExpanded(open ? null : r.t); setCursor(i); }}>▸</button>
                                <input type="checkbox" checked={sel} onChange={() => toggleSel(r.t)} aria-label={`Select ${r.t}`} />
                                <button type="button" onClick={() => toggleStar(r)} disabled={!starList} aria-pressed={onStar(r)} aria-label={`${onStar(r) ? 'Remove' : 'Add'} ${r.t} ${onStar(r) ? 'from' : 'to'} ${starList?.name || 'watchlist'}`}
                                  title={starList ? `${onStar(r) ? 'On' : 'Add to'} ${starList.name}` : ''} style={{ all: 'unset', cursor: starList ? 'pointer' : 'default', fontSize: 14, lineHeight: 1, color: onStar(r) ? C.amber : C.faint }}>{onStar(r) ? '★' : '☆'}</button>
                                <span style={{ minWidth: 0 }}>
                                  <span style={{ display: 'flex', alignItems: 'baseline' }}>
                                    <span className="pnx-rank">{i + 1}</span>
                                    <Link data-ticker={r.t} className="pnx-tk" href={`/charts?t=${encodeURIComponent(r.t)}&m=${market}&tf=${b?.tf || 'D'}`} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); window.location.assign(openForReview(r, b?.tf || 'D')); }}
                                      title={`${r.n || r.t} — open the ${tfWord(b?.tf)} chart (Enter). Next / Previous on the chart step through these results in this order`}>{r.t}</Link>
                                    {an.session === 'provisional' ? <span data-provisional title={`Read during a trading session: ${sessionLabel(an)} — the latest bar was unfinished, not a completed close`} style={{ color: C.amber, marginLeft: 4 }}>◷</span> : null}
                                  </span>
                                  {density === 'compact' ? null : <div className="pnx-co" style={{ paddingLeft: 'calc(1.8em + 6px)' }} title={r.n}>{r.n}</div>}
                                </span>
                              </span>
                            </td>
                            {b ? (
                              <>
                                <td>
                                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                    <PatternChip t={b} main market={market} when={sessionLabel(an)} />
                                    {ev ? <span className="pnx-note" data-event={b.s} title={cs?.event.label}>{ev}</span> : null}
                                    {tags.length > 1 ? <span style={{ fontSize: 11, color: C.dim }} title={tags.filter((t) => t !== b).map((t) => `${PATTERN_META[t.id].label} [${t.tf || 'D'}] ${stageWord(t)}, ${t.c}`).join('\n')}>+{tags.length - 1}</span> : null}
                                  </span>
                                </td>
                                <td>
                                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                    {cs ? <ConditionChip c={cs} /> : null}
                                    <ConditionBadges items={conds} compact />
                                  </span>
                                </td>
                                <td className="pnx-num"><ScoreBar c={b.c} /></td>
                                <td className="pnx-num" title={`Exact: ${fmtExact(b.p)}`}>{fmtPrice(b.p, market)}</td>
                                <td className="pnx-num" style={{ color: dd == null ? C.dim : dd >= 0 ? (b.b === 'U' ? C.green : C.red) : C.text, fontWeight: 650 }}
                                  title={[b.d == null ? '' : `Pattern distance: ${tfWord(an.tf)} analysis close ${an.close != null ? fmtPrice(an.close, market) : '(not stored)'} is ${Math.abs(b.d).toFixed(2)}% ${b.d < 0 ? 'below' : 'above'} the ${b.b === 'U' ? 'pivot' : 'breakdown level'} — ${sessionLabel(an)}`,
                                    dq != null ? `Latest quote distance: ${pct(dq, 2)}${r.pxSrc ? ` (${r.pxSrc}${r.pxAt ? `, ${r.pxAt}` : ''})` : ''} — a separate observation; the filter uses the analysis close` : ''].filter(Boolean).join('\n')}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end' }}>
                                    <span className="pnx-hide-sm"><PivotGauge dd={dd} dq={dq} /></span>
                                    <span style={{ minWidth: '3.6em' }}>{pct(dd)}{dq != null && dd != null && Math.abs(dq - dd) >= 0.15 ? <span style={{ color: C.amber }}>†</span> : null}</span>
                                  </span>
                                </td>
                                <td className="pnx-num pnx-hide-md" title={[lengthTip(b), b.dp != null ? `${b.dp}% deep` : ''].filter(Boolean).join('\n')}>{tagLengthText(b) || '—'}</td>
                              </>
                            ) : <td colSpan={6} style={{ color: C.dim, fontSize: 12 }}>{noD ? patMissingWhy(r, 'D') : 'no matching chart pattern'}</td>}
                            <td className="pnx-num" data-analysis-close title={scanTip(h, market)}>
                              {an.close != null ? <>{fmtPrice(an.close, market)}<span className="pnx-dim" style={{ fontSize: 10.5, marginLeft: 3 }}>{an.tf}</span></> : <span className="pnx-unknown">{b ? 'n/a' : '—'}</span>}
                            </td>
                            <td className="pnx-num" title={`Latest quote ${fmtExact(r.px)}${r.pxSrc ? ` (${r.pxSrc}${r.pxAt ? `, ${r.pxAt}` : ''})` : ''}\n\n${scanTip(h, market)}`} style={{ color: pxDiffers(h) ? C.text : C.text1 }}>
                              {r.pxConflict ? <span style={{ color: C.amber }} aria-label="Price sources disagree">⚠ </span> : null}
                              {r.pxLive ? <span style={{ color: C.amber }} data-px-live aria-label="Live, unfinished session" title="Today's unfinished daily bar (Nasdaq's list was a session behind) — provisional, not a completed close">◷ </span> : null}{fmtPrice(r.px, market)}
                            </td>
                            <td className="pnx-hide-sm"><Sparkline pts={perfPath(r)} /></td>
                            <td className="pnx-num"><MaCell ma={ma} market={market} /></td>
                            <td className="pnx-num">{typeof r.rsR === 'number' ? <b style={{ color: r.rsR >= 80 ? C.green : r.rsR < 30 ? C.red : C.text1, fontWeight: 650 }}>{r.rsR}</b> : <span className="pnx-dim">—</span>}</td>
                            {showRes ? (resStatus === 'error' ? <td data-col="result" className="pnx-dim" title={`The latest results could not be read (${res?.error || 'error'})`}>n/a</td>
                              : <LatestResultCell lr={(r as any).lr} market={market} today={resToday} loading={resStatus === 'loading'} />) : null}
                            {shownCols.map((k) => {
                              const d = fieldOf(k); const ax = r.approx?.includes(k);
                              // zzz1007 — a guard-blanked Rule of 40 is shown blank with the reason (never the meaningless sum)
                              // zzz1011 — a Rule of 40 with a missing input says "unknown" (never 0, never a pass)
                              if (k === 'r40') {
                                const x = r40Explain(r, q.r40Min);
                                return <td key={k} className="pnx-num" data-col={k} data-r40={x.state} title={`${R40_FORMULA}\n${x.text}${ax ? `\nApproximate — ${d?.approxNote?.[market] || ''}` : ''}`}>
                                  {x.state === 'unknown' ? <span className="pnx-unknown">unknown</span> : x.state === 'guarded' ? <span className="pnx-unknown">n/m</span> : <>{ax ? '≈' : ''}{fmtCol(k, x.value, market)}</>}
                                </td>;
                              }
                              const v = (r as any)[k] as number | null | undefined;
                              return <td key={k} className="pnx-num" data-col={k} title={[d?.label, typeof v === 'number' ? `Exact: ${fmtExact(v)}` : '', ax ? `Approximate — ${d?.approxNote?.[market] || ''}` : ''].filter(Boolean).join('\n')}>{ax && v != null ? '≈' : ''}{fmtCol(k, v, market)}</td>;
                            })}
                            {has('chg') ? <td className="pnx-num" style={{ color: signColor(r.chg) }}>{pct(r.chg)}</td> : null}
                            {has('mc') ? <td className="pnx-num" title={`Exact: ${fmtExact(r.mc)} ${money}`}>{fmtMoney(r.mc, market)}</td> : null}
                            {has('perf') ? <td className="pnx-num" style={{ color: signColor(r[q.perfKey] as number | null | undefined) }}>{pct(r[q.perfKey] as number | null | undefined, 0)}</td> : null}
                            {has('rsi') ? <td className="pnx-num">{typeof r.rsi === 'number' ? Math.round(r.rsi) : '—'}</td> : null}
                            {has('turn') ? <td className="pnx-num" title={`price × 30-day average volume, ${money}`}>{fmtMoney(turnoverOf(r, market), market)}</td> : null}
                            <td className="pnx-hide-lg" style={{ fontSize: 12, color: C.dim, maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.tvSec || r.sec || ''}>{r.tvSec || r.sec || '—'}</td>
                          </tr>
                          {open ? (
                            <tr className="pnx-detail"><td colSpan={colCount}>
                              <HitDetail hit={h} q={q} market={market} width={wrapW} results={resStatus} onOpenChart={(tf, tag) => window.location.assign(openForReview(r, tf, tag))} />
                            </td></tr>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                    {!snap && !err ? <SkeletonRows cols={colCount} /> : null}
                  </tbody>
                </table>
                {narrowed.length > 200 ? <div style={{ padding: 8, textAlign: 'center' }}><button type="button" className="pnx-btn" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show the first 200' : `Show all ${narrowed.length}`}</button></div> : null}
                {empty === 'no-data' ? (
                  <div role="status" style={{ padding: 16, color: C.dim, fontSize: 13 }}>{snap?.building ? 'The first build of this market is running — companies appear here when it finishes.' : 'No companies in the stored data yet.'}</div>
                ) : empty === 'no-filter-match' ? (
                  <div role="status" style={{ padding: 16, color: C.dim, fontSize: 13 }}>
                    {scopeWaiting ? `Loading ${scopeName}…`
                      : scope && listTickers && !listTickers.size ? `${scopeName} has no ${market === 'IN' ? 'Indian' : 'US'} companies — switch market or list.`
                      : q.need !== 'any' && !q.stages.length ? `No stage selected. ${NO_STAGE_TEXT}`
                      : qRebuild.state === 'none' ? `${qRebuild.text}. The pattern part cannot be evaluated until the companies are re-read — this is not a “no match”.`
                      : `No company matches every choice.${provHits.length ? ` ${provHits.length} could not be fully evaluated (see Provisional below).` : ''} Widen the distance to pivot, lower the shape score, add a stage or untick pattern types — the number on each pattern type shows where the matches are.`}
                  </div>
                ) : null}
              </div>
              {provHits.length ? (
                <details style={{ fontSize: 12.5, border: `1px dashed ${C.amber}`, borderRadius: 10, padding: '6px 10px' }}>
                  <summary style={{ cursor: 'pointer', color: C.amber }}>Provisional — {provHits.length} {provHits.length === 1 ? 'company' : 'companies'} not counted: a rule could not be evaluated ({Array.from(new Set(provHits.flatMap((x) => x.missing || []))).slice(0, 3).join('; ')}{new Set(provHits.flatMap((x) => x.missing || [])).size > 3 ? '…' : ''})</summary>
                  <div style={{ color: C.dim, margin: '4px 0' }}>These passed every rule that could be checked. They are not matches; bulk actions use them only when you choose the “Provisional” scope.</div>
                  <ul style={{ margin: '4px 0 0 16px', columns: 2, columnGap: 24 }}>
                    {scopeSets.provisional.slice(0, 60).map((x) => <li key={x.row.t}><b>{x.row.t}</b> <span style={{ color: C.dim }}>— not evaluated: {(x.missing || []).join('; ')}</span></li>)}
                  </ul>
                  {provHits.length > 60 ? <div style={{ color: C.dim }}>… and {provHits.length - 60} more (download them with the Provisional scope).</div> : null}
                </details>
              ) : null}
              {/* zzz1004 (PS-04) — every list member that is not a match, with the reason (no pattern / not scanned / not in the data /
                  which rule excluded it) — a portfolio screen shows every holding, matched or not */}
              {listCov && listCov.length ? (
                <details open={kind === 'portfolio'} data-testid="list-coverage" style={{ fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 10px' }}>
                  <summary style={{ cursor: 'pointer', color: C.text2, fontWeight: 700 }}>{scopeName}: {listCov.length} of {listTickers?.size} not listed — coverage rows</summary>
                  <ul style={{ listStyle: 'none', margin: '6px 0 0', paddingLeft: 0, display: 'grid', gap: 4 }}>
                    {listCov.map((w) => (
                      <li key={w.ticker} data-coverage-row={w.ticker}>
                        <details><summary style={{ cursor: 'pointer' }}>{w.headline}</summary><div style={{ padding: '4px 0 6px 14px' }}><WhyResultView w={w} /></div></details>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {snap ? <WhyNot rows={rows} q={q} market={market} list={kind === 'all' ? null : listTickers} listName={scopeName} run={run} /> : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
