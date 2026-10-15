'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { getDecision, subscribeDecisions, type DecisionStatus } from '@/lib/decisions';
import TickerExportToolbar from '@/components/TickerExportToolbar';
import { detectCsvMarket } from '@/lib/multibagger-csv-parsers';
import { SYNC_ROUTING, shouldAutoLoad, markAutoLoaded, type SyncStatus, getTradingviewSyncStatus, fetchTradingviewCsvsAsFiles } from '@/lib/screener-data-loader';
import type { Grade } from '@/lib/multibagger-india-scoring';
import { scoreUSARow, applyUSARanking } from '@/lib/multibagger-usa-scoring';
import type { USARow, USAGrade, USAResult } from '@/lib/multibagger-usa-scoring';
import { ACCENT, BORDER, CARD2, CARD_BG, F, GREEN, MUTED, ORANGE, RED, TEXT, YELLOW } from './constants';
import { USA_SLIM_KEY, USA_STORAGE_KEY, _getUsaRowsMemCache, _setUsaRowsMemCache, toSlimUsaRows } from './mem-cache';
import { NewSeenCheckbox, RecentlyAddedPanel, useNewTracker } from './new-tracker';
import { mbServerSnapshotLoad, mbServerSnapshotSave } from './storage';
import { parseUSARow } from './usa-parse';
import { DecisionBar, ScoreMoversStrip, ThesisDriftStrip } from './widgets';

export function USACompare() {
  const fileRef = React.useRef<HTMLInputElement>(null);
  // zzz170 — Ref flag: when TRUE, handleFiles ignores stale closure `rows` and
  // starts from empty state. Fixes the async-setState closure bug in zzz169
  // that let 76 pre-filter India rows survive every subsequent auto-pull.
  const forceStartFromEmptyRef = React.useRef<boolean>(false);
  // zzz162 — TradingView auto-sync state (parallel to India's runAutoSync).
  const [usaSyncStatus, setUsaSyncStatus] = React.useState<SyncStatus | null>(null);
  const [usaSyncLoading, setUsaSyncLoading] = React.useState(false);
  React.useEffect(() => { getTradingviewSyncStatus().then(setUsaSyncStatus); }, []);
  // zzz172 — bumped v1→v2 to match zzz171 storage-key nuke so old browsers
  // don't skip freshness re-pulls due to stale seen-stamp
  const USA_LAST_SYNC_SEEN_KEY = 'mb_usa_last_sync_seen_v2';
  const runUsaAutoSync = React.useCallback(async (_force = false) => {
    if (usaSyncLoading) return;
    setUsaSyncLoading(true);
    try {
      const rawFiles = await fetchTradingviewCsvsAsFiles(SYNC_ROUTING.multibaggerUsa);
      if (rawFiles.length === 0) {
        setParseError('Auto-sync failed: no CSVs in /data/tradingview/. Run the GitHub Action first.');
        return;
      }
      // zzz163 — Filter each CSV to USA-exchange rows only.
      // "USA Multibagger 3" (GHHf1HVl) is actually a mixed universe with 100 NSE tickers
      // that were leaking into the USA Multibagger scoring engine. Drop NSE/BSE rows here
      // so the tab only ranks USA growth names, matching the Fisher framework intent.
      const USA_EXCHANGES = new Set(['NYSE','NASDAQ','NMS','ARCA','AMEX','BATS','OTC','NYSE ARCA','NYSEARCA']);
      const filteredFiles: File[] = [];
      for (const f of rawFiles) {
        try {
          const text = await f.text();
          const lines = text.split('\n');
          if (lines.length < 2) continue;
          const header = lines[0];
          // Parse header to find Exchange column index
          const cols = (() => {
            const out: string[] = [];
            let cur = ''; let inQ = false;
            for (const c of header) {
              if (c === '"') { inQ = !inQ; continue; }
              if (c === ',' && !inQ) { out.push(cur.trim()); cur = ''; continue; }
              cur += c;
            }
            out.push(cur.trim());
            return out;
          })();
          const exIdx = cols.findIndex(c => c === 'Exchange');
          if (exIdx < 0) {
            // No Exchange column — keep file as-is (fallback path)
            filteredFiles.push(f);
            continue;
          }
          const kept: string[] = [header];
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            // Simple CSV split — Exchange comes very early (col 1) and never contains commas
            const parts = line.split(',');
            const ex = (parts[exIdx] || '').replace(/"/g, '').trim().toUpperCase();
            if (USA_EXCHANGES.has(ex)) kept.push(line);
          }
          if (kept.length > 1) {
            const blob = new Blob([kept.join('\n')], { type: 'text/csv' });
            filteredFiles.push(new File([blob], f.name, { type: 'text/csv' }));
          }
        } catch { /* skip file on parse error */ }
      }
      if (filteredFiles.length === 0) {
        setParseError('Auto-sync: 0 USA rows after exchange filter — did upstream screeners drift to India-only?');
        return;
      }
      // zzz170 — CLEAR everything AND set the ref flag so handleFiles bypasses
      // its stale-closure `rows` value. Without the ref, React batches the
      // setRowsState([]) call and handleFiles' seenSymbols init still reads
      // the OLD 76 India rows from closure. That's the bug that let India
      // stocks survive zzz163 filter + zzz169 clear for 5 attempts.
      forceStartFromEmptyRef.current = true;
      try { setRowsState([]); } catch {}
      try { localStorage.removeItem(USA_STORAGE_KEY); } catch {}
      try { localStorage.removeItem(USA_SLIM_KEY); } catch {}
      try { _setUsaRowsMemCache([]); } catch {}
      await handleFiles(filteredFiles);
      const fresh = await getTradingviewSyncStatus();
      setUsaSyncStatus(fresh);
      try { if (fresh?.lastSync) localStorage.setItem(USA_LAST_SYNC_SEEN_KEY, fresh.lastSync.toISOString()); } catch {}
    } finally {
      setUsaSyncLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usaSyncLoading]);
  // zzz169 — Bumped scope key so browsers that already auto-loaded pre-filter
  // will re-run the auto-pull once and get the clean USA-only set.
  React.useEffect(() => {
    if (rows.length > 0) {
      // Even if rows exist, check if they contain India tickers (leftover from
      // pre-zzz163 caches). Force a re-pull if any Exchange is NSE/BSE.
      const hasIndia = rows.some((r: any) => {
        const ex = String(r.exchange || '').toUpperCase();
        return ex === 'NSE' || ex === 'BSE';
      });
      if (!hasIndia) return;
    }
    if (!shouldAutoLoad('multibagger-usa-v169')) return;
    const t = setTimeout(() => {
      runUsaAutoSync(false).then(() => markAutoLoaded('multibagger-usa-v169'));
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [rows, setRowsState] = React.useState<USAResult[]>(() => {
    // zzz134 — Helper that ensures every row has `pillarScores`, `strengths`, `risks`.
    // These come from scoreUSARow() but are stripped when the row passes through
    // toSlimUsaRows() (LS-quota slim payload). If we read a slim row from
    // mem cache (populated by Analytics' zzz126 hydration from slim LS) or
    // directly from slim LS, we MUST re-score it before USACompare renders —
    // otherwise `r.pillarScores.map(...)` at line ~4934 crashes with
    // "Cannot read properties of undefined (reading 'map')".
    const ensureScored = (arr: any[]): USAResult[] => {
      if (!Array.isArray(arr) || arr.length === 0) return [] as USAResult[];
      const needsRescore = !Array.isArray((arr[0] || {}).pillarScores);
      if (!needsRescore) return arr as USAResult[];
      try { console.log(`[mb-usa] zzz134 re-scoring ${arr.length} slim/stale rows (missing pillarScores)`); } catch {}
      return arr.map((r: any) => {
        try { return scoreUSARow(r as unknown as USARow) as USAResult; }
        catch { return r as USAResult; }
      });
    };
    // PATCH zzz110 — Check in-memory cache FIRST (cross-mount survival within
    // the same page session). Then full LS. Then slim LS (zzz108/109).
    try {
      const mem = _getUsaRowsMemCache();
      if (Array.isArray(mem) && mem.length > 0) {
        const scored = ensureScored(mem);
        try { console.log(`[mb-usa] zzz110 restored ${scored.length} rows from in-memory cache`); } catch {}
        return applyUSARanking(scored.sort((a,b)=>b.score-a.score));
      }
    } catch {}
    try {
      const saved = localStorage.getItem(USA_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as USAResult[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const rescored = parsed.map(r => scoreUSARow(r as unknown as USARow));
          const ranked = applyUSARanking(rescored.sort((a,b)=>b.score-a.score));
          _setUsaRowsMemCache(ranked);  // zzz110 — populate cache from LS restore
          return ranked;
        }
      }
      const slimRaw = localStorage.getItem('mb_usa_slim_v1');
      if (slimRaw) {
        const slim = JSON.parse(slimRaw);
        if (Array.isArray(slim) && slim.length > 0) {
          try { console.log(`[mb-usa] zzz109 restored ${slim.length} rows from slim payload`); } catch {}
          // zzz134 — re-score slim rows so pillarScores/strengths/risks exist
          const scored = ensureScored(slim);
          const ranked = applyUSARanking(scored.sort((a,b)=>b.score-a.score));
          _setUsaRowsMemCache(ranked);
          return ranked;
        }
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = React.useState(false);
  const [parseError, setParseError] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [expRow, setExpRow] = React.useState<string|null>(null);
  const [expandAll, setExpandAll] = React.useState(false);
  const [gradeFilter, setGradeFilter] = React.useState<Set<string>>(new Set(['ALL']));
  const [accelOnly, setAccelOnly] = React.useState(false);
  // PATCH 1101dd — Good Only toggle for USA tab (parity with India).
  // "Good" = score ≥ 60 AND accelerating (not decelerating) AND no critical fraud
  // risks AND R40 ≥ 0. Catches the spirit of India's gooCompanies filter.
  const [usGoodOnly, setUsGoodOnly] = React.useState(false);
  const [usPeMax,       setUsPeMax]       = React.useState<'ALL'|15|25|40|60|100>('ALL');
  const [usPegMax,      setUsPegMax]      = React.useState<'ALL'|0.8|1.0|1.5|2.0>('ALL');
  const [usFcfOnly,     setUsFcfOnly]     = React.useState(false);
  const [usRatingFilter,setUsRatingFilter]= React.useState<'ALL'|'BUY'|'STRONG_BUY'>('ALL');
  // PATCH 0345 — Rule of 40 tiered filter. R40 is the canonical SaaS/growth
  // institutional benchmark. ≥40 = passes; ≥60 = strong; ≥80 = elite (NVDA/PLTR tier).
  const [usR40Min,      setUsR40Min]      = React.useState<'ALL'|40|60|80>('ALL');
  // PATCH 0345 — Piotroski quality filter (≥7 = elite Greenblatt/Piotroski tier)
  const [usPiotroskiMin,setUsPiotroskiMin]= React.useState<'ALL'|5|7>('ALL');
  // PATCH 0345 — GPM quality filter (≥50% = real moat; ≥70% = elite SaaS)
  const [usGpmMin,      setUsGpmMin]      = React.useState<'ALL'|40|60|70>('ALL');
  // PATCH 0347 — Decision filter for USA tab
  const [usDecisionFilter, setUsDecisionFilter] = React.useState<'ALL'|'WITH'|'NONE'|DecisionStatus>('ALL');
  const [usDecisionsV, setUsDecisionsV] = React.useState(0);
  const bumpUsDecisions = React.useCallback(() => setUsDecisionsV(v => v + 1), []);
  React.useEffect(() => subscribeDecisions(() => bumpUsDecisions()), [bumpUsDecisions]);
  // Touch usDecisionsV so it's read on render (avoids unused-var lint)
  void usDecisionsV;
  // USA sortable columns
  type USASort = 'score'|'fwdPe'|'peg'|'revGrowthAnn'|'ruleOf40'|'fcfMargin'|'marketCapB'|'grossMargin';
  const [usSortField, setUsSortField] = React.useState<USASort>('score');
  const [usSortAsc,   setUsSortAsc]   = React.useState(false);
  function handleUSASort(field: USASort) {
    if (usSortField===field) { setUsSortAsc(v=>!v); return; }
    setUsSortField(field);
    setUsSortAsc(['fwdPe','peg','marketCapB'].includes(field));
  }
  const usSortIcon = (f: USASort) => usSortField===f ? (usSortAsc?' ▲':' ▼') : '';
  // USA score baseline
  const USA_PREV_KEY = 'mb_usa_prev_scores_v1';
  const usPrevScores = React.useMemo<Record<string,number>>(() => {
    try { return JSON.parse(localStorage.getItem(USA_PREV_KEY)||'{}'); } catch { return {}; }
  }, []);

  function setRows(r: USAResult[]) {
    const ranked = applyUSARanking(r);
    setRowsState(ranked);
    // PATCH zzz110 — synchronous in-memory bridge to MultibaggerAnalytics.
    // Cannot fail. Independent of localStorage. This is the primary path now.
    _setUsaRowsMemCache(ranked);
    try { console.log(`[mb-usa] zzz110 memCache set with ${ranked.length} rows`); } catch {}
    const __mbUsa = JSON.stringify(ranked);
    let __fullWriteOk = false;
    try {
      localStorage.setItem(USA_STORAGE_KEY, __mbUsa);
      __fullWriteOk = true;
      // AUDIT_100 #77 — stamp the upload time so we can warn when the
      // CSV is > 60 days old (stale fundamentals vs fresh price risk
      // called out in CLAUDE.md §10.10).
      localStorage.setItem('mb_usa_uploaded_at_v1', String(Date.now()));
    } catch (e) {
      try { console.warn('[mb-usa] zzz108 full LS write failed (likely quota), will rely on slim payload:', e); } catch {}
    }
    // PATCH zzz108 — Slim payload write. Even if the full write succeeded,
    // we still write the slim version so Analytics has a stable fast-path
    // read. If the full write FAILED (quota), the slim write is the only
    // way Analytics will see the USA data.
    try {
      const slimJson = JSON.stringify(toSlimUsaRows(ranked));
      localStorage.setItem(USA_SLIM_KEY, slimJson);
      try { console.log(`[mb-usa] zzz108 slim payload written (${slimJson.length}B, ${ranked.length} rows, fullWriteOk=${__fullWriteOk})`); } catch {}
    } catch (e2) {
      try { console.error('[mb-usa] zzz108 slim LS write ALSO failed:', e2); } catch {}
    }
    try {
      // PATCH 0471 — broadcast cross-tab update so Re-rating/Signals refresh
      // their derived universes immediately after a USA upload (matches
      // India behaviour set up in 0453 P1-18).
      window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'USA', count: ranked.length } }));
    } catch {}
    // PATCH 1101v — Mirror to Railway snapshot so USA survives browser eviction
    // (same architecture as 1101m for India). Fire-and-forget — UI doesn't wait.
    mbServerSnapshotSave(__mbUsa, ranked.length, 'USA').then((ok) => {
      try { console.log('[mb-persist] USA server snapshot save →', ok ? 'OK' : 'FAILED'); } catch {}
    });
  }
  // PATCH 1101v — Hydrate USA from Railway on mount when localStorage has
  // fewer rows. Same pattern as India hydration but for the USA market key.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lsRaw = localStorage.getItem(USA_STORAGE_KEY);
        let localCount = 0;
        try { localCount = lsRaw ? (JSON.parse(lsRaw) as any[])?.length || 0 : 0; } catch {}
        const serverRaw = await mbServerSnapshotLoad('USA');
        if (!alive || !serverRaw) return;
        let serverRows: any[] = [];
        try { serverRows = JSON.parse(serverRaw); } catch {}
        if (!Array.isArray(serverRows) || !serverRows.length) return;
        if (serverRows.length < localCount) {
          try { console.log(`[mb-usa] Railway has ${serverRows.length} < local ${localCount}, keeping local`); } catch {}
          return;
        }
        try { console.log(`[mb-usa] restored ${serverRows.length} USA stocks from Railway (local had ${localCount})`); } catch {}
        setRowsState(applyUSARanking(serverRows as USAResult[]));
        try { localStorage.setItem(USA_STORAGE_KEY, serverRaw); } catch {}
        try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'USA', count: serverRows.length } })); } catch {}
      } catch (e) {
        try { console.warn('[mb-usa] Railway hydrate failed', e); } catch {}
      }
    })();
    return () => { alive = false; };
  }, []);
  // AUDIT_100 #77 — age of the loaded data set in days
  const usaUploadAgeDays = React.useMemo(() => {
    try {
      const stamp = parseInt(localStorage.getItem('mb_usa_uploaded_at_v1') || '0', 10);
      if (!stamp || isNaN(stamp)) return null;
      return Math.floor((Date.now() - stamp) / (1000 * 60 * 60 * 24));
    } catch { return null; }
  }, [rows.length]);

  async function handleFiles(files: FileList | File[]) {
    setParseError(''); setLoading(true);
    // zzz170 — If runUsaAutoSync set the reset flag, ignore stale `rows` closure
    // and treat existing rows as empty. Clear the flag immediately after read
    // so subsequent manual uploads still merge normally.
    const startFromEmpty = forceStartFromEmptyRef.current;
    forceStartFromEmptyRef.current = false;
    const baselineRows = startFromEmpty ? ([] as USAResult[]) : rows;
    // PATCH 0872 — Capture pre-upload USA baseline FIRST (was previously
    // written AFTER scoring, which made PREV==CURRENT and zeroed every
    // USA score-delta indicator in MultibaggerAnalytics).
    try { localStorage.setItem(USA_PREV_KEY, JSON.stringify(Object.fromEntries(baselineRows.map(r=>[r.symbol,r.score])))); } catch {}
    try {
      const XLSX = await import('xlsx');
      const arr = Array.from(files);
      const allRows: USARow[] = [];
      const seenSymbols = new Set(baselineRows.map(r=>r.symbol));
      // PATCH 0347 — Cross-market detection on USA upload
      const allHeaders: string[] = [];
      // PATCH 1101kk — Track which TradingView CSV each ticker came from so
      // 🎯 MULTI-CONFIRMED PICKS populates for USA too. India does this via
      // _screenerMap during parsing; USA was just scoring + merging blindly,
      // so user kept seeing "Re-upload your screens" even after 3 uploads.
      const _usaScreenerMap = new Map<string, string[]>();
      for (const file of arr) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type:'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet, { defval:'' });
        if (raw.length > 0) allHeaders.push(...Object.keys(raw[0]));
        for (const r of raw) {
          const parsed = parseUSARow(r as Record<string,unknown>);
          if (!parsed) continue;
          // Record which file this ticker appeared in (even for duplicates).
          const existing = _usaScreenerMap.get(parsed.symbol) ?? [];
          if (!existing.includes(file.name)) existing.push(file.name);
          _usaScreenerMap.set(parsed.symbol, existing);
          if (seenSymbols.has(parsed.symbol)) continue;
          seenSymbols.add(parsed.symbol);
          allRows.push(parsed);
        }
      }
      const detectedMarket = detectCsvMarket(allHeaders);
      if (detectedMarket === 'IN') {
        const proceed = window.confirm(
          `⚠️ This CSV looks like an INDIA Screener.in export (found Indian-specific columns like Promoter holding, ROCE, Sales growth).\n\nYou're currently on the USA tab.\n\nClick OK to switch to India Multibagger tab and upload there.\nClick Cancel to upload here anyway (may produce empty/wrong scores).`
        );
        if (proceed) {
          // Dispatch a custom event the parent page can listen to
          window.dispatchEvent(new CustomEvent('mc:switch-multibagger-tab', { detail: { tab: 'excel' } }));
          setLoading(false);
          return;
        }
      }
      // PATCH 1101kk — Re-upload-only case: every ticker already in dataset.
      // Still flush screener-membership onto existing rows so MULTI-CONFIRMED
      // picks update without forcing user to clear data first.
      if (!allRows.length && baselineRows.length > 0) {
        // zzz170 — Use baselineRows (== [] when reset flag set) so we don't
        // resurrect the 76 stale India rows via the "screener membership refresh" path.
        const rowsWithScreeners = baselineRows.map(r => {
          const newSources = _usaScreenerMap.get(r.symbol);
          if (!newSources || newSources.length === 0) return r;
          const existing = ((r as any)._screeners as string[] | undefined) ?? [];
          const merged = Array.from(new Set([...existing, ...newSources]));
          return { ...r, _screeners: merged } as any;
        });
        setRows(rowsWithScreeners);
        setFileName(`Screener membership refreshed · ${arr.length} file${arr.length>1?'s':''} · ${baselineRows.length} stocks`);
        setLoading(false); return;
      }
      if (!allRows.length) { setParseError('No valid rows found. Ensure the file has a Symbol column.'); setLoading(false); return; }
      // PATCH 1101kk — Attach _screeners from CSVs to each newly-scored row.
      const scored = allRows.map(r => {
        const s = scoreUSARow(r);
        const sc = _usaScreenerMap.get(r.symbol) ?? [];
        return { ...s, _screeners: sc } as any;
      });
      // zzz170 — Use baselineRows here too. When reset flag was set,
      // baselineRows == [], so merged == scored (only fresh USA-filtered stuff).
      const existingMerged = baselineRows.map(r => {
        const newSources = _usaScreenerMap.get(r.symbol);
        if (!newSources || newSources.length === 0) return r;
        const existing = ((r as any)._screeners as string[] | undefined) ?? [];
        const m = Array.from(new Set([...existing, ...newSources]));
        return { ...r, _screeners: m } as any;
      });
      const merged = [...existingMerged, ...scored].sort((a,b)=>b.score-a.score);
      setRows(merged);
      // PATCH 0872 — Pre-upload baseline saved at TOP of handleFiles now.
      setFileName(`${arr.length} file${arr.length>1?'s':''} · ${merged.length} stocks`);
    } catch(e) { setParseError(`Error: ${e instanceof Error?e.message:String(e)}`); }
    setLoading(false);
  }

  const GRADES: USAGrade[] = ['A+','A','B+','B','C','D'];
  const GRADE_COLOR_US: Record<USAGrade,string> = {'A+':'#10b981','A':'#34d399','B+':'#f59e0b','B':'#f97316','C':'#fb923c','D':'#ef4444'};
  let filtered = gradeFilter.has('ALL') ? rows : rows.filter(r=>gradeFilter.has(r.grade));
  if (accelOnly)        filtered = filtered.filter(r=>r.accelSignal==='ACCELERATING');
  if (usFcfOnly)        filtered = filtered.filter(r=>(r.fcfMarginAnn ?? -99) >= 10);
  // PATCH 1101dd — Good Only USA composite filter
  const usaGoodCompanies = rows.filter(r =>
       r.score >= 60
    && r.accelSignal !== 'DECELERATING'
    && (r.ruleOf40 ?? 0) >= 0
    && !(r.risks || []).some((s: string) => s.includes('🛑') || s.includes('NEVER BUY') || s.includes('CRITICAL'))
  );
  if (usGoodOnly) filtered = filtered.filter(r => usaGoodCompanies.includes(r));
  // PATCH 0345 — Rule of 40 / Piotroski / GPM filters compose AND-style
  if (usR40Min !== 'ALL')       filtered = filtered.filter(r=>(r.ruleOf40 ?? -999) >= usR40Min);
  if (usPiotroskiMin !== 'ALL') filtered = filtered.filter(r=>(r.piotroskiFScore ?? -1) >= usPiotroskiMin);
  if (usGpmMin !== 'ALL')       filtered = filtered.filter(r=>{
    const gm = r.grossMarginTtm ?? r.grossMarginAnn;
    return gm !== undefined && gm >= usGpmMin;
  });
  // PATCH 0347 — decision filter for USA
  if (usDecisionFilter !== 'ALL') {
    filtered = filtered.filter(r => {
      const d = getDecision(r.symbol, 'US');
      if (usDecisionFilter === 'WITH') return !!d;
      if (usDecisionFilter === 'NONE') return !d;
      return d?.status === usDecisionFilter;
    });
  }
  // Analyst Rating filter
  if (usRatingFilter === 'BUY')       filtered = filtered.filter(r => r.analystRating?.toLowerCase().includes('buy'));
  if (usRatingFilter === 'STRONG_BUY')filtered = filtered.filter(r => r.analystRating?.toLowerCase().includes('strong buy'));
  // P/E filter uses forwardPe first (more forward-looking), falls back to trailing P/E
  if (usPeMax  !== 'ALL') filtered = filtered.filter(r=>{
    const pe = r.forwardPe && r.forwardPe > 0 ? r.forwardPe : r.pe;
    return pe !== undefined && pe > 0 && pe <= usPeMax;
  });
  if (usPegMax !== 'ALL') filtered = filtered.filter(r=>r.peg !== undefined && r.peg > 0 && r.peg <= usPegMax);
  // Apply USA sort
  filtered = [...filtered].sort((a,b) => {
    const getV = (r: USAResult): number => {
      switch(usSortField) {
        case 'fwdPe':       return (r.forwardPe&&r.forwardPe>0?r.forwardPe:r.pe) ?? (usSortAsc?999:-1);
        case 'peg':         return r.peg ?? (usSortAsc?999:-1);
        case 'revGrowthAnn':return r.revenueGrowthAnn ?? (usSortAsc?-1:999);
        case 'ruleOf40':    return r.ruleOf40 ?? (usSortAsc?-1:999);
        case 'fcfMargin':   return r.fcfMarginAnn ?? (usSortAsc?-1:999);
        case 'marketCapB':  return r.marketCapB ?? (usSortAsc?999:-1);
        case 'grossMargin': return (r.grossMarginTtm??r.grossMarginAnn) ?? (usSortAsc?-1:999);
        default:            return r.score;
      }
    };
    const av=getV(a), bv=getV(b);
    return usSortAsc ? av-bv : bv-av;
  });

  // zzz175 USA Multibagger tracker
  const usaAllSymbols = React.useMemo(() => rows.map(r => r.symbol).filter(Boolean), [rows]);
  const { newTickerSet: usaNewSet, ackSet: usaAckSet, toggleAck: toggleUsaAck } = useNewTracker('us-mb', usaAllSymbols);
  const [showOnlyNewUsa, setShowOnlyNewUsa] = React.useState(false);
  if (showOnlyNewUsa) filtered = filtered.filter(r => usaNewSet.has(r.symbol));

  return (
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
      {/* zzz181 - Recently Added panel */}
      <RecentlyAddedPanel tab="us-mb" tickers={usaAllSymbols} marketLabel="🇺🇸 USA Multibagger" dataFolder="frontend/public/data/tradingview" />

      {/* zzz214 — score movers since the previous upload/refresh */}
      <ScoreMoversStrip rows={rows} prevKey="mb_usa_prev_scores_v1" />
      {/* THESIS DRIFT — current re-score vs Decision Logbook (REOPEN / BREAK) */}
      <ThesisDriftStrip rows={rows} market="US" />
      {/* Header */}
      <div style={{marginBottom:20,padding:'18px 20px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:12}}>
        <div style={{fontSize:F.lg,fontWeight:800,color:'#38bdf8',marginBottom:8}}>🇺🇸 USA Multibagger — TradingView Export</div>
        <div style={{fontSize:F.md,color:MUTED,lineHeight:1.8,marginBottom:12}}>
          Export from TradingView Screener as CSV and upload. All columns auto-detected.
          <span style={{color:YELLOW}}> Recommended extra columns to add:</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
          {[
            // ── Base export (always present in TradingView) ──────────────────
            {field:'Gross margin %, Trailing 12 months', why:'GPM TTM — pricing power & moat ✅ confirmed in TradingView'},
            {field:'Free cash flow margin %, Annual', why:'FCF quality ✅ confirmed in TradingView'},
            {field:'Operating margin %, Trailing 12 months', why:'Operational efficiency ✅ in TradingView'},
            {field:'Return on equity %, Trailing 12 months', why:'Returns quality ✅ in TradingView'},
            // ── Add these — confirmed to exist in TradingView ────────────────
            {field:'Earnings per share diluted growth %, TTM YoY', why:'EPS growth — Fisher Twin Engine ✅ added'},
            {field:'Return on invested capital %, Annual', why:'ROIC — capital efficiency ✅ added'},
            {field:'Debt to equity ratio, Quarterly', why:'Leverage ✅ added'},
            {field:'Net margin %, Trailing 12 months', why:'Net profitability ✅ added'},
            {field:'Performance % 1 year', why:'1-year momentum ✅ added'},
            {field:'Revenue growth %, 5 year CAGR', why:'Sustained growth vs spike check ✅ added'},
            {field:'Price to earning to growth, Trailing 12 months', why:'PEG — growth-adjusted valuation ✅ added'},
            {field:'Analyst Rating', why:'Buy/Strong Buy/Sell — consensus signal ✅ added'},
            // ── Still to add — exist in TradingView ──────────────────────────
            {field:'Relative strength index, 14', why:'🆕 RSI momentum — overbought/oversold signal'},
            {field:'Price to free cash flow, TTM', why:'🆕 P/FCF — Buffett preferred valuation metric'},
          ].map(({field,why})=>(
            <div key={field} style={{padding:'8px 12px',backgroundColor:CARD2,borderRadius:6,border:`1px solid ${BORDER}`}}>
              <div style={{fontSize:F.sm,fontWeight:700,color:ACCENT}}>{field}</div>
              <div style={{fontSize:F.xs,color:MUTED}}>{why}</div>
            </div>
          ))}
        </div>
      </div>

      {/* zzz162 — Auto-sync from TradingView (daily GitHub Action).
          Pulls 4 CSVs from /data/tradingview/. Similar pattern to India tab. */}
      <div style={{marginBottom:14,padding:'12px 16px',background:CARD2,border:`1px solid ${BORDER}`,borderRadius:10,display:'flex',flexWrap:'wrap',alignItems:'center',gap:12}}>
        <span style={{fontSize:F.md,color:'#22D3EE',fontWeight:800}}>📡 Server Auto-Sync</span>
        <span style={{fontSize:F.sm,color:MUTED}}>
          {usaSyncStatus?.hasManifest
            ? <>Last daily sync: <b style={{color:'#e6edf3'}}>{usaSyncStatus.lastSync?.toLocaleString()}</b> ({usaSyncStatus.hoursOld != null ? Math.round(usaSyncStatus.hoursOld) : '?'}h ago) · {usaSyncStatus.okCount} screens ready</>
            : <>No server sync yet — click below to pull the daily-cached TradingView Multibagger CSVs.</>}
        </span>
        <button
          onClick={()=>runUsaAutoSync(true)}
          disabled={usaSyncLoading || loading}
          style={{marginLeft:'auto',background:'#38bdf8',color:'#0B1220',border:'none',padding:'8px 14px',borderRadius:6,fontSize:F.sm,fontWeight:800,cursor:(usaSyncLoading||loading)?'wait':'pointer'}}
        >{usaSyncLoading ? '⏳ Pulling…' : '🔄 Pull latest from server'}</button>
      </div>
      {/* Upload */}
      <div
        onClick={()=>fileRef.current?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length)handleFiles(e.dataTransfer.files);}}
        style={{marginBottom:20,padding:'32px 24px',border:`2px dashed #38bdf840`,borderRadius:14,textAlign:'center',cursor:'pointer',backgroundColor:'#38bdf805'}}
      >
        <div style={{fontSize:40,marginBottom:10}}>{loading?'⏳':'📁'}</div>
        <div style={{fontSize:F.xl,fontWeight:700,color:'#38bdf8'}}>
          {loading?'Scoring...' : fileName?`✅ ${fileName}` : 'Upload TradingView CSV'}
        </div>
        <div style={{fontSize:F.md,color:MUTED,marginTop:6}}>Export any TradingView screen · .csv · all columns auto-detected · <span style={{color:YELLOW}}>or use auto-sync above</span></div>
        <input ref={fileRef} type="file" accept=".csv,.xlsx" multiple style={{display:'none'}}
          onChange={e=>{if(e.target.files?.length)handleFiles(e.target.files);}} />
      </div>
      {parseError && <div style={{marginBottom:14,padding:'12px',backgroundColor:`${RED}10`,border:`1px solid ${RED}30`,borderRadius:10,fontSize:F.md,color:RED}}>{parseError}</div>}

      {rows.length>0&&(
        <>
          {/* AUDIT_100 #77 — data-staleness banner. When the loaded CSV is more
              than 60 days old, warn that fundamentals may not reflect recent
              earnings releases / price moves. */}
          {usaUploadAgeDays != null && usaUploadAgeDays > 60 && (
            <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8,
              backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)',
              color: 'var(--mc-warn)', fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 16 }}>⚠</span>
              <span>
                STALE FUNDAMENTALS: this CSV was uploaded <strong>{usaUploadAgeDays} days ago</strong>.
                New earnings + price action since then are not reflected. Re-export from TradingView for current scores.
              </span>
            </div>
          )}
          {/* Summary */}
          <div style={{display:'flex',gap:14,marginBottom:18,flexWrap:'wrap',alignItems:'stretch'}}>
            {[
              {label:'Scored',value:rows.length,color:'#38bdf8'},
              {label:'Top Picks (B+)',value:rows.filter(r=>['A+','A','B+'].includes(r.grade)).length,color:GREEN},
              {label:'Best Score',value:rows[0]?.score??0,color:rows[0]?.score>=72?GREEN:YELLOW},
              {label:'Avg Score',value:Math.round(rows.reduce((a,r)=>a+r.score,0)/rows.length),color:MUTED},
            ].map(({label,value,color})=>(
              <div key={label} style={{padding:'14px 22px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,textAlign:'center'}}>
                <div style={{fontSize:F.h1,fontWeight:900,color}}>{value}</div>
                <div style={{fontSize:F.sm,color:MUTED,marginTop:2}}>{label}</div>
              </div>
            ))}
            <div style={{display:'flex',gap:6,alignItems:'center',marginLeft:'auto',flexWrap:'wrap'}}>
              {/* PATCH 1101dd — Good Only filter on USA tab (parity with India). */}
              <button
                onClick={()=>setUsGoodOnly(v=>!v)}
                style={{
                  fontSize:F.sm,fontWeight:800,padding:'8px 16px',borderRadius:8,
                  border:`2px solid ${usGoodOnly?GREEN+'80':BORDER}`,
                  background:usGoodOnly?`${GREEN}18`:'transparent',
                  color:usGoodOnly?GREEN:MUTED,
                  cursor:'pointer',
                }}
                title="Score ≥ 60 · not decelerating · R40 ≥ 0 · no critical fraud / NEVER-BUY risks"
              >
                {usGoodOnly?`✅ Good Only (${usaGoodCompanies.length})`:`🔍 Good Only`}
              </button>
              <div style={{width:1,background:BORDER,height:24}}/>
              {(['ALL',...GRADES] as const).map(g=>{
                const active=gradeFilter.has(g);
                const col=GRADE_COLOR_US[g as USAGrade]||'#38bdf8';
                return <button key={g} onClick={()=>{
                  if(g==='ALL'){setGradeFilter(new Set(['ALL']));return;}
                  setGradeFilter(prev=>{const n=new Set(prev);n.delete('ALL');if(n.has(g)){n.delete(g);if(n.size===0)n.add('ALL');}else n.add(g);return n;});
                }} style={{fontSize:F.sm,fontWeight:700,padding:'7px 12px',borderRadius:8,border:`1px solid ${active?col+'60':BORDER}`,background:active?col+'18':'transparent',color:active?col:MUTED,cursor:'pointer'}}>
                  {g}{g!=='ALL'&&` (${rows.filter(r=>r.grade===g).length})`}
                </button>;
              })}
              <button onClick={()=>setAccelOnly(v=>!v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${accelOnly?GREEN+'60':BORDER}`,background:accelOnly?`${GREEN}14`:'transparent',color:accelOnly?GREEN:MUTED,cursor:'pointer'}}>
                🚀 Accelerating ({rows.filter(r=>r.accelSignal==='ACCELERATING').length})
              </button>
              <button onClick={()=>setUsFcfOnly(v=>!v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${usFcfOnly?'#38bdf8'+'60':BORDER}`,background:usFcfOnly?`${'#38bdf8'}14`:'transparent',color:usFcfOnly?'#38bdf8':MUTED,cursor:'pointer'}}>
                💰 FCF≥10% ({rows.filter(r=>(r.fcfMarginAnn??-99)>=10).length})
              </button>
              {/* zzz175 New filter */}
              <button onClick={()=>setShowOnlyNewUsa(v=>!v)}
                title="Show only tickers first seen in last 7 days"
                style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${showOnlyNewUsa?'#22D3EE60':BORDER}`,background:showOnlyNewUsa?'#22D3EE14':'transparent',color:showOnlyNewUsa?'#22D3EE':MUTED,cursor:'pointer'}}>
                🆕 New ({usaNewSet.size}){showOnlyNewUsa?' · ON':''}
              </button>
              {usaAckSet.size > 0 && <span style={{fontSize:F.xs,color:MUTED,fontStyle:'italic'}}>✓ {usaAckSet.size} seen</span>}

              {/* PATCH 0345 — Rule of 40 tiered filter (composes AND-style with others) */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:'var(--mc-state-persistent)',fontWeight:700}}>R40:</span>
              {(['ALL',40,60,80] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsR40Min(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usR40Min===v?'color-mix(in srgb, var(--mc-state-persistent) 38%, transparent)':BORDER}`,background:usR40Min===v?'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)':'transparent',color:usR40Min===v?'var(--mc-state-persistent)':MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`≥${v}${v===80?' 🏆':''}`}
                  {v!=='ALL' && ` (${rows.filter(r=>(r.ruleOf40 ?? -999) >= v).length})`}
                </button>
              ))}

              {/* PATCH 0345 — Piotroski F-score filter (≥5 clean, ≥7 elite) */}
              {rows.some(r=>r.piotroskiFScore !== undefined) && <>
                <div style={{width:1,background:BORDER,height:18}}/>
                <span style={{fontSize:F.xs,color:'var(--mc-bullish)',fontWeight:700}}>Piotroski:</span>
                {(['ALL',5,7] as const).map(v=>(
                  <button key={String(v)} onClick={()=>setUsPiotroskiMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                    border:`1px solid ${usPiotroskiMin===v?'color-mix(in srgb, var(--mc-bullish) 38%, transparent)':BORDER}`,background:usPiotroskiMin===v?'color-mix(in srgb, var(--mc-bullish) 8%, transparent)':'transparent',color:usPiotroskiMin===v?'var(--mc-bullish)':MUTED,cursor:'pointer'}}>
                    {v==='ALL'?'All':`≥${v}${v===7?'/9 💎':''}`}
                    {v!=='ALL' && ` (${rows.filter(r=>(r.piotroskiFScore ?? -1) >= v).length})`}
                  </button>
                ))}
              </>}

              {/* PATCH 0345 — Gross margin filter (moat signature) */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:'#34d399',fontWeight:700}}>GPM:</span>
              {(['ALL',40,60,70] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsGpmMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usGpmMin===v?'#34d39960':BORDER}`,background:usGpmMin===v?'#34d39914':'transparent',color:usGpmMin===v?'#34d399':MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`≥${v}%`}
                  {v!=='ALL' && ` (${rows.filter(r=>{const gm=r.grossMarginTtm??r.grossMarginAnn;return gm!==undefined && gm>=v;}).length})`}
                </button>
              ))}

              {/* PATCH 0347 — Decision logbook filter */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:'#38bdf8',fontWeight:700}}>📒 Decision:</span>
              {([
                {k:'ALL' as const, label:'All', col:MUTED},
                {k:'BUY' as const, label:'✅ BUY', col:'#10b981'},
                {k:'WATCH' as const, label:'👁 WATCH', col:'#f59e0b'},
                {k:'NEUTRAL' as const, label:'⚪ NEUTRAL', col:'#94a3b8'},
                {k:'REJECTED' as const, label:'❌ REJECTED', col:'#ef4444'},
              ]).map(({k,label,col})=>(
                <button key={k} onClick={()=>setUsDecisionFilter(p=>p===k?'ALL':k)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usDecisionFilter===k?col+'60':BORDER}`,background:usDecisionFilter===k?col+'18':'transparent',color:usDecisionFilter===k?col:MUTED,cursor:'pointer'}}>
                  {label} {k!=='ALL' && `(${rows.filter(r=>getDecision(r.symbol, 'US')?.status===k).length})`}
                </button>
              ))}

              {/* Analyst Rating filter — only shown when data has ratings */}
              {rows.some(r=>r.analystRating) && <>
                <div style={{width:1,background:BORDER,height:18}}/>
                <span style={{fontSize:F.xs,color:'var(--mc-warn)',fontWeight:700}}>ANALYST:</span>
                {([
                  {k:'ALL' as const, label:'All', col:MUTED},
                  {k:'BUY' as const, label:'Buy+', col:GREEN},
                  {k:'STRONG_BUY' as const, label:'Strong Buy', col:'#10b981'},
                ] as const).map(({k,label,col})=>(
                  <button key={k} onClick={()=>setUsRatingFilter(p=>p===k?'ALL':k)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                    border:`1px solid ${usRatingFilter===k?col+'60':BORDER}`,background:usRatingFilter===k?col+'18':'transparent',color:usRatingFilter===k?col:MUTED,cursor:'pointer'}}>
                    {label} {k!=='ALL'&&`(${rows.filter(r=>k==='BUY'?r.analystRating?.toLowerCase().includes('buy'):r.analystRating?.toLowerCase().includes('strong buy')).length})`}
                  </button>
                ))}
              </>}

              {/* Fwd P/E filter */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:MUTED,fontWeight:700}}>Fwd P/E:</span>
              {(['ALL',15,25,40,60,100] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsPeMax(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usPeMax===v?YELLOW+'60':BORDER}`,background:usPeMax===v?`${YELLOW}14`:'transparent',color:usPeMax===v?YELLOW:MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`<${v}×`}
                </button>
              ))}

              {/* PEG filter */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:MUTED,fontWeight:700}}>PEG:</span>
              {(['ALL',0.8,1.0,1.5,2.0] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsPegMax(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usPegMax===v?GREEN+'60':BORDER}`,background:usPegMax===v?`${GREEN}14`:'transparent',color:usPegMax===v?GREEN:MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`<${v}`}
                </button>
              ))}

              <button onClick={()=>{setExpandAll(v=>!v);setExpRow(null);}} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,cursor:'pointer',border:`1px solid ${expandAll?ACCENT+'60':BORDER}`,background:expandAll?ACCENT+'14':'transparent',color:expandAll?ACCENT:MUTED}}>
                {expandAll?'⊟ Collapse All':'⊞ Expand All'}
              </button>
              <span style={{fontSize:F.xs,color:MUTED}}>{filtered.length} showing</span>
              {/* CSV Export USA */}
              {filtered.length > 0 && (
                <button onClick={async ()=>{
                  const XLSX = await import('xlsx');
                  const data = filtered.map(r=>({
                    Symbol:r.symbol, Company:r.company, Score:r.score, Grade:r.grade,
                    Sector:r.sector, Exchange:r.exchange, 'MCap $B':r.marketCapB,
                    'Rev Growth Ann %':r.revenueGrowthAnn, 'Rev Growth Qtr %':r.revenueGrowthQtr,
                    'Gross Margin %':r.grossMarginTtm??r.grossMarginAnn, 'FCF Margin %':r.fcfMarginAnn,
                    'OPM %':r.opmTtm, 'Net Margin %':r.netProfitMargin,
                    ROE:r.roe, ROIC:r.roic, 'EPS Growth %':r.epsGrowth,
                    'Fwd P/E':r.forwardPe, 'P/E':r.pe, 'PEG':r.peg,
                    'EV/EBITDA':r.evEbitda, 'P/S':r.ps,
                    'Rule of 40':r.ruleOf40, 'Accel Signal':r.accelSignal,
                    'Net Debt $':r.netDebtUsd, 'D/E':r.de,
                    '1Y Perf %':r.perf1y, 'Analyst Rating':r.analystRating,
                    'RSI 14':r.rsi14, 'P/FCF':r.pFcf, 'Next Earnings':r.nextEarnings,
                  }));
                  const ws = XLSX.utils.json_to_sheet(data);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'USA');
                  XLSX.writeFile(wb, `usa-multibagger-${new Date().toISOString().slice(0,10)}.csv`, {bookType:'csv'});
                }} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${BORDER}`,background:'transparent',color:'#06b6d4',cursor:'pointer'}}>
                  ⬇ CSV
                </button>
              )}
              <button onClick={()=>{ if(window.confirm(`Clear all ${rows.length} stocks?`)){setRowsState([]);localStorage.removeItem(USA_STORAGE_KEY);setFileName('');try{window.dispatchEvent(new CustomEvent('mb-upload:updated',{detail:{cleared:true,market:'USA'}}));}catch{}} }} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${RED}40`,background:`${RED}10`,color:RED,cursor:'pointer'}}>
                🗑 Clear
              </button>
            </div>
          </div>

          {/* PATCH 0367 — USA export toolbar. NSE/NYSE/NASDAQ tickers go to
              TradingView with the exchange prefix. Screener.in is India-only
              so no company-name remap here — TradingView handles it natively
              for US listings. Screener button still works (bare ticker
              fallback) but is mostly unused for US workflow. */}
          {filtered.length > 0 && (() => {
            // Use the first row's exchange to pick the TradingView prefix.
            // Most USA rows are NASDAQ; NYSE is the only common alternative.
            const firstExch = (filtered[0]?.exchange || '').toUpperCase();
            const tvExchange: 'NASDAQ' | 'NYSE' = firstExch.includes('NYSE') ? 'NYSE' : 'NASDAQ';
            return (
              <div style={{ margin: '10px 0' }}>
                <TickerExportToolbar
                  tickers={filtered.map(r => r.symbol).filter(Boolean)}
                  exchange={tvExchange}
                  filenameHint="multibagger-usa"
                  compact
                />
              </div>
            );
          })()}

          {/* Table Header — sortable */}
          {/* PATCH 0346 — Added dedicated R40 column (Quarterly Rev + FCF margin),
              made sortable. Grid now has 9 columns instead of 8. */}
          <div style={{display:'grid',gridTemplateColumns:'120px 140px 60px 55px 90px 100px 70px 1fr 60px',gap:8,padding:'10px 14px',fontSize:F.xs,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            <span>TICKER</span><span>COMPANY</span>
            <span onClick={()=>handleUSASort('score')} style={{cursor:'pointer',color:usSortField==='score'?ACCENT:MUTED}}>SCORE{usSortIcon('score')}</span>
            <span>GRADE</span>
            <span onClick={()=>handleUSASort('fwdPe')} style={{cursor:'pointer',color:usSortField==='fwdPe'||usSortField==='peg'?YELLOW:MUTED}}>VAL{usSortIcon('fwdPe')}</span>
            <span onClick={()=>handleUSASort('revGrowthAnn')} style={{cursor:'pointer',color:usSortField==='revGrowthAnn'?GREEN:MUTED}}>ACCEL{usSortIcon('revGrowthAnn')}</span>
            <span onClick={()=>handleUSASort('ruleOf40')} style={{cursor:'pointer',color:usSortField==='ruleOf40'?'var(--mc-state-persistent)':MUTED}} title="Rule of 40 = Quarterly Rev Growth + FCF Margin (≥40 = institutional benchmark)">R40{usSortIcon('ruleOf40')}</span>
            <span onClick={()=>handleUSASort('grossMargin')} style={{cursor:'pointer',color:usSortField==='grossMargin'||usSortField==='fcfMargin'?'var(--mc-state-persistent)':MUTED}}>PILLARS{usSortIcon('grossMargin')}</span>
            <span onClick={()=>handleUSASort('marketCapB')} style={{cursor:'pointer',color:usSortField==='marketCapB'?ORANGE:MUTED}}>COV{usSortIcon('marketCapB')}</span>
          </div>

          {filtered.map((r,idx)=>{
            const isExp=expandAll||expRow===r.symbol;
            return (
              <div key={r.symbol+idx} style={{borderBottom:`1px solid rgba(255,255,255,0.05)`, position:'relative'}}>
                <div onClick={(e)=>{ e.stopPropagation(); }} style={{position:'absolute', top:8, right:8, zIndex:2}}>
                  <NewSeenCheckbox isNew={usaNewSet.has(r.symbol)} isAcked={usaAckSet.has(r.symbol)} onToggle={()=>toggleUsaAck(r.symbol)} />
                </div>
                <button onClick={()=>setExpRow(isExp?null:r.symbol)} style={{width:'100%',background:isExp?CARD_BG:'transparent',border:'none',cursor:'pointer',textAlign:'left',padding:'12px 14px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'120px 140px 60px 55px 90px 100px 70px 1fr 60px',gap:8,alignItems:'center'}}>
                    <div>
                      <div style={{display:'flex',alignItems:'center',gap:5}}>
                        <span style={{fontSize:F.lg,fontWeight:800,color:TEXT}}>{r.symbol}</span>
                        {idx<3&&<span style={{fontSize:F.md}}>⭐</span>}
                      </div>
                      <span style={{fontSize:F.xs,color:MUTED}}>{r.exchange}</span>
                      {/* PATCH 0349 — risk + position-size chips, surfaced inline */}
                      {r.earningsProximityDays !== undefined && r.earningsProximityDays >= 0 && r.earningsProximityDays <= 7 && (
                        <div title={`Earnings in ${r.earningsProximityDays} day${r.earningsProximityDays===1?'':'s'} (${r.nextEarnings}). Gap risk elevated — institutional desks halve position size in this window.`}
                             style={{fontSize:9,fontWeight:800,color:RED,background:`${RED}18`,border:`1px solid ${RED}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          ⚠ EARNINGS {r.earningsProximityDays}d
                        </div>
                      )}
                      {r.postRunStretched && (
                        <div title={`+${r.perf1y?.toFixed(0)}% past year at FwdPE ${(r.forwardPe ?? r.pe)?.toFixed(0)}× — priced for perfection. Mean-reversion drag historically -15% to -20% from this setup.`}
                             style={{fontSize:9,fontWeight:800,color:YELLOW,background:`${YELLOW}18`,border:`1px solid ${YELLOW}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          🌡 STRETCHED
                        </div>
                      )}
                      {r.fcfOpDivergence && (
                        <div title={`FCF margin ${r.fcfMarginAnn?.toFixed(0)}% vs Op margin ${r.opmTtm?.toFixed(0)}% — FCF likely inflated by working-capital release / SBC add-back / deferred revenue, not sustainable from operations.`}
                             style={{fontSize:9,fontWeight:800,color:RED,background:`${RED}18`,border:`1px solid ${RED}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          🚨 FCF SUSPECT
                        </div>
                      )}
                      {r.suggestedMaxPositionPct !== undefined && (
                        <div title={`Position-size guidance based on market cap. Microcap volatility is structurally 2-3× large-cap, so size should reflect liquidity, not just composite score.`}
                             style={{fontSize:9,fontWeight:700,color:'var(--mc-text-3)',background:'rgba(148,163,184,0.10)',border:'1px solid rgba(148,163,184,0.25)',padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          MAX {r.suggestedMaxPositionPct}%
                        </div>
                      )}
                      {/* PATCH 0577 — ADV (Average Daily $ Value) chip.
                          Tier colors mirror institutional thresholds:
                          ≥ $50M = green (any desk can size), $10-50M = amber
                          (be careful), < $10M = red (institutional slippage
                          risk). Derived from TradingView price × volume. */}
                      {r.avgDailyValueUsdM !== undefined && r.avgDailyValueUsdM > 0 && (() => {
                        const v = r.avgDailyValueUsdM;
                        const tier = v >= 50 ? { c: '#10b981', bg: '#10b98118', bd: '#10b98140', hint: 'Heavy-institutional liquid — any desk can scale.' }
                                  : v >= 10 ? { c: '#f59e0b', bg: '#f59e0b18', bd: '#f59e0b40', hint: 'Mid-cap liquid — size with slippage discipline.' }
                                  :            { c: '#ef4444', bg: '#ef444418', bd: '#ef444440', hint: 'Thin tape — institutional desks avoid above 1% ADV.' };
                        const label = v >= 1000 ? `$${(v / 1000).toFixed(1)}B`
                                    : v >= 1   ? `$${v.toFixed(1)}M`
                                                : `$${(v * 1000).toFixed(0)}K`;
                        return (
                          <div title={`Average Daily $ Volume ≈ ${label} (price × 30-day avg volume). ${tier.hint}`}
                               style={{fontSize:9,fontWeight:800,color:tier.c,background:tier.bg,border:`1px solid ${tier.bd}`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                            ADV {label}
                          </div>
                        );
                      })()}
                      {/* PATCH 0576 — Per-row stale-fundamentals chip. Fires
                          when this CSV upload is > 60 days old AND the row's
                          1-year perf has moved ≥ 15% since the snapshot.
                          Per-row variant of the page-level banner from #77 —
                          this lets the analyst spot WHICH names specifically
                          need a re-export (high-momentum names, where the
                          stale-fundamentals risk is highest). */}
                      {usaUploadAgeDays != null && usaUploadAgeDays > 60 &&
                        typeof r.perf1y === 'number' && Math.abs(r.perf1y) >= 15 && (
                        <div title={`Fundamentals captured ${usaUploadAgeDays}d ago, but 1y perf is ${r.perf1y.toFixed(0)}%. The scorecard may not reflect the current setup — re-export the row from TradingView before acting.`}
                             style={{fontSize:9,fontWeight:800,color:ORANGE,background:`${ORANGE}18`,border:`1px solid ${ORANGE}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          ⏳ STALE {usaUploadAgeDays}d
                        </div>
                      )}
                      {r.nextEarnings&&<div style={{fontSize:9,color:'var(--mc-warn)'}}>📅 {r.nextEarnings}</div>}
                      {r.analystRating && (() => {
                        const rating = r.analystRating.toLowerCase();
                        const col = rating.includes('strong buy') ? GREEN : rating.includes('buy') ? '#34d399' : rating.includes('strong sell') ? RED : rating.includes('sell') ? ORANGE : MUTED;
                        return <div style={{fontSize:9,fontWeight:700,color:col}}>{r.analystRating}</div>;
                      })()}
                    </div>
                    <span style={{fontSize:F.sm,color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.company}</span>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:1}}>
                      <span style={{fontSize:F.h2,fontWeight:900,color:GRADE_COLOR_US[r.grade]}}>{r.score}</span>
                      {/* PATCH 1101rr — RS Rating below score (O'Neil-style 1-99 momentum).
                          Color: green ≥80, cyan 60-80, muted 40-60, orange <40. */}
                      {typeof (r as any).rsRating === 'number' && (
                        <span style={{fontSize:F.xxs,fontWeight:800,color:(r as any).rsRating>=80?GREEN:(r as any).rsRating>=60?'#22D3EE':(r as any).rsRating>=40?MUTED:ORANGE,letterSpacing:'0.3px'}}
                          title={`RS Rating: O'Neil-style 1-99 momentum composite (30% 3M + 40% 6M + 30% 1Y)`}>
                          RS {(r as any).rsRating}
                        </span>
                      )}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:1}}>
                      <span style={{fontSize:F.md,fontWeight:800,padding:'4px 8px',borderRadius:6,color:GRADE_COLOR_US[r.grade],backgroundColor:`${GRADE_COLOR_US[r.grade]}18`,border:`1px solid ${GRADE_COLOR_US[r.grade]}30`,textAlign:'center'}}>{r.grade}</span>
                      {/* PATCH 1101rr — Implied Upside % below grade. Green positive, red negative. */}
                      {typeof (r as any).impliedUpsidePct === 'number' && (
                        <span style={{fontSize:F.xxs,fontWeight:800,color:(r as any).impliedUpsidePct>=20?GREEN:(r as any).impliedUpsidePct>=0?'#22D3EE':RED,letterSpacing:'0.3px'}}
                          title={`Implied upside vs analyst 1-year mean target price`}>
                          {(r as any).impliedUpsidePct>=0?'↑':'↓'} {Math.abs((r as any).impliedUpsidePct)}%
                        </span>
                      )}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      {r.forwardPe !== undefined && r.forwardPe > 0
                        ? <div style={{display:'flex',alignItems:'baseline',gap:3}}><span style={{fontSize:F.xs,color:MUTED}}>Fwd P/E</span><span style={{fontSize:F.md,fontWeight:800,color:r.forwardPe<25?GREEN:r.forwardPe<50?YELLOW:ORANGE}}>{r.forwardPe.toFixed(0)}×</span></div>
                        : r.pe !== undefined && r.pe > 0
                        ? <div style={{display:'flex',alignItems:'baseline',gap:3}}><span style={{fontSize:F.xs,color:MUTED}}>P/E</span><span style={{fontSize:F.md,fontWeight:800,color:r.pe<25?GREEN:r.pe<50?YELLOW:ORANGE}}>{r.pe.toFixed(0)}×</span></div>
                        : <span style={{fontSize:F.xs,color:`${MUTED}60`}}>P/E —</span>
                      }
                      {r.evEbitda !== undefined && r.evEbitda > 0
                        ? <span style={{fontSize:10,color:MUTED}}>EV/EBITDA {r.evEbitda.toFixed(0)}×</span>
                        : null}
                      {r.marketCapB !== undefined && <span style={{fontSize:9,color:MUTED}}>${r.marketCapB >= 1 ? r.marketCapB.toFixed(1)+'B' : (r.marketCapB*1000).toFixed(0)+'M'}</span>}
                    </div>
                    {/* ACCEL cell — signal + QoQ/Annual % only (R40 moved to own column) */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.xs,fontWeight:700,color:r.accelSignal==='ACCELERATING'?GREEN:r.accelSignal==='DECELERATING'?RED:MUTED}}>
                        {r.accelSignal??'—'}
                      </span>
                      {r.revenueGrowthQtr !== undefined && <span style={{fontSize:10,color:MUTED}}>QoQ +{r.revenueGrowthQtr.toFixed(0)}%</span>}
                      {r.revenueGrowthAnn !== undefined && <span style={{fontSize:10,color:MUTED}}>Ann +{r.revenueGrowthAnn.toFixed(0)}%</span>}
                    </div>
                    {/* PATCH 0346 — R40 dedicated column: big number + tier color + composition */}
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                      {r.ruleOf40 !== undefined ? (
                        <>
                          <span style={{fontSize:F.lg,fontWeight:900,
                            color:r.ruleOf40>=80?GREEN:r.ruleOf40>=60?'#34d399':r.ruleOf40>=40?YELLOW:r.ruleOf40>=20?ORANGE:RED}}>
                            {r.ruleOf40}
                          </span>
                          <span style={{fontSize:9,color:MUTED}}>
                            {r.ruleOf40>=80?'🏆 elite':r.ruleOf40>=60?'strong':r.ruleOf40>=40?'passes':r.ruleOf40>=20?'weak':'fail'}
                          </span>
                          {r.revenueGrowthQtr !== undefined && r.fcfMarginAnn !== undefined && (
                            <span style={{fontSize:9,color:`${MUTED}90`}} title={`R40 = Qtr Rev ${r.revenueGrowthQtr.toFixed(0)}% + FCF ${r.fcfMarginAnn.toFixed(0)}%`}>
                              {r.revenueGrowthQtr.toFixed(0)}+{r.fcfMarginAnn.toFixed(0)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{fontSize:F.xs,color:`${MUTED}60`}}>—</span>
                      )}
                    </div>
                    <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      {(r.pillarScores || []).map(p=>(
                        <div key={p.id} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,minWidth:32}}>
                          <span style={{fontSize:F.sm,fontWeight:700,color:p.color}}>{p.score}</span>
                          <div style={{width:26,height:5,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${p.score}%`,backgroundColor:p.color}}/>
                          </div>
                          <span style={{fontSize:9,color:MUTED}}>{p.label.slice(0,4)}</span>
                        </div>
                      ))}
                    </div>
                    {/* COV + score delta */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.sm,color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE}}>{r.coverage}%</span>
                      {(() => {
                        const prev = usPrevScores[r.symbol];
                        if (prev===undefined) return null;
                        const d = r.score - prev;
                        if (d===0) return null;
                        return <span style={{fontSize:9,fontWeight:700,color:d>0?GREEN:RED}}>{d>0?`↑${d}`:`↓${Math.abs(d)}`}</span>;
                      })()}
                    </div>
                  </div>
                </button>
                {isExp&&(
                  <div style={{padding:'16px 14px 20px',backgroundColor:`${CARD_BG}CC`,borderTop:`1px solid ${BORDER}`}}>
                    {/* PATCH 0347 — Decision logbook bar (USA) */}
                    <DecisionBar symbol={r.symbol} company={r.company} market="US" score={r.score} grade={r.grade} currentPrice={(r as any).cmp} bump={bumpUsDecisions} />
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16}}>
                      <div>
                        <div style={{fontSize:F.sm,color:MUTED,fontWeight:700,letterSpacing:'0.8px',marginBottom:8}}>KEY METRICS</div>
                        {[
                          ['Rev Growth (Ann)','revenueGrowthAnn','%'],['Rev Growth (Qtr YoY)','revenueGrowthQtr','%'],
                          ['Gross Margin','grossMarginAnn','%'],['FCF Margin','fcfMarginAnn','%'],
                          ['Operating Margin','opmTtm','%'],['Net Profit Margin','netProfitMargin','%'],
                          ['ROE','roe','%'],['ROIC','roic','%'],
                          ['P/E','pe','×'],['Forward P/E','forwardPe','×'],['EV/EBITDA','evEbitda','×'],['P/S','ps','×'],
                          ['Market Cap','marketCapB','$B'],['D/E','de','×'],['EPS Growth','epsGrowth','%'],
                          ['1Y Performance','perf1y','%'],['vs 52W High','pctFrom52wHigh','%'],
                        ].filter(([,f])=>(r as any)[f]!==undefined).map(([label,field,unit])=>{
                          const v=(r as any)[field] as number;
                          return (
                            <div key={String(field)} style={{display:'flex',justifyContent:'space-between',fontSize:F.md,padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <span style={{color:MUTED}}>{label}</span>
                              <span style={{color:TEXT,fontWeight:700}}>{unit==='$B'?`$${v.toFixed(1)}B`:unit==='%'?`${v.toFixed(1)}%`:`${v.toFixed(1)}×`}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div>
                        {(r.strengths || []).length>0&&<>
                          <div style={{fontSize:F.sm,color:GREEN,fontWeight:700,marginBottom:6}}>✅ STRENGTHS</div>
                          {(r.strengths || []).map((s,i)=><div key={i} style={{fontSize:F.md,color:MUTED,padding:'3px 0'}}>› {s}</div>)}
                        </>}
                        {(r.risks || []).length>0&&<>
                          <div style={{fontSize:F.sm,color:ORANGE,fontWeight:700,marginTop:12,marginBottom:6}}>⚠️ RISKS</div>
                          {(r.risks || []).map((s,i)=><div key={i} style={{fontSize:F.md,color:MUTED,padding:'3px 0'}}>› {s}</div>)}
                        </>}
                        <div style={{fontSize:F.sm,color:MUTED,marginTop:12,borderTop:`1px solid ${BORDER}`,paddingTop:8}}>
                          {r.sector} · {r.exchange} · Data: {r.coverage}% · {r.nextEarnings&&`Next earnings: ${r.nextEarnings}`}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {!rows.length&&!loading&&(
        <div style={{textAlign:'center',padding:56,color:MUTED}}>
          <div style={{fontSize:48}}>🇺🇸</div>
          <div style={{fontSize:F.h2,color:TEXT,fontWeight:700,marginTop:14}}>Upload TradingView CSV to score US stocks</div>
          <div style={{fontSize:F.md,color:MUTED,marginTop:8}}>Go to TradingView Screener → add the columns above → Export CSV → upload here</div>
        </div>
      )}
    </div>
  );
}
