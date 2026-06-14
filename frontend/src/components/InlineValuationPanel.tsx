'use client';

// ═══════════════════════════════════════════════════════════════════════════
// INLINE VALUATION PANEL (PATCH 0682)
//
// Mounted at the bottom of the Concall AI page (earnings-analysis/page.tsx).
// Self-contained multi-file upload + runs the SAME buildReport pipeline from
// auto-valuation/engine.ts (extracted to a sibling module so Next.js page-
// export rules don't block the import). One page, both analyses.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildReport, extractPdfText, extractExcelFinancials,
  type ParsedDoc, type AutoValuationReport,
} from '@/app/(dashboard)/auto-valuation/engine';
import { extractGuidance, metricLabel, formatGuidanceValue, type GuidanceItem } from '@/lib/forward-guidance-extractor';
import { getDecision, DECISION_META } from '@/lib/decisions';
import { getConvictionTickers } from '@/lib/conviction-beats';
// PATCH 0752 — pull the latest concall snapshot for this ticker and blend
// its score with the valuation triangulation upside (90/10 weight).
import { listConcallSnapshots } from '@/lib/concall-snapshot-store';
import { blendConcallWithValuation } from '@/lib/concall-valuation-blend';

const BG = '#0A0E1A';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

const recColor = (r: string) => r === 'BUY' ? '#10B981' : r === 'WATCH' ? '#22D3EE' : r === 'WAIT' ? '#F59E0B' : r === 'AVOID' ? '#EF4444' : DIM;

export default function InlineValuationPanel() {
  const [docs, setDocs] = useState<ParsedDoc[]>([]);
  const [report, setReport] = useState<AutoValuationReport | null>(null);
  const [building, setBuilding] = useState(false);
  // PATCH 0689 — institutional bear/base/bull + FY27/FY28 toggles, mirroring
  // the standalone /auto-valuation page. Default to BASE/Y1 so the panel
  // matches the editorial report's central-case framing on first render.
  const [scenario, setScenario] = useState<'BEAR' | 'BASE' | 'BULL'>('BASE');
  const [year, setYear] = useState<'Y1' | 'Y2'>('Y1');

  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    // PATCH 0685 — accept FileList (own dropzone) OR File[] (forwarded from
    // the Concall AI uploader event). Array.from handles both shapes.
    // Filter to only xlsx/pdf — Concall AI accepts more types but this
    // panel only knows what to do with financial workbooks + concall PDFs.
    const arr = Array.from(files).filter(f => /\.(xlsx?|pdf)$/i.test(f.name));
    if (arr.length === 0) return;

    const newDocs: ParsedDoc[] = arr.map(f => ({
      name: f.name,
      size: f.size,
      type: /\.xlsx?$/i.test(f.name) ? 'excel' : 'pdf',
      status: 'parsing',
    }));
    let startIdx = 0;
    setDocs(prev => { startIdx = prev.length; return [...prev, ...newDocs]; });

    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      const docIdx = startIdx + i;
      try {
        if (/\.xlsx?$/i.test(file.name)) {
          const data = await extractExcelFinancials(file);
          setDocs(prev => prev.map((d, idx) => idx === docIdx ? { ...d, status: 'done', excelData: data || undefined, message: data ? `Parsed ${data.fyLabels.length} years` : 'No financial rows detected' } : d));
        } else if (/\.pdf$/i.test(file.name)) {
          const text = await extractPdfText(file);
          const guidance = extractGuidance(text);
          setDocs(prev => prev.map((d, idx) => idx === docIdx ? { ...d, status: 'done', pdfText: text, guidance, message: `${text.length.toLocaleString()} chars · ${guidance.length} guidance items` } : d));
        } else {
          setDocs(prev => prev.map((d, idx) => idx === docIdx ? { ...d, status: 'error', message: 'Unsupported file type' } : d));
        }
      } catch (e: any) {
        setDocs(prev => prev.map((d, idx) => idx === docIdx ? { ...d, status: 'error', message: e?.message || 'parse failed' } : d));
      }
    }
  }, []);

  // PATCH 0685 — listen for the Concall AI uploader's broadcast so a single
  // drop on the top dropzone also feeds this Auto-Val pipeline. Dedupe by
  // (name, size) against docs already in state to avoid double-processing
  // when the user opens / closes the modal multiple times.
  useEffect(() => {
    const onConcallUpload = (e: Event) => {
      const detail = (e as CustomEvent).detail as { files?: File[] } | undefined;
      const incoming = detail?.files;
      if (!incoming || incoming.length === 0) return;
      const fresh = incoming.filter(
        f => !docs.some(d => d.name === f.name && d.size === f.size),
      );
      if (fresh.length === 0) return;
      handleFiles(fresh);
    };
    window.addEventListener('mc:concall-files-uploaded', onConcallUpload);
    return () => window.removeEventListener('mc:concall-files-uploaded', onConcallUpload);
  }, [docs, handleFiles]);

  useEffect(() => {
    if (docs.length === 0) { setReport(null); return; }
    const allDone = docs.every(d => d.status !== 'parsing');
    if (!allDone) return;
    setBuilding(true);
    buildReport(docs).then(r => { setReport(r); setBuilding(false); }).catch(err => {
      console.error('[InlineValuationPanel] buildReport threw:', err);
      setBuilding(false);
      setReport({ guidance: [], rationale: [`Error building report: ${err?.message || String(err)}. Try re-uploading.`], recommendation: 'NEED_MORE_DATA' } as any);
    });
  }, [docs]);

  // PATCH 0687 — once any file has flowed in (either via own dropzone or via
  // the Concall AI event bridge) we suppress the standalone upload box so the
  // section reads as one continuous institutional cross-check, not "yet
  // another upload". The dropzone returns when the user clicks NEW ANALYSIS.
  const hasFiles = docs.length > 0;

  return (
    <div style={{ marginTop: 32, padding: '20px 22px', background: 'var(--mc-bg-1)', border: `1px solid ${BORDER}`, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            🎯 Valuation Triangulation
          </h2>
          <span style={{ fontSize: 10, color: DIM, fontStyle: 'italic' }}>
            quant cross-check
          </span>
        </div>
        <a href="/auto-valuation" style={{ fontSize: 10, color: DIM, textDecoration: 'none' }}>full breakdown · /auto-valuation →</a>
      </div>
      <div style={{ fontSize: 11.5, color: DIM, marginBottom: 14, lineHeight: 1.6 }}>
        Forward P/E · P/S · EV/EBITDA fair-value using uploaded financials + concall guidance — runs on the same documents
        as the editorial report above. Reads should <strong style={{ color: TEXT }}>reinforce the editorial call</strong>
        (e.g. ACCUMULATE with P/E&nbsp;STRETCHED ↔ quant shows -20% downside on P/E base case).
        Material disagreement = re-check assumptions.
      </div>

      {/* Upload zone — hidden once any docs are present (auto-flow OR standalone) */}
      {!hasFiles && (
        <label htmlFor="inline-val-files" style={{
          display: 'block', padding: '18px 16px', textAlign: 'center', cursor: 'pointer',
          background: 'var(--mc-bg-0)', border: `2px dashed ${BORDER}`, borderRadius: 8,
          fontSize: 13, color: TEXT, marginBottom: 14,
        }}>
          <input id="inline-val-files" type="file" multiple accept=".xlsx,.xls,.pdf"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }} />
          <div style={{ fontSize: 22, marginBottom: 6 }}>📂</div>
          <div style={{ fontWeight: 700, marginBottom: 3, fontSize: 12 }}>Drop Excel financials + concall PDFs to triangulate</div>
          <div style={{ fontSize: 10.5, color: DIM }}>
            files dropped in the Concall AI uploader above flow here automatically · .xlsx + .pdf
          </div>
        </label>
      )}

      {/* Uploaded list */}
      {docs.length > 0 && (
        <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {docs.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: BG, border: `1px solid ${BORDER}`, borderRadius: 4, fontSize: 11 }}>
              <span style={{ fontWeight: 700, color: d.type === 'excel' ? 'var(--mc-bullish)' : 'var(--mc-cyan)', minWidth: 40 }}>{d.type === 'excel' ? 'XLSX' : 'PDF'}</span>
              <span style={{ color: TEXT, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
              <span style={{ color: DIM, fontSize: 10 }}>{Math.round(d.size / 1024)} KB</span>
              <span style={{ color: d.status === 'done' ? 'var(--mc-bullish)' : d.status === 'error' ? 'var(--mc-bearish)' : 'var(--mc-warn)' }}>
                {d.status === 'done' ? '✓' : d.status === 'error' ? '✗' : '⏳'}
              </span>
              <span style={{ color: DIM, fontSize: 10, fontStyle: 'italic' }}>{d.message || ''}</span>
            </div>
          ))}
        </div>
      )}

      {building && <div style={{ fontSize: 12, color: 'var(--mc-warn)', textAlign: 'center', padding: 10 }}>⏳ Building valuation report…</div>}

      {/* Report */}
      {report && (
        <div style={{ background: 'var(--mc-bg-0)', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
          {/* Quant verdict — explicitly framed as 'quant says X' so the reader
              compares it against the editorial recommendation banner above. */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>
              Quant verdict
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, color: recColor(report.recommendation) }}>{report.recommendation}</span>
            {report.company && <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{report.company}</span>}
            {report.sector && <span style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', padding: '2px 8px', borderRadius: 3 }}>{report.sector}</span>}
          </div>

          {/* PATCH 0851 — Institutional chip strip — prior decision + CB membership +
              forensic pump + margin inflection + sales accel + DNA match */}
          {(() => {
            const ticker = (report.ticker || '').toUpperCase();
            const priorDecision = ticker ? getDecision(ticker) : undefined;
            const cbSet = (typeof window !== 'undefined' ? getConvictionTickers() : new Set<string>());
            const isOnCB = ticker && cbSet.has(ticker);
            const mi = report.marginInflectionChip;
            const fp = report.forensicPumpChip;
            const sa = report.salesAccelChip;
            const dna = report.dnaMatchChip;
            const chips: React.ReactNode[] = [];
            if (priorDecision) {
              const m = DECISION_META[priorDecision.status];
              chips.push(
                <span key="dec" title={`Prior decision: ${priorDecision.status} on ${priorDecision.date.slice(0,10)} — ${priorDecision.reason || '(no reason given)'}`}
                  style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: `${m.color}25`, color: m.color, border: `1px solid ${m.color}60`, borderRadius: 3 }}>
                  {m.emoji} PRIOR: {priorDecision.status}
                </span>
              );
            }
            if (isOnCB) {
              chips.push(
                <span key="cb" title="On Conviction Beats bench" style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-warn) 15%, transparent)', color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', borderRadius: 3 }}>
                  🏆 CB
                </span>
              );
            }
            if (mi?.fired) {
              chips.push(
                <span key="mi" title={mi.interpretation} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-bullish) 15%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)', borderRadius: 3 }}>
                  ⚡ MARGIN INFLECTION +{mi.gapPp.toFixed(1)}pp
                </span>
              );
            } else if (mi?.direction === 'COMPRESSION') {
              chips.push(
                <span key="mi" title={mi.interpretation} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-bearish) 15%, transparent)', color: 'var(--mc-bearish)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 38%, transparent)', borderRadius: 3 }}>
                  ▼ MARGIN COMPRESSION {mi.gapPp.toFixed(1)}pp
                </span>
              );
            }
            if (fp && (fp.severity === 'HIGH' || fp.severity === 'CRITICAL')) {
              chips.push(
                <span key="fp" title={`Forensic pump score ${fp.pumpScore}/11 — ${fp.flags.join(' · ')}`}
                  style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-bearish) 15%, transparent)', color: 'var(--mc-bearish)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 38%, transparent)', borderRadius: 3 }}>
                  🚨 PUMP {fp.pumpScore}/11
                </span>
              );
            } else if (fp && fp.severity === 'WATCH') {
              chips.push(
                <span key="fp" title={fp.flags.join(' · ')} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-warn) 15%, transparent)', color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', borderRadius: 3 }}>
                  ⚠ PUMP WATCH {fp.pumpScore}
                </span>
              );
            } else if (fp && fp.severity === 'CLEAN') {
              chips.push(
                <span key="fp" title="No forensic pump flags detected" style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 3 }}>
                  ✓ FORENSIC CLEAN
                </span>
              );
            }
            if (sa && sa.state === 'ACCELERATING') {
              chips.push(
                <span key="sa" title={`Latest YoY ${sa.latestYoY.toFixed(0)}% vs 5y CAGR ${sa.cagr5y.toFixed(0)}% (+${sa.delta.toFixed(0)}pp)`} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-bullish) 15%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)', borderRadius: 3 }}>
                  ⇑ SALES ACCEL +{sa.delta.toFixed(0)}pp
                </span>
              );
            } else if (sa && sa.state === 'DECELERATING') {
              chips.push(
                <span key="sa" title={`Latest YoY ${sa.latestYoY.toFixed(0)}% vs 5y CAGR ${sa.cagr5y.toFixed(0)}% (${sa.delta.toFixed(0)}pp)`} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-warn) 15%, transparent)', color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', borderRadius: 3 }}>
                  ⇓ SALES DECEL {sa.delta.toFixed(0)}pp
                </span>
              );
            }
            if (dna) {
              const dnaColor = dna.matched >= 5 ? '#10B981' : dna.matched >= 3 ? '#22D3EE' : '#94A3B8';
              chips.push(
                <span key="dna" title={`500-bagger DNA: ${dna.criteria.join(' · ') || 'no criteria matched'}`}
                  style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: `${dnaColor}25`, color: dnaColor, border: `1px solid ${dnaColor}60`, borderRadius: 3 }}>
                  🧬 DNA {dna.matched}/6
                </span>
              );
            }
            if (chips.length === 0) return null;
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10, padding: '6px 0', borderTop: `1px dashed ${BORDER}`, borderBottom: `1px dashed ${BORDER}` }}>
                {chips}
              </div>
            );
          })()}

          {/* Rationale */}
          <ul style={{ margin: '0 0 12px 18px', padding: 0, fontSize: 11.5, color: TEXT, lineHeight: 1.6 }}>
            {report.rationale.slice(0, 5).map((r, i) => <li key={i}>{r}</li>)}
          </ul>

          {/* PATCH 0849 — Multi-line guidance display. User feedback: only one
              line was shown earlier; now group ALL extracted guidance items by
              metric so the user sees REVENUE / EBITDA / PAT / MARGIN / GROWTH /
              CAPEX / ORDER BOOK / CAPACITY etc. side-by-side with FY tags. */}
          {report.guidance && report.guidance.length > 0 && (() => {
            const byMetric = new Map<string, GuidanceItem[]>();
            for (const g of report.guidance) {
              const key = String(g.metric || 'OTHER');
              const arr = byMetric.get(key) || [];
              arr.push(g);
              byMetric.set(key, arr);
            }
            // Sort metric groups: REVENUE / GROWTH / EBITDA / PAT / MARGINS / CAPEX / ORDERS / CAPACITY / OTHER
            const ORDER = ['REVENUE','GROWTH','CAGR','EBITDA','EBITDA_GROWTH','PAT','EBITDA_MARGIN','PAT_MARGIN','OPM','MARGIN_BPS','CAPEX','ORDER_BOOK','ORDER_INFLOW','BOOK_TO_BILL','CAPACITY_RAMP','CAPACITY_UNITS','PEAK_REVENUE','ASP','DEBT_REPAYMENT','DIVIDEND_PAYOUT','TAX_RATE','WC_DAYS'];
            const sortedMetrics = Array.from(byMetric.keys()).sort((a, b) => {
              const ai = ORDER.indexOf(a); const bi = ORDER.indexOf(b);
              if (ai === -1 && bi === -1) return a.localeCompare(b);
              if (ai === -1) return 1;
              if (bi === -1) return -1;
              return ai - bi;
            });
            return (
              <div style={{
                marginBottom: 12, padding: '10px 12px',
                background: 'var(--mc-bg-0)', border: `1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)`,
                borderLeft: '3px solid var(--mc-state-persistent)', borderRadius: 5,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-state-persistent)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
                  📋 Forward Guidance Extracted ({report.guidance.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                  {sortedMetrics.map((metric) => {
                    const items = byMetric.get(metric)!;
                    return (
                      <div key={metric} style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '6px 8px' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--mc-state-persistent)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                          {metricLabel(metric as any)}
                        </div>
                        {items.slice(0, 8).map((g, i) => (
                          <div key={i} title={g.rawPhrase} style={{ fontSize: 11, color: TEXT, fontFamily: 'ui-monospace, monospace', lineHeight: 1.55, display: 'flex', gap: 6 }}>
                            <span style={{ color: 'var(--mc-cyan)', fontWeight: 700, minWidth: 38 }}>{g.fiscalYear || '—'}</span>
                            <span>{formatGuidanceValue(g)}</span>
                          </div>
                        ))}
                        {items.length > 8 && (
                          <div style={{ fontSize: 9, color: DIM, marginTop: 4 }}>+ {items.length - 8} more</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {report.forwardYear && (
                  <div style={{ marginTop: 8, fontSize: 10, color: DIM, fontStyle: 'italic' }}>
                    Used <b style={{ color: 'var(--mc-cyan)' }}>{report.forwardYear}</b> as the base forward year for the projection above.
                  </div>
                )}
              </div>
            );
          })()}

          {/* PATCH 0843 — Editorial-Quant gap explainer */}
          {(report.recommendation === 'AVOID' || report.recommendation === 'WAIT' || report.recommendation === 'WATCH') && (() => {
            const drivers: string[] = [];
            // Capacity ramp guidance present → revenue projection might be too conservative
            const capRamp = (report.guidance || []).filter((g: any) =>
              g.metric === 'CAPACITY_RAMP' || g.metric === 'CAPACITY_UNITS' || g.metric === 'PEAK_REVENUE'
            );
            if (capRamp.length > 0) {
              drivers.push(`Capacity ramp / peak-revenue guidance found in concall (${capRamp.length} mention${capRamp.length > 1 ? 's' : ''}) — forward revenue projection may be too conservative. Try overriding in /auto-valuation.`);
            }
            // Order book / inflow guidance present
            const orders = (report.guidance || []).filter((g: any) => g.metric === 'ORDER_BOOK' || g.metric === 'ORDER_INFLOW');
            if (orders.length > 0) {
              drivers.push(`Order book / intake mentioned (${orders.length}) — backlog conversion may justify higher forward revenue.`);
            }
            // OPM came from historical fallback, not guidance
            const opmFromGuidance = (report.guidance || []).some((g: any) => g.metric === 'EBITDA_MARGIN' || g.metric === 'OPM' || g.metric === 'PAT_MARGIN');
            if (!opmFromGuidance && report.excelData?.opmLatest && report.inferredMargin && Math.abs(report.excelData?.opmLatest - report.inferredMargin) > 2) {
              drivers.push(`OPM used (${report.inferredMargin.toFixed(1)}%) is the historical fallback, but latest quarter is ${report.excelData?.opmLatest.toFixed(1)}% — operating leverage in progress. Override in /auto-valuation.`);
            }
            // P/E multiple from sector lookup — read off inputs.targetPE (CalculatorResult.inputs is untyped)
            const peTarget = (report.peResult?.inputs as any)?.targetPE;
            if (typeof peTarget === 'number' && peTarget < 50 && (report.excelData?.currentPriceFromSheet || 0) > 0) {
              drivers.push(`Quant uses sector median P/E ${peTarget.toFixed(0)}× — if you believe re-rating (e.g. moving to AI-infra premium), set higher P/E in override.`);
            }
            if (drivers.length === 0) return null;
            return (
              <div style={{ padding: 10, background: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderLeft: '3px solid var(--mc-warn)', borderRadius: 5, marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-warn)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
                  ⚠ Editorial-Quant gap detected — why
                </div>
                <ul style={{ margin: '0 0 0 18px', padding: 0, fontSize: 11, color: TEXT, lineHeight: 1.55 }}>
                  {drivers.map((d, i) => <li key={i} style={{ marginBottom: 4 }}>{d}</li>)}
                </ul>
              </div>
            );
          })()}

          {/* PATCH 0689 — Year + Scenario toggles */}
          {(() => {
            const hasY2 = !!(report.peResultY2 || report.psResultY2 || report.evResultY2);
            const yearLabel = (yr: 'Y1' | 'Y2') => {
              if (yr === 'Y1') return report.forwardYear || 'FY27 · 18mo';
              return report.forwardYearY2 || 'FY28 · 30mo';
            };
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Year</span>
                {(['Y1', 'Y2'] as const).map((y) => {
                  const active = year === y;
                  const disabled = y === 'Y2' && !hasY2;
                  return (
                    <button
                      key={y}
                      disabled={disabled}
                      onClick={() => setYear(y)}
                      style={{
                        padding: '4px 10px', fontSize: 11, fontWeight: 700,
                        background: active ? 'var(--mc-cyan)' : 'transparent',
                        color: active ? 'var(--mc-bg-0)' : (disabled ? DIM : TEXT),
                        border: `1px solid ${active ? 'var(--mc-cyan)' : BORDER}`,
                        borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.4 : 1,
                      }}
                    >
                      {yearLabel(y)}
                    </button>
                  );
                })}
                <span style={{ marginLeft: 14, fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Scenario</span>
                {(['BEAR', 'BASE', 'BULL'] as const).map((s) => {
                  const active = scenario === s;
                  const c = s === 'BEAR' ? '#EF4444' : s === 'BASE' ? '#22D3EE' : '#10B981';
                  return (
                    <button
                      key={s}
                      onClick={() => setScenario(s)}
                      style={{
                        padding: '4px 10px', fontSize: 11, fontWeight: 700,
                        background: active ? c : 'transparent',
                        color: active ? 'var(--mc-bg-0)' : TEXT,
                        border: `1px solid ${active ? c : BORDER}`,
                        borderRadius: 4, cursor: 'pointer',
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Compact 3-card calc summary — driven by scenario+year toggle */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
            {([
              { label: 'P/E', y1: report.peResult, y2: report.peResultY2, conf: report.peConfidence },
              { label: 'P/S', y1: report.psResult, y2: report.psResultY2, conf: report.psConfidence },
              { label: 'EV/EBITDA', y1: report.evResult, y2: report.evResultY2, conf: report.evConfidence },
            ]).map((c, i) => {
              const result = year === 'Y2' ? (c.y2 || c.y1) : c.y1;
              const cas = result?.cases.find((cc: any) => cc.label === scenario);
              if (!cas) return (
                <div key={i} style={{ padding: 10, background: BG, border: `1px solid ${BORDER}`, borderRadius: 4, opacity: 0.5 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: DIM }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>insufficient data</div>
                </div>
              );
              const color = cas.upsidePct >= 25 ? '#10B981' : cas.upsidePct >= 0 ? '#22D3EE' : cas.upsidePct >= -25 ? '#F59E0B' : '#EF4444';
              return (
                <div key={i} style={{ padding: 10, background: BG, border: `1px solid ${color}50`, borderRadius: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)' }}>{c.label}</span>
                    {c.conf && <span style={{ fontSize: 9, color, fontWeight: 800 }}>{c.conf}</span>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                    ₹{Math.round(cas.marketCapCr).toLocaleString('en-IN')} Cr
                  </div>
                  <div style={{ fontSize: 11, color, fontWeight: 700 }}>{cas.upsidePct >= 0 ? '+' : ''}{cas.upsidePct.toFixed(0)}% upside</div>
                </div>
              );
            })}
          </div>

          {/* PATCH 0752 — Concall × Valuation blended score. When a concall
              snapshot exists for this ticker, blend its concallScore with the
              average upside% across P/E + P/S + EV/EBITDA (90% concall + 10%
              valuation). Display-only; doesn't change the editorial
              recommendation. Helps confirm/contradict the editorial call. */}
          {(() => {
            if (!report.ticker) return null;
            const snaps = (typeof window === 'undefined') ? [] : listConcallSnapshots();
            const snap = snaps.find(s => s.ticker.toUpperCase() === (report.ticker || '').toUpperCase());
            if (!snap || typeof snap.concallScore !== 'number') return null;
            // Average upside across the 3 calculators for the active year + scenario
            const yr = year;
            const results = [report.peResult, report.psResult, report.evResult];
            const resultsY2 = [report.peResultY2, report.psResultY2, report.evResultY2];
            const active = yr === 'Y2' ? resultsY2.map((r, i) => r || results[i]) : results;
            const upsides = active.flatMap(r => {
              const c = r?.cases?.find((cc: any) => cc.label === scenario);
              return (c && Number.isFinite(c.upsidePct)) ? [c.upsidePct] : [];
            });
            if (upsides.length === 0) return null;
            const avgUpside = upsides.reduce((a, b) => a + b, 0) / upsides.length;
            const blended = blendConcallWithValuation({
              concallScore: snap.concallScore,
              valuationUpsidePct: avgUpside,
            });
            const blendColor = blended.valuationContribution > 0 ? '#10B981' : blended.valuationContribution < 0 ? '#EF4444' : '#94A3B8';
            return (
              <div style={{
                marginTop: 12, padding: '10px 12px', background: 'var(--mc-bg-0)',
                border: `1px solid ${blendColor}40`, borderLeft: `3px solid ${blendColor}`,
                borderRadius: 5, fontSize: 11, color: TEXT, lineHeight: 1.6,
              }}>
                <span style={{ fontSize: 9, color: DIM, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Concall × Valuation blended ·
                </span>
                <span style={{ fontSize: 14, color: TEXT, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginLeft: 6 }}>
                  {blended.blendedScore}
                </span>
                <span style={{ fontSize: 10, color: DIM, marginLeft: 8 }}>
                  ({snap.concallScore} concall · 90% + {blended.valuationScore} valuation · 10%)
                </span>
                <span style={{ fontSize: 10, color: blendColor, fontWeight: 800, marginLeft: 8 }}>
                  {blended.valuationContribution >= 0 ? '+' : ''}{blended.valuationContribution} from valuation
                </span>
                <div style={{ fontSize: 10, color: DIM, fontStyle: 'italic', marginTop: 4 }}>
                  Average upside this scenario: {avgUpside >= 0 ? '+' : ''}{avgUpside.toFixed(0)}% across P/E + P/S + EV/EBITDA
                </div>
              </div>
            );
          })()}

          <div style={{ marginTop: 10, fontSize: 10, color: DIM, fontStyle: 'italic', textAlign: 'center' }}>
            For full breakdown (bear/base/bull · FY27/FY28 toggle · override panel · save-bench) → <a href="/auto-valuation" style={{ color: 'var(--mc-cyan)', textDecoration: 'none', borderBottom: '1px dotted var(--mc-cyan)' }}>open Auto-Val full page</a>
          </div>
        </div>
      )}
    </div>
  );
}
