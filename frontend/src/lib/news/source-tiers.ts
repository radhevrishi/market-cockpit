// ═══════════════════════════════════════════════════════════════════════════
// SOURCE TIERS — patch 0051
//
// Replaces the per-source denylist (CNBC, Yahoo, FT, etc.) with a tier-based
// classifier. Sources are categorized by *kind*, not name. New feeds can be
// added without code changes — just classify them by tier.
//
// Sources NEVER define classification. They only affect:
//   • confidence weighting
//   • noise penalty
//   • whether bottleneck escalation needs a strong title anchor
//
// CNBC can publish critical structural information. SemiAnalysis can
// publish speculative opinion. Institutional systems weight evidence —
// they do not whitelist truth.
// ═══════════════════════════════════════════════════════════════════════════

export type SourceTier =
  | 'PRIMARY'        // Reuters, Bloomberg News, FT, WSJ, ET, BS, Mint  — institutional reporting
  | 'SPECIALIST'     // Digitimes, TrendForce, SemiAnalysis, Power Engineering, Defense News — domain depth
  | 'GENERALIST'     // CNBC, Yahoo Finance, Investing.com, ET Markets — broad financial press
  | 'EDITORIAL'      // MarketWatch opinion, Forbes, Fortune, Barron's — column / opinion
  | 'PRESS_RELEASE'  // BSE, SEBI, NSE, government announcement feeds — primary docs
  | 'SOCIAL'         // Reddit, Twitter, retail forums — social commentary
  | 'UNKNOWN';

// ─── Pattern-based classifier ──────────────────────────────────────────────
// Patterns matched against feed.name (case-insensitive).

const TIER_PATTERNS: Array<{ tier: SourceTier; patterns: RegExp[] }> = [
  {
    tier: 'PRIMARY',
    // PATCH 0452 P0-4 — Audit found this PRIMARY tier was neutralizing the
    // Patch 0449 frontend downgrade of ET/Mint/Moneycontrol/BS/BL. Backend
    // was boosting them ×1.15 while frontend penalized them ×0.35. They
    // roughly cancelled out — so the institutional source-quality fix
    // shipped but had near-zero visible effect.
    //
    // PRIMARY is now reserved for truly primary international wires
    // (Reuters / Bloomberg News / WSJ / FT). Indian general business
    // desks (ET / Mint / MC / BS / BL / FE) drop to GENERALIST where
    // they belong — they rewrite filings, rarely add reporting.
    patterns: [
      /^reuters\b/i,
      /^bloomberg news\b/i,
      /^wall street journal\b/i,
      /^wsj\b/i,
      /^financial times\b/i,
      /^ft (markets|news)?\b/i,
      // Exchange filing / regulator / PR feeds belong here, not aggregator desks.
      /\bnseindia\b/i,
      /\bbseindia\b/i,
      /\bsebi\b/i,
      /\brbi\b/i,
      /\bsec\.gov\b/i,
      /\bpib (india|gov)\b/i,
      /\bpr ?newswire\b/i,
      /\bglobenewswire\b/i,
      /\bbusiness ?wire\b/i,
    ],
  },
  {
    tier: 'SPECIALIST',
    patterns: [
      /^digitimes\b/i,
      /^trendforce\b/i,
      /^semianalysis\b/i,
      /^semiwiki\b/i,
      /^ee times\b/i,
      /^data center dynamics\b/i,
      /^light reading\b/i,
      /^servethehome\b/i,
      /^nextplatform\b/i,
      /^techinsights\b/i,
      /^anandtech\b/i,
      /^tom'?s hardware\b/i,
      /^the register\b/i,
      /^ars technica\b/i,
      /^blocks & files\b/i,
      /^power technology\b/i,
      /^utility dive\b/i,
      /^power engineering\b/i,
      /^world nuclear news\b/i,
      /^icis\b/i,
      /^s&p commodity insights\b/i,
      /^oilprice\b/i,
      /^freightwaves\b/i,
      /^defense news\b/i,
      /^breaking defense\b/i,
      /^space ?news\b/i,
      /^aviation week\b/i,
      /^et infra\b/i,
      /^power line\b/i,
      /^renewable watch\b/i,
      /^steelmint\b/i,
      /^coalmint\b/i,
      /^project today\b/i,
      /^construction world\b/i,
      /^livefist\b/i,
      /^idrw\b/i,
      /^bw defence\b/i,
      /^sp's aviation\b/i,
      /^raksha anirveda\b/i,
      /^electronicsb2b\b/i,
      /^smt today\b/i,
      /^et telecom\b/i,
      /^et energyworld\b/i,
    ],
  },
  {
    tier: 'GENERALIST',
    patterns: [
      /^cnbc\b/i,
      /^yahoo finance\b/i,
      /^investing\.com\b/i,
      /^techcrunch\b/i,
      /^seeking alpha\b/i,
      /^cnbc tv ?18\b/i,
      /^business today\b/i,
      /^financial express\b/i,
      /^trendlyne\b/i,
      /^equitymaster\b/i,
      /^indmoney\b/i,
      /^ndtv\b/i,
      /^ndtv profit\b/i,
      /^bloomberg markets\b/i,    // generalist video/wire bucket
    ],
  },
  {
    tier: 'EDITORIAL',
    patterns: [
      /^marketwatch\b/i,
      /^forbes\b/i,
      /^fortune\b/i,
      /^barron's\b/i,
      /^bloomberg opinion\b/i,
      /^bloomberg politics\b/i,    // politics column bucket
      /^the motley fool\b/i,
      /^zacks\b/i,
    ],
  },
  {
    tier: 'PRESS_RELEASE',
    patterns: [
      /^bse(?:india)? (corp announcements|filings|notices|press)\b/i,
      /^bse corp announcements\b/i,
      /^sebi (press|circulars|notices|enforcement)\b/i,
      /^sebi press releases\b/i,
      /^nse (announcements|filings|press)\b/i,
      /^rbi (press|circulars|notices)\b/i,
      /^pib\b/i,
      /^pib india\b/i,
      /^press information bureau\b/i,
    ],
  },
  {
    tier: 'SOCIAL',
    patterns: [
      /^reddit\b/i,
      /^twitter\b/i,
      /^x\.com\b/i,
      /^stocktwits\b/i,
      /^discord\b/i,
    ],
  },
];

export function classifySourceTier(feedName: string): SourceTier {
  for (const { tier, patterns } of TIER_PATTERNS) {
    if (patterns.some(p => p.test(feedName))) return tier;
  }
  return 'UNKNOWN';
}

// ─── Tier-based score modifiers ────────────────────────────────────────────
// Applied to consequence_score after raw computation. Replaces the per-source
// credibility map.

export interface TierContribution {
  tier: SourceTier;
  multiplier: number;            // applied to consequence_score
  noise_penalty: number;         // added penalty when no anchor present
  bottleneck_anchor_required: boolean;  // require strong title anchor for BOTTLENECK
}

// PATCH 0461 — PRESS_RELEASE is NOT noise. Company-issued press releases
// are PRIMARY-source material from the company itself (especially when
// distributed via PR Newswire / Business Wire). Treat them as neutral-to-
// favourable, not as 0.40-multiplier garbage. Audit found genuinely
// market-moving company announcements were being suppressed below
// generalist news commentary because of this misclassification.
const TIER_TABLE: Record<SourceTier, TierContribution> = {
  PRIMARY:       { tier: 'PRIMARY',       multiplier: 1.15, noise_penalty: 0,  bottleneck_anchor_required: false },
  SPECIALIST:    { tier: 'SPECIALIST',    multiplier: 1.10, noise_penalty: 0,  bottleneck_anchor_required: true  },
  GENERALIST:    { tier: 'GENERALIST',    multiplier: 0.95, noise_penalty: 5,  bottleneck_anchor_required: true  },
  EDITORIAL:     { tier: 'EDITORIAL',     multiplier: 0.55, noise_penalty: 15, bottleneck_anchor_required: true  },
  PRESS_RELEASE: { tier: 'PRESS_RELEASE', multiplier: 0.95, noise_penalty: 4,  bottleneck_anchor_required: true  },
  SOCIAL:        { tier: 'SOCIAL',        multiplier: 0.30, noise_penalty: 30, bottleneck_anchor_required: true  },
  UNKNOWN:       { tier: 'UNKNOWN',       multiplier: 0.85, noise_penalty: 8,  bottleneck_anchor_required: true  },
};

export function getTierContribution(feedName: string): TierContribution {
  return TIER_TABLE[classifySourceTier(feedName)];
}
