// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — RESEARCH PRIORITY  (zzz795)
//
// The ranked view is ordered by the QUALITY and MATERIALITY of the evidence,
// never by the size of a price move. In plain words:
//
//   · Evidence that comes from filings (graded earnings, dated catalysts)
//     counts most; participation (breadth) next; relative strength and price
//     after that; the volume proxy least. Valuation is a level with no history,
//     so it never pushes a theme up.
//   · A theme reaches "Research first" only when at least three layers are
//     improving AND one of them is an earnings or catalyst layer — or when the
//     early-rotation detector fires (fundamentals improving before price).
//     Price and relative strength alone can reach "Worth a look", no higher.
//   · A breakdown drops a theme to "Low priority" whatever else is true.
//   · "Unknown" layers add nothing and subtract nothing.
//
// The ordering number inside a tier is internal. It is never displayed: the
// reader sees a tier word and a "Why:" line built from the layers.
// ═══════════════════════════════════════════════════════════════════════════

import type { Flag, LayerKey, LayerSet, ThemeAssessment, Tier } from './types';
import { TIER_ORDER } from './types';
import { LAYER_NAME } from './layers';

export const LAYER_WEIGHT: Record<LayerKey, number> = {
  earnings: 1.5, catalysts: 1.4, breadth: 1.2, strength: 1.0, price: 0.8, flow: 0.5, valuation: 0,
};
const SCORED: LayerKey[] = ['earnings', 'catalysts', 'breadth', 'strength', 'price', 'flow'];

function layerPoints(L: LayerSet, k: LayerKey): number {
  const r = L[k];
  const lvl = r.level === 'strong' ? 0.5 : r.level === 'weak' ? -0.5 : 0;
  switch (r.state) {
    case 'improving': return 2 + lvl;
    case 'weakening': return -2 + lvl;
    case 'steady': return lvl * 1.4;
    default: return 0;
  }
}

export function assessTheme(id: string, L: LayerSet, flags: Flag[]): ThemeAssessment {
  const improving = SCORED.filter((k) => L[k].state === 'improving');
  const weakening = SCORED.filter((k) => L[k].state === 'weakening');
  const has = (k: Flag['kind']) => flags.some((f) => f.kind === k);
  const fundamentals = improving.includes('earnings') || improving.includes('catalysts');
  const evidenceCount = (L.earnings.evidence?.length || 0) + (L.catalysts.evidence?.filter((e) => e.tone === 'pos').length || 0);

  let score = 0;
  for (const k of SCORED) score += layerPoints(L, k) * LAYER_WEIGHT[k];
  score += Math.min(1.5, Math.log2(1 + evidenceCount) * 0.5);
  if (has('early-rotation')) score += 2;
  if (has('breakdown')) score -= 3;
  if (has('short-term-break')) score -= 1.5;
  if (has('defensive')) score -= 1;
  if (has('crowded')) score -= 0.5;

  let tier: Tier;
  if (has('breakdown') || (weakening.length >= 2 && improving.length === 0)) tier = 'low';
  else if (!has('short-term-break') && ((improving.length >= 3 && fundamentals) || has('early-rotation'))) tier = 'top';
  else if (improving.length >= 2 || fundamentals || (L.strength.level === 'strong' && L.price.state !== 'weakening' && weakening.length <= 1)) tier = 'look';
  else tier = 'monitor';

  return { id, layers: L, flags, tier, sortKey: +score.toFixed(3), why: whyLine(L, flags, improving, weakening), improving, weakening };
}

/** "Why:" — the most material improving layers, then the main caveat. */
export function whyLine(L: LayerSet, flags: Flag[], improving: LayerKey[], weakening: LayerKey[]): string {
  const byWeight = (a: LayerKey, b: LayerKey) => LAYER_WEIGHT[b] - LAYER_WEIGHT[a];
  // A weakening layer is described by its DIRECTION, not its level: "ahead of
  // the market by 19 pts" is not a caveat, "relative-strength line falling" is.
  const said = (k: LayerKey) => `${L[k].headline}${L[k].proxy ? ' (proxy)' : ''}`;
  const pos = [...improving].sort(byWeight).slice(0, 3).map((k) => L[k].headline);
  const negKey = [...weakening].sort(byWeight)[0];
  const parts: string[] = [];
  if (pos.length) parts.push(pos.join(' · '));
  else {
    // Nothing improving: say where it stands on the two most reliable layers,
    // leaving out the one the caveat below will name.
    const steady = (['strength', 'breadth'] as LayerKey[]).filter((k) => L[k].state !== 'unknown' && k !== negKey).map((k) => L[k].headline);
    if (steady.length) parts.push(steady.join(' · '));
  }
  if (negKey) parts.push(`${parts.length ? 'but ' : ''}${LAYER_NAME[negKey].toLowerCase().replace(' (proxy)', '')} weakening: ${said(negKey)}`);
  const flag = flags.find((f) => f.kind === 'breakdown' || f.kind === 'short-term-break' || f.kind === 'crowded');
  if (flag) parts.push(flag.label.toLowerCase());
  const known = (Object.keys(L) as LayerKey[]).filter((k) => k !== 'valuation' && L[k].state !== 'unknown').length;
  if (known <= 3) parts.push(`only ${known} of 6 layers have data`);
  return parts.join(' — ') || 'Not enough evidence to say.';
}

/** Tier first, then the hidden evidence score, then name for stability. */
export function rankAssessments<T extends { tier: Tier; sortKey: number; name?: string; id: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.sortKey - a.sortKey || String(a.name || a.id).localeCompare(String(b.name || b.id)));
}
