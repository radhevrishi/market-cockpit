// zzz879 — ONE CARD PER COMPANY PER QUARTER on the US Earnings Opportunities page.
//
// A US company can file the same quarter's results twice, a few days apart: the
// 10-Q / 10-K first and the Item 2.02 8-K press release after it (HSCS, ISPR,
// MGLD, LGCY, NTWK, TRAK, MITQ), or two 8-Ks (WOR, ATCH). The window merge
// (lib/us-merge.ts) already keeps one row per ticker, but a one-session view
// showed the company again on the second day — the same quarter, graded twice.
//
// The rule matches India (zzz878): the FIRST session that showed a company's
// quarter keeps the card; a later session lists it under "reported earlier"
// with the day it was shown. One exception: when the earlier card was only a
// PRELIM grade and the later one has the full GAAP numbers, the later card is
// kept — it carries information the earlier one did not.
//
// Each session leaves a small index (ticker|quarter|P or F) so a session can
// check the previous seven without reading their full payloads. Pure helpers
// here; the route does the KV reads.
import { normalizeUsTicker } from './us-earnings-dates';

export const US_SESSION_DEDUPE_VERSION = 1;
export const US_SESSION_LOOKBACK = 7;
export const US_SESSION_INDEX_KEY = (date: string) => `us-graded:session-index:v1:${date}`;
export const US_SESSION_INDEX_TTL_S = 120 * 86_400;

const TIERS = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'] as const;

/** The quarter identity of a graded row: the period end when known, else the label. */
export function usQuarterId(r: any): string | null {
  const pe = String(r?.period_end || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(pe)) return pe;
  const q = String(r?.quarter || '').trim().toUpperCase();
  return q || null;
}

/** Index entries for one session payload: "TICKER|quarter|P" (prelim) or "|F" (full). */
export function sessionIndexOf(payload: any): string[] {
  const out = new Set<string>();
  for (const t of TIERS) for (const r of (payload?.by_tier?.[t] || [])) {
    const q = usQuarterId(r); const tk = normalizeUsTicker(r?.ticker);
    if (!q || !tk) continue;
    out.add(`${tk}|${q}|${r?.prelim ? 'P' : 'F'}`);
  }
  return Array.from(out);
}

/** The weekday sessions before `date`, newest first. */
export function priorSessions(date: string, n = US_SESSION_LOOKBACK): string[] {
  const out: string[] = [];
  let t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return out;
  for (let i = 0; out.length < n && i < n * 3; i++) {
    t -= 86_400_000;
    const d = new Date(t); const w = d.getUTCDay();
    if (w === 0 || w === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface EarlierSession { date: string; index: string[] }

/**
 * Remove from a one-session payload every card whose company+quarter was
 * already shown on an earlier session, and list it under pending as
 * "reported-earlier" with `shown_on`. Returns a new payload; the input is
 * untouched. `session_dedupe` stamps the payload so a browser cache can tell an
 * old copy from a checked one.
 */
export function dropShownEarlier<P extends { by_tier?: any; pending?: any[]; notes?: string[] }>(payload: P, earlier: EarlierSession[]): P & { session_dedupe: number } {
  // ticker|quarter → { date of first showing, prelim? } — oldest session wins
  const firstShown = new Map<string, { date: string; prelim: boolean }>();
  for (const s of earlier.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    for (const e of s.index || []) {
      const [tk, q, pf] = String(e).split('|');
      if (!tk || !q) continue;
      const k = `${tk}|${q}`;
      const cur = firstShown.get(k);
      if (!cur) firstShown.set(k, { date: s.date, prelim: pf === 'P' });
      else if (cur.prelim && pf !== 'P') cur.prelim = false;   // a full card was shown at some point
    }
  }
  const by_tier: any = {};
  const moved: any[] = [];
  for (const t of TIERS) {
    by_tier[t] = [];
    for (const r of (payload?.by_tier?.[t] || [])) {
      const q = usQuarterId(r); const tk = normalizeUsTicker(r?.ticker);
      const hit = q && tk ? firstShown.get(`${tk}|${q}`) : undefined;
      // keep the later card when only a PRELIM was shown before and this one has the full numbers
      if (hit && !(hit.prelim && !r?.prelim)) {
        moved.push({ ticker: r.ticker, company: r.company, form: r.form, filed: r.filing_date, filing_url: r.filing_url || r.source_url || '', reason: 'reported-earlier', shown_on: hit.date, quarter: r.quarter || null });
        continue;
      }
      by_tier[t].push(r);
    }
  }
  // keep any other tier key the payload carries
  for (const k of Object.keys(payload?.by_tier || {})) if (!(k in by_tier)) by_tier[k] = payload.by_tier[k];
  const notes = (payload.notes || []).filter((n) => !/^already shown on an earlier session/.test(n));
  if (moved.length) notes.unshift(`already shown on an earlier session: ${moved.map((m) => `${m.ticker} (${m.shown_on})`).join(', ')} — same quarter, listed under "reported earlier" instead of a second card`);
  return { ...payload, by_tier, pending: [...(payload.pending || []), ...moved], notes, session_dedupe: US_SESSION_DEDUPE_VERSION };
}
