'use client';
// zzz1046b — "Volume & accumulation (institutional footprint)" for /charts: the hook that reads the completed candles on screen
// (D / W / M, a still-forming last candle left out), runs lib/accumulation (our own version of the published O'Neil / Wyckoff
// rules), draws the marks on the volume bars (or under the candles when Volume is off) and the money-flow pane, and the chip in the
// overlay summary row with its details (every line of the explanation). Runs only while the overlay is in the working layout
// (Indicators ▾ → Volume & accumulation).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import type { Bar } from '@/lib/chart-math';
import type { ChartDisplay } from '@/lib/chart-display';
import { bannerColors, barsRevision } from './pattern-view';
import { DOCK_BOX, DOCK_PANEL, DOCK_PILL, type OverlayDock } from './overlay-dock';
import {
  ACC_GLYPH, ACC_INDICATOR, ACC_PREFS_KEY, CMF_INDICATOR, CMF_PANE, accBarWord, accChipText, accCountsInRange, accDetailLines, accHeadline, accMarkColor,
  accPointsFor, accReading, accStatus, cmfPointsFor, parseAccPrefs, serializeAccPrefs, type AccChartTf, type AccPrefs,
} from './acc-view';

export interface AccIndicatorArgs {
  on: boolean; ready: boolean;
  market: string;
  /** candles on screen, already the chart's timeframe and identity-checked by the page */
  bars: Bar[];
  tf: AccChartTf;
  chartRef: RefObject<Chart | null>;
  light: boolean;
  display?: ChartDisplay;
  /** the layout's Volume pane is on: marks go on the volume bars (else under the candles) */
  volumeOn: boolean;
  /** the volume pane's id (the page's) */
  volPane: string;
  /** the working layout (any change re-creates the marks after the page re-creates the volume bars, so the tint draws on top) */
  layoutRev?: unknown;
}

function readPrefs(): AccPrefs {
  try { return parseAccPrefs(localStorage.getItem(ACC_PREFS_KEY)); } catch { return parseAccPrefs(null); }
}

export function useAccIndicator(a: AccIndicatorArgs) {
  const { on, ready, market, bars, tf, chartRef, light, volumeOn, volPane, layoutRev } = a;
  const display: ChartDisplay = a.display === 'research' ? 'research' : 'clean';
  const [prefs, setPrefsState] = useState<AccPrefs>(readPrefs);
  const setPrefs = useCallback((fn: (p: AccPrefs) => AccPrefs) => {
    setPrefsState((p) => {
      const next = fn(p);
      try { localStorage.setItem(ACC_PREFS_KEY, serializeAccPrefs(next)); } catch { /* this visit only */ }
      return next;
    });
  }, []);
  const barsRev = useMemo(() => barsRevision(bars), [bars]);
  const mkt: 'US' | 'IN' = market === 'IN' ? 'IN' : 'US';

  // ── read the completed candles on screen ──────────────────────────────────────
  const comp = useMemo(() => {
    if (!on || !bars.length) return null;
    return accReading(bars, tf, mkt);
    // barsRev stands for `bars` (a new array on every load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, barsRev, tf, mkt]);

  const status = accStatus(on, bars.length, comp ? comp.done.length : 0);
  const chip = useMemo(() => accChipText(comp?.figures ?? null, { tf, status, dropped: !!comp?.dropped, compact: display === 'clean' }), [comp, tf, status, display]);
  const full = useMemo(() => accChipText(comp?.figures ?? null, { tf, status, dropped: !!comp?.dropped }), [comp, tf, status]);
  const lines = useMemo(() => (status === 'ready' ? accDetailLines(comp?.figures ?? null, tf, mkt) : []), [comp, tf, mkt, status]);

  // ── marks in view (for the counts in the details) ─────────────────────────────
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    const chart = chartRef.current;
    if (!on || !ready || !chart) return;
    let raf = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { try { const vr = chart.getVisibleRange(); setRange((r) => (r && r.from === vr.from && r.to === vr.to ? r : { from: vr.from, to: vr.to })); } catch { /* disposed */ } });
    };
    read();
    try { chart.subscribeAction('onVisibleRangeChange', read); } catch { /* older engine: counts from the first read */ }
    return () => { cancelAnimationFrame(raf); try { chart.unsubscribeAction('onVisibleRangeChange', read); } catch { /* disposed */ } };
  }, [on, ready, chartRef, barsRev]);
  const counts = useMemo(() => (comp ? accCountsInRange(comp.series, range ? range.from : 0, range ? range.to : comp.done.length) : null), [comp, range]);

  // ── paint: marks on the volume pane (or under the candles), the money-flow pane ─────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    let alive = true;
    // a new symbol / timeframe (no bars yet) or the overlay off: the old marks go at once
    const clear = () => { try { chart.removeIndicator({ name: ACC_INDICATOR }); chart.removeIndicator({ name: CMF_INDICATOR }); } catch { /* chart disposed */ } };
    clear();
    if (!on || !comp || !comp.done.length) return;
    import('klinecharts').then(async (kc) => {
      if (!alive) return;
      const { registerAccIndicators } = await import('./acc-kline');
      registerAccIndicators(kc);
      const { done, series } = comp;
      try {
        // the marks: on the volume bars only while the page's volume pane exists (else the library would make a pane of marks)
        const volPaneThere = volumeOn && chart.getIndicators({ paneId: volPane }).some((x) => x.name === 'VOL');
        chart.createIndicator({
          name: ACC_INDICATOR, paneId: volPaneThere ? volPane : 'candle_pane',
          extendData: { points: accPointsFor(done, series, { churn: prefs.churn }), onVol: volPaneThere, tint: prefs.tint, light, bar: accBarWord(tf) },
        }, true);
        if (prefs.cmfPane) {
          chart.createIndicator({
            name: CMF_INDICATOR, paneId: CMF_PANE, extendData: { points: cmfPointsFor(done, series), light },
            styles: { lines: [{ color: '#787B86', size: 1, style: 'dashed', smooth: false, dashedValue: [3, 3] }] as any },
          });
          chart.setPaneOptions({ id: CMF_PANE, height: 80 });   // the page's pane fit keeps the price pane ≥ ~45% (zzz1045c)
        }
      } catch { /* an overlay: never break the chart */ }
    }).catch(() => { /* chart engine not loaded */ });
    return () => { alive = false; clear(); };
  }, [ready, on, comp, prefs, light, chartRef, volumeOn, volPane, tf, layoutRev]);

  const toggle = useCallback((k: keyof AccPrefs) => setPrefs((p) => ({ ...p, [k]: !p[k] })), [setPrefs]);
  return { on, status, chip, full, lines, prefs, counts, dropped: !!comp?.dropped, figures: comp?.figures ?? null, tf, market: mkt, display, toggle };
}

export type AccP = ReturnType<typeof useAccIndicator>;
const TF_BAR: Record<AccChartTf, string> = { D: 'daily', W: 'weekly', M: 'monthly' };
const TONE = { up: 'bullish', down: 'bearish', none: 'none' } as const;

export function AccBanner({ s, light, top = 4, onTurnOff, dock }: { s: AccP; light: boolean; top?: number; onTurnOff: () => void; dock?: OverlayDock }) {
  const [openOwn, setOpenOwn] = useState(false);
  const open = dock ? dock.open : openOwn;
  const setOpen = useCallback((v: boolean | ((x: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(dock ? dock.open : openOwn) : v;
    if (dock) dock.setOpen(next); else setOpenOwn(next);
  }, [dock, openOwn]);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent | TouchEvent) => { const t = e.target as Node | null; if (boxRef.current && t && !boxRef.current.contains(t)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [open, setOpen]);
  if (!s.on) return null;
  const col = bannerColors(TONE[s.chip.tone], light);
  const small = { background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-1)', borderRadius: 6, color: 'var(--mc-text-2)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: '1px 8px', whiteSpace: 'nowrap' as const };
  const bar = accBarWord(s.tf);
  const legend: Array<['acc' | 'vbo' | 'dist' | 'churn', string]> = [
    ['acc', `accumulation ${bar}: up ≥ 1% on ≥ 1.25× average volume, closing in the upper half`],
    ['vbo', `volume breakout: a new 50-${bar} closing high on ≥ 1.5× average volume`],
    ['dist', `distribution ${bar}: down ≥ 1% on ≥ 1.25× average volume, closing in the lower half`],
    ['churn', `stalling: heavy volume (≥ 1.5×) but price barely moved and closed weak`],
  ];
  const check = (k: 'cmfPane' | 'tint' | 'churn', label: string) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11.5 }}>
      <input type="checkbox" checked={s.prefs[k]} onChange={() => s.toggle(k)} aria-label={label} /> {label}
    </label>
  );
  return (
    <div ref={boxRef} data-testid="acc-banner-box" style={dock ? DOCK_BOX : { position: 'absolute', left: 8, top, zIndex: 6, maxWidth: 'calc(100% - 100px)', fontSize: 12 }}>
      <div data-testid="acc-banner" style={{ ...(dock ? DOCK_PILL : null), display: 'flex', alignItems: 'center', gap: 4, minHeight: 24, borderRadius: 8, border: `1px solid ${col.border}`, background: `linear-gradient(${col.bg}, ${col.bg}), var(--mc-bg-0)`, color: col.text, lineHeight: '18px', boxShadow: '0 1px 0 rgba(18,23,34,.04), 0 6px 16px -10px rgba(18,23,34,.35)' }}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog"
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          title={`${accHeadline(s.tf)} · ${s.full.text}\n\nRead on the ${TF_BAR[s.tf]} candles on screen, completed candles only. Click for every reason. Esc closes it.${s.dropped ? '\nThe last candle is still forming and is not read.' : ''}`}
          style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '1px 4px 1px 8px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, textAlign: 'left' }}>
          {s.chip.text} ▾
        </button>
        <button type="button" onClick={onTurnOff} aria-label="Turn off Volume & accumulation" title="Turn off Volume & accumulation (Indicators ▾ turns it back on)"
          style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '0 6px', fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
      {open && (
        <div role="dialog" aria-label="Volume & accumulation"
          style={{ marginTop: 6, width: 'min(520px, calc(100vw - 80px))', maxHeight: 440, ...(dock ? DOCK_PANEL : null), overflowY: 'auto', padding: '8px 10px 10px', borderRadius: 12, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', boxShadow: 'var(--ct-shadow, 0 8px 24px rgba(0,0,0,.18))' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {check('cmfPane', 'Money flow pane')}
            {check('tint', 'Colour the volume bars')}
            {check('churn', 'Stalling marks')}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the details" style={small}>Close</button>
          </div>
          <div data-testid="acc-headline" style={{ marginTop: 6, fontWeight: 650, color: 'var(--mc-text-1)' }}>{accHeadline(s.tf)} · {s.full.text}</div>
          <div style={{ marginTop: 6 }}>
            {s.lines.length ? s.lines.map((t, i) => (
              <div key={i} data-testid="acc-line" style={{ padding: '2px 0', fontVariantNumeric: 'tabular-nums', color: i === s.lines.length - 1 ? 'var(--mc-text-3)' : undefined, fontSize: i === s.lines.length - 1 ? 11 : undefined }}>{t}</div>
            )) : <div style={{ color: 'var(--mc-text-2)' }}>{s.full.text}</div>}
          </div>
          <div style={{ marginTop: 10, marginBottom: 2, fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)' }}>Marks on the chart · in view</div>
          {legend.map(([k, words]) => (
            <div key={k} data-testid={`acc-mark-${k}`} style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '2px 0', borderBottom: '1px solid var(--mc-border-3)' }}>
              <span aria-hidden style={{ color: accMarkColor(k, light), fontWeight: 700, minWidth: 14 }}>{ACC_GLYPH[k]}</span>
              <span style={{ flex: 1 }}>{words}</span>
              <span style={{ color: 'var(--mc-text-2)', fontVariantNumeric: 'tabular-nums' }}>{s.counts ? s.counts[k] : 0}</span>
            </div>
          ))}
          <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-text-3)' }}>
            Read on the {TF_BAR[s.tf]} candles on screen{s.dropped ? ' — the last candle is still forming and is not read' : ', completed candles only'}. &quot;Average volume&quot; = the 50 {bar}s before each {bar}. Hover a mark on the volume bars for its volume. The money-flow pane is Chaikin Money Flow over 21 {bar}s (above 0 = closes near the high on volume). A reading of the bars, not a signal to act on.
          </div>
        </div>
      )}
    </div>
  );
}
