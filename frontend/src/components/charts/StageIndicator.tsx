'use client';
// zzz987 — "Stage Analysis (TheWrap method)" for /charts: the hook that reads the DAILY bars of the symbol on screen and of its index
// (S&P 500 / Nifty 50), works out the weekly stages (lib/stage-analysis — our own version from the published rules, not the
// original script), paints the stage bands + the Mansfield RS pane, and the one-line status banner. Runs only while the indicator
// is in the working layout (Indicators ▾ → Stage Analysis).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import { cacheChart, freshChart, type CachedChart } from '@/lib/chart-refresh';
import type { Bar } from '@/lib/chart-math';
import { STAGE_RULES, STAGE_TOOLTIP, type StageResult } from '@/lib/stage-analysis';
import { patternDataPlan, patternKey } from './pattern-view';
import { overlayChipText, stageMarksForDisplay, type ChartDisplay } from '@/lib/chart-display';
import { DOCK_BOX, DOCK_PANEL, DOCK_PILL, type OverlayDock } from './overlay-dock';
import { MRS_INDICATOR, MRS_PANE, STAGE_INDICATOR, STAGE_LINE_INDICATOR, benchmarkOf, benchmarkUrl, dailyMa150, stageBanner, stageBannerColors, stageFromCharts, stageMarksFor, stagePointsFor } from './stage-view';

interface DailyResponse { ok?: boolean; error?: string; ticker?: string; market?: string; interval?: string; range?: string; bars?: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] } }
const DAILY_TTL = 300_000;
interface StageState { key: string; result: StageResult | null; ma150: Map<string, number> | null; benchOk: boolean; status: 'loading' | 'ready' | 'error'; error?: string }

export interface StageIndicatorArgs {
  on: boolean; ready: boolean;
  ticker: string; market: string; exchange: string | undefined; basis: 'price' | 'tr';
  live: DailyResponse | null;
  bars: Bar[];
  chartRef: RefObject<Chart | null>;
  cacheRef: RefObject<Map<string, CachedChart<any>>>;
  light: boolean;
  /** zzz1029 — Clean (default): stage pills / levels for the current stage and the change before it; Research: every change.
   *  The stages are the same. */
  display?: ChartDisplay;
}

const barsOf = (j: DailyResponse): Bar[] => { const b = j.bars!; return b.t.map((t, i) => ({ t, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] })); };

export function useStageIndicator(a: StageIndicatorArgs) {
  const { on, ready, ticker, market, exchange, basis, live, bars, chartRef, cacheRef, light } = a;
  const display: ChartDisplay = a.display === 'research' ? 'research' : 'clean';
  const key = `stage:${patternKey(market, ticker, exchange, basis)}`;
  const [state, setState] = useState<StageState | null>(null);
  const plan = patternDataPlan(live, ticker, market, exchange, basis);
  const last = bars[bars.length - 1];
  const barsSig = `${bars.length}:${last?.t ?? 0}:${last?.c ?? 0}`;
  const useShown = plan.useShown && bars.length > 0;
  const hasLive = !!live;

  // ── read the daily bars (stock + index) and work out the weekly stages ──────────
  useEffect(() => {
    if (!on || !hasLive) return;
    let cancelled = false;
    const ctrl = new AbortController();
    const get = async (url: string, check: (j: DailyResponse) => boolean): Promise<Bar[]> => {
      const cached = freshChart(cacheRef.current, url, DAILY_TTL) as DailyResponse | null;
      if (cached?.bars) return barsOf(cached);
      const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as DailyResponse | null;
      if (!r.ok || !j?.ok || !j.bars) throw new Error(j?.error || `daily bars unavailable (HTTP ${r.status})`);
      if (!check(j)) throw new Error('daily bars were for another symbol');
      cacheChart(cacheRef.current, url, j as any);
      return barsOf(j);
    };
    const timer = setTimeout(() => {
      (async () => {
        try {
          const stockP = useShown ? Promise.resolve(bars) : get(plan.url, (j) => String(j.ticker || '').toUpperCase() === ticker.toUpperCase() && (!j.market || j.market === market));
          const benchP = get(benchmarkUrl(market), () => true).catch(() => null);   // no index → stages still shown, no Mansfield RS
          const [daily, bench] = await Promise.all([stockP, benchP]);
          if (cancelled) return;
          const result = stageFromCharts(daily, bench, market, Date.now());   // zzz1044a — completed weeks at this moment
          setState({ key, result, ma150: dailyMa150(daily), benchOk: !!bench?.length, status: 'ready' });
        } catch (e: any) {
          if (!cancelled && !ctrl.signal.aborted) setState({ key, result: null, ma150: null, benchOk: false, status: 'error', error: String(e?.message || e) });
        }
      })();
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
    // barsSig stands for `bars`; plan.url for ticker / market / exchange / basis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, hasLive, useShown, plan.url, barsSig, cacheRef, market, ticker]);

  const mine = state && state.key === key ? state : null;
  const result = on && mine?.status === 'ready' ? mine.result : null;
  const ma150 = on && mine?.status === 'ready' ? mine.ma150 : null;

  // ── paint: stage bands on the price pane + the Mansfield RS pane; removed when off / on symbol change ──────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    let alive = true;
    const clear = () => { try { for (const name of [STAGE_INDICATOR, STAGE_LINE_INDICATOR, MRS_INDICATOR]) chart.removeIndicator({ name }); } catch { /* chart disposed */ } };
    clear();
    if (!on || !result || !bars.length) return;
    import('klinecharts').then(async (kc) => {
      if (!alive) return;
      const { registerStageIndicators } = await import('./stage-kline');
      registerStageIndicators(kc);
      const times = bars.map((b) => b.t);
      const points = stagePointsFor(times, result, ma150);
      const marks = stageMarksForDisplay(stageMarksFor(times, result), display);
      clear();   // zzz1030 — never two copies of the layers (a slow import resolving after a newer run)
      try {
        // zzz1023 — the tint sits behind the candles; the stage line, strip, labels and levels in front of them
        chart.createIndicator({ name: STAGE_INDICATOR, paneId: 'candle_pane', zLevel: -1, extendData: { points, light } }, true);
        chart.createIndicator({ name: STAGE_LINE_INDICATOR, paneId: 'candle_pane', extendData: { points, marks, light } }, true);
        if (points.some((p) => p[2] != null)) {
          chart.createIndicator({ name: MRS_INDICATOR, paneId: MRS_PANE, extendData: { points, light } });
          chart.setPaneOptions({ id: MRS_PANE, height: 100 });
        }
      } catch { /* the stage layers are extras: never break the chart */ }
    }).catch(() => { /* chart engine not loaded */ });
    return () => { alive = false; clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, on, result, ma150, barsSig, light, chartRef, display]);

  const banner = useMemo(() => stageBanner(!on ? 'idle' : mine ? mine.status : 'loading', result?.last ?? null, !!mine?.benchOk, mine?.error, light, result?.changes ?? null, result?.provisional ?? null),
    [on, mine, result, light]);
  return { on, banner, benchName: benchmarkOf(market).name, display };
}

export function StageBanner({ s, light, shifted, onTurnOff, dock }: { s: ReturnType<typeof useStageIndicator>; light: boolean; shifted: boolean; onTurnOff: () => void; /** zzz1029 — a chip in the overlay summary row */ dock?: OverlayDock }) {
  const [openOwn, setOpenOwn] = useState(false);
  const open = dock ? dock.open : openOwn;
  const setOpen = useCallback((v: boolean | ((x: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(dock ? dock.open : openOwn) : v;
    if (dock) dock.setOpen(next); else setOpenOwn(next);
  }, [dock, openOwn]);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const b = s.banner;
  const hasDetails = !!b.details?.length;
  const show = s.on && open && hasDetails;
  // Escape and a click outside close the details (as in the pattern banner)
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent | TouchEvent) => { const t = e.target as Node | null; if (boxRef.current && t && !boxRef.current.contains(t)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [show, setOpen]);
  if (!s.on) return null;
  const col = stageBannerColors(b.color, light);
  const okColor = (ok: boolean | null) => (ok == null ? 'var(--mc-text-3)' : ok ? (light ? '#0B7A5E' : '#2BB58A') : (light ? '#B4232A' : '#EF6461'));
  const R = STAGE_RULES;
  return (
    <div ref={boxRef} title={show ? undefined : `${b.long ? `${b.long}.\n\n` : ''}${STAGE_TOOLTIP} Mansfield RS here is measured against the ${s.benchName}.`}
      style={dock ? DOCK_BOX : { position: 'absolute', top: 4, zIndex: 7, maxWidth: shifted ? '45%' : 'calc(100% - 100px)', fontSize: 12, ...(shifted ? { right: 70 } : { left: 8 }) }}>
      {/* zzz1013 / zzz1023 — the pattern banner's pill: opaque on the page colour, the stage colour as a tint, a soft lift */}
      <div data-testid="stage-banner" style={{ ...(dock ? DOCK_PILL : null), display: 'flex', alignItems: 'center', gap: 4, minHeight: 24, borderRadius: 8, lineHeight: '18px', boxShadow: '0 1px 0 rgba(18,23,34,.04), 0 6px 16px -10px rgba(18,23,34,.35)',
        border: `1px solid ${col.border}`, background: b.color ? `linear-gradient(${col.bg}, ${col.bg}), var(--mc-bg-0)` : 'var(--mc-bg-1)', color: col.text }}>
        {b.color && <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: b.color, marginLeft: 8, flex: '0 0 auto' }} />}
        <button type="button" onClick={() => hasDetails && setOpen((v) => !v)} aria-expanded={show} disabled={!hasDetails}
          title={hasDetails ? (dock ? `${b.text}${b.long ? `\n${b.long}` : ''}\n\nShow how this stage was read` : `${b.long ? `${b.long}\n\n` : ''}Show how this stage was read`) : dock ? b.text : undefined}
          style={{ background: 'none', border: 'none', color: col.text, cursor: hasDetails ? 'pointer' : 'default', padding: b.color ? '1px 4px 1px 2px' : '1px 4px 1px 8px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>
          {dock ? overlayChipText('stage', b.text) : b.text}{hasDetails ? (show ? ' ▴' : ' ▾') : ''}
        </button>
        <button type="button" onClick={onTurnOff} aria-label="Turn off Stage Analysis" title="Turn off Stage Analysis (Indicators ▾ turns it back on)"
          style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '0 6px', fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
      {show && (
        <div role="dialog" aria-label="Stage Analysis details" data-testid="stage-details"
          style={{ marginTop: 6, width: 'min(520px, calc(100vw - 80px))', maxHeight: 420, overflowY: 'auto', padding: '10px 12px', ...(dock ? DOCK_PANEL : null), borderRadius: 12, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', boxShadow: 'var(--ct-shadow, 0 8px 24px rgba(0,0,0,.18))' }}>
          {b.meaning && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingBottom: 8, borderBottom: '1px solid var(--mc-border-3)' }}>
              <span aria-hidden style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: b.color || 'var(--mc-border-1)' }} />
              <div>
                <div style={{ fontWeight: 700, color: 'var(--mc-text-0)' }}>What this means{b.sub ? <span style={{ fontWeight: 500, color: 'var(--mc-text-3)' }}> · {b.sub}</span> : null}</div>
                <div style={{ marginTop: 2, color: 'var(--mc-text-2)', lineHeight: '17px' }}>{b.meaning}</div>
              </div>
            </div>
          )}
          {b.health && (
            <div data-testid="stage-health" style={{ marginTop: 8, padding: '6px 8px', borderRadius: 8, border: `1px solid ${b.health.level === 'weak' ? 'rgba(220,38,38,.45)' : 'rgba(217,119,6,.45)'}`, background: b.health.level === 'weak' ? 'rgba(220,38,38,.08)' : 'rgba(217,119,6,.08)' }}>
              <div style={{ fontWeight: 700, color: b.health.level === 'weak' ? '#DC2626' : '#D97706' }}>⚠ {b.health.text}</div>
              <div style={{ marginTop: 2, fontSize: 11, color: 'var(--mc-text-3)', lineHeight: '15px' }}>{b.health.note}</div>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)' }}>Measured this week</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 12, rowGap: 3, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {b.details!.map((d) => (
              <div key={d.label} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--mc-text-2)' }}>{d.label}</span>
                <span style={{ color: okColor(d.ok), fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>{d.value}</span>
              </div>
            ))}
          </div>
          {!!b.changes?.length && (
            <>
              <div style={{ marginTop: 10, fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)' }}>Stage changes (newest first)</div>
              <ul data-testid="stage-changes" style={{ margin: '4px 0 0', paddingLeft: 16, color: 'var(--mc-text-2)', fontSize: 11.5, lineHeight: '16px', fontVariantNumeric: 'tabular-nums' }}>
                {b.changes.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </>
          )}
          <div style={{ marginTop: 10, fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)' }}>How the stages are read (weekly bars)</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: 'var(--mc-text-2)', fontSize: 11.5, lineHeight: '16px' }}>
            <li>The stage line is the 30-week average (on a daily chart, the 150-day average). Its slope over {R.slopeWeeks} weeks reads rising above +{R.flatPct}%, falling below −{R.flatPct}%, flat in between.</li>
            <li>Stage 2 starts with a weekly close above the 13-week closing range, above the average, with the average not falling (SATA {R.sataMin}+).</li>
            <li>Stage 4 starts with a weekly close below the 13-week range, below the average, with the average not rising.</li>
            <li>Stage 3 follows Stage 2 when the average stops rising and price closes under it or crosses it twice in 10 weeks; Stage 1 follows Stage 4 when price closes back over the average.</li>
            <li>A change needs {R.confirmWeeks} weekly closes in a row, so one week&apos;s dip or jump does not flip the stage. &ldquo;Began&rdquo; is the first of those weeks (where the structure started); &ldquo;confirmed&rdquo; is the second close, when the stage was first known. Dates name the last trading session of each week (its weekly close; a holiday week can end on a Thursday), not its Monday. The chart colour, the label and the week count start at the confirmed week; the first week keeps the old stage and shows the change as waiting.</li>
            <li>A Stage 2 under {R.youngWeeks} weeks old that falls back under a flat average is a failed breakout and returns to the stage before it.</li>
          </ul>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--mc-text-3)' }}>
            Chart: a light tint and a strip along the bottom show the stage; the stage line is green while rising, grey when flat, red when falling; a label marks the confirmed week of each stage, with a faint &ldquo;began&rdquo; tick at the first qualifying week; dashed lines mark the base high broken (Stage 2) or the support broken (Stage 4). On a daily chart a change shows from the last session of its confirming week (the weekly close). Mansfield RS is measured against the {s.benchName}.{s.display === 'clean' ? ' Clean view: labels and levels are drawn for the current stage and the change before it (Research shows every change); the tint and strip show all stages.' : ''} Our own version, not the original script.
          </div>
        </div>
      )}
    </div>
  );
}
