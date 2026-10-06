// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { NARRATIVE_THEMES } from './constants';

// ═════════════════════════════════════════════════════════════════════════════
// EXTRACTION ENGINE v3 — ROBUST UNIT-AWARE PARSER WITH VALIDATION
// Key changes from v2:
// 1. Validates that ratios are consistent (if gross margin = 49% and revenue = X,
//    then gross profit should be ~0.49*X — auto-corrects scale if not)
// 2. Multiple extraction strategies — picks the most internally consistent parse
// 3. Separates continuing vs discontinued operations
// 4. Better pattern matching for messy PDF.js text
// ═════════════════════════════════════════════════════════════════════════════

export interface RawFinancials {
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
// ── STEP 2: Extract all numbers with their labels ────────────────────────────
// Returns array of {label, nums: number[]} — nums are RAW, not scaled

export interface LabeledNum { label: string; nums: number[]; rawLine: string }
// ── STEP 3b: Detect the "current period" column index ─────────────────────────
// Multi-period tables (quarterly supplements, Indian results) have multiple date columns.
// We must select the MOST RECENT column, not column 0.
//
// Examples:
//   Fastly: "Q2 2024  Q3 2024  Q4 2024  Q1 2025 ... Q1 2026" → 8 cols, current = col 7
//   Aeroflex: "31.03.2026  31.12.2025  31.03.2025  31.03.2026  31.03.2025" → current = col 3 (year)
//   SEC 10-K 2-col: "2025  2024" → current = col 0 (first col IS current)

export interface ColDetection { curIdx: number; priorIdx: number; colCount: number; reason: string }
// ── STEP 5: Validate and cross-check — detect impossible relationships ────────

// ── VALIDATION FIREWALL ───────────────────────────────────────────────────────
// Hard rules: any metric that fails is nullified BEFORE reaching the UI.
// Impossible numbers MUST NEVER appear in the output.
// These rules encode financial reality: margins can't exceed 100%, etc.

export interface MetricBounds { min: number; max: number; name: string }
// ═════════════════════════════════════════════════════════════════════════════
// TABLE-BLOCK EXTRACTION ENGINE
// The canonical approach: document classification → canonical section → table parsing
// All three document types (SEC annual, SEC supplement, India exchange) use one pipeline.
// ═════════════════════════════════════════════════════════════════════════════

export type DocumentType = 'SEC_ANNUAL' | 'SEC_QUARTERLY' | 'SEC_SUPPLEMENT' | 'INDIA_EXCHANGE' | 'INDIA_ANNUAL' | 'UNKNOWN';
export type RowRole = 'header' | 'section_label' | 'line_item' | 'unlabeled_total' | 'labeled_total' | 'percentage' | 'footnote_def' | 'blank';
export interface TableRow2 {
  rawLine: string;
  cleanLabel: string;
  values: (number | null)[];      // raw, unscaled values per column
  isNeg: boolean[];               // parenthetical-negative flag per column
  role: RowRole;
  sectionCtx: string;             // e.g. 'revenue', 'cost', 'operating', 'other'
  indentLevel: number;            // 0=top, 1=sub-item, 2=deeper
}
export interface TableBlock {
  sectionName: string;
  rows: TableRow2[];
  numCols: number;
  curColIdx: number;
  priorColIdx: number;
  scale: { factor: number; scaleLabel: string };
  docType: DocumentType;
  confidence: number;             // 0–100
}
// ═════════════════════════════════════════════════════════════════════════════
// THREE-ENGINE SCORING SYSTEM
// Engine 1: Accounting Quality  — for long-term fundamental investors
// Engine 2: Earnings Reaction   — for event-driven / short-term traders
// Engine 3: Narrative Score     — thematic / momentum premium
// ═════════════════════════════════════════════════════════════════════════════

export interface EngineOutput {
  score: number;          // 0–100
  grade: string;          // A+/A/B/C/D
  color: string;
  label: string;          // Short label
  signals: { type: 'green'|'red'|'amber'|'neutral'; text: string; weight: number }[];
  summary: string;        // 1-sentence verdict
}
// ── ENGINE 3: NARRATIVE / THEMATIC SCORE ─────────────────────────────────────
// Theme confidence tiers:
//   CORE (80-95%): multiple specific keywords, clearly central to business
//   ADJACENT (40-70%): present but not core business
//   WEAK (<40%): incidental mention — shown as context, not scored
//
// Score max 80 — a narrative score of 90+ should require 3+ confirmed hot themes

export interface ThemeDetection { theme: typeof NARRATIVE_THEMES[0]; confidence: number; tier: 'core'|'adjacent'|'weak' }
export interface HistEntry2 { id: string; company: string; period: string; q: number; r: number; n: number; color: string; summary: string; at: string; }
