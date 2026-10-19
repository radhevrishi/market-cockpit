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
export const POINT_DETAIL_ONLY = ['history', 'sources', 'priors', 'primarySourceText', 'primarySourceReadText',
  // zzz1139: read by no page (checked with a test); the full row still has them
  'periodNote', 'verificationReason', 'sourceMetricLabel'] as const;
/** Universe row fields used only in detail. */
export const ROW_DETAIL_ONLY = ['history', 'sources', 'activeNote', 'periodNote', 'verificationReason', 'sourceMetricLabel'] as const;
/** zzz1139 — the list reads one source (the primary or the first) for its tooltip and one history row (the revision behind the
 *  RAISED / CUT tag, see priorAfter); the full lists arrive with the opened record. */
function listHistory(h: unknown): unknown {
  if (!Array.isArray(h)) return h;
  const rows = h.filter((x: any) => x && typeof x.old === 'string' && x.old.trim() && x.next).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const pick: any = rows.find((x: any) => x.revision === 'RAISED' || x.revision === 'LOWERED') || rows[0];
  return pick ? [{ date: pick.date, old: pick.old, next: pick.next, period: pick.period, revision: pick.revision }] : [];
}

/**
 * zzz1139 — list rows leave out keys whose value is null or false. The list code treats a missing value like null / false
 * (it uses `== null`, `?.` and truthiness, never `=== null` / `=== false` on a row, point or record — a test keeps it so).
 * Arrays, numbers, zero and empty text are kept as they are. Cuts the lean list by about a quarter.
 */
/** read as a real boolean by the company summary (`typeof … === 'boolean'`), so false is kept */
const KEEP_FALSE = new Set(['primarySourceRead']);
export function dropNullFalse<T>(o: T): T {
  if (Array.isArray(o)) return o.map(dropNullFalse) as unknown as T;
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (v !== null && v !== undefined && (v !== false || KEEP_FALSE.has(k))) out[k] = dropNullFalse(v);
  return out as T;
}

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
    if ('history' in rec) rec.history = listHistory(rec.history);
    if (Array.isArray(rec.sources) && rec.sources.length) {
      const s0 = rec.sources.find((x: any) => x?.primary) || rec.sources[0];
      rec.sources = [{ name: s0?.name, date: s0?.date ?? null, primary: !!s0?.primary }];
    }
    if (rec.primary) rec.primary = omit(rec.primary, POINT_DETAIL_ONLY);
    if (Array.isArray(rec.others)) rec.others = rec.others.map((p: any) => omit(p, POINT_DETAIL_ONLY));
  }
  const out: Record<string, any> = { ...omit(r, ROW_DETAIL_ONLY), record: rec, lean: true };
  if (Array.isArray(r.points)) out.points = r.points.map((p: any) => omit(p, POINT_DETAIL_ONLY));
  return dropNullFalse(out) as T;
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
