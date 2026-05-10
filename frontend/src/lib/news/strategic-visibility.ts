// ═══════════════════════════════════════════════════════════════════════════
// STRATEGIC VISIBILITY / MEGA FRAMEWORKS ENGINE — patch 0064
//
// PURPOSE
//   Detect companies whose FUTURE REVENUE BASE structurally changed via
//   mega contracts, hyperscaler leases, defense appropriations, sovereign
//   programs, AI infra capacity reservations.
//
// PARALLEL TO BOTTLENECK INTELLIGENCE — answers a different question:
//   Bottlenecks  → who BENEFITS from scarcity / pricing power
//   Strategic Vis → who LOCKED IN multi-year demand visibility
//
// INCLUSION (ALL filters apply):
//   A) Size — at least one of:
//      • ≥ $300M firm contract / order / framework
//      • ≥ 10× backlog impact
//      • 3-10y committed ≥ 20% LTM revenue OR ≥10% mcap
//      • JV/framework ≥ $5B with ≥$300M firm orders expected in 12M
//      • AUTO INCLUDE — 10y+ agreement total value ≥ 30% mcap (overrides all)
//   B) Strategic Theme — at least one of:
//      • AI Infrastructure
//      • Energy Transition (grid/T&D, renewables, BESS, uranium/SMR)
//      • Defense / Aerospace
//      • Semiconductor Supply Chain (fab tools, packaging, rare earths)
//      • Critical National / Strategic Programs
//      • Large-scale Colo / HPC Leases (MSFT/GOOG/AMZN/META)
//      • Neocloud / AI infra
//      • Quantum / Crypto / Power / Grid
//   C) Duration — firm visibility ≥ 3 years (prefer ≥5-10y)
//      • Counterparty: Hyperscaler / Tier-1 Gov-Defense / Top-3 Utility
//
// OVERRIDES:
//   • 🔒 Strategic Chokepoint — <$500M OK if sole/near-sole producer +
//     ≥5y policy-backed + cumulative federal ≥$250M (36mo) or ≥$500M (48mo)
//   • 🧭 Strategic Program Override — government/Tier-1 hyperscaler national
//     program with ≥$300M total + ≥5y forward visibility
//
// EXCLUSIONS:
//   • <$300M AND <5% mcap (unless override)
//   • MOUs / LOIs / pilots without binding $ or term
//   • Amendments / extensions without new $ or term
//   • Non-core or one-offs
//
// FLAGS (ranked):
//   🌟 ≥ mcap OR ≥ 30% mcap        (auto-include strongest signal)
//   🔥 ≥ 5× backlog OR ≥ 50% LTM revenue
//   ✅ ≥ 10y visibility
//   🔒 Strategic chokepoint
//   🧭 Strategic / policy-backed framework
// ═══════════════════════════════════════════════════════════════════════════

export type StrategicTheme =
  | 'AI_INFRASTRUCTURE'
  | 'ENERGY_TRANSITION'
  | 'DEFENSE_AEROSPACE'
  | 'SEMI_SUPPLY_CHAIN'
  | 'CRITICAL_NATIONAL_PROGRAM'
  | 'HYPERSCALER_LEASE'
  | 'NEOCLOUD_AI_INFRA'
  | 'QUANTUM_CRYPTO'
  | 'POWER_GRID'
  | 'NONE';

export type CounterpartyTier =
  | 'HYPERSCALER'         // MSFT / GOOG / AMZN / META / OpenAI / Oracle
  | 'TIER1_GOV_DEFENSE'   // DoD / DOE / GoI / EC / sovereign
  | 'TOP3_UTILITY'        // NTPC / Power Grid / Top US utility
  | 'MAJOR_FINANCIAL'     // Sovereign wealth / Tier-1 PE / Major bank
  | 'OTHER'
  | 'NONE';

export type StrategicFlag = 'MCAP_GRADE' | 'BACKLOG_RESET' | 'DECADE_VISIBILITY' | 'STRATEGIC_CHOKEPOINT' | 'POLICY_BACKED';

export interface StrategicVisibilitySignal {
  qualifies: boolean;                            // does this article meet inclusion criteria?
  theme: StrategicTheme;
  counterparty_tier: CounterpartyTier;
  counterparty_name?: string;                    // 'Microsoft' / 'DOE' / 'NTPC'
  contract_value_usd_m?: number;                 // normalised to $ millions
  visibility_years?: number;                     // contract / framework duration
  backlog_multiple?: number;                     // X× backlog
  pct_of_ltm_revenue?: number;                   // % of trailing-12m revenue
  pct_of_mcap?: number;                          // % of market cap
  flags: StrategicFlag[];                        // ranked
  is_chokepoint_override: boolean;               // included via chokepoint exception
  is_policy_framework: boolean;                  // included via strategic program override
  reason: string;                                // 1-line why it qualifies
  exclusion_reason?: string;                     // 1-line why it doesn't (when qualifies=false)
}

// ─── Theme classification — token tables ──────────────────────────────────

const THEME_PATTERNS: Array<{ theme: StrategicTheme; pattern: RegExp; weight: number }> = [
  { theme: 'AI_INFRASTRUCTURE', weight: 9, pattern: /\b(ai infrastructure|ai infra|ai compute|ai cluster|ai training cluster|inference (?:capacity|cluster)|stargate|gpt(?:-|.)?\d|llm training|hyperscaler ai|gpu (?:cluster|deployment))\b/i },
  { theme: 'HYPERSCALER_LEASE',  weight: 9, pattern: /\b((?:microsoft|amazon|google|alphabet|meta|aws|azure|oracle cloud|openai|anthropic).{0,30}(?:lease|capacity reservation|colocation|colo|hosting agreement|capacity deal|gigawatt|gw lease))\b/i },
  { theme: 'NEOCLOUD_AI_INFRA',  weight: 8, pattern: /\b(coreweave|crusoe|lambda labs|nebius|wulf|terawulf|hut.?8|iren|applied digital|cipher mining)\b/i },
  { theme: 'ENERGY_TRANSITION',  weight: 7, pattern: /\b(grid (?:upgrade|expansion|epc)|t&d epc|transmission (?:project|expansion)|renewable (?:project|epc|capacity)|bess|battery storage system|smr|small modular reactor|uranium offtake|haleu|enrichment framework|nuclear fuel agreement)\b/i },
  { theme: 'DEFENSE_AEROSPACE',  weight: 7, pattern: /\b(defense (?:appropriation|framework|multi.?year)|defence (?:appropriation|framework|multi.?year)|cas-b|production line .{0,15}(?:fighter|missile|naval)|fms (?:contract|case)|naval shipbuilding contract|c4isr|space launch contract)\b/i },
  { theme: 'SEMI_SUPPLY_CHAIN',  weight: 7, pattern: /\b(fab (?:capacity|construction).{0,30}(?:billion|bn)|chips act|semiconductor (?:capacity|fab)|cowos (?:framework|reservation|allocation)|hbm (?:framework|reservation|offtake)|advanced packaging (?:framework|allocation))\b/i },
  { theme: 'CRITICAL_NATIONAL_PROGRAM', weight: 7, pattern: /\b(doe (?:framework|appropriation|grant)|dod (?:framework|appropriation)|chips act funding|infrastructure (?:investment|jobs) act|inflation reduction act|ira (?:tax credit|funding)|production (?:linked|tax) credit)\b/i },
  { theme: 'POWER_GRID',         weight: 6, pattern: /\b(power purchase agreement|ppa.{0,40}(?:gigawatt|gw|10.?year|15.?year|20.?year)|grid interconnection (?:framework|queue)|hvdc framework|transformer multi.?year)\b/i },
  { theme: 'QUANTUM_CRYPTO',     weight: 5, pattern: /\b(quantum (?:framework|funding|appropriation|nsf grant)|crypto (?:custody|reserve) (?:framework|deal))\b/i },
];

// ─── Counterparty detection ────────────────────────────────────────────────

const COUNTERPARTY_PATTERNS: Array<{ tier: CounterpartyTier; pattern: RegExp; name: string }> = [
  // HYPERSCALER
  { tier: 'HYPERSCALER', pattern: /\b(microsoft|msft|azure)\b/i, name: 'Microsoft' },
  { tier: 'HYPERSCALER', pattern: /\b(amazon|aws)\b/i, name: 'Amazon' },
  { tier: 'HYPERSCALER', pattern: /\b(google|alphabet|googl|gcp)\b/i, name: 'Google' },
  { tier: 'HYPERSCALER', pattern: /\b(meta|facebook)\b/i, name: 'Meta' },
  { tier: 'HYPERSCALER', pattern: /\bopenai\b/i, name: 'OpenAI' },
  { tier: 'HYPERSCALER', pattern: /\boracle (?:cloud|hyperscale)\b/i, name: 'Oracle' },
  { tier: 'HYPERSCALER', pattern: /\banthropic\b/i, name: 'Anthropic' },
  // TIER1_GOV_DEFENSE
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\bdoe\b/i, name: 'DOE' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(dod|department of defense)\b/i, name: 'DoD' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(goi|government of india|moi|ministry of)\b/i, name: 'GoI' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(european commission|ec funding)\b/i, name: 'EU' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(dae|atomic energy commission)\b/i, name: 'DAE' },
  // TOP3_UTILITY
  { tier: 'TOP3_UTILITY', pattern: /\bntpc\b/i, name: 'NTPC' },
  { tier: 'TOP3_UTILITY', pattern: /\bpower grid corp\b/i, name: 'Power Grid Corp' },
  { tier: 'TOP3_UTILITY', pattern: /\b(nextera|duke energy|southern company|exelon)\b/i, name: 'US Utility' },
  // MAJOR_FINANCIAL
  { tier: 'MAJOR_FINANCIAL', pattern: /\b(sovereign wealth|saudi pif|abu dhabi|adia|temasek|cppib|ontario teachers)\b/i, name: 'Sovereign Wealth' },
];

// ─── Value extraction — money amounts ──────────────────────────────────────

function extractContractValueUsdMillions(text: string): number | undefined {
  // Match: $X B / $X M / $X bn / $X mn / Rs X crore / Rs X cr / Rs X lakh crore / ₹X cr
  // Returns USD millions (assumes 1 USD = 83 INR for INR conversion).
  const INR_TO_USD = 1 / 83;

  // USD billion
  const m1 = text.match(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(billion|bn|b\b)/i);
  if (m1) return parseFloat(m1[1].replace(/,/g, '')) * 1000;

  // USD million
  const m2 = text.match(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(million|mn|m\b)/i);
  if (m2) return parseFloat(m2[1].replace(/,/g, ''));

  // INR lakh crore (= 100,000 cr = 1 trillion INR ≈ $12B)
  const m3 = text.match(/(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d+)?)\s*lakh\s*crore/i);
  if (m3) return parseFloat(m3[1].replace(/,/g, '')) * 100000 * INR_TO_USD;

  // INR crore (= 10M INR ≈ $120,000)
  const m4 = text.match(/(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d+)?)\s*(?:cr|crore)\b/i);
  if (m4) return parseFloat(m4[1].replace(/,/g, '')) * 10 * INR_TO_USD;

  return undefined;
}

// ─── Duration extraction — visibility years ────────────────────────────────

function extractVisibilityYears(text: string): number | undefined {
  // Match: 10-year / 10y / 10 years / decade / multi-year (default 5)
  const m1 = text.match(/(\d{1,2})[\s-]*year(?:s)?\b/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = text.match(/(\d{1,2})y\b/i);
  if (m2) return parseInt(m2[1], 10);
  if (/\bdecade\b/i.test(text)) return 10;
  if (/\bmulti.?year\b|\blong.?term\b/i.test(text)) return 5;
  return undefined;
}

// ─── Excluder — pre-filter events that aren't in scope ────────────────────

const EXCLUDE_PATTERNS = [
  /\b(mou|memorandum of understanding|loi|letter of intent|pilot project)\b(?!.{0,40}(binding|firm|definitive|signed))/i,  // MOU/LOI without binding
  /\b(routine maintenance|service contract|support contract|annual contract)\b/i,
  /\b(amendment|extension|renewal)\b(?!.{0,40}(\$|\d+\s*(?:billion|million|cr|crore)))/i,  // amendment without new $
];

// ─── Detect strategic-chokepoint companies ────────────────────────────────
// Sole/near-sole producers in critical chains. Triggers the chokepoint
// override even at <$500M contract size.

const CHOKEPOINT_NAMES = /\b(centrus energy|leu\b|haleu|tomra|asml|asml holding|tsmc cowos|ajinomoto build.?up|jsr corporation|cameco|nexgen energy|kazatomprom|lynas rare|mp materials)\b/i;

// ─── Main classifier ──────────────────────────────────────────────────────

export function classifyStrategicVisibility(args: {
  title: string;
  desc: string;
  ticker_market_cap_usd_m?: number;
  ticker_ltm_revenue_usd_m?: number;
}): StrategicVisibilitySignal {
  const { title, desc, ticker_market_cap_usd_m, ticker_ltm_revenue_usd_m } = args;
  const text = (title + ' ' + (desc || '')).trim();
  const lower = text.toLowerCase();

  // Step 0: Hard exclusions
  for (const ex of EXCLUDE_PATTERNS) {
    if (ex.test(lower)) {
      return {
        qualifies: false,
        theme: 'NONE',
        counterparty_tier: 'NONE',
        flags: [],
        is_chokepoint_override: false,
        is_policy_framework: false,
        reason: '',
        exclusion_reason: 'MOU / LOI / amendment / routine — no binding new commitment',
      };
    }
  }

  // Step 1: Theme classification — must hit a strategic theme
  let theme: StrategicTheme = 'NONE';
  let bestThemeWeight = 0;
  for (const t of THEME_PATTERNS) {
    if (t.pattern.test(text) && t.weight > bestThemeWeight) {
      bestThemeWeight = t.weight;
      theme = t.theme;
    }
  }
  if (theme === 'NONE') {
    return {
      qualifies: false,
      theme: 'NONE',
      counterparty_tier: 'NONE',
      flags: [],
      is_chokepoint_override: false,
      is_policy_framework: false,
      reason: '',
      exclusion_reason: 'No strategic theme detected (need AI infra / energy / defense / semi / sovereign / hyperscaler)',
    };
  }

  // Step 2: Counterparty detection — must have a Tier-1 counterparty
  let counterparty_tier: CounterpartyTier = 'NONE';
  let counterparty_name: string | undefined;
  for (const cp of COUNTERPARTY_PATTERNS) {
    if (cp.pattern.test(text)) {
      counterparty_tier = cp.tier;
      counterparty_name = cp.name;
      break;
    }
  }

  // Step 3: Extract contract value + visibility
  const contract_value_usd_m = extractContractValueUsdMillions(text);
  const visibility_years = extractVisibilityYears(text);

  // Step 4: Compute % of mcap / LTM revenue (if known)
  let pct_of_mcap: number | undefined;
  let pct_of_ltm_revenue: number | undefined;
  if (contract_value_usd_m && ticker_market_cap_usd_m && ticker_market_cap_usd_m > 0) {
    pct_of_mcap = Math.round((contract_value_usd_m / ticker_market_cap_usd_m) * 100);
  }
  if (contract_value_usd_m && ticker_ltm_revenue_usd_m && ticker_ltm_revenue_usd_m > 0) {
    pct_of_ltm_revenue = Math.round((contract_value_usd_m / ticker_ltm_revenue_usd_m) * 100);
  }

  // Step 5: Apply inclusion filters
  const flags: StrategicFlag[] = [];
  let qualifies = false;
  const reasons: string[] = [];

  // Filter A — Size
  const sizeOK = (
    (contract_value_usd_m !== undefined && contract_value_usd_m >= 300) ||
    (pct_of_ltm_revenue !== undefined && pct_of_ltm_revenue >= 20 && (visibility_years ?? 0) >= 3) ||
    (pct_of_mcap !== undefined && pct_of_mcap >= 10 && (visibility_years ?? 0) >= 3)
  );

  // AUTO INCLUDE — 10y+ agreement total ≥ 30% mcap
  const autoInclude = (visibility_years ?? 0) >= 10 && (pct_of_mcap ?? 0) >= 30;
  if (autoInclude) {
    qualifies = true;
    flags.push('MCAP_GRADE');
    reasons.push(`Auto-include: ${visibility_years}y agreement ≥ 30% of market cap`);
  }

  // Strategic chokepoint override — sole/near-sole producer at <$500M
  const isChokepoint = CHOKEPOINT_NAMES.test(text);
  let is_chokepoint_override = false;
  if (isChokepoint && (visibility_years ?? 0) >= 5) {
    qualifies = true;
    is_chokepoint_override = true;
    flags.push('STRATEGIC_CHOKEPOINT');
    reasons.push('Strategic chokepoint — sole/near-sole producer in critical chain');
  }

  // Strategic Program / Framework override — policy-backed national program
  let is_policy_framework = false;
  if (counterparty_tier === 'TIER1_GOV_DEFENSE' && (visibility_years ?? 0) >= 5 && (contract_value_usd_m ?? 0) >= 300) {
    qualifies = true;
    is_policy_framework = true;
    flags.push('POLICY_BACKED');
    reasons.push('Government-backed strategic framework with ≥5y visibility');
  }

  // Standard inclusion — Size + Theme + Duration + Counterparty
  if (!qualifies && sizeOK && counterparty_tier !== 'NONE' && (visibility_years ?? 0) >= 3) {
    qualifies = true;
    reasons.push(`Firm contract ${contract_value_usd_m}M with ${counterparty_name} (${visibility_years}y visibility)`);
  }

  // Add ranked flags for qualifying signals
  if (qualifies) {
    if ((pct_of_mcap ?? 0) >= 100) flags.push('MCAP_GRADE');
    else if ((pct_of_mcap ?? 0) >= 30 && !flags.includes('MCAP_GRADE')) flags.push('MCAP_GRADE');
    if ((pct_of_ltm_revenue ?? 0) >= 50) flags.push('BACKLOG_RESET');
    if ((visibility_years ?? 0) >= 10) flags.push('DECADE_VISIBILITY');
  }

  // Build exclusion reason if not qualifying
  let exclusion_reason: string | undefined;
  if (!qualifies) {
    if (!sizeOK) exclusion_reason = `Size below threshold (${contract_value_usd_m ?? '?'}M vs $300M minimum)`;
    else if (counterparty_tier === 'NONE') exclusion_reason = 'No Tier-1 counterparty (need Hyperscaler / Gov / Top-3 Utility)';
    else if ((visibility_years ?? 0) < 3) exclusion_reason = `Visibility too short (${visibility_years ?? 0}y vs 3y minimum)`;
  }

  return {
    qualifies,
    theme,
    counterparty_tier,
    counterparty_name,
    contract_value_usd_m,
    visibility_years,
    pct_of_mcap,
    pct_of_ltm_revenue,
    flags: Array.from(new Set(flags)),
    is_chokepoint_override,
    is_policy_framework,
    reason: reasons.join('; '),
    exclusion_reason,
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────

export const THEME_DISPLAY: Record<StrategicTheme, string> = {
  AI_INFRASTRUCTURE:         'AI Infrastructure',
  ENERGY_TRANSITION:         'Energy Transition',
  DEFENSE_AEROSPACE:         'Defense / Aerospace',
  SEMI_SUPPLY_CHAIN:         'Semi Supply Chain',
  CRITICAL_NATIONAL_PROGRAM: 'National Program',
  HYPERSCALER_LEASE:         'Hyperscaler Lease',
  NEOCLOUD_AI_INFRA:         'Neocloud AI Infra',
  QUANTUM_CRYPTO:            'Quantum / Crypto',
  POWER_GRID:                'Power / Grid',
  NONE:                      '—',
};

export const COUNTERPARTY_DISPLAY: Record<CounterpartyTier, string> = {
  HYPERSCALER:        'Hyperscaler',
  TIER1_GOV_DEFENSE:  'Tier-1 Gov',
  TOP3_UTILITY:       'Top-3 Utility',
  MAJOR_FINANCIAL:    'Major Financial',
  OTHER:              'Other',
  NONE:               '—',
};

export const FLAG_DISPLAY: Record<StrategicFlag, string> = {
  MCAP_GRADE:           '🌟 mcap-grade',
  BACKLOG_RESET:        '🔥 backlog reset',
  DECADE_VISIBILITY:    '✅ 10y visibility',
  STRATEGIC_CHOKEPOINT: '🔒 chokepoint',
  POLICY_BACKED:        '🧭 policy-backed',
};

// Ranking score for sorting strategic visibility cards
export function strategicRankScore(s: StrategicVisibilitySignal): number {
  let score = 0;
  if (s.flags.includes('MCAP_GRADE'))           score += 100;
  if (s.flags.includes('BACKLOG_RESET'))        score += 60;
  if (s.flags.includes('DECADE_VISIBILITY'))    score += 40;
  if (s.flags.includes('STRATEGIC_CHOKEPOINT')) score += 35;
  if (s.flags.includes('POLICY_BACKED'))        score += 25;
  // Counterparty quality
  if (s.counterparty_tier === 'HYPERSCALER')        score += 30;
  if (s.counterparty_tier === 'TIER1_GOV_DEFENSE')  score += 25;
  if (s.counterparty_tier === 'TOP3_UTILITY')       score += 18;
  if (s.counterparty_tier === 'MAJOR_FINANCIAL')    score += 10;
  // Size + duration
  if (s.contract_value_usd_m && s.contract_value_usd_m >= 1000) score += Math.min(30, s.contract_value_usd_m / 100);
  if (s.visibility_years && s.visibility_years >= 5) score += Math.min(20, s.visibility_years);
  return score;
}
