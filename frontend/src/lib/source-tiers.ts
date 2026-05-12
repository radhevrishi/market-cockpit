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

const TIER_DEFS: Array<{ tier: SourceTier; patterns: (string | RegExp)[] }> = [
  // PRIMARY — exchange filings, regulators, official company channels
  {
    tier: 'PRIMARY',
    patterns: [
      /nseindia\.com/i, /bseindia\.com/i, /sebi\.gov\.in/i, /rbi\.org\.in/i,
      /irdai\.gov\.in/i, /tradingeconomics\.com/i, /mca\.gov\.in/i,
      /sec\.gov/i, /federalreserve\.gov/i, /treasury\.gov/i,
      /europa\.eu/i, /ecb\.europa\.eu/i, /pib\.gov\.in/i, /commerce\.gov\.in/i,
      /press release/i, /company filing/i, /corporate announcement/i,
    ],
  },
  // SPECIALIST — vertical press with editorial review (sector-focused)
  {
    tier: 'SPECIALIST',
    patterns: [
      /equitymaster\.com/i, /screener\.in/i, /trendlyne\.com/i,
      /moneycontrol\.com/i, /livemint\.com/i, /mint\.com/i,
      /thehindubusinessline\.com/i, /business-standard\.com/i,
      /economictimes\.indiatimes\.com/i, /financialexpress\.com/i,
      /electronicsweekly/i, /tomshardware/i, /anandtech/i, /semiwiki/i,
      /energyworld/i, /power-eng/i, /windpoweroffshore/i, /pv-magazine/i,
      /naval-technology/i, /defenseworld/i, /janes\.com/i,
      /pharmabiz\.com/i, /chemicalnews/i, /steel360/i, /metalbulletin/i,
    ],
  },
  // SECONDARY — general business news (broad coverage, editorial review)
  {
    tier: 'SECONDARY',
    patterns: [
      /reuters\.com/i, /bloomberg\.com/i, /ft\.com/i, /wsj\.com/i,
      /cnbc\.com/i, /cnbctv18\.com/i, /thehindu\.com/i, /indianexpress\.com/i,
      /forbes\.com/i, /fortune\.com/i, /investing\.com/i, /seekingalpha\.com/i,
      /barrons\.com/i, /marketwatch\.com/i, /yahoo\.com/i,
      /timesofindia\.indiatimes\.com/i,
    ],
  },
];

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
