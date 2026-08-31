// India Tax & Holding-Period Planner — pure, deterministic helpers.
// No React, no DOM, no I/O. The page component is a thin rendering layer over
// these functions so the tax math stays unit-friendly and easy to audit.
//
// SCOPE: listed Indian equity, capital-gains rules as of FY 2024-25 onward.
// These are simplified defaults for planning only — NOT tax advice. Rates and
// thresholds change; verify the current numbers with a qualified professional
// (your CA) before acting. Encoded as named constants so they are trivial to
// update in one place.

// ── the rules (equity, FY 2024-25 onward) ───────────────────────────────────
/** Long-term capital-gains rate on listed equity held > 12 months. */
export const LTCG_RATE = 0.125; // 12.5%
/** Short-term capital-gains rate on listed equity held <= 12 months. */
export const STCG_RATE = 0.20; // 20%
/** Annual LTCG exemption (applied once at the portfolio level, not per line). */
export const LTCG_EXEMPTION = 125_000; // ₹1.25 lakh
/** Holding-period threshold, in whole calendar months, for long-term status. */
export const LTCG_MONTHS = 12;

/** Within this many days of the 12-month mark → surface an amber "about to
 *  cross to LTCG" warning on the row. */
export const LTCG_WARN_DAYS = 45;
/** Callout window: holdings crossing into LTCG within this many days. */
export const LTCG_CALLOUT_DAYS = 60;

export type Region = 'india' | 'us';
export type HoldingTerm = 'short' | 'long';

// ── symbol + quote parsing (kept local so this module is self-contained) ─────

/** Uppercase and strip the NSE/BSE suffix so symbols match the quote feed. */
export function normalizeSymbol(s: string): string {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO)$/i, '');
}

function pickNumber(obj: any, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const n = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickString(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export interface QuotePrice {
  symbol: string;
  price: number | null;
  region: Region;
}

/** Pull the array of quote rows out of the (variable) quotes-endpoint payload. */
export function extractQuoteRows(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const k of ['stocks', 'quotes', 'data', 'results', 'rows']) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}

/** Build a normalized price row from a raw quote of unknown shape. */
export function toQuotePrice(raw: any, region: Region): QuotePrice | null {
  const symRaw = pickString(raw, ['symbol', 'ticker', 'Symbol', 'sym', 'code']);
  if (!symRaw) return null;
  const price = pickNumber(raw, ['price', 'ltp', 'lastPrice', 'last_price', 'regularMarketPrice', 'close', 'lastTradedPrice']);
  return { symbol: normalizeSymbol(symRaw), price, region };
}

// ── date math ────────────────────────────────────────────────────────────────

/** Parse an ISO-ish date string to a Date at local midnight, or null. */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Format a Date as YYYY-MM-DD (for <input type="date"> and storage). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole days from a → b (b later ⇒ positive). */
export function daysBetween(a: Date, b: Date): number {
  const MS = 86_400_000;
  return Math.round((b.getTime() - a.getTime()) / MS);
}

/** Add whole calendar months to a date (clamps end-of-month overflow). */
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const targetMonth = r.getMonth() + months;
  r.setMonth(targetMonth);
  // If the day rolled forward (e.g. Jan 31 + 1mo → Mar 3), clamp to last day.
  if (r.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    r.setDate(0);
  }
  return r;
}

/** Approx months held as a decimal (days / 30.437). Display only. */
export function monthsHeldApprox(days: number): number {
  return days / 30.4368;
}

// ── per-holding derivation ───────────────────────────────────────────────────

export interface HoldingInput {
  symbol: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  addedAt: string;
  notes?: string;
}

export interface TaxRow {
  symbol: string;
  region: Region | null;
  quantity: number;
  entryPrice: number;
  livePrice: number | null;
  /** Price actually used for value/gain (live if available, else entry). */
  effPrice: number;
  cost: number;
  currentValue: number;
  unrealisedGain: number;
  /** Acquisition date used (override if present, else addedAt). */
  acqDate: Date | null;
  /** True when acqDate came from a user override (real buy date). */
  acqIsOverride: boolean;
  daysHeld: number | null;
  monthsHeld: number | null;
  term: HoldingTerm | null;
  /** Whole days until this holding crosses into LTCG (0 or less ⇒ already LT). */
  daysToLtcg: number | null;
  /** The date this holding becomes long-term (acq + 12 months). */
  ltcgDate: Date | null;
  /** Estimated tax if sold today, per-line, GROSS of the portfolio exemption. */
  estTaxIfSoldToday: number;
  hasLiveQuote: boolean;
}

/**
 * Derive all tax/holding figures for one holding.
 * `today` is injected for determinism/testability.
 */
export function computeTaxRow(
  h: HoldingInput,
  quote: QuotePrice | null,
  overrideAcqISO: string | null,
  today: Date,
): TaxRow {
  const livePrice = quote && quote.price != null && quote.price > 0 ? quote.price : null;
  const entryPrice = h.entryPrice > 0 ? h.entryPrice : 0;
  const effPrice = livePrice != null ? livePrice : entryPrice;
  const qty = h.quantity || 0;

  const cost = qty * entryPrice;
  const currentValue = qty * effPrice;
  const unrealisedGain = currentValue - cost;

  const acqIsOverride = !!overrideAcqISO && !!parseDate(overrideAcqISO);
  const acqDate = acqIsOverride ? parseDate(overrideAcqISO) : parseDate(h.addedAt);

  let daysHeld: number | null = null;
  let monthsHeld: number | null = null;
  let term: HoldingTerm | null = null;
  let daysToLtcg: number | null = null;
  let ltcgDate: Date | null = null;

  if (acqDate) {
    daysHeld = Math.max(0, daysBetween(acqDate, today));
    monthsHeld = monthsHeldApprox(daysHeld);
    ltcgDate = addMonths(acqDate, LTCG_MONTHS);
    // Long-term requires holding STRICTLY MORE than 12 months.
    term = today.getTime() > ltcgDate.getTime() ? 'long' : 'short';
    daysToLtcg = daysBetween(today, ltcgDate) + 1; // +1: need to be past the mark
    if (term === 'long') daysToLtcg = 0;
  }

  // Per-line estimated tax: only positive gains are taxed. LTCG line figure is
  // GROSS (before the ₹1.25L annual exemption, which nets at portfolio level).
  let estTaxIfSoldToday = 0;
  if (unrealisedGain > 0 && term) {
    estTaxIfSoldToday = unrealisedGain * (term === 'long' ? LTCG_RATE : STCG_RATE);
  }

  return {
    symbol: normalizeSymbol(h.symbol),
    region: quote ? quote.region : null,
    quantity: qty,
    entryPrice,
    livePrice,
    effPrice,
    cost,
    currentValue,
    unrealisedGain,
    acqDate,
    acqIsOverride,
    daysHeld,
    monthsHeld,
    term,
    daysToLtcg,
    ltcgDate,
    estTaxIfSoldToday,
    hasLiveQuote: livePrice != null,
  };
}

// ── portfolio-level roll-up ──────────────────────────────────────────────────

export interface PortfolioTax {
  // gains only (positive contributions); losses tracked separately
  shortTermGain: number;
  longTermGain: number;
  shortTermLoss: number;
  longTermLoss: number;
  /** Net short-term gain (gains − losses), floored at 0 for tax. */
  netShortGain: number;
  /** Net long-term gain (gains − losses), floored at 0 for tax. */
  netLongGain: number;
  estShortTax: number;
  /** LTCG tax AFTER applying the annual exemption to net long-term gains. */
  estLongTax: number;
  estTotalTax: number;
  /** How much of the ₹1.25L exemption is still unused. */
  exemptionRemaining: number;
  /** Portion of net LT gain that fell inside the exemption (tax-free). */
  exemptionUsed: number;
  totalCurrentValue: number;
  totalCost: number;
  totalUnrealised: number;
}

export function computePortfolioTax(rows: TaxRow[]): PortfolioTax {
  let shortTermGain = 0, longTermGain = 0, shortTermLoss = 0, longTermLoss = 0;
  let totalCurrentValue = 0, totalCost = 0;

  for (const r of rows) {
    totalCurrentValue += r.currentValue;
    totalCost += r.cost;
    if (r.term === 'long') {
      if (r.unrealisedGain >= 0) longTermGain += r.unrealisedGain;
      else longTermLoss += -r.unrealisedGain;
    } else if (r.term === 'short') {
      if (r.unrealisedGain >= 0) shortTermGain += r.unrealisedGain;
      else shortTermLoss += -r.unrealisedGain;
    }
    // rows with no acqDate/term are ignored in the bucketed tax math
  }

  const netShortGain = Math.max(0, shortTermGain - shortTermLoss);
  const netLongGain = Math.max(0, longTermGain - longTermLoss);

  const estShortTax = netShortGain * STCG_RATE;
  const exemptionUsed = Math.min(netLongGain, LTCG_EXEMPTION);
  const taxableLong = Math.max(0, netLongGain - LTCG_EXEMPTION);
  const estLongTax = taxableLong * LTCG_RATE;
  const exemptionRemaining = Math.max(0, LTCG_EXEMPTION - netLongGain);

  return {
    shortTermGain,
    longTermGain,
    shortTermLoss,
    longTermLoss,
    netShortGain,
    netLongGain,
    estShortTax,
    estLongTax,
    estTotalTax: estShortTax + estLongTax,
    exemptionRemaining,
    exemptionUsed,
    totalCurrentValue,
    totalCost,
    totalUnrealised: totalCurrentValue - totalCost,
  };
}

/**
 * Tax saved by waiting for a short-term holding to become long-term, if sold
 * the day after it crosses. Compares STCG (20%) vs LTCG (12.5%) on the same
 * gain. Ignores the portfolio exemption (a conservative, per-line estimate).
 * Returns 0 for non-gains or already-long rows.
 */
export function ltcgSwitchSaving(row: TaxRow): number {
  if (row.term !== 'short' || row.unrealisedGain <= 0) return 0;
  return row.unrealisedGain * (STCG_RATE - LTCG_RATE);
}

/** Sort key so near-crossers (small positive daysToLtcg) surface first, then
 *  already-long-term rows, then rows with no acquisition date. */
export function ltcgSortKey(r: TaxRow): number {
  if (r.acqDate == null) return Number.POSITIVE_INFINITY;
  if (r.term === 'long') return 1_000_000; // after all short-term rows
  return r.daysToLtcg == null ? 999_999 : r.daysToLtcg;
}
