'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { resolveFyYear } from '@/lib/calendar-dates';
import { newInfoScore } from '@/lib/cb-new-info';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getConvictionList, syncFromEarningsOps, setBenchSince, clearConvictionBeats, patchConvictionEntries, replaceConvictionFields, readConvictionBeats, readConvictionBin, restoreConvictionBin, type ConvictionEntry } from '@/lib/conviction-beats';
import { peadScore } from '@/lib/pead-score';
import { armBookFlag } from '@/lib/book-flags-client';
import { resolveSector, type ConvFilters, FILTER_DEFAULT, indiaPresetFilters, isIndiaPresetActive, filingAgeDays, __NEW_WIN, computeNewWindow, setNewWindow, deriveQuarterFY, getD2Pct, cbIsFinancial, cbComputeQuality, passesConvictionFilter, CB_PRESET_OPTOUT_KEY, cbCriteriaCheck, cbFiltersForOwner, readCbPresetOptOut, CB_PRESET_CAP_KEY, CB_CAP_FLOORS, cbCapFloorRaw, type CbCapFloor, cbVerdictLabel } from '@/lib/conviction-filter-india';
import { cbCompany, buildHiddenReport, hiddenReportLine, presetBarText, CB_GRADED_V_KEY, CB_RESYNC_MAX_DATES, needsCbResync, cbResyncPatch, resyncSummary, writeCbTabSnapshot, filtersMatchSaved, cbExportWords, type ResyncPatch } from '@/lib/india-cb-view';
import { GRADED_CACHE_VERSION } from '@/lib/graded-cache-key';
import { CASH_RULE_V } from '@/lib/india-cash';
import { selectIndiaCb } from '@/lib/thesis/pc-bench';
import { resolveIndiaBook, type BookName } from '@/lib/thesis/book-membership';
import { loadIndiaBookInput, readLocalBookInput } from '@/lib/thesis/book-sources';
import { notCheckedText, type CriteriaCheck } from '@/lib/criteria-check';
import TickerExportToolbar from '@/components/TickerExportToolbar';
import { EarningsCardComponent, CoverageStatsBar, type EarningsScanCard } from '@/components/EarningsScanCard';
import { ConvictionTable, ConvictionRow } from './ConvictionTable';
import { HubFilterRail } from './HubFilterRail';
import { HUB_FILTER_DEFAULT } from './constants';
import { passesHubFilter, cbDriftState } from './helpers';
import { type HubFilters } from './types';
import { useEnrichedConvictionCards } from './useEnrichedConvictionCards';

// zzz827 — true while a fill pass runs; a card says "Q-TRENDS loading…" only then.
export let __cbFillRunning = false;

export function ConvictionBeatsPanel({ entries, onRemove, onClearAll, onRebuild, onShowAll, benchSince, seasonBusy }: { entries: ConvictionEntry[]; onRemove: (t: string) => void; onClearAll?: () => void; onRebuild?: (days: number) => void | Promise<void>; onShowAll?: () => void; benchSince?: string | null; seasonBusy?: boolean }) {
  // PATCH zzz99 — bulk Clear All button for Conviction Beats.
  // User flow: starting fresh for next earnings cycle, drain the entire
  // bench at once instead of clicking × on every row. Guarded by
  // window.confirm so a misclick can't nuke 100+ entries silently.
  // PATCH 0540 — all hooks declared BEFORE any early-return so React's
  // Rules-of-Hooks holds across the empty-bench → populated-bench transition
  // (previously the empty-state returned before useState, which would have
  // crashed if the bench populated while the user was on the tab).
  // USER-REQ — filter state (composable AND)
  const [filters, setFilters] = useState<ConvFilters>(FILTER_DEFAULT);
  // zzz246 — auto-apply Quality Preset v2 on first mount unless user opted out.
  // Runs once client-side. If localStorage says "optout=1", we respect that
  // and leave FILTER_DEFAULT (all null). Otherwise we set the preset values.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // zzz366 — optout key bumped v2->v3. The preset meaning changed (verdicts now
      // default to STRONG BUY + BUY + WATCH), so a stale v2 opt-out must NOT suppress
      // the new default. A fresh v3 key means every user gets the new preset auto-ON
      // once; they can still opt out again (which sets v3) and that choice sticks.
      const optOut = localStorage.getItem(CB_PRESET_OPTOUT_KEY) === '1';
      if (optOut) return;
      // Only apply if filters are still at their FILTER_DEFAULT initial state.
      // (Avoids clobbering filters restored from a saved view later.)
      setFilters((prev) => (
        prev.sales == null && prev.eps == null && prev.pead == null && prev.opmDelta == null && prev.cfoPatMin == null && prev.mktCapMin == null && prev.verdicts == null /* zzz362 */
          ? { ...prev, ...indiaPresetFilters() } /* zzz366 — preset auto-ON with SB+BUY+WATCH; zzz672 — off the shared constant */
          : prev
      ));
    } catch {}
  }, []);
  // zzz226 — detail filter chips are hidden by default; the ⚡ preset button
  // applies the user's standard screen without opening them.
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  // ── ADDITIVE zzzUP1 — Transformation-radar overlay. On mount, fetch the
  // concall-intel transformation screener and index it by upper-cased symbol.
  // Cards whose ticker is on the radar get a 🚀 badge; the "On Radar" toggle
  // narrows the bench to radar names. Tolerant of fetch failure (empty map).
  const [radarMap, setRadarMap] = useState<Map<string, any>>(new Map());
  const [onRadarOnly, setOnRadarOnly] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/concall-intel/transformation-screener?days=60&limit=24', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data?.entries) ? data.entries : [];
        const m = new Map<string, any>();
        for (const it of list) {
          const sym = String(it?.symbol || '').toUpperCase();
          if (sym) m.set(sym, it);
        }
        if (!cancelled) setRadarMap(m);
      } catch { /* radar overlay is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // ── ADDITIVE zzzUP2 — Cheap-BLOCKBUSTER valuation view. Client-only toggle;
  // shows BLOCKBUSTER/STRONG names with trailing_pe in (0, 35], cheapest first.
  const [cheapStrong, setCheapStrong] = useState(false);
  // ── ADDITIVE zzzUP3 — Regime strip. On mount, fetch market breadth. The thin
  // banner at the top of the tab frames how aggressively to add. Fetch failure
  // hides the strip (regime stays null).
  const [regime, setRegime] = useState<{ composite: number; regime: string; regime_color: string; regime_desc?: string; suggested_cash_pct: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/breadth', { cache: 'no-store' });
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled || !d || typeof d.composite !== 'number') return;
        setRegime({
          composite: d.composite,
          regime: String(d.regime ?? ''),
          regime_color: String(d.regime_color ?? 'var(--mc-text-2)'),
          regime_desc: d.regime_desc != null ? String(d.regime_desc) : undefined,
          suggested_cash_pct: typeof d.suggested_cash_pct === 'number' ? d.suggested_cash_pct : 0,
        });
      } catch { /* regime strip is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // PATCH 1019 — Re-validate bench. Re-fetches graded for every unique
  // filing date on the bench and re-syncs (all tiers) so any stock that
  // dropped out of BLOCKBUSTER/STRONG under the current grading logic
  // (e.g. ADSL after the turnaround gate) gets pruned automatically.
  const [revalidating, setRevalidating] = useState(false);
  // zzz236 — Auto-enrich entries lacking d2_pct/move_pct. Runs once on mount.
  // Fires the enrich API for stale entries (added before zzz230/231) so d2/move
  // fields populate without user needing to click Re-validate.
  // zzz373 — the walk is now a reusable function so the "⟳ Fill missing" button
  // can run it on demand (manual=true → ignore attempt bound, force nocache, report
  // progress). The mount effect below calls it once with manual=false.
  const [fillProgress, setFillProgress] = useState<string | null>(null);
  const fillRunningRef = useRef(false);
  // zzz827 — the merged list (this browser + server), so the fill pass also
  // reaches names that are only on the server bench.
  const entriesRef = useRef<ConvictionEntry[]>(entries);
  entriesRef.current = entries;
  const runEnrichWalk = useCallback(async (manual: boolean) => {
    if (typeof window === 'undefined') return;
    // zzz374 — a manual click must ALWAYS give feedback. Previously, if the
    // mount auto-walk was still in flight (fillRunningRef true), the click
    // returned silently and the user saw "nothing happened". Now: manual
    // clicks show an immediate status, and if a walk is already running they
    // say so instead of no-op'ing.
    if (fillRunningRef.current) {
      if (manual) { setFillProgress('⏳ A fill pass is already running — watch the counter, or try again once it finishes.'); setTimeout(() => setFillProgress(null), 6000); }
      return;
    }
    setFillProgress(manual ? 'Scanning bench for missing data…' : 'Auto-filling missing data…');
    fillRunningRef.current = true;
    __cbFillRunning = true;
    // zzz827 — a name only on the server bench was never filled (the pass read
    // this browser's list only), so its card showed ROCE "—" and "Q-TRENDS
    // loading…" for ever. Add those names to this browser's list first (their
    // full server card; add-only), then fill everything the same way.
    try {
      const localKeys = new Set(getConvictionList().map((e) => String(e.ticker || '').toUpperCase()));
      const seed = (entriesRef.current || []).filter((e: any) => e?.ticker && e?.filing_date && !localKeys.has(String(e.ticker).toUpperCase())
        && (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG'));
      if (seed.length) syncFromEarningsOps(seed.map((e: any) => { const { added_at: _a, _cb_src: _s, ...rest } = e; void _a; void _s; return rest; }) as any);
    } catch { /* seeding is best-effort */ }
    const list = getConvictionList();
    let done = 0, total = 0;
    // zzz375 — report for BOTH manual and the mount auto-walk so a background
    // fill is visible (the user pressed nothing but sees "Auto-filling 8/40…"
    // rather than a dead page). Background runs clear their own status when done.
    const report = (msg: string) => setFillProgress(manual ? msg : `⟳ ${msg}`);
    // zzz244/248/255 — broaden auto-enrich gate. Fire whenever ANY expected field
    // is missing (move_pct, d2, pe, close_30d, roce). This includes new institutional
    // fields added in zzz254 so existing entries backfill on next page load.
    // zzz369 — a bench entry can be stamped cb_enrich_v=367 yet still lack the
    // quarterly trend series, because on the fetch that stamped it the server had a
    // transient Screener miss for that symbol (cache poisoning). Keep re-enriching
    // such entries (non-financial, bounded to 6 attempts so we never loop forever on
    // symbols Screener genuinely can't parse) until the trends actually arrive. The
    // server now short-TTLs the trend-less cache, so each retry has a fresh chance.
    const needsTrends = (e: any): boolean => {
      if (cbIsFinancial(e)) return false; // financials: OPM/tax trends not meaningful
      const hasTrend = Array.isArray(e.quarters_opm) || Array.isArray(e.quarters_tax_pct)
        || Array.isArray(e.quarters_other_income_pct) || Array.isArray(e.annual_cfo_pat);
      return !hasTrend && (manual || (e.cb_trend_attempts || 0) < 6);
    };
    // zzz827 — the same-year cash figure (EO rule v3) is fetched once per name
    // (twice at most); ROCE missing retries are bounded like the trend retries.
    const needsCash = (e: any): boolean => !cbIsFinancial(e) && !((e.cash_rule_v || 0) >= CASH_RULE_V) && (manual || (e.cb_cash_attempts || 0) < 2);
    const stale = list.filter(e =>
      e.ticker && e.filing_date &&
      (typeof (e as any).move_pct !== 'number'
        || typeof (e as any).d2_pct !== 'number'
        || typeof (e as any).pe !== 'number'
        || (typeof (e as any).roce !== 'number' && (manual || ((e as any).cb_trend_attempts || 0) < 6))  // zzz255 — zzz827: bounded
        || needsCash(e)
        || (e as any).cb_enrich_v !== 377  // zzz377 (was 375) — re-enrich once so worker-sourced Q-TRENDS land (Screener direct scrape is IP-blocked on Railway). zzz375 (was 371) — re-enrich once so the Screener standalone-page fallback fills names that only had /consolidated/ misses. zzz372 (was 369) — one-time re-enrich so zzz371 CFO/PAT value fixes propagate. zzz367 — one-time re-enrich (v11 cache: trends now extracted on the proven fetchScreenerCFO path, which actually works in prod)
        || needsTrends(e)  // zzz369 — keep retrying until the trend series lands
        || !Array.isArray((e as any).close_30d)
        || (e as any).close_30d.length < 2)
    );
    if (stale.length === 0) { fillRunningRef.current = false; __cbFillRunning = false; if (manual) { setFillProgress('✓ Nothing missing — every card already has trends / P/E / DRIFT (or is a financial).'); setTimeout(() => setFillProgress(null), 8000); } else { setFillProgress(null); } return; }
    total = stale.length;
    report(`Filling 0/${total}…`);
    // zzz370 — walk is a reusable pass so we can run a RETRY SWEEP after the first
    // full walk. `retry=true` adds nocache=1 so a symbol whose first fetch hit a
    // transient Screener miss (and got a short-TTL trend-less payload cached) is
    // re-scraped fresh instead of being served the same empty result again.
    const runPass = async (targets: typeof stale, retry: boolean) => {
      // Batch by filing_date so we can pass filedHint per group
      const byDate = new Map<string, string[]>();
      for (const e of targets) {
        const arr = byDate.get(e.filing_date!) || [];
        arr.push(e.ticker!);
        byDate.set(e.filing_date!, arr);
      }
      for (const [dt, tickers] of byDate) {
        // zzz369 — chunk into small batches of 8 so the server can live-scrape
        // Screener for each symbol WITHIN its function timeout. A 30-symbol batch was
        // timing out server-side and returning nothing, so the trend series never got
        // persisted onto the bench (the real reason cards showed no Q-TRENDS even when
        // the single-symbol API had them). Also processes EVERY ticker for the date
        // instead of silently dropping everything past the first 30.
        for (let ci = 0; ci < tickers.length; ci += 8) {
          const chunk = tickers.slice(ci, ci + 8);
          try {
          const url = `/api/v1/earnings/enrich?symbols=${chunk.map(encodeURIComponent).join(',')}&filed=${dt}${retry ? '&nocache=1' : ''}`;  // zzz800 — '&' in tickers
          // zzz372 — a failed/timed-out batch used to be SKIPPED, leaving every symbol in
          // the chunk without P/E, DRIFT, ROCE (the "P/E vanished on many cards" symptom,
          // clustered by chunk/date). Now: fall back to per-symbol fetches so one slow
          // Screener scrape can't blank seven neighbours.
          let data: Record<string, any> = {};
          let batchOk = false;
          try {
            const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
            if (res.ok) { const j = await res.json(); data = j?.data || {}; batchOk = true; }
          } catch {}
          if (!batchOk || chunk.some(sym => !data[sym])) {
            for (const sym of chunk) {
              if (data[sym]) continue;
              try {
                const r1 = await fetch(`/api/v1/earnings/enrich?symbols=${encodeURIComponent(sym)}&filed=${dt}${retry ? '&nocache=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
                if (r1.ok) { const j1 = await r1.json(); if (j1?.data?.[sym]) data[sym] = j1.data[sym]; }
              } catch {}
              await new Promise(r => setTimeout(r, 150));
            }
          }
          const syncEntries: any[] = [];
          for (const sym of chunk) {
            const enr = data[sym];
            if (!enr) continue;
            // zzz371 — read the CURRENT bench entry, not the mount-time `list` snapshot.
            // Pass 1 mutates the bench (stamps cb_enrich_v / cb_trend_attempts); if pass 2
            // read the stale snapshot, cb_trend_attempts would never advance and the
            // 6-attempt retry bound could never be consumed.
            const existing = getConvictionList().find(e => e.ticker === sym) || list.find(e => e.ticker === sym);
            if (!existing) continue;
            syncEntries.push({
              ticker: sym,
              company: existing.company,
              tier: existing.tier,
              filing_date: existing.filing_date,
              // Only fields we want to update:
              d1_pct: typeof enr.d1_pct === 'number' ? enr.d1_pct : (existing as any).d1_pct,
              gap_pct: typeof enr.gap_pct === 'number' ? enr.gap_pct : (existing as any).gap_pct,
              // zzz372 — never null-out drift on a partial/nocache response; keep what we have.
              d2_pct: typeof enr.d2_pct === 'number' ? enr.d2_pct : (existing as any).d2_pct,
              move_pct: typeof enr.move_pct === 'number' ? enr.move_pct : (existing as any).move_pct,
              opm_pct: typeof enr.opm_pct === 'number' ? enr.opm_pct : (existing as any).opm_pct,
              opm_prev_pct: typeof enr.opm_prev_pct === 'number' ? enr.opm_prev_pct : (existing as any).opm_prev_pct,
              // zzz242 — pull trailing P/E from enrich response (fallback to stockPE)
              pe: typeof enr.pe === 'number' ? enr.pe : (typeof enr.stockPE === 'number' ? enr.stockPE : (existing as any).pe),
              // zzz248 — carry 30-day close series for sparkline
              close_30d: Array.isArray(enr.close_30d) && enr.close_30d.length >= 2 ? enr.close_30d : (existing as any).close_30d,
              // zzz254 — institutional quality fields (all optional; carry from Screener/Yahoo)
              roce: typeof enr.roce === 'number' ? enr.roce : (existing as any).roce,
              roe: typeof enr.roe === 'number' ? enr.roe : (existing as any).roe,
              debtToEquity: typeof enr.debtToEquity === 'number' ? enr.debtToEquity : ((existing as any).debtToEquity ?? (existing as any).debt_to_equity),
              rs_rating: typeof enr.rs_rating === 'number' ? enr.rs_rating : (existing as any).rs_rating,
              ocf_to_pat_ratio: typeof enr.ocf_to_pat_ratio === 'number' ? enr.ocf_to_pat_ratio : (existing as any).ocf_to_pat_ratio,
              // zzz361 — carry full institutional field set onto bench
              quarters_sales: Array.isArray(enr.quarters_sales) ? enr.quarters_sales : (existing as any).quarters_sales,
              quarters_eps: Array.isArray(enr.quarters_eps) ? enr.quarters_eps : (existing as any).quarters_eps,
              quarters_opm: Array.isArray(enr.quarters_opm) ? enr.quarters_opm : (existing as any).quarters_opm,
              quarters_material_cost_pct: Array.isArray(enr.quarters_material_cost_pct) ? enr.quarters_material_cost_pct : (existing as any).quarters_material_cost_pct,
              quarters_other_income_pct: Array.isArray(enr.quarters_other_income_pct) ? enr.quarters_other_income_pct : (existing as any).quarters_other_income_pct,
              quarters_tax_pct: Array.isArray(enr.quarters_tax_pct) ? enr.quarters_tax_pct : (existing as any).quarters_tax_pct,
              annual_cfo_pat: Array.isArray(enr.annual_cfo_pat) ? enr.annual_cfo_pat : (existing as any).annual_cfo_pat,
              ebitda_margin_pct: typeof enr.ebitda_margin_pct === 'number' ? enr.ebitda_margin_pct : (existing as any).ebitda_margin_pct,
              receivables_yoy_pct: typeof enr.receivables_yoy_pct === 'number' ? enr.receivables_yoy_pct : (existing as any).receivables_yoy_pct,
              inventory_yoy_pct: typeof enr.inventory_yoy_pct === 'number' ? enr.inventory_yoy_pct : (existing as any).inventory_yoy_pct,
              avg_vol_20d: typeof enr.avg_vol_20d === 'number' ? enr.avg_vol_20d : (existing as any).avg_vol_20d,
              vol_ratio_20d: typeof enr.vol_ratio_20d === 'number' ? enr.vol_ratio_20d : (existing as any).vol_ratio_20d,
              dist_52w_pct_yahoo: typeof enr.dist_52w_pct_yahoo === 'number' ? enr.dist_52w_pct_yahoo : (existing as any).dist_52w_pct_yahoo,
              pledged_pct: typeof enr.pledged_pct === 'number' ? enr.pledged_pct : (existing as any).pledged_pct,
              roic: typeof enr.roic === 'number' ? enr.roic : (existing as any).roic,
              int_coverage: typeof enr.int_coverage === 'number' ? enr.int_coverage : (existing as any).int_coverage,
              debtor_days: typeof enr.debtor_days === 'number' ? enr.debtor_days : (existing as any).debtor_days,
              inventory_days: typeof enr.inventory_days === 'number' ? enr.inventory_days : (existing as any).inventory_days,
              wc_days: typeof enr.wc_days === 'number' ? enr.wc_days : (existing as any).wc_days,
              pat_margin_curr: typeof enr.pat_margin_curr === 'number' ? enr.pat_margin_curr : (existing as any).pat_margin_curr,
              pat_margin_prev: typeof enr.pat_margin_prev === 'number' ? enr.pat_margin_prev : (existing as any).pat_margin_prev,
              other_income_pct_sales_curr: typeof enr.other_income_pct_sales_curr === 'number' ? enr.other_income_pct_sales_curr : (existing as any).other_income_pct_sales_curr,
              other_income_pct_sales_prev: typeof enr.other_income_pct_sales_prev === 'number' ? enr.other_income_pct_sales_prev : (existing as any).other_income_pct_sales_prev,
              effective_tax_rate_curr: typeof enr.effective_tax_rate_curr === 'number' ? enr.effective_tax_rate_curr : (existing as any).effective_tax_rate_curr,
              effective_tax_rate_prev: typeof enr.effective_tax_rate_prev === 'number' ? enr.effective_tax_rate_prev : (existing as any).effective_tax_rate_prev,
              dep_yoy_pct: typeof enr.dep_yoy_pct === 'number' ? enr.dep_yoy_pct : (existing as any).dep_yoy_pct,
              finance_cost_curr_cr: typeof enr.finance_cost_curr_cr === 'number' ? enr.finance_cost_curr_cr : (existing as any).finance_cost_curr_cr,
              ebit_curr_cr: typeof enr.ebit_curr_cr === 'number' ? enr.ebit_curr_cr : (existing as any).ebit_curr_cr,
              ebit_yoy_pct: typeof enr.ebit_yoy_pct === 'number' ? enr.ebit_yoy_pct : (existing as any).ebit_yoy_pct,
              ebitda_curr_cr: typeof enr.ebitda_curr_cr === 'number' ? enr.ebitda_curr_cr : (existing as any).ebitda_curr_cr,
              ebitda_yoy_pct: typeof enr.ebitda_yoy_pct === 'number' ? enr.ebitda_yoy_pct : (existing as any).ebitda_yoy_pct,
              // zzz363 — one-off / exceptional-item fields (v9 cache)
              exceptional_curr_cr: typeof enr.exceptional_curr_cr === 'number' ? enr.exceptional_curr_cr : (existing as any).exceptional_curr_cr,
              exceptional_pct_pbt: typeof enr.exceptional_pct_pbt === 'number' ? enr.exceptional_pct_pbt : (existing as any).exceptional_pct_pbt,
              cb_enrich_v: 377,  // zzz377 — bump (was 375) so re-enrich fires once for the v13 cache. zzz369 — bump so re-enrich fires once for v11 cache (trends on proven CFO path)
              // zzz369 — count trend-fetch attempts so needsTrends() retry is bounded.
              cb_trend_attempts: ((existing as any).cb_trend_attempts || 0) + 1,
              // zzz376 — carry the server's reason so the card can say "genuinely
              // absent" vs "fetch failed (transient)". Overwrite each pass.
              _trends_status: typeof enr._trends_status === 'string' ? enr._trends_status : (existing as any)._trends_status,
            });
          }
          if (syncEntries.length > 0) syncFromEarningsOps(syncEntries);
          done += chunk.length;
          report(`Filling ${Math.min(done, total)}/${total} · ${chunk.join(', ')}`);
          // zzz372 — syncFromEarningsOps null-fills only (by design, so stale graded
          // payloads can't clobber data). But THIS walk carries LIVE values, and some
          // must OVERWRITE: the zzz371 CFO/PAT alignment fix (KMEW 1.17 → 0.62),
          // fresh drift/P/E after a re-enrich, corrected ROCE/ROE. Patch those in.
          if (syncEntries.length > 0) {
            const live = syncEntries.map(se => {
              const enr = data[se.ticker] || {};
              const n = (v: any) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
              return {
                ticker: se.ticker,
                move_pct: n(enr.move_pct), d2_pct: n(enr.d2_pct), d1_pct: n(enr.d1_pct), gap_pct: n(enr.gap_pct),
                pe: n(enr.pe) ?? n(enr.stockPE),
                roce: n(enr.roce), roe: n(enr.roe), debtToEquity: n(enr.debtToEquity),
                cfo_to_pat_ratio: n(enr.ocf_to_pat_ratio), ocf_to_pat_ratio: n(enr.ocf_to_pat_ratio),
                close_30d: Array.isArray(enr.close_30d) && enr.close_30d.length >= 2 ? enr.close_30d : null,
                other_income_pct_sales_curr: n(enr.other_income_pct_sales_curr), other_income_pct_sales_prev: n(enr.other_income_pct_sales_prev),
                effective_tax_rate_curr: n(enr.effective_tax_rate_curr), effective_tax_rate_prev: n(enr.effective_tax_rate_prev),
                roic: n(enr.roic), pledged_pct: n(enr.pledged_pct),
              };
            });
            try { patchConvictionEntries(live); } catch {}
            // zzz827 — the same-year cash pair, written as-is (a null clears an
            // old annual-CFO ÷ one-quarter ratio instead of leaving it behind).
            try {
              replaceConvictionFields(syncEntries.map((se) => {
                const enr = data[se.ticker] || {};
                const n = (v: any) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
                const cur: any = getConvictionList().find((x) => x.ticker === se.ticker) || {};
                return { ticker: se.ticker, patch: {
                  cash_fy: typeof enr.cash_fy === 'string' ? enr.cash_fy : null,
                  cash_basis: typeof enr.cash_basis === 'string' ? enr.cash_basis : null,
                  ocf_annual_cr: n(enr.ocf_annual_cr), pat_annual_cr: n(enr.pat_annual_cr),
                  ocf_to_pat_ratio: n(enr.ocf_to_pat_ratio), cfo_to_pat_ratio: n(enr.ocf_to_pat_ratio),
                  cash_rule_v: n(enr.cash_rule_v),
                  cb_cash_attempts: (cur.cb_cash_attempts || 0) + 1,
                } };
              }));
            } catch {}
          }
          } catch {}
          // Throttle between chunks
          await new Promise(r => setTimeout(r, 300));
        }
      }
    };
    try {
      // Pass 1 — everything the gate flagged. Manual runs go straight to nocache=1
      // (the user is asking for a FRESH scrape, not a cache replay).
      await runPass(stale, manual);
      // zzz370 — Pass 2: RETRY SWEEP. Re-read the bench (pass 1 mutated it) and
      // re-fetch, with nocache=1, only the non-financial entries that STILL lack a
      // trend series. Fixes the "only some populating" symptom: well-covered names
      // (NAVINFLUOR / DIVISLAB / DEEPAKNTR ...) whose single first attempt hit a
      // transient Screener miss now get a fresh live scrape in the same session
      // instead of waiting for the next page load. Bounded by cb_trend_attempts.
      await new Promise(r => setTimeout(r, 1500));
      const again = getConvictionList().filter(e => e.ticker && e.filing_date && needsTrends(e));
      if (again.length > 0) { done = 0; total = again.length; report(`Retry sweep 0/${total}…`); await runPass(again, true); }
      if (manual) {
        const stillMissing = getConvictionList().filter(e => e.ticker && e.filing_date && needsTrends(e)).length;
        setFillProgress(stillMissing === 0
          ? `✓ Done — all ${stale.length} entries filled.`
          : `✓ Done — ${stale.length - stillMissing} filled · ${stillMissing} still without trends (Screener has no parsable quarterly table for them, or it is a financial). Re-run later to retry.`);
        setTimeout(() => setFillProgress(null), 15_000);
      } else {
        // Background walk finished — clear the "Auto-filling…" indicator.
        setFillProgress(null);
      }
    } finally { fillRunningRef.current = false; __cbFillRunning = false; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { runEnrichWalk(false); }, [runEnrichWalk]);
  // zzz827 — the server bench arrives after mount; once it has, one more
  // (bounded, background) pass fills the names only it carries.
  const serverSeenRef = useRef(false);
  useEffect(() => {
    if (serverSeenRef.current) return;
    if (!entries.some((e: any) => e?._cb_src === 'server')) return;
    serverSeenRef.current = true;
    // Wait for any pass already running, then run once (bounded: 10 minutes).
    let tries = 0;
    const iv = setInterval(() => {
      if (fillRunningRef.current && ++tries < 60) return;
      clearInterval(iv);
      runEnrichWalk(false);
    }, 10_000);
    return () => clearInterval(iv);
  }, [entries, runEnrichWalk]);

  // zzz429 — DURABLE bench-card completion (self-healing, no manual click).
  // Root cause of the "⏳ Results Pending / QUALITY 0 / ROCE —" cards (RUBICON,
  // CMRGREEN, INNOVACAP, DIACABS, KINGFA …): these BLOCKBUSTER/STRONG names reach
  // the tab ONLY through the async server-bench merge (/api/v1/bench), which loads
  // AFTER the one-shot mount enrich walk ran and carries no financials — so they
  // sit lean forever (no OPM / P/E / ROCE / YoY).
  //
  // zzz428 tried to heal each one with a PER-TICKER Screener enrich call, but on a
  // page already firing a ~168-entry retry sweep those 30+ extra calls queued behind
  // the storm and timed out — then a permanent "attempted" set meant they never
  // retried. This version fixes both:
  //   • It reads the GRADED-DATE payload (/api/v1/earnings/graded?date=…), which is
  //     server-cached and already contains the full card (sales/PAT/EPS YoY, OPM,
  //     P/E, quality flags) for EVERY ticker filed that day — RUBICON included. One
  //     cached request per unique filing_date covers all the lean names for that day,
  //     so there is no per-ticker Screener burst and nothing to rate-limit.
  //   • A ticker is marked done only on SUCCESS; a transient miss is retried (bounded
  //     to 3 attempts each) instead of being abandoned. An in-flight guard means only
  //     one heal pass runs at a time, so the effect can safely watch `entries`.
  const benchHealDoneRef = useRef<Set<string>>(new Set());
  const benchHealTriesRef = useRef<Map<string, number>>(new Map());
  const benchHealInflightRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (benchHealInflightRef.current) return;
    let cancelled = false;
    const isLean = (e: any) => {
      const noYoY = (e.sales_yoy_pct == null) && (e.net_profit_yoy_pct == null) && (e.eps_yoy_pct == null);
      const noFin = (e.opm_pct == null) && !Array.isArray(e.quarters_sales);
      return noYoY && noFin;
    };
    // Which members are still rendering lean, have a filing_date, and haven't been
    // healed or exhausted their retry budget?
    const byDate = new Map<string, string[]>();
    for (const e of entries as any[]) {
      const t = String(e?.ticker || '').toUpperCase();
      if (!t || !e?.filing_date) continue;
      if (benchHealDoneRef.current.has(t)) continue;
      if ((benchHealTriesRef.current.get(t) || 0) >= 3) continue;
      if (!isLean(e)) { benchHealDoneRef.current.add(t); continue; }
      const arr = byDate.get(e.filing_date) || [];
      arr.push(t);
      byDate.set(e.filing_date, arr);
    }
    if (byDate.size === 0) return;
    benchHealInflightRef.current = true;
    (async () => {
      for (const [dt, tickers] of byDate) {
        if (cancelled) break;
        const want = new Set(tickers);
        for (const t of tickers) benchHealTriesRef.current.set(t, (benchHealTriesRef.current.get(t) || 0) + 1);
        // One cached graded-date fetch returns the full card for every ticker filed
        // that day. No Screener burst; independent of the /api/v1/bench blob.
        let cards: any[] = [];
        try {
          const res = await fetch(`/api/v1/earnings/graded?date=${dt}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
          if (res.ok) {
            const j = await res.json();
            const bt = j?.by_tier || {};
            for (const tier of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
              for (const c of (bt[tier] || [])) cards.push(c);
            }
          }
        } catch {}
        if (cancelled) break;
        const syncEntries: any[] = [];
        for (const c of cards) {
          const sym = String(c?.ticker || '').toUpperCase();
          if (!want.has(sym)) continue;
          // Ignore a card that is itself still lean (nothing gained) so we retry later.
          if (isLean(c)) continue;
          let qParsed: any, fyParsed: any;
          if (typeof c.quarter === 'string') {
            const qm = c.quarter.match(/Q([1-4])/i); if (qm) qParsed = 'Q' + qm[1];
            const fm = c.quarter.match(/FY\s?(\d{2})/i); if (fm) { const yy = parseInt(fm[1], 10); fyParsed = resolveFyYear(yy); }
          }
          syncEntries.push({
            ...(c as any),
            ticker: sym,
            company: c.company || sym,
            filing_date: c.filing_date || dt,
            source_url: c.filing_url || (c as any).source_url,  // match rich cards' NSE hyperlink
            ...(qParsed ? { quarter: qParsed } : {}),
            ...(fyParsed ? { fiscal_year: fyParsed } : {}),
          });
          benchHealDoneRef.current.add(sym);
        }
        if (!cancelled && syncEntries.length) {
          try { syncFromEarningsOps(syncEntries as any); } catch {}
        }
        await new Promise(r => setTimeout(r, 250));
      }
      benchHealInflightRef.current = false;
    })();
    return () => { cancelled = true; benchHealInflightRef.current = false; };
  }, [entries]);

  const [revalProgress, setRevalProgress] = useState<string | null>(null);
  // zzz827 — STALE TIERS. A bench row kept the tier and figures it had the
  // day it was benched; the grading engine has moved on since (v26), so a
  // name the EO page now grades STRONG ("thin operating margin") still read
  // BLOCKBUSTER here. The re-sync reads the current graded row for each
  // filing date on this browser's bench and takes its tier and figures. A
  // name now below STRONG is KEPT and labelled "now MIXED under current
  // rules" — never deleted by this pass (× still removes it).
  //   • automatic, once, when the stored engine version is older than the
  //     current one — bounded to CB_RESYNC_MAX_DATES dates per visit;
  //   • the "Re-validate bench" button runs it over every date.
  const resyncRunningRef = useRef(false);
  const runResync = useCallback(async (auto: boolean): Promise<void> => {
    if (resyncRunningRef.current) return;
    resyncRunningRef.current = true;
    setRevalidating(true);
    try {
      // Bare keys only: a "TICKER@Q3-2026" history row is another quarter.
      const bare = (): ConvictionEntry[] => Object.entries(readConvictionBeats()).filter(([k]) => !k.includes('@')).map(([, v]) => v);
      const local = bare();
      const allDates = Array.from(new Set(local.map((e) => e.filing_date).filter(Boolean))).sort().reverse();
      const dates = auto ? allDates.slice(0, CB_RESYNC_MAX_DATES) : allDates;
      if (!dates.length) { if (!auto) setRevalProgress('Bench is empty.'); return; }
      const patches: ResyncPatch[] = [];
      let read = 0;
      for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        setRevalProgress(`${auto ? 'Updating bench to the current grading' : 'Re-validating'} ${i + 1}/${dates.length} · ${d}`);
        try {
          const res = await fetch(`/api/v1/earnings/graded?date=${d}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
          if (!res.ok) continue;
          const j = await res.json();
          read++;
          const rows = new Map<string, any>();
          for (const tier of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
            for (const c of (j?.by_tier?.[tier] || [])) if (c?.ticker) rows.set(String(c.ticker).toUpperCase(), { ...c, tier, filing_date: c.filing_date || d });
          }
          for (const e of bare()) {
            if (e.filing_date !== d) continue;
            const row = rows.get(String(e.ticker || '').toUpperCase());
            const p = row ? cbResyncPatch(e, row) : null;
            if (p && p.change !== 'none') patches.push(p);
          }
          if (patches.length) replaceConvictionFields(patches.filter((p, k, arr) => arr.findIndex((q) => q.ticker === p.ticker) === k));
        } catch { /* one date failing never blocks the rest */ }
        await new Promise((r) => setTimeout(r, auto ? 500 : 800));
      }
      if (read === dates.length && dates.length === allDates.length) {
        try { localStorage.setItem(CB_GRADED_V_KEY, GRADED_CACHE_VERSION); } catch {}
      }
      setRevalProgress(`\u2713 ${resyncSummary(patches, GRADED_CACHE_VERSION, read, allDates.length)}`);
    } finally {
      resyncRunningRef.current = false;
      setRevalidating(false);
      setTimeout(() => setRevalProgress(null), 15_000);
    }
  }, []);
  const runRevalidate = useCallback(() => { runResync(false); }, [runResync]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(CB_GRADED_V_KEY); } catch { stored = null; }
    if (!needsCbResync(stored, GRADED_CACHE_VERSION)) return;
    // After the mount fill pass has had a head start.
    const t = setTimeout(() => { runResync(true); }, 2500);
    return () => clearTimeout(t);
  }, [runResync]);
  // zzz229 — REBUILD bench from server history. The bench lives only in
  // browser storage; if the browser evicts the origin's storage (quota
  // pressure from the big multibagger payloads) or grading-rule changes
  // demote everything, the bench drains. The server keeps per-date graded
  // payloads, so we can re-fetch the last 60 days and re-add every
  // BLOCKBUSTER/STRONG print (ADD-only — never demotes/deletes).
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<string | null>(null);
  const [binCount, setBinCount] = useState<number>(() => readConvictionBin().length);
  useEffect(() => {
    const refresh = () => setBinCount(readConvictionBin().length);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => window.removeEventListener('conviction-beats:updated', refresh);
  }, []);
  const runRebuild = useCallback(async (days: number = 60, fresh: boolean = false) => {
    if (rebuilding) return;
    setRebuilding(true);
    try {
      // zzz868: a fresh rebuild wipes the bench and sets the start date; a plain rebuild only adds (and widens the start date to match)
      if (fresh) { try { clearConvictionBeats(); } catch {} }
      setBenchSince(new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10));
      const dates: string[] = [];
      const now = new Date();
      for (let i = 0; i <= days; i++) {
        const d = new Date(now.getTime() - i * 24 * 3600_000);
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue;  // NSE closed
        dates.push(d.toISOString().slice(0, 10));
      }
      const before = getConvictionList().length;
      for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        setRebuildProgress(`Rebuilding ${i + 1}/${dates.length} · ${d}`);
        try {
          const res = await fetch(`/api/v1/earnings/graded?date=${d}`, { cache: 'no-store' });
          if (!res.ok) continue;
          const j = await res.json();
          const bt = j?.by_tier || {};
          const syncEntries: any[] = [];
          for (const tier of ['BLOCKBUSTER', 'STRONG']) {  // ADD-only: skip MIXED/AVOID so nothing gets demoted
            for (const c of (bt[tier] || [])) {
              const qm = typeof c.quarter === 'string' ? c.quarter.match(/Q([1-4])/i) : null;
              const fm = typeof c.quarter === 'string' ? c.quarter.match(/FY\s?(\d{2})/i) : null;
              syncEntries.push({
                ticker: c.ticker, company: c.company, tier,
                composite_score: c.composite_score,
                sales_yoy_pct: c.sales_yoy_pct, net_profit_yoy_pct: c.net_profit_yoy_pct, eps_yoy_pct: c.eps_yoy_pct,
                filing_date: c.filing_date || d, sector: c.sector, market_cap_bucket: c.market_cap_bucket,
                market_cap_cr: typeof c.market_cap_cr === 'number' ? c.market_cap_cr : null,
                source_url: c.filing_url,
                ...(qm ? { quarter: ('Q' + qm[1]) as any } : {}),
                ...(fm ? { fiscal_year: resolveFyYear(parseInt(fm[1], 10)) } : {}),
                d1_pct: typeof c.d1_pct === 'number' ? c.d1_pct : null,
                gap_pct: typeof c.gap_pct === 'number' ? c.gap_pct : null,
                // zzz236 — carry d2_pct + move_pct from graded response into bench entry.
                // Previously dropped — that's why 2D chip stayed at ⏳ even after backend enrich shipped.
                d2_pct: typeof c.d2_pct === 'number' ? c.d2_pct : null,
                move_pct: typeof c.move_pct === 'number' ? c.move_pct : null,
                is_elite: c.is_elite === true,
                pead_score: typeof c.pead_score === 'number' ? c.pead_score : null,
                multibagger_setup: c.multibagger_setup === true,
                opm_pct: typeof c.opm_pct === 'number' ? c.opm_pct : null,
                opm_prev_pct: typeof c.opm_prev_pct === 'number' ? c.opm_prev_pct : null,
                // zzz242 — carry trailing P/E for valuation chip
                pe: typeof c.pe === 'number' ? c.pe : null,
              });
            }
          }
          if (syncEntries.length > 0) syncFromEarningsOps(syncEntries);
        } catch {}
        await new Promise((r) => setTimeout(r, 350));
      }
      const after = getConvictionList().length;
      setRebuildProgress(`\u2713 Done \u2014 ${Math.max(0, after - before)} entries restored from ${dates.length} trading days.`);
    } finally {
      setRebuilding(false);
      setTimeout(() => setRebuildProgress(null), 15_000);
    }
  }, [rebuilding]);
  const runRestoreBin = useCallback(() => {
    const n = restoreConvictionBin();
    setRebuildProgress(`\u21a9 Restored ${n} removed ${n === 1 ? 'entry' : 'entries'} from the recycle bin.`);
    setTimeout(() => setRebuildProgress(null), 10_000);
  }, []);
  // PATCH 0923 — collapsible Q1-Q4 cheat sheet visibility.
  // Default OPEN on first mount so the user understands the chips immediately.
  const [showQuarterCheatSheet, setShowQuarterCheatSheet] = useState(true);
  const toggle = <K extends keyof ConvFilters>(k: K, v: ConvFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: f[k] === v ? null : v } as ConvFilters));

  // PATCH 0539 — view-mode toggle (compact rows vs rich Earnings Hub cards)
  // PATCH 0546 — Default to COMPACT.
  // PATCH 0547 — Rich view dead-coded behind `false ?` because the per-ticker
  // enrichment fetch was unreliable for 200+ entries (counts stayed at 0).
  // PATCH 0549 — Returning users with the legacy `'rich'` value still in
  // `mc:conviction-view` localStorage were triggering the dead-fetch on
  // every page load — coerce to 'compact' and drop the key.
  const viewMode: 'compact' = 'compact';
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.removeItem('mc:conviction-view'); } catch {}
  }, []);
  // zzz247 — Card vs Table view toggle. Persisted in localStorage. Table view
  // shows sortable columns for institutional-analyst scanning of 42+ rows.
  const [tableMode, setTableMode] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { setTableMode(localStorage.getItem('mc:cb:table') === '1'); } catch {}
  }, []);
  const toggleTable = () => {
    setTableMode((v) => {
      const nv = !v;
      try { localStorage.setItem('mc:cb:table', nv ? '1' : '0'); } catch {}
      return nv;
    });
  };
  const [tableSort, setTableSort] = useState<{col: string; dir: 'asc'|'desc'}>({col: 'newinfo', dir: 'desc'});   // zzz887: rank by new information
  // zzz254 — density toggle: comfy (default) | compact | ultra
  const [density, setDensity] = useState<'comfy'|'compact'|'ultra'>('comfy');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const d = localStorage.getItem('mc:cb:density');
      if (d === 'compact' || d === 'ultra' || d === 'comfy') setDensity(d);
    } catch {}
  }, []);
  const cycleDensity = () => {
    const next = density === 'comfy' ? 'compact' : density === 'compact' ? 'ultra' : 'comfy';
    setDensity(next);
    try { localStorage.setItem('mc:cb:density', next); } catch {}
  };
  // zzz252 — expose entries + sector median P/E on window so ConvictionRow can
  // access peer stats without threading them through props. Rerun whenever the
  // entries list changes (add/remove/re-enrich). Moved out of JSX to avoid the
  // ternary syntax error that killed zzz251's build.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__cbAllEntries = entries;
    const bySec = new Map<string, number[]>();
    for (const e of entries) {
      const sec = resolveSector(e);
      if (sec && typeof (e as any).pe === 'number' && Number.isFinite((e as any).pe) && (e as any).pe > 0) {
        const arr = bySec.get(sec) || [];
        arr.push((e as any).pe);
        bySec.set(sec, arr);
      }
    }
    const medMap: Record<string, number> = {};
    for (const [sec, vals] of bySec) {
      if (vals.length < 2) continue;
      const s = [...vals].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      medMap[sec] = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    (window as any).__cbSectorPeMed = medMap;
  }, [entries]);

  // zzz250 — Full institutional Excel export. Uses SheetJS (already bundled).
  // Native .xlsx binary format — Mac Excel + Numbers + Windows Excel all open cleanly.
  // Includes freeze-header + auto-filter for immediate scan usability.
  // zzz253 — force re-enrichment: clear stale price fields for every entry, then
  // rely on the useEffect auto-enrich to re-fetch. Also invalidates the KV cache
  // by sending nocache=1 in the first fetch.
  const handleRefreshPrices = () => {
    if (typeof window === 'undefined') return;
    const list = getConvictionList();
    if (list.length === 0) { alert('No entries to refresh.'); return; }
    // Read current store, clear price fields for all entries, write back.
    try {
      const raw = localStorage.getItem('mc:conviction-beats:v1');
      const store: any = raw ? JSON.parse(raw) : {};
      let cleared = 0;
      for (const key of Object.keys(store)) {
        const e = store[key];
        if (!e) continue;
        // Clear only price-related fields, keep fundamentals intact
        delete e.move_pct;
        delete e.d2_pct;
        delete e.pe;
        cleared++;
      }
      localStorage.setItem('mc:conviction-beats:v1', JSON.stringify(store));
      alert(`Cleared ${cleared} entries. Reloading to trigger fresh enrichment...`);
      window.location.reload();
    } catch (e) { alert('Refresh failed: ' + String(e)); }
  };
  const handleExportFullExcel = async () => {
    if (typeof window === 'undefined') return;
    const list = filteredEntries;
    if (list.length === 0) { alert('No entries to export. Adjust filters.'); return; }
    const XLSX = await import('xlsx');
    const now = new Date();
    const daysSince = (iso?: string, added?: string) => {
      const s = added || iso;
      if (!s) return null;
      const t = Date.parse(s.length === 10 ? s + 'T09:30:00+05:30' : s);
      return Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 86400000)) : null;
    };
    const header = [
      '#','Tier','Ticker','Company','Filed Date','Days Since','Sector','Market Cap (Cr)',
      // zzz827 — words, not 0–100 numbers; neutral setup labels; same-year cash.
      'Grade strength','Post-results drift','Setup','Sales YoY %','PAT YoY %','EPS YoY %','OPM %','OPM prev %','OPM Δ (pp)',
      'Cash from operations ÷ profit (same year)','Current grade note',
      'P/E','Gap %','D1 %','D2 %','DRIFT %','Guidance','Guidance Score','Filing URL'
    ];
    const rows: any[][] = [header];
    list.forEach((e: any, i: number) => {
      const p = peadScore(e).score;
      const w = cbExportWords(e, cbComputeQuality(e).verdictLabel, p);
      const omP = e.opm_pct, omPr = e.opm_prev_pct;
      const opmD = (typeof omP === 'number' && typeof omPr === 'number') ? +(omP - omPr).toFixed(2) : '';
      rows.push([
        i + 1,
        e.tier || '',
        e.ticker || '',
        cbCompany(e),
        e.filing_date || '',
        daysSince(e.filing_date, e.added_at) ?? '',
        e.sector || '',
        typeof e.market_cap_cr === 'number' ? Math.round(e.market_cap_cr) : '',
        w.strength,
        w.drift,
        w.setup,
        typeof e.sales_yoy_pct === 'number' ? +e.sales_yoy_pct.toFixed(2) : '',
        typeof e.net_profit_yoy_pct === 'number' ? +e.net_profit_yoy_pct.toFixed(2) : '',
        typeof e.eps_yoy_pct === 'number' ? +e.eps_yoy_pct.toFixed(2) : '',
        typeof omP === 'number' ? +omP.toFixed(2) : '',
        typeof omPr === 'number' ? +omPr.toFixed(2) : '',
        opmD,
        w.cash,
        w.tierNow,
        typeof e.pe === 'number' ? +e.pe.toFixed(2) : '',
        typeof e.gap_pct === 'number' ? +e.gap_pct.toFixed(2) : '',
        typeof e.d1_pct === 'number' ? +e.d1_pct.toFixed(2) : '',
        typeof e.d2_pct === 'number' ? +e.d2_pct.toFixed(2) : '',
        typeof e.move_pct === 'number' ? +e.move_pct.toFixed(2) : '',
        e.guidance || '',
        typeof e.guidance_score === 'number' ? +e.guidance_score.toFixed(2) : '',
        e.source_url || '',
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      {wch:4},{wch:12},{wch:12},{wch:32},{wch:11},{wch:11},{wch:16},{wch:14},
      {wch:12},{wch:12},{wch:12},{wch:11},{wch:11},{wch:11},{wch:8},{wch:11},{wch:10},
      {wch:26},{wch:26},
      {wch:8},{wch:8},{wch:8},{wch:8},{wch:9},{wch:11},{wch:14},{wch:60}
    ];
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: {r:0,c:0}, e: {r:rows.length-1,c:header.length-1} }) };
    (ws as any)['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Conviction Beats');
    const fname = `conviction-beats_${now.toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fname);
  };
  // PATCH 0539 — Hub-Scan-style filter rail (rich view only)
  const [hubFilters, setHubFilters] = useState<HubFilters>(HUB_FILTER_DEFAULT);

  // PATCH 0539 — read watchlist + portfolio tickers for audience tagging.
  const [watchlistSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('mc_watchlist_tickers');
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set((Array.isArray(arr) ? arr : []).map((t: string) => String(t).toUpperCase()));
    } catch { return new Set(); }
  });
  // zzz823: "held" = the saved holdings (Portfolio page), never the old
  // 'mc_portfolio_tickers' / 'mc_portfolio_holdings_v1' lists this read before.
  const [portfolioSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(readLocalBookInput().browser); } catch { return new Set(); }
  });
  // zzz823: the saved-holdings book (server + this browser), resolved exactly
  // as Portfolio Catalysts resolves it — for the "same list" line below.
  const [savedBook, setSavedBook] = useState<BookName[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadIndiaBookInput().then((inp) => { if (!cancelled) setSavedBook(resolveIndiaBook(inp).names); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // zzz544 — compute the adaptive NEW window ONCE per render (synchronously)
  // before any passesConvictionFilter() call reads __NEW_WIN, so the filter, the
  // chip label, and every count-probe agree on the same effective window.
  setNewWindow(computeNewWindow(entries));

  // zzz823: pass / fail / NOT CHECKED — the shared check Portfolio
  // Catalysts uses. A name missing the data a criterion needs is shown and
  // labelled "not checked: … missing", never silently dropped as failing.
  const cbCheckOf = useMemo(() => {
    const m = new Map<ConvictionEntry, CriteriaCheck>();
    for (const e of entries) m.set(e, cbCriteriaCheck(e, filters));
    return m;
  }, [entries, filters]);
  const notChecked = entries.filter((e) => cbCheckOf.get(e)?.state === 'unknown');
  // zzz827 — "Why N names are hidden": per criterion and per name, from the
  // same probes the filter uses. Built only when the panel is opened.
  const [showHidden, setShowHidden] = useState(false);
  const hiddenReport = useMemo(() => (showHidden ? buildHiddenReport(entries, filters) : null), [showHidden, entries, filters]);
  const hiddenCount = useMemo(() => entries.filter((e) => cbCheckOf.get(e)?.state === 'fail').length, [entries, cbCheckOf]);
  const mktCapExcludedCount = useMemo(() => (filters.mktCapMin == null ? 0
    : entries.filter((e) => typeof (e as any).market_cap_cr === 'number' && (e as any).market_cap_cr < (filters.mktCapMin as number)).length), [entries, filters.mktCapMin]);
  // zzz827 — what this tab lists under its criteria, for Portfolio
  // Catalysts' name-for-name reconciliation (same browser).
  useEffect(() => {
    if (!entries.length) return;
    const tickers = Array.from(new Set(entries.filter((e) => cbCheckOf.get(e)?.state !== 'fail').map((e) => String(e.ticker || '').toUpperCase()))).sort();
    writeCbTabSnapshot({ tickers, savedCriteria: filtersMatchSaved(filters, readCbPresetOptOut()), at: new Date().toISOString() });
  }, [entries, filters, cbCheckOf]);
  // The same selection Portfolio Catalysts makes from this list.
  const pcSame = useMemo(() => {
    if (!savedBook) return null;
    // His saved choice (preset on, or switched off) — exactly what Portfolio Catalysts applies.
    const off = readCbPresetOptOut();
    const own = cbFiltersForOwner(off);
    return selectIndiaCb({ held: savedBook.map((n) => n.symbol), list: entries, criteriaOff: off, check: (e) => cbCriteriaCheck(e as ConvictionEntry, own) });
  }, [savedBook, entries]);

  // Apply filters + optional PEAD sort
  let filteredEntries = entries.filter((e) => cbCheckOf.get(e)?.state !== 'fail');
  if (filters.sortByPead) {
    filteredEntries = [...filteredEntries].sort((a, b) => peadScore(b).score - peadScore(a).score);
  }
  // zzz887: by default the bench is ranked by NEW INFORMATION (guidance change, acceleration, margin turn, cash, persistence), not by size of the beat
  if (!filters.sortByPead && !cheapStrong) {
    const ni = new Map(filteredEntries.map((e) => [e, newInfoScore(e as any).score] as const));
    filteredEntries = [...filteredEntries].sort((a, b) => (ni.get(b) ?? 0) - (ni.get(a) ?? 0));
  }
  // ── ADDITIVE zzzUP1 — "On Radar" narrows to transformation-screener names.
  if (onRadarOnly) {
    filteredEntries = filteredEntries.filter((e) => radarMap.has(String(e.ticker || '').toUpperCase()));
  }
  // ── ADDITIVE zzzUP2 — "Cheap + Strong": BLOCKBUSTER/STRONG with 0 < P/E ≤ 35,
  // cheapest first. Uses trailing_pe already on the entry (fallback to .pe which
  // enrich populates from the same trailing multiple). No new deps.
  if (cheapStrong) {
    const cbPeOf = (e: any): number => {
      const v = e?.trailing_pe ?? e?.pe;
      return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    };
    filteredEntries = filteredEntries
      .filter((e) => e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG')
      .filter((e) => { const p = cbPeOf(e); return p > 0 && p <= 35; })
      .sort((a, b) => cbPeOf(a) - cbPeOf(b));
  }
  const blockbusters = filteredEntries.filter((e) => e.tier === 'BLOCKBUSTER');
  const strongs = filteredEntries.filter((e) => e.tier === 'STRONG');
  const allTickers = filteredEntries.map((e) => e.ticker);

  // PATCH 0539 — fetch enriched cards for the bench (cached 24h).
  // PATCH 0549 — rich view dead-coded, so always pass [] to skip the fetch.
  // Hook still called (Rules of Hooks) but its effect short-circuits on
  // empty tickers.
  const tickersForFetch = useMemo(() => filteredEntries.map(e => e.ticker), [filteredEntries.map(e => e.ticker).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  void tickersForFetch;
  const { cards: enrichedCards, loading: richLoading } = useEnrichedConvictionCards([]);

  // Apply hub filter on top of the conviction-filtered list (memoized — was
  // recomputing on every render even when nothing changed).
  const enrichedList = useMemo(() => filteredEntries
    .map(e => enrichedCards[e.ticker.toUpperCase()])
    .filter((c): c is EarningsScanCard => Boolean(c)),
    [filteredEntries, enrichedCards]);
  const hubFilteredList = useMemo(() => enrichedList.filter(
    c => passesHubFilter(c, hubFilters, watchlistSet, portfolioSet)),
    [enrichedList, hubFilters, watchlistSet, portfolioSet]);

  // DRIFT → Book Watch. For every BLOCKBUSTER/STRONG bench name that has faded
  // materially since its print (cbDriftState), arm a BENCH_DRIFT flag so the
  // signal is pushed into Book Watch / the alert feed instead of only living on
  // this page. armBookFlag() self-dedups by kind+ticker+day and is a no-op
  // server-side, so this is safe to run on every bench/price change. Only
  // drifting BLOCKBUSTER/STRONG rows are armed — never every row.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    for (const e of entries) {
      const { drifting, movePct } = cbDriftState(e);
      if (!drifting || movePct == null) continue;
      const sym = e.ticker;
      armBookFlag({
        kind: 'BENCH_DRIFT', ticker: sym, company: e.company,
        severity: movePct <= -20 ? 'critical' : 'warning',
        message: `${sym} (${e.tier} bench) fading ${movePct.toFixed(1)}% since its print — the market is questioning the beat`,
        detail: 'conviction bench',
      });
    }
  }, [entries]);

  // PATCH 0540 — empty-state render AFTER all hooks (fixes Rules-of-Hooks
  // landmine if the bench transitions from empty → populated mid-render).
  if (entries.length === 0) {
    return (
      <div style={{
        padding: '40px 24px', textAlign: 'center',
        backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: 12,
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🏆</div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--mc-text-0)', margin: '0 0 6px' }}>
          Conviction Beats — empty
        </h3>
        <p style={{ fontSize: 12, color: 'var(--mc-text-3)', margin: '0 0 12px', lineHeight: 1.5 }}>
          This bench auto-fills with stocks that print BLOCKBUSTER or STRONG earnings in <strong style={{ color: 'var(--mc-cyan)' }}>/earnings-opportunities</strong>.
          <br />Visit that page after a day of filings; this list will populate automatically.
        </p>
        <a href="/earnings-opportunities" style={{
          display: 'inline-block', padding: '8px 16px',
          backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)',
          borderRadius: 6, color: 'var(--mc-warn)', fontSize: 12, fontWeight: 700,
          textDecoration: 'none',
        }}>Open Earnings Opportunities →</a>
        {/* zzz229 — recovery actions when the bench drained unexpectedly
            (browser storage eviction or rule-change demotions). */}
        <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => { if (window.confirm('Start a new earnings season? This rebuilds the bench from the last 10 days of results only.')) void runRebuild(10, true); }} disabled={rebuilding}
            title="Clear the bench and rebuild it from only the last 10 days of results (BLOCKBUSTER and STRONG only)."
            style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: rebuilding ? 'wait' : 'pointer',
              backgroundColor: 'color-mix(in srgb, var(--mc-warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 40%, transparent)', color: 'var(--mc-warn)',
            }}>
            🔁 {rebuilding ? 'Rebuilding…' : 'Rebuild last 10 days'}
          </button>
          <button onClick={() => void runRebuild(60, false)} disabled={rebuilding}
            title="Re-fetch server grading for the last 60 trading days and re-add every BLOCKBUSTER/STRONG print. Add-only: never deletes anything. Takes ~30s."
            style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: rebuilding ? 'wait' : 'pointer',
              backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 40%, transparent)', color: 'var(--mc-cyan)',
            }}>
            ♻ {rebuilding ? 'Rebuilding…' : 'Rebuild bench from last 60 days'}
          </button>
          {binCount > 0 && (
            <button onClick={runRestoreBin}
              title="Restore entries that were removed by demotion sync, the × button, or Clear All."
              style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 40%, transparent)', color: 'var(--mc-bullish)',
              }}>
              ↩ Restore removed ({binCount})
            </button>
          )}
        </div>
        {rebuildProgress && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--mc-cyan)', fontWeight: 600 }}>{rebuildProgress}</div>
        )}
      </div>
    );
  }

  // Counts for each candidate chip — applied INDEPENDENTLY to the
  // post-other-filters universe so the count reflects what the chip would
  // narrow TO when toggled on (preserves AND-composable semantics).
  const countWith = (k: keyof ConvFilters, v: number) => {
    const probe: ConvFilters = { ...filters, [k]: v } as ConvFilters;
    return entries.filter((e) => passesConvictionFilter(e, probe)).length;
  };

  // zzz362/zzz364 — verdict tally across the currently-loaded bench, for the
  // VERDICT multi-select chip counts. zzz364 FIX: this sits AFTER conditional
  // early-returns in the component, so it MUST NOT be a hook (useMemo here
  // caused React #310 "rendered more hooks than previous render"). Plain const
  // recomputed each render — cheap, same cost as countWith which also scans.
  const verdictCounts: Record<string, number> = (() => {
    const m: Record<string, number> = { 'STRONG BUY': 0, 'BUY': 0, 'WATCH': 0, 'AVOID': 0, 'HIGH RISK': 0 };
    for (const e of entries) {
      const { verdictLabel } = cbComputeQuality(e);
      if (m[verdictLabel] != null) m[verdictLabel]++;
    }
    return m;
  })();

  const chipBase: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, padding: '4px 9px', borderRadius: 14,
    cursor: 'pointer', border: '1px solid #2A3B4C', background: '#0A1422',
    color: '#8BA3C1', whiteSpace: 'nowrap',
  };
  const chipActive = (color: string): React.CSSProperties => ({
    ...chipBase,
    background: `${color}22`, borderColor: `${color}99`, color,
  });
  const renderChipGroup = (
    label: string, color: string, k: keyof ConvFilters,
    options: Array<{ v: number; lbl: string }>,
  ) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>{label}</span>
      {options.map((o) => {
        const active = filters[k] === o.v;
        const n = countWith(k, o.v);
        return (
          <button key={o.v} onClick={() => toggle(k, o.v as any)}
            style={active ? chipActive(color) : chipBase}>
            {o.lbl} <span style={{ color: active ? color : 'var(--mc-text-4)', marginLeft: 3 }}>({n})</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── ADDITIVE zzzUP3 — Regime strip. Thin market-breadth banner. Frames
          how aggressively to add given current breadth. Hidden on fetch fail. */}
      {regime && (() => {
        const c = regime.composite;
        const framing = c >= 60 ? 'aggressive add' : c >= 40 ? 'selective' : 'defensive — trim weak names';
        return (
          <div style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px',
            padding: '6px 12px', fontSize: 11.5, lineHeight: 1.4,
            backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)',
            borderLeft: `3px solid ${regime.regime_color}`, borderRadius: 8,
          }}
            title={regime.regime_desc || `Market breadth composite ${c}/100`}>
            <span style={{ fontWeight: 800, color: regime.regime_color, letterSpacing: '0.3px' }}>
              {regime.regime || 'REGIME'}
            </span>
            <span style={{ color: 'var(--mc-text-4)' }}>·</span>
            <span style={{ color: 'var(--mc-text-2)' }}>breadth <strong style={{ color: 'var(--mc-text-1)' }}>{c}</strong>/100</span>
            <span style={{ color: 'var(--mc-text-4)' }}>·</span>
            <span style={{ color: 'var(--mc-text-2)' }}>suggested cash <strong style={{ color: 'var(--mc-text-1)' }}>{regime.suggested_cash_pct}%</strong></span>
            <span style={{ color: 'var(--mc-text-4)' }}>·</span>
            <span style={{ fontWeight: 700, color: regime.regime_color }}>{framing}</span>
          </div>
        );
      })()}
      {/* USER-REQ — composable filter chips (Op-leverage / Sales / PAT / EPS YoY)
          + PEAD sort toggle. Renders at TOP of the Conviction Beats tab. */}
      <div style={{
        padding: '10px 14px', backgroundColor: 'var(--mc-bg-0)',
        border: '1px solid var(--mc-bg-4)', borderRadius: 8,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-1)', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>FILTERS</span>
            <span style={{ color: 'var(--mc-text-4)', fontWeight: 600 }}>· {filteredEntries.length} of {entries.length}</span>
            {notChecked.length > 0 && (
              <span data-testid="cb-not-checked" title={notChecked.map((e) => `${e.ticker}: ${notCheckedText(cbCheckOf.get(e)?.missing || [])}`).join('\n')}
                style={{ color: 'var(--mc-text-3)', fontWeight: 700, cursor: 'help' }}>
                · incl. {notChecked.length} not checked (a figure is missing — shown, not failed)
              </span>
            )}
            {hiddenCount > 0 && (
              <button data-testid="cb-why-hidden" onClick={() => setShowHidden((v) => !v)}
                title="Open the list of names your criteria hide, with the exact figure each one misses by."
                style={{ fontSize: 10.5, fontWeight: 800, padding: '1px 8px', borderRadius: 10, cursor: 'pointer', border: '1px solid var(--mc-bg-4)', background: 'transparent', color: 'var(--mc-text-2)' }}>
                {showHidden ? '▾' : '▸'} Why {hiddenCount} name{hiddenCount === 1 ? ' is' : 's are'} hidden
              </button>
            )}
            {pcSame && (
              <span data-testid="cb-same-as-pc" style={{ color: 'var(--mc-text-3)', fontWeight: 700 }}
                title="Portfolio Catalysts selects its bench from this same list with this same check: names you hold appear there once, in My book; the rest are its bench.">
                · under your saved criteria {pcSame.passing.length} = {pcSame.heldPassing.length} you hold (Portfolio Catalysts: My book) + {pcSame.bench.length} (its bench){isIndiaPresetActive(filters) ? '' : ' — your chips here differ from your saved criteria'}
              </span>
            )}
            {/* Always-visible DRIFT summary — count of BLOCKBUSTER/STRONG bench
                names fading <= -12% since their print. Independent of any filter
                toggle; also armed to Book Watch as BENCH_DRIFT. */}
            {(() => {
              const n = entries.filter((e) => cbDriftState(e).drifting).length;
              if (n === 0) return null;
              return (
                <span
                  title="BLOCKBUSTER/STRONG bench names fading ≤ -12% since their print — the earliest sell tell. Each is armed to Book Watch as a BENCH_DRIFT flag."
                  style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, cursor: 'help',
                    background: 'rgba(239,68,68,0.12)', color: '#F87171', border: '1px solid rgba(239,68,68,0.4)',
                  }}
                >⚠ {n} bench drifting</span>
              );
            })()}
            {/* PATCH 0919 — Safety-net "0 results" hint. When the bench is
                non-empty but no entries pass the filter, surface a prominent
                Reset button so the user isn't stuck wondering which chip is
                hiding the data. */}
            {filteredEntries.length === 0 && entries.length > 0 && (
              <button
                onClick={() => setFilters(FILTER_DEFAULT)}
                title="Resets every filter (Sales/PAT/EPS/OP-Lev/PEAD/Guidance/Quarter/FY/date range)"
                style={{
                  padding: '3px 9px', fontSize: 10, fontWeight: 800,
                  background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 50%, transparent)',
                  color: 'var(--mc-warn)', borderRadius: 4, cursor: 'pointer',
                }}
              >⚠ 0 match — Reset all filters</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setFilters((f) => ({ ...f, sortByPead: !f.sortByPead }))}
              style={filters.sortByPead ? chipActive('#22D3EE') : chipBase}>
              🌊 Sort by PEAD {filters.sortByPead ? '✓' : ''}
            </button>
            {/* zzz247 — Table view toggle for institutional scanning */}
            <button onClick={toggleTable} title="Toggle between Card and Table view. Table view supports sortable columns."
              style={tableMode ? chipActive('#F59E0B') : chipBase}>
              {tableMode ? '📇 Card view' : '📊 Table view'}
            </button>
            {/* zzz250 — Full institutional Excel export. Every column, native .xlsx (Mac-safe). */}
            <button onClick={handleExportFullExcel} title="Download all filtered entries with every column (Sales/PAT/EPS/OPM/P/E/D1/D2/DRIFT/MktCap/Sector/Composite/PEAD/Days-Since/Guidance) as native .xlsx. Opens in Excel/Numbers on Mac + Windows."
              style={{ ...chipBase, border: '1px solid #10B981', color: '#10B981', fontWeight: 800 }}>
              📥 Excel (Full)
            </button>
            {/* zzz253 — force re-enrichment. Clears stale price fields + re-fetches. */}
            <button onClick={handleRefreshPrices} title="Force re-fetch of all price data (D1/D2/DRIFT/P/E) for every bench entry. Use when data feels stale — typically after market close."
              style={{ ...chipBase, border: '1px solid #22D3EE', color: '#22D3EE', fontWeight: 800 }}>
              🔄 Refresh Prices
            </button>
            {(() => {
              const busy = !!fillProgress && !fillProgress.startsWith('✓') && !fillProgress.startsWith('⏳');
              return (
                <button onClick={() => runEnrichWalk(true)}
                  title="Fill whatever is missing on the cards — Q-TRENDS (OPM / Other-Income / Tax / CFO-PAT annual), QoQ ACCEL, P/E, DRIFT, ROCE. Only touches entries that lack data; entries that already have it are left alone. Forces a fresh Screener scrape (bypasses cache)."
                  style={busy
                    ? { ...chipActive('#A78BFA'), fontWeight: 800 }
                    : { ...chipBase, border: '1px solid #A78BFA', color: '#A78BFA', fontWeight: 700 }}>
                  {busy ? '⟳ Filling…' : '⟳ Fill missing (trends · P/E · DRIFT)'}
                </button>
              );
            })()}
            {/* zzz254 — density toggle */}
            <button onClick={cycleDensity} title="Cycle card density: Comfy (default) → Compact → Ultra-compact. Persists across visits."
              style={{ ...chipBase, border: '1px solid #A78BFA', color: '#A78BFA', fontWeight: 800 }}>
              {density === 'comfy' ? '🔳 Comfy' : density === 'compact' ? '▦ Compact' : '▬ Ultra'}
            </button>
            {/* PATCH 1018 — ELITE / MULTIBAGGER filter chips */}
            <button onClick={() => setFilters((f) => ({ ...f, elite: !f.elite }))}
              style={filters.elite ? chipActive('#FCD34D') : chipBase}>
              ⭐ ELITE only {filters.elite ? '✓' : ''}
            </button>
            <button onClick={() => setFilters((f) => ({ ...f, multibagger: !f.multibagger }))}
              style={filters.multibagger ? chipActive('#67E8F9') : chipBase}>
              💎 MULTIBAGGER only {filters.multibagger ? '✓' : ''}
            </button>
            {/* zzz540 — new-in-last-10-days filter; the sectioned TradingView copy below then exports ONLY these, grouped by tier */}
            <button onClick={() => setFilters((f) => ({ ...f, newOnly: !f.newOnly }))}
              title={__NEW_WIN.widened
                ? `No results filed in the last 10 days (between earnings seasons), so this is showing the freshest cohort available: results filed within ${__NEW_WIN.days} days (${__NEW_WIN.count} names). Copy → TradingView copies just these, grouped ###ELITE / ###BLOCKBUSTER / ###STRONG. Bypasses the quality preset.`
                : `Companies whose latest RESULT (filing) date is within the last 10 days — the just-reported cohort. Copy → TradingView copies just these, grouped ###ELITE / ###BLOCKBUSTER / ###STRONG. Bypasses the quality preset.`}
              style={filters.newOnly ? chipActive('#34D399') : chipBase}>
              {/* zzz544 — label reflects the ACTUAL window used: "10d" normally, "10d→Nd" when auto-widened off-season */}
              🆕 NEW · {__NEW_WIN.widened ? `10d→${__NEW_WIN.days}d` : '10d'} {filters.newOnly ? '✓' : ''}
            </button>
            {/* ── ADDITIVE zzzUP1 — On Radar toggle (transformation screener overlay) */}
            <button onClick={() => setOnRadarOnly((v) => !v)}
              title="Show only bench names that also appear on the concall transformation screener (last 60 days). These carry a 🚀 Radar badge on their card."
              style={onRadarOnly ? chipActive('#10B981') : chipBase}>
              🚀 On Radar {onRadarOnly ? '✓' : ''}
              {radarMap.size > 0 && <span style={{ color: onRadarOnly ? '#10B981' : 'var(--mc-text-4)', marginLeft: 3 }}>({radarMap.size})</span>}
            </button>
            {/* ── ADDITIVE zzzUP2 — Cheap + Strong valuation view */}
            <button onClick={() => setCheapStrong((v) => !v)}
              title="Show BLOCKBUSTER/STRONG names with a positive trailing P/E ≤ 35, sorted cheapest-first. Uses the trailing P/E already on each card."
              style={cheapStrong ? chipActive('#FBBF24') : chipBase}>
              💰 Cheap + Strong {cheapStrong ? '✓' : ''}
            </button>
            {/* PATCH 1022 — market-cap range filter */}
            <select
              value={filters.cap}
              onChange={(e) => setFilters((f) => ({ ...f, cap: e.target.value as ConvFilters['cap'] }))}
              title="Filter by market cap (₹ Cr)"
              style={filters.cap !== 'all'
                ? { ...chipActive('#34D399'), cursor: 'pointer' }
                : { ...chipBase, cursor: 'pointer' }}>
              <option value="all">🏦 Mkt Cap · All</option>
              <option value="sweet">🎯 Multibagger ₹5k–50k Cr</option>
              <option value="mega">MEGA ≥ ₹2,00,000 Cr</option>
              <option value="large">LARGE ₹20k–2L Cr</option>
              <option value="mid">MID ₹5k–20k Cr</option>
              <option value="small">SMALL ₹500–5k Cr</option>
              <option value="micro">MICRO &lt; ₹500 Cr</option>
            </select>
            {/* zzz229 — Rebuild from history (add-only) + recycle-bin restore */}
            <button onClick={() => void runRebuild(60, false)} disabled={rebuilding}
              title="Re-fetch server grading for the last 60 trading days and re-add every BLOCKBUSTER/STRONG print that's missing from the bench. Add-only — never deletes."
              style={{ ...(rebuilding ? chipActive('var(--mc-cyan)') : chipBase), cursor: rebuilding ? 'wait' : 'pointer' }}>
              ♻ {rebuilding ? 'Rebuilding…' : 'Rebuild 60d'}
            </button>
            {binCount > 0 && (
              <button onClick={runRestoreBin}
                title="Restore entries removed by demotion sync, the × button, or Clear All."
                style={{ ...chipBase, cursor: 'pointer' }}>
                ↩ Restore ({binCount})
              </button>
            )}
            {/* PATCH 1019 — Re-validate bench (prune stocks no longer BB/ST) */}
            <button onClick={runRevalidate} disabled={revalidating}
              title="Re-read the current grading for every filing date on the bench and bring each name's tier and figures up to date. A name the current rules put below STRONG stays on the bench, labelled 'now MIXED under current rules' — remove it with × if you want it gone. Runs by itself when the grading version changes. About a second per date."
              style={{ ...(revalidating ? chipActive('var(--mc-state-persistent)') : chipBase), cursor: revalidating ? 'wait' : 'pointer' }}>
              🔄 {revalidating ? 'Re-validating…' : 'Re-validate bench'}
            </button>
            {/* PATCH zzz99 — bulk Clear All button for Conviction Beats.
                Placed next to Re-validate bench so the two whole-bench
                actions live together. Disabled when the bench is empty
                or no clear handler is wired (panel can still be reused
                in a read-only context). window.confirm gates the wipe
                because it's irreversible — there is no undo for the LS
                write, and an accidental wipe of 100+ entries would force
                the user to wait for next earnings to re-populate. */}
            {onClearAll && (
              <button
                onClick={() => {
                  if (entries.length === 0) return;
                  const ok = window.confirm(`Clear all ${entries.length} conviction beats? This cannot be undone.`);
                  if (ok) onClearAll();
                }}
                disabled={entries.length === 0}
                title={entries.length === 0
                  ? 'Bench is already empty.'
                  : `Wipe all ${entries.length} conviction beats from the bench. Use this when starting fresh for the next earnings cycle. Cannot be undone — the bench will re-populate as new BLOCKBUSTER/STRONG prints come in.`}
                style={{
                  ...(entries.length === 0 ? chipBase : chipActive('var(--mc-bearish, #EF4444)')),
                  cursor: entries.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: entries.length === 0 ? 0.4 : 1,
                }}>
                🗑 Clear All ({entries.length})
              </button>
            )}
            {onRebuild && (
              <button
                onClick={() => {
                  if (rebuilding) return;
                  if (window.confirm('Start a new earnings season? This clears the bench and rebuilds it from the last 10 days of results only. Older names will not come back.')) void runRebuild(10, true);
                }}
                disabled={!!rebuilding}
                title="Clear the bench, then rebuild it from only the last 10 days of results (BLOCKBUSTER and STRONG only). Older names are not added back."
                style={{ ...chipActive('var(--mc-state-persistent)'), cursor: rebuilding ? 'wait' : 'pointer' }}>
                🔁 {rebuilding ? 'Rebuilding…' : 'Rebuild last 10 days'}
              </button>
            )}
            {benchSince && (
              <span style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 4, border: '1px solid #cbd5e1', color: '#334155', fontWeight: 600 }}>
                Showing results filed from {benchSince}
                {onShowAll && <button onClick={onShowAll} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 10.5, textDecoration: 'underline' }}>show all</button>}
              </span>
            )}
            {fillProgress && (
              <span style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 4, background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.35)', color: '#A78BFA', fontWeight: 600 }}>{fillProgress}</span>
            )}
            {revalProgress && (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                backgroundColor: revalProgress.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)' : 'color-mix(in srgb, var(--mc-state-persistent) 9%, transparent)',
                border: `1px solid ${revalProgress.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)'}`,
                color: revalProgress.startsWith('✓') ? 'var(--mc-bullish)' : 'var(--mc-state-persistent)',
              }}>{revalProgress}</span>
            )}
            {/* zzz229 - rebuild/restore progress chip (mirrors revalProgress styling) */}
            {rebuildProgress && (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                backgroundColor: rebuildProgress.startsWith('\u2713') || rebuildProgress.startsWith('\u21a9') ? 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 9%, transparent)',
                border: `1px solid ${rebuildProgress.startsWith('\u2713') || rebuildProgress.startsWith('\u21a9') ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)'}`,
                color: rebuildProgress.startsWith('\u2713') || rebuildProgress.startsWith('\u21a9') ? 'var(--mc-bullish)' : 'var(--mc-cyan)',
              }}>{rebuildProgress}</span>
            )}
            <button onClick={() => setFilters(FILTER_DEFAULT)}
              disabled={filters.opLev == null && filters.sales == null && filters.pat == null && filters.eps == null && filters.pead == null && filters.guidance == null && filters.quarter == null && filters.fy == null && filters.fromDate == null && filters.toDate == null && filters.d1Bucket == null && filters.d2Bucket == null && filters.driftBucket == null && filters.opmDelta == null && filters.score == null && filters.opmMin == null && !filters.sortByPead && !filters.elite && !filters.multibagger && filters.cap === 'all'}
              style={{ ...chipBase, opacity: (filters.opLev == null && filters.sales == null && filters.pat == null && filters.eps == null && filters.pead == null && filters.guidance == null && filters.quarter == null && filters.fy == null && filters.fromDate == null && filters.toDate == null && filters.d1Bucket == null && filters.d2Bucket == null && filters.driftBucket == null && filters.opmDelta == null && filters.score == null && filters.opmMin == null && !filters.sortByPead) ? 0.4 : 1 }}>
              Clear
            </button>
          </div>
        </div>
        {/* zzz827 — WHY N NAMES ARE HIDDEN. Collapsed by default. Per criterion
            (a name can miss several), then per name with the figure against
            the threshold, then the names shown but not checked. */}
        {showHidden && hiddenReport && (
          <div data-testid="cb-hidden-panel" style={{ padding: '8px 10px', border: '1px dashed var(--mc-bg-4)', borderRadius: 6, fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5, maxHeight: 420, overflow: 'auto' }}>
            <div style={{ fontWeight: 800, color: 'var(--mc-text-1)' }}>{hiddenReportLine(hiddenReport)}</div>
            {hiddenReport.byCriterion.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0' }}>
                {hiddenReport.byCriterion.map((c) => (
                  <span key={c.key} style={{ padding: '1px 7px', borderRadius: 10, border: '1px solid var(--mc-bg-4)' }}>{c.name}: <b>{c.count}</b></span>
                ))}
              </div>
            )}
            {hiddenReport.names.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontWeight: 700, color: 'var(--mc-text-3)' }}>Hidden names — each with what it misses</div>
                {hiddenReport.names.map((n) => (
                  <div key={n.ticker}><b style={{ fontFamily: 'ui-monospace, monospace' }}>{n.ticker}</b> <span style={{ color: 'var(--mc-text-3)' }}>{n.company}</span> — {n.fails.join(' · ')}{n.notChecked.length ? <span style={{ color: 'var(--mc-text-4)' }}> · also not checked: {n.notChecked.join(' · ')}</span> : null}</div>
                ))}
              </div>
            )}
            {hiddenReport.notChecked.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 700, color: 'var(--mc-text-3)' }}>Shown but not checked ({hiddenReport.notChecked.length}) — a figure is missing, so the name stays on the list</div>
                {hiddenReport.notChecked.map((n) => (
                  <div key={n.ticker}><b style={{ fontFamily: 'ui-monospace, monospace' }}>{n.ticker}</b> <span style={{ color: 'var(--mc-text-3)' }}>{n.company}</span> — {notCheckedText(n.missing)}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* zzz226 — ⚡ QUALITY PRESET: one click applies PAT≥30 · EPS≥40 ·
            OPM Δ≥0 · Composite≥65 · D1≥0. Click again to clear. Detail chips
            below stay collapsed unless expanded. */}
        {(() => {
          // zzz309 → zzz319 → zzz330 — Quality Preset v5: Sales≥20 · EPS≥25 · PEAD≥40 · OPM Δ ≥0 · CFO/PAT ≥0.5.
          // zzz659 — PEAD 60 -> 40 across every preset. PEAD is a drift proxy
          // (35% of it is the one-day reaction), not a quality score, so a gate
          // at 60 silently excluded good quarters the market sold on the day.
          // zzz672 — the test lives with the values it tests (see INDIA_PRESET).
          const presetActive = isIndiaPresetActive(filters);
          const OPT_OUT_KEY = CB_PRESET_OPTOUT_KEY;
          const handleToggle = () => {
            setFilters((prev) => {
              if (presetActive) {
                try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch {}
                return { ...FILTER_DEFAULT, cap: prev.cap };
              } else {
                try { localStorage.removeItem(OPT_OUT_KEY); } catch {}
                return { ...FILTER_DEFAULT, cap: prev.cap, ...indiaPresetFilters() };
              }
            });
          };
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={handleToggle}
                title="Your saved screen: sales growth at least 20% · EPS growth at least 25% · PEAD (post-results drift) 40 or more · operating margin not falling · operating margin 0% or more (unknown passes) · cash from operations at least half of profit (same fiscal year; not checked when the figure is missing; skipped for lenders) · market cap at least ₹3,000 Cr (your setting) · no promoter pledge (an unknown pledge is not a fail) · setup Top / Good / Watch. A missing figure is 'not checked', never a fail. Auto-applied on first visit; click to switch it off (remembered) or on again."
                style={presetActive
                  ? chipActive('#F59E0B')
                  : { ...chipBase, border: '1px solid #F59E0B', color: '#F59E0B', fontWeight: 800 }}>
                ⚡ QUALITY PRESET · {presetBarText(presetActive ? (filters.mktCapMin as number | null) : 3000)} {presetActive ? '✓ ON' : '· OFF — click to enable'}
              </button>
              {/* zzz879 — the preset's size floor: ₹3k Cr (default), ₹500 Cr, or any size. Remembered. */}
              {presetActive && (
                <span data-testid="cb-cap-floor" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
                  title="Smallest company size the preset shows. ₹500 Cr or Any size brings in the small caps a ₹3k Cr floor hides (HIIL is about ₹1,140 Cr). Your choice is remembered and Portfolio Catalysts uses it too.">
                  <span style={{ fontSize: 10.5, color: 'var(--mc-text-3)', fontWeight: 700 }}>Size:</span>
                  {CB_CAP_FLOORS.map((o) => (
                    <button key={String(o.v)} onClick={() => {
                      try { localStorage.setItem(CB_PRESET_CAP_KEY, cbCapFloorRaw(o.v as CbCapFloor)); } catch {}
                      setFilters((prev) => ({ ...prev, mktCapMin: o.v }));
                    }} style={filters.mktCapMin === o.v ? chipActive('#F59E0B') : chipBase}>{o.label}</button>
                  ))}
                </span>
              )}
              {filters.mktCapMin != null && (
                <span data-testid="cb-mktcap-excluded" style={{ fontSize: 10.5, color: 'var(--mc-text-3)', fontWeight: 700 }}
                  title="Market cap is your own setting. This is how many names on the list sit below it (a name with no market cap figure is 'not checked', not excluded).">
                  · market cap ≥₹{Number(filters.mktCapMin).toLocaleString('en-IN')} Cr excludes {mktCapExcludedCount}
                </span>
              )}
              <button onClick={() => setShowAdvFilters((v) => !v)} style={chipBase}>
                {showAdvFilters ? '▴ Hide detail filters' : '▾ Show detail filters'}
              </button>
            </div>
          );
        })()}
        {showAdvFilters && (<>
        {renderChipGroup('OP-LEV (PAT/Sales)', '#A78BFA', 'opLev', [
          { v: 1.5, lbl: '≥1.5×' }, { v: 2, lbl: '≥2×' }, { v: 3, lbl: '≥3×' },
        ])}
        {renderChipGroup('SALES YoY', '#22D3EE', 'sales', [
          { v: 20, lbl: '≥20%' }, { v: 25, lbl: '≥25%' }, { v: 30, lbl: '≥30%' }, { v: 40, lbl: '≥40%' }, { v: 50, lbl: '≥50%' },
        ])}
        {renderChipGroup('PAT YoY', '#10B981', 'pat', [
          { v: 20, lbl: '≥20%' }, { v: 30, lbl: '≥30%' }, { v: 40, lbl: '≥40%' },
          { v: 50, lbl: '≥50%' }, { v: 60, lbl: '≥60%' }, { v: 100, lbl: '≥100%' },
        ])}
        {renderChipGroup('EPS YoY', '#F59E0B', 'eps', [
          { v: 20, lbl: '≥20%' }, { v: 25, lbl: '≥25%' }, { v: 40, lbl: '≥40%' }, { v: 60, lbl: '≥60%' },
        ])}
        {/* zzz223 — OPM margin Δ chips (pp YoY) — mirrors the EO margin signal */}
        {renderChipGroup('OPM Δ (pp YoY)', '#F472B6', 'opmDelta', [
          { v: 0, lbl: '📈 Expanding ≥0' }, { v: 2, lbl: '≥+2pp' }, { v: 5, lbl: '≥+5pp' }, { v: -2, lbl: '📉 Squeeze ≤-2pp' },
        ])}
        {/* zzz226e — absolute OPM level chips (latest quarter %) */}
        {renderChipGroup('OPM LEVEL', '#F472B6', 'opmMin', [
          { v: 0, lbl: '≥0%' }, { v: 10, lbl: '≥10%' }, { v: 12, lbl: '≥12%' }, { v: 15, lbl: '≥15%' }, { v: 20, lbl: '≥20%' },
        ])}
        {/* zzz304 — CFO/PAT minimum ratio chips (earnings quality: cash conversion). */}
        {renderChipGroup('CFO/PAT MIN', '#34D399', 'cfoPatMin' as any, [
          { v: 0.5, lbl: '≥0.5' }, { v: 0.7, lbl: '≥0.7' }, { v: 0.8, lbl: '≥0.8' }, { v: 1.0, lbl: '≥1.0' },
        ])}
        {/* zzz360 — promoter-pledge MAX chips. 0 = only unpledged names (governance
            clean). Null pledged_pct passes the gate so unknowns aren't dropped. */}
        {renderChipGroup('PLEDGED MAX', '#EF4444', 'pledgedMax' as any, [
          { v: 0, lbl: '0%' }, { v: 1, lbl: '≤1%' }, { v: 5, lbl: '≤5%' },
        ])}
        {/* zzz362 — VERDICT multi-select filter. Toggles membership in
            filters.verdicts. Count = currently-loaded bench entries whose
            cbComputeQuality verdict == that label. Custom row (not renderChipGroup)
            because the value is an array, not a scalar. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>SETUP</span>
          {([
            { label: 'STRONG BUY', color: '#22C55E' },
            { label: 'BUY', color: '#84CC16' },
            { label: 'WATCH', color: '#F59E0B' },
            { label: 'AVOID', color: '#EF4444' },
            { label: 'HIGH RISK', color: '#EF4444' },
          ] as Array<{ label: string; color: string }>).map((o) => {
            const active = (filters.verdicts || []).includes(o.label);
            const n = verdictCounts[o.label] || 0;
            return (
              <button key={o.label}
                onClick={() => setFilters((prev) => {
                  const cur = prev.verdicts || [];
                  const next = cur.includes(o.label) ? cur.filter((x) => x !== o.label) : [...cur, o.label];
                  return { ...prev, verdicts: next.length ? next : null };
                })}
                style={active ? chipActive(o.color) : chipBase}>
                {cbVerdictLabel(o.label) /* zzz827 — the key stays in the filter; only the label shows */} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n})</span>
              </button>
            );
          })}
        </div>
        {/* zzz348 - market cap min chips */}
        {renderChipGroup('MKT CAP MIN', '#F59E0B', 'mktCapMin' as any, [
          { v: 500, lbl: '≥₹500 Cr' }, { v: 1000, lbl: '≥₹1k Cr' }, { v: 3000, lbl: '≥₹3k Cr' }, { v: 5000, lbl: '≥₹5k Cr' }, { v: 10000, lbl: '≥₹10k Cr' },
        ])}
        {/* zzz329 — Max trailing P/E chips. Excludes negative-earnings names automatically. */}
        {renderChipGroup('P/E MAX', '#A78BFA', 'peMax' as any, [
          { v: 15, lbl: '≤15' }, { v: 20, lbl: '≤20' }, { v: 30, lbl: '≤30' }, { v: 50, lbl: '≤50' }, { v: 80, lbl: '≤80' },
        ])}
        {/* zzz332 FRESH 3D bypass toggle */}
        <button onClick={() => setFilters(prev => ({ ...prev, freshBypass: !prev.freshBypass }))} title="When ON, entries filed within last 3 business days ALWAYS show regardless of preset gates (Sales/EPS/PEAD/OPM/CFO-PAT). Off by default so preset applies uniformly." style={{ padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: filters.freshBypass ? '#F59E0B22' : 'transparent', border: '1px solid ' + (filters.freshBypass ? '#F59E0B' : '#334155'), color: filters.freshBypass ? '#F59E0B' : '#94A3B8', fontSize: 11, fontWeight: 700, letterSpacing: '0.5px' }}>{filters.freshBypass ? '✓ 🆕 FRESH 3D' : '🆕 FRESH 3D'}</button>
        {/* zzz225 — composite tier score chips (the big number on each card) */}
        {/* zzz827 — words, not the 0–100 number */}
        {renderChipGroup('GRADE STRENGTH', '#FBBF24', 'score', [
          { v: 60, lbl: 'fair or better' }, { v: 70, lbl: 'high or better' }, { v: 80, lbl: 'very high' },
        ])}
        {/* USER-REQ — PEAD score threshold filter (composable with all others) */}
        {renderChipGroup('POST-RESULTS DRIFT', '#22D3EE', 'pead', [
          { v: 40, lbl: 'PEAD 40 or more' }, { v: 70, lbl: 'PEAD 70 or more' },
        ])}
        {/* PATCH 0945 — 1D CLOSE filter chips, matching the /earnings Hub UX.
            Composes AND with every other filter above. Signed threshold:
            positive = "D1 close ≥ N%", negative = "D1 close ≤ N%".

            PATCH 0965 BUG #8 — Counts always showed (0). Root cause: the
            chip count was computed inline on every render, but if entries
            had not yet been hydrated with d1_pct values (graded sync still
            pending) the predicate `Number.isFinite(d1)` returned false for
            every row → count 0. Two fixes:
              1. Memoize the counts so they only recompute when entries /
                 filters actually change (avoids redundant filter passes).
              2. Pre-compute `hasAnyD1` from entries; while it is FALSE,
                 render '…' instead of '(0)' so the user understands the
                 chip is waiting on data rather than mis-reading it as
                 "zero matches". The chip remains clickable for when data
                 arrives.
            The count predicate intentionally reuses `passesConvictionFilter`
            so it can never drift from the actual row-level filter. */}
        {(() => {
          const toggleD1 = (v: number) =>
            setFilters((f) => ({ ...f, d1Bucket: f.d1Bucket === v ? null : v }));
          const opts: Array<{ v: number; lbl: string; color: string }> = [
            // zzz226b — ≥0% chip so the QUALITY PRESET's D1≥0 is visible/toggleable
            { v: 0,  lbl: '≥0%',   color: '#10B981' },
            { v: 2,  lbl: '≥+2%',  color: '#10B981' },
            { v: 4,  lbl: '≥+4%',  color: '#10B981' },
            { v: 7,  lbl: '≥+7%',  color: '#10B981' },
            { v: 10, lbl: '≥+10%', color: '#10B981' },
            { v: -2, lbl: '≤-2%',  color: '#EF4444' },
            { v: -5, lbl: '≤-5%',  color: '#EF4444' },
          ];
          // PATCH 0965 BUG #8 — gate the (N) label on whether ANY entry
          // has a usable d1_pct. We compute this once per render rather
          // than per chip.
          const hasAnyD1 = entries.some(
            (e) => typeof (e as any).d1_pct === 'number' && Number.isFinite((e as any).d1_pct),
          );
          const countD1 = (v: number) => {
            const probe: ConvFilters = { ...filters, d1Bucket: v };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>1D CLOSE</span>
              {opts.map((o) => {
                const active = filters.d1Bucket === o.v;
                const n = hasAnyD1 ? countD1(o.v) : null;
                return (
                  <button key={o.v} onClick={() => toggleD1(o.v)}
                    title={hasAnyD1 ? `Filter to entries with D1 close ${o.lbl}` : 'Awaiting D1 close enrichment — entries do not yet have d1_pct populated. Counts will fill in once /earnings-opportunities syncs prices.'}
                    style={active ? chipActive(o.color) : chipBase}>
                    {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n === null ? '…' : n})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
        {/* zzz229 — 2D CLOSE filter. d2_pct = cumulative % over 2 TRADING
            sessions (skips weekends). If today is Monday, 2D covers Fri close
            → Mon close. Users can compose {1D≥0} AND {2D≥+2%} to require
            day-2 follow-through. Backend populates d2_pct via graded pipeline. */}
        {(() => {
          const toggleD2 = (v: number) =>
            setFilters((f) => ({ ...f, d2Bucket: f.d2Bucket === v ? null : v }));
          const opts: Array<{ v: number; lbl: string; color: string }> = [
            { v: 0,  lbl: '≥0%',   color: '#10B981' },
            { v: 2,  lbl: '≥+2%',  color: '#10B981' },
            { v: 4,  lbl: '≥+4%',  color: '#10B981' },
            { v: 7,  lbl: '≥+7%',  color: '#10B981' },
            { v: 10, lbl: '≥+10%', color: '#10B981' },
            { v: -2, lbl: '≤-2%',  color: '#EF4444' },
            { v: -5, lbl: '≤-5%',  color: '#EF4444' },
          ];
          // zzz229b — accept fallback (move_pct / d1+gap compound / d1 alone) so
          // chip counts populate even before backend ships d2_pct.
          const hasAnyD2 = entries.some((e) => getD2Pct(e) != null);
          const countD2 = (v: number) => {
            const probe: ConvFilters = { ...filters, d2Bucket: v };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>2D CLOSE</span>
              {opts.map((o) => {
                const active = filters.d2Bucket === o.v;
                const n = hasAnyD2 ? countD2(o.v) : null;
                // zzz234 — Disable clicks when no d2/move data available. Prevents
                // the "select 2D chip → 0 matches" confusion that happens when
                // backend hasn't enriched entries yet.
                const disabled = !hasAnyD2;
                return (
                  <button key={o.v}
                    onClick={disabled ? undefined : () => toggleD2(o.v)}
                    disabled={disabled}
                    title={disabled ? '⚠ 2D data not enriched yet. Push zzz231 backend files + Hard Refresh /earnings-opportunities. Until then, chip is disabled to avoid confusing "0 matches" selections.' : `Filter to entries with 2-day cumulative close ${o.lbl}. Bloomberg/Goldman convention: D2 = 2 trading sessions after earnings-day prev-close.`}
                    style={active ? chipActive(o.color) : { ...chipBase, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                    {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n === null ? '⏳' : n})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
        {/* zzz245 — DRIFT (cumulative post-filing move) filter. Uses move_pct.
            Mirrors 1D/2D CLOSE UX so users can compose D1 + D2 + DRIFT gates. */}
        {(() => {
          const toggleDrift = (v: number) =>
            setFilters((f) => ({ ...f, driftBucket: f.driftBucket === v ? null : v }));
          const opts: Array<{ v: number; lbl: string; color: string }> = [
            { v: 0,   lbl: '≥0%',    color: '#10B981' },
            { v: 3,   lbl: '≥+3%',   color: '#10B981' },
            { v: 5,   lbl: '≥+5%',   color: '#10B981' },
            { v: 10,  lbl: '≥+10%',  color: '#10B981' },
            { v: 20,  lbl: '≥+20%',  color: '#10B981' },
            { v: -3,  lbl: '≤-3%',   color: '#EF4444' },
            { v: -8,  lbl: '≤-8%',   color: '#EF4444' },
          ];
          const hasAnyDrift = entries.some((e) => typeof (e as any).move_pct === 'number' && Number.isFinite((e as any).move_pct));
          const countDrift = (v: number) => {
            const probe: ConvFilters = { ...filters, driftBucket: v };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>DRIFT</span>
              {opts.map((o) => {
                const active = filters.driftBucket === o.v;
                const n = hasAnyDrift ? countDrift(o.v) : null;
                const disabled = !hasAnyDrift;
                return (
                  <button key={o.v}
                    onClick={disabled ? undefined : () => toggleDrift(o.v)}
                    disabled={disabled}
                    title={disabled ? 'DRIFT (cumulative post-filing move) not yet enriched.' : `Filter to entries with cumulative post-filing drift ${o.lbl}. Bernard-Thomas PEAD signal.`}
                    style={active ? chipActive(o.color) : { ...chipBase, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                    {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n === null ? '⏳' : n})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
        {/* USER-REQ — Guidance in Conviction tab. String-keyed values, so
            render inline rather than generalize the number-keyed helper. */}
        {(() => {
          const toggleGuidance = (v: 'Positive' | 'Negative' | 'Neutral') =>
            setFilters((f) => ({ ...f, guidance: f.guidance === v ? null : v }));
          const countGuidance = (v: 'Positive' | 'Negative' | 'Neutral') => {
            const probe: ConvFilters = { ...filters, guidance: v };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          const opts: Array<{ v: 'Positive' | 'Neutral' | 'Negative'; lbl: string; color: string }> = [
            { v: 'Positive', lbl: '📈 Positive', color: '#10B981' },
            { v: 'Neutral',  lbl: '➖ Neutral',  color: '#94A3B8' },
            { v: 'Negative', lbl: '📉 Negative', color: '#EF4444' },
          ];
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>GUIDANCE</span>
              {opts.map((o) => {
                const active = filters.guidance === o.v;
                const n = countGuidance(o.v);
                return (
                  <button key={o.v} onClick={() => toggleGuidance(o.v)}
                    style={active ? chipActive(o.color) : chipBase}>
                    {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({n})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
        {/* PATCH 0909 — Quarter (Q1-Q4) + FY filter chips. Indian fiscal-
            year convention derived from filing_date via deriveQuarterFY().
            Each chip shows a live (N) count under the OTHER active filters
            so the user sees how each option narrows the post-filter set.
            User feedback: "earnings hub, conviction beats i need some way
            to filter dates by quarter and year and all filter logic to be
            perfect". */}
        {(() => {
          const quarters: Array<'Q1' | 'Q2' | 'Q3' | 'Q4'> = ['Q1', 'Q2', 'Q3', 'Q4'];
          const toggleQ = (q: 'Q1' | 'Q2' | 'Q3' | 'Q4') =>
            setFilters((f) => ({ ...f, quarter: f.quarter === q ? null : q }));
          // PATCH 0921 — Independent-dimension count. When showing "Q4 (N)"
          // ignore other PERIOD filters (fy, fromDate, toDate) and only apply
          // the non-PERIOD filters (sales/PAT/EPS/etc) PLUS this specific Q.
          // Otherwise a narrow date range gets Q4 count = 0 even though the
          // bench has 359 Q4 entries — confusing UX.
          const countQ = (q: 'Q1' | 'Q2' | 'Q3' | 'Q4') => {
            const probe: ConvFilters = { ...filters, quarter: q, fy: null, fromDate: null, toDate: null };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          // PATCH 0913 — Show current FY + 3 prior FYs as chips regardless
          // of whether bench has data for them. User feedback: "i cant test
          // past . if past works future also works thats why". Empty FYs
          // render with (0) count so the chip is always available; user
          // can verify the filter logic by clicking a past FY even before
          // adding past-quarter entries to the bench.
          //
          // Today is 2026-05-26 (IST), so currentFY = FY26 (Apr 2025 - Mar
          // 2026 — we're in the post-Q4 filing window). Past 3 = FY25, FY24,
          // FY23. Future FY27 is shown only if any bench entry has it (rare).
          const presentFY = (() => {
            const s = new Set<number>();
            for (const e of entries) {
              const qfy = deriveQuarterFY(e);
              if (qfy) s.add(qfy.fy);
            }
            // PATCH 0926 — Add the FILING-FOCUS FY + next FY + 2 prior FYs.
            // Filing-focus FY is the year whose Q-results are currently being
            // filed (not the calendar FY we happen to be in). For May 2026
            // this gives FY26 (current filing focus), plus FY27 (next), FY25,
            // FY24. So the user sees FY26 (where their bench actually lives)
            // not FY27 (empty calendar year just begun).
            const now = new Date();
            const calY = now.getFullYear();
            const calM = now.getMonth() + 1;
            const filingFY = calM <= 6 ? calY % 100 : (calY + 1) % 100;
            // filingFY + next + 2 prior
            s.add(filingFY);
            s.add((filingFY + 1) % 100);
            for (let offset = 1; offset <= 2; offset++) {
              s.add((filingFY - offset + 100) % 100);
            }
            return Array.from(s).sort((a, b) => b - a);
          })();
          const toggleFY = (fy: number) =>
            setFilters((f) => ({ ...f, fy: f.fy === fy ? null : fy }));
          // PATCH 0921 — same independent-dimension rule for FY chips.
          const countFY = (fy: number) => {
            const probe: ConvFilters = { ...filters, fy, quarter: null, fromDate: null, toDate: null };
            return entries.filter((e) => passesConvictionFilter(e, probe)).length;
          };
          // PATCH 0911 — Single prominent PERIOD row containing both
          // Quarter and FY chip groups, separated by a visual divider.
          // User feedback: "FYFY26 (289) why no quarter there" — the
          // previous two-row layout buried Quarter above FY and the
          // labels collided visually. New layout puts a bigger PERIOD
          // header + visible vertical divider between Q-chips and FY-chips.
          // PATCH 0922 + 0924 + 0926 — Q chip labels carry the SPECIFIC
          // calendar year derived from the active fiscal-year context.
          //
          // ctxFY = either the active FY filter OR the FILING-FOCUS FY
          // (what's currently being filed), NOT the calendar FY we're in.
          //
          // Filing windows by calendar month:
          //   Apr-Jun: filing Q4 of FY{calY}   (Jan-Mar calY results)
          //   Jul-Sep: filing Q1 of FY{calY+1} (Apr-Jun calY results)
          //   Oct-Dec: filing Q2 of FY{calY+1} (Jul-Sep calY results)
          //   Jan-Mar: filing Q3 of FY{calY}   (Oct-Dec calY-1 results)
          //
          // User feedback: "Showing for FY27 (Apr 2026 → Mar 2027) ← we're here
          // now" in May 2026 was confusing — we're CALENDAR-in FY27, but
          // every filing right now is Q4 FY26. Bench data reflects filing
          // focus, so the default chip should match.
          const ctxFY: number = (() => {
            if (filters.fy != null) return filters.fy;
            const now = new Date();
            const calY = now.getFullYear();
            const calM = now.getMonth() + 1;
            // calM <= 6 (Jan-Jun) → filing Q3 or Q4 of FY{calY}
            // calM >= 7 (Jul-Dec) → filing Q1 or Q2 of FY{calY+1}
            return calM <= 6 ? calY % 100 : (calY + 1) % 100;
          })();
          // PATCH 0926 — Which quarter row is "we're here now" annotated.
          // Based on calendar month (independent of any FY override):
          //   Apr-Jun → Q4 (filing Q4 results)
          //   Jul-Sep → Q1
          //   Oct-Dec → Q2
          //   Jan-Mar → Q3
          const currentFilingQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' = (() => {
            const m = new Date().getMonth() + 1;
            if (m >= 4 && m <= 6) return 'Q4';
            if (m >= 7 && m <= 9) return 'Q1';
            if (m >= 10 && m <= 12) return 'Q2';
            return 'Q3';
          })();
          // True only when the cheat sheet's FY matches the current filing-
          // focus FY (so the "← we're here now" indicator is honest if user
          // switched to a past or future FY).
          const isCtxFYCurrent = (() => {
            const now = new Date();
            const calY = now.getFullYear();
            const calM = now.getMonth() + 1;
            const realCurrentFY = calM <= 6 ? calY % 100 : (calY + 1) % 100;
            return ctxFY === realCurrentFY;
          })();
          const ctxFYFull = resolveFyYear(ctxFY);
          const calForQ1Q2Q3 = ctxFYFull - 1;
          const calForQ4 = ctxFYFull;
          const qMeta: Record<string, { label: string; reports: string; filed: string }> = {
            Q1: { label: 'Q1', reports: `Apr-Jun ${calForQ1Q2Q3} results`,   filed: `typically filed Jul-Aug ${calForQ1Q2Q3}` },
            Q2: { label: 'Q2', reports: `Jul-Sep ${calForQ1Q2Q3} results`,   filed: `typically filed Oct-Nov ${calForQ1Q2Q3}` },
            Q3: { label: 'Q3', reports: `Oct-Dec ${calForQ1Q2Q3} results`,   filed: `typically filed Jan-Feb ${calForQ4}` },
            Q4: { label: 'Q4', reports: `Jan-Mar ${calForQ4} results · annual`, filed: `typically filed Apr-Jun ${calForQ4}` },
          };
          return (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 6,
              padding: '8px 10px',
              background: 'rgba(245,158,11,0.04)',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 6,
            }}>
              {/* PATCH 0922 + 0923 — Inline definitional banner with
                  collapsible quarter cheat-sheet table. User wanted the
                  same table I showed in chat rendered on the page so they
                  never have to flip between explainer and chips again. */}
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', lineHeight: 1.4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--mc-warn)', fontWeight: 800 }}>📅 PERIOD</span>
                  <span>
                    Indian FY: <strong style={{ color: 'var(--mc-text-1)' }}>FY26 = Apr 2025 → Mar 2026</strong>.
                    Quarter chips filter by <strong style={{ color: 'var(--mc-text-1)' }}>reporting quarter</strong>
                    {' '}(what the results cover), NOT filing month.
                  </span>
                  <button
                    onClick={() => setShowQuarterCheatSheet(v => !v)}
                    title="Show / hide the Q1-Q4 cheat sheet"
                    style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', color: 'var(--mc-warn)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
                  >
                    {showQuarterCheatSheet ? '▾' : '▸'} Cheat sheet
                  </button>
                </div>
                {showQuarterCheatSheet && (
                  <div style={{ marginTop: 6, padding: '6px 8px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 4 }}>
                    <div style={{ fontSize: 9.5, color: 'var(--mc-text-3)', marginBottom: 4 }}>
                      Showing for <strong style={{ color: 'var(--mc-warn)' }}>FY{ctxFY}</strong> (Apr {ctxFYFull - 1} → Mar {ctxFYFull})
                      {filters.fy == null && <span style={{ marginLeft: 4, color: 'var(--mc-text-4)' }}>· default · switch YEAR chip below to shift</span>}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(245,158,11,0.3)' }}>
                          <th style={{ textAlign: 'left', padding: '3px 6px', color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.3px' }}>Reporting Quarter</th>
                          <th style={{ textAlign: 'left', padding: '3px 6px', color: 'var(--mc-warn)', fontWeight: 800 }}>Period the results cover</th>
                          <th style={{ textAlign: 'left', padding: '3px 6px', color: 'var(--mc-warn)', fontWeight: 800 }}>Companies typically file</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* PATCH 0926 — "we're here now" annotation moves to
                            the quarter row that matches the current FILING
                            window. Only fires when ctxFY matches the real
                            current filing-focus FY (else past-FY browsing
                            would falsely claim "we're here now"). */}
                        {([
                          { q: 'Q1', period: `Apr–Jun ${calForQ1Q2Q3}`, filed: `Jul–Aug ${calForQ1Q2Q3}` },
                          { q: 'Q2', period: `Jul–Sep ${calForQ1Q2Q3}`, filed: `Oct–Nov ${calForQ1Q2Q3}` },
                          { q: 'Q3', period: `Oct–Dec ${calForQ1Q2Q3}`, filed: `Jan–Feb ${calForQ4}` },
                          { q: 'Q4', period: `Jan–Mar ${calForQ4} (also annual)`, filed: `Apr–Jun ${calForQ4}` },
                        ] as const).map((row) => {
                          const isCurrent = isCtxFYCurrent && row.q === currentFilingQuarter;
                          return (
                            <tr key={row.q} style={isCurrent ? { background: 'rgba(245,158,11,0.10)' } : undefined}>
                              <td style={{ padding: '2px 6px', color: isCurrent ? 'var(--mc-warn)' : 'var(--mc-text-1)', fontWeight: 800 }}>{row.q} FY{ctxFY}</td>
                              <td style={{ padding: '2px 6px', color: isCurrent ? 'var(--mc-warn)' : 'var(--mc-text-3)' }}>{row.period}</td>
                              <td style={{ padding: '2px 6px', color: isCurrent ? 'var(--mc-warn)' : 'var(--mc-text-3)', fontWeight: isCurrent ? 700 : undefined }}>
                                {row.filed}{isCurrent ? ' ← we\'re here now' : ''}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 110 }}>Reporting quarter:</span>
                <span style={{ fontSize: 9, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>
                  ({filters.fy != null ? `FY${ctxFY}` : `FY${ctxFY} default`})
                </span>
              {quarters.map((q) => {
                const active = filters.quarter === q;
                const n = countQ(q);
                const meta = qMeta[q];
                // The "Q3 FY26" full label so the chip is institutionally
                // unambiguous even when read out of context.
                const qFyLabel = `${meta.label} FY${ctxFY}`;
                // Strip the "results · annual" tail for compact inline tag.
                const periodTag = meta.reports.replace(' results', '').replace(' · annual', '');
                return (
                  <button key={q} onClick={() => toggleQ(q)}
                    style={active ? chipActive('#F59E0B') : chipBase}
                    title={`${qFyLabel} = ${meta.reports} · ${meta.filed}. Click to filter the bench to entries reporting this fiscal quarter, regardless of when they were filed. (Calendar years shown reflect ${filters.fy != null ? `your selected FY${ctxFY}` : `the current default FY${ctxFY}`}; if you switch the YEAR chip below, these labels will shift.)`}>
                    {qFyLabel} <span style={{ fontSize: 9, color: active ? 'var(--mc-warn)' : 'var(--mc-text-3)', marginLeft: 2 }}>({periodTag})</span> <span style={{ color: active ? 'var(--mc-warn)' : 'var(--mc-text-4)', marginLeft: 3, fontWeight: 800 }}>({n})</span>
                  </button>
                );
              })}
              </div>
              {presentFY.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 110 }}>Fiscal year:</span>
                  {presentFY.map((fy) => {
                    const active = filters.fy === fy;
                    const n = countFY(fy);
                    const fyFull = resolveFyYear(fy);
                    return (
                      <button key={fy} onClick={() => toggleFY(fy)}
                        style={active ? chipActive('#A78BFA') : chipBase}
                        title={`FY${fy} = Apr ${fyFull - 1} → Mar ${fyFull} (full Indian fiscal year, all 4 quarters Q1+Q2+Q3+Q4). Click a quarter chip above to narrow further. ${n === 0 ? 'No bench entries for this FY yet.' : `${n} entr${n === 1 ? 'y' : 'ies'} match.`}`}>
                        FY{fy} <span style={{ fontSize: 9, color: active ? 'var(--mc-state-persistent)' : 'var(--mc-text-3)', marginLeft: 2 }}>(Apr {fyFull - 1}–Mar {fyFull})</span> <span style={{ color: active ? 'var(--mc-state-persistent)' : 'var(--mc-text-4)', marginLeft: 3, fontWeight: 800 }}>({n})</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* PATCH 0918 + 0922 — Filing-date range filter, own row,
                  clearly labeled distinct from reporting-quarter chips. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 110 }}>Filing date range:</span>
                <span style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700 }}>FROM:</span>
                <input
                  type="date"
                  value={filters.fromDate || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    const ok = v && /^\d{4}-\d{2}-\d{2}$/.test(v);
                    setFilters((f) => ({ ...f, fromDate: ok ? v : null }));
                  }}
                  title="Filter to entries with filing_date on or AFTER this date (inclusive). This is the actual day the result was filed with NSE/BSE — different from the reporting quarter."
                  style={{ background: 'var(--mc-bg-0)', border: '1px solid #2A3550', color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 4, outline: 'none', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700 }}>TO:</span>
                <input
                  type="date"
                  value={filters.toDate || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    const ok = v && /^\d{4}-\d{2}-\d{2}$/.test(v);
                    setFilters((f) => ({ ...f, toDate: ok ? v : null }));
                  }}
                  title="Filter to entries with filing_date on or BEFORE this date (inclusive)."
                  style={{ background: 'var(--mc-bg-0)', border: '1px solid #2A3550', color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 4, outline: 'none', cursor: 'pointer' }}
                />
                {(filters.quarter || filters.fy != null || filters.fromDate || filters.toDate) && (
                  <button
                    onClick={() => setFilters((f) => ({ ...f, quarter: null, fy: null, fromDate: null, toDate: null }))}
                    title="Clear ALL period filters (reporting quarter + fiscal year + filing date range)"
                    style={{ ...chipBase, marginLeft: 4, opacity: 0.8 }}
                  >× clear period</button>
                )}
              </div>
            </div>
          );
        })()}
        </>)}
      </div>
      {/* PATCH 0196 — Export toolbar (CSV, TradingView, .txt, Open chart). Tier-grouped.
          PATCH 0366 — tickerCompanyMap wired for Screener.in name-based matching. */}
      <TickerExportToolbar
        compact
        tickers={allTickers}
        groups={[
          // ── zzz671 — THE JUST-REPORTED COHORT LEADS THE EXPORT ───────────
          //
          // ELITE / BLOCKBUSTER / STRONG sorts by how good a quarter was and
          // says nothing about WHEN it was. A name that reported last night and
          // one that reported in July land in the same block, so the list that
          // reaches TradingView cannot be read in the order the work happens:
          // fresh prints first, the standing book behind them.
          //
          // The export dedupes each ticker into the FIRST section that claims
          // it, which makes this a reordering rather than a duplication — a
          // name that reported four days ago appears under ###NEW 10D and is
          // removed from its tier section below.
          //
          // The window is the page's own adaptive one (`computeNewWindow`),
          // which widens past ten days when nothing reported in ten. Between
          // earnings seasons this stays useful instead of being an empty
          // heading, and the label says which window it actually used.
          {
            label: `NEW ${__NEW_WIN.days}D`, emoji: '🆕', color: '#38BDF8',
            tickers: [...blockbusters, ...strongs]
              .filter((e: any) => { const d = filingAgeDays(e?.filing_date); return d !== null && d <= __NEW_WIN.days; })
              .map((e) => e.ticker),
          },
          // zzz224 — ELITE leads the standing book: elite names land under
          // ###ELITE and are deduped out of the tier sections below.
          { label: 'ELITE', emoji: '🏆', tickers: [...blockbusters, ...strongs].filter((e: any) => e.is_elite).map((e) => e.ticker), color: '#22D3EE' },
          { label: 'BLOCKBUSTER', emoji: '⭐', tickers: blockbusters.map((e) => e.ticker), color: '#F59E0B' },
          { label: 'STRONG', emoji: '🟢', tickers: strongs.map((e) => e.ticker), color: '#10B981' },
        ]}
        exchange="NSE"
        filenameHint="conviction-beats"
        tickerCompanyMap={
          [...blockbusters, ...strongs].reduce<Record<string, string>>((acc, e) => {
            if (e.ticker && e.company) acc[e.ticker.toUpperCase()] = cbCompany(e); // zzz827 — "&amp;" decoded
            return acc;
          }, {})
        }
      />

      {/* PATCH 0547 — Rich view + view-mode toggle REMOVED per user request.
          Hub-style enrichment fetch was unreliable for 200+ entries and
          counts stayed at 0. Compact view is now the only view. */}

      {false ? (
        // ── RICH (Earnings Hub Scan parity) ──────────────────────────────
        <>
          {/* PATCH 0539 — Hub-Scan filter rail */}
          <HubFilterRail
            cards={enrichedList}
            filters={hubFilters}
            setFilters={setHubFilters}
            watchlistSet={watchlistSet}
            portfolioSet={portfolioSet}
          />

          {/* Coverage stats bar (same shape as Earnings Hub Scan) */}
          <CoverageStatsBar cards={hubFilteredList} totalCount={enrichedList.length} showingCount={hubFilteredList.length} />

          {/* Card grid */}
          {hubFilteredList.length === 0 && !richLoading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--mc-text-3)', backgroundColor: 'var(--mc-bg-1)', border: '1px dashed var(--mc-border-2)', borderRadius: 10 }}>
              {enrichedList.length === 0
                ? 'No enriched cards yet — fetch may still be running. Try again in a moment.'
                : 'No cards match the current hub filters. Adjust filters above.'}
            </div>
          )}
          {hubFilteredList.length > 0 && filters.sortByPead && (
            // PATCH 0540 — When PEAD sort is active, render a single
            // top-down sorted grid; grouping by tier would break the
            // sort signal the user just asked for.
            <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderLeft: '4px solid var(--mc-cyan)', borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 10, letterSpacing: '0.5px' }}>
                🌊 PEAD-SORTED · {hubFilteredList.length}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                {hubFilteredList.map((c) => (
                  <div key={c.symbol} style={{ position: 'relative' }}>
                    <EarningsCardComponent card={c} />
                    <button onClick={() => onRemove(c.symbol)} title="Remove from Conviction Beats"
                      style={{ position: 'absolute', top: 8, right: 8, background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-3)', cursor: 'pointer', padding: '3px 7px', fontSize: 12, borderRadius: 4 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {hubFilteredList.length > 0 && !filters.sortByPead && (() => {
            const bb = hubFilteredList.filter(c => {
              const e = entries.find(en => en.ticker.toUpperCase() === c.symbol.toUpperCase());
              return e?.tier === 'BLOCKBUSTER';
            });
            const st = hubFilteredList.filter(c => {
              const e = entries.find(en => en.ticker.toUpperCase() === c.symbol.toUpperCase());
              return e?.tier === 'STRONG';
            });
            return (
              <>
                {bb.length > 0 && (
                  <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderLeft: '4px solid var(--mc-warn)', borderRadius: 12, padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.5px' }}>
                        ⭐ BLOCKBUSTER · {bb.length}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                      {bb.map((c) => (
                        <div key={c.symbol} style={{ position: 'relative' }}>
                          <EarningsCardComponent card={c} />
                          <button onClick={() => onRemove(c.symbol)} title="Remove from Conviction Beats"
                            style={{ position: 'absolute', top: 8, right: 8, background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-3)', cursor: 'pointer', padding: '3px 7px', fontSize: 12, borderRadius: 4 }}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {st.length > 0 && (
                  <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderLeft: '4px solid var(--mc-bullish)', borderRadius: 12, padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.5px' }}>
                        🟢 STRONG · {st.length}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                      {st.map((c) => (
                        <div key={c.symbol} style={{ position: 'relative' }}>
                          <EarningsCardComponent card={c} />
                          <button onClick={() => onRemove(c.symbol)} title="Remove from Conviction Beats"
                            style={{ position: 'absolute', top: 8, right: 8, background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-3)', cursor: 'pointer', padding: '3px 7px', fontSize: 12, borderRadius: 4 }}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </>
      ) : (
        // ── COMPACT (legacy rows) OR TABLE view ─────────────────────────
        tableMode ? (
          <ConvictionTable entries={[...blockbusters, ...strongs]} onRemove={onRemove} sort={tableSort} setSort={setTableSort} />
        ) : (
<>
          {/* zzz254 — Side-by-side split when both tiers have entries. On narrow
              screens (< 1280px) it collapses back to stacked via 1fr fallback. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: (blockbusters.length > 0 && strongs.length > 0)
              ? 'repeat(auto-fit, minmax(min(100%, 640px), 1fr))'
              : '1fr',
            gap: 12,
          }}>
            {blockbusters.length > 0 && (
              <div style={{
                backgroundColor: 'var(--mc-bg-1)',
                border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderLeft: '4px solid var(--mc-warn)',
                borderRadius: 12, padding: density === 'ultra' ? '8px 12px' : density === 'compact' ? '10px 14px' : '14px 18px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', marginBottom: 10, letterSpacing: '0.5px' }}>
                  ⭐ BLOCKBUSTER · {blockbusters.length}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${density === 'ultra' ? 300 : density === 'compact' ? 340 : 380}px, 1fr))`, gap: density === 'ultra' ? 6 : 10 }}>
                  {blockbusters.map((e) => { const ck = cbCheckOf.get(e); return ck?.state === 'unknown'
                    ? <div key={e.ticker}><div data-testid="cb-row-not-checked" style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text-3)', padding: '0 4px 2px' }}>◌ {notCheckedText(ck.missing)} — shown, not failed</div><ConvictionRow entry={e} onRemove={onRemove} density={density} radarEntry={radarMap.get(String(e.ticker || '').toUpperCase())} /></div>
                    : <ConvictionRow key={e.ticker} entry={e} onRemove={onRemove} density={density} radarEntry={radarMap.get(String(e.ticker || '').toUpperCase())} />; })}
                </div>
              </div>
            )}
            {strongs.length > 0 && (
              <div style={{
                backgroundColor: 'var(--mc-bg-1)',
                border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderLeft: '4px solid var(--mc-bullish)',
                borderRadius: 12, padding: density === 'ultra' ? '8px 12px' : density === 'compact' ? '10px 14px' : '14px 18px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bullish)', marginBottom: 10, letterSpacing: '0.5px' }}>
                  🟢 STRONG · {strongs.length}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${density === 'ultra' ? 300 : density === 'compact' ? 340 : 380}px, 1fr))`, gap: density === 'ultra' ? 6 : 10 }}>
                  {strongs.map((e) => { const ck = cbCheckOf.get(e); return ck?.state === 'unknown'
                    ? <div key={e.ticker}><div data-testid="cb-row-not-checked" style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text-3)', padding: '0 4px 2px' }}>◌ {notCheckedText(ck.missing)} — shown, not failed</div><ConvictionRow entry={e} onRemove={onRemove} density={density} radarEntry={radarMap.get(String(e.ticker || '').toUpperCase())} /></div>
                    : <ConvictionRow key={e.ticker} entry={e} onRemove={onRemove} density={density} radarEntry={radarMap.get(String(e.ticker || '').toUpperCase())} />; })}
                </div>
              </div>
            )}
          </div>
        </>
        )
      )}
      <div style={{
        padding: '8px 12px', backgroundColor: 'var(--mc-bg-0)',
        border: '1px solid var(--mc-bg-4)', borderRadius: 8,
        fontSize: 10.5, color: 'var(--mc-text-4)', lineHeight: 1.5,
        marginTop: 20,
      }}>
        <div>
          Institutional bench of high-quality post-earnings setups.
          Auto-populated from <strong style={{ color: 'var(--mc-cyan)' }}>Earnings Opportunities</strong> whenever a stock prints BLOCKBUSTER or STRONG.
          Removed entries don't auto-readd — use × to permanently prune.
        </div>
        {/* PATCH 0918 — Explain why bench is heavily skewed toward current quarter.
            User feedback: clicked Jan 29 2026 on EO, saw 101 scheduled, expected
            those to land on the bench. They don't — bench only gains entries
            when a company is GRADED BLOCKBUSTER/STRONG (i.e. it actually filed
            financials AND beat the bar), not when a board meeting is announced. */}
        {(() => {
          // Compute quarter distribution to show user why their filters look skewed.
          const counts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, none: 0 };
          for (const e of entries) {
            const qfy = deriveQuarterFY(e);
            if (qfy) counts[qfy.q]++; else counts.none++;
          }
          const totalQ = counts.Q1 + counts.Q2 + counts.Q3 + counts.Q4;
          const dominantQ = (Object.entries(counts) as Array<[string, number]>)
            .filter(([k]) => k !== 'none')
            .sort((a, b) => b[1] - a[1])[0];
          if (!dominantQ || totalQ === 0) return null;
          const dominantPct = (dominantQ[1] / totalQ) * 100;
          if (dominantPct < 70) return null; // Only show when one quarter dominates >70%
          // zzz373 — season label derived from the calendar (was hard-coded "Q4 FY26 · May–Jun 2026").
          const seasonLabel = (() => {
            const now = new Date(); const m = now.getMonth() + 1; const y = now.getFullYear();
            // Indian FY ends March. Jul–Aug = Q1 (Apr–Jun) season; Oct–Nov = Q2; Jan–Feb = Q3; Apr–Jun = Q4/annual.
            if (m >= 7 && m <= 9) return `Q1 FY${String(y + 1).slice(2)} filing season (Jul–Aug ${y} — companies publishing their Apr–Jun ${y} numbers)`;
            if (m >= 10 && m <= 12) return `Q2 FY${String(y + 1).slice(2)} filing season (Oct–Nov ${y} — companies publishing their Jul–Sep ${y} numbers)`;
            if (m >= 1 && m <= 3) return `Q3 FY${String(y).slice(2)} filing season (Jan–Feb ${y} — companies publishing their Oct–Dec ${y - 1} numbers)`;
            return `Q4 FY${String(y).slice(2)} filing season (Apr–Jun ${y} — companies publishing their Jan–Mar ${y} numbers)`;
          })();
          // PATCH 0922 — Quarter→date-range cheat sheet so user can verify.
          const qPeriodMap: Record<string, string> = {
            Q1: 'Apr–Jun results (filed Jul–Aug)',
            Q2: 'Jul–Sep results (filed Oct–Nov)',
            Q3: 'Oct–Dec results (filed Jan–Feb)',
            Q4: 'Jan–Mar results · annual (filed Apr–Jun)',
          };
          return (
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 4, fontSize: 11, color: 'var(--mc-state-persistent)', lineHeight: 1.6 }}>
              ℹ️ <strong>Why is {dominantQ[0]} so dominant?</strong> Bench auto-populates only when a stock is GRADED (filed + parsed + tiered) — not when its board meeting is scheduled.
              We&apos;re in the middle of <strong>{seasonLabel}</strong>, so {dominantQ[0]} naturally has {dominantQ[1]} of {totalQ} entries ({dominantPct.toFixed(0)}%).
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--mc-text-3)' }}>
                <strong style={{ color: 'var(--mc-text-1)' }}>Quarter → date cheat sheet:</strong> Q1 = {qPeriodMap.Q1} · Q2 = {qPeriodMap.Q2} · Q3 = {qPeriodMap.Q3} · Q4 = {qPeriodMap.Q4}
              </div>
            </div>
          );
        })()}
      </div>

    </div>
  );
}
