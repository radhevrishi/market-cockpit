'use client';

import React, { useState, useMemo, useEffect } from 'react';
import ThemeRotationTab from '@/components/dashboard/ThemeRotationTab'; // zzz480
import { applyForcedRanking, scoreExcelRow } from '@/lib/multibagger-india-scoring';
import type { ExcelRow, ExcelResult } from '@/lib/multibagger-india-scoring';
import { MultibaggerAnalytics } from './analytics';
import { CapitalAllocationPanel } from './capital-allocation';
import { MultibaggerChecklist, USAChecklist } from './checklist';
import { BG, F, MUTED, PURPLE, RED, TEXT } from './constants';
import { ExcelCompare } from './india-tab';
import { _setIndiaRowsMemCache } from './mem-cache';
import { MultibaggerReference } from './reference';
import { STORAGE_KEY, STORAGE_META, mbIdbDel, mbIdbGetWithRetry, mbIdbSet, mbRequestPersistentStorage, mbServerSnapshotLoad, mbServerSnapshotSave } from './storage';
import { TechnicalsTab } from './technicals-tab';
import { TurnaroundAnalytics } from './turnaround-analytics';
import { TurnaroundCompare } from './turnaround-tab';
import { USAAnalytics } from './usa-analytics';
import { USACompare } from './usa-tab';

export default function MultibaggerPage() {
  // PATCH 0492 — 'analytics' tab added as DEFAULT landing view. User wanted to land
  // on the cross-stock analytics overview, not the per-row ranking table.
  // PATCH 0872 — Added 'usa-analytics' and 'turnaround-analytics' as
  // dedicated dashboards for the USA Multibagger universe and the
  // Turnaround universe respectively. The original 'analytics' tab stays
  // as the cross-market overview (India-led).
  type MbTab = 'analytics'|'excel'|'usa'|'usa-analytics'|'technicals'|'technicals-usa'|'technicals-ind'|'theme-rotation'|'turnaround'|'turnaround-analytics'|'usa-checklist'|'checklist'|'capital-alloc'|'reference';
  const VALID_TABS: MbTab[] = ['analytics','excel','usa','usa-analytics','technicals','technicals-usa','technicals-ind','theme-rotation','turnaround','turnaround-analytics','usa-checklist','checklist','capital-alloc','reference'];
  // zzz166 — Support deep-links like /multibagger?tab=technicals-usa from home nav chips.
  const initialTab = React.useMemo<MbTab>(() => {
    if (typeof window === 'undefined') return 'analytics';
    try {
      const t = new URLSearchParams(window.location.search).get('tab') as MbTab | null;
      return t && VALID_TABS.includes(t) ? t : 'analytics';
    } catch { return 'analytics'; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeTab, setActiveTab] = useState<MbTab>(initialTab);
  // zzz342 — clicking the Auto Screens tab navigates to the /multibagger/screens sub-route.
  React.useEffect(() => { if (typeof window !== 'undefined' && activeTab === 'auto-screens') { window.location.href = '/multibagger/screens'; } }, [activeTab]);
  React.useEffect(() => {
    const onSwitch = (e: Event) => {
      const ce = e as CustomEvent<{ tab: 'excel' | 'usa' }>;
      if (ce.detail?.tab === 'usa' || ce.detail?.tab === 'excel') setActiveTab(ce.detail.tab);
    };
    window.addEventListener('mc:switch-multibagger-tab', onSwitch);
    return () => window.removeEventListener('mc:switch-multibagger-tab', onSwitch);
  }, []);

  // Lazy-init from localStorage — data survives navigation and page refresh.
  // Only cleared when user explicitly clicks "Clear All Data".
  const [excelRows, setExcelRowsState] = useState<ExcelResult[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ExcelResult[];
        // RE-SCORE on every load — ExcelResult extends ExcelRow, so all raw fields
        // are preserved in localStorage. Re-running scoreExcelRow picks up any
        // scoring formula changes (e.g. new -30 growth filter) without re-upload.
        const rescored = parsed.map(r => scoreExcelRow(r as unknown as ExcelRow));
        const sorted = rescored.sort((a, b) => b.score - a.score);
        return applyForcedRanking(sorted);
      }
    } catch {}
    return [];
  });
  // PATCH 1101i — Removed the redundant background-write effect that fired on
  // every excelRows change. setExcelRows (below) is the single writer now —
  // it awaits IDB success before writing META, which is the only way to
  // prevent orphan-META "Saved data lost" banners. The old effect wrote IDB
  // without awaiting and ignored failures, contributing to the bug.

  // PATCH 1101i + 1101l — Three-layer hydration on mount.
  //   1. localStorage initializer (synchronous, line above) tries first.
  //   2. IDB retry — catches localStorage 5MB eviction with IDB still intact.
  //   3. SERVER fetch (Railway Upstash Redis) — catches the case where BOTH
  //      local layers were evicted by the browser. This is the bulletproof
  //      tier the user explicitly asked for after 1101i still wasn't holding.
  // Each layer only fires if the prior one returned empty. Once data lands,
  // the data is written back DOWN to local layers so next session is fast.
  useEffect(() => {
    let alive = true;
    // Ask the browser to mark our origin's storage as persistent so IDB
    // doesn't get evicted under storage pressure (best-effort).
    mbRequestPersistentStorage();
    (async () => {
      // Layer 2: IDB
      const idbRaw = await mbIdbGetWithRetry('mb_scored');
      if (!alive) return;
      if (idbRaw) {
        try {
          const parsed = JSON.parse(idbRaw) as ExcelResult[];
          if (Array.isArray(parsed) && parsed.length) {
            const rescored = parsed.map(r => {
              try { return scoreExcelRow(r as unknown as ExcelRow); } catch { return r; }
            });
            const sorted = rescored.sort((a, b) => b.score - a.score);
            const ranked = applyForcedRanking(sorted);
            setExcelRowsState((prev) => (prev && prev.length ? prev : ranked));
            try { _setIndiaRowsMemCache(ranked); } catch {} // zzz231
            return;
          }
        } catch (e) {
          try { console.warn('[mb-idb] hydrate parse failed', e); } catch {}
        }
      }
      // Layer 3: SERVER. Both local layers came up empty — try the Upstash
      // backup before letting the orphan-META banner fire.
      try { console.log('[mb-persist] local layers empty, trying server snapshot'); } catch {}
      const serverRaw = await mbServerSnapshotLoad('IN');
      if (!alive || !serverRaw) {
        try { console.log('[mb-persist] server snapshot also empty'); } catch {}
        return;
      }
      try {
        const parsed = JSON.parse(serverRaw) as ExcelResult[];
        if (Array.isArray(parsed) && parsed.length) {
          try { console.log(`[mb-persist] restored ${parsed.length} stocks from server`); } catch {}
          const rescored = parsed.map(r => {
            try { return scoreExcelRow(r as unknown as ExcelRow); } catch { return r; }
          });
          const sorted = rescored.sort((a, b) => b.score - a.score);
          const rankedServer = applyForcedRanking(sorted);
          setExcelRowsState((prev) => (prev && prev.length ? prev : rankedServer));
          try { _setIndiaRowsMemCache(rankedServer); } catch {} // zzz231
          // Write back DOWN to IDB + localStorage so future hydrations are fast
          // and don't require a server round-trip.
          const __mbS = JSON.stringify(sorted);
          mbIdbSet('mb_scored', __mbS).then(() => {
            try { localStorage.setItem(STORAGE_KEY, __mbS); } catch {}
            try {
              localStorage.setItem(STORAGE_META, JSON.stringify({
                savedAt: new Date().toISOString(),
                count: sorted.length,
                restoredFrom: 'server',
              }));
            } catch {}
          }).catch(() => {});
        }
      } catch (e) {
        try { console.warn('[mb-server-snapshot] parse failed', e); } catch {}
      }
    })();
    return () => { alive = false; };
  }, []);

  // Wrapper: always applies forced ranking before saving/setting state
  function setExcelRows(rows: ExcelResult[]) {
    const ranked = applyForcedRanking(rows); // sort already done by caller
    setExcelRowsState(ranked);
    try { _setIndiaRowsMemCache(ranked); } catch {} // zzz231 — sync mem cache for Copy ALL BEST
    // PATCH 1099 + 1101i — IDB is the source of truth (essentially unlimited
    // storage). Write IDB FIRST; only write META AFTER IDB confirms. With
    // 1101i the mbIdbSet primitive now properly rejects on failure (instead
    // of swallowing the error and falsely resolving), so the .then() branch
    // below ACTUALLY only fires on successful writes. Previously, an IDB
    // failure would silently resolve, META would write, localStorage might
    // also fail, and the next session would show orphan META + no data.
    const __mbR = JSON.stringify(ranked);
    mbIdbSet('mb_scored', __mbR).then(() => {
      // IDB write confirmed succeeded.
      try { localStorage.setItem(STORAGE_KEY, __mbR); } catch {}
      try {
        localStorage.setItem(STORAGE_META, JSON.stringify({
          savedAt: new Date().toISOString(),
          count: ranked.length,
        }));
      } catch {}
      // PATCH 1101l + 1101m — Server backup via Railway Postgres. Track save
      // status in localStorage so the UI can show a "☁ Cloud OK" / "⚠ Local
      // only" badge — user needs to SEE whether persistence is working.
      try { localStorage.setItem('mb_server_save_status', 'saving'); window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: 'saving' })); } catch {}
      mbServerSnapshotSave(__mbR, ranked.length, 'IN').then((ok) => {
        try { console.log('[mb-persist] server snapshot save →', ok ? 'OK' : 'FAILED'); } catch {}
        try {
          if (ok) {
            localStorage.setItem('mb_server_save_status', 'ok');
            localStorage.setItem('mb_server_save_at', new Date().toISOString());
          } else {
            localStorage.setItem('mb_server_save_status', 'failed');
          }
          window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: ok ? 'ok' : 'failed' }));
        } catch {}
      });
      // PATCH 0471 — broadcast cross-tab update so consumers (Re-rating,
      // Signals, Earnings Scan) refresh their derived universes immediately
      // after a fresh India upload.
      try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'India', count: ranked.length } })); } catch {}
    }).catch(async (e) => {
      // PATCH 1101i — IDB write FAILED (genuinely now, not swallowed). Try
      // localStorage as a fallback for small datasets, but DO NOT write META
      // unless that localStorage write succeeds with the actual data.
      // PATCH 1101n — CRITICAL: also attempt the server save in this path.
      // Previously the server-save call only lived in the .then() branch, so
      // when local writes failed, the user lost their data even though the
      // server backup could have saved it. Now we try ALL three (IDB-was-
      // already-tried, localStorage, server) and only alert if literally
      // every layer failed. Also: log the actual JSON size so the user can
      // see how big their dataset has gotten.
      const sizeMB = (__mbR.length / 1024 / 1024).toFixed(2);
      try { console.warn(`[mb-persistence] IDB write failed (${sizeMB}MB), trying fallbacks`, e); } catch {}
      let localOk = false;
      try { localStorage.setItem(STORAGE_KEY, __mbR); localOk = true; } catch (lsErr) {
        try { console.warn('[mb-persistence] localStorage also failed', lsErr); } catch {}
      }
      // Server save — this is the key 1101n fix. Try regardless of local state.
      try { localStorage.setItem('mb_server_save_status', 'saving'); window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: 'saving' })); } catch {}
      const serverOk = await mbServerSnapshotSave(__mbR, ranked.length, 'IN');
      try {
        localStorage.setItem('mb_server_save_status', serverOk ? 'ok' : 'failed');
        if (serverOk) localStorage.setItem('mb_server_save_at', new Date().toISOString());
        window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: serverOk ? 'ok' : 'failed' }));
      } catch {}
      if (localOk) {
        try {
          localStorage.setItem(STORAGE_META, JSON.stringify({
            savedAt: new Date().toISOString(),
            count: ranked.length,
            fallback: 'localStorage-only',
          }));
        } catch {}
      }
      // Only alert if EVERY persistence layer failed.
      if (!localOk && !serverOk) {
        try {
          alert(`⚠ Save failed across all layers (${sizeMB}MB):\n• IndexedDB: failed\n• localStorage: quota exceeded\n• Railway cloud: unreachable\n\nYour data is live in this session but will be lost on refresh. Use "Download Screener CSV" to export, or click "Backup now" once your connection returns.`);
        } catch {}
      } else if (serverOk && !localOk) {
        try { console.log('[mb-persistence] Local writes failed but server backup succeeded — data is safe.'); } catch {}
      }
      try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'India', count: ranked.length } })); } catch {}
    });
  }

  // Clear all data — explicit user action only
  function clearExcelRows() {
    setExcelRowsState([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_META);
      localStorage.removeItem('mb_excel_files_v1'); // PATCH 0984
      mbIdbDel('mb_scored');
      // PATCH 0453 P1-18 — Audit found cross-tab pages (Rerating, Signals,
      // Earnings Scan) kept showing ghost tickers from a cleared upload
      // because they only listened to the conviction-beats custom event,
      // not a multibagger-specific signal. Now broadcast 'mb-upload:updated'
      // so consumers can refresh their derived universes immediately.
      window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { cleared: true } }));
    } catch {}
  }

  return (
    <div style={{background:BG,minHeight:'100vh',color:TEXT,fontFamily:'system-ui,-apple-system,sans-serif'}}>
      {/* Header */}
      <div style={{backgroundColor:'#13131a',borderBottom:'1px solid rgba(255,255,255,0.08)',padding:'20px 24px 0'}}>
        <div style={{maxWidth:1800,margin:'0 auto'}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,gap:12}}>
            <div>
              <h1 style={{fontSize:F.h1,fontWeight:900,color:PURPLE,margin:0}}>🚀 Multibagger Research Engine</h1>
              <p style={{fontSize:F.md,color:MUTED,margin:'5px 0 0'}}>
                SQGLP (MOSL 100×) · Fisher 100-Bagger · Multibagger Framework · Upload Screener.in → instant institutional scoring
              </p>
            </div>
            {/* Tab-specific clear buttons — India and USA are independent datasets */}
            {(activeTab==='excel'||activeTab==='checklist') && excelRows.length > 0 && (
              <button
                onClick={() => { if (window.confirm(`Clear all ${excelRows.length} India stocks? This cannot be undone.`)) clearExcelRows(); }}
                style={{padding:'8px 16px',backgroundColor:`${RED}14`,border:`1px solid ${RED}40`,borderRadius:8,color:RED,fontSize:F.sm,fontWeight:700,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}
              >
                🗑 Clear India Data ({excelRows.length})
              </button>
            )}
            {(activeTab==='usa'||activeTab==='usa-checklist') && (() => {
              try {
                const d = JSON.parse(localStorage.getItem('mb_usa_scored_v1')||'[]');
                const count = Array.isArray(d) ? d.length : 0;
                if (count === 0) return null;
                return (
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Clear all ${count} USA stocks? This cannot be undone.`)) return;
                      // PATCH 1101bb — also delete Railway snapshot so stale USA
                      // stocks (like the VCTR/LPG ghost the user kept seeing)
                      // don't re-appear on refresh. Previously the button only
                      // cleared localStorage, leaving Railway as the silent
                      // source of truth that re-hydrated on next visit.
                      try {
                        const cid = localStorage.getItem('mb_client_id_v1');
                        if (cid) {
                          await fetch(`/api/v1/multibagger/snapshot?clientId=${encodeURIComponent(cid)}&market=USA`, { method: 'DELETE' });
                          try { console.log('[mb-usa] Railway snapshot deleted'); } catch {}
                        }
                      } catch (e) {
                        try { console.warn('[mb-usa] Railway delete failed', e); } catch {}
                      }
                      localStorage.removeItem('mb_usa_scored_v1');
                      localStorage.removeItem('mb_usa_uploaded_at_v1');
                      try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { cleared: true, market: 'USA' } })); } catch {}
                      window.location.reload();
                    }}
                    style={{padding:'8px 16px',backgroundColor:`${RED}14`,border:`1px solid ${RED}40`,borderRadius:8,color:RED,fontSize:F.sm,fontWeight:700,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}
                  >
                    🗑 Clear USA Data ({count})
                  </button>
                );
              } catch { return null; }
            })()}
          </div>
          {/* PATCH 1086 — tab overflow. Last tab ("Multibagger Reference") was
              clipping to "Res..." on viewports < ~1500px because the flex row
              had no horizontal scroll fallback. Adding overflowX:auto +
              whiteSpace:nowrap lets the row scroll instead of truncating;
              child buttons already use flexShrink:0 so they keep full width. */}
          <div style={{display:'flex',gap:0,overflowX:'auto',whiteSpace:'nowrap',scrollbarWidth:'thin'}}>
            {([
              // PATCH 0492 — Analytics tab is FIRST (default landing). User asked
              // to see analytics first, not the ranking table.
              // PATCH 0872 — Dedicated USA Analytics and Turnaround Analytics
              // tabs placed RIGHT NEXT to their data tabs so user can flip
              // between raw ranking and the institutional dashboard.
              {id:'analytics',              label:'📊 Analytics'},
              {id:'excel',                  label:'🇮🇳 India Multibagger Ranking'},
              {id:'usa',                    label:'🇺🇸 USA Multibagger'},
              {id:'usa-analytics',          label:'📊 USA Analytics'},
              {id:'technicals-usa',         label:'📈 USA Technicals (Qulla/Zanger/Bonde/Minervini)'},
              {id:'technicals-ind',         label:'📈 India Technicals (Qulla/Zanger/Bonde/Minervini)'},
              {id:'theme-rotation',         label:'🔄 Theme Rotation (US + India)'},
              {id:'turnaround',             label:'🔄 Turnarounds'},
              {id:'turnaround-analytics',   label:'📈 Turnaround Analytics'},
              {id:'usa-checklist',          label:'🇺🇸 USA Checklist'},
              {id:'checklist',              label:`📋 Research Checklist${excelRows.length?` (${excelRows.length} loaded)`:''}`},
              {id:'capital-alloc',          label:'💰 Capital Allocation'},
              {id:'reference',              label:'📚 Multibagger Reference'}, {id:'auto-screens', label:'🔍 Auto Screens (live)'},
            ] as const).map(tab=>{
              const active=activeTab===tab.id;
              return (
                <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{padding:'12px 22px',border:'none',cursor:'pointer',backgroundColor:'transparent',color:active?PURPLE:MUTED,fontSize:F.md,fontWeight:active?700:400,borderBottom:active?`2px solid ${PURPLE}`:'2px solid transparent',marginBottom:-1,flexShrink:0,transition:'all 0.15s'}}>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeTab==='analytics'             && <MultibaggerAnalytics indiaRows={excelRows} onSwitchTab={(t) => setActiveTab(t as any)} />}
      {activeTab==='excel'                 && <ExcelCompare rows={excelRows} setRows={setExcelRows} />}
      {activeTab==='usa'                   && <USACompare />}
      {/* PATCH 0872 — dedicated USA + Turnaround analytics dashboards */}
      {/* PATCH 1101ff — route USA Analytics through the full MultibaggerAnalytics
          component (which already supports INDIA/USA/BOTH scope) instead of the
          much smaller standalone USAAnalytics widget. User now gets full feature
          parity: 10-KPI stats strip, score histogram, Strong Buy / Avoid / Watch
          buckets with sub-categories, Operating Leverage Cluster, Cash-Rich lens,
          Valuation Gateway (PEG/PB-ROE), Today's Top 3 Buys, Decision Bridge,
          sector ranking, conviction overlap stats. The old USAAnalytics function
          is retained as dead code below for reference but no longer mounted. */}
      {activeTab==='usa-analytics'         && <MultibaggerAnalytics indiaRows={excelRows} onSwitchTab={(t) => setActiveTab(t as any)} initialScope="USA" />}
      {activeTab==='technicals-usa'        && <TechnicalsTab market="USA" />}
      {activeTab==='technicals-ind'        && <TechnicalsTab market="IND" />}
      {activeTab==='theme-rotation'        && <ThemeRotationTab />}
      {activeTab==='technicals'            && <TechnicalsTab market="USA" />}
      {activeTab==='turnaround'            && <TurnaroundCompare />}
      {activeTab==='turnaround-analytics'  && <TurnaroundAnalytics />}
      {activeTab==='usa-checklist'         && <USAChecklist />}
      {activeTab==='checklist'             && <MultibaggerChecklist excelRows={excelRows} />}
      {activeTab==='capital-alloc'         && <CapitalAllocationPanel />}
      {activeTab==='reference'             && <MultibaggerReference excelRows={excelRows} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0492 — MULTIBAGGER ANALYTICS TAB (default landing)
//
// Cross-stock overview built from the uploaded India + USA scoring data.
// Stats strip · Grade distribution · Sector exposure · R40/PEG outliers ·
// Conviction-Beats / Decision-Logbook crossover · Super Investor overlap.
// ═══════════════════════════════════════════════════════════════════════════
