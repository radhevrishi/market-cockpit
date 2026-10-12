'use client';
// zzz983 — PINE SCREENER page: every company whose daily chart shows one of 21 chart patterns right now (bullish bases,
// flags, triangles, bottoms; bearish tops, flags, wedges). The patterns are read once a day by the stock screener's build
// from the same daily bars as its price figures (lib/screener/pine.ts); this page downloads the companies with a pattern and
// filters in the browser, so every change is instant. Built-in screens are data (lib/screener/pine-presets.ts); the owner's own
// screens are kept in 'mc:pine-screens:v1' (synced to his database by the vault).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ScreenMarket, ScreenRow } from '@/lib/screener/types';
import { PATTERN_META, type PatternId } from '@/lib/chart-patterns';
import {
  DEFAULT_QUERY, LIKELIHOODS, OPTIONAL_COLS, PINE_GROUPS, PINE_SCREENS_KEY, STAGES, cleanPineScreens, cleanQuery, dirDist, likelihoodWord, patternCounts, patternGroups,
  runPine, turnoverOf, type PerfKey, type PineHit, type PineQuery, type PineScreen, type PineStage, type ScreenPatternTag,
} from '@/lib/screener/pine';
import { BUILT_IN_PINE_SCREENS } from '@/lib/screener/pine-presets';
import { fmtValue, filterLabel, fieldOf, type NumKey } from '@/lib/screener/filters';
import { TV_SECTORS } from '@/lib/screener/tv-sectors';
import { writeReviewQueue } from '@/lib/screener/workflow';
import { pollWhenVisible } from '@/lib/client-fetch';
import { useWorkspaceLight, workspaceThemeClass } from '@/lib/workspace-theme';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';
import { useWatchlistStore } from '@/components/charts/WatchlistPanel';
import { activeList, updateList, addItem, listCount, type WlItem } from '@/lib/chart-watchlist';
import { toCsv } from '@/lib/csv';

const C = {
  text: 'var(--mc-text-0)', text1: 'var(--mc-text-1)', dim: 'var(--mc-text-3, #6b7280)', border: 'var(--mc-border-1)',
  bg: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', accent: 'var(--mc-accent)', green: 'var(--mc-bullish, #059669)', red: 'var(--mc-bearish, #DC2626)', amber: 'var(--mc-warn, #D97706)',
};
type Row = ScreenRow & { live?: 1 };
interface Snap { builtAt: string | null; rows: Row[]; total: number; scanned: number; withPattern: number; patAt: string | null; notes: string[] }
const LAST_KEY = 'mc:pine-screener:last:v1';   // the screen + unsaved choices open last time (this browser only)
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
const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
const PERF_LABEL: Record<PerfKey, string> = { perf1M: '1M', perf3M: '3M', perf6M: '6M', perf1Y: '1Y' };
/** zzz984 — short headers for the optional columns (the full label is the header's tooltip). */
const COL_SHORT: Partial<Record<NumKey, string>> = {
  tt: 'TT rules', ttOk: 'TT all 6', rsR: 'RS Rating', stage: 'Stage', st12: 'Stage 1→2', r40: 'Rule of 40', revQYoY: 'Rev Q YoY', fcfmTTM: 'FCF margin',
  rsiMA: 'RSI avg', rsiX: 'RSI × avg (d)', gcD: 'Golden × (d)', dcD: 'Death × (d)', emaXU: 'EMA10×21 up (d)', emaXD: 'EMA10×21 dn (d)', ppD: 'Pocket pivot (d)',
  rvol: 'RVol', 'adv$': 'Avg value', adrP: 'ADR %', ripB: 'Ripster', perf1M: 'Perf 1M', perf6M: 'Perf 6M', perf1Y: 'Perf 1Y',
};
const YES_NO = new Set<string>(['ttOk', 'st12', 'ripB']);
function fmtCol(k: NumKey, v: number | null | undefined, market: ScreenMarket): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (YES_NO.has(k)) return v >= 1 ? 'yes' : 'no';
  if (k === 'tt') return `${v}/6`;
  if (k === 'rvol') return `${v.toFixed(2)}×`;
  const d = fieldOf(k);
  if (d?.unit === '%') return pct(v);
  return fmtValue(v, d?.unit || 'num', market);
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
    return { s, market: last?.market || s.market || 'US', q: last?.dirty && last.id === s.id ? last.q : clone(s.q), dirty: !!(last?.dirty && last.id === s.id) };
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
          empty = !j.rows.length;
          setErrors((p) => ({ ...p, [market]: null }));
          setSnaps((p) => ({ ...p, [market]: { builtAt: j.builtAt, rows: j.rows, total: j.total || 0, scanned: j.scanned || 0, withPattern: j.withPattern || 0, patAt: j.patAt || null, notes: j.notes || [] } }));
        })
        .catch((e) => { if (!stopped && !signal.aborted) setErrors((p) => ({ ...p, [market]: e?.message || 'Could not load the pattern data' })); })
        .finally(() => { if (!stopped && !signal.aborted) setLoading(false); });
    };
    const stop = pollWhenVisible(load, () => (empty ? 120_000 : 300_000), { runImmediately: true });
    return () => { stopped = true; stop(); ctrl?.abort(); };
  }, [market, refresh]);

  const snap = snaps[market];
  const err = errors[market] || null;
  const rows = useMemo(() => snap?.rows || [], [snap]);
  const hits = useMemo(() => runPine(rows, q, market), [rows, q, market]);
  const counts = useMemo(() => patternCounts(rows, q, market), [rows, q, market]);
  const groups = useMemo(() => patternGroups(q.bias), [q.bias]);
  const sorted = useMemo(() => {
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
    return hits.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      if (typeof x === 'string' || typeof y === 'string') return String(x ?? '').localeCompare(String(y ?? '')) * sort.dir;
      const fx = typeof x === 'number' ? x : -Infinity, fy = typeof y === 'number' ? y : -Infinity;
      return (fx - fy) * sort.dir || a.row.t.localeCompare(b.row.t);
    });
  }, [hits, sort, market]);
  const narrowed = useMemo(() => {
    const s = findText.trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '');
    return s ? sorted.filter((h) => h.row.t.toUpperCase().includes(s) || String(h.row.n || '').toUpperCase().includes(s)) : sorted;
  }, [sorted, findText]);
  const shown = showAll ? narrowed : narrowed.slice(0, 200);

  // ── changing the query / screens ────────────────────────────────────────────────────────────────────────────────────
  const change = (patch: Partial<PineQuery>) => { setQ((p) => ({ ...p, ...patch })); setDirty(true); setShowAll(false); };
  const loadScreen = useCallback((id: string) => {
    const s = screens.find((x) => x.id === id);
    if (!s) return;
    if (dirty && !window.confirm(`Discard the unsaved changes to "${name}"?`)) return;
    setScreenId(s.id); setName(s.name); setQ(clone(s.q)); setDirty(false); setShowAll(false);
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
    setScreenId(s.id); setName(s.name); setQ(clone(s.q)); setDirty(false);
  };
  const setBias = (bias: PineQuery['bias']) => change({ bias, ids: q.ids.filter((id) => bias === 'both' || (PATTERN_META[id].bias === 'bullish') === (bias === 'U')) });
  const toggleId = (id: PatternId) => change({ ids: q.ids.includes(id) ? q.ids.filter((x) => x !== id) : [...q.ids, id] });
  const toggleStage = (s: PineStage) => change({ stages: q.stages.includes(s) ? q.stages.filter((x) => x !== s) : [...q.stages, s] });

  // ── actions on the result ───────────────────────────────────────────────────────────────────────────────────────────
  const exchOf = (r: Row) => (market === 'IN' ? (r.exch?.[0] || 'NSE') : (r.exch?.[0] || 'US'));
  const openForReview = (r: Row) => {
    writeReviewQueue(`Pine: ${name}`, narrowed.map((h) => ({ symbol: h.row.t, exchange: exchOf(h.row), name: h.row.n })), '/pine-screener');
    const ex = market === 'IN' ? (r.exch?.[0] || 'NSE') : (r.exch?.[0] || '');
    return `/charts?symbol=${encodeURIComponent(r.t)}&exchange=${encodeURIComponent(ex)}&t=${encodeURIComponent(r.t)}&m=${market}&tf=D&review=screener`;
  };
  const copyTickers = () => {
    const txt = narrowed.map((h) => (market === 'IN' ? `NSE:${h.row.t}` : h.row.t)).join(',');
    navigator.clipboard?.writeText(txt).then(() => flash(`Copied ${narrowed.length} tickers for TradingView`)).catch(() => flash('Could not copy — the browser refused clipboard access'));
  };
  const money = market === 'US' ? '$ million' : '₹ crore';
  const downloadCsv = () => {
    const head = ['Ticker', 'Market', 'Company', 'Sector', 'Pattern', 'Bias', 'Stage', 'Likelihood (%)', 'Pivot', 'To pivot (%)', 'Length (weeks)', 'Depth (%)', 'Other patterns',
      `Price (${market === 'US' ? 'USD' : 'INR'})`, 'Change (%)', `Market cap (${money})`, `Avg daily value (${money})`, `Perf ${PERF_LABEL[q.perfKey]} (%)`, 'RSI 14', ...q.cols.map((k) => { const d = fieldOf(k); const u = d?.unit === '%' ? ' (%)' : d?.unit === 'money' ? ` (${money})` : ''; return `${d?.label || k}${u}`; }), 'Approximate (≈) fields', 'Patterns as of', 'Snapshot built (UTC)'];
    const body = narrowed.map(({ row: r, best: b, tags }) => [r.t, market === 'IN' ? 'NSE' : 'US', r.n, r.tvSec || r.sec || '', b ? PATTERN_META[b.id].label : '', b ? (b.b === 'U' ? 'bullish' : 'bearish') : '', b ? stageWord(b) : '', b?.c ?? '',
      b?.p ?? '', b ? dirDist(b) ?? '' : '', b?.l != null ? Math.round((b.l / 5) * 10) / 10 : '', b?.dp ?? '', tags.filter((t) => t !== b).map((t) => `${PATTERN_META[t.id].label} (${t.c})`).join('; '),
      r.px ?? '', r.chg ?? '', r.mc ?? '', (() => { const v = turnoverOf(r, market); return v == null ? '' : Math.round(v * 100) / 100; })(), r[q.perfKey] ?? '', r.rsi ?? '',
      ...q.cols.map((k) => (r as any)[k] ?? ''), (r.approx || []).filter((k) => (q.cols as string[]).includes(k)).join('; '), r.patAt || '', snap?.builtAt || '']);
    const blob = new Blob(['﻿' + toCsv([head, ...body])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pine_${name.replace(/[^\w-]+/g, '_')}_${market}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const addMatches = () => {
    if (!watchlists || !narrowed.length) return;
    if (targetList && !watchlists.lists.some((l) => l.id === targetList)) { flash('Could not add: the selected watchlist no longer exists.'); return; }
    const target = watchlists.lists.find((l) => l.id === targetList) || activeList(watchlists);
    let next = target;
    for (const { row: r } of narrowed) { const item: WlItem = { m: market, t: r.t, ...(r.exch?.[0] ? { x: r.exch[0] } : {}) }; next = addItem(next, null, item); }
    const added = listCount(next) - listCount(target);
    updateWatchlists((s) => updateList(s, target.id, () => next));
    flash(`${added} symbols added to ${target.name}${narrowed.length > added ? `; ${narrowed.length - added} already there or beyond the list limit` : ''}.`);
    setAdding(false);
  };

  const btn = (on = false): React.CSSProperties => ({ padding: '5px 10px', borderRadius: 6, border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.bg1, color: on ? '#fff' : C.text1, fontSize: 13, fontWeight: 600, cursor: 'pointer' });
  const inp: React.CSSProperties = { width: 86, padding: '4px 6px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13 };
  const numIn = (v: number | null, set: (v: number | null) => void, label: string, width = 86) => (
    <input type="number" aria-label={label} value={v ?? ''} placeholder="any" onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} style={{ ...inp, width }} />
  );
  const opt = (s: PineScreen) => <option key={s.id} value={s.id}>{s.market ? (s.market === 'IN' ? '🇮🇳 ' : '🇺🇸 ') : ''}{s.name}</option>;
  const mine = screens.filter((s) => !builtInIds.has(s.id));
  const builtAt = snap?.builtAt ? new Date(snap.builtAt) : null;
  const notScanned = !!snap && snap.total > 0 && snap.scanned === 0;
  const allOfBias = q.ids.length === 0;

  return (
    <div className={workspaceThemeClass(light, true)} style={{ padding: '12px 16px', display: 'grid', gap: 10, color: C.text, background: 'var(--mc-bg-0)', minHeight: '100%' }}>
      {/* header: screens + market */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 18 }}>Pine Screener</b>
        <span style={{ fontSize: 12, color: C.dim }}>chart patterns across every listed company</span>
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
          {(['US', 'IN'] as const).map((m) => <button key={m} type="button" style={btn(market === m)} onClick={() => { setMarket(m); setShowAll(false); }}>{m === 'US' ? '🇺🇸 USA' : '🇮🇳 India'}</button>)}
        </span>
        {msg ? <span role="status" style={{ color: /^(Not saved|Could not)/.test(msg) ? C.red : C.text1, fontSize: 13, fontWeight: 700 }}>{msg}</span> : null}
      </div>
      {note && !dirty ? <div style={{ fontSize: 12.5, color: C.dim }}>ℹ {note}</div> : null}

      {/* bias + stage + likelihood + distance */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <span role="radiogroup" aria-label="Bias" style={{ display: 'inline-flex', borderRadius: 7, overflow: 'hidden', border: `1px solid ${C.border}` }}>
          {([['U', '▲ Bullish', C.green], ['D', '▼ Bearish', C.red], ['both', 'Both', C.accent]] as const).map(([b, label, col]) => (
            <button key={b} type="button" role="radio" aria-checked={q.bias === b} onClick={() => setBias(b)}
              style={{ all: 'unset', cursor: 'pointer', padding: '6px 14px', fontWeight: 800, fontSize: 13.5, background: q.bias === b ? col : C.bg1, color: q.bias === b ? '#fff' : C.text1 }}>{label}</button>
          ))}
        </span>
        <label title="Off: the screen's rules alone decide (e.g. your trend-template script) and any chart pattern is shown beside the company" style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={q.need !== 'any'} onChange={(e) => change({ need: e.target.checked ? 'pattern' : 'any' })} aria-label="Require a chart pattern" /> Require a chart pattern
        </label>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: C.dim }}>Stage</span>
          {STAGES.map((s) => <button key={s.id} type="button" title={s.tip} aria-pressed={q.stages.includes(s.id)} style={btn(q.stages.includes(s.id))} onClick={() => toggleStage(s.id)}>{s.label}</button>)}
        </span>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><span style={{ color: C.dim }}>Likelihood</span>
          <select value={q.minConf} onChange={(e) => change({ minConf: Number(e.target.value) })} style={btn()} aria-label="Minimum likelihood">
            {LIKELIHOODS.map((l) => <option key={l.min} value={l.min}>{l.label}</option>)}
          </select>
        </label>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} title="Close against the pivot, in the pattern's direction: − = not reached yet (bullish: below the buy point; bearish: above the breakdown level), + = beyond it">
          <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={q.dist.on} onChange={(e) => change({ dist: { ...q.dist, on: e.target.checked } })} aria-label="Limit distance to pivot" /> <span style={{ color: C.dim }}>To pivot</span>
          </label>
          <input type="number" aria-label="Distance to pivot from %" value={q.dist.lo} disabled={!q.dist.on} onChange={(e) => change({ dist: { ...q.dist, lo: Number(e.target.value) } })} style={{ ...inp, width: 60 }} />
          <span>to</span>
          <input type="number" aria-label="Distance to pivot to %" value={q.dist.hi} disabled={!q.dist.on} onChange={(e) => change({ dist: { ...q.dist, hi: Number(e.target.value) } })} style={{ ...inp, width: 60 }} />
          <span style={{ color: C.dim }}>%</span>
        </span>
      </div>

      {/* sub-patterns */}
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={btn(allOfBias)} onClick={() => change({ ids: [] })} title="No pattern ticked = every pattern of the chosen bias">
            All {q.bias === 'U' ? 'bullish' : q.bias === 'D' ? 'bearish' : 'patterns'}
          </button>
          <span style={{ fontSize: 12, color: C.dim }}>{allOfBias ? 'tick one or more patterns to narrow' : `${q.ids.length} pattern${q.ids.length > 1 ? 's' : ''} ticked`} · the number on each = companies showing it with the other choices</span>
        </div>
        {groups.map((g) => (
          <div key={`${g.bias}-${g.group}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ width: 150, fontSize: 11.5, fontWeight: 800, color: g.bias === 'bullish' ? C.green : C.red, textTransform: 'uppercase', letterSpacing: 0.3 }}>{g.group}{q.bias === 'both' ? (g.bias === 'bullish' ? ' ▲' : ' ▼') : ''}</span>
            {g.ids.map((id) => {
              const on = q.ids.includes(id); const col = g.bias === 'bullish' ? C.green : C.red; const n = counts[id] || 0;
              return (
                <button key={id} type="button" aria-pressed={on} onClick={() => toggleId(id)} title={PATTERN_META[id].short}
                  style={{ padding: '4px 9px', borderRadius: 999, border: `1px solid ${on ? col : C.border}`, background: on ? col : C.bg1, color: on ? '#fff' : n ? C.text : C.dim, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  {PATTERN_META[id].label} <span style={{ opacity: 0.7, fontWeight: 600 }}>{n}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

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
        {q.filters.map((f, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 6, background: '#374151', color: '#fff', fontSize: 12.5, overflow: 'hidden' }} title="A rule from this screen (Stock Screener filter language)">
            <span style={{ padding: '4px 8px' }}>{filterLabel(f, market)}</span>
            <button type="button" aria-label="Remove rule" onClick={() => change({ filters: q.filters.filter((_, k) => k !== i) })} style={{ all: 'unset', cursor: 'pointer', padding: '4px 7px', borderLeft: '1px solid rgba(255,255,255,0.2)' }}>×</button>
          </span>
        ))}
        {dirty || q.mcMin != null || q.mcMax != null || q.pxMin != null || q.turnMin != null || q.perfMin != null || q.sectors.length ? (
          <button type="button" style={btn()} onClick={() => change({ mcMin: null, mcMax: null, pxMin: null, turnMin: null, perfMin: null, sectors: [] })}>Clear company filters</button>
        ) : null}
      </div>

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

      {/* summary + actions */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 13 }}>
        <b style={{ fontSize: 15 }}>{snap ? `${hits.length} companies` : err ? '' : 'Loading…'}</b>
        {snap ? <span style={{ color: C.dim }}>{snap.withPattern} of {snap.total} show any pattern{snap.patAt ? ` · patterns as of the ${snap.patAt} close` : ''}{builtAt ? ` · data built ${builtAt.toLocaleString()}` : ''}{snap.scanned && snap.scanned < snap.total ? ` · ${snap.total - snap.scanned} companies not scanned yet` : ''}</span> : null}
        {err ? <span role="alert" style={{ color: C.red }}>{err}{snap ? ' — showing the last loaded data' : ''}</span> : null}
        <span style={{ flex: 1 }} />
        <input value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="find ticker or name" aria-label="Find in results" style={{ ...inp, width: 150 }} />
        <button type="button" style={btn()} disabled={loading} onClick={() => setRefresh((v) => v + 1)}>{loading ? 'Refreshing…' : err ? 'Retry' : 'Refresh'}</button>
        <button type="button" style={btn()} onClick={copyTickers} disabled={!narrowed.length} title={market === 'IN' ? 'NSE:TICKER, comma separated — paste into a TradingView watchlist' : 'Tickers, comma separated — paste into a TradingView watchlist'}>Copy for TradingView</button>
        <button type="button" style={btn()} onClick={downloadCsv} disabled={!narrowed.length}>Download CSV</button>
        <button type="button" style={btn()} onClick={() => setAdding((v) => !v)} disabled={!narrowed.length || !watchlists}>Add to watchlist</button>
      </div>
      {adding && watchlists ? (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <label>Destination <select aria-label="Watchlist for pattern matches" value={targetList || activeList(watchlists).id} onChange={(e) => setTargetList(e.target.value)} style={btn()}>{watchlists.lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({listCount(l)})</option>)}</select></label>
          <span style={{ fontSize: 12, color: C.dim }}>{narrowed.length} symbols; duplicates are skipped; each list holds up to 1,000.</span>
          <button type="button" style={btn()} onClick={addMatches}>Add symbols</button>
          <button type="button" style={btn()} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : null}
      {watchlistSaveError ? <div role="alert" style={{ color: C.amber }}>{watchlistSaveError} <button type="button" style={btn()} onClick={retryWatchlistSave}>Retry watchlist save</button></div> : null}
      {notScanned || snap?.notes.length ? <div style={{ fontSize: 12.5, color: C.amber }}>⏳ {snap?.notes[0] || 'Chart patterns are read during the screener build; the next build adds them.'}</div> : null}
      <details open={showMore} onToggle={(e) => setShowMore((e.target as HTMLDetailsElement).open)} style={{ fontSize: 12, color: C.dim }}>
        <summary style={{ cursor: 'pointer' }}>How the patterns are found</summary>
        <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
          <div>Each company&apos;s daily chart (up to ~2.8 years) is read once a day by the screener build with the same pattern engine as the chart&apos;s pattern line. Definitions follow O&apos;Neil, Minervini and Bulkowski; each rule passed adds to the likelihood (possible ≥ 35, likely ≥ 55, very likely ≥ 75).</div>
          <div><b>Stage</b>: forming = no close beyond the pivot yet; breakout = first close beyond it within the last 5 sessions; failed = broke out in the last 40 sessions and is now more than 7.5% back through it. A breakout that held longer ago is complete and no longer listed.</div>
          <div><b>To pivot</b>: the close against the pivot (the buy point; for bearish patterns the breakdown level) in the pattern&apos;s direction — −5% means 5% short of it. Patterns are as of the date shown; a company read during a session (◷) uses that day&apos;s unfinished bar.</div>
          <div>Not advice — a pattern is a starting point for a chart review. Click a ticker to open its chart; Next / Previous on the chart step through this list.</div>
        </div>
      </details>

      <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.bg1, position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={th}>#</th>
              <Th label="Company" k="t" sort={sort} setSort={setSort} />
              <Th label="Pattern" k="pattern" sort={sort} setSort={setSort} />
              <Th label="Likelihood" k="conf" sort={sort} setSort={setSort} num />
              <Th label="Pivot" k="pivot" sort={sort} setSort={setSort} num />
              <Th label="To pivot" k="dist" sort={sort} setSort={setSort} num />
              <Th label="Length" k="len" sort={sort} setSort={setSort} num />
              {q.cols.map((k) => <Th key={k} label={COL_SHORT[k] || fieldOf(k)?.label || k} k={k} sort={sort} setSort={setSort} num title={fieldOf(k)?.label} />)}
              <Th label="Price" k="px" sort={sort} setSort={setSort} num />
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
              const turn = turnoverOf(r, market);
              return (
                <tr key={r.t} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ ...td, color: C.dim }}>{i + 1}</td>
                  <td style={td}>
                    <Link href={`/charts?t=${encodeURIComponent(r.t)}&m=${market}&tf=D`} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); window.location.assign(openForReview(r)); }}
                      style={{ color: C.accent, fontWeight: 700, textDecoration: 'none' }} title="Open the chart — Next / Previous on the chart step through these results in this order">{r.t}</Link>
                    {(r as Row).live ? <span title="Read during a trading session: the latest bar was unfinished" style={{ color: C.amber, marginLeft: 4 }}>◷</span> : null}
                    <div style={{ fontSize: 11.5, color: C.dim, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.n}</div>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 360 }}>
                      {tags.map((t) => <PatternChip key={t.id} t={t} main={t === b} market={market} patAt={r.patAt} />)}
                    </div>
                  </td>
                  {b ? (
                    <>
                      <td style={{ ...td, ...numTd }} title={`${likelihoodWord(b.c)} (${b.c}/100)`}>{b.c} <span style={{ fontSize: 11, color: C.dim }}>{likelihoodWord(b.c)}</span></td>
                      <td style={{ ...td, ...numTd }}>{fmtValue(b.p, 'price', market)}</td>
                      <td style={{ ...td, ...numTd, color: dd == null ? C.dim : dd >= 0 ? (b.b === 'U' ? C.green : C.red) : C.text }} title={b.d == null ? '' : `close ${Math.abs(b.d).toFixed(1)}% ${b.d < 0 ? 'below' : 'above'} the ${b.b === 'U' ? 'pivot' : 'breakdown level'}`}>{pct(dd)}</td>
                      <td style={{ ...td, ...numTd }} title={b.dp != null ? `${b.dp}% deep` : ''}>{b.l != null ? (b.l >= 10 ? `${Math.max(1, Math.round(b.l / 5))} wk` : `${b.l} d`) : '—'}</td>
                    </>
                  ) : <td colSpan={4} style={{ ...td, color: C.dim, fontSize: 12 }}>no matching chart pattern</td>}
                  {q.cols.map((k) => {
                    const d = fieldOf(k); const v = (r as any)[k] as number | null | undefined; const ax = r.approx?.includes(k);
                    return <td key={k} style={{ ...td, ...numTd }} title={[d?.label, ax ? `Approximate — ${d?.approxNote?.[market] || ''}` : ''].filter(Boolean).join('\n')}>{ax && v != null ? '≈' : ''}{fmtCol(k, v, market)}</td>;
                  })}
                  <td style={{ ...td, ...numTd }}>{fmtValue(r.px, 'price', market)}</td>
                  <td style={{ ...td, ...numTd, color: typeof r.chg === 'number' ? (r.chg >= 0 ? C.green : C.red) : C.dim }}>{pct(r.chg)}</td>
                  <td style={{ ...td, ...numTd }}>{fmtValue(r.mc, 'money', market)}</td>
                  <td style={{ ...td, ...numTd, color: typeof r[q.perfKey] === 'number' ? ((r[q.perfKey] as number) >= 0 ? C.green : C.red) : C.dim }}>{pct(r[q.perfKey] as number | null | undefined, 0)}</td>
                  <td style={{ ...td, ...numTd }}>{typeof r.rsi === 'number' ? Math.round(r.rsi) : '—'}</td>
                  <td style={{ ...td, ...numTd }} title={`price × 30-day average volume, ${money}`}>{fmtValue(turn, 'money', market)}</td>
                  <td style={{ ...td, fontSize: 12, color: C.dim, maxWidth: 160 }}>{r.tvSec || r.sec || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {narrowed.length > 200 ? <div style={{ padding: 8, textAlign: 'center' }}><button type="button" style={btn()} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show the first 200' : `Show all ${narrowed.length}`}</button></div> : null}
        {snap && !hits.length ? (
          <div style={{ padding: 14, color: C.dim, fontSize: 13 }}>
            {notScanned ? 'No patterns yet — they are added by the next screener build of this market.'
              : !rows.length ? 'No companies in the stored data yet.'
              : 'No company matches. Widen the pivot window, lower the likelihood, add a stage or untick patterns — the number on each pattern shows where the matches are.'}
          </div>
        ) : null}
      </div>
      <div style={{ fontSize: 11.5, color: C.dim }}>Defaults: <button type="button" style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { setQ(clone({ ...DEFAULT_QUERY, bias: q.bias })); setDirty(true); }}>reset every choice</button> (likely or better, forming + breakout, −15% to +5% from the pivot).</div>
    </div>
  );
}

function PatternChip({ t, main, market, patAt }: { t: ScreenPatternTag; main: boolean; market: ScreenMarket; patAt?: string }) {
  const m = PATTERN_META[t.id];
  const col = t.b === 'U' ? C.green : C.red;
  const tip = [`${m.label} (${m.bias}) — ${stageWord(t)}, ${likelihoodWord(t.c)} (${t.c}/100)`,
    t.p != null ? `${t.b === 'U' ? 'Pivot' : 'Breakdown level'} ${fmtValue(t.p, 'price', market)}${t.d != null ? `, close ${Math.abs(t.d).toFixed(1)}% ${t.d < 0 ? 'below' : 'above'}` : ''}` : '',
    t.l != null ? `${t.l >= 10 ? `${Math.round(t.l / 5)} weeks` : `${t.l} days`} long${t.dp != null ? `, ${t.dp}% deep` : ''}` : '',
    m.short, patAt ? `As of the ${patAt} close` : ''].filter(Boolean).join('\n');
  return (
    <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 999, fontSize: 11.5, fontWeight: main ? 800 : 600, whiteSpace: 'nowrap',
      border: `1px solid ${col}`, background: main ? col : 'transparent', color: main ? '#fff' : col, opacity: t.s === 'x' ? 0.75 : 1 }}>
      <span aria-hidden>{STAGE_GLYPH(t)}</span>{m.label}<span style={{ opacity: 0.8, fontWeight: 600 }}>{t.c}</span>
    </span>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', fontSize: 11.5, fontWeight: 800, color: 'var(--mc-text-3, #6b7280)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
const numTd: React.CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
function Th({ label, k, sort, setSort, num, title }: { label: string; k: string; sort: { key: string; dir: 1 | -1 }; setSort: (s: { key: string; dir: 1 | -1 }) => void; num?: boolean; title?: string }) {
  const on = sort.key === k;
  return (
    <th style={{ ...th, textAlign: num ? 'right' : 'left' }} title={title}>
      <button type="button" onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : num ? -1 : 1 })} style={{ all: 'unset', cursor: 'pointer', color: on ? 'var(--mc-accent)' : undefined }}>
        {label} {on ? (sort.dir === -1 ? '▼' : '▲') : ''}
      </button>
    </th>
  );
}
