// ═══════════════════════════════════════════════════════════════════════════
// zzz1057 — Special Situations audit fixes. Pure functions, no I/O.
//
//   1. Court / tribunal case reports (IBC Laws, Live Law, Bar & Bench) are
//      not company events: "Ravi Dhiman Vs. Ritu Rastogi (RP) – NCLAT,
//      Principal Bench". Most parties are individuals, Pvt. Ltd. companies or
//      banks; they were typed TURNAROUND_OPERATING (their summaries say "debt
//      resolution" / "restructuring") and filled the Turnaround and NCLT boxes.
//      Now: held back ('COURT_CASE_REPORT'), unless the case is an NCLT / NCLAT
//      matter whose party is a LISTED company — then it is an insolvency event
//      (NCLT_IBC_*), never a turnaround.
//   2. Turnaround means an operating turnaround. Insolvency / NCLT / DRT / OTS
//      wording moves an event to the new DISTRESS category.
//   3. Capacity expansion and first concall items were matched by the route's
//      regex but no classifier produced an event type for them, so they were
//      dropped as UNCLASSIFIED (the two boxes were always 0). Strict detectors
//      give them CAPEX_EXPANSION / FIRST_CONCALL.
//   4. "Fund housekeeping" was decided by the word "fund" ANYWHERE in the text
//      ("promoter pledges stake to fund a rights issue", "raise ₹130 crore from
//      RevX fund"). Now only a fund-like SUBJECT counts.
//   5. Awaiting-verification items that can never be checked (no company
//      document found, or the document does not carry the claim) get an end
//      state after VERIFY_EXPIRE_DAYS: 'VERIFICATION_EXPIRED', counted apart.
// ═══════════════════════════════════════════════════════════════════════════

import { resolveCompanyToTicker } from './nse-ticker-names';
import { decodeHtmlEntities } from './special-sit-feed-quality';

const DAY_MS = 86_400_000;

// ── 1. court / tribunal case reports ───────────────────────────────────────

/** The forum a law-feed case report ends with: "… – NCLT, Mumbai Bench", "… – Bombay High Court", "… – DRT, Chennai". */
const FORUM_RE = /\b(NCLT|NCLAT|DRT|DRAT|High Court|Supreme Court|REAT|RERA|Real Estate (?:Regulatory Authority|Appellate Tribunal)|Appellate Tribunal|Tribunal|SAT|ITAT|CESTAT|NCDRC|Consumer (?:Commission|Forum)|IBBI|Adjudicating Authority)\b/i;
const NCLT_FORUM_RE = /\b(NCLT|NCLAT|IBBI|Adjudicating Authority)\b/i;
/** " – " / " — " / " - " before the forum, the forum being the LAST segment of the title. */
const TAIL_SPLIT_RE = /\s[–—-]\s(?=[^–—]*$)/;
const VS_RE = /\s+(?:Vs?\.?|versus)\s+/i;
/** Parties that are never the listed company the case is about. */
const NON_COMPANY_PARTY_RE = /\b(bank|union of india|state of|government|commission|authority|board|directorate|municipal|officer|commissioner|collector|registrar|\bRP\b|\bIRP\b|resolution professional|liquidator|interim resolution|and ors|and anr|reserve bank|sebi|enforcement)\b/i;
const PUBLIC_CO_RE = /\b(?:Ltd|Limited)\.?\s*$/i;
const PRIVATE_CO_RE = /\b(?:Pvt|Private|LLP)\b/i;
/** Lower-case words a news headline has and a case title never has (case-sensitive on purpose). */
const NEWS_VERB_RE = /\b(?:to|says?|said|seeks?|moves?|rejects?|approves?|approved|upholds?|clears?|orders?|allows?|dismiss\w*|gets?|wins?|loses?|files?|filed|plea|battle|heats|over|against|after|before|with|from|under|amid|why|how|what|is|are|was|will)\b/;
const CASE_CONNECTORS = new Set(['and', 'of', 'the', 'for', 'in', 'at', 'de', 'da', 'vs', 'v', 'ors', 'anr', 'alias', 'through', 'on', 'behalf', 'its', 'by']);

export interface CourtCaseReport {
  forum: string;
  isNclt: boolean;
  parties: string[];
  /** a party that is a listed company (NSE name map), only for NCLT / NCLAT cases */
  listedParty: { name: string; ticker: string } | null;
}

/** Strip "(RP)", "CMA X, RP of", trailing punctuation from one party. */
function cleanParty(p: string): string {
  return p.replace(/\((?:RP|IRP|IP|Liquidator)\)/gi, '').replace(/^.*?,\s*(?:RP|IRP|Liquidator|Resolution Professional)\s+(?:of|for)\s+/i, '').replace(/\s+and\s+(?:Ors|Anr)\.?$/i, '').replace(/[.,;\s]+$/, '').trim();
}

/** A case report from a law feed ("A Vs. B – <forum>", "A – NCLT, X Bench"). Null when the title is not in that format. */
export function courtCaseReport(title: string | null | undefined, lookup: (name: string) => string | undefined = resolveCompanyToTicker): CourtCaseReport | null {
  const t = decodeHtmlEntities(String(title || '')).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = TAIL_SPLIT_RE.exec(t);
  if (!m) return null;
  const head = t.slice(0, m.index).trim();
  const tail = t.slice(m.index + m[0].length).trim();
  // the tail is the forum itself (short), never a sentence that merely mentions a court
  if (!FORUM_RE.test(tail) || tail.split(' ').length > 8 || /\b(?:to|will|says|said|seeks|moves|rejects|approves|upholds|clears)\b/i.test(tail)) return null;
  // a case title is a list of proper names ("A Vs. B", "X Pvt. Ltd.", "CMA Y, RP of Z Ltd."): no lower-case words except
  // connectors. "Vedanta demerger approved – NCLT" is a news headline about a court, not a case report.
  // (one stray lower-case word is tolerated: law feeds carry typos such as "Logix lnfratech")
  const lowerWords = head.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter((w) => /^[a-z]/.test(w) && !CASE_CONNECTORS.has(w.replace(/[.,]+$/, '')));
  if (lowerWords.length > 1 || NEWS_VERB_RE.test(head.replace(/\([^)]*\)/g, ' '))) return null;
  const isVs = VS_RE.test(head);
  if (!isVs && !/\b(?:Ltd|Limited|Pvt|LLP)\.?\s*$/i.test(head) && !/,\s*(?:RP|IRP|Liquidator)\s+of\b/i.test(head)) return null;
  const isNclt = NCLT_FORUM_RE.test(tail);
  const raw = isVs ? head.split(VS_RE) : [head];
  const parties = raw.map(cleanParty).filter((p) => p.length >= 2);
  let listedParty: CourtCaseReport['listedParty'] = null;
  if (isNclt) {
    for (const p of parties) {
      if (NON_COMPANY_PARTY_RE.test(p) || PRIVATE_CO_RE.test(p) || !PUBLIC_CO_RE.test(p)) continue;
      const base = p.replace(PUBLIC_CO_RE, '').trim();
      const ticker = lookup(p) || lookup(base) || lookup(`${base} Limited`);
      if (ticker) { listedParty = { name: p, ticker }; break; }
    }
  }
  return { forum: tail, isNclt, parties, listedParty };
}

/** Law-feed sources (case reports, digests, commentary). */
export const LAW_FEED_SOURCE_RE = /\b(IBC Laws|Live ?Law|Bar (?:&|and) Bench)\b/i;
/** A law-feed digest / bulletin / guide / signed commentary: never a company event. */
const LAW_DIGEST_RE = /\b(bulletin|digest|weekly case laws|case laws|practical guide|a guide|explainer|analysis|webinar|newsletter)\b|[–—-]\s*By\s+[A-Z]|^From\s|:\s*The\s/i;

/** Hold-back detail for a case report (or a law-feed digest), or null when it is not one or is about a listed company in an NCLT / NCLAT matter. */
export function courtCaseHoldDetail(title: string | null | undefined, lookup?: (name: string) => string | undefined, source?: string | null): string | null {
  if (source && LAW_FEED_SOURCE_RE.test(source) && LAW_DIGEST_RE.test(decodeHtmlEntities(String(title || '')))) return 'law-feed digest / commentary, not a company event';
  const c = courtCaseReport(title, lookup);
  if (!c || c.listedParty) return null;
  return `case report (${c.forum})${c.parties.length ? `: ${c.parties.slice(0, 2).join(' v. ')}` : ''}; no listed company named as a party`;
}

// ── 2. operating turnaround vs insolvency / distress ───────────────────────

const DISTRESS_RE = /\b(nclt|nclat|insolvenc\w*|\bibc\b|cirp|corporate insolvency|resolution professional|resolution plan|resolution applicant|liquidat\w+|\bdrt\b|\bdrat\b|sarfaesi|one[\s-]?time settlement|\bots\b|wilful defaulter|committee of creditors|\bcoc\b|bankruptcy|chapter 11|moratorium)\b/i;
const RESOLUTION_RE = /\b(resolution plan|resolution applicant|approv\w+ (?:the )?(?:plan|resolution)|liquidat\w+|one[\s-]?time settlement|\bots\b|settle\w*|haircut|emerges? from)\b/i;

/** Event types that mean insolvency / distress, never an operating turnaround. */
export const DISTRESS_EVENT_TYPES: ReadonlyArray<string> = ['NCLT_IBC_ADMISSION', 'NCLT_IBC_RESOLUTION'];
export const TURNAROUND_EVENT_TYPES: ReadonlyArray<string> = ['TURNAROUND_OPERATING', 'TURNAROUND_NARRATIVE'];

/**
 * A turnaround type whose text is about insolvency / tribunals / settlements becomes an NCLT / IBC type. Everything else is
 * returned unchanged. A court case report about a listed company is an NCLT / IBC event too.
 */
export function refineDistressType(eventType: string, text: string, title?: string, lookup?: (name: string) => string | undefined): string {
  const et = String(eventType || '').toUpperCase();
  const court = title ? courtCaseReport(title, lookup) : null;
  if (court?.isNclt && court.listedParty) return RESOLUTION_RE.test(text) ? 'NCLT_IBC_RESOLUTION' : 'NCLT_IBC_ADMISSION';
  if (!TURNAROUND_EVENT_TYPES.includes(et)) return eventType;
  // the turnaround (or distress) must be what the HEADLINE is about. "Lumino Industries shares soar after IPO" typed as a turnaround
  // because its summary mentions "debt reduction" is not a turnaround event: it is dropped from the event list (UNCLASSIFIED).
  if (title != null && !TURN_TITLE_RE.test(decodeHtmlEntities(title)) && !DISTRESS_RE.test(decodeHtmlEntities(title))) return 'UNCLASSIFIED';
  if (!DISTRESS_RE.test(text || '')) return eventType;
  return RESOLUTION_RE.test(text) ? 'NCLT_IBC_RESOLUTION' : 'NCLT_IBC_ADMISSION';
}
/** Operating-turnaround wording (mirrors event-intelligence TURNAROUND_* patterns). */
const TURN_TITLE_RE = /\b(turn.?around|back to profit|back in (?:the )?black|loss to profit|swung to profit|swings? (?:back )?to profit|first profit (?:after|since)|narrow(?:s|ed)? (?:loss|losses)|return(?:s|ed)? to profit|profit revival|debt restructur\w*|debt reduction|deleverag\w*|recapitali[sz]\w*|emerges? from (?:bankruptcy|restructur\w*|losses)|cdr exit|insolvency exit|debt resolution|debt[\s-]?free)\b/i;

// ── 3. capacity expansion / first concall ──────────────────────────────────

/** A concrete capacity / plant / greenfield step by the company (not an order win, a JV rumour or a product launch). */
const CAPEX_STRICT_RE = /\b(?:sets?\s+up|setting\s+up|to\s+set\s+up|commission(?:s|ed|ing)?\s+(?:its\s+|a\s+|the\s+|new\s+)?(?:plant|unit|facility|line|capacity|project)|commences?\s+(?:commercial\s+)?production|starts?\s+commercial\s+production|capacity\s+expansion|expand(?:s|ed|ing)?\s+(?:its\s+|the\s+)?(?:installed\s+)?(?:capacity|production|manufacturing)|greenfield|brownfield|new\s+(?:manufacturing\s+)?(?:plant|facility|unit)|to\s+invest\s+(?:rs\.?\s*|₹\s*|inr\s*)?[\d,.]+\s*(?:cr|crore|lakh\s*crore|million|mn|billion|bn)\b|capex\s+(?:of|plan|programme|program)\b|doubl(?:e|es|ing)\s+(?:its\s+)?capacity|increase(?:s|d)?\s+(?:its\s+)?capacity\s+(?:from|to|by))/i;
const CAPEX_REJECT_RE = /\b(delay(?:s|ed)?|shelv\w+|defer\w*|cancel\w*|put\s+on\s+hold|scraps?|withdraws?|rumou?r|may\s+consider|exploring|plans?\s+to\s+explore|order\s+(?:win|book|inflow)|bags?\s+order|wins?\s+order)\b/i;
/** A company's FIRST / maiden / debut / post-IPO investor call or presentation — not every quarterly concall. */
const FIRST_CONCALL_RE = /\b(?:first|maiden|debut|inaugural)\s+(?:ever\s+)?(?:investor\s+|earnings\s+|analyst\s+)?(?:presentation|concall|con-call|conference\s+call|earnings\s+call|investor\s+call|analyst\s+meet)|post[\s-]?ipo\s+(?:first\s+)?(?:concall|conference\s+call|earnings\s+call|investor\s+presentation)/i;
const CONCALL_REJECT_RE = /\b(skip\w*|cancel\w*|postpon\w*|first\s+(?:quarter|half)\b)/i;

/** Event type for an item the general classifiers left UNCLASSIFIED but the route's regex put in CAPEX / CONCALL. */
export function capexOrConcallEventType(category: string | null | undefined, text: string): 'CAPEX_EXPANSION' | 'FIRST_CONCALL' | null {
  const t = String(text || '');
  if (category === 'CONCALL' || FIRST_CONCALL_RE.test(t)) {
    if (FIRST_CONCALL_RE.test(t) && !CONCALL_REJECT_RE.test(t.replace(FIRST_CONCALL_RE, ''))) return 'FIRST_CONCALL';
    if (category === 'CONCALL') return null;
  }
  if (category === 'CAPEX' && CAPEX_STRICT_RE.test(t) && !CAPEX_REJECT_RE.test(t)) return 'CAPEX_EXPANSION';
  return null;
}

// ── 4. fund subject ─────────────────────────────────────────────────────────

/** The SUBJECT itself is a pooled vehicle (fund / trust / ETF / BDC / closed-end), not a company that raises money FROM a fund. */
const FUND_SUBJECT_RE = /\b(fund|funds|trust|etf|bdc|closed[\s-]?end|interval fund|evergreen|income (?:fund|trust)|private markets)\b/i;
const FUND_SUBJECT_GUARD_RE = /\b(bank|bancorp|insurance|industries|technologies|pharma\w*|motors|steel|energy|power|realty|infra\w*|electric|petroleum)\b/i;
export function isFundSubject(subject: string | null | undefined, secCompany?: string | null): boolean {
  const n = String(secCompany || subject || '').trim();
  if (!n) return false;
  return FUND_SUBJECT_RE.test(n) && !FUND_SUBJECT_GUARD_RE.test(n);
}

// ── 5. awaiting verification → end state ───────────────────────────────────

/** After this many days without a company document (or with a document that does not carry the claim), the item is closed. */
export const VERIFY_EXPIRE_DAYS = 14;
/** Awaiting reasons that no later run can change by itself (re-searched rarely; the AI cannot read what is not there). */
export const EXPIRABLE_REASONS: ReadonlyArray<string> = ['no_primary', 'not_found'];

export interface ExpirySplit<E> { live: E[]; expired: E[]; expiredByReason: Record<string, number> }

/** Event age in days from its primary item's date (null when undated: never expired on age). */
export function eventAgeDays(ev: any, now: number): number | null {
  const d = ev?.primary_filing?.pub_date;
  const t = typeof d === 'string' && d ? Date.parse(d) : NaN;
  if (Number.isFinite(t)) return Math.max(0, (now - t) / DAY_MS);
  const h = Number(ev?.primary_filing?.age_hours ?? ev?.age_hours);
  return Number.isFinite(h) && h < 900 ? h / 24 : null;
}

/**
 * Split events waiting for verification into still-live and expired. Expired = its awaiting reason is final (no document /
 * claim not in the document) AND the event is older than `days`. Queued, unreadable and error items never expire.
 */
export function splitExpiredAwaiting<E>(events: ReadonlyArray<E>, awaitingRows: ReadonlyArray<{ refId?: string; reason?: string }> | null | undefined, now: number = Date.now(), days = VERIFY_EXPIRE_DAYS): ExpirySplit<E> {
  const why = new Map<string, string>();
  for (const r of awaitingRows || []) if (r?.refId) why.set(String(r.refId), String(r.reason || ''));
  const out: ExpirySplit<E> = { live: [], expired: [], expiredByReason: {} };
  for (const e of events) {
    const reason = why.get(String((e as any)?.event_id)) || '';
    const age = eventAgeDays(e, now);
    if (EXPIRABLE_REASONS.includes(reason) && age != null && age > days) {
      out.expired.push(e);
      out.expiredByReason[reason] = (out.expiredByReason[reason] || 0) + 1;
    } else out.live.push(e);
  }
  return out;
}
