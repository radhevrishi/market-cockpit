// PATCH 0755 — Multibagger CSV parser helpers extracted from page.tsx.
// Pure utilities, no React dependency. Part of the slow refactor of the
// 7,140-line multibagger/page.tsx into focused sibling modules. Extracted
// here:
//   • parseCsvFlexible — CSV → Record<string,string>[]
//   • detectCsvMarket — header-sniffing to classify TradingView (US) vs
//     Screener.in (India) CSVs
//
// Not extracted (yet, deliberately):
//   • buildColMap — 215-line India column dictionary; heavily intertwined
//     with the Excel pipeline. Risk-vs-benefit too high in this pass.
//   • rawRowToExcelRow / parseUSARow — depend on local row types in page.tsx
//
// Future passes can add more helpers here as they're confirmed safe.

/**
 * Parse a CSV string into an array of records. Quote-aware (handles
 * embedded commas in quoted cells). UTF-8 BOM-tolerant (strips leading
 * `﻿`). Returns empty array when fewer than 2 lines.
 */
export function parseCsvFlexible(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}

/**
 * Classify an uploaded CSV as USA (TradingView) or India (Screener.in)
 * based on which header tokens are present. Returns 'UNKNOWN' when neither
 * signal set dominates. Used to confirm the user dropped the right file on
 * the right tab and to suggest a tab switch when wrong.
 */
export function detectCsvMarket(headers: string[]): 'IN' | 'US' | 'UNKNOWN' {
  const h = headers.map(x => x.toLowerCase());
  // USA-specific TradingView column names
  const usaSignals = ['forward non-gaap', 'piotroski f-score', 'altman z-score', 'free cash flow margin', 'analyst rating'];
  // India-specific Screener.in column names
  const indiaSignals = ['promoter holding', 'promoter %', 'sales growth', 'roce', 'pledged', 'change in promoter'];
  const usaHits = usaSignals.filter(s => h.some(x => x.includes(s))).length;
  const indiaHits = indiaSignals.filter(s => h.some(x => x.includes(s))).length;
  if (usaHits >= 2 && usaHits > indiaHits) return 'US';
  if (indiaHits >= 2 && indiaHits > usaHits) return 'IN';
  return 'UNKNOWN';
}
