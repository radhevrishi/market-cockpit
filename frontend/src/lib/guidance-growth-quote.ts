// zzz895 — a growth figure on the guidance page must be what the quoted sentence says, for the metric it is filed under,
// for ONE year. Three ways it went wrong (owner's screen, Oct 2026):
//   • Kotyark "Revenue +15–20% FY27" quoted a sentence about a ₹215 Cr pipeline — the numbers are not in the quote;
//   • Kotyark "Revenue +60–80% FY31" — "growth of around 60% to 80% … over the next four to five years" is CUMULATIVE over
//     several years (about 10–13% a year), not 60–80% in one year;
//   • Finkurve "Revenue +50–60%" — the sentence is about AUM growth, not revenue.
// `growthQuoteIssue` returns the reason such a figure is not shown (null when it is fine). Pure, unit-tested.

import { spokenNumbersIn } from './guidance-horizon';
const n2 = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
/** The quoted sentence contains the figure (as written: "15", "15.0", "fifteen" is not checked — the AI quotes digits). */
export function quoteHasNumber(quote: string, v: number | null | undefined): boolean {
  if (v == null || !Number.isFinite(v)) return true;
  const q = String(quote || '').replace(/,/g, '');
  const want = [n2(v), String(Math.round(v))];
  if (spokenNumbersIn(q).includes(v) || spokenNumbersIn(q).includes(Math.round(v))) return true;
  return want.some((w) => new RegExp(`(^|[^\\d.])${w.replace('.', '\\.')}(?:\\.0+)?(?!\\d)`).test(q));
}
const MULTI_YEAR = /\b(over|in|during|across|within)\s+(?:the\s+)?(?:next|coming)?\s*(?:\d+|two|three|four|five|six|seven|ten)(?:\s*(?:to|-|–|or)\s*(?:\d+|two|three|four|five|six|seven|ten))?\s+years?\b/i;
// zzz916: + pre-sales / bookings / stores / outlets / premium (Sobha pre-sales, Arvind bookings, Sapphire stores are not revenue)
const NOT_REVENUE = /\b(aum|assets under management|loan book|advances|disbursements?|deposits?|order (?:book|inflows?|intake)|gmv|gross merchandise|gross order value|gov|volumes?|tonnage|footfall|customers?|subscribers?|capacity|pre-?sales|bookings?|stores?|outlets?|store count|premiums?)\b/i;
const IS_REVENUE = /\b(revenue|sales|top[\s-]?line|turnover|income from operations|total income)\b/i;
/** zzz916: quarter-on-quarter growth is never one year's growth */
const QOQ = /\bquarter[- ]on[- ]quarter\b|\bq-?o-?q\b|\bsequential(?:ly)?\b/i;

/** zzz931: words that say a percentage is a CHANGE (growth). A growth-rate row whose sentence has none of them is a share, mix, margin or
 *  visibility figure (GoGo "split ~84% service revenue", Epigral "revenue from the … segment to be ~70%", Divgi "more than 50% of the
 *  business … recurring", UDS "80%, 85% visibility", Emergent "Gross margin % | 32% - 35%"). */
const CHANGE_WORDS = /\bgr[eo]w|\bgrowth|\bincreas|\brise\b|\brising\b|\brose\b|\bup\b|\bhigher\b|\bcagr\b|\by\/y\b|\by-?o-?y\b|\byear[- ](?:over|on)[- ]year\b|\bdoubl|\btripl|\b\d(?:\.\d)?\s?x\b|\bimprov|\bjump|\bexpan|\+\s?\d|\bsurge|\baccelerat|\bscale[- ]?up|\bhike|\bboost|\bclimb|\bcompared (?:to|with)|\bover (?:the )?(?:last|previous|prior) (?:year|fiscal)|\bvs\.?\s|\bfrom (?:rs\.?|inr|₹|\$)|\bchange\b|\bdeliver\w*\s+(?:more than|over|at least|about|around)\s+\d/i;
/** a percentage of something (share / mix / visibility / margin / utilisation), not a change — tested next to the guided figure only */
const SHARE_NEAR = /(?<!\bterms\s)\bof\s+(?:the\s+|our\s+|its\s+|total\s+)?(?:business|revenues?|sales|turnover|portfolio|orders?|mix|book)\b|\bvisibility\b|\bmargins?\b|\bcontribution\b|\bshare\b|\butili[sz]ation\b|\bsplit\b|\bmix\b/i;
/** a table row that names its measure ("Adjusted EPS | $8.26 | … | 9.5%") is a real line; a bare "69.0 | % | 70.5 | %" is not */
const NAMES_A_MEASURE = /\b(revenues?|sales|top[\s-]?line|turnover|income|eps|earnings|ebit(?:da)?|profit|pat|affo|ffo)\b/i;
function shareNextToFigure(q: string, vals: Array<number | null>): boolean {
  const t = q.replace(/,/g, '');
  for (const v of vals) {
    if (v == null || !Number.isFinite(v)) continue;
    for (const w of new Set([n2(v), String(Math.round(v))])) {
      const re = new RegExp(`(^|[^\\d.])${w.replace('.', '\\.')}(?:\\.0+)?\\s*%`, 'g');
      for (let m = re.exec(t); m; m = re.exec(t)) {
        const at = m.index + m[1].length;
        if (SHARE_NEAR.test(t.slice(Math.max(0, at - 30), at + m[0].length - m[1].length + 30))) return true;
      }
    }
  }
  return false;
}
export function growthQuoteIssue(quote: string | null | undefined, low: number | null, high: number | null, metric: string, opts: { annual: boolean; numberCheck?: boolean; rateCheck?: boolean }): string | null {
  const q = String(quote || '');
  if (!q.trim()) return null;   // no quote to test (older rows): leave to the existing checks
  if (opts.numberCheck !== false && low != null && !quoteHasNumber(q, low) && !quoteHasNumber(q, high)) return 'the quoted sentence does not contain this growth figure';
  if (opts.annual && MULTI_YEAR.test(q)) return 'the growth is stated over several years (cumulative), not for one year';
  if (QOQ.test(q)) return 'the growth is quarter-on-quarter, not for a year';
  // zzz931: "our overall growth excluding TMT would have been 37%" — what a past year would have been, not guidance
  if (/\bwould have been\b/i.test(q) && !/\b(?:will|expect|guid|target|outlook|going forward|next year|this year)\b/i.test(q)) return 'the sentence describes what a past period would have been, not guidance';
  // only when the sentence ALSO looks like a share / table / level ("to be ~70%"): a terse but real guide ("approximately 30% in terms of revenues") stays
  if (opts.rateCheck && !CHANGE_WORDS.test(q)) {
    if (shareNextToFigure(q, [low, high])) return 'the percentage is a share, mix, margin or visibility figure, not growth';
    if ((/\|/.test(q) && !NAMES_A_MEASURE.test(q)) || /\bto be\s+(?:about\s+|around\s+|~\s*)?\d+(?:\.\d+)?\s*%/i.test(q)) return 'the sentence does not say the percentage is a growth rate (a level or a table cell)';
  }
  // "pre-sales" contains the word "sales": it is not revenue
  if (metric === 'REVENUE' && NOT_REVENUE.test(q) && !IS_REVENUE.test(q.replace(/\bpre-?sales\b/gi, ' '))) return `the sentence is about ${(NOT_REVENUE.exec(q)?.[0] || 'another measure').toUpperCase()} growth, not revenue`;
  return null;
}
