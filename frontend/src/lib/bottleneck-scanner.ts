// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0407 — BOTTLENECK SCANNER + SYMPATHY BENEFICIARY MAP
//
// Detects supply-chain bottleneck signals in concall text and infers the
// ecosystem of likely beneficiaries. This is the Modern Insulators pattern:
// when Quality Power says "transformer execution delayed by insulator
// shortages", the smart-money read-through is to find listed insulator
// suppliers with float scarcity + approval barriers + capacity constraints.
//
// We score bottlenecks separately and more heavily than generic bullish
// language — scarcity + pricing power + qualification-cycle barriers
// produce non-linear rerating when the cycle turns. Generic "strong demand"
// is a coin flip; "we cannot ship because component X is single-sourced"
// is a directional fundamental signal.
//
// Architecture:
//   1. BOTTLENECK_PATTERNS — phrases that indicate supply/qualification scarcity
//   2. COMPONENT_EXTRACTORS — pulls the constrained component name from context
//   3. SYMPATHY_GRAPH — maps trigger component → ecosystem of listed beneficiaries
//   4. CRITICAL_MODIFIERS — phrases that escalate generic bottleneck to critical
//      (single source, approved vendor, qualification, import dependence)
// ═══════════════════════════════════════════════════════════════════════════

export interface BottleneckSignal {
  detected: boolean;
  critical: boolean;
  weight: number;             // 0-10 — feed into score boost
  evidence: string[];         // sentences that fired the detector
  components: string[];       // extracted constrained components
  beneficiaries: string[];    // mapped ecosystem (tickers)
  sectors: string[];          // sectors implicated
}

// ─── Phrases that signal an active bottleneck ──────────────────────────────
// Match in the same SENTENCE for context — avoid loose paragraph cross-ref.
// PATCH 0415 — broadened after Quality Power Q2 FY26 missed signal:
// "insulators and bushings remain tight in global supply" uses an
// `[Component] remain tight in global supply` word order our prior
// regex couldn't catch.
const BOTTLENECK_PATTERNS: RegExp[] = [
  /(?:cannot|can[' ]?t|unable\s+to)\s+(?:meet|fulfill?|service|deliver|execute)\s+(?:the\s+|all\s+|current\s+)?(?:demand|orders?)/i,
  /(?:supply|component|capacity|production)\s+(?:shortage|constraint|scarc|bottleneck|tight)/i,
  /shortage\s+of\s+(?:capacity|supply|components?|raw\s+materials?)/i,
  /tight\s+(?:supply|market|capacity|component\s+market)/i,
  /(?:order\s+book|orderbook)\s+(?:coverage|stretching)\s+(?:of|to|for|beyond)\s+\d{2,}/i,
  /multi[- ]year\s+(?:order\s+)?(?:visibility|coverage|backlog)/i,
  /(?:fully\s+)?(?:sold\s+out|sold\s+ahead|booked\s+(?:out|ahead))/i,
  /(?:allocating|allocation\s+of)\s+(?:supply|capacity|orders?)\s+(?:to|across|amongst)\s+customer/i,
  /demand\s+(?:significantly\s+|materially\s+)?(?:outpacing|outstripping|exceeds?)\s+(?:current\s+)?(?:supply|capacity)/i,
  /lead\s+times?\s+(?:have\s+)?(?:extended|stretched|increased|expanded)\s+(?:to|beyond)\s+\d/i,
  /(?:execution|delivery)\s+(?:delays?|deferral)\s+(?:due\s+to|because\s+of|owing\s+to)/i,
  /procurement\s+(?:challenge|issue|constraint|delay)/i,
  /(?:strategic|critical|key)\s+(?:component|raw\s+material|input)\s+(?:shortage|scarcity|constraint)/i,

  // PATCH 0415 — the Quality Power miss class. "remain tight in global supply",
  // "stays tight globally", "supply remains tight" etc.
  /\b(?:remain|remains|stay|stays|are|is|continues?\s+to\s+be|continue\s+to\s+be)\s+tight\s+(?:in|across|globally|worldwide|world[-\s]?wide)\b/i,
  /\b(?:remain|remains|stay|stays|are|is)\s+tight\s+(?:in\s+)?(?:global\s+)?supply\b/i,
  /\btight\s+(?:in|across|globally|world[-\s]?wide)\s+(?:supply|market)/i,
  /\bsupply\s+(?:remains?|stays?|continues?\s+(?:to\s+be|tight))/i,

  // "in short supply" / "in tight supply" idioms
  /\bin\s+(?:short|tight)\s+supply\b/i,
  /\bshort\s+in\s+supply\b/i,

  // Supply-chain constraint umbrella phrases
  /\bsupply[-\s]?chain\s+(?:constraint|disruption|tightness|stress|issue|challenge|bottleneck)/i,
  /\bsupply[-\s]?side\s+(?:constraint|disruption|tightness|stress|issue|challenge)/i,

  // Critical-input mentions alone (when paired with action verb)
  /\b(?:critical|key|strategic|essential)\s+(?:input|component|raw\s+material|equipment)s?\b/i,

  // "delays in critical inputs" — Quality Power again
  /\bdelays?\s+in\s+(?:critical\s+|key\s+|strategic\s+)?(?:input|component|supply|deliver|procurement)/i,

  // Booked-out variants
  /\b(?:capacity|production|order[-\s]?book)\s+(?:is\s+|are\s+|has\s+been\s+|already\s+)?(?:fully\s+|completely\s+)?(?:booked|sold|filled)\s+(?:out|ahead|for)/i,

  // Import dependency / regulatory bottleneck
  /\bimport[-\s]?dependen(?:t|cy|ce)\b/i,
  /\b(?:BIS|CE|UL)\s+(?:license|certification|approval).*(?:slowed|delayed|pending|required)/i,

  // Qualification / approval cycle slowing supply
  /(?:qualification|certification|approval)\s+(?:cycle|process|window).*(?:slow|long|extended|6\+|12\+|2\+\s*year)/i,
];

// ─── Critical modifiers — escalate generic bottleneck to CRITICAL tier ─────
const CRITICAL_MODIFIERS: RegExp[] = [
  /(?:single|sole)\s+(?:source|sourced|supplier|vendor)/i,
  /approved\s+(?:vendor|supplier)\s+(?:list|status|programme|program)/i,
  /(?:qualification|approval)\s+(?:cycle|process|lead\s+time|window)/i,
  /(?:limited|restricted|narrow)\s+(?:supplier|vendor)\s+base/i,
  /import\s+(?:dependen|reliance)/i,
  /(?:long|extended|multi[- ]year)\s+(?:qualification|certification|approval)/i,
  /(?:mission|safety)[\s-]?critical\s+(?:component|application)/i,
  /(?:few|two|three)\s+(?:listed|approved|certified)\s+(?:player|suppliers?|manufacturers?)/i,
];

// ─── Component extractor — pulls the constrained item from context ─────────
// Looks for noun phrases near a bottleneck pattern. Conservative — only
// extracts known supply-chain components from a curated vocab, then matches
// the full token to the SYMPATHY_GRAPH below.
const KNOWN_COMPONENTS: Record<string, string> = {
  // T&D / power equipment ecosystem
  'insulator': 'INSULATORS',
  'insulators': 'INSULATORS',
  'bushing': 'BUSHINGS',
  'bushings': 'BUSHINGS',
  'transformer': 'TRANSFORMERS',
  'transformers': 'TRANSFORMERS',
  'transformer oil': 'TRANSFORMER_OIL',
  'cre grain oriented': 'CRGO_STEEL',
  'crgo': 'CRGO_STEEL',
  'grain oriented steel': 'CRGO_STEEL',
  'conductor': 'CONDUCTORS',
  'conductors': 'CONDUCTORS',
  'switchgear': 'SWITCHGEAR',
  'circuit breaker': 'SWITCHGEAR',
  'circuit breakers': 'SWITCHGEAR',
  'hvdc': 'HVDC',
  'cable': 'CABLES',
  'cables': 'CABLES',
  // EMS / electronics
  'pcb': 'PCB',
  'printed circuit board': 'PCB',
  'semiconductor': 'SEMICONDUCTORS',
  'semiconductors': 'SEMICONDUCTORS',
  'chip': 'SEMICONDUCTORS',
  'chips': 'SEMICONDUCTORS',
  'connector': 'CONNECTORS',
  'connectors': 'CONNECTORS',
  'magnetics': 'MAGNETICS',
  // Defence Tier-2
  'titanium': 'TITANIUM',
  'composites': 'COMPOSITES',
  'forgings': 'FORGINGS',
  'forging': 'FORGINGS',
  'casting': 'CASTINGS',
  'castings': 'CASTINGS',
  'precision component': 'PRECISION_COMPONENTS',
  'precision components': 'PRECISION_COMPONENTS',
  // Solar / renewable
  'solar cell': 'SOLAR_CELLS',
  'solar cells': 'SOLAR_CELLS',
  'solar module': 'SOLAR_MODULES',
  'solar modules': 'SOLAR_MODULES',
  'polysilicon': 'POLYSILICON',
  'wafer': 'SOLAR_WAFERS',
  'wafers': 'SOLAR_WAFERS',
  'inverter': 'SOLAR_INVERTERS',
  'inverters': 'SOLAR_INVERTERS',
  // Specialty chem
  'specialty chemical': 'SPECIALTY_CHEM',
  'specialty chemicals': 'SPECIALTY_CHEM',
  'fluorine': 'FLUOROCHEM',
  'fluorochemical': 'FLUOROCHEM',
  'aromatic': 'AROMATICS',
  'aromatics': 'AROMATICS',
  // Auto
  // PATCH 0422 — DO NOT map standalone 'transmission' to AUTO_TRANSMISSIONS.
  // Power-equipment companies (ENRIN/Siemens Energy India, transformers, T&D)
  // use 'transmission' to mean electrical-power transmission, not vehicle
  // transmission. ENRIN was getting flagged as AUTO_TRANSMISSIONS bottleneck.
  // Use only explicit vehicle-context tokens.
  'gearbox': 'GEARBOXES',
  'auto transmission': 'AUTO_TRANSMISSIONS',
  'automatic transmission': 'AUTO_TRANSMISSIONS',
  'vehicle transmission': 'AUTO_TRANSMISSIONS',
  'drivetrain': 'POWERTRAIN',
  'powertrain': 'POWERTRAIN',
  // Heavy industrials
  'bearing': 'BEARINGS',
  'bearings': 'BEARINGS',
  'pump': 'PUMPS',
  'pumps': 'PUMPS',
  'compressor': 'COMPRESSORS',
  'compressors': 'COMPRESSORS',
};

// ─── Sympathy beneficiary map — component → ecosystem of listed beneficiaries
// Seed list. Will expand. Each entry maps a constrained component to a
// short list of plausible listed beneficiaries. The UI will show this as
// "POTENTIAL READ-THROUGH BENEFICIARIES" rather than as recommendations —
// user verifies independently.
const SYMPATHY_GRAPH: Record<string, { sector: string; beneficiaries: string[]; note: string }> = {
  INSULATORS:           { sector: 'T&D Equipment',    beneficiaries: ['MODERNINSU', 'HINDINSU', 'BIRLAERICS'],          note: 'High qualification barriers; few certified suppliers' },
  BUSHINGS:             { sector: 'T&D Equipment',    beneficiaries: ['GHCL', 'CAMSCONTROL'],                            note: 'HV bushing specialists rare in India' },
  TRANSFORMERS:         { sector: 'Power Equipment',  beneficiaries: ['VOLTAMP', 'TDPOWERSYS', 'TRANSFORMERS', 'BHEL'], note: 'Domestic transformer OEMs' },
  TRANSFORMER_OIL:      { sector: 'Specialty Fluids', beneficiaries: ['APARINDS', 'SAVITAOIL'],                          note: 'Transformer oil — niche specialty fluid' },
  CRGO_STEEL:           { sector: 'Special Steel',    beneficiaries: ['JSL', 'SAIL'],                                   note: 'CRGO grain-oriented electrical steel — import dependent' },
  CONDUCTORS:           { sector: 'T&D Equipment',    beneficiaries: ['APARINDS', 'STERLITPOW'],                         note: 'Aluminium conductor specialists' },
  SWITCHGEAR:           { sector: 'Power Equipment',  beneficiaries: ['CGPOWER', 'SIEMENS', 'ABB', 'HITACHIPOW'],        note: 'MV/HV switchgear suppliers' },
  HVDC:                 { sector: 'Power Equipment',  beneficiaries: ['SIEMENS', 'ABB', 'HITACHIPOW'],                   note: 'HVDC tech — global majors only' },
  CABLES:               { sector: 'T&D Equipment',    beneficiaries: ['POLYCAB', 'KEI', 'FINCABLES', 'RRKABEL'],         note: 'Power + control cable players' },
  PCB:                  { sector: 'EMS',              beneficiaries: ['DIXON', 'SYRMA', 'AMBER', 'KAYNES', 'CYIENTDLM'], note: 'PCB-A assembly + ODM' },
  SEMICONDUCTORS:       { sector: 'EMS',              beneficiaries: ['MOSCHIP', 'TATAELXSI', 'CYIENTDLM'],              note: 'Semi design + India fab beneficiaries' },
  CONNECTORS:           { sector: 'EMS',              beneficiaries: ['SYRMA', 'AMBER', 'AVALON'],                       note: 'Specialty connector suppliers' },
  MAGNETICS:            { sector: 'EMS',              beneficiaries: ['SYRMA', 'KAYNES'],                                note: 'EMI/EMC / magnetic components' },
  TITANIUM:             { sector: 'Defence Tier-2',   beneficiaries: ['MTAR', 'PARAS', 'KIRMET'],                        note: 'Aerospace-grade titanium fabrication' },
  COMPOSITES:           { sector: 'Defence Tier-2',   beneficiaries: ['BEML', 'PARAS', 'TANEJAERO'],                     note: 'Composite assemblies for aerospace' },
  FORGINGS:             { sector: 'Defence Tier-2',   beneficiaries: ['BHARATFORG', 'RAMKRISHNA', 'MMFL'],               note: 'Closed-die forging for defence + auto' },
  CASTINGS:             { sector: 'Defence Tier-2',   beneficiaries: ['NELCAST', 'CRAFTSMAN'],                           note: 'Investment + sand castings' },
  PRECISION_COMPONENTS: { sector: 'Defence Tier-2',   beneficiaries: ['MTAR', 'AZAD', 'KIRLOSBROS'],                     note: 'Precision-machined components for critical apps' },
  SOLAR_CELLS:          { sector: 'Solar Mfg',        beneficiaries: ['WAAREEENER', 'PREMIER', 'WEBSOL'],                note: 'Cell mfg — under PLI' },
  SOLAR_MODULES:        { sector: 'Solar Mfg',        beneficiaries: ['WAAREEENER', 'PREMIER', 'WEBSOL', 'INSOLATION'],  note: 'Module mfg — PLI + export' },
  POLYSILICON:          { sector: 'Solar Mfg',        beneficiaries: ['REL_NEW'],                                        note: 'Upstream polysilicon — import dependent today' },
  SOLAR_WAFERS:         { sector: 'Solar Mfg',        beneficiaries: ['WAAREEENER'],                                     note: 'Wafer mfg — vertical integration play' },
  SOLAR_INVERTERS:      { sector: 'Solar Mfg',        beneficiaries: ['INSOLATION', 'WAAREEENER'],                       note: 'Inverter suppliers' },
  SPECIALTY_CHEM:       { sector: 'Specialty Chem',   beneficiaries: ['PRIVISCL', 'GUJFLUORO', 'AARTIIND', 'CLEAN'],     note: 'China+1 specialty chem' },
  FLUOROCHEM:           { sector: 'Specialty Chem',   beneficiaries: ['GUJFLUORO', 'SRF', 'NAVINFLUOR'],                 note: 'Fluorochem capacity — high entry barriers' },
  AROMATICS:            { sector: 'Specialty Chem',   beneficiaries: ['PRIVISCL', 'CAMLINFINE'],                         note: 'Aroma chemicals — limited global players' },
  GEARBOXES:            { sector: 'Auto Ancillary',   beneficiaries: ['SUPRAJIT', 'GNAAXLES'],                           note: 'Transmission specialists' },
  AUTO_TRANSMISSIONS:   { sector: 'Auto Ancillary',   beneficiaries: ['SUPRAJIT', 'GNAAXLES'],                           note: 'Transmission specialists' },
  POWERTRAIN:           { sector: 'Auto Ancillary',   beneficiaries: ['BOSCHLTD', 'ENDURANCE'],                          note: 'Powertrain Tier-1' },
  BEARINGS:             { sector: 'Industrial',       beneficiaries: ['SKFINDIA', 'SCHAEFFLER', 'NRBBEARING', 'TIMKEN'], note: 'Bearings — high precision moat' },
  PUMPS:                { sector: 'Industrial',       beneficiaries: ['KIRLOSKARP', 'SHAKTIPUMP', 'WPIL', 'KIRLOSBROS'], note: 'Industrial + ag pumps' },
  COMPRESSORS:          { sector: 'Industrial',       beneficiaries: ['ELGIEQUIP', 'INGERSOLL'],                         note: 'Industrial compressors' },
};

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Scan a concall transcript / presentation for bottleneck signals.
 * Returns detected components, ecosystem beneficiaries, criticality, and
 * a weight to feed back into the main bullish scoring loop.
 */
export function scanBottleneck(text: string): BottleneckSignal {
  if (!text || text.length < 100) {
    return { detected: false, critical: false, weight: 0, evidence: [], components: [], beneficiaries: [], sectors: [] };
  }
  const sentences = text.split(/[.!?]+\s+/).filter(s => s.length > 20 && s.length < 600);
  const evidence: string[] = [];
  const componentsFound = new Set<string>();
  const componentsTokens = new Set<string>();      // raw tokens for evidence
  let critical = false;

  for (const sent of sentences) {
    // Must have a bottleneck pattern
    const hasBottleneck = BOTTLENECK_PATTERNS.some(re => re.test(sent));
    if (!hasBottleneck) continue;
    // PATCH 0422 — Drop slide-header garbage: sentences that read like bullet
    // lists ('Union Budget 205-26 Political Stability Deeper Reform Agenda
    // Middle East Crisis Focus on Energy Security and accelerated...') have
    // very few verbs and very low punctuation density. Real bottleneck
    // statements are full sentences. Require a verb + reasonable density.
    const hasVerb = /\b(?:is|are|was|were|have|has|had|remain|remains|stay|stays|expect|expected|continue|continues|see|seeing|face|facing|cannot|unable|outpac|outstripping|exceed|exceeds|constrain|booked|sold|delay|delayed|tight|short|shortage)\b/i.test(sent);
    if (!hasVerb) continue;
    // Sentence-density check: real prose has commas/spacing; slide-headers
    // are space-joined keywords with few function words.
    const wc = sent.split(/\s+/).filter(Boolean).length;
    const stopwords = (sent.match(/\b(?:the|a|an|of|in|to|with|for|on|that|this|by|from|and|or|but|as|at|our|we|their|its)\b/gi) || []).length;
    if (wc > 12 && stopwords / wc < 0.10) continue;   // too keyword-dense → slide header
    // Capture evidence
    if (evidence.length < 6) evidence.push(sent.trim());
    // Check for critical modifiers in the same sentence
    if (CRITICAL_MODIFIERS.some(re => re.test(sent))) critical = true;
    // Extract any known component mentioned in the sentence
    const lc = sent.toLowerCase();
    for (const [token, key] of Object.entries(KNOWN_COMPONENTS)) {
      // Word-boundary match to avoid 'insulator' matching 'simulator'
      const wb = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (wb.test(lc)) {
        componentsFound.add(key);
        componentsTokens.add(token);
      }
    }
  }

  // PATCH 0422 — Constrained full-text fallback. The previous fallback
  // scanned the ENTIRE doc for ANY known component token if a bottleneck
  // fired anywhere, which generated false positives like ENRIN flagged as
  // BUSHINGS/TRANSFORMERS/HVDC/AUTO_TRANSMISSIONS from a single slide-header
  // mention. Now: only include components that appear in sentences with a
  // STRONGER bottleneck signal (specific shortage/scarcity/tight verbs), not
  // generic "supply chain disruption" hand-waving. This requires near-token
  // proximity within 2 sentences of a high-confidence pattern.
  const HIGH_CONF = [
    /\bshortage\s+of\b/i, /\bscarcity\b/i, /\btight\s+supply\b/i,
    /\bin\s+(?:short|tight)\s+supply\b/i, /\bsingle[- ]sourced?\b/i,
    /\bunable\s+to\s+(?:meet|deliver|supply)/i,
    /\bdemand\s+(?:significantly\s+)?(?:outpacing|outstripping|exceeds?)\s+(?:current\s+)?(?:supply|capacity)/i,
    /\bcapacity\s+constraint/i,
    /\bremain[s]?\s+tight\s+(?:in|across|globally)/i,
    /\b(?:fully\s+)?sold\s+out\b/i,
    /\bbooked\s+(?:out|ahead)\b/i,
    /\blead\s+times?\s+(?:have\s+)?(?:extended|stretched)/i,
  ];
  if (evidence.length > 0 && componentsFound.size === 0) {
    // Only sentences that fire a HIGH-confidence pattern are eligible
    const tightSentences = sentences.filter(s => HIGH_CONF.some(re => re.test(s)));
    for (const sent of tightSentences) {
      const lc = sent.toLowerCase();
      for (const [token, key] of Object.entries(KNOWN_COMPONENTS)) {
        const wb = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (wb.test(lc)) {
          componentsFound.add(key);
          componentsTokens.add(token);
        }
      }
    }
  }

  if (evidence.length === 0) {
    return { detected: false, critical: false, weight: 0, evidence: [], components: [], beneficiaries: [], sectors: [] };
  }

  // Compute beneficiaries from sympathy graph
  const beneficiariesSet = new Set<string>();
  const sectorsSet = new Set<string>();
  for (const comp of componentsFound) {
    const entry = SYMPATHY_GRAPH[comp];
    if (entry) {
      sectorsSet.add(entry.sector);
      for (const b of entry.beneficiaries) beneficiariesSet.add(b);
    }
  }

  // Weight — base 3 for bottleneck detected; +2 if critical; +1 per
  // component identified up to +3. Capped at 8.
  let weight = 3;
  if (critical) weight += 2;
  weight += Math.min(3, componentsFound.size);
  weight = Math.min(8, weight);

  return {
    detected: true,
    critical,
    weight,
    evidence,
    components: Array.from(componentsFound),
    beneficiaries: Array.from(beneficiariesSet),
    sectors: Array.from(sectorsSet),
  };
}

/**
 * Lookup helper for the UI: given a constrained component key (e.g. INSULATORS),
 * return the sympathy entry. Used when rendering ecosystem chips.
 */
export function getSympathyEntry(component: string): { sector: string; beneficiaries: string[]; note: string } | null {
  return SYMPATHY_GRAPH[component] || null;
}
