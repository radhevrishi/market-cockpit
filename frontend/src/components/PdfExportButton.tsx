'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PDF EXPORT BUTTON — patch 0074
//
// Universal "Export to PDF" button. Lives in the dashboard header so it
// appears on every tab. On click, snapshots the main content area using
// html2canvas, then assembles a PDF via jsPDF (already installed for
// the multibagger / earnings exports).
//
// Uses the page's <h1> or document.title as filename and the current
// route as a header on every PDF page.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { FileDown } from 'lucide-react';

export function PdfExportButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    try {
      // Pick the main content scroll container; fall back to body
      const target =
        (document.querySelector('main[data-pdf-target]') as HTMLElement) ||
        (document.querySelector('main') as HTMLElement) ||
        document.body;

      // Page title for the PDF
      const titleEl = target.querySelector('h1');
      const title = (titleEl?.textContent || document.title || 'Market Cockpit').trim();
      const route = (typeof window !== 'undefined' ? window.location.pathname : '/') || '/';
      const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const filename = `MarketCockpit-${title.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}-${new Date().toISOString().slice(0,10)}.pdf`;

      // Dynamic import to avoid SSR issues + keep bundle slim
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      // Capture at 2x scale for crisp text. backgroundColor=null preserves
      // dark theme bg.
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#0A0E1A',
        logging: false,
        windowWidth: target.scrollWidth,
        windowHeight: target.scrollHeight,
      });

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const headerHeight = 28;
      const usableWidth = pageWidth - margin * 2;
      const usableHeight = pageHeight - margin * 2 - headerHeight;

      const imgWidth = usableWidth;
      const imgHeight = (canvas.height / canvas.width) * imgWidth;

      // Slice the long canvas into A4-sized pages
      const totalPages = Math.ceil(imgHeight / usableHeight);
      const sliceHeightPx = (canvas.width / imgWidth) * usableHeight;

      for (let p = 0; p < totalPages; p++) {
        if (p > 0) pdf.addPage();
        // Per-page header
        pdf.setFillColor(13, 22, 35);
        pdf.rect(0, 0, pageWidth, headerHeight, 'F');
        pdf.setTextColor(247, 250, 252);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.text(`MARKET COCKPIT · ${title}`, margin, 18);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`${route} · ${dateStr} · page ${p + 1}/${totalPages}`, pageWidth - margin, 18, { align: 'right' });

        // Slice the canvas for this page
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.min(sliceHeightPx, canvas.height - p * sliceHeightPx);
        const ctx = sliceCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0A0E1A';
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(
            canvas,
            0, p * sliceHeightPx,
            canvas.width, sliceCanvas.height,
            0, 0,
            canvas.width, sliceCanvas.height
          );
        }
        const sliceDataUrl = sliceCanvas.toDataURL('image/jpeg', 0.92);
        const slicePdfHeight = (sliceCanvas.height / canvas.width) * imgWidth;
        pdf.addImage(sliceDataUrl, 'JPEG', margin, margin + headerHeight, imgWidth, slicePdfHeight, undefined, 'FAST');
      }

      pdf.save(filename);
    } catch (e) {
      // Best-effort. If html2canvas fails (e.g. CORS image), fall back to
      // browser print dialog which lets users save as PDF.
      console.error('[PdfExport] capture failed; falling back to print()', e);
      try { window.print(); } catch { /* no-op */ }
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <button
        onClick={handleExport}
        disabled={busy}
        title="Export this page as PDF"
        style={{
          width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
          padding: '10px 4px', background: 'none', border: 'none',
          color: busy ? 'var(--mc-text-4)' : 'var(--mc-text-4)', cursor: busy ? 'wait' : 'pointer', fontSize: '9px',
        }}
      >
        <FileDown className="w-4 h-4" />
        <span>{busy ? 'PDF…' : 'PDF'}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleExport}
      disabled={busy}
      title="Export this page as PDF"
      // PATCH 1086 — UX-05: prevent "Exporting…" / "PDF" label from truncating to "Exp..." in narrow header flex
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        background: 'none', border: '1px solid var(--mc-bg-4)', borderRadius: '10px',
        padding: '6px 10px', cursor: busy ? 'wait' : 'pointer',
        color: busy ? 'var(--mc-text-4)' : 'var(--mc-text-2)',
        minHeight: '36px',
        fontSize: '12px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        minWidth: 'auto',
        flexShrink: 0,
      }}
    >
      <FileDown className="w-4 h-4" />
      {busy ? 'Exporting…' : 'PDF'}
    </button>
  );
}
