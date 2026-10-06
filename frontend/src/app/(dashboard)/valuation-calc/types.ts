// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type SavedValuation } from '@/lib/valuation-calculators';

export type CalcKind = 'FAIR_VALUE' | 'PS' | 'PE' | 'EV_EBITDA' | 'REVERSE_DCF' | 'MORE' | 'ANALYTICS' | 'LEARN';
// PATCH 0858 — recompute a saved valuation's BASE fair value + upside from its
// frozen inputs (same technique the Analytics tab uses). fairValue is the BASE
// target stock price (independent of current price), priceAtSave is the price
// captured in inputs.currentPrice at save time, savedUpside is the frozen
// (fairValue − priceAtSave)/priceAtSave the row was saved with.
export type EnrichedSaved = {
  v: SavedValuation;
  fairValue?: number;
  priceAtSave?: number;
  savedUpside?: number;
  currency: '₹' | '$';
  isUS: boolean;
};
// ═══════════════════════════════════════════════════════════════════════════
// SECTOR SCENARIOS (PATCH 0674)
//
// Real-time worked example for ONE representative company per sector row.
// Triggered when user expands the sector row in the lookup table.
// Same calc the user would run by hand — input table → math → fair value.
// All inputs are approximate (TTM revenue, mcap) — marked with ~.
// ═══════════════════════════════════════════════════════════════════════════

export interface SectorScenario {
  ticker: string;
  company: string;
  method: 'PE' | 'PS' | 'EV_EBITDA';
  // Input
  driverLabel: string;   // "Forward PAT (FY27)" / "Forward Revenue (FY27)" / "Forward EBITDA (FY27)"
  driverValue: number;   // ₹ Cr
  multiple: number;      // base multiple
  currentMcap: number;   // ₹ Cr
  netDebt?: number;      // for EV/EBITDA
  // Note for analyst
  rationale: string;
}
// ═══════════════════════════════════════════════════════════════════════════
// LEARN TAB (PATCH 0658)
//
// Institutional catalog of how managements give forward guidance and how
// to derive fair-value upside from each phrasing. 12 patterns total,
// drawn from a 23-company sample. Each pattern has:
//   - Description
//   - Example phrasings (real company quotes)
//   - Variables you need
//   - Formula
//   - Worked example with real numbers
//   - Fair value + upside derivation
// ═══════════════════════════════════════════════════════════════════════════

export interface GuidanceMethod {
  id: string;
  emoji: string;
  title: string;
  description: string;
  examples: Array<{ company: string; quote: string }>;
  variables: string[];
  formula: string[];          // multi-line monospace
  worked: {
    company: string;
    inputs: Array<{ label: string; value: string }>;
    steps: Array<{ label: string; calc: string; result: string }>;
    fairValue: string;
    upside: string;
  };
  tips?: string[];
}
// ═══════════════════════════════════════════════════════════════════════════
// PRACTICE EXAMPLES (PATCH 0659)
//
// Worked valuations for all 23 companies in the user's guidance table.
// Each example carries: the actual guidance quote, the pattern applied,
// approximate TTM revenue + market cap anchors, sector multiple, full
// step-by-step calculation, fair value, and upside. Notes call out
// which inputs are approximate vs. guidance-given so the user can swap
// in precise numbers when they have them.
// ═══════════════════════════════════════════════════════════════════════════

export interface PracticeExample {
  company: string;
  ticker?: string;
  sector: string;
  guidance: string;
  pattern: string;           // matches Pattern # from GUIDANCE_METHODS
  // PATCH 0661 — tag with one or more methodIds for cross-linking back
  // from the 12-pattern table. Most examples use 1 pattern; combos
  // (e.g. Aeroflex uses EBITDA growth + Peak revenue) list both.
  methodIds: string[];
  inputs: Array<{ label: string; value: string; approx?: boolean }>;
  steps: Array<{ label: string; calc: string; result: string }>;
  fairValue: string;
  upside: string;
  upsideColor: string;       // green / amber / red
  note?: string;
}
