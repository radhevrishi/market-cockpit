// zzz886 — smaller downloads for the Guidance Upgrades page. The list views only need what a row shows; the long text (why this
// decision, value chain, next proof, every past source …) is only read when a company is opened. With `lean=1` the two list
// endpoints drop those detail-only fields and mark each row `lean: true`; opening a row fetches that ONE full record
// (`?id=` for an event, `?entity=` for a universe row). Counts, filters and ranks are computed before this runs, so nothing
// the page counts changes. Pure, unit-tested. Fields kept are the ones the list code reads (checked when this was written).

/** Event fields used only by the opened detail panel (GuDetail). */
export const EVENT_DETAIL_ONLY = ['decisionReason', 'chain', 'revenueImpact', 'ebitdaImpact', 'evidenceGaps', 'historyStats', 'risks', 'marketMissing'] as const;
/** Company-record fields used only by the opened company detail (GuCompanyDetail / GgDetail). */
export const RECORD_DETAIL_ONLY = ['nextProof', 'organicNote', 'driverText', 'links', 'mechanisms', 'catalysts', 'chain', 'breakers', 'map2x2', 'expectationsWhy',
  'structuralDuration', 'credibility', 'valuation', 'earnings', 'surprise', 'portfolio', 'expectations', 'trendText', 'corporateActionGrowth'] as const;
/** Per-guidance-point fields used only in detail (source trail, the stored statement text). */
export const POINT_DETAIL_ONLY = ['history', 'sources', 'priors', 'primarySourceText', 'primarySourceReadText'] as const;
/** Universe row fields used only in detail. */
export const ROW_DETAIL_ONLY = ['history', 'sources'] as const;

const omit = <T extends Record<string, unknown>>(o: T, keys: readonly string[]): T => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (!keys.includes(k)) out[k] = o[k];
  return out as T;
};

export function leanEvent<T extends Record<string, unknown>>(e: T): T {
  return { ...omit(e, EVENT_DETAIL_ONLY), lean: true } as T;
}

export function leanUniverseRow<T extends Record<string, any>>(r: T): T {
  if (!r || typeof r !== 'object') return r;
  const rec = r.record && typeof r.record === 'object' ? omit(r.record, RECORD_DETAIL_ONLY) as Record<string, any> : r.record;
  if (rec && typeof rec === 'object') {
    if (rec.primary) rec.primary = omit(rec.primary, POINT_DETAIL_ONLY);
    if (Array.isArray(rec.others)) rec.others = rec.others.map((p: any) => omit(p, POINT_DETAIL_ONLY));
  }
  const out: Record<string, any> = { ...omit(r, ROW_DETAIL_ONLY), record: rec, lean: true };
  if (Array.isArray(r.points)) out.points = r.points.map((p: any) => omit(p, POINT_DETAIL_ONLY));
  return out as T;
}

/** Applies lean rows to every list in a universe answer, keeping lists that were the same array the same array. */
export function leanUniverseBody(body: Record<string, any>): Record<string, any> {
  const memo = new Map<unknown, unknown>();
  const map = (a: unknown) => { if (!Array.isArray(a)) return a; if (!memo.has(a)) memo.set(a, a.map(leanUniverseRow)); return memo.get(a); };
  const out = { ...body };
  for (const k of ['records', 'reviewQueue', 'claimsAwaiting', 'inactive']) if (k in out) out[k] = map(out[k]);
  return out;
}

export function leanEventsBody(body: Record<string, any>): Record<string, any> {
  return Array.isArray(body?.events) ? { ...body, events: body.events.map(leanEvent) } : body;
}

/** Finds one universe row by its entity key in any list of the answer (for `?entity=`). */
export function findUniverseRow(lists: unknown[][], entityKey: string): unknown | null {
  for (const l of lists) for (const r of l || []) if ((r as any)?.entityKey === entityKey) return r;
  return null;
}
