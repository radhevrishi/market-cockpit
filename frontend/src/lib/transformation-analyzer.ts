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
  // zzz473 — POLARITY: the FCF rung used to fire on the mere presence of "free
  // cash flow", so KITEX's "combined free cash flow was NEGATIVE at INR4,101mn …
  // due to ongoing capex" (cash BURN) graded as a 10/11 cash-generation proof.
  // Now it requires a POSITIVE frame — "positive/strong/healthy FCF", or FCF
  // followed by generated / improved / turned positive / of ₹…. Negative-FCF
  // sentences no longer match (and 'negative' is now a NEGATION word below).
  { score: 10, label: 'FCF / cash-flow improvement',        re: /\b(?:positive|strong|healthy|robust|higher|improved)\s+(?:free\s+cash\s+flow|\bFCF\b|operating\s+cash\s+flow)\b|\b(?:free\s+cash\s+flow|\bFCF\b|operating\s+cash\s+flow|cash\s+flow\s+from\s+operations)\b[^.]{0,34}?(?:positive|generat\w*|improv\w*|turned\s+positive|strong|robust|of\s+(?:₹|rs\.?|inr)\s?\d)/i },
  { score: 9,  label: 'Margin improvement realised',        re: /\bebitda margins?\b[^.]{0,25}?(?:expand\w*|expansion|improv\w*|widen\w*|higher|\bup\b)|\bmargins?\b[^.]{0,25}?(?:expand\w*|expansion|improv\w*|widen\w*|higher)|\b(?:expand\w*|improv\w*)\b[^.]{0,15}?margins?\b/i },
  { score: 8,  label: 'Revenue visible / contributing',     re: /\brevenue\w*\b[^.]{0,30}?(?:commenc\w*|contribut\w*|visible|kick(?:ed)?[- ]?in|of ₹|of rs)|\bfirst revenue\b/i },
  // zzz470 — the bare noun "commercialisation/commercialise" is almost always
  // forward/capability talk ("enable the commercialisation", "before
  // commercialisation begins"), NOT a realised milestone — so it no longer
  // matches. Only the realised PHRASE ("commercial production/supply") or a
  // past-tense "commercialised" counts; still context-gated below.
  { score: 7,  label: 'Commercial production started',      re: /\bcommercial (?:production|supply|dispatch|launch)\b|\b(?:commenc\w*|began|begun|started|initiated|ramp(?:ed|ing)? up)\s+(?:commercial\s+)?(?:production|supply|dispatch|manufacturing)\b|\bcommerciali[sz]ed\b/i },
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
// zzz465 — strengthened after live spot-check found forward-looking leaks: bare
// "future", "targeting", "expected to", "under commissioning", "by <year/month>",
// "yet to", "to be", "upcoming/planned/pipeline", "once operational" all now count
// as aspiration so they cannot promote a realised rung (e.g. "future
// commercialization" no longer reads as "commercial production started").
const FWD_LOOKING = /\b(expect\w*|anticipat\w*|aim|aims|aiming|plan|plans|planning|target\w*|intend\w*|hope|hoping|going to|going forward|scope for|guid\w*|will|would|could|should|shall|endeavour|aspir\w*|outlook|next (?:year|quarter|few)|coming (?:quarter|year|month)|over the (?:medium|long)|future|likely to|poised to|set to|on track to|working towards|to be\b|yet to|upcoming|planned|pipeline|under (?:commission\w*|construction|implementation|development)|once (?:commission\w*|operational|complet\w*)|by (?:\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|by (?:end|q[1-4])|to (?:replace|substitute|cater)|designed to|aimed at|in order to|with (?:the aim|a view to)|intended to|would (?:help|enable|allow)|enabl(?:e|es|ing)\b|ability to|potential to|positions? (?:us|the company|it)\b)\b/i;

// zzz470 — CAPABILITY / scope talk: a description of what the company CAN do
// ("one-stop-shop capability that covers everything from discovery to commercial
// production", "end-to-end capabilities", "we offer / our platform") is not proof
// a milestone was hit. Checked in a WIDER window for the realised rungs (score>=6)
// because the capability noun often sits a clause away from the milestone word.
const CAPABILITY_TALK = /\b(capabilit\w*|one[- ]stop[- ]shop|end[- ]to[- ]end|covers everything|full[- ]service|suite of|range of (?:services|solutions|offerings|capabilit\w*)|we (?:offer|provide)|our (?:offering|platform|solution|portfolio)s?|positioned as|serve as a)\b/i;
// zzz475 — a NUMERIC TARGET / guidance band sitting next to a margin/revenue word
// is aspiration, not a realised result (BALAMINES: "EBITDA margin targeted at
// 22-23% in FY27 vs ~20% in FY26"). Stronger than the general FWD list — catches
// the specific "targeted at / guidance of / aiming for / exit margin" phrasings.
const TARGET_GUIDANCE = /\btarget\w*|guidance\s+(?:of|at|for|band|range)|aiming\s+(?:for|at|to)|aspir\w*|expect\w*\s+to\s+(?:reach|achieve|touch|be)|to\s+(?:reach|achieve|touch)\s+~?\d|glide\s?path|exit\s+(?:rate|margin|velocity)|steady[- ]state|over\s+the\s+next\s+\d/i;
// zzz475 — a methodology FOOTNOTE ("Note: Calculated as (Interest Expense …
// divided by …)") is a definition, not a proof (CGCL surfaced one as a 9/11
// margin). Reject any realised rung whose sentence is a calc note.
const FOOTNOTE_METHOD = /\bnote\s*:\s|calculated as|computed as|defined as|is defined|divided by\b|\bformula\b|methodology|refer to (?:note|slide|page)/i;
const NEGATION = /\b(not|no|never|without|weak\w*|declin\w*|fell|fall\w*|lower|drop\w*|down|contract(?:ed|ing)?|miss\w*|shortfall|pressure|headwind\w*|subdued|muted|degrow\w*|negative|outflow|cash burn|erod\w*)\b/i;
// zzz473 — FIX: the old `(?:%|bps|…)\b` put a word-boundary AFTER the unit, so
// "12.5%," / "300bps." / "14%)" (a percent followed by punctuation or end) did
// NOT match — silently starving the score>=8 proof gate and dropping genuine
// margin/FCF/revenue proofs. Percent needs no trailing \b; only the alpha units do.
const QUANTIFIER = /(\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s?(?:bps|bn|mn|cr|crore|million|billion|lakh|x)\b|₹\s?\d|rs\.?\s?\d)/i;
const REALISED_VERB = /\b(expanded|improved|rose|grew|grown|increased|reached|delivered|reported|achieved|generated|turned|commenced|started|received|secured|won|added|onboarded|commissioned|ramped|clocked|posted|recorded|stood at|came in)\b/i;

// Rungs >= 3 (claims something is happening/done) must NOT be forward-looking or
// negated; rungs >= 8 (realised results) additionally require a number or a
// past-tense realisation verb nearby. Rungs 1-2 are inherently aspirational so
// stay ungated. Returns whether a specific match at `idx` genuinely counts.
function evidenceContextOk(text: string, idx: number, len: number, score: number): boolean {
  // zzz470 — SENTENCE-CLAMP: find the bounds of the sentence the match sits in, so
  // an aspiration/negation in a NEIGHBOURING sentence can't bleed across a full
  // stop and wrongly reject (or accept) this proof. Fixes "…commercialise next
  // year. EBITDA margin expanded 300bps…" where "next year" was killing the margin
  // proof one sentence over. Proximity windows below are intersected with these.
  const back = text.slice(Math.max(0, idx - 260), idx);
  let sentStart = Math.max(0, idx - 260);
  const brRe = /[.!?]\s/g; let bm: RegExpExecArray | null; let lastBr = -1;
  while ((bm = brRe.exec(back)) !== null) lastBr = bm.index + bm[0].length;
  if (lastBr >= 0) sentStart = Math.max(0, idx - 260) + lastBr;
  const fwdRest = text.slice(idx + len, idx + len + 260);
  const endRel = fwdRest.search(/[.!?](\s|$)/);
  const sentEnd = endRel >= 0 ? idx + len + endRel + 1 : Math.min(text.length, idx + len + 260);
  const win = (a: number, b: number) => text.slice(Math.max(sentStart, a), Math.min(sentEnd, b));

  if (score >= 3) {
    if (FWD_LOOKING.test(win(idx - 45, idx + len + 25))) return false;
    if (NEGATION.test(win(idx - 28, idx + len + 28))) return false;
  }
  if (score >= 6) {
    // realised milestone rungs (order / production / revenue / margin) must not sit
    // inside a CAPABILITY description ("one-stop-shop capability that covers …
    // commercial production"). Wider window — capability noun is often a clause away.
    if (CAPABILITY_TALK.test(win(idx - 80, idx + len + 40))) return false;
    // zzz475b — nor anywhere in the SAME sentence as a numeric TARGET/guidance band
    // (aspiration, not result) or a methodology footnote (a definition, not a proof).
    // Checked over the full clamped sentence (win bounds it) because slide/table text
    // has no full stops, so the disqualifier can sit a whole caption away from the
    // keyword — CGCL "…RoE expansion Capri Global's target is to deliver RoAE 19-21%".
    if (TARGET_GUIDANCE.test(win(idx - 400, idx + len + 400))) return false;
    if (FOOTNOTE_METHOD.test(win(idx - 400, idx + len + 400))) return false;
  }
  if (score >= 8) {
    const proofWin = win(idx - 55, idx + len + 55);
    if (!(QUANTIFIER.test(proofWin) || REALISED_VERB.test(proofWin))) return false;
  }
  if (score === 9) {
    // zzz473 — the margin rung must measure OPERATING margin, not "other income as
    // % of revenue". AEQUS graded "other income increased … (1% margin) → (4%
    // margin) … margin improvement of 300bps" as a 9/11 operating-margin proof —
    // it's non-operating (treasury/forex/interest) income, not the core business
    // improving. Reject when the sentence is about other/non-operating income and
    // carries no real operating-margin qualifier (operating / EBITDA / gross / PAT).
    const s = win(idx - 400, idx + len + 250);   // the FULL sentence (win clamps to it)
    if (/\bother income\b|\bnon[- ]operating\b|\btreasury income\b|\bforex gain\b/i.test(s)
        && !/\b(?:operating|ebitda|gross|contribution|pat|net\s*profit)\s*margin/i.test(s)) return false;
  }
  return true;
}

// zzz462/zzz465 — pull the exact sentence around a match so the card can QUOTE
// the real proof line (verifiability). Starts at a WORD boundary (never mid-word
// like "rehensive…"), ends at a real sentence break (not a decimal), and rejects
// PDF table/chart dumps that are mostly numbers — better to show no quote than junk.
function extractSentence(text: string, idx: number, len: number): string {
  // sentence START: prefer the last real break (period/!/? + space) within 200
  // chars; else fall back ~130 chars but snap FORWARD to the next word boundary.
  const pre = text.slice(Math.max(0, idx - 200), idx);
  // zzz467 — use the NEAREST (last) sentence break before the match, not the
  // first, so the quote is just the sentence containing the proof (was pulling
  // in a preceding sentence, e.g. STEELCAST's power-plant clause before "order book").
  let lastBreak = -1; const brRe = /[.!?]\s/g; let bm: RegExpExecArray | null;
  while ((bm = brRe.exec(pre)) !== null) lastBreak = bm.index + bm[0].length;
  let start: number;
  if (lastBreak >= 0) {
    start = Math.max(0, idx - 200) + lastBreak;       // right after the nearest break
  } else {
    start = Math.max(0, idx - 130);
    const sp = text.indexOf(' ', start);
    if (sp >= 0 && sp < idx) start = sp + 1;          // don't begin mid-word
  }
  // sentence END: next break AFTER the match that isn't a decimal (period+space).
  const rest = text.slice(idx + len, idx + len + 200);
  const endRel = rest.search(/[.!?](\s|$)/);
  const end = endRel >= 0 ? idx + len + endRel + 1 : Math.min(text.length, idx + len + 130);
  let q = text.slice(start, end).replace(/\s+/g, ' ').trim();
  // zzz469 — strip a LEADING run of chart/table numbers (a sentence that begins
  // inside a bar-chart row, e.g. "1074 1290 1428 … Foray into fluorospecialties").
  // Drop leading tokens until we reach a real word, so the quote starts at prose.
  q = q.replace(/^(?:[₹$]?\d[\d.,%+\-]*\s+|[+\-]?\d[\d.,%]*\s+){2,}/, '').trim();
  const words = q.split(/\s+/).filter(Boolean);
  const alphaWords = words.filter((w) => /[a-zA-Z]{3,}/.test(w));
  const digitTokens = words.filter((w) => /^\W*[\d₹$]/.test(w));
  if (alphaWords.length < 5) return '';                                       // not a real sentence
  if (words.length > 0 && digitTokens.length / words.length > 0.40) return ''; // number-table dump (tightened 0.45→0.40)
  // zzz470 — reject metric/chart TABLE dumps that are grammatically empty: a real
  // sentence has lowercase connective/prose words (the, to, of, with, increased,
  // by, our…), a bar-chart row is ALL-CAPS labels + numbers ("EBITDA per Tonne
  // 8784.7 Cr 2.9% CPLY 151 bps"). Require ≥3 lowercase prose words (≥3 letters).
  const proseWords = words.filter((w) => /^[a-z][a-z']{2,}$/.test(w));
  if (proseWords.length < 3) return '';
  // zzz475 — reject a spec / model-code LIST (AEQUS: "Long range A330, A350, B767,
  // B777, B787 Single aisle A220, A320, B737 …") — 3+ part/model codes = a table
  // of SKUs, not a proof sentence. Codes are letter(s)+digits so the digit-ratio
  // check misses them.
  const modelCodes = words.filter((w) =>
    /^[A-Za-z]{1,3}[- ]?\d{2,4}[A-Za-z]?[,.;]?$/.test(w)      // letter(s)+digits, e.g. A330 / B737
    && !/^(?:FY|Q[1-4]|H[12]|CY|FQ|Rs)/i.test(w)             // but NOT FY26 / Q1 / H2 / CY24 / Rs500
    && !/^(?:19|20)\d\d[,.;]?$/.test(w));                     // nor a bare calendar year 2024
  if (modelCodes.length >= 3) return '';
  // zzz475b — reject a CHART CAPTION where a label is echoed down the bars/columns
  // (GALLANTT: "…10.8% … 2.9% CPLY 151 bps CPLY … 17.6% … 102 bps CPLY … CPLY …" —
  // "CPLY" 5×). A real sentence doesn't repeat a token 4+ times; a chart axis does.
  const freq: Record<string, number> = {};
  for (const w of words) { const k = w.toLowerCase().replace(/[^a-z0-9]/g, ''); if (k.length >= 3) freq[k] = (freq[k] || 0) + 1; }
  if (Object.values(freq).some((n) => n >= 4)) return '';
  return q.slice(0, 220);
}

// ─── zzz467 — CAUTION / guidance-cut detector ──────────────────────────────
// The evidence ladder only hunts POSITIVE keywords, so a concall that cut
// guidance or turned cautious could still read as a BUY off one upbeat line
// (e.g. Sharda Cropchem: volume slipped, PAT fell, margin contracted, forex hit —
// yet graded ACCUMULATE). This reads the whole document for real negatives and
// returns a level (0 none / 1 mixed / 2 cautious) used to haircut the verdict.
// Calibrated conservatively — one stray "challenging" won't trip it; it needs a
// genuine guidance cut, or several independent negatives (as a real analyst reads).
export function detectCaution(text: string): { level: number; flags: string[] } {
  const flags: string[] = [];
  // explicit guidance CUT (strong) — but not "maintained / reaffirmed / raised / no reduction"
  const guidanceCut = /\b(reduc\w*|lower\w*|cut|trimm\w*|slash\w*|downgrad\w*|revis\w*\s+(?:down\w*|lower))\b[^.]{0,30}?\b(guidance|outlook|forecast|estimate\w*|target\w*)\b|\b(guidance|outlook|forecast)\b[^.]{0,30}?\b(reduc\w*|lower\w*|cut|trimm\w*|downward|revis\w*\s+down\w*)\b/i;
  const guidanceHeld = /\b(maintain\w*|reaffirm\w*|reiterat\w*|retain\w*|raised|rais\w*|increas\w*|upgrad\w*|no reduction|no change|unchanged|intact)\b[^.]{0,25}?\b(guidance|outlook|forecast)\b|\b(guidance|outlook|forecast)\b[^.]{0,25}?\b(maintain\w*|reaffirm\w*|reiterat\w*|unchanged|intact|raised)\b/i;
  let strong = 0;
  if (guidanceCut.test(text) && !guidanceHeld.test(text)) { strong++; flags.push('guidance reduced'); }
  // zzz469 — broadened so real cautious quarters (like Sharda Cropchem, where the
  // words were phrased loosely) are actually caught: each financial noun now
  // accepts a much wider set of decline/pressure words (lower, down, hit,
  // impacted, muted, under pressure, compressed, YoY decline …).
  const NEGV = '(fell|fall|declin\\w*|drop\\w*|de-?grew|de-?growth|lower|down\\b|hit|impacted?|erod\\w*|muted|compress\\w*|contract\\w*|shrunk|shrank|soft\\w*|slip\\w*|under pressure|pressure|weak\\w*)';
  // HARD = a real financial decline (one alone tempers the read a notch).
  const hardNeg: Array<[RegExp, string]> = [
    [new RegExp(`\\b(?:pat|net profit|profit(?:ability)?|earnings|bottom[- ]?line)\\b[^.]{0,28}?\\b${NEGV}`, 'i'), 'profit down'],
    [new RegExp(`\\bmargin\\w*\\b[^.]{0,28}?\\b${NEGV}`, 'i'), 'margin down'],
    [new RegExp(`\\bvolume\\w*\\b[^.]{0,28}?\\b${NEGV}`, 'i'), 'volume down'],
    [new RegExp(`\\b(?:revenue\\w*|top[- ]?line|sales)\\b[^.]{0,24}?\\b(declin\\w*|fell|drop\\w*|de-?grew|de-?growth|lower|down\\b)\\b`, 'i'), 'revenue down'],
    [new RegExp(`\\brealisation\\w*\\b[^.]{0,22}?\\b${NEGV}|\\b(pricing|price)\\s+pressure\\b|\\bprice\\w*\\b[^.]{0,18}?\\b(declin\\w*|fell|lower|drop\\w*|under pressure)\\b`, 'i'), 'pricing pressure'],
    [/\bde-?growth\b|\bnegative growth\b/i, 'de-growth'],
    [/\b(forex|foreign exchange|currency|fx)\b[^.]{0,18}?\b(loss|hit|impact\w*|headwind|drag|adverse|volatil\w*)\b/i, 'forex drag'],
    [/\b(one-?off|exceptional)\b[^.]{0,15}?\b(loss|item|charge|provision|impair\w*)\b|\bwrite[- ]?off\b|\bimpairment\b/i, 'one-off / provision'],
  ];
  // SOFT = tone/hedge words (need two before they count, so one boilerplate line is harmless).
  const softNeg: Array<[RegExp, string]> = [
    [/\bremain\w*\s+cautious\b|\b(cautious|caution)\b[^.]{0,25}?\b(outlook|stance|approach|commentary|guidance|demand|near[- ]term|environment|on the)\b/i, 'cautious tone'],
    [/\b(weak|soft|muted|subdued|sluggish|tepid)\s+demand\b|\bdemand\b[^.]{0,18}?\b(weak\w*|soft\w*|muted|subdued|sluggish|slow\w*)\b/i, 'weak demand'],
    [/\b(challenging|difficult|tough|adverse|subdued)\s+(?:demand|environment|conditions|macro|market|quarter|year|backdrop|outlook|scenario)\b/i, 'challenging environment'],
    [/\b(slowdown|slow[- ]?down|deceleration|moderation)\b[^.]{0,18}?\b(demand|growth|volume|revenue|sales|market)\b/i, 'slowdown'],
  ];
  let hard = 0, soft = 0;
  for (const [re, label] of hardNeg) { if (re.test(text)) { hard++; flags.push(label); } }
  for (const [re, label] of softNeg) { if (re.test(text)) { soft++; flags.push(label); } }
  // HIGH (2 → AVOID / removed): guidance cut, OR 2+ hard negatives, OR hard+2soft.
  // MIXED (1 → down a tier): 1 hard negative, OR 2+ soft. One lone hedge = 0.
  const level = strong >= 1 || hard >= 2 || (hard >= 1 && soft >= 2) ? 2 : (hard >= 1 || soft >= 2) ? 1 : 0;
  return { level, flags: flags.slice(0, 5) };
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
    let bestQuote = '';          // zzz470 — keep scanning this rung for a match that
    let sawValid = false;        //   yields a CLEAN sentence, not the first table-dump.
    while ((m = re.exec(text)) !== null && guard++ < 500) {
      if (evidenceContextOk(text, m.index, m[0].length, e.score)) {
        sawValid = true;
        if (!bestQuote) bestQuote = extractSentence(text, m.index, m[0].length);
        if (bestQuote) break;    // got a verifiable quote — good enough for this rung
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    if (sawValid) {
      firedThisRung = true;
      if (!winner) winner = { score: e.score, label: e.label, quote: bestQuote };
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
  caution_level: number;       // zzz467 — 0 none / 1 mixed / 2 cautious (guidance cut / negatives)
  caution_flags: string[];     // zzz467 — the specific negatives found (e.g. 'margin contracted')
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
  const caution = detectCaution(text);   // zzz467 — reads the cautious/negative tone

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
    caution_level: caution.level, caution_flags: caution.flags,
    stage, stage_sweet_spot: inSweetSpot,
    velocity, pattern_count: nPat,
    triple: { industry, company, financial, count: tripleCount },
  };
}
