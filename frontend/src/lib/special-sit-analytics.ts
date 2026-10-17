// zzz1066 — Special Situations deal maths, in three clearly separate parts (audit S03):
//   1. SOURCED terms — what the source actually states (per-share consideration, programme size, total value, stake, dates).
//   2. ILLUSTRATIVE scenario — the playbook's typical spread / duration, labelled as an illustration, never as this deal.
//   3. HISTORICAL PRIORS — the playbook's completion rate / duration, with where they come from.
// A spread / return / payoff is shown as LIVE only when the current price, a sourced per-share consideration, a remaining
// completion date and a downside assumption are all present; otherwise the card says "Not established" and the event is not
// ranked. A generic (open-market) buyback is never tender arbitrage, and a programme size is never a per-share offer.
// Estimated milestones are anchored to the EVENT date and marked overdue once passed (never rolled forward to today).
// Pure: no I/O.

import { getPlaybook } from './specsit-playbooks';

export const PRIOR_SOURCE = 'Playbook priors in lib/specsit-playbooks.ts: a static synthesis of public Indian M&A outcomes 2015–2025 and standard US merger-arbitrage references. Not from a live deal database and not specific to this deal.';

export interface AnalyticsEventIn {
  event_type: string;
  title?: string;
  description?: string;
  /** earliest publication date of the event (ISO) */
  event_date?: string | null;
  region?: string | null;
  /** sourced deal-term fields (from the feed's term extraction, e.g. offer_price, size, price, expiry_date) */
  terms_fields?: Record<string, string> | null;
  terms_kind?: string | null;
  /** SEC form when the event is an EDGAR filing (SC TO-I = issuer tender) */
  sec_form?: string | null;
}

export interface Money { amount: number; currency: '$' | '₹' | '€' | '£'; text: string }
export interface SourcedTerms {
  /** a PER-SHARE price / consideration stated by the source */
  perShare: Money | null;
  /** total size of a buyback programme (never a per-share offer) */
  programmeSize: string | null;
  /** total deal value / purchase price */
  totalConsideration: string | null;
  /** acquired stake, e.g. '26%' */
  acquiredStake: string | null;
  /** a stated completion / expiry / record date (ISO yyyy-mm-dd) */
  completionDate: string | null;
  completionLabel: string | null;
  /** how a buyback is done, when stated */
  buybackMethod: 'TENDER' | 'OPEN_MARKET' | null;
}

const MAG_RE = /\b(?:crores?|cr\.?|lakhs?|lacs?|billions?|bn|millions?|mn|m|b|thousand|k)\b/i;
const CUR_RE = /(\$|US\$|USD|₹|Rs\.?|INR|€|EUR|£|GBP)\s?(\d[\d,]*(?:\.\d+)?)/i;

/** A money amount that is explicitly per share (or a bare price with no size word). Programme / deal totals return null. */
export function parsePerShare(text: string | null | undefined): Money | null {
  const t = String(text || '');
  const m = t.match(CUR_RE);
  if (!m) return null;
  const after = t.slice((m.index || 0) + m[0].length, (m.index || 0) + m[0].length + 24);
  const perShare = /^\s*(?:per\s+(?:equity\s+)?share|\/\s?share|a share|each)/i.test(after) || /per\s+(?:equity\s+)?share/i.test(t);
  if (MAG_RE.test(after.slice(0, 12)) && !/^\s*per/i.test(after)) return null;
  if (!perShare && MAG_RE.test(t)) return null;
  const amount = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const c = m[1].toUpperCase();
  const currency: Money['currency'] = c.includes('₹') || c.startsWith('RS') || c === 'INR' ? '₹' : c.includes('€') || c === 'EUR' ? '€' : c.includes('£') || c === 'GBP' ? '£' : '$';
  return { amount, currency, text: m[0].trim() };
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** A calendar date in a term value ('June 30, 2026', '30 Jun 2026', '2026-06-30'). Null when no full date is stated. */
export function parseTermDate(v: string | null | undefined): string | null {
  const s = String(v || '');
  let m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (m && m[1].toLowerCase() in MONTHS) return new Date(Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2])).toISOString().slice(0, 10);
  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(20\d{2})\b/);
  if (m && m[2].toLowerCase() in MONTHS) return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1])).toISOString().slice(0, 10);
  return null;
}

export function sourcedTermsOf(ev: AnalyticsEventIn): SourcedTerms {
  const f = ev.terms_fields || {};
  const text = `${ev.title || ''}. ${ev.description || ''}`;
  const perShare = [f.offer_price, f.consideration_per_share, f.price, f.amount_per_share].map(parsePerShare).find(Boolean) || null;
  const stake = (text.match(/\b(\d{1,3}(?:\.\d+)?)\s?%\s+(?:stake|equity|shareholding|holding)\b/i) || [])[1];
  const dateField = (['expiry_date', 'expected_close', 'record_date', 'listing_date'] as const).find((k) => parseTermDate(f[k]));
  const method = f.method || '';
  const buybackMethod: SourcedTerms['buybackMethod'] = /tender/i.test(method) || /\btender (?:offer|route)\b|\bthrough (?:the )?tender\b|\bSC\s*TO-I\b/i.test(`${text} ${ev.sec_form || ''}`)
    ? 'TENDER'
    : /open market|stock exchange (?:route|mechanism)|repurchase program|share repurchase program|authori[sz]es?\b.*\b(?:buyback|repurchase)/i.test(`${method} ${text}`) ? 'OPEN_MARKET' : null;
  return {
    perShare,
    programmeSize: f.size || (/(?:buy ?back|repurchase)/i.test(text) ? ((text.match(/(?:\$|US\$|₹|Rs\.?)\s?\d[\d,.]*\s?(?:crores?|cr|billion|bn|million|mn|m|b)\b/i) || [])[0] || null) : null),
    totalConsideration: f.purchase_price && !parsePerShare(f.purchase_price) ? f.purchase_price : null,
    acquiredStake: stake ? `${stake}%` : null,
    completionDate: dateField ? parseTermDate(f[dateField]) : null,
    completionLabel: dateField ? dateField.replace(/_/g, ' ') : null,
    buybackMethod,
  };
}

const ARB_TYPES = new Set(['OPEN_OFFER', 'TENDER_OFFER', 'GOING_PRIVATE', 'MERGER_DEFINITIVE', 'ACQUISITION_PUBLIC', 'BUYBACK_TENDER']);

/** Tender arbitrage only when the mechanism is a tender: a third-party / open offer, or a buyback the SOURCE says is a tender. */
export function isTenderArbitrage(ev: AnalyticsEventIn, t: SourcedTerms = sourcedTermsOf(ev)): boolean {
  const et = String(ev.event_type || '').toUpperCase();
  if (et === 'BUYBACK_TENDER' || et === 'BUYBACK_OPEN_MARKET' || et === 'BUYBACK') return t.buybackMethod === 'TENDER';
  return et === 'OPEN_OFFER' || et === 'TENDER_OFFER' || et === 'GOING_PRIVATE';
}

/** The event type to show / look up priors for: a buyback not stated to be a tender is an open-market buyback. */
export function effectiveEventType(ev: AnalyticsEventIn, t: SourcedTerms = sourcedTermsOf(ev)): string {
  const et = String(ev.event_type || '').toUpperCase();
  if ((et === 'BUYBACK_TENDER' || et === 'BUYBACK') && t.buybackMethod !== 'TENDER') return 'BUYBACK_OPEN_MARKET';
  return et;
}

const ESTIMATE_DAYS: Record<string, { label: string; days: number }> = {
  OPEN_OFFER: { label: 'Open offer typically opens', days: 30 },
  TENDER_OFFER: { label: 'Tender typically closes', days: 35 },
  BUYBACK_TENDER: { label: 'Buyback record date typically', days: 21 },
  GOING_PRIVATE: { label: 'Delisting offer typically', days: 90 },
  MERGER_DEFINITIVE: { label: 'Regulatory review typically ends', days: 180 },
  ACQUISITION_PUBLIC: { label: 'Completion typically', days: 180 },
  SPIN_OFF: { label: 'Record date typically', days: 120 },
  DEMERGER_INDIA: { label: 'NCLT approval + record date typically', days: 120 },
  IPO_SUBSIDIARY: { label: 'IPO window typically', days: 90 },
  NCLT_IBC_RESOLUTION: { label: 'NCLT decision typically', days: 45 },
  INDEX_INCLUSION: { label: 'Effective date typically', days: 30 },
};

export interface Milestone {
  label: string;
  /** ISO date */
  date: string;
  /** 'SOURCED' = a date the source states; 'ESTIMATE' = event date + typical days for the event type */
  kind: 'SOURCED' | 'ESTIMATE';
  anchoredTo: string | null;
  overdue: boolean;
  /** days from now (negative = passed) */
  daysOut: number;
}

/** The next milestone: a sourced date when there is one, else an estimate anchored to the event date. Null without a date. */
export function milestoneFor(ev: AnalyticsEventIn, now: number = Date.now(), t: SourcedTerms = sourcedTermsOf(ev)): Milestone | null {
  const day = 86400_000;
  if (t.completionDate) {
    const at = Date.parse(t.completionDate);
    const daysOut = Math.round((at - now) / day);
    return { label: `${t.completionLabel ? t.completionLabel[0].toUpperCase() + t.completionLabel.slice(1) : 'Date'} (stated)`, date: t.completionDate, kind: 'SOURCED', anchoredTo: null, overdue: daysOut < 0, daysOut };
  }
  const est = ESTIMATE_DAYS[effectiveEventType(ev, t)];
  const anchor = ev.event_date ? Date.parse(ev.event_date) : NaN;
  if (!est || !Number.isFinite(anchor)) return null;
  const at = anchor + est.days * day;
  const daysOut = Math.round((at - now) / day);
  return { label: `${est.label} ~${est.days}d after the event (estimate, not stated)`, date: new Date(at).toISOString().slice(0, 10), kind: 'ESTIMATE', anchoredTo: new Date(anchor).toISOString().slice(0, 10), overdue: daysOut < 0, daysOut };
}

export interface DealAnalytics {
  effectiveType: string;
  tenderArbitrage: boolean;
  sourced: SourcedTerms;
  /** gross spread from the live price and the SOURCED per-share consideration (null otherwise) */
  grossSpreadPct: number | null;
  /** all four inputs present: a live scenario can be shown and ranked */
  established: boolean;
  /** what is missing for a live scenario (plain words) */
  notEstablished: string[];
  live: null | {
    daysRemaining: number;
    successPayoffPct: number;
    failurePayoffPct: number;
    annualisedSuccessPct: number;
    /** completion probability at which the expected payoff is zero */
    breakEvenProbabilityPct: number;
    assumptions: string[];
  };
  illustrative: null | { label: string; spreadPct: number; closeDays: number };
  prior: null | { label: string; successRatePct: number; avgCloseDays: number; closeDaysRange: [number, number]; typicalSpreadPct: number; source: string };
  milestone: Milestone | null;
}

/**
 * Deal maths for one event. `cmp` = live price of the target security; `downsidePrice` = an explicit failure-case price
 * (the user's assumption; never invented here).
 */
export function computeDealAnalytics(ev: AnalyticsEventIn, opts: { cmp?: number | null; downsidePrice?: number | null; now?: number } = {}): DealAnalytics {
  const now = opts.now ?? Date.now();
  const sourced = sourcedTermsOf(ev);
  const effectiveType = effectiveEventType(ev, sourced);
  const tenderArbitrage = isTenderArbitrage(ev, sourced);
  const arbStyle = ARB_TYPES.has(effectiveType);
  const cmp = opts.cmp != null && Number.isFinite(opts.cmp) && opts.cmp > 0 ? opts.cmp : null;
  const per = sourced.perShare?.amount ?? null;
  const milestone = milestoneFor(ev, now, sourced);
  const remaining = sourced.completionDate ? Math.round((Date.parse(sourced.completionDate) - now) / 86400_000) : null;
  const downside = opts.downsidePrice != null && Number.isFinite(opts.downsidePrice) && opts.downsidePrice > 0 ? opts.downsidePrice : null;

  const notEstablished: string[] = [];
  if (!arbStyle) notEstablished.push('not a spread trade (no fixed consideration for this event type)');
  else {
    if (cmp == null) notEstablished.push('current price');
    if (per == null) notEstablished.push(sourced.programmeSize || sourced.totalConsideration ? 'per-share consideration (only a total size is stated)' : 'per-share consideration');
    if (remaining == null) notEstablished.push('completion date');
    else if (remaining <= 0) notEstablished.push('remaining completion date (the stated date has passed)');
    if (downside == null) notEstablished.push('downside if the deal fails');
  }
  const grossSpreadPct = arbStyle && cmp != null && per != null ? ((per - cmp) / cmp) * 100 : null;
  const established = arbStyle && notEstablished.length === 0;
  const live = established
    ? (() => {
      const s = ((per! - cmp!) / cmp!) * 100;
      const f = ((downside! - cmp!) / cmp!) * 100;
      const be = s - f !== 0 ? Math.min(100, Math.max(0, (-f / (s - f)) * 100)) : 100;
      return {
        daysRemaining: remaining!, successPayoffPct: s, failurePayoffPct: f, annualisedSuccessPct: s * (365 / remaining!), breakEvenProbabilityPct: be,
        assumptions: ['before trading costs, taxes and financing', `completion on the stated date (${sourced.completionDate})`, `failure price = your assumption (${downside})`, tenderArbitrage ? 'full acceptance (proration not modelled)' : 'consideration paid in full'],
      };
    })()
    : null;
  const pb = getPlaybook(effectiveType);
  return {
    effectiveType, tenderArbitrage, sourced, grossSpreadPct, established, notEstablished, live,
    illustrative: pb && arbStyle ? { label: 'Illustrative only: a typical deal of this type, not this deal', spreadPct: pb.typical_spread_pct, closeDays: pb.avg_close_days } : null,
    prior: pb ? { label: pb.label, successRatePct: pb.success_rate_pct, avgCloseDays: pb.avg_close_days, closeDaysRange: pb.close_days_range, typicalSpreadPct: pb.typical_spread_pct, source: PRIOR_SOURCE } : null,
    milestone,
  };
}

/** Rank only established scenarios (by annualised success payoff); everything else is left out of any risk/reward ranking. */
export function rankEstablished<T>(rows: ReadonlyArray<{ item: T; a: DealAnalytics }>): Array<{ item: T; a: DealAnalytics }> {
  return rows.filter((r) => r.a.established && r.a.live).sort((x, y) => y.a.live!.annualisedSuccessPct - x.a.live!.annualisedSuccessPct);
}
