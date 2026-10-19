// zzz1116 (guidance audit G04) — ONE decision for a guidance point that failed a data check, applied to every ranking. The page said
// "rows whose check failed are kept out of the ranked list", but the high-growth groups were built before the checks ran, so the same
// point stayed in Highest Active / Derived and in the Focus list. Here the violations of one snapshot become a set of entity + metric
// keys; every ranked group row loses those metrics (a row whose headline metric fails leaves the ranking). The record itself stays in
// the universe and under Review, with its checks. Counts are given three ways: checks, guidance points, companies. Pure.
import type { GuHighGrowthGroups, GuHgGroupRow, GuInvariantViolation } from './guidance-universe-types';

export interface QuarantineCounts { checks: number; points: number; companies: number }
type V = GuInvariantViolation | string;

/** entityKey|METRIC for a point-level check, entityKey|* for a record-level one. Count-equation lines (no entity) are not keys. */
export function quarantineKeys(violations: readonly V[] | null | undefined): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const v of violations || []) {
    if (!v || typeof v === 'string' || !v.entityKey) continue;
    const k = `${v.entityKey}|${v.metric ? String(v.metric).toUpperCase() : '*'}`;
    m.set(k, [...(m.get(k) || []), v.code]);
  }
  return m;
}
export function quarantineCounts(violations: readonly V[] | null | undefined): QuarantineCounts {
  const keys = quarantineKeys(violations);
  return { checks: (violations || []).length, points: keys.size, companies: new Set(Array.from(keys.keys()).map((k) => k.split('|')[0])).size };
}
const hit = (keys: Map<string, string[]>, entityKey: string, metric: string | null | undefined) =>
  keys.get(`${entityKey}|*`) || keys.get(`${entityKey}|${String(metric || '').toUpperCase()}`) || null;

/** The groups with every failed point taken out of the rankings; `quarantined` lists what left. */
export function applyQuarantine(groups: GuHighGrowthGroups, violations: readonly V[] | null | undefined): GuHighGrowthGroups {
  const keys = quarantineKeys(violations);
  if (!keys.size || !groups?.cohorts) return groups;
  const out = new Map<string, { entityKey: string; company: string | null; metric: string | null; checks: string[] }>();
  const clean = (list: GuHgGroupRow[] = []): GuHgGroupRow[] => {
    const kept: GuHgGroupRow[] = [];
    for (const r of list) {
      const bad = (m: string | null | undefined) => { const c = hit(keys, r.entityKey, m); if (c) out.set(`${r.entityKey}|${m}`, { entityKey: r.entityKey, company: r.company, metric: m ?? null, checks: c }); return !!c; };
      if (bad(r.headline?.metric)) { (r.metrics || []).forEach((x) => bad(x.metric)); continue; }
      const metrics = (r.metrics || []).filter((x) => !bad(x.metric));
      kept.push(metrics.length === (r.metrics || []).length ? r : { ...r, metrics, text: metrics.map((x) => x.display ? `${x.short ? `${labelOf(x.metric)} ${x.short}` : x.display}` : '').filter(Boolean).join(' · ') || r.text });
    }
    return kept.map((r, i) => ({ ...r, rank: i + 1 }));
  };
  const cohorts = Object.fromEntries(Object.entries(groups.cohorts).map(([c, l]) => [c, clean(l)])) as GuHighGrowthGroups['cohorts'];
  const trust = Object.fromEntries(Object.entries(groups.trust || {}).map(([t, byC]) => [t, Object.fromEntries(Object.entries(byC).map(([c, l]) => [c, clean(l)]))])) as GuHighGrowthGroups['trust'];
  const rows = Object.values(cohorts).flat();
  const tr = Object.values(trust).flatMap((x) => Object.values(x).flat());
  const n = (l: GuHgGroupRow[], f: (r: GuHgGroupRow) => boolean) => l.filter(f).length;
  return {
    ...groups, cohorts, trust, quarantined: Array.from(out.values()),
    counts: { ...groups.counts, rows: rows.length, verified: n(tr, (r) => r.trust === 'verified'), derived: n(tr, (r) => r.trust === 'derived'), partial: n(tr, (r) => r.trust === 'partial'),
      ANNUAL: n(rows, (r) => r.cohort === 'ANNUAL'), MULTI_YEAR_CAGR: n(rows, (r) => r.cohort === 'MULTI_YEAR_CAGR'), QUARTERLY: n(rows, (r) => r.cohort === 'QUARTERLY'),
      companies: new Set(rows.map((r) => r.entityKey)).size },
  };
}
const LABELS: Record<string, string> = { REVENUE: 'Revenue', PAT: 'PAT', NET_PROFIT: 'PAT', EBITDA: 'EBITDA' };
const labelOf = (m: string) => LABELS[m] || m;
