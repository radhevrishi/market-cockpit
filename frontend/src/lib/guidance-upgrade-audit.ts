// zzz864 — automatic integrity audit of every event counted as a VERIFIED UPGRADE. The count is never changed to look cleaner: each event either passes all 13
// assertions or is listed with the assertion(s) it fails. Pure: it only reads the events the page already holds.
import type { GuidanceEvent, GuChange } from './guidance-upgrades-types';
import { eventBucketOf, GUIDANCE_BUCKETS } from './guidance-upgrades-counts';
import { isReiteration } from './guidance-upgrades-format';

export const UPGRADE_ASSERTIONS = [
  'primary document read', 'old guidance exists', 'new guidance exists', 'same metric', 'same period', 'comparable basis', 'new guidance above old',
  'calculation succeeds', 'not a reiteration', 'not lowered', 'not a capital raise', 'not non-guidance', 'not stale or invalid',
] as const;
export type UpgradeAssertion = typeof UPGRADE_ASSERTIONS[number];
export interface UpgradeAudit { id: string; company: string; ticker: string; market: string; failures: UpgradeAssertion[] }
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const per = (p: string | undefined) => String(p || '').toUpperCase().replace(/\s+/g, '').replace(/^FY(\d{2})$/, 'FY20$1');
const mid = (p: { low: number | null; high: number | null; midpoint: number | null } | null | undefined) => (!p ? null : fin(p.midpoint) ? p.midpoint : fin(p.low) && fin(p.high) ? (p.low + p.high) / 2 : fin(p.low) ? p.low : fin(p.high) ? p.high : null);
const upChanges = (e: GuidanceEvent): GuChange[] => e.changes.filter((c) => c.direction === 'UP');

/** The 13 checks for one event. Returns the failed ones (empty = a sound verified upgrade). */
export function auditUpgrade(e: GuidanceEvent): UpgradeAssertion[] {
  const f: UpgradeAssertion[] = []; const ups = upChanges(e); const head = ups[0] ?? e.changes[0];
  if (!(e.primaryAvailable && e.verification === 'VERIFIED') || (e.primarySourceState && e.primarySourceState !== 'read_numbers_found')) f.push('primary document read');
  if (!e.changes.some((c) => !!c.before)) f.push('old guidance exists');
  if (!head || !head.after || (!fin(head.after.low) && !fin(head.after.high) && !fin(head.after.midpoint))) f.push('new guidance exists');
  if (ups.length && ups.some((c) => !c.before || c.before.metric !== c.after.metric)) f.push('same metric');
  if (ups.length && ups.some((c) => !c.before || per(c.before.period) !== per(c.after.period))) f.push('same period');
  if (ups.length && ups.some((c) => c.before && ((c.before.basis && c.after.basis && c.before.basis !== c.after.basis && c.before.basis !== 'UNSTATED' && c.after.basis !== 'UNSTATED') || (c.before.currency && c.after.currency && c.before.currency !== c.after.currency) || c.before.isGrowthRate !== c.after.isGrowthRate))) f.push('comparable basis');
  if (!ups.length || ups.some((c) => { const a = mid(c.after), b = mid(c.before); return a == null || b == null || !(a > b); })) f.push('new guidance above old');
  if (!ups.length || ups.some((c) => !(fin(c.absoluteChange) || fin(c.percentageChange) || fin(c.percentagePointChange)))) f.push('calculation succeeds');
  if (isReiteration(e) || (e.v2?.ranges?.length ? e.v2.ranges.every((r) => r.klass === 'REITERATION') : false)) f.push('not a reiteration');
  if (e.changes.some((c) => c.direction === 'DOWN')) f.push('not lowered');
  if (String((e as any).taxonomy ?? '') === 'capital_raise_or_financing') f.push('not a capital raise');
  if (/^(qualitative_commentary|analyst_revision|earnings_beat|management_target|operational_disclosure)$/.test(String((e as any).taxonomy ?? '')) || e.changes.some((c) => c.after.valueKind === 'ACTUAL')) f.push('not non-guidance');
  if ((e.validationIssues || []).some((v) => v.severity === 'INVALID' || v.severity === 'REVIEW') || (e as any).excludedFromEvents || (e as any).pipeline?.status === 'DROPPED') f.push('not stale or invalid');
  return f;
}
export interface UpgradeAuditReport {
  checked: number; passed: number; failed: UpgradeAudit[];
  /** the ten buckets and their sum, so the processed total can be re-derived from the events themselves */
  reconciliation: { buckets: Record<string, number>; sum: number; processed: number | null; holds: boolean | null };
  assertions: readonly string[];
}
export function auditUpgrades(events: readonly GuidanceEvent[], processed?: number | null): UpgradeAuditReport {
  const vu = events.filter((e) => eventBucketOf(e) === 'verifiedUpgrades');
  const failed: UpgradeAudit[] = [];
  for (const e of vu) { const fl = auditUpgrade(e); if (fl.length) failed.push({ id: e.guidance_event_id, company: e.company, ticker: e.ticker, market: e.market, failures: fl }); }
  const buckets: Record<string, number> = {};
  for (const e of events) { const b = eventBucketOf(e); buckets[b] = (buckets[b] || 0) + 1; }
  void GUIDANCE_BUCKETS;
  const sum = Object.values(buckets).reduce((a, b) => a + b, 0);
  return { checked: vu.length, passed: vu.length - failed.length, failed, reconciliation: { buckets, sum, processed: processed ?? null, holds: processed == null ? null : sum === processed }, assertions: UPGRADE_ASSERTIONS };
}
