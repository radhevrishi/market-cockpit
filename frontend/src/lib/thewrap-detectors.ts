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

const ORDER_TRIGGER_PATTERNS = [
  /receipt of order/i,
  /receives? (an? )?order/i,
  /letter of award/i,
  /\bLOA\b|\bLoA\b/,
  /work order/i,
  /purchase order/i,
  /contract award/i,
  /bagged (an? )?order/i,
  /wins? (an? )?order/i,
  /secured (an? )?order/i,
  /Reg(?:ulation)?\s*30\s+(?:disclosure|filing)/i,
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
