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
}
const DRILLDOWN: Record<string, DrilldownEntry> = {
  MEMORY_STORAGE: {
    label: 'Memory & Storage', icon: '🧠',
    why: 'HBM and enterprise DRAM/NAND capacity is sold out through 2026. Every hyperscaler GPU needs 6–8 stacks of HBM3E; capacity additions lag GPU demand by 18–24 months.',
    supply: 'Only 3 HBM producers (SK Hynix, Samsung, Micron). Capex cycles 2–3 years. Yield on HBM3E structurally below DDR5.',
    demand: 'Every Blackwell GPU consumes 8× HBM3E stacks. Inference clusters need 3–5× the memory footprint of training. Demand ~60% YoY.',
    winners: [
      { ticker: 'MU',       thesis: 'Micron: HBM3E ramp, capex leverage' },
      { ticker: 'SKX',      thesis: 'SK Hynix: HBM share leader 50%+ supply' },
      { ticker: 'AEHR',     thesis: 'Aehr Test: wafer-level burn-in bottleneck for HBM' },
    ],
    losers: [
      { ticker: 'NVDA', thesis: 'Margin pressure as HBM costs stay elevated' },
    ],
  },
  INTERCONNECT_PHOTONICS: {
    label: 'Interconnect & Photonics', icon: '💡',
    why: 'Copper hits bandwidth walls at 224 Gbps SerDes. Co-packaged optics (CPO) and silicon photonics are the only path to 1.6T/3.2T fabrics for future AI factories.',
    supply: 'CPO supply chain immature: lasers, modulators, couplers bottlenecked at handful of vendors. TSMC/Intel photonics integration still ramping.',
    demand: 'Every rack-scale AI system (NVL72, Trainium3) needs 10–100× more optical transceivers than prior generations. Hyperscaler buys locked through 2027.',
    winners: [
      { ticker: 'COHR', thesis: 'Coherent: datacenter transceivers, VCSEL supply' },
      { ticker: 'LITE', thesis: 'Lumentum: InP lasers for CPO modules' },
      { ticker: 'AVGO', thesis: 'Broadcom: Tomahawk 5 + CPO reference design' },
      { ticker: 'MRVL', thesis: 'Marvell: 800G/1.6T DSPs, custom silicon' },
      { ticker: 'AAOI', thesis: 'AAOI: 800G single-mode transceivers ramping' },
    ],
    losers: [],
  },
  FABRICATION_PACKAGING: {
    label: 'Advanced Fabrication & Packaging', icon: '🏭',
    why: 'CoWoS advanced packaging at TSMC is the single-point bottleneck for every leading-edge AI accelerator. Capacity doubles every 18 months but demand outpaces it.',
    supply: 'TSMC CoWoS-L/S: ~35K wpm 2024, ~70K wpm targeted 2026. Intel Foveros and Samsung I-Cube sub-scale. ASML High-NA EUV gating N2/A16 ramp.',
    demand: 'Nvidia alone consumes 60%+ of CoWoS. AMD MI300/MI350, AWS Trainium, Google TPU all share remaining. Demand 80%+ YoY.',
    winners: [
      { ticker: 'TSM',  thesis: 'TSMC: monopoly advanced packaging, CoWoS pricing power' },
      { ticker: 'ASML', thesis: 'ASML: sole EUV/High-NA supplier, 2-year backlog' },
      { ticker: 'AMAT', thesis: 'Applied Materials: advanced packaging tools' },
      { ticker: 'LRCX', thesis: 'Lam Research: etch and deposition for N2/A16' },
    ],
    losers: [{ ticker: 'INTC', thesis: 'Intel Foundry behind on advanced packaging' }],
  },
  COMPUTE_SCALING: {
    label: 'Compute & GPU Allocation', icon: '⚡',
    why: 'GPU supply remains rationed by Nvidia. H100/H200 allocation relationship-driven. Blackwell ramp gated by CoWoS. Tier-2 clouds and enterprises wait 6–12 months.',
    supply: 'Nvidia ships what TSMC packages. MI300X/MI325X the only meaningful alternative; TPU/Trainium captive to respective hyperscalers.',
    demand: 'Hyperscaler AI capex ~$300B/yr, projected $450B+ 2026. Sovereign AI funds, neoclouds, enterprise inference all competing for allocation.',
    winners: [
      { ticker: 'NVDA', thesis: 'Nvidia: allocation monopoly, 75%+ gross margin' },
      { ticker: 'AMD',  thesis: 'AMD: MI series captures tier-2 demand' },
      { ticker: 'AVGO', thesis: 'Broadcom: custom ASIC (TPU, MTIA)' },
    ],
    losers: [{ ticker: 'CRWV', thesis: 'Neoclouds dependent on NVDA allocation' }],
  },
  POWER_GRID: {
    label: 'Power & Grid Constraints', icon: '🔌',
    why: 'Data center power demand outpaces grid interconnect timelines by 3–7 years. Transformer, switchgear, and HV cable lead times are 80–130 weeks.',
    supply: 'Only 3 major transformer OEMs globally. Grain-oriented electrical steel (GOES) constrained. Utility interconnect queues span 5–10 years in PJM/ERCOT.',
    demand: 'AI data center nameplate demand: 50 GW US by 2030 (Goldman, EPRI). Hyperscaler site selection now power-first.',
    winners: [
      { ticker: 'GEV', thesis: 'GE Vernova: grid equipment, transformers' },
      { ticker: 'ETN', thesis: 'Eaton: switchgear, UPS, electrical backbone' },
      { ticker: 'VRT', thesis: 'Vertiv: power/cooling for data centers' },
    ],
    losers: [],
  },
  NUCLEAR_ENERGY: {
    label: 'Nuclear Energy', icon: '☢️',
    why: 'Hyperscalers pivoting to nuclear PPAs for 24/7 carbon-free baseload. SMRs and restart of retired plants are the only GW-scale path this decade.',
    supply: 'Enriched uranium supply constrained post-Russia sanctions. Centrus and Urenco ramping HALEU slowly. SMR deployments 2028–2032.',
    demand: 'MSFT/Three Mile Island, AMZN/Talen, GOOG/Kairos, META SMR RFP — every hyperscaler has inked nuclear deals.',
    winners: [
      { ticker: 'CCJ', thesis: 'Cameco: uranium mining leader' },
      { ticker: 'LEU', thesis: 'Centrus: HALEU enrichment monopoly' },
      { ticker: 'CEG', thesis: 'Constellation: Three Mile Island restart, MSFT PPA' },
      { ticker: 'TLN', thesis: 'Talen: Susquehanna nuclear + AWS deal' },
    ],
    losers: [],
  },
  THERMAL_COOLING: {
    label: 'Thermal & Cooling', icon: '❄️',
    why: 'Blackwell and beyond require direct-to-chip liquid cooling. Retrofit impractical; new builds 100% liquid-cooled. CDU and cold-plate supply sold out.',
    supply: 'CoolIT, Motivair, Boyd, Asetek are the main CDU vendors. Cold plate supply concentrated in Taiwan.',
    demand: 'NVL72 racks = 120+ kW/rack. Every new AI data center must deploy liquid cooling.',
    winners: [
      { ticker: 'VRT',   thesis: 'Vertiv: liquid cooling + power thermal management' },
      { ticker: 'SMCI',  thesis: 'Supermicro: liquid-cooled rack integration' },
    ],
    losers: [],
  },
  MATERIALS_SUPPLY: {
    label: 'Critical Materials', icon: '⛏️',
    why: 'Gallium, germanium, neon, rare earths, and high-purity quartz gating semi and defense supply chains. China export controls accelerating bifurcation.',
    supply: 'China controls 80%+ of gallium/germanium processing, 90%+ of rare earth refining. Alternative supply 3–7 years out.',
    demand: 'AI, defense, EV, and renewable electrification all drawing from same materials stack. Demand 2–3× by 2030.',
    winners: [
      { ticker: 'MP',   thesis: 'MP Materials: US rare earth independence' },
      { ticker: 'AXTI', thesis: 'AXT Inc: InP/GaAs substrates — Strait of Hormuz analogy (+5,579% YTD)' },
    ],
    losers: [],
  },
  QUANTUM_CRYOGENICS: {
    label: 'Quantum & Cryogenics', icon: '🧊',
    why: 'Quantum hardware gated by dilution refrigerators, helium-3, and cryo electronics. Scale-up of logical qubits is the decade-long bottleneck.',
    supply: 'Bluefors, Oxford Instruments dominate dilution fridges. Helium-3 supply constrained by tritium decay chain.',
    demand: 'Sovereign quantum programs (US DOE, EU, China, India) + hyperscaler R&D (IBM, Google, MSFT, AMZN). Demand inelastic.',
    winners: [
      { ticker: 'IBM',  thesis: 'IBM: largest gate-based quantum fleet' },
      { ticker: 'IONQ', thesis: 'IonQ: trapped-ion roadmap' },
      { ticker: 'RGTI', thesis: 'Rigetti: superconducting qubit IP' },
    ],
    losers: [],
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
  'FDA','DOE','DOD','DOJ','CFPB','IRS','CFTC','FINRA','FTC','BOI','SBI','PNB','IOB','BOB','UCO',
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

// ── Scanner builder ───────────────────────────────────────────────────────────

interface ScannerRow {
  symbol: string; sub_tag?: string; level?: string; evidence_count: number;
  latest_at?: string; headlines: string[]; exchange?: string;
  price?: number; market_cap?: number; change_pct?: number; company_name?: string;
  is_small_cap: boolean; is_non_us: boolean; score: number;
  tier?: { tier: number; label: string; color: string };
}

interface RowBase { symbol: string; sub_tag?: string; level?: string; evidence_count: number; latest_at?: string; headlines: string[]; }

function buildRows(articles: NewsArticle[], quotes: QuoteStock[]): ScannerRow[] {
  const map = new Map<string, RowBase>();
  for (const a of articles) {
    for (const sym of getTickerSymbols(a)) {
      if (!map.has(sym)) map.set(sym, { symbol: sym, sub_tag: a.bottleneck_sub_tag, level: a.bottleneck_level, evidence_count: 0, latest_at: a.published_at, headlines: [] });
      const r = map.get(sym)!;
      r.evidence_count++;
      const lvs = ['CRITICAL','BOTTLENECK','WATCH','RESOLVED'];
      if (a.bottleneck_level) { const ni = lvs.indexOf(a.bottleneck_level.toUpperCase()), ci = lvs.indexOf((r.level ?? '').toUpperCase()); if (ni !== -1 && (ci === -1 || ni < ci)) r.level = a.bottleneck_level; }
      if (!r.sub_tag && a.bottleneck_sub_tag) r.sub_tag = a.bottleneck_sub_tag;
      const h = a.title || a.headline || '';
      if (h && r.headlines.length < 4 && !r.headlines.includes(h)) r.headlines.push(h);
      if (a.published_at && (!r.latest_at || a.published_at > r.latest_at)) r.latest_at = a.published_at;
    }
  }
  const qm = new Map<string, QuoteStock>(quotes.map(q => [q.ticker.toUpperCase(), q]));
  return Array.from(map.values())
    .filter(r => (r.sub_tag && r.evidence_count >= 1) || r.evidence_count >= 2)
    .map((base: RowBase): ScannerRow => {
      const q = qm.get(base.symbol.toUpperCase());
      const mc = q?.marketCap;
      const isSC = !!(mc && mc > 0 && mc < 2_000_000_000);
      const ef = exchangeFlag(q?.sector);
      const tierInfo = base.sub_tag ? TIER_MAP[base.sub_tag] : undefined;
      return {
        symbol: base.symbol, sub_tag: base.sub_tag, level: base.level,
        evidence_count: base.evidence_count, latest_at: base.latest_at, headlines: base.headlines,
        price: q?.price, market_cap: mc, change_pct: q?.changePercent, company_name: q?.company,
        exchange: q?.sector, is_small_cap: isSC, is_non_us: !!ef, tier: tierInfo,
        score: calcScore({ level: base.level, evidence_count: base.evidence_count, sub_tag: base.sub_tag, is_small_cap: isSC }),
      };
    })
    .sort((a, b) => b.score - a.score);
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — ROTATION TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

function RotationTracker({ dashboard, isLoading }: { dashboard?: BnDashboard; isLoading: boolean }) {
  const [expBucket, setExpBucket] = useState<string | null>(null);
  const [expSignal, setExpSignal] = useState<string | null>(null);

  if (isLoading) return <SkeletonGrid count={6} height={150} />;
  if (!dashboard?.buckets?.length) return <EmptyState msg="No bottleneck dashboard data. Check backend." />;

  const sorted = [...dashboard.buckets].sort((a, b) => b.severity - a.severity);
  const top = sorted[0];

  return (
    <div style={{ padding: '20px' }}>
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
      {/* Rotation strip */}
      <div style={{ marginBottom: '20px', padding: '10px 16px', backgroundColor: '#060E1A', borderRadius: '8px', border: '1px solid #1A2840', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '1px', marginRight: '4px' }}>ROTATION →</span>
        {sorted.map((b, i) => (
          <span key={b.bucket_id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {i > 0 && <span style={{ color: '#1A2840' }}>›</span>}
            <span style={{ fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px', color: getSev(b.severity_label).badge, backgroundColor: getSev(b.severity_label).badgeBg, border: `1px solid ${getSev(b.severity_label).border}`, opacity: Math.max(0.4, 1 - i * 0.1) }}>{b.label}</span>
          </span>
        ))}
      </div>
      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
        {sorted.map((b) => {
          const sty = getSev(b.severity_label);
          const isExp = expBucket === b.bucket_id;
          return (
            <div key={b.bucket_id} style={{ backgroundColor: sty.bg || '#0D1623', border: `1px solid ${sty.border}`, borderRadius: '12px', overflow: 'hidden', boxShadow: isExp ? sty.glow : 'none' }}>
              <button onClick={() => setExpBucket(isExp ? null : b.bucket_id)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '22px', flexShrink: 0 }}>{b.severity_icon || '🔹'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{b.label}</span>
                      <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', color: sty.badge, backgroundColor: sty.badgeBg, padding: '2px 6px', borderRadius: '3px' }}>{b.severity_label}</span>
                    </div>
                    <p style={{ fontSize: '11px', color: '#6B7A8D', margin: '0 0 8px', lineHeight: '1.4' }}>{b.description}</p>
                    <div style={{ display: 'flex', gap: '14px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', color: '#8A95A3' }}><span style={{ color: sty.badge, fontWeight: '700', fontSize: '15px' }}>{b.signal_count}</span> signals</span>
                      <span style={{ fontSize: '11px', color: '#8A95A3' }}><span style={{ fontWeight: '600', color: '#C9D4E0' }}>{b.article_count}</span> articles</span>
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — STOCK SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

function StockScanner({ articles, isLoading, quotes, quotesLoading }: { articles: NewsArticle[]; isLoading: boolean; quotes: QuoteStock[]; quotesLoading: boolean }) {
  const [filterLevel, setFilterLevel] = useState('ALL');
  const [expRow, setExpRow] = useState<string | null>(null);
  const allRows = useMemo(() => buildRows(articles, quotes), [articles, quotes]);
  const rows = useMemo(() => filterLevel === 'ALL' ? allRows : allRows.filter(r => r.level?.toUpperCase() === filterLevel), [allRows, filterLevel]);
  const asymmetry = allRows.filter(r => r.is_small_cap && ['CRITICAL','BOTTLENECK'].includes(r.level?.toUpperCase() ?? ''));

  if (isLoading) return <SkeletonGrid count={8} height={54} />;

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {['ALL','CRITICAL','BOTTLENECK','WATCH'].map(lv => {
            const cnt = lv === 'ALL' ? allRows.length : allRows.filter(r => r.level?.toUpperCase() === lv).length;
            const ls = getLvl(lv);
            return <button key={lv} onClick={() => setFilterLevel(lv)} style={{ padding: '5px 12px', borderRadius: '7px', border: `1px solid ${filterLevel === lv ? (ls?.border ?? '#0F7ABF40') : '#1A2840'}`, cursor: 'pointer', backgroundColor: filterLevel === lv ? (ls?.bg ?? '#0F7ABF14') : 'transparent', color: filterLevel === lv ? (ls?.color ?? '#0F7ABF') : '#6B7A8D', fontSize: '11px', fontWeight: '600' }}>{lv} ({cnt})</button>;
          })}
        </div>
        <span style={{ fontSize: '11px', color: '#4A5B6C', marginLeft: 'auto' }}>{rows.length} companies · {quotesLoading ? 'loading quotes…' : `${quotes.length} prices`}</span>
      </div>
      {asymmetry.length > 0 && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', backgroundColor: '#F59E0B08', border: '1px solid #F59E0B28', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Flag className="w-4 h-4" style={{ color: '#F59E0B', flexShrink: 0 }} />
          <span style={{ fontSize: '12px', color: '#F59E0B', fontWeight: '700' }}>{asymmetry.length} size asymmetry plays </span>
          <span style={{ fontSize: '11px', color: '#8A95A3' }}>— small-cap (&lt;$2B) at CRITICAL/BOTTLENECK severity · Model 06</span>
        </div>
      )}
      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '46px 88px 1fr 108px 108px 64px 78px', gap: '8px', padding: '6px 12px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px', color: '#4A5B6C', borderBottom: '1px solid #1A2840' }}>
        <span>SCORE</span><span>TICKER</span><span>LAYER</span><span>LEVEL</span><span>MKT CAP</span><span>SIGNALS</span><span>PRICE</span>
      </div>
      {rows.length === 0 ? <EmptyState msg="No results for this filter." /> : rows.map((row, idx) => {
        const ls = getLvl(row.level);
        const isExp = expRow === row.symbol;
        const cp = row.change_pct ?? 0;
        return (
          <div key={row.symbol} style={{ borderBottom: '1px solid #1A284018' }}>
            <button onClick={() => setExpRow(isExp ? null : row.symbol)} style={{ width: '100%', background: isExp ? '#0D162340' : idx % 2 === 1 ? '#060E1A18' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '9px 12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '46px 88px 1fr 108px 108px 64px 78px', gap: '8px', alignItems: 'center' }}>
                <ScoreGauge score={row.score} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{row.symbol}</span>
                  {row.is_non_us && exchangeFlag(row.exchange) && <span style={{ fontSize: '13px' }}>{exchangeFlag(row.exchange)!.flag}</span>}
                  {row.is_small_cap && <span title="Small-cap <$2B" style={{ fontSize: '8px', color: '#F59E0B', border: '1px solid #F59E0B40', padding: '0 3px', borderRadius: '3px', fontWeight: '700' }}>SC</span>}
                  {idx < 3 && <Trophy className="w-3 h-3" style={{ color: scoreColor(row.score) }} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  {row.tier ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ fontSize: '9px', fontWeight: '700', color: row.tier.color, border: `1px solid ${row.tier.color}40`, padding: '1px 4px', borderRadius: '3px', flexShrink: 0 }}>T{row.tier.tier}</span>
                      <span style={{ fontSize: '11px', color: '#8A95A3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.sub_tag!.replace(/_/g,' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}</span>
                    </div>
                  ) : <span style={{ fontSize: '11px', color: '#4A5B6C' }}>—</span>}
                </div>
                {ls ? <span style={{ fontSize: '10px', fontWeight: '700', color: ls.color, backgroundColor: ls.bg, border: `1px solid ${ls.border}`, padding: '3px 8px', borderRadius: '4px', textAlign: 'center' }}>{row.level}</span> : <span style={{ fontSize: '11px', color: '#4A5B6C' }}>—</span>}
                <span style={{ fontSize: '12px', color: row.is_small_cap ? '#F59E0B' : '#C9D4E0', fontWeight: row.is_small_cap ? '700' : '400' }}>{fmtCap(row.market_cap)}</span>
                <span style={{ fontSize: '14px', fontWeight: '700', color: '#C9D4E0' }}>{row.evidence_count}</span>
                <div>{row.price ? <><span style={{ fontSize: '12px', fontWeight: '600', color: '#F5F7FA' }}>${row.price.toFixed(2)}</span>{cp !== 0 && <div style={{ fontSize: '10px', color: cp >= 0 ? '#10B981' : '#EF4444' }}>{cp >= 0 ? '+' : ''}{cp.toFixed(2)}%</div>}</> : <span style={{ fontSize: '11px', color: '#4A5B6C' }}>—</span>}</div>
              </div>
            </button>
            {isExp && (
              <div style={{ padding: '10px 12px 14px 58px', backgroundColor: '#060E1A30', borderTop: '1px solid #1A2840' }}>
                <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {row.company_name && <span style={{ fontSize: '12px', color: '#8A95A3' }}>{row.company_name}</span>}
                  {row.tier && <span style={{ fontSize: '11px', color: row.tier.color }}>{row.tier.label}</span>}
                  {row.latest_at && <span style={{ fontSize: '10px', color: '#4A5B6C' }}>Last signal {timeAgo(row.latest_at)}</span>}
                </div>
                <p style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '6px' }}>EVIDENCE ({row.evidence_count} articles)</p>
                {row.headlines.map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', padding: '7px 10px', marginBottom: '4px', backgroundColor: '#060E1A', borderRadius: '6px', border: '1px solid #1A2840' }}>
                    <Zap className="w-3 h-3" style={{ color: '#0F7ABF', flexShrink: 0, marginTop: '2px' }} />
                    <span style={{ fontSize: '11px', color: '#C9D4E0', lineHeight: '1.45' }}>{h}</span>
                  </div>
                ))}
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {row.sub_tag && <Tag label="Model 01 · Supply Chain" color="#8B5CF6" />}
                  {row.is_small_cap && <Tag label="Model 06 · Size Asymmetry" color="#F59E0B" />}
                  {row.evidence_count >= 3 && <Tag label="Model 02 · Monopoly Signal" color="#0F7ABF" />}
                  {row.is_non_us && <Tag label="Model 10 · Cross-Border Arb" color="#06B6D4" />}
                </div>
              </div>
            )}
          </div>
        );
      })}
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

function GeoOverlay({ articles, isLoading }: { articles: NewsArticle[]; isLoading: boolean }) {
  const [typeFilter, setTypeFilter] = useState('ALL');
  if (isLoading) return <SkeletonGrid count={6} height={80} />;

  const filtered = typeFilter === 'ALL' ? articles : articles.filter(a => a.article_type === typeFilter);
  const typeColor = (t: string) => ({ GEOPOLITICAL: '#EF4444', TARIFF: '#F59E0B', MACRO: '#8B5CF6' })[t] ?? '#4A5B6C';

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#EF444408', border: '1px solid #EF444428', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: '#EF4444', fontWeight: '700', margin: '0 0 4px' }}>⚠️ Geopolitical Accelerant — Model 29</p>
        <p style={{ fontSize: '11px', color: '#8A95A3', margin: 0, lineHeight: '1.5' }}>
          Geopolitical disruption = accelerant to upstream supply chain bottleneck positions. When supply chains become more fragile globally, chokepoint companies become MORE valuable.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {['ALL','GEOPOLITICAL','TARIFF'].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)} style={{
            padding: '5px 12px', borderRadius: '7px', border: `1px solid ${typeFilter === t ? typeColor(t) + '60' : '#1A2840'}`,
            cursor: 'pointer', backgroundColor: typeFilter === t ? typeColor(t) + '14' : 'transparent',
            color: typeFilter === t ? typeColor(t) : '#6B7A8D', fontSize: '11px', fontWeight: '600',
          }}>
            {t} ({t === 'ALL' ? articles.length : articles.filter(a => a.article_type === t).length})
          </button>
        ))}
        <span style={{ fontSize: '11px', color: '#4A5B6C', marginLeft: 'auto', alignSelf: 'center' }}>Live · auto-refreshes every 90s</span>
      </div>

      {filtered.length === 0 ? <EmptyState msg="No geopolitical articles found." /> : filtered.map((a, i) => {
        const url = cleanUrl(a.url || a.source_url || '#');
        const tc = typeColor(a.article_type);
        const tickers = getTickerSymbols(a);
        const sentiment = a.sentiment?.toUpperCase();
        const sentColor = sentiment === 'BULLISH' ? '#10B981' : sentiment === 'BEARISH' ? '#EF4444' : '#6B7A8D';
        return (
          <div key={a.id || i} style={{ marginBottom: '8px', padding: '12px 14px', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '10px', borderLeft: `3px solid ${tc}` }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', color: tc, backgroundColor: tc + '18', padding: '2px 7px', borderRadius: '3px', flexShrink: 0 }}>{a.article_type}</span>
              {sentiment && sentiment !== 'NEUTRAL' && <span style={{ fontSize: '9px', color: sentColor, fontWeight: '700' }}>{sentiment === 'BULLISH' ? '↑' : '↓'} {sentiment}</span>}
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: '13px', color: '#C9D4E0', margin: '0 0 6px', lineHeight: '1.4', fontWeight: '500' }}>{a.title || a.headline}</p>
            </a>
            {a.summary && <p style={{ fontSize: '11px', color: '#8A95A3', margin: '0 0 8px', lineHeight: '1.5' }}>{a.summary}</p>}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{a.source_name}</span>
              <span style={{ fontSize: '10px', color: '#4A5B6C' }}>·</span>
              <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{timeAgo(a.published_at)}</span>
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
// SECTION 5 — CONFERENCE CALENDAR
// ═══════════════════════════════════════════════════════════════════════════════

function ConferenceCalendar() {
  const now = new Date();
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
          const statusStyle = {
            upcoming: { bg: '#0F7ABF14', border: '#0F7ABF30', badge: '#0F7ABF', label: 'UPCOMING' },
            soon:     { bg: '#F59E0B14', border: '#F59E0B30', badge: '#F59E0B', label: '⚡ ENTER NOW' },
            past:     { bg: '#4A5B6C14', border: '#1A2840',   badge: '#4A5B6C', label: 'PAST' },
          }[status];
          return (
            <div key={conf.name} style={{ padding: '16px', border: `1px solid ${statusStyle.border}`, borderRadius: '12px', backgroundColor: statusStyle.bg }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '800', color: '#F5F7FA' }}>{conf.name}</span>
                    <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', color: statusStyle.badge, backgroundColor: statusStyle.badge + '20', padding: '2px 6px', borderRadius: '3px' }}>{statusStyle.label}</span>
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — SUPPLY CHAIN MAP
// ═══════════════════════════════════════════════════════════════════════════════

function SupplyChainMap({ dashboard }: { dashboard?: BnDashboard }) {
  const activeBuckets = new Set(dashboard?.buckets?.filter(b => b.severity >= 3).map(b => b.bucket_id) ?? []);

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#8B5CF608', border: '1px solid #8B5CF628', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: '#8B5CF6', fontWeight: '700', margin: '0 0 3px' }}>🗺️ AI Infrastructure Value Chain — Models 01, 05, 18</p>
        <p style={{ fontSize: '11px', color: '#8A95A3', margin: 0 }}>The further upstream from the hyped name, the less investor competition. Monopolistic positioning increases as you go further upstream. Active bottlenecks highlighted.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {SUPPLY_CHAIN.map((tier, i) => {
          // Map tier to sub_tag for bottleneck detection
          const tagForTier = Object.entries(TIER_MAP).find(([, v]) => v.tier === tier.tier)?.[0];
          const isActive = tagForTier ? activeBuckets.has(tagForTier) : false;
          const arrow = i < SUPPLY_CHAIN.length - 1;

          return (
            <div key={tier.tier}>
              <div style={{
                padding: '14px 18px', borderRadius: '10px',
                backgroundColor: isActive ? tier.color + '12' : '#0D1623',
                border: `1px solid ${isActive ? tier.color + '60' : '#1A2840'}`,
                boxShadow: isActive ? `0 0 14px ${tier.color}18` : 'none',
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: '14px',
              }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: tier.color + '20', border: `1px solid ${tier.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '13px', fontWeight: '800', color: tier.color }}>T{tier.tier}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{tier.label}</span>
                    {isActive && <span style={{ fontSize: '9px', fontWeight: '700', color: '#EF4444', backgroundColor: '#EF444420', border: '1px solid #EF444440', padding: '2px 7px', borderRadius: '3px', letterSpacing: '0.8px' }}>⚡ ACTIVE BOTTLENECK</span>}
                  </div>
                  <p style={{ fontSize: '11px', color: '#6B7A8D', margin: '0 0 6px' }}>{tier.sub}</p>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {tier.companies.map(c => (
                      <span key={c} style={{ fontSize: '10px', fontWeight: '600', color: tier.color, backgroundColor: tier.color + '14', border: `1px solid ${tier.color}30`, padding: '1px 7px', borderRadius: '4px' }}>{c}</span>
                    ))}
                  </div>
                </div>
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

function SerenityChecklist() {
  const [symbol, setSymbol] = useState('');
  const [activeSymbol, setActiveSymbol] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [savedSymbols, setSavedSymbols] = useState<string[]>([]);

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
              {CHECKLIST_ITEMS.filter(i => i.section === sec).map(item => (
                <button key={item.id} onClick={() => toggleCheck(item.id)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 14px', marginBottom: '4px', backgroundColor: checks[item.id] ? '#10B98108' : '#0D1623', border: `1px solid ${checks[item.id] ? '#10B98128' : '#1A2840'}`, borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s' }}>
                  {checks[item.id] ? <CheckSquare className="w-4 h-4" style={{ color: '#10B981', flexShrink: 0, marginTop: '1px' }} /> : <Square className="w-4 h-4" style={{ color: '#4A5B6C', flexShrink: 0, marginTop: '1px' }} />}
                  <span style={{ fontSize: '12px', color: checks[item.id] ? '#10B981' : '#C9D4E0', lineHeight: '1.4', textDecoration: checks[item.id] ? 'line-through' : 'none', textDecorationColor: '#10B98160' }}>{item.label}</span>
                </button>
              ))}
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
      {activeTab === 'Rotation'  && <RotationTracker dashboard={dashboard} isLoading={dashLoading} />}
      {activeTab === 'Scanner'   && <StockScanner articles={bnArticles} isLoading={bnLoading} quotes={usQuotes} quotesLoading={quotesLoading} />}
      {activeTab === 'Drilldown' && <DrilldownKB articles={bnArticles} />}
      {activeTab === 'Geo'       && <GeoOverlay articles={geoArticles} isLoading={geoLoading} />}
      {activeTab === 'Calendar'  && <ConferenceCalendar />}
      {activeTab === 'Map'       && <SupplyChainMap dashboard={dashboard} />}
      {activeTab === 'Checklist' && <SerenityChecklist />}
    </div>
  );
}
