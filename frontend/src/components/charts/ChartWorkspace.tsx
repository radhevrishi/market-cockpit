'use client';
// zzz937 — the /charts workspace: candles (D / W / M), moving averages, volume with its average, drawings saved per ticker,
// a measure tool and the header numbers. Chart engine: KLineChart (Apache-2.0), loaded in the browser only.
// zzz944 — named layouts (indicator sets) with Save / Save as, more indicators, a TradingView-style legend, "✓ saved" note.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Chart, DeepPartial, KLineData, OverlayCreate, Styles } from 'klinecharts';
import {
  RANGE_KEYS, atr, barIndexAt, cleanTicker, dataRangeFor, drawingKey, fmtMoney, fmtPrice, macd, rangeStart, rsi, validTicker,
  type Bar, type DrawingName, type HeaderStats, type Market, type RangeKey, type SavedDrawing, type Timeframe,
} from '@/lib/chart-math';
import { CHART_DRAWINGS_KEY, loadDrawings, saveDrawings } from '@/lib/chart-storage';
import { EXTRA_INFO, legendRows, priceSeriesOf, seriesValues, toggleRow, type ChartLayout, type LegendRow } from '@/lib/chart-layouts';
import WatchlistPanel, { AddToWatchlist, useWatchlistStore } from './WatchlistPanel';
import { IndicatorLegend, IndicatorsPanel, LayoutPicker, useLayouts } from './LayoutControls';

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
const FOCUS_KEY = 'mc:chart-focus:v1';           // zzz946 — focus mode on/off, this browser only
const LAYOUT_CSS = `
.mc-charts-root { height: calc(100vh - 72px); min-height: 520px; }
/* zzz946 — focus mode: the site's top bar and left menu are hidden so the chart + watchlist fill the window */
html.mc-chart-focus .desktop-sidebar, html.mc-chart-focus header { display: none !important; }
html.mc-chart-focus .mc-charts-root { height: 100vh; padding-top: 8px !important; }
.mc-scale-btn { width: 22px; height: 20px; padding: 0; font-size: 11px; font-weight: 700; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--mc-border-1); background: var(--mc-bg-1); color: var(--mc-text-3); }
.mc-scale-btn.on { background: var(--mc-accent); border-color: var(--mc-accent); color: #fff; }
.mc-charts-main { display: flex; flex: 1; min-height: 0; gap: 8px; }
.mc-charts-left { display: flex; flex: 1; min-width: 0; min-height: 0; gap: 8px; }
.mc-charts-panel { width: 400px; flex-shrink: 0; min-height: 0; }
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
  // zzz943: read from the chart page itself — it can be white while the site is dark
  const root = document.querySelector('.mc-charts-root') || document.documentElement;
  const v = getComputedStyle(root).getPropertyValue(name).trim();
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
  const L = useLayouts();
  const [showIndicators, setShowIndicators] = useState(false);
  const [bars, setBars] = useState<Bar[]>([]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>('cursor');
  const [drawColor, setDrawColor] = useState('#2962FF');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [wlStore, wlUpdate] = useWatchlistStore();
  // this component only renders in the browser (next/dynamic, ssr:false), so storage can be read on first render
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem(PANEL_OPEN_KEY) !== '0'; } catch { return true; } });
  // zzz943: white chart page (TradingView's white view) by default, whatever the site theme; one click to dark
  const [chartLight, setChartLight] = useState(() => { try { return localStorage.getItem('mc:chart-light:v1') !== '0'; } catch { return true; } });
  const toggleLight = () => setChartLight((v) => { try { localStorage.setItem('mc:chart-light:v1', v ? '0' : '1'); } catch { /* storage blocked */ } return !v; });
  // zzz946 — focus mode (remembered in this browser only) and the browser's own full screen
  const [focus, setFocus] = useState(() => { try { return localStorage.getItem(FOCUS_KEY) === '1'; } catch { return false; } });
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
    try { localStorage.setItem(FOCUS_KEY, focus ? '1' : '0'); } catch { /* storage blocked */ }
    const html = document.documentElement;
    html.classList.toggle('mc-chart-focus', focus);
    return () => { html.classList.remove('mc-chart-focus'); };
  }, [focus]);
  const [focusMenu, setFocusMenu] = useState(false);
  const browserFullScreen = () => {
    setFocusMenu(false);
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else { setFocus(true); void document.documentElement.requestFullscreen?.(); }
    } catch { /* not allowed here */ }
  };
  const rangeRef = useRef(range);
  useEffect(() => { rangeRef.current = range; }, [range]);
  const togglePanel = () => setPanelOpen((v) => { try { localStorage.setItem(PANEL_OPEN_KEY, v ? '0' : '1'); } catch { /* storage blocked */ } return !v; });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const kcRef = useRef<KC | null>(null);
  const barsRef = useRef<KLineData[]>([]);
  const keyRef = useRef<string>('');
  const suppressSaveRef = useRef(false);
  const cacheRef = useRef(new Map<string, ChartResponse>());
  const workingRef = useRef<ChartLayout>(L.working);
  useEffect(() => { workingRef.current = L.working; }, [L.working]);
  const toolRef = useRef<string>('cursor');

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
    const at = saveDrawings(keyRef.current, list);
    if (at != null) setSavedAt(at);
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

  // ── price scale (zzz946): A = fit the candles on screen, L = log scale ─────────
  const [manualScale, setManualScale] = useState(false);   // the price axis was dragged by hand (A shows off until reset)
  const applyScale = useCallback((lay: ChartLayout) => {
    const chart = chartRef.current;
    if (!chart) return;
    const name = lay.scale.auto ? (lay.scale.log ? 'mcFitLog' : 'mcFit') : (lay.scale.log ? 'mcLog' : 'normal');
    chart.overrideYAxis({ paneId: 'candle_pane', name });   // re-creating the axis also drops any hand-dragged zoom
    setManualScale(false);
  }, []);

  // ── indicators (zzz944: from the working layout) ─────────────────────────────
  const applyIndicators = useCallback((lay: ChartLayout) => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const n of ['MC_EMA', 'MC_LINES', 'VOL', 'MC_RSI', 'MC_MACD', 'MC_ATR']) chart.removeIndicator({ name: n });
    const series = priceSeriesOf(lay);
    if (series.length) {
      chart.createIndicator({
        name: 'MC_LINES', paneId: 'candle_pane', calcParams: series.map((_, i) => i), extendData: series.map((x) => x.spec),
        styles: {
          lines: series.map((x) => ({ color: visibleOnTheme(x.color), size: 1.5, style: x.spec.kind === 'BBM' ? 'dashed' : 'solid', smooth: false, dashedValue: [4, 3] })),
          tooltip: { showRule: 'none' },
        },
      }, true);
    }
    if (lay.volume.on) {
      chart.createIndicator({ name: 'VOL', paneId: VOL_PANE, calcParams: [lay.volume.avg], styles: { lines: [{ color: '#F59E0B', size: 1.5, style: 'solid', smooth: false, dashedValue: [2, 2] }] } });
      chart.setPaneOptions({ id: VOL_PANE, height: 100 });
    }
    const guide = visibleOnTheme('#787B86');
    for (const x of lay.extras) {
      if (!x.on || !EXTRA_INFO[x.type].pane) continue;
      const paneId = `mc_${x.type.toLowerCase()}_${x.id}`.replace(/[^a-z0-9_]/gi, '_');
      const name = x.type === 'RSI' ? 'MC_RSI' : x.type === 'MACD' ? 'MC_MACD' : 'MC_ATR';
      const lines = x.type === 'RSI'
        ? [{ color: x.color, size: 1.5, style: 'solid' }, { color: guide, size: 1, style: 'dashed' }, { color: guide, size: 1, style: 'dashed', dashedValue: [1, 3] }, { color: guide, size: 1, style: 'dashed' }]
        : x.type === 'MACD'
          ? [{ color: x.color, size: 1.5, style: 'solid' }, { color: '#FF6D00', size: 1.5, style: 'solid' }]
          : [{ color: x.color, size: 1.5, style: 'solid' }];
      chart.createIndicator({ name, paneId, calcParams: x.params, styles: { lines: lines.map((l) => ({ smooth: false, dashedValue: [4, 4], ...l })) as any } });
      chart.setPaneOptions({ id: paneId, height: 110 });
    }
    applyScale(lay);
  }, [applyScale]);

  // zzz943: re-colour the chart when the page switches between white and dark (the class is on the page, not on <html>)
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    chart.setStyles(themeStyles());
    applyIndicators(workingRef.current);
  }, [chartLight, ready, applyIndicators]);

  // the working layout changed (picked another layout, edited an indicator, eye toggle): redraw the indicators
  useEffect(() => {
    if (ready) applyIndicators(L.working);
  }, [L.working, ready, applyIndicators]);

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
        // daily or longer bars: show plain dates in the crosshair and the top line (no "00:00")
        formatter: { formatDate: ({ dateTimeFormat, timestamp, template, type }) => (type === 'xAxis' ? kc.utils.formatDate(dateTimeFormat, timestamp, template) : new Date(timestamp).toISOString().slice(0, 10)) },
        layout: { barSpaceLimit: { min: 0.3, max: 60 } },
      });
      if (!chart) { setError('The chart could not start in this browser.'); return; }
      chartRef.current = chart;
      chart.setDataLoader({ getBars: ({ type, callback }) => { callback(type === 'init' ? barsRef.current : [], false); } });
      applyIndicators(workingRef.current);
      // the legend follows the crosshair like TradingView's (last bar when the mouse is off the chart)
      let raf = 0;
      chart.subscribeAction('onCrosshairChange', (d: any) => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => setHoverIdx(typeof d?.dataIndex === 'number' && d?.kLineData ? d.dataIndex : null));
      });
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
        applyIndicators(workingRef.current);
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
      setBars(b.t.map((t, i) => ({ t, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] })));
      setHoverIdx(null);
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

  const autoOn = L.working.scale.auto && !manualScale;
  const toggleAuto = useCallback(() => {
    if (L.working.scale.auto && !manualScale) { L.setWorking((w) => ({ ...w, scale: { ...w.scale, auto: false } })); return; }
    if (!L.working.scale.auto) L.setWorking((w) => ({ ...w, scale: { ...w.scale, auto: true } }));
    else applyScale(L.working);   // already "auto" in the layout, only dragged by hand: refit now
  }, [L, manualScale, applyScale]);
  const toggleAutoRef = useRef(toggleAuto);
  useEffect(() => { toggleAutoRef.current = toggleAuto; }, [toggleAuto]);

  // dragging the price axis by hand turns "A" off (as in TradingView); double-clicking it turns auto-fit back on
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready) return;
    const onAxis = (e: MouseEvent) => {
      const chart = chartRef.current;
      const b = chart?.getSize('candle_pane', 'yAxis');
      if (!b) return false;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      return x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;
    };
    let down: { x: number; y: number } | null = null;
    const md = (e: MouseEvent) => { down = onAxis(e) ? { x: e.clientX, y: e.clientY } : null; };
    const mm = (e: MouseEvent) => { if (down && Math.abs(e.clientY - down.y) > 3) { setManualScale(true); down = null; } };
    const mu = () => { down = null; };
    const dbl = (e: MouseEvent) => {
      if (!onAxis(e)) return;
      if (!workingRef.current.scale.auto) L.setWorking((w) => ({ ...w, scale: { ...w.scale, auto: true } }));
      else applyScale(workingRef.current);
    };
    el.addEventListener('mousedown', md, true);
    window.addEventListener('mousemove', mm, true);
    window.addEventListener('mouseup', mu, true);
    el.addEventListener('dblclick', dbl, true);
    return () => { el.removeEventListener('mousedown', md, true); window.removeEventListener('mousemove', mm, true); window.removeEventListener('mouseup', mu, true); el.removeEventListener('dblclick', dbl, true); };
  }, [ready, L, applyScale]);

  // Reset chart (Alt+R, like TradingView): back to the chosen range, scrolled to the latest bar, price axis refitted
  const resetChart = useCallback(() => {
    applyRange(rangeRef.current);
    applyScale(workingRef.current);
  }, [applyRange, applyScale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.altKey && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')) { e.preventDefault(); resetChart(); return; }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'F' || e.code === 'KeyF')) { e.preventDefault(); setFocus((v) => !v); return; }
      if (e.key === 'Escape') { if (toolRef.current !== 'cursor') cancelDrawing(); else if (focusRef.current) setFocus(false); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelDrawing, deleteSelected, selectedId, resetChart]);

  // a watchlist row (or ↑/↓) loads that ticker; timeframe and range stay as they are
  const pickFromList = useCallback((m: Market, t: string) => {
    setQuery(t); setQueryMarket(m); setMarket(m); setTicker(t); setError(null);
  }, []);

  // drawings changed on another device and were just brought down: show them
  useEffect(() => {
    const onRestored = (e: Event) => {
      const keys = (e as CustomEvent).detail?.keys;
      // (not in the middle of drawing a line — that would cancel it; the next ticker / timeframe change shows the merge)
      if (Array.isArray(keys) && keys.includes(CHART_DRAWINGS_KEY) && keyRef.current && toolRef.current === 'cursor') restoreDrawings(keyRef.current);
    };
    const onPushed = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (Array.isArray(d?.keys) && d.keys.includes(CHART_DRAWINGS_KEY)) setSyncedAt(Number(d.at) || Date.now());
    };
    window.addEventListener('mc:vault:restored', onRestored);
    window.addEventListener('mc:vault:pushed', onPushed);
    return () => { window.removeEventListener('mc:vault:restored', onRestored); window.removeEventListener('mc:vault:pushed', onPushed); };
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
  useEffect(() => { toolRef.current = tool; }, [tool]);

  // legend rows + their values (same maths as the lines on the chart)
  const rows = useMemo(() => legendRows(L.working), [L.working]);
  const rowValues = useMemo(() => {
    const out = new Map<string, (number | null)[][]>();
    if (!bars.length) return out;
    const closes = bars.map((x) => x.c);
    for (const r of rows) {
      if (!r.on) continue;
      if (!r.pane) { out.set(r.id, r.series.map((x) => seriesValues(x.spec, bars))); continue; }
      const ex = L.working.extras.find((e) => e.id === r.id);
      if (!ex) continue;
      if (ex.type === 'RSI') out.set(r.id, [rsi(closes, ex.params[0])]);
      else if (ex.type === 'MACD') { const m = macd(closes, ex.params[0], ex.params[1], ex.params[2]); out.set(r.id, [m.macd, m.signal]); }
      else if (ex.type === 'ATR') out.set(r.id, [atr(bars, ex.params[0])]);
    }
    return out;
  }, [rows, bars, L.working.extras]);
  const idx = hoverIdx != null && hoverIdx >= 0 && hoverIdx < bars.length ? hoverIdx : bars.length - 1;
  const valueOf = useCallback((r: LegendRow) => (rowValues.get(r.id) || []).map((arr) => (idx >= 0 ? arr[idx] ?? null : null)), [rowValues, idx]);
  const pxDecimals = bars.length && Math.abs(bars[bars.length - 1].c) < 1 ? 4 : 2;
  const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`,
    background: active ? 'var(--mc-accent)' : 'var(--mc-bg-1)', color: active ? '#ffffff' : 'var(--mc-text-1)',
  });

  return (
    <div className={`mc-charts-root${chartLight ? ' mc-chart-light' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', color: 'var(--mc-text-1)' }}>
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
        <LayoutPicker L={L} />
        <div style={{ position: 'relative' }}>
          <button type="button" style={btn(showIndicators)} onClick={() => setShowIndicators((v) => !v)}>Indicators ▾</button>
          {showIndicators && <IndicatorsPanel L={L} onClose={() => setShowIndicators(false)} />}
        </div>
        <button type="button" style={btn(false)} onClick={toggleLight} title="Switch the chart page between white and dark">{chartLight ? '🌙 Dark' : '☀ White'}</button>
        <button type="button" style={btn(panelOpen)} onClick={togglePanel} title="Show or hide the watchlist panel">Watchlist</button>
        <div style={{ position: 'relative', display: 'flex' }}>
          <button type="button" style={{ ...btn(focus), borderRadius: '6px 0 0 6px' }} onClick={() => setFocus((v) => !v)}
            title={focus ? 'Show the site menu and top bar again (Esc or Shift+F)' : 'Focus: hide the site menu and top bar (Shift+F)'}>{focus ? '⤡ Exit focus' : '⛶ Focus'}</button>
          <button type="button" aria-label="Full screen options" style={{ ...btn(false), borderRadius: '0 6px 6px 0', borderLeft: 'none', padding: '4px 6px' }} onClick={() => setFocusMenu((v) => !v)}>▾</button>
          {focusMenu && (
            <div onMouseLeave={() => setFocusMenu(false)} style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 220, padding: 4, borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', boxShadow: '0 8px 24px rgba(0,0,0,.15)' }}>
              <button type="button" style={menuItemStyle} onClick={() => { setFocus((v) => !v); setFocusMenu(false); }}>{focus ? 'Leave focus mode' : 'Focus mode'} <span style={{ color: 'var(--mc-text-3)' }}>Shift+F</span></button>
              <button type="button" style={menuItemStyle} onClick={browserFullScreen}>Browser full screen <span style={{ color: 'var(--mc-text-3)' }}>(Esc leaves)</span></button>
              <button type="button" style={menuItemStyle} onClick={() => { resetChart(); setFocusMenu(false); }}>Reset chart <span style={{ color: 'var(--mc-text-3)' }}>Alt+R</span></button>
            </div>
          )}
        </div>
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
        <Stat label="PVol" value={stats?.pvol != null ? `${stats.pvol.toFixed(0)}%` : '—'} title="Today's volume as a % of the highest daily volume of the 50 days before it" />
        <Stat label="Float %" value={stats?.floatPct != null ? `${stats.floatPct.toFixed(1)}%` : '—'} title={market === 'US' ? 'Shares that trade freely, as a % of all shares (from the stock screener data)' : 'Not available for India yet (needs the promoter holding)'} />
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
          <button type="button" title="Reset chart: back to the chosen range, latest bar, price axis refitted (Alt+R)" aria-label="Reset chart" onClick={resetChart}
            style={{ ...btn(false), width: 40, height: 34, padding: 0, fontSize: 16 }}>⟲</button>
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0, border: '1px solid var(--mc-border-1)', borderRadius: 8, background: 'var(--mc-bg-0)', overflow: 'hidden' }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          <div style={{ position: 'absolute', right: 4, bottom: 4, zIndex: 6, display: 'flex', gap: 3 }}>
            <button type="button" className={`mc-scale-btn${autoOn ? ' on' : ''}`} aria-label="Auto-fit price scale" aria-pressed={autoOn} onClick={toggleAuto}
              title={autoOn ? 'Auto (on): the price axis fits the candles on screen. Click to turn off.' : 'Auto (off): click to fit the price axis to the candles on screen (or double-click the price axis)'}>A</button>
            <button type="button" className={`mc-scale-btn${L.working.scale.log ? ' on' : ''}`} aria-label="Log price scale" aria-pressed={L.working.scale.log}
              onClick={() => L.setWorking((w) => ({ ...w, scale: { ...w.scale, log: !w.scale.log } }))}
              title={L.working.scale.log ? 'Log scale (on): equal % moves look equal. Click for a normal scale.' : 'Log scale: equal % moves look equal'}>L</button>
          </div>
          <IndicatorLegend rows={rows} valueOf={valueOf} onToggle={(id) => L.setWorking((w) => toggleRow(w, id))} decimals={pxDecimals} colorOf={(c) => (!chartLight && (luminance(c) ?? 1) < 0.18 ? '#E5E7EB' : c)} />
          {(savedAt || syncedAt) && (
            <div title="Drawings are saved in this browser at once and copied to your account about once a minute, so they come back on your other devices"
              style={{ position: 'absolute', left: 8, bottom: 30, zIndex: 5, padding: '2px 8px', borderRadius: 6, fontSize: 11, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', color: 'var(--mc-bullish, #059669)', pointerEvents: 'none' }}>
              {savedAt ? `✓ drawings saved ${hhmm(savedAt)}` : '✓ drawings'}{syncedAt ? ` · on your account ${hhmm(syncedAt)}` : ''}
            </div>
          )}
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

const menuItemStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', background: 'none', color: 'var(--mc-text-1)', fontSize: 13, borderRadius: 4, cursor: 'pointer' };

function Stat({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <span title={title} style={{ color: 'var(--mc-text-3)' }}>
      {label} <b style={{ color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </span>
  );
}
