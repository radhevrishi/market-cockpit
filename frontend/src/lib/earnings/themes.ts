// ─────────────────────────────────────────────────────────────────────────────
// Theme exposure engine — deterministic keyword matching with strength scoring
// ─────────────────────────────────────────────────────────────────────────────
// Categories are ordered by 2026-context investor relevance.
// Strength: number of distinct evidence keywords matched.
//   ≥3 → high, 2 → medium, 1 → low, 0 → none.
// ─────────────────────────────────────────────────────────────────────────────

import type { ThemeExposure, ThemeStrength } from './snapshot';

interface ThemeRule {
  theme: string;
  keywords: RegExp[];
}

const RULES: ThemeRule[] = [
  {
    theme: 'AI Infrastructure',
    keywords: [
      /\bai\s+(infrastructure|compute|inference|training)/i,
      /\bgpu\s+(scaling|cluster|compute)/i,
      /nvidia/i,
      /\b(grace\s+hopper|h100|h200|b100|b200|blackwell|hopper)\b/i,
      /\bpcie\s+gen\s*[567]/i,
      /\baccelerated\s+comput/i,
      /\bhpc\b/i,
      /\bllm\s+(training|inference|workload)/i,
    ],
  },
  {
    theme: 'Defense Tech',
    keywords: [
      /\bdefense\b/i,
      /\bmilitary\b/i,
      /\baerospace\s+(and|&)\s+defense/i,
      /\bdod\b/i,
      /\bcontested\s+environment/i,
      /\bautonomous\s+(weapons|systems|platforms)/i,
      /\bclassified\s+program/i,
      /\bprogram\s+of\s+record/i,
      /\brugged\s+(compute|server|edge)/i,
    ],
  },
  {
    theme: 'Edge AI / Rugged Compute',
    keywords: [
      /\bedge\s+(ai|compute|computing|inference)/i,
      /\brugged\s+(compute|server|laptop|edge)/i,
      /\bmobile\s+edge\s+compute/i,
      /\btactical\s+edge/i,
      /\bin\s*-?\s*vehicle\s+compute/i,
      /\bharsh\s+environment/i,
    ],
  },
  {
    theme: 'Autonomous Systems',
    keywords: [
      /\bautonomous\s+(vehicle|driving|systems|platform)/i,
      /\bself\s*-?\s*driving/i,
      /\brobotaxi/i,
      /\buav\b/i,
      /\bdrone\s+(autonomy|swarm)/i,
      /\badas\b/i,
      /\bperception\s+stack/i,
    ],
  },
  {
    theme: 'GPU Compute / Accelerator',
    keywords: [
      /\bgpu\b/i,
      /\baccelerator\s+(card|chip)/i,
      /\bcuda\b/i,
      /\bnvlink/i,
      /\binfiniband/i,
      /\bhbm\d?\b/i,
    ],
  },
  {
    theme: 'Cloud / SaaS',
    keywords: [
      /\bsaas\b/i,
      /\barr\b/i,
      /\bnet\s+revenue\s+retention/i,
      /\bnet\s+dollar\s+retention/i,
      /\bnrr\b/i,
      /\bndr\b/i,
      /\bsubscription\s+revenue/i,
      /\bcloud\s+infrastructure/i,
      /\bhybrid\s+cloud/i,
    ],
  },
  {
    theme: 'Cybersecurity',
    keywords: [
      /\bcybersecurity\b/i,
      /\bzero\s+trust/i,
      /\bedr\b/i,
      /\bxdr\b/i,
      /\bsiem\b/i,
      /\bsecurity\s+operations/i,
      /\bthreat\s+intelligence/i,
    ],
  },
  {
    theme: 'Semiconductors',
    keywords: [
      /\bsemiconductor/i,
      /\bfoundry\b/i,
      /\bwafer/i,
      /\bnode\s+\d+nm/i,
      /\bchip\s+(design|fabrication)/i,
      /\befab\b/i,
    ],
  },
  {
    theme: 'Energy Transition / Renewables',
    keywords: [
      /\bsolar/i,
      /\bwind\s+(power|farm|turbine)/i,
      /\bgreen\s+hydrogen/i,
      /\benergy\s+storage/i,
      /\bgrid\s+(modernization|battery)/i,
      /\bev\s+charging/i,
    ],
  },
  {
    theme: 'India Capex Cycle',
    keywords: [
      /\binfrastructure\s+capex/i,
      /\bgovernment\s+capex/i,
      /\bproduction\s+linked\s+incentive/i,
      /\bpli\b/i,
      /\bmake\s+in\s+india/i,
      /\bdefence\s+indigeniz/i,
      /\brailway\s+modern/i,
    ],
  },
  {
    theme: 'Consumer / FMCG',
    keywords: [
      /\bfmcg\b/i,
      /\brural\s+demand/i,
      /\burban\s+consumption/i,
      /\bquick\s+commerce/i,
      /\bd2c\b/i,
      /\bpremiumization/i,
    ],
  },
  {
    theme: 'Healthcare / Biotech',
    keywords: [
      /\bbiotech\b/i,
      /\bclinical\s+trial\s+(phase|results)/i,
      /\bfda\s+approval/i,
      /\bglp\s*-?\s*1/i,
      /\boncology/i,
      /\bcdmo\b/i,
    ],
  },
];

export function detectThemes(text: string): ThemeExposure[] {
  const results: ThemeExposure[] = [];
  const t = text || '';
  for (const rule of RULES) {
    const evidence: string[] = [];
    for (const re of rule.keywords) {
      const m = t.match(re);
      if (m && m[0]) {
        const snippet = m[0].toLowerCase().trim();
        if (!evidence.includes(snippet)) evidence.push(snippet);
      }
    }
    if (evidence.length === 0) continue;
    let strength: ThemeStrength = 'low';
    if (evidence.length >= 3) strength = 'high';
    else if (evidence.length === 2) strength = 'medium';
    results.push({ theme: rule.theme, strength, evidence: evidence.slice(0, 5) });
  }
  // Sort by strength desc (high first)
  const order: Record<ThemeStrength, number> = { high: 3, medium: 2, low: 1, none: 0 };
  results.sort((a, b) => order[b.strength] - order[a.strength]);
  return results;
}

// Compute a 0–100 narrative score from theme exposure.
// High-relevance themes (AI Infra, Defense, Edge AI, Autonomous, Cybersec) weighted more.
export function narrativeScoreFromThemes(themes: ThemeExposure[]): number {
  const HIGH_PREMIUM_THEMES = new Set([
    'AI Infrastructure',
    'Defense Tech',
    'Edge AI / Rugged Compute',
    'Autonomous Systems',
    'GPU Compute / Accelerator',
    'Cybersecurity',
    'Semiconductors',
  ]);
  const STR_VAL: Record<ThemeStrength, number> = { high: 25, medium: 15, low: 7, none: 0 };
  let raw = 0;
  for (const th of themes) {
    const base = STR_VAL[th.strength];
    const mult = HIGH_PREMIUM_THEMES.has(th.theme) ? 1.4 : 1.0;
    raw += base * mult;
  }
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// Management tone classification — keyword-based heuristic over text
export function classifyMgmtTone(text: string): { tone: import('./snapshot').MgmtTone; confidence: number } {
  const t = (text || '').toLowerCase();
  const score = (kws: string[]) => kws.reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0);

  const veryBullish = score(['record', 'strongest ever', 'accelerating growth', 'all-time high', 'exceeded all', 'far exceeded']);
  const constructive = score(['confident', 'optimistic', 'momentum', 'on track', 'strong demand', 'expanding pipeline', 'robust']);
  const cautious = score(['challenges', 'cautious', 'softness', 'mixed', 'uncertain', 'normalization', 'macro headwind']);
  const defensive = score(['decline', 'pressure', 'weak demand', 'tough environment', 'difficult', 'muted', 'soft']);
  const distressed = score(['going concern', 'covenant', 'restructuring', 'liquidity', 'cost cuts', 'workforce reduction', 'impairment']);

  // Weight bullish vs negative
  const bullScore = veryBullish * 2 + constructive;
  const bearScore = defensive * 2 + distressed * 3 + cautious;

  let tone: import('./snapshot').MgmtTone = 'neutral';
  let confidence = 30;

  if (distressed >= 2) { tone = 'distressed'; confidence = 70; }
  else if (defensive >= 2 && bullScore < 2) { tone = 'defensive'; confidence = 60; }
  else if (cautious >= 2 && bullScore < 2) { tone = 'cautious'; confidence = 55; }
  else if (veryBullish >= 2) { tone = 'very_bullish'; confidence = 75; }
  else if (constructive >= 2 && bearScore < 3) { tone = 'constructive'; confidence = 65; }
  else if (bullScore > bearScore + 1) { tone = 'constructive'; confidence = 50; }
  else if (bearScore > bullScore + 1) { tone = 'cautious'; confidence = 50; }

  return { tone, confidence };
}
