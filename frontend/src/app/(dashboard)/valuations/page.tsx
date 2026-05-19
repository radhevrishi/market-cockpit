// ═══════════════════════════════════════════════════════════════════════════
// VALUATION-C — /valuations tab
//
// Dedicated page showing every stock in mb_excel_scored_v2 with:
//  - Inline FV / MoS / verdict on each row
//  - Expand row → all 10 model outputs (Bull/Base/Bear matrix)
//  - Sortable, filterable
//  - Per-stock assumptions editor (overrides persist in localStorage)
//  - Bulk-import for pasting the "Acutaas 30% FY26" style guidance tables
// ═══════════════════════════════════════════════════════════════════════════

'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  computeValuations, readOverrides, writeOverrides, clearOverrides,
  type ValuationReport, type ValuationOverrides,
} from '@/lib/valuation';
import { parseBulkTable, type BulkRow } from '@/lib/valuation/guidance-extractor';
// PATCH 0494 — Resolve raw BSE codes (e.g. 526612) to NSE symbols throughout the page.
import { resolveTicker } from '@/lib/bse-nse-mapping';

const BG = '#0a0a0f';
const CARD = '#13131a';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT = '#e2e8f0';
const MUTED = '#64748b';
const GREEN = '#10b981';
const RED = '#ef4444';
const AMBER = '#f59e0b';
const PURPLE = '#a78bfa';
const CYAN = '#22d3ee';

function fmtINR(v: number | undefined): string {
  if (v === undefined || isNaN(v)) return '—';
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return `₹${v.toFixed(0)}`;
}
function fmtPct(v: number | undefined, digits = 0): string {
  if (v === undefined || isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

const VERDICT_META = {
  UNDERVALUED:        { color: GREEN, label: 'UNDERVALUED',        icon: '▲' },
  FAIR:               { color: AMBER, label: 'FAIR',               icon: '◆' },
  OVERVALUED:         { color: RED,   label: 'OVERVALUED',         icon: '▼' },
  INSUFFICIENT_DATA:  { color: MUTED, label: 'INSUFFICIENT_DATA',  icon: '·' },
} as const;

export default function ValuationsPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const initialSymbol = sp?.get('symbol') || '';

  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'UNDERVALUED' | 'FAIR' | 'OVERVALUED'>('ALL');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'mos' | 'symbol' | 'fv' | 'cmp'>('mos');
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(initialSymbol);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<BulkRow[] | null>(null);
  const [_tick, setTick] = useState(0);  // bump to force re-compute when overrides update

  // Load rows from localStorage
  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem('mb_excel_scored_v2');
        setRows(raw ? JSON.parse(raw) : []);
      } catch { setRows([]); }
    };
    load();
    const onUpload = () => load();
    const onOverride = () => setTick(t => t + 1);
    window.addEventListener('mb-upload:updated', onUpload);
    window.addEventListener('mc:valuation-overrides:updated', onOverride);
    window.addEventListener('storage', (e) => {
      if (e.key === 'mb_excel_scored_v2') load();
      if (e.key === 'mc:valuations:overrides:v1') onOverride();
    });
    return () => {
      window.removeEventListener('mb-upload:updated', onUpload);
      window.removeEventListener('mc:valuation-overrides:updated', onOverride);
    };
  }, []);

  // Compute valuation reports for every row
  const reports: Array<{ row: any; report: ValuationReport }> = useMemo(() => {
    return rows.map(r => ({ row: r, report: computeValuations(r) }));
    // _tick included so override updates trigger recompute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, _tick]);

  // Sectors for filter dropdown
  const sectors = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.sector) set.add(r.sector); });
    return ['All', ...Array.from(set).sort()];
  }, [rows]);

  // Filter + sort
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = reports.filter(({ row, report }) => {
      if (filter !== 'ALL' && report.consensus.verdict !== filter) return false;
      if (sectorFilter !== 'All' && row.sector !== sectorFilter) return false;
      if (q && !(row.symbol?.toLowerCase().includes(q) || row.company?.toLowerCase().includes(q))) return false;
      return true;
    });
    const sign = sortAsc ? 1 : -1;
    arr.sort((a, b) => {
      const k = sortBy;
      const av =
        k === 'mos' ? (a.report.consensus.marginOfSafety ?? -999) :
        k === 'fv'  ? (a.report.consensus.fairValueBase ?? 0) :
        k === 'cmp' ? (a.report.cmp ?? 0) :
        a.row.symbol;
      const bv =
        k === 'mos' ? (b.report.consensus.marginOfSafety ?? -999) :
        k === 'fv'  ? (b.report.consensus.fairValueBase ?? 0) :
        k === 'cmp' ? (b.report.cmp ?? 0) :
        b.row.symbol;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
      return String(av).localeCompare(String(bv)) * sign;
    });
    return arr;
  }, [reports, filter, sectorFilter, search, sortBy, sortAsc]);

  // Counts for the verdict filter bar
  const counts = useMemo(() => {
    const c = { ALL: reports.length, UNDERVALUED: 0, FAIR: 0, OVERVALUED: 0, INSUFFICIENT_DATA: 0 };
    for (const { report } of reports) {
      const v = report.consensus.verdict;
      if (v in c) (c as any)[v]++;
    }
    return c;
  }, [reports]);

  const processBulk = () => {
    const universe = rows.map(r => ({ symbol: r.symbol, company: r.company || r.symbol }));
    const parsed = parseBulkTable(bulkText, universe);
    setBulkPreview(parsed);
  };

  const applyBulk = () => {
    if (!bulkPreview) return;
    let n = 0;
    for (const row of bulkPreview) {
      if (!row.matchedSymbol) continue;
      const cur = readOverrides(row.matchedSymbol);
      writeOverrides(row.matchedSymbol, {
        ...cur,
        guidanceGrowth: row.extracted.growthPct ?? cur.guidanceGrowth,
        guidanceEbitdaMargin: row.extracted.ebitdaMarginPct ?? cur.guidanceEbitdaMargin,
        guidanceRevenueTarget: row.extracted.revenueTargetCr ?? cur.guidanceRevenueTarget,
        guidanceFiscalYear: row.extracted.fiscalYear ?? cur.guidanceFiscalYear,
        guidanceConfidence: row.extracted.confidence,
      });
      n++;
    }
    setShowBulkImport(false);
    setBulkPreview(null);
    setBulkText('');
    alert(`Applied guidance to ${n} stocks.`);
  };

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, padding: '20px 24px', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: PURPLE, margin: 0 }}>💰 Valuation Engine</h1>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
            10 institutional models per stock · Bull / Base / Bear scenarios · Auto from Screener data + concall guidance
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowBulkImport(s => !s)} style={btnStyle(CYAN)}>📋 Bulk Import Guidance</button>
          <button onClick={() => router.push('/multibagger')} style={btnStyle(MUTED)}>← Multibagger</button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Loaded', value: counts.ALL, color: TEXT },
          { label: 'Undervalued', value: counts.UNDERVALUED, color: GREEN },
          { label: 'Fair', value: counts.FAIR, color: AMBER },
          { label: 'Overvalued', value: counts.OVERVALUED, color: RED },
          { label: 'Insufficient', value: counts.INSUFFICIENT_DATA, color: MUTED },
        ].map(s => (
          <div key={s.label} style={{ background: CARD, border: `1px solid ${BORDER}`, padding: '8px 14px', borderRadius: 8, minWidth: 96 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['ALL', 'UNDERVALUED', 'FAIR', 'OVERVALUED'] as const).map(v => (
          <button key={v} onClick={() => setFilter(v)}
            style={{
              padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${filter === v ? VERDICT_META[v === 'ALL' ? 'FAIR' : v].color : BORDER}`,
              background: filter === v ? `${VERDICT_META[v === 'ALL' ? 'FAIR' : v].color}20` : 'transparent',
              color: filter === v ? VERDICT_META[v === 'ALL' ? 'FAIR' : v].color : MUTED,
            }}>
            {v} {filter === v ? `· ${counts[v as keyof typeof counts]}` : ''}
          </button>
        ))}
        <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} style={selStyle()}>
          {sectors.map(s => <option key={s}>{s}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ticker / company…"
          style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDER}`, background: CARD, color: TEXT, fontSize: 11, flex: 1, minWidth: 180 }} />
      </div>

      {/* Bulk import panel */}
      {showBulkImport && (
        <div style={{ background: CARD, border: `1px solid ${CYAN}40`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: CYAN, marginBottom: 8 }}>📋 BULK IMPORT GUIDANCE</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 10 }}>
            Paste the "Company → Growth Guidance" table from your concall notes. Each row maps to a ticker
            in your upload via fuzzy company-name match. Numbers extracted automatically — growth %, EBITDA
            margin %, FY targets, ₹ Cr revenue targets.
          </div>
          <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={10}
            placeholder={`Acutaas Chemicals Ltd\t30% revenue growth for FY26
Aeroflex Industries Ltd\t25% EBITDA growth for FY26
Aimtron Electronics Ltd\t40-50% CAGR revenue growth guidance for FY26
…`}
            style={{ width: '100%', padding: 10, fontFamily: 'monospace', fontSize: 11, background: BG, border: `1px solid ${BORDER}`, borderRadius: 6, color: TEXT }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={processBulk} style={btnStyle(CYAN)}>Preview matches</button>
            {bulkPreview && bulkPreview.some(r => r.matchedSymbol) && (
              <button onClick={applyBulk} style={btnStyle(GREEN)}>
                Apply guidance ({bulkPreview.filter(r => r.matchedSymbol).length} matched)
              </button>
            )}
            <button onClick={() => { setShowBulkImport(false); setBulkPreview(null); setBulkText(''); }} style={btnStyle(MUTED)}>Cancel</button>
          </div>
          {bulkPreview && (
            <div style={{ marginTop: 12, maxHeight: 280, overflowY: 'auto', border: `1px solid ${BORDER}`, borderRadius: 6 }}>
              {bulkPreview.map((row, i) => (
                <div key={i} style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER}`, fontSize: 11, display: 'grid', gridTemplateColumns: '180px 1fr 200px', gap: 10 }}>
                  <div style={{ fontWeight: 700, color: row.matchedSymbol ? GREEN : RED }}>
                    {row.matchedSymbol || '✗ UNMATCHED'}
                    <div style={{ fontSize: 9, color: MUTED, fontWeight: 400, marginTop: 2 }}>{row.companyText}</div>
                  </div>
                  <div style={{ color: TEXT }}>
                    {row.guidanceText}
                    <div style={{ fontSize: 9, color: MUTED, marginTop: 3 }}>
                      Extracted: {row.extracted.matches.join(' · ') || 'no patterns matched'}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', color: row.extracted.confidence === 'HIGH' ? GREEN : row.extracted.confidence === 'MEDIUM' ? AMBER : MUTED }}>
                    g={row.extracted.growthPct ?? '—'}%<br/>
                    m={row.extracted.ebitdaMarginPct ?? '—'}%<br/>
                    {row.extracted.fiscalYear || ''} {row.extracted.confidence}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {visible.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: MUTED, fontSize: 13, background: CARD, borderRadius: 8 }}>
          {rows.length === 0
            ? <>No stocks loaded. Upload your Screener.in CSV in the <a href="/multibagger" style={{ color: PURPLE }}>Multibagger tab</a> first.</>
            : <>No stocks match current filters. {visible.length}/{rows.length}.</>}
        </div>
      ) : (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 90px 90px 110px 90px 110px 100px', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            <HeaderCell label="Ticker" onClick={() => { setSortBy('symbol'); setSortAsc(s => !s); }} active={sortBy === 'symbol'} asc={sortAsc} />
            <div>Company / Sector</div>
            <HeaderCell label="CMP" align="right" onClick={() => { setSortBy('cmp'); setSortAsc(s => !s); }} active={sortBy === 'cmp'} asc={sortAsc} />
            <div style={{ textAlign: 'right' }}>BEAR</div>
            <HeaderCell label="BASE (FV)" align="right" onClick={() => { setSortBy('fv'); setSortAsc(s => !s); }} active={sortBy === 'fv'} asc={sortAsc} />
            <div style={{ textAlign: 'right' }}>BULL</div>
            <HeaderCell label="MoS" align="right" onClick={() => { setSortBy('mos'); setSortAsc(s => !s); }} active={sortBy === 'mos'} asc={sortAsc} />
            <div style={{ textAlign: 'center' }}>Verdict</div>
          </div>

          {visible.map(({ row, report }) => {
            const c = report.consensus;
            const meta = VERDICT_META[c.verdict];
            const isExp = expanded === row.symbol;
            return (
              <React.Fragment key={row.symbol}>
                <div
                  onClick={() => setExpanded(isExp ? null : row.symbol)}
                  style={{
                    display: 'grid', gridTemplateColumns: '120px 1fr 90px 90px 110px 90px 110px 100px',
                    gap: 8, padding: '10px 14px', borderBottom: `1px solid ${BORDER}`,
                    fontSize: 11, alignItems: 'center', cursor: 'pointer',
                    background: isExp ? 'rgba(167,139,250,0.04)' : 'transparent',
                  }}
                >
                  <div style={{ fontWeight: 800, color: PURPLE, fontFamily: 'monospace' }} title={(() => { const r = resolveTicker(row.symbol); return r.bseCode ? `BSE ${r.bseCode}` : (r.shortName || ''); })()}>
                    {(() => { const r = resolveTicker(row.symbol); return r.nseSymbol || r.display || row.symbol; })()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: TEXT }}>{row.company || row.symbol}</div>
                    <div style={{ fontSize: 9, color: MUTED }}>{row.sector || '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: TEXT }}>{fmtINR(report.cmp)}</div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: RED }}>{fmtINR(c.fairValueBear)}</div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: meta.color, fontWeight: 800 }}>{fmtINR(c.fairValueBase)}</div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: GREEN }}>{fmtINR(c.fairValueBull)}</div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: meta.color, fontWeight: 800 }}>{fmtPct(c.marginOfSafety)}</div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: meta.color, background: `${meta.color}20`, border: `1px solid ${meta.color}40`, padding: '2px 6px', borderRadius: 4 }}>
                      {meta.icon} {meta.label.slice(0, 4)}
                    </span>
                    <div style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>{c.modelsBuy}/{c.modelsApplicable} ✓</div>
                  </div>
                </div>

                {isExp && <ExpandedRow report={report} onUpdate={() => setTick(t => t + 1)} />}
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 10, color: MUTED, marginTop: 14, textAlign: 'center' }}>
        Disclaimer · Valuation models are quantitative tools — they don't account for governance, moat,
        secular trends, or industry disruption. Use as inputs to your decision, not as the decision.
      </div>
    </div>
  );
}

function HeaderCell({ label, align = 'left', onClick, active, asc }: { label: string; align?: 'left' | 'right'; onClick?: () => void; active?: boolean; asc?: boolean }) {
  return (
    <div onClick={onClick} style={{ textAlign: align, cursor: onClick ? 'pointer' : 'default', color: active ? PURPLE : MUTED, userSelect: 'none' }}>
      {label} {active ? (asc ? '↑' : '↓') : ''}
    </div>
  );
}

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${color}40`, background: `${color}15`, color,
  };
}
function selStyle(): React.CSSProperties {
  return { padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDER}`, background: CARD, color: TEXT, fontSize: 11 };
}

// ─── Expanded per-stock panel ─────────────────────────────────────────────────
function ExpandedRow({ report, onUpdate }: { report: ValuationReport; onUpdate: () => void }) {
  const [editingAssumptions, setEditingAssumptions] = useState(false);
  const [ovs, setOvs] = useState<ValuationOverrides>(() => readOverrides(report.symbol));

  const saveOv = () => {
    writeOverrides(report.symbol, ovs);
    setEditingAssumptions(false);
    onUpdate();
  };
  const resetOv = () => {
    clearOverrides(report.symbol);
    setOvs({});
    setEditingAssumptions(false);
    onUpdate();
  };

  return (
    <div style={{ padding: '14px 18px 16px', background: '#0c0c14', borderBottom: `1px solid ${BORDER}` }}>
      {/* Model grid */}
      <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, marginBottom: 6, letterSpacing: '0.5px' }}>ALL MODELS — Bull / Base / Bear</div>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 90px 100px 90px 100px 1fr', gap: 6, fontSize: 11 }}>
        <div style={{ fontWeight: 800, color: MUTED, fontSize: 9 }}>MODEL</div>
        <div style={{ fontWeight: 800, color: MUTED, fontSize: 9, textAlign: 'right' }}>BEAR</div>
        <div style={{ fontWeight: 800, color: MUTED, fontSize: 9, textAlign: 'right' }}>BASE</div>
        <div style={{ fontWeight: 800, color: MUTED, fontSize: 9, textAlign: 'right' }}>BULL</div>
        <div style={{ fontWeight: 800, color: MUTED, fontSize: 9, textAlign: 'right' }}>vs CMP</div>
        <div style={{ fontWeight: 800, color: MUTED, fontSize: 9 }}>DETAIL</div>

        {report.models.map(m => (
          <React.Fragment key={m.modelId}>
            <div style={{ fontWeight: 700, color: m.applicable ? TEXT : MUTED }}>
              {m.label}
              {!m.applicable && <div style={{ fontSize: 9, color: MUTED, fontWeight: 400 }}>· {m.reason}</div>}
            </div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: m.applicable ? RED : MUTED }}>{m.applicable ? fmtINR(m.bear) : '—'}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: m.applicable ? AMBER : MUTED, fontWeight: 700 }}>{m.applicable ? fmtINR(m.base) : '—'}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: m.applicable ? GREEN : MUTED }}>{m.applicable ? fmtINR(m.bull) : '—'}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: m.applicable && m.marginOfSafety !== undefined ? (m.marginOfSafety >= 15 ? GREEN : m.marginOfSafety <= -15 ? RED : AMBER) : MUTED }}>
              {m.applicable && m.marginOfSafety !== undefined ? fmtPct(m.marginOfSafety) : '—'}
            </div>
            <div style={{ fontSize: 10, color: MUTED }}>{m.detail || ''}</div>
          </React.Fragment>
        ))}

        {/* Consensus row */}
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6, fontWeight: 900, color: PURPLE }}>CONSENSUS (median)</div>
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: RED, fontWeight: 800 }}>{fmtINR(report.consensus.fairValueBear)}</div>
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: AMBER, fontWeight: 900 }}>{fmtINR(report.consensus.fairValueBase)}</div>
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: GREEN, fontWeight: 800 }}>{fmtINR(report.consensus.fairValueBull)}</div>
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: VERDICT_META[report.consensus.verdict].color, fontWeight: 900 }}>{fmtPct(report.consensus.marginOfSafety)}</div>
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6, fontSize: 10, color: MUTED }}>
          {report.consensus.modelsBuy}/{report.consensus.modelsApplicable} models say BUY
          {report.consensus.spreadPct !== undefined && ` · Spread ${report.consensus.spreadPct.toFixed(0)}%`}
        </div>
      </div>

      {/* Assumptions editor */}
      <div style={{ marginTop: 14, padding: 10, background: BG, border: `1px solid ${BORDER}`, borderRadius: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: '0.5px' }}>ASSUMPTIONS · OVERRIDES (saved per-stock, survives uploads)</div>
          {!editingAssumptions ? (
            <button onClick={() => setEditingAssumptions(true)} style={btnStyle(CYAN)}>Edit</button>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveOv} style={btnStyle(GREEN)}>Save</button>
              <button onClick={resetOv} style={btnStyle(RED)}>Reset</button>
              <button onClick={() => { setEditingAssumptions(false); setOvs(readOverrides(report.symbol)); }} style={btnStyle(MUTED)}>Cancel</button>
            </div>
          )}
        </div>

        {editingAssumptions ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: 11 }}>
            <Field label="Growth Guidance (%)" v={ovs.guidanceGrowth} onChange={(v) => setOvs((s: ValuationOverrides) =>({ ...s, guidanceGrowth: v }))} />
            <Field label="EBITDA Margin Guidance (%)" v={ovs.guidanceEbitdaMargin} onChange={(v) => setOvs((s: ValuationOverrides) =>({ ...s, guidanceEbitdaMargin: v }))} />
            <Field label="Revenue Target (₹ Cr)" v={ovs.guidanceRevenueTarget} onChange={(v) => setOvs((s: ValuationOverrides) =>({ ...s, guidanceRevenueTarget: v }))} />
            <div>
              <div style={{ fontSize: 9, color: MUTED }}>Fiscal Year</div>
              <input value={ovs.guidanceFiscalYear || ''} onChange={e => setOvs((s: ValuationOverrides) =>({ ...s, guidanceFiscalYear: e.target.value }))}
                placeholder="FY26" style={{ width: '100%', padding: '4px 8px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT }} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: MUTED }}>Notes</div>
              <input value={ovs.notes || ''} onChange={e => setOvs((s: ValuationOverrides) =>({ ...s, notes: e.target.value }))}
                placeholder="source / context" style={{ width: '100%', padding: '4px 8px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT }} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 11, color: TEXT }}>
            <div><span style={{ color: MUTED }}>Growth:</span> {ovs.guidanceGrowth !== undefined ? `${ovs.guidanceGrowth}%` : '— (auto)'}</div>
            <div><span style={{ color: MUTED }}>EBITDA Mgn:</span> {ovs.guidanceEbitdaMargin !== undefined ? `${ovs.guidanceEbitdaMargin}%` : '— (auto)'}</div>
            <div><span style={{ color: MUTED }}>Rev Target:</span> {ovs.guidanceRevenueTarget !== undefined ? `₹${ovs.guidanceRevenueTarget} Cr` : '—'}</div>
            <div><span style={{ color: MUTED }}>FY:</span> {ovs.guidanceFiscalYear || '—'}</div>
            {ovs.notes && <div style={{ gridColumn: 'span 4', fontStyle: 'italic', color: MUTED }}>{ovs.notes}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, v, onChange }: { label: string; v?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: MUTED }}>{label}</div>
      <input type="number" inputMode="decimal" value={v ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
        style={{ width: '100%', padding: '4px 8px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontVariantNumeric: 'tabular-nums' }} />
    </div>
  );
}
