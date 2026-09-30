// zzz843 — Guidance Upgrades tokens. Reuses the Radar's theme-variable palette (light, print friendly):
// colour carries meaning only, tints are transparent mixes, never dark fills.
import type { GuDecision, GuGap, GuPortfolioImpact } from '@/lib/guidance-upgrades-types';
import { R, tint, box } from '@/components/special-situations/radar-tokens';
export { R, tint, box };

export const DECISION_COLOR: Record<GuDecision, string> = {
  IMMEDIATE_BUY: R.green, WATCHLIST: R.cyan, DELAYED_EP: R.amber, REJECT: R.red, UNVERIFIED: R.grey,
};
export const GAP_COLOR: Record<GuGap, string> = {
  LARGE_POSITIVE: R.green, POSITIVE: R.green, SMALL_POSITIVE: R.cyan, INLINE: R.grey, NEGATIVE: R.red, UNKNOWN: R.grey,
};
export const IMPACT_COLOR: Record<GuPortfolioImpact, string> = { SUPPORTS: R.green, NEUTRAL: R.grey, WEAKENS: R.amber, BROKEN: R.red };

export const PRINT_CSS = `
.gu-page{max-width:1180px;margin:0 auto;padding:16px}
@media print{
  .gu-noprint{display:none !important}
  .gu-page, .gu-page *{background:#fff !important;color:#111 !important;box-shadow:none !important}
  .gu-drawer{position:static !important;width:auto !important;border:none !important}
  .gu-card{break-inside:avoid}
}`;

export const RATING_COLOR: Record<'STRONG' | 'OK' | 'WEAK' | 'UNKNOWN', string> = { STRONG: R.green, OK: R.cyan, WEAK: R.red, UNKNOWN: R.grey };
