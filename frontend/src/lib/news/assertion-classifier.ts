// ═══════════════════════════════════════════════════════════════════════════
// ASSERTION CLASSIFIER — patch 0052
//
// Solves causal hallucination. The previous template-driven impact line
// over-projected: "NTPC, IndianOil, Coal India plan IPO" was getting
// "Power availability constraining hyperscaler buildouts" — a thematic
// inference unsupported by the article.
//
// Every impact label is now stamped with an assertion class so the user
// can distinguish:
//
//   FACT        — directly supported by article text
//   INFERENCE   — system inference from co-occurring tokens (still useful,
//                 but wrapped in conditional language)
//   SPECULATION — only loose semantic association; speculative thematic
//
// The frontend renders these distinctly so users never confuse what the
// article said with what the system inferred.
// ═══════════════════════════════════════════════════════════════════════════

export type AssertionClass = 'FACT' | 'INFERENCE' | 'SPECULATION';

export interface FramedImpact {
  label: string;
  assertion: AssertionClass;
  // The verb-prefix tells the user how to read the line
  prefix: 'Reported:' | 'May imply:' | 'Speculative thematic:';
}

// ─── Classify the assertion strength ──────────────────────────────────────
// FACT: title or summary directly states the impact relationship
//   ("HBM shortage extends" / "TSMC raises capex" / "Nvidia GPU shipment cut")
// INFERENCE: tokens co-occur but the article doesn't directly assert the
//   transmission ("AI chip story mentions Micron" → "memory cycle extending"
//   is an INFERENCE, not a FACT)
// SPECULATION: only thematic association; user must be told the system is
//   reaching ("NTPC IPO" → "hyperscaler buildouts" — too far)

interface AssertionRule {
  // If this article matches the regex, assertion is auto-FACT
  fact_when?: RegExp;
  // If sub-tag matches one of these, INFERENCE is the safe default
  inference_subtags?: string[];
}

// FACT signals: explicit causal verbs paired with a constraint object.
const FACT_PATTERNS: RegExp[] = [
  // direct constraint statements
  /\b(shortage|sold out|capacity hit zero|allocation tight|supply constrained|backlog of \d|lead time \d{1,3}\s*(?:weeks?|months?)|fully allocated|oversubscribed)\b/i,
  // direct guidance / order
  /\b(orders? \$\d|deal worth (?:rs|inr|\$|₹)\s*\d|capacity expansion|new fab|broke ground|commissioned|criticality achieved|first wafer)\b/i,
  // direct supply event
  /\b(production halt|line shut|facility (closed|fire|outage)|export ban (in (?:place|effect)|takes effect)|tariff imposed)\b/i,
  // direct earnings / guidance event
  /\b(reported (?:net )?profit|guidance (?:raised|cut|maintained|reaffirmed)|revenue (?:rose|fell) \d|eps (?:beat|miss))\b/i,
];

// SPECULATION signals: weakly-linked themes — "long-term", "may", "could", etc.
const SPECULATION_PATTERNS: RegExp[] = [
  /\b(may (be|imply|signal|support|suggest)|could (signal|imply|support)|potentially|long.?term|over time|in (the )?future|down the (line|road)|years out)\b/i,
];

// Defense / banking / cement / FMCG IPO etc — articles about company
// structural changes that don't carry direct compute / energy /
// constraint transmission. Force SPECULATION when paired with a
// thematic impact label.
const NON_DIRECT_BUSINESS_RE = /\b(ipo (?:papers|listing|launch|approval|drhp|filed|plan)|plan (?:ipo|public offering|listing)|file ipo|to launch ipo|ipo soon|stock (?:hit|hits|reach(?:es)?|fresh|new|surge|surges|jumps|jumped|soars|soared|plunges|plunged|tanks|tanked)|merger|acquisition|stake (?:sale|purchase)|appoint(?:ed|ment)|board (?:reshuffle|reconstitution)|chairman|md(?: appoint| transition)|delisting|amalgamation|hive[- ]?off)\b/i;

// Stock-action only: "X stock hits record high" alone doesn't justify
// inferring bottleneck transmission.
const STOCK_ACTION_ONLY_RE = /\b(stock (?:hit|hits|reach(?:es)?|surge|surges|jumps|jumped|soars|soared|plunges|plunged|tanks|tanked|crash(?:es|ed)?)|stock\s+(?:soared|surged|jumped|plunged|tanked|crashed|hit)\s+(?:fresh|new|record|all.?time|high|low)|share price (?:hit|surged|tanked|crashed)|hits? (?:fresh|new) (?:record|high|low|all.?time))\b/i;

export function classifyAssertion(args: {
  title: string;
  desc: string;
  templated_impact_was_used: boolean;
}): AssertionClass {
  const { title, desc, templated_impact_was_used } = args;
  const text = (title + ' ' + (desc || '')).toLowerCase();

  // If the article is pure stock-action with no constraint signal, the
  // templated impact is at most SPECULATION
  if (STOCK_ACTION_ONLY_RE.test(text) && !FACT_PATTERNS.some(p => p.test(text))) {
    return 'SPECULATION';
  }

  // Non-direct business event (IPO, M&A, appointment) paired with a
  // thematic impact label → SPECULATION
  if (NON_DIRECT_BUSINESS_RE.test(text) && templated_impact_was_used) {
    return 'SPECULATION';
  }

  // Direct fact pattern in title → FACT
  const titleHasFact = FACT_PATTERNS.some(p => p.test(title));
  if (titleHasFact) return 'FACT';

  // Speculative language present → SPECULATION
  if (SPECULATION_PATTERNS.some(p => p.test(text))) return 'SPECULATION';

  // Direct fact in summary → FACT (with slightly less weight)
  const descHasFact = FACT_PATTERNS.some(p => p.test(text));
  if (descHasFact) return 'FACT';

  // Default to INFERENCE — system is connecting tokens, not quoting the article
  return 'INFERENCE';
}

// ─── Frame the impact label per assertion class ───────────────────────────

export function frameImpact(args: {
  raw_label: string;
  title: string;
  desc: string;
  is_templated: boolean;          // came from category × subtag template
}): FramedImpact {
  const { raw_label, title, desc, is_templated } = args;
  if (!raw_label) {
    return { label: '', assertion: 'INFERENCE', prefix: 'May imply:' };
  }
  const cls = classifyAssertion({ title, desc, templated_impact_was_used: is_templated });
  if (cls === 'FACT') {
    return { label: raw_label, assertion: 'FACT', prefix: 'Reported:' };
  }
  if (cls === 'SPECULATION') {
    // Soften the language: "may", "potentially relevant"
    const softened = softenLabel(raw_label);
    return { label: softened, assertion: 'SPECULATION', prefix: 'Speculative thematic:' };
  }
  // INFERENCE — frame conditionally
  const conditional = conditionalize(raw_label);
  return { label: conditional, assertion: 'INFERENCE', prefix: 'May imply:' };
}

function softenLabel(label: string): string {
  // Replace assertive verbs with hedged equivalents
  return label
    .replace(/\bconstraining\b/i, 'potentially relevant to')
    .replace(/\bbinding\b/i, 'possibly relevant to')
    .replace(/\baccelerating\b/i, 'with potential acceleration')
    .replace(/\bstrengthening\b/i, 'with potential strengthening')
    .replace(/\bextending\b/i, 'with potential extension')
    .replace(/\brerating\b/i, 'with potential rerating');
}

function conditionalize(label: string): string {
  // Wrap label so it reads as inferred, not asserted
  if (/^[A-Z]/.test(label) || label.length < 60) return label;
  return label;   // raw label is fine for INFERENCE — prefix carries the framing
}

// ─── Direct-compute-linkage check (Issue #2 — power over-expansion) ───────
// A power article should only be tagged compute-relevant if it has explicit
// compute linkage. Generic solar EPC, hydro commissioning, BESS contracts
// stay in ENERGY_INFRA but do NOT inherit COMPUTE_INFRA-relevance.

const DIRECT_COMPUTE_LINKAGE_RE = /\b(data center|datacenter|hyperscaler|ai (?:compute|training|inference)|gpu (?:cluster|deployment)|server farm|colocation|cloud (?:capex|build|deployment)|aws|azure|google cloud|microsoft (?:azure|cloud)|meta (?:capex|cluster)|coreweave|crusoe|lambda labs)\b/i;

const POWER_GENERIC_RE = /\b(solar (?:epc|park|farm|project)|hydro (?:project|commissioning|plant)|bess(?: contract| project)?|wind (?:farm|turbine|project)|battery storage project)\b/i;

export function hasDirectComputeLinkage(text: string): boolean {
  return DIRECT_COMPUTE_LINKAGE_RE.test(text);
}

export function isGenericPowerStory(text: string): boolean {
  return POWER_GENERIC_RE.test(text) && !DIRECT_COMPUTE_LINKAGE_RE.test(text);
}

// ─── Defense narrative sub-ontology (Issue #3) ────────────────────────────

export type DefenseNarrative =
  | 'EXPORT_MOMENTUM'
  | 'CAPACITY_EXPANSION'
  | 'IMPORT_SUBSTITUTION'
  | 'PROCUREMENT_DELAY'
  | 'EXECUTION_RISK'
  | 'PRIVATE_COMPETITION'
  | 'ORDER_BOOK_VISIBILITY'
  | 'POLICY_SHIFT'
  | 'GENERIC';

const DEFENSE_NARRATIVE_PATTERNS: Array<{ narrative: DefenseNarrative; pattern: RegExp; impact: string }> = [
  { narrative: 'PROCUREMENT_DELAY',
    pattern: /\b(delay(?:ed)?|push(?:ed)? back|tender (cancell|withdrawn|repealed)|rfp delayed|stuck|stall(?:ed)?|sidelined|blocked|on hold|bottleneck (in|at) procurement|deferral|reject(?:ed)?)\b/i,
    impact: 'Defence procurement friction — execution timing risk' },
  { narrative: 'EXECUTION_RISK',
    pattern: /\b(cost overrun|execution (concern|risk|slip)|delivery slip|missed deadline|over budget|underperform|behind schedule|production issue|quality concern)\b/i,
    impact: 'Defence execution risk — order conversion at risk' },
  { narrative: 'PRIVATE_COMPETITION',
    pattern: /\b(tata (advanced|defence|aerospace)|l&t defence|adani defence|paras defence|astra microwave|data patterns|private (sector|player|defence)|disinvestment|psu (vs|share loss)|loses (?:contract|tender) to)\b/i,
    impact: 'Private-sector defence competition — PSU share at risk' },
  { narrative: 'IMPORT_SUBSTITUTION',
    pattern: /\b(indigenous|make in india|local (content|content rule|sourcing)|import substitution|atmanirbhar|swadeshi|domestically (?:built|made|manufactured)|negative import list|positive indigenisation list)\b/i,
    impact: 'Import substitution accelerating — local order book expanding' },
  { narrative: 'EXPORT_MOMENTUM',
    pattern: /\b(export (?:order|contract|deal|deliver|momentum|push)|exports? (rose|grew|surged|jumped)|defence exports|brahmos export|tejas export|dhruv export)\b/i,
    impact: 'Defence export momentum — order book diversifying' },
  { narrative: 'CAPACITY_EXPANSION',
    pattern: /\b(capacity (?:addition|expansion|step.?up|ramp)|new (?:line|factory|plant|facility)|production line|gigafactory|broke ground|commissioned)\b/i,
    impact: 'Defence capacity expansion — multi-year delivery visibility' },
  { narrative: 'ORDER_BOOK_VISIBILITY',
    pattern: /\b(order book|backlog|book.?to.?bill|order pipeline|order intake|deal pipeline|won (?:contract|tender|deal) worth)\b/i,
    impact: 'Defence order book visibility — earnings durability lengthens' },
  { narrative: 'POLICY_SHIFT',
    pattern: /\b(defence (?:policy|reform|fdi|procurement framework)|new procurement (?:policy|framework|guideline)|defence acquisition (?:procedure|council|policy))\b/i,
    impact: 'Defence policy shift — capex intensity changes' },
];

export function classifyDefenseNarrative(title: string, desc: string): { narrative: DefenseNarrative; impact: string } {
  const text = (title + ' ' + (desc || '')).toLowerCase();
  for (const rule of DEFENSE_NARRATIVE_PATTERNS) {
    if (rule.pattern.test(text)) return { narrative: rule.narrative, impact: rule.impact };
  }
  return { narrative: 'GENERIC', impact: 'Defence sector signal — narrative pending' };
}

// ─── Freshness layer (Issue #4) ───────────────────────────────────────────
// Splits structural feed into LIVE / PERSISTENT / ARCHIVAL so old context
// doesn't pollute urgency perception.

export type FreshnessLayer = 'LIVE_STRUCTURE' | 'PERSISTENT_THEME' | 'ARCHIVAL_CONTEXT';

export function computeFreshnessLayer(args: {
  age_days: number;
  is_synthetic?: boolean;
  half_life: 'TRANSIENT' | 'CYCLICAL' | 'STRUCTURAL' | 'SECULAR';
}): FreshnessLayer {
  const { age_days, is_synthetic, half_life } = args;
  // Synthetic structural alerts always count as LIVE — they're current
  // by definition.
  if (is_synthetic) return 'LIVE_STRUCTURE';
  if (age_days <= 3) return 'LIVE_STRUCTURE';
  if (age_days <= 30) return 'PERSISTENT_THEME';
  // SECULAR articles can stay in PERSISTENT longer
  if (half_life === 'SECULAR' && age_days <= 90) return 'PERSISTENT_THEME';
  return 'ARCHIVAL_CONTEXT';
}

// ─── Multi-dimensional confidence (Issue #5) ──────────────────────────────

export interface SignalConfidence {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_pct: number;          // 0-100
  evidence_count: number;          // articles in same theme over 30d
  persistence_days: number;        // days since first article on this theme
  cross_source_confirmation: boolean; // PRIMARY + SPECIALIST both covered
  contributing_factors: string[];  // what drove the score
}

export function buildSignalConfidence(args: {
  base_confidence_pct: number;     // from structural_confidence
  evidence_count?: number;
  evidence_persistence_days?: number;
  evidence_cross_source?: boolean;
  importance_rank: 'TIER_1_ALPHA' | 'TIER_2_RELEVANT' | 'TIER_3_CONTEXT' | 'TIER_4_NOISE';
  assertion_class: AssertionClass;
}): SignalConfidence {
  const { base_confidence_pct, evidence_count, evidence_persistence_days,
          evidence_cross_source, importance_rank, assertion_class } = args;

  let conf = base_confidence_pct;
  const factors: string[] = [];

  // Evidence count bonus
  const ec = evidence_count ?? 0;
  if (ec >= 6) { conf += 10; factors.push(`${ec} articles on theme`); }
  else if (ec >= 3) { conf += 5; factors.push(`${ec} articles on theme`); }
  else if (ec >= 1) factors.push(`${ec} article on theme`);

  // Persistence bonus
  const pd = evidence_persistence_days ?? 0;
  if (pd >= 60) { conf += 10; factors.push(`persistent ${pd}d`); }
  else if (pd >= 14) { conf += 5; factors.push(`persistent ${pd}d`); }

  // Cross-source confirmation
  if (evidence_cross_source) { conf += 8; factors.push('cross-source confirmed'); }

  // Importance rank
  if (importance_rank === 'TIER_1_ALPHA') conf += 5;
  if (importance_rank === 'TIER_4_NOISE') conf -= 20;

  // Assertion class
  if (assertion_class === 'SPECULATION') conf -= 25;
  if (assertion_class === 'FACT') conf += 10;

  const finalConf = Math.max(0, Math.min(100, Math.round(conf)));
  const level: SignalConfidence['level'] = finalConf >= 75 ? 'HIGH' : finalConf >= 50 ? 'MEDIUM' : 'LOW';

  return {
    level,
    confidence_pct: finalConf,
    evidence_count: ec,
    persistence_days: pd,
    cross_source_confirmation: !!evidence_cross_source,
    contributing_factors: factors,
  };
}
