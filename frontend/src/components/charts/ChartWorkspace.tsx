'use client';
// zzz937 — the /charts workspace: candles (D / W / M), moving averages, volume with its average, drawings saved per ticker,
// a measure tool and the header numbers. Chart engine: KLineChart (Apache-2.0), loaded in the browser only.
// zzz944 — named layouts (indicator sets) with Save / Save as, more indicators, a TradingView-style legend, "✓ saved" note.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Chart, DeepPartial, KLineData, OverlayCreate, Styles } from 'klinecharts';
import {
  RANGE_KEYS, TOTAL_RETURN_LABEL, atr, barIndexAt, cleanTicker, dataRangeFor, drawingKey, fmtMoney, fmtPrice, macd, rangeStart, rsi, validTicker,
  type Bar, type DrawingName, type HeaderStats, type Market, type RangeKey, type SavedDrawing, type Timeframe,
} from '@/lib/chart-math';
import { CHART_DRAWINGS_KEY, loadDrawings, loadDrawingsWithLegacy, saveDrawings } from '@/lib/chart-storage';
import { EXTRA_INFO, legendRows, priceSeriesOf, seriesValues, toggleRow, type ChartLayout, type LegendRow } from '@/lib/chart-layouts';
import WatchlistPanel, { AddToWatchlist, useWatchlistStore, type WatchlistNavOverride } from './WatchlistPanel';
import { marketOfExchange, reviewFromUrl, reviewPosition, reviewWords, stepQueue, type ReviewQueue } from '@/lib/chart-review-queue';
import { NO_BARS, barsForIdentity, chartIdentityKey, chartLoadError, type LoadedBars } from '@/lib/chart-loaded-identity';
import { IndicatorLegend, IndicatorsPanel, LayoutPicker, useLayouts } from './LayoutControls';
import { pollWhenVisible } from '@/lib/client-fetch';
import { cacheChart, freshChart, type CachedChart } from '@/lib/chart-refresh';
import WatchlistResizeHandle, { clampWatchlistWidth } from './WatchlistResizeHandle';
import { useWorkspaceLight, workspaceThemeClass } from '@/lib/workspace-theme';
import { fitBarSpace, loadView, saveView } from '@/lib/chart-view-prefs';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';
import { readableOn, textOnColor } from '@/lib/readable-color';
import { addSet, activeSetOf, chooseSet, loadSets, removeSet, saveSets, setsOf, withSet, DRAWING_SETS_KEY, MAIN_SET, type SetsStore } from '@/lib/chart-drawing-sets';
import { PatternBanner, usePatternIndicator } from './PatternIndicator';
import { patternsOn, withPatterns } from './pattern-view';
import { StageBanner, useStageIndicator } from './StageIndicator';
import { stageOn, withStage } from './stage-view';
import SymbolSearch from './SymbolSearch';
import type { SymbolItem } from '@/lib/symbol-search';

type KC = typeof import('klinecharts');
type Tool = 'cursor' | 'mcHLine' | 'segment' | 'rayLine' | 'mcRect' | 'parallelStraightLine' | 'fibonacciLine' | 'mcText' | 'mcMeasure';
interface ChartResponse {
  ok: boolean; error?: string; ticker: string; market: Market; name: string | null; currency: string | null; exchange: string | null;
  stats: HeaderStats; bars: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
  asOf?: string; lastBarAt?: string | null;
  interval?: string; range?: string;   // zzz982 — lets the chart-pattern indicator reuse daily bars already on screen
  firstTradeT?: number | null;   // zzz990 (CP-03) — Yahoo's first-trade (listing) date, ms; the IPO-base rule needs it
  requestedExchange?: string | null;
  basis?: 'price' | 'tr'; dividends?: number;
  provenance?: { source: string; nativeGranularity: string; displayInterval: string; firstBarAt: string | null; quoteAt: string | null; priceBasis: string; lastBarFromQuote: boolean; lastBarOpenInferred: boolean; highLowRepaired: string };
}

/** zzz967 (CH-02) — ticker, market and exchange travel as one identity; a response for another one is never shown as this one. */
export function sameChartIdentity(info: { ticker?: string; market?: string; requestedExchange?: string | null } | null | undefined, ticker: string, market: string, exchange?: string): boolean {
  if (!info) return false;
  return String(info.ticker || '').toUpperCase() === String(ticker || '').toUpperCase() && info.market === market
    && (info.requestedExchange ?? null) === (market === 'IN' ? (exchange ?? null) : null);
}

const DRAW_GROUP = 'mc-draw';
const MEASURE_GROUP = 'mc-measure';
const VOL_PANE = 'mc_vol_pane';
const LAST_VALUES_GROUP = 'mc-lastvals';   // N-06: our own last-value axis tags (readable text colour per tag)
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
.mc-scale-btn { min-width: 34px; height: 22px; padding: 0 6px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--mc-border-1); background: var(--mc-bg-1); color: var(--mc-text-3); }
.mc-scale-btn.on { background: var(--mc-accent); border-color: var(--mc-accent); color: #fff; }
.mc-charts-main { display: flex; flex: 1; min-height: 0; gap: 8px; }
.mc-charts-left { display: flex; flex: 1; min-width: 0; min-height: 0; gap: 8px; }
.mc-charts-panel { width: var(--mc-watchlist-width, 400px); max-width: 55%; flex-shrink: 0; min-height: 0; }
.mc-watchlist-resize { width: 6px; flex-shrink: 0; cursor: col-resize; touch-action: none; border-radius: 4px; background: var(--mc-border-3); }
.mc-watchlist-resize:hover, .mc-watchlist-resize:focus-visible { background: var(--mc-accent); outline: none; }
@media (max-width: 900px) {
  .mc-charts-root { height: auto; }
  .mc-charts-main { flex-direction: column; }
  .mc-charts-left { height: 62vh; flex: none; }
  .mc-charts-panel { width: 100%; max-width: none; height: 70vh; }
  .mc-watchlist-resize { display: none; }
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
  return bg != null && c != null && bg < 0.3 && c < 0.18 ? '#B2B5BE' : color;   // zzz956: light grey (not white) so its price-scale label stays readable
}
function themeSignature(): string {
  return ['--mc-bg-0', '--mc-text-3', '--mc-border-1', '--mc-border-3'].map((n) => cssVar(n, '')).join('|');
}
function themeStyles(): DeepPartial<Styles> {
  const text = cssVar('--mc-text-3', '#475569');
  const grid = cssVar('--mc-border-3', '#E2E8F0');
  const axis = cssVar('--mc-border-1', '#CBD5E1');
  // zzz956 — copied from the owner's TradingView chart settings: TradingView's candle colours, coloured by the PREVIOUS close
  // ("Color bars based on previous close" is on there), no grid lines, no high / low price labels, no OHLC line in the top-left
  // (his legend shows the indicators only), the moving averages' last values on the price scale, a dashed crosshair.
  const up = '#089981', down = '#F23645';
  const legend = { color: text, size: 12 };
  void grid;
  return {
    grid: { show: false },
    candle: {
      bar: { compareRule: 'previous_close', upColor: up, downColor: down, noChangeColor: '#787B86', upBorderColor: up, downBorderColor: down, noChangeBorderColor: '#787B86', upWickColor: up, downWickColor: down, noChangeWickColor: '#787B86' },
      // N-06: one text colour serves both the up and the down tag, so it is the one that reads on both (black on these two)
      priceMark: { high: { show: false }, low: { show: false }, last: { show: true, compareRule: 'previous_close', upColor: up, downColor: down, text: { color: textOnColor([up, down, '#787B86']) } } },
      tooltip: { showRule: 'none', title: { show: false }, legend },
    },
    // N-06: the library's indicator last-value tags use one white text for every line (yellow EMA = 1.41:1); they are drawn by
    // the 'mcLastValues' overlay instead (kline-setup), with black or white text per tag
    indicator: { tooltip: { title: { color: text }, legend }, lastValueMark: { show: false } },
    xAxis: { axisLine: { show: false }, tickLine: { show: false }, tickText: { color: text } },
    yAxis: { axisLine: { show: false }, tickLine: { show: false }, tickText: { color: text, size: 12 } },
    crosshair: { horizontal: { line: { style: 'dashed' } }, vertical: { line: { style: 'dashed' } } },
    separator: { color: axis },
  };
}

export default function ChartWorkspace() {
  const router = useRouter();
  const sp = useSearchParams();
  // the screener opens /charts?symbol=<SYM>&exchange=<EX>&review=screener; the page's own links use t / m / x
  const urlSymbol = sp.get('symbol');
  const urlExchange = (sp.get('exchange') || '').trim().toUpperCase();
  const initialMarket: Market = urlSymbol ? marketOfExchange(urlExchange) : (sp.get('m') || '').toUpperCase() === 'IN' ? 'IN' : 'US';
  const initialTicker = (() => { const t = cleanTicker(urlSymbol || sp.get('t') || ''); return validTicker(initialMarket, t) ? t : initialMarket === 'IN' ? 'RELIANCE' : 'QQQ'; })();
  const view0 = useMemo(() => loadView(), []);   // zzz956: his last timeframe + the range he chose per timeframe (TradingView-like default: D, 3M)
  const initialTf: Timeframe = (['D', 'W', 'M'] as const).find((x) => x === (sp.get('tf') || '').toUpperCase()) || view0.tf;

  const [market, setMarket] = useState<Market>(initialMarket);
  const [exchange, setExchange] = useState<string | undefined>(() => urlSymbol
    ? (initialMarket === 'IN' && (urlExchange === 'NSE' || urlExchange === 'BSE') ? urlExchange : undefined)
    : sp.get('x') === 'BSE' || /^BSE:|\.BO$/i.test(sp.get('t') || '') ? 'BSE' : sp.get('x') === 'NSE' ? 'NSE' : undefined);
  // origin-aware review: with ?review=screener and the screener's stored result list containing this symbol, previous / next
  // step through those results instead of the watchlist (lib/chart-review-queue). Without the flag nothing changes.
  const [review, setReview] = useState<ReviewQueue | null>(() => {
    let ss: Storage | null = null;
    try { ss = window.sessionStorage; } catch { /* storage blocked: no review */ }
    const ex0 = urlSymbol ? urlExchange : (sp.get('x') || '');
    return reviewFromUrl(sp.get('review'), ss, initialTicker, ex0, initialMarket);
  });
  const [reviewIdx, setReviewIdx] = useState(-1);
  const [ticker, setTicker] = useState(initialTicker);
  const [tf, setTf] = useState<Timeframe>(initialTf);
  const [range, setRangeState] = useState<RangeKey>(view0.ranges[initialTf]);
  const viewRef = useRef(view0);
  const setRange = (r: RangeKey) => { setRangeState(r); viewRef.current = { ...viewRef.current, ranges: { ...viewRef.current.ranges, [tf]: r } }; saveView(viewRef.current); };
  const pickTf = (x: Timeframe) => { setTf(x); setRangeState(viewRef.current.ranges[x]); viewRef.current = { ...viewRef.current, tf: x }; saveView(viewRef.current); };
  const [query, setQuery] = useState(initialTicker);
  const [queryMarket, setQueryMarket] = useState<Market>(initialMarket);
  const [info, setInfo] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState(0);
  const L = useLayouts();
  const [showIndicators, setShowIndicators] = useState(false);
  // zzz1000 (CW-03) — bars carry the identity they were loaded for; the render path shows them only for that identity
  const [loadedBars, setBars] = useState<LoadedBars<Bar>>(NO_BARS);
  const loadedIdRef = useRef('');
  const indicatorsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>('cursor');
  const [drawColor, setDrawColor] = useState('#2962FF');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [wlStore, wlUpdate, wlSaveError, retryWatchlistSave] = useWatchlistStore();
  const [refresh, setRefresh] = useState(0);
  // this component only renders in the browser (next/dynamic, ssr:false), so storage can be read on first render
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem(PANEL_OPEN_KEY) !== '0'; } catch { return true; } });
  const [panelWidth, setPanelWidth] = useState(() => { try { const n = Number(localStorage.getItem('mc:watchlist-width')); return Number.isFinite(n) && n >= 280 ? Math.min(620, n) : 400; } catch { return 400; } });
  const resizePanel = (n: number, persist: boolean) => { const width = clampWatchlistWidth(n); setPanelWidth(width); if (persist) try { localStorage.setItem('mc:watchlist-width', String(width)); } catch { /* display preference only */ } };
  // zzz943: white chart page (TradingView's white view) by default, whatever the site theme; one click to dark
  // zzz954: one white / dark choice shared with Watchlists and the Stock Screener (white when nothing is saved)
  const [chartLight, toggleLight] = useWorkspaceLight();
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
  // zzz969 — named drawing sets: keyRef stays the chart's key; drawings are stored under the open set's key
  const [setsStore, setSetsStore] = useState<SetsStore>(() => loadSets());
  // zzz969 — price basis: as printed, or total return (dividends reinvested); remembered
  const [basis, setBasis] = useState<'price' | 'tr'>(() => { try { return localStorage.getItem('mc:chart-basis:v1') === 'tr' ? 'tr' : 'price'; } catch { return 'price'; } });
  const toggleBasis = () => setBasis((b) => { const n = b === 'tr' ? 'price' : 'tr'; try { localStorage.setItem('mc:chart-basis:v1', n); } catch { /* this visit */ } return n; });
  const setsRef = useRef(setsStore);
  useEffect(() => { setsRef.current = setsStore; }, [setsStore]);
  const storeKeyOf = useCallback((base: string) => withSet(base, activeSetOf(setsRef.current, base)), []);
  const cacheRef = useRef(new Map<string, CachedChart<ChartResponse>>());
  const loadedUrlRef = useRef('');
  const barUpdatesRef = useRef<((data: KLineData) => void) | null>(null);
  const workingRef = useRef<ChartLayout>(L.working);
  useEffect(() => { workingRef.current = L.working; }, [L.working]);
  const toolRef = useRef<string>('cursor');

  const dataRange = dataRangeFor(tf, range);

  // keep the URL linkable: /charts?t=QQQ&m=US&tf=W
  useEffect(() => {
    const q = `?t=${encodeURIComponent(ticker)}&m=${market}&tf=${tf}${market === 'IN' && exchange ? `&x=${exchange}` : ''}${review ? '&review=screener' : ''}`;
    if (typeof window !== 'undefined' && window.location.search !== q) router.replace(`/charts${q}`, { scroll: false });
  }, [ticker, market, tf, exchange, router, review]);

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
    const sk = storeKeyOf(keyRef.current);
    const at = saveDrawings(sk, list);
    if (at != null) { setSavedAt(at); setNote(null); }
    else if (JSON.stringify(loadDrawings(sk)) !== JSON.stringify(list)) { setSavedAt(null); setSyncedAt(null); setNote('Drawing changes are not saved: storage is full or blocked. Keep this page open and retry.'); }
  }, [storeKeyOf]);
  const persistSoon = useCallback(() => { setTimeout(persist, 0); }, [persist]);

  const finishDrawing = useCallback(() => { setTool('cursor'); }, []);

  const overlaySpec = useCallback((name: DrawingName, color: string, extra: Partial<OverlayCreate> = {}): OverlayCreate => ({
    name,
    groupId: DRAW_GROUP,
    styles: { line: { color, size: name === 'mcHLine' ? 1.5 : 1.5 }, text: { color: textOnColor(color), backgroundColor: color, borderColor: color } },   // N-06
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
    for (const d of loadDrawingsWithLegacy(storeKeyOf(key))) {
      chart.createOverlay(overlaySpec(d.name, d.color || '#2962FF', {
        points: d.points.map((p) => ({ timestamp: p.t, value: p.p })),
        ...(d.text ? { extendData: d.text } : {}),
      }));
    }
    setSelectedId(null);
    setTool('cursor');
    setTimeout(() => { suppressSaveRef.current = false; }, 0);
  }, [overlaySpec, storeKeyOf]);

  // ── price scale (zzz946): A = fit the candles on screen, L = log scale ─────────
  const [manualScale, setManualScale] = useState(false);   // the price axis was dragged by hand (A shows off until reset)
  const applyScale = useCallback((lay: ChartLayout) => {
    const chart = chartRef.current;
    if (!chart) return;
    const name = lay.scale.auto ? (lay.scale.log ? 'mcFitLog' : 'mcFit') : (lay.scale.log ? 'mcLog' : 'normal');
    chart.overrideYAxis({ paneId: 'candle_pane', name, gap: { top: 0.1, bottom: 0.1 } });   // TradingView's 10% top / bottom margins   // re-creating the axis also drops any hand-dragged zoom
    setManualScale(false);
  }, []);

  // ── indicators (zzz944: from the working layout) ─────────────────────────────
  const applyIndicators = useCallback((lay: ChartLayout) => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const n of ['MC_EMA', 'MC_LINES', 'VOL', 'MC_RSI', 'MC_MACD', 'MC_ATR']) chart.removeIndicator({ name: n });
    const series = priceSeriesOf(lay);
    const tagPanes: string[] = [];
    if (series.length) {
      tagPanes.push('candle_pane');
      chart.createIndicator({
        name: 'MC_LINES', paneId: 'candle_pane', calcParams: series.map((_, i) => i), extendData: series.map((x) => x.spec),
        styles: {
          lines: series.map((x) => ({ color: visibleOnTheme(x.color), size: 1.5, style: x.spec.kind === 'BBM' ? 'dashed' : 'solid', smooth: false, dashedValue: [4, 3] })),
          tooltip: { showRule: 'none' },
        },
      }, true);
    }
    if (lay.volume.on) {
      // volume bars in the candle colours (half strength), like TradingView's Volume
      chart.createIndicator({ name: 'VOL', paneId: VOL_PANE, calcParams: [lay.volume.avg], styles: { bars: [{ upColor: 'rgba(8,153,129,0.5)', downColor: 'rgba(242,54,69,0.5)', noChangeColor: 'rgba(120,123,134,0.5)' }], lines: [{ color: '#F59E0B', size: 1.5, style: 'solid', smooth: false, dashedValue: [2, 2] }] } });
      chart.setPaneOptions({ id: VOL_PANE, height: 100 });
      tagPanes.push(VOL_PANE);
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
      tagPanes.push(paneId);
    }
    // N-06 — last-value tags on each pane's price axis, text colour chosen per tag (see kline-setup 'mcLastValues')
    chart.removeOverlay({ groupId: LAST_VALUES_GROUP });
    const page = cssVar('--mc-bg-0', '#ffffff');
    for (const paneId of tagPanes) {
      try { chart.createOverlay({ name: 'mcLastValues', groupId: LAST_VALUES_GROUP, paneId, lock: true, extendData: page, points: [{ timestamp: 0, value: 0 }] }); } catch { /* tags only */ }
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
    // zzz956: room right of the last candle, like TradingView; zzz960: at most 15 px a bar (TradingView's spacing) for 3M and longer
    const { space, pad } = fitBarSpace(width, bars.length - firstIdx, r);
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
      chart.setDataLoader({
        getBars: ({ type, callback }) => { callback(type === 'init' ? barsRef.current : [], false); },
        subscribeBar: ({ callback }) => { barUpdatesRef.current = callback; },
        unsubscribeBar: () => { barUpdatesRef.current = null; },
      });
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

  // zzz967 (CH-02) — a new symbol clears the old candles at once, so NVDA never sits under QQQ's bars while it loads
  useEffect(() => {
    if (!ready) return;
    const chart = chartRef.current;
    if (!chart || !barsRef.current.length) return;
    const shown = loadedUrlRef.current;
    const shownEx = (shown.match(/&exchange=(NSE|BSE)/) || [])[1];
    if (shown.startsWith(`/api/v1/chart/${encodeURIComponent(ticker)}?market=${market}&`) && (market !== 'IN' || shownEx === exchange)) return;
    barsRef.current = [];
    setBars(NO_BARS);
    setHoverIdx(null);
    loadedUrlRef.current = '';
    loadedIdRef.current = '';
    chart.resetData();
  }, [ready, ticker, market, exchange]);

  // ── load data when ticker / timeframe / needed history changes ────────────
  useEffect(() => {
    if (!ready) return;
    let ctrl: AbortController | null = null;
    let disposed = false;
    const ttl = tf === 'D' ? 300_000 : 1_800_000;
    const id = chartIdentityKey({ ticker, market, exchange, tf, basis });
    const url = `/api/v1/chart/${encodeURIComponent(ticker)}?market=${market}&interval=${TF_TO_INTERVAL[tf]}&range=${dataRange}${market === 'IN' && exchange ? `&exchange=${exchange}` : ''}${basis === 'tr' ? '&basis=tr&adj=2' : ''}`;   // N-05: adj=2 — never reuse a browser-cached answer from the old dividend factor
    const show = (j: ChartResponse) => {
      const chart = chartRef.current;
      if (!chart) return;
      const b = j.bars;
      const prior = barsRef.current;
      const sameUrl = loadedUrlRef.current === url;
      barsRef.current = b.t.map((t, i) => ({ timestamp: t, open: b.o[i], high: b.h[i], low: b.l[i], close: b.c[i], volume: b.v[i] }));
      setBars({ id, bars: b.t.map((t, i) => ({ t, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] })) });
      loadedIdRef.current = id;
      setHoverIdx(null);
      const last = b.c[b.c.length - 1] ?? 1;
      if (!sameUrl) {
        chart.setPeriod(TF_TO_PERIOD[tf] as any);
        chart.setSymbol({ ticker: `${market}:${exchange || ''}:${ticker}`, pricePrecision: Math.abs(last) < 1 ? 4 : 2, volumePrecision: 0 });
        // A range change keeps symbol/period identical: explicitly reload its expanded history.
        chart.resetData();
      } else {
        const prefixUnchanged = prior.length > 0 && prior.length <= barsRef.current.length && prior.slice(0, -1).every((bar, i) => JSON.stringify(bar) === JSON.stringify(barsRef.current[i]));
        if (prefixUnchanged && barUpdatesRef.current) {
          for (const bar of barsRef.current.slice(prior.length - 1)) barUpdatesRef.current(bar);
        } else if (JSON.stringify(prior) !== JSON.stringify(barsRef.current)) chart.resetData();
      }
      setInfo(j);
      setError(null);
      const key = drawingKey(market, ticker, exchange);
      if (keyRef.current !== key) { setSavedAt(null); setSyncedAt(null); restoreDrawings(key); }
      if (!sameUrl) setLoadedVersion((v) => v + 1);
      loadedUrlRef.current = url;
    };
    const load = (force = false) => {
      ctrl?.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      const cached = force ? null : freshChart(cacheRef.current, url, ttl);
      if (cached) { show(cached); setLoading(false); return; }
      setLoading(true);
      fetch(url, { signal, cache: 'no-store' })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as ChartResponse | null;
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Could not load ${ticker} (HTTP ${r.status}).`);
        if (disposed || signal.aborted) return;
        cacheChart(cacheRef.current, url, j);
        show(j);
      })
      // zzz1000 (improvement 6) — a first load of this symbol / view and a failed refresh say different things
      .catch((e) => { if (!disposed && !signal.aborted) setError(chartLoadError(String(e?.message || e), loadedIdRef.current === id ? 'refresh' : 'first')); })
      .finally(() => { if (!disposed && !signal.aborted) setLoading(false); });
    };
    load();
    const stop = pollWhenVisible(() => { if (toolRef.current === 'cursor') load(true); }, ttl);
    return () => { disposed = true; stop(); ctrl?.abort(); };
  }, [ready, ticker, market, exchange, tf, dataRange, restoreDrawings, refresh, basis]);

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
    const sk = storeKeyOf(keyRef.current);
    const at = saveDrawings(sk, []);
    if (at != null) { setSavedAt(at); setNote(null); }
    else if (loadDrawings(sk).length) { setSavedAt(null); setSyncedAt(null); setNote('Drawing deletion is not saved: storage is full or blocked. Keep this page open and retry.'); }
    setSelectedId(null);
  }, [ticker, storeKeyOf]);
  // switch / add / remove drawing sets for this chart
  const pickSet = useCallback((value: string) => {
    const base = keyRef.current;
    if (!base) return;
    persist();
    let next = setsRef.current;
    if (value === '__new') {
      const nm = (window.prompt('Name for the new drawing set (e.g. Long-term thesis, Earnings setup, Tactical levels)', '') || '').trim();
      if (!nm) return;
      next = addSet(next, base, nm).store;
    } else if (value === '__del') {
      const cur = activeSetOf(next, base);
      if (cur === MAIN_SET) return;
      if (!window.confirm('Remove this drawing set from the list? Its drawings are kept in storage and come back if a set with the same name is made again.')) return;
      next = removeSet(next, base, cur);
    } else next = chooseSet(next, base, value);
    setsRef.current = next; setSetsStore(next); saveSets(next);
    restoreDrawings(base);
  }, [persist, restoreDrawings]);

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
  const pickFromList = useCallback((m: Market, t: string, x?: string) => {
    setExchange(m === 'IN' && (x === 'NSE' || x === 'BSE') ? x : undefined);
    setQuery(t); setQueryMarket(m); setMarket(m); setTicker(t); setError(null);
  }, [setError]);   // a state setter (stable); listed so the React Compiler keeps this memoization

  // ── screener review: position, previous / next, ↑ / ↓ keys ──────────────────
  const reviewPos = review ? reviewPosition(review, ticker, exchange, market) : null;
  // remember the last position found in the list (state adjusted during render, React's documented pattern) so a symbol picked
  // by hand mid-review still steps on from where the review was
  if (reviewPos?.position != null && reviewPos.position - 1 !== reviewIdx) setReviewIdx(reviewPos.position - 1);
  const reviewStep = useCallback((dir: 1 | -1) => {
    const r = stepQueue(review, ticker, exchange, dir, reviewIdx, market);
    if (!r) return;
    setReviewIdx(r.index);
    pickFromList(r.target.market, r.target.ticker, r.target.exchange);
  }, [review, ticker, exchange, reviewIdx, market, pickFromList]);
  const reviewCanPrev = !!review && !!stepQueue(review, ticker, exchange, -1, reviewIdx, market);
  const reviewCanNext = !!review && !!stepQueue(review, ticker, exchange, 1, reviewIdx, market);
  const words = reviewWords(review);
  const reviewNav = useMemo<WatchlistNavOverride | null>(() => (review ? { label: reviewWords(review).noun, canPrev: reviewCanPrev, canNext: reviewCanNext, go: reviewStep } : null), [review, reviewCanPrev, reviewCanNext, reviewStep]);
  useEffect(() => {
    if (!review) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      e.preventDefault();
      reviewStep(e.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, reviewStep]);

  // drawings changed on another device and were just brought down: show them
  useEffect(() => {
    const onRestored = (e: Event) => {
      const keys = (e as CustomEvent).detail?.keys;
      // (not in the middle of drawing a line — that would cancel it; the next ticker / timeframe change shows the merge)
      if (Array.isArray(keys) && keys.includes(DRAWING_SETS_KEY)) { const s2 = loadSets(); setsRef.current = s2; setSetsStore(s2); }   // zzz969
      if (Array.isArray(keys) && (keys.includes(CHART_DRAWINGS_KEY) || keys.includes(DRAWING_SETS_KEY)) && keyRef.current && toolRef.current === 'cursor') restoreDrawings(keyRef.current);
    };
    const onPushed = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (Array.isArray(d?.keys) && d.keys.includes(CHART_DRAWINGS_KEY)) setSyncedAt(Number(d.at) || Date.now());
    };
    window.addEventListener('mc:vault:restored', onRestored);
    window.addEventListener('mc:vault:pushed', onPushed);
    return () => { window.removeEventListener('mc:vault:restored', onRestored); window.removeEventListener('mc:vault:pushed', onPushed); };
  }, [restoreDrawings]);

  const submitSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = cleanTicker(query);
    if (!validTicker(queryMarket, t)) { setError(`"${query}" does not look like a ${queryMarket === 'IN' ? 'NSE / BSE' : 'US'} ticker.`); return; }
    setQuery(t);
    setMarket(queryMarket);
    setTicker(t);
    setExchange(queryMarket === 'IN' && (/^BSE:/i.test(query) || /\.BO$/i.test(query)) ? 'BSE' : queryMarket === 'IN' && (/^NSE:/i.test(query) || /\.NS$/i.test(query)) ? 'NSE' : undefined);
  };

  // zzz986 — a suggestion picked in the ticker box: its own market (and BSE when that is its exchange)
  const pickSymbol = (s: SymbolItem) => {
    setError(null);
    setQuery(s.t);
    setQueryMarket(s.m);
    setMarket(s.m);
    setTicker(s.t);
    setExchange(s.m === 'IN' && s.x === 'BSE' ? 'BSE' : undefined);
  };

  // zzz1000 (CW-03) — values only from bars loaded for THIS ticker / market / exchange / timeframe / basis (blank otherwise)
  const viewId = chartIdentityKey({ ticker, market, exchange, tf, basis });
  const bars = barsForIdentity(loadedBars, viewId);
  // zzz967 (CH-02) — header numbers only from a response for THIS ticker / market / exchange
  const live = sameChartIdentity(info, ticker, market, exchange) ? info : null;
  const stats = live?.stats;
  const cur = live?.currency === 'INR' ? '₹' : live?.currency === 'USD' ? '$' : live?.currency ? `${live.currency} ` : (market === 'IN' ? '₹' : '$');
  // zzz982 — "Automate chart patterns": runs only while that indicator is in the working layout
  const patterns = usePatternIndicator({ on: patternsOn(L.working), ready, ticker, market, exchange, basis, live, bars, chartRef, cacheRef, cur, chart: { loading, error } });
  // zzz987 — "Stage Analysis (TheWrap method)": runs only while that indicator is in the working layout
  const stageInd = useStageIndicator({ on: stageOn(L.working), ready, ticker, market, exchange, basis, live, bars, chartRef, cacheRef, light: chartLight });
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
    <div className={`mc-charts-root ${workspaceThemeClass(chartLight)}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', color: 'var(--mc-text-1)' }}>
      <style>{LAYOUT_CSS}</style>
      {/* search + timeframe + range */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <form onSubmit={submitSearch} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select aria-label="Market" value={queryMarket} onChange={(e) => setQueryMarket(e.target.value as Market)}
            style={{ ...btn(false), padding: '4px 6px' }}>
            <option value="US">US</option>
            <option value="IN">India</option>
          </select>
          <SymbolSearch value={query} onChange={setQuery} market={queryMarket} onPick={pickSymbol}
            onSubmitTyped={() => submitSearch()} isTypedTicker={(v) => validTicker(queryMarket, cleanTicker(v))}
            inputStyle={{ width: 190, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-0)', fontSize: 13 }} />
          <button type="submit" style={btn(false)}>Open</button>
        </form>
        <span style={{ width: 1, height: 22, background: 'var(--mc-border-1)' }} />
        {/* zzz1000 (improvement 4) — "Chart" period (the candles), distinct from the pattern banner's "Analysis" D / W / M */}
        <span role="group" aria-label="Chart period" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-text-3)' }}>Chart</span>
          {(['D', 'W', 'M'] as Timeframe[]).map((x) => (
            <button key={x} type="button" title={`Chart period: ${x === 'D' ? 'daily' : x === 'W' ? 'weekly' : 'monthly'} candles`} aria-label={`Chart period ${x === 'D' ? 'daily' : x === 'W' ? 'weekly' : 'monthly'}`} aria-pressed={tf === x} style={btn(tf === x)} onClick={() => pickTf(x)}>{x}</button>
          ))}
        </span>
        <span style={{ width: 1, height: 22, background: 'var(--mc-border-1)' }} />
        {RANGE_KEYS.map((r) => (
          <button key={r} type="button" style={btn(range === r)} onClick={() => setRange(r)}>{r}</button>
        ))}
        <span style={{ flex: 1 }} />
        <LayoutPicker L={L} />
        <div style={{ position: 'relative' }}>
          <button ref={indicatorsBtnRef} type="button" style={btn(showIndicators)} aria-expanded={showIndicators} aria-haspopup="dialog" aria-controls="mc-indicators-panel" onClick={() => setShowIndicators((v) => !v)}>Indicators ▾</button>
          {showIndicators && <IndicatorsPanel L={L} onClose={() => setShowIndicators(false)} triggerRef={indicatorsBtnRef} />}
        </div>
        <WorkspaceThemeToggle light={chartLight} onToggle={toggleLight} style={btn(false)} />
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
        <AddToWatchlist store={wlStore} update={wlUpdate} market={market} ticker={ticker} exchange={exchange} />
        {(() => {
          const base = drawingKey(market, ticker, exchange);
          const cur = activeSetOf(setsStore, base);
          return (
            <select aria-label="Drawing set" title="Separate drawing sets for this chart — each keeps its own lines and notes" value={cur} onChange={(e) => pickSet(e.target.value)}
              style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)' }}>
              {setsOf(setsStore, base).map((x) => <option key={x.id} value={x.id}>✎ {x.name}</option>)}
              <option value="__new">+ New drawing set…</option>
              {cur !== MAIN_SET ? <option value="__del">Remove this set from the list</option> : null}
            </select>
          );
        })()}
        <span style={{ color: 'var(--mc-text-3)' }}>{live ? `${live.name || ''}${live.exchange ? ` · ${live.exchange}` : ''}` : (loading ? `Loading ${ticker}…` : '')}</span>
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
        <button type="button" disabled={loading} style={btn(false)} onClick={() => { cacheRef.current.clear(); setRefresh((v) => v + 1); }}>Refresh</button>
        {live?.asOf && <span style={{ fontSize: 11, color: 'var(--mc-text-3)' }}
          title={`Last candle = the newest trading day in the chart data; loaded = when this page fetched it.${live.provenance ? `\nSource: ${live.provenance.source} · ${live.provenance.priceBasis} · history from ${live.provenance.firstBarAt ?? '?'}${live.provenance.quoteAt ? ` · quote ${new Date(live.provenance.quoteAt).toLocaleString()}` : ''}${live.provenance.lastBarFromQuote ? `\nNewest candle built from the live quote${live.provenance.lastBarOpenInferred ? ' (open not given — previous close used)' : ''}` : ''}` : ''}`}>
          {live.lastBarAt ? `Last candle ${new Date(`${live.lastBarAt}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}${live.provenance?.lastBarFromQuote ? ' (from quote)' : ''} · ` : ''}loaded {new Date(live.asOf).toLocaleTimeString()}</span>}
        {wlSaveError && <span role="alert" style={{ color: 'var(--mc-warn, #D97706)' }}>{wlSaveError} <button type="button" onClick={retryWatchlistSave}>Retry save</button></span>}
        {note?.includes('not saved') && <button type="button" onClick={persist}>Retry drawing save</button>}
        {error && (bars.length > 0 || loading) && <span role="status" style={{ color: 'var(--mc-bearish, #DC2626)' }}>{error}</span>}
      </div>

      {review && reviewPos && (
        <div role="region" aria-label={words.heading} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 6, fontSize: 13, border: '1px solid var(--mc-accent)', background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)' }}>
          <span>{words.heading}: <b>{review.label}</b> · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{reviewPos.position ?? '–'} / {reviewPos.total}</span></span>
          <button type="button" style={btn(false)} disabled={!reviewCanPrev} onClick={() => reviewStep(-1)} title={`Previous ${words.noun} (↑)`}>← Prev</button>
          <button type="button" style={btn(false)} disabled={!reviewCanNext} onClick={() => reviewStep(1)} title={`Next ${words.noun} (↓)`}>Next →</button>
          <button type="button" style={btn(false)} onClick={() => router.push(review.returnUrl)}>{words.back}</button>
          <span style={{ flex: 1 }} />
          <button type="button" aria-label={`Stop ${words.heading.toLowerCase()}`} title="Stop reviewing: ↑ / ↓ step through the watchlist again" style={{ ...btn(false), padding: '2px 8px' }} onClick={() => setReview(null)}>×</button>
        </div>
      )}
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
              title={autoOn ? 'Auto-fit (on, the default): the price axis fits the candles on screen, like TradingView\'s "auto". Click to turn it off.' : 'Auto-fit (off): click to fit the price axis to the candles on screen again (or double-click the price axis)'}>auto</button>
            <button type="button" className={`mc-scale-btn${L.working.scale.log ? ' on' : ''}`} aria-label="Log price scale" aria-pressed={L.working.scale.log}
              onClick={() => L.setWorking((w) => ({ ...w, scale: { ...w.scale, log: !w.scale.log } }))}
              title={L.working.scale.log ? 'Log scale (on): equal % moves look equal. Click for a normal scale.' : 'Log scale: equal % moves look equal'}>log</button>
            <button type="button" className={`mc-scale-btn${basis === 'tr' ? ' on' : ''}`} aria-label="Total return" aria-pressed={basis === 'tr'} onClick={toggleBasis}
              title={basis === 'tr' ? `${TOTAL_RETURN_LABEL}. On: history adjusted for ${live?.dividends ?? 0} cash dividends; the latest price is unchanged. Drawings are one set for both views and stay at the price values they were drawn on. Click for prices as printed.` : `Show: ${TOTAL_RETURN_LABEL}`}>TR</button>
          </div>
          <IndicatorLegend rows={rows} valueOf={valueOf} onToggle={(id) => L.setWorking((w) => toggleRow(w, id))} decimals={pxDecimals} colorOf={(c) => (!chartLight && (luminance(c) ?? 1) < 0.18 ? '#B2B5BE' : c)} textOf={(c) => readableOn(c, chartLight ? '#FFFFFF' : '#0A0E1A')} />
          <PatternBanner p={patterns} cur={cur} light={chartLight} tf={tf} onTurnOff={() => L.setWorking((w) => withPatterns(w, false))} />
          <StageBanner s={stageInd} light={chartLight} shifted={patterns.on} onTurnOff={() => L.setWorking((w) => withStage(w, false))} />
          {/* zzz1000 (improvement 6) — nothing loaded for this symbol / view: say so instead of an empty 0–10 price axis */}
          {!loading && !bars.length && error && (
            <div role="alert" data-testid="chart-empty-state" style={{ position: 'absolute', inset: 0, zIndex: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--mc-bg-0)' }}>
              <div style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center', fontSize: 13, color: 'var(--mc-text-2)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--mc-text-0)' }}>No chart for {ticker}{market === 'IN' && exchange ? ` (${exchange})` : ''} · {tf === 'D' ? 'daily' : tf === 'W' ? 'weekly' : 'monthly'}</div>
                <div>{error}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" style={btn(true)} onClick={() => { cacheRef.current.clear(); setError(null); setRefresh((v) => v + 1); }}>Retry</button>
                  <button type="button" style={btn(false)} onClick={() => { const el = document.querySelector<HTMLInputElement>('input[aria-label="Ticker or company"]'); el?.focus(); el?.select(); }}>Open another ticker</button>
                </div>
              </div>
            </div>
          )}
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
      {panelOpen && (<>
        <WatchlistResizeHandle width={panelWidth} onChange={resizePanel} />
        <div className="mc-charts-panel" style={{ '--mc-watchlist-width': `${panelWidth}px` } as React.CSSProperties}>
          <WatchlistPanel store={wlStore} update={wlUpdate} currentKey={drawingKey(market, ticker, exchange)} onPick={pickFromList} navOverride={reviewNav} loading={loading} />
        </div>
      </>)}
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
