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
