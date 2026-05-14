// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0401 — Sector-specific scoring overlays.
//
// Per institutional review: 'Generic scoring penalizes the wrong things.
// Banks need NIM/GNPA. IT needs deal wins. Pharma needs USFDA. Cyclicals
// need utilization.' This lib detects sector from filing text and applies
// a small overlay score (+/- 0-3) that augments the base bullish score.
//
// Sectors detected:
//   - BANK / NBFC / FIN
//   - IT / SOFTWARE
//   - PHARMA / HEALTHCARE
//   - CYCLICAL_INDUSTRIAL (metals, cement, auto, chemicals)
//   - CONSUMER_DURABLES
//   - REALTY
//   - HOSPITALITY
//   - POWER_UTILITY
//   - OIL_GAS
//   - TELECOM
// ═══════════════════════════════════════════════════════════════════════════

export type SectorTag =
  | 'BANK' | 'IT' | 'PHARMA' | 'CYCLICAL_INDUSTRIAL'
  | 'CONSUMER_DURABLES' | 'REALTY' | 'HOSPITALITY'
  | 'POWER_UTILITY' | 'OIL_GAS' | 'TELECOM' | 'UNKNOWN';

// ─── Sector detection ─────────────────────────────────────────────────────
// Lightweight keyword-based detector. Symbol-level overrides could come from
// a curated table later; for now we rely on the filing text itself.

const SECTOR_PATTERNS: Array<{ tag: SectorTag; re: RegExp; weight: number }> = [
  // BANK / NBFC / FIN — strong signal terms
  { tag: 'BANK', weight: 3, re: /\b(?:Net\s+Interest\s+(?:Margin|Income)|NIM|NII|gross\s+NPA|GNPA|NNPA|slippage|credit\s+cost|provision\s+coverage|advances\s+(?:grew|growth)|deposit\s+growth|CASA\s+ratio|net\s+worth\s+of\s+the\s+bank|priority\s+sector)/i },
  { tag: 'BANK', weight: 2, re: /\b(?:lending|loan\s+book|disbursement|microfinance|housing\s+finance|gold\s+loan|bank|NBFC|HFC|MFI)\b/i },
  // IT
  { tag: 'IT', weight: 3, re: /\b(?:TCV|total\s+contract\s+value|large\s+deal|mega\s+deal|deal\s+pipeline|deal\s+win|deal\s+booking|book[-\s]?to[-\s]?bill|attrition|utilisation|utilization|bench\s+strength|on[-\s]?site|offshore|discretionary\s+(?:spend|spending)|BFSI\s+vertical|hyper[-\s]?scaler)/i },
  { tag: 'IT', weight: 2, re: /\b(?:IT\s+services?|software\s+services|consulting\s+revenue|ER&D|cloud\s+migration|SaaS\s+revenue)/i },
  // PHARMA
  { tag: 'PHARMA', weight: 3, re: /\b(?:USFDA|US\s+FDA|ANDA|DMF|EIR|Form\s+483|warning\s+letter|inspection\s+(?:closed|cleared)|product\s+approval|para\s+IV|biosimilar|CDMO\s+pipeline|generics?\s+(?:filing|approval))/i },
  { tag: 'PHARMA', weight: 2, re: /\b(?:API\s+manufacturing|formulation|drug\s+pipeline|pharmaceutical|chronic\s+therapy|acute\s+therapy|regulated\s+market)/i },
  // CYCLICAL INDUSTRIAL
  { tag: 'CYCLICAL_INDUSTRIAL', weight: 3, re: /\b(?:capacity\s+utili[sz]ation|ASP|average\s+selling\s+price|realization\s+per\s+ton|inventory\s+days|raw[-\s]?material\s+(?:cost|inflation)|spread|tonnage|volume\s+growth|nameplate\s+capacity|brownfield|greenfield)/i },
  { tag: 'CYCLICAL_INDUSTRIAL', weight: 2, re: /\b(?:steel|cement|aluminium|aluminum|copper|zinc|chemicals|petrochemicals|paper|tile|auto\s+(?:component|ancillary)|forging|castings?)\b/i },
  // CONSUMER DURABLES
  { tag: 'CONSUMER_DURABLES', weight: 2, re: /\b(?:same[-\s]?store\s+sales|SSSG|footfall|ARPU\s+per\s+store|new\s+store\s+(?:open|launch)|premium(?:isation|ization)|gross\s+margin\s+mix)/i },
  // REALTY
  { tag: 'REALTY', weight: 3, re: /\b(?:RERA|launches?\s+during\s+Q|pre[-\s]?sales|booking\s+value|inventory\s+months|cash\s+collections|land\s+bank|saleable\s+area|sustenance\s+revenue)/i },
  // HOSPITALITY
  { tag: 'HOSPITALITY', weight: 3, re: /\b(?:RevPAR|occupancy\s+(?:rate|level)|ARR\s+growth|average\s+room\s+rate|F&B\s+revenue|MICE\s+revenue|key\s+addition|rooms?\s+inventory)/i },
  // POWER / UTILITY
  { tag: 'POWER_UTILITY', weight: 2, re: /\b(?:plant\s+load\s+factor|PLF|PPA|tariff|power\s+purchase\s+agreement|merchant\s+power|transmission\s+capacity|grid\s+connectivity|MW\s+capacity|renewable\s+(?:portfolio|MW))/i },
  // OIL & GAS
  { tag: 'OIL_GAS', weight: 2, re: /\b(?:refining\s+margin|GRM|crude\s+throughput|petrochemical\s+spread|gas\s+marketing|LNG\s+import|exploration\s+block)/i },
  // TELECOM
  { tag: 'TELECOM', weight: 2, re: /\b(?:ARPU|subscriber\s+(?:base|net\s+add)|5G\s+rollout|spectrum|tower\s+tenancy|data\s+traffic|MoU\b)/i },
];

export function detectSector(text: string): { sector: SectorTag; confidence: number } {
  if (!text || text.length < 100) return { sector: 'UNKNOWN', confidence: 0 };
  const t = text.toLowerCase();
  const scores: Record<string, number> = {};
  for (const { tag, re, weight } of SECTOR_PATTERNS) {
    if (re.test(t)) scores[tag] = (scores[tag] || 0) + weight;
  }
  let winner: SectorTag = 'UNKNOWN';
  let max = 0;
  for (const [k, v] of Object.entries(scores)) {
    if (v > max) { max = v; winner = k as SectorTag; }
  }
  return { sector: winner, confidence: Math.min(10, max) };
}

// ─── Sector-specific signal patterns ──────────────────────────────────────
// Each sector defines POSITIVE and NEGATIVE phrase patterns that augment the
// base bullish score. Weight is additive (small — overlay only, not primary).

interface SectorSignal { re: RegExp; weight: number; tag: string; polarity: 'POS' | 'NEG'; }

const SECTOR_SIGNALS: Record<SectorTag, SectorSignal[]> = {
  BANK: [
    { tag: 'NIM expansion',     polarity: 'POS', weight: 1.0, re: /(?:NIM|net\s+interest\s+margin)[\s\w]{0,30}(?:expand|improv|rose|increased|up)/i },
    { tag: 'NIM compression',   polarity: 'NEG', weight: 1.0, re: /(?:NIM|net\s+interest\s+margin)[\s\w]{0,30}(?:compress|decline|fell|narrow|under\s+pressure)/i },
    { tag: 'GNPA decline',      polarity: 'POS', weight: 1.5, re: /(?:GNPA|gross\s+NPA|NNPA|net\s+NPA)[\s\w]{0,30}(?:declined?|fell|reduced?|improv|fell\s+to)/i },
    { tag: 'GNPA rise',         polarity: 'NEG', weight: 1.5, re: /(?:GNPA|slippage)[\s\w]{0,20}(?:rose|increased?|surge|spike|up)/i },
    { tag: 'Credit growth',     polarity: 'POS', weight: 1.0, re: /(?:advances|loan\s+book|disbursement)[\s\w]{0,20}(?:grew|growth|up|rose|surge)\s+(?:by\s+)?\d{1,2}/i },
    { tag: 'Provision coverage',polarity: 'POS', weight: 0.5, re: /provision\s+coverage\s+ratio[\s\w]{0,15}(?:improv|increased?|stood\s+at)/i },
  ],
  IT: [
    { tag: 'Strong TCV',         polarity: 'POS', weight: 1.5, re: /(?:TCV|deal\s+wins?|large\s+deals?)[\s\w]{0,30}(?:strong|record|highest|all[-\s]?time\s+high|grew|surge)/i },
    { tag: 'Utilization up',     polarity: 'POS', weight: 1.0, re: /(?:utili[sz]ation)[\s\w]{0,20}(?:improv|up|rose|increased?|trending\s+up)/i },
    { tag: 'Utilization down',   polarity: 'NEG', weight: 0.8, re: /(?:utili[sz]ation)[\s\w]{0,20}(?:declined?|dropped|fell|under\s+pressure)/i },
    { tag: 'Attrition down',     polarity: 'POS', weight: 1.0, re: /attrition[\s\w]{0,15}(?:declined?|fell|reduced?|moderated)/i },
    { tag: 'Attrition up',       polarity: 'NEG', weight: 1.0, re: /attrition[\s\w]{0,15}(?:rose|increased?|elevated|spike|surge)/i },
    { tag: 'Discretionary up',   polarity: 'POS', weight: 1.5, re: /discretionary\s+(?:spend|spending)[\s\w]{0,20}(?:improv|recover|pickup|stabili)/i },
    { tag: 'Discretionary down', polarity: 'NEG', weight: 1.5, re: /discretionary\s+(?:spend|spending)[\s\w]{0,20}(?:weak|soft|under\s+pressure|cautious|delayed)/i },
  ],
  PHARMA: [
    { tag: 'USFDA EIR',          polarity: 'POS', weight: 2.0, re: /(?:US\s*FDA|USFDA)[\s\w]{0,30}(?:EIR|inspection\s+(?:closed|cleared)|VAI|NAI)/i },
    { tag: 'ANDA approval',      polarity: 'POS', weight: 1.5, re: /ANDA[\s\w]{0,15}(?:approval|approved|received)/i },
    { tag: 'Form 483',           polarity: 'NEG', weight: 2.5, re: /(?:Form\s+)?483\s+observations?|warning\s+letter\s+(?:received|issued)/i },
    { tag: 'Pipeline depth',     polarity: 'POS', weight: 1.0, re: /(?:product|drug)\s+pipeline[\s\w]{0,20}(?:strong|robust|deep|broad|growing)/i },
    { tag: 'CDMO momentum',      polarity: 'POS', weight: 1.0, re: /CDMO[\s\w]{0,30}(?:order|momentum|win|expansion|new\s+customer)/i },
  ],
  CYCLICAL_INDUSTRIAL: [
    { tag: 'Util uptick',        polarity: 'POS', weight: 1.0, re: /(?:capacity\s+)?utili[sz]ation[\s\w]{0,20}(?:improv|up|rose|increased?|recover)/i },
    { tag: 'Util dropping',      polarity: 'NEG', weight: 1.0, re: /(?:capacity\s+)?utili[sz]ation[\s\w]{0,20}(?:declined?|dropped|fell|under)/i },
    { tag: 'ASP rising',         polarity: 'POS', weight: 1.0, re: /(?:ASP|realization|spreads?)[\s\w]{0,20}(?:improv|up|rose|expand|widen)/i },
    { tag: 'ASP falling',        polarity: 'NEG', weight: 1.0, re: /(?:ASP|realization|spreads?)[\s\w]{0,20}(?:declined?|fell|compress|narrow|under)/i },
    { tag: 'Inventory bloated',  polarity: 'NEG', weight: 1.0, re: /inventory\s+(?:days|level)[\s\w]{0,15}(?:elevated|increased?|build[-\s]?up|overhang)/i },
    { tag: 'Inventory cleared',  polarity: 'POS', weight: 0.8, re: /inventory[\s\w]{0,15}(?:correction\s+behind|normaliz|cleared|destock(?:ing)?\s+(?:done|over))/i },
  ],
  CONSUMER_DURABLES: [
    { tag: 'SSSG positive',      polarity: 'POS', weight: 1.5, re: /(?:SSSG|same[-\s]?store\s+sales\s+growth)[\s\w]{0,15}(?:positive|grew|up|\d+\s*%)/i },
    { tag: 'SSSG negative',      polarity: 'NEG', weight: 1.5, re: /(?:SSSG|same[-\s]?store\s+sales)[\s\w]{0,15}(?:negative|declined?|down|fell)/i },
    { tag: 'Footfall up',        polarity: 'POS', weight: 0.8, re: /footfall[\s\w]{0,15}(?:improv|up|recover|growth)/i },
  ],
  REALTY: [
    { tag: 'Pre-sales record',   polarity: 'POS', weight: 2.0, re: /pre[-\s]?sales[\s\w]{0,20}(?:record|highest|grew|strong|robust)/i },
    { tag: 'Launches active',    polarity: 'POS', weight: 1.0, re: /(?:launches?|new\s+launches?)[\s\w]{0,20}(?:planned|scheduled|on\s+track|expanded)/i },
    { tag: 'Cash collections',   polarity: 'POS', weight: 1.0, re: /cash\s+collections?[\s\w]{0,15}(?:strong|record|grew|improv)/i },
  ],
  HOSPITALITY: [
    { tag: 'RevPAR growth',      polarity: 'POS', weight: 1.5, re: /RevPAR[\s\w]{0,15}(?:grew|up|increased?|expansion)/i },
    { tag: 'Occupancy up',       polarity: 'POS', weight: 1.0, re: /occupancy[\s\w]{0,15}(?:improv|up|rose|increased?|recover)/i },
    { tag: 'ARR growth',         polarity: 'POS', weight: 1.0, re: /(?:ARR|average\s+room\s+rate)[\s\w]{0,15}(?:grew|up|increased?|expand)/i },
  ],
  POWER_UTILITY: [
    { tag: 'PLF up',             polarity: 'POS', weight: 1.0, re: /(?:PLF|plant\s+load\s+factor)[\s\w]{0,15}(?:improv|up|rose|increased?)/i },
    { tag: 'PPA secured',        polarity: 'POS', weight: 1.5, re: /PPA[\s\w]{0,15}(?:signed|secured|won|received|new)/i },
  ],
  OIL_GAS: [
    { tag: 'GRM up',             polarity: 'POS', weight: 1.5, re: /(?:GRM|refining\s+margin)[\s\w]{0,15}(?:improv|up|rose|expand)/i },
    { tag: 'GRM down',           polarity: 'NEG', weight: 1.5, re: /(?:GRM|refining\s+margin)[\s\w]{0,15}(?:declined?|fell|compress|under\s+pressure)/i },
  ],
  TELECOM: [
    { tag: 'ARPU up',            polarity: 'POS', weight: 1.5, re: /ARPU[\s\w]{0,15}(?:grew|up|rose|increased?|expand)/i },
    { tag: 'Subscriber adds',    polarity: 'POS', weight: 1.0, re: /subscriber[\s\w]{0,15}(?:net\s+add|addition|growth|grew)/i },
  ],
  UNKNOWN: [],
};

export interface SectorOverlayResult {
  sector: SectorTag;
  sector_confidence: number;
  overlay_score: number;        // net delta to base score (can be +/-)
  positive_signals: string[];   // tag names
  negative_signals: string[];   // tag names
  positive_evidence: Array<{ tag: string; sentence: string }>;
  negative_evidence: Array<{ tag: string; sentence: string }>;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

export function applySectorOverlay(text: string): SectorOverlayResult {
  const { sector, confidence } = detectSector(text);
  const result: SectorOverlayResult = {
    sector,
    sector_confidence: confidence,
    overlay_score: 0,
    positive_signals: [],
    negative_signals: [],
    positive_evidence: [],
    negative_evidence: [],
  };
  if (sector === 'UNKNOWN' || !text) return result;

  const signals = SECTOR_SIGNALS[sector] || [];
  if (signals.length === 0) return result;

  // Sentence-level scan for evidence quotes
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 25 && s.length <= 600);

  const firedTags = new Set<string>();
  for (const sent of sentences) {
    for (const sig of signals) {
      if (firedTags.has(sig.tag)) continue;
      if (sig.re.test(sent)) {
        firedTags.add(sig.tag);
        if (sig.polarity === 'POS') {
          result.overlay_score += sig.weight;
          result.positive_signals.push(sig.tag);
          if (result.positive_evidence.length < 4) {
            result.positive_evidence.push({ tag: sig.tag, sentence: truncate(sent, 240) });
          }
        } else {
          result.overlay_score -= sig.weight;
          result.negative_signals.push(sig.tag);
          if (result.negative_evidence.length < 3) {
            result.negative_evidence.push({ tag: sig.tag, sentence: truncate(sent, 240) });
          }
        }
      }
    }
  }
  // Cap overlay at +/-3 so it remains an OVERLAY, not the primary score
  result.overlay_score = Math.max(-3, Math.min(3, result.overlay_score));
  result.overlay_score = Math.round(result.overlay_score * 10) / 10;
  return result;
}
