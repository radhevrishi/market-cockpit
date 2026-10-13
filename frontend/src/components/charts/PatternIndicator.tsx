'use client';
// zzz982 — "Automate chart patterns" for /charts: the hook that runs lib/chart-patterns on the DAILY bars of the symbol on
// screen (and draws the chosen pattern's lines), and the one-line status banner at the top of the chart with its dropdown.
// Runs only while the indicator is in the working layout (Indicators ▾ → Automate chart patterns).
// zzz992 — Analysis D / W / M (separate from the candles on screen): weekly / monthly aggregate the daily history already
// fetched (completed periods only unless "incl. current" is ticked — then the last candle is provisional). The choice is
// remembered per viewer (PATTERN_TF_KEY), never in the saved drawings. "Fit" zooms the chart to a pattern; "Restore view"
// goes back to the view before the first fit.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import { analyzeDailyAs, analyzePatterns, PATTERN_META, PATTERN_IDS, patternApplies, type PatternHit, type PatternId, type PatternTimeframe } from '@/lib/chart-patterns';
import { cacheChart, freshChart, type CachedChart } from '@/lib/chart-refresh';
import type { Bar } from '@/lib/chart-math';
import {
  EMPTY_PATTERNS, FAILED_COLOR, PATTERN_GROUP, PATTERN_OVERLAY, PATTERN_TF_KEY, TF_WORD, analysisKey, bannerColors, bannerOf, barsRevision, distWords, fitPlan, hitColor, hitsFor, hitsToDraw, lengthWords,
  overlayFit, parsePatternTfPref, patternDataPlan, patternKey, priceDecimals, serializePatternTfPref, shapeScoreWords, shownStatus, stageWords, togglePicked, handoffSpan, type PatternState, type PatternTfPref, type PatternHandoff,
  patternView, viewBanner, conditionWords, evidenceWords, pointWords, pointMarks, pointPath, structureRange, PATTERN_POINT, type PatternView, type PatternViewRow,
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
  /** zzz1008 — the Pine Screener's hand-off (?atf / pat / pf / pt): analysis timeframe for this visit, the pattern to select and fit */
  handoff?: PatternHandoff | null;
}

export function usePatternIndicator(a: PatternIndicatorArgs) {
  const { on, ready, ticker, market, exchange, basis, live, bars, chartRef, cacheRef, cur, chart: chartLoad } = a;
  // zzz992 — the analysis timeframe (per viewer); hits are keyed by symbol + timeframe so a weekly result never shows as daily
  const handoff = a.handoff || null;
  // zzz1008 — a hand-off's analysis timeframe wins for this visit (the remembered choice is not overwritten)
  const [pref, setPref] = useState<PatternTfPref>(() => {
    if (handoff) return { tf: handoff.atf, provisional: false };
    try { return parsePatternTfPref(localStorage.getItem(PATTERN_TF_KEY)); } catch { return parsePatternTfPref(null); }
  });
  const savePref = useCallback((next: PatternTfPref) => { setPref(next); try { localStorage.setItem(PATTERN_TF_KEY, serializePatternTfPref(next)); } catch { /* this visit only */ } }, []);
  const analysisTf = pref.tf, includeCurrent = pref.provisional;
  const key = analysisKey(patternKey(market, ticker, exchange, basis), analysisTf, includeCurrent);
  const [state, setState] = useState<PatternState>(EMPTY_PATTERNS);
  const [picked, setPicked] = useState<{ key: string; ids: Set<PatternId> } | null>(null);
  const plan = patternDataPlan(live, ticker, market, exchange, basis, analysisTf);
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
        const ft = firstTradeT != null && Number.isFinite(firstTradeT) ? { firstTradeT } : undefined;
        // zzz1009 — `weak: true` also returns the weaker candidates and the expired structures (the qualifying hits are unchanged)
        if (analysisTf === 'D') {
          const r = analyzePatterns(daily, { ...ft, weak: true });
          const lastT = daily.length ? daily[daily.length - 1].t : null;
          if (r.tooShort) setState({ key, hits: [], at: Date.now(), status: 'short', error: `Too little history (${r.usableBars} usable bar${r.usableBars === 1 ? '' : 's'})` });
          else setState({ key, hits: r.hits, weak: r.weak, expired: r.expired, at: Date.now(), status: 'ready', periodEnd: lastT });
        } else {
          // weekly / monthly: aggregated from the daily history (completed periods unless the current one is included)
          const r = analyzeDailyAs(daily, analysisTf, { ...ft, completedOnly: !includeCurrent, weak: true });
          const w = TF_WORD[analysisTf];
          if (r.tooShort) setState({ key, hits: [], at: Date.now(), status: 'short', error: `Too little history (${r.usableBars} ${w} bar${r.usableBars === 1 ? '' : 's'})` });
          else setState({ key, hits: r.hits, weak: r.weak, expired: r.expired, at: Date.now(), status: 'ready', provisional: r.provisional, periodEnd: r.periodEnd });
        }
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
  }, [on, key, hasLive, useShown, plan.url, barsRev, liveRev, cacheRef, market, ticker, exchange, basis, analysisTf, includeCurrent]);

  const hits = useMemo(() => (on ? hitsFor(state, key) : []), [on, state, key]);
  const shown = on ? shownStatus(state, key, hasLive, chartLoad) : { status: 'idle' as const, error: undefined };
  const own = on && state.key === key;
  const weak = useMemo(() => (own ? state.weak || [] : []), [own, state]);
  const expired = useMemo(() => (own ? state.expired || [] : []), [own, state]);
  // zzz1009 — the headline view: current structures (headline first), expired / invalidated, weaker candidates
  const view = useMemo(() => patternView({ hits, weak, expired, status: shown.status, tf: analysisTf }), [hits, weak, expired, shown.status, analysisTf]);
  const analysisT = own ? state.periodEnd ?? null : null;
  // every row the list can draw, in list order (a promoted recent breakout is drawn as its current reading)
  const rows = useMemo(() => uniqueById([...view.active, ...view.expired.map((x) => x.hit), ...view.weaker.map((x) => x.hit)]), [view]);
  const pickedIds = picked && picked.key === key ? picked.ids : null;
  // nothing picked yet → the headline structure (never an expired or weaker one by default)
  const drawn = useMemo(() => (pickedIds ? rows.filter((h) => pickedIds.has(h.id)) : hitsToDraw(view.active, null)), [rows, view.active, pickedIds]);
  const togglePick = (id: PatternId) => setPicked({ key, ids: togglePicked(view.active, pickedIds, id) });
  // zzz990 (CP-06) — lines of the drawn hits too short to draw on this timeframe (left out, not flattened); zzz1009 — and lines /
  // turning points older than the first candle on screen (a weekly / monthly pattern on a shorter chart)
  const fitOpts = useMemo(() => ({ clip: true, extendPivotTo: analysisTf !== 'D' && bars.length ? bars[bars.length - 1].t : null }), [analysisTf, bars]);
  const { omittedLines, offLeft } = useMemo(() => {
    if (!on || !drawn.length || !bars.length) return { omittedLines: 0, offLeft: 0 };
    const times = bars.map((b) => b.t);
    let om = 0, off = 0;
    for (const h of drawn) { const f = overlayFit(h, times, undefined, fitOpts); om += f.omitted; off += f.offLeft + pointMarks(h, bars).offLeft; }
    return { omittedLines: om, offLeft: off };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, drawn, barsRev, fitOpts]);

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
      // zzz1009 — the actual turning points (moved to the real candle of the low / high on finer candles) and the path through them
      const { marks } = pointMarks(h, bars);
      const r = structureRange(h);
      const mid = r ? (r.lo + r.hi) / 2 : 0;
      const lines = [...overlayFit(h, times, fmt, fitOpts).lines, ...pointPath(marks, hitColor(h))];
      for (const ln of lines) {
        try {
          chart.createOverlay({ name: PATTERN_OVERLAY, groupId: PATTERN_GROUP, lock: true, points: ln.points, extendData: { color: ln.color, dashed: ln.dashed, size: ln.size, label: ln.label } });
        } catch { /* a line that cannot be placed is skipped */ }
      }
      for (const m of marks) {
        const below = m.value <= mid;   // a low's label goes under it, a high's above
        try {
          chart.createOverlay({ name: PATTERN_POINT, groupId: PATTERN_GROUP, lock: true, points: [{ timestamp: m.timestamp, value: m.value }], extendData: { color: m.color, role: m.role, below } });
        } catch { /* a point that cannot be placed is skipped */ }
      }
    }
    return () => { try { chart.removeOverlay({ groupId: PATTERN_GROUP }); } catch { /* chart already disposed */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, on, drawn, shownTimesSig, cur, chartRef, fitOpts]);

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
    const h = hits.find((x) => x.id === handoff.pat) || rows.find((x) => x.id === handoff.pat);
    if (state.key !== key || state.status !== 'ready') return;
    handoffDone.current = true;
    if (!h) return;
    const span = handoffSpan(h, handoff);
    const timer = setTimeout(() => { setPicked({ key, ids: new Set([h.id]) }); fit({ ...h, ...span }); }, 60);
    return () => clearTimeout(timer);
  }, [handoff, on, ready, bars.length, analysisTf, hits, rows, state.key, state.status, key, fit]);

  const setAnalysisTf = useCallback((tf: PatternTimeframe) => savePref({ tf, provisional: tf === 'D' ? false : pref.provisional }), [savePref, pref.provisional]);
  const setIncludeCurrent = useCallback((v: boolean) => savePref({ tf: pref.tf, provisional: pref.tf !== 'D' && v }), [savePref, pref.tf]);
  const provisional = on && state.key === key ? !!state.provisional : false;

  return {
    on, hits, status: shown.status, error: shown.error, drawnIds: new Set(drawn.map((h) => h.id)), togglePick, omittedLines,
    analysisTf, includeCurrent, provisional, setAnalysisTf, setIncludeCurrent, fit, restoreView, fitted,
    view, analysisT, offLeft,
  };
}
const uniqueById = (hs: PatternHit[]) => { const seen = new Set<PatternId>(); return hs.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true))); };

const fmtMoney = (n: number | null, cur: string) => (n == null ? '—' : `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: priceDecimals(n), maximumFractionDigits: priceDecimals(n) })}`);

type PatternP = ReturnType<typeof usePatternIndicator>;
type AnalysisFields = 'analysisTf' | 'includeCurrent' | 'provisional' | 'setAnalysisTf' | 'setIncludeCurrent' | 'fit' | 'restoreView' | 'fitted' | 'view' | 'analysisT' | 'offLeft';
/** The hook's result; the zzz992 analysis-timeframe fields are optional (absent = daily analysis, no controls). */
export type PatternBannerP = Omit<PatternP, AnalysisFields> & Partial<Pick<PatternP, AnalysisFields>>;
const TF_BADGE: Record<PatternTimeframe, string> = { D: 'Daily pattern', W: 'Weekly pattern', M: 'Monthly pattern' };

export function PatternBanner({ p, cur, light, onTurnOff, tf }: { p: PatternBannerP; cur: string; light: boolean; onTurnOff: () => void; /** timeframe on screen: a "Daily pattern" badge on W / M */ tf?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showWeak, setShowWeak] = useState(false);
  const [rulesOf, setRulesOf] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const atf: PatternTimeframe = p.analysisTf ?? 'D';
  // zzz1009 — the headline view (current / expired / weaker); computed here when the caller passes only the hits
  const view: PatternView = p.view ?? patternView({ hits: p.hits, status: p.status, tf: atf });
  const listed = view.active.length + view.expired.length + view.weaker.length;
  const show = p.on && (open || pinned) && listed > 0;
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
  const banner = viewBanner(view, cur, atf, { error: p.error, analysisT: p.analysisT });
  const col = bannerColors(banner.tone, light);
  // a badge whenever the analysis timeframe differs from the candles on screen (always on W / M analysis)
  const notDaily = atf === 'D' && !!tf && tf !== 'D';
  const tfBadge = atf !== 'D';
  const na = PATTERN_IDS.filter((id) => !patternApplies(id, atf));
  const tfBtn = (x: PatternTimeframe) => (
    <button key={x} type="button" onClick={() => p.setAnalysisTf?.(x)} aria-pressed={atf === x} title={`Find patterns on ${TF_WORD[x]} bars`}
      style={{ background: atf === x ? col.border : 'none', border: `1px solid ${col.border}`, borderRadius: 4, color: col.text, cursor: 'pointer', padding: '0 5px', fontSize: 10.5, fontWeight: 700, lineHeight: '15px' }}>{x}</button>
  );
  const small = { background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-1)', borderRadius: 6, color: 'var(--mc-text-2)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: '1px 8px', whiteSpace: 'nowrap' as const };
  const row = (h: PatternHit, kind: 'current' | 'expired' | 'weaker', why?: string, lead?: boolean) => {
    const c = kind === 'current' ? hitColor(h) : NONE_ROW;
    const failed = h.stage === 'failed';
    const textC = kind !== 'current' ? 'var(--mc-text-2)' : failed ? (light ? '#9A5B00' : FAILED_COLOR) : light ? (h.bias === 'bullish' ? '#05705E' : '#C8102E') : (h.bias === 'bullish' ? '#22C3A6' : '#FF6B78');
    const rk = `${kind}:${h.id}`;
    const rules = rulesOf === rk;
    const ev = evidenceWords(h), pw = pointWords(h, cur);
    return (
      <div key={rk} data-testid={`pattern-row-${kind}`} style={{ padding: '6px 4px', borderBottom: '1px solid var(--mc-border-3)', opacity: kind === 'current' ? 1 : 0.85 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexWrap: 'wrap' }}>
          <input type="checkbox" checked={p.drawnIds.has(h.id)} onChange={() => p.togglePick(h.id)} aria-label={`Draw ${h.label} on the chart`} />
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
  return (
    <div ref={boxRef} onMouseLeave={() => { if (!pinned) setOpen(false); }}
      style={{ position: 'absolute', left: 8, top: 4, zIndex: 7, maxWidth: 'calc(100% - 100px)', fontSize: 12 }}>
      {/* zzz1013 — the Pine look: an 8 px pill on the page colour with the tone as a tint and a hairline, a soft lift off the candles */}
      <div data-testid="pattern-banner" style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 24, borderRadius: 8, border: `1px solid ${col.border}`, background: `linear-gradient(${col.bg}, ${col.bg}), var(--mc-bg-0)`, color: col.text, lineHeight: '18px', boxShadow: '0 1px 0 rgba(18,23,34,.04), 0 6px 16px -10px rgba(18,23,34,.35)' }}>
        {p.setAnalysisTf && (
          <span role="group" aria-label="Pattern analysis timeframe" title="Analysis timeframe — separate from the candles on screen"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 6, fontSize: 10, whiteSpace: 'nowrap' }}>
            <span style={{ opacity: 0.8 }}>Analysis</span>{(['D', 'W', 'M'] as PatternTimeframe[]).map(tfBtn)}
          </span>
        )}
        {notDaily && (
          <span title="Patterns are found on the DAILY bars and drawn on the candles on screen" data-testid="daily-pattern-badge"
            style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4, border: `1px solid ${col.border}`, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>Daily pattern</span>
        )}
        {tfBadge && (
          <span title={`Patterns are found on ${TF_WORD[atf]} bars aggregated from the daily history (${p.includeCurrent ? 'the current period included, provisional' : 'completed periods only'}) and drawn on the candles on screen`} data-testid="tf-pattern-badge"
            style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4, border: `1px solid ${col.border}`, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{TF_BADGE[atf]}{p.provisional ? ' · provisional' : ''}</span>
        )}
        {tfBadge && p.setIncludeCurrent && (
          <label title={`Include the current, unfinished ${atf === 'W' ? 'week' : 'month'} — its candle can still change (provisional)`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 4, fontSize: 10, whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!p.includeCurrent} onChange={(e) => p.setIncludeCurrent?.(e.target.checked)} style={{ margin: 0, width: 11, height: 11 }} aria-label="Include the current period (provisional)" />
            current
          </label>
        )}
        {p.fitted && p.restoreView && (
          <button type="button" onClick={() => p.restoreView?.()} title="Back to the view before Fit pattern"
            style={{ marginLeft: 4, background: 'none', border: `1px solid ${col.border}`, borderRadius: 3, color: col.text, cursor: 'pointer', padding: '0 4px', fontSize: 10, whiteSpace: 'nowrap' }}>Restore view</button>
        )}
        <button type="button" onMouseEnter={() => setOpen(true)} onClick={() => setPinned((v) => !v)} aria-expanded={show} data-state={view.state}
          onKeyDown={(e) => { if (e.key === 'Escape') { setPinned(false); setOpen(false); } }}
          title={listed ? `Chart patterns on the ${TF_WORD[atf]} bars — click to keep the list open; tick a row to draw it. Esc closes the list.` : `Automate chart patterns (${TF_WORD[atf]} bars)`}
          style={{ background: 'none', border: 'none', color: col.text, cursor: listed ? 'pointer' : 'default', padding: notDaily || tfBadge || p.setAnalysisTf ? '1px 4px 1px 2px' : '1px 4px 1px 8px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, textAlign: 'left' }}>
          {banner.text}{listed > 0 ? ' ▾' : ''}
        </button>
        <button type="button" onClick={onTurnOff} aria-label="Turn off Automate chart patterns" title="Turn off Automate chart patterns (Indicators ▾ turns it back on)"
          style={{ background: 'none', border: 'none', color: col.text, cursor: 'pointer', padding: '0 6px', fontSize: 13, lineHeight: 1 }}>×</button>
      </div>
      {show && (
        <div role="dialog" aria-label="Chart patterns found"
          style={{ marginTop: 6, width: 'min(560px, calc(100vw - 80px))', maxHeight: 380, overflowY: 'auto', padding: '8px 10px 10px', borderRadius: 12, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', boxShadow: 'var(--ct-shadow, 0 8px 24px rgba(0,0,0,.18))' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            {p.fitted && p.restoreView && <button type="button" onClick={() => p.restoreView?.()} style={small}>Restore view</button>}
            <button type="button" onClick={() => { setPinned(false); setOpen(false); }} aria-label="Close the pattern list" style={small}>Close list</button>
          </div>
          {view.active.length > 0 ? (
            <>{heading('Current')}{view.active.map((h, k) => row(h, 'current', undefined, k === 0))}</>
          ) : (
            <div style={{ marginTop: 4, color: 'var(--mc-text-2)' }}>No qualifying {TF_WORD[atf]} pattern on the latest bars.</div>
          )}
          {view.expired.length > 0 && <>{heading('Expired / invalidated')}{view.expired.map((x: PatternViewRow) => row(x.hit, 'expired', x.why))}</>}
          {view.weaker.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => setShowWeak((v) => !v)} aria-expanded={showWeak} style={small}>
                {showWeak ? 'Hide weaker candidates' : `Show weaker candidates (${view.weaker.length})`}
              </button>
              {showWeak && <>{heading('Weaker candidates — not qualifying')}{view.weaker.map((x: PatternViewRow) => row(x.hit, 'weaker', x.why))}</>}
            </div>
          )}
          {p.omittedLines > 0 && (
            <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-warn, #D97706)' }}>
              {p.omittedLines} sloping line{p.omittedLines === 1 ? ' is' : 's are'} shorter than one candle on this timeframe and {p.omittedLines === 1 ? 'is' : 'are'} not drawn — switch to D to see the lines.
            </div>
          )}
          {(p.offLeft ?? 0) > 0 && (
            <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-warn, #D97706)' }}>
              Part of the drawn pattern ({p.offLeft} line{p.offLeft === 1 ? '' : 's'} / point{p.offLeft === 1 ? '' : 's'}) is older than the first candle on screen — choose a longer range (5Y / 10Y) to see all of it.
            </div>
          )}
          <div style={{ paddingTop: 6, fontSize: 11, color: 'var(--mc-text-3)' }}>
            {atf === 'D' ? 'Found on the daily bars (the last ~2.8 years), whatever timeframe is on screen.'
              : `Found on ${TF_WORD[atf]} bars built from the daily history (${atf === 'W' ? 'the last ~5 years' : 'up to 10 years'}; ${p.provisional ? 'the last candle is the current, unfinished period — provisional' : 'completed periods only'}), whatever timeframe is on screen.`}
            {na.length > 0 && ` Not read on ${TF_WORD[atf]} bars (too short to be seen on these candles): ${na.map((id) => PATTERN_META[id].label.toLowerCase()).join(', ')}.`}
            {' '}The headline is the strongest current structure: forming near its level or a recent breakout holding first, then breakouts back below the level; a failed structure only while its break is recent and the price is still near the level. Expired ones (older failures, completed breakouts) and weaker candidates are listed apart. The shape score is how closely the bars fit the pattern&apos;s rules — a heuristic, not a probability. Ticked rows are drawn on the chart with their turning points; they are not saved as drawings. A reading of the shape, not a signal — check it on the chart.
          </div>
        </div>
      )}
    </div>
  );
}
const NONE_ROW = '#787B86';
