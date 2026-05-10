// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL STATE CLASSIFIER — patch 0059 (originally drafted as 0053)
//
// The previous design compressed every infrastructure-related article into
// the BOTTLENECK bucket. That conflates two opposite states:
//   "HBM sold out" (constraint)
//   "TSMC adding CoWoS" (capacity expansion / supply response)
// These have OPPOSITE market implications.
//
// This module classifies articles into one of seven structural states so
// the feed can group / color / filter by state. BOTTLENECK becomes one
// state among many, not the meta-bucket.
// ═══════════════════════════════════════════════════════════════════════════

export type StructuralState =
  | 'BOTTLENECK'           // active constraint: shortage, tight, sold out, lead time
  | 'CAPACITY_EXPANSION'   // capacity ramp / new fab / commissioning / online
  | 'CAPEX_BUILDOUT'       // EPC contract / tender awarded / construction start
  | 'SUPPLY_RESPONSE'      // capacity catching up / easing / resolution
  | 'DEMAND_SURGE'         // orders rising / book-to-bill up / demand outstripping
  | 'POLICY_SUPPORT'       // PLI / FDI / mandate / subsidy / regulatory
  | 'NONE';

interface StatePattern {
  state: StructuralState;
  pattern: RegExp;
  weight: number;
}

// PATCH 0059: Pattern that catches resolved/easing language. When this
// fires, BOTTLENECK is suppressed even if "shortage" appears — because
// "shortage resolved" is the OPPOSITE of an active bottleneck.
// PATCH 0059: Note the trailing \w* in each alternative — handles
// 'resolved' (resolv + ed), 'eased' (eas + ed), 'easing' (eas + ing) etc.
// without listing every inflection.
const RESOLVED_OVERRIDE_RE = /\b(shortage (?:resolv\w*|end\w*|eas\w*|over)|crisis (?:resolv\w*|end\w*|eas\w*)|crunch (?:resolv\w*|end\w*|eas\w*)|supply (?:recover\w*|normal\w*|abundant|restored|easing)|backlog (?:clear\w*|reduc\w*|working through)|lead time (?:shorten\w*|normalis\w*|normaliz\w*)|allocation (?:eased|easing|loose))\b/i;

const STATE_PATTERNS: StatePattern[] = [
  // BOTTLENECK — active constraint
  // NOTE: "shortage" alone fires BOTTLENECK BUT the RESOLVED_OVERRIDE_RE
  // above is checked first to suppress BOTTLENECK on resolved/easing text.
  { state: 'BOTTLENECK', pattern: /\b(shortage|sold out|stock(?:ed)?[- ]?out|capacity hit zero|fully allocated|allocation tight|tight (?:supply|allocation)|undersupply|capacity (?:constraint|crunch|squeeze)|supply (?:gap|crisis|crunch|squeeze)|backlog of \d+|lead time \d+\s*(?:weeks?|months?)|oversubscribed|cannot meet demand|unable to (?:meet|fulfill)|production (?:halt|cut|suspended)|line shut)\b/i, weight: 9 },

  // SUPPLY_RESPONSE — easing / catching up / resolved
  // PATCH 0059: \w* suffix on each verb so 'resolved', 'easing', 'shortened',
  // 'normalising' all match without listing every inflection explicitly.
  { state: 'SUPPLY_RESPONSE', pattern: /\b(supply (?:recover\w*|normal\w*|abundant|restored|eas\w*)|shortage (?:resolv\w*|end\w*|eas\w*|over)|crisis (?:resolv\w*|end\w*)|capacity (?:caught up|matched|catching up)|backlog (?:clear\w*|reduc\w*|working through)|lead time (?:shorten\w*|improv\w*|shrink\w*|normalis\w*|normaliz\w*)|prices? (?:drop|decline|fall|ease|soften).{0,40}(?:dram|nand|hbm|chip|memory|wafer|transformer)|inventory (?:rebuild|destock|correction)|capacity adequate|adequate stock)\b/i, weight: 8 },

  // CAPACITY_EXPANSION — adding new capacity
  { state: 'CAPACITY_EXPANSION', pattern: /\b(capacity (?:expansion|addition|increase|ramp|step.?up|build)|new fab|fab (?:construction|coming online)|gigafactory|broke ground|commissioned|achieves criticality|first wafer|production (?:ramp|start|line online)|operational|goes (?:online|live)|new (?:line|factory|plant) (?:online|opens?)|expansion announced)\b/i, weight: 7 },

  // CAPEX_BUILDOUT — contract awards, construction, EPC tenders
  // PATCH 0059: order match relaxed — between Rs/$ amount and the noun
  // 'order', allow up to 4 product/service words ("Rs 1200 cr power
  // transmission order"). Word count cap prevents drift.
  { state: 'CAPEX_BUILDOUT', pattern: /\b(epc (?:contract|award|order)|contract (?:awarded|won)|order worth (?:rs|inr|\$|₹)|tender (?:awarded|won|open)|nhai (?:award|tender|contract)|hybrid annuity|hsm award|highway (?:project awarded|contract awarded)|(?:rs|inr|₹|\$)\s*\d[\d,]*\s*(?:cr|crore|lakh\s*crore|billion|million|bn)(?:\s+\w+){0,4}\s+(?:order|capex|investment|deal|contract|tender)|wins (?:rs|inr|₹|\$)\s*\d[\d,]*\s*(?:cr|crore)|capex (?:announce|step.?up|raise|increase|guide|of)|broke ground|construction (?:start|underway))\b/i, weight: 7 },

  // DEMAND_SURGE — orders rising / demand outstripping
  { state: 'DEMAND_SURGE', pattern: /\b(demand (?:outstrip|outpace|exceed|overwhelm|spike|surge|jump|rising fast)|orders? (?:rising|surge|spike|jump|inflect)|book.?to.?bill (?:up|rising|expand)|order (?:pipeline|intake|book)\s+(?:rising|expand|grow)|backlog (?:rising|growing|expand)|sold[- ]?out demand|customer queue|wait list|allocation lottery|preorder demand)\b/i, weight: 6 },

  // POLICY_SUPPORT — PLI / FDI / mandate / subsidy
  { state: 'POLICY_SUPPORT', pattern: /\b(pli (?:scheme|disburs|approved|allocated|released)|production[- ]linked incentive|fame[- ]?ii|fame[- ]?iii|ev mandate|fdi (?:cap|policy|raised)|subsidy (?:announce|allocate|extend|raise)|tax holiday|policy (?:approved|announced|raised|reform)|green hydrogen mission|semiconductor mission|atmanirbhar|make in india)\b/i, weight: 6 },
];

export function classifyStructuralState(args: { title: string; desc: string }): { state: StructuralState; confidence: number } {
  const { title, desc } = args;
  const text = (title + ' ' + (desc || '')).toLowerCase();

  // PATCH 0059: if the article describes a RESOLVED / EASING situation,
  // suppress the BOTTLENECK match — even though "shortage" appears, the
  // surrounding context is "shortage resolved" → SUPPLY_RESPONSE wins.
  const isResolved = RESOLVED_OVERRIDE_RE.test(text);

  let best: { state: StructuralState; weight: number } = { state: 'NONE', weight: 0 };
  for (const sp of STATE_PATTERNS) {
    if (isResolved && sp.state === 'BOTTLENECK') continue;  // skip BOTTLENECK
    const titleHit = sp.pattern.test(title);
    const fullHit = !titleHit && sp.pattern.test(text);
    if (!titleHit && !fullHit) continue;
    const w = sp.weight * (titleHit ? 2 : 1);
    if (w > best.weight) best = { state: sp.state, weight: w };
  }

  return {
    state: best.state,
    confidence: Math.min(100, Math.round(best.weight * 6)),
  };
}

// ─── Display labels ────────────────────────────────────────────────────────

export const STATE_DISPLAY: Record<StructuralState, string> = {
  BOTTLENECK:         'Bottleneck',
  CAPACITY_EXPANSION: 'Capacity expansion',
  CAPEX_BUILDOUT:     'Capex buildout',
  SUPPLY_RESPONSE:    'Supply response',
  DEMAND_SURGE:       'Demand surge',
  POLICY_SUPPORT:     'Policy support',
  NONE:               '—',
};

export const STATE_ICON: Record<StructuralState, string> = {
  BOTTLENECK:         '🚧',
  CAPACITY_EXPANSION: '🏗',
  CAPEX_BUILDOUT:     '💰',
  SUPPLY_RESPONSE:    '📈',
  DEMAND_SURGE:       '🔥',
  POLICY_SUPPORT:     '📜',
  NONE:               '·',
};
