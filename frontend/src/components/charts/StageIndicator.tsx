'use client';
// zzz987 — "Stage Analysis (TheWrap method)" for /charts: the hook that reads the DAILY bars of the symbol on screen and of its index
// (S&P 500 / Nifty 50), works out the weekly stages (lib/stage-analysis — our own version from the published rules, not the
// original script), paints the stage bands + the Mansfield RS pane, and the one-line status banner. Runs only while the indicator
// is in the working layout (Indicators ▾ → Stage Analysis).
import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import { cacheChart, freshChart, type CachedChart } from '@/lib/chart-refresh';
import type { Bar } from '@/lib/chart-math';
import { STAGE_TOOLTIP, type StageResult } from '@/lib/stage-analysis';
import { patternDataPlan, patternKey } from './pattern-view';
import { MRS_INDICATOR, MRS_PANE, STAGE_INDICATOR, benchmarkOf, benchmarkUrl, stageBanner, stageFromCharts, stagePointsFor } from './stage-view';
import { readableOn } from '@/lib/readable-color';

interface DailyResponse { ok?: boolean; error?: string; ticker?: string; market?: string; interval?: string; range?: string; bars?: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] } }
const DAILY_TTL = 300_000;
interface StageState { key: string; result: StageResult | null; benchOk: boolean; status: 'loading' | 'ready' | 'error'; error?: string }

export interface StageIndicatorArgs {
  on: boolean; ready: boolean;
  ticker: string; market: string; exchange: string | undefined; basis: 'price' | 'tr';
  live: DailyResponse | null;
  bars: Bar[];
  chartRef: RefObject<Chart | null>;
  cacheRef: RefObject<Map<string, CachedChart<any>>>;
  light: boolean;
}

const barsOf = (j: DailyResponse): Bar[] => { const b = j.bars!; return b.t.map((t, i) => ({ t, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] })); };

export function useStageIndicator(a: StageIndicatorArgs) {
  const { on, ready, ticker, market, exchange, basis, live, bars, chartRef, cacheRef, light } = a;
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
          const result = stageFromCharts(daily, bench);
          setState({ key, result, benchOk: !!bench?.length, status: 'ready' });
        } catch (e: any) {
          if (!cancelled && !ctrl.signal.aborted) setState({ key, result: null, benchOk: false, status: 'error', error: String(e?.message || e) });
        }
      })();
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
    // barsSig stands for `bars`; plan.url for ticker / market / exchange / basis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, hasLive, useShown, plan.url, barsSig, cacheRef, market, ticker]);

  const mine = state && state.key === key ? state : null;
  const result = on && mine?.status === 'ready' ? mine.result : null;

  // ── paint: stage bands on the price pane + the Mansfield RS pane; removed when off / on symbol change ──────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    let alive = true;
    const clear = () => { try { chart.removeIndicator({ name: STAGE_INDICATOR }); chart.removeIndicator({ name: MRS_INDICATOR }); } catch { /* chart disposed */ } };
    clear();
    if (!on || !result || !bars.length) return;
    import('klinecharts').then(async (kc) => {
      if (!alive) return;
      const { registerStageIndicators } = await import('./stage-kline');
      registerStageIndicators(kc);
      const points = stagePointsFor(bars.map((b) => b.t), result);
      try {
        chart.createIndicator({ name: STAGE_INDICATOR, paneId: 'candle_pane', extendData: { points, light } }, true);
        if (points.some((p) => p[2] != null)) {
          chart.createIndicator({
            name: MRS_INDICATOR, paneId: MRS_PANE, extendData: { points, light },
            styles: { lines: [{ color: '#7E57C2', size: 1.5, style: 'solid', smooth: false, dashedValue: [4, 4] }, { color: '#787B86', size: 1, style: 'dashed', smooth: false, dashedValue: [4, 4] }] as any },
          });
          chart.setPaneOptions({ id: MRS_PANE, height: 100 });
        }
      } catch { /* the bands are extras: never break the chart */ }
    }).catch(() => { /* chart engine not loaded */ });
    return () => { alive = false; clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, on, result, barsSig, light, chartRef]);

  const banner = useMemo(() => stageBanner(!on ? 'idle' : mine ? mine.status : 'loading', result?.last ?? null, !!mine?.benchOk, mine?.error),
    [on, mine, result]);
  return { on, banner, benchName: benchmarkOf(market).name };
}

export function StageBanner({ s, light, shifted, onTurnOff }: { s: ReturnType<typeof useStageIndicator>; light: boolean; shifted: boolean; onTurnOff: () => void }) {
  if (!s.on) return null;
  const page = light ? '#FFFFFF' : '#0A0E1A';
  const c = s.banner.color;
  const rgb = c ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(',') : null;
  const text = c ? readableOn(c, page) : 'var(--mc-text-2)';
  return (
    <div title={`${STAGE_TOOLTIP} Mansfield RS here is measured against the ${s.benchName}.`}
      style={{ position: 'absolute', top: 4, zIndex: 7, maxWidth: shifted ? '45%' : 'calc(100% - 100px)', fontSize: 12, ...(shifted ? { right: 70 } : { left: 8 }) }}>
      {/* zzz1013 — same pill as the pattern banner: opaque on the page colour, tone as a tint, soft lift */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 24, borderRadius: 8, lineHeight: '18px', boxShadow: '0 1px 0 rgba(18,23,34,.04), 0 6px 16px -10px rgba(18,23,34,.35)',
        border: `1px solid ${rgb ? `rgba(${rgb},${light ? 0.45 : 0.55})` : 'var(--mc-border-1)'}`, background: rgb ? `linear-gradient(rgba(${rgb},${light ? 0.1 : 0.18}), rgba(${rgb},${light ? 0.1 : 0.18})), var(--mc-bg-0)` : 'var(--mc-bg-1)', color: text }}>
        <span style={{ padding: '1px 4px 1px 8px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{s.banner.text}</span>
        <button type="button" onClick={onTurnOff} aria-label="Turn off Stage Analysis" title="Turn off Stage Analysis (Indicators ▾ turns it back on)"
          style={{ background: 'none', border: 'none', color: text, cursor: 'pointer', padding: '0 6px', fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
    </div>
  );
}
