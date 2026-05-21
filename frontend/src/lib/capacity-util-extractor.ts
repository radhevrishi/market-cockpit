// ═══════════════════════════════════════════════════════════════════════════
// CAPACITY-UTILIZATION EXTRACTOR — §17.4(B) module 6.
//
// Heuristic NL extraction over uploaded concall / transcript text. Looks for
// patterns like:
//   "current utilization is around 78%, targeting 95% by FY27"
//   "operating at 65% capacity, ramping to 90% in 18 months"
//   "Plant 3 utilization 72%, expanding to 88% next year"
//
// Returns a structured list of CapacityMention entries the Company Intel
// drilldown surfaces inline. Pure regex — no LLM required (per current
// stack). Concall Intel page can call extractCapacity(text) on any
// transcript blob.
// ═══════════════════════════════════════════════════════════════════════════

export interface CapacityMention {
  raw: string;              // Original sentence
  currentPct?: number;      // 0-100; current utilization if extractable
  targetPct?: number;       // 0-100; target/guided utilization if mentioned
  horizon?: string;         // Free-text horizon: 'FY27', '18 months', 'by Q2', etc.
  plantOrSegment?: string;  // 'Plant 3', 'Tablets line', 'API facility', etc.
}

// Sentence delimiter that doesn't break mid-percentage.
const SENTENCE_RE = /[.!?]\s+/g;

// Plant / segment / facility hint
const FACILITY_RE = /\b(plant|line|facility|unit|block|capacity|api\s+(?:plant|facility)|tablets?|injectables?|formulations?)\s*(\d+[A-Z]?|[A-Z]\d?|[IVX]+)?\b/i;

// Horizon extraction — picks first plausible time-frame after a target.
const HORIZON_RE = /(?:by\s+|in\s+|within\s+|over\s+(?:the\s+)?next\s+)([\w\s\d-]{2,30}?(?:FY\d{2,4}|Q[1-4]\s*(?:FY)?\d{2,4}|years?|months?|quarters?|[A-Z][a-z]+\s+\d{4}))/i;

export function extractCapacity(text: string): CapacityMention[] {
  if (!text || text.length < 30) return [];
  const out: CapacityMention[] = [];
  const sentences = text.split(SENTENCE_RE).map(s => s.trim()).filter(s => s.length > 20);

  for (const sentence of sentences) {
    const low = sentence.toLowerCase();
    if (!/utili[sz]ation|capacity/.test(low)) continue;
    // Find all percentages in the sentence
    const pctMatches = Array.from(sentence.matchAll(/(\d{1,3}(?:\.\d{1,2})?)\s*%/g));
    if (pctMatches.length === 0) continue;
    // Heuristic: first % is current, second % (if separated by 'to' / 'targeting' / etc.) is target.
    let currentPct: number | undefined;
    let targetPct: number | undefined;
    const firstPct = parseFloat(pctMatches[0][1]);
    if (Number.isFinite(firstPct) && firstPct >= 5 && firstPct <= 100) currentPct = Math.round(firstPct);
    if (pctMatches.length >= 2) {
      const idx1 = pctMatches[0].index ?? 0;
      const idx2 = pctMatches[1].index ?? 0;
      const between = sentence.slice(idx1, idx2).toLowerCase();
      if (/to|target|guid|reach|expand|ramp|by|toward/.test(between)) {
        const secondPct = parseFloat(pctMatches[1][1]);
        if (Number.isFinite(secondPct) && secondPct >= 5 && secondPct <= 100) targetPct = Math.round(secondPct);
      }
    }
    if (currentPct === undefined) continue; // Need at least a current %
    const facilityMatch = sentence.match(FACILITY_RE);
    const horizonMatch = sentence.match(HORIZON_RE);
    out.push({
      raw: sentence.slice(0, 320),
      currentPct,
      targetPct,
      horizon: horizonMatch ? horizonMatch[1].trim() : undefined,
      plantOrSegment: facilityMatch
        ? `${facilityMatch[1]}${facilityMatch[2] ? ' ' + facilityMatch[2] : ''}`.trim()
        : undefined,
    });
  }

  // Dedup by (currentPct, targetPct, plantOrSegment) — concalls often repeat
  // the same fact 3+ times across Q&A.
  const seen = new Set<string>();
  return out.filter(m => {
    const key = `${m.currentPct}|${m.targetPct ?? '-'}|${m.plantOrSegment ?? '-'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12); // Cap at 12 mentions per transcript
}

/**
 * Roll-up summary: average current util, peak target, longest horizon.
 * Useful for a one-line headline on the company-intel drilldown.
 */
export function summarizeCapacity(mentions: CapacityMention[]): {
  avgCurrent?: number;
  peakTarget?: number;
  longestHorizon?: string;
  count: number;
} {
  if (!mentions.length) return { count: 0 };
  const withCurrent = mentions.filter(m => typeof m.currentPct === 'number');
  const avgCurrent = withCurrent.length
    ? Math.round(withCurrent.reduce((a, b) => a + (b.currentPct as number), 0) / withCurrent.length)
    : undefined;
  const targets = mentions.map(m => m.targetPct).filter((x): x is number => typeof x === 'number');
  const peakTarget = targets.length ? Math.max(...targets) : undefined;
  const horizons = mentions.map(m => m.horizon).filter(Boolean) as string[];
  // Naive: pick the longest string as a proxy for "longest horizon" — gives
  // values like "next 18 months" or "FY27". For real recency-ordering we'd
  // need a date parser.
  const longestHorizon = horizons.length ? horizons.reduce((a, b) => a.length > b.length ? a : b) : undefined;
  return { avgCurrent, peakTarget, longestHorizon, count: mentions.length };
}
