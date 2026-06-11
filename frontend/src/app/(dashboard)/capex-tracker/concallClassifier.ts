// concallClassifier.ts — sentence-level classification + value extraction
// against the comprehensive keyword bank.

import { BANK } from './concallKeywords';

export type CategoryHit = { 
  category: string;
  count: number;
  topQuote: string | null;
};

export type ClassifiedExtract = {
  categoryHits: Record<string, number>;   // category → count of matched sentences
  topQuotes: Record<string, string>;      // category → best example sentence
  toneScore: { positive: number; cautious: number; redFlag: number };
  sectorGuess: string | null;             // dominant sector deck
  totalSentences: number;
};

const splitSentences = (text: string): string[] => {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 30 && s.length < 600);
};

// Pre-compile regex per category for performance
const compileBank = (): Record<string, RegExp> => {
  const out: Record<string, RegExp> = {};
  for (const [cat, terms] of Object.entries(BANK)) {
    // Sort longest first to prefer multi-word phrases
    const sorted = [...terms].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Word-boundary-aware regex; allow leading/trailing word chars only for single words
    out[cat] = new RegExp('\\b(?:' + escaped.join('|') + ')\\b', 'gi');
  }
  return out;
};

let COMPILED: Record<string, RegExp> | null = null;
const getCompiled = (): Record<string, RegExp> => {
  if (!COMPILED) COMPILED = compileBank();
  return COMPILED;
};

export function classifyTranscript(text: string): ClassifiedExtract {
  const sents = splitSentences(text);
  const compiled = getCompiled();
  const hits: Record<string, number> = {};
  const quotes: Record<string, string> = {};
  
  for (const s of sents) {
    for (const [cat, re] of Object.entries(compiled)) {
      re.lastIndex = 0;
      const matches = s.match(re);
      if (matches && matches.length > 0) {
        hits[cat] = (hits[cat] || 0) + 1;
        if (!quotes[cat] || s.length < quotes[cat].length) {
          quotes[cat] = s.length > 200 ? s.slice(0, 197) + '…' : s;
        }
      }
    }
  }
  
  // Tone aggregation
  const toneScore = {
    positive: hits.tone_positive || 0,
    cautious: hits.tone_cautious || 0,
    redFlag: hits.tone_red_flag || 0,
  };
  
  // Sector guess: pick the sector with most hits
  const sectorKeys = ['pharma','solar','tnd','capgoods','auto','ems','spchem','food','steel_bulk'];
  let topSector: string | null = null;
  let topSectorHits = 0;
  for (const s of sectorKeys) {
    const h = hits[s] || 0;
    if (h > topSectorHits) { topSector = s; topSectorHits = h; }
  }
  // Require minimum 3 hits to confidently assign sector
  if (topSectorHits < 3) topSector = null;
  
  return {
    categoryHits: hits,
    topQuotes: quotes,
    toneScore,
    sectorGuess: topSector,
    totalSentences: sents.length,
  };
}

// Helper for UI: human-readable category labels with icons
export const CATEGORY_LABELS: Record<string, string> = {
  capacity: '🏗 Capacity',
  capex: '💰 Capex',
  demand: '📦 Demand',
  margins: '📊 Margins',
  guidance: '🔮 Guidance',
  risk: '🚩 Risk',
  pharma: '💊 Pharma',
  solar: '☀ Solar',
  tnd: '⚡ T&D',
  capgoods: '🏭 Cap Goods',
  auto: '🚗 Auto',
  ems: '🔌 EMS',
  spchem: '🧪 Spec Chem',
  food: '🥚 Food',
  steel_bulk: '🏗 Bulk',
  tone_positive: '✅ Positive',
  tone_cautious: '⚠ Cautious',
  tone_red_flag: '🚩 Red flag',
};
