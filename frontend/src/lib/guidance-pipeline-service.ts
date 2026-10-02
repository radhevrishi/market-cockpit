// zzz861 — one bounded read of everything the pipeline state needs (KV only; no network to exchanges, no AI, no document fetch), and the assembly of the
// per-market pipeline view: data quality (distinct states), the guidance claims table, the wanted-companies list, the queue stages and every recent window.
// Never throws: a store that cannot be read leaves that part empty and says so in `errors`.
import type { Coverage } from './guidance-docs-store';
import type { GuidanceDocIndexRow, GuidanceExtractResult } from './guidance-docs-types';
import type { GuQueueItem } from './guidance-upgrades-types';
import type { GuUniverseRecordX } from './guidance-universe';
import { resolveClaims, claimCountsOf, wantedFromClaims, queueStageCounts, type GuidanceClaim, type WantedCompany, type QueueStage } from './guidance-claims';
import { dataQualityOf, dataQualityFrom, withClaimCounts, type GuDataQuality } from './guidance-pipeline-coverage';
import { windowQuery, WINDOW_DAYS, type GuWindowKey, type WindowQuery } from './guidance-pipeline-windows';
import type { PipelineSnapshot } from './guidance-pipeline-snapshot';

export interface PipelineEvidence { docs: GuidanceDocIndexRow[]; extracted: GuidanceExtractResult[]; queue: GuQueueItem[]; coverage: { IN: Coverage | null; US: Coverage | null }; snapshot: PipelineSnapshot | null; errors: string[] }
export interface EvidenceIo { get: <T = any>(k: string) => Promise<T | null>; mget: <T = any>(ks: string[]) => Promise<Array<T | null>> }
export const emptyEvidence = (): PipelineEvidence => ({ docs: [], extracted: [], queue: [], coverage: { IN: null, US: null }, snapshot: null, errors: [] });

export async function loadPipelineEvidence(io?: EvidenceIo): Promise<PipelineEvidence> {
  const ev = emptyEvidence();
  try {
    const kv = await import('./kv'); const x: EvidenceIo = io ?? { get: (k) => kv.kvGet(k), mget: (ks) => kv.kvMGet(ks) };
    const reader = await import('./guidance-extract-reader'); const snap = await import('./guidance-pipeline-snapshot'); const q = await import('./guidance-upgrades-queue');
    const guard = async <T>(label: string, p: Promise<T>, fb: T): Promise<T> => { try { return await p; } catch (e: any) { ev.errors.push(`${label}: ${String(e?.message || e).slice(0, 80)}`); return fb; } };
    const [idx, list, cIN, cUS, sn, qs] = await Promise.all([
      guard('docs index', x.get<any>('guidance-docs:v1:index'), null),
      guard('extract results', reader.listExtractResults({ includeEmpty: true, io: x }), { results: [], indexed: 0, read: 0 } as any),
      guard('coverage IN', x.get<Coverage>('guidance-docs:v1:coverage:IN'), null), guard('coverage US', x.get<Coverage>('guidance-docs:v1:coverage:US'), null),
      guard('scan snapshot', x.get<any>(snap.SNAPSHOT_KEY), null), guard('queue', io ? x.get<any>(q.QUEUE_KEY) : q.readQueue(), null),
    ]);
    ev.docs = Array.isArray(idx?.rows) ? idx.rows : []; ev.extracted = list?.results ?? []; ev.coverage = { IN: cIN, US: cUS };
    ev.snapshot = snap.validSnapshot(sn); ev.queue = Array.isArray((qs as any)?.items) ? (qs as any).items : [];
  } catch (e: any) { ev.errors.push(String(e?.message || e).slice(0, 80)); }
  return ev;
}

export interface PipelineView {
  quality: GuDataQuality; claims: GuidanceClaim[]; wanted: WantedCompany[];
  claimCounts: Record<'IN' | 'US', { claims: number; primaryFound: number; primaryRead: number; verified: number; contradicted: number; awaiting: number; documentsPending: number }>;
  queueStages: Record<'IN' | 'US', Record<QueueStage, number>>;
}
/** The state of both markets from the evidence plus the universe's own lists. `activeByMarket` = Active rows that are verified / derived from company documents. */
export function pipelineView(ev: PipelineEvidence, claimRows: GuUniverseRecordX[], activeByMarket: Record<'IN' | 'US', number>, now: Date, contradicted: string[] = []): PipelineView {
  const done = new Set(ev.extracted.map((r) => r.docId));
  const docs = ev.docs.map((r) => (done.has(r.docId) ? { ...r, extracted: true } : r));
  const claims = resolveClaims(claimRows, { docs, extracted: ev.extracted, queue: ev.queue, contradicted });
  const counts = claimCountsOf(claims, activeByMarket);
  const base = dataQualityOf(docs, ev.coverage, now, 120, { snapshot: ev.snapshot, claims: counts });
  const quality = dataQualityFrom(withClaimCounts(base.markets.IN, counts.IN), withClaimCounts(base.markets.US, counts.US));
  const byDoc = new Map(ev.extracted.map((r) => [r.docId, r] as const));
  const cc = (m: 'IN' | 'US') => ({ ...counts[m], awaiting: claims.filter((c) => c.market === m && c.claim_status === 'AWAITING_PRIMARY').length, documentsPending: quality.markets[m].documentsPending });
  return { quality, claims, wanted: wantedFromClaims(claims), claimCounts: { IN: cc('IN'), US: cc('US') },
    queueStages: { IN: queueStageCounts(ev.queue as any, byDoc, 'IN'), US: queueStageCounts(ev.queue as any, byDoc, 'US') } };
}
export function allWindows(ev: PipelineEvidence, now: Date, market?: 'IN' | 'US'): Record<'IN' | 'US', Record<GuWindowKey, WindowQuery>> {
  const out: any = { IN: {}, US: {} };
  for (const m of ['IN', 'US'] as const) {
    if (market && m !== market) continue;
    const waiting = ev.queue.filter((x) => x.market === m && (x.processing_status === 'QUEUED' || x.processing_status === 'READING' || x.processing_status === 'FAILED')).length;
    for (const k of Object.keys(WINDOW_DAYS) as GuWindowKey[]) out[m][k] = windowQuery(m, k, now, ev.docs.map((r) => (ev.extracted.some((e) => e.docId === r.docId) ? { ...r, extracted: true } : r)), ev.extracted, ev.coverage[m], waiting);
  }
  return out;
}
