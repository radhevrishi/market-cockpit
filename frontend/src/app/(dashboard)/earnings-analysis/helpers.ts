// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type RawFinancials, type LabeledNum, type ColDetection } from './types';

export const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0));
/** Load a script from CDN with a hard timeout so we never hang forever */
export async function loadScriptWithTimeout(src: string, timeoutMs = 8000): Promise<void> {
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
export async function extractPDFText(
  file: File,
  onProgress?: (pct: number, msg: string) => void,
  // AUDIT_100 #85 — return page-selection info so caller can show
  // "Analyzed N of M pages" honesty notice.
): Promise<{ text: string; error: string; pagesRead?: number; totalPages?: number; pageRanges?: string }> {
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
    // AUDIT_100 #85 — build a human-readable page-range string.
    const pageRangeStr = (() => {
      if (pagesToRead.length === totalPageCount) return `1-${totalPageCount}`;
      // Compress consecutive runs
      const ranges: string[] = [];
      let runStart = pagesToRead[0];
      let runEnd = pagesToRead[0];
      for (let i = 1; i < pagesToRead.length; i++) {
        if (pagesToRead[i] === runEnd + 1) { runEnd = pagesToRead[i]; }
        else { ranges.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`); runStart = pagesToRead[i]; runEnd = pagesToRead[i]; }
      }
      ranges.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`);
      return ranges.join(', ');
    })();
    return { text: allText, error: '', pagesRead: pagesToRead.length, totalPages: totalPageCount, pageRanges: pageRangeStr };

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
// ── STEP 1: Detect format ────────────────────────────────────────────────────

export function detectCurrency(text: string): { currency: RawFinancials['currency']; filingType: string } {
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
// ── PRE-PROCESSING: OCR Cleanup ───────────────────────────────────────────────
// Removes: audit boilerplate, OCR noise, footnote garbage, legal duplication.
// Essential for Indian PDFs which have extremely messy OCR output.

export function cleanOCRText(rawText: string): string {
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
export function extractAllNumbers(text: string): LabeledNum[] {
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

export function detectScaleFromText(text: string): { factor: number; scaleLabel: string } | null {
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
export function detectColumnIndices(text: string, rows: LabeledNum[]): ColDetection {
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

export function detectScaleFromNumbers(rows: LabeledNum[], currency: string, curIdx: number): { factor: number; scaleLabel: string } {
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
    // BOUNDARY TABLE (USD):
    //  >= 1e6 (1M):  absolute dollars → divide by 1,000,000 → Mn   (OSS: 32,215,500 → 32.2 Mn ✓)
    //  >= 1e3 (1K):  already in thousands → divide by 1,000 → Mn   (Fastly: 173,021 → 173.0 Mn ✓)
    //  >= 1    :     already in Mn → keep                           (rare; management presentations)
    // BOUNDARY TABLE (INR):
    //  >= 1e7 (10M): absolute rupees → divide by 1,00,000 → Cr     (large Indian cos)
    //  >= 1e3 (1K):  in Lakhs → divide by 100 → Cr                 (Aeroflex: 41,935 → 419 Cr ✓)
    //  >= 1    :     already in Cr → keep
    if (revenueCandidate >= 1e6) {
      // Absolute dollar amounts (e.g. OSS 10-K: $32,215,500 = $32.2M)
      const factor = currency === 'INR' ? 1e-5 : 1e-6;
      return { factor, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
    }
    if (revenueCandidate >= 1e3) {
      // Already in thousands (e.g. Fastly "in thousands": 173,021 → $173 Mn)
      const factor = currency === 'INR' ? 1e-2 : 1e-3;
      return { factor, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
    }
    if (revenueCandidate >= 1) {
      // Already in display units (Mn or Cr)
      return { factor: 1, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
    }
  }

  // Fallback: scan ALL rows for any large number to infer scale
  const allNums = rows.flatMap(r => r.nums).filter(n => n > 0 && !isNaN(n));
  const maxNum = allNums.length > 0 ? Math.max(...allNums) : 0;
  if (maxNum >= 1e6) return { factor: currency === 'INR' ? 1e-5 : 1e-6, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
  if (maxNum >= 1e3) return { factor: currency === 'INR' ? 1e-2 : 1e-3, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };

  return { factor: 1, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
}
// ── STEP 4: Find a specific metric using detected column indices ───────────────

export function findMetric(rows: LabeledNum[], patterns: string[], colIdx = 0): number | null {
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
export function findRevenue(
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
