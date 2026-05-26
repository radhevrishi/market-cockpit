// ─────────────────────────────────────────────────────────────────────────────
// India concall transcript extraction
// ─────────────────────────────────────────────────────────────────────────────
// Pure-text analysis of an earnings call / investor presentation transcript.
// Pulls out:
//   - top-N quotes ranked by signal density (numbers, growth/margin/guidance
//     keywords, sector-specific language)
//   - tone signals: positive / cautious / negative cue phrases
//   - key mentions: operating leverage, capex, margin trajectory, EPS
//     commentary, new launches, demand environment
//   - sector KPI hits — flips KPIs from "○ not extracted" to "● available"
//     when the transcript mentions them
//   - composite Concall Score (0-100) + grade
//
// All extraction is regex-based and runs in the browser. No LLM call, no
// network, no third party.
// ─────────────────────────────────────────────────────────────────────────────

import type { IndiaSectorTemplate } from './india-sectors';

export interface ConcallSectorKpiHit {
  label: string;
  value: string;
  quote: string;
}

export interface ConcallToneSignal {
  phrase: string;
  context: string;
  sentiment: 'positive' | 'cautious' | 'negative';
}

export interface ConcallKeyMention {
  topic:
    | 'operating_leverage'
    | 'capex'
    | 'margins'
    | 'eps'
    | 'launches'
    | 'demand'
    | 'guidance'
    | 'inflation'
    | 'pricing'
    | 'dividend'
    | 'subsidiary'
    | 'geographic_mix'
    | 'capacity'
    | 'rd_pipeline'
    | 'customer_wins'
    // Expansion based on common Indian midcap concall patterns —
    // these topics appear ubiquitously across earnings transcripts
    // (industrials, FMCG, IT, pharma) and were previously missed.
    | 'order_book'         // "Order book of ₹X cr" / "L1 in tenders worth Y"
    | 'utilization'        // "Capacity utilization at X%" / "Plant utilization"
    | 'volume_value'       // "Volume growth X%, value growth Y%" / "UVG"
    | 'segment_mix'        // "Segment A grew X%, segment B Y%" / "vertical-wise"
    | 'net_debt'           // "Net debt of ₹X cr" / "deleveraging"
    | 'pli_rodtep'         // "PLI scheme" / "RoDTEP" / "export incentive"
    | 'pricing_action'     // "Price hike of X%" / "Price-led growth"
    | 'mna'                // M&A / acquisition / divestment / demerger
    | 'esg';               // ESG / net-zero / renewable / sustainability commitments
  quote: string;
}

// ── Risk profile extracted from concall transcripts ───────────────────
// Indian concalls routinely state these structurally — analysts
// memorise them on every call. Extracting them gives institutional
// readers risk metrics without needing extra data feeds.
export interface ConcallRiskProfile {
  // Customer concentration — "top customer 26%", "single principal", etc.
  customerConcentrationPct: number | null;
  customerConcentrationQuote: string | null;
  // Export contribution — "exports 75% of revenue"
  exportConcentrationPct: number | null;
  exportConcentrationQuote: string | null;
  // FX hedging — "60% hedged", "natural hedge", "USD revenue X%"
  fxHedgePct: number | null;
  fxHedgeQuote: string | null;
  // Debt refinancing notes — "borrowings due", "refinanc"
  debtRefinancingFlag: boolean;
  debtRefinancingQuote: string | null;
  // Commodity / raw-material sensitivity — explicit RM cost mentions
  commoditySensitivityFlag: boolean;
  commoditySensitivityQuote: string | null;
  // Working-capital stress / receivables stretch
  workingCapitalStressFlag: boolean;
  workingCapitalStressQuote: string | null;
}

export interface ConcallInsights {
  topQuotes: string[];
  toneSignals: ConcallToneSignal[];
  keyMentions: ConcallKeyMention[];
  sectorKpiHits: ConcallSectorKpiHit[];
  concallScore: number;       // 0-100
  concallGrade: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';
  positiveCount: number;
  negativeCount: number;
  cautiousCount: number;
  charsAnalyzed: number;
  riskProfile: ConcallRiskProfile;
}

// ── Boilerplate strip — Indian listed-co cover letters and SEBI templates ──
// Most BSE / NSE filing decks start with "To, The General Manager...",
// "Pursuant to Regulation 30 of SEBI...", or "We enclose herewith the Investor
// Presentation". These add up to several hundred chars of noise that score
// well on the surface (real verbs, real punctuation) but contain zero alpha.
//
// Investor presentations also contain non-financial sections (CSR, Sustainability,
// Employee Wellbeing, "Why X Matters") that score on verbs but aren't relevant
// to earnings analysis. Strip them so they don't pollute top quotes.
function stripBoilerplate(text: string): string {
  let t = text;
  // Remove the cover-letter block (everything before "Investor Presentation"
  // or "Q[1-4] FY[YY] Performance" / "Performance Highlights").
  const startMarkers = [
    /Investor Presentation\s+(?:[-–]\s+)?(?:Q[1-4]|FY)\s*\d/i,
    /(?:Q[1-4]|H[12]|FY)\s*\d{2}.{0,30}Performance Highlights/i,
    /(?:MD'?s|Managing Director'?s)\s+Commentary/i,
    /Q\d\s*&\s*FY\s*\d{2}\s+Performance/i,
  ];
  let cutPos = -1;
  for (const re of startMarkers) {
    const m = t.match(re);
    if (m && m.index !== undefined) {
      cutPos = Math.max(cutPos, m.index);
    }
  }
  if (cutPos > 200) t = t.slice(cutPos);

  // Strip the standard SEBI safe-harbor paragraph (regulator-mandated disclaimer)
  t = t.replace(
    /This presentation contains certain forward looking statements[\s\S]*?materially incorrect in future/gi,
    ' ',
  );
  t = t.replace(
    /This presentation and the accompanying slides[\s\S]*?expressly excluded\.?/gi,
    ' ',
  );
  t = t.replace(/Pursuant to Regulation 30[\s\S]{0,400}?Investor Presentation/gi, ' ');

  // Strip "To, The General Manager … Trading Symbol: XXXX Dear Sir/Ma'am"
  t = t.replace(
    /To,\s*\nThe (General Manager|Listing[\s\S]*?)Dear Sir\/Ma'?am[,\s]*/gi,
    ' ',
  );

  // Strip non-financial sections by chopping at section dividers. Every
  // numbered section header like "1. CSR Activities" / "6. Ensuring Employee
  // Well Being" / "5. Responsible Corporate" cuts out everything between it
  // and the next numbered header (or end of doc).
  const NONFIN_SECTIONS = [
    /\b\d+\.\s*CSR Activities/i,
    /\b\d+\.\s*Corporate Social Responsibility/i,
    /\b\d+\.\s*Sustainability\b/i,
    /\b\d+\.\s*Sustainability Integrated/i,
    /\b\d+\.\s*Responsible Corporate/i,
    /\b\d+\.\s*Ensuring Employee Well[- ]?Being/i,
    /\b\d+\.\s*Employee Wellbeing/i,
    /Annual Cricket Tournament/i,
    /Safety Week Celebrations/i,
    /Ashadham Reconstruction/i,
    /Tribal Children Education/i,
    /Bal Asha Trust/i,
    /SAT Foundation/i,
    /St\.\s+Anthony Home/i,
    /Why do .{1,40} Matter\?/i,
  ];
  for (const re of NONFIN_SECTIONS) {
    const m = re.exec(t);
    if (!m || m.index === undefined) continue;
    // Look ahead for next "X. Heading" section break or just chop a fixed
    // window forward (most section blocks are < 1500 chars).
    const tail = t.slice(m.index);
    const nextSectionMatch = /\n\s*\d+\.\s+[A-Z]/.exec(tail.slice(20));
    const blockLen = nextSectionMatch ? nextSectionMatch.index + 20 : Math.min(tail.length, 1500);
    t = t.slice(0, m.index) + ' ' + t.slice(m.index + blockLen);
  }

  // Strip THANK YOU footer block + investor relations contact details
  t = t.replace(/THANK YOU!?[\s\S]{0,800}$/i, ' ');
  t = t.replace(/Investor Relations Advisors:[\s\S]{0,400}$/i, ' ');

  return t.replace(/\s+/g, ' ').trim();
}

// ── Sentence splitter — preserves trailing punctuation ─────────────────────
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z\d])/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 320);
}

// Detect "tabley" sentences: lots of numbers, very few prose words.
// Aeroflex decks dump P&L tables as continuous text — they look like quotes
// but are actually columns smushed together.
function isTableNoise(s: string): boolean {
  const numCount = (s.match(/\b\d+(?:[.,]\d+)?\b/g) || []).length;
  const wordCount = (s.match(/\b[A-Za-z]{3,}\b/g) || []).length;
  if (numCount >= 4 && wordCount <= 4) return true;
  if (numCount > wordCount && numCount >= 5) return true;
  // Period strings like "FY21 FY22 FY23 FY24 FY25 FY26 +25%"
  if (/(?:\bFY\s?\d{2,4}\b\s*){3,}/.test(s)) return true;
  if (/(?:\bQ[1-4]\s?FY\s?\d{2,4}\b\s*){3,}/.test(s)) return true;
  // Comma-separated number lists ("46 4,98,861 2.3 Q4FY26 571 3,31,763 18.9")
  if ((s.match(/\d[,.]\d{2,3}/g) || []).length >= 3) return true;
  // PATCH 0878 — Excel Bull/Base/Bear template leak: rows from the
  // SOIC valuation template ("PE - To rerate upward in bull case,,,
  // BEAR,7%,,, BASE,,REVENUE - To move in the same trend..."). Hits
  // typically have 5+ consecutive commas AND a "case/scenario" keyword.
  if (/,{5,}/.test(s)) return true;
  if (/\b(bull case|bear case|base case|exit (?:PE|MULTIPLE)|TTM PAT|terminal growth)\b/i.test(s) && /,{3,}/.test(s)) return true;
  // PATCH 0878 — spaced-letter slide titles ("I N V E S T O R
  // P R E S E N T A T I O N"). Detect 5+ single-letter "words" in a
  // row separated by spaces — that's PDF rendering of letter-spaced
  // headlines, not real prose.
  if (/(?:\b[A-Za-z]\b\s+){4,}[A-Za-z]\b/.test(s)) return true;
  // PATCH 0878 — chart-axis stubs from PDF extraction ("Ebitda margin,,,,
  // Net Profit Margin,,,,,,,,,,,,AVG."). Trailing commas + "AVG" / "MEDIAN".
  if (/\b(?:AVG\.?|MEDIAN|MIN|MAX)\b\s*$/i.test(s) && /,{3,}/.test(s)) return true;

  // Footnote-style sentences that snuck through previously:
  //   "70 Crs as on 31st March 2026 10 Figures for the previous periods
  //    have been re-grouped / re-classified to conform to the figures of
  //    the current periods. *Excludes FD with maturity of more than 3 months..."
  // Detect footnote markers + reclassification language + stub disclaimers.
  if (/\b(Figures for the previous periods? have been re[- ]?grouped|re[- ]?classified to conform|to conform to the (figures? of the )?current periods?)\b/i.test(s)) return true;
  if (/^\s*\*\s*(Excludes?|Includes?|Note|Refer)\b/i.test(s)) return true;
  if (/\bExcludes? FD with maturity\b/i.test(s)) return true;
  // Sentences that start with a bare number then "Crs as on" — that's a
  // table cell concatenated into prose. Reject.
  if (/^\s*\d{1,4}\s*Crs?\s+as\s+on\s+\d{1,2}(st|nd|rd|th)?\s+/i.test(s)) return true;
  // Page-number / asterisk-only stubs.
  if (/^\s*\*+\s*$/.test(s)) return true;
  if (/^\s*Page\s+\d+\s+(of|\/)\s+\d+/i.test(s)) return true;

  return false;
}

// Detect cover-letter / regulatory boilerplate sentences
function isBoilerplate(s: string): boolean {
  if (/\b(National Stock Exchange|BSE Limited|Bandra Kurla Complex|P\.J\. Towers|Listing Department|Trading Symbol|Compliance Officer|Membership No\.|Pursuant to Regulation|Yours faithfully|Dear Sir|Subject\s*:|safe harbor|forward looking statements concerning|risks and uncertainties)\b/i.test(s)) return true;
  // PATCH 0878 — `Sub:` (Indian cover-letter shortform of `Subject:`)
  // + scrip-code / symbol header line ("Scrip Code: 524774 Symbol: NGLFINE")
  if (/\bSub\s*:\s*(?:Investor|Outcome|Intimation|Disclosure|Submission|Notice|Update|Press Release)/i.test(s)) return true;
  if (/\b(?:Scrip Code|Symbol)\s*:\s*[\w\d]+\s+Sub\s*:/i.test(s)) return true;
  // PATCH 0878 — Address blocks: "Regd. Office ..." / "Corporate Office ..."
  // / lines ending with a 6-digit pincode + state + India.
  if (/\b(?:Regd\.?|Registered|Corporate|Corp\.?|Head)\s+Office\b/i.test(s)) return true;
  if (/\b\d{6}\s+(?:Maharashtra|Karnataka|Tamil\s*Nadu|Gujarat|Telangana|Andhra\s*Pradesh|Delhi|West\s*Bengal|Uttar\s*Pradesh|Haryana|Punjab|Rajasthan|Madhya\s*Pradesh|Kerala|Odisha|Bihar|Assam|Jharkhand|Chhattisgarh|Uttarakhand|Himachal\s*Pradesh|Goa)(?:,)?\s+India\b/i.test(s)) return true;
  // PATCH 0878 — Disclaimer / forward-looking-statement boilerplate that
  // appears at the start of every investor presentation.
  if (/\bThis (?:investor )?presentation has been prepared by\b/i.test(s)) return true;
  if (/\bdoes not constitute a (?:prospectus|placement memorandum|offer to acquire)\b/i.test(s)) return true;
  if (/\bNo representation or warranty,\s*express or implied\b/i.test(s)) return true;
  return false;
}

// Detect PROCEDURAL disclosures — corporate-action / governance announcements
// that show up at the back of investor presentations and BSE filings. They
// score on real verbs and dates but contain ZERO earnings analysis. These
// are commonly:
//   - dividend record dates / book closure / payment dates
//   - AGM / EGM / postal ballot notices
//   - director appointment / retirement / superannuation notices
//   - audit committee / nomination committee / committee changes
//   - share transfer / loss of share certificate notices
//   - SEBI / Reg 30 / Reg 31 / Reg 76 references
function isProceduralDisclosure(s: string): boolean {
  return (
    /\b(record date|book closure|cum[- ]?dividend|ex[- ]?dividend|AGM|EGM|postal ballot|notice of meeting)\b/i.test(s)
    || /\bentitlement of (members|shareholders) to receive (the |a |an )?(final |interim |special )?dividend\b/i.test(s)
    || /\bdividend (will be |shall be )?(paid|payable) on or before\b/i.test(s)
    || /\b(retiring from the services of the Company|superannuation|cessation of employment|appointment as (a |an )?(director|key managerial|chief|company secretary))\b/i.test(s)
    || /\bRegulation\s+(30|31|76|33)\b/i.test(s)
    || /\bForm\s+(CG[- ]?\d|MGT[- ]?\d|DIR[- ]?\d)\b/i.test(s)
    || /\b(loss of share certificate|share transfer|duplicate share certificate)\b/i.test(s)
    || /\b(Audit|Nomination & Remuneration|Risk Management|Stakeholders Relationship) Committee\b/i.test(s)
    || /\b(Friday|Monday|Tuesday|Wednesday|Thursday|Saturday|Sunday),\s*[A-Z][a-z]+\s+\d{1,2},\s*\d{4}\b/.test(s)  // formal date strings — only used for record dates / payment dates
  );
}

// ── Signal scorer — higher is more "informative" for an analyst ───────────
const NUMBER_RE = /\b\d+(?:\.\d+)?(?:\s*%|\s*bps|\s*bp|\s*x|\s*Cr|\s*crore|\s*Mn|\s*million|\s*billion|\s*Bn|\s*basis points)?\b/gi;
const STRONG_VERBS = /\b(grew|grow(ing|s)?|expand(ed|ing|s)?|increase[sd]?|rose|jumped|surged|accelerat(ed|ing|es)?|outperform(ed|ing|s)?|improved|enhanced|optimized|streamlined|delivered|achiev(ed|ing|es)?|beat|exceeded|raised|lowered|reduced|declined|contracted|fell|dropped|missed|impact(ed|ing|s)?|pressured|softened|moderated)\b/gi;
const FORWARD_WORDS = /\b(guidance|outlook|expect(s|ed|ing)?|forecast(ed|ing|s)?|target(ed|ing|s)?|plan(ned|ning|s)?|going forward|next quarter|next year|FY\s?\d{2,4}|H1|H2|Q[1-4])\b/gi;
// PATCH 0700 — widened topic vocabulary so the sentence-scorer rewards
// institutional terms that an analyst expects to hear in every Indian
// concall (operating leverage variants, GTM, channel mix, anti-dumping,
// FX hedge, MAT credit, capex breakup, ASP, OEM/aftermarket etc.).
const TOPIC_WORDS = /\b(margin|EBITDA|operating profit|operating leverage|fixed cost absorption|incremental margin|drop[- ]?through margin|capex|capital expenditure|capex intensity|capex\/sales|EPS|earnings|revenue|sales|volume|pricing|mix|new launch|new product|innovation|premium|rural|urban|distribution|reach|coverage|ad spend|A&P|R&D|gross margin|capacity|utilisation|utilization|inventory|working capital|debtor|receivable|payable|order book|backlog|attrition|hiring|deal pipeline|win rate|ARR|deal TCV|net adds|GMV|AUM|NIM|GNPA|slippage|provision|credit cost|book value|ROE|ROCE|ROCE bridge|asset turn(?:over)?|capital turnover|GTM|go[- ]to[- ]market|channel mix|online channel|modern trade|general trade|e[- ]commerce share|anti[- ]dumping|safeguard duty|import duty|FX hedge|forex hedge|natural hedge|hedge ratio|hedge cover|derivative MTM|MAT credit|MAT utilization|effective tax rate|ETR|deferred tax|ramp curve|ramp profile|ramp trajectory|dispatches|dispatch volume|realiz?ation|ASP|average selling price|value[- ]added mix|VAM|premium mix|specialty mix|customer concentration|vendor concentration|supplier concentration|greenfield|brownfield|growth capex|maintenance capex|expansion capex|debt refinancing|refinance|tenor extension|payout ratio|dividend policy|buyback|share repurchase|ESOP|share[- ]based payment|SBP|WC days|cash conversion cycle|CCC|DSO|inventory turn|debtor days|receivable days|collection period|peak debt|peak leverage|deleveraging|commissioning timeline|first commercial production|FCD|RFCD|net debt\/EBITDA|leverage ratio|EBITDA leverage|replacement demand|replacement cycle|OEM|aftermarket)\b/gi;

function scoreSentence(s: string): number {
  // Hard reject: pure-number tables, regulatory boilerplate, or procedural
  // disclosures (dividend record dates, retirement notices, AGM notices) —
  // never quote-worthy.
  if (isTableNoise(s)) return -100;
  if (isBoilerplate(s)) return -100;
  if (isProceduralDisclosure(s)) return -100;

  let score = 0;
  const numbers = s.match(NUMBER_RE);
  const numCount = numbers ? numbers.length : 0;
  const verbs = s.match(STRONG_VERBS);
  const verbCount = verbs ? verbs.length : 0;
  const fwd = s.match(FORWARD_WORDS);
  const topics = s.match(TOPIC_WORDS);
  const wordCount = (s.match(/\b[A-Za-z]{3,}\b/g) || []).length;

  if (numbers) score += Math.min(numCount, 5) * 6;
  if (verbs) score += Math.min(verbCount, 4) * 4;
  if (fwd) score += Math.min(fwd.length, 3) * 5;
  if (topics) score += Math.min(topics.length, 4) * 3;
  // Reward sentences with both a number AND a strong verb (real prose)
  if (numbers && verbs) score += 4;
  // Penalize numeric-heavy with no verbs (semi-tables)
  if (numCount >= 3 && verbCount === 0) score -= 8;
  // Require a minimum prose density — short sentences with 1-2 words rarely informative
  if (wordCount < 8) score -= 4;
  // Penalize over-long boilerplate
  if (s.length > 240) score -= 3;
  // Penalize Q&A formalities
  if (/\b(thank you|good morning|good evening|operator|next question|next caller|moderator|management team|hello)\b/i.test(s)) score -= 5;
  return score;
}

// ── Tone phrase tables ─────────────────────────────────────────────────────
const POSITIVE_PHRASES: Array<[RegExp, string]> = [
  [/\bstrong (growth|momentum|demand|performance|traction|order\s?book|pipeline|cash generation|EBITDA)\b/i, 'strong'],
  [/\b(record|all[- ]time high|highest\s+ever|best\s+quarter|highest ever quarterly)\b/i, 'record'],
  [/\bmargin (expansion|expanded|expand)/i, 'margin expansion'],
  [/\boperating leverage\b/i, 'operating leverage'],
  [/\b(double|triple|multi)[- ]?digit growth\b/i, 'double-digit growth'],
  [/\b(robust|healthy|encouraging|positive|constructive) (demand|outlook|growth|trajectory|trend|cash generation)\b/i, 'robust'],
  [/\baccelerat(ed|ing) growth\b/i, 'accelerating'],
  [/\bcapacity expansion|capex.*(approved|sanctioned|on track)|on track to (set up|commission|complete)/i, 'capex on track'],
  [/\bnew (product|launch|customer wins?|geographies)\b/i, 'new launches'],
  [/\b(green ?shoots|recovery|rebound|turnaround)\b/i, 'recovery'],
  [/\b(market share|share gains?)\b/i, 'market share gains'],
  [/\bbeat (consensus|expectations|estimates)\b/i, 'beat consensus'],
  [/\bwell (positioned|prepared|placed)\b/i, 'well positioned'],
  [/\bsustain(ed|able|ing)? (growth|momentum)\b/i, 'sustained momentum'],
  [/\bgrowth opportunit(y|ies)\b/i, 'growth opportunity'],
  [/\boperational excellence\b/i, 'operational excellence'],
  [/\b(landmark|breakthrough)\s+(year|quarter|achievement)\b/i, 'landmark milestone'],
  [/\blong[- ]term growth (opportunit|prospect|drivers)/i, 'long-term growth drivers'],
  [/\b(resilien(t|ce)|resilien(t|ce) of the business)\b/i, 'resilient business'],
  [/\bdividend (declared|increased|raised|special)/i, 'dividend declared'],
  [/\binvest(ment)?\s+(in|towards)\s+(automation|capacity|capability|R\s*&\s*D|innovation)/i, 'investment in capability'],
  [/\bsuccessful (entry|expansion|launch|commissioning)\b/i, 'successful entry'],
  [/\bdebt[- ]?free (balance sheet|company)\b/i, 'debt-free balance sheet'],
  [/\bbook[- ]to[- ]bill\s+(of|stood at|ratio)\s+\d/i, 'book-to-bill positive'],
  [/\bglobal customer (relationships|base|wins)\b/i, 'global customer base'],
];

const CAUTIOUS_PHRASES: Array<[RegExp, string]> = [
  [/\b(near[- ]?term|short[- ]?term) (challenge|headwind|softness|pressure)\b/i, 'near-term softness'],
  [/\bmonitor(ing)?\b/i, 'monitoring'],
  [/\bmoderat(ed|ing|ion)\b/i, 'moderation'],
  [/\bcaution(ary|ously)?\b/i, 'cautious'],
  [/\binventory (correction|adjustment|destocking)\b/i, 'destocking'],
  [/\b(input cost|raw material) (pressure|inflation)\b/i, 'input cost pressure'],
  [/\bchannel inventory\b/i, 'channel inventory'],
  [/\b(soft|muted|mixed) (demand|environment|trend)\b/i, 'soft demand'],
  [/\bmacro(economic)? (uncertainty|headwind|slowdown)\b/i, 'macro uncertainty'],
  [/\b(geopolitic|tariff|currency)\b/i, 'geopolitical/FX risk'],
];

const NEGATIVE_PHRASES: Array<[RegExp, string]> = [
  [/\bmargin (compression|decline|erosion|contraction|fell|dropped)\b/i, 'margin compression'],
  [/\b(volume|revenue|sales) (declin|contract|fell|dropped|down)/i, 'volume decline'],
  [/\bdemand destruction|destocking pressure\b/i, 'demand destruction'],
  [/\bguidance.{0,15}(cut|reduced|lower(ed)?)\b/i, 'guidance cut'],
  [/\b(provision|writeoff|write[- ]off|impairment)\b/i, 'provision/writeoff'],
  [/\bsignificant\s+(challenge|headwind|impact)/i, 'significant headwind'],
  [/\b(pricing|price) (pressure|erosion)/i, 'pricing pressure'],
  [/\b(loss|losses)\s+widened/i, 'losses widened'],
  [/\b(missed|fell short of|below) (consensus|expectations|estimates)\b/i, 'missed estimates'],
  [/\bsupply (chain )?(disruption|constraint|issue)\b/i, 'supply disruption'],
];

// ── Topic extraction patterns ──────────────────────────────────────────────
const TOPIC_PATTERNS: Array<{ topic: ConcallKeyMention['topic']; re: RegExp }> = [
  { topic: 'operating_leverage', re: /[^.!?]*\b(operating leverage|fixed cost (absorption|leverage)|scale (benefit|economies))\b[^.!?]*[.!?]/i },
  { topic: 'capex', re: /[^.!?]*\b(capex|capital expenditure|capacity (expansion|addition)|new plant|new facility|brownfield|greenfield|expanded.{0,40}capacity|scale up to)\b[^.!?]*[.!?]/i },
  { topic: 'capacity', re: /[^.!?]*\b(skid (capacity|assembly)|production capacity|installed capacity|capacity utili[sz]ation|capacity stood at|capacity of \d)\b[^.!?]*[.!?]/i },
  { topic: 'margins', re: /[^.!?]*\b(gross margin|EBITDA margin|operating margin|margin (expansion|compression|trajectory|outlook|of \d))\b[^.!?]*[.!?]/i },
  { topic: 'eps', re: /[^.!?]*\b(EPS (in|of|stood)|earnings per share|profit (before|after) tax|PAT (grew|declined|growth)|cash profit)\b[^.!?]*[.!?]/i },
  { topic: 'launches', re: /[^.!?]*\b(new (product|launch|SKU|variant|innovation)|recently launched|launching|introduce[ds]?|successful entry)\b[^.!?]*[.!?]/i },
  { topic: 'demand', re: /[^.!?]*\b(demand (environment|trend|outlook|across)|consumer (sentiment|spending)|order (book|inflow|intake)|strong demand)\b[^.!?]*[.!?]/i },
  { topic: 'guidance', re: /[^.!?]*\b(guidance|outlook for|expect.{0,40}(year|FY|H[12]|Q[1-4])|on track to|plan(s|ned)? to (set up|commission|scale|expand)|by (Q[1-4]\s?FY?\s?\d|FY\s?\d|[a-z]{3,4}-\d{2}))\b[^.!?]*[.!?]/i },
  { topic: 'inflation', re: /[^.!?]*\b(input cost (pressure|inflation)|raw material (cost|inflation|prices)|commodity (cost|inflation|prices)|palm oil|crude (price|inflation)|copper (price|inflation)|aluminium (price|inflation)|steel prices?)\b[^.!?]*[.!?]/i },
  { topic: 'pricing', re: /[^.!?]*\b(price (hike|increase|cut)|pricing power|pricing strategy|pass(ed|ing)? (on|through))\b[^.!?]*[.!?]/i },
  { topic: 'dividend', re: /[^.!?]*\b(declared (a |an )?(final |interim |special )?dividend|dividend of (Rs|₹)|interim dividend|special dividend|dividend per (share|equity))\b[^.!?]*[.!?]/i },
  { topic: 'subsidiary', re: /[^.!?]*\b(subsidiary|Hyd[- ]?Air|wholly[- ]owned subsidiary|JV partner|joint venture)\b[^.!?]{0,40}\b(grew|growth|expanded|recorded|delivered|reported|YoY)/i },
  { topic: 'geographic_mix', re: /[^.!?]*\b(domestic (\s*[:.]\s*|\s+vs\s+|\s+&\s+)?export|geographic(al)? (split|mix)|exports? (to|grew|declined|share)|Americas?|export (revenue|share|contribution))\b[^.!?]*[.!?]/i },
  { topic: 'rd_pipeline', re: /[^.!?]*\b(R\s*&\s*D (lab|spend|pipeline|cost|intensity)|research and development|products (under|in) R\s*&\s*D|R\s*&\s*D (centre|center))\b[^.!?]*[.!?]/i },
  { topic: 'customer_wins', re: /[^.!?]*\b(customer (wins?|additions?|onboard|relationships|base)|won (a|new) (contract|deal|customer)|client wins?|new geographies|new (region|market) entry)\b[^.!?]*[.!?]/i },

  // ── Expanded coverage based on common Indian concall patterns ────────
  // Order book / inflow with explicit numbers — critical for industrials,
  // capital goods, EPC, defense, infra, real estate, pharma CDMO.
  { topic: 'order_book', re: /[^.!?]*\b(order (book|inflow|backlog|intake|pipeline|book\s+(stood|as|of)|book[-\s]?to[-\s]?bill)|book[- ]to[- ]bill|outstanding orders?|pending orders?|unexecuted (order book|orders)|L1 (in|for|position)|tenders? worth|secured.{0,40}(order|contract))\b[^.!?]*[.!?]/i },

  // Capacity utilization with explicit %, common across all manufacturing.
  { topic: 'utilization', re: /[^.!?]*\b(capacity utili[sz]ation|plant utili[sz]ation|utili[sz]ation (of|at|rate|level|stood|currently|at\s+\d)|operating at\s+\d+\s*%|running at\s+\d+\s*%|plant.{0,30}\d+\s*%|nameplate capacity)\b[^.!?]*[.!?]/i },

  // Volume vs value growth split — FMCG / Auto / Cement / Consumer Durables.
  // Indian analysts watch this religiously because price-led growth is
  // discounted vs underlying volume growth.
  { topic: 'volume_value', re: /[^.!?]*\b(volume (growth|grew|increased|expanded|of\s+\d)|underlying volume|UVG\b|value (vs|versus|and) volume|price[- ](?:led|driven|mix) growth|realization (improvement|growth|stood))\b[^.!?]*[.!?]/i },

  // Segmental revenue / vertical mix — most listed companies disclose.
  { topic: 'segment_mix', re: /[^.!?]*\b((segment|vertical|division|business unit|category|product line)\s+(revenue|growth|grew|contribution|wise|mix|breakup|breakdown)|segment[- ]wise|vertical[- ]wise|consumer (vs|and) industrial|B2B (vs|and|to) B2C)\b[^.!?]*[.!?]/i },

  // Net debt / leverage / deleveraging commentary.
  { topic: 'net_debt', re: /[^.!?]*\b(net debt|gross debt|total debt|debt.{0,15}(reduced|increased|repaid|prepaid|maturity)|debt[- ]?to[- ]?(equity|EBITDA)|leverage (ratio|stood|reduced|increased)|deleveraging|debt[- ]free|cash and (equivalents?|bank balance)|net cash position|borrowings? (of|stood|reduced))\b[^.!?]*[.!?]/i },

  // PLI / RoDTEP / FAME / production-linked incentive — Indian-specific
  // government schemes that materially affect P&L for eligible companies.
  { topic: 'pli_rodtep', re: /[^.!?]*\b(production[- ]linked incentive|PLI scheme|PLI (benefit|approval|eligibility|incentive)|RoDTEP|export incentive|FAME[- ]II|MEIS|SEIS|advance authorization|EPCG)\b[^.!?]*[.!?]/i },

  // Pricing action — explicit price hikes / cuts / price-led growth.
  { topic: 'pricing_action', re: /[^.!?]*\b(price hike|price increase|price cut|price (action|adjustment|revision)|price[- ]led growth|pass(ed|ing)? (on|through) (the )?(input|raw material) cost|raised prices|revised prices)\b[^.!?]*[.!?]/i },

  // M&A / strategic — acquisitions / divestments / JVs / demergers.
  // PATCH 0713 — widened to cover scheme-of-amalgamation / slump-sale /
  // composite scheme / NCLT / court-convened meeting / binding term sheet
  // / merger ratio / share swap — all Indian-specific M&A phrasings.
  { topic: 'mna', re: /[^.!?]*\b(acquired|acquisition (of|completed|announced)|merger|demerger|hive[- ]?off|divest(ed|ment|ing)?|strategic (partnership|alliance|investment)|stake (acquired|sold|bought)|joint venture (with|formed|signed)|signed (an?|a) (definitive|share (purchase|subscription)) agreement|scheme of (amalgamation|arrangement|merger|capital reduction)|composite scheme of arrangement|slump (sale|exchange)|share (swap|exchange) ratio|merger ratio|court convened meeting|NCLT (approval|order|sanction|hearing)|binding term sheet|asset purchase agreement)\b[^.!?]*[.!?]/i },

  // ESG / net-zero / renewable energy commitments — material for ESG-rated
  // funds and an increasing focus area in Indian midcap commentary.
  { topic: 'esg', re: /[^.!?]*\b(net[- ]zero|carbon neutral|renewable energy (mix|share|capacity|sourcing)|solar (capacity|installation|rooftop)|ESG (rating|score|policy|framework)|sustainability (target|goal|report)|green (bond|finance)|water positive|zero waste|reduced carbon)\b[^.!?]*[.!?]/i },
];

// ── Sector KPI keyword maps ────────────────────────────────────────────────
// Each KPI label gets one or more regexes. When a transcript matches, we
// flip the KPI to tracked=true and attach the matching sentence as evidence.
const SECTOR_KPI_PATTERNS: Record<string, RegExp[]> = {
  // FMCG
  'Volume Growth': [/\bvolume(s)?\s+(grew|growth|increased|up|expansion|of\s+\d)/i, /\bunderlying volume\b/i, /\bUVG\b/],
  'Rural / Urban Mix': [/\b(rural|urban|tier[- ]?[123]|metro)\s+(growth|consumption|demand|recovery|mix)\b/i, /\brural\s+(recovery|consumption)/i],
  'Gross Margin': [/\bgross margin\b/i, /\b(palm oil|raw material|commodity|input cost)\s+(price|inflation|deflation)/i],
  'Ad Spend Intensity': [/\b(A\s*&\s*P|advertising|brand (investment|spend)|marketing spend)\b/i, /\bworking media\b/i],
  'Distribution Reach': [/\b(direct (outlets|coverage)|numeric distribution|distribution reach|RCS|retail (touch[- ]?points|coverage))\b/i],
  'New Product Mix': [/\b(new (product|launches?|SKU)|NPD|innovation pipeline|premium portfolio)\b/i],
  'Premiumization': [/\bpremium(isation|ization|i[sz]e[ds]?|\s+portfolio|\s+segment)\b/i, /\bhigher[- ]?priced/i],
  // IT / Services
  'TCV / Deal Wins': [/\b(TCV|total contract value|deal wins?|new deal|deal pipeline|order intake)\b/i],
  'Constant Currency Revenue': [/\b(constant currency|CC growth|CC revenue|reported CC)\b/i],
  'Headcount': [/\b(headcount|attrition|fresh(er|ers)?\s+addition|net (additions?|adds))\b/i],
  'Margin Trajectory': [/\b(EBIT margin|operating margin|margin (expansion|compression|trajectory))\b/i],
  // Pharma / Healthcare
  'US Generics Pricing': [/\b(US generics|price erosion|gPDx|Para IV|generic pricing)\b/i],
  'India Branded Growth': [/\b(IPM|Indian pharmaceutical market|domestic formulation|chronic|acute|prescription growth)\b/i],
  'R&D / Sales': [/\bR\s*&\s*D\s+(spend|cost|intensity)\b/i, /\bresearch and development\b/i],
  'New Launches': [/\b(new (launch|approval|filing)|ANDA|DMF|para iv|FDA approval|tentative approval)\b/i],
  'EBITDA Margin': [/\bEBITDA margin\b/i],
  'API / Formulations Mix': [/\b(API|formulation(s)?|backward integration|captive API)\b/i],
  // Banks / NBFC
  'NIM': [/\b(NIM|net interest margin)\b/i],
  'GNPA': [/\bGNPA\b|\bgross NPA\b|\b(asset quality|slippage|stress)\b/i],
  'CASA': [/\bCASA\b|\b(savings|current account)\s+(growth|ratio)/i],
  'Credit Cost': [/\b(credit cost|provisioning|provision coverage|PCR)\b/i],
  // Auto / Industrials / Capital Goods
  // PATCH 0686 — widened patterns to match real-world Indian concall
  // language. Previously a transcript saying "received orders", "order
  // pipeline", "incremental orders", "POs", or "letter of intent" went
  // undetected because the regex demanded the literal phrase "order
  // inflow" / "order book". Verified on Aeroflex FY26 concall (skid +
  // metal bellows orders) — Order Book / Backlog + Order Inflow both
  // now fire on real prose.
  'Order Book': [
    /\b(order (book|inflow|backlog|intake|pipeline))\b/i,
    /\bbook[- ]to[- ]bill\b/i,
    /\b(no order book disclosure|order book.{0,30}not disclosed)\b/i,
    /\bbacklog (of|stood at|reached|touched)\s+(₹|Rs\.?|INR)?\s*\d/i,
  ],
  'Order Inflow': [
    /\b(order (inflow|intake|booking|wins))\b/i,
    /\b(fresh|incremental|new|won|received|secured|bagged)\s+orders?\b/i,
    /\breceiv(e|ed|ing)\s+orders?\b/i,
    /\b(deal wins?|secured (a |the )?contract|won.{0,30}contract)\b/i,
    /\bL1\s+(in|for|position|status)\b/i,
    /\b(letter\s+of\s+(intent|award)|LO[IA]|purchase\s+orders?|\bPOs?\b)\b/i,
    /\bquarterly\s+POs?\b/i,
  ],
  'Order Book / Backlog': [
    /\b(order (book|backlog|pipeline))\b/i,
    /\bbook[- ]to[- ]bill\b/i,
    /\bbacklog (of|stood|reached|touched)\b/i,
    /\b(unexecuted|pending|outstanding|executable)\s+orders?\b/i,
    /\b(no order book disclosure|backlog.{0,30}not disclosed)\b/i,
    /\b(under\s+execution|to\s+be\s+executed)\b/i,
  ],
  'Execution / Revenue': [
    /\b(execution|revenue conversion|backlog (conversion|burn|drawdown)|delivered (orders|revenue))\b/i,
    /\b(commission(ed|ing)|delivered|despatch(ed|es)|dispatch(ed|es))\b.{0,40}(plant|capacity|skid|unit|order)/i,
    /\b(throughput|production\s+ramp|ramp[- ]?up)\b/i,
  ],
  'Capex Plan': [
    /\b(capex (plan|outlay|guidance|cycle)|capital expenditure|capacity (expansion|addition|ramp))\b/i,
    /\b(new (plant|facility|line)|brownfield|greenfield|scale up to|expanded.{0,40}capacity)\b/i,
    /\b(commission(ed|ing)?\s+(a\s+)?(new\s+)?(plant|line|unit))\b/i,
  ],
  'Capacity Utilization': [
    /\b(capacity utili[sz]ation|plant utili[sz]ation|production volume)\b/i,
    /\b(capacity (of|stood at|increased to|targeting|operating at))\b/i,
    /\b(\d{1,3}\s*%\s*(capacity\s*)?utili[sz]ation)\b/i,
    /\butili[sz]ation.{0,15}(\d{1,3}\s*%)/i,
  ],
  'Export Order Mix': [
    /\b(export (mix|order|share|revenue|geography|contribution))\b/i,
    /\b(domestic\s*[:.&]?\s*export|geographic(al)? (split|mix))\b/i,
    /\b(international|overseas|global)\s+(customers?|markets?|business|orders?|revenue)\b/i,
    /\bprincipal\s+(company|customer|supplier)\b/i,
    /\b(US|USA|North America|Europe|Middle East|EMEA|APAC|Asia[- ]Pacific)\b.{0,30}(business|revenue|market|geography)/i,
  ],
  // Real estate
  'Pre-sales / Bookings': [/\b(pre[- ]?sales|booking value|sales velocity|launches|new launches|launch pipeline)\b/i],
  'Collections': [/\b(collection (efficiency|run[- ]?rate)|cash flow from operations|cash collections)\b/i],
  'Project Launches': [/\b(project (launch|launched)|new project|tower (launch|launched))\b/i],
  // Energy / Utilities
  'PLF / Capacity Factor': [/\bPLF\b|\bcapacity factor\b|\bload factor\b|\bgeneration (volume|output)/i],
  'Tariff': [/\btariff\b|\bpower purchase\b|\bPPA\b|\bmerchant power\b/i],
  'Generation Volume': [/\b(generation (volume|output)|MW (commission(ed|ing)?|added))/i],
  // Note: 'EBITDA Margin' and 'Margin Trajectory' are already defined under
  // Pharma and IT/Services above — they apply cross-sector via the key match.

  // ── PATCH 0700 — Institutional vocabulary expansion ─────────────────
  // These KPIs are universal across Indian sectors; analysts ask about
  // each on every concall. Previously the extractor missed them because
  // SECTOR_KPI_PATTERNS only had narrow sector-specific labels. Adding
  // them as new KPI keys lights up KEY_TOPICS / topical mentions and
  // (when a sector template includes the same label) flips KPIs from
  // "○ not extracted" to "● available".
  'Operating Leverage': [
    /\boperating leverage\b/i,
    /\bfixed[- ]?cost (absorption|leverage|dilution)\b/i,
    /\bincremental margin\b/i,
    /\bdrop[- ]?through margin\b/i,
    /\b(scale|economies of scale)\s+(benefit|advantage|leverage)\b/i,
  ],
  'GTM Strategy': [
    /\bGTM\b/,
    /\bgo[- ]to[- ]market\b/i,
    /\bchannel strategy\b/i,
    /\broute[- ]to[- ]market\b/i,
  ],
  'Channel Mix': [
    /\bonline channel\b/i,
    /\bmodern trade\b/i,
    /\bgeneral trade\b/i,
    /\b(e[- ]?commerce|D2C)\s+(share|mix|contribution|growth)\b/i,
    /\bchannel mix\b/i,
    /\b(quick commerce|q[- ]?commerce)\b/i,
  ],
  'Anti-Dumping Duty': [
    /\banti[- ]?dumping\b/i,
    /\b(?:ADD|CVD)\b/,
    /\bimport duty (hike|increase|levied|imposed)\b/i,
    /\bsafeguard duty\b/i,
    /\bcountervailing duty\b/i,
  ],
  'FX Hedging': [
    /\b(forex|FX)\s+hedge\b/i,
    /\bhedge ratio\b/i,
    /\bhedge cover\b/i,
    /\bnatural hedge\b/i,
    /\bderivative MTM\b/i,
    /\b(naturally )?hedged\s+(exposure|position|book)\b/i,
  ],
  'Tax Rate / MAT Credit': [
    /\bMAT credit\b/i,
    /\bMAT utili[sz]ation\b/i,
    /\beffective tax rate\b/i,
    /\bETR\b/,
    /\bdeferred tax\b/i,
    /\btax (rate|payout)\s+(of|stood|at|guidance)\b/i,
  ],
  'Capex Intensity': [
    /\bcapex\s*\/\s*sales\b/i,
    /\bcapex to sales\b/i,
    /\bcapex intensity\b/i,
    /\bcapex as a percentage of (sales|revenue)\b/i,
  ],
  'Asset Turn': [
    /\basset turnover\b/i,
    /\basset turn\b/i,
    /\bcapital turnover\b/i,
    /\bfixed asset turnover\b/i,
  ],
  'ROCE Bridge': [
    /\bROCE (bridge|expansion|improvement|trajectory|walk)\b/i,
    /\b(?:ROIC|return on capital)\s+(?:improvement|expansion|trajectory)\b/i,
  ],
  'Capacity Ramp Curve': [
    /\bramp\s+(curve|profile|trajectory|schedule)\b/i,
    /\bramp[- ]?up\s+(profile|trajectory|schedule|plan)\b/i,
    /\bproduction ramp\b/i,
  ],
  'Dispatch Volumes': [
    /\bdispatches\b/i,
    /\bdispatch (volume|run[- ]?rate)\b/i,
    /\b(tons|tonnes|units|skids)\s+dispatched\b/i,
    /\bdespatch(ed|es)?\b/i,
  ],
  'Realization per Unit': [
    /\brealiz?ation per (ton|tonne|unit|kg|litre|liter)\b/i,
    /\bper[- ]?unit realiz?ation\b/i,
    /\bASP\b/,
    /\baverage selling price\b/i,
    /\bblended realiz?ation\b/i,
  ],
  'Value-Added Mix': [
    /\bvalue[- ]?added mix\b/i,
    /\bVAM\b/,
    /\bpremium mix\b/i,
    /\bspecialty mix\b/i,
    /\bhigh[- ]margin mix\b/i,
    /\bvalue[- ]added (products|portfolio|share)\b/i,
  ],
  'Customer Concentration': [
    /\btop\s+(5|10|five|ten)\s+customer/i,
    /\bcustomer concentration\b/i,
    /\bsingle largest customer\b/i,
    /\bkey customer\s+contribut/i,
    /\blargest client\b/i,
  ],
  'Vendor Concentration': [
    /\bsingle vendor\b/i,
    /\bvendor concentration\b/i,
    /\bsupplier concentration\b/i,
    /\bsole (vendor|supplier)\b/i,
    /\btop\s+(5|10|five|ten)\s+(vendor|supplier)/i,
  ],
  'Capex Breakup': [
    /\bgreenfield\b/i,
    /\bbrownfield\b/i,
    /\bgrowth capex\b/i,
    /\bmaintenance capex\b/i,
    /\bexpansion capex\b/i,
    /\bcapex (breakup|split|breakdown)\b/i,
  ],
  'Debt Refinancing': [
    /\bdebt refinancing\b/i,
    /\brefinanc(e|ing|ed)\b/i,
    /\blower cost of (debt|borrowing)\b/i,
    /\btenor extension\b/i,
    /\b(coupon|interest rate) reduction\b/i,
    /\bre[- ]?priced (debt|borrowing|loan)\b/i,
  ],
  'Dividend Payout': [
    /\bdividend payout\b/i,
    /\bpayout ratio\b/i,
    /\bdividend policy\b/i,
    /\bdistributable surplus\b/i,
  ],
  'Buyback': [
    /\bbuyback\b/i,
    /\bshare repurchase\b/i,
    /\btender offer buyback\b/i,
    /\bopen market buyback\b/i,
  ],
  'ESOP Dilution': [
    /\bESOP\b/,
    /\bemployee stock option\b/i,
    /\bshare[- ]based payment\b/i,
    /\bSBP\b/,
    /\bESOP dilution\b/i,
    /\bRSU\b/,
  ],
  'Working Capital Days': [
    /\bworking capital days\b/i,
    /\bWC days\b/i,
    /\bcash conversion cycle\b/i,
    /\bCCC\b/,
    /\bworking capital cycle\b/i,
  ],
  'Inventory Days': [
    /\binventory days\b/i,
    /\binventory turn(over)?\b/i,
    /\bdays of inventory\b/i,
    /\bstock turn\b/i,
  ],
  'Debtor Days': [
    /\bdebtor days\b/i,
    /\bDSO\b/,
    /\breceivable days\b/i,
    /\bcollection period\b/i,
    /\bdays sales outstanding\b/i,
  ],
  'Peak Debt': [
    /\bpeak debt\b/i,
    /\bpeak leverage\b/i,
    /\bdeleveraging path\b/i,
    /\bdebt peak\b/i,
  ],
  'Plant Commissioning': [
    /\bcommissioning (timeline|schedule|date|status)\b/i,
    /\bfirst commercial production\b/i,
    /\bFCD\b/,
    /\bRFCD\b/,
    /\bmechanical completion\b/i,
    /\btrial production\b/i,
  ],
  'EBITDA Leverage': [
    /\bEBITDA leverage\b/i,
    /\bnet debt\s*\/\s*EBITDA\b/i,
    /\bleverage ratio\b/i,
    /\bdebt[- ]?to[- ]?EBITDA\b/i,
  ],
  'Replacement Demand': [
    /\breplacement demand\b/i,
    /\breplacement cycle\b/i,
    /\breplacement (market|sales)\b/i,
  ],
  'OEM vs Aftermarket Mix': [
    /\bOEM business\b/i,
    /\baftermarket business\b/i,
    /\baftermarket (mix|share|contribution)\b/i,
    /\bOEM\s*[:.&]?\s*aftermarket\b/i,
    /\boriginal equipment manufacturer\b/i,
  ],
};

// ── Main extractor ─────────────────────────────────────────────────────────
export function extractIndiaConcallInsights(
  rawText: string,
  sectorTemplate: IndiaSectorTemplate | null,
): ConcallInsights {
  const text = (rawText || '').trim();
  const emptyRisk: ConcallRiskProfile = {
    customerConcentrationPct: null,
    customerConcentrationQuote: null,
    exportConcentrationPct: null,
    exportConcentrationQuote: null,
    fxHedgePct: null,
    fxHedgeQuote: null,
    debtRefinancingFlag: false,
    debtRefinancingQuote: null,
    commoditySensitivityFlag: false,
    commoditySensitivityQuote: null,
    workingCapitalStressFlag: false,
    workingCapitalStressQuote: null,
  };
  const empty: ConcallInsights = {
    topQuotes: [],
    toneSignals: [],
    keyMentions: [],
    sectorKpiHits: [],
    concallScore: 0,
    concallGrade: 'F',
    positiveCount: 0,
    negativeCount: 0,
    cautiousCount: 0,
    charsAnalyzed: 0,
    riskProfile: emptyRisk,
  };
  if (text.length < 50) return empty;

  const cleaned = stripBoilerplate(text);
  const sentences = splitSentences(cleaned).filter(
    (s) => !isBoilerplate(s) && !isTableNoise(s) && !isProceduralDisclosure(s),
  );

  // 1. Rank sentences by score, dedupe near-duplicates, pick top 4.
  const scored = sentences
    .map((s) => ({ s, score: scoreSentence(s) }))
    .filter((x) => x.score >= 8)
    .sort((a, b) => b.score - a.score);
  const topQuotes: string[] = [];
  const seen = new Set<string>();
  for (const { s } of scored) {
    const key = s.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topQuotes.push(s);
    if (topQuotes.length >= 4) break;
  }

  // 2. Tone signals — first match per phrase wins, capped at 12.
  const toneSignals: ConcallToneSignal[] = [];
  const captureSignals = (
    phrases: Array<[RegExp, string]>,
    sentiment: ConcallToneSignal['sentiment'],
  ) => {
    for (const [re, label] of phrases) {
      const sentence = sentences.find((s) => re.test(s));
      if (sentence) {
        toneSignals.push({ phrase: label, context: sentence, sentiment });
      }
    }
  };
  captureSignals(POSITIVE_PHRASES, 'positive');
  captureSignals(CAUTIOUS_PHRASES, 'cautious');
  captureSignals(NEGATIVE_PHRASES, 'negative');

  const positiveCount = toneSignals.filter((t) => t.sentiment === 'positive').length;
  const negativeCount = toneSignals.filter((t) => t.sentiment === 'negative').length;
  const cautiousCount = toneSignals.filter((t) => t.sentiment === 'cautious').length;

  const trimmedTone = toneSignals.slice(0, 12);

  // 3. Topic mentions — find best matching SENTENCE (not regex span) for each
  // topic. Requires verb + min word count to avoid catching chart headers.
  const keyMentions: ConcallKeyMention[] = [];
  for (const { topic, re } of TOPIC_PATTERNS) {
    // Look across already-cleaned sentences to ensure we don't pick up
    // table noise. Take the highest-scoring sentence that matches.
    const candidates = sentences.filter((s) => re.test(s) && !isTableNoise(s) && !isBoilerplate(s));
    if (candidates.length === 0) continue;
    // Prefer sentences with a verb and at least 10 prose words
    const scored = candidates
      .map((s) => ({ s, sc: scoreSentence(s) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc);
    if (scored.length === 0) continue;
    const quote = scored[0].s.replace(/\s+/g, ' ').trim();
    if (quote.length >= 30 && quote.length <= 320) {
      keyMentions.push({ topic, quote });
    }
  }

  // 4. Sector KPI hits.
  // Two-tier matching:
  //   (a) prefer a clean prose sentence as evidence
  //   (b) fall back to "the keyword appears anywhere in the cleaned text"
  //       so KPIs like EBITDA Margin still light up when the deck only
  //       mentions them inside a P&L table
  const sectorKpiHits: ConcallSectorKpiHit[] = [];
  if (sectorTemplate) {
    for (const kpi of sectorTemplate.kpis) {
      const patterns = SECTOR_KPI_PATTERNS[kpi.label];
      if (!patterns) continue;
      let evidence: string | null = null;
      for (const re of patterns) {
        const sentence = sentences.find((s) => re.test(s));
        if (sentence) { evidence = sentence; break; }
      }
      if (!evidence) {
        // Fallback: keyword present somewhere in cleaned text, but only inside
        // tables / boilerplate. Track the KPI as mentioned, with a generic
        // pointer instead of a specific quote.
        for (const re of patterns) {
          if (re.test(cleaned)) {
            evidence = '__table_data__';
            break;
          }
        }
      }
      if (evidence === '__table_data__') {
        sectorKpiHits.push({
          label: kpi.label,
          value: 'mentioned in concall (P&L table)',
          quote: 'Found in the financial-data table; no narrative sentence available.',
        });
      } else if (evidence) {
        sectorKpiHits.push({ label: kpi.label, value: 'mentioned in concall', quote: evidence });
      }
    }
  }

  // 5. Composite Concall Score.
  // Inputs: positive count, negative count, topic coverage, top-quote signal
  // density. Range squashed to 0-100.
  const topicsHit = keyMentions.length;
  const kpiHits = sectorKpiHits.length;
  const sentimentBalance = positiveCount - negativeCount - 0.5 * cautiousCount;
  const topQuoteAvg =
    topQuotes.length > 0
      ? scored.slice(0, topQuotes.length).reduce((a, b) => a + b.score, 0) / topQuotes.length
      : 0;
  // Map each input into a 0-25 contribution.
  const sentimentScore = Math.max(0, Math.min(25, 12 + sentimentBalance * 2.5));
  const topicScore = Math.min(25, topicsHit * 3.5);
  const kpiScore = Math.min(25, kpiHits * 5);
  const densityScore = Math.min(25, topQuoteAvg / 1.5);
  const concallScore = Math.round(sentimentScore + topicScore + kpiScore + densityScore);

  let concallGrade: ConcallInsights['concallGrade'] = 'F';
  if (concallScore >= 90) concallGrade = 'A+';
  else if (concallScore >= 82) concallGrade = 'A';
  else if (concallScore >= 75) concallGrade = 'A-';
  else if (concallScore >= 68) concallGrade = 'B+';
  else if (concallScore >= 60) concallGrade = 'B';
  else if (concallScore >= 53) concallGrade = 'B-';
  else if (concallScore >= 46) concallGrade = 'C+';
  else if (concallScore >= 38) concallGrade = 'C';
  else if (concallScore >= 30) concallGrade = 'C-';
  else if (concallScore >= 20) concallGrade = 'D';
  else concallGrade = 'F';

  // ── Risk profile extraction ───────────────────────────────────────
  // Run regex extractors over the cleaned text. Each looks for a
  // specific institutional risk metric that's routinely stated in
  // Indian concalls. We capture both the percentage (where present)
  // and the source quote so the UI can show provenance on hover.
  const riskProfile = extractRiskProfile(cleaned, sentences);

  return {
    topQuotes,
    toneSignals: trimmedTone,
    keyMentions,
    sectorKpiHits,
    concallScore,
    concallGrade,
    positiveCount,
    negativeCount,
    cautiousCount,
    charsAnalyzed: text.length,
    riskProfile,
  };
}

// ── Risk profile extractor ────────────────────────────────────────────
// Scans concall sentences for structurally-stated risk metrics. We avoid
// false positives by requiring the percentage / number to be in the same
// sentence as the qualifying noun (customer / export / hedge / debt).
function extractRiskProfile(cleaned: string, sentences: string[]): ConcallRiskProfile {
  const out: ConcallRiskProfile = {
    customerConcentrationPct: null,
    customerConcentrationQuote: null,
    exportConcentrationPct: null,
    exportConcentrationQuote: null,
    fxHedgePct: null,
    fxHedgeQuote: null,
    debtRefinancingFlag: false,
    debtRefinancingQuote: null,
    commoditySensitivityFlag: false,
    commoditySensitivityQuote: null,
    workingCapitalStressFlag: false,
    workingCapitalStressQuote: null,
  };

  // Customer concentration — "top 5 customers contribute 60%",
  // "single principal", "top customer ~26% of sales", etc.
  const customerRe = /\b(?:top\s+(?:1|one|single|2|two|3|three|5|five|ten|10)\s+(?:customer|client)s?|largest\s+(?:customer|client)|single\s+principal|key\s+(?:customer|client)|customer\s+concentration)[\s\S]{0,80}?(\d{1,2}(?:[.,]\d+)?)\s*%/i;
  const exclusivityRe = /\b(under\s+exclusivity|sole\s+supplier|single\s+principal|exclusive\s+(?:vendor|supplier))/i;
  for (const s of sentences) {
    if (out.customerConcentrationPct !== null) break;
    const m = s.match(customerRe);
    if (m) {
      const v = parseFloat(m[1].replace(',', '.'));
      if (!Number.isNaN(v) && v > 0 && v <= 100) {
        out.customerConcentrationPct = v;
        out.customerConcentrationQuote = s.length > 240 ? s.slice(0, 237) + '…' : s;
      }
    } else if (exclusivityRe.test(s) && out.customerConcentrationQuote === null) {
      out.customerConcentrationQuote = s.length > 240 ? s.slice(0, 237) + '…' : s;
      // No numeric — flag with -1 sentinel via leaving pct null but quote populated
    }
  }

  // Export concentration — "exports 75% of revenue", "export revenue X%"
  const exportRe = /\b(?:exports?\s+(?:account\s+for|contribut(?:e|ing)|are|stand\s+at|of\s+revenue)?[\s\S]{0,30}?(\d{1,2}(?:[.,]\d+)?)\s*%|(?:revenue|sales)\s+(?:from\s+)?exports?[\s\S]{0,30}?(\d{1,2}(?:[.,]\d+)?)\s*%|export[s]?\s+share[\s\S]{0,30}?(\d{1,2}(?:[.,]\d+)?)\s*%)/i;
  for (const s of sentences) {
    if (out.exportConcentrationPct !== null) break;
    const m = s.match(exportRe);
    if (m) {
      const v = parseFloat((m[1] || m[2] || m[3] || '').replace(',', '.'));
      if (!Number.isNaN(v) && v > 0 && v <= 100) {
        out.exportConcentrationPct = v;
        out.exportConcentrationQuote = s.length > 240 ? s.slice(0, 237) + '…' : s;
      }
    }
  }

  // FX hedging — "60% hedged", "natural hedge", "USD revenue 40%"
  const fxRe = /\b(?:(\d{1,2}(?:[.,]\d+)?)\s*%[\s\S]{0,30}?(?:hedge|hedged|forex|FX|USD)|hedge[d]?\s+(?:position|book|exposure)[\s\S]{0,30}?(\d{1,2}(?:[.,]\d+)?)\s*%|forex\s+(?:exposure|hedge)[\s\S]{0,30}?(\d{1,2}(?:[.,]\d+)?)\s*%)/i;
  const naturalHedgeRe = /\b(natural\s+hedge|naturally\s+hedged|forex\s+neutral)/i;
  for (const s of sentences) {
    if (out.fxHedgePct !== null) break;
    const m = s.match(fxRe);
    if (m) {
      const v = parseFloat((m[1] || m[2] || m[3] || '').replace(',', '.'));
      if (!Number.isNaN(v) && v > 0 && v <= 100) {
        out.fxHedgePct = v;
        out.fxHedgeQuote = s.length > 240 ? s.slice(0, 237) + '…' : s;
      }
    } else if (naturalHedgeRe.test(s) && out.fxHedgeQuote === null) {
      out.fxHedgeQuote = s.length > 240 ? s.slice(0, 237) + '…' : s;
    }
  }

  // Debt refinancing — explicit refinancing mentions or upcoming maturities
  const debtRe = /\b(refinanc(?:e|ing|ed)|debt\s+(?:maturit|coming\s+due|repayment\s+schedule)|borrowings?\s+(?:due|maturity|maturing)|bond\s+redemption|tenure\s+extension)/i;
  for (const s of sentences) {
    if (out.debtRefinancingFlag) break;
    if (debtRe.test(s)) {
      out.debtRefinancingFlag = true;
      out.debtRefinancingQuote = s.length > 240 ? s.slice(0, 237) + '…' : s;
    }
  }

  // Commodity / RM sensitivity — explicit input cost mentions
  const commodityRe = /\b(raw\s+material\s+(?:cost|prices?|inflation|volatility)|input\s+cost\s+pressure|commodity\s+(?:headwind|tailwind|cycle|prices?)|RM\s+pressure|crude\s+(?:price|impact)|metal\s+prices?\s+(?:rising|falling))/i;
  for (const s of sentences) {
    if (out.commoditySensitivityFlag) break;
    if (commodityRe.test(s)) {
      out.commoditySensitivityFlag = true;
      out.commoditySensitivityQuote = s.length > 240 ? s.slice(0, 237) + '…' : s;
    }
  }

  // Working capital stress — explicit WC stretch / receivables build
  const wcRe = /\b(working\s+capital\s+(?:stretch|deteriorat|elevat|increase|pressure|cycle\s+lengthening)|receivables?\s+(?:stretch|build|elevat|delay)|debtor\s+days\s+(?:rising|elevated|stretched)|inventory\s+build|stuck\s+inventory)/i;
  for (const s of sentences) {
    if (out.workingCapitalStressFlag) break;
    if (wcRe.test(s)) {
      out.workingCapitalStressFlag = true;
      out.workingCapitalStressQuote = s.length > 240 ? s.slice(0, 237) + '…' : s;
    }
  }

  return out;
}
