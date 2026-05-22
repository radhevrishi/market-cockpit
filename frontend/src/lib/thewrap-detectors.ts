// ═══════════════════════════════════════════════════════════════════════════
// THE-WRAP DETECTORS — §17.4(B) institutional alternate-data overlays.
//
// Each detector is a pure regex classifier that runs over a news article's
// headline + summary and returns a structured signal {label, color, emoji,
// evidence} when a pattern matches, or null otherwise. Designed to surface
// as chips on existing news cards — no new backend / pipeline required.
//
// Inspired by Tariq Hussain (TheWrap) framework: alternate market data on
// corp announcements / insider trades / special situations. Each chip
// flags a distinct re-rating catalyst the standard news feed buries.
//
// Detectors:
//   detectOrderBook       — Reg 30 "Receipt of Order / LoA" filings with
//                            customer tier + ₹ value extraction.
//   detectStrategicHire   — CXO appointments with tier-1 employer signal.
//   detectMarqueeCapital  — SAST / preferential allotment with marquee-PE
//                            acquirer matching (KKR/Blackstone/Tata Cap/etc).
//   detectMarketingAuth   — pharma MA / CEP / USFDA EIR / MHRA / WHO GMP /
//                            Tech Transfer milestones.
//
// Rating-Agency action is intentionally NOT here — per user direction it
// lives on its own /rating-actions page rather than as a news chip.
// Capacity Utilization extraction is in Concall Intel — different scope
// (transcript text, not news headline).
// ═══════════════════════════════════════════════════════════════════════════

export interface DetectorSignal {
  emoji: string;
  label: string;
  color: string;
  evidence: string;
  meta?: Record<string, string | number>;
}

// ── ORDER BOOK INTELLIGENCE ──────────────────────────────────────────────────

const TIER1_PSU_PATTERNS: Array<{ rx: RegExp; name: string }> = [
  { rx: /\bRBI\b|\bReserve Bank of India\b/i,  name: 'RBI' },
  { rx: /\bNABARD\b/i,                          name: 'NABARD' },
  { rx: /\bSBI\b|\bState Bank of India\b/i,     name: 'SBI' },
  { rx: /\bLIC\b|\bLife Insurance Corporation\b/i, name: 'LIC' },
  { rx: /\bBHEL\b/i,                            name: 'BHEL' },
  { rx: /\bONGC\b/i,                            name: 'ONGC' },
  { rx: /\bIOCL?\b|\bIndian Oil\b/i,            name: 'IOCL' },
  { rx: /\bGAIL\b/i,                            name: 'GAIL' },
  { rx: /\bNTPC\b/i,                            name: 'NTPC' },
  { rx: /\bPGCIL\b|\bPower Grid\b/i,            name: 'PGCIL' },
  { rx: /\bHAL\b|\bHindustan Aeronautics\b/i,   name: 'HAL' },
  { rx: /\bBEL\b|\bBharat Electronics\b/i,      name: 'BEL' },
  { rx: /\bBDL\b|\bBharat Dynamics\b/i,         name: 'BDL' },
  { rx: /\bDRDO\b/i,                            name: 'DRDO' },
  { rx: /\bISRO\b/i,                            name: 'ISRO' },
  { rx: /\bSECI\b/i,                            name: 'SECI' },
  { rx: /\bIRCTC\b/i,                           name: 'IRCTC' },
  { rx: /\bIRFC\b/i,                            name: 'IRFC' },
  { rx: /\bIndian Railways\b/i,                 name: 'Indian Railways' },
  { rx: /\bMOD\b|\bMinistry of Defence\b/i,     name: 'MoD' },
  { rx: /\bNHAI\b/i,                            name: 'NHAI' },
];

// PATCH 0669 — widened to match real NSE/BSE filing subjects and Indian
// news headlines. Examples that need to pass:
//   "Receipt of Order/Letter of Award"
//   "Receipt of new order from BHEL"
//   "Receipt of order from HAL worth Rs 250 Cr"
//   "Disclosure under Regulation 30 - Receipt of Order"
//   "Company wins large order from MoD"
// PATCH 0709 — institutional synonym expansion. User feedback: detectors
// were catching <20% of real order announcements because the regex demanded
// literal "won order" or "receipt of order". Indian listed-co filings use a
// much wider lexicon — L1 bidder positions, EPC awards, framework agreements,
// rate contracts, supply agreements, turnkey projects, strategic agreements,
// emergency response contracts, etc. Each of these is a real event-driven
// catalyst that triggers re-rating.
const ORDER_TRIGGER_PATTERNS = [
  // Direct order language
  /receipt\s+of\s+(?:[a-z\s]{0,20})?(?:order|letter\s+of\s+award|loa)/i,
  /receives?\s+(?:an?\s+|the\s+|new\s+|a\s+large\s+)?order/i,
  /\bbagging\s*\/\s*receiving\s+(?:of\s+)?orders?/i,
  /receiving\s+of\s+orders?/i,
  /letter\s+of\s+(?:award|acceptance|intent)/i,    // P0709 — LoA & LoI & LoIntent
  /\bLOA\b|\bLoA\b|\bLOI\b|\bLoI\b/,
  /\bwork\s+order\b/i,
  /\bpurchase\s+order\b/i,
  /\bquarterly\s+POs?\b/i,
  /contract\s+(?:award|win|received|secured)/i,
  /\bbagged?\s+(?:an?\s+|the\s+|new\s+|a\s+large\s+)?(?:order|contract|project)/i,
  /\bwins?\s+(?:an?\s+|the\s+|new\s+|a\s+large\s+)?(?:order|contract|project|deal|mandate)/i,
  /\bsecured?\s+(?:an?\s+|the\s+|new\s+|a\s+large\s+)?(?:order|contract|project|mandate)/i,
  /\border\s+(?:intake|win|received|book\s+update)/i,
  /Reg(?:ulation)?\s*30.{0,30}(?:disclosure|filing|order|loa|award)/i,
  // P0709 — institutional synonyms surfaced by user audit
  /\bL1\s+(?:bidder|status|position|in\s+the|for\s+the)/i,           // L1 bidder / L1 in
  /\bselected\s+(?:as\s+(?:the\s+)?)?(?:lowest|preferred|successful)?\s*bidder/i,
  /\bemerged\s+(?:as\s+)?(?:the\s+)?(?:L1|lowest|preferred|successful)\s*bidder/i,
  /\bframework\s+(?:agreement|contract)/i,
  /\brate\s+contract/i,
  /\bEPC\s+(?:contract|order|project|award)/i,
  /\bsupply\s+(?:agreement|contract|order)/i,
  /\bservice\s+agreement\b.{0,40}(?:awarded|signed|received)/i,
  /\bturnkey\s+(?:project|contract|order)/i,
  /\bstrategic\s+(?:agreement|partnership|contract)\b.{0,40}(?:signed|entered|inked)/i,
  /\bdefinitive\s+agreement\b/i,
  /\b(?:awarded|won)\s+(?:a\s+|the\s+)?(?:tender|bid|RFP|RFQ|EPC|contract)/i,
  /\b(?:emergency|long[-\s]term)\s+(?:response|supply|service)\s+contract/i,
  /\bMOU\b|\bmemorandum\s+of\s+understanding\b/i,
  /\bbinding\s+(?:offer|agreement)/i,
  /\b(?:DDC|DPSU)\s+(?:award|contract|order)/i,         // defense / public-sector contract codes
  /\bRail(?:way)?s?\s+(?:order|contract|award)/i,
  /\b(?:exclusive|sole)\s+(?:supplier|distributor|vendor)\s+(?:agreement|contract)/i,
  // PATCH 0713 — additional Reg-30 order-receipt synonyms surfaced from
  // real-world Indian NSE filings (capex, EPC, defence, railways).
  /\bnotice\s+of\s+award\b|\bNOA\b/i,                                       // PATCH 0713
  /\bcontract\s+(?:signing|execution|signed)/i,                              // PATCH 0713
  /\b(?:bagged|secured|won)\s+(?:large|big[- ]?ticket|landmark|maiden|repeat)\s+(?:order|contract|project)/i, // PATCH 0713
  /\bdeal\s+(?:wins?|win[- ]?up|signing|inked|secured|closed)/i,             // PATCH 0713
  /\b(?:repeat|follow[- ]?on|additional)\s+order\b/i,                        // PATCH 0713
  /\bopen\s+order\s+book\b|\bunexecuted\s+order/i,                           // PATCH 0713
  /\b(?:letter|notice)\s+of\s+award/i,                                       // PATCH 0713
  /\b(?:tender|bid)\s+(?:won|awarded|secured|bagged|emerged)/i,              // PATCH 0713
  /\b(?:turnkey|design\s+&\s+build|EPCM|BOT|BOOT|HAM)\s+(?:contract|order|project)/i, // PATCH 0713 — EPC variants
  /\bservice[s]?\s+contract\s+(?:awarded|signed|secured|executed)/i,         // PATCH 0713
  /\bAMC\s+(?:contract|order)\b|\bannual\s+maintenance\s+contract/i,         // PATCH 0713
  /\bO&M\s+(?:contract|agreement)\b|\boperations?\s+(?:and|&)\s+maintenance/i, // PATCH 0713
  /\bemergency\s+(?:purchase|supply)\s+order/i,                              // PATCH 0713
  /\b(?:multi[- ]?year|long[- ]?term)\s+supply\s+agreement/i,                // PATCH 0713
  /\bdomestic\s+(?:contract|order)\s+(?:from|secured|received)/i,            // PATCH 0713
];

/**
 * Detect Reg-30 "Receipt of Order / LoA" filings.
 * Extracts customer tier and contract value where the text reveals it.
 */
export function detectOrderBook(text: string): DetectorSignal | null {
  if (!text) return null;
  const trigger = ORDER_TRIGGER_PATTERNS.find(rx => rx.test(text));
  if (!trigger) return null;
  // Tier-1 PSU customer match — best confidence signal.
  const tier1 = TIER1_PSU_PATTERNS.find(p => p.rx.test(text));
  // Value extraction — common Indian disclosure formats.
  const valueMatch = text.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|crores?|lakh|lacs?|million|mn|billion|bn)/i)
                  || text.match(/(?:USD|\$)\s*([\d,]+(?:\.\d+)?)\s*(million|mn|billion|bn)/i);
  const customerNote = tier1 ? `Tier-1 PSU: ${tier1.name}` : 'Customer tier unclear';
  const valueNote = valueMatch ? `${valueMatch[0]}` : '';
  const evidence = `Receipt-of-Order pattern${valueNote ? ` · ${valueNote}` : ''} · ${customerNote}`;
  const meta: Record<string, string | number> = {};
  if (tier1) meta.tier1Customer = tier1.name;
  if (valueMatch) meta.value = valueMatch[0];
  return {
    emoji: '📋',
    label: tier1 ? `ORDER · ${tier1.name}` : 'ORDER',
    color: tier1 ? '#10B981' : '#22D3EE',
    evidence,
    meta,
  };
}

// ── STRATEGIC HIRE DETECTOR ──────────────────────────────────────────────────

const TIER1_EMPLOYER_PATTERNS: Array<{ rx: RegExp; name: string }> = [
  // FAANG + global tier-1 tech
  { rx: /\bGoogle\b|\bAlphabet\b/i,             name: 'Google' },
  { rx: /\bMicrosoft\b/i,                       name: 'Microsoft' },
  { rx: /\bAmazon\b/i,                          name: 'Amazon' },
  { rx: /\bMeta\b|\bFacebook\b/i,               name: 'Meta' },
  { rx: /\bApple\b/i,                           name: 'Apple' },
  { rx: /\bNvidia\b/i,                          name: 'Nvidia' },
  { rx: /\bIntel\b/i,                           name: 'Intel' },
  { rx: /\bTesla\b/i,                           name: 'Tesla' },
  { rx: /\bOpenAI\b/i,                          name: 'OpenAI' },
  { rx: /\bIBM\b/i,                             name: 'IBM' },
  // Investment-banking tier-1
  { rx: /\bGoldman Sachs\b/i,                   name: 'Goldman' },
  { rx: /\bMorgan Stanley\b/i,                  name: 'Morgan Stanley' },
  { rx: /\bJPMorgan\b|\bJP Morgan\b/i,          name: 'JPMorgan' },
  { rx: /\bBlackRock\b/i,                       name: 'BlackRock' },
  // Consulting tier-1
  { rx: /\bMcKinsey\b/i,                        name: 'McKinsey' },
  { rx: /\bBain (?:&|and) Company\b|\bBain Capital\b/i, name: 'Bain' },
  { rx: /\bBoston Consulting\b|\bBCG\b/i,       name: 'BCG' },
  // Indian tier-1
  { rx: /\bTCS\b|\bTata Consultancy\b/i,        name: 'TCS' },
  { rx: /\bInfosys\b/i,                         name: 'Infosys' },
  { rx: /\bWipro\b/i,                           name: 'Wipro' },
  { rx: /\bReliance (?:Industries|Jio)\b/i,     name: 'Reliance' },
  { rx: /\bAdani (?:Group|Enterprises)\b/i,     name: 'Adani Group' },
  { rx: /\bBajaj Auto\b|\bBajaj Finance\b/i,    name: 'Bajaj' },
  { rx: /\bHDFC Bank\b/i,                       name: 'HDFC Bank' },
  { rx: /\bICICI Bank\b/i,                      name: 'ICICI' },
];

const HIRE_TRIGGER_PATTERNS = [
  /appoint(s|ed|ment)?\b.{0,40}\b(CEO|CFO|COO|CTO|Managing Director|MD|Chairman|President|Director|Chief)/i,
  /\b(CEO|CFO|COO|CTO|MD)\b.{0,40}\bappoint/i,
  /\bnamed\b.{0,40}\b(CEO|CFO|COO|CTO|MD|Managing Director|Chairman|Chief)/i,
  /(?:joins?|join(?:ed|ing)) as (CEO|CFO|COO|CTO|MD|Chairman|Chief)/i,
  /\bex[- ](Google|Microsoft|Amazon|Apple|Meta|Goldman|McKinsey|BCG|JP Morgan|TCS|Infosys|Reliance)\b/i,
  // PATCH 0713 — institutional synonym expansion (Indian listed-co Reg 30
  // disclosures rarely use the literal word "appointed"; they file under
  // "Appointment of Key Managerial Personnel", "Induction to the Board",
  // "elevation to MD", "joined as CXO designate", etc.).
  /\b(?:appointed|designated|elevated|promoted)\s+(?:to|as)\s+(?:the\s+)?(?:CEO|CFO|COO|CTO|CIO|CRO|CHRO|MD|Managing Director|Whole[- ]Time Director|WTD|Executive Director|ED|Chairman|Co[- ]Chairman|President|Vice Chairman|Chief)/i, // PATCH 0713
  /\b(?:induction|inducted)\s+(?:in)?to\s+the\s+(?:Board|board\s+of\s+directors)/i,                                                                                                                                       // PATCH 0713
  /\b(?:appointment|induction)\s+of\s+(?:key\s+managerial\s+personnel|KMP|director|independent\s+director|non[- ]executive\s+director)/i,                                                                                  // PATCH 0713
  /\b(?:MD|CEO|CFO|COO|CTO|CHRO)[- ]?designate\b/i,                                                                                                                                                                       // PATCH 0713
  /\bnon[- ]executive\s+(?:independent\s+)?director\s+(?:appointment|inducted|joined)/i,                                                                                                                                  // PATCH 0713
  /\b(?:re[- ]?appointment|change\s+in\s+directorate|change\s+in\s+management)/i,                                                                                                                                          // PATCH 0713
  /\b(?:onboarded?|on[- ]?boarded)\s+(?:as\s+)?(?:CEO|CFO|COO|CTO|MD|Chairman|Chief)/i,                                                                                                                                    // PATCH 0713
  /\b(?:joined|joining)\s+the\s+(?:company|board|management)\s+as/i,                                                                                                                                                       // PATCH 0713
  /\b(?:former|ex)\s+(?:CEO|CFO|COO|CTO|MD|Head|VP|Vice President)\s+of\s+/i,                                                                                                                                              // PATCH 0713
  /\b(?:hired|hires)\s+(?:from|away from)\s+/i,                                                                                                                                                                            // PATCH 0713
  /\b(?:succeeds|replacing|will\s+succeed|takes\s+over\s+from)\b.{0,30}\b(?:CEO|CFO|COO|CTO|MD|Chairman)/i,                                                                                                                // PATCH 0713
  /\bcessation\s+of\s+(?:director|KMP|chief)/i,                                                                                                                                                                            // PATCH 0713 — surfaces companion event ("X out" often paired with "Y in")
];

export function detectStrategicHire(text: string): DetectorSignal | null {
  if (!text) return null;
  const trigger = HIRE_TRIGGER_PATTERNS.find(rx => rx.test(text));
  if (!trigger) return null;
  const employer = TIER1_EMPLOYER_PATTERNS.find(p => p.rx.test(text));
  if (!employer) {
    // Hire pattern present but no tier-1 employer — too noisy to chip.
    return null;
  }
  const evidence = `CXO appointment from tier-1 employer (${employer.name})`;
  return {
    emoji: '👔',
    label: `HIRE · ex-${employer.name}`,
    color: '#A78BFA',
    evidence,
    meta: { employer: employer.name },
  };
}

// ── MARQUEE CAPITAL ENTRY ────────────────────────────────────────────────────

const MARQUEE_PE_PATTERNS: Array<{ rx: RegExp; name: string }> = [
  // Indian marquee PE / financial sponsors
  { rx: /\bTata Capital\b/i,                                name: 'Tata Capital' },
  { rx: /\bChrysCapital\b|\bChrys Capital\b/i,              name: 'ChrysCapital' },
  { rx: /\bKedaara\s+Capital\b/i,                           name: 'Kedaara' },
  { rx: /\bMultiples\s+Alternate\b|\bMultiples PE\b/i,      name: 'Multiples PE' },
  { rx: /\bICICI Venture\b/i,                               name: 'ICICI Venture' },
  // Global PE
  { rx: /\bKKR\b/i,                                         name: 'KKR' },
  { rx: /\bBlackstone\b/i,                                  name: 'Blackstone' },
  { rx: /\bCarlyle\b/i,                                     name: 'Carlyle' },
  { rx: /\bWarburg Pincus\b/i,                              name: 'Warburg Pincus' },
  { rx: /\bTPG (?:Capital|Inc)?\b/i,                        name: 'TPG' },
  { rx: /\bApollo (?:Global|Management)\b/i,                name: 'Apollo' },
  { rx: /\bBain Capital\b/i,                                name: 'Bain Capital' },
  { rx: /\bAdvent (?:International)?\b/i,                   name: 'Advent' },
  { rx: /\bGeneral Atlantic\b/i,                            name: 'General Atlantic' },
  { rx: /\bGoldman Sachs\b/i,                               name: 'Goldman Sachs' },
  // Strategic LPs known for size + governance signal
  { rx: /\bHBM (?:Healthcare|Holdings)\b/i,                 name: 'HBM' },
  { rx: /\bTemasek\b/i,                                     name: 'Temasek' },
  { rx: /\bGIC\b/i,                                         name: 'GIC' },
  { rx: /\bCPPIB\b|\bCanada Pension\b/i,                    name: 'CPPIB' },
  { rx: /\bADIA\b|\bAbu Dhabi Investment\b/i,               name: 'ADIA' },
];

const CAPITAL_TRIGGER_PATTERNS = [
  /SAST regulations?/i,
  /\bSAST\b.*(?:acquir|takeover)/i,
  /preferential (?:issue|allotment)/i,
  /\bQIP\b|\bqualified institutional placement/i,
  /takeover (?:offer|bid)/i,
  /open offer/i,
  /strategic (?:investment|investor|stake)/i,
  /(?:acquires?|picks?\s+up)\s+(?:a\s+)?\d+(?:\.\d+)?\s*%\s+stake/i,
  // PATCH 0713 — institutional capital-raise / marquee-entry synonyms.
  // Indian listed-co filings use "preferential allotment of warrants to",
  // "anchor allocation", "QIP placement", "convertible warrants to", and
  // funding-round language for unlisted subs (Series A/B/C, lead investor).
  /\banchor\s+(?:investor|allocation|book|investment)\b/i,                                                  // PATCH 0713
  /\blead\s+investor\b/i,                                                                                    // PATCH 0713
  /\bSeries\s+[A-D](?:\s*\+\s*|\s+(?:round|funding|capital))/i,                                              // PATCH 0713
  /\b(?:warrants?\s+(?:issued\s+)?to|convertible\s+(?:warrants?|debentures?)\s+to)\b/i,                       // PATCH 0713
  /\bpreferential\s+(?:issue|allotment)\s+of\s+(?:warrants?|equity|shares|convertible)/i,                     // PATCH 0713
  /\bCCD\b|\bcompulsorily\s+convertible\s+debenture/i,                                                        // PATCH 0713
  /\bCCPS\b|\bcompulsorily\s+convertible\s+preference\s+shares/i,                                             // PATCH 0713
  /\bOCD\b|\boptionally\s+convertible\s+debenture/i,                                                          // PATCH 0713
  /\binvest(?:s|ed|ment)\s+(?:by|from|via)\s+(?:Blackstone|KKR|Carlyle|TPG|Apollo|Bain|Tata\s+Capital|ChrysCapital|Kedaara|Multiples|Warburg|Advent|General\s+Atlantic|Goldman|HBM|Temasek|GIC|CPPIB|ADIA)/i, // PATCH 0713
  /\b(?:Blackstone|KKR|Carlyle|TPG|Apollo|Bain|ChrysCapital|Kedaara|Multiples|Warburg|Advent|Temasek|GIC|CPPIB|ADIA)[- ](?:backed|led|funded|sponsored)/i,                                              // PATCH 0713
  /\bfund\s+raise\b|\bcapital\s+raise\b|\bequity\s+infusion\b|\bgrowth\s+capital\b/i,                          // PATCH 0713
  /\bbinding\s+(?:share\s+)?(?:purchase|subscription)\s+agreement/i,                                          // PATCH 0713
  /\b(?:SPA|SSA)\s+(?:signed|executed|inked|entered)/i,                                                       // PATCH 0713 — Share Purchase / Subscription Agreement
  /\bstrategic\s+(?:partner|alliance|partnership)\s+(?:with|formed|signed)/i,                                 // PATCH 0713
  /\bsubscribe[ds]?\s+to\s+(?:the\s+)?(?:preferential|QIP|warrant|debenture|equity)\s+(?:issue|allotment)/i,  // PATCH 0713
];

export function detectMarqueeCapital(text: string): DetectorSignal | null {
  if (!text) return null;
  const trigger = CAPITAL_TRIGGER_PATTERNS.find(rx => rx.test(text));
  if (!trigger) return null;
  const acquirer = MARQUEE_PE_PATTERNS.find(p => p.rx.test(text));
  if (!acquirer) return null; // No marquee match — likely retail/general capital
  // Stake-size extraction
  const stakeMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s+stake/i);
  const stakeNote = stakeMatch ? ` (${stakeMatch[1]}%)` : '';
  const evidence = `Marquee capital entry: ${acquirer.name}${stakeNote}`;
  return {
    emoji: '💼',
    label: `MARQUEE · ${acquirer.name}`,
    color: '#F59E0B',
    evidence,
    meta: { acquirer: acquirer.name, stake: stakeMatch?.[1] || '' },
  };
}

// ── MARKETING AUTHORIZATION (PHARMA) ─────────────────────────────────────────

const MA_TRIGGER_PATTERNS: Array<{ rx: RegExp; kind: string }> = [
  { rx: /USFDA[^.]{0,80}(?:approval|approves?)/i,                       kind: 'USFDA approval' },
  { rx: /USFDA[^.]{0,80}EIR\b/i,                                        kind: 'USFDA EIR' },
  { rx: /Establishment Inspection Report\b/i,                            kind: 'USFDA EIR' },
  { rx: /\bANDA\b[^.]{0,40}(?:approval|filed|tentative)/i,               kind: 'ANDA' },
  { rx: /Form 483\b/i,                                                  kind: 'USFDA Form 483' },
  { rx: /MHRA[^.]{0,40}(?:approval|inspection)/i,                       kind: 'MHRA' },
  { rx: /WHO[- ]?GMP\b/i,                                               kind: 'WHO-GMP' },
  { rx: /\bCEP\b[^.]{0,40}(?:granted|issued|approval)/i,                kind: 'CEP' },
  { rx: /Certificate of Suitability/i,                                  kind: 'CEP' },
  { rx: /Marketing Authori[sz]ation\b/i,                                kind: 'Marketing Auth' },
  { rx: /\bDCGI\b[^.]{0,40}(?:approval|approves?)/i,                    kind: 'DCGI approval' },
  { rx: /technology transfer\b/i,                                       kind: 'Tech Transfer' },
  { rx: /\bTGA\b[^.]{0,40}(?:approval|listing)/i,                       kind: 'TGA' },
  { rx: /\bPMDA\b[^.]{0,40}(?:approval)/i,                              kind: 'PMDA' },
  // PATCH 0713 — institutional pharma regulatory milestones the prior list
  // missed. ANDA tentative-approvals, CRLs, Form-483 distinctions, EMA &
  // WHO PQ, label expansions, sNDAs, and biosimilar approvals are all
  // material re-rating catalysts that show up in NSE/BSE filings.
  { rx: /\bANDA\s+tentative(?:ly)?\s+approv/i,                          kind: 'ANDA Tentative' },         // PATCH 0713
  { rx: /\bsupplementary\s+NDA\b|\bsNDA\b/i,                            kind: 'sNDA' },                   // PATCH 0713
  { rx: /\bcomplete\s+response\s+letter\b|\bCRL\b/,                     kind: 'CRL' },                    // PATCH 0713
  { rx: /\bPAI\s+clearance\b|\bpre[- ]?approval\s+inspection/i,         kind: 'PAI clearance' },          // PATCH 0713
  { rx: /\bEMA\b[^.]{0,40}(?:approv|grant|positive\s+opinion)/i,        kind: 'EMA' },                    // PATCH 0713
  { rx: /\bWHO\s+pre[- ]?qualification\b|\bWHO[- ]?PQ\b/i,              kind: 'WHO PQ' },                 // PATCH 0713
  { rx: /\bbiosimilar\s+(?:approv|launch|filing)/i,                     kind: 'Biosimilar' },             // PATCH 0713
  { rx: /\blabel\s+expansion\b|\bextension\s+of\s+indication\b/i,       kind: 'Label expansion' },        // PATCH 0713
  { rx: /\b(?:VAI|OAI)\s+status\b/i,                                     kind: 'USFDA VAI/OAI status' },   // PATCH 0713
  { rx: /\b(?:zero|no|nil)\s+observation(?:s)?\b[^.]{0,40}USFDA/i,      kind: 'USFDA zero-observation' }, // PATCH 0713
  { rx: /\bfirst[- ]to[- ]file\b|\bFTF\b[^.]{0,30}(?:status|approval|grant)/i, kind: 'First-to-File' },   // PATCH 0713
  { rx: /\bPara\s+IV\b/i,                                                kind: 'Para IV filing' },         // PATCH 0713
  { rx: /\bAnvisa\b[^.]{0,40}(?:approv|inspect)/i,                       kind: 'Anvisa (Brazil)' },        // PATCH 0713
  { rx: /\bMFDS\b|\bKFDA\b/i,                                            kind: 'MFDS / KFDA (Korea)' },    // PATCH 0713
  { rx: /\bDMF\s+(?:filed|submission|grant)/i,                            kind: 'DMF filing' },             // PATCH 0713
  { rx: /\bUS\s+FDA\s+(?:warning\s+letter|untitled\s+letter)/i,          kind: 'USFDA warning letter' },   // PATCH 0713
];

export function detectMarketingAuth(text: string): DetectorSignal | null {
  if (!text) return null;
  for (const p of MA_TRIGGER_PATTERNS) {
    if (p.rx.test(text)) {
      return {
        emoji: '💊',
        label: `MA · ${p.kind}`,
        color: '#10B981',
        evidence: `Pharma regulatory milestone: ${p.kind}`,
        meta: { kind: p.kind },
      };
    }
  }
  return null;
}

// ── COMBINED HOOK ────────────────────────────────────────────────────────────

/**
 * Run every detector against a news article's text body. Returns the union
 * of all firing signals (an article can match multiple categories — a hire
 * AND a marquee capital announcement, for instance).
 */
export function detectAllTheWrap(text: string | undefined): DetectorSignal[] {
  if (!text) return [];
  const out: DetectorSignal[] = [];
  const orderSig = detectOrderBook(text); if (orderSig) out.push(orderSig);
  const hireSig  = detectStrategicHire(text); if (hireSig) out.push(hireSig);
  const capSig   = detectMarqueeCapital(text); if (capSig) out.push(capSig);
  const maSig    = detectMarketingAuth(text); if (maSig) out.push(maSig);
  return out;
}
