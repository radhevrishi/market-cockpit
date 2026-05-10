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
  { tier: 'TOP3_UTILITY', pattern: /\b(power grid corp|powergrid|pgcil)\b/i, name: 'Power Grid' },
  { tier: 'TOP3_UTILITY', pattern: /\bnhpc\b/i, name: 'NHPC' },
  { tier: 'TOP3_UTILITY', pattern: /\bsjvn\b/i, name: 'SJVN' },
  { tier: 'TOP3_UTILITY', pattern: /\bcoal india\b/i, name: 'Coal India' },
  { tier: 'TOP3_UTILITY', pattern: /\bnlc india\b/i, name: 'NLC India' },
  { tier: 'TOP3_UTILITY', pattern: /\b(ireda|rec ltd|pfc ltd|power finance corp)\b/i, name: 'India Energy Finance' },
  { tier: 'TOP3_UTILITY', pattern: /\b(seci|solar energy corporation of india)\b/i, name: 'SECI' },
  { tier: 'TOP3_UTILITY', pattern: /\b(nextera|duke energy|southern company|exelon|aep|dominion|edison)\b/i, name: 'US Utility' },
  // PSU heavy industries → TIER1_GOV_DEFENSE (counted as Tier-1 counterparty)
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\bbhel\b/i, name: 'BHEL' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(hal|hindustan aeronautics)\b/i, name: 'HAL' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(bel|bharat electronics)\b/i, name: 'BEL' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(bdl|bharat dynamics)\b/i, name: 'BDL' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(cochin shipyard|garden reach|mazagon dock)\b/i, name: 'Indian Shipyard' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(npcil|bhavini|nuclear power corporation)\b/i, name: 'NPCIL' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(isro|antrix|ssld)\b/i, name: 'ISRO' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(ongc|oil india)\b/i, name: 'ONGC' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\bgail\b/i, name: 'GAIL' },
  { tier: 'TIER1_GOV_DEFENSE', pattern: /\b(railway board|indian railways|irctc|rvnl|rites)\b/i, name: 'Indian Railways' },
  // MAJOR_FINANCIAL
  { tier: 'MAJOR_FINANCIAL', pattern: /\b(sovereign wealth|saudi pif|abu dhabi|adia|temasek|cppib|ontario teachers)\b/i, name: 'Sovereign Wealth' },
];

// PATCH 0068: Inferred visibility for India infra / PSU EPC orders.
// Solar / BESS / hydro / transmission EPC contracts from NTPC / PGCIL /
// SECI typically have 3-25y PPAs even when the headline doesn't say so.
// We infer a default of 3y when (a) counterparty is TOP3_UTILITY or
// TIER1_GOV_DEFENSE AND (b) the theme is energy / power / defence /
// semi / national-program. This unblocks transformational signals that
// were silently failing the visibility gate.
const INFRA_INFERRED_VISIBILITY_THEMES: StrategicTheme[] = [
  'ENERGY_TRANSITION', 'POWER_GRID', 'DEFENSE_AEROSPACE',
  'SEMI_SUPPLY_CHAIN', 'CRITICAL_NATIONAL_PROGRAM', 'AI_INFRASTRUCTURE',
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

  // PATCH 0069: Generic-hyperscaler detection.
  // Many transformational AI lease announcements name only "undisclosed
  // hyperscaler" / "investment-grade hyperscaler" / "Tier-1 AI customer".
  // When the deal language is otherwise institutional (lease/take-or-pay/
  // triple-net + AI/data center context), accept HYPERSCALER tier with
  // generic name so the article can qualify.
  if (counterparty_tier === 'NONE') {
    const hasHyperscalerKeyword = /\b(hyperscaler|hyperscale|investment.?grade.{0,30}(?:hyperscaler|tenant)|tier.?1\s*(?:ai\s*customer|cloud\s*customer)|undisclosed.{0,30}hyperscaler)\b/i.test(text);
    const hasLeaseStructure = /\b(triple.?net|take.?or.?pay|colocation|data.?center lease|ai (?:campus|factory|infrastructure) lease|hosting agreement|capacity reservation)\b/i.test(text);
    if (hasHyperscalerKeyword && hasLeaseStructure) {
      counterparty_tier = 'HYPERSCALER';
      counterparty_name = 'Hyperscaler (undisclosed)';
    }
  }
  // Treat top neoclouds (CoreWeave / Crusoe / Lambda / Nebius) as
  // HYPERSCALER counterparty when they're the customer in a lease deal.
  if (counterparty_tier === 'NONE') {
    const neoCustomer = text.match(/\b(coreweave|crusoe|lambda labs|nebius|wulf|terawulf)\b/i);
    if (neoCustomer && /\b(lease|capacity reservation|hosting|colocation)\b/i.test(text)) {
      counterparty_tier = 'HYPERSCALER';
      counterparty_name = neoCustomer[1].replace(/^./, (c) => c.toUpperCase());
    }
  }

  // Step 3: Extract contract value + visibility
  let contract_value_usd_m = extractContractValueUsdMillions(text);
  let visibility_years = extractVisibilityYears(text);

  // PATCH 0069: capacity-based size inference for AI/hyperscaler leases.
  // When the article describes ≥100MW AI campus / data center capacity
  // with ≥10y duration but doesn't disclose $ value, infer a conservative
  // $30M/MW/year implicit value (industry benchmark for take-or-pay AI
  // leases). 200MW × 15y × $30M = $90B (capped at $20B for sanity).
  if (contract_value_usd_m === undefined) {
    const mwM = text.match(/\b(\d[\d,.]*)\s*mw\b/i);
    const isAiContext = /\b(ai (?:campus|factory|infrastructure|data ?center)|hyperscaler|colocation|hpc cluster)\b/i.test(text);
    if (mwM && isAiContext) {
      const mw = parseFloat(mwM[1].replace(/,/g, ''));
      const yrs = visibility_years ?? 10;
      if (mw >= 100 && yrs >= 10) {
        // Conservative: $20M/MW/year ≈ $300/kW-month (take-or-pay)
        const implicit = Math.min(20000, Math.round(mw * yrs * 20));
        contract_value_usd_m = implicit;
      }
    }
  }

  // PATCH 0068: Infer visibility for India PSU infra EPC orders that don't
  // mention years explicitly. Solar/BESS/hydro/transmission/defence EPC
  // contracts from NTPC/PGCIL/SECI/HAL/BEL have 3-25y revenue tails.
  let visibility_inferred = false;
  if (visibility_years === undefined) {
    const cpIsIndianPSU = (
      counterparty_tier === 'TOP3_UTILITY' ||
      (counterparty_tier === 'TIER1_GOV_DEFENSE' && /\b(india|goi|ministry|psu)\b/i.test(text))
    );
    const themeMatchesInfra = INFRA_INFERRED_VISIBILITY_THEMES.includes(theme);
    if (cpIsIndianPSU && themeMatchesInfra) {
      visibility_years = 3;          // conservative default — most are 5-25y
      visibility_inferred = true;
    }
  }

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
  // PATCH 0068: tier-2 India PSU path. ₹500 cr (~$60M) order from
  // NTPC / PGCIL / SECI / HAL / BEL / Coal India / Indian Railways with
  // ≥3y visibility counts as transformational for mid/small caps even
  // though the absolute number is below the global $300M floor.
  const isIndiaPSUTier1 = (
    counterparty_tier === 'TOP3_UTILITY' ||
    (counterparty_tier === 'TIER1_GOV_DEFENSE' && /\b(india|goi|ministry|psu|crore|₹|rs\.?\s*\d|inr)\b/i.test(text))
  );
  const indiaPSUSizeOK = (
    isIndiaPSUTier1 &&
    contract_value_usd_m !== undefined && contract_value_usd_m >= 60 &&   // ≥ ₹500 cr
    (visibility_years ?? 0) >= 3
  );

  const sizeOK = (
    (contract_value_usd_m !== undefined && contract_value_usd_m >= 300) ||
    (pct_of_ltm_revenue !== undefined && pct_of_ltm_revenue >= 20 && (visibility_years ?? 0) >= 3) ||
    (pct_of_mcap !== undefined && pct_of_mcap >= 10 && (visibility_years ?? 0) >= 3) ||
    indiaPSUSizeOK
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
    const visTag = visibility_inferred ? `${visibility_years}y inferred` : `${visibility_years}y`;
    if (indiaPSUSizeOK && (contract_value_usd_m ?? 0) < 300) {
      flags.push('POLICY_BACKED');
      reasons.push(`India PSU framework: ₹${Math.round((contract_value_usd_m ?? 0) * 83 / 10)} cr order from ${counterparty_name} (${visTag})`);
    } else {
      reasons.push(`Firm contract $${contract_value_usd_m}M with ${counterparty_name} (${visTag} visibility)`);
    }
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

// ─── PATCH 0067: Strategic Visibility v2 enhancements ──────────────────────

// 1. SIGNAL QUALITY TIER — A/B/C/D based on source provenance
//    A: primary filing confirmed (8-K / SEBI / investor deck)
//    B: Tier-1 media confirmed (Reuters / Bloomberg News / FT / WSJ / ET / BS)
//    C: industry/specialist source (SemiAnalysis / Power Eng / Defense News)
//    D: speculative / single-source / blog / social

export type SignalQualityTier = 'A_FILING' | 'B_TIER1_MEDIA' | 'C_INDUSTRY' | 'D_SPECULATIVE';

const FILING_SOURCE_RE = /\b(sec filing|8-?k|10-?[qk]|6-?k|sebi (?:filing|circular|order)|investor (?:deck|presentation|day)|earnings (?:transcript|call|presentation)|press release.{0,15}company|nse (?:filing|announcement)|bse (?:filing|announcement))\b/i;
const TIER1_MEDIA_NAMES = /^(reuters|bloomberg news|wall street journal|wsj|financial times|ft markets|ft news|economic times|business standard|mint|moneycontrol|cnbc top news|cnbc world|cnbc finance)/i;
const INDUSTRY_SOURCE_NAMES = /^(semianalysis|semiwiki|tom'?s hardware|the register|power engineering|utility dive|world nuclear news|defense news|breaking defense|spacenews|aviation week|datacenter dynamics|trendforce|digitimes|servethehome|nextplatform|et infra|et energyworld|powerline|power line|renewable watch)/i;

export function classifySignalQuality(args: {
  source_name?: string;
  title?: string;
  desc?: string;
}): SignalQualityTier {
  const { source_name = '', title = '', desc = '' } = args;
  const fullText = `${title} ${desc}`.toLowerCase();

  // Tier A — primary filing language present in title/desc
  if (FILING_SOURCE_RE.test(fullText)) return 'A_FILING';

  // Tier B — recognised Tier-1 media
  if (TIER1_MEDIA_NAMES.test(source_name)) return 'B_TIER1_MEDIA';

  // Tier C — recognised specialist / industry source
  if (INDUSTRY_SOURCE_NAMES.test(source_name)) return 'C_INDUSTRY';

  return 'D_SPECULATIVE';
}

// 2. CAPACITY RESERVED tracker — extracts MW / GW / CoWoS / HBM / SWU /
//    transmission GW / data center MW from text. Returns the highest-density
//    reservation found in the article.

export interface CapacityReserved {
  unit: 'MW' | 'GW' | 'CoWoS_wafer_pm' | 'HBM_kpcs_pm' | 'SWU_tonnes' | 'fab_pct' | 'tcap_GW' | 'unspecified';
  amount: number;
  raw_phrase: string;
}

export function extractCapacityReserved(text: string): CapacityReserved | undefined {
  // GW reserved (data center / power)
  const gwM = text.match(/(\d[\d,.]*)\s*gw\b(?:[\s-]*(?:reserv|capacity|power|datacenter|data center|baseload))/i);
  if (gwM) {
    return { unit: 'GW', amount: parseFloat(gwM[1].replace(/,/g, '')), raw_phrase: gwM[0] };
  }
  // MW reserved
  const mwM = text.match(/(\d[\d,.]*)\s*mw\b(?:[\s-]*(?:reserv|capacity|power|datacenter|data center|hyperscaler))/i);
  if (mwM) {
    return { unit: 'MW', amount: parseFloat(mwM[1].replace(/,/g, '')), raw_phrase: mwM[0] };
  }
  // CoWoS wafer per month
  const cowM = text.match(/(\d[\d,.]*)\s*(?:cowos\s+)?wafers?\s*(?:per month|\/mo|pm|monthly)/i);
  if (cowM && /cowos|advanced packaging/i.test(text)) {
    return { unit: 'CoWoS_wafer_pm', amount: parseFloat(cowM[1].replace(/,/g, '')), raw_phrase: cowM[0] };
  }
  // SWU (uranium enrichment)
  const swuM = text.match(/(\d[\d,.]*)\s*(?:tonnes?|metric tons?|kg)\s*(?:swu|enrichment|haleu)/i);
  if (swuM) {
    return { unit: 'SWU_tonnes', amount: parseFloat(swuM[1].replace(/,/g, '')), raw_phrase: swuM[0] };
  }
  // Transmission GW (grid)
  const tgwM = text.match(/(\d[\d,.]*)\s*gw\b.{0,30}(?:transmission|grid|t&d|hvdc)/i);
  if (tgwM) {
    return { unit: 'tcap_GW', amount: parseFloat(tgwM[1].replace(/,/g, '')), raw_phrase: tgwM[0] };
  }
  return undefined;
}

// 3. STRATEGIC DEPENDENCY SCORE — how hard is the company to replace? (1-5)
//
//   5 — extremely hard (LEU-style chokepoint, sole producer)
//   4 — very hard (TSMC CoWoS, ASML EUV, sub-3 global competitors)
//   3 — hard (Tier-1 specialist with ~5 competitors)
//   2 — moderate (generic specialist, 5-10 competitors)
//   1 — easy (commodity vendor, replaceable)

export function computeDependencyScore(args: {
  is_chokepoint_override?: boolean;
  theme?: StrategicTheme;
  counterparty_tier?: CounterpartyTier;
  title?: string;
  desc?: string;
}): { score: number; rationale: string } {
  const { is_chokepoint_override, theme, counterparty_tier, title = '', desc = '' } = args;
  const text = `${title} ${desc}`.toLowerCase();

  // Hard 5 — chokepoint override fired = sole producer
  if (is_chokepoint_override) {
    return { score: 5, rationale: 'Strategic chokepoint — sole / near-sole producer in critical chain.' };
  }
  // 4 — TSMC CoWoS / ASML EUV / NDFEB rare-earth named
  if (/\b(tsmc|asml|leu|haleu|euv|cowos exclusive|sub.?3 global)\b/i.test(text)) {
    return { score: 4, rationale: 'Sub-3 global competitors in this capability — very hard to replace.' };
  }
  // 3 — Tier-1 specialist + AI / Energy / Defense theme
  if (counterparty_tier === 'HYPERSCALER' || counterparty_tier === 'TIER1_GOV_DEFENSE') {
    if (theme === 'AI_INFRASTRUCTURE' || theme === 'DEFENSE_AEROSPACE' || theme === 'SEMI_SUPPLY_CHAIN') {
      return { score: 3, rationale: 'Tier-1 specialist with technical embedment in mission-critical theme.' };
    }
  }
  // 2 — moderate: hyperscaler relationship but commoditizable theme
  if (counterparty_tier === 'HYPERSCALER' || counterparty_tier === 'TOP3_UTILITY') {
    return { score: 2, rationale: 'Strategic counterparty but the capability has multiple suppliers.' };
  }
  return { score: 1, rationale: 'Replaceable — competitive market with multiple alternatives.' };
}

// 4. WHY-THIS-MATTERS per card
//    For each strategic-visibility article, generate a 1-line institutional
//    explanation: what constraint changed / who benefits / what gets delayed.

export function buildWhyThisMatters(args: {
  signal: StrategicVisibilitySignal;
  dependency_score: number;
}): string {
  const { signal, dependency_score } = args;
  const t = signal.theme;
  const cp = signal.counterparty_name || '—';
  const yrs = signal.visibility_years ?? 0;
  const val = signal.contract_value_usd_m;

  if (t === 'AI_INFRASTRUCTURE' || t === 'HYPERSCALER_LEASE' || t === 'NEOCLOUD_AI_INFRA') {
    return `Locks ${yrs}y AI compute capacity with ${cp}; supply tightens for non-reserved buyers; revenue base resets from cyclical to annuity. ${dependency_score >= 4 ? 'Counterparty cannot easily switch — pricing power.' : 'Watch for additional reservations from same counterparty.'}`;
  }
  if (t === 'ENERGY_TRANSITION' || t === 'POWER_GRID') {
    return `Multi-year ${cp} commitment de-risks earnings; pulls ${val ? `$${(val/1000).toFixed(1)}B` : 'capex'} forward in funding; downstream T&D / transformer / EPC vendors benefit. ${signal.is_chokepoint_override ? 'Strategic chokepoint — federal cumulative support adds duration.' : ''}`.trim();
  }
  if (t === 'DEFENSE_AEROSPACE') {
    return `Multi-year defence framework lifts order-book visibility 3-10y; reduces earnings cyclicality; PSU / private peers without similar wins lose share. ${dependency_score >= 4 ? 'Strategic embedment — switching cost very high.' : ''}`.trim();
  }
  if (t === 'SEMI_SUPPLY_CHAIN' || t === 'CRITICAL_NATIONAL_PROGRAM') {
    return `Strategic capacity reservation in semiconductor chain; downstream buyers face longer waits; this counterparty becomes critical-path supplier through ${yrs}y. ${signal.is_chokepoint_override ? 'Sole-source dependency.' : ''}`.trim();
  }
  if (t === 'QUANTUM_CRYPTO') {
    return `Pre-commercial program funding; revenue lift in 5-10y if technology commercialises; option-value play on quantum/crypto adoption.`;
  }
  return `${cp} commitment of ${val ? `$${val}M` : 'undisclosed size'} over ${yrs}y resets future revenue base. Watch for follow-on tranches.`;
}

// 5. SECOND-ORDER EFFECTS per card
//    Lists the downstream beneficiaries / losers from the framework.

export function buildSecondOrder(args: {
  theme: StrategicTheme;
  counterparty_name?: string;
  contract_value_usd_m?: number;
}): { beneficiaries: string[]; risk: string[] } {
  const { theme } = args;

  if (theme === 'AI_INFRASTRUCTURE' || theme === 'HYPERSCALER_LEASE' || theme === 'NEOCLOUD_AI_INFRA') {
    return {
      beneficiaries: ['Power equipment makers (GE Vernova / Eaton)', 'Cooling specialists (Vertiv / nVent)', 'Optical interconnect (Coherent / Lumentum)', 'HBM memory (Micron / Hynix)'],
      risk: ['Non-hyperscaler GPU buyers face longer wait times', 'Pricing power shifts to capacity holders', 'Smaller cloud players priced out'],
    };
  }
  if (theme === 'ENERGY_TRANSITION' || theme === 'POWER_GRID') {
    return {
      beneficiaries: ['Transformer / switchgear (BHEL / GEV / Hitachi)', 'Copper miners (uplift via grid demand)', 'EPC contractors (L&T / Quanta)'],
      risk: ['Non-IPP utilities face stranded asset risk if PPA terms shift', 'Long-tenor capex vendors face execution risk'],
    };
  }
  if (theme === 'DEFENSE_AEROSPACE') {
    return {
      beneficiaries: ['Tier-2 defence component suppliers', 'Titanium / nickel-alloy forge specialists', 'Aerospace MRO operators'],
      risk: ['PSU defence peers without orders lose share', 'Private-sector entrants face certification timeline drag'],
    };
  }
  if (theme === 'SEMI_SUPPLY_CHAIN') {
    return {
      beneficiaries: ['ABF substrate makers (Ajinomoto)', 'Specialty gas / photoresist (JSR / Tokyo Ohka)', 'Equipment makers (AMAT / LRCX)'],
      risk: ['Non-reserved fab customers face allocation queue', 'Commodity foundries face share loss'],
    };
  }
  if (theme === 'CRITICAL_NATIONAL_PROGRAM') {
    return {
      beneficiaries: ['Domestic supply-chain vendors aligned with policy', 'Sovereign-program-eligible contractors'],
      risk: ['Foreign vendors face market-access friction', 'Non-aligned suppliers lose pipeline'],
    };
  }
  return { beneficiaries: [], risk: [] };
}

// 6. CUMULATIVE FEDERAL TRACKER — for chokepoint companies
//    Estimates total federal awards + loans + price-floor offtakes over a
//    rolling 36/48-month window. Used for the chokepoint override.

export interface FederalCumulative {
  rolling_36m_usd_m: number;
  rolling_48m_usd_m: number;
  meets_36m_threshold: boolean;   // ≥ $250M
  meets_48m_threshold: boolean;   // ≥ $500M
  components: { source: string; amount_usd_m: number; date_iso: string }[];
}

// 7. OUTPUT FORMAT — matches user spec exactly
//    [Ticker] → [Contract size, program, counterparty]
//    ([Order date: YYYY-MM-DD] Impact: ...)
//    [Flags]

export function formatStrategicLine(args: {
  ticker: string;
  signal: StrategicVisibilitySignal;
  capacity?: CapacityReserved;
  dependency_score?: number;
  date_iso?: string;
  flags_str: string;
}): string {
  const { ticker, signal, capacity, date_iso, flags_str } = args;
  const sz = signal.contract_value_usd_m
    ? signal.contract_value_usd_m >= 1000 ? `$${(signal.contract_value_usd_m/1000).toFixed(1)}B` : `$${signal.contract_value_usd_m}M`
    : 'undisclosed';
  const cp = signal.counterparty_name || COUNTERPARTY_DISPLAY[signal.counterparty_tier] || '—';
  const dateStr = date_iso ? date_iso.slice(0, 10) : '—';
  const yrs = signal.visibility_years ?? 0;

  const themeLabel = THEME_DISPLAY[signal.theme] || signal.theme;
  const capStr = capacity ? `, ${capacity.amount}${capacity.unit.replace('_', ' ')}` : '';
  const pctMcap = signal.pct_of_mcap !== undefined ? ` / ${signal.pct_of_mcap}% mcap` : '';
  const pctRev = signal.pct_of_ltm_revenue !== undefined ? ` / ${signal.pct_of_ltm_revenue}% LTM rev` : '';

  return `${ticker} → ${sz}${capStr}, ${themeLabel}, ${cp} ([${dateStr}] Impact: ${yrs}y visibility${pctMcap}${pctRev}) ${flags_str}`;
}

