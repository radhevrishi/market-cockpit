'use client';
// zzz982 — "Automate chart patterns" for /charts: the hook that runs lib/chart-patterns on the DAILY bars of the symbol on
// screen (and draws the chosen pattern's lines), and the one-line status banner at the top of the chart with its dropdown.
// Runs only while the indicator is in the working layout (Indicators ▾ → Automate chart patterns).
import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import { detectPatterns, PATTERN_META, type PatternHit, type PatternId } from '@/lib/chart-patterns';
import { cacheChart, freshChart, type CachedChart } from '@/lib/chart-refresh';
import type { Bar } from '@/lib/chart-math';
import {
  EMPTY_PATTERNS, PATTERN_GROUP, PATTERN_OVERLAY, bannerColors, bannerOf, biasColor, distWords, hitsFor, hitsToDraw, lengthWords,
  overlayLinesOf, patternDataPlan, patternKey, priceDecimals, stageWords, statusFor, togglePicked, type PatternState,
} from './pattern-view';

interface ShownResponse { ticker?: string; market?: string; interval?: string; range?: string; bars?: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] } }
const DAILY_TTL = 300_000;

export interface PatternIndicatorArgs {
  on: boolean; ready: boolean;
  ticker: string; market: string; exchange: string | undefined; basis: 'price' | 'tr';
  /** The chart response for THIS symbol (identity-checked by the page), or null while another one is still shown. */
  live: ShownResponse | null;
  /** Candles on screen (daily, weekly or monthly). */
  bars: Bar[];
  chartRef: RefObject<Chart | null>;
  cacheRef: RefObject<Map<string, CachedChart<any>>>;
  cur: string;
}

export function usePatternIndicator(a: PatternIndicatorArgs) {
  const { on, ready, ticker, market, exchange, basis, live, bars, chartRef, cacheRef, cur } = a;
  const key = patternKey(market, ticker, exchange, basis);
  const [state, setState] = useState<PatternState>(EMPTY_PATTERNS);
  const [picked, setPicked] = useState<{ key: string; ids: Set<PatternId> } | null>(null);
  const plan = patternDataPlan(live, ticker, market, exchange, basis);
  const last = bars[bars.length - 1];
  const barsSig = `${bars.length}:${last?.t ?? 0}:${last?.c ?? 0}`;
  const useShown = plan.useShown && bars.length > 0;
  const hasLive = !!live;

  // ── detection: debounced, re-run when the symbol or its data change ──────────
  useEffect(() => {
    if (!on) return;   // nothing runs while the indicator is off (hits are hidden by `on` below)
    let cancelled = false;
    const ctrl = new AbortController();
    const finish = (daily: Bar[]) => {
      if (cancelled) return;
      let hits: PatternHit[] = [];
      try { hits = detectPatterns(daily); } catch { hits = []; }
      setState({ key, hits, at: Date.now(), status: 'ready' });
    };
    // a new symbol shows "looking…" at once: statusFor() reports 'loading' until a state for this key is set
    // the chart is still loading this symbol: wait for it (its daily answer may be the very data we need)
    if (!hasLive) return () => { cancelled = true; };
    const timer = setTimeout(() => {
      if (useShown) { finish(bars); return; }
      const cached = freshChart(cacheRef.current, plan.url, DAILY_TTL) as ShownResponse | null;
      const fromResponse = (j: ShownResponse): Bar[] => { const b = j.bars!; return b.t.map((t, i) => ({ t, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] })); };
      if (cached?.bars) { finish(fromResponse(cached)); return; }
      fetch(plan.url, { signal: ctrl.signal, cache: 'no-store' })
        .then(async (r) => {
          const j = (await r.json().catch(() => null)) as (ShownResponse & { ok?: boolean; error?: string }) | null;
          if (!r.ok || !j?.ok || !j.bars) throw new Error(j?.error || `daily bars unavailable (HTTP ${r.status})`);
          // never mix symbols: the answer must be for the ticker this effect was started for
          if (String(j.ticker || '').toUpperCase() !== ticker.toUpperCase() || (j.market && j.market !== market)) throw new Error('daily bars were for another symbol');
          if (cancelled) return;
          cacheChart(cacheRef.current, plan.url, j as any);
          finish(fromResponse(j));
        })
        .catch((e) => { if (!cancelled && !ctrl.signal.aborted) setState({ key, hits: [], at: Date.now(), status: 'error', error: String(e?.message || e) }); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
    // barsSig stands for `bars` (a new array on every load); plan.url for ticker / market / exchange / basis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, hasLive, useShown, plan.url, barsSig, cacheRef, market, ticker]);

  const hits = useMemo(() => (on ? hitsFor(state, key) : []), [on, state, key]);
  const status = on ? statusFor(state, key) : 'idle';
  const pickedIds = picked && picked.key === key ? picked.ids : null;
  const drawn = useMemo(() => hitsToDraw(hits, pickedIds), [hits, pickedIds]);
  const togglePick = (id: PatternId) => setPicked({ key, ids: togglePicked(hits, pickedIds, id) });

  // ── draw the chosen pattern(s); its own overlay group, removed on symbol change / indicator off ──
  const shownTimesSig = barsSig;
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    chart.removeOverlay({ groupId: PATTERN_GROUP });
    if (!on || !drawn.length || !bars.length) return;
    const times = bars.map((b) => b.t);
    const fmt = (n: number) => `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: priceDecimals(n), maximumFractionDigits: priceDecimals(n) })}`;
    for (const h of drawn) {
      for (const ln of overlayLinesOf(h, times, fmt)) {
        try {
          chart.createOverlay({ name: PATTERN_OVERLAY, groupId: PATTERN_GROUP, lock: true, points: ln.points, extendData: { color: ln.color, dashed: ln.dashed, size: ln.size, label: ln.label } });
        } catch { /* a line that cannot be placed is skipped */ }
      }
    }
    return () => { try { chart.removeOverlay({ groupId: PATTERN_GROUP }); } catch { /* chart already disposed */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, on, drawn, shownTimesSig, cur, chartRef]);

  return { on, hits, status, error: state.key === key ? state.error : undefined, drawnIds: new Set(drawn.map((h) => h.id)), togglePick };
}

const fmtMoney = (n: number | null, cur: string) => (n == null ? '—' : `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: priceDecimals(n), maximumFractionDigits: priceDecimals(n) })}`);

export function PatternBanner({ p, cur, light, onTurnOff }: { p: ReturnType<typeof usePatternIndicator>; cur: string; light: boolean; onTurnOff: () => void }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  if (!p.on) return null;
  const banner = bannerOf(p.hits, cur, p.status, p.error);
  const col = bannerColors(banner.tone, light);
  const show = (open || pinned) && p.hits.length > 0;
  return (
    <div onMouseLeave={() => { if (!pinned) setOpen(false); }}
      style={{ position: 'absolute', left: 8, top: 4, zIndex: 7, maxWidth: 'calc(100% - 100px)', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 6, border: `1px solid ${col.border}`, background: col.bg, color: col.text, lineHeight: '18px' }}>
        <button type="button" onMouseEnter={() => setOpen(true)} onClick={() => setPinned((v) => !v)} aria-expanded={show}
          title={p.hits.length ? 'Chart patterns on the daily bars — click to keep the list open; tick a row to draw it' : 'Automate chart patterns (daily bars)'}
          style={{ background: 'none', border: 'none', color: col.text, cursor: p.hits.length ? 'pointer' : 'default', padding: '1px 4px 1px 8px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, textAlign: 'left' }}>
          {banner.text}{p.hits.length > 0 ? ' ▾' : ''}
        </button>
        <button type="button" onClick={onTurnOff} aria-label="Turn off Automate chart patterns" title="Turn off Automate chart patterns (Indicators ▾ turns it back on)"
          style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '0 6px', fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
      {show && (
        <div role="dialog" aria-label="Chart patterns found"
          style={{ marginTop: 4, width: 'min(560px, calc(100vw - 80px))', maxHeight: 360, overflowY: 'auto', padding: 8, borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)', boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
          {p.hits.map((h) => {
            const c = biasColor(h.bias);
            const textC = light ? (h.bias === 'bullish' ? '#05705E' : '#C8102E') : (h.bias === 'bullish' ? '#22C3A6' : '#FF6B78');
            return (
              <div key={h.id} style={{ padding: '6px 4px', borderBottom: '1px solid var(--mc-border-3)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={p.drawnIds.has(h.id)} onChange={() => p.togglePick(h.id)} aria-label={`Draw ${h.label} on the chart`} />
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
                  <b style={{ color: 'var(--mc-text-0)' }}>{h.label}</b>
                  <span style={{ color: textC, fontWeight: 600 }}>{h.bias}</span>
                  <span style={{ color: 'var(--mc-text-3)' }}>· {stageWords(h)} · {h.likelihood} ({Math.round(h.confidence * 100)}%)</span>
                </label>
                <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-2)', fontVariantNumeric: 'tabular-nums' }}>
                  {h.bias === 'bullish' ? 'Pivot' : 'Breakdown'} {fmtMoney(h.pivot, cur)} · close {distWords(h)} · {lengthWords(h.lengthBars)}{h.depthPct != null ? ` · ${h.depthPct}% deep` : ''}
                </div>
                <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-3)' }}>{h.note}</div>
                <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>{PATTERN_META[h.id].short}</div>
              </div>
            );
          })}
          <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-text-3)' }}>
            Found on the daily bars (the last ~2.8 years), whatever timeframe is on screen. Ticked rows are drawn on the chart; they are not saved as drawings. A reading of the shape, not a signal — check it on the chart.
          </div>
        </div>
      )}
    </div>
  );
}
