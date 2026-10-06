'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import TickerExportToolbar from '@/components/TickerExportToolbar';
import { scoreTurnaroundRow, parseTurnaroundRow, type TurnaroundResult, type TurnaroundStage, type TurnaroundArchetype } from '@/lib/turnaround';
import { parseCsvFlexible } from '@/lib/multibagger-csv-parsers';
import { SYNC_ROUTING, fetchCsvsAsFiles, shouldAutoLoad, markAutoLoaded } from '@/lib/screener-data-loader';
import { CHECKLIST } from '@/lib/multibagger-india-scoring';
import { BORDER, F, GREEN, MUTED, RED, TEXT } from './constants';

export const TURNAROUND_STORAGE_KEY = 'mb_turnaround_scored_v1';

// zzz219 — SELF-HEALING turnaround data. Rows saved by the pre-zzz217 engine
// were parsed without any quarterly fields (the column aliases didn't match
// the auto-synced CSVs), so re-scoring them can never recover. Detect that
// signature and transparently re-sync + re-parse from the server so the user
// never has to Clear All manually after an engine upgrade.
// zzz220 — engine version stamp: bump this whenever parsing/scoring changes
// materially. A mismatch forces a transparent server re-sync on next load.
const TURNAROUND_ENGINE_V = '220';
const TURNAROUND_ENGINE_KEY = 'mb_turnaround_engine_v';
export function turnRowsAreStaleParsed(rows: any[]): boolean {
  if (!Array.isArray(rows) || rows.length < 3) return false;
  try { if (localStorage.getItem(TURNAROUND_ENGINE_KEY) !== TURNAROUND_ENGINE_V) return true; } catch {}
  // zzz220 — the pre-zzz217 parser DID map salesQ1 (that alias existed), so
  // the old signature (patQ1 AND salesQ1 both missing) never matched real
  // stale data. PAT quarters were never mapped by the old parser — use that.
  const missing = rows.filter(r => r && r.patQ1 == null).length;
  return missing / rows.length > 0.8;
}
export async function resyncTurnaroundsFromServer(): Promise<TurnaroundResult[]> {
  const files = await fetchCsvsAsFiles(SYNC_ROUTING.turnaroundsIndia);
  if (files.length === 0) return [];
  const XLSX = await import('xlsx');
  const merged = new Map<string, TurnaroundResult>();
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      for (const r of raw) {
        const p = parseTurnaroundRow(r);
        if (p) merged.set(p.symbol, scoreTurnaroundRow(p));
      }
    } catch {}
  }
  // zzz220 — keep manually-uploaded rows that aren't in the server screens
  // (re-scored with the current engine) instead of dropping them.
  try {
    const existing = JSON.parse(localStorage.getItem(TURNAROUND_STORAGE_KEY) || '[]');
    if (Array.isArray(existing)) {
      for (const r of existing) {
        if (r && r.symbol && !merged.has(r.symbol)) merged.set(r.symbol, scoreTurnaroundRow(r));
      }
    }
  } catch {}
  const rows = Array.from(merged.values()).sort((a, b) => b.totalScore - a.totalScore);
  if (rows.length > 0) {
    try { localStorage.setItem(TURNAROUND_STORAGE_KEY, JSON.stringify(rows)); } catch {}
    try { localStorage.setItem(TURNAROUND_ENGINE_KEY, TURNAROUND_ENGINE_V); } catch {}
    try { window.dispatchEvent(new CustomEvent('mb-upload:updated', { detail: { market: 'TURN' } })); } catch {}
  }
  return rows;
}
const TURNAROUND_CONCALLS_KEY = 'mb_turnaround_concalls_v1';

export function TurnaroundCompare() {
  const [rows, setRows] = useState<TurnaroundResult[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem(TURNAROUND_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      // Re-score on load so any code changes apply
      return parsed.map((r: any) => scoreTurnaroundRow(r)).sort((a, b) => b.totalScore - a.totalScore);
    } catch { return []; }
  });
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [expRow, setExpRow] = useState<string | null>(null);
  // PATCH 0386 — Expand All toggle (matches Multibagger India/USA tabs)
  const [expandAll, setExpandAll] = useState(false);
  const [stageFilter, setStageFilter] = useState<TurnaroundStage | 'BUY-ZONE' | 'ALL'>('ALL');
  // PATCH 0374 — Archetype filter so user can hide growth/quality/value-trap rows
  const [archetypeFilter, setArchetypeFilter] = useState<TurnaroundArchetype | 'ALL'>('ALL');
  const [showOnlyHighConcall, setShowOnlyHighConcall] = useState(false);
  const [showLossRecovery, setShowLossRecovery] = useState(false);
  // PATCH 0381 — "Best candidates only" filter — institutional buy-zone shortlist
  const [showBestOnly, setShowBestOnly] = useState(false);
  // PATCH 0381 — turnaround Type and Phase filters
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CYCLICAL' | 'OPERATIONAL' | 'DISTRESSED'>('ALL');
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | 1 | 2 | 3 | 4>('ALL');
  // Concall map: ticker -> pasted text
  const [concallMap, setConcallMap] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(TURNAROUND_CONCALLS_KEY) || '{}'); } catch { return {}; }
  });

  // Persist concall map and trigger re-score when concall changes for a symbol
  const updateConcall = useCallback((symbol: string, text: string) => {
    setConcallMap(prev => {
      const next = { ...prev, [symbol]: text };
      try { localStorage.setItem(TURNAROUND_CONCALLS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    // Re-score this row
    setRows(prev => prev.map(r => {
      if (r.symbol !== symbol) return r;
      return scoreTurnaroundRow({ ...r, concallText: text });
    }).sort((a, b) => b.totalScore - a.totalScore));
  }, []);

  // zzz215 — AUTO-SYNC from screener.in. Turnarounds (3658519) + Debt
  // Reduction (3658621) are exported 4×/day by screener-sync.yml; this pulls
  // them through the existing handleFiles() pipeline. Auto-loads once when
  // the tab is empty; manual pull button always available.
  const [turnSyncing, setTurnSyncing] = useState(false);
  const turnPulledRef = useRef(false);
  const pullTurnarounds = useCallback(async () => {
    if (turnSyncing) return;
    setTurnSyncing(true);
    try {
      const files = await fetchCsvsAsFiles(SYNC_ROUTING.turnaroundsIndia);
      if (files.length === 0) {
        setParseError('Auto-sync: no turnaround CSVs on the server yet — run the "Sync Screener.in CSVs" GitHub Action once.');
        return;
      }
      await handleFiles(files);
      markAutoLoaded('turnarounds');
    } finally {
      setTurnSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnSyncing]);
  useEffect(() => {
    if (turnPulledRef.current || rows.length > 0 || !shouldAutoLoad('turnarounds')) return;
    turnPulledRef.current = true;
    const t = setTimeout(() => { pullTurnarounds(); }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);
  // zzz219 — self-heal: rows saved by the old parser (no quarterly fields)
  // are silently replaced with a fresh server re-sync.
  useEffect(() => {
    if (!turnRowsAreStaleParsed(rows)) return;
    turnPulledRef.current = true;
    resyncTurnaroundsFromServer().then(fresh => { if (fresh.length) setRows(fresh); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PATCH 0374 / 0375 — Multi-CSV upload. Accepts MULTIPLE files in one
  // picker, processes them all, then merges into existing rows via
  // functional setState (avoids stale closure on rows).
  // User typically has several Screener screens (e.g. 'Loss recovery
  // candidates', 'Sector turnaround', 'Microcap turnaround') and wants to
  // pool them into one analysis.
  const handleFiles = async (files: File[]) => {
    setParseError(null);
    if (files.length === 0) return;
    const allNewScored: TurnaroundResult[] = [];
    const fileNames: string[] = [];
    const failed: string[] = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = parseCsvFlexible(text);
        if (parsed.length === 0) { failed.push(`${file.name}: empty`); continue; }
        const tRows = parsed
          .map(r => parseTurnaroundRow(r))
          .filter((r): r is NonNullable<typeof r> => r != null)
          .map(r => ({ ...r, concallText: concallMap[r.symbol] || '' }));
        if (tRows.length === 0) { failed.push(`${file.name}: no valid tickers`); continue; }
        for (const r of tRows) allNewScored.push(scoreTurnaroundRow(r));
        fileNames.push(file.name);
      } catch (e: any) {
        failed.push(`${file.name}: ${e?.message || 'parse failed'}`);
      }
    }
    if (allNewScored.length === 0) {
      setParseError(`No valid rows in ${files.length} file(s)${failed.length ? ': ' + failed.join('; ') : ''}`);
      return;
    }
    // Merge with existing rows — functional setState so we don't capture
    // a stale rows snapshot when multiple files come through one batch.
    setRows(prev => {
      const merged = new Map<string, TurnaroundResult>();
      for (const r of prev) merged.set(r.symbol, r);
      for (const r of allNewScored) merged.set(r.symbol, r);
      const finalRows = Array.from(merged.values()).sort((a, b) => b.totalScore - a.totalScore);
      try { localStorage.setItem(TURNAROUND_STORAGE_KEY, JSON.stringify(finalRows)); } catch {}
      return finalRows;
    });
    setFileName(prev => {
      const joined = fileNames.join(', ');
      return prev ? `${prev}, ${joined}` : joined;
    });
    if (failed.length > 0) {
      setParseError(`Loaded ${allNewScored.length} rows from ${fileNames.length} file(s). ${failed.length} file(s) failed: ${failed.join('; ')}`);
    }
  };

  // Filter chain
  const filtered = useMemo(() => {
    let out = rows;
    if (stageFilter === 'BUY-ZONE') {
      out = out.filter(r => r.inBuyZone);
    } else if (stageFilter !== 'ALL') {
      out = out.filter(r => r.stage === stageFilter);
    }
    // PATCH 0374 — archetype filter
    if (archetypeFilter !== 'ALL') {
      out = out.filter(r => r.archetype === archetypeFilter);
    }
    if (showOnlyHighConcall) {
      out = out.filter(r => r.concallScore >= 12);  // 0381: threshold tracks new /25 max
    }
    if (showLossRecovery) {
      out = out.filter(r =>
        (r.lossMakingYears5y ?? 0) >= 1 &&
        r.patQ1 != null && r.patQ1 > 0
      );
    }
    // PATCH 0381 — institutional filters
    if (showBestOnly) {
      out = out.filter(r => r.isBestCandidate);
    }
    if (typeFilter !== 'ALL') {
      out = out.filter(r => r.turnaroundType === typeFilter);
    }
    if (phaseFilter !== 'ALL') {
      out = out.filter(r => r.phase === phaseFilter);
    }
    return out;
  }, [rows, stageFilter, archetypeFilter, showOnlyHighConcall, showLossRecovery, showBestOnly, typeFilter, phaseFilter]);

  // Stage + archetype counts
  const stageCounts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length, 'BUY-ZONE': 0, DISTRESS: 0, SETUP: 0, 'EARLY-SHOOTS': 0, PATTERN: 0, CONFIRMED: 0, MATURE: 0, 'NOT-TURNAROUND': 0 };
    for (const r of rows) {
      c[r.stage]++;
      if (r.inBuyZone) c['BUY-ZONE']++;
    }
    return c;
  }, [rows]);

  // PATCH 0374 — Archetype counts for the new filter rail
  const archetypeCounts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length, TURNAROUND: 0, GROWTH: 0, QUALITY: 0, 'VALUE-TRAP': 0, DECLINING: 0, WAIT: 0, NEUTRAL: 0 };
    for (const r of rows) c[r.archetype]++;
    return c;
  }, [rows]);

  // Company-name map for Screener export
  const tickerCompanyMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of filtered) {
      if (r.symbol && r.company) m[r.symbol.toUpperCase()] = r.company;
    }
    return m;
  }, [filtered]);

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: F.h2, fontWeight: 800, color: 'var(--mc-cyan)', margin: 0, marginBottom: 5 }}>
          🔄 Turnaround Research Engine
        </h2>
        <p style={{ fontSize: F.sm, color: MUTED, margin: 0, lineHeight: 1.5 }}>
          Earnings power restoration scoring · 7 dimensions · Stage classifier · Concall narrative weighted heavily.
          Upload Screener.in CSV with quarterly P&L columns. Paste concall narrative per row to unlock the full 15-point Concall dimension.
        </p>
      </div>

      {/* PATCH 0374 — Upload + Add Another CSV (multi-file pool) */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', backgroundColor: rows.length === 0 ? 'var(--mc-cyan)' : 'var(--mc-state-persistent)', color: 'var(--mc-bg-0)', borderRadius: 8, fontWeight: 800, fontSize: F.sm, cursor: 'pointer' }}>
          📁 {rows.length === 0 ? 'Upload Screener.in CSV(s) — multi-select OK' : `+ Add more CSVs (pool with ${rows.length} existing) — multi-select OK`}
          {/* PATCH 0375 — multiple attr lets user pick several CSVs at once.
              All files in the selection get parsed + merged in a single batch. */}
          <input
            type="file"
            accept=".csv"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) {
                handleFiles(files);
                e.target.value = '';
              }
            }}
            style={{ display: 'none' }}
          />
        </label>
        <button onClick={() => pullTurnarounds()} disabled={turnSyncing}
          title="Fetch the daily-synced Turnarounds + Debt Reduction screens from screener.in"
          style={{ padding: '6px 14px', backgroundColor: '#8B5CF6', border: 'none', borderRadius: 6, color: '#fff', fontSize: F.xs, fontWeight: 700, cursor: turnSyncing ? 'wait' : 'pointer' }}>
          {turnSyncing ? '⏳ Syncing…' : '🔄 Pull latest from server'}
        </button>
        {fileName && <span style={{ fontSize: F.xs, color: MUTED }}>{fileName} · {rows.length} unique rows</span>}
        {parseError && <span style={{ fontSize: F.xs, color: RED, fontWeight: 700 }}>⚠ {parseError}</span>}
        {rows.length > 0 && (
          <button
            onClick={() => { if (window.confirm(`Clear all ${rows.length} turnaround rows?`)) { setRows([]); localStorage.removeItem(TURNAROUND_STORAGE_KEY); setFileName(''); } }}
            style={{ marginLeft: 'auto', padding: '6px 14px', backgroundColor: `${RED}14`, border: `1px solid ${RED}40`, borderRadius: 6, color: RED, fontSize: F.xs, fontWeight: 700, cursor: 'pointer' }}>
            🗑 Clear All
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div style={{ padding: 24, border: '1px dashed var(--mc-bg-4)', borderRadius: 10, color: MUTED, fontSize: F.sm, lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--mc-cyan)' }}>How to use:</strong>
          <ol style={{ marginTop: 8, paddingLeft: 22 }}>
            <li>Build a Screener.in custom screen (e.g. "PAT growth &gt; 50%" or "Loss making years &gt; 0 AND latest qtr PAT &gt; 0")</li>
            <li>Export columns to CSV — see <strong style={{ color: 'var(--mc-warn)' }}>📚 Required Fields</strong> below</li>
            <li>Upload here — every row gets scored across 7 dimensions and classified into a stage</li>
            <li>BUY-ZONE = Early-Shoots + Pattern stages. These are the alpha entries before consensus arrives.</li>
            <li>Expand any row to paste concall narrative (unlocks 15-pt Concall dimension)</li>
          </ol>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--mc-warn)', fontWeight: 700 }}>📚 Screener.in column names (use these exact strings in 'Edit Columns')</summary>
            <div style={{ marginTop: 10, fontSize: F.xs, lineHeight: 1.6 }}>
              <p><strong style={{ color: 'var(--mc-bullish)' }}>✅ AVAILABLE in Screener — add these (engine-critical):</strong></p>
              <ul style={{ margin: '4px 0 8px 18px', padding: 0 }}>
                <li><strong>Quarterly trail:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Sales Qtr Rs.Cr. · Sales Prev Qtr Rs.Cr. · Sales 2Qtr Bk Rs.Cr. · Sales 3Qtr Bk Rs.Cr.</code></li>
                <li><strong>PAT trail:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>PAT Qtr Rs.Cr. · PAT Prev Qtr Rs.Cr. · NP 2Qtr Bk Rs.Cr. · NP 3Qtr Bk Rs.Cr.</code></li>
                <li><strong>YoY signals:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Qtr Profit Var % · Qtr Sales Var % · Profit Var 3Yrs % · Sales Var 3Yrs %</code></li>
                <li><strong>Operating:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>OPM % · OPM Qtr % · ROCE % · ROCE 3Yr % · ROIC % · CFO/PAT</code></li>
                <li><strong>Balance sheet:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Debt Rs.Cr. · Debt / Eq · Int Coverage · WC Days · WC Days 3yrs</code></li>
                <li><strong>Governance:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Prom. Hold. % · Chg in Prom Hold 3Yr % · Pledged % · FII Hold % · DII Hold %</code></li>
                <li><strong>Valuation:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>P/E · PEG · EV / EBITDA · From 52w high · Ind PE · CMP / BV</code></li>
                <li><strong>Returns:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>1Yr return %</code></li>
                <li><strong>Annual:</strong> <code style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>Sales Rs.Cr. · Mar Cap Rs.Cr. · EPS 12M Rs. · Free Cash Flow Rs.Cr. · Sales growth % · Profit growth %</code></li>
              </ul>

              <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--mc-warn)' }}>⚠️ NOT in Screener (engine scores 0 for these dimensions — that's OK):</strong></p>
              <ul style={{ margin: '4px 0 8px 18px', padding: 0, color: MUTED }}>
                <li><code style={{ fontSize: 10 }}>OPM Prev Qtr / OPM 2Qtr Bk / OPM 3Qtr Bk</code> — Screener only exposes current quarter OPM. Sequential OPM trend signal (3 pts) will be 0.</li>
                <li><code style={{ fontSize: 10 }}>EPS Prev Qtr / EPS 2Qtr Bk / EPS 3Qtr Bk</code> — same, EPS trail not available.</li>
                <li><code style={{ fontSize: 10 }}>Loss making years</code> — Screener may have this; check 'Edit Columns' search. If not, add manually for distressed candidates.</li>
                <li><code style={{ fontSize: 10 }}>PE 5Yrs Median</code> — Screener has this internally but may not export. Falls back to absolute-PE buckets.</li>
                <li><code style={{ fontSize: 10 }}>Debt 3yrs back / Interest Coverage 3yrs back</code> — debt-reduction trajectory degrades. Can still score from current values.</li>
                <li><code style={{ fontSize: 10 }}>Sales/PAT 5Yr back annual values</code> — annual 5y trail not in Screener export.</li>
                <li><code style={{ fontSize: 10 }}>Auditor changes</code> — not exposed by Screener; manual flag only.</li>
              </ul>

              <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--mc-cyan)' }}>Smart aliases:</strong> the parser already maps your real column names — just upload the CSV as-is from Screener and the engine will recognise everything.</p>
            </div>
          </details>
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* PATCH 0376 — "Not turnarounds" hint banner. Surfaces when user
              uploaded a screen that's mostly quality/growth compounders. */}
          {(() => {
            const nonTurnaroundCount = (archetypeCounts['GROWTH'] || 0) + (archetypeCounts['QUALITY'] || 0) + (archetypeCounts['NEUTRAL'] || 0);
            const turnaroundCount = (archetypeCounts['TURNAROUND'] || 0) + (archetypeCounts['WAIT'] || 0) + (archetypeCounts['VALUE-TRAP'] || 0) + (archetypeCounts['DECLINING'] || 0);
            if (rows.length >= 5 && nonTurnaroundCount / rows.length >= 0.5) {
              return (
                <div style={{ marginBottom: 14, padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 4 }}>💡 Heads-up — most of your uploaded rows aren&apos;t turnarounds</div>
                  <div style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5 }}>
                    {nonTurnaroundCount} of {rows.length} rows are quality/growth compounders or neutral — not turnaround setups. Only <strong style={{ color: 'var(--mc-warn)' }}>{turnaroundCount}</strong> rows match the turnaround pattern (TURNAROUND / WAIT / VALUE-TRAP / DECLINING).
                    <br />
                    <strong>What to do:</strong> Click <code style={{ background: 'var(--mc-bg-0)', padding: '1px 5px', borderRadius: 3, color: 'var(--mc-warn)' }}>🔄 Turnaround</code> in the ARCHETYPE filter above to see only real turnaround candidates. The quality/growth ones belong on the <strong>🇮🇳 India Multibagger</strong> tab.
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Summary strip — PATCH 0378: clickable filters. Total clears all
              filters; archetype cells set archetypeFilter; stage cells set
              stageFilter. Active cell ring shows current selection. */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
            {([
              { label: 'Total', value: rows.length, color: '#94A3B8', kind: 'reset' as const },
              { label: 'BUY-ZONE', value: stageCounts['BUY-ZONE'], color: '#10B981', kind: 'stage' as const, target: 'BUY-ZONE' as const },
              { label: '🔄 Turnarounds', value: archetypeCounts['TURNAROUND'] || 0, color: '#F59E0B', kind: 'archetype' as const, target: 'TURNAROUND' as const },
              { label: '🔥 SETUP', value: stageCounts.SETUP || 0, color: '#A78BFA', kind: 'stage' as const, target: 'SETUP' as const },
              { label: '🌱 EARLY-SHOOTS', value: stageCounts['EARLY-SHOOTS'], color: '#F59E0B', kind: 'stage' as const, target: 'EARLY-SHOOTS' as const },
              { label: '📈 PATTERN', value: stageCounts.PATTERN, color: '#22D3EE', kind: 'stage' as const, target: 'PATTERN' as const },
              { label: '✅ CONFIRMED', value: stageCounts.CONFIRMED, color: '#10B981', kind: 'stage' as const, target: 'CONFIRMED' as const },
              { label: 'Not-Turnaround', value: stageCounts['NOT-TURNAROUND'] || 0, color: '#94A3B8', kind: 'stage' as const, target: 'NOT-TURNAROUND' as const },
              { label: '🚫 DISTRESS', value: stageCounts.DISTRESS, color: '#EF4444', kind: 'stage' as const, target: 'DISTRESS' as const },
            ]).map(s => {
              const isActive =
                (s.kind === 'reset' && stageFilter === 'ALL' && archetypeFilter === 'ALL') ||
                (s.kind === 'stage' && stageFilter === (s as any).target) ||
                (s.kind === 'archetype' && archetypeFilter === (s as any).target);
              const onClick = () => {
                if (s.kind === 'reset') {
                  setStageFilter('ALL');
                  setArchetypeFilter('ALL');
                } else if (s.kind === 'stage') {
                  setStageFilter(isActive ? 'ALL' : (s as any).target);
                  setArchetypeFilter('ALL');
                } else if (s.kind === 'archetype') {
                  setArchetypeFilter(isActive ? 'ALL' : (s as any).target);
                  setStageFilter('ALL');
                }
              };
              return (
                <button
                  key={s.label}
                  onClick={onClick}
                  title={s.kind === 'reset' ? 'Clear all filters' : `Filter to ${s.label}`}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: isActive ? `${s.color}22` : '#13131a',
                    border: `2px solid ${isActive ? s.color : s.color + '40'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 9, color: isActive ? s.color : MUTED, fontWeight: 700, letterSpacing: '0.4px' }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.value}</div>
                </button>
              );
            })}
          </div>

          {/* PATCH 0374 — Archetype filter rail (TOP — most useful for user
              who mostly uploads turnarounds but wants to spot mis-categorised
              rows like growth stocks, quality compounders, value traps). */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700, marginRight: 4 }}>ARCHETYPE:</span>
            {([
              { id: 'ALL',         label: 'All',           color: '#94A3B8' },
              { id: 'TURNAROUND',  label: '🔄 Turnaround', color: '#F59E0B' },
              { id: 'GROWTH',      label: '🚀 Growth',     color: '#10B981' },
              { id: 'QUALITY',     label: '💎 Quality',    color: '#22D3EE' },
              { id: 'WAIT',        label: '⏸ Wait',        color: '#94A3B8' },
              { id: 'VALUE-TRAP',  label: '🧊 Value trap', color: '#EF4444' },
              { id: 'DECLINING',   label: '📉 Declining',  color: '#EF4444' },
              { id: 'NEUTRAL',     label: '❓ Neutral',    color: '#6B7A8D' },
            ] as const).map(a => {
              const active = archetypeFilter === a.id;
              return (
                <button key={a.id} onClick={() => setArchetypeFilter(a.id)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? a.color : BORDER}`, background: active ? `${a.color}20` : 'transparent', color: active ? a.color : MUTED, cursor: 'pointer' }}>
                  {a.label} · {archetypeCounts[a.id] ?? 0}
                </button>
              );
            })}
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700, marginRight: 4 }}>STAGE:</span>
            {(['ALL', 'BUY-ZONE', 'EARLY-SHOOTS', 'PATTERN', 'CONFIRMED', 'MATURE', 'SETUP', 'DISTRESS'] as const).map(s => {
              const active = stageFilter === s;
              const color = s === 'BUY-ZONE' ? '#10B981' : s === 'EARLY-SHOOTS' ? '#F59E0B' : s === 'PATTERN' ? '#22D3EE' : s === 'CONFIRMED' ? '#10B981' : s === 'SETUP' ? '#A78BFA' : s === 'MATURE' ? '#94A3B8' : s === 'DISTRESS' ? '#EF4444' : '#94A3B8';
              return (
                <button key={s} onClick={() => setStageFilter(s)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? color : BORDER}`, background: active ? `${color}20` : 'transparent', color: active ? color : MUTED, cursor: 'pointer' }}>
                  {s} {stageCounts[s] !== undefined && `· ${stageCounts[s]}`}
                </button>
              );
            })}
            <span style={{ width: 1, height: 18, background: BORDER, margin: '0 6px' }} />
            <button onClick={() => setShowOnlyHighConcall(v => !v)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${showOnlyHighConcall ? 'var(--mc-state-persistent)' : BORDER}`, background: showOnlyHighConcall ? 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)' : 'transparent', color: showOnlyHighConcall ? 'var(--mc-state-persistent)' : MUTED, cursor: 'pointer' }}>
              🎙 High Concall {showOnlyHighConcall ? '✓' : ''}
            </button>
            <button onClick={() => setShowLossRecovery(v => !v)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${showLossRecovery ? 'var(--mc-warn)' : BORDER}`, background: showLossRecovery ? 'color-mix(in srgb, var(--mc-warn) 13%, transparent)' : 'transparent', color: showLossRecovery ? 'var(--mc-warn)' : MUTED, cursor: 'pointer' }}>
              💎 Loss→Profit recovery {showLossRecovery ? '✓' : ''}
            </button>
            {/* PATCH 0386 — Expand All / Collapse All toggle */}
            <button onClick={() => { setExpandAll(v => !v); setExpRow(null); }} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${expandAll ? 'var(--mc-cyan)' : BORDER}`, background: expandAll ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent', color: expandAll ? 'var(--mc-cyan)' : MUTED, cursor: 'pointer' }}>
              {expandAll ? '▲ Collapse All' : '▼ Expand All'}
            </button>
            <span style={{ marginLeft: 'auto', fontSize: F.xs, color: MUTED }}>{filtered.length} showing</span>
          </div>

          {/* PATCH 0381 — Institutional filter row (Best/Type/Phase per playbook) */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', background: 'var(--mc-bg-0)', border: `1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)`, borderRadius: 8 }}>
            <span style={{ fontSize: F.xs, color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.5px', marginRight: 4 }}>★ INSTITUTIONAL:</span>
            <button
              onClick={() => setShowBestOnly(v => !v)}
              title="Best candidates only: TURNAROUND + Phase 3 INFLECTION + Survival ≥ 6/8 + zero killers + score ≥ 50"
              style={{
                fontSize: F.xs, fontWeight: 800, padding: '6px 12px', borderRadius: 6,
                border: `2px solid ${showBestOnly ? 'var(--mc-warn)' : 'color-mix(in srgb, var(--mc-warn) 50%, transparent)'}`,
                background: showBestOnly ? 'color-mix(in srgb, var(--mc-warn) 19%, transparent)' : 'transparent',
                color: showBestOnly ? 'var(--mc-warn)' : 'color-mix(in srgb, var(--mc-warn) 75%, transparent)',
                cursor: 'pointer',
              }}>
              ★ BEST ONLY {showBestOnly ? '✓' : ''} · {rows.filter(r => r.isBestCandidate).length}
            </button>
            <span style={{ width: 1, height: 18, background: BORDER, margin: '0 6px' }} />
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700 }}>TYPE:</span>
            {(['ALL', 'CYCLICAL', 'OPERATIONAL', 'DISTRESSED'] as const).map(t => {
              const active = typeFilter === t;
              const color = t === 'CYCLICAL' ? '#10B981' : t === 'OPERATIONAL' ? '#F59E0B' : t === 'DISTRESSED' ? '#EF4444' : '#94A3B8';
              const count = t === 'ALL' ? rows.length : rows.filter(r => r.turnaroundType === t).length;
              return (
                <button key={t} onClick={() => setTypeFilter(t)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? color : BORDER}`, background: active ? `${color}20` : 'transparent', color: active ? color : MUTED, cursor: 'pointer' }}>
                  {t === 'ALL' ? 'All' : t} · {count}
                </button>
              );
            })}
            <span style={{ width: 1, height: 18, background: BORDER, margin: '0 6px' }} />
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700 }}>PHASE:</span>
            {([
              { id: 'ALL' as const, label: 'All',                    color: '#94A3B8' },
              { id: 1 as const,     label: '1 Collapse',             color: '#EF4444' },
              { id: 2 as const,     label: '2 Stabilisation',        color: '#A78BFA' },
              { id: 3 as const,     label: '3 INFLECTION ★ (BUY)',   color: '#10B981' },
              { id: 4 as const,     label: '4 Re-rating',            color: '#22D3EE' },
            ]).map(p => {
              const active = phaseFilter === p.id;
              const count = p.id === 'ALL' ? rows.length : rows.filter(r => r.phase === p.id).length;
              return (
                <button key={String(p.id)} onClick={() => setPhaseFilter(p.id)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? p.color : BORDER}`, background: active ? `${p.color}20` : 'transparent', color: active ? p.color : MUTED, cursor: 'pointer' }}>
                  {p.label} · {count}
                </button>
              );
            })}
          </div>

          {/* PATCH 0381 — Best Candidates Leaderboard (top 5 institutional picks) */}
          {(() => {
            const best = [...rows].filter(r => r.isBestCandidate).sort((a, b) => b.totalScore - a.totalScore).slice(0, 5);
            if (best.length === 0) return null;
            return (
              <div style={{ marginBottom: 14, padding: 12, background: 'linear-gradient(135deg, color-mix(in srgb, var(--mc-warn) 6%, transparent), color-mix(in srgb, var(--mc-warn) 2%, transparent))', border: '1px solid color-mix(in srgb, var(--mc-warn) 31%, transparent)', borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-warn)', letterSpacing: '0.5px' }}>★ BEST RISK/REWARD — INSTITUTIONAL SHORTLIST</div>
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>TURNAROUND archetype · Phase 3 INFLECTION · Survival ≥ 6/8 · Zero killers · Score ≥ 50</div>
                  </div>
                  <button onClick={() => { setShowBestOnly(true); }} style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', cursor: 'pointer' }}>
                    View all {rows.filter(r => r.isBestCandidate).length} →
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {best.map(b => (
                    <div key={b.symbol} style={{ flex: '1 1 240px', minWidth: 240, padding: 10, background: 'var(--mc-bg-0)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#F8FAFC' }}>{b.symbol}</div>
                        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--mc-warn)' }}>{b.totalScore.toFixed(0)}</div>
                      </div>
                      <div style={{ fontSize: 10, color: MUTED, marginBottom: 6 }}>{b.company}</div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 9 }}>
                        <span style={{ padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', color: 'var(--mc-warn)', fontWeight: 700 }}>{b.turnaroundType}</span>
                        <span style={{ padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', color: 'var(--mc-bullish)', fontWeight: 700 }}>Surv {b.survivalScore}/8</span>
                        <span style={{ padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', color: 'var(--mc-cyan)', fontWeight: 700 }}>Max {b.suggestedPositionPct}%</span>
                        {b.concallScore >= 12 && <span style={{ padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', color: 'var(--mc-state-persistent)', fontWeight: 700 }}>🎙 CC {b.concallScore.toFixed(0)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Export toolbar */}
          {filtered.length > 0 && (
            <div style={{ margin: '10px 0' }}>
              <TickerExportToolbar
                tickers={filtered.map(r => r.symbol).filter(Boolean)}
                exchange="NSE"
                filenameHint="turnarounds"
                tickerCompanyMap={tickerCompanyMap}
                compact
              />
            </div>
          )}

          {/* Rows */}
          <div style={{ marginTop: 6 }}>
            {filtered.map((r) => {
              const isExp = expandAll || expRow === r.symbol;
              return (
                <div key={r.symbol} style={{ borderBottom: `1px solid rgba(255,255,255,0.05)`, background: isExp ? '#13131a' : 'transparent' }}>
                  <button onClick={() => setExpRow(isExp ? null : r.symbol)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 14px', color: 'inherit' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 70px 1fr 110px 70px', gap: 10, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: F.md, fontWeight: 800, color: TEXT }}>{r.symbol}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>{r.exchange}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: F.sm, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>{r.sector || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: F.h2, fontWeight: 900, color: 'var(--mc-state-persistent)' }}>{r.totalScore}</div>
                        <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>{r.grade}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4, background: `${r.stageColor}20`, color: r.stageColor, border: `1px solid ${r.stageColor}40` }}>
                          {r.stageEmoji} {r.stage}
                        </span>
                        {r.inBuyZone && <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--mc-bullish)', marginTop: 3 }}>🎯 BUY-ZONE</div>}
                        {/* PATCH 0374 — Archetype badge */}
                        <div title={r.archetypeNote}
                          style={{ fontSize: 9, fontWeight: 800, color: r.archetypeColor, marginTop: 3, padding: '1px 5px', display: 'inline-block', borderRadius: 3, background: `${r.archetypeColor}15`, border: `1px solid ${r.archetypeColor}40` }}>
                          {r.archetypeLabel}
                        </div>
                        {/* PATCH 0381 — Institutional chips: BEST + Type + Phase + Survival */}
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
                          {r.isBestCandidate && (
                            <span title="Best Risk/Reward candidate: TURNAROUND + Phase 3 + Survival ≥ 6/8 + zero killers" style={{ fontSize: 8, fontWeight: 900, color: 'var(--mc-warn)', padding: '1px 4px', borderRadius: 3, background: 'color-mix(in srgb, var(--mc-warn) 15%, transparent)', border: '1px solid var(--mc-warn)' }}>★ BEST</span>
                          )}
                          {r.turnaroundType !== 'UNKNOWN' && (
                            <span title={r.turnaroundTypeNote} style={{
                              fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3,
                              color: r.turnaroundType === 'CYCLICAL' ? 'var(--mc-bullish)' : r.turnaroundType === 'OPERATIONAL' ? 'var(--mc-warn)' : 'var(--mc-bearish)',
                              background: r.turnaroundType === 'CYCLICAL' ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : r.turnaroundType === 'OPERATIONAL' ? 'color-mix(in srgb, var(--mc-warn) 8%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)',
                              border: `1px solid ${r.turnaroundType === 'CYCLICAL' ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : r.turnaroundType === 'OPERATIONAL' ? 'color-mix(in srgb, var(--mc-warn) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)'}`,
                            }}>{r.turnaroundType.slice(0, 4)}</span>
                          )}
                          <span title={`${r.phaseLabel} — ${r.phaseAction}`} style={{
                            fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3,
                            color: r.phase === 3 ? 'var(--mc-bullish)' : r.phase === 4 ? 'var(--mc-cyan)' : r.phase === 2 ? 'var(--mc-state-persistent)' : 'var(--mc-bearish)',
                            background: '#13131a',
                            border: `1px solid ${r.phase === 3 ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : r.phase === 4 ? 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' : r.phase === 2 ? 'color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)'}`,
                          }}>Ph{r.phase}{r.phase === 3 ? '★' : ''}</span>
                          <span title={`Survival ${r.survivalScore}/8 — playbook Ch.4 gate`} style={{
                            fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3,
                            color: r.survivalScore >= 7 ? 'var(--mc-bullish)' : r.survivalScore >= 5 ? 'var(--mc-cyan)' : 'var(--mc-bearish)',
                            background: '#13131a',
                            border: `1px solid ${r.survivalScore >= 7 ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : r.survivalScore >= 5 ? 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)'}`,
                          }}>S {r.survivalScore}/8</span>
                          {r.suggestedPositionPct > 0 && (
                            <span title="Max position size suggestion (playbook Ch.6)" style={{ fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3, color: 'var(--mc-text-3)', border: '1px solid color-mix(in srgb, var(--mc-text-3) 25%, transparent)' }}>Max {r.suggestedPositionPct}%</span>
                          )}
                          {r.killers.length > 0 && (
                            <span title={`Killers: ${r.killers.join(' · ')}`} style={{ fontSize: 8, fontWeight: 900, padding: '1px 4px', borderRadius: 3, color: 'var(--mc-bearish)', background: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', border: '1px solid var(--mc-bearish)' }}>⚠ {r.killers.length} killer{r.killers.length > 1 ? 's' : ''}</span>
                          )}
                        </div>
                      </div>
                      {/* Dimension bars — PATCH 0381: max values rebalanced (E 20, O 10, CC 25) */}
                      <div style={{ display: 'flex', gap: 5 }}>
                        {[
                          { label: 'EARN', val: r.earningsScore, max: 20, color: '#10B981' },
                          { label: 'OPS', val: r.operationalScore, max: 10, color: '#22D3EE' },
                          { label: 'BAL', val: r.balanceSheetScore, max: 15, color: '#A78BFA' },
                          { label: 'CC', val: r.concallScore, max: 25, color: '#F59E0B' },
                          { label: 'IND', val: r.industryScore, max: 10, color: '#34d399' },
                          { label: 'GOV', val: r.governanceScore, max: 10, color: '#fbbf24' },
                          { label: 'VAL', val: r.valuationScore, max: 10, color: '#f97316' },
                        ].map(d => {
                          const pct = (d.val / d.max) * 100;
                          return (
                            <div key={d.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 30 }}>
                              <span style={{ fontSize: 10, fontWeight: 800, color: d.color }}>{Math.round(d.val)}</span>
                              <div style={{ width: 24, height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                                <div style={{ height: '100%', width: `${pct}%`, backgroundColor: d.color, borderRadius: 2 }} />
                              </div>
                              <span style={{ fontSize: 8, color: MUTED }}>{d.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 10, color: MUTED, textAlign: 'center' }}>
                        <div style={{ color: r.pe != null ? TEXT : MUTED }}>PE {r.pe?.toFixed(0) ?? '—'}</div>
                        <div>ROCE {r.roce?.toFixed(0) ?? '—'}</div>
                      </div>
                      <div style={{ fontSize: 10, color: r.coverage >= 70 ? GREEN : r.coverage >= 50 ? 'var(--mc-warn)' : 'var(--mc-bearish)', textAlign: 'center', fontWeight: 700 }}>
                        {r.coverage}%
                      </div>
                    </div>
                  </button>
                  {isExp && (
                    <div style={{ padding: '4px 14px 16px', background: '#13131a' }}>
                      {/* PATCH 0374 — Archetype diagnostic block: tells the user
                          IMMEDIATELY whether this row belongs in the Turnaround
                          tab, and if not, what it actually is. */}
                      <div style={{ marginBottom: 12, padding: '10px 12px', background: `${r.archetypeColor}10`, border: `1px solid ${r.archetypeColor}40`, borderRadius: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: r.archetypeColor, letterSpacing: '0.4px', marginBottom: 3 }}>
                          {r.archetypeLabel} — verdict
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5 }}>{r.archetypeNote}</div>
                      </div>

                      {/* PATCH 0381 — Institutional panel: Type / Phase / Survival / Killers / Position */}
                      <div style={{ marginBottom: 12, padding: '12px', background: 'var(--mc-bg-0)', border: '1px solid color-mix(in srgb, var(--mc-warn) 19%, transparent)', borderRadius: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--mc-warn)', letterSpacing: '0.5px', marginBottom: 8 }}>★ INSTITUTIONAL PLAYBOOK READING</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: 11, color: 'var(--mc-text-2)' }}>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>TURNAROUND TYPE (Ch.1)</div>
                            <div style={{ fontWeight: 800, color: r.turnaroundType === 'CYCLICAL' ? 'var(--mc-bullish)' : r.turnaroundType === 'OPERATIONAL' ? 'var(--mc-warn)' : r.turnaroundType === 'DISTRESSED' ? 'var(--mc-bearish)' : 'var(--mc-text-3)', marginBottom: 2 }}>{r.turnaroundType}</div>
                            <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.4 }}>{r.turnaroundTypeNote}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>PHASE (Ch.2)</div>
                            <div style={{ fontWeight: 800, color: r.phase === 3 ? 'var(--mc-bullish)' : r.phase === 4 ? 'var(--mc-cyan)' : r.phase === 2 ? 'var(--mc-state-persistent)' : 'var(--mc-bearish)', marginBottom: 2 }}>{r.phaseLabel}</div>
                            <div style={{ fontSize: 10, color: MUTED }}>Action: <strong style={{ color: 'var(--mc-text-2)' }}>{r.phaseAction}</strong></div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>SURVIVAL FILTER (Ch.4) — {r.survivalScore}/8</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {r.survivalChecks.map((c, i) => (
                                <div key={i} title={c.note} style={{ fontSize: 10, color: c.pass ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
                                  {c.pass ? '✓' : '✗'} {c.label} <span style={{ color: MUTED }}>({c.note})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>POSITION SIZE (Ch.6)</div>
                            <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--mc-cyan)' }}>Max {r.suggestedPositionPct}% of portfolio</div>
                            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>Based on type + survival + killers</div>
                          </div>
                          {r.killers.length > 0 && (
                            <div style={{ gridColumn: '1 / -1' }}>
                              <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.4px', marginBottom: 4 }}>⚠ KILLERS DETECTED (PART VII) — {r.killers.length}</div>
                              {r.killers.map((k, i) => (
                                <div key={i} style={{ fontSize: 11, color: '#FCA5A5', padding: '2px 0' }}>› {k}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* PATCH 0374 — Missing-fields hint when coverage is low */}
                      {r.coverage < 70 && r.missingFields.length > 0 && (
                        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'color-mix(in srgb, var(--mc-warn) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 6 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px', marginBottom: 4 }}>
                            ⚠ DATA COVERAGE {r.coverage}% — {r.missingFields.length} fields missing
                          </div>
                          <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.5 }}>
                            Not in this CSV: <strong style={{ color: 'var(--mc-text-2)' }}>{r.missingFields.join(' · ')}</strong>
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                        {/* Inflection Signals */}
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>📈 INFLECTION SIGNALS</div>
                          {r.inflectionSignals.length > 0 ? r.inflectionSignals.map((s, i) => (
                            <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-2)', padding: '2px 0' }}>› {s}</div>
                          )) : <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>No earnings inflection detected yet</div>}
                        </div>
                        {/* Quarterly trail */}
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>📊 QUARTERLY TRAIL</div>
                          <div style={{ fontSize: 10, color: MUTED, fontFamily: 'ui-monospace, monospace' }}>
                            <div>Sales: {r.salesQ4?.toFixed(0) ?? '—'} → {r.salesQ3?.toFixed(0) ?? '—'} → {r.salesQ2?.toFixed(0) ?? '—'} → <span style={{ color: TEXT }}>{r.salesQ1?.toFixed(0) ?? '—'}</span></div>
                            <div>OPM: {r.opmQ4?.toFixed(0) ?? '—'}% → {r.opmQ3?.toFixed(0) ?? '—'}% → {r.opmQ2?.toFixed(0) ?? '—'}% → <span style={{ color: TEXT }}>{r.opmQ1?.toFixed(0) ?? '—'}%</span></div>
                            <div>PAT: {r.patQ4?.toFixed(0) ?? '—'} → {r.patQ3?.toFixed(0) ?? '—'} → {r.patQ2?.toFixed(0) ?? '—'} → <span style={{ color: (r.patQ1 ?? 0) > 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{r.patQ1?.toFixed(0) ?? '—'}</span></div>
                            <div>EPS: {r.epsQ4?.toFixed(1) ?? '—'} → {r.epsQ3?.toFixed(1) ?? '—'} → {r.epsQ2?.toFixed(1) ?? '—'} → <span style={{ color: TEXT }}>{r.epsQ1?.toFixed(1) ?? '—'}</span></div>
                          </div>
                        </div>
                        {/* Concall paste */}
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>🎙 CONCALL NARRATIVE — paste to unlock score</div>
                          <textarea
                            value={concallMap[r.symbol] || ''}
                            onChange={(e) => updateConcall(r.symbol, e.target.value)}
                            placeholder="Paste recent concall transcript / Q&A / management commentary. Engine auto-detects institutional phrases (capacity expansion, margin recovery, deleveraging, demand recovery, etc.) and scores up to 15 points."
                            style={{ width: '100%', minHeight: 90, padding: '6px 9px', backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 4, color: 'var(--mc-text-1)', fontSize: 11, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                          />
                          <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
                            Concall score: <span style={{ color: r.concallScore >= 8 ? 'var(--mc-bullish)' : r.concallScore >= 4 ? 'var(--mc-warn)' : MUTED, fontWeight: 700 }}>{r.concallScore.toFixed(1)} / 15</span>
                            {r.concallPhrases.length > 0 && <> · phrases: {r.concallPhrases.join(', ')}</>}
                          </div>
                        </div>
                      </div>

                      {/* Strengths + Risks */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 5 }}>✅ STRENGTHS</div>
                          {r.strengths.length > 0 ? r.strengths.map((s, i) => (
                            <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-2)', padding: '2px 0' }}>› {s}</div>
                          )) : <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>No notable strengths captured yet</div>}
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mc-bearish)', fontWeight: 800, marginBottom: 5 }}>⚠️ RISKS</div>
                          {r.risks.length > 0 ? r.risks.map((s, i) => (
                            <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-2)', padding: '2px 0' }}>› {s}</div>
                          )) : <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>No specific risks flagged</div>}
                        </div>
                      </div>

                      {/* PATCH 0386 — SIX-FACTOR MASTER CHECKLIST (playbook Ch.5) */}
                      <div style={{ marginTop: 14, padding: 12, background: 'var(--mc-bg-0)', border: `1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)`, borderRadius: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--mc-state-persistent)', letterSpacing: '0.5px', marginBottom: 8 }}>📋 SIX-FACTOR MASTER CHECKLIST (Ch.5)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, fontSize: 11 }}>
                          {(() => {
                            const factors = [
                              { name: 'F1 Balance Sheet Survival', score: `${r.survivalScore}/8`, pass: r.survivalScore >= 6, note: 'gate condition — see survival panel' },
                              { name: 'F2 Earnings Inflection', score: `${r.earningsScore.toFixed(0)}/20`, pass: r.earningsScore >= 8, note: 'most important for timing' },
                              { name: 'F3 Industry Cycle Turn', score: `${r.industryScore.toFixed(0)}/10`, pass: r.industryScore >= 5, note: 'sector-wide vs company-specific' },
                              { name: 'F4 Management Quality', score: `${r.governanceScore.toFixed(0)}/10`, pass: r.governanceScore >= 5, note: 'check pledge, promoter buying' },
                              { name: 'F5 Liquidity Tailwind', score: `${r.balanceSheetScore.toFixed(0)}/15`, pass: r.balanceSheetScore >= 7, note: 'macro + credit spreads + sector' },
                              { name: 'F6 Concall / Narrative', score: `${r.concallScore.toFixed(0)}/25`, pass: r.concallScore >= 10, note: 'paste-text confirms thesis' },
                            ];
                            return factors.map((f, i) => (
                              <div key={i} style={{ padding: '8px 10px', background: '#13131a', border: `1px solid ${f.pass ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-text-3) 25%, transparent)'}`, borderRadius: 5 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: f.pass ? 'var(--mc-bullish)' : 'var(--mc-text-3)', marginBottom: 2 }}>{f.pass ? '✓' : '○'} {f.name}</div>
                                <div style={{ fontSize: 13, fontWeight: 900, color: f.pass ? 'var(--mc-bullish)' : 'var(--mc-text-2)' }}>{f.score}</div>
                                <div style={{ fontSize: 9, color: MUTED, marginTop: 1, lineHeight: 1.3 }}>{f.note}</div>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>

                      {/* PATCH 0386 — ENTRY / EXIT STAGING (playbook Ch.6) */}
                      <div style={{ marginTop: 14, padding: 12, background: 'var(--mc-bg-0)', border: `1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)`, borderRadius: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--mc-bullish)', letterSpacing: '0.5px', marginBottom: 8 }}>🎯 ENTRY & EXIT STAGING (Ch.6)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 11 }}>
                          {(() => {
                            const max = r.suggestedPositionPct;
                            const cur = r.phase === 3 && r.isBestCandidate ? 'NOW' : r.phase === 2 ? 'NOW' : r.phase === 1 ? 'WAIT' : '—';
                            const stages = [
                              { label: '🪨 STAGE 1 STARTER', pct: (max * 0.225).toFixed(1), trigger: 'Stabilisation confirmed; balance sheet survival clear; rate of deterioration slowing', active: r.phase === 2 && cur === 'NOW' },
                              { label: '🧱 STAGE 2 CONFIRM', pct: (max * 0.325).toFixed(1), trigger: 'First estimate revision up; insider buying confirmed; higher lows on chart', active: r.phase === 3 && !r.isBestCandidate },
                              { label: '🏛️ STAGE 3 FULL', pct: (max * 0.45).toFixed(1), trigger: 'Recovery thesis clearly underway; sequential rev growth; margin expansion visible', active: r.phase === 3 && r.isBestCandidate },
                            ];
                            return stages.map((s, i) => (
                              <div key={i} style={{ padding: '8px 10px', background: s.active ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : '#13131a', border: `1px solid ${s.active ? 'var(--mc-bullish)' : 'color-mix(in srgb, var(--mc-text-3) 25%, transparent)'}`, borderRadius: 5 }}>
                                <div style={{ fontSize: 10, fontWeight: 800, color: s.active ? 'var(--mc-bullish)' : MUTED, marginBottom: 3 }}>{s.label}{s.active ? ' · ACTIVE' : ''}</div>
                                <div style={{ fontSize: 14, fontWeight: 900, color: s.active ? 'var(--mc-bullish)' : 'var(--mc-text-2)' }}>{s.pct}% of portfolio</div>
                                <div style={{ fontSize: 9, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>{s.trigger}</div>
                              </div>
                            ));
                          })()}
                        </div>
                        <div style={{ marginTop: 10, padding: '8px 10px', background: 'color-mix(in srgb, var(--mc-bearish) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', borderRadius: 5 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-bearish)', marginBottom: 4 }}>🚪 EXIT TRIGGERS</div>
                          <div style={{ fontSize: 10, color: 'var(--mc-text-2)', lineHeight: 1.5 }}>
                            <strong>TRIM</strong> when stock up 100%+ and valuation approaching normalised fair value · <strong>SELL</strong> if thesis broken, material new negative, management credibility destroyed · <strong>IMMEDIATE EXIT</strong> on covenant breach, surprise maturity, CCC downgrade, accounting restatement, key contract loss
                          </div>
                        </div>
                      </div>

                      {/* PATCH 0386 — ALL METRICS table (matches Multibagger India depth) */}
                      <details style={{ marginTop: 14, padding: 12, background: 'var(--mc-bg-0)', border: `1px solid ${BORDER}`, borderRadius: 6 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 900, color: 'var(--mc-cyan)', letterSpacing: '0.5px' }}>📐 ALL METRICS (click to expand raw data)</summary>
                        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                          {(() => {
                            const sections: Array<{ title: string; fields: Array<[string, unknown, string?]> }> = [
                              { title: 'Spot', fields: [
                                ['CMP', r.cmp, '₹'],
                                ['Mar Cap', r.marketCapCr, '₹Cr'],
                                ['P/E', r.pe],
                                ['P/E 5y med', r.pe5yMedian],
                                ['EV/EBITDA', r.evEbitda],
                                ['1Y perf', r.perf1y, '%'],
                              ]},
                              { title: 'Quarterly', fields: [
                                ['Sales Q1', r.salesQ1, '₹Cr'],
                                ['Sales Q2', r.salesQ2, '₹Cr'],
                                ['OPM Q1', r.opmQ1, '%'],
                                ['OPM Q2', r.opmQ2, '%'],
                                ['PAT Q1', r.patQ1, '₹Cr'],
                                ['PAT Q2', r.patQ2, '₹Cr'],
                                ['EPS Q1', r.epsQ1, '₹'],
                                ['Qtr PAT YoY', r.patQ1Yoy != null && r.patQ1 != null ? ((r.patQ1 - r.patQ1Yoy) / Math.abs(r.patQ1Yoy) * 100) : null, '%'],
                              ]},
                              { title: 'Annual', fields: [
                                ['Rev growth 1y', r.revenueGrowth1y, '%'],
                                ['Rev growth 3y', r.revenueGrowth3y, '%'],
                                ['Rev growth 5y', r.revenueGrowth5y, '%'],
                                ['PAT growth 1y', r.patGrowth1y, '%'],
                                ['PAT growth 3y', r.patGrowth3y, '%'],
                                ['Sales Y1', r.salesY1, '₹Cr'],
                                ['Sales Y2', r.salesY2, '₹Cr'],
                                ['PAT Y1', r.patY1, '₹Cr'],
                                ['PAT Y2', r.patY2, '₹Cr'],
                                ['Loss years', r.lossMakingYears5y, '/5'],
                              ]},
                              { title: 'Balance Sheet', fields: [
                                ['Debt', r.debtCurr, '₹Cr'],
                                ['Debt 3y back', r.debt3yBack, '₹Cr'],
                                ['D/E', r.de],
                                ['Int Coverage', r.interestCoverage, 'x'],
                                ['Int Cov 3y', r.interestCoverage3yBack, 'x'],
                                ['WC days', r.workingCapitalDays],
                                ['WC days 3y', r.workingCapitalDays3yBack],
                              ]},
                              { title: 'Returns', fields: [
                                ['ROCE', r.roce, '%'],
                                ['ROCE 3y', r.roce3yBack, '%'],
                                ['ROE', r.roe, '%'],
                              ]},
                              { title: 'Governance', fields: [
                                ['Promoter', r.promoterHolding, '%'],
                                ['Prom 3y back', r.promoterHolding3yBack, '%'],
                                ['Pledge', r.promoterPledgePct, '%'],
                              ]},
                            ];
                            return sections.map((s, i) => (
                              <div key={i}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.4px', marginBottom: 4 }}>{s.title.toUpperCase()}</div>
                                {s.fields.map(([k, v, suf], j) => {
                                  const display = v == null || (typeof v === 'number' && isNaN(v as number))
                                    ? '—'
                                    : typeof v === 'number' ? `${(v as number).toFixed(Math.abs(v as number) >= 100 ? 0 : 1)}${suf ? ' ' + suf : ''}` : String(v);
                                  return (
                                    <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                      <span style={{ color: MUTED }}>{k}</span>
                                      <span style={{ color: display === '—' ? MUTED : 'var(--mc-text-2)', fontWeight: 700 }}>{display}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ));
                          })()}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Lightweight CSV parser used by TurnaroundCompare. Handles quoted commas, BOM, trimming.
// PATCH 0755 — parseCsvFlexible extracted to lib/multibagger-csv-parsers.ts.
// Local re-export keeps existing callsites working without changes.

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0057 — HISTORICAL MULTIBAGGER REFERENCE PANEL
//
// Renders HISTORICAL_MULTIBAGGERS[] as cards so users can compare their
// uploaded stocks against canonical 100×–500× winners at the moment they
// were buyable. Includes pattern-matching: which canonical stock looks
// most similar to each upload.
// ═══════════════════════════════════════════════════════════════════════════
