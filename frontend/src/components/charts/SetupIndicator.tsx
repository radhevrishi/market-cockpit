'use client';
// zzz1022 — "Trader setups" for /charts: the hook that reads the candles on screen (D / W / M, a still-forming last candle left
// out), runs lib/setups (our own version of the published rules of O'Neil, Darvas, the Turtles, Carter, Kullamägi / Bonde, Kell,
// Raschke, Wyckoff, Crabel), draws the tags / Darvas boxes / optional Donchian 20 lines and the optional squeeze pane, and the
// one-line status banner with its list (a checkbox per setup type). Runs only while the indicator is in the working layout
// (Indicators ▾ → Trader setups).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import type { Bar } from '@/lib/chart-math';
import { SETUP_META, setupSeries, type SetupCode } from '@/lib/setups';
import { bannerColors, barsRevision } from './pattern-view';
import { overlayChipText, recentSetupPoints, CLEAN_SETUP_BARS, type ChartDisplay } from '@/lib/chart-display';
import { DOCK_BOX, DOCK_PANEL, DOCK_PILL, type OverlayDock } from './overlay-dock';
import { setupRuleText,
  SETUP_CODES, SETUP_INDICATOR, SETUP_PREFS_KEY, SQZ_INDICATOR, SQZ_PANE, completedBars, countsInRange, donchianPointsFor, parseSetupPrefs, serializeSetupPrefs,
  setupBannerRows, setupBoxesFor, setupColor, setupHeadline, setupName, setupPointsFor, squeezePointsFor, tagOf, type SetupChartTf, type SetupPrefs,
} from './setup-view';

export interface SetupIndicatorArgs {
  on: boolean; ready: boolean;
  market: string;
  /** candles on screen, already the chart's timeframe and identity-checked by the page */
  bars: Bar[];
  tf: SetupChartTf;
  chartRef: RefObject<Chart | null>;
  light: boolean;
  /** zzz1029 — Clean (default): tags on the last ~20 bars only; Research: every tag. The setups found are the same. */
  display?: ChartDisplay;
}

function readPrefs(): SetupPrefs {
  try { return parseSetupPrefs(localStorage.getItem(SETUP_PREFS_KEY)); } catch { return parseSetupPrefs(null); }
}

export function useSetupIndicator(a: SetupIndicatorArgs) {
  const { on, ready, market, bars, tf, chartRef, light } = a;
  const display: ChartDisplay = a.display === 'research' ? 'research' : 'clean';
  const [prefs, setPrefsState] = useState<SetupPrefs>(readPrefs);
  const setPrefs = useCallback((fn: (p: SetupPrefs) => SetupPrefs) => {
    setPrefsState((p) => {
      const next = fn(p);
      try { localStorage.setItem(SETUP_PREFS_KEY, serializeSetupPrefs(next)); } catch { /* this visit only */ }
      return next;
    });
  }, []);
  const barsRev = useMemo(() => barsRevision(bars), [bars]);
  const mkt: 'US' | 'IN' = market === 'IN' ? 'IN' : 'US';

  // ── read the completed candles on screen ──────────────────────────────────────
  const comp = useMemo(() => {
    if (!on || !bars.length) return null;
    const { bars: done, dropped } = completedBars(bars, tf, mkt);
    return { done, dropped, series: setupSeries(done, { market: mkt, yearBars: tf === 'W' ? 52 : tf === 'M' ? 12 : 252 }) };
    // barsRev stands for `bars` (a new array on every load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, barsRev, tf, mkt]);

  const shown = useCallback((c: SetupCode) => prefs.shown[c] !== false, [prefs]);
  const rows = useMemo(() => (comp ? setupBannerRows(comp.done, comp.series, tf, shown) : []), [comp, tf, shown]);
  const status: 'idle' | 'loading' | 'ready' | 'short' = !on ? 'idle' : !bars.length ? 'loading' : comp && comp.done.length < 21 ? 'short' : 'ready';
  const banner = useMemo(() => setupHeadline(rows, tf, status), [rows, tf, status]);

  // ── events in view (for the counts in the list) ──────────────────────────────
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
  const counts = useMemo(() => (comp ? countsInRange(comp.series, range ? range.from : 0, range ? range.to : comp.done.length) : {}), [comp, range]);

  // ── paint: tags + boxes (+ Donchian) on the price pane, the squeeze pane when asked ──────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    let alive = true;
    const clear = () => { try { chart.removeIndicator({ name: SETUP_INDICATOR }); chart.removeIndicator({ name: SQZ_INDICATOR }); } catch { /* chart disposed */ } };
    clear();
    if (!on || !comp || !comp.done.length) return;
    import('klinecharts').then(async (kc) => {
      if (!alive) return;
      const { registerSetupIndicators } = await import('./setup-kline');
      registerSetupIndicators(kc);
      const { done, series } = comp;
      try {
        chart.createIndicator({
          name: SETUP_INDICATOR, paneId: 'candle_pane',
          extendData: { points: recentSetupPoints(setupPointsFor(done, series, shown), done.map((x) => x.t), display), boxes: prefs.shown.DVX !== false ? setupBoxesFor(done, series) : [], dc: prefs.donchian ? donchianPointsFor(done, series) : null, light },
        }, true);
        if (prefs.sqzPane) {
          chart.createIndicator({
            name: SQZ_INDICATOR, paneId: SQZ_PANE, extendData: { points: squeezePointsFor(done, series), light },
            styles: { lines: [{ color: '#787B86', size: 1, style: 'dashed', smooth: false, dashedValue: [3, 3] }] as any },
          });
          chart.setPaneOptions({ id: SQZ_PANE, height: 90 });
        }
      } catch { /* the setups are extras: never break the chart */ }
    }).catch(() => { /* chart engine not loaded */ });
    return () => { alive = false; clear(); };
  }, [ready, on, comp, prefs, shown, light, chartRef, display]);

  const toggleType = useCallback((c: SetupCode) => setPrefs((p) => ({ ...p, shown: { ...p.shown, [c]: p.shown[c] === false } })), [setPrefs]);
  const setAll = useCallback((v: boolean) => setPrefs((p) => ({ ...p, shown: Object.fromEntries(SETUP_CODES.map((c) => [c, v])) as SetupPrefs['shown'] })), [setPrefs]);
  const toggleSqzPane = useCallback(() => setPrefs((p) => ({ ...p, sqzPane: !p.sqzPane })), [setPrefs]);
  const toggleDonchian = useCallback(() => setPrefs((p) => ({ ...p, donchian: !p.donchian })), [setPrefs]);
  return { on, status, banner, rows, prefs, counts, dropped: !!comp?.dropped, tf, toggleType, setAll, toggleSqzPane, toggleDonchian, display };
}

export type SetupP = ReturnType<typeof useSetupIndicator>;
const TF_BAR: Record<SetupChartTf, string> = { D: 'daily', W: 'weekly', M: 'monthly' };
const TONE = { up: 'bullish', down: 'bearish', none: 'none' } as const;

export function SetupBanner({ s, light, top = 4, onTurnOff, dock }: { s: SetupP; light: boolean; top?: number; onTurnOff: () => void; /** zzz1029 — a chip in the overlay summary row */ dock?: OverlayDock }) {
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
  const col = bannerColors(TONE[s.banner.tone], light);
  const small = { background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-1)', borderRadius: 6, color: 'var(--mc-text-2)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: '1px 8px', whiteSpace: 'nowrap' as const };
  const allOn = SETUP_CODES.every((c) => s.prefs.shown[c] !== false);
  return (
    <div ref={boxRef} data-testid="setup-banner-box" style={dock ? DOCK_BOX : { position: 'absolute', left: 8, top, zIndex: 6, maxWidth: 'calc(100% - 100px)', fontSize: 12 }}>
      <div data-testid="setup-banner" style={{ ...(dock ? DOCK_PILL : null), display: 'flex', alignItems: 'center', gap: 4, minHeight: 24, borderRadius: 8, border: `1px solid ${col.border}`, background: `linear-gradient(${col.bg}, ${col.bg}), var(--mc-bg-0)`, color: col.text, lineHeight: '18px', boxShadow: '0 1px 0 rgba(18,23,34,.04), 0 6px 16px -10px rgba(18,23,34,.35)' }}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog"
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          title={`${s.banner.text}\n\nWell-known traders' setups on the ${TF_BAR[s.tf]} candles on screen — our own version of the published rules, not the traders' own code. Click for the list; tick a type to show its tags. Esc closes the list.${s.dropped ? `\nThe last candle is still forming and is not read.` : ''}`}
          style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '1px 4px 1px 8px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, textAlign: 'left' }}>
          {dock ? overlayChipText('setups', s.banner.text) : s.banner.text} ▾
        </button>
        <button type="button" onClick={onTurnOff} aria-label="Turn off Trader setups" title="Turn off Trader setups (Indicators ▾ turns it back on)"
          style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '0 6px', fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
      {open && (
        <div role="dialog" aria-label="Trader setups"
          style={{ marginTop: 6, width: 'min(520px, calc(100vw - 80px))', maxHeight: 440, ...(dock ? DOCK_PANEL : null), overflowY: 'auto', padding: '8px 10px 10px', borderRadius: 12, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', boxShadow: 'var(--ct-shadow, 0 8px 24px rgba(0,0,0,.18))' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11.5 }}>
              <input type="checkbox" checked={s.prefs.sqzPane} onChange={s.toggleSqzPane} aria-label="Squeeze pane" /> Squeeze pane
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11.5 }}>
              <input type="checkbox" checked={s.prefs.donchian} onChange={s.toggleDonchian} aria-label="Donchian 20 lines" /> Donchian 20 lines
            </label>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => s.setAll(!allOn)} style={small}>{allOn ? 'Hide all' : 'Show all'}</button>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the setup list" style={small}>Close list</button>
          </div>
          {dock && <div data-testid="setup-headline" style={{ marginTop: 6, fontWeight: 650, color: 'var(--mc-text-1)' }}>{s.banner.text}</div>}
          <div style={{ marginTop: 8, marginBottom: 2, fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)' }}>Active on the last bars</div>
          {s.rows.length ? s.rows.map((r) => (
            <div key={`${r.code}:${r.dir}:${r.state}`} data-testid="setup-active-row" style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '2px 0', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: setupColor(r.code, r.dir, light), fontWeight: 700, minWidth: 36 }}>{tagOf(r.code, r.dir)}</span>
              <span>{r.text}</span>
            </div>
          )) : <div style={{ color: 'var(--mc-text-2)' }}>{s.status === 'ready' ? 'No setup on the last 10 bars.' : s.banner.text}</div>}
          <div style={{ marginTop: 10, marginBottom: 2, fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)' }}>Setup types · tags in view</div>
          {SETUP_CODES.map((c) => {
            const m = SETUP_META[c];
            const on = s.prefs.shown[c] !== false;
            return (
              <label key={c} data-testid={`setup-type-${c}`} title={`${m.method}: ${setupRuleText(c, s.tf)}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', borderBottom: '1px solid var(--mc-border-3)', cursor: 'pointer' }}>
                <input type="checkbox" checked={on} onChange={() => s.toggleType(c)} aria-label={`Show ${m.label}`} />
                <span style={{ color: setupColor(c, 1, light), fontWeight: 700, minWidth: 36, fontSize: 11 }}>{tagOf(c, 1)}</span>
                <b style={{ color: 'var(--mc-text-0)', fontWeight: 600 }}>{c === 'WT3' || c === 'NH' ? setupName(c, 1, s.tf) : m.label}</b>
                <span style={{ color: 'var(--mc-text-3)' }}>· {m.method}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--mc-text-2)', fontVariantNumeric: 'tabular-nums' }}>{s.counts[c] ?? 0}</span>
              </label>
            );
          })}
          <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-text-3)' }}>
            Read on the {TF_BAR[s.tf]} candles on screen{s.dropped ? ' — the last candle is still forming and is not read' : ', completed candles only'}. Tags above a candle point up, below point down; grey ones are quiet-bar or squeeze notes. Boxes are the latest Darvas boxes. Hover a type for its rule.{s.display === 'clean' ? ` Clean view: tags are drawn on the last ${CLEAN_SETUP_BARS} bars only (Research shows them all); the counts here are for every candle in view.` : ''} Our own version of the published rules — a reading of the bars, not a signal to act on; check it on the chart.
          </div>
        </div>
      )}
    </div>
  );
}
