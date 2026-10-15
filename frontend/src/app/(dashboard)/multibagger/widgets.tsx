'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo, useEffect } from 'react';
import { getDecision, setDecision, clearDecision, DECISION_META, type DecisionStatus } from '@/lib/decisions';
import { armBookFlag } from '@/lib/book-flags-client';
import type { ExcelResult } from '@/lib/multibagger-india-scoring';
import { mbServerSnapshotSave } from './storage';
import { type DriftItem } from './types';

// PATCH 1101m — Visible cloud save status badge. Listens for cloud save
// events and shows the user where their data lives right now. Includes a
// "Backup now" button as a manual escape valve when auto-save fails.
export function CloudSaveStatusBadge({ rows }: { rows: ExcelResult[] }): React.ReactElement | null {
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'ok' | 'failed'>(() => {
    try { return (localStorage.getItem('mb_server_save_status') as any) || 'idle'; } catch { return 'idle'; }
  });
  const [savedAt, setSavedAt] = React.useState<string | null>(() => {
    try { return localStorage.getItem('mb_server_save_at'); } catch { return null; }
  });
  const [forcing, setForcing] = React.useState(false);
  React.useEffect(() => {
    const onStatus = (e: Event) => {
      const ce = e as CustomEvent<'saving' | 'ok' | 'failed'>;
      if (ce.detail) {
        setStatus(ce.detail);
        if (ce.detail === 'ok') {
          try { setSavedAt(localStorage.getItem('mb_server_save_at')); } catch {}
        }
      }
    };
    window.addEventListener('mb-cloud-save:status', onStatus);
    return () => window.removeEventListener('mb-cloud-save:status', onStatus);
  }, []);
  if (!rows || rows.length === 0) return null;
  const forceBackup = async () => {
    setForcing(true);
    try {
      const __mbR = JSON.stringify(rows);
      try { localStorage.setItem('mb_server_save_status', 'saving'); window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: 'saving' })); } catch {}
      const ok = await mbServerSnapshotSave(__mbR, rows.length, 'IN');
      try {
        if (ok) {
          localStorage.setItem('mb_server_save_status', 'ok');
          localStorage.setItem('mb_server_save_at', new Date().toISOString());
        } else {
          localStorage.setItem('mb_server_save_status', 'failed');
        }
        window.dispatchEvent(new CustomEvent('mb-cloud-save:status', { detail: ok ? 'ok' : 'failed' }));
      } catch {}
    } finally {
      setForcing(false);
    }
  };
  const color = status === 'ok' ? '#22c55e' : status === 'saving' ? '#3b82f6' : status === 'failed' ? '#ef4444' : '#94a3b8';
  const icon = status === 'ok' ? '☁ ✓' : status === 'saving' ? '☁ ⏳' : status === 'failed' ? '☁ ⚠' : '☁ ?';
  const label = status === 'ok' ? `Backed up to Railway · ${savedAt ? new Date(savedAt).toLocaleString() : ''}`
              : status === 'saving' ? 'Saving to Railway cloud…'
              : status === 'failed' ? 'Cloud backup failed — local data only'
              : 'Not yet backed up to cloud';
  return (
    <div style={{marginBottom:14,padding:'8px 14px',backgroundColor:`color-mix(in srgb, ${color} 8%, transparent)`,border:`1px solid ${color}55`,borderLeft:`3px solid ${color}`,borderRadius:6,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',fontSize:12}}>
      <span style={{color, fontWeight:800, letterSpacing:0.4}}>{icon}</span>
      <span style={{color:'var(--mc-text-2)', fontWeight:600}}>{label}</span>
      <span style={{flex:1}}/>
      <button
        onClick={forceBackup}
        disabled={forcing || status === 'saving'}
        style={{padding:'4px 12px',backgroundColor:'transparent',border:`1px solid ${color}77`,borderRadius:5,color,fontSize:11,fontWeight:700,cursor:forcing?'wait':'pointer',opacity:forcing?0.5:1}}>
        {forcing ? 'Saving…' : 'Backup now'}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0347 — DECISION BAR COMPONENT
// Used in both India and USA expanded rows.
// Shows 4 status buttons (BUY/WATCH/NEUTRAL/REJECTED) + reason input.
// Persists to localStorage via lib/decisions.ts — survives data clears.
// ═══════════════════════════════════════════════════════════════════════════
export function DecisionBar({ symbol, company, market, score, grade, currentPrice, bump }: {
  symbol: string; company?: string; market: 'IN' | 'US';
  score?: number; grade?: string;
  currentPrice?: number;  // PATCH 0852 — snapshotted at decision time for buy-the-dip helper
  bump: () => void;
}) {
  const existing = getDecision(symbol, market);
  const [reason, setReason] = React.useState(existing?.reason ?? '');
  const [status, setStatus] = React.useState<DecisionStatus | undefined>(existing?.status);
  React.useEffect(() => {
    // Re-sync when symbol changes
    const e = getDecision(symbol, market);
    setReason(e?.reason ?? '');
    setStatus(e?.status);
  }, [symbol, market]);

  const apply = (newStatus: DecisionStatus) => {
    setStatus(newStatus);
    setDecision({
      symbol, market, status: newStatus, reason,
      company, scoreAtDecision: score, gradeAtDecision: grade,
      priceAtDecision: currentPrice && currentPrice > 0 ? currentPrice : undefined,
    });
    bump();
  };
  const onSaveReason = () => {
    if (!status) return;
    setDecision({
      symbol, market, status, reason,
      company, scoreAtDecision: score, gradeAtDecision: grade,
      priceAtDecision: currentPrice && currentPrice > 0 ? currentPrice : undefined,
    });
    bump();
  };
  const onClear = () => {
    clearDecision(symbol, market);
    setStatus(undefined);
    setReason('');
    bump();
  };

  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px',
      backgroundColor: '#0f172a', border: '1px solid var(--mc-bg-3)', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.7px', color: '#38bdf8' }}>
          📒 DECISION LOG{existing && ` · last updated ${new Date(existing.date).toLocaleDateString()}`}
        </span>
        {(['BUY', 'WATCH', 'NEUTRAL', 'REJECTED'] as DecisionStatus[]).map(s => {
          const meta = DECISION_META[s];
          const active = status === s;
          return (
            <button key={s} onClick={() => apply(s)}
              style={{
                fontSize: 11, fontWeight: 800, padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${active ? meta.color + 'AA' : 'var(--mc-bg-3)'}`,
                background: active ? `${meta.color}25` : 'transparent',
                color: active ? meta.color : 'var(--mc-text-3)',
              }}>
              {meta.emoji} {meta.label}
            </button>
          );
        })}
        {status && (
          <button onClick={onClear} style={{
            fontSize: 10, padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
            border: '1px solid var(--mc-bg-3)', background: 'transparent', color: 'var(--mc-text-3)', marginLeft: 'auto',
          }} title="Remove this decision">
            ✕ Clear
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={onSaveReason}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSaveReason(); } }}
          placeholder="Why? Add your reason — saved permanently even if you clear the list"
          style={{
            flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 6,
            background: '#0a1124', border: '1px solid var(--mc-bg-3)', color: '#e2e8f0', outline: 'none',
          }}
        />
        <button onClick={onSaveReason}
          style={{
            fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid #38bdf860', background: '#38bdf818', color: '#38bdf8',
          }}>
          💾 Save
        </button>
      </div>
      {existing && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--mc-text-4)' }}>
          Decision recorded when score was <strong style={{ color: 'var(--mc-text-3)' }}>{existing.scoreAtDecision ?? '—'} {existing.gradeAtDecision ?? ''}</strong>.
          This persists even after you clear your upload — useful as a personal logbook.
        </div>
      )}
    </div>
  );
}

// Compact decision badge for collapsed rows
function DecisionBadge({ symbol }: { symbol: string }) {
  const d = getDecision(symbol);
  if (!d) return null;
  const meta = DECISION_META[d.status];
  return (
    <span
      title={`${meta.label}${d.reason ? ' — ' + d.reason : ''} · ${new Date(d.date).toLocaleDateString()}`}
      style={{
        fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
        color: meta.color, background: meta.color + '20', border: `1px solid ${meta.color}50`,
      }}>
      {meta.emoji} {meta.label}
    </span>
  );
}

// PATCH 0347 — Cross-market upload detection.
// USA TradingView CSV has these unique headers; India Screener CSV does not.
// PATCH 0755 — detectCsvMarket extracted to lib/multibagger-csv-parsers.ts.

// PATCH 0984 — Compact screener provenance chip row.
// Shows "N SCREENERS · name1 · name2 · …" at top of Multibagger Analytics
// so the user can see at a glance which Screener.in exports built this view.
export function MbScreenerChips() {
  const [files, setFiles] = React.useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('mb_excel_files_v1') || '[]'); } catch { return []; }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try { setFiles(JSON.parse(localStorage.getItem('mb_excel_files_v1') || '[]')); } catch {}
    };
    window.addEventListener('mb-files:updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('mb-files:updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  if (files.length === 0) return null;
  const cleanName = (n: string) =>
    n.replace(/\.(csv|xlsx?|tsv)$/i, '')
     .replace(/^Screener[._-]+/i, '')
     .replace(/[_-]+/g, ' ')
     .replace(/\s+/g, ' ')
     .trim();
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
      padding: '6px 10px', borderRadius: 6,
      border: '1px solid #1E3A5F', background: '#0F1B2D',
    }}>
      <span style={{ fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.5px' }}>
        📊 {files.length} SCREENER{files.length === 1 ? '' : 'S'}
      </span>
      <span style={{ width: 1, height: 12, background: '#1E3A5F' }} />
      {files.slice(0, 12).map((f, i) => (
        <span key={f + '_' + i} style={{
          fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 600,
          padding: '2px 7px', borderRadius: 3, background: 'var(--mc-bg-4)',
          fontFamily: 'ui-sans-serif, system-ui',
          maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={f}>
          {cleanName(f)}
        </span>
      ))}
      {files.length > 12 && (
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>
          +{files.length - 12} more
        </span>
      )}
    </div>
  );
}

// PATCH 0987/0990 — Multi-confirmed picks: stocks that appear in 2+ uploaded
// Screener.in CSVs. Classic conviction-by-consensus signal.
export function MultiConfirmedCard({ stocks }: { stocks: any[] }) {
  const cleanName = (n: string) =>
    n.replace(/\.(csv|xlsx?|tsv)$/i, '')
     .replace(/^Screener[._-]+/i, '')
     .replace(/[_-]+/g, ' ')
     .trim();
  const multi = React.useMemo(() => {
    return stocks
      .filter((s: any) => Array.isArray(s._screeners) && s._screeners.length >= 2
                       && s.grade !== 'D'
                       && (s.redFlagSummary?.critical ?? 0) === 0)
      .map((s: any) => ({ ...s, _scrCount: s._screeners.length }))
      .sort((a: any, b: any) => (b._scrCount - a._scrCount) || (b.score - a.score))
      .slice(0, 15);
  }, [stocks]);

  const cardStyle: React.CSSProperties = {
    background: '#0E1822', padding: 14, borderRadius: 8,
    border: '1px solid #22D3EE40',
  };

  if (multi.length === 0) {
    // PATCH 1101gg — detect whether ANY row in the current dataset has the
    // screenerFiles field tracked. If at least one row has it, the user HAS
    // re-uploaded after the tracking patch landed — so the stale "re-upload"
    // copy is wrong. Show a different message: they've re-uploaded but no
    // single ticker appears in 2+ different CSVs.
    // PATCH 1101jj — Fix `rows is not defined` build error from 1101gg. This
    // function uses `stocks`, not `rows`. The mistake broke USA Analytics
    // entirely with "Page — Something went wrong". Renamed reference.
    const hasTrackedScreenerData = (stocks as any[]).some(r =>
      Array.isArray((r as any)._screeners) && (r as any)._screeners.length > 0
    );
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
          🎯 MULTI-CONFIRMED PICKS (0)
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
          Stocks appearing in 2+ uploaded Screener.in CSVs land here.{' '}
          {hasTrackedScreenerData ? (
            <>No ticker is currently in your dataset in 2 or more different uploaded CSVs.
            Upload another screen (different focus — e.g. cash-rich, FII-favourites, low-debt) to find overlaps.</>
          ) : (
            <><strong style={{ color: 'var(--mc-text-3)' }}>Re-upload your screens</strong> to populate —
            screener membership wasn't tracked before this patch, so existing rows show 0.</>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
        🎯 MULTI-CONFIRMED PICKS ({multi.length})
      </div>
      <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.45 }}>
        Stocks that surfaced in 2+ Screener.in screens. Classic conviction-by-consensus.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {multi.map((s: any) => (
          <a key={s.symbol}
            href={`/stock-sheet?ticker=${encodeURIComponent(s.symbol.replace(/\.(NS|BO)$/i, ''))}`}
            style={{
              display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 9px', borderRadius: 4,
              border: '1px solid color-mix(in srgb, var(--mc-cyan) 19%, transparent)', background: 'color-mix(in srgb, var(--mc-cyan) 3%, transparent)', textDecoration: 'none',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 70 }}>
                {s.symbol.replace(/\.(NS|BO)$/i, '')}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--mc-text-1)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.company || s.symbol}
              </span>
              <span style={{
                fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800,
                padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                📂 {s._scrCount}
              </span>
              <span style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {s.score} {s.grade}
              </span>
            </div>
            <div style={{
              fontSize: 9.5, color: '#67E8F9CC', fontStyle: 'italic', lineHeight: 1.35,
              maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={(s._screeners || []).join(', ')}>
              In: {(s._screeners || []).map(cleanName).join(' · ')}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH zzz129 — TECHNICALS TAB (Qullamaggie / Zanger / Bonde / Minervini)
//
// Pure-technical scoring against 4 trader playbooks using fields ALREADY in
// the USA TradingView export: Price, EMA50, EMA200, Performance 1Y/3M/6M,
// RSI 14, 52-week High, Beta, Avg Volume 30d, Market Cap.
//
// Computes derived metrics: % vs EMA50, % vs EMA200, EMA50/EMA200 spread,
// distance from 52w high, momentum acceleration (3M > 6M annualized > 1Y).
//
// Then scores each ticker against:
//   • QULLAMAGGIE   — momentum acceleration, not over-extended, small/mid cap
//   • ZANGER HTF    — 6M perf 80%+ then tight 3M consolidation
//   • PRADEEP BONDE — EP (Episodic Pivot) candidates: recent surge + reasonable extension
//   • MINERVINI     — Trend Template: Price > EMA50 > EMA200 (rising), within 25% of 52W high
//
// Right entry zone: 0–7% above EMA50 (proxy for Qullamaggie's 21-EMA rule).
// ═══════════════════════════════════════════════════════════════════════════

// ─── zzz214: SCORE MOVERS STRIP (India + USA Multibagger tabs) ───────────
// Compares current scores against the pre-upload baseline the tabs already
// persist (mb_india_prev_scores_v1 / mb_usa_prev_scores_v1) and surfaces the
// biggest upgrades / downgrades since the last data refresh.
export function ScoreMoversStrip({ rows, prevKey }: { rows: any[]; prevKey: string }) {
  const movers = React.useMemo(() => {
    let prev: Record<string, number> = {};
    try { prev = JSON.parse(localStorage.getItem(prevKey) || '{}'); } catch {}
    const out: { symbol: string; from: number; to: number; d: number }[] = [];
    for (const r of rows || []) {
      if (!r || typeof r.symbol !== 'string') continue;
      const p = prev[r.symbol];
      if (typeof p !== 'number' || typeof r.score !== 'number') continue;
      const d = Math.round(r.score - p);
      if (Math.abs(d) >= 5) out.push({ symbol: r.symbol, from: Math.round(p), to: Math.round(r.score), d });
    }
    out.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    return out.slice(0, 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, prevKey]);
  if (movers.length === 0) return null;
  const ups = movers.filter(m => m.d > 0).length;
  return (
    <div style={{ marginBottom: 14, padding: '12px 16px', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: '#F59E0B' }}>📈 SCORE MOVERS since last refresh</span>
        <span style={{ fontSize: 11.5, color: '#7B8898' }}>⬆ {ups} up · ⬇ {movers.length - ups} down · |Δ| ≥ 5 pts · biggest first</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {movers.map(m => (
          <span key={m.symbol} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', border: `1px solid ${m.d > 0 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`, padding: '4px 10px', borderRadius: 7, fontSize: 12 }}>
            <span style={{ color: m.d > 0 ? '#10B981' : '#EF4444', fontWeight: 900 }}>{m.d > 0 ? '⬆' : '⬇'}</span>
            <b style={{ color: '#E5ECF4' }}>{m.symbol}</b>
            <span style={{ color: '#7B8898', fontVariantNumeric: 'tabular-nums' }}>{m.from}→{m.to}</span>
            <span style={{ color: m.d > 0 ? '#10B981' : '#EF4444', fontWeight: 800 }}>{m.d > 0 ? '+' : ''}{m.d}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function computeThesisDrift(rows: any[], market?: 'IN' | 'US'): DriftItem[] {
  const out: DriftItem[] = [];
  for (const r of rows || []) {
    if (!r || typeof r.symbol !== 'string') continue;
    const d = getDecision(r.symbol, market);
    if (!d) continue; // only rows with a logged decision, never the whole universe
    const ticker = r.symbol.toUpperCase();
    const grade = String(r.grade ?? '');
    const score = typeof r.score === 'number' ? r.score : NaN;
    if (!Number.isFinite(score)) continue;
    const flags = Array.isArray(r.redFlags) ? r.redFlags : [];
    const structuralSevere = flags.some((f: any) =>
      (f?.severity === 'CRITICAL' || f?.severity === 'HIGH') &&
      ((f?.kind ?? 'STRUCTURAL') === 'STRUCTURAL'));
    const pumpScore = typeof (r as any).pumpScore === 'number' ? (r as any).pumpScore : 0;
    const gradesHigh = grade === 'A' || grade === 'A+' || score >= 80;
    const gradesLow = grade === 'C' || grade === 'D' || score <= 55;
    if (d.status === 'REJECTED' && gradesHigh) {
      out.push({
        ticker, company: r.company, kind: 'REOPEN', decisionStatus: d.status,
        oldGrade: d.gradeAtDecision, oldScore: d.scoreAtDecision, grade, score,
        reason: `was REJECTED, now grades ${grade} (${Math.round(score)})`, flagNote: '',
      });
    } else if ((d.status === 'BUY' || d.status === 'WATCH') &&
               (gradesLow || structuralSevere || pumpScore >= 2)) {
      const parts: string[] = [];
      if (structuralSevere) parts.push('structural red flag');
      if (pumpScore >= 2) parts.push(`pump ${pumpScore}`);
      const flagNote = parts.length ? ` + ${parts.join(' + ')}` : '';
      const reason = gradesLow
        ? `${d.status} decayed to ${grade} (${Math.round(score)})${flagNote}`
        : `${d.status} now carries ${parts.join(' + ')} (${grade} ${Math.round(score)})`;
      out.push({
        ticker, company: r.company, kind: 'BREAK', decisionStatus: d.status,
        oldGrade: d.gradeAtDecision, oldScore: d.scoreAtDecision, grade, score,
        reason, flagNote,
      });
    }
  }
  return out;
}
export function ThesisDriftStrip({ rows, market }: { rows: any[]; market?: 'IN' | 'US' }) {
  const drift = React.useMemo(() => computeThesisDrift(rows, market), [rows, market]);
  // Arm Book Watch flags for each drift. Guarded + self-deduping, so re-running
  // on every scored-rows change is safe. Only rows with a logged decision that
  // meet the criteria reach here — never the whole universe.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    for (const item of drift) {
      if (item.kind === 'REOPEN') {
        armBookFlag({
          kind: 'THESIS_DRIFT_REOPEN', ticker: item.ticker, company: item.company, severity: 'warning',
          message: `${item.ticker} was REJECTED, now grades ${item.grade} (${Math.round(item.score)}) — reopen the buy case`,
          detail: 'multibagger re-score',
        });
      } else {
        armBookFlag({
          kind: 'THESIS_BREAK', ticker: item.ticker, company: item.company, severity: 'critical',
          message: `${item.ticker} (${item.decisionStatus}) decayed to ${item.grade} (${Math.round(item.score)})${item.flagNote} — recheck the thesis`,
          detail: 'multibagger re-score',
        });
      }
    }
  }, [drift]);
  if (drift.length === 0) return null;
  const reopens = drift.filter(d => d.kind === 'REOPEN').length;
  const breaks = drift.length - reopens;
  const fmtOldNew = (item: DriftItem) => {
    const og = item.oldGrade ?? '?';
    const os = typeof item.oldScore === 'number' ? Math.round(item.oldScore) : '?';
    return `${og}·${os} → ${item.grade}·${Math.round(item.score)}`;
  };
  return (
    <div style={{ marginBottom: 14, padding: '12px 16px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: '#A855F7' }}>🎯 THESIS DRIFT vs Decision Logbook</span>
        <span style={{ fontSize: 11.5, color: '#7B8898' }}>
          {reopens > 0 && <>🟢 {reopens} reopen{reopens > 1 ? 's' : ''} · </>}
          {breaks > 0 && <>🔴 {breaks} break{breaks > 1 ? 's' : ''} · </>}
          current re-score vs your logged decision
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {drift.map(item => {
          const isReopen = item.kind === 'REOPEN';
          const col = isReopen ? '#10B981' : '#EF4444';
          return (
            <div key={`${item.kind}-${item.ticker}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: `1px solid ${col}55`, padding: '4px 10px', borderRadius: 7, fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ color: col, fontWeight: 900, letterSpacing: 0.3 }}>{isReopen ? '↑ REOPEN' : '↓ BREAK'}</span>
              <b style={{ color: '#E5ECF4' }}>{item.ticker}</b>
              <span style={{ color: '#7B8898', fontVariantNumeric: 'tabular-nums' }}>{fmtOldNew(item)}</span>
              <span style={{ color: col }}>{item.reason}</span>
              <span style={{ color: '#7B8898', fontStyle: 'italic' }}>· {isReopen ? 'buy pipeline improved' : 'owned/watched deteriorated'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
