// zzz1169 — the stored rows as the board shows them: each passes today's review (lib/transformational/core reviewItem) with the
// stock screener's figures and industry. Used by the board and by the AI read, so the AI sees the same clean facts. Server-only.
import { reviewItem, type SnapFacts, type TgItem, type TgMarket } from './core';
import { loadItems } from './store';

async function snapFacts(market: TgMarket): Promise<Map<string, SnapFacts>> {
  const m = new Map<string, SnapFacts>();
  try {
    const { getSnapshot } = await import('../screener/snapshot-cache');
    const snap: any = await Promise.race([getSnapshot(market), new Promise((r) => setTimeout(() => r(null), 4_000))]);
    for (const r of (snap?.rows || [])) if (r?.t) m.set(String(r.t).toUpperCase(), { revQYoY: r.revQYoY ?? null, epsQYoY: r.epsQYoY ?? null, q: r.q ?? null, ind: r.ind ?? null, sec: r.sec ?? null });
  } catch { /* figures from the event only */ }
  return m;
}

export async function loadReviewed(days: number, market?: TgMarket): Promise<TgItem[]> {
  const raw = await loadItems(days, market);
  const mk = [...new Set(raw.map((x) => x.market))];
  const snaps = new Map<TgMarket, Map<string, SnapFacts>>(await Promise.all(mk.map(async (m) => [m, await snapFacts(m)] as const)));
  return raw.map((x) => reviewItem(x, snaps.get(x.market)?.get(x.ticker) || null)).filter((x): x is TgItem => !!x);
}
