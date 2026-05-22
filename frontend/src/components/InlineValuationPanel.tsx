'use client';

// ═══════════════════════════════════════════════════════════════════════════
// INLINE VALUATION PANEL (PATCH 0682)
//
// Mounted at the bottom of the Concall AI page (earnings-analysis/page.tsx).
// Self-contained multi-file upload + runs the SAME buildReport pipeline from
// auto-valuation/engine.ts (extracted to a sibling module so Next.js page-
// export rules don't block the import). One page, both analyses.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import {
  buildReport, extractPdfText, extractExcelFinancials,
  type ParsedDoc, type AutoValuationReport,
} from '@/app/(dashboard)/auto-valuation/engine';
import { extractGuidance } from '@/lib/forward-guidance-extractor';

const BG = '#0A0E1A';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

const recColor = (r: string) => r === 'BUY' ? '#10B981' : r === 'WATCH' ? '#22D3EE' : r === 'WAIT' ? '#F59E0B' : r === 'AVOID' ? '#EF4444' : DIM;

export default function InlineValuationPanel() {
  const [docs, setDocs] = useState<ParsedDoc[]>([]);
  const [report, setReport] = useState<AutoValuationReport | null>(null);
  const [building, setBuilding] = useState(false);

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
    buildReport(docs).then(r => { setReport(r); setBuilding(false); }).catch(() => setBuilding(false));
  }, [docs]);

  // PATCH 0687 — once any file has flowed in (either via own dropzone or via
  // the Concall AI event bridge) we suppress the standalone upload box so the
  // section reads as one continuous institutional cross-check, not "yet
  // another upload". The dropzone returns when the user clicks NEW ANALYSIS.
  const hasFiles = docs.length > 0;

  return (
    <div style={{ marginTop: 32, padding: '20px 22px', background: '#0d1623', border: `1px solid ${BORDER}`, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#22D3EE', letterSpacing: 0.5, textTransform: 'uppercase' }}>
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
          background: '#0A1422', border: `2px dashed ${BORDER}`, borderRadius: 8,
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
              <span style={{ fontWeight: 700, color: d.type === 'excel' ? '#10B981' : '#22D3EE', minWidth: 40 }}>{d.type === 'excel' ? 'XLSX' : 'PDF'}</span>
              <span style={{ color: TEXT, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
              <span style={{ color: DIM, fontSize: 10 }}>{Math.round(d.size / 1024)} KB</span>
              <span style={{ color: d.status === 'done' ? '#10B981' : d.status === 'error' ? '#EF4444' : '#F59E0B' }}>
                {d.status === 'done' ? '✓' : d.status === 'error' ? '✗' : '⏳'}
              </span>
              <span style={{ color: DIM, fontSize: 10, fontStyle: 'italic' }}>{d.message || ''}</span>
            </div>
          ))}
        </div>
      )}

      {building && <div style={{ fontSize: 12, color: '#F59E0B', textAlign: 'center', padding: 10 }}>⏳ Building valuation report…</div>}

      {/* Report */}
      {report && (
        <div style={{ background: '#0A1422', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
          {/* Quant verdict — explicitly framed as 'quant says X' so the reader
              compares it against the editorial recommendation banner above. */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>
              Quant verdict
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, color: recColor(report.recommendation) }}>{report.recommendation}</span>
            {report.company && <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{report.company}</span>}
            {report.sector && <span style={{ fontSize: 10, color: '#22D3EE', background: '#22D3EE15', padding: '2px 8px', borderRadius: 3 }}>{report.sector}</span>}
          </div>

          {/* Rationale */}
          <ul style={{ margin: '0 0 12px 18px', padding: 0, fontSize: 11.5, color: TEXT, lineHeight: 1.6 }}>
            {report.rationale.slice(0, 5).map((r, i) => <li key={i}>{r}</li>)}
          </ul>

          {/* Compact 3-card calc summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
            {([
              { label: 'P/E', result: report.peResult, conf: report.peConfidence },
              { label: 'P/S', result: report.psResult, conf: report.psConfidence },
              { label: 'EV/EBITDA', result: report.evResult, conf: report.evConfidence },
            ]).map((c, i) => {
              const base = c.result?.cases.find((cc: any) => cc.label === 'BASE');
              if (!base) return (
                <div key={i} style={{ padding: 10, background: BG, border: `1px solid ${BORDER}`, borderRadius: 4, opacity: 0.5 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: DIM }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>insufficient data</div>
                </div>
              );
              const color = base.upsidePct >= 25 ? '#10B981' : base.upsidePct >= 0 ? '#22D3EE' : base.upsidePct >= -25 ? '#F59E0B' : '#EF4444';
              return (
                <div key={i} style={{ padding: 10, background: BG, border: `1px solid ${color}50`, borderRadius: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#22D3EE' }}>{c.label}</span>
                    {c.conf && <span style={{ fontSize: 9, color, fontWeight: 800 }}>{c.conf}</span>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                    ₹{Math.round(base.marketCapCr).toLocaleString('en-IN')} Cr
                  </div>
                  <div style={{ fontSize: 11, color, fontWeight: 700 }}>{base.upsidePct >= 0 ? '+' : ''}{base.upsidePct.toFixed(0)}% upside</div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 10, fontSize: 10, color: DIM, fontStyle: 'italic', textAlign: 'center' }}>
            For full breakdown (bear/base/bull · FY27/FY28 toggle · override panel · save-bench) → <a href="/auto-valuation" style={{ color: '#22D3EE', textDecoration: 'none', borderBottom: '1px dotted #22D3EE' }}>open Auto-Val full page</a>
          </div>
        </div>
      )}
    </div>
  );
}
