// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type UniverseStock } from './types';

// ── Serenity Checklist items ──────────────────────────────────────────────────

export const CHECKLIST_ITEMS = [
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

export const JUNK = new Set([
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
  'ACC','DM','FY','TETRA','RTX','SM','EV','BI','TSMC','NET','AES','JSW','EVM','TMC','EC','ASP','MCX','FTA','ST','II','KR','GCC','EMYN','HUL','GLP','YD','ESAF','LIV','JBS','ATF','RPG','NPP','NPU','WAVE','SIEGY',
  'ALL','ARE','HAL','BEL','CAN','HAS','HAD','WAS','GET','GOT','SET','PUT','BID','ASK',
  'FFO','NMI','BOE','HUL','SSD','USD','EUR','KR','GLP','UP','FOMC',
  // Added: news noise and non-supply-chain acronyms
  'CNBC','BFSI','RISC','UDGAM','ADB','PPA','CPPA','REIT','ECAD','DA','IC','SC','NA','WD','PC',
  'OASYS','ENGIE','EDPR','CIP','PAT','UBS','OLED','MARA','ACM','ADS',
  'AI2','API2','CPU2','GPU2','ISA','ISM','SMB','SLA','SLB','SLG',
  'NPC','NPM','NTP','NVT','OVH','OEM','ODM','PCB','SMT','THD',
]);
// Theme family mapping: resolve overlapping themes to a shared family
export const THEME_FAMILIES: Record<string, string> = {
  'POWER_GRID': 'POWER_GRID_FAMILY', 'NUCLEAR_ENERGY': 'POWER_GRID_FAMILY', 'THERMAL_COOLING': 'POWER_GRID_FAMILY',
  'FABRICATION_PACKAGING': 'FABRICATION_STACK',
  'INTERCONNECT_PHOTONICS': 'PHOTONICS_COMPUTE',
  'MEMORY_STORAGE': 'MEMORY_COMPUTE', 'COMPUTE_SCALING': 'MEMORY_COMPUTE',
  'MATERIALS_SUPPLY': 'MATERIALS_GEOPOLITICS',
  'QUANTUM_CRYOGENICS': 'QUANTUM_COMPUTE',
};
export const SERENITY_UNIVERSE: UniverseStock[] = [
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
export const UNIVERSE_DEDUPED = SERENITY_UNIVERSE.filter((u, i, arr) => arr.findIndex(x => x.ticker === u.ticker) === i);
// ── Scanner enrichment ────────────────────────────────────────────────────────

// ── Evidence velocity engine ──────────────────────────────────────────────────
// Measures momentum: articles in last 7 days vs prior 7 days per ticker/layer.
// Rising velocity = thesis gaining confirmation → boost score and show 🔥
// This is the dynamic layer that makes the scanner theme-driven, not static.

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
// ── Score Gauge ───────────────────────────────────────────────────────────────

// ── #22: Score formula tooltip ────────────────────────────────────────────────
export const SCORE_FORMULA_LINES = [
  { label: 'Upstream position',  detail: 'T1=+63 → T2=+56 → T3=+49 … T10=0  (rarer = higher)' },
  { label: 'Small-cap bonus',    detail: 'Market cap <$2B → +15 pts' },
  { label: 'Cross-border arb',   detail: 'STO/TSE/KRX → +12 · TWO → +10 · FRA → +8' },
  { label: 'Serenity mention',   detail: 'Explicitly named in Serenity research → +10' },
  { label: 'Live evidence',      detail: 'News articles found → +2 per article (max +8)' },
  { label: 'Competition moat',   detail: '1 public competitor → +10 · 2–3 → +5' },
  { label: 'News velocity',      detail: 'Articles this week > prior week → up to +12' },
  { label: 'Criteria penalty',   detail: 'Each failed check (competition / size / listing / tier) → −5' },
  { label: 'Max score',          detail: '100  (hard cap via Math.min)' },
];
// ── Emerging Theme Detector ───────────────────────────────────────────────────
// Scans live news headlines for supply-chain stress keywords that may NOT fit
// the 9 predefined buckets. Surfaces new themes as auto-detected intelligence.
// This is the "discovery-first" layer — it finds new bottleneck classes from evidence.

export const EMERGING_THEME_DETECTORS = [
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
// Entity resolution — transformer = POWER_GRID (was incorrectly appearing as "new theme")
export const THEME_TO_BUCKET: Record<string, string> = {
  transformer:  'POWER_GRID',            // FIX: transformer/grid = POWER_GRID bucket — same entity
  ai_power:     'POWER_GRID',            // AI data center power = POWER_GRID
  opt_test:     'INTERCONNECT_PHOTONICS',
  qual_cycle:   'FABRICATION_PACKAGING',
  rare_earth:   'MATERIALS_SUPPLY',
  smr_nuclear:  'NUCLEAR_ENERGY',
  cooling_cdm:  'THERMAL_COOLING',
  // backlog, subsidy_policy, defense_semi, specialty_gas, shipping_port = cross-cutting, stay as "new"
};
export const PROMOTED_THEMES_KEY = 'mc_bn_theme_seen_v1';
// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — GEOPOLITICAL OVERLAY
// ═══════════════════════════════════════════════════════════════════════════════

// Geo mechanism detection — keyword-based, no API needed
// Each mechanism maps to affected supply chain layers so we can show chain impact
export const GEO_MECHANISMS: Record<string, { label: string; color: string; icon: string; layers: string[] }> = {
  TARIFF:     { label: 'Tariff / Trade',  color: '#F59E0B', icon: '🏷️', layers: ['MATERIALS_SUPPLY','FABRICATION_PACKAGING','MEMORY_STORAGE'] },
  EXPORT_BAN: { label: 'Export Control',  color: '#EF4444', icon: '🚫', layers: ['MATERIALS_SUPPLY','INTERCONNECT_PHOTONICS','FABRICATION_PACKAGING'] },
  SUBSIDY:    { label: 'Subsidy / Grant', color: '#10B981', icon: '💰', layers: ['FABRICATION_PACKAGING','MATERIALS_SUPPLY','NUCLEAR_ENERGY'] },
  MILITARY:   { label: 'Military / Sanctions', color: '#8B5CF6', icon: '⚔️', layers: ['MATERIALS_SUPPLY','COMPUTE_SCALING','INTERCONNECT_PHOTONICS'] },
  POWER:      { label: 'Power / Grid',    color: '#06B6D4', icon: '⚡', layers: ['POWER_GRID','NUCLEAR_ENERGY','THERMAL_COOLING'] },
  SHIPPING:   { label: 'Shipping / Ports',color: '#0F7ABF', icon: '🚢', layers: ['MATERIALS_SUPPLY','MEMORY_STORAGE','FABRICATION_PACKAGING'] },
  CURRENCY:   { label: 'Currency / FX',   color: '#F59E0B', icon: '💱', layers: ['MATERIALS_SUPPLY','FABRICATION_PACKAGING'] },
};
export const MECHANISM_KEYWORDS: Record<string, string[]> = {
  TARIFF:     ['tariff','duty','trade war','levy','import tax','trade restriction','section 301'],
  EXPORT_BAN: ['export ban','export control','entity list','ear99','eccn','semiconductor export','chips export','gallium','germanium','export restriction'],
  SUBSIDY:    ['subsidy','chips act','grant','funding','incentive','federal funding','doe funding','defense contract','government contract','rfp'],
  MILITARY:   ['military','defense','sanctions','itar','weapon','national security','nato','army','navy','airforce','missile','war '],
  POWER:      ['blackout','grid constraint','electricity shortage','power crisis','energy crisis','grid bottleneck','rolling blackout','data center power'],
  SHIPPING:   ['shipping','port congestion','suez','red sea','freight disruption','logistics','container shortage','panama canal'],
  CURRENCY:   ['currency','forex','fx rate','devaluation','yuan','yen weakens','won drops','exchange rate'],
};
// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — CONFERENCE CALENDAR + EARNINGS CATALYST ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// Detect live conference signal: are news articles mentioning this conference right now?
export const CONF_KEYWORDS: Record<string, string[]> = {
  'NVDA GTC':    ['gtc','nvidia gtc','jensen keynote','nvidia developer conference'],
  'OFC':         ['ofc conference','optical fiber conference','silicon photonics conference'],
  'SEMICON West':['semicon west','semicon','semiconductor equipment show'],
  'Hot Chips':   ['hot chips','hotchips'],
  'TSMC OIP':    ['tsmc oip','oip alliance','open innovation platform','tsmc packaging'],
  'IEEE IEDM':   ['iedm','electron devices meeting'],
};
// Universe tickers that matter most for earnings catalysts
export const EARNINGS_WATCH = ['NVDA','AMD','AVGO','MRVL','COHR','LITE','MU','AEHR','FORM','TSM','ASML','AMAT','LRCX','ETN','VRT','CCJ','CEG','TLN','SMCI','NBIS'];
// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — SUPPLY CHAIN MAP
// ═══════════════════════════════════════════════════════════════════════════════

// Map SUPPLY_CHAIN tiers to bottleneck bucket IDs.
// Extends TIER_MAP (tiers 1-6) to cover T7-T10 which TIER_MAP doesn't handle.
// T9 (Advanced Packaging = CoWoS) is critically part of FABRICATION_PACKAGING.
export const TIER_TO_BUCKET: Record<number, string> = {
  1: 'MATERIALS_SUPPLY',
  2: 'QUANTUM_CRYOGENICS',
  3: 'FABRICATION_PACKAGING',
  4: 'INTERCONNECT_PHOTONICS',
  5: 'COMPUTE_SCALING',
  6: 'POWER_GRID',
  // T7: no formal bucket (transceiver modules = covered by INTERCONNECT_PHOTONICS articles)
  7: 'INTERCONNECT_PHOTONICS',
  // T8: Test & Inspection covered by FABRICATION_PACKAGING (test equipment = fab stack)
  8: 'FABRICATION_PACKAGING',
  // T9: Advanced Packaging (CoWoS, HBM stacking) = FABRICATION_PACKAGING critical bottleneck
  9: 'FABRICATION_PACKAGING',
  // T10: Hyperscalers = COMPUTE_SCALING (demand side, not supply constraint)
  10: 'COMPUTE_SCALING',
};
