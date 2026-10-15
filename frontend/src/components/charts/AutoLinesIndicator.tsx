'use client';
// zzz1025 — "Auto trendlines & levels" for /charts: the hook that reads the completed candles on screen (D / W / M), runs
// lib/auto-lines (lines and levels with 3 or more touches), draws them (auto-lines-kline), shows a tooltip when the mouse is on
// a line, and the one-line status banner with its list (show trendlines / show levels, every line with its touches).
// On by default; runs only while the indicator is in the working layout (Indicators ▾ → Auto trendlines & levels).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import type { Bar } from '@/lib/chart-math';
import { autoLines, linePriceAt, type AutoLinesTf } from '@/lib/auto-lines';
import { bannerColors, barsRevision } from './pattern-view';
import { overlayChipText, type ChartDisplay } from '@/lib/chart-display';
import { DOCK_BOX, DOCK_PANEL, DOCK_PILL, type OverlayDock } from './overlay-dock';
import { completedBars } from './setup-view';
import {
  ALN_INDICATOR, ALN_PREFS_KEY, alnColorOf, alnPayload, alnRef, alnRefText, autoLinesHeadline, autoLinesRows, levelId, lineId, parseAutoLinesPrefs, serializeAutoLinesPrefs,
  type AlnStatus, type AutoLinesPrefs,
} from './auto-lines-view';

export interface AutoLinesArgs {
  on: boolean; ready: boolean;
  market: string;
  /** candles on screen, already the chart's timeframe and identity-checked by the page */
  bars: Bar[];
  tf: AutoLinesTf;
  /** the chart's price scale is logarithmic (lines are then found in % terms) */
  log: boolean;
  chartRef: RefObject<Chart | null>;
  light: boolean;
  /** zzz1029 — Clean (default) merges nearby right-edge tags and caps them; Research shows every tag. Lines are the same. */
  display?: ChartDisplay;
  /** zzz1029 — prices whose right-edge tags are drawn by others (a picked pattern's pivot): the tags here keep clear of them */
  avoid?: number[];
}

function readPrefs(): AutoLinesPrefs {
  try { return parseAutoLinesPrefs(localStorage.getItem(ALN_PREFS_KEY)); } catch { return parseAutoLinesPrefs(null); }
}
const MIN_BARS = 30;

export function useAutoLines(a: AutoLinesArgs) {
  const { on, ready, market, bars, tf, log, chartRef, light } = a;
  const display: ChartDisplay = a.display === 'research' ? 'research' : 'clean';
  const avoidSig = (a.avoid || []).filter((x) => Number.isFinite(x)).join(',');
  const [prefs, setPrefsState] = useState<AutoLinesPrefs>(readPrefs);
  const setPrefs = useCallback((fn: (p: AutoLinesPrefs) => AutoLinesPrefs) => {
    setPrefsState((p) => {
      const next = fn(p);
      try { localStorage.setItem(ALN_PREFS_KEY, serializeAutoLinesPrefs(next)); } catch { /* this visit only */ }
      return next;
    });
  }, []);
  const barsRev = useMemo(() => barsRevision(bars), [bars]);
  const mkt: 'US' | 'IN' = market === 'IN' ? 'IN' : 'US';

  // ── lines on the completed candles (all loaded bars, once per bar set / timeframe / scale — not per scroll) ──
  const comp = useMemo(() => {
    if (!on || !bars.length) return null;
    const { bars: done, dropped } = completedBars(bars, tf, mkt);
    let res: ReturnType<typeof autoLines> | null = null;
    try { res = done.length >= MIN_BARS ? autoLines(done, { tf, log }) : null; } catch { res = null; }
    return { done, dropped, res };
    // barsRev stands for `bars` (a new array on every load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, barsRev, tf, mkt, log]);

  const decimals = bars.length && Math.abs(bars[bars.length - 1].c) < 1 ? 4 : 2;
  const cur = mkt === 'IN' ? '₹' : '$';
  const status: AlnStatus = !on ? 'idle' : !bars.length ? 'loading' : !comp || comp.done.length < MIN_BARS ? 'short' : 'ready';
  // which prices the distances use: the last completed close (what the lines were found on) and the latest candle (may be forming)
  const ref = useMemo(() => (comp ? alnRef(comp.done, bars) : null),
    // barsRev stands for `bars`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comp, barsRev]);
  const rows = useMemo(() => (comp ? autoLinesRows(comp.done, comp.res, tf, decimals, ref, cur) : []), [comp, tf, decimals, ref, cur]);
  const nProv = useMemo(() => rows.filter((r) => r.prov && (r.id.startsWith('t:') ? prefs.trend : prefs.levels)).length, [rows, prefs]);
  const headline = useMemo(() => autoLinesHeadline(comp?.res ?? null, tf, status, prefs, nProv), [comp, tf, status, prefs, nProv]);
  const refText = useMemo(() => alnRefText(ref, tf, decimals, cur), [ref, tf, decimals, cur]);
  const payload = useMemo(() => (comp ? { ...alnPayload(comp.done, comp.res, prefs, light, decimals, ref), display, avoid: avoidSig ? avoidSig.split(',').map(Number) : [] } : null), [comp, prefs, light, decimals, ref, display, avoidSig]);

  // ── paint ─────────────────────────────────────────────────────────────────────
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverId = hover?.id ?? null;
  const drawn = useRef(false);
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    let alive = true;
    const clear = () => { try { chart.removeIndicator({ name: ALN_INDICATOR }); } catch { /* chart disposed */ } drawn.current = false; };
    clear();
    if (!on || !payload || (!payload.lines.length && !payload.levels.length)) return;
    import('klinecharts').then(async (kc) => {
      if (!alive) return;
      const { registerAutoLinesIndicator } = await import('./auto-lines-kline');
      registerAutoLinesIndicator(kc);
      try { chart.createIndicator({ name: ALN_INDICATOR, paneId: 'candle_pane', extendData: { ...payload, hover: null } }, true); drawn.current = true; } catch { /* an extra: never break the chart */ }
    }).catch(() => { /* chart engine not loaded */ });
    return () => { alive = false; clear(); };
  }, [ready, on, payload, chartRef]);
  // the hovered line drawn a little heavier
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !drawn.current || !payload) return;
    try { chart.overrideIndicator({ name: ALN_INDICATOR, paneId: 'candle_pane', extendData: { ...payload, hover: hoverId } }); } catch { /* disposed */ }
  }, [hoverId, payload, chartRef]);

  // ── hover: the mouse within 6 px of a line or level ──────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!on || !ready || !chart || !comp?.res) { setHover(null); return; }
    const res = comp.res;
    let raf = 0;
    const onMove = (d: any) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = typeof d?.dataIndex === 'number' ? d.dataIndex : null;
        if (k == null || typeof d?.x !== 'number' || typeof d?.y !== 'number' || d?.paneId !== 'candle_pane') { setHover((h) => (h ? null : h)); return; }
        let pick: { id: string; dist: number } | null = null;
        const near = (id: string, price: number) => {
          if (!(price > 0)) return;
          try {
            const p = chart.convertToPixel({ dataIndex: k, value: price }, { paneId: 'candle_pane' }) as { y?: number };
            if (typeof p?.y !== 'number') return;
            const dist = Math.abs(p.y - d.y);
            if (dist <= 6 && (!pick || dist < pick.dist)) pick = { id, dist };
          } catch { /* outside */ }
        };
        if (prefs.trend) for (const l of res.trend) {
          const endK = l.breakIndex != null ? l.breakIndex + 3 : Infinity;
          if (k >= l.firstTouch && k <= endK) near(lineId(l), linePriceAt(l, k));
        }
        if (prefs.levels) for (const l of res.levels) if (k >= l.firstTouch) near(levelId(l), l.price);
        const b = pick as { id: string; dist: number } | null;
        setHover((h) => (b ? (h && h.id === b.id && Math.abs(h.x - d.x) < 2 && Math.abs(h.y - d.y) < 2 ? h : { id: b.id, x: d.x, y: d.y }) : h ? null : h));
      });
    };
    try { chart.subscribeAction('onCrosshairChange', onMove); } catch { /* no hover */ }
    return () => { cancelAnimationFrame(raf); try { chart.unsubscribeAction('onCrosshairChange', onMove); } catch { /* disposed */ } setHover(null); };
  }, [on, ready, chartRef, comp, prefs]);

  const hoverRow = hover ? rows.find((r) => r.id === hover.id) ?? null : null;
  const toggleTrend = useCallback(() => setPrefs((p) => ({ ...p, trend: !p.trend })), [setPrefs]);
  const toggleLevels = useCallback(() => setPrefs((p) => ({ ...p, levels: !p.levels })), [setPrefs]);
  return { on, status, headline, refText, rows, prefs, tf, dropped: !!comp?.dropped, log: !!comp?.res?.log, hover, hoverRow, toggleTrend, toggleLevels, display };
}

export type AutoLinesP = ReturnType<typeof useAutoLines>;
const TF_BAR: Record<AutoLinesTf, string> = { D: 'daily', W: 'weekly', M: 'monthly' };
const TF_UNIT: Record<AutoLinesTf, string> = { D: 'day', W: 'week', M: 'month' };

export function AutoLinesBanner({ s, light, top = 4, onTurnOff, dock }: { s: AutoLinesP; light: boolean; top?: number; onTurnOff: () => void; /** zzz1029 — a chip in the overlay summary row */ dock?: OverlayDock }) {
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
  const col = bannerColors('none', light);
  const small = { background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-1)', borderRadius: 6, color: 'var(--mc-text-2)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: '1px 8px', whiteSpace: 'nowrap' as const };
  const trendRows = s.rows.filter((r) => r.id.startsWith('t:'));
  const levelRows = s.rows.filter((r) => r.id.startsWith('l:'));
  const nTrend = trendRows.length, nLevels = levelRows.length;
  const sw = (kind: 'support' | 'resistance', broken: boolean, level: boolean) => (
    <span aria-hidden style={{ display: 'inline-block', width: 16, height: 0, borderTop: `2px ${broken || level ? 'dashed' : 'solid'} ${alnColorOf(kind, broken, light)}`, transform: level ? 'none' : kind === 'support' ? 'rotate(-18deg)' : 'rotate(18deg)', flex: '0 0 auto', marginTop: 2 }} />
  );
  const row = (r: AutoLinesP['rows'][number], level: boolean) => (
    <div key={r.id} data-testid="aln-row" title={r.tip}
      style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 2px', borderBottom: '1px solid var(--mc-border-3)', fontVariantNumeric: 'tabular-nums', opacity: s.hover && s.hover.id !== r.id ? 0.75 : 1 }}>
      {sw(r.kind, r.broken, level)}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 650, color: 'var(--mc-text-0)' }}>{r.title}</div>
        <div style={{ color: 'var(--mc-text-2)', fontSize: 11.5 }}>{r.detail}</div>
      </div>
      <span title={`Strength ${r.strength}/100 — touches, span, how tightly price reacted, how recent and how near price`}
        style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-text-3)', whiteSpace: 'nowrap' }}>{r.strength}</span>
    </div>
  );
  return (
    <>
      <div ref={boxRef} data-testid="aln-banner-box" style={dock ? DOCK_BOX : { position: 'absolute', left: 8, top, zIndex: 6, maxWidth: 'calc(100% - 100px)', fontSize: 12 }}>
        <div data-testid="aln-banner" style={{ ...(dock ? DOCK_PILL : null), display: 'flex', alignItems: 'center', gap: 4, minHeight: 24, borderRadius: 8, border: `1px solid ${col.border}`, background: `linear-gradient(${col.bg}, ${col.bg}), var(--mc-bg-0)`, color: col.text, lineHeight: '18px', boxShadow: '0 1px 0 rgba(18,23,34,.04), 0 6px 16px -10px rgba(18,23,34,.35)' }}>
          <span aria-hidden style={{ display: 'inline-flex', gap: 2, paddingLeft: 8 }}>
            <span style={{ width: 8, height: 2, background: alnColorOf('support', false, light), borderRadius: 1, transform: 'rotate(-25deg)' }} />
            <span style={{ width: 8, height: 2, background: alnColorOf('resistance', false, light), borderRadius: 1, transform: 'rotate(25deg)' }} />
          </span>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog"
            title={`${s.headline}\n\nTrendlines and horizontal levels where price turned 3 or more times, found on the ${TF_BAR[s.tf]} candles on screen. A line with only 2 touches is never shown. Click for the list; hover a line on the chart for its touches.${s.dropped ? '\nThe last candle is still forming and is not read.' : ''}${s.refText ? `\n${s.refText}` : ''}`}
            style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '1px 4px 1px 4px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, textAlign: 'left' }}>
            {dock ? overlayChipText('alines', s.headline) : s.headline} ▾
          </button>
          <button type="button" onClick={onTurnOff} aria-label="Turn off Auto trendlines & levels" title="Turn off Auto trendlines & levels (Indicators ▾ or the right-click menu turns it back on)"
            style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '0 6px', fontSize: 13, lineHeight: 1 }}>×</button>
        </div>
        {open && (
          <div role="dialog" aria-label="Auto trendlines & levels"
            style={{ marginTop: 6, width: 'min(460px, calc(100vw - 80px))', maxHeight: 440, ...(dock ? DOCK_PANEL : null), overflowY: 'auto', padding: '8px 10px 10px', borderRadius: 12, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', boxShadow: 'var(--ct-shadow, 0 8px 24px rgba(0,0,0,.18))' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={s.prefs.trend} onChange={s.toggleTrend} aria-label="Show trendlines" /> Trendlines
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={s.prefs.levels} onChange={s.toggleLevels} aria-label="Show levels" /> Levels
              </label>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close the list" style={small}>Close list</button>
            </div>
            {dock && <div data-testid="aln-headline" style={{ marginTop: 6, fontWeight: 650, color: 'var(--mc-text-1)' }}>{s.headline}</div>}
            {s.refText && <div data-testid="aln-ref" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--mc-text-2)', lineHeight: 1.4 }}>{s.refText}</div>}
            <div style={{ marginTop: 10, marginBottom: 2, fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)' }}>Trendlines · {nTrend}</div>
            {nTrend ? trendRows.map((r) => row(r, false)) : <div style={{ color: 'var(--mc-text-2)', padding: '2px 0' }}>{s.status === 'ready' ? 'No trendline with 3 or more touches near price.' : s.headline}</div>}
            <div style={{ marginTop: 10, marginBottom: 2, fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)' }}>Levels (highest first) · {nLevels}</div>
            {nLevels ? levelRows.map((r) => row(r, true)) : <div style={{ color: 'var(--mc-text-2)', padding: '2px 0' }}>{s.status === 'ready' ? 'No level with 3 or more touches near price.' : s.headline}</div>}
            <div style={{ paddingTop: 8, fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.45 }}>
              Found on the {TF_BAR[s.tf]} candles loaded{s.dropped ? ' (the last candle is still forming and is not read)' : ''}. A line needs 3 or more separate touches and no close through it between the first and last touch; a few wicks through it are allowed. Grey dashed = broken (a close beyond it after the last touch). Provisional breach = the latest price is through the line but the {TF_UNIT[s.tf]} has not closed; it counts only on a completed close. Thicker = stronger; dashed = weaker. {s.log ? 'Lines are found in % terms (log scale).' : 'Lines are found on the normal price scale.'}{s.display === 'clean' ? ' Clean view: tags of lines within about 1.2% of each other are merged into one tag at the right edge and only the nearest ones are shown — the exact price of every line is in this list.' : ''} A reading of the bars, not a signal to act on — check it on the chart.
            </div>
          </div>
        )}
      </div>
      {s.hover && s.hoverRow && (
        <div role="tooltip" data-testid="aln-tooltip"
          style={{ position: 'absolute', left: Math.max(8, s.hover.x + 14), top: Math.max(8, s.hover.y + 14), transform: s.hover.x > 360 ? 'translateX(calc(-100% - 28px))' : undefined, zIndex: 7, pointerEvents: 'none', maxWidth: 320, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', fontSize: 11.5, lineHeight: 1.45, whiteSpace: 'pre-line', boxShadow: 'var(--ct-shadow, 0 8px 24px rgba(0,0,0,.18))' }}>
          {s.hoverRow.tip}
        </div>
      )}
    </>
  );
}
