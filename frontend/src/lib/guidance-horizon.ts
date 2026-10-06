// ═══════════════════════════════════════════════════════════════════════════
// zzz916 — how a company states MULTI-YEAR growth, read correctly. Pure, no I/O.
//
// The owner compared the guidance page with InvestorStack's Q1 FY27 concall list (Aug 2026 calls) and ~20 India small / mid
// companies were missing. Their guidance is real and company-wide, but phrased in ways the extractor or the universe dropped:
//
//   "30-35% CAGR in revenue between FY25 and FY29"        → 30–35% a year, FY25–FY29            (years named: was kept)
//   "blended revenue growth of 30-35% over the next 2 years" → horizon "Next 2 years"            (no year named: was dropped)
//   "40% CAGR over 3 years"                                 → 40% a year, "Next 3 years"          (was dropped)
//   "30%+ revenue growth annually in the long term"         → 30%+ a year, long term, no fixed year (was dropped as an aspiration)
//   "minimum 35%", "at least 30%", "30%+"                   → low bound only (open-ended)          (was shown as exactly 35%)
//   "doubling revenue to Rs.2,000 crores by FY29"           → ₹2,000 Cr FY29; ~26% a year worked out from company numbers
//   "revenue to ₹220 Cr from ₹106 Cr"                       → ₹220 Cr FY27 vs ₹106 Cr FY26 (the document's own base)
//
// and the opposite must stay out of "company revenue growth": a segment / subsidiary / brand line ("US CrudeChem revenue to $100M"),
// volumes, AUM, store counts, bookings / pre-sales, bank advances, quarter-on-quarter growth.
//
// Also here: the intimation-letter test (the TS twin of isIntimationText in .github/scripts/guidance-docs-lib.mjs).
// ═══════════════════════════════════════════════════════════════════════════

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (s: string): number | null => { const n = /^\d+$/.test(s) ? Number(s) : WORD_NUM[s.toLowerCase()]; return Number.isFinite(n) && n! > 0 && n! <= 15 ? n! : null; };
const NUMW = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';

const SPOKEN: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/**
 * zzz920: numbers a transcript SPELLS OUT ("seventy percent", "thirty five to forty percent", "twenty-five"): 10-19, and the tens 20-90 with an optional
 * ones word. A quote that spells its figure out still contains it, so the number checks must see it (UTL Solar / GK Energy style spoken guidance).
 */
export function spokenNumbersIn(text: string): number[] {
  const w = String(text || '').toLowerCase().replace(/-/g, ' ');
  const re = /\b(?:(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+(one|two|three|four|five|six|seven|eight|nine))?|(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen))\b/g;
  const out: number[] = [];
  for (let m = re.exec(w); m; m = re.exec(w)) out.push(m[3] ? SPOKEN[m[3]] : SPOKEN[m[1]] + (m[2] ? SPOKEN[m[2]] : 0));
  return out;
}

/** Period labels the universe understands for a horizon with no fiscal year named. `endOfPeriodLabel` places "Next N years". */
export const LONG_TERM_LABEL = 'Long term (no fixed year)';
export const MEDIUM_TERM_LABEL = 'Medium term (no fixed year)';
export const isOpenHorizonLabel = (p: string | null | undefined): boolean => /^(long|medium) term \(no fixed year\)$/i.test(String(p || '').trim());
export const nextYearsOf = (p: string | null | undefined): number | null => { const m = /^next (\d{1,2}) years?$/i.exec(String(p || '').trim()); return m ? Number(m[1]) : null; };

export interface Horizon { label: string; years: number | null; kind: 'NEXT_N_YEARS' | 'LONG_TERM' | 'MEDIUM_TERM' }
/**
 * A growth horizon stated WITHOUT fiscal years: "over the next 2 years", "next three to four years" (the upper bound), "40% CAGR over 3
 * years", "a 3-year CAGR", "in the long term", "over the medium term". Null when the text names none.
 */
export function horizonOf(text: string): Horizon | null {
  const t = String(text || '').replace(/\s+/g, ' ');
  let m = new RegExp(`\\b(?:over|in|during|across|within|for)?\\s*(?:the\\s+)?(?:next|coming|following)\\s+${NUMW}(?:\\s*(?:to|-|–|or)\\s*${NUMW})?\\s+(?:financial\\s+|fiscal\\s+)?years?\\b`, 'i').exec(t);
  if (m) { const n = num(m[2] || m[1]); if (n) return { label: `Next ${n} years`, years: n, kind: 'NEXT_N_YEARS' }; }
  m = new RegExp(`\\b(?:over|in|across|within)\\s+(?:a\\s+(?:period\\s+of\\s+)?)?${NUMW}(?:\\s*(?:to|-|–|or)\\s*${NUMW})?\\s+years?\\b`, 'i').exec(t);
  if (m) { const n = num(m[2] || m[1]); if (n) return { label: `Next ${n} years`, years: n, kind: 'NEXT_N_YEARS' }; }
  m = new RegExp(`\\b${NUMW}[- ]years?\\s+(?:revenue\\s+|sales\\s+|profit\\s+|pat\\s+)?cagr\\b`, 'i').exec(t);
  if (m) { const n = num(m[1]); if (n) return { label: `Next ${n} years`, years: n, kind: 'NEXT_N_YEARS' }; }
  if (/\blong[- ]term\b|\blong[- ]run\b|\bover the long haul\b|\bsustainabl[ey]\b[^.]{0,40}\bannual(?:ly)?\b/i.test(t)) return { label: LONG_TERM_LABEL, years: null, kind: 'LONG_TERM' };
  if (/\bmedium[- ]term\b|\bmid[- ]term\b/i.test(t)) return { label: MEDIUM_TERM_LABEL, years: null, kind: 'MEDIUM_TERM' };
  return null;
}

/** The text says the rate is PER YEAR (a CAGR / annual rate), not the total over the span. */
export function perYearStated(text: string): boolean {
  return /\bcagr\b|\bcompound(?:ed)? annual\b|\bannual(?:ly|ised|ized)?\b|\bper annum\b|\bp\.?\s?a\.?(?=[\s,.;)]|$)|\ba year\b|\bper year\b|\bevery year\b|\beach year\b|\byear[- ]on[- ]year\b|\by-?o-?y\b|\byoy\b|\bper cent a year\b/i.test(String(text || ''));
}

/** "30%+", "at least 30%", "minimum 35%", "upwards of 40%", "more than 30%", "30% or more": the figure is a FLOOR. */
export function isLowBoundOnly(text: string, low: number | null | undefined): boolean {
  if (low == null || !Number.isFinite(low)) return false;
  const n = String(low).replace('.', '\\.');
  const t = String(text || '').replace(/,/g, '');
  return new RegExp(`(?:at least|at a minimum|minimum(?: of)?|min\\.?|upwards? of|more than|over|above|in excess of|north of|not less than|no less than)\\s+(?:a\\s+)?(?:about\\s+|around\\s+|~\\s*)?${n}(?:\\.0+)?\\s*%`, 'i').test(t)
    || new RegExp(`(?:^|[^\\d.])${n}(?:\\.0+)?\\s*%\\s*(?:\\+|plus(?! or minus)\\b|or (?:more|higher|above)|and above|and more)`, 'i').test(t)
    || new RegExp(`(?:^|[^\\d.])${n}(?:\\.0+)?\\s*%[^.]{0,40}\\b(?:at the minimum|at a minimum|minimum)\\b`, 'i').test(t);
}

/** "doubling" → 2, "tripling" / "3x" → 3. Null when the text states no multiple. */
export function multipleOf(text: string): number | null {
  const t = String(text || '');
  if (/\bdoubl(?:e|es|ed|ing)\b|\b2x\b|\btwo[- ]fold\b|\btwice\b/i.test(t)) return 2;
  if (/\btripl(?:e|es|ed|ing)\b|\b3x\b|\bthree[- ]fold\b/i.test(t)) return 3;
  const m = /\b([2-5](?:\.\d)?)\s?x\b/i.exec(t); if (m) return Number(m[1]);
  return null;
}

/** Compound annual growth % from a base to a target over `years` (one decimal). Null when not computable. */
export function cagrPct(target: number, base: number, years: number): number | null {
  if (!(target > 0) || !(base > 0) || !(years >= 1) || years > 15) return null;
  return Math.round((Math.pow(target / base, 1 / years) - 1) * 1000) / 10;
}

/** The last completed Indian fiscal year (two digits) on a date: Aug 2026 → 26 (FY26 ended 31 Mar 2026). Null for a bad date. */
export function lastCompletedFy(dateIso: string | null | undefined): number | null {
  const d = new Date(String(dateIso || ''));
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1;
  return (mo >= 4 ? y : y - 1) % 100;
}

// ── scope: is the figure the COMPANY's revenue / profit? ────────────────────

/** Measures that are not company revenue / profit (growth in them is never "revenue growth"). */
const NOT_COMPANY_MEASURE: Array<[string, RegExp]> = [
  ['bookings / pre-sales', /\b(pre-?sales|bookings?)\b/i],
  ['AUM', /\b(aum|assets under management|loan book|loan portfolio)\b/i],
  ['advances / deposits', /\b(advances|deposits?|disbursements?|credit growth|asset growth)\b/i],
  ['volume', /\b(volumes?|tonnage|tonnes?|tons|units sold|throughput|handling capacity|production)\b/i],
  ['store / outlet count', /\b(stores?|outlets?|branches|store count|preschools?|clinics|restaurants)\b/i],
  ['order inflow', /\b(order (?:book|inflows?|intake))\b/i],
  ['premium', /\b(first[- ]year premium|premiums?)\b/i],
];
const COMPANY_MEASURE = /\b(revenues?|sales|top[\s-]?line|turnover|income from operations|total income|bottom[\s-]?line|net profit|profit after tax|pat|profitability|ebitda)\b/i;
/** A named part of the company before the measure: "US CrudeChem revenue", "export revenue", "Tech & Payments revenue", "product revenue". */
const PART_BEFORE_MEASURE = /\b((?:(?:US|USA|UK|EU|Europe(?:an)?|international|overseas|export|exports|domestic|subsidiary|segment|division|vertical|plant|product|services?|non-[a-z]+|[A-Z][a-z]+[A-Z][A-Za-z]+|[A-Z][A-Za-z]*\s*&\s*[A-Z][a-z]+)\s+){1,3})(?:business\s+)?(?:revenues?|sales|turnover)\b/;
/** Words that do not name a part of the company ("this business", "our business", "the core business"). */
const GENERIC_PART_WORDS = new Set(['the', 'our', 'this', 'that', 'its', 'their', 'a', 'an', 'of', 'overall', 'entire', 'whole', 'core', 'main', 'existing', 'current', 'total', 'business', 'company', 'year', 'next', 'coming', 'each', 'every', 'same', 'such', 'these', 'those', 'all', 'and', 'other', 'new', 'domestic', 'india', 'bottom', 'top', 'pat', 'profit']);
/** "growth of 25% in the MSME segment", "in the non-GPL portfolio": a part named after the measure. */
const PART_AFTER_MEASURE = /\d[\d,.]*\s?(?:%|per ?cent|cr\b|crores?)[^.;]{0,45}?\b(?:in|from|for|within|across|on)\s+((?:(?:the|our|its)\s+)?[A-Za-z][\w&-]*(?:\s+[A-Za-z][\w&-]*)?)\s+(segment|vertical|division|portfolio|category|product line|line|business unit|geography|channel)\b/i;
/** "grow aerospace revenue profitably 25% to 30%": a business named between the verb and the measure. */
const PART_VERB_MEASURE = /\b(?:grow|growing|growth in|increase|increasing|achieve|reach|deliver|double|doubling)\s+(?:our\s+|the\s+|its\s+)?([a-z][\w&-]{2,})\s+(?:revenues?|sales)\b/i;
/** "around 50 CR from CCTV", "₹40 Cr from the Sanand plant": an amount that comes FROM a named product / plant. */
const AMOUNT_FROM_PART = /\b\d[\d,.]*\s*(?:cr|crores?|lakhs?|million|mn|billion|bn)\b\s+from\s+(?:the\s+|our\s+|its\s+)?([A-Z][A-Za-z0-9&-]{1,24})\b/;
/** Capitalised words after "from" that are a period or a company-wide word, not a product / plant. */
const NOT_A_PART_NAME = /^(?:(?:FY|CY)\d*|Q[1-4]|H[12]|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*|Indian?|Operations?|Revenues?|Sales|Business|Consolidated|Standalone|Last|Previous|Current|Next|Total|Rs|INR|USD)\b/i;
const LABEL_QUALIFIER_OK = new Set(['peak', 'medium', 'long', 'term', 'medium-term', 'long-term', 'mid', 'mid-term', 'short-term', 'potential', 'eventual', 'run', 'rate', 'run-rate', 'full-year', 'capacity-derived', 'capacity', 'derived', 'vision', 'mission', 'aspiration', 'ambition', 'trajectory', 'milestone', 'ebitda', 'implied', 'consolidated', 'standalone', 'total', 'overall', 'company', 'group', 'net', 'gross', 'annual', 'yearly', 'full', 'year', 'fy', 'guidance', 'guided', 'target', 'targeted', 'projected', 'expected', 'management', 'forward', 'future', 'operating', 'operations', 'from', 'of', 'the', 'revised', 'new', 'raised', 'lowered', 'implied', 'stated', 'minimum', 'maximum', 'alternative', 'estimated', 'indicative', 'headline', 'standalone,', 'financial', 'fiscal', 'next', 'current', 'in', 'for', 'and', 'to', 'by', 'at', 'on', 'q1', 'q2', 'q3', 'q4', 'h1', 'h2', 'cagr', 'growth', 'ambition', 'goal', 'aspiration', 'plan', 'outlook', 'range', 'figure', 'number', 'reported', 'sales', 'income', 'revenues', 'revenue', 'turnover', 'top', 'line', 'topline', 'rate', 'yoy', 'year-on-year']);
/** The words before "revenue / sales / turnover" in the model's label that name a part ("CCTV", "Sanand facility", "incremental ... new 150 KLPD unit"); null when the label is company-wide or unlabelled. */
export function labelPartOf(label: string | null | undefined): string | null {
  const l = String(label || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!l) return null;
  const m = /\b(revenues?|sales|turnover|top[\s-]?line)\b/i.exec(l);
  if (!m) return null;
  if (/\bincremental\b/i.test(l) || /\b(?:new|upcoming)\s+[\w ]{0,20}\b(?:unit|plant|facility|line|capacity)\b/i.test(l)) return l.replace(/\b(revenues?|sales|turnover|target|guidance)\b/gi, '').replace(/\s+/g, ' ').trim() || 'a new unit';
  const before = l.slice(0, m.index).trim();
  if (!before) return null;
  const words = before.split(/\s+/).filter((w) => /[a-z]/i.test(w) && !/^fy\s?'?\d{2,4}$/i.test(w) && !/^\d[\d,.]*$/.test(w) && !LABEL_QUALIFIER_OK.has(w.toLowerCase().replace(/[^a-z-]/g, '')));
  return words.length ? words.join(' ') : null;
}
const QOQ = /\bquarter[- ]on[- ]quarter\b|\bq-?o-?q\b|\bsequential(?:ly)?\b|\bevery quarter\b|\bper quarter\b|\beach quarter\b/i;

/**
 * Why a growth / amount figure must NOT be presented as company revenue / profit growth (null = it may). Pure.
 * `currency` + `market`: an Indian company guiding revenue in US dollars is guiding a foreign subsidiary / segment, not itself.
 * `company`: words of the company's own name are never read as "a part of the company" (AvenuesAI revenue = the company).
 */
export function scopeIssueOf(quote: string | null | undefined, opts: { metric: string; market?: 'IN' | 'US'; currency?: string | null; metricLabel?: string | null; company?: string | null } = { metric: 'REVENUE' }): string | null {
  const q = String(quote || '').replace(/\s+/g, ' ');
  if (!q.trim()) return null;
  const label = String(opts.metricLabel || '');
  const hay = `${label} ${q}`;
  const profit = opts.metric === 'PAT' || opts.metric === 'EPS';
  if (QOQ.test(q)) return 'quarter-on-quarter growth, not a yearly figure';
  // zzz920: the model's own label for the figure ("FY29 loan book target (revenue-like?)", "AUM projection (proxy for revenue guidance)") is read
  // WITHOUT its bracketed hedge: a label that names another measure and only hedges towards revenue in brackets is not revenue.
  const labelCore = label.replace(/\([^)]*\)/g, ' ');
  if (labelCore.trim() && !COMPANY_MEASURE.test(labelCore.replace(/\bpre-?sales\b/gi, ' '))) {
    for (const [what, re] of NOT_COMPANY_MEASURE) if (re.test(labelCore)) return `${what}, not company ${profit ? 'profit' : 'revenue'}`;
  }
  // the company's own measure named ("pre-sales" is not "sales")
  const hasCompanyMeasure = COMPANY_MEASURE.test(hay.replace(/\bpre-?sales\b/gi, ' '));
  for (const [what, re] of NOT_COMPANY_MEASURE) {
    if (!re.test(hay)) continue;
    if (what === 'bookings / pre-sales' && !/\b(revenues?|top[\s-]?line|turnover)\b/i.test(hay)) return `${what}, not company revenue`;
    // "revenue growth … driven by volume growth" is still revenue: a measure is out only when it stands in for revenue / profit
    if (!hasCompanyMeasure) return `${what}, not company ${profit ? 'profit' : 'revenue'}`;
  }
  if (!profit) {
    const m = PART_BEFORE_MEASURE.exec(hay);
    if (m && !/\b(consolidated|overall|total|company[- ]level|blended|group)\b/i.test(hay)) {
      const part = m[1].trim();
      const own = String(opts.company || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ');
      const words = part.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && w !== '&');
      if (!(own && words.length && words.every((w) => own.includes(w)))) return `one part of the company (${part} revenue), not the whole company`;
    }
  }
  // zzz920: a part named AFTER the measure ("growth of 25% in the MSME segment", "50 CR from CCTV") or in the model's label ("CCTV revenue",
  // "Sanand facility revenue target", "incremental revenue from new 150 KLPD unit") is one part of the company, not the whole
  if (!profit && !/\b(consolidated|overall|total|company[- ]level|blended|group|standalone)\b/i.test(hay)) {
    const own = String(opts.company || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ');
    const ownWord = (w: string) => !!own && own.includes(w);
    const after = PART_AFTER_MEASURE.exec(q);
    if (after) {
      const words = after[1].toLowerCase().split(/\s+/).filter((w) => w.length >= 2 && !GENERIC_PART_WORDS.has(w));
      if (words.length && !words.every(ownWord)) return `one part of the company (${after[1].trim()} ${after[2].toLowerCase()}), not the whole company`;
    }
    const verbPart = PART_VERB_MEASURE.exec(q);
    if (verbPart) {
      const w = verbPart[1].toLowerCase();
      if (!GENERIC_PART_WORDS.has(w) && !LABEL_QUALIFIER_OK.has(w) && !ownWord(w)) return `one part of the company (${verbPart[1]} revenue), not the whole company`;
    }
    const fromPart = AMOUNT_FROM_PART.exec(q);
    if (fromPart && !NOT_A_PART_NAME.test(fromPart[1]) && !GENERIC_PART_WORDS.has(fromPart[1].toLowerCase()) && !ownWord(fromPart[1].toLowerCase())) return `one part of the company (${fromPart[1]}), not the whole company`;
    const lp = labelPartOf(label);
    if (lp && !lp.split(/\s+/).every((w) => ownWord(w.toLowerCase()))) return `one part of the company (${lp} revenue), not the whole company`;
  }
  if (opts.market === 'IN' && opts.currency && /^(USD|EUR|GBP|AED|SGD)$/i.test(opts.currency)) {
    return `a ${String(opts.currency).toUpperCase()} figure from an Indian company (a foreign subsidiary or segment), not the company's own ${profit ? 'profit' : 'revenue'}`;
  }
  return null;
}

/**
 * zzz920: the metric a quoted sentence is really about, when the extractor filed it as revenue. "we'll have to grow our PAT by 66% to reach EPS of 7"
 * filed as REVENUE_GROWTH is a PAT figure (Emerald Finance showed as "revenue +66%"). A sentence that names revenue / sales / turnover anywhere (or
 * the model's label does) stays revenue; one that names only profit / EBITDA / EPS moves there. Null = leave it.
 */
export function metricFromQuote(metric: string, quote: string | null | undefined, label?: string | null): 'PAT' | 'EBITDA' | 'EPS' | null {
  if (metric !== 'REVENUE' && metric !== 'REVENUE_GROWTH') return null;
  const t = `${String(label || '')} ${String(quote || '')}`.replace(/\bpre-?sales\b/gi, ' ');
  if (!t.trim()) return null;
  if (/\b(revenues?|sales|top[\s-]?line|turnover|income from operations|total income)\b/i.test(t)) return null;
  if (/\b(pat|profit after tax|net profit|net income|profits?|bottom[\s-]?line)\b/i.test(t)) return 'PAT';
  if (/\bebitda\b/i.test(t)) return 'EBITDA';
  if (/\b(eps|earnings per share)\b/i.test(t)) return 'EPS';
  return null;
}

/** zzz920: a "free cash flow" row whose sentence is about capex, repayment of debt, a working-capital release or an outflow is not free cash flow (25 India rows on the page). Null = fine. */
export function fcfIssueOf(quote: string | null | undefined, label?: string | null): string | null {
  const t = `${String(label || '')} ${String(quote || '')}`;
  if (!t.trim()) return null;
  if (/\bfree[- ]cash|\bfcf\b|\bcash flows?\b|\bcash generation\b/i.test(t)) return null;
  return 'not free cash flow (the sentence is about capex, debt, working capital or another outflow)';
}

// ── intimation letters ──────────────────────────────────────────────────────

const POINTS_ELSEWHERE = /\b(transcripts?|audio|recording|presentation|concall|con\.? call|conference call|earnings call)\b[^.]{0,160}?\b(available|uploaded|hosted|placed|posted|accessible|can be (?:accessed|viewed|found)|link)\b|\b(weblink|web link|following link|below link|link below|hyperlink|website of the company|company'?s website|our website)\b/i;
/** An exchange letter that only POINTS to the transcript / deck ("available on our website at …"): short and says the document is elsewhere. */
export function isIntimationLetter(text: string): boolean {
  const t = String(text || '');
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters > 4_500) return false;
  return POINTS_ELSEWHERE.test(t.replace(/\s+/g, ' '));
}
