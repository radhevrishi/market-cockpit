'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { usdInrNow } from '@/lib/fx-client';
import { rsVsIndex, type IndexReturns, type RsVsIndex } from '@/lib/relative-strength';
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { getConvictionTickers, readConvictionBeats } from '@/lib/conviction-beats';
import { getDecision } from '@/lib/decisions';
import { armBookFlag } from '@/lib/book-flags-client';
import { extensionCheck } from '@/lib/tech-extension';
import { getTradingviewSyncStatus } from '@/lib/screener-data-loader';
import { CHECKLIST } from '@/lib/multibagger-india-scoring';
import { F, MUTED } from './constants';
import { STAGE_META, classifyStage } from './helpers';
import { _getIndiaRowsMemCache, _getUsaRowsMemCache } from './mem-cache';
import { NewSeenCheckbox, RecentlyAddedPanel, useNewTracker } from './new-tracker';
import { SepaChecklistPanel, VolumePocketsPanel } from './technicals-panels';
import { type NewTabKey } from './types';
import { parseUSARow } from './usa-parse';

// zzz172 — Module-level dedupe for auto-pull. When user rapidly switches
// USA <-> IND Technicals tabs, both TechnicalsTab instances would fire
// handlePullFromServer against the same manifest.lastSync. This shared map
// tracks in-flight pulls by manifest timestamp so a second tab short-circuits
// while the first is running.
const _techPullInFlight: { current: Set<string> } = { current: new Set() };

export function TechnicalsTab({ market = 'USA' }: { market?: 'USA' | 'IND' }) {
  // zzz149 — Tab is parameterized by market. All localStorage keys are scoped
  // per market so USA + India tabs are fully independent. Uploads in either
  // tab auto-segregate rows by Exchange field into BOTH tabs' caches.
  const MK = market.toLowerCase(); // 'usa' | 'ind'
  // zzz131 — FIX `num is not defined` runtime error. The `num` helper was
  // previously only defined inside MultibaggerAnalytics (line ~7117), so when
  // this standalone TechnicalsTab component rendered it threw ReferenceError
  // on mount and showed the user the "Something went wrong" boundary.
  // Defining a local copy here keeps TechnicalsTab self-contained.
  function num(v: any): number | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  const [dataTick, bumpData] = React.useReducer((x: number) => x + 1, 0);
  // zzz891: the index's own returns for the same windows (NIFTY 50 / S&P 500), once per visit
  const [idxRet, setIdxRet] = React.useState<IndexReturns | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetch(`/api/v1/index-returns?market=${market === 'IND' ? 'IN' : 'US'}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j?.ok) setIdxRet(j as IndexReturns); }).catch(() => {});
    return () => { alive = false; };
  }, [market]);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => bumpData();
    window.addEventListener('storage', refresh);
    window.addEventListener('mb-upload:updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('mb-upload:updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  // zzz149 — Per-market localStorage keys. USA tab uses _usa_, India tab uses _ind_.
  // No fallback to USA Multibagger cache — empty means empty.
  const TECH_ROWS_KEY = `mb_tech_rows_${MK}_v1`;
  const TECH_SOURCES_KEY = `mb_tech_sources_${MK}_v1`;
  // zzz149 — Migration: copy legacy mb_tech_rows_v1 → USA tab on first mount (one-time)
  if (typeof window !== 'undefined' && MK === 'usa') {
    try {
      const legacyRows = localStorage.getItem('mb_tech_rows_v1');
      if (legacyRows && !localStorage.getItem(TECH_ROWS_KEY)) {
        localStorage.setItem(TECH_ROWS_KEY, legacyRows);
        const legacySources = localStorage.getItem('mb_tech_sources_v1');
        if (legacySources) localStorage.setItem(TECH_SOURCES_KEY, legacySources);
        localStorage.removeItem('mb_tech_rows_v1');
        localStorage.removeItem('mb_tech_sources_v1');
      }
    } catch {}
  }
  type TechSource = { name: string; rowCount: number; cols: number; warning?: string };
  const [techLocalRows, setTechLocalRows] = React.useState<any[]>(() => {
    if (typeof window === 'undefined') return [];
    try { const raw = localStorage.getItem(TECH_ROWS_KEY); return raw ? (JSON.parse(raw) as any[]) : []; } catch { return []; }
  });
  const [techSources, setTechSources] = React.useState<TechSource[]>(() => {
    if (typeof window === 'undefined') return [];
    try { const raw = localStorage.getItem(TECH_SOURCES_KEY); return raw ? (JSON.parse(raw) as TechSource[]) : []; } catch { return []; }
  });
  const [techAppendMode, setTechAppendMode] = React.useState<boolean>(true);
  const [techUploadMsg, setTechUploadMsg] = React.useState<string>('');
  const [techLoading, setTechLoading] = React.useState<boolean>(false);
  const techFileRef = React.useRef<HTMLInputElement>(null);

  // ADDITIVE (audit) — Cross-links so a technical breakout that is ALSO a
  // fundamental conviction pick (🏆 bench) or an earnings/transformation
  // inflection (🚀 radar) is obvious at a glance. Plus a market-breadth regime
  // strip so setups are framed by risk-on/risk-off context. All best-effort:
  // every fetch is in a try/catch, tolerates failure, and hides silently.
  const [benchMap, setBenchMap] = React.useState<Record<string, { tier?: string; conviction_score?: number }>>({});
  const [radarMap, setRadarMap] = React.useState<Map<string, { symbol: string; transformation_score?: number }>>(new Map());
  const [techRegime, setTechRegime] = React.useState<{ composite: number; regime: string; regime_color?: string; regime_desc?: string; suggested_cash_pct?: number; scope_label?: string; universe_size?: number } | null>(null);
  const [confluenceOnly, setConfluenceOnly] = React.useState<boolean>(false);
  // ADDITIVE (audit R3) — Buyable-only toggle + sector/group table filter.
  const [buyableOnly, setBuyableOnly] = React.useState<boolean>(false);
  const [groupFilter, setGroupFilter] = React.useState<string>('');
  // ADDITIVE (earnings-risk guard) — hide names reporting within 7 days from
  // the buy-side buckets (pros never buy a breakout into a binary earnings gap).
  const [hideEarningsRisk, setHideEarningsRisk] = React.useState<boolean>(false);
  // MULTI-PIVOT — Prime Setups MA filter: ALL | 21-EMA | 50-DMA | 89-EMA | 200-DMA
  const [pivotFilter, setPivotFilter] = React.useState<string>('ALL');
  // ADDITIVE (audit R3) — EXTENDED vs BUYABLE classification. Qullamaggie/Minervini
  // buy AT the pivot (within ~5% of the 21-EMA), never chasing 10%+ extended.
  // Prefers the real 21-EMA distance; falls back to the SMA50/EMA50 rightEntry
  // model when 21-EMA data is absent. Returns null when there's no distance data.
  const buyability = React.useCallback((r: any): { label: string; buyable: boolean; color: string; title: string } | null => {
    const e = typeof r?.pctVsEma21 === 'number' ? r.pctVsEma21 : undefined;
    if (typeof e === 'number') {
      if (e < -3) return { label: `${e.toFixed(1)}% ↓21EMA`, buyable: false, color: '#94A3B8', title: 'Below 21-EMA — wait for reclaim' };
      if (e <= 5) return { label: '🎯 Buyable', buyable: true, color: '#10B981', title: `+${e.toFixed(1)}% over 21-EMA — low-risk pivot entry` };
      if (e <= 12) return { label: `⏳ +${e.toFixed(0)}% ext`, buyable: false, color: '#FBBF24', title: `+${e.toFixed(1)}% over 21-EMA — mildly extended; prefer pullback` };
      return { label: `🚫 +${e.toFixed(0)}% ext`, buyable: false, color: '#EF4444', title: `+${e.toFixed(1)}% over 21-EMA — extended, chasing = poor R/R` };
    }
    // Fallback: reuse the existing rightEntry model.
    if (r?.rightEntry === 'BUY ZONE') return { label: '🎯 Buyable', buyable: true, color: '#10B981', title: r.rightEntryDetail || 'In buy zone' };
    if (r?.rightEntry === 'EXTENDED') return { label: '⏳ Extended', buyable: false, color: '#FBBF24', title: r.rightEntryDetail || 'Extended — wait for pullback' };
    if (r?.rightEntry === 'CHASE') return { label: '🚫 Chasing', buyable: false, color: '#EF4444', title: r.rightEntryDetail || 'Chasing — high risk' };
    return null;
  }, []);
  // ADDITIVE (earnings-risk guard) — classify how close a name is to reporting.
  // Returns null when there is no earnings date (many India / some USA rows) so
  // those never get a badge and are never filtered out.
  const earningsRisk = React.useCallback((r: any): { days: number; level: 'critical'|'high'|'watch'; color: string; label: string } | null => {
    const d = r?.daysToEarnings;
    if (typeof d !== 'number' || d < 0 || d > 14) return null;
    if (d <= 3)  return { days: d, level: 'critical', color: '#EF4444', label: `⚠️ ERN ${d}d` };
    if (d <= 7)  return { days: d, level: 'high',     color: '#F59E0B', label: `⚠️ ERN ${d}d` };
    return { days: d, level: 'watch', color: '#FBBF24', label: `🗓 ERN ${d}d` };
  }, []);
  // MULTI-PIVOT — which MA is the price actually resting on (the buyable pivot).
  // 21-EMA (tightest) · 50-DMA (standard) · 89-EMA (deeper) · 200-DMA (deep reclaim).
  // Adaptive bands widen for deeper MAs and scale with ADR. Returns null if none.
  const nearestPivot = React.useCallback((r: any): { ma: string; dist: number; band: number } | null => {
    const adr = (typeof r?.adrPct === 'number' && r.adrPct > 0) ? r.adrPct : 0;
    const cands = [
      { ma: '21-EMA', dist: r?.pctVsEma21, band: Math.max(4, adr ? adr * 1.5 : 4) },
      { ma: '50-DMA', dist: (typeof r?.pctVsSma50 === 'number' ? r.pctVsSma50 : r?.pctVsEma50), band: Math.max(7, adr ? adr * 2 : 7) },
      { ma: (r?.mediumMaLabel || '89-EMA'), dist: r?.pctVsMedium, band: Math.max(9, adr ? adr * 2.5 : 9) },
      { ma: '200-DMA', dist: (typeof r?.pctVsSma200 === 'number' ? r.pctVsSma200 : r?.pctVsEma200), band: Math.max(12, adr ? adr * 3 : 12) },
    ].filter(c => typeof c.dist === 'number');
    // "at" a pivot = from just below (reclaim, -2%) up to that MA's adaptive ceiling
    const atPivots = cands.filter(c => c.dist >= -2 && c.dist <= c.band);
    if (!atPivots.length) return null;
    // the pivot the price is truly resting on = smallest absolute distance
    atPivots.sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist));
    return { ma: atPivots[0].ma, dist: atPivots[0].dist, band: atPivots[0].band };
  }, []);
  // Auto-sync freshness status (drives the hands-free banner). Best-effort.
  const [techSyncStatus, setTechSyncStatus] = React.useState<Awaited<ReturnType<typeof getTradingviewSyncStatus>> | null>(null);
  const refreshSyncStatus = React.useCallback(() => {
    getTradingviewSyncStatus().then(setTechSyncStatus).catch(() => {});
  }, []);
  React.useEffect(() => { refreshSyncStatus(); }, [refreshSyncStatus]);
  const agoLabel = React.useCallback((d: Date | null | undefined) => {
    if (!d) return '?';
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }, []);
  // Bench is client-side localStorage — read synchronously + refresh on focus/mount.
  React.useEffect(() => {
    const load = () => {
      try {
        const beats = readConvictionBeats();
        const m: Record<string, { tier?: string; conviction_score?: number }> = {};
        for (const [k, v] of Object.entries(beats || {})) {
          const sym = String((v as any)?.ticker || k || '').toUpperCase().replace(/\.NS$|\.BO$/i, '').trim();
          if (sym) m[sym] = { tier: (v as any)?.tier, conviction_score: (v as any)?.composite_score };
        }
        setBenchMap(m);
      } catch {}
    };
    load();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', load);
      return () => window.removeEventListener('focus', load);
    }
  }, []);
  // Transformation radar (concall earnings-inflection screener) — India-centric API.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/v1/concall-intel/transformation-screener?days=60&limit=80', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const entries: any[] = Array.isArray(data?.entries) ? data.entries : [];
        const m = new Map<string, { symbol: string; transformation_score?: number }>();
        for (const e of entries) {
          const sym = String(e?.symbol || '').toUpperCase().replace(/\.NS$|\.BO$/i, '').trim();
          if (sym) m.set(sym, { symbol: sym, transformation_score: e?.transformation_score });
        }
        if (alive) setRadarMap(m);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);
  // ── Market-breadth regime strip  (zzz626) ────────────────────────────
  // THE REGION IS PASSED. This component renders for both markets, and it used
  // to call /api/v1/breadth with no region at all — an endpoint that is NSE
  // from top to bottom. So the USA Technicals tab was framing US breakout
  // setups with INDIAN market participation, and both tabs showed the same
  // regime number for two different markets, which is how it was noticed.
  // `market` has been on this component all along; it simply was not used here.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/v1/breadth${market === 'USA' ? '?region=us' : ''}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data && typeof data.composite === 'number') setTechRegime(data);
        else if (alive) setTechRegime(null);   // a wrong regime is worse than none
      } catch {}
    })();
    return () => { alive = false; };
  }, [market]);
  // Per-row cross-link helpers + inline badge renderer, reused across every table.
  const normSym = React.useCallback((s: any) => String(s || '').toUpperCase().replace(/\.NS$|\.BO$/i, '').trim(), []);
  const onBench = React.useCallback((s: any) => !!benchMap[normSym(s)], [benchMap, normSym]);
  const onRadar = React.useCallback((s: any) => radarMap.has(normSym(s)), [radarMap, normSym]);
  const symBadges = React.useCallback((s: any) => {
    const k = normSym(s);
    const b = benchMap[k]; const r = radarMap.get(k);
    if (!b && !r) return null;
    return (
      <>
        {b && <span title={`On Conviction Bench${b.tier ? ' · ' + b.tier : ''}${typeof b.conviction_score === 'number' ? ' · score ' + b.conviction_score : ''}`}
          style={{ marginLeft: 5, fontSize: 12, cursor: 'help' }}>🏆</span>}
        {r && <span title={`On Transformation Radar${typeof r.transformation_score === 'number' ? ' · T-' + r.transformation_score : ''}`}
          style={{ marginLeft: 3, fontSize: 12, cursor: 'help' }}>🚀</span>}
      </>
    );
  }, [benchMap, radarMap, normSym]);

  // zzz149 — Fallback toggle removed entirely. Empty = empty, period.
  // Variables retained as constants so existing UI code referencing them still compiles.
  const techNoFallback = true;
  const setTechNoFallback = (_: boolean) => {};

  // zzz157 — DO NOT listen for our own 'mb-tech-updated' dispatch in the same tab.
  // Bug from zzz155: the handler re-read localStorage; if setItem hit the browser's
  // 5MB quota and silently threw, the read returned STALE data (0 rows) which reset
  // state — nuking the 47 rows we just computed. Only listen for cross-BROWSER-tab
  // 'storage' events (which only fire when a DIFFERENT tab writes to localStorage).
  // In-app tab switch already unmounts+remounts TechnicalsTab (see the
  // `activeTab==='technicals-ind' && <TechnicalsTab market="IND" />` pattern), so
  // fresh mount re-reads localStorage naturally.
  React.useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== TECH_ROWS_KEY && e.key !== TECH_SOURCES_KEY) return;
      try {
        const rawRows = localStorage.getItem(TECH_ROWS_KEY);
        const rawSrcs = localStorage.getItem(TECH_SOURCES_KEY);
        if (rawRows) setTechLocalRows(JSON.parse(rawRows));
        if (rawSrcs) setTechSources(JSON.parse(rawSrcs));
      } catch {}
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [TECH_ROWS_KEY, TECH_SOURCES_KEY]);

  // zzz148 — Accepts File[] (already cloned from FileList by caller) to avoid the
  // race where onChange resets e.target.value before the async handler iterates.
  const handleTechFiles = async (files: File[]) => {
    setTechLoading(true);
    setTechUploadMsg('');
    try {
      // zzz147 — Defensive: if no files passed in, show warning instead of fake success.
      if (!files || files.length === 0) {
        setTechUploadMsg('⚠️ No files received — try the file picker again.');
        setTechLoading(false);
        return;
      }
      const XLSX = await import('xlsx');
      const newRows: any[] = [];
      const newSources: TechSource[] = [];
      const fileDiagnostics: string[] = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        const cols = raw.length > 0 ? Object.keys(raw[0]).length : 0;
        // zzz147 — Detect which symbol-column the file uses
        let symbolKey = 'Symbol';
        if (raw.length > 0 && !(symbolKey in raw[0])) {
          if ('Ticker' in raw[0]) symbolKey = 'Ticker';
        }
        let parsedCount = 0; let rejectCount = 0;
        for (const r of raw) {
          const rec = r as Record<string, unknown>;
          // zzz147 — Normalize so parseUSARow finds 'Symbol' regardless of original key
          if (symbolKey !== 'Symbol' && rec[symbolKey] && !rec['Symbol']) {
            rec['Symbol'] = rec[symbolKey];
          }
          const parsed = parseUSARow(rec);
          if (!parsed || !parsed.symbol) { rejectCount++; continue; }
          newRows.push(parsed);
          parsedCount++;
        }
        let warning: string | undefined;
        if (cols < 60) warning = `⚠️ Thin CSV (only ${cols} cols) — missing SMA/EMA/ATR/Industry. Stocks will show NO DATA.`;
        if (parsedCount === 0) {
          warning = `⚠️ Zero rows parsed (${raw.length} raw, ${rejectCount} rejected). Symbol column: "${symbolKey}". Check that the CSV has a Symbol or Ticker column.`;
          fileDiagnostics.push(`"${file.name}": 0 of ${raw.length} parsed — no symbol column?`);
        }
        newSources.push({ name: file.name, rowCount: parsedCount, cols, warning });
      }
      // zzz149 — Auto-segregate each parsed row by Exchange field into USA or India bucket.
      // Single upload fans out into BOTH tabs' localStorage so the user only uploads once.
      const USA_EXCHANGES = new Set(['NYSE','NASDAQ','NMS','ARCA','AMEX','BATS','OTC','NYSE ARCA','NYSEARCA']);
      const IND_EXCHANGES = new Set(['NSE','BSE']);
      const usaNewRows: any[] = [];
      const indNewRows: any[] = [];
      const unknownNewRows: any[] = [];
      for (const r of newRows) {
        const ex = String((r as any).exchange || '').toUpperCase().trim();
        if (USA_EXCHANGES.has(ex)) usaNewRows.push(r);
        else if (IND_EXCHANGES.has(ex)) indNewRows.push(r);
        else unknownNewRows.push(r);
      }
      // Unknown rows → keep them in the CURRENT tab (user chose to upload here)
      const currentBucket = MK === 'usa' ? usaNewRows : indNewRows;
      currentBucket.push(...unknownNewRows);

      // Read the OTHER tab's current rows + sources to merge into
      const otherMk = MK === 'usa' ? 'ind' : 'usa';
      const otherRowsKey = `mb_tech_rows_${otherMk}_v1`;
      const otherSourcesKey = `mb_tech_sources_${otherMk}_v1`;
      let otherExistingRows: any[] = [];
      let otherExistingSources: TechSource[] = [];
      try { otherExistingRows = JSON.parse(localStorage.getItem(otherRowsKey) || '[]'); } catch {}
      try { otherExistingSources = JSON.parse(localStorage.getItem(otherSourcesKey) || '[]'); } catch {}

      // Merge function: append (default) or replace, dedupe by symbol
      const mergeBucket = (existing: any[], newOnes: any[]) => {
        const base = techAppendMode ? [...existing] : [];
        const seen = new Set(base.map((r: any) => r.symbol));
        let added = 0, dup = 0;
        for (const r of newOnes) {
          if (seen.has(r.symbol)) { dup++; continue; }
          seen.add(r.symbol);
          base.push(r);
          added++;
        }
        return { rows: base, added, dup };
      };

      // zzz159 — Dedup source chips by name so re-uploading the same file replaces the chip.
      const dedupSources = (existing: TechSource[], incoming: TechSource[]) => {
        const incomingNames = new Set(incoming.map(s => s.name));
        return [...existing.filter(s => !incomingNames.has(s.name)), ...incoming];
      };

      // Apply to current tab
      const currentMerge = mergeBucket(techLocalRows, currentBucket);
      const baseSources = dedupSources(techAppendMode ? techSources : [], newSources);
      setTechLocalRows(currentMerge.rows);
      setTechSources(baseSources);
      try { localStorage.setItem(TECH_ROWS_KEY, JSON.stringify(currentMerge.rows)); } catch {}
      try { localStorage.setItem(TECH_SOURCES_KEY, JSON.stringify(baseSources)); } catch {}

      // Apply to OTHER tab (write-only; that tab will pick up on its next mount/refresh)
      const otherBucket = MK === 'usa' ? indNewRows : usaNewRows;
      let otherAdded = 0;
      if (otherBucket.length > 0) {
        const otherMerge = mergeBucket(otherExistingRows, otherBucket);
        otherAdded = otherMerge.added;
        // Same source files recorded in the OTHER tab too so user sees full provenance
        const otherSourcesNew = dedupSources(
          techAppendMode ? otherExistingSources : [],
          newSources.map(s => ({ ...s, rowCount: otherBucket.length }))
        );
        try { localStorage.setItem(otherRowsKey, JSON.stringify(otherMerge.rows)); } catch {}
        try { localStorage.setItem(otherSourcesKey, JSON.stringify(otherSourcesNew)); } catch {}
        // zzz155 — broadcast so a mounted OTHER-market tab reloads its state
        // zzz157 — no cross-tab dispatch needed; unmount/remount handles rehydration
      }

      // zzz149 — Diagnostics + routed-count message
      const otherLabel = MK === 'usa' ? 'India' : 'USA';
      const meLabel = MK === 'usa' ? 'USA' : 'India';
      if (newRows.length === 0) {
        setTechUploadMsg(`⚠️ ${newSources.length} file${newSources.length>1?'s':''} read but 0 rows parsed. ${fileDiagnostics.length>0 ? fileDiagnostics[0] : ''} See file chips below for per-file warning.`);
      } else {
        const parts: string[] = [];
        parts.push(`✓ ${newSources.length} file${newSources.length>1?'s':''}`);
        parts.push(`→ ${meLabel} ${currentMerge.added} new`);
        if (otherAdded > 0) parts.push(`→ ${otherLabel} ${otherAdded} new (auto-routed by Exchange)`);
        if (currentMerge.dup > 0) parts.push(`${currentMerge.dup} dedup`);
        if (unknownNewRows.length > 0) parts.push(`${unknownNewRows.length} unknown-exchange kept in ${meLabel}`);
        parts.push(`· total ${currentMerge.rows.length} on this tab`);
        setTechUploadMsg(parts.join(' '));
      }
      bumpData();
    } catch (e) {
      setTechUploadMsg(`⚠️ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setTechLoading(false);
  };
  const clearTechRows = () => {
    setTechLocalRows([]);
    setTechSources([]);
    try { localStorage.removeItem(TECH_ROWS_KEY); } catch {}
    try { localStorage.removeItem(TECH_SOURCES_KEY); } catch {}
    // zzz155 — broadcast so other-market mounted tab reloads (though clear is per-tab
    // only; other tab shouldn't change, but keep dispatch pattern consistent)
    try { window.dispatchEvent(new CustomEvent('mb-tech-updated')); } catch {}
    setTechUploadMsg(`✓ Cleared ${market === 'USA' ? 'USA' : 'India'} Technicals uploads.`);
    bumpData();
  };

  // zzz155 — Pull latest TradingView screener CSVs from the daily-synced repo folder.
  // Rewrite of zzz154 fixing:
  //   (a) Per-file row counts for BOTH tabs (was: aggregate total shown per file)
  //   (b) Cross-tab rehydration — dispatches 'mb-tech-updated' so a stale India tab
  //       component reloads its state from localStorage after a USA-tab pull writes to it.
  const handlePullFromServer = async () => {
    // zzz172 — Wrap in try/finally so setTechLoading(false) always runs,
    // even if an unexpected throw happens before the outer try block below.
    setTechLoading(true);
    setTechUploadMsg('⏳ Fetching latest from server…');
    try {
      const manifestResp = await fetch('/data/tradingview/manifest.json', { cache: 'no-store' });
      if (!manifestResp.ok) throw new Error(`manifest ${manifestResp.status}`);
      const manifest = await manifestResp.json();
      // zzz172 — race guard: if another TechnicalsTab (other market) is already
      // pulling this exact manifest.lastSync, don't fire a second concurrent pull.
      const pullKey = `${MK}-${manifest.lastSync || '?'}`;
      if (_techPullInFlight.current.has(pullKey)) {
        setTechUploadMsg('⏭ Another pull already in flight for this snapshot');
        return;
      }
      _techPullInFlight.current.add(pullKey);
      const files = (manifest.files || []).filter((f: any) => f.ok);
      if (files.length === 0) {
        setTechUploadMsg(`⚠️ Server manifest has no successful files. Last sync: ${manifest.lastSync || '?'}`);
        _techPullInFlight.current.delete(pullKey);
        return;
      }
      const XLSX = await import('xlsx');
      const USA_EXCHANGES = new Set(['NYSE','NASDAQ','NMS','ARCA','AMEX','BATS','OTC','NYSE ARCA','NYSEARCA']);
      const IND_EXCHANGES = new Set(['NSE','BSE']);
      const usaNewRows: any[] = [];
      const indNewRows: any[] = [];
      // Per-file source records for EACH tab (with proper per-file row counts)
      const usaSourcesPerFile: TechSource[] = [];
      const indSourcesPerFile: TechSource[] = [];
      // zzz883 speed: all CSV files are requested at once (they were fetched one after another)
      const csvFetches = new Map<string, Promise<Response>>(files.map((f: any) => [f.name, fetch(`/data/tradingview/${f.name}`, { cache: 'no-store' })]));
      for (const f of files) {
        try {
          const csvResp = await csvFetches.get(f.name)!;
          const label = `📡 ${f.displayName || f.name}`;
          if (!csvResp.ok) {
            const w = `HTTP ${csvResp.status}`;
            usaSourcesPerFile.push({ name: label, rowCount: 0, cols: 0, warning: w });
            indSourcesPerFile.push({ name: label, rowCount: 0, cols: 0, warning: w });
            continue;
          }
          const csvText = await csvResp.text();
          const wb = XLSX.read(csvText, { type: 'string' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
          const cols = raw.length > 0 ? Object.keys(raw[0]).length : 0;
          let usaThisFile = 0, indThisFile = 0, unknownThisFile = 0;
          for (const r of raw) {
            const parsed = parseUSARow(r as Record<string, unknown>);
            if (!parsed || !parsed.symbol) continue;
            const ex = String((parsed as any).exchange || '').toUpperCase().trim();
            if (USA_EXCHANGES.has(ex)) { usaNewRows.push(parsed); usaThisFile++; }
            else if (IND_EXCHANGES.has(ex)) { indNewRows.push(parsed); indThisFile++; }
            else {
              // Unknown-exchange row goes into the CURRENT tab's bucket
              if (MK === 'usa') { usaNewRows.push(parsed); usaThisFile++; }
              else { indNewRows.push(parsed); indThisFile++; }
              unknownThisFile++;
            }
          }
          const warning = cols < 60 ? `⚠️ Thin CSV (${cols} cols)` : undefined;
          usaSourcesPerFile.push({ name: label, rowCount: usaThisFile, cols, warning });
          indSourcesPerFile.push({ name: label, rowCount: indThisFile, cols, warning });
        } catch (e) {
          const label = `📡 ${f.displayName || f.name}`;
          const w = `Error: ${e instanceof Error ? e.message : String(e)}`;
          usaSourcesPerFile.push({ name: label, rowCount: 0, cols: 0, warning: w });
          indSourcesPerFile.push({ name: label, rowCount: 0, cols: 0, warning: w });
        }
      }

      const otherMk = MK === 'usa' ? 'ind' : 'usa';
      const otherRowsKey = `mb_tech_rows_${otherMk}_v1`;
      const otherSourcesKey = `mb_tech_sources_${otherMk}_v1`;
      let otherExistingRows: any[] = [];
      let otherExistingSources: TechSource[] = [];
      try { otherExistingRows = JSON.parse(localStorage.getItem(otherRowsKey) || '[]'); } catch {}
      try { otherExistingSources = JSON.parse(localStorage.getItem(otherSourcesKey) || '[]'); } catch {}

      const mergeBucket = (existing: any[], newOnes: any[]) => {
        const base = techAppendMode ? [...existing] : [];
        const seen = new Set(base.map((r: any) => r.symbol));
        let added = 0, dup = 0;
        for (const r of newOnes) {
          if (seen.has(r.symbol)) { dup++; continue; }
          seen.add(r.symbol); base.push(r); added++;
        }
        return { rows: base, added, dup };
      };

      const currentBucket = MK === 'usa' ? usaNewRows : indNewRows;
      const currentPerFileSources = MK === 'usa' ? usaSourcesPerFile : indSourcesPerFile;
      const otherBucket = MK === 'usa' ? indNewRows : usaNewRows;
      const otherPerFileSources = MK === 'usa' ? indSourcesPerFile : usaSourcesPerFile;

      // zzz159 — Dedup source chips by name (last-write-wins) so repeat pulls
      // don't accumulate. Previously in append mode we blindly pushed 6 chips
      // per pull, growing to 52+ chips after ~9 pulls.
      const dedupSources = (existing: TechSource[], incoming: TechSource[]) => {
        const incomingNames = new Set(incoming.map(s => s.name));
        const kept = existing.filter(s => !incomingNames.has(s.name));
        return [...kept, ...incoming];
      };

      // Write CURRENT tab
      const currentMerge = mergeBucket(techLocalRows, currentBucket);
      const baseSources = dedupSources(techAppendMode ? techSources : [], currentPerFileSources);
      setTechLocalRows(currentMerge.rows);
      setTechSources(baseSources);
      try { localStorage.setItem(TECH_ROWS_KEY, JSON.stringify(currentMerge.rows)); } catch {}
      try { localStorage.setItem(TECH_SOURCES_KEY, JSON.stringify(baseSources)); } catch {}

      // Write OTHER tab (always — even if 0 rows — so the source chips reflect
      // the sync attempt and empty tab is transparent about what happened)
      const otherMerge = mergeBucket(otherExistingRows, otherBucket);
      const otherAdded = otherMerge.added;
      const otherSourcesNew = dedupSources(techAppendMode ? otherExistingSources : [], otherPerFileSources);
      try { localStorage.setItem(otherRowsKey, JSON.stringify(otherMerge.rows)); } catch {}
      try { localStorage.setItem(otherSourcesKey, JSON.stringify(otherSourcesNew)); } catch {}

      // Broadcast so a mounted OTHER-tab component reloads from localStorage
      // zzz157 — no cross-tab dispatch needed; unmount/remount handles rehydration

      // zzz156 — Track last-pulled manifest timestamp so we don't re-pull the same data
      try { if (manifest.lastSync) localStorage.setItem('mb_tech_last_pulled_sync_v1', manifest.lastSync); } catch {}

      const lastSync = manifest.lastSync ? new Date(manifest.lastSync).toLocaleString() : '?';
      const meLabel = MK === 'usa' ? 'USA' : 'India';
      const otherLabel = MK === 'usa' ? 'India' : 'USA';
      const parts: string[] = [`✓ ${files.length} file${files.length>1?'s':''} from server (synced ${lastSync})`];
      parts.push(`→ ${meLabel} ${currentMerge.added} new`);
      if (otherAdded > 0) parts.push(`→ ${otherLabel} ${otherAdded} new`);
      if (currentMerge.dup > 0) parts.push(`${currentMerge.dup} dedup`);
      parts.push(`· total ${currentMerge.rows.length} on this tab`);
      setTechUploadMsg(parts.join(' '));
      bumpData();
    } catch (e) {
      setTechUploadMsg(`⚠️ Server pull failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // zzz172 — guaranteed unlock even on unexpected throws.
      // Clear ALL in-flight entries for this market so subsequent pulls proceed.
      Array.from(_techPullInFlight.current).forEach(k => {
        if (k.startsWith(`${MK}-`)) _techPullInFlight.current.delete(k);
      });
      setTechLoading(false);
    }
  };

  // zzz156 — Auto-pull on tab mount when the server has newer data than what we
  // last pulled. Silent (no toast on skip), fully hands-free. Runs once per
  // mount per market — subsequent tab switches don't re-pull unless server has
  // a newer manifest timestamp.
  // zzz172 — Module-level in-flight guard so rapid USA <-> IND tab switches
  // don't race two concurrent pulls on the same manifest. Keyed by lastSync.
  const autoPullRanRef = React.useRef(false);
  React.useEffect(() => {
    if (autoPullRanRef.current) return;
    autoPullRanRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/data/tradingview/manifest.json', { cache: 'no-store' });
        if (!resp.ok) return;
        const manifest = await resp.json();
        if (cancelled) return;
        const serverSync: string | undefined = manifest?.lastSync;
        if (!serverSync) return;
        let lastPulled: string | null = null;
        try { lastPulled = localStorage.getItem('mb_tech_last_pulled_sync_v1'); } catch {}
        const localEmpty = techLocalRows.length === 0;
        const isNewer = !lastPulled || new Date(serverSync).getTime() > new Date(lastPulled).getTime();
        // Auto-pull when: server has fresher data OR current tab is empty
        if (isNewer || localEmpty) {
          handlePullFromServer();
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
    // Only run once per component mount. Intentionally omit dependencies —
    // we don't want to re-run when techLocalRows changes (that's the pull itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // zzz149 — Per-market data. No fallback to other caches.
  const usaRows = React.useMemo<any[]>(() => techLocalRows, [dataTick, techLocalRows]);

  type TechRow = {
    symbol: string; company?: string; sector?: string;
    exchange?: string;  // zzz161 — carried through from parseUSARow for TradingView export prefix
    industry?: string;            // zzz140 — granular sub-industry
    industryRsRank?: number;      // 1-100, derived from industry-median perf
    compositeRs?: number;         // 0-100, derived from perf percentile vs universe
    price?: number; mcapB?: number;
    ema50?: number; ema200?: number; rsi?: number;
    ema21?: number;              // zzz138 — Qullamaggie's actual entry rule
    ema89?: number;              // multi-pivot — deeper trend pullback pivot
    ema100?: number;             // multi-pivot — real 100-MA if the column is present
    mediumMaLabel?: string;      // multi-pivot — resolved medium-MA label (89-EMA / 100-DMA / ~100-DMA)
    pctVsMedium?: number;        // multi-pivot — % distance to the resolved medium MA
    pctVsEma21?: number;
    perf1y?: number; perf3m?: number; perf6m?: number;
    high52w?: number; beta?: number; avgVol30d?: number;
    // zzz130 — New technical fields
    perf1w?: number; perf1m?: number;
    atr14?: number;
    sma50?: number; sma150?: number; sma200?: number;
    vol1m?: number; vol1w?: number;
    low52w?: number;
    relVol1w?: number; vol1d?: number;
    // Derived
    pctVsEma50?: number;
    pctVsEma89?: number;
    pctVsEma200?: number;
    pctVsSma50?: number;
    pctVsSma150?: number;
    pctVsSma200?: number;
    emaSpread?: number;          // (EMA50 / EMA200 − 1) * 100
    distFromHigh?: number;       // % below 52w high (always negative or 0)
    pctAboveLow52w?: number;     // % above 52w low (always >=0)
    adrPct?: number;             // ATR / price * 100 (Qullamaggie sweet-spot 3-6%)
    volContraction?: boolean;    // 1w vol < 1m vol (VCP signal)
    volumeBurst?: boolean;       // relative volume >= 1.5x
    momentumAccel?: number;      // (3M annualized > 6M annualized > 1Y) score 0-3
    // Playbook scores 0-100
    qullaScore: number; qullaReasons: string[];
    zangerScore: number; zangerReasons: string[];
    bondeScore: number; bondeReasons: string[];
    minerviniScore: number; minerviniReasons: string[];
    rightEntry: 'BUY ZONE' | 'EXTENDED' | 'CHASE' | 'BELOW' | 'NO DATA';
    rightEntryDetail: string;
    stopLoss?: number;           // price - 2 * ATR
    stopLossPct?: number;        // (price - stopLoss) / price * 100
    qualityFlags?: string[];     // zzz132 — data-quality warnings
    // zzz133 — FUNDAMENTAL growth fields (already parsed at USA pipeline)
    revGrowthQtr?: number;       // Revenue growth %, Quarterly YoY
    revGrowthAnn?: number;       // Revenue growth %, Annual YoY
    revGrowth5Y?: number;        // Revenue growth %, 5 year CAGR
    epsGrowthTTM?: number;       // EPS diluted growth %, TTM YoY
    epsGrowthQtr?: number;       // EPS diluted growth %, Quarterly YoY
    grossProfitGrowthQtr?: number; // Gross profit growth %, Quarterly YoY
    grossMargin?: number;
    netMargin?: number;
    opMargin?: number;
    fcfMargin?: number;
    roe?: number;
    roic?: number;
    debtEquity?: number;
    netDebtEbitda?: number;
    interestCoverage?: number;
    piotroski?: number;
    analystRating?: number;
    nextEarnings?: string;       // Upcoming earnings date (ISO YYYY-MM-DD)
    daysToEarnings?: number;     // Days until next earnings (negative if past)
    freeFloatPct?: number;       // Free float %
    dollarVolume?: number;       // price × avg vol 30d
    fundScore: number;           // 0-100 fundamental quality
    fundReasons: string[];
    sepaScore: number;           // Minervini SEPA-style fundamental quality 0-100
    sepaReasons: string[];
    growthConfirmed: boolean;    // EPS Q >= 25% AND Rev Q >= 15%
    marginExpanding: boolean;    // Gross profit growth Q > Revenue growth Q
    // zzz133 — ELIGIBILITY ENGINE
    eligible: boolean;
    eligibilityFailures: string[];
    eligibilityTags: string[];
    totalScore: number;
  };

  const techRows: TechRow[] = React.useMemo(() => {
    const rows: TechRow[] = (usaRows || []).map((r: any) => {
      const price = num(r.price);
      const mcap = num(r.marketCapB);
      const ema50 = num(r.ema50);
      const ema200 = num(r.ema200);
      const ema21 = num(r.ema21);  // zzz138 — Qullamaggie's exact entry rule
      const ema89 = num(r.ema89);  // multi-pivot — deeper trend pullback pivot (real, if column present)
      const ema100 = num(r.ema100);  // multi-pivot — real 100-period MA if the column is present
      const rsi = num(r.rsi);
      const perf1y = num(r.perf1y);
      const perf3m = num(r.perf3m);
      const perf6m = num(r.perf6m);
      const high52w = num(r.high52w);
      const beta = num(r.beta);
      const avgVol30d = num(r.avgVol30d ?? r.avgVolume30d);
      // zzz130 — New fields (may be undefined if user uploaded older CSV)
      const perf1w = num(r.perf1w);
      const perf1m = num(r.perf1m);
      const atr14 = num(r.atr14);
      const sma50 = num(r.sma50);
      const sma150 = num(r.sma150);
      const sma200 = num(r.sma200);
      const vol1m = num(r.vol1m);
      const vol1w = num(r.vol1w);
      const low52w = num(r.low52w);
      const relVol1w = num(r.relVol1w);
      const vol1d = num(r.vol1d);

      // Derived
      const pctVsEma50 = (price !== undefined && ema50 !== undefined && ema50 > 0)
        ? Math.round((price - ema50) / ema50 * 1000) / 10 : undefined;
      // zzz138 — % distance to 21-EMA (Qullamaggie's actual rule, not SMA50/EMA50 proxy)
      const pctVsEma21 = (price !== undefined && ema21 !== undefined && ema21 > 0)
        ? Math.round((price - ema21) / ema21 * 1000) / 10 : undefined;
      const pctVsEma89 = (price !== undefined && ema89 !== undefined && ema89 > 0)
        ? Math.round((price - ema89) / ema89 * 1000) / 10 : undefined;
      // MEDIUM-TERM PIVOT — prefer the real 89-EMA (Qullamaggie's), else a real 100-MA,
      // else derive a ~100-period line from EMA50/EMA200 so the pivot ALWAYS works even
      // when the export lacks an 89/100 column. Blend weight: 100 sits 1/3 of the way
      // from EMA50 to EMA200 in period-space → EMA100 ≈ EMA50·2/3 + EMA200·1/3.
      let mediumMa: number | undefined;
      let mediumMaLabel: string | undefined;
      if (ema89 !== undefined && ema89 > 0) { mediumMa = ema89; mediumMaLabel = '89-EMA'; }
      else if (ema100 !== undefined && ema100 > 0) { mediumMa = ema100; mediumMaLabel = '100-DMA'; }
      else if (ema50 !== undefined && ema200 !== undefined && ema50 > 0 && ema200 > 0) { mediumMa = ema50 * 2 / 3 + ema200 / 3; mediumMaLabel = '~100-DMA'; }
      else if (sma50 !== undefined && sma200 !== undefined && sma50 > 0 && sma200 > 0) { mediumMa = sma50 * 2 / 3 + sma200 / 3; mediumMaLabel = '~100-DMA'; }
      const pctVsMedium = (price !== undefined && mediumMa !== undefined && mediumMa > 0)
        ? Math.round((price - mediumMa) / mediumMa * 1000) / 10 : undefined;
      const pctVsEma200 = (price !== undefined && ema200 !== undefined && ema200 > 0)
        ? Math.round((price - ema200) / ema200 * 1000) / 10 : undefined;
      const pctVsSma50 = (price !== undefined && sma50 !== undefined && sma50 > 0)
        ? Math.round((price - sma50) / sma50 * 1000) / 10 : undefined;
      const pctVsSma150 = (price !== undefined && sma150 !== undefined && sma150 > 0)
        ? Math.round((price - sma150) / sma150 * 1000) / 10 : undefined;
      const pctVsSma200 = (price !== undefined && sma200 !== undefined && sma200 > 0)
        ? Math.round((price - sma200) / sma200 * 1000) / 10 : undefined;
      const emaSpread = (ema50 !== undefined && ema200 !== undefined && ema200 > 0)
        ? Math.round((ema50 - ema200) / ema200 * 1000) / 10 : undefined;
      const distFromHigh = (price !== undefined && high52w !== undefined && high52w > 0)
        ? Math.round((price - high52w) / high52w * 1000) / 10 : undefined;
      const pctAboveLow52w = (price !== undefined && low52w !== undefined && low52w > 0)
        ? Math.round((price - low52w) / low52w * 1000) / 10 : undefined;
      const adrPct = (atr14 !== undefined && price !== undefined && price > 0)
        ? Math.round(atr14 / price * 1000) / 10 : undefined;
      const volContraction = (typeof vol1w === 'number' && typeof vol1m === 'number') ? vol1w < vol1m * 0.85 : undefined;
      const volumeBurst = (typeof relVol1w === 'number') ? relVol1w >= 1.5 : undefined;
      const stopLoss = (typeof price === 'number' && typeof atr14 === 'number') ? Math.round((price - 2 * atr14) * 100) / 100 : undefined;
      const stopLossPct = (typeof price === 'number' && typeof stopLoss === 'number' && price > 0) ? Math.round((price - stopLoss) / price * 1000) / 10 : undefined;

      // Momentum acceleration: 3M annualized > 6M annualized > 1Y
      let momentumAccel = 0;
      if (typeof perf3m === 'number' && typeof perf6m === 'number' && typeof perf1y === 'number') {
        const ann3m = perf3m * 4;
        const ann6m = perf6m * 2;
        if (ann3m > ann6m) momentumAccel++;
        if (ann6m > perf1y) momentumAccel++;
        if (perf3m > 0 && perf6m > 0 && perf1y > 0) momentumAccel++;
      }

      // zzz132 — DATA QUALITY warnings (parabolic / data anomaly detection)
      const qualityFlags: string[] = [];
      // zzz145 — RSI 85+ now flagged near-parabolic (was 88) so HNGE-style names trigger warning
      if (typeof rsi === 'number' && rsi >= 85) qualityFlags.push('RSI near-parabolic (' + rsi.toFixed(0) + ')');
      if (typeof pctVsEma50 === 'number' && pctVsEma50 >= 60) qualityFlags.push('extreme extension');
      if (typeof mcap === 'number' && mcap < 0.3) qualityFlags.push('micro-cap illiquid');
      if (typeof avgVol30d === 'number' && avgVol30d < 200_000) qualityFlags.push('thin volume');

      // zzz133 — FUNDAMENTAL FIELDS (parsed at USA pipeline, surfaced here)
      const revGrowthQtr = num(r.revQtr ?? r.revGrowthQtr ?? r.revenueGrowthQtr);
      const revGrowthAnn = num(r.revAnn ?? r.revGrowth ?? r.revenueGrowth);
      const revGrowth5Y = num(r.revGrowth5y ?? r.revGrowth3yr ?? r.revCagr);
      const epsGrowthTTM = num(r.epsGrowth ?? r.epsGrowthTTM);
      const epsGrowthQtr = num(r.epsGrowthQtr);
      const grossProfitGrowthQtr = num(r.grossProfitGrowthQtr);
      const grossMargin = num(r.grossMargin);
      const netMargin = num(r.netMargin);
      const opMargin = num(r.opMargin ?? r.operatingMargin);
      const fcfMargin = num(r.fcfMargin);
      const roe = num(r.roe);
      const roic = num(r.roic);
      const debtEquity = num(r.de ?? r.debtEquity);
      const netDebtEbitda = num(r.netDebtEbitda);
      const interestCoverage = num(r.interestCoverage);
      const piotroski = num(r.piotroski ?? r.fScore);
      const analystRating = num(r.analystRating ?? r.rating);
      const freeFloatPct = num(r.freeFloatPct);
      const nextEarningsRaw = r.nextEarnings ?? r.upcomingEarnings;
      const nextEarnings: string | undefined = (typeof nextEarningsRaw === 'string' && nextEarningsRaw.length > 0) ? nextEarningsRaw : undefined;
      // Compute days to earnings
      let daysToEarnings: number | undefined = undefined;
      if (nextEarnings) {
        try {
          const earnDate = new Date(nextEarnings);
          if (!isNaN(earnDate.getTime())) {
            daysToEarnings = Math.round((earnDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          }
        } catch {}
      }

      const dollarVolume = (typeof price === 'number' && typeof avgVol30d === 'number') ? price * avgVol30d : undefined;

      // Derived growth flags
      const growthConfirmed = (typeof epsGrowthQtr === 'number' && epsGrowthQtr >= 25 && typeof revGrowthQtr === 'number' && revGrowthQtr >= 15);
      const marginExpanding = (typeof grossProfitGrowthQtr === 'number' && typeof revGrowthQtr === 'number' && grossProfitGrowthQtr > revGrowthQtr);

      // zzz133 — ELIGIBILITY RULE ENGINE (hard filters before any bullish bucket)
      // A stock must pass eligibility to appear in CHAMPIONS / READY TO BUY / BUY ZONE.
      // Tracks failures with reasons so user can see WHY a name is rejected.
      const eligibilityFailures: string[] = [];
      const eligibilityTags: string[] = [];
      // Liquidity gate
      if (typeof avgVol30d === 'number' && avgVol30d < 200_000) eligibilityFailures.push(`illiquid (avg vol ${(avgVol30d/1000).toFixed(0)}k < 200k)`);
      if (typeof dollarVolume === 'number' && dollarVolume < 5_000_000) eligibilityFailures.push(`low $-vol ($${(dollarVolume/1_000_000).toFixed(1)}M < $5M)`);
      // Trend gate — must be above SMA50 (no falling knives)
      const pctMA50Chk = typeof pctVsSma50 === 'number' ? pctVsSma50 : pctVsEma50;
      if (typeof pctMA50Chk === 'number' && pctMA50Chk < -3) eligibilityFailures.push(`below SMA50 (${pctMA50Chk.toFixed(1)}%)`);
      // ADDITIVE (audit R2) — Minervini Trend-Template stage-2 gate. A momentum
      // leader must trade ABOVE its 200-DMA, with the 150-DMA above the 200-DMA
      // (i.e. the long-term trend is up). Only enforced when the MA data exists,
      // so thin CSVs aren't over-filtered. This is the single most important
      // filter O'Neil/Minervini/Weinstein all agree on.
      if (typeof price === 'number' && typeof sma200 === 'number' && sma200 > 0 && price < sma200)
        eligibilityFailures.push(`below 200-DMA (stage-2 fail)`);
      if (typeof sma150 === 'number' && typeof sma200 === 'number' && sma150 > 0 && sma200 > 0 && sma150 < sma200)
        eligibilityFailures.push(`150-DMA below 200-DMA (downtrend)`);
      // Minervini: price must be at least 30% above the 52-week low.
      if (typeof pctAboveLow52w === 'number' && pctAboveLow52w < 30)
        eligibilityFailures.push(`only +${pctAboveLow52w.toFixed(0)}% off 52W low (<30%)`);
      // Data sufficiency
      if (typeof perf1m !== 'number' && typeof perf3m !== 'number') eligibilityFailures.push('no momentum data');
      // Parabolic exclusion
      if (typeof rsi === 'number' && rsi >= 90) eligibilityFailures.push(`parabolic RSI ${rsi.toFixed(0)}`);
      // Extreme extension
      if (typeof pctMA50Chk === 'number' && pctMA50Chk > 80) eligibilityFailures.push(`extreme extension +${pctMA50Chk.toFixed(0)}%`);
      // Earnings event window
      if (typeof daysToEarnings === 'number' && daysToEarnings >= 0 && daysToEarnings <= 3) {
        eligibilityFailures.push(`earnings in ${daysToEarnings}d (event risk)`);
        eligibilityTags.push('EARNINGS_IMMINENT');
      } else if (typeof daysToEarnings === 'number' && daysToEarnings > 3 && daysToEarnings <= 14) {
        eligibilityTags.push('EARNINGS_SOON');
      }
      const eligible = eligibilityFailures.length === 0;

      // zzz133 — FUNDAMENTAL SCORE 0-100 (Minervini SEPA-style fundamental quality)
      let fundScore = 0;
      const fundReasons: string[] = [];
      // 1. Rule of 40 (revenue growth + FCF margin)
      const r40 = (typeof revGrowthAnn === 'number' && typeof fcfMargin === 'number') ? revGrowthAnn + fcfMargin : undefined;
      if (typeof r40 === 'number') {
        if (r40 >= 60) { fundScore += 18; fundReasons.push(`R40 ${r40.toFixed(0)} ELITE`); }
        else if (r40 >= 40) { fundScore += 12; fundReasons.push(`R40 ${r40.toFixed(0)} pass`); }
        else if (r40 >= 20) { fundScore += 5; fundReasons.push(`R40 ${r40.toFixed(0)}`); }
        else if (r40 < 0) { fundScore -= 4; fundReasons.push(`R40 ${r40.toFixed(0)} burn`); }
      }
      // zzz135 — REV growth weighted HEAVIER than EPS (revenue harder to manipulate;
      // EPS can be juiced via buybacks, write-offs, tax tricks, accounting choices).
      // 2. Revenue growth Q YoY — primary fundamental signal (BOOSTED)
      if (typeof revGrowthQtr === 'number') {
        if (revGrowthQtr >= 40) { fundScore += 20; fundReasons.push(`Rev Q +${revGrowthQtr.toFixed(0)}% 🔥🔥`); }
        else if (revGrowthQtr >= 25) { fundScore += 15; fundReasons.push(`Rev Q +${revGrowthQtr.toFixed(0)}% 🔥`); }
        else if (revGrowthQtr >= 15) { fundScore += 10; fundReasons.push(`Rev Q +${revGrowthQtr.toFixed(0)}%`); }
        else if (revGrowthQtr >= 5) { fundScore += 4; fundReasons.push(`Rev Q +${revGrowthQtr.toFixed(0)}%`); }
        else if (revGrowthQtr < 0) { fundScore -= 6; fundReasons.push(`Rev Q ${revGrowthQtr.toFixed(0)}% decline`); }
      }
      // 3. EPS growth TTM YoY — secondary (lower weight than rev per user request)
      if (typeof epsGrowthTTM === 'number') {
        if (epsGrowthTTM >= 50) { fundScore += 10; fundReasons.push(`EPS TTM +${epsGrowthTTM.toFixed(0)}%`); }
        else if (epsGrowthTTM >= 25) { fundScore += 7; fundReasons.push(`EPS TTM +${epsGrowthTTM.toFixed(0)}%`); }
        else if (epsGrowthTTM >= 10) { fundScore += 3; fundReasons.push(`EPS TTM +${epsGrowthTTM.toFixed(0)}%`); }
        else if (epsGrowthTTM < -10) { fundScore -= 4; fundReasons.push(`EPS TTM ${epsGrowthTTM.toFixed(0)}% decline`); }
      }
      // 4. EPS Q YoY (acceleration)
      if (typeof epsGrowthQtr === 'number' && typeof epsGrowthTTM === 'number' && epsGrowthQtr > epsGrowthTTM && epsGrowthQtr >= 30) {
        fundScore += 8; fundReasons.push(`EPS accelerating (Q ${epsGrowthQtr.toFixed(0)}% > TTM ${epsGrowthTTM.toFixed(0)}%)`);
      } else if (typeof epsGrowthQtr === 'number' && epsGrowthQtr >= 25) {
        fundScore += 4; fundReasons.push(`EPS Q +${epsGrowthQtr.toFixed(0)}%`);
      }
      // 5. Margin expansion (gross profit Q > rev Q)
      if (marginExpanding) { fundScore += 8; fundReasons.push('margin expanding'); }
      // 6. 5Y revenue CAGR (durable compounding)
      if (typeof revGrowth5Y === 'number') {
        if (revGrowth5Y >= 25) { fundScore += 8; fundReasons.push(`5Y CAGR ${revGrowth5Y.toFixed(0)}%`); }
        else if (revGrowth5Y >= 15) { fundScore += 5; fundReasons.push(`5Y CAGR ${revGrowth5Y.toFixed(0)}%`); }
        else if (revGrowth5Y < 0) { fundScore -= 4; }
      }
      // 7. Profitability
      if (typeof roe === 'number') {
        if (roe >= 25) { fundScore += 10; fundReasons.push(`ROE ${roe.toFixed(0)}%`); }
        else if (roe >= 15) { fundScore += 6; fundReasons.push(`ROE ${roe.toFixed(0)}%`); }
        else if (roe >= 8) { fundScore += 2; }
      }
      // 8. FCF margin
      if (typeof fcfMargin === 'number') {
        if (fcfMargin >= 20) { fundScore += 8; fundReasons.push(`FCF ${fcfMargin.toFixed(0)}%`); }
        else if (fcfMargin >= 10) { fundScore += 4; fundReasons.push(`FCF ${fcfMargin.toFixed(0)}%`); }
        else if (fcfMargin < -10) { fundScore -= 6; fundReasons.push(`FCF ${fcfMargin.toFixed(0)}% burn`); }
      }
      // 9. Leverage
      if (typeof netDebtEbitda === 'number') {
        if (netDebtEbitda < 0) { fundScore += 6; fundReasons.push('net cash'); }
        else if (netDebtEbitda < 1) { fundScore += 4; fundReasons.push(`NDE ${netDebtEbitda.toFixed(1)}×`); }
        else if (netDebtEbitda > 4) { fundScore -= 6; fundReasons.push(`NDE ${netDebtEbitda.toFixed(1)}× leveraged`); }
      } else if (typeof debtEquity === 'number') {
        if (debtEquity < 0.3) fundScore += 3;
        else if (debtEquity > 2) { fundScore -= 4; fundReasons.push(`D/E ${debtEquity.toFixed(1)} leveraged`); }
      }
      // 10. Analyst rating
      if (typeof analystRating === 'number') {
        if (analystRating >= 4.5) { fundScore += 5; fundReasons.push('Analyst Strong Buy'); }
        else if (analystRating >= 4) { fundScore += 3; }
        else if (analystRating < 3) { fundScore -= 4; fundReasons.push(`Analyst rating ${analystRating.toFixed(1)} weak`); }
      }
      // Piotroski F-Score (financial health proxy)
      if (typeof piotroski === 'number') {
        if (piotroski >= 8) { fundScore += 5; fundReasons.push(`Piotroski ${piotroski.toFixed(0)}/9`); }
        else if (piotroski <= 3) { fundScore -= 4; fundReasons.push(`Piotroski ${piotroski.toFixed(0)}/9 weak`); }
      }
      // zzz135 — Free Float % impacts setup quality and risk
      // Low float (<30%): squeeze fuel for Qulla, but also higher volatility / manipulation risk
      // Very low float (<15%): caution flag — illiquid, gappy
      // 50-80%: institutional-friendly sweet spot
      if (typeof freeFloatPct === 'number') {
        if (freeFloatPct < 15) { fundScore -= 5; fundReasons.push(`⚠️ float ${freeFloatPct.toFixed(0)}% (low, volatile)`); }
        else if (freeFloatPct >= 15 && freeFloatPct < 30) { fundScore += 3; fundReasons.push(`float ${freeFloatPct.toFixed(0)}% (squeeze fuel)`); }
        else if (freeFloatPct >= 50 && freeFloatPct <= 90) { fundScore += 4; fundReasons.push(`float ${freeFloatPct.toFixed(0)}% (institutional)`); }
        else if (freeFloatPct > 90) { fundScore += 2; }
      }
      fundScore = Math.max(0, Math.min(100, fundScore));

      // SEPA score (same as fundScore for now; alias for Minervini terminology)
      const sepaScore = fundScore;
      const sepaReasons = fundReasons.slice();

      // zzz132 — QULLAMAGGIE rewritten with finer gradations (was clustering 80-85)
      // Now spreads scores from 20 to 100 based on actual setup strength
      let qullaScore = 0; const qReasons: string[] = [];
      // PRIMARY: 1M momentum (Qullamaggie's #1 filter — biggest 1M gainers)
      if (typeof perf1m === 'number' && perf1m >= 50) { qullaScore += 35; qReasons.push(`💥 1M +${perf1m.toFixed(0)}%`); }
      else if (typeof perf1m === 'number' && perf1m >= 30) { qullaScore += 28; qReasons.push(`🔥 1M +${perf1m.toFixed(0)}%`); }
      else if (typeof perf1m === 'number' && perf1m >= 15) { qullaScore += 18; qReasons.push(`1M +${perf1m.toFixed(0)}%`); }
      else if (typeof perf1m === 'number' && perf1m >= 5) { qullaScore += 8; qReasons.push(`1M +${perf1m.toFixed(0)}%`); }
      else if (typeof perf3m === 'number' && perf3m >= 30) { qullaScore += 15; qReasons.push(`3M +${perf3m.toFixed(0)}% (1M weak)`); }
      else if (typeof perf3m === 'number' && perf3m >= 15) { qullaScore += 6; qReasons.push(`3M +${perf3m.toFixed(0)}%`); }
      // ADR sweet spot — Qullamaggie's exact 4-8% rule (graded)
      if (typeof adrPct === 'number' && adrPct >= 4 && adrPct <= 7) { qullaScore += 20; qReasons.push(`ADR ${adrPct.toFixed(1)}% (perfect)`); }
      else if (typeof adrPct === 'number' && adrPct >= 3 && adrPct < 4) { qullaScore += 14; qReasons.push(`ADR ${adrPct.toFixed(1)}%`); }
      else if (typeof adrPct === 'number' && adrPct > 7 && adrPct <= 9) { qullaScore += 10; qReasons.push(`ADR ${adrPct.toFixed(1)}% (high)`); }
      else if (typeof adrPct === 'number' && adrPct >= 2 && adrPct < 3) { qullaScore += 6; qReasons.push(`ADR ${adrPct.toFixed(1)}% (low vol)`); }
      // zzz138 — Extension rule: prefer EMA21 (Qullamaggie's actual signal), fallback SMA50/EMA50.
      // Qulla's exact rule: buy within 0-5% of 21-EMA on a tight pullback after a strong move.
      // TIGHTER thresholds when EMA21 data available (Qulla rule is unforgiving).
      const qPctMA = typeof pctVsEma21 === 'number' ? pctVsEma21
        : typeof pctVsSma50 === 'number' ? pctVsSma50
        : pctVsEma50;
      const qMALabel = typeof pctVsEma21 === 'number' ? '21-EMA ✓'
        : typeof pctVsSma50 === 'number' ? 'SMA50 (proxy)'
        : 'EMA50 (proxy)';
      const usingEma21 = typeof pctVsEma21 === 'number';
      // zzz144 — EMA21 TEXTBOOK requires real momentum context (1M ≥ 5% OR 3M ≥ 25%)
      // to avoid mislabeling LSCC (1M -2%) and AMBQ (1M +1%) as Qulla setups just because
      // they sit near 21-EMA. Kullamäki's actual setup: a stock that's HAD a move, now
      // pulled back tight to 21-EMA. No prior move → not a Qulla setup.
      const hasQullaMomentum = (typeof perf1m === 'number' && perf1m >= 5) || (typeof perf3m === 'number' && perf3m >= 25);
      if (typeof qPctMA === 'number') {
        if (usingEma21) {
          // Tighter Qulla-rule thresholds when we have the real signal
          if (qPctMA >= 0 && qPctMA <= 5 && hasQullaMomentum) { qullaScore += 25; qReasons.push(`🎯 +${qPctMA.toFixed(1)}% ${qMALabel} (TEXTBOOK Qulla entry)`); }
          else if (qPctMA >= 0 && qPctMA <= 5) { qullaScore += 10; qReasons.push(`+${qPctMA.toFixed(1)}% ${qMALabel} (near MA but no momentum)`); }
          else if (qPctMA > 5 && qPctMA <= 10) { qullaScore += 15; qReasons.push(`+${qPctMA.toFixed(1)}% ${qMALabel}`); }
          else if (qPctMA > 10 && qPctMA <= 18) { qullaScore += 6; qReasons.push(`+${qPctMA.toFixed(0)}% ${qMALabel} (stretched)`); }
          else if (qPctMA > 18 && qPctMA <= 30) { qullaScore += 0; qReasons.push(`extended +${qPctMA.toFixed(0)}% off ${qMALabel}`); }
          else if (qPctMA > 30) { qullaScore -= 8; qReasons.push(`⚠️ chase risk +${qPctMA.toFixed(0)}% off ${qMALabel}`); }
          else if (qPctMA < 0) { qullaScore -= 5; qReasons.push(`below ${qMALabel} (${qPctMA.toFixed(1)}%)`); }
        } else {
          // Looser thresholds for SMA50/EMA50 proxy (50-period MA lags 21-EMA)
          if (qPctMA >= 0 && qPctMA <= 8) { qullaScore += 20; qReasons.push(`+${qPctMA.toFixed(0)}% ${qMALabel} (entry zone)`); }
          else if (qPctMA > 8 && qPctMA <= 15) { qullaScore += 12; qReasons.push(`+${qPctMA.toFixed(0)}% ${qMALabel}`); }
          else if (qPctMA > 15 && qPctMA <= 25) { qullaScore += 5; qReasons.push(`extended +${qPctMA.toFixed(0)}%`); }
          else if (qPctMA > 40) { qullaScore -= 5; qReasons.push(`⚠️ over-extended +${qPctMA.toFixed(0)}%`); }
        }
      }
      // Volume burst confirmation (graded by intensity)
      if (typeof relVol1w === 'number' && relVol1w >= 3) { qullaScore += 12; qReasons.push(`Rel Vol ${relVol1w.toFixed(1)}× 🔥🔥`); }
      else if (typeof relVol1w === 'number' && relVol1w >= 2) { qullaScore += 9; qReasons.push(`Rel Vol ${relVol1w.toFixed(1)}× 🔥`); }
      else if (typeof relVol1w === 'number' && relVol1w >= 1.5) { qullaScore += 6; qReasons.push(`Rel Vol ${relVol1w.toFixed(1)}×`); }
      // zzz144 — VOLUME DRY-UP bonus (Qulla's signature flag pattern)
      // After a strong 3M move, low rel-vol = consolidation tight flag = Qulla setup.
      // Specifically: relVol1w < 0.7 AND (3M ≥ 25% OR 6M ≥ 50%) AND position near MA.
      const hadPriorRun = (typeof perf3m === 'number' && perf3m >= 25) || (typeof perf6m === 'number' && perf6m >= 50);
      // zzz145 — tightened from 15 → 10: MTRN at +15% off EMA21 should NOT get tight-flag bonus
      const nearMA = typeof qPctMA === 'number' && qPctMA >= -3 && qPctMA <= 10;
      if (typeof relVol1w === 'number' && relVol1w < 0.7 && hadPriorRun && nearMA) {
        qullaScore += 8; qReasons.push(`📉 Vol dry-up ${relVol1w.toFixed(2)}× after run (tight flag)`);
      }
      // zzz160 — Market-aware small/mid cap preference. TradingView returns mcap in USD
      // across markets, but India's ₹85/USD conversion means a $1B USA mid-cap ≈ ₹8500 Cr
      // in India = a top-100 large cap. Use SEBI-adjusted USD tiers for India.
      if (market === 'IND') {
        // India tiers: sweet spot $150M-$1.5B (₹1300 Cr - ₹12,700 Cr, small-mid)
        if (typeof mcap === 'number' && mcap >= 0.15 && mcap <= 1.5) { qullaScore += 10; qReasons.push(`small-mid ₹${Math.round(mcap * usdInrNow().usdInr * 100).toLocaleString('en-IN')} Cr`); }
        else if (typeof mcap === 'number' && mcap < 0.15 && mcap >= 0.05) { qullaScore += 6; qReasons.push(`micro ₹${(mcap*8500).toFixed(0)}Cr`); }
        else if (typeof mcap === 'number' && mcap > 1.5 && mcap <= 5) { qullaScore += 5; qReasons.push(`mid ₹${Math.round(mcap * usdInrNow().usdInr * 100).toLocaleString('en-IN')} Cr`); }
      } else {
        // USA tiers: sweet spot $1-10B
        if (typeof mcap === 'number' && mcap >= 1 && mcap <= 10) { qullaScore += 10; qReasons.push(`small-mid $${mcap.toFixed(1)}B`); }
        else if (typeof mcap === 'number' && mcap < 1 && mcap >= 0.3) { qullaScore += 6; qReasons.push(`micro $${(mcap*1000).toFixed(0)}M`); }
        else if (typeof mcap === 'number' && mcap > 10 && mcap <= 50) { qullaScore += 5; qReasons.push(`mid $${mcap.toFixed(1)}B`); }
      }
      // Stage-2 confirmation (graded)
      if (typeof pctVsEma200 === 'number' && pctVsEma200 >= 30) { qullaScore += 8; qReasons.push(`strong Stage-2 (+${pctVsEma200.toFixed(0)}%)`); }
      else if (typeof pctVsEma200 === 'number' && pctVsEma200 >= 10) { qullaScore += 5; qReasons.push('Stage-2'); }
      else if (typeof pctVsEma200 === 'number' && pctVsEma200 > 0) { qullaScore += 2; qReasons.push('early Stage-2'); }

      // zzz132 — ZANGER HTF rewritten with proper rally-then-flag detection
      // HTF = 80-200% rally in 4-8 weeks + tight 3-5 week consolidation near highs
      let zangerScore = 0; const zReasons: string[] = [];
      // RALLY component — must have explosive recent move
      if (typeof perf1m === 'number' && perf1m >= 80) { zangerScore += 35; zReasons.push(`💥 1M +${perf1m.toFixed(0)}% (textbook HTF)`); }
      else if (typeof perf1m === 'number' && perf1m >= 50) { zangerScore += 28; zReasons.push(`💥 1M +${perf1m.toFixed(0)}% (HTF launch)`); }
      else if (typeof perf1m === 'number' && perf1m >= 30) { zangerScore += 18; zReasons.push(`1M +${perf1m.toFixed(0)}%`); }
      else if (typeof perf6m === 'number' && perf6m >= 150) { zangerScore += 22; zReasons.push(`6M +${perf6m.toFixed(0)}% (HTF base)`); }
      else if (typeof perf6m === 'number' && perf6m >= 80) { zangerScore += 12; zReasons.push(`6M +${perf6m.toFixed(0)}%`); }
      // FLAG component — tight 1W consolidation AFTER big 1M
      if (typeof perf1w === 'number' && typeof perf1m === 'number' && perf1m >= 30 && perf1w >= -3 && perf1w <= 3) {
        zangerScore += 25; zReasons.push(`📐 1W ${perf1w >= 0 ? '+' : ''}${perf1w.toFixed(1)}% TIGHT FLAG`);
      } else if (typeof perf1w === 'number' && typeof perf1m === 'number' && perf1m >= 20 && perf1w >= -5 && perf1w <= 5) {
        // zzz159 — fix "1W +-2.7%" double-sign glitch when perf1w is negative
        zangerScore += 15; zReasons.push(`1W ${perf1w >= 0 ? '+' : ''}${perf1w.toFixed(1)}% flagging`);
      }
      // PROXIMITY to MA — breakout setup (graded)
      const zPctMA = typeof pctVsSma50 === 'number' ? pctVsSma50 : pctVsEma50;
      if (typeof zPctMA === 'number' && zPctMA >= 0 && zPctMA <= 5) { zangerScore += 15; zReasons.push('breakout-ready'); }
      else if (typeof zPctMA === 'number' && zPctMA > 5 && zPctMA <= 12) { zangerScore += 8; zReasons.push('near base'); }
      // NEAR 52W HIGH — graded
      if (typeof distFromHigh === 'number' && distFromHigh >= -3) { zangerScore += 15; zReasons.push(`at 52W high (${distFromHigh.toFixed(0)}%)`); }
      else if (typeof distFromHigh === 'number' && distFromHigh >= -10) { zangerScore += 10; zReasons.push(`near 52W high (${distFromHigh.toFixed(0)}%)`); }
      else if (typeof distFromHigh === 'number' && distFromHigh >= -15) { zangerScore += 5; zReasons.push(`${distFromHigh.toFixed(0)}% from high`); }
      // VOLUME burst (graded)
      if (typeof relVol1w === 'number' && relVol1w >= 3) { zangerScore += 12; zReasons.push(`vol ${relVol1w.toFixed(1)}×🔥🔥`); }
      else if (typeof relVol1w === 'number' && relVol1w >= 2) { zangerScore += 8; zReasons.push(`vol ${relVol1w.toFixed(1)}×🔥`); }
      else if (typeof relVol1w === 'number' && relVol1w >= 1.5) { zangerScore += 5; zReasons.push(`vol ${relVol1w.toFixed(1)}×`); }
      // RSI sweet spot
      if (typeof rsi === 'number' && rsi >= 55 && rsi <= 70) { zangerScore += 5; zReasons.push(`RSI ${rsi.toFixed(0)}`); }
      else if (typeof rsi === 'number' && rsi > 70 && rsi <= 80) { zangerScore += 2; }

      // zzz132 — BONDE EP rewritten — fix clustering at 85 by grading every component
      let bondeScore = 0; const bReasons: string[] = [];
      // EP TRIGGER — recent 1W move (Bonde's signature signal, graded)
      if (typeof perf1w === 'number' && perf1w >= 25) { bondeScore += 32; bReasons.push(`⚡ 1W +${perf1w.toFixed(0)}% MEGA-EP`); }
      else if (typeof perf1w === 'number' && perf1w >= 15) { bondeScore += 25; bReasons.push(`⚡ 1W +${perf1w.toFixed(0)}% EP fired`); }
      else if (typeof perf1w === 'number' && perf1w >= 8) { bondeScore += 16; bReasons.push(`⚡ 1W +${perf1w.toFixed(0)}%`); }
      else if (typeof perf1w === 'number' && perf1w >= 3) { bondeScore += 8; bReasons.push(`1W +${perf1w.toFixed(0)}%`); }
      else if (typeof perf1m === 'number' && perf1m >= 25) { bondeScore += 15; bReasons.push(`1M +${perf1m.toFixed(0)}% (1W flat)`); }
      else if (typeof perf3m === 'number' && perf3m >= 30) { bondeScore += 8; bReasons.push(`3M +${perf3m.toFixed(0)}%`); }
      // VOLUME — THE EP confirmation signal (heavily graded)
      if (typeof relVol1w === 'number' && relVol1w >= 4) { bondeScore += 25; bReasons.push(`Rel Vol ${relVol1w.toFixed(1)}× 🔥🔥🔥`); }
      else if (typeof relVol1w === 'number' && relVol1w >= 2.5) { bondeScore += 20; bReasons.push(`Rel Vol ${relVol1w.toFixed(1)}× 🔥🔥`); }
      else if (typeof relVol1w === 'number' && relVol1w >= 1.5) { bondeScore += 13; bReasons.push(`Rel Vol ${relVol1w.toFixed(1)}× confirms`); }
      else if (typeof relVol1w === 'number' && relVol1w >= 1) { bondeScore += 5; bReasons.push(`Rel Vol ${relVol1w.toFixed(1)}× normal`); }
      // PED ENTRY ZONE — Bonde's "post-earnings drift" zone (0-15% over MA = perfect)
      const bPctMA = typeof pctVsSma50 === 'number' ? pctVsSma50 : pctVsEma50;
      if (typeof bPctMA === 'number' && bPctMA >= 0 && bPctMA <= 8) { bondeScore += 18; bReasons.push(`PED prime zone +${bPctMA.toFixed(0)}%`); }
      else if (typeof bPctMA === 'number' && bPctMA > 8 && bPctMA <= 15) { bondeScore += 12; bReasons.push(`PED zone +${bPctMA.toFixed(0)}%`); }
      else if (typeof bPctMA === 'number' && bPctMA > 15 && bPctMA <= 25) { bondeScore += 6; bReasons.push(`drifting +${bPctMA.toFixed(0)}%`); }
      // STAGE-2 trend (graded)
      if (typeof pctVsEma200 === 'number' && pctVsEma200 >= 50) { bondeScore += 15; bReasons.push(`Stage-2 strong +${pctVsEma200.toFixed(0)}%`); }
      else if (typeof pctVsEma200 === 'number' && pctVsEma200 >= 20) { bondeScore += 10; bReasons.push(`Stage-2 +${pctVsEma200.toFixed(0)}%`); }
      else if (typeof pctVsEma200 === 'number' && pctVsEma200 >= 5) { bondeScore += 5; bReasons.push(`early Stage-2`); }
      // LIQUIDITY (graded — Bonde needs liquid names)
      if (typeof avgVol30d === 'number' && avgVol30d >= 2_000_000) { bondeScore += 8; bReasons.push('liquid'); }
      else if (typeof avgVol30d === 'number' && avgVol30d >= 500_000) { bondeScore += 5; bReasons.push('mid-liquid'); }
      // MOMENTUM acceleration confirmation
      if (momentumAccel >= 3) { bondeScore += 6; bReasons.push('mom-accel 3/3'); }
      else if (momentumAccel >= 2) { bondeScore += 3; bReasons.push('mom-accel 2/3'); }
      // 1Y trend confirmation
      if (typeof perf1y === 'number' && perf1y >= 100) { bondeScore += 6; bReasons.push(`1Y +${perf1y.toFixed(0)}%`); }
      else if (typeof perf1y === 'number' && perf1y >= 50) { bondeScore += 3; }

      // zzz132 — MINERVINI Trend Template rewritten — finer gradations, breaks 87-clustering
      let minerviniScore = 0; const mReasons: string[] = [];
      // 1. Price > SMA150 AND SMA200 (or EMA fallback)
      const aboveLong = (typeof pctVsSma150 === 'number' && pctVsSma150 > 0 && typeof pctVsSma200 === 'number' && pctVsSma200 > 0);
      if (aboveLong) { minerviniScore += 10; mReasons.push('price > SMA150 & 200'); }
      else if (typeof pctVsEma200 === 'number' && pctVsEma200 > 0) { minerviniScore += 6; mReasons.push('price > EMA200 (no SMA)'); }
      // 2. SMA150 > SMA200
      if (typeof sma150 === 'number' && typeof sma200 === 'number' && sma150 > sma200) { minerviniScore += 8; mReasons.push('SMA150 > 200'); }
      else if (typeof emaSpread === 'number' && emaSpread > 0) { minerviniScore += 5; }
      // 3. SMA200 trending UP — use 3M perf as proxy for slope
      if (typeof perf3m === 'number' && perf3m >= 15) { minerviniScore += 10; mReasons.push('SMA200 trending up'); }
      else if (typeof perf3m === 'number' && perf3m >= 5) { minerviniScore += 6; mReasons.push('SMA200 rising'); }
      else if (typeof perf3m === 'number' && perf3m >= 0) { minerviniScore += 3; }
      // 4. Clean hierarchy SMA50 > 150 > 200
      if (typeof sma50 === 'number' && typeof sma150 === 'number' && typeof sma200 === 'number' && sma50 > sma150 && sma150 > sma200) {
        minerviniScore += 12; mReasons.push('SMA50 > 150 > 200 ✓');
      }
      // 5. Position above SMA50 — graded sweet spot 0-15%
      const mPctMA = typeof pctVsSma50 === 'number' ? pctVsSma50 : pctVsEma50;
      if (typeof mPctMA === 'number' && mPctMA >= 2 && mPctMA <= 15) { minerviniScore += 12; mReasons.push(`+${mPctMA.toFixed(0)}% SMA50 ideal`); }
      else if (typeof mPctMA === 'number' && mPctMA > 15 && mPctMA <= 25) { minerviniScore += 7; mReasons.push(`+${mPctMA.toFixed(0)}% SMA50`); }
      else if (typeof mPctMA === 'number' && mPctMA >= 0 && mPctMA < 2) { minerviniScore += 5; mReasons.push(`+${mPctMA.toFixed(1)}% SMA50 (near)`); }
      else if (typeof mPctMA === 'number' && mPctMA > 25) { minerviniScore += 2; mReasons.push(`extended +${mPctMA.toFixed(0)}%`); }
      // 6. Distance from 52W high (graded — Minervini's "within 25%" rule)
      if (typeof distFromHigh === 'number' && distFromHigh >= -5) { minerviniScore += 15; mReasons.push(`at 52W high (${distFromHigh.toFixed(0)}%)`); }
      else if (typeof distFromHigh === 'number' && distFromHigh >= -15) { minerviniScore += 10; mReasons.push(`${distFromHigh.toFixed(0)}% from high`); }
      else if (typeof distFromHigh === 'number' && distFromHigh >= -25) { minerviniScore += 5; mReasons.push(`${distFromHigh.toFixed(0)}% from high`); }
      // 7. ≥30% above 52W low (THE Minervini criterion — graded)
      if (typeof pctAboveLow52w === 'number' && pctAboveLow52w >= 100) { minerviniScore += 12; mReasons.push(`+${pctAboveLow52w.toFixed(0)}% above 52W low ✓`); }
      else if (typeof pctAboveLow52w === 'number' && pctAboveLow52w >= 50) { minerviniScore += 9; mReasons.push(`+${pctAboveLow52w.toFixed(0)}% above 52W low`); }
      else if (typeof pctAboveLow52w === 'number' && pctAboveLow52w >= 30) { minerviniScore += 5; mReasons.push(`+${pctAboveLow52w.toFixed(0)}% above 52W low`); }
      // 8. RSI sweet spot (graded — Minervini likes 50-70)
      if (typeof rsi === 'number' && rsi >= 55 && rsi <= 70) { minerviniScore += 8; mReasons.push(`RSI ${rsi.toFixed(0)} ideal`); }
      else if (typeof rsi === 'number' && rsi >= 50 && rsi < 55) { minerviniScore += 5; mReasons.push(`RSI ${rsi.toFixed(0)}`); }
      else if (typeof rsi === 'number' && rsi > 70 && rsi <= 80) { minerviniScore += 3; mReasons.push(`RSI ${rsi.toFixed(0)} hot`); }
      else if (typeof rsi === 'number' && rsi >= 45 && rsi < 50) { minerviniScore += 3; }
      // 9. VCP — volatility contraction (graded: tighter = better)
      if (typeof vol1w === 'number' && typeof vol1m === 'number' && vol1m > 0) {
        const vRatio = vol1w / vol1m;
        if (vRatio < 0.6) { minerviniScore += 13; mReasons.push(`📉 VCP TIGHT (${(vRatio*100).toFixed(0)}%)`); }
        else if (vRatio < 0.85) { minerviniScore += 8; mReasons.push(`📉 VCP (${(vRatio*100).toFixed(0)}%)`); }
      }
      // zzz144 — Volume dry-up confirms Minervini VCP (institutions stop selling)
      if (typeof relVol1w === 'number' && relVol1w < 0.5 && typeof perf6m === 'number' && perf6m >= 30) {
        minerviniScore += 5; mReasons.push(`💧 vol dry-up ${relVol1w.toFixed(2)}× (institutional accumulation)`);
      }

      // ── RIGHT ENTRY ── prefer SMA50 if available, else EMA50; tightened ADR-aware zone
      let rightEntry: TechRow['rightEntry'] = 'NO DATA';
      let rightEntryDetail = '';
      const pctVsMA = typeof pctVsSma50 === 'number' ? pctVsSma50 : pctVsEma50;
      const maLabel = typeof pctVsSma50 === 'number' ? 'SMA50' : 'EMA50';
      if (typeof pctVsMA === 'number') {
        // Use ADR to size the buy zone: ideally within 2*ADR above MA
        const buyCeiling = (typeof adrPct === 'number' && adrPct > 0) ? Math.max(7, adrPct * 2) : 7;
        if (pctVsMA < 0) { rightEntry = 'BELOW'; rightEntryDetail = `${pctVsMA.toFixed(1)}% under ${maLabel} — wait for reclaim`; }
        else if (pctVsMA <= buyCeiling) { rightEntry = 'BUY ZONE'; rightEntryDetail = `+${pctVsMA.toFixed(1)}% over ${maLabel} (buy ceiling ${buyCeiling.toFixed(1)}%)`; }
        else if (pctVsMA <= buyCeiling * 2) { rightEntry = 'EXTENDED'; rightEntryDetail = `+${pctVsMA.toFixed(1)}% — wait for pullback to ${maLabel}`; }
        else { rightEntry = 'CHASE'; rightEntryDetail = `+${pctVsMA.toFixed(1)}% — chasing; high risk`; }
      }

      // zzz135 — WEIGHTED composite (Minervini 35% · Qulla 30% · Bonde 20% · Zanger 15%)
      // Per user: Minervini is the strictest framework, weight it highest. Zanger HTF
      // is rarest setup, weight lowest. Replaces simple avg/4.
      const totalScore = Math.round(0.35 * minerviniScore + 0.30 * qullaScore + 0.20 * bondeScore + 0.15 * zangerScore);

      return {
        symbol: r.symbol, company: r.company, sector: r.sector,
        exchange: r.exchange,  // zzz161 — needed for TradingView watchlist export prefix
        industry: (typeof r.industry === 'string' && r.industry) ? r.industry : undefined,  // zzz140
        price, mcapB: mcap, ema50, ema200, rsi,
        ema21, pctVsEma21,  // zzz138
        ema89, ema100, pctVsEma89, mediumMaLabel, pctVsMedium,  // multi-pivot
        perf1y, perf3m, perf6m, high52w, beta, avgVol30d,
        perf1w, perf1m, atr14, sma50, sma150, sma200, vol1m, vol1w, low52w, relVol1w, vol1d,
        pctVsEma50, pctVsEma200, pctVsSma50, pctVsSma150, pctVsSma200,
        emaSpread, distFromHigh, pctAboveLow52w, adrPct, volContraction, volumeBurst, momentumAccel,
        qullaScore, qullaReasons: qReasons,
        zangerScore, zangerReasons: zReasons,
        bondeScore, bondeReasons: bReasons,
        minerviniScore, minerviniReasons: mReasons,
        rightEntry, rightEntryDetail, stopLoss, stopLossPct, qualityFlags,
        // zzz133 — fundamentals + eligibility
        revGrowthQtr, revGrowthAnn, revGrowth5Y, epsGrowthTTM, epsGrowthQtr,
        grossProfitGrowthQtr, grossMargin, netMargin, opMargin, fcfMargin,
        roe, roic, debtEquity, netDebtEbitda, interestCoverage, piotroski,
        analystRating, nextEarnings, daysToEarnings, freeFloatPct, dollarVolume,
        fundScore, fundReasons, sepaScore, sepaReasons, growthConfirmed, marginExpanding,
        eligible, eligibilityFailures, eligibilityTags,
        totalScore,
      };
    }).filter(r => r.symbol);

    // zzz140 — Second pass: compute Composite RS rank + Industry RS rank
    // Composite RS = weighted blend of 1M/3M/6M/1Y perf, percentile-ranked within this universe (0-100).
    // Industry RS = each industry's median composite-perf percentile vs universe (0-100).
    if (rows.length >= 3) {
      // 1) Build composite-perf weighted score per row
      const compositePerfs: number[] = rows.map(r => {
        const w1m = typeof r.perf1m === 'number' ? r.perf1m : 0;
        const w3m = typeof r.perf3m === 'number' ? r.perf3m : 0;
        const w6m = typeof r.perf6m === 'number' ? r.perf6m : 0;
        const w1y = typeof r.perf1y === 'number' ? r.perf1y : 0;
        // weights: 1M 0.40 · 3M 0.30 · 6M 0.20 · 1Y 0.10 (institutional momentum bias)
        return 0.40 * w1m + 0.30 * w3m + 0.20 * w6m + 0.10 * w1y;
      });
      // Compute percentile rank (1-100) for each row's composite perf
      const sorted = [...compositePerfs].sort((a, b) => a - b);
      rows.forEach((r, i) => {
        const v = compositePerfs[i];
        const below = sorted.filter(s => s < v).length;
        r.compositeRs = Math.round((below / Math.max(1, sorted.length - 1)) * 100);
      });

      // 2) Industry RS rank: group by industry, compute median composite-perf, then rank industries
      const industryPerfs: Record<string, number[]> = {};
      rows.forEach((r, i) => {
        if (typeof r.industry !== 'string' || !r.industry) return;
        if (!industryPerfs[r.industry]) industryPerfs[r.industry] = [];
        industryPerfs[r.industry].push(compositePerfs[i]);
      });
      // Median per industry (only industries with ≥ 2 stocks for stability)
      const industryMedians: { industry: string; median: number }[] = [];
      Object.entries(industryPerfs).forEach(([ind, perfs]) => {
        if (perfs.length < 1) return;
        const s = [...perfs].sort((a, b) => a - b);
        const median = s.length % 2 === 0 ? (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : s[Math.floor(s.length / 2)];
        industryMedians.push({ industry: ind, median });
      });
      // Rank industries by median, assign 1-100 percentile
      industryMedians.sort((a, b) => a.median - b.median);
      const industryRankMap: Record<string, number> = {};
      industryMedians.forEach((entry, idx) => {
        industryRankMap[entry.industry] = Math.round(((idx + 1) / industryMedians.length) * 100);
      });
      // Attach Industry RS rank back to each row
      rows.forEach(r => {
        if (typeof r.industry === 'string' && industryRankMap[r.industry] !== undefined) {
          r.industryRsRank = industryRankMap[r.industry];
        }
      });

      // 3) Score adjustments based on Composite RS + Industry RS
      // Boost Minervini + Qulla if both are high (top quartile = institutional setup)
      rows.forEach(r => {
        const compRs = typeof r.compositeRs === 'number' ? r.compositeRs : 50;
        const indRs = typeof r.industryRsRank === 'number' ? r.industryRsRank : 50;
        // Composite RS booster (Minervini SEPA requires RS >= 80)
        if (compRs >= 90) { r.minerviniScore += 8; r.minerviniReasons.push(`📊 Composite RS ${compRs} (top 10%)`); }
        else if (compRs >= 80) { r.minerviniScore += 5; r.minerviniReasons.push(`Composite RS ${compRs}`); }
        else if (compRs >= 70) { r.minerviniScore += 2; }
        else if (compRs <= 30) { r.minerviniScore -= 3; r.minerviniReasons.push(`weak RS ${compRs}`); }
        // Qulla wants leading-industry leadership
        if (compRs >= 85) { r.qullaScore += 5; r.qullaReasons.push(`🚀 RS ${compRs}`); }
        // Industry RS boost — only meaningful with ≥ 3 industries
        if (industryMedians.length >= 3 && indRs >= 80) {
          r.qullaScore += 4; r.qullaReasons.push(`🏭 Industry top 20% (${r.industry})`);
          r.minerviniScore += 3; r.minerviniReasons.push(`Industry RS ${indRs}`);
        } else if (industryMedians.length >= 3 && indRs <= 30) {
          r.qullaScore -= 2; r.qullaReasons.push(`⚠️ weak industry (${r.industry})`);
        }
        // Recompute totalScore with the adjustments
        r.totalScore = Math.round(0.35 * r.minerviniScore + 0.30 * r.qullaScore + 0.20 * r.bondeScore + 0.15 * r.zangerScore);
        // Clamp playbook scores to 0-100 for display
        r.qullaScore = Math.max(0, Math.min(100, r.qullaScore));
        r.minerviniScore = Math.max(0, Math.min(100, r.minerviniScore));
      });
    }
    return rows;
  }, [usaRows]);

  // zzz175 tech tabs New tracker (per-market)
  const NEW_TAB_KEY_T: NewTabKey = market === 'IND' ? 'in-tech' : 'us-tech';
  const allSymbolsT = React.useMemo(() => techRows.map(r => r.symbol).filter(Boolean), [techRows]);
  const { newTickerSet: techNewSet, ackSet: techAckSet, toggleAck: toggleTechAck } = useNewTracker(NEW_TAB_KEY_T, allSymbolsT);

  // zzz140 — Industry RS leaderboard (sorted industries by median composite-perf percentile)
  const industryLeaderboard = React.useMemo(() => {
    if (techRows.length === 0) return [] as { industry: string; rank: number; count: number; medianRs: number; topTickers: string[] }[];
    const byIndustry: Record<string, TechRow[]> = {};
    techRows.forEach(r => {
      if (typeof r.industry !== 'string' || !r.industry) return;
      if (!byIndustry[r.industry]) byIndustry[r.industry] = [];
      byIndustry[r.industry].push(r);
    });
    const out: { industry: string; rank: number; count: number; medianRs: number; topTickers: string[] }[] = [];
    Object.entries(byIndustry).forEach(([ind, members]) => {
      if (members.length < 1) return;
      const rsVals = members.map(m => typeof m.compositeRs === 'number' ? m.compositeRs : 50).sort((a, b) => a - b);
      const med = rsVals.length % 2 === 0 ? (rsVals[rsVals.length / 2 - 1] + rsVals[rsVals.length / 2]) / 2 : rsVals[Math.floor(rsVals.length / 2)];
      const top = [...members].sort((a, b) => (b.compositeRs ?? 0) - (a.compositeRs ?? 0)).slice(0, 4).map(m => m.symbol);
      out.push({ industry: ind, rank: members[0].industryRsRank ?? 50, count: members.length, medianRs: med, topTickers: top });
    });
    return out.sort((a, b) => b.medianRs - a.medianRs);
  }, [techRows]);

  // ADDITIVE (audit R3) — O'Neil "leaders in leading groups". Aggregate ELIGIBLE
  // leaders by sector (fall back to industry) so concentration of leadership is
  // visible: buying a leader in a leading group is the highest-odds play.
  const groupKeyOf = React.useCallback((r: any): string => {
    const s = typeof r?.sector === 'string' ? r.sector.trim() : '';
    if (s) return s;
    const i = typeof r?.industry === 'string' ? r.industry.trim() : '';
    return i;
  }, []);
  const leadingGroups = React.useMemo(() => {
    const by: Record<string, { count: number; rsSum: number; rsN: number }> = {};
    techRows.forEach(r => {
      if (!r.eligible) return;
      const k = groupKeyOf(r);
      if (!k) return;
      if (!by[k]) by[k] = { count: 0, rsSum: 0, rsN: 0 };
      by[k].count++;
      if (typeof r.compositeRs === 'number') { by[k].rsSum += r.compositeRs; by[k].rsN++; }
    });
    return Object.entries(by)
      .map(([name, v]) => ({ name, count: v.count, avgRs: v.rsN > 0 ? Math.round(v.rsSum / v.rsN) : null }))
      .sort((a, b) => b.count - a.count || (b.avgRs ?? 0) - (a.avgRs ?? 0))
      .slice(0, 5);
  }, [techRows, groupKeyOf]);

  // zzz133 — playbook tops restricted to ELIGIBLE stocks (hard filters first)
  const qullaTop = React.useMemo(() => [...techRows].filter(r => r.eligible).sort((a, b) => b.qullaScore - a.qullaScore).filter(r => r.qullaScore >= 55).slice(0, 12), [techRows]);
  const zangerTop = React.useMemo(() => [...techRows].filter(r => r.eligible).sort((a, b) => b.zangerScore - a.zangerScore).filter(r => r.zangerScore >= 45).slice(0, 12), [techRows]);
  // zzz159 — Require positive recent thrust so we don't list stocks with 1W -7% under Bonde EP.
  // Accept either a strong 1W move (>= 5%) OR a strong 1M move (>= 20%) with recent EP-quality volume.
  const bondeTop = React.useMemo(() => [...techRows]
    .filter(r => r.eligible)
    .filter(r => (typeof r.perf1w === 'number' && r.perf1w >= 5) || (typeof r.perf1m === 'number' && r.perf1m >= 20))
    .sort((a, b) => b.bondeScore - a.bondeScore)
    .filter(r => r.bondeScore >= 55)
    .slice(0, 12), [techRows]);
  const minerviniTop = React.useMemo(() => [...techRows].filter(r => r.eligible).sort((a, b) => b.minerviniScore - a.minerviniScore).filter(r => r.minerviniScore >= 65).slice(0, 12), [techRows]);

  // zzz133 — STRICT BUY ZONE: eligibility + BUY ZONE position + positive 1M (no 3M-only sneak-ins)
  const buyZone = React.useMemo(() => [...techRows]
    .filter(r => r.eligible)
    .filter(r => r.rightEntry === 'BUY ZONE')
    .filter(r => typeof r.perf1m === 'number' && r.perf1m >= 0) // STRICT: must have positive 1M
    .filter(r => typeof r.perf1w === 'number' && r.perf1w >= -8) // exclude falling knives
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 24), [techRows]);

  // zzz135 — 🏆 CHAMPIONS: relaxed gate (was emptying out — too tight)
  // tech ≥ 45 AND fund ≥ 40 AND eligible AND BUY-or-EXTENDED (broader) AND 1M ≥ 0% AND 1W ≥ −8%
  const champions = React.useMemo(() => [...techRows]
    .filter(r => r.eligible)
    .filter(r => r.rightEntry === 'BUY ZONE' || r.rightEntry === 'EXTENDED')
    .filter(r => r.totalScore >= 45 && r.fundScore >= 40)
    .filter(r => typeof r.perf1m === 'number' && r.perf1m >= 0)
    .filter(r => typeof r.perf1w !== 'number' || r.perf1w >= -8)
    .sort((a, b) => (b.totalScore + b.fundScore) - (a.totalScore + a.fundScore))
    .slice(0, 12), [techRows]);

  // zzz133 — TECH ONLY: strong technicals, weak fundamentals
  const techOnly = React.useMemo(() => [...techRows]
    .filter(r => r.eligible)
    .filter(r => r.totalScore >= 55 && r.fundScore < 40)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 10), [techRows]);

  // zzz143 — QUALITY ON SALE switched to RELATIVE gate (fund dominates tech).
  // Root cause of "0 names": user uploads PRE-CURATED momentum watchlists
  // (Qulla leaders + Minervini + Weekly Gainers). In that universe every stock
  // already has strong tech AND strong fund, so absolute "fund>=55 AND tech<=50"
  // gates can never fire. Switching to RELATIVE: surface stocks where fund
  // meaningfully outpaces tech (fund-leaning quality plays even within a hot
  // universe). If absolute gate still empty, falls back to top-N by fund/tech ratio.
  const qualityOnSale = React.useMemo(() => {
    const passes = [...techRows]
      // Don't include parabolic / thin / micro flagged rows
      .filter(r => !r.qualityFlags || (!r.qualityFlags.some(f => f.startsWith('RSI near-parabolic')) && !r.qualityFlags.includes('thin volume') && !r.qualityFlags.includes('micro-cap illiquid')))
      // Sane price range (not in free-fall)
      .filter(r => {
        const p = typeof r.pctVsSma200 === 'number' ? r.pctVsSma200 : r.pctVsEma200;
        return typeof p !== 'number' || (p >= -30 && p <= 200);
      })
      // Allow rejected if only-below-SMA50 (that IS the setup)
      .filter(r => r.eligible || r.eligibilityFailures.every(f => f.startsWith('below SMA50')));

    // PRIMARY gate: fund >= 50 AND fund dominates tech by >= 8 pts
    const primary = passes
      .filter(r => r.fundScore >= 50)
      .filter(r => (r.fundScore - r.totalScore) >= 8)
      .sort((a, b) => (b.fundScore - b.totalScore) - (a.fundScore - a.totalScore));
    if (primary.length > 0) return primary.slice(0, 12);

    // FALLBACK gate: top fund/tech-ratio stocks even if dominance is small
    return passes
      .filter(r => r.fundScore >= 45)
      .sort((a, b) => {
        const ra = a.totalScore > 0 ? a.fundScore / a.totalScore : 0;
        const rb = b.totalScore > 0 ? b.fundScore / b.totalScore : 0;
        return rb - ra;
      })
      .slice(0, 8);
  }, [techRows]);

  // zzz133 — EARNINGS SOON: event-driven bucket
  const earningsSoon = React.useMemo(() => [...techRows]
    .filter(r => r.eligibilityTags.includes('EARNINGS_SOON') || r.eligibilityTags.includes('EARNINGS_IMMINENT'))
    .sort((a, b) => (a.daysToEarnings ?? 999) - (b.daysToEarnings ?? 999))
    .slice(0, 15), [techRows]);

  // zzz133 — REJECTED: failed hard filters (collapsible diagnostic)
  const rejected = React.useMemo(() => [...techRows]
    .filter(r => !r.eligible)
    .sort((a, b) => b.totalScore - a.totalScore), [techRows]);

  // zzz132 — QULLA 1M LEADERS — pure momentum (eligible only)
  const qulla1MLeaders = React.useMemo(() => [...techRows]
    .filter(r => r.eligible)
    .filter(r => typeof r.perf1m === 'number' && r.perf1m >= 15)
    .sort((a, b) => (b.perf1m ?? 0) - (a.perf1m ?? 0))
    .slice(0, 15), [techRows]);

  // zzz142 — BEST PICKS for watchlist export. Combines the highest-conviction subsets
  // across all buckets, deduplicates, tags with tier. Filters OUT the bad stocks
  // (rejected, parabolic, earnings imminent, extended without fund support).
  type BestPick = TechRow & { _tier: 'ELITE' | 'STRONG' | 'MOMENTUM' | 'QUALITY' };
  const bestPicks = React.useMemo<BestPick[]>(() => {
    const seen = new Set<string>();
    const out: BestPick[] = [];
    const add = (rows: TechRow[], tier: BestPick['_tier']) => {
      for (const r of rows) {
        if (!r.symbol || seen.has(r.symbol)) continue;
        // Hard exclusions even within tiered lists
        if (r.eligibilityTags.includes('EARNINGS_IMMINENT')) continue;
        if (r.qualityFlags && r.qualityFlags.some(f => f.startsWith('RSI near-parabolic'))) continue;
        seen.add(r.symbol);
        out.push({ ...r, _tier: tier });
      }
    };
    add(champions, 'ELITE');
    add(buyZone, 'STRONG');
    // Momentum: top composite RS that are eligible + totalScore >= 50 and not already added
    const momentum = [...techRows]
      .filter(r => r.eligible)
      .filter(r => typeof r.compositeRs === 'number' && r.compositeRs >= 75)
      .filter(r => r.totalScore >= 50)
      .filter(r => typeof r.perf1m === 'number' && r.perf1m >= 5)
      .sort((a, b) => (b.compositeRs ?? 0) - (a.compositeRs ?? 0));
    add(momentum, 'MOMENTUM');
    add(qualityOnSale, 'QUALITY');
    return out;
  }, [champions, buyZone, techRows, qualityOnSale]);

  // zzz161 — Format helpers for export. TradingView watchlist import needs
  // "EXCHANGE:SYMBOL" (e.g., NYSE:TER, NSE:TITAN) to resolve reliably —
  // otherwise TITAN, PARAS, RSI, P etc. collide across markets.
  const tvSymbol = (p: BestPick | TechRow): string => {
    const ex = (p.exchange || '').toUpperCase().trim();
    if (!ex || !p.symbol) return p.symbol || '';
    // TradingView uses NASDAQ, NYSE, AMEX, NSE, BSE — pass through as-is.
    // "NMS", "ARCA", etc. → normalise to NASDAQ / AMEX where sensible.
    const map: Record<string, string> = { NMS: 'NASDAQ', NASDAQGS: 'NASDAQ', ARCA: 'AMEX', BATS: 'AMEX' };
    return `${map[ex] || ex}:${p.symbol}`;
  };
  const formatForTV = (picks: BestPick[]): string => {
    const sections: Record<string, string[]> = { ELITE: [], STRONG: [], MOMENTUM: [], QUALITY: [] };
    picks.forEach(p => { sections[p._tier].push(tvSymbol(p)); });
    const out: string[] = [];
    if (sections.ELITE.length) { out.push('###Champions (Tech+Fund Elite)'); out.push(...sections.ELITE); }
    if (sections.STRONG.length) { out.push('###Buy Zone Strict'); out.push(...sections.STRONG); }
    if (sections.MOMENTUM.length) { out.push('###Momentum Leaders'); out.push(...sections.MOMENTUM); }
    if (sections.QUALITY.length) { out.push('###Quality on Sale'); out.push(...sections.QUALITY); }
    return out.join(',');
  };
  const formatPlain = (picks: BestPick[]): string => picks.map(p => tvSymbol(p)).join(',');
  const formatPlainNewline = (picks: BestPick[]): string => picks.map(p => tvSymbol(p)).join('\n');
  const formatCsv = (picks: BestPick[]): string => {
    const headers = 'Symbol,Tier,Tech,Fund,Qulla,Zanger,Bonde,Minervini,CompositeRS,IndustryRS,Industry,Sector,Entry,Price,Stop,RiskPct,1W%,1M%,3M%,RevQ%,EpsTTM%,RelVol,RSI';
    const rows = picks.map(p => [
      p.symbol, p._tier, p.totalScore, p.fundScore, p.qullaScore, p.zangerScore, p.bondeScore, p.minerviniScore,
      p.compositeRs ?? '', p.industryRsRank ?? '', p.industry || '', p.sector || '',
      p.rightEntry, p.price ?? '', p.stopLoss ?? '', p.stopLossPct ?? '',
      p.perf1w ?? '', p.perf1m ?? '', p.perf3m ?? '', p.revGrowthQtr ?? '', p.epsGrowthTTM ?? '',
      p.relVol1w ?? '', p.rsi ?? '',
    ].map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v)).join(','));
    return [headers, ...rows].join('\n');
  };

  // zzz142 — Copy helper with toast feedback
  const [copyToast, setCopyToast] = React.useState<string>('');
  const copyToClipboard = async (txt: string, label: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      setCopyToast(`✓ Copied ${label}`);
      setTimeout(() => setCopyToast(''), 2500);
    } catch {
      setCopyToast(`⚠️ Copy failed — select & copy manually`);
      setTimeout(() => setCopyToast(''), 3500);
    }
  };
  const downloadFile = (txt: string, filename: string, mime: string = 'text/plain') => {
    try {
      const blob = new Blob([txt], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  // zzz211 — ⭐ MASTER "COPY ALL BEST" — aggregates the best names from every
  // scoring system on this tab (Champions / Buy Zone / Momentum / Quality from
  // the 5-layer engine + SEPA Elite&Good + Volume Pockets Strong&Watch) into
  // ONE sectioned TradingView watchlist string, deduped across sections.
  const sepaBestRef = React.useRef<string[]>([]);
  const pocketsBestRef = React.useRef<string[]>([]);
  // zzz214 — bump when panel best-lists arrive so the Confluence strip renders
  const [bestTick, setBestTick] = React.useState(0);
  // zzz214 — ⚡ CONFLUENCE: how many independent systems flag each stock.
  const confluence = React.useMemo(() => {
    const bare = (x: string) => (x.includes(':') ? (x.split(':').pop() || '') : x).toUpperCase();
    const sysMap = new Map<string, Set<string>>();
    const tag = (sym: string | undefined, label: string) => {
      if (!sym) return;
      const b = bare(sym);
      if (!b) return;
      if (!sysMap.has(b)) sysMap.set(b, new Set());
      sysMap.get(b)!.add(label);
    };
    champions.forEach(r => tag(r.symbol, 'Champion'));
    buyZone.forEach(r => tag(r.symbol, 'Buy Zone'));
    sepaBestRef.current.forEach(x => tag(x, 'SEPA 7+'));
    pocketsBestRef.current.forEach(x => tag(x, 'Pocket'));
    bestPicks.filter(p => p._tier === 'MOMENTUM').forEach(p => tag(p.symbol, 'Momentum'));
    bestPicks.filter(p => p._tier === 'QUALITY').forEach(p => tag(p.symbol, 'Quality'));
    return [...sysMap.entries()]
      .map(([symbol, set]) => ({ symbol, n: set.size, systems: [...set] }))
      .filter(x => x.n >= 2)
      .sort((a, b) => b.n - a.n || a.symbol.localeCompare(b.symbol))
      .slice(0, 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [champions, buyZone, bestPicks, bestTick]);

  // ADDITIVE (🎯 prime setups) — the highest-conviction ELIGIBLE names resting AT
  // a moving-average pivot (21-EMA / 50-DMA / 89-EMA / 200-DMA — the buyable spot,
  // never extended), pulling the intersection of every screener. Mirrors
  // confluence's system-tagging but keeps names even at n=1, then gates on
  // resting-at-a-pivot and ranks by cross-screener agreement × proximity.
  // Returns the FULL ranked list (capped ~24); render applies pivotFilter + slices.
  const primeSetups = React.useMemo(() => {
    const bare = (x: string) => (x.includes(':') ? (x.split(':').pop() || '') : x).toUpperCase();
    const sys = new Map<string, Set<string>>();
    const tag = (sym: string | undefined, label: string) => { if (!sym) return; const b = bare(sym); if (!b) return; if (!sys.has(b)) sys.set(b, new Set()); sys.get(b)!.add(label); };
    champions.forEach(r => tag(r.symbol, 'Champion'));
    buyZone.forEach(r => tag(r.symbol, 'Buy Zone'));
    sepaBestRef.current.forEach(x => tag(x, 'SEPA 7+'));
    pocketsBestRef.current.forEach(x => tag(x, 'Pocket'));
    bestPicks.filter(p => p._tier === 'MOMENTUM').forEach(p => tag(p.symbol, 'Momentum'));
    bestPicks.filter(p => p._tier === 'QUALITY').forEach(p => tag(p.symbol, 'Quality'));
    const out: Array<{ r: TechRow; piv: { ma: string; dist: number; band: number }; systems: string[]; onB: boolean; onR: boolean; prox: number; primeScore: number }> = [];
    for (const r of techRows) {
      if (!r.eligible) continue;
      const piv = nearestPivot(r);
      if (!piv) continue;                                             // resting at a MA pivot
      if (!(typeof r.perf1m === 'number' && r.perf1m >= 0)) continue;  // positive 1M
      if (typeof r.perf1w === 'number' && r.perf1w < -8) continue;     // no falling knife
      if (r.eligibilityTags.includes('EARNINGS_IMMINENT')) continue;   // no earnings <=3d
      const b = bare(r.symbol);
      const systems = sys.has(b) ? [...sys.get(b)!] : [];
      const onB = onBench(r.symbol), onR = onRadar(r.symbol);
      const prox = 1 - Math.min(1, Math.abs(piv.dist) / Math.max(piv.band, 1)); // 1 at the line, 0 at ceiling
      const maBonus = piv.ma === '21-EMA' ? 4 : piv.ma === '50-DMA' ? 3 : /89|100/.test(piv.ma) ? 1 : 0; // prefer tighter pivots
      const primeScore = systems.length * 14 + (onB ? 8 : 0) + (onR ? 8 : 0) + (r.totalScore || 0) * 0.5 + (r.fundScore || 0) * 0.3 + prox * 16 + maBonus;
      out.push({ r, piv, systems, onB, onR, prox, primeScore });
    }
    out.sort((a, b) => b.primeScore - a.primeScore);
    return out.slice(0, 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techRows, champions, buyZone, bestPicks, bestTick, onBench, onRadar, nearestPivot]);

  const copyAllBest = () => {
    const seen = new Set<string>();
    const out: string[] = [];
    // zzz961 — leave out EXTENDED names (> 30% above the 50-day, > 90% above the 200-day, or ≥ 10 daily ranges above the 50-day)
    const rowByBare = new Map<string, TechRow>();
    for (const r of techRows) rowByBare.set((r.symbol.includes(':') ? (r.symbol.split(':').pop() || '') : r.symbol).toUpperCase(), r);
    const skipped: string[] = [];
    const addSection = (title: string, syms: string[]) => {
      const fresh = syms.filter(sym => {
        const bare = (sym.includes(':') ? (sym.split(':').pop() || '') : sym).toUpperCase();
        if (!bare || seen.has(bare)) return false;
        seen.add(bare);
        const ext = extensionCheck(rowByBare.get(bare));
        if (ext.extended) { skipped.push(`${bare} (${ext.reason})`); return false; }
        return true;
      });
      if (fresh.length) { out.push(`###${title}`); out.push(...fresh); }
    };
    addSection('Champions', bestPicks.filter(p => p._tier === 'ELITE').map(p => tvSymbol(p)));
    addSection('Buy Zone', bestPicks.filter(p => p._tier === 'STRONG').map(p => tvSymbol(p)));
    addSection('SEPA Elite+Good', sepaBestRef.current);
    if (market === 'IND') addSection('Volume Pockets', pocketsBestRef.current);
    addSection('Momentum', bestPicks.filter(p => p._tier === 'MOMENTUM').map(p => tvSymbol(p)));
    addSection('Quality on Sale', bestPicks.filter(p => p._tier === 'QUALITY').map(p => tvSymbol(p)));
    // zzz212 — ###Multibaggers LAST: only well-graded (A+/A/B+, not MONITOR)
    // rows from the matching Multibagger tab. Read fresh from localStorage at
    // click time — India tab pulls mb_excel_scored_v2, USA pulls
    // mb_usa_scored_v2. Numeric BSE-code-only symbols are skipped (TV can't
    // resolve them).
    try {
      const mbKey = market === 'IND' ? 'mb_excel_scored_v2' : 'mb_usa_scored_v2';
      const mbRaw = localStorage.getItem(mbKey);
      let mbRows: any[] = [];
      if (mbRaw) {
        const parsed = JSON.parse(mbRaw);
        mbRows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.rows) ? parsed.rows : []);
      }
      // zzz228 — USA: the full scored_v2 write can FAIL on localStorage quota
      // (zzz108 falls back to a slim payload + in-memory cache), so an empty
      // read here silently dropped the whole Multibaggers section from
      // Copy ALL BEST on the USA tab (India's smaller payload always fit,
      // which is why India worked). Fallback: slim_v2 -> mem cache.
      if (market === 'USA' && mbRows.length === 0) {
        try {
          const slimRaw = localStorage.getItem('mb_usa_slim_v2');
          if (slimRaw) {
            const slim = JSON.parse(slimRaw);
            if (Array.isArray(slim)) mbRows = slim;
          }
        } catch {}
        if (mbRows.length === 0) {
          try { mbRows = _getUsaRowsMemCache() || []; } catch {}
        }
      }
      // zzz231 — India: same eviction risk (Chrome purges site data under
      // pressure, wiping mb_excel_scored_v2 while IDB survives). The IDB
      // hydration path already re-populates the React state and the mem
      // cache we set alongside it — read that here as a synchronous fallback
      // so the ###Multibaggers section stays intact even when localStorage
      // is empty. Matches USA parity per zzz228.
      if (market === 'IND' && mbRows.length === 0) {
        try { mbRows = _getIndiaRowsMemCache() || []; } catch {}
      }
      if (mbRows.length > 0) {
        const exMap: Record<string, string> = { NMS: 'NASDAQ', NASDAQGS: 'NASDAQ', ARCA: 'AMEX', BATS: 'AMEX' };
        const good = mbRows.filter(r =>
          r && typeof r.symbol === 'string' && r.symbol &&
          ['A+', 'A', 'B+'].includes(r.grade) &&
          r.bucket !== 'MONITOR');
        // zzz213 — India Multibagger stores BSE-only listings as "BSE:524520"
        // (numeric scrip code). Strip any embedded exchange prefix, then drop
        // pure-numeric codes — TradingView can't resolve them, and the naive
        // NSE: prefix produced broken "NSE:BSE:524520" entries.
        addSection('Multibaggers', good.map(r => {
          let sym = String(r.symbol).trim().toUpperCase();
          let embeddedEx = '';
          if (sym.includes(':')) {
            const parts = sym.split(':');
            sym = parts.pop() || '';
            embeddedEx = parts.pop() || '';
          }
          if (!sym || /^\d+$/.test(sym)) return '';
          if (market === 'IND') return `${embeddedEx || 'NSE'}:${sym}`;
          const ex = String(r.exchange || '').toUpperCase().trim();
          return `${exMap[ex] || ex || embeddedEx || 'NASDAQ'}:${sym}`;
        }).filter(Boolean) as string[]);
      }
    } catch {}
    if (out.length === 0) {
      copyToClipboard('', 'nothing — no best picks computed yet');
      return;
    }
    if (skipped.length) console.info('[Copy ALL BEST] extended names left out:', skipped.join('; '));
    copyToClipboard(out.join(','), `ALL BEST — ${seen.size - skipped.length} names, sectioned for TV watchlist${skipped.length ? ` · ${skipped.length} extended left out (${skipped.slice(0, 6).map(x => x.split(' ')[0]).join(', ')}${skipped.length > 6 ? '…' : ''})` : ''}`);
  };

  // zzz133 — SORT state for ALL TICKERS table
  const [sortField, setSortField] = React.useState<string>('totalScore');
  const [sortAsc, setSortAsc] = React.useState<boolean>(false);
  const sortedAll = React.useMemo(() => {
    // zzz891: each row carries its return minus the index (NIFTY 50 / S&P 500) over the same windows, so it can be sorted
    let arr = techRows.map((r: any) => { const rs = rsVsIndex(r, idxRet); return { ...r, rsIdx3m: rs.rel3m, rsIdx: rs }; });
    // ADDITIVE (audit) — optional confluence filter: only bench/radar-backed names.
    if (confluenceOnly) arr = arr.filter(r => onBench(r.symbol) || onRadar(r.symbol));
    // ADDITIVE (audit R3) — sector/group leadership filter (from the leading-groups strip).
    if (groupFilter) arr = arr.filter(r => groupKeyOf(r) === groupFilter);
    // ADDITIVE (audit R2) — when ranking by a score column (the default view),
    // float fundamentally-backed names (🏆 bench / 🚀 radar) upward with a small
    // effective boost. Technical setup + fundamental backing = higher conviction.
    // Display-order only — the printed scores stay honest.
    const SCORE_FIELDS = new Set(['totalScore', 'qullaScore', 'zangerScore', 'bondeScore', 'minerviniScore', 'compositeRs']);
    const boostSort = !sortAsc && SCORE_FIELDS.has(sortField);
    const confBoost = (r: any) => boostSort ? (onBench(r.symbol) ? 6 : 0) + (onRadar(r.symbol) ? 6 : 0) : 0;
    arr.sort((a: any, b: any) => {
      const va = a[sortField], vb = b[sortField];
      if (typeof va === 'number' && typeof vb === 'number') {
        const av = va + confBoost(a), bv = vb + confBoost(b);
        return sortAsc ? av - bv : bv - av;
      }
      if (typeof va === 'string' && typeof vb === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      if (va == null && vb != null) return 1;
      if (va != null && vb == null) return -1;
      return 0;
    });
    return arr;
  }, [techRows, sortField, sortAsc, confluenceOnly, onBench, onRadar, groupFilter, groupKeyOf, idxRet]);
  const handleSort = (field: string) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(field === 'symbol' || field === 'company'); }
  };
  const sortIcon = (field: string) => sortField === field ? (sortAsc ? ' ▲' : ' ▼') : '';

  // zzz135 — Position-sizing inputs (persistent in localStorage)
  // zzz136 — Default 52000 + use string state for free typing (don't clamp during input,
  // only when computing). Previous Math.max(1000, …) inside onChange snapped the field
  // back to 1000 the moment the user cleared it to retype — making it unchangeable.
  const [portfolioInput, setPortfolioInput] = React.useState<string>(() => {
    if (typeof window === 'undefined') return '52000';
    try { return localStorage.getItem(`mb_tech_portfolio_${MK}`) || '52000'; } catch { return '52000'; }
  });
  const [riskPctInput, setRiskPctInput] = React.useState<string>(() => {
    if (typeof window === 'undefined') return '1';
    try { return localStorage.getItem(`mb_tech_risk_pct_${MK}`) || '1'; } catch { return '1'; }
  });
  // Parsed numeric values used in calcs (fallback to last valid value when input is mid-edit)
  const portfolioSize = React.useMemo(() => {
    const v = parseFloat(portfolioInput);
    return Number.isFinite(v) && v > 0 ? v : 52000;
  }, [portfolioInput]);
  const riskPct = React.useMemo(() => {
    const v = parseFloat(riskPctInput);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }, [riskPctInput]);
  React.useEffect(() => { try { localStorage.setItem(`mb_tech_portfolio_${MK}`, portfolioInput); } catch {} }, [portfolioInput]);
  React.useEffect(() => { try { localStorage.setItem(`mb_tech_risk_pct_${MK}`, riskPctInput); } catch {} }, [riskPctInput]);

  // zzz137 — P/L Calculator inputs (4 fields, persists to LS)
  const [plEntry, setPlEntry] = React.useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try { return localStorage.getItem(`mb_tech_pl_entry_${MK}`) || ''; } catch { return ''; }
  });
  const [plQty, setPlQty] = React.useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try { return localStorage.getItem(`mb_tech_pl_qty_${MK}`) || ''; } catch { return ''; }
  });
  const [plStop, setPlStop] = React.useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try { return localStorage.getItem(`mb_tech_pl_stop_${MK}`) || ''; } catch { return ''; }
  });
  const [plTarget, setPlTarget] = React.useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try { return localStorage.getItem(`mb_tech_pl_target_${MK}`) || ''; } catch { return ''; }
  });
  React.useEffect(() => { try { localStorage.setItem(`mb_tech_pl_entry_${MK}`, plEntry); } catch {} }, [plEntry]);
  React.useEffect(() => { try { localStorage.setItem(`mb_tech_pl_qty_${MK}`, plQty); } catch {} }, [plQty]);
  React.useEffect(() => { try { localStorage.setItem(`mb_tech_pl_stop_${MK}`, plStop); } catch {} }, [plStop]);
  React.useEffect(() => { try { localStorage.setItem(`mb_tech_pl_target_${MK}`, plTarget); } catch {} }, [plTarget]);

  // P/L calc — works for any combination of valid inputs
  const plCalc = React.useMemo(() => {
    const entry = parseFloat(plEntry);
    const qty = parseFloat(plQty);
    const stop = parseFloat(plStop);
    const target = parseFloat(plTarget);
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(qty) || qty <= 0) return null;
    const capital = entry * qty;
    let lossPct: number | null = null, lossAmt: number | null = null;
    let profitPct: number | null = null, profitAmt: number | null = null;
    let rr: number | null = null;
    if (Number.isFinite(stop) && stop > 0 && stop < entry) {
      lossAmt = (stop - entry) * qty; // negative
      lossPct = ((stop - entry) / entry) * 100;
    }
    if (Number.isFinite(target) && target > 0 && target > entry) {
      profitAmt = (target - entry) * qty;
      profitPct = ((target - entry) / entry) * 100;
    }
    if (lossAmt !== null && profitAmt !== null && lossAmt !== 0) {
      rr = profitAmt / Math.abs(lossAmt);
    }
    return { entry, qty, stop, target, capital, lossPct, lossAmt, profitPct, profitAmt, rr };
  }, [plEntry, plQty, plStop, plTarget]);

  // Position sizing math: given portfolio, riskPct, price, stopLoss → shares + capital
  const calcPosition = (price?: number, stop?: number) => {
    if (typeof price !== 'number' || typeof stop !== 'number' || stop >= price) return null;
    const riskDollars = portfolioSize * (riskPct / 100);
    const riskPerShare = price - stop;
    const shares = Math.floor(riskDollars / riskPerShare);
    if (shares <= 0) return null;
    const capital = shares * price;
    const portfolioAllocPct = (capital / portfolioSize) * 100;
    return { shares, capital, riskDollars, portfolioAllocPct, riskPerShare };
  };

  // zzz135 — Click-to-detail modal state
  const [expandedSymbol, setExpandedSymbol] = React.useState<string | null>(null);
  const expandedRow = React.useMemo(() => expandedSymbol ? techRows.find(r => r.symbol === expandedSymbol) : null, [techRows, expandedSymbol]);

  // zzz412 — Weinstein Stage-4 breakdown bucket (the single most important
  // EXIT signal). Grouped + scannable so held names rolling into Stage 4 are
  // never buried among the bullish buckets.
  const stage4Rows = React.useMemo(() => techRows.filter(r => classifyStage(r) === 4), [techRows]);

  // ADDITIVE (✂️ trim / take-profit watch) — the missing EXIT side for names you
  // likely HOLD. Surfaces parabolic extension, climactic RSI, and heavy-volume
  // breaks of the 50-DMA (distribution). Distinct from Stage 4 (names you'd never
  // own) — this is position management on winners. Purely derived from TechRow.
  const trimWatch = React.useMemo(() => {
    const out: Array<{ symbol: string; company?: string; price?: number; sector?: string; over50?: number; rsi?: number; perf1m?: number; kind: 'parabolic'|'climax'|'distribution'; color: string; action: string; sev: number }> = [];
    for (const r of techRows) {
      const perf1m = typeof r.perf1m === 'number' ? r.perf1m : undefined;
      const perf3m = typeof r.perf3m === 'number' ? r.perf3m : undefined;
      // Only names that were in a real uptrend (avoid junk).
      const inUptrend = (typeof perf1m === 'number' && perf1m > 0) || (typeof perf3m === 'number' && perf3m > 0) || r.eligible === true;
      if (!inUptrend) continue;
      const over50 = typeof r.pctVsSma50 === 'number' ? r.pctVsSma50 : (typeof r.pctVsEma50 === 'number' ? r.pctVsEma50 : undefined);
      const rsi = typeof r.rsi === 'number' ? r.rsi : undefined;
      const relVol1w = typeof r.relVol1w === 'number' ? r.relVol1w : undefined;
      let hit: { kind: 'parabolic'|'climax'|'distribution'; sev: number; color: string; action: string } | null = null;
      const consider = (c: { kind: 'parabolic'|'climax'|'distribution'; sev: number; color: string; action: string }) => { if (!hit || c.sev > hit.sev) hit = c; };
      // DISTRIBUTION (reduce/exit) — highest priority via +100 sev offset.
      if (typeof over50 === 'number' && over50 < 0 && typeof relVol1w === 'number' && relVol1w >= 1.5 && typeof perf3m === 'number' && perf3m > 0) {
        consider({ kind: 'distribution', sev: 100 + Math.abs(over50), color: '#EF4444', action: `Broke 50-DMA on ${relVol1w.toFixed(1)}× volume — distribution, reduce` });
      }
      // PARABOLIC (trim into strength).
      if (typeof over50 === 'number' && over50 >= 25) {
        consider({ kind: 'parabolic', sev: over50, color: '#F59E0B', action: `Parabolic +${over50.toFixed(0)}% over 50-DMA — trim into strength, trail a stop` });
      }
      // CLIMACTIC RSI.
      if (typeof rsi === 'number' && rsi >= 85) {
        consider({ kind: 'climax', sev: rsi, color: '#F59E0B', action: `RSI ${rsi.toFixed(0)} — climactic, tighten stop / take partial` });
      }
      if (hit) {
        const h = hit as { kind: 'parabolic'|'climax'|'distribution'; sev: number; color: string; action: string };
        out.push({ symbol: r.symbol, company: r.company, price: r.price, sector: r.sector, over50, rsi, perf1m, kind: h.kind, color: h.color, action: h.action, sev: h.sev });
      }
    }
    out.sort((a, b) => b.sev - a.sev);
    return out.slice(0, 12);
  }, [techRows]);

  // zzz412 — Arm a Book Watch flag for HELD / BENCHED names that have rolled
  // into Stage 4. Only conviction-bench tickers or explicit BUY decisions are
  // armed (not the whole universe) to keep the alert feed noise-free.
  // armBookFlag self-dedups by kind+ticker+day and is a no-op on the server,
  // so re-running on every scored-rows change is safe.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    let convSet: Set<string>;
    try { convSet = new Set(Array.from(getConvictionTickers()).map((t: string) => String(t).toUpperCase())); }
    catch { convSet = new Set<string>(); }
    for (const r of stage4Rows) {
      const sym = String(r.symbol || '').toUpperCase();
      if (!sym) continue;
      const held = convSet.has(sym) || getDecision(sym)?.status === 'BUY';
      if (!held) continue;
      armBookFlag({
        kind: 'STAGE4_BREAKDOWN', ticker: sym, company: r.company, severity: 'critical',
        message: `${sym} broke into Stage 4 (price<200DMA, 50<200DMA, 3m<0) — technical exit signal`,
        detail: 'held/bench position',
      });
    }
  }, [stage4Rows]);

  // Lock body scroll when modal open
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (expandedSymbol) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [expandedSymbol]);

  // Data-quality summary
  const dataQuality = React.useMemo(() => {
    const total = techRows.length;
    const flagged = techRows.filter(r => r.qualityFlags && r.qualityFlags.length > 0).length;
    const withSMA = techRows.filter(r => typeof r.sma50 === 'number').length;
    const withATR = techRows.filter(r => typeof r.atr14 === 'number').length;
    const with52WLow = techRows.filter(r => typeof r.low52w === 'number').length;
    const with1W = techRows.filter(r => typeof r.perf1w === 'number').length;
    const with1M = techRows.filter(r => typeof r.perf1m === 'number').length;
    const withRelVol = techRows.filter(r => typeof r.relVol1w === 'number').length;
    return { total, flagged, withSMA, withATR, with52WLow, with1W, with1M, withRelVol };
  }, [techRows]);

  const PANEL = 'var(--mc-panel, #11151F)';
  const PANEL2 = 'var(--mc-panel2, rgba(255,255,255,0.03))';
  const LINE = 'var(--mc-line, rgba(255,255,255,0.08))';
  const TXT = 'var(--mc-txt, #e6edf3)';
  const MUTED = 'var(--mc-muted, #8b95a5)';
  const CYAN = '#22D3EE';
  const cardStyle: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 18, marginBottom: 14 };

  // zzz132 helpers
  // zzz158 — Currency symbol by market. India tab = ₹ (rupee), USA tab = $ (dollar).
  const CUR = market === 'IND' ? '₹' : '$';
  const fmtPrice = (p?: number) => (typeof p === 'number' ? (p >= 1000 ? `${CUR}${p.toFixed(0)}` : `${CUR}${p.toFixed(2)}`) : '—');
  const fmtPct = (p?: number, digits = 0) => (typeof p === 'number' ? `${p >= 0 ? '+' : ''}${p.toFixed(digits)}%` : '—');
  const scoreColor = (s: number) => s >= 80 ? '#10B981' : s >= 65 ? '#22D3EE' : s >= 50 ? '#84CC16' : s >= 35 ? '#F59E0B' : MUTED;
  const entryColor = (e: string) => e === 'BUY ZONE' ? '#10B981' : e === 'EXTENDED' ? '#F59E0B' : e === 'CHASE' ? '#EF4444' : e === 'BELOW' ? '#94A3B8' : MUTED;

  const renderPlaybookSection = (title: string, color: string, emoji: string, items: TechRow[], scoreKey: 'qullaScore' | 'zangerScore' | 'bondeScore' | 'minerviniScore', reasonsKey: 'qullaReasons' | 'zangerReasons' | 'bondeReasons' | 'minerviniReasons', subtitle: string) => (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 17, color, fontWeight: 900, letterSpacing: '0.3px' }}>{emoji} {title} <span style={{ color: MUTED, fontWeight: 600 }}>({items.length})</span></div>
        <div style={{ fontSize: 12, color: MUTED, fontStyle: 'italic' }}>{subtitle}</div>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: MUTED, padding: 14, background: PANEL2, borderRadius: 6 }}>No candidates pass the threshold today. Upload a fresh USA CSV on the 🇺🇸 USA Multibagger tab.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
          {items.map(r => (
            <div key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ background: PANEL2, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`, borderLeft: `4px solid ${color}`, borderRadius: 8, padding: 12, cursor: 'pointer', overflow: 'hidden', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, rowGap: 3, flexWrap: 'wrap', marginBottom: 4, minWidth: 0 }}>
                <span style={{ fontSize: 17, fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{r.symbol}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(r.price)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 900, color: scoreColor(r[scoreKey]), flexShrink: 0 }}>{r[scoreKey]}<span style={{ fontSize: 10, color: MUTED }}>/100</span></span>
              </div>
              <div style={{ fontSize: 11.5, color: TXT, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.company || ''}>
                <span style={{ color: MUTED, fontSize: 10 }}>{r.sector?.slice(0, 25) || ''}</span> · {r.company || r.symbol}
              </div>
              <div style={{ fontSize: 11.5, color: TXT, lineHeight: 1.55, marginBottom: 6 }}>{r[reasonsKey].slice(0, 5).join(' · ')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5, marginBottom: 4 }}>
                {typeof r.perf1w === 'number' ? <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>1W {fmtPct(r.perf1w)}</span> : null}
                {typeof r.perf1m === 'number' ? <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>1M {fmtPct(r.perf1m)}</span> : null}
                {typeof r.perf3m === 'number' ? <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>3M {fmtPct(r.perf3m)}</span> : null}
                {typeof r.rsi === 'number' ? <span style={{ background: r.rsi > 85 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4, color: r.rsi > 85 ? '#EF4444' : TXT }}>RSI {r.rsi.toFixed(0)}</span> : null}
              </div>
              <div style={{ fontSize: 11, color: entryColor(r.rightEntry), fontWeight: 800, marginTop: 4 }}>
                🎯 {r.rightEntry} · {r.rightEntryDetail}
                {(() => { const er = earningsRisk(r); return er ? <span title={`Reports in ${er.days} day(s)${r.nextEarnings ? ' ('+r.nextEarnings+')' : ''} — event risk. Desks avoid new entries inside this window.`} style={{ fontSize: 10, fontWeight: 800, color: er.color, border: `1px solid ${er.color}55`, borderRadius: 4, padding: '1px 5px', marginLeft: 6 }}>{er.label}</span> : null; })()}
              </div>
              {typeof r.stopLoss === 'number' ? (
                <div style={{ fontSize: 10.5, color: '#F59E0B', marginTop: 3, fontWeight: 700 }}>
                  🛑 STOP {fmtPrice(r.stopLoss)} ({typeof r.stopLossPct === 'number' ? `−${r.stopLossPct.toFixed(1)}% risk` : '−2×ATR'})
                </div>
              ) : null}
              {r.qualityFlags && r.qualityFlags.length > 0 ? (
                <div style={{ fontSize: 10, color: '#EF4444', marginTop: 3, fontWeight: 700 }}>⚠️ {r.qualityFlags.join(' · ')}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1700, margin: '0 auto', fontSize: 14 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: TXT }}>📈 Technicals — Qullamaggie · Zanger · Bonde · Minervini</div>
          <button onClick={copyAllBest}
            title="Copy every best pick — Champions, Buy Zone, SEPA Elite/Good, Volume Pockets, Momentum, Quality + Multibaggers (A+/A/B+) — as ONE sectioned TradingView watchlist. Extended names are left out: more than 30% above the 50-day average, more than 90% above the 200-day average, or 10+ average daily ranges above the 50-day average."
            style={{ marginLeft: 'auto', background: 'linear-gradient(135deg, #F59E0B, #22D3EE)', color: '#0B1220', border: 'none', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ⭐ Copy ALL BEST → TV
          </button>
          {copyToast && (
            <span style={{ background: copyToast.startsWith('✓') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: copyToast.startsWith('✓') ? '#10B981' : '#EF4444', padding: '7px 11px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
              {copyToast}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
          {market === 'USA' ? '🇺🇸 USA Technicals' : '🇮🇳 India Technicals'} — pure-technical scoring of your TradingView {market === 'USA' ? 'USA' : 'India'} export.
          <b style={{ color: TXT }}> {techRows.length} stocks scored</b>.
          {techLocalRows.length > 0 ? <> · Source: <b style={{ color: '#10B981' }}>{techSources.length} file{techSources.length>1?'s':''} uploaded here</b></> : <> · Source: <span style={{ color: MUTED }}>(empty — upload below)</span></>}
        </div>
      </div>

      {/* ADDITIVE (audit) — Market-breadth REGIME STRIP. Technical breakouts work
          best in risk-on regimes; this frames every setup below. Hides if breadth
          API is unreachable. */}
      {techRegime && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '9px 14px', borderRadius: 8, marginBottom: 14,
          background: `color-mix(in srgb, ${techRegime.regime_color || '#22D3EE'} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${techRegime.regime_color || '#22D3EE'} 45%, transparent)` }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: 0.6, textTransform: 'uppercase' }}>Market Regime</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: techRegime.regime_color || TXT }}>{market === 'USA' ? '🇺🇸' : '🇮🇳'} {techRegime.regime}</span>
          {/* WHAT WAS MEASURED, NAMED. Two tabs quoting one unlabelled number
              is how a US tab reading Indian breadth went unnoticed. */}
          {techRegime.scope_label && <span style={{ fontSize: 11, color: MUTED }} title="The universe this regime was measured over">{techRegime.scope_label}</span>}
          <span style={{ fontSize: 12.5, color: TXT }}>Breadth composite <b style={{ color: techRegime.regime_color || TXT }}>{Math.round(techRegime.composite)}</b>/100</span>
          {typeof techRegime.suggested_cash_pct === 'number' && (
            <span style={{ fontSize: 12.5, color: MUTED }}>· suggested cash <b style={{ color: TXT }}>{Math.round(techRegime.suggested_cash_pct)}%</b></span>
          )}
          <span style={{ fontSize: 11.5, color: MUTED, fontStyle: 'italic', marginLeft: 'auto' }}>
            {techRegime.composite >= 60 ? 'Risk-on — press breakouts.' : techRegime.composite >= 40 ? 'Neutral — be selective, tighten stops.' : 'Risk-off — technicals fail more; size down.'}
          </span>
        </div>
      )}

      {/* ADDITIVE (audit R3) — REGIME-ADAPTIVE STANCE directive. A great chart in a
          bad tape is still a bad trade. Turns the breadth composite into an explicit
          position-sizing posture that frames the whole tab. Color = regime. */}
      {techRegime && (() => {
        const c = techRegime.composite;
        const s = c >= 60
          ? { col: '#10B981', head: '🟢 PRESS BREAKOUTS — FULL SIZE', body: 'Risk-on / expansion tape. Leadership is broad — take full position size on clean pivots and let winners run.' }
          : c >= 40
            ? { col: '#FBBF24', head: '🟡 SELECTIVE — HALF SIZE, A+ ONLY', body: 'Transitional tape. Trade half size, only A+ setups (bench 🏆 / radar 🚀-backed), tighter stops. Pass on marginal breakouts.' }
            : { col: '#EF4444', head: '🔴 CAPITAL PRESERVATION — RAISE CASH', body: 'Risk-off tape. Most breakouts FAIL here — even perfect setups have low odds. Shrink size, raise cash, wait for a follow-through day before committing.' };
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '13px 18px', borderRadius: 12, marginBottom: 16,
            background: `color-mix(in srgb, ${s.col} 14%, transparent)`, border: `2px solid ${s.col}`, boxShadow: `0 0 0 1px color-mix(in srgb, ${s.col} 20%, transparent)` }}>
            <span style={{ fontSize: 17, fontWeight: 900, color: s.col, whiteSpace: 'nowrap' }}>{s.head}</span>
            <span style={{ fontSize: 13, color: TXT, lineHeight: 1.45, flex: 1, minWidth: 240 }}>{s.body}</span>
          </div>
        );
      })()}

      {/* ADDITIVE (audit R2) — AUTO-SYNC freshness banner. Data auto-pulls on mount
          from the daily GitHub-Action TradingView sync (see zzz156 auto-pull effect),
          so no manual upload is needed. This surfaces that state clearly + gives a
          one-click re-pull. Falls back to a "no server rows for this market" note. */}
      {(() => {
        const n = techLocalRows.length;
        const broken = techSyncStatus?.syncBroken;
        const hasServerRows = techSources.some(s => s.name.startsWith('📡') && s.rowCount > 0);
        const bg = broken ? 'rgba(239,68,68,0.08)' : n > 0 ? 'color-mix(in srgb, #10B981 8%, transparent)' : 'rgba(251,191,36,0.08)';
        const bd = broken ? 'rgba(239,68,68,0.4)' : n > 0 ? 'color-mix(in srgb, #10B981 40%, transparent)' : 'rgba(251,191,36,0.4)';
        const col = broken ? '#EF4444' : n > 0 ? '#10B981' : '#FBBF24';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', borderRadius: 10, marginBottom: 14, background: bg, border: `1px solid ${bd}` }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: col }}>
              {broken
                ? '⚠️ Auto-sync degraded — server files may be stale'
                : n > 0
                  ? `🔄 Auto-synced from TradingView · last sync ${agoLabel(techSyncStatus?.lastSync)} · ${n} ${market} stocks scored`
                  : hasServerRows
                    ? `🔄 Auto-synced · last sync ${agoLabel(techSyncStatus?.lastSync)} · no ${market} rows in this snapshot`
                    : `⏳ No server rows for ${market} yet — upload a TradingView CSV below, or ↻ re-pull`}
            </span>
            {techSyncStatus && typeof techSyncStatus.okCount === 'number' && (
              <span style={{ fontSize: 11.5, color: MUTED }}>{techSyncStatus.okCount} file{techSyncStatus.okCount !== 1 ? 's' : ''} on server{techSyncStatus.failCount ? ` · ${techSyncStatus.failCount} failed` : ''}</span>
            )}
            <button onClick={() => { handlePullFromServer(); setTimeout(refreshSyncStatus, 1500); }} disabled={techLoading}
              title="Re-pull the latest daily-synced TradingView exports now"
              style={{ marginLeft: 'auto', background: 'transparent', color: col, border: `1px solid ${bd}`, padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: techLoading ? 'wait' : 'pointer' }}>
              {techLoading ? '⏳ Syncing…' : '↻ Re-pull now'}
            </button>
          </div>
        );
      })()}

      {/* zzz146 — INDEPENDENT FILE UPLOAD for Technicals tab (India / USA / mix) */}
      <div style={{ ...cardStyle, background: 'color-mix(in srgb, #22D3EE 5%, transparent)', borderColor: 'color-mix(in srgb, #22D3EE 40%, transparent)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: CYAN }}>📂 UPLOAD TRADINGVIEW CSV(s)</div>
          <span style={{ fontSize: 11.5, color: MUTED, fontStyle: 'italic' }}>Rows auto-routed by Exchange · {market === 'USA' ? 'NYSE/NASDAQ/OTC stay here' : 'NSE/BSE stay here'} · {market === 'USA' ? 'NSE/BSE fan out to India tab' : 'NYSE/NASDAQ/OTC fan out to USA tab'}</span>
        </div>
        <input type="file" multiple accept=".csv,.xlsx,.xls" ref={techFileRef} style={{ display: 'none' }}
          onChange={e => {
            // zzz148 — Clone FileList to Array BEFORE clearing input value, otherwise
            // FileList becomes empty by the time the async handler iterates it.
            if (e.target.files?.length) {
              const files = Array.from(e.target.files);
              e.target.value = '';
              handleTechFiles(files);
            }
          }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <button onClick={() => techFileRef.current?.click()} disabled={techLoading}
            style={{ background: CYAN, color: '#0B1220', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 800, cursor: techLoading ? 'wait' : 'pointer' }}>
            {techLoading ? '⏳ Parsing…' : '📂 Choose CSV files (multi-select OK)'}
          </button>
          {/* zzz154 — Pull latest from server (daily TradingView sync via GitHub Actions) */}
          <button onClick={handlePullFromServer} disabled={techLoading}
            title="Fetch the latest daily-synced TradingView screener exports from the server"
            style={{ background: '#8B5CF6', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 800, cursor: techLoading ? 'wait' : 'pointer' }}>
            🔄 Pull latest from server
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TXT, cursor: 'pointer' }}>
            <input type="checkbox" checked={techAppendMode} onChange={e => setTechAppendMode(e.target.checked)} />
            <span><b>Append mode</b> (uncheck to REPLACE)</span>
          </label>
          {/* zzz149 — Clear button always visible. No fallback exists anymore. */}
          <button
            onClick={() => {
              if (techLocalRows.length > 0) {
                clearTechRows();
              } else {
                setTechUploadMsg('Nothing to clear — already empty.');
                setTimeout(() => setTechUploadMsg(''), 2500);
              }
            }}
            style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444', border: `1px solid rgba(239,68,68,0.3)`, padding: '7px 11px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            🗑 Clear {techLocalRows.length > 0 ? `(${techLocalRows.length} stocks)` : '(empty)'}
          </button>
          {techUploadMsg && (
            <span style={{ background: techUploadMsg.startsWith('✓') ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: techUploadMsg.startsWith('✓') ? '#10B981' : '#EF4444', padding: '6px 11px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
              {techUploadMsg}
            </span>
          )}
        </div>
        {/* zzz214 — stale-file warning: parse YYYY-MM-DD from uploaded filenames */}
        {(() => {
          const stale = techSources.filter(x => {
            const m = x.name.match(/20\d{2}-\d{2}-\d{2}/);
            return m ? (Date.now() - new Date(m[0]).getTime()) / 86400000 > 5 : false;
          });
          if (stale.length === 0) return null;
          return (
            <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, fontSize: 12.5, color: '#FBBF24', fontWeight: 700 }}>
              ⚠️ {stale.length} uploaded file{stale.length > 1 ? 's are' : ' is'} over 5 days old — prices, SMAs and RSI have drifted. Re-export from TradingView or use &quot;Pull latest from server&quot;.
            </div>
          );
        })()}
        {techSources.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {techSources.map((s, i) => (
              <div key={i} title={s.warning || ''} style={{ background: s.warning ? 'rgba(239,68,68,0.08)' : PANEL2, border: `1px solid ${s.warning ? 'rgba(239,68,68,0.3)' : LINE}`, padding: '5px 9px', borderRadius: 5, fontSize: 11, color: TXT, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: MUTED }}>{s.cols}c ·</span>
                <span style={{ fontWeight: 700, color: CYAN }}>{s.rowCount}</span>
                <span style={{ color: MUTED, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                {s.warning && <span style={{ color: '#EF4444' }}>⚠️</span>}
                {(() => {
                  const m = s.name.match(/20\d{2}-\d{2}-\d{2}/);
                  if (!m) return null;
                  const age = Math.floor((Date.now() - new Date(m[0]).getTime()) / 86400000);
                  return <span style={{ color: age > 5 ? '#EF4444' : MUTED, fontWeight: age > 5 ? 800 : 400 }}>· {age}d old</span>;
                })()}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: MUTED, fontStyle: 'italic', marginTop: 4 }}>
            No files uploaded to {market === 'USA' ? 'USA' : 'India'} Technicals yet. Upload any TradingView CSV above — rows auto-route by Exchange field (NYSE/NASDAQ/OTC → USA tab · NSE/BSE → India tab). Single upload populates both tabs.
          </div>
        )}
        {techSources.some(s => s.warning) && (
          <div style={{ fontSize: 11.5, color: '#EF4444', marginTop: 8, padding: 8, background: 'rgba(239,68,68,0.06)', borderRadius: 6 }}>
            ⚠️ Some files have fewer than 60 columns — they're missing key technical fields (SMA, EMA, ATR, Industry). Stocks from those files will show "NO DATA" or be auto-rejected. Re-export from TradingView with the full column set (94 cols is the target — see suggestions block at bottom).
          </div>
        )}
      </div>

      {/* zzz210 — SECTION JUMP BAR (decision-first ordering) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center', margin: '2px 0 16px', padding: '10px 12px', background: '#121821', border: '1px solid #2A3444', borderRadius: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#7B8898', letterSpacing: 0.6, textTransform: 'uppercase', marginRight: 2 }}>Jump to</span>
        {([
          ['#sec-prime', '🎯 Prime'],
          ['#sec-champions', '🏆 Champions'],
          ['#sec-buyzone', '🟢 Buy Zone'],
          ['#sec-earnings', '🗓 Earnings'],
          ['#sec-sepa', '📋 SEPA Score'],
          ...(market === 'IND' ? [['#sec-pockets', '📦 Vol Pockets']] : []),
          ['#sec-export', '📤 Export'],
          ['#sec-momentum', '🚀 Momentum'],
          ['#sec-industry', '🏭 Industry RS'],
          ['#sec-playbooks', '📚 Playbooks'],
          ['#sec-trim', '✂️ Trim'],
          ['#sec-watch', '🔥💰 Watch'],
          ['#sec-all', '🏁 All Tickers'],
        ] as [string, string][]).map(([href, label]) => (
          <a key={href} href={href} style={{ fontSize: 12, fontWeight: 700, color: '#E5ECF4', textDecoration: 'none', background: 'rgba(255,255,255,0.05)', border: '1px solid #1E2632', padding: '5px 11px', borderRadius: 999 }}>
            {label}
          </a>
        ))}
      </div>

      <div id="sec-prime" style={{ scrollMarginTop: 80 }} />
      {/* ADDITIVE (🎯 prime setups) — pinned hero panel: the best eligible names
          resting AT a moving-average pivot (21-EMA / 50-DMA / 89-EMA / 200-DMA),
          intersection of every screener. */}
      {(() => {
        const isMedium = (ma: string) => /89|100/.test(ma);
        // the resolved medium-MA label to show on the chip: real 89-EMA > real 100 > ~100 estimate
        const medLabel = primeSetups.some(x => x.piv.ma === '89-EMA') ? '89-EMA'
          : primeSetups.some(x => x.piv.ma === '100-DMA') ? '100-DMA' : '~100-DMA';
        const isApproxMed = medLabel.startsWith('~');
        const shown = primeSetups.filter(x => pivotFilter === 'ALL' || (pivotFilter === 'MED' ? isMedium(x.piv.ma) : x.piv.ma === pivotFilter)).slice(0, 8);
        const pivotChips: Array<{ v: string; l: string }> = [
          { v: 'ALL', l: 'ALL' }, { v: '21-EMA', l: '21-EMA' }, { v: '50-DMA', l: '50-DMA' },
          { v: 'MED', l: medLabel }, { v: '200-DMA', l: '200-DMA' },
        ];
        return (
      <div style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(16,185,129,0.02) 60%, transparent)', border: '1px solid rgba(16,185,129,0.30)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#10B981', letterSpacing: '0.3px', marginBottom: 4 }}>🎯 PRIME SETUPS — best at a moving-average pivot ({shown.length})</div>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>
          The highest-conviction eligible names resting AT a moving-average pivot — the buyable spot. 21-EMA = tightest (raging trend) · 50-DMA = standard swing · {medLabel} = deeper trend pullback · 200-DMA = deep reclaim. Ranked by how many screeners agree (Champion · Buy Zone · SEPA · Pocket · Momentum · Quality · 🏆 bench · 🚀 radar) × proximity to the line.{isApproxMed ? ' The ~100-DMA is estimated from EMA-50/EMA-200 — add an “EMA 89” or “EMA 100” column to your TradingView export for the exact line.' : ''}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {pivotChips.map(chip => {
            const active = pivotFilter === chip.v;
            return (
              <button key={chip.v} onClick={() => setPivotFilter(chip.v)} title={chip.v === 'MED' && isApproxMed ? 'Estimated ~100-DMA (from EMA-50/EMA-200). Add an EMA 89 or EMA 100 column to your TradingView export for the exact 89/100 line.' : undefined} style={{ fontSize: 11.5, fontWeight: 800, cursor: 'pointer', padding: '4px 11px', borderRadius: 999, border: `1px solid ${active ? '#10B981' : 'rgba(16,185,129,0.35)'}`, background: active ? '#10B981' : 'transparent', color: active ? '#04120C' : '#10B981' }}>
                {chip.l}
              </button>
            );
          })}
        </div>
        {shown.length === 0 ? (
          <div style={{ fontSize: 12.5, color: MUTED, padding: 14, background: PANEL2, borderRadius: 8 }}>No eligible name is resting at a moving-average pivot right now — the leaders are extended; wait for pullbacks.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            {shown.map((item, i) => {
              const atPivot = Math.abs(item.piv.dist) <= 3;
              const distColor = atPivot ? '#10B981' : '#F59E0B';
              const bq = buyability(item.r);
              const er = earningsRisk(item.r);
              return (
                <div key={item.r.symbol} onClick={() => setExpandedSymbol(item.r.symbol)} style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid color-mix(in srgb, #10B981 30%, transparent)', borderLeft: '4px solid #10B981', borderRadius: 10, padding: 13, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: MUTED }}>#{i + 1}</span>
                    <span style={{ fontSize: 18, fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace' }}>{item.r.symbol}{item.onB ? ' 🏆' : ''}{item.onR ? ' 🚀' : ''}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(item.r.price)}</span>
                    <span title={`Distance from the ${item.piv.ma} pivot — the MA the price is resting on`} style={{ fontSize: 11, fontWeight: 800, color: distColor, background: `color-mix(in srgb, ${distColor} 15%, transparent)`, padding: '2px 7px', borderRadius: 5 }}>{atPivot ? '🎯 ' : ''}{item.piv.dist >= 0 ? '+' : ''}{item.piv.dist.toFixed(1)}% ⟂{item.piv.ma}</span>
                    {er ? <span title={`Reports in ${er.days} day(s)${item.r.nextEarnings ? ' ('+item.r.nextEarnings+')' : ''} — event risk. Desks avoid new entries inside this window.`} style={{ fontSize: 10, fontWeight: 800, color: er.color, border: `1px solid ${er.color}55`, borderRadius: 4, padding: '1px 5px' }}>{er.label}</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: TXT, marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.r.company || ''}>
                    {item.r.company || item.r.symbol} <span style={{ color: MUTED, fontSize: 11 }}>· {item.r.sector?.slice(0, 22) || ''}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                    {item.systems.length > 0 ? item.systems.map(s => (
                      <span key={s} style={{ fontSize: 10.5, fontWeight: 700, color: '#F59E0B', background: 'rgba(245,158,11,0.14)', padding: '2px 7px', borderRadius: 4 }}>{s}</span>
                    )) : <span style={{ fontSize: 10.5, color: MUTED, fontStyle: 'italic' }}>single-system pivot</span>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, fontSize: 11, marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>
                    <span style={{ background: 'rgba(255,255,255,0.05)', padding: '3px 7px', borderRadius: 4 }}>TECH {item.r.totalScore}</span>
                    <span style={{ background: 'rgba(255,255,255,0.05)', padding: '3px 7px', borderRadius: 4 }}>FUND {item.r.fundScore}</span>
                    {typeof item.r.perf1w === 'number' ? <span style={{ background: 'rgba(255,255,255,0.05)', padding: '3px 7px', borderRadius: 4 }}>1W {fmtPct(item.r.perf1w)}</span> : null}
                    {typeof item.r.perf1m === 'number' ? <span style={{ background: 'rgba(255,255,255,0.05)', padding: '3px 7px', borderRadius: 4 }}>1M {fmtPct(item.r.perf1m)}</span> : null}
                    {typeof item.r.rsi === 'number' ? <span style={{ background: item.r.rsi > 85 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)', color: item.r.rsi > 85 ? '#EF4444' : TXT, padding: '3px 7px', borderRadius: 4 }}>RSI {item.r.rsi.toFixed(0)}</span> : null}
                  </div>
                  {bq ? <div style={{ fontSize: 12, fontWeight: 800, color: bq.color, marginTop: 4 }} title={bq.title}>{bq.label}</div> : null}
                  {typeof item.r.stopLoss === 'number' ? (
                    <div style={{ fontSize: 11.5, color: '#F59E0B', marginTop: 4, fontWeight: 700 }}>
                      🛑 {fmtPrice(item.r.stopLoss)} <span style={{ color: MUTED, fontWeight: 600 }}>(risk {typeof item.r.stopLossPct === 'number' ? `−${item.r.stopLossPct.toFixed(1)}%` : '−2×ATR'})</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
        );
      })()}

      {/* zzz214 — ⚡ CONFLUENCE strip: stocks flagged by 2+ independent systems */}
      {confluence.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(34,211,238,0.05))', border: '1px solid rgba(245,158,11,0.45)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: '#F59E0B' }}>⚡ CONFLUENCE — flagged by 2+ systems</span>
            <span style={{ fontSize: 12, color: MUTED }}>Champion · Buy Zone · SEPA 7+ · Pocket · Momentum · Quality — the more independent systems agree, the stronger the signal. Click a chip for details.</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {confluence.map(c => (
              <span key={c.symbol}
                onClick={() => { if (techRows.some(r => (r.symbol || '').toUpperCase() === c.symbol)) setExpandedSymbol(c.symbol); }}
                title={c.systems.join(' · ')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: PANEL2, border: `1px solid ${c.n >= 4 ? '#10B981' : c.n === 3 ? '#F59E0B' : LINE}`, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>
                <b style={{ color: TXT, fontSize: 13.5 }}>{c.symbol}</b>
                <span style={{ color: c.n >= 4 ? '#10B981' : c.n === 3 ? '#F59E0B' : CYAN, fontWeight: 900, fontSize: 12.5 }}>×{c.n}</span>
                <span style={{ color: MUTED, fontSize: 10.5 }}>{c.systems.join(' · ')}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ADDITIVE (audit) — 🏆🚀 FUNDAMENTAL CONFLUENCE spotlight. Technical names
          that ALSO sit on the Conviction Bench (🏆) or Transformation Radar (🚀) —
          i.e. a chart breakout backed by an earnings/fundamental inflection. */}
      {(() => {
        const conf = techRows
          .filter(r => onBench(r.symbol) || onRadar(r.symbol))
          .map(r => ({ r, b: onBench(r.symbol), rad: onRadar(r.symbol) }))
          .sort((a, z) => (Number(z.b) + Number(z.rad)) - (Number(a.b) + Number(a.rad)) || (z.r.totalScore || 0) - (a.r.totalScore || 0));
        if (conf.length === 0) return null;
        const both = conf.filter(c => c.b && c.rad).length;
        return (
          <div style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(139,92,246,0.06))', border: '1px solid rgba(16,185,129,0.45)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: '#10B981' }}>🏆🚀 FUNDAMENTAL CONFLUENCE ({conf.length}{both > 0 ? ` · ${both} on both` : ''})</span>
              <span style={{ fontSize: 12, color: MUTED }}>Technical setup + fundamental backing. 🏆 = Conviction Bench · 🚀 = Transformation Radar. These are the highest-quality breakouts. Click a chip for details.</span>
              <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: TXT, cursor: 'pointer' }}>
                <input type="checkbox" checked={confluenceOnly} onChange={e => setConfluenceOnly(e.target.checked)} />
                Filter master table to confluence only
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {conf.slice(0, 60).map(c => (
                <span key={c.r.symbol} onClick={() => setExpandedSymbol(c.r.symbol)}
                  title={`Total ${c.r.totalScore} · Fund ${c.r.fundScore}${c.b && c.rad ? ' · bench + radar' : c.b ? ' · bench' : ' · radar'}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: PANEL2, border: `1px solid ${c.b && c.rad ? '#10B981' : LINE}`, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>
                  <b style={{ color: TXT, fontSize: 13.5 }}>{c.r.symbol}</b>
                  {c.b && <span style={{ fontSize: 12 }}>🏆</span>}
                  {c.rad && <span style={{ fontSize: 12 }}>🚀</span>}
                  <span style={{ color: MUTED, fontSize: 10.5 }}>{c.r.totalScore}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ADDITIVE (audit R3) — O'Neil LEADING GROUPS strip. Where leadership is
          concentrated = where institutional money is flowing. Click a group to
          filter the master table to it; click again (or ✕) to clear. */}
      {leadingGroups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, #F59E0B 7%, transparent)', border: '1px solid color-mix(in srgb, #F59E0B 40%, transparent)' }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: '#F59E0B', whiteSpace: 'nowrap' }}>🔥 Leading groups</span>
          <span style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>(eligible leaders by sector — buy a leader in a leading group)</span>
          {leadingGroups.map(g => {
            const active = groupFilter === g.name;
            return (
              <button key={g.name} onClick={() => setGroupFilter(active ? '' : g.name)}
                title={active ? 'Click to clear filter' : `Filter master table to ${g.name}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: active ? '#F59E0B' : PANEL2, color: active ? '#0B1220' : TXT, border: `1px solid ${active ? '#F59E0B' : LINE}`, padding: '5px 11px', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                <b>{g.name.slice(0, 22)}</b>
                <span style={{ color: active ? '#0B1220' : CYAN, fontWeight: 900 }}>{g.count}</span>
                {typeof g.avgRs === 'number' && <span style={{ color: active ? '#0B1220' : MUTED, fontSize: 10.5 }}>RS {g.avgRs}</span>}
              </button>
            );
          })}
          {groupFilter && (
            <button onClick={() => setGroupFilter('')} style={{ background: 'transparent', color: MUTED, border: `1px solid ${LINE}`, padding: '4px 9px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer' }}>
              ✕ clear · showing {groupFilter.slice(0, 20)} only
            </button>
          )}
        </div>
      )}

      {/* zzz133/zzz208 — DATA QUALITY + ELIGIBILITY summary chips (cleaned) */}
      <div style={{ ...cardStyle, background: 'color-mix(in srgb, #10B981 5%, transparent)', borderColor: 'color-mix(in srgb, #10B981 30%, transparent)', padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#10B981', marginRight: 4 }}>✅ DATA QUALITY &amp; ELIGIBILITY</span>
          <span style={{ background: 'rgba(255,255,255,0.06)', padding: '4px 11px', borderRadius: 6, fontSize: 12.5, color: TXT }}>Total <b>{dataQuality.total}</b></span>
          <span style={{ background: 'rgba(16,185,129,0.18)', padding: '4px 11px', borderRadius: 6, fontSize: 12.5, color: '#10B981' }}>✓ eligible <b>{techRows.filter(r => r.eligible).length}</b></span>
          <span style={{ background: 'rgba(239,68,68,0.12)', padding: '4px 11px', borderRadius: 6, fontSize: 12.5, color: '#EF4444' }}>✗ rejected <b>{rejected.length}</b></span>
          <span style={{ background: 'rgba(251,191,36,0.15)', padding: '4px 11px', borderRadius: 6, fontSize: 12.5, color: '#FBBF24' }}>🗓 earnings soon <b>{earningsSoon.length}</b></span>
          <span style={{ background: 'rgba(255,255,255,0.06)', padding: '4px 11px', borderRadius: 6, fontSize: 12.5, color: TXT }}>SMA cov <b>{dataQuality.withSMA}/{dataQuality.total}</b></span>
          <span style={{ background: 'rgba(255,255,255,0.06)', padding: '4px 11px', borderRadius: 6, fontSize: 12.5, color: TXT }}>ATR cov <b>{dataQuality.withATR}/{dataQuality.total}</b></span>
          <span style={{ background: 'rgba(239,68,68,0.12)', padding: '4px 11px', borderRadius: 6, fontSize: 12.5, color: '#EF4444' }}>⚠️ flagged <b>{dataQuality.flagged}</b></span>
        </div>
        {/* zzz208 — 5-layer engine rendered as 5 tidy cards instead of one dense paragraph */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 8, marginTop: 12 }}>
          {[
            ['1 · HARD FILTERS', 'Liquidity ≥ 200k vol / $5M $-vol · price > SMA50 · RSI < 90 · no extreme extension.'],
            ['2 · EARNINGS WINDOW', 'Block entries within 3 days of earnings · tag within 14 days.'],
            ['3 · TECH SCORE', '0.35×Minervini + 0.30×Qulla + 0.20×Bonde + 0.15×Zanger (weighted, not averaged).'],
            ['4 · FUND SCORE', 'Revenue Q YoY weighted above EPS (harder to manipulate) · R40 · FCF margin · ROE · leverage · float · analyst rating.'],
            ['5 · BUCKETS', '🏆 Champions · 🟢 Buy Zone · 🔥 Tech-only · 💰 Quality on Sale · 🗓 Earnings Soon · 🚫 Rejected.'],
          ].map(([t, d]) => (
            <div key={t} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(16,185,129,0.18)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#10B981', letterSpacing: 0.5 }}>{t}</div>
              <div style={{ fontSize: 12, color: TXT, marginTop: 4, lineHeight: 1.55 }}>{d}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>
          💡 Click any ticker card or table row to open the full detail modal — technicals + fundamentals + playbook reasons + position sizing.
        </div>
      </div>

      <div id="sec-champions" style={{ scrollMarginTop: 80 }} />
      {/* zzz133 — 🏆 CHAMPIONS — Technically + Fundamentally elite */}
      <div style={{ ...cardStyle, background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(34,211,238,0.05))', borderColor: '#10B981', borderWidth: 2 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 20, color: '#10B981', fontWeight: 900, letterSpacing: '0.3px' }}>🏆 CHAMPIONS — TECH + FUNDAMENTAL ELITE ({champions.length})</div>
          {/* ADDITIVE (audit R3) — Buyable-only toggle: hide extended names (chasing = poor R/R). */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: TXT, cursor: 'pointer' }}>
            <input type="checkbox" checked={buyableOnly} onChange={e => setBuyableOnly(e.target.checked)} />
            🎯 Buyable only <span style={{ color: MUTED }}>(hide extended)</span>
          </label>
          {/* ADDITIVE (earnings-risk guard) — drop names reporting within 7 days. */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: TXT, cursor: 'pointer' }}>
            <input type="checkbox" checked={hideEarningsRisk} onChange={e => setHideEarningsRisk(e.target.checked)} />
            🛡 Hide reporting ≤7d <span style={{ color: MUTED }}>(event risk)</span>
          </label>
          <div style={{ fontSize: 12, color: MUTED, fontStyle: 'italic', flexBasis: '100%' }}>Eligible + BUY ZONE or EXTENDED (never CHASE) + tech ≥ 45 + fund ≥ 40 + positive 1M + no falling knife. 🎯 Buyable = within ~5% of 21-EMA pivot; ⏳/🚫 = extended, wait for pullback.</div>
        </div>
        {champions.length === 0 ? (
          <div style={{ fontSize: 13, color: MUTED, padding: 14, background: PANEL2, borderRadius: 8 }}>
            No Champions today. Either market is extended (most strong names beyond buy zone) or fundamentals are weak across BUY ZONE candidates. Check 🟢 BUY ZONE for tech-only setups and 💰 QUALITY ON SALE for fund-only opportunities.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            {champions.filter(r => !buyableOnly || (buyability(r)?.buyable ?? true)).filter(r => { const er = earningsRisk(r); return !hideEarningsRisk || !er || er.days > 7; }).map(r => (
              <div key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ background: 'rgba(16,185,129,0.08)', border: '2px solid #10B981', borderRadius: 10, padding: 14, boxShadow: '0 0 0 1px rgba(16,185,129,0.1)', cursor: 'pointer', position: 'relative', overflow: 'hidden', minWidth: 0 }}>
                <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>
                  <NewSeenCheckbox isNew={techNewSet.has(r.symbol)} isAcked={techAckSet.has(r.symbol)} onToggle={() => toggleTechAck(r.symbol)} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, rowGap: 4, marginBottom: 6, flexWrap: 'wrap', paddingRight: 22, minWidth: 0 }}>
                  <span style={{ fontSize: 20, fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace' }}>{r.symbol}</span>{symBadges(r.symbol)}
                  <span style={{ fontSize: 15, fontWeight: 800, color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(r.price)}</span>
                  {(() => { const bq = buyability(r); return bq ? <span title={bq.title} style={{ fontSize: 11, fontWeight: 800, color: bq.color, background: `color-mix(in srgb, ${bq.color} 15%, transparent)`, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>{bq.label}</span> : null; })()}
                  {(() => { const er = earningsRisk(r); return er ? <span title={`Reports in ${er.days} day(s)${r.nextEarnings ? ' ('+r.nextEarnings+')' : ''} — event risk. Desks avoid new entries inside this window.`} style={{ fontSize: 10, fontWeight: 800, color: er.color, border: `1px solid ${er.color}55`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>{er.label}</span> : null; })()}
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: MUTED }}>TECH</span>
                    <span style={{ fontSize: 22, fontWeight: 900, color: '#10B981' }}>{r.totalScore}</span>
                    <span style={{ fontSize: 12, color: MUTED }}>FUND</span>
                    <span style={{ fontSize: 22, fontWeight: 900, color: '#84CC16' }}>{r.fundScore}</span>
                  </span>
                </div>
                <div style={{ fontSize: 13, color: TXT, marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.company || ''}>
                  {r.company || r.symbol} <span style={{ color: MUTED, fontSize: 11 }}>· {r.sector?.slice(0, 22) || ''}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 8, fontSize: 11 }}>
                  <div style={{ background: 'rgba(34,211,238,0.12)', padding: 6, borderRadius: 5, textAlign: 'center' }}>
                    <div style={{ color: MUTED, fontSize: 9 }}>QULLA</div>
                    <div style={{ color: scoreColor(r.qullaScore), fontWeight: 800, fontSize: 14 }}>{r.qullaScore}</div>
                  </div>
                  <div style={{ background: 'rgba(167,139,250,0.12)', padding: 6, borderRadius: 5, textAlign: 'center' }}>
                    <div style={{ color: MUTED, fontSize: 9 }}>ZANGER</div>
                    <div style={{ color: scoreColor(r.zangerScore), fontWeight: 800, fontSize: 14 }}>{r.zangerScore}</div>
                  </div>
                  <div style={{ background: 'rgba(251,191,36,0.12)', padding: 6, borderRadius: 5, textAlign: 'center' }}>
                    <div style={{ color: MUTED, fontSize: 9 }}>BONDE</div>
                    <div style={{ color: scoreColor(r.bondeScore), fontWeight: 800, fontSize: 14 }}>{r.bondeScore}</div>
                  </div>
                  <div style={{ background: 'rgba(132,204,22,0.12)', padding: 6, borderRadius: 5, textAlign: 'center' }}>
                    <div style={{ color: MUTED, fontSize: 9 }}>MINER</div>
                    <div style={{ color: scoreColor(r.minerviniScore), fontWeight: 800, fontSize: 14 }}>{r.minerviniScore}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, fontSize: 11, marginBottom: 6 }}>
                  {typeof r.perf1w === 'number' ? <span style={{ background: 'rgba(255,255,255,0.05)', padding: '3px 7px', borderRadius: 4 }}>1W {fmtPct(r.perf1w)}</span> : null}
                  {typeof r.perf1m === 'number' ? <span style={{ background: 'rgba(255,255,255,0.05)', padding: '3px 7px', borderRadius: 4 }}>1M {fmtPct(r.perf1m)}</span> : null}
                  {r.volumeBurst === true && typeof r.relVol1w === 'number' ? <span style={{ background: 'rgba(16,185,129,0.18)', color: '#10B981', padding: '3px 7px', borderRadius: 4, fontWeight: 700 }}>Vol {r.relVol1w.toFixed(1)}× 🔥</span> : null}
                  {typeof r.rsi === 'number' ? <span style={{ background: 'rgba(255,255,255,0.05)', padding: '3px 7px', borderRadius: 4 }}>RSI {r.rsi.toFixed(0)}</span> : null}
                  {/* ADDITIVE (audit R2) — O'Neil/Minervini leadership signals on leaders:
                      Composite RS rank + proximity to 52w high (the breakout pivot). */}
                  {typeof r.compositeRs === 'number' ? <span title="Composite Relative-Strength rank vs universe (Minervini SEPA wants ≥80)" style={{ background: r.compositeRs >= 80 ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.05)', color: r.compositeRs >= 80 ? '#10B981' : TXT, padding: '3px 7px', borderRadius: 4, fontWeight: 700 }}>RS {r.compositeRs}{r.compositeRs >= 90 ? ' 🔥' : ''}</span> : null}
                  {typeof r.distFromHigh === 'number' ? <span title="Distance below 52-week high — the breakout pivot. Minervini buys within 25%." style={{ background: r.distFromHigh >= -5 ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.05)', color: r.distFromHigh >= -5 ? '#10B981' : TXT, padding: '3px 7px', borderRadius: 4, fontWeight: 700 }}>{r.distFromHigh >= -1 ? '≈52wH 🎯' : `${r.distFromHigh.toFixed(0)}% ← 52wH`}</span> : null}
                  {typeof r.revGrowthQtr === 'number' ? <span style={{ background: 'rgba(132,204,22,0.15)', color: '#84CC16', padding: '3px 7px', borderRadius: 4, fontWeight: 700 }}>Rev {fmtPct(r.revGrowthQtr)}</span> : null}
                  {typeof r.epsGrowthTTM === 'number' ? <span style={{ background: 'rgba(132,204,22,0.15)', color: '#84CC16', padding: '3px 7px', borderRadius: 4, fontWeight: 700 }}>EPS {fmtPct(r.epsGrowthTTM)}</span> : null}
                </div>
                {r.fundReasons.length > 0 ? (
                  <div style={{ fontSize: 10.5, color: '#84CC16', lineHeight: 1.5, marginBottom: 4 }}>
                    💎 {r.fundReasons.slice(0, 4).join(' · ')}
                  </div>
                ) : null}
                {/* zzz160 — ✅ (green) only for BUY ZONE; ⏳ (amber) for EXTENDED. Contradictory
                    to show green checkmark next to "wait for pullback to SMA50". */}
                <div style={{ fontSize: 12, color: r.rightEntry === 'BUY ZONE' ? '#10B981' : '#F59E0B', fontWeight: 800, marginTop: 6 }}>
                  {r.rightEntry === 'BUY ZONE' ? '✅' : '⏳'} {r.rightEntryDetail}
                </div>
                {typeof r.stopLoss === 'number' ? (
                  <div style={{ fontSize: 11.5, color: '#F59E0B', marginTop: 4, fontWeight: 700 }}>
                    🛑 STOP {fmtPrice(r.stopLoss)} <span style={{ color: MUTED, fontWeight: 600 }}>(risk {typeof r.stopLossPct === 'number' ? `−${r.stopLossPct.toFixed(1)}%` : '−2×ATR'})</span>
                  </div>
                ) : null}
                {r.eligibilityTags.includes('EARNINGS_SOON') && typeof r.daysToEarnings === 'number' ? (
                  <div style={{ fontSize: 11, color: '#FBBF24', marginTop: 4, fontWeight: 700 }}>🗓️ Earnings in {r.daysToEarnings}d</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="sec-buyzone" style={{ scrollMarginTop: 80 }} />
      {/* 🎯 RIGHT ENTRY — BUY ZONE leaderboard — broader list */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 17, color: '#10B981', fontWeight: 900, letterSpacing: '0.3px' }}>🟢 BUY ZONE — POSITION ENTRIES ({buyZone.length})</div>
          <div style={{ fontSize: 12, color: MUTED, fontStyle: 'italic' }}>0% to max(7%, 2×ADR%) above SMA50 — ADR-adaptive ceiling · positive 1M momentum required</div>
        </div>
        {buyZone.length === 0 ? (
          <div style={{ fontSize: 12.5, color: MUTED, padding: 14, background: PANEL2, borderRadius: 8 }}>No tickers in the BUY ZONE right now. Most names are either extended or below their SMA50.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10 }}>
            {buyZone.filter(r => !buyableOnly || (buyability(r)?.buyable ?? true)).filter(r => { const er = earningsRisk(r); return !hideEarningsRisk || !er || er.days > 7; }).map(r => (
              <div key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ background: PANEL2, border: '1px solid color-mix(in srgb, #10B981 35%, transparent)', borderLeft: '4px solid #10B981', borderRadius: 8, padding: 11, cursor: 'pointer', overflow: 'hidden', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, rowGap: 3, flexWrap: 'wrap', minWidth: 0 }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace' }}>{r.symbol}</span>{symBadges(r.symbol)}
                  <span style={{ fontSize: 13, fontWeight: 700, color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(r.price)}</span>
                  {(() => { const bq = buyability(r); return bq ? <span title={bq.title} style={{ fontSize: 10, fontWeight: 800, color: bq.color, whiteSpace: 'nowrap' }}>{bq.label}</span> : null; })()}
                  {(() => { const er = earningsRisk(r); return er ? <span title={`Reports in ${er.days} day(s)${r.nextEarnings ? ' ('+r.nextEarnings+')' : ''} — event risk. Desks avoid new entries inside this window.`} style={{ fontSize: 10, fontWeight: 800, color: er.color, border: `1px solid ${er.color}55`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>{er.label}</span> : null; })()}
                  <span style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 900, color: scoreColor(r.totalScore), flexShrink: 0 }}>{r.totalScore}</span>
                </div>
                <div style={{ fontSize: 11.5, color: TXT, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.company || ''}</div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {typeof r.perf1w === 'number' ? <span>1W {fmtPct(r.perf1w)}</span> : null}
                  {typeof r.perf1m === 'number' ? <span>1M {fmtPct(r.perf1m)}</span> : null}
                  {typeof r.adrPct === 'number' ? <span>ADR {r.adrPct.toFixed(1)}%</span> : null}
                  {r.volumeBurst === true && typeof r.relVol1w === 'number' ? <span style={{ color: '#10B981', fontWeight: 700 }}>Vol {r.relVol1w.toFixed(1)}×🔥</span> : null}
                  {typeof r.rsi === 'number' ? <span style={{ color: r.rsi > 85 ? '#EF4444' : MUTED }}>RSI {r.rsi.toFixed(0)}</span> : null}
                </div>
                <div style={{ fontSize: 10.5, color: '#10B981', marginTop: 5, fontWeight: 700 }}>
                  {r.rightEntryDetail}
                </div>
                {typeof r.stopLoss === 'number' ? (
                  <div style={{ fontSize: 10.5, color: '#F59E0B', marginTop: 3, fontWeight: 700 }}>
                    🛑 {fmtPrice(r.stopLoss)} <span style={{ color: MUTED, fontWeight: 600 }}>({typeof r.stopLossPct === 'number' ? `−${r.stopLossPct.toFixed(1)}%` : '−2×ATR'})</span>
                  </div>
                ) : null}
                {r.qualityFlags && r.qualityFlags.length > 0 ? (
                  <div style={{ fontSize: 10, color: '#EF4444', marginTop: 3, fontWeight: 700 }}>⚠️ {r.qualityFlags.join(' · ')}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="sec-earnings" style={{ scrollMarginTop: 80 }} />
      {/* zzz133 — EARNINGS SOON event-driven bucket */}
      {earningsSoon.length > 0 && (
        <div style={{ ...cardStyle, background: 'color-mix(in srgb, #FBBF24 5%, transparent)', borderColor: 'color-mix(in srgb, #FBBF24 40%, transparent)' }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#FBBF24', marginBottom: 10 }}>🗓️ EARNINGS SOON ({earningsSoon.length}) — Event-driven bucket</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>Stocks reporting within 14 days. Excluded from normal BUY ZONE due to event risk. Bonde EP often fires AT earnings — watch for post-earnings drift entries.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {earningsSoon.map(r => (
              <div key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ background: PANEL2, border: '1px solid color-mix(in srgb, #FBBF24 30%, transparent)', borderLeft: `4px solid ${(r.daysToEarnings ?? 99) <= 3 ? '#EF4444' : '#FBBF24'}`, borderRadius: 6, padding: 10, cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace' }}>{r.symbol}</span>
                  <span style={{ color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(r.price)}</span>
                  <span style={{ marginLeft: 'auto', textAlign: 'right', color: (r.daysToEarnings ?? 99) <= 3 ? '#EF4444' : '#FBBF24', fontWeight: 800 }}>
                    {r.daysToEarnings}d
                    {/* zzz216 — show the actual earnings date, not just the countdown */}
                    {r.nextEarnings && (
                      <span style={{ display: 'block', fontSize: 10.5, color: TXT, fontWeight: 700 }}>
                        {new Date(r.nextEarnings).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: TXT, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.company}</div>
                <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>
                  Tech {r.totalScore} · Fund {r.fundScore} · 1M {fmtPct(r.perf1m)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div id="sec-sepa" style={{ scrollMarginTop: 80 }} />
      {/* zzz203: SEPA CHECKLIST PANEL — Winning Playbook overlay */}
      <SepaChecklistPanel techRows={techRows} onOpen={(sym) => setExpandedSymbol(sym)} onBest={(l) => { if (l.join(',') !== sepaBestRef.current.join(',')) { sepaBestRef.current = l; setBestTick(t => t + 1); } }} />

      {/* zzz207: VOLUME POCKETS (Screener.in) — India tab only */}
      {market === 'IND' && <><div id="sec-pockets" style={{ scrollMarginTop: 80 }} /><VolumePocketsPanel techRows={techRows} onOpen={(sym) => setExpandedSymbol(sym)} onBest={(l) => { if (l.join(',') !== pocketsBestRef.current.join(',')) { pocketsBestRef.current = l; setBestTick(t => t + 1); } }} /></>}

      <div id="sec-export" style={{ scrollMarginTop: 80 }} />
      {/* zzz142 — EXPORT BEST PICKS to TradingView / Excel / clipboard */}
      <div style={{ ...cardStyle, background: 'color-mix(in srgb, #22D3EE 5%, transparent)', borderColor: 'color-mix(in srgb, #22D3EE 30%, transparent)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: CYAN }}>📤 EXPORT BEST PICKS</div>
          <span style={{ background: 'rgba(34,211,238,0.15)', padding: '4px 9px', borderRadius: 6, fontSize: 12, color: CYAN, fontWeight: 700 }}>
            {bestPicks.length} curated picks
          </span>
          {(() => {
            const elite = bestPicks.filter(p => p._tier === 'ELITE').length;
            const strong = bestPicks.filter(p => p._tier === 'STRONG').length;
            const momentum = bestPicks.filter(p => p._tier === 'MOMENTUM').length;
            const quality = bestPicks.filter(p => p._tier === 'QUALITY').length;
            return (<>
              {elite > 0 && <span style={{ background: 'rgba(16,185,129,0.15)', padding: '3px 8px', borderRadius: 5, fontSize: 11, color: '#10B981', fontWeight: 700 }}>🏆 Elite {elite}</span>}
              {strong > 0 && <span style={{ background: 'rgba(16,185,129,0.12)', padding: '3px 8px', borderRadius: 5, fontSize: 11, color: '#10B981', fontWeight: 600 }}>🟢 Strong {strong}</span>}
              {momentum > 0 && <span style={{ background: 'rgba(34,211,238,0.12)', padding: '3px 8px', borderRadius: 5, fontSize: 11, color: CYAN, fontWeight: 600 }}>🔥 Momentum {momentum}</span>}
              {quality > 0 && <span style={{ background: 'rgba(132,204,22,0.12)', padding: '3px 8px', borderRadius: 5, fontSize: 11, color: '#84CC16', fontWeight: 600 }}>💰 Quality {quality}</span>}
            </>);
          })()}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED, fontStyle: 'italic' }}>
            Only Champions + strict BUY ZONE + top-RS momentum + Quality-on-Sale. Bad stocks (rejected, parabolic, earnings ≤ 3d) excluded.
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button onClick={() => copyToClipboard(formatForTV(bestPicks), 'TradingView format (with section headers)')}
            disabled={bestPicks.length === 0}
            style={{ background: bestPicks.length ? '#22D3EE' : '#1A2540', color: bestPicks.length ? '#0B1220' : MUTED, border: 'none', padding: '7px 13px', borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: bestPicks.length ? 'pointer' : 'not-allowed' }}>
            📋 Copy for TradingView (with sections)
          </button>
          <button onClick={() => copyToClipboard(formatPlain(bestPicks), 'plain ticker list')}
            disabled={bestPicks.length === 0}
            style={{ background: PANEL2, color: TXT, border: `1px solid ${LINE}`, padding: '7px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: bestPicks.length ? 'pointer' : 'not-allowed' }}>
            Copy comma list
          </button>
          <button onClick={() => downloadFile(formatPlainNewline(bestPicks), `mc-best-picks-${new Date().toISOString().slice(0,10)}.txt`)}
            disabled={bestPicks.length === 0}
            style={{ background: PANEL2, color: TXT, border: `1px solid ${LINE}`, padding: '7px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: bestPicks.length ? 'pointer' : 'not-allowed' }}>
            ⬇ Download .txt
          </button>
          <button onClick={() => downloadFile(formatCsv(bestPicks), `mc-best-picks-${new Date().toISOString().slice(0,10)}.csv`, 'text/csv')}
            disabled={bestPicks.length === 0}
            style={{ background: PANEL2, color: TXT, border: `1px solid ${LINE}`, padding: '7px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: bestPicks.length ? 'pointer' : 'not-allowed' }}>
            ⬇ Download CSV (full data)
          </button>
          {/* Per-tier quick copy */}
          {(() => {
            const tierKeys: BestPick['_tier'][] = ['ELITE', 'STRONG', 'MOMENTUM', 'QUALITY'];
            const labels = { ELITE: '🏆 Elite', STRONG: '🟢 Strong', MOMENTUM: '🔥 Momentum', QUALITY: '💰 Quality' };
            return tierKeys.filter(t => bestPicks.some(p => p._tier === t)).map(t => {
              const subset = bestPicks.filter(p => p._tier === t);
              return (
                <button key={t} onClick={() => copyToClipboard(formatPlain(subset), `${labels[t]} (${subset.length})`)}
                  style={{ background: 'transparent', border: `1px solid ${LINE}`, color: TXT, padding: '7px 11px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                  Copy {labels[t]} <span style={{ color: MUTED, fontWeight: 500 }}>({subset.length})</span>
                </button>
              );
            });
          })()}
          {copyToast && (
            <span style={{ background: copyToast.startsWith('✓') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: copyToast.startsWith('✓') ? '#10B981' : '#EF4444', padding: '7px 11px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
              {copyToast}
            </span>
          )}
        </div>

        {/* Show the list */}
        {bestPicks.length === 0 ? (
          <div style={{ fontSize: 12, color: MUTED, padding: 10, background: PANEL2, borderRadius: 6, marginTop: 10 }}>
            No best picks today — try uploading a fresh CSV, or scan the BUY ZONE / Quality on Sale sections below for B-tier setups.
          </div>
        ) : (
          <div style={{ marginTop: 10, padding: 10, background: PANEL2, borderRadius: 6, fontSize: 11, color: TXT, fontFamily: 'ui-monospace, monospace', lineHeight: 1.8, maxHeight: 110, overflowY: 'auto' }}>
            {bestPicks.map(p => {
              const tierColor = p._tier === 'ELITE' ? '#10B981' : p._tier === 'STRONG' ? '#22D3EE' : p._tier === 'MOMENTUM' ? '#FBBF24' : '#84CC16';
              return (
                <span key={p.symbol} onClick={() => setExpandedSymbol(p.symbol)} style={{ display: 'inline-block', marginRight: 8, padding: '2px 6px', background: 'rgba(255,255,255,0.04)', borderRadius: 4, borderLeft: `2px solid ${tierColor}`, cursor: 'pointer' }}>
                  <b style={{ color: CYAN }}>{p.symbol}</b>{symBadges(p.symbol)} <span style={{ color: tierColor, fontSize: 10 }}>{p._tier[0]}</span> <span style={{ color: MUTED, fontSize: 10 }}>{p.totalScore}/{p.fundScore}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* zzz135 — POSITION SIZING calculator (per-trade risk model) */}
      <div style={{ ...cardStyle, background: 'color-mix(in srgb, #F59E0B 5%, transparent)', borderColor: 'color-mix(in srgb, #F59E0B 30%, transparent)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#F59E0B' }}>💼 POSITION SIZING (per-trade risk)</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TXT }}>
            <span style={{ color: MUTED }}>Portfolio $</span>
            <input type="text" inputMode="numeric" value={portfolioInput} onChange={(e) => setPortfolioInput(e.target.value)} onBlur={() => { if (!portfolioInput.trim()) setPortfolioInput('52000'); }} placeholder="52000" style={{ width: 130, padding: '5px 8px', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 5, color: TXT, fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TXT }}>
            <span style={{ color: MUTED }}>Risk per trade %</span>
            <input type="text" inputMode="decimal" value={riskPctInput} onChange={(e) => setRiskPctInput(e.target.value)} onBlur={() => { if (!riskPctInput.trim()) setRiskPctInput('1'); }} placeholder="1" style={{ width: 70, padding: '5px 8px', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 5, color: TXT, fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
          </label>
          <span style={{ background: 'rgba(245,158,11,0.15)', padding: '4px 10px', borderRadius: 6, fontSize: 12, color: '#F59E0B', fontWeight: 700 }}>
            $ at risk per trade: <b>${(portfolioSize * riskPct / 100).toLocaleString(undefined, {maximumFractionDigits: 0})}</b>
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED, fontStyle: 'italic' }}>
            Shares = $-risk ÷ (price − stop) · shown on every detail page
          </span>
        </div>

        {/* zzz137 — INLINE P/L CALCULATOR */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid rgba(245,158,11,0.15)`, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#10B981' }}>📊 P/L CALC</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: TXT }}>
            <span style={{ color: MUTED }}>Entry $</span>
            <input type="text" inputMode="decimal" value={plEntry} onChange={(e) => setPlEntry(e.target.value)} placeholder="100" style={{ width: 75, padding: '4px 7px', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 5, color: TXT, fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: TXT }}>
            <span style={{ color: MUTED }}>Qty</span>
            <input type="text" inputMode="numeric" value={plQty} onChange={(e) => setPlQty(e.target.value)} placeholder="100" style={{ width: 65, padding: '4px 7px', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 5, color: TXT, fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: TXT }}>
            <span style={{ color: '#EF4444' }}>Stop $</span>
            <input type="text" inputMode="decimal" value={plStop} onChange={(e) => setPlStop(e.target.value)} placeholder="92" style={{ width: 75, padding: '4px 7px', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 5, color: TXT, fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: TXT }}>
            <span style={{ color: '#10B981' }}>Target $</span>
            <input type="text" inputMode="decimal" value={plTarget} onChange={(e) => setPlTarget(e.target.value)} placeholder="120" style={{ width: 75, padding: '4px 7px', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 5, color: TXT, fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
          </label>
          {plCalc && (
            <>
              <span style={{ background: 'rgba(255,255,255,0.06)', padding: '4px 9px', borderRadius: 6, fontSize: 11.5, color: TXT }}>
                Capital: <b style={{ fontFamily: 'ui-monospace, monospace' }}>${plCalc.capital.toLocaleString(undefined, {maximumFractionDigits: 0})}</b>
              </span>
              {plCalc.lossAmt !== null && plCalc.lossPct !== null && (
                <span style={{ background: 'rgba(239,68,68,0.15)', padding: '4px 9px', borderRadius: 6, fontSize: 11.5, color: '#EF4444', fontWeight: 700 }}>
                  🛑 LOSS: <b style={{ fontFamily: 'ui-monospace, monospace' }}>${plCalc.lossAmt.toLocaleString(undefined, {maximumFractionDigits: 0})}</b> <span style={{ fontWeight: 500 }}>({plCalc.lossPct.toFixed(2)}%)</span>
                </span>
              )}
              {plCalc.profitAmt !== null && plCalc.profitPct !== null && (
                <span style={{ background: 'rgba(16,185,129,0.15)', padding: '4px 9px', borderRadius: 6, fontSize: 11.5, color: '#10B981', fontWeight: 700 }}>
                  🎯 PROFIT: <b style={{ fontFamily: 'ui-monospace, monospace' }}>+${plCalc.profitAmt.toLocaleString(undefined, {maximumFractionDigits: 0})}</b> <span style={{ fontWeight: 500 }}>(+{plCalc.profitPct.toFixed(2)}%)</span>
                </span>
              )}
              {plCalc.rr !== null && (
                <span style={{ background: plCalc.rr >= 3 ? 'rgba(16,185,129,0.18)' : plCalc.rr >= 2 ? 'rgba(245,158,11,0.18)' : 'rgba(239,68,68,0.18)', padding: '4px 9px', borderRadius: 6, fontSize: 11.5, color: plCalc.rr >= 3 ? '#10B981' : plCalc.rr >= 2 ? '#F59E0B' : '#EF4444', fontWeight: 800 }}>
                  R:R <b style={{ fontFamily: 'ui-monospace, monospace' }}>{plCalc.rr.toFixed(2)}×</b> {plCalc.rr >= 3 ? '✅' : plCalc.rr >= 2 ? '👍' : '⚠️'}
                </span>
              )}
              <button onClick={() => { setPlEntry(''); setPlQty(''); setPlStop(''); setPlTarget(''); }} style={{ background: 'transparent', border: `1px solid ${LINE}`, color: MUTED, fontSize: 11, padding: '4px 9px', borderRadius: 5, cursor: 'pointer' }}>Clear</button>
            </>
          )}
          {!plCalc && (
            <span style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>Fill Entry + Qty + (Stop and/or Target) to compute P/L instantly</span>
          )}
        </div>
      </div>

      <div id="sec-momentum" style={{ scrollMarginTop: 80 }} />
      {/* zzz132 — QULLA 1M LEADERS — pure momentum leaderboard */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 16, color: CYAN, fontWeight: 900 }}>🚀 QULLAMAGGIE 1M LEADERS — pure momentum board ({qulla1MLeaders.length})</div>
          <div style={{ fontSize: 12, color: MUTED, fontStyle: 'italic' }}>Top 1M performers ≥ 15% · the actual screen Kris Kullamäki uses · entry status shown</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: PANEL2, color: MUTED, fontSize: 11 }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>#</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>TICKER</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>CMP</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>1W%</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>1M%</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>3M%</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>ADR</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>RelVol</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>%SMA50</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>ENTRY</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>QULLA</th>
              </tr>
            </thead>
            <tbody>
              {qulla1MLeaders.map((r, i) => (
                <tr key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ borderBottom: `1px solid ${LINE}`, cursor: 'pointer' }}>
                  <td style={{ padding: '7px 10px', color: MUTED, fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ padding: '7px 10px', fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace' }}>{r.symbol}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(r.price)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: typeof r.perf1w === 'number' && r.perf1w > 0 ? '#10B981' : TXT }}>{fmtPct(r.perf1w)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: '#10B981', fontWeight: 800 }}>{fmtPct(r.perf1m)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: TXT }}>{fmtPct(r.perf3m)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: typeof r.adrPct === 'number' && r.adrPct >= 4 && r.adrPct <= 7 ? '#10B981' : TXT }}>{typeof r.adrPct === 'number' ? `${r.adrPct.toFixed(1)}%` : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: r.volumeBurst === true ? '#10B981' : TXT, fontWeight: r.volumeBurst === true ? 700 : 400 }}>{typeof r.relVol1w === 'number' ? `${r.relVol1w.toFixed(1)}×` : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: TXT }}>{typeof r.pctVsSma50 === 'number' ? fmtPct(r.pctVsSma50) : fmtPct(r.pctVsEma50)}</td>
                  <td style={{ padding: '7px 10px', color: entryColor(r.rightEntry), fontWeight: 800, fontSize: 11 }}>{r.rightEntry}{(() => { const er = earningsRisk(r); return er ? <span title={`Reports in ${er.days} day(s)${r.nextEarnings ? ' ('+r.nextEarnings+')' : ''} — event risk. Desks avoid new entries inside this window.`} style={{ fontSize: 10, fontWeight: 800, color: er.color, border: `1px solid ${er.color}55`, borderRadius: 4, padding: '1px 5px', marginLeft: 6, whiteSpace: 'nowrap' }}>{er.label}</span> : null; })()}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 900, color: scoreColor(r.qullaScore) }}>{r.qullaScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div id="sec-industry" style={{ scrollMarginTop: 80 }} />
      {/* zzz140 — INDUSTRY RS LEADERBOARD */}
      {industryLeaderboard.length >= 2 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 16, color: '#84CC16', fontWeight: 900 }}>🏭 INDUSTRY RS LEADERBOARD ({industryLeaderboard.length})</div>
            <div style={{ fontSize: 12, color: MUTED, fontStyle: 'italic' }}>Industries ranked by median composite RS · institutions buy groups, not isolated stocks</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: PANEL2, color: MUTED, fontSize: 11 }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>#</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>INDUSTRY</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Med RS</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>RANK</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>STOCKS</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>TOP TICKERS</th>
                </tr>
              </thead>
              <tbody>
                {industryLeaderboard.slice(0, 25).map((row, i) => (
                  <tr key={row.industry} style={{ borderBottom: `1px solid ${LINE}` }}>
                    <td style={{ padding: '7px 10px', color: MUTED, fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ padding: '7px 10px', fontWeight: 700, color: TXT }}>{row.industry}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 800, color: row.medianRs >= 80 ? '#10B981' : row.medianRs >= 60 ? CYAN : row.medianRs >= 40 ? '#FBBF24' : MUTED, fontFamily: 'ui-monospace, monospace' }}>{row.medianRs.toFixed(0)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: row.rank >= 80 ? '#10B981' : row.rank >= 60 ? CYAN : row.rank >= 40 ? '#FBBF24' : MUTED, fontFamily: 'ui-monospace, monospace' }}>{row.rank}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: TXT, fontFamily: 'ui-monospace, monospace' }}>{row.count}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11.5, color: CYAN, fontFamily: 'ui-monospace, monospace' }}>{row.topTickers.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div id="sec-playbooks" style={{ scrollMarginTop: 80 }} />
      {/* QULLAMAGGIE */}
      {renderPlaybookSection('Qullamaggie — Episodic Momentum Leaders', '#22D3EE', '🔥', qullaTop, 'qullaScore', 'qullaReasons',
        '1M ≥ 15% gainer · ADR 4–7% sweet spot · not extended (≤ 15% above SMA50) · small-mid cap')}

      {/* ZANGER HTF */}
      {renderPlaybookSection('Dan Zanger — High Tight Flag (HTF)', '#A78BFA', '🚀', zangerTop, 'zangerScore', 'zangerReasons',
        '80–200% rally in 4–8 weeks + tight 1W flag near 52W high + volume confirmation')}

      {/* BONDE EP */}
      {renderPlaybookSection('Pradeep Bonde — Episodic Pivot (EP)', '#FBBF24', '⚡', bondeTop, 'bondeScore', 'bondeReasons',
        'Recent thrust (1W ≥ 5% or 1M ≥ 20%) · PED entry zone (0–15% above SMA50) · Stage-2 trend · liquid')}

      {/* MINERVINI */}
      {renderPlaybookSection('Mark Minervini — Trend Template', '#84CC16', '🏆', minerviniTop, 'minerviniScore', 'minerviniReasons',
        'SMA 50 > 150 > 200 hierarchy · within 25% of 52W high · ≥ 30% above 52W low · VCP volatility contraction')}

      <div id="sec-watch" style={{ scrollMarginTop: 80 }} />
      {/* zzz133 — TECH ONLY + QUALITY ON SALE side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div style={{ ...cardStyle, marginBottom: 0, background: 'color-mix(in srgb, #22D3EE 5%, transparent)', borderColor: 'color-mix(in srgb, #22D3EE 40%, transparent)' }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: CYAN, marginBottom: 10 }}>🔥 TECH STRONG · FUND WEAK ({techOnly.length})</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>Speculative momentum plays — technicals breaking out but fundamentals soft. Trade with tight stops.</div>
          {techOnly.length === 0 ? <div style={{ fontSize: 12, color: MUTED }}>None today.</div> : techOnly.map(r => (
            <div key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ display: 'flex', gap: 8, padding: '8px 10px', background: PANEL2, borderRadius: 6, marginBottom: 5, fontSize: 12, alignItems: 'center', cursor: 'pointer' }}>
              <span style={{ fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace', minWidth: 55 }}>{r.symbol}</span>
              <span style={{ color: TXT, fontFamily: 'ui-monospace, monospace', minWidth: 60 }}>{fmtPrice(r.price)}</span>
              <span style={{ flex: 1, color: TXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11 }}>{r.company}</span>
              <span style={{ color: scoreColor(r.totalScore), fontWeight: 800 }}>T{r.totalScore}</span>
              <span style={{ color: '#94A3B8', fontWeight: 600 }}>F{r.fundScore}</span>
              <span style={{ color: typeof r.perf1m === 'number' && r.perf1m > 0 ? '#10B981' : '#EF4444', fontWeight: 700 }}>{fmtPct(r.perf1m)}</span>
            </div>
          ))}
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, background: 'color-mix(in srgb, #84CC16 5%, transparent)', borderColor: 'color-mix(in srgb, #84CC16 40%, transparent)' }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#84CC16', marginBottom: 10 }}>💰 QUALITY ON SALE ({qualityOnSale.length})</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>Fund ≥ 55 AND Tech ≤ 50 — strong fundamentals (R40 / growth / FCF) but technicals weak. Waiting list for trend reversal entry.</div>
          {qualityOnSale.length === 0 ? <div style={{ fontSize: 12, color: MUTED }}>None today.</div> : qualityOnSale.map(r => (
            <div key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ display: 'flex', gap: 8, padding: '8px 10px', background: PANEL2, borderRadius: 6, marginBottom: 5, fontSize: 12, alignItems: 'center', cursor: 'pointer' }}>
              <span style={{ fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace', minWidth: 55 }}>{r.symbol}</span>
              <span style={{ color: TXT, fontFamily: 'ui-monospace, monospace', minWidth: 60 }}>{fmtPrice(r.price)}</span>
              <span style={{ flex: 1, color: TXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11 }}>{r.company}</span>
              <span style={{ color: '#94A3B8', fontWeight: 600 }}>T{r.totalScore}</span>
              <span style={{ color: scoreColor(r.fundScore), fontWeight: 800 }}>F{r.fundScore}</span>
              <span style={{ color: '#84CC16', fontWeight: 700 }}>{fmtPct(r.epsGrowthTTM)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* zzz181 - Recently Added panel */}
      <RecentlyAddedPanel tab={NEW_TAB_KEY_T} tickers={allSymbolsT} marketLabel={market === 'IND' ? '🇮🇳 India Technicals' : '🇺🇸 USA Technicals'} dataFolder="frontend/public/data/tradingview" />

      <div id="sec-all" style={{ scrollMarginTop: 80 }} />
      {/* All tickers — zzz133 sortable + FUND column + ELIG indicator */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: TXT }}>🏁 ALL TICKERS — COMPOSITE LEADERBOARD ({techRows.length})</div>
          <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>Click any column header to sort · ✓ = eligible · ✗ = rejected by hard filters · ⚠ = data flag</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: PANEL2, color: MUTED, fontSize: 11, cursor: 'pointer' }}>
                <th onClick={() => handleSort('symbol')} style={{ padding: '8px 8px', textAlign: 'left' }}>ELIG · TICKER{sortIcon('symbol')}</th>
                <th onClick={() => handleSort('price')} style={{ padding: '8px 8px', textAlign: 'right' }}>CMP{sortIcon('price')}</th>
                <th onClick={() => handleSort('company')} style={{ padding: '8px 8px', textAlign: 'left' }}>COMPANY{sortIcon('company')}</th>
                <th onClick={() => handleSort('qullaScore')} style={{ padding: '8px 6px', textAlign: 'right' }}>QULLA{sortIcon('qullaScore')}</th>
                <th onClick={() => handleSort('zangerScore')} style={{ padding: '8px 6px', textAlign: 'right' }}>ZNGR{sortIcon('zangerScore')}</th>
                <th onClick={() => handleSort('bondeScore')} style={{ padding: '8px 6px', textAlign: 'right' }}>BNDE{sortIcon('bondeScore')}</th>
                <th onClick={() => handleSort('minerviniScore')} style={{ padding: '8px 6px', textAlign: 'right' }}>MNVI{sortIcon('minerviniScore')}</th>
                <th onClick={() => handleSort('totalScore')} style={{ padding: '8px 6px', textAlign: 'right', color: CYAN }}>TECH{sortIcon('totalScore')}</th>
                <th onClick={() => handleSort('fundScore')} style={{ padding: '8px 6px', textAlign: 'right', color: '#84CC16' }}>FUND{sortIcon('fundScore')}</th>
                <th onClick={() => handleSort('rightEntry')} style={{ padding: '8px 8px', textAlign: 'left' }}>ENTRY{sortIcon('rightEntry')}</th>
                <th onClick={() => handleSort('pctVsSma50')} style={{ padding: '8px 6px', textAlign: 'right' }}>%SMA50{sortIcon('pctVsSma50')}</th>
                <th onClick={() => handleSort('perf1w')} style={{ padding: '8px 6px', textAlign: 'right' }}>1W{sortIcon('perf1w')}</th>
                <th onClick={() => handleSort('perf1m')} style={{ padding: '8px 6px', textAlign: 'right' }}>1M{sortIcon('perf1m')}</th>
                <th onClick={() => handleSort('perf3m')} style={{ padding: '8px 6px', textAlign: 'right' }}>3M{sortIcon('perf3m')}</th>
                <th onClick={() => handleSort('rsIdx3m')} title={idxRet ? `3-month return minus ${idxRet.index} (${idxRet.r3m != null ? `${idxRet.r3m >= 0 ? '+' : ''}${idxRet.r3m}%` : '—'}). Hover a cell for 1M / 6M / 12M.` : 'Index returns loading'} style={{ padding: '8px 6px', textAlign: 'right' }}>vs {market === 'IND' ? 'NIFTY' : 'S&P'}{sortIcon('rsIdx3m')}</th>
                <th onClick={() => handleSort('revGrowthQtr')} style={{ padding: '8px 6px', textAlign: 'right' }}>REV-Q{sortIcon('revGrowthQtr')}</th>
                <th onClick={() => handleSort('epsGrowthTTM')} style={{ padding: '8px 6px', textAlign: 'right' }}>EPS-TTM{sortIcon('epsGrowthTTM')}</th>
                <th onClick={() => handleSort('adrPct')} style={{ padding: '8px 6px', textAlign: 'right' }}>ADR{sortIcon('adrPct')}</th>
                <th onClick={() => handleSort('relVol1w')} style={{ padding: '8px 6px', textAlign: 'right' }}>Vol{sortIcon('relVol1w')}</th>
                <th onClick={() => handleSort('rsi')} style={{ padding: '8px 6px', textAlign: 'right' }}>RSI{sortIcon('rsi')}</th>
                <th onClick={() => handleSort('daysToEarnings')} style={{ padding: '8px 6px', textAlign: 'right' }}>ERN-d{sortIcon('daysToEarnings')}</th>
                <th onClick={() => handleSort('stopLoss')} style={{ padding: '8px 6px', textAlign: 'right' }}>STOP{sortIcon('stopLoss')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedAll.map(r => {
                const c = entryColor(r.rightEntry);
                const pctMA = typeof r.pctVsSma50 === 'number' ? r.pctVsSma50 : r.pctVsEma50;
                return (
                  <tr key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ borderBottom: `1px solid ${LINE}`, background: r.eligible ? 'transparent' : 'rgba(239,68,68,0.04)', cursor: 'pointer' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace' }}>
                      <span style={{ color: r.eligible ? '#10B981' : '#EF4444', marginRight: 5 }} title={r.eligible ? 'Eligible' : r.eligibilityFailures.join(' · ')}>{r.eligible ? '✓' : '✗'}</span>
                      {r.symbol}
                      {symBadges(r.symbol)}
                      {r.qualityFlags && r.qualityFlags.length > 0 ? <span title={r.qualityFlags.join(' · ')} style={{ color: '#EF4444', marginLeft: 4 }}>⚠</span> : null}
                      {(() => { const m = STAGE_META[classifyStage(r)]; return <span title={m.title} style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 800, padding: '1px 5px', borderRadius: 5, color: m.color, background: m.bg, fontFamily: 'system-ui, sans-serif' }}>{m.label}</span>; })()}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(r.price)}</td>
                    <td style={{ padding: '6px 8px', color: TXT, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: scoreColor(r.qullaScore), fontWeight: r.qullaScore >= 60 ? 800 : 500 }}>{r.qullaScore}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: scoreColor(r.zangerScore), fontWeight: r.zangerScore >= 60 ? 800 : 500 }}>{r.zangerScore}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: scoreColor(r.bondeScore), fontWeight: r.bondeScore >= 60 ? 800 : 500 }}>{r.bondeScore}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: scoreColor(r.minerviniScore), fontWeight: r.minerviniScore >= 60 ? 800 : 500 }}>{r.minerviniScore}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 900, color: scoreColor(r.totalScore), fontSize: 13 }}>{r.totalScore}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 900, color: r.fundScore >= 50 ? '#84CC16' : (r.fundScore >= 35 ? '#FBBF24' : MUTED), fontSize: 13 }}>{r.fundScore}</td>
                    <td style={{ padding: '6px 8px', color: c, fontWeight: 800, fontSize: 10.5 }}>{r.rightEntry}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: TXT }}>{typeof pctMA === 'number' ? fmtPct(pctMA) : '—'}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: typeof r.perf1w === 'number' && r.perf1w >= 5 ? '#10B981' : (typeof r.perf1w === 'number' && r.perf1w < 0 ? '#EF4444' : TXT), fontWeight: typeof r.perf1w === 'number' && r.perf1w >= 5 ? 700 : 400 }}>{fmtPct(r.perf1w)}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: typeof r.perf1m === 'number' && r.perf1m >= 15 ? '#10B981' : (typeof r.perf1m === 'number' && r.perf1m < 0 ? '#EF4444' : TXT), fontWeight: typeof r.perf1m === 'number' && r.perf1m >= 15 ? 700 : 400 }}>{fmtPct(r.perf1m)}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: TXT }}>{fmtPct(r.perf3m)}</td>
                    {(() => { const rs = (r as any).rsIdx as RsVsIndex | undefined; const v = rs?.rel3m; return (
                      <td title={rs?.text || ''} style={{ padding: '6px 6px', textAlign: 'right', cursor: 'help', fontWeight: 700, color: rs?.verdict === 'LEADING' ? '#10B981' : rs?.verdict === 'LAGGING' ? '#EF4444' : MUTED }}>{typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : '—'}</td>); })()}
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: typeof r.revGrowthQtr === 'number' && r.revGrowthQtr >= 20 ? '#84CC16' : TXT }}>{fmtPct(r.revGrowthQtr)}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: typeof r.epsGrowthTTM === 'number' && r.epsGrowthTTM >= 25 ? '#84CC16' : TXT }}>{fmtPct(r.epsGrowthTTM)}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: typeof r.adrPct === 'number' && r.adrPct >= 4 && r.adrPct <= 7 ? '#10B981' : TXT }}>{typeof r.adrPct === 'number' ? `${r.adrPct.toFixed(1)}` : '—'}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: r.volumeBurst === true ? '#10B981' : TXT, fontWeight: r.volumeBurst === true ? 700 : 400 }}>{typeof r.relVol1w === 'number' ? `${r.relVol1w.toFixed(1)}×` : '—'}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: typeof r.rsi === 'number' && r.rsi > 85 ? '#EF4444' : TXT }}>{r.rsi !== undefined ? r.rsi.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: typeof r.daysToEarnings === 'number' && r.daysToEarnings >= 0 && r.daysToEarnings <= 7 ? '#FBBF24' : MUTED, fontWeight: typeof r.daysToEarnings === 'number' && r.daysToEarnings >= 0 && r.daysToEarnings <= 7 ? 700 : 400 }}>{typeof r.daysToEarnings === 'number' && r.daysToEarnings >= 0 ? `${r.daysToEarnings}d` : '—'}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: '#F59E0B', fontFamily: 'ui-monospace, monospace' }}>{typeof r.stopLoss === 'number' ? fmtPrice(r.stopLoss) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div id="sec-trim" style={{ scrollMarginTop: 80 }} />
      {/* ADDITIVE (✂️ trim / take-profit watch) — the sell side of the book.
          Names you likely HOLD that are showing exhaustion. Sits with the other
          exit-side tooling, just above Stage 4. */}
      <div style={{ ...cardStyle, background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.35)' }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: '#F59E0B', marginBottom: 6 }}>✂️ TRIM / TAKE-PROFIT WATCH ({trimWatch.length})</div>
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>
          Names you likely HOLD that are showing exhaustion — parabolic extension, climactic RSI, or a heavy-volume break of the 50-DMA. Manage the position; this is the sell side of the book.
        </div>
        {trimWatch.length === 0 ? (
          <div style={{ fontSize: 12.5, color: MUTED, padding: 14, background: PANEL2, borderRadius: 8 }}>No held-style names showing exhaustion right now — let winners run.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {trimWatch.map(item => (
              <div key={item.symbol} onClick={() => setExpandedSymbol(item.symbol)} style={{ background: PANEL2, border: `1px solid color-mix(in srgb, ${item.color} 30%, transparent)`, borderLeft: `4px solid ${item.color}`, borderRadius: 6, padding: 10, cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace' }}>{item.symbol}</span>
                  <span style={{ color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(item.price)}</span>
                  <span style={{ marginLeft: 'auto', color: item.color, fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>{item.kind}</span>
                </div>
                <div style={{ fontSize: 11.5, color: item.color, marginTop: 5, fontWeight: 700, lineHeight: 1.5 }}>{item.action}</div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 5, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>%50DMA {typeof item.over50 === 'number' ? fmtPct(item.over50) : '—'}</span>
                  <span>RSI {typeof item.rsi === 'number' ? item.rsi.toFixed(0) : '—'}</span>
                  <span>1M {typeof item.perf1m === 'number' ? fmtPct(item.perf1m) : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* zzz412 — STAGE 4 / BREAKDOWN bucket — the single most important EXIT
          signal. Rendered prominently (not collapsed) so held names rolling
          into Stage 4 are grouped + scannable. */}
      {stage4Rows.length > 0 && (
        <div style={{ ...cardStyle, background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.35)' }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#EF4444', marginBottom: 6 }}>⚠ Stage 4 / breakdown ({stage4Rows.length})</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>
            Weinstein Stage 4: price below the 200DMA, 50DMA below the 200DMA, and 3-month performance negative — the classic sell-side / technical-exit pattern. Held or bench names here are auto-flagged to Book Watch.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {stage4Rows.slice(0, 40).map(r => (
              <div key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ background: PANEL2, border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: 10, cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 900, color: '#EF4444', fontFamily: 'ui-monospace, monospace' }}>{r.symbol}</span>
                  <span style={{ color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(r.price)}</span>
                  <span style={{ marginLeft: 'auto', color: MUTED, fontSize: 11 }}>3M {fmtPct(r.perf3m)} · %SMA50 {typeof r.pctVsSma50 === 'number' ? fmtPct(r.pctVsSma50) : '—'}</span>
                </div>
                <div style={{ fontSize: 11, color: TXT, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* zzz133 — REJECTED bucket — collapsible diagnostic */}
      {rejected.length > 0 && (
        <details style={{ ...cardStyle, background: 'rgba(239,68,68,0.04)', borderColor: 'rgba(239,68,68,0.25)' }}>
          <summary style={{ fontSize: 15, fontWeight: 900, color: '#EF4444', cursor: 'pointer', marginBottom: 10 }}>🚫 REJECTED BY HARD FILTERS ({rejected.length}) — click to expand</summary>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>These names failed eligibility (illiquid / below SMA50 / parabolic / earnings &lt; 3d / extreme extension). Shown for transparency — never appear in bullish buckets above.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {rejected.slice(0, 30).map(r => (
              <div key={r.symbol} onClick={() => setExpandedSymbol(r.symbol)} style={{ background: PANEL2, border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: 10, cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 900, color: '#94A3B8', fontFamily: 'ui-monospace, monospace' }}>{r.symbol}</span>
                  <span style={{ color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(r.price)}</span>
                  <span style={{ marginLeft: 'auto', color: MUTED, fontSize: 11 }}>T{r.totalScore} · F{r.fundScore}</span>
                </div>
                <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4, lineHeight: 1.5 }}>
                  ✗ {r.eligibilityFailures.join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* zzz133/zzz208 — TradingView field wishlist: collapsed + grouped by priority */}
      <details style={{ ...cardStyle, background: 'color-mix(in srgb, #22D3EE 4%, transparent)', borderColor: 'color-mix(in srgb, #22D3EE 30%, transparent)' }}>
        <summary style={{ fontSize: 15, fontWeight: 900, color: CYAN, cursor: 'pointer', userSelect: 'none' }}>
          💡 TradingView fields worth adding <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>— optional wishlist · click to expand</span>
        </summary>
        <div style={{ marginTop: 12 }}>
          <div style={{ padding: '10px 12px', background: 'rgba(16,185,129,0.08)', borderRadius: 8, fontSize: 12.5, color: TXT, lineHeight: 1.7, marginBottom: 12 }}>
            <b style={{ color: '#10B981' }}>✅ Already wired:</b> EMA 21 · Industry RS rank · Composite RS percentile · Avg vol 30d · Revenue Q/Annual/5Y growth · EPS TTM + Q growth · Gross profit Q growth · Upcoming earnings · Free Float · FCF margin · ROE · Net debt/EBITDA · Analyst rating · Piotroski · Position sizing · P/L calculator · R:R ratio.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
            <div style={{ background: 'rgba(132,204,22,0.06)', border: '1px solid rgba(132,204,22,0.3)', borderTop: '3px solid #84CC16', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#84CC16', marginBottom: 8 }}>🟢 HIGH — add these first</div>
              <div style={{ fontSize: 12, color: TXT, lineHeight: 1.65 }}>
                <div style={{ marginBottom: 6 }}><b>Volume dry-up:</b> add <i>Average volume 30d + 90d</i> → volume-contraction ratio inside a base (VCP + Qulla pullback).</div>
                <div style={{ marginBottom: 6 }}><b>Composite RS:</b> already computable from 1W/1M/3M/6M/1Y perfs — wired.</div>
                <div><b>RS vs SPY:</b> add one SPY row to the CSV (or <i>Beta 1Y</i>) → market-relative strength.</div>
              </div>
            </div>
            <div style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.3)', borderTop: '3px solid #FBBF24', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#FBBF24', marginBottom: 8 }}>🟡 MEDIUM — nice to have</div>
              <div style={{ fontSize: 12, color: TXT, lineHeight: 1.65 }}>
                <div style={{ marginBottom: 6 }}><b>Gap % + Change % (today):</b> Bonde EP signature.</div>
                <div style={{ marginBottom: 6 }}><b>Short Interest % + Days to Cover:</b> available in TradingView.</div>
                <div><b>Earnings surprise:</b> not exported directly — add <i>EPS actual Q</i> + <i>EPS estimate Q</i> and we compute (actual − est) ÷ |est|.</div>
              </div>
            </div>
            <div style={{ background: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.25)', borderTop: '3px solid #94A3B8', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#94A3B8', marginBottom: 8 }}>⚪ NOT POSSIBLE via screener CSV</div>
              <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.65 }}>
                <div style={{ marginBottom: 6 }}>Tight weekly closes · base length / VCP auto-detect · pocket pivot / anchored VWAP — all need historical OHLC, not a snapshot export.</div>
                <div style={{ marginBottom: 6 }}>Estimate revisions · institutional ownership trend — TradingView doesn&apos;t expose history.</div>
                <div>IBD RS Rating — proprietary; we approximate with universe-internal 1Y percentile (RS Rank column).</div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
            Next high-leverage adds if you find them in TradingView: <b style={{ color: TXT }}>Short Interest %</b> · <b style={{ color: TXT }}>Gap %</b> · <b style={{ color: TXT }}>EPS actual + estimate Q</b>. Otherwise this is about as good as a TradingView-only screener gets without intraday/historical OHLC.
          </div>
        </div>
      </details>

      {/* zzz135 — Click-to-detail MODAL */}
      {expandedRow && (
        <div onClick={() => setExpandedSymbol(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#11151F', border: `2px solid ${LINE}`, borderRadius: 14, maxWidth: 1200, width: '100%', boxShadow: '0 25px 70px rgba(0,0,0,0.7)' }}>
            {/* Header */}
            <div style={{ padding: '18px 24px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: CYAN, fontFamily: 'ui-monospace, monospace' }}>{expandedRow.symbol}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: TXT, fontFamily: 'ui-monospace, monospace' }}>{fmtPrice(expandedRow.price)}</div>
              <div style={{ fontSize: 14, color: MUTED }}>{expandedRow.company} <span style={{ marginLeft: 6 }}>· {expandedRow.sector}</span></div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ color: expandedRow.eligible ? '#10B981' : '#EF4444', fontWeight: 800, fontSize: 13 }}>{expandedRow.eligible ? '✓ ELIGIBLE' : '✗ REJECTED'}</span>
                <span style={{ color: entryColor(expandedRow.rightEntry), fontWeight: 800, fontSize: 13 }}>🎯 {expandedRow.rightEntry}</span>
                <button onClick={() => setExpandedSymbol(null)} style={{ background: 'transparent', border: `1px solid ${LINE}`, color: TXT, fontSize: 18, fontWeight: 700, width: 36, height: 36, borderRadius: 8, cursor: 'pointer' }}>×</button>
              </div>
            </div>

            {/* Composite + Eligibility */}
            <div style={{ padding: '14px 24px', borderBottom: `1px solid ${LINE}`, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ color: MUTED, fontSize: 11 }}>TECH</span>
                <span style={{ fontSize: 28, fontWeight: 900, color: scoreColor(expandedRow.totalScore) }}>{expandedRow.totalScore}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ color: MUTED, fontSize: 11 }}>FUND</span>
                <span style={{ fontSize: 28, fontWeight: 900, color: expandedRow.fundScore >= 50 ? '#84CC16' : (expandedRow.fundScore >= 35 ? '#FBBF24' : MUTED) }}>{expandedRow.fundScore}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, flex: 1, minWidth: 280 }}>
                <div style={{ background: 'rgba(34,211,238,0.1)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ color: MUTED, fontSize: 10 }}>QULLAMAGGIE</div>
                  <div style={{ color: scoreColor(expandedRow.qullaScore), fontWeight: 900, fontSize: 18 }}>{expandedRow.qullaScore}</div>
                </div>
                <div style={{ background: 'rgba(167,139,250,0.1)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ color: MUTED, fontSize: 10 }}>ZANGER HTF</div>
                  <div style={{ color: scoreColor(expandedRow.zangerScore), fontWeight: 900, fontSize: 18 }}>{expandedRow.zangerScore}</div>
                </div>
                <div style={{ background: 'rgba(251,191,36,0.1)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ color: MUTED, fontSize: 10 }}>BONDE EP</div>
                  <div style={{ color: scoreColor(expandedRow.bondeScore), fontWeight: 900, fontSize: 18 }}>{expandedRow.bondeScore}</div>
                </div>
                <div style={{ background: 'rgba(132,204,22,0.1)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ color: MUTED, fontSize: 10 }}>MINERVINI</div>
                  <div style={{ color: scoreColor(expandedRow.minerviniScore), fontWeight: 900, fontSize: 18 }}>{expandedRow.minerviniScore}</div>
                </div>
              </div>
            </div>

            {/* Eligibility detail */}
            {!expandedRow.eligible && (
              <div style={{ padding: '12px 24px', background: 'rgba(239,68,68,0.08)', borderBottom: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#EF4444', marginBottom: 4 }}>🚫 REJECTED BY HARD FILTERS</div>
                <div style={{ fontSize: 11.5, color: TXT }}>{expandedRow.eligibilityFailures.join(' · ')}</div>
              </div>
            )}
            {expandedRow.eligibilityTags.length > 0 && (
              <div style={{ padding: '10px 24px', background: 'rgba(251,191,36,0.08)', borderBottom: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 11.5, color: '#FBBF24', fontWeight: 700 }}>🗓 {expandedRow.eligibilityTags.join(' · ')}{typeof expandedRow.daysToEarnings === 'number' ? ` — earnings in ${expandedRow.daysToEarnings}d` : ''}</div>
              </div>
            )}
            {expandedRow.qualityFlags && expandedRow.qualityFlags.length > 0 && (
              <div style={{ padding: '10px 24px', background: 'rgba(239,68,68,0.05)', borderBottom: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 11.5, color: '#EF4444', fontWeight: 700 }}>⚠️ Data flags: {expandedRow.qualityFlags.join(' · ')}</div>
              </div>
            )}

            {/* 3-column main grid: Technicals · Fundamentals · Playbook reasons */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, padding: 18 }}>

              {/* TECHNICALS */}
              <div style={{ background: PANEL2, borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: CYAN, marginBottom: 10, letterSpacing: '0.5px' }}>📈 TECHNICALS</div>
                {[
                  ['Price (CMP)', fmtPrice(expandedRow.price)],
                  // zzz160 — Show USD + INR-crore for India stocks (₹85/USD approx)
                  ['Market Cap', typeof expandedRow.mcapB === 'number'
                    ? (market === 'IND'
                        ? `$${expandedRow.mcapB.toFixed(1)}B (₹${Math.round(expandedRow.mcapB * usdInrNow().usdInr * 100).toLocaleString('en-IN')} Cr${usdInrNow().live ? '' : ' approx.'})`
                        : `$${expandedRow.mcapB.toFixed(1)}B`)
                    : '—'],
                  ['ATR (14d)', typeof expandedRow.atr14 === 'number' ? `${CUR}${expandedRow.atr14.toFixed(2)}` : '—'],
                  ['ADR %', typeof expandedRow.adrPct === 'number' ? `${expandedRow.adrPct.toFixed(1)}% ${expandedRow.adrPct >= 4 && expandedRow.adrPct <= 7 ? '🎯 sweet spot' : ''}` : '—'],
                  ['RSI', typeof expandedRow.rsi === 'number' ? `${expandedRow.rsi.toFixed(0)} ${expandedRow.rsi > 85 ? '⚠️ extreme' : expandedRow.rsi >= 55 && expandedRow.rsi <= 70 ? '✅' : ''}` : '—'],
                  ['Avg Vol 30d', typeof expandedRow.avgVol30d === 'number' ? `${(expandedRow.avgVol30d/1_000_000).toFixed(2)}M shares` : '—'],
                  ['$ Volume / day', typeof expandedRow.dollarVolume === 'number' ? `$${(expandedRow.dollarVolume/1_000_000).toFixed(1)}M` : '—'],
                  ['Rel Vol (1W)', typeof expandedRow.relVol1w === 'number' ? `${expandedRow.relVol1w.toFixed(2)}× ${expandedRow.relVol1w >= 1.5 ? '🔥 burst' : expandedRow.relVol1w < 0.8 ? '📉 contracting (VCP-ish)' : ''}` : '—'],
                  ['EMA 21', typeof expandedRow.ema21 === 'number' ? `${CUR}${expandedRow.ema21.toFixed(2)} (Qulla entry MA)` : '—'],
                  ['% vs EMA 21', typeof expandedRow.pctVsEma21 === 'number' ? `${fmtPct(expandedRow.pctVsEma21, 1)} ${expandedRow.pctVsEma21 >= 0 && expandedRow.pctVsEma21 <= 5 ? '🎯 Qulla buy zone' : expandedRow.pctVsEma21 > 5 && expandedRow.pctVsEma21 <= 10 ? '⚠️ stretched' : expandedRow.pctVsEma21 > 10 ? '🚫 extended' : ''}` : '—'],
                  ['SMA 50', typeof expandedRow.sma50 === 'number' ? `${CUR}${expandedRow.sma50.toFixed(2)}` : '—'],
                  ['SMA 150', typeof expandedRow.sma150 === 'number' ? `${CUR}${expandedRow.sma150.toFixed(2)}` : '—'],
                  ['SMA 200', typeof expandedRow.sma200 === 'number' ? `${CUR}${expandedRow.sma200.toFixed(2)}` : '—'],
                  ['% vs SMA50', fmtPct(expandedRow.pctVsSma50, 1)],
                  ['% vs SMA200', fmtPct(expandedRow.pctVsSma200, 1)],
                  ['% from 52W high', fmtPct(expandedRow.distFromHigh, 1)],
                  ['% above 52W low', fmtPct(expandedRow.pctAboveLow52w, 0)],
                  ['Perf 1 week', fmtPct(expandedRow.perf1w, 1)],
                  ['Perf 1 month', fmtPct(expandedRow.perf1m, 0)],
                  ['Perf 3 month', fmtPct(expandedRow.perf3m, 0)],
                  ['Perf 6 month', fmtPct(expandedRow.perf6m, 0)],
                  ['Perf 1 year', fmtPct(expandedRow.perf1y, 0)],
                  ['Vol contraction (VCP)', expandedRow.volContraction === true ? '✅ Yes (1W vol < 1M × 0.85)' : (expandedRow.volContraction === false ? 'No' : '—')],
                  ['Momentum accel (0-3)', typeof expandedRow.momentumAccel === 'number' ? `${expandedRow.momentumAccel}/3 ${expandedRow.momentumAccel >= 2 ? '🚀' : ''}` : '—'],
                  ['Beta', typeof expandedRow.beta === 'number' ? expandedRow.beta.toFixed(2) : '—'],
                  ['Industry', expandedRow.industry || '—'],
                  ['Composite RS (vs universe)', typeof expandedRow.compositeRs === 'number' ? `${expandedRow.compositeRs}%ile ${expandedRow.compositeRs >= 80 ? '🚀 universe leader' : expandedRow.compositeRs >= 60 ? '✅ above-median' : expandedRow.compositeRs >= 30 ? '· median band' : '· bottom decile (note: universe pre-curated for momentum)'}` : '—'],
                  ['Industry RS rank', typeof expandedRow.industryRsRank === 'number' ? `${expandedRow.industryRsRank} ${expandedRow.industryRsRank >= 80 ? '🏭 leading' : expandedRow.industryRsRank <= 30 ? '⚠️ laggard' : ''}` : '—'],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                    <span style={{ color: MUTED }}>{label}</span>
                    <span style={{ color: TXT, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{val}</span>
                  </div>
                ))}
              </div>

              {/* FUNDAMENTALS */}
              <div style={{ background: PANEL2, borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#84CC16', marginBottom: 10, letterSpacing: '0.5px' }}>💎 FUNDAMENTALS</div>
                {[
                  ['Revenue Growth Q YoY', fmtPct(expandedRow.revGrowthQtr, 0)],
                  ['Revenue Growth Annual', fmtPct(expandedRow.revGrowthAnn, 0)],
                  ['Revenue 5Y CAGR', fmtPct(expandedRow.revGrowth5Y, 0)],
                  ['EPS Diluted TTM YoY', fmtPct(expandedRow.epsGrowthTTM, 0)],
                  ['EPS Diluted Q YoY', fmtPct(expandedRow.epsGrowthQtr, 0)],
                  ['Gross Profit Growth Q', fmtPct(expandedRow.grossProfitGrowthQtr, 0)],
                  ['Margin Expanding?', expandedRow.marginExpanding ? '✅ Gross Q > Rev Q' : '—'],
                  ['Growth Confirmed?', expandedRow.growthConfirmed ? '✅ EPS Q≥25% AND Rev Q≥15%' : '—'],
                  ['Gross Margin', fmtPct(expandedRow.grossMargin, 1)],
                  ['Operating Margin', fmtPct(expandedRow.opMargin, 1)],
                  ['Net Margin', fmtPct(expandedRow.netMargin, 1)],
                  ['FCF Margin', fmtPct(expandedRow.fcfMargin, 1)],
                  ['ROE', fmtPct(expandedRow.roe, 1)],
                  ['ROIC', fmtPct(expandedRow.roic, 1)],
                  ['Debt / Equity', typeof expandedRow.debtEquity === 'number' ? `${expandedRow.debtEquity.toFixed(2)}×` : '—'],
                  ['Net Debt / EBITDA', typeof expandedRow.netDebtEbitda === 'number' ? `${expandedRow.netDebtEbitda.toFixed(2)}×` : '—'],
                  ['Interest Coverage', typeof expandedRow.interestCoverage === 'number' ? `${expandedRow.interestCoverage.toFixed(1)}×` : '—'],
                  ['Piotroski F-Score', typeof expandedRow.piotroski === 'number' ? `${expandedRow.piotroski.toFixed(0)}/9` : '—'],
                  ['Analyst Rating', typeof expandedRow.analystRating === 'number' ? `${expandedRow.analystRating.toFixed(2)} / 5` : '—'],
                  ['Free Float %', fmtPct(expandedRow.freeFloatPct, 1)],
                  ['Rule of 40', (typeof expandedRow.revGrowthAnn === 'number' && typeof expandedRow.fcfMargin === 'number') ? `${(expandedRow.revGrowthAnn + expandedRow.fcfMargin).toFixed(0)}` : '—'],
                  ['Next earnings', expandedRow.nextEarnings || '—'],
                  ['Days to earnings', typeof expandedRow.daysToEarnings === 'number' ? `${expandedRow.daysToEarnings}d ${expandedRow.daysToEarnings <= 3 ? '⚠️ imminent' : expandedRow.daysToEarnings <= 14 ? '🗓 soon' : ''}` : '—'],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                    <span style={{ color: MUTED }}>{label}</span>
                    <span style={{ color: TXT, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{val}</span>
                  </div>
                ))}
              </div>

              {/* PLAYBOOK REASONS + ENTRY */}
              <div style={{ background: PANEL2, borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#FBBF24', marginBottom: 10, letterSpacing: '0.5px' }}>🎯 PLAYBOOK BREAKDOWN</div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#22D3EE', marginBottom: 4 }}>🔥 Qullamaggie · {expandedRow.qullaScore}/100</div>
                  <div style={{ fontSize: 11, color: TXT, lineHeight: 1.6 }}>{expandedRow.qullaReasons.length > 0 ? expandedRow.qullaReasons.join(' · ') : <span style={{ color: MUTED }}>No criteria met</span>}</div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#A78BFA', marginBottom: 4 }}>🚀 Zanger HTF · {expandedRow.zangerScore}/100</div>
                  <div style={{ fontSize: 11, color: TXT, lineHeight: 1.6 }}>{expandedRow.zangerReasons.length > 0 ? expandedRow.zangerReasons.join(' · ') : <span style={{ color: MUTED }}>No criteria met</span>}</div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#FBBF24', marginBottom: 4 }}>⚡ Bonde EP · {expandedRow.bondeScore}/100</div>
                  <div style={{ fontSize: 11, color: TXT, lineHeight: 1.6 }}>{expandedRow.bondeReasons.length > 0 ? expandedRow.bondeReasons.join(' · ') : <span style={{ color: MUTED }}>No criteria met</span>}</div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#84CC16', marginBottom: 4 }}>🏆 Minervini Trend · {expandedRow.minerviniScore}/100</div>
                  <div style={{ fontSize: 11, color: TXT, lineHeight: 1.6 }}>{expandedRow.minerviniReasons.length > 0 ? expandedRow.minerviniReasons.join(' · ') : <span style={{ color: MUTED }}>No criteria met</span>}</div>
                </div>

                {expandedRow.fundReasons.length > 0 && (
                  <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(132,204,22,0.08)', borderRadius: 6, borderLeft: '3px solid #84CC16' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: '#84CC16', marginBottom: 4 }}>💎 Fundamental signals</div>
                    <div style={{ fontSize: 11, color: TXT, lineHeight: 1.6 }}>{expandedRow.fundReasons.join(' · ')}</div>
                  </div>
                )}

                {/* Entry + Stop + zzz135 POSITION SIZING */}
                <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(16,185,129,0.06)', borderRadius: 8, borderLeft: `4px solid ${entryColor(expandedRow.rightEntry)}` }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: entryColor(expandedRow.rightEntry), marginBottom: 4 }}>🎯 ENTRY: {expandedRow.rightEntry}</div>
                  <div style={{ fontSize: 11.5, color: TXT, lineHeight: 1.6 }}>{expandedRow.rightEntryDetail}</div>
                  {typeof expandedRow.stopLoss === 'number' && (
                    <div style={{ fontSize: 12, color: '#F59E0B', marginTop: 8, fontWeight: 700 }}>
                      🛑 STOP {fmtPrice(expandedRow.stopLoss)} · risk {typeof expandedRow.stopLossPct === 'number' ? `−${expandedRow.stopLossPct.toFixed(1)}%` : '−2×ATR'}
                    </div>
                  )}
                  {(() => {
                    const pos = calcPosition(expandedRow.price, expandedRow.stopLoss);
                    if (!pos) return null;
                    return (
                      <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(245,158,11,0.1)', borderRadius: 6, borderLeft: '3px solid #F59E0B' }}>
                        <div style={{ fontSize: 11.5, fontWeight: 800, color: '#F59E0B', marginBottom: 6 }}>💼 POSITION SIZING (portfolio ${portfolioSize.toLocaleString()} · risk {riskPct}%)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: 11.5 }}>
                          <div style={{ color: TXT }}>Shares: <b style={{ color: '#F59E0B', fontFamily: 'ui-monospace, monospace' }}>{pos.shares.toLocaleString()}</b></div>
                          <div style={{ color: TXT }}>Capital: <b style={{ color: '#F59E0B', fontFamily: 'ui-monospace, monospace' }}>${pos.capital.toLocaleString(undefined, {maximumFractionDigits: 0})}</b></div>
                          <div style={{ color: TXT }}>$ at risk: <b style={{ color: '#F59E0B', fontFamily: 'ui-monospace, monospace' }}>${pos.riskDollars.toLocaleString(undefined, {maximumFractionDigits: 0})}</b></div>
                          <div style={{ color: TXT }}>Allocation: <b style={{ color: '#F59E0B', fontFamily: 'ui-monospace, monospace' }}>{pos.portfolioAllocPct.toFixed(1)}%</b></div>
                        </div>
                        {pos.portfolioAllocPct > 25 && <div style={{ fontSize: 10.5, color: '#EF4444', marginTop: 5, fontWeight: 700 }}>⚠️ Allocation &gt; 25% — concentration risk. Consider tighter stop or smaller risk %.</div>}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Footer hint */}
            <div style={{ padding: '12px 24px', borderTop: `1px solid ${LINE}`, fontSize: 11, color: MUTED, textAlign: 'center' }}>
              Click outside or press × to close · Click any ticker in any section to open its detail
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
