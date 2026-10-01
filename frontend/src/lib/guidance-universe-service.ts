// zzz848 — Guidance Universe service (server-only): live pipeline + ledger + stored universe + researched data file -> universe build.
// Cache-first: reads the KV caches the Growth Guidance pipeline already reads; no extra scraping. Public data, never holdings.
import seedFile from '../data/growth-guidance-seed.json';
import { getLiveGuidance, withTimeout } from './growth-guidance-live';
import { readGuStored, writeGuStored } from './growth-guidance-ledger';
import { buildUniverse, loadSeedRows, type GuSeedRow, type GuUniverseBuild, type GuStoredDoc } from './guidance-universe';
import type { GgResponse } from './growth-guidance-types';

const MEM_TTL_MS = 2 * 60_000;
export interface GuBundle { at: number; now: Date; build: GuUniverseBuild; seed: { rows: GuSeedRow[]; dropped: number }; scan: GgResponse['scan']; persisted: { IN: boolean; US: boolean } }
let mem: GuBundle | null = null;

export function getSeedRows(): { rows: GuSeedRow[]; dropped: number } {
  try { const r = loadSeedRows(seedFile as unknown); return { rows: r.rows, dropped: r.dropped.length }; } catch { return { rows: [], dropped: 0 }; }
}
/** Both markets are always built together so the India and USA summary buckets are complete whichever market filter the page applies. */
export async function getUniverseBundle(t0: number, force = false): Promise<GuBundle> {
  if (mem && !force && Date.now() - mem.at <= MEM_TTL_MS) return mem;
  const now = new Date();
  const live = await getLiveGuidance('ALL', now, t0, force);
  const [sIN, sUS] = await Promise.all([withTimeout(readGuStored('IN'), 2_500, null), withTimeout(readGuStored('US'), 2_500, null)]);
  const seed = getSeedRows();
  const stored: GuStoredDoc['rows'] = [...(sIN?.rows || []), ...(sUS?.rows || [])];
  const build = buildUniverse(live.all, live.ledger, seed.rows, now, { stored });
  const [pIN, pUS] = await Promise.all([withTimeout(writeGuStored('IN', build.stored, now, sIN), 3_000, false), withTimeout(writeGuStored('US', build.stored, now, sUS), 3_000, false)]);
  mem = { at: Date.now(), now, build, seed: { rows: seed.rows, dropped: seed.dropped }, scan: live.scan, persisted: { IN: pIN, US: pUS } };
  return mem;
}
