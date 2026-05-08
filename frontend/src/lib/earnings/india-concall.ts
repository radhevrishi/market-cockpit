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
    | 'customer_wins';
  quote: string;
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
  return false;
}

// Detect cover-letter / regulatory boilerplate sentences
function isBoilerplate(s: string): boolean {
  return /\b(National Stock Exchange|BSE Limited|Bandra Kurla Complex|P\.J\. Towers|Listing Department|Trading Symbol|Compliance Officer|Membership No\.|Pursuant to Regulation|Yours faithfully|Dear Sir|Subject\s*:|safe harbor|forward looking statements concerning|risks and uncertainties)\b/i.test(s);
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
const TOPIC_WORDS = /\b(margin|EBITDA|operating profit|operating leverage|capex|capital expenditure|EPS|earnings|revenue|sales|volume|pricing|mix|new launch|new product|innovation|premium|rural|urban|distribution|reach|coverage|ad spend|A&P|R&D|gross margin|capacity|utilisation|utilization|inventory|working capital|debtor|receivable|payable|order book|backlog|attrition|hiring|deal pipeline|win rate|ARR|deal TCV|net adds|GMV|AUM|NIM|GNPA|slippage|provision|credit cost|book value|ROE|ROCE)\b/gi;

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
  'Order Book': [/\b(order (book|inflow|backlog|intake)|book[- ]to[- ]bill)\b/i],
  'Order Inflow': [/\b(order (inflow|intake|booking|new order|wins)|fresh orders|won orders|deal wins?|secured orders)\b/i],
  'Order Book / Backlog': [/\b(order (book|backlog)|book[- ]to[- ]bill|backlog (of|stood))\b/i],
  'Execution / Revenue': [/\b(execution|revenue conversion|backlog (conversion|burn|drawdown)|delivered (orders|revenue))\b/i, /\b(commission(ed|ing)|delivered|despatch(ed|es))\b.{0,40}(plant|capacity|skid|unit|order)/i],
  'Capex Plan': [/\b(capex plan|capital expenditure|capacity (expansion|addition)|new plant|new facility|brownfield|greenfield|scale up to|expanded.{0,40}capacity)\b/i],
  'Capacity Utilization': [/\b(capacity utili[sz]ation|plant utili[sz]ation|production volume|capacity (of|stood at|increased to))\b/i],
  'Export Order Mix': [/\b(export (mix|order|share|revenue|geography|contribution)|domestic\s*[:.&]?\s*export|geographic(al)? (split|mix)|americas?|europe.{0,20}(asia|africa))\b/i],
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
};

// ── Main extractor ─────────────────────────────────────────────────────────
export function extractIndiaConcallInsights(
  rawText: string,
  sectorTemplate: IndiaSectorTemplate | null,
): ConcallInsights {
  const text = (rawText || '').trim();
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
  };
}
