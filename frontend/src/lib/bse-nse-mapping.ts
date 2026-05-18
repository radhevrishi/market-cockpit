// ═══════════════════════════════════════════════════════════════════════════
// BSE → NSE TICKER MAPPING (PATCH 0486)
//
// The site occasionally renders raw BSE codes (e.g., 526612, 540198, 514330)
// instead of NSE symbols, which makes scans unreadable. This helper resolves
// either form to a canonical { nseSymbol, bseCode, name } record so every
// surface can render the friendly ticker + name with the same call.
//
// Coverage is intentionally curated — the highest-frequency BSE codes seen
// across our screeners. New mappings get appended as the QA team flags them.
// ═══════════════════════════════════════════════════════════════════════════

export interface TickerInfo {
  nseSymbol: string;     // canonical NSE symbol (e.g., 'BLUEDART')
  bseCode: string;       // numeric BSE script code (e.g., '526612')
  shortName: string;     // display-friendly short name (e.g., 'Blue Dart Express')
}

const ENTRIES: TickerInfo[] = [
  { nseSymbol: 'BLUEDART',   bseCode: '526612', shortName: 'Blue Dart Express' },
  { nseSymbol: 'GLOBUSSPR',  bseCode: '526371', shortName: 'Globus Spirits' },
  { nseSymbol: 'AELEACOM',   bseCode: '544213', shortName: 'Aelea Commodities' },
  { nseSymbol: 'OSWALAGRO',  bseCode: '506260', shortName: 'Oswal Agro Mills' },
  { nseSymbol: 'TRIVENI',    bseCode: '532356', shortName: 'Triveni Engineering' },
  { nseSymbol: 'AARTIIND',   bseCode: '524208', shortName: 'Aarti Industries' },
  { nseSymbol: 'NEULAND',    bseCode: '524558', shortName: 'Neuland Laboratories' },
  { nseSymbol: 'GUJTHEM',    bseCode: '526729', shortName: 'Gujarat Themis Biosyn' },
  { nseSymbol: 'XPROINDIA',  bseCode: '590013', shortName: 'Xpro India' },
  { nseSymbol: 'BEEKAYSTL',  bseCode: '539018', shortName: 'Beekay Steel Industries' },
  { nseSymbol: 'JBCHEPHARM', bseCode: '506943', shortName: 'JB Chemicals & Pharmaceuticals' },
  { nseSymbol: 'SAFARI',     bseCode: '523025', shortName: 'Safari Industries' },
  { nseSymbol: 'MOLDTKPAC',  bseCode: '533080', shortName: 'Mold-Tek Packaging' },
  { nseSymbol: 'SHAILY',     bseCode: '526150', shortName: 'Shaily Engineering Plastics' },
  { nseSymbol: 'AMIORG',     bseCode: '543349', shortName: 'Ami Organics' },
  { nseSymbol: 'POKARNA',    bseCode: '532486', shortName: 'Pokarna' },
  { nseSymbol: 'HIKAL',      bseCode: '524735', shortName: 'Hikal' },
  { nseSymbol: 'DOMSIND',    bseCode: '544045', shortName: 'DOMS Industries' },
  { nseSymbol: 'STYLAMIND',  bseCode: '526612', shortName: 'Stylam Industries' },
  { nseSymbol: 'PATELENG',   bseCode: '531120', shortName: 'Patel Engineering' },
  { nseSymbol: 'INNOVANA',   bseCode: '540850', shortName: 'Innovana Thinklabs' },
  { nseSymbol: 'ELECON',     bseCode: '505700', shortName: 'Elecon Engineering' },
  { nseSymbol: 'ATULAUTO',   bseCode: '531796', shortName: 'Atul Auto' },
  { nseSymbol: 'AFFLE',      bseCode: '542752', shortName: 'Affle India' },
  { nseSymbol: 'TEJASNET',   bseCode: '540595', shortName: 'Tejas Networks' },
  { nseSymbol: 'PRECWIRE',   bseCode: '523539', shortName: 'Precision Wires' },
  { nseSymbol: 'REPRO',      bseCode: '532687', shortName: 'Repro India' },
  { nseSymbol: 'TALBROAUTO', bseCode: '505160', shortName: 'Talbros Automotive' },
  { nseSymbol: 'RAIN',       bseCode: '500339', shortName: 'Rain Industries' },
  { nseSymbol: 'EDELWEISS',  bseCode: '532922', shortName: 'Edelweiss Financial Services' },
  { nseSymbol: 'KPIT',       bseCode: '542651', shortName: 'KPIT Technologies' },
  { nseSymbol: 'SYRMA',      bseCode: '543573', shortName: 'Syrma SGS Technology' },
  { nseSymbol: 'BSE',        bseCode: '543364', shortName: 'BSE' },
  { nseSymbol: 'NAZARA',     bseCode: '543280', shortName: 'Nazara Technologies' },
  { nseSymbol: 'STARHEALTH', bseCode: '543412', shortName: 'Star Health & Allied Insurance' },
  { nseSymbol: 'METROBRAND', bseCode: '543426', shortName: 'Metro Brands' },
  { nseSymbol: 'CDSL',       bseCode: '543278', shortName: 'Central Depository Services' },
  { nseSymbol: 'GLOBUSSPR',  bseCode: '526371', shortName: 'Globus Spirits' },
  { nseSymbol: 'OSWALAGRO',  bseCode: '506260', shortName: 'Oswal Agro Mills' },
  { nseSymbol: 'HLEGLAS',    bseCode: '522215', shortName: 'HLE Glascoat' },
  { nseSymbol: 'BARBEQUE',   bseCode: '543283', shortName: 'Barbeque-Nation Hospitality' },
];

// Build lookup indexes for O(1) resolution.
const BY_NSE = new Map<string, TickerInfo>();
const BY_BSE = new Map<string, TickerInfo>();
for (const e of ENTRIES) {
  BY_NSE.set(e.nseSymbol.toUpperCase(), e);
  BY_BSE.set(e.bseCode, e);
}

/**
 * Resolve any raw ticker-ish string (NSE symbol, BSE code, BSE:CODE prefixed)
 * into a canonical display label. Returns the input string if unresolvable.
 */
export function resolveTicker(raw: string | undefined | null): {
  display: string;
  nseSymbol?: string;
  bseCode?: string;
  shortName?: string;
} {
  if (!raw) return { display: '' };
  const s = String(raw).trim();

  // Strip "BSE:" or "NSE:" prefix
  const m = s.match(/^(?:BSE|NSE):\s*(.+)$/i);
  const inner = m ? m[1].trim() : s;

  // Numeric? Try BSE map.
  if (/^\d{5,7}$/.test(inner)) {
    const hit = BY_BSE.get(inner);
    if (hit) {
      return {
        display: hit.nseSymbol,
        nseSymbol: hit.nseSymbol,
        bseCode: hit.bseCode,
        shortName: hit.shortName,
      };
    }
    // Unknown BSE code — keep the code visible but flag it.
    return { display: inner, bseCode: inner };
  }

  // Otherwise treat as NSE symbol — strip .NS / .BO suffix
  const sym = inner.replace(/\.(NS|BO|BSE)$/i, '').toUpperCase();
  const hit = BY_NSE.get(sym);
  if (hit) {
    return {
      display: hit.nseSymbol,
      nseSymbol: hit.nseSymbol,
      bseCode: hit.bseCode,
      shortName: hit.shortName,
    };
  }
  return { display: sym, nseSymbol: sym };
}

/**
 * Convenience: returns the canonical NSE symbol or the resolved display
 * string. Use this wherever raw BSE codes might leak into the UI.
 */
export function displayTicker(raw: string | undefined | null): string {
  return resolveTicker(raw).display || (raw || '');
}
