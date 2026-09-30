// zzz843 — My Book overlay for Guidance Upgrades. Client-safe and pure. The server never knows the holdings:
// the page reads them in the browser and this marks events. It only sets links.inBook / bookThesisLabel /
// portfolioImpact. It never recommends adding.
import type { GuidanceEvent, GuPortfolioImpact, GuThesis } from './guidance-upgrades-types';
import { normSymbol } from './portfolio-symbols';

/** How the raise reads against the thesis the owner already holds. Uses existing fields only. */
export function portfolioImpactOf(e: GuidanceEvent, bookThesis: GuThesis): GuPortfolioImpact {
  const anyDown = e.changes.some((c) => c.direction === 'DOWN');
  if (anyDown) return 'WEAKENS';
  if (e.verification !== 'VERIFIED') return 'NEUTRAL';
  if (e.expectationGap === 'NEGATIVE' && e.decision === 'REJECT') return 'NEUTRAL';
  if (e.duration === 'ONE_OFF' || e.materiality === 'LOW') return 'NEUTRAL';
  if (bookThesis && e.thesis && bookThesis !== e.thesis) return 'NEUTRAL';
  if (e.materiality === 'HIGH' || e.materiality === 'MEDIUM') return 'SUPPORTS';
  return 'NEUTRAL';
}

export function overlayBook(events: GuidanceEvent[], held: ReadonlyArray<string>, thesisByTicker: Record<string, GuThesis> = {}): GuidanceEvent[] {
  const set = new Set(held.map(normSymbol));
  return events.map((e) => {
    const k = normSymbol(e.ticker);
    if (!k || !set.has(k)) return { ...e, links: { ...e.links, inBook: false } };
    const thesis = thesisByTicker[k] ?? null;
    return { ...e, links: { ...e.links, inBook: true, bookThesisLabel: thesis, portfolioImpact: portfolioImpactOf(e, thesis) } };
  });
}

export function countInBook(events: GuidanceEvent[]): number {
  return events.filter((e) => e.links.inBook).length;
}
