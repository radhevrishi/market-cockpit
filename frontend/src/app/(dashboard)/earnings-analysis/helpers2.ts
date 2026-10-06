// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { METRIC_BOUNDS, NARRATIVE_THEMES, THEME_MIN_MATCHES } from './constants';
import { detectScaleFromText, detectColumnIndices, cleanOCRText, detectCurrency, extractAllNumbers, detectScaleFromNumbers, findMetric, findRevenue } from './helpers';
import { type MetricBounds, type RawFinancials, type LabeledNum, type DocumentType, type RowRole, type TableRow2, type TableBlock } from './types';

/** Nullify a metric if it falls outside the plausible range for that metric.
 *  Returns null (invalid) or the original value (valid). */
export function guardMetric(value: number | null, bounds: MetricBounds): number | null {
  if (value === null) return null;
  if (value < bounds.min || value > bounds.max) return null;
  return value;
}
/** Apply all financial sanity guards to a partial RawFinancials object.
 *  MUTATES the object in place, nullifying impossible values. */
export function sanitizeMetrics(d: Partial<RawFinancials>): string[] {
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
export function validateFinancials(d: Partial<RawFinancials>, _rows: LabeledNum[]): string[] {
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
export function detectNarrativeThemes(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  for (const theme of NARRATIVE_THEMES) {
    const minMatch = THEME_MIN_MATCHES[theme.tag] ?? 1;
    const matchCount = theme.keywords.filter(kw => t.includes(kw)).length;
    if (matchCount >= minMatch) found.push(theme.tag);
  }
  return found;
}
export function extractManagementText(text: string): {
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

export function detectDiscontinued(text: string): { detected: boolean; discontinuedIncome: number|null; continuingRevNote: string } {
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
// ── 1. DOCUMENT CLASSIFICATION ───────────────────────────────────────────────

export function classifyDocumentType(text: string): DocumentType {
  const t = text.toLowerCase();
  if (/annual report on form 10-k|form 10-k\b/.test(t)) return 'SEC_ANNUAL';
  if (/quarterly report on form 10-q/.test(t)) return 'SEC_QUARTERLY';
  if (/investor supplement|first quarter 20\d{2}.*supplement|q[1-4] 20\d{2}.*supplement/i.test(text)) return 'SEC_SUPPLEMENT';
  if (/consolidated financial results.*sebi|sebi.*listing obligations|regulation 33/i.test(text)) return 'INDIA_EXCHANGE';
  if (/annual report.*india|statements? of profit and loss|ind as/i.test(t)) return 'INDIA_ANNUAL';
  return 'UNKNOWN';
}
// ── 2. CANONICAL P&L SECTION FINDER ──────────────────────────────────────────
// Each document type has a known canonical location for the primary financial table.
// We always prefer the FINANCIAL TABLE over narrative summary bullets.

export function findCanonicalPLSection(text: string, docType: DocumentType): { text: string; scaleLine: string } | null {
  // Pattern libraries per doc type (ordered by confidence)
  const SEC_ANNUAL_ANCHORS = [
    /consolidated statements? of operations/i,
    /results of operations/i,
  ];
  const SEC_SUPPLEMENT_ANCHORS = [
    /consolidated statements? of operations.*quarterly/i,
    /consolidated statements? of operations/i,
  ];
  const INDIA_ANCHORS = [
    /(?:inr|rs\.?|₹)\s+in\s+(?:lakhs?|crores?)/i,
    /statement of (?:consolidated|standalone) financial results/i,
    /financial results? for the (?:quarter|year)/i,
  ];

  const anchors =
    docType === 'SEC_ANNUAL'    ? SEC_ANNUAL_ANCHORS :
    docType === 'SEC_SUPPLEMENT'? SEC_SUPPLEMENT_ANCHORS :
    docType === 'SEC_QUARTERLY' ? SEC_SUPPLEMENT_ANCHORS :
    INDIA_ANCHORS;

  for (const anchor of anchors) {
    const match = anchor.exec(text);
    if (!match) continue;

    // Look ahead for scale declaration line
    const lookAhead = text.slice(match.index, match.index + 5000);
    const scaleLine = lookAhead.match(/\(unaudited[^)]*in thousands[^)]*\)|\(in thousands[^)]*\)|inr in lakhs?|inr in crores?|\(₹ in lakhs?\)|\(in millions\)/i)?.[0] ?? '';

    // Extract the section: from anchor to next major heading or ~150 lines
    const lines = lookAhead.split('\n');
    const sectionLines: string[] = [];
    let blankStreak = 0;
    for (let i = 0; i < Math.min(lines.length, 120); i++) {
      const l = lines[i].trim();
      // Stop at next major financial statement heading (but not sub-headings)
      if (i > 20 && /^(?:consolidated (?:balance sheets?|statements? of (?:stockholders|cash flows?|comprehensive))|notes? to consolidated|part i[^iv]|item \d+[^.])/i.test(l)) break;
      if (!l) blankStreak++; else blankStreak = 0;
      if (blankStreak > 4) break;
      sectionLines.push(lines[i]);
    }

    const sectionText = sectionLines.join('\n');
    if (sectionText.length > 200) {
      return { text: sectionText, scaleLine };
    }
  }
  return null;
}
// ── 3. TABLE-BLOCK PARSER ─────────────────────────────────────────────────────
// Converts raw section text into structured TableRow2 objects with role detection.

export function detectRowRole(label: string, values: (number|null)[], isNeg: boolean[], prevRole: RowRole, sectionCtx: string): RowRole {
  const lbl = label.trim().toLowerCase();
  // Blank
  if (!label.trim() && values.every(v => v === null)) return 'blank';
  // Header row: multiple date/period labels
  if (/\b(20\d{2}|q[1-4]\s*20\d{2}|\d{2}[./]\d{2}[./]20\d{2}|ytd|h[12])\b/i.test(label) && values.filter(v=>v!==null).length < 3) return 'header';
  // Footnote definition: starts with small integer then text
  if (/^\d{1,2}[\s.]/.test(label) && label.length < 80 && values.every(v=>v===null)) return 'footnote_def';
  // Section label: no numbers, looks like a category header
  if (values.every(v => v === null) && label.trim().length > 2) return 'section_label';
  // Percentage row: values in 0-100% range AND label contains "margin" or "%"
  if (/%|margin|rate\b/.test(lbl) && values.filter(v=>v!==null).every(v=>v!==null && Math.abs(v!)<=100)) return 'percentage';
  // Unlabeled total: no label but has numbers (sub-total row in SEC format)
  if (!label.trim() && values.some(v => v !== null)) return 'unlabeled_total';
  // Labeled total: "total ...", "gross profit", "loss from operations", "net income/loss"
  if (/^(?:total|gross profit|gross margin|(?:loss|income) from operations|net (?:income|loss|revenue)|operating (?:income|loss))/.test(lbl)) return 'labeled_total';
  return 'line_item';
}
export function parseTableRow2(rawLine: string, prevRow: TableRow2 | null, sectionCtx: string): TableRow2 {
  const line = rawLine;
  // Number extraction: match both regular and parenthetical negatives
  const numRe = /(\([\d,]+(?:\.\d+)?\)|\$?\s*[\d,]+(?:\.\d+)?%?)/g;
  const values: (number|null)[] = [];
  const isNeg: boolean[] = [];
  let m: RegExpExecArray | null;
  numRe.lastIndex = 0;
  while ((m = numRe.exec(line)) !== null) {
    const raw = m[1].replace(/[\$,()%\s]/g, '');
    const n = parseFloat(raw);
    if (!isNaN(n) && raw.length > 0) {
      const neg = m[1].startsWith('(');
      values.push(neg ? -n : n);
      isNeg.push(neg);
    }
  }

  // Label: everything before first significant number
  const firstNumIdx = line.search(/\(?\$?\s*\d[\d,]*(?:\.\d+)?/);
  const rawLabel = firstNumIdx > 0 ? line.slice(0, firstNumIdx) : (values.length === 0 ? line : '');
  // Clean label: remove footnote superscripts (1) (2), leading spaces, special chars
  const cleanLabel = rawLabel.replace(/\(\d{1,2}\)|\s*\d{1,2}\s*$|\(1\)|\(2\)|\(3\)/g, '').replace(/[_|]/g, '').trim();

  // Count leading spaces as indent level
  const indentLevel = Math.floor((rawLine.length - rawLine.trimStart().length) / 2);

  const role = detectRowRole(cleanLabel, values, isNeg, prevRow?.role ?? 'blank', sectionCtx);
  return { rawLine, cleanLabel, values, isNeg, role, sectionCtx, indentLevel };
}
export function parseTableBlock(sectionText: string, docType: DocumentType, currency: string): TableBlock {
  const lines = sectionText.split('\n');

  // Detect scale
  const textScale = detectScaleFromText(sectionText);
  const scalePlaceholder = { factor: 1, scaleLabel: currency === 'INR' ? '₹ Cr' : '$ Mn' };

  // Parse rows
  const rows: TableRow2[] = [];
  let headerRow: TableRow2 | null = null;
  let sectionCtx = '';
  let prevRow: TableRow2 | null = null;

  for (const line of lines) {
    const row = parseTableRow2(line, prevRow, sectionCtx);
    if (row.role === 'section_label') {
      const lbl = row.cleanLabel.toLowerCase();
      if (/revenue/.test(lbl)) sectionCtx = 'revenue';
      else if (/cost of/.test(lbl)) sectionCtx = 'cost';
      else if (/operating exp/.test(lbl)) sectionCtx = 'opex';
      else if (/other income|interest/.test(lbl)) sectionCtx = 'other';
      row.sectionCtx = sectionCtx;
    } else if (row.role === 'header' && !headerRow && rows.length < 8) {
      headerRow = row;
    }
    rows.push(row);
    prevRow = row;
  }

  // Determine columns using existing detectColumnIndices
  const rowsForColDetect: LabeledNum[] = rows.map(r => ({ label: r.cleanLabel, nums: r.values.filter(v=>v!==null) as number[], rawLine: r.rawLine }));
  const { curIdx, priorIdx, colCount } = detectColumnIndices(sectionText, rowsForColDetect);

  // Scale detection: use text declaration or infer from max revenue value
  let scale = textScale;
  if (!scale) {
    // Find the best revenue-like row and infer scale
    const revRow = rows.find(r =>
      /revenue from operations|^(?:total )?revenue$|^net sales$/i.test(r.cleanLabel) ||
      (r.role === 'unlabeled_total' && r.sectionCtx === 'revenue')
    );
    const revVal = revRow?.values[Math.min(curIdx, (revRow?.values.length??1)-1)];
    if (revVal && revVal > 0) {
      // Same boundaries as detectScaleFromNumbers
      if (revVal >= 1e6) scale = { factor: currency === 'INR' ? 1e-5 : 1e-6, scaleLabel: currency === 'INR' ? '₹ Cr' : '$ Mn' };
      else if (revVal >= 1e3) scale = { factor: currency === 'INR' ? 1e-2 : 1e-3, scaleLabel: currency === 'INR' ? '₹ Cr' : '$ Mn' };
      else scale = { factor: 1, scaleLabel: currency === 'INR' ? '₹ Cr' : '$ Mn' };
    }
  }

  const finalScale = scale ?? scalePlaceholder;

  // Confidence: based on how many canonical rows we found
  const hasRevenue = rows.some(r => /revenue|net sales/i.test(r.cleanLabel) || r.sectionCtx === 'revenue');
  const hasGrossProfit = rows.some(r => /gross profit/i.test(r.cleanLabel));
  const hasNetIncome = rows.some(r => /net (?:income|loss)/i.test(r.cleanLabel));
  const confidence = (hasRevenue ? 40 : 0) + (hasGrossProfit ? 30 : 0) + (hasNetIncome ? 30 : 0);

  return { sectionName: '', rows, numCols: colCount, curColIdx: curIdx, priorColIdx: priorIdx, scale: finalScale, docType, confidence };
}
// ── 4. METRIC EXTRACTION FROM TABLE BLOCK ────────────────────────────────────
// Pulls metrics from the canonical table with a strict locking hierarchy.

export function getCol(row: TableRow2, colIdx: number): number | null {
  const v = row.values[Math.min(colIdx, row.values.length - 1)];
  return v ?? null;
}
export function findRevenueInBlock(block: TableBlock): { cur: number|null; prior: number|null; source: string } {
  const { rows, curColIdx: ci, priorColIdx: pi } = block;

  // Tier 1: labeled "total revenue" / "revenue from operations"
  for (const row of rows) {
    if (/^(?:total )?revenues?$|^net (?:revenue|sales)$|^revenue from operations$/i.test(row.cleanLabel.trim())) {
      const cur = getCol(row, ci);
      if (cur && cur > 0) return { cur, prior: getCol(row, pi), source: 'labeled_row' };
    }
  }

  // Tier 2: unlabeled subtotal row in the revenue section
  let inRevSection = false;
  for (const row of rows) {
    if (row.role === 'section_label' && /revenue/i.test(row.cleanLabel)) { inRevSection = true; continue; }
    if (inRevSection && row.role === 'section_label') { inRevSection = false; } // left revenue section
    if (inRevSection && row.role === 'unlabeled_total') {
      const cur = getCol(row, ci);
      if (cur && cur > 0) return { cur, prior: getCol(row, pi), source: 'unlabeled_subtotal' };
    }
  }

  // Tier 3: sum of revenue sub-items (first occurrence only, stop at cost section)
  const SUB = /^(?:product|products?|service|services?|subscription|license|customer funded|hardware|software|recurring|professional)\b/i;
  const seenLabels = new Set<string>();
  const subItems: TableRow2[] = [];
  for (const row of rows) {
    if (/^cost of/i.test(row.cleanLabel)) break;
    if (SUB.test(row.cleanLabel) && !seenLabels.has(row.cleanLabel.toLowerCase())) {
      seenLabels.add(row.cleanLabel.toLowerCase());
      subItems.push(row);
    }
  }
  if (subItems.length >= 2) {
    const cur = subItems.reduce((s, r) => s + (getCol(r, ci) ?? 0), 0);
    const prior = subItems.reduce((s, r) => s + (getCol(r, pi) ?? 0), 0);
    if (cur > 0) return { cur, prior: prior > 0 ? prior : null, source: 'sum_sub_items' };
  }

  return { cur: null, prior: null, source: 'not_found' };
}
export function extractFromTableBlock(block: TableBlock): Partial<RawFinancials> & { revenueSource: string; tableConfidence: number } {
  const { rows, curColIdx: ci, priorColIdx: pi, scale } = block;
  const f = scale.factor;  // scale factor applied ONCE here

  const sc = (v: number|null) => v !== null ? Math.round(v * f * 1000) / 1000 : null;

  // Revenue with locking
  const revResult = findRevenueInBlock(block);
  const revenue = sc(revResult.cur);
  const revPrior = sc(revResult.prior);

  // Helper to find a row by label patterns
  const findRow = (patterns: RegExp[]): TableRow2 | undefined =>
    rows.find(r => patterns.some(p => p.test(r.cleanLabel)));

  const gpRow   = findRow([/^gross profit/i]);
  const ebitRow = findRow([/(?:loss|income) from operations/i, /operating (?:income|loss)/i, /ebit\b/i]);
  const netRow  = findRow([/^net (?:income|loss)\b/i, /^net income.*loss/i]);
  const rndRow  = findRow([/^research and development\b/i, /^r&d\b/i]);
  const sgaRow  = findRow([/selling.*general.*admin/i, /^general.*administrative\b/i, /^sales and marketing\b/i]);
  const intRow  = findRow([/^interest expense/i, /finance costs/i]);
  const taxRow  = findRow([/provision for income tax/i, /^income tax expense/i, /^tax expense/i]);
  const pbtRow  = findRow([/before.*income tax/i, /profit before tax/i, /^pbt\b/i]);

  const getV = (row: TableRow2 | undefined, col: number): number | null =>
    row ? getCol(row, col) : null;

  const grossProfit = sc(getV(gpRow, ci));
  const ebit        = sc(getV(ebitRow, ci));
  const pat         = sc(getV(netRow, ci));
  const patPrior    = sc(getV(netRow, pi));
  const rnd         = sc(getV(rndRow, ci));
  const sga         = sc(getV(sgaRow, ci));
  const interestExpense = sc(getV(intRow, ci));
  const tax         = sc(getV(taxRow, ci));
  const pbt         = sc(getV(pbtRow, ci));

  // Gross margin: stated % row OR computed
  const gmPctRow = findRow([/^gaap gross margin/i, /^gross margin/i]);
  let grossMargin: number | null = null;
  if (gmPctRow) {
    const v = getV(gmPctRow, ci);
    if (v !== null && Math.abs(v) <= 100) grossMargin = v;
  }
  if (!grossMargin && grossProfit && revenue && revenue > 0) {
    grossMargin = Math.round((grossProfit / revenue) * 10000) / 100;
  }

  // EBITDA
  const daRow = findRow([/depreciation and amortization/i, /^depreciation\b/i]);
  const da = sc(getV(daRow, ci));
  let ebitda: number | null = null;
  if (ebit !== null && da !== null) ebitda = Math.round((ebit + Math.abs(da)) * 1000) / 1000;

  return {
    revenue, revPrior, grossProfit, grossMargin,
    ebit, ebitMargin: ebit && revenue && revenue > 0 ? Math.round((ebit/revenue)*10000)/100 : null,
    ebitda, ebitdaMargin: ebitda && revenue && revenue > 0 ? Math.round((ebitda/revenue)*10000)/100 : null,
    pat, patPrior, patMargin: pat && revenue && revenue > 0 ? Math.round((pat/revenue)*10000)/100 : null,
    rnd, sga, interestExpense, tax, pbt, da,
    revenueSource: revResult.source,
    tableConfidence: block.confidence,
    scaleLabel: scale.scaleLabel,
    scaleFactor: scale.factor,
  };
}
// ── STEP 8: MAIN EXTRACTION ────────────────────────────────────────────────────

export function parseEarnings(rawText: string): RawFinancials {
  // Apply OCR cleanup first — removes boilerplate, footnote markers, OCR noise
  const text = cleanOCRText(rawText);
  const { currency, filingType } = detectCurrency(text);
  const docType = classifyDocumentType(text);

  // ══════════════════════════════════════════════════════════════════════════
  // PRIMARY PATH: CANONICAL-TABLE-FIRST EXTRACTION
  // Step 1: Find the canonical P&L section (Consolidated Statements of Operations etc.)
  // Step 2: Parse as a structured table block with row roles
  // Step 3: Extract metrics with strict locking hierarchy
  // Step 4: Fall back to label-based extraction for anything missing
  // ══════════════════════════════════════════════════════════════════════════

  let canonicalMetrics: (Partial<RawFinancials> & { revenueSource?: string; tableConfidence?: number }) | null = null;
  const canonicalSection = findCanonicalPLSection(text, docType);

  if (canonicalSection) {
    const block = parseTableBlock(canonicalSection.text, docType, currency);
    canonicalMetrics = extractFromTableBlock(block);
  }

  // ── FALLBACK: label-based extraction (existing approach) ──────────────────
  // Extract labeled rows from full document (for metrics not in canonical section)
  const rows = extractAllNumbers(text);

  // Scale detection: use canonical block's scale if available, else detect from text/numbers
  const textScale = detectScaleFromText(text);
  const { curIdx, priorIdx, colCount, reason: colReason } = detectColumnIndices(text, rows);

  // Prefer canonical metrics' scale if available (it was derived from the canonical section)
  const canonicalScale = canonicalMetrics?.scaleLabel && canonicalMetrics?.scaleFactor
    ? { factor: canonicalMetrics.scaleFactor, scaleLabel: canonicalMetrics.scaleLabel }
    : null;
  const { factor, scaleLabel } = canonicalScale ?? textScale ?? detectScaleFromNumbers(rows, currency, curIdx);

  const sc = (v: number|null): number|null => v !== null ? Math.round(v * factor * 1000) / 1000 : null;
  const fm = (patterns: string[]) => findMetric(rows, patterns, curIdx);
  const fmp = (patterns: string[]) => findMetric(rows, patterns, priorIdx);

  // Merge: canonical metrics take priority; fallback fills in anything missing
  // Revenue: canonical table wins; if missing, try label-based
  const { cur: rawRevCur, prior: rawRevPrior } = findRevenue(rows, curIdx, priorIdx, factor);
  const revenue    = canonicalMetrics?.revenue    ?? sc(rawRevCur);
  const revPrior   = canonicalMetrics?.revPrior   ?? sc(rawRevPrior);
  const revenueSourceStr = canonicalMetrics?.revenueSource ?? (rawRevCur ? 'label_fallback' : 'not_found');

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

  // ── P&L — canonical metrics take priority, fallback fills gaps ────────────────
  // Revenue already resolved above (canonical + fallback merge)

  // Prefer canonical table values; fill in with label-based if null
  const grossProfit = canonicalMetrics?.grossProfit
    ?? sc(fm(['gross profit', 'total gross profit', 'gross profit$']));
  const grossMarginStated = fm(['gaap gross margin', 'gross margin', 'gross profit %', 'gross profit margin']);
  const grossMargin = canonicalMetrics?.grossMargin
    ?? ((grossMarginStated && Math.abs(grossMarginStated) <= 100) ? grossMarginStated
    : (grossProfit && revenue && revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : null));

  const da = canonicalMetrics?.da
    ?? sc(fm(['depreciation and amortization', 'depreciation.*amortization', 'depreciation expense', 'depreciation$']));

  const ebit = canonicalMetrics?.ebit
    ?? sc(fm(['income from operations', 'loss from operations', 'operating income$', 'ebit$']));
  const ebitMargin = (ebit && revenue && revenue > 0) ? Math.round((ebit / revenue) * 10000) / 100 : null;

  let ebitda = canonicalMetrics?.ebitda
    ?? sc(fm(['adjusted ebitda', 'total adjusted ebitda'])) ?? sc(fm(['ebitda$']));
  if (!ebitda && ebit !== null && da !== null) ebitda = Math.round((ebit + Math.abs(da)) * 1000) / 1000;
  const ebitdaMargin = (ebitda && revenue && revenue > 0) ? Math.round((ebitda / revenue) * 10000) / 100 : null;

  const opex = sc(fm(['total operating expenses', 'total opex', 'total expenses']));
  const rnd = canonicalMetrics?.rnd ?? sc(fm(['research and development', 'r&d expense', 'r&d$']));
  const sga = canonicalMetrics?.sga ?? sc(fm(['selling.*general.*admin', 'general.*administrative',
                   'sg&a$', 'selling.*marketing', 'sales and marketing']));
  const interestExpense = canonicalMetrics?.interestExpense
    ?? sc(fm(['interest expense', 'finance costs', 'interest cost', 'borrowing cost']));
  const otherIncome = sc(fm(['other income', 'other income.*net', 'non-operating income']));
  const pbt = canonicalMetrics?.pbt ?? sc(fm(['income.*before.*tax', 'loss.*before.*tax', 'profit before.*tax', 'pbt$']));
  const tax = canonicalMetrics?.tax ?? sc(fm(['provision for income tax', 'income tax.*expense', 'tax expense$']));

  const pat = canonicalMetrics?.pat
    ?? sc(fm(['net income$', 'net loss$', 'net income.*loss', 'net profit$', 'pat$',
              'profit after tax', 'profit.*loss.*for.*period', 'profit.*loss.*for.*year']));
  const patPrior = canonicalMetrics?.patPrior
    ?? sc(fmp(['net income', 'net loss', 'net profit', 'pat$', 'profit.*period']));
  const patMargin = (pat && revenue && revenue > 0) ? Math.round((pat / revenue) * 10000) / 100 : null;

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
  const grossMarginValid = r.grossMargin !== null;
  const patValid = r.pat !== null;
  const coreFailed = sanitizationIssues.filter(s => s.includes('extraction failed') || s.includes('Revenue near-zero')).length > 0;
  // Declare here so they're available in the conditions below
  const canonicalBoost = canonicalSection ? 15 : 0;
  const tableConf = canonicalMetrics?.tableConfidence ?? 0;

  let parseState: RawFinancials['parseState'];
  let parseConfidence: number;

  if (coreFailed || !revenueValid) {
    parseState = 'failed';
    parseConfidence = Math.min(20, 5 + canonicalBoost);
  } else if (sanitizationIssues.length > 2 || (!grossMarginValid && !patValid)) {
    parseState = 'partial';
    parseConfidence = Math.min(65, 45 + canonicalBoost + Math.floor(tableConf / 5));
  } else if (sanitizationIssues.length === 0 && textScale !== null) {
    // Explicit scale declaration + canonical section + no failures = highest confidence
    parseState = 'verified';
    parseConfidence = Math.min(95, 80 + canonicalBoost);
  } else if (sanitizationIssues.length === 0) {
    parseState = 'verified';
    parseConfidence = Math.min(85, 65 + canonicalBoost);
  } else {
    parseState = 'partial';
    parseConfidence = Math.min(65, 50 + canonicalBoost);
  }

  // What source did revenue come from (for display)
  const revenueSource = revenueValid ? revenueSourceStr : 'not_found';

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
