'use client';
// zzz982 — "Automate chart patterns" for /charts: the hook that runs lib/chart-patterns on the DAILY bars of the symbol on
// screen (and draws the chosen pattern's lines), and the one-line status banner at the top of the chart with its dropdown.
// Runs only while the indicator is in the working layout (Indicators ▾ → Automate chart patterns).
// zzz992 — Analysis D / W / M (separate from the candles on screen): weekly / monthly aggregate the daily history already
// fetched (completed periods only unless "incl. current" is ticked — then the last candle is provisional). The choice is
// remembered per viewer (PATTERN_TF_KEY), never in the saved drawings. "Fit" zooms the chart to a pattern; "Restore view"
// goes back to the view before the first fit.
// zzz1015 — Auto (the default): daily, weekly and monthly are read together and the most relevant current structure leads; an
// explicit D / W / M still leads with its own timeframe but points to another timeframe's current structure instead of a bare
// "no pattern". The list is grouped by timeframe; the 10-year history for monthly is one shared request (lib/chart-load-cache).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import { analyzeDailyAs, analyzePatterns, PATTERN_META, PATTERN_IDS, PATTERN_MIN_HISTORY, patternApplies, type PatternHit, type PatternTimeframe } from '@/lib/chart-patterns';
import { cacheChart, freshChart, type CachedChart } from '@/lib/chart-refresh';
import { chartFetch } from '@/lib/chart-load-cache';
import type { Bar } from '@/lib/chart-math';
import {
  FAILED_COLOR, PATTERN_GROUP, PATTERN_OVERLAY, PATTERN_TF_KEY, TF_WORD, TF_TITLE, ANALYSIS_TFS, analysisKey, bannerColors, barsRevision, distWords, fitPlan, hitColor, lengthWords,
  overlayFit, parsePatternTfPref, analysisForChartTf, patternDataPlan, patternKey, priceDecimals, serializePatternTfPref, shapeScoreWords, shownStatus, stageWords, handoffSpan, type PatternState, type PatternTfPref, type PatternHandoff,
  patternView, viewBanner, multiBanner, OTHER_TF_SEP, type MultiBanner, rowKeyOf, conditionWords, evidenceWords, pointWords, pointMarks, pointPath, structureRange, PATTERN_POINT, type PatternView, type PatternViewRow, type PatternAnalysisTf, type TfViews,
} from './pattern-view';
import { CLEAN_MIN_SPAN_CANDLES, drawOtherTfStructure, overlayChipText, patternLabelsShown, type ChartDisplay } from '@/lib/chart-display';
import { DOCK_BOX, DOCK_PANEL, DOCK_PILL, type OverlayDock } from './overlay-dock';

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
  /** zzz1008 — the Pine Screener's hand-off (?atf / pat / pf / pt): analysis timeframe for this visit, the pattern to select and fit */
  handoff?: PatternHandoff | null;
  /** zzz1015 — the candles on screen (D / W / M): wins a tie between timeframes in Auto */
  displayTf?: string;
  /** zzz1029 — Clean (default): turning-point codes (TH / TL / LIP …) only while a pattern is picked in the list, its row is hovered
   *  or the mouse is on its lines; Research: always. The patterns found are the same. */
  display?: ChartDisplay;
}

/** zzz1015 — the per-timeframe results of one symbol (each keyed by analysisKey, so a weekly result never shows as daily). */
interface PatternStates { base: string; byKey: Record<string, PatternState> }
const NO_STATES: PatternStates = { base: '', byKey: {} };
const fromResponse = (j: ShownResponse): Bar[] => { const b = j.bars!; return b.t.map((t, i) => ({ t, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] })); };

/** zzz1015 — one analysis of DAILY bars on a timeframe, as an indicator state (zzz992 / zzz1009 rules unchanged). */
function analyseAs(key: string, daily: Bar[], analysisTf: PatternTimeframe, includeCurrent: boolean, firstTradeT: number | null | undefined, market?: string): PatternState {
  try {
    const ft = firstTradeT != null && Number.isFinite(firstTradeT) ? { firstTradeT } : undefined;
    // zzz1009 — `weak: true` also returns the weaker candidates and the expired structures (the qualifying hits are unchanged)
    if (analysisTf === 'D') {
      const r = analyzePatterns(daily, { ...ft, weak: true });
      const lastT = daily.length ? daily[daily.length - 1].t : null;
      if (r.tooShort) return { key, hits: [], at: Date.now(), status: 'short', error: `Too little history (${r.usableBars} usable bar${r.usableBars === 1 ? '' : 's'})` };
      return { key, hits: r.hits, weak: r.weak, expired: r.expired, at: Date.now(), status: 'ready', periodEnd: lastT };
    }
    // weekly / monthly: aggregated from the daily history (completed periods unless the current one is included)
    const r = analyzeDailyAs(daily, analysisTf, { ...ft, completedOnly: !includeCurrent, weak: true, ...(market === 'IN' || market === 'US' ? { market } : {}) });   // zzz1079 — exchange clock
    const w = TF_WORD[analysisTf];
    if (r.tooShort) return { key, hits: [], at: Date.now(), status: 'short', error: `Too little history (${r.usableBars} ${w} bar${r.usableBars === 1 ? '' : 's'})` };
    return { key, hits: r.hits, weak: r.weak, expired: r.expired, at: Date.now(), status: 'ready', provisional: r.provisional, periodEnd: r.periodEnd };
  } catch (e) {
    // zzz990 (CP-10) — a detection failure is an error, never "No clear chart pattern"
    return { key, hits: [], at: Date.now(), status: 'error', error: `pattern detection failed (${String((e as Error)?.message || e)})` };
  }
}

export function usePatternIndicator(a: PatternIndicatorArgs) {
  const { on, ready, ticker, market, exchange, basis, live, bars, chartRef, cacheRef, cur, chart: chartLoad, displayTf } = a;
  const display: ChartDisplay = a.display === 'research' ? 'research' : 'clean';
  // zzz992 — the analysis timeframe (per viewer); hits are keyed by symbol + timeframe so a weekly result never shows as daily
  const handoff = a.handoff || null;
  // zzz1008 — a hand-off's analysis timeframe wins for this visit (the remembered choice is not overwritten)
  // zzz1015 — default Auto; a choice stored before Auto existed reads as Auto (parsePatternTfPref)
  // zzz1019 — the analysis follows the candles on screen: opening the chart, or switching it to D / W / M, reads patterns on that
  // timeframe (as TradingView's indicator does). Auto / another timeframe can still be picked for a look, until the chart's
  // timeframe changes again. Only "include the current week / month" is remembered.
  const [pref, setPref] = useState<PatternTfPref>(() => {
    if (handoff) return { tf: handoff.atf, provisional: false };
    let stored: PatternTfPref;
    try { stored = parsePatternTfPref(localStorage.getItem(PATTERN_TF_KEY)); } catch { stored = parsePatternTfPref(null); }
    return analysisForChartTf(displayTf, stored);
  });
  const lastDisplayTf = useRef(displayTf);
  useEffect(() => {
    if (lastDisplayTf.current === displayTf) return;
    lastDisplayTf.current = displayTf;
    setPref((p) => analysisForChartTf(displayTf, p));
  }, [displayTf]);
  const savePref = useCallback((next: PatternTfPref) => { setPref(next); try { localStorage.setItem(PATTERN_TF_KEY, serializePatternTfPref(next)); } catch { /* this visit only */ } }, []);
  const analysisTf: PatternAnalysisTf = pref.tf, includeCurrent = pref.provisional;
  const base = patternKey(market, ticker, exchange, basis);
  const keyOf = useCallback((tf: PatternTimeframe) => analysisKey(base, tf, includeCurrent), [base, includeCurrent]);
  /** the identity of what is on screen (symbol + mode): picks / fitted views belong to it */
  const key = analysisTf === 'A' ? `${base}|A${includeCurrent ? '+p' : ''}` : keyOf(analysisTf);
  const [states, setStates] = useState<PatternStates>(NO_STATES);
  const [picked, setPicked] = useState<{ key: string; ids: Set<string> } | null>(null);
  // the history each timeframe reads: daily / weekly 5 years, monthly 10 years (the bars on screen when they are long enough)
  const plan5 = patternDataPlan(live, ticker, market, exchange, basis, 'D');
  const plan10 = patternDataPlan(live, ticker, market, exchange, basis, 'M');
  // zzz990 (CP-01) — every bar's OHLCV (not count + last close) and the response object itself are the data revision
  const barsRev = useMemo(() => barsRevision(bars), [bars]);
  const liveRev = responseRev(live);
  const use5 = plan5.useShown && bars.length > 0, use10 = plan10.useShown && bars.length > 0;
  const hasLive = !!live;
  const liveFirstTrade = live?.firstTradeT ?? null;

  // ── detection: debounced, re-run when the symbol or ANY of its data change ──────────
  // zzz1015 — daily, weekly AND monthly are read (Auto picks the most relevant; an explicit choice still names other timeframes'
  // current structures). D / W come from the 5-year history (the chart's own answer when daily); M needs 10 years: one more
  // shared request (lib/chart-load-cache) only when M is wanted — Auto / M, or D / W found nothing current.
  useEffect(() => {
    if (!on) return;   // nothing runs while the indicator is off (hits are hidden by `on` below)
    let cancelled = false;
    const ctrl = new AbortController();
    const put = (list: PatternState[]) => {
      if (cancelled) return;
      setStates((prev) => {
        const byKey = prev.base === base ? { ...prev.byKey } : {};
        for (const st of list) byKey[st.key] = st;
        return { base, byKey };
      });
    };
    const load = (url: string, useShownBars: boolean): Promise<{ daily: Bar[]; firstTradeT: number | null | undefined }> => {
      if (useShownBars) return Promise.resolve({ daily: bars, firstTradeT: liveFirstTrade });
      const cached = freshChart(cacheRef.current, url, DAILY_TTL) as ShownResponse | null;
      if (cached?.bars) return Promise.resolve({ daily: fromResponse(cached), firstTradeT: cached.firstTradeT ?? liveFirstTrade });
      // zzz1015 — one shared request per URL (the chart, the stage indicator and prefetches join it)
      return chartFetch(url, { signal: ctrl.signal, cache: 'no-store' }).then(async (r) => {
        const j = (await r.json().catch(() => null)) as (ShownResponse & { ok?: boolean; error?: string }) | null;
        if (r.status === 404) { const err = new Error(j?.error || 'no price history'); (err as any).unavailable = true; throw err; }
        if (!r.ok || !j?.ok || !j.bars) throw new Error(j?.error || `daily bars unavailable (HTTP ${r.status})`);
        // never mix symbols: the answer must be for the ticker / market / exchange / price basis this effect was started for
        if (String(j.ticker || '').toUpperCase() !== ticker.toUpperCase() || (j.market && j.market !== market)) throw new Error('daily bars were for another symbol');
        if (j.basis && j.basis !== basis) throw new Error('daily bars were for another price basis');
        if (market === 'IN' && j.requestedExchange !== undefined && (j.requestedExchange || undefined) !== (exchange || undefined)) throw new Error('daily bars were for another exchange');
        cacheChart(cacheRef.current, url, j as any);
        return { daily: fromResponse(j), firstTradeT: j.firstTradeT ?? liveFirstTrade };
      });
    };
    const failed = (tfs: PatternTimeframe[], e: any) => {
      if (cancelled || ctrl.signal.aborted) return;   // a late answer for an older symbol / data revision never lands
      put(tfs.map((tf) => ({ key: keyOf(tf), hits: [], at: Date.now(), status: e?.unavailable ? 'unavailable' as const : 'error' as const, error: String(e?.message || e) })));
    };
    // a new symbol shows "looking…" at once: statusFor() reports 'loading' until a state for this key is set
    // the chart is still loading this symbol: wait for it (its daily answer may be the very data we need)
    if (!hasLive) return () => { cancelled = true; };
    const wantM = analysisTf === 'A' || analysisTf === 'M';
    const timer = setTimeout(() => {
      const readM = (src: Promise<{ daily: Bar[]; firstTradeT: number | null | undefined }>) => src
        .then(({ daily, firstTradeT }) => { if (!cancelled) put([analyseAs(keyOf('M'), daily, 'M', includeCurrent, firstTradeT, market)]); })
        .catch((e) => failed(['M'], e));
      // 10 years already on screen, or M wanted and the 5 years are not: one history for all three timeframes
      if (use10 || (wantM && !use5)) {
        load(plan10.url, use10).then(({ daily, firstTradeT }) => {
          if (cancelled) return;
          put((['D', 'W', 'M'] as PatternTimeframe[]).map((tf) => analyseAs(keyOf(tf), daily, tf, includeCurrent, firstTradeT, market)));
        }).catch((e) => failed(['D', 'W', 'M'], e));
        return;
      }
      load(plan5.url, use5).then(({ daily, firstTradeT }) => {
        if (cancelled) return;
        const dw = (['D', 'W'] as PatternTimeframe[]).map((tf) => analyseAs(keyOf(tf), daily, tf, includeCurrent, firstTradeT, market));
        put(dw);
        // D / W explicit: the monthly read is only a pointer when neither has a current structure
        const anyCurrent = dw.some((st) => st.status === 'ready' && patternView({ hits: st.hits, weak: st.weak, expired: st.expired, tf: st.key === keyOf('W') ? 'W' : 'D' }).state === 'qualifying');
        if (wantM || !anyCurrent) readM(load(plan10.url, false));
      }).catch((e) => failed(wantM ? ['D', 'W', 'M'] : ['D', 'W'], e));
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
    // barsRev + liveRev stand for `bars` / `live` (new objects on every load); the plan URLs for ticker / market / exchange / basis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, base, hasLive, use5, use10, plan5.url, plan10.url, barsRev, liveRev, cacheRef, market, ticker, exchange, basis, analysisTf, includeCurrent, keyOf]);

  // ── per-timeframe views (zzz1009 headline rules on each) and the timeframe that leads ──
  const own = on && states.base === base;
  const stateOf = useCallback((tf: PatternTimeframe): PatternState | null => (own ? states.byKey[keyOf(tf)] ?? null : null), [own, states, keyOf]);
  const views = useMemo(() => {
    const out: TfViews = {};
    if (!on) return out;
    // D / W explicit with a current structure: monthly is not read (no 10-year request just for a pointer)
    const mSkipped = (analysisTf === 'D' || analysisTf === 'W') && !stateOf('M') && (['D', 'W'] as PatternTimeframe[]).some((t) => {
      const st = stateOf(t);
      return !!st && st.status === 'ready' && patternView({ hits: st.hits, weak: st.weak, expired: st.expired, tf: t }).state === 'qualifying';
    });
    for (const tf of ANALYSIS_TFS) {
      const st = stateOf(tf);
      if (tf === 'M' && mSkipped) continue;
      // the main chart's own load state stands for the timeframe that leads (D in Auto); the others are pending until read
      const status = st ? st.status : tf === (analysisTf === 'A' ? 'D' : analysisTf) ? shownStatus(null, '', hasLive, chartLoad).status : 'loading';
      out[tf] = patternView({ hits: st?.hits || [], weak: st?.weak || [], expired: st?.expired || [], status: status === 'idle' ? 'loading' : status, tf });
    }
    return out;
  }, [on, stateOf, analysisTf, hasLive, chartLoad]);
  const errors = useMemo(() => {
    const e: Partial<Record<PatternTimeframe, string | undefined>> = {};
    for (const tf of ANALYSIS_TFS) { const st = stateOf(tf); e[tf] = st ? st.error : !hasLive && chartLoad && !chartLoad.loading && chartLoad.error ? chartLoad.error : undefined; }
    return e;
  }, [stateOf, hasLive, chartLoad]);
  const analysisTs = useMemo(() => {
    const t: Partial<Record<PatternTimeframe, number | null>> = {};
    for (const tf of ANALYSIS_TFS) t[tf] = stateOf(tf)?.periodEnd ?? null;
    return t;
  }, [stateOf]);
  const banner = useMemo(() => multiBanner(views, analysisTf, cur, { displayTf, analysisT: analysisTs, errors }), [views, analysisTf, cur, displayTf, analysisTs, errors]);
  const headTf: PatternTimeframe = analysisTf === 'A' ? banner.headTf : analysisTf;
  const headState = stateOf(headTf);
  const hits = useMemo(() => (on && headState ? headState.hits : []), [on, headState]);
  const status: PatternState['status'] = !on ? 'idle' : headState ? headState.status : shownStatus(null, '', hasLive, chartLoad).status;
  const error = !on ? undefined : headState ? headState.error : errors[headTf];
  const view = views[headTf] ?? patternView({ hits: [], status: 'idle' });
  const analysisT = analysisTs[headTf] ?? null;
  // every row the list can draw, by timeframe then in list order (a promoted recent breakout is drawn as its current reading)
  const rows = useMemo(() => uniqueByRow(ANALYSIS_TFS.flatMap((tf) => { const v = views[tf]; return v ? [...v.active, ...v.expired.map((x) => x.hit), ...v.weaker.map((x) => x.hit)] : []; })), [views]);
  const pickedIds = picked && picked.key === key ? picked.ids : null;
  // nothing picked yet → the headline structure (never an expired or weaker one by default). zzz1024 — an explicit timeframe with nothing
  // current: the other timeframe's structure the banner leads with (banner.leadHit) is drawn
  const lead = useMemo(() => (banner.leadHit ? [banner.leadHit] : views[headTf]?.state === 'qualifying' && (analysisTf === 'A' || headTf === analysisTf) ? views[headTf]!.active.slice(0, 1) : []), [banner.leadHit, views, headTf, analysisTf]);
  const chosen = useMemo(() => (pickedIds ? rows.filter((h) => pickedIds.has(rowKeyOf(h))) : lead), [rows, lead, pickedIds]);
  // zzz1029b (QA, AVAV monthly) — Clean: another timeframe's structure that would cover fewer than ~6 candles on screen is not drawn
  // (it stays ticked in the list and named in the chip with "Switch to …"); Research draws it
  const drawn = useMemo(() => {
    const times = bars.map((b) => b.t);
    const shown = displayTf === 'W' || displayTf === 'M' ? displayTf : 'D';
    return chosen.filter((h) => drawOtherTfStructure({ display, hitTf: h.timeframe ?? 'D', shownTf: shown, startT: h.startT, endT: h.endT, times }));
    // barsRev stands for `bars`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, display, displayTf, barsRev]);
  const squeezed = useMemo(() => chosen.filter((h) => !drawn.includes(h)), [chosen, drawn]);
  const togglePick = (rk: string) => {
    const next = new Set<string>(chosen.map(rowKeyOf));
    if (next.has(rk)) next.delete(rk); else next.add(rk);
    setPicked({ key, ids: next });
  };
  // zzz990 (CP-06) — lines of the drawn hits too short to draw on this timeframe (left out, not flattened); zzz1009 — and lines /
  // turning points older than the first candle on screen (a weekly / monthly pattern on a shorter chart)
  const lastBarT = bars.length ? bars[bars.length - 1].t : null;
  const fitOptsOf = useCallback((h: PatternHit) => ({ clip: true, extendPivotTo: (h.timeframe ?? 'D') !== 'D' ? lastBarT : null }), [lastBarT]);
  const { omittedLines, offLeft } = useMemo(() => {
    if (!on || !drawn.length || !bars.length) return { omittedLines: 0, offLeft: 0 };
    const times = bars.map((b) => b.t);
    let om = 0, off = 0;
    for (const h of drawn) { const f = overlayFit(h, times, undefined, fitOptsOf(h)); om += f.omitted; off += f.offLeft + pointMarks(h, bars).offLeft; }
    return { omittedLines: om, offLeft: off };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, drawn, barsRev, fitOptsOf]);

  // ── zzz1029 — Clean view: turning-point codes when a row is picked / hovered in the list or the mouse is on the drawn lines ──
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const [chartHover, setChartHover] = useState(false);
  const labelKeys = useMemo(() => drawn.filter((h) => patternLabelsShown({ display, picked: !!pickedIds, hoverRow, rowKey: rowKeyOf(h), chartHover })).map(rowKeyOf).join(','),
    [drawn, display, pickedIds, hoverRow, chartHover]);
  const watchHover = on && ready && display === 'clean' && !pickedIds && drawn.length > 0 && bars.length > 0;
  useEffect(() => {
    const chart = chartRef.current;
    if (!watchHover || !chart) { setChartHover(false); return; }
    const times = bars.map((b) => b.t);
    const idxOf = (t: number) => { let lo = 0, hi = times.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (times[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
    const paths = drawn.map((h) => pointMarks(h, bars).marks.slice().sort((x, y) => x.timestamp - y.timestamp));
    let raf = 0;
    const onMove = (d: any) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (typeof d?.x !== 'number' || typeof d?.y !== 'number' || d?.paneId !== 'candle_pane') { setChartHover(false); return; }
        let near = false;
        for (const marks of paths) {
          const pts: Array<{ x: number; y: number }> = [];
          for (const m of marks) {
            const k = idxOf(m.timestamp);
            if (k < 0) continue;
            try { const p = chart.convertToPixel({ dataIndex: k, value: m.value }, { paneId: 'candle_pane' }) as { x?: number; y?: number }; if (typeof p?.x === 'number' && typeof p?.y === 'number') pts.push({ x: p.x, y: p.y }); } catch { /* outside */ }
          }
          for (let i = 0; i < pts.length && !near; i++) {
            const a2 = pts[i], b2 = pts[i + 1] ?? pts[i];
            const dx = b2.x - a2.x, dy = b2.y - a2.y, len = dx * dx + dy * dy;
            const tt = len ? Math.max(0, Math.min(1, ((d.x - a2.x) * dx + (d.y - a2.y) * dy) / len)) : 0;
            if (Math.hypot(d.x - (a2.x + tt * dx), d.y - (a2.y + tt * dy)) <= 10) near = true;
          }
          if (near) break;
        }
        setChartHover((v) => (v === near ? v : near));
      });
    };
    try { chart.subscribeAction('onCrosshairChange', onMove); } catch { /* no hover */ }
    return () => { cancelAnimationFrame(raf); try { chart.unsubscribeAction('onCrosshairChange', onMove); } catch { /* disposed */ } };
    // barsRev stands for `bars`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchHover, chartRef, drawn, barsRev]);

  // ── draw the chosen pattern(s); its own overlay group, removed on symbol change / indicator off ──
  const shownTimesSig = barsRev;
  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    chart.removeOverlay({ groupId: PATTERN_GROUP });
    if (!on || !drawn.length || !bars.length) return;
    const times = bars.map((b) => b.t);
    const fmt = (n: number) => `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: priceDecimals(n), maximumFractionDigits: priceDecimals(n) })}`;
    const withLabels = new Set(labelKeys ? labelKeys.split(',') : []);
    for (const h of drawn) {
      const showCodes = withLabels.has(rowKeyOf(h));
      // zzz1009 — the actual turning points (moved to the real candle of the low / high on finer candles) and the path through them
      const { marks } = pointMarks(h, bars);
      const r = structureRange(h);
      const mid = r ? (r.lo + r.hi) / 2 : 0;
      // zzz1015 — each hit is mapped by ITS timeframe (a weekly / monthly pattern on daily candles: overlayFit clips + carries the pivot)
      // zzz1028 (QA, AVAV) — a structure from another timeframe than the analysis / candles on screen says its timeframe on its labels
      const htf = h.timeframe ?? 'D', shownTf = displayTf === 'W' || displayTf === 'M' ? displayTf : 'D';
      const tfTag = htf !== shownTf || (analysisTf !== 'A' && htf !== analysisTf) ? `${TF_TITLE[htf]} · ` : '';
      const lines = [...overlayFit(h, times, fmt, fitOptsOf(h)).lines.map((ln) => (tfTag && ln.label ? { ...ln, label: `${tfTag}${ln.label}` } : ln)), ...pointPath(marks, hitColor(h))];
      for (const ln of lines) {
        try {
          chart.createOverlay({ name: PATTERN_OVERLAY, groupId: PATTERN_GROUP, lock: true, points: ln.points, extendData: { color: ln.color, dashed: ln.dashed, size: ln.size, label: ln.label } });
        } catch { /* a line that cannot be placed is skipped */ }
      }
      for (const m of marks) {
        const below = m.value <= mid;   // a low's label goes under it, a high's above
        try {
          chart.createOverlay({ name: PATTERN_POINT, groupId: PATTERN_GROUP, lock: true, points: [{ timestamp: m.timestamp, value: m.value }], extendData: { color: m.color, role: m.role, below, hideLabel: !showCodes } });
        } catch { /* a point that cannot be placed is skipped */ }
      }
    }
    return () => { try { chart.removeOverlay({ groupId: PATTERN_GROUP }); } catch { /* chart already disposed */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, on, drawn, shownTimesSig, cur, chartRef, fitOptsOf, displayTf, analysisTf, labelKeys]);

  // ── "Fit pattern" / "Restore view" — the view before the first fit is kept until restored ──
  // keyed by the analysis identity: a saved view belongs to the symbol / timeframe it was taken on
  const savedView = useRef<{ key: string; space: number; right: number; atEnd: boolean } | null>(null);
  const [fittedKey, setFittedKey] = useState<string | null>(null);
  const fitted = fittedKey === key;
  const fit = useCallback((h: PatternHit) => {
    const chart = chartRef.current;
    if (!chart || !bars.length) return;
    try {
      const width = chart.getSize('candle_pane', 'main')?.width || 800;
      const times = bars.map((b) => b.t);
      const plan2 = fitPlan(times, h.startT, h.endT, width);
      if (!plan2) return;
      if (!savedView.current || savedView.current.key !== key) {
        const vr = chart.getVisibleRange();
        const n = chart.getDataList().length;
        savedView.current = { key, space: chart.getBarSpace().bar, right: Math.max(0, Math.min(n - 1, Math.ceil(vr.realTo) - 1)), atEnd: vr.realTo >= n };
      }
      chart.setBarSpace(plan2.space);
      chart.scrollToRealTime();
      if (plan2.rightIndex < times.length - 1) chart.scrollToDataIndex(plan2.rightIndex);
      setFittedKey(key);
    } catch { /* the chart is not ready: nothing to fit */ }
  }, [chartRef, bars, key]);
  const restoreView = useCallback(() => {
    const chart = chartRef.current, v = savedView.current;
    savedView.current = null;
    setFittedKey(null);
    if (!chart || !v || v.key !== key) return;
    try {
      chart.setBarSpace(v.space);
      chart.scrollToRealTime();
      if (!v.atEnd) chart.scrollToDataIndex(v.right);
    } catch { /* chart disposed */ }
  }, [chartRef, key]);

  // zzz1008 — the handed-off pattern: selected (drawn) and fitted once, when its analysis on the hand-off timeframe is ready
  const handoffDone = useRef(false);
  useEffect(() => {
    if (!handoff?.pat || handoffDone.current || !on || !ready || !bars.length || analysisTf !== handoff.atf) return;
    const st = stateOf(handoff.atf);
    if (!st || st.status !== 'ready') return;
    const h = st.hits.find((x) => x.id === handoff.pat) || rows.find((x) => x.id === handoff.pat && (x.timeframe ?? 'D') === handoff.atf);
    handoffDone.current = true;
    if (!h) return;
    const span = handoffSpan(h, handoff);
    const timer = setTimeout(() => { setPicked({ key, ids: new Set([rowKeyOf(h)]) }); fit({ ...h, ...span }); }, 60);
    return () => clearTimeout(timer);
  }, [handoff, on, ready, bars.length, analysisTf, rows, stateOf, key, fit]);

  const setAnalysisTf = useCallback((tf: PatternAnalysisTf) => savePref({ tf, provisional: tf === 'D' ? false : pref.provisional }), [savePref, pref.provisional]);
  const setIncludeCurrent = useCallback((v: boolean) => savePref({ tf: pref.tf, provisional: pref.tf !== 'D' && v }), [savePref, pref.tf]);
  const provisional = on && headState ? !!headState.provisional : false;

  return {
    on, hits, status, error, drawnIds: new Set(chosen.map(rowKeyOf)), togglePick, omittedLines,
    analysisTf, includeCurrent, provisional, setAnalysisTf, setIncludeCurrent, fit, restoreView, fitted,
    view, analysisT, offLeft, views, headTf, banner,
    // zzz1029 — the row hovered in the list (Clean shows its turning-point codes); pivots of the drawn structures (other right-edge
    // tags keep clear of their labels); the display preset
    squeezed: squeezed.map((h) => ({ label: h.label, tf: (h.timeframe ?? 'D') as PatternTimeframe })), setHoverRow, display, pivots: on ? drawn.map((h) => h.pivot).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [],
  };
}
const uniqueByRow = (hs: PatternHit[]) => { const seen = new Set<string>(); return hs.filter((h) => { const k = rowKeyOf(h); return seen.has(k) ? false : (seen.add(k), true); }); };

const fmtMoney = (n: number | null, cur: string) => (n == null ? '—' : `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: priceDecimals(n), maximumFractionDigits: priceDecimals(n) })}`);

type PatternP = ReturnType<typeof usePatternIndicator>;
type AnalysisFields = 'analysisTf' | 'includeCurrent' | 'provisional' | 'setAnalysisTf' | 'setIncludeCurrent' | 'fit' | 'restoreView' | 'fitted' | 'view' | 'analysisT' | 'offLeft' | 'views' | 'headTf' | 'banner' | 'setHoverRow' | 'display' | 'pivots' | 'squeezed';
/** The hook's result; the zzz992 analysis-timeframe fields are optional (absent = daily analysis, no controls). */
export type PatternBannerP = Omit<PatternP, AnalysisFields | 'drawnIds' | 'togglePick'> & Partial<Pick<PatternP, AnalysisFields>> & {
  /** row keys (rowKeyOf: "<tf>:<pattern id>") of the drawn structures; a bare pattern id stands for its daily row */
  drawnIds: ReadonlySet<string>; togglePick: (rowKey: string) => void;
};
const TF_BADGE: Record<PatternTimeframe, string> = { D: 'Daily pattern', W: 'Weekly pattern', M: 'Monthly pattern' };
const MODE_TITLE: Record<PatternAnalysisTf, string> = { A: 'Auto — daily, weekly and monthly; the most relevant current structure leads', D: 'Find patterns on daily bars', W: 'Find patterns on weekly bars', M: 'Find patterns on monthly bars' };

export function PatternBanner({ p, cur, light, onTurnOff, tf, dock }: { p: PatternBannerP; cur: string; light: boolean; onTurnOff: () => void; /** timeframe on screen: a "Daily pattern" badge on W / M */ tf?: string; /** zzz1029 — a chip in the overlay summary row: the controls move into its details */ dock?: OverlayDock }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showWeak, setShowWeak] = useState(false);
  const [rulesOf, setRulesOf] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mode: PatternAnalysisTf = p.analysisTf ?? 'D';
  // zzz1015 — the timeframe the banner leads with (Auto: the most relevant one)
  const atf: PatternTimeframe = p.headTf ?? (mode === 'A' ? 'D' : mode);
  // zzz1009 — the headline view (current / expired / weaker); computed here when the caller passes only the hits
  const view: PatternView = p.view ?? patternView({ hits: p.hits, status: p.status, tf: atf });
  // zzz1015 — the list grouped by timeframe (D / W / M); a caller with one view gets one group
  const views: TfViews = p.views ?? { [atf]: view };
  const groups = ANALYSIS_TFS.filter((t) => views[t]);
  const countOf = (v: PatternView) => v.active.length + v.expired.length + v.weaker.length;
  const listed = groups.reduce((n, t) => n + countOf(views[t]!), 0);
  const weakTotal = groups.reduce((n, t) => n + views[t]!.weaker.length, 0);
  const show = dock ? p.on && dock.open : p.on && (open || pinned) && listed > 0;
  // zzz990 (CP-09) — Escape and a click outside dismiss the list (pinned or not)
  useEffect(() => {
    if (!show) return;
    const close = () => { setPinned(false); setOpen(false); dock?.setOpen(false); p.setHoverRow?.(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent | TouchEvent) => { const t = e.target as Node | null; if (boxRef.current && t && !boxRef.current.contains(t)) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
    // p.setHoverRow is a stable state setter; `dock` changes only when the open chip changes (memoized by the summary row)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, dock]);
  if (!p.on) return null;
  const banner: Pick<MultiBanner, 'text' | 'tone' | 'weakerHint' | 'own' | 'other'> = p.banner ?? { ...viewBanner(view, cur, atf, { error: p.error, analysisT: p.analysisT }), weakerHint: view.state === 'weaker-only' ? view.weaker.length : 0 };
  const col = bannerColors(banner.tone, light);
  // a badge whenever the analysis timeframe differs from the candles on screen (always on W / M analysis)
  const notDaily = atf === 'D' && !!tf && tf !== 'D';
  const tfBadge = atf !== 'D';
  const na = mode === 'A' ? [] : PATTERN_IDS.filter((id) => !patternApplies(id, atf));
  const tfBtn = (x: PatternAnalysisTf) => (
    <button key={x} type="button" onClick={() => p.setAnalysisTf?.(x)} aria-pressed={mode === x} title={MODE_TITLE[x]} data-testid={`pattern-tf-${x}`}
      style={{ background: mode === x ? col.border : 'none', border: `1px solid ${col.border}`, borderRadius: 4, color: col.text, cursor: 'pointer', padding: '0 5px', fontSize: 10.5, fontWeight: 700, lineHeight: '15px' }}>{x === 'A' ? 'Auto' : x}</button>
  );
  const small = { background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-1)', borderRadius: 6, color: 'var(--mc-text-2)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: '1px 8px', whiteSpace: 'nowrap' as const };
  const headKey = views[atf]?.state === 'qualifying' ? rowKeyOf(views[atf]!.active[0]) : null;
  const row = (h: PatternHit, kind: 'current' | 'expired' | 'weaker', why?: string, lead?: boolean) => {
    const c = kind === 'current' ? hitColor(h) : NONE_ROW;
    const failed = h.stage === 'failed';
    const textC = kind !== 'current' ? 'var(--mc-text-2)' : failed ? (light ? '#9A5B00' : FAILED_COLOR) : light ? (h.bias === 'bullish' ? '#05705E' : '#C8102E') : (h.bias === 'bullish' ? '#22C3A6' : '#FF6B78');
    const hk = rowKeyOf(h);
    const rk = `${kind}:${hk}`;
    const rules = rulesOf === rk;
    const ev = evidenceWords(h), pw = pointWords(h, cur);
    const drawnNow = p.drawnIds.has(hk) || ((h.timeframe ?? 'D') === 'D' && p.drawnIds.has(h.id));
    return (
      <div key={rk} data-testid={`pattern-row-${kind}`} onMouseEnter={() => p.setHoverRow?.(hk)} onMouseLeave={() => p.setHoverRow?.(null)} style={{ padding: '6px 4px', borderBottom: '1px solid var(--mc-border-3)', opacity: kind === 'current' ? 1 : 0.85 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexWrap: 'wrap' }}>
          <input type="checkbox" checked={drawnNow} onChange={() => p.togglePick(hk)} aria-label={`Draw ${h.label} (${TF_WORD[h.timeframe ?? 'D']}) on the chart`} />
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
          <b style={{ color: 'var(--mc-text-0)' }}>{h.label}</b>
          {lead && <span style={{ fontSize: 10, fontWeight: 700, padding: '0 4px', borderRadius: 3, border: '1px solid var(--mc-border-1)', color: 'var(--mc-text-2)' }}>headline</span>}
          <span style={{ color: textC, fontWeight: 600 }}>{h.bias}{failed ? ' · failed' : ''}</span>
          <span style={{ color: 'var(--mc-text-3)' }}>· {stageWords(h)} · {h.likelihood} · {shapeScoreWords(h)}</span>
          {p.fit && (
            <button type="button" onClick={(e) => { e.preventDefault(); p.fit?.(h); }} title={`Zoom the chart to this ${h.label.toLowerCase()}`}
              style={{ ...small, marginLeft: 'auto' }}>Fit pattern</button>
          )}
        </label>
        <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-2)', fontVariantNumeric: 'tabular-nums' }}>
          {h.bias === 'bullish' ? 'Pivot' : 'Breakdown'} {fmtMoney(h.pivot, cur)} · close {distWords(h)} · {lengthWords(h.lengthBars, h.timeframe)}{h.depthPct != null ? ` · ${h.depthPct}% deep` : ''}{h.volumeOk === false ? ' · volume not confirmed' : ''}
        </div>
        {why && <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-2)', fontStyle: 'italic' }}>{why}</div>}
        <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-3)' }}>{h.note}</div>
        <div style={{ paddingLeft: 22, marginTop: 2, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>{PATTERN_META[h.id].short}</div>
        {(ev.length > 0 || pw.length > 0) && (
          <div style={{ paddingLeft: 22, marginTop: 2 }}>
            <button type="button" onClick={(e) => { e.preventDefault(); setRulesOf(rules ? null : rk); }} aria-expanded={rules} style={small}>{rules ? 'Hide measured rules' : 'Measured rules ▸'}</button>
            {rules && (
              <div data-testid="pattern-rules" style={{ marginTop: 4, color: 'var(--mc-text-2)', fontSize: 11, lineHeight: '16px' }}>
                <div>{conditionWords(h, cur)} · {shapeScoreWords(h)}</div>
                {pw.length > 0 && <div>Turning points: {pw.join(' · ')}</div>}
                {ev.length > 0 && <div>Measured: {ev.join(' · ')}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
  const heading = (t: string) => <div style={{ marginTop: 10, marginBottom: 2, fontSize: 11.5, fontWeight: 650, color: 'var(--mc-text-3)' }}>{t}</div>;
  const stateWords = (t: PatternTimeframe, v: PatternView) => v.state === 'pending' ? `Reading the ${TF_WORD[t]} bars…`
    : v.state === 'insufficient' ? `Too little history for ${TF_WORD[t]} patterns (at least ${PATTERN_MIN_HISTORY[t]} ${TF_WORD[t]} bars).`
      : v.state === 'missing' ? 'No price data.' : v.state === 'error' ? `Could not be read.` : `No qualifying ${TF_WORD[t]} pattern on the latest bars.`;
  const group = (t: PatternTimeframe) => {
    const v = views[t]!;
    const counts = [`${v.active.length} current`, ...(v.expired.length ? [`${v.expired.length} expired`] : []), ...(v.weaker.length ? [`${v.weaker.length} weaker`] : [])].join(' · ');
    return (
      <div key={t} data-testid={`pattern-group-${t}`} style={{ marginTop: 6 }}>
        <div style={{ marginTop: 8, padding: '3px 6px', borderRadius: 6, background: 'var(--mc-bg-2, rgba(120,123,134,.08))', fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)', display: 'flex', gap: 8 }}>
          <span>{TF_TITLE[t]}</span><span style={{ fontWeight: 500, color: 'var(--mc-text-3)' }}>{counts}</span>
        </div>
        {v.active.length > 0 ? (
          <>{heading('Current')}{v.active.map((h) => row(h, 'current', undefined, rowKeyOf(h) === headKey))}</>
        ) : (
          <div style={{ marginTop: 4, color: 'var(--mc-text-2)' }}>{stateWords(t, v)}</div>
        )}
        {v.expired.length > 0 && <>{heading('Expired / invalidated')}{v.expired.map((x: PatternViewRow) => row(x.hit, 'expired', x.why))}</>}
        {showWeak && v.weaker.length > 0 && <>{heading('Weaker candidates — not qualifying')}{v.weaker.map((x: PatternViewRow) => row(x.hit, 'weaker', x.why))}</>}
      </div>
    );
  };
  const openWeaker = () => { setShowWeak(true); if (dock) dock.setOpen(true); else setPinned(true); };
  const closeList = () => { setPinned(false); setOpen(false); dock?.setOpen(false); p.setHoverRow?.(null); };
  // zzz1029 — docked in the overlay summary row: the pill is the chip (status + ×); its controls open with the list
  const controls = (
    <>
      {p.setAnalysisTf && (
        <span role="group" aria-label="Pattern analysis timeframe" title="Analysis timeframe — follows the candles on screen (switch the chart to D, W or M and the patterns are read on that timeframe). Auto reads daily, weekly and monthly together; a pick here lasts until the chart timeframe changes."
          style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 6, fontSize: 10, whiteSpace: 'nowrap' }}>
          <span style={{ opacity: 0.8 }}>Analysis</span>{(['A', 'D', 'W', 'M'] as PatternAnalysisTf[]).map(tfBtn)}
        </span>
      )}
      {notDaily && (
        <span title="This pattern is found on the DAILY bars and drawn on the candles on screen" data-testid="daily-pattern-badge"
          style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4, border: `1px solid ${col.border}`, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>Daily pattern</span>
      )}
      {tfBadge && (
        <span title={`This pattern is found on ${TF_WORD[atf]} bars aggregated from the daily history (${p.includeCurrent ? 'the current period included, provisional' : 'completed periods only'}) and drawn on the candles on screen`} data-testid="tf-pattern-badge"
          style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4, border: `1px solid ${col.border}`, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{views[atf]?.state === 'qualifying' ? TF_BADGE[atf] : `${TF_TITLE[atf]} analysis`}{p.provisional ? ' · provisional' : ''}</span>
      )}
      {(tfBadge || mode === 'A') && p.setIncludeCurrent && (
        <label title={mode === 'A' ? 'Weekly / monthly reads: include the current, unfinished week / month — its candle can still change (provisional)' : `Include the current, unfinished ${atf === 'W' ? 'week' : 'month'} — its candle can still change (provisional)`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 4, fontSize: 10, whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!p.includeCurrent} onChange={(e) => p.setIncludeCurrent?.(e.target.checked)} style={{ margin: 0, width: 11, height: 11 }} aria-label="Include the current period (provisional)" />
          current
        </label>
      )}
      {p.fitted && p.restoreView && (
        <button type="button" onClick={() => p.restoreView?.()} title="Back to the view before Fit pattern"
          style={{ marginLeft: 4, background: 'none', border: `1px solid ${col.border}`, borderRadius: 3, color: col.text, cursor: 'pointer', padding: '0 4px', fontSize: 10, whiteSpace: 'nowrap' }}>Restore view</button>
      )}
    </>
  );
  const switchBtn = (
    <>
      {banner.other && p.setAnalysisTf && (
        <button type="button" onClick={() => p.setAnalysisTf?.(banner.other!.tf)} data-testid="pattern-switch-tf" title={`Read the patterns on ${TF_WORD[banner.other.tf]} bars (or pick Auto to let the most relevant timeframe lead)`}
          style={{ background: 'none', border: `1px solid ${col.border}`, borderRadius: 4, color: col.text, cursor: 'pointer', padding: '0 5px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>Switch to {TF_WORD[banner.other.tf]}</button>
      )}
    </>
  );
  const afterMain = (
    <>
      {switchBtn}
      {banner.weakerHint > 0 && (
        <button type="button" onClick={openWeaker} data-testid="pattern-show-weaker" title="Open the list with the weaker (sub-threshold) candidates shown"
          style={{ background: 'none', border: `1px solid ${col.border}`, borderRadius: 4, color: col.text, cursor: 'pointer', padding: '0 5px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>show weaker</button>
      )}
    </>
  );
  return (
    <div ref={boxRef} onMouseLeave={() => { if (!pinned && !dock) setOpen(false); }}
      style={dock ? DOCK_BOX : { position: 'absolute', left: 8, top: 4, zIndex: 7, maxWidth: 'calc(100% - 100px)', fontSize: 12 }}>
      {/* zzz1013 — the Pine look: an 8 px pill on the page colour with the tone as a tint and a hairline, a soft lift off the candles */}
      <div data-testid="pattern-banner" style={{ ...(dock ? DOCK_PILL : null), display: 'flex', alignItems: 'center', gap: 4, minHeight: 24, borderRadius: 8, border: `1px solid ${col.border}`, background: `linear-gradient(${col.bg}, ${col.bg}), var(--mc-bg-0)`, color: col.text, lineHeight: '18px', boxShadow: '0 1px 0 rgba(18,23,34,.04), 0 6px 16px -10px rgba(18,23,34,.35)' }}>
        {!dock && controls}
        <button type="button" onMouseEnter={dock ? undefined : () => setOpen(true)} onClick={() => (dock ? dock.setOpen(!dock.open) : setPinned((v) => !v))} aria-expanded={show} data-state={view.state}
          onKeyDown={(e) => { if (e.key === 'Escape') closeList(); }}
          title={`${banner.text.replace(/^📐 /, '')}\n\n` + (listed ? `Chart patterns${mode === 'A' ? ' on daily, weekly and monthly bars' : ` on the ${TF_WORD[atf]} bars`} — click to keep the list open; tick a row to draw it. Esc closes the list.` : `Automate chart patterns (${mode === 'A' ? 'Auto' : `${TF_WORD[atf]} bars`})`)}
          style={{ background: 'none', border: 'none', color: col.text, cursor: listed || dock ? 'pointer' : 'default', padding: !dock && (notDaily || tfBadge || p.setAnalysisTf) ? '1px 4px 1px 2px' : '1px 4px 1px 8px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, textAlign: 'left' }}>
          {dock ? overlayChipText('patterns', banner.text) : banner.other && banner.own ? (
            // zzz1028 (QA, AVAV) — the chosen timeframe's state, then the OTHER timeframe's structure with its timeframe as a chip
            <>📐 {banner.own}{OTHER_TF_SEP}<span data-testid="pattern-other-tf" data-tf={banner.other.tf} title={`Found on ${TF_WORD[banner.other.tf]} bars, not on the ${TF_WORD[atf]} analysis you chose`}
              style={{ padding: '0 4px', borderRadius: 3, border: `1px dashed ${col.border}`, fontSize: 10.5, fontWeight: 700 }}>{TF_TITLE[banner.other.tf]}</span>
              <span style={{ fontWeight: 500, opacity: 0.85 }}>: {banner.other.words}</span></>
          ) : banner.text}{listed > 0 || dock ? (show ? ' ▴' : ' ▾') : ''}
        </button>
        {!dock && afterMain}
        {/* zzz1029b — docked: another timeframe's structure keeps its "Switch to …" on the chip */}
        {dock && !show && switchBtn}
        <button type="button" onClick={onTurnOff} aria-label="Turn off Automate chart patterns" title="Turn off Automate chart patterns (Indicators ▾ turns it back on)"
          style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '0 6px', fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
      {show && (
        <div role="dialog" aria-label="Chart patterns found"
          style={{ marginTop: 6, width: 'min(560px, calc(100vw - 80px))', maxHeight: 420, overflowY: 'auto', padding: '8px 10px 10px', borderRadius: 12, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', boxShadow: 'var(--ct-shadow, 0 8px 24px rgba(0,0,0,.18))', ...(dock ? DOCK_PANEL : null) }}>
          {dock && (
            <div data-testid="pattern-controls" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, padding: '4px 6px', marginBottom: 6, borderRadius: 8, border: `1px solid ${col.border}`, background: `linear-gradient(${col.bg}, ${col.bg}), var(--mc-bg-0)`, color: col.text, fontSize: 12 }}>
              <span data-testid="pattern-headline" style={{ flex: '1 1 100%', fontWeight: 600, padding: '0 2px 2px' }}>{banner.text}</span>
              {controls}{afterMain}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            {weakTotal > 0 && (
              <button type="button" onClick={() => setShowWeak((v) => !v)} aria-expanded={showWeak} style={small}>
                {showWeak ? 'Hide weaker candidates' : `Show weaker candidates (${weakTotal})`}
              </button>
            )}
            {p.fitted && p.restoreView && <button type="button" onClick={() => p.restoreView?.()} style={small}>Restore view</button>}
            <button type="button" onClick={closeList} aria-label="Close the pattern list" style={small}>Close list</button>
          </div>
          {groups.map(group)}
          {p.omittedLines > 0 && (
            <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-warn, #D97706)' }}>
              {p.omittedLines} sloping line{p.omittedLines === 1 ? ' is' : 's are'} shorter than one candle on this timeframe and {p.omittedLines === 1 ? 'is' : 'are'} not drawn — switch to D to see the lines.
            </div>
          )}
          {(p.squeezed?.length ?? 0) > 0 && (
            <div data-testid="pattern-squeezed" style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-warn, #D97706)' }}>
              Not drawn in Clean view: {p.squeezed!.map((x) => `${x.label} (${TF_WORD[x.tf]})`).join(', ')} would cover fewer than {CLEAN_MIN_SPAN_CANDLES} candles on this chart — switch the chart to {TF_WORD[p.squeezed![0].tf]} or pick Research to see it drawn.
            </div>
          )}
          {(p.offLeft ?? 0) > 0 && (
            <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-warn, #D97706)' }}>
              Part of the drawn pattern ({p.offLeft} line{p.offLeft === 1 ? '' : 's'} / point{p.offLeft === 1 ? '' : 's'}) is older than the first candle on screen — choose a longer range (5Y / 10Y) to see all of it.
            </div>
          )}
          <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-text-3)' }}>
            {mode === 'A' ? `Auto: read on daily bars (the last ~2.8 years), weekly bars (~5 years) and monthly bars (up to 10 years${p.includeCurrent ? ', the current week / month included — provisional' : ', completed periods only'}); the headline is the most relevant current structure across them, the timeframe on screen winning a tie.`
              : atf === 'D' ? 'Found on the daily bars (the last ~2.8 years), whatever timeframe is on screen.'
                : `Found on ${TF_WORD[atf]} bars built from the daily history (${atf === 'W' ? 'the last ~5 years' : 'up to 10 years'}; ${p.provisional ? 'the last candle is the current, unfinished period — provisional' : 'completed periods only'}), whatever timeframe is on screen.`}
            {mode !== 'A' && groups.length > 1 && ` Other timeframes are listed for reference; Auto lets the most relevant one lead.`}
            {na.length > 0 && ` Not read on ${TF_WORD[atf]} bars (too short to be seen on these candles): ${na.map((id) => PATTERN_META[id].label.toLowerCase()).join(', ')}.`}
            {' '}The headline is the strongest current structure: forming near its level or a recent breakout holding first, then breakouts back below the level; a failed structure only while its break is recent and the price is still near the level. Expired ones (older failures, completed breakouts) and weaker candidates are listed apart. The shape score is how closely the bars fit the pattern&apos;s rules — a heuristic, not a probability. Ticked rows are drawn on the chart with their turning points; they are not saved as drawings. A reading of the shape, not a signal — check it on the chart.
          </div>
        </div>
      )}
    </div>
  );
}
const NONE_ROW = '#787B86';
