// zzz852 — automatic QA over finished radar items. Pure: no network, no clock.
// It re-reads what the engine produced and counts logic errors a reader would notice. The test runs it on a synthetic batch and expects 0 of each class.

import type { RadarItem } from './multibagger-radar-types';
import { isBoilerplateBreak } from './multibagger-radar-economics';
import { FORM_HEADER_RE, isTitleCopy } from './special-sit-deal-terms';

export const QA_CLASSES = [
  'number-owner mismatch',
  'unsupported earnings link',
  'unsupported duration',
  'unsupported break condition',
  'price-as-evidence',
  'secondary-as-confirmed',
  'generic mechanism text',
  'no-ticker-without-resolution-attempt',
  // zzz854
  'evidence strong but primary not read',
  'earnings link without a subject-owned earnings number',
  'target metric attributed to acquirer',
  'title-copied field',
  'inflection from unverified secondary',
  'evidence fields disagree',
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
  for (const i of items || []) zzz854Checks(i, add);
  const counts = Object.fromEntries(QA_CLASSES.map((c) => [c, 0])) as Record<QaClass, number>;
  for (const e of errors) counts[e.cls] += 1;
  return { total: errors.length, counts, top: errors.slice(0, 20), errors, checked: (items || []).length };
}

// ── zzz854 rules ──────────────────────────────────────────────────────────────
const FIN = new Set(['revenue', 'ebitda', 'pat', 'eps']);
const SUBJECT_ROLES = new Set(['parent', 'subject', 'acquirer']);
const FOREIGN_FIN_ROLES = new Set(['target', 'subsidiary', 'acquired_asset']);
const EARNINGS_KINDS = new Set(['EARNINGS_RESULT', 'OPERATING_INFLECTION', 'MARGIN_INFLECTION', 'FCF_INFLECTION']);

function zzz854Checks(i: RadarItem, add: (i: RadarItem, cls: QaClass, detail: string) => void): void {
  const owned = i.ownedNumbers || [];
  const subjectFin = owned.filter((n) => SUBJECT_ROLES.has(n.entityRole) && FIN.has(n.metric) && n.countsAsParentEarnings && n.nature !== 'forecast');
  const foreignFin = owned.filter((n) => FOREIGN_FIN_ROLES.has(n.entityRole) && FIN.has(n.metric));
  const supplied = i.inflection !== 'NOT_ASSESSED';
  const label = i.evidenceLabel || '';

  // a. evidence reads strong / confirmed (or stage 3+) while the primary document was never read
  if (i.termsRead === false && (/^(?:confirmed|strong)/i.test(label) || i.evidence.status === 'CONFIRMED' || i.evidence.status === 'STRONG' || (i.stageNumber ?? 0) >= 3)) {
    add(i, 'evidence strong but primary not read', `"${label || i.evidence.status}" / stage ${i.stageNumber ?? '-'} on a filing whose terms were not read`);
  }
  if (i.evidence.status === 'STRONG' && (i.evidence.sourceRank == null || i.evidence.sourceRank > 9) && (i.evidence.independentOrigins ?? i.evidence.independentSources) < 2) {
    add(i, 'evidence strong but primary not read', 'STRONG from outlets that share one information origin');
  }

  // b. an earnings link (direct / near-direct) on an earnings-type item with no earnings number owned by the subject
  if ((i.link === 'DIRECT' || i.link === 'NEAR_DIRECT') && EARNINGS_KINDS.has(i.kind) && !subjectFin.length && !supplied) {
    add(i, 'earnings link without a subject-owned earnings number', `${i.link} on ${i.kind} with no revenue / EBITDA / profit figure owned by ${i.company}`);
  }
  if ((i.link === 'DIRECT' || i.link === 'NEAR_DIRECT') && !subjectFin.length && !supplied && foreignFin.length && foreignFin.length === owned.filter((n) => FIN.has(n.metric)).length) {
    add(i, 'earnings link without a subject-owned earnings number', `${i.link} rests only on another entity's figures`);
  }

  // c. a target / subsidiary metric shown as the acquirer's
  for (const n of foreignFin) {
    const step = (i.evidenceChain || []).find((s) => s.state === 'confirmed' && ((n.metric === 'revenue' && /^revenue$/i.test(s.step)) || (n.metric === 'ebitda' && /^ebitda$/i.test(s.step)) || (n.metric === 'pat' && /^(?:earnings|profit)/i.test(s.step))));
    if (step && !subjectFin.some((p) => p.metric === n.metric)) add(i, 'target metric attributed to acquirer', `${n.entity} ${n.metric} ${n.raw} gives a confirmed '${step.step}' step for ${i.company}`);
    const raw = squash(n.raw);
    const imp = Object.values(i.impacts || {}).map(squash);
    if (raw.length >= 3 && imp.some((v) => v.includes(raw) && !v.toLowerCase().includes(String(n.entity || '').toLowerCase()))) add(i, 'target metric attributed to acquirer', `${n.entity} ${n.metric} ${raw} sits in ${i.company}'s impacts`);
  }
  if (foreignFin.length && !subjectFin.length && i.financialOwner && squash(i.financialOwner).toLowerCase() === squash(i.company).toLowerCase()) {
    add(i, 'target metric attributed to acquirer', `financial owner is ${i.company} although the stated figures belong to ${foreignFin[0].entity}`);
  }

  // d. a deal / term field that only copies the headline or an SEC form header
  for (const l of i.dealTermLines || []) {
    if (!l.stated || l.calculated) continue;
    if (FORM_HEADER_RE.test(l.value) || (/^(?:financing|consideration|offer price|conditions|settlement|expiry|minimum|maximum|purchase price)/i.test(l.label) && isTitleCopy(l.value, i.event))) add(i, 'title-copied field', `${l.label}: "${clip(l.value, 60)}" repeats the headline`);
  }

  // f. every evidence / confirmation / stage field must agree when only the form title was seen (filed, terms unproven)
  if (i.termsRead === false) {
    const bad: string[] = [];
    if (i.eventEvidence && i.eventEvidence !== 'FILED_TERMS_NOT_READ' && i.eventEvidence !== 'NOT_APPLICABLE' && i.eventEvidence !== 'DISPROVED') bad.push(`eventEvidence ${i.eventEvidence}`);
    if (i.eventConfirmation === 'CONFIRMED') bad.push('eventConfirmation CONFIRMED');
    if (i.evidence.status === 'CONFIRMED' || i.evidence.status === 'STRONG') bad.push(`evidence ${i.evidence.status}`);
    if ((i.stageNumber ?? 0) >= 2) bad.push(`stage ${i.stageNumber}`);
    if (i.evidenceLabel && !/terms not read/i.test(i.evidenceLabel)) bad.push(`label "${i.evidenceLabel}"`);
    if (i.stageLabel && !/terms not read/i.test(i.stageLabel)) bad.push(`stage label "${i.stageLabel}"`);
    if (/\bconfirmed\b/i.test(i.confirmationLabel || '') && !/not confirmed/i.test(i.confirmationLabel || '')) bad.push('confirmation label says confirmed');
    if (i.firstPrimaryConfirmation) bad.push('firstPrimaryConfirmation set');
    if (bad.length) add(i, 'evidence fields disagree', `terms not read but ${bad.join(', ')}`);
  }
  if (i.eventEvidence === 'FILED_TERMS_NOT_READ' && i.termsRead !== false) add(i, 'evidence fields disagree', 'eventEvidence says terms not read but termsRead is not false');
  if (i.eventEvidence === 'PRIMARY_CONFIRMED' && /terms not read/i.test(i.evidenceLabel || '')) add(i, 'evidence fields disagree', 'Primary-confirmed with a terms-not-read label');

  // e. an inflection (or strong / moderate strength) from an unverified secondary headline
  if (i.kind === 'EARNINGS_RESULT' && i.resultVerified === false && (i.bucket === 'EARNINGS_INFLECTION' || i.inflectionStrength === 'strong' || i.inflectionStrength === 'moderate' || i.catalystDirection === 'positive' || i.catalystDirection === 'negative')) {
    add(i, 'inflection from unverified secondary', `${i.bucket} / ${i.catalystDirection} ${i.inflectionStrength} from a secondary-only headline`);
  }
  if (i.bucket === 'EARNINGS_INFLECTION' && !supplied && (i.evidence.sourceRank == null || i.evidence.sourceRank > 9) && (i.evidence.independentOrigins ?? i.evidence.independentSources) < 2) {
    add(i, 'inflection from unverified secondary', 'earnings inflection from one secondary origin');
  }
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
