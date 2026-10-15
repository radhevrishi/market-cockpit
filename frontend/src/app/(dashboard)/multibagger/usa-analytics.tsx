'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo, useEffect } from 'react';
import { getConvictionTickers } from '@/lib/conviction-beats';
import { getDecision, subscribeDecisions } from '@/lib/decisions';
import type { Grade } from '@/lib/multibagger-india-scoring';
import type { USAResult } from '@/lib/multibagger-usa-scoring';
import { ACCENT, BORDER, CARD_BG, F, GREEN, MUTED, ORANGE, PURPLE, RED, TEXT, YELLOW } from './constants';
import { USA_STORAGE_KEY } from './mem-cache';

export function USAAnalytics() {
  // Live USA dataset — single source of truth read from LS, refreshed on
  // every relevant event so this tab never shows stale data.
  const [rows, setRows] = React.useState<USAResult[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(USA_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try {
        const raw = localStorage.getItem(USA_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setRows(Array.isArray(parsed) ? parsed : []);
      } catch { setRows([]); }
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === USA_STORAGE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mb-upload:updated', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mb-upload:updated', refresh);
    };
  }, []);

  // Conviction-Beats overlay (live).
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

  // Decision-log tick — included in every consumer memo so BUY/WATCH/REJECT
  // changes propagate without a page reload.
  const [decisionTick, bumpDec] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribeDecisions(() => bumpDec()), []);

  // Pre-upload baseline for score-delta panels.
  const prevScoreMap = React.useMemo<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('mb_usa_prev_scores_v1') || '{}'); } catch { return {}; }
  }, [rows.length]);

  const empty = rows.length === 0;
  const F2 = F;
  const GRADE_COLOR_US: Record<string, string> = { 'A+': '#10b981', 'A': '#34d399', 'B+': '#f59e0b', 'B': '#f97316', 'C': '#fb923c', 'D': '#ef4444' };

  const stats = React.useMemo(() => {
    const n = rows.length;
    const avgScore = n ? rows.reduce((s, r) => s + (r.score || 0), 0) / n : 0;
    const topGradeCount = rows.filter(r => r.grade === 'A+' || r.grade === 'A').length;
    const r40Pass = rows.filter(r => (r.ruleOf40 ?? -999) >= 40).length;
    const r40Elite = rows.filter(r => (r.ruleOf40 ?? -999) >= 60).length;
    const piotroskiPass = rows.filter(r => (r.piotroskiFScore ?? -1) >= 7).length;
    const altmanSafe = rows.filter(r => (r.altmanZScore ?? -1) >= 3).length;
    const acceleratingCount = rows.filter(r => r.accelSignal === 'ACCELERATING').length;
    const fcfDivCount = rows.filter(r => r.fcfOpDivergence).length;
    const postRunCount = rows.filter(r => r.postRunStretched).length;
    const earningsCloseCount = rows.filter(r => (r.earningsProximityDays ?? 999) <= 7).length;
    const totalMcapB = rows.reduce((s, r) => s + (r.marketCapB || 0), 0);
    const avgMcapB = n ? totalMcapB / n : 0;
    // Grade distribution
    const gradeBuckets: Record<string, number> = { 'A+': 0, 'A': 0, 'B+': 0, 'B': 0, 'C': 0, 'D': 0 };
    rows.forEach(r => { if (r.grade && gradeBuckets[r.grade] != null) gradeBuckets[r.grade]++; });
    // Sector exposure
    const sectorMap = new Map<string, number>();
    rows.forEach(r => {
      const s = (r.sector || 'Unknown').trim() || 'Unknown';
      sectorMap.set(s, (sectorMap.get(s) || 0) + 1);
    });
    // PATCH 0876 — Trim sector exposure 8 → 5 (top 5 is enough for
    // concentration risk; longer tail is noise on a screen-glance).
    const topSectors = Array.from(sectorMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    // PATCH 0876 — R40 buckets collapsed 6 → 4. The <0 / 0–20 / 20–40
    // tiers all mean "fails the Rule of 40" institutionally — there's
    // no decision difference between them. The right cuts are:
    // FAIL (<40) · PASS (40–60) · STRONG (60–80) · ELITE (≥80).
    const r40Buckets: Array<{ label: string; n: number; color: string }> = [
      { label: 'FAIL (<40)',   n: rows.filter(r => (r.ruleOf40 ?? -999) < 40).length,                                            color: RED },
      { label: 'PASS (40–60)', n: rows.filter(r => { const x = r.ruleOf40 ?? -999; return x >= 40 && x < 60; }).length,           color: GREEN },
      { label: 'STRONG (60–80)', n: rows.filter(r => { const x = r.ruleOf40 ?? -999; return x >= 60 && x < 80; }).length,         color: ACCENT },
      { label: 'ELITE (≥80)',  n: rows.filter(r => (r.ruleOf40 ?? -999) >= 80).length,                                          color: PURPLE },
    ];
    // Piotroski buckets
    const piotroskiBuckets = [
      { label: '0–3 (weak)',   n: rows.filter(r => (r.piotroskiFScore ?? -1) >= 0 && (r.piotroskiFScore ?? -1) <= 3).length, color: RED },
      { label: '4–6 (mid)',    n: rows.filter(r => (r.piotroskiFScore ?? -1) >= 4 && (r.piotroskiFScore ?? -1) <= 6).length, color: YELLOW },
      { label: '7–9 (elite)',  n: rows.filter(r => (r.piotroskiFScore ?? -1) >= 7).length,                                   color: GREEN },
    ];
    // Decision overlay
    const decisionCounts = { BUY: 0, WATCH: 0, REJECTED: 0, NONE: 0 };
    rows.forEach(r => {
      const d = getDecision(r.symbol, 'US');
      if (!d) decisionCounts.NONE++;
      else if (d.status === 'BUY') decisionCounts.BUY++;
      else if (d.status === 'WATCH') decisionCounts.WATCH++;
      else if (d.status === 'REJECTED') decisionCounts.REJECTED++;
    });
    // Conviction overlap (case-insensitive)
    const cbUpper = new Set<string>([...convictionSet].map(s => s.toUpperCase().trim()));
    const convictionOverlap = rows.filter(r => cbUpper.has((r.symbol || '').toUpperCase().trim())).length;
    // Score deltas (vs pre-upload baseline)
    const scoreDeltas = rows.map(r => {
      const prev = prevScoreMap[r.symbol];
      return prev === undefined ? null : (r.score - prev);
    }).filter((x): x is number => x !== null);
    const newSinceLast = rows.filter(r => prevScoreMap[r.symbol] === undefined).length;
    const reratingUp = rows.filter(r => {
      const prev = prevScoreMap[r.symbol];
      return prev !== undefined && (r.score - prev) >= 5;
    }).sort((a, b) => (b.score - prevScoreMap[b.symbol]) - (a.score - prevScoreMap[a.symbol]));
    const ratingDown = rows.filter(r => {
      const prev = prevScoreMap[r.symbol];
      return prev !== undefined && (r.score - prev) <= -5;
    }).sort((a, b) => (a.score - prevScoreMap[a.symbol]) - (b.score - prevScoreMap[b.symbol]));
    // Leaderboard — top 10 (was top 15; tighter view).
    const top10 = [...rows].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
    // PATCH 0876 — Institutional TOP BUYS shortlist. The right question
    // isn't "what's the average grade" — it's "of 300 rows, which 5-10
    // would I actually open a position on right now". Filter chain:
    //  • Grade A+ or A           — fundamentals pass institutional bar
    //  • R40 ≥ 40                — growth + cash-gen efficiency
    //  • Piotroski ≥ 6           — financial-strength gate (Piotroski 2000)
    //  • No FCF/Op divergence    — earnings quality clean
    //  • Not post-run stretched  — entry not late-cycle
    //  • Earnings > 7 days away  — no print-risk window
    // The strict version (≥7 Piotroski, no flags) is too narrow for a
    // 300-stock universe; relaxing Piotroski to ≥6 + dropping flag-free
    // requirement to "no critical flags" yields a useful 5-15 candidate
    // shortlist on a typical universe.
    const topBuys = [...rows]
      .filter(r => (r.grade === 'A+' || r.grade === 'A'))
      .filter(r => (r.ruleOf40 ?? -999) >= 40)
      .filter(r => (r.piotroskiFScore ?? -1) >= 6)
      .filter(r => !r.fcfOpDivergence)
      .filter(r => !r.postRunStretched)
      .filter(r => (r.earningsProximityDays ?? 999) > 7)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 12);
    // PATCH 0876 — AT-RISK shortlist. The user explicitly wants warnings,
    // not just opportunities. Surface every row that has at least one
    // forensic flag, sorted by score (so the highest-conviction risks
    // appear first — those are the most dangerous because the user is
    // most likely to act on them without realising the flag).
    const atRiskRows = [...rows]
      .filter(r => r.fcfOpDivergence || r.postRunStretched || (r.earningsProximityDays ?? 999) <= 7)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 12);
    return {
      n, avgScore, topGradeCount, r40Pass, r40Elite, piotroskiPass, altmanSafe,
      acceleratingCount, fcfDivCount, postRunCount, earningsCloseCount,
      totalMcapB, avgMcapB, gradeBuckets, topSectors, r40Buckets, piotroskiBuckets,
      decisionCounts, convictionOverlap, scoreDeltas, newSinceLast,
      reratingUp, ratingDown, top10, topBuys, atRiskRows,
    };
  }, [rows, convictionSet, prevScoreMap, decisionTick]);

  if (empty) {
    return (
      <div style={{ maxWidth: 1800, margin: '0 auto', padding: '24px' }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '40px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🇺🇸</div>
          <h2 style={{ fontSize: F.h2, color: TEXT, margin: '0 0 8px' }}>USA Analytics — no data yet</h2>
          <p style={{ fontSize: F.md, color: MUTED, margin: 0 }}>
            Upload a USA TradingView export on the <strong style={{ color: PURPLE }}>🇺🇸 USA Multibagger</strong> tab. This dashboard will then summarise grade distribution, Rule of 40, Piotroski, forensic flags, decision tags, and conviction-beats overlap.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1800, margin: '0 auto', padding: '20px 24px 32px' }}>
      {/* ── PATCH 0876 STATS STRIP — trimmed 10 → 6 actionable KPIs ────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          { label: 'STOCKS',        value: stats.n.toString(),                          sub: 'in current upload',           color: PURPLE },
          { label: 'TOP-TIER',      value: `${stats.topGradeCount}`,                    sub: `A+/A grade · ${stats.n ? (100 * stats.topGradeCount / stats.n).toFixed(0) : 0}%`, color: stats.topGradeCount > 0 ? GREEN : MUTED },
          { label: 'R40 ELITE',     value: stats.r40Elite.toString(),                   sub: 'rule of 40 ≥60',              color: stats.r40Elite > 0 ? PURPLE : MUTED },
          { label: 'PIOTROSKI ≥7',  value: stats.piotroskiPass.toString(),              sub: 'elite financial quality',     color: stats.piotroskiPass > 0 ? GREEN : MUTED },
          { label: 'FORENSIC ⚠',    value: (stats.fcfDivCount + stats.postRunCount).toString(), sub: 'flagged risks',       color: (stats.fcfDivCount + stats.postRunCount) > 0 ? RED : MUTED },
          { label: 'CONVICTION',    value: stats.convictionOverlap.toString(),          sub: 'overlap with your bench',     color: stats.convictionOverlap > 0 ? PURPLE : MUTED },
        ].map((s) => (
          <div key={s.label} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: 0.6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, fontFamily: 'ui-monospace,monospace', marginTop: 2 }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: 9, color: MUTED, marginTop: 2, letterSpacing: 0.3 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── PATCH 0876: ACTIONABLE SHORTLISTS — what to buy, what to avoid ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${GREEN}40`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: GREEN, marginBottom: 4 }}>🎯 TOP BUYS ({stats.topBuys.length})</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
            Grade A+/A · R40 ≥40 · Piotroski ≥6 · clean forensics · earnings &gt;7d away
          </div>
          {stats.topBuys.length === 0 ? (
            <div style={{ fontSize: 11, color: MUTED, padding: 12, textAlign: 'center', background: '#0a0a0f', borderRadius: 6 }}>
              No rows pass the institutional buy gate today. Likely cause: too few A+/A grades, or every top-graded row has a forensic flag or earnings in the next 7 days.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.topBuys.map(r => {
                const d = getDecision(r.symbol, 'US');
                const inCb = convictionSet.has(r.symbol.toUpperCase());
                return (
                  <div key={r.symbol} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#0a0a0f', borderRadius: 6 }}>
                    <div style={{ width: 70, fontSize: 12, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                    <div style={{ flex: 1, fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.sector}>{r.sector || ''}</div>
                    <div style={{ fontSize: 10, color: GRADE_COLOR_US[r.grade] || TEXT, padding: '2px 6px', background: `${GRADE_COLOR_US[r.grade] || TEXT}20`, borderRadius: 4, fontWeight: 700 }}>{r.grade}</div>
                    <div style={{ fontSize: 10, color: ACCENT, padding: '2px 6px', background: `${ACCENT}20`, borderRadius: 4, fontWeight: 700, fontFamily: 'ui-monospace,monospace' }} title="Rule of 40">R40 {r.ruleOf40 != null ? r.ruleOf40.toFixed(0) : '—'}</div>
                    <div style={{ width: 36, fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace', fontWeight: 800, textAlign: 'right' }}>{(r.score || 0).toFixed(0)}</div>
                    {d && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700 }}>{d.status}</span>}
                    {inCb && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: `${PURPLE}30`, color: PURPLE, fontWeight: 700 }}>CB</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${RED}40`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: RED, marginBottom: 4 }}>⚠ AT-RISK ROWS ({stats.atRiskRows.length})</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
            Has at least one forensic flag: FCF/Op divergence · post-run stretched · earnings ≤7d. Sorted by score (highest-conviction risk first).
          </div>
          {stats.atRiskRows.length === 0 ? (
            <div style={{ fontSize: 11, color: GREEN, padding: 12, textAlign: 'center', background: '#0a0a0f', borderRadius: 6 }}>
              ✓ No row in the universe is currently flagged for forensic risk, post-run extension, or near-term earnings.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.atRiskRows.map(r => {
                const flags: Array<{ label: string; color: string }> = [];
                if (r.fcfOpDivergence) flags.push({ label: 'FCF≠OP', color: RED });
                if (r.postRunStretched) flags.push({ label: 'STRETCHED', color: ORANGE });
                if ((r.earningsProximityDays ?? 999) <= 7) flags.push({ label: `ER ${r.earningsProximityDays}d`, color: YELLOW });
                const d = getDecision(r.symbol, 'US');
                return (
                  <div key={r.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#0a0a0f', borderRadius: 6 }}>
                    <div style={{ width: 70, fontSize: 12, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                    <div style={{ flex: 1, fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector || ''}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {flags.map(f => (
                        <span key={f.label} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: `${f.color}25`, color: f.color, fontWeight: 700 }}>{f.label}</span>
                      ))}
                    </div>
                    <div style={{ width: 36, fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace', fontWeight: 800, textAlign: 'right' }}>{(r.score || 0).toFixed(0)}</div>
                    {d && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700 }}>{d.status}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── DISTRIBUTIONS ROW ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        {/* Grade distribution */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>GRADE DISTRIBUTION</div>
          {(['A+','A','B+','B','C','D'] as const).map(g => {
            const c = stats.gradeBuckets[g] || 0;
            const pct = stats.n ? (100 * c / stats.n) : 0;
            return (
              <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 28, fontSize: 12, fontWeight: 800, color: GRADE_COLOR_US[g] }}>{g}</div>
                <div style={{ flex: 1, height: 14, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: GRADE_COLOR_US[g], transition: 'width 0.3s' }} />
                </div>
                <div style={{ width: 64, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{c} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
        </div>

        {/* Sector exposure */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>SECTOR EXPOSURE (TOP 8)</div>
          {stats.topSectors.length === 0 && <div style={{ fontSize: 12, color: MUTED }}>No sector tags found in dataset.</div>}
          {stats.topSectors.map(([sector, count]) => {
            const pct = stats.n ? (100 * count / stats.n) : 0;
            return (
              <div key={sector} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 130, fontSize: 11, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sector}>{sector}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: ACCENT }} />
                </div>
                <div style={{ width: 56, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{count} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── QUALITY HISTOGRAMS ROW ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>RULE OF 40 BUCKETS</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>RevGrowth + FCF Margin · ≥40 institutional pass · ≥60 strong · ≥80 elite</div>
          {stats.r40Buckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                <div style={{ width: 60, fontSize: 11, color: TEXT }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>PIOTROSKI F-SCORE</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>9-pt financial-strength scale · ≥7 = elite quality (Piotroski 2000)</div>
          {stats.piotroskiBuckets.map(b => {
            const pct = stats.n ? (100 * b.n / stats.n) : 0;
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                <div style={{ width: 100, fontSize: 11, color: TEXT }}>{b.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{b.n}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── FORENSIC FLAGS + DECISION OVERLAY ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>FORENSIC FLAGS</div>
          {[
            { label: 'FCF / OP divergence', n: stats.fcfDivCount, color: RED, hint: 'Operating profit grows but FCF lags — accrual/working-cap warning' },
            { label: 'Post-run stretched',  n: stats.postRunCount, color: ORANGE, hint: 'Big 1Y run + extended valuation — late-cycle entry risk' },
            { label: 'Earnings ≤7 days',    n: stats.earningsCloseCount, color: YELLOW, hint: 'Print imminent — sizing should reflect event risk' },
          ].map(f => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${BORDER}` }}>
              <div>
                <div style={{ fontSize: 12, color: TEXT, fontWeight: 700 }}>{f.label}</div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{f.hint}</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: f.n > 0 ? f.color : MUTED, fontFamily: 'ui-monospace,monospace' }}>{f.n}</div>
            </div>
          ))}
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 4 }}>DECISION OVERLAY</div>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 12 }}>Live counts from your decision logbook · refreshes immediately on tag change</div>
          {[
            { label: 'BUY',      n: stats.decisionCounts.BUY,      color: GREEN },
            { label: 'WATCH',    n: stats.decisionCounts.WATCH,    color: YELLOW },
            { label: 'REJECTED', n: stats.decisionCounts.REJECTED, color: RED },
            { label: 'No tag',   n: stats.decisionCounts.NONE,     color: MUTED },
          ].map(d => {
            const pct = stats.n ? (100 * d.n / stats.n) : 0;
            return (
              <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 80, fontSize: 12, color: d.color, fontWeight: 700 }}>{d.label}</div>
                <div style={{ flex: 1, height: 12, background: '#0a0a0f', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: d.color }} />
                </div>
                <div style={{ width: 70, fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace', textAlign: 'right' }}>{d.n} · {pct.toFixed(0)}%</div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, padding: 10, background: '#0a0a0f', borderRadius: 6, fontSize: 11, color: MUTED }}>
            Decision coverage: <span style={{ color: TEXT, fontWeight: 700 }}>{stats.n ? (100 * (stats.n - stats.decisionCounts.NONE) / stats.n).toFixed(0) : 0}%</span> of universe tagged
          </div>
        </div>
      </div>

      {/* ── RE-RATING DELTAS ──────────────────────────────────────── */}
      {(stats.reratingUp.length > 0 || stats.ratingDown.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: F2.sm, fontWeight: 800, color: GREEN, marginBottom: 4 }}>↑ RE-RATING (score +5 or better)</div>
            <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Vs your last upload baseline — fundamentals improving</div>
            {stats.reratingUp.slice(0, 8).map(r => {
              const prev = prevScoreMap[r.symbol];
              const delta = r.score - prev;
              return (
                <div key={r.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace' }}>{prev.toFixed(0)} → {r.score.toFixed(0)}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: GREEN, fontFamily: 'ui-monospace,monospace' }}>+{delta.toFixed(0)}</div>
                  </div>
                </div>
              );
            })}
            {stats.reratingUp.length === 0 && <div style={{ fontSize: 11, color: MUTED, padding: 8 }}>No upward re-ratings in this batch.</div>}
          </div>
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: F2.sm, fontWeight: 800, color: RED, marginBottom: 4 }}>↓ DROP ALERTS (score −5 or worse)</div>
            <div style={{ fontSize: 10, color: MUTED, marginBottom: 10 }}>Vs your last upload baseline — review or trim</div>
            {stats.ratingDown.slice(0, 8).map(r => {
              const prev = prevScoreMap[r.symbol];
              const delta = r.score - prev;
              return (
                <div key={r.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 12, color: TEXT, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontSize: 11, color: MUTED, fontFamily: 'ui-monospace,monospace' }}>{prev.toFixed(0)} → {r.score.toFixed(0)}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: RED, fontFamily: 'ui-monospace,monospace' }}>{delta.toFixed(0)}</div>
                  </div>
                </div>
              );
            })}
            {stats.ratingDown.length === 0 && <div style={{ fontSize: 11, color: MUTED, padding: 8 }}>No score drops in this batch.</div>}
          </div>
        </div>
      )}

      {/* ── TOP 15 LEADERBOARD ────────────────────────────────────── */}
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: F2.sm, fontWeight: 800, color: TEXT, marginBottom: 12 }}>TOP 10 BY SCORE</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: MUTED, textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>#</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>SYMBOL</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}` }}>SECTOR</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>SCORE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>GRADE</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>R40</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>PIOTROSKI</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>MCAP $B</th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>TAGS</th>
              </tr>
            </thead>
            <tbody>
              {stats.top10.map((r, i) => {
                const d = getDecision(r.symbol, 'US');
                const inCb = convictionSet.has(r.symbol.toUpperCase());
                return (
                  <tr key={r.symbol} style={{ color: TEXT }}>
                    <td style={{ padding: '6px 8px', color: MUTED, fontFamily: 'ui-monospace,monospace' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>{r.symbol}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: MUTED, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector || ''}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontWeight: 700 }}>{(r.score || 0).toFixed(1)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: GRADE_COLOR_US[r.grade] || TEXT, fontWeight: 800 }}>{r.grade}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.ruleOf40 ?? -999) >= 40 ? GREEN : MUTED }}>{r.ruleOf40 != null ? r.ruleOf40.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.piotroskiFScore ?? -1) >= 7 ? GREEN : MUTED }}>{r.piotroskiFScore != null ? r.piotroskiFScore.toFixed(0) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: MUTED }}>{r.marketCapB != null ? r.marketCapB.toFixed(1) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {d && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: d.status === 'BUY' ? `${GREEN}30` : d.status === 'WATCH' ? `${YELLOW}30` : `${RED}30`, color: d.status === 'BUY' ? GREEN : d.status === 'WATCH' ? YELLOW : RED, fontWeight: 700, marginLeft: 4 }}>{d.status}</span>}
                      {inCb && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${PURPLE}30`, color: PURPLE, fontWeight: 700, marginLeft: 4 }}>CB</span>}
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

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0872 — TURNAROUND ANALYTICS TAB
//
// Self-contained analytics dashboard for the Turnaround universe. Reads
// TurnaroundResult[] from localStorage with proper listeners (storage +
// mb-upload:updated) plus a decision-tick reducer so BUY/WATCH/REJECTED
// tag changes flow through immediately.
//
// Panels (institutional playbook order — Phase ↔ Stage ↔ Survival):
//   • Stats strip (count · avg · BUY-ZONE · BEST · survival pass · concall ≥15)
//   • Stage distribution (DISTRESS → SETUP → EARLY-SHOOTS → PATTERN →
//     CONFIRMED → MATURE → NOT-TURNAROUND)
//   • Archetype breakdown (TURNAROUND vs GROWTH / QUALITY / VALUE-TRAP /
//     DECLINING / WAIT / NEUTRAL — tells user which rows belong on this tab)
//   • Turnaround Type breakdown (CYCLICAL / OPERATIONAL / DISTRESSED)
//   • Phase distribution (1 Collapse / 2 Stabilisation / 3 Inflection BUY /
//     4 Re-rating)
//   • Survival score histogram (0-8 from playbook Ch.4 gate filter)
//   • Best candidates leaderboard (isBestCandidate === true)
//   • Top 12 by total score
// ═══════════════════════════════════════════════════════════════════════════
