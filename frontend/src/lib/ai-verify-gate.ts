// ═══════════════════════════════════════════════════════════════════════════
// AI VERIFICATION GATE — pure functions, no I/O.                     (zzz854)
//
// Owner rule: everything shown must be verified. An item reaches a main list
// only when
//   (a) the engine itself read the company's primary document and the
//       numbers (primary-verified), or
//   (b) the AI verifier read the primary document and CONFIRMED the claim
//       (quote found in the document, numbers matched).
// An AI-CONTRADICTED item is removed and listed in the audit with the reason.
// Everything else waits in "Awaiting verification" with a count and a reason.
// Silence never passes: no key / cap reached → 'verification_unavailable'.
//
// The claim builders read the guidance-event and special-situation shapes
// DEFENSIVELY (other modules are adding fields concurrently): every field is
// optional here, and an unknown shape becomes a claim, never a pass.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import type {
  AwaitingReason, AwaitingRow, GateResult, LocatedDoc, PrimaryHow, RemovedRow, VerifyBasis, VerifyClaim, VerifyMarket, VerifyVerdict,
} from './ai-verify-types';
import { secAccession, subjectFromHeadline } from './special-sit-feed-quality';
import { secIndexUrl } from './ai-verify-locator';

// ── helpers ─────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const uniqNums = (xs: Array<number | null | undefined>): number[] => {
  const out: number[] = [];
  for (const x of xs) if (typeof x === 'number' && Number.isFinite(x) && !out.includes(x)) out.push(x);
  return out;
};

export function marketOf(v: unknown): VerifyMarket {
  const m = str(v).toUpperCase();
  return m === 'US' ? 'US' : m === 'IN' ? 'IN' : 'GLOBAL';
}

export function basisOf(v: unknown): VerifyBasis | null {
  const b = str(v).toUpperCase();
  if (!b) return null;
  if (b === 'GAAP' || b === 'REPORTED') return 'GAAP';
  if (b === 'NON_GAAP' || b === 'ADJUSTED' || b === 'NON-GAAP') return 'ADJUSTED';
  return 'UNSTATED';
}

/** Stable id: company + metric + period + values + sourceUrl (+ kind). */
export function claimIdOf(p: { kind: string; company: string; metric: string | null; period: string | null; values: number[]; sourceUrl: string | null }): string {
  const key = [
    'v1', p.kind, p.company.trim().toLowerCase().replace(/\s+/g, ' '), (p.metric || '').toLowerCase(), (p.period || '').toUpperCase().replace(/\s+/g, ''),
    p.values.map((v) => String(+v.toPrecision(10))).join(','), (p.sourceUrl || '').trim(),
  ].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

/** Hosts whose documents are the company's own words (filings, exchange disclosures, company-issued wire releases). */
const PRIMARY_HOST = /(^|\.)(sec\.gov|nseindia\.com|bseindia\.com|prnewswire\.com|globenewswire\.com|businesswire\.com|accesswire\.com|newsfilecorp\.com|newswire\.ca)$/i;

export function isPrimaryHostUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return PRIMARY_HOST.test(u.hostname);
  } catch { return false; }
}

const fmtVals = (xs: number[]) => (xs.length === 0 ? 'not stated' : xs.length === 1 ? String(xs[0]) : `${xs[0]} to ${xs[xs.length - 1]}`);

// ── guidance events ─────────────────────────────────────────────────────────

/** The first change carrying an `after` figure (the headline metric). */
function headlineChange(e: any): any | null {
  const ch: any[] = Array.isArray(e?.changes) ? e.changes : [];
  return ch.find((c) => c && c.after && (num(c.after.low) != null || num(c.after.high) != null || num(c.after.midpoint) != null)) || null;
}

const afterValues = (p: any): number[] => (p ? uniqNums([num(p.low), num(p.high)]).length ? uniqNums([num(p.low), num(p.high)]) : uniqNums([num(p.midpoint)]) : []);

/**
 * True only when the engine itself read the company's document AND the numbers:
 * VERIFIED, primary state read (or not reported by an older engine), not a bare
 * DETECTED / unverified label, and the headline change has an after figure.
 */
export function isGuidancePrimaryVerified(e: any): boolean {
  if (!e || e.verification !== 'VERIFIED') return false;
  if (e.primaryAvailable === false) return false;
  if (e.primaryState != null && e.primaryState !== 'PRIMARY_SOURCE_READ') return false;
  if (e.classification === 'DETECTED') return false;
  if (/UNVERIFIED|DETECTED/i.test(str(e.displayLabel))) return false;
  // concurrent taxonomy fields (zzz854 agents): any explicit "not verified" / failed data check is respected
  if (e.primaryVerified === false || e.dataCheckFailed === true || e.invariantFailed === true) return false;
  if (/^(UNVERIFIED|AWAITING|FAILED|DETECTED)/i.test(str(e.verificationStatus || e.status))) return false;
  return !!headlineChange(e);
}

export function guidancePrimaryUrl(e: any): string | null {
  if (isPrimaryHostUrl(e?.primarySourceUrl)) return e.primarySourceUrl;
  const srcs: any[] = Array.isArray(e?.sources) ? e.sources : [];
  const p = srcs.find((s) => s?.tier === 'PRIMARY' && isPrimaryHostUrl(s?.url)) || srcs.find((s) => isPrimaryHostUrl(s?.url));
  if (p?.url) return p.url;
  // a company's own PDF named as the primary source (India IR PDFs) is accepted when the engine says it is primary
  if (typeof e?.primarySourceUrl === 'string' && /^https:\/\/[^/]+\.[^/]+\/.+\.pdf(\?|$)/i.test(e.primarySourceUrl)) return e.primarySourceUrl;
  return null;
}

/** null = already primary-verified (no claim needed). */
export function guidanceEventToClaim(e: any): VerifyClaim | null {
  if (isGuidancePrimaryVerified(e)) return null;
  const company = str(e?.company) || str(e?.ticker) || 'Unknown company';
  const ticker = str(e?.ticker) || null;
  const c = headlineChange(e) || (Array.isArray(e?.changes) ? e.changes[0] : null);
  const after = c?.after || null;
  const before = c?.before || null;
  const metric = str(c?.metric || after?.metric) || null;
  const period = str(after?.period) || null;
  const newV = afterValues(after);
  const oldV = afterValues(before);
  const unitBits = [str(after?.currency), str(after?.unit), after?.isGrowthRate ? '%' : ''].filter(Boolean);
  const unit = unitBits.length ? Array.from(new Set(unitBits)).join(' ') : null;
  const srcs: any[] = Array.isArray(e?.sources) ? e.sources : [];
  const sourceUrl = str(srcs[0]?.url) || str(e?.primarySourceUrl) || null;
  const basis = basisOf(after?.basis);
  const what = str(e?.displayLabel || e?.classification || e?.type) || 'guidance';
  const claimText = newV.length
    ? `${company}${ticker ? ` (${ticker})` : ''} ${oldV.length ? `changed ${metric || 'guidance'} guidance for ${period || 'an unstated period'} from ${fmtVals(oldV)} to ${fmtVals(newV)}` : `gave ${metric || ''} guidance for ${period || 'an unstated period'} of ${fmtVals(newV)}`}${unit ? ` (${unit})` : ''}${basis && basis !== 'UNSTATED' ? `, ${basis} basis` : ''}.`
    : `${company}${ticker ? ` (${ticker})` : ''}: ${what} — ${str(e?.whatItMeans || e?.whyNow || 'guidance change reported').slice(0, 200)}. The guided numbers were not read.`;
  const claimId = claimIdOf({ kind: 'guidance', company, metric, period, values: [...oldV, ...newV], sourceUrl });
  return {
    claimId, kind: 'guidance', market: marketOf(e?.market), company, ticker, claimText: claimText.replace(/\s+/g, ' ').trim(), metric,
    numbers: { old: oldV, new: newV }, unit, period, basis,
    primaryUrl: guidancePrimaryUrl(e), sourceUrl, refId: str(e?.guidance_event_id || e?.canonical_key) || claimId,
  };
}

// ── special situations ──────────────────────────────────────────────────────

/** "SC TO-I - COMPANY (0000123) (Subject)" and nothing else: the form was seen, its terms were not read. */
const SEC_BARE_TITLE = /^\s*(?:SC\s*TO-[IT]|SC\s*13E-?3|SC\s*14D-?9|10-12[BG]|8-K|S-4|DEFM14A|PREM14A|425|SC\s*13D)(?:\/A)?\s+-\s+/i;
/**
 * A stated deal term: money with a currency (₹ / Rs / INR / $ / US$ / € / £), an amount in crore / lakh / million / billion, a
 * per-share price ("per share", "per-share", "a share"), a stake percentage ("51% stake"), a premium, or a share-exchange / bonus /
 * split ratio. zzz856: "per-share" and stake percentages were missed (too strict); a bare "12:30" (a time) is no longer read as a
 * ratio (too loose) — a ratio needs ratio / swap / exchange / bonus / split / "for every" wording.
 */
const TERMS_RE = /(?:[$₹€£]\s?\d|(?:rs\.?|inr|usd|us\$|eur)\s?\d|\d[\d,.]*\s?(?:per[\s-]share|a share|crore|cr\b|lakh|million|billion|bn\b|mn\b)|\d+(?:\.\d+)?\s?%\s+(?:stake|equity|shareholding|interest|of (?:the )?(?:shares|equity|outstanding))|premium of \d)/i;
const RATIO_RE = /\b\d{1,4}\s*:\s*\d{1,4}\b/;
const RATIO_CONTEXT_RE = /\b(ratio|swap|share exchange|exchange ratio|for every|bonus|split|sub[\s-]?division|rights entitlement)\b/i;

export function hasStatedTerms(text: string): boolean {
  const t = text || '';
  return TERMS_RE.test(t) || (RATIO_RE.test(t) && RATIO_CONTEXT_RE.test(t));
}

/** True when the event's evidence is a bare form title (no terms read). */
export function isBareFormEvidence(ev: any): boolean {
  const filings: any[] = Array.isArray(ev?.filings) && ev.filings.length ? ev.filings : ev?.primary_filing ? [ev.primary_filing] : [];
  return !filings.some((f) => hasStatedTerms(`${str(f?.title)} ${str(f?.description)}`));
}

/**
 * zzz856: the text of a company-issued wire release carries the wire's dateline even when it is republished (Yahoo / feed
 * copies): "/PRNewswire/", "(GLOBE NEWSWIRE)", "(BUSINESS WIRE)", "/CNW/", "(ACCESSWIRE)", "(Newsfile Corp.)". Such an item IS
 * the company's own words, whatever host serves it.
 */
const WIRE_DATELINE_RE = /\/\s?PRNewswire(?:-[A-Za-z]+)?\s?\/|\(\s?GLOBE\s?NEWSWIRE\s?\)|\(\s?BUSINESS\s?WIRE\s?\)|\/\s?CNW\s?\/|\(\s?ACCESSWIRE\s?\)|\(\s?Newsfile Corp\.?\s?\)/i;
export function isCompanyReleaseItem(f: any): boolean {
  if (!f) return false;
  if (isPrimaryHostUrl(f.link)) return true;
  return WIRE_DATELINE_RE.test(`${str(f.title)} ${str(f.description)}`);
}

/** The event's own primary items (filing / exchange disclosure / company wire release). */
function primaryItemsOf(ev: any): any[] {
  const filings: any[] = Array.isArray(ev?.filings) ? ev.filings : [];
  return [ev?.primary_filing, ...filings].filter((f) => f && isCompanyReleaseItem(f));
}

export function specSitPrimaryUrl(ev: any): string | null {
  const filings: any[] = Array.isArray(ev?.filings) ? ev.filings : [];
  const cands = [ev?.primary_filing, ...filings].filter(Boolean);
  const hit = cands.find((f) => isPrimaryHostUrl(f?.link));
  return hit ? str(hit.link) : null;
}

/** zzz856: an SEC form row whose link is not a usable sec.gov address: the filing index from the accession + CIK it carries. */
export function specSitSecIndexUrl(ev: any): string | null {
  const filings: any[] = Array.isArray(ev?.filings) ? ev.filings : [];
  for (const f of [ev?.primary_filing, ...filings].filter(Boolean)) {
    const title = str(f.title);
    if (!SEC_BARE_TITLE.test(title) && !/\bsec\b|edgar/i.test(str(f.source))) continue;
    const acc = secAccession(str(f.link)) || secAccession(str(f.description).match(/\d{10}-\d{2}-\d{6}/)?.[0] || '');
    const cik = title.match(/\((\d{3,10})\)/)?.[1] || str(f.link).match(/edgar\/data\/(\d{1,10})\//)?.[1] || null;
    const u = secIndexUrl(cik, acc);
    if (u) return u;
  }
  return null;
}

/** Primary-verified: the event's own primary document (filing / exchange disclosure / company wire release) states the terms. */
export function isSpecSitPrimaryVerified(ev: any): boolean {
  if (!ev) return false;
  const prim = primaryItemsOf(ev);
  if (!prim.length) return false;
  if (ev.terms_read === true || ev.termsRead === true) return true;
  return prim.some((f) => hasStatedTerms(`${str(f.title)} ${str(f.description)}`));
}

/** Money amounts / per-share prices named in a headline, for the number check. Conservative: only currency-marked or per-share figures. */
export function termNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /(?:[$₹€£]|(?:rs\.?|inr|usd)\s?)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:per\s+share)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ''))) {
    const v = Number((m[1] || m[2] || '').replace(/,/g, ''));
    if (Number.isFinite(v) && !out.includes(v)) out.push(v);
    if (out.length >= 4) break;
  }
  return out;
}

const TIER_RANK: Record<string, number> = { TIER_1: 3, TIER_2: 2, WATCHLIST: 1 };
/** Queue order: Tier 1 = 3, Tier 2 = 2, Watchlist = 1, other = 0 (the tier before any hold-back flag). */
export function tierRankOf(ev: any): number {
  return TIER_RANK[str(ev?.tier_before_hold || ev?.tier).toUpperCase()] ?? 0;
}

export function specSitToClaim(ev: any): VerifyClaim | null {
  if (isSpecSitPrimaryVerified(ev)) return null;
  const p = ev?.primary_filing || (Array.isArray(ev?.filings) ? ev.filings[0] : null) || {};
  const title = str(p?.title).slice(0, 300);
  const company = str(ev?.target_name) || title.replace(SEC_BARE_TITLE, '').replace(/\(\d{4,10}\)|\((?:Subject|Filed by|Filer|Issuer)[^)]*\)/gi, '').trim().slice(0, 120) || 'Unknown company';
  const tickers: string[] = Array.isArray(ev?.tickers) ? ev.tickers.map(str).filter(Boolean) : [];
  const values = termNumbers(`${title} ${str(p?.description)}`);
  const sourceUrl = str(p?.link) || null;
  const type = str(ev?.event_type || ev?.category) || 'special situation';
  const claimText = `${company}: ${type.replace(/_/g, ' ').toLowerCase()} — "${title}"${values.length ? `; stated terms ${values.join(', ')}` : '; terms not yet read'}.`;
  const claimId = claimIdOf({ kind: 'special_situation', company, metric: type, period: null, values, sourceUrl });
  const feedUrl = specSitPrimaryUrl(ev);
  const secUrl = feedUrl ? null : specSitSecIndexUrl(ev);
  const primaryUrl = feedUrl || secUrl;
  const primaryHow: PrimaryHow | null = feedUrl ? 'feed_link' : secUrl ? 'sec_accession' : null;
  const market = marketOf(ev?.region);
  const headSubject = (() => { try { return subjectFromHeadline(str(p?.title)); } catch { return null; } })();
  const names = Array.from(new Set([str(ev?.target_name), headSubject || ''].map((x) => x.trim()).filter((x) => x.length >= 2))).slice(0, 4);
  const dates = [p?.pub_date, ...(Array.isArray(ev?.filings) ? ev.filings.map((f: any) => f?.pub_date) : [])].map(str).filter((d) => Number.isFinite(Date.parse(d)));
  const eventDate = str(p?.pub_date) && Number.isFinite(Date.parse(str(p?.pub_date))) ? str(p.pub_date) : dates.sort()[0] || null;
  return {
    claimId, kind: 'special_situation', market, company, ticker: tickers[0] || null, claimText, metric: type,
    numbers: { old: [], new: values }, unit: null, period: null, basis: null,
    primaryUrl, sourceUrl, refId: str(ev?.event_id) || claimId,
    primaryHow, primaryDetail: feedUrl ? 'The event\'s own filing / exchange / company-release link.' : secUrl ? 'SEC filing index built from the accession number and CIK the SEC row carries.' : null,
    priorityTier: tierRankOf(ev), eventDate,
    locateHints: primaryUrl ? null : { tickers: tickers.slice(0, 4), names, text: `${title} ${str(p?.description)}`.replace(/\s+/g, ' ').slice(0, 400), eventType: str(ev?.event_type) || null, region: market },
  };
}

/**
 * zzz856: a located exchange announcement whose own subject line names this kind of event AND states the terms (and, when the
 * event states figures, carries those figures) is the company's own words: primary-verified without the AI.
 */
export function isLocatedPrimaryVerified(claim: VerifyClaim, loc: LocatedDoc | null | undefined): boolean {
  if (!loc || !loc.found || loc.how !== 'exchange_announcement' || !loc.text || !loc.kindMatch) return false;
  if (!hasStatedTerms(loc.text)) return false;
  if (claim.numbers.new.length) {
    const have = termNumbers(loc.text).concat((loc.text.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => Number(x.replace(/,/g, ''))));
    return claim.numbers.new.every((v) => have.some((h) => Math.abs(h - v) <= Math.max(0.005 * Math.abs(v), 1e-9)));
  }
  return true;
}

/** The claim with a located document attached (when the event carried none). */
export function withLocated(claim: VerifyClaim, loc: LocatedDoc | null | undefined): VerifyClaim {
  if (claim.primaryUrl || !loc?.found || !loc.url) return claim;
  return { ...claim, primaryUrl: loc.url, primaryHow: loc.how, primaryDetail: loc.detail };
}

// ── the gate ────────────────────────────────────────────────────────────────

export const AWAITING_TEXT: Record<AwaitingReason, string> = {
  queued: 'Not checked yet: queued for the AI verifier to read the primary document.',
  no_primary: 'No primary document (company filing or exchange disclosure) is linked, so the claim cannot be checked.',
  not_found: 'The AI verifier read the primary document and could not find this claim in it.',
  unreadable: 'The primary document could not be fetched or read; it will be retried.',
  error: 'The verifier answer could not be validated; it will be retried.',
  verification_unavailable: 'AI verification is unavailable (no API key configured, or the monthly AI cap is reached), so the claim could not be checked.',
};

export interface GateOpts<T> {
  claimOf: (item: T) => VerifyClaim | null;
  verdicts: Map<string, VerifyVerdict>;
  available: boolean;
  unavailableReason?: string | null;
  mode?: 'enforce' | 'report';
  /**
   * zzz856: documents the locator found (or did not find) for claims that carried none, by claimId. When given, a claim with
   * locate hints and no search result yet is 'queued' (to be searched, then read) instead of a permanent 'no_primary'.
   */
  located?: Map<string, LocatedDoc>;
}

const LOCATE_QUEUED_TEXT = 'Not checked yet: queued to look up the company\'s own document (exchange announcement / SEC filing) for this event, then to read it.';

/** Partition a list: kept (primary-verified or AI-confirmed), removed (AI-contradicted), awaiting (everything else). */
export function partitionByVerification<T>(items: T[], o: GateOpts<T>): GateResult<T> & { locatedByRef: Map<string, LocatedDoc> } {
  const mode = o.mode || 'enforce';
  const kept: T[] = []; const awaiting: AwaitingRow[] = []; const removed: RemovedRow[] = []; const pending: VerifyClaim[] = []; const toLocate: VerifyClaim[] = [];
  const confirmedByRef = new Map<string, VerifyVerdict>();
  const locatedByRef = new Map<string, LocatedDoc>();
  const awaitingByReason: Partial<Record<AwaitingReason, number>> = {};
  const primaryDocument = { located: 0, none: 0, notSearchedYet: 0, byHow: {} as Partial<Record<PrimaryHow, number>> };
  let primaryVerified = 0; let checked = 0; let confirmed = 0; let contradicted = 0;
  const seenPending = new Set<string>(); const seenLocate = new Set<string>();
  let unbuildable = 0;
  for (const it of items) {
    let claim: VerifyClaim | null;
    try { claim = o.claimOf(it); } catch { unbuildable++; awaitingByReason.error = (awaitingByReason.error || 0) + 1; if (mode === 'report') kept.push(it); continue; }
    if (!claim) { kept.push(it); primaryVerified++; continue; }
    const loc = !claim.primaryUrl && o.located ? o.located.get(claim.claimId) : undefined;
    claim = withLocated(claim, loc);
    const v = o.verdicts.get(claim.claimId);
    if (v && v.status !== 'verification_unavailable') checked++;
    if (v?.status === 'contradicted') {
      contradicted++;
      removed.push({ claimId: claim.claimId, refId: claim.refId, kind: claim.kind, market: claim.market, company: claim.company, ticker: claim.ticker, claimText: claim.claimText, reason: v.reason, quote: v.extracted?.quote || null, documentUrl: v.documentUrl, checkedAt: v.checkedAt });
      continue;
    }
    // zzz856: the company's own exchange announcement, matched to this event, states the terms → primary-verified without the AI
    if (loc && isLocatedPrimaryVerified(claim, loc)) { kept.push(it); primaryVerified++; locatedByRef.set(claim.refId, loc); continue; }
    if (v?.status === 'confirmed') { kept.push(it); confirmed++; confirmedByRef.set(claim.refId, v); if (loc?.found) locatedByRef.set(claim.refId, loc); continue; }
    const searchable = !!o.located && !!claim.locateHints && !claim.primaryUrl && !loc && (!v || v.status === 'no_primary');
    let reason: AwaitingReason;
    if (searchable) reason = 'queued';                                                   // not searched yet: the run looks for its document
    else if (!claim.primaryUrl && (!v || v.status === 'no_primary')) reason = 'no_primary';   // nothing the verifier could read; not queued
    else if (!v) reason = o.available ? 'queued' : 'verification_unavailable';
    else if (v.status === 'not_found' || v.status === 'unreadable' || v.status === 'no_primary' || v.status === 'error') reason = v.status;
    else reason = 'verification_unavailable';
    if (searchable) { if (!seenLocate.has(claim.claimId)) { seenLocate.add(claim.claimId); toLocate.push(claim); } }
    // with no primary link the verifier cannot help; anything else goes (back) on the queue
    else if (reason !== 'no_primary' && (!v || reason === 'unreadable' || reason === 'error' || reason === 'verification_unavailable')) {
      if (!seenPending.has(claim.claimId)) { seenPending.add(claim.claimId); pending.push(claim); }
    }
    if (claim.primaryUrl) { primaryDocument.located++; if (claim.primaryHow) primaryDocument.byHow[claim.primaryHow] = (primaryDocument.byHow[claim.primaryHow] || 0) + 1; }
    else if (searchable) primaryDocument.notSearchedYet++;
    else primaryDocument.none++;
    awaitingByReason[reason] = (awaitingByReason[reason] || 0) + 1;
    const noneText = reason === 'no_primary' && loc && !loc.found ? `${AWAITING_TEXT.no_primary} ${loc.detail}` : null;
    awaiting.push({
      claimId: claim.claimId, refId: claim.refId, kind: claim.kind, market: claim.market, company: claim.company, ticker: claim.ticker, claimText: claim.claimText,
      reason,
      reasonText: searchable ? LOCATE_QUEUED_TEXT
        : noneText ? noneText
        : v?.reason && reason !== 'queued' ? `${AWAITING_TEXT[reason]} (${v.reason})`
        : (reason === 'verification_unavailable' && o.unavailableReason ? `${AWAITING_TEXT[reason]} ${o.unavailableReason}` : AWAITING_TEXT[reason]),
      primaryUrl: claim.primaryUrl, sourceUrl: claim.sourceUrl, checkedAt: v?.checkedAt || loc?.checkedAt || null,
    });
    if (mode === 'report') kept.push(it);
  }
  return {
    kept, awaiting, removed, pending, toLocate, confirmedByRef, locatedByRef,
    stats: { primaryVerified, checked, confirmed, contradicted, awaiting: awaiting.length + unbuildable, awaitingByReason, primaryDocument },
  };
}

// ── zzz854 wave 2: verification as an OVERLAY on the event pipeline ─────────
// The event engine already partitions every event (CARD / AUDIT / QUEUE / DROPPED) and only VERIFIED events (company document
// read by the engine) reach CARD or AUDIT. The AI verifier therefore works on the events the engine could NOT verify:
//   · AI confirmed (quote in the document, numbers / period / basis match) → verification VERIFIED with the primary document named,
//     then the caller's `reclassify` (withClassification) re-derives pipeline + decision, so the item moves to a card / audit row
//     ONLY if the engine's own rules now say so;
//   · AI confirmed but the event has no numbers of its own → stays in the queue with the extracted figures attached;
//   · AI contradicted → review queue, bucket invalidOrStale (status 'invalid'), with the verifier's reason; never shown;
//   · anything else → stays in the queue; its pipeline reason names the verification state (queued / not found / no primary ...).
// Not-guidance / capital raise / first guidance / already invalid items are never sent to the paid verifier.

export type AiVerificationTag =
  | { status: 'AI_CONFIRMED'; checkedAt: string; model: string | null; documentUrl: string | null; quote: string | null; newValues: number[]; oldValues: number[]; period: string | null; basis: string | null }
  | { status: 'AI_CONFIRMED_NO_NUMBERS'; checkedAt: string; documentUrl: string | null; quote: string | null; newValues: number[]; period: string | null; reasonText: string }
  | { status: 'AI_CONTRADICTED'; checkedAt: string; documentUrl: string | null; quote: string | null; reasonText: string }
  | { status: 'AWAITING'; reason: AwaitingReason; reasonText: string; checkedAt: string | null };

const NO_AI_BUCKETS = new Set(['capitalRaise', 'nonGuidance', 'firstGuidance', 'invalidOrStale']);

export interface OverlayStats { engineVerified: number; aiConfirmed: number; aiConfirmedNoNumbers: number; aiContradicted: number; awaiting: number; notSent: number; checked: number; awaitingByReason: Partial<Record<AwaitingReason, number>> }

export function overlayEventVerification<E extends Record<string, any>>(events: readonly E[], o: {
  verdicts: Map<string, VerifyVerdict>; available: boolean; unavailableReason?: string | null; reclassify: (e: E) => E;
}): { events: E[]; pending: VerifyClaim[]; stats: OverlayStats } {
  const stats: OverlayStats = { engineVerified: 0, aiConfirmed: 0, aiConfirmedNoNumbers: 0, aiContradicted: 0, awaiting: 0, notSent: 0, checked: 0, awaitingByReason: {} };
  const pending: VerifyClaim[] = []; const seen = new Set<string>();
  const out = events.map((e0) => {
    const e: any = e0;
    if (e.verification === 'VERIFIED') { stats.engineVerified++; return e0; }
    const bucket = e.pipeline?.bucket;
    if (e.excludedFromEvents || e.pipeline?.status === 'DROPPED' || (bucket && NO_AI_BUCKETS.has(bucket))) { stats.notSent++; return e0; }
    let claim: VerifyClaim | null = null;
    try { claim = guidanceEventToClaim(e); } catch { claim = null; }
    if (!claim) { stats.notSent++; return e0; }
    const v = o.verdicts.get(claim.claimId);
    if (v && v.status !== 'verification_unavailable') stats.checked++;
    if (v?.status === 'confirmed' && claim.numbers.new.length) {
      stats.aiConfirmed++;
      const doc = v.documentUrl || claim.primaryUrl;
      const tag: AiVerificationTag = { status: 'AI_CONFIRMED', checkedAt: v.checkedAt, model: v.model, documentUrl: doc, quote: v.extracted?.quote || null, newValues: v.extracted?.newValues || [], oldValues: v.extracted?.oldValues || [], period: v.extracted?.period || null, basis: v.extracted?.basis || null };
      const srcs: any[] = Array.isArray(e.sources) ? e.sources : [];
      const promoted = {
        ...e, verification: 'VERIFIED', primaryAvailable: true, primarySourceUrl: doc,
        sources: srcs.some((s) => s?.url === doc && s?.tier === 'PRIMARY') ? srcs : [{ url: doc || undefined, name: 'Company document (checked by the AI verifier)', tier: 'PRIMARY', type: 'Primary filing (AI-verified)', date: e.announcement_date }, ...srcs],
        aiVerification: tag,
      } as E;
      return o.reclassify(promoted);
    }
    if (v?.status === 'confirmed') {
      stats.aiConfirmedNoNumbers++;
      const tag: AiVerificationTag = { status: 'AI_CONFIRMED_NO_NUMBERS', checkedAt: v.checkedAt, documentUrl: v.documentUrl, quote: v.extracted?.quote || null, newValues: v.extracted?.newValues || [], period: v.extracted?.period || null, reasonText: 'The AI verifier found guidance in the company document, but this event has no before-and-after numbers of its own, so it stays in the review queue.' };
      return { ...e, aiVerification: tag, pipeline: e.pipeline ? { ...e.pipeline, reason: `${e.pipeline.reason} AI verifier: guidance found in the company document${v.extracted?.newValues?.length ? ` (${v.extracted.newValues.join(' to ')}${v.extracted.period ? `, ${v.extracted.period}` : ''})` : ''}; old and new figures still needed.` } : e.pipeline } as E;
    }
    if (v?.status === 'contradicted') {
      stats.aiContradicted++;
      const reasonText = `The AI verifier read the company document and it does not support this claim: ${v.reason}`;
      const tag: AiVerificationTag = { status: 'AI_CONTRADICTED', checkedAt: v.checkedAt, documentUrl: v.documentUrl, quote: v.extracted?.quote || null, reasonText };
      return o.reclassify({ ...e, verification: 'UNVERIFIED', isUpgrade: false, decision: 'UNVERIFIED', aiVerification: tag, pipeline: { status: 'QUEUE', bucket: 'invalidOrStale', reviewStatus: 'invalid', reason: reasonText } } as E);
    }
    let reason: AwaitingReason;
    if (!claim.primaryUrl && (!v || v.status === 'no_primary')) reason = 'no_primary';
    else if (!v) reason = o.available ? 'queued' : 'verification_unavailable';
    else if (v.status === 'not_found' || v.status === 'unreadable' || v.status === 'no_primary' || v.status === 'error') reason = v.status;
    else reason = 'verification_unavailable';
    if (reason !== 'no_primary' && (!v || reason === 'unreadable' || reason === 'error' || reason === 'verification_unavailable') && !seen.has(claim.claimId)) { seen.add(claim.claimId); pending.push(claim); }
    stats.awaiting++; stats.awaitingByReason[reason] = (stats.awaitingByReason[reason] || 0) + 1;
    const reasonText = v?.reason && reason !== 'queued' ? `${AWAITING_TEXT[reason]} (${v.reason})` : reason === 'verification_unavailable' && o.unavailableReason ? `${AWAITING_TEXT[reason]} ${o.unavailableReason}` : AWAITING_TEXT[reason];
    const tag: AiVerificationTag = { status: 'AWAITING', reason, reasonText, checkedAt: v?.checkedAt || null };
    return { ...e, aiVerification: tag, pipeline: e.pipeline ? { ...e.pipeline, reason: `${e.pipeline.reason} AI verification: ${reasonText}` } : e.pipeline } as E;
  });
  return { events: out, pending, stats };
}

/**
 * Response reconciliation (events route). Every event is in exactly one place, and the headline counts are the lists:
 *   shown (cards + audit) + review queue = all events after the gate;  counts.shown = shown;  counts.queued + counts.dropped = queue;
 *   no shown event is unverified;  every AI-confirmed promotion is VERIFIED;  no AI-contradicted event is shown.
 */
export function checkGuidanceResponseReconciles(r: {
  all: ReadonlyArray<Record<string, any>>; shown: ReadonlyArray<Record<string, any>>; queueLength: number;
  counts?: { shown?: number; queued?: number; dropped?: number } | null;
}): string[] {
  const v: string[] = [];
  if (r.shown.length + r.queueLength !== r.all.length) v.push(`shown (${r.shown.length}) + review queue (${r.queueLength}) does not equal all events (${r.all.length})`);
  if (r.counts?.shown != null && r.counts.shown !== r.shown.length) v.push(`counts.shown (${r.counts.shown}) does not equal the events shown (${r.shown.length})`);
  if (r.counts?.queued != null && r.counts?.dropped != null && r.counts.queued + r.counts.dropped !== r.queueLength) v.push(`counts.queued + counts.dropped (${r.counts.queued + r.counts.dropped}) does not equal the review queue (${r.queueLength})`);
  for (const e of r.shown) {
    if (e.verification !== 'VERIFIED') v.push(`${e.ticker || e.company}: shown but not verified`);
    if (e.aiVerification?.status === 'AI_CONTRADICTED') v.push(`${e.ticker || e.company}: shown although the AI verifier contradicted it`);
    if (e.excludedFromEvents) v.push(`${e.ticker || e.company}: shown although excluded from events`);
  }
  return v;
}

// ── universe: claims awaiting verification ──────────────────────────────────

/** A claims-awaiting universe record (GuUniverseRecordX) → claim. Headline point; growth % or target amount as stated. */
export function universeRecordToClaim(r: any): VerifyClaim | null {
  const pts: any[] = Array.isArray(r?.points) ? r.points : [];
  const pt = pts.find((p) => p?.listBucket === 'CLAIMS') || pts[0];
  if (!pt) return null;
  const company = str(r?.record?.company || r?.names?.[0]) || 'Unknown company';
  const ticker = str(r?.record?.ticker) || null;
  const market = marketOf(r?.record?.market);
  const metric = str(pt.metric) || null;
  const period = str(pt.period) || null;
  const abs = pt.absolute && num(pt.absolute.value) != null ? pt.absolute : null;
  const grow = pt.statedGrowth || null;
  const newV = grow ? uniqNums([num(grow.low), num(grow.high)]) : abs ? uniqNums([num(abs.valueLow), num(abs.value)]) : uniqNums([num(pt.low), num(pt.high)]);
  const unit = grow ? '% growth' : abs ? str(abs.unit) || null : null;
  const srcs: any[] = Array.isArray(pt.sources) ? pt.sources : Array.isArray(r?.sources) ? r.sources : [];
  const prim = srcs.find((s) => s?.role === 'PRIMARY' && isPrimaryHostUrl(s?.url)) || srcs.find((s) => isPrimaryHostUrl(s?.url));
  const primaryUrl = prim?.url || (isPrimaryHostUrl(pt.sourceUrl) ? pt.sourceUrl : isPrimaryHostUrl(r?.sourceUrl) ? r.sourceUrl : null);
  const sourceUrl = str(pt.sourceUrl || r?.sourceUrl) || null;
  const claimText = `${company}${ticker ? ` (${ticker})` : ''} guided ${metric || 'a metric'} for ${period || 'an unstated period'}: ${str(pt.display) || fmtVals(newV)}${unit ? ` (${unit})` : ''}.${pt.statement || r?.statement ? ` Source wording: "${str(pt.statement || r.statement).slice(0, 200)}"` : ''}`;
  const claimId = claimIdOf({ kind: 'guidance', company, metric, period, values: newV, sourceUrl });
  return { claimId, kind: 'guidance', market, company, ticker, claimText, metric, numbers: { old: [], new: newV }, unit, period, basis: null, primaryUrl, sourceUrl, refId: `${str(r?.entityKey) || company}|${metric}|${period}` };
}
