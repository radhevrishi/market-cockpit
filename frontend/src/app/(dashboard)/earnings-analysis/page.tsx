'use client';

import React, { useState, useRef, useCallback } from 'react';

// ── Design tokens
const BG      = '#0a0a0f';
const CARD    = '#13131a';
const CARD2   = '#191926';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#e2e8f0';
const MUTED   = '#64748b';
const ACCENT  = '#38bdf8';
const GREEN   = '#10b981';
const RED     = '#ef4444';
const ORANGE  = '#f97316';
const YELLOW  = '#f59e0b';
const PURPLE  = '#a78bfa';
const F       = { xs:11, sm:13, md:15, lg:17, h2:20, h3:17 };
const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0));

/** Load a script from CDN with a hard timeout so we never hang forever */
async function loadScriptWithTimeout(src: string, timeoutMs = 8000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Script load timed out after ${timeoutMs / 1000}s: ${src}`)), timeoutMs);
    // Check if already loaded (idempotent)
    if (document.querySelector(`script[src="${src}"]`) && (window as any).pdfjsLib) {
      clearTimeout(timer); resolve(); return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload  = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('Failed to load PDF.js from CDN. Check your internet connection.')); };
    document.head.appendChild(script);
  });
}

/** Extract text from a PDF file using PDF.js (loaded from CDN).
 *  Key improvements over v1:
 *  - Hard 8s timeout on CDN script loading (never hangs forever)
 *  - Hard 30s overall extraction timeout
 *  - Yields to UI every 5 pages so browser stays responsive
 *  - Smart page selection: reads cover + financial section only (not all 277 pages)
 *  - Graceful fallback: returns partial text if timeout reached mid-extraction
 */
async function extractPDFText(
  file: File,
  onProgress?: (pct: number, msg: string) => void,
): Promise<{ text: string; error: string }> {
  const OVERALL_TIMEOUT_MS = 30_000;
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const checkDeadline = () => Date.now() > deadline;

  try {
    onProgress?.(5, 'Loading PDF engine…');

    // ── Step 1: Load PDF.js with timeout ──────────────────────────────────
    if (!(window as any).pdfjsLib) {
      await loadScriptWithTimeout(
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        8000,
      );
    }
    const pdfjsLib = (window as any).pdfjsLib;
    // Must set workerSrc BEFORE calling getDocument
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    onProgress?.(10, 'Reading file…');
    await yieldToUI();

    // ── Step 2: Load document with timeout wrapper ─────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    if (checkDeadline()) return { text: '', error: 'Extraction timed out during file read.' };

    const loadTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PDF load timed out (malformed or encrypted PDF?)')), OVERALL_TIMEOUT_MS),
    );

    onProgress?.(20, 'Parsing PDF structure…');
    const pdf = await Promise.race([loadTask.promise, timeoutPromise]);
    const totalPageCount: number = pdf.numPages;

    // ── Step 3: Smart page selection ──────────────────────────────────────
    // Financial statements are usually in the middle-to-late section of annual reports.
    // Strategy: read pages 1-10 (cover/identity), then pages 40-90 (financial section),
    // then pages 90-130. For small PDFs (<50 pages), read everything.
    let pagesToRead: number[];
    if (totalPageCount <= 50) {
      pagesToRead = Array.from({ length: totalPageCount }, (_, i) => i + 1);
    } else {
      // Cover + Table of Contents (first 10)
      const cover = Array.from({ length: Math.min(10, totalPageCount) }, (_, i) => i + 1);
      // Financial section heuristic: pages 40-130 for US 10-K, 30-90 for Indian filings
      const start = Math.min(30, totalPageCount);
      const end   = Math.min(130, totalPageCount);
      const financial = Array.from({ length: end - start + 1 }, (_, i) => i + start);
      // Deduplicate
      pagesToRead = [...new Set([...cover, ...financial])];
    }

    const totalToProcess = pagesToRead.length;
    onProgress?.(25, `Extracting text from ${totalToProcess} of ${totalPageCount} pages…`);
    await yieldToUI();

    // ── Step 4: Extract text page by page, yielding every 5 pages ─────────
    let allText = '';
    for (let i = 0; i < pagesToRead.length; i++) {
      if (checkDeadline()) {
        // Return partial text with a note
        allText += '\n[Extraction stopped: 30s timeout reached. Partial data shown.]\n';
        break;
      }

      const pageNum = pagesToRead[i];
      try {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const items: any[] = content.items;

        // Reconstruct text lines preserving columnar layout (critical for financial tables)
        let lastY: number | null = null;
        let line = '';
        for (const item of items) {
          const y = Math.round(item.transform[5]);
          if (lastY !== null && Math.abs(y - lastY) > 3) {
            allText += line.trimEnd() + '\n';
            line = '';
          }
          line += item.str + ' ';
          lastY = y;
        }
        if (line.trim()) allText += line.trimEnd() + '\n';
        allText += '\n';
      } catch {
        // Skip unreadable pages (common in image-based PDFs)
      }

      // Yield to UI every 5 pages to prevent browser freeze
      if (i % 5 === 4) {
        const pct = 25 + Math.round(((i + 1) / totalToProcess) * 70);
        onProgress?.(pct, `Processing page ${pageNum} of ${totalPageCount}…`);
        await yieldToUI();
      }
    }

    onProgress?.(98, 'Analyzing financial data…');
    await yieldToUI();

    if (!allText.trim()) {
      return { text: '', error: 'No text extracted — this PDF may be image-based (scanned). Try copying text manually and using Paste mode.' };
    }
    return { text: allText, error: '' };

  } catch (e: any) {
    const msg = e?.message || 'Unknown error';
    if (msg.includes('timed out') || msg.includes('timeout')) {
      return { text: '', error: `${msg}. Try Paste mode: open the PDF, Ctrl+A, Ctrl+C, paste here.` };
    }
    if (msg.includes('CDN') || msg.includes('network') || msg.includes('load')) {
      return { text: '', error: `PDF engine load failed. Check internet and try again, or use Paste mode.` };
    }
    return { text: '', error: `PDF extraction failed: ${msg}. Try Paste mode instead.` };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTRACTION ENGINE v3 — ROBUST UNIT-AWARE PARSER WITH VALIDATION
// Key changes from v2:
// 1. Validates that ratios are consistent (if gross margin = 49% and revenue = X,
//    then gross profit should be ~0.49*X — auto-corrects scale if not)
// 2. Multiple extraction strategies — picks the most internally consistent parse
// 3. Separates continuing vs discontinued operations
// 4. Better pattern matching for messy PDF.js text
// ═════════════════════════════════════════════════════════════════════════════

interface RawFinancials {
  // Identity
  company: string; ticker: string; period: string; periodType: string;
  filingType: string; currency: 'USD'|'INR'|'EUR'|'unknown';
  scaleLabel: string; scaleFactor: number; // multiply raw→display units

  // P&L — all in display units (e.g. $ Mn or ₹ Cr)
  revenue: number|null; revPrior: number|null;
  grossProfit: number|null; grossMargin: number|null;
  ebitda: number|null; ebitdaMargin: number|null;
  opex: number|null;
  ebit: number|null; ebitMargin: number|null;
  interestExpense: number|null;
  pbt: number|null; tax: number|null;
  pat: number|null; patPrior: number|null; patMargin: number|null;
  eps: number|null; epsPrior: number|null;
  rnd: number|null; sga: number|null; da: number|null;
  otherIncome: number|null;

  // Discontinued / one-offs
  discontinuedIncome: number|null; // e.g. gain on Bressner sale
  continuingRevenue: number|null;
  continuingPAT: number|null;

  // Balance Sheet
  cash: number|null; totalDebt: number|null; equity: number|null;
  totalAssets: number|null; netDebt: number|null;
  capex: number|null; ar: number|null; inventory: number|null;

  // Cash Flow
  cfo: number|null; fcf: number|null;

  // Computed
  deRatio: number|null; cfoPat: number|null; roce: number|null; roe: number|null; roa: number|null;

  // Business
  orderBook: number|null; backlog: number|null; headcount: number|null;

  // Text intelligence
  guidance: string[]; keyMetrics: string[]; forwardStatements: string[];
  themes: string[]; mgmtTone: 'bullish'|'cautious'|'neutral';

  // Validation + confidence gating
  validationWarnings: string[];
  hardFailures: string[];          // metrics that were nullified by firewall
  isDataReliable: boolean;
  continuingOpsDetected: boolean;

  // ── PIPELINE STATE: determines what the UI is allowed to show ───────────────
  // 'verified'  = all key metrics passed validation, scores can be displayed
  // 'partial'   = some metrics failed but revenue is valid, limited scores shown
  // 'failed'    = revenue/core metrics invalid, NO scores, only text analysis
  parseState: 'verified' | 'partial' | 'failed';
  parseConfidence: number;         // 0-100: how confident we are in the extraction
  revenueSource: string;           // e.g. "table_sum_subitems", "labeled_row", "unlabeled_row"
}

// ── STEP 1: Detect format ────────────────────────────────────────────────────

function detectCurrency(text: string): { currency: RawFinancials['currency']; filingType: string } {
  const t = text.toLowerCase();

  // ── Filing type detection — order from most specific to least ────────────
  let filingType = 'Earnings Document';
  // Quarterly supplement/event must come BEFORE 10-K check (Fastly supplement mentions 10-K in boilerplate)
  if (/first quarter 20\d{2}.*investor supplement|investor supplement.*first quarter/i.test(text))
    filingType = 'Q1 Investor Supplement';
  else if (/second quarter 20\d{2}.*investor supplement|q2 20\d{2}.*supplement/i.test(text))
    filingType = 'Q2 Investor Supplement';
  else if (/(third|fourth) quarter 20\d{2}.*investor supplement/i.test(text))
    filingType = 'Q Investor Supplement';
  else if (/annual report on form 10-k/.test(t)) filingType = 'SEC 10-K (Annual)';
  else if (/quarterly report on form 10-q/.test(t)) filingType = 'SEC 10-Q (Quarterly)';
  else if (/form 20-f/.test(t)) filingType = 'SEC 20-F';
  else if (/quarterly results|q[1-4] fy/.test(t)) filingType = 'Quarterly Results';
  else if (/annual report/.test(t)) filingType = 'Annual Report';
  else if (/investor presentation|earnings presentation/.test(t)) filingType = 'Investor Presentation';
  else if (/form 10-k/.test(t)) filingType = 'SEC 10-K (Annual)';
  else if (/form 10-q/.test(t)) filingType = 'SEC 10-Q (Quarterly)';

  // ── Currency detection — frequency-based, not first-match ───────────────
  // Count currency symbols next to numbers (not just any occurrence)
  // This prevents "factors." → "rs." triggering INR for a USD document
  const dollarCount = (text.match(/\$\s*[\d,]+/g) || []).length;
  const rupeeCount  = (text.match(/[₹][\s\d]|(?:\brs\.?\s*\d|\binr\s*\d)/gi) || []).length;
  // Strong explicit markers
  const hasRupeeSymbol = /₹/.test(text);
  const hasINRDeclared = /\binr\b|\brupees?\b/i.test(text);
  // "Rs." as Indian currency ONLY when followed by a digit/space (not "rs." in "factors.")
  const hasRsCurrency  = /\brs\.?\s+[\d,]|\brs\.\s*[\d,]/i.test(text);

  let currency: RawFinancials['currency'] = 'unknown';
  if (dollarCount > 5 && dollarCount > rupeeCount * 2) {
    // Clearly USD document — many "$123" occurrences dominate
    currency = 'USD';
  } else if (hasRupeeSymbol || hasINRDeclared || hasRsCurrency) {
    currency = 'INR';
  } else if (dollarCount > 0) {
    currency = 'USD';
  } else if (/€|euro\b/i.test(text)) {
    currency = 'EUR';
  }

  return { currency, filingType };
}

// ── STEP 2: Extract all numbers with their labels ────────────────────────────
// Returns array of {label, nums: number[]} — nums are RAW, not scaled

interface LabeledNum { label: string; nums: number[]; rawLine: string }

// ── PRE-PROCESSING: OCR Cleanup ───────────────────────────────────────────────
// Removes: audit boilerplate, OCR noise, footnote garbage, legal duplication.
// Essential for Indian PDFs which have extremely messy OCR output.

function cleanOCRText(rawText: string): string {
  let t = rawText;

  // 1. Normalise line endings
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. Remove lines that are pure OCR garbage (high non-ASCII ratio)
  const lines = t.split('\n');
  const cleanedLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines for structure
    if (trimmed.length < 3) return false;
    // If >40% of chars are non-printable/garbled, discard
    const nonPrint = (trimmed.match(/[^\x20-\x7E₹%.,()-/]/g) || []).length;
    if (nonPrint / trimmed.length > 0.4) return false;
    // Lines that look like OCR signatures/stamps: e.g. "KCAU]J)7945"
    if (/[A-Z]{2,}\]|\[A-Z|[A-Z]{4,}\d{4,}/.test(trimmed) && trimmed.length < 30) return false;
    return true;
  });
  t = cleanedLines.join('\n');

  // 3. Remove audit boilerplate sections (everything after these triggers)
  const BOILERPLATE_STARTS = [
    /^independent auditor/i,
    /^auditor'?s report/i,
    /^to,?\s*the board of directors/i,
    /^basis of opinion/i,
    /^management'?s responsibilities/i,
    /^auditor'?s responsibilities/i,
    /^we conducted our (?:audit|review)/i,
    /^in our opinion and to the best/i,
    /^the preparation of consolidated financial statements in conformity/i,
    /^management is responsible for the preparation/i,
    /^the financial statements comply with/i,
  ];
  const lineArr = t.split('\n');
  let boilerplateStart = -1;
  for (let i = 0; i < lineArr.length; i++) {
    if (BOILERPLATE_STARTS.some(re => re.test(lineArr[i].trim()))) {
      boilerplateStart = i;
      break;
    }
  }
  if (boilerplateStart > 20) {
    // Only cut if we have enough financial data before the boilerplate
    t = lineArr.slice(0, boilerplateStart).join('\n');
  }

  // 4. Fix common Indian PDF OCR errors
  // "Takhs" → "Lakhs", "Vear" → "Year", "Jmonths" → "months", "Yr.ended" → "Year ended"
  t = t.replace(/\bTakhs?\b/g, 'Lakhs').replace(/\bTakh\b/g, 'Lakh');
  t = t.replace(/\bVear\b/g, 'Year').replace(/\bVears\b/g, 'Years');
  t = t.replace(/\bJ months\b/gi, 'months').replace(/\bJmonths\b/gi, 'months');
  t = t.replace(/\bPreceding\d+\b/g, 'Prior Quarter');
  t = t.replace(/\bCorresponding\d+\b/g, 'Prior Year Quarter');

  // 5. Remove footnote reference markers that follow metric labels (e.g. "Revenue 1 12,345")
  // These are superscript numbers like "Revenue from operations 1 12,345"
  // Remove isolated 1-2 digit numbers that appear BETWEEN label and first real data number
  // Pattern: "labeltext [1-2 digits] [real numbers]" → strip the footnote marker
  t = t.replace(/^(\s*[A-Za-z][A-Za-z\s()/&,.-]{3,50})\s+(\d{1,2})\s+(\d[\d,]+)/gm,
    (_, label, _footnote, nums) => `${label} ${nums}`);

  // 6. Remove page headers/footers (lines < 50 chars that repeat or contain page numbers)
  // Remove lines like "Page 5 of 12", "Continued...", standalone company name lines after p10
  t = t.replace(/^Page \d+ of \d+.*$/gim, '');
  t = t.replace(/^\s*(continued\.{2,}|contd\.{0,3})\s*$/gim, '');

  // 7. Normalise decimal separators from Indian PDFs
  // Some Indian PDFs use period as thousands: "41.935" should be "41935" (lakh) or kept
  // But "9.169.17" is corrupted — fix double-period decimals
  t = t.replace(/(\d+)\.(\d{3})\.(\d{1,2})\b/g, '$1,$2.$3'); // "9.169.17" → "9,169.17"

  return t;
}

function extractAllNumbers(text: string): LabeledNum[] {
  const results: LabeledNum[] = [];
  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 5) continue;

    // Skip lines that look like column headers only (no labels with meaning)
    if (/^(q[1-4]|fy\d|20\d{2}|h[12] fy|\d{2}[./]\d{2}[./]20\d{2})/i.test(line) && !/[a-z]{4}/i.test(line)) continue;

    // Extract all number-like tokens (handling parentheses for negatives)
    const numRe = /\(?\$?\s*([\d,]+(?:\.\d+)?)\)?%?/g;
    const numTokens: number[] = [];
    let m: RegExpExecArray | null;
    numRe.lastIndex = 0;
    while ((m = numRe.exec(line)) !== null) {
      const raw = m[1].replace(/,/g, '');
      const n = parseFloat(raw);
      if (!isNaN(n)) {
        const isNeg = m[0].trim().startsWith('(') && m[0].includes(')');
        numTokens.push(isNeg ? -n : n);
      }
    }
    if (numTokens.length === 0) continue;

    // Label = everything before the first number token
    const firstNumMatch = line.match(/\(?\$?\s*[\d,]+/);
    if (!firstNumMatch) continue;
    const labelEnd = line.indexOf(firstNumMatch[0]);
    const rawLabel = line.slice(0, labelEnd).replace(/\$|%|\|/g, '').trim().toLowerCase();
    // Clean label: remove trailing footnote-reference digits
    const label = rawLabel.replace(/\s+\d{1,2}$/, '').trim();

    if (label.length < 2) {
      // FIX FOR OSS 10-K: unlabeled P&L total rows like "32,215,500  24,558,809"
      // These are extremely common in SEC filings — revenue sub-items are followed by
      // an unlabeled total line. Allow rows with 2+ LARGE numbers (> 1000) as unlabeled totals.
      if (numTokens.length >= 2 && Math.abs(numTokens[0]) > 1000) {
        // Keep as unlabeled total, tag with empty string
        let nums = numTokens;
        // Still apply footnote stripping if first token is tiny vs rest
        if (nums.length >= 2 && nums[0] >= 1 && nums[0] <= 9 && Number.isInteger(nums[0]) && nums[1] > nums[0] * 100) {
          nums = nums.slice(1);
        }
        results.push({ label: '', nums, rawLine: line });
      }
      continue;
    }

    // FOOTNOTE GUARD: if the ONLY number is a small integer (1-9) right after the label,
    // and it has no other numbers, it's a footnote reference — skip
    if (numTokens.length === 1 && numTokens[0] >= 0 && numTokens[0] <= 9 && Number.isInteger(numTokens[0])) {
      // Check if the remainder of the line has no real financial data
      const afterNum = line.slice(labelEnd + (firstNumMatch[0].length)).trim();
      if (!afterNum || !/\d{3,}/.test(afterNum)) continue; // true footnote, skip
    }

    // Filter out footnote markers from the start of numTokens
    // If first token is 1-9 AND rest are much larger (ratio > 100), first is a footnote
    let nums = numTokens;
    if (nums.length >= 2 && nums[0] >= 1 && nums[0] <= 9 && Number.isInteger(nums[0])) {
      if (nums[1] > nums[0] * 100) {
        nums = nums.slice(1); // Strip the footnote marker
      }
    }

    results.push({ label, nums, rawLine: line });
  }
  return results;
}

// ── STEP 3: Auto-detect scale from extracted numbers ──────────────────────────
// ── STEP 3a: Text-based scale detector (HIGHEST PRIORITY) ─────────────────────
// Reads explicit declarations: "(in thousands)", "INR in lakhs", etc.
// Much more reliable than magnitude-based detection.

function detectScaleFromText(text: string): { factor: number; scaleLabel: string } | null {
  const t = text.toLowerCase();
  // USD thousands — most common in US quarterly supplements, 10-Q etc.
  if (/\(unaudited,?\s*in thousands|in thousands,?\s*except|in thousands\b/.test(t))
    return { factor: 0.001, scaleLabel: '$ Mn' };
  // USD millions
  if (/in millions,?\s*except|in millions\b|\(in millions\)/.test(t))
    return { factor: 1, scaleLabel: '$ Mn' };
  // USD billions
  if (/in billions\b|\(in billions\)/.test(t))
    return { factor: 1000, scaleLabel: '$ Bn' };
  // INR lakhs — Indian NSE/BSE format
  if (/inr in lakhs?\b|\(inr in lakhs?\)|rs\.? in lakhs?\b|rupees? in lakhs?\b|\(₹ in lakhs?\)/.test(t))
    return { factor: 0.01, scaleLabel: '₹ Cr' };
  // INR crores
  if (/inr in crore|\(inr in crore|\(₹ in crore|rs\.? in crore|amounts in crore/.test(t))
    return { factor: 1, scaleLabel: '₹ Cr' };
  return null;
}

// ── STEP 3b: Detect the "current period" column index ─────────────────────────
// Multi-period tables (quarterly supplements, Indian results) have multiple date columns.
// We must select the MOST RECENT column, not column 0.
//
// Examples:
//   Fastly: "Q2 2024  Q3 2024  Q4 2024  Q1 2025 ... Q1 2026" → 8 cols, current = col 7
//   Aeroflex: "31.03.2026  31.12.2025  31.03.2025  31.03.2026  31.03.2025" → current = col 3 (year)
//   SEC 10-K 2-col: "2025  2024" → current = col 0 (first col IS current)

interface ColDetection { curIdx: number; priorIdx: number; colCount: number; reason: string }

function detectColumnIndices(text: string, rows: LabeledNum[]): ColDetection {
  // Get the typical column count from the most-repeated column count across rows
  const counts = rows.map(r => r.nums.length).filter(n => n >= 2);
  if (counts.length === 0) return { curIdx: 0, priorIdx: 1, colCount: 2, reason: 'no data' };
  const freqMap: Record<number,number> = {};
  for (const c of counts) freqMap[c] = (freqMap[c]||0)+1;
  const colCount = parseInt(Object.entries(freqMap).sort((a,b)=>b[1]-a[1])[0][0]);

  // Look for quarterly header rows: "Q1 2026 Q4 2025 Q3 2025 ..."
  const qHeaderMatch = text.match(/\b(Q[1-4]\s*20\d{2})\b.*\b(Q[1-4]\s*20\d{2})\b/);
  if (qHeaderMatch) {
    // Find all quarters in the header and sort chronologically to find latest
    const allQs = [...text.matchAll(/\b(Q[1-4])\s*(20\d{2})\b/g)]
      .map(m => ({ q: m[1], y: parseInt(m[2]), raw: `${m[1]}${m[2]}` }));
    if (allQs.length >= 2) {
      // Latest quarter = highest year, then highest Q number
      const sorted = [...allQs].sort((a,b) => b.y - a.y || parseInt(b.q[1]) - parseInt(a.q[1]));
      const latestRaw = sorted[0].raw;
      // Find its position in the header
      const headerLine = text.split('\n').find(l => new RegExp(latestRaw.replace(/(\d)/g,'$1')).test(l) && ((l.match(/Q[1-4]/g)?.length ?? 0) >= 2));
      if (headerLine) {
        const allInLine = [...headerLine.matchAll(/Q[1-4]\s*20\d{2}/g)].map(m => m[0].replace(/\s/g,''));
        const latestIdx = allInLine.findIndex(q => q.replace(/\s/g,'') === latestRaw);
        if (latestIdx >= 0 && latestIdx < colCount) {
          const priorIdx = latestIdx > 0 ? latestIdx - 1 : (latestIdx + 1 < colCount ? latestIdx + 1 : 0);
          return { curIdx: latestIdx, priorIdx, colCount, reason: 'quarterly-header' };
        }
      }
      // Fallback: latest quarter is the LAST column (most common layout)
      return { curIdx: colCount - 1, priorIdx: Math.max(0, colCount - 2), colCount, reason: 'quarterly-last' };
    }
  }

  // Indian format: "Year ended 31.03.2026 / 31.03.2025" + "Quarter ended" columns
  // Typical: 5 cols = [Q4_cur, Q3_cur, Q4_prior, FY_cur, FY_prior]
  if (/year ended/i.test(text) && /quarter ended/i.test(text) && colCount === 5) {
    return { curIdx: 3, priorIdx: 4, colCount, reason: 'indian-5col-year' };
  }
  // Indian 4-col: [Q_cur, Q_prior, FY_cur, FY_prior]
  if (/year ended/i.test(text) && colCount === 4) {
    return { curIdx: 2, priorIdx: 3, colCount, reason: 'indian-4col-year' };
  }

  // Date-based headers: "31.03.2026  31.12.2025  31.03.2025"
  const dateHeaders = [...text.matchAll(/\b(\d{2}[./]\d{2}[./]20\d{2})\b/g)]
    .map(m => m[1]);
  if (dateHeaders.length >= 2) {
    // Parse to Date and find the latest
    const parsed = dateHeaders.map(d => {
      const parts = d.split(/[./]/);
      return { raw: d, ts: new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime() };
    }).filter(d => !isNaN(d.ts));
    if (parsed.length >= 2) {
      const latest = parsed.reduce((a,b) => a.ts > b.ts ? a : b);
      const latestIdx = parsed.indexOf(latest);
      if (latestIdx < colCount) {
        const priorIdx = latestIdx > 0 ? latestIdx - 1 : 1;
        return { curIdx: latestIdx, priorIdx, colCount, reason: 'date-header' };
      }
    }
  }

  // Standard 2-col annual report (most recent first): [2025, 2024] → col 0 = current
  if (colCount === 2) {
    return { curIdx: 0, priorIdx: 1, colCount, reason: '2col-first-is-current' };
  }

  // Default: last column = current (common for history tables)
  return { curIdx: colCount - 1, priorIdx: Math.max(0, colCount - 2), colCount, reason: 'default-last' };
}

// ── STEP 3c: Scale from numbers (fallback if text detection fails) ─────────────

function detectScaleFromNumbers(rows: LabeledNum[], currency: string, curIdx: number): { factor: number; scaleLabel: string } {
  const sym = currency === 'USD' ? '$' : currency === 'INR' ? '₹' : '';

  // FIX: Only use LABELED revenue rows for scale detection.
  // Empty-label rows appear throughout the document (cost totals, asset totals, etc.)
  // and would give wrong scale. The global max-number fallback handles the case
  // where no labeled revenue row exists (e.g., OSS 10-K unlabeled total format).
  const revRow = rows.find(r =>
    r.label.length > 0 && // MUST have a label
    /^(total )?revenue|^net sales|^revenue from operations|^revenues?$/.test(r.label)
  );
  let revenueCandidate = revRow?.nums[curIdx] ?? revRow?.nums[0];

  // FIX FOR AEROFLEX OCR DECIMAL CORRUPTION:
  // Indian PDFs sometimes produce "4124720" when the actual value is "41247.20" (lakhs)
  // because the decimal point is dropped by OCR. This makes numbers appear 100x too large.
  // Heuristic: if we have a labeled row (revenue from operations) AND one well-formatted
  // column value AND another that's ~100x larger, apply /100 correction.
  if (revRow && revRow.label !== '' && revRow.nums.length >= 2) {
    const wellFormatted = revRow.nums.filter(n => n.toString().includes('.'));  // has decimal
    const largeOnes = revRow.nums.filter(n => !n.toString().includes('.') && n > 100000); // no decimal, very large
    if (wellFormatted.length > 0 && largeOnes.length > 0) {
      // Check if large ones / 100 ≈ well-formatted ones (OCR dropped last 2 decimal digits)
      const avgFormatted = wellFormatted.reduce((s,n)=>s+n,0)/wellFormatted.length;
      const correctedLarge = largeOnes[0] / 100;
      if (Math.abs(correctedLarge - avgFormatted) / avgFormatted < 2.0) {
        // The large numbers look like decimal-corrupted versions — prefer the formatted ones
        revenueCandidate = wellFormatted[0];
      }
    }
  }

  if (revenueCandidate && revenueCandidate > 0) {
    if (revenueCandidate >= 1e8) {
      const factor = currency === 'INR' ? 1e-5 : 1e-6;
      return { factor, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
    }
    if (revenueCandidate >= 1e5) {
      const factor = currency === 'INR' ? 1e-2 : 1e-3;
      return { factor, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
    }
    if (revenueCandidate >= 100) {
      return { factor: 1, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
    }
  }

  // Fallback: scan all rows for any large number to infer scale
  const allNums = rows.flatMap(r => r.nums).filter(n => n > 0 && !isNaN(n));
  const maxNum = allNums.length > 0 ? Math.max(...allNums) : 0;
  if (maxNum >= 1e8) return { factor: currency === 'INR' ? 1e-5 : 1e-6, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
  if (maxNum >= 1e5) return { factor: currency === 'INR' ? 1e-2 : 1e-3, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };

  return { factor: 1, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
}

// ── STEP 4: Find a specific metric using detected column indices ───────────────

function findMetric(rows: LabeledNum[], patterns: string[], colIdx = 0): number | null {
  for (const pat of patterns) {
    const re = new RegExp(pat, 'i');
    for (const row of rows) {
      if (re.test(row.label)) {
        // Try the requested column first, then fallback to first available
        const v = row.nums[colIdx] ?? row.nums[0];
        if (v !== undefined && !isNaN(v)) return v;
      }
    }
  }
  return null;
}

// Find the best revenue candidate — respects column index
function findRevenue(
  rows: LabeledNum[],
  curIdx: number,
  priorIdx: number,
  scaleFactor: number,
): { cur: number|null; prior: number|null } {
  const EXACT = ['total revenue', 'total revenues', 'net revenue', 'net revenues',
                 'total net revenue', 'net sales', 'total net sales', 'revenue from operations'];
  const FUZZY = ['revenue from operations', 'total revenue', 'net revenue', 'revenues$', 'net sales'];

  // Candidates: collect ALL rows matching revenue patterns, then pick the best one.
  // "Best" = has enough columns for curIdx + plausibility check (scaled value ≥ 0.5 display unit)
  const candidates: { row: LabeledNum; cur: number; prior: number|null; score: number }[] = [];

  const tryRow = (row: LabeledNum) => {
    // FIX FOR AEROFLEX: require the row to have enough elements for curIdx
    // If row only has 1 number (e.g., footnote "1" on its own line), skip it
    if (row.nums.length <= curIdx) return; // not enough columns — DON'T fall back to nums[0]

    const cur = row.nums[curIdx];
    if (!cur || cur <= 0) return;

    // FIX FOR FASTLY: plausibility guard
    // If applying scale makes revenue < 0.5 display unit AND there are other candidates,
    // this is likely a narrative "173.0 million" that shouldn't have scale applied.
    const scaledCur = cur * scaleFactor;
    if (scaledCur < 0.5 && scaleFactor < 1) {
      // Too small for a public company — deprioritize but don't reject outright
      // (could be a micro-cap, but try to find better candidates first)
    }

    const prior = row.nums[priorIdx] ?? (row.nums.length > 1 ? row.nums[Math.min(1, row.nums.length-1)] : null);
    // Score: prefer rows with MORE columns (table rows > narrative rows) + larger values
    const colScore = row.nums.length * 10;
    const sizeScore = Math.min(scaledCur, 1000); // cap so massive outliers don't dominate
    const plausibilityBonus = scaledCur >= 0.5 ? 100 : 0; // strong bonus for plausible revenue
    candidates.push({ row, cur, prior: (prior !== cur ? prior : null), score: colScore + sizeScore + plausibilityBonus });
  };

  for (const pat of EXACT) {
    const re = new RegExp(`^${pat}$`, 'i');
    for (const row of rows) {
      if (re.test(row.label.trim())) tryRow(row);
    }
  }
  for (const pat of FUZZY) {
    const re = new RegExp(pat, 'i');
    for (const row of rows) {
      if (!candidates.some(c => c.row === row) && re.test(row.label)) tryRow(row);
    }
  }

  // ── STRATEGY 3: Sum of revenue sub-items (OSS 10-K pattern) ────────────────
  // SEC filings often show: "Product  $30M  $20M\n  Services  $2M  $4M\n  32M  24M" (unlabeled total)
  // When no labeled "total revenue" row exists, sum the sub-items to compute the total.
  if (candidates.length === 0 || candidates[0].cur * scaleFactor < 0.5) {
    const SUB_PATTERNS = /^(?:product|products?|service|services?|subscription|license|licenses?|customer funded|recurring|professional|hardware|software|hosted|cloud|platform|tier|segment)/i;
    // FIX: Use FIRST OCCURRENCE ONLY per label to avoid summing both revenue AND cost sub-items.
    // In OSS 10-K: "Product" appears in BOTH revenue section AND cost section.
    // Taking first occurrence means we get the revenue sub-items (they appear first in document order).
    const seenSubLabels = new Set<string>();
    const subRows: LabeledNum[] = [];
    for (const r of rows) {
      if (
        SUB_PATTERNS.test(r.label) &&
        !seenSubLabels.has(r.label) &&      // FIRST occurrence only
        r.nums.length > Math.min(curIdx, r.nums.length - 1) &&
        (r.nums[Math.min(curIdx, r.nums.length-1)] ?? 0) > 0
      ) {
        seenSubLabels.add(r.label);
        subRows.push(r);
      }
    }
    if (subRows.length >= 2) {
      const colToUse = (r: LabeledNum) => Math.min(curIdx, r.nums.length - 1);
      const sumCur   = subRows.reduce((s, r) => s + (r.nums[colToUse(r)] ?? 0), 0);
      const sumPrior = subRows.reduce((s, r) => s + (r.nums[Math.min(priorIdx, r.nums.length-1)] ?? 0), 0);
      if (sumCur > 0) {
        const scaledSum = sumCur * scaleFactor;
        const score = 200 + subRows.length * 5 + (scaledSum >= 0.5 ? 100 : 0); // high priority
        candidates.push({ row: subRows[0], cur: sumCur, prior: sumPrior > 0 ? sumPrior : null, score });
      }
    }
  }

  // ── STRATEGY 4: Unlabeled rows (OSS 10-K unlabeled total line) ───────────────
  // "32,215,500  24,558,809" — no label, but we preserved it in extractAllNumbers
  if (candidates.length === 0 || candidates[0].cur * scaleFactor < 0.5) {
    const unlabeledRows = rows.filter(r => r.label === '' && r.nums.length >= 2);
    for (const row of unlabeledRows) {
      if (row.nums.length <= curIdx) continue;
      const cur = row.nums[curIdx] ?? row.nums[0];
      if (!cur || cur <= 0) continue;
      const scaledCur = cur * scaleFactor;
      const score = row.nums.length * 5 + (scaledCur >= 0.5 ? 80 : 0);
      const prior = row.nums[priorIdx] ?? row.nums[Math.min(1, row.nums.length-1)] ?? null;
      candidates.push({ row, cur, prior: prior !== cur ? prior : null, score });
    }
  }

  if (candidates.length === 0) return { cur: null, prior: null };
  candidates.sort((a, b) => b.score - a.score);
  return { cur: candidates[0].cur, prior: candidates[0].prior };
}

// ── STEP 5: Validate and cross-check — detect impossible relationships ────────

// ── VALIDATION FIREWALL ───────────────────────────────────────────────────────
// Hard rules: any metric that fails is nullified BEFORE reaching the UI.
// Impossible numbers MUST NEVER appear in the output.
// These rules encode financial reality: margins can't exceed 100%, etc.

interface MetricBounds { min: number; max: number; name: string }
const METRIC_BOUNDS: MetricBounds[] = [
  { name: 'grossMargin',   min: -50,   max: 100   },  // Gross margin physically can't exceed 100%
  { name: 'ebitdaMargin',  min: -500,  max: 100   },  // EBITDA can't exceed revenue
  { name: 'ebitMargin',    min: -500,  max: 100   },
  { name: 'patMargin',     min: -500,  max: 80    },  // PAT > 80% of revenue = almost impossible
  { name: 'roce',          min: -200,  max: 200   },
  { name: 'roe',           min: -500,  max: 300   },
  { name: 'roa',           min: -200,  max: 100   },
  { name: 'cfoPat',        min: -50,   max: 50    },  // CFO/PAT of 940x = parsing error
  { name: 'deRatio',       min: 0,     max: 100   },
];

/** Nullify a metric if it falls outside the plausible range for that metric.
 *  Returns null (invalid) or the original value (valid). */
function guardMetric(value: number | null, bounds: MetricBounds): number | null {
  if (value === null) return null;
  if (value < bounds.min || value > bounds.max) return null;
  return value;
}

/** Apply all financial sanity guards to a partial RawFinancials object.
 *  MUTATES the object in place, nullifying impossible values. */
function sanitizeMetrics(d: Partial<RawFinancials>): string[] {
  const issues: string[] = [];

  // 1. Revenue near-zero but other P&L items are large = parsing failure
  const rev = d.revenue ?? 0;
  if (rev < 0.1 && rev > 0 && ((d.grossProfit ?? 0) > 1 || (d.ebitda ?? 0) > 1)) {
    issues.push('Revenue near-zero while EBITDA/GP are substantial — extraction failed');
    // Nullify all derived ratios; keep revenue warning visible
    d.grossMargin = null; d.ebitdaMargin = null; d.ebitMargin = null;
    d.patMargin = null; d.roce = null; d.roe = null; d.roa = null; d.cfoPat = null;
  }

  // 2. Nullify margins that exceed hard bounds
  for (const b of METRIC_BOUNDS) {
    const key = b.name as keyof RawFinancials;
    const val = d[key] as number | null;
    const guarded = guardMetric(val, b);
    if (val !== null && guarded === null) {
      issues.push(`${b.name}: ${val?.toFixed(1)} outside valid range [${b.min}, ${b.max}] — suppressed`);
      (d as Record<string, unknown>)[key] = null;
    }
  }

  // 3. PAT > revenue by more than 3x (unless discontinued ops explain it)
  const pa = d.pat ?? 0;
  if (rev > 0.1 && Math.abs(pa) > rev * 3 && !d.continuingOpsDetected) {
    issues.push(`PAT (${pa.toFixed(1)}) >> Revenue (${rev.toFixed(1)}) — likely parsing error`);
    d.pat = null; d.patPrior = null; d.patMargin = null; d.roe = null; d.cfoPat = null;
  }

  // 4. Total assets < equity = accounting impossibility
  const ta = d.totalAssets ?? 0;
  const eq = d.equity ?? 0;
  if (ta > 0 && eq > 0 && eq > ta * 1.5) {
    issues.push('Total assets < Equity — balance sheet extraction failed');
    d.equity = null; d.deRatio = null; d.roce = null; d.roe = null;
  }

  // 5. Gross profit > revenue = impossible
  const gp = d.grossProfit ?? 0;
  if (rev > 0.1 && gp > rev * 1.05) {
    issues.push('Gross profit > Revenue — scaling mismatch');
    d.grossProfit = null; d.grossMargin = null; d.ebitda = null; d.ebitdaMargin = null;
  }

  // 6. CFO/PAT guard
  const cfoPat = d.cfoPat ?? 0;
  if (Math.abs(cfoPat) > 50) {
    issues.push(`CFO/PAT=${cfoPat.toFixed(1)}x is extreme — PAT likely near-zero, ratio meaningless`);
    d.cfoPat = null;
  }

  // 7. Re-compute gross margin from validated GP/Rev if stated margin was wrong
  if (d.grossMargin === null && d.grossProfit && d.revenue && d.revenue > 0) {
    const recomputed = (d.grossProfit / d.revenue) * 100;
    if (recomputed >= -50 && recomputed <= 100) d.grossMargin = Math.round(recomputed * 100) / 100;
  }

  return issues;
}

function validateFinancials(d: Partial<RawFinancials>, _rows: LabeledNum[]): string[] {
  const warnings: string[] = [];
  const { revenue, grossProfit, grossMargin, cash, totalDebt } = d;

  // Soft warnings (non-nullifying)
  if (revenue && revenue > 0 && grossProfit && grossProfit > 0 && grossMargin !== null && grossMargin !== undefined) {
    const impliedGM = (grossProfit / revenue) * 100;
    const stated = Math.abs(grossMargin);
    const implied = Math.abs(impliedGM);
    if (stated <= 100 && implied <= 100 && Math.abs(implied - stated) > 30) {
      warnings.push(`Gross margin mismatch: stated ${grossMargin.toFixed(1)}% vs computed ${impliedGM.toFixed(1)}% — verify scale`);
    }
  }

  const ca = cash ?? 0;
  const td = totalDebt ?? 0;
  if (ca > 0 && td > 0 && ca > td * 50) {
    warnings.push('Cash >> Total Debt by 50x — balance sheet scaling may be inconsistent');
  }

  return warnings;
}

// ── STEP 6: Extract management text intelligence ──────────────────────────────

const NARRATIVE_THEMES: { tag: string; label: string; emoji: string; color: string; keywords: string[] }[] = [
  { tag: 'AI_INFRA',    label: 'AI Infrastructure',     emoji: '🤖', color: '#38bdf8', keywords: ['artificial intelligence','machine learning','ai/ml','generative ai','llm','foundation model','gpu','data center ai','ai training','ai inference','ai workload','ai chipset'] },
  { tag: 'EDGE_COMPUTE',label: 'Edge Compute',          emoji: '⚡', color: '#a78bfa', keywords: ['edge compute','edge ai','edge platform','rugged compute','rugged hpc','high performance compute','edge processing','hpc','sensor fusion','sensor processing'] },
  { tag: 'DEFENSE',     label: 'Defense / Military',    emoji: '🛡️', color: '#f97316', keywords: ['defense','defence','military','army','navy','air force','autonomous vehicle','uav','unmanned','naval','weapon system','classified','government contract','defense prime','drdo'] },
  { tag: 'AUTONOMY',    label: 'Autonomous Systems',    emoji: '🚗', color: '#10b981', keywords: ['autonomous','autonomy','self-driving','automated','self-guided','unmanned aerial','robotics','auto navigation'] },
  { tag: 'SEMI',        label: 'Semiconductor',         emoji: '💾', color: '#f59e0b', keywords: ['semiconductor','chip','gpu','cpu','asic','fpga','silicon','wafer','foundry','pcie','nvme','flash'] },
  { tag: 'DEFENSE_AI',  label: 'Defense AI',            emoji: '🎯', color: '#ef4444', keywords: ['defense ai','military ai','battlefield ai','weapon ai','tactical ai','ew system','electronic warfare','c2 system','command control'] },
  { tag: 'CLOUD_INFRA', label: 'Cloud / HPC',           emoji: '☁️', color: '#06b6d4', keywords: ['hyperscaler','cloud computing','hpc cluster','super computer','gpu cluster','distributed computing'] },
  { tag: 'CLEAN_ENERGY',label: 'Clean Energy',          emoji: '🌱', color: '#34d399', keywords: ['solar energy','wind energy','renewable energy','battery storage','ev charging','green energy','clean energy','climate tech'] },
  { tag: 'PHARMA_AI',   label: 'Pharma / Biotech',      emoji: '🧬', color: '#c084fc', keywords: ['drug discovery','clinical trial','biopharma','genomics','proteomics','ai drug','biomarker','precision medicine'] },
  { tag: 'CDN_EDGE',    label: 'CDN / Edge Cloud',      emoji: '🌐', color: '#2dd4bf', keywords: ['content delivery network','cdn','edge cloud','edge computing platform','web application firewall','waf','ddos protection','network security','next-gen waf','bot management','api security','zero trust'] },
  { tag: 'FINTECH',     label: 'Fintech / Payments',    emoji: '💳', color: '#f472b6', keywords: ['payment processing','digital payments','neobank','buy now pay later','bnpl','open banking','blockchain payment','crypto exchange','cbdc'] },
  { tag: 'INDIA_INFRA', label: 'India Infrastructure',  emoji: '🏗️', color: '#fb923c', keywords: ['pm gati shakti','national highway','smart city','metro rail','water supply','irrigation project','bharat','make in india','atmanirbhar','pli scheme'] },
  { tag: 'EV',          label: 'EV / Mobility',         emoji: '🔋', color: '#4ade80', keywords: ['electric vehicle','ev battery','ev charging infrastructure','battery electric','bev','plug-in hybrid','motor vehicle electri'] },
];

// Minimum keyword match count required for theme detection (prevents false positives)
const THEME_MIN_MATCHES: Record<string, number> = {
  AI_INFRA: 2,      // needs 2 AI keywords to avoid "AI" mentioned in footnote
  SEMI: 2,          // "chip" in passing shouldn't trigger
  AUTONOMY: 2,      // "autonomous" in boilerplate shouldn't trigger
  DEFENSE: 2,       // needs 2 defense keywords
  CDN_EDGE: 1,      // highly specific terms
  INDIA_INFRA: 2,
};

function detectNarrativeThemes(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  for (const theme of NARRATIVE_THEMES) {
    const minMatch = THEME_MIN_MATCHES[theme.tag] ?? 1;
    const matchCount = theme.keywords.filter(kw => t.includes(kw)).length;
    if (matchCount >= minMatch) found.push(theme.tag);
  }
  return found;
}

function extractManagementText(text: string): {
  guidance: string[];
  keyMetrics: string[];
  forwardStatements: string[];
  mgmtTone: RawFinancials['mgmtTone'];
} {
  const sentences = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.replace(/\n/g, ' ').trim())
    .filter(s => s.length > 50 && s.length < 400);

  const FORWARD_KWS   = ['expect', 'anticipate', 'target', 'guidance', 'outlook', 'forecast', 'going forward', 'fy20', 'next quarter', 'full year', 'plan to', 'will achieve', 'will exceed', 'we believe'];
  const KEY_METRIC_KWS = ['increased', 'decreased', 'grew', 'declined', 'improved', 'record', 'highest', 'year-over-year', '%', 'million', 'billion', 'crore', 'pipeline'];
  const BULLISH_KWS   = ['pipeline', 'billion', 'backlog', 'record', 'accelerat', 'win', 'contract', 'awarded', 'growth', 'expand', 'margin improvement', 'positive adjusted', 'beat'];
  const CAUTIOUS_KWS  = ['uncertainty', 'challenge', 'headwind', 'risk', 'delay', 'decline', 'disappointing', 'miss', 'pressure', 'difficult'];

  const guidance = sentences.filter(s => {
    const sl = s.toLowerCase();
    return FORWARD_KWS.some(kw => sl.includes(kw)) && /\b(we|company|management|our)\b/i.test(s);
  }).slice(0, 5);

  const keyMetrics = sentences.filter(s => {
    const sl = s.toLowerCase();
    return KEY_METRIC_KWS.some(kw => sl.includes(kw)) && /\d/.test(s);
  }).filter(s => !guidance.includes(s)).slice(0, 6);

  const forwardStatements = sentences.filter(s => {
    const sl = s.toLowerCase();
    return (FORWARD_KWS.some(kw => sl.includes(kw)) || /\d/.test(s)) && s.length < 250;
  }).filter(s => !guidance.includes(s)).slice(0, 4);

  const bullishCount = sentences.filter(s => BULLISH_KWS.some(kw => s.toLowerCase().includes(kw))).length;
  const cautiousCount = sentences.filter(s => CAUTIOUS_KWS.some(kw => s.toLowerCase().includes(kw))).length;
  const mgmtTone: RawFinancials['mgmtTone'] = bullishCount > cautiousCount * 1.5 ? 'bullish' : cautiousCount > bullishCount * 1.5 ? 'cautious' : 'neutral';

  return { guidance, keyMetrics, forwardStatements, mgmtTone };
}

// ── STEP 7: Detect discontinued operations ────────────────────────────────────

function detectDiscontinued(text: string): { detected: boolean; discontinuedIncome: number|null; continuingRevNote: string } {
  // FIX: Only look for discontinued ops in the FINANCIAL STATEMENTS section.
  // Audit reports and legal boilerplate frequently mention "subsidiaries", "disposal groups"
  // in a generic context that does NOT mean the company has discontinued operations.
  //
  // Strategy: look for the specific financial line items that only appear in actual
  // financial statements (not audit opinion text).

  // Must find the FINANCIAL STATEMENT version: a line in a P&L table
  const hasFinancialStatement = /consolidated statements? of operations|consolidated statements? of (?:comprehensive )?income|income statement/i.test(text);

  // Strong indicators that discontinued ops actually affected the financial results
  const strongSignals = [
    /income from discontinued operations.*[\$₹]?\s*([\d,]+)/i,  // explicit line item with amount
    /loss from discontinued operations.*[\$₹]?\s*([\d,]+)/i,
    /gain on sale.*subsidiary.*[\$₹]?\s*([\d,]+)/i,
    /net.*discontinued operations.*[\$₹]?\s*([\d,]+)/i,
  ];

  for (const sig of strongSignals) {
    const m = text.match(sig);
    if (m) {
      const inc = parseFloat(m[1]?.replace(/,/g, '') || '0');
      return {
        detected: true,
        discontinuedIncome: isNaN(inc) ? null : inc,
        continuingRevNote: 'Discontinued operations detected in financial statements',
      };
    }
  }

  // Secondary: only flag if financial statement section exists AND specific language appears
  if (hasFinancialStatement) {
    const t = text.toLowerCase();
    if (/discontinued operations/.test(t) && /bressner|divestiture|held for sale|disposal group/.test(t)) {
      return { detected: true, discontinuedIncome: null, continuingRevNote: 'Divestiture detected — verify discontinued ops impact' };
    }
  }

  return { detected: false, discontinuedIncome: null, continuingRevNote: '' };
}

// ── STEP 8: MAIN EXTRACTION ────────────────────────────────────────────────────

function parseEarnings(rawText: string): RawFinancials {
  // Apply OCR cleanup first — removes boilerplate, footnote markers, OCR noise
  const text = cleanOCRText(rawText);
  const { currency, filingType } = detectCurrency(text);

  // Extract labeled rows
  const rows = extractAllNumbers(text);

  // ── SCALE DETECTION: text first (explicit), then numbers (fallback) ──────────
  // Step 1: Try to read scale from explicit text declaration (most reliable)
  const textScale = detectScaleFromText(text);

  // Step 2: Detect which column is "current period" in multi-period tables
  const { curIdx, priorIdx, colCount, reason: colReason } = detectColumnIndices(text, rows);

  // Step 3: If text scale not found, infer from magnitude using correct column
  const { factor, scaleLabel } = textScale ?? detectScaleFromNumbers(rows, currency, curIdx);

  // Helper: scale a raw number to display units (Mn/Cr)
  const sc = (v: number|null): number|null => v !== null ? Math.round(v * factor * 1000) / 1000 : null;

  // Helper: find metric using the detected column
  const fm = (patterns: string[]) => findMetric(rows, patterns, curIdx);
  const fmp = (patterns: string[]) => findMetric(rows, patterns, priorIdx); // prior period

  // ── PERIOD & COMPANY ─────────────────────────────────────────────────────────

  const period = (() => {
    // Q1/Q2/Q3/Q4 supplement (check BEFORE annual to avoid "For the fiscal year" in boilerplate)
    const suppMatch = text.match(/first quarter 20(\d{2})|q1\s*20(\d{2})/i);
    if (suppMatch) return `Q1 20${suppMatch[1] || suppMatch[2]}`;
    const suppMatch2 = text.match(/second quarter 20(\d{2})|q2\s*20(\d{2})/i);
    if (suppMatch2) return `Q2 20${suppMatch2[1] || suppMatch2[2]}`;

    // FIX: Use the MOST RECENT year from all "fiscal year/year ended" matches
    // (not just the first match — historical refs like "year ended Dec 31, 2015" appear later
    // in the document but JS text.match returns the first occurrence regardless)
    const allFYMatches = [...text.matchAll(/(?:for the fiscal year|fiscal year) ended [A-Za-z]+ \d+,?\s*(\d{4})/gi)];
    if (allFYMatches.length > 0) {
      const mostRecent = allFYMatches.map(m => parseInt(m[1])).sort((a,b) => b-a)[0];
      return `FY${mostRecent}`;
    }
    // Indian "year ended 31.03.2026"
    const indFY = text.match(/year ended\s+31[./]0?3[./](20\d{2})/i);
    if (indFY) return `FY${indFY[1]}`;
    // All "year ended MONTH YEAR" matches → pick most recent
    const allYearEnded = [...text.matchAll(/year ended [A-Za-z]+ \d+,?\s*(\d{4})/gi)];
    if (allYearEnded.length > 0) {
      const mostRecent = allYearEnded.map(m => parseInt(m[1])).sort((a,b) => b-a)[0];
      return `FY${mostRecent}`;
    }
    const q = text.match(/(?:three months|quarter) ended [A-Za-z]+ \d+,?\s*(\d{4})/i);
    if (q) return `Q${q[1]}`;
    const indQ = text.match(/\b(Q[1-4])\s*[-–]?\s*(?:FY\s*)?(\d{2,4})\b/i);
    if (indQ) return `${indQ[1].toUpperCase()}FY${indQ[2]}`;
    // Most recent year in first 3000 chars
    const firstYears = (text.slice(0, 3000).match(/\b(20\d{2})\b/g) || []).map(Number).sort((a,b)=>b-a);
    return firstYears.length > 0 ? `FY${firstYears[0]}` : 'Latest';
  })();

  const company = (() => {
    // FIX: SEC 10-K — company name appears BEFORE "(Exact name of Registrant...)", not after
    const secBefore = text.match(/([^\n]{5,80})\n\(Exact name of Registrant[^)]*\)/);
    if (secBefore) return secBefore[1].trim();
    // Fallback: after (rare alternative layout)
    const secAfter = text.match(/\(Exact name of Registrant[^)]*\)\s*\n([^\n]{5,80})/);
    if (secAfter) {
      const candidate = secAfter[1].trim();
      // Reject if it looks like state/EIN info "Delaware 33-0885351"
      if (!/^\w{2,}\s+\d{2}-\d{6,}/.test(candidate)) return candidate;
    }
    // Indian format: look for ALL-CAPS company name with corporate suffix
    const indName = text.match(/^([A-Z][A-Z\s&.]{5,}(?:LIMITED|LTD|PRIVATE|INDUSTRIES|SOLUTIONS|TECHNOLOGIES|SERVICES|SYSTEMS))\s*$/m);
    if (indName) return indName[1].trim();
    // Generic: first line with corporate suffix near top of document
    const lines = text.split('\n').slice(0, 25).map(l => l.trim());
    for (const l of lines) {
      if (/(?:Inc\.|Corp\.|Ltd\.|Limited|LLC|plc|Holdings|Systems|Technologies|Pharma|Energy|Industries)\b/i.test(l) && l.length > 5 && l.length < 90 && !/^\(|^[\d-]/.test(l)) return l;
    }
    return 'Unknown Company';
  })();

  const ticker = text.match(/Trading\s+Symbol[^\n]*\n\s*([A-Z]{1,6})\b/)?.[1] || '';

  // ── P&L — uses curIdx/priorIdx throughout ─────────────────────────────────────

  // FIX: pass factor to findRevenue so it can apply plausibility check
  const { cur: rawRevCur, prior: rawRevPrior } = findRevenue(rows, curIdx, priorIdx, factor);
  const revenue = sc(rawRevCur);
  const revPrior = sc(rawRevPrior);

  const rawGross = fm(['gross profit', 'total gross profit', 'gross profit$']);
  const grossProfit = sc(rawGross);
  // Gross margin: try stated %, then compute from scaled GP/Rev
  const grossMarginStated = fm(['gaap gross margin', 'gross margin', 'gross profit %', 'gross profit margin']);
  const grossMargin = (grossMarginStated && Math.abs(grossMarginStated) <= 100) ? grossMarginStated :
    (grossProfit && revenue && revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : null);

  const rawDA = fm(['depreciation and amortization', 'depreciation.*amortization', 'depreciation expense',
                    'depreciation$', 'da$']);
  const da = sc(rawDA);

  const rawEBIT = fm(['income from operations', 'loss from operations', 'income.*operations$',
                      'loss.*operations$', 'operating income$', 'ebit$', 'total operating.*income']);
  const ebit = sc(rawEBIT);
  const ebitMargin = ebit && revenue && revenue > 0 ? Math.round((ebit / revenue) * 10000) / 100 : null;

  // Adjusted EBITDA preferred over GAAP EBITDA if available
  let ebitda = sc(fm(['adjusted ebitda', 'total adjusted ebitda'])) ?? sc(fm(['ebitda$']));
  if (!ebitda && ebit !== null && da !== null) ebitda = Math.round((ebit + Math.abs(da)) * 1000) / 1000;
  const ebitdaMargin = ebitda && revenue && revenue > 0 ? Math.round((ebitda / revenue) * 10000) / 100 : null;

  const opex = sc(fm(['total operating expenses', 'total opex', 'total expenses']));
  const rnd = sc(fm(['research and development', 'r&d expense', 'r&d$']));
  const sga = sc(fm(['selling.*general.*admin', 'general.*administrative', 'sg&a$',
                     'selling.*marketing', 'sales and marketing', 'sales.*marketing']));
  const interestExpense = sc(fm(['interest expense', 'finance costs', 'interest cost', 'borrowing cost']));
  const otherIncome = sc(fm(['other income', 'other income.*net', 'non-operating income']));
  const pbt = sc(fm(['income.*before.*tax', 'loss.*before.*tax', 'profit before.*tax', 'pbt$',
                     'earnings before.*tax', 'profit.*loss.*before.*tax']));
  const tax = sc(fm(['provision for income tax', 'income tax.*expense', 'tax expense$',
                     'income tax expense.*benefit', 'tax expense:']));

  const rawPAT = fm(['net income$', 'net loss$', 'net income.*loss', 'net profit$', 'pat$',
                     'profit after tax', 'profit.*loss.*for.*period', 'profit.*loss.*for.*year',
                     'net loss$', 'profit.*period.*company']);
  const pat = sc(rawPAT);
  const rawPriorPAT = fmp(['net income', 'net loss', 'net profit', 'pat$', 'profit.*period']);
  const patPrior = sc(rawPriorPAT);
  const patMargin = pat && revenue && revenue > 0 ? Math.round((pat / revenue) * 10000) / 100 : null;

  // EPS — does NOT get scaled (it's per-share, not in millions)
  // Use curIdx to select correct column
  const epsRow = rows.find(r => /net.*loss.*per.*share|net.*income.*per.*share|basic.*eps|diluted.*eps|loss.*per.*share|^eps$/.test(r.label));
  const eps = epsRow?.nums[curIdx] ?? epsRow?.nums[0] ?? null;
  const epsPrior = epsRow ? (epsRow.nums[priorIdx] ?? epsRow.nums[Math.min(1, epsRow.nums.length-1)] ?? null) : null;

  // Discontinued
  const { detected: continuingOpsDetected, discontinuedIncome: rawDiscInc } = detectDiscontinued(text);
  const discontinuedIncome = sc(rawDiscInc);
  const continuingRevenue = revenue;
  const continuingPAT = discontinuedIncome !== null && pat !== null ? pat - discontinuedIncome : pat;

  // Balance Sheet — use curIdx where available; BS is usually in single-period or latest column
  const bsIdx = Math.min(curIdx, 1); // Balance sheet tables sometimes only have 2 columns
  const fmbs = (patterns: string[]) => findMetric(rows, patterns, bsIdx);

  const cash = sc(fmbs(['cash and cash equivalents', 'cash.*equivalents$', 'cash and short', 'cash equivalents$']));
  const totalDebt = sc(fmbs(['total borrowings', 'total debt$', 'total indebtedness',
                              'long.*term.*debt.*current', 'long-term debt']));
  const equity = sc(fmbs(["total stockholders.*equity", "total shareholders.*equity", "total equity$",
                           "net worth$", "stockholders equity", "total.*equity"]));
  const totalAssets = sc(fmbs(['total assets$']));
  const netDebt = totalDebt !== null && cash !== null ? Math.round((totalDebt - cash) * 1000) / 1000 : null;

  // Cash flow and capex use curIdx (quarterly CF tables)
  const capex = sc(fm(['capital expenditures', 'capex$', 'purchase.*property.*plant',
                        'purchase.*fixed assets', 'purchases of property']));
  const ar = sc(fmbs(['accounts receivable', 'trade receivable', 'debtors$']));
  const inventory = sc(fmbs(['^inventory$', '^inventories$', 'stock in trade', 'inventories$']));

  // CFO: direct lookup first, then from cash flow page
  const cfo = sc(fm(['net cash provided by.*operating', 'net cash used in.*operating', 'net cash.*operating',
                      'cash provided by.*operating', 'net cash inflow.*operations']));

  // FCF: direct if available, else compute
  const fcfDirect = sc(fm(['free cash flow$', 'free cash flow']));
  const fcf = fcfDirect ?? (cfo !== null && capex !== null ? Math.round((cfo - Math.abs(capex)) * 1000) / 1000 : null);

  // Computed ratios
  const deRatio = totalDebt !== null && equity && equity > 0 ? Math.round((totalDebt / equity) * 100) / 100 : null;
  const cfoPat = cfo !== null && pat !== null && pat !== 0 ? Math.round((cfo / pat) * 100) / 100 : null;
  const roce = ebit && equity && equity > 0 ? Math.round((ebit / equity) * 10000) / 100 : null;
  const roe = pat && equity && equity > 0 ? Math.round((pat / equity) * 10000) / 100 : null;
  const roa = pat && totalAssets && totalAssets > 0 ? Math.round((pat / totalAssets) * 10000) / 100 : null;

  const orderBook = sc(findMetric(rows, ['order book$', 'order backlog$', 'backlog$']));
  const backlog = orderBook;
  const headcountMatch = rawText.match(/(\d[\d,]+)\s*(?:employees|full-time|FTEs)/i);
  const headcount = headcountMatch ? parseFloat(headcountMatch[1].replace(/,/g, '')) : null;

  // Narrative
  const themes = detectNarrativeThemes(text);
  const { guidance, keyMetrics, forwardStatements, mgmtTone } = extractManagementText(text);

  // ── STEP: Build result object ──────────────────────────────────────────────
  const result: Partial<RawFinancials> = {
    company, ticker, period, periodType: 'annual', filingType, currency, scaleLabel, scaleFactor: factor,
    revenue, revPrior, grossProfit, grossMargin,
    ebitda, ebitdaMargin, opex, ebit, ebitMargin,
    interestExpense, pbt, tax, pat, patPrior, patMargin,
    eps, epsPrior, rnd, sga, da, otherIncome,
    discontinuedIncome, continuingRevenue, continuingPAT, continuingOpsDetected,
    cash, totalDebt, equity, totalAssets, netDebt, capex, ar, inventory,
    cfo, fcf, deRatio, cfoPat, roce, roe, roa,
    orderBook, backlog, headcount,
    guidance, keyMetrics, forwardStatements, themes, mgmtTone,
  };

  // ── STEP: SANITIZATION FIREWALL — nullify impossible values ────────────────
  const sanitizationIssues = sanitizeMetrics(result);

  // ── STEP: Soft validation warnings ────────────────────────────────────────
  const softWarnings = validateFinancials(result, rows);
  if (!textScale) {
    softWarnings.push(`Scale inferred (column ${curIdx}/${colCount} · ${colReason}) — verify numbers manually`);
  }

  const allWarnings = [...sanitizationIssues, ...softWarnings];

  // ── STEP: PIPELINE STATE — determine what the UI is allowed to render ──────
  // This is the critical gate. We look at whether key financial fields are valid
  // AFTER sanitization, and assign one of three states.
  const r = result as RawFinancials;
  const revenueValid = r.revenue !== null && r.revenue > 0;
  const grossMarginValid = r.grossMargin !== null; // null = was sanitized
  const patValid = r.pat !== null;
  const coreFailed = sanitizationIssues.filter(s => s.includes('extraction failed') || s.includes('Revenue near-zero')).length > 0;

  let parseState: RawFinancials['parseState'];
  let parseConfidence: number;

  if (coreFailed || !revenueValid) {
    // Revenue missing or core extraction failure → nothing can be trusted
    parseState = 'failed';
    parseConfidence = 10;
  } else if (sanitizationIssues.length > 2 || (!grossMarginValid && !patValid)) {
    // Revenue found but multiple key metrics were nullified
    parseState = 'partial';
    parseConfidence = 45;
  } else if (sanitizationIssues.length === 0 && textScale !== null) {
    // Explicit scale declaration + no hard failures = highest confidence
    parseState = 'verified';
    parseConfidence = 90;
  } else if (sanitizationIssues.length === 0) {
    // Scale inferred but no failures
    parseState = 'verified';
    parseConfidence = 70;
  } else {
    parseState = 'partial';
    parseConfidence = 55;
  }

  // What source did revenue come from (for display)
  const revenueSource = revenueValid
    ? (rawRevCur && rawRevCur > 30000000 ? 'unlabeled_or_absolute' : 'labeled_row')
    : 'not_found';

  return {
    ...(result as RawFinancials),
    validationWarnings: allWarnings,
    hardFailures: sanitizationIssues,
    isDataReliable: parseState !== 'failed',
    parseState,
    parseConfidence,
    revenueSource,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// THREE-ENGINE SCORING SYSTEM
// Engine 1: Accounting Quality  — for long-term fundamental investors
// Engine 2: Earnings Reaction   — for event-driven / short-term traders
// Engine 3: Narrative Score     — thematic / momentum premium
// ═════════════════════════════════════════════════════════════════════════════

interface EngineOutput {
  score: number;          // 0–100
  grade: string;          // A+/A/B/C/D
  color: string;
  label: string;          // Short label
  signals: { type: 'green'|'red'|'amber'|'neutral'; text: string; weight: number }[];
  summary: string;        // 1-sentence verdict
}

// ── ENGINE 1: ACCOUNTING QUALITY ─────────────────────────────────────────────

// ── DATA QUALITY GATE: Returns a failure output when data is too unreliable to score ──
function dataQualityFail(label: string, reason?: string): EngineOutput {
  return {
    score: 0, grade: 'N/A', color: MUTED, label,
    signals: [{ type:'amber', text: reason || 'Parse state FAILED — revenue or key metrics could not be extracted. Scores require validated numbers.', weight:0 }],
    summary: 'Cannot score — extraction validation failed.',
  };
}

/** Count how many key financial metrics are actually available (non-null) */
function countValidMetrics(d: RawFinancials): number {
  return [d.revenue, d.grossMargin, d.pat, d.ebit, d.cfo].filter(v => v !== null).length;
}

function scoreAccountingQuality(d: RawFinancials): EngineOutput {
  // GATE 1: Parse state determines whether scoring is allowed at all
  if (d.parseState === 'failed') {
    return dataQualityFail('Accounting Quality', `Parse state: FAILED (confidence ${d.parseConfidence}%) — revenue extraction failed, no scores generated`);
  }
  // GATE 2: Not enough valid metrics even in 'partial' state
  if (countValidMetrics(d) < 2) {
    return dataQualityFail('Accounting Quality');
  }

  const sigs: EngineOutput['signals'] = [];
  // Recalibrated: start at 40 (not 50) — quality must be earned
  let score = 40;

  // Gross margin — only score if within valid range (firewall already nullified impossible values)
  if (d.grossMargin !== null) {
    if (d.grossMargin >= 50)      { sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}% — premium pricing power`, weight:8 }); score+=8; }
    else if (d.grossMargin >= 30) { sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}% — healthy`, weight:4 }); score+=4; }
    else if (d.grossMargin < 10)  { sigs.push({ type:'red',   text:`Gross margin ${d.grossMargin.toFixed(1)}% — extremely thin`, weight:7 }); score-=7; }
  }

  // EBITDA margin
  if (d.ebitdaMargin !== null) {
    if (d.ebitdaMargin >= 25)    { sigs.push({ type:'green',  text:`EBITDA margin ${d.ebitdaMargin.toFixed(1)}% — strong`, weight:5 }); score+=5; }
    else if (d.ebitdaMargin >= 10){ sigs.push({ type:'green',  text:`EBITDA margin ${d.ebitdaMargin.toFixed(1)}%`, weight:3 }); score+=3; }
    else if (d.ebitdaMargin < 0) { sigs.push({ type:'red',    text:`Negative EBITDA ${d.ebitdaMargin.toFixed(1)}%`, weight:8 }); score-=8; }
  }

  // Leverage
  if (d.deRatio !== null) {
    if (d.deRatio <= 0.1)      { sigs.push({ type:'green', text:`Virtually debt-free D/E=${d.deRatio.toFixed(2)}x`, weight:8 }); score+=8; }
    else if (d.deRatio <= 0.5) { sigs.push({ type:'green', text:`Conservative leverage D/E=${d.deRatio.toFixed(2)}x`, weight:4 }); score+=4; }
    else if (d.deRatio > 2.0)  { sigs.push({ type:'red',   text:`High leverage D/E=${d.deRatio.toFixed(2)}x`, weight:7 }); score-=7; }
  }

  if (d.cash !== null && d.totalDebt !== null && d.cash > d.totalDebt) {
    sigs.push({ type:'green', text:'Net cash — cash exceeds total debt', weight:6 }); score+=6;
  }

  // Cash conversion — only if pat is valid
  if (d.cfoPat !== null && d.pat !== null && d.pat > 0) {
    if (d.cfoPat >= 1.0)      { sigs.push({ type:'green',  text:`Excellent cash conversion CFO/PAT=${d.cfoPat.toFixed(2)}x`, weight:8 }); score+=8; }
    else if (d.cfoPat >= 0.6) { sigs.push({ type:'green',  text:`Good cash conversion CFO/PAT=${d.cfoPat.toFixed(2)}x`, weight:4 }); score+=4; }
    else if (d.cfoPat < 0.3)  { sigs.push({ type:'red',    text:`Low cash conversion CFO/PAT=${d.cfoPat.toFixed(2)}x`, weight:6 }); score-=6; }
  } else if (d.cfo !== null && d.cfo < 0 && d.pat !== null) {
    sigs.push({ type:'red', text:'Negative operating cash flow', weight:7 }); score-=7;
  }

  // FCF
  if (d.fcf !== null) {
    if (d.fcf > 0) { sigs.push({ type:'green', text:`FCF positive`, weight:4 }); score+=4; }
    else { sigs.push({ type:'amber', text:`FCF negative (may reflect investment phase)`, weight:2 }); score-=2; }
  }

  // Returns — only if validated
  if (d.roce !== null && d.roce >= 20) { sigs.push({ type:'green', text:`ROCE ${d.roce.toFixed(1)}% — above cost of capital`, weight:5 }); score+=5; }
  if (d.roe !== null && d.roe >= 15)   { sigs.push({ type:'green', text:`ROE ${d.roe.toFixed(1)}%`, weight:3 }); score+=3; }

  // Penalise if operating loss
  if (d.ebit !== null && d.ebit < 0) { score -= 8; }

  // Data quality caveat
  if (!d.isDataReliable) {
    sigs.push({ type:'amber', text:'⚠ Some extraction inconsistencies detected — treat scores as indicative', weight:0 });
    score = Math.min(score, 65); // Hard cap when uncertain
  }

  // Recalibrated cap: max 88 (not 95) — 90+ should be extremely rare
  score = Math.max(5, Math.min(88, score));
  const grade = score >= 78 ? 'A+' : score >= 68 ? 'A' : score >= 58 ? 'B+' : score >= 46 ? 'B' : score >= 33 ? 'C' : 'D';
  const col = score >= 68 ? '#10b981' : score >= 53 ? '#f59e0b' : score >= 33 ? '#f97316' : '#ef4444';
  return {
    score, grade, color: col, label: 'Accounting Quality', signals: sigs,
    summary: score >= 70 ? 'Solid balance sheet and cash quality' : score >= 50 ? 'Moderate quality — monitor leverage and cash' : 'Quality concerns — dig into balance sheet',
  };
}

// ── ENGINE 2: EARNINGS REACTION PROBABILITY ───────────────────────────────────
// Measures surprise vs expectations, inflection, guidance, narrative, positioning.
// RECALIBRATED: scores are deliberately conservative. 80+ = genuine strong setup.

function scoreEarningsReaction(d: RawFinancials): EngineOutput {
  // GATE: parseState controls whether reaction scoring is allowed
  if (d.parseState === 'failed') return dataQualityFail('Earnings Reaction', `Parse state FAILED — no reaction score without valid revenue`);
  if (!d.revenue || d.revenue <= 0) return dataQualityFail('Earnings Reaction', 'Revenue not extracted — cannot compute reaction probability');

  const sigs: EngineOutput['signals'] = [];
  // Start at 30 (not 40) — reaction probability is harder to earn
  let score = 30;

  // ── Revenue Acceleration ────────────────────────────────────────────────
  if (d.revenue && d.revPrior && d.revPrior > 0) {
    const g = ((d.revenue - d.revPrior) / d.revPrior) * 100;
    if (g >= 40)       { sigs.push({ type:'green', text:`Revenue acceleration +${g.toFixed(1)}% YoY`, weight:15 }); score+=15; }
    else if (g >= 20)  { sigs.push({ type:'green', text:`Revenue growth +${g.toFixed(1)}% YoY — meaningful`, weight:10 }); score+=10; }
    else if (g >= 10)  { sigs.push({ type:'green', text:`Revenue growth +${g.toFixed(1)}% YoY`, weight:5 }); score+=5; }
    else if (g < 0)    { sigs.push({ type:'red',   text:`Revenue decline ${g.toFixed(1)}% YoY — negative catalyst`, weight:12 }); score-=12; }
    else if (g < 5)    { sigs.push({ type:'amber', text:`Slow revenue growth +${g.toFixed(1)}% — weak catalyst`, weight:4 }); score-=4; }
  }

  // ── MARGIN INFLECTION — powerful catalyst (only use validated margins) ────
  if (d.grossMargin !== null) {
    if (d.grossMargin >= 50)      { sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}% — premium level`, weight:12 }); score+=12; }
    else if (d.grossMargin >= 35) { sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}%`, weight:7 }); score+=7; }
    else if (d.grossMargin >= 20) { sigs.push({ type:'amber', text:`Gross margin ${d.grossMargin.toFixed(1)}% — moderate`, weight:3 }); score+=3; }
    else if (d.grossMargin < 10)  { sigs.push({ type:'red',   text:`Gross margin ${d.grossMargin.toFixed(1)}% — thin`, weight:5 }); score-=5; }
  }
  if (d.ebitdaMargin !== null && d.ebitdaMargin > 0) {
    sigs.push({ type:'green', text:`Positive EBITDA margin ${d.ebitdaMargin.toFixed(1)}%`, weight:7 }); score+=7;
  } else if (d.ebitdaMargin !== null && d.ebitdaMargin < 0 && d.ebitdaMargin > -5) {
    sigs.push({ type:'amber', text:`Near-breakeven EBITDA — path to profitability`, weight:4 }); score+=4;
  }

  // ── GUIDANCE / FORWARD SIGNALS ─────────────────────────────────────────
  const guidanceText = [...d.guidance, ...d.forwardStatements].join(' ').toLowerCase();
  if (/(?:pipeline|billion|contract|backlog)\s+(?:in excess of|exceeds?|of\s+over)\s+[\$₹]?\d/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Quantified large pipeline — strong forward catalyst', weight:15 }); score+=15;
  } else if (/pipeline|backlog|order book|rpm|rpo|arr/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Pipeline/backlog commentary — positive forward signal', weight:7 }); score+=7;
  }
  if (/raised guidance|raised.*outlook|above guidance|ahead of guidance|reaffirm.*growth|raised.*full year/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Guidance raised or reaffirmed', weight:12 }); score+=12;
  }
  if (/positive.*ebitda|positive adjusted ebitda|first time.*positive|milestone.*profit|adjusted.*profitable/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Profitability milestone — inflection catalyst', weight:10 }); score+=10;
  }

  // ── MANAGEMENT TONE ─────────────────────────────────────────────────────
  if (d.mgmtTone === 'bullish')   { sigs.push({ type:'green',  text:'Management tone: confident/bullish', weight:5 }); score+=5; }
  else if (d.mgmtTone === 'cautious') { sigs.push({ type:'amber', text:'Management tone: cautious/hedged', weight:3 }); score-=3; }

  // ── NARRATIVE THEMES ────────────────────────────────────────────────────
  const hotThemes = d.themes.filter(t => ['AI_INFRA','EDGE_COMPUTE','CDN_EDGE','DEFENSE','DEFENSE_AI'].includes(t));
  if (hotThemes.length >= 2) {
    sigs.push({ type:'green', text:`${hotThemes.length} premium themes — AI/Defense/Edge narrative`, weight:10 }); score+=10;
  } else if (hotThemes.length === 1) {
    const tName = NARRATIVE_THEMES.find(n => n.tag === hotThemes[0])?.label ?? hotThemes[0];
    sigs.push({ type:'green', text:`Theme exposure: ${tName}`, weight:5 }); score+=5;
  }

  // ── PAT TRAJECTORY ────────────────────────────────────────────────────
  if (d.pat !== null && d.patPrior !== null && d.patPrior !== 0 && d.pat !== null) {
    const pg = ((d.pat - d.patPrior) / Math.abs(d.patPrior)) * 100;
    if (d.pat > 0 && d.patPrior < 0) { sigs.push({ type:'green', text:'Loss → profit inflection — strong catalyst', weight:12 }); score+=12; }
    else if (pg >= 50 && d.pat > 0) { sigs.push({ type:'green', text:`Profit up +${pg.toFixed(0)}% YoY`, weight:7 }); score+=7; }
    else if (pg < -50) { sigs.push({ type:'red', text:`Profit down ${pg.toFixed(0)}% YoY`, weight:8 }); score-=8; }
  }

  // ── DISCONTINUED OPS — only if genuinely confirmed ─────────────────────
  if (d.continuingOpsDetected) {
    sigs.push({ type:'neutral', text:'Discontinued ops flag — verify source before trading on this', weight:0 });
  }

  // Recalibrated: max 85 — true 90+ reactions are rare
  score = Math.max(8, Math.min(85, score));
  const grade = score >= 75 ? 'A+' : score >= 63 ? 'A' : score >= 50 ? 'B+' : score >= 35 ? 'B' : 'C';
  const col = score >= 63 ? '#10b981' : score >= 48 ? '#f59e0b' : score >= 33 ? '#f97316' : '#ef4444';
  return {
    score, grade, color: col,
    label: 'Earnings Reaction',
    signals: sigs,
    summary: score >= 68
      ? 'Strong reaction setup — revenue acceleration + margin + narrative'
      : score >= 50
      ? 'Moderate reaction potential — mixed catalysts'
      : 'Weak reaction probability — limited surprise or catalysts',
  };
}

// ── ENGINE 3: NARRATIVE / THEMATIC SCORE ─────────────────────────────────────
// Theme confidence tiers:
//   CORE (80-95%): multiple specific keywords, clearly central to business
//   ADJACENT (40-70%): present but not core business
//   WEAK (<40%): incidental mention — shown as context, not scored
//
// Score max 80 — a narrative score of 90+ should require 3+ confirmed hot themes

interface ThemeDetection { theme: typeof NARRATIVE_THEMES[0]; confidence: number; tier: 'core'|'adjacent'|'weak' }

function scoreNarrative(d: RawFinancials): EngineOutput & { themeList: typeof NARRATIVE_THEMES; themeDetections: ThemeDetection[] } {
  const sigs: EngineOutput['signals'] = [];
  let score = 10; // Must earn it — start lower

  // Build theme detections with confidence scores
  const themeDetections: ThemeDetection[] = [];
  for (const theme of NARRATIVE_THEMES) {
    const minMatch = THEME_MIN_MATCHES[theme.tag] ?? 1;
    const matchCount = theme.keywords.filter(kw => d.themes.includes(theme.tag) ? true : false).length;
    // Use the already-computed themes list — just assign confidence based on which tag matched
    if (!d.themes.includes(theme.tag)) continue;
    // Confidence = based on theme type and how specific the keywords are
    const HOT_TAGS = new Set(['AI_INFRA','EDGE_COMPUTE','CDN_EDGE','DEFENSE','DEFENSE_AI']);
    const isHot = HOT_TAGS.has(theme.tag);
    // Conservative confidence: hot themes with specific keyword matches = 75%, others = 50%
    const confidence = isHot ? 75 : 50;
    const tier: ThemeDetection['tier'] = confidence >= 70 ? 'core' : confidence >= 40 ? 'adjacent' : 'weak';
    themeDetections.push({ theme, confidence, tier });
  }

  const coreThemes = themeDetections.filter(t => t.tier === 'core');
  const adjThemes = themeDetections.filter(t => t.tier === 'adjacent');

  if (coreThemes.length >= 3) {
    sigs.push({ type:'green', text:`${coreThemes.length} core themes — strong thematic identity`, weight:25 }); score+=25;
  } else if (coreThemes.length >= 2) {
    sigs.push({ type:'green', text:`${coreThemes.length} core themes`, weight:15 }); score+=15;
  } else if (coreThemes.length >= 1) {
    sigs.push({ type:'green', text:`1 core theme: ${coreThemes[0].theme.label}`, weight:8 }); score+=8;
  }

  if (adjThemes.length >= 1) {
    sigs.push({ type:'neutral', text:`${adjThemes.length} adjacent theme(s) — peripheral exposure`, weight:3 });
    score+=3;
  }

  // Pipeline/TAM — only score if there's a specific quantification
  if (d.guidance.some(g => /(?:billion|multi-billion|\$[1-9]\d*b|billion dollar)\s+(?:opportunity|market|pipeline|tam)/.test(g.toLowerCase()))) {
    sigs.push({ type:'green', text:'Billion-dollar TAM or pipeline referenced', weight:8 }); score+=8;
  }

  // Penalise for having ZERO themes (company in un-exciting sector)
  if (coreThemes.length === 0 && adjThemes.length === 0) {
    sigs.push({ type:'neutral', text:'No premium thematic narrative detected — sector/timing may limit multiple expansion', weight:0 });
  }

  // RECALIBRATED: max 80 (not 95) — 90+ only for genuine 3-theme AI/defense/edge plays
  score = Math.max(5, Math.min(80, score));
  const grade = score >= 65 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D';
  const col = score >= 65 ? '#a78bfa' : score >= 50 ? '#818cf8' : score >= 30 ? '#6366f1' : '#4338ca';
  const allFound = themeDetections.map(t => t.theme);
  return {
    score, grade, color: col,
    label: 'Narrative / Theme',
    signals: sigs,
    summary: coreThemes.length >= 2
      ? `Core: ${coreThemes.slice(0,2).map(t=>t.theme.label).join(', ')}`
      : coreThemes.length === 1
      ? `Theme: ${coreThemes[0].theme.label}`
      : 'No strong thematic premium',
    themeList: allFound,
    themeDetections,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// DISPLAY HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function n(v: number|null, d: RawFinancials, decimals = 1): string {
  if (v === null) return '—';
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 1000) s = `${(v/1000).toFixed(1)}K`;
  else if (abs >= 1) s = v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  else s = v.toFixed(3);
  const sym = d.currency === 'USD' ? '$' : d.currency === 'INR' ? '₹' : '';
  const unit = d.scaleLabel.includes('Cr') ? ' Cr' : d.scaleLabel.includes('Mn') ? ' Mn' : '';
  return v < 0 ? `(${sym}${s}${unit})` : `${sym}${s}${unit}`;
}
function pct(v: number|null): string { return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`; }
function growth(cur: number|null, prior: number|null): { text: string; col: string }|null {
  if (cur === null || prior === null || prior === 0) return null;
  const g = ((cur - prior) / Math.abs(prior)) * 100;
  return { text: `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`, col: g >= 0 ? GREEN : RED };
}
function mColor(v: number|null, good: number, ok: number): string {
  if (v === null) return MUTED;
  return v >= good ? GREEN : v >= ok ? YELLOW : RED;
}
const HISTORY_KEY2 = 'ea_v3_history';
interface HistEntry2 { id: string; company: string; period: string; q: number; r: number; n: number; color: string; summary: string; at: string; }
function loadHist2(): HistEntry2[] { try { return JSON.parse(localStorage.getItem(HISTORY_KEY2)||'[]'); } catch { return []; } }
function saveHist2(e: HistEntry2[]) { try { localStorage.setItem(HISTORY_KEY2, JSON.stringify(e.slice(0,20))); } catch {} }

// ═════════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function EarningsAnalysisPage() {
  const AV_KEY = '62EKUKC2M5WSZB9Z';

  // Alpha Vantage — ONLY used for consensus estimates and EPS surprise history.
  // Market data (market cap, P/E, etc.) deliberately excluded — user wants actuals from report.
  interface AVData {
    symbol: string; name: string; sector: string; industry: string;
    // Consensus estimates only
    epsEstNextQ: number|null;       // Next quarter EPS estimate
    epsEstCurrentYear: number|null; // Full year EPS estimate
    revenueEstNextQ: number|null;   // Next quarter revenue estimate (not always available)
    analystTargetPrice: number|null;
    // EPS surprise track record (last 8 quarters)
    quarterlyEarnings: {
      fiscalDateEnding: string;
      reportedEPS: number|null;
      estimatedEPS: number|null;
      surprise: number|null;
      surprisePct: number|null;
    }[];
  }
  const [avData, setAvData] = useState<AVData|null>(null);
  const [avLoading, setAvLoading] = useState(false);
  const [avTicker, setAvTicker] = useState('');
  // Manual estimate overrides (user can type these if AV doesn't have them)
  const [manualRevEst, setManualRevEst] = useState('');
  const [manualGMEst, setManualGMEst] = useState('');
  const [manualGuidance, setManualGuidance] = useState('');

  async function fetchAVData(ticker: string) {
    if (!ticker.trim()) return;
    setAvLoading(true);
    try {
      // Only fetch EARNINGS — not OVERVIEW (which has all the market data we don't want)
      const [earRes, ovRes] = await Promise.allSettled([
        fetch(`https://www.alphavantage.co/query?function=EARNINGS&symbol=${encodeURIComponent(ticker.toUpperCase())}&apikey=${AV_KEY}`),
        fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(ticker.toUpperCase())}&apikey=${AV_KEY}`),
      ]);
      const ear = earRes.status === 'fulfilled' && earRes.value.ok ? await earRes.value.json() : {};
      const ov  = ovRes.status  === 'fulfilled' && ovRes.value.ok  ? await ovRes.value.json()  : {};

      const quarterly = (ear.quarterlyEarnings || []).slice(0, 8).map((q: any) => ({
        fiscalDateEnding: q.fiscalDateEnding || '',
        reportedEPS:  parseFloat(q.reportedEPS)       || null,
        estimatedEPS: parseFloat(q.estimatedEPS)      || null,
        surprise:     parseFloat(q.surprise)           || null,
        surprisePct:  parseFloat(q.surprisePercentage) || null,
      }));

      setAvData({
        symbol: ticker.toUpperCase(),
        name: ov.Name || '',
        sector: ov.Sector || '',
        industry: ov.Industry || '',
        // Estimates — this is the ONLY thing we pull from AV besides surprise history
        epsEstNextQ:         parseFloat(ov.EPSEstimateNextQuarter)   || null,
        epsEstCurrentYear:   parseFloat(ov.EPSEstimateCurrentYear)   || null,
        revenueEstNextQ:     parseFloat(ov.RevenueEstimateNextQuarter) || null,
        analystTargetPrice:  parseFloat(ov.AnalystTargetPrice) || null,
        quarterlyEarnings: quarterly,
      });
    } catch (e) {
      console.error('Alpha Vantage fetch failed:', e);
    }
    setAvLoading(false);
  }

  const [mode, setMode] = useState<'upload'|'paste'|'url'>('upload');
  const [pasteText, setPasteText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [result, setResult] = useState<{ d: RawFinancials; q: EngineOutput; r: EngineOutput; nar: ReturnType<typeof scoreNarrative> }|null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPct, setLoadingPct] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistEntry2[]>(() => loadHist2());
  const [expandedSignals, setExpandedSignals] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const process = useCallback((text: string) => {
    setError('');
    if (!text.trim()) { setError('No text to analyze.'); return; }
    setLoadingMsg('Running extraction engine…');
    setTimeout(() => {
      try {
        const d = parseEarnings(text);
        const q = scoreAccountingQuality(d);
        const r = scoreEarningsReaction(d);
        const nar = scoreNarrative(d);
        setResult({ d, q, r, nar });
        const entry: HistEntry2 = {
          id: Date.now().toString(), company: d.company, period: d.period,
          q: q.score, r: r.score, n: nar.score,
          color: r.color, summary: r.summary, at: new Date().toISOString(),
        };
        const upd = [entry, ...history.filter(h => h.company !== d.company || h.period !== d.period)];
        setHistory(upd); saveHist2(upd);
      } catch (e: any) { setError('Analysis failed: ' + e.message); }
      setLoading(false); setLoadingMsg(''); setLoadingPct(0);
    }, 10);
  }, [history]);

  async function handleFile(files: FileList|null) {
    if (!files?.length) return;
    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase()||'';
    setLoading(true); setError(''); setLoadingPct(0);
    if (ext === 'pdf') {
      const {text, error: e} = await extractPDFText(file, (pct, msg) => { setLoadingPct(pct); setLoadingMsg(msg); });
      if (e || !text.trim()) { setError(e||'No text extracted. Try Paste mode.'); setLoading(false); return; }
      process(text);
    } else if (ext === 'xlsx' || ext === 'xls') {
      setLoadingMsg('Parsing Excel…');
      try {
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, {type:'array'});
        const txt = wb.SheetNames.map(n => `=== ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n');
        process(txt);
      } catch (e:any) { setError('Excel error: '+e.message); setLoading(false); }
    } else {
      setLoadingMsg('Reading…');
      const txt = await file.text().catch(()=>'');
      if (!txt) { setError('Cannot read file.'); setLoading(false); return; }
      process(txt);
    }
  }

  async function handleURL() {
    if (!urlInput.trim()) { setError('Enter a URL'); return; }
    setLoading(true); setError(''); setLoadingPct(0); setLoadingMsg('Fetching…');
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(urlInput.trim())}`, {signal: AbortSignal.timeout(20000)});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type')||'';
      if (ct.includes('pdf')) {
        const blob = await res.blob();
        const f = new File([blob],'report.pdf',{type:'application/pdf'});
        const {text,error:e} = await extractPDFText(f,(pct,msg)=>{setLoadingPct(pct);setLoadingMsg(msg);});
        if (e||!text) throw new Error(e||'Empty PDF');
        process(text);
      } else {
        const html = await res.text();
        const div = document.createElement('div'); div.innerHTML = html;
        process(div.innerText||div.textContent||html.replace(/<[^>]*>/g,' '));
      }
    } catch(e:any) { setError('Fetch failed: '+e.message); setLoading(false); setLoadingMsg(''); }
  }

  const reset = () => { setResult(null); setError(''); setPasteText(''); setUrlInput(''); };

  // ── Loading UI ──────────────────────────────────────────────────────────
  const LoadingUI = () => (
    <div style={{textAlign:'center',padding:'40px 20px'}}>
      <div style={{width:56,height:56,borderRadius:'50%',border:`4px solid #1e293b`,borderTopColor:ACCENT,animation:'spin 0.9s linear infinite',margin:'0 auto 20px'}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:'100%',maxWidth:360,height:6,backgroundColor:'#1e293b',borderRadius:3,overflow:'hidden',margin:'0 auto 12px'}}>
        <div style={{height:'100%',width:`${loadingPct}%`,background:`linear-gradient(90deg,${ACCENT},${PURPLE})`,borderRadius:3,transition:'width 0.3s'}}/>
      </div>
      <div style={{fontSize:F.md,fontWeight:600,color:ACCENT,marginBottom:4}}>{loadingMsg||'Processing…'}</div>
      {loadingPct > 0 && <div style={{fontSize:10,color:MUTED}}>{loadingPct}%</div>}
    </div>
  );

  // ── Score Wheel (mini) ──────────────────────────────────────────────────
  const ScoreWheel = ({ eng, size=80 }: { eng: EngineOutput; size?: number }) => {
    const r = size/2 - 6;
    const circ = 2*Math.PI*r;
    const dash = (eng.score/100)*circ;
    return (
      <div style={{textAlign:'center',flexShrink:0}}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={5}/>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={eng.color} strokeWidth={5}
            strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`}/>
          <text x={size/2} y={size/2-4} textAnchor="middle" fill={eng.color} fontSize={size*0.22} fontWeight={900}>{eng.score}</text>
          <text x={size/2} y={size/2+10} textAnchor="middle" fill={MUTED} fontSize={size*0.11}>{eng.grade}</text>
        </svg>
        <div style={{fontSize:9,color:MUTED,marginTop:2,fontWeight:600,letterSpacing:'0.3px'}}>{eng.label.toUpperCase()}</div>
      </div>
    );
  };

  // ── Metric Row ──────────────────────────────────────────────────────────
  const MetRow = ({ label, cur, prior, d, isPct, isEps, highlight }: {
    label: string; cur: number|null; prior?: number|null; d: RawFinancials;
    isPct?: boolean; isEps?: boolean; highlight?: boolean;
  }) => {
    if (cur === null && !highlight) return null;
    const gb = prior !== undefined ? growth(cur, prior??null) : null;
    const val = isEps ? (cur !== null ? `${d.currency==='USD'?'$':'₹'}${cur.toFixed(2)}` : '—')
                      : isPct ? `${cur?.toFixed(1)}%` : n(cur, d);
    return (
      <tr style={{backgroundColor: highlight ? 'rgba(56,189,248,0.05)' : 'transparent'}}>
        <td style={{padding:'5px 8px',fontSize:F.xs,color: highlight ? TEXT : MUTED, fontWeight: highlight ? 700 : 400, borderLeft: highlight ? `2px solid ${ACCENT}` : '2px solid transparent'}}>{label}</td>
        <td style={{padding:'5px 8px',fontSize:F.sm,fontWeight: highlight ? 700 : 400,color: cur !== null && cur < 0 ? RED : highlight ? TEXT : MUTED, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>{val}</td>
        <td style={{padding:'5px 8px',textAlign:'right'}}>
          {gb && <span style={{fontSize:10,fontWeight:700,color:gb.col}}>{gb.text}</span>}
        </td>
      </tr>
    );
  };

  // ── Results dashboard ────────────────────────────────────────────────────
  if (result) {
    const { d, q, r, nar } = result;

    // Resolve ticker for AV lookup (use parsed ticker or let user input)
    // Helpers for the earnings scorecard
    const surpriseColor = (pct: number|null) => pct === null ? MUTED : pct >= 5 ? GREEN : pct >= 0 ? '#10b981aa' : pct >= -5 ? YELLOW : RED;
    const beatMissLabel = (actual: number|null, est: number|null): {text:string;col:string}|null => {
      if (actual === null || est === null) return null;
      const delta = actual - est;
      const pct = est !== 0 ? (delta / Math.abs(est)) * 100 : 0;
      if (pct >= 5) return { text: `↑ BEAT +${pct.toFixed(0)}%`, col: GREEN };
      if (pct >= 0) return { text: `↑ MET +${pct.toFixed(1)}%`, col: '#10b981aa' };
      if (pct >= -5) return { text: `↓ MISS ${pct.toFixed(1)}%`, col: YELLOW };
      return { text: `↓ MISS ${pct.toFixed(0)}%`, col: RED };
    };

    // Most recent quarter from AV (for EPS comparison)
    const latestQ = avData?.quarterlyEarnings[0] ?? null;
    const latestEpsEst = latestQ?.estimatedEPS ?? avData?.epsEstNextQ ?? null;
    const latestEpsActual = latestQ?.reportedEPS ?? d.eps ?? null;
    const epsBM = beatMissLabel(latestEpsActual, latestEpsEst);

    // Revenue comparison: actual from parsed report, estimate from manual input
    const revEstNum = manualRevEst ? parseFloat(manualRevEst.replace(/[^0-9.-]/g,'')) : null;
    const gmEstNum = manualGMEst ? parseFloat(manualGMEst.replace(/[^0-9.-]/g,'')) : null;

    return (
      <div style={{background:BG,minHeight:'100vh',color:TEXT,fontFamily:'system-ui,-apple-system,sans-serif',padding:'20px 16px',maxWidth:1200,margin:'0 auto'}}>

        {/* ══════════════════════════════════════════════════════════════════════
            COMPANY IDENTITY + EARNINGS SCORECARD
            Design: company name, ticker, period at top.
            Then: ACTUAL vs ESTIMATE comparison (the hero metric).
            Then: EPS beat/miss track record.
            NO market data grid — user gets all financial data from the report below.
            ══════════════════════════════════════════════════════════════════════ */}
        <div style={{backgroundColor:'#0a0a14',border:`1px solid ${BORDER}`,borderRadius:14,padding:'20px 22px',marginBottom:14,boxShadow:'0 4px 24px rgba(0,0,0,0.4)'}}>

          {/* Company identity + fetch row */}
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:14,flexWrap:'wrap',marginBottom:14}}>
            <div>
              <h1 style={{fontSize:26,fontWeight:900,color:TEXT,margin:'0 0 4px',letterSpacing:'-0.5px'}}>
                {avData?.name || d.company}
              </h1>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                {(avData?.symbol || d.ticker) && (
                  <span style={{fontSize:12,fontWeight:800,color:ACCENT,backgroundColor:ACCENT+'18',padding:'2px 9px',borderRadius:4,letterSpacing:'0.5px'}}>
                    {avData?.symbol || d.ticker}
                  </span>
                )}
                {avData?.sector && <><span style={{fontSize:10,color:MUTED}}>{avData.sector}</span><span style={{color:'#2A3B4C',fontSize:10}}>›</span></>}
                {avData?.industry && <span style={{fontSize:10,color:MUTED}}>{avData.industry}</span>}
                <span style={{fontSize:10,color:'#2A3B4C'}}>·</span>
                <span style={{fontSize:10,color:MUTED}}>{d.period} · {d.filingType} · {d.scaleLabel}</span>
                {avData?.analystTargetPrice && (
                  <span style={{fontSize:10,color:YELLOW}}>🎯 Target ${avData.analystTargetPrice.toFixed(2)}</span>
                )}
              </div>
            </div>
            {/* Compact fetch button */}
            <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
              <input value={avTicker} onChange={e => setAvTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && fetchAVData(avTicker || d.ticker)}
                placeholder={d.ticker || 'Ticker'}
                style={{width:90,backgroundColor:'#0d1117',border:`1px solid ${BORDER}`,borderRadius:6,padding:'5px 8px',color:TEXT,fontSize:11,outline:'none'}}
              />
              <button onClick={() => fetchAVData(avTicker || d.ticker)} disabled={avLoading}
                style={{padding:'5px 12px',backgroundColor:avData?ACCENT+'20':ACCENT,border:avData?`1px solid ${ACCENT}`:' none',borderRadius:6,color:avData?ACCENT:'#000',fontWeight:700,fontSize:11,cursor:'pointer',opacity:avLoading?0.6:1}}
              >
                {avLoading ? '⏳' : avData ? '↻ Re-fetch' : '📡 Fetch estimates'}
              </button>
              <span style={{fontSize:8,color:MUTED}}>Alpha Vantage</span>
            </div>
          </div>

          {/* ── EARNINGS SCORECARD: ACTUAL vs ESTIMATE ── */}
          {/* This is the HERO element — most important comparison in the header */}
          <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:14,marginBottom:14}}>
            <div style={{fontSize:9,fontWeight:800,color:MUTED,letterSpacing:'1px',marginBottom:10}}>
              KEY RESULTS — {d.period} · ACTUAL (from report) vs ESTIMATE (from consensus)
            </div>

            {/* Scorecard table */}
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',minWidth:500}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${BORDER}`}}>
                    {['METRIC','ACTUAL','ESTIMATE','vs EST','vs PRIOR YR'].map(h=>(
                      <th key={h} style={{padding:'4px 10px',fontSize:9,fontWeight:700,color:MUTED,textAlign:h==='METRIC'?'left':'right',letterSpacing:'0.5px'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Revenue row */}
                  {d.parseState !== 'failed' && (
                    <tr style={{borderBottom:`1px solid ${BORDER}20`}}>
                      <td style={{padding:'8px 10px',fontSize:F.xs,color:MUTED,fontWeight:600}}>Revenue</td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontSize:F.sm,fontWeight:900,color:TEXT}}>{n(d.revenue,d)}</td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontSize:F.xs,color:MUTED}}>
                        {revEstNum ? n(revEstNum, d) : <span style={{color:'#334155',fontSize:9}}>enter ↓</span>}
                      </td>
                      <td style={{padding:'8px 10px',textAlign:'right'}}>
                        {revEstNum && d.revenue ? (() => { const bm = beatMissLabel(d.revenue, revEstNum); return bm ? <span style={{fontSize:F.xs,fontWeight:800,color:bm.col}}>{bm.text}</span> : <span style={{color:MUTED}}>—</span>; })() : <span style={{color:'#334155',fontSize:9}}>—</span>}
                      </td>
                      <td style={{padding:'8px 10px',textAlign:'right'}}>
                        {d.revenue && d.revPrior ? (() => { const g = growth(d.revenue, d.revPrior); return g ? <span style={{fontSize:F.xs,fontWeight:700,color:g.col}}>{g.text} YoY</span> : null; })() : <span style={{color:MUTED,fontSize:F.xs}}>—</span>}
                      </td>
                    </tr>
                  )}

                  {/* EPS row */}
                  <tr style={{borderBottom:`1px solid ${BORDER}20`}}>
                    <td style={{padding:'8px 10px',fontSize:F.xs,color:MUTED,fontWeight:600}}>EPS</td>
                    <td style={{padding:'8px 10px',textAlign:'right',fontSize:F.sm,fontWeight:900,color:latestEpsActual!==null&&latestEpsActual>=0?GREEN:latestEpsActual!==null?RED:MUTED}}>
                      {latestEpsActual !== null ? `${latestEpsActual>=0?'$':'($'}${Math.abs(latestEpsActual).toFixed(2)}${latestEpsActual<0?')':''}` : d.eps !== null ? `${d.eps>=0?'$':'($'}${Math.abs(d.eps).toFixed(2)}${d.eps<0?')':''}` : '—'}
                    </td>
                    <td style={{padding:'8px 10px',textAlign:'right',fontSize:F.xs,color:MUTED}}>
                      {latestEpsEst !== null ? `${latestEpsEst>=0?'$':'($'}${Math.abs(latestEpsEst).toFixed(2)}${latestEpsEst<0?')':''}` : '—'}
                    </td>
                    <td style={{padding:'8px 10px',textAlign:'right'}}>
                      {epsBM ? <span style={{fontSize:F.xs,fontWeight:800,color:epsBM.col}}>{epsBM.text}</span> : <span style={{color:MUTED,fontSize:F.xs}}>—</span>}
                    </td>
                    <td style={{padding:'8px 10px',textAlign:'right'}}>
                      {latestQ?.surprisePct !== null && latestQ?.surprisePct !== undefined ? (
                        <span style={{fontSize:F.xs,fontWeight:700,color:surpriseColor(latestQ.surprisePct)}}>
                          {latestQ.surprisePct >= 0 ? '+' : ''}{latestQ.surprisePct.toFixed(1)}% surprise
                        </span>
                      ) : <span style={{color:MUTED,fontSize:F.xs}}>—</span>}
                    </td>
                  </tr>

                  {/* Gross Margin row */}
                  {(d.grossMargin !== null || gmEstNum !== null) && d.parseState !== 'failed' && (
                    <tr style={{borderBottom:`1px solid ${BORDER}20`}}>
                      <td style={{padding:'8px 10px',fontSize:F.xs,color:MUTED,fontWeight:600}}>Gross Margin</td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontSize:F.sm,fontWeight:900,color:TEXT}}>
                        {d.grossMargin !== null ? `${d.grossMargin.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontSize:F.xs,color:MUTED}}>
                        {gmEstNum ? `${gmEstNum.toFixed(1)}%` : <span style={{color:'#334155',fontSize:9}}>enter ↓</span>}
                      </td>
                      <td style={{padding:'8px 10px',textAlign:'right'}}>
                        {gmEstNum && d.grossMargin !== null ? (() => {
                          const delta = d.grossMargin - gmEstNum;
                          const col = delta >= 0 ? GREEN : RED;
                          return <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}pp</span>;
                        })() : <span style={{color:'#334155',fontSize:9}}>—</span>}
                      </td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontSize:F.xs,color:MUTED}}>—</td>
                    </tr>
                  )}

                  {/* Guidance row (manual entry) */}
                  {manualGuidance && (
                    <tr>
                      <td style={{padding:'8px 10px',fontSize:F.xs,color:MUTED,fontWeight:600}}>Guidance</td>
                      <td colSpan={4} style={{padding:'8px 10px',fontSize:F.xs,color:YELLOW}}>{manualGuidance}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Manual estimate inputs */}
            <div style={{marginTop:10,padding:'10px 12px',backgroundColor:'#0d1117',borderRadius:8,border:`1px solid ${BORDER}`}}>
              <div style={{fontSize:9,fontWeight:700,color:MUTED,marginBottom:8}}>
                📝 ADD ESTIMATES — revenue/margin estimates aren't in Alpha Vantage free tier; enter manually from sell-side reports or StreetAccount
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:8,color:MUTED,marginBottom:2}}>Rev est ({d.scaleLabel})</div>
                  <input value={manualRevEst} onChange={e => setManualRevEst(e.target.value)}
                    placeholder={`e.g. ${d.revenue ? (d.revenue * 0.95).toFixed(1) : '—'}`}
                    style={{width:100,backgroundColor:'#111',border:`1px solid ${BORDER}`,borderRadius:5,padding:'4px 8px',color:TEXT,fontSize:11,outline:'none'}}
                  />
                </div>
                <div>
                  <div style={{fontSize:8,color:MUTED,marginBottom:2}}>Gross margin est (%)</div>
                  <input value={manualGMEst} onChange={e => setManualGMEst(e.target.value)}
                    placeholder={`e.g. ${d.grossMargin ? (d.grossMargin - 2).toFixed(0) : '—'}%`}
                    style={{width:80,backgroundColor:'#111',border:`1px solid ${BORDER}`,borderRadius:5,padding:'4px 8px',color:TEXT,fontSize:11,outline:'none'}}
                  />
                </div>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{fontSize:8,color:MUTED,marginBottom:2}}>Guidance / forward commentary</div>
                  <input value={manualGuidance} onChange={e => setManualGuidance(e.target.value)}
                    placeholder="e.g. FY26 Rev +23% vs Est. +21% — raised guidance"
                    style={{width:'100%',backgroundColor:'#111',border:`1px solid ${BORDER}`,borderRadius:5,padding:'4px 8px',color:TEXT,fontSize:11,outline:'none'}}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── EPS BEAT/MISS TRACK RECORD ── */}
          {avData && avData.quarterlyEarnings.length > 0 && (
            <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:12}}>
              <div style={{fontSize:9,fontWeight:700,color:MUTED,letterSpacing:'0.8px',marginBottom:8}}>
                📊 EPS BEAT/MISS HISTORY (last {avData.quarterlyEarnings.length} quarters · from Alpha Vantage)
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {avData.quarterlyEarnings.map((eq,i) => {
                  const spct = eq.surprisePct;
                  const sCol = surpriseColor(spct);
                  const isBeat = spct !== null && spct >= 0;
                  return (
                    <div key={i} style={{
                      backgroundColor:'#0d1117',
                      border:`1px solid ${sCol}35`,
                      borderLeft:`3px solid ${sCol}`,
                      borderRadius:7, padding:'7px 10px', minWidth:86,
                    }}>
                      <div style={{fontSize:8,color:MUTED,marginBottom:3,letterSpacing:'0.3px'}}>{eq.fiscalDateEnding?.slice(0,7)}</div>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:4}}>
                        <span style={{fontSize:13,fontWeight:900,color:sCol,lineHeight:1}}>
                          {eq.reportedEPS !== null ? (eq.reportedEPS>=0?`$${eq.reportedEPS.toFixed(2)}`:`($${Math.abs(eq.reportedEPS).toFixed(2)})`) : '—'}
                        </span>
                        {spct !== null && (
                          <span style={{fontSize:9,fontWeight:800,color:sCol}}>
                            {isBeat?'+':''}{spct.toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <div style={{fontSize:8,color:MUTED,marginTop:2}}>
                        est {eq.estimatedEPS !== null ? (eq.estimatedEPS>=0?`$${eq.estimatedEPS.toFixed(2)}`:`($${Math.abs(eq.estimatedEPS).toFixed(2)})`) : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{marginTop:8,fontSize:9,color:MUTED,lineHeight:1.5}}>
                💡 Consistent beats drive re-rating. Institutional reaction = <em>surprise vs expectations</em>, not just absolute numbers.
              </div>
            </div>
          )}

          {!avData && (
            <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:10,fontSize:10,color:MUTED}}>
              Enter a stock ticker above to load EPS beat/miss history and consensus estimates from Alpha Vantage.
              Actuals come from the uploaded earnings document.
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            PARSE STATE BANNER — the most important signal before any scores
            Shows clearly whether the extraction can be trusted.
            ══════════════════════════════════════════════════════════════════════ */}
        {(() => {
          const ps = d.parseState;
          const pc = d.parseConfidence;
          const config = {
            verified: {
              color: GREEN, icon: '✅', title: 'EXTRACTION VERIFIED',
              msg: `Key metrics extracted successfully (confidence ${pc}%). Scores and ratios are calculated from validated numbers.`,
              bg: GREEN + '0e', border: GREEN + '40',
            },
            partial: {
              color: YELLOW, icon: '⚠️', title: 'PARTIAL EXTRACTION',
              msg: `Revenue found but ${d.hardFailures.length} metric(s) failed validation (confidence ${pc}%). Scores shown with reduced confidence. Verify marked fields manually.`,
              bg: YELLOW + '0a', border: YELLOW + '35',
            },
            failed: {
              color: RED, icon: '🚫', title: 'EXTRACTION FAILED',
              msg: `Revenue or core metrics could not be reliably extracted (confidence ${pc}%). SCORES ARE SUPPRESSED. Only text analysis (themes, management language) is shown below. Try Paste mode for better results.`,
              bg: RED + '0c', border: RED + '40',
            },
          }[ps];
          return (
            <div style={{backgroundColor:config.bg, border:`2px solid ${config.border}`, borderRadius:10, padding:'12px 16px', marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:18}}>{config.icon}</span>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                    <span style={{fontSize:11,fontWeight:800,color:config.color,letterSpacing:'0.8px'}}>{config.title}</span>
                    {/* Confidence bar */}
                    <div style={{flex:1,maxWidth:120,height:4,backgroundColor:'#1e293b',borderRadius:2,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${pc}%`,backgroundColor:config.color,borderRadius:2}}/>
                    </div>
                    <span style={{fontSize:9,color:config.color,fontWeight:700}}>{pc}% confidence</span>
                  </div>
                  <div style={{fontSize:10,color:config.color+'dd',lineHeight:1.5}}>{config.msg}</div>
                  {ps === 'failed' && d.hardFailures.length > 0 && (
                    <div style={{marginTop:6,fontSize:9,color:MUTED}}>
                      Failures: {d.hardFailures.slice(0,2).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── COMPANY HEADER (Three-engine scores + themes + warnings) ── */}
        <div style={{backgroundColor:CARD,border:`1px solid ${BORDER}`,borderRadius:14,padding:'18px 20px',marginBottom:16}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:16,flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
                <span style={{fontSize:11,color:MUTED}}>{d.period}</span>
                <span style={{fontSize:11,color:MUTED}}>·</span>
                <span style={{fontSize:11,color:MUTED}}>{d.filingType}</span>
                <span style={{fontSize:11,color:MUTED}}>·</span>
                <span style={{fontSize:11,color:MUTED}}>{d.scaleLabel}</span>
                <span style={{fontSize:11,color:MUTED}}>·</span>
                <span style={{fontSize:11,fontWeight:700,color:d.mgmtTone==='bullish'?GREEN:d.mgmtTone==='cautious'?ORANGE:MUTED}}>
                  Mgmt tone: {d.mgmtTone}
                </span>
                {d.continuingOpsDetected && <span style={{fontSize:10,fontWeight:700,color:YELLOW,backgroundColor:YELLOW+'14',padding:'2px 8px',borderRadius:4}}>⚠ Discontinued Ops</span>}
              </div>

              {/* Theme badges */}
              {/* Theme badges with confidence tiers */}
              {(nar as any).themeDetections?.length > 0 && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                  {((nar as any).themeDetections as ThemeDetection[]).map((td: ThemeDetection)=>(
                    <span key={td.theme.tag} style={{
                      fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:20,
                      backgroundColor:td.theme.color+'18',color:td.theme.color,
                      border:`1px solid ${td.theme.color}${td.tier==='core'?'60':td.tier==='adjacent'?'35':'20'}`,
                      opacity: td.tier==='weak'?0.5:1,
                    }} title={`${td.tier.toUpperCase()} — ${td.confidence}% confidence`}>
                      {td.theme.emoji} {td.theme.label}
                      <span style={{fontSize:8,marginLeft:4,opacity:0.7}}>{td.confidence}%</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Validation warnings — distinguish hard failures from soft warnings */}
              {d.validationWarnings.length > 0 && (
                <div>
                  {/* Hard failures (sanitization) */}
                  {d.validationWarnings.filter(w => !w.includes('inferred') && !w.includes('verify')).length > 0 && (
                    <div style={{backgroundColor:RED+'0c',border:`1px solid ${RED}30`,borderRadius:8,padding:'8px 12px',marginBottom:6}}>
                      <div style={{fontSize:10,fontWeight:700,color:RED,marginBottom:3}}>🚫 Extraction Failures — Affected Metrics Suppressed</div>
                      {d.validationWarnings.filter(w => !w.includes('inferred') && !w.includes('verify')).map((w,i)=>(
                        <div key={i} style={{fontSize:9,color:RED+'cc',marginTop:2}}>• {w}</div>
                      ))}
                    </div>
                  )}
                  {/* Soft warnings */}
                  {d.validationWarnings.filter(w => w.includes('inferred') || w.includes('verify')).length > 0 && (
                    <div style={{backgroundColor:YELLOW+'0a',border:`1px solid ${YELLOW}25`,borderRadius:8,padding:'7px 10px'}}>
                      <div style={{fontSize:9,fontWeight:700,color:YELLOW,marginBottom:2}}>⚠ Extraction Notes</div>
                      {d.validationWarnings.filter(w => w.includes('inferred') || w.includes('verify')).map((w,i)=>(
                        <div key={i} style={{fontSize:9,color:MUTED,marginTop:1}}>• {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Three score wheels */}
            <div style={{display:'flex',gap:16,alignItems:'center',flexShrink:0,flexWrap:'wrap'}}>
              <ScoreWheel eng={q} />
              <ScoreWheel eng={r} />
              <ScoreWheel eng={nar} />
            </div>
          </div>

          {/* Summary verdicts */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:8,marginTop:12}}>
            {[q,r,nar].map(eng=>(
              <div key={eng.label} style={{padding:'8px 12px',backgroundColor:eng.color+'0c',border:`1px solid ${eng.color}25`,borderRadius:7,borderLeft:`3px solid ${eng.color}`}}>
                <div style={{fontSize:9,fontWeight:800,color:eng.color,marginBottom:3,letterSpacing:'0.5px'}}>{eng.label.toUpperCase()}</div>
                <div style={{fontSize:F.xs,color:TEXT,lineHeight:1.5}}>{eng.summary}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── MAIN CONTENT GRID — only show numeric tables when extraction is not failed ── */}
        {d.parseState === 'failed' && (
          <div style={{backgroundColor:CARD2,border:`1px solid ${RED}25`,borderRadius:12,padding:'20px',marginBottom:14,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:10}}>🚫</div>
            <div style={{fontSize:F.md,fontWeight:700,color:RED,marginBottom:6}}>Numeric Tables Suppressed</div>
            <div style={{fontSize:F.sm,color:MUTED,maxWidth:500,margin:'0 auto',lineHeight:1.7}}>
              Revenue extraction failed — all financial ratios and metrics are based on incorrect numbers and would be misleading.
              Text-based analysis (themes, management commentary, guidance) is still available below.
            </div>
            <div style={{marginTop:12,padding:'8px 14px',backgroundColor:ACCENT+'10',borderRadius:8,fontSize:F.xs,color:ACCENT,display:'inline-block'}}>
              💡 For better results: open the PDF, Ctrl+A → Ctrl+C, then use "Paste Text" mode
            </div>
          </div>
        )}
        <div style={{gridTemplateColumns:'minmax(300px,2fr) minmax(280px,1fr)',gap:14,marginBottom:14,display: d.parseState === 'failed' ? 'none' : 'grid'} as React.CSSProperties}>

          {/* LEFT: P&L + Balance Sheet */}
          <div style={{display:'flex',flexDirection:'column',gap:12}}>

            {/* P&L Table */}
            <div style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:12,padding:'16px 18px'}}>
              <div style={{fontSize:F.sm,fontWeight:800,color:PURPLE,marginBottom:10,letterSpacing:'0.5px'}}>📈 INCOME STATEMENT</div>
              {d.continuingOpsDetected && (
                <div style={{fontSize:10,color:YELLOW,marginBottom:8,padding:'4px 8px',backgroundColor:YELLOW+'0a',borderRadius:5}}>
                  Note: Discontinued operations (divestiture) included in net income — compare continuing-ops for clean picture
                </div>
              )}
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${BORDER}`}}>
                    <th style={{padding:'4px 8px',textAlign:'left',fontSize:9,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>METRIC</th>
                    <th style={{padding:'4px 8px',textAlign:'right',fontSize:9,color:MUTED,fontWeight:700}}>{d.period}</th>
                    <th style={{padding:'4px 8px',textAlign:'right',fontSize:9,color:MUTED,fontWeight:700}}>YOY</th>
                  </tr>
                </thead>
                <tbody>
                  <MetRow label="Revenue" cur={d.revenue} prior={d.revPrior} d={d} highlight />
                  <MetRow label="Gross Profit" cur={d.grossProfit} d={d} />
                  <MetRow label="Gross Margin" cur={d.grossMargin} d={d} isPct />
                  <MetRow label="EBITDA" cur={d.ebitda} d={d} />
                  <MetRow label="EBITDA Margin" cur={d.ebitdaMargin} d={d} isPct />
                  <MetRow label="EBIT / Op. Income" cur={d.ebit} d={d} />
                  <MetRow label="R&D Expense" cur={d.rnd} d={d} />
                  <MetRow label="SG&A" cur={d.sga} d={d} />
                  <MetRow label="Interest Expense" cur={d.interestExpense} d={d} />
                  <MetRow label="Other Income" cur={d.otherIncome} d={d} />
                  <MetRow label="PBT" cur={d.pbt} d={d} />
                  <MetRow label="Tax" cur={d.tax} d={d} />
                  <MetRow label="Net Income / PAT" cur={d.pat} prior={d.patPrior} d={d} highlight />
                  <MetRow label="PAT Margin" cur={d.patMargin} d={d} isPct />
                  <MetRow label="EPS" cur={d.eps} prior={d.epsPrior} d={d} isEps />
                  {d.continuingOpsDetected && d.discontinuedIncome !== null && (
                    <MetRow label="  of which: Discontinued Ops" cur={d.discontinuedIncome} d={d} />
                  )}
                  {d.continuingOpsDetected && d.continuingPAT !== null && (
                    <MetRow label="  Continuing-Ops PAT (approx)" cur={d.continuingPAT} d={d} highlight />
                  )}
                </tbody>
              </table>
            </div>

            {/* Balance Sheet */}
            <div style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:12,padding:'16px 18px'}}>
              <div style={{fontSize:F.sm,fontWeight:800,color:YELLOW,marginBottom:10}}>🏛️ BALANCE SHEET & RETURNS</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                {[
                  {l:'Cash',             v:d.cash,       col:GREEN},
                  {l:'Total Debt',       v:d.totalDebt,  col:d.totalDebt&&d.totalDebt>0?ORANGE:GREEN},
                  {l:'Net Debt',         v:d.netDebt,    col:d.netDebt&&d.netDebt>0?ORANGE:GREEN},
                  {l:'Equity',           v:d.equity,     col:TEXT},
                  {l:'Total Assets',     v:d.totalAssets,col:TEXT},
                  {l:'Capex',            v:d.capex,      col:MUTED},
                ].map(({l,v,col})=> v !== null ? (
                  <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'4px 8px',backgroundColor:'#0f0f1a',borderRadius:6}}>
                    <span style={{fontSize:F.xs,color:MUTED}}>{l}</span>
                    <span style={{fontSize:F.xs,fontWeight:700,color:col}}>{n(v,d)}</span>
                  </div>
                ) : null)}
              </div>
              <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:10}}>
                <div style={{fontSize:9,fontWeight:700,color:PURPLE,letterSpacing:'0.5px',marginBottom:8}}>COMPUTED RATIOS</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                  {[
                    {l:'D/E Ratio',    v:d.deRatio!==null?`${d.deRatio.toFixed(2)}x`:'—', col:mColor(d.deRatio!==null?1-Math.min(d.deRatio,2):null,0.5,0)},
                    {l:'ROCE',         v:pct(d.roce),        col:mColor(d.roce,20,12)},
                    {l:'ROE',          v:pct(d.roe),         col:mColor(d.roe,15,10)},
                    {l:'CFO/PAT',      v:d.cfoPat!==null?`${d.cfoPat.toFixed(2)}x`:'—', col:mColor(d.cfoPat,0.8,0.5)},
                    {l:'FCF',          v:n(d.fcf,d),         col:d.fcf!==null&&d.fcf>0?GREEN:RED},
                  ].map(({l,v,col})=>(
                    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'4px 8px',backgroundColor:'#0f0f1a',borderRadius:6}}>
                      <span style={{fontSize:F.xs,color:MUTED}}>{l}</span>
                      <span style={{fontSize:F.xs,fontWeight:700,color:col}}>{v}</span>
                    </div>
                  ))}
                  {/* Cash Flow row */}
                  {d.cfo !== null && (
                    <div style={{gridColumn:'1/-1',display:'flex',justifyContent:'space-between',padding:'4px 8px',backgroundColor:'#0f0f1a',borderRadius:6}}>
                      <span style={{fontSize:F.xs,color:MUTED}}>Operating Cash Flow</span>
                      <span style={{fontSize:F.xs,fontWeight:700,color:d.cfo>=0?GREEN:RED}}>{n(d.cfo,d)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Signals + Narrative */}
          <div style={{display:'flex',flexDirection:'column',gap:12}}>

            {/* Earnings Reaction Signals */}
            <div style={{backgroundColor:CARD2,border:`1px solid ${r.color}25`,borderLeft:`3px solid ${r.color}`,borderRadius:12,padding:'14px 16px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{fontSize:F.sm,fontWeight:800,color:r.color}}>🎯 EARNINGS REACTION</div>
                <button onClick={()=>setExpandedSignals(p=>({...p,reaction:!p.reaction}))}
                  style={{fontSize:10,color:MUTED,background:'none',border:'none',cursor:'pointer'}}>
                  {expandedSignals.reaction?'▲ less':'▼ more'}
                </button>
              </div>
              {r.signals.slice(0, expandedSignals.reaction ? 99 : 5).map((s,i)=>(
                <div key={i} style={{display:'flex',gap:8,marginBottom:6,alignItems:'flex-start'}}>
                  <span style={{fontSize:10,flexShrink:0,marginTop:1,color:s.type==='green'?GREEN:s.type==='red'?RED:s.type==='amber'?YELLOW:MUTED}}>
                    {s.type==='green'?'✓':s.type==='red'?'✗':'◦'}
                  </span>
                  <span style={{fontSize:F.xs,color:TEXT,lineHeight:1.5}}>{s.text}</span>
                </div>
              ))}
            </div>

            {/* Accounting Quality Signals */}
            <div style={{backgroundColor:CARD2,border:`1px solid ${q.color}25`,borderLeft:`3px solid ${q.color}`,borderRadius:12,padding:'14px 16px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{fontSize:F.sm,fontWeight:800,color:q.color}}>🏛️ ACCOUNTING QUALITY</div>
                <button onClick={()=>setExpandedSignals(p=>({...p,quality:!p.quality}))}
                  style={{fontSize:10,color:MUTED,background:'none',border:'none',cursor:'pointer'}}>
                  {expandedSignals.quality?'▲ less':'▼ more'}
                </button>
              </div>
              {q.signals.slice(0, expandedSignals.quality ? 99 : 4).map((s,i)=>(
                <div key={i} style={{display:'flex',gap:8,marginBottom:5,alignItems:'flex-start'}}>
                  <span style={{fontSize:10,flexShrink:0,color:s.type==='green'?GREEN:s.type==='red'?RED:s.type==='amber'?YELLOW:MUTED}}>
                    {s.type==='green'?'✓':s.type==='red'?'✗':'◦'}
                  </span>
                  <span style={{fontSize:F.xs,color:TEXT,lineHeight:1.5}}>{s.text}</span>
                </div>
              ))}
            </div>

            {/* Order Book */}
            {d.orderBook !== null && (
              <div style={{backgroundColor:ACCENT+'10',border:`1px solid ${ACCENT}30`,borderRadius:12,padding:'14px 16px'}}>
                <div style={{fontSize:F.sm,fontWeight:800,color:ACCENT,marginBottom:6}}>📋 ORDER BOOK / PIPELINE</div>
                <div style={{fontSize:22,fontWeight:900,color:TEXT}}>{n(d.orderBook,d)}</div>
                {d.revenue && <div style={{fontSize:11,color:MUTED,marginTop:3}}>= {(d.orderBook/(d.revenue*(d.periodType==='quarterly'?4:1))).toFixed(1)}x annualized revenue</div>}
              </div>
            )}

            {/* Headcount */}
            {d.headcount !== null && (
              <div style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:12,padding:'12px 14px'}}>
                <div style={{fontSize:9,color:MUTED,fontWeight:700,marginBottom:3}}>EMPLOYEES</div>
                <div style={{fontSize:18,fontWeight:800,color:TEXT}}>{d.headcount.toLocaleString()}</div>
              </div>
            )}
          </div>
        </div>

        {/* ── NARRATIVE THEMES with confidence tiers ── */}
        {(nar as any).themeDetections?.length > 0 && (
          <div style={{backgroundColor:CARD2,border:`1px solid ${PURPLE}25`,borderRadius:12,padding:'14px 18px',marginBottom:14}}>
            <div style={{fontSize:F.sm,fontWeight:800,color:PURPLE,marginBottom:4}}>🌐 NARRATIVE THEMES</div>
            <div style={{fontSize:9,color:MUTED,marginBottom:10}}>
              Core = confirmed central to business · Adjacent = present but peripheral · Weak = incidental mention
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:8}}>
              {((nar as any).themeDetections as ThemeDetection[]).map((td: ThemeDetection)=>(
                <div key={td.theme.tag} style={{
                  padding:'10px 12px',
                  backgroundColor:td.theme.color+'0e',
                  border:`1px solid ${td.theme.color}${td.tier==='core'?'50':td.tier==='adjacent'?'28':'15'}`,
                  borderRadius:8,
                  borderLeft:`3px solid ${td.theme.color}${td.tier==='core'?'':'88'}`,
                  opacity: td.tier==='weak' ? 0.55 : 1,
                }}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
                    <span style={{fontSize:F.md}}>{td.theme.emoji}</span>
                    <span style={{
                      fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:3,
                      backgroundColor: td.tier==='core'?td.theme.color+'25':td.tier==='adjacent'?YELLOW+'20':MUTED+'18',
                      color: td.tier==='core'?td.theme.color:td.tier==='adjacent'?YELLOW:MUTED,
                    }}>
                      {td.tier.toUpperCase()} {td.confidence}%
                    </span>
                  </div>
                  <div style={{fontSize:F.xs,fontWeight:700,color:td.theme.color}}>{td.theme.label}</div>
                  <div style={{fontSize:9,color:MUTED,marginTop:3,lineHeight:1.4}}>
                    {td.theme.keywords.slice(0,2).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,padding:'8px 10px',backgroundColor:PURPLE+'08',borderRadius:6,fontSize:F.xs,color:MUTED,lineHeight:1.6}}>
              💡 <strong style={{color:PURPLE}}>Market Psychology:</strong> Premium themes (AI/Defense/Edge) trade on TAM expansion, not current ROE.
              Only CORE themes (confirmed multiple keywords) drive meaningful multiple expansion.
              Adjacent themes provide context. Weak mentions should NOT drive investment decisions.
            </div>
          </div>
        )}

        {/* ── MANAGEMENT LANGUAGE ── */}
        {(d.guidance.length > 0 || d.keyMetrics.length > 0) && (
          <div style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:12,padding:'14px 18px',marginBottom:14}}>
            <div style={{fontSize:F.sm,fontWeight:800,color:YELLOW,marginBottom:10}}>💬 MANAGEMENT COMMENTARY</div>
            {d.guidance.length > 0 && (
              <>
                <div style={{fontSize:10,fontWeight:700,color:MUTED,letterSpacing:'0.5px',marginBottom:6}}>FORWARD-LOOKING STATEMENTS</div>
                {d.guidance.map((g,i)=>(
                  <div key={i} style={{padding:'8px 12px',marginBottom:6,backgroundColor:'#0f0f1a',borderRadius:6,borderLeft:`2px solid ${YELLOW}50`,fontSize:F.xs,color:TEXT,lineHeight:1.7}}>
                    "{g}"
                  </div>
                ))}
              </>
            )}
            {d.keyMetrics.length > 0 && (
              <>
                <div style={{fontSize:10,fontWeight:700,color:MUTED,letterSpacing:'0.5px',marginBottom:6,marginTop:d.guidance.length?10:0}}>KEY OPERATIONAL HIGHLIGHTS</div>
                {d.keyMetrics.map((k,i)=>(
                  <div key={i} style={{display:'flex',gap:8,marginBottom:5}}>
                    <span style={{color:ACCENT,fontSize:10,flexShrink:0}}>›</span>
                    <span style={{fontSize:F.xs,color:MUTED,lineHeight:1.5}}>{k}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── FRAMEWORK NOTE ── */}
        <div style={{backgroundColor:'#0a0a12',border:`1px solid ${BORDER}`,borderRadius:12,padding:'14px 18px',marginBottom:14}}>
          <div style={{fontSize:F.xs,fontWeight:800,color:MUTED,marginBottom:8,letterSpacing:'0.5px'}}>📐 THREE-ENGINE FRAMEWORK</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10}}>
            {[
              {icon:'🏛️', label:'Accounting Quality', score:q.score, color:q.color, note:'Balance sheet, margins, cash conversion. Best for: long-term fundamental investing.'},
              {icon:'🎯', label:'Earnings Reaction', score:r.score, color:r.color, note:'Acceleration, inflection, guidance, narrative. Best for: event-driven positioning.'},
              {icon:'🌐', label:'Narrative/Theme', score:nar.score, color:nar.color, note:'Thematic alignment to current market premiums. Best for: multiple expansion assessment.'},
            ].map(({icon,label,score,color,note})=>(
              <div key={label} style={{padding:'10px 12px',backgroundColor:'#111118',borderRadius:8}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>{icon} {label}</span>
                  <span style={{fontSize:F.sm,fontWeight:900,color}}>{score}</span>
                </div>
                <div style={{height:3,backgroundColor:'#1e293b',borderRadius:2,overflow:'hidden',marginBottom:5}}>
                  <div style={{height:'100%',width:`${score}%`,backgroundColor:color,borderRadius:2}}/>
                </div>
                <div style={{fontSize:9,color:MUTED,lineHeight:1.5}}>{note}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,fontSize:F.xs,color:MUTED,lineHeight:1.7}}>
            ⚠ <strong style={{color:YELLOW}}>Important:</strong> Accounting quality alone does not predict stock price reaction.
            Earnings move stocks based on <em>surprise vs expectations</em>, margin direction, guidance credibility, and thematic positioning.
            A company with mediocre trailing ROE but accelerating revenue, improving margins, and AI/defense exposure can still have a strong positive reaction.
          </div>
        </div>

        {/* ── ACTIONS ── */}
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button onClick={()=>{
            const txt=[
              `EARNINGS ANALYSIS — ${d.company} | ${d.period} | ${d.filingType}`,
              `Quality: ${q.score} | Reaction: ${r.score} | Narrative: ${nar.score}`,
              '',
              'INCOME STATEMENT:',
              `  Revenue: ${n(d.revenue,d)} (YoY: ${d.revPrior?growth(d.revenue,d.revPrior)?.text:'N/A'})`,
              `  Gross Margin: ${pct(d.grossMargin)}`,
              `  EBITDA Margin: ${pct(d.ebitdaMargin)}`,
              `  PAT: ${n(d.pat,d)}`,
              `  EPS: ${d.eps!==null?`${d.currency==='USD'?'$':'₹'}${d.eps.toFixed(2)}`:'—'}`,
              '',
              'BALANCE SHEET:',
              `  Cash: ${n(d.cash,d)} | Debt: ${n(d.totalDebt,d)} | D/E: ${d.deRatio!==null?d.deRatio.toFixed(2)+'x':'—'}`,
              `  ROCE: ${pct(d.roce)} | CFO/PAT: ${d.cfoPat!==null?d.cfoPat.toFixed(2)+'x':'—'}`,
              '',
              'THEMES: ' + (nar.themeList.map(t=>t.label).join(', ')||'None detected'),
              '',
              'REACTION SIGNALS:',
              ...r.signals.map(s=>`  ${s.type==='green'?'✓':s.type==='red'?'✗':'◦'} ${s.text}`),
            ].join('\n');
            navigator.clipboard.writeText(txt).catch(()=>{});
          }} style={{padding:'9px 18px',backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:8,color:TEXT,fontSize:F.sm,cursor:'pointer'}}>
            📋 Copy Summary
          </button>
          <button onClick={reset} style={{padding:'9px 18px',backgroundColor:'transparent',border:`1px solid ${BORDER}`,borderRadius:8,color:MUTED,fontSize:F.sm,cursor:'pointer'}}>
            🔄 Analyze Another
          </button>
        </div>
      </div>
    );
  }

  // ── INPUT PAGE ──────────────────────────────────────────────────────────────
  return (
    <div style={{background:BG,minHeight:'100vh',color:TEXT,fontFamily:'system-ui,-apple-system,sans-serif',padding:'24px 20px',maxWidth:1140,margin:'0 auto'}}>

      {/* Header */}
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:24,fontWeight:900,color:ACCENT,margin:'0 0 6px'}}>📊 Earnings Intelligence</h1>
        <p style={{fontSize:F.sm,color:MUTED,margin:'0 0 10px',lineHeight:1.6}}>
          Three-engine analysis: Accounting Quality · Earnings Reaction Probability · Narrative / Thematic Score.
          Upload any earnings filing — SEC 10-K/10-Q, NSE/BSE quarterly results, annual report PDF or Excel.
        </p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {['🎯 Earnings Reaction Score','🏛️ Accounting Quality','🌐 Narrative Themes','⚠ Data Validation','💬 Mgmt Language'].map(l=>(
            <span key={l} style={{fontSize:10,color:MUTED,backgroundColor:CARD2,border:`1px solid ${BORDER}`,padding:'3px 9px',borderRadius:20}}>{l}</span>
          ))}
        </div>
      </div>

      {/* Mode tabs */}
      <div style={{display:'flex',borderBottom:`1px solid ${BORDER}`,marginBottom:20}}>
        {([
          {id:'upload',icon:'📁',label:'Upload File',sub:'PDF, Excel, CSV, TXT'},
          {id:'paste', icon:'📋',label:'Paste Text', sub:'Copy from any source'},
          {id:'url',   icon:'🔗',label:'URL Link',   sub:'SEC EDGAR, NSE, BSE'},
        ] as const).map(m=>(
          <button key={m.id} onClick={()=>setMode(m.id)} style={{
            padding:'10px 20px',border:'none',cursor:'pointer',background:'transparent',
            color:mode===m.id?ACCENT:MUTED,fontWeight:mode===m.id?700:400,fontSize:F.sm,
            borderBottom:mode===m.id?`2px solid ${ACCENT}`:'2px solid transparent',
            marginBottom:-1,transition:'all 0.15s',
          }}>
            {m.icon} {m.label}
            <div style={{fontSize:9,color:mode===m.id?ACCENT+'99':'#334155',fontWeight:400}}>{m.sub}</div>
          </button>
        ))}
      </div>

      {loading ? <LoadingUI /> : (
        <>
          {mode === 'upload' && (
            <div style={{border:`2px dashed ${BORDER}`,borderRadius:14,padding:'44px 24px',textAlign:'center',cursor:'pointer',backgroundColor:CARD,transition:'border-color 0.2s'}}
              onClick={()=>fileRef.current?.click()}
              onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files);}}
              onDragOver={e=>e.preventDefault()}
            >
              <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.txt" style={{display:'none'}} onChange={e=>handleFile(e.target.files)}/>
              <div style={{fontSize:44,marginBottom:14}}>📂</div>
              <div style={{fontSize:F.lg,fontWeight:700,color:TEXT,marginBottom:6}}>Drop file here or click to browse</div>
              <div style={{fontSize:F.sm,color:MUTED,marginBottom:16}}>PDF (10-K/10-Q/Annual Report), Excel, CSV, TXT</div>
              <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
                {['.PDF','.XLSX','.XLS','.CSV','.TXT'].map(e=>(
                  <span key={e} style={{fontSize:10,fontWeight:700,color:ACCENT,backgroundColor:ACCENT+'14',border:`1px solid ${ACCENT}30`,padding:'3px 10px',borderRadius:4}}>{e}</span>
                ))}
              </div>
            </div>
          )}

          {mode === 'paste' && (
            <div>
              <div style={{fontSize:F.sm,color:MUTED,marginBottom:8}}>
                Open PDF → <kbd style={{background:'#1e293b',padding:'1px 5px',borderRadius:3,fontSize:10}}>Ctrl+A</kbd> → <kbd style={{background:'#1e293b',padding:'1px 5px',borderRadius:3,fontSize:10}}>Ctrl+C</kbd> → paste:
              </div>
              <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)} rows={14}
                placeholder={`Paste any earnings document text here.\n\nExample (SEC 10-K):\nRevenue: Product $30,498,162 $20,867,800\n32,215,500 24,558,809\nGross profit 15,982,483 622,924\nNet income 5,087,694 (13,634,333)\n\nExample (Indian ₹ Cr):\nRevenue from Operations 2,345 1,983\nEBITDA 668 534\nPAT 345 267`}
                style={{width:'100%',backgroundColor:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:'14px',color:TEXT,fontSize:12,resize:'vertical',boxSizing:'border-box',lineHeight:1.7,fontFamily:'monospace'}}
              />
              <div style={{display:'flex',gap:10,marginTop:12}}>
                <button onClick={()=>{setLoading(true);process(pasteText);}} disabled={!pasteText.trim()}
                  style={{padding:'10px 24px',backgroundColor:ACCENT,border:'none',borderRadius:8,color:'#000',fontWeight:800,fontSize:F.md,cursor:'pointer',opacity:!pasteText.trim()?0.5:1}}>
                  🔍 Analyze
                </button>
                {pasteText && <button onClick={()=>setPasteText('')} style={{padding:'10px 14px',backgroundColor:'transparent',border:`1px solid ${BORDER}`,borderRadius:8,color:MUTED,fontSize:F.sm,cursor:'pointer'}}>Clear</button>}
              </div>
            </div>
          )}

          {mode === 'url' && (
            <div>
              <div style={{fontSize:F.sm,color:MUTED,marginBottom:8}}>Direct link to an earnings filing (SEC EDGAR, NSE/BSE PDF):</div>
              <div style={{display:'flex',gap:10}}>
                <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleURL()}
                  placeholder="https://www.sec.gov/Archives/..."
                  style={{flex:1,backgroundColor:CARD,border:`1px solid ${BORDER}`,borderRadius:8,padding:'10px 14px',color:TEXT,fontSize:F.sm,outline:'none'}}
                />
                <button onClick={handleURL} disabled={!urlInput.trim()}
                  style={{padding:'10px 20px',backgroundColor:ACCENT,border:'none',borderRadius:8,color:'#000',fontWeight:700,fontSize:F.sm,cursor:'pointer',whiteSpace:'nowrap',opacity:!urlInput.trim()?0.5:1}}>
                  🔍 Fetch
                </button>
              </div>
            </div>
          )}

          {error && (
            <div style={{backgroundColor:RED+'14',border:`1px solid ${RED}40`,borderRadius:8,padding:'10px 14px',marginTop:14,color:RED,fontSize:F.sm}}>
              ⚠ {error}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div style={{marginTop:28}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div style={{fontSize:F.sm,fontWeight:700,color:MUTED}}>📚 RECENT ANALYSES</div>
                <button onClick={()=>{setHistory([]);saveHist2([]);}} style={{fontSize:10,color:MUTED,background:'none',border:'none',cursor:'pointer'}}>Clear</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:10}}>
                {history.slice(0,9).map(h=>(
                  <div key={h.id} style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderLeft:`3px solid ${h.color}`,borderRadius:10,padding:'12px 14px'}}>
                    <div style={{fontSize:F.sm,fontWeight:700,color:TEXT,marginBottom:3}}>{h.company}</div>
                    <div style={{display:'flex',gap:6,marginBottom:4,flexWrap:'wrap'}}>
                      <span style={{fontSize:10,color:ACCENT}}>{h.period}</span>
                      <span style={{fontSize:9,color:MUTED}}>Q:{h.q}</span>
                      <span style={{fontSize:9,color:h.color}}>R:{h.r}</span>
                      <span style={{fontSize:9,color:PURPLE}}>N:{h.n}</span>
                    </div>
                    <div style={{fontSize:10,color:MUTED,lineHeight:1.5}}>{h.summary.slice(0,60)}…</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {history.length === 0 && (
            <div style={{marginTop:28,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
              {[
                {icon:'📄',title:'SEC 10-K / 10-Q',desc:'Upload PDF directly from SEC EDGAR. Company, period, and all financials extracted automatically.'},
                {icon:'📊',title:'NSE/BSE Results', desc:'Quarterly results PDF or Excel. ₹ Cr format detected automatically with full P&L.'},
                {icon:'📋',title:'Paste from PDF',  desc:'Open PDF → Ctrl+A → Ctrl+C → Paste mode. Works for any earnings document worldwide.'},
                {icon:'🎯',title:'3 Separate Scores',desc:'Quality (long-term), Reaction (event-driven), Narrative (thematic). Each scored independently.'},
              ].map(({icon,title,desc})=>(
                <div key={title} style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:10,padding:16}}>
                  <div style={{fontSize:28,marginBottom:8}}>{icon}</div>
                  <div style={{fontSize:F.sm,fontWeight:700,color:TEXT,marginBottom:4}}>{title}</div>
                  <div style={{fontSize:10,color:MUTED,lineHeight:1.6}}>{desc}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
