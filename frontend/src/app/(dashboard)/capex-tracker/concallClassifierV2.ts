// concallClassifierV2.ts — handbook-enhanced classifier.
// Merges concallKeywords.ts BANK (1986 terms, 18 cats) with handbook bank (1400+ terms, 28 cats).
// Plus 100-point scorecard scoring rubric.

import { BANK as BASE_BANK } from './concallKeywords';
import { 
  HANDBOOK_BANK, 
  HANDBOOK_SECTORS, 
  HANDBOOK_SCORECARD, 
  HANDBOOK_GRADING_RULES,
  ScorecardItem,
} from './concallHandbook';

export type CategoryHit = { category: string; count: number; topQuote: string | null };

export type ClassifiedExtractV2 = {
  categoryHits: Record<string, number>;
  topQuotes: Record<string, string>;
  toneScore: { positive: number; cautious: number; redFlag: number };
  sectorGuess: string | null;
  sectorConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  totalSentences: number;
  scorecardAuto: { id: string; pts: number; max: number; note: string }[];
  scorecardTotal: number;
  band: string;
};

const splitSentences = (text: string): string[] => {
  return text.split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.length < 600);
};

// Merge banks
const FULL_BANK: Record<string, string[]> = { ...BASE_BANK, ...HANDBOOK_BANK };

// Pre-compile per-category regex (cached)
let COMPILED: Record<string, RegExp> | null = null;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getCompiled = (): Record<string, RegExp> => {
  if (COMPILED) return COMPILED;
  const out: Record<string, RegExp> = {};
  for (const [cat, terms] of Object.entries(FULL_BANK)) {
    const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(escape);
    if (escaped.length === 0) continue;
    // Use boundary-aware where possible, else literal
    out[cat] = new RegExp('\\b(?:' + escaped.join('|') + ')\\b', 'gi');
  }
  COMPILED = out;
  return out;
};

// Sector classification: combine BASE sector keys + HANDBOOK sector keys.
const SECTOR_KEYS_BASE = ['pharma','solar','tnd','capgoods','auto','ems','spchem','food','steel_bulk'];
const SECTOR_KEYS_HB = Object.keys(HANDBOOK_SECTORS);  // 19 handbook sectors
const ALL_SECTOR_KEYS = [...new Set([...SECTOR_KEYS_BASE, ...SECTOR_KEYS_HB.map(s => 'hb_sector_' + s)])];

const guessSector = (hits: Record<string, number>): { sector: string | null; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' } => {
  // BASE sector buckets hold direct category hits (pharma/solar/etc).
  // HANDBOOK adds breadth via tailwind/headwind/technical lookups split across all sectors,
  // so we use BASE sector key hits as the primary signal.
  let topSector: string | null = null;
  let topHits = 0;
  for (const k of SECTOR_KEYS_BASE) {
    const h = hits[k] || 0;
    if (h > topHits) { topSector = k; topHits = h; }
  }
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 'NONE';
  if (topHits >= 15) confidence = 'HIGH';
  else if (topHits >= 8) confidence = 'MEDIUM';
  else if (topHits >= 3) confidence = 'LOW';
  if (topHits < 3) topSector = null;
  return { sector: topSector, confidence };
};

// Auto-fill the 100-point scorecard from categoryHits.
// Each scorecard item maps to a domain of categories; we score based on positive vs negative hit ratio.
const SCORECARD_MAP: Record<string, { pos: string[]; neg: string[] }> = {
  management:           { pos: ['tone_positive','hb_bullish_management'], neg: ['tone_cautious','tone_red_flag','hb_bearish_management_vagueness'] },
  demand:               { pos: ['hb_bullish_demand','hb_bullish_orderbook','hb_sector_tailwinds'], neg: ['hb_bearish_demand','hb_bearish_orderbook','hb_sector_headwinds'] },
  margins:              { pos: ['hb_bullish_margin','hb_bullish_pricing'], neg: ['hb_bearish_margin','hb_bearish_pricing'] },
  capacity:             { pos: ['hb_bullish_capex'], neg: ['hb_bearish_capex'] },
  capex:                { pos: ['hb_bullish_capex'], neg: ['hb_bearish_capex','hb_fraud_capex_opacity'] },
  order_book:           { pos: ['hb_bullish_orderbook'], neg: ['hb_bearish_orderbook'] },
  governance:           { pos: [], neg: ['hb_fraud_rpt','hb_fraud_auditor','hb_fraud_promoter_stress','hb_fraud_disclosure'] },
  pricing_power:        { pos: ['hb_bullish_pricing'], neg: ['hb_bearish_pricing'] },
  cash_flow:            { pos: ['hb_bullish_wc'], neg: ['hb_bearish_wc','hb_fraud_receivable'] },
  working_capital:      { pos: ['hb_bullish_wc'], neg: ['hb_bearish_wc','hb_fraud_receivable'] },
  capital_allocation:   { pos: ['hb_bullish_capalloc'], neg: ['hb_bearish_capex'] },
  guidance_credibility: { pos: ['hb_bullish_management'], neg: ['hb_bearish_guidance_cuts','hb_bearish_management_vagueness'] },
  execution:            { pos: ['hb_bullish_capex'], neg: ['hb_bearish_capex','hb_bearish_management_vagueness'] },
  analyst_qa:           { pos: ['hb_bullish_management'], neg: ['hb_bearish_management_vagueness','hb_fraud_disclosure'] },
  risk:                 { pos: [], neg: ['hb_bearish_management_vagueness','tone_red_flag','hb_fraud_disclosure'] },
};

const scoreItem = (item: ScorecardItem, hits: Record<string, number>): { id: string; pts: number; max: number; note: string } => {
  const map = SCORECARD_MAP[item.id];
  if (!map) return { id: item.id, pts: Math.round(item.weight * 0.5), max: item.weight, note: 'no map' };
  const posHits = map.pos.reduce((s, k) => s + (hits[k] || 0), 0);
  const negHits = map.neg.reduce((s, k) => s + (hits[k] || 0), 0);
  const totalHits = posHits + negHits;
  if (totalHits === 0) return { id: item.id, pts: Math.round(item.weight * 0.5), max: item.weight, note: 'no signal — defaulted to 50%' };
  const posRatio = posHits / (posHits + negHits);
  // Sigmoid-like mapping: pos 100% → full points, pos 50% → half, pos 0% → 0
  const pts = Math.round(item.weight * posRatio);
  return { id: item.id, pts, max: item.weight, note: `+${posHits} / -${negHits}` };
};

const bandFor = (total: number): string => {
  for (const b of HANDBOOK_GRADING_RULES.bands) {
    if (total >= b.minScore) return b.label;
  }
  return 'REJECT';
};

export function classifyTranscriptV2(text: string): ClassifiedExtractV2 {
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
          quotes[cat] = s.length > 220 ? s.slice(0, 217) + '…' : s;
        }
      }
    }
  }

  const toneScore = {
    positive: hits.tone_positive || 0,
    cautious: hits.tone_cautious || 0,
    redFlag: hits.tone_red_flag || 0,
  };
  const { sector, confidence } = guessSector(hits);

  const scorecardAuto = HANDBOOK_SCORECARD.map(item => scoreItem(item, hits));
  const scorecardTotal = scorecardAuto.reduce((s, i) => s + i.pts, 0);
  // Apply governance hard rule: governance < weight/2 caps total at 60
  const gov = scorecardAuto.find(s => s.id === 'governance');
  const capped = gov && gov.pts < gov.max / 2 ? Math.min(scorecardTotal, 60) : scorecardTotal;
  const band = bandFor(capped);

  return {
    categoryHits: hits,
    topQuotes: quotes,
    toneScore,
    sectorGuess: sector,
    sectorConfidence: confidence,
    totalSentences: sents.length,
    scorecardAuto,
    scorecardTotal: capped,
    band,
  };
}

export const CATEGORY_LABELS_V2: Record<string, string> = {
  capacity: '🏗 Capacity', capex: '💰 Capex', demand: '📦 Demand',
  margins: '📊 Margins', guidance: '🔮 Guidance', risk: '🚩 Risk',
  pharma: '💊 Pharma', solar: '☀ Solar', tnd: '⚡ T&D',
  capgoods: '🏭 Cap Goods', auto: '🚗 Auto', ems: '🔌 EMS',
  spchem: '🧪 Spec Chem', food: '🥚 Food', steel_bulk: '🏗 Bulk',
  tone_positive: '✅ Positive', tone_cautious: '⚠ Cautious', tone_red_flag: '🚩 Red flag',
  hb_sector_tailwinds: '✅ HB sector tail', hb_sector_headwinds: '⛈ HB sector head',
  hb_sector_technical: '⚙ HB tech',
  hb_bullish_demand: '✅ Demand strong', hb_bullish_pricing: '✅ Pricing power',
  hb_bullish_margin: '✅ Margin expand', hb_bullish_capex: '✅ Capex on plan',
  hb_bullish_wc: '✅ WC tight', hb_bullish_capalloc: '✅ Capital alloc',
  hb_bullish_management: '✅ Mgmt accountable', hb_bullish_orderbook: '✅ Order book strong',
  hb_bearish_demand: '🚩 Demand soft', hb_bearish_pricing: '🚩 Pricing weak',
  hb_bearish_margin: '🚩 Margin compression', hb_bearish_wc: '🚩 WC stretched',
  hb_bearish_capex: '🚩 Capex delays', hb_bearish_management_vagueness: '🚩 Mgmt vague',
  hb_bearish_orderbook: '🚩 Order book soft', hb_bearish_guidance_cuts: '🚩 Guidance cut',
  hb_fraud_rpt: '☠ Related-party', hb_fraud_receivable: '☠ Receivable',
  hb_fraud_auditor: '☠ Auditor', hb_fraud_promoter_stress: '☠ Promoter',
  hb_fraud_disclosure: '☠ Disclosure avoid', hb_fraud_capex_opacity: '☠ Capex opacity',
  hb_fraud_channel: '☠ Channel stuffing',
};
