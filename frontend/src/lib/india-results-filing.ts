// ═══════════════════════════════════════════════════════════════════════════
// zzz1068 — IS THIS NSE ANNOUNCEMENT A RESULTS FILING?  (pure, tested)
//
// The live results scanner (/api/v1/earnings/today-live) read `e.subject || e.desc`
// from NSE's corporate-announcements feed. NSE sends no `subject`: `desc` is the
// CATEGORY ("Outcome of Board Meeting") and the words that say what was filed are in
// `attchmntText` ("… has submitted to the Exchange, the financial results for the
// period ended September 30, 2026"). A bare "Outcome of Board Meeting" is rejected on
// purpose (zzz101: dividends, AGMs, allotments share that category), so every NSE
// filing was rejected and the scanner found NOTHING on NSE — on 17 Oct 2026 it
// returned 0 while KROSS, ICICIBANK, CENTRALBK, IDBI, PSB, INDIACEM, LAGNAM, PARIN,
// TGBHOTELS and BAJAJHCARE had all filed. Those names stayed "board meeting only —
// results not out yet" until Screener.in happened to add the quarter.
//
// This module reads the category AND the attachment text, with the same strictness
// the hub's `isOutcomeForResults` uses (a results phrase AND a reporting period; no
// clarification / reply / newspaper copy / meeting intimation).
// ═══════════════════════════════════════════════════════════════════════════

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Categories that can carry the results themselves (or the company's own
 *  announcement that they are out). Anything else is not a results filing. */
const RESULT_CATEGORY = /outcome of (?:the )?board meeting|outcome of bm|financial results?|integrated filing|^\s*results?\s*$|press release/i;

/** Words that say a document is ABOUT results but is not them. */
const NOT_A_FILING = /clarification|\breply\b|corrigendum|addendum|erratum|newspaper|\bto consider\b|will be held|is scheduled|scheduled (?:to|on|for)|intimation of (?:the )?board meeting|prior intimation|trading window|audio recording|transcript|conference call|earnings call|investor (?:meet|call)|analyst|statement of deviation|monitoring agency|credit rating|delay(?:ed)? in (?:submission|filing)|non[- ]submission|fine levied|\blink of\b/i;

/** A results phrase: what the board approved / the company submitted. */
const RESULT_PHRASE = [
  /submitted to the exchange,?\s+(?:the\s+)?(?:un-?audited\s+|audited\s+|reviewed\s+)?(?:standalone\s+|consolidated\s+)?(?:and\s+consolidated\s+)?financial results?/i,
  /(?:un-?audited|audited|reviewed)\s+(?:standalone\s+(?:and|&)\s+consolidated\s+|standalone\s+|consolidated\s+)?financial results?/i,
  /approv\w*\b.{0,120}\bfinancial results?/i,
  /financial results?\b.{0,160}\bapprov/i,
  /financial results? (?:of the (?:company|bank)\s+)?(?:\([^)]{0,60}\)\s+)?for the (?:period|quarter|half[- ]?year|year|nine months)/i,
];

/** A reporting period named in the text. */
const PERIOD = /(?:quarter|period|half[- ]?year|year|nine months)\s+(?:and\s+[a-z -]{0,25}\s+)?(?:ended|ending)|\bq[1-4]\b|\bh[12]\b\s*fy|quarter\s*\(q[1-4]\)/i;

export interface NseAnnouncementLike {
  desc?: string | null;
  subject?: string | null;
  attchmntText?: string | null;
  symbol?: string | null;
}

/** The text a results test reads: the category plus what the company wrote. */
export function nseAnnouncementText(e: NseAnnouncementLike): string {
  return [e?.desc, e?.subject, e?.attchmntText].filter((x) => typeof x === 'string' && x.trim()).join(' — ').replace(/\s+/g, ' ').trim();
}

/** True when the announcement is (or announces) the company's financial results. Pure. */
export function isNseResultsAnnouncement(e: NseAnnouncementLike): boolean {
  const cat = `${e?.desc || ''} ${e?.subject || ''}`;
  if (!RESULT_CATEGORY.test(cat)) return false;
  const text = nseAnnouncementText(e);
  if (!text || NOT_A_FILING.test(text)) return false;
  const att = String(e?.attchmntText || e?.subject || '');
  // A press release / presentation only counts when it names results FOR a period.
  if (/press release/i.test(cat) && !/financial results? for the|results? for the (?:quarter|period|half|year)/i.test(att)) return false;
  if (!RESULT_PHRASE.some((re) => re.test(att)) && !/financial results? for the/i.test(att)) return false;
  return PERIOD.test(att);
}

/** NSE's "17-Oct-2026 18:00:50" (IST) → an ISO instant; null when unreadable. Pure. */
export function nseIstToIso(s: string | null | undefined): string | null {
  const m = String(s || '').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const mo = MON[m[2].toLowerCase()];
    if (!mo) return null;
    const pad = (n: number | string) => String(n).padStart(2, '0');
    const iso = `${m[3]}-${pad(mo)}-${pad(m[1])}T${pad(m[4] || '0')}:${pad(m[5] || '0')}:${pad(m[6] || '0')}+05:30`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const iso = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);   // sort_date "2026-10-17 18:00:50", IST
  if (iso) {
    const t = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6] || '00'}+05:30`);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

/** The IST calendar date of an ISO instant. Pure. */
export function istDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
}

/** The period end a results text names ("September 30, 2026", "30th September 2026",
 *  "30.09.2026", "30-09-2026"), as YYYY-MM-DD; null when none is named. Pure. */
export function periodEndFromText(text: string | null | undefined): string | null {
  const s = String(text || '');
  const after = s.match(/(?:ended|ending)\s+(?:on\s+)?(.{0,40})/i);
  const scope = after ? after[1] : s;
  const pad = (n: number) => String(n).padStart(2, '0');
  const ok = (y: number, mo: number, d: number) => (y > 2000 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  let m = scope.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && MON[m[1].slice(0, 3).toLowerCase()]) return ok(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
  m = scope.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}),?\s+(\d{4})/);
  if (m && MON[m[2].slice(0, 3).toLowerCase()]) return ok(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = scope.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return ok(+m[3], +m[2], +m[1]);
  return null;
}

/** An Indian fiscal-quarter label for a quarter END ("2026-09-30" → "Q2 FY27").
 *  Null when the date is not a calendar quarter end. Pure. */
export function fyQuarterLabelForEnd(iso: string | null | undefined): string | null {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  const q = mo === 6 ? 1 : mo === 9 ? 2 : mo === 12 ? 3 : mo === 3 ? 4 : null;
  if (!q) return null;
  const fy = mo === 3 ? y : y + 1;
  return `Q${q} FY${String(fy).slice(-2)}`;
}

/** zzz1068 — the pending reason for a company whose results filing is CONFIRMED but whose new
 *  quarter is not on Screener.in yet. It must never contain "scheduled" (that reads as
 *  "board meeting only — results not out yet"). Pure. */
export function filedFiguresPendingReason(label: unknown, filed: unknown, screenerEnd: unknown, how: unknown): string {
  const q = String(label || '').trim() || 'the new quarter';
  const d = String(filed || '').slice(0, 10);
  const have = screenerEnd ? String(screenerEnd).slice(0, 10) : 'older';
  const src = how === 'exchange-filing' ? 'results filing seen on the exchange' : 'results filing confirmed';
  return `filed — figures being read: ${src}${d ? ` (${d})` : ''} for ${q}; Screener's newest quarter is ${have}, so the numbers come from the filing next`;
}
