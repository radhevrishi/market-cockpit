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

export interface ShownEarlier { /** ticker|QUARTER → earliest earlier session that showed it with figures */ withFigures: Map<string, string>; /** … with or without figures */ any: Map<string, string>;
  /** zzz1271 — company NAME|QUARTER → the earliest earlier session that showed that company's quarter with figures, and under which ticker */
  byName?: Map<string, { d: string; t: string }>; unread: string[] }

/**
 * zzz1271 — the company, whatever symbol the card carries. On 12 Nov two cards came back under OTHER symbols: "SHYAM" carrying
 * Shyam Metalics (shown 1 Nov as SHYAMMETL) and "ARUR" carrying Karur Vysya Bank (shown 15 Oct as KARURVYSYA). The ticker
 * check could not see them. A company's quarter is one card, under any symbol (also NSE symbol one day, BSE code another).
 */
export const companyNameKey = (company: unknown, quarter: unknown): string | null => {
  const n = String(company || '').toLowerCase().replace(/&amp;/g, '&').replace(/\b(limited|ltd|the)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const q = String(quarter || '').toUpperCase().trim();
  return n.length >= 4 && q ? `${n}|${q}` : null;
};

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
  const withFigures = new Map<string, string>(), any = new Map<string, string>(); const byName = new Map<string, { d: string; t: string }>();
  // oldest session first: the first sighting keeps the card
  for (const s of sessions.slice().sort((a, b) => a.d.localeCompare(b.d))) {
    if (s.d >= date) continue;
    for (const r of s.rows) {
      const k = shownKey(r.t, r.q);
      if (!k) continue;
      if (!any.has(k)) any.set(k, s.d);
      if (r.fig && !withFigures.has(k)) withFigures.set(k, s.d);
      const nk = r.fig ? companyNameKey(r.c, r.q) : null;
      if (nk && !byName.has(nk)) byName.set(nk, { d: s.d, t: String(r.t || '').toUpperCase() });
    }
  }
  return { withFigures, any, byName, unread };
}

const hasFigures = (c: any): boolean => typeof c?.sales_yoy_pct === 'number' || typeof c?.net_profit_yoy_pct === 'number' || typeof c?.sales_curr_cr === 'number' || typeof c?.pat_curr_cr === 'number';

/** The earlier day that keeps this card, or null when this day keeps it. Pure. */
export function earlierDayFor(card: any, idx: Pick<ShownEarlier, 'withFigures' | 'any' | 'byName'>): string | null {
  return earlierSightingFor(card, idx)?.d ?? null;
}
/** The earlier day AND the ticker it was shown under (different from the card's when the match is by company name). Pure. */
export function earlierSightingFor(card: any, idx: Pick<ShownEarlier, 'withFigures' | 'any' | 'byName'>): { d: string; t: string | null } | null {
  const k = shownKey(card?.ticker, card?.quarter);
  if (k) {
    const d = idx.withFigures.get(k) || (!hasFigures(card) ? idx.any.get(k) || null : null);
    if (d) return { d, t: null };
  }
  const nk = companyNameKey(card?.company, card?.quarter);
  const hit = nk ? idx.byName?.get(nk) : undefined;
  return hit ? { d: hit.d, t: hit.t && hit.t !== String(card?.ticker || '').toUpperCase() ? hit.t : null } : null;
}

/**
 * A served day without the cards an earlier session keeps: they go to `_other_day_cards` (with `_first_shown`) and are named
 * in `_dropped`. Pure; the input is not changed. Returns the same object when nothing moves.
 */
export function moveShownEarlier<P extends { by_tier?: any; _other_day_cards?: any[]; _dropped?: any[] }>(payload: P, idx: Pick<ShownEarlier, 'withFigures' | 'any' | 'byName'>): P {
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
      const seen = earlierSightingFor(c, idx);
      if (!seen) { keep.push(c); continue; }
      const d = seen.d;
      moved++;
      // shown under ANOTHER ticker: the figures belong to that company's symbol; the list names it by its real symbol
      const tk = String(seen.t || c?.ticker || '').toUpperCase();
      if (!have.has(tk)) { other.push({ ...c, ...(seen.t ? { ticker: seen.t, _card_ticker: c.ticker } : {}), _first_shown: d }); have.add(tk); }
      dropped.push({ ticker: c.ticker, reason: seen.t ? `the same company's ${String(c.quarter)} results were shown on ${d} as ${seen.t}` : `already shown on ${d} (same ${String(c.quarter)} results)` });
    }
    by_tier[t] = keep;
  }
  return moved ? { ...payload, by_tier, _other_day_cards: other.slice(0, 80), _dropped: dropped, shown_earlier_v: 2 } : payload;
}
