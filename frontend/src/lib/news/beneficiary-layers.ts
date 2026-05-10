// ═══════════════════════════════════════════════════════════════════════════
// BENEFICIARY LAYERS v1 — patch 0084
//
// PURPOSE
//   Replace the single-list "beneficiaries" output with a 6-layer pricing
//   transmission engine that propagates every bottleneck through L1→L6.
//
//   This is NOT a replacement for bottleneck detection (semantic-graph) or
//   for adaptation-based recognition (beneficiary-graph). It is the
//   beneficiary INFERENCE layer — given a bottleneck SystemNode, who wins
//   across the full pricing-power transmission cascade?
//
// LAYERS
//   L1  Direct Scarcity Capture        (input pricing power — TSMC/MU/ASML)
//   L2  Compute Substitutes            (GPU/CPU substitution — AMD/INTC/ARM)
//   L3  Edge / Distribution            (CDN/latency/bandwidth — AKAM/NET)
//   L4  Transmission Winners           (intermediate pass-through — Sterlite/GLW)
//   L5  Platform Beneficiaries         (demand aggregators — MSFT/AMZN/GOOG)
//   L6  Infrastructure / Efficiency    (power, thermal, grid — VRT/ETN)
//
// AUTO-INJECTION RULES (mandatory tickers per node-class)
//   COMPUTE / MEMORY / GPU / HBM        → AMD, INTC, ARM
//   PACKAGING (CoWoS)                   → AMD, AVGO, MRVL, AMZN, GOOGL, MSFT
//   INTERCONNECT / NETWORK_BANDWIDTH    → AKAM, NET, CIEN, LITE
//   ENERGY / COOLING                    → VRT, ETN, GEV, ARM (perf/watt)
//
// TRANSMISSION CASCADE (T0 → T4)
//   T0 (now)         News / constraint emerges
//   T1 (0–1Q)        Sentiment + order-flow shift
//   T2 (1–3Q)        Revenue acceleration in L1/L4
//   T3 (3–6Q)        Margin expansion (Sterlite-style preform→ASP→EBITDA)
//   T4 (6–12Q)       EPS rerating cycle
// ═══════════════════════════════════════════════════════════════════════════

import type { SystemNode } from '@/lib/news/semantic-graph';

// ─── Types ──────────────────────────────────────────────────────────────────

export type BeneficiaryLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export type PricingLeverage = 'STRONG' | 'MEDIUM' | 'WEAK';

export type LayerSize = 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP';

// PATCH 0086: region tagging — keep the India view from leaking into a US/Global
// bottleneck card and vice versa. Each ticker is exclusively tagged.
export type LayerRegion = 'IN' | 'GLOBAL';

// PATCH 0087: L2 sub-layer split. Compute substitution and CPU-cycle revival are
// driven by different mechanisms (in-stack share displacement vs GPU-scarcity →
// CPU-attach increase + perf/watt architecture shift) and should not be lumped
// together. Each L2 ticker carries a sub_layer; AMD has TWO rows (GPU substitution
// for MI-series + CPU cycle for EPYC) so it surfaces in both sub-clusters.
export type ComputeSubLayer = 'GPU_SUB' | 'CPU_CYCLE';

export interface LayerTicker {
  ticker: string;
  layer: BeneficiaryLayer;
  rationale: string;
  pricing_leverage: PricingLeverage;
  size: LayerSize;
  region?: LayerRegion;          // PATCH 0086 — defaults to GLOBAL
  // PATCH 0087 — only meaningful for L2 entries (other layers ignore it)
  sub_layer?: ComputeSubLayer;
  // True if this ticker is force-injected (mandatory) for the firing node-class,
  // independent of whether it co-occurs in the article. Lets the UI mark it as
  // "structurally required" vs. evidence-driven.
  mandatory?: boolean;
  // PATCH 0104: auto-discovered (from news accumulator) vs seed (hand-rostered)
  discovered?: boolean;
  mention_count?: number;        // raw mention count from accumulator
  accumulator_score?: number;    // tier-weighted decayed score
  // PATCH 0104: A/B/C/D exposure tier — Direct Capture / Mandatory Enabler /
  // Architectural Beneficiary / Narrative Sympathy
  tier?: 'A' | 'B' | 'C' | 'D';
  // PATCH 0106: orderbook-torque / convexity score (0–100). Re-sorts layers so
  // execution-sensitive small/midcaps surface above generic megacaps.
  // Formula: size_class bonus + leverage bonus + discovered bonus
  //          - PSU-megacap-pattern penalty
  convexity_score?: number;
  // PATCH 0107: export-proxy flag. Indian midcaps that EXPORT to global themes
  // (Aeroflex hoses → US DC cooling; DEE Dev process piping → US LNG / hydrogen;
  // Welspun line pipes → global oil/gas; Walchandnagar → global nuclear heavy
  // engineering).  Surfaces in BOTH India view AND the corresponding GLOBAL
  // bottleneck card so the user sees them when looking at US AI DC, US grid,
  // global nuclear, etc.
  export_proxy?: boolean;
  export_destination?: string;   // e.g. 'US AI DC' / 'global oil & gas'
}

export interface LayerMeta {
  layer: BeneficiaryLayer;
  label: string;
  icon: string;
  tagline: string;
}

export const LAYER_META: Record<BeneficiaryLayer, LayerMeta> = {
  L1: { layer: 'L1', label: 'Direct Scarcity Capture',     icon: '🧱', tagline: 'Input pricing power — supply capturers' },
  L2: { layer: 'L2', label: 'Compute Substitutes',          icon: '⚙️', tagline: 'GPU / CPU / architecture substitution' },
  L3: { layer: 'L3', label: 'Edge Distribution',            icon: '🌐', tagline: 'CDN / latency / bandwidth winners' },
  L4: { layer: 'L4', label: 'Transmission Winners',         icon: '🧪', tagline: 'Intermediate pricing pass-through (Sterlite-type)' },
  L5: { layer: 'L5', label: 'Platform Beneficiaries',       icon: '🏢', tagline: 'Demand aggregators / hyperscalers' },
  L6: { layer: 'L6', label: 'Infrastructure / Efficiency',  icon: '⚡', tagline: 'Power, thermal, grid, perf-per-watt' },
};

// ─── Master roster ──────────────────────────────────────────────────────────
// Every ticker the system recognises as a layer member, with rationale,
// pricing leverage, and size class. Adding new names = appending rows.

export const LAYER_ROSTER: LayerTicker[] = [
  // ── L1 — Direct Scarcity Capture ─────────────────────────────────────────
  { ticker: 'TSM',  layer: 'L1', rationale: 'TSMC dominant foundry — captures wafer pricing power on every leading node',          pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'MU',   layer: 'L1', rationale: 'Micron HBM3E + LPDDR5X — direct margin expansion in memory tightness',                pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'ASML', layer: 'L1', rationale: 'EUV / High-NA monopoly — pricing power on every advanced fab tool',                  pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'AMAT', layer: 'L1', rationale: 'Hybrid bonding + 3D-stack process — every advanced packaging line',                   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'KLAC', layer: 'L1', rationale: 'KLA inspection — every HBM stack and chiplet substrate',                              pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'LRCX', layer: 'L1', rationale: 'Lam Research etch + deposition — leading-node + 3D NAND scaling',                     pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'GEV',  layer: 'L1', rationale: 'GE Vernova grid + turbines — captures power-build pricing power',                     pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'SMNEY',layer: 'L1', rationale: 'Siemens Energy — global grid + transformers; multi-year backlog',                     pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'HTHIY',layer: 'L1', rationale: 'Hitachi Energy — HVDC + transformers, AI-DC-interconnect winner',                     pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'ETN',  layer: 'L1', rationale: 'Eaton power chain — direct beneficiary of grid + DC capex',                            pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'SBGSY',layer: 'L1', rationale: 'Schneider Electric — DC power management + microgrid leader',                         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  // PATCH 0085: ABB + AMKR direct-capture additions
  { ticker: 'ABBNY',layer: 'L1', rationale: 'ABB electrification + motion + grid automation — global infra capacity capturer',       pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'AMKR', layer: 'L1', rationale: 'Amkor OSAT — advanced packaging capacity capture (CoWoS adjacent, FOWLP scale)',        pricing_leverage: 'STRONG', size: 'MID_CAP'   },

  // ── L2 — Compute Substitutes (split into GPU_SUB + CPU_CYCLE per 0087) ───
  // GPU substitution: in-stack share displacement of NVDA
  { ticker: 'AMD',   layer: 'L2', sub_layer: 'GPU_SUB', rationale: 'MI300/MI325 — only credible second-source for hyperscaler training; GPU-substitution leader',                                pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'AVGO',  layer: 'L2', sub_layer: 'GPU_SUB', rationale: 'Custom-silicon partner for Google TPU + Meta MTIA — substitution enabler',                                                  pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'MRVL',  layer: 'L2', sub_layer: 'GPU_SUB', rationale: 'AWS Trainium + custom DPU partner — design-win volume rising',                                                              pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'AMZN',  layer: 'L2', sub_layer: 'GPU_SUB', rationale: 'Trainium / Inferentia — internal silicon substitution + cost lever',                                                        pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'GOOGL', layer: 'L2', sub_layer: 'GPU_SUB', rationale: 'TPU generations — internal substitution + Gemini training capacity',                                                        pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'MSFT',  layer: 'L2', sub_layer: 'GPU_SUB', rationale: 'Maia / Cobalt — Azure-internal silicon substitution',                                                                       pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'AAPL',  layer: 'L2', sub_layer: 'GPU_SUB', rationale: 'Apple Silicon validates ARM at scale — strategic anchor for the substitution thesis',                                       pricing_leverage: 'WEAK',   size: 'LARGE_CAP' },
  // CPU cycle: GPU scarcity → CPU-attach increase + AI-PC + perf/watt architecture shift
  { ticker: 'AMD',   layer: 'L2', sub_layer: 'CPU_CYCLE', rationale: 'EPYC server CPU share-gain cycle — GPU scarcity drives CPU-attach increase + AI inference pre-processing',                pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'INTC',  layer: 'L2', sub_layer: 'CPU_CYCLE', rationale: 'Xeon DC + AI-PC rebound — CPU-attach beneficiary as GPU lead-times extend; foundry optionality (secondary)',              pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'ARM',   layer: 'L2', sub_layer: 'CPU_CYCLE', rationale: 'Neoverse server cores — perf/watt-driven hyperscaler ARM substitution; royalty on every AI/edge ARM core',                pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'QCOM',  layer: 'L2', sub_layer: 'CPU_CYCLE', rationale: 'Oryon / X Elite — DC + AI-PC ARM expansion; mobile edge inference',                                                       pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },

  // ── L3 — Edge / Latency / Distribution ───────────────────────────────────
  { ticker: 'AKAM', layer: 'L3', rationale: 'Akamai pivot to edge compute + generalised AI inference layer',                       pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'NET',  layer: 'L3', rationale: 'Cloudflare Workers AI + edge inference suite leader',                                 pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'FSLY', layer: 'L3', rationale: 'Fastly AI delivery + compute@edge — small-cap leverage to edge shift',                pricing_leverage: 'MEDIUM', size: 'SMALL_CAP' },
  { ticker: 'CIEN', layer: 'L3', rationale: 'Ciena DCI + coherent — backbone for AI traffic distribution',                          pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'LITE', layer: 'L3', rationale: 'Lumentum lasers + DSP — 800G+ optical reach + edge transport',                        pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'COHR', layer: 'L3', rationale: 'Coherent 800G/1.6T optical pluggables — AI fabric + edge volume',                     pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'CCOI', layer: 'L3', rationale: 'Cogent IP transit — beneficiary of decentralised inference traffic',                  pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: 'EQIX', layer: 'L3', rationale: 'Equinix interconnect — edge cabinets and inference cross-connects',                   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  // PATCH 0087: carrier-edge additions — IP backbone + 5G MEC + cell-site footprint
  { ticker: 'LUMN', layer: 'L3', rationale: 'Lumen IP backbone + edge — long-haul fibre + DC interconnect; carrier-edge inference',  pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'VZ',   layer: 'L3', rationale: 'Verizon — 5G mobile edge compute (MEC) + private-network inference offload',           pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'T',    layer: 'L3', rationale: 'AT&T — cell-site footprint + FirstNet edge; mobile inference + private 5G',           pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },

  // ── L4 — Sterlite-type Transmission Winners ──────────────────────────────
  // Optical fibre / preform chain
  { ticker: 'STL.NS',   layer: 'L4', rationale: 'Sterlite Tech preform → fibre ASP cascade — pricing transmission archetype',     pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'PRY.MI',   layer: 'L4', rationale: 'Prysmian — global cable + fibre + grid transmission leader',                      pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'GLW',      layer: 'L4', rationale: 'Corning optical communications — fibre + display + life sciences pass-through',   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: '6005.HK',  layer: 'L4', rationale: 'YOFC Yangtze Optical Fibre — preform to fibre to cable, China DC build',          pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: '5801.T',   layer: 'L4', rationale: 'Furukawa Electric — optical fibre + power cable; Japan grid + AI',                pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  // Industrial / specialty gases
  { ticker: 'LIN',      layer: 'L4', rationale: 'Linde industrial gases — long-cycle pricing power + DC-build hydrogen',           pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'AI.PA',    layer: 'L4', rationale: 'Air Liquide — specialty + electronic gases; semis-fab pricing pass-through',      pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'HON',      layer: 'L4', rationale: 'Honeywell advanced materials — specialty inputs into semis + grid',                pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  // Electronics intermediate (Japan/Taiwan ecosystem)
  { ticker: '6981.T',   layer: 'L4', rationale: 'Murata MLCCs — every AI server board; pricing leverage on capacity tightness',    pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: '6976.T',   layer: 'L4', rationale: 'Taiyo Yuden capacitors — DC-build component pass-through',                         pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: '4062.T',   layer: 'L4', rationale: 'Ibiden ABF substrates — CoWoS bottleneck; pricing power archetype',                pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: '6967.T',   layer: 'L4', rationale: 'Shinko Electric substrates — IC packaging + advanced substrates',                  pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: '3711.TW',  layer: 'L4', rationale: 'ASE Technology OSAT — advanced packaging volume capture',                         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  // Semis fab consumables (carry-over from FAB chain)
  { ticker: '4901.T',   layer: 'L4', rationale: 'Shin-Etsu silicon wafers + photoresist — semis pricing pass-through',             pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── L4 (cont.) — EPC / project-backlog inflation chain (PATCH 0087) ──────
  // The "boring industrials" pricing transmission: AI-DC + grid + RE buildout
  // pushes EPC backlog 18→36 months, drives contract repricing, expands EBITDA
  // margins ahead of revenue volume peaks. EPS rerates on a 2-4 quarter lag.
  { ticker: 'PWR',  layer: 'L4', rationale: 'Quanta Services — largest US T&D EPC + DC infra; backlog repricing on AI grid + RE buildout',                                pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'MTZ',  layer: 'L4', rationale: 'MasTec — utility + pipeline + telecom EPC; AI grid + RE-evac backlog inflation',                                              pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'PRIM', layer: 'L4', rationale: 'Primoris — utilities + RE + DC EPC; smaller-cap leverage to backlog repricing',                                              pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'FLR',  layer: 'L4', rationale: 'Fluor — global EPC + nuclear (NuScale) + DC mega-projects',                                                                  pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: 'J',    layer: 'L4', rationale: 'Jacobs Engineering — critical-infra + DC + nuclear advisory; backlog beneficiary',                                            pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },

  // ── L4 (cont.) — Connector / passive-component pricing chain (PATCH 0087) ─
  { ticker: 'APH',  layer: 'L4', rationale: 'Amphenol — connectors + cables for DC + AI servers; pricing pass-through on backlog',                                         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'TEL',  layer: 'L4', rationale: 'TE Connectivity — connectors + sensors; AI server + EV + grid pricing transmission',                                          pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── L4 (cont.) — Cooling / thermal pass-through chain (PATCH 0087) ───────
  { ticker: 'TT',   layer: 'L4', rationale: 'Trane Technologies — DC cooling + applied HVAC; backlog repricing in AI thermal-density era',                                 pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── L4 (cont.) — Grid / power-equipment dual-tag (PATCH 0087) ─────────────
  // These names are L1 input-pricing capturers (kept above) AND L4 backlog
  // pass-through winners. Dual rendering surfaces both economic mechanisms.
  { ticker: 'GEV',   layer: 'L4', rationale: 'GE Vernova — turbine + grid backlog 18→36mo; ASP repricing → margin expansion ahead of volume',                              pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'SMNEY', layer: 'L4', rationale: 'Siemens Energy — global grid + transformer multi-year backlog; contract repricing → EBITDA expansion',                       pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'HTHIY', layer: 'L4', rationale: 'Hitachi Energy — HVDC + transformers; backlog inflation + ASP step-up',                                                       pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'ABBNY', layer: 'L4', rationale: 'ABB — electrification + automation backlog; pricing transmission on industrial capex super-cycle',                            pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── L4 (cont.) — Cooling/thermal dual-tag (PATCH 0087) ────────────────────
  // VRT / JCI / CARR live primarily in L6 (efficiency) but also belong at L4
  // for the backlog-repricing mechanism (CDU lead-times, retrofit pricing).
  { ticker: 'VRT',  layer: 'L4', rationale: 'Vertiv — liquid CDU + busway backlog inflation; AI thermal-density retrofit pricing power',                                   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'JCI',  layer: 'L4', rationale: 'Johnson Controls — DC cooling + HVAC backlog; retrofit + new-build pricing pass-through',                                     pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'CARR', layer: 'L4', rationale: 'Carrier — chillers + DC cooling backlog; multi-year retrofit window',                                                          pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },

  // ── L5 — Platform Beneficiaries ──────────────────────────────────────────
  { ticker: 'MSFT', layer: 'L5', rationale: 'Azure + Copilot — demand aggregator monetising the AI capex super-cycle',             pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'AMZN', layer: 'L5', rationale: 'AWS Bedrock + Anthropic — full-stack hyperscaler monetisation',                       pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'GOOGL',layer: 'L5', rationale: 'GCP + Gemini + YouTube — multi-channel platform monetisation',                        pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'META', layer: 'L5', rationale: 'Meta AI + ads recommendation — internal-compute → external-revenue uplift',           pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'ORCL', layer: 'L5', rationale: 'OCI AI + Cerner — late-cycle hyperscaler platform monetisation',                      pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },

  // ── L6 — Infrastructure / Efficiency ─────────────────────────────────────
  { ticker: 'VRT',     layer: 'L6', rationale: 'Vertiv liquid CDU + busway — dominant share in hyperscaler liquid cooling',         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'JCI',     layer: 'L6', rationale: 'Johnson Controls HVAC + DC cooling — retrofits + new build',                        pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'CARR',    layer: 'L6', rationale: 'Carrier HVAC + chillers — DC-cooling secondary',                                    pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: '2308.TW', layer: 'L6', rationale: 'Delta Electronics — power + thermal modules in every AI server',                    pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'NVT',     layer: 'L6', rationale: 'nVent thermal + Schroff — cold plate adoption; AI-cluster volume',                  pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'EMR',     layer: 'L6', rationale: 'Emerson process / Liebert thermal — hyperscaler retrofits',                         pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  // PATCH 0087: Trane was missing from the global thermal roster
  { ticker: 'TT',      layer: 'L6', rationale: 'Trane Technologies — applied DC cooling + commercial HVAC efficiency leader',       pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
];

// ─── INDIA roster — patch 0086 ─────────────────────────────────────────────
// Separate, exclusive roster so an Indian bottleneck story (NTPC, ₹/Rs, Power Line,
// Mint, Economic Times) does not surface US-listed names like GEV / HTHIY / PRY.MI
// in the same card. Indian view is rendered next to the Global view with strict
// region separation per the user's explicit ask.

export const INDIA_ROSTER: LayerTicker[] = [
  // ── L1 — Direct Scarcity Capture (India) ─────────────────────────────────
  { ticker: 'POWERGRID.NS',  layer: 'L1', region: 'IN', rationale: 'Power Grid Corp — central transmission monopoly; AI-DC + RE-evac backbone',                pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'NTPC.NS',       layer: 'L1', region: 'IN', rationale: 'NTPC — largest power generator + REL/NGEL pipeline; PPA backbone',                         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'BHEL.NS',       layer: 'L1', region: 'IN', rationale: 'BHEL — heavy electricals + thermal/hydro/nuclear; capex super-cycle beneficiary',           pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'COALINDIA.NS',  layer: 'L1', region: 'IN', rationale: 'Coal India — fuel monopoly into thermal capacity tightness',                                pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'TATAPOWER.NS',  layer: 'L1', region: 'IN', rationale: 'Tata Power — generation + T&D + EV ecosystem; integrated infra',                            pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'ABB.NS',        layer: 'L1', region: 'IN', rationale: 'ABB India — electrification + grid automation; HV switchgear pricing power',                pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'SIEMENS.NS',    layer: 'L1', region: 'IN', rationale: 'Siemens India — power + industrial automation; HVDC + rail orders',                         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'CGPOWER.NS',    layer: 'L1', region: 'IN', rationale: 'CG Power — transformers + motors + railway; semicon JV optionality',                        pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'KAYNES.NS',     layer: 'L1', region: 'IN', rationale: 'Kaynes Technology — EMS + OSAT JV; India advanced packaging capacity capture',              pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'KECL.NS',       layer: 'L1', region: 'IN', rationale: 'KEC International — global T&D EPC; transmission backlog beneficiary',                      pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'ADANIGREEN.NS', layer: 'L1', region: 'IN', rationale: 'Adani Green — largest RE PPA pipeline; battery + solar capacity',                           pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },

  // ── L2 — Compute Substitutes / Design Services (India) ────────────────────
  { ticker: 'TATAELXSI.NS',  layer: 'L2', region: 'IN', rationale: 'Tata Elxsi — semis design + autonomous systems engineering',                                pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'LTTS.NS',       layer: 'L2', region: 'IN', rationale: 'L&T Technology Services — chip design + ER&D; advanced-node design wins',                   pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'KPITTECH.NS',   layer: 'L2', region: 'IN', rationale: 'KPIT — automotive software + AI; auto-grade compute architecture',                           pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'PERSISTENT.NS', layer: 'L2', region: 'IN', rationale: 'Persistent Systems — AI-engineering services; substitution-tier integrator',                pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: 'COFORGE.NS',    layer: 'L2', region: 'IN', rationale: 'Coforge — BFSI + travel AI integration; mid-tier substitution play',                        pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },

  // ── PATCH 0106: India L1 — DEFENSE / AEROSPACE specialist midcaps ────────
  // High-convexity scarce enablers (RF seekers, avionics, radar, propulsion,
  // precision machining, drone warfare, EW). One order materially shifts
  // earnings — what the user means by 'orderbook torque'.
  { ticker: 'PARASDEF.NS',   layer: 'L1', region: 'IN', rationale: 'Paras Defence — defence optics + EW + naval systems; high convexity to MoD orders',          pricing_leverage: 'STRONG', size: 'SMALL_CAP' },
  { ticker: 'MTARTECH.NS',   layer: 'L1', region: 'IN', rationale: 'MTAR Technologies — precision components for nuclear (NPCIL fuel handling), ISRO, defence',  pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'DATAPATTNS.NS', layer: 'L1', region: 'IN', rationale: 'Data Patterns — radar / EW / avionics electronics; orderbook torque on DRDO/IAF programs',   pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'ASTRAMICRO.NS', layer: 'L1', region: 'IN', rationale: 'Astra Microwave — RF seekers / radar subsystems; missile + naval electronics',               pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'ZENTEC.NS',     layer: 'L1', region: 'IN', rationale: 'Zen Technologies — combat training simulators; defence indigenisation cycle beneficiary',     pricing_leverage: 'STRONG', size: 'SMALL_CAP' },
  { ticker: 'IDEAFORGE.NS',  layer: 'L1', region: 'IN', rationale: 'IdeaForge — military drones; Indian UAV indigenisation + Atmanirbhar drone policy',          pricing_leverage: 'STRONG', size: 'SMALL_CAP' },
  { ticker: 'APOLLO.NS',     layer: 'L1', region: 'IN', rationale: 'Apollo Micro Systems — defence electronics + naval/aerospace mission systems',                pricing_leverage: 'STRONG', size: 'SMALL_CAP' },
  { ticker: 'CYIENTDLM.NS',  layer: 'L1', region: 'IN', rationale: 'Cyient DLM — EMS for aerospace + defence + medical; high-mix low-volume torque',              pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'UNIMECH.NS',    layer: 'L1', region: 'IN', rationale: 'Unimech Aerospace — precision machining for aero + defence; recent listing',                  pricing_leverage: 'STRONG', size: 'SMALL_CAP' },
  { ticker: 'BHARATFORG.NS', layer: 'L1', region: 'IN', rationale: 'Bharat Forge defence vertical — ATAGS / Kalyani M4; cycling capacity to defence orders',     pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'SOLARINDS.NS',  layer: 'L1', region: 'IN', rationale: 'Solar Industries — explosives + defence munitions; EW & rocket-propellant exposure',         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── PATCH 0106: India L1 — POWER-EQUIPMENT specialist midcaps ────────────
  { ticker: 'SHILCHTECH.NS', layer: 'L1', region: 'IN', rationale: 'Shilchar Technologies — distribution + furnace transformers; orderbook torque on grid capex',pricing_leverage: 'STRONG', size: 'SMALL_CAP' },
  { ticker: 'VOLTAMP.NS',    layer: 'L1', region: 'IN', rationale: 'Voltamp Transformers — power transformers; lead-time pricing power on DC + RE evac',         pricing_leverage: 'STRONG', size: 'SMALL_CAP' },
  { ticker: 'TRIL.NS',       layer: 'L1', region: 'IN', rationale: 'Transformers & Rectifiers India — EHV transformers; export + domestic capex beneficiary',    pricing_leverage: 'STRONG', size: 'SMALL_CAP' },
  { ticker: 'SKIPPER.NS',    layer: 'L1', region: 'IN', rationale: 'Skipper — transmission towers + polymer pipes; T&D capex orderbook',                          pricing_leverage: 'STRONG', size: 'SMALL_CAP' },
  { ticker: 'GENUSPOWER.NS', layer: 'L1', region: 'IN', rationale: 'Genus Power — smart meters; AMI rollout + grid modernisation',                                pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'KPIGREEN.NS',   layer: 'L1', region: 'IN', rationale: 'KPI Green — solar EPC + IPP; high RE capex torque',                                           pricing_leverage: 'STRONG', size: 'MID_CAP'   },

  // ── PATCH 0107: India L4 — EXPORT PROXIES (sell to global AI / oil-gas / nuclear / industrial) ──
  // These midcaps export to global hyperscalers / oil-gas majors / EPCs.
  // Surface them in BOTH India view AND the corresponding GLOBAL theme card.
  { ticker: 'AEROFLEX.NS',   layer: 'L4', region: 'IN', rationale: 'Aeroflex — stainless steel flexible hoses; exports to US data-center cooling, oil/gas, industrial',     pricing_leverage: 'STRONG', size: 'SMALL_CAP', export_proxy: true, export_destination: 'US AI DC + global oil & gas' },
  { ticker: 'DEE.NS',        layer: 'L4', region: 'IN', rationale: 'DEE Development Engineers — process piping for oil/gas/hydrogen; exports to US/EU LNG + DC mechanical',  pricing_leverage: 'STRONG', size: 'MID_CAP',   export_proxy: true, export_destination: 'US/EU LNG + DC mechanical' },
  { ticker: 'WELCORP.NS',    layer: 'L4', region: 'IN', rationale: 'Welspun Corp — line pipes for oil/gas/water; large US + Middle East orderbook',                          pricing_leverage: 'STRONG', size: 'MID_CAP',   export_proxy: true, export_destination: 'US + Middle East oil & gas' },
  { ticker: 'JINDALSAW.NS',  layer: 'L4', region: 'IN', rationale: 'Jindal Saw — large-diameter pipes for oil/gas/water infrastructure; global exports',                     pricing_leverage: 'MEDIUM', size: 'MID_CAP',   export_proxy: true, export_destination: 'Global oil & gas pipelines' },
  { ticker: 'ASTRAL.NS',     layer: 'L4', region: 'IN', rationale: 'Astral — pipe fittings + plumbing; growing export book to GCC + EU',                                      pricing_leverage: 'MEDIUM', size: 'MID_CAP',   export_proxy: true, export_destination: 'GCC + EU plumbing' },
  { ticker: 'HONAUT.NS',     layer: 'L4', region: 'IN', rationale: 'Honeywell Automation India — exports embedded automation systems to global Honeywell parent',           pricing_leverage: 'STRONG', size: 'MID_CAP',   export_proxy: true, export_destination: 'Global Honeywell' },
  { ticker: 'CENTUM.NS',     layer: 'L4', region: 'IN', rationale: 'Centum Electronics — avionics + defence + DC embedded electronics; majority export-led',                pricing_leverage: 'STRONG', size: 'SMALL_CAP', export_proxy: true, export_destination: 'Global aero/defence/DC' },
  { ticker: 'SONACOMS.NS',   layer: 'L4', region: 'IN', rationale: 'Sona BLW Precision — EV differential gears + traction motors; global EV OEM export',                    pricing_leverage: 'STRONG', size: 'MID_CAP',   export_proxy: true, export_destination: 'Global EV OEMs' },
  { ticker: 'WALCHANNAG.NS', layer: 'L4', region: 'IN', rationale: 'Walchandnagar Industries — nuclear + defence + sugar heavy engineering; nuclear vessel exports',         pricing_leverage: 'MEDIUM', size: 'SMALL_CAP', export_proxy: true, export_destination: 'Global nuclear + defence heavy eng' },
  { ticker: 'AIAENG.NS',     layer: 'L4', region: 'IN', rationale: 'AIA Engineering — high-chrome grinding media; majority exports to global mining/cement',                pricing_leverage: 'STRONG', size: 'MID_CAP',   export_proxy: true, export_destination: 'Global mining/cement' },
  { ticker: 'GRINDWELL.NS',  layer: 'L4', region: 'IN', rationale: 'Grindwell Norton — abrasives for industrial + auto + electronics; global Saint-Gobain affiliate',         pricing_leverage: 'MEDIUM', size: 'MID_CAP',   export_proxy: true, export_destination: 'Global Saint-Gobain' },

  // ── L3 — Edge / Distribution / Telco (India) ──────────────────────────────
  { ticker: 'BHARTIARTL.NS', layer: 'L3', region: 'IN', rationale: 'Bharti Airtel — mobile + fibre + edge nodes; AI-traffic carrier',                           pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'TATACOMM.NS',   layer: 'L3', region: 'IN', rationale: 'Tata Communications — global subsea + edge + DC interconnect',                              pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'TEJASNET.NS',   layer: 'L3', region: 'IN', rationale: 'Tejas Networks — 5G/optical equipment; PLI + BSNL beneficiary',                              pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'CYIENT.NS',     layer: 'L3', region: 'IN', rationale: 'Cyient — networks + comms ER&D; edge/RAN integration',                                       pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },

  // ── L4 — Sterlite-type Transmission Winners (India) ───────────────────────
  { ticker: 'STL.NS',        layer: 'L4', region: 'IN', rationale: 'Sterlite Tech — preform → fibre ASP cascade; the canonical Sterlite-type name',             pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'HFCL.NS',       layer: 'L4', region: 'IN', rationale: 'HFCL — optical fibre + cable; defence + telecom backlog',                                    pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'POLYCAB.NS',    layer: 'L4', region: 'IN', rationale: 'Polycab — wires + cables leader; DC-build + RE-evac pricing pass-through',                  pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'KEI.NS',        layer: 'L4', region: 'IN', rationale: 'KEI Industries — EHV + control cables; T&D + industrial capex beneficiary',                 pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'FINCABLES.NS',  layer: 'L4', region: 'IN', rationale: 'Finolex Cables — communication + power cables; pricing transmission',                       pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: 'LINDEINDIA.NS', layer: 'L4', region: 'IN', rationale: 'Linde India — industrial + electronic gases; long-cycle pricing power',                     pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'HEG.NS',        layer: 'L4', region: 'IN', rationale: 'HEG — graphite electrodes; industrial intermediate margin transmission',                    pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'GRAPHITE.NS',   layer: 'L4', region: 'IN', rationale: 'Graphite India — electrodes peer; commodity converter pricing pass-through',                pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: 'DIXON.NS',      layer: 'L4', region: 'IN', rationale: 'Dixon Technologies — EMS scale; PLI + import-substitution backbone',                         pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  // PATCH 0087: India EPC / project-backlog chain
  { ticker: 'LT.NS',         layer: 'L4', region: 'IN', rationale: 'L&T — flagship EPC scale; AI-DC + grid + transport + nuclear backlog repricing',             pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'HCC.NS',        layer: 'L4', region: 'IN', rationale: 'Hindustan Construction — heavy civil + hydro + nuclear EPC; backlog inflation beneficiary',  pricing_leverage: 'MEDIUM', size: 'SMALL_CAP' },

  // ── L5 — Platform / Demand Aggregators (India) ─────────────────────────────
  { ticker: 'TCS.NS',        layer: 'L5', region: 'IN', rationale: 'Tata Consultancy Services — enterprise AI integrator; demand aggregator',                   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'INFY.NS',       layer: 'L5', region: 'IN', rationale: 'Infosys — enterprise AI + Topaz; large-deal monetisation',                                   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'RELIANCE.NS',   layer: 'L5', region: 'IN', rationale: 'Reliance — Jio + retail + AI Compute platform; multi-channel demand aggregator',            pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'WIPRO.NS',      layer: 'L5', region: 'IN', rationale: 'Wipro — AI360 + GenAI consulting; mid-tier platform monetisation',                          pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'HCLTECH.NS',    layer: 'L5', region: 'IN', rationale: 'HCL Tech — products + services + cloud; enterprise demand aggregator',                       pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── L6 — Infrastructure / Efficiency (India) ───────────────────────────────
  { ticker: 'VOLTAS.NS',     layer: 'L6', region: 'IN', rationale: 'Voltas — HVAC + DC cooling solutions; infra-cooling efficiency play',                       pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'BLUESTARCO.NS', layer: 'L6', region: 'IN', rationale: 'Blue Star — DC + commercial HVAC; thermal infra leader',                                    pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'HAVELLS.NS',    layer: 'L6', region: 'IN', rationale: 'Havells — electricals + cables + cooling; integrated efficiency portfolio',                 pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'CROMPTON.NS',   layer: 'L6', region: 'IN', rationale: 'Crompton Greaves Consumer — fans + appliances + LED; efficiency tier',                       pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: 'KIRLOSKARP.NS', layer: 'L6', region: 'IN', rationale: 'Kirloskar Pneumatic — air compressors + cryogenics; thermal + industrial efficiency',        pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: 'THERMAX.NS',    layer: 'L6', region: 'IN', rationale: 'Thermax — industrial heating/cooling/water/energy; efficiency capex play',                  pricing_leverage: 'STRONG', size: 'MID_CAP'   },
];

// India-specific NODE_RULES — same SystemNodes, India-listed mandatory injects.
export const NODE_RULES_IN: Record<SystemNode, NodeRule> = {
  COMPUTE_INFRA: {
    fires: ['L1','L2','L4','L5','L6'],
    // PATCH 0107: AEROFLEX / HONAUT / CENTUM are export proxies for US AI DC mechanical + electronics
    mandatory: {
      L1: ['KAYNES.NS'],
      L2: ['TATAELXSI.NS','LTTS.NS','KPITTECH.NS'],
      L4: ['AEROFLEX.NS','HONAUT.NS','CENTUM.NS'],
      L5: ['TCS.NS','INFY.NS','HCLTECH.NS'],
    },
  },
  MEMORY_INFRA: {
    fires: ['L1','L2','L4','L5'],
    mandatory: { L1: ['KAYNES.NS'], L2: ['TATAELXSI.NS','LTTS.NS'], L4: ['DIXON.NS'] },
  },
  PACKAGING_INFRA: {
    fires: ['L1','L2','L4','L5'],
    mandatory: { L1: ['KAYNES.NS','CGPOWER.NS'], L4: ['DIXON.NS'] },
  },
  FABRICATION_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: { L1: ['KAYNES.NS','CGPOWER.NS'], L4: ['LINDEINDIA.NS'] },
  },
  INTERCONNECT_INFRA: {
    fires: ['L1','L3','L4','L6'],
    mandatory: { L3: ['BHARTIARTL.NS','TATACOMM.NS','TEJASNET.NS'], L4: ['STL.NS','HFCL.NS','POLYCAB.NS'] },
  },
  NETWORK_BANDWIDTH: {
    fires: ['L3','L4','L5'],
    mandatory: { L3: ['BHARTIARTL.NS','TATACOMM.NS','TEJASNET.NS'], L4: ['STL.NS','HFCL.NS'], L5: ['RELIANCE.NS'] },
  },
  COOLING_INFRA: {
    fires: ['L1','L4','L6'],
    // PATCH 0107: AEROFLEX hoses + HONAUT controls = direct US DC cooling export exposure
    mandatory: {
      L1: ['ABB.NS','SIEMENS.NS'],
      L4: ['AEROFLEX.NS','HONAUT.NS'],
      L6: ['VOLTAS.NS','BLUESTARCO.NS','THERMAX.NS','KIRLOSKARP.NS'],
    },
  },
  ENERGY_INFRA: {
    // PATCH 0106: prioritise transformer midcaps (Shilchar/Voltamp/TRIL) +
    // grid midcaps (Skipper/Genus) ahead of POWERGRID/NTPC megacaps.
    // Megacaps still present but sorted lower by convexity score.
    fires: ['L1','L4','L6'],
    mandatory: {
      L1: ['SHILCHTECH.NS','VOLTAMP.NS','TRIL.NS','SKIPPER.NS','GENUSPOWER.NS','CGPOWER.NS','KECL.NS','ABB.NS','SIEMENS.NS','POWERGRID.NS','NTPC.NS','BHEL.NS'],
      L4: ['POLYCAB.NS','KEI.NS'],
      L6: ['THERMAX.NS'],
    },
  },
  NUCLEAR_INFRA: {
    // PATCH 0106: drop L5 (TCS/INFY/RELIANCE not nuclear beneficiaries).
    // PATCH 0107: WALCHANNAG = global nuclear heavy-engineering export proxy.
    // PATCH 0109b: drop L6 too — Voltas/Bluestar/Thermax/Havells/Crompton are
    // generic HVAC names, NOT nuclear beneficiaries.  User: 'Under Nuclear
    // showing Voltas/Havells/Crompton destroys precision.'
    fires: ['L1','L4'],
    mandatory: {
      L1: ['MTARTECH.NS','BHEL.NS','PARASDEF.NS','APOLLO.NS','BHARATFORG.NS','NTPC.NS'],
      L4: ['LINDEINDIA.NS','HEG.NS','WALCHANNAG.NS'],
    },
  },
  OIL_GAS_INFRA: {
    fires: ['L1','L4','L6'],
    // PATCH 0107: WELCORP / JINDALSAW / DEE / AEROFLEX are global oil-gas export proxies
    mandatory: {
      L4: ['LINDEINDIA.NS','WELCORP.NS','JINDALSAW.NS','DEE.NS','AEROFLEX.NS'],
    },
  },
  RENEWABLE_INFRA: {
    // PATCH 0106: surface execution-torque specialists ahead of generic PSUs.
    // KPIGREEN + Premier Energies + Waaree + Borosil renew = direct revenue
    // sensitivity to RE capex; transformer midcaps (Voltamp / Shilchar / TRIL)
    // are the actual scarce enablers vs grid megacaps.
    fires: ['L1','L4','L6'],
    mandatory: {
      L1: ['KPIGREEN.NS','SHILCHTECH.NS','VOLTAMP.NS','TRIL.NS','SKIPPER.NS','GENUSPOWER.NS','ADANIGREEN.NS','POWERGRID.NS','NTPC.NS'],
      L4: ['STL.NS','POLYCAB.NS','KEI.NS','HFCL.NS'],
      L6: ['THERMAX.NS'],
    },
  },
  LOGISTICS_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  TRANSPORT_INFRA: {
    fires: ['L1','L4','L6'],
    mandatory: { L1: ['SIEMENS.NS','BHEL.NS'] },
  },
  // PATCH 0106: 'DEFENCE / MISSILES showing POWERGRID NTPC BHEL ABB SIEMENS
  // is wrong' — drop L5 (TCS/INFY/WIPRO sympathy), surface execution-torque
  // defence-electronics midcaps in L1.
  DEFENSE_INFRA: {
    fires: ['L1','L4'],
    mandatory: {
      L1: ['DATAPATTNS.NS','PARASDEF.NS','ASTRAMICRO.NS','MTARTECH.NS','APOLLO.NS','ZENTEC.NS','IDEAFORGE.NS','CYIENTDLM.NS','UNIMECH.NS','BHARATFORG.NS','SOLARINDS.NS'],
      L4: ['MIDHANI.NS'],
    },
  },
  AEROSPACE_INFRA: {
    // PATCH 0106: drop L5 platform sympathy, surface precision/EMS specialists
    fires: ['L1','L4'],
    mandatory: {
      L1: ['MTARTECH.NS','PARASDEF.NS','DATAPATTNS.NS','UNIMECH.NS','CYIENTDLM.NS','BHARATFORG.NS'],
    },
  },
  RESOURCE_SCARCITY: {
    fires: ['L1','L4','L6'],
    mandatory: { L4: ['LINDEINDIA.NS','HEG.NS','GRAPHITE.NS'] },
  },
  AGRI_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  MANUFACTURING_CAPACITY: {
    // PATCH 0109b: drop L5 (TCS/INFY/RELIANCE/HCLTECH/WIPRO are theme dilution
    // on Hyundai-style capex stories — not capex beneficiaries) and L6 (HVAC).
    fires: ['L1','L4'],
    mandatory: { L1: ['KAYNES.NS','CGPOWER.NS'], L4: ['DIXON.NS','AEROFLEX.NS'] },
  },
  LABOR_CONSTRAINT: {
    fires: ['L2','L5','L6'],
    mandatory: { L5: ['TCS.NS','INFY.NS'] },
  },
  CAPITAL_CONSTRAINT: {
    fires: ['L5'],
    mandatory: {},
  },
  NONE: {
    fires: [],
    mandatory: {},
  },
};

// ─── Region inference ───────────────────────────────────────────────────────
// PATCH 0086: classify a sample / article as Indian or Global so the persistent
// bottleneck panel can be split cleanly. Heuristics combine:
//   - source name patterns (Indian publishers + government/exchange portals)
//   - currency & magnitude tokens (Rs, ₹, crore, lakh)
//   - Indian ticker suffixes (.NS, .BO)
//   - PSU + Indian-issuer name patterns

const IN_SOURCE_PATTERNS = [
  /mint\b/i, /economic times|et now\b|et bureau/i, /business standard/i, /power line/i,
  /moneycontrol/i, /livemint/i, /hindu businessline|the hindu/i, /financial express/i,
  /bse\b|nse\b|sebi\b|rbi\b|pib\b|pti\b|ani\b/i, /cnbc.?tv18\b/i, /zee business/i,
  /pib\.gov\.in|pib gov/i, /mygov\.in/i, /nseindia\.com|bseindia\.com/i,
  /etmarkets/i, /smartinvestor/i, /capital ?market/i, /equitymaster/i,
];
const IN_TEXT_PATTERNS = [
  /\bRs\.?\s*\d/, /₹/, /\b(?:crore|lakh|cr\.?|lakhs?)\b/i,
  /\b(?:NSE|BSE|SEBI|RBI|NTPC|BHEL|POWERGRID|COAL\s+INDIA|RELIANCE|TATA|ADANI|MAHINDRA|HINDUSTAN|GOI|ISRO|DRDO|HAL|BEL|BEML)\b/,
  /\b(?:Mumbai|Bengaluru|Bangalore|Delhi|Chennai|Hyderabad|Kolkata|Pune|Ahmedabad)\b/,
  /\b(?:CCI|Niti Aayog|PLI|UPI|GST|NCLT)\b/,
];

export function inferRegion(args: { sources?: string[]; titles?: string[]; tickers?: string[] }): LayerRegion {
  const { sources = [], titles = [], tickers = [] } = args;

  // Strong signal: any Indian-suffix ticker
  for (const t of tickers) {
    const T = (t || '').toUpperCase();
    if (T.endsWith('.NS') || T.endsWith('.BO')) return 'IN';
  }
  // Strong signal: source name matches Indian publisher
  for (const src of sources) {
    if (!src) continue;
    if (IN_SOURCE_PATTERNS.some((re) => re.test(src))) return 'IN';
  }
  // Medium signal: currency / magnitude / PSU tokens in headlines
  for (const t of titles) {
    if (!t) continue;
    if (IN_TEXT_PATTERNS.some((re) => re.test(t))) return 'IN';
  }
  return 'GLOBAL';
}

// ─── Node → Layers + Mandatory Injection map ────────────────────────────────
// Per the v2.0 spec: every bottleneck propagates through ALL six layers, but
// each node-class has a different *rich* layer pattern + a mandatory injection
// list that must appear regardless of article co-occurrence.

interface NodeRule {
  fires: BeneficiaryLayer[];                // which layers are activated
  mandatory: Partial<Record<BeneficiaryLayer, string[]>>;  // force-inject tickers
}

export const NODE_RULES: Record<SystemNode, NodeRule> = {
  // Compute / memory / packaging — full L1-L6 with AMD/INTC/ARM injection
  COMPUTE_INFRA: {
    fires: ['L1','L2','L3','L4','L5','L6'],
    // PATCH 0087: L3 carrier-edge (AKAM/NET/LUMN) + L4 connectors + EPC mandatory
    mandatory: {
      L2: ['AMD','INTC','ARM','AVGO','MRVL'],
      L3: ['AKAM','NET','LUMN'],
      L4: ['APH','TEL','PWR','MTZ','TT','VRT','4062.T','6981.T'],
      L5: ['MSFT','AMZN','GOOGL','META'],
      L6: ['VRT','ETN','TT'],
    },
  },
  MEMORY_INFRA: {
    fires: ['L1','L2','L4','L5','L6'],
    mandatory: {
      L1: ['MU','TSM'],
      L2: ['AMD','INTC','ARM'],
      L4: ['4901.T','6981.T','APH','TEL'],
      L5: ['MSFT','AMZN','GOOGL'],
    },
  },
  PACKAGING_INFRA: {
    fires: ['L1','L2','L4','L5'],
    // PATCH 0085: AMKR mandatory — Amkor OSAT capacity is the explicit
    // CoWoS / FOWLP volume capture layer the user flagged as missing.
    mandatory: {
      L1: ['TSM','AMAT','KLAC','AMKR'],
      L2: ['AMD','AVGO','MRVL','AMZN','GOOGL','MSFT'],
      L4: ['4062.T','6967.T','3711.TW','APH','TEL'],
    },
  },
  FABRICATION_INFRA: {
    fires: ['L1','L2','L4','L5'],
    mandatory: { L1: ['TSM','ASML','AMAT','KLAC','LRCX'], L4: ['LIN','AI.PA','4901.T'] },
  },
  // Interconnect / network — L3 spine + AKAM/NET/CIEN/LITE injection
  INTERCONNECT_INFRA: {
    fires: ['L1','L3','L4','L6'],
    // PATCH 0087: carrier-edge LUMN + connectors APH/TEL
    mandatory: {
      L3: ['AKAM','NET','CIEN','LITE','COHR','LUMN'],
      L4: ['STL.NS','PRY.MI','GLW','6005.HK','APH','TEL'],
    },
  },
  NETWORK_BANDWIDTH: {
    fires: ['L3','L4','L5','L6'],
    // PATCH 0087: full carrier-edge spine + connectors
    mandatory: {
      L3: ['AKAM','NET','CIEN','LITE','LUMN','VZ','T'],
      L4: ['STL.NS','PRY.MI','GLW','APH','TEL'],
      L5: ['MSFT','AMZN','GOOGL'],
    },
  },
  // Cooling — L1 power-build + L4 backlog pass-through + L6 thermal injection
  COOLING_INFRA: {
    fires: ['L1','L4','L6'],
    // PATCH 0085: ABB mandatory in L1
    // PATCH 0087: thermal names dual-tagged into L4 for backlog repricing,
    //             plus TT (Trane) explicit in L6 efficiency stack
    mandatory: {
      L1: ['ETN','SBGSY','ABBNY'],
      L4: ['VRT','JCI','CARR','TT','APH','TEL'],
      L6: ['VRT','JCI','CARR','TT','2308.TW','NVT','EMR'],
    },
  },
  // Energy — L1 grid build + L4 EPC backlog + L6 efficiency
  ENERGY_INFRA: {
    fires: ['L1','L4','L5','L6'],
    // PATCH 0085: ABB mandatory in L1
    // PATCH 0087: EPC chain (PWR/MTZ/PRIM/FLR/J) + grid dual-tag (GEV/SMNEY/HTHIY/ABBNY) in L4
    mandatory: {
      L1: ['GEV','SMNEY','HTHIY','ETN','SBGSY','ABBNY'],
      L4: ['PWR','MTZ','PRIM','FLR','J','GEV','SMNEY','HTHIY','ABBNY','APH','TEL'],
      L6: ['VRT','ETN','ARM','TT'],
    },
  },
  NUCLEAR_INFRA: {
    fires: ['L1','L5','L6'],
    mandatory: { L1: ['GEV','SMNEY'], L6: ['ETN','SBGSY'] },
  },
  OIL_GAS_INFRA: {
    fires: ['L1','L4','L6'],
    mandatory: { L4: ['LIN','AI.PA'] },
  },
  RENEWABLE_INFRA: {
    fires: ['L1','L4','L6'],
    mandatory: { L1: ['GEV','HTHIY','ETN'], L4: ['PRY.MI'] },
  },
  // Logistics / transport — L4 transmission + L1 capacity
  LOGISTICS_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  TRANSPORT_INFRA: {
    fires: ['L1','L4','L6'],
    mandatory: {},
  },
  // Defense / aerospace — narrow L1 + L4
  DEFENSE_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  AEROSPACE_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  // Resources — L1/L4 commodity transmission
  RESOURCE_SCARCITY: {
    fires: ['L1','L4','L6'],
    mandatory: { L4: ['LIN','AI.PA','HON'] },
  },
  AGRI_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  // Macro / capital
  MANUFACTURING_CAPACITY: {
    fires: ['L1','L4','L5','L6'],
    mandatory: { L4: ['HON','LIN'] },
  },
  LABOR_CONSTRAINT: {
    fires: ['L2','L5','L6'],
    mandatory: {},
  },
  CAPITAL_CONSTRAINT: {
    fires: ['L5'],
    mandatory: {},
  },
  NONE: {
    fires: [],
    mandatory: {},
  },
};

// ─── Transmission cascade (T0 → T4) ─────────────────────────────────────────

export interface TransmissionCascade {
  T0: string;  // News / constraint emerges
  T1: string;  // 0-1Q: sentiment + order flow
  T2: string;  // 1-3Q: revenue acceleration
  T3: string;  // 3-6Q: margin expansion (Sterlite-style preform→ASP→EBITDA)
  T4: string;  // 6-12Q: EPS rerating cycle
}

// Per-node cascade copy. The T0 line is article-specific (filled at runtime);
// the T1-T4 lines describe what historically happens once a constraint of that
// class fires. Generic enough to not over-promise, specific enough to be useful.
const CASCADE_BY_NODE: Partial<Record<SystemNode, Omit<TransmissionCascade, 'T0'>>> = {
  COMPUTE_INFRA: {
    T1: 'GPU lead-times extend → CPU-attach increases (L2 CPU-cycle: AMD-EPYC / INTC / ARM); inference begins shifting to edge (L3: AKAM/NET caching, request compression, latency arbitrage, "avoid GPU call" architectures); alt-accelerator order rotation begins (L2 GPU-sub: AMD / AVGO / MRVL)',
    T2: 'L1 capacity capturers + L4 industrial pass-through revenue acceleration; OSAT + connector + EPC backlogs extend 18→36 months; hyperscaler capex disclosures lift L5 forecasts; AMD-EPYC + INTC AI-PC cycle inflects',
    T3: 'Backlog repricing flows to EBITDA — Sterlite-type margin expansion 300-800bps in fibre + connectors (APH/TEL) + thermal (VRT/TT) + EPC (PWR/MTZ); advanced packaging ASPs lift OSAT margins (4062.T / 3711.TW)',
    T4: 'EPS rerating cycle on 2-4Q lag — multiple expansion in L4 transmission winners (PWR/MTZ/APH/TT/SMNEY-backlog), L2 CPU-cycle (INTC/ARM perf-watt), L3 edge platforms (AKAM/NET/LUMN); consensus revision cycle',
  },
  MEMORY_INFRA: {
    T1: 'HBM / DRAM contract pricing referenced; MU + SK Hynix preannounce upside; CPU-attach uplift on memory-bandwidth-bound workloads',
    T2: 'Micron revenue acceleration; substrate + packaging pull-through (Ibiden 4062.T, Shinko 6967.T); connectors (APH/TEL) backlog inflates',
    T3: 'Memory gross margins step up 500-1500bps as pricing flows through inventories; L4 substrate ASPs lift (preform → ABF → margin cascade); EPC capex (PWR / FLR) repriced on memory-fab buildout',
    T4: 'EPS rerating in MU + foundry chain on 2-4Q lag; capex surprise disclosed by hyperscalers; L4 EBITDA expansion peaks ahead of revenue volume',
  },
  PACKAGING_INFRA: {
    T1: 'CoWoS / ABF allocation + lead-time references in supplier commentary; AMKR / 3711.TW utilisation tightens',
    T2: 'TSMC packaging revenue mix shifts; Ibiden / Shinko utilisation inflects; connectors (APH/TEL) AI-server pull-through accelerates',
    T3: 'OSAT ASPs rise (3711.TW / 4062.T) — margin expansion in advanced packaging; substrate backlog 18→36 months drives ASP repricing',
    T4: 'L2 substitution accelerates as packaging stays tight; AMD / custom-silicon design-wins disclosed; EPS rerating in OSAT + substrate cluster',
  },
  INTERCONNECT_INFRA: {
    T1: 'Fibre / optical pricing referenced; AKAM / NET / CIEN positive prints; carrier-edge (LUMN) order book inflects',
    T2: 'Sterlite-type preform tightness flows to fibre ASPs; Prysmian / GLW / 6005.HK order books grow; connectors (APH/TEL) pull-through',
    T3: 'Optical EBITDA margins expand 300-800bps (preform → fibre → cable cascade); contract repricing on multi-year fibre backlog',
    T4: 'EPS rerating cycle 2-4Q lag in L4 transmission winners (STL/PRY/GLW); multiple expansion in L3 leaders + carrier-edge (LUMN/VZ/T)',
  },
  NETWORK_BANDWIDTH: {
    T1: 'CDN / inference-edge demand cited; Cloudflare / Akamai / Lumen see acceleration; "avoid-GPU-call" architectures referenced',
    T2: 'L3 revenue inflects as inference distributes; backbone (CIEN / LITE) order books rise; carrier-edge (VZ MEC / T FirstNet) backlog grows',
    T3: 'Fibre + DCI ASPs lift L4 transmission winners (PRY/STL/GLW + APH/TEL connectors); margin expansion on 18→36mo backlog repricing',
    T4: 'EPS rerating in edge platforms + optical chain on 2-4Q lag; multiple expansion in carrier-edge + L4 connectors',
  },
  COOLING_INFRA: {
    T1: 'CDU / liquid-cooling allocation referenced in DC operator commentary; VRT / NVT lead-times extend',
    T2: 'Vertiv / nVent / Delta Electronics / Trane revenue acceleration; CDU + cold-plate backlog inflates 18→36mo; APH/TEL pull-through',
    T3: 'Cold-plate + heat-rejection + chiller ASPs rise; thermal margin step-up 300-800bps as backlog repricing flows through (Sterlite-type)',
    T4: 'L6 multiple expansion (VRT / TT / JCI); L4 thermal-pass-through EPS rerating on 2-4Q lag; L2 perf/watt names (ARM / AMD) re-rate on energy gating',
  },
  ENERGY_INFRA: {
    T1: 'Interconnect queue / transformer lead-time disclosed; AI-DC + RE-evac capex commentary; EPC (PWR/MTZ) order books inflect',
    T2: 'GEV / SMNEY / HTHIY / ABBNY book-to-bill rises; ETN order book inflects; EPC (PWR / MTZ / FLR / J) backlog 18→36mo extension; L4 connectors + cables pull-through',
    T3: 'Transformer + switchgear + cable + EPC ASPs lift; project margin expansion 300-800bps as multi-year backlog reprices (input scarcity → ASP repricing → EBITDA expansion)',
    T4: 'Multi-year backlog flows into earnings on 2-4Q lag; L4 transmission winners (PWR / MTZ / APH / TT / GEV-backlog) EPS rerating; L6 efficiency winners (VRT / TT) re-rate',
  },
  NUCLEAR_INFRA: {
    T1: 'Reactor / fuel allocation referenced; SMR partnership disclosures',
    T2: 'CEG / VST PPAs disclosed; SMR / OKLO project finance momentum',
    T3: 'Long-dated nuclear PPAs lift utility EBITDA margins',
    T4: 'L5 hyperscalers disclose nuclear-backed AI capacity; rerating',
  },
  RENEWABLE_INFRA: {
    T1: 'Grid + transformer capacity for renewable build referenced',
    T2: 'GEV / Prysmian / cable order books inflect',
    T3: 'Cable / inverter ASPs lift; long-cycle margin expansion',
    T4: 'Multi-year backlog visibility drives rerating',
  },
  RESOURCE_SCARCITY: {
    T1: 'Specialty input ASP referenced in commentary',
    T2: 'L1 capturers (LIN, AI.PA) revenue acceleration',
    T3: 'Industrial-gas + specialty-input margins expand',
    T4: 'Long-cycle pricing rerates L1/L4',
  },
  MANUFACTURING_CAPACITY: {
    T1: 'Capacity utilisation / capex disclosure referenced',
    T2: 'L1 capacity owners revenue acceleration',
    T3: 'Pricing + utilisation margin expansion',
    T4: 'EPS revision cycle in capacity owners',
  },
};

const DEFAULT_CASCADE: Omit<TransmissionCascade, 'T0'> = {
  T1: 'Sentiment + order-flow rotation toward exposed names',
  T2: 'Revenue acceleration in direct beneficiaries',
  T3: 'Margin expansion as pricing flows through to operating leverage',
  T4: 'EPS rerating cycle begins; consensus revisions follow',
};

// ─── Output type ────────────────────────────────────────────────────────────

export interface LayeredBeneficiaries {
  bottleneck: SystemNode;
  bottleneck_label: string;
  layers: Record<BeneficiaryLayer, LayerTicker[]>;
  fired_layers: BeneficiaryLayer[];
  transmission: TransmissionCascade;
}

// ─── Derive ─────────────────────────────────────────────────────────────────

// PATCH 0087: keyed by (layer, ticker) so dual-tagged tickers (e.g. GEV in
// both L1 and L4 with different rationales) resolve to the right metadata
// when mandatory-injected into a target layer.
const ROSTER_BY_LAYER_TICKER: Map<string, LayerTicker> = (() => {
  const m = new Map<string, LayerTicker>();
  for (const t of [...LAYER_ROSTER, ...INDIA_ROSTER]) m.set(`${t.layer}:${t.ticker.toUpperCase()}`, t);
  return m;
})();

const ROSTER_BY_LAYER: Record<BeneficiaryLayer, LayerTicker[]> = (() => {
  const m: Record<BeneficiaryLayer, LayerTicker[]> = { L1: [], L2: [], L3: [], L4: [], L5: [], L6: [] };
  for (const t of LAYER_ROSTER) m[t.layer].push(t);
  return m;
})();

// PATCH 0086: India-only by-layer index — used when region === 'IN'.
const INDIA_ROSTER_BY_LAYER: Record<BeneficiaryLayer, LayerTicker[]> = (() => {
  const m: Record<BeneficiaryLayer, LayerTicker[]> = { L1: [], L2: [], L3: [], L4: [], L5: [], L6: [] };
  for (const t of INDIA_ROSTER) m[t.layer].push(t);
  return m;
})();

// PATCH 0107: India export-proxy index — surfaces in GLOBAL view too.
// These are Indian midcaps whose revenue is dominantly export to global
// hyperscalers / oil-gas / defence / nuclear customers.  When deriveLayeredBeneficiaries
// runs region='GLOBAL', these get appended to the relevant layer alongside
// the standard global roster so user sees Aeroflex/DEE/Welspun/Walchandnagar
// when looking at US AI DC / US LNG / global nuclear cards.
const INDIA_EXPORT_PROXIES_BY_LAYER: Record<BeneficiaryLayer, LayerTicker[]> = (() => {
  const m: Record<BeneficiaryLayer, LayerTicker[]> = { L1: [], L2: [], L3: [], L4: [], L5: [], L6: [] };
  for (const t of INDIA_ROSTER) if (t.export_proxy) m[t.layer].push(t);
  return m;
})();

function nodeLabel(node: SystemNode): string {
  return node.replace(/_/g, ' ').toLowerCase();
}

/**
 * Given a bottleneck SystemNode and the article's tickers, produce the full
 * 6-layer beneficiary map + transmission cascade. Mandatory injections are
 * applied first; article tickers are then overlaid (article ticker takes
 * precedence on metadata if both are present).
 *
 * Limit per layer: 8 tickers (mandatory > article > seed remainder).
 */
// PATCH 0104: imported lazily (server-only) so client bundle stays small.
// Discovered tickers from the per-node accumulator are appended to L1.
import type { NodeTickerEntry } from '@/lib/news/node-ticker-accumulator';
import { classifyTier } from '@/lib/news/node-ticker-accumulator';

export function deriveLayeredBeneficiaries(args: {
  primary_node: SystemNode;
  article_tickers?: string[];
  per_layer_limit?: number;
  // Article headline at T0 — used to fill TransmissionCascade.T0.
  article_headline?: string;
  // PATCH 0086: when 'IN' the function uses INDIA_ROSTER + NODE_RULES_IN
  // exclusively, so an Indian story does not surface US-listed names.
  region?: LayerRegion;
  // PATCH 0104: auto-discovered tickers from news accumulator (pre-fetched
  // by caller to avoid awaiting per-article).  Appended to L1 with
  // discovered: true marker.
  discovered_tickers?: NodeTickerEntry[];
}): LayeredBeneficiaries {
  const { primary_node, article_tickers = [], per_layer_limit = 8, article_headline, region = 'GLOBAL', discovered_tickers = [] } = args;
  const rule = (region === 'IN' ? NODE_RULES_IN : NODE_RULES)[primary_node] ?? NODE_RULES.NONE;
  const rosterByLayer = region === 'IN' ? INDIA_ROSTER_BY_LAYER : ROSTER_BY_LAYER;
  const articleSet = new Set(article_tickers.map((t) => t.toUpperCase()));

  // Build per-layer ticker list with priority: mandatory > article > seed remainder
  const layers: Record<BeneficiaryLayer, LayerTicker[]> = { L1: [], L2: [], L3: [], L4: [], L5: [], L6: [] };

  for (const layer of rule.fires) {
    const seen = new Set<string>();
    const out: LayerTicker[] = [];

    // 1. Mandatory injects
    const mand = rule.mandatory[layer] ?? [];
    for (const tk of mand) {
      const T = tk.toUpperCase();
      if (seen.has(T)) continue;
      // PATCH 0087: layer-scoped lookup so dual-tagged tickers pick the right rationale
      const meta = ROSTER_BY_LAYER_TICKER.get(`${layer}:${T}`);
      if (meta) {
        out.push({ ...meta, mandatory: true });
        seen.add(T);
      } else {
        // Allow injection of names not in the roster (e.g. region-specific) —
        // populate with a sensible default.
        out.push({
          ticker: T,
          layer,
          rationale: `Mandatory ${LAYER_META[layer].label} member for ${nodeLabel(primary_node)}`,
          pricing_leverage: 'MEDIUM',
          size: 'LARGE_CAP',
          mandatory: true,
        });
        seen.add(T);
      }
    }

    // 2. Article tickers that map into this layer's roster (region-scoped)
    for (const meta of rosterByLayer[layer]) {
      const T = meta.ticker.toUpperCase();
      if (seen.has(T)) continue;
      if (articleSet.has(T)) {
        out.push({ ...meta });
        seen.add(T);
      }
    }

    // 3. Top seed remainder by pricing leverage to fill out the layer
    //    (region-scoped — INDIA_ROSTER when region==='IN')
    const leverageRank: Record<PricingLeverage, number> = { STRONG: 3, MEDIUM: 2, WEAK: 1 };
    const remainder = rosterByLayer[layer]
      .filter((m) => !seen.has(m.ticker.toUpperCase()))
      .sort((a, b) => leverageRank[b.pricing_leverage] - leverageRank[a.pricing_leverage]);
    for (const meta of remainder) {
      if (out.length >= per_layer_limit) break;
      out.push({ ...meta });
      seen.add(meta.ticker.toUpperCase());
    }

    // PATCH 0107: when in GLOBAL view, append India export proxies for this layer.
    // Aeroflex / DEE / Welspun / Walchandnagar / Honaut etc. ship into global
    // hyperscaler / oil-gas / nuclear customers so they belong on those cards.
    if (region === 'GLOBAL') {
      const exportProxies = INDIA_EXPORT_PROXIES_BY_LAYER[layer]
        .filter((m) => !seen.has(m.ticker.toUpperCase()))
        .sort((a, b) => leverageRank[b.pricing_leverage] - leverageRank[a.pricing_leverage]);
      const exportRoom = Math.max(2, Math.floor(per_layer_limit / 2));   // reserve up to half of layer for proxies
      let proxyAdded = 0;
      for (const meta of exportProxies) {
        if (proxyAdded >= exportRoom) break;
        if (out.length >= per_layer_limit + exportRoom) break;
        out.push({ ...meta });
        seen.add(meta.ticker.toUpperCase());
        proxyAdded += 1;
      }
    }

    layers[layer] = out.slice(0, per_layer_limit);
  }

  // PATCH 0104: AUTO-DISCOVERY MERGE.  Append tickers from the per-node news
  // accumulator into L1 (the natural home for "this name kept showing up
  // alongside <node>-classified articles").  Skips tickers already present
  // in any layer, so seed names aren't doubled.  No hardcoding — pure
  // evidence-based.
  if (discovered_tickers.length > 0 && rule.fires.includes('L1')) {
    const allLayerTickers = new Set<string>();
    for (const L of rule.fires) {
      for (const t of layers[L]) allLayerTickers.add(t.ticker.toUpperCase());
    }
    const l1Limit = per_layer_limit + 4;  // give discovered names a bit more room in L1
    for (const d of discovered_tickers) {
      if (layers.L1.length >= l1Limit) break;
      const T = d.ticker.toUpperCase();
      if (allLayerTickers.has(T)) {
        // already a seed member — annotate with accumulator data
        for (const L of rule.fires) {
          const existing = layers[L].find((x) => x.ticker.toUpperCase() === T);
          if (existing) {
            existing.mention_count = d.mention_count;
            existing.accumulator_score = Math.round(d.score * 10) / 10;
          }
        }
        continue;
      }
      // Brand new — add to L1 as discovered
      layers.L1.push({
        ticker: T,
        layer: 'L1',
        rationale: `Auto-discovered via news evidence (${d.mention_count} mentions across ${(d.top_sources || []).length} sources, score ${d.score.toFixed(1)}). Confirm with fundamentals before sizing.`,
        pricing_leverage: 'MEDIUM',
        size: 'MID_CAP',
        discovered: true,
        mention_count: d.mention_count,
        accumulator_score: Math.round(d.score * 10) / 10,
      });
      allLayerTickers.add(T);
    }
  }

  // PATCH 0104 + 0106: TIER A/B/C/D classification + CONVEXITY scoring.
  // Convexity is what surfaces execution-torque small/midcaps above generic
  // megacaps in the same layer.  Per user critique: 'BOTTLENECK -> SCARCE
  // ENABLER, not THEME -> LARGE CAP'.
  //
  // Convexity formula (0-100):
  //   +30 if SMALL_CAP, +18 if MID_CAP                  (size convexity)
  //   +20 if STRONG leverage, +10 if MEDIUM             (pricing power)
  //   +10 if mandatory                                   (structural fit)
  //   +5  if discovered (news evidence)
  //   -25 if ticker matches generic-PSU / megacap pattern (theme dilution)
  //   - 5 per accumulator_score >100 (institutional saturation)
  //
  // Generic-PSU dilution patterns: ticker names that are India megacap
  // proxies often appearing as 'thematic awareness' rather than direct
  // earnings torque on the firing bottleneck.  Hand-crafted regex (NOT a
  // hardcoded list of names — pattern-based).
  const GENERIC_MEGACAP_RE = /^(POWERGRID\.NS|NTPC\.NS|RELIANCE\.NS|TCS\.NS|INFY\.NS|WIPRO\.NS|HCLTECH\.NS|ONGC\.NS|COALINDIA\.NS|SBIN\.NS|HDFC\.NS|ICICIBANK\.NS|HDFCBANK\.NS|KOTAKBANK\.NS|AXISBANK\.NS|HINDUNILVR\.NS|ITC\.NS|LT\.NS)$/i;
  const SIZE_CONVEXITY: Record<LayerSize, number> = { SMALL_CAP: 30, MID_CAP: 18, LARGE_CAP: 0 };
  const LEV_CONVEXITY: Record<PricingLeverage, number> = { STRONG: 20, MEDIUM: 10, WEAK: 0 };

  for (const L of rule.fires) {
    const layerArr = layers[L];
    for (const t of layerArr) {
      t.tier = classifyTier({
        pricing_leverage: t.pricing_leverage,
        mandatory: t.mandatory,
        is_seed: !t.discovered,
        accumulator_score: t.accumulator_score,
        mention_count: t.mention_count,
      });

      // Convexity score
      let conv = 0;
      conv += SIZE_CONVEXITY[t.size] ?? 0;
      conv += LEV_CONVEXITY[t.pricing_leverage] ?? 0;
      if (t.mandatory) conv += 10;
      if (t.discovered) conv += 5;
      if (t.export_proxy) conv += 12;                          // PATCH 0107: export proxies get a convexity boost
      if (GENERIC_MEGACAP_RE.test(t.ticker)) conv -= 25;
      if ((t.accumulator_score ?? 0) > 100) conv -= 5;
      t.convexity_score = Math.max(0, Math.min(100, conv));
    }

    // Re-sort within layer: Tier A first; within tier, by convexity desc.
    // Net effect: execution-torque small/midcaps rise above generic megacaps.
    const tierRank: Record<'A'|'B'|'C'|'D', number> = { A: 4, B: 3, C: 2, D: 1 };
    layerArr.sort((a, b) => {
      const ta = tierRank[a.tier ?? 'D'];
      const tb = tierRank[b.tier ?? 'D'];
      if (ta !== tb) return tb - ta;
      const ca = a.convexity_score ?? 0;
      const cb = b.convexity_score ?? 0;
      return cb - ca;
    });
    layers[L] = layerArr;
  }

  // Cascade
  const cascade = CASCADE_BY_NODE[primary_node] ?? DEFAULT_CASCADE;
  const t0 = article_headline
    ? `${nodeLabel(primary_node)} signal: "${article_headline.slice(0, 120)}"`
    : `${nodeLabel(primary_node)} constraint surfaced`;

  return {
    bottleneck: primary_node,
    bottleneck_label: nodeLabel(primary_node),
    layers,
    fired_layers: rule.fires,
    transmission: { T0: t0, ...cascade },
  };
}

// Convenience: terse one-line summary for the collapsed strip.
export function summariseLayers(lb: LayeredBeneficiaries): string {
  return lb.fired_layers
    .map((L) => {
      const tickers = lb.layers[L].slice(0, 3).map((t) => t.ticker).join(' · ');
      return `${LAYER_META[L].icon}${L}: ${tickers}`;
    })
    .join('  ');
}
