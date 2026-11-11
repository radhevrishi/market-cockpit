// zzz1264 — ONE CARD PER COMPANY PER QUARTER on India Earnings Opportunities, across the WHOLE results season.
//
// zzz878 checked only the previous 7 days. A company whose quarter was graded earlier than that and is listed by the
// exchange again (a revised filing, the newspaper copy, a clarification) came back as a new card "reported today":
// AEQUS — Q2 FY27 graded on 27 Oct 2026, a card again on 11 Nov. Now every session of the last 100 days is checked,
// through the shared graded-session reader (compact rows kept in memory, weekends included).
//
// Rule: the EARLIEST session that showed the company's quarter WITH figures keeps the card. A later day lists it under
// "graded on another day" with that date. An earlier card that had no figures (filed, not read yet) does not block a later
// card that has them — the later one is the real card.
// Applied when a day is BUILT and again when it is SERVED, so days stored before this rule are corrected too.
import { gradedSessions, type GradedReadDeps } from './graded-session-index';

export const SHOWN_EARLIER_LOOKBACK_DAYS = 100;
const TIERS = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'] as const;

export interface ShownEarlier { /** ticker|QUARTER → earliest earlier session that showed it with figures */ withFigures: Map<string, string>; /** … with or without figures */ any: Map<string, string>; unread: string[] }

export const shownKey = (ticker: unknown, quarter: unknown): string | null => {
  const t = String(ticker || '').toUpperCase().trim(), q = String(quarter || '').toUpperCase().trim();
  return t && q ? `${t}|${q}` : null;
};

/** The calendar days before `date`, newest first. Pure. */
export function daysBefore(date: string, n = SHOWN_EARLIER_LOOKBACK_DAYS): string[] {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(base)) return [];
  return Array.from({ length: n }, (_, i) => new Date(base - (i + 1) * 86_400_000).toISOString().slice(0, 10));
}

export async function shownEarlierIndex(date: string, deps?: GradedReadDeps): Promise<ShownEarlier> {
  const { sessions, unread } = await gradedSessions(daysBefore(date), deps);
  const withFigures = new Map<string, string>(), any = new Map<string, string>();
  // oldest session first: the first sighting keeps the card
  for (const s of sessions.slice().sort((a, b) => a.d.localeCompare(b.d))) {
    if (s.d >= date) continue;
    for (const r of s.rows) {
      const k = shownKey(r.t, r.q);
      if (!k) continue;
      if (!any.has(k)) any.set(k, s.d);
      if (r.fig && !withFigures.has(k)) withFigures.set(k, s.d);
    }
  }
  return { withFigures, any, unread };
}

const hasFigures = (c: any): boolean => typeof c?.sales_yoy_pct === 'number' || typeof c?.net_profit_yoy_pct === 'number' || typeof c?.sales_curr_cr === 'number' || typeof c?.pat_curr_cr === 'number';

/** The earlier day that keeps this card, or null when this day keeps it. Pure. */
export function earlierDayFor(card: any, idx: Pick<ShownEarlier, 'withFigures' | 'any'>): string | null {
  const k = shownKey(card?.ticker, card?.quarter);
  if (!k) return null;
  return idx.withFigures.get(k) || (!hasFigures(card) ? idx.any.get(k) || null : null);
}

/**
 * A served day without the cards an earlier session keeps: they go to `_other_day_cards` (with `_first_shown`) and are named
 * in `_dropped`. Pure; the input is not changed. Returns the same object when nothing moves.
 */
export function moveShownEarlier<P extends { by_tier?: any; _other_day_cards?: any[]; _dropped?: any[] }>(payload: P, idx: Pick<ShownEarlier, 'withFigures' | 'any'>): P {
  if (!payload?.by_tier) return payload;
  const by_tier: any = { ...payload.by_tier };
  const other = [...(payload._other_day_cards || [])];
  const have = new Set(other.map((c) => String(c?.ticker || '').toUpperCase()));
  const dropped = [...(payload._dropped || [])];
  let moved = 0;
  for (const t of TIERS) {
    const rows: any[] = Array.isArray(payload.by_tier[t]) ? payload.by_tier[t] : [];
    const keep: any[] = [];
    for (const c of rows) {
      const d = earlierDayFor(c, idx);
      if (!d) { keep.push(c); continue; }
      moved++;
      const tk = String(c?.ticker || '').toUpperCase();
      if (!have.has(tk)) { other.push({ ...c, _first_shown: d }); have.add(tk); }
      dropped.push({ ticker: c.ticker, reason: `already shown on ${d} (same ${String(c.quarter)} results)` });
    }
    by_tier[t] = keep;
  }
  return moved ? { ...payload, by_tier, _other_day_cards: other.slice(0, 80), _dropped: dropped, shown_earlier_v: 1 } : payload;
}
