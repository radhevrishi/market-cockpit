'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo, useEffect } from 'react';
import { getConvictionTickers } from '@/lib/conviction-beats';
import { subscribeDecisions, readDecisions, type DecisionStatus } from '@/lib/decisions';
import { computeClusterScore, isClusterSeed, CLUSTER_TIER_META } from '@/lib/op-leverage-cluster';
import type { Grade, ExcelResult } from '@/lib/multibagger-india-scoring';
import { scoreUSARow } from '@/lib/multibagger-usa-scoring';
import type { USARow } from '@/lib/multibagger-usa-scoring';
import { F } from './constants';
import { USA_SLIM_KEY, USA_STORAGE_KEY, _getUsaRowsMemCache, _setUsaRowsMemCache, toSlimUsaRows } from './mem-cache';
import { mbServerSnapshotLoad } from './storage';
import { type MbAnalyticsStock, type MbMarketScope } from './types';
import { MbScreenerChips, MultiConfirmedCard } from './widgets';

export function MultibaggerAnalytics({
  indiaRows,
  onSwitchTab,
  initialScope,
}: {
  indiaRows: ExcelResult[];
  onSwitchTab: (t: string) => void;
  /* PATCH 1101ff — Allow caller to set the initial scope so the USA Analytics
     tab boots into USA view instead of INDIA. User reported USA analytics
     much worse than India because the separate USAAnalytics() function only
     had ~480 lines of widgets vs MultibaggerAnalytics' ~3000 lines. Route
     the USA tab through this full component instead. */
  initialScope?: MbMarketScope;
}) {
  const [scope, setScope] = React.useState<MbMarketScope>(initialScope ?? 'INDIA');

  // ADDITIVE — Market-breadth regime strip. Best-effort fetch of /api/v1/breadth,
  // rendered as a one-line banner at the top of Analytics. Hides on failure.
  const [regime, setRegime] = React.useState<{ composite: number; regime: string; regime_color?: string; regime_desc?: string; suggested_cash_pct?: number } | null>(null);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Same fix as the Technicals tab: this panel renders for whichever
        // market `scope` is on, and an NSE regime over a USA leaderboard is
        // simply the wrong number.
        const res = await fetch(`/api/v1/breadth${scope === 'USA' ? '?region=us' : ''}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data && typeof data.composite === 'number') setRegime(data);
        else if (alive) setRegime(null);
      } catch {}
    })();
    return () => { alive = false; };
  }, [scope]);

  // PATCH 0874 — USA rows + prev-score baselines now live in state with
  // a tick-bumping listener pair (storage + mb-upload:updated), so this
  // Analytics tab stays LIVE when the user uploads to the USA tab.
  // Previous useMemo([]) reads were one-shot at mount and went stale the
  // moment a fresh CSV was scored — the user reported a USA leaderboard
  // that refused to update without a full page reload.
  const [dataTick, bumpData] = React.useReducer((x: number) => x + 1, 0);

  // PATCH zzz126 — Hoist Railway USA hydration into Analytics. The prior
  // hydration (PATCH 1101v) lived inside USACompare's useEffect, so it
  // only fired when the user mounted the USA Multibagger tab. If the
  // user opened /multibagger and went straight to Analytics or USA
  // Analytics, the Railway snapshot was never pulled — leaving usaRows=0
  // even though their CSV existed server-side. This duplicate hydration
  // ensures Analytics gets USA rows regardless of which tab is open first.
  // It is best-effort: errors are swallowed, no UI block.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    let alive = true;
    (async () => {
      try {
        // If we already have USA rows in mem cache or full LS, skip.
        const mem = _getUsaRowsMemCache();
        if (Array.isArray(mem) && mem.length > 0) return;
        let localCount = 0;
        try {
          const raw = localStorage.getItem(USA_STORAGE_KEY);
          if (raw) localCount = (JSON.parse(raw) as any[])?.length || 0;
        } catch {}
        if (localCount > 0) return;
        // Also check slim payload — if slim has data we don't need server.
        try {
          const slimRaw = localStorage.getItem(USA_SLIM_KEY);
          if (slimRaw) {
            const slim = JSON.parse(slimRaw);
            if (Array.isArray(slim) && slim.length > 0) {
              // zzz134 — Slim rows are missing pillarScores/strengths/risks.
              // Re-score before writing to mem cache so USACompare (which reads
              // this same cache) doesn't crash on r.pillarScores.map(...).
              let rescored: any[] = slim;
              try {
                const needs = !Array.isArray((slim[0] || {}).pillarScores);
                if (needs) rescored = slim.map((r: any) => { try { return scoreUSARow(r as unknown as USARow); } catch { return r; } });
              } catch {}
              _setUsaRowsMemCache(rescored);
              bumpData();
              return;
            }
          }
        } catch {}
        // Pull from Railway server snapshot.
        const serverRaw = await mbServerSnapshotLoad('USA');
        if (!alive || !serverRaw) return;
        let serverRows: any[] = [];
        try { serverRows = JSON.parse(serverRaw); } catch {}
        if (!Array.isArray(serverRows) || !serverRows.length) return;
        try { console.log(`[mb-analytics] zzz126 hydrated ${serverRows.length} USA rows from Railway`); } catch {}
        // Populate all three layers: mem cache (instant), slim LS (quota-safe),
        // best-effort full LS.
        _setUsaRowsMemCache(serverRows);
        try {
          const slimJson = JSON.stringify(toSlimUsaRows(serverRows));
          localStorage.setItem(USA_SLIM_KEY, slimJson);
        } catch {}
        try { localStorage.setItem(USA_STORAGE_KEY, serverRaw); } catch {}
        bumpData();
        try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'USA', count: serverRows.length, source: 'analytics-hydrate' } })); } catch {}
      } catch (e) {
        try { console.warn('[mb-analytics] zzz126 Railway hydrate failed', e); } catch {}
      }
    })();
    return () => { alive = false; };
    // Run only on mount — subsequent updates flow through the storage / event listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => bumpData();
    const onStorage = (e: StorageEvent) => {
      if (!e.key) { refresh(); return; }
      if (e.key === USA_STORAGE_KEY || e.key === USA_SLIM_KEY || e.key === 'mb_india_prev_scores_v1' || e.key === 'mb_usa_prev_scores_v1' || e.key === 'mb_excel_scored_v2') refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mb-upload:updated', refresh);
    // PATCH zzz105 — also refresh on focus (catches case where user uploaded
    // on another tab and came back).
    window.addEventListener('focus', refresh);
    // PATCH zzz105 — poller fallback for same-tab uploads where the storage
    // event doesn't fire (browser same-tab semantics). Checks LS length every
    // 2s; if either USA or India dataset changed size, bump.
    let lastUsaLen = 0, lastUsaSlimLen = 0, lastIndiaLen = 0;
    try {
      lastUsaLen = (localStorage.getItem(USA_STORAGE_KEY) || '').length;
      lastUsaSlimLen = (localStorage.getItem(USA_SLIM_KEY) || '').length;
      lastIndiaLen = (localStorage.getItem('mb_excel_scored_v2') || '').length;
    } catch {}
    const poller = setInterval(() => {
      try {
        const u = (localStorage.getItem(USA_STORAGE_KEY) || '').length;
        const us = (localStorage.getItem(USA_SLIM_KEY) || '').length;
        const i = (localStorage.getItem('mb_excel_scored_v2') || '').length;
        if (u !== lastUsaLen || us !== lastUsaSlimLen || i !== lastIndiaLen) {
          lastUsaLen = u; lastUsaSlimLen = us; lastIndiaLen = i;
          refresh();
        }
      } catch {}
    }, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mb-upload:updated', refresh);
      window.removeEventListener('focus', refresh);
      clearInterval(poller);
    };
  }, []);

  const usaRows = React.useMemo<any[]>(() => {
    if (typeof window === 'undefined') return [];
    // PATCH zzz110 — IN-MEMORY CACHE FIRST. This is the bypass that finally
    // closes the bug: USACompare wrote here synchronously when the user
    // uploaded their CSV; we read here unconditionally. localStorage is no
    // longer required for the USA Analytics pipeline within the same page
    // session. LS is just persistence-across-reload now.
    try {
      const mem = _getUsaRowsMemCache();
      if (Array.isArray(mem) && mem.length > 0) {
        try { console.log(`[mb-analytics] zzz110 using in-memory USA cache (${mem.length} rows)`); } catch {}
        return mem;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(USA_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      const slimRaw = localStorage.getItem(USA_SLIM_KEY);
      if (slimRaw) {
        const slim = JSON.parse(slimRaw);
        if (Array.isArray(slim) && slim.length > 0) {
          try { console.log(`[mb-analytics] zzz108 using slim USA payload (${slim.length} rows, full was empty/missing)`); } catch {}
          return slim;
        }
      }
      return [];
    } catch { return []; }
  }, [dataTick]);

  // PATCH 0548 — Read prev-score baselines directly from LS so we can compute
  // score deltas, "new since last upload", and sector rotation.
  // PATCH 0874 — dep on dataTick so a fresh upload from another tab
  // refreshes the baseline view.
  const prevScoreMap = React.useMemo<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const ind = JSON.parse(localStorage.getItem('mb_india_prev_scores_v1') || '{}');
      const us  = JSON.parse(localStorage.getItem('mb_usa_prev_scores_v1')   || '{}');
      // Merge — symbols are unique across markets in practice (RELIANCE vs RELIANCE.NS).
      return { ...ind, ...us };
    } catch { return {}; }
  }, [dataTick]);

  // Conviction Beats overlay.
  // PATCH 0872 — was a one-shot useMemo, meaning Analytics overlays
  // (STRONG BUY, Add Candidates, Triple-Confirmed) went stale the moment
  // the user adjusted the CB list on /earnings-opportunities. Convert to
  // state + listener (matches the pattern already used elsewhere on the
  // page — search for `conviction-beats:updated`).
  const [convictionSet, setConvictionSet] = React.useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set<string>();
    try { return new Set<string>(getConvictionTickers()); } catch { return new Set<string>(); }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => { try { setConvictionSet(new Set<string>(getConvictionTickers())); } catch {} };
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);

  // PATCH 0554 — listen for cross-tab decision updates so the
  // Decision-Bridge / Triple-Confirmed panels reflect new BUY / WATCH /
  // REJECTED tags without a page reload.
  // PATCH 0872 — Expose decisionTick so the `stats` useMemo can include it
  // in its deps; previously forceDecRefresh re-rendered the component but
  // the memo was cached against unchanged inputs, defeating the listener
  // (Decision Bridge / Triple-Confirmed / Decision Coverage % stayed stale
  // until the user manually switched tabs).
  const [decisionTick, forceDecRefresh] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribeDecisions(() => forceDecRefresh()), []);

  // Build unified analytics rows.  PATCH 0548 / 0554 — also expose `prevScore`,
  // `marketCap` (in ₹ Cr for India, $ B for USA), red-flag counts (India),
  // and the USA forensic-flag triple (FCF/Op divergence, post-run stretched,
  // earnings proximity).  This lets every downstream block — Decision Bridge,
  // Quality Audit, Triple-Confirmed — operate off one in-memory list.
  type AnaStock = MbAnalyticsStock & {
    prevScore?: number;
    marketCapCr?: number;
    marketCapB?: number;
    redFlagSummary?: {
      critical: number;
      structural: number;   // HIGH STRUCTURAL count
      cyclical: number;     // HIGH CYCLICAL count
      medium: number;
      total: number;
    };
    fcfOpDivergence?: boolean;
    postRunStretched?: boolean;
    earningsProximityDays?: number;
    suggestedMaxPositionPct?: number;
    // PATCH 0991 — Screener.in CSV file names this stock appeared in.
    // Powers the 🎯 MULTI-CONFIRMED PICKS card + per-row "📂 N" badge.
    _screeners?: string[];
  };
  const stocks: AnaStock[] = React.useMemo(() => {
    const stripSym = (s: string) => (s || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
    const ind = (indiaRows || []).map((r) => {
      const flags = (r as any).redFlags as { severity: string; kind?: string }[] | undefined;
      const summary = flags && flags.length > 0 ? {
        critical: flags.filter((f) => f.severity === 'CRITICAL').length,
        structural: flags.filter((f) => f.severity === 'HIGH' && f.kind === 'STRUCTURAL').length,
        cyclical: flags.filter((f) => f.severity === 'HIGH' && f.kind === 'CYCLICAL').length,
        medium: flags.filter((f) => f.severity === 'MEDIUM').length,
        total: flags.length,
      } : { critical: 0, structural: 0, cyclical: 0, medium: 0, total: 0 };
      return {
        symbol: r.symbol,
        // PATCH 0585 — Field is `company` on parsed India rows, not `companyName`.
        // Earlier mismatch silently emptied every company display across analytics.
        company: (r as any).company,
        score: r.score,
        grade: r.grade,
        sector: (r as any).sector,
        market: 'INDIA' as const,
        prevScore: prevScoreMap[r.symbol] ?? prevScoreMap[stripSym(r.symbol)],
        marketCapCr: (r as any).marketCapCr as number | undefined,
        redFlagSummary: summary,
        // PATCH 0991 — pass through screener-file membership for MULTI-CONFIRMED card
        _screeners: ((r as any)._screeners as string[] | undefined) ?? [],
      };
    });
    const us = (usaRows || []).map((r: any) => ({
      symbol: r.symbol,
      // PATCH 0585 — Field is `company` on parsed USA rows (parser stores
      // `company: String(row['Description']??'').trim()`), not `companyName`.
      company: r.company || r.companyName,
      score: r.score,
      grade: r.grade,
      sector: r.sector,
      market: 'USA' as const,
      prevScore: prevScoreMap[r.symbol] ?? prevScoreMap[stripSym(r.symbol)],
      marketCapB: r.marketCapB as number | undefined,
      fcfOpDivergence: r.fcfOpDivergence === true,
      postRunStretched: r.postRunStretched === true,
      earningsProximityDays: typeof r.earningsProximityDays === 'number' ? r.earningsProximityDays : undefined,
      suggestedMaxPositionPct: typeof r.suggestedMaxPositionPct === 'number' ? r.suggestedMaxPositionPct : undefined,
      // PATCH 1101mm — pass _screeners + USA-specific fields through to stocks.
      // Previously USA mapping stripped these fields (only India side carried
      // _screeners), so MULTI-CONFIRMED PICKS always showed 0 + the new R40
      // widget had no data to read.
      _screeners: ((r as any)._screeners as string[] | undefined) ?? [],
      ruleOf40: typeof r.ruleOf40 === 'number' ? r.ruleOf40
              : (typeof r.revenueGrowthAnn === 'number' && typeof r.fcfMarginAnn === 'number'
                  ? r.revenueGrowthAnn + r.fcfMarginAnn
                  : undefined),
      revenueGrowthAnn: r.revenueGrowthAnn,
      fcfMarginAnn: r.fcfMarginAnn,
      capTier: r.capTier,
      // PATCH 1101mm — also surface common quality metrics for richer USA widgets
      roic: r.roic,
      roe: r.roe,
      grossMarginTtm: r.grossMarginTtm ?? r.grossMarginAnn,
      piotroskiFScore: r.piotroskiFScore,
    }));
    const merged: AnaStock[] = [...ind, ...us];
    return scope === 'BOTH' ? merged : merged.filter((s) => s.market === scope);
  }, [indiaRows, usaRows, scope, prevScoreMap]);

  // PATCH 0548 — Richer stats including median, P25/P75, score histogram,
  // sector rotation, decision buckets, hidden gems, concentration risk.
  const stats = React.useMemo(() => {
    const total = stocks.length;
    const grades: Record<string, number> = {};
    const sectorMap: Record<string, { count: number; avgScore: number; total: number; prevTotal: number; prevCount: number }> = {};
    const scoreArr: number[] = [];
    const stripSym = (s: string) => (s || '').toUpperCase().replace(/\.(NS|BO)$/i, '');

    for (const s of stocks) {
      grades[s.grade] = (grades[s.grade] || 0) + 1;
      scoreArr.push(s.score || 0);
      const sec = s.sector || 'Unclassified';
      if (!sectorMap[sec]) sectorMap[sec] = { count: 0, avgScore: 0, total: 0, prevTotal: 0, prevCount: 0 };
      sectorMap[sec].count++;
      sectorMap[sec].total += s.score || 0;
      if (typeof s.prevScore === 'number') {
        sectorMap[sec].prevTotal += s.prevScore;
        sectorMap[sec].prevCount++;
      }
    }

    // Score quartiles
    const sortedScores = [...scoreArr].sort((a, b) => a - b);
    const pct = (q: number) => {
      if (sortedScores.length === 0) return 0;
      const idx = Math.floor((sortedScores.length - 1) * q);
      return sortedScores[idx];
    };
    const p25 = pct(0.25), p50 = pct(0.50), p75 = pct(0.75);
    const avg = total > 0 ? Math.round(scoreArr.reduce((a, b) => a + b, 0) / total) : 0;

    // Sector rollups + rotation (Δ avg vs prev upload)
    const sectorRanked = Object.entries(sectorMap)
      .map(([sector, v]) => {
        const curAvg = Math.round(v.total / Math.max(1, v.count));
        const prevAvg = v.prevCount > 0 ? Math.round(v.prevTotal / v.prevCount) : null;
        const delta = prevAvg !== null ? curAvg - prevAvg : null;
        return { sector, count: v.count, avgScore: curAvg, prevAvg, delta };
      })
      .sort((a, b) => b.count - a.count);
    const sectorAvgLookup: Record<string, number> = {};
    for (const s of sectorRanked) sectorAvgLookup[s.sector] = s.avgScore;

    const aPlus = grades['A+'] || 0;
    const aOnly = grades['A'] || 0;
    const aTotal = aPlus + aOnly;
    const aPct = total > 0 ? Math.round((aTotal / total) * 100) : 0;

    // Score histogram (10-wide bins)
    const histogram: { bin: string; min: number; max: number; count: number }[] = [];
    for (let lo = 0; lo <= 90; lo += 10) {
      const hi = lo === 90 ? 100 : lo + 9;
      const count = scoreArr.filter((v) => v >= lo && v <= hi).length;
      histogram.push({ bin: `${lo}-${hi}`, min: lo, max: hi, count });
    }

    // Δ score vs prev upload
    let deltaSum = 0, deltaN = 0;
    let newCount = 0;
    for (const s of stocks) {
      if (typeof s.prevScore === 'number') {
        deltaSum += (s.score || 0) - s.prevScore;
        deltaN++;
      } else {
        newCount++;
      }
    }
    const meanDelta = deltaN > 0 ? Math.round((deltaSum / deltaN) * 10) / 10 : 0;

    // ── Decision buckets ────────────────────────────────────────────────
    // PATCH 0587 — STRONG BUY criteria RELAXED per user feedback:
    // was (Grade A/A+ AND on CB AND sector ≥65 avg) — produced only 2 picks
    // out of 83. New rule: Grade A/A+ AND (on CB OR sector ≥60 avg) AND
    // clean (≤ 1 red flag). Expected: ~8-12 names of an 83-row universe,
    // matching realistic portfolio construction.
    const isInCb = (sym: string) => convictionSet.has(stripSym(sym));
    const strongBuy = stocks
      .filter((s) => {
        if (!(s.grade === 'A+' || s.grade === 'A')) return false;
        // PATCH 0988 — defense in depth (avoid set computed below this hook,
        // so we re-check the same red-flag conditions here)
        const crit = s.redFlagSummary?.critical ?? 0;
        const struc = s.redFlagSummary?.structural ?? 0;
        if (crit > 0 || struc > 0) return false;
        const cb = isInCb(s.symbol);
        const sectorHot = (sectorAvgLookup[s.sector || 'Unclassified'] ?? 0) >= 60;
        if (!cb && !sectorHot) return false;
        const flagTotal = s.redFlagSummary?.total ?? 0;
        const critical = s.redFlagSummary?.critical ?? 0;
        const structural = s.redFlagSummary?.structural ?? 0;
        // Must be reasonably clean. ≤1 medium flag OK; critical or
        // structural flags disqualify.
        if (critical > 0 || structural > 0) return false;
        if (flagTotal > 1) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score);

    // 📈 RE-RATING — score up ≥5 vs prev, still grade A/A+ and not flagged
    const rerating = stocks
      .filter((s) => typeof s.prevScore === 'number'
        && (s.score - (s.prevScore as number)) >= 5
        && (s.grade === 'A+' || s.grade === 'A')
        // PATCH 0988 — exclude flagged stocks even if score jumped
        && (s.redFlagSummary?.critical ?? 0) === 0
        && (s.redFlagSummary?.structural ?? 0) === 0)
      .sort((a, b) => (b.score - (b.prevScore as number)) - (a.score - (a.prevScore as number)));

    // PATCH 0587 — Split AVOID into TWO buckets per user feedback:
    //   - AVOID (Fundamental): true deterioration confirmed (D, C+drop)
    //     OR critical/structural red flags surfaced.
    //   - REVIEW (Data): rows where the scorer can't render a confident
    //     verdict because of missing data (very low scores with no flags,
    //     usually < 30 with red-flag count = 0). These were silently
    //     mixed into AVOID and made the bucket look like everything was
    //     failing when half of it was just "we don't know yet".
    const looksLikeDataGap = (s: typeof stocks[number]) => {
      const t = s.redFlagSummary?.total ?? 0;
      return s.score < 30 && t === 0;
    };
    const avoid = stocks
      .filter((s) => !looksLikeDataGap(s) && (
        s.grade === 'D'
        || (s.grade === 'C' && typeof s.prevScore === 'number' && (s.prevScore - s.score) >= 5)
        || ((s.redFlagSummary?.critical ?? 0) > 0)
      ))
      .sort((a, b) => a.score - b.score);
    const reviewDataGap = stocks
      .filter(looksLikeDataGap)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // PATCH 0554 — Decision Bridge replaces the Sectors Heating/Cooling block,
    // which was visually broken without a prior-upload baseline. The bridge
    // surfaces names where SCORE + CONVICTION BEATS + DECISION LOGBOOK
    // disagree, because that disagreement IS the actionable insight.
    const decisionMap = (() => {
      try { return readDecisions(); } catch { return {}; }
    })();
    const decisionOf = (sym: string) => decisionMap[stripSym(sym).toUpperCase()];

    // (1) ADD CANDIDATES — Score A+/A but NOT on Conviction Beats.
    //     Already a strong fundamental but not yet on the institutional bench.
    const addCandidates = stocks
      .filter((s) => (s.grade === 'A+' || s.grade === 'A') && !isInCb(s.symbol))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // (2) DROP ALERTS — On Conviction Beats but score DROPPED ≥5 OR grade is
    //     now B/B+/C/D. The CB list is curated separately (filings-driven), so
    //     when the multibagger score deteriorates this is a genuine trim flag.
    const dropAlerts = stocks
      .filter((s) => isInCb(s.symbol) && (
        s.grade === 'B' || s.grade === 'B+' || s.grade === 'C' || s.grade === 'D' ||
        (typeof s.prevScore === 'number' && (s.prevScore - s.score) >= 5)
      ))
      .sort((a, b) => {
        // Sort by score-drop descending, then by absolute score ascending.
        const da = typeof a.prevScore === 'number' ? (a.prevScore - a.score) : 0;
        const db = typeof b.prevScore === 'number' ? (b.prevScore - b.score) : 0;
        if (db !== da) return db - da;
        return a.score - b.score;
      })
      .slice(0, 10);

    // (3) RE-EVALUATE — Previously decided REJECTED but now grade A+/A.
    //     This is the "am I being too conservative?" check.
    const reEvaluate = stocks
      .filter((s) => {
        const d = decisionOf(s.symbol);
        return d && d.status === 'REJECTED' && (s.grade === 'A+' || s.grade === 'A');
      })
      .map((s) => ({ ...s, _decision: decisionOf(s.symbol)! }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // (4) DECISION COVERAGE — % of A-roster that has any logbook decision.
    //     Helps the user spot uncovered A+ names that haven't been triaged.
    const aDecisionCount = stocks
      .filter((s) => (s.grade === 'A+' || s.grade === 'A'))
      .filter((s) => !!decisionOf(s.symbol)).length;

    // ── QUALITY AUDIT — how clean is the A-roster? ───────────────────────
    // For the user's PAYS post-mortem: A+ universe shouldn't be celebrated
    // until we know how many of those A+ names carry latent forensic risk.
    const aOnlyRoster = stocks.filter((s) => s.grade === 'A+' || s.grade === 'A');
    const qaIndia = aOnlyRoster.filter((s) => s.market === 'INDIA');
    const qaUsa   = aOnlyRoster.filter((s) => s.market === 'USA');

    const indCriticalCount   = qaIndia.filter((s) => (s.redFlagSummary?.critical ?? 0) > 0).length;
    const indStructuralCount = qaIndia.filter((s) => (s.redFlagSummary?.structural ?? 0) > 0).length;
    const indCyclicalCount   = qaIndia.filter((s) => (s.redFlagSummary?.cyclical ?? 0) > 0).length;
    const indCleanCount      = qaIndia.filter((s) => (s.redFlagSummary?.total ?? 0) === 0).length;

    const usaFcfDivCount     = qaUsa.filter((s) => s.fcfOpDivergence).length;
    const usaPostRunCount    = qaUsa.filter((s) => s.postRunStretched).length;
    const usaEarnSoonCount   = qaUsa.filter((s) =>
      typeof s.earningsProximityDays === 'number' && s.earningsProximityDays >= 0 && s.earningsProximityDays <= 7
    ).length;
    const usaCleanCount      = qaUsa.filter((s) =>
      !s.fcfOpDivergence && !s.postRunStretched &&
      !(typeof s.earningsProximityDays === 'number' && s.earningsProximityDays >= 0 && s.earningsProximityDays <= 7)
    ).length;

    // Build per-flag drill-through lists (cap at 6 for compact display).
    const indFlaggedRoster = qaIndia
      .filter((s) => (s.redFlagSummary?.critical ?? 0) > 0 || (s.redFlagSummary?.structural ?? 0) > 0)
      .sort((a, b) => (b.redFlagSummary?.critical ?? 0) - (a.redFlagSummary?.critical ?? 0)
                   || (b.redFlagSummary?.structural ?? 0) - (a.redFlagSummary?.structural ?? 0))
      .slice(0, 8);
    const usaFcfDivList     = qaUsa.filter((s) => s.fcfOpDivergence).slice(0, 6);
    const usaPostRunList    = qaUsa.filter((s) => s.postRunStretched).slice(0, 6);
    const usaEarnSoonList   = qaUsa
      .filter((s) => typeof s.earningsProximityDays === 'number' && s.earningsProximityDays >= 0 && s.earningsProximityDays <= 7)
      .sort((a, b) => (a.earningsProximityDays ?? 99) - (b.earningsProximityDays ?? 99))
      .slice(0, 6);

    // ── TRIPLE-CONFIRMED — score + CB + decision = BUY/WATCH ─────────────
    // The highest-conviction quadrant.  These are names where the
    // fundamental scorer, the curated CB bench, AND the user's explicit
    // logbook decision ALL agree it deserves capital.
    const tripleConfirmed = stocks
      .filter((s) => {
        if (!(s.grade === 'A+' || s.grade === 'A')) return false;
        if (!isInCb(s.symbol)) return false;
        const d = decisionOf(s.symbol);
        return d && (d.status === 'BUY' || d.status === 'WATCH');
      })
      .map((s) => ({ ...s, _decision: decisionOf(s.symbol)! }))
      .sort((a, b) => b.score - a.score);

    const qualityAudit = {
      aTotal: aOnlyRoster.length,
      indiaTotal: qaIndia.length,
      indCriticalCount, indStructuralCount, indCyclicalCount, indCleanCount,
      indFlaggedRoster,
      usaTotal: qaUsa.length,
      usaFcfDivCount, usaPostRunCount, usaEarnSoonCount, usaCleanCount,
      usaFcfDivList, usaPostRunList, usaEarnSoonList,
    };

    const decisionBridge = {
      addCandidates,
      dropAlerts,
      reEvaluate,
      aDecisionCount,
      aTotal: aOnlyRoster.length,
    };

    // Cap-size breakdown (India only — uses ₹ Cr).
    const indiaWithMcap = stocks.filter((s) => s.market === 'INDIA' && typeof s.marketCapCr === 'number');
    const capBuckets: { label: string; min: number; max: number; count: number; avgScore: number; total: number }[] = [
      { label: 'Large Cap (≥ ₹20,000 Cr)',     min: 20000, max: Infinity, count: 0, avgScore: 0, total: 0 },
      { label: 'Mid Cap (₹5,000–20,000 Cr)',   min: 5000,  max: 20000,    count: 0, avgScore: 0, total: 0 },
      { label: 'Small Cap (₹500–5,000 Cr)',    min: 500,   max: 5000,     count: 0, avgScore: 0, total: 0 },
      { label: 'Micro Cap (< ₹500 Cr)',        min: 0,     max: 500,      count: 0, avgScore: 0, total: 0 },
    ];
    for (const s of indiaWithMcap) {
      const mcap = s.marketCapCr as number;
      for (const b of capBuckets) {
        if (mcap >= b.min && mcap < b.max) { b.count++; b.total += s.score || 0; break; }
      }
    }
    for (const b of capBuckets) b.avgScore = b.count > 0 ? Math.round(b.total / b.count) : 0;
    const hasCapData = indiaWithMcap.length > 0;

    // Hidden Gems — score ≥70, NOT on CB, sector avg <60
    const hiddenGems = stocks
      .filter((s) => (s.score || 0) >= 70
        && !isInCb(s.symbol)
        && (sectorAvgLookup[s.sector || 'Unclassified'] ?? 100) < 60)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Concentration risk — % of A/A+ in top-3 sectors
    const aRoster = stocks.filter((s) => s.grade === 'A+' || s.grade === 'A');
    const aSectorCounts: Record<string, number> = {};
    for (const s of aRoster) {
      const sec = s.sector || 'Unclassified';
      aSectorCounts[sec] = (aSectorCounts[sec] || 0) + 1;
    }
    const aSectorRanked = Object.entries(aSectorCounts).sort((a, b) => b[1] - a[1]);
    const top3Sectors = aSectorRanked.slice(0, 3);
    const top3Count = top3Sectors.reduce((sum, [, c]) => sum + c, 0);
    const top3Pct = aRoster.length > 0 ? Math.round((top3Count / aRoster.length) * 100) : 0;
    const concentrationRisk = top3Pct > 60 && aRoster.length >= 8;

    // PATCH 0988 — single-classification precedence: AVOID is terminal.
    // Build a stable Set of AVOID-classified symbols, then EXCLUDE them
    // from every positive-classification section so the same stock never
    // appears in both AVOID and BUY/TOP 25/MULTI-CONFIRMED/CONVICTION.
    const _avoidSyms = new Set(avoid.map((s) => s.symbol));
    // Top picks expanded to 25 — excludes AVOID
    const topPicks = [...stocks]
      .filter((s) => !_avoidSyms.has(s.symbol))
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    // Conviction overlap also excludes AVOID (a flagged stock shouldn't
    // surface as a "strongest decision-ready candidate" just because the
    // CB bench has it from an old quarter).
    const convictionOverlap = stocks.filter((s) => isInCb(s.symbol) && !_avoidSyms.has(s.symbol));

    // PATCH 0578 — Operating Leverage Cluster scores. Compute on the raw
    // India rows (which carry the per-row fundamentals the cluster formula
    // needs); USA rows aren't included because the cluster framework is
    // India-centric (Indian industrial-capex theme).
    const clusterEntries = (indiaRows || []).map((r: any) => {
      const cluster = computeClusterScore(r);
      const sym = (r.symbol || '').toUpperCase();
      return {
        symbol: r.symbol,
        company: r.company, // PATCH 0585 — was r.companyName (wrong field)
        sector: r.sector,
        score: r.score,
        grade: r.grade,
        cluster,
        isSeed: isClusterSeed(sym),
      };
    });
    // PATCH 0586 — split scored vs data-incomplete so the analytics card
    // can show the gap clearly instead of mixing DATA_INCOMPLETE rows into
    // the low end of the ranking.
    const clusterRankedAll = [...clusterEntries].sort((a, b) =>
      (b.isSeed ? 1 : 0) - (a.isSeed ? 1 : 0) || b.cluster.score - a.cluster.score
    );
    const clusterRanked = clusterRankedAll.filter(x => x.cluster.tier !== 'DATA_INCOMPLETE');
    const clusterIncomplete = clusterRankedAll.filter(x => x.cluster.tier === 'DATA_INCOMPLETE');
    const clusterHighConv = clusterRanked.filter(x => x.cluster.tier === 'HIGH_CONVICTION');
    const clusterEmerging = clusterRanked.filter(x => x.cluster.tier === 'EMERGING');

    // PATCH 0578.5 — Cash-Rich / Net-Zero Debt hunting lens. User-requested
    // (mid-session): "next hunting process" target is companies sitting on
    // meaningful cash with effectively no debt. Computed per-market so we
    // can show both India and USA candidates side by side.
    type CashRichRow = {
      symbol: string; company?: string; sector?: string;
      score: number; grade: string; market: 'INDIA' | 'USA';
      cashAbsLabel: string;       // e.g. '₹ 850 Cr' or '$ 2.4B'
      cashToMcapPct: number;      // 0-100
      debtIndicator: string;      // 'Net cash' | 'D/E 0.08' | 'ND/EBITDA -1.2×'
    };
    const indiaCashRich: CashRichRow[] = (indiaRows || []).map((r: any) => {
      const cash = num(r.cashAndEq);
      const mcap = num(r.marketCapCr);
      const de = num(r.de);
      const nde = num(r.netDebtEbitda);
      if (typeof cash !== 'number' || typeof mcap !== 'number' || mcap <= 0) return null;
      const ratio = (cash / mcap) * 100;
      const noDebt =
        (typeof de === 'number' && de < 0.10) ||
        (typeof nde === 'number' && nde <= 0);
      if (ratio < 20 || !noDebt) return null;
      const debtIndicator =
        (typeof nde === 'number' && nde <= 0) ? 'Net cash'
        : (typeof de === 'number') ? `D/E ${de.toFixed(2)}`
        : 'low debt';
      return {
        symbol: r.symbol,
        company: r.company, // PATCH 0585 — was r.companyName (wrong field)
        sector: r.sector,
        score: r.score,
        grade: r.grade,
        market: 'INDIA' as const,
        cashAbsLabel: `₹ ${cash.toFixed(0)} Cr`,
        cashToMcapPct: Math.round(ratio),
        debtIndicator,
      };
    }).filter(Boolean) as CashRichRow[];
    const usaCashRich: CashRichRow[] = (usaRows || []).map((r: any) => {
      const cash = num(r.cashUsd ?? r.cashStInvest);
      const mcap = num(r.marketCapUsd);
      const de = num(r.de);
      const nd = num(r.netDebtUsd);
      if (typeof cash !== 'number' || typeof mcap !== 'number' || mcap <= 0) return null;
      const ratio = (cash / mcap) * 100;
      const noDebt =
        (typeof de === 'number' && de < 0.10) ||
        (typeof nd === 'number' && nd <= 0);
      if (ratio < 20 || !noDebt) return null;
      const cashB = cash / 1e9;
      const debtIndicator =
        (typeof nd === 'number' && nd <= 0) ? 'Net cash'
        : (typeof de === 'number') ? `D/E ${de.toFixed(2)}`
        : 'low debt';
      return {
        symbol: r.symbol,
        company: r.company || r.companyName, // PATCH 0585 — was r.companyName (wrong field)
        sector: r.sector,
        score: r.score,
        grade: r.grade,
        market: 'USA' as const,
        cashAbsLabel: cashB >= 1 ? `$ ${cashB.toFixed(1)}B` : `$ ${(cash / 1e6).toFixed(0)}M`,
        cashToMcapPct: Math.round(ratio),
        debtIndicator,
      };
    }).filter(Boolean) as CashRichRow[];
    const cashRich = [...indiaCashRich, ...usaCashRich]
      .sort((a, b) => b.cashToMcapPct - a.cashToMcapPct);

    // PATCH zzz128 — USA Operating Leverage Leaders (improved).
    // Op Leverage = EPS growth YoY ÷ Revenue growth YoY. >1× = margins
    // expanding (positive op-lev). Filter widened to rev > 0 (was rev >= 2)
    // so growth companies with modest top-line still surface if they have
    // strong margin expansion. Cap to keep table tidy.
    type UsaOpLevRow = {
      symbol: string; company?: string; sector?: string;
      grade: string; score: number;
      opLev: number; epsGrowth: number; revGrowth: number;
      opmTtm?: number; marketCapB?: number;
    };
    const usaOpLevAll: UsaOpLevRow[] = (usaRows || []).map((r: any) => {
      const eps = num(r.epsGrowth);
      const rev = num(r.revenueGrowthAnn);
      if (typeof eps !== 'number' || typeof rev !== 'number' || rev <= 0) return null;
      const raw = eps / rev;
      const opLev = Math.max(-9.9, Math.min(99.9, Math.round(raw * 10) / 10));
      return {
        symbol: r.symbol,
        company: r.company,
        sector: r.sector,
        grade: r.grade,
        score: r.score,
        opLev,
        epsGrowth: eps,
        revGrowth: rev,
        opmTtm: num(r.opmTtm),
        marketCapB: num(r.marketCapB),
      } as UsaOpLevRow;
    }).filter(Boolean) as UsaOpLevRow[];
    // Split by tier so we can show "STRONG" leaders prominently and a
    // secondary "POSITIVE but not yet strong" group for context.
    const usaOpLevTop = [...usaOpLevAll].sort((a, b) => b.opLev - a.opLev).slice(0, 18);
    const usaOpLevStrong = usaOpLevAll.filter(r => r.opLev >= 1.5).sort((a, b) => b.opLev - a.opLev).slice(0, 12);
    const usaOpLevPositive = usaOpLevAll.filter(r => r.opLev >= 1 && r.opLev < 1.5).sort((a, b) => b.opLev - a.opLev).slice(0, 8);
    const usaOpLevEligibleCount = usaOpLevAll.length;

    return {
      total, grades, avg, p25, p50, p75,
      sectorRanked, sectorAvgLookup,
      aPlus, aOnly, aTotal, aPct, topPicks, convictionOverlap,
      histogram, meanDelta, newCount,
      strongBuy, rerating, avoid, reviewDataGap,
      // PATCH 0588 — Valuation Gateway (PEG / PB-ROE)
      valuationGate: (() => {
        const rated = stocks.map((s: any) => {
          const peg = num(s.peg);
          const pb = num(s.pb);
          const roe = num(s.roe);
          let vScore = 0;
          const notes: string[] = [];
          if (typeof peg === 'number') {
            if (peg < 1.0) { vScore += 15; notes.push(`PEG ${peg.toFixed(2)} (cheap)`); }
            else if (peg < 1.5) { vScore += 10; notes.push(`PEG ${peg.toFixed(2)}`); }
            else if (peg < 2.0) { vScore += 5; notes.push(`PEG ${peg.toFixed(2)}`); }
            else { notes.push(`PEG ${peg.toFixed(2)} (expensive)`); }
          }
          if (typeof pb === 'number' && typeof roe === 'number' && pb < 1.5 && roe > 15) {
            vScore += 5;
            notes.push(`PB ${pb.toFixed(1)} + ROE ${roe.toFixed(0)}%`);
          }
          return { ...s, valuationScore: vScore, valuationNotes: notes.join(' · ') };
        });
        // Only surface A-grade names that ALSO clear the valuation gate (score ≥ 10).
        return rated
          .filter((s: any) => (s.grade === 'A+' || s.grade === 'A') && s.valuationScore >= 10)
          .sort((a: any, b: any) => b.valuationScore - a.valuationScore)
          .slice(0, 12);
      })(),
      // PATCH 0589 — Today's Top 3 Buys widget (auto-picked from STRONG BUY
      // and ADD TO BENCH where the row is NOT already on Conviction Beats —
      // surface the names you haven't actioned yet).
      top3Today: (() => {
        const candidates = [
          ...strongBuy,
          ...stocks
            .filter((s) => (s.grade === 'A+' || s.grade === 'A') && !isInCb(s.symbol))
            .sort((a, b) => b.score - a.score),
        ];
        const seen = new Set<string>();
        const out: typeof stocks = [];
        for (const c of candidates) {
          const key = (c.symbol || '').toUpperCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(c);
          if (out.length >= 3) break;
        }
        return out;
      })(),
      // PATCH 0554 — replaces heatingUp / cooling (broken w/o baseline)
      decisionBridge, qualityAudit, tripleConfirmed,
      capBuckets, hasCapData,
      hiddenGems,
      top3Sectors, top3Pct, concentrationRisk,
      // PATCH 0578 — cluster scores + cash-rich lens
      clusterRanked, clusterHighConv, clusterEmerging, clusterIncomplete,
      usaOpLevTop, usaOpLevStrong, usaOpLevPositive, usaOpLevEligibleCount, // zzz127 + zzz128
      cashRich,
    };
    // PATCH 0872 — `decisionTick` added so any BUY/WATCH/REJECTED tag
    // change anywhere in the app re-computes this memo (Decision Bridge,
    // Triple-Confirmed, Decision Coverage %). Was previously cached.
  }, [stocks, convictionSet, indiaRows, usaRows, decisionTick]);

  // Local num helper for the new memos.
  function num(v: any): number | undefined {
    if (v === undefined || v === null) return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#0D1623', border: '1px solid #1A2540',
    borderRadius: 6, padding: '12px 14px',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: '#6B7A8D', letterSpacing: '0.3px', marginBottom: 4,
  };

  // PATCH 0573 — Per-row "why" reason text shown in the decision-ready
  // buckets (STRONG BUY / ADD TO BENCH / TRIM ALERTS / RE-EVALUATE).
  // Reasons are heuristic and derive purely from signals we already have
  // on the stock object + the stats cache: grade, score, prevScore,
  // sector momentum, conviction-bench membership, red-flag summary,
  // forensic flags (USA), and prior decision log entry. Keeps the analyst
  // honest — they see WHY a row landed in a bucket, not just that it did.
  type ReasonKind = 'STRONG_BUY' | 'ADD' | 'TRIM' | 'REEVAL';
  const reasonFor = (s: typeof stats.topPicks[number] & { _decision?: { reason?: string; date?: string } }, kind: ReasonKind): string => {
    const sectorAvg = stats.sectorAvgLookup?.[s.sector || 'Unclassified'];
    const delta = typeof s.prevScore === 'number' ? s.score - s.prevScore : null;
    const flagSummary = s.redFlagSummary;
    if (kind === 'STRONG_BUY') {
      const parts: string[] = [];
      parts.push(`Grade ${s.grade}`);
      if (typeof sectorAvg === 'number') parts.push(`sector hot (avg ${sectorAvg})`);
      parts.push('on Conviction Beats');
      if (delta != null && delta > 0) parts.push(`▲+${delta} vs prev`);
      if (flagSummary && flagSummary.total === 0) parts.push('clean');
      return parts.join(' · ');
    }
    if (kind === 'ADD') {
      const parts: string[] = [];
      parts.push(`Grade ${s.grade}`);
      if (typeof sectorAvg === 'number' && sectorAvg >= 60) parts.push(`sector strong (avg ${sectorAvg})`);
      else parts.push('not yet on bench');
      if (s.fcfOpDivergence) parts.push('⚠ FCF/op divergence');
      if (s.postRunStretched) parts.push('⚠ post-run stretched');
      if (flagSummary && flagSummary.critical > 0) parts.push(`⚠ ${flagSummary.critical} critical flag`);
      else if (flagSummary && flagSummary.structural > 0) parts.push(`⚠ ${flagSummary.structural} structural flag`);
      else if (flagSummary && flagSummary.total === 0) parts.push('clean');
      return parts.join(' · ');
    }
    if (kind === 'TRIM') {
      const parts: string[] = [];
      if (delta != null && delta <= -5) parts.push(`Score ▼${Math.abs(delta)} vs prev`);
      else if (delta != null && delta < 0) parts.push(`Score ▼${Math.abs(delta)}`);
      if (['B','C','D'].includes(s.grade)) parts.push(`grade dropped to ${s.grade}`);
      else if (s.grade === 'B+') parts.push(`grade slipped to ${s.grade}`);
      if (flagSummary && flagSummary.critical > 0) parts.push(`${flagSummary.critical} critical flag`);
      else if (flagSummary && flagSummary.structural > 0) parts.push(`${flagSummary.structural} structural flag`);
      if (parts.length === 0) parts.push(`Watching — ${s.grade} grade`);
      return parts.join(' · ');
    }
    if (kind === 'REEVAL') {
      const parts: string[] = [];
      parts.push(`Rejected → ${s.grade}`);
      if (s._decision?.reason) parts.push(`(reason: "${s._decision.reason.slice(0, 60)}${s._decision.reason.length > 60 ? '…' : ''}")`);
      if (s._decision?.date) parts.push(`on ${String(s._decision.date).slice(0, 10)}`);
      return parts.join(' ');
    }
    return '';
  };

  // PATCH 0573 / 0585 — Stacked cell. After user feedback (0585), company
  // name is now the primary line (12px bold sans) and the ticker is the
  // smaller monospaced badge below it. Earlier version had it flipped and
  // the parser-field bug (`r.companyName` vs `r.company`) made the company
  // never render at all — analytics looked ticker-only. Both fixed.
  const TickerCompanyCell = ({ ticker, company }: { ticker: string; company?: string }) => (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {company ? (
        <>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</span>
          <span style={{ fontSize: 9, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600, letterSpacing: '0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticker}</span>
        </>
      ) : (
        // No company name available — fall back to ticker as the headline.
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticker}</span>
      )}
    </div>
  );

  // PATCH zzz107 — REVERTED zzz106 auto-flip (it was wrong).
  // zzz106 had logic to auto-switch scope from USA → INDIA when the current
  // scope filter showed 0 stocks. That misled the user: on the USA Analytics
  // tab, with 102 USA stocks uploaded but not visible to this component, the
  // auto-flip silently switched to INDIA and showed Indian companies under
  // "USA Analytics". User correctly called this out as misleading.
  //
  // New approach: keep scope on the user's choice. Show a diagnostic empty
  // state that tells the truth — what we DO see vs what we DON'T see, with a
  // path forward (refresh or switch to BOTH).
  const usaCount = (usaRows || []).length;
  const indiaCount = (indiaRows || []).length;

  if (stats.total === 0) {
    const dataExistsElsewhere = (scope === 'USA' && indiaCount > 0)
                              || (scope === 'INDIA' && usaCount > 0)
                              || (scope === 'BOTH' && (usaCount > 0 || indiaCount > 0));
    const noDataAnywhere = usaCount === 0 && indiaCount === 0;
    return (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--mc-text-3)' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>{noDataAnywhere ? '📊' : '⚠️'}</div>
        {noDataAnywhere ? (
          <>
            <p style={{ margin: 0, fontWeight: 700, color: 'var(--mc-text-1)' }}>No Multibagger data uploaded yet</p>
            <p style={{ margin: '8px 0 16px', fontSize: 12, lineHeight: 1.5, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
              Upload your Screener.in CSV (India) or TradingView CSV (USA) on the ranking tabs.
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontWeight: 700, color: 'var(--mc-text-1)' }}>
              No {scope} data visible to Analytics — but {usaCount} USA + {indiaCount} India are in storage.
            </p>
            <p style={{ margin: '8px 0', fontSize: 12, lineHeight: 1.5, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
              Likely cause: localStorage was filled (5MB cap) and the latest write was rejected silently.
              {dataExistsElsewhere && <> Click <b>MARKET → BOTH</b> below to see what loaded.</>}
            </p>
            <p style={{ margin: '8px 0', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: 'var(--mc-text-4)' }}>
              {`scope=${scope}  usaRows.len=${usaCount}  indiaRows.len=${indiaCount}`}
            </p>
          </>
        )}
        <div style={{ display: 'inline-flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => onSwitchTab('excel')} style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)',
            background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>🇮🇳 India tab</button>
          <button onClick={() => onSwitchTab('usa')} style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)',
            background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>🇺🇸 USA tab</button>
          {dataExistsElsewhere && (
            <button onClick={() => setScope('BOTH')} style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid #8B5CF640',
              background: '#8B5CF610', color: '#8B5CF6', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>🌐 Switch to BOTH</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ADDITIVE — Market regime strip (breadth-driven). */}
      {regime && (() => {
        const rc = regime.regime_color || 'var(--mc-text-4)';
        const comp = Math.round(Number(regime.composite) || 0);
        const cash = typeof regime.suggested_cash_pct === 'number' ? Math.round(regime.suggested_cash_pct) : null;
        const framing = comp >= 60 ? 'broad — press winners' : comp >= 40 ? 'selective' : 'defensive';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 14px', borderRadius: 8, border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-2)', fontSize: 12 }}>
            <span style={{ fontWeight: 900, letterSpacing: '0.4px', color: rc }}>{String(regime.regime || '').toUpperCase()}</span>
            <span style={{ color: 'var(--mc-text-2)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{comp}/100</span>
            {cash != null && <span style={{ color: 'var(--mc-text-4)' }}>suggested cash {cash}%</span>}
            <span style={{ color: 'var(--mc-text-4)' }}>· {framing}</span>
            {regime.regime_desc && <span style={{ color: 'var(--mc-text-4)', opacity: 0.85 }}>· {regime.regime_desc}</span>}
          </div>
        );
      })()}
      {/* ── MARKET SCOPE TOGGLE ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', marginRight: 6 }}>MARKET</span>
        {(['INDIA', 'USA', 'BOTH'] as MbMarketScope[]).map((m) => {
          const isActive = scope === m;
          const color = m === 'INDIA' ? '#10B981' : m === 'USA' ? '#22D3EE' : '#8B5CF6';
          return (
            <button
              key={m}
              onClick={() => setScope(m)}
              style={{
                fontSize: 11, fontWeight: 800, letterSpacing: '0.4px', cursor: 'pointer',
                border: `1px solid ${isActive ? color : 'var(--mc-bg-4)'}`,
                backgroundColor: isActive ? `${color}22` : 'transparent',
                color: isActive ? color : 'var(--mc-text-4)',
                padding: '4px 12px', borderRadius: 4,
              }}
            >
              {m === 'INDIA' ? '🇮🇳 INDIA' : m === 'USA' ? '🇺🇸 USA' : '🌐 BOTH'}
            </button>
          );
        })}
      </div>

      {/* PATCH 0984 — compact screener chip row */}
      <MbScreenerChips />

      {/* ── STATS STRIP (PATCH 0548: 10-KPI grid) ───────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Total stocks</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-cyan)', fontVariantNumeric: 'tabular-nums' }}>{stats.total}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Avg / Median score</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' }}>
            {stats.avg} <span style={{ color: 'var(--mc-text-4)', fontSize: 13 }}>/ {stats.p50}</span>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>P75 / P25 thresholds</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--mc-info)', fontVariantNumeric: 'tabular-nums' }}>
            {stats.p75} <span style={{ color: 'var(--mc-text-4)', fontSize: 13 }}>/ {stats.p25}</span>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>A+ / A counts</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' }}>
            {stats.aPlus} <span style={{ color: 'var(--mc-cyan)' }}>/ {stats.aOnly}</span>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>% A-or-better</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-warn)', fontVariantNumeric: 'tabular-nums' }}>{stats.aPct}%</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Conviction overlap</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#EC4899', fontVariantNumeric: 'tabular-nums' }}>{stats.convictionOverlap.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Sectors represented</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-state-persistent)', fontVariantNumeric: 'tabular-nums' }}>{stats.sectorRanked.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>New since last upload</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#06B6D4', fontVariantNumeric: 'tabular-nums' }}>{stats.newCount}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Mean Δ vs last upload</div>
          <div style={{
            fontSize: 22, fontWeight: 900,
            color: stats.meanDelta > 0 ? 'var(--mc-bullish)' : stats.meanDelta < 0 ? 'var(--mc-bearish)' : 'var(--mc-text-3)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {stats.meanDelta > 0 ? '▲ +' : stats.meanDelta < 0 ? '▼ ' : '• '}{Math.abs(stats.meanDelta).toFixed(1)}
          </div>
        </div>
      </div>

      {/* ── CONCENTRATION RISK BANNER (PATCH 0548) ──────────────────────── */}
      {stats.concentrationRisk && (
        <div style={{
          border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)',
          borderRadius: 6, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--mc-warn)', fontWeight: 600, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 800 }}>Concentration risk:</span>{' '}
            {stats.top3Pct}% of your A-grade names sit in{' '}
            {stats.top3Sectors.map(([sec, n]) => (
              <span key={sec} style={{ fontWeight: 700 }}>{sec} ({n}){', '}</span>
            ))}
            <span style={{ color: 'var(--mc-text-2)', fontWeight: 500 }}>— diversify exposure across sectors to avoid single-cycle drawdown.</span>
          </div>
        </div>
      )}

      {/* ── 🚀 TODAY'S TOP 3 BUYS (PATCH 0589) ───────────────────────────
          Auto-picked headline widget: highest-conviction A+/A names you
          haven't actioned yet (STRONG BUY ∪ ADD-TO-BENCH minus already
          on Conviction Beats). Sits at the top of analytics so the
          analyst sees the next 3 actions before scrolling. */}
      {stats.top3Today && stats.top3Today.length > 0 && (
        <div style={{
          ...cardStyle,
          borderColor: 'color-mix(in srgb, var(--mc-warn) 44%, transparent)',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--mc-warn) 8%, transparent) 0%, transparent 100%)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, color: 'var(--mc-warn)', fontWeight: 900, letterSpacing: '0.4px' }}>
              🚀 TODAY&apos;S TOP {stats.top3Today.length} BUYS
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>ACTION-READY</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 10, lineHeight: 1.5 }}>
            The highest-conviction A+/A names you have not yet added to the bench. Open the row in Earnings
            Opportunities to add, or click the company name to open the stock sheet.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {stats.top3Today.map((s, i) => (
              <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 6,
                  border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: 'var(--mc-warn)' }}>#{i + 1}</span>
                  <TickerCompanyCell ticker={s.symbol} company={s.company} />
                  <span style={{ fontSize: 12, color: 'var(--mc-bullish)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                </div>
                <span style={{ fontSize: 10, color: 'var(--mc-text-2)', lineHeight: 1.4 }}>
                  {s.sector || '—'} · {reasonFor(s as any, convictionSet.has((s.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '')) ? 'STRONG_BUY' : 'ADD')}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── DECISION-READY BUCKETS (PATCH 0548) ─────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {/* STRONG BUY */}
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-bullish)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🎯 STRONG BUY ({stats.strongBuy.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Grade A/A+, on Conviction Beats, sector avg ≥ 65.
          </div>
          {stats.strongBuy.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>No names meet all three gates yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stats.strongBuy.slice(0, 8).map((s) => (
                <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-bullish) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)', textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TickerCompanyCell ticker={s.symbol} company={s.company} />
                    <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
                    {/* PATCH 0991 — screener-membership badge */}
                    {Array.isArray((s as any)._screeners) && (s as any)._screeners.length >= 2 && (
                      <span title={(s as any)._screeners.join(', ')} style={{
                        fontSize: 9, color: 'var(--mc-cyan)', fontWeight: 800,
                        padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>📂 {(s as any)._screeners.length}</span>
                    )}
                    <span style={{ fontSize: 9, color: 'var(--mc-text-3)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector || '—'}</span>
                  </div>
                  <span style={{ fontSize: 9.5, color: 'color-mix(in srgb, var(--mc-bullish) 80%, transparent)', fontStyle: 'italic', lineHeight: 1.35 }}>
                    Why: {reasonFor(s, 'STRONG_BUY')}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* PATCH 0927 — RE-RATING block: only render when ≥1 row.
            User feedback: "remove these in multibagger analytics" because
            empty 0-state blocks waste real estate. Block re-appears the
            moment any score jumps ≥5 vs last upload. */}
        {stats.rerating.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            📈 RE-RATING in progress ({stats.rerating.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Score jumped ≥ 5 vs last upload, still grade A/A+.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stats.rerating.slice(0, 8).map((s) => {
              const delta = s.score - (s.prevScore as number);
              return (
                <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-cyan) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-cyan) 3%, transparent)', textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TickerCompanyCell ticker={s.symbol} company={s.company} />
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)', fontVariantNumeric: 'tabular-nums' }}>{s.prevScore} →</span>
                    <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>▲+{delta}</span>
                  </div>
                  <span style={{ fontSize: 9.5, color: '#67E8F9', fontStyle: 'italic', lineHeight: 1.35 }}>
                    Why: Score jumped ▲+{delta} vs last upload · still grade {s.grade}{s.sector ? ` · ${s.sector}` : ''}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
        )}

        {/* PATCH 0987 — MULTI-CONFIRMED screener picks */}
        <MultiConfirmedCard stocks={stocks} />

        {/* AVOID / TRIM */}
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-bearish)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            ⚠️ AVOID / TRIM ({stats.avoid.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Grade D, or grade C with ≥ 5-point drop.
          </div>
          {stats.avoid.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>Clean roster — no warning candidates.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stats.avoid.slice(0, 5).map((s) => {
                const delta = typeof s.prevScore === 'number' ? s.score - s.prevScore : null;
                return (
                  <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                      border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', textDecoration: 'none' }}>
                    {/* PATCH 1101a — Grade D label split. A clean Grade D is
                        "doesn't fit the megawinner mandate" (legit large cap,
                        cyclical conglomerate, etc.). Only fraud:* CRITICAL
                        flags warrant the 🚨 NEVER BUY treatment. */}
                    {(() => {
                      const isFraudFlagged = (s.redFlagSummary?.critical ?? 0) > 0;
                      const labelColor = isFraudFlagged ? 'var(--mc-bearish)' : 'var(--mc-text-4)';
                      const labelText  = isFraudFlagged ? '🚨 NEVER BUY' : 'NOT A SETUP';
                      return (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <TickerCompanyCell ticker={s.symbol} company={s.company} />
                            <span style={{ fontSize: 11, color: 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score} {s.grade}</span>
                            <span style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 5px', borderRadius: 3, color: labelColor, border: `1px solid ${labelColor}50`, letterSpacing: '0.4px' }}>{labelText}</span>
                            {delta !== null && delta < 0 && (
                              <span style={{ fontSize: 10, color: 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>▼{delta}</span>
                            )}
                          </div>
                          <span style={{ fontSize: 9.5, color: isFraudFlagged ? '#FCA5A5' : 'var(--mc-text-3)', fontStyle: 'italic', lineHeight: 1.35 }}>
                            {(() => {
                              if (isFraudFlagged) {
                                return `Why avoid: critical fraud-pattern flag fired${s.sector ? ` · ${s.sector}` : ''}`;
                              }
                              if (s.grade === 'D') {
                                return `Not a multibagger candidate by this framework's mandate (large-cap or cyclical without the early-compounder DNA). The business may still be perfectly fine to own — just not via this engine${s.sector ? ` · ${s.sector}` : ''}`;
                              }
                              return `Grade ${s.grade} with ${delta != null && delta < 0 ? `${Math.abs(delta)}-pt drop` : 'weak fundamentals'}${s.sector ? ` · ${s.sector}` : ''}`;
                            })()}
                          </span>
                        </>
                      );
                    })()}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 🔬 REVIEW · DATA INCOMPLETE (PATCH 0587) ──────────────────────
          Rows whose composite score landed below 30 but carry no red flags.
          Almost always means the Screener export was missing core metrics
          (debtor days / working capital / interest coverage etc.) rather
          than the business deteriorating. Splitting these out of AVOID
          per user feedback: "CRAFTSMAN 0D / QPOWER 5D / GARUDA 10D are
          probably data gaps, not deterioration." */}
      {stats.reviewDataGap && stats.reviewDataGap.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-state-persistent)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🔬 REVIEW · DATA INCOMPLETE ({stats.reviewDataGap.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            {/* PATCH 1101pp — copy is scope-aware (USA needs different columns). */}
            {scope === 'USA' ? (
              <>Very low score but no red flags — likely missing data in the TradingView export
              (P/E, EV/EBITDA, FCF margin, Piotroski F-score, ROIC). Re-export from TradingView with
              the &quot;Recommended extra columns&quot; listed on the USA Multibagger tab.</>
            ) : (
              <>Very low score but no red flags — likely missing data in the CSV (debtor days, working
              capital, interest coverage). Don&apos;t auto-avoid; verify the row in Screener and re-upload
              with the missing columns. METRICS_TO_ADD.md lists what to include.</>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stats.reviewDataGap.slice(0, 8).map((s) => (
              <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                  border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TickerCompanyCell ticker={s.symbol} company={s.company} />
                  <span style={{ fontSize: 11, color: 'var(--mc-state-persistent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                </div>
                <span style={{ fontSize: 9.5, color: '#C4B5FD', fontStyle: 'italic', lineHeight: 1.35 }}>
                  Why review: 0 flags but score &lt; 30 — check Screener export for missing metrics{s.sector ? ` · ${s.sector}` : ''}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── 💎 VALUATION GATEWAY (PATCH 0588) ─────────────────────────────
          A-grade names that ALSO clear a valuation discipline: PEG <2,
          plus PB/ROE bonus when PB<1.5 + ROE>15%. Separates "expensive
          A-grade" (NMDC at 90, MAYURUNIQ at 30 P/E both score A) from
          "cheap A-grade you can actually buy". Pulled in directly from
          the existing row fields — no new data required. */}
      {stats.valuationGate && stats.valuationGate.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)', background: 'linear-gradient(180deg, color-mix(in srgb, var(--mc-cyan) 6%, transparent) 0%, transparent 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.4px' }}>
              💎 VALUATION GATEWAY ({stats.valuationGate.length})
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>
              A-GRADE + CHEAP
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
            A-grade names that <strong>also clear the valuation gate</strong> (PEG &lt; 2 + optional
            PB/ROE bonus). Separates expensive quality from buyable quality. PEG &lt;1 = 15pts,
            &lt;1.5 = 10pts, &lt;2 = 5pts; PB&lt;1.5 with ROE&gt;15% adds 5pts. Minimum 10 to qualify.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 6 }}>
            {stats.valuationGate.map((s: any) => (
              <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent((s.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                title={`Valuation score ${s.valuationScore}/20 — ${s.valuationNotes || 'PEG / PB / ROE composite'}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px', borderRadius: 4,
                  border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-cyan) 6%, transparent)', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TickerCompanyCell ticker={s.symbol} company={s.company} />
                  <span style={{ fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                  <span style={{ fontSize: 9, color: 'var(--mc-cyan)', fontWeight: 800, padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' }}>
                    V {s.valuationScore}
                  </span>
                </div>
                <span style={{ fontSize: 9.5, color: '#67E8F9', fontStyle: 'italic', lineHeight: 1.35 }}>
                  {s.valuationNotes || '—'}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── 🎯 TRIPLE-CONFIRMED (PATCH 0554) ─────────────────────────────────
          Scored A+/A  ∩  Conviction Beats bench  ∩  decision = BUY / WATCH.
          The intersection of three independent signals.  Highest-conviction
          names — show them first because they're the actionable shortlist. */}
      {stats.tripleConfirmed.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-warn) 44%, transparent)', background: 'linear-gradient(180deg, color-mix(in srgb, var(--mc-warn) 6%, transparent) 0%, transparent 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 13, color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.4px' }}>
              🎯 TRIPLE-CONFIRMED ({stats.tripleConfirmed.length})
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>HIGHEST CONVICTION</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 10, lineHeight: 1.5 }}>
            Score <span style={{ color: 'var(--mc-bullish)', fontWeight: 700 }}>A+/A</span>  ∩  on{' '}
            <span style={{ color: 'var(--mc-warn)', fontWeight: 700 }}>Conviction Beats</span>  ∩  decision ={' '}
            <span style={{ color: 'var(--mc-cyan)', fontWeight: 700 }}>BUY/WATCH</span>. Independent confirmation from three layers.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 6 }}>
            {stats.tripleConfirmed.slice(0, 18).map((s) => {
              const dec = (s as any)._decision as { status: DecisionStatus; reason: string } | undefined;
              const decColor = dec?.status === 'BUY' ? '#10B981' : '#22D3EE';
              return (
                <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                  title={dec?.reason ? `Logbook reason: ${dec.reason}` : ''}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)', textDecoration: 'none' }}>
                  <TickerCompanyCell ticker={s.symbol} company={s.company} />
                  <span style={{ fontSize: 10, color: 'var(--mc-warn)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                  <span style={{ fontSize: 9, color: decColor, fontWeight: 800, padding: '1px 5px', borderRadius: 3, border: `1px solid ${decColor}50` }}>{dec?.status}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 🎯 DECISION BRIDGE (PATCH 0554) ─────────────────────────────────
          Three side-by-side panels that answer: "what should I do NEXT
          given the disagreement between my scorer, my bench, and my
          logbook?". Each panel is a one-click drill-in. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 12 }}>
        {/* ADD CANDIDATES — A+ but NOT on CB */}
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-bullish)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            ➕ ADD TO BENCH ({stats.decisionBridge.addCandidates.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Score A+/A but not yet on Conviction Beats. Open the row in Earnings Opportunities to add.
          </div>
          {stats.decisionBridge.addCandidates.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>All A-grade names already on the bench.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stats.decisionBridge.addCandidates.map((s) => (
                <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                    border: '1px solid color-mix(in srgb, var(--mc-bullish) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)', textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TickerCompanyCell ticker={s.symbol} company={s.company} />
                    <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                    <span style={{ fontSize: 9, color: 'var(--mc-text-3)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector || '—'}</span>
                  </div>
                  <span style={{ fontSize: 9.5, color: 'color-mix(in srgb, var(--mc-bullish) 80%, transparent)', fontStyle: 'italic', lineHeight: 1.35 }}>
                    Why: {reasonFor(s, 'ADD')}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* DROP ALERTS — on CB but score deteriorated */}
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-bearish)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            ⚠ TRIM ALERTS ({stats.decisionBridge.dropAlerts.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            On Conviction Beats but score has dropped ≥5 or grade fell to B or below. Review for trim.
          </div>
          {stats.decisionBridge.dropAlerts.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>Bench is clean — no deterioration flagged.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stats.decisionBridge.dropAlerts.map((s) => {
                const delta = typeof s.prevScore === 'number' ? s.score - (s.prevScore as number) : null;
                return (
                  <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                      border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 11, color: 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                      {delta !== null && delta < 0 && (
                        <span style={{ fontSize: 10, color: 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>▼{delta}</span>
                      )}
                    </div>
                    <span style={{ fontSize: 9.5, color: '#FCA5A5', fontStyle: 'italic', lineHeight: 1.35 }}>
                      Why trim: {reasonFor(s, 'TRIM')}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* PATCH 0927 — RE-EVALUATE block: only render when ≥1 row.
            Block re-appears the moment any REJECTED ticker re-grades to A+/A. */}
        {stats.decisionBridge.reEvaluate.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-state-persistent)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🔄 RE-EVALUATE ({stats.decisionBridge.reEvaluate.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            You earlier marked these REJECTED, but the scorer now grades them A+/A. Was the rejection too early?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stats.decisionBridge.reEvaluate.map((s) => {
                const dec = (s as any)._decision as { reason: string; date: string } | undefined;
                return (
                  <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                    title={dec ? `Reason: ${dec.reason || '—'}\nDate: ${(dec.date || '').slice(0, 10)}` : ''}
                    style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 9px', borderRadius: 4,
                      border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 11, color: 'var(--mc-state-persistent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}{s.grade}</span>
                    </div>
                  <span style={{ fontSize: 9.5, color: '#C4B5FD', fontStyle: 'italic', lineHeight: 1.35 }}>
                    Why revisit: {reasonFor(s as any, 'REEVAL')}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
        )}
      </div>

      {/* ── 🔍 QUALITY AUDIT (PATCH 0554) ────────────────────────────────────
          "How clean is my A+ universe?" — the PAYS-post-mortem question.
          One side per market (India structural / cyclical; USA forensic). */}
      {stats.qualityAudit.aTotal > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
            🔍 QUALITY AUDIT — A-roster ({stats.qualityAudit.aTotal})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
            Don't trust the A+ label until you know what's flagged inside it. Audit the latent risk.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 12 }}>
            {/* India structural / cyclical */}
            {stats.qualityAudit.indiaTotal > 0 && (
              <div style={{ border: '1px solid var(--mc-bg-4)', borderRadius: 4, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 6 }}>🇮🇳 INDIA ({stats.qualityAudit.indiaTotal})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>
                    ✓ CLEAN {stats.qualityAudit.indCleanCount}
                  </span>
                  {stats.qualityAudit.indCriticalCount > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', color: 'var(--mc-bearish)', fontWeight: 700 }}>
                      🛑 CRITICAL {stats.qualityAudit.indCriticalCount}
                    </span>
                  )}
                  {stats.qualityAudit.indStructuralCount > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', fontWeight: 700 }}>
                      ⚠ HIGH STRUCTURAL {stats.qualityAudit.indStructuralCount}
                    </span>
                  )}
                  {stats.qualityAudit.indCyclicalCount > 0 && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', color: 'var(--mc-cyan)', fontWeight: 700 }}>
                      ◐ CYCLICAL {stats.qualityAudit.indCyclicalCount}
                    </span>
                  )}
                </div>
                {stats.qualityAudit.indFlaggedRoster.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {stats.qualityAudit.indFlaggedRoster.map((s) => (
                      <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 3,
                          border: '1px solid color-mix(in srgb, var(--mc-warn) 15%, transparent)', background: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)', textDecoration: 'none' }}>
                        <TickerCompanyCell ticker={s.symbol} company={s.company} />
                        {(s.redFlagSummary?.critical ?? 0) > 0 && (
                          <span style={{ fontSize: 9, color: 'var(--mc-bearish)', fontWeight: 700 }}>🛑{s.redFlagSummary?.critical}</span>
                        )}
                        {(s.redFlagSummary?.structural ?? 0) > 0 && (
                          <span style={{ fontSize: 9, color: 'var(--mc-warn)', fontWeight: 700 }}>⚠{s.redFlagSummary?.structural}</span>
                        )}
                        {(s.redFlagSummary?.cyclical ?? 0) > 0 && (
                          <span style={{ fontSize: 9, color: 'var(--mc-cyan)', fontWeight: 700 }}>◐{s.redFlagSummary?.cyclical}</span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* USA forensic flags */}
            {stats.qualityAudit.usaTotal > 0 && (
              <div style={{ border: '1px solid var(--mc-bg-4)', borderRadius: 4, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 800, marginBottom: 6 }}>🇺🇸 USA ({stats.qualityAudit.usaTotal})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>
                    ✓ CLEAN {stats.qualityAudit.usaCleanCount}
                  </span>
                  {stats.qualityAudit.usaFcfDivCount > 0 && (
                    <span title="FCF margin > 2× Op-Income margin: working-capital / SBC noise inflating FCF" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', color: 'var(--mc-bearish)', fontWeight: 700 }}>
                      🚨 FCF SUSPECT {stats.qualityAudit.usaFcfDivCount}
                    </span>
                  )}
                  {stats.qualityAudit.usaPostRunCount > 0 && (
                    <span title="Up >100% in 1y AND FwdPE >25 — priced for perfection (PAYS pattern)" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', fontWeight: 700 }}>
                      🌡 STRETCHED {stats.qualityAudit.usaPostRunCount}
                    </span>
                  )}
                  {stats.qualityAudit.usaEarnSoonCount > 0 && (
                    <span title="Reports within 7 days — wait for the print" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', color: 'var(--mc-state-persistent)', fontWeight: 700 }}>
                      ⚠ EARNINGS &lt;7d {stats.qualityAudit.usaEarnSoonCount}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {stats.qualityAudit.usaFcfDivList.map((s) => (
                    <a key={`fcf-${s.symbol}`} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 3,
                        border: '1px solid color-mix(in srgb, var(--mc-bearish) 15%, transparent)', background: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', textDecoration: 'none' }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 9, color: 'var(--mc-bearish)', fontWeight: 700 }}>🚨 FCF</span>
                    </a>
                  ))}
                  {stats.qualityAudit.usaPostRunList.map((s) => (
                    <a key={`pr-${s.symbol}`} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 3,
                        border: '1px solid color-mix(in srgb, var(--mc-warn) 15%, transparent)', background: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)', textDecoration: 'none' }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 9, color: 'var(--mc-warn)', fontWeight: 700 }}>🌡 STR</span>
                    </a>
                  ))}
                  {stats.qualityAudit.usaEarnSoonList.map((s) => (
                    <a key={`er-${s.symbol}`} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 3,
                        border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 15%, transparent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)', textDecoration: 'none' }}>
                      <TickerCompanyCell ticker={s.symbol} company={s.company} />
                      <span style={{ fontSize: 9, color: 'var(--mc-state-persistent)', fontWeight: 700 }}>⚠ {s.earningsProximityDays}d</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Decision-coverage strip */}
          {stats.decisionBridge.aTotal > 0 && (
            <div style={{ marginTop: 10, padding: '6px 8px', borderTop: '1px solid var(--mc-bg-4)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ color: 'var(--mc-text-4)', fontWeight: 700 }}>DECISION COVERAGE</span>
              <span style={{ color: 'var(--mc-cyan)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {stats.decisionBridge.aDecisionCount}/{stats.decisionBridge.aTotal}
              </span>
              <span style={{ color: 'var(--mc-text-3)' }}>
                A-roster names have a Decision Logbook entry —{' '}
                <span style={{ color: stats.decisionBridge.aTotal - stats.decisionBridge.aDecisionCount > 0 ? 'var(--mc-warn)' : 'var(--mc-bullish)', fontWeight: 700 }}>
                  {stats.decisionBridge.aTotal - stats.decisionBridge.aDecisionCount} still untagged
                </span>.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── 🏭 OPERATING LEVERAGE CLUSTER (PATCH 0578) ───────────────────────
          §17.4(C) ranking-framework upgrade. 2×2 cluster + weighted Cluster
          Score formula derives a 0-100 conviction number per India row:
            0.30·Utilization-Evidence (ROCE, sales accel, OPM trend)
          + 0.25·Margin-Inflection (EBITDA/Sales growth ratio, OPM)
          + 0.20·BS-Repair (D/E, ICR, FCF)
          + 0.15·Demand-Durability (sector prior + 3yr CAGR)
          + 0.10·Value-Added-Mix (GPM, ROIC)
          minus downgrade triggers (OPM compress / debt rising / capex peaking).
          User-seeded core lights up with a ⭐.
          PATCH 1101ii — The cluster formula uses India-specific fields (ROCE,
          cfoToPat, capex trend, debt creep history) that the USA scorer
          doesn't compute. When the user is on USA scope, this widget was
          showing leftover Indian rows. Now hidden unless scope === 'INDIA'. */}
      {scope === 'INDIA' && stats.clusterRanked && stats.clusterRanked.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.4px' }}>
              🏭 OPERATING LEVERAGE CLUSTER ({stats.clusterHighConv.length} high-conviction · {stats.clusterEmerging.length} emerging)
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>§17.4(C)</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
            Cluster Score = 0.30·Utilization + 0.25·Margin-Inflection + 0.20·BS-Repair + 0.15·Demand-Durability + 0.10·Value-Added-Mix.
            ⭐ marks user-curated cluster seeds (SHYAMMETL, AJAXENGG, NELCAST, GOPAL, JNKINDIA, TRITURBINE).
            Downgrades penalize capex peaks, debt creep, margin compression.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 8 }}>
            {stats.clusterRanked.slice(0, 18).map((c) => {
              const meta = CLUSTER_TIER_META[c.cluster.tier];
              return (
                <a key={c.symbol} href={`/stock-sheet?ticker=${encodeURIComponent((c.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                  title={[
                    `Cluster Score: ${c.cluster.score}/100  (${meta.label})`,
                    `Factors: util ${c.cluster.factors.utilizationEvidence}/10 · margin ${c.cluster.factors.marginInflection}/10 · BS ${c.cluster.factors.bsRepair}/10 · demand ${c.cluster.factors.demandDurability}/10 · VA ${c.cluster.factors.valueAddedMix}/10`,
                    c.cluster.notes.length ? `Notes: ${c.cluster.notes.join(' | ')}` : '',
                    c.cluster.downgrades.length ? `Downgrades: ${c.cluster.downgrades.join(' | ')}` : '',
                  ].filter(Boolean).join('\n')}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px', borderRadius: 4,
                    border: `1px solid ${meta.color}40`, background: `${meta.color}10`, textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TickerCompanyCell ticker={c.isSeed ? `⭐ ${c.symbol}` : c.symbol} company={c.company} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: meta.color, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>{c.cluster.score}</span>
                    <span style={{ fontSize: 9, fontWeight: 800, color: meta.color, padding: '1px 5px', borderRadius: 3, background: `${meta.color}22`, letterSpacing: '0.3px' }}>{meta.emoji} {meta.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--mc-text-3)' }}>
                    <span title="Utilization Evidence">UTIL {c.cluster.factors.utilizationEvidence}</span>
                    <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                    <span title="Margin Inflection">MARG {c.cluster.factors.marginInflection}</span>
                    <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                    <span title="Balance-Sheet Repair">BS {c.cluster.factors.bsRepair}</span>
                    <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                    <span title="Demand Durability">DEM {c.cluster.factors.demandDurability}</span>
                    <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                    <span title="Value-Added Mix">VA {c.cluster.factors.valueAddedMix}</span>
                    <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{c.score}{c.grade}</span>
                  </div>
                  {c.cluster.downgrades.length > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--mc-warn)', fontStyle: 'italic' }}>
                      ⚠ {c.cluster.downgrades.join(' · ')}
                    </div>
                  )}
                </a>
              );
            })}
          </div>
          {stats.clusterRanked.length > 18 && (
            <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 6, fontStyle: 'italic' }}>
              Showing top 18 of {stats.clusterRanked.length} ranked. Lower tiers (WATCH / SKIP) hidden.
            </div>
          )}
          {/* PATCH 0586 — DATA INCOMPLETE block. User reported all rows
              showing UTIL 4 / MARG 0 — root cause was that rows lacking
              key fundamentals were silently scored at 0. Now those rows
              are clearly labeled and surfaced as a separate strip so the
              analyst knows to add the missing columns to their Screener
              export rather than thinking the company is poor quality. */}
          {stats.clusterIncomplete && stats.clusterIncomplete.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--mc-bg-4)' }}>
              <div style={{ fontSize: 11, color: 'var(--mc-state-persistent)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 6 }}>
                ❓ DATA INCOMPLETE ({stats.clusterIncomplete.length})
              </div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 8 }}>
                Cluster formula needs at least 2 of: ROCE · OPM (TTM/Annual) · sales growth · D/E.
                Add the missing columns to the Screener export and re-upload to score these.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {stats.clusterIncomplete.slice(0, 18).map((c) => (
                  <a key={c.symbol} href={`/stock-sheet?ticker=${encodeURIComponent((c.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                    style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-state-persistent)',
                      border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 19%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)',
                      padding: '3px 8px', borderRadius: 4, textDecoration: 'none' }}>
                    {c.isSeed && '⭐ '}{c.company || c.symbol}
                  </a>
                ))}
                {stats.clusterIncomplete.length > 18 && (
                  <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>+ {stats.clusterIncomplete.length - 18} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 💰 CASH-RICH · NET-ZERO DEBT (PATCH 0578.5) ─────────────────────
          User-requested "next hunting process" lens. Surfaces names with
          cash ≥ 20% of market cap AND effectively no debt (D/E < 0.10
          or net cash by ND/EBITDA / netDebtUsd). Pure balance-sheet
          filter — composite score / grade are shown but don't gate. */}
      {stats.cashRich && stats.cashRich.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--mc-bullish)', fontWeight: 800, letterSpacing: '0.4px' }}>
              💰 CASH RICH · NET-ZERO DEBT ({stats.cashRich.length})
            </div>
            <span style={{ fontSize: 10, color: 'var(--mc-bullish)', background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>NEXT-HUNT LENS</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
            Cash ≥ 20% of market cap <strong>AND</strong> effectively zero debt (D/E &lt; 0.10 or net-cash by ND/EBITDA).
            These names have optionality — they can buyback, acquire, or weather a downturn without dilution.
            Composite score is informational only; the lens is pure balance-sheet quality.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {stats.cashRich.slice(0, 24).map((r) => (
              <a key={r.market + ':' + r.symbol} href={`/stock-sheet?ticker=${encodeURIComponent((r.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                title={`${r.cashAbsLabel} cash · ${r.cashToMcapPct}% of market cap · ${r.debtIndicator}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px', borderRadius: 4,
                  border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-bullish) 6%, transparent)', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TickerCompanyCell ticker={r.symbol} company={r.company} />
                  <span style={{ fontSize: 9, color: r.market === 'INDIA' ? 'var(--mc-bullish)' : 'var(--mc-cyan)', fontWeight: 800 }}>{r.market === 'INDIA' ? '🇮🇳' : '🇺🇸'}</span>
                  <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{r.score}{r.grade}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--mc-text-3)' }}>
                  <span style={{ color: 'var(--mc-bullish)', fontWeight: 700 }}>{r.cashAbsLabel}</span>
                  <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                  <span>{r.cashToMcapPct}% of mcap</span>
                  <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
                  <span style={{ color: 'var(--mc-bullish)', fontStyle: 'italic' }}>{r.debtIndicator}</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>{r.sector || '—'}</div>
              </a>
            ))}
          </div>
          {stats.cashRich.length > 24 && (
            <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 6, fontStyle: 'italic' }}>
              Showing top 24 of {stats.cashRich.length} qualifying. Sort: highest cash/mcap ratio first.
            </div>
          )}
        </div>
      )}

      {/* ── SCORE HISTOGRAM (PATCH 0548) ────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
          📊 SCORE HISTOGRAM
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10 }}>
          Shape of your universe — bimodal? Top-heavy? Long tail?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(() => {
            const maxCount = Math.max(1, ...stats.histogram.map((b) => b.count));
            return stats.histogram.map((b) => {
              const pct = stats.total > 0 ? Math.round((b.count / stats.total) * 100) : 0;
              const widthPct = Math.round((b.count / maxCount) * 100);
              const tone = b.min >= 80 ? '#10B981' : b.min >= 70 ? '#22D3EE' : b.min >= 60 ? '#3B82F6'
                : b.min >= 50 ? '#F59E0B' : b.min >= 40 ? '#94A3B8' : '#EF4444';
              return (
                <div key={b.bin} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 50, fontVariantNumeric: 'tabular-nums' }}>{b.bin}</span>
                  <span style={{ fontSize: 11, color: 'var(--mc-text-3)', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
                  <div style={{ flex: 1, height: 8, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${widthPct}%`, height: '100%', background: tone }} />
                  </div>
                  <span style={{ fontSize: 11, color: tone, fontWeight: 700, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* ── CAP-SIZE BREAKDOWN (PATCH 0548, India only) ─────────────────── */}
      {stats.hasCapData && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🏛 CAP-SIZE BREAKDOWN (India)
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10 }}>
            Balance your portfolio concentration across size buckets.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {stats.capBuckets.map((b) => {
              const tone = b.avgScore >= 70 ? '#10B981' : b.avgScore >= 55 ? '#22D3EE' : b.avgScore >= 40 ? '#F59E0B' : '#94A3B8';
              return (
                <div key={b.label} style={{ padding: '8px 10px', border: '1px solid var(--mc-bg-4)', borderRadius: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, marginBottom: 4 }}>{b.label}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--mc-text-1)', fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>stocks</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: tone, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>avg {b.avgScore}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!stats.hasCapData && scope !== 'USA' && (
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontStyle: 'italic', padding: '0 4px' }}>
          (Cap-size breakdown skipped — no market-cap data in current upload.)
        </div>
      )}

      {/* ── HIDDEN GEMS (PATCH 0548) ────────────────────────────────────── */}
      {stats.hiddenGems.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: 'var(--mc-state-persistent)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            💎 HIDDEN GEMS ({stats.hiddenGems.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
            Score ≥ 70, not yet on Conviction Beats, in sectors with avg &lt; 60 —
            <span style={{ color: 'var(--mc-text-2)' }}> they passed your quality bar but the rest of their sector hasn't moved. Alpha window.</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
            {stats.hiddenGems.map((s) => (
              <a key={s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 4,
                  border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)', background: 'color-mix(in srgb, var(--mc-state-persistent) 6%, transparent)', textDecoration: 'none' }}>
                <TickerCompanyCell ticker={s.symbol} company={s.company} />
                <span style={{ fontSize: 10, color: 'var(--mc-state-persistent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
                <span style={{ fontSize: 9, color: 'var(--mc-text-3)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector || '—'}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── 🇺🇸 USA RULE OF 40 + CAP TIER (PATCH 1101ll) ─────────────────────
          USA-specific widget that surfaces the metrics that actually matter
          for US multibagger hunting: Rule of 40 buckets, cap-tier breakdown,
          and the top R40 names. The India side has its own composite (Q50,
          ROCE etc.) — different mental model. Hidden when scope === INDIA. */}
      {scope === 'USA' && (() => {
        // PATCH 1101mm — stocks uses `market` (not `_market`); ruleOf40 is now
        // carried through the USA mapping so we read it directly.
        const usaRows = (stocks as any[]).filter((r: any) => r.market === 'USA');
        const r40s = usaRows
          .map(r => ({ s: r, v: (r.ruleOf40 ?? (typeof r.revenueGrowthAnn === 'number' && typeof r.fcfMarginAnn === 'number' ? r.revenueGrowthAnn + r.fcfMarginAnn : undefined)) }))
          .filter(x => typeof x.v === 'number') as { s: any; v: number }[];
        if (r40s.length === 0) return null;
        const buckets = [
          { label: '🏆 Elite ≥80', test: (v: number) => v >= 80, color: '#10B981' },
          { label: 'Strong 60-80', test: (v: number) => v >= 60 && v < 80, color: '#22D3EE' },
          { label: 'Passes 40-60', test: (v: number) => v >= 40 && v < 60, color: '#3B82F6' },
          { label: 'Weak 20-40',   test: (v: number) => v >= 20 && v < 40, color: '#F59E0B' },
          { label: 'Below 0-20',   test: (v: number) => v >= 0 && v < 20, color: '#FB923C' },
          { label: 'Burning <0',   test: (v: number) => v < 0,            color: '#EF4444' },
        ].map(b => ({ ...b, count: r40s.filter(x => b.test(x.v)).length, names: r40s.filter(x => b.test(x.v)).slice(0, 5).map(x => x.s.symbol) }));
        const top10R40 = [...r40s].sort((a, b) => b.v - a.v).slice(0, 20);
        const tiers = ['MICRO', 'SMALL', 'MID', 'LARGE', 'MEGA'] as const;
        // PATCH 1101pp — Use MEDIAN instead of MEAN for R40. Outliers like
        // HGRAF (-11438) wreck mean averages — SMALL was showing -553 even
        // when 9 of 30 stocks are elite (R40 ≥ 60). Median ignores tails.
        const median = (arr: number[]) => {
          if (!arr.length) return 0;
          const s = [...arr].sort((a, b) => a - b);
          const m = Math.floor(s.length / 2);
          return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : Math.round(s[m]);
        };
        const byTier = tiers.map(t => {
          const subset = usaRows.filter((r: any) => r.capTier === t);
          if (subset.length === 0) return null;
          const r40sub = subset.map((r: any) => r.ruleOf40 ?? 0);
          const medR40 = median(r40sub);
          const elite = subset.filter((r: any) => (r.ruleOf40 ?? 0) >= 60).length;
          const passing = subset.filter((r: any) => (r.ruleOf40 ?? 0) >= 40).length;
          return { tier: t, count: subset.length, avgR40: medR40, elite, passing };
        }).filter(Boolean) as { tier: string; count: number; avgR40: number; elite: number; passing: number }[];
        return (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: '#22D3EE', fontWeight: 800, letterSpacing: '0.4px' }}>
                🇺🇸 RULE OF 40 · USA SIGNATURE METRIC
              </div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>
                R40 = revenue growth + FCF margin · institutional benchmark for SaaS-era compounders.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6, marginBottom: 12 }}>
              {buckets.map(b => (
                <div key={b.label} style={{ padding: '8px 10px', background: `${b.color}10`, border: `1px solid ${b.color}40`, borderRadius: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 11, color: b.color, fontWeight: 800 }}>{b.label}</span>
                    <span style={{ fontSize: 14, color: b.color, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--mc-text-3)', marginTop: 3, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.names.length > 0 ? b.names.join(' · ') : '—'}
                  </div>
                </div>
              ))}
            </div>
            {byTier.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.3px' }}>
                  Cap-Tier Breakdown · median R40 (outlier-resistant) + R40 ≥ 40 (passes) and ≥ 60 (elite)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6, marginBottom: 12 }}>
                  {byTier.map(t => (
                    <div key={t.tier} style={{ padding: '6px 10px', background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 5 }}>
                      <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px' }}>{t.tier}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 13, color: 'var(--mc-text-1)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{t.count}</span>
                        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>names</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#22D3EE', fontWeight: 700 }}>R40 med {t.avgR40}</span>
                      </div>
                      <div style={{ fontSize: 9, color: '#10B981', fontWeight: 700, marginTop: 1 }}>{t.elite} elite · {t.passing} pass</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.3px' }}>
              Top 20 by Rule of 40
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 4 }}>
              {top10R40.map((x, i) => (
                <a key={x.s.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(x.s.symbol)}&market=us`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 4,
                    background: x.v >= 80 ? '#10B98114' : x.v >= 60 ? '#22D3EE14' : 'transparent',
                    border: `1px solid ${x.v >= 80 ? '#10B98140' : x.v >= 60 ? '#22D3EE40' : 'var(--mc-bg-4)'}`,
                    textDecoration: 'none' }}>
                  <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 800, minWidth: 18 }}>#{i + 1}</span>
                  <TickerCompanyCell ticker={x.s.symbol} company={x.s.company} />
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: x.v >= 80 ? '#10B981' : x.v >= 60 ? '#22D3EE' : 'var(--mc-text-2)', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{Math.round(x.v)}</span>
                </a>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── ⚡ USA OPERATING LEVERAGE — BEST STOCKS (PATCH zzz128) ───────────
          Right after Rule of 40 (which is on the same theme — institutional
          quality metrics) so users find it without scrolling deep. Always
          renders when scope includes USA so the user gets visual feedback
          (either the leaders, or a "no candidates with the data we need"
          message). zzz127 was placed too deep — buried mid-page. */}
      {(scope === 'USA' || scope === 'BOTH') && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: '#84CC16', fontWeight: 800, letterSpacing: '0.4px' }}>
              ⚡ 🇺🇸 USA OPERATING LEVERAGE — BEST STOCKS
            </div>
            <div style={{ fontSize: 10, color: 'var(--mc-text-4, var(--mc-muted))' }}>
              EPS growth ÷ Revenue growth (YoY). &gt;1× = margins expanding · &gt;2× = strong op-lev firing.
            </div>
          </div>

          {stats.usaOpLevTop && stats.usaOpLevTop.length > 0 ? (
            <>
              {/* Tier summary chips */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: '#10B981', background: 'color-mix(in srgb, #10B981 13%, transparent)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>STRONG ≥1.5× · {stats.usaOpLevStrong?.length || 0}</span>
                <span style={{ fontSize: 11, color: '#84CC16', background: 'color-mix(in srgb, #84CC16 13%, transparent)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>POSITIVE 1–1.5× · {stats.usaOpLevPositive?.length || 0}</span>
                <span style={{ fontSize: 11, color: 'var(--mc-muted)', background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>Eligible · {stats.usaOpLevEligibleCount || 0} of {(usaRows || []).length}</span>
              </div>

              {/* Strong leaders grid */}
              {stats.usaOpLevStrong && stats.usaOpLevStrong.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: '#10B981', fontWeight: 800, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>🏆 STRONG (≥1.5×) — margins firing</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, marginBottom: 12 }}>
                    {stats.usaOpLevStrong.map((r: any) => {
                      const tierColor = r.opLev >= 2 ? '#10B981' : '#22C55E';
                      return (
                        <div key={r.symbol} style={{ background: 'var(--mc-panel2, rgba(255,255,255,0.03))', border: `1px solid color-mix(in srgb, ${tierColor} 35%, transparent)`, borderLeft: `3px solid ${tierColor}`, borderRadius: 8, padding: 9 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-cyan)' }}>{r.symbol}</span>
                            {r.grade ? <span style={{ fontSize: 10, color: 'var(--mc-muted)', fontWeight: 700 }}>{r.grade}</span> : null}
                            <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 900, color: tierColor }}>{r.opLev.toFixed(1)}×</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--mc-txt, #e6edf3)', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.company || ''}>
                            {r.company || r.symbol}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--mc-muted)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <span title="EPS growth YoY">EPS {r.epsGrowth.toFixed(0)}%</span>
                            <span title="Revenue growth YoY">Rev {r.revGrowth.toFixed(0)}%</span>
                            {typeof r.opmTtm === 'number' ? <span title="Operating margin TTM">OpM {r.opmTtm.toFixed(0)}%</span> : null}
                            {typeof r.marketCapB === 'number' ? <span title="Market cap">${r.marketCapB.toFixed(1)}B</span> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Positive but not strong */}
              {stats.usaOpLevPositive && stats.usaOpLevPositive.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: '#84CC16', fontWeight: 800, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>POSITIVE (1–1.5×) — early signs</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6 }}>
                    {stats.usaOpLevPositive.map((r: any) => (
                      <div key={r.symbol} style={{ background: 'var(--mc-panel2, rgba(255,255,255,0.02))', border: '1px solid color-mix(in srgb, #84CC16 25%, transparent)', borderRadius: 6, padding: '6px 8px', fontSize: 11 }}>
                        <span style={{ fontWeight: 800, color: 'var(--mc-cyan)' }}>{r.symbol}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: '#84CC16', float: 'right' }}>{r.opLev.toFixed(1)}×</span>
                        <div style={{ color: 'var(--mc-muted)', fontSize: 10, marginTop: 2 }}>EPS {r.epsGrowth.toFixed(0)}% · Rev {r.revGrowth.toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--mc-muted)' }}>
                Color bands: <b style={{ color: '#10B981' }}>≥ 2×</b> strong · <b style={{ color: '#22C55E' }}>1.5–2×</b> green · <b style={{ color: '#84CC16' }}>1–1.5×</b> positive. Rows where revenue growth ≤ 0 are excluded. Negative op-lev (EPS shrinking while rev grows) means margin erosion.
              </div>
            </>
          ) : (
            <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid color-mix(in srgb, #F59E0B 30%, transparent)', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 12, color: '#F59E0B', fontWeight: 700, marginBottom: 4 }}>⚠ No Op-Lev candidates yet</div>
              <div style={{ fontSize: 11.5, color: 'var(--mc-muted)', lineHeight: 1.5 }}>
                Op Leverage needs <b>both</b> EPS growth and Revenue growth (YoY %) per row. Out of {(usaRows || []).length} USA stocks loaded, {stats.usaOpLevEligibleCount || 0} have both fields populated with rev &gt; 0. Re-export your USA Multibagger CSV from TradingView with these columns enabled: <i>Revenue growth %, Annual YoY</i> and <i>Earnings per share diluted growth %, TTM YoY</i>.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 💎 USA QUALITY LEADERS (PATCH 1101mm) ────────────────────────────
          Top ROIC + ROE + Piotroski names. The "true compounder DNA" check —
          can the business consistently turn capital into returns above cost?
          Surfaces the actual highest-quality franchises across cap tiers. */}
      {scope === 'USA' && (() => {
        const usaRows = (stocks as any[]).filter((r: any) => r.market === 'USA');
        const withRoic = usaRows.filter((r: any) => typeof r.roic === 'number').sort((a: any, b: any) => (b.roic ?? 0) - (a.roic ?? 0)).slice(0, 8);
        const withPiotroski = usaRows.filter((r: any) => typeof r.piotroskiFScore === 'number' && r.piotroskiFScore >= 7).sort((a: any, b: any) => (b.piotroskiFScore ?? 0) - (a.piotroskiFScore ?? 0)).slice(0, 8);
        const cashBurners = usaRows.filter((r: any) => typeof r.fcfMarginAnn === 'number' && r.fcfMarginAnn < -10).sort((a: any, b: any) => (a.fcfMarginAnn ?? 0) - (b.fcfMarginAnn ?? 0)).slice(0, 8);
        if (withRoic.length === 0 && withPiotroski.length === 0 && cashBurners.length === 0) return null;
        const sec = (color: string, title: string, sub: string, rows: any[], valueFn: (r: any) => string, valueColor: string) => (
          rows.length === 0 ? null : (
            <div style={{ padding: '8px 10px', background: `${color}10`, border: `1px solid ${color}40`, borderRadius: 5 }}>
              <div style={{ fontSize: 11, color, fontWeight: 800, letterSpacing: '0.3px' }}>{title}</div>
              <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginBottom: 6 }}>{sub}</div>
              {rows.map((r: any) => (
                <a key={r.symbol} href={`/stock-sheet?ticker=${encodeURIComponent(r.symbol)}&market=us`}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', textDecoration: 'none' }}>
                  <span style={{ fontSize: 11, color: 'var(--mc-text-2)', fontWeight: 700, minWidth: 50 }}>{r.symbol}</span>
                  <span style={{ fontSize: 10, color: 'var(--mc-text-4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</span>
                  <span style={{ fontSize: 11, color: valueColor, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{valueFn(r)}</span>
                </a>
              ))}
            </div>
          )
        );
        return (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, color: '#22D3EE', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 8 }}>
              💎 USA QUALITY LEADERS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
              {sec('#10B981', '🏆 ROIC Leaders', 'Returns on invested capital — Buffett tier', withRoic, (r) => `${r.roic?.toFixed(0)}%`, '#10B981')}
              {sec('#3B82F6', '🛡 Piotroski ≥ 7/9', 'Earnings-quality score, accruals + leverage check', withPiotroski, (r) => `${r.piotroskiFScore}/9`, '#3B82F6')}
              {sec('#EF4444', '🛑 Cash Burners (FCF < -10%)', 'Negative FCF margin — needs growth or capital raise', cashBurners, (r) => `${r.fcfMarginAnn?.toFixed(0)}%`, '#EF4444')}
            </div>
          </div>
        );
      })()}

      {/* ── 🇺🇸 USA SECTOR-R40 HEATMAP (PATCH 1101mm) ────────────────────────
          Average R40 per sector — finds which sectors are firing on growth +
          cash flow simultaneously. Sectors with avg R40 ≥ 40 are the hunting
          ground; sectors with avg < 0 are deathtraps. */}
      {scope === 'USA' && (() => {
        const usaRows = (stocks as any[]).filter((r: any) => r.market === 'USA' && typeof r.ruleOf40 === 'number');
        if (usaRows.length === 0) return null;
        // PATCH 1101pp — Sector heatmap also switched to median R40. Mean
        // was producing "Producer manufacturing R40 -878" because of a handful
        // of crypto-miner / SPAC outliers in that bucket.
        const sectorMapM = new Map<string, { r40s: number[]; scores: number[]; elite: number; passing: number }>();
        for (const r of usaRows) {
          const sec = r.sector || 'Unclassified';
          const cur = sectorMapM.get(sec) ?? { r40s: [], scores: [], elite: 0, passing: 0 };
          cur.r40s.push(r.ruleOf40 ?? 0);
          cur.scores.push(r.score ?? 0);
          if ((r.ruleOf40 ?? 0) >= 60) cur.elite++;
          if ((r.ruleOf40 ?? 0) >= 40) cur.passing++;
          sectorMapM.set(sec, cur);
        }
        const medianN = (a: number[]) => {
          if (!a.length) return 0;
          const s = [...a].sort((x, y) => x - y);
          const m = Math.floor(s.length / 2);
          return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : Math.round(s[m]);
        };
        const ranked = Array.from(sectorMapM.entries())
          .filter(([_, v]) => v.r40s.length >= 2)
          .map(([sec, v]) => ({ sec, count: v.r40s.length, avgR40: medianN(v.r40s), avgScore: medianN(v.scores), elite: v.elite, passing: v.passing }))
          .sort((a, b) => b.avgR40 - a.avgR40);
        if (ranked.length === 0) return null;
        return (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, color: '#22D3EE', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
              🇺🇸 SECTOR R40 HEATMAP
            </div>
            <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginBottom: 8 }}>
              Sectors ranked by <strong>median</strong> Rule of 40 (outlier-resistant) · ≥ 40 = institutional hunting ground · &lt; 0 = capital-destroyers
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ranked.map(r => {
                const color = r.avgR40 >= 60 ? '#10B981' : r.avgR40 >= 40 ? '#22D3EE' : r.avgR40 >= 20 ? '#F59E0B' : r.avgR40 >= 0 ? '#FB923C' : '#EF4444';
                const widthPct = Math.max(2, Math.min(100, (r.avgR40 + 50) / 1.5));
                return (
                  <div key={r.sec} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px 60px 110px', gap: 8, alignItems: 'center', fontSize: 11 }}>
                    <span style={{ color: 'var(--mc-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sec}</span>
                    <div style={{ position: 'relative', height: 12, background: 'var(--mc-bg-2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${widthPct}%`, background: color }} />
                    </div>
                    <span style={{ color, fontWeight: 800, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>med {r.avgR40}</span>
                    <span style={{ color: 'var(--mc-text-4)', textAlign: 'right' }}>{r.count} cos</span>
                    <span style={{ color: '#10B981', fontWeight: 700, textAlign: 'right' }}>{r.elite}/{r.passing} elite/pass</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── GRADE DISTRIBUTION ──────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 10 }}>
          🎯 GRADE DISTRIBUTION
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(['A+', 'A', 'B+', 'B', 'C', 'D'] as const).map((g) => {
            const count = stats.grades[g] || 0;
            const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            const tone = g === 'A+' ? '#10B981' : g === 'A' ? '#22D3EE'
              : g === 'B+' ? '#3B82F6' : g === 'B' ? '#F59E0B'
              : g === 'C' ? '#94A3B8' : '#EF4444';
            return (
              <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: tone, minWidth: 30 }}>{g}</span>
                <span style={{ fontSize: 11, color: 'var(--mc-text-4)', minWidth: 35, textAlign: 'right' }}>{count}</span>
                <div style={{ flex: 1, height: 10, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
                </div>
                <span style={{ fontSize: 11, color: tone, fontWeight: 700, minWidth: 40, textAlign: 'right' }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── SECTOR EXPOSURE ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
          🧭 SECTOR EXPOSURE
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10 }}>
          Which sectors dominate your roster and what's the average score per bucket.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stats.sectorRanked.slice(0, 15).map((s) => {
            const max = stats.sectorRanked[0]?.count || 1;
            const pct = Math.round((s.count / max) * 100);
            const tone = s.avgScore >= 78 ? '#10B981' : s.avgScore >= 60 ? '#22D3EE'
              : s.avgScore >= 45 ? '#F59E0B' : '#94A3B8';
            return (
              <div key={s.sector} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--mc-text-1)', fontWeight: 600, minWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector}</span>
                <span style={{ fontSize: 10, color: 'var(--mc-text-4)', minWidth: 28, textAlign: 'right' }}>{s.count}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
                </div>
                <span style={{ fontSize: 11, color: tone, fontWeight: 700, minWidth: 70, textAlign: 'right' }}>avg {s.avgScore}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── TOP 25 BY SCORE (PATCH 0548 — expanded + Δ columns) ─────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 10 }}>
          🏆 TOP 25 BY SCORE
        </div>
        {/* PATCH 0573 — COMPANY column added between TICKER and SECTOR so
            unfamiliar symbols (especially BSE: scrip codes) are readable
            at a glance. Truncates with ellipsis on narrow viewports;
            tooltip shows the full company name on hover. */}
        <div style={{ border: '1px solid var(--mc-bg-4)', borderRadius: 4, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              {/* PATCH 0585 — COMPANY first, TICKER second per user feedback.
                  Company name is the primary identity; ticker is the small
                  accessory for power-users. Score column kept right. */}
              <tr style={{ backgroundColor: 'var(--mc-bg-0)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>RANK</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>COMPANY</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>TICKER</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>SECTOR</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>PREV</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>SCORE</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>Δ</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>GRADE</th>
                {/* PATCH 0991 — Screener-count column */}
                <th title="Number of uploaded Screener.in CSVs this stock appeared in" style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>📂</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>MKT</th>
              </tr>
            </thead>
            <tbody>
              {stats.topPicks.map((s, i) => {
                const inCb = convictionSet.has(s.symbol.toUpperCase().replace(/\.(NS|BO)$/i, ''));
                const hasPrev = typeof s.prevScore === 'number';
                const delta = hasPrev ? s.score - (s.prevScore as number) : null;
                const deltaColor = delta === null ? '#94A3B8' : delta > 0 ? '#10B981' : delta < 0 ? '#EF4444' : '#94A3B8';
                const deltaSym = delta === null ? 'NEW' : delta > 0 ? `▲+${delta}` : delta < 0 ? `▼${delta}` : '•0';
                return (
                  <tr key={s.symbol + i} style={{ borderTop: '1px solid var(--mc-bg-4)' }}>
                    <td style={{ padding: '6px 10px', color: 'var(--mc-text-4)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                    <td title={s.company || s.symbol} style={{ padding: '6px 10px', color: 'var(--mc-text-1)', fontSize: 12, fontWeight: 700, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`} style={{ color: 'var(--mc-text-1)', textDecoration: 'none' }}>
                        {s.company || s.symbol}
                      </a>
                      {inCb && <span title="In Conviction Beats" style={{ marginLeft: 5, fontSize: 10, color: 'var(--mc-warn)' }}>🏆</span>}
                    </td>
                    <td style={{ padding: '6px 10px', color: 'var(--mc-text-3)', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600 }}>{s.symbol}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--mc-text-3)', fontSize: 11 }}>{s.sector || '—'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-text-4)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{hasPrev ? s.prevScore : '—'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.score}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: deltaColor, fontWeight: 700, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{deltaSym}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', color: s.grade === 'A+' ? 'var(--mc-bullish)' : 'var(--mc-cyan)', fontWeight: 700 }}>{s.grade}</td>
                    {/* PATCH 0991 — Screener-count cell */}
                    <td title={Array.isArray((s as any)._screeners) ? (s as any)._screeners.join(', ') : ''} style={{ padding: '6px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: ((s as any)._screeners?.length ?? 0) >= 2 ? 'var(--mc-cyan)' : 'var(--mc-text-4)', fontVariantNumeric: 'tabular-nums' }}>
                      {((s as any)._screeners?.length ?? 0) >= 1 ? (s as any)._screeners.length : '—'}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', color: s.market === 'INDIA' ? 'var(--mc-bullish)' : 'var(--mc-cyan)', fontSize: 10, fontWeight: 700 }}>{s.market === 'INDIA' ? '🇮🇳' : '🇺🇸'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CONVICTION BEATS OVERLAP ────────────────────────────────────── */}
      {stats.convictionOverlap.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: 'var(--mc-warn)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
            🏆 CONVICTION BEATS OVERLAP ({stats.convictionOverlap.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10 }}>
            Stocks from your Multibagger upload that also sit on the Conviction Beats bench — strongest decision-ready candidates.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {stats.convictionOverlap.slice(0, 30).map((s) => (
              <a
                key={s.symbol}
                href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
                title={s.company || ''}
                style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--mc-warn)',
                  border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)',
                  padding: '3px 8px', borderRadius: 4, textDecoration: 'none',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  display: 'inline-flex', flexDirection: 'column', gap: 1,
                }}
              >
                <span>{s.symbol} <span style={{ color: 'var(--mc-text-3)', fontWeight: 500 }}>· {s.score} {s.grade}</span></span>
                {s.company && (
                  <span style={{ fontSize: 9, color: 'var(--mc-text-2)', fontWeight: 500, fontFamily: 'system-ui, sans-serif', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.company}</span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0370 — TURNAROUND COMPARE TAB
//
// Specialised view for distressed-to-recovery setups. Different from
// regular Multibagger because:
//   - 7-dimension scoring (earnings inflection / op reset / balance sheet
//     repair / concall narrative / industry tailwind / governance / valuation)
//   - Stage classifier: DISTRESS → EARLY-SHOOTS → PATTERN → CONFIRMED → MATURE
//   - BUY-ZONE filter highlights Early-Shoots + Pattern stages (the alpha
//     window before consensus arrives)
//   - Concall paste-text per row contributes to scoring (15 of 100 pts)
// ═══════════════════════════════════════════════════════════════════════════
