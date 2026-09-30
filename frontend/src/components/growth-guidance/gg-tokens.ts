// zzz846 — Growth Guidance tokens. Same light, print-friendly palette as Guidance Upgrades: colour carries meaning only,
// tints are transparent mixes, never dark fills.
import type { GgValidity } from '@/lib/growth-guidance-types';
import type { StatusDot } from '@/lib/growth-guidance-format';
import { R, tint, box } from '@/components/special-situations/radar-tokens';
export { R, tint, box };

export const ORANGE = '#C2570C';
export const STATUS_COLOR: Record<StatusDot['colorKey'], string> = { green: R.green, cyan: R.cyan, amber: R.amber, orange: ORANGE, red: R.red, grey: R.grey };
export const VALIDITY_COLOR: Record<GgValidity, string> = { ACTIVE: R.green, SUPERSEDED: R.grey, ACHIEVED: R.cyan, MISSED: R.red, WITHDRAWN: R.red, EXPIRED: R.grey };

export const PRINT_CSS = `
.gg-page{max-width:1180px;margin:0 auto;padding:16px}
.gg-table{width:100%;border-collapse:collapse;font-size:13px}
.gg-table th{text-align:left;font-size:11px;letter-spacing:.4px;text-transform:uppercase;padding:6px 8px;border-bottom:2px solid var(--mc-bg-4)}
.gg-table td{padding:7px 8px;border-bottom:1px solid var(--mc-bg-4);vertical-align:top}
.gg-table tr.gg-row{cursor:pointer}
.gg-table tr.gg-row:hover{background:color-mix(in srgb, var(--mc-cyan) 8%, transparent)}
.gg-printonly{display:none}
.gg-scroll{overflow-x:auto}
@media (max-width:640px){.gg-page{padding:16px}.gg-hide-sm{display:none}}
@media print{
  .gg-printonly{display:inline !important}
  .gg-noprint{display:none !important}
  .gg-page, .gg-page *{background:#fff !important;color:#111 !important;box-shadow:none !important}
  .gg-drawer{position:static !important;width:auto !important;border:none !important}
  .gg-card{break-inside:avoid}
}`;
