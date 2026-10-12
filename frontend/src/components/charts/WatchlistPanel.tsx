'use client';
// zzz940 — the watchlist panel on the right of /charts (TradingView-style): lists with sections, Symbol / Last / Chg%
// columns with sorting, coloured flags, ↑/↓ to flip through charts, import / export in TradingView's text format.
// Lists live in localStorage 'mc:chart-watchlists:v1' and sync to the owner's database (user-vault-keys).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cleanTicker, fmtPrice, validTicker, type Market } from '@/lib/chart-math';
import {
  CHART_WATCHLISTS_KEY, FLAGS, FLAG_COLORS, activeList, addItem, addList, addSection, findItem, flatRows, importParsed, importTvBundle, parseTvBundle, itemKey,
  listCount, moveItem, nextFlag, nextSort, parseTradingView, patchItem, patchSection, removeItem, removeList, removeSection,
  renameList, sanitizeStore, seedStore, serializeTradingView, stepRow, updateList, viewRows,
  type Flag, type Quote, type SortState, type WlItem, type WlList, type WlStore,
} from '@/lib/chart-watchlist';
import { pollWhenVisible } from '@/lib/client-fetch';
import { refreshedQuotes } from '@/lib/chart-refresh';
import { sharedFetchJson } from '@/lib/tab-shared-fetch';

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

// ── small pieces ──────────────────────────────────────────────────────────────
const PANEL_CSS = `
.mcwl-row { position: relative; display: grid; grid-template-columns: 18px minmax(0,1fr) 68px 64px 46px 22px; align-items: center; gap: 4px;
  padding: 8px 6px 8px 4px; font-size: 13px; cursor: pointer; border-left: 3px solid transparent; border-bottom: 1px solid var(--mc-border-3); user-select: none; }
.mcwl-row:hover { background: var(--mc-bg-2); }
.mcwl-row.active { background: color-mix(in srgb, var(--mc-accent) 14%, transparent); border-left-color: var(--mc-accent); }
.mcwl-row:focus-visible, .mcwl-ib:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: -2px; }
.mcwl-company { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 400; color: var(--mc-text-3); margin-top: 3px; }
.mcwl-compact .mcwl-row { padding-top: 5px; padding-bottom: 5px; }
.mcwl-compact .mcwl-company { display: none; }
.mcwl-actions { position: relative; opacity: 0; display: flex; gap: 4px; align-items: center; justify-content: flex-end; }
.mcwl-actions select { position: absolute; right: 23px; z-index: 2; }
.mcwl-row:hover .mcwl-actions, .mcwl-row:focus-within .mcwl-actions { opacity: 1; }
.mcwl-sec { display: flex; align-items: center; gap: 6px; padding: 6px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: var(--mc-text-3); background: var(--mc-bg-1); border-top: 1px solid var(--mc-border-3); cursor: pointer; }
.mcwl-sec .mcwl-secact { display: none; margin-left: auto; gap: 6px; }
.mcwl-sec:hover .mcwl-secact, .mcwl-sec:focus-within .mcwl-secact { display: flex; }
.mcwl-ib { background: none; border: none; cursor: pointer; color: var(--mc-text-3); font-size: 12px; padding: 0 2px; }
.mcwl-ib:hover { color: var(--mc-text-0); }
.mcwl-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; min-width: 210px; padding: 4px; border-radius: 8px;
  border: 1px solid var(--mc-border-1); background: var(--mc-bg-1); box-shadow: 0 8px 24px rgba(0,0,0,.15); }
.mcwl-menu button { display: block; width: 100%; text-align: left; padding: 6px 10px; border: none; background: none; color: var(--mc-text-1);
  font-size: 13px; border-radius: 4px; cursor: pointer; }
.mcwl-menu button:hover { background: var(--mc-bg-2); }
@media (hover: none) { .mcwl-actions { opacity: 1; } .mcwl-sec .mcwl-secact { display: flex; } }
`;

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
      <button type="button" style={smallBtn} onClick={() => { setOpen((v) => !v); setDone(null); setListId(store.activeId); setSectionId(''); }}
        title="Add this ticker to one of your watchlists">{inLists.length ? '✓ In watchlist' : '+ Watchlist'}</button>
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
export default function WatchlistPanel({ store, update, currentKey, onPick }: {
  store: WlStore | null; update: (fn: (s: WlStore) => WlStore) => void; currentKey: string; onPick: (m: Market, t: string, exchange?: string) => void;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [flagFilter, setFlagFilter] = useState<Flag | null>(null);
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState<Market | 'ALL'>('ALL');
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('mc:watchlist-compact') === '1'; } catch { return false; } });
  const [menu, setMenu] = useState(false);
  const [listMenu, setListMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState('');
  const [addMarket, setAddMarket] = useState<Market>('IN');
  const [addSec, setAddSec] = useState('');
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dragKey = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const list: WlList | null = store ? activeList(store) : null;
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
  const setList = useCallback((fn: (l: WlList) => WlList) => update((s) => updateList(s, s.activeId, fn)), [update]);
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3500); };
  useEffect(() => {
    const dismiss = (e: PointerEvent) => { if (!panelRef.current?.contains(e.target as Node)) { setMenu(false); setListMenu(false); } };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); setListMenu(false); setAdding(false); } };
    document.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape); };
  }, []);

  // ↑ / ↓ flips through the list and loads each chart (not while typing in a box)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const next = stepRow(rows, currentKey, e.key === 'ArrowDown' ? 1 : -1);
      if (!next) return;
      e.preventDefault();
      onPick(next.item.m, next.item.t, next.item.x);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, currentKey, onPick]);

  // keep the active row in view
  useEffect(() => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-key="${currentKey.replace(/[^A-Z0-9:&.\-]/g, '')}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentKey, groups]);

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

  return (
    <div ref={panelRef} className={compact ? 'mcwl-compact' : undefined} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, border: '1px solid var(--mc-border-1)', borderRadius: 8, background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)' }}>
      <style>{PANEL_CSS}</style>
      {/* header: list name + switcher, add, menu */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 6px', borderBottom: '1px solid var(--mc-border-3)', position: 'relative' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <button type="button" onClick={() => { setListMenu((v) => !v); setMenu(false); }} aria-label="Switch list"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-text-0)', fontWeight: 700, fontSize: 14, padding: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {list.name} <span style={{ color: 'var(--mc-text-3)', fontWeight: 400 }}>({listCount(list)}) ▾</span>
          </button>
          {listMenu && (
            <div className="mcwl-menu" style={{ left: 0, right: 'auto' }}>
              {store.lists.map((l) => (
                <button key={l.id} type="button" onClick={() => { update((s) => ({ ...s, activeId: l.id })); setListMenu(false); }}
                  style={{ fontWeight: l.id === list.id ? 700 : 400 }}>{l.name} <span style={{ color: 'var(--mc-text-3)' }}>({listCount(l)})</span></button>
              ))}
            </div>
          )}
        </div>
        <button type="button" style={smallBtn} title="Add a symbol" aria-label="Add a symbol" onClick={() => { setAdding((v) => !v); setMenu(false); setListMenu(false); }}>+</button>
        <div style={{ position: 'relative' }}>
          <button type="button" style={smallBtn} aria-label="List menu" onClick={() => { setMenu((v) => !v); setListMenu(false); }}>•••</button>
          {menu && (
            <div className="mcwl-menu" onClick={() => setMenu(false)}>
              <button type="button" onClick={() => { const n = window.prompt('Name for the new list:', 'New list'); if (n && n.trim()) update((s) => addList(s, n)); }}>New list</button>
              <button type="button" onClick={() => { const n = window.prompt('New name for this list:', list.name); if (n && n.trim()) setList((l) => renameList(l, n)); }}>Rename list</button>
              <button type="button" onClick={() => { const n = window.prompt('Name for the new section:', 'New section'); if (n && n.trim()) setList((l) => addSection(l, n)); }}>Add a section</button>
              <button type="button" onClick={() => setImporting(true)}>Import (TradingView list)…</button>
              <button type="button" onClick={() => download(list.name, serializeTradingView(list))}>Export as .txt</button>
              <button type="button" onClick={() => {
                const text = serializeTradingView(list);
                navigator.clipboard?.writeText(text).then(() => say('Copied — paste it into TradingView’s “Import list”.'), () => say('Copy did not work in this browser — use Export instead.'));
              }}>Copy as TradingView list</button>
              <button type="button" style={{ color: 'var(--mc-bearish, #DC2626)' }}
                onClick={() => { if (window.confirm(`Delete the list “${list.name}” (${listCount(list)} symbols)?`)) update((s) => removeList(s, list.id)); }}>Delete list</button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 5, padding: '8px 8px 5px' }}>
        <input type="search" aria-label="Search watchlist" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol or company" style={{ ...inputStyle, flex: 1 }} />
        <button type="button" style={smallBtn} aria-label="Compact rows" aria-pressed={compact} title="Toggle compact rows" onClick={() => setCompact((v) => { try { localStorage.setItem('mc:watchlist-compact', v ? '0' : '1'); } catch { /* display preference only */ } return !v; })}>{compact ? 'Roomy' : 'Compact'}</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 7px', fontSize: 11 }}>
        {(['ALL', 'IN', 'US'] as const).map((m) => <button key={m} type="button" aria-label={`Show ${m === 'ALL' ? 'all markets' : m === 'IN' ? 'India' : 'USA'}`} aria-pressed={marketFilter === m} onClick={() => setMarketFilter(m)} style={{ ...smallBtn, borderColor: marketFilter === m ? 'var(--mc-accent)' : 'var(--mc-border-1)', color: marketFilter === m ? 'var(--mc-accent)' : 'var(--mc-text-3)' }}>{m === 'ALL' ? 'All' : m === 'IN' ? 'India' : 'USA'}</button>)}
        <span style={{ flex: 1 }} />
        <button type="button" aria-label="Previous watchlist symbol" disabled={!stepRow(rows, currentKey, -1)} onClick={() => navigate(-1)} style={smallBtn}>↑</button>
        <button type="button" aria-label="Next watchlist symbol" disabled={!stepRow(rows, currentKey, 1)} onClick={() => navigate(1)} style={smallBtn}>↓</button>
      </div>
      <div title="Counts for visible rows, using the last received daily-change figures. Unknown quotes are excluded from up/down counts." style={{ display: 'flex', gap: 8, padding: '5px 8px', fontSize: 11, background: 'var(--mc-bg-1)', borderBlock: '1px solid var(--mc-border-3)' }}>
        <span>{rows.length}/{listCount(list)} shown</span><span style={{ color: 'var(--mc-bullish, #059669)' }}>↑ {up}</span><span style={{ color: 'var(--mc-bearish, #DC2626)' }}>↓ {down}</span>{flat > 0 && <span>{flat} flat</span>}{unknown > 0 && <span>{unknown} unknown</span>}
        {filtered && <button type="button" className="mcwl-ib" onClick={() => { setSearch(''); setFlagFilter(null); setMarketFilter('ALL'); }}>Clear filters</button>}
      </div>

      {adding && (
        <form onSubmit={submitAdd} style={{ display: 'flex', gap: 4, padding: 8, borderBottom: '1px solid var(--mc-border-3)', flexWrap: 'wrap' }}>
          <select aria-label="Market for new symbol" value={addMarket} onChange={(e) => setAddMarket(e.target.value as Market)} style={inputStyle}>
            <option value="IN">India</option><option value="US">US</option>
          </select>
          <input aria-label="Symbol to add" autoFocus value={addText} onChange={(e) => setAddText(e.target.value.toUpperCase())} placeholder="Symbol" style={{ ...inputStyle, flex: 1, width: 80 }} />
          {list.sections.length > 1 && (
            <select aria-label="Section for new symbol" value={addSec || list.sections[list.sections.length - 1].id} onChange={(e) => setAddSec(e.target.value)} style={{ ...inputStyle, maxWidth: 110 }}>
              {list.sections.map((s) => <option key={s.id} value={s.id}>{s.name || '(no name)'}</option>)}
            </select>
          )}
          <button type="submit" style={smallBtn}>Add</button>
        </form>
      )}

      {/* flag filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', fontSize: 12, color: 'var(--mc-text-3)', borderBottom: '1px solid var(--mc-border-3)' }}>
        <span>Flag:</span>
        <button type="button" className="mcwl-ib" aria-label="Show all flags" style={{ fontWeight: flagFilter ? 400 : 700, color: flagFilter ? undefined : 'var(--mc-text-0)' }} onClick={() => setFlagFilter(null)}>All</button>
        {FLAGS.map((f) => (
          <button key={f} type="button" aria-label={`Show only ${f} flags`} title={`Show only ${f} flags`} onClick={() => setFlagFilter((cur) => (cur === f ? null : f))}
            style={{ border: flagFilter === f ? '2px solid var(--mc-text-0)' : '2px solid transparent', borderRadius: 4, padding: 1, background: 'none', cursor: 'pointer', lineHeight: 0 }}>
            <FlagDot flag={f} size={11} />
          </button>
        ))}
      </div>

      {/* column headers (click to sort) */}
      <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr) 68px 64px 46px 22px', gap: 4, padding: '5px 6px 5px 7px', fontSize: 11, fontWeight: 700, color: 'var(--mc-text-3)', borderBottom: '1px solid var(--mc-border-3)' }}>
        <span />
        <button type="button" className="mcwl-ib" style={{ textAlign: 'left', fontWeight: 700, fontSize: 11 }} onClick={() => setSort((s) => nextSort(s, 'symbol'))}>Symbol{sortArrow('symbol')}</button>
        <button type="button" className="mcwl-ib" style={{ textAlign: 'right', fontWeight: 700, fontSize: 11 }} onClick={() => setSort((s) => nextSort(s, 'last'))}>Last{sortArrow('last')}</button>
        <button type="button" className="mcwl-ib" style={{ textAlign: 'right', fontWeight: 700, fontSize: 11 }} onClick={() => setSort((s) => nextSort(s, 'chg'))}>Chg%{sortArrow('chg')}</button>
        <span style={{ textAlign: 'right' }} title="Pre-market / after-hours change (US only, while that session is open)">Ext</span>
        {orderStale ? <button type="button" className="mcwl-ib" onClick={() => setResort((v) => v + 1)} aria-label="Re-sort with the latest prices" title="Prices moved; rows were kept in place so a click does not land on the wrong ticker. Click to re-sort." style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-accent)', padding: 0 }}>↻</button> : <span />}
      </div>

      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {groups.map(({ section, rows: secRows }) => (
          <div key={section.id}>
            {section.name && (
              <div className="mcwl-sec" onClick={() => setList((l) => patchSection(l, section.id, { collapsed: !section.collapsed }))}
                onDragOver={(e) => { if (canDrag) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const k = dragKey.current; if (k) setList((l) => moveItem(l, k, section.id, 0)); dragKey.current = null; }}>
                <button type="button" className="mcwl-ib" aria-label={`Toggle section ${section.name}`} aria-expanded={!section.collapsed || Boolean(search.trim())} onClick={(e) => { e.stopPropagation(); setList((l) => patchSection(l, section.id, { collapsed: !section.collapsed })); }}>{section.collapsed && !search.trim() ? '▸' : '▾'}</button>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.name}</span>
                <span style={{ fontWeight: 400 }}>({section.items.length})</span>
                <span className="mcwl-secact" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="mcwl-ib" onClick={() => { const n = window.prompt('Section name:', section.name); if (n != null && n.trim()) setList((l) => patchSection(l, section.id, { name: n })); }}>rename</button>
                  {list.sections.length > 1 && (
                    <button type="button" className="mcwl-ib" onClick={() => { if (window.confirm(`Remove the section “${section.name}”? Its symbols move to the section next to it.`)) setList((l) => removeSection(l, section.id)); }}>remove</button>
                  )}
                </span>
              </div>
            )}
            {secRows.map((it, idx) => {
              const k = itemKey(it);
              const q = quotes[k];
              const chg = q?.chgPct;
              const active = k === currentKey;
              return (
                <div key={k} data-key={k} className={`mcwl-row${active ? ' active' : ''}`} role="group" tabIndex={0} aria-label={`${it.t} on ${it.x || (it.m === 'IN' ? 'NSE' : 'US')}; Enter opens chart`} aria-current={active ? 'true' : undefined}
                  title={`${q?.name || it.t}${it.m === 'IN' && /^\d{6}$/.test(it.t) ? ' — BSE code: price and chart may not load' : ''}`}
                  onClick={() => onPick(it.m, it.t, it.x)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(it.m, it.t, it.x); } }}
                  draggable={canDrag}
                  onDragStart={() => { dragKey.current = k; }}
                  onDragOver={(e) => { if (canDrag) e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault(); const dk = dragKey.current; dragKey.current = null;
                    if (!dk || dk === k) return;
                    // dropping a row onto one below it puts it after that row; onto one above it, before it
                    const from = findItem(list, dk);
                    const down = from && from.section.id === section.id && from.index < idx;
                    setList((l) => moveItem(l, dk, section.id, down ? idx + 1 : idx));
                  }}>
                  <button type="button" aria-label={`Flag ${it.t}`} title="Click to change the flag colour"
                    onClick={(e) => { e.stopPropagation(); setList((l) => patchItem(l, k, { flag: nextFlag(it.flag) })); }}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0 }}><FlagDot flag={it.flag} /></button>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--mc-text-0)' }}>
                    {it.t}
                    {/* small dot like TradingView's: green = up today, red = down, grey = no price */}
                    <span title={chg == null ? 'No price yet' : chg === 0 ? 'Unchanged today' : chg > 0 ? 'Up today' : 'Down today'} style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 5, margin: '0 4px 2px 3px', verticalAlign: 'middle', background: chg == null || chg === 0 ? 'var(--mc-border-2)' : chg > 0 ? 'var(--mc-bullish, #059669)' : 'var(--mc-bearish, #DC2626)' }} />
                    <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--mc-text-4)' }}>{it.m === 'US' ? 'US' : it.x === 'BSE' ? 'BSE' : 'NSE'}</span>
                    {q?.name && <span className="mcwl-company" title={q.name}>{q.name}</span>}
                  </span>
                  <span title={q ? `${q.stale ? 'Refresh failed — last known value. ' : ''}${q.marketTime ? `Market quote: ${new Date(q.marketTime).toLocaleString()}. ` : ''}${q.at ? `Received: ${new Date(q.at).toLocaleString()}` : ''}` : 'No quote received'} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{q?.last != null ? fmtPrice(q.last, Math.abs(q.last) < 1 ? 4 : 2) : '—'}{q?.stale && <span aria-label={`Stale quote for ${it.t}`} style={{ color: 'var(--mc-warn, #D97706)' }}> ⚠</span>}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '3px 4px', borderRadius: 4, background: chg == null || chg === 0 ? 'transparent' : `color-mix(in srgb, ${chg > 0 ? 'var(--mc-bullish, #059669)' : 'var(--mc-bearish, #DC2626)'} 10%, transparent)`, color: chg == null || chg === 0 ? 'var(--mc-text-3)' : chg > 0 ? 'var(--mc-bullish, #059669)' : 'var(--mc-bearish, #DC2626)' }}>
                    {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
                  </span>
                  <span title="Pre-market / after-hours change (US only, while that session is open)" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: q?.ext == null ? 'var(--mc-text-4)' : q.ext >= 0 ? 'var(--mc-bullish, #059669)' : 'var(--mc-bearish, #DC2626)' }}>
                    {q?.ext != null ? `${q.ext >= 0 ? '+' : ''}${q.ext.toFixed(2)}%` : ''}
                  </span>
                  <span className="mcwl-actions" onClick={(e) => e.stopPropagation()}>
                    {sectionsForMove && (
                      <select aria-label={`Move ${it.t} to section`} value="" onChange={(e) => { const to = e.target.value; if (to) setList((l) => moveItem(l, k, to)); }}
                        title={`Move ${it.t} to another section`} style={{ ...inputStyle, fontSize: 11, padding: '1px 2px', width: 22, appearance: 'none' }}>
                        <option value="">↔</option>
                        {list.sections.filter((s) => s.id !== section.id).map((s) => <option key={s.id} value={s.id}>{s.name || '(no name)'}</option>)}
                      </select>
                    )}
                    <button type="button" className="mcwl-ib" aria-label={`Remove ${it.t}`} title="Remove from this list"
                      onClick={() => setList((l) => removeItem(l, k))}>🗑</button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {!listCount(list) && (
          <div style={{ padding: 14, fontSize: 13, color: 'var(--mc-text-3)' }}>
            This list is empty. Use + to add a symbol, “+ Watchlist” above the chart, or ••• → Import to bring in a TradingView list.
          </div>
        )}
        {listCount(list) > 0 && !rows.length && (
          <div style={{ padding: 14, fontSize: 13, color: 'var(--mc-text-3)' }}>{filtered ? 'No matching symbols. Clear filters to see the list.' : 'Expand a section to see its symbols.'}</div>
        )}
      </div>
      <div style={{ padding: '5px 8px', fontSize: 11, color: 'var(--mc-text-3)', borderTop: '1px solid var(--mc-border-3)' }}>
        {msg || (Object.values(quotes).some((q) => q.stale) ? '⚠ Refresh failed for some symbols — showing their last known quotes.' : '↑ / ↓ flips through the list · click a flag to change its colour · drag rows to reorder')}
      </div>
      {importing && <ImportDialog store={store} update={update} onClose={() => setImporting(false)} />}
    </div>
  );
}
