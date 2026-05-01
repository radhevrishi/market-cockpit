'use client';

import { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw, ExternalLink, ChevronDown, ChevronRight,
  Zap, AlertCircle, Activity, TrendingUp, Flag, Trophy,
  Globe, Calendar, BookOpen, Map as MapIcon, CheckSquare, Square,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BnSignalArticle {
  id: string; headline: string; source_name: string;
  source_url: string; published_at: string; importance_score: number; sentiment: string;
}
interface BnSignal {
  headline: string; summary: string; evidence_count: number;
  sources: string[]; latest_at: string; tickers: string[]; articles: BnSignalArticle[];
}
interface BnBucket {
  bucket_id: string; label: string; description: string;
  severity: number; severity_label: string; severity_color: string; severity_icon: string;
  signal_count: number; article_count: number; key_tickers: string[]; signals: BnSignal[];
}
interface BnDashboard { success: boolean; total_articles: number; buckets: BnBucket[]; }
interface NewsArticle {
  id: string; headline: string; title: string; source_name: string;
  source: string; source_url: string; url: string; published_at: string;
  tickers: Array<{ ticker: string; exchange: string; confidence?: number } | string>;
  ticker_symbols: string[]; region: string; article_type: string; importance_score: number;
  bottleneck_sub_tag?: string; bottleneck_level?: string; sentiment?: string; summary?: string;
}
interface QuoteStock { ticker: string; company: string; price: number; changePercent: number; marketCap: number; sector?: string; }

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS = ['Rotation', 'Scanner', 'Drilldown', 'Geo', 'Calendar', 'Map', 'Checklist'] as const;
type Tab = typeof TABS[number];

const TAB_META: Record<Tab, { icon: ReactNode; short: string; description: string }> = {
  Rotation:  { icon: <Activity className="w-3.5 h-3.5" />,   short: 'Rotation',  description: 'Active bottleneck layer right now — Model 04' },
  Scanner:   { icon: <TrendingUp className="w-3.5 h-3.5" />, short: 'Scanner',   description: 'Bottleneck stocks ranked by Serenity Score — Models 02, 06, 10' },
  Drilldown: { icon: <BookOpen className="w-3.5 h-3.5" />,   short: 'Drilldown', description: "Per-layer: why it's a bottleneck, supply vs demand, winners & losers — Model 01" },
  Geo:       { icon: <Globe className="w-3.5 h-3.5" />,      short: 'Geo',       description: 'Active geopolitical events accelerating or threatening bottleneck positions — Models 25, 29, 36' },
  Calendar:  { icon: <Calendar className="w-3.5 h-3.5" />,   short: 'Calendar',  description: 'Upcoming industry conferences — frontrun 4-6 weeks early — Model 22' },
  Map:       { icon: <MapIcon className="w-3.5 h-3.5" />,    short: 'Map',       description: 'AI infrastructure supply chain value chain from raw materials to hyperscaler — Model 01, 05, 18' },
  Checklist: { icon: <CheckSquare className="w-3.5 h-3.5" />,short: 'Checklist', description: 'Serenity research checklist per stock — track your validation steps — Part V' },
};

// ── Severity styles ───────────────────────────────────────────────────────────

const SEV: Record<string, { bg: string; border: string; badge: string; badgeBg: string; glow: string }> = {
  CRITICAL: { bg: '#EF444408', border: '#EF444430', badge: '#EF4444', badgeBg: '#EF444418', glow: '0 0 20px #EF444415' },
  HIGH:     { bg: '#F59E0B06', border: '#F59E0B28', badge: '#F59E0B', badgeBg: '#F59E0B14', glow: '0 0 16px #F59E0B10' },
  ELEVATED: { bg: '#8B5CF606', border: '#8B5CF628', badge: '#8B5CF6', badgeBg: '#8B5CF614', glow: '0 0 16px #8B5CF610' },
  WATCH:    { bg: '#0F7ABF06', border: '#0F7ABF28', badge: '#0F7ABF', badgeBg: '#0F7ABF14', glow: 'none' },
  DEFAULT:  { bg: 'transparent', border: '#1A2840', badge: '#4A5B6C', badgeBg: '#4A5B6C14', glow: 'none' },
};
const getSev = (label: string) => {
  for (const k of Object.keys(SEV)) if (label?.toUpperCase().includes(k)) return SEV[k];
  return SEV.DEFAULT;
};

const LEVEL_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  CRITICAL:   { color: '#EF4444', bg: '#EF444418', border: '#EF444440' },
  BOTTLENECK: { color: '#F59E0B', bg: '#F59E0B14', border: '#F59E0B30' },
  WATCH:      { color: '#0F7ABF', bg: '#0F7ABF14', border: '#0F7ABF30' },
  RESOLVED:   { color: '#10B981', bg: '#10B98114', border: '#10B98130' },
};
const getLvl = (l?: string) => l ? (LEVEL_STYLES[l.toUpperCase()] ?? null) : null;

// ── Supply chain tier map ─────────────────────────────────────────────────────

const TIER_MAP: Record<string, { tier: number; label: string; color: string }> = {
  MATERIALS_SUPPLY:       { tier: 1, label: 'Tier 1 · Raw Materials',    color: '#8B5CF6' },
  QUANTUM_CRYOGENICS:     { tier: 2, label: 'Tier 2 · Substrates',       color: '#8B5CF6' },
  FABRICATION_PACKAGING:  { tier: 3, label: 'Tier 3 · Foundry / Pkg',    color: '#0F7ABF' },
  INTERCONNECT_PHOTONICS: { tier: 4, label: 'Tier 4 · Photonics',        color: '#06B6D4' },
  MEMORY_STORAGE:         { tier: 4, label: 'Tier 4 · Memory',           color: '#06B6D4' },
  COMPUTE_SCALING:        { tier: 5, label: 'Tier 5 · Compute',          color: '#10B981' },
  THERMAL_COOLING:        { tier: 5, label: 'Tier 5 · Thermal',          color: '#10B981' },
  POWER_GRID:             { tier: 6, label: 'Tier 6 · Power',            color: '#F59E0B' },
  NUCLEAR_ENERGY:         { tier: 6, label: 'Tier 6 · Nuclear',          color: '#F59E0B' },
};

// ── Drilldown knowledge base ──────────────────────────────────────────────────

interface DrilldownEntry {
  label: string; icon: string; why: string; supply: string; demand: string;
  winners: { ticker: string; thesis: string }[];
  losers: { ticker: string; thesis: string }[];
  confirms: string[];   // what confirms the thesis is playing out
  breaks: string[];     // what would invalidate the thesis
  watch_kpi: string[];  // leading indicators to track
}
const DRILLDOWN: Record<string, DrilldownEntry> = {
  MEMORY_STORAGE: {
    label: 'Memory & Storage', icon: '🧠',
    why: 'HBM and enterprise DRAM/NAND capacity is sold out through 2026. Every hyperscaler GPU needs 6–8 stacks of HBM3E; capacity additions lag GPU demand by 18–24 months.',
    supply: 'Only 3 HBM producers (SK Hynix, Samsung, Micron). Capex cycles 2–3 years. Yield on HBM3E structurally below DDR5.',
    demand: 'Every Blackwell GPU consumes 8× HBM3E stacks. Inference clusters need 3–5× the memory footprint of training. Demand ~60% YoY.',
    winners: [{ ticker: 'MU', thesis: 'Micron: HBM3E ramp, capex leverage' }, { ticker: 'AEHR', thesis: 'Aehr Test: wafer-level burn-in bottleneck for HBM' }],
    losers: [{ ticker: 'NVDA', thesis: 'Margin pressure as HBM costs stay elevated' }],
    confirms: ['HBM3E ASP increasing in supplier earnings calls', 'Lead times quoted >6 months by NVDA/AMD', 'New data center announcements citing memory as constraint', 'Micron/SK Hynix capacity sold out for next 2 quarters'],
    breaks: ['A 4th HBM supplier qualifies at major hyperscaler', 'AI inference demand drops materially (model efficiency breakthrough)', 'TSMC CoWoS capacity glut forces GPU inventory correction'],
    watch_kpi: ['HBM3E spot pricing (should be rising)', 'MU/SKX gross margin trajectory', 'NVDA H200 vs B200 shipment mix (B200 = 8× more HBM)', 'AEHR order backlog language in earnings calls'],
  },
  INTERCONNECT_PHOTONICS: {
    label: 'Interconnect & Photonics', icon: '💡',
    why: 'Copper hits bandwidth walls at 224 Gbps SerDes. Co-packaged optics (CPO) and silicon photonics are the only path to 1.6T/3.2T fabrics for future AI factories.',
    supply: 'CPO supply chain immature: lasers, modulators, couplers bottlenecked at handful of vendors. TSMC/Intel photonics integration still ramping.',
    demand: 'Every rack-scale AI system (NVL72, Trainium3) needs 10–100× more optical transceivers than prior generations. Hyperscaler buys locked through 2027.',
    winners: [{ ticker: 'COHR', thesis: 'Coherent: datacenter transceivers, VCSEL supply' }, { ticker: 'MRVL', thesis: 'Marvell: 800G/1.6T DSPs, custom silicon' }, { ticker: 'AAOI', thesis: 'AAOI: 800G single-mode transceivers ramping' }],
    losers: [],
    confirms: ['800G/1.6T transceiver order announcements from hyperscalers', 'CPO product wins at AMD/NVDA rack-scale systems', 'SIVE lasers named in GlobalFoundries or Intel photonics roadmap PDFs', 'COHR/LITE revenue guidance raised citing datacenter optics'],
    breaks: ['Electrical interconnect (UALink/CXL) solves bandwidth problem without optics', 'NVDA pivots to on-chip optical integration eliminating transceiver need', 'Multiple new laser suppliers qualify at major CPO customer'],
    watch_kpi: ['800G transceiver lead times (should be >16 weeks)', 'COHR datacenter % of revenue', 'GFS photonics roadmap PDF updates (track via Wayback Machine)', 'MRVL custom silicon revenue guidance'],
  },
  FABRICATION_PACKAGING: {
    label: 'Advanced Fabrication & Packaging', icon: '🏭',
    why: 'CoWoS advanced packaging at TSMC is the single-point bottleneck for every leading-edge AI accelerator. Capacity doubles every 18 months but demand outpaces it.',
    supply: 'TSMC CoWoS-L/S: ~35K wpm 2024, ~70K wpm targeted 2026. Intel Foveros and Samsung I-Cube sub-scale. ASML High-NA EUV gating N2/A16 ramp.',
    demand: 'Nvidia alone consumes 60%+ of CoWoS. AMD MI300/MI350, AWS Trainium, Google TPU all share remaining. Demand 80%+ YoY.',
    winners: [{ ticker: 'TSM', thesis: 'TSMC: monopoly advanced packaging, CoWoS pricing power' }, { ticker: 'ASML', thesis: 'ASML: sole EUV/High-NA supplier, 2-year backlog' }, { ticker: 'AMAT', thesis: 'Applied Materials: advanced packaging tools' }],
    losers: [{ ticker: 'INTC', thesis: 'Intel Foundry behind on advanced packaging' }],
    confirms: ['TSMC CoWoS price increase or capacity allocation announcement', 'ASML order backlog growing / delivery slots pushed out', 'NVDA B200 yield improvement news (CoWoS driven)', 'New CoWoS customer announced (AMD, AWS, Google, Meta)'],
    breaks: ['Fan-out panel level packaging (FOPLP) scales and bypasses CoWoS', 'Samsung I-Cube or Intel Foveros qualifies at NVDA', 'TSMC CoWoS capacity doubles ahead of schedule'],
    watch_kpi: ['TSMC CoWoS utilization rate (should be >95%)', 'ASML book-to-bill ratio', 'NVDA gross margin on H/B series (packaging cost impact)', 'Advanced packaging capex announcements from OSAT players'],
  },
  COMPUTE_SCALING: {
    label: 'Compute & GPU Allocation', icon: '⚡',
    why: 'GPU supply remains rationed by Nvidia. H100/H200 allocation relationship-driven. Blackwell ramp gated by CoWoS. Tier-2 clouds and enterprises wait 6–12 months.',
    supply: 'Nvidia ships what TSMC packages. MI300X/MI325X the only meaningful alternative; TPU/Trainium captive to respective hyperscalers.',
    demand: 'Hyperscaler AI capex ~$300B/yr, projected $450B+ 2026. Sovereign AI funds, neoclouds, enterprise inference all competing for allocation.',
    winners: [{ ticker: 'NVDA', thesis: 'Nvidia: allocation monopoly, 75%+ gross margin' }, { ticker: 'AMD', thesis: 'AMD: MI series captures tier-2 demand' }, { ticker: 'AVGO', thesis: 'Broadcom: custom ASIC (TPU, MTIA)' }],
    losers: [{ ticker: 'CRWV', thesis: 'Neoclouds dependent on NVDA allocation' }],
    confirms: ['Hyperscaler capex guidance raised (MSFT/META/AMZN/GOOG)', 'NVDA data center revenue beats + guides higher', 'AMD MI300X customer wins at tier-2 clouds', 'Sovereign AI deals announced (UAE, India, Japan)'],
    breaks: ['Open-source model breakthrough cuts compute requirements by 10×', 'US export restrictions tightened on Nvidia H/B series', 'Hyperscaler capex guidance cut materially'],
    watch_kpi: ['NVDA data center revenue quarterly trajectory', 'Hyperscaler AI capex guidance in earnings calls', 'AMD MI series customer count', 'GPU spot market pricing on AWS/Azure'],
  },
  POWER_GRID: {
    label: 'Power & Grid Constraints', icon: '🔌',
    why: 'Data center power demand outpaces grid interconnect timelines by 3–7 years. Transformer, switchgear, and HV cable lead times are 80–130 weeks.',
    supply: 'Only 3 major transformer OEMs globally. Grain-oriented electrical steel (GOES) constrained. Utility interconnect queues span 5–10 years in PJM/ERCOT.',
    demand: 'AI data center nameplate demand: 50 GW US by 2030 (Goldman, EPRI). Hyperscaler site selection now power-first.',
    winners: [{ ticker: 'GEV', thesis: 'GE Vernova: grid equipment, transformers' }, { ticker: 'ETN', thesis: 'Eaton: switchgear, UPS, electrical backbone' }, { ticker: 'VRT', thesis: 'Vertiv: power/cooling for data centers' }],
    losers: [],
    confirms: ['Transformer lead times quoted >100 weeks by GEV/ABB/Siemens', 'Hyperscaler data center site cancellations citing power availability', 'PJM/ERCOT interconnect queue backlogs disclosed in utility filings', 'GEV/ETN order backlog growing, pricing increasing'],
    breaks: ['Nuclear SMRs deploy on-site at hyperscalers at scale by 2027', 'Grid modernization bill passes with massive transformer subsidies', 'AI inference efficiency reduces per-GPU power consumption >50%'],
    watch_kpi: ['GEV order backlog (should keep growing)', 'ETN data center-specific revenue segment', 'PJM/ERCOT interconnect queue length (public)', 'Large power transformer lead time surveys from industry publications'],
  },
  NUCLEAR_ENERGY: {
    label: 'Nuclear Energy', icon: '☢️',
    why: 'Hyperscalers pivoting to nuclear PPAs for 24/7 carbon-free baseload. SMRs and restart of retired plants are the only GW-scale path this decade.',
    supply: 'Enriched uranium supply constrained post-Russia sanctions. Centrus and Urenco ramping HALEU slowly. SMR deployments 2028–2032.',
    demand: 'MSFT/Three Mile Island, AMZN/Talen, GOOG/Kairos, META SMR RFP — every hyperscaler has inked nuclear deals.',
    winners: [{ ticker: 'CCJ', thesis: 'Cameco: uranium mining leader' }, { ticker: 'LEU', thesis: 'Centrus: HALEU enrichment monopoly' }, { ticker: 'CEG', thesis: 'Constellation: Three Mile Island restart, MSFT PPA' }],
    losers: [],
    confirms: ['New hyperscaler nuclear PPA announcement', 'NRC license approval for SMR design', 'HALEU enrichment capacity expansion announcement', 'Uranium spot price above $100/lb'],
    breaks: ['Next-gen solar + battery storage achieves <$20/MWh 24/7 cost', 'NRC license denials for multiple SMR projects', 'US-Russia nuclear fuel deal reinstated at scale'],
    watch_kpi: ['Uranium spot price (cameco.com/investors)', 'NRC SMR licensing pipeline', 'Hyperscaler % of power from carbon-free sources', 'CEG/TLN nuclear generation capacity utilization'],
  },
  THERMAL_COOLING: {
    label: 'Thermal & Cooling', icon: '❄️',
    why: 'Blackwell and beyond require direct-to-chip liquid cooling. Retrofit impractical; new builds 100% liquid-cooled. CDU and cold-plate supply sold out.',
    supply: 'CoolIT, Motivair, Boyd, Asetek are the main CDU vendors. Cold plate supply concentrated in Taiwan.',
    demand: 'NVL72 racks = 120+ kW/rack. Every new AI data center must deploy liquid cooling.',
    winners: [{ ticker: 'VRT', thesis: 'Vertiv: liquid cooling + power thermal management' }, { ticker: 'SMCI', thesis: 'Supermicro: liquid-cooled rack integration' }],
    losers: [],
    confirms: ['VRT liquid cooling revenue growing >50% YoY', 'New hyperscaler DC build announcement specifying 100% liquid cooling', 'CDU/cold plate lead times >20 weeks', 'SMCI liquid-cooled rack backlog mentioned in earnings'],
    breaks: ['Immersion cooling becomes dominant (different supply chain)', 'NVDA next chip reduces power consumption below air-cooling threshold', 'New CDU suppliers entering at scale in Taiwan/Korea'],
    watch_kpi: ['VRT liquid cooling % of revenue', 'SMCI liquid cooling attach rate per rack', 'kW/rack specification in new DC construction permits', 'CoolIT/Boyd private company capacity news'],
  },
  MATERIALS_SUPPLY: {
    label: 'Critical Materials', icon: '⛏️',
    why: 'Gallium, germanium, neon, rare earths, and high-purity quartz gating semi and defense supply chains. China export controls accelerating bifurcation.',
    supply: 'China controls 80%+ of gallium/germanium processing, 90%+ of rare earth refining. Alternative supply 3–7 years out.',
    demand: 'AI, defense, EV, and renewable electrification all drawing from same materials stack. Demand 2–3× by 2030.',
    winners: [{ ticker: 'MP', thesis: 'MP Materials: US rare earth independence' }, { ticker: 'AXTI', thesis: 'AXT Inc: InP/GaAs substrates — "Strait of AXTI"' }],
    losers: [],
    confirms: ['China tightens gallium/germanium export quotas', 'AXTI named in new hyperscaler photonics roadmap', 'DoD awards critical minerals contract to US domestic producer', 'Spot price for gallium/germanium rising >20% QoQ'],
    breaks: ['Recycling technology recovers >50% of critical materials from e-waste', 'Major new gallium deposits developed outside China at scale', 'Compound semiconductors replaced by silicon-only alternatives in photonics'],
    watch_kpi: ['Gallium spot price (should be rising)', 'China MOFCOM export quota announcements', 'AXTI quarterly substrate shipment volume', 'MP Materials NdFeB magnet production ramp'],
  },
  QUANTUM_CRYOGENICS: {
    label: 'Quantum & Cryogenics', icon: '🧊',
    why: 'Quantum hardware gated by dilution refrigerators, helium-3, and cryo electronics. Scale-up of logical qubits is the decade-long bottleneck.',
    supply: 'Bluefors, Oxford Instruments dominate dilution fridges. Helium-3 supply constrained by tritium decay chain.',
    demand: 'Sovereign quantum programs (US DOE, EU, China, India) + hyperscaler R&D (IBM, Google, MSFT, AMZN). Demand inelastic.',
    winners: [{ ticker: 'IBM', thesis: 'IBM: largest gate-based quantum fleet' }, { ticker: 'IONQ', thesis: 'IonQ: trapped-ion roadmap' }],
    losers: [],
    confirms: ['IBM logical qubit count doubles on schedule', 'DOE/NSF quantum computing contract awards growing', 'Bluefors dilution fridge lead times >12 months', 'New national quantum initiative funding announcement'],
    breaks: ['Classical computing solves target problems before quantum does', 'Room-temperature qubit technology validated at scale', 'He-3 alternative cryogenic technology works below 20mK'],
    watch_kpi: ['IBM quantum volume trajectory', 'IonQ / Rigetti customer count and revenue', 'Helium-3 spot price', 'Government quantum initiative budget lines'],
  },
};

// ── Conference calendar ───────────────────────────────────────────────────────

interface Conference {
  name: string; date: string; theme: string; relevance: string;
  tags: string[]; url?: string;
}
const CONFERENCES: Conference[] = [
  { name: 'NVDA GTC',          date: 'Mar 2026', theme: 'AI Chips, CPO, Photonics',       relevance: 'Most important annual event — Jensen keynote moves supply chain stocks 20–50%', tags: ['PHOTONICS','COMPUTE','PACKAGING'], url: 'https://www.nvidia.com/gtc/' },
  { name: 'OFC',               date: 'Mar 2026', theme: 'Optical Fiber & Photonics',       relevance: 'Transceivers, silicon photonics, laser vendor roadmaps', tags: ['PHOTONICS','INTERCONNECT'], url: 'https://www.ofcconference.org/' },
  { name: 'SEMICON West',       date: 'Jul 2026', theme: 'Semiconductor Equipment',         relevance: 'Equipment maker plays — AMAT, KLAC, LRCX, ASML roadmaps', tags: ['EQUIPMENT','MATERIALS'], url: 'https://www.semiconwest.org/' },
  { name: 'Hot Chips',          date: 'Aug 2026', theme: 'AI Accelerators, Memory, Custom', relevance: 'Custom ASIC plays — AMD MI, Google TPU, AWS Trainium roadmaps', tags: ['COMPUTE','MEMORY'], url: 'https://hotchips.org/' },
  { name: 'TSMC OIP',           date: 'Oct 2026', theme: 'Advanced Packaging, Chiplets',   relevance: 'CoWoS, SoIC, substrate plays — packaging bottleneck visibility', tags: ['PACKAGING','FOUNDRY'], url: 'https://oipalliance.tsmc.com/' },
  { name: 'IEEE IEDM',          date: 'Dec 2026', theme: 'Advanced Nodes, Memory',          relevance: 'Materials and advanced transistor node roadmaps', tags: ['MATERIALS','MEMORY','FOUNDRY'], url: 'https://www.ieee.org/conferences/iedm' },
];

const TAG_COLORS: Record<string, string> = {
  PHOTONICS: '#06B6D4', COMPUTE: '#10B981', MEMORY: '#8B5CF6',
  PACKAGING: '#F59E0B', EQUIPMENT: '#0F7ABF', MATERIALS: '#EF4444',
  INTERCONNECT: '#06B6D4', FOUNDRY: '#F59E0B',
};

// ── Supply chain tiers ────────────────────────────────────────────────────────

const SUPPLY_CHAIN: { tier: number; label: string; color: string; companies: string[]; sub: string }[] = [
  { tier: 1, label: 'Raw Materials',          color: '#8B5CF6', companies: ['AXTI','MP','CCJ','LEU'],           sub: 'InP/GaAs crystals, Ge, rare earths, uranium, specialty gases' },
  { tier: 2, label: 'Substrates & Wafers',    color: '#7C3AED', companies: ['SOI (Soitec)','SUMCO','Shin-Etsu'], sub: 'Silicon-on-insulator, compound semiconductor substrates' },
  { tier: 3, label: 'Wafer Fab Equipment',    color: '#0F7ABF', companies: ['ASML','AMAT','LRCX','KLAC'],       sub: 'EUV lithography, CVD/PVD, etch, deposition, inspection' },
  { tier: 4, label: 'Foundries',              color: '#0284C7', companies: ['TSM','TSEM','Win Semi (3105)'],    sub: 'TSMC, GlobalFoundries, Tower Semiconductor, Samsung' },
  { tier: 5, label: 'Chip Designers',         color: '#0369A1', companies: ['NVDA','AMD','AVGO','MRVL','INTC'], sub: 'GPU, ASIC, custom silicon, photonic ICs' },
  { tier: 6, label: 'Photonic Components',    color: '#06B6D4', companies: ['COHR','LITE','AAOI','SIVE (STO)'],  sub: 'Lasers, EMLs, modulators, VCSELs, detectors' },
  { tier: 7, label: 'Modules & Transceivers', color: '#0891B2', companies: ['FNSR','JNPR','JBL','OCLR'],        sub: '400G/800G/1.6T optical transceiver modules' },
  { tier: 8, label: 'Test & Inspection',      color: '#10B981', companies: ['AEHR','FORM','TER','Advantest'],    sub: 'Wafer-level test, burn-in, SiC test equipment' },
  { tier: 9, label: 'Advanced Packaging',     color: '#059669', companies: ['ASX','AMKR','SPIL','IBIDEN'],       sub: 'CoWoS, HBM stacking, glass substrates, FOPLP' },
  { tier: 10, label: 'System Integration',    color: '#16A34A', companies: ['META','AMZN','MSFT','GOOGL','NVDA'], sub: 'Hyperscaler AI factories, NVL72, Trainium, TPU clusters' },
];

// ── Serenity Checklist items ──────────────────────────────────────────────────

const CHECKLIST_ITEMS = [
  { id: 'supply_chain',     label: 'Supply chain position mapped (draw tier 1–10 flowchart)', section: 'Supply Chain' },
  { id: 'competitors',      label: '< 3 public competitors confirmed globally',                section: 'Supply Chain' },
  { id: 'switching_cost',   label: 'Customer switching cost verified (multi-year qual cycle)', section: 'Supply Chain' },
  { id: 'tier1_customers',  label: '≥ 1 confirmed tier-1 hyperscaler / OEM customer',          section: 'Supply Chain' },
  { id: 'qual_stage',       label: 'Qualification stage identified: Pre-qual / Qual / Ramp / Volume', section: 'Qualification' },
  { id: 'qual_customers',   label: 'Customer count in qualification documented',               section: 'Qualification' },
  { id: 'qual_timeline',    label: 'Expected qualification completion date estimated',         section: 'Qualification' },
  { id: 'dilution_check',   label: 'Dilution check: shares outstanding growth < 10%/yr',      section: 'Capital' },
  { id: 'atm_check',        label: 'No ATM program > 20% of current market cap',              section: 'Capital' },
  { id: 'size_asymmetry',   label: 'Size asymmetry: market cap vs end-customer TAM ratio > 5x', section: 'Valuation' },
  { id: 'internal_pt',      label: 'Internal price target set (supply-demand math, Model 33)', section: 'Valuation' },
  { id: 'five_sources',     label: '5-source validation complete (press releases, SEC, conf PDFs, Wayback, IR)', section: 'Research' },
  { id: 'geopolitical',     label: 'Geopolitical overlay checked: helps or hurts this bottleneck?', section: 'Research' },
  { id: 'institutional',    label: 'Institutional tracking: 13F filed / analyst coverage < 5', section: 'Research' },
  { id: 'conference_cal',   label: 'Conference calendar entry added — position 4–6 weeks before event', section: 'Timing' },
];

// ── Junk ticker filter ────────────────────────────────────────────────────────

const JUNK = new Set([
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  'AI','AN','AS','AT','BE','BY','DO','GO','HE','IF','IN','IS','IT','ME','MY','NO','OF','ON','OR','SO','TO','UP','WE','UK','US','EU','UN',
  'EPS','PE','PB','ROE','ROA','FCF','EBITDA','EBIT','CAGR','YOY','QOQ','MOM','AUM','NAV','NPV','IRR','GAAP','IFRS','OPEX','CAPEX','WACC','DCF','IPO','ETF','ETH','BTC','DMA','ATH','NII','NIM','CASA','GNPA','NNPA','LTV','EMI','SIP','PPF','KYC','AML',
  'FED','RBI','ECB','BOE','BOJ','PBC','FOMC','SEC','SEBI','IRDAI','TRAI','CBI','CCI','NCLT',
  'USD','EUR','GBP','INR','JPY','CNY','CNH','AUD','CAD','CHF','SGD','HKD','SEK','NOK','DKK','NIFTY','SENSEX','SPX','NDX','DJI','VIX','TRY','ZAR','BRL','MXN','IDR','KRW','TWD','THB','PHP','VND',
  'API','CPU','GPU','HBM','HBM4','DRAM','SRAM','NAND','NOR','RAM','ROM','SSD','HDD','PCIe','EDA','CAD','CAM','ERP','CRM','SDK','IDE','CLI','FPGA','ASIC','IOT','AR','VR','XR','VPN','CDN','DNS','TCP','UDP','HTTP','HTTPS','ML','DL','LLM','NLP','CV',
  'CEO','CFO','CTO','COO','CMO','CHRO','MD','SVP','EVP','VP','GM','PM','HR','PR','IR','ESG',
  'GDP','CPI','WPI','PMI','PPI','IIP','MSCI','FTSE','EM','DM','FDI','FII','FPI',
  'UAE','GCC','MENA','APAC','EMEA','ASEAN','BRICS','G7','G20','NATO','OPEC','WTO','IMF','WB',
  'IPL','BPL','ISL','PKL','IND','AUS','ENG','PAK','GT','MI','CSK','KKR','RCB','SRH','DC','LSG','PBKS','RR','BCCI',
  'LTD','PVT','INC','LLC','CORP','PLC','AG','NV','SA','SPA','AB','AS','OY','GMBH',
  'FDA','DOE','DOD','DOJ','CFPB','IRS','CFTC','FINRA','FTC','BOI','SBI','PNB','IOB','BOB','UCO','SK',
  'ACC','DM','FY','TETRA','RTX','SM','EV','BI','TSMC','NET','AES','JSW','EVM','TMC','EC','ASP','MCX','FTA','ST','II','KR','GCC','EMYN','HUL','GLP','YD','ESAF','LIV','JBS','ATF','RPG','NPP','NPU','WAVE','SIEGY','GEV',
  'ALL','ARE','HAL','BEL','CAN','HAS','HAD','WAS','GET','GOT','SET','PUT','BID','ASK',
  'FFO','NMI','BOE','HUL','SSD','USD','EUR','KR','GLP','UP','FOMC',
]);

function isLikelyTicker(t: string): boolean {
  if (!t) return false;
  const u = t.toUpperCase();
  if (JUNK.has(u)) return false;
  if (!/^[A-Z]{2,6}(\.[A-Z]{1,2})?$/.test(u) && !/^[A-Z]{2,5}[0-9]$/.test(u)) return false;
  const vowels = u.replace(/[^AEIOU]/g, '').length;
  if (u.length === 3 && vowels === 0) return false;
  return true;
}

function getTickerSymbols(a: NewsArticle): string[] {
  const raw = a.ticker_symbols?.length
    ? a.ticker_symbols
    : (a.tickers ?? []).map(t => typeof t === 'string' ? t : (t as { ticker: string }).ticker ?? '').filter(Boolean);
  return raw.filter(t => isLikelyTicker(t));
}

// ── Serenity Score ────────────────────────────────────────────────────────────

function calcScore(row: { level?: string; evidence_count: number; sub_tag?: string; is_small_cap: boolean }): number {
  const lw: Record<string, number> = { CRITICAL: 40, BOTTLENECK: 25, WATCH: 12, RESOLVED: 2 };
  const lv = lw[(row.level ?? '').toUpperCase()] ?? 5;
  const ev = Math.min(30, Math.round(Math.log2(row.evidence_count + 1) * 10));
  const ti = row.sub_tag ? TIER_MAP[row.sub_tag] : undefined;
  const tb = ti ? Math.max(0, (7 - ti.tier) * 3) : 0;
  const sb = row.is_small_cap ? 12 : 0;
  return Math.min(100, lv + ev + tb + sb);
}
const scoreColor = (s: number) => s >= 80 ? '#EF4444' : s >= 60 ? '#F59E0B' : s >= 40 ? '#0F7ABF' : '#4A5B6C';

// ── Helpers ───────────────────────────────────────────────────────────────────

const timeAgo = (iso: string) => { try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return iso; } };
function cleanUrl(r: string) { if (!r || r === '#') return '#'; let u = r.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim(); const idx = u.indexOf('http', 1); if (idx > 0 && u.startsWith('http')) u = u.slice(idx); return u; }
function fmtCap(mc?: number) { if (!mc || mc <= 0) return '—'; if (mc >= 1e12) return `$${(mc / 1e12).toFixed(1)}T`; if (mc >= 1e9) return `$${(mc / 1e9).toFixed(1)}B`; if (mc >= 1e6) return `$${(mc / 1e6).toFixed(0)}M`; return `$${mc}`; }

function exchangeFlag(exchange?: string) {
  if (!exchange) return null;
  const e = exchange.toUpperCase();
  if (e.includes('NSE') || e.includes('BSE')) return { flag: '🇮🇳', label: 'India' };
  if (e.includes('STO') || e.includes('OMX')) return { flag: '🇸🇪', label: 'Sweden' };
  if (e.includes('TSE') || e.includes('JPX')) return { flag: '🇯🇵', label: 'Japan' };
  if (e.includes('KRX') || e.includes('KOS')) return { flag: '🇰🇷', label: 'Korea' };
  if (e.includes('FRA') || e.includes('XETRA')) return { flag: '🇩🇪', label: 'Germany' };
  if (e.includes('TWO') || e.includes('TWSE')) return { flag: '🇹🇼', label: 'Taiwan' };
  return null;
}

// ── API hooks ─────────────────────────────────────────────────────────────────

function useDashboard() {
  return useQuery<BnDashboard>({
    queryKey: ['bn', 'dashboard'],
    queryFn: async () => { const r = await fetch('/api/v1/news/bottleneck-dashboard'); if (!r.ok) throw new Error(''); return r.json(); },
    refetchInterval: 180_000, staleTime: 120_000, retry: 1,
  });
}
function useBNNews() {
  return useQuery<NewsArticle[]>({
    queryKey: ['bn', 'news'],
    queryFn: async () => { const r = await fetch('/api/v1/news?limit=400&importance_min=2&article_type=BOTTLENECK'); if (!r.ok) throw new Error(''); const d = await r.json(); return Array.isArray(d) ? d : []; },
    refetchInterval: 90_000, staleTime: 60_000, retry: 1,
  });
}
function useGeoNews() {
  return useQuery<NewsArticle[]>({
    queryKey: ['bn', 'geo'],
    queryFn: async () => {
      const [r1, r2] = await Promise.all([
        fetch('/api/v1/news?limit=80&importance_min=2&article_type=GEOPOLITICAL'),
        fetch('/api/v1/news?limit=80&importance_min=2&article_type=TARIFF'),
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      const merged = [...(Array.isArray(d1) ? d1 : []), ...(Array.isArray(d2) ? d2 : [])];
      return merged.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()).slice(0, 60);
    },
    refetchInterval: 90_000, staleTime: 60_000, retry: 1,
  });
}
function useUSQuotes() {
  return useQuery<QuoteStock[]>({
    queryKey: ['bn', 'us-quotes'],
    queryFn: async () => { try { const r = await fetch('/api/market/quotes?market=us'); if (!r.ok) return []; const d = await r.json(); return Array.isArray(d?.stocks) ? d.stocks : []; } catch { return []; } },
    refetchInterval: 60_000, staleTime: 45_000, retry: 1,
  });
}

// ── Serenity Universe — curated from framework document ──────────────────────
// These are the stocks Serenity explicitly covers or would look at per her framework.
// The scanner shows these + enriches with live news evidence + live prices.

interface UniverseStock {
  ticker: string;
  name: string;
  exchange: string;      // NYSE | NASDAQ | STO | TSE | KRX | TWO | FRA | OTC
  sub_tag: string;
  val_tier: number;      // 1 = raw materials (most upstream / most asymmetric)
  competitors: string;   // "1 public" | "2–3 public" | "3–5 public" | ">5 public"
  key_customers: string[]; // who they supply → ultimately hyperscalers
  serenity_note: string;
  is_serenity_pick: boolean; // explicitly mentioned by Serenity
  models: number[];
}

const SERENITY_UNIVERSE: UniverseStock[] = [
  // ── T1: Raw Materials / Substrates (most upstream = highest asymmetry) ──────
  {
    ticker: 'AXTI', name: 'AXT Inc', exchange: 'NASDAQ', sub_tag: 'MATERIALS_SUPPLY', val_tier: 1,
    competitors: '2–3 public', key_customers: ['COHR','LITE','SIVE','II-VI'],
    serenity_note: '"Strait of AXTI" — 20% of world oil through Strait of Hormuz = AXTI for InP/GaAs substrates. Vertically integrated: crystal growth → wafer slicing → epi deposition → quality cert. +5,579% YTD example. CHIPS Act strategic. DoD critical material.',
    is_serenity_pick: true, models: [25, 2, 6, 36],
  },
  {
    ticker: 'SIVE', name: 'Sivers Semiconductors', exchange: 'STO', sub_tag: 'INTERCONNECT_PHOTONICS', val_tier: 2,
    competitors: '1 public', key_customers: ['JBL','MRVL','O-Net','Ayar Labs','Celestial AI'],
    serenity_note: "Serenity's #1 cross-border pick. CW laser light source for Jabil 1.6T LRO, Marvell CPO, AMD CPO via Ayar. ~€140M MC when flagged. 'The next $LITE markets missed.' DNB bank later validated. Apple InP laser arrays rumoured for consumer hardware.",
    is_serenity_pick: true, models: [2, 6, 10, 34, 31],
  },
  {
    ticker: 'MP', name: 'MP Materials', exchange: 'NYSE', sub_tag: 'MATERIALS_SUPPLY', val_tier: 1,
    competitors: '2–3 public', key_customers: ['GM','Raytheon','DoD','semi OEMs'],
    serenity_note: 'US rare earth independence — only domestic rare earth miner + processor. Magnet manufacturing coming online. DoD contract. China controls 90% of global refining; geopolitical decoupling = MP direct beneficiary.',
    is_serenity_pick: false, models: [29, 36],
  },
  {
    ticker: 'SOI', name: 'Soitec', exchange: 'STO', sub_tag: 'MATERIALS_SUPPLY', val_tier: 2,
    competitors: '1 public', key_customers: ['TSMC','GlobalFoundries','STMicro'],
    serenity_note: 'Photonics-SOI substrates used in 100% of next-gen AI data center optical chips. Serenity entered ~€43 → +140% in one month. "Like a Shiny Zigzagoon." No substitute for Photonics-SOI in silicon photonics.',
    is_serenity_pick: true, models: [2, 6, 10],
  },
  {
    ticker: 'LPK', name: 'LPKF Laser & Electronics', exchange: 'FRA', sub_tag: 'FABRICATION_PACKAGING', val_tier: 2,
    competitors: '1 public', key_customers: ['TSMC CoPoS','glass substrate makers'],
    serenity_note: '~€210M cap. Critical chokepoint for LIDE (Laser Induced Deep Etching) in glass core substrates. Deep IP moat. "Possible TSM CoPoS link." Qual-cycle play — ignore quarterly revenue noise per Model 3. Revenue will ramp AFTER qual.',
    is_serenity_pick: true, models: [2, 3, 6],
  },
  // ── T2-T3: Foundry / Equipment ────────────────────────────────────────────
  {
    ticker: 'TSEM', name: 'Tower Semiconductor', exchange: 'NASDAQ', sub_tag: 'FABRICATION_PACKAGING', val_tier: 3,
    competitors: '3–5 public', key_customers: ['MRVL','AVGO','STMicro','Apple'],
    serenity_note: '"TSM of photonics" — the foundry that manufactures photonic chips. CPO customers ramp → Tower gets fab orders BEFORE chip designers see revenue. $113 → $226 in 40 days = Serenity\'s 16th 100%+ return. Two-phase play: buy foundry first, rotate to chip designer later.',
    is_serenity_pick: true, models: [20, 4],
  },
  {
    ticker: 'WIN3105', name: 'Win Semiconductors (3105)', exchange: 'TWO', sub_tag: 'FABRICATION_PACKAGING', val_tier: 3,
    competitors: '2–3 public', key_customers: ['QCOM','Skyworks','pHEMT OEMs'],
    serenity_note: '"One of the most important foundries in the world aside from $TSM." GaAs/InP compound semiconductor foundry. $4.1B MC when Serenity posted. Zero US analyst coverage on Taiwan OTC. Pure cross-border arbitrage. Supplies entire wireless infrastructure stack.',
    is_serenity_pick: true, models: [10, 2, 31],
  },
  {
    ticker: 'ASML', name: 'ASML', exchange: 'NASDAQ', sub_tag: 'FABRICATION_PACKAGING', val_tier: 3,
    competitors: '1 public', key_customers: ['TSMC','Samsung','Intel'],
    serenity_note: 'Sole supplier of EUV and High-NA EUV lithography. 2-year backlog. Every advanced chip goes through ASML tools. Classic Serenity Model 2 — zero substitutability, customers cannot switch. Large-cap anchor for the basket (Model 28).',
    is_serenity_pick: false, models: [2, 7],
  },
  {
    ticker: 'AMAT', name: 'Applied Materials', exchange: 'NASDAQ', sub_tag: 'FABRICATION_PACKAGING', val_tier: 3,
    competitors: '3–5 public', key_customers: ['TSMC','Samsung','Intel','Micron'],
    serenity_note: 'Advanced packaging tools and CVD/PVD equipment. CoWoS and hybrid bonding tooling demand growing as packaging becomes the bottleneck. Two-phase play: equipment maker benefits before pure-play packaging companies.',
    is_serenity_pick: false, models: [20],
  },
  // ── T4: Photonics / Memory / Test ────────────────────────────────────────
  {
    ticker: 'COHR', name: 'Coherent', exchange: 'NYSE', sub_tag: 'INTERCONNECT_PHOTONICS', val_tier: 4,
    competitors: '3–5 public', key_customers: ['META','MSFT','AMZN','GOOG'],
    serenity_note: "Transceivers, EMLs, VCSELs. Well-covered by analysts — Serenity says go UPSTREAM to COHR's suppliers (AXTI, SIVE). However, vertical integration thesis: COHR may acquire AXTI to secure substrate supply, creating M&A premium (Model 27). Tier-1 OEM.",
    is_serenity_pick: true, models: [27, 28],
  },
  {
    ticker: 'LITE', name: 'Lumentum', exchange: 'NASDAQ', sub_tag: 'INTERCONNECT_PHOTONICS', val_tier: 4,
    competitors: '3–5 public', key_customers: ['COHR','JNPR','CSCO'],
    serenity_note: 'InP lasers for CPO. Serenity held $LITE for +5% while holding SIVE for +12.69% — proves upstream picks outperform. On GFS AI photonics roadmap. Use as thesis confirmation, position in suppliers for alpha.',
    is_serenity_pick: true, models: [4, 28],
  },
  {
    ticker: 'MRVL', name: 'Marvell Technology', exchange: 'NASDAQ', sub_tag: 'INTERCONNECT_PHOTONICS', val_tier: 4,
    competitors: '3–5 public', key_customers: ['MSFT Maia','AWS Trainium','GOOG','META'],
    serenity_note: "2–3x revenue growth from MSFT Maia ramp. Custom ASIC + CPO DSP. Serenity's core basket holding (Model 28). Uses SIVE lasers for CPO → MRVL is downstream of SIVE. Buy both but expect SIVE to 10x first.",
    is_serenity_pick: true, models: [28, 18],
  },
  {
    ticker: 'AVGO', name: 'Broadcom', exchange: 'NASDAQ', sub_tag: 'COMPUTE_SCALING', val_tier: 5,
    competitors: '3–5 public', key_customers: ['GOOG TPU','META MTIA','Apple','AMZN'],
    serenity_note: 'Custom ASIC leader. Long hyperscaler ASIC — every major hyperscaler uses Broadcom custom silicon. Tomahawk 5 switches + CPO reference design. Core basket holding for correlated AI capex upside.',
    is_serenity_pick: true, models: [28, 18],
  },
  {
    ticker: 'AAOI', name: 'Applied Optoelectronics', exchange: 'NASDAQ', sub_tag: 'INTERCONNECT_PHOTONICS', val_tier: 4,
    competitors: '3–5 public', key_customers: ['major hyperscaler (undisclosed)'],
    serenity_note: '$71M + $53M = $124M in new orders from a single hyperscaler since mid-March. 800G single-mode DC transceivers. Serenity posted this as the PERFECT example of qual→ramp→visible orders cycle. Was $25, went to $104 in months. Model 26: count qual engagements, not P/E.',
    is_serenity_pick: true, models: [26, 3, 34],
  },
  {
    ticker: 'MU', name: 'Micron Technology', exchange: 'NASDAQ', sub_tag: 'MEMORY_STORAGE', val_tier: 4,
    competitors: '3 public', key_customers: ['NVDA','AMD','hyperscalers'],
    serenity_note: 'HBM3E ramp. One of only 3 HBM producers globally (SK Hynix, Samsung, Micron). CHIPS Act funding recipient = government-validated bottleneck. Capex leverage play for AI memory supercycle.',
    is_serenity_pick: false, models: [36, 28],
  },
  {
    ticker: 'AEHR', name: 'Aehr Test Systems', exchange: 'NASDAQ', sub_tag: 'MEMORY_STORAGE', val_tier: 4,
    competitors: '2–3 public', key_customers: ['SiC wafer producers','HBM makers'],
    serenity_note: '"$420 looks inevitable on $AEHR. Have never seen so many hyperscalers qualifying a $1.1B company before." Wafer-level burn-in for SiC + HBM. Qual-cycle play par excellence. Revenue lags design wins by 12-24 months — the market misreads the lag as failure.',
    is_serenity_pick: true, models: [3, 26, 2],
  },
  // ── T4: Test / Easter Eggs (Model 24) ────────────────────────────────────
  {
    ticker: 'FORM', name: 'FormFactor', exchange: 'NASDAQ', sub_tag: 'FABRICATION_PACKAGING', val_tier: 4,
    competitors: '2–3 public', key_customers: ['TSMC','Intel','AMD','Micron'],
    serenity_note: 'Silicon photonics wafer test bottleneck. Easter egg from "Silicon photonics scaling hits wafer testing bottleneck" headline. Small-cap niche wafer test alongside AEHR. Model 24: convert headline to stock list.',
    is_serenity_pick: true, models: [24],
  },
  // ── T5: Compute / Cooling ────────────────────────────────────────────────
  {
    ticker: 'NVDA', name: 'Nvidia', exchange: 'NASDAQ', sub_tag: 'COMPUTE_SCALING', val_tier: 5,
    competitors: '2–3 public', key_customers: ['all hyperscalers','neoclouds','enterprises'],
    serenity_note: "Allocation monopoly, 75%+ gross margin. But Serenity says don't stop here — trace backward to who supplies NVDA's packaging, lasers, memory. NVDA itself is Tier 5; the 10x plays are Tier 1-3 upstream.",
    is_serenity_pick: false, models: [1, 18],
  },
  {
    ticker: 'AMD', name: 'AMD', exchange: 'NASDAQ', sub_tag: 'COMPUTE_SCALING', val_tier: 5,
    competitors: '2–3 public', key_customers: ['hyperscalers','cloud providers'],
    serenity_note: 'MI300X/MI325X captures tier-2 GPU demand. AMD CPO roadmap via Ayar Labs uses SIVE lasers. Downstream anchor in Serenity basket. Traces to TSEM (foundry), SIVE (lasers), AXTI (substrates) upstream.',
    is_serenity_pick: false, models: [28],
  },
  {
    ticker: 'VRT', name: 'Vertiv Holdings', exchange: 'NYSE', sub_tag: 'THERMAL_COOLING', val_tier: 5,
    competitors: '3–5 public', key_customers: ['hyperscalers','colo operators','telecos'],
    serenity_note: 'NVL72 racks = 120+ kW/rack → every new AI DC must deploy liquid cooling. Vertiv does both power + thermal. CDU and cold plate supply sold out. Lead times 40–80 weeks. Power + cooling = two bottlenecks in one ticker.',
    is_serenity_pick: false, models: [4],
  },
  {
    ticker: 'SMCI', name: 'Super Micro Computer', exchange: 'NASDAQ', sub_tag: 'THERMAL_COOLING', val_tier: 5,
    competitors: '3–5 public', key_customers: ['NVDA channel','hyperscalers'],
    serenity_note: 'Liquid-cooled rack integration — direct rack-scale deployment for Blackwell. BUT: Serenity Anti-Dilution Filter (Model 19) — check shares outstanding growth and SBC before sizing. High revenue growth but dilution history.',
    is_serenity_pick: false, models: [19, 21],
  },
  {
    ticker: 'NBIS', name: 'Nebius Group', exchange: 'NASDAQ', sub_tag: 'COMPUTE_SCALING', val_tier: 5,
    competitors: '3–5 public', key_customers: ['enterprise AI','developers'],
    serenity_note: '"One of them ends up as the next AWS in 5 years." +61.1% YTD vs $IREN -7.9%. This is Serenity\'s Neocloud Filter (Model 21): real GPU cloud infrastructure vs marketing story. NBIS = real infra. IREN = rental with $6B ATM dilution.',
    is_serenity_pick: true, models: [21, 19],
  },
  // ── T6: Power / Nuclear ─────────────────────────────────────────────────
  {
    ticker: 'GEV', name: 'GE Vernova', exchange: 'NYSE', sub_tag: 'POWER_GRID', val_tier: 6,
    competitors: '3–5 public', key_customers: ['utilities','data center developers'],
    serenity_note: 'Grid equipment + transformers. 80–130 week lead times on large power transformers — only 3 major OEMs globally. AI DC nameplate demand: 50 GW US by 2030. Utility interconnect queues span 5–10 years.',
    is_serenity_pick: false, models: [4],
  },
  {
    ticker: 'ETN', name: 'Eaton Corporation', exchange: 'NYSE', sub_tag: 'POWER_GRID', val_tier: 6,
    competitors: '3–5 public', key_customers: ['data centers','utilities','industrial'],
    serenity_note: 'Switchgear, UPS, electrical backbone for AI data centers. Power-first site selection = Eaton sells before shovels go in the ground. Grain-oriented electrical steel (GOES) constraint driving pricing power.',
    is_serenity_pick: false, models: [4],
  },
  {
    ticker: 'CEG', name: 'Constellation Energy', exchange: 'NASDAQ', sub_tag: 'NUCLEAR_ENERGY', val_tier: 6,
    competitors: '3–5 public', key_customers: ['MSFT (Three Mile Island PPA)'],
    serenity_note: 'Three Mile Island restart + Microsoft PPA. Hyperscalers pivoting to nuclear for 24/7 carbon-free baseload. SMR + existing fleet. Government policy tailwind (IRA nuclear credits). Demand inelastic from hyperscaler PPAs.',
    is_serenity_pick: false, models: [36, 29],
  },
  {
    ticker: 'CCJ', name: 'Cameco', exchange: 'NYSE', sub_tag: 'NUCLEAR_ENERGY', val_tier: 1,
    competitors: '3–5 public', key_customers: ['utilities','nuclear operators globally'],
    serenity_note: 'Uranium mining leader. Enriched uranium supply constrained post-Russia sanctions. Every new nuclear PPA needs long-term uranium supply. Centrus and Urenco ramping HALEU slowly — Cameco bridges the gap.',
    is_serenity_pick: false, models: [29, 36],
  },
  {
    ticker: 'LEU', name: 'Centrus Energy', exchange: 'NYSE', sub_tag: 'NUCLEAR_ENERGY', val_tier: 1,
    competitors: '1 public', key_customers: ['US DOE','nuclear operators'],
    serenity_note: 'HALEU (High-Assay Low-Enriched Uranium) enrichment monopoly in the US. SMR reactors require HALEU. Only domestic producer. DOE contract. If SMRs ramp 2028–2032, Centrus is the single-point supply constraint.',
    is_serenity_pick: false, models: [2, 36],
  },
  // ── Cross-border plays (Model 10) ─────────────────────────────────────────
  {
    ticker: 'TOWA6315', name: 'Towa Corp (6315)', exchange: 'TSE', sub_tag: 'FABRICATION_PACKAGING', val_tier: 3,
    competitors: '1 public', key_customers: ['Micron','SK Hynix','Samsung'],
    serenity_note: '"A rare, living definition of monopoly over HBM4 compression molding." ~$1.35B cap. Every major memory company is their customer. +20% YTD when posted. Zero US coverage. Classic Model 10 cross-border arb — Japanese precision manufacturing monopoly.',
    is_serenity_pick: true, models: [2, 10, 6],
  },
  {
    ticker: 'AUROS322310', name: 'Auros (322310)', exchange: 'KRX', sub_tag: 'FABRICATION_PACKAGING', val_tier: 3,
    competitors: '2–3 public', key_customers: ['SK Hynix','Samsung (HBM4e)'],
    serenity_note: '~$210M cap. SK Hynix + Samsung supplier for HBM4e hybrid bonding. Compared by Serenity to SIVE + CPO + AEHR for memory. Sub-$250M company supplying the companies making HBM for Nvidia. Pure size asymmetry play.',
    is_serenity_pick: true, models: [6, 10, 31],
  },
  {
    ticker: 'QDLASER6613', name: 'QD Laser (6613)', exchange: 'TSE', sub_tag: 'INTERCONNECT_PHOTONICS', val_tier: 2,
    competitors: '2–3 public', key_customers: ['data center module makers'],
    serenity_note: '+226% YTD. Quantum dot laser for next-gen photonics. Two-phase play: first buy $ALRIB (Aixtron) — the MBE machine supplier. Then pivot to QD Laser once production qualification confirmed. "Safest way: unknown MBE machine suppliers early on."',
    is_serenity_pick: true, models: [20, 10],
  },
  {
    ticker: 'ALRIB', name: 'Aixtron SE', exchange: 'FRA', sub_tag: 'FABRICATION_PACKAGING', val_tier: 2,
    competitors: '2–3 public', key_customers: ['QD Laser','compound semi makers','SiC epi'],
    serenity_note: 'MBE/MOCVD deposition equipment maker — the machine that MAKES the compound semi wafers. Phase 1 of Serenity\'s two-phase play: "Buy Aixtron early on, then pivot to pure-play lasers when qual → ramp." Predictable revenue: QD Laser needs Aixtron to scale.',
    is_serenity_pick: true, models: [20],
  },
  // ── Materials geopolitical plays (Model 25, 29) ─────────────────────────
  {
    ticker: 'AXTI', name: 'AXT Inc (duplicate check)', exchange: 'NASDAQ', sub_tag: 'MATERIALS_SUPPLY', val_tier: 1,
    competitors: '2–3 public', key_customers: ['COHR','LITE','photonic chip makers'],
    serenity_note: 'See first entry — AXTI is Serenity\'s primary example of Model 25 (Strait of Hormuz = Strait of AXTI). Geopolitical thesis: US domestic InP substrate = strategic asset if Iran tensions disrupt Middle East.',
    is_serenity_pick: true, models: [25],
  },
];

// Deduplicate by ticker (AXTI appears twice intentionally for different thesis angles — keep first)
const UNIVERSE_DEDUPED = SERENITY_UNIVERSE.filter((u, i, arr) => arr.findIndex(x => x.ticker === u.ticker) === i);

// ── Scanner enrichment ────────────────────────────────────────────────────────

// ── Evidence velocity engine ──────────────────────────────────────────────────
// Measures momentum: articles in last 7 days vs prior 7 days per ticker/layer.
// Rising velocity = thesis gaining confirmation → boost score and show 🔥
// This is the dynamic layer that makes the scanner theme-driven, not static.

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function calcVelocity(articles: NewsArticle[], matchFn: (a: NewsArticle) => boolean): {
  week: number; prev: number; trend: '🔥' | '📉' | '→'; isNew: boolean; accel: number;
} {
  const now = Date.now();
  let week = 0, prev = 0;
  for (const a of articles) {
    if (!matchFn(a)) continue;
    const age = now - new Date(a.published_at).getTime();
    if (age < WEEK_MS) week++;
    else if (age < 2 * WEEK_MS) prev++;
  }
  const ratio = prev === 0 ? week : week / prev;
  const trend: '🔥' | '📉' | '→' = ratio >= 1.5 ? '🔥' : ratio <= 0.5 && prev > 0 ? '📉' : '→';
  const accel = Math.min(12, Math.round((ratio - 1) * 6)); // -6 to +12 velocity bonus
  return { week, prev, trend, isNew: week > 0 && week >= prev, accel };
}

function calcBucketVelocity(articles: NewsArticle[], bucketId: string) {
  return calcVelocity(articles, a => a.bottleneck_sub_tag === bucketId);
}

interface EnrichedStock extends UniverseStock {
  evidence_count: number;
  headlines: string[];
  latest_at?: string;
  price?: number;
  market_cap?: number;
  change_pct?: number;
  quote_name?: string;
  is_small_cap: boolean;
  score: number;
  velocity: { week: number; prev: number; trend: '🔥' | '📉' | '→'; isNew: boolean; accel: number };
}

function buildEnrichedStocks(articles: NewsArticle[], quotes: QuoteStock[]): EnrichedStock[] {
  // Build evidence map from live articles
  const evidenceMap = new Map<string, { count: number; headlines: string[]; latest: string }>();
  for (const a of articles) {
    for (const sym of getTickerSymbols(a)) {
      const key = sym.toUpperCase();
      if (!evidenceMap.has(key)) evidenceMap.set(key, { count: 0, headlines: [], latest: '' });
      const e = evidenceMap.get(key)!;
      e.count++;
      const h = a.title || a.headline || '';
      if (h && e.headlines.length < 3 && !e.headlines.includes(h)) e.headlines.push(h);
      if (!e.latest || a.published_at > e.latest) e.latest = a.published_at;
    }
  }
  // Build quote map
  const qm = new Map<string, QuoteStock>(quotes.map(q => [q.ticker.toUpperCase(), q]));

  return UNIVERSE_DEDUPED.map((u): EnrichedStock => {
    // Match quotes by short ticker (strip exchange suffix like 6315, 322310)
    const shortTicker = u.ticker.replace(/\d+$/, '').toUpperCase();
    const q = qm.get(u.ticker.toUpperCase()) ?? qm.get(shortTicker);
    const ev = evidenceMap.get(u.ticker.toUpperCase()) ?? evidenceMap.get(shortTicker);
    const mc = q?.marketCap;
    const isSC = !!(mc && mc > 0 && mc < 2_000_000_000);
    const evidenceCount = ev?.count ?? 0;

    // Serenity Score:
    // - Upstream bonus: earlier in value chain = rarer = more asymmetric
    const upstreamBonus = Math.max(0, (10 - u.val_tier) * 7); // T1=63, T2=56, T3=49, ..., T10=0
    // - Size asymmetry bonus
    const sizeBonus = isSC ? 15 : (mc && mc < 10_000_000_000 ? 5 : 0);
    // - Cross-border arb bonus (non-US = info asymmetry)
    const nonUsBonuses: Record<string, number> = { STO: 12, TSE: 12, KRX: 12, TWO: 10, FRA: 8 };
    const arb = nonUsBonuses[u.exchange] ?? 0;
    // - Serenity explicit mention
    const serenityBonus = u.is_serenity_pick ? 10 : 0;
    // - Live evidence bonus (max 8)
    const evBonus = Math.min(8, evidenceCount * 2);
    // - Competition moat
    const compBonus = u.competitors === '1 public' ? 10 : u.competitors === '2–3 public' ? 5 : 0;
    // - Velocity bonus: articles this week vs prior week (dynamic)
    const vel = calcVelocity(articles, a =>
      getTickerSymbols(a).some(s => s.toUpperCase() === u.ticker.replace(/\d+$/,'').toUpperCase() || s.toUpperCase() === shortTicker)
    );
    const velBonus = Math.max(0, vel.accel); // 0–12 if accelerating

    const score = Math.min(100, upstreamBonus + sizeBonus + arb + serenityBonus + evBonus + compBonus + velBonus);

    return {
      ...u,
      evidence_count: evidenceCount,
      headlines: ev?.headlines ?? [],
      latest_at: ev?.latest,
      price: q?.price,
      market_cap: mc,
      change_pct: q?.changePercent,
      quote_name: q?.company,
      is_small_cap: isSC,
      score,
      velocity: vel,
    };
  }).sort((a, b) => b.score - a.score);
}

// ── Score Gauge ───────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const c = scoreColor(score);
  return (
    <div style={{ width: '38px', height: '38px', position: 'relative', flexShrink: 0 }}>
      <svg viewBox="0 0 38 38" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
        <circle cx="19" cy="19" r="15" fill="none" stroke="#1A2840" strokeWidth="3.5" />
        <circle cx="19" cy="19" r="15" fill="none" stroke={c} strokeWidth="3.5"
          strokeDasharray={`${(score / 100) * 94.2} 94.2`} strokeLinecap="round" />
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '800', color: c }}>{score}</span>
    </div>
  );
}

// ── Emerging Theme Detector ───────────────────────────────────────────────────
// Scans live news headlines for supply-chain stress keywords that may NOT fit
// the 9 predefined buckets. Surfaces new themes as auto-detected intelligence.
// This is the "discovery-first" layer — it finds new bottleneck classes from evidence.

const EMERGING_THEME_DETECTORS = [
  { id: 'transformer',    label: 'Transformer / Grid Equipment', icon: '🔌', color: '#F59E0B', keywords: ['transformer','grid equipment','switchgear','electrical steel','goes','power transformer','abb transformer','grid backlog'] },
  { id: 'specialty_gas',  label: 'Specialty Gas Supply',         icon: '💨', color: '#06B6D4', keywords: ['neon gas','specialty gas','noble gas','argon shortage','krypton','xenon','ultra-pure'] },
  { id: 'rare_earth',     label: 'Rare Earth / Critical Minerals',icon: '⛏️', color: '#8B5CF6', keywords: ['rare earth','gallium ban','germanium','tungsten','indium','cobalt supply','lithium shortage','critical mineral','critical material'] },
  { id: 'opt_test',       label: 'Optical / Wafer Test Crunch',   icon: '🔬', color: '#0F7ABF', keywords: ['wafer test','burn-in','test capacity','test bottleneck','optical test','probe card','test socket'] },
  { id: 'qual_cycle',     label: 'Qualification Cycle Signal',    icon: '🎯', color: '#10B981', keywords: ['design win','qualification complete','qual ramp','ramp phase','volume production','customer qualification','qual cycle'] },
  { id: 'backlog',        label: 'Backlog / Lead Time Expansion', icon: '⏱️', color: '#EF4444', keywords: ['lead time','backlog','allocation','sold out','capacity constrained','order backlog','delivery delay','supply tight'] },
  { id: 'subsidy_policy', label: 'Subsidy / Industrial Policy',   icon: '💰', color: '#10B981', keywords: ['chips act','semiconductor subsidy','doe grant','defense contract','rfp award','government funding','manufacturing incentive'] },
  { id: 'shipping_port',  label: 'Shipping / Port Disruption',    icon: '🚢', color: '#0F7ABF', keywords: ['port congestion','shipping delay','red sea','suez disruption','freight cost','container shortage','logistics crunch'] },
  { id: 'ai_power',       label: 'AI Data Center Power Crunch',   icon: '⚡', color: '#F59E0B', keywords: ['data center power','ai power demand','utility grid','interconnect queue','pjm','ercot','power constraint','megawatt','gigawatt'] },
  { id: 'smr_nuclear',    label: 'SMR / Nuclear PPA',             icon: '☢️', color: '#8B5CF6', keywords: ['smr','nuclear ppa','small modular reactor','nuclear deal','kairos','terrapower','nuscale','three mile island'] },
  { id: 'defense_semi',   label: 'Defense Semiconductor Demand',  icon: '🛡️', color: '#EF4444', keywords: ['defense chip','military semiconductor','itar','dod semiconductor','defense electronics','avionics','military demand'] },
  { id: 'cooling_cdm',    label: 'Liquid Cooling / CDU Shortage', icon: '❄️', color: '#06B6D4', keywords: ['liquid cooling','cdu','cold plate','immersion cooling','direct liquid','cooling shortage','thermal management bottleneck'] },
];

// Cross-reference: which themes map to existing buckets (to avoid duplication)
const THEME_TO_BUCKET: Record<string, string> = {
  opt_test: 'INTERCONNECT_PHOTONICS',
  qual_cycle: 'FABRICATION_PACKAGING',
  rare_earth: 'MATERIALS_SUPPLY',
  ai_power: 'POWER_GRID',
  smr_nuclear: 'NUCLEAR_ENERGY',
  cooling_cdm: 'THERMAL_COOLING',
};

interface DetectedTheme {
  id: string; label: string; icon: string; color: string;
  count: number; weekCount: number; headlines: string[];
  isNew: boolean; // true if NOT already in existing 9 buckets
}

function detectEmergingThemes(articles: NewsArticle[]): DetectedTheme[] {
  const now = Date.now();
  const results: DetectedTheme[] = [];
  for (const det of EMERGING_THEME_DETECTORS) {
    const matched = articles.filter(a => {
      const text = ((a.title || a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
      return det.keywords.some(kw => text.includes(kw));
    });
    if (matched.length === 0) continue;
    const weekMatched = matched.filter(a => now - new Date(a.published_at).getTime() < WEEK_MS);
    const headlines = matched.slice(0, 3).map(a => a.title || a.headline || '');
    results.push({
      id: det.id, label: det.label, icon: det.icon, color: det.color,
      count: matched.length, weekCount: weekMatched.length,
      headlines,
      isNew: !THEME_TO_BUCKET[det.id], // "new" = not already covered by existing 9 buckets
    });
  }
  return results.sort((a, b) => b.weekCount - a.weekCount || b.count - a.count);
}

function EmergingThemes({ articles }: { articles: NewsArticle[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const themes = useMemo(() => detectEmergingThemes(articles), [articles]);
  if (themes.length === 0) return null;

  const newThemes = themes.filter(t => t.isNew);
  const coveredThemes = themes.filter(t => !t.isNew);

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '1px', color: '#4A5B6C' }}>🔍 LIVE THEME DETECTION</span>
        {newThemes.length > 0 && <span style={{ fontSize: '9px', fontWeight: '700', color: '#F59E0B', backgroundColor: '#F59E0B14', border: '1px solid #F59E0B30', padding: '1px 7px', borderRadius: '3px' }}>{newThemes.length} NEW themes not in framework</span>}
        <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: 'auto' }}>auto-detected from live news · not hardcoded</span>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {themes.map(t => {
          const isExp = expanded === t.id;
          return (
            <div key={t.id} style={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${t.isNew ? '#F59E0B40' : t.color + '30'}` }}>
              <button
                onClick={() => setExpanded(isExp ? null : t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px',
                  background: isExp ? t.color + '18' : t.isNew ? '#F59E0B08' : 'transparent',
                  border: 'none', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '14px' }}>{t.icon}</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: t.isNew ? '#F59E0B' : '#C9D4E0' }}>{t.label}</span>
                    {t.isNew && <span style={{ fontSize: '8px', fontWeight: '800', color: '#F59E0B', border: '1px solid #F59E0B40', padding: '0 4px', borderRadius: '3px' }}>NEW</span>}
                    {t.weekCount >= 3 && <span style={{ fontSize: '9px', color: '#EF4444' }}>🔥</span>}
                  </div>
                  <span style={{ fontSize: '9px', color: '#4A5B6C' }}>{t.count} articles · {t.weekCount} this week</span>
                </div>
              </button>
              {isExp && (
                <div style={{ padding: '8px 12px', backgroundColor: '#060E1A', borderTop: `1px solid ${t.color}20` }}>
                  {t.headlines.map((h, i) => (
                    <div key={i} style={{ fontSize: '11px', color: '#8A95A3', padding: '3px 0', borderBottom: i < t.headlines.length - 1 ? '1px solid #1A2840' : 'none', lineHeight: '1.4' }}>
                      › {h}
                    </div>
                  ))}
                  {t.isNew && (
                    <div style={{ marginTop: '6px', padding: '5px 8px', backgroundColor: '#F59E0B08', border: '1px solid #F59E0B20', borderRadius: '4px', fontSize: '10px', color: '#F59E0B' }}>
                      ⭐ Not in framework watchlist — potential new bottleneck class to research
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — ROTATION TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

function RotationTracker({ dashboard, isLoading, articles }: { dashboard?: BnDashboard; isLoading: boolean; articles: NewsArticle[] }) {
  const [expBucket, setExpBucket] = useState<string | null>(null);
  const [expSignal, setExpSignal] = useState<string | null>(null);
  const [activeBucket, setActiveBucket] = useState<string | null>(null); // which pill is selected

  if (isLoading) return <SkeletonGrid count={6} height={150} />;
  if (!dashboard?.buckets?.length) return <EmptyState msg="No bottleneck dashboard data. Check backend." />;

  // Live velocity per bucket — shows which layers are gaining/losing momentum right now
  const velocities = Object.fromEntries(
    (dashboard.buckets ?? []).map(b => [b.bucket_id, calcBucketVelocity(articles, b.bucket_id)])
  );

  const sorted = [...dashboard.buckets].sort((a, b) => {
    // Primary: severity. Secondary: velocity trend (accelerating buckets bubble up)
    const sevDiff = b.severity - a.severity;
    if (sevDiff !== 0) return sevDiff;
    return (velocities[b.bucket_id]?.week ?? 0) - (velocities[a.bucket_id]?.week ?? 0);
  });
  const top = sorted[0];

  return (
    <div style={{ padding: '20px' }}>
      {/* Emerging themes — discovery-first layer */}
      <EmergingThemes articles={articles} />

      {/* Banner */}
      {top && (
        <div style={{ marginBottom: '20px', padding: '16px 20px', backgroundColor: '#060E1A', border: `1px solid ${getSev(top.severity_label).border}`, borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: getSev(top.severity_label).glow }}>
          <span style={{ fontSize: '28px' }}>{top.severity_icon || '⚡'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', color: '#4A5B6C' }}>ACTIVE BOTTLENECK</span>
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px', color: getSev(top.severity_label).badge, backgroundColor: getSev(top.severity_label).badgeBg, padding: '2px 8px', borderRadius: '4px' }}>{top.severity_label}</span>
            </div>
            <p style={{ fontSize: '17px', fontWeight: '800', color: '#F5F7FA', margin: '0 0 2px', letterSpacing: '-0.4px' }}>{top.label}</p>
            <p style={{ fontSize: '12px', color: '#6B7A8D', margin: 0 }}>{top.description}</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: '30px', fontWeight: '800', color: getSev(top.severity_label).badge, margin: 0, lineHeight: 1 }}>{top.signal_count}</p>
            <p style={{ fontSize: '10px', color: '#4A5B6C', margin: '2px 0 0', letterSpacing: '0.5px' }}>SIGNALS</p>
          </div>
        </div>
      )}
      {/* Rotation strip — clickable pills to focus on a specific layer */}
      <div style={{ marginBottom: '20px', padding: '10px 16px', backgroundColor: '#060E1A', borderRadius: '8px', border: '1px solid #1A2840', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '1px', marginRight: '4px' }}>ROTATION →</span>
        {activeBucket && (
          <button onClick={() => { setActiveBucket(null); setExpBucket(null); }} style={{ fontSize: '9px', color: '#4A5B6C', backgroundColor: '#1A2840', border: '1px solid #1A2840', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', marginRight: '4px' }}>
            ✕ Show all
          </button>
        )}
        {sorted.map((b, i) => {
          const isSelected = activeBucket === b.bucket_id;
          const sty = getSev(b.severity_label);
          return (
            <span key={b.bucket_id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {i > 0 && <span style={{ color: '#1A2840' }}>›</span>}
              <button
                onClick={() => {
                  if (isSelected) { setActiveBucket(null); setExpBucket(null); }
                  else { setActiveBucket(b.bucket_id); setExpBucket(b.bucket_id); }
                }}
                style={{
                  fontSize: '10px', fontWeight: isSelected ? '800' : '600',
                  padding: '3px 10px', borderRadius: '4px', cursor: 'pointer',
                  color: isSelected ? '#F5F7FA' : sty.badge,
                  backgroundColor: isSelected ? sty.badge + '40' : sty.badgeBg,
                  border: `1px solid ${isSelected ? sty.badge : sty.border}`,
                  opacity: isSelected ? 1 : Math.max(0.4, 1 - i * 0.1),
                  outline: 'none',
                  boxShadow: isSelected ? `0 0 8px ${sty.badge}40` : 'none',
                  transition: 'all 0.15s',
                }}
              >{b.label}</button>
            </span>
          );
        })}
        <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: 'auto' }}>Click any layer to focus</span>
      </div>
      {/* Grid — filtered by activeBucket if one is selected */}
      <div style={{ display: 'grid', gridTemplateColumns: activeBucket ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
        {(activeBucket ? sorted.filter(b => b.bucket_id === activeBucket) : sorted).map((b) => {
          const sty = getSev(b.severity_label);
          const isExp = expBucket === b.bucket_id;
          const vel = velocities[b.bucket_id];
          const isAccel = vel?.trend === '🔥';
          const isFading = vel?.trend === '📉';
          return (
            <div key={b.bucket_id} style={{ backgroundColor: sty.bg || '#0D1623', border: `1px solid ${isAccel ? '#F59E0B60' : sty.border}`, borderRadius: '12px', overflow: 'hidden', boxShadow: isExp ? sty.glow : isAccel ? '0 0 12px #F59E0B18' : 'none' }}>
              <button onClick={() => setExpBucket(isExp ? null : b.bucket_id)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '22px', flexShrink: 0 }}>{b.severity_icon || '🔹'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{b.label}</span>
                      <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', color: sty.badge, backgroundColor: sty.badgeBg, padding: '2px 6px', borderRadius: '3px' }}>{b.severity_label}</span>
                      {isAccel && <span title={`${vel.week} articles this week vs ${vel.prev} prior week`} style={{ fontSize: '9px', fontWeight: '700', color: '#F59E0B', backgroundColor: '#F59E0B18', border: '1px solid #F59E0B40', padding: '2px 6px', borderRadius: '3px' }}>🔥 ACCELERATING</span>}
                      {isFading && <span title={`${vel.week} articles this week vs ${vel.prev} prior week`} style={{ fontSize: '9px', color: '#4A5B6C', backgroundColor: '#4A5B6C14', border: '1px solid #1A2840', padding: '2px 6px', borderRadius: '3px' }}>📉 Fading</span>}
                    </div>
                    <p style={{ fontSize: '11px', color: '#6B7A8D', margin: '0 0 8px', lineHeight: '1.4' }}>{b.description}</p>
                    <div style={{ display: 'flex', gap: '14px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', color: '#8A95A3' }}><span style={{ color: sty.badge, fontWeight: '700', fontSize: '15px' }}>{b.signal_count}</span> signals</span>
                      <span style={{ fontSize: '11px', color: '#8A95A3' }}><span style={{ fontWeight: '600', color: '#C9D4E0' }}>{b.article_count}</span> articles</span>
                      {vel && <span style={{ fontSize: '11px', color: isAccel ? '#F59E0B' : '#4A5B6C' }}>{vel.week} this wk</span>}
                    </div>
                    {b.key_tickers?.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {b.key_tickers.slice(0, 8).map(t => <span key={t} style={{ fontSize: '10px', fontWeight: '600', color: '#0F7ABF', backgroundColor: '#0F7ABF14', border: '1px solid #0F7ABF30', padding: '1px 6px', borderRadius: '4px' }}>${t}</span>)}
                        {b.key_tickers.length > 8 && <span style={{ fontSize: '10px', color: '#4A5B6C' }}>+{b.key_tickers.length - 8}</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ color: '#4A5B6C', flexShrink: 0 }}>{isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</div>
                </div>
              </button>
              {isExp && b.signals?.length > 0 && (
                <div style={{ borderTop: `1px solid ${sty.border}` }}>
                  {b.signals.slice(0, 5).map((sig, si) => {
                    const sk = `${b.bucket_id}-${si}`;
                    const se = expSignal === sk;
                    return (
                      <div key={si} style={{ borderBottom: si < Math.min(b.signals.length,5)-1 ? '1px solid #1A284030' : 'none' }}>
                        <button onClick={() => setExpSignal(se ? null : sk)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <Zap className="w-3 h-3" style={{ color: sty.badge, flexShrink: 0, marginTop: '2px' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: '12px', color: '#C9D4E0', margin: 0, lineHeight: '1.4', textAlign: 'left' }}>{sig.headline}</p>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{sig.evidence_count} evidence</span>
                              {sig.latest_at && <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{timeAgo(sig.latest_at)}</span>}
                              {sig.tickers?.slice(0,3).map(t => <span key={t} style={{ fontSize: '10px', color: '#0F7ABF', fontWeight: '600' }}>${t}</span>)}
                            </div>
                          </div>
                          <div style={{ color: '#4A5B6C', flexShrink: 0 }}>{se ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</div>
                        </button>
                        {se && (
                          <div style={{ padding: '0 16px 12px 36px' }}>
                            {sig.summary && <p style={{ fontSize: '11px', color: '#8A95A3', lineHeight: '1.5', margin: '0 0 8px' }}>{sig.summary}</p>}
                            {sig.articles?.slice(0, 3).map((art, ai) => (
                              <a key={ai} href={cleanUrl(art.source_url)} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '6px 8px', marginBottom: '4px', backgroundColor: '#060E1A', borderRadius: '6px', textDecoration: 'none', border: '1px solid #1A2840' }}>
                                <ExternalLink className="w-3 h-3" style={{ color: '#4A5B6C', flexShrink: 0, marginTop: '2px' }} />
                                <div><p style={{ fontSize: '11px', color: '#C9D4E0', margin: 0, lineHeight: '1.3' }}>{art.headline}</p><p style={{ fontSize: '10px', color: '#4A5B6C', margin: '2px 0 0' }}>{art.source_name} · {timeAgo(art.published_at)}</p></div>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {dashboard && <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '11px', color: '#4A5B6C' }}>{dashboard.total_articles} articles analyzed · refreshes every 3 min</p>}
    </div>
  );
}

// ── Criteria check helper ─────────────────────────────────────────────────────
function CriteriaCheck({ pass, label }: { pass: boolean; label: string }) {
  return (
    <span title={label} style={{ fontSize: '10px', display: 'inline-flex', alignItems: 'center', gap: '2px', color: pass ? '#10B981' : '#EF444480', whiteSpace: 'nowrap' }}>
      {pass ? '✅' : '❌'} {label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — STOCK SCANNER
// Universe = curated from Serenity framework doc (static watchlist)
// Data     = 100% live: prices from /api/market/quotes, evidence from /api/v1/news
// ═══════════════════════════════════════════════════════════════════════════════

function StockScanner({ articles, isLoading, quotes, quotesLoading }: {
  articles: NewsArticle[]; isLoading: boolean; quotes: QuoteStock[]; quotesLoading: boolean;
}) {
  const [filterLayer, setFilterLayer] = useState('ALL');
  const [expRow, setExpRow] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'universe' | 'live'>('live'); // default to discovery-first

  const enriched = useMemo(() => buildEnrichedStocks(articles, quotes), [articles, quotes]);

  // Live News: ALL tickers from BOTTLENECK news ranked by evidence count.
  // The universe is comprehensive enough that most major names are already there,
  // so "not in universe" filter always returns 0. Instead: show everything from news,
  // badge in-universe stocks as "✓ TRACKED" and new ones as "🆕 NEW".
  const universeTickers = new Set(UNIVERSE_DEDUPED.map(u => u.ticker.replace(/\d+$/, '').toUpperCase()));
  // Text-signal detectors — scan article headline+summary for Serenity-relevant signals
  // These are dynamic scoring inputs beyond static structural filters
  const TEXT_SIGNALS: { key: string; label: string; icon: string; color: string; keywords: string[] }[] = [
    { key: 'scarcity',    label: 'Scarcity',    icon: '🔒', color: '#EF4444', keywords: ['sold out','allocation','rationed','supply tight','capacity constrained','shortage','backlog','queue'] },
    { key: 'lead_time',   label: 'Lead Time',   icon: '⏱️', color: '#F59E0B', keywords: ['lead time','delivery delay','extended lead','weeks','months backlog','order backlog'] },
    { key: 'design_win',  label: 'Design Win',  icon: '🎯', color: '#10B981', keywords: ['design win','qualification complete','ramp phase','volume production','customer win','design selection'] },
    { key: 'backlog',     label: 'Backlog',     icon: '📦', color: '#F59E0B', keywords: ['record backlog','growing backlog','order book','new orders','order flow'] },
    { key: 'capex',       label: 'Capex Signal',icon: '💰', color: '#8B5CF6', keywords: ['capex','capacity expansion','new fab','plant expansion','capacity investment','building capacity'] },
    { key: 'price_power', label: 'Pricing Pwr', icon: '💲', color: '#10B981', keywords: ['price increase','asp rising','pricing power','higher prices','premium pricing','price hike'] },
  ];

  function detectTextSignals(headlines: string[]): string[] {
    const text = headlines.join(' ').toLowerCase();
    return TEXT_SIGNALS.filter(s => s.keywords.some(kw => text.includes(kw))).map(s => s.key);
  }

  const liveExtra = useMemo(() => {
    const map = new Map<string, { symbol: string; sub_tag?: string; level?: string; evidence_count: number; headlines: string[]; latest_at?: string; price?: number; change_pct?: number; market_cap?: number; inUniverse: boolean; velocity_week: number; textSignals: string[] }>();
    const now = Date.now();
    for (const a of articles) {
      for (const sym of getTickerSymbols(a)) {
        if (!map.has(sym)) map.set(sym, { symbol: sym, sub_tag: a.bottleneck_sub_tag, level: a.bottleneck_level, evidence_count: 0, headlines: [], inUniverse: universeTickers.has(sym.toUpperCase()), velocity_week: 0, textSignals: [] });
        const r = map.get(sym)!;
        r.evidence_count++;
        const age = now - new Date(a.published_at).getTime();
        if (age < WEEK_MS) r.velocity_week++;
        if (!r.sub_tag && a.bottleneck_sub_tag) r.sub_tag = a.bottleneck_sub_tag;
        const h = a.title || a.headline || '';
        if (h && r.headlines.length < 5 && !r.headlines.includes(h)) r.headlines.push(h);
        if (!r.latest_at || (a.published_at && a.published_at > r.latest_at)) r.latest_at = a.published_at;
      }
    }
    const qm = new Map<string, QuoteStock>(quotes.map(q => [q.ticker.toUpperCase(), q]));
    return Array.from(map.values())
      .filter(r => r.evidence_count >= 1)
      .map(r => ({
        ...r,
        price: qm.get(r.symbol.toUpperCase())?.price,
        change_pct: qm.get(r.symbol.toUpperCase())?.changePercent,
        market_cap: qm.get(r.symbol.toUpperCase())?.marketCap,
        textSignals: detectTextSignals(r.headlines),
      }))
      .sort((a, b) => {
        // Discovery score: new picks + velocity + text signals + evidence
        const sigScore = (r: typeof a) => (!r.inUniverse ? 10 : 0) + r.velocity_week * 2 + r.textSignals.length * 3 + r.evidence_count;
        return sigScore(b) - sigScore(a);
      });
  }, [articles, quotes]);

  const LAYERS = ['ALL', 'INTERCONNECT_PHOTONICS', 'MATERIALS_SUPPLY', 'FABRICATION_PACKAGING', 'COMPUTE_SCALING', 'MEMORY_STORAGE', 'POWER_GRID', 'NUCLEAR_ENERGY', 'THERMAL_COOLING'];
  const filtered = useMemo(() => filterLayer === 'ALL' ? enriched : enriched.filter(r => r.sub_tag === filterLayer), [enriched, filterLayer]);

  const multibaggers = enriched.filter(s => s.score >= 70 && s.is_small_cap);
  const withLiveSignal = enriched.filter(s => s.evidence_count > 0);

  if (isLoading) return <SkeletonGrid count={8} height={54} />;

  return (
    <div style={{ padding: '20px' }}>
      {/* Data transparency banner */}
      <div style={{ marginBottom: '14px', padding: '10px 14px', backgroundColor: '#0F7ABF08', border: '1px solid #0F7ABF20', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <Zap className="w-3 h-3" style={{ color: '#0F7ABF', flexShrink: 0 }} />
        <span style={{ fontSize: '11px', color: '#6B7A8D' }}>
          <strong style={{ color: '#0F7ABF' }}>Watchlist</strong> from Serenity framework doc ·&nbsp;
          <strong style={{ color: '#10B981' }}>Prices/market cap</strong> live from Yahoo Finance ·&nbsp;
          <strong style={{ color: '#F59E0B' }}>Evidence</strong> live from news feed ·&nbsp;
          {quotesLoading ? '⏳ loading quotes…' : <span style={{ color: '#10B981' }}>✅ {quotes.length} quotes loaded</span>}
        </span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* View toggle */}
        <div style={{ display: 'flex', gap: '0', backgroundColor: '#060E1A', border: '1px solid #1A2840', borderRadius: '8px', overflow: 'hidden' }}>
          {(['universe', 'live'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{ padding: '6px 14px', background: viewMode === m ? '#0F7ABF20' : 'transparent', border: 'none', cursor: 'pointer', color: viewMode === m ? '#0F7ABF' : '#6B7A8D', fontSize: '11px', fontWeight: viewMode === m ? '700' : '400' }}>
              {m === 'live' ? `📡 Live Discovery (${liveExtra.length}) · ${liveExtra.filter(r => !r.inUniverse).length} new` : `🔬 Framework Anchors (${enriched.length})`}
            </button>
          ))}
        </div>

        {viewMode === 'universe' && (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {multibaggers.length > 0 && (
              <div style={{ padding: '5px 12px', borderRadius: '7px', border: '1px solid #F59E0B30', backgroundColor: '#F59E0B08', fontSize: '11px', color: '#F59E0B', fontWeight: '600' }}>
                ⭐ {multibaggers.length} potential multibaggers
              </div>
            )}
            {withLiveSignal.length > 0 && (
              <div style={{ padding: '5px 12px', borderRadius: '7px', border: '1px solid #10B98130', backgroundColor: '#10B98108', fontSize: '11px', color: '#10B981', fontWeight: '600' }}>
                📡 {withLiveSignal.length} with live signal
              </div>
            )}
          </div>
        )}
        <span style={{ fontSize: '11px', color: '#4A5B6C', marginLeft: 'auto' }}>
          {viewMode === 'universe' ? `${filtered.length} stocks` : `${liveExtra.length} tickers from live news`}
        </span>
      </div>

      {/* Layer filter (universe only) */}
      {viewMode === 'universe' && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '2px' }}>
          {LAYERS.map(lyr => {
            const cnt = lyr === 'ALL' ? enriched.length : enriched.filter(r => r.sub_tag === lyr).length;
            const ti = lyr !== 'ALL' ? TIER_MAP[lyr] : null;
            return (
              <button key={lyr} onClick={() => setFilterLayer(lyr)} style={{
                padding: '4px 10px', borderRadius: '6px', flexShrink: 0,
                border: `1px solid ${filterLayer === lyr ? (ti?.color ?? '#0F7ABF') + '50' : '#1A2840'}`,
                cursor: 'pointer',
                backgroundColor: filterLayer === lyr ? (ti?.color ?? '#0F7ABF') + '14' : 'transparent',
                color: filterLayer === lyr ? (ti?.color ?? '#0F7ABF') : '#6B7A8D',
                fontSize: '10px', fontWeight: filterLayer === lyr ? '700' : '400',
              }}>
                {lyr === 'ALL' ? 'ALL' : lyr.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).split(' ').slice(0,2).join(' ')} ({cnt})
              </button>
            );
          })}
        </div>
      )}

      {/* ── Universe view ── */}
      {viewMode === 'universe' && (
        <>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '44px 110px 1fr 160px 90px 70px', gap: '8px', padding: '6px 12px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px', color: '#4A5B6C', borderBottom: '1px solid #1A2840' }}>
            <span>SCORE</span><span>TICKER</span><span>CHAIN POSITION</span><span>4 SERENITY CHECKS</span><span>MKT CAP</span><span>PRICE</span>
          </div>

          {filtered.map((s, idx) => {
            const ef = exchangeFlag(s.exchange);
            const isExp = expRow === s.ticker;
            const cp = s.change_pct ?? 0;
            const ti = TIER_MAP[s.sub_tag];
            const isMultibagger = s.score >= 70 && s.is_small_cap;
            const check1 = s.competitors === '1 public' || s.competitors === '2–3 public'; // monopoly test
            const check2 = s.is_small_cap;   // size asymmetry
            const check3 = s.exchange !== 'NYSE' && s.exchange !== 'NASDAQ'; // cross-border arb
            const check4 = s.val_tier <= 4;   // upstream enough
            return (
              <div key={s.ticker} style={{ borderBottom: '1px solid #1A284018' }}>
                <button onClick={() => setExpRow(isExp ? null : s.ticker)} style={{ width: '100%', background: isExp ? '#0D162340' : idx % 2 === 1 ? '#060E1A14' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '9px 12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '44px 110px 1fr 160px 90px 70px', gap: '8px', alignItems: 'center' }}>
                    {/* Score */}
                    <ScoreGauge score={s.score} />

                    {/* Ticker */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', minWidth: 0 }}>
                      {isMultibagger && <span title="Potential multibagger — high score + small cap" style={{ fontSize: '13px' }}>⭐</span>}
                      <span style={{ fontSize: '12px', fontWeight: '800', color: '#F5F7FA' }}>{s.ticker.replace(/\d+$/, '')}</span>
                      {ef && <span title={`${ef.label} listed`} style={{ fontSize: '12px' }}>{ef.flag}</span>}
                      {s.is_small_cap && <span style={{ fontSize: '8px', color: '#F59E0B', border: '1px solid #F59E0B40', padding: '0 3px', borderRadius: '3px', fontWeight: '700' }}>SC</span>}
                      {s.is_serenity_pick && <span title="Serenity explicitly mentioned this stock" style={{ fontSize: '8px', color: '#8B5CF6', border: '1px solid #8B5CF640', padding: '0 3px', borderRadius: '3px', fontWeight: '700' }}>S✓</span>}
                      {s.evidence_count > 0 && <span style={{ fontSize: '8px', color: '#10B981', border: '1px solid #10B98140', padding: '0 3px', borderRadius: '3px', fontWeight: '700' }}>📡{s.evidence_count}</span>}
                      {s.velocity.trend === '🔥' && <span title={`${s.velocity.week} articles this week vs ${s.velocity.prev} prior week`} style={{ fontSize: '9px', color: '#F59E0B', fontWeight: '700' }}>🔥</span>}
                      {s.velocity.trend === '📉' && <span style={{ fontSize: '9px', color: '#4A5B6C' }}>📉</span>}
                    </div>

                    {/* Chain position */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                        {ti && <span style={{ fontSize: '9px', fontWeight: '700', color: ti.color, border: `1px solid ${ti.color}40`, padding: '1px 4px', borderRadius: '3px', flexShrink: 0 }}>T{ti.tier}</span>}
                        <span style={{ fontSize: '11px', color: '#8A95A3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sub_tag.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {s.key_customers.slice(0,3).map(c => <span key={c} style={{ fontSize: '9px', color: '#0F7ABF', backgroundColor: '#0F7ABF14', padding: '0 4px', borderRadius: '3px' }}>→{c}</span>)}
                      </div>
                    </div>

                    {/* 4 Criteria checks */}
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <CriteriaCheck pass={check1} label={`<3 competitors (${s.competitors})`} />
                      <CriteriaCheck pass={check2} label="<$2B mkt cap" />
                      <CriteriaCheck pass={check3} label="Non-US listing" />
                      <CriteriaCheck pass={check4} label={`Tier ≤4 upstream (T${s.val_tier})`} />
                    </div>

                    {/* Market cap */}
                    <span style={{ fontSize: '11px', color: s.is_small_cap ? '#F59E0B' : '#C9D4E0', fontWeight: s.is_small_cap ? '700' : '400' }}>{fmtCap(s.market_cap)}</span>

                    {/* Price */}
                    <div>{s.price ? <><span style={{ fontSize: '12px', fontWeight: '600', color: '#F5F7FA' }}>${s.price.toFixed(2)}</span>{cp !== 0 && <div style={{ fontSize: '10px', color: cp >= 0 ? '#10B981' : '#EF4444' }}>{cp >= 0 ? '+' : ''}{cp.toFixed(2)}%</div>}</> : <span style={{ fontSize: '10px', color: '#4A5B6C' }}>—</span>}</div>
                  </div>
                </button>

                {/* Expanded */}
                {isExp && (
                  <div style={{ padding: '12px 14px 16px 60px', backgroundColor: '#060E1A30', borderTop: '1px solid #1A2840' }}>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: '#C9D4E0' }}>{s.name}</span>
                      {s.quote_name && s.quote_name !== s.name && <span style={{ fontSize: '11px', color: '#6B7A8D' }}>{s.quote_name}</span>}
                      <span style={{ fontSize: '11px', color: '#4A5B6C' }}>{s.exchange}</span>
                      {ti && <span style={{ fontSize: '11px', color: ti.color }}>{ti.label}</span>}
                    </div>

                    {/* Serenity thesis */}
                    <div style={{ padding: '10px 12px', backgroundColor: '#060E1A', border: '1px solid #1A2840', borderRadius: '8px', marginBottom: '10px' }}>
                      <p style={{ fontSize: '10px', color: '#8B5CF6', fontWeight: '700', letterSpacing: '0.8px', margin: '0 0 6px' }}>🔬 SERENITY THESIS</p>
                      <p style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.6', margin: 0 }}>{s.serenity_note}</p>
                    </div>

                    {/* Key customers */}
                    <div style={{ marginBottom: '10px' }}>
                      <p style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '0.8px', margin: '0 0 6px' }}>SUPPLIES → (key customers)</p>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {s.key_customers.map(c => <span key={c} style={{ fontSize: '11px', color: '#0F7ABF', backgroundColor: '#0F7ABF14', border: '1px solid #0F7ABF30', padding: '2px 8px', borderRadius: '5px', fontWeight: '600' }}>{c}</span>)}
                      </div>
                    </div>

                    {/* Live evidence headlines */}
                    {s.headlines.length > 0 && (
                      <div style={{ marginBottom: '10px' }}>
                        <p style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '0.8px', margin: '0 0 6px' }}>📡 LIVE EVIDENCE ({s.evidence_count} articles)</p>
                        {s.headlines.map((h, i) => (
                          <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', padding: '7px 10px', marginBottom: '4px', backgroundColor: '#060E1A', borderRadius: '6px', border: '1px solid #10B98120' }}>
                            <Zap className="w-3 h-3" style={{ color: '#10B981', flexShrink: 0, marginTop: '2px' }} />
                            <span style={{ fontSize: '11px', color: '#C9D4E0', lineHeight: '1.45' }}>{h}</span>
                          </div>
                        ))}
                        {s.latest_at && <p style={{ fontSize: '10px', color: '#4A5B6C', margin: '4px 0 0' }}>Last signal: {timeAgo(s.latest_at)}</p>}
                      </div>
                    )}

                    {/* Applicable models */}
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                      {s.models.map(m => <Tag key={m} label={`Model ${m}`} color="#8B5CF6" />)}
                      {isMultibagger && <Tag label="⭐ Potential Multibagger" color="#F59E0B" />}
                      {!s.is_small_cap && s.val_tier <= 3 && <Tag label="Upstream anchor — look further upstream" color="#EF4444" />}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── Live Discovery view — discovery-first ── */}
      {viewMode === 'live' && (
        <>
          <div style={{ marginBottom: '10px', padding: '10px 14px', backgroundColor: '#060E1A', border: '1px solid #1A2840', borderRadius: '8px' }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: '#F5F7FA', fontWeight: '600' }}>Discovery-first: ranked by live evidence velocity + text signals</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: '#F59E0B' }}>🆕 NEW = not in framework — research candidate</span>
              <span style={{ fontSize: '10px', color: '#10B981' }}>✓ TRACKED = in watchlist</span>
              {TEXT_SIGNALS.slice(0,4).map(s => <span key={s.key} style={{ fontSize: '10px', color: s.color }}>{s.icon} {s.label}</span>)}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 100px 1fr 170px 80px', gap: '8px', padding: '6px 12px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px', color: '#4A5B6C', borderBottom: '1px solid #1A2840' }}>
            <span>SIGNALS</span><span>TICKER</span><span>LAYER + SIGNALS DETECTED</span><span>STATUS</span><span>PRICE</span>
          </div>
          {liveExtra.length === 0
            ? <EmptyState msg="No tickers in live bottleneck news right now." />
            : liveExtra.map((r, i) => {
              const ti = r.sub_tag ? TIER_MAP[r.sub_tag] : null;
              const cp = r.change_pct ?? 0;
              const isNew = !r.inUniverse;
              const isHot = r.velocity_week >= 2;
              const sigs = TEXT_SIGNALS.filter(s => r.textSignals.includes(s.key));
              return (
                <div key={r.symbol} style={{
                  display: 'grid', gridTemplateColumns: '60px 100px 1fr 170px 80px', gap: '8px',
                  padding: '10px 12px', borderBottom: '1px solid #1A284018', alignItems: 'center',
                  backgroundColor: isNew ? '#F59E0B06' : i % 2 === 1 ? '#060E1A14' : 'transparent',
                  borderLeft: isNew ? '2px solid #F59E0B40' : sigs.length > 0 ? '2px solid #10B98140' : '2px solid transparent',
                }}>
                  {/* Signal count + velocity */}
                  <div>
                    <span style={{ fontSize: '15px', fontWeight: '800', color: isHot ? '#F59E0B' : '#C9D4E0', display: 'block' }}>{r.evidence_count}</span>
                    {isHot && <span style={{ fontSize: '9px', color: '#F59E0B' }}>🔥{r.velocity_week}wk</span>}
                  </div>

                  {/* Ticker */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: isNew ? '#F59E0B' : '#F5F7FA' }}>{r.symbol}</span>
                      {ti && <span style={{ fontSize: '8px', fontWeight: '700', color: ti.color, border: `1px solid ${ti.color}40`, padding: '0 3px', borderRadius: '3px' }}>T{ti.tier}</span>}
                    </div>
                    {r.latest_at && <span style={{ fontSize: '9px', color: '#4A5B6C' }}>{timeAgo(r.latest_at)}</span>}
                  </div>

                  {/* Layer + text signal badges */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '10px', color: '#6B7A8D', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.sub_tag ? r.sub_tag.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()) : '—'}
                    </div>
                    {sigs.length > 0 && (
                      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                        {sigs.map(s => (
                          <span key={s.key} title={s.label} style={{ fontSize: '9px', fontWeight: '700', color: s.color, backgroundColor: s.color + '14', border: `1px solid ${s.color}30`, padding: '0 5px', borderRadius: '3px' }}>
                            {s.icon} {s.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Status badge */}
                  <span style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', textAlign: 'center', color: isNew ? '#F59E0B' : '#10B981', backgroundColor: isNew ? '#F59E0B14' : '#10B98114', border: `1px solid ${isNew ? '#F59E0B30' : '#10B98130'}` }}>
                    {isNew ? '🆕 NEW PICK' : '✓ TRACKED'}
                  </span>

                  {/* Price */}
                  <div>{r.price ? <><span style={{ fontSize: '12px', color: '#F5F7FA', fontWeight: '600' }}>${r.price.toFixed(2)}</span>{cp !== 0 && <div style={{ fontSize: '10px', color: cp >= 0 ? '#10B981' : '#EF4444' }}>{cp >= 0 ? '+' : ''}{cp.toFixed(2)}%</div>}</> : <span style={{ fontSize: '11px', color: '#4A5B6C' }}>—</span>}</div>
                </div>
              );
            })
          }
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — DRILLDOWN KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════════════════

function DrilldownKB({ articles }: { articles: NewsArticle[] }) {
  const [active, setActive] = useState<string | null>(null);
  const entry = active ? DRILLDOWN[active] : null;
  const bucketArticles = useMemo(() => active ? articles.filter(a => a.bottleneck_sub_tag === active).slice(0, 10) : [], [articles, active]);

  return (
    <div style={{ padding: '20px' }}>
      {/* Category grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: active ? '20px' : 0 }}>
        {Object.entries(DRILLDOWN).map(([key, e]) => {
          const tier = TIER_MAP[key];
          const isAct = active === key;
          return (
            <button key={key} onClick={() => setActive(isAct ? null : key)} style={{
              textAlign: 'left', padding: '14px', borderRadius: '10px', cursor: 'pointer',
              border: `1px solid ${isAct ? (tier?.color ?? '#0F7ABF') + '60' : '#1A2840'}`,
              backgroundColor: isAct ? (tier?.color ?? '#0F7ABF') + '12' : '#0D1623',
              transition: 'all 0.15s',
            }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>{e.icon}</div>
              <div style={{ fontSize: '12px', fontWeight: '700', color: isAct ? '#F5F7FA' : '#C9D4E0', marginBottom: '4px' }}>{e.label}</div>
              {tier && <div style={{ fontSize: '10px', color: tier.color, fontWeight: '600' }}>{tier.label}</div>}
            </button>
          );
        })}
      </div>

      {/* Drilldown panel */}
      {entry && active && (
        <div style={{ backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1A2840', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '28px' }}>{entry.icon}</span>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: '800', color: '#F5F7FA', margin: 0 }}>{entry.label}</h2>
              {TIER_MAP[active] && <span style={{ fontSize: '11px', color: TIER_MAP[active].color }}>{TIER_MAP[active].label}</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0' }}>
            {/* Why section */}
            <div style={{ padding: '16px 20px', borderRight: '1px solid #1A2840' }}>
              <p style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>WHY IT'S A BOTTLENECK</p>
              <p style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.6', margin: 0 }}>{entry.why}</p>
            </div>
            {/* Supply / Demand */}
            <div style={{ padding: '16px 20px' }}>
              <div style={{ marginBottom: '14px' }}>
                <p style={{ fontSize: '10px', color: '#EF4444', fontWeight: '700', letterSpacing: '1px', margin: '0 0 6px' }}>SUPPLY CONSTRAINT</p>
                <p style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.6', margin: 0 }}>{entry.supply}</p>
              </div>
              <div>
                <p style={{ fontSize: '10px', color: '#10B981', fontWeight: '700', letterSpacing: '1px', margin: '0 0 6px' }}>DEMAND DRIVER</p>
                <p style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.6', margin: 0 }}>{entry.demand}</p>
              </div>
            </div>
          </div>

          {/* Winners / Losers */}
          <div style={{ padding: '16px 20px', borderTop: '1px solid #1A2840', display: 'grid', gridTemplateColumns: entry.losers.length > 0 ? '1fr 1fr' : '1fr', gap: '16px' }}>
            <div>
              <p style={{ fontSize: '10px', color: '#10B981', fontWeight: '700', letterSpacing: '1px', margin: '0 0 10px' }}>🏆 WINNERS</p>
              {entry.winners.map(w => (
                <div key={w.ticker} style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '8px 12px', backgroundColor: '#10B98108', border: '1px solid #10B98120', borderRadius: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#10B981', minWidth: '52px' }}>{w.ticker}</span>
                  <span style={{ fontSize: '11px', color: '#8A95A3', lineHeight: '1.4' }}>{w.thesis}</span>
                </div>
              ))}
            </div>
            {entry.losers.length > 0 && (
              <div>
                <p style={{ fontSize: '10px', color: '#EF4444', fontWeight: '700', letterSpacing: '1px', margin: '0 0 10px' }}>⚠️ RISKS / LOSERS</p>
                {entry.losers.map(l => (
                  <div key={l.ticker} style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '8px 12px', backgroundColor: '#EF444408', border: '1px solid #EF444420', borderRadius: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '800', color: '#EF4444', minWidth: '52px' }}>{l.ticker}</span>
                    <span style={{ fontSize: '11px', color: '#8A95A3', lineHeight: '1.4' }}>{l.thesis}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Structured thesis: confirms / breaks / KPIs */}
          <div style={{ padding: '0 20px 16px', borderTop: '1px solid #1A2840', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', paddingTop: '16px' }}>
            <div>
              <p style={{ fontSize: '10px', color: '#10B981', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>✅ WHAT CONFIRMS THESIS</p>
              {entry.confirms.map((c, i) => <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '5px', fontSize: '11px', color: '#8A95A3', lineHeight: '1.4' }}><span style={{ color: '#10B981', flexShrink: 0 }}>›</span>{c}</div>)}
            </div>
            <div>
              <p style={{ fontSize: '10px', color: '#EF4444', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>❌ WHAT BREAKS THESIS</p>
              {entry.breaks.map((b, i) => <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '5px', fontSize: '11px', color: '#8A95A3', lineHeight: '1.4' }}><span style={{ color: '#EF4444', flexShrink: 0 }}>›</span>{b}</div>)}
            </div>
            <div>
              <p style={{ fontSize: '10px', color: '#F59E0B', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>📊 WATCH THESE KPIs</p>
              {entry.watch_kpi.map((k, i) => <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '5px', fontSize: '11px', color: '#8A95A3', lineHeight: '1.4' }}><span style={{ color: '#F59E0B', flexShrink: 0 }}>›</span>{k}</div>)}
            </div>
          </div>

          {/* Live evidence */}
          {bucketArticles.length > 0 && (
            <div style={{ padding: '12px 20px 16px', borderTop: '1px solid #1A2840' }}>
              <p style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '1px', margin: '0 0 10px' }}>LIVE EVIDENCE ({bucketArticles.length} articles)</p>
              {bucketArticles.map((a, i) => {
                const url = cleanUrl(a.url || a.source_url || '#');
                return (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '8px 10px', marginBottom: '6px', backgroundColor: '#060E1A', borderRadius: '8px', textDecoration: 'none', border: '1px solid #1A2840' }}>
                    <ExternalLink className="w-3 h-3" style={{ color: '#4A5B6C', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <p style={{ fontSize: '12px', color: '#C9D4E0', margin: 0, lineHeight: '1.35' }}>{a.title || a.headline}</p>
                      <p style={{ fontSize: '10px', color: '#4A5B6C', margin: '3px 0 0' }}>{a.source_name} · {timeAgo(a.published_at)}</p>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — GEOPOLITICAL OVERLAY
// ═══════════════════════════════════════════════════════════════════════════════

// Geo mechanism detection — keyword-based, no API needed
// Each mechanism maps to affected supply chain layers so we can show chain impact
const GEO_MECHANISMS: Record<string, { label: string; color: string; icon: string; layers: string[] }> = {
  TARIFF:     { label: 'Tariff / Trade',  color: '#F59E0B', icon: '🏷️', layers: ['MATERIALS_SUPPLY','FABRICATION_PACKAGING','MEMORY_STORAGE'] },
  EXPORT_BAN: { label: 'Export Control',  color: '#EF4444', icon: '🚫', layers: ['MATERIALS_SUPPLY','INTERCONNECT_PHOTONICS','FABRICATION_PACKAGING'] },
  SUBSIDY:    { label: 'Subsidy / Grant', color: '#10B981', icon: '💰', layers: ['FABRICATION_PACKAGING','MATERIALS_SUPPLY','NUCLEAR_ENERGY'] },
  MILITARY:   { label: 'Military / Sanctions', color: '#8B5CF6', icon: '⚔️', layers: ['MATERIALS_SUPPLY','COMPUTE_SCALING','INTERCONNECT_PHOTONICS'] },
  POWER:      { label: 'Power / Grid',    color: '#06B6D4', icon: '⚡', layers: ['POWER_GRID','NUCLEAR_ENERGY','THERMAL_COOLING'] },
  SHIPPING:   { label: 'Shipping / Ports',color: '#0F7ABF', icon: '🚢', layers: ['MATERIALS_SUPPLY','MEMORY_STORAGE','FABRICATION_PACKAGING'] },
  CURRENCY:   { label: 'Currency / FX',   color: '#F59E0B', icon: '💱', layers: ['MATERIALS_SUPPLY','FABRICATION_PACKAGING'] },
};

const MECHANISM_KEYWORDS: Record<string, string[]> = {
  TARIFF:     ['tariff','duty','trade war','levy','import tax','trade restriction','section 301'],
  EXPORT_BAN: ['export ban','export control','entity list','ear99','eccn','semiconductor export','chips export','gallium','germanium','export restriction'],
  SUBSIDY:    ['subsidy','chips act','grant','funding','incentive','federal funding','doe funding','defense contract','government contract','rfp'],
  MILITARY:   ['military','defense','sanctions','itar','weapon','national security','nato','army','navy','airforce','missile','war '],
  POWER:      ['blackout','grid constraint','electricity shortage','power crisis','energy crisis','grid bottleneck','rolling blackout','data center power'],
  SHIPPING:   ['shipping','port congestion','suez','red sea','freight disruption','logistics','container shortage','panama canal'],
  CURRENCY:   ['currency','forex','fx rate','devaluation','yuan','yen weakens','won drops','exchange rate'],
};

function detectMechanism(article: NewsArticle): { key: string; label: string; color: string; icon: string; layers: string[] } | null {
  const text = ((article.title || article.headline || '') + ' ' + (article.summary || '')).toLowerCase();
  for (const [key, kws] of Object.entries(MECHANISM_KEYWORDS)) {
    if (kws.some(kw => text.includes(kw))) return { key, ...GEO_MECHANISMS[key] };
  }
  return null;
}

function GeoOverlay({ articles, isLoading }: { articles: NewsArticle[]; isLoading: boolean }) {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [mechFilter, setMechFilter] = useState('ALL');
  if (isLoading) return <SkeletonGrid count={6} height={80} />;

  const GEO_TYPES = new Set(['GEOPOLITICAL', 'TARIFF', 'MACRO']);
  const withMechanism = articles
    .filter(a => GEO_TYPES.has(a.article_type))
    .map(a => ({ ...a, mechanism: detectMechanism(a) }));

  const filtered = withMechanism.filter(a =>
    (typeFilter === 'ALL' || a.article_type === typeFilter) &&
    (mechFilter === 'ALL' || a.mechanism?.key === mechFilter)
  );
  const typeColor = (t: string) => ({ GEOPOLITICAL: '#EF4444', TARIFF: '#F59E0B', MACRO: '#8B5CF6' })[t] ?? '#4A5B6C';

  // Count mechanisms in current view
  const mechCounts = Object.fromEntries(
    Object.keys(GEO_MECHANISMS).map(k => [k, withMechanism.filter(a => a.mechanism?.key === k).length])
  );

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#EF444408', border: '1px solid #EF444428', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: '#EF4444', fontWeight: '700', margin: '0 0 4px' }}>⚠️ Geopolitical Accelerant — Model 29</p>
        <p style={{ fontSize: '11px', color: '#8A95A3', margin: 0, lineHeight: '1.5' }}>
          Geopolitical disruption = accelerant to upstream supply chain bottleneck positions. When supply chains become more fragile globally, chokepoint companies become MORE valuable.
        </p>
      </div>

      {/* Type filter */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {['ALL','GEOPOLITICAL','TARIFF','MACRO'].map(t => {
          const cnt = t === 'ALL' ? withMechanism.length : withMechanism.filter(a => a.article_type === t).length;
          return (
            <button key={t} onClick={() => setTypeFilter(t)} style={{ padding: '5px 12px', borderRadius: '7px', border: `1px solid ${typeFilter === t ? typeColor(t) + '60' : '#1A2840'}`, cursor: 'pointer', backgroundColor: typeFilter === t ? typeColor(t) + '14' : 'transparent', color: typeFilter === t ? typeColor(t) : '#6B7A8D', fontSize: '11px', fontWeight: '600' }}>
              {t} ({cnt})
            </button>
          );
        })}
        <span style={{ fontSize: '11px', color: '#4A5B6C', marginLeft: 'auto', alignSelf: 'center' }}>Live · every 90s</span>
      </div>

      {/* Mechanism filter — auto-classified from article text */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', alignSelf: 'center', letterSpacing: '0.5px' }}>MECHANISM:</span>
        <button onClick={() => setMechFilter('ALL')} style={{ padding: '3px 10px', borderRadius: '6px', border: `1px solid ${mechFilter === 'ALL' ? '#0F7ABF60' : '#1A2840'}`, cursor: 'pointer', backgroundColor: mechFilter === 'ALL' ? '#0F7ABF14' : 'transparent', color: mechFilter === 'ALL' ? '#0F7ABF' : '#6B7A8D', fontSize: '10px', fontWeight: '600' }}>ALL</button>
        {Object.entries(GEO_MECHANISMS).filter(([k]) => (mechCounts[k] ?? 0) > 0).map(([k, m]) => (
          <button key={k} onClick={() => setMechFilter(k === mechFilter ? 'ALL' : k)} style={{ padding: '3px 10px', borderRadius: '6px', border: `1px solid ${mechFilter === k ? m.color + '60' : '#1A2840'}`, cursor: 'pointer', backgroundColor: mechFilter === k ? m.color + '14' : 'transparent', color: mechFilter === k ? m.color : '#6B7A8D', fontSize: '10px', fontWeight: '600' }}>
            {m.icon} {m.label} ({mechCounts[k]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? <EmptyState msg="No geopolitical articles for this filter." /> : filtered.map((a, i) => {
        const url = cleanUrl(a.url || a.source_url || '#');
        const tc = typeColor(a.article_type);
        const tickers = getTickerSymbols(a);
        const sentiment = a.sentiment?.toUpperCase();
        const sentColor = sentiment === 'BULLISH' ? '#10B981' : sentiment === 'BEARISH' ? '#EF4444' : '#6B7A8D';
        const mech = a.mechanism;
        return (
          <div key={a.id || i} style={{ marginBottom: '8px', padding: '12px 14px', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '10px', borderLeft: `3px solid ${mech ? mech.color : tc}` }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', color: tc, backgroundColor: tc + '18', padding: '2px 7px', borderRadius: '3px', flexShrink: 0 }}>{a.article_type}</span>
              {mech && (
                <span style={{ fontSize: '9px', fontWeight: '700', color: mech.color, backgroundColor: mech.color + '18', border: `1px solid ${mech.color}40`, padding: '2px 7px', borderRadius: '3px' }}>
                  {mech.icon} {mech.label}
                </span>
              )}
              {sentiment && sentiment !== 'NEUTRAL' && <span style={{ fontSize: '9px', color: sentColor, fontWeight: '700', marginLeft: 'auto' }}>{sentiment === 'BULLISH' ? '↑' : '↓'} {sentiment}</span>}
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: '13px', color: '#C9D4E0', margin: '0 0 6px', lineHeight: '1.4', fontWeight: '500' }}>{a.title || a.headline}</p>
            </a>
            {a.summary && <p style={{ fontSize: '11px', color: '#8A95A3', margin: '0 0 8px', lineHeight: '1.5' }}>{a.summary}</p>}
            {mech && mech.layers.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '9px', color: '#4A5B6C', fontWeight: '600' }}>CHAIN IMPACT →</span>
                {mech.layers.map(l => {
                  const ti = TIER_MAP[l];
                  return ti ? <span key={l} style={{ fontSize: '9px', color: ti.color, backgroundColor: ti.color + '14', border: `1px solid ${ti.color}30`, padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>T{ti.tier} {l.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()).split(' ').slice(0,2).join(' ')}</span> : null;
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{a.source_name} · {timeAgo(a.published_at)}</span>
              {tickers.slice(0, 4).map(t => <span key={t} style={{ fontSize: '10px', color: '#0F7ABF', fontWeight: '600', backgroundColor: '#0F7ABF14', padding: '1px 5px', borderRadius: '3px' }}>${t}</span>)}
              <a href={url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', color: '#4A5B6C' }}><ExternalLink className="w-3 h-3" /></a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — CONFERENCE CALENDAR + EARNINGS CATALYST ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// Detect live conference signal: are news articles mentioning this conference right now?
const CONF_KEYWORDS: Record<string, string[]> = {
  'NVDA GTC':    ['gtc','nvidia gtc','jensen keynote','nvidia developer conference'],
  'OFC':         ['ofc conference','optical fiber conference','silicon photonics conference'],
  'SEMICON West':['semicon west','semicon','semiconductor equipment show'],
  'Hot Chips':   ['hot chips','hotchips'],
  'TSMC OIP':    ['tsmc oip','oip alliance','open innovation platform','tsmc packaging'],
  'IEEE IEDM':   ['iedm','electron devices meeting'],
};

// Universe tickers that matter most for earnings catalysts
const EARNINGS_WATCH = ['NVDA','AMD','AVGO','MRVL','COHR','LITE','MU','AEHR','FORM','TSM','ASML','AMAT','LRCX','GEV','ETN','VRT','CCJ','CEG','TLN','SMCI','NBIS'];

function useEarningsSignals() {
  return useQuery<NewsArticle[]>({
    queryKey: ['bn', 'earnings-signals'],
    queryFn: async () => {
      const r = await fetch('/api/v1/news?limit=100&importance_min=3&article_type=EARNINGS');
      if (!r.ok) return [];
      const data = await r.json();
      if (!Array.isArray(data)) return [];
      // Filter to universe stocks only
      return data.filter((a: NewsArticle) => {
        const tickers = (a.ticker_symbols ?? []);
        return tickers.some((t: string) => EARNINGS_WATCH.includes(t.toUpperCase()));
      });
    },
    refetchInterval: 300_000,
    staleTime: 240_000,
    retry: 1,
  });
}

function useConferenceSignals() {
  return useQuery<Record<string, number>>({
    queryKey: ['bn', 'conf-signals'],
    queryFn: async () => {
      const r = await fetch('/api/v1/news?limit=200&importance_min=2');
      if (!r.ok) return {};
      const articles = await r.json() as NewsArticle[];
      const counts: Record<string, number> = {};
      for (const [confName, kws] of Object.entries(CONF_KEYWORDS)) {
        counts[confName] = articles.filter(a => {
          const text = ((a.title || a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
          return kws.some(kw => text.includes(kw));
        }).length;
      }
      return counts;
    },
    refetchInterval: 300_000, // 5 min
    staleTime: 240_000,
    retry: 1,
  });
}

function ConferenceCalendar() {
  const now = new Date();
  const { data: confSignals = {} } = useConferenceSignals();
  const { data: earningsArticles = [] } = useEarningsSignals();

  const getStatus = (dateStr: string): 'upcoming' | 'past' | 'soon' => {
    const parts = dateStr.split(' ');
    if (parts.length < 2) return 'upcoming';
    const monthMap: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const m = monthMap[parts[0]] ?? 0;
    const y = parseInt(parts[1]);
    const confDate = new Date(y, m, 15);
    const diffDays = (confDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return 'past';
    if (diffDays <= 42) return 'soon';
    return 'upcoming';
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#0F7ABF08', border: '1px solid #0F7ABF28', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: '#0F7ABF', fontWeight: '700', margin: '0 0 3px' }}>📅 Frontrun Conferences — Model 22</p>
        <p style={{ fontSize: '11px', color: '#8A95A3', margin: 0 }}>Position 4–6 weeks BEFORE each conference. A single Jensen Huang slide on CPO sends photonics names up 20–50% in a day. The day after is too late.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
        {CONFERENCES.map((conf) => {
          const status = getStatus(conf.date);
          const liveSignals = confSignals[conf.name] ?? 0;
          const isHot = liveSignals >= 3; // 3+ articles = conference generating buzz
          const statusStyle = {
            upcoming: { bg: '#0F7ABF14', border: '#0F7ABF30', badge: '#0F7ABF', label: 'UPCOMING' },
            soon:     { bg: '#F59E0B14', border: '#F59E0B30', badge: '#F59E0B', label: '⚡ ENTER NOW' },
            past:     { bg: '#4A5B6C14', border: '#1A2840',   badge: '#4A5B6C', label: 'PAST' },
          }[status];
          return (
            <div key={conf.name} style={{ padding: '16px', border: `1px solid ${isHot ? '#EF444440' : statusStyle.border}`, borderRadius: '12px', backgroundColor: statusStyle.bg, boxShadow: isHot ? '0 0 12px #EF444414' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '800', color: '#F5F7FA' }}>{conf.name}</span>
                    <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', color: statusStyle.badge, backgroundColor: statusStyle.badge + '20', padding: '2px 6px', borderRadius: '3px' }}>{statusStyle.label}</span>
                    {liveSignals > 0 && (
                      <span style={{ fontSize: '9px', fontWeight: '700', color: isHot ? '#EF4444' : '#10B981', backgroundColor: isHot ? '#EF444414' : '#10B98114', border: `1px solid ${isHot ? '#EF444430' : '#10B98130'}`, padding: '2px 6px', borderRadius: '3px' }}>
                        {isHot ? '🔥' : '📡'} {liveSignals} live article{liveSignals !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '12px', color: '#8A95A3', fontWeight: '600' }}>{conf.date}</span>
                </div>
                {conf.url && status !== 'past' && (
                  <a href={conf.url} target="_blank" rel="noopener noreferrer" style={{ color: '#4A5B6C', flexShrink: 0 }}><ExternalLink className="w-3.5 h-3.5" /></a>
                )}
              </div>
              <p style={{ fontSize: '12px', color: '#C9D4E0', fontWeight: '600', margin: '0 0 6px' }}>{conf.theme}</p>
              <p style={{ fontSize: '11px', color: '#6B7A8D', margin: '0 0 10px', lineHeight: '1.5' }}>{conf.relevance}</p>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {conf.tags.map(t => <span key={t} style={{ fontSize: '9px', fontWeight: '700', color: TAG_COLORS[t] ?? '#4A5B6C', border: `1px solid ${(TAG_COLORS[t] ?? '#4A5B6C') + '40'}`, padding: '1px 6px', borderRadius: '3px' }}>{t}</span>)}
              </div>
              {status === 'soon' && (
                <div style={{ marginTop: '10px', padding: '8px 10px', backgroundColor: '#F59E0B12', border: '1px solid #F59E0B28', borderRadius: '6px' }}>
                  <p style={{ fontSize: '11px', color: '#F59E0B', fontWeight: '600', margin: 0 }}>🎯 Entry window open — build positions now</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Earnings Catalyst Engine ── */}
      <div style={{ marginTop: '28px' }}>
        <div style={{ marginBottom: '14px', padding: '10px 16px', backgroundColor: '#10B98108', border: '1px solid #10B98128', borderRadius: '10px' }}>
          <p style={{ fontSize: '12px', color: '#10B981', fontWeight: '700', margin: '0 0 2px' }}>📊 Earnings Catalyst Engine — Live</p>
          <p style={{ fontSize: '11px', color: '#6B7A8D', margin: 0 }}>
            Recent earnings news for Serenity universe stocks. These are the qualification→ramp→visible order cycles that confirm or break theses. Auto-fetched from live news.
          </p>
        </div>
        {earningsArticles.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#4A5B6C', fontSize: '12px' }}>No recent earnings articles for universe stocks. Check back after earnings season.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {earningsArticles.slice(0, 15).map((a, i) => {
              const url = cleanUrl(a.url || a.source_url || '#');
              const tickers = (a.ticker_symbols ?? []).filter((t: string) => EARNINGS_WATCH.includes(t.toUpperCase()));
              const text = ((a.title || a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
              // Detect if this is a positive (beat/raised) or negative (miss/cut) signal
              const positive = ['beat','raised','raised guidance','record revenue','exceeded','above estimates','top estimates'].some(kw => text.includes(kw));
              const negative = ['missed','lowered','cut guidance','below estimates','disappointing','warning'].some(kw => text.includes(kw));
              const sentColor = positive ? '#10B981' : negative ? '#EF4444' : '#8A95A3';
              // Detect Serenity-relevant keywords in earnings
              const qualSignal = ['design win','qual','qualification','ramp'].some(kw => text.includes(kw));
              const backlogSignal = ['backlog','lead time','allocation','sold out'].some(kw => text.includes(kw));
              return (
                <div key={a.id || i} style={{ padding: '10px 14px', backgroundColor: '#0D1623', border: `1px solid ${positive ? '#10B98128' : negative ? '#EF444420' : '#1A2840'}`, borderRadius: '8px', borderLeft: `3px solid ${sentColor}` }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '5px', flexWrap: 'wrap' }}>
                    {tickers.slice(0,3).map((t: string) => <span key={t} style={{ fontSize: '11px', fontWeight: '800', color: '#0F7ABF', backgroundColor: '#0F7ABF14', padding: '1px 7px', borderRadius: '4px' }}>{t}</span>)}
                    {positive && <span style={{ fontSize: '9px', color: '#10B981', fontWeight: '700', backgroundColor: '#10B98114', padding: '1px 6px', borderRadius: '3px' }}>↑ BEAT / RAISED</span>}
                    {negative && <span style={{ fontSize: '9px', color: '#EF4444', fontWeight: '700', backgroundColor: '#EF444414', padding: '1px 6px', borderRadius: '3px' }}>↓ MISS / CUT</span>}
                    {qualSignal && <span style={{ fontSize: '9px', color: '#8B5CF6', fontWeight: '700', backgroundColor: '#8B5CF614', padding: '1px 6px', borderRadius: '3px' }}>🎯 QUAL SIGNAL</span>}
                    {backlogSignal && <span style={{ fontSize: '9px', color: '#F59E0B', fontWeight: '700', backgroundColor: '#F59E0B14', padding: '1px 6px', borderRadius: '3px' }}>⏱️ BACKLOG SIGNAL</span>}
                    <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: 'auto' }}>{timeAgo(a.published_at)}</span>
                  </div>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                    <p style={{ fontSize: '12px', color: '#C9D4E0', margin: '0 0 3px', lineHeight: '1.4', fontWeight: '500' }}>{a.title || a.headline}</p>
                  </a>
                  <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{a.source_name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — SUPPLY CHAIN MAP
// ═══════════════════════════════════════════════════════════════════════════════

function SupplyChainMap({ dashboard, articles }: { dashboard?: BnDashboard; articles: NewsArticle[] }) {
  const activeBuckets = new Set(dashboard?.buckets?.filter(b => b.severity >= 3).map(b => b.bucket_id) ?? []);
  const activeSevMap = Object.fromEntries(dashboard?.buckets?.map(b => [b.bucket_id, b.severity]) ?? []);

  // Live evidence counts per sub_tag from news
  const evidencePerTag = useMemo(() => {
    const counts: Record<string, { count: number; lastSignal?: string }> = {};
    for (const a of articles) {
      const tag = a.bottleneck_sub_tag;
      if (!tag) continue;
      if (!counts[tag]) counts[tag] = { count: 0 };
      counts[tag].count++;
      if (!counts[tag].lastSignal || a.published_at > counts[tag].lastSignal!) counts[tag].lastSignal = a.published_at;
    }
    return counts;
  }, [articles]);

  // Bottleneck probability: 0–100% derived from severity + evidence
  function bottleneckProb(subTag: string): number {
    const sev = activeSevMap[subTag] ?? 0;
    const ev = evidencePerTag[subTag]?.count ?? 0;
    return Math.min(100, Math.round(sev * 20 + Math.min(40, ev * 4)));
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#8B5CF608', border: '1px solid #8B5CF628', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: '#8B5CF6', fontWeight: '700', margin: '0 0 3px' }}>🗺️ AI Infrastructure Value Chain — Models 01, 05, 18</p>
        <p style={{ fontSize: '11px', color: '#8A95A3', margin: 0 }}>The further upstream from the hyped name, the less investor competition. Monopolistic positioning increases as you go further upstream. Active bottlenecks highlighted.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {SUPPLY_CHAIN.map((tier, i) => {
          const tagForTier = Object.entries(TIER_MAP).find(([, v]) => v.tier === tier.tier)?.[0];
          const isActive = tagForTier ? activeBuckets.has(tagForTier) : false;
          const evData = tagForTier ? evidencePerTag[tagForTier] : null;
          const prob = tagForTier ? bottleneckProb(tagForTier) : 0;
          const vel = tagForTier ? calcBucketVelocity(articles, tagForTier) : null;
          const arrow = i < SUPPLY_CHAIN.length - 1;

          return (
            <div key={tier.tier}>
              <div style={{
                padding: '14px 18px', borderRadius: '10px',
                backgroundColor: isActive ? tier.color + '12' : '#0D1623',
                border: `1px solid ${isActive ? tier.color + '60' : vel?.trend === '🔥' ? '#F59E0B40' : '#1A2840'}`,
                boxShadow: isActive ? `0 0 14px ${tier.color}18` : 'none',
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: '14px',
              }}>
                <div style={{ width: '46px', flexShrink: 0, textAlign: 'center' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: tier.color + '20', border: `1px solid ${tier.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '800', color: tier.color }}>T{tier.tier}</span>
                  </div>
                  {prob > 0 && (
                    <div title={`Bottleneck probability: ${prob}%`} style={{ fontSize: '9px', color: prob >= 60 ? '#EF4444' : prob >= 30 ? '#F59E0B' : '#4A5B6C', fontWeight: '700' }}>{prob}%</div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{tier.label}</span>
                    {isActive && <span style={{ fontSize: '9px', fontWeight: '700', color: '#EF4444', backgroundColor: '#EF444420', border: '1px solid #EF444440', padding: '2px 7px', borderRadius: '3px', letterSpacing: '0.8px' }}>⚡ ACTIVE BOTTLENECK</span>}
                    {vel?.trend === '🔥' && !isActive && <span style={{ fontSize: '9px', color: '#F59E0B', fontWeight: '700' }}>🔥 Rising</span>}
                    {evData && evData.count > 0 && <span style={{ fontSize: '9px', color: '#10B981', backgroundColor: '#10B98114', padding: '1px 5px', borderRadius: '3px' }}>📡 {evData.count} live</span>}
                  </div>
                  <p style={{ fontSize: '11px', color: '#6B7A8D', margin: '0 0 6px' }}>{tier.sub}</p>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {tier.companies.map(c => (
                      <span key={c} style={{ fontSize: '10px', fontWeight: '600', color: tier.color, backgroundColor: tier.color + '14', border: `1px solid ${tier.color}30`, padding: '1px 7px', borderRadius: '4px' }}>{c}</span>
                    ))}
                    {evData?.lastSignal && <span style={{ fontSize: '9px', color: '#4A5B6C', marginLeft: '4px' }}>· last {timeAgo(evData.lastSignal)}</span>}
                  </div>
                </div>
                {/* Probability bar */}
                {prob > 0 && (
                  <div style={{ width: '4px', height: '60px', backgroundColor: '#1A2840', borderRadius: '2px', flexShrink: 0, overflow: 'hidden' }}>
                    <div style={{ width: '100%', height: `${prob}%`, backgroundColor: prob >= 60 ? '#EF4444' : prob >= 30 ? '#F59E0B' : '#0F7ABF', borderRadius: '2px', marginTop: 'auto', position: 'absolute', bottom: 0 }} />
                  </div>
                )}
              </div>
              {arrow && <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0', color: '#1A2840', fontSize: '16px' }}>↓</div>}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '20px', padding: '14px 16px', backgroundColor: '#060E1A', border: '1px solid #1A2840', borderRadius: '10px' }}>
        <p style={{ fontSize: '11px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '0.8px', margin: '0 0 8px' }}>SERENITY'S DEMAND CHAIN (Model 18)</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px', color: '#8A95A3' }}>
          {['Raw InP/GaAs crystal', 'Substrate wafer', 'Laser chip', 'CPO module', 'NVL72 rack', 'AI factory', 'Hyperscaler capex'].map((s, i, arr) => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#C9D4E0' }}>{s}</span>
              {i < arr.length - 1 && <span style={{ color: '#0F7ABF' }}>→</span>}
            </span>
          ))}
        </div>
        <p style={{ fontSize: '11px', color: '#4A5B6C', margin: '8px 0 0' }}>Translate every hyperscaler capex announcement into units → transceivers → lasers → substrate revenue. That $850M Swedish laser company IS the demand chain end-point.</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — SERENITY CHECKLIST
// ═══════════════════════════════════════════════════════════════════════════════

function SerenityChecklist({ enriched }: { enriched: EnrichedStock[] }) {
  const [symbol, setSymbol] = useState('');
  const [activeSymbol, setActiveSymbol] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [savedSymbols, setSavedSymbols] = useState<string[]>([]);

  // Auto-computable items from live data — keyed by checklist item id
  // These are evaluated from the enriched universe, then applied to the active symbol
  const autoChecks = useMemo((): Record<string, { pass: boolean; note: string } | null> => {
    if (!activeSymbol) return {};
    const sym = activeSymbol.toUpperCase();
    const stock = enriched.find(s => s.ticker.replace(/\d+$/, '').toUpperCase() === sym || s.ticker.toUpperCase() === sym);
    if (!stock) return {};
    return {
      size_asymmetry: stock.is_small_cap
        ? { pass: true,  note: `Auto: Market cap ${fmtCap(stock.market_cap)} < $2B ✅` }
        : stock.market_cap
          ? { pass: false, note: `Auto: Market cap ${fmtCap(stock.market_cap)} — not small-cap` }
          : null,
      geopolitical: stock.is_non_us
        ? { pass: true, note: `Auto: Non-US listing (${stock.exchange}) — cross-border arb available ✅` }
        : { pass: false, note: `Auto: US-listed — no cross-border arb edge` },
      five_sources: stock.evidence_count >= 5
        ? { pass: true,  note: `Auto: ${stock.evidence_count} live news articles found ✅` }
        : { pass: false, note: `Auto: Only ${stock.evidence_count} live articles — need ≥5 sources` },
      competitors: stock.competitors === '1 public' || stock.competitors === '2–3 public'
        ? { pass: true,  note: `Auto: ${stock.competitors} (from framework data) ✅` }
        : null,
    };
  }, [activeSymbol, enriched]);

  // Load from localStorage
  useEffect(() => {
    try {
      const syms = JSON.parse(localStorage.getItem('bn_checklist_symbols') ?? '[]') as string[];
      setSavedSymbols(syms);
      if (syms.length > 0 && !activeSymbol) {
        setActiveSymbol(syms[0]);
        const saved = JSON.parse(localStorage.getItem(`bn_checks_${syms[0]}`) ?? '{}');
        setChecks(saved);
      }
    } catch {}
  }, []);

  function loadSymbol(sym: string) {
    setActiveSymbol(sym);
    try { setChecks(JSON.parse(localStorage.getItem(`bn_checks_${sym}`) ?? '{}')); } catch { setChecks({}); }
  }

  function addSymbol() {
    const s = symbol.trim().toUpperCase();
    if (!s || savedSymbols.includes(s)) return;
    const next = [...savedSymbols, s];
    setSavedSymbols(next);
    localStorage.setItem('bn_checklist_symbols', JSON.stringify(next));
    loadSymbol(s);
    setSymbol('');
  }

  function toggleCheck(id: string) {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    if (activeSymbol) localStorage.setItem(`bn_checks_${activeSymbol}`, JSON.stringify(next));
  }

  function removeSymbol(sym: string) {
    const next = savedSymbols.filter(s => s !== sym);
    setSavedSymbols(next);
    localStorage.setItem('bn_checklist_symbols', JSON.stringify(next));
    localStorage.removeItem(`bn_checks_${sym}`);
    if (activeSymbol === sym) { setActiveSymbol(next[0] ?? ''); setChecks({}); }
  }

  const sections = [...new Set(CHECKLIST_ITEMS.map(i => i.section))];
  const completed = CHECKLIST_ITEMS.filter(i => checks[i.id]).length;
  const total = CHECKLIST_ITEMS.length;
  const pct = Math.round((completed / total) * 100);

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#0F7ABF08', border: '1px solid #0F7ABF28', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: '#0F7ABF', fontWeight: '700', margin: '0 0 3px' }}>📋 Serenity Research Checklist — Framework Part V</p>
        <p style={{ fontSize: '11px', color: '#8A95A3', margin: 0 }}>Complete ALL items before committing capital. Never commit more than 0.5% of portfolio without at least 5 primary source confirmations. Saved locally on your device.</p>
      </div>

      {/* Add ticker + saved tickers */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && addSymbol()}
          placeholder="Add ticker… (e.g. COHR)" maxLength={10}
          style={{ flex: '0 0 160px', padding: '8px 12px', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '8px', color: '#F5F7FA', fontSize: '13px', fontWeight: '600', outline: 'none' }} />
        <button onClick={addSymbol} style={{ padding: '8px 14px', backgroundColor: '#0F7ABF20', border: '1px solid #0F7ABF40', borderRadius: '8px', color: '#0F7ABF', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Add</button>
        {savedSymbols.map(s => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0', borderRadius: '8px', border: `1px solid ${activeSymbol === s ? '#0F7ABF60' : '#1A2840'}`, overflow: 'hidden' }}>
            <button onClick={() => loadSymbol(s)} style={{ padding: '6px 12px', background: activeSymbol === s ? '#0F7ABF20' : 'transparent', border: 'none', cursor: 'pointer', color: activeSymbol === s ? '#0F7ABF' : '#8A95A3', fontSize: '12px', fontWeight: '700' }}>{s}</button>
            <button onClick={() => removeSymbol(s)} style={{ padding: '6px 8px', background: 'none', border: 'none', borderLeft: '1px solid #1A2840', cursor: 'pointer', color: '#4A5B6C', fontSize: '11px' }}>×</button>
          </div>
        ))}
      </div>

      {activeSymbol ? (
        <>
          {/* Progress bar */}
          <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{activeSymbol} — Research Progress</span>
              <span style={{ fontSize: '13px', fontWeight: '800', color: pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444' }}>{pct}%</span>
            </div>
            <div style={{ height: '6px', backgroundColor: '#1A2840', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, backgroundColor: pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444', borderRadius: '3px', transition: 'width 0.3s' }} />
            </div>
            <p style={{ fontSize: '11px', color: '#4A5B6C', margin: '6px 0 0' }}>{completed} of {total} items complete — {pct >= 80 ? 'Ready to size position' : pct >= 50 ? 'Making progress — keep going' : 'Do not commit capital yet'}</p>
          </div>

          {/* Checklist sections */}
          {sections.map(sec => (
            <div key={sec} style={{ marginBottom: '16px' }}>
              <p style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>{sec.toUpperCase()}</p>
              {CHECKLIST_ITEMS.filter(i => i.section === sec).map(item => {
                const auto = autoChecks[item.id];
                const isChecked = auto?.pass || checks[item.id];
                const isAuto = !!auto;
                return (
                  <div key={item.id}>
                    <button onClick={() => !isAuto && toggleCheck(item.id)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 14px', marginBottom: isAuto && auto.note ? '0' : '4px', backgroundColor: isChecked ? '#10B98108' : '#0D1623', border: `1px solid ${isChecked ? '#10B98128' : '#1A2840'}`, borderRadius: isAuto && auto.note ? '8px 8px 0 0' : '8px', cursor: isAuto ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                      {isChecked ? <CheckSquare className="w-4 h-4" style={{ color: isAuto ? '#06B6D4' : '#10B981', flexShrink: 0, marginTop: '1px' }} /> : <Square className="w-4 h-4" style={{ color: '#4A5B6C', flexShrink: 0, marginTop: '1px' }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '12px', color: isChecked ? (isAuto ? '#06B6D4' : '#10B981') : '#C9D4E0', lineHeight: '1.4', textDecoration: isChecked ? 'line-through' : 'none', textDecorationColor: isAuto ? '#06B6D460' : '#10B98160' }}>{item.label}</span>
                        {isAuto && <span style={{ fontSize: '9px', color: '#06B6D4', backgroundColor: '#06B6D414', border: '1px solid #06B6D430', padding: '0 5px', borderRadius: '3px', marginLeft: '8px', fontWeight: '600' }}>AUTO</span>}
                      </div>
                    </button>
                    {isAuto && auto.note && (
                      <div style={{ padding: '6px 14px 8px 38px', backgroundColor: '#06B6D408', border: '1px solid #06B6D420', borderTop: 'none', borderRadius: '0 0 8px 8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '10px', color: '#06B6D4' }}>{auto.note}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#4A5B6C' }}>
          <CheckSquare className="w-10 h-10" style={{ margin: '0 auto 12px', color: '#1A2840' }} />
          <p style={{ fontSize: '13px' }}>Add a ticker above to start tracking your Serenity research checklist.</p>
        </div>
      )}
    </div>
  );
}

// ── Shared micro-components ───────────────────────────────────────────────────

function SkeletonGrid({ count, height }: { count: number; height: number }) {
  return (
    <div style={{ padding: '20px' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:.7}}`}</style>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ height, backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '10px', marginBottom: '8px', animation: 'pulse 1.5s ease-in-out infinite' }} />
      ))}
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '50px 20px', color: '#4A5B6C' }}>
      <AlertCircle className="w-10 h-10" style={{ margin: '0 auto 12px', color: '#1A2840' }} />
      <p style={{ fontSize: '13px' }}>{msg}</p>
    </div>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return <span style={{ fontSize: '9px', color, border: `1px solid ${color}30`, padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>{label}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function BottleneckIntelPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Rotation');

  const { data: dashboard, isLoading: dashLoading, refetch: refetchDash, dataUpdatedAt: dashTs } = useDashboard();
  const { data: bnArticles = [], isLoading: bnLoading, refetch: refetchBN } = useBNNews();
  const { data: geoArticles = [], isLoading: geoLoading, refetch: refetchGeo } = useGeoNews();
  const { data: usQuotes = [], isLoading: quotesLoading } = useUSQuotes();

  const lastRefreshed = useMemo(() => {
    if (!dashTs) return null;
    try { return formatDistanceToNow(new Date(dashTs), { addSuffix: true }); } catch { return null; }
  }, [dashTs]);

  const handleRefresh = useCallback(() => { refetchDash(); refetchBN(); refetchGeo(); }, [refetchDash, refetchBN, refetchGeo]);
  const isLoading = dashLoading || bnLoading;

  return (
    <div style={{ minHeight: '100%', backgroundColor: '#0A0E1A' }}>

      {/* Header */}
      <div style={{ padding: '18px 20px 0', borderBottom: '1px solid #1A2840', backgroundColor: '#0D1623' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
              <span style={{ fontSize: '20px' }}>🔬</span>
              <h1 style={{ fontSize: '18px', fontWeight: '800', margin: 0, letterSpacing: '-0.5px', background: 'linear-gradient(90deg,#F5F7FA 60%,#6B7A8D)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                BOTTLENECK INTELLIGENCE
              </h1>
            </div>
            <p style={{ fontSize: '11px', color: '#4A5B6C', margin: 0 }}>
              Serenity 37-Model Framework · Live Supply Chain Analysis
              {lastRefreshed && <span> · Updated {lastRefreshed}</span>}
            </p>
          </div>
          <button onClick={handleRefresh} disabled={isLoading} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', cursor: isLoading ? 'default' : 'pointer', backgroundColor: 'transparent', border: '1px solid #1A2840', color: isLoading ? '#4A5B6C' : '#6B7A8D', fontSize: '12px', flexShrink: 0 }}>
            <RefreshCw className="w-3 h-3" style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            {isLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {TABS.map(tab => {
            const meta = TAB_META[tab];
            const active = activeTab === tab;
            return (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '9px 16px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: active ? '#0F7ABF' : '#6B7A8D', fontSize: '12px', fontWeight: active ? '700' : '400', borderBottom: active ? '2px solid #0F7ABF' : '2px solid transparent', marginBottom: '-1px', flexShrink: 0, transition: 'all 0.15s' }}>
                {meta.icon}<span>{meta.short}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Description */}
      <div style={{ padding: '8px 20px', backgroundColor: '#060E1A', borderBottom: '1px solid #1A2840' }}>
        <p style={{ fontSize: '11px', color: '#4A5B6C', margin: 0 }}>{TAB_META[activeTab].description}</p>
      </div>

      {/* Content */}
      {activeTab === 'Rotation'  && <RotationTracker dashboard={dashboard} isLoading={dashLoading} articles={bnArticles} />}
      {activeTab === 'Scanner'   && <StockScanner articles={bnArticles} isLoading={bnLoading} quotes={usQuotes} quotesLoading={quotesLoading} />}
      {activeTab === 'Drilldown' && <DrilldownKB articles={bnArticles} />}
      {activeTab === 'Geo'       && <GeoOverlay articles={geoArticles} isLoading={geoLoading} />}
      {activeTab === 'Calendar'  && <ConferenceCalendar />}
      {activeTab === 'Map'       && <SupplyChainMap dashboard={dashboard} articles={bnArticles} />}
      {(() => { const enriched = buildEnrichedStocks(bnArticles, usQuotes); return activeTab === 'Checklist' && <SerenityChecklist enriched={enriched} />; })()}
    </div>
  );
}
