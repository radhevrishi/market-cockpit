// zzz939 — one place that runs a screener build, so the scheduler and "first visit, nothing built yet" never run two at once.
import { buildUsSnapshot } from './us-build';
import { buildInSnapshot } from './in-build';
import type { ScreenMarket } from './types';
import { withBuildLease } from './build-lease';

const running = new Map<ScreenMarket, Promise<{ ok: boolean; rows: number; notes: string[]; ms: number }>>();
const lastKick = new Map<ScreenMarket, number>();

export function isBuilding(m: ScreenMarket): boolean { return running.has(m); }

/** Runs the build (or joins the one already running). */
export function runBuild(m: ScreenMarket) {
  const cur = running.get(m);
  if (cur) return cur;
  const p = withBuildLease(m, () => m === 'IN' ? buildInSnapshot() : buildUsSnapshot(),
    () => ({ ok: true, rows: 0, notes: ['A build for this market is already running in another process; the existing snapshot was kept.'], ms: 0, skipped: true }))
    .finally(() => running.delete(m));
  running.set(m, p);
  return p;
}

/** First visit with no snapshot yet: start a build in the background, at most once every 30 minutes. */
export function kickBuild(m: ScreenMarket): boolean {
  if (running.has(m)) return true;
  if (Date.now() - (lastKick.get(m) || 0) < 30 * 60_000) return false;
  lastKick.set(m, Date.now());
  runBuild(m).catch((e) => console.error(`[screener] ${m} build failed:`, e?.message || e));
  return true;
}
