// zzz843 — My Book overlay for Guidance Upgrades. Client-safe and pure. The server never knows the holdings:
// the page reads them in the browser and this marks events. It only sets links.inBook / bookThesisLabel /
// portfolioImpact. It never recommends adding.
import type { GuidanceEvent, GuPortfolioImpact, GuThesis } from './guidance-upgrades-types';
import { normSymbol } from './portfolio-symbols';

/** How the raise reads against the thesis the owner already holds. Uses existing fields only. */
export function portfolioImpactOf(e: GuidanceEvent, bookThesis: GuThesis): GuPortfolioImpact {
  // zzz854: an item that is not a verified card / audit row (queued, invalid, stale, capital raise) says nothing about the thesis
  if (e.pipeline && e.pipeline.status !== 'CARD' && e.pipeline.status !== 'AUDIT') return 'NEUTRAL';
  const anyDown = e.changes.some((c) => c.direction === 'DOWN') || (e.otherChanges ?? []).some((c) => c.direction === 'DOWN' && !!c.before);
  if (anyDown) return 'WEAKENS';
  if (e.verification !== 'VERIFIED') return 'NEUTRAL';
  if (e.expectationGap === 'NEGATIVE' && e.decision === 'REJECT') return 'NEUTRAL';
  if (e.duration === 'ONE_OFF' || e.materiality === 'LOW') return 'NEUTRAL';
  if (bookThesis && e.thesis && bookThesis !== e.thesis) return 'NEUTRAL';
  if (e.materiality === 'HIGH' || e.materiality === 'MEDIUM') return 'SUPPORTS';
  return 'NEUTRAL';
}

/**
 * zzz1119 (guidance audit G08) — a holding is its MARKET + ticker: India HAL (Hindustan Aeronautics) is not US HAL (Halliburton).
 * Held entries are "IN:HAL" / "US:HAL"; a bare entry (the India book stores bare NSE symbols, sometimes with .NS / .BO) counts as
 * India only — it is never assigned to both markets. US tickers compare with '.' and '-' as the same (BRK-B = BRK.B).
 */
export function bookKey(market: string | null | undefined, ticker: unknown): string {
  const m = /\.(NS|BO|NSE|BSE)$/i.test(String(ticker ?? '').trim()) ? 'IN' : market === 'US' ? 'US' : 'IN';   // an exchange suffix names the market
  const t = m === 'US' ? String(ticker ?? '').trim().toUpperCase().replace(/-/g, '.') : normSymbol(ticker);
  return t ? `${m}:${t}` : '';
}
export function heldKeySet(held: ReadonlyArray<string>): Set<string> {
  const out = new Set<string>();
  for (const h of held) {
    const m = /^(IN|US|NSE|BSE):(.+)$/i.exec(String(h || '').trim());
    const k = m ? bookKey(/^US$/i.test(m[1]) ? 'US' : 'IN', m[2]) : bookKey('IN', h);
    if (k) out.add(k);
  }
  return out;
}

export function overlayBook(events: GuidanceEvent[], held: ReadonlyArray<string>, thesisByTicker: Record<string, GuThesis> = {}): GuidanceEvent[] {
  const set = heldKeySet(held);
  return events.map((e) => {
    const k = bookKey(e.market, e.ticker);
    if (!k || !set.has(k)) return { ...e, links: { ...e.links, inBook: false } };
    const thesis = thesisByTicker[normSymbol(e.ticker)] ?? null;
    return { ...e, links: { ...e.links, inBook: true, bookThesisLabel: thesis, portfolioImpact: portfolioImpactOf(e, thesis) } };
  });
}

export function countInBook(events: GuidanceEvent[]): number {
  return events.filter((e) => e.links.inBook).length;
}
