// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORMATION ANALYZER (zzz432 → zzz433 shared lib)
//
// Deterministic (no-LLM) multibagger-transformation radar. Extracted from the
// concall analyze route so it can be reused by the batch Transformation
// Screener without duplicating the pattern tables. Given raw concall / filing
// text it returns which transformation patterns fire, the strongest evidence
// tell on an 11-rung ladder, the inflection stage, velocity, and the
// industry/company/financial "triple". Pure string heuristics — same output
// for the same input, cheap enough to run over a whole feed.
// ═══════════════════════════════════════════════════════════════════════════

export const TRANSFORM_PATTERNS: Array<{ key: string; label: string; emoji: string; re: RegExp }> = [
  { key: 'margin',       label: 'Low → High Margin',        emoji: '🟢', re: /\b(premiumi[sz]|value[- ]added|value add|high[- ]end|higher reali[sz]ation|higher ASP|proprietary|specialit|special[iu]|richer mix)\b/gi },
  { key: 'cdmo',         label: 'Commodity → CDMO',          emoji: '🔵', re: /\b(CDMO|CRAMS|contract (?:manufactur|development)|custom synthesis|ODM|contract research)\b/gi },
  { key: 'debt',         label: 'Debt → Growth',             emoji: '🟠', re: /\b(deleverag|debt reduction|debt[- ]free|net cash|repaid|paid down|reduce.{0,12}debt|net debt.{0,12}(?:reduc|down|fell))\b/gi },
  { key: 'tech',         label: 'Traditional → Technology',  emoji: '🟣', re: /\b(semiconductor|electric vehicle|\bEV\b|defen[cs]e|aerospace|\bAI\b|artificial intelligence|data cent(?:re|er)|battery|power electronics|onboard charger|DC[- ]DC)\b/gi },
  { key: 'capacity',     label: 'Capacity Inflection',       emoji: '🟡', re: /\b(new (?:plant|capacity|line|facility)|commission(?:ed|ing)?|brownfield|greenfield|capacity (?:expansion|addition)|debottleneck)\b/gi },
  { key: 'customer',     label: 'Customer Inflection',       emoji: '🔴', re: /\b(qualif(?:y|ied|ication)|customer approval|approved by|design win|commercial order|first order|purchase order)\b/gi },
  { key: 'parent',       label: 'Parent Transformation',     emoji: '🟦', re: /\b(global parent|parent company|technology transfer|global sourcing|allocated to india|parent.{0,20}(?:increas|infus|stake))\b/gi },
  { key: 'acqui',        label: 'Acquisition Transformation',emoji: '🟩', re: /\b(acqui(?:re|sition|red)|amalgamation|inorganic|forward integration|purchase of business|slump sale)\b/gi },
  { key: 'mix',          label: 'Product-Mix Shift',         emoji: '🟪', re: /\b(product mix|mix (?:improv|shift)|shift(?:ing)? (?:towards|to) (?:premium|specialit|value)|richer product)\b/gi },
  { key: 'tam',          label: 'TAM Expansion',             emoji: '🟧', re: /\b(addressable market|\bTAM\b|new market|market expansion|enter(?:ed|ing)? (?:a )?new|new (?:segment|vertical|application))\b/gi },
  { key: 'export',       label: 'Export Inflection',         emoji: '🟨', re: /\b(export|US ?FDA|USFDA|EU (?:approval|GMP)|CE mark|global qualification|OEM approval|overseas|international market|Tier[- ]?1)\b/gi },
  { key: 'utilisation',  label: 'Utilisation Inflection',    emoji: '🟥', re: /\b(utili[sz]ation|ramp[- ]?up|operating leverage|capacity utili|asset turn)\b/gi },
  { key: 'recurring',    label: 'Recurring Revenue',         emoji: '🔷', re: /\b(recurring|multi[- ]year|annuity|repeat order|framework agreement|long[- ]term (?:contract|agreement|supply)|platform)\b/gi },
  { key: 'consolidation',label: 'Consolidation Winner',      emoji: '🔶', re: /\b(consolidat|market share (?:gain|win|increas)|fragmented|unorgani[sz]ed to organi[sz]ed|share gain)\b/gi },
  { key: 'perception',   label: 'Perception Transformation', emoji: '⚫', re: /\b(re[- ]?rat|structural (?:growth|compounder|story)|quality (?:growth|franchise)|transform(?:ation|ing)?|next leg)\b/gi },
];

export const EVENT_KEYWORDS = [
  'ACQUISITION', 'CAPACITY', 'COMMERCIAL PRODUCTION', 'QUALIFICATION', 'CUSTOMER APPROVAL', 'NEW PRODUCT',
  'PREMIUM', 'VALUE ADDED', 'PRODUCT MIX', 'EXPORT', 'TECHNOLOGY', 'PARTNERSHIP', 'JOINT VENTURE', 'CDMO',
  'CONTRACT MANUFACTURING', 'SEMICONDUCTOR', 'DEFENCE', 'AEROSPACE', 'EV', 'AI', 'DATA CENTRE', 'TRANSFORMER',
  'GRID', 'DEBT REDUCTION', 'CAPEX', 'ORDER BOOK', 'BATTERY', 'USFDA', 'PLI', 'OPERATING LEVERAGE',
  'UTILISATION', 'MARGIN EXPANSION', 'RECURRING', 'FORWARD INTEGRATION', 'DESIGN WIN', 'TAM',
  'GREENFIELD', 'BROWNFIELD', 'DELEVERAGING', 'FREE CASH FLOW',
];

// Story → Evidence strength (1 weakest … 11 strongest). Find the STRONGEST tell.
// NOTE (zzz460): regexes use word STEMS (improv\w*, expand\w*) rather than a
// strict trailing \b, because the old \b placement silently FAILED to match the
// commonest realised forms ("improved", "expanded", "improvement"). Loose
// matching is fine here because detectEvidence() gates every match by context
// (forward-looking / negation / quantifier) so only genuine REALISED proof
// promotes a company up the ladder — see detectEvidence below.
export const EVIDENCE_LADDER: Array<{ score: number; label: string; re: RegExp }> = [
  { score: 11, label: 'Second / third customer or product', re: /\b(second customer|third customer|multiple customers|additional customer|new customer\w*\s+(?:added|won|onboard\w*))\b/i },
  { score: 10, label: 'FCF / cash-flow improvement',        re: /\b(free cash flow|\bFCF\b|operating cash flow)\b/i },
  { score: 9,  label: 'Margin improvement realised',        re: /\bebitda margins?\b[^.]{0,25}?(?:expand\w*|expansion|improv\w*|widen\w*|higher|\bup\b)|\bmargins?\b[^.]{0,25}?(?:expand\w*|expansion|improv\w*|widen\w*|higher)|\b(?:expand\w*|improv\w*)\b[^.]{0,15}?margins?\b/i },
  { score: 8,  label: 'Revenue visible / contributing',     re: /\brevenue\w*\b[^.]{0,30}?(?:commenc\w*|contribut\w*|visible|kick(?:ed)?[- ]?in|of ₹|of rs)|\bfirst revenue\b/i },
  { score: 7,  label: 'Commercial production started',      re: /\b(commercial (?:production|supply|dispatch)|commenced (?:production|supply|dispatch)|commercialis\w*)\b/i },
  { score: 6,  label: 'Order received',                     re: /\b(received (?:an )?order|order\w*\s+(?:won|received|secured|bagged)|purchase order|design win|order (?:win|book\w*))\b/i },
  { score: 5,  label: 'Customer qualification',             re: /\b(qualif(?:y|ied|ication|ying)|customer approval|approved by|validat(?:ed|ion))\b/i },
  { score: 4,  label: 'Facility / equipment ready',         re: /\b(facility\w*\s+(?:ready|complet\w*|commission\w*)|plant\w*\s+(?:ready|complet\w*|commission\w*)|equipment installed|trial (?:run|production))\b/i },
  { score: 3,  label: 'Capex / partnership signed',         re: /\b(capex\w*\s+(?:approv\w*|announc\w*|commit\w*)|partnership\w*\s+(?:sign\w*|agreement)|\bMOU\b|memorandum of understanding|joint venture)\b/i },
  { score: 2,  label: 'Strategy / guidance announced',      re: /\b(guidance|we (?:expect|intend|plan|target|aim|endeavour)|strategy|roadmap|outlook)\b/i },
  { score: 1,  label: 'Opportunity talk only',              re: /\b(opportunity|we are exploring|evaluating|in discussion|potential|looking at)\b/i },
];

// ─── Context gates (zzz460) — make the ladder measure REALISED proof, not talk ─
// A ladder keyword found in a long transcript is meaningless on its own — almost
// every concall says "margin improvement" or "free cash flow" somewhere. These
// gates reject a match that is aspirational, negated, or (for the top realised
// rungs) not backed by a number or a past-tense realisation verb.
const FWD_LOOKING = /\b(expect|anticipat\w*|aim|aims|aiming|plan|plans|planning|target|intend\w*|hope|hoping|going to|going forward|scope for|guid\w*|will|would|could|should|shall|endeavour|aspir\w*|outlook|next (?:year|quarter|few)|coming (?:quarter|year)|over the (?:medium|long)|in (?:the )?future|likely to|poised to|set to|on track to|working towards)\b/i;
const NEGATION = /\b(not|no|never|without|weak\w*|declin\w*|fell|fall\w*|lower|drop\w*|down|contract(?:ed|ing)?|miss\w*|shortfall|pressure|headwind\w*|subdued|muted|degrow\w*)\b/i;
const QUANTIFIER = /(\d+(?:\.\d+)?\s?(?:%|bps|bn|mn|cr|crore|million|billion|lakh|x)\b|₹\s?\d|rs\.?\s?\d)/i;
const REALISED_VERB = /\b(expanded|improved|rose|grew|grown|increased|reached|delivered|reported|achieved|generated|turned|commenced|started|received|secured|won|added|onboarded|commissioned|ramped|clocked|posted|recorded|stood at|came in)\b/i;

// Rungs >= 3 (claims something is happening/done) must NOT be forward-looking or
// negated; rungs >= 8 (realised results) additionally require a number or a
// past-tense realisation verb nearby. Rungs 1-2 are inherently aspirational so
// stay ungated. Returns whether a specific match at `idx` genuinely counts.
function evidenceContextOk(text: string, idx: number, len: number, score: number): boolean {
  if (score >= 3) {
    const fwdWin = text.slice(Math.max(0, idx - 45), idx + len + 25);
    if (FWD_LOOKING.test(fwdWin)) return false;
    const negWin = text.slice(Math.max(0, idx - 28), idx + len + 28);
    if (NEGATION.test(negWin)) return false;
  }
  if (score >= 8) {
    const proofWin = text.slice(Math.max(0, idx - 55), idx + len + 55);
    if (!(QUANTIFIER.test(proofWin) || REALISED_VERB.test(proofWin))) return false;
  }
  return true;
}

// zzz462 — pull the exact sentence around a match so the card can QUOTE the
// real proof line (verifiability — the user can confirm it isn't a fluke).
function extractSentence(text: string, idx: number, len: number): string {
  // sentence START: last real sentence break before the match (a period/!/? that
  // is NOT a decimal point — i.e. followed by whitespace), floored at -160 chars.
  const pre = text.slice(Math.max(0, idx - 200), idx);
  const preBreak = pre.search(/[.!?]\s(?=[^]*$)/);   // first break in the window
  let start = idx - (pre.length - (preBreak >= 0 ? preBreak + 2 : 0));
  if (idx - start > 160 || start < 0) start = Math.max(0, idx - 160);
  // sentence END: next break AFTER the match that isn't a decimal (period+space).
  const rest = text.slice(idx + len, idx + len + 200);
  const endRel = rest.search(/[.!?](\s|$)/);
  const end = endRel >= 0 ? idx + len + endRel + 1 : Math.min(text.length, idx + len + 130);
  return text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 220);
}

// Walk the ladder high → low; a rung wins only when it has at least one match
// that survives the context gates. zzz462: scan ALL rungs (not just the peak) so
// we also return `breadth` = how many DISTINCT proof rungs fired — a genuinely
// proven transformation shows several (capex → facility → production → revenue →
// margin), so one lucky keyword no longer looks as strong as layered evidence.
export function detectEvidence(text: string): { score: number; label: string; quote: string; breadth: number } {
  let winner: { score: number; label: string; quote: string } | null = null;
  let breadth = 0;
  for (const e of EVIDENCE_LADDER) {
    const re = new RegExp(e.re.source, e.re.flags.includes('g') ? e.re.flags : e.re.flags + 'g');
    let m: RegExpExecArray | null;
    let guard = 0;
    let firedThisRung = false;
    while ((m = re.exec(text)) !== null && guard++ < 500) {
      if (evidenceContextOk(text, m.index, m[0].length, e.score)) {
        if (!winner) winner = { score: e.score, label: e.label, quote: extractSentence(text, m.index, m[0].length) };
        firedThisRung = true;
        break; // one valid match is enough to count this rung toward breadth
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    if (firedThisRung) breadth++;
  }
  if (!winner) return { score: 0, label: 'No transformation evidence detected', quote: '', breadth: 0 };
  return { ...winner, breadth };
}

export interface TransformationResult {
  patterns: Array<{ key: string; label: string; emoji: string; hits: number }>;
  events: Array<{ kw: string; hits: number }>;
  evidence_score: number;
  evidence_label: string;
  evidence_quote: string;      // zzz462 — the exact sentence that proves the top rung (verifiability)
  evidence_breadth: number;    // zzz462 — how many distinct proof rungs fired (depth of proof)
  stage: number;
  stage_sweet_spot: boolean;
  velocity: string;
  pattern_count: number;
  triple: { industry: boolean; company: boolean; financial: boolean; count: number };
}

export function analyzeTransformation(text: string): TransformationResult {
  const patterns = TRANSFORM_PATTERNS
    .map((p) => { p.re.lastIndex = 0; const hits = (text.match(p.re) || []).length; return { key: p.key, label: p.label, emoji: p.emoji, hits }; })
    .filter((p) => p.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const events = EVENT_KEYWORDS
    .map((kw) => {
      const re = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '\\b', 'gi');
      const hits = (text.match(re) || []).length;
      return { kw, hits };
    })
    .filter((e) => e.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 24);

  const evidence = detectEvidence(text);

  // Inflection ladder stage 0-10, derived from the strongest evidence tell.
  const stageMap: Record<number, number> = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9, 11: 10 };
  const stage = stageMap[evidence.score] ?? 0;

  const nPat = patterns.length;
  const velocity = nPat >= 4 ? 'Very fast' : nPat === 3 ? 'Fast' : nPat === 2 ? 'Medium' : nPat === 1 ? 'Slow' : '—';

  const industry = /\b(semiconductor|electric vehicle|\bEV\b|defen[cs]e|aerospace|\bAI\b|data cent|renewable|solar|\bPLI\b|export|USFDA|structural (?:growth|demand))\b/i.test(text);
  const company  = nPat >= 1;
  const financial = /\b((?:revenue|sales|EBITDA|PAT|profit|margin).{0,25}(?:grew|growth|up|increas|improv|expand|higher)|\+\d{2,}%)\b/i.test(text);
  const tripleCount = [industry, company, financial].filter(Boolean).length;

  const inSweetSpot = stage >= 3 && stage <= 7; // ladder stages 3-7 per the framework
  return {
    patterns, events,
    evidence_score: evidence.score, evidence_label: evidence.label,
    evidence_quote: evidence.quote, evidence_breadth: evidence.breadth,
    stage, stage_sweet_spot: inSweetSpot,
    velocity, pattern_count: nPat,
    triple: { industry, company, financial, count: tripleCount },
  };
}
