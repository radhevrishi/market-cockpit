// zzz854 - Special Situations feed layer: SEC form context, held-back classification (pooled vehicles, partnership
// units, debt / routine issuer tenders), deal roles, ticker / security resolution states, and information origins.
// Pure, no I/O. No company is hardcoded: every rule is a generic name / form / wording pattern.

import type { ResolvedEntity, SourceSubject } from './radar-owned-types';
import type {
  DealRoles, FeedHoldBackReason, InformationOrigin, SecEventSubtype, SecFilingInfo, SecurityResolution, SourceOriginSummary,
} from './multibagger-radar-feed-types';
import {
  BDC_STYLE_NAME_RE, CREDIT_VEHICLE_NAME_RE, FEED_QUARANTINE_LABEL, decodeHtmlEntities, eventFamily, isFundLikeName, isFundRepurchaseOffer, isGroupPrefix, keyNumbers, parseSecFilingTitle,
  publisherFamily, secAccession, subjectFromHeadline,
} from './special-sit-feed-quality';
import { resolveCompanyToTicker } from './nse-ticker-names';
import { normName } from './special-sit-numbers';

const sq = (s: unknown): string => (typeof s === 'string' ? decodeHtmlEntities(s).replace(/\s+/g, ' ').trim() : '');

// ─── A. SEC form -> subtype ──────────────────────────────────────────────────
/** 'SC TO-T/A' -> 'SC TO-T'; 'SC 13E-3' -> 'SC 13E3'; 'SCHEDULE 13D' -> 'SC 13D'. */
export function secBaseForm(form: string | null | undefined): string {
  return (form || '').toUpperCase().replace(/\s+/g, ' ').replace(/\/A$/, '').replace(/^SCHEDULE\s*/, 'SC ').replace(/^SC\s*/, 'SC ').replace(/13E-3/, '13E3').replace(/14D-9/, '14D9').trim();
}

export const SEC_SUBTYPE_LABEL: Record<SecEventSubtype, string> = {
  THIRD_PARTY_TENDER: 'Third-party tender offer (SC TO-T)',
  ISSUER_TENDER: 'Issuer tender offer (SC TO-I)',
  GOING_PRIVATE: 'Going-private transaction (SC 13E3)',
  TARGET_RECOMMENDATION: 'Target response to a tender offer (SC 14D9)',
  SPIN_OFF_REGISTRATION: 'Spin-off registration (Form 10-12B)',
  SECURITIES_REGISTRATION: 'Registration of a class of securities (Form 10-12G)',
  OTHER_FILING: 'SEC filing',
};

const SPIN_WORDS_RE = /\b(spin[\s-]?co|spin[\s-]?off|spun[\s-]?off|spinoff|split[\s-]?off|separation|distribution of (?:all |the )?(?:outstanding )?(?:shares|common stock)|pro rata distribution)\b/i;

/** Subtype of an SEC form. 10-12B registers a class on an exchange (the spin-off route); 10-12G is a spin-off only when the text says so. */
export function secSubtypeOf(form: string | null | undefined, text = ''): SecEventSubtype {
  const b = secBaseForm(form);
  if (b === 'SC TO-T') return 'THIRD_PARTY_TENDER';
  if (b === 'SC TO-I') return 'ISSUER_TENDER';
  if (b === 'SC 13E3') return 'GOING_PRIVATE';
  if (b === 'SC 14D9') return 'TARGET_RECOMMENDATION';
  if (b === '10-12B') return 'SPIN_OFF_REGISTRATION';
  if (b === '10-12G') return SPIN_WORDS_RE.test(text) ? 'SPIN_OFF_REGISTRATION' : 'SECURITIES_REGISTRATION';
  return 'OTHER_FILING';
}

/** Event chain family: original and amendments of one deal share it (a 14D9 answers a TO-T, so they share the family). */
export function secChainFamily(form: string | null | undefined): string | null {
  const b = secBaseForm(form);
  if (b === 'SC TO-T' || b === 'SC 14D9') return 'TPT';
  if (b === 'SC TO-I') return 'IT';
  if (b === 'SC 13E3') return 'GP';
  if (b === '10-12B' || b === '10-12G') return 'F10';
  return null;
}

export const isSecTenderFamilyForm = (form: string | null | undefined): boolean => ['SC TO-T', 'SC TO-I', 'SC 14D9', 'SC 13E3'].includes(secBaseForm(form));

/** CIK in an EDGAR title: 'X (0000815917) (Subject)'. Leading zeros kept off. */
export function cikFromTitle(title: string | null | undefined): string | null {
  const m = sq(title).match(/\((\d{3,10})\)/);
  return m ? m[1].replace(/^0+/, '') || null : null;
}

/** SEC form of a feed item: from the EDGAR title, else from an 'SEC SC TO-I' style source label. */
export function secFormOfItem(it: { title?: string; source?: string; link?: string }): { form: string; company: string | null; role: string | null; isAmendment: boolean } | null {
  const t = sq(it.title);
  const p = parseSecFilingTitle(t);
  if (p) return { form: p.form, company: p.company, role: p.role, isAmendment: p.isAmendment };
  const m = `${it.source || ''}`.match(/\b(SC\s*(?:TO-[TI]|13E-?3|14D-?9)(?:\/A)?|10-12[BG](?:\/A)?)\b/i);
  if (m && (/sec\b|edgar/i.test(it.source || '') || /sec\.gov/i.test(it.link || ''))) return { form: m[1].toUpperCase().replace(/\s+/g, ' '), company: null, role: null, isAmendment: /\/A$/i.test(m[1]) };
  return null;
}

/** Folds the SEC rows of one event (subject / filed-by listings, /A amendments) into one filing record. */
export function secFilingInfoFor(items: ReadonlyArray<{ title?: string; source?: string; link?: string; pub_date?: string; description?: string }>, text = ''): SecFilingInfo | null {
  const rows = items.map((it) => ({ it, f: secFormOfItem(it) })).filter((x) => x.f) as Array<{ it: typeof items[number]; f: NonNullable<ReturnType<typeof secFormOfItem>> }>;
  if (!rows.length) return null;
  const head = rows[0];
  const fam = secChainFamily(head.f.form);
  const chain = rows.filter((r) => secChainFamily(r.f.form) === fam);
  const ts = (d?: string) => { const x = d ? Date.parse(d) : NaN; return Number.isNaN(x) ? null : x; };
  const iso = (n: number | null) => (n == null ? null : new Date(n).toISOString());
  let orig: number | null = null, lastAm: number | null = null, last: number | null = null;
  const amendKeys = new Set<string>();
  for (const r of chain) {
    const t = ts(r.it.pub_date);
    if (r.f.isAmendment) { amendKeys.add(secAccession(r.it.link) || `${sq(r.it.title).toLowerCase()}|${r.it.pub_date || ''}`); if (t != null && (lastAm == null || t > lastAm)) lastAm = t; }
    else if (t != null && (orig == null || t < orig)) orig = t;
    if (t != null && (last == null || t > last)) last = t;
  }
  const subjRow = chain.find((r) => r.f.role === 'subject' || r.f.role === 'issuer') || chain.find((r) => r.f.role !== 'filed by') || null;
  const filerRow = chain.find((r) => r.f.role === 'filed by' && (!subjRow || r.f.company !== subjRow.f.company)) || null;
  // The original form when one was seen; an /A-only chain keeps the amended form name.
  const nonAm = chain.find((r) => !r.f.isAmendment);
  const form = (nonAm || head).f.form;
  const subtype = secSubtypeOf(form, `${chain.map((r) => sq(r.it.title)).join(' ')} ${text}`);
  return {
    form, baseForm: secBaseForm(form), isAmendment: !nonAm, subtype, subtypeLabel: SEC_SUBTYPE_LABEL[subtype],
    amendmentCount: amendKeys.size, originalDate: iso(orig), latestAmendmentDate: iso(lastAm), latestFilingDate: iso(last),
    accession: secAccession((subjRow || head).it.link), subjectCik: subjRow ? cikFromTitle(subjRow.it.title) : null, filerCik: filerRow ? cikFromTitle(filerRow.it.title) : null,
  };
}

// ─── B. Bare form title (nothing but the filing name was read) ────────────────
const EDGAR_BOILER_RE = /\b(?:filed|accno|acc-no|size|film no|period|items?|filer|subject|filed by|issuer|reporting|kb|mb|edgar|form|schedule|amendment|sec)\b|\b\d[\d:-]*\b|\b(?:SC|TO-[TI]|13E-?3|14D-?9|10-12[BG])\b/gi;
/** True when the description adds nothing beyond the EDGAR form title (form, company, CIK, filed date, accession, size). */
export function isBareFormText(title: string, description?: string | null, company?: string | null): boolean {
  const t = sq(title);
  if (!parseSecFilingTitle(t)) return false;
  let d = sq(description);
  if (!d) return true;
  d = d.split(t).join(' ');
  if (company) for (const w of normName(company)) d = d.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
  d = d.replace(/<[^>]+>/g, ' ').replace(EDGAR_BOILER_RE, ' ');
  const words = d.split(/[^A-Za-z]+/).filter((w) => w.length >= 3 && !/^(?:inc|corp|llc|ltd|plc|the|and|co)$/i.test(w));
  return words.length < 4;
}

// ─── C. Held back: pooled vehicles, partnership units, debt / routine issuer tenders ──
const REIT_NAME_RE = /\breit\b|\breal estate investment trust\b|\b(?:property|realty|income) trust\b/i;
const PARTNERSHIP_NAME_RE = /(?:\bl\.?\s?l\.?\s?l\.?\s?p\.?|\blllp|\bl\.?\s?p\.?|\bllc|\bl\.?l\.?c\.?|\blimited partnership|\bpartners(?:hip)?)\s*\.?\s*$/i;
const DEBT_TENDER_RE = /\b(senior (?:secured |unsecured |subordinated )?notes?|subordinated notes?|notes? due|\d+(?:\.\d+)?\s?%\s*(?:senior |convertible |exchangeable )?(?:notes?|debentures?|bonds?)|debentures?|bonds?|convertible (?:senior )?notes?|exchangeable notes?|consent solicitation|trust preferred|capital securities|debt securities|term loans?)\b/i;
const ROUTINE_TENDER_RE = /\b(odd[- ]lot|option exchange|exchange of (?:certain |eligible |outstanding )?(?:stock )?options|eligible (?:stock )?options|employee (?:stock|share|equity)|stock options? (?:exchange|repricing)|restricted stock units?|\bRSUs?\b|employee benefit plan|(?:quarterly|periodic|semi[- ]annual|monthly) (?:tender|repurchase)|liquidity program)\b/i;
const EQUITY_BUYBACK_RE = /\b((?:modified )?dutch auction|self[- ]tender|tender offer to (?:purchase|repurchase|buy) (?:up to )?[$\d,.\s]*(?:million|billion)?\s*(?:of )?(?:its )?(?:shares|outstanding shares|common|ordinary)|(?:shares|units) of (?:its |the company'?s )?(?:class [a-z] )?(?:common|ordinary) (?:stock|shares)|(?:common|ordinary) (?:stock|shares)|share (?:repurchase|buyback)|buyback|per share)\b/i;
const TENDERISH_TEXT_RE = /\b(tender offer|exchange offer|repurchase offer|offer to (?:purchase|repurchase|exchange)|issuer tender)\b/i;

export interface HoldBackDecision { reason: FeedHoldBackReason; label: string; detail: string }

/** True for a pooled investment vehicle name in an SEC tender / going-private context (stricter patterns than isFundLikeName, which runs on any headline). */
export function isPooledVehicleName(name: string | null | undefined, opts: { listed?: boolean } = {}): boolean {
  const n = sq(name);
  if (!n) return false;
  if (isFundLikeName(n)) return true;
  if (CREDIT_VEHICLE_NAME_RE.test(n)) return true;
  if (BDC_STYLE_NAME_RE.test(n) && !/\b(?:bank|bancorp|bancshares|insurance)\b/i.test(n)) return true;
  // A REIT whose security did not resolve to a listing is treated as a non-traded REIT (the usual SC TO-I / mini-tender filer).
  if (REIT_NAME_RE.test(n) && !opts.listed) return true;
  return false;
}

export function holdBackLabel(reason: FeedHoldBackReason): string { return FEED_QUARANTINE_LABEL[reason]; }

/**
 * One held-back decision per item, or null when it stays in Special Situations.
 * Order: pooled vehicle > partnership units > debt tender > routine (employee / odd-lot / periodic) > issuer tender with no equity terms.
 * `listed` = the security resolved to a listed ticker (guards REIT / partnership rules: a listed MLP or REIT is an operating issuer here).
 */
export function classifyFeedHoldBack(a: {
  title: string; description?: string | null; source?: string; link?: string; company?: string | null; eventType?: string;
  /** other titles / descriptions in the same event (party listings, amendments, articles) */
  relatedText?: string; listed?: boolean; secForm?: string | null;
}): HoldBackDecision | null {
  const title = sq(a.title);
  const desc = sq(a.description);
  const related = sq(a.relatedText);
  const sec = parseSecFilingTitle(title);
  const form = a.secForm || sec?.form || secFormOfItem({ title, source: a.source, link: a.link })?.form || null;
  const base = secBaseForm(form);
  const name = sq(a.company) || sec?.company || subjectFromHeadline(title) || '';
  const text = `${title} ${desc} ${related}`;
  const secTender = isSecTenderFamilyForm(form);
  const tenderish = secTender || TENDERISH_TEXT_RE.test(`${title} ${desc}`) || /\b(repurchase|tender)/i.test(a.eventType || '');
  const mk = (reason: FeedHoldBackReason, detail: string): HoldBackDecision => ({ reason, label: FEED_QUARANTINE_LABEL[reason], detail });

  if (isFundRepurchaseOffer({ title, description: `${desc} ${related}`, source: a.source, company: name, eventType: a.eventType })) return mk('FUND_REPURCHASE_OFFER', `pooled investment vehicle: ${name || 'name not stated'}`);
  if (secTender && base !== 'SC 14D9' && isPooledVehicleName(name, { listed: a.listed })) return mk('FUND_REPURCHASE_OFFER', `pooled investment vehicle (${base}): ${name}`);
  if (!tenderish) return null;
  if ((base === 'SC TO-I' || (!secTender && TENDERISH_TEXT_RE.test(title))) && PARTNERSHIP_NAME_RE.test(name.replace(/[,.]\s*$/, '')) && !a.listed) return mk('PARTNERSHIP_UNIT_REPURCHASE', `partnership / LLC interests: ${name}`);
  if (base !== 'SC 13E3' && DEBT_TENDER_RE.test(`${title} ${desc} ${related}`) && !/\bcommon (?:stock|shares)\b.*\bdutch\b/i.test(text)) return mk('DEBT_TENDER', 'the offer is for notes / bonds / other debt securities');
  if (base !== 'SC 13E3' && ROUTINE_TENDER_RE.test(text)) return mk('ROUTINE_ISSUER_TENDER', 'employee / option-exchange, odd-lot or periodic offer');
  if (base === 'SC TO-I' && !EQUITY_BUYBACK_RE.test(`${desc} ${related}`.split(title).join(' '))) return mk('ISSUER_TENDER_TERMS_NOT_READ', 'only the form title was read: nothing says this is an equity buyback or Dutch auction');
  return null;
}

// ─── D. Deal roles ───────────────────────────────────────────────────────────
const KEEP_UPPER = new Set(['LLC', 'LP', 'LLLP', 'LLP', 'SA', 'NV', 'AG', 'SE', 'II', 'III', 'IV', 'VI', 'USA', 'US', 'REIT', 'BDC', 'ETF', 'UK', 'PLC', 'S.A.', 'N.V.', 'L.P.', 'AB', 'ASA', 'SPA', 'S.P.A.', 'AS']);
/** EDGAR all-caps names -> title case for display ('STURM RUGER & CO INC' -> 'Sturm Ruger & Co Inc'). Mixed-case names are kept. */
export function displayName(name: string | null | undefined): string {
  const n = sq(name);
  if (!n || /[a-z]/.test(n)) return n;
  return n.split(' ').map((w) => (KEEP_UPPER.has(w.replace(/,$/, '')) ? w : w.toLowerCase().replace(/(^|[-/&.(])([a-z])/g, (_m, p, c) => p + c.toUpperCase()))).join(' ');
}

/** Acquirer / target / filer roles. SEC: TO-T acquirer = filed-by entity, target = subject; 13E3 buyer group = filed-by; TO-I issuer = subject. */
export function dealRolesFor(a: { secFiling?: SecFilingInfo | null; subject?: string | null; filer?: string | null; sourceSubject?: SourceSubject | null; acquirerTicker?: string | null }): DealRoles | null {
  const st = a.secFiling?.subtype || null;
  const subject = a.subject ? displayName(a.subject) : null;
  const filer = a.filer && a.filer !== a.subject ? displayName(a.filer) : null;
  const notes: string[] = [];
  if (st === 'THIRD_PARTY_TENDER' || st === 'TARGET_RECOMMENDATION') {
    if (!filer) notes.push(st === 'THIRD_PARTY_TENDER' ? 'Acquirer (the filed-by entity) is not in the feed' : 'Bidder is not named in the target response row');
    return { subject, filer, acquirer: filer, acquirerTicker: filer ? a.acquirerTicker ?? null : null, target: subject, financialOwner: subject ? `Target shareholders (${subject})` : null, roleLine: `Acquirer: ${filer || 'Not established'} → Target: ${subject || 'Not established'}`, notes };
  }
  if (st === 'GOING_PRIVATE') {
    if (!filer) notes.push('Buyer group (the filed-by entity) is not in the feed');
    return { subject, filer, acquirer: filer, acquirerTicker: filer ? a.acquirerTicker ?? null : null, target: subject, financialOwner: subject ? `Unaffiliated shareholders of ${subject}` : null, roleLine: `Buyer group: ${filer || 'Not established'} → Going private: ${subject || 'Not established'}`, notes };
  }
  if (st === 'ISSUER_TENDER') {
    return { subject, filer, acquirer: subject, acquirerTicker: null, target: subject, financialOwner: subject ? `Tendering holders of ${subject}` : null, roleLine: subject ? `Issuer buying its own securities: ${subject}` : null, notes };
  }
  if (st === 'SPIN_OFF_REGISTRATION') {
    notes.push('Parent company is not named in the registration title');
    return { subject, filer, acquirer: null, acquirerTicker: null, target: null, financialOwner: subject, roleLine: subject ? `Company being spun off (registrant): ${subject}` : null, notes };
  }
  const ss = a.sourceSubject;
  if (ss && ss.target && ss.eventSubject && ss.target !== ss.eventSubject) {
    return { subject: ss.sourceSubject || null, filer: null, acquirer: ss.eventSubject, acquirerTicker: null, target: ss.target, financialOwner: ss.financialOwner || null, roleLine: `Acquirer: ${ss.eventSubject} → Target: ${ss.target}`, notes };
  }
  return null;
}

// ─── E. Security / ticker resolution state ───────────────────────────────────
export interface SecurityContext {
  name: string;
  cik?: string | null;
  isSec?: boolean;
  region?: string;
  /** an SEC ticker map was available to the resolver */
  usLookupLoaded?: boolean;
  nseLookup?: (name: string) => string | undefined;
  usByName?: (norm: string) => Array<{ ticker: string; name: string }>;
  heldBackReason?: FeedHoldBackReason | null;
}

const CORP_SUFFIX_RE = /\s*,?\s*\b(?:ltd\.?|limited|inc\.?|incorporated|corp\.?|corporation|plc|llc|co\.?|company|pvt\.?|private)\s*$/i;

/** '<Parent> <Something>' -> the parent, only when the leading name resolves exactly to a listed company (never a group prefix). */
export function listedParentOf(name: string, ctx: Pick<SecurityContext, 'nseLookup' | 'usByName'> = {}): { name: string; ticker: string } | null {
  let base = sq(name);
  for (let i = 0; i < 3; i++) base = base.replace(CORP_SUFFIX_RE, '').trim();
  const toks = base.split(' ').filter(Boolean);
  if (toks.length < 2) return null;
  const nse = ctx.nseLookup || resolveCompanyToTicker;
  for (let k = toks.length - 1; k >= 1; k--) {
    const prefix = toks.slice(0, k).join(' ');
    if (k === 1 && isGroupPrefix(prefix)) return null;   // 'Tata X' / 'Adani X': a group, not one listed parent
    if (prefix.length < 3) continue;
    const t = nse(prefix);
    if (t) return { name: prefix, ticker: t };
    if (ctx.usByName) {
      const rows = ctx.usByName(normName(prefix).join(' '));
      const uniq = Array.from(new Set(rows.map((r) => r.ticker)));
      if (uniq.length === 1) return { name: rows[0].name, ticker: uniq[0] };
    }
  }
  return null;
}

/** Explicit security state for the card (never 'No ticker'). Pure: everything comes from the entity and the injected lookups. */
export function securityResolutionFor(e: ResolvedEntity, ctx: SecurityContext): SecurityResolution {
  const exch = e.exchange || null;
  const r = (state: SecurityResolution['state'], label: string, reason: string, extra: Partial<SecurityResolution> = {}): SecurityResolution => ({ state, label, reason, ticker: null, exchange: null, ...extra });
  if (ctx.heldBackReason === 'PARTNERSHIP_UNIT_REPURCHASE') return r('NON_EQUITY_ENTITY', 'Non-equity entity (LP / LLC units)', 'partnership or LLC interests, not listed common stock');
  if (ctx.heldBackReason === 'FUND_REPURCHASE_OFFER' || e.entityType === 'FUND') return r('NON_EQUITY_ENTITY', 'Non-equity entity (fund / BDC / pooled vehicle)', 'pooled investment vehicle');
  switch (e.state) {
    case 'RESOLVED':
      if (e.ticker) return r('RESOLVED', `Ticker: ${e.ticker}${exch ? ` (${exch})` : ''}`, e.basis, { ticker: e.ticker, exchange: exch });
      break;
    case 'RESOLVED_MULTIPLE': {
      const m = e.basis.match(/multiple listed securities:\s*(.+)$/);
      const tickers = m ? m[1].split(/\s*,\s*/).filter(Boolean) : [];
      return r('RESOLVED_MULTIPLE', `Resolved - multiple securities${tickers.length ? `: ${tickers.join(', ')}` : ''}`, e.basis, { tickers });
    }
    case 'UNLISTED': return r('UNLISTED', 'Unlisted (private company)', e.basis);
    case 'NOT_APPLICABLE':
      if (e.entityType === 'REGULATOR') return r('NOT_APPLICABLE', 'Not applicable (regulator)', e.basis);
      if (e.entityType === 'COURT') return r('NOT_APPLICABLE', 'Not applicable (court / tribunal)', e.basis);
      if (e.entityType === 'GROUP') return r('NOT_APPLICABLE', 'Not applicable (group / promoter name, not one listed issuer)', e.basis);
      return r('NOT_APPLICABLE', 'Not applicable', e.basis);
    default: break;
  }
  // UNRESOLVED (or RESOLVED without a ticker)
  if (e.listedIssuer) return r('UNRESOLVED', 'Unresolved - listed issuer known, security not identified', `listed issuer ${e.listedIssuer}; security not identified`);
  const parent = ctx.name ? listedParentOf(ctx.name, ctx) : null;
  if (parent) return r('UNLISTED_SUBSIDIARY', `Unlisted subsidiary - listed parent: ${parent.name} (${parent.ticker})`, `"${ctx.name}" is not in the company master; its leading name resolves to listed ${parent.name}`, { listedParent: { name: parent.name, ticker: parent.ticker } });
  let reason: string;
  if (!ctx.name || /^(?:not identified|unnamed company)$/i.test(ctx.name)) reason = 'no company name in the source';
  else if (ctx.isSec && ctx.cik) reason = ctx.usLookupLoaded ? 'CIK not in ticker map' : 'SEC ticker map not loaded';
  else if (ctx.isSec || ctx.region === 'US') reason = ctx.usLookupLoaded ? 'name not matched' : 'name not matched (SEC ticker map not loaded)';
  else reason = 'name not matched';
  return r('UNRESOLVED', `Unresolved - ${reason}`, reason);
}

// ─── F. Information origins (independence by origin, not by outlet) ──────────
const WIRE_RE = /pr ?newswire|globe ?newswire|business ?wire|accesswire|newsfile|press release/i;
const EXCHANGE_RE = /bseindia|nseindia|sec\.gov|edgar|\bbse\b|\bnse\b|exchange filing|corp(?:orate)? announcements?|regulatory filing/i;
const CITES_DISCLOSURE_RE = /\b(?:said in (?:a|an|its) (?:statement|filing|press release|exchange filing|regulatory filing)|according to (?:a|an|its|the) (?:filing|press release|exchange filing|regulatory filing|statement)|(?:exchange|regulatory|stock exchange) filing|press release|informed the (?:exchanges?|bourses?)|told the (?:exchanges?|bourses?)|in a filing)\b/i;
const OWN_REPORTING_RE = /\b(?:sources? (?:said|say|told)|people (?:familiar|aware|close)|exclusive|according to (?:people|sources|persons)|reportedly|it has learnt|has learned)\b/i;

const tokSet = (t: string): Set<string> => new Set(sq(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2 && !/^(?:the|and|for|with|from|its|has|have|will|that|this|after|over|into)$/.test(w)));
const jac = (a: Set<string>, b: Set<string>): number => { if (!a.size || !b.size) return 0; let i = 0; a.forEach((x) => { if (b.has(x)) i += 1; }); return i / (a.size + b.size - i); };
const fnv = (s: string): string => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };

export type OriginCopyKind = 'ORIGIN' | 'SYNDICATED' | 'AMENDMENT' | 'PARTY_LISTING';
export interface OriginAssignment extends SourceOriginSummary { perItem: Array<{ originId: string; copyKind: OriginCopyKind }> }

/**
 * Groups the sources behind one event into information origins.
 * - Every SEC / exchange / wire item about the event is one PRIMARY_DISCLOSURE origin (its party listings and /A amendments are copies).
 * - A media item joins an origin when it is the same newsroom (publisher family), cites the filing / release, shares a key figure,
 *   or is a near-identical rewrite (token overlap). Only a media item with none of these (own reporting, different facts) is a new origin.
 */
export function assignInformationOrigins(items: ReadonlyArray<{ title?: string; source?: string; link?: string; description?: string; pub_date?: string }>, opts: { subject?: string | null } = {}): OriginAssignment {
  type O = { id: string; kind: InformationOrigin['kind']; members: number[]; labels: Set<string>; toks: Set<string>; nums: Set<string>; fams: Set<string>; secRows: Set<string> };
  const origins: O[] = [];
  const perItem: Array<{ originId: string; copyKind: OriginCopyKind }> = [];
  const subjKey = normName(opts.subject || '').join(' ');
  let primary: O | null = null;
  items.forEach((it, i) => {
    const title = sq(it.title), src = sq(it.source), link = it.link || '';
    const text = `${title} ${sq(it.description)}`;
    const sec = secFormOfItem({ title, source: src, link });
    const isPrimary = !!sec || EXCHANGE_RE.test(`${src} ${link}`) || WIRE_RE.test(`${src} ${link}`);
    const toks = tokSet(title), nums = keyNumbers(title);
    const fam = src ? publisherFamily(src) : (link ? (link.match(/^https?:\/\/(?:www\.)?([^/]+)/i)?.[1] || '') : '');
    const label = src || fam || title.slice(0, 40);
    if (isPrimary) {
      let kind: OriginCopyKind = 'ORIGIN';
      if (primary) {
        if (sec?.isAmendment) kind = 'AMENDMENT';
        else if (sec && (sec.role === 'filed by' || primary.secRows.has(secAccession(link) || '\u0000'))) kind = 'PARTY_LISTING';
        else kind = sec ? 'PARTY_LISTING' : 'SYNDICATED';
      } else {
        primary = { id: `orig_${fnv(`primary|${subjKey}|${eventFamily(title)}|${secChainFamily(sec?.form) || ''}`)}`, kind: 'PRIMARY_DISCLOSURE', members: [], labels: new Set(), toks: new Set(), nums: new Set(), fams: new Set(), secRows: new Set() };
        origins.push(primary);
      }
      primary.members.push(i); primary.labels.add(label); toks.forEach((x) => primary!.toks.add(x)); nums.forEach((x) => primary!.nums.add(x)); if (fam) primary.fams.add(fam);
      const acc = secAccession(link); if (acc) primary.secRows.add(acc);
      perItem.push({ originId: primary.id, copyKind: kind });
      return;
    }
    // media item
    const cites = CITES_DISCLOSURE_RE.test(text) && !OWN_REPORTING_RE.test(text);
    let hit: O | null = null;
    for (const o of origins) {
      const sharedNum = Array.from(nums).some((x) => o.nums.has(x));
      if ((fam && o.fams.has(fam)) || (o.kind === 'PRIMARY_DISCLOSURE' && cites) || sharedNum || jac(toks, o.toks) >= 0.5) { hit = o; break; }
    }
    if (hit) {
      hit.members.push(i); hit.labels.add(label); toks.forEach((x) => hit!.toks.add(x)); nums.forEach((x) => hit!.nums.add(x)); if (fam) hit.fams.add(fam);
      perItem.push({ originId: hit.id, copyKind: 'SYNDICATED' });
      return;
    }
    const o: O = { id: `orig_${fnv(`media|${fam}|${Array.from(toks).sort().slice(0, 10).join(' ')}`)}`, kind: 'MEDIA_REPORT', members: [i], labels: new Set([label]), toks, nums: new Set(nums), fams: new Set(fam ? [fam] : []), secRows: new Set() };
    origins.push(o);
    perItem.push({ originId: o.id, copyKind: 'ORIGIN' });
  });
  const count = (k: OriginCopyKind) => perItem.filter((p) => p.copyKind === k).length;
  const syndicatedCopies = count('SYNDICATED'), amendmentCopies = count('AMENDMENT'), partyListings = count('PARTY_LISTING');
  const n = items.length, k = origins.length;
  const parts: string[] = [];
  if (syndicatedCopies) parts.push(`${syndicatedCopies} syndicated / rewritten ${syndicatedCopies === 1 ? 'copy' : 'copies'}`);
  if (amendmentCopies) parts.push(`${amendmentCopies} ${amendmentCopies === 1 ? 'amendment' : 'amendments'}`);
  if (partyListings) parts.push(`${partyListings} party ${partyListings === 1 ? 'listing' : 'listings'} of the same filing`);
  const line = `${n} ${n === 1 ? 'item' : 'items'} · ${k} independent ${k === 1 ? 'origin' : 'origins'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  return {
    sourceCount: n, independentOrigins: k, syndicatedCopies, amendmentCopies, partyListings,
    origins: origins.map((o) => ({ originId: o.id, kind: o.kind, members: o.members.slice(), labels: Array.from(o.labels) })),
    line, perItem,
  };
}

/** Rows for the SEC lookup from a plain CIK -> ticker map (e.g. us-edgar cikTickerMap()). Names are not known there, so only CIK matching works. */
export function secRowsFromCikTickerMap(map: ReadonlyMap<number | string, string> | null | undefined): Array<{ ticker: string; name: string; cik: string }> {
  const out: Array<{ ticker: string; name: string; cik: string }> = [];
  if (!map) return out;
  map.forEach((t, c) => { if (t) out.push({ ticker: String(t).toUpperCase(), name: '', cik: String(c) }); });
  return out;
}

export { isFundRepurchaseOffer };
