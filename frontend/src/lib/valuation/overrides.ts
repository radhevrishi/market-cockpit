// ═══════════════════════════════════════════════════════════════════════════
// VALUATION ENGINE — user override storage (localStorage)
//
// Users can edit any sector default assumption on a per-stock basis.
// Overrides persist across uploads, clears, and tabs.
// ═══════════════════════════════════════════════════════════════════════════

import type { ValuationInputs } from './types';

export interface ValuationOverrides {
  guidanceGrowth?: number;          // %
  guidanceEbitdaMargin?: number;    // %
  guidanceRevenueTarget?: number;   // ₹ Cr
  guidanceFiscalYear?: string;
  guidanceConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  customWacc?: number;              // decimal
  customTerminalGrowth?: number;    // decimal
  customExitPe?: number;
  customExitEvEbitda?: number;
  notes?: string;
  updatedAt?: number;
}

const LS_KEY = 'mc:valuations:overrides:v1';

export function readAllOverrides(): Record<string, ValuationOverrides> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch { return {}; }
}

export function readOverrides(symbol: string): ValuationOverrides {
  if (!symbol) return {};
  const all = readAllOverrides();
  return all[symbol.toUpperCase()] || {};
}

export function writeOverrides(symbol: string, ov: ValuationOverrides): void {
  if (typeof window === 'undefined' || !symbol) return;
  try {
    const all = readAllOverrides();
    all[symbol.toUpperCase()] = { ...ov, updatedAt: Date.now() };
    localStorage.setItem(LS_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent('mc:valuation-overrides:updated', { detail: { symbol } }));
  } catch {}
}

export function clearOverrides(symbol: string): void {
  if (typeof window === 'undefined' || !symbol) return;
  try {
    const all = readAllOverrides();
    delete all[symbol.toUpperCase()];
    localStorage.setItem(LS_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent('mc:valuation-overrides:updated', { detail: { symbol } }));
  } catch {}
}

/** Merge user overrides into ValuationInputs before computing models. */
export function applyOverrides(inp: ValuationInputs): ValuationInputs {
  const ov = readOverrides(inp.symbol);
  return {
    ...inp,
    guidanceGrowth: ov.guidanceGrowth ?? inp.guidanceGrowth,
    guidanceEbitdaMargin: ov.guidanceEbitdaMargin ?? inp.guidanceEbitdaMargin,
    guidanceRevenueTarget: ov.guidanceRevenueTarget ?? inp.guidanceRevenueTarget,
    guidanceFiscalYear: ov.guidanceFiscalYear ?? inp.guidanceFiscalYear,
    guidanceConfidence: ov.guidanceConfidence ?? inp.guidanceConfidence,
  };
}
