// zzz1166 — every time a day's AI Daily Gainers research view is built (the page opening, the daily jobs), its transformational
// events are saved. At most once per market and session every 10 minutes per server. Never throws; never blocks the page.
import { transformationalFrom, type TgMarket } from './core';

const last = new Map<string, number>();
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
  const items = transformationalFrom(all.map((it) => ({ ...it, market })), market, sessionDate);
  if (!items.length) return Promise.resolve(0);
  return import('./store').then((s) => s.saveItems(items)).catch((e) => { console.warn('[transformational] save failed:', e?.message || e); last.delete(key); return 0; });
}
