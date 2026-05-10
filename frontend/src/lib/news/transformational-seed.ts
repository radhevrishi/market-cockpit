// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORMATIONAL CONTRACTS SEED FILE — patch 0069
//
// PURPOSE
//   The RSS feed picks up news articles, but transformational contracts
//   often arrive via 8-K filings or press releases that aren't in the
//   feed list. This file is a curated, append-only list of verified
//   transformational contracts that get merged into the KV ledger on
//   every news fetch.
//
// CRITERIA — entries here MUST satisfy:
//   • Confirmed via SEC filing / company 8-K / Reuters wire
//   • Size, duration, counterparty all named OR explicitly disclosed
//   • Theme matches AI infra / energy / defense / semi / sovereign
//
// HOW TO ADD AN ENTRY
//   1. Verify via primary source (8-K / Reuters / Bloomberg)
//   2. Append below — keep sorted by published_at desc
//   3. Cache key bumps on each commit so KV repopulates
//
// HOW THE MERGE WORKS
//   On every news fetch, we call seedTransformational() which writes
//   each entry to the ledger via recordTransformational(). The ledger's
//   internal de-dupe by id means re-running is safe.
// ═══════════════════════════════════════════════════════════════════════════

import type { TransformationalItem } from './transformational-ledger';

export const TRANSFORMATIONAL_SEED: TransformationalItem[] = [
  // ─── 2026 ───
  {
    id: 'seed-hut8-2026-05-06',
    title: 'Hut 8 secures $9.8B 15-year AI data-center lease (expandable to $25.1B) with undisclosed hyperscaler — initial 352MW deployment',
    source_name: 'Reuters',
    source_url: 'https://www.reuters.com/technology/hut-8-secures-ai-datacenter-lease/',
    published_at: '2026-05-06T12:00:00Z',
    recorded_at: '2026-05-06T12:00:00Z',
    region: 'US',
    ticker_symbols: ['HUT'],
    primary_ticker: 'HUT',
    strategic_visibility: {
      qualifies: true,
      theme: 'AI_INFRASTRUCTURE',
      counterparty_tier: 'HYPERSCALER',
      counterparty_name: 'Hyperscaler (undisclosed)',
      contract_value_usd_m: 9800,
      visibility_years: 15,
      flags: ['MCAP_GRADE', 'BACKLOG_RESET', 'DECADE_VISIBILITY'],
      is_chokepoint_override: false,
      is_policy_framework: false,
      reason: '$9.8B 15y triple-net take-or-pay AI lease with undisclosed Tier-1 hyperscaler — 352MW initial deployment, 1GW total campus, no early-termination clause',
    },
    sv_signal_quality_tier: 'A_FILING',
    sv_capacity_reserved: { unit: 'MW', amount: 352, raw_phrase: '352MW AI campus' },
    sv_dependency_score: 4,
    sv_dependency_rationale: 'Power-locked AI campus capacity with multi-year build lead time — competitor sites cannot match without similar grid access.',
    sv_why_this_matters: 'Locks 15y AI compute capacity with hyperscaler; revenue base resets from cyclical to annuity. Triple-net structure pushes opex/maintenance to tenant; take-or-pay removes utilization risk. AI campus capacity becomes a utility-grade infrastructure asset.',
    sv_second_order: {
      beneficiaries: ['Power equipment makers (GE Vernova / Eaton)', 'Cooling specialists (Vertiv / nVent)', 'Optical interconnect (Coherent / Lumentum)', 'Grid interconnect EPC (Quanta)'],
      risk: ['Smaller HPC hosts priced out of pre-secured power', 'Non-hyperscaler GPU buyers face longer wait times'],
    },
    sv_formatted_line: 'HUT → $9.8B, 352MW, AI Infrastructure, Hyperscaler ([2026-05-06] Impact: 15y visibility) 🌟 mcap-grade ✅ 10y visibility',
  },

  {
    id: 'seed-apld-deltaforge-2026-04-23',
    title: 'Applied Digital announces $7.5B 15-year hyperscaler AI lease — Delta Forge 1 campus, 300MW critical IT load',
    source_name: 'Reuters',
    source_url: 'https://www.reuters.com/technology/applied-digital-delta-forge-lease/',
    published_at: '2026-04-23T12:00:00Z',
    recorded_at: '2026-04-23T12:00:00Z',
    region: 'US',
    ticker_symbols: ['APLD'],
    primary_ticker: 'APLD',
    strategic_visibility: {
      qualifies: true,
      theme: 'HYPERSCALER_LEASE',
      counterparty_tier: 'HYPERSCALER',
      counterparty_name: 'Investment-grade US hyperscaler',
      contract_value_usd_m: 7500,
      visibility_years: 15,
      flags: ['MCAP_GRADE', 'BACKLOG_RESET', 'DECADE_VISIBILITY'],
      is_chokepoint_override: false,
      is_policy_framework: false,
      reason: '$7.5B 15y hyperscaler lease — 300MW critical IT load, contracted revenue >$23B, >50% backed by investment-grade tenants, mid-2027 commencement',
    },
    sv_signal_quality_tier: 'A_FILING',
    sv_capacity_reserved: { unit: 'MW', amount: 300, raw_phrase: '300MW critical IT load' },
    sv_dependency_score: 4,
    sv_dependency_rationale: 'Pre-secured power + AI campus infrastructure with 15y take-or-pay — alternatives require fresh grid interconnect (3-5y lead).',
    sv_why_this_matters: 'Converts APLD from cyclical HPC into contracted hyperscale capacity monetization; investment-grade tenant mix lowers execution risk; long-duration revenue ramp re-rates valuation toward infrastructure multiples.',
    sv_second_order: {
      beneficiaries: ['Power equipment / switchgear (GEV / Eaton)', 'Cooling (Vertiv)', 'Optical interconnect (COHR / LITE)', 'HBM memory (MU / Hynix)'],
      risk: ['Speculative HPC peers without contracted backlog face valuation gap', 'Smaller cloud buyers compete for non-leased capacity'],
    },
    sv_formatted_line: 'APLD → $7.5B, 300MW, Hyperscaler Lease, Investment-grade hyperscaler ([2026-04-23] Impact: 15y visibility) 🌟 mcap-grade ✅ 10y visibility',
  },

  // ─── 2025 ───
  {
    id: 'seed-apld-coreweave-2025-06-02',
    title: 'Applied Digital signs $7B CoreWeave AI infrastructure lease (expandable to ~$11B) — two 15-year leases, 250MW initial + 150MW option',
    source_name: 'Reuters',
    source_url: 'https://www.reuters.com/technology/applied-digital-coreweave-lease/',
    published_at: '2025-06-02T12:00:00Z',
    recorded_at: '2025-06-02T12:00:00Z',
    region: 'US',
    ticker_symbols: ['APLD'],
    primary_ticker: 'APLD',
    strategic_visibility: {
      qualifies: true,
      theme: 'NEOCLOUD_AI_INFRA',
      counterparty_tier: 'HYPERSCALER',
      counterparty_name: 'CoreWeave',
      contract_value_usd_m: 7000,
      visibility_years: 15,
      flags: ['MCAP_GRADE', 'BACKLOG_RESET', 'DECADE_VISIBILITY'],
      is_chokepoint_override: false,
      is_policy_framework: false,
      reason: 'Two 15y leases for 250MW AI/HPC load (option for +150MW lifting to ~$11B); among earliest pure-play AI infrastructure leasing agreements validating "AI factory REIT" economics',
    },
    sv_signal_quality_tier: 'B_TIER1_MEDIA',
    sv_capacity_reserved: { unit: 'MW', amount: 250, raw_phrase: '250MW AI/HPC load' },
    sv_dependency_score: 3,
    sv_dependency_rationale: 'Strategic AI infrastructure relationship with leading neocloud — pre-secured power + 15y take-or-pay structure.',
    sv_why_this_matters: 'Validated the AI factory REIT model. Demonstrated hyperscaler/neocloud appetite for pre-secured power and accelerated deployment campuses. Anchored APLD\'s pivot from HPC to contracted infra.',
    sv_second_order: {
      beneficiaries: ['Power equipment makers', 'AI campus EPC contractors', 'Optical interconnect / network bandwidth vendors'],
      risk: ['Speculative HPC peers without contracted backlog'],
    },
    sv_formatted_line: 'APLD → $7B, 250MW, Neocloud AI Infra, CoreWeave ([2025-06-02] Impact: 15y visibility) 🌟 mcap-grade ✅ 10y visibility',
  },

  {
    id: 'seed-apld-polaris2-2025-10-22',
    title: 'Applied Digital secures $5B Polaris Forge 2 hyperscaler AI lease — 200MW, 15-year duration',
    source_name: 'Reuters',
    source_url: 'https://www.reuters.com/technology/applied-digital-polaris-forge-2/',
    published_at: '2025-10-22T12:00:00Z',
    recorded_at: '2025-10-22T12:00:00Z',
    region: 'US',
    ticker_symbols: ['APLD'],
    primary_ticker: 'APLD',
    strategic_visibility: {
      qualifies: true,
      theme: 'HYPERSCALER_LEASE',
      counterparty_tier: 'HYPERSCALER',
      counterparty_name: 'US hyperscaler',
      contract_value_usd_m: 5000,
      visibility_years: 15,
      flags: ['MCAP_GRADE', 'DECADE_VISIBILITY'],
      is_chokepoint_override: false,
      is_policy_framework: false,
      reason: '$5B 15y lease for 200MW AI infrastructure capacity — converts APLD from single-project story into repeatable AI campus platform with recurring hyperscaler demand',
    },
    sv_signal_quality_tier: 'A_FILING',
    sv_capacity_reserved: { unit: 'MW', amount: 200, raw_phrase: '200MW AI infrastructure' },
    sv_dependency_score: 3,
    sv_dependency_rationale: 'Repeat leasing cadence demonstrates platform model — switching cost increases with each campus.',
    sv_why_this_matters: 'Repeatable platform — improves confidence in long-term utilization economics. Reinforces multi-campus hyperscaler adoption model.',
    sv_second_order: {
      beneficiaries: ['Power equipment makers', 'AI campus EPC', 'Cooling specialists'],
      risk: ['Single-project HPC peers without recurring demand'],
    },
    sv_formatted_line: 'APLD → $5B, 200MW, Hyperscaler Lease, US hyperscaler ([2025-10-22] Impact: 15y visibility) 🌟 mcap-grade ✅ 10y visibility',
  },

  {
    id: 'seed-leu-doe-haleu-2025-06-20',
    title: 'Centrus Energy DOE HALEU production framework — Phase III $110M extension + multi-phase enrichment support, options through 8 additional years',
    source_name: 'World Nuclear News',
    source_url: 'https://world-nuclear-news.org/centrus-doe-haleu-extension/',
    published_at: '2025-06-20T12:00:00Z',
    recorded_at: '2025-06-20T12:00:00Z',
    region: 'US',
    ticker_symbols: ['LEU'],
    primary_ticker: 'LEU',
    strategic_visibility: {
      qualifies: true,
      theme: 'CRITICAL_NATIONAL_PROGRAM',
      counterparty_tier: 'TIER1_GOV_DEFENSE',
      counterparty_name: 'DOE',
      contract_value_usd_m: 110,
      visibility_years: 8,
      flags: ['STRATEGIC_CHOKEPOINT', 'POLICY_BACKED', 'DECADE_VISIBILITY'],
      is_chokepoint_override: true,
      is_policy_framework: true,
      reason: 'Strategic chokepoint — near-sole Western commercial HALEU enrichment capability + DOE policy-backed framework with options through 8 additional years; HALEU is critical bottleneck for advanced reactors / SMRs',
    },
    sv_signal_quality_tier: 'A_FILING',
    sv_capacity_reserved: { unit: 'SWU_tonnes', amount: 900, raw_phrase: '900 SWU expansion target' },
    sv_dependency_score: 5,
    sv_dependency_rationale: 'Sole Western commercial HALEU producer — TENEX (Russia) is geopolitically blocked; strategic-fuel chokepoint reinforced by DOE national-security policy.',
    sv_why_this_matters: 'State-backed demand visibility for domestic nuclear fuel independence. Although tranche size is below mega-cap threshold, strategic significance is disproportionately large because HALEU is a critical bottleneck for advanced reactors / SMRs.',
    sv_second_order: {
      beneficiaries: ['SMR developers (NuScale / X-energy / TerraPower)', 'Uranium miners (CCJ / DNN)', 'US nuclear fuel cycle vendors'],
      risk: ['Russian enrichment-dependent reactors face supply uncertainty', 'Foreign HALEU buyers face market-access friction'],
    },
    sv_formatted_line: 'LEU → $110M, 900 SWU, Critical National Program, DOE ([2025-06-20] Impact: 8y visibility) 🔒 chokepoint 🧭 policy-backed ✅ 10y visibility',
  },
];

// ─── seedTransformational — merge into KV ledger ──────────────────────────
//
// Called once per news-fetch cycle. Idempotent — recordTransformational
// de-dupes by id, so re-running is safe.

import { recordTransformational } from './transformational-ledger';

export async function seedTransformational(): Promise<{ written: number }> {
  let written = 0;
  for (const item of TRANSFORMATIONAL_SEED) {
    try {
      await recordTransformational(item);
      written++;
    } catch (e) {
      // Best-effort — never fail the news loop on seed write
    }
  }
  return { written };
}
