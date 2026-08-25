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
export const EVIDENCE_LADDER: Array<{ score: number; label: string; re: RegExp }> = [
  { score: 11, label: 'Second / third customer or product', re: /\b(second customer|third customer|multiple customers|additional customer|new customer.{0,20}(?:added|won|onboard))\b/i },
  { score: 10, label: 'FCF / cash-flow improvement',        re: /\b(free cash flow|\bFCF\b|cash flow.{0,20}(?:improv|positive|generation))\b/i },
  { score: 9,  label: 'Margin improvement realised',        re: /\b(margin.{0,20}(?:improv|expand|expansion|up)|EBITDA margin.{0,15}(?:up|improv|expand))\b/i },
  { score: 8,  label: 'Revenue visible / contributing',     re: /\b(revenue.{0,20}(?:commenc|contribut|visible|of ₹|of Rs)|first revenue)\b/i },
  { score: 7,  label: 'Commercial production started',      re: /\b(commercial (?:production|supply|dispatch)|commenced (?:production|supply|dispatch)|commercialis)\b/i },
  { score: 6,  label: 'Order received',                     re: /\b(received (?:an )?order|order (?:won|received|secured|bagged)|purchase order|design win)\b/i },
  { score: 5,  label: 'Customer qualification',             re: /\b(qualif(?:y|ied|ication)|customer approval|approved by|validated)\b/i },
  { score: 4,  label: 'Facility / equipment ready',         re: /\b(facility (?:ready|complete|commission)|plant (?:ready|complete|commission)|equipment installed|trial (?:run|production))\b/i },
  { score: 3,  label: 'Capex / partnership signed',         re: /\b(capex.{0,15}(?:approv|announc|commit)|partnership (?:sign|agreement)|\bMOU\b|memorandum of understanding|joint venture)\b/i },
  { score: 2,  label: 'Strategy / guidance announced',      re: /\b(guidance|we (?:expect|intend|plan|target|aim|endeavour)|strategy|roadmap)\b/i },
  { score: 1,  label: 'Opportunity talk only',              re: /\b(opportunity|we are exploring|evaluating|in discussion|potential|looking at)\b/i },
];

export interface TransformationResult {
  patterns: Array<{ key: string; label: string; emoji: string; hits: number }>;
  events: Array<{ kw: string; hits: number }>;
  evidence_score: number;
  evidence_label: string;
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

  let evidence = { score: 0, label: 'No transformation evidence detected' };
  for (const e of EVIDENCE_LADDER) { if (e.re.test(text)) { evidence = { score: e.score, label: e.label }; break; } }

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
    stage, stage_sweet_spot: inSweetSpot,
    velocity, pattern_count: nPat,
    triple: { industry, company, financial, count: tripleCount },
  };
}
