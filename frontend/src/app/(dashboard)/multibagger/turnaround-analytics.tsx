'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo, useEffect } from 'react';
import { getConvictionTickers } from '@/lib/conviction-beats';
import { getDecision, subscribeDecisions } from '@/lib/decisions';
import { scoreTurnaroundRow, type TurnaroundResult, type TurnaroundStage, type TurnaroundArchetype } from '@/lib/turnaround';
import { ACCENT, BORDER, CARD_BG, F, GREEN, MUTED, ORANGE, PURPLE, RED, TEXT, YELLOW } from './constants';
import { TURNAROUND_STORAGE_KEY, resyncTurnaroundsFromServer, turnRowsAreStaleParsed } from './turnaround-tab';

export function TurnaroundAnalytics() {
  const [rows, setRows] = React.useState<TurnaroundResult[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(TURNAROUND_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      // zzz219 — always RE-SCORE stored rows so engine upgrades apply here too
      return Array.isArray(parsed) ? parsed.map((r: any) => scoreTurnaroundRow(r)) : [];
    } catch { return []; }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try {
        const raw = localStorage.getItem(TURNAROUND_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setRows(Array.isArray(parsed) ? parsed.map((r: any) => scoreTurnaroundRow(r)) : []);
      } catch { setRows([]); }
    };
    // zzz219 — self-heal stale-parsed rows without requiring a manual clear
    try {
      const raw = localStorage.getItem(TURNAROUND_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (turnRowsAreStaleParsed(parsed)) {
        resyncTurnaroundsFromServer().then(fresh => { if (fresh.length) setRows(fresh); });
      }
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === TURNAROUND_STORAGE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mb-upload:updated', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mb-upload:updated', refresh);
    };
  }, []);

  const [convictionSet, setConvictionSet] = React.useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set<string>(getConvictionTickers()); } catch { return new Set(); }
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

  const [decisionTick, bumpDec] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribeDecisions(() => bumpDec()), []);

  // zzz219 — decision-oriented analytics inputs
  const turnRowsAll = React.useMemo(() => rows.filter(r => r.archetype === 'TURNAROUND'), [rows]);
  const actionBoard = React.useMemo(() => turnRowsAll
    .filter(r => r.inBuyZone)
    .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
    .slice(0, 12), [turnRowsAll]);
  const dimAverages = React.useMemo(() => {
    const src = turnRowsAll.length ? turnRowsAll : rows;
    const n = src.length || 1;
    const avg = (k: keyof TurnaroundResult) => src.reduce((acc, r) => acc + (Number(r[k]) || 0), 0) / n;
    return [
      { label: 'EARNINGS', v: avg('earningsScore'), max: 20 },
      { label: 'OPERATIONS', v: avg('operationalScore'), max: 10 },
      { label: 'BALANCE SHEET', v: avg('balanceSheetScore'), max: 15 },
      { label: 'CONCALL', v: avg('concallScore'), max: 25 },
      { label: 'INDUSTRY', v: avg('industryScore'), max: 10 },
      { label: 'GOVERNANCE', v: avg('governanceScore'), max: 10 },
      { label: 'VALUATION', v: avg('valuationScore'), max: 10 },
    ];
  }, [turnRowsAll, rows]);
  const sectorCounts = React.useMemo(() => {
    const c = new Map<string, number>();
    for (const r of turnRowsAll) { const key = r.sector || '—'; c.set(key, (c.get(key) || 0) + 1); }
    return Array.from(c.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [turnRowsAll]);
  const killerRows = React.useMemo(() => rows
    .filter(r => (r.killers?.length || 0) > 0)
    .sort((a, b) => (b.killers?.length || 0) - (a.killers?.length || 0))
    .slice(0, 10), [rows]);

  // PATCH 0875 — Default view = real turnarounds only. User uploaded 100
  // rows from a general-purpose Screener, of which ~80 are quality
  // compounders or growth stocks that don't belong on this tab. Showing
  // analytics over all 100 diluted every signal (avg score 8.7, BUY-ZONE
  // 0, ALL panels 0). The toggle exposes the full dataset when the user
  // explicitly wants the mis-classification breakdown.
  const [viewMode, setViewMode] = React.useState<'TURNAROUNDS' | 'ALL'>('TURNAROUNDS');

  const empty = rows.length === 0;
  const GRADE_COLOR_TA: Record<string, string> = { 'A+': '#10b981', 'A': '#34d399', 'B+': '#f59e0b', 'B': '#f97316', 'C': '#fb923c', 'D': '#ef4444' };

  // PATCH 0875 — Pre-compute the dataset composition so the context banner
  // can warn when the upload is mostly non-turnaround rows.
  const datasetMix = React.useMemo(() => {
    const total = rows.length;
    const real = rows.filter(r => r.archetype === 'TURNAROUND').length;
    const quality = rows.filter(r => r.archetype === 'QUALITY').length;
    const growth = rows.filter(r => r.archetype === 'GROWTH').length;
    const valueTrap = rows.filter(r => r.archetype === 'VALUE-TRAP').length;
    const declining = rows.filter(r => r.archetype === 'DECLINING').length;
    const realPct = total ? Math.round(100 * real / total) : 0;
    const misclassified = total - real;
    return { total, real, quality, growth, valueTrap, declining, realPct, misclassified };
  }, [rows]);

  const stats = React.useMemo(() => {
    // PATCH 0875 — analytics now compute over the active view's subset.
    const displayRows = viewMode === 'TURNAROUNDS'
      ? rows.filter(r => r.archetype === 'TURNAROUND')
      : rows;
    const n = displayRows.length;
    const avgScore = n ? displayRows.reduce((s, r) => s + (r.totalScore || 0), 0) / n : 0;
    const buyZone = displayRows.filter(r => r.inBuyZone).length;
    const best = displayRows.filter(r => r.isBestCandidate).length;
    const confirmed = displayRows.filter(r => r.stage === 'CONFIRMED').length;
    const survivalPass = displayRows.filter(r => (r.survivalScore || 0) >= 6).length;
    const highConcall = displayRows.filter(r => (r.concallScore || 0) >= 15).length;
    const realTurnarounds = displayRows.filter(r => r.archetype === 'TURNAROUND').length;
    const valueTraps = displayRows.filter(r => r.archetype === 'VALUE-TRAP').length;
    // Inflection phase = institutional BUY window
    const inflection = displayRows.filter(r => r.phase === 3).length;
    // Stage distribution — filter zeros to keep the panel clean
    const stages: TurnaroundStage[] = ['DISTRESS', 'SETUP', 'EARLY-SHOOTS', 'PATTERN', 'CONFIRMED', 'MATURE', 'NOT-TURNAROUND'];
    const stageBucketsAll = stages.map(s => ({
      label: s,
      n: displayRows.filter(r => r.stage === s).length,
      color: s === 'EARLY-SHOOTS' ? GREEN : s === 'PATTERN' ? ACCENT : s === 'CONFIRMED' ? PURPLE : s === 'MATURE' ? YELLOW : s === 'SETUP' ? '#94a3b8' : s === 'DISTRESS' ? ORANGE : RED,
      emoji: s === 'EARLY-SHOOTS' ? '🌱' : s === 'PATTERN' ? '📈' : s === 'CONFIRMED' ? '✅' : s === 'MATURE' ? '🌅' : s === 'SETUP' ? '⏳' : s === 'DISTRESS' ? '🚫' : '❌',
    }));
    const stageBuckets = stageBucketsAll.filter(b => b.n > 0);
    // Archetype distribution
    const archetypes: TurnaroundArchetype[] = ['TURNAROUND', 'GROWTH', 'QUALITY', 'VALUE-TRAP', 'DECLINING', 'WAIT', 'NEUTRAL'];
    const archetypeBucketsAll = archetypes.map(a => ({
      label: a,
      n: displayRows.filter(r => r.archetype === a).length,
      color: a === 'TURNAROUND' ? PURPLE : a === 'GROWTH' ? GREEN : a === 'QUALITY' ? ACCENT : a === 'VALUE-TRAP' ? RED : a === 'DECLINING' ? ORANGE : a === 'WAIT' ? YELLOW : MUTED,
    }));
    const archetypeBuckets = archetypeBucketsAll.filter(b => b.n > 0);
    // Turnaround type
    const typeBucketsAll: Array<{ label: string; n: number; color: string }> = [
      { label: 'CYCLICAL',    n: displayRows.filter(r => r.turnaroundType === 'CYCLICAL').length,    color: ACCENT },
      { label: 'OPERATIONAL', n: displayRows.filter(r => r.turnaroundType === 'OPERATIONAL').length, color: PURPLE },
      { label: 'DISTRESSED',  n: displayRows.filter(r => r.turnaroundType === 'DISTRESSED').length,  color: ORANGE },
      { label: 'UNKNOWN',     n: displayRows.filter(r => r.turnaroundType === 'UNKNOWN' || !r.turnaroundType).length, color: MUTED },
    ];
    const typeAllUnknown = typeBucketsAll.find(b => b.label === 'UNKNOWN')?.n === n && n > 0;
    const typeBuckets = typeBucketsAll;
    // Phase
    const phaseBucketsAll = ([1, 2, 3, 4] as const).map(p => ({
      label: p === 1 ? '1 · COLLAPSE' : p === 2 ? '2 · STABILISATION' : p === 3 ? '3 · INFLECTION (BUY)' : '4 · RE-RATING',
      n: displayRows.filter(r => r.phase === p).length,
      color: p === 1 ? RED : p === 2 ? ORANGE : p === 3 ? GREEN : ACCENT,
    }));
    const phaseAllZero = phaseBucketsAll.every(b => b.n === 0) && n > 0;
    const phaseBuckets = phaseBucketsAll;
    // Survival score buckets
    const survivalBucketsAll = [
      { label: '0–2 (fragile)', n: displayRows.filter(r => (r.survivalScore ?? -1) >= 0 && (r.survivalScore ?? -1) <= 2).length, color: RED },
      { label: '3–5 (mid)',     n: displayRows.filter(r => (r.survivalScore ?? -1) >= 3 && (r.survivalScore ?? -1) <= 5).length, color: YELLOW },
      { label: '6–8 (robust)',  n: displayRows.filter(r => (r.survivalScore ?? -1) >= 6).length,                                  color: GREEN },
    ];
    const survivalAllFragile = survivalBucketsAll[0].n === n && n > 0;
    const survivalBuckets = survivalBucketsAll;
    // Decision overlay
    const decisionCounts = { BUY: 0, WATCH: 0, REJECTED: 0, NONE: 0 };
    displayRows.forEach(r => {
      const d = getDecision(r.symbol);
      if (!d) decisionCounts.NONE++;
      else if (d.status === 'BUY') decisionCounts.BUY++;
      else if (d.status === 'WATCH') decisionCounts.WATCH++;
      else if (d.status === 'REJECTED') decisionCounts.REJECTED++;
    });
    // Conviction overlap
    const cbUpper = new Set<string>([...convictionSet].map(s => s.toUpperCase().trim()));
    const convictionOverlap = displayRows.filter(r => cbUpper.has((r.symbol || '').toUpperCase().trim())).length;
    // Best candidates
    const bestList = [...displayRows].filter(r => r.isBestCandidate).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    // Top 12 overall
    const top12 = [...displayRows].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)).slice(0, 12);
    return {
      displayRows, n, avgScore, buyZone, best, confirmed, survivalPass, highConcall, realTurnarounds, valueTraps, inflection,
      stageBuckets, archetypeBuckets, typeBuckets, phaseBuckets, survivalBuckets,
      typeAllUnknown, phaseAllZero, survivalAllFragile,
      decisionCounts, convictionOverlap, bestList, top12,
    };
  }, [rows, convictionSet, decisionTick, viewMode]);

  if (empty) {
    return (
      <div style={{ maxWidth: 1800, margin: '0 auto', padding: '24px' }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '40px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🔄</div>
          <h2 style={{ fontSize: F.h2, color: TEXT, margin: '0 0 8px' }}>Turnaround Analytics — no data yet</h2>
          <p style={{ fontSize: F.md, color: MUTED, margin: 0 }}>
            Upload a turnaround Screener CSV on the <strong style={{ color: PURPLE }}>🔄 Turnarounds</strong> tab. This dashboard summarises stage, archetype, phase, survival score, and the institutional best-candidate shortlist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1800, margin: '0 auto', padding: '20px 24px 32px' }}>
      {/* ── PATCH 0875: CONTEXT BANNER — surfaces dataset mis-classification ─ */}
      {datasetMix.realPct < 80 && datasetMix.total > 0 && (
        <div style={{
          background: `linear-gradient(90deg, ${PURPLE}15, ${ACCENT}10)`,
          border: `1px solid ${PURPLE}40`,
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 20 }}>🔍</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: F.sm, color: TEXT, fontWeight: 700, marginBottom: 4 }}>
              Dataset mix · {datasetMix.real} real turnarounds in {datasetMix.total} uploaded rows ({datasetMix.realPct}%)
            </div>
            <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5 }}>
              {datasetMix.quality > 0 && <span>💎 {datasetMix.quality} QUALITY compounders · </span>}
              {datasetMix.growth > 0 && <span>🚀 {datasetMix.growth} GROWTH stocks · </span>}
              {datasetMix.valueTrap > 0 && <span style={{ color: RED }}>🧊 {datasetMix.valueTrap} VALUE-TRAPS · </span>}
              {datasetMix.declining > 0 && <span style={{ color: ORANGE }}>📉 {datasetMix.declining} DECLINING · </span>}
              <span>the others go on different tabs.</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: 4, background: '#0a0a0f', borderRadius: 8 }}>
            <button
              onClick={() => setViewMode('TURNAROUNDS')}
              style={{
                padding: '6px 14px',
                background: viewMode === 'TURNAROUNDS' ? PURPLE : 'transparent',
                color: viewMode === 'TURNAROUNDS' ? '#0a0a0f' : MUTED,
                border: 'none', borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
              }}
            >TURNAROUNDS ONLY ({datasetMix.real})</button>
            <button
              onClick={() => setViewMode('ALL')}
              style={{
                padding: '6px 14px',
                background: viewMode === 'ALL' ? PURPLE : 'transparent',
                color: viewMode === 'ALL' ? '#0a0a0f' : MUTED,
                border: 'none', borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
              }}
            >ALL ROWS ({datasetMix.total})</button>
          </div>
        </div>
      )}

      {/* ── STATS STRIP — PATCH 0875: trimmed 10 → 6 actionable KPIs ───── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          { label: viewMode === 'TURNAROUNDS' ? 'TURNAROUNDS' : 'ALL ROWS', value: stats.n.toString(), sub: viewMode === 'TURNAROUNDS' ? `of ${datasetMix.total} uploaded` : undefined, color: PURPLE },
          { label: 'AVG SCORE',          value: stats.avgScore.toFixed(1),                                                       sub: 'out of 100', color: ACCENT },
          { label: 'BUY-ZONE',           value: stats.buyZone.toString(),                                                        sub: 'EARLY-SHOOTS + PATTERN', color: stats.buyZone > 0 ? GREEN : MUTED },
          { label: 'INFLECTION (P3)',    value: stats.inflection.toString(),                                                     sub: 'institutional buy window', color: stats.inflection > 0 ? GREEN : MUTED },
          { label: 'BEST CAND.',         value: stats.best.toString(),                                                           sub: 'P3 · survival≥6 · no killers', color: stats.best > 0 ? GREEN : MUTED },
          { label: '⚠ KILLERS',          value: killerRows.length.toString(),                                                    sub: 'hard disqualifiers present', color: killerRows.length > 0 ? RED : MUTED },
        ].map((s) => (
          <div key={s.label} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: 0.6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, fontFamily: 'ui-monospace,monospace', marginTop: 2 }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: 9, color: MUTED, marginTop: 2, letterSpacing: 0.3 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── STAGE + ARCHETYPE DISTRIBUTIONS ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>STAGE DISTRIBUTION</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Lifecycle: DISTRESS → EARLY-SHOOTS (BUY-ZONE 1) → PATTERN (BUY-ZONE 2) → CONFIRMED → MATURE</div>
          {stats.stageBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 18, fontSize: 14 }}>{b.emoji}</div>
                <div style={{ width: 130, fontSize: 11, color: TEXT, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 56, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>ARCHETYPE BREAKDOWN</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>What each row really IS — non-TURNAROUND archetypes belong on different tabs</div>
          {stats.archetypeBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 100, fontSize: 11, color: b.color, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 56, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── TYPE + PHASE + SURVIVAL ─────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>TURNAROUND TYPE</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Cyclical = sector-driven · Operational = mgmt-driven · Distressed = balance-sheet first</div>
          {stats.typeAllUnknown ? (
            <div style={{ fontSize: 11, color: ORANGE, padding: '10px 12px', background: `${ORANGE}10`, border: `1px solid ${ORANGE}40`, borderRadius: 6, lineHeight: 1.5 }}>
              <strong>Data missing.</strong> All rows classified UNKNOWN. The type classifier needs: <span style={{ color: TEXT }}>Loss-making years 5y</span>, <span style={{ color: TEXT }}>OPM history (Y2-Y5)</span>, and <span style={{ color: TEXT }}>D/E history</span>. Add these as custom Screener.in ratios and re-upload.
            </div>
          ) : stats.typeBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 100, fontSize: 11, color: TEXT, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>PLAYBOOK PHASE</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Phase 3 is the institutional BUY window — alpha before consensus</div>
          {stats.phaseAllZero ? (
            <div style={{ fontSize: 11, color: ORANGE, padding: '10px 12px', background: `${ORANGE}10`, border: `1px solid ${ORANGE}40`, borderRadius: 6, lineHeight: 1.5 }}>
              <strong>Data missing.</strong> Phase classifier returned 0 for every row. It needs <span style={{ color: TEXT }}>5-year sales/PAT/OPM history</span> + <span style={{ color: TEXT }}>concall paste-text</span> per row (the Turnarounds tab has a per-row concall input — paste the latest transcript or guidance bullets there).
            </div>
          ) : stats.phaseBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 140, fontSize: 11, color: b.color, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>SURVIVAL SCORE</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Playbook Ch.4 gate — ≥6 = cleared institutional bankruptcy filter</div>
          {stats.survivalAllFragile ? (
            <div style={{ fontSize: 11, color: ORANGE, padding: '10px 12px', background: `${ORANGE}10`, border: `1px solid ${ORANGE}40`, borderRadius: 6, lineHeight: 1.5 }}>
              <strong>Data missing.</strong> Survival ≡ 0 for every row. Add <span style={{ color: TEXT }}>Interest coverage ratio</span>, <span style={{ color: TEXT }}>Pledged percentage</span>, and <span style={{ color: TEXT }}>D/E (current)</span> columns from Screener.in and re-upload to populate the bankruptcy-gate score.
            </div>
          ) : stats.survivalBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 110, fontSize: 11, color: TEXT, fontWeight: 700 }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── zzz219: 🎯 ACTION BOARD — the decision table ─────────── */}
      <div style={{ background: CARD_BG, border: `1px solid ${GREEN}40`, borderRadius: 10, padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: F.sm, fontWeight: 800, color: GREEN, marginBottom: 4 }}>🎯 ACTION BOARD — BUY-ZONE TURNAROUNDS ({actionBoard.length})</div>
        <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Archetype TURNAROUND · stage EARLY-SHOOTS / PATTERN · ranked by score · MAX POS = engine&apos;s suggested position ceiling · P3 ★ = institutional buy window</div>
        {actionBoard.length === 0
          ? <div style={{ fontSize: 11, color: MUTED, padding: 12, textAlign: 'center' }}>Nothing in the buy zone right now — check back after the next sync.</div>
          : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: MUTED, textAlign: 'left' }}>
                  {['#', 'SYMBOL', 'COMPANY', 'STAGE', 'PHASE', 'TYPE', 'SURV', 'EARN', 'BAL', 'OPS', 'SCORE', 'MAX POS'].map((h, hi) => (
                    <th key={h} style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: hi >= 6 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {actionBoard.map((r, i) => (
                  <tr key={r.symbol} style={{ color: TEXT }}>
                    <td style={{ padding: '6px 8px', color: MUTED, fontFamily: 'ui-monospace,monospace' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: MUTED, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.company}>{r.company}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: r.stageColor, fontWeight: 700 }}>{r.stageEmoji} {r.stage}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: r.phase === 3 ? GREEN : ACCENT, fontWeight: 700 }}>P{r.phase}{r.phase === 3 ? ' ★' : ''}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: MUTED }}>{r.turnaroundType && r.turnaroundType !== 'UNKNOWN' ? r.turnaroundType : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: (r.survivalScore ?? 0) >= 6 ? GREEN : YELLOW, fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>{r.survivalScore}/8</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{Math.round(r.earningsScore || 0)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{Math.round(r.balanceSheetScore || 0)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{Math.round(r.operationalScore || 0)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>{Math.round(r.totalScore || 0)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: ACCENT, fontWeight: 700 }}>{r.suggestedPositionPct != null ? `${r.suggestedPositionPct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── BEST CANDIDATES + DIMENSION STRENGTH ─────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: GREEN, marginBottom: 4 }}>⭐ BEST CANDIDATES ({stats.bestList.length})</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Pass: TURNAROUND · phase 3 · survival ≥6 · no killers · score ≥35 (≥40 with concall pasted)</div>
          {stats.bestList.length === 0 && <div style={{ fontSize: 11, color: MUTED, padding: 12, textAlign: 'center' }}>No row passes the institutional best-candidate filter today.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.bestList.slice(0, 10).map(r => {
              const d = getDecision(r.symbol);
              const inCb = convictionSet.has(r.symbol.toUpperCase());
              return (
                <div key={r.symbol} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#0a0a0f', borderRadius: 6 }}>
                  <div style={{ width: 110, fontSize: 12, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                  <div style={{ flex: 1, fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.company}>{r.company}</div>
                  <div style={{ fontSize: 10, color: r.stageColor, padding: '2px 6px', background: `${r.stageColor}20`, borderRadius: 4, fontWeight: 700 }}>{r.stageEmoji} {r.stage}</div>
                  <div style={{ fontSize: 10, color: ACCENT, padding: '2px 6px', background: `${ACCENT}20`, borderRadius: 4, fontWeight: 700 }}>P{r.phase}</div>
                  <div style={{ width: 50, fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace', fontWeight: 800, textAlign: 'right' }}>{(r.totalScore || 0).toFixed(0)}</div>
                  {d && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700 }}>{d.status}</span>}
                  {inCb && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: `${PURPLE}30`, color: PURPLE, fontWeight: 700 }}>CB</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>DIMENSION STRENGTH</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Cohort averages across {turnRowsAll.length || rows.length} rows — where the recovery signal actually comes from</div>
          {dimAverages.map(d => {
            const pct = Math.max(0, Math.min(100, (d.v / d.max) * 100));
            const barColor = pct >= 55 ? GREEN : pct >= 30 ? YELLOW : MUTED;
            return (
              <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 104, fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: 0.4 }}>{d.label}</div>
                <div style={{ flex: 1, height: 10, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: barColor }} />
                </div>
                <div style={{ width: 56, fontSize: 11, color: TEXT, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{d.v.toFixed(1)}/{d.max}</div>
              </div>
            );
          })}
          <div style={{ marginTop: 10, padding: 8, background: '#0a0a0f', borderRadius: 6, fontSize: 10, color: MUTED }}>
            CONCALL at 0? Paste narratives on your shortlist rows in the 🔄 Turnarounds tab — it&apos;s 25% of the institutional signal.
          </div>
        </div>
      </div>

      {/* ── zzz219: SECTOR CONCENTRATION + KILLER FLAGS ──────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>🏭 SECTOR CONCENTRATION</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Where the turnarounds cluster — sector recoveries move in packs</div>
          {sectorCounts.length === 0 && <div style={{ fontSize: 11, color: MUTED }}>No turnaround rows yet.</div>}
          {sectorCounts.map(([sec, n]) => {
            const maxN = sectorCounts[0]?.[1] || 1;
            return (
              <div key={sec} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                <div style={{ width: 190, fontSize: 11, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sec}>{sec}</div>
                <div style={{ flex: 1, height: 9, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(n / maxN) * 100}%`, height: '100%', background: PURPLE }} />
                </div>
                <div style={{ width: 24, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{n}</div>
              </div>
            );
          })}
        </div>
        <div style={{ background: CARD_BG, border: `1px solid ${RED}30`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F.sm, fontWeight: 800, color: RED, marginBottom: 4 }}>⚠ KILLER FLAGS ({killerRows.length})</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Hard disqualifiers (playbook Ch.4) — do NOT buy these regardless of score</div>
          {killerRows.length === 0 && <div style={{ fontSize: 11, color: MUTED }}>No killer flags in the current set. ✅</div>}
          {killerRows.map(r => (
            <div key={r.symbol} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 8px', background: '#0a0a0f', borderRadius: 6, marginBottom: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: TEXT, fontFamily: 'ui-monospace,monospace', width: 100 }}>{r.symbol}</span>
              <span style={{ fontSize: 10, color: RED, flex: 1 }}>{(r.killers || []).slice(0, 2).join(' · ')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── TOP 12 BY TOTAL SCORE ───────────────────────────────── */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>TOP 12 BY TOTAL SCORE</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: MUTED, textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>#</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>SYMBOL</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>COMPANY</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>STAGE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>PHASE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>TYPE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>SCORE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>GRADE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>CONCALL</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>SURVIVAL</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>TAGS</th>
              </tr>
            </thead>
            <tbody>
              {stats.top12.map((r, i) => {
                const d = getDecision(r.symbol);
                const inCb = convictionSet.has(r.symbol.toUpperCase());
                return (
                  <tr key={r.symbol} style={{ color: TEXT }}>
                    <td style={{ padding: '6px 8px', color: MUTED, fontFamily: 'ui-monospace,monospace' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: MUTED, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.company}>{r.company}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: r.stageColor, fontWeight: 700 }}>{r.stageEmoji} {r.stage}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: ACCENT, fontWeight: 700 }}>{r.phase ? `P${r.phase}` : '—'}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: MUTED }}>{r.turnaroundType || '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontWeight: 800 }}>{(r.totalScore || 0).toFixed(0)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: GRADE_COLOR_TA[r.grade] || TEXT, fontWeight: 800 }}>{r.grade}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.concallScore ?? -1) >= 15 ? GREEN : MUTED }}>{r.concallScore != null ? r.concallScore.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.survivalScore ?? -1) >= 6 ? GREEN : MUTED }}>{r.survivalScore != null ? r.survivalScore.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {r.isBestCandidate && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: `${GREEN}30`, color: GREEN, fontWeight: 700, marginLeft: 2 }}>BEST</span>}
                      {d && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700, marginLeft: 2 }}>{d.status}</span>}
                      {inCb && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: `${PURPLE}30`, color: PURPLE, fontWeight: 700, marginLeft: 2 }}>CB</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
