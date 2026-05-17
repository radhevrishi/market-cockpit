/**
 * PATCH 0221 — Source-tier classification.
 *
 * Institutional terminals separate news sources by editorial / source rigor.
 * Until we add a proper Source table with editor-curated tiers, we classify
 * by domain heuristic here. The four tiers and their meaning are exposed in
 * a small badge on every news card.
 *
 * Tiers:
 *   PRIMARY     — exchange filings, regulator statements, company PR.
 *                  Highest trust; severity can be HIGH on a single article.
 *   SPECIALIST  — vertical trade press with editorial review.
 *   SECONDARY   — general business news (Reuters, Bloomberg main desk).
 *   AGGREGATOR  — reprint sites, blogs, no editorial review.
 *                  Severity stays LOW unless corroborated by ≥3 articles.
 *
 * Add new domain rules here as they come up; the heuristic is intentionally
 * conservative (default = SECONDARY when the domain isn't recognised).
 */

import { TOKENS } from './design-tokens';

export type SourceTier = 'PRIMARY' | 'SPECIALIST' | 'SECONDARY' | 'AGGREGATOR';

// PATCH 0449 NEWS-1 — Recalibrated source tiers per institutional audit.
// User audit explicitly downgrades ET/Mint/Yahoo from SPECIALIST → general
// aggregator (weight 0.35). Investor presentations + concall transcripts +
// definitive filings are the only PRIMARY sources. Specialist trade press
// (sector-vertical reporting only) stays, but generic India business desks
// drop to SECONDARY. Bloomberg / Reuters stay SECONDARY (weight 0.60).
const TIER_DEFS: Array<{ tier: SourceTier; patterns: (string | RegExp)[] }> = [
  // PRIMARY — exchange filings, regulators, official company channels,
  // investor presentations, concall transcripts. Highest trust.
  {
    tier: 'PRIMARY',
    patterns: [
      /nseindia\.com/i, /bseindia\.com/i, /sebi\.gov\.in/i, /rbi\.org\.in/i,
      /irdai\.gov\.in/i, /tradingeconomics\.com/i, /mca\.gov\.in/i,
      /sec\.gov/i, /federalreserve\.gov/i, /treasury\.gov/i,
      /europa\.eu/i, /ecb\.europa\.eu/i, /pib\.gov\.in/i, /commerce\.gov\.in/i,
      /press release/i, /company filing/i, /corporate announcement/i,
      /investor presentation/i, /concall transcript/i, /board approval/i,
      /definitive agreement/i, /scheme of arrangement/i,
      /prnewswire/i, /globenewswire/i, /business ?wire/i,
    ],
  },
  // SPECIALIST — true vertical trade press with editorial review (sector-
  // focused). Includes specialist Indian desks like CapMkt, Capitaline,
  // Equitymaster (research-led), and global sector-vertical press.
  {
    tier: 'SPECIALIST',
    patterns: [
      /equitymaster\.com/i, /capitalmarket\.com/i, /capitaline\.com/i,
      /screener\.in/i, /trendlyne\.com/i, /tijorifinance/i,
      /reorg ?research/i, /mergermarket/i, /debtwire/i,
      /electronicsweekly/i, /tomshardware/i, /anandtech/i, /semiwiki/i,
      /energyworld/i, /power-eng/i, /windpoweroffshore/i, /pv-magazine/i,
      /naval-technology/i, /defenseworld/i, /janes\.com/i,
      /pharmabiz\.com/i, /chemicalnews/i, /steel360/i, /metalbulletin/i,
      /argusmedia/i, /platts/i, /icis\.com/i, /crugroup/i,
    ],
  },
  // SECONDARY — general business news (broad coverage, editorial review).
  // Bloomberg / Reuters / Indian general business desks (ET, Mint, MC,
  // BS, BL, FE) — downgraded from SPECIALIST per audit. These rewrite
  // primary filings but rarely add independent reporting; weight 0.6.
  {
    tier: 'SECONDARY',
    patterns: [
      /reuters\.com/i, /bloomberg\.com/i, /ft\.com/i, /wsj\.com/i,
      /cnbc\.com/i, /cnbctv18\.com/i, /thehindu\.com/i, /indianexpress\.com/i,
      /forbes\.com/i, /fortune\.com/i, /investing\.com/i, /seekingalpha\.com/i,
      /barrons\.com/i, /marketwatch\.com/i,
      // Indian general business desks — downgraded from SPECIALIST
      /economictimes\.indiatimes\.com/i, /financialexpress\.com/i,
      /thehindubusinessline\.com/i, /business-standard\.com/i,
      /moneycontrol\.com/i, /livemint\.com/i, /mint\.com/i,
      /timesofindia\.indiatimes\.com/i,
    ],
  },
];

// PATCH 0449 NEWS-1 — Numerical quality weight per tier. Used as a multiplier
// on the priority score so primary filings consistently outrank rewrites.
// Mirrors the institutional weights the user supplied in the audit.
export const SOURCE_QUALITY_WEIGHT: Record<SourceTier, number> = {
  PRIMARY:    1.00,
  SPECIALIST: 0.75,
  SECONDARY: 0.50,
  AGGREGATOR: 0.20,
};

// Per-source overrides for sources that need finer calibration than their
// tier default. Domain-substring match (case-insensitive). Examples:
//   yahoo.com snippets are noisier than the average secondary → 0.35
//   PR Newswire / GlobeNewswire are press releases → PRIMARY tier already
const SOURCE_WEIGHT_OVERRIDES: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /yahoo\.com|seekingalpha\.com/i, weight: 0.35 },
  { pattern: /economictimes|livemint|mint\.com|moneycontrol|financialexpress|business-standard|thehindubusinessline/i, weight: 0.35 },
  { pattern: /timesofindia/i, weight: 0.25 },
];

/** Numeric source quality 0..1. Combines tier default + per-source override. */
export function sourceQualityWeight(sourceName?: string, sourceUrl?: string): number {
  const tier = classifySource(sourceName, sourceUrl);
  const haystack = `${sourceName || ''} ${sourceUrl || ''}`;
  for (const o of SOURCE_WEIGHT_OVERRIDES) {
    if (o.pattern.test(haystack)) return o.weight;
  }
  return SOURCE_QUALITY_WEIGHT[tier];
}

const TIER_FALLBACK: SourceTier = 'AGGREGATOR';

export function classifySource(sourceName?: string, sourceUrl?: string): SourceTier {
  const haystack = `${sourceName || ''} ${sourceUrl || ''}`.toLowerCase();
  if (!haystack.trim()) return TIER_FALLBACK;
  for (const def of TIER_DEFS) {
    for (const p of def.patterns) {
      if (typeof p === 'string' ? haystack.includes(p) : p.test(haystack)) return def.tier;
    }
  }
  return TIER_FALLBACK;
}

export const TIER_VISUAL: Record<SourceTier, { glyph: string; label: string; tone: { solid: string; bg: string; border: string }; description: string }> = {
  PRIMARY: {
    glyph: '◆',
    label: 'PRIMARY',
    tone: TOKENS.state.live,
    description: 'Exchange filings, regulator statements, or official company channel — highest authority.',
  },
  SPECIALIST: {
    glyph: '◇',
    label: 'SPECIALIST',
    tone: TOKENS.semantic.bullish,
    description: 'Vertical trade press with editorial review — strong domain expertise.',
  },
  SECONDARY: {
    glyph: '◯',
    label: 'SECONDARY',
    tone: TOKENS.severity.medium,
    description: 'General business news with editorial review — broad coverage.',
  },
  AGGREGATOR: {
    glyph: '·',
    label: 'AGGREGATOR',
    tone: TOKENS.state.archived,
    description: 'Reprint site, blog, or unrecognised source — corroborate before acting.',
  },
};
