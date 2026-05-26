// PATCH 0888 — Hardcoded NSE ticker → company name map for the most
// common smallcap / midcap names that show up in Movers / Earnings /
// News attribution. The user audit (BLISSGVS, MARKSANS, ASTRAMICRO)
// proved that searching news by raw ticker symbol misses every major
// outlet, because articles use the long-form name. This map gives
// the news pipeline an authoritative answer for the top movers
// without depending on whether the user has uploaded a CSV containing
// that ticker.
//
// Curate conservatively: only tickers we are confident about. The
// engine still falls back to a heuristic split when this map misses.
//
// To extend: add tickers in `NSE_TICKER_NAMES`. Keys are the bare NSE
// symbol (no .NS suffix), values are the marketing/long-form name as
// it appears in news headlines and Screener listings.

export const NSE_TICKER_NAMES: Record<string, string> = {
  // ── pharma ────────────────────────────────────────────────────
  BLISSGVS: 'Bliss GVS Pharma',
  MARKSANS: 'Marksans Pharma',
  GUFICBIO: 'Gufic BioSciences',
  NGLFINE: 'NGL Fine-Chem',
  AUROPHARMA: 'Aurobindo Pharma',
  LUPIN: 'Lupin',
  DRREDDY: 'Dr Reddys Laboratories',
  CIPLA: 'Cipla',
  SUNPHARMA: 'Sun Pharma',
  TORNTPHARM: 'Torrent Pharma',
  ALKEM: 'Alkem Laboratories',
  GLAND: 'Gland Pharma',
  NEULANDLAB: 'Neuland Laboratories',
  BLISSGVSPHA: 'Bliss GVS Pharma',
  SOLARA: 'Solara Active Pharma',
  SENORES: 'Senores Pharmaceuticals',
  SAKAR: 'Sakar Healthcare',
  ACUTAAS: 'Acutaas Chemicals',
  ANUPAMRAS: 'Anupam Rasayan',
  AARTIIND: 'Aarti Industries',
  NAVINFLUOR: 'Navin Fluorine International',

  // ── defence / capital goods / industrials ─────────────────────
  ASTRAMICRO: 'Astra Microwave Products',
  DATAPATTNS: 'Data Patterns',
  HAL: 'Hindustan Aeronautics',
  BEL: 'Bharat Electronics',
  BEML: 'BEML',
  COCHINSHIP: 'Cochin Shipyard',
  MAZDOCK: 'Mazagon Dock',
  GRSE: 'Garden Reach Shipbuilders',
  HBLENGINE: 'HBL Engineering',
  CUMMINSIND: 'Cummins India',
  ESABINDIA: 'Esab India',
  HAPPYFORGE: 'Happy Forgings',
  TIMKEN: 'Timken India',
  GRINDWELL: 'Grindwell Norton',
  BOSCHLTD: 'Bosch',
  SIEMENS: 'Siemens India',
  ABB: 'ABB India',
  THERMAX: 'Thermax',
  TRITURBINE: 'Triveni Turbine',
  AJAXENGG: 'Ajax Engineering',
  NELCAST: 'Nelcast',
  GOPAL: 'Gopal Snacks',
  JNKINDIA: 'JNK India',

  // ── textiles / consumer / retail ───────────────────────────────
  RUBYMILLS: 'Ruby Mills',
  PAGEIND: 'Page Industries',
  TRENT: 'Trent',
  DMART: 'Avenue Supermarts',
  TITAN: 'Titan Company',
  COLPAL: 'Colgate-Palmolive India',
  NESTLEIND: 'Nestle India',
  HUL: 'Hindustan Unilever',
  BAJAJCON: 'Bajaj Consumer Care',
  THANGAMAYL: 'Thangamayil Jewellery',
  CUPID: 'Cupid',
  KDDL: 'KDDL',

  // ── cables / electricals / power ───────────────────────────────
  CORDSCABLE: 'Cords Cable Industries',
  HFCL: 'HFCL',
  STLTECH: 'Sterlite Technologies',
  POLYCAB: 'Polycab India',
  KEC: 'KEC International',
  KEI: 'KEI Industries',
  RRKABEL: 'R R Kabel',
  PRAJIND: 'Praj Industries',
  IOLCP: 'IOL Chemicals',
  IRINFRA: 'IRCON International',

  // ── construction / EPC / capex ─────────────────────────────────
  PSPPROJECT: 'PSP Projects',
  WELCORP: 'Welspun Corp',
  JTLIND: 'JTL Industries',
  KALPATARU: 'Kalpataru Projects',
  SAMBHV: 'Sambhv Steel Tubes',
  JINDALSTEL: 'Jindal Steel',
  SAIL: 'Steel Authority',
  TATASTEEL: 'Tata Steel',

  // ── auto components ────────────────────────────────────────────
  MINDACORP: 'Minda Corporation',
  LUMAXIND: 'Lumax Industries',
  LUMAXTECH: 'Lumax Auto Technologies',
  BHARATFORG: 'Bharat Forge',
  MAHINDCIE: 'Mahindra CIE Automotive',
  AUTOIND: 'Autoline Industries',
  PRICOLLTD: 'Pricol',
  HARSHA: 'Harsha Engineers International',
  BAJAJAUTO: 'Bajaj Auto',
  'BAJAJ-AUTO': 'Bajaj Auto',

  // ── chemicals / specialty ──────────────────────────────────────
  ARFIN: 'Arfin India',
  CLSEL: 'Chaman Lal Setia Exports',
  MODINATUR: 'Modi Naturals',
  KRISHANA: 'Krishana Phoschem',
  YASHO: 'Yasho Industries',
  GEECEE: 'Geecee Ventures',
  GOACARBON: 'Goa Carbon',
  ATLANTAELE: 'Atlanta Electricals',
  AKI: 'AKI India',

  // ── metals & mining ────────────────────────────────────────────
  LLOYDSME: 'Lloyds Metals and Energy',
  LLOYDSENT: 'Lloyds Enterprises',
  HINDCOPPER: 'Hindustan Copper',
  ASHOKAMET: 'Ashoka Metcast',
  VEDL: 'Vedanta',
  NMDC: 'NMDC',
  NALCO: 'National Aluminium',
  HINDALCO: 'Hindalco Industries',
  RATNAMANI: 'Ratnamani Metals',
  SHYAMMETL: 'Shyam Metalics',

  // ── finance / capital markets ──────────────────────────────────
  AIIL: 'Authum Investment',
  GEECEEV: 'Geecee Ventures',
  ARSHIYA: 'Arshiya',
  SATIN: 'Satin Creditcare Network',
  BAJFINANCE: 'Bajaj Finance',
  BAJAJFINSV: 'Bajaj Finserv',
  HDFCBANK: 'HDFC Bank',
  ICICIBANK: 'ICICI Bank',
  AXISBANK: 'Axis Bank',
  KOTAKBANK: 'Kotak Mahindra Bank',
  SBIN: 'State Bank of India',

  // ── oil & gas / power utility ──────────────────────────────────
  ATGL: 'Adani Total Gas',
  IGL: 'Indraprastha Gas',
  MGL: 'Mahanagar Gas',
  IOC: 'Indian Oil',
  ONGC: 'Oil and Natural Gas',
  RELIANCE: 'Reliance Industries',
  GAIL: 'GAIL India',
  NTPC: 'NTPC',
  POWERGRID: 'Power Grid Corporation',
  TATAPOWER: 'Tata Power',
  CESC: 'CESC',
  PGINVIT: 'Powergrid Infrastructure Investment Trust',

  // ── tech ───────────────────────────────────────────────────────
  TCS: 'Tata Consultancy Services',
  INFY: 'Infosys',
  WIPRO: 'Wipro',
  HCLTECH: 'HCL Technologies',
  KPITTECH: 'KPIT Technologies',
  RVNL: 'Rail Vikas Nigam',
  RAILTEL: 'RailTel Corporation',
  DIXON: 'Dixon Technologies',

  // ── infra / real estate ────────────────────────────────────────
  SOBHA: 'Sobha',
  KALPATARUPL: 'Kalpataru Power Transmission',
  ATALREAL: 'Atal Realtech',
  SMARTLINK: 'Smartlink Holdings',
  AURUM: 'Aurum PropTech',
  ANTHEM: 'Anthem Biosciences',

  // ── selected smallcaps seen in user's NGL audit ─────────────────
  OMAXAUTO: 'Omax Autos',
  ONDOOR: 'On Door Concepts',
  SHRINIWAS: 'Shri Niwas Leasing and Finance',
  TAINWALA: 'Tainwala Chemicals',
  SBCL: 'Shivalik Bimetal',
  BHAGYANGR: 'Bhagyanagar India',
  DEEPINDS: 'Deep Industries',
  MOLDTECH: 'Mold-Tek Technologies',
  VALIANTLAB: 'Valiant Laboratories',
  VENKEYS: 'Venkys India',
  NRAIL: 'N R Agarwal Industries',
  SAHYADRI: 'Sahyadri Industries',
  ARIS: 'Arisinfra Solutions',
  INDOTHAI: 'Indo Thai Securities',
  EBGNG: 'GNG Electronics',
  CALSOFT: 'California Software Company',
  PANACHE: 'Panache Digilife',
  BLUESTONE: 'BlueStone Jewellery and Lifestyle',
  MEESHO: 'Meesho',
  AVROIND: 'Avro India',
  BIRLAPREC: 'Birla Precision Technologies',
  SAGARDEEP: 'Sagardeep Alloys',
  CRIZAC: 'Crizac',
  VIKRAN: 'Vikran Engineering',
  PROSTARM: 'Prostarm Info Systems',
  AJMERA: 'Ajmera Realty',
  SATIA_IND: 'Satia Industries',
  GODAVARIB: 'Godavari Biorefineries',
  POCL: 'Pondy Oxides and Chemicals',
  PRECAM: 'Precision Camshafts',
  CONCOR: 'Container Corporation of India',
  TECHNOE: 'Techno Electric',
  SANSTAR: 'Sanstar',
  LEMERITE: 'Le Merite Exports',
  ACL: 'Andhra Cements',
  BLSE: 'BLS E-Services',
  MTARTECH: 'MTAR Technologies',
  BLISSGVSPHARMA: 'Bliss GVS Pharma',
};

/**
 * Resolve a NSE ticker symbol to a long-form company name suitable for
 * news search. Returns the input ticker if no mapping found.
 */
export function resolveTickerName(ticker: string): string {
  if (!ticker) return '';
  const t = ticker.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  return NSE_TICKER_NAMES[t] || t;
}

// PATCH 0901 — Reverse map: company name → ticker. Used by the home-page
// Super Investors panel where the API returns a company-name string in
// the ticker field (live flow rows aren't keyed on NSE symbols).
// Build lazily once; case- and punctuation-insensitive.
let _REVERSE_NAME_MAP: Record<string, string> | null = null;
function getReverseNameMap(): Record<string, string> {
  if (_REVERSE_NAME_MAP) return _REVERSE_NAME_MAP;
  const out: Record<string, string> = {};
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [ticker, name] of Object.entries(NSE_TICKER_NAMES)) {
    out[norm(name)] = ticker;
    // Also index a "stripped" form without common suffixes
    const stripped = name.replace(/\s+(Limited|Ltd\.?|Industries|India|Pharma|Pharmaceuticals|Capital|Corporation|Corp\.?|Company|Co\.?|Technologies|Tech)\s*$/i, '');
    out[norm(stripped)] = ticker;
  }
  // Hardcoded common Super Investor flow company names that aren't in
  // NSE_TICKER_NAMES yet (avoid bloating the main map; these are
  // marquee-investor names that show up specifically on the home-page
  // flow rail).
  const FLOW_EXTRAS: Record<string, string> = {
    'sammaancapital':       'SAMMAANCAP',
    'sammaan capital':      'SAMMAANCAP',
    'tvtodaynetwork':       'TVTODAY',
    'tv today network':     'TVTODAY',
    'nazara':               'NAZARA',
    'nazaratechnologies':   'NAZARA',
    'jbchemicalspharma':    'JBCHEPHARM',
    'jbchemicals':          'JBCHEPHARM',
    'jbchemicalsandpharma': 'JBCHEPHARM',
    'jb chemicals & pharma':'JBCHEPHARM',
    'polymedicure':         'POLYMED',
    'relaxofootwears':      'RELAXO',
    'pidilite':             'PIDILITIND',
    'pidiliteindustries':   'PIDILITIND',
    'asianpaints':          'ASIANPAINT',
    'bajajfinance':         'BAJFINANCE',
    'titancompany':         'TITAN',
  };
  for (const [k, v] of Object.entries(FLOW_EXTRAS)) {
    out[norm(k)] = v;
  }
  _REVERSE_NAME_MAP = out;
  return out;
}

/**
 * PATCH 0901 — Reverse-resolve: company name → NSE ticker. Returns
 * undefined when no mapping exists. Used by the home-page Super
 * Investors panel to align flow rows (company-name only) with roster
 * rows (ticker + company).
 */
export function resolveCompanyToTicker(companyName: string): string | undefined {
  if (!companyName) return undefined;
  const norm = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm) return undefined;
  return getReverseNameMap()[norm];
}

/**
 * True if we have an explicit mapping for this ticker (vs falling back
 * to the ticker symbol itself).
 */
export function hasTickerName(ticker: string): boolean {
  if (!ticker) return false;
  const t = ticker.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  return t in NSE_TICKER_NAMES;
}
