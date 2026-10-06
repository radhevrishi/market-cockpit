// zzz883 — pure mapping from engine output to Postgres archive rows (see app/api/v1/intel-archive/route.ts).
import type { GuidanceEvent } from './guidance-upgrades-types';
import type { GuidanceExtractResult } from './guidance-docs-types';

export const ARCHIVE_ENGINE_VERSION = 'zzz883';
export interface EventArchiveRow {
  id: string; market: string; ticker: string | null; company: string | null; eventType: string; eventDate: string | null;
  status: string | null; verification: string | null; materiality: string | null; confidence: string | null; headline: string | null;
  changes: unknown; sourceName: string | null; sourceUrl: string | null; sourceDate: string | null; evidence: string | null;
  engineVersion: string; payload: unknown;
}
const isoDay = (s: unknown): string | null => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** Only events the page SHOWS (cards + audit list) are archived; the review queue is not a finding. */
export function archiveRowsFromEvents(events: readonly GuidanceEvent[]): EventArchiveRow[] {
  const out: EventArchiveRow[] = [];
  for (const e of events) {
    const st = e.pipeline?.status;
    if (st && st !== 'CARD' && st !== 'AUDIT') continue;
    const src = (e.sources || [])[0];
    const firstRaw = (e.changes || []).map((c: any) => c?.after?.raw).find((r: unknown) => typeof r === 'string' && r) as string | undefined;
    out.push({
      id: `gu:${e.guidance_event_id}`, market: e.market, ticker: e.ticker || null, company: e.company || null,
      eventType: `GUIDANCE_${String(e.taxonomy || e.type || 'event').toUpperCase()}`, eventDate: isoDay(e.announcement_date),
      status: st || null, verification: e.verification || null, materiality: e.materiality || null, confidence: e.guidance_quality || null,
      headline: e.displayLabel || null,
      changes: (e.changes || []).map((c: any) => ({ metric: c.metric, period: c.after?.period, before: c.before ? { low: c.before.low, high: c.before.high, unit: c.before.unit, currency: c.before.currency } : null, after: { low: c.after?.low, high: c.after?.high, unit: c.after?.unit, currency: c.after?.currency }, direction: c.direction, pct: c.percentageChange, pp: c.percentagePointChange })),
      sourceName: src?.name || null, sourceUrl: src?.url || null, sourceDate: isoDay(src?.date) || isoDay(e.announcement_date),
      evidence: firstRaw ? firstRaw.slice(0, 600) : null, engineVersion: ARCHIVE_ENGINE_VERSION,
      payload: { whyNow: e.whyNow, decision: e.decision, flags: e.flags, classification: e.classification },
    });
  }
  return out;
}

export function extractionRow(r: GuidanceExtractResult) {
  return {
    docId: r.docId, market: r.market, ticker: r.ticker, company: r.company, docUrl: r.docUrl, docKind: r.docKind,
    filedAt: isoDay(r.filedAt), extractedAt: r.extractedAt || null, model: r.model || null, promptVersion: r.promptVersion || 'pre-zzz883',
    status: r.status, rowCount: (r.rows || []).length, rows: r.rows || [],
  };
}
