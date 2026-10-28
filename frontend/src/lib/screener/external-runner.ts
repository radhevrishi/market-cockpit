import type { ScreenMarket } from './types';
/** Only a recently COMPLETED external build defers web work. Missing, future or stale metadata always uses the web fallback. */
export function externalBuildFresh(meta: any, market: ScreenMarket, now = Date.now()): boolean {
  if (meta?.runner !== 'github') return false;
  const at = Date.parse(String(meta.checkedAt || ''));
  const age = now - at;
  return Number.isFinite(at) && age >= 0 && age < (market === 'IN' ? 60 * 60_000 : 8 * 3600_000);
}
export async function shouldDeferToExternal(market: ScreenMarket): Promise<boolean> {
  if (process.env.SCREENER_RUNNER !== 'github') return false;
  try {
    const { dbQuery } = await import('../db');
    const rows = await dbQuery<{ meta: any }>('SELECT meta FROM screener_snapshot WHERE market = $1', [market]);
    return externalBuildFresh(rows[0]?.meta, market);
  } catch { return false; }
}
