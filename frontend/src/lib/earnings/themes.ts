// ─────────────────────────────────────────────────────────────────────────────
// Theme exposure engine — deterministic, multi-stage keyword extraction
// ─────────────────────────────────────────────────────────────────────────────
// Each theme has TWO weight tiers:
//   high-signal terms (specific, unambiguous)  → 3 points each
//   low-signal terms  (generic, supporting)    → 1 point each
//
// Strength tier:
//   ≥6 points → high
//   3-5       → medium
//   1-2       → low
//   0         → skip
//
// Inputs are concatenated text from: company name, SEC SIC description, FMP
// profile description, sector, industry, and any provided rawText.
// ─────────────────────────────────────────────────────────────────────────────

import type { ThemeExposure, ThemeStrength } from './snapshot';

interface ThemeRule {
  theme: string;
  high: RegExp[];
  low: RegExp[];
}

const RULES: ThemeRule[] = [
  {
    theme: 'AI Infrastructure',
    high: [
      /\bai\s+(infrastructure|compute|inference|training|workload)/i,
      /\bgpu\s+(scaling|cluster|compute|server|farm|accelerat)/i,
      /\bnvidia\b/i,
      /\b(grace\s+hopper|h100|h200|b100|b200|blackwell|hopper|ampere|grace)\b/i,
      /\bgenerative\s+ai/i,
      /\baccelerated\s+comput/i,
      /\bllm\s+(training|inference|workload|deployment)/i,
      /\btransformer\s+(model|architecture)/i,
      /\bfoundation\s+model/i,
      /\bneural\s+(network|processing)/i,
    ],
    low: [
      /\bai\b/i,
      /\bartificial\s+intelligence\b/i,
      /\bmachine\s+learning\b/i,
      /\bdeep\s+learning\b/i,
      /\binference\b/i,
      /\baccelerator\b/i,
      /\bgpu\b/i,
      /\bcompute\b/i,
      /\bml\s+(model|inference|training)/i,
    ],
  },
  {
    theme: 'Defense Technology',
    high: [
      /\bdefense\s+(industry|sector|primes?|contractors?|technology|electronics)/i,
      /\bdepartment\s+of\s+defense\b/i,
      /\bdod\b/i,
      /\bmilitary\s+(grade|application|customer|contract|program)/i,
      /\bcontested\s+environment/i,
      /\bautonomous\s+(weapons|systems\s+for\s+defense)/i,
      /\bclassified\s+program/i,
      /\bprogram\s+of\s+record/i,
      /\bus\s+(army|navy|air\s+force|marines|space\s+force)/i,
      /\bnaval\s+(systems|operations)/i,
      /\baerospace\s+(and|&)\s+defense/i,
      /\bhomeland\s+security/i,
      /\bintelligence\s+community/i,
    ],
    low: [
      /\bdefense\b/i,
      /\bmilitary\b/i,
      /\baerospace\b/i,
      /\bweapons?\b/i,
      /\bradar\b/i,
      /\bsensor\s+fusion/i,
      /\bsurveillance\b/i,
      /\bbattlefield\b/i,
      /\bunmanned\b/i,
      /\bcombat\b/i,
      /\btactical\b/i,
    ],
  },
  {
    theme: 'Edge AI / Rugged Compute',
    high: [
      /\bedge\s+(ai|compute|computing|inference|deployment)/i,
      /\brugged\s+(compute|server|laptop|edge|enclosure|chassis)/i,
      /\bharsh\s+environment/i,
      /\bmobile\s+edge\s+compute/i,
      /\btactical\s+edge/i,
      /\bin\s*-?\s*vehicle\s+(compute|server|ai)/i,
      /\bmil\s*-?\s*spec\b/i,
      /\bmil\s*-?\s*std\s*-?\s*\d+/i,
      /\bembedded\s+(ai|compute|inference)/i,
      /\breal\s*-?\s*time\s+inference/i,
    ],
    low: [
      /\bedge\b/i,
      /\brugged\b/i,
      /\bembedded\b/i,
      /\bportable\s+(server|compute)/i,
      /\bruggedized\b/i,
    ],
  },
  {
    theme: 'Autonomous Systems',
    high: [
      /\bautonomous\s+(vehicle|driving|systems|platform|operation)/i,
      /\bself\s*-?\s*driving/i,
      /\brobotaxi\b/i,
      /\bunmanned\s+(aerial|ground|surface|underwater)\s+vehicle/i,
      /\buav\b/i,
      /\bugv\b/i,
      /\busv\b/i,
      /\buuv\b/i,
      /\bdrone\s+(autonomy|swarm|fleet)/i,
      /\badas\b/i,
      /\bperception\s+stack/i,
      /\bsensor\s+fusion/i,
    ],
    low: [
      /\bautonomy\b/i,
      /\bautonomous\b/i,
      /\bdrone\b/i,
      /\brobot\b/i,
      /\bunmanned\b/i,
    ],
  },
  {
    theme: 'GPU / High-Performance Compute',
    high: [
      /\bhpc\b/i,
      /\bhigh\s*-?\s*performance\s+comput/i,
      /\bgpu\s+(server|cluster|farm|node)/i,
      /\bnvlink/i,
      /\binfiniband/i,
      /\bhbm\d?\b/i,
      /\bpcie\s+gen\s*[5678]/i,
      /\bcuda\b/i,
      /\bdata\s+center\s+(gpu|accelerator)/i,
      /\bcomposable\s+infrastructure/i,
    ],
    low: [
      /\bgpu\b/i,
      /\baccelerator\b/i,
      /\bhigh\s+performance/i,
      /\bsupercomputer/i,
      /\bdata\s+center/i,
    ],
  },
  {
    theme: 'Semiconductors',
    high: [
      /\bsemiconductor/i,
      /\bfoundry\b/i,
      /\bwafer\s+(fab|production)/i,
      /\b\d+\s*nm\s+(node|process)/i,
      /\bchip\s+(design|fabrication|architecture)/i,
      /\befab\b/i,
      /\bsoc\b/i,
      /\basic\b/i,
      /\bfpga\b/i,
      /\beuv\s+lithograph/i,
    ],
    low: [
      /\bsilicon\b/i,
      /\bchip\b/i,
      /\bintegrated\s+circuit/i,
      /\bmicroprocessor/i,
      /\btransistor/i,
    ],
  },
  {
    theme: 'Cybersecurity',
    high: [
      /\bcybersecurity\b/i,
      /\bzero\s+trust/i,
      /\bedr\b/i,
      /\bxdr\b/i,
      /\bsiem\b/i,
      /\bsoar\b/i,
      /\bsecurity\s+operations/i,
      /\bthreat\s+(intelligence|detection|hunting)/i,
      /\bsoc\s+as\s+a\s+service/i,
      /\bidentity\s+(governance|protection|management)/i,
    ],
    low: [
      /\bsecurity\b/i,
      /\bvulnerability\b/i,
      /\bmalware\b/i,
      /\bransomware\b/i,
      /\bphishing\b/i,
      /\bencryption\b/i,
      /\bfirewall\b/i,
    ],
  },
  {
    theme: 'Cloud / SaaS',
    high: [
      /\bsaas\b/i,
      /\barr\b/i,
      /\bnet\s+revenue\s+retention/i,
      /\bnet\s+dollar\s+retention/i,
      /\bnrr\b/i,
      /\bndr\b/i,
      /\bsubscription\s+revenue/i,
      /\bcloud\s+(infrastructure|migration|transformation)/i,
      /\bhybrid\s+cloud/i,
      /\bmulti\s*-?\s*cloud/i,
    ],
    low: [
      /\bcloud\b/i,
      /\bsubscription\b/i,
      /\bsoftware\s+as\s+a\s+service/i,
      /\bplatform\s+as\s+a\s+service/i,
      /\bpaas\b/i,
    ],
  },
  {
    theme: 'Energy Transition',
    high: [
      /\bsolar\s+(panel|farm|module|cell|installation)/i,
      /\bwind\s+(turbine|farm|power)/i,
      /\bgreen\s+hydrogen/i,
      /\benergy\s+storage\s+system/i,
      /\bgrid\s+(modernization|battery|scale\s+storage)/i,
      /\bev\s+charging/i,
      /\blithium\s*-?\s*ion\s+battery/i,
      /\brenewable\s+energy/i,
      /\bbess\b/i,
    ],
    low: [
      /\bsolar\b/i,
      /\bwind\b/i,
      /\bbattery\b/i,
      /\brenewable/i,
      /\belectric\s+vehicle/i,
      /\bclean\s+energy/i,
      /\bdecarbon/i,
    ],
  },
  {
    theme: 'India Capex Cycle',
    high: [
      /\binfrastructure\s+capex/i,
      /\bgovernment\s+capex/i,
      /\bproduction\s+linked\s+incentive/i,
      /\bpli\s+scheme/i,
      /\bmake\s+in\s+india/i,
      /\bdefence\s+indigeniz/i,
      /\brailway\s+modern/i,
      /\batmanirbhar/i,
    ],
    low: [
      /\bcapex\s+cycle/i,
      /\binfra\s+spend/i,
      /\bdomestic\s+manufacturing/i,
    ],
  },
  {
    theme: 'Consumer / FMCG',
    high: [
      /\bfmcg\b/i,
      /\brural\s+demand/i,
      /\burban\s+consumption/i,
      /\bquick\s+commerce/i,
      /\bd2c\b/i,
      /\bpremiumization/i,
      /\bconsumer\s+packaged\s+goods/i,
      /\bcpg\b/i,
    ],
    low: [
      /\bconsumer\s+goods/i,
      /\bretail\b/i,
      /\bbrand\b/i,
      /\bhousehold/i,
      /\bbeverage/i,
    ],
  },
  {
    theme: 'Healthcare / Biotech',
    high: [
      /\bbiotech\b/i,
      /\bclinical\s+trial\s+(phase|results)/i,
      /\bfda\s+approval/i,
      /\bglp\s*-?\s*1/i,
      /\boncology/i,
      /\bcdmo\b/i,
      /\bgene\s+therapy/i,
      /\bcell\s+therapy/i,
      /\bmrna\b/i,
    ],
    low: [
      /\bpharmaceutical/i,
      /\btherapeutic/i,
      /\bdrug\b/i,
      /\bdiagnostic/i,
      /\bclinical/i,
    ],
  },
  {
    theme: 'Connectivity / 5G / Networking',
    high: [
      /\b5g\s+(network|deployment|standalone)/i,
      /\bopen\s*-?\s*ran/i,
      /\bsatellite\s+(constellation|broadband)/i,
      /\bleo\s+(satellite|constellation)/i,
      /\boptical\s+networking/i,
      /\bsoftware\s+defined\s+networking/i,
      /\bsdn\b/i,
    ],
    low: [
      /\b5g\b/i,
      /\bnetwork/i,
      /\bbroadband/i,
      /\btelecom/i,
    ],
  },
];

// ── Match a single theme rule against text and tally evidence ─────────────
function matchTheme(text: string, rule: ThemeRule): { score: number; evidence: string[] } {
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

export interface ThemeDetectionResult {
  themes: ThemeExposure[];
  confidence: number;        // 0-100, based on corpus length and match density
  unavailableReason: string | null;
  corpusChars: number;
}

// ── Main entry: detect themes from arbitrary text corpus ──────────────────
export function detectThemes(text: string): ThemeDetectionResult {
  const corpus = (text || '').trim();
  const corpusChars = corpus.length;

  if (corpusChars < 30) {
    return {
      themes: [],
      confidence: 0,
      unavailableReason: 'Insufficient text corpus for theme extraction (need company description, SIC text, or filing prose)',
      corpusChars,
    };
  }

  const matches = RULES.map((rule) => {
    const { score, evidence } = matchTheme(corpus, rule);
    return { rule, score, evidence };
  }).filter((m) => m.score > 0);

  if (matches.length === 0) {
    return {
      themes: [],
      confidence: corpusChars > 200 ? 60 : 30,
      unavailableReason: 'No institutional themes matched the available company text. May be a generalist or non-thematic name.',
      corpusChars,
    };
  }

  // Sort by score desc
  matches.sort((a, b) => b.score - a.score);

  const themes: ThemeExposure[] = matches.map((m) => ({
    theme: m.rule.theme,
    strength: strengthFromScore(m.score),
    evidence: m.evidence.slice(0, 6),
  }));

  // Confidence: more matches + longer corpus = higher confidence, capped 95
  let confidence = 50;
  confidence += Math.min(matches.length * 8, 30); // up to +30 from match count
  confidence += Math.min(corpusChars / 50, 15);   // up to +15 from corpus length
  confidence = Math.min(95, Math.round(confidence));

  return { themes, confidence, unavailableReason: null, corpusChars };
}

// ── Narrative score from themes (0-100) ───────────────────────────────────
// Premium themes weighted 1.4× (high-multiple sectors).
export function narrativeScoreFromThemes(themes: ThemeExposure[]): number {
  const HIGH_PREMIUM_THEMES = new Set([
    'AI Infrastructure',
    'Defense Technology',
    'Edge AI / Rugged Compute',
    'Autonomous Systems',
    'GPU / High-Performance Compute',
    'Cybersecurity',
    'Semiconductors',
  ]);
  const STR_VAL: Record<ThemeStrength, number> = { high: 28, medium: 16, low: 8, none: 0 };
  let raw = 0;
  for (const th of themes) {
    const base = STR_VAL[th.strength];
    const mult = HIGH_PREMIUM_THEMES.has(th.theme) ? 1.4 : 1.0;
    raw += base * mult;
  }
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ── Management tone classification ────────────────────────────────────────
// Keyword-based heuristic over filing text. Only meaningful when rawText
// is provided — for ticker-only fetches we have no MD&A so default to neutral.
export function classifyMgmtTone(text: string): { tone: import('./snapshot').MgmtTone; confidence: number } {
  const t = (text || '').toLowerCase();
  if (t.length < 100) {
    return { tone: 'neutral', confidence: 10 };
  }
  const score = (kws: string[]) => kws.reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0);

  const veryBullish = score(['record', 'strongest ever', 'accelerating growth', 'all-time high', 'exceeded all', 'far exceeded', 'breakthrough quarter']);
  const constructive = score(['confident', 'optimistic', 'momentum', 'on track', 'strong demand', 'expanding pipeline', 'robust']);
  const cautious = score(['challenges', 'cautious', 'softness', 'mixed', 'uncertain', 'normalization', 'macro headwind']);
  const defensive = score(['decline', 'pressure', 'weak demand', 'tough environment', 'difficult', 'muted', 'soft demand']);
  const distressed = score(['going concern', 'covenant', 'restructuring', 'liquidity', 'cost cuts', 'workforce reduction', 'impairment', 'material weakness']);

  const bullScore = veryBullish * 2 + constructive;
  const bearScore = defensive * 2 + distressed * 3 + cautious;

  let tone: import('./snapshot').MgmtTone = 'neutral';
  let confidence = 30;

  if (distressed >= 2) { tone = 'distressed'; confidence = 75; }
  else if (defensive >= 2 && bullScore < 2) { tone = 'defensive'; confidence = 65; }
  else if (cautious >= 2 && bullScore < 2) { tone = 'cautious'; confidence = 60; }
  else if (veryBullish >= 2) { tone = 'very_bullish'; confidence = 80; }
  else if (constructive >= 2 && bearScore < 3) { tone = 'constructive'; confidence = 70; }
  else if (bullScore > bearScore + 1) { tone = 'constructive'; confidence = 50; }
  else if (bearScore > bullScore + 1) { tone = 'cautious'; confidence = 50; }

  return { tone, confidence };
}
