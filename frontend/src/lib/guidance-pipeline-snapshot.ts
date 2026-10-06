// zzz861 — the events route sees the live NSE / BSE / SEC feeds; the universe route does not. After every scan the events route saves this small
// snapshot (counts only: source health, queue stages) to KV so the Guidance Universe page can describe the real state of each market.
// Pure builders + a never-throwing reader/writer. No document text, no secrets.
import type { CoverageCard } from './guidance-upgrades-types';
import type { QueueState } from './guidance-upgrades-queue';
import type { GuSourceLine, GuSourceRowState } from './guidance-pipeline-state';

export const SNAPSHOT_KEY = 'guidance-upgrades:pipeline-snapshot:v1';
export const SNAPSHOT_TTL_S = 45 * 86_400;
export interface SnapMarket {
  sources: GuSourceLine[]; scanAt: string; tradingDays: number; daysRead: number; daysPartial: number; daysFailed: number; daysNotRead: number;
  servedFromStaleCache: boolean; staleCacheSavedAt: string | null;
  queue: { awaiting: number; done: number; readNoGuidance: number; unavailable: number; failed: number; total: number };
}
export interface PipelineSnapshot { v: 1; at: string; markets: Partial<Record<'IN' | 'US', SnapMarket>> }

const stateOf = (r: CoverageCard['sources'][number]): GuSourceRowState => (r.status === 'COMPLETE' ? 'OK' : r.status === 'PARTIAL' ? 'PARTIAL' : r.status === 'EMPTY' ? 'EMPTY' : r.queryStatus === 'NOT_AVAILABLE' ? 'NOT_RUN' : 'FAILED');
/** One snapshot from the coverage cards of this run and the queue. Exchange / SEC sources keep their plain names (NSE, BSE, SEC); other rows keep the scan's own name. */
export function snapshotOf(cards: CoverageCard[], queue: QueueState | null, now: Date, prev?: PipelineSnapshot | null): PipelineSnapshot {
  const markets: PipelineSnapshot['markets'] = { ...(prev?.markets || {}) };
  for (const c of cards) {
    const lines: GuSourceLine[] = c.sources.filter((s) => s.tier === 'PRIMARY' || s.tier === 'FALLBACK').map((s) => {
      const nm = /nse/i.test(s.name) ? 'NSE' : /bse/i.test(s.name) ? 'BSE' : /edgar|sec/i.test(s.name) ? 'SEC' : s.name;
      const st = s.tier === 'FALLBACK' && stateOf(s) === 'OK' ? 'STALE' : stateOf(s);
      return { name: nm, state: st, documents: s.recordsRead, daysOk: s.daysSucceeded, daysTried: s.daysAttempted, detail: s.reason ? String(s.reason).slice(0, 160) : null };
    });
    const items = (queue?.items || []).filter((x) => x.market === c.market);
    const open = items.filter((x) => !(x as any).delegated_to && (x.processing_status === 'QUEUED' || x.processing_status === 'READING' || x.processing_status === 'FAILED')).length;   // zzz916: delegated India items are not waiting
    const stale = c.cache.find((r) => (r.servedBy === 'LASTGOOD' || r.servedBy === 'SHARED_LASTGOOD') && r.items > 0) ?? null;
    markets[c.market] = {
      sources: lines, scanAt: now.toISOString(), tradingDays: c.tradingDays, daysRead: c.daysSuccessfullyRead, daysPartial: c.daysPartialCoverage, daysFailed: c.daysFailed,
      daysNotRead: c.daysNotAttempted - c.daysFromEarlierRuns > 0 ? c.daysNotAttempted - c.daysFromEarlierRuns : 0,
      servedFromStaleCache: !!stale, staleCacheSavedAt: null,
      queue: { awaiting: open, done: items.filter((x) => x.processing_status === 'DONE').length, readNoGuidance: items.filter((x) => x.processing_status === 'DONE' && !x.result?.complete).length,
        unavailable: items.filter((x) => x.processing_status === 'SOURCE_UNAVAILABLE').length, failed: items.filter((x) => x.processing_status === 'FAILED').length, total: items.length },
    };
  }
  return { v: 1, at: now.toISOString(), markets };
}
export function validSnapshot(v: any): PipelineSnapshot | null { return v && v.v === 1 && typeof v.at === 'string' && v.markets && typeof v.markets === 'object' ? (v as PipelineSnapshot) : null; }
export async function readSnapshot(): Promise<PipelineSnapshot | null> {
  try { const { kvGet } = await import('./kv'); return validSnapshot(await kvGet<PipelineSnapshot>(SNAPSHOT_KEY)); } catch { return null; }
}
export async function writeSnapshot(s: PipelineSnapshot): Promise<boolean> {
  try { const { kvSet } = await import('./kv'); await kvSet(SNAPSHOT_KEY, s, SNAPSHOT_TTL_S); return true; } catch { return false; }
}
