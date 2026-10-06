// zzz881 — is a figure from an EARLIER company document really the same guidance as the new one?
// Rishi saw India "raises" that were not raises: industry demand vs company guide (ACC, Rallis), a segment vs the whole company
// (EFC D&B segment, Viviana EPC, CMS services, Rupa e-commerce, Chola LAP), deposits vs advances (Punjab & Sind), maintenance
// capex read as free cash flow (Siyaram), a reported quarter read as guidance (Ujjivan, Chola), a misprint correction (Filatex),
// and figures whose sentence names no measure at all (TARIL "20%, 21%", Banswara "10.5% - 11%").
// An earlier-document figure is used as the "old guidance" only when none of these apply AND the new range sits fully above it.
// Pure: no fetch.

const INDUSTRY = /\b(industry|sector|cement demand|demand is expected|market (?:is|may|will|should)|consensus|the economy|gdp|agrochemicals are expected)\b/i;
const OWN_VS_INDUSTRY = /\b(surpass|outpace|outperform|beat|ahead of|faster than)\b[^.]{0,30}\b(industry|sector|market)\b/i;
const FIRST_PERSON = /\b(we|our|us)\b/i;
const CORRECTION = /\b(misprint|typo|never (?:given|said|guided)|wrongly (?:stated|printed)|clarif(?:y|ication))\b/i;
const QUARTER_ACTUAL = /\b(Q[1-4]|first quarter|second quarter|third quarter|fourth quarter|H1|first half)\b/i;
const ACTUAL_VERB = /\b(year[- ]on[- ]year|y-o-y|yoy|up \d|reported|reporting|delivered|achieved|clocked|recorded|testament|grew)\b/i;
const FUTURE = /\b(expect|target|guid|aim|will|project|estimat|outlook|plan|envisag|confident of|on track)\w*/i;
const COMPANY_LEVEL = /\b(total|consolidated|overall|company[- ]level|including)\b/i;
const SEGMENT = /\b(segment|division|vertical|subsidiar(?:y|ies)|business unit|plant|facility|domestic|exports?|e-?commerce|LAP|EPC|services revenue|retail project|maintenance|channel|D&B|standalone|geograph\w*)\b/i;
const SUBJECTS: Array<[string, RegExp]> = [
  ['deposit', /\bdeposits?\b/i], ['advances', /\b(advances|loan book|loans?|credit growth)\b/i], ['aum', /\b(aum|assets under management)\b/i],
  ['disbursement', /\bdisburse\w*/i], ['capex', /\b(capex|capital expenditure)\b/i], ['revenue', /\b(revenue|sales|top ?line|turnover|income from operations)\b/i],
  ['ebitda', /\bebitda\b(?!\s*margin)/i], ['margin', /\bmargins?\b/i], ['pat', /\b(pat|net profit|profit after tax|bottom ?line|earnings)\b/i],
  ['volume', /\bvolumes?\b/i], ['fcf', /\bfree cash\b/i],
];
const GENERIC = /\b(grow|growth)\b/i;

function subjects(raw: string): Set<string> { const s = new Set<string>(); for (const [k, re] of SUBJECTS) if (re.test(raw)) s.add(k); return s; }
function stripMarker(raw: string): string { return raw.replace(/\(earlier guidance:[^)]*\)/i, '').trim(); }

export function isEarlierDocPoint(p: { raw?: string | null } | null | undefined): boolean { return String(p?.raw || '').includes('(earlier guidance:'); }

/** Why the earlier-document figure must NOT be used as the old guidance (null = it may be used). */
export function earlierPriorMismatch(prior: { raw?: string | null; high?: number | null; low?: number | null }, after: { raw?: string | null; low?: number | null; high?: number | null }, metric: string): string | null {
  const b = stripMarker(String(prior.raw || '')), a = String(after.raw || '');
  if (!b || !a) return 'one of the two sentences is missing';
  for (const [side, t] of [['old', b], ['new', a]] as const) {
    if (INDUSTRY.test(t) && !(FIRST_PERSON.test(t) && OWN_VS_INDUSTRY.test(t))) return `the ${side} figure is about the industry, not the company`;
    if (CORRECTION.test(t)) return `the ${side} sentence corrects a misprint; it is not a new guide`;
  }
  if (QUARTER_ACTUAL.test(a) && ACTUAL_VERB.test(a) && !FUTURE.test(a)) return 'the new figure is a reported quarter, not guidance';
  const segB = SEGMENT.test(b), segA = SEGMENT.test(a);
  if (segB !== segA) return `a ${segB ? 'segment (old)' : 'segment (new)'} figure is compared with a company figure`;
  if (segB && segA && (COMPANY_LEVEL.test(a) !== COMPANY_LEVEL.test(b))) return 'a segment figure is compared with a company total';
  const sb = subjects(b), sa = subjects(a);
  if (!sb.size && !GENERIC.test(b)) return 'the old sentence does not say which measure it is';
  if (!sa.size && !GENERIC.test(a)) return 'the new sentence does not say which measure it is';
  if (sb.size && sa.size && ![...sb].some((x) => sa.has(x))) return `different measures (${[...sb].join('/')} vs ${[...sa].join('/')})`;
  if (metric === 'FCF' && (sb.has('capex') || sa.has('capex')) && !(sb.has('fcf') && sa.has('fcf'))) return 'capital spending is not free cash flow';
  // a RAISE against an earlier document must lift the floor above the old ceiling; an equal or lower figure is kept (reiteration / cut)
  const midB = prior.low != null && prior.high != null ? (prior.low + prior.high) / 2 : null, midA = after.low != null && after.high != null ? (after.low + after.high) / 2 : null;
  if (midB != null && midA != null && midA > midB && prior.high != null && after.low != null && !(after.low > prior.high)) return 'the new range overlaps the old one (narrowed, not raised)';
  return null;
}

// ── zzz881: the same scope check for the 30%+ growth ranking (Rishi: EFC's "+50%" is the D&B segment, Epigral's "~70%" is a
// segment's share of revenue, Kisssht's "+61%" is last year's reported AUM). Such a point stays in the universe browser but is
// never ranked as company growth.
const COMPANY_WIDE = /\b(consolidated|consol|overall|total (?:revenue|income|turnover|business)|company[- ]level|top ?line|the company)\b/i;
const PART_SCOPE = new RegExp([
  String.raw`\b(?:the|our|this|its|their)\s+(?!overall|total|entire|whole|core|own|existing|current|underlying)[A-Za-z&/-]+(?:\s+[A-Za-z&/-]+)?\s+(?:business|segment|division|vertical|portfolio)\b`,
  String.raw`\b[A-Za-z&/-]+\s+segment\b`, String.raw`\bsegments?\b`, String.raw`\bdivision\b`, String.raw`\bvertical\b`, String.raw`\bsubsidiar(?:y|ies)\b`,
  String.raw`\bexports?\b`, String.raw`\bdomestic (?:business|growth|revenue|sales|market)\b`, String.raw`\be-?commerce\b`, String.raw`\bchannel partners?\b`,
  String.raw`\bwholesale\b`, String.raw`\bplants?\b`, String.raw`\bfacilit(?:y|ies)\b`, String.raw`\bincremental\b`, String.raw`\bas far as [\w\s]{1,30} (?:is|are) concerned\b`,
  String.raw`\bwill get executed\b`,
].join('|'), 'i');
const SHARE_OF = /\d+(?:\.\d+)?\s*%\s+(?:of\s+(?:our\s+|the\s+)?(?:total\s+)?(?:revenue|sales|turnover)|visibility)\b/i;
const COMPANY_GROWTH = /\b(revenue|sales|top ?line|turnover)\s+(?:growth|guidance|outlook|guide|target|of\s+(?:about\s+|around\s+|approximately\s+|~\s*)?[₹$\d])/i;
const PAST_ACTUAL = /\b(expanded|rose|rises|grew|reported|reports|delivered|clocked|recorded|was up|were up)\b/i;
const YOY = /\b(yoy|y-o-y|year[- ]on[- ]year|year over year|year-over-year)\b/i;
const NOT_REVENUE = /\b(volumes?|average value|realis|realiz|average selling price|asp)\b/i;
const REVENUE_WORD = /\b(revenue|sales|top ?line|turnover|income)\b/i;

/** Why a guidance point must not be ranked as company-wide growth (null = fine). */
export function growthScopeIssue(statement: string | null | undefined, family: string): string | null {
  const t = String(statement || '');
  if (!t) return null;
  if (PAST_ACTUAL.test(t) && YOY.test(t) && !FUTURE.test(t)) return 'a reported result, not guidance';
  if (CORRECTION.test(t)) return 'a correction, not new guidance';
  if (INDUSTRY.test(t) && !FIRST_PERSON.test(t)) return 'about the industry, not the company';
  // a company-wide revenue statement said FIRST ("revenue growth of 87% … with the semiconductor segment at 300%") governs the sentence
  const cg = COMPANY_GROWTH.exec(t), ps = PART_SCOPE.exec(t);
  const companyFirst = !!cg && (!ps || cg.index < ps.index);
  if (SHARE_OF.test(t) && !cg) return 'a share of revenue or order visibility, not growth';
  if (ps && !COMPANY_WIDE.test(t) && !companyFirst) return 'one segment / plant / channel, not the whole company';
  if (family === 'REVENUE' && NOT_REVENUE.test(t) && !REVENUE_WORD.test(t)) return 'volume or price, not revenue';
  return null;
}
