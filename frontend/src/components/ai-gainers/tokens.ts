// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — shared tokens, labels and formatters for the research
// triage UI.                                                       (zzz770)
//
// Colour is used ONLY for status meaning. Nothing here names an action on a
// price: the triage words are Review / Investigate / Monitor / Thesis
// evidence / No catalyst / Negative evidence — never a trade instruction.
// ═══════════════════════════════════════════════════════════════════════════

import { CATALYST_WINDOWS } from '@/lib/ai-gainers/research-view';
import type {
  EventClass, GapLevel, Persistence, ResearchItem, SourceConfidence, Stage, Transmission,
} from '@/lib/ai-gainers/research-view';

export const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  text: 'var(--mc-text-1)', dim: 'var(--mc-text-2)', faint: 'var(--mc-text-3)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: '#F59E0B',
  cyan: 'var(--mc-cyan)', violet: '#A78BFA',
};

/** A tinted fill from a theme variable (hex-alpha on var() is invalid CSS). */
export const tint = (color: string, pct = 12) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export const NOT_DISCLOSED = 'Not disclosed';

export const pct = (v: number | null | undefined, digits = 1): string =>
  typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%` : '—';

/** zzz771: the earnings mini never mixes "—" with "Not disclosed" — the owner
 *  read the dash as "zero / flat". A missing figure is said in words. */
export const pctND = (v: number | null | undefined, digits = 1): string =>
  typeof v === 'number' && Number.isFinite(v) ? pct(v, digits) : NOT_DISCLOSED;

export const moveColor = (v: number | null | undefined) =>
  typeof v !== 'number' || !Number.isFinite(v) ? C.faint : v >= 0 ? C.green : C.red;

export function money(v: number | null | undefined, m: 'IN' | 'US'): string {
  if (v == null || !Number.isFinite(v)) return NOT_DISCLOSED;
  if (m === 'US') { const a = Math.abs(v); return a >= 1000 ? `$${(v / 1000).toFixed(a >= 100_000 ? 0 : 1)}B` : `$${a >= 100 ? Math.round(v) : v.toFixed(1)}M`; }
  return `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1)} Cr`;
}

/** Text that may be missing: never print "null"/"undefined"/"NaN". */
export const txt = (s: string | null | undefined, fallback = NOT_DISCLOSED): string => {
  if (s == null) return fallback;
  const t = String(s).trim();
  return !t || /^(null|undefined|nan)$/i.test(t) ? fallback : t;
};

export function istClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })} IST`;
}

export function sessionDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00Z` : date);
  if (!Number.isFinite(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export const CLASS_META: Record<EventClass, { pill: string; short: string; color: string; meaning: string }> = {
  CONFIRMED_MATERIAL: { pill: '🟢 CONFIRMED MATERIAL EVENT', short: 'Confirmed', color: C.green, meaning: 'Verified, economically meaningful event.' },
  CONFIRMED_LOW_MATERIALITY: { pill: '🔵 CONFIRMED · LOW MATERIALITY', short: 'Confirmed · small', color: C.cyan, meaning: 'Real event, too small on its own to explain the move.' },
  POTENTIAL_UNVERIFIED: { pill: '🟡 POTENTIAL · UNVERIFIED', short: 'Potential', color: C.amber, meaning: 'Something exists, but it is not verified from a primary document.' },
  NEGATIVE: { pill: '🔴 NEGATIVE EVIDENCE', short: 'Negative', color: C.red, meaning: 'A genuine negative filing (tax demand, departure, cancellation, denial) — kept even though the stock rose.' },
  NO_CATALYST: { pill: '⚪ NO IDENTIFIED CATALYST', short: 'No catalyst', color: C.faint, meaning: 'Checked: no credible event in the window.' },
  MARKET_MOVE_ONLY: { pill: '⚪ MARKET MOVE ONLY', short: 'Band / technical', color: C.faint, meaning: 'Price-band or technical movement. Does not establish demand.' },
  LISTING: { pill: '⚪ RECENT LISTING', short: 'Listing', color: C.faint, meaning: 'Too little price history — excluded from fundamental comparison.' },
  DATA_UNAVAILABLE: { pill: '⚠ DATA UNAVAILABLE', short: 'Data unavailable', color: C.amber, meaning: 'Sources failed. This is not the same as "no data found".' },
};

/** The triage word — what kind of attention the item deserves. */
export function triageLabel(it: ResearchItem): { label: string; color: string } {
  const held = it.portfolio?.relevance === 'HOLDING';
  switch (it.eventClass) {
    case 'CONFIRMED_MATERIAL': return held ? { label: 'Thesis evidence', color: C.green } : { label: 'Investigate', color: C.green };
    case 'CONFIRMED_LOW_MATERIALITY': return held ? { label: 'Thesis evidence', color: C.cyan } : { label: 'Monitor', color: C.cyan };
    case 'POTENTIAL_UNVERIFIED': return { label: held ? 'Review' : 'Monitor', color: C.amber };
    case 'NEGATIVE': return { label: 'Negative evidence', color: C.red };
    case 'NO_CATALYST': case 'MARKET_MOVE_ONLY': return { label: 'No catalyst', color: C.faint };
    case 'LISTING': return { label: 'Monitor', color: C.faint };
    case 'DATA_UNAVAILABLE': return { label: 'Review', color: C.amber };
    default: return { label: 'Review', color: C.faint };
  }
}

export const SOURCE_META: Record<SourceConfidence, { label: string; color: string; hover: string }> = {
  VERIFIED_DOCUMENT: { label: 'VERIFIED DOCUMENT', color: C.green, hover: 'The source document was read and the quoted text was found in it.' },
  VERIFIED_FILING: { label: 'EXCHANGE FILING', color: C.cyan, hover: 'An exchange filing exists for this event. Its subject is verified; the full document was not model-read.' },
  SECONDARY_SUMMARY: { label: 'SUMMARY ONLY', color: C.amber, hover: "Only a third-party summary of the filing was available. Treat figures as unconfirmed until the document is opened." },
  UNVERIFIED: { label: 'UNVERIFIED', color: C.red, hover: 'No primary source. An unverified item can raise an alert; it cannot, alone, justify research priority.' },
};

export const STAGE_META: Record<Stage, { label: string; hover: string }> = {
  RUMOUR: { label: 'RUMOUR', hover: 'Reported, not filed.' },
  PROPOSED: { label: 'PROPOSED', hover: 'Board to consider / proposal stage.' },
  ENABLING: { label: 'ENABLING', hover: 'An enabling approval — nothing contracted yet.' },
  SIGNED: { label: 'SIGNED', hover: 'Agreement signed; economics may still be pending.' },
  AWARDED: { label: 'AWARDED', hover: 'Order / contract awarded; execution ahead.' },
  EXECUTED: { label: 'EXECUTED', hover: 'Transaction completed / money moved.' },
  OPERATIONAL: { label: 'OPERATIONAL', hover: 'Capacity or product is running.' },
  MONETIZING: { label: 'MONETIZING', hover: 'Contributing revenue now.' },
  UNKNOWN: { label: 'UNKNOWN', hover: 'The stage could not be established from the source.' },
};

export const TRANSMIT_META: Record<Transmission, { label: string; hover: string }> = {
  DIRECT: { label: 'DIRECT', hover: 'Reaches revenue / earnings directly and soon.' },
  NEAR_TERM: { label: 'NEAR-TERM', hover: 'Reaches the income statement within ~1–4 quarters.' },
  LONG_TERM: { label: 'LONG-TERM', hover: 'Reaches the income statement only over years.' },
  WEAK: { label: 'WEAK', hover: 'Weak or indirect link to earnings.' },
  NONE: { label: 'NONE', hover: 'No economic transmission established.' },
};

export const PERSIST_META: Record<Persistence, { label: string; hover: string }> = {
  DAYS: { label: 'DAYS', hover: 'Effect likely lasts days (sentiment, one-off).' },
  QUARTER: { label: 'A QUARTER', hover: 'Effect likely lasts about a quarter.' },
  YEARS: { label: 'YEARS', hover: 'Structural — effect can persist for years.' },
  UNKNOWN: { label: 'NOT ESTABLISHED', hover: 'No term, programme, execution period or economics in the documents set a duration. The event type alone never does.' },
};

export const GAP_META: Record<GapLevel, { label: string; color: string }> = {
  LARGE: { label: 'LARGE GAP', color: C.green },
  MODERATE: { label: 'MODERATE GAP', color: C.cyan },
  SMALL: { label: 'LARGELY PRICED', color: C.amber },
  UNKNOWN: { label: 'UNKNOWN', color: C.faint },
};

export const MATERIAL_COLOR: Record<ResearchItem['materiality']['label'], string> = {
  SIGNIFICANT: C.green, MODERATE: C.cyan, SMALL: C.faint, UNKNOWN: C.faint,
};

export const RELEVANCE_META: Record<ResearchItem['portfolio']['relevance'], { label: string; color: string } | null> = {
  HOLDING: { label: '✓ HOLDING', color: C.cyan },
  WATCHLIST: { label: 'WATCHLIST', color: C.violet },
  SAME_THEME: { label: 'SAME THEME', color: C.violet },
  UNRELATED: null,
};

// ── zzz771: can this event be THIS move's catalyst? ──────────────────────
// The owner saw 47–55-day-old results shown as the "confirmed material event"
// behind today's move. The pipeline now says, per item, whether the event
// falls inside the move window; the UI says it on every card and never
// guesses when the field is absent (older stored findings have no value).
export type CatalystFor = NonNullable<ResearchItem['catalystFor']>;
export const CATALYST_META: Record<CatalystFor, { label: string; color: string; hover: string }> = {
  THIS_MOVE: { label: 'THIS MOVE', color: C.cyan, hover: `Filed within the move window (India: ${CATALYST_WINDOWS.IN.thisMove} calendar days, US: ${CATALYST_WINDOWS.US.thisMove} calendar days, counted on the exchange's own calendar) — can be the catalyst for this move.` },
  RECENT: { label: 'RECENT', color: C.amber, hover: `Filed after the move window but within ${CATALYST_WINDOWS.US.recent} days — a delayed reaction is possible; kept in the queue with a freshness penalty.` },
  CONTEXT: { label: 'CONTEXT', color: C.faint, hover: `Filed more than ${CATALYST_WINDOWS.US.recent} days ago — a real event, but older context. Not this move’s catalyst; never counted as confirmed.` },
};

/** "47d" when the age is known; null when it is not (nothing is invented). */
export const ageText = (it: Pick<ResearchItem, 'ageDays'>): string | null =>
  typeof it.ageDays === 'number' && Number.isFinite(it.ageDays) ? `${Math.max(0, Math.round(it.ageDays))}d` : null;

/** The card title. A bare BSE scrip code ("544501") is not a name the reader
 *  recognises, so the pipeline may supply displayTicker (the company name)
 *  and displayCode (the code, shown small). Fallback: the ticker as before. */
export function displayName(it: Pick<ResearchItem, 'ticker' | 'company' | 'displayTicker' | 'displayCode' | 'issuer'> & { companyName?: string }): { title: string; code: string | null; company: string | null } {
  let title = txt(it.displayTicker, '') || txt(it.ticker, '');
  const bare = /^\d{5,6}$/.test(title);   // no company name known: the code is the title, labelled as a code
  if (bare) title = `BSE ${title}`;
  // a numeric BSE code is shown as "BSE 544434" beside the name, never as the name
  const code = bare ? null : it.issuer?.code ? `BSE ${it.issuer.code}` : txt(it.displayCode, '') || null;
  // zzz835: never an empty name line - the pipeline's companyName (scan / screener / BSE map) fills a missing company.
  const cn = (v: string | null | undefined) => { const t = txt(v, ''); return t && !/^\d+$/.test(t) ? t : null; };
  const company = cn(it.company) || cn(it.companyName);
  const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  return {
    title,
    code: same(code, title) ? null : code,
    // The name line is dropped when the title already IS the name.
    company: same(company, title) ? null : company,
  };
}

/** Materiality arithmetic as one tooltip string. */
export function materialityHover(it: ResearchItem): string {
  const m = it.materiality;
  const lines = (m?.ratios || []).map((r) => r.text).filter(Boolean);
  return [txt(m?.explanation, NOT_DISCLOSED), ...lines].join('\n');
}

/** A market's clock and currency for the header (exchange time, never the browser's). */
export { exchangeClock, CURRENCY } from '@/lib/catalyst/exchange-time';
