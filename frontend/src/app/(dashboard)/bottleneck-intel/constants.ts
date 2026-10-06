// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type ThemeParent, type QualStage, type DrilldownEntry, type EvidenceType, type Conference } from './types';

// ── Tab config ────────────────────────────────────────────────────────────────

export const TABS = ['Rotation', 'Scanner', 'Drilldown', 'Geo', 'Calendar', 'Map', 'Checklist'] as const;
// ── Severity styles ───────────────────────────────────────────────────────────

export const SEV: Record<string, { bg: string; border: string; badge: string; badgeBg: string; glow: string }> = {
  CRITICAL: { bg: '#EF444408', border: '#EF444430', badge: '#EF4444', badgeBg: '#EF444418', glow: '0 0 20px #EF444415' },
  HIGH:     { bg: '#F59E0B06', border: '#F59E0B28', badge: '#F59E0B', badgeBg: '#F59E0B14', glow: '0 0 16px #F59E0B10' },
  ELEVATED: { bg: '#8B5CF606', border: '#8B5CF628', badge: '#8B5CF6', badgeBg: '#8B5CF614', glow: '0 0 16px #8B5CF610' },
  WATCH:    { bg: '#0F7ABF06', border: '#0F7ABF28', badge: '#0F7ABF', badgeBg: '#0F7ABF14', glow: 'none' },
  DEFAULT:  { bg: 'transparent', border: '#1A2840', badge: '#4A5B6C', badgeBg: '#4A5B6C14', glow: 'none' },
};
// AUDIT_100 #11 — explicit allow-list. Previously this iterated Object.keys(SEV)
// which includes 'DEFAULT'; any label containing the substring "default" matched
// the placeholder bucket. Now we only test real severity tiers.
export const SEV_KEYS_ORDER = ['CRITICAL', 'HIGH', 'ELEVATED', 'WATCH'] as const;
export const LEVEL_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  CRITICAL:   { color: '#EF4444', bg: '#EF444418', border: '#EF444440' },
  BOTTLENECK: { color: '#F59E0B', bg: '#F59E0B14', border: '#F59E0B30' },
  WATCH:      { color: '#0F7ABF', bg: '#0F7ABF14', border: '#0F7ABF30' },
  RESOLVED:   { color: '#10B981', bg: '#10B98114', border: '#10B98130' },
};
// ── Supply chain tier map ─────────────────────────────────────────────────────

export const TIER_MAP: Record<string, { tier: number; label: string; color: string }> = {
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
export const THEME_PARENTS: ThemeParent[] = [
  { id: 'POWER_INFRASTRUCTURE', label: 'Power & Grid Infrastructure', icon: '⚡', color: '#F59E0B',
    children: ['POWER_GRID','NUCLEAR_ENERGY','THERMAL_COOLING','transformer','ai_power','cooling_cdm'],
    overlap_note: 'All driven by AI data center power demand. POWER_GRID = supply constraint; NUCLEAR = long-cycle solution; THERMAL_COOLING = on-site DC constraint. Transformer/AI Power = early-warning signals for POWER_GRID.',
  },
  { id: 'AI_SILICON_STACK', label: 'AI Silicon Supply Stack', icon: '🏭', color: '#0F7ABF',
    children: ['FABRICATION_PACKAGING','INTERCONNECT_PHOTONICS','MEMORY_STORAGE','COMPUTE_SCALING','opt_test','qual_cycle'],
    overlap_note: 'CoWoS (packaging) enables HBM stacking (memory) and optical I/O integration (photonics). All are sequential constraints, not independent bottlenecks.',
  },
  { id: 'CRITICAL_MATERIALS', label: 'Critical Materials & Geopolitics', icon: '⛏️', color: '#8B5CF6',
    children: ['MATERIALS_SUPPLY','rare_earth','specialty_gas','backlog','defense_semi'],
    overlap_note: 'Rare earth / specialty gas / critical minerals are sub-categories of MATERIALS_SUPPLY. Backlog is a cross-cutting signal, not a standalone bottleneck.',
  },
  { id: 'ADVANCED_COMPUTE', label: 'Advanced Compute & Quantum', icon: '🧊', color: '#06B6D4',
    children: ['QUANTUM_CRYOGENICS'],
    overlap_note: 'Long-horizon, structural — separate from near-term AI silicon bottlenecks.',
  },
];
// Change tracker: what changed since last session
export const CHANGE_TRACKER_KEY = 'mc_bn_snapshot_v1';
// ── 3-State Lifecycle Classification ─────────────────────────────────────────
// Every bucket is classified into a lifecycle state based on current news velocity.
// This prevents "CRITICAL" labels on stale themes with zero weekly articles.
export const STRUCTURAL_THEMES = new Set([
  'FABRICATION_PACKAGING', // CoWoS constraint — decade-long infrastructure cycle
  'INTERCONNECT_PHOTONICS', // CPO is 2025-2030 structural transition
  'MATERIALS_SUPPLY',      // Critical minerals bifurcation — geopolitical, decade+
  'POWER_GRID',            // Grid interconnect queues span 5-10 years
  'NUCLEAR_ENERGY',        // SMR deployments are 2028+ structural story
]);
export const QUAL_STAGE_CONFIG: Record<QualStage, { label: string; color: string; desc: string }> = {
  PRE_QUAL:     { label: 'Pre-Qual',    color: '#4A5B6C', desc: 'Not yet in any customer design — very early stage' },
  DESIGN_WIN:   { label: 'Design Win',  color: '#8B5CF6', desc: 'Confirmed design win, customer committed — pre-revenue but high conviction' },
  QUALIFICATION:{ label: 'Qualifying',  color: '#F59E0B', desc: 'Active qualification in progress — revenue possible within 12-18 months' },
  RAMP:         { label: 'Ramping',     color: '#10B981', desc: 'Qualification complete, early production revenue, scaling up' },
  VOLUME:       { label: 'Volume',      color: '#0F7ABF', desc: 'At or near full volume production — thesis largely confirmed by market' },
  UNKNOWN:      { label: '?',           color: '#4A5B6C', desc: 'Stage not confirmed from public sources' },
};
export const DRILLDOWN: Record<string, DrilldownEntry> = {
  MEMORY_STORAGE: {
    label: 'Memory & Storage', icon: '🧠', lifecycle: 'structural',
    why: 'HBM and enterprise DRAM/NAND capacity is sold out through 2026. Every hyperscaler GPU needs 6–8 stacks of HBM3E; capacity additions lag GPU demand by 18–24 months.',
    supply: 'Only 3 HBM producers (SK Hynix, Samsung, Micron). Capex cycles 2–3 years. Yield on HBM3E structurally below DDR5.',
    demand: 'Every Blackwell GPU consumes 8× HBM3E stacks. Inference clusters need 3–5× the memory footprint of training. Demand ~60% YoY.',
    winners: [{ ticker: 'MU', thesis: 'Micron: HBM3E ramp, capex leverage' }, { ticker: 'AEHR', thesis: 'Aehr Test: wafer-level burn-in bottleneck for HBM' }],
    losers: [{ ticker: 'NVDA', thesis: 'Margin pressure as HBM costs stay elevated' }],
    confirms: ['HBM3E ASP increasing in supplier earnings calls', 'Lead times quoted >6 months by NVDA/AMD', 'New data center announcements citing memory as constraint', 'Micron/SK Hynix capacity sold out for next 2 quarters'],
    breaks: ['A 4th HBM supplier qualifies at major hyperscaler', 'AI inference demand drops materially (model efficiency breakthrough)', 'TSMC CoWoS capacity glut forces GPU inventory correction'],
    contradictions: ['SK Hynix/Samsung both report HBM inventory build (not sold through)', 'AI model architectures shift to smaller context windows reducing memory bandwidth need', 'CXL memory pooling reduces per-server HBM requirements by >30%'],
    watch_kpi: ['HBM3E spot pricing (should be rising)', 'MU/SKX gross margin trajectory', 'NVDA H200 vs B200 shipment mix (B200 = 8× more HBM)', 'AEHR order backlog language in earnings calls'],
    causal_chain: ['AI training scale ↑ → HBM demand surge → HBM 3-vendor oligopoly constrained → CoWoS packaging required for HBM stacking → advanced packaging substrate demand → power/cooling for HBM-dense systems'],
    india_plays: [
      { ticker: 'INFY', exchange: 'NSE', thesis: 'Infosys: semiconductor IP design services (Infy\'s engineering services arm works with all major DRAM/HBM firms); CHIPS Act wave = design-services order growth' },
      { ticker: 'WIPRO', exchange: 'NSE', thesis: 'Wipro: VLSI/embedded design services, PCB layout for AI/HPC systems — memory module design and integration services' },
      { ticker: 'CYIENT', exchange: 'NSE', thesis: 'Cyient: embedded semiconductor design services, test automation scripts for SoC/memory verification — indirect play on HBM design cycle' },
    ],
    chokepoints: [
      { ticker: 'MU',   name: 'Micron Technology', exchange: 'NASDAQ', tier: 4, public_competitors: 2, qual_stage: 'RAMP',   customers: ['NVDA','AMD','hyperscalers'], monopoly_basis: 'Only US-based HBM producer. HBM3E yield advantage in ramp. DRAM + HBM dual revenue.', evidence_types: ['earnings','sec_filing','news_article'] },
      { ticker: 'AEHR', name: 'Aehr Test Systems',  exchange: 'NASDAQ', tier: 8, public_competitors: 1, qual_stage: 'RAMP',   customers: ['SK Hynix','Micron','TSMC'], monopoly_basis: 'Only public company offering wafer-level burn-in for HBM and SiC. Zero near-term substitutes.', evidence_types: ['earnings','ir_page','conference_pdf'] },
    ],
    coverage: {
      confirmed_public: ['MU','AEHR','SKX (SK Hynix ADR)','Samsung (005930.KS)'],
      known_private: ['Lam Research test div (acquired)', 'Advantest (private HBM test)'],
      likely_missing: ['NANYA Technology (TWO:2408) — independent DRAM, underfollowed Taiwan OTC', 'Winbond Electronics (TWO:2344) — specialty DRAM'],
      uncovered_nodes: ['HBM substrate suppliers (Ibiden, Shinko — packaging nodes)', 'Test socket suppliers for HBM burn-in (Yamaichi, Wells Electronics — private)'],
    },
    evidence_types: ['earnings','sec_filing','conference_pdf','news_article'],
    theme_family: 'MEMORY_COMPUTE',
  },
  INTERCONNECT_PHOTONICS: {
    label: 'Interconnect & Photonics', icon: '💡', lifecycle: 'structural',
    why: 'Copper hits bandwidth walls at 224 Gbps SerDes. Co-packaged optics (CPO) and silicon photonics are the only path to 1.6T/3.2T fabrics for future AI factories.',
    supply: 'CPO supply chain immature: lasers, modulators, couplers bottlenecked at handful of vendors. TSMC/Intel photonics integration still ramping.',
    demand: 'Every rack-scale AI system (NVL72, Trainium3) needs 10–100× more optical transceivers than prior generations. Hyperscaler buys locked through 2027.',
    winners: [{ ticker: 'COHR', thesis: 'Coherent: datacenter transceivers, VCSEL supply' }, { ticker: 'MRVL', thesis: 'Marvell: 800G/1.6T DSPs, custom silicon' }, { ticker: 'AAOI', thesis: 'AAOI: 800G single-mode transceivers ramping' }],
    losers: [],
    confirms: ['800G/1.6T transceiver order announcements from hyperscalers', 'CPO product wins at AMD/NVDA rack-scale systems', 'SIVE lasers named in GlobalFoundries or Intel photonics roadmap PDFs', 'COHR/LITE revenue guidance raised citing datacenter optics'],
    breaks: ['Electrical interconnect (UALink/CXL) solves bandwidth problem without optics', 'NVDA pivots to on-chip optical integration eliminating transceiver need', 'Multiple new laser suppliers qualify at major CPO customer'],
    contradictions: ['COHR datacenter revenue declines despite market claims', 'Hyperscaler infrastructure architects publicly endorse copper for rack-scale instead of optical', 'CPO standard fragmentation delays adoption past 2027'],
    watch_kpi: ['800G transceiver lead times (should be >16 weeks)', 'COHR datacenter % of revenue', 'GFS photonics roadmap PDF updates (track via Wayback Machine)', 'MRVL custom silicon revenue guidance'],
    causal_chain: ['HBM bandwidth ceiling → copper I/O insufficient → co-packaged optics demand → InP/GaAs laser supply constraint → substrate supply (AXTI) bottleneck → photonic IC fab demand (TSMC photonics)'],
    india_plays: [
      { ticker: 'STERLITE', exchange: 'NSE', thesis: 'Sterlite Technologies: optical fiber cables, domestic data center buildout beneficiary' },
      { ticker: 'HFCL', exchange: 'NSE', thesis: 'HFCL: fiber optic cables + defense networking equipment, order book driven' },
    ],
    chokepoints: [
      { ticker: 'AXTI', name: 'AXT Inc', exchange: 'NASDAQ', tier: 1, public_competitors: 2, qual_stage: 'VOLUME', customers: ['COHR','LITE','Sumitomo Electric'], monopoly_basis: '"Strait of AXTI": controls premium InP/GaAs substrate supply. Switching cost = 12–18 month re-qual. ~$80M market cap vs multi-billion downstream.', evidence_types: ['earnings','sec_filing','conference_pdf','wayback'] },
      { ticker: 'SIVE', name: 'Sivers Semiconductors', exchange: 'STO', tier: 6, public_competitors: 2, qual_stage: 'DESIGN_WIN', customers: ['Ayar Labs','GlobalFoundries','Intel Photonics'], monopoly_basis: 'Only listed pure-play InP laser supplier for CPO. $850M Swedish company with zero US analyst coverage. Multi-year qualification lock-in.', evidence_types: ['ir_page','conference_pdf','wayback'] },
      { ticker: 'TSEM', name: 'Tower Semiconductor', exchange: 'NASDAQ', tier: 4, public_competitors: 3, qual_stage: 'QUALIFICATION', customers: ['MRVL','Broadcom','Apple'], monopoly_basis: 'One of only 2 public photonic foundries. Acquired by Intel deal collapsed, now independent — unique SiPh process.', evidence_types: ['earnings','sec_filing'] },
      { ticker: 'COHR', name: 'Coherent Corp', exchange: 'NYSE', tier: 6, public_competitors: 3, qual_stage: 'VOLUME', customers: ['hyperscalers','JBL'], monopoly_basis: 'Largest datacenter transceiver/VCSEL supplier. 800G market leader. CPO qualification at multiple hyperscalers.', evidence_types: ['earnings','conference_pdf'] },
    ],
    coverage: {
      confirmed_public: ['AXTI','SIVE','TSEM','COHR','LITE','AAOI','MRVL'],
      known_private: ['Ayar Labs (CPO — Series C, not listed)','Celestial AI (optical compute — private)','Lightmatter (photonic interconnect — private)'],
      likely_missing: ['WIN Semiconductors (3105.TWO) — compound semi foundry, Taiwan OTC', 'Advanced Wireless Semiconductor (AWSC.TWO) — GaAs/InP wafer manufacturer, underfollowed'],
      uncovered_nodes: ['Electro-optic modulator suppliers (few listed)','Wavelength division multiplexing component suppliers','AR coating suppliers for optical facets'],
    },
    evidence_types: ['earnings','sec_filing','conference_pdf','ir_page','wayback'],
    theme_family: 'PHOTONICS_COMPUTE',
  },
  FABRICATION_PACKAGING: {
    label: 'Advanced Fabrication & Packaging', icon: '🏭', lifecycle: 'structural',
    why: 'CoWoS advanced packaging at TSMC is the single-point bottleneck for every leading-edge AI accelerator. Capacity doubles every 18 months but demand outpaces it.',
    supply: 'TSMC CoWoS-L/S: ~35K wpm 2024, ~70K wpm targeted 2026. Intel Foveros and Samsung I-Cube sub-scale. ASML High-NA EUV gating N2/A16 ramp.',
    demand: 'Nvidia alone consumes 60%+ of CoWoS. AMD MI300/MI350, AWS Trainium, Google TPU all share remaining. Demand 80%+ YoY.',
    winners: [{ ticker: 'TSM', thesis: 'TSMC: monopoly advanced packaging, CoWoS pricing power' }, { ticker: 'ASML', thesis: 'ASML: sole EUV/High-NA supplier, 2-year backlog' }, { ticker: 'AMAT', thesis: 'Applied Materials: advanced packaging tools' }],
    losers: [{ ticker: 'INTC', thesis: 'Intel Foundry behind on advanced packaging' }],
    confirms: ['TSMC CoWoS price increase or capacity allocation announcement', 'ASML order backlog growing / delivery slots pushed out', 'NVDA B200 yield improvement news (CoWoS driven)', 'New CoWoS customer announced (AMD, AWS, Google, Meta)'],
    breaks: ['Fan-out panel level packaging (FOPLP) scales and bypasses CoWoS', 'Samsung I-Cube or Intel Foveros qualifies at NVDA', 'TSMC CoWoS capacity doubles ahead of schedule'],
    contradictions: ['TSMC announces 3× CoWoS expansion ahead of schedule with no price increase', 'NVDA discloses GPU yield rates are constrained by design not packaging', 'Multiple hyperscalers disclose GPU inventory overbuild (not shortage)'],
    watch_kpi: ['TSMC CoWoS utilization rate (should be >95%)', 'ASML book-to-bill ratio', 'NVDA gross margin on H/B series (packaging cost impact)', 'Advanced packaging capex announcements from OSAT players'],
    causal_chain: ['CoWoS shortage → AI server deployment constraint → GPU allocation rationing → HBM bandwidth demand pull → optical I/O demand → power/cooling infrastructure demand → grid interconnect queue growth'],
    india_plays: [
      { ticker: 'INFY', exchange: 'NSE', thesis: 'Infosys: chip design services, VLSI/EDA talent pool serving fabless semiconductor customers' },
      { ticker: 'HCLTECH', exchange: 'NSE', thesis: 'HCL Tech: semiconductor engineering services, packaging design for OSAT customers' },
      { ticker: 'SASKEN', exchange: 'NSE', thesis: 'Sasken Technologies: embedded and semiconductor design services, niche exposure' },
    ],
    chokepoints: [
      { ticker: 'TSM',  name: 'TSMC',            exchange: 'NYSE',   tier: 4, public_competitors: 2, qual_stage: 'VOLUME' as const, customers: ['NVDA','AMD','AVGO','Apple'], monopoly_basis: 'Sole CoWoS at scale. NVDA 60%+. No credible alternative at needed capacity.', evidence_types: ['earnings','sec_filing','conference_pdf'] as EvidenceType[] },
      { ticker: 'ASML', name: 'ASML',             exchange: 'NASDAQ', tier: 3, public_competitors: 0, qual_stage: 'VOLUME' as const, customers: ['TSMC','Samsung','Intel'], monopoly_basis: 'Absolute monopoly on EUV lithography. Zero competitors. 2yr+ backlog. $300B+ TAM.', evidence_types: ['earnings','sec_filing','ir_page'] as EvidenceType[] },
      { ticker: 'AMKR', name: 'Amkor Technology', exchange: 'NASDAQ', tier: 9, public_competitors: 3, qual_stage: 'RAMP' as const,   customers: ['NVDA','QCOM','TI'], monopoly_basis: 'Largest US-listed OSAT. Advanced packaging for AI chips ramping.', evidence_types: ['earnings','sec_filing'] as EvidenceType[] },
    ],
    coverage: {
      confirmed_public: ['ASML','AMAT','LRCX','KLAC','TSM','AMKR','ASX','SPIL'],
      known_private: ['Ibiden (substrate)','Shinko Electric (substrate)'],
      likely_missing: ['KOKUSAI ELECTRIC (6525.T) — vertical furnace Japan', 'ULVAC (6728.T) — deposition Japan', 'Photronics (PLAB) — photomasks small-cap'],
      uncovered_nodes: ['EUV resist suppliers (JSR, Shin-Etsu)','Pellicle film (Mitsui Chemicals)','Zeon Corp (EUV photoresist precursor)'],
    },
    evidence_types: ['earnings','sec_filing','conference_pdf','wayback','ir_page'] as EvidenceType[],
    theme_family: 'FABRICATION_STACK',
  },
  COMPUTE_SCALING: {
    label: 'Compute & GPU Allocation', icon: '⚡', lifecycle: 'cyclical',
    why: 'GPU supply remains rationed by Nvidia. H100/H200 allocation relationship-driven. Blackwell ramp gated by CoWoS. Tier-2 clouds and enterprises wait 6–12 months.',
    supply: 'Nvidia ships what TSMC packages. MI300X/MI325X the only meaningful alternative; TPU/Trainium captive to respective hyperscalers.',
    demand: 'Hyperscaler AI capex ~$300B/yr, projected $450B+ 2026. Sovereign AI funds, neoclouds, enterprise inference all competing for allocation.',
    winners: [{ ticker: 'NVDA', thesis: 'Nvidia: allocation monopoly, 75%+ gross margin' }, { ticker: 'AMD', thesis: 'AMD: MI series captures tier-2 demand' }, { ticker: 'AVGO', thesis: 'Broadcom: custom ASIC (TPU, MTIA)' }],
    losers: [{ ticker: 'CRWV', thesis: 'Neoclouds dependent on NVDA allocation' }],
    confirms: ['Hyperscaler capex guidance raised (MSFT/META/AMZN/GOOG)', 'NVDA data center revenue beats + guides higher', 'AMD MI300X customer wins at tier-2 clouds', 'Sovereign AI deals announced (UAE, India, Japan)'],
    breaks: ['Open-source model breakthrough cuts compute requirements by 10×', 'US export restrictions tightened on Nvidia H/B series', 'Hyperscaler capex guidance cut materially'],
    contradictions: ['DeepSeek/Qwen-class efficiency leap reduces per-query compute need by >5×', 'Multiple hyperscalers publicly disclose GPU overbuild in earnings calls', 'AMD MI series captures >30% of hyperscaler AI workloads'],
    watch_kpi: ['NVDA data center revenue quarterly trajectory', 'Hyperscaler AI capex guidance in earnings calls', 'AMD MI series customer count', 'GPU spot market pricing on AWS/Azure'],
    causal_chain: ['Hyperscaler capex ↑ → GPU allocation rationed → CoWoS packaging bottleneck → HBM demand → memory supply constraint → AI inference scaling → power grid demand growth'],
    india_plays: [
      { ticker: 'TATAELXSI', exchange: 'NSE', thesis: 'Tata Elxsi: AI/ML engineering services, GPU cluster management, growing data center exposure' },
      { ticker: 'LTTS', exchange: 'NSE', thesis: 'L&T Technology Services: semiconductor design and embedded AI, adjacently benefits from GPU ecosystem' },
      { ticker: 'RAILTEL', exchange: 'NSE', thesis: 'RailTel: government data center infra, early-stage but sovereign AI compute beneficiary' },
    ],
    chokepoints: [
      { ticker: 'NVDA', name: 'NVIDIA',  exchange: 'NASDAQ', tier: 5, public_competitors: 1, qual_stage: 'VOLUME', customers: ['all hyperscalers','neoclouds','sovereigns'], monopoly_basis: '75%+ AI accelerator market. CUDA ecosystem lock-in = 5-7 year moat. H100/B200 allocation relationship-driven. Already fully priced.', evidence_types: ['earnings','sec_filing','conference_pdf'] },
      { ticker: 'AVGO', name: 'Broadcom', exchange: 'NASDAQ', tier: 5, public_competitors: 2, qual_stage: 'RAMP',   customers: ['Google TPU','Meta MTIA','ByteDance'], monopoly_basis: 'Dominant custom ASIC designer for hyperscalers. XPU revenue growing >50% YoY. Multi-year NDAs with 3 hyperscalers.', evidence_types: ['earnings','sec_filing'] },
    ],
    coverage: {
      confirmed_public: ['NVDA','AMD','AVGO','MRVL','INTC'],
      known_private: ['Tenstorrent (Groq-competitor, Hyundai-backed)','d-Matrix (inference accelerator)','Etched (custom wafer ASIC)'],
      likely_missing: ['Blaize (edge AI chips, SPAC candidate)', 'SambaNova (custom DRAM accelerator, private)', 'Cerebras (wafer-scale, pre-IPO)'],
      uncovered_nodes: ['Network-attached accelerator controllers','AI pipeline orchestration chips','Inference-specific memory controllers'],
    },
    evidence_types: ['earnings','sec_filing','conference_pdf','news_article'],
    theme_family: 'MEMORY_COMPUTE',
  },
  POWER_GRID: {
    label: 'Power & Grid Constraints', icon: '🔌', lifecycle: 'structural',
    why: 'Data center power demand outpaces grid interconnect timelines by 3–7 years. Transformer, switchgear, and HV cable lead times are 80–130 weeks.',
    supply: 'Only 3 major transformer OEMs globally. Grain-oriented electrical steel (GOES) constrained. Utility interconnect queues span 5–10 years in PJM/ERCOT.',
    demand: 'AI data center nameplate demand: 50 GW US by 2030 (Goldman, EPRI). Hyperscaler site selection now power-first.',
    winners: [{ ticker: 'GEV', thesis: 'GE Vernova: grid equipment, transformers' }, { ticker: 'ETN', thesis: 'Eaton: switchgear, UPS, electrical backbone' }, { ticker: 'VRT', thesis: 'Vertiv: power/cooling for data centers' }],
    losers: [],
    confirms: ['Transformer lead times quoted >100 weeks by GEV/ABB/Siemens', 'Hyperscaler data center site cancellations citing power availability', 'PJM/ERCOT interconnect queue backlogs disclosed in utility filings', 'GEV/ETN order backlog growing, pricing increasing'],
    breaks: ['Nuclear SMRs deploy on-site at hyperscalers at scale by 2027', 'Grid modernization bill passes with massive transformer subsidies', 'AI inference efficiency reduces per-GPU power consumption >50%'],
    contradictions: ['GEV/Siemens disclose transformer order cancellations or backlog normalization', 'Multiple new transformer manufacturing plants announced in North America simultaneously', 'Hyperscalers publish evidence that they solved interconnect queue through co-location'],
    watch_kpi: ['GEV order backlog (should keep growing)', 'ETN data center-specific revenue segment', 'PJM/ERCOT interconnect queue length (public)', 'Large power transformer lead time surveys from industry publications'],
    causal_chain: ['AI compute ↑ → data center MW demand → grid interconnect queue (5-10yr) → transformer/switchgear shortage → GOES steel constraint → copper/HV cable demand → EPC construction bottleneck → nuclear/renewable PPA demand'],
    chokepoints: [
      { ticker: 'GEV', name: 'GE Vernova', exchange: 'NYSE', tier: 6, public_competitors: 3, qual_stage: 'VOLUME', customers: ['utilities','data center developers','transmission operators'], monopoly_basis: 'One of only 3 major transformer OEMs globally (GEV, Siemens, ABB). 80–130 week lead times. US-listed. Grid electrification pure-play.', evidence_types: ['earnings','ir_page','conference_pdf'] },
      { ticker: 'ETN', name: 'Eaton Corp',  exchange: 'NYSE', tier: 6, public_competitors: 4, qual_stage: 'VOLUME', customers: ['hyperscalers','data centers','utilities'], monopoly_basis: 'Switchgear + UPS market leader. Data center-specific electrical backbone. Order backlog growing 2+ years.', evidence_types: ['earnings','sec_filing'] },
      { ticker: 'VRT', name: 'Vertiv',      exchange: 'NYSE', tier: 6, public_competitors: 4, qual_stage: 'RAMP',   customers: ['META','MSFT','AMZN','GOOG'], monopoly_basis: 'Power + cooling dual-exposure. Hyperscaler DC infrastructure partner. Liquid cooling ramp = incremental TAM.', evidence_types: ['earnings','ir_page','conference_pdf'] },
    ],
    coverage: {
      confirmed_public: ['GEV','ETN','VRT','HUBB','GE','ABB (ABB.N)','Siemens Energy (ENR.DE)'],
      known_private: ['CG Power (India, now listed but small)', 'TBEA Co. (China, constrained)', 'Weidmann (transformer components, Swiss private)'],
      likely_missing: ['SPX Technologies — power transformer niche (listed but small-cap)', 'Global Power Equipment Group — transformer repair/replacement', 'Preformed Line Products (PLP) — grid hardware'],
      uncovered_nodes: ['GOES steel suppliers (AK Steel/Cleveland-Cliffs — adjacent exposure)','HV cable suppliers (Prysmian, Nexans — European listed)', 'Substation automation software'],
    },
    evidence_types: ['earnings','sec_filing','conference_pdf','news_article'],
    theme_family: 'POWER_GRID_FAMILY',
    india_plays: [
      { ticker: 'BHEL', exchange: 'NSE', thesis: 'BHEL: power transformer OEM, domestic order book accelerating with data center/industrial power demand' },
      { ticker: 'POWERGRID', exchange: 'NSE', thesis: 'POWERGRID Corporation: national transmission infra build-out, AI data center connectivity beneficiary' },
      { ticker: 'KPTL', exchange: 'NSE', thesis: 'Kalpataru Projects (KPTL): EPC for high-voltage transmission lines and substations' },
      { ticker: 'SIEMENS', exchange: 'NSE', thesis: 'Siemens India: switchgear, transformers, grid automation — direct supply chain play' },
      { ticker: 'ABB', exchange: 'NSE', thesis: 'ABB India: grid electrification, HV transformers, industrial automation' },
      { ticker: 'TRIL', exchange: 'NSE', thesis: 'Transformers & Rectifiers India (TRIL): specialty transformer OEM, order book multi-year visibility' },
      { ticker: 'AMBER', exchange: 'NSE', thesis: 'Amber Enterprises: power electronics, transformer assemblies, data center UPS systems' },
      { ticker: 'TDPOWERSYS', exchange: 'NSE', thesis: 'TD Power Systems: alternators and generators — diesel genset demand surge for data center backup power' },
      { ticker: 'KEC', exchange: 'NSE', thesis: 'KEC International: high-voltage transmission EPC, 40%+ revenue from T&D — direct order flow beneficiary' },
      { ticker: 'APARINDS', exchange: 'NSE', thesis: 'APAR Industries: conductors, cables, transformer oil — three direct product categories in demand' },
      { ticker: 'GPIL', exchange: 'NSE', thesis: 'Godawari Power: grain-oriented electrical steel (GOES) — magnetic steel for transformer cores, India market leader' },
    ],
  },
  NUCLEAR_ENERGY: {
    label: 'Nuclear Energy', icon: '☢️', lifecycle: 'structural' as const,
    why: 'Hyperscalers pivoting to nuclear PPAs for 24/7 carbon-free baseload. SMRs and restart of retired plants are the only GW-scale path this decade.',
    supply: 'Enriched uranium supply constrained post-Russia sanctions. Centrus and Urenco ramping HALEU slowly. SMR deployments 2028–2032.',
    demand: 'MSFT/Three Mile Island, AMZN/Talen, GOOG/Kairos, META SMR RFP — every hyperscaler has inked nuclear deals.',
    winners: [{ ticker: 'CCJ', thesis: 'Cameco: uranium mining leader' }, { ticker: 'LEU', thesis: 'Centrus: HALEU enrichment monopoly' }, { ticker: 'CEG', thesis: 'Constellation: Three Mile Island restart, MSFT PPA' }],
    losers: [],
    confirms: ['New hyperscaler nuclear PPA announcement', 'NRC license approval for SMR design', 'HALEU enrichment capacity expansion announcement', 'Uranium spot price above $100/lb'],
    breaks: ['Next-gen solar + battery storage achieves <$20/MWh 24/7 cost', 'NRC license denials for multiple SMR projects', 'US-Russia nuclear fuel deal reinstated at scale'],
    contradictions: ['Uranium spot price falls below $70/lb on new supply discovery', 'NRC approves only 1 of 5 pending SMR designs by 2028', 'Hyperscalers cancel nuclear PPAs in favour of cheaper renewables'],
    watch_kpi: ['Uranium spot price (cameco.com/investors)', 'NRC SMR licensing pipeline', 'Hyperscaler % of power from carbon-free sources', 'CEG/TLN nuclear generation capacity utilization'],
    chokepoints: [
      { ticker: 'LEU', name: 'Centrus Energy',     exchange: 'NYSE',   tier: 1, public_competitors: 1, qual_stage: 'RAMP',   customers: ['DOE','hyperscalers (indirect)'], monopoly_basis: 'ONLY US company licensed to produce HALEU (high-assay low-enriched uranium) for advanced SMR reactors. Urenco is sole competitor.', evidence_types: ['sec_filing','ir_page','news_article'] },
      { ticker: 'CCJ', name: 'Cameco',              exchange: 'NYSE',   tier: 1, public_competitors: 3, qual_stage: 'VOLUME', customers: ['utilities'], monopoly_basis: 'Largest Western uranium producer. Nuclear PPA deal wave needs uranium supply.', evidence_types: ['earnings','sec_filing'] },
      { ticker: 'CEG', name: 'Constellation Energy', exchange: 'NASDAQ', tier: 6, public_competitors: 4, qual_stage: 'VOLUME', customers: ['MSFT (TMI PPA)','hyperscalers'], monopoly_basis: 'Largest US nuclear operator. Three Mile Island restart first hyperscaler nuclear PPA executed. 24/7 carbon-free power supplier.', evidence_types: ['earnings','news_article','ir_page'] },
    ],
    coverage: {
      confirmed_public: ['LEU','CCJ','CEG','Oklo (OKLO)','NuScale (SMR)'],
      known_private: ['TerraPower (Gates-backed)','Kairos Power (Google PPA)','Commonwealth Fusion (MIT spinout)'],
      likely_missing: ['Lightbridge (fuel technology, micro-cap)','BWX Technologies (nuclear components) — listed but under-covered'],
      uncovered_nodes: ['Zirconium cladding suppliers (very few globally)','SMR pressure vessel manufacturers','HALEU transportation logistics'],
    },
    evidence_types: ['sec_filing','ir_page','conference_pdf','news_article'],
    theme_family: 'POWER_GRID_FAMILY',
    causal_chain: ['AI compute ↑ → 24/7 carbon-free power demand → nuclear PPA race → uranium/HALEU supply constraint → enrichment capacity → SMR permitting timeline → construction materials/labor'],
    india_plays: [
      { ticker: 'NHPC', exchange: 'NSE', thesis: 'NHPC: hydropower — adjacent carbon-free baseload; government target of 500 GW by 2030 benefits NHPC directly' },
      { ticker: 'TATAPOWER', exchange: 'NSE', thesis: 'Tata Power: renewable + thermal; India nuclear adjacency via ₹4.4L Cr nuclear expansion announced by government' },
      { ticker: 'NTPC', exchange: 'NSE', thesis: 'NTPC: India\'s largest power generator, nuclear JV NPCIL partner — government nuclear build-out beneficiary' },
      { ticker: 'BHARATFORGE', exchange: 'NSE', thesis: 'Bharat Forge: large forgings for nuclear reactor pressure vessels and turbine components — specialised manufacturing' },
      { ticker: 'LT', exchange: 'NSE', thesis: 'Larsen & Toubro (LT): primary EPC for nuclear power plants in India — KKNPP, Gorakhpur, and new sites' },
      { ticker: 'WALCHAND', exchange: 'NSE', thesis: 'Walchandnagar Industries: heavy engineering equipment for nuclear, defence, aerospace — captive supplier to NPCIL' },
    ],
  },
  THERMAL_COOLING: {
    label: 'Thermal & Cooling', icon: '❄️', lifecycle: 'cyclical',
    why: 'Blackwell and beyond require direct-to-chip liquid cooling. Retrofit impractical; new builds 100% liquid-cooled. CDU and cold-plate supply sold out.',
    supply: 'CoolIT, Motivair, Boyd, Asetek are the main CDU vendors. Cold plate supply concentrated in Taiwan.',
    demand: 'NVL72 racks = 120+ kW/rack. Every new AI data center must deploy liquid cooling.',
    winners: [{ ticker: 'VRT', thesis: 'Vertiv: liquid cooling + power thermal management' }, { ticker: 'SMCI', thesis: 'Supermicro: liquid-cooled rack integration' }],
    losers: [],
    confirms: ['VRT liquid cooling revenue growing >50% YoY', 'New hyperscaler DC build announcement specifying 100% liquid cooling', 'CDU/cold plate lead times >20 weeks', 'SMCI liquid-cooled rack backlog mentioned in earnings'],
    breaks: ['Immersion cooling becomes dominant (different supply chain)', 'NVDA next chip reduces power consumption below air-cooling threshold', 'New CDU suppliers entering at scale in Taiwan/Korea'],
    contradictions: ['VRT liquid cooling margins decline due to rapid new entrant price competition', 'GPU thermal profiles plateau vs prior generation (no increase in kW/rack)', 'Hyperscalers standardize on one immersion cooling vendor bypassing CDU'],
    watch_kpi: ['VRT liquid cooling % of revenue', 'SMCI liquid cooling attach rate per rack', 'kW/rack specification in new DC construction permits', 'CoolIT/Boyd private company capacity news'],
    causal_chain: ['GPU TDP ↑ (Blackwell 1000W+ per chip) → air cooling insufficient → liquid CDU/cold-plate required → Taiwan cold plate supply concentrated → Taiwan/Korea CDU manufacturers bottlenecked → facility retrofit capital demand'],
    india_plays: [
      { ticker: 'APCOTEX', exchange: 'NSE', thesis: 'Apcotex Industries: thermal management chemicals, adjacent to cooling compound demand' },
      { ticker: 'THERMAX', exchange: 'NSE', thesis: 'Thermax: industrial cooling and heat exchange equipment, data center cooling adjacency' },
    ],
    chokepoints: [
      { ticker: 'VRT',  name: 'Vertiv',      exchange: 'NYSE',   tier: 6, public_competitors: 4, qual_stage: 'RAMP',   customers: ['all hyperscalers'], monopoly_basis: 'Dominant liquid cooling + power management for hyperscale DCs. Liquid cooling revenue 3× in 2024.', evidence_types: ['earnings','conference_pdf','ir_page'] },
      { ticker: 'SMCI', name: 'Supermicro',   exchange: 'NASDAQ', tier: 7, public_competitors: 5, qual_stage: 'RAMP',   customers: ['hyperscalers','neoclouds'], monopoly_basis: 'Liquid-cooled rack integration leader. Modular DC + liquid cooling = direct pick for Blackwell rack density.', evidence_types: ['earnings','sec_filing'] },
    ],
    coverage: {
      confirmed_public: ['VRT','SMCI'],
      known_private: ['CoolIT Systems','Motivair','Boyd Technologies','Asetek (listed in Denmark ASETEK.CO)'],
      likely_missing: ['Rittal (private German enclosure+cooling)','Stulz (precision cooling, private)','Airedale (UK, private)'],
      uncovered_nodes: ['Cold plate manufacturers (mostly Taiwan private)','Cooling tower suppliers for large DCs','Thermal interface material suppliers (Dow, Henkel — conglomerate, diluted exposure)'],
    },
    evidence_types: ['earnings','conference_pdf','news_article'],
    theme_family: 'POWER_GRID_FAMILY',
  },
  MATERIALS_SUPPLY: {
    label: 'Critical Materials', icon: '⛏️', lifecycle: 'structural',
    why: 'Gallium, germanium, neon, rare earths, and high-purity quartz gating semi and defense supply chains. China export controls accelerating bifurcation.',
    supply: 'China controls 80%+ of gallium/germanium processing, 90%+ of rare earth refining. Alternative supply 3–7 years out.',
    demand: 'AI, defense, EV, and renewable electrification all drawing from same materials stack. Demand 2–3× by 2030.',
    winners: [{ ticker: 'MP', thesis: 'MP Materials: US rare earth independence' }, { ticker: 'AXTI', thesis: 'AXT Inc: InP/GaAs substrates — "Strait of AXTI"' }],
    losers: [],
    confirms: ['China tightens gallium/germanium export quotas', 'AXTI named in new hyperscaler photonics roadmap', 'DoD awards critical minerals contract to US domestic producer', 'Spot price for gallium/germanium rising >20% QoQ'],
    breaks: ['Recycling technology recovers >50% of critical materials from e-waste', 'Major new gallium deposits developed outside China at scale', 'Compound semiconductors replaced by silicon-only alternatives in photonics'],
    contradictions: ['China lifts export controls on gallium/germanium as part of trade deal', 'Australia/Canada brings new rare earth processing online faster than 2027', 'Silicon photonics (no compound semiconductors) achieves performance parity'],
    watch_kpi: ['Gallium spot price (should be rising)', 'China MOFCOM export quota announcements', 'AXTI quarterly substrate shipment volume', 'MP Materials NdFeB magnet production ramp'],
    causal_chain: ['China export controls → gallium/germanium/rare earth shortage → compound semiconductor supply chain risk → photonics/defense electronics constraint → geopolitical bifurcation → US/allied domestic supply build-out investment'],
    india_plays: [
      { ticker: 'HINDALCO', exchange: 'NSE', thesis: 'Hindalco: aluminum and critical metal refining, adjacently benefits from materials supply chain reshoring' },
      { ticker: 'VEDL', exchange: 'NSE', thesis: 'Vedanta: zinc, copper, aluminum, oil — critical materials diversification play' },
      { ticker: 'NMDC', exchange: 'NSE', thesis: 'NMDC: iron ore + nascent critical minerals exploration, government-backed domestic supply' },
    ],
    chokepoints: [
      { ticker: 'AXTI', name: 'AXT Inc',      exchange: 'NASDAQ', tier: 1, public_competitors: 2, qual_stage: 'VOLUME', customers: ['COHR','LITE','Broadcom'], monopoly_basis: '"Strait of AXTI": premium InP/GaAs substrate. Wafer Works (Taiwan) and Sumitomo are competitors but AXTI has US presence + photonics specialization.', evidence_types: ['earnings','sec_filing','conference_pdf','wayback'] },
      { ticker: 'MP',   name: 'MP Materials', exchange: 'NYSE',   tier: 1, public_competitors: 2, qual_stage: 'RAMP',   customers: ['GM','Stellantis','US DoD'], monopoly_basis: 'Only US-listed rare earth mining + processing company at scale. Mountain Pass mine. NdFeB magnets for EV/defense.', evidence_types: ['earnings','sec_filing','ir_page'] },
      { ticker: 'CCJ',  name: 'Cameco',        exchange: 'NYSE',   tier: 1, public_competitors: 3, qual_stage: 'VOLUME', customers: ['utilities','nuclear power plants'], monopoly_basis: 'Largest Western uranium producer. Post-Kazatomprom sanction concerns, Cameco + Kazatomprom duopoly. HALEU demand emerging.', evidence_types: ['earnings','sec_filing'] },
    ],
    coverage: {
      confirmed_public: ['AXTI','MP','CCJ','LEU','SilcoTek (private)'],
      known_private: ['5N Plus (Canada, specialty semi materials)','REC Silicon (Norway)','Wacker Chemie (Germany — hyperpure silicon)'],
      likely_missing: ['Vital Metals (Australia — rare earth, small)','NioCorp Developments (niobium/scandium, pre-production)','American Rare Earths (private)'],
      uncovered_nodes: ['Neon gas suppliers (Ingas, Cryoin — Ukrainian private companies)','Specialty chemical suppliers for photoresist (JSR, Shin-Etsu)','Quartz crucible suppliers (very few, mostly private Japan)'],
    },
    evidence_types: ['earnings','sec_filing','conference_pdf','news_article','startup_deck'],
    theme_family: 'MATERIALS_GEOPOLITICS',
  },
  QUANTUM_CRYOGENICS: {
    label: 'Quantum & Cryogenics', icon: '🧊', lifecycle: 'structural',
    why: 'Quantum hardware gated by dilution refrigerators, helium-3, and cryo electronics. Scale-up of logical qubits is the decade-long bottleneck.',
    supply: 'Bluefors, Oxford Instruments dominate dilution fridges. Helium-3 supply constrained by tritium decay chain.',
    demand: 'Sovereign quantum programs (US DOE, EU, China, India) + hyperscaler R&D (IBM, Google, MSFT, AMZN). Demand inelastic.',
    winners: [{ ticker: 'IBM', thesis: 'IBM: largest gate-based quantum fleet' }, { ticker: 'IONQ', thesis: 'IonQ: trapped-ion roadmap' }],
    losers: [],
    confirms: ['IBM logical qubit count doubles on schedule', 'DOE/NSF quantum computing contract awards growing', 'Bluefors dilution fridge lead times >12 months', 'New national quantum initiative funding announcement'],
    breaks: ['Classical computing solves target problems before quantum does', 'Room-temperature qubit technology validated at scale', 'He-3 alternative cryogenic technology works below 20mK'],
    contradictions: ['IonQ/Rigetti customer revenue stagnates for 2+ consecutive quarters', 'IBM delays error correction milestone by >2 years', 'Photonic quantum approach (no He-3 needed) achieves logical qubit parity'],
    watch_kpi: ['IBM quantum volume trajectory', 'IonQ / Rigetti customer count and revenue', 'Helium-3 spot price', 'Government quantum initiative budget lines'],
    causal_chain: ['Logical qubit demand → dilution refrigerator supply constraint → Bluefors/Oxford bottleneck → He-3 supply constraint → cryo electronics (SFQ/cryo CMOS) bottleneck → specialized materials demand'],
    india_plays: [
      { ticker: 'TATAELXSI', exchange: 'NSE', thesis: 'Tata Elxsi: adjacent play via quantum algorithm design services and government programs' },
    ],
    chokepoints: [
      { ticker: 'IBM',  name: 'IBM',    exchange: 'NYSE',   tier: 5, public_competitors: 4, qual_stage: 'VOLUME', customers: ['DOE','government','enterprises'], monopoly_basis: 'Largest gate-based quantum fleet. Only company with >1,000 qubit system in production.', evidence_types: ['earnings','sec_filing','conference_pdf'] },
      { ticker: 'IONQ', name: 'IonQ',   exchange: 'NYSE',   tier: 5, public_competitors: 3, qual_stage: 'RAMP',   customers: ['DOE','DOD','financial services'], monopoly_basis: 'Trapped-ion approach — highest published gate fidelity. Only pure-play listed quantum hardware company.', evidence_types: ['earnings','sec_filing','ir_page'] },
    ],
    coverage: {
      confirmed_public: ['IBM','IONQ'],
      known_private: ['Bluefors (dilution fridges, Finland private)','Oxford Instruments (UK, listed OXIG.L)','Quantinuum (Honeywell spinout, private)', 'Rigetti (RGTI — listed, micro-cap)'],
      likely_missing: ['Q-Next (US DOE quantum network, private)','Diraq (Australia, private ion-trap)'],
      uncovered_nodes: ['Cryo CMOS chip suppliers','He-3 suppliers (US government stockpile + BWX)','Quantum error correction co-processors'],
    },
    evidence_types: ['earnings','sec_filing','conference_pdf','news_article'],
    theme_family: 'QUANTUM_COMPUTE',
  },
};
export const CONFERENCES: Conference[] = [
  { name: 'NVDA GTC',          date: 'Mar 2026', theme: 'AI Chips, CPO, Photonics',       relevance: 'Most important annual event — Jensen keynote moves supply chain stocks 20–50%', tags: ['PHOTONICS','COMPUTE','PACKAGING'], url: 'https://www.nvidia.com/gtc/' },
  { name: 'OFC',               date: 'Mar 2026', theme: 'Optical Fiber & Photonics',       relevance: 'Transceivers, silicon photonics, laser vendor roadmaps', tags: ['PHOTONICS','INTERCONNECT'], url: 'https://www.ofcconference.org/' },
  { name: 'SEMICON West',       date: 'Jul 2026', theme: 'Semiconductor Equipment',         relevance: 'Equipment maker plays — AMAT, KLAC, LRCX, ASML roadmaps', tags: ['EQUIPMENT','MATERIALS'], url: 'https://www.semiconwest.org/' },
  { name: 'Hot Chips',          date: 'Aug 2026', theme: 'AI Accelerators, Memory, Custom', relevance: 'Custom ASIC plays — AMD MI, Google TPU, AWS Trainium roadmaps', tags: ['COMPUTE','MEMORY'], url: 'https://hotchips.org/' },
  { name: 'TSMC OIP',           date: 'Oct 2026', theme: 'Advanced Packaging, Chiplets',   relevance: 'CoWoS, SoIC, substrate plays — packaging bottleneck visibility', tags: ['PACKAGING','FOUNDRY'], url: 'https://oipalliance.tsmc.com/' },
  { name: 'IEEE IEDM',          date: 'Dec 2026', theme: 'Advanced Nodes, Memory',          relevance: 'Materials and advanced transistor node roadmaps', tags: ['MATERIALS','MEMORY','FOUNDRY'], url: 'https://www.ieee.org/conferences/iedm' },
];
export const TAG_COLORS: Record<string, string> = {
  PHOTONICS: '#06B6D4', COMPUTE: '#10B981', MEMORY: '#8B5CF6',
  PACKAGING: '#F59E0B', EQUIPMENT: '#0F7ABF', MATERIALS: '#EF4444',
  INTERCONNECT: '#06B6D4', FOUNDRY: '#F59E0B',
};
// ── Supply chain tiers ────────────────────────────────────────────────────────

export const SUPPLY_CHAIN: { tier: number; label: string; color: string; companies: string[]; sub: string; lens?: string }[] = [
  { tier: 1,  label: 'Raw Materials',          color: '#8B5CF6', companies: ['AXTI','MP','CCJ','LEU'],           sub: 'InP/GaAs crystals, Ge, rare earths, uranium, specialty gases',           lens: 'Serenity lens: monopolistic supply, China bifurcation, <$2B market cap, zero Wall St coverage' },
  { tier: 2,  label: 'Substrates & Wafers',    color: '#7C3AED', companies: ['SOI (Soitec)','SUMCO','Shin-Etsu'], sub: 'Silicon-on-insulator, compound semiconductor substrates',                   lens: 'Serenity lens: 2–3 global suppliers, multi-year customer qual cycles, switching cost moat' },
  { tier: 3,  label: 'Wafer Fab Equipment',    color: '#0F7ABF', companies: ['ASML','AMAT','LRCX','KLAC'],       sub: 'EUV lithography, CVD/PVD, etch, deposition, inspection',                     lens: 'Serenity lens: ASML EUV monopoly, KLAC/LRCX inspection duopoly, 2yr+ lead times' },
  { tier: 4,  label: 'Foundries',              color: '#0284C7', companies: ['TSM','TSEM','Win Semi (3105)'],    sub: 'TSMC N3/N2 + CoWoS advanced packaging, Tower, Samsung',                      lens: 'Serenity lens: TSMC CoWoS = single-point bottleneck for every AI accelerator' },
  { tier: 5,  label: 'Chip Designers',         color: '#0369A1', companies: ['NVDA','AMD','AVGO','MRVL','INTC'], sub: 'GPU, ASIC, custom silicon, photonic ICs',                                     lens: 'Serenity lens: already fully priced — look upstream/downstream for asymmetric plays' },
  { tier: 6,  label: 'Photonic Components',    color: '#06B6D4', companies: ['COHR','LITE','AAOI','SIVE (STO)'],  sub: 'Lasers, EMLs, modulators, VCSELs — CPO supply chain',                       lens: 'Serenity lens: SIVE = $850M Swedish laser monopolist, Strait of AXTI substrate play' },
  { tier: 7,  label: 'Modules & Transceivers', color: '#0891B2', companies: ['FNSR','JNPR','OCLR','IIVI'],       sub: '400G/800G/1.6T optical transceiver modules, CPO integration',                lens: 'Serenity lens: 800G → 1.6T transition, OCLR/AAOI small-cap plays, hyperscaler lock-in' },
  { tier: 8,  label: 'Test & Inspection',      color: '#10B981', companies: ['AEHR','FORM','TER','Advantest'],    sub: 'Wafer-level burn-in, SiC power device test, HBM qualification test',         lens: 'Serenity lens: AEHR = only wafer-level burn-in for SiC/GaN, no substitute, <$1B cap' },
  { tier: 9,  label: 'Advanced Packaging',     color: '#059669', companies: ['AMKR','ASX','SPIL','IBIDEN'],       sub: 'CoWoS, HBM stacking, glass substrates, FOPLP — gating AI chip supply',      lens: 'Serenity lens: shares FABRICATION_PACKAGING bottleneck with T3 — CoWoS is THE single-point constraint' },
  { tier: 10, label: 'System Integration',     color: '#16A34A', companies: ['META','AMZN','MSFT','GOOGL'],       sub: 'Hyperscaler AI factories — NVL72, Trainium3, TPU v5 → demand signal',         lens: 'Serenity lens: demand side — every capex announcement here ripples upstream to T1–T6' },
];
