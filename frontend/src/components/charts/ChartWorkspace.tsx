'use client';
// zzz937 — the /charts workspace: candles (D / W / M), moving averages, volume with its average, drawings saved per ticker,
// a measure tool and the header numbers. Chart engine: KLineChart (Apache-2.0), loaded in the browser only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Chart, DeepPartial, KLineData, OverlayCreate, Styles } from 'klinecharts';
import {
  RANGE_KEYS, barIndexAt, cleanTicker, dataRangeFor, drawingKey, fmtMoney, fmtPrice, rangeStart, sanitizeSettings, validTicker,
  type ChartSettings, type DrawingName, type HeaderStats, type Market, type RangeKey, type SavedDrawing, type Timeframe,
} from '@/lib/chart-math';
import { CHART_DRAWINGS_KEY, loadDrawings, loadSettings, saveDrawings, saveSettings } from '@/lib/chart-storage';
import WatchlistPanel, { AddToWatchlist, useWatchlistStore } from './WatchlistPanel';

type KC = typeof import('klinecharts');
type Tool = 'cursor' | 'mcHLine' | 'segment' | 'rayLine' | 'mcRect' | 'parallelStraightLine' | 'fibonacciLine' | 'mcText' | 'mcMeasure';
interface ChartResponse {
  ok: boolean; error?: string; ticker: string; market: Market; name: string | null; currency: string | null; exchange: string | null;
  stats: HeaderStats; bars: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
}

const DRAW_GROUP = 'mc-draw';
const MEASURE_GROUP = 'mc-measure';
const VOL_PANE = 'mc_vol_pane';
const TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: 'cursor', label: 'Cursor', icon: '↖', hint: 'Move and select (Esc)' },
  { id: 'mcHLine', label: 'Horizontal line', icon: '━', hint: 'Support / resistance line: click once' },
  { id: 'segment', label: 'Trend line', icon: '╱', hint: 'Trend line: click start, then end' },
  { id: 'rayLine', label: 'Ray', icon: '↗', hint: 'Ray: click start, then direction' },
  { id: 'mcRect', label: 'Rectangle', icon: '▭', hint: 'Rectangle: click two corners' },
  { id: 'parallelStraightLine', label: 'Channel', icon: '⫽', hint: 'Parallel channel: three clicks' },
  { id: 'fibonacciLine', label: 'Fibonacci', icon: 'ℱ', hint: 'Fibonacci levels: click two points' },
  { id: 'mcText', label: 'Text', icon: 'T', hint: 'Text note: click where it goes' },
  { id: 'mcMeasure', label: 'Measure', icon: '⇲', hint: 'Measure: click A, then B' },
];
const PANEL_OPEN_KEY = 'mc:chart-panel-open';   // per-browser convenience only
const LAYOUT_CSS = `
.mc-charts-root { height: calc(100vh - 72px); min-height: 520px; }
.mc-charts-main { display: flex; flex: 1; min-height: 0; gap: 8px; }
.mc-charts-left { display: flex; flex: 1; min-width: 0; min-height: 0; gap: 8px; }
.mc-charts-panel { width: 360px; flex-shrink: 0; min-height: 0; }
@media (max-width: 900px) {
  .mc-charts-root { height: auto; }
  .mc-charts-main { flex-direction: column; }
  .mc-charts-left { height: 62vh; flex: none; }
  .mc-charts-panel { width: 100%; height: 70vh; }
}
`;
const TF_TO_INTERVAL: Record<Timeframe, string> = { D: '1d', W: '1wk', M: '1mo' };
const TF_TO_PERIOD = { D: { type: 'day', span: 1 }, W: { type: 'week', span: 1 }, M: { type: 'month', span: 1 } } as const;

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
/** 0 (black) … 1 (white) for a #rrggbb colour; null if it is not one. */
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** A near-black line (EMA 89 by default) would vanish on the dark theme: draw it light grey there instead. */
function visibleOnTheme(color: string): string {
  const bg = luminance(cssVar('--mc-bg-0', '#ffffff'));
  const c = luminance(color);
  return bg != null && c != null && bg < 0.3 && c < 0.18 ? '#E5E7EB' : color;
}
function themeSignature(): string {
  return ['--mc-bg-0', '--mc-text-3', '--mc-border-1', '--mc-border-3'].map((n) => cssVar(n, '')).join('|');
}
function themeStyles(): DeepPartial<Styles> {
  const text = cssVar('--mc-text-3', '#475569');
  const grid = cssVar('--mc-border-3', '#E2E8F0');
  const axis = cssVar('--mc-border-1', '#CBD5E1');
  const up = '#26A69A', down = '#EF5350';
  const legend = { color: text, size: 12 };
  return {
    grid: { horizontal: { color: grid, style: 'solid' }, vertical: { color: grid, style: 'solid' } },
    candle: {
      bar: { upColor: up, downColor: down, upBorderColor: up, downBorderColor: down, upWickColor: up, downWickColor: down },
      priceMark: { last: { upColor: up, downColor: down }, high: { color: text }, low: { color: text } },
      tooltip: { title: { show: false }, legend },
    },
    indicator: { tooltip: { title: { color: text }, legend } },
    xAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: text } },
    yAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: text } },
    separator: { color: axis },
  };
}

export default function ChartWorkspace() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialMarket: Market = (sp.get('m') || '').toUpperCase() === 'IN' ? 'IN' : 'US';
  const initialTicker = (() => { const t = cleanTicker(sp.get('t') || ''); return validTicker(initialMarket, t) ? t : initialMarket === 'IN' ? 'RELIANCE' : 'QQQ'; })();
  const initialTf: Timeframe = (['D', 'W', 'M'] as const).find((x) => x === (sp.get('tf') || '').toUpperCase()) || 'W';

  const [market, setMarket] = useState<Market>(initialMarket);
  const [ticker, setTicker] = useState(initialTicker);
  const [tf, setTf] = useState<Timeframe>(initialTf);
  const [range, setRange] = useState<RangeKey>(initialTf === 'D' ? '1Y' : initialTf === 'W' ? '5Y' : 'All');
  const [query, setQuery] = useState(initialTicker);
  const [queryMarket, setQueryMarket] = useState<Market>(initialMarket);
  const [info, setInfo] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [settings, setSettings] = useState<ChartSettings>(() => sanitizeSettings(null));
  const [showSettings, setShowSettings] = useState(false);
  const [tool, setTool] = useState<Tool>('cursor');
  const [drawColor, setDrawColor] = useState('#2962FF');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [wlStore, wlUpdate] = useWatchlistStore();
  // this component only renders in the browser (next/dynamic, ssr:false), so storage can be read on first render
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem(PANEL_OPEN_KEY) !== '0'; } catch { return true; } });
  const togglePanel = () => setPanelOpen((v) => { try { localStorage.setItem(PANEL_OPEN_KEY, v ? '0' : '1'); } catch { /* storage blocked */ } return !v; });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const kcRef = useRef<KC | null>(null);
  const barsRef = useRef<KLineData[]>([]);
  const keyRef = useRef<string>('');
  const suppressSaveRef = useRef(false);
  const cacheRef = useRef(new Map<string, ChartResponse>());
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const dataRange = dataRangeFor(tf, range);

  // keep the URL linkable: /charts?t=QQQ&m=US&tf=W
  useEffect(() => {
    const q = `?t=${encodeURIComponent(ticker)}&m=${market}&tf=${tf}`;
    if (typeof window !== 'undefined' && window.location.search !== q) router.replace(`/charts${q}`, { scroll: false });
  }, [ticker, market, tf, router]);

  // ── drawings ────────────────────────────────────────────────────────────────
  const persist = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || suppressSaveRef.current || !keyRef.current) return;
    const list: SavedDrawing[] = chart.getOverlays({ groupId: DRAW_GROUP })
      .filter((o) => o.currentStep === -1)
      .map((o) => ({
        name: o.name as DrawingName,
        points: o.points.filter((p) => typeof p.timestamp === 'number' && typeof p.value === 'number').map((p) => ({ t: p.timestamp as number, p: p.value as number })),
        ...(typeof o.extendData === 'string' ? { text: o.extendData } : {}),
        ...((o.styles as any)?.line?.color ? { color: String((o.styles as any).line.color) } : {}),
      }));
    saveDrawings(keyRef.current, list);
  }, []);
  const persistSoon = useCallback(() => { setTimeout(persist, 0); }, [persist]);

  const finishDrawing = useCallback(() => { setTool('cursor'); }, []);

  const overlaySpec = useCallback((name: DrawingName, color: string, extra: Partial<OverlayCreate> = {}): OverlayCreate => ({
    name,
    groupId: DRAW_GROUP,
    styles: { line: { color, size: name === 'mcHLine' ? 1.5 : 1.5 }, text: { color: '#ffffff', backgroundColor: color, borderColor: color } },
    onDrawEnd: () => { persistSoon(); finishDrawing(); },
    onPressedMoveEnd: () => persistSoon(),
    onRemoved: () => persistSoon(),
    onSelected: (e) => setSelectedId(e.overlay.id),
    onDeselected: () => setSelectedId(null),
    ...extra,
  }), [persistSoon, finishDrawing]);

  const restoreDrawings = useCallback((key: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    suppressSaveRef.current = true;
    chart.removeOverlay({ groupId: DRAW_GROUP });
    chart.removeOverlay({ groupId: MEASURE_GROUP });
    keyRef.current = key;
    for (const d of loadDrawings(key)) {
      chart.createOverlay(overlaySpec(d.name, d.color || '#2962FF', {
        points: d.points.map((p) => ({ timestamp: p.t, value: p.p })),
        ...(d.text ? { extendData: d.text } : {}),
      }));
    }
    setSelectedId(null);
    setTool('cursor');
    setTimeout(() => { suppressSaveRef.current = false; }, 0);
  }, [overlaySpec]);

  // ── indicators ──────────────────────────────────────────────────────────────
  const applyIndicators = useCallback((s: ChartSettings) => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.removeIndicator({ name: 'MC_EMA' });
    const on = s.emas.filter((e) => e.on);
    if (on.length) {
      chart.createIndicator({
        name: 'MC_EMA', paneId: 'candle_pane', calcParams: on.map((e) => e.period),
        styles: { lines: on.map((e) => ({ color: visibleOnTheme(e.color), size: 1.5, style: 'solid', smooth: false, dashedValue: [2, 2] })) },
      }, true);
    }
    chart.removeIndicator({ name: 'VOL' });
    if (s.showVolume) {
      chart.createIndicator({ name: 'VOL', paneId: VOL_PANE, calcParams: [s.volAvg], styles: { lines: [{ color: '#F59E0B', size: 1.5, style: 'solid', smooth: false, dashedValue: [2, 2] }] } });
      chart.setPaneOptions({ id: VOL_PANE, height: 110 });
    }
  }, []);

  // ── visible range ───────────────────────────────────────────────────────────
  const applyRange = useCallback((r: RangeKey) => {
    const chart = chartRef.current;
    const bars = barsRef.current;
    if (!chart || !bars.length) return;
    const width = chart.getSize('candle_pane', 'main')?.width || (containerRef.current?.clientWidth || 800) - 70;
    const times = bars.map((b) => b.timestamp);
    const start = rangeStart(r, times[times.length - 1]);
    const firstIdx = start == null ? 0 : Math.max(0, barIndexAt(times, start - 1) + 1);
    const n = Math.max(8, bars.length - firstIdx);
    const pad = Math.max(3, Math.round(n * 0.04));
    const space = Math.min(40, Math.max(0.3, width / (n + pad)));
    chart.setBarSpace(space);
    chart.setOffsetRightDistance(pad * space);
    chart.scrollToRealTime();
  }, []);

  // ── create the chart once ─────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    const el = containerRef.current;
    (async () => {
      const mod = await import('./kline-setup');
      if (disposed || !el) return;
      const kc = mod.registerChartExtras();
      kcRef.current = kc;
      const chart = kc.init(el, {
        locale: 'en-US', timezone: 'UTC', styles: themeStyles(),
        layout: { barSpaceLimit: { min: 0.3, max: 60 } },
      });
      if (!chart) { setError('The chart could not start in this browser.'); return; }
      chartRef.current = chart;
      chart.setDataLoader({ getBars: ({ type, callback }) => { callback(type === 'init' ? barsRef.current : [], false); } });
      const s = loadSettings();
      setSettings(s);
      applyIndicators(s);
      ro = new ResizeObserver(() => chart.resize());
      ro.observe(el);
      // The page's <html> class changes for many reasons; only re-style when the colours really changed — re-creating the
      // indicators mid-drawing would cancel a half-drawn line.
      let sig = themeSignature();
      mo = new MutationObserver(() => {
        const next = themeSignature();
        if (next === sig) return;
        sig = next;
        chart.setStyles(themeStyles());
        applyIndicators(settingsRef.current);
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      setReady(true);
    })().catch(() => setError('The chart library failed to load.'));
    return () => {
      disposed = true;
      ro?.disconnect(); mo?.disconnect();
      if (el && kcRef.current) kcRef.current.dispose(el);
      chartRef.current = null;
    };
  }, [applyIndicators]);

  // ── load data when ticker / timeframe / needed history changes ────────────
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const url = `/api/v1/chart/${encodeURIComponent(ticker)}?market=${market}&interval=${TF_TO_INTERVAL[tf]}&range=${dataRange}`;
    const show = (j: ChartResponse) => {
      const chart = chartRef.current;
      if (!chart) return;
      const b = j.bars;
      barsRef.current = b.t.map((t, i) => ({ timestamp: t, open: b.o[i], high: b.h[i], low: b.l[i], close: b.c[i], volume: b.v[i] }));
      const last = b.c[b.c.length - 1] ?? 1;
      chart.setPeriod(TF_TO_PERIOD[tf] as any);
      chart.setSymbol({ ticker: `${ticker}`, pricePrecision: Math.abs(last) < 1 ? 4 : 2, volumePrecision: 0 });
      setInfo(j);
      setError(null);
      restoreDrawings(drawingKey(market, ticker));
      setLoadedVersion((v) => v + 1);
    };
    const cached = cacheRef.current.get(url);
    if (cached) { show(cached); return; }
    setLoading(true);
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as ChartResponse | null;
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Could not load ${ticker} (HTTP ${r.status}).`);
        cacheRef.current.set(url, j);
        show(j);
      })
      .catch((e) => { if (!ctrl.signal.aborted) setError(String(e?.message || e)); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [ready, ticker, market, tf, dataRange, restoreDrawings]);

  // zoom to the chosen range after each load and whenever the range buttons change
  useEffect(() => {
    if (!loadedVersion) return;
    const id = requestAnimationFrame(() => applyRange(range));
    return () => cancelAnimationFrame(id);
  }, [loadedVersion, range, applyRange]);

  // ── tools ───────────────────────────────────────────────────────────────────
  const cancelDrawing = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const o of chart.getOverlays()) if (o.currentStep !== -1) chart.removeOverlay({ id: o.id });
    chart.removeOverlay({ groupId: MEASURE_GROUP });
    finishDrawing();
  }, [finishDrawing]);

  const pickTool = useCallback((t: Tool) => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const o of chart.getOverlays()) if (o.currentStep !== -1) chart.removeOverlay({ id: o.id });
    setNote(null);
    if (t === 'cursor') { finishDrawing(); return; }
    if (t === 'mcMeasure') {
      chart.removeOverlay({ groupId: MEASURE_GROUP });
      chart.createOverlay({ name: 'mcMeasure', groupId: MEASURE_GROUP, onDrawEnd: () => finishDrawing(), onSelected: (e) => setSelectedId(e.overlay.id), onDeselected: () => setSelectedId(null) });
      setTool(t);
      return;
    }
    if (t === 'mcText') {
      const text = typeof window !== 'undefined' ? window.prompt('Text for the note:') : null;
      if (!text || !text.trim()) { finishDrawing(); return; }
      chart.createOverlay(overlaySpec('mcText', drawColor, { extendData: text.trim().slice(0, 200) }));
      setTool(t);
      return;
    }
    chart.createOverlay(overlaySpec(t, drawColor));
    setTool(t);
  }, [overlaySpec, drawColor, finishDrawing]);

  const deleteSelected = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!selectedId) { setNote('Click a drawing first, then press Delete one.'); return; }
    chart.removeOverlay({ id: selectedId });
    setSelectedId(null);
    persistSoon();
  }, [selectedId, persistSoon]);

  const clearAll = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const n = chart.getOverlays({ groupId: DRAW_GROUP }).length;
    if (n && typeof window !== 'undefined' && !window.confirm(`Remove all ${n} drawing${n === 1 ? '' : 's'} on ${ticker}?`)) return;
    suppressSaveRef.current = true;
    chart.removeOverlay({ groupId: DRAW_GROUP });
    chart.removeOverlay({ groupId: MEASURE_GROUP });
    suppressSaveRef.current = false;
    saveDrawings(keyRef.current, []);
    setSelectedId(null);
  }, [ticker]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') cancelDrawing();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelDrawing, deleteSelected, selectedId]);

  // ── settings ────────────────────────────────────────────────────────────────
  const updateSettings = useCallback((next: ChartSettings) => {
    const s = sanitizeSettings(next);
    setSettings(s);
    saveSettings(s);
    applyIndicators(s);
  }, [applyIndicators]);

  // a watchlist row (or ↑/↓) loads that ticker; timeframe and range stay as they are
  const pickFromList = useCallback((m: Market, t: string) => {
    setQuery(t); setQueryMarket(m); setMarket(m); setTicker(t); setError(null);
  }, []);

  // drawings changed on another device and were just brought down: show them
  useEffect(() => {
    const onRestored = (e: Event) => {
      const keys = (e as CustomEvent).detail?.keys;
      if (Array.isArray(keys) && keys.includes(CHART_DRAWINGS_KEY) && keyRef.current) restoreDrawings(keyRef.current);
    };
    window.addEventListener('mc:vault:restored', onRestored);
    return () => window.removeEventListener('mc:vault:restored', onRestored);
  }, [restoreDrawings]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const t = cleanTicker(query);
    if (!validTicker(queryMarket, t)) { setError(`"${query}" does not look like a ${queryMarket === 'IN' ? 'NSE / BSE' : 'US'} ticker.`); return; }
    setQuery(t);
    setMarket(queryMarket);
    setTicker(t);
  };

  const stats = info?.stats;
  const cur = market === 'IN' ? '₹' : '$';
  const changeColor = (stats?.change ?? 0) >= 0 ? 'var(--mc-bullish, #059669)' : 'var(--mc-bearish, #DC2626)';
  const activeHint = useMemo(() => TOOLS.find((t) => t.id === tool)?.hint, [tool]);

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`,
    background: active ? 'var(--mc-accent)' : 'var(--mc-bg-1)', color: active ? '#ffffff' : 'var(--mc-text-1)',
  });

  return (
    <div className="mc-charts-root" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', color: 'var(--mc-text-1)' }}>
      <style>{LAYOUT_CSS}</style>
      {/* search + timeframe + range */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <form onSubmit={submitSearch} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select aria-label="Market" value={queryMarket} onChange={(e) => setQueryMarket(e.target.value as Market)}
            style={{ ...btn(false), padding: '4px 6px' }}>
            <option value="US">US</option>
            <option value="IN">India</option>
          </select>
          <input aria-label="Ticker" value={query} onChange={(e) => setQuery(e.target.value.toUpperCase())} placeholder="Ticker, e.g. QQQ"
            style={{ width: 150, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-0)', fontSize: 13 }} />
          <button type="submit" style={btn(false)}>Open</button>
        </form>
        <span style={{ width: 1, height: 22, background: 'var(--mc-border-1)' }} />
        {(['D', 'W', 'M'] as Timeframe[]).map((x) => (
          <button key={x} type="button" title={x === 'D' ? 'Daily' : x === 'W' ? 'Weekly' : 'Monthly'} style={btn(tf === x)} onClick={() => setTf(x)}>{x}</button>
        ))}
        <span style={{ width: 1, height: 22, background: 'var(--mc-border-1)' }} />
        {RANGE_KEYS.map((r) => (
          <button key={r} type="button" style={btn(range === r)} onClick={() => setRange(r)}>{r}</button>
        ))}
        <span style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <button type="button" style={btn(showSettings)} onClick={() => setShowSettings((v) => !v)}>Moving averages ▾</button>
          {showSettings && (
            <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />
          )}
        </div>
        <button type="button" style={btn(panelOpen)} onClick={togglePanel} title="Show or hide the watchlist panel">Watchlist</button>
      </div>

      {/* header numbers */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px', fontSize: 13 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--mc-text-0)' }}>{ticker}</span>
        <AddToWatchlist store={wlStore} update={wlUpdate} market={market} ticker={ticker} />
        <span style={{ color: 'var(--mc-text-3)' }}>{info?.name || ''}{info?.exchange ? ` · ${info.exchange}` : ''}</span>
        {stats?.last != null && (
          <span style={{ fontWeight: 700, color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums' }}>
            {cur}{fmtPrice(stats.last, Math.abs(stats.last) < 1 ? 4 : 2)}{' '}
            {stats.change != null && stats.changePct != null && (
              <span style={{ color: changeColor }}>{stats.change >= 0 ? '+' : ''}{fmtPrice(stats.change, 2)} ({stats.changePct >= 0 ? '+' : ''}{stats.changePct.toFixed(2)}%)</span>
            )}
          </span>
        )}
        <Stat label="ADR%" value={stats?.adrPct != null ? `${stats.adrPct.toFixed(2)}%` : '—'} title="Average daily range over the last 20 days: average of (high ÷ low − 1)" />
        <Stat label="RVol" value={stats?.rvol != null ? `${stats.rvol.toFixed(2)}×` : '—'} title="Today's volume ÷ the average volume of the 20 days before it" />
        <Stat label={market === 'IN' ? 'Avg ₹ Vol' : 'Avg $ Vol'} value={fmtMoney(stats?.avgValue ?? null, market)} title="Average traded value (close × volume) over the last 20 days" />
        {loading && <span style={{ color: 'var(--mc-text-3)' }}>Loading…</span>}
        {error && <span style={{ color: 'var(--mc-bearish, #DC2626)' }}>{error}</span>}
      </div>

      <div className="mc-charts-main">
      <div className="mc-charts-left">
        {/* drawing toolbar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 40, flexShrink: 0 }}>
          {TOOLS.map((t) => (
            <button key={t.id} type="button" title={t.label} aria-label={t.label} onClick={() => pickTool(t.id)}
              style={{ ...btn(tool === t.id), width: 40, height: 34, padding: 0, fontSize: 16 }}>{t.icon}</button>
          ))}
          <label title="Colour for new drawings" style={{ ...btn(false), width: 40, height: 34, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} aria-label="Drawing colour"
              style={{ width: 24, height: 24, border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }} />
          </label>
          <button type="button" title="Delete the selected drawing (or press Delete)" aria-label="Delete one" onClick={deleteSelected}
            style={{ ...btn(false), width: 40, height: 34, padding: 0, fontSize: 15, opacity: selectedId ? 1 : 0.6 }}>⌫</button>
          <button type="button" title="Remove all drawings on this ticker" aria-label="Clear all" onClick={clearAll}
            style={{ ...btn(false), width: 40, height: 34, padding: 0, fontSize: 15 }}>🗑</button>
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0, border: '1px solid var(--mc-border-1)', borderRadius: 8, background: 'var(--mc-bg-0)', overflow: 'hidden' }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          {(tool !== 'cursor' || note) && (
            <div style={{ position: 'absolute', right: 80, top: 8, padding: '3px 8px', borderRadius: 6, fontSize: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', color: 'var(--mc-text-2)', pointerEvents: 'none' }}>
              {note || `${activeHint} · Esc to cancel`}
            </div>
          )}
        </div>
      </div>
      {panelOpen && (
        <div className="mc-charts-panel">
          <WatchlistPanel store={wlStore} update={wlUpdate} currentKey={`${market}:${ticker}`} onPick={pickFromList} />
        </div>
      )}
      </div>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <span title={title} style={{ color: 'var(--mc-text-3)' }}>
      {label} <b style={{ color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </span>
  );
}

function SettingsPanel({ settings, onChange, onClose }: { settings: ChartSettings; onChange: (s: ChartSettings) => void; onClose: () => void }) {
  const set = (i: number, patch: Partial<ChartSettings['emas'][number]>) => onChange({ ...settings, emas: settings.emas.map((e, k) => (k === i ? { ...e, ...patch } : e)) });
  const input: React.CSSProperties = { width: 64, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-0)', fontSize: 13 };
  return (
    <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, width: 280, padding: 12, borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontWeight: 700, color: 'var(--mc-text-0)' }}>
        <span>Moving averages (EMA)</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-text-3)', fontSize: 16 }}>×</button>
      </div>
      {settings.emas.map((e, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <input type="checkbox" checked={e.on} onChange={(ev) => set(i, { on: ev.target.checked })} aria-label={`Show EMA ${e.period}`} />
          <input type="number" min={1} max={500} value={e.period} onChange={(ev) => set(i, { period: Number(ev.target.value) })} style={input} aria-label="Period" />
          <input type="color" value={e.color} onChange={(ev) => set(i, { color: ev.target.value })} aria-label="Colour" style={{ width: 32, height: 24, border: 'none', background: 'transparent', padding: 0 }} />
          <button type="button" onClick={() => onChange({ ...settings, emas: settings.emas.filter((_, k) => k !== i) })} aria-label="Remove line"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-text-3)' }}>remove</button>
        </div>
      ))}
      {settings.emas.length < 10 && (
        <button type="button" onClick={() => onChange({ ...settings, emas: [...settings.emas, { period: 200, color: '#607D8B', on: true }] })}
          style={{ marginBottom: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-accent)', padding: 0 }}>+ Add a line</button>
      )}
      <div style={{ borderTop: '1px solid var(--mc-border-1)', paddingTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={settings.showVolume} onChange={(ev) => onChange({ ...settings, showVolume: ev.target.checked })} aria-label="Show volume" />
        <span>Volume, with average of</span>
        <input type="number" min={1} max={200} value={settings.volAvg} onChange={(ev) => onChange({ ...settings, volAvg: Number(ev.target.value) })} style={{ ...input, width: 52 }} aria-label="Volume average length" />
        <span>bars</span>
      </div>
      <div style={{ marginTop: 8, color: 'var(--mc-text-3)', fontSize: 12 }}>Saved on this device and synced to your account.</div>
    </div>
  );
}
