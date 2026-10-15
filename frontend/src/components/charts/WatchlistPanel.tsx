'use client';
// zzz940 — the watchlist panel on the right of /charts (TradingView-style): lists with sections, Symbol / Last / Chg%
// columns with sorting, coloured flags, ↑/↓ to flip through charts, import / export in TradingView's text format.
// Lists live in localStorage 'mc:chart-watchlists:v1' and sync to the owner's database (user-vault-keys).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cleanTicker, fmtPrice, validTicker, type Market } from '@/lib/chart-math';
import {
  CHART_WATCHLISTS_KEY, FLAGS, FLAG_COLORS, activeList, addItem, addList, addSection, findItem, flatRows, importParsed, importTvBundle, parseTvBundle, itemKey,
  listCount, moveItem, nextFlag, nextSort, parseTradingView, patchItem, patchSection, removeItem, removeList, removeSection,
  renameList, sanitizeStore, seedStore, serializeTradingView, stepRow, updateList, viewRows, visibleSections,
  copyItemToNewList, copySymbolText, moveItemToNewSection, removedFrom, restoreItem, type RemovedItem,
  type Flag, type Quote, type SortState, type WlItem, type WlList, type WlStore,
} from '@/lib/chart-watchlist';
import { pollWhenVisible } from '@/lib/client-fetch';
import { refreshedQuotes } from '@/lib/chart-refresh';
import { sharedFetchJson } from '@/lib/tab-shared-fetch';
import { neighbourOrder } from '@/lib/chart-load-cache';
import { PANEL_CSS } from './watchlist-panel-css';
import WatchlistManageDrawer from './WatchlistManageDrawer';
import { ChartContextMenu } from './ChartContextMenu';
import { applyRowMenu, applySectionMenu, chartHref, newsHref, watchlistRowMenu, watchlistSectionMenu } from './watchlist-context-menu';
import { useBookWatchlistSync, readBook } from './useBookWatchlistSync';
import { BOOK_LABEL, BOOK_SECTION_NAME, bookSectionMenu, createLinkedSection, linkSection, linkTooltip, linkedSection, previewLinkRemovals, unlinkSection } from '@/lib/watchlist-book-sync';
import { agoLabel, currencyOf, displaySectionName, exchangeLabel, quoteFreshness, usExtendedSession, WIDTH_PRESETS, WL_EXT_COLUMN_KEY } from '@/lib/watchlist-display';
import { chartListSource } from '@/lib/watchlist-compare';   // zzz1045d — each list says where it comes from

// ── storage hook ──────────────────────────────────────────────────────────────
function readJson(key: string): unknown {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}
function loadOrSeed(): WlStore {
  let raw: string | null = null;
  try { raw = localStorage.getItem(CHART_WATCHLISTS_KEY); } catch { /* blocked storage */ }
  if (raw) { try { return sanitizeStore(JSON.parse(raw)); } catch { /* fall through to seed */ } }
  return seedStore(readJson('mc_watchlist_tickers'), readJson('mc_portfolio_holdings'));
}

/** The owner's chart watchlists: read once (seeded on the very first visit), saved on every change, reloaded when another
 *  tab or device changes them. */
export function useWatchlistStore(): [WlStore | null, (fn: (s: WlStore) => WlStore) => void, string | null, () => void] {
  // rendered in the browser only (the /charts workspace is loaded with ssr:false), so storage is read on first render
  const [store, setStore] = useState<WlStore | null>(() => (typeof window === 'undefined' ? null : loadOrSeed()));
  const lastWritten = useRef<string>('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const unsavedRef = useRef(false);
  useEffect(() => {
    const reload = () => {
      if (unsavedRef.current) return; // keep local unsaved edits until they are saved or the page is deliberately reopened
      let raw: string | null = null;
      try { raw = localStorage.getItem(CHART_WATCHLISTS_KEY); } catch { return; }
      if (!raw || raw === lastWritten.current) return;
      try { lastWritten.current = raw; setStore(sanitizeStore(JSON.parse(raw))); } catch { /* ignore bad copy */ }
    };
    const onStorage = (e: StorageEvent) => { if (e.key === CHART_WATCHLISTS_KEY) reload(); };
    const onRestored = (e: Event) => { const keys = (e as CustomEvent).detail?.keys; if (!Array.isArray(keys) || keys.includes(CHART_WATCHLISTS_KEY)) reload(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mc:vault:restored', onRestored);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('mc:vault:restored', onRestored); };
  }, []);
  useEffect(() => {
    if (!store) return;
    const json = JSON.stringify(store);
    if (json === lastWritten.current) return;
    try {
      localStorage.setItem(CHART_WATCHLISTS_KEY, json);
      lastWritten.current = json; unsavedRef.current = false; setSaveError(null);
    } catch {
      unsavedRef.current = true;
      setSaveError('Watchlist changes are not saved. Storage is full or blocked. Keep this page open and retry, or export the list.');
    }
  }, [store, saveAttempt]);
  const update = useCallback((fn: (s: WlStore) => WlStore) => setStore((s) => (s ? fn(s) : s)), []);
  return [store, update, saveError, () => setSaveAttempt((n) => n + 1)];
}

// ── quotes ────────────────────────────────────────────────────────────────────
function useQuotes(keys: string[]): Record<string, Quote> {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const sig = keys.join(',');
  useEffect(() => {
    if (!sig) return;
    let ctrl: AbortController | null = null;
    const load = () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const all = sig.split(',');
      const chunks: string[][] = [];
      for (let i = 0; i < all.length; i += 300) chunks.push(all.slice(i, i + 300));
      const signal = ctrl.signal;
      // zzz969 — shared with the other open tabs (one request per URL for all of them)
      Promise.all(chunks.map((c) => sharedFetchJson<any>(`/api/v1/chart-quotes?s=${encodeURIComponent(c.join(','))}`, 50_000, signal).catch(() => null)))
        .then((res) => {
          if (signal.aborted) return;
          const next: Record<string, Quote> = {};
          for (const j of res) if (j?.quotes) Object.assign(next, j.quotes);
          setQuotes((prev) => refreshedQuotes(prev, next, all));
        });
    };
    const stop = pollWhenVisible(load, 60_000, { runImmediately: true });
    return () => { stop(); ctrl?.abort(); };
  }, [sig]);
  return quotes;
}

/** zzz1013 — the newest quote is over 3 minutes old (refreshes run every minute while the page is visible). */
const quotesOld = (at: number) => Date.now() - at > 180_000;

// ── small pieces ──────────────────────────────────────────────────────────────
// zzz1006 — styles live in a sibling module (shared with "+ Watchlist" on the chart header)

const inputStyle: React.CSSProperties = { padding: '4px 6px', borderRadius: 4, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-0)', fontSize: 13, minWidth: 0 };
const smallBtn: React.CSSProperties = { padding: '3px 8px', borderRadius: 4, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)', fontSize: 12, cursor: 'pointer' };

function FlagDot({ flag, size = 10 }: { flag?: Flag; size?: number }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: 2, background: flag ? FLAG_COLORS[flag] : 'transparent', border: flag ? 'none' : '1px dashed var(--mc-border-2)' }} />;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${name.replace(/[^\w\- ]+/g, '').trim() || 'watchlist'}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── import dialog ─────────────────────────────────────────────────────────────
function ImportDialog({ store, update, onClose }: { store: WlStore; update: (fn: (s: WlStore) => WlStore) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('Imported list');
  const [mode, setMode] = useState<'new' | 'append'>('new');
  const [msg, setMsg] = useState<string | null>(null);
  const bundle = useMemo(() => (text.trim().startsWith('{') ? parseTvBundle(text) : null), [text]);
  const preview = useMemo(() => (text.trim() && !bundle ? parseTradingView(text) : null), [text, bundle]);
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 3_000_000) { setMsg('That file is too big for a watchlist (over 3 MB).'); return; }
    f.text().then((t) => { setText(t); setName(f.name.replace(/\.(txt|csv|json)$/i, '').slice(0, 60) || 'Imported list'); }).catch(() => setMsg('Could not read that file.'));
  };
  const run = () => {
    if (bundle) {
      if (!bundle.lists.length) { setMsg('That file has no lists.'); return; }
      update((s) => importTvBundle(s, bundle).store);
      onClose();
      return;
    }
    if (!preview || !preview.count) { setMsg('No symbols found. TradingView lists look like: ###SECTION,NSE:TCS,NASDAQ:AKAM'); return; }
    update((s) => importParsed(s, preview, mode === 'new' ? { mode: 'new', name } : { mode: 'append', listId: s.activeId }));
    onClose();
  };
  return (
    <div role="dialog" aria-label="Import a watchlist" style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflow: 'auto', background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)', border: '1px solid var(--mc-border-1)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--mc-text-0)' }}>Import a TradingView watchlist</div>
        <div style={{ color: 'var(--mc-text-3)' }}>In TradingView: watchlist menu → Export list. Upload that .txt file here, or paste its text. An all-lists .json file (every list at once) also works.</div>
        <input type="file" accept=".txt,.csv,.json,text/plain,application/json" aria-label="Watchlist file" onChange={(e) => onFile(e.target.files?.[0])} />
        <textarea aria-label="Watchlist text" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="###SECTION,NSE:TATVA,NSE:BBOX,###US,NASDAQ:AKAM"
          style={{ ...inputStyle, fontFamily: 'ui-monospace, Menlo, monospace', resize: 'vertical' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> New list named
          </label>
          <input aria-label="New list name" value={name} onChange={(e) => setName(e.target.value)} disabled={mode !== 'new'} style={{ ...inputStyle, width: 180 }} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> Add to “{activeList(store).name}”
          </label>
        </div>
        {bundle && (() => { const r = importTvBundle(store, bundle); return (
          <div style={{ color: 'var(--mc-text-2)' }}>
            All-lists file: {r.lists} list{r.lists === 1 ? '' : 's'}, {r.symbols} symbols, {r.flagged} coloured flags.
            {r.replaced > 0 && <> {r.replaced} list{r.replaced === 1 ? '' : 's'} with the same name will be replaced; your other lists stay.</>}
            {r.skipped > 0 && <> Skipped {r.skipped} rows this page does not chart (indices like TVC:GOLD, FRED, ECONOMICS, other countries).</>}
          </div>); })()}
        {preview && (
          <div style={{ color: 'var(--mc-text-2)' }}>
            Found {preview.count} symbol{preview.count === 1 ? '' : 's'} in {preview.sections.length} section{preview.sections.length === 1 ? '' : 's'}.
            {preview.skipped > 0 && <> Skipped {preview.skipped} with an exchange this page does not chart (e.g. {preview.skippedExamples.join(', ')}).</>}
            {preview.bseCodes > 0 && <> {preview.bseCodes} BSE number code{preview.bseCodes === 1 ? '' : 's'}: kept, but prices and charts usually do not load for BSE codes — use the NSE symbol where there is one.</>}
          </div>
        )}
        {msg && <div style={{ color: 'var(--mc-bearish, #DC2626)' }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={smallBtn} onClick={onClose}>Cancel</button>
          <button type="button" style={{ ...smallBtn, background: 'var(--mc-accent)', color: '#fff', borderColor: 'var(--mc-accent)' }} onClick={run}>Import</button>
        </div>
      </div>
    </div>
  );
}

// ── "Add to watchlist" (chart header) ─────────────────────────────────────────
export function AddToWatchlist({ store, update, market, ticker, exchange }: { store: WlStore | null; update: (fn: (s: WlStore) => WlStore) => void; market: Market; ticker: string; exchange?: string }) {
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [done, setDone] = useState<string | null>(null);
  if (!store) return null;
  const list = store.lists.find((l) => l.id === listId) || activeList(store);
  const key = itemKey({ m: market, t: ticker, x: exchange });
  const inLists = store.lists.filter((l) => findItem(l, key)).map((l) => l.name);
  return (
    <span style={{ position: 'relative' }}>
      <style>{PANEL_CSS}</style>
      <button type="button" className={`mcwl-btn${inLists.length ? ' on' : ''}`} aria-expanded={open} onClick={() => { setOpen((v) => !v); setDone(null); setListId(store.activeId); setSectionId(''); }}
        title={inLists.length ? `In ${inLists.join(', ')} — add to another list` : 'Add this ticker to one of your watchlists'}>{inLists.length ? '✓ In watchlist' : '+ Watchlist'}</button>
      {open && (
        <div className="mcwl-menu" style={{ left: 0, right: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
          <label style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>List
            <select value={list.id} onChange={(e) => { setListId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, width: '100%' }}>
              {store.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          {list.sections.length > 1 && (
            <label style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>Section
              <select value={sectionId || list.sections[list.sections.length - 1].id} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                {list.sections.map((s) => <option key={s.id} value={s.id}>{s.name || '(no section name)'}</option>)}
              </select>
            </label>
          )}
          {inLists.length > 0 && <div style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>Already in: {inLists.join(', ')}</div>}
          <button type="button" style={{ ...smallBtn, background: 'var(--mc-accent)', color: '#fff', borderColor: 'var(--mc-accent)' }}
            disabled={!!findItem(list, key)}
            onClick={() => { update((s) => updateList(s, list.id, (l) => addItem(l, sectionId || null, { m: market, t: ticker, ...(exchange ? { x: exchange } : {}) }))); setDone(`Added to ${list.name}`); setTimeout(() => setOpen(false), 700); }}>
            {findItem(list, key) ? 'Already in this list' : `Add ${ticker}`}
          </button>
          {done && <div style={{ fontSize: 12, color: 'var(--mc-bullish, #059669)' }}>{done}</div>}
        </div>
      )}
    </span>
  );
}

// ── the panel ─────────────────────────────────────────────────────────────────
/** Origin-aware review (screener results): when set, the ↑ / ↓ buttons step through that list instead of this watchlist, and the
 *  panel leaves the ↑ / ↓ keys to the chart page (which steps the same list). */
export interface WatchlistNavOverride { label: string; canPrev: boolean; canNext: boolean; go: (dir: 1 | -1) => void }

const readFlag = (key: string): boolean => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* display preference only */ } };
/** The chart page's divider (role=separator) right before the panel's column, when the panel sits on the chart page. */
function dividerOf(panel: HTMLElement | null): HTMLElement | null {
  const col = panel?.closest('.mc-charts-panel');
  const sep = col?.previousElementSibling as HTMLElement | null | undefined;
  return sep && sep.getAttribute('role') === 'separator' ? sep : null;
}
type RowMenu = { key: string; top?: number; bottom?: number; right: number } | null;
/** zzz1038 — the right-click (or long-press) menu: on a row or on a section header, at the pointer */
type CtxMenu = { kind: 'row'; key: string; x: number; y: number } | { kind: 'section'; id: string; x: number; y: number } | null;
/** zzz1038 — touch: holding a row or a section header this long opens the same menu */
export const LONG_PRESS_MS = 500;

/** zzz1006 — keyboard inside a small menu: ↑ / ↓ move between its items, Escape closes it (the list's arrow keys never fire here). */
function menuKeys(e: React.KeyboardEvent<HTMLDivElement>, close: () => void) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault(); e.stopPropagation();
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]')).filter((x) => !(x as HTMLButtonElement).disabled);
  const i = items.indexOf(document.activeElement as HTMLElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
}

export default function WatchlistPanel({ store, update, currentKey, onPick, navOverride, loading, prefetch }: {
  store: WlStore | null; update: (fn: (s: WlStore) => WlStore) => void; currentKey: string; onPick: (m: Market, t: string, exchange?: string) => void;
  navOverride?: WatchlistNavOverride | null;
  /** the chart is loading the selected ticker (announced to screen readers with the selection) */
  loading?: boolean;
  /** zzz1010 — fetch these symbols' charts in the background (the rows next to the open one, most likely next first) */
  prefetch?: (items: Array<{ m: Market; t: string; x?: string }>) => void;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [flagFilter, setFlagFilter] = useState<Flag | null>(null);
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState<Market | 'ALL'>('ALL');
  const [compact, setCompact] = useState(() => readFlag('mc:watchlist-compact'));
  const [showExt, setShowExt] = useState(() => readFlag(WL_EXT_COLUMN_KEY));   // zzz1006: Extended hours is optional, hidden by default
  const [menu, setMenu] = useState(false);
  const [listMenu, setListMenu] = useState(false);
  const [filterMenu, setFilterMenu] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenu>(null);
  const [ctx, setCtx] = useState<CtxMenu>(null);
  const closeCtx = useCallback(() => setCtx(null), []);
  // zzz1038 — "Undo" after a removal (8 s): puts the row back where it was
  const [undo, setUndo] = useState<{ text: string; listId: string; removed: RemovedItem } | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false });
  const [managing, setManaging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState('');
  const [addMarket, setAddMarket] = useState<Market>('IN');
  const [addSec, setAddSec] = useState('');
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);   // zzz1000: a filtered view hides sections with no matches unless asked
  const [canResize, setCanResize] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const dragKey = useRef<string | null>(null);
  // zzz1013 — drag feedback only (the drop itself still goes through moveItem exactly as before)
  const [drag, setDrag] = useState<{ from: string; over: string | null; after: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const list: WlList | null = store ? activeList(store) : null;
  // zzz1045d — is the store on screen the one in this browser's storage? Checked just after the save runs (the store hook saves
  // in an effect of the parent, which runs after this component's effects).
  const [savedHere, setSavedHere] = useState<boolean | null>(null);
  useEffect(() => {
    if (!store) return undefined;
    const t = setTimeout(() => { let ok = false; try { ok = localStorage.getItem(CHART_WATCHLISTS_KEY) === JSON.stringify(store); } catch { ok = false; } setSavedHere(ok); }, 60);
    return () => clearTimeout(t);
  }, [store]);
  const keys = useMemo(() => (list ? list.sections.flatMap((s) => s.items.map(itemKey)) : []), [list]);
  const quotes = useQuotes(keys);
  const view = useMemo(() => ({ query: search, market: marketFilter }), [search, marketFilter]);
  // zzz969 — sorted by price / change: rows keep their order while quotes tick (so a click never lands on the wrong ticker);
  // "Re-sort" applies the newest quotes. The values shown are always live.
  const liveSort = sort?.key === 'last' || sort?.key === 'chg';
  const sortCtx = `${list?.id || ''}|${keys.length}|${sort?.key || ''}|${sort?.dir || ''}|${flagFilter || ''}|${search}|${marketFilter}`;
  const [frozenQ, setFrozenQ] = useState<{ ctx: string; tick: number; q: typeof quotes } | null>(null);
  const [resort, setResort] = useState(0);
  if (liveSort && Object.keys(quotes).length && (!frozenQ || frozenQ.ctx !== sortCtx || frozenQ.tick !== resort)) setFrozenQ({ ctx: sortCtx, tick: resort, q: quotes });
  const orderQuotes = liveSort && frozenQ ? frozenQ.q : quotes;
  const groups = useMemo(() => (list ? viewRows(list, sort, orderQuotes, flagFilter, view) : []), [list, sort, orderQuotes, flagFilter, view]);
  const rows = useMemo(() => (list ? flatRows(list, sort, orderQuotes, flagFilter, view) : []), [list, sort, orderQuotes, flagFilter, view]);
  const orderStale = useMemo(() => {
    if (!liveSort || !list) return false;
    const live = flatRows(list, sort, quotes, flagFilter, view);
    return live.some((r, i) => itemKey(r.item) !== itemKey(rows[i]?.item || r.item));
  }, [liveSort, list, sort, quotes, flagFilter, view, rows]);
  // zzz1010 — the next / previous two rows are fetched ahead, so ↓ / a click on the next row draws from memory
  useEffect(() => {
    if (!prefetch || navOverride || !rows.length) return;
    const timer = setTimeout(() => {
      const near = neighbourOrder<string>((from, dir) => { const r = stepRow(rows, from ?? currentKey, dir); return r ? itemKey(r.item) : null; });
      const byKey = new Map(rows.map((r) => [itemKey(r.item), r.item] as const));
      prefetch(near.filter((k) => k !== currentKey).map((k) => byKey.get(k)!).filter(Boolean).map((it) => ({ m: it.m, t: it.t, x: it.x })));
    }, 250);
    return () => clearTimeout(timer);
  }, [prefetch, navOverride, rows, currentKey]);
  const setList = useCallback((fn: (l: WlList) => WlList) => update((s) => updateList(s, s.activeId, fn)), [update]);
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), m.length > 90 ? 9000 : 3500); };
  // zzz1042 — sections linked to My Book (India / USA) follow the book: added when held, out of that section when no longer held
  const bookSync = useBookWatchlistSync(store, update, say);
  const closeMenus = () => { setMenu(false); setListMenu(false); setFilterMenu(false); setRowMenu(null); };
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!panelRef.current?.contains(t as Node)) { setMenu(false); setListMenu(false); setFilterMenu(false); }
      if (!t?.closest?.('[data-wl-popup]')) setRowMenu(null);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); setListMenu(false); setFilterMenu(false); setRowMenu(null); setAdding(false); } };
    document.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape); };
  }, []);
  // a row menu is placed against the window: close it when the list scrolls or the window changes size
  useEffect(() => {
    if (!rowMenu) return undefined;
    const close = () => setRowMenu(null);
    const body = bodyRef.current;
    body?.addEventListener('scroll', close, { passive: true }); window.addEventListener('resize', close);
    return () => { body?.removeEventListener('scroll', close); window.removeEventListener('resize', close); };
  }, [rowMenu]);
  useEffect(() => {
    if (!ctx) return undefined;
    const body = bodyRef.current;
    body?.addEventListener('scroll', closeCtx, { passive: true });
    return () => body?.removeEventListener('scroll', closeCtx);
  }, [ctx, closeCtx]);
  useEffect(() => {
    if (!undo) return undefined;
    const t = setTimeout(() => setUndo((u) => (u === undo ? null : u)), 8000);
    return () => clearTimeout(t);
  }, [undo]);
  useEffect(() => () => { if (press.current.timer) clearTimeout(press.current.timer); }, []);
  // the chart page's divider: read its width so Narrow / Standard / Wide can show the current choice
  useEffect(() => {
    const sep = dividerOf(panelRef.current);
    setCanResize(!!sep);
    if (!sep) return undefined;
    const read = () => setWidth(Number(sep.getAttribute('aria-valuenow')) || null);
    read();
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(read);
    mo?.observe(sep, { attributes: true, attributeFilter: ['aria-valuenow'] });
    return () => mo?.disconnect();
  }, [store]);
  /** zzz1006 — width presets go through the divider's own controls (double-click = standard, ← / → = 20 px), so its limits and the
   *  saved width ('mc:watchlist-width') work exactly as when the divider is dragged. */
  const applyWidth = async (px: number) => {
    const sep = dividerOf(panelRef.current);
    if (!sep) return;
    const wait = () => new Promise<void>((r) => setTimeout(r, 24));
    sep.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await wait();
    for (let i = 0; i < 20; i++) {
      const cur = Number(sep.getAttribute('aria-valuenow')); const max = Number(sep.getAttribute('aria-valuemax')) || 620;
      const diff = Math.min(px, max) - cur;
      if (Math.abs(diff) < 10) break;
      sep.dispatchEvent(new KeyboardEvent('keydown', { key: diff > 0 ? 'ArrowLeft' : 'ArrowRight', bubbles: true, cancelable: true }));
      await wait();
    }
  };

  // ↑ / ↓ flips through the list and loads each chart (not while typing in a box)
  useEffect(() => {
    if (navOverride) return undefined;   // reviewing another list: the chart page owns ↑ / ↓
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      // zzz1000 (CW-02) — never inside a dialog or menu (their own keys), and never twice for a row (rows handle their own keys)
      if (el && typeof el.closest === 'function' && el.closest('[role="dialog"],[aria-modal="true"],[role="menu"],[role="listbox"],.mcwl-menu')) return;
      if (e.defaultPrevented) return;
      const next = stepRow(rows, currentKey, e.key === 'ArrowDown' ? 1 : -1);
      if (!next) return;
      e.preventDefault();
      onPick(next.item.m, next.item.t, next.item.x);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, currentKey, onPick, navOverride]);

  // keep the active row in view
  useEffect(() => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-key="${currentKey.replace(/[^A-Z0-9:&.\-]/g, '')}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentKey, groups]);

  // zzz1000 (CW-02) — roving focus: while keyboard focus is in the list, it follows the selected row (↑ / ↓, Home / End, a click,
  // or a chart-side step), so Enter always acts on the row the chart shows. Focus elsewhere (search box, chart, a dialog) is
  // never taken. A quote refresh or a Re-sort that moves the focused row keeps its focus.
  const listFocusRef = useRef(false);
  const focusedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const onDown = (e: Event) => { if (!bodyRef.current?.contains(e.target as Node)) listFocusRef.current = false; };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('mousedown', onDown, true); };
  }, []);
  const rowEl = useCallback((k: string) => bodyRef.current?.querySelector<HTMLElement>(`[data-key="${k.replace(/[^A-Z0-9:&.\-]/g, '')}"]`) || null, []);
  useEffect(() => {
    if (!listFocusRef.current) return;
    const el = rowEl(currentKey);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [currentKey, rowEl]);
  useLayoutEffect(() => {
    if (!listFocusRef.current || !focusedKeyRef.current) return;
    const a = document.activeElement;
    if (a && a !== document.body) return;   // focus is on an element (in the list or elsewhere on purpose)
    rowEl(focusedKeyRef.current)?.focus({ preventScroll: true });   // the focused row was moved in the DOM (re-sort) and lost focus
  });

  if (!store || !list) return <div style={{ padding: 12, color: 'var(--mc-text-3)', fontSize: 13 }}>Loading watchlists…</div>;

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const t = cleanTicker(addText);
    const m: Market = /^(NASDAQ|NYSE|AMEX|NYSEARCA|BATS):/i.test(addText.trim()) ? 'US' : /^(NSE|BSE):/i.test(addText.trim()) ? 'IN' : addMarket;
    if (!validTicker(m, t)) { say(`"${addText}" does not look like a ${m === 'IN' ? 'NSE' : 'US'} ticker.`); return; }
    const x = m === 'IN' && (/^BSE:/i.test(addText.trim()) || /\.BO$/i.test(addText.trim())) ? 'BSE' : undefined;
    if (findItem(list, itemKey({ m, t, x }))) { say(`${t} is already in this list.`); return; }
    setList((l) => addItem(l, addSec || null, { m, t, ...(x ? { x } : {}) }));
    setAddText('');
    onPick(m, t, x);
  };
  const sortArrow = (k: 'symbol' | 'last' | 'chg') => (sort?.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const canDrag = !sort && !flagFilter && !search.trim() && marketFilter === 'ALL';
  const sectionsForMove = list.sections.length > 1;
  const navigate = (dir: 1 | -1) => { const next = stepRow(rows, currentKey, dir); if (next) onPick(next.item.m, next.item.t, next.item.x); };
  const up = rows.filter(({ item }) => (quotes[itemKey(item)]?.chgPct ?? 0) > 0).length;
  const down = rows.filter(({ item }) => (quotes[itemKey(item)]?.chgPct ?? 0) < 0).length;
  const unknown = rows.filter(({ item }) => quotes[itemKey(item)]?.chgPct == null).length;
  const flat = rows.filter(({ item }) => quotes[itemKey(item)]?.chgPct === 0).length;
  const filtered = Boolean(search.trim() || flagFilter || marketFilter !== 'ALL');
  // zzz1000 (improvement 1) — a filtered view shows only sections with matches ("1 of 13"); the stored grouping and
  // collapse choices are untouched and come back when the filters clear
  const shownGroups = visibleSections(groups, filtered, showEmpty);
  const totalMatches = groups.reduce((n, g) => n + g.matches, 0);
  const emptyHidden = filtered ? groups.filter((g) => g.matches === 0 && g.section.name).length : 0;
  const tabKey = rows.some((r) => itemKey(r.item) === currentKey) ? currentKey : (rows[0] ? itemKey(rows[0].item) : '');
  const rowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, it: WlItem) => {
    if (e.target !== e.currentTarget) return;
    const k = itemKey(it);
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(it.m, it.t, it.x); return; }
    if (navOverride || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;   // reviewing another list: the chart page owns ↑ / ↓
    let next: { item: WlItem } | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') next = stepRow(rows, k, e.key === 'ArrowDown' ? 1 : -1);
    else if (e.key === 'Home') next = rows[0] || null;
    else if (e.key === 'End') next = rows[rows.length - 1] || null;
    else return;
    e.preventDefault(); e.stopPropagation();
    listFocusRef.current = true;
    if (next && itemKey(next.item) !== currentKey) onPick(next.item.m, next.item.t, next.item.x);
    else if (next) rowEl(itemKey(next.item))?.focus({ preventScroll: true });
  };
  const curRow = rows.find((r) => itemKey(r.item) === currentKey)?.item;
  // zzz1006 — one quote status for the whole panel; stale or missing quotes are still marked on their own rows
  const fresh = quoteFreshness(keys, quotes);
  const extSession = showExt ? usExtendedSession() : null;
  const openRowMenu = (k: string, btn: HTMLElement) => {
    if (rowMenu?.key === k) { setRowMenu(null); return; }
    const r = btn.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    setRowMenu(r.bottom + 240 > window.innerHeight ? { key: k, bottom: window.innerHeight - r.top + 2, right } : { key: k, top: r.bottom + 2, right });
    setMenu(false); setListMenu(false); setFilterMenu(false);
  };
  const menuRow = rowMenu ? findItem(list, rowMenu.key) : null;
  const activePreset = width == null ? null : WIDTH_PRESETS.reduce((a, b) => (Math.abs(b.px - width) < Math.abs(a.px - width) ? b : a)).id;
  const toggleExt = () => setShowExt((v) => { writeFlag(WL_EXT_COLUMN_KEY, !v); return !v; });

  // ── zzz1038 — right-click / long-press menu ──
  /** Remove a row, with "Undo" in the footer for 8 s (puts it back in the same section and place). */
  const removeRow = (k: string) => {
    const removed = removedFrom(list, k);
    if (!removed) return;
    const listId = list.id;
    update((s) => updateList(s, listId, (l) => removeItem(l, k)));
    setMsg(null);
    setUndo({ text: `${removed.item.t} removed from ${list.name}.`, listId, removed });
  };
  const runUndo = () => {
    if (!undo) return;
    const { listId, removed } = undo;
    update((s) => updateList(s, listId, (l) => restoreItem(l, removed)));
    setUndo(null);
    say(`${removed.item.t} is back in the list.`);
  };
  const copyText = (text: string) => {
    const done = () => say(`Copied ${text}`);
    try {
      const p = navigator.clipboard?.writeText(text);
      if (p) p.then(done, () => say(`Could not copy. Text: ${text}`)); else say(`Could not copy. Text: ${text}`);
    } catch { say(`Could not copy. Text: ${text}`); }
  };
  const openTab = (href: string) => { try { window.open(href, '_blank', 'noopener'); } catch { /* blocked pop-up */ } };
  const openCtx = (menu: NonNullable<CtxMenu>) => { closeMenus(); setCtx(menu); };
  /** On a phone-width page the list is a drawer that closes when a chart is picked, so there the menu opens without picking. */
  const drawerMode = () => { try { return window.matchMedia?.('(max-width: 900px)').matches === true; } catch { return false; } };
  /** Right-click on a row: the row is selected first (its chart opens), then the menu. */
  const rowContext = (e: React.MouseEvent, it: WlItem) => {
    e.preventDefault();
    const k = itemKey(it);
    if (k !== currentKey && !drawerMode()) onPick(it.m, it.t, it.x);
    // the keyboard's menu key / Shift+F10 gives no pointer position: open under the row
    const r = !e.clientX && !e.clientY ? (e.currentTarget as HTMLElement).getBoundingClientRect() : null;
    openCtx({ kind: 'row', key: k, x: r ? r.left + 24 : e.clientX, y: r ? r.bottom : e.clientY });
  };
  /** Touch: hold ~500 ms to open the menu; moving the finger or lifting it early cancels. The tap after a long press is ignored. */
  const pressStart = (e: React.PointerEvent, open: () => void) => {
    if (e.pointerType !== 'touch') return;
    const p = press.current;
    if (p.timer) clearTimeout(p.timer);
    p.x = e.clientX; p.y = e.clientY; p.fired = false;
    p.timer = setTimeout(() => { p.timer = null; p.fired = true; open(); }, LONG_PRESS_MS);
  };
  const pressMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (p.timer && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { clearTimeout(p.timer); p.timer = null; }
  };
  const pressEnd = () => { const p = press.current; if (p.timer) { clearTimeout(p.timer); p.timer = null; } };
  /** true once for the click that ends a long press (so it does not also open the chart / toggle the section) */
  const swallowLongPressClick = () => { if (!press.current.fired) return false; press.current.fired = false; return true; };
  const longPressRow = (e: React.PointerEvent, it: WlItem) => pressStart(e, () => {
    const k = itemKey(it);
    if (k !== currentKey && !drawerMode()) onPick(it.m, it.t, it.x);
    openCtx({ kind: 'row', key: k, x: press.current.x, y: press.current.y });
  });
  /** Link a section to a book. When the link would take names out of the section, ask first (they are listed). */
  const linkWithConfirm = async (listId: string, sectionId: string, book: 'IN' | 'US') => {
    const read = await readBook(book);
    if (!read.ok) { say(`${BOOK_LABEL[book]}: ${read.reason}. The section was not linked.`); return; }
    const secName = displaySectionName(store.lists.find((l) => l.id === listId)?.sections.find((x) => x.id === sectionId)?.name || '') || 'this section';
    const out = previewLinkRemovals(store, listId, sectionId, book, read);
    if (out.length && !window.confirm(`Keep “${secName}” in sync with ${BOOK_LABEL[book]}?\n\n${out.length} name${out.length === 1 ? ' is' : 's are'} not in the book and will be taken out of this section: ${out.slice(0, 20).join(', ')}${out.length > 20 ? ` +${out.length - 20} more` : ''}.\n\nOther sections and lists are not changed.`)) return;
    update((s) => linkSection(s, listId, sectionId, book));
    setTimeout(() => { void bookSync.syncNow(book); }, 50);
  };
  const onCtxSelect = (id: string) => {
    if (!ctx) return;
    const listId = list.id;
    if (ctx.kind === 'row') {
      const f = findItem(list, ctx.key);
      if (!f) return;
      const it = f.item, k = ctx.key;
      const next = applyRowMenu(store, listId, k, id);
      if (next) {
        update(() => next);
        if (id.startsWith('copy-to:')) say(`${it.t} added to ${store.lists.find((l) => l.id === id.slice(8))?.name || 'the list'}.`);
        return;
      }
      if (id === 'open') onPick(it.m, it.t, it.x);
      else if (id === 'open-tab') openTab(chartHref(it));
      else if (id === 'copy-sym') copyText(copySymbolText(it));
      else if (id === 'copy-name') { const n = quotes[k]?.name; if (n) copyText(n); }
      else if (id === 'news') openTab(newsHref(it.t));
      else if (id === 'remove') removeRow(k);
      else if (id === 'move:new') {
        const n = window.prompt('Name for the new section:', 'New section');
        if (n && n.trim()) update((s) => updateList(s, listId, (l) => moveItemToNewSection(l, k, n)));
      } else if (id === 'copy-to:new') {
        const n = window.prompt(`Name for the new list (${it.t} goes in it):`, 'New list');
        if (n && n.trim()) { update((s) => copyItemToNewList(s, n, it)); say(`${it.t} added to a new list “${n.trim()}”.`); }
      }
      return;
    }
    const sec = list.sections.find((s) => s.id === ctx.id);
    if (!sec) return;
    if (id === 'book-sync' && sec.book) { void bookSync.syncNow(sec.book); return; }
    if (id === 'book-unlink' && sec.book) {
      const b = sec.book;
      update((s) => unlinkSection(s, listId, sec.id));
      say(`“${displaySectionName(sec.name)}” is no longer linked to ${BOOK_LABEL[b]}. Its symbols stay.`);
      return;
    }
    if (id === 'book-link:IN' || id === 'book-link:US') { void linkWithConfirm(listId, sec.id, id === 'book-link:IN' ? 'IN' : 'US'); return; }
    if (id === 'sec-remove') {
      const label = displaySectionName(sec.name);
      if (!window.confirm(`Remove the section “${label}”? Its ${sec.items.length} symbol${sec.items.length === 1 ? '' : 's'} stay in the list, without a section.`)) return;
    }
    const next = applySectionMenu(store, listId, sec.id, id, quotes);
    if (next) { update(() => next); if (id === 'sec-remove') say(`Section “${displaySectionName(sec.name)}” removed; its symbols are kept.`); return; }
    if (id === 'sec-rename') {
      const n = window.prompt('Section name:', sec.name);
      if (n && n.trim() && n.trim() !== sec.name) setList((l) => patchSection(l, sec.id, { name: n }));
    } else if (id === 'sec-add') {
      setAddSec(sec.id); setAdding(true); setAddText('');
      if (sec.collapsed) setList((l) => patchSection(l, sec.id, { collapsed: false }));
    }
  };
  const ctxItems = !ctx ? [] : ctx.kind === 'row' ? watchlistRowMenu(store, list, ctx.key, quotes[ctx.key]?.name) : [...watchlistSectionMenu(list, ctx.id), ...(() => { const sec = list.sections.find((x) => x.id === ctx.id); return sec ? bookSectionMenu(store, sec) : []; })()];
  const ctxTitle = !ctx ? '' : ctx.kind === 'row' ? (findItem(list, ctx.key)?.item.t || '') : displaySectionName(list.sections.find((s) => s.id === ctx.id)?.name || '');

  return (
    <div ref={panelRef} className={`mcwl${compact ? ' mcwl-compact' : ''}${showExt ? ' mcwl-ext' : ''}`}>
      <style>{PANEL_CSS}</style>
      {/* row 1 — list picker, add, menu */}
      <div className="mcwl-bar" style={{ paddingTop: 8, paddingBottom: 4, position: 'relative' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <button type="button" onClick={() => { setListMenu((v) => !v); setMenu(false); setFilterMenu(false); }} aria-label="Switch list" aria-haspopup="menu" aria-expanded={listMenu}
            className="mcwl-ib" style={{ color: 'var(--mc-text-0)', fontWeight: 720, fontSize: 15, letterSpacing: '-0.01em', padding: '2px 4px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {list.name} <span style={{ color: 'var(--mc-text-3)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>{listCount(list)} ▾</span>
          </button>
          {/* zzz1045d — list identity + source: a chart list (this browser, copied to your account), linked to My Book, or
              named "Telegram" but not the Telegram bot's list (that one is on the Watchlists page) */}
          <div className="mcwl-src" data-testid="watchlist-source" data-source={chartListSource(list).kind} title={chartListSource(list).detail}>
            {chartListSource(list).label} · {savedHere === false ? <span style={{ color: 'var(--mc-bearish, #DC2626)' }}>not saved in this browser</span> : 'saved in this browser'}
          </div>
          {listMenu && (
            <div className="mcwl-menu" role="menu" aria-label="Lists" style={{ left: 0, right: 'auto' }} onKeyDown={(e) => menuKeys(e, () => setListMenu(false))}>
              {store.lists.map((l) => (
                <button key={l.id} type="button" role="menuitemradio" aria-checked={l.id === list.id} onClick={() => { update((s) => ({ ...s, activeId: l.id })); setListMenu(false); }}
                  title={chartListSource(l).detail}
                  style={{ fontWeight: l.id === list.id ? 700 : 400 }}><span className="chk">{l.id === list.id ? '✓' : ''}</span>
                  <span style={{ display: 'grid', minWidth: 0 }}>{l.name}<span className="mcwl-src" data-source={chartListSource(l).kind}>{chartListSource(l).label}</span></span>
                  <span style={{ color: 'var(--mc-text-3)', marginLeft: 'auto' }}>{listCount(l)}</span></button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="mcwl-btn" title="Add a symbol" aria-label="Add a symbol" aria-expanded={adding} onClick={() => { setAdding((v) => !v); closeMenus(); }}>+ Add</button>
        <div style={{ position: 'relative' }}>
          <button type="button" className="mcwl-btn" aria-label="List menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu((v) => !v); setListMenu(false); setFilterMenu(false); }}>⋯</button>
          {menu && (
            <div className="mcwl-menu" role="menu" aria-label="List menu" onKeyDown={(e) => menuKeys(e, () => setMenu(false))}>
              <button type="button" role="menuitem" onClick={() => { setManaging(true); setMenu(false); }}>Manage list…</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); const n = window.prompt('Name for the new list:', 'New list'); if (n && n.trim()) update((s) => addList(s, n)); }}>New list</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setImporting(true); }}>Import (TradingView list)…</button>
              {/* zzz1042 — My Book → watchlist */}
              <div className="sep" role="separator" />
              <div className="hd">My Book</div>
              {(linkedSection(store, 'IN') || linkedSection(store, 'US')) && (
                <button type="button" role="menuitem" disabled={bookSync.busy} onClick={() => { setMenu(false); void bookSync.syncNow(); }}
                  title={(['IN', 'US'] as const).filter((b) => linkedSection(store, b)).map((b) => `“${displaySectionName(linkedSection(store, b)!.section.name)}” in ${linkedSection(store, b)!.list.name} ← ${BOOK_LABEL[b]}`).join('\n')}>
                  {bookSync.busy ? 'Syncing with My Book…' : 'Sync with My Book now'}</button>
              )}
              {(['IN', 'US'] as const).filter((b) => !linkedSection(store, b)).map((b) => (
                <button key={b} type="button" role="menuitem" onClick={() => {
                  setMenu(false);
                  const has = list.sections.find((x) => x.name.toLowerCase().replace(/[^a-z0-9]/g, '') === BOOK_SECTION_NAME[b].toLowerCase().replace(/[^a-z0-9]/g, ''));
                  if (has) { void linkWithConfirm(list.id, has.id, b); return; }
                  update((s) => createLinkedSection(s, b));
                  setTimeout(() => { void bookSync.syncNow(b); }, 50);
                }}>Keep “{BOOK_SECTION_NAME[b]}” in sync with {BOOK_LABEL[b]}</button>
              ))}
              <div className="sep" role="separator" />
              <button type="button" role="menuitemcheckbox" aria-checked={showExt} onClick={toggleExt} title="Pre-market / after-hours change (US only, while that session is open)"><span className="chk">{showExt ? '✓' : ''}</span>Extended-hours column</button>
              {canResize ? (<>
                <div className="sep" role="separator" />
                <div className="hd">Panel width</div>
                {WIDTH_PRESETS.map((p) => (
                  <button key={p.id} type="button" role="menuitemradio" aria-checked={activePreset === p.id} onClick={() => { setMenu(false); void applyWidth(p.px); }}>
                    <span className="chk">{activePreset === p.id ? '✓' : ''}</span>{p.label}<span style={{ marginLeft: 'auto', color: 'var(--mc-text-3)', fontSize: 11.5 }}>{p.px}px</span></button>
                ))}
              </>) : null}
            </div>
          )}
        </div>
      </div>

      {/* row 2 — search */}
      <div className="mcwl-bar" style={{ paddingBottom: 6 }}>
        <input type="search" className="mcwl-input" aria-label="Search watchlist" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol or company" style={{ flex: 1 }} />
      </div>

      {/* row 3 — market, filter, density, step */}
      <div className="mcwl-bar" style={{ paddingBottom: 7 }}>
        <span className="mcwl-seg" role="group" aria-label="Market">
          {(['ALL', 'IN', 'US'] as const).map((m) => <button key={m} type="button" aria-label={`Show ${m === 'ALL' ? 'all markets' : m === 'IN' ? 'India' : 'USA'}`} aria-pressed={marketFilter === m} onClick={() => setMarketFilter(m)}>{m === 'ALL' ? 'All' : m === 'IN' ? 'India' : 'USA'}</button>)}
        </span>
        <span style={{ position: 'relative' }}>
          {/* zzz1006 — the flag filter lives in a popover (was a row of coloured squares) */}
          <button type="button" className={`mcwl-btn${flagFilter ? ' on' : ''}`} aria-haspopup="dialog" aria-expanded={filterMenu} aria-label={flagFilter ? `Filter: ${flagFilter} flags` : 'Filter by flag'}
            onClick={() => { setFilterMenu((v) => !v); setMenu(false); setListMenu(false); }}>
            {flagFilter ? <FlagDot flag={flagFilter} size={8} /> : null}Filter{flagFilter ? ' · 1' : ''}
          </button>
          {filterMenu && (
            <div className="mcwl-menu" role="dialog" aria-label="Filter by flag" style={{ left: 0, right: 'auto', minWidth: 190 }}>
              <div className="hd">Flag</div>
              <div role="group" aria-label="Flag filter">
                <button type="button" aria-label="Show all flags" aria-pressed={!flagFilter} onClick={() => { setFlagFilter(null); setFilterMenu(false); }}><span className="chk">{!flagFilter ? '✓' : ''}</span>Any flag</button>
                {FLAGS.map((f) => (
                  <button key={f} type="button" aria-label={`Show only ${f} flags`} aria-pressed={flagFilter === f} onClick={() => { setFlagFilter((cur) => (cur === f ? null : f)); setFilterMenu(false); }}>
                    <span className="chk">{flagFilter === f ? '✓' : ''}</span><FlagDot flag={f} size={10} />{f[0].toUpperCase() + f.slice(1)}
                    <span style={{ marginLeft: 'auto', color: 'var(--mc-text-3)', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{list.sections.reduce((n, s) => n + s.items.filter((it) => it.flag === f).length, 0)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="mcwl-btn" aria-label="Compact rows" aria-pressed={compact} title="Toggle compact rows" onClick={() => setCompact((v) => { writeFlag('mc:watchlist-compact', !v); return !v; })}>{compact ? 'Compact' : 'Roomy'}</button>
        {navOverride ? (<>
          <button type="button" className="mcwl-btn" aria-label={`Previous ${navOverride.label}`} title={`Previous ${navOverride.label} (↑)`} disabled={!navOverride.canPrev} onClick={() => navOverride.go(-1)}>↑</button>
          <button type="button" className="mcwl-btn" aria-label={`Next ${navOverride.label}`} title={`Next ${navOverride.label} (↓)`} disabled={!navOverride.canNext} onClick={() => navOverride.go(1)}>↓</button>
        </>) : (<>
          <button type="button" className="mcwl-btn" aria-label="Previous watchlist symbol" title="Previous symbol (↑)" disabled={!stepRow(rows, currentKey, -1)} onClick={() => navigate(-1)}>↑</button>
          <button type="button" className="mcwl-btn" aria-label="Next watchlist symbol" title="Next symbol (↓)" disabled={!stepRow(rows, currentKey, 1)} onClick={() => navigate(1)}>↓</button>
        </>)}
      </div>

      {/* status — counts and one panel-level quote state */}
      <div className="mcwl-status" title="Counts for visible rows, using the last received daily-change figures. Unknown quotes are excluded from up/down counts.">
        <span>{rows.length}/{listCount(list)} shown</span>
        <span style={{ color: 'var(--wl-up)' }}>↑ {up}</span><span style={{ color: 'var(--wl-down)' }}>↓ {down}</span>{flat > 0 && <span>{flat} flat</span>}{unknown > 0 && <span>{unknown} unknown</span>}
        {filtered && <button type="button" className="mcwl-ib" style={{ color: 'var(--mc-accent)' }} onClick={() => { setSearch(''); setFlagFilter(null); setMarketFilter('ALL'); }}>Clear filters</button>}
        <span style={{ flex: 1 }} />
        {fresh.stale > 0
          ? <span className="mcwl-stale" title="The last refresh failed for these symbols; their rows are marked ⚠ and show the last value received.">⚠ {fresh.stale} stale · last known quotes</span>
          : fresh.newest != null ? <span title={`Newest quote received ${new Date(fresh.newest).toLocaleString()}. Quotes refresh every minute while this page is visible.`}><span className={`mcwl-dot${quotesOld(fresh.newest) ? ' warn' : ''}`} aria-hidden />Quotes {agoLabel(fresh.newest)}</span>
          : keys.length ? <span><span className="mcwl-dot wait" aria-hidden />Loading quotes…</span> : null}
      </div>

      {adding && (
        <form onSubmit={submitAdd} className="mcwl-bar" style={{ padding: 8, borderBottom: '1px solid var(--mc-border-3)', flexWrap: 'wrap' }}>
          <select aria-label="Market for new symbol" value={addMarket} onChange={(e) => setAddMarket(e.target.value as Market)} className="mcwl-input">
            <option value="IN">India</option><option value="US">US</option>
          </select>
          <input aria-label="Symbol to add" autoFocus value={addText} onChange={(e) => setAddText(e.target.value.toUpperCase())} placeholder="Symbol" className="mcwl-input" style={{ flex: 1, width: 80 }} />
          {list.sections.length > 1 && (
            <select aria-label="Section for new symbol" value={addSec || list.sections[list.sections.length - 1].id} onChange={(e) => setAddSec(e.target.value)} className="mcwl-input" style={{ maxWidth: 130 }}>
              {list.sections.map((s) => <option key={s.id} value={s.id}>{s.name ? displaySectionName(s.name) : '(no name)'}</option>)}
            </select>
          )}
          <button type="submit" className="mcwl-btn on">Add</button>
        </form>
      )}

      {/* zzz1000 (improvement 1) — filter feedback sits right under the filter controls */}
      {filtered && listCount(list) > 0 && (totalMatches === 0 || emptyHidden > 0 || showEmpty) && (
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 12, color: 'var(--mc-text-3)', borderBottom: '1px solid var(--mc-border-3)' }}>
          {totalMatches === 0 && <span>No matching symbols. Clear filters to see the list.</span>}
          {totalMatches > 0 && emptyHidden > 0 && !showEmpty && <span>{emptyHidden} section{emptyHidden === 1 ? '' : 's'} without matches hidden.</span>}
          {(emptyHidden > 0 || showEmpty) && <button type="button" className="mcwl-ib" aria-pressed={showEmpty} onClick={() => setShowEmpty((v) => !v)}>{showEmpty ? 'Hide empty sections' : 'Show empty sections'}</button>}
        </div>
      )}

      {/* column headers (click to sort) */}
      <div className="mcwl-grid mcwl-colhead">
        <span />
        <button type="button" className="mcwl-ib" style={{ textAlign: 'left', fontWeight: 650, fontSize: 11, padding: 0 }} onClick={() => setSort((s) => nextSort(s, 'symbol'))}>Symbol{sortArrow('symbol')}</button>
        <button type="button" className="mcwl-ib" style={{ textAlign: 'right', fontWeight: 650, fontSize: 11, padding: 0 }} onClick={() => setSort((s) => nextSort(s, 'last'))}>Last{sortArrow('last')}</button>
        <button type="button" className="mcwl-ib" style={{ textAlign: 'right', fontWeight: 650, fontSize: 11, padding: 0 }} onClick={() => setSort((s) => nextSort(s, 'chg'))}>Chg%{sortArrow('chg')}</button>
        {showExt && <span style={{ textAlign: 'right' }} title="Pre-market / after-hours change (US only, while that session is open) — separate from the regular-session Chg%">{extSession === 'pre' ? 'Pre-mkt' : extSession === 'post' ? 'After-hrs' : 'Ext hrs'}</span>}
        {orderStale ? <button type="button" className="mcwl-ib" onClick={() => setResort((v) => v + 1)} aria-label="Re-sort with the latest prices" title="Prices moved; rows were kept in place so a click does not land on the wrong ticker. Click to re-sort." style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-accent)', padding: 0 }}>↻</button> : <span />}
      </div>

      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
        onFocus={(e) => { const k = (e.target as HTMLElement).closest?.('[data-key]')?.getAttribute('data-key'); listFocusRef.current = true; if (k) focusedKeyRef.current = k; }}
        onBlur={(e) => { const to = e.relatedTarget as Node | null; if (to && !bodyRef.current?.contains(to)) listFocusRef.current = false; }}>
        <div className="mcwl-sr" aria-live="polite" aria-atomic="true">{curRow ? `${curRow.t} selected${loading ? ', loading chart' : ''}` : ''}</div>
        <div role="grid" aria-label={`Symbols in ${list.name}`} aria-rowcount={rows.length} title="↑ / ↓ flips through the list (Home / End in the list) · drag rows to reorder">
        {shownGroups.map(({ section, rows: secRows, matches }) => (
          <div key={section.id} role="rowgroup">
            {section.name && (
              <div className={`mcwl-sec${drag && drag.over === `sec:${section.id}` ? ' drop-into' : ''}`} role="row" data-sec={section.id} onClick={() => { if (swallowLongPressClick()) return; setList((l) => patchSection(l, section.id, { collapsed: !section.collapsed })); }}
                onContextMenu={(e) => { e.preventDefault(); openCtx({ kind: 'section', id: section.id, x: e.clientX, y: e.clientY }); }}
                onPointerDown={(e) => pressStart(e, () => openCtx({ kind: 'section', id: section.id, x: press.current.x, y: press.current.y }))}
                onPointerMove={pressMove} onPointerUp={pressEnd} onPointerCancel={pressEnd}
                onDragOver={(e) => { if (canDrag) { e.preventDefault(); const dk = dragKey.current; if (dk && drag?.over !== `sec:${section.id}`) setDrag({ from: dk, over: `sec:${section.id}`, after: false }); } }}
                onDrop={(e) => { e.preventDefault(); const k = dragKey.current; if (k) setList((l) => moveItem(l, k, section.id, 0)); dragKey.current = null; setDrag(null); }}>
                <span role="gridcell">
                <button type="button" className="mcwl-ib" aria-label={`Toggle section ${section.name}`} aria-expanded={!section.collapsed || Boolean(search.trim())} onClick={(e) => { e.stopPropagation(); setList((l) => patchSection(l, section.id, { collapsed: !section.collapsed })); }}>{section.collapsed && !search.trim() ? '▸' : '▾'}</button>
                {/* zzz1006 — a readable label (display only: the saved name, membership and order are unchanged) */}
                <span className="lbl" title={displaySectionName(section.name) !== section.name ? `${displaySectionName(section.name)} (saved as “${section.name}”)` : section.name}>{displaySectionName(section.name)}</span>
                {section.book && (
                  <span data-testid="section-book-link" role="img" aria-label={`Linked to ${BOOK_LABEL[section.book]}`} title={linkTooltip(section.book, bookSync.lastAt[section.book], bookSync.note[section.book])}
                    style={{ marginLeft: 4, fontSize: 11, opacity: bookSync.note[section.book] ? 0.5 : 0.85, cursor: 'help' }}>🔗</span>
                )}
                <span className="cnt" data-testid="section-count">{filtered ? ` · ${matches} of ${section.items.length}` : ` · ${section.items.length}`}</span>
                </span>
              </div>
            )}
            {secRows.map((it, idx) => {
              const k = itemKey(it);
              const q = quotes[k];
              const chg = q?.chgPct;
              const active = k === currentKey;
              const ex = exchangeLabel(it), cur = currencyOf(it);
              return (
                <div key={k} data-key={k} className={`mcwl-row mcwl-grid${active ? ' active' : ''}${drag?.from === k ? ' dragging' : ''}${drag && drag.over === k && drag.from !== k ? (drag.after ? ' drop-after' : ' drop-before') : ''}`} role="row" tabIndex={k === tabKey ? 0 : -1} aria-selected={active}
                  aria-label={`${it.t} on ${it.x || (it.m === 'IN' ? 'NSE' : 'US')}${q?.name ? `, ${q.name}` : ''}; Enter opens chart`} aria-current={active ? 'true' : undefined}
                  title={`${q?.name || it.t} · ${ex} · prices in ${cur}${it.m === 'IN' && /^\d{6}$/.test(it.t) ? ' — BSE code: price and chart may not load' : ''}`}
                  onClick={() => { if (swallowLongPressClick()) return; onPick(it.m, it.t, it.x); }}
                  onContextMenu={(e) => rowContext(e, it)}
                  onPointerDown={(e) => longPressRow(e, it)} onPointerMove={pressMove} onPointerUp={pressEnd} onPointerCancel={pressEnd}
                  onKeyDown={(e) => rowKeyDown(e, it)}
                  draggable={canDrag}
                  onDragStart={() => { dragKey.current = k; setDrag({ from: k, over: null, after: false }); }}
                  onDragEnd={() => { dragKey.current = null; setDrag(null); }}
                  onDragOver={(e) => {
                    if (!canDrag) return;
                    e.preventDefault();
                    const dk = dragKey.current; if (!dk) return;
                    const from = findItem(list, dk);
                    const after = !!(from && from.section.id === section.id && from.index < idx);
                    if (drag?.over !== k || drag.after !== after) setDrag({ from: dk, over: k, after });
                  }}
                  onDrop={(e) => {
                    e.preventDefault(); const dk = dragKey.current; dragKey.current = null; setDrag(null);
                    if (!dk || dk === k) return;
                    // dropping a row onto one below it puts it after that row; onto one above it, before it
                    const from = findItem(list, dk);
                    const down = from && from.section.id === section.id && from.index < idx;
                    setList((l) => moveItem(l, dk, section.id, down ? idx + 1 : idx));
                  }}>
                  <span role="gridcell" style={{ lineHeight: 0 }}><button type="button" className={`mcwl-flagbtn${it.flag ? ' on' : ''}`} aria-label={`Flag ${it.t}`} title="Click to change the flag colour" tabIndex={k === tabKey ? 0 : -1}
                    onClick={(e) => { e.stopPropagation(); setList((l) => patchItem(l, k, { flag: nextFlag(it.flag) })); }}><FlagDot flag={it.flag} size={8} /></button></span>
                  <span role="gridcell" className="mcwl-sym">
                    <span className="mcwl-tk">{it.t}</span>
                    <span className={`mcwl-exb${it.m === 'US' ? ' us' : ''}`} title={`${ex} · prices in ${cur}`}>{ex}</span>
                    {q?.name && <span className="mcwl-company" title={q.name}>{q.name}</span>}
                  </span>
                  <span role="gridcell" className="mcwl-num" title={q ? `${cur} ${q.stale ? '— refresh failed, last known value. ' : ''}${q.marketTime ? `Market quote: ${new Date(q.marketTime).toLocaleString()}. ` : ''}${q.at ? `Received: ${new Date(q.at).toLocaleString()}` : ''}` : 'No quote received'}
                    style={{ color: 'var(--mc-text-0)' }}>{q?.stale && <span aria-label={`Stale quote for ${it.t}`} className="mcwl-stale">⚠ </span>}{q?.last != null ? fmtPrice(q.last, Math.abs(q.last) < 1 ? 4 : 2) : '—'}</span>
                  <span role="gridcell" className={`mcwl-num mcwl-chg ${chg == null || chg === 0 ? 'flat' : chg > 0 ? 'up' : 'down'}`}>
                    {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
                  </span>
                  {showExt && (
                    <span role="gridcell" className="mcwl-num mcwl-extc" title={it.m === 'US' ? 'Pre-market / after-hours change, separate from the regular-session Chg% (shown while that session is open)' : 'No extended session for Indian listings'}
                      style={{ color: q?.ext == null ? undefined : q.ext >= 0 ? 'var(--wl-up)' : 'var(--wl-down)' }}>
                      {q?.ext != null ? <><span className="ses">{extSession === 'pre' ? 'pre' : extSession === 'post' ? 'post' : 'ext'}</span>{`${q.ext >= 0 ? '+' : ''}${q.ext.toFixed(2)}%`}</> : ''}
                    </span>
                  )}
                  <span role="gridcell" className={`mcwl-act${rowMenu?.key === k ? ' open' : ''}`} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="mcwl-ib mcwl-dots" data-wl-popup aria-label={`Actions for ${it.t}`} aria-haspopup="menu" aria-expanded={rowMenu?.key === k} tabIndex={k === tabKey ? 0 : -1}
                      title="Open chart, move, flag or remove (right-click a row for every action)" onClick={(e) => openRowMenu(k, e.currentTarget)}>⋯</button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        </div>
        {!listCount(list) && (
          <div className="mcwl-empty" data-testid="watchlist-empty">
            <b>{list.name} has no symbols yet</b>
            <span>This list is empty. Use + Add to add a symbol, “+ Watchlist” above the chart, or ⋯ → Import to bring in a TradingView list.</span>
            <span className="acts">
              <button type="button" className="mcwl-btn on" onClick={() => { setAdding(true); closeMenus(); }}>Add a symbol</button>
              <button type="button" className="mcwl-btn" onClick={() => setImporting(true)}>Import a TradingView list</button>
            </span>
          </div>
        )}
        {listCount(list) > 0 && !rows.length && (!filtered || totalMatches > 0) && (
          <div className="mcwl-empty" style={{ justifyItems: 'start' }}>Expand a section to see its symbols.</div>
        )}
      </div>
      {msg ? <div className="mcwl-foot" role="status">{msg}</div> : null}
      {undo && !msg ? (
        <div className="mcwl-foot" role="status" data-testid="watchlist-undo" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0 }}>{undo.text}</span>
          <button type="button" className="mcwl-btn on" onClick={runUndo}>Undo</button>
        </div>
      ) : null}
      {ctx && ctxItems.length > 0 && (
        <ChartContextMenu fixed x={ctx.x} y={ctx.y} items={ctxItems} onSelect={onCtxSelect} onClose={closeCtx} title={ctxTitle}
          testId={ctx.kind === 'row' ? 'watchlist-row-menu' : 'watchlist-section-menu'} />
      )}

      {rowMenu && menuRow && (() => {
        const it = menuRow.item; const k = rowMenu.key;
        const close = () => setRowMenu(null);
        return (
          <div className="mcwl-menu" data-wl-popup role="menu" aria-label={`Actions for ${it.t}`} onKeyDown={(e) => menuKeys(e, close)}
            ref={(el) => { if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }); }}
            style={{ position: 'fixed', top: rowMenu.top, bottom: rowMenu.bottom, right: rowMenu.right, left: 'auto', minWidth: 200, zIndex: 70 }}>
            <button type="button" role="menuitem" onClick={() => { close(); onPick(it.m, it.t, it.x); }}>Open chart</button>
            {sectionsForMove ? (<>
              <div className="sep" role="separator" /><div className="hd">Move to section</div>
              {list.sections.filter((s) => s.id !== menuRow.section.id).map((s) => (
                <button key={s.id} type="button" role="menuitem" onClick={() => { close(); setList((l) => moveItem(l, k, s.id)); }}>{s.name ? displaySectionName(s.name) : '(no name)'}</button>
              ))}
            </>) : null}
            <div className="sep" role="separator" /><div className="hd">Flag</div>
            <div style={{ display: 'flex', gap: 2, padding: '2px 6px' }}>
              {FLAGS.map((f) => (
                <button key={f} type="button" role="menuitemradio" aria-checked={it.flag === f} aria-label={`Flag ${f}`} title={f} style={{ width: 28, justifyContent: 'center', padding: 6, outline: it.flag === f ? '2px solid var(--mc-text-0)' : undefined }}
                  onClick={() => { close(); setList((l) => patchItem(l, k, { flag: f })); }}><FlagDot flag={f} size={11} /></button>
              ))}
              <button type="button" role="menuitemradio" aria-checked={!it.flag} aria-label="No flag" title="No flag" style={{ width: 28, justifyContent: 'center', padding: 6 }}
                onClick={() => { close(); setList((l) => patchItem(l, k, { flag: undefined })); }}><FlagDot size={11} /></button>
            </div>
            <div className="sep" role="separator" />
            <button type="button" role="menuitem" className="danger" aria-label={`Remove ${it.t}`} onClick={() => { close(); removeRow(k); }}>Remove from list</button>
          </div>
        );
      })()}
      {managing && <WatchlistManageDrawer key={list.id} store={store} list={list} update={update} onClose={() => setManaging(false)} onImport={() => setImporting(true)} onExport={() => download(list.name, serializeTradingView(list))} say={say} />}
      {importing && <ImportDialog store={store} update={update} onClose={() => setImporting(false)} />}
    </div>
  );
}
