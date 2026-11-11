// zzz1178 — reads the stock-screener snapshot for the AI research panels. Server-only.
import { toCand, type Cand, type CandMarket } from './ai-candidates';

export async function loadCands(m: CandMarket): Promise<Cand[]> {
  try {
    const { getSnapshot } = await import('./snapshot-cache');
    const snap: any = await Promise.race([getSnapshot(m), new Promise((r) => setTimeout(() => r(null), 8000))]);
    const rows = (snap?.rows || []) as any[];
    const rs = (await import('./rs-rank')).rsRanks(rows);   // zzz1263
    return rows.map((r) => { const c = toCand(r); if (c) c.rs = rs.get(String(r?.t || '').toUpperCase()) ?? null; return c; }).filter((c): c is Cand => !!c);
  } catch { return []; }
}

