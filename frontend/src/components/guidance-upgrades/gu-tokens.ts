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
/* zzz1120 (guidance audit G09) — use the dashboard width (the 1,180px cap left side space empty while the tables scrolled); a cap only
   for very wide screens. Long paragraphs keep a readable width; tables get a visible scroll cue and a sticky first columns. */
.gu-page{max-width:2200px;margin:0 auto;padding:16px 20px;min-width:0;box-sizing:border-box}
.gu-page p,.gu-page .gu-prose{max-width:110ch}
.gu-scroll{overflow-x:auto;position:relative;background:linear-gradient(to right,var(--mc-bg-1,#fff) 30%,rgba(255,255,255,0)),linear-gradient(to left,var(--mc-bg-1,#fff) 30%,rgba(255,255,255,0)) 100% 0,radial-gradient(farthest-side at 0 50%,rgba(0,0,0,.16),rgba(0,0,0,0)),radial-gradient(farthest-side at 100% 50%,rgba(0,0,0,.16),rgba(0,0,0,0)) 100% 0;background-repeat:no-repeat;background-size:40px 100%,40px 100%,14px 100%,14px 100%;background-attachment:local,local,scroll,scroll}
.gu-scroll table td,.gu-scroll table th{font-variant-numeric:tabular-nums}
.gu-focus-table td{font-size:14px !important;line-height:1.45}
.gu-focus-table td div,.gu-focus-table td span{font-size:12.5px}
.gu-focus-table td.gu-co{min-width:230px}
/* zzz1137 — Compact columns: table A hides Price (5) and EPS estimate (8); table B hides Source (4), Price (6) and EPS estimate (9).
   Expanded detail rows (one cell with colSpan) have no such child, so they are untouched. */
.gu-cols-compact [data-c="price"],.gu-cols-compact [data-c="eps"],.gu-cols-compact [data-c="source"]{display:none}
@media (max-width:760px){.gu-page{padding:12px}.gu-focus-table td.gu-co{min-width:160px}}
@media print{
  .gu-noprint{display:none !important}
  .gu-page, .gu-page *{background:#fff !important;color:#111 !important;box-shadow:none !important}
  .gu-drawer{position:static !important;width:auto !important;border:none !important}
  .gu-card{break-inside:avoid}
}`;

export const RATING_COLOR: Record<'STRONG' | 'OK' | 'WEAK' | 'UNKNOWN', string> = { STRONG: R.green, OK: R.cyan, WEAK: R.red, UNKNOWN: R.grey };

/** zzz853: badge / event tones. Colour carries meaning only (light, print friendly). */
export const TONE_COLOR: Record<'green' | 'amber' | 'violet' | 'grey' | 'red', string> = { green: R.green, amber: R.amber, violet: R.violet, grey: R.grey, red: R.red };
