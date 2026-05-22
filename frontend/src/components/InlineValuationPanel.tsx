'use client';

// ═══════════════════════════════════════════════════════════════════════════
// INLINE VALUATION PANEL (PATCH 0681)
//
// Lives at the bottom of the Concall AI tab (earnings-analysis/page.tsx) so
// the user can drop their Excel + concall PDFs once and see BOTH the concall
// analysis AND the P/E + P/S + EV/EBITDA valuation report on the same page.
//
// Uses the same buildReport pipeline exported from auto-valuation/page.tsx —
// no logic duplication. Self-contained upload state (independent of the
// concall analysis flow above it) so users can mix-and-match.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import {
  buildReport, extractPdfText, extractExcelFinancials,
  type ParsedDoc, type AutoValuationReport,
} from '@/app/(dashboard)/auto-valuation/page';
import { extractGuidance } from '@/lib/forward-guidance-extractor';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

const recColor = (r: string) => r === 'BUY' ? '#10B981' : r === 'WATCH' ? '#22D3EE' : r === 'WAIT' ? '#F59E0B' : r === 'AVOID' ? '#EF4444' : DIM;

export default function InlineValuationPanel() {
  const [docs, setDocs] = useState<ParsedDoc[]>([]);
  const [report, setReport] = useState<AutoValuationReport | null>(null);
  const [building, setBuilding] = useState(false);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newDocs: ParsedDoc[] = Array.from(files).map(f => ({
      name: f.name,
      size: f.size,
      type: /\.xlsx?$/i.test(f.name) ? 'excel' : /\.pdf$/i.test(f.name) ? 'pdf' : 'unknown',
      status: 'parsing',
    }));
    let startIdx = 0;
    setDocs(prev => { startIdx = prev.length; return [...prev, ...newDocs]; });

    const fileList = Array.from(files);
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
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

  useEffect(() => {
    if (docs.length === 0) { setReport(null); return; }
    const allDone = docs.every(d => d.status !== 'parsing');
    if (!allDone) return;
    setBuilding(true);
    buildReport(docs).then(r => { setReport(r); setBuilding(false); });
  }, [docs]);

  return (
    <div style={{ marginTop: 32, padding: '20px 22px', background: '#0d1623', border: `1px solid ${BORDER}`, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#22D3EE' }}>
          🤖 Auto-Valuation Report
        </h2>
        <a href="/auto-valuation" style={{ fontSize: 10, color: DIM, textDecoration: 'none' }}>full page →</a>
      </div>
      <div style={{ fontSize: 12, color: DIM, marginBottom: 14, lineHeight: 1.55 }}>
        Drop the same Excel + concall PDFs here to also see P/E + P/S + EV/EBITDA fair-value report.
        Independent of the concall analysis above — both run on the same documents.
      </div>

      {/* Upload zone */}
      <label htmlFor="inline-val-files" style={{
        display: 'block', padding: '18px 16px', textAlign: 'center', cursor: 'pointer',
        background: '#0A1422', border: `2px dashed ${BORDER}`, borderRadius: 8,
        fontSize: 13, color: TEXT, marginBottom: 14,
      }}>
        <input id="inline-val-files" type="file" multiple accept=".xlsx,.xls,.pdf"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
          style={{ display: 'none' }} />
        <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>Drop Excel + PDFs for instant valuation</div>
        <div style={{ fontSize: 11, color: DIM }}>multi-file · .xlsx + .pdf · runs alongside concall analysis</div>
      </label>

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
          {/* Recommendation header */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: recColor(report.recommendation) }}>{report.recommendation}</span>
            {report.company && <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{report.company}</span>}
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
