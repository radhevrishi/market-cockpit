// zzz852 — automatic QA over finished radar items. Pure: no network, no clock.
// It re-reads what the engine produced and counts logic errors a reader would notice. The test runs it on a synthetic batch and expects 0 of each class.

import type { RadarItem } from './multibagger-radar-types';
import { isBoilerplateBreak } from './multibagger-radar-economics';

export const QA_CLASSES = [
  'number-owner mismatch',
  'unsupported earnings link',
  'unsupported duration',
  'unsupported break condition',
  'price-as-evidence',
  'secondary-as-confirmed',
  'generic mechanism text',
  'no-ticker-without-resolution-attempt',
] as const;
export type QaClass = (typeof QA_CLASSES)[number];
export interface QaError { id: string; cls: QaClass; detail: string }
export interface QaReport { total: number; counts: Record<QaClass, number>; top: QaError[]; errors: QaError[]; checked: number }

const squash = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
const GENERIC_MECH = /changes the share count or cash returned, not what the business earns|a (?:dividend|split|bonus) .* not what the business earns|is a corporate transaction, not (?:the )?(?:business|operations)/i;
const EARNINGS_LANG = /revenue impact not yet visible in reported earnings/i;
const SHAREHOLDER_KINDS = new Set(['TENDER', 'BUYBACK', 'DIVIDEND', 'SPLIT_BONUS', 'ACQUISITION', 'MERGER', 'SPIN_OFF', 'LEGAL', 'CAPITAL_RAISE']);

export function qaErrorsOf(items: RadarItem[]): QaReport {
  const errors: QaError[] = [];
  const add = (i: RadarItem, cls: QaClass, detail: string) => errors.push({ id: i.id, cls, detail });
  for (const i of items || []) {
    const fundamentals = squash([i.financialImpact, ...Object.values(i.impacts || {}), i.priorityReason].join(' | '));
    const dealKind = i.dealTerms?.kind || null;
    const parentFin = (i.ownedNumbers || []).filter((n) => n.entityRole === 'parent' && n.countsAsParentEarnings);

    // 1. number owner: a figure that belongs to someone else shown in a fundamentals field without its owner next to it
    for (const n of i.ownedNumbers || []) {
      if (n.entityRole === 'parent' || n.entityRole === 'transaction' || n.entityRole === 'unknown') continue;
      if (!['revenue', 'ebitda', 'pat', 'eps', 'order_value'].includes(n.metric)) continue;
      const raw = squash(n.raw);
      const owner = String(n.entity || '').toLowerCase();
      const fields = [i.financialImpact, ...Object.values(i.impacts || {}), i.priorityReason].map(squash);
      if (raw.length >= 4 && fields.some((f) => f.includes(raw) && !f.toLowerCase().includes(owner))) add(i, 'number-owner mismatch', `${n.entity} ${n.metric} ${raw} shown without its owner`);
    }
    if ((i.link === 'DIRECT' || i.link === 'NEAR_DIRECT') && (i.ownedNumbers || []).length > 0 && parentFin.length === 0 && (i.ownedNumbers || []).every((n) => n.entityRole !== 'parent' && n.entityRole !== 'transaction' && n.entityRole !== 'unknown') && i.kind === 'SPECIAL_SITUATION') {
      add(i, 'number-owner mismatch', 'link rests on numbers owned by another entity');
    }

    // 2. unsupported earnings link
    if (i.link === 'DIRECT' && parentFin.length === 0 && (i.catalystDirection == null || i.catalystDirection === 'unknown') && i.quantificationStatus !== 'QUANTIFIED') add(i, 'unsupported earnings link', 'DIRECT with no parent-owned reported figure');
    if ((i.link === 'DIRECT' || i.link === 'NEAR_DIRECT') && ((dealKind && SHAREHOLDER_KINDS.has(dealKind) && dealKind !== 'ACQUISITION' && dealKind !== 'MERGER') || i.bucket === 'CORPORATE_ACTION')) add(i, 'unsupported earnings link', `${dealKind || i.bucket} carries a ${i.link} link`);
    if (EARNINGS_LANG.test(fundamentals) && (i.link === 'NOT_APPLICABLE' || i.link === 'NONE' || (dealKind && SHAREHOLDER_KINDS.has(dealKind)))) add(i, 'unsupported earnings link', 'earnings language on a transaction or shareholder payoff');
    if (i.kind === 'EARNINGS_RESULT' && i.bucket === 'EARNINGS_INFLECTION' && !(i.catalystDirection === 'positive' && (i.inflectionStrength === 'strong' || i.inflectionStrength === 'moderate'))) add(i, 'unsupported earnings link', 'called an inflection without a clearly improving positive result');

    // 3. unsupported duration
    if (i.duration.code != null && i.duration.duration_source === 'unknown') add(i, 'unsupported duration', 'a duration with no source');
    if (i.duration.code != null && i.duration.code >= 4 && i.duration.basis !== 'stated') add(i, 'unsupported duration', 'structural duration that the source does not state');

    // 4. unsupported break condition
    if (dealKind && SHAREHOLDER_KINDS.has(dealKind) && (i.breakConditions || []).some(isBoilerplateBreak)) add(i, 'unsupported break condition', 'boilerplate break condition on a transaction');
    if (i.bucket === 'CORPORATE_ACTION' && (i.breakConditions || []).length > 0) add(i, 'unsupported break condition', 'break conditions on a corporate action');

    // 5. price as evidence
    if ((i.thesisIntegrity?.failedChecks || []).some((c) => c.code === 'PRICE_USED_AS_EARNINGS_EVIDENCE')) add(i, 'price-as-evidence', 'integrity check failed');
    if (i.priceResponse && typeof i.priceResponse.pct === 'number') {
      const pct = String(i.priceResponse.pct).replace(/\.0+$/, '');
      if (new RegExp(`(?:^|[^\\d.])${pct.replace('.', '\\.')}\\s?%`).test(squash([i.financialImpact, ...Object.values(i.impacts || {})].join(' | ')))) add(i, 'price-as-evidence', `${pct}% price move inside the fundamentals`);
    }

    // 6. secondary reported as confirmed
    const nonPrimary = i.evidence.sourceRank == null || i.evidence.sourceRank > 9;
    const label = i.evidenceLabel || '';
    if (nonPrimary && /^(?:confirmed|strong)/i.test(label)) add(i, 'secondary-as-confirmed', `label "${label}" on a non-primary source`);
    if (nonPrimary && !label && (i.evidence.status === 'CONFIRMED' || i.evidence.status === 'STRONG')) add(i, 'secondary-as-confirmed', 'no secondary label on a non-primary source');
    if (/secondary/i.test(label) && /confirmed|strong/i.test(label.replace(/^Secondary-reported \(\d+ outlets?\)$/i, ''))) add(i, 'secondary-as-confirmed', 'secondary label mixed with a strength word');

    // 7. generic mechanism text on the card
    if (i.bucket !== 'NOISE' && i.bucket !== 'TECHNICAL' && !i.quarantineReason) {
      const em = squash(i.economicMechanism || '');
      if (!em) { if (i.bucket !== 'CORPORATE_ACTION') add(i, 'generic mechanism text', 'no company-specific mechanism line'); }
      else if (GENERIC_MECH.test(em) || (i.mechanismHelp && em === squash(i.mechanismHelp))) add(i, 'generic mechanism text', 'a definition shown as the mechanism');
    }

    // 8. no ticker with no resolution attempt
    if (!i.ticker && (i.resolutionAttempt ?? 'none') === 'none' && i.bucket !== 'NOISE' && i.bucket !== 'TECHNICAL') add(i, 'no-ticker-without-resolution-attempt', 'no ticker and no recorded attempt to resolve one');
  }
  const counts = Object.fromEntries(QA_CLASSES.map((c) => [c, 0])) as Record<QaClass, number>;
  for (const e of errors) counts[e.cls] += 1;
  return { total: errors.length, counts, top: errors.slice(0, 20), errors, checked: (items || []).length };
}
