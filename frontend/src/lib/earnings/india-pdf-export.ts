// ─────────────────────────────────────────────────────────────────────────
// India Institutional Report -> PDF export
//
// Multi-section institutional report:
//   1. Header - company / ticker / period / market cap / theme
//   2. Top-line verdict + FORWARD pill + watch points
//   3. Latest Quarter table (revenue / OP / OPM / PAT / Margin / EPS)
//   4. Fundamental Health composite + 5-6 component bars
//   5. Promoter Trust Score breakdown
//   6. Quarterly Trend (8Q with QoQ / YoY)
//   7. Concall Insights (top quotes + tone + topical mentions) when present
//   8. Working Capital cycle
//   9. Promoter / FII / DII shifts
//   10. Sector KPIs
//   11. India Macro Themes
//   12. TTM ratios
//   13. Footer with provenance + generation timestamp
//
// Uses jsPDF + autotable (already in deps). All async to keep bundle lazy.
// ─────────────────────────────────────────────────────────────────────────

import type { EarningsSnapshot, IndiaExtras } from './snapshot';

export async function exportIndiaReportPdf(snapshot: EarningsSnapshot): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const ix: IndiaExtras | undefined = snapshot.indiaExtras;
  if (!ix) {
    throw new Error('PDF export requires India institutional snapshot data');
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 12;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;

  // jsPDF's default helvetica doesn't carry Unicode glyphs (₹, Δ, ○, ●,
  // smart quotes etc render as garbage). All currency / direction symbols
  // throughout this file are already plain-ASCII (Rs, [X], [ ], +, -, %).
  // Single helvetica face used everywhere — autotable headStyles match.
  doc.setFont('helvetica', 'normal');

  // Color tokens - institutional saffron / amber / teal
  const SAFFRON = [251, 146, 60] as [number, number, number];
  const AMBER = [251, 191, 36] as [number, number, number];
  const TEAL = [13, 148, 136] as [number, number, number];
  const GREEN = [22, 163, 74] as [number, number, number];
  const RED = [220, 38, 38] as [number, number, number];
  const SLATE = [30, 41, 59] as [number, number, number];
  const SLATE2 = [71, 85, 105] as [number, number, number];
  const MUTED = [148, 163, 184] as [number, number, number];

  let y = margin;

  // ── 1. Header ──
  doc.setFillColor(...SLATE);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setFillColor(...SAFFRON);
  doc.rect(0, 28, pageW, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(snapshot.company || snapshot.ticker, margin, 12);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...AMBER);
  doc.text(`${snapshot.ticker}  |  ${snapshot.quarter}  |  ${snapshot.filingType}`, margin, 18);
  doc.setTextColor(255, 255, 255);
  doc.text(`${ix.sector.displayName}${ix.sector.industryString ? ' | ' + ix.sector.industryString : ''}`, margin, 23);

  // Right side: market cap + CMP + P/E
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('Market Cap', pageW - margin, 9, { align: 'right' });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(
    ix.topMetrics.marketCapCr != null
      ? `Rs ${(ix.topMetrics.marketCapCr / 1000).toFixed(1)}K Cr`
      : '-',
    pageW - margin, 14, { align: 'right' },
  );
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  doc.text(
    `CMP Rs ${ix.topMetrics.cmp?.toFixed(0) ?? '-'}  |  P/E ${ix.topMetrics.peRatio?.toFixed(1) ?? '-'}x`,
    pageW - margin, 22, { align: 'right' },
  );

  y = 34;

  // ── 2. Top-line verdict ──
  if (ix.topLine) {
    const v = ix.topLine.verdict;
    const verdictColor: [number, number, number] =
      v === 'BUY' || v === 'ACCUMULATE' ? GREEN
      : v === 'HOLD' ? AMBER
      : v === 'NEUTRAL' ? SLATE2
      : v === 'AVOID' ? [251, 146, 60]
      : RED;
    doc.setFillColor(...verdictColor);
    doc.rect(margin, y, 30, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(v, margin + 15, y + 6, { align: 'center' });

    if (ix.topLine.forwardLook) {
      const fwd = ix.topLine.forwardLook;
      const fwdColor: [number, number, number] =
        fwd.grade === 'very_positive' ? GREEN
        : fwd.grade === 'positive' ? [134, 239, 172]
        : fwd.grade === 'mixed' ? AMBER
        : fwd.grade === 'cautious' ? [251, 146, 60]
        : RED;
      doc.setFillColor(...fwdColor);
      doc.rect(margin + 32, y, 36, 9, 'F');
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.text(`FORWARD: ${fwd.label}`, margin + 50, y + 6, { align: 'center' });
    }

    doc.setTextColor(...SLATE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const headlineX = margin + (ix.topLine.forwardLook ? 72 : 34);
    doc.text(ix.topLine.headline, headlineX, y + 6, { maxWidth: pageW - headlineX - margin });
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE2);
    doc.text(ix.topLine.rationale, margin, y, { maxWidth: contentW });
    y += 5;
    if (ix.topLine.watchPoints.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...AMBER);
      doc.text('Watch:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...SLATE);
      doc.text(ix.topLine.watchPoints.join(' | '), margin + 12, y);
    }
    y += 8;
  }

  // ── 3. Latest Quarter table ──
  const last = ix.quarterlyTrend.at(-1);
  if (last) {
    const fmtCr = (v: number | null | undefined) =>
      v == null ? '-' : v >= 1000 ? `Rs ${(v / 1000).toFixed(1)}K Cr` : `Rs ${v.toFixed(0)} Cr`;
    const fmtPct = (v: number | null | undefined) =>
      v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
    const fmtBps = (v: number | null | undefined) =>
      v == null ? '-' : `${v >= 0 ? '+' : ''}${Math.round(v)} bps`;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Latest Quarter - ' + last.period, 'Latest', 'QoQ %', 'YoY %']],
      body: [
        ['Revenue', fmtCr(last.revenue), fmtPct(last.qoqRevenuePct), fmtPct(last.yoyRevenuePct)],
        ['Operating Profit', fmtCr(last.operatingProfit), fmtPct(last.qoqOpProfitPct), fmtPct(last.yoyOpProfitPct)],
        ['OPM', last.opmPct != null ? `${last.opmPct.toFixed(1)}%` : '-', fmtBps(last.qoqOpmBps), fmtBps(last.yoyOpmBps)],
        ['Net Profit (PAT)', fmtCr(last.netProfit), fmtPct(last.qoqProfitPct), fmtPct(last.yoyProfitPct)],
        ['Net Margin', last.netMarginPct != null ? `${last.netMarginPct.toFixed(1)}%` : '-', fmtBps(last.qoqNetMarginBps), fmtBps(last.yoyNetMarginBps)],
        ['EPS', last.eps != null ? `Rs ${last.eps.toFixed(2)}` : '-', fmtPct(last.qoqEpsPct), fmtPct(last.yoyEpsPct)],
      ],
      styles: { font: 'helvetica' }, theme: 'striped',
      headStyles: { fillColor: SLATE, textColor: 255, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9, textColor: SLATE },
      columnStyles: { 0: { cellWidth: 60 }, 1: { halign: 'right', cellWidth: 35, fontStyle: 'bold' }, 2: { halign: 'right', cellWidth: 30 }, 3: { halign: 'right', cellWidth: 30 } },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ── 4. Fundamental Health + components ──
  const fs = ix.fundamentalScore;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [[`Fundamental Health  ${fs.overall}/100  |  Grade ${fs.grade}  |  ${fs.direction.toUpperCase()}`, 'Score', 'Label']],
    body: [
      ['Revenue Growth', `${fs.components.growth.score}/100`, fs.components.growth.label],
      ['Margin Trajectory', `${fs.components.margin.score}/100`, fs.components.margin.label],
      ['Working Capital', `${fs.components.working_capital.score}/100`, fs.components.working_capital.label],
      ['Promoter Signal', `${fs.components.promoter.score}/100`, fs.components.promoter.label],
      ['Cash Conversion', `${fs.components.cash_conversion.score}/100`, fs.components.cash_conversion.label],
      ...(fs.components.forward
        ? [['Forward Outlook', `${fs.components.forward.score}/100`, fs.components.forward.label]]
        : []),
    ],
    styles: { font: 'helvetica' }, theme: 'striped',
    headStyles: { fillColor: AMBER, textColor: 30, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9, textColor: SLATE },
    columnStyles: { 0: { cellWidth: 70 }, 1: { halign: 'center', cellWidth: 30, fontStyle: 'bold' }, 2: { cellWidth: 60 } },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ── 5. Promoter Trust Score ──
  if (ix.governance.trustScore) {
    const t = ix.governance.trustScore;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [[`Promoter Trust  ${t.score}/100  |  Grade ${t.grade}  -  ${t.verdict}`, 'Score', 'Reason']],
      body: [
        ['Stability', `${t.breakdown.stability.score}`, t.breakdown.stability.reason],
        ['Pledge', `${t.breakdown.pledge.score}`, t.breakdown.pledge.reason],
        ['Consistency', `${t.breakdown.consistency.score}`, t.breakdown.consistency.reason],
        ['Institutional', `${t.breakdown.institutional.score}`, t.breakdown.institutional.reason],
      ],
      styles: { font: 'helvetica' }, theme: 'striped',
      headStyles: { fillColor: SAFFRON, textColor: 255, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8.5, textColor: SLATE },
      columnStyles: { 0: { cellWidth: 30 }, 1: { halign: 'center', cellWidth: 18, fontStyle: 'bold' }, 2: { cellWidth: contentW - 48 } },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ── 6. Quarterly Trend (8Q) ──
  if (ix.quarterlyTrend.length > 0) {
    if (y > pageH - 60) { doc.addPage(); y = margin; }
    const fmtPct = (v: number | null | undefined) =>
      v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Quarterly Trend', 'Revenue', 'YoY%', 'Op Profit', 'OP YoY%', 'OPM%', 'PAT', 'YoY%', 'EPS', 'YoY%']],
      body: ix.quarterlyTrend.map((q) => [
        q.period,
        q.revenue != null ? `Rs ${q.revenue.toFixed(0)} Cr` : '-',
        fmtPct(q.yoyRevenuePct),
        q.operatingProfit != null ? `Rs ${q.operatingProfit.toFixed(0)} Cr` : '-',
        fmtPct(q.yoyOpProfitPct),
        q.opmPct != null ? `${q.opmPct.toFixed(0)}%` : '-',
        q.netProfit != null ? `Rs ${q.netProfit.toFixed(0)} Cr` : '-',
        fmtPct(q.yoyProfitPct),
        q.eps != null ? `Rs ${q.eps.toFixed(1)}` : '-',
        fmtPct(q.yoyEpsPct),
      ]),
      styles: { font: 'helvetica' }, theme: 'striped',
      headStyles: { fillColor: TEAL, textColor: 255, fontSize: 7.5, fontStyle: 'bold', halign: 'center' },
      bodyStyles: { fontSize: 7.5, textColor: SLATE, halign: 'right' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ── 7. Concall Insights ──
  if (ix.concall && ix.concall.charsAnalyzed > 0) {
    if (y > pageH - 80) { doc.addPage(); y = margin; }
    const c = ix.concall;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [[`Concall Score  ${c.concallScore}/100  |  Grade ${c.concallGrade}  |  +${c.positiveCount} pos / ~${c.cautiousCount} cautious / −${c.negativeCount} neg`, '']],
      body: [],
      styles: { font: 'helvetica' }, theme: 'plain',
      headStyles: { fillColor: SLATE, textColor: 255, fontSize: 10, fontStyle: 'bold' },
    });
    y = (doc as any).lastAutoTable.finalY + 2;

    if (c.topQuotes.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Top Quotes (signal-density ranked)']],
        body: c.topQuotes.map((q, i) => [`${i + 1}. ${q}`]),
        styles: { font: 'helvetica' }, theme: 'plain',
        headStyles: { fillColor: AMBER, textColor: 30, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, textColor: SLATE, fontStyle: 'italic' },
      });
      y = (doc as any).lastAutoTable.finalY + 2;
    }

    if (c.toneSignals.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Tone', 'Phrase']],
        body: c.toneSignals.map((s) => [s.sentiment.toUpperCase(), s.phrase]),
        styles: { font: 'helvetica' }, theme: 'striped',
        headStyles: { fillColor: SLATE2, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: SLATE },
        columnStyles: { 0: { cellWidth: 30, halign: 'center', fontStyle: 'bold' } },
      });
      y = (doc as any).lastAutoTable.finalY + 2;
    }

    if (c.keyMentions.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Topic', 'Quote']],
        body: c.keyMentions.map((m) => [m.topic.replace(/_/g, ' '), m.quote]),
        styles: { font: 'helvetica' }, theme: 'striped',
        headStyles: { fillColor: SLATE2, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: SLATE, fontStyle: 'italic' },
        columnStyles: { 0: { cellWidth: 35, halign: 'left', fontStyle: 'bold' }, 1: { cellWidth: contentW - 35 } },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
    }
  }

  // ── 8. Working Capital + 9. Holdings + 10. Sector KPIs ──
  if (y > pageH - 50) { doc.addPage(); y = margin; }
  const wc = ix.workingCapital;
  const gov = ix.governance;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Working Capital', 'Value', 'Holdings', 'Pct', 'QoQ %']],
    body: [
      [
        'Debtor Days', wc.debtorDays != null ? `${wc.debtorDays.toFixed(0)} d` : '-',
        'Promoter', gov.promoterHoldingPct != null ? `${gov.promoterHoldingPct.toFixed(2)}%` : '-',
        gov.promoterChangeQoQ != null ? `${gov.promoterChangeQoQ >= 0 ? '+' : ''}${gov.promoterChangeQoQ.toFixed(2)} pp` : '-',
      ],
      [
        'Inventory Days', wc.inventoryDays != null ? `${wc.inventoryDays.toFixed(0)} d` : '-',
        'FII', gov.fiiHoldingPct != null ? `${gov.fiiHoldingPct.toFixed(2)}%` : '-',
        gov.fiiChangeQoQ != null ? `${gov.fiiChangeQoQ >= 0 ? '+' : ''}${gov.fiiChangeQoQ.toFixed(2)} pp` : '-',
      ],
      [
        'Days Payable', wc.daysPayable != null ? `${wc.daysPayable.toFixed(0)} d` : '-',
        'DII', gov.diiHoldingPct != null ? `${gov.diiHoldingPct.toFixed(2)}%` : '-',
        gov.diiChangeQoQ != null ? `${gov.diiChangeQoQ >= 0 ? '+' : ''}${gov.diiChangeQoQ.toFixed(2)} pp` : '-',
      ],
      [
        'Cash Conv. Cycle', wc.cashConversionCycle != null ? `${wc.cashConversionCycle.toFixed(0)} d` : '-',
        'CFO/PAT', wc.cfoOverPat != null ? `${wc.cfoOverPat.toFixed(2)}x` : '-',
        '',
      ],
    ],
    styles: { font: 'helvetica' }, theme: 'striped',
    headStyles: { fillColor: SLATE, textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: SLATE },
    columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold' }, 1: { cellWidth: 30, halign: 'right' }, 2: { cellWidth: 28, fontStyle: 'bold' }, 3: { cellWidth: 28, halign: 'right' }, 4: { cellWidth: 30, halign: 'right' } },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // Sector KPIs
  if (y > pageH - 50) { doc.addPage(); y = margin; }
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [[`${ix.sector.displayName} - Sector KPIs`, 'Importance', 'Status']],
    body: ix.sector.kpis.map((k) => [
      k.label,
      k.importance.toUpperCase(),
      k.tracked ? `[X] ${k.value || 'tracked'}` : '[ ] not extracted',
    ]),
    styles: { font: 'helvetica' }, theme: 'striped',
    headStyles: { fillColor: SAFFRON, textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: SLATE },
    columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 30, halign: 'center' }, 2: { cellWidth: 70 } },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ── 11. Themes + 12. TTM Ratios ──
  if (y > pageH - 30) { doc.addPage(); y = margin; }
  if (snapshot.qualitative.themes.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['India Macro Themes', 'Strength', 'Evidence']],
      body: snapshot.qualitative.themes.map((t) => [
        t.theme,
        t.strength.toUpperCase(),
        (t.evidence || []).join(' | '),
      ]),
      styles: { font: 'helvetica' }, theme: 'striped',
      headStyles: { fillColor: TEAL, textColor: 255, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8.5, textColor: SLATE },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // TTM Ratios
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['TTM Ratios (Screener)', 'ROCE', 'ROE', 'P/E', 'Book Value', 'D/E']],
    body: [[
      '',
      ix.topMetrics.roce != null ? `${ix.topMetrics.roce.toFixed(1)}%` : '-',
      ix.topMetrics.roe != null ? `${ix.topMetrics.roe.toFixed(1)}%` : '-',
      ix.topMetrics.peRatio != null ? `${ix.topMetrics.peRatio.toFixed(1)}x` : '-',
      ix.topMetrics.bookValue != null ? `Rs ${ix.topMetrics.bookValue.toFixed(0)}` : '-',
      ix.topMetrics.debtToEquity != null ? `${ix.topMetrics.debtToEquity.toFixed(2)}x` : '-',
    ]],
    styles: { font: 'helvetica' }, theme: 'striped',
    headStyles: { fillColor: SLATE, textColor: 255, fontSize: 9, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { fontSize: 9, textColor: SLATE, halign: 'center', fontStyle: 'bold' },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── 13. Footer with provenance - every page ──
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...MUTED);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 14, pageW - margin, pageH - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      `Source: ${snapshot.sources.financials} | ${snapshot.sources.history}  |  Generated ${new Date(snapshot.generatedAt).toLocaleString()}`,
      margin, pageH - 10,
    );
    doc.text(`Page ${i} / ${pageCount}`, pageW - margin, pageH - 10, { align: 'right' });
    doc.setTextColor(...SAFFRON);
    doc.setFont('helvetica', 'bold');
    doc.text('MARKET COCKPIT  |  India Institutional Mode', margin, pageH - 5);
  }

  const filename = `${snapshot.ticker}_${snapshot.quarter.replace(/\s+/g, '_')}_institutional.pdf`;
  doc.save(filename);
}
