// zzz895 — a growth figure on the guidance page must be what the quoted sentence says, for the metric it is filed under,
// for ONE year. Three ways it went wrong (owner's screen, Oct 2026):
//   • Kotyark "Revenue +15–20% FY27" quoted a sentence about a ₹215 Cr pipeline — the numbers are not in the quote;
//   • Kotyark "Revenue +60–80% FY31" — "growth of around 60% to 80% … over the next four to five years" is CUMULATIVE over
//     several years (about 10–13% a year), not 60–80% in one year;
//   • Finkurve "Revenue +50–60%" — the sentence is about AUM growth, not revenue.
// `growthQuoteIssue` returns the reason such a figure is not shown (null when it is fine). Pure, unit-tested.

const n2 = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
/** The quoted sentence contains the figure (as written: "15", "15.0", "fifteen" is not checked — the AI quotes digits). */
export function quoteHasNumber(quote: string, v: number | null | undefined): boolean {
  if (v == null || !Number.isFinite(v)) return true;
  const q = String(quote || '').replace(/,/g, '');
  const want = [n2(v), String(Math.round(v))];
  return want.some((w) => new RegExp(`(^|[^\\d.])${w.replace('.', '\\.')}(?:\\.0+)?(?!\\d)`).test(q));
}
const MULTI_YEAR = /\b(over|in|during|across|within)\s+(?:the\s+)?(?:next|coming)?\s*(?:\d+|two|three|four|five|six|seven|ten)(?:\s*(?:to|-|–|or)\s*(?:\d+|two|three|four|five|six|seven|ten))?\s+years?\b/i;
const NOT_REVENUE = /\b(aum|assets under management|loan book|advances|disbursements?|deposits?|order (?:book|inflows?|intake)|gmv|gross merchandise|volumes?|tonnage|footfall|customers?|subscribers?|capacity)\b/i;
const IS_REVENUE = /\b(revenue|sales|top[\s-]?line|turnover|income from operations|total income)\b/i;

export function growthQuoteIssue(quote: string | null | undefined, low: number | null, high: number | null, metric: string, opts: { annual: boolean; numberCheck?: boolean }): string | null {
  const q = String(quote || '');
  if (!q.trim()) return null;   // no quote to test (older rows): leave to the existing checks
  if (opts.numberCheck !== false && low != null && !quoteHasNumber(q, low) && !quoteHasNumber(q, high)) return 'the quoted sentence does not contain this growth figure';
  if (opts.annual && MULTI_YEAR.test(q)) return 'the growth is stated over several years (cumulative), not for one year';
  if (metric === 'REVENUE' && NOT_REVENUE.test(q) && !IS_REVENUE.test(q)) return `the sentence is about ${(NOT_REVENUE.exec(q)?.[0] || 'another measure').toUpperCase()} growth, not revenue`;
  return null;
}
