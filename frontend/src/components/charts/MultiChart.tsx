'use client';
// zzz1088 — /charts/grid: 1, 2 or 4 charts on one screen. Each chart has its own symbol, market and timeframe — daily / weekly /
// monthly from the same data as /charts, or intraday 5 / 15 / 60-minute bars with a session VWAP (resets at each exchange session).
// "Same timeframe" applies one timeframe to every chart. The full study set, drawings and patterns stay on /charts (one click from
// each chart's title). Intraday bars refresh every minute while the page is visible.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chart, DeepPartial, KLineData, Styles } from 'klinecharts';
import NavLink from '@/components/NavLink';
import { pollWhenVisible } from '@/lib/client-fetch';
import { cellUrl, cellLabel, fullChartHref, cleanGrid, gridFromParams, EXCHANGE_TZ, GRID_TFS, GRID_TF_LABEL, MULTICHART_KEY, validFor, type GridCell, type GridCount, type GridState, type GridTf } from '@/lib/multichart';
import { INTRADAY_META, isIntraday, sessionVwap, intradayStatus, type IntradayTf } from '@/lib/intraday';
import { useWorkspaceLight, workspaceThemeClass } from '@/lib/workspace-theme';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';

const UP = '#089981', DOWN = '#F23645', VWAP_COLOR = '#7E57C2';
function cssVar(el: Element | null, name: string, fallback: string): string {
  if (typeof window === 'undefined' || !el) return fallback;
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}
function styles(el: Element | null): DeepPartial<Styles> {
  const text = cssVar(el, '--mc-text-3', '#475569'), axis = cssVar(el, '--mc-border-1', '#CBD5E1'), ink = cssVar(el, '--mc-text-0', '#121722'), paper = cssVar(el, '--mc-bg-0', '#ffffff');
  const crossText = { show: true, color: paper, backgroundColor: ink, borderColor: ink, borderRadius: 4, size: 11, paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2 };
  return {
    grid: { show: false },
    candle: {
      bar: { compareRule: 'previous_close', upColor: UP, downColor: DOWN, noChangeColor: '#787B86', upBorderColor: UP, downBorderColor: DOWN, noChangeBorderColor: '#787B86', upWickColor: UP, downWickColor: DOWN, noChangeWickColor: '#787B86' },
      priceMark: { high: { show: false }, low: { show: false } },
      tooltip: { showRule: 'none', title: { show: false } },
    },
    indicator: { tooltip: { title: { color: text }, legend: { color: text, size: 11 } } },
    xAxis: { axisLine: { show: false }, tickLine: { show: false }, tickText: { color: text, size: 11 } },
    yAxis: { axisLine: { show: false }, tickLine: { show: false }, tickText: { color: text, size: 11 } },
    crosshair: { horizontal: { text: crossText }, vertical: { text: crossText } } as DeepPartial<Styles['crosshair']>,
    separator: { color: axis },
  } as DeepPartial<Styles>;
}

let vwapRegistered = false;
async function chartLib() {
  const mod = await import('./kline-setup');
  const kc = mod.registerChartExtras();
  if (!vwapRegistered) {
    vwapRegistered = true;
    // Session VWAP: each bar carries its exchange session date in `s` (set when the bars are loaded)
    kc.registerIndicator<{ vwap?: number }>({
      name: 'MC_VWAP', shortName: 'VWAP', series: 'price', precision: 2, calcParams: [], figures: [{ key: 'vwap', title: 'VWAP: ', type: 'line' }],
      calc: (list: KLineData[]) => sessionVwap(list.map((d) => ({ h: d.high, l: d.low, c: d.close, v: d.volume ?? 0, s: String(d.s ?? '') }))).map((v) => (v == null ? {} : { vwap: v })),
    });
  }
  return kc;
}

/** zzz1098 (retest R5) — every loaded answer carries the request it answers (`url` = instrument + listing + timeframe). The header,
 *  VWAP and candles are shown ONLY when that equals the current selection; while a new selection loads, nothing from the old one
 *  is shown under the new name. */
interface Loaded { url: string; label: string; bars: KLineData[]; name: string | null; last: number | null; chg: number | null; asOf: string }

function ChartCell({ cell, index, onChange, light }: { cell: GridCell; index: number; onChange: (c: GridCell) => void; light: boolean }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const kcRef = useRef<any>(null);
  const barsRef = useRef<KLineData[]>([]);
  const barUpdateRef = useRef<((b: KLineData) => void) | null>(null);
  const shownUrlRef = useRef('');          // the request whose candles are on the chart now
  const wantUrlRef = useRef('');           // the request the cell wants now (answers for older requests are ignored)
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ url: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState(cell.t);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => { setInput(cell.t); }, [cell.t]);
  const intraday = isIntraday(cell.tf);
  const url = cellUrl(cell);
  wantUrlRef.current = url;
  const current = data && data.url === url ? data : null;   // only the answer for THIS selection is ever displayed

  // the chart: made once per cell
  useEffect(() => {
    const el = elRef.current;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const kc = await chartLib();
      if (disposed || !el) return;
      kcRef.current = kc;
      const chart = kc.init(el, { locale: 'en-US', timezone: EXCHANGE_TZ[cell.m], styles: styles(el.closest('.mc-mchart') || document.documentElement), layout: { barSpaceLimit: { min: 0.3, max: 40 } } });
      if (!chart) { setError({ url: '', text: 'The chart could not start in this browser.' }); return; }
      chartRef.current = chart;
      chart.setDataLoader({
        getBars: ({ type, callback }) => { callback(type === 'init' ? barsRef.current : [], false); },
        subscribeBar: ({ callback }) => { barUpdateRef.current = callback; },
        unsubscribeBar: () => { barUpdateRef.current = null; },
      });
      chart.createIndicator({ name: 'VOL', paneId: 'mc_vol', calcParams: [20], styles: { bars: [{ upColor: 'rgba(8,153,129,0.45)', downColor: 'rgba(242,54,69,0.45)', noChangeColor: 'rgba(120,123,134,0.45)' }] } as any });
      chart.setPaneOptions({ id: 'mc_vol', height: 70 });
      chart.createIndicator({ name: 'MC_EMA', paneId: 'candle_pane', calcParams: [21, 50], styles: { lines: [{ color: '#2962FF', size: 1.2 }, { color: '#F59E0B', size: 1.2 }] } as any });
      ro = new ResizeObserver(() => chart.resize());
      ro.observe(el);
      setReady(true);
    })().catch(() => setError({ url: '', text: 'The chart library failed to load.' }));
    return () => { disposed = true; ro?.disconnect(); if (el && kcRef.current) kcRef.current.dispose(el); chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // white / dark: restyle
  useEffect(() => { const el = elRef.current; if (ready && chartRef.current && el) chartRef.current.setStyles(styles(el.closest('.mc-mchart') || document.documentElement)); }, [light, ready]);

  // a new selection: the old candles leave the chart at once (never drawn under the new name)
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart || shownUrlRef.current === url) return;
    barsRef.current = []; shownUrlRef.current = '';
    chart.resetData();
  }, [ready, url]);

  // VWAP on intraday only
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    chart.removeIndicator({ name: 'MC_VWAP' });
    if (intraday && cell.vwap) chart.createIndicator({ name: 'MC_VWAP', paneId: 'candle_pane', styles: { lines: [{ color: VWAP_COLOR, size: 1.6 }] } as any }, true);
  }, [ready, intraday, cell.vwap, current?.url]);

  /** Load `forUrl`. A poll of the SAME request appends / updates the last candles in place (zoom and scroll stay); a new request
   *  sets symbol + period and redraws. Answers for a request that is no longer wanted are dropped. */
  const load = useCallback(async (forUrl: string, c: GridCell, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const r = await fetch(forUrl, { cache: 'no-store', signal });
      const j = await r.json().catch(() => null);
      if (wantUrlRef.current !== forUrl) return;
      if (!r.ok || !j?.ok || !j.bars) throw new Error(j?.error || `Could not load ${cellLabel(c)} (HTTP ${r.status})`);
      const b = j.bars;
      const bars: KLineData[] = b.t.map((t: number, i: number) => ({ timestamp: t, open: b.o[i], high: b.h[i], low: b.l[i], close: b.c[i], volume: b.v[i], ...(b.s ? { s: b.s[i] } : {}) }));
      const n = bars.length;
      const last = n ? bars[n - 1].close : null;
      let prev: number | null = null;
      const isIntra = isIntraday(c.tf);
      if (isIntra && b.s) { const sess = b.s[n - 1]; for (let i = n - 2; i >= 0; i--) if (b.s[i] !== sess) { prev = b.c[i]; break; } }
      else if (n > 1) prev = bars[n - 2].close;
      const chart = chartRef.current;
      if (chart) {
        const prior = barsRef.current;
        if (shownUrlRef.current === forUrl && prior.length && barUpdateRef.current) {
          // same request (a poll): only the changed tail is pushed — the view keeps its zoom / scroll
          const from = prior.findIndex((x) => x.timestamp === bars[0]?.timestamp);
          const sameHead = from === 0 && prior.slice(0, -1).every((x, i) => bars[i] && x.timestamp === bars[i].timestamp);
          barsRef.current = bars;
          if (sameHead) { for (const x of bars.slice(Math.max(0, prior.length - 1))) barUpdateRef.current(x); }
          else chart.resetData();
        } else {
          barsRef.current = bars;
          const per = isIntra ? { type: c.tf === '60m' ? 'hour' : 'minute', span: c.tf === '60m' ? 1 : INTRADAY_META[c.tf as '5m'].minutes } : { type: c.tf === 'D' ? 'day' : c.tf === 'W' ? 'week' : 'month', span: 1 };
          try { chart.setTimezone(EXCHANGE_TZ[c.m]); } catch { /* older engine */ }
          chart.setPeriod(per as any);
          chart.setSymbol({ ticker: `${cellLabel(c)}:${c.tf}`, pricePrecision: last != null && Math.abs(last) < 1 ? 4 : 2, volumePrecision: 0 });
          chart.resetData();
          shownUrlRef.current = forUrl;
        }
      }
      setData({ url: forUrl, label: cellLabel(c), bars, name: j.name || null, last, chg: last != null && prev ? ((last - prev) / prev) * 100 : null, asOf: j.asOf || new Date().toISOString() });
      setError(null);
    } catch (e: any) {
      if (signal?.aborted || wantUrlRef.current !== forUrl) return;
      setError({ url: forUrl, text: String(e?.message || e) });
    } finally { if (!signal?.aborted && wantUrlRef.current === forUrl) setLoading(false); }
  }, []);

  useEffect(() => {
    if (!ready) return;
    let ctrl = new AbortController();
    const c = cell;
    void load(url, c, ctrl.signal);
    if (!isIntraday(c.tf)) return () => ctrl.abort();
    const stop = pollWhenVisible(() => { ctrl.abort(); ctrl = new AbortController(); setNowTick(Date.now()); void load(url, c, ctrl.signal); }, 60_000, { runImmediately: false });
    return () => { stop(); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, url]);

  const submit = () => {
    const raw = input.trim().toUpperCase();
    const p = raw.match(/^(NSE|BSE|US|NYSE|NASDAQ|AMEX):(.+)$/);
    const m = p ? (p[1] === 'NSE' || p[1] === 'BSE' ? 'IN' : 'US') : cell.m;
    const t = p ? p[2] : raw;
    if (!t || !validFor(m, t)) { setError({ url, text: `“${raw}” does not look like a ${m === 'IN' ? 'NSE / BSE' : 'US'} symbol.` }); return; }
    const x = p && (p[1] === 'NSE' || p[1] === 'BSE') ? p[1] : m === 'IN' ? cell.x : undefined;
    const { x: _drop, ...rest } = cell; void _drop;
    onChange({ ...rest, t, m, ...(m === 'IN' && x ? { x } : {}) });
  };
  const vwapNow = intraday && cell.vwap && current ? (() => { const v = sessionVwap(current.bars.map((d) => ({ h: d.high, l: d.low, c: d.close, v: d.volume ?? 0, s: String(d.s ?? '') }))); return v[v.length - 1] ?? null; })() : null;
  const lastBar = current && current.bars.length ? current.bars[current.bars.length - 1] : null;
  const status = intraday && lastBar ? intradayStatus(cell.m, nowTick, { t: lastBar.timestamp, s: String(lastBar.s ?? '') }, cell.tf as IntradayTf) : null;
  const fmt = (x: number) => (Math.abs(x) < 1 ? x.toFixed(4) : x.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
  const err = error && (error.url === url || !error.url) ? error.text : null;
  return (
    <section className="mc-mcell" aria-label={`Chart ${index + 1}: ${cellLabel(cell)}`}>
      <header className="mc-mcell-hd">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ display: 'inline-flex', gap: 4 }}>
          <select aria-label="Market and listing" value={cell.m === 'US' ? 'US' : cell.x === 'BSE' ? 'BSE' : 'NSE'} className="mc-min"
            onChange={(e) => { const v = e.target.value; const { x: _d, ...rest } = cell; void _d; onChange(v === 'US' ? { ...rest, m: 'US' } : { ...rest, m: 'IN', ...(v === 'BSE' ? { x: 'BSE' as const } : {}) }); }}>
            <option value="NSE">NSE</option><option value="BSE">BSE</option><option value="US">US</option>
          </select>
          <input aria-label="Symbol" value={input} onChange={(e) => setInput(e.target.value)} onBlur={() => { if (input.trim().toUpperCase() !== cell.t) submit(); }} className="mc-min" style={{ width: 110, fontWeight: 650 }} spellCheck={false} />
        </form>
        <span className="mc-mseg" role="group" aria-label="Timeframe">
          {GRID_TFS.map((tf) => <button key={tf} type="button" aria-pressed={cell.tf === tf} onClick={() => onChange({ ...cell, tf })} title={isIntraday(tf) ? `${INTRADAY_META[tf].label} bars, ${INTRADAY_META[tf].days} (regular session)` : tf === 'D' ? 'Daily' : tf === 'W' ? 'Weekly' : 'Monthly'}>{GRID_TF_LABEL[tf]}</button>)}
        </span>
        {intraday ? <label className="mc-mchk" title="Session VWAP: average price weighted by volume since the session opened; resets every session (exchange time)"><input type="checkbox" checked={cell.vwap} onChange={(e) => onChange({ ...cell, vwap: e.target.checked })} /> VWAP</label> : null}
        <span style={{ flex: 1 }} />
        <NavLink href={fullChartHref(cell)} className="mc-mlink" title="Open on the full chart page (drawings, studies, patterns) — same listing">Full chart ↗</NavLink>
      </header>
      <div className="mc-mcell-info" data-identity={url}>
        <b>{cellLabel(cell)}</b>
        {current ? <>
          {current.name ? <span className="dim"> {current.name}</span> : null}
          {current.last != null ? <span> · {fmt(current.last)}</span> : null}
          {current.chg != null ? <span style={{ color: current.chg >= 0 ? UP : DOWN }}> {current.chg >= 0 ? '+' : ''}{current.chg.toFixed(2)}%</span> : null}
          {vwapNow != null && current.last != null ? <span style={{ color: VWAP_COLOR }} title="Price vs the session VWAP"> · VWAP {fmt(vwapNow)} ({current.last >= vwapNow ? 'above' : 'below'})</span> : null}
          <span className="dim"> · EMA 21 / 50{intraday ? ` · times in ${cell.m === 'IN' ? 'IST' : 'New York time'}` : ''}</span>
          {status ? <span className="dim" data-status={status.tone} title={`Loaded ${new Date(current.asOf).toLocaleTimeString()}`}> · {status.text}{loading ? ' · updating…' : ''}</span> : loading ? <span className="dim"> · updating…</span> : null}
        </> : <span className="dim"> · {err ? 'not loaded' : 'loading…'}</span>}
      </div>
      <div className="mc-mcell-chart">
        <div ref={elRef} style={{ position: 'absolute', inset: 0 }} />
        {err ? <div role="alert" className="mc-merr">{cellLabel(cell)}: {err} <button type="button" onClick={() => void load(url, cell)}>Retry</button></div> : null}
      </div>
    </section>
  );
}

const CSS = `
.mc-mchart { padding: 14px clamp(12px, 1.6vw, 24px) 18px; display: grid; gap: 10px; min-height: calc(100vh - 64px); grid-template-rows: auto 1fr; background: var(--mc-bg-0); color: var(--mc-text-1); }
.mc-mtop { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mc-mtop h1 { font-size: 18px; margin: 0; color: var(--mc-text-0); font-weight: 750; }
.mc-mseg { display: inline-flex; border: 1px solid var(--mc-border-2); border-radius: 7px; overflow: hidden; }
.mc-mseg > button { border: 0; background: transparent; color: var(--mc-text-2); font-size: 12px; font-weight: 650; padding: 4px 8px; cursor: pointer; min-height: 26px; }
.mc-mseg > button + button { border-left: 1px solid var(--mc-border-3); }
.mc-mseg > button[aria-pressed="true"] { background: var(--mc-accent); color: #fff; }
.mc-mgrid { display: grid; gap: 10px; min-height: 0; }
.mc-mgrid[data-n="1"] { grid-template-columns: 1fr; }
.mc-mgrid[data-n="2"] { grid-template-columns: 1fr 1fr; }
.mc-mgrid[data-n="4"] { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.mc-mcell { border: 1px solid var(--mc-border-2); border-radius: 10px; display: grid; grid-template-rows: auto auto 1fr; min-height: 340px; background: var(--mc-bg-0); overflow: hidden; }
.mc-mcell-hd { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--mc-border-3); flex-wrap: wrap; }
.mc-mcell-info { padding: 4px 10px; font-size: 12.5px; color: var(--mc-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-mcell-info .dim, .mc-mtop .dim { color: var(--mc-text-3); }
.mc-mcell-chart { position: relative; min-height: 260px; }
.mc-min { height: 26px; border: 1px solid var(--mc-border-2); border-radius: 6px; background: var(--mc-bg-0); color: var(--mc-text-0); font-size: 12.5px; padding: 0 6px; }
.mc-mchk { font-size: 12px; display: inline-flex; gap: 4px; align-items: center; color: var(--mc-text-2); }
.mc-mlink { font-size: 12px; color: var(--mc-accent); text-decoration: none; white-space: nowrap; }
.mc-merr { position: absolute; inset: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; text-align: center; font-size: 13px; color: var(--mc-text-1); background: color-mix(in srgb, var(--mc-bg-0) 92%, transparent); }
.mc-merr button { border: 1px solid var(--mc-border-2); background: var(--mc-bg-0); color: var(--mc-text-0); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
@media (max-width: 900px) { .mc-mgrid[data-n="2"], .mc-mgrid[data-n="4"] { grid-template-columns: 1fr; grid-template-rows: none; } .mc-mcell { min-height: 380px; } }
`;

export default function MultiChart() {
  const [light, toggleLight] = useWorkspaceLight();
  const [grid, setGrid] = useState<GridState>(() => {
    let g: GridState;
    try { g = cleanGrid(JSON.parse(localStorage.getItem(MULTICHART_KEY) || 'null')); } catch { g = cleanGrid(null); }
    if (typeof window !== 'undefined') { const sp = new URLSearchParams(window.location.search); g = gridFromParams(g, sp.get('t'), sp.get('m')); }
    return g;
  });
  useEffect(() => { try { localStorage.setItem(MULTICHART_KEY, JSON.stringify(grid)); } catch { /* this visit only */ } }, [grid]);
  const setCell = (i: number, c: GridCell) => setGrid((g) => {
    const tfChanged = c.tf !== g.cells[i].tf;
    return { ...g, cells: g.cells.map((x, k) => (k === i ? c : g.sync && tfChanged ? { ...x, tf: c.tf } : x)) };
  });
  const setN = (n: GridCount) => setGrid((g) => ({ ...g, n }));
  const setSync = (sync: boolean) => setGrid((g) => ({ ...g, sync, cells: sync ? g.cells.map((x) => ({ ...x, tf: g.cells[0].tf })) : g.cells }));
  const shown = useMemo(() => grid.cells.slice(0, grid.n), [grid]);
  return (
    <div className={`mc-mchart ${workspaceThemeClass(light, true)}`}>
      <style>{CSS}</style>
      <div className="mc-mtop">
        <h1>Multi-chart</h1>
        <span className="mc-mseg" role="group" aria-label="How many charts">
          {([1, 2, 4] as GridCount[]).map((n) => <button key={n} type="button" aria-pressed={grid.n === n} onClick={() => setN(n)}>{n === 1 ? '1 chart' : `${n} charts`}</button>)}
        </span>
        <label className="mc-mchk" title="One timeframe for every chart: changing it on one chart changes all"><input type="checkbox" checked={grid.sync} onChange={(e) => setSync(e.target.checked)} /> Same timeframe</label>
        <span className="dim" style={{ fontSize: 12 }}>Intraday: 5m · 15m · 1h bars from Yahoo (regular session), session VWAP · D / W / M as on Charts</span>
        <span style={{ flex: 1 }} />
        <NavLink href="/charts" className="mc-mlink">← Charts</NavLink>
        <WorkspaceThemeToggle light={light} onToggle={toggleLight} />
      </div>
      <div className="mc-mgrid" data-n={grid.n}>
        {shown.map((c, i) => <ChartCell key={i} index={i} cell={c} light={light} onChange={(nc) => setCell(i, nc)} />)}
      </div>
    </div>
  );
}

export type { GridTf };
