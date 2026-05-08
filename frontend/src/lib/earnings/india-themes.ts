// ─────────────────────────────────────────────────────────────────────────────
// India-specific institutional themes — what midcap analysts actually track
// ─────────────────────────────────────────────────────────────────────────────
// US-centric themes (AI Infra, Defense Tech) don't always apply to Indian
// midcaps. Indian institutional analysis focuses on macro-policy themes and
// demand cycles specific to the domestic context.
// ─────────────────────────────────────────────────────────────────────────────

import type { ThemeExposure, ThemeStrength, MgmtTone } from './snapshot';

interface IndiaThemeRule {
  theme: string;
  high: RegExp[];
  low: RegExp[];
}

const INDIA_RULES: IndiaThemeRule[] = [
  {
    theme: 'Rural Recovery / Demand',
    high: [
      /\brural\s+(demand|recovery|consumption|growth|wage)/i,
      /\bmonsoon\s+(driven|supported|impact|distribution)/i,
      /\brural\s+wage\s+growth/i,
      /\bnregs\b/i,
      /\bagri\s+income/i,
      /\bharvest/i,
    ],
    low: [/\brural\b/i, /\bmonsoon\b/i, /\bgramin/i, /\bvillage/i],
  },
  {
    theme: 'Premiumization',
    high: [
      /\bpremium\s+(segment|portfolio|brand|product|sku)/i,
      /\bpremiumization/i,
      /\bup\s*-?\s*trading/i,
      /\bprice\s*-?\s*ladder\s+up/i,
      /\bmix\s+improvement/i,
    ],
    low: [/\bpremium\b/i, /\bupgrad/i, /\bsuperior\s+mix/i],
  },
  {
    theme: 'Quick Commerce / D2C',
    high: [
      /\bquick\s+commerce/i,
      /\bq\s*-?\s*commerce/i,
      /\bblinkit|swiggy\s+instamart|zepto/i,
      /\bd2c\b/i,
      /\bdirect\s*-?\s*to\s*-?\s*consumer/i,
    ],
    low: [/\bonline\s+channel/i, /\be\s*-?\s*commerce/i],
  },
  {
    theme: 'Government Capex / Infrastructure',
    high: [
      /\bgovernment\s+capex/i,
      /\binfrastructure\s+(capex|spending|push|programme)/i,
      /\bbudget\s+(capex|allocation|outlay)/i,
      /\bnational\s+infrastructure/i,
      /\bgati\s+shakti/i,
      /\bbharatmala/i,
      /\bsagarmala/i,
      /\bjal\s+jeevan/i,
    ],
    low: [/\binfra\b/i, /\bcapex\b/i, /\bgovt\s+spend/i],
  },
  {
    theme: 'PLI / China+1',
    high: [
      /\bproduction\s+linked\s+incentive/i,
      /\bpli\s+(scheme|benefit|approval)/i,
      /\bchina\s*\+\s*1/i,
      /\bchina\s+plus\s+one/i,
      /\bsupply\s+chain\s+(diversif|de\s*-?\s*risk)/i,
      /\bimport\s+substitution/i,
    ],
    low: [/\bmake\s+in\s+india/i, /\batmanirbhar/i, /\bdomestic\s+manufacturing/i],
  },
  {
    theme: 'Defense Indigenization',
    high: [
      /\bdefen[cs]e\s+indigeniz/i,
      /\bnegative\s+import\s+list/i,
      /\bpositive\s+indigenization\s+list/i,
      /\bidex\b/i,
      /\bsrijan\s+portal/i,
      /\bdefen[cs]e\s+(export|order\s+book)/i,
    ],
    low: [/\bdefence\b/i, /\bdefense\b/i, /\bmilitary\s+order/i],
  },
  {
    theme: 'Railway Modernization',
    high: [
      /\bvande\s+bharat/i,
      /\brailway\s+(electrification|modernization|capex|order)/i,
      /\bdfc\b/i,
      /\bdedicated\s+freight\s+corridor/i,
      /\bkavach/i,
      /\bsemi\s*-?\s*high\s*-?\s*speed/i,
    ],
    low: [/\brailway\b/i, /\brail\s+electric/i],
  },
  {
    theme: 'Renewable Energy / Solar',
    high: [
      /\bsolar\s+(installation|capacity|module|cell|farm|tender)/i,
      /\brenewable\s+(target|capacity|power)/i,
      /\b500\s*gw|450\s*gw/i,
      /\bbattery\s+energy\s+storage/i,
      /\bbess\b/i,
      /\bgreen\s+hydrogen/i,
      /\bsolar\s+pv/i,
    ],
    low: [/\bsolar\b/i, /\brenewable\b/i, /\bclean\s+energy/i],
  },
  {
    theme: 'EV / Mobility Transition',
    high: [
      /\belectric\s+vehicle/i,
      /\bev\s+(adoption|penetration|ecosystem|charging)/i,
      /\bbattery\s+swap/i,
      /\bfame\s+ii?/i,
      /\bcharging\s+infrastructure/i,
      /\bli\s*-?\s*ion\s+cell/i,
    ],
    low: [/\bev\b/i, /\bxev\b/i, /\bevs\b/i, /\bhybrid\s+vehicle/i],
  },
  {
    theme: 'BFSI Credit Cycle',
    high: [
      /\bcredit\s+(growth|cycle|expansion)/i,
      /\bretail\s+credit/i,
      /\bunsecured\s+(credit|lending|book)/i,
      /\bcasa\s+(growth|ratio)/i,
      /\bnim\s+(expansion|compression)/i,
      /\bgnpa|nnpa\b/i,
    ],
    low: [/\bcredit\b/i, /\bcasa\b/i, /\bnim\b/i, /\bgnpa\b/i, /\bnnpa\b/i],
  },
  {
    theme: 'IT GenAI / Discretionary Pickup',
    high: [
      /\bgen\s*-?\s*ai/i,
      /\bgenerative\s+ai/i,
      /\bdiscretionary\s+(spend|recover|pickup)/i,
      /\bbfsi\s+(vertical|demand)/i,
      /\bcloud\s+migration/i,
      /\bdeal\s+pipeline/i,
      /\btcv\s+(growth|momentum)/i,
    ],
    low: [/\bdeal\s+win/i, /\bdigital\s+transform/i, /\bcloud\s+adoption/i],
  },
  {
    theme: 'Pharma — US Generics / India Branded',
    high: [
      /\bus\s+generics/i,
      /\bgenerics\s+pricing/i,
      /\bipm\s+growth/i,
      /\bindian\s+pharma\s+market/i,
      /\bcdmo\b/i,
      /\bbiosimilar/i,
      /\bglp\s*-?\s*1/i,
    ],
    low: [/\bgenerics\b/i, /\bbranded\s+formulation/i, /\bapi\b/i],
  },
  {
    theme: 'Real Estate Cycle',
    high: [
      /\bpre\s*-?\s*sales\s+(growth|momentum)/i,
      /\bhousing\s+(demand|cycle|loan)/i,
      /\binventory\s+(reduce|absorption)/i,
      /\bcollections?\s+(growth|momentum)/i,
    ],
    low: [/\bhousing\b/i, /\brealty\b/i, /\bpre\s*-?\s*sales/i],
  },
  {
    theme: 'Margin Recovery / Commodity Tailwind',
    high: [
      /\bmargin\s+(recovery|expansion|tailwind)/i,
      /\bgross\s+margin\s+(expansion|recover|improv)/i,
      /\bcommodity\s+(tailwind|disinflation|cooling)/i,
      /\binput\s+cost\s+(disinflation|moderation|easing)/i,
      /\bpalm\s+oil\s+(decline|cool)/i,
      /\bcrude\s+(decline|cool)/i,
    ],
    low: [/\bmargin\s+expansion/i, /\bcost\s+savings/i, /\boperating\s+leverage/i],
  },
  {
    theme: 'Urban Slowdown / Macro Headwind',
    high: [
      /\burban\s+(slowdown|softness|weakness)/i,
      /\bdiscretionary\s+(slowdown|moderation|weakness)/i,
      /\bconsumer\s+slowdown/i,
      /\binflation\s+(impact|headwind)/i,
      /\bgst\s+(impact|disruption)/i,
    ],
    low: [/\bsoftness\b/i, /\bweak\s+demand/i, /\bsubdued\s+demand/i],
  },
];

function matchTheme(text: string, rule: IndiaThemeRule): { score: number; evidence: string[] } {
  const evidence: string[] = [];
  const seen = new Set<string>();
  let score = 0;

  for (const re of rule.high) {
    const m = text.match(re);
    if (m && m[0]) {
      const k = m[0].toLowerCase().trim();
      if (!seen.has(k)) { seen.add(k); evidence.push(k); score += 3; }
    }
  }
  for (const re of rule.low) {
    const m = text.match(re);
    if (m && m[0]) {
      const k = m[0].toLowerCase().trim();
      if (!seen.has(k)) { seen.add(k); evidence.push(k); score += 1; }
    }
  }
  return { score, evidence };
}

function strengthFromScore(s: number): ThemeStrength {
  if (s >= 6) return 'high';
  if (s >= 3) return 'medium';
  if (s >= 1) return 'low';
  return 'none';
}

export interface IndiaThemeResult {
  themes: ThemeExposure[];
  confidence: number;
  unavailableReason: string | null;
  corpusChars: number;
}

export function detectIndiaThemes(text: string): IndiaThemeResult {
  const corpus = (text || '').trim();
  const corpusChars = corpus.length;

  if (corpusChars < 30) {
    return {
      themes: [],
      confidence: 0,
      unavailableReason: 'Insufficient corpus for India theme extraction (paste concall transcript or investor presentation for richer analysis)',
      corpusChars,
    };
  }

  const matches = INDIA_RULES.map((rule) => {
    const { score, evidence } = matchTheme(corpus, rule);
    return { rule, score, evidence };
  }).filter((m) => m.score > 0);

  if (matches.length === 0) {
    return {
      themes: [],
      confidence: corpusChars > 200 ? 50 : 25,
      unavailableReason: 'No India macro themes matched the available text. Upload concall / investor presentation for thematic detection.',
      corpusChars,
    };
  }

  matches.sort((a, b) => b.score - a.score);

  const themes: ThemeExposure[] = matches.map((m) => ({
    theme: m.rule.theme,
    strength: strengthFromScore(m.score),
    evidence: m.evidence.slice(0, 6),
  }));

  let confidence = 50;
  confidence += Math.min(matches.length * 8, 30);
  confidence += Math.min(corpusChars / 50, 15);
  confidence = Math.min(95, Math.round(confidence));

  return { themes, confidence, unavailableReason: null, corpusChars };
}

// ── India-specific tone classifier (more sensitive to Indian commentary verbs) ─
export function classifyMgmtToneIndia(text: string): { tone: MgmtTone; confidence: number; signals: string[] } {
  const t = (text || '').toLowerCase();
  const signals: string[] = [];

  if (t.length < 100) return { tone: 'neutral', confidence: 10, signals };

  // India-specific bullish markers
  const bullishHits = [
    'strong demand visibility', 'broad-based growth', 'demand resilient',
    'rural recovery', 'premium portfolio', 'gaining market share',
    'order book at lifetime high', 'capacity utilization at peak',
    'ahead of plan', 'consistent execution', 'all engines firing',
    'tailwind from', 'pricing power', 'mix improvement',
  ].filter(k => { if (t.includes(k)) { signals.push(`+ ${k}`); return true; } return false; }).length;

  // India-specific bearish markers
  const bearishHits = [
    'demand softness', 'urban slowdown', 'volume pressure',
    'margin pressure', 'input cost inflation', 'channel destocking',
    'price increase deferred', 'monsoon disappointment', 'rural slowdown',
    'discretionary slowdown', 'macro headwinds', 'gst impact',
    'one-off', 'demand normalization', 'lower than expected',
  ].filter(k => { if (t.includes(k)) { signals.push(`− ${k}`); return true; } return false; }).length;

  const distressedHits = [
    'going concern', 'liquidity stress', 'covenant breach', 'cost rationalization',
    'workforce reduction', 'asset monetization', 'demerger to unlock',
  ].filter(k => { if (t.includes(k)) { signals.push(`! ${k}`); return true; } return false; }).length;

  let tone: MgmtTone = 'neutral';
  let confidence = 30;
  if (distressedHits >= 1) { tone = 'distressed'; confidence = 75; }
  else if (bearishHits >= 3 && bullishHits < 2) { tone = 'defensive'; confidence = 70; }
  else if (bearishHits >= 2 && bullishHits < 2) { tone = 'cautious'; confidence = 60; }
  else if (bullishHits >= 4 && bearishHits < 2) { tone = 'very_bullish'; confidence = 80; }
  else if (bullishHits >= 2 && bearishHits < 3) { tone = 'constructive'; confidence = 65; }
  else if (bullishHits > bearishHits + 1) { tone = 'constructive'; confidence = 50; }
  else if (bearishHits > bullishHits + 1) { tone = 'cautious'; confidence = 50; }

  return { tone, confidence, signals };
}
