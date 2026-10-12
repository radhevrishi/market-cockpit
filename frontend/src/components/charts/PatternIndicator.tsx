'use client';
// zzz982 — "Automate chart patterns" for /charts: the hook that runs lib/chart-patterns on the DAILY bars of the symbol on
// screen (and draws the chosen pattern's lines), and the one-line status banner at the top of the chart with its dropdown.
// Runs only while the indicator is in the working layout (Indicators ▾ → Automate chart patterns).
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import { analyzePatterns, PATTERN_META, type PatternHit, type PatternId } from '@/lib/chart-patterns';
import { cacheChart, freshChart, type CachedChart } from '@/lib/chart-refresh';
import type { Bar } from '@/lib/chart-math';
import {
  EMPTY_PATTERNS, FAILED_COLOR, PATTERN_GROUP, PATTERN_OVERLAY, bannerColors, bannerOf, barsRevision, distWords, hitColor, hitsFor, hitsToDraw, lengthWords,
  overlayFit, patternDataPlan, patternKey, priceDecimals, shapeScoreWords, shownStatus, stageWords, togglePicked, type PatternState,
} from './pattern-view';

interface ShownResponse {
  ticker?: string; market?: string; interval?: string; range?: string; basis?: string; requestedExchange?: string | null;
  /** zzz990 (CP-03) — Yahoo's first-trade (listing) date, ms; the IPO-base rule needs it */
  firstTradeT?: number | null;
  bars?: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
}
const DAILY_TTL = 300_000;
/** A stable number per response object: a reloaded response (even with identical bars) is a new revision. */
const _respIds = new WeakMap<object, number>();
let _respSeq = 0;
const responseRev = (r: object | null | undefined) => {
  if (!r) return 0;
  let id = _respIds.get(r);
  if (id == null) { id = ++_respSeq; _respIds.set(r, id); }
  return id;
};

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
  /** zzz990 (CP-07) — the main chart's own load state, so a failed / empty load is reported instead of "looking…" forever */
  chart?: { loading: boolean; error: string | null };
}

export function usePatternIndicator(a: PatternIndicatorArgs) {
  const { on, ready, ticker, market, exchange, basis, live, bars, chartRef, cacheRef, cur, chart: chartLoad } = a;
  const key = patternKey(market, ticker, exchange, basis);
  const [state, setState] = useState<PatternState>(EMPTY_PATTERNS);
  const [picked, setPicked] = useState<{ key: string; ids: Set<PatternId> } | null>(null);
  const plan = patternDataPlan(live, ticker, market, exchange, basis);
  // zzz990 (CP-01) — every bar's OHLCV (not count + last close) and the response object itself are the data revision
  const barsRev = useMemo(() => barsRevision(bars), [bars]);
  const liveRev = responseRev(live);
  const useShown = plan.useShown && bars.length > 0;
  const hasLive = !!live;
  const liveFirstTrade = live?.firstTradeT ?? null;

  // ── detection: debounced, re-run when the symbol or ANY of its data change ──────────
  useEffect(() => {
    if (!on) return;   // nothing runs while the indicator is off (hits are hidden by `on` below)
    let cancelled = false;
    const ctrl = new AbortController();
    const finish = (daily: Bar[], firstTradeT: number | null | undefined) => {
      if (cancelled) return;
      try {
        const r = analyzePatterns(daily, firstTradeT != null && Number.isFinite(firstTradeT) ? { firstTradeT } : undefined);
        if (r.tooShort) setState({ key, hits: [], at: Date.now(), status: 'short', error: `Too little history (${r.usableBars} usable bar${r.usableBars === 1 ? '' : 's'})` });
        else setState({ key, hits: r.hits, at: Date.now(), status: 'ready' });
      } catch (e) {
        // zzz990 (CP-10) — a detection failure is an error, never "No clear chart pattern"
        setState({ key, hits: [], at: Date.now(), status: 'error', error: `pattern detection failed (${String((e as Error)?.message || e)})` });
      }
    };
    // a new symbol shows "looking…" at once: statusFor() reports 'loading' until a state for this key is set
    // the chart is still loading this symbol: wait for it (its daily answer may be the very data we need)
    if (!hasLive) return () => { cancelled = true; };
    const timer = setTimeout(() => {
      if (useShown) { finish(bars, liveFirstTrade); return; }
      const cached = freshChart(cacheRef.current, plan.url, DAILY_TTL) as ShownResponse | null;
      const fromResponse = (j: ShownResponse): Bar[] => { const b = j.bars!; return b.t.map((t, i) => ({ t, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] })); };
      if (cached?.bars) { finish(fromResponse(cached), cached.firstTradeT ?? liveFirstTrade); return; }
      fetch(plan.url, { signal: ctrl.signal, cache: 'no-store' })
        .then(async (r) => {
          const j = (await r.json().catch(() => null)) as (ShownResponse & { ok?: boolean; error?: string }) | null;
          if (r.status === 404) { const err = new Error(j?.error || 'no price history'); (err as any).unavailable = true; throw err; }
          if (!r.ok || !j?.ok || !j.bars) throw new Error(j?.error || `daily bars unavailable (HTTP ${r.status})`);
          // never mix symbols: the answer must be for the ticker / market / exchange / price basis this effect was started for
          if (String(j.ticker || '').toUpperCase() !== ticker.toUpperCase() || (j.market && j.market !== market)) throw new Error('daily bars were for another symbol');
          if (j.basis && j.basis !== basis) throw new Error('daily bars were for another price basis');
          if (market === 'IN' && j.requestedExchange !== undefined && (j.requestedExchange || undefined) !== (exchange || undefined)) throw new Error('daily bars were for another exchange');
          if (cancelled) return;
          cacheChart(cacheRef.current, plan.url, j as any);
          finish(fromResponse(j), j.firstTradeT ?? liveFirstTrade);
        })
        .catch((e) => {
          if (cancelled || ctrl.signal.aborted) return;   // a late answer for an older symbol / data revision never lands
          setState({ key, hits: [], at: Date.now(), status: e?.unavailable ? 'unavailable' : 'error', error: String(e?.message || e) });
        });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
    // barsRev + liveRev stand for `bars` / `live` (new objects on every load); plan.url for ticker / market / exchange / basis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, hasLive, useShown, plan.url, barsRev, liveRev, cacheRef, market, ticker, exchange, basis]);

  const hits = useMemo(() => (on ? hitsFor(state, key) : []), [on, state, key]);
  const shown = on ? shownStatus(state, key, hasLive, chartLoad) : { status: 'idle' as const, error: undefined };
  const pickedIds = picked && picked.key === key ? picked.ids : null;
  const drawn = useMemo(() => hitsToDraw(hits, pickedIds), [hits, pickedIds]);
  const togglePick = (id: PatternId) => setPicked({ key, ids: togglePicked(hits, pickedIds, id) });
  // zzz990 (CP-06) — lines of the drawn hits too short to draw on this timeframe (left out, not flattened)
  const omittedLines = useMemo(() => {
    if (!on || !drawn.length || !bars.length) return 0;
    const times = bars.map((b) => b.t);
    return drawn.reduce((n, h) => n + overlayFit(h, times).omitted, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, drawn, barsRev]);

  // ── draw the chosen pattern(s); its own overlay group, removed on symbol change / indicator off ──
  const shownTimesSig = barsRev;
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    chart.removeOverlay({ groupId: PATTERN_GROUP });
    if (!on || !drawn.length || !bars.length) return;
    const times = bars.map((b) => b.t);
    const fmt = (n: number) => `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: priceDecimals(n), maximumFractionDigits: priceDecimals(n) })}`;
    for (const h of drawn) {
      for (const ln of overlayFit(h, times, fmt).lines) {
        try {
          chart.createOverlay({ name: PATTERN_OVERLAY, groupId: PATTERN_GROUP, lock: true, points: ln.points, extendData: { color: ln.color, dashed: ln.dashed, size: ln.size, label: ln.label } });
        } catch { /* a line that cannot be placed is skipped */ }
      }
    }
    return () => { try { chart.removeOverlay({ groupId: PATTERN_GROUP }); } catch { /* chart already disposed */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, on, drawn, shownTimesSig, cur, chartRef]);

  return { on, hits, status: shown.status, error: shown.error, drawnIds: new Set(drawn.map((h) => h.id)), togglePick, omittedLines };
}

const fmtMoney = (n: number | null, cur: string) => (n == null ? '—' : `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: priceDecimals(n), maximumFractionDigits: priceDecimals(n) })}`);

export function PatternBanner({ p, cur, light, onTurnOff, tf }: { p: ReturnType<typeof usePatternIndicator>; cur: string; light: boolean; onTurnOff: () => void; /** timeframe on screen: a "Daily pattern" badge on W / M */ tf?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const show = p.on && (open || pinned) && p.hits.length > 0;
  // zzz990 (CP-09) — Escape and a click outside dismiss the list (pinned or not)
  useEffect(() => {
    if (!show) return;
    const close = () => { setPinned(false); setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent | TouchEvent) => { const t = e.target as Node | null; if (boxRef.current && t && !boxRef.current.contains(t)) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [show]);
  if (!p.on) return null;
  const banner = bannerOf(p.hits, cur, p.status, p.error);
  const col = bannerColors(banner.tone, light);
  const notDaily = !!tf && tf !== 'D';
  return (
    <div ref={boxRef} onMouseLeave={() => { if (!pinned) setOpen(false); }}
      style={{ position: 'absolute', left: 8, top: 4, zIndex: 7, maxWidth: 'calc(100% - 100px)', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 6, border: `1px solid ${col.border}`, background: col.bg, color: col.text, lineHeight: '18px' }}>
        {notDaily && (
          <span title="Patterns are found on the DAILY bars and drawn on the candles on screen" data-testid="daily-pattern-badge"
            style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4, border: `1px solid ${col.border}`, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>Daily pattern</span>
        )}
        <button type="button" onMouseEnter={() => setOpen(true)} onClick={() => setPinned((v) => !v)} aria-expanded={show}
          onKeyDown={(e) => { if (e.key === 'Escape') { setPinned(false); setOpen(false); } }}
          title={p.hits.length ? 'Chart patterns on the daily bars — click to keep the list open; tick a row to draw it. Esc closes the list.' : 'Automate chart patterns (daily bars)'}
          style={{ background: 'none', border: 'none', color: col.text, cursor: p.hits.length ? 'pointer' : 'default', padding: notDaily ? '1px 4px 1px 2px' : '1px 4px 1px 8px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, textAlign: 'left' }}>
          {banner.text}{p.hits.length > 0 ? ' ▾' : ''}
        </button>
        <button type="button" onClick={onTurnOff} aria-label="Turn off Automate chart patterns" title="Turn off Automate chart patterns (Indicators ▾ turns it back on)"
          style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '0 6px', fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
      {show && (
        <div role="dialog" aria-label="Chart patterns found"
          style={{ marginTop: 4, width: 'min(560px, calc(100vw - 80px))', maxHeight: 360, overflowY: 'auto', padding: 8, borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)', boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { setPinned(false); setOpen(false); }} aria-label="Close the pattern list"
              style={{ background: 'none', border: '1px solid var(--mc-border-1)', borderRadius: 4, color: 'var(--mc-text-2)', cursor: 'pointer', fontSize: 11, padding: '0 6px' }}>Close list</button>
          </div>
          {p.hits.map((h) => {
            const c = hitColor(h);
            const failed = h.stage === 'failed';
            const textC = failed ? (light ? '#9A5B00' : FAILED_COLOR) : light ? (h.bias === 'bullish' ? '#05705E' : '#C8102E') : (h.bias === 'bullish' ? '#22C3A6' : '#FF6B78');
            return (
              <div key={h.id} style={{ padding: '6px 4px', borderBottom: '1px solid var(--mc-border-3)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={p.drawnIds.has(h.id)} onChange={() => p.togglePick(h.id)} aria-label={`Draw ${h.label} on the chart`} />
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
                  <b style={{ color: 'var(--mc-text-0)' }}>{h.label}</b>
                  <span style={{ color: textC, fontWeight: 600 }}>{h.bias}{failed ? ' · failed' : ''}</span>
                  <span style={{ color: 'var(--mc-text-3)' }}>· {stageWords(h)} · {h.likelihood} · {shapeScoreWords(h)}</span>
                </label>
                <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-2)', fontVariantNumeric: 'tabular-nums' }}>
                  {h.bias === 'bullish' ? 'Pivot' : 'Breakdown'} {fmtMoney(h.pivot, cur)} · close {distWords(h)} · {lengthWords(h.lengthBars)}{h.depthPct != null ? ` · ${h.depthPct}% deep` : ''}{h.volumeOk === false ? ' · volume not confirmed' : ''}
                </div>
                <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-3)' }}>{h.note}</div>
                <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>{PATTERN_META[h.id].short}</div>
              </div>
            );
          })}
          {p.omittedLines > 0 && (
            <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-warn, #D97706)' }}>
              {p.omittedLines} sloping line{p.omittedLines === 1 ? ' is' : 's are'} shorter than one candle on this timeframe and {p.omittedLines === 1 ? 'is' : 'are'} not drawn — switch to D to see the lines.
            </div>
          )}
          <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-text-3)' }}>
            Found on the daily bars (the last ~2.8 years), whatever timeframe is on screen. Active structures are listed before failed ones (amber). The shape score is how closely the bars fit the pattern&apos;s rules — a heuristic, not a probability. Ticked rows are drawn on the chart; they are not saved as drawings. A reading of the shape, not a signal — check it on the chart.
          </div>
        </div>
      )}
    </div>
  );
}
