// ═══════════════════════════════════════════════════════════════════════════
// FIGURE GUARDS — WHAT A NUMBER NEEDS BEFORE IT CAN BE EVIDENCE.      (zzz802)
//
// Three kinds of junk reached the India Portfolio Catalysts cards as if they
// were evidence:
//   • "Rs. 1,113.51" as a one-off (JAMNAAUTO) — a rupee amount with no crore /
//     lakh / mn / bn word and no description. It reads like a per-share or
//     price figure; the engine then treated it as ₹1,113.51 Cr and called it
//     "larger than the reported profit". Never invent a magnitude.
//   • "Spent: not disclosed (announced 2% to 3%)" (LCL) — a percentage with no
//     subject lifted from a concall hypothetical as the capex amount.
//   • "announced 25%" — a bare percentage standing in for a capex figure.
//
// The rules (pure, no I/O, no price):
//   • A CAPEX figure needs a currency amount with a crore / lakh / mn / bn
//     unit, OR an explicit capex context with a subject for its percentage
//     ("capex of 2-3% of revenue"). A bare percentage is rejected.
//   • A percentage with no subject (nothing but "25%" or "2% to 3%") is not a
//     figure of anything and is rejected wherever a subject is required.
//   • A rupee amount with no magnitude word is never scaled to crore; on its
//     own (no description) it is rejected as evidence — it looks like a
//     per-share or price value. Unknown stays unknown.
// ═══════════════════════════════════════════════════════════════════════════

const CUR = String.raw`(?:₹|\bINR|\bRs\.?)`;
/** Money-with-unit also accepts a stated USD amount ("USD 50 million capex"); it is never converted. */
const CUR_ANY = String.raw`(?:₹|\bINR|\bRs\.?|\bUSD|\bUS\$|\$)`;
const NUM = String.raw`[\d,]+(?:\.\d+)?`;
const UNIT = String.raw`(?:crores?|crs?\b|cr\b|lakhs?|lacs?|mn\b|million|bn\b|billion)`;

/** A currency amount WITH a magnitude word: "₹1,200 crore", "Rs 250 lakh",
 *  "INR 1.2 bn", "₹300-400 Cr", or an unprefixed "1,200 crore". */
// "100-odd", "800-plus", "96.92*", "480+" — the magnitude word may follow a qualifier.
const QUAL = String.raw`(?:\s*(?:\*|\+|-?\s*odd|-?\s*plus))?`;
const MONEY_WITH_UNIT = new RegExp(
  `(?:${CUR_ANY}\\s?${NUM}${QUAL}(?:\\s*(?:-|–|to)\\s*${CUR_ANY}?\\s?${NUM}${QUAL})?\\s*${UNIT})|(?:\\b${NUM}${QUAL}(?:\\s*(?:-|–|to)\\s*${NUM}${QUAL})?\\s*(?:crores?|cr\\b|lakhs?))`, 'i');

/** "Rs. 1,113.51", "₹ 56", "INR 12.5" — a currency amount and nothing else. */
const BARE_RUPEE = new RegExp(`^\\s*[-−+]?\\s*${CUR}\\s?[-−]?${NUM}\\s*\\.?\\s*$`, 'i');

/** "25%", "2% to 3%", "~8-10 %", "+2.5 pp" — a percentage and nothing else. */
const BARE_PERCENT = /^\s*[~≈+\-−]?\s*\d+(?:\.\d+)?\s*(?:%|pp|percent)?\s*(?:(?:-|–|to)\s*[~≈+\-−]?\s*\d+(?:\.\d+)?\s*)?(?:%|pp|percent)\s*(?:p\.?a\.?|yoy|annual(?:ly)?)?\s*$/i;

/** Explicit capex context words. */
const CAPEX_CONTEXT = /\bcapex\b|capital expenditure|capital outlay|\boutlay\b|investment of|\binvest(?:ing|ed)?\b|\bspend\b|\bspent\b/i;
/** The subject a capex percentage must name. */
const PCT_SUBJECT = /\d\s*%\s*(?:-|–|to)?\s*(?:\d+(?:\.\d+)?\s*%)?\s*of\s+(?:(?:the|our|its|annual|consolidated|net)\s+)*(?:revenue|revenues|sales|turnover|topline|top line|income)/i;

/** A currency amount with a magnitude word is present. */
export function hasMoneyWithUnit(s: string | null | undefined): boolean {
  return MONEY_WITH_UNIT.test(String(s ?? ''));
}

/** A rupee amount and nothing else, with no magnitude word. */
export function isBareRupeeAmount(s: string | null | undefined): boolean {
  return BARE_RUPEE.test(String(s ?? ''));
}

/** A percentage (or range of percentages) with no subject. */
export function isSubjectlessPercent(s: string | null | undefined): boolean {
  return BARE_PERCENT.test(String(s ?? ''));
}

/**
 * May this text stand as a CAPEX figure? A currency amount with a crore /
 * lakh / mn / bn unit; or explicit capex context with a percentage that names
 * its subject ("capex at 2-3% of revenue"). Everything else — a bare
 * percentage, an unscaled rupee amount, a lone number — is rejected.
 * `context` is the sentence around it, when there is one.
 */
export function capexFigureOk(s: string | null | undefined, context?: string | null): boolean {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (hasMoneyWithUnit(t)) return true;
  if (isSubjectlessPercent(t) || isBareRupeeAmount(t)) return false;
  const both = `${t} ${context || ''}`;
  if (/%/.test(t)) return CAPEX_CONTEXT.test(both) && PCT_SUBJECT.test(t);
  // Words only (no number): not a figure. A number with no unit: not a figure.
  return false;
}

/** A one-off amount that is only an unscaled rupee figure with no words is
 *  not usable evidence (it reads like a per-share / price value). */
export function isJunkOneOffAmount(after: string | null | undefined): boolean {
  return isBareRupeeAmount(after);
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz837 — GARBAGE AND AMBIGUOUS EXTRACTIONS.
//
//   • Run-together OCR strings ("ExpandedMfg.capacityatthe Texasfacilityby
//     70,000MTPA") have no word boundaries: nobody can say what they state.
//     Rejected, never shown as a fact.
//   • A physical capacity has a physical unit. "12 riders", "6 units",
//     "over 125+ locations" are counts of something else.
//   • A money metric names its currency. "order intake 2.1 billion" does not:
//     shown as "currency not stated", never assumed to be rupees or dollars.
//   • An order book far below the capex programme, or below one quarter of
//     revenue, is more likely a unit / scope slip than a fact: "unit/scope
//     unclear — validation required".
// Pure; no I/O; no price.
// ═══════════════════════════════════════════════════════════════════════════

const FN_JOIN = String.raw`(?:at|in|on|of|by|to|for|and|from|with)`;
/** A run-together string: function words glued to their neighbours, or a
 *  word glued to a number after "by / at / to / of". */
const GARBLE_RES: RegExp[] = [
  new RegExp(`[a-z]{2,}${FN_JOIN}the(?=[a-z]{2,})`),                    // capacityatthe / Texasfacilityby...
  new RegExp(`\\b[a-z]{3,}(?:by|at|to|of|from|for)\\d`, 'i'),            // facilityby70,000
  /\b[A-Za-z]{2,}\.[a-z]{6,}[a-z]*\b(?=[a-z]{0,20}(?:at|in|by|of))/,    // Mfg.capacityatthe
  /\b[a-z]{24,}\b/,                                                      // a 24-letter lower-case run
];
export function isGarbledText(s: string | null | undefined): boolean {
  const t = String(s ?? '');
  if (t.length < 12) return false;
  const lower = t.replace(/https?:\/\/\S+/g, ' ');
  return GARBLE_RES.some((re) => re.test(lower)) || /\b[A-Za-z]{2,}\.[a-z]{5,}(?:at|in|by|of)the[a-z]/.test(lower);
}

const COUNT_NOUN = /\b(riders?|rides?|visitors?|guests?|locations?|stores?|outlets?|branches|branch|centres?|centers?|clinics?|restaurants?|cities|countries|employees?|customers?|users?|members?|employees)\b/i;
const CAP_RATE = /(?:per|\/|p\.?a\.?|a)\s*(?:day|month|year|annum|hour|shift)|\b(?:pa|pm|tpa|tpd|ktpa|mtpa)\b/i;
/** Why a physical-capacity figure cannot be one, or null when it can. */
export function capacityUnitIssue(value: string | null | undefined): string | null {
  const v = String(value ?? '');
  if (!/\d/.test(v)) return null;
  if (COUNT_NOUN.test(v)) return `a count of ${(COUNT_NOUN.exec(v)![1] || 'items').toLowerCase()}, not a physical capacity`;
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(?:\+\s*)?units?\b/i.exec(v);
  if (m && !CAP_RATE.test(v)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (n < 1000) return `${m[0].trim()} — a small count of units with no per-period rate is not a capacity`;
  }
  return null;
}

const MONEY_METRICS = new Set(['order_book', 'order_intake', 'revenue_visibility', 'capex', 'fcf', 'debt']);
const CUR_WORD = /₹|\bINR|\bRs\.?|\bUSD|\bUS\$|\$|\bEUR|€|£|\bGBP|\brupees?|\bdollars?|\beuros?/i;
const RUPEE_MAG = /\b(?:crores?|crs?|lakhs?|lacs?)\b/i;
const FOREIGN_MAG = /\b(?:mn|million|bn|billion|k|thousand)\b/i;
/** True when a money metric carries a magnitude word (million / billion) but
 *  no currency in the value or its sentence: the currency is unknown. */
export function currencyNotStated(key: string, value: string | null | undefined, context?: string | null): boolean {
  if (!MONEY_METRICS.has(key)) return false;
  const v = String(value ?? '');
  if (!/\d/.test(v) || /%/.test(v)) return false;
  if (CUR_WORD.test(v) || RUPEE_MAG.test(v)) return false;
  if (!FOREIGN_MAG.test(v)) return false;
  return !CUR_WORD.test(String(context ?? ''));
}

/** A scaled amount in crore, from "INR25 crores", "Rs 250 crore", "₹1,200 Cr", lakh; null when not rupee-scaled. */
export function croreFrom(s: string | null | undefined): number | null {
  const t = String(s ?? '').replace(/,/g, '');
  const m = /(\d+(?:\.\d+)?)\s*(crores?|crs?\b|lakhs?|lacs?)/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return /^(?:crores?|crs?)$/i.test(m[2]) ? n : n / 100;
}

/**
 * Order book against the company's own scale. Returns a reason when the order
 * book (crore) is implausible beside the capex programme (crore) or one
 * quarter of revenue (crore) — a unit or scope slip is likelier than a fact.
 */
export function orderBookImplausible(orderBookCr: number | null, o: { capexProgrammeCr?: number | null; quarterRevenueCr?: number | null }): string | null {
  if (orderBookCr == null || !(orderBookCr > 0)) return null;
  if (o.capexProgrammeCr != null && o.capexProgrammeCr > 0 && orderBookCr * 4 < o.capexProgrammeCr) {
    return `unit/scope unclear — validation required: an order book of ₹${orderBookCr} crore is far below the ₹${o.capexProgrammeCr} crore capex programme stated for the same company`;
  }
  if (o.quarterRevenueCr != null && o.quarterRevenueCr > 0 && orderBookCr < o.quarterRevenueCr * 0.5) {
    return `unit/scope unclear — validation required: an order book of ₹${orderBookCr} crore is below half of one quarter's revenue (₹${Math.round(o.quarterRevenueCr)} crore)`;
  }
  return null;
}
