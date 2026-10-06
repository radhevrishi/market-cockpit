// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type ActionFlag, type ConcallSignalType, type SignalCategory, type SignalHorizon, type SectorSignalDef } from './types';

// Theme
export const BG = '#0A0E1A';
export const CARD = '#0D1623';
export const BORDER = '#1A2840';
export const ACCENT = '#0F7ABF';
export const GREEN = '#10B981';
export const RED = '#EF4444';
export const YELLOW = '#FBBF24';
export const PURPLE = '#8B5CF6';
export const CYAN = '#06B6D4';
export const ORANGE = '#F97316';
export const TEXT1 = '#E2E8F0';
export const TEXT2 = '#94A3B8';
export const TEXT3 = '#64748B';
export const DECISION_COLORS: Record<ActionFlag, string> = {
  'BUY': '#10B981',      // Green
  'ADD': '#059669',      // Dark Green
  'HOLD': '#FBBF24',     // Yellow
  'WATCH': '#A78BFA',    // Purple
  'TRIM': '#F97316',     // Orange
  'EXIT': '#EF4444',     // Red
  'AVOID': '#64748B',    // Grey
  'MONITOR': '#0F7ABF',  // Cyan (Accent)
};
export const FRESHNESS_COLORS: Record<string, string> = {
  'FRESH': '#10B981',
  'RECENT': '#06B6D4',
  'AGING': '#FBBF24',
  'STALE': '#64748B',
};
// ── Tab cache: Avoid refetching on every tab switch ──
// Module-level cache persists across component remounts (tab switches)
// Only refetches on explicit refresh or after CACHE_TTL expires
export const CACHE_TTL = 30 * 60 * 1000;
// ── Hybrid Pattern Library (Layer 1: keywords, Layer 2: semantic rules) ───────
// CONCALL-specific: things management says in calls, presentations, interviews
export const CONCALL_PATTERNS: {
  type: ConcallSignalType; category: SignalCategory;
  keywords: string[];       // Layer 1: direct keyword matches
  semantic: string[];       // Layer 2: indirect/paraphrased signals
  positive: boolean; strength: 1|2|3|4|5; horizon: SignalHorizon; isAlpha: boolean;
}[] = [
  // ── DEMAND & ORDERS (highest alpha for Indian small-caps) ────────────────────
  { type:'DEMAND_CONSTRAINT', category:'DEMAND', isAlpha:true, positive:true, strength:5, horizon:'6-12M',
    keywords:['demand exceed','demand higher than supply','would have done more','capacity constraint','demand outpac','global shortage','insulator shortage','demand exceeds capacity'],
    semantic:['demand remains robust','strong demand environment','demand continues to be','demand visibility strong','demand pickup','demand trend improving','capacity fully utilized','running at full capacity','demand far exceeds'],
  },
  { type:'ORDER', category:'DEMAND', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    keywords:['crore order','crore orders','₹','order book','order inflow','order pipeline','large order','order worth','order of around','order visibility'],
    semantic:['healthy order book','strong order pipeline','order momentum','significant orders','order traction','robust order inflow','order inquiry strong','inquiries at record'],
  },
  { type:'LTA', category:'SUPPLY_CHAIN', isAlpha:true, positive:true, strength:5, horizon:'12M+',
    keywords:['long-term agreement','long term agreement','lta','multi-year contract','multi year contract','committed volume','offtake agreement','supply agreement'],
    semantic:['multi-quarter visibility','assured offtake','tied up volume','secured supply','visibility for next'],
  },
  { type:'EXPORT_DEMAND', category:'DEMAND', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    keywords:['export order','export inquiry','export demand','international order','overseas order','global order'],
    semantic:['international demand growing','export traction','global customers','foreign inquiry'],
  },
  // ── CAPACITY & CAPEX ─────────────────────────────────────────────────────────
  { type:'CAPEX', category:'CAPEX', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['capacity expansion','new capacity','commissioning','capex','new plant','go live','capacity online','additional capacity','capacity addition'],
    semantic:['expansion on track','new line operational','adding capacity','plant coming online','brownfield expansion','greenfield underway','additional line'],
  },
  { type:'CAPEX_DELAY', category:'CAPEX', isAlpha:true, positive:false, strength:3, horizon:'3-6M',
    keywords:['capex delayed','expansion delayed','postponed','pushed back','deferred','phase shift','commissioning delay'],
    semantic:['delay in commissioning','timeline extended','capacity ramp slower','expansion taking longer'],
  },
  { type:'ORDER_EXECUTION_DELAY', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['order execution delay','delivery delay','project delay','execution slowed'],
    semantic:['slower execution','pending deliveries','execution pace slower','backlog taking longer'],
  },
  // ── MARGIN & PRICING ─────────────────────────────────────────────────────────
  { type:'MARGIN', category:'MARGIN', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['no margin pressure','stable margin','margin stable','pass through','pass-through','full pass','pricing power','margin expansion','opm expansion'],
    semantic:['margins expected to improve','comfortable on margins','margin trajectory positive','margin protection intact','we expect improvement in margins','no near-term margin impact'],
  },
  { type:'MARGIN_PRESSURE', category:'MARGIN', isAlpha:true, positive:false, strength:3, horizon:'3-6M',
    keywords:['margin pressure','margin headwind','cost pressure','commodity cost','input cost pressure','margin impact','squeeze'],
    semantic:['margins under pressure','cost inflation impacting','input costs elevated','margin headwinds expected'],
  },
  { type:'PRICING', category:'PRICING', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['price hike','price increase','asp rising','higher realisation','higher realization','improved pricing'],
    semantic:['pricing power intact','able to pass on costs','realizations improving','better pricing environment'],
  },
  // ── GUIDANCE ─────────────────────────────────────────────────────────────────
  { type:'GUIDANCE_UP', category:'GUIDANCE', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    keywords:['guidance raised','raised guidance','above guidance','conservative deliver','deliver above','guidance upgrade','bullish outlook'],
    semantic:['expect to do better','confident of outperforming','comfortable with higher','positive guidance','optimistic about growth','expect acceleration'],
  },
  { type:'GUIDANCE_DOWN', category:'GUIDANCE', isAlpha:true, positive:false, strength:4, horizon:'0-3M',
    keywords:['guidance cut','cut guidance','lowered guidance','below guidance','miss','disappointed','challenging demand','weak demand'],
    semantic:['expect challenging quarter','demand softening','expect lower revenues','moderated our outlook','tempered expectations'],
  },
  // ── MANAGEMENT STYLE SIGNALS (your biggest edge) ──────────────────────────────
  { type:'CONSERVATIVE_GUIDANCE', category:'MGMT_STYLE', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    keywords:['conservative','not providing guidance but','management remains conservative','guiding conservatively','comfortable'],
    semantic:['management conservative','not guiding but expect','comfortable without giving numbers','traditionally conservative','conservative management'],
  },
  { type:'VISIBILITY_CONFIDENCE', category:'MGMT_STYLE', isAlpha:true, positive:true, strength:4, horizon:'6-12M',
    keywords:['visibility strong','order visibility','revenue visibility','confident about growth','confident of achieving'],
    semantic:['strong visibility into next','good revenue visibility','very confident on numbers','clear line of sight','outlook very positive'],
  },
  // ── CAPITAL ALLOCATION ────────────────────────────────────────────────────────
  { type:'DEBT_REDUCTION', category:'SUPPLY_CHAIN', isAlpha:false, positive:true, strength:2, horizon:'6-12M',
    keywords:['debt reduction','debt free','repaid debt','working capital improvement','reduced borrowing'],
    semantic:['becoming debt free','reduced debt levels','balance sheet improving','reduced working capital cycle'],
  },
  { type:'EQUITY_DILUTION', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['qip','equity dilution','rights issue','preferential allotment','fresh equity'],
    semantic:['fund raise planned','equity infusion','additional equity'],
  },
  // ── RISK SIGNALS ─────────────────────────────────────────────────────────────
  { type:'CUSTOMER_DELAY', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['customer delay','customer slowdown','order deferral','project delayed by customer'],
    semantic:['customer capex delayed','customer pushing delivery','slower customer offtake'],
  },
  { type:'REGULATORY_RISK', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'3-6M',
    keywords:['regulatory', 'compliance issue', 'approval delayed', 'license pending', 'regulatory hurdle'],
    semantic: ['awaiting regulatory approval', 'pending clearances', 'regulatory environment uncertain'],
  },
  { type:'WORKING_CAPITAL_STRESS', category:'RISK', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['working capital stress','receivables stretched','debtors outstanding','collection pressure'],
    semantic:['stretched receivables','working capital cycle elongated','collections delayed'],
  },
  // ── SUPPLY CHAIN (noise — confirms thesis, low horizon) ───────────────────────
  { type:'SUPPLY_CHAIN', category:'SUPPLY_CHAIN', isAlpha:false, positive:true, strength:2, horizon:'0-3M',
    keywords:['inventory build','higher inventory','managing inventory','commodity management','raw material secured'],
    semantic:['managing commodity exposure','inventory buffer maintained','raw material covered'],
  },
  // ── SECTOR TAILWIND (news feed routing) ──────────────────────────────────────
  { type:'SECTOR_TAILWIND', category:'DEMAND', isAlpha:true, positive:true, strength:4, horizon:'6-12M',
    keywords:['sector tailwind','industry tailwind','structural demand','sector beneficiary'],
    semantic:['sector growing strongly','industry demand accelerating','structural growth story'],
  },
];
// NEWS FEED SIGNALS — these belong in general news feed, not concall
export const NEWS_FEED_PATTERNS: { type: ConcallSignalType; category: SignalCategory; keywords: string[]; semantic: string[]; positive: boolean; strength: 1|2|3|4|5; isAlpha: boolean }[] = [
  { type:'ANALYST_CAP', category:'GUIDANCE', isAlpha:true, positive:true, strength:5,
    keywords:['clearly missed','we were wrong','should have','underestimated demand','underestimated growth','raising target after','raising after skepticism','capitulat','raising estimates after'],
    semantic:['analyst upgrades after','raised target on','consensus wrong on','street underestimated'],
  },
];
// ── NEWS HEADLINE PATTERNS — catch news article language (NOT management speech) ──────
// This is a SEPARATE tier from CONCALL_PATTERNS.
// News headlines use different language: "wins order", "bags contract", "revenue up X%"
// These generate signals with LOWER strength (1-3) since they're less specific than mgmt statements.
// They run AFTER compound patterns and CONCALL_PATTERNS, filling the gap for news-covered companies.
export const HEADLINE_PATTERNS: {
  type: ConcallSignalType; category: SignalCategory; subject: string;
  keywords: string[];
  positive: boolean; strength: 1|2|3|4|5; horizon: SignalHorizon; isAlpha: boolean;
}[] = [
  // ── ORDERS — news headline style ──────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Order Win', isAlpha:true, positive:true, strength:3, horizon:'0-3M',
    keywords:['wins order','wins contract','bags order','bags contract','secures order','secures contract','receives order','awarded order','awarded contract','order win','contract win','new order worth','new contract worth','loi received','letter of intent','contract signed'] },
  { type:'ORDER', category:'DEMAND', subject:'Defense Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    keywords:['defence order','defense order','army order','navy contract','air force contract','drdo order','drdo contract','hal contract','ministry of defence','mod contract','defence ministry order','sos order','strategic order'] },
  { type:'ORDER', category:'DEMAND', subject:'Government Order', isAlpha:true, positive:true, strength:3, horizon:'0-3M',
    keywords:['government order','government contract','public sector order','psu order','nnpcl order','npcil order','powergrid order','pgcil order','nhpc order','seci order','rrecl order','state order','central order','nh order','nhai contract'] },
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Long-Term Contract', isAlpha:true, positive:true, strength:4, horizon:'12M+',
    keywords:['long-term supply agreement','multi-year order','long term contract','5-year supply','10-year contract','framework agreement','rate contract','annual rate contract','multi year supply'] },

  // ── RESULTS & EARNINGS — headline style ──────────────────────────────────
  { type:'GUIDANCE_UP', category:'GUIDANCE', subject:'Quarterly Results Beat', isAlpha:true, positive:true, strength:2, horizon:'0-3M',
    keywords:['q1 results','q2 results','q3 results','q4 results','quarterly results','revenue up','profit up','pat up','net profit up','revenue rises','profit rises','pat rises','revenue grows','profit grows','record revenue','record profit','highest revenue','highest profit'] },
  { type:'GUIDANCE_DOWN', category:'GUIDANCE', subject:'Results Miss', isAlpha:true, positive:false, strength:2, horizon:'0-3M',
    keywords:['profit down','revenue down','pat down','net profit falls','revenue falls','revenue decline','profit declines','misses estimates','below estimates','disappoints','revenue miss'] },
  { type:'GUIDANCE_UP', category:'GUIDANCE', subject:'Guidance Raise', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['raises guidance','upgrades guidance','guidance raised','upgrades target','target price raised','analyst upgrades','buy rating','strong buy'] },

  // ── CAPACITY & EXPANSION ──────────────────────────────────────────────────
  { type:'CAPEX', category:'CAPEX', subject:'Expansion', isAlpha:true, positive:true, strength:2, horizon:'3-6M',
    keywords:['capacity expansion','new plant','plant expansion','greenfield project','brownfield expansion','new facility','new manufacturing','new production line','doubles capacity','triples capacity','capacity addition','manufacturing expansion'] },
  { type:'CAPEX', category:'CAPEX', subject:'New Facility', isAlpha:true, positive:true, strength:2, horizon:'6-12M',
    keywords:['inaugurates plant','inaugurates factory','new factory','sets up plant','sets up manufacturing','commissions plant','commissions factory','plant commissioned','facility commissioned'] },

  // ── STRATEGIC DEALS ───────────────────────────────────────────────────────
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Partnership/JV', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    keywords:['joint venture','jv agreement','partnership agreement','strategic alliance','mou signed','mou with','ties up with','collaboration agreement','supply agreement signed'] },
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Export Order', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    keywords:['export order','exports to','supplies to','international order','overseas contract','us order','european order','german customer','us customer','export contract','global customer','foreign order'] },

  // ── DEBT / CAPITAL ────────────────────────────────────────────────────────
  { type:'DEBT_REDUCTION', category:'SUPPLY_CHAIN', subject:'Balance Sheet', isAlpha:false, positive:true, strength:1, horizon:'6-12M',
    keywords:['becomes debt free','debt-free','repays debt','reduces debt','zero debt','debt reduction','repaid loans','loan repaid'] },
  { type:'EQUITY_DILUTION', category:'RISK', subject:'Equity Raise', isAlpha:true, positive:false, strength:2, horizon:'0-3M',
    keywords:['qip opens','qip launch','rights issue','preferential allotment','fundraising','fund raise','fresh equity','dilutes equity','new shares'] },

  // ── NEGATIVE ──────────────────────────────────────────────────────────────
  { type:'REGULATORY_RISK', category:'RISK', subject:'Regulatory Action', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    keywords:['sebi notice','sebi order','regulatory action','show cause notice','penalty imposed','fine imposed','regulatory penalty','suspended','blacklisted','debarred','nclat order','nclt order','insolvency'] },
  { type:'CUSTOMER_DELAY', category:'RISK', subject:'Order Slowdown', isAlpha:true, positive:false, strength:2, horizon:'0-3M',
    keywords:['order slowdown','order deferral','project delayed','execution delay','order cancellation','cancelled order','deal falls through','contract terminated'] },
];
// ── Generic words that must NEVER be used as single-word aliases ──────────────
// These appear in too many unrelated article headlines and cause false positives.
export const ALIAS_BLOCKLIST = new Set([
  'global','digital','data','power','energy','india','national','new','smart','advance',
  'next','tech','net','pro','max','plus','prime','core','one','first','alpha','beta',
  'clean','pure','green','blue','nova','apex','ace','star','sky','sun','wind','rapid',
  'swift','agile','flex','zen','peak','mega','micro','nano','pico','meta','omni','uni',
  'multi','poly','trans','eco','bio','geo','neo','ultra','hyper','super','elite','premium',
  'select','excel','royal','shield','forte','vista','clarity','horizon','nexus','vertex',
]);
// ── Manual alias overrides for tickers where auto-generation fails ───────────
// Key = UPPERCASE NSE symbol; value = additional aliases to add
export const MANUAL_ALIASES: Record<string, string[]> = {
  // ── Power T&D ──────────────────────────────────────────────────────────────
  'GVT&D':      ['ge vernova t&d india', 'ge vernova t&d', 'ge vernova', 'ge t&d india', 'vernova india'],
  'GVTD':       ['ge vernova t&d india', 'ge vernova t&d', 'ge vernova', 'ge t&d india', 'vernova india'],
  'QPOWER':     ['quality power electrical', 'quality power el', 'quality power engineering'],
  'ATLANTAELE': ['atlanta electric', 'atlanta electrics limited'],
  'WEBELSOLAR': ['websol energy', 'websol solar', 'webel solar system'],
  'SKIPPER':    ['skipper limited', 'skipper towers', 'skipper conductor', 'skipper transmission'],
  'AZAD':       ['azad engineering limited', 'azad aerospace'],
  'VENUSPIPES': ['venus pipes and tubes', 'venus pipes', 'venus wire'],
  'INA':        ['insolation energy', 'insolation ener', 'insolation solar'],
  'VERTIS':     ['vertis infrastructure limited', 'vertis infra'],
  // ── Defense & Aerospace ────────────────────────────────────────────────────
  // CRITICAL: "data patterns" is a generic tech phrase — use FULL legal name only
  'DATAPATTNS': ['data patterns limited', 'data patterns (india)', 'data patterns india limited'],
  // ── Consumer / FMCG ────────────────────────────────────────────────────────
  // FIXED: Removed "bajaj consumer" (too generic — matches Bajaj Auto articles)
  // Only use more specific aliases that uniquely identify Bajaj Consumer Care
  'BAJAJCON':   ['bajaj consumer care', 'bajaj almond drops', 'bajaj nomarks', 'bajaj consumer care limited'],
  'BAJAJFINSERV':['bajaj finserv', 'bajaj financial services'],
  // ── Financials ─────────────────────────────────────────────────────────────
  // FIXED: MCX is a commodity exchange — articles about "order" or "supply" are commodity orders, not equipment
  'MCX':        ['multi commodity exchange', 'mcx india limited'],
  'IIFL':       ['iifl finance limited', 'iifl wealth', 'iifl securities limited', 'iifl samasta'],
  // ── Other ──────────────────────────────────────────────────────────────────
  'TRAVELFOOD': ['travel food services', 'travel food limited'],
  'PARKHOSPS':  ['park mediclinics', 'park hospitals limited', 'park medi world'],
  'ATHERENERG': ['ather energy limited'],
  'CLEANMAX':   ['clean max enviro', 'cleanmax enviro energy'],
  'UTLSOLAR':   ['fujiyama power systems', 'utl solar', 'utl renewable energy'],
  'GLOBAL':     ['global education limited', 'global indian international school'],
};
export const SECTOR_SIGNALS: SectorSignalDef[] = [
  { id:'INSULATOR_SHORTAGE', label:'Insulator Shortage',
    signalType:'SUPPLY_CONSTRAINT', subject:'Insulator Supply', driver:'T&D and grid expansion cycle',
    impact:'Higher order inflow for insulator manufacturers operating at full capacity',
    keywords:['insulator shortage','insulator demand','global insulator','disc insulator','string insulator','insulator supply constrained','insulator backlog'],
    compoundRequired:{ product:['insulator','disc insulator','composite insulator'], state:['shortage','demand strong','constraint','full capacity','order book','backlog','high demand'] },
    beneficiaryProducts:['insulator','electrical equipment','T&D','transmission equipment'],
    targetSectors:['electrical','insulator','power transmission','T&D equipment'],
    excludeSectors:['IT','software','pharma','bank','finance','FMCG','consumer','textile','media'],
    relevanceThreshold: 0.6 },

  { id:'TRANSFORMER_SHORTAGE', label:'Transformer Shortage',
    signalType:'CAPACITY_SHORTAGE', subject:'Transformer Supply', driver:'Grid modernisation and data center power buildout',
    impact:'Lead times expanding, order books building for transformer OEMs',
    keywords:['transformer shortage','transformer demand','power transformer','grid transformer','transformer backlog','transformer lead time','transformer supply'],
    compoundRequired:{ product:['transformer','power transformer','distribution transformer'], state:['shortage','backlog','lead time','demand','constraint','delay','strong order'] },
    beneficiaryProducts:['transformer','electrical equipment','switchgear','power equipment'],
    targetSectors:['electrical','transformer','power','T&D','switchgear'],
    excludeSectors:['IT','pharma','bank','FMCG','consumer','software'],
    relevanceThreshold: 0.6 },

  { id:'CABLE_DEMAND', label:'Cable/Conductor Demand',
    signalType:'DEMAND_SURGE', subject:'Cable/Conductor Demand', driver:'Power infra capex and renewable connectivity',
    impact:'Volume growth and order visibility for cable & conductor manufacturers',
    keywords:['cable demand','conductor demand','wire demand','cable order','cable backlog','conductor order'],
    compoundRequired:{ product:['cable','conductor','wire','acsr','opgw'], state:['demand','order','growth','backlog','strong','surge','shortage'] },
    beneficiaryProducts:['cable','conductor','wire','electrical cables'],
    targetSectors:['cable','conductor','wire','electrical','power','telecom'],
    excludeSectors:['IT','pharma','bank','FMCG','consumer'],
    relevanceThreshold: 0.6 },

  { id:'DEFENCE_INDIGENISATION', label:'Defence Push',
    signalType:'DEMAND_SURGE', subject:'Defence Indigenisation', driver:'Atmanirbhar Bharat + DPP policy push',
    impact:'Domestic order visibility improving for defence electronics and equipment',
    keywords:['make in india defence','defence indigenisation','atmanirbhar defence','defence offset','defence import substitution','idex','drdo'],
    beneficiaryProducts:['defence','defense','military','electronics','aerospace','ordnance'],
    targetSectors:['defence','defense','aerospace','electronics','engineering','military'],
    excludeSectors:['pharma','bank','FMCG','consumer','textile'],
    relevanceThreshold: 0.65 },

  { id:'SOLAR_BOOM', label:'Solar Demand',
    signalType:'DEMAND_SURGE', subject:'Solar Equipment Demand', driver:'500GW renewable target + PLI schemes',
    impact:'Order visibility building for solar EPC, module, and balance-of-system suppliers',
    keywords:['solar capacity','renewable target','solar tender','solar auction','solar order','green energy target'],
    beneficiaryProducts:['solar','module','inverter','EPC','renewable','wind','energy'],
    targetSectors:['solar','renewable','energy','EPC','electrical'],
    excludeSectors:['IT','bank','pharma','FMCG'],
    relevanceThreshold: 0.55 },

  { id:'GRID_INFRA_BOTTLENECK', label:'Grid Infra Bottleneck',
    signalType:'INFRASTRUCTURE_BOTTLENECK', subject:'Grid Infrastructure', driver:'AI data center + EV + renewable power demand',
    impact:'Long order visibility and pricing power for T&D equipment, substations, EPC players',
    keywords:['grid infrastructure','grid constraint','power grid','grid modernisation','transmission bottleneck','grid expansion','substation'],
    compoundRequired:{ product:['grid','substation','transmission','distribution','T&D','switchgear'], state:['constraint','bottleneck','shortage','demand','expansion','upgrade','investment'] },
    beneficiaryProducts:['grid equipment','T&D','substation','switchgear','transformer','cable','EPC'],
    targetSectors:['electrical','power','T&D','transmission','EPC','grid','infrastructure'],
    excludeSectors:['IT','pharma','bank','FMCG','consumer'],
    relevanceThreshold: 0.65 },

  // ── RAILWAY SECTOR ──────────────────────────────────────────────────────────
  { id:'RAILWAY_CAPEX_SURGE', label:'Railway Capex Surge',
    signalType:'DEMAND_SURGE', subject:'Railway Rolling Stock Demand', driver:'₹2.5L Cr railway budget + 100-year infra ambition',
    impact:'Multi-year order pipeline for wagon, coach, and rail component makers',
    keywords:['indian railways','railway budget','vande bharat','kavach','freight corridor','metro project','rvnl','rail vikas','konkan railway'],
    beneficiaryProducts:['wagon','coach','locomotive','rail component','bogie','wheel','axle','coupling','track material'],
    targetSectors:['railway','rolling stock','rail components','transportation','defence','engineering'],
    excludeSectors:['pharma','bank','FMCG','consumer','textile','IT'],
    relevanceThreshold: 0.60 },

  // ── DEFENSE MACRO ────────────────────────────────────────────────────────────
  { id:'DEFENCE_BUDGET_ALLOCATION', label:'Defence Budget Growth',
    signalType:'DEMAND_SURGE', subject:'Defence Capital Budget', driver:'Geopolitical tensions + modernisation drive',
    impact:'Allocation for procurement rising — orders to HAL, BDL, BEL, and private defence OEMs',
    keywords:['defence budget','defense budget','capital allocation defence','defence procurement','dai','mod allocation','defence ministry','def capex'],
    compoundRequired:{ product:['defence','defense','military','naval','army','air force'], state:['budget','allocation','increase','higher','capex','procurement','modernisation','crore'] },
    beneficiaryProducts:['defence electronics','aerospace','ordnance','shipbuilding','vehicle','armament'],
    targetSectors:['defence','defense','aerospace','military electronics','engineering','naval'],
    excludeSectors:['pharma','FMCG','consumer','real estate','bank','textile'],
    relevanceThreshold: 0.60 },

  // ── PHARMA API DEMAND ────────────────────────────────────────────────────────
  { id:'CHINA_PLUS_ONE_PHARMA', label:'China+1 Pharma Shift',
    signalType:'DEMAND_SURGE', subject:'API/CDMO China+1 Migration', driver:'US-China tensions + PLI for pharma',
    impact:'New customer inquiries and supply agreements for Indian API and CDMO players',
    keywords:['china plus one pharma','api import substitution','cdmo india','api supply chain','china api shortage','usfda inspection','qualifies api'],
    beneficiaryProducts:['api','active pharmaceutical','fermentation','cdmo','crams','bulk drug'],
    targetSectors:['pharma','api','cdmo','specialty chemical'],
    excludeSectors:['IT','bank','FMCG','consumer','real estate'],
    relevanceThreshold: 0.65 },

  // ── AGROCHEMICAL DESTOCKING ──────────────────────────────────────────────────
  { id:'AGROCHEM_RESTOCKING', label:'Agrochem Restocking Cycle',
    signalType:'DEMAND_SURGE', subject:'Agrochem Channel Restocking', driver:'Post-destocking normalisation',
    impact:'Volume recovery for agrochemical formulators and technicals suppliers',
    keywords:['agrochem restocking','channel inventory normalised','agrochemical demand recovery','crop protection demand','formulation demand'],
    compoundRequired:{ product:['agrochemical','pesticide','herbicide','fungicide','formulation','crop protection'], state:['restocking','recovery','normalise','improving','demand picking','uptick','channel clear'] },
    beneficiaryProducts:['agrochemical','pesticide','crop protection','technical','formulation'],
    targetSectors:['agrochemical','specialty chemical','crop protection'],
    excludeSectors:['IT','bank','real estate','railway','defence'],
    relevanceThreshold: 0.70 },

  // ── REAL ESTATE DEMAND ───────────────────────────────────────────────────────
  { id:'HOUSING_DEMAND_SURGE', label:'Housing Demand Strong',
    signalType:'DEMAND_SURGE', subject:'Residential Housing Demand', driver:'Mortgage rates stable + urbanisation',
    impact:'Pre-sales volume and price realisation improving for residential developers',
    keywords:['housing demand','residential demand','pre-sales growth','home sales','new launches sold','real estate demand','property prices'],
    compoundRequired:{ product:['residential','housing','apartment','villa','plotted','township'], state:['demand','presales','sold out','record','growth','increase','strong','bookings'] },
    beneficiaryProducts:['real estate','developer','construction','housing finance'],
    targetSectors:['real estate','housing','construction','infrastructure'],
    excludeSectors:['IT','pharma','FMCG','bank','defence'],
    relevanceThreshold: 0.65 },
];
// Sectors that are ALWAYS irrelevant for industrial/equipment/supply signals.
// Financial companies trade instruments and provide services — NOT manufacturing beneficiaries.
export const ALWAYS_EXCLUDED_FROM_INDUSTRIAL_SIGNALS = new Set([
  'capital markets','financial services','banking','bank','nbfc','insurance','asset management',
  'diversified financials','consumer finance','multi-sector','holding company','investment',
  'commodity exchange','stock exchange','futures exchange','derivatives exchange',
  'financial','financial technology','fintech','payments','brokerage',
  'media','entertainment','retail','restaurants','hotels','airlines','logistics services',
  'education','telecom','it services','software','health services','hospital',
]);
// ── Hybrid Signal Extractor (Layer 1 + Layer 2) ───────────────────────────────
// ── Product-specific compound patterns for extractSignals ──────────────────────
// These fire ONLY when BOTH product keyword AND state keyword co-occur in same sentence.
// This prevents "demand" → DEMAND_CONSTRAINT for every stock. Must be specific.
// Coverage: Power T&D, Defense, Railways, Pharma/API, Chemicals, IT/ITES, Cement,
//           Real Estate, Textiles, Auto Components, Capital Goods, Metals.
export const COMPOUND_EXTRACT_PATTERNS: {
  type: ConcallSignalType; category: SignalCategory; subject: string;
  products: string[]; states: string[];
  positive: boolean; strength: 1|2|3|4|5; horizon: SignalHorizon; isAlpha: boolean;
}[] = [
  // ── POWER T&D ─────────────────────────────────────────────────────────────────
  { type:'DEMAND_CONSTRAINT', category:'DEMAND', subject:'Insulators', isAlpha:true, positive:true, strength:5, horizon:'6-12M',
    products:['insulator','disc insulator','composite insulator','glass insulator','porcelain insulator'],
    states:['shortage','demand strong','high demand','robust demand','capacity constraint','order full','supply constrained','operating at full','full capacity','exceed','more orders than'] },
  { type:'DEMAND_CONSTRAINT', category:'DEMAND', subject:'Transformers', isAlpha:true, positive:true, strength:5, horizon:'6-12M',
    products:['transformer','power transformer','distribution transformer','hvdc transformer'],
    states:['backlog','lead time','shortage','demand surge','constrained','order book','strong demand','cannot meet','full order'] },
  { type:'ORDER', category:'DEMAND', subject:'Cables/Conductors', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['cable','conductor','acsr','opgw','underground cable','aerial bundled'],
    states:['order','demand','inflow','pipeline','growing','strong','visibility','secured'] },
  { type:'ORDER', category:'DEMAND', subject:'T&D Equipment', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['switchgear','breaker','reactor','capacitor bank','substation','bus bar'],
    states:['order','demand','backlog','inflow','strong','secured','tendered'] },
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Power Sector LTA', isAlpha:true, positive:true, strength:5, horizon:'12M+',
    products:['power supply','grid supply','pgcil','seci','rrecl','powergrid','state discom','discom order'],
    states:['long-term','multi-year','framework agreement','rate contract','secured','five year','annual rate','empanelled'] },

  // ── DEFENSE & AEROSPACE ───────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Defense Order', isAlpha:true, positive:true, strength:5, horizon:'3-6M',
    products:['missile','radar','helicopter','aircraft','warship','aero engine','armament','ammunition','defence','defense','military','naval','army','air force','drdo','hal','tejas','akash','brahmos'],
    states:['order','contract','supply','secured','nominated','loi','award','qualify','trial','evaluation','indigenous','offset','make in india','ae order','production order'] },
  { type:'CAPEX', category:'CAPEX', subject:'Defense Capacity', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['ordnance','ammunition','explosive','propellant','defence production','defense manufacturing'],
    states:['capacity','expansion','greenfield','new line','commissioning','fy','production facility','scale up'] },
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Defense LTA', isAlpha:true, positive:true, strength:5, horizon:'12M+',
    products:['defence','defense','ministry of defence','mod','army','navy','air force','coast guard'],
    states:['long-term order','multi-year contract','repeat order','framework','annual order','5-year','10-year','sos order'] },
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Defense Exports', isAlpha:true, positive:true, strength:4, horizon:'6-12M',
    products:['defence export','defense export','arms export','mil export','drdo export','hal export'],
    states:['export order','foreign military','us sale','fms','nato','friendly nation','export clearance','export approval','₹','crore'] },

  // ── RAILWAYS ─────────────────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Railway Order', isAlpha:true, positive:true, strength:5, horizon:'3-6M',
    products:['wagon','coach','locomotive','bogey','railway','vande bharat','kavach','metro','emu','demu','rail coach','freight wagon','passenger coach'],
    states:['order','tender','award','secured','won','nominated','irctc','rvnl','indian railways','ministry of railways'] },
  { type:'LTA', category:'SUPPLY_CHAIN', subject:'Railway LTA', isAlpha:true, positive:true, strength:5, horizon:'12M+',
    products:['wagon','coach','locomotive','bogie','wheel','axle','coupler','rail fastener'],
    states:['rate contract','annual','long term','framework','repeat','assured order','standing order'] },
  { type:'CAPEX', category:'CAPEX', subject:'Rail Manufacturing Capex', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['wagon','coach factory','locomotive','foundry','forging','casting'],
    states:['new plant','expansion','greenfield','doubling','capacity addition','new facility','commission'] },
  { type:'DEMAND_CONSTRAINT', category:'DEMAND', subject:'Railway Wagon Shortage', isAlpha:true, positive:true, strength:4, horizon:'6-12M',
    products:['wagon','freight wagon','coal wagon'],
    states:['shortage','demand strong','delivery','order backlog','waiting period','queue','lead time','more orders'] },

  // ── PHARMA / API / CDMO ───────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Pharma API Order', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['api','active pharmaceutical','bulk drug','fermentation','synthesis','crams','cdmo','contract manufacturing'],
    states:['order','inquiry','rfq','award','new customer','new molecule','signed','contract','long-term supply','partnership'] },
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Pharma Export', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['fdf','finished dosage','formulation','generic','abbreviated','anda','dossier','us fda','usfda','eu gmp','tga','health canada'],
    states:['approval','clearance','filing','launch','export','eu','us','uk','latam','row market','inspection completed','no observations'] },
  { type:'MARGIN', category:'MARGIN', subject:'Pharma Gross Margin', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['api price','raw material','solvent','bulk drug price','specialty api'],
    states:['stable','no pressure','margin intact','price stable','pass through','no headwind','commodity stable'] },
  { type:'CAPEX', category:'CAPEX', subject:'Pharma Capacity', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['reactor','kg block','api plant','fermentation','synthesis block','formulation line','oral solid'],
    states:['commissioning','validation','who gmp','usfda','eu gmp','ready','operational','online','new block'] },

  // ── SPECIALTY CHEMICALS ────────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Agrochemical Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['agrochemical','pesticide','herbicide','fungicide','insecticide','crop protection'],
    states:['new molecule','molecule transfer','csr','import substitution','china plus one','registration','order','inquiry','customer qualified'] },
  { type:'ORDER', category:'DEMAND', subject:'Specialty Chemical Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['specialty chemical','fine chemical','fluorine','chloro','bromine','performance material','polymer','dye intermediate','pigment'],
    states:['order','new customer','import substitution','china+1','rfq','contract','qualification','approved','supply agreement'] },
  { type:'MARGIN_PRESSURE', category:'MARGIN', subject:'Chemical Margin Pressure', isAlpha:true, positive:false, strength:3, horizon:'0-3M',
    products:['inventory destocking','channel inventory','agrochemical inventory','chinese inventory','dumping'],
    states:['high','excess','elevated','correction','pricing pressure','lower realisation','headwind'] },
  { type:'CAPEX', category:'CAPEX', subject:'Chemical Plant', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['chemical plant','multipurpose plant','mpp','reactor','distillation','recovery unit','effluent treatment'],
    states:['commissioning','operational','going live','fy','new block','expansion','on track','greenfield'] },

  // ── IT / ITES / SOFTWARE ─────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'IT Deal Win', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['deal','tvc','tcv','contract value','it services','digital transformation','cloud migration','erp implementation','ai services','data analytics'],
    states:['win','won','awarded','signed','new logo','large deal','mega deal','multiyear','tvc','tcv','crore','mn dollar','total contract'] },
  { type:'GUIDANCE_UP', category:'GUIDANCE', subject:'IT Revenue Guidance', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['revenue guidance','growth guidance','pipeline','deal pipeline','demand environment'],
    states:['raised','upgraded','higher than','comfortable','positive','sequential growth','fy guidance raised','improving demand'] },
  { type:'MARGIN', category:'MARGIN', subject:'IT Margin', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['ebit margin','operating margin','attrition','headcount','utilization','subcontracting'],
    states:['improving','stable','expansion','lower attrition','better utilization','subcon down','no wage hike headwind'] },

  // ── CEMENT ────────────────────────────────────────────────────────────────────
  { type:'PRICING', category:'PRICING', subject:'Cement Realisation', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['cement price','bag price','realisation','trade segment','ex-works','dealer price'],
    states:['increase','hike','stable','improve','higher','better pricing','per bag','quarter on quarter'] },
  { type:'CAPEX', category:'CAPEX', subject:'Cement Capacity', isAlpha:true, positive:true, strength:3, horizon:'6-12M',
    products:['clinker','cement plant','grinding unit','kiln','blending','capacity addition','mtpa'],
    states:['commissioning','operational','new line','on track','fy','expansion','greenfield','brown field'] },
  { type:'MARGIN', category:'MARGIN', subject:'Cement Operating Margin', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['pet coke','coal','power fuel','freight','logistics','opex per tonne'],
    states:['lower','reducing','declining','benefit','stable','passed through','no pressure','below peak'] },

  // ── REAL ESTATE / CONSTRUCTION ────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Pre-sales / Bookings', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['pre-sales','booking','registration','sold','new launch','inventory sold','units sold','residential'],
    states:['strong','robust','higher','record','crore','growing','strong demand','oversubscribed','fully sold','sellout'] },
  { type:'GUIDANCE_UP', category:'GUIDANCE', subject:'Pre-sales Guidance', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['pre-sales guidance','new launch','pipeline launches','launch pipeline','expected collections','cash flow guidance'],
    states:['raise','upgrade','positive','better','comfortable','higher than','growth expected','on track'] },
  { type:'ORDER', category:'DEMAND', subject:'EPC/Infra Order', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['epc','highway','road','bridge','dam','irrigation','water supply','tunnel','metro','airport','port'],
    states:['order','award','loa','loi','secured','won','bid','nominated','nh','nhai','nhmb','state government','central government','nmcg'] },

  // ── AUTO COMPONENTS ──────────────────────────────────────────────────────────
  { type:'ORDER', category:'DEMAND', subject:'Auto Component Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['oem','tier 1','automobile','passenger vehicle','commercial vehicle','two wheeler','ev','electric vehicle','battery','motor'],
    states:['order','new program','nomination','sop','start of production','new model','platform win','supply agreement'] },
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Auto Export Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['auto component','forging','casting','stamping','machined','pump','bearing','filtration'],
    states:['export','global oem','tier 1 global','us customer','european','new customer','supply agreement','rfq won'] },

  // ── METALS / STEEL / ALUMINIUM ────────────────────────────────────────────────
  { type:'PRICING', category:'PRICING', subject:'Metal Realization', isAlpha:true, positive:true, strength:3, horizon:'0-3M',
    products:['hrc','crc','flat product','long product','rebar','wire rod','aluminium','copper','zinc'],
    states:['realisation','price','asp','better','increase','improved','higher','stable'] },
  { type:'ORDER', category:'DEMAND', subject:'Metal Order Pipeline', isAlpha:true, positive:true, strength:4, horizon:'0-3M',
    products:['special steel','alloy steel','stainless','aerospace grade','defense grade','armour plate','automotive grade'],
    states:['order','supply agreement','qualified','approved','qualification complete','new application','certified','ramp'] },

  // ── TEXTILES / APPAREL ────────────────────────────────────────────────────────
  { type:'EXPORT_DEMAND', category:'DEMAND', subject:'Textile Export Order', isAlpha:true, positive:true, strength:4, horizon:'3-6M',
    products:['yarn','fabric','garment','apparel','home textile','technical textile','fibre','polyester','cotton yarn'],
    states:['export','new customer','us order','eu order','bangladesh','vietnam','china plus','order book','inquiry','strong demand'] },

  // ── GENERIC CAPACITY / MARGIN (unchanged) ────────────────────────────────────
  { type:'CAPEX', category:'CAPEX', subject:'Capacity Expansion', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['plant','line','furnace','kiln','capacity','unit'],
    states:['commissioning','go live','operational','expansion','fy','q1','q2','q3','q4','new line','greenfield','brownfield'] },
  { type:'MARGIN', category:'MARGIN', subject:'Operating Margin', isAlpha:true, positive:true, strength:3, horizon:'3-6M',
    products:['margin','opm','ebitda'],
    states:['stable','expand','improve','intact','no pressure','protected','maintained','guidance'] },
];
