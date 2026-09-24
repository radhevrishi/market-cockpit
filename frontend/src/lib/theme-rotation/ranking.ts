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
import { TIER_ORDER, TIER_LABEL } from './types';
import { LAYER_NAME } from './layers';

export const LAYER_WEIGHT: Record<LayerKey, number> = {
  earnings: 1.5, catalysts: 1.4, breadth: 1.2, strength: 1.0, price: 0.8, flow: 0.5, valuation: 0,
};
const SCORED: LayerKey[] = ['earnings', 'catalysts', 'breadth', 'strength', 'price', 'flow'];

/** zzz797 — a direction that counts: compared against an earlier period and
 *  resting on enough names. A 'level' or a low-confidence read never counts. */
const counts = (L: LayerSet, k: LayerKey) => L[k].basis !== 'level' && !L[k].lowConfidence;

function layerPoints(L: LayerSet, k: LayerKey): number {
  const r = L[k];
  const lvl = r.level === 'strong' ? 0.5 : r.level === 'weak' ? -0.5 : 0;
  const damp = r.lowConfidence ? 0.5 : 1;
  switch (r.state) {
    case 'improving': return (counts(L, k) ? 2 + lvl : lvl) * damp;
    case 'weakening': return (-2 + lvl) * damp;
    case 'steady': case 'level': return lvl * 1.4 * damp;
    default: return 0;
  }
}

const POS_V = new Set(['BUY', 'EARLY BUY']);
const NEG_V = new Set(['TRIM', 'AVOID']);

export function assessTheme(id: string, L: LayerSet, flags: Flag[], verdict?: string | null): ThemeAssessment {
  const improving = SCORED.filter((k) => L[k].state === 'improving' && counts(L, k));
  const weakening = SCORED.filter((k) => L[k].state === 'weakening' && !L[k].lowConfidence);
  const has = (k: Flag['kind']) => flags.some((f) => f.kind === k);
  const fundKeys = improving.filter((k) => k === 'earnings' || k === 'catalysts');
  const fundamentals = fundKeys.length > 0;
  const participation = improving.includes('breadth') || improving.includes('flow');
  const evidenceCount = (L.earnings.evidence?.length || 0) + (L.catalysts.evidence?.filter((e) => e.tone === 'pos').length || 0);

  let score = 0;
  for (const k of SCORED) score += layerPoints(L, k) * LAYER_WEIGHT[k];
  score += Math.min(1.5, Math.log2(1 + evidenceCount) * 0.5);
  if (has('early-rotation')) score += 2;
  if (has('breakdown')) score -= 3;
  if (has('short-term-break')) score -= 1.5;
  if (has('defensive')) score -= 1;
  if (has('crowded')) score -= 0.5;

  // zzz797 — tiers coherent with the evidence count:
  //   Research first — 3+ layers genuinely improving incl. earnings/catalysts,
  //                    or an early-rotation signal (which itself needs a real
  //                    fundamental improvement plus a second confirmation);
  //   Worth a look   — a real fundamental improvement, or 2+ improving layers
  //                    that include participation (breadth / volume), or a
  //                    strong theme whose breadth confirms it;
  //   Monitor        — anything resting on price and relative strength alone;
  //   Low priority   — a breakdown, or 2+ layers weakening with none improving.
  const breadthOk = !L.breadth.lowConfidence && (L.breadth.state === 'improving' || (L.breadth.level === 'strong' && L.breadth.state !== 'weakening'));
  let tier: Tier;
  if (has('breakdown') || (weakening.length >= 2 && improving.length === 0)) tier = 'low';
  else if (!has('short-term-break') && ((improving.length >= 3 && fundamentals) || has('early-rotation'))) tier = 'top';
  else if (fundamentals || (improving.length >= 2 && participation) || (L.strength.level === 'strong' && L.price.state !== 'weakening' && breadthOk && weakening.length <= 1)) tier = 'look';
  else tier = 'monitor';

  return {
    id, layers: L, flags, tier, sortKey: +score.toFixed(3),
    why: whyLine(L, flags, improving, weakening), improving, weakening,
    relation: relationLine(tier, verdict, fundKeys, L),
    evidenceLine: evidenceLine(L, improving, weakening),
  };
}

/** zzz797 — the evidence count behind the tier, in words. */
export function evidenceLine(L: LayerSet, improving: LayerKey[], weakening: LayerKey[]): string {
  const name = (k: LayerKey) => LAYER_NAME[k].toLowerCase().replace(' (proxy)', '');
  const fund = (['earnings', 'catalysts'] as LayerKey[]).map((k) => {
    const r = L[k];
    if (r.state === 'unknown') return `${name(k)} no data`;
    if (r.state === 'level') return `${name(k)} level only`;
    if (r.lowConfidence && r.state === 'improving') return `${name(k)} improving on too few names`;
    return `${name(k)} ${r.state}`;
  }).join(', ');
  const known = SCORED.filter((k) => L[k].state !== 'unknown').length;
  return `${improving.length} of ${known} layers with data improving${improving.length ? ` (${improving.map(name).join(', ')})` : ''}${weakening.length ? `, ${weakening.length} weakening` : ''} · ${fund}`;
}

/**
 * zzz797 — HOW THE PRIORITY RELATES TO THE VERDICT. They answer different
 * questions — the verdict is the price call, the priority is where the
 * evidence says to look — and when they disagree the page now says why
 * instead of leaving "Research first" next to "AVOID" unexplained.
 */
export function relationLine(tier: Tier, verdict: string | null | undefined, fundKeys: LayerKey[], L: LayerSet): { agree: boolean; text: string } {
  const v = verdict || '';
  const fundTxt = fundKeys.length ? fundKeys.map((k) => LAYER_NAME[k].toLowerCase()).join(' and ') : '';
  if ((tier === 'top' || tier === 'look') && NEG_V.has(v)) {
    return { agree: false, text: fundTxt
      ? `Fundamentals improving (${fundTxt}), price not confirming yet. The verdict stays ${v} until the price turns — research now, do not buy yet.`
      : `${TIER_LABEL[tier]} on participation, but the price verdict is ${v}. Research, do not buy until the price turns.` };
  }
  if ((tier === 'top') && (v === 'HOLD' || v === 'WATCH')) {
    return { agree: false, text: `Evidence improving ahead of the price. The verdict is ${v} for now — it upgrades only when the price confirms.` };
  }
  if ((tier === 'monitor' || tier === 'low') && POS_V.has(v)) {
    const thin = L.earnings.state === 'unknown' && L.catalysts.state === 'unknown' ? 'no earnings or catalyst evidence on file' : 'earnings and catalysts not improving';
    return { agree: false, text: `Price says ${v}, but the evidence behind it is thin (${thin}). A price-only call — confirm before adding.` };
  }
  return { agree: true, text: 'Price verdict and evidence point the same way.' };
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
  const levels = (['earnings', 'catalysts'] as LayerKey[]).filter((k) => L[k].state === 'level');
  if (levels.length && !pos.length) parts.push(`${levels.map((k) => LAYER_NAME[k].toLowerCase()).join(' and ')}: level only, no earlier period to compare`);
  if (known <= 3) parts.push(`only ${known} of 6 layers have data`);
  return parts.join(' — ') || 'Not enough evidence to say.';
}

/** Tier first, then the hidden evidence score, then name for stability. */
export function rankAssessments<T extends { tier: Tier; sortKey: number; name?: string; id: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.sortKey - a.sortKey || String(a.name || a.id).localeCompare(String(b.name || b.id)));
}
