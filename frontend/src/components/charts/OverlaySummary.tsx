'use client';
// zzz1029 — one overlay summary row at the top-left of /charts (QA, HAL: patterns + stage analysis + auto levels gave stacked status
// bars). One chip per overlay that is on — its status in a few words (the full line on hover) and its × — and a click opens that
// overlay's own details under the row; one open at a time, Esc or a click outside closes it. The legend sits under the row. The
// Clean / Research toggle at the end sets how many labels the overlays draw on the chart; the numbers are the same in both.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DISPLAY_WORDS, DEFAULT_CHART_DISPLAY, readChartDisplay, saveChartDisplay, type ChartDisplay, type OverlayId } from '@/lib/chart-display';
import type { OverlayDock } from './overlay-dock';
import { PatternBanner, type PatternBannerP } from './PatternIndicator';
import { StageBanner, type useStageIndicator } from './StageIndicator';
import { SetupBanner, type SetupP } from './SetupIndicator';
import { AutoLinesBanner, type AutoLinesP } from './AutoLinesIndicator';

/** The display preset, remembered per viewer ('mc:chart-display:v1'; Clean when storage is not readable). */
export function useChartDisplay(): [ChartDisplay, (d: ChartDisplay) => void] {
  const [d, setD] = useState<ChartDisplay>(() => (typeof window === 'undefined' ? DEFAULT_CHART_DISPLAY : readChartDisplay()));
  const set = useCallback((next: ChartDisplay) => { setD(next); saveChartDisplay(next); }, []);
  return [d, set];
}

export const OVERLAY_ORDER: OverlayId[] = ['patterns', 'stage', 'setups', 'alines'];

export interface OverlaySummaryProps {
  patterns: PatternBannerP;
  stage: ReturnType<typeof useStageIndicator>;
  setups: SetupP;
  alines: AutoLinesP;
  cur: string;
  /** candles on screen (D / W / M) */
  tf?: string;
  light: boolean;
  display: ChartDisplay;
  onDisplay: (d: ChartDisplay) => void;
  onTurnOff: (id: OverlayId) => void;
  /** zzz1031 — the row's height in px (1 or 2 lines), so the legend sits under it */
  onHeight?: (px: number) => void;
  /** zzz1045c — a new symbol / timeframe is loading: the chips still describe the chart shown before, so they are dimmed (kept
   *  in place, controls included — the pattern timeframe chip is never hidden) and marked busy until the new data arrives */
  stale?: boolean;
}

export function OverlaySummary(pr: OverlaySummaryProps) {
  const { patterns, stage, setups, alines, cur, tf, light, display, onDisplay, onTurnOff, onHeight, stale = false } = pr;
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rowRef.current;
    if (!el || !onHeight) return;
    const report = () => onHeight(Math.round(el.getBoundingClientRect().height));
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const [openId, setOpenId] = useState<OverlayId | null>(null);
  const docks = useMemo(() => {
    const out = {} as Record<OverlayId, OverlayDock>;
    for (const id of OVERLAY_ORDER) out[id] = { open: openId === id, setOpen: (v: boolean) => setOpenId((cur2) => (v ? id : cur2 === id ? null : cur2)) };
    return out;
  }, [openId]);
  const on: Record<OverlayId, boolean> = { patterns: !!patterns.on, stage: !!stage.on, setups: !!setups.on, alines: !!alines.on };
  const n = OVERLAY_ORDER.filter((id) => on[id]).length;
  if (!n) return null;
  const seg = (d: ChartDisplay) => (
    <button key={d} type="button" aria-pressed={display === d} data-testid={`display-${d}`} title={DISPLAY_WORDS[d].tip} onClick={() => onDisplay(d)}
      style={{ border: 'none', borderRadius: 6, padding: '0 7px', height: 20, cursor: 'pointer', fontSize: 11, fontWeight: 650,
        background: display === d ? 'var(--ct-press, rgba(36,83,196,.1))' : 'transparent', color: display === d ? 'var(--mc-accent)' : 'var(--mc-text-3)' }}>{DISPLAY_WORDS[d].label}</button>
  );
  return (
    <div ref={rowRef} className="mc-overlay-row" data-testid="overlay-summary" role="toolbar" aria-label={`Overlays on the chart (${n})${stale ? ' — from the chart shown before, updating' : ''}`} aria-busy={stale || undefined}
      data-stale={stale ? '1' : undefined}
      style={{ position: 'absolute', left: 8, right: 92, top: 4, zIndex: 7, display: 'flex', alignItems: 'flex-start', gap: 6, rowGap: 4, flexWrap: 'wrap', minWidth: 0, pointerEvents: 'none' }}>
      {/* while stale, every chip is dimmed by the .mc-overlay-row[data-stale] rule (chart-workspace-css) — opacity only, so the
          details panels keep the row as their positioned parent */}
      <PatternBanner p={patterns} cur={cur} light={light} tf={tf} onTurnOff={() => onTurnOff('patterns')} dock={docks.patterns} />
      <StageBanner s={stage} light={light} shifted={false} onTurnOff={() => onTurnOff('stage')} dock={docks.stage} />
      <SetupBanner s={setups} light={light} onTurnOff={() => onTurnOff('setups')} dock={docks.setups} />
      <AutoLinesBanner s={alines} light={light} onTurnOff={() => onTurnOff('alines')} dock={docks.alines} />
      <span role="group" aria-label="Chart labels" data-testid="display-toggle"
        style={{ flex: '0 0 auto', marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 1, padding: 2, height: 26, boxSizing: 'border-box', borderRadius: 8,
          border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', pointerEvents: 'auto', boxShadow: '0 1px 0 rgba(18,23,34,.04), 0 6px 16px -10px rgba(18,23,34,.35)' }}>
        {seg('clean')}{seg('research')}
      </span>
    </div>
  );
}
