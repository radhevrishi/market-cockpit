// zzz1166 — every time a day's AI Daily Gainers research view is built (the page opening, the daily jobs), its transformational
// events are saved. At most once per market and session every 10 minutes per server. Never throws; never blocks the page.
import { transformationalFrom, type TgMarket } from './core';

const last = new Map<string, number>();

/** ticker → { industry, sector } from the stock-screener snapshot (memory-cached by the server); empty when not ready in 3 s. */
async function industries(market: TgMarket): Promise<Map<string, { ind: string | null; sec: string | null }>> {
  const out = new Map<string, { ind: string | null; sec: string | null }>();
  try {
    const { getSnapshot } = await import('../screener/snapshot-cache');
    const snap: any = await Promise.race([getSnapshot(market), new Promise((r) => setTimeout(() => r(null), 3_000))]);
    for (const r of (snap?.rows || [])) if (r?.t) out.set(String(r.t).toUpperCase(), { ind: r.ind ?? null, sec: r.sec ?? null });
  } catch { /* themes from the event text only */ }
  return out;
}
const EVERY_MS = 10 * 60_000;

/** Every research item of a view, once per ticker (the queue first: it carries the fullest read). */
export function viewItems(view: any): any[] {
  if (!view || typeof view !== 'object') return [];
  const seen = new Set<string>(); const out: any[] = [];
  for (const k of ['top3', 'queue', 'portfolio', 'watch', 'needsReading', 'context', 'items']) {
    for (const it of (Array.isArray(view[k]) ? view[k] : [])) {
      const t = String(it?.ticker || '').toUpperCase();
      if (!t || seen.has(t)) continue;
      seen.add(t); out.push(it);
    }
  }
  return out;
}

export function archiveView(view: unknown, market: TgMarket, sessionDate: string, force = false): Promise<number> {
  const key = `${market}:${sessionDate}`;
  const all = viewItems(view);
  if (!all.length || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return Promise.resolve(0);
  if (!force && Date.now() - (last.get(key) || 0) < EVERY_MS) return Promise.resolve(0);
  last.set(key, Date.now());
  return (async () => {
    // zzz1167 — the company's industry (stock-screener snapshot) names the theme when the event text does not
    const ind = await industries(market);
    const items = transformationalFrom(all.map((it) => { const k = ind.get(String(it.ticker || '').toUpperCase()); return { ...it, market, industry: it.industry ?? k?.ind ?? null, sector: it.sector ?? k?.sec ?? null }; }), market, sessionDate);
    if (!items.length) return 0;
    const s = await import('./store');
    return s.saveItems(items);
  })().catch((e) => { console.warn('[transformational] save failed:', e?.message || e); last.delete(key); return 0; });
}
