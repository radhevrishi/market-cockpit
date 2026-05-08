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
  topic: 'operating_leverage' | 'capex' | 'margins' | 'eps' | 'launches' | 'demand' | 'guidance' | 'inflation' | 'pricing';
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

// ── Sentence splitter — preserves trailing punctuation ─────────────────────
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z\d])/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 320);
}

// ── Signal scorer — higher is more "informative" for an analyst ───────────
const NUMBER_RE = /\b\d+(?:\.\d+)?(?:\s*%|\s*bps|\s*bp|\s*x|\s*Cr|\s*crore|\s*Mn|\s*million|\s*billion|\s*Bn|\s*basis points)?\b/gi;
const STRONG_VERBS = /\b(grew|grow(ing|s)?|expand(ed|ing|s)?|increase[sd]?|rose|jumped|surged|accelerat(ed|ing|es)?|outperform(ed|ing|s)?|improved|enhanced|optimized|streamlined|delivered|achiev(ed|ing|es)?|beat|exceeded|raised|lowered|reduced|declined|contracted|fell|dropped|missed|impact(ed|ing|s)?|pressured|softened|moderated)\b/gi;
const FORWARD_WORDS = /\b(guidance|outlook|expect(s|ed|ing)?|forecast(ed|ing|s)?|target(ed|ing|s)?|plan(ned|ning|s)?|going forward|next quarter|next year|FY\s?\d{2,4}|H1|H2|Q[1-4])\b/gi;
const TOPIC_WORDS = /\b(margin|EBITDA|operating profit|operating leverage|capex|capital expenditure|EPS|earnings|revenue|sales|volume|pricing|mix|new launch|new product|innovation|premium|rural|urban|distribution|reach|coverage|ad spend|A&P|R&D|gross margin|capacity|utilisation|utilization|inventory|working capital|debtor|receivable|payable|order book|backlog|attrition|hiring|deal pipeline|win rate|ARR|deal TCV|net adds|GMV|AUM|NIM|GNPA|slippage|provision|credit cost|book value|ROE|ROCE)\b/gi;

function scoreSentence(s: string): number {
  let score = 0;
  const numbers = s.match(NUMBER_RE);
  if (numbers) score += Math.min(numbers.length, 5) * 6;
  const verbs = s.match(STRONG_VERBS);
  if (verbs) score += Math.min(verbs.length, 4) * 4;
  const fwd = s.match(FORWARD_WORDS);
  if (fwd) score += Math.min(fwd.length, 3) * 5;
  const topics = s.match(TOPIC_WORDS);
  if (topics) score += Math.min(topics.length, 4) * 3;
  // Slightly favor sentences with both a number AND a strong verb
  if (numbers && verbs) score += 4;
  // Penalize over-long boilerplate
  if (s.length > 240) score -= 3;
  // Penalize Q&A formalities
  if (/\b(thank you|good morning|good evening|operator|next question|next caller|moderator|management team|hello)\b/i.test(s)) score -= 5;
  return score;
}

// ── Tone phrase tables ─────────────────────────────────────────────────────
const POSITIVE_PHRASES: Array<[RegExp, string]> = [
  [/\bstrong (growth|momentum|demand|performance|traction|order\s?book|pipeline)\b/i, 'strong'],
  [/\b(record|all[- ]time high|highest\s+ever|best\s+quarter)\b/i, 'record'],
  [/\bmargin (expansion|expanded|expand)/i, 'margin expansion'],
  [/\boperating leverage\b/i, 'operating leverage'],
  [/\b(double|triple|multi)[- ]?digit growth\b/i, 'double-digit growth'],
  [/\b(robust|healthy|encouraging|positive|constructive) (demand|outlook|growth|trajectory|trend)\b/i, 'robust'],
  [/\baccelerat(ed|ing) growth\b/i, 'accelerating'],
  [/\bcapacity expansion|capex.*(approved|sanctioned|on track)/i, 'capex on track'],
  [/\bnew (product|launch|customer wins?|geographies)\b/i, 'new launches'],
  [/\b(green ?shoots|recovery|rebound|turnaround)\b/i, 'recovery'],
  [/\b(market share|share gains?)\b/i, 'market share gains'],
  [/\bbeat (consensus|expectations|estimates)\b/i, 'beat consensus'],
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
  { topic: 'capex', re: /[^.!?]*\b(capex|capital expenditure|capacity (expansion|addition)|new plant|new facility|brownfield|greenfield)\b[^.!?]*[.!?]/i },
  { topic: 'margins', re: /[^.!?]*\b(gross margin|EBITDA margin|operating margin|margin (expansion|compression|trajectory|outlook))\b[^.!?]*[.!?]/i },
  { topic: 'eps', re: /[^.!?]*\b(EPS|earnings per share|profit (before|after) tax|PAT (grew|declined|growth))\b[^.!?]*[.!?]/i },
  { topic: 'launches', re: /[^.!?]*\b(new (product|launch|SKU|variant|innovation)|recently launched|launching|introduce[ds]?)\b[^.!?]*[.!?]/i },
  { topic: 'demand', re: /[^.!?]*\b(demand (environment|trend|outlook)|consumer (sentiment|spending)|order (book|inflow))\b[^.!?]*[.!?]/i },
  { topic: 'guidance', re: /[^.!?]*\b(guidance|outlook for|expect.{0,40}(year|FY|H[12]|Q[1-4]))\b[^.!?]*[.!?]/i },
  { topic: 'inflation', re: /[^.!?]*\b(input cost|raw material|commodity|inflation|deflation|palm oil|crude|copper|aluminium|steel)\b[^.!?]*[.!?]/i },
  { topic: 'pricing', re: /[^.!?]*\b(price (hike|increase|cut)|pricing power|pricing strategy|pass(ed|ing)? (on|through))\b[^.!?]*[.!?]/i },
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
  // Auto / Industrials
  'Order Book': [/\b(order (book|inflow|backlog)|book[- ]to[- ]bill)\b/i],
  'Capex Plan': [/\b(capex plan|capital expenditure|capacity (expansion|addition)|new plant)\b/i],
  'Capacity Utilization': [/\b(capacity utili[sz]ation|plant utili[sz]ation|production volume)\b/i],
  // Real estate
  'Pre-sales / Bookings': [/\b(pre[- ]?sales|booking value|sales velocity|launches)\b/i],
  'Collections': [/\b(collection (efficiency|run[- ]?rate)|cash flow from operations)\b/i],
  // Energy / Utilities
  'PLF / Capacity Factor': [/\bPLF\b|\bcapacity factor\b|\bload factor\b/i],
  'Tariff': [/\btariff\b|\bpower purchase\b|\bPPA\b/i],
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

  const sentences = splitSentences(text);

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

  // 3. Topic mentions — best (longest informative) sentence per topic.
  const keyMentions: ConcallKeyMention[] = [];
  for (const { topic, re } of TOPIC_PATTERNS) {
    const m = text.match(re);
    if (m && m[0]) {
      const quote = m[0].trim().replace(/\s+/g, ' ');
      if (quote.length >= 25 && quote.length <= 320) {
        keyMentions.push({ topic, quote });
      }
    }
  }

  // 4. Sector KPI hits.
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
      if (evidence) {
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
