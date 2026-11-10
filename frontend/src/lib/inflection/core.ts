// ═══════════════════════════════════════════════════════════════════════════
// zzz1235 — HIDDEN INFLECTION RADAR. Pure.
//
// The owner (8 Nov 2026): "most of these themes (Class 8 trucks, packaging,
// grid) should be found automatically by our news feed — why not? Add tabs and
// logic." His framework ("From small news to multibagger opportunities"):
// do not build another news reader — detect ABNORMAL ECONOMIC CHANGE in an
// industry, trace who supplies it, and find the listed supplier whose earnings
// can move most.
//
// WHY THE FEED MISSED THEM. The news feed collects company and market news and
// tags it by company and by the fixed technology themes. Industry DATA
// ("Class 8 net orders +124% YoY", "transformer lead times 3 years",
// "corrugated box prices up") names no Indian company and no tracked theme, so
// it was either never fetched or dropped as not market-relevant.
//
// WHAT THIS DOES.
//   1. INDUSTRIES — a table of end markets the owner follows: what to search
//      for, the words that mean the industry, and the Indian supply-chain map
//      (bucket → companies → what must be verified). The map is a research
//      lead, never proof of revenue linkage.
//   2. SIGNALS — each headline is read for the six signal classes of the
//      framework (demand inflection, supply bottleneck, capacity utilisation,
//      qualification, regulation / geopolitics, technology substitution) and
//      its numbers (% YoY, % MoM, record, n-th consecutive, years of backlog).
//   3. SCORE — the framework's weights: magnitude 20, acceleration 15,
//      duration 15, EPS impact 20, market neglect 15, bottleneck 15 → 0–100.
//      0–30 monitor · 40–60 map the industry · 70–80 company work · 90+ deep
//      research. A score is research priority, not a buy.
// ═══════════════════════════════════════════════════════════════════════════

export type SignalClass = 'DEMAND' | 'BOTTLENECK' | 'UTILISATION' | 'QUALIFICATION' | 'POLICY' | 'TECHNOLOGY';
export const SIGNAL_WORD: Record<SignalClass, string> = {
  DEMAND: 'Demand inflection', BOTTLENECK: 'Supply bottleneck', UTILISATION: 'Capacity-utilisation inflection',
  QUALIFICATION: 'Qualification inflection', POLICY: 'Regulatory / geopolitical inflection', TECHNOLOGY: 'Technology substitution',
};

export interface Beneficiary { ticker: string; name: string; bucket: string; verify: string; large?: boolean }
export interface Industry {
  id: string; name: string; why: string;
  queries: string[];          // news searches (Google News)
  match: RegExp;              // a headline is about this industry
  exclude?: RegExp;           // zzz1238 — …unless it is really about this (e.g. chip "packaging" is not packaging)
  beneficiaries: Beneficiary[];
  us?: Beneficiary[];         // zzz1244 — US-listed suppliers (USA tab)
  usQueries?: string[];       // zzz1244 — extra searches for US news
}

const B = (ticker: string, name: string, bucket: string, verify: string, large = false): Beneficiary => ({ ticker, name, bucket, verify, large });

export const INDUSTRIES: Industry[] = [
  {
    id: 'class8-trucks', name: 'North American Class 8 trucks', why: 'Truck orders lead OEM builds, component schedules and supplier revenue by 2–4 quarters.',
    queries: ['Class 8 truck orders', 'Class 8 net orders FTR', 'ACT Research Class 8', 'heavy truck orders North America'],
    match: /\bclass\s*8\b|heavy[- ]duty truck|heavy truck orders|(?:ftr|act research).{0,40}(?:orders|builds|backlog)|truck (?:build|order)s?\b.{0,30}(?:north america|us)/i,
    us: [
      B('ALSN', 'Allison Transmission', 'Transmissions', 'Class 8 share of revenue, North America on-highway'),
      B('WNC', 'Wabash', 'Trailers', 'Trailer orders and backlog'),
      B('CVGI', 'Commercial Vehicle Group', 'Cab systems / seating', 'Class 8 build exposure'),
      B('DAN', 'Dana', 'Axles / drivetrain', 'Commercial-vehicle share of sales'),
      B('PCAR', 'PACCAR', 'Truck OEM (large)', 'Orders and builds', true),
      B('CMI', 'Cummins', 'Engines (large)', 'On-highway engine volumes', true),
    ],
    usQueries: ['Class 8 truck build backlog', 'heavy duty truck production US'],
    beneficiaries: [
      B('BHARATFORG', 'Bharat Forge', 'Forged components', 'Current North American CV revenue, Class 8 share, plant utilisation', true),
      B('MMFL', 'MM Forgings', 'Forged components', 'North American schedules, export mix, utilisation, incremental margin'),
      B('RKFORGE', 'Ramkrishna Forgings', 'Forged components', 'Actual Class 8 revenue and customer programme'),
      B('HAPPYFORGE', 'Happy Forgings', 'Forged components', 'Direct North American Class 8 exposure'),
      B('MOTHERSON', 'Samvardhana Motherson', 'Drivetrain / systems', 'Class 8 share of revenue (≈7% in FY24), dilution by other segments', true),
      B('SONACOMS', 'Sona BLW Precision', 'Drivetrain / precision', 'Component content per truck, CV mix', true),
      B('CIEINDIA', 'CIE Automotive India', 'Drivetrain / precision', 'CV mix and North American share'),
      B('UNIPARTS', 'Uniparts India', 'Castings / machined', 'Whether products go into Class 8 platforms'),
      B('ROLEXRINGS', 'Rolex Rings', 'Castings / machined', 'Truck exposure versus other end markets'),
      B('KALYANIFRG', 'Kalyani Forge', 'Castings / machined', 'Product fit and customer proof'),
      B('AUTOAXLES', 'Automotive Axles', 'Adjacent truck systems', 'Order conversion, exports'),
    ],
  },
  {
    id: 'grid', name: 'Power grid: transformers, switchgear, cables', why: 'Grid capex and data-centre power meet scarce transformer and switchgear capacity — lead times and prices rise.',
    queries: ['transformer shortage lead times', 'grid transformer demand India', 'switchgear backlog', 'power transmission capex India', 'data center power transformer demand'],
    match: /transformer|switchgear|substation|transmission line|grid (?:capex|investment|equipment|upgrade|congestion)|\bhvdc\b|power equipment|lead times?.{0,30}(?:transformer|grid|switchgear)/i,
    exclude: /transformer (?:model|architecture|network|neural)|\bLLMs?\b|language model|Transformers (?:movie|film|franchise|toys?)/i,   // zzz1244 — the AI model, not the machine
    us: [
      B('POWL', 'Powell Industries', 'Switchgear / power systems', 'Backlog, data-centre and utility mix'),
      B('MYRG', 'MYR Group', 'Transmission & distribution contractor', 'Backlog, margins'),
      B('AZZ', 'AZZ', 'Galvanizing / grid metal coatings', 'Utility volumes'),
      B('PRIM', 'Primoris', 'Utility / power EPC', 'Backlog by segment'),
      B('PWR', 'Quanta Services', 'Grid EPC (large)', 'Backlog', true),
      B('GEV', 'GE Vernova', 'Grid equipment (large)', 'Electrification orders', true),
      B('HUBB', 'Hubbell', 'Utility products (large)', 'Utility orders', true),
    ],
    usQueries: ['US transformer shortage utilities', 'switchgear lead times data center', 'grid equipment backlog US'],
    beneficiaries: [
      B('TARIL', 'Transformers & Rectifiers', 'Transformers', 'Order book, capacity additions, pricing, working capital'),
      B('SHILCTECH', 'Shilchar Technologies', 'Transformers', 'Export orders, capacity, margins'),
      B('VOLTAMP', 'Voltamp Transformers', 'Transformers', 'Utilisation, order inflow, pricing'),
      B('INDOTECH', 'Indo Tech Transformers', 'Transformers', 'Order book, capacity ramp'),
      B('MARINE', 'Marine Electricals', 'Switchgear / protection', 'Backlog, capacity, execution'),
      B('QPOWER', 'Quality Power Electrical', 'HVDC / grid equipment', 'Firm orders, execution, margins'),
      B('POWERINDIA', 'Hitachi Energy India', 'Transformers / HVDC', 'Order book and margin (large)', true),
      B('GVT&D', 'GE Vernova T&D India', 'Transformers / switchgear', 'Order book and margin (large)', true),
      B('APARINDS', 'Apar Industries', 'Conductors / cables', 'Conductor volumes, exports, margins', true),
      B('KEC', 'KEC International', 'Transmission EPC', 'Order inflow, execution, margins', true),
      B('SKIPPER', 'Skipper', 'Towers', 'Order book and capacity'),
    ],
  },
  {
    id: 'packaging', name: 'Packaging (paper, corrugated, flexible, glass, cans)', why: 'Packaging demand and prices move before converters\' margins — kraft paper, film, glass and can capacity is lumpy.',
    queries: ['packaging demand India', 'corrugated box prices', 'kraft paper prices India', 'flexible packaging film prices', 'glass packaging capacity India'],
    match: /packaging|corrugated|kraft paper|containerboard|\bboxboard\b|duplex board|bopet|bopp|flexible film|glass bottle|aluminium can|beverage can|paperboard/i,
    exclude: /semiconductor|\bchips?\b|cowos|\bosat\b|advanced packaging|wafer|\bhbm\b|substrate|tsmc|nvidia|\bintel\b|amkor|chiplet|foundry/i,
    us: [
      B('SON', 'Sonoco', 'Consumer / industrial packaging', 'Volumes and price'),
      B('GPK', 'Graphic Packaging', 'Paperboard packaging', 'Volumes and price'),
      B('GEF', 'Greif', 'Industrial packaging', 'Volumes, price'),
      B('OI', 'O-I Glass', 'Glass containers', 'Volumes, capacity'),
      B('SLGN', 'Silgan', 'Cans / closures', 'Volumes'),
      B('PKG', 'Packaging Corp of America', 'Containerboard (large)', 'Box shipments, price', true),
    ],
    usQueries: ['containerboard prices US', 'packaging demand US volumes'],
    beneficiaries: [
      B('TCPLPACK', 'TCPL Packaging', 'Paperboard cartons', 'Volumes, capacity, export mix'),
      B('MOLDTKPAC', 'Mold-Tek Packaging', 'Rigid plastic packaging', 'Customer additions, utilisation, margins'),
      B('PYRAMID', 'Pyramid Technoplast', 'Industrial packaging', 'Capacity and volumes'),
      B('EPL', 'EPL', 'Laminated tubes', 'Volume growth by region, margins'),
      B('AGI', 'AGI Greenpac', 'Glass containers', 'Capacity additions, pricing'),
      B('UFLEX', 'Uflex', 'Flexible packaging / film', 'Film prices and spreads'),
      B('COSMOFIRST', 'Cosmo First', 'BOPP / BOPET film', 'Spreads, specialty mix'),
      B('JKPAPER', 'JK Paper', 'Packaging board', 'Board prices and volumes'),
      B('ORIENTPPR', 'Orient Paper', 'Paper', 'Pricing, utilisation'),
      B('HUHTAMAKI', 'Huhtamaki India', 'Flexible packaging', 'Margins and volume growth'),
    ],
  },
  {
    id: 'aerospace', name: 'Aerospace components', why: 'Aircraft build-rate ramps and component shortages favour qualified suppliers with capacity.',
    queries: ['aerospace component shortage', 'Airbus production rate increase', 'Boeing production rate suppliers', 'aerospace supply chain India'],
    match: /aerospace|aero[- ]?engine|airbus.{0,30}(?:rate|production|deliveries)|boeing.{0,30}(?:rate|production|deliveries)|aircraft (?:parts|components|production)/i,
    us: [
      B('DCO', 'Ducommun', 'Aerostructures / electronics', 'Commercial build exposure'),
      B('ATRO', 'Astronics', 'Aircraft electrical systems', 'Orders, margins'),
      B('HXL', 'Hexcel', 'Composites', 'Build-rate exposure'),
      B('HWM', 'Howmet', 'Engine parts (large)', 'Engine spares, build rates', true),
      B('TDG', 'TransDigm', 'Components (large)', 'Aftermarket mix', true),
    ],
    usQueries: ['aerospace supplier shortage US', 'Boeing 737 production rate suppliers'],
    beneficiaries: [
      B('AZAD', 'Azad Engineering', 'Turbine / aero-engine parts', 'Programme qualification, orders, capacity'),
      B('MTARTECH', 'MTAR Technologies', 'Precision engineering', 'Aerospace orders, delivery ramp'),
      B('PTCIL', 'PTC Industries', 'Aerospace castings', 'Qualification, customer orders'),
      B('UNIMECH', 'Unimech Aerospace', 'Aero tooling / parts', 'Order pipeline, capacity'),
      B('DATAPATTNS', 'Data Patterns', 'Avionics / electronics', 'Firm contracts'),
    ],
  },
  {
    id: 'defence-europe', name: 'European defence procurement', why: 'Europe re-arming creates export orders for qualified Indian suppliers.',
    queries: ['European defence spending orders', 'NATO ammunition shortage', 'Europe defence procurement India exports'],
    match: /(?:europe|nato|eu)\b.{0,40}(?:defen[cs]e|ammunition|artillery|rearm)|ammunition shortage|defen[cs]e exports? India/i,
    us: [
      B('KTOS', 'Kratos', 'Drones / defence systems', 'Contract awards, production ramp'),
      B('AVAV', 'AeroVironment', 'Drones / loitering munitions', 'Orders, backlog'),
      B('MRCY', 'Mercury Systems', 'Defence electronics', 'Bookings, margins'),
      B('BWXT', 'BWX Technologies', 'Naval nuclear (large)', 'Backlog', true),
      B('NOC', 'Northrop Grumman', 'Prime (large)', 'Munitions programmes', true),
    ],
    usQueries: ['Pentagon munitions production contract', 'NATO drone orders'],
    beneficiaries: [
      B('DATAPATTNS', 'Data Patterns', 'Defence electronics', 'Export orders, execution'),
      B('ASTRAMICRO', 'Astra Microwave', 'Defence electronics', 'Order book, exports'),
      B('ZENTEC', 'Zen Technologies', 'Training systems', 'Export orders'),
      B('APOLLO', 'Apollo Micro Systems', 'Defence electronics', 'Orders, capacity'),
      B('SOLARINDS', 'Solar Industries', 'Ammunition / explosives', 'Export orders, capacity (large)', true),
      B('PARAS', 'Paras Defence', 'Optics / electronics', 'Orders and margins'),
    ],
  },
  {
    id: 'semis-packaging', name: 'Semiconductor packaging (OSAT)', why: 'Packaging capacity is a bottleneck; qualified Indian assembly and test entrants can get first orders.',
    queries: ['semiconductor packaging capacity', 'OSAT India plant', 'advanced packaging shortage CoWoS'],
    match: /\bosat\b|chip packaging|semiconductor (?:packaging|assembly)|advanced packaging|cowos/i,
    us: [
      B('AMKR', 'Amkor', 'OSAT', 'Advanced packaging revenue, utilisation'),
      B('KLIC', 'Kulicke & Soffa', 'Bonding equipment', 'Orders for advanced packaging'),
      B('ONTO', 'Onto Innovation', 'Inspection / lithography', 'Packaging-related orders'),
      B('CAMT', 'Camtek', 'Inspection', 'HBM / CoWoS orders'),
      B('FORM', 'FormFactor', 'Probe cards', 'HBM / advanced packaging demand'),
    ],
    usQueries: ['advanced packaging capacity US', 'CoWoS capacity equipment orders'],
    beneficiaries: [
      B('KAYNES', 'Kaynes Technology', 'OSAT / EMS', 'Commercial production, customers, yields', true),
      B('CGPOWER', 'CG Power', 'OSAT JV', 'Approved products, revenue', true),
      B('MOSCHIP', 'MosChip Technologies', 'Chip design', 'Design wins'),
      B('SPEL', 'SPEL Semiconductor', 'Assembly / test', 'Utilisation and customers'),
    ],
  },
  {
    id: 'rail', name: 'Railway components and wagons', why: 'Rail capex and component replacement cycles drive wagon, wheel and forging orders.',
    queries: ['railway wagon orders India', 'Vande Bharat orders suppliers', 'railway component replacement demand'],
    match: /wagon|rolling stock|railway (?:component|order|capex)|vande bharat|locomotive orders?/i,
    us: [
      B('GBX', 'Greenbrier', 'Railcars', 'Orders, backlog, margins'),
      B('TRN', 'Trinity Industries', 'Railcars / leasing', 'Orders, lease rates'),
      B('FSTR', 'L.B. Foster', 'Rail products', 'Rail segment orders'),
      B('RAIL', 'FreightCar America', 'Railcars', 'Orders, capacity'),
      B('WAB', 'Wabtec', 'Rail equipment (large)', 'Backlog', true),
    ],
    usQueries: ['railcar orders backlog North America', 'railcar deliveries US'],
    beneficiaries: [
      B('RKFORGE', 'Ramkrishna Forgings', 'Wheels / forgings', 'Rail contracts and delivery'),
      B('TITAGARH', 'Titagarh Rail Systems', 'Wagons / coaches', 'Order execution, margins'),
      B('JWL', 'Jupiter Wagons', 'Wagons / components', 'Order book, capacity'),
      B('TEXRAIL', 'Texmaco Rail', 'Wagons', 'Order inflow and margins'),
    ],
  },
  {
    id: 'automation', name: 'Industrial automation and machine tools', why: 'Capex upcycles fill machine-tool order books; operating leverage follows utilisation.',
    queries: ['machine tool orders India', 'CNC machine demand India', 'industrial automation demand'],
    match: /machine tools?|cnc machines?|industrial automation|factory automation|robotics orders/i,
    us: [
      B('HURC', 'Hurco', 'Machine tools', 'Orders, utilisation'),
      B('KMT', 'Kennametal', 'Tooling', 'Industrial volumes'),
      B('CGNX', 'Cognex', 'Machine vision', 'Orders by end market'),
      B('SYM', 'Symbotic', 'Warehouse automation (large)', 'Backlog', true),
      B('ROK', 'Rockwell Automation', 'Automation (large)', 'Orders', true),
    ],
    usQueries: ['machine tool orders US USMTO', 'factory automation orders US'],
    beneficiaries: [
      B('JYOTICNC', 'Jyoti CNC Automation', 'CNC machines', 'Order intake, utilisation, margin'),
      B('LMW', 'Lakshmi Machine Works', 'Textile machinery / machine tools', 'Order book, capex cycle'),
      B('ACE', 'Action Construction Equipment', 'Construction machinery', 'Volumes and pricing'),
    ],
  },
  {
    id: 'water', name: 'Water treatment and desalination', why: 'Municipal and industrial water capex lifts EPC and membrane suppliers.',
    queries: ['desalination plant order India', 'water treatment capex India'],
    match: /desalination|water treatment|wastewater|sewage treatment|\bstp\b/i,
    us: [
      B('ERII', 'Energy Recovery', 'Desalination devices', 'Mega-project orders'),
      B('MWA', 'Mueller Water', 'Water infrastructure', 'Volumes, pricing'),
      B('BMI', 'Badger Meter', 'Smart water meters', 'Utility orders'),
      B('WTS', 'Watts Water', 'Water products (large)', 'Volumes', true),
      B('XYL', 'Xylem', 'Water technology (large)', 'Orders', true),
    ],
    usQueries: ['desalination contract US', 'water infrastructure spending US'],
    beneficiaries: [
      B('WABAG', 'VA Tech Wabag', 'Water EPC', 'Order quality, margins, cash conversion'),
      B('IONEXCHANG', 'Ion Exchange', 'Water treatment / chemicals', 'Orders and margins'),
      B('EMSLIMITED', 'EMS Ltd', 'Water / sewage EPC', 'Order book and receivables'),
    ],
  },
  {
    id: 'bearings', name: 'Precision bearings', why: 'Industrial and EV demand plus import substitution favour domestic bearing makers.',
    // zzz1241 — the two narrow searches found nothing in 90 days: search the industry and its makers by name.
    queries: ['bearing demand India exports', 'precision bearings shortage', 'bearings industry India', 'NRB Bearings', 'SKF India bearings', 'Timken India', 'bearing manufacturer capacity India'],
    match: /\bbearings\b(?!.{0,6}\bon\b)|\bbearing (?:maker|manufacturer|industry|demand|exports?|plant|capacity|business|segment)s?\b|\b(?:NRB|SKF|Timken|Schaeffler)\b/i,
    exclude: /\bbearing the brunt\b|\b(?:has|have|had) (?:a|no|any) bearing\b|\bbearings? (?:of|on) (?:the|this|that)\b/i,
    us: [
      B('TKR', 'Timken', 'Bearings / power transmission', 'Industrial demand, pricing'),
      B('NNBR', 'NN Inc', 'Precision components', 'Orders, margins'),
      B('RBC', 'RBC Bearings', 'Bearings (large)', 'Aerospace / industrial mix', true),
    ],
    usQueries: ['bearings demand US industrial', 'RBC Bearings orders'],
    beneficiaries: [
      B('NRBBEARING', 'NRB Bearings', 'Bearings', 'End-market mix, exports, margins'),
      B('SKFINDIA', 'SKF India', 'Bearings', 'Industrial demand (large)', true),
      B('TIMKEN', 'Timken India', 'Bearings', 'Exports, rail (large)', true),
    ],
  },
  {
    id: 'shipping', name: 'Shipping and freight rates', why: 'Freight rates move ship-owner and port earnings fast; sustained rates change economics.',
    queries: ['tanker rates surge', 'container freight rates rise', 'dry bulk rates Baltic index'],
    match: /freight rates?|tanker rates?|baltic dry|container rates?|charter rates?|shipping rates?/i,
    us: [
      B('ZIM', 'ZIM', 'Container shipping', 'Spot-rate exposure'),
      B('DAC', 'Danaos', 'Container ship leasing', 'Charter rates'),
      B('GSL', 'Global Ship Lease', 'Container ship leasing', 'Charter cover'),
      B('STNG', 'Scorpio Tankers', 'Product tankers', 'Rate exposure'),
      B('INSW', 'International Seaways', 'Tankers', 'Rate exposure'),
      B('SBLK', 'Star Bulk', 'Dry bulk', 'Rate exposure'),
      B('MATX', 'Matson', 'Shipping / logistics', 'Rates and volumes'),
    ],
    usQueries: ['container shipping rates US', 'tanker rates record'],
    beneficiaries: [
      B('GESHIP', 'Great Eastern Shipping', 'Tankers / dry bulk', 'Rate exposure, fleet'),
      B('SCI', 'Shipping Corp of India', 'Shipping', 'Fleet and charters'),
      B('SEAMECLTD', 'Seamec', 'Offshore vessels', 'Charter rates'),
    ],
  },
  {
    id: 'oil-gas-capex', name: 'Offshore oil & gas capex', why: 'Offshore project awards fill drilling, gas-compression and specialised engineering order books.',
    queries: ['offshore oil gas capex awards', 'ONGC drilling contract awarded', 'gas compression contract India'],
    match: /offshore (?:drilling|rig|project|capex)|drilling contract|rig rates?|gas compression|upstream capex/i,
    us: [
      B('RIG', 'Transocean', 'Offshore drilling', 'Day rates, backlog'),
      B('VAL', 'Valaris', 'Offshore drilling', 'Contracts, utilisation'),
      B('NE', 'Noble', 'Offshore drilling', 'Contracts'),
      B('TDW', 'Tidewater', 'Offshore vessels', 'Day rates'),
      B('OII', 'Oceaneering', 'Subsea services', 'Backlog'),
    ],
    usQueries: ['offshore rig day rates', 'offshore drilling contract awarded'],
    beneficiaries: [
      B('DEEPINDS', 'Deep Industries', 'Gas compression / drilling', 'Contracts, rig utilisation'),
      B('JINDRILL', 'Jindal Drilling', 'Offshore rigs', 'Day rates, contracts'),
      B('MTARTECH', 'MTAR Technologies', 'Specialised engineering', 'Project content'),
    ],
  },
];

// ── reading one headline ─────────────────────────────────────────────────────

export interface SignalRead {
  classes: SignalClass[];
  yoy: number | null; mom: number | null; pct: number | null;
  record: boolean; consecutive: number | null; multiYear: boolean; aboveAverage: boolean; negative: boolean;
}

const pctNear = (t: string, re: RegExp): number | null => { const m = t.match(re); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };

export function readSignal(text: string): SignalRead {
  const t = text.replace(/\s+/g, ' ');
  const classes = new Set<SignalClass>();
  if (/\b(orders?|bookings?|demand|backlog|shipments?|sales|consumption|volumes?|builds?)\b.{0,50}\b(?:surge|soar|jump|rise|rose|up|climb|record|accelerat|strong|double|tripl)|\b(?:surge|soar|jump|record|strong)\w*\b.{0,40}\b(orders?|demand|bookings?|backlog)/i.test(t)) classes.add('DEMAND');
  // zzz1238 — a won order / contract is demand too (rail, defence, grid headlines are mostly worded this way)
  if (/\b(?:bags?|bagged|bagging|wins?|won|winning|secures?|secured|securing|receives?|received|bags|awarded|lands?|landed)\b.{0,50}\b(?:orders?|contracts?|tenders?|work orders?|loa)\b|\b(?:orders?|contracts?) (?:worth|valued at|of) (?:rs\.?|₹|inr|usd|\$)/i.test(t)) classes.add('DEMAND');
  if (/shortage|bottleneck|lead[- ]times?|sold out|supply (?:crunch|constraint|tight)|tight supply|allocation|wait(?:ing)? (?:list|times?)|scarce|capacity constraint/i.test(t)) classes.add('BOTTLENECK');
  if (/utili[sz]ation|second shift|third shift|running (?:at )?full|full capacity|capacity additions?|debottleneck|ramp(?:s|ed|ing)? up|production rate (?:increase|hike)|rate increase/i.test(t)) classes.add('UTILISATION');
  if (/qualif(?:ied|ication)|approved (?:vendor|supplier)|certif(?:ied|ication)|first (?:order|commercial)|new customer|platform win|design win|nominated/i.test(t)) classes.add('QUALIFICATION');
  if (/tariffs?|anti[- ]dumping|duty|sanction|ban on imports?|import (?:curbs?|restriction)|pli\b|subsid|regulation|mandate|epa 20\d\d|emission rules?|china plus one|reshoring|nearshoring/i.test(t)) classes.add('POLICY');
  if (/replac(?:e|es|ing) .{0,30}(?:technology|legacy)|shift(?:s|ing)? to|transition to|adoption of|new architecture|next[- ]gen/i.test(t)) classes.add('TECHNOLOGY');
  const yoy = pctNear(t, /(\d{1,4}(?:\.\d+)?)\s?%\s*(?:yoy|y-o-y|year[- ]on[- ]year|year[- ]over[- ]year|from a year (?:ago|earlier)|versus last year)/i)
    ?? pctNear(t, /(?:up|rose|jump(?:ed)?|surg(?:ed|es)|climb(?:ed)?|grew)\s+(\d{1,4}(?:\.\d+)?)\s?%\s+(?:from|over|versus|compared)\s+(?:a year|last year|the year)/i);
  const mom = pctNear(t, /(\d{1,3}(?:\.\d+)?)\s?%\s*(?:mom|m-o-m|month[- ]on[- ]month|month[- ]over[- ]month|sequentially|from (?:april|may|june|july|august|september|october|november|december|january|february|march))/i);
  const pct = yoy ?? pctNear(t, /(?:up|rose|jump(?:ed|s)?|surg(?:ed|es)|soar(?:ed|s)?|climb(?:ed|s)?|grew|rise|increase(?:d)?)\s+(?:by\s+)?(\d{1,4}(?:\.\d+)?)\s?%/i);
  const consecutive = (() => { const m = t.match(/\b(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(?:st|nd|rd|th))\s+(?:straight|consecutive|successive)/i); if (!m) return null; const w = ['second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']; const i = w.indexOf(m[1].toLowerCase()); return i >= 0 ? i + 2 : parseInt(m[1], 10) || null; })();
  return {
    classes: Array.from(classes), yoy, mom, pct,
    record: /\brecord\b|all[- ]time high|highest (?:since|in|ever)/i.test(t), consecutive,
    multiYear: /multi[- ]year|structural|decade|years? of backlog|through 20\d\d|supercycle|long[- ]term/i.test(t),
    aboveAverage: /above (?:the )?(?:\d+[- ]year )?(?:average|norm)|(?:\d+)% above/i.test(t),
    negative: /\b(fall|fell|drop|decline|slump|plunge|cancel|weak|slow(?:down)?|cut)s?\b/i.test(t) && !/\b(?:surge|record|jump|soar|rise)\b/i.test(t),
  };
}

export interface ScoredSignal {
  industry: string; headline: string; url: string | null; source: string | null; at: string;
  read: SignalRead; score: number; parts: Record<'magnitude' | 'acceleration' | 'duration' | 'eps' | 'neglect' | 'bottleneck', number>; reasons: string[];
}

const clamp = (v: number) => Math.max(0, Math.min(10, v));

/**
 * The framework's weighted score. `neglect` (0–10) comes from the beneficiaries' prices (weak prices = more neglected),
 * `smallCount` = small / mid beneficiaries mapped. Returns null when the headline carries no signal at all.
 */
export function scoreSignal(read: SignalRead, ctx: { neglect: number | null; smallCount: number }): { score: number; parts: ScoredSignal['parts']; reasons: string[] } | null {
  if (!read.classes.length && read.pct == null && !read.record) return null;
  if (read.negative) return null;
  const reasons: string[] = [];
  const mag = read.pct != null ? clamp(read.pct >= 100 ? 9 : read.pct >= 50 ? 8 : read.pct >= 25 ? 6 : read.pct >= 10 ? 4 : 2) : read.record ? 6 : read.classes.includes('BOTTLENECK') ? 5 : 3;
  if (read.pct != null) reasons.push(`+${read.pct}%${read.yoy != null ? ' YoY' : ''}`);
  if (read.record) reasons.push('record / multi-year high');
  const acc = clamp((read.mom != null && read.mom > 0 ? 5 : 0) + (read.consecutive ? Math.min(5, read.consecutive) : 0) + (read.yoy != null && read.mom != null ? 1 : 0) + (read.aboveAverage ? 2 : 0) || (read.classes.includes('DEMAND') ? 3 : 2));
  if (read.mom != null) reasons.push(`+${read.mom}% sequential`);
  if (read.consecutive) reasons.push(`${read.consecutive} periods in a row`);
  const dur = clamp((read.multiYear ? 7 : 3) + (read.consecutive && read.consecutive >= 3 ? 2 : 0) + (read.classes.includes('POLICY') ? 1 : 0));
  if (read.multiYear) reasons.push('multi-year / structural wording');
  const eps = clamp(ctx.smallCount >= 5 ? 8 : ctx.smallCount >= 3 ? 6 : ctx.smallCount >= 1 ? 4 : 1);
  const neglect = clamp(ctx.neglect ?? 5);
  const bott = clamp((read.classes.includes('BOTTLENECK') ? 7 : 2) + (read.classes.includes('QUALIFICATION') ? 2 : 0) + (read.classes.includes('UTILISATION') ? 1 : 0));
  if (read.classes.includes('BOTTLENECK')) reasons.push('supply is the constraint');
  const parts = { magnitude: mag, acceleration: acc, duration: dur, eps, neglect, bottleneck: bott };
  const score = Math.round((mag * 20 + acc * 15 + dur * 15 + eps * 20 + neglect * 15 + bott * 15) / 10);
  return { score, parts, reasons };
}

export function scoreBand(score: number): { label: string; action: string } {
  if (score >= 90) return { label: 'Exceptional abnormality', action: 'Prioritise deep research; still needs company and valuation proof.' };
  if (score >= 70) return { label: 'Strong signal', action: 'Start company-level financial and competitive work.' };
  if (score >= 40) return { label: 'Potentially relevant', action: 'Map the industry; look for confirming data.' };
  return { label: 'Weak / unproven', action: 'Monitor; no deep research yet.' };
}

/** How neglected the beneficiaries look from their prices: weak 3-month returns = more neglected (0–10). */
export function neglectFromPrices(perf3m: Array<number | null | undefined>): number | null {
  const v = perf3m.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  const s = v.slice().sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  return clamp(med <= -10 ? 9 : med <= 0 ? 7 : med <= 10 ? 5 : med <= 25 ? 3 : 1);
}

/** Which industries a headline is about. */
export function industriesOf(text: string): string[] {
  return INDUSTRIES.filter((i) => i.match.test(text) && !(i.exclude && i.exclude.test(text))).map((i) => i.id);
}

/** zzz1238 — our own alert / summary lines ("[STRUCTURAL ALERT] …") are not news. */
export const isSyntheticHeadline = (t: string) => /^\s*\[[^\]]{2,40}\]/.test(t) || /^\s*(?:structural alert|bottleneck alert)\b/i.test(t);

/** zzz1238 — older news counts less: ≤ 14 days in full, ≤ 30 days 90%, ≤ 60 days 75%, older 60%. */
export function recencyWeight(ageDays: number): number {
  return ageDays <= 14 ? 1 : ageDays <= 30 ? 0.9 : ageDays <= 60 ? 0.75 : 0.6;
}

/**
 * zzz1238 — an industry's score: its best (recency-weighted) signal plus up to 12 points for OTHER recent signals that
 * confirm it (each a different headline of at least 40 within 60 days, 3 points each). One loud headline alone is not an inflection.
 */
export function industryScore(signals: ReadonlyArray<{ score: number; ageDays: number; headline: string }>): { top: number; confirmations: number } {
  if (!signals.length) return { top: 0, confirmations: 0 };
  const best = signals.reduce((a, b) => (b.score > a.score ? b : a));
  const confirmations = signals.filter((s) => s !== best && s.score >= 40 && s.ageDays <= 60).length;
  return { top: Math.min(100, best.score + Math.min(12, confirmations * 3)), confirmations };
}

/** The framework's incremental-EPS sensitivity (bear / base / bull). Revenue in ₹ crore; shares in crore. */
export function epsSensitivity(exposedRevenue: number, sharesCr: number | null, tax = 0.25): Array<{ case: 'Bear' | 'Base' | 'Bull'; growth: number; margin: number; pat: number; eps: number | null }> {
  return ([['Bear', 0, 0.15], ['Base', 0.10, 0.20], ['Bull', 0.20, 0.25]] as const).map(([c, g, m]) => {
    const pat = exposedRevenue * g * m * (1 - tax);
    return { case: c, growth: g, margin: m, pat, eps: sharesCr && sharesCr > 0 ? pat / sharesCr : null };
  });
}

/**
 * zzz1241 — near-identical headlines (the same story from several outlets, e.g. two Zetwerk pieces) are ONE signal.
 * Word sets of the headline (outlet suffix removed) with Jaccard ≥ 0.55, or one containing ≥ 80% of the shorter one's
 * words, merge; the highest-scoring copy is kept and `sources` counts the copies. Input best first.
 */
export function headlineWords(h: string): Set<string> {
  const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'as', 'at', 'by', 'with', 'from', 'is', 'its', 'it', 'be', 'are', 'has', 'have', 'will', 'says', 'said']);
  return new Set(h.toLowerCase().replace(/\s+[-|–]\s+[^-|–]{2,40}$/, '').replace(/[^a-z0-9%]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
}
export function sameStory(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  let both = 0; for (const w of a) if (b.has(w)) both++;
  const union = a.size + b.size - both;
  return both / union >= 0.55 || (Math.min(a.size, b.size) >= 4 && both / Math.min(a.size, b.size) >= 0.8);
}
export function dedupeSignals<T extends { headline: string }>(best: ReadonlyArray<T>): Array<T & { sources: number }> {
  const out: Array<T & { sources: number }> = []; const words: Set<string>[] = [];
  for (const s of best) {
    const w = headlineWords(s.headline);
    const i = words.findIndex((x) => sameStory(x, w));
    if (i >= 0) { out[i].sources++; continue; }
    out.push({ ...s, sources: 1 }); words.push(w);
  }
  return out;
}

/** zzz1244 — one company's quarterly results are company news, not an industry signal (Timken India's Q2 had topped bearings). */
export const isCompanyResultsHeadline = (t: string) =>
  /\b(?:Q[1-4]|first|second|third|fourth)[- ]?(?:quarter|qtr)?\s*(?:FY\s*)?'?(?:\d{2,4}\s*)?:?\s*(?:results?|earnings)\b|\bearnings beat\b|\bresults?:|\b(?:net )?profit (?:jumps|rises|falls|surges|up|down|grows)|\bPAT (?:jumps|rises|up|falls|grows)|\bbeats? (?:estimates|expectations)\b/i.test(t);
