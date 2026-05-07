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
  deRatio: number|null; cfoPat: number|null; roce: number|null; roe: number|null;

  // Business
  orderBook: number|null; backlog: number|null; headcount: number|null;

  // Text intelligence
  guidance: string[]; keyMetrics: string[]; forwardStatements: string[];
  themes: string[]; mgmtTone: 'bullish'|'cautious'|'neutral';

  // Validation
  validationWarnings: string[];
  isDataReliable: boolean;
  continuingOpsDetected: boolean;
}

// ── STEP 1: Detect format ────────────────────────────────────────────────────

function detectCurrency(text: string): { currency: RawFinancials['currency']; filingType: string } {
  const t = text.toLowerCase();
  let filingType = 'Earnings Document';
  if (/annual report on form 10-k|form 10-k/.test(t)) filingType = 'SEC 10-K (Annual)';
  else if (/quarterly report on form 10-q|form 10-q/.test(t)) filingType = 'SEC 10-Q (Quarterly)';
  else if (/form 20-f/.test(t)) filingType = 'SEC 20-F';
  else if (/quarterly results|q[1-4] fy/.test(t)) filingType = 'Quarterly Results';
  else if (/annual report/.test(t)) filingType = 'Annual Report';
  else if (/investor presentation|earnings presentation/.test(t)) filingType = 'Investor Presentation';

  let currency: RawFinancials['currency'] = 'unknown';
  if (/₹|rupee|inr|rs\./.test(t)) currency = 'INR';
  else if (/\$|dollar|usd/.test(t)) currency = 'USD';
  else if (/€|euro\b/.test(t)) currency = 'EUR';

  return { currency, filingType };
}

// ── STEP 2: Extract all numbers with their labels ────────────────────────────
// Returns array of {label, nums: number[]} — nums are RAW, not scaled

interface LabeledNum { label: string; nums: number[]; rawLine: string }

function extractAllNumbers(text: string): LabeledNum[] {
  const results: LabeledNum[] = [];
  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Extract all number-like tokens (handling parentheses for negatives)
    const numRe = /\(?\$?\s*([\d,]+(?:\.\d+)?)\)?%?/g;
    const numTokens: number[] = [];
    let m: RegExpExecArray | null;
    const lineForNums = line;
    numRe.lastIndex = 0;
    while ((m = numRe.exec(lineForNums)) !== null) {
      const raw = m[1].replace(/,/g, '');
      const n = parseFloat(raw);
      if (!isNaN(n) && n >= 0) {
        const isNeg = m[0].trim().startsWith('(') && m[0].includes(')');
        numTokens.push(isNeg ? -n : n);
      }
    }
    if (numTokens.length === 0) continue;

    // Label = everything before the first number token
    const firstNumMatch = line.match(/\(?\$?\s*[\d,]+/);
    if (!firstNumMatch) continue;
    const labelEnd = line.indexOf(firstNumMatch[0]);
    const label = line.slice(0, labelEnd).replace(/\$|%|\|/g, '').trim().toLowerCase();
    if (label.length < 2) continue;

    results.push({ label, nums: numTokens, rawLine: line });
  }
  return results;
}

// ── STEP 3: Auto-detect scale from extracted numbers ──────────────────────────
// Strategy: find the "revenue" or "total" row and infer scale from its magnitude

function detectScaleFromNumbers(rows: LabeledNum[], currency: string): { factor: number; scaleLabel: string } {
  // Find revenue-like rows
  const revRow = rows.find(r => /^(total )?revenue|^net sales|^total net revenue|^revenues?$/.test(r.label));
  const revenueCandidate = revRow?.nums[0];

  // Infer scale from the revenue number
  if (revenueCandidate && revenueCandidate > 0) {
    const sym = currency === 'USD' ? '$' : currency === 'INR' ? '₹' : '';
    if (revenueCandidate >= 1e8) {
      // Absolute dollars/rupees (e.g. 32,215,500) → convert to millions/Cr
      const factor = currency === 'INR' ? 1e-5 : 1e-6; // ₹ → Cr; $ → Mn
      const unit = currency === 'INR' ? '₹ Cr' : '$ Mn';
      return { factor, scaleLabel: unit };
    }
    if (revenueCandidate >= 1e5) {
      // Thousands (e.g. 32,215 = $32M)
      const factor = currency === 'INR' ? 1e-2 : 1e-3;
      const unit = currency === 'INR' ? '₹ Cr' : `${sym} Mn`;
      return { factor, scaleLabel: unit };
    }
    if (revenueCandidate >= 1e3) {
      // Already in Mn/Cr (e.g. 32.2 = $32.2M)
      return { factor: 1, scaleLabel: currency === 'INR' ? '₹ Cr' : `${sym} Mn` };
    }
  }

  // Fallback: check if text says "in millions"
  return { factor: 1, scaleLabel: currency === 'INR' ? '₹ Cr' : '$ Mn' };
}

// ── STEP 4: Find a specific metric from labeled rows ─────────────────────────

function findMetric(rows: LabeledNum[], patterns: string[], colIdx = 0): number | null {
  for (const pat of patterns) {
    const re = new RegExp(pat, 'i');
    for (const row of rows) {
      if (re.test(row.label)) {
        const v = row.nums[colIdx];
        if (v !== undefined && !isNaN(v)) return v;
      }
    }
  }
  return null;
}

// Find the best revenue candidate (total, not sub-items)
function findRevenue(rows: LabeledNum[]): { cur: number|null; prior: number|null } {
  const EXACT = ['total revenue', 'total revenues', 'net revenue', 'net revenues',
                 'total net revenue', 'net sales', 'total net sales', 'revenues$', 'revenue$'];
  const FUZZY = ['total revenue', 'net sales', 'total net revenue', 'revenue from operations'];

  for (const pat of EXACT) {
    const re = new RegExp(`^${pat}$`, 'i');
    for (const row of rows) {
      if (re.test(row.label.trim()) && (row.nums[0] ?? 0) > 0) {
        return { cur: row.nums[0], prior: row.nums[1] ?? null };
      }
    }
  }
  for (const pat of FUZZY) {
    const re = new RegExp(pat, 'i');
    for (const row of rows) {
      if (re.test(row.label) && (row.nums[0] ?? 0) > 0) {
        return { cur: row.nums[0], prior: row.nums[1] ?? null };
      }
    }
  }
  return { cur: null, prior: null };
}

// ── STEP 5: Validate and cross-check — detect impossible relationships ────────

function validateFinancials(d: Partial<RawFinancials>, rows: LabeledNum[]): string[] {
  const warnings: string[] = [];
  const { revenue, grossProfit, grossMargin, ebitda, pat, eps, cash, totalDebt, cfo } = d;

  // Check gross margin consistency
  if (revenue && revenue > 0 && grossProfit) {
    const impliedGM = (grossProfit / revenue) * 100;
    if (grossMargin && Math.abs(impliedGM - grossMargin) > 15) {
      warnings.push(`Gross margin inconsistency: stated ${grossMargin?.toFixed(1)}% vs computed ${impliedGM.toFixed(1)}% — likely unit parsing issue`);
    }
  }

  // Check if EBITDA is impossibly small vs gross profit
  const gp = grossProfit ?? 0;
  const eb = ebitda ?? 0;
  if (eb !== 0 && gp > 0 && Math.abs(eb) < gp * 0.0001) {
    warnings.push(`EBITDA (${eb.toFixed(3)}) suspiciously small vs Gross Profit (${gp.toFixed(2)}) — scaling error likely`);
  }

  // Check if EPS is in wrong units (absolute vs per-share)
  const ep = eps ?? 0;
  const pa = pat ?? 0;
  if (ep !== 0 && pa !== 0) {
    if (Math.abs(ep) > Math.abs(pa) * 0.5 && Math.abs(pa) > 0.1) {
      warnings.push(`EPS (${ep.toFixed(4)}) may be parsed incorrectly vs PAT (${pa.toFixed(2)})`);
    }
  }

  // Check for obvious tax anomaly (tax > PAT suggests something off)
  const taxRow = findMetric(rows, ['tax expense', 'income tax', 'provision.*tax']);
  if (taxRow !== null && pa !== 0 && Math.abs(taxRow) > Math.abs(pa) * 5) {
    warnings.push(`Tax (${taxRow.toFixed(2)}) >> PAT (${pa.toFixed(2)}) — may indicate discontinued ops or parsing error`);
  }

  // Net debt check
  const ca = cash ?? 0;
  const td = totalDebt ?? 0;
  if (ca > 0 && td > 0 && ca > td * 100) {
    warnings.push('Cash >> Debt by 100x — likely scale mismatch between BS items');
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
  { tag: 'CLOUD_INFRA', label: 'Cloud / HPC',           emoji: '☁️', color: '#06b6d4', keywords: ['hyperscaler','cloud computing','data center','hpc cluster','super computer','gpu cluster','distributed computing'] },
  { tag: 'CLEAN_ENERGY',label: 'Clean Energy',          emoji: '⚡', color: '#34d399', keywords: ['solar','wind energy','renewable','battery storage','ev charging','green energy','clean energy','climate tech'] },
  { tag: 'PHARMA_AI',   label: 'Pharma / Biotech',      emoji: '🧬', color: '#c084fc', keywords: ['drug discovery','clinical trial','biopharma','genomics','proteomics','ai drug','biomarker','precision medicine'] },
];

function detectNarrativeThemes(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  for (const theme of NARRATIVE_THEMES) {
    if (theme.keywords.some(kw => t.includes(kw))) found.push(theme.tag);
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
  const t = text.toLowerCase();
  const detected = /discontinued operations|divestiture|disposal group|held for sale|sold.*subsidiary|sale of.*subsidiary/.test(t);
  if (!detected) return { detected: false, discontinuedIncome: null, continuingRevNote: '' };

  // Try to extract the discontinued income amount
  const matches = text.match(/income from discontinued operations.*?\$?\s*([\d,]+)/i);
  const inc = matches ? parseFloat(matches[1].replace(/,/g, '')) : null;

  return {
    detected: true,
    discontinuedIncome: inc,
    continuingRevNote: 'Discontinued operations detected — forward comparisons should use continuing-ops only',
  };
}

// ── STEP 8: MAIN EXTRACTION ────────────────────────────────────────────────────

function parseEarnings(rawText: string): RawFinancials {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const { currency, filingType } = detectCurrency(text);

  // Extract labeled rows
  const rows = extractAllNumbers(text);

  // Detect scale
  const { factor, scaleLabel } = detectScaleFromNumbers(rows, currency);

  // Helper: scale a raw number
  const sc = (v: number|null): number|null => v !== null ? Math.round(v * factor * 1000) / 1000 : null;

  // Period + Company
  const period = (() => {
    const fy = text.match(/(?:fiscal year|year) ended [A-Z][a-z]+ \d+,?\s*(\d{4})/i);
    if (fy) return `FY${fy[1]}`;
    const q = text.match(/(?:three months|quarter) ended [A-Z][a-z]+ \d+,?\s*(\d{4})/i);
    if (q) return `Q${q[1]}`;
    const indQ = text.match(/\b(Q[1-4])\s*[-–]?\s*(?:FY\s*)?(\d{2,4})\b/i);
    if (indQ) return `${indQ[1].toUpperCase()}FY${indQ[2]}`;
    const yr = text.match(/\b(20\d{2})\b/)?.[1];
    return yr ? `FY${yr}` : 'Latest';
  })();

  const company = (() => {
    const secExact = text.match(/\(Exact name of Registrant[^)]*\)\s*\n([^\n]{5,80})/);
    if (secExact) return secExact[1].trim();
    const lines = text.split('\n').slice(0, 20).map(l => l.trim());
    for (const l of lines) {
      if (/(?:Inc|Corp|Ltd|Limited|LLC|plc|Holdings|Systems|Technologies|Pharma|Energy)\b/i.test(l) && l.length < 90) return l;
    }
    return 'Unknown Company';
  })();

  const ticker = text.match(/Trading\s+Symbol[^\n]*\n\s*([A-Z]{1,6})\b/)?.[1] || '';

  // P&L
  const { cur: rawRevCur, prior: rawRevPrior } = findRevenue(rows);
  const revenue = sc(rawRevCur);
  const revPrior = sc(rawRevPrior);

  const rawGross = findMetric(rows, ['gross profit', 'total gross profit']);
  const grossProfit = sc(rawGross);
  const grossMarginRaw = findMetric(rows, ['gross margin', 'gross profit %', 'gross profit margin']);
  const grossMargin = grossMarginRaw && Math.abs(grossMarginRaw) <= 100 ? grossMarginRaw :
    (grossProfit && revenue && revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : null);

  const rawDA = findMetric(rows, ['depreciation and amortization', 'depreciation.*amortization', 'da$', 'depreciation$']);
  const da = sc(rawDA);

  const rawEBIT = findMetric(rows, ['income from operations', 'loss from operations', 'operating income', 'ebit$', 'operating loss']);
  const ebit = sc(rawEBIT);
  const ebitMargin = ebit && revenue && revenue > 0 ? Math.round((ebit / revenue) * 10000) / 100 : null;

  let ebitda = sc(findMetric(rows, ['ebitda', 'adjusted ebitda', 'operating ebitda']));
  if (!ebitda && ebit !== null && da !== null) ebitda = Math.round((ebit + Math.abs(da)) * 1000) / 1000;
  if (!ebitda && grossProfit !== null) {
    const rawOpex = findMetric(rows, ['total operating expenses', 'total operating expense']);
    if (rawOpex) ebitda = Math.round((grossProfit - sc(rawOpex)! + (Math.abs(da ?? 0))) * 1000) / 1000;
  }
  const ebitdaMargin = ebitda && revenue && revenue > 0 ? Math.round((ebitda / revenue) * 10000) / 100 : null;

  const opex = sc(findMetric(rows, ['total operating expenses', 'total opex', 'operating expenses$']));
  const rnd = sc(findMetric(rows, ['research and development', 'r&d expense', 'r&d$']));
  const sga = sc(findMetric(rows, ['selling.*general.*admin', 'general.*administrative', 'sg&a$', 'selling.*marketing']));
  const interestExpense = sc(findMetric(rows, ['interest expense', 'finance costs', 'interest cost', 'borrowing cost']));
  const otherIncome = sc(findMetric(rows, ['other income', 'other income.*net', 'non-operating income']));
  const pbt = sc(findMetric(rows, ['income.*before.*tax', 'loss.*before.*tax', 'profit before tax', 'pbt$', 'earnings before.*tax']));
  const tax = sc(findMetric(rows, ['provision for income tax', 'income tax.*expense', 'tax expense$']));

  const rawPAT = findMetric(rows, ['net income$', 'net loss$', 'net income.*loss', 'net profit$', 'pat$', 'profit after tax', 'profit for the', 'loss from continuing']);
  const pat = sc(rawPAT);
  const rawPATrow = rows.find(r => /net income|net loss|net profit|pat$/.test(r.label));
  const patPrior = sc(rawPATrow?.nums[1] ?? null);
  const patMargin = pat && revenue && revenue > 0 ? Math.round((pat / revenue) * 10000) / 100 : null;

  // EPS — does NOT get scaled (it's per-share)
  const epsRaw = findMetric(rows, ['basic eps', 'diluted eps', 'earnings per share', 'loss per share', '^eps$', 'net income per share']);
  const eps = epsRaw; // No scale factor for per-share
  const epsRow = rows.find(r => /eps|earnings per share|loss per share/.test(r.label));
  const epsPrior = epsRow?.nums[1] ?? null;

  // Discontinued
  const { detected: continuingOpsDetected, discontinuedIncome: rawDiscInc } = detectDiscontinued(text);
  const discontinuedIncome = sc(rawDiscInc);
  const continuingRevenue = revenue; // Best we can do without full separation
  const continuingPAT = discontinuedIncome !== null && pat !== null ? pat - discontinuedIncome : pat;

  // Balance Sheet
  const cash = sc(findMetric(rows, ['cash and cash equivalents', 'cash.*equivalents$', 'cash and short']));
  const totalDebt = sc(findMetric(rows, ['total borrowings', 'total debt$', 'total indebtedness', 'long.*term.*debt', 'notes payable']));
  const equity = sc(findMetric(rows, ["total stockholders.*equity", "total shareholders.*equity", "total equity$", "net worth$"]));
  const totalAssets = sc(findMetric(rows, ['total assets$']));
  const netDebt = totalDebt !== null && cash !== null ? Math.round((totalDebt - cash) * 1000) / 1000 : null;
  const capex = sc(findMetric(rows, ['capital expenditures', 'capex$', 'purchase.*property.*plant', 'purchase.*fixed assets']));
  const ar = sc(findMetric(rows, ['accounts receivable', 'trade receivable', 'debtors$']));
  const inventory = sc(findMetric(rows, ['^inventory$', '^inventories$', 'stock in trade']));
  const cfo = sc(findMetric(rows, ['net cash.*operating', 'operating activities$', 'cash.*operating activities']));
  const fcf = cfo !== null && capex !== null ? Math.round((cfo - Math.abs(capex)) * 1000) / 1000 : null;

  // Computed ratios
  const deRatio = totalDebt !== null && equity && equity > 0 ? Math.round((totalDebt / equity) * 100) / 100 : null;
  const cfoPat = cfo !== null && pat !== null && pat !== 0 ? Math.round((cfo / pat) * 100) / 100 : null;
  const roce = ebit && equity && equity > 0 ? Math.round((ebit / equity) * 10000) / 100 : null;
  const roe = pat && equity && equity > 0 ? Math.round((pat / equity) * 10000) / 100 : null;

  const orderBook = sc(findMetric(rows, ['order book$', 'order backlog$', 'backlog$']));
  const backlog = orderBook;
  const headcountMatch = rawText.match(/(\d[\d,]+)\s*(?:employees|full-time|FTEs)/i);
  const headcount = headcountMatch ? parseFloat(headcountMatch[1].replace(/,/g, '')) : null;

  // Narrative
  const themes = detectNarrativeThemes(text);
  const { guidance, keyMetrics, forwardStatements, mgmtTone } = extractManagementText(text);

  // Build partial result for validation
  const partial: Partial<RawFinancials> = { revenue, grossProfit, grossMargin, ebitda, pat, eps, cash, totalDebt, cfo };
  const validationWarnings = validateFinancials(partial, rows);
  const isDataReliable = validationWarnings.length === 0;

  return {
    company, ticker, period, periodType: 'annual', filingType, currency, scaleLabel, scaleFactor: factor,
    revenue, revPrior, grossProfit, grossMargin,
    ebitda, ebitdaMargin, opex, ebit, ebitMargin,
    interestExpense, pbt, tax, pat, patPrior, patMargin,
    eps, epsPrior, rnd, sga, da, otherIncome,
    discontinuedIncome, continuingRevenue, continuingPAT, continuingOpsDetected,
    cash, totalDebt, equity, totalAssets, netDebt, capex, ar, inventory,
    cfo, fcf,
    deRatio, cfoPat, roce, roe,
    orderBook, backlog, headcount,
    guidance, keyMetrics, forwardStatements, themes, mgmtTone,
    validationWarnings, isDataReliable,
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

function scoreAccountingQuality(d: RawFinancials): EngineOutput {
  const sigs: EngineOutput['signals'] = [];
  let score = 50;

  // Gross margin
  if (d.grossMargin !== null) {
    if (d.grossMargin >= 50)     { sigs.push({ type:'green',   text:`Gross margin ${d.grossMargin.toFixed(1)}% — premium pricing power`, weight:10 }); score+=10; }
    else if (d.grossMargin >= 30){ sigs.push({ type:'green',   text:`Gross margin ${d.grossMargin.toFixed(1)}% — healthy`, weight:5 }); score+=5; }
    else if (d.grossMargin < 10) { sigs.push({ type:'red',     text:`Gross margin ${d.grossMargin.toFixed(1)}% — extremely thin`, weight:8 }); score-=8; }
  }

  // EBITDA margin
  if (d.ebitdaMargin !== null) {
    if (d.ebitdaMargin >= 20)     { sigs.push({ type:'green',  text:`EBITDA margin ${d.ebitdaMargin.toFixed(1)}%`, weight:6 }); score+=6; }
    else if (d.ebitdaMargin < 0)  { sigs.push({ type:'red',    text:`Negative EBITDA ${d.ebitdaMargin.toFixed(1)}%`, weight:10 }); score-=10; }
  }

  // Balance sheet leverage
  if (d.deRatio !== null) {
    if (d.deRatio <= 0.1)   { sigs.push({ type:'green', text:`Virtually debt-free D/E=${d.deRatio.toFixed(2)}x`, weight:10 }); score+=10; }
    else if (d.deRatio <= 0.5) { sigs.push({ type:'green', text:`Conservative leverage D/E=${d.deRatio.toFixed(2)}x`, weight:5 }); score+=5; }
    else if (d.deRatio > 2) { sigs.push({ type:'red', text:`High leverage D/E=${d.deRatio.toFixed(2)}x`, weight:8 }); score-=8; }
  }

  if (d.cash !== null && d.totalDebt !== null && d.cash > d.totalDebt) {
    sigs.push({ type:'green', text:'Net cash company — cash exceeds total debt', weight:8 }); score+=8;
  }

  // Cash conversion
  if (d.cfoPat !== null && d.pat && d.pat > 0) {
    if (d.cfoPat >= 1.0)  { sigs.push({ type:'green',  text:`Excellent cash conversion CFO/PAT=${d.cfoPat.toFixed(2)}x`, weight:10 }); score+=10; }
    else if (d.cfoPat < 0.3) { sigs.push({ type:'red', text:`Poor cash conversion CFO/PAT=${d.cfoPat.toFixed(2)}x`, weight:7 }); score-=7; }
  } else if (d.cfo !== null && d.cfo < 0) {
    sigs.push({ type:'red', text:'Negative operating cash flow', weight:8 }); score-=8;
  }

  // FCF
  if (d.fcf !== null) {
    if (d.fcf > 0) { sigs.push({ type:'green', text:`FCF positive ${d.fcf.toFixed(1)} ${d.scaleLabel}`, weight:5 }); score+=5; }
    else { sigs.push({ type:'amber', text:`FCF negative — capex investment phase`, weight:3 }); score-=3; }
  }

  // ROCE/ROE
  if (d.roce !== null && d.roce >= 20) { sigs.push({ type:'green', text:`ROCE ${d.roce.toFixed(1)}% — above 20% moat threshold`, weight:6 }); score+=6; }
  if (d.roe !== null && d.roe >= 15)   { sigs.push({ type:'green', text:`ROE ${d.roe.toFixed(1)}%`, weight:4 }); score+=4; }

  // Data reliability warning
  if (!d.isDataReliable) {
    sigs.push({ type:'amber', text:'⚠ Some numbers may have parsing inconsistencies — verify manually', weight:0 });
    score = Math.min(score, 70); // Cap score if data uncertain
  }

  score = Math.max(10, Math.min(95, score));
  const grade = score >= 80 ? 'A+' : score >= 70 ? 'A' : score >= 60 ? 'B+' : score >= 50 ? 'B' : score >= 35 ? 'C' : 'D';
  const col = score >= 70 ? '#10b981' : score >= 55 ? '#f59e0b' : score >= 35 ? '#f97316' : '#ef4444';
  return {
    score, grade, color: col,
    label: 'Accounting Quality',
    signals: sigs,
    summary: score >= 70 ? 'Strong balance sheet and cash quality' : score >= 50 ? 'Moderate quality — watch debt and cash' : 'Quality concerns — verify underlying numbers',
  };
}

// ── ENGINE 2: EARNINGS REACTION PROBABILITY ───────────────────────────────────
// Measures: surprise + inflection + guidance + narrative + positioning factors

function scoreEarningsReaction(d: RawFinancials): EngineOutput {
  const sigs: EngineOutput['signals'] = [];
  let score = 40; // Start lower — most stocks don't make big moves

  // ── Revenue Acceleration ────────────────────────────────────────────────
  if (d.revenue && d.revPrior && d.revPrior > 0) {
    const g = ((d.revenue - d.revPrior) / d.revPrior) * 100;
    if (g >= 40)       { sigs.push({ type:'green', text:`Revenue acceleration +${g.toFixed(1)}% YoY — exceeds high-growth threshold`, weight:20 }); score+=20; }
    else if (g >= 20)  { sigs.push({ type:'green', text:`Revenue growth +${g.toFixed(1)}% YoY — meaningful acceleration`, weight:12 }); score+=12; }
    else if (g >= 10)  { sigs.push({ type:'green', text:`Revenue growth +${g.toFixed(1)}% YoY`, weight:6 }); score+=6; }
    else if (g < 0)    { sigs.push({ type:'red',   text:`Revenue decline ${g.toFixed(1)}% YoY — negative catalyst`, weight:15 }); score-=15; }
    else if (g < 5)    { sigs.push({ type:'amber', text:`Slow revenue growth +${g.toFixed(1)}% — low catalyst potential`, weight:5 }); score-=5; }
  }

  // ── MARGIN INFLECTION — most powerful single catalyst ────────────────────
  if (d.grossMargin !== null) {
    // We don't have prior gross margin in current schema, so proxy from gross profit / rev prior
    const priorGM = d.revPrior && d.revPrior > 0 && d.grossProfit ? null : null; // Can't compute without prior GP
    if (d.grossMargin >= 45) {
      sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}% — premium level, structurally significant`, weight:18 }); score+=18;
    } else if (d.grossMargin >= 30) {
      sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}% — healthy, positive for reaction`, weight:10 }); score+=10;
    } else if (d.grossMargin >= 15) {
      sigs.push({ type:'amber', text:`Gross margin ${d.grossMargin.toFixed(1)}% — moderate`, weight:5 }); score+=5;
    }
  }
  if (d.ebitdaMargin !== null && d.ebitdaMargin > 0) {
    sigs.push({ type:'green', text:`Positive EBITDA margin ${d.ebitdaMargin.toFixed(1)}% — operating leverage emerging`, weight:10 }); score+=10;
  } else if (d.ebitdaMargin !== null && d.ebitdaMargin < 0 && d.ebitdaMargin > -5) {
    sigs.push({ type:'amber', text:`Near-breakeven EBITDA ${d.ebitdaMargin.toFixed(1)}% — improvement story`, weight:5 }); score+=5;
  }

  // ── GUIDANCE / FORWARD STATEMENTS ────────────────────────────────────────
  const guidanceText = [...d.guidance, ...d.forwardStatements].join(' ').toLowerCase();
  if (/(?:pipeline|billion|contract|backlog)\s+(?:in excess of|exceeds?|of\s+over)\s+\$?\d/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Quantified large pipeline — strong forward catalyst', weight:20 }); score+=20;
  } else if (/pipeline|backlog|order book/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Pipeline/backlog commentary — positive forward signal', weight:10 }); score+=10;
  }
  if (/raised guidance|raised.*outlook|above guidance|ahead of guidance|reaffirm.*growth/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Guidance raised or reaffirmed — positive catalyst', weight:15 }); score+=15;
  }
  if (/positive.*ebitda|positive adjusted ebitda|first time.*positive|milestone.*profit/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Profitability milestone — narrative inflection catalyst', weight:15 }); score+=15;
  }

  // ── MANAGEMENT TONE ────────────────────────────────────────────────────
  if (d.mgmtTone === 'bullish')   { sigs.push({ type:'green',  text:'Management language: bullish/confident tone detected', weight:8 }); score+=8; }
  else if (d.mgmtTone === 'cautious') { sigs.push({ type:'amber', text:'Management language: cautious/hedged tone', weight:3 }); score-=3; }

  // ── NARRATIVE THEMES — thematic premium multiplier ─────────────────────
  const hotThemes = d.themes.filter(t => ['AI_INFRA','EDGE_COMPUTE','DEFENSE','DEFENSE_AI','AUTONOMY'].includes(t));
  if (hotThemes.length >= 3) {
    sigs.push({ type:'green', text:`Strong thematic alignment: ${hotThemes.length} hot themes (AI/Defense/Edge)`, weight:15 }); score+=15;
  } else if (hotThemes.length >= 1) {
    sigs.push({ type:'green', text:`Thematic exposure: ${hotThemes.map(t => NARRATIVE_THEMES.find(n=>n.tag===t)?.label).join(', ')}`, weight:8 }); score+=8;
  }

  // ── DISCONTINUED OPS — narrative clean-up ──────────────────────────────
  if (d.continuingOpsDetected) {
    sigs.push({ type:'green', text:'Divestiture/discontinued ops: post-sale = cleaner pure-play story', weight:8 }); score+=8;
  }

  // ── PAT DIRECTION (even if negative, trajectory matters) ───────────────
  if (d.pat !== null && d.patPrior !== null && d.patPrior !== 0) {
    const pg = ((d.pat - d.patPrior) / Math.abs(d.patPrior)) * 100;
    if (pg >= 50 && d.pat > 0) { sigs.push({ type:'green', text:`Profit surge +${pg.toFixed(0)}% YoY`, weight:10 }); score+=10; }
    else if (d.pat > 0 && d.patPrior < 0) { sigs.push({ type:'green', text:'Turned profitable — loss→profit inflection point', weight:15 }); score+=15; }
    else if (d.pat < 0 && Math.abs(pg) > 50) { sigs.push({ type:'red', text:`Loss deepened ${pg.toFixed(0)}% YoY`, weight:10 }); score-=10; }
  }

  score = Math.max(10, Math.min(95, score));
  const grade = score >= 80 ? 'A+' : score >= 65 ? 'A' : score >= 50 ? 'B+' : score >= 35 ? 'B' : 'C';
  const col = score >= 65 ? '#10b981' : score >= 50 ? '#f59e0b' : score >= 35 ? '#f97316' : '#ef4444';
  return {
    score, grade, color: col,
    label: 'Earnings Reaction',
    signals: sigs,
    summary: score >= 70
      ? 'Strong setup for positive earnings reaction — acceleration + narrative'
      : score >= 50
      ? 'Moderate reaction potential — some positive catalysts'
      : 'Weak reaction probability — limited surprise or catalysts',
  };
}

// ── ENGINE 3: NARRATIVE / THEMATIC SCORE ─────────────────────────────────────

function scoreNarrative(d: RawFinancials): EngineOutput & { themeList: typeof NARRATIVE_THEMES } {
  const sigs: EngineOutput['signals'] = [];
  let score = 20;

  const foundThemes = NARRATIVE_THEMES.filter(t => d.themes.includes(t.tag));
  const hotThemeTags = new Set(['AI_INFRA','EDGE_COMPUTE','DEFENSE','DEFENSE_AI','AUTONOMY','SEMI']);
  const hotCount = foundThemes.filter(t => hotThemeTags.has(t.tag)).length;

  if (hotCount >= 3)      { sigs.push({ type:'green', text:`${hotCount} hot themes — multiple premium narrative pillars`, weight:30 }); score+=30; }
  else if (hotCount >= 2) { sigs.push({ type:'green', text:`${hotCount} hot themes — strong narrative alignment`, weight:20 }); score+=20; }
  else if (hotCount >= 1) { sigs.push({ type:'green', text:`${hotCount} hot theme — some thematic premium`, weight:10 }); score+=10; }

  // Check for specific high-value keywords in the filing text
  for (const t of foundThemes) {
    sigs.push({ type:'green', text:`${t.emoji} ${t.label}`, weight: hotThemeTags.has(t.tag) ? 10 : 5 });
    score += hotThemeTags.has(t.tag) ? 10 : 5;
  }

  // Check for pipeline/TAM mentions
  if (d.guidance.some(g => /billion|\$1b|\$2b|\$5b|tam|addressable market/.test(g.toLowerCase()))) {
    sigs.push({ type:'green', text:'Large TAM or billion-dollar opportunity referenced', weight:10 }); score+=10;
  }

  score = Math.max(5, Math.min(95, score));
  const grade = score >= 70 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D';
  const col = score >= 70 ? '#a78bfa' : score >= 50 ? '#818cf8' : score >= 30 ? '#6366f1' : '#4338ca';
  return {
    score, grade, color: col,
    label: 'Narrative / Theme',
    signals: sigs,
    summary: foundThemes.length >= 3
      ? `${foundThemes.length} themes: ${foundThemes.slice(0,3).map(t=>t.label).join(', ')}`
      : foundThemes.length > 0
      ? `Themes: ${foundThemes.map(t=>t.label).join(', ')}`
      : 'No strong thematic premium detected',
    themeList: foundThemes,
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
    return (
      <div style={{background:BG,minHeight:'100vh',color:TEXT,fontFamily:'system-ui,-apple-system,sans-serif',padding:'20px 16px',maxWidth:1200,margin:'0 auto'}}>

        {/* ── COMPANY HEADER ── */}
        <div style={{backgroundColor:CARD,border:`1px solid ${BORDER}`,borderRadius:14,padding:'18px 20px',marginBottom:16}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:16,flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:4}}>
                <h1 style={{fontSize:22,fontWeight:900,color:TEXT,margin:0}}>{d.company}</h1>
                {d.ticker && <span style={{fontSize:11,fontWeight:800,color:ACCENT,backgroundColor:ACCENT+'18',padding:'2px 8px',borderRadius:4}}>{d.ticker}</span>}
                {d.continuingOpsDetected && <span style={{fontSize:10,fontWeight:700,color:YELLOW,backgroundColor:YELLOW+'14',padding:'2px 8px',borderRadius:4}}>⚠ Discontinued Ops Detected</span>}
              </div>
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
              </div>

              {/* Theme badges */}
              {nar.themeList.length > 0 && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                  {nar.themeList.map(t=>(
                    <span key={t.tag} style={{fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:20,backgroundColor:t.color+'18',color:t.color,border:`1px solid ${t.color}30`}}>
                      {t.emoji} {t.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Validation warnings */}
              {d.validationWarnings.length > 0 && (
                <div style={{backgroundColor:YELLOW+'0e',border:`1px solid ${YELLOW}30`,borderRadius:8,padding:'8px 12px'}}>
                  <div style={{fontSize:10,fontWeight:700,color:YELLOW,marginBottom:4}}>⚠ Data Validation Warnings</div>
                  {d.validationWarnings.map((w,i)=>(
                    <div key={i} style={{fontSize:10,color:MUTED}}>{w}</div>
                  ))}
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

        {/* ── MAIN CONTENT GRID ── */}
        <div style={{display:'grid',gridTemplateColumns:'minmax(300px,2fr) minmax(280px,1fr)',gap:14,marginBottom:14}}>

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

        {/* ── NARRATIVE THEMES ── */}
        {nar.themeList.length > 0 && (
          <div style={{backgroundColor:CARD2,border:`1px solid ${PURPLE}25`,borderRadius:12,padding:'14px 18px',marginBottom:14}}>
            <div style={{fontSize:F.sm,fontWeight:800,color:PURPLE,marginBottom:10}}>🌐 NARRATIVE THEMES DETECTED</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:8}}>
              {nar.themeList.map(t=>(
                <div key={t.tag} style={{padding:'10px 12px',backgroundColor:t.color+'0e',border:`1px solid ${t.color}25`,borderRadius:8,borderLeft:`3px solid ${t.color}`}}>
                  <div style={{fontSize:F.md,marginBottom:3}}>{t.emoji}</div>
                  <div style={{fontSize:F.xs,fontWeight:700,color:t.color}}>{t.label}</div>
                  <div style={{fontSize:9,color:MUTED,marginTop:3,lineHeight:1.4}}>
                    {t.keywords.slice(0,3).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,fontSize:F.xs,color:MUTED,lineHeight:1.6}}>
              💡 Narrative matters: stocks in AI/Defense/Edge themes trade on TAM expansion and strategic positioning, not just current ROE.
              The market assigns premium multiples for thematic relevance — especially on small-cap names where float is thin and narrative acceleration can trigger violent repricing.
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
